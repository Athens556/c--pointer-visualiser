/**
 * Cytoscape-based diagram renderer
 * Renders pointer relationships as an interactive graph
 */

class DiagramRenderer {
    constructor(containerElement) {
        this.container = containerElement;
        this.cy = null;
    }

    render(analysis) {
        this.clearDiagram();

        if (!analysis?.variables?.length) {
            return;
        }

        const cytoscapeLib = window.cytoscape;
        if (!cytoscapeLib) {
            throw new Error('Cytoscape failed to load');
        }

        this.container.classList.add('active');

        const elements = this.buildElements(analysis);
        this.cy = cytoscapeLib({
            container: this.container,
            elements,
            layout: { name: 'preset' },
            wheelSensitivity: 0.2,
            style: [
                {
                    selector: 'node',
                    style: {
                        'shape': 'round-rectangle',
                        'background-color': 'data(bgColor)',
                        'border-width': 2,
                        'border-color': 'data(borderColor)',
                        'width': 180,
                        'height': 92,
                        'label': 'data(label)',
                        'text-wrap': 'wrap',
                        'text-max-width': 150,
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'font-family': 'JetBrains Mono',
                        'font-size': 11,
                        'color': '#e6edf3',
                        'padding': '10px'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'curve-style': 'bezier',
                        'width': 3,
                        'line-color': '#3fb950',
                        'target-arrow-color': '#3fb950',
                        'target-arrow-shape': 'triangle',
                        'label': 'data(label)',
                        'font-family': 'JetBrains Mono',
                        'font-size': 10,
                        'color': '#8b949e',
                        'text-background-color': '#0d1117',
                        'text-background-opacity': 0.85,
                        'text-background-padding': 2
                    }
                }
            ]
        });

        this.cy.fit(this.cy.elements(), 40);
    }

    buildElements(analysis) {
        const analyzer = new CPointerAnalyzer();
        const positions = this.calculatePositions(analysis.variables);

        const nodes = analysis.variables.map(variable => {
            const color = analyzer.getTypeColor(variable);
            const label = [
                this.formatVarName(variable),
                this.formatType(variable),
                analyzer.getDisplayValue(variable),
                variable.address || ''
            ].filter(Boolean).join('\n');

            return {
                data: {
                    id: variable.name,
                    label,
                    bgColor: this.hexToRgba(color, 0.18),
                    borderColor: color
                },
                position: positions.get(variable.name)
            };
        });

        const edges = (analysis.relationships || [])
            .filter(rel => positions.has(rel.from) && positions.has(rel.to))
            .map((rel, index) => ({
                data: {
                    id: `edge-${index}-${rel.from}-${rel.to}`,
                    source: rel.from,
                    target: rel.to,
                    label: rel.label || ''
                }
            }));

        return [...nodes, ...edges];
    }

    calculatePositions(variables) {
        const positions = new Map();
        const arrays = [];
        const pointers = [];
        const regulars = [];

        for (const variable of variables) {
            if (variable.isArrayElement || variable.isArray) {
                arrays.push(variable);
            } else if ((variable.pointerLevel || 0) > 0) {
                pointers.push(variable);
            } else {
                regulars.push(variable);
            }
        }

        arrays.forEach((variable, index) => {
            positions.set(variable.name, { x: 180 + index * 190, y: 110 });
        });

        pointers.forEach((variable, index) => {
            positions.set(variable.name, { x: 180, y: 250 + index * 135 });
        });

        regulars.forEach((variable, index) => {
            positions.set(variable.name, { x: 560, y: 250 + index * 135 });
        });

        return positions;
    }

    formatVarName(variable) {
        if (variable.isArray && variable.arraySize) {
            return `${variable.name}[${variable.arraySize}]`;
        }
        return variable.name;
    }

    formatType(variable) {
        let type = variable.type || 'unknown';
        for (let i = 0; i < (variable.pointerLevel || 0); i++) {
            type += '*';
        }
        return type;
    }

    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    clearDiagram() {
        if (this.cy) {
            this.cy.destroy();
            this.cy = null;
        }
        this.container.innerHTML = '';
        this.container.classList.remove('active');
    }

    zoomIn() {
        if (this.cy) this.cy.zoom(this.cy.zoom() * 1.2);
    }

    zoomOut() {
        if (this.cy) this.cy.zoom(this.cy.zoom() / 1.2);
    }

    resetView() {
        if (this.cy) this.cy.fit(this.cy.elements(), 40);
    }
}

window.DiagramRenderer = DiagramRenderer;
