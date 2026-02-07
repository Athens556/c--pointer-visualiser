/**
 * Tree-sitter based C Analyzer
 * Client-side parsing using WebAssembly
 */

class TreeSitterAnalyzer {
    constructor() {
        this.parser = null;
        this.ready = false;
        this.variables = [];
        this.relationships = [];
        this.addressCounter = 0x1000;
    }

    /**
     * Initialize Tree-sitter with C language support
     */
    async init() {
        if (this.ready) return;

        try {
            // Initialize Tree-sitter
            await TreeSitter.init();

            this.parser = new TreeSitter();

            // Load C language grammar from local file (served by Express)
            const C = await TreeSitter.Language.load('./tree-sitter-c.wasm');
            this.parser.setLanguage(C);

            this.ready = true;
            console.log('✓ Tree-sitter C parser ready');
        } catch (error) {
            console.error('Failed to initialize Tree-sitter:', error);
            throw error;
        }
    }

    /**
     * Analyze C code and extract variables/relationships
     */
    async analyze(code) {
        if (!this.ready) {
            await this.init();
        }

        this.variables = [];
        this.relationships = [];
        this.addressCounter = 0x1000;

        // Parse the code
        const tree = this.parser.parse(code);
        const root = tree.rootNode;

        // Walk the AST
        this.walkNode(root);

        return {
            variables: this.variables,
            relationships: this.relationships,
            method: 'tree-sitter'
        };
    }

    /**
     * Walk AST node and extract relevant information
     */
    walkNode(node) {
        switch (node.type) {
            case 'declaration':
                this.processDeclaration(node);
                break;
            case 'expression_statement':
                this.processExpressionStatement(node);
                break;
            case 'struct_specifier':
                // Struct definitions are handled in declarations
                break;
        }

        // Recurse into children
        for (let i = 0; i < node.childCount; i++) {
            this.walkNode(node.child(i));
        }
    }

    /**
     * Process variable declarations
     */
    processDeclaration(node) {
        // Get the type specifier
        let type = '';
        let isStruct = false;
        let structName = '';

        const typeSpec = node.childForFieldName('type');
        if (typeSpec) {
            if (typeSpec.type === 'struct_specifier') {
                isStruct = true;
                const nameNode = typeSpec.childForFieldName('name');
                if (nameNode) {
                    structName = nameNode.text;
                    type = `struct ${structName}`;
                }
            } else if (typeSpec.type === 'primitive_type' || typeSpec.type === 'type_identifier') {
                type = typeSpec.text;
            }
        }

        // Get declarators (variable names)
        const declarator = node.childForFieldName('declarator');
        if (declarator) {
            this.processDeclarator(declarator, type, isStruct, structName);
        }

        // Handle multiple declarators
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child.type === 'init_declarator' || child.type === 'pointer_declarator' ||
                child.type === 'identifier' || child.type === 'array_declarator') {
                this.processDeclarator(child, type, isStruct, structName);
            }
        }
    }

    /**
     * Process a declarator (variable name with optional pointer/array notation)
     */
    processDeclarator(node, type, isStruct, structName) {
        let name = '';
        let pointerLevel = 0;
        let isArray = false;
        let arraySize = null;
        let initValue = null;
        let initTarget = null;

        // Handle different declarator types
        if (node.type === 'init_declarator') {
            // Has initializer: int x = 5;
            const decl = node.childForFieldName('declarator');
            const value = node.childForFieldName('value');

            if (decl) {
                const result = this.extractDeclaratorInfo(decl);
                name = result.name;
                pointerLevel = result.pointerLevel;
                isArray = result.isArray;
                arraySize = result.arraySize;
            }

            if (value) {
                const valueInfo = this.extractValue(value);
                initValue = valueInfo.value;
                initTarget = valueInfo.target;
            }
        } else {
            const result = this.extractDeclaratorInfo(node);
            name = result.name;
            pointerLevel = result.pointerLevel;
            isArray = result.isArray;
            arraySize = result.arraySize;
        }

        if (!name || this.findVariable(name)) return;

        // Create variable entry
        const variable = {
            name,
            type,
            pointerLevel,
            isArray,
            arraySize,
            address: this.getNextAddress(),
            value: initValue,
            isStruct
        };
        this.variables.push(variable);

        // Handle array elements
        if (isArray && arraySize) {
            for (let i = 0; i < arraySize; i++) {
                this.variables.push({
                    name: `${name}[${i}]`,
                    type,
                    pointerLevel: 0,
                    isArray: false,
                    isArrayElement: true,
                    arrayParent: name,
                    arrayIndex: i,
                    address: this.getNextAddress(),
                    value: { type: 'literal', value: '?' },
                    isStruct: false
                });
            }
        }

        // Create relationship if pointing to something
        if (initTarget) {
            this.relationships.push({
                from: name,
                to: initTarget,
                type: 'points_to',
                label: `&${initTarget}`
            });
        }
    }

    /**
     * Extract name and pointer level from declarator
     */
    extractDeclaratorInfo(node) {
        let name = '';
        let pointerLevel = 0;
        let isArray = false;
        let arraySize = null;

        if (node.type === 'pointer_declarator') {
            pointerLevel++;
            // Recurse to find more pointers or the identifier
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child.type === 'pointer_declarator') {
                    const result = this.extractDeclaratorInfo(child);
                    name = result.name;
                    pointerLevel += result.pointerLevel;
                } else if (child.type === 'identifier') {
                    name = child.text;
                } else if (child.text === '*') {
                    // Already counted
                }
            }
        } else if (node.type === 'array_declarator') {
            isArray = true;
            const declNode = node.childForFieldName('declarator');
            const sizeNode = node.childForFieldName('size');

            if (declNode) {
                name = declNode.text;
            }
            if (sizeNode) {
                arraySize = parseInt(sizeNode.text) || 0;
            }
        } else if (node.type === 'identifier') {
            name = node.text;
        }

        return { name, pointerLevel, isArray, arraySize };
    }

    /**
     * Extract value from initializer
     */
    extractValue(node) {
        let value = null;
        let target = null;

        if (node.type === 'number_literal') {
            value = node.text;
        } else if (node.type === 'string_literal') {
            value = node.text;
        } else if (node.type === 'null') {
            value = 'NULL';
        } else if (node.type === 'pointer_expression') {
            // &variable or *pointer
            const op = node.child(0);
            const operand = node.child(1);
            if (op && op.text === '&' && operand) {
                target = operand.text;
                value = `&${target}`;
            }
        } else if (node.type === 'identifier') {
            // Could be array name (decays to pointer)
            value = node.text;
            // Check if this is an array being assigned to a pointer
            const existingArray = this.findVariable(node.text);
            if (existingArray && existingArray.isArray) {
                target = `${node.text}[0]`;
            }
        } else if (node.type === 'initializer_list') {
            // Array initializer {1, 2, 3}
            value = [];
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child.type === 'number_literal' || child.type === 'string_literal') {
                    value.push(child.text);
                }
            }
        }

        return { value, target };
    }

    /**
     * Process expression statements (assignments)
     */
    processExpressionStatement(node) {
        const expr = node.child(0);
        if (!expr || expr.type !== 'assignment_expression') return;

        const left = expr.childForFieldName('left');
        const right = expr.childForFieldName('right');

        if (!left || !right) return;

        // Handle member assignments: node1.next = &node2;
        if (left.type === 'field_expression') {
            const obj = left.childForFieldName('argument');
            const field = left.childForFieldName('field');

            if (obj && field && right.type === 'pointer_expression') {
                const op = right.child(0);
                const target = right.child(1);

                if (op && op.text === '&' && target) {
                    this.relationships.push({
                        from: obj.text,
                        to: target.text,
                        type: 'points_to',
                        label: field.text
                    });
                }
            }
        }

        // Handle direct pointer assignments: p = &x;
        if (left.type === 'identifier' && right.type === 'pointer_expression') {
            const op = right.child(0);
            const target = right.child(1);

            if (op && op.text === '&' && target) {
                // Remove any existing relationship from this variable
                this.relationships = this.relationships.filter(r => r.from !== left.text);

                this.relationships.push({
                    from: left.text,
                    to: target.text,
                    type: 'points_to',
                    label: `&${target.text}`
                });
            }
        }
    }

    findVariable(name) {
        return this.variables.find(v => v.name === name);
    }

    getNextAddress() {
        const addr = `0x${this.addressCounter.toString(16).toUpperCase()}`;
        this.addressCounter += 4;
        return addr;
    }
}

// Export globally for browser use
window.TreeSitterAnalyzer = TreeSitterAnalyzer;
