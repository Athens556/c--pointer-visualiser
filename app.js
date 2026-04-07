/**
 * Main Application Script
 * Orchestrates the tokenizer, analyzer, and renderer
 */

document.addEventListener('DOMContentLoaded', () => {
    const codeInput = document.getElementById('code-input');
    const monacoHost = document.getElementById('monaco-editor');
    const analyzeBtn = document.getElementById('analyze-btn');
    const debugBtn = document.getElementById('debug-btn');
    const clearBtn = document.getElementById('clear-btn');
    const fileUpload = document.getElementById('file-upload');
    const examplesDropdown = document.getElementById('examples-dropdown');
    const visualizationMode = document.getElementById('visualization-mode');
    const diagramCanvas = document.getElementById('diagram-canvas');
    const placeholder = document.getElementById('diagram-placeholder');
    const legend = document.getElementById('legend');
    const debugToggle = document.getElementById('debug-toggle');
    const debugPanel = document.getElementById('debug-panel');
    const tokenOutput = document.getElementById('token-output');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const resetViewBtn = document.getElementById('reset-view');

    const ANALYSIS_MODES = {
        STATIC: 'static',
        GIMPLE: 'gimple',
        GDB: 'gdb'
    };

    const tokenizer = new CTokenizer();
    const analyzer = new CPointerAnalyzer();
    const renderer = new DiagramRenderer(diagramCanvas);
    window.renderer = renderer;

    let monacoEditor = null;
    let monacoDecorations = [];
    let breakpointDecorations = [];
    let lastAnalysis = null;

    function getSelectedMode() {
        return visualizationMode?.value || ANALYSIS_MODES.STATIC;
    }

    function getCode() {
        return monacoEditor ? monacoEditor.getValue() : codeInput.value;
    }

    function setCode(value) {
        codeInput.value = value;
        if (monacoEditor && monacoEditor.getValue() !== value) {
            monacoEditor.setValue(value);
        }
    }

    function setAnalyzeButtonState(isBusy) {
        analyzeBtn.disabled = isBusy;
        if (isBusy) {
            analyzeBtn.innerHTML = '<span class="btn-icon">...</span> Working...';
            return;
        }

        if (getSelectedMode() === ANALYSIS_MODES.GDB) {
            analyzeBtn.innerHTML = '<span class="btn-icon">GDB</span> Start Debug Session';
        } else {
            analyzeBtn.innerHTML = '<span class="btn-icon">Run</span> Analyze';
        }
    }

    function syncModeUI() {
        const isGdbMode = getSelectedMode() === ANALYSIS_MODES.GDB;
        debugBtn.style.display = isGdbMode ? 'flex' : 'none';
        setAnalyzeButtonState(false);
    }

    function createEditorBridge() {
        window.codeEditorBridge = {
            getValue: () => getCode(),
            setValue: (value) => setCode(value),
            focus: () => monacoEditor?.focus(),
            highlightLine: (lineNumber) => {
                if (!monacoEditor) return;
                monacoDecorations = monacoEditor.deltaDecorations(monacoDecorations, [{
                    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                    options: {
                        isWholeLine: true,
                        className: 'monaco-current-line',
                        glyphMarginClassName: 'monaco-current-line-glyph'
                    }
                }]);
                monacoEditor.revealLineInCenter(lineNumber);
            },
            clearHighlight: () => {
                if (!monacoEditor) return;
                monacoDecorations = monacoEditor.deltaDecorations(monacoDecorations, []);
            },
            renderBreakpoints: (breakpoints) => {
                if (!monacoEditor) return;
                breakpointDecorations = monacoEditor.deltaDecorations(
                    breakpointDecorations,
                    Array.from(breakpoints || []).map(line => ({
                        range: new monaco.Range(line, 1, line, 1),
                        options: {
                            isWholeLine: true,
                            glyphMarginClassName: 'monaco-breakpoint-glyph'
                        }
                    }))
                );
            }
        };
    }

    async function initMonacoEditor() {
        await new Promise((resolve, reject) => {
            if (!window.require) {
                reject(new Error('Monaco loader not available'));
                return;
            }

            window.require.config({
                paths: {
                    vs: '/node_modules/monaco-editor/min/vs'
                }
            });

            window.require(['vs/editor/editor.main'], resolve, reject);
        });

        monacoEditor = monaco.editor.create(monacoHost, {
            value: codeInput.value,
            language: 'cpp',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: false },
            glyphMargin: true,
            roundedSelection: false,
            scrollBeyondLastLine: false,
            tabSize: 4,
            insertSpaces: true,
            fontFamily: 'JetBrains Mono',
            fontSize: 14,
            lineHeight: 24
        });

        monacoEditor.onDidChangeModelContent(() => {
            codeInput.value = monacoEditor.getValue();
        });

        monacoEditor.onMouseDown((event) => {
            if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                const lineNumber = event.target.position?.lineNumber;
                if (lineNumber) {
                    window.debuggerUI?.toggleBreakpoint(lineNumber);
                }
            }
        });

        monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            analyzeCode();
        });

        createEditorBridge();
        window.debuggerUI?.renderBreakpoints();
    }

    let treeSitterAnalyzer = null;
    let treeSitterReady = false;

    async function initTreeSitter() {
        if (treeSitterReady) return true;

        try {
            treeSitterAnalyzer = new TreeSitterAnalyzer();
            await treeSitterAnalyzer.init();
            treeSitterReady = true;
            console.log('Tree-sitter C parser ready (client-side)');
            return true;
        } catch (e) {
            console.log('Tree-sitter not available, using JavaScript fallback');
            return false;
        }
    }

    async function analyzeWithClient(code) {
        let analysis;

        // Tree-sitter and the local tokenizer/analyzer stay within the same explicit
        // client-side path instead of jumping to server-backed modes.
        if (treeSitterReady || await initTreeSitter()) {
            try {
                analysis = await treeSitterAnalyzer.analyze(code);
                tokenOutput.textContent = '// Analysis mode: static (Tree-sitter client-side)';
                console.log('Analysis via Tree-sitter (client-side)');
            } catch (e) {
                console.log('Tree-sitter analysis failed, using JavaScript fallback:', e.message);
                const tokens = tokenizer.tokenize(code);
                tokenOutput.textContent = formatTokens(tokens);
                analysis = analyzer.analyze(tokens);
            }
        } else {
            const tokens = tokenizer.tokenize(code);
            tokenOutput.textContent = formatTokens(tokens);
            analysis = analyzer.analyze(tokens);
        }

        return analysis;
    }

    async function analyzeWithGimple(code) {
        const response = await fetch('/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code, mode: ANALYSIS_MODES.GIMPLE })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.details || result.error || 'GIMPLE analysis failed');
        }

        tokenOutput.textContent = `// Analysis mode: ${result.method || 'gcc'}\n// Source: GCC/GIMPLE via WSL`;
        return result;
    }

    function renderAnalysis(analysis) {
        lastAnalysis = analysis;
        if (!analysis.variables || analysis.variables.length === 0) {
            showPlaceholder('No variables found. Try declaring some variables with pointers.');
            return;
        }

        hidePlaceholder();
        renderer.render(analysis);
        legend.classList.add('active');
    }

    async function analyzeCode() {
        const code = getCode().trim();
        const mode = getSelectedMode();

        if (!code) {
            showPlaceholder('Enter some C code to visualize');
            return;
        }

        if (mode === ANALYSIS_MODES.GDB) {
            window.debuggerUI?.startDebugSession();
            return;
        }

        setAnalyzeButtonState(true);

        try {
            const analysis = mode === ANALYSIS_MODES.GIMPLE
                ? await analyzeWithGimple(code)
                : await analyzeWithClient(code);

            renderAnalysis(analysis);

            analyzeBtn.style.transform = 'scale(0.95)';
            setTimeout(() => {
                analyzeBtn.style.transform = '';
            }, 100);
        } catch (error) {
            console.error('Analysis error:', error);
            showPlaceholder('Error analyzing code: ' + error.message);
        } finally {
            setAnalyzeButtonState(false);
        }
    }

    function formatTokens(tokens) {
        return tokens.map(t =>
            `[${t.line}:${t.column}] ${t.type.padEnd(12)} "${t.value}"`
        ).join('\n');
    }

    function showPlaceholder(message) {
        placeholder.classList.remove('hidden');
        placeholder.querySelector('p').innerHTML = message;
        diagramCanvas.classList.remove('active');
        legend.classList.remove('active');
    }

    function hidePlaceholder() {
        placeholder.classList.add('hidden');
    }

    clearBtn.addEventListener('click', () => {
        setCode('');
        renderer.clearDiagram();
        lastAnalysis = null;
        showPlaceholder('Enter C code and click <strong>Analyze</strong> to visualize pointers');
        tokenOutput.textContent = '';
    });

    fileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setCode(event.target.result);
                analyzeCode();
            };
            reader.readAsText(file);
        }
        e.target.value = '';
    });

    examplesDropdown.addEventListener('change', (e) => {
        const exampleKey = e.target.value;
        if (exampleKey && window.cExamples[exampleKey]) {
            setCode(window.cExamples[exampleKey].code);
            analyzeCode();
        }
        e.target.value = '';
    });

    debugToggle.addEventListener('click', () => {
        debugPanel.classList.toggle('expanded');
    });

    zoomInBtn.addEventListener('click', () => renderer.zoomIn());
    zoomOutBtn.addEventListener('click', () => renderer.zoomOut());
    resetViewBtn.addEventListener('click', () => renderer.resetView());

    const divider = document.querySelector('.divider');
    const codePanel = document.querySelector('.code-panel');
    const diagramPanel = document.querySelector('.diagram-panel');
    let isResizing = false;

    divider.addEventListener('mousedown', () => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const container = document.querySelector('.main-content');
        const containerRect = container.getBoundingClientRect();
        const percentage = ((e.clientX - containerRect.left) / containerRect.width) * 100;
        const clampedPercentage = Math.min(Math.max(percentage, 20), 80);

        codePanel.style.flex = `0 0 ${clampedPercentage}%`;
        diagramPanel.style.flex = `0 0 ${100 - clampedPercentage}%`;
    });

    function rerenderCurrentDiagram() {
        if (lastAnalysis) {
            renderer.render(lastAnalysis);
        }
        monacoEditor?.layout();
    }

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            rerenderCurrentDiagram();
        }
    });

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            rerenderCurrentDiagram();
        }, 250);
    });

    if (window.cExamples && window.cExamples.basic) {
        codeInput.value = window.cExamples.basic.code;
    }

    initTreeSitter();
    syncModeUI();
    analyzeBtn.addEventListener('click', () => analyzeCode());
    visualizationMode?.addEventListener('change', syncModeUI);
    initMonacoEditor().catch((error) => {
        console.error('Monaco init error:', error);
        showPlaceholder('Editor failed to initialize: ' + error.message);
    });
});
