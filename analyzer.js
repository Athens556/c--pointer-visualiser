/**
 * C Pointer Analyzer
 * Analyzes tokens to extract variables, types, and pointer relationships
 */

class CPointerAnalyzer {
    constructor() {
        this.variables = [];
        this.relationships = [];
        this.addressCounter = 0x1000;
        this.structs = new Map(); // Track struct definitions
    }

    /**
     * Analyze tokens and extract pointer information
     * @param {Array} tokens - Array of tokens from tokenizer
     * @returns {Object} Analysis result with variables and relationships
     */
    analyze(tokens) {
        this.variables = [];
        this.relationships = [];
        this.memberAssignments = []; // Track member assignments like node1.next = &node2
        this.addressCounter = 0x1000;
        this.structs = new Map();

        let i = 0;
        while (i < tokens.length) {
            // Try parsing as declaration first
            const declResult = this.parseDeclaration(tokens, i);
            if (declResult.consumed > 0) {
                i += declResult.consumed;
                continue;
            }

            // Try parsing as member assignment (e.g., node1.next = &node2)
            const assignResult = this.parseMemberAssignment(tokens, i);
            if (assignResult.consumed > 0) {
                i += assignResult.consumed;
                continue;
            }

            i++;
        }

        // Build relationships from declarations and member assignments
        this.buildRelationships();

        return {
            variables: this.variables,
            relationships: this.relationships
        };
    }

    /**
     * Parse member assignment like node1.next = &node2 or node1.data = 10
     */
    parseMemberAssignment(tokens, startIdx) {
        let i = startIdx;

        // Check for pattern: identifier.member = expression;
        if (i >= tokens.length || tokens[i].type !== 'IDENTIFIER') {
            return { consumed: 0 };
        }

        const objName = tokens[i].value;
        i++;

        // Check for . or ->
        if (i >= tokens.length || (tokens[i].value !== '.' && tokens[i].value !== '->')) {
            return { consumed: 0 };
        }
        const accessor = tokens[i].value;
        i++;

        // Get member name
        if (i >= tokens.length || tokens[i].type !== 'IDENTIFIER') {
            return { consumed: 0 };
        }
        const memberName = tokens[i].value;
        i++;

        // Check for =
        if (i >= tokens.length || tokens[i].value !== '=') {
            return { consumed: 0 };
        }
        i++;

        // Collect RHS expression until semicolon
        const rhsTokens = [];
        while (i < tokens.length && tokens[i].value !== ';') {
            rhsTokens.push(tokens[i]);
            i++;
        }

        if (i < tokens.length) i++; // skip ;

        // Store the assignment for relationship building
        if (rhsTokens.length > 0) {
            const value = this.parseInitValue(rhsTokens);
            this.memberAssignments.push({
                object: objName,
                member: memberName,
                accessor,
                value
            });
        }

        return { consumed: i - startIdx };
    }

    /**
     * Parse a variable declaration
     */
    parseDeclaration(tokens, startIdx) {
        let i = startIdx;

        // Skip if not at a potential declaration start
        if (i >= tokens.length) return { consumed: 0 };

        // Check for struct definition
        if (tokens[i].value === 'struct') {
            return this.parseStructDefinition(tokens, i);
        }

        // Look for type keyword
        if (tokens[i].type !== 'TYPE' && tokens[i].type !== 'KEYWORD') {
            return { consumed: 0 };
        }

        // Skip storage class specifiers
        const storageClasses = ['static', 'extern', 'auto', 'register', 'const', 'volatile'];
        while (i < tokens.length && storageClasses.includes(tokens[i].value)) {
            i++;
        }

        if (i >= tokens.length) return { consumed: 0 };

        // Parse base type
        let baseType = '';
        let isStruct = false;

        if (tokens[i].value === 'struct') {
            isStruct = true;
            baseType = 'struct ';
            i++;
            if (i < tokens.length && tokens[i].type === 'IDENTIFIER') {
                baseType += tokens[i].value;
                i++;
            }
        } else if (tokens[i].type === 'TYPE' || this.isTypeKeyword(tokens[i].value)) {
            // Handle multiple type words (e.g., "unsigned int", "long long")
            while (i < tokens.length && this.isTypeKeyword(tokens[i].value)) {
                if (baseType) baseType += ' ';
                baseType += tokens[i].value;
                i++;
            }
        } else {
            return { consumed: 0 };
        }

        if (!baseType || i >= tokens.length) return { consumed: 0 };

        // Parse variable declarations (can have multiple: int a, *b, c;)
        const declarations = [];

        while (i < tokens.length) {
            // Count pointer asterisks
            let pointerLevel = 0;
            while (i < tokens.length && tokens[i].value === '*') {
                pointerLevel++;
                i++;
            }

            // Get identifier
            if (i >= tokens.length || tokens[i].type !== 'IDENTIFIER') {
                break;
            }

            const varName = tokens[i].value;
            i++;

            // Check for array notation
            let isArray = false;
            let arraySize = null;
            if (i < tokens.length && tokens[i].value === '[') {
                isArray = true;
                i++; // skip [
                if (i < tokens.length && tokens[i].type === 'NUMBER') {
                    arraySize = parseInt(tokens[i].value);
                    i++;
                }
                if (i < tokens.length && tokens[i].value === ']') {
                    i++;
                }
            }

            // Check for initialization
            let initValue = null;
            let initExpression = [];
            let arrayInitValues = []; // For array initializers like {10, 20, 30}

            if (i < tokens.length && tokens[i].value === '=') {
                i++; // skip =

                // Check for array initializer { ... }
                if (i < tokens.length && tokens[i].value === '{') {
                    i++; // skip {
                    while (i < tokens.length && tokens[i].value !== '}') {
                        if (tokens[i].type === 'NUMBER') {
                            arrayInitValues.push(tokens[i].value);
                        } else if (tokens[i].type === 'STRING' || tokens[i].type === 'CHAR_LITERAL') {
                            arrayInitValues.push(tokens[i].value);
                        }
                        i++;
                    }
                    if (i < tokens.length) i++; // skip }
                } else {
                    // Collect initialization expression
                    while (i < tokens.length &&
                        tokens[i].value !== ';' &&
                        tokens[i].value !== ',') {
                        initExpression.push(tokens[i]);
                        i++;
                    }
                    initValue = this.parseInitValue(initExpression);
                }
            }

            // Create variable entry
            const variable = {
                name: varName,
                type: baseType,
                pointerLevel,
                isArray,
                arraySize,
                address: this.getNextAddress(),
                value: initValue,
                initExpression,
                isStruct,
                arrayInitValues,
                arrayGroup: isArray ? varName : null // Track which array group this belongs to
            };

            declarations.push(variable);
            this.variables.push(variable);

            // If it's an array, also create individual element entries
            if (isArray && arraySize) {
                for (let idx = 0; idx < arraySize; idx++) {
                    const elemValue = arrayInitValues[idx] || '?';
                    const element = {
                        name: `${varName}[${idx}]`,
                        type: baseType,
                        pointerLevel: 0,
                        isArray: false,
                        isArrayElement: true,
                        arrayParent: varName,
                        arrayIndex: idx,
                        address: this.getNextAddress(),
                        value: { type: 'literal', value: elemValue },
                        isStruct: false
                    };
                    this.variables.push(element);
                }
            }

            // Check for more declarations
            if (i < tokens.length && tokens[i].value === ',') {
                i++;
                continue;
            }

            break;
        }

        // Skip to semicolon
        while (i < tokens.length && tokens[i].value !== ';') {
            i++;
        }
        if (i < tokens.length) i++; // skip ;

        return { consumed: i - startIdx, declarations };
    }

    /**
     * Parse struct definition
     */
    parseStructDefinition(tokens, startIdx) {
        let i = startIdx;

        if (tokens[i].value !== 'struct') return { consumed: 0 };
        i++;

        // Get struct name (optional)
        let structName = '';
        if (i < tokens.length && tokens[i].type === 'IDENTIFIER') {
            structName = tokens[i].value;
            i++;
        }

        // Check for definition body
        if (i < tokens.length && tokens[i].value === '{') {
            // Skip struct body for now
            let braceCount = 1;
            i++;
            while (i < tokens.length && braceCount > 0) {
                if (tokens[i].value === '{') braceCount++;
                if (tokens[i].value === '}') braceCount--;
                i++;
            }

            if (structName) {
                this.structs.set(structName, true);
            }
        }

        // Check for variable declaration after struct definition (e.g., struct Point p;)
        // Parse variables declared after the struct body directly here
        const baseType = 'struct ' + structName;
        const declarations = [];

        while (i < tokens.length && tokens[i].value !== ';') {
            // Count pointer asterisks
            let pointerLevel = 0;
            while (i < tokens.length && tokens[i].value === '*') {
                pointerLevel++;
                i++;
            }

            // Get identifier
            if (i >= tokens.length || tokens[i].type !== 'IDENTIFIER') {
                break;
            }

            const varName = tokens[i].value;
            i++;

            // Check for initialization
            let initValue = null;
            if (i < tokens.length && tokens[i].value === '=') {
                i++; // skip =
                let initExpression = [];
                while (i < tokens.length &&
                    tokens[i].value !== ';' &&
                    tokens[i].value !== ',') {
                    initExpression.push(tokens[i]);
                    i++;
                }
                initValue = this.parseInitValue(initExpression);
            }

            // Create variable entry
            const variable = {
                name: varName,
                type: baseType,
                pointerLevel,
                isArray: false,
                arraySize: null,
                address: this.getNextAddress(),
                value: initValue,
                initExpression: [],
                isStruct: true
            };

            declarations.push(variable);
            this.variables.push(variable);

            // Check for more declarations
            if (i < tokens.length && tokens[i].value === ',') {
                i++;
                continue;
            }

            break;
        }

        // Skip to semicolon
        while (i < tokens.length && tokens[i].value !== ';') {
            i++;
        }
        if (i < tokens.length) i++;

        return { consumed: i - startIdx, declarations };
    }

    /**
     * Parse initialization value from expression tokens
     */
    parseInitValue(exprTokens) {
        if (exprTokens.length === 0) return null;

        // Simple cases
        if (exprTokens.length === 1) {
            const token = exprTokens[0];
            if (token.type === 'NUMBER') {
                return { type: 'literal', value: token.value };
            }
            if (token.type === 'STRING') {
                return { type: 'string', value: token.value };
            }
            if (token.type === 'CHAR_LITERAL') {
                return { type: 'char', value: token.value };
            }
            if (token.type === 'IDENTIFIER') {
                return { type: 'variable', name: token.value };
            }
            if (token.value === 'NULL') {
                return { type: 'null', value: 'NULL' };
            }
        }

        // Address-of expression: &variable
        if (exprTokens.length === 2 &&
            exprTokens[0].value === '&' &&
            exprTokens[1].type === 'IDENTIFIER') {
            return {
                type: 'address_of',
                target: exprTokens[1].value
            };
        }

        // Dereference expression: *variable
        if (exprTokens.length === 2 &&
            exprTokens[0].value === '*' &&
            exprTokens[1].type === 'IDENTIFIER') {
            return {
                type: 'dereference',
                target: exprTokens[1].value
            };
        }

        // Array access: arr[index] or variable assignment
        if (exprTokens.some(t => t.value === '[')) {
            const arrIdx = exprTokens.findIndex(t => t.type === 'IDENTIFIER');
            if (arrIdx !== -1) {
                return {
                    type: 'array_access',
                    array: exprTokens[arrIdx].value
                };
            }
        }

        // Complex expression - store raw tokens
        return {
            type: 'expression',
            tokens: exprTokens.map(t => t.value).join(' ')
        };
    }

    /**
     * Build pointer relationships from variable assignments and member assignments
     */
    buildRelationships() {
        // Process variable declaration assignments
        for (const variable of this.variables) {
            if (!variable.value) continue;

            if (variable.value.type === 'address_of') {
                // p = &x means p points to x
                const targetVar = this.findVariable(variable.value.target);
                if (targetVar) {
                    this.relationships.push({
                        from: variable.name,
                        to: variable.value.target,
                        type: 'points_to',
                        label: '&' + variable.value.target
                    });
                }
            } else if (variable.value.type === 'variable') {
                // p = q means p gets copy of q (for pointers, they point to same thing)
                const targetVar = this.findVariable(variable.value.name);
                if (targetVar && (variable.pointerLevel > 0 || targetVar.isArray)) {
                    // Find what the source pointer points to
                    const sourceRel = this.relationships.find(r => r.from === variable.value.name);
                    if (sourceRel) {
                        this.relationships.push({
                            from: variable.name,
                            to: sourceRel.to,
                            type: 'points_to',
                            label: variable.value.name
                        });
                    } else if (targetVar.isArray) {
                        // Pointer to array start
                        this.relationships.push({
                            from: variable.name,
                            to: variable.value.name,
                            type: 'points_to',
                            label: variable.value.name
                        });
                    }
                }
            } else if (variable.value.type === 'array_access') {
                // p = arr means p points to arr[0]
                const targetVar = this.findVariable(variable.value.array);
                if (targetVar && targetVar.isArray) {
                    this.relationships.push({
                        from: variable.name,
                        to: variable.value.array,
                        type: 'points_to',
                        label: variable.value.array
                    });
                }
            }
        }

        // Process member assignments (e.g., node1.next = &node2)
        for (const assign of this.memberAssignments) {
            if (assign.value && assign.value.type === 'address_of') {
                // node1.next = &node2 means node1 points to node2
                const sourceVar = this.findVariable(assign.object);
                const targetVar = this.findVariable(assign.value.target);

                if (sourceVar && targetVar) {
                    this.relationships.push({
                        from: assign.object,
                        to: assign.value.target,
                        type: 'points_to',
                        label: assign.member
                    });
                }
            } else if (assign.value && assign.value.type === 'null') {
                // node.next = NULL - no arrow needed, just note it
                // Could add visual indicator later
            }
        }
    }

    /**
     * Find a variable by name
     */
    findVariable(name) {
        return this.variables.find(v => v.name === name);
    }

    /**
     * Check if a value is a type keyword
     */
    isTypeKeyword(value) {
        const types = [
            'char', 'int', 'float', 'double', 'void', 'short', 'long',
            'signed', 'unsigned', 'struct', 'union', 'enum'
        ];
        return types.includes(value);
    }

    /**
     * Get next simulated memory address
     */
    getNextAddress() {
        const addr = this.addressCounter;
        this.addressCounter += 4; // Assume 4-byte alignment
        return '0x' + addr.toString(16).toUpperCase();
    }

    /**
     * Get display value for a variable
     */
    getDisplayValue(variable) {
        if (!variable.value) return '?';

        switch (variable.value.type) {
            case 'literal':
                return variable.value.value;
            case 'string':
                return variable.value.value;
            case 'char':
                return variable.value.value;
            case 'null':
                return 'NULL';
            case 'address_of':
                return '&' + variable.value.target;
            case 'dereference':
                return '*' + variable.value.target;
            case 'variable':
                return variable.value.name;
            case 'expression':
                return variable.value.tokens;
            default:
                return '?';
        }
    }

    /**
     * Get type color for visualization
     */
    getTypeColor(variable) {
        if (variable.pointerLevel > 0) return '#a371f7'; // Purple for pointers
        if (variable.isArray) return '#79c0ff';          // Cyan for arrays
        if (variable.isStruct) return '#f778ba';         // Pink for structs

        const type = variable.type.toLowerCase();
        if (type.includes('char')) return '#3fb950';     // Green
        if (type.includes('float') || type.includes('double')) return '#f0883e'; // Orange
        return '#58a6ff'; // Blue for int and others
    }
}

// Export for use
window.CPointerAnalyzer = CPointerAnalyzer;
