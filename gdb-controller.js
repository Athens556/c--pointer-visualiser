/**
 * GDB Controller - Manages GDB process via WSL
 * Uses GDB/MI protocol for structured communication
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');

class GDBController extends EventEmitter {
    constructor() {
        super();
        this.gdbProcess = null;
        this.isRunning = false;
        this.isPaused = false;
        this.currentFile = null;
        this.currentLine = 0;
        this.tempDir = path.join(os.tmpdir(), 'c-visualizer-debug');
        this.buffer = '';

        // Command management
        this.tokenCounter = 0;
        this.pendingRequests = new Map(); // id -> {resolve, reject}

        // Ensure temp directory exists
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Compile C code with debug symbols
     */
    async compile(code) {
        return new Promise((resolve, reject) => {
            const sourceFile = path.join(this.tempDir, 'debug_prog.c');
            const exeFile = path.join(this.tempDir, 'debug_prog');

            // Write source file
            fs.writeFileSync(sourceFile, code, 'utf8');

            // Convert paths to WSL format
            const wslSource = this.toWslPath(sourceFile);
            const wslExe = this.toWslPath(exeFile);

            // Compile with debug symbols and dump GIMPLE
            const cmd = `wsl gcc -g -O0 -fdump-tree-gimple "${wslSource}" -o "${wslExe}" 2>&1`;

            require('child_process').exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`Compilation failed: ${stdout || stderr}`));
                } else {
                    this.exePath = wslExe;

                    // Read generated GIMPLE file
                    // It usually creates a file like 'debug_prog.c.006t.gimple' in the same dir
                    // We need to find it
                    const findCmd = `wsl find "${this.toWslPath(this.tempDir)}" -name "*.gimple" -type f | head -1`;

                    require('child_process').exec(findCmd, (err, findOut) => {
                        let gimpleContent = '';
                        if (!err && findOut.trim()) {
                            const gimplePath = findOut.trim();
                            // Read it via cat
                            require('child_process').exec(`wsl cat "${gimplePath}"`, (e, catOut) => {
                                if (!e) gimpleContent = catOut;
                                resolve({ success: true, exePath: wslExe, gimple: gimpleContent });
                            });
                        } else {
                            resolve({ success: true, exePath: wslExe, gimple: '' });
                        }
                    });
                }
            });
        });
    }

    /**
     * Start GDB session
     */
    async start() {
        if (!this.exePath) {
            throw new Error('No executable. Call compile() first.');
        }

        return new Promise((resolve, reject) => {
            // Start GDB in MI mode via WSL
            this.gdbProcess = spawn('wsl', [
                'gdb', '--interpreter=mi', '--quiet', this.exePath
            ]);

            this.isRunning = true;
            this.isPaused = false;
            this.buffer = '';

            // Handle stdout (GDB/MI output)
            this.gdbProcess.stdout.on('data', (data) => {
                this.handleOutput(data.toString());
            });

            // Handle stderr
            this.gdbProcess.stderr.on('data', (data) => {
                this.emit('error', data.toString());
            });

            // Handle process exit
            this.gdbProcess.on('close', (code) => {
                this.isRunning = false;
                this.isPaused = false;
                this.emit('exit', code);
            });

            // Wait for GDB to be ready
            setTimeout(async () => {
                try {
                    // Set breakpoint at main and run
                    await this.request('-break-insert main');
                    this.request('-exec-run'); // Auto-run to main
                    resolve({ success: true });
                } catch (e) {
                    reject(e);
                }
            }, 500);
        });
    }

    /**
     * Send command and wait for result
     */
    request(cmd) {
        return new Promise((resolve, reject) => {
            const token = ++this.tokenCounter;
            this.pendingRequests.set(token, { resolve, reject });
            this.sendCommand(`${token}${cmd}`);
        });
    }

    /**
     * Run the program
     */
    run() {
        this.request('-exec-run');
    }

    /**
     * Step over (next line)
     */
    next() {
        this.request('-exec-next');
    }

    /**
     * Step into function
     */
    stepInto() {
        this.request('-exec-step');
    }

    /**
     * Continue execution
     */
    continue() {
        this.request('-exec-continue');
    }

    /**
     * Stop/kill the program
     */
    stop() {
        if (this.gdbProcess) {
            this.request('-gdb-exit');
            this.gdbProcess = null;
            this.isRunning = false;
        }
    }

    /**
     * Get local variables with addresses
     */
    async getLocals() {
        try {
            const res = await this.request('-stack-list-locals 2');
            const locals = this.parseLocals(res.locals);

            // Enrich with addresses
            for (const local of locals) {
                // Get address of variable: &name
                try {
                    const addrRes = await this.request(`-data-evaluate-expression "&${local.name}"`);
                    // Result: value="0x..." or value="0x... <symbol>"
                    // Parse address
                    let addr = addrRes.value;
                    if (addr && addr.includes(' ')) {
                        addr = addr.split(' ')[0];
                    }
                    if (addr) {
                        local.address = addr;
                    }
                } catch (e) {
                    // Common errors: "Address requested for identifier..." (in register), "Can't take address..." (not lvalue)
                    // We just ignore these and leave address property undefined/null
                    local.address = null;
                }
            }

            this.emit('locals', locals);
            return locals;
        } catch (e) {
            console.error('getLocals error:', e);
        }
    }

    /**
     * Get stack frames
     */
    async getStack() {
        try {
            const res = await this.request('-stack-list-frames');
            const frames = this.parseStack(res.stack);
            this.emit('stack', frames);
            return frames;
        } catch (e) {
            console.error('getStack error:', e);
        }
    }

    /**
     * Evaluate expression
     */
    async evaluate(expr) {
        try {
            const res = await this.request(`-data-evaluate-expression "${expr}"`);
            this.emit('value', res.value);
            return res.value;
        } catch (e) {
            this.emit('error', e.message);
        }
    }

    /**
     * Add breakpoint
     */
    addBreakpoint(line) {
        const file = 'debug_prog.c';
        this.request(`-break-insert -f ${file}:${line}`);
    }

    /**
     * Remove breakpoint
     */
    removeBreakpoint(line) {
        // Using CLI command for clear
        this.sendCommand(`-interpreter-exec console "clear debug_prog.c:${line}"`);
    }

    /**
     * Get all pointer information
     */
    getPointerState() {
        // Fire both async
        this.getLocals();
        this.getStack();
    }

    /**
     * Send command to GDB (internal)
     */
    sendCommand(cmd) {
        if (this.gdbProcess && this.isRunning) {
            console.log(`[GDB] > ${cmd}`);
            this.gdbProcess.stdin.write(cmd + '\n');
        }
    }

    /**
     * Handle GDB/MI output
     */
    handleOutput(data) {
        this.buffer += data;

        // Process complete lines
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;
            console.log(`[GDB] < ${line}`);
            this.parseMIOutput(line);
        }
    }

    /**
     * Parse GDB/MI output
     */
    parseMIOutput(line) {
        // Extract token if present: 123^done...
        const match = line.match(/^(\d+)(.*)/);
        let token = null;
        let content = line;

        if (match) {
            token = parseInt(match[1]);
            content = match[2];
        }

        // Result records (^done, ^error)
        if (content.startsWith('^done')) {
            const data = this.parseMIData(content.substring(5));
            if (token && this.pendingRequests.has(token)) {
                this.pendingRequests.get(token).resolve(data);
                this.pendingRequests.delete(token);
            }
        }
        else if (content.startsWith('^error')) {
            const data = this.parseMIData(content.substring(6));
            if (token && this.pendingRequests.has(token)) {
                this.pendingRequests.get(token).reject(new Error(data.msg || 'GDB error'));
                this.pendingRequests.delete(token);
            }
            this.emit('error', data.msg || 'GDB error');
        }

        // Async records (*stopped, *running) - these usually don't have tokens of their own
        else if (content.startsWith('*stopped')) {
            this.isPaused = true;
            const data = this.parseMIData(content.substring(8));
            this.currentLine = parseInt(data.line) || 0;
            this.currentFile = data.file || data.fullname;
            this.emit('stopped', {
                reason: data.reason,
                line: this.currentLine,
                file: this.currentFile,
                frame: data.frame
            });

            // Auto-fetch state unless we exited
            if (data.reason !== 'exited-normally' && data.reason !== 'exited') {
                this.getPointerState();
            }
        }
        else if (content.startsWith('*running')) {
            this.isPaused = false;
            this.emit('running');
        }
        else if (content.startsWith('^exit')) {
            if (token && this.pendingRequests.has(token)) {
                this.pendingRequests.get(token).resolve();
                this.pendingRequests.delete(token);
            }
            this.isRunning = false;
            this.emit('exit', 0);
        }

        // Output handling
        if (content.startsWith('~')) {
            const output = content.substring(1).replace(/^"|"$/g, '').replace(/\\n/g, '\n');
            this.emit('console-output', output); // GDB Console
        }
        else if (content.startsWith('@')) {
            const output = content.substring(1).replace(/^"|"$/g, '').replace(/\\n/g, '\n');
            this.emit('target-output', output); // Program stdout
        }
        else if (content.startsWith('&')) {
            const output = content.substring(1).replace(/^"|"$/g, '').replace(/\\n/g, '\n');
            this.emit('log-output', output); // GDB Log
        }
    }

    /**
     * Parse MI data
     */
    parseMIData(str) {
        const result = {};
        if (!str || !str.startsWith(',')) return result;
        str = str.substring(1);

        const regex = /(\w+)=(?:"([^"\\]*(?:\\.[^"\\]*)*)"|{([^}]*)}|\[([^\]]*)\])/g;
        let match;
        while ((match = regex.exec(str)) !== null) {
            const key = match[1];
            const value = match[2] || match[3] || match[4] || '';
            result[key] = value;
        }
        return result;
    }

    parseLocals(localsStr) {
        const locals = [];
        const varRegex = /\{name="([^"]+)",(?:type="([^"]+)",)?value="([^"]*)"\}/g;
        let match;
        while ((match = varRegex.exec(localsStr)) !== null) {
            const variable = {
                name: match[1],
                type: match[2] || 'unknown',
                value: match[3]
            };
            // Initial pointer guess
            if (variable.type.includes('*') || variable.value.startsWith('0x')) {
                variable.isPointer = true;
            }
            locals.push(variable);
        }
        return locals;
    }

    parseStack(stackStr) {
        const frames = [];
        const frameRegex = /frame=\{([^}]+)\}/g;
        let match;
        while ((match = frameRegex.exec(stackStr)) !== null) {
            const frameData = this.parseMIData(',' + match[1]);
            frames.push({
                level: parseInt(frameData.level) || 0,
                func: frameData.func,
                file: frameData.file,
                line: parseInt(frameData.line) || 0
            });
        }
        return frames;
    }

    toWslPath(winPath) {
        return winPath
            .replace(/\\/g, '/')
            .replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
    }
}

module.exports = GDBController;
