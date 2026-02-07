/**
 * SVG Diagram Renderer
 * Renders pointer relationships as an interactive SVG diagram
 */

class DiagramRenderer {
    constructor(svgElement) {
        this.svg = svgElement;
        this.width = 0;
        this.height = 0;
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;

        // Layout settings
        this.boxWidth = 140;
        this.boxHeight = 80;
        this.boxSpacingX = 60;
        this.boxSpacingY = 40;
        this.padding = 40;

        // Animation settings
        this.animationDuration = 300;
    }

    /**
     * Render the diagram from analysis result
     * @param {Object} analysis - Result from CPointerAnalyzer
     */
    render(analysis) {
        this.clearDiagram();

        if (analysis.variables.length === 0) {
            return;
        }

        // Get container dimensions
        const container = this.svg.parentElement;
        this.width = container.clientWidth;
        this.height = container.clientHeight;

        this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
        this.svg.classList.add('active');

        // Add defs for arrow markers
        this.addDefs();

        // Create content group for transforms (zoom/pan)
        const contentGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        contentGroup.classList.add('diagram-content');
        this.svg.appendChild(contentGroup);

        // Calculate layout positions
        const positions = this.calculateLayout(analysis);

        // Draw relationships first (behind boxes)
        this.drawRelationships(analysis.relationships, positions, contentGroup);

        // Draw variable boxes
        this.drawVariables(analysis.variables, positions, contentGroup);

        // Apply current transform
        this.updateTransform();

        // Setup pan/drag handlers
        this.setupPanHandlers();
    }

    /**
     * Setup pan/drag handlers for the diagram
     */
    setupPanHandlers() {
        let isPanning = false;
        let startX, startY;

        const onMouseDown = (e) => {
            if (e.target === this.svg || e.target.closest('.diagram-content')) {
                isPanning = true;
                startX = e.clientX - this.offsetX;
                startY = e.clientY - this.offsetY;
                this.svg.style.cursor = 'grabbing';
            }
        };

        const onMouseMove = (e) => {
            if (!isPanning) return;
            e.preventDefault();
            this.offsetX = e.clientX - startX;
            this.offsetY = e.clientY - startY;
            this.updateTransform();
        };

        const onMouseUp = () => {
            isPanning = false;
            this.svg.style.cursor = 'grab';
        };

        const onWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.min(Math.max(this.scale * delta, 0.3), 4);

            // Zoom towards mouse position
            const rect = this.svg.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
            this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
            this.scale = newScale;

            this.updateTransform();
        };

        // Remove old handlers if any
        this.svg.onmousedown = null;
        this.svg.onmousemove = null;
        this.svg.onmouseup = null;
        this.svg.onmouseleave = null;
        this.svg.onwheel = null;

        // Add new handlers
        this.svg.addEventListener('mousedown', onMouseDown);
        this.svg.addEventListener('mousemove', onMouseMove);
        this.svg.addEventListener('mouseup', onMouseUp);
        this.svg.addEventListener('mouseleave', onMouseUp);
        this.svg.addEventListener('wheel', onWheel, { passive: false });

        this.svg.style.cursor = 'grab';
    }

    /**
     * Add SVG defs for arrow markers and gradients
     */
    addDefs() {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

        // Arrow marker
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('orient', 'auto');

        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        arrow.setAttribute('points', '0 0, 10 3.5, 0 7');
        arrow.setAttribute('fill', '#3fb950');
        marker.appendChild(arrow);
        defs.appendChild(marker);

        // Glow filter
        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', 'glow');
        filter.setAttribute('x', '-50%');
        filter.setAttribute('y', '-50%');
        filter.setAttribute('width', '200%');
        filter.setAttribute('height', '200%');

        const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
        blur.setAttribute('stdDeviation', '3');
        blur.setAttribute('result', 'coloredBlur');
        filter.appendChild(blur);

        const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
        const mergeNode1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
        mergeNode1.setAttribute('in', 'coloredBlur');
        const mergeNode2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
        mergeNode2.setAttribute('in', 'SourceGraphic');
        merge.appendChild(mergeNode1);
        merge.appendChild(mergeNode2);
        filter.appendChild(merge);
        defs.appendChild(filter);

        this.svg.appendChild(defs);
    }

    /**
     * Calculate layout positions for all variables
     */
    calculateLayout(analysis) {
        const positions = new Map();
        const { variables, relationships } = analysis;

        // Separate variables into categories
        const arrayParents = [];      // Array declarations (arr[5])
        const arrayElements = [];     // Array elements (arr[0], arr[1], etc.)
        const pointers = [];          // Pointer variables
        const regularVars = [];       // Regular non-array, non-pointer variables

        for (const v of variables) {
            if (v.isArrayElement) {
                arrayElements.push(v);
            } else if (v.isArray) {
                arrayParents.push(v);
            } else if (v.pointerLevel > 0) {
                pointers.push(v);
            } else {
                regularVars.push(v);
            }
        }

        // Group array elements by their parent
        const arrayGroups = new Map();
        for (const elem of arrayElements) {
            const parent = elem.arrayParent;
            if (!arrayGroups.has(parent)) {
                arrayGroups.set(parent, []);
            }
            arrayGroups.get(parent).push(elem);
        }

        // Sort elements within each group by index
        for (const [parent, elements] of arrayGroups) {
            elements.sort((a, b) => a.arrayIndex - b.arrayIndex);
        }

        // Use smaller boxes for array elements
        const elemBoxWidth = 70;
        const elemBoxHeight = 60;
        const elemSpacing = 5;

        let currentY = this.padding;

        // Layout array elements in horizontal rows (at top)
        for (const [parentName, elements] of arrayGroups) {
            const rowWidth = elements.length * (elemBoxWidth + elemSpacing);
            let startX = (this.width - rowWidth) / 2;

            for (let i = 0; i < elements.length; i++) {
                const elem = elements[i];
                positions.set(elem.name, {
                    x: startX + i * (elemBoxWidth + elemSpacing),
                    y: currentY,
                    variable: elem,
                    boxWidth: elemBoxWidth,
                    boxHeight: elemBoxHeight,
                    isArrayElement: true
                });
            }

            // Position the array parent (invisible reference point for arrows)
            // Point to the first element
            if (elements.length > 0) {
                const firstElem = positions.get(elements[0].name);
                positions.set(parentName, {
                    x: firstElem.x,
                    y: firstElem.y,
                    variable: arrayParents.find(p => p.name === parentName),
                    boxWidth: elemBoxWidth,
                    boxHeight: elemBoxHeight,
                    isArrayParent: true,
                    hidden: true
                });
            }

            currentY += elemBoxHeight + this.boxSpacingY;
        }

        // Layout pointers below arrays (on the left)
        let pointerY = currentY + 20;
        const pointerX = this.padding + 50;

        for (let i = 0; i < pointers.length; i++) {
            positions.set(pointers[i].name, {
                x: pointerX,
                y: pointerY + i * (this.boxHeight + this.boxSpacingY / 2),
                variable: pointers[i],
                boxWidth: this.boxWidth,
                boxHeight: this.boxHeight
            });
        }

        // Layout regular variables (on the right, same row as pointers)
        const regularX = this.width - this.boxWidth - this.padding - 50;
        for (let i = 0; i < regularVars.length; i++) {
            positions.set(regularVars[i].name, {
                x: regularX,
                y: pointerY + i * (this.boxHeight + this.boxSpacingY / 2),
                variable: regularVars[i],
                boxWidth: this.boxWidth,
                boxHeight: this.boxHeight
            });
        }

        return positions;
    }

    /**
     * Draw variable boxes
     */
    drawVariables(variables, positions, contentGroup) {
        const container = contentGroup || this.svg;
        const analyzer = new CPointerAnalyzer();

        for (const variable of variables) {
            const pos = positions.get(variable.name);
            if (!pos) continue;
            if (pos.hidden) continue; // Skip hidden array parent placeholders

            // Use position-specific box sizes (for array elements) or default
            const boxWidth = pos.boxWidth || this.boxWidth;
            const boxHeight = pos.boxHeight || this.boxHeight;
            const isArrayElement = pos.isArrayElement || false;

            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.classList.add('memory-box');
            group.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

            // Get color based on type
            const color = analyzer.getTypeColor(variable);

            // Box background
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('width', boxWidth);
            rect.setAttribute('height', boxHeight);
            rect.setAttribute('fill', this.hexToRgba(color, 0.15));
            rect.setAttribute('stroke', color);
            rect.setAttribute('rx', '6');
            rect.setAttribute('ry', '6');
            group.appendChild(rect);

            if (isArrayElement) {
                // Compact layout for array elements: just index and value
                const indexText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                indexText.setAttribute('x', boxWidth / 2);
                indexText.setAttribute('y', 18);
                indexText.setAttribute('text-anchor', 'middle');
                indexText.classList.add('var-name');
                indexText.setAttribute('font-size', '11px');
                indexText.textContent = `[${variable.arrayIndex}]`;
                group.appendChild(indexText);

                const valueText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                valueText.setAttribute('x', boxWidth / 2);
                valueText.setAttribute('y', 38);
                valueText.setAttribute('text-anchor', 'middle');
                valueText.classList.add('var-value');
                valueText.setAttribute('font-size', '14px');
                valueText.textContent = analyzer.getDisplayValue(variable);
                group.appendChild(valueText);

                const addrText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                addrText.setAttribute('x', boxWidth / 2);
                addrText.setAttribute('y', 52);
                addrText.setAttribute('text-anchor', 'middle');
                addrText.classList.add('var-address');
                addrText.setAttribute('font-size', '8px');
                addrText.textContent = variable.address;
                group.appendChild(addrText);
            } else {
                // Standard layout for regular variables
                const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                nameText.setAttribute('x', boxWidth / 2);
                nameText.setAttribute('y', 22);
                nameText.setAttribute('text-anchor', 'middle');
                nameText.classList.add('var-name');
                nameText.textContent = this.formatVarName(variable);
                group.appendChild(nameText);

                const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                typeText.setAttribute('x', boxWidth / 2);
                typeText.setAttribute('y', 38);
                typeText.setAttribute('text-anchor', 'middle');
                typeText.classList.add('var-type');
                typeText.textContent = this.formatType(variable);
                group.appendChild(typeText);

                const valueText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                valueText.setAttribute('x', boxWidth / 2);
                valueText.setAttribute('y', 55);
                valueText.setAttribute('text-anchor', 'middle');
                valueText.classList.add('var-value');
                valueText.textContent = analyzer.getDisplayValue(variable);
                group.appendChild(valueText);

                const addrText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                addrText.setAttribute('x', boxWidth / 2);
                addrText.setAttribute('y', 72);
                addrText.setAttribute('text-anchor', 'middle');
                addrText.classList.add('var-address');
                addrText.textContent = variable.address;
                group.appendChild(addrText);
            }

            // Hover effect
            group.addEventListener('mouseenter', () => {
                rect.setAttribute('filter', 'url(#glow)');
            });
            group.addEventListener('mouseleave', () => {
                rect.removeAttribute('filter');
            });

            container.appendChild(group);
        }
    }

    /**
     * Draw pointer relationships as arrows
     */
    drawRelationships(relationships, positions, contentGroup) {
        const container = contentGroup || this.svg;
        for (const rel of relationships) {
            const fromPos = positions.get(rel.from);
            const toPos = positions.get(rel.to);

            if (!fromPos || !toPos) continue;

            // Use position-specific box sizes
            const fromWidth = fromPos.boxWidth || this.boxWidth;
            const fromHeight = fromPos.boxHeight || this.boxHeight;
            const toWidth = toPos.boxWidth || this.boxWidth;
            const toHeight = toPos.boxHeight || this.boxHeight;

            // Calculate arrow path - from right edge to left edge
            const startX = fromPos.x + fromWidth;
            const startY = fromPos.y + fromHeight / 2;
            const endX = toPos.x;
            const endY = toPos.y + toHeight / 2;

            // Create curved path
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

            // Calculate control points for bezier curve
            const dx = endX - startX;
            const dy = endY - startY;
            const controlOffset = Math.min(Math.abs(dx) * 0.5, 80);

            let d;
            if (Math.abs(dy) > Math.abs(dx)) {
                // Vertical arrow - use different curve
                const cyOffset = dy > 0 ? 30 : -30;
                d = `M ${startX} ${startY} 
                     C ${startX + 30} ${startY + cyOffset},
                       ${endX - 30} ${endY - cyOffset},
                       ${endX} ${endY}`;
            } else {
                // Horizontal arrow
                d = `M ${startX} ${startY} 
                     C ${startX + controlOffset} ${startY},
                       ${endX - controlOffset} ${endY},
                       ${endX} ${endY}`;
            }

            path.setAttribute('d', d);
            path.classList.add('pointer-arrow');

            // Add animation on hover
            path.addEventListener('mouseenter', () => {
                path.classList.add('animated');
            });
            path.addEventListener('mouseleave', () => {
                path.classList.remove('animated');
            });

            container.appendChild(path);
        }
    }

    /**
     * Format variable name for display
     */
    formatVarName(variable) {
        let name = variable.name;
        if (variable.isArray && variable.arraySize) {
            name += `[${variable.arraySize}]`;
        }
        return name;
    }

    /**
     * Format type for display
     */
    formatType(variable) {
        let type = variable.type;
        for (let i = 0; i < variable.pointerLevel; i++) {
            type += '*';
        }
        return type;
    }

    /**
     * Convert hex color to rgba
     */
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * Clear the diagram
     */
    clearDiagram() {
        this.svg.innerHTML = '';
        this.svg.classList.remove('active');
    }

    /**
     * Zoom in
     */
    zoomIn() {
        this.scale = Math.min(this.scale * 1.2, 3);
        this.updateTransform();
    }

    /**
     * Zoom out
     */
    zoomOut() {
        this.scale = Math.max(this.scale / 1.2, 0.5);
        this.updateTransform();
    }

    /**
     * Reset view
     */
    resetView() {
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.updateTransform();
    }

    /**
     * Update SVG transform
     */
    updateTransform() {
        const content = this.svg.querySelector('g.diagram-content');
        if (content) {
            content.setAttribute('transform',
                `translate(${this.offsetX}, ${this.offsetY}) scale(${this.scale})`);
        }
    }
}

// Export for use
window.DiagramRenderer = DiagramRenderer;
