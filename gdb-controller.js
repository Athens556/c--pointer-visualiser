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
        this.currentFrameArgs = [];
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
            this.pendingRequests.set(token, { resolve, reject, emitError: true });
            this.sendCommand(`${token}${cmd}`);
        });
    }

    requestQuiet(cmd) {
        return new Promise((resolve, reject) => {
            const token = ++this.tokenCounter;
            this.pendingRequests.set(token, { resolve, reject, emitError: false });
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
            const args = await this.getFrameArguments();
            const variables = this.mergeVariables(args, locals);
            await this.hydrateStructValues(variables);
            const chainVariables = await this.buildStructChainVariables(variables);
            const expandedVariables = this.mergeVariables(variables, chainVariables);
            const dereferencedVariables = await this.buildDereferencedVariables(expandedVariables);
            const allVariables = this.mergeVariables(expandedVariables, dereferencedVariables);

            // Enrich with addresses
            for (const local of allVariables) {
                // Get address of variable: &name
                if (local.isDerivedDereference) {
                    local.address = this.normalizeAddress(local.sourcePointerValue);
                    continue;
                }

                try {
                    const addrRes = await this.requestQuiet(`-data-evaluate-expression "&${local.name}"`);
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

            this.emit('locals', allVariables);
            return allVariables;
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

    async getFrameArguments() {
        try {
            const res = await this.requestQuiet('-stack-list-arguments 2 0 0');
            const args = this.parseStackArguments(res['stack-args']);
            if (args.length > 0) {
                this.currentFrameArgs = args;
            }
            return args;
        } catch (e) {
            return this.currentFrameArgs || [];
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
                const pending = this.pendingRequests.get(token);
                pending.reject(new Error(data.msg || 'GDB error'));
                this.pendingRequests.delete(token);
                if (pending.emitError !== false) {
                    this.emit('error', data.msg || 'GDB error');
                }
            } else {
                this.emit('error', data.msg || 'GDB error');
            }
        }

        // Async records (*stopped, *running) - these usually don't have tokens of their own
        else if (content.startsWith('*stopped')) {
            this.isPaused = true;
            const data = this.parseMIData(content.substring(8));
            const frame = this.parseStoppedFrame(content);
            this.currentFrameArgs = this.parseArgs(frame.args, frame.level);
            this.currentLine = parseInt(frame.line || data.line) || 0;
            this.currentFile = frame.fullname || frame.file || data.fullname || data.file;
            this.emit('stopped', {
                reason: data.reason,
                line: this.currentLine,
                file: this.currentFile,
                frame
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
        const input = str.substring(1);
        let i = 0;

        while (i < input.length) {
            while (i < input.length && (input[i] === ',' || /\s/.test(input[i]))) i++;
            if (i >= input.length) break;

            let keyStart = i;
            while (i < input.length && /[\w-]/.test(input[i])) i++;
            const key = input.slice(keyStart, i);
            if (!key || input[i] !== '=') {
                while (i < input.length && input[i] !== ',') i++;
                continue;
            }

            i++; // skip '='
            const { value, nextIndex } = this.readMIValue(input, i);
            result[key] = value;
            i = nextIndex;
        }

        return result;
    }

    readMIValue(input, startIndex) {
        if (startIndex >= input.length) {
            return { value: '', nextIndex: startIndex };
        }

        const opener = input[startIndex];
        if (opener === '"') {
            let i = startIndex + 1;
            let value = '';
            while (i < input.length) {
                const ch = input[i];
                if (ch === '\\' && i + 1 < input.length) {
                    value += ch + input[i + 1];
                    i += 2;
                    continue;
                }
                if (ch === '"') {
                    return { value, nextIndex: i + 1 };
                }
                value += ch;
                i++;
            }
            return { value, nextIndex: i };
        }

        if (opener === '{' || opener === '[') {
            const closer = opener === '{' ? '}' : ']';
            let depth = 1;
            let i = startIndex + 1;
            let value = '';
            while (i < input.length && depth > 0) {
                const ch = input[i];
                if (ch === '\\' && i + 1 < input.length) {
                    value += ch + input[i + 1];
                    i += 2;
                    continue;
                }
                if (ch === '"') {
                    const quoted = this.readMIValue(input, i);
                    value += `"${quoted.value}"`;
                    i = quoted.nextIndex;
                    continue;
                }
                if (ch === opener) depth++;
                if (ch === closer) depth--;
                if (depth > 0) value += ch;
                i++;
            }
            return { value, nextIndex: i };
        }

        let i = startIndex;
        let value = '';
        while (i < input.length && input[i] !== ',') {
            value += input[i];
            i++;
        }
        return { value: value.trim(), nextIndex: i };
    }

    parseStoppedFrame(content) {
        const match = content.match(/frame=\{([\s\S]*?)\},thread-id=/);
        if (!match) return {};

        const frameStr = match[1];
        return {
            level: this.extractField(frameStr, 'level'),
            func: this.extractField(frameStr, 'func'),
            file: this.extractField(frameStr, 'file'),
            fullname: this.extractField(frameStr, 'fullname'),
            line: this.extractField(frameStr, 'line'),
            addr: this.extractField(frameStr, 'addr'),
            arch: this.extractField(frameStr, 'arch'),
            args: this.extractListField(frameStr, 'args')
        };
    }

    extractField(source, key) {
        const match = source.match(new RegExp(`${key}="([^"]*)"`, 'i'));
        return match ? match[1] : '';
    }

    extractListField(source, key) {
        const prefix = `${key}=[`;
        const start = source.indexOf(prefix);
        if (start === -1) return '';

        let i = start + prefix.length;
        let depth = 1;
        let result = '';

        while (i < source.length && depth > 0) {
            const ch = source[i];
            if (ch === '[') depth++;
            if (ch === ']') depth--;
            if (depth > 0) result += ch;
            i++;
        }

        return result;
    }

    parseLocals(localsStr) {
        const locals = [];
        const varRegex = /\{name="([^"]+)"(?:,type="([^"]+)")?(?:,value="([^"]*)")?\}/g;
        let match;
        while ((match = varRegex.exec(localsStr)) !== null) {
            const variable = {
                name: match[1],
                type: match[2] || 'unknown',
                value: match[3] ?? '(unavailable)'
            };
            // Initial pointer guess
            if (variable.type.includes('*') || variable.value.startsWith('0x')) {
                variable.isPointer = true;
            }
            locals.push(variable);
        }
        return locals;
    }

    parseArgs(argsStr, frameLevel = 0) {
        if (!argsStr) return [];

        const args = [];
        const argRegex = /\{name="([^"]+)"(?:,type="([^"]+)")?(?:,value="([^"]*)")?\}/g;
        let match;

        while ((match = argRegex.exec(argsStr)) !== null) {
            const value = match[3] ?? '(unavailable)';
            args.push({
                name: match[1],
                type: match[2] || 'parameter',
                value,
                isPointer: value.startsWith('0x') && value !== '0x0',
                isParameter: true,
                frameLevel: parseInt(frameLevel) || 0
            });
        }

        return args;
    }

    async buildDereferencedVariables(variables) {
        const derived = [];

        for (const variable of variables) {
            const pointerLevel = this.getPointerLevel(variable.type);
            if (pointerLevel <= 0) continue;

            const displayName = variable.name.startsWith('*') ? variable.name : `*${variable.name}`;
            let value = '(unavailable)';

            try {
                const res = await this.requestQuiet(`-data-evaluate-expression "*(${variable.name})"`);
                value = res.value ?? '(unavailable)';
            } catch (e) {
                value = '(unavailable)';
            }

            derived.push({
                name: displayName,
                type: this.stripOnePointerLevel(variable.type),
                value,
                isPointer: pointerLevel > 1 || (typeof value === 'string' && value.startsWith('0x') && value !== '0x0'),
                isDerivedDereference: true,
                sourceName: variable.name,
                sourcePointerValue: variable.value,
                derivedDepth: (variable.derivedDepth || 0) + 1
            });
        }

        return derived;
    }

    async hydrateStructValues(variables) {
        for (const variable of variables) {
            if (!variable.type?.includes('struct')) continue;
            if (variable.value && variable.value !== '(unavailable)') continue;

            const value = await this.safeEvaluate(variable.name);
            if (value) {
                variable.value = value;
            }
        }
    }

    async buildStructChainVariables(variables) {
        const derived = [];
        const visitedAddresses = new Set();

        for (const variable of variables) {
            if (!variable.type?.includes('struct') || this.getPointerLevel(variable.type) <= 0) {
                continue;
            }

            let expr = variable.name;
            let exprType = variable.type;
            let depth = 1;

            while (depth <= 8) {
                const derefValue = await this.safeEvaluate(`*(${expr})`);
                if (!derefValue || !derefValue.startsWith('{')) break;

                const fields = this.parseStructFields(derefValue);
                if (fields.length === 0) break;

                let nextExpr = null;
                let nextPointerType = this.stripOnePointerLevel(exprType);

                for (const field of fields) {
                    const fieldExpr = `${expr}->${field.name}`;
                    const fieldType = this.inferFieldType(field.value, nextPointerType);
                    derived.push({
                        name: fieldExpr,
                        type: fieldType,
                        value: field.value,
                        isPointer: this.looksLikePointer(field.value),
                        isDerivedDereference: true,
                        sourceName: expr,
                        sourcePointerValue: field.value,
                        derivedDepth: depth
                    });

                    if (!nextExpr && this.looksLikePointer(field.value) && field.value !== '0x0') {
                        nextExpr = fieldExpr;
                    }
                }

                if (!nextExpr) break;

                const nextAddressValue = derived.find(item => item.name === nextExpr)?.value;
                const normalizedAddress = this.normalizeAddress(nextAddressValue);
                if (!normalizedAddress || visitedAddresses.has(normalizedAddress)) break;

                visitedAddresses.add(normalizedAddress);
                expr = nextExpr;
                exprType = nextPointerType;
                depth++;
            }
        }

        return derived;
    }

    getPointerLevel(type = '') {
        return (type.match(/\*/g) || []).length;
    }

    stripOnePointerLevel(type = '') {
        return type.replace(/\s*\*$/, '').trim() || type;
    }

    normalizeAddress(value) {
        if (!value || typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed.startsWith('0x')) return null;
        return trimmed.split(' ')[0];
    }

    looksLikePointer(value) {
        return typeof value === 'string' && value.trim().startsWith('0x');
    }

    async safeEvaluate(expr) {
        try {
            const res = await this.requestQuiet(`-data-evaluate-expression "${expr}"`);
            return res.value ?? '';
        } catch (e) {
            return '';
        }
    }

    parseStructFields(structValue) {
        const trimmed = (structValue || '').trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];

        const inner = trimmed.slice(1, -1);
        const fields = [];
        let current = '';
        let braceDepth = 0;

        for (let i = 0; i < inner.length; i++) {
            const ch = inner[i];
            if (ch === '{') braceDepth++;
            if (ch === '}') braceDepth--;

            if (ch === ',' && braceDepth === 0) {
                if (current.trim()) fields.push(current.trim());
                current = '';
                continue;
            }

            current += ch;
        }

        if (current.trim()) fields.push(current.trim());

        return fields.map((field) => {
            const parts = field.split(/\s*=\s*/);
            return {
                name: parts[0]?.trim(),
                value: parts.slice(1).join(' = ').trim()
            };
        }).filter(field => field.name);
    }

    inferFieldType(value, fallbackStructType) {
        if (this.looksLikePointer(value)) {
            return `${fallbackStructType} *`;
        }
        if (/^-?\d+$/.test(value)) {
            return 'int';
        }
        if (value.startsWith('{')) {
            return fallbackStructType;
        }
        return 'field';
    }

    parseStackArguments(stackArgsStr) {
        if (!stackArgsStr) return [];

        const frameMatch = stackArgsStr.match(/frame=\{[^]*?args=\[([\s\S]*)\]\s*\}?$/);
        if (!frameMatch) return [];

        return this.parseArgs(frameMatch[1], 0);
    }

    mergeVariables(args, locals) {
        const merged = [];
        const seen = new Set();

        for (const variable of [...(args || []), ...(locals || [])]) {
            if (!variable?.name || seen.has(variable.name)) continue;
            seen.add(variable.name);
            merged.push(variable);
        }

        return merged;
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
