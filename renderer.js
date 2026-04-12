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
            layout: {
                name: 'cose',
                animate: false,
                fit: true,
                padding: 45,
                nodeRepulsion: 9000,
                idealEdgeLength: 170,
                edgeElasticity: 120,
                gravity: 0.25,
                numIter: 1000
            },
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
        const variables = this.getDrawableVariables(analysis.variables || []);
        const nodeIds = new Set(variables.map(variable => variable.name));

        const nodes = variables.map(variable => {
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
                }
            };
        });

        const edges = this.buildRelationships(analysis)
            .filter(rel => nodeIds.has(rel.from) && nodeIds.has(rel.to) && rel.from !== rel.to)
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

    getDrawableVariables(variables) {
        const ownerByAddress = new Map();

        for (const variable of variables) {
            if (variable.isDerivedDereference) continue;
            const address = this.normalizeAddress(variable.address);
            if (address) ownerByAddress.set(address, variable);
        }

        return variables.filter(variable => {
            if (!variable.isDerivedDereference) return true;

            const value = this.getRawValue(variable);
            const isDereferencedStruct = variable.name?.startsWith('*') && value.startsWith('{');
            if (!isDereferencedStruct) return false;

            const address = this.normalizeAddress(variable.address);
            return !address || !ownerByAddress.has(address);
        });
    }

    buildRelationships(analysis) {
        const variables = this.getDrawableVariables(analysis.variables || []);
        const relationships = [...(analysis.relationships || [])];
        const seen = new Set(relationships.map(rel => `${rel.from}->${rel.to}`));
        const addressMap = new Map();

        for (const variable of variables) {
            const address = this.normalizeAddress(variable.address);
            if (!address) continue;
            if (!addressMap.has(address)) {
                addressMap.set(address, []);
            }
            addressMap.get(address).push(variable);
        }

        for (const variable of variables) {
            const pointerValue = this.getPointerValue(variable);
            if (!pointerValue) continue;

            const candidates = (addressMap.get(pointerValue) || [])
                .filter(candidate => candidate.name !== variable.name)
                .sort((a, b) => this.targetPriority(a) - this.targetPriority(b));

            const target = candidates[0];
            if (!target) continue;

            const key = `${variable.name}->${target.name}`;
            if (seen.has(key)) continue;

            relationships.push({
                from: variable.name,
                to: target.name,
                type: 'points_to',
                label: pointerValue
            });
            seen.add(key);
        }

        for (const variable of variables) {
            const fields = this.parseStructFields(this.getRawValue(variable));
            for (const field of fields) {
                const pointerValue = this.normalizeAddress(field.value);
                if (!pointerValue) continue;

                const candidates = (addressMap.get(pointerValue) || [])
                    .filter(candidate => candidate.name !== variable.name)
                    .sort((a, b) => this.targetPriority(a) - this.targetPriority(b));

                const target = candidates[0];
                if (!target) continue;

                const key = `${variable.name}->${target.name}`;
                if (seen.has(key)) continue;

                relationships.push({
                    from: variable.name,
                    to: target.name,
                    type: 'field_points_to',
                    label: `${field.name}: ${pointerValue}`
                });
                seen.add(key);
            }
        }

        return relationships;
    }

    getPointerValue(variable) {
        if ((variable.pointerLevel || 0) <= 0 && !variable.isPointer) {
            return null;
        }

        const value = variable.value;
        if (value?.type === 'literal') {
            return this.normalizeAddress(value.value);
        }
        if (value?.type === 'address_of') {
            return null;
        }
        if (typeof value === 'string') {
            return this.normalizeAddress(value);
        }

        return null;
    }

    getRawValue(variable) {
        const value = variable?.value;
        if (value?.type === 'literal') {
            return String(value.value ?? '').trim();
        }
        if (value?.type === 'null') {
            return '0x0';
        }
        return String(value ?? '').trim();
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

    normalizeAddress(value) {
        if (!value || typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed.startsWith('0x')) return null;
        if (trimmed === '0x0') return null;
        return trimmed.split(/\s+/)[0];
    }

    targetPriority(variable) {
        if (!variable.isDerivedDereference) return 0;
        if (!variable.name?.startsWith('*')) return 1;
        return 2;
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
