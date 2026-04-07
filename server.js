/**
 * C Pointer Visualizer - Backend Server
 * Uses GCC via WSL for accurate C code analysis
 */

const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { GimpleParser } = require('./gcc-parser');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Temp directory for C files
const TEMP_DIR = '/tmp/c-visualizer';

/**
 * Initialize temp directory in WSL
 */
function initTempDir() {
    return new Promise((resolve, reject) => {
        exec(`wsl mkdir -p ${TEMP_DIR}`, (error) => {
            if (error) {
                console.warn('Could not create temp dir, will try on each request');
            }
            resolve();
        });
    });
}

/**
 * Write C code to temp file (Windows path, accessible from WSL)
 */
function writeTempFile(code, filename = 'code.c') {
    return new Promise((resolve, reject) => {
        // Write to Windows temp directory
        const os = require('os');
        const tempDir = path.join(os.tmpdir(), 'c-visualizer');

        // Ensure temp dir exists
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const winPath = path.join(tempDir, filename);

        try {
            fs.writeFileSync(winPath, code, 'utf8');

            // Convert Windows path to WSL path
            exec(`wsl wslpath -u "${winPath.replace(/\\/g, '/')}"`, (error, stdout, stderr) => {
                if (error) {
                    // Fallback: construct WSL path manually
                    // C:\Users\... -> /mnt/c/Users/...
                    const wslPath = '/mnt/' + winPath.charAt(0).toLowerCase() + winPath.slice(2).replace(/\\/g, '/');
                    resolve(wslPath);
                } else {
                    resolve(stdout.trim());
                }
            });
        } catch (err) {
            reject(new Error(`Failed to write temp file: ${err.message}`));
        }
    });
}

/**
 * Run GCC with GIMPLE dump
 */
function runGccAnalysis(wslFilePath) {
    return new Promise((resolve, reject) => {
        // The gimple file is created in current directory with pattern: code.c.006t.gimple
        // We need to run from the directory containing the file
        const dir = wslFilePath.substring(0, wslFilePath.lastIndexOf('/'));
        const filename = wslFilePath.substring(wslFilePath.lastIndexOf('/') + 1);

        // Build command: cd to dir, compile, then find gimple file
        const cmd = `wsl bash -c "cd '${dir}' && gcc -fdump-tree-gimple -c '${filename}' 2>&1; find . -name '*.gimple' -type f 2>/dev/null | head -1 | xargs cat 2>/dev/null"`;

        console.log('Running GCC command:', cmd);

        exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
            console.log('GCC stdout:', stdout.substring(0, 500));
            console.log('GCC stderr:', stderr);

            // Check if we got gimple output (should contain function definitions)
            if (stdout.includes('gimple') || stdout.includes('()') || stdout.includes('{')) {
                // Filter out any error lines, keep only gimple content
                const lines = stdout.split('\n');
                const gimpleStart = lines.findIndex(l => l.includes('()') || l.match(/^\w+\s*\(/));
                if (gimpleStart >= 0) {
                    resolve(lines.slice(gimpleStart).join('\n'));
                } else {
                    resolve(stdout);
                }
            } else if (stdout.trim() === '' || stdout.includes('error:')) {
                reject(new Error('GCC did not produce GIMPLE output. Code may have errors.'));
            } else {
                resolve(stdout);
            }
        });
    });
}

/**
 * Clean up temp files
 */
function cleanupTempFiles() {
    exec(`wsl rm -rf ${TEMP_DIR}/*`, () => { });
}

/**
 * Fallback parser for when GCC fails
 * Uses simple regex-based parsing
 */
function fallbackParse(code) {
    const parser = new GimpleParser();
    const lines = code.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

        // Parse declarations: int x = 5; or int *p = &x;
        const declMatch = trimmed.match(/^(\w+)\s*(\*+)?\s*(\w+)\s*(?:\[(\d+)\])?\s*(?:=\s*(.+))?\s*;$/);
        if (declMatch) {
            const [, type, ptr, name, arraySize, init] = declMatch;
            const pointerLevel = ptr ? ptr.length : 0;

            if (arraySize) {
                parser.addArray(name, type, parseInt(arraySize));
                // Parse array init values
                if (init && init.includes('{')) {
                    const values = init.match(/\d+/g) || [];
                    values.forEach((val, idx) => {
                        const elemName = `${name}[${idx}]`;
                        parser.updateValue(elemName, val);
                    });
                }
            } else {
                parser.addVariable(name, type, pointerLevel);
                if (init) {
                    if (init.startsWith('&')) {
                        const target = init.slice(1).trim();
                        parser.addRelationship(name, target);
                    } else if (!isNaN(init)) {
                        parser.updateValue(name, init);
                    }
                }
            }
        }

        // Parse struct definitions
        const structMatch = trimmed.match(/^struct\s+(\w+)\s+(\**)(\w+)\s*;$/);
        if (structMatch) {
            const [, structType, ptr, name] = structMatch;
            parser.addVariable(name, `struct ${structType}`, ptr ? ptr.length : 0);
        }

        // Parse member assignments: node1.next = &node2;
        const memberMatch = trimmed.match(/^(\w+)\.(\w+)\s*=\s*&(\w+)\s*;$/);
        if (memberMatch) {
            const [, obj, member, target] = memberMatch;
            parser.addRelationship(obj, target, member);
        }
    }

    return {
        variables: parser.variables,
        relationships: parser.relationships,
        method: 'fallback'
    };
}

/**
 * Main analysis endpoint
 */
app.post('/analyze', async (req, res) => {
    const { code, mode = 'auto' } = req.body;

    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'No code provided' });
    }

    if (mode === 'fallback') {
        try {
            const result = fallbackParse(code);
            return res.json(result);
        } catch (fallbackError) {
            return res.status(500).json({
                error: 'Fallback analysis failed',
                details: fallbackError.message
            });
        }
    }

    try {
        const filePath = await writeTempFile(code);
        const gimpleOutput = await runGccAnalysis(filePath);

        const parser = new GimpleParser();
        const result = parser.parse(gimpleOutput);
        result.method = 'gcc';

        cleanupTempFiles();
        res.json(result);

    } catch (gccError) {
        if (mode === 'gimple') {
            return res.status(500).json({
                error: 'GCC/GIMPLE analysis failed',
                details: gccError.message
            });
        }

        console.log('GCC analysis failed, using fallback:', gccError.message);

        // Use fallback parser
        try {
            const result = fallbackParse(code);
            res.json(result);
        } catch (fallbackError) {
            res.status(500).json({
                error: 'Analysis failed',
                details: fallbackError.message
            });
        }
    }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', port: PORT });
});

/**
 * Check GCC availability
 */
app.get('/check-gcc', (req, res) => {
    exec('wsl gcc --version', (error, stdout, stderr) => {
        if (error) {
            res.json({ available: false, error: stderr });
        } else {
            const version = stdout.split('\n')[0];
            res.json({ available: true, version });
        }
    });
});

/**
 * Check GDB availability
 */
app.get('/check-gdb', (req, res) => {
    exec('wsl gdb --version', (error, stdout, stderr) => {
        if (error) {
            res.json({ available: false, error: stderr });
        } else {
            const version = stdout.split('\n')[0];
            res.json({ available: true, version });
        }
    });
});

// Start server with WebSocket support
const http = require('http');
const WebSocket = require('ws');
const GDBController = require('./gdb-controller');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Active debug sessions
const debugSessions = new Map();

wss.on('connection', (ws) => {
    console.log('✓ Debug client connected');

    let gdb = new GDBController();
    const sessionId = Date.now().toString();
    debugSessions.set(sessionId, { ws, gdb });

    // Send session ID to client
    ws.send(JSON.stringify({ type: 'connected', sessionId }));

    // Forward GDB events to client
    gdb.on('stopped', (data) => {
        ws.send(JSON.stringify({ type: 'stopped', ...data }));
    });

    gdb.on('running', () => {
        ws.send(JSON.stringify({ type: 'running' }));
    });

    gdb.on('locals', (locals) => {
        ws.send(JSON.stringify({ type: 'locals', locals }));
    });

    gdb.on('stack', (stack) => {
        ws.send(JSON.stringify({ type: 'stack', stack }));
    });

    // Event listeners for specific output types
    gdb.on('console-output', (output) => {
        ws.send(JSON.stringify({ type: 'output', subtype: 'console', output }));
    });

    gdb.on('target-output', (output) => {
        ws.send(JSON.stringify({ type: 'output', subtype: 'target', output }));
    });

    gdb.on('log-output', (output) => {
        ws.send(JSON.stringify({ type: 'output', subtype: 'log', output }));
    });

    gdb.on('error', (error) => {
        ws.send(JSON.stringify({ type: 'error', error }));
    });

    gdb.on('exit', (code) => {
        ws.send(JSON.stringify({ type: 'exit', code }));
    });

    // Handle commands from client
    ws.on('message', async (message) => {
        try {
            const cmd = JSON.parse(message);
            console.log('[WS] Command:', cmd.action);

            switch (cmd.action) {
                case 'compile':
                    gdb.compile(cmd.code).then(result => {
                        ws.send(JSON.stringify({
                            type: 'compiled',
                            gimple: result.gimple
                        }));
                    }).catch(err => {
                        ws.send(JSON.stringify({ type: 'error', error: err.message }));
                    });
                    break;

                case 'start':
                    try {
                        await gdb.start();
                        ws.send(JSON.stringify({ type: 'started' }));
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'error', error: err.message }));
                    }
                    break;

                case 'run':
                    gdb.run();
                    break;

                case 'next':
                    gdb.next();
                    break;

                case 'step':
                    gdb.stepInto();
                    break;

                case 'continue':
                    gdb.continue();
                    break;

                case 'stop':
                    gdb.stop();
                    ws.send(JSON.stringify({ type: 'stopped', reason: 'user' }));
                    break;

                case 'evaluate':
                    gdb.evaluate(cmd.expr);
                    break;

                case 'addBreakpoint':
                    gdb.addBreakpoint(cmd.line);
                    break;

                case 'removeBreakpoint':
                    gdb.removeBreakpoint(cmd.line);
                    break;

                default:
                    ws.send(JSON.stringify({ type: 'error', error: `Unknown action: ${cmd.action}` }));
            }
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
    });

    ws.on('close', () => {
        console.log('Debug client disconnected');
        gdb.stop();
        debugSessions.delete(sessionId);
    });
});

// Start server
initTempDir().then(() => {
    server.listen(PORT, () => {
        console.log(`✓ C Pointer Visualizer server running on http://localhost:${PORT}`);
        console.log(`✓ WebSocket debug server ready`);
        console.log(`✓ Using GCC/GDB via WSL`);
    });
});
