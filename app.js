/**
 * Main Application Script
 * Orchestrates the tokenizer, analyzer, and renderer
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const codeInput = document.getElementById('code-input');
    const lineNumbers = document.getElementById('line-numbers');
    const analyzeBtn = document.getElementById('analyze-btn');
    const clearBtn = document.getElementById('clear-btn');
    const fileUpload = document.getElementById('file-upload');
    const examplesDropdown = document.getElementById('examples-dropdown');
    const diagramSvg = document.getElementById('diagram-svg');
    const placeholder = document.getElementById('diagram-placeholder');
    const legend = document.getElementById('legend');
    const debugToggle = document.getElementById('debug-toggle');
    const debugPanel = document.getElementById('debug-panel');
    const debugContent = document.getElementById('debug-content');
    const tokenOutput = document.getElementById('token-output');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const resetViewBtn = document.getElementById('reset-view');

    // Initialize components
    const tokenizer = new CTokenizer();
    const analyzer = new CPointerAnalyzer();
    const renderer = new DiagramRenderer(diagramSvg);
    window.renderer = renderer; // Expose for debugger UI

    // Update line numbers
    function updateLineNumbers() {
        const lines = codeInput.value.split('\n');
        lineNumbers.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
    }

    // Sync scroll between editor and line numbers
    codeInput.addEventListener('scroll', () => {
        lineNumbers.scrollTop = codeInput.scrollTop;
    });

    // Update line numbers on input
    codeInput.addEventListener('input', updateLineNumbers);

    // Handle Tab key - insert spaces instead of moving focus
    codeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = codeInput.selectionStart;
            const end = codeInput.selectionEnd;
            const spaces = '    '; // 4 spaces for tab

            // Insert tab at cursor position
            codeInput.value = codeInput.value.substring(0, start) + spaces + codeInput.value.substring(end);

            // Move cursor after the inserted spaces
            codeInput.selectionStart = codeInput.selectionEnd = start + spaces.length;

            updateLineNumbers();
        }
    });

    // Initial line numbers
    updateLineNumbers();

    // Tree-sitter analyzer (client-side)
    let treeSitterAnalyzer = null;
    let treeSitterReady = false;

    // Initialize Tree-sitter analyzer
    async function initTreeSitter() {
        if (treeSitterReady) return true;

        try {
            treeSitterAnalyzer = new TreeSitterAnalyzer();
            await treeSitterAnalyzer.init();
            treeSitterReady = true;
            console.log('✓ Tree-sitter C parser ready (client-side)');
            return true;
        } catch (e) {
            console.log('⚠ Tree-sitter not available, using JavaScript fallback');
            return false;
        }
    }

    // Main analysis function
    async function analyzeCode() {
        const code = codeInput.value.trim();

        if (!code) {
            showPlaceholder('Enter some C code to visualize');
            return;
        }

        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Analyzing...';

        try {
            let analysis;

            // Try Tree-sitter first (client-side, no server needed)
            if (treeSitterReady || await initTreeSitter()) {
                try {
                    analysis = await treeSitterAnalyzer.analyze(code);
                    console.log('✓ Analysis via Tree-sitter (client-side)');
                } catch (e) {
                    console.log('Tree-sitter analysis failed, using JavaScript fallback:', e.message);
                    // Fall back to JavaScript analyzer
                    const tokens = tokenizer.tokenize(code);
                    tokenOutput.textContent = formatTokens(tokens);
                    analysis = analyzer.analyze(tokens);
                }
            } else {
                // JavaScript fallback
                const tokens = tokenizer.tokenize(code);
                tokenOutput.textContent = formatTokens(tokens);
                analysis = analyzer.analyze(tokens);
            }

            if (!analysis.variables || analysis.variables.length === 0) {
                showPlaceholder('No variables found. Try declaring some variables with pointers.');
                return;
            }

            // Render diagram
            hidePlaceholder();
            renderer.render(analysis);
            legend.classList.add('active');

            // Animate button
            analyzeBtn.style.transform = 'scale(0.95)';
            setTimeout(() => {
                analyzeBtn.style.transform = '';
            }, 100);

        } catch (error) {
            console.error('Analysis error:', error);
            showPlaceholder('Error analyzing code: ' + error.message);
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze';
        }
    }

    // Initialize Tree-sitter on load
    initTreeSitter();

    // Analyze button click
    analyzeBtn.addEventListener('click', () => {
        analyzeCode();
    });

    // Keyboard shortcut: Ctrl+Enter to analyze
    codeInput.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            analyzeCode();
        }
    });

    // Format tokens for debug display
    function formatTokens(tokens) {
        return tokens.map(t =>
            `[${t.line}:${t.column}] ${t.type.padEnd(12)} "${t.value}"`
        ).join('\n');
    }

    // Show placeholder message
    function showPlaceholder(message) {
        placeholder.classList.remove('hidden');
        placeholder.querySelector('p').innerHTML = message;
        diagramSvg.classList.remove('active');
        legend.classList.remove('active');
    }

    // Hide placeholder
    function hidePlaceholder() {
        placeholder.classList.add('hidden');
    }

    // Clear button
    clearBtn.addEventListener('click', () => {
        codeInput.value = '';
        updateLineNumbers();
        renderer.clearDiagram();
        showPlaceholder('Enter C code and click <strong>Analyze</strong> to visualize pointers');
        tokenOutput.textContent = '';
    });

    // File upload
    fileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                codeInput.value = event.target.result;
                updateLineNumbers();
                // Auto-analyze after upload
                analyzeCode();
            };
            reader.readAsText(file);
        }
        // Reset input so same file can be uploaded again
        e.target.value = '';
    });

    // Examples dropdown
    examplesDropdown.addEventListener('change', (e) => {
        const exampleKey = e.target.value;
        if (exampleKey && window.cExamples[exampleKey]) {
            codeInput.value = window.cExamples[exampleKey].code;
            updateLineNumbers();
            analyzeCode();
        }
        // Reset dropdown
        e.target.value = '';
    });

    // Debug panel toggle
    debugToggle.addEventListener('click', () => {
        debugPanel.classList.toggle('expanded');
    });

    // Zoom controls
    zoomInBtn.addEventListener('click', () => renderer.zoomIn());
    zoomOutBtn.addEventListener('click', () => renderer.zoomOut());
    resetViewBtn.addEventListener('click', () => renderer.resetView());

    // Resizable divider
    const divider = document.querySelector('.divider');
    const codePanel = document.querySelector('.code-panel');
    const diagramPanel = document.querySelector('.diagram-panel');
    let isResizing = false;

    divider.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const container = document.querySelector('.main-content');
        const containerRect = container.getBoundingClientRect();
        const percentage = ((e.clientX - containerRect.left) / containerRect.width) * 100;

        // Clamp between 20% and 80%
        const clampedPercentage = Math.min(Math.max(percentage, 20), 80);

        codePanel.style.flex = `0 0 ${clampedPercentage}%`;
        diagramPanel.style.flex = `0 0 ${100 - clampedPercentage}%`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // Re-render diagram with new size
            if (diagramSvg.classList.contains('active')) {
                const code = codeInput.value.trim();
                if (code) {
                    const tokens = tokenizer.tokenize(code);
                    const analysis = analyzer.analyze(tokens);
                    renderer.render(analysis);
                }
            }
        }
    });

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (diagramSvg.classList.contains('active')) {
                const code = codeInput.value.trim();
                if (code) {
                    const tokens = tokenizer.tokenize(code);
                    const analysis = analyzer.analyze(tokens);
                    renderer.render(analysis);
                }
            }
        }, 250);
    });

    // Load default example on start
    if (window.cExamples && window.cExamples.basic) {
        codeInput.value = window.cExamples.basic.code;
        updateLineNumbers();
    }
});
