# C Pointer Visualizer

A browser-based tool for learning C pointers through diagrams. It can run quick client-side static analysis, inspect GCC/GIMPLE output through WSL, or start a live GDB session that updates the pointer diagram while you step through code.

## Features

- **Explicit visualization modes**: choose Static, GCC/GIMPLE, or Live GDB from the dropdown instead of relying on automatic fallback.
- **VS Code-style editor**: Monaco Editor powers the C code pane with syntax highlighting, gutter markers, and keyboard-friendly editing.
- **Interactive pointer diagrams**: Cytoscape.js renders variables and pointer relationships with pan, zoom, and reset controls.
- **Live GDB debugging**: compile, run, step over, step into, continue, and stop from the browser.
- **Variable inspector**: view locals, parameters, pointer values, dereferenced expressions, stack frames, GDB logs, GIMPLE IR, and program output.
- **Address-based linking**: live diagrams connect pointers to the variable or struct node that owns the pointed-to address.
- **Struct and linked-list support**: GDB mode expands struct pointers and follows common `next` chains for easier linked-list visualization.

## Visualization Modes

- **Static (Client-side)** uses the local tokenizer and analyzer in the browser. It is fast and works without GCC/GDB, but it is approximate.
- **Static via GCC/GIMPLE (WSL)** sends the code to the backend and uses GCC's GIMPLE output for analysis. If GIMPLE fails, the app reports the error instead of silently falling back.
- **Live via GDB (WSL)** compiles with debug symbols, starts GDB/MI, and refreshes variables plus the diagram on every step.

## Prerequisites

- Node.js 18 or newer is recommended.
- npm for installing dependencies.
- WSL on Windows for GCC/GDB-backed modes.
- GCC and GDB installed inside WSL.

Install the WSL toolchain with:

```bash
sudo apt update
sudo apt install gcc gdb build-essential
```

## Setup

```bash
git clone https://github.com/Athens556/c--pointer-visualiser.git
cd c--pointer-visualiser
npm install
npm start
```

Then open:

```text
http://localhost:3001
```

For development with auto-restart:

```bash
npm run dev
```

## Usage

1. Paste or type C code into the Monaco editor.
2. Pick a visualization mode from the dropdown.
3. Use **Analyze** for static modes.
4. Use **Start Debug Session** / **Debug & Study** for live GDB mode.
5. Step through code with **Run**, **Next**, **Step**, and **Continue**.
6. Watch the Variables panel and Pointer Diagram update after each pause.

## Project Structure

- `index.html`: Main page and script loading order.
- `app.js`: App orchestration, Monaco setup, mode selection, static analysis flow, and diagram refreshes.
- `tokenizer.js`: Lightweight C tokenizer for client-side static analysis.
- `analyzer.js`: Client-side pointer analyzer for static mode.
- `gcc-parser.js`: Server-side GCC/GIMPLE parsing helpers.
- `server.js`: Express/WebSocket backend for analysis and debugging commands.
- `gdb-controller.js`: GDB/MI process controller, parser, variable expansion, and live state collection.
- `debugger-ui.js`: Browser WebSocket client, debug controls, variables table, output tabs, and live diagram updates.
- `renderer.js`: Cytoscape-based pointer diagram renderer.
- `examples.js`: Built-in example programs.
- `styles.css`: Application layout, editor, diagram, and debugger styling.

## Notes

- Live debugging currently targets the generated temporary C file used by the backend.
- The client-side static mode is intentionally lightweight and will not understand every C construct.
- GCC/GIMPLE and GDB modes require WSL because the backend invokes Linux toolchain commands from Windows.

## License

MIT License.
