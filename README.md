# ⚡ CodeSense - AI-Powered Multi-File Code Analyzer

**CodeSense** is an advanced Visual Studio Code extension that bridges the gap between static AST analysis, whole-codebase dependency graphs, and Generative AI (Google Gemini).

Unlike typical AI assistants (e.g. ChatGPT) that require copying code back and forth or outputting long paragraphs without context, **CodeSense** lives right inside your editor like Python's syntax highlighter and linter:
- 🔴 **Inline Error Squiggles & Range Highlights**: Underlines errors exactly where they occur in your code.
- 🎓 **Beginner-Friendly Teacher Explanations**:
  - **🔴 Error:** Simple error title in plain English.
  - **📍 Location:** Exact file name and line number.
  - **💡 What happened?** 1-2 very simple sentences explaining what went wrong.
  - **🤔 Why did this happen?** Gentle teacher explanation of the underlying language reason.
  - **🔧 How to fix it?** Clear, simple steps to solve the issue.
  - **✅ Corrected Code:** Ready-to-use code snippet with syntax highlighting.
- 🌐 **Whole-Codebase & Cross-File Understanding**: When working across multiple files, CodeSense understands what the entire project does. If an error in `checkout.js` is caused by a missing export or changed function parameters in `mathUtils.js`, CodeSense connects the related files clearly!
- 🗺️ **Project Error Map TreeView**:
  - Live color-coded project overview: `🔴 2+ errors`, `🟠 1 error`, `🟢 No errors`.
  - Displays error counts beside every file in your project.
  - Expand any file to view errors and cross-file dependencies.
  - One-click jump directly to the offending file and line.
  - Auto-updates in real time as code is modified or resolved.
- ✨ **One-Click AI Fix (Native Diff Editor)**:
  - Triggered via Code Actions (`Ctrl+.`), Problems panel, or the Project Error Map.
  - Opens VS Code's **native side-by-side diff editor** showing before ↔ after changes.
  - Interactive **Apply Fix** and **Reject** buttons—code is never modified without your consent.
  - Re-analyzes instantly on apply, clearing resolved errors and preserving remaining ones.
- ⚡ **Interactive QuickFix Lightbulb (`Ctrl+.`)**: Directly apply code fixes with a single click.
- 📊 **Activity Bar Sidebar**:
  - **Project Error Map**: Instant whole-project health map with status indicators.
  - **Detected Issues TreeView**: Browse all workspace errors with beginner-friendly teacher breakdowns.
  - **Multi-File Dependency Graph**: View exported symbols, imports, and cross-file dependencies.

---

## 🚀 Key Features

| Feature | How It Works |
| :--- | :--- |
| **Inline Squiggles** | Visual red/yellow highlights right on the offending lines in the active editor. |
| **Strict 2-Line Format** | Hovering or viewing problems gives: <br>• **Why:** Root cause.<br>• **Fix:** What will solve it. |
| **Cross-File Analysis** | Detects when imported functions change parameter counts, when exports are missing/renamed, and traces errors across files. |
| **Hover Tooltips** | Hover over any squiggly line for rich markdown details, file origin links, and suggested fixes. |
| **One-Click Quick Fix** | Press `Ctrl+.` on an error to automatically insert the suggested fix. |
| **Hybrid Engine** | Works **instantly offline** using built-in AST & Knowledge Graph analysis, and elevates with **Google Gemini** for semantic code reasoning when an API key is configured. |
| **Auto-Scan on Save** | Continuously validates code health as you save files. |

---

## 🛠️ Getting Started & Testing the Extension

### 1. Launch in VS Code
1. Open this repository folder in VS Code.
2. Ensure dependencies are installed and compiled:
   ```bash
   npm install
   npm run compile
   ```
3. You can run automated verification at any time:
   ```bash
   npm run verify
   ```
4. Press **`F5`** (or go to **Run and Debug** -> click **Run Extension**).
5. A new **[Extension Development Host]** VS Code window will open with CodeSense loaded!

### 2. Test with the Included Demo Files
In the Extension Development Host window:
1. Open [`demo/checkout.js`](./demo/checkout.js).
2. Notice the inline squiggles highlighting:
   - Line 1: `shippingFee` is imported from `./mathUtils`, but `./mathUtils` does not export it!
   - Line 8: `calculateDiscount(cartTotal)` is called with 1 argument, but `./mathUtils` requires 2 arguments `(price, rate)`!
3. Hover over the squiggly lines to see the beginner-friendly card:
   ```markdown
   ### ⚡ CodeSense

   **🔴 Error:** Missing Function Input

   **📍 Location:** `checkout.js – Line 4`

   **💡 What happened?**
   You called 'calculateDiscount()' with 1 input, but it needs 2 inputs (price, rate).

   **🤔 Why did this happen?**
   'calculateDiscount' in 'mathUtils.js' needs 2 inputs (price, rate). Without all inputs, the function gets empty data and cannot calculate the result.

   **🔧 How to fix it?**
   Provide the missing input (rate) inside 'calculateDiscount()', or make that input optional in 'mathUtils.js'.

   🌐 **Connected File:** `demo/mathUtils.js`

   **✅ Corrected Code:**
   ```javascript
   calculateDiscount(price, rate)
   ```
   ```
4. Click on the **CodeSense icon** in the left Activity Bar to view the issues list and the dependency graph.

---

## 🔑 Configuring Your Google Gemini API Key

CodeSense works out of the box with its built-in AST Knowledge Graph engine. To enable deep semantic AI reasoning with Google Gemini:
1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run:
   ```text
   CodeSense: Configure Gemini API Key
   ```
3. Paste your Gemini API Key (saved securely in VS Code SecretStorage).
4. You can also set it via the `GEMINI_API_KEY` environment variable or in VS Code Settings (`codesense.geminiApiKey`).

---

## ⌨️ Extension Commands

| Command | Description |
| :--- | :--- |
| `CodeSense: Analyze Current File` | Scans the active file and highlights issues with inline squiggles. |
| `CodeSense: Analyze Entire Workspace` | Scans all files across the project and reports cross-file errors. |
| `CodeSense: Configure Gemini API Key` | Securely stores your Gemini API Key. |
| `CodeSense: Clear All Diagnostics` | Clears all active squiggles and issue markers. |
| `CodeSense: Focus Codebase Graph View` | Opens the Codebase Dependency Graph in the sidebar. |

---

## 📁 Project Architecture

- [`src/graph.ts`](./src/graph.ts): Workspace & multi-file AST dependency graph builder using `@babel/parser` and `@babel/traverse`.
- [`src/analyzer.ts`](./src/analyzer.ts): Hybrid analyzer combining local cross-file graph analysis with Gemini Generative AI.
- [`src/diagnostics.ts`](./src/diagnostics.ts): Manages `vscode.DiagnosticCollection`, `HoverProvider`, and `CodeActionProvider` (QuickFix).
- [`src/treeView.ts`](./src/treeView.ts): VS Code Activity Bar sidebar views for Issues and Codebase Graph.
- [`src/config.ts`](./src/config.ts): Manages API key security via VS Code `SecretStorage` and extension settings.
- [`src/extension.ts`](./src/extension.ts): Main extension lifecycle, command handlers, status bar, and auto-save listeners.
