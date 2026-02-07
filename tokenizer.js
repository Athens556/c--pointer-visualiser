/**
 * C Code Tokenizer
 * Tokenizes C source code into meaningful tokens for pointer analysis
 */

class CTokenizer {
    constructor() {
        // C keywords
        this.keywords = new Set([
            'auto', 'break', 'case', 'char', 'const', 'continue', 'default',
            'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto',
            'if', 'inline', 'int', 'long', 'register', 'restrict', 'return',
            'short', 'signed', 'sizeof', 'static', 'struct', 'switch',
            'typedef', 'union', 'unsigned', 'void', 'volatile', 'while',
            '_Bool', '_Complex', '_Imaginary'
        ]);

        // Type keywords (subset for easier type detection)
        this.types = new Set([
            'char', 'int', 'float', 'double', 'void', 'short', 'long',
            'signed', 'unsigned', 'struct', 'union', 'enum'
        ]);

        // Multi-character operators
        this.multiCharOperators = [
            '->',  // Member access through pointer
            '++', '--',  // Increment/decrement
            '<<', '>>',  // Bit shifts
            '<=', '>=', '==', '!=',  // Comparisons
            '&&', '||',  // Logical
            '+=', '-=', '*=', '/=', '%=',  // Compound assignment
            '&=', '|=', '^=', '<<=', '>>='
        ];

        // Single-character operators
        this.operators = new Set([
            '+', '-', '*', '/', '%',  // Arithmetic
            '&', '|', '^', '~',       // Bitwise
            '!', '<', '>', '=',       // Comparison/assignment
            '?', ':'                   // Ternary
        ]);

        // Symbols/punctuation
        this.symbols = new Set([
            '{', '}', '(', ')', '[', ']',
            ';', ',', '.'
        ]);
    }

    /**
     * Tokenize C source code
     * @param {string} code - C source code
     * @returns {Array} Array of token objects
     */
    tokenize(code) {
        const tokens = [];
        let pos = 0;
        let line = 1;
        let column = 1;

        while (pos < code.length) {
            const startLine = line;
            const startColumn = column;
            const char = code[pos];

            // Skip whitespace
            if (/\s/.test(char)) {
                if (char === '\n') {
                    line++;
                    column = 1;
                } else {
                    column++;
                }
                pos++;
                continue;
            }

            // Skip single-line comments
            if (char === '/' && code[pos + 1] === '/') {
                while (pos < code.length && code[pos] !== '\n') {
                    pos++;
                    column++;
                }
                continue;
            }

            // Skip multi-line comments
            if (char === '/' && code[pos + 1] === '*') {
                pos += 2;
                column += 2;
                while (pos < code.length - 1) {
                    if (code[pos] === '*' && code[pos + 1] === '/') {
                        pos += 2;
                        column += 2;
                        break;
                    }
                    if (code[pos] === '\n') {
                        line++;
                        column = 1;
                    } else {
                        column++;
                    }
                    pos++;
                }
                continue;
            }

            // String literals
            if (char === '"') {
                let value = '"';
                pos++;
                column++;
                while (pos < code.length && code[pos] !== '"') {
                    if (code[pos] === '\\' && pos + 1 < code.length) {
                        value += code[pos] + code[pos + 1];
                        pos += 2;
                        column += 2;
                    } else {
                        value += code[pos];
                        pos++;
                        column++;
                    }
                }
                if (pos < code.length) {
                    value += '"';
                    pos++;
                    column++;
                }
                tokens.push({
                    type: 'STRING',
                    value,
                    line: startLine,
                    column: startColumn
                });
                continue;
            }

            // Character literals
            if (char === "'") {
                let value = "'";
                pos++;
                column++;
                while (pos < code.length && code[pos] !== "'") {
                    if (code[pos] === '\\' && pos + 1 < code.length) {
                        value += code[pos] + code[pos + 1];
                        pos += 2;
                        column += 2;
                    } else {
                        value += code[pos];
                        pos++;
                        column++;
                    }
                }
                if (pos < code.length) {
                    value += "'";
                    pos++;
                    column++;
                }
                tokens.push({
                    type: 'CHAR_LITERAL',
                    value,
                    line: startLine,
                    column: startColumn
                });
                continue;
            }

            // Numbers
            if (/\d/.test(char) || (char === '.' && /\d/.test(code[pos + 1]))) {
                let value = '';
                // Hex
                if (char === '0' && (code[pos + 1] === 'x' || code[pos + 1] === 'X')) {
                    value = '0x';
                    pos += 2;
                    column += 2;
                    while (pos < code.length && /[0-9a-fA-F]/.test(code[pos])) {
                        value += code[pos];
                        pos++;
                        column++;
                    }
                } else {
                    // Decimal or float
                    while (pos < code.length && /[\d.]/.test(code[pos])) {
                        value += code[pos];
                        pos++;
                        column++;
                    }
                    // Scientific notation
                    if (pos < code.length && (code[pos] === 'e' || code[pos] === 'E')) {
                        value += code[pos];
                        pos++;
                        column++;
                        if (pos < code.length && (code[pos] === '+' || code[pos] === '-')) {
                            value += code[pos];
                            pos++;
                            column++;
                        }
                        while (pos < code.length && /\d/.test(code[pos])) {
                            value += code[pos];
                            pos++;
                            column++;
                        }
                    }
                }
                // Suffix (f, l, u, etc.)
                while (pos < code.length && /[fFlLuU]/.test(code[pos])) {
                    value += code[pos];
                    pos++;
                    column++;
                }
                tokens.push({
                    type: 'NUMBER',
                    value,
                    line: startLine,
                    column: startColumn
                });
                continue;
            }

            // Identifiers and keywords
            if (/[a-zA-Z_]/.test(char)) {
                let value = '';
                while (pos < code.length && /[a-zA-Z0-9_]/.test(code[pos])) {
                    value += code[pos];
                    pos++;
                    column++;
                }
                
                let type = 'IDENTIFIER';
                if (this.keywords.has(value)) {
                    type = 'KEYWORD';
                }
                if (this.types.has(value)) {
                    type = 'TYPE';
                }
                
                tokens.push({
                    type,
                    value,
                    line: startLine,
                    column: startColumn
                });
                continue;
            }

            // Multi-character operators
            let foundMultiOp = false;
            for (const op of this.multiCharOperators) {
                if (code.substring(pos, pos + op.length) === op) {
                    tokens.push({
                        type: 'OPERATOR',
                        value: op,
                        line: startLine,
                        column: startColumn
                    });
                    pos += op.length;
                    column += op.length;
                    foundMultiOp = true;
                    break;
                }
            }
            if (foundMultiOp) continue;

            // Single-character operators
            if (this.operators.has(char)) {
                tokens.push({
                    type: 'OPERATOR',
                    value: char,
                    line: startLine,
                    column: startColumn
                });
                pos++;
                column++;
                continue;
            }

            // Symbols
            if (this.symbols.has(char)) {
                tokens.push({
                    type: 'SYMBOL',
                    value: char,
                    line: startLine,
                    column: startColumn
                });
                pos++;
                column++;
                continue;
            }

            // Preprocessor directives - skip for now
            if (char === '#') {
                while (pos < code.length && code[pos] !== '\n') {
                    pos++;
                    column++;
                }
                continue;
            }

            // Unknown character - skip
            pos++;
            column++;
        }

        return tokens;
    }

    /**
     * Check if a value is a type keyword
     * @param {string} value 
     * @returns {boolean}
     */
    isType(value) {
        return this.types.has(value);
    }
}

// Export for use
window.CTokenizer = CTokenizer;
