# C Pointer Visualizer 🔍

A powerful, interactive web-based tool to **visualize C pointers and memory layout** in real-time. It combines static analysis (Tree-sitter) with live debugging (GDB) to generate accurate, dynamically updating diagrams of your code's memory state.

![C Pointer Visualizer Screenshot](https://via.placeholder.com/800x400?text=C+Pointer+Visualizer+Demo)

## ✨ Features

- **Live Pointer Diagrams**: Automatically generates SVG diagrams showing variables and their relationships.
    - **Real Address linking**: Accurate `points-to` arrows based on actual memory addresses from GDB.
    - **Live Updates**: Diagram refreshes automatically as you step through code.
- **Robust Debugging Interface**:
    - **GDB Integration**: Full control over execution (Run, Next, Step, Continue).
    - **Breakpoints**: Click line numbers to toggle breakpoints 🔴.
    - **Variable Inspector**: View local variables, types, and values in real-time.
- **Deep Insights**:
    - **GIMPLE IR View**: See exactly how GCC compiles your code by inspecting the GIMPLE Intermediate Representation.
    - **GDB Console Log**: Full visibility into the underlying GDB commands and responses.
    - **Memory Stack**: Visual stack frame exploration.
- **Modern UI**:
    - Syntax highlighting & Code Editor.
    - Pan & Zoom support for large diagrams.
    - Tabbed interface for multi-faceted debugging data.

## 🛠️ Prerequisites

- **Node.js**: v14+
- **GCC**: Compiler (must support `-fdump-tree-gimple`).
- **GDB**: The GNU Debugger (with MI support).
- **WSL (Windows Users)**: This project relies on WSL (Windows Subsystem for Linux) to run GCC/GDB on Windows machines.

## 🚀 Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/Athens556/c--pointer-visualiser.git
    cd c--pointer-visualiser
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  (Windows Only) Ensure you have WSL installed and GCC/GDB available inside it:
    ```bash
    wsl --install
    wsl sudo apt update
    wsl sudo apt install gcc gdb build-essential
    ```

## 🏃 Usage

1.  Start the server:
    ```bash
    node server.js
    ```
    *or*
    ```bash
    npm run dev
    ```

2.  Open your browser at:
    ```
    http://localhost:3001
    ```

3.  **Visualizing Code**:
    *   Type or paste C code into the editor.
    *   Click **"Debug & Study"** to compile and start the session.
    *   The program will pause at `main`.
    *   Use the toolbar controls (**Next**, **Step**) to execute code line-by-line.
    *   Watch the diagram update instantly!

## 📂 Project Structure

- **`server.js`**: Node.js backend. Handles WebSocket connections, spawns GDB/GCC processes via WSL.
- **`gdb-controller.js`**: Core logic for interacting with GDB via Machine Interface (MI). Handles command tokenization and output parsing.
- **`debugger-ui.js`**: Frontend controller. Manages debugging state, WebSocket communication, and UI updates.
- **`analyzer.js`**: Logic to interpret variable states and determine pointer relationships using real addresses.
- **`renderer.js`**: D3.js/SVG rendering engine for the pointer diagrams.
- **`tree-sitter-analyzer.js`**: Client-side static analysis for initial code parsing.

## 🤝 Contributing

Contributions are welcome! Please fork the repository and submit a Pull Request.

## 📄 License

MIT License.
