/**
 * Debugger UI - Frontend WebSocket client for GDB debugging
 * Handles debug controls and live visualization updates
 */

class DebuggerUI {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isDebugging = false;
        this.isPaused = false;
        this.currentLine = 0;
        this.breakpoints = new Set();
        this.locals = [];
        this.stack = [];

        // DOM Elements
        this.debugBtn = document.getElementById('debug-btn');
        this.debugToolbar = document.getElementById('debug-toolbar');
        this.debugStatus = document.getElementById('debug-status');
        this.debugLocation = document.getElementById('debug-location');
        this.variablesPanel = document.getElementById('variables-panel');
        this.stackFrames = document.getElementById('stack-frames');
        this.localsTable = document.getElementById('locals-table')?.querySelector('tbody');
        this.programOutput = document.getElementById('program-output');
        this.gdbLog = document.getElementById('gdb-log');
        this.gimpleContent = document.getElementById('gimple-content');

        // Tab elements
        this.tabs = document.querySelectorAll('.tab-btn');
        this.tabContents = document.querySelectorAll('.tab-content');

        // Debug buttons
        this.runBtn = document.getElementById('debug-run');
        this.nextBtn = document.getElementById('debug-next');
        this.stepBtn = document.getElementById('debug-step');
        this.continueBtn = document.getElementById('debug-continue');
        this.stopBtn = document.getElementById('debug-stop');
        this.closeVariables = document.getElementById('close-variables');

        // Code input for sending to compiler
        this.codeInput = document.getElementById('code-input');

        this.init();
    }

    init() {
        // Debug button starts a debug session
        this.debugBtn?.addEventListener('click', () => this.startDebugSession());

        // Debug control buttons
        this.runBtn?.addEventListener('click', () => this.send({ action: 'run' }));
        this.nextBtn?.addEventListener('click', () => this.send({ action: 'next' }));
        this.stepBtn?.addEventListener('click', () => this.send({ action: 'step' }));
        this.continueBtn?.addEventListener('click', () => this.send({ action: 'continue' }));
        this.stopBtn?.addEventListener('click', () => this.stopDebugSession());
        this.closeVariables?.addEventListener('click', () => this.hideVariablesPanel());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (!this.isDebugging) return;

            switch (e.key) {
                case 'F5':
                    e.preventDefault();
                    if (this.isPaused) {
                        this.send({ action: 'continue' });
                    } else {
                        this.send({ action: 'run' });
                    }
                    break;
                case 'F10':
                    e.preventDefault();
                    this.send({ action: 'next' });
                    break;
                case 'F11':
                    e.preventDefault();
                    this.send({ action: 'step' });
                    break;
                case 'F8':
                    e.preventDefault();
                    this.send({ action: 'continue' });
                    break;
            }
        });

        // Tab switching
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;

                // Update buttons
                this.tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Update content
                this.tabContents.forEach(c => c.classList.remove('active'));
                document.getElementById(`tab-${target}`).classList.add('active');
            });
        });
    }

    /**
     * Start a new debug session
     */
    async startDebugSession() {
        const code = this.codeInput?.value?.trim();
        if (!code) {
            alert('Please enter some C code to debug');
            return;
        }

        // Show debug UI
        this.debugToolbar.style.display = 'block';
        this.variablesPanel.style.display = 'block';
        this.setStatus('🟡 Connecting...', 'Connecting to debug server');

        try {
            // Connect WebSocket
            await this.connect();

            // Compile the code
            this.setStatus('🟡 Compiling...', 'Compiling with debug symbols');
            this.send({ action: 'compile', code });

        } catch (error) {
            this.setStatus('🔴 Error', error.message);
            console.error('Debug session error:', error);
        }
    }

    /**
     * Connect to WebSocket server
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//localhost:3001`;

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('✓ WebSocket connected');
                this.isConnected = true;
                resolve();
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(new Error('Failed to connect to debug server'));
            };

            this.ws.onclose = () => {
                console.log('WebSocket closed');
                this.isConnected = false;
                this.isDebugging = false;
                this.updateButtons();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };
        });
    }

    /**
     * Handle messages from server
     */
    handleMessage(msg) {
        console.log('[Debug]', msg.type, msg);

        switch (msg.type) {
            case 'connected':
                console.log('Session ID:', msg.sessionId);
                break;

            case 'compiled':
                this.setStatus('🟡 Starting...', 'Starting GDB');
                this.programOutput.textContent = '';
                this.gdbLog.textContent = '';
                if (msg.gimple) {
                    this.gimpleContent.textContent = msg.gimple;
                } else {
                    this.gimpleContent.textContent = '// No GIMPLE generated';
                }

                // Send cached breakpoints
                for (const line of this.breakpoints) {
                    this.send({ action: 'addBreakpoint', line });
                }
                this.send({ action: 'start' });
                break;

            case 'started':
                this.isDebugging = true;
                this.setStatus('🟢 Ready', 'Click Run to start');
                this.updateButtons();
                break;

            case 'running':
                this.isPaused = false;
                this.setStatus('🟢 Running', 'Program is running...');
                this.updateButtons();
                break;

            case 'stopped':
                this.isPaused = true;
                this.currentLine = msg.line || 0;

                // Check if we are in user code
                // msg.file might be 'debug_prog.c' or absolute path
                const isUserCode = msg.file && (msg.file.includes('debug_prog.c') || msg.file.endsWith('.c'));

                if (isUserCode) {
                    const location = msg.file ? `Line ${msg.line}` : `Line ${msg.line}`;
                    this.setStatus('🟡 Paused', `Stopped at ${location}`);
                    this.highlightLine(msg.line);
                } else {
                    // System code (libc, etc)
                    this.setStatus('🟡 Paused (System)', `In ${msg.frame?.func || 'system code'} (${msg.file || 'unknown'})`);
                    this.clearHighlight(); // Remove highlight from user code
                }

                this.updateButtons();

                if (msg.reason === 'exited-normally') {
                    this.setStatus('⚫ Finished', 'Program exited normally');
                    this.isDebugging = false;
                    this.updateButtons();
                    this.clearHighlight();
                }
                break;

            case 'locals':
                this.locals = msg.locals || [];
                this.renderLocals();
                this.updateDiagram();
                break;

            case 'stack':
                this.stack = msg.stack || [];
                this.renderStack();
                break;

            case 'output':
                if (msg.subtype === 'console') {
                    // console output ~
                    this.gdbLog.textContent += msg.output + '\n';
                    this.gdbLog.scrollTop = this.gdbLog.scrollHeight;
                    if (this.looksLikeProgramOutput(msg.output)) {
                        this.appendOutput(msg.output.endsWith('\n') ? msg.output : msg.output + '\n');
                    }
                } else if (msg.subtype === 'target') {
                    // @ target output
                    this.appendOutput(msg.output);
                } else if (msg.subtype === 'log') {
                    // & log output
                    this.gdbLog.textContent += '[LOG] ' + msg.output + '\n';
                    this.gdbLog.scrollTop = this.gdbLog.scrollHeight;
                } else {
                    // Fallback
                    this.programOutput.textContent += msg.output;
                }
                break;

            case 'error':
                console.error('Debug error:', msg.error);
                this.setStatus('🔴 Error', msg.error);
                break;

            case 'exit':
                this.isDebugging = false;
                this.isPaused = false;
                this.setStatus('⚫ Stopped', 'Debug session ended');
                this.updateButtons();
                break;
        }
    }

    /**
     * Send message to server
     */
    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    /**
     * Stop debug session
     */
    stopDebugSession() {
        this.send({ action: 'stop' });
        this.isDebugging = false;
        this.isPaused = false;
        this.setStatus('⚫ Stopped', 'Debug session ended');
        this.updateButtons();
        this.clearHighlight();
    }

    /**
     * Update button states
     */
    updateButtons() {
        const canRun = this.isDebugging && !this.isPaused;
        const canStep = this.isDebugging && this.isPaused;
        const canStop = this.isDebugging;

        this.runBtn.disabled = canRun;
        this.nextBtn.disabled = !canStep;
        this.stepBtn.disabled = !canStep;
        this.continueBtn.disabled = !canStep;
        this.stopBtn.disabled = !canStop;
    }

    /**
     * Set status display
     */
    setStatus(status, location) {
        if (this.debugStatus) this.debugStatus.textContent = status;
        if (this.debugLocation) this.debugLocation.textContent = `📍 ${location}`;
    }

    /**
     * Render local variables
     */
    renderLocals() {
        if (!this.localsTable) return;

        this.localsTable.innerHTML = '';

        const baseLocals = this.locals.filter(local => !local.isDerivedDereference);
        const derivedBySource = new Map();

        for (const local of this.locals.filter(local => local.isDerivedDereference)) {
            const sourceName = local.sourceName || '';
            if (!derivedBySource.has(sourceName)) {
                derivedBySource.set(sourceName, []);
            }
            derivedBySource.get(sourceName).push(local);
        }

        const orderedLocals = [];
        const appendWithChildren = (local) => {
            orderedLocals.push(local);
            const derived = derivedBySource.get(local.name) || [];
            for (const child of derived) {
                appendWithChildren(child);
            }
        };

        for (const local of baseLocals) {
            appendWithChildren(local);
        }

        for (const local of orderedLocals) {
            const row = document.createElement('tr');

            // Highlight pointers
            const isPointer = local.isPointer || local.type?.includes('*');
            if (isPointer) row.classList.add('pointer-var');
            if (local.isDerivedDereference) row.classList.add('derived-var');

            row.innerHTML = `
                <td class="var-name">${local.name}</td>
                <td class="var-type">${local.type || 'unknown'}</td>
                <td class="var-value">${local.value}</td>
            `;

            if (local.isDerivedDereference) {
                const nameCell = row.querySelector('.var-name');
                if (nameCell) {
                    const depth = Math.max(1, local.derivedDepth || 1);
                    nameCell.style.paddingLeft = `${18 + (depth - 1) * 14}px`;
                }
            }

            this.localsTable.appendChild(row);
        }
    }

    /**
     * Render stack frames
     */
    renderStack() {
        if (!this.stackFrames) return;

        this.stackFrames.innerHTML = '';

        for (const frame of this.stack) {
            const div = document.createElement('div');
            div.className = 'stack-frame';
            div.innerHTML = `
                <span class="frame-level">#${frame.level}</span>
                <span class="frame-func">${frame.func || 'unknown'}</span>
                <span class="frame-location">${frame.file || ''}:${frame.line || ''}</span>
            `;
            this.stackFrames.appendChild(div);
        }
    }

    /**
     * Append to program output
     */
    appendOutput(text) {
        if (this.programOutput) {
            this.programOutput.textContent += text;
            this.programOutput.scrollTop = this.programOutput.scrollHeight;
        }
    }

    looksLikeProgramOutput(text) {
        const rawText = text || '';
        const trimmed = rawText.trim();
        if (!trimmed) return false;

        const gdbNoisePrefixes = [
            'Reading symbols from',
            'Breakpoint ',
            'Using host libthread_db',
            '[Thread debugging',
            '[Inferior ',
            'Warning:',
            'Program received signal'
        ];

        if (gdbNoisePrefixes.some(prefix => trimmed.startsWith(prefix))) {
            return false;
        }

        if (/(?:^|\n)\d+\t/.test(rawText)) return false;
        if (/(?:^|\n)\d+\s+/.test(rawText) && rawText.includes('{')) return false;
        if (trimmed === '(gdb)') return false;

        return true;
    }

    /**
     * Highlight current line in editor
     */
    /**
     * Highlight current line in editor
     */
    highlightLine(lineNumber) {
        window.codeEditorBridge?.highlightLine(lineNumber);
    }

    /**
     * Clear line highlight
     */
    clearHighlight() {
        window.codeEditorBridge?.clearHighlight();
    }

    /**
     * Update diagram with current variable state
     */
    updateDiagram() {
        const toDebuggerValue = (local) => {
            const rawValue = typeof local.value === 'string' ? local.value.trim() : String(local.value ?? '');

            if (!rawValue || rawValue === '(unavailable)') {
                return { type: 'literal', value: rawValue || '(unavailable)' };
            }

            if (rawValue === '0x0' || rawValue === 'NULL') {
                return { type: 'null', value: 'NULL' };
            }

            return { type: 'literal', value: rawValue };
        };

        // Convert GDB locals to analyzer format
        const variables = this.locals.map((local, index) => ({
            name: local.name,
            type: local.type === 'parameter'
                ? (local.isPointer ? 'param' : 'parameter')
                : (local.type?.replace('*', '') || 'unknown'),
            pointerLevel: local.type === 'parameter'
                ? (local.isPointer ? 1 : 0)
                : (local.type?.match(/\*/g) || []).length,
            isArray: false,
            isDerivedDereference: Boolean(local.isDerivedDereference),
            // Use real GDB address if available, otherwise simulate
            address: local.address || `0x${(0x1000 + index * 4).toString(16).toUpperCase()}`,
            value: toDebuggerValue(local)
        }));

        // Find pointer relationships
        const relationships = [];
        for (const local of this.locals) {
            if (local.isPointer && local.value && local.value.startsWith('0x')) {
                // Try to find what it points to
                // Clean up value (remove extra GDB info like <main+16>)
                const ptrValue = local.value.split(' ')[0];
                const dereferencedName = local.name.startsWith('*') ? local.name : `*${local.name}`;

                const pointsTo =
                    variables.find(v =>
                        v.name !== local.name && (
                            v.address === ptrValue ||
                            v.name === local.value.replace('&', '')
                        )
                    ) ||
                    variables.find(v => v.name === dereferencedName);

                if (pointsTo) {
                    relationships.push({
                        from: local.name,
                        to: pointsTo.name,
                        type: 'points_to',
                        label: ptrValue
                    });
                }
            }
        }

        // Re-render diagram if we have variables
        if (variables.length > 0 && window.renderer) {
            const analysis = { variables, relationships, method: 'gdb' };
            try {
                window.renderer.render(analysis);
                document.getElementById('diagram-placeholder')?.classList.add('hidden');
                document.getElementById('legend')?.classList.add('active');
            } catch (e) {
                console.error('Diagram render error:', e);
            }
        }
    }

    /**
     * Hide variables panel
     */
    hideVariablesPanel() {
        if (this.variablesPanel) {
            this.variablesPanel.style.display = 'none';
        }
    }
    /**
     * Toggle breakpoint at line
     */
    toggleBreakpoint(line) {
        if (this.breakpoints.has(line)) {
            this.breakpoints.delete(line);
            this.send({ action: 'removeBreakpoint', line });
        } else {
            this.breakpoints.add(line);
            this.send({ action: 'addBreakpoint', line });
        }
        this.renderBreakpoints();
    }

    /**
     * Render visible breakpoints
     */
    renderBreakpoints() {
        window.codeEditorBridge?.renderBreakpoints(this.breakpoints);
    }


}

// Initialize debugger UI when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.debuggerUI = new DebuggerUI();
});
