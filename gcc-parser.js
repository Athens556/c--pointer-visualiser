/**
 * GIMPLE Output Parser
 * Parses GCC's -fdump-tree-gimple output to extract variables and pointer relationships
 */

class GimpleParser {
    constructor() {
        this.variables = [];
        this.relationships = [];
        this.addressCounter = 0x1000;
    }

    /**
     * Parse GIMPLE output text
     * @param {string} gimpleText - Raw GIMPLE output from GCC
     * @returns {Object} Analysis result with variables and relationships
     */
    parse(gimpleText) {
        this.variables = [];
        this.relationships = [];
        this.addressCounter = 0x1000;

        const lines = gimpleText.split('\n');

        // Parse variable declarations and assignments
        for (const line of lines) {
            const trimmed = line.trim();

            // Skip empty lines and braces
            if (!trimmed || trimmed === '{' || trimmed === '}') continue;

            // Skip function headers
            if (trimmed.includes('()') && !trimmed.includes('=')) continue;

            // Parse declarations: "int x;" or "int * p;"
            const declMatch = trimmed.match(/^(\w+(?:\s+\w+)?)\s*(\*\s*)?\s*(\w+)\s*;$/);
            if (declMatch) {
                const [, type, pointer, name] = declMatch;
                this.addVariable(name, type, pointer ? 1 : 0);
                continue;
            }

            // Parse array declarations: "int arr[5];"
            const arrayMatch = trimmed.match(/^(\w+)\s+(\w+)\[(\d+)\]\s*;$/);
            if (arrayMatch) {
                const [, type, name, size] = arrayMatch;
                this.addArray(name, type, parseInt(size));
                continue;
            }

            // Parse simple assignments: "x = 5;"
            const simpleAssign = trimmed.match(/^(\w+)\s*=\s*(\d+)\s*;$/);
            if (simpleAssign) {
                const [, name, value] = simpleAssign;
                this.updateValue(name, value);
                continue;
            }

            // Parse address-of assignments: "p = &x;"
            const addrAssign = trimmed.match(/^(\w+)\s*=\s*&(\w+)\s*;$/);
            if (addrAssign) {
                const [, ptrName, targetName] = addrAssign;
                this.addRelationship(ptrName, targetName);
                continue;
            }

            // Parse pointer copy: "q = p;"
            const ptrCopy = trimmed.match(/^(\w+)\s*=\s*(\w+)\s*;$/);
            if (ptrCopy) {
                const [, dest, src] = ptrCopy;
                const srcVar = this.findVariable(src);
                const destVar = this.findVariable(dest);
                if (srcVar && destVar && (srcVar.pointerLevel > 0 || destVar.pointerLevel > 0)) {
                    // Copy the pointer relationship
                    const srcRel = this.relationships.find(r => r.from === src);
                    if (srcRel) {
                        this.addRelationship(dest, srcRel.to);
                    }
                }
                continue;
            }

            // Parse member access: "node1.next = &node2;"
            const memberAssign = trimmed.match(/^(\w+)\.(\w+)\s*=\s*&(\w+)\s*;$/);
            if (memberAssign) {
                const [, objName, memberName, targetName] = memberAssign;
                this.addRelationship(objName, targetName, memberName);
                continue;
            }
        }

        return {
            variables: this.variables,
            relationships: this.relationships
        };
    }

    addVariable(name, type, pointerLevel = 0) {
        // Check if already exists
        if (this.findVariable(name)) return;

        this.variables.push({
            name,
            type: type.trim(),
            pointerLevel,
            isArray: false,
            arraySize: null,
            address: this.getNextAddress(),
            value: pointerLevel > 0 ? null : '?',
            isStruct: type.includes('struct')
        });
    }

    addArray(name, type, size) {
        // Add array parent
        const baseAddr = this.getNextAddress();
        this.variables.push({
            name,
            type,
            pointerLevel: 0,
            isArray: true,
            arraySize: size,
            address: baseAddr,
            value: null,
            arrayGroup: name
        });

        // Add individual elements
        for (let i = 0; i < size; i++) {
            this.variables.push({
                name: `${name}[${i}]`,
                type,
                pointerLevel: 0,
                isArray: false,
                isArrayElement: true,
                arrayParent: name,
                arrayIndex: i,
                address: this.getNextAddress(),
                value: { type: 'literal', value: '?' }
            });
        }
    }

    updateValue(name, value) {
        const variable = this.findVariable(name);
        if (variable) {
            variable.value = value;
        }
    }

    addRelationship(from, to, label = null) {
        // Don't add duplicate relationships
        const exists = this.relationships.some(r => r.from === from && r.to === to);
        if (exists) return;

        this.relationships.push({
            from,
            to,
            type: 'points_to',
            label: label || `&${to}`
        });
    }

    findVariable(name) {
        return this.variables.find(v => v.name === name);
    }

    getNextAddress() {
        const addr = `0x${this.addressCounter.toString(16).toUpperCase()}`;
        this.addressCounter += 4;
        return addr;
    }

    /**
     * Get display value for a variable
     */
    getDisplayValue(variable) {
        if (variable.value === null || variable.value === undefined) {
            return '?';
        }
        if (typeof variable.value === 'object' && variable.value.value) {
            return variable.value.value;
        }
        return String(variable.value);
    }

    /**
     * Get color based on variable type
     */
    getTypeColor(variable) {
        const colors = {
            'int': '#58a6ff',
            'char': '#f778ba',
            'float': '#7ee787',
            'double': '#7ee787',
            'pointer': '#ffa657',
            'struct': '#d2a8ff',
            'array': '#79c0ff'
        };

        if (variable.pointerLevel > 0) return colors.pointer;
        if (variable.isArray || variable.isArrayElement) return colors.array;
        if (variable.isStruct) return colors.struct;

        const baseType = variable.type.split(' ')[0].toLowerCase();
        return colors[baseType] || '#8b949e';
    }
}

module.exports = { GimpleParser };
