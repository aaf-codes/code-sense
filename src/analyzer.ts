import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CodeIssue } from './types';
import { CodebaseGraphManager } from './graph';
import { ConfigManager } from './config';

export class CodeAnalyzer {
    private graphManager: CodebaseGraphManager;

    constructor(graphManager: CodebaseGraphManager) {
        this.graphManager = graphManager;
    }

    /**
     * Main entry point to analyze a document: Runs Local AST + Cross-File Knowledge Graph,
     * and augments with Gemini AI if an API key is available.
     */
    public async analyzeDocument(document: vscode.TextDocument): Promise<CodeIssue[]> {
        const issues: CodeIssue[] = [];
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const relPath = path.relative(rootPath, document.fileName).replace(/\\/g, '/');
        const docVersion = document.version;

        // 1. Run local AST and Cross-File Knowledge Graph checks
        const localIssues = this.runLocalCrossFileAnalysis(document, relPath);
        issues.push(...localIssues);

        // 2. Check if Gemini AI is configured
        const configManager = ConfigManager.getInstance();
        const apiKey = await configManager.getApiKey();

        if (apiKey) {
            try {
                const aiIssues = await this.runGeminiAnalysis(document, relPath, apiKey);
                // Ensure document was not modified while Gemini AI analysis was processing
                if (document.version === docVersion) {
                    // Enrich local issues or append novel issues detected by Gemini AI
                    for (const aiIssue of aiIssues) {
                        const matchingLocal = issues.find(i => {
                            if (i.line === aiIssue.line) {
                                const sameSymbol = aiIssue.relatedSymbol && (i.relatedSymbol === aiIssue.relatedSymbol || i.cause.includes(aiIssue.relatedSymbol));
                                const sameName = i.errorName && aiIssue.errorName && i.errorName.toLowerCase() === aiIssue.errorName.toLowerCase();
                                const colonIssue = (i.cause.includes(':') || (i.errorName || '').includes('Colon')) &&
                                                   ((aiIssue.cause || '').includes(':') || (aiIssue.errorName || '').includes('Colon'));
                                if (sameSymbol || sameName || colonIssue) {
                                    return true;
                                }
                            }
                            return false;
                        });

                        if (matchingLocal) {
                            // Enrich local issue with deep AI explanations if local is brief
                            if (aiIssue.whyFixCorrect && !matchingLocal.whyFixCorrect) {
                                matchingLocal.whyFixCorrect = aiIssue.whyFixCorrect;
                            }
                            if (aiIssue.sideEffects && !matchingLocal.sideEffects) {
                                matchingLocal.sideEffects = aiIssue.sideEffects;
                            }
                            if (aiIssue.whatHappened && matchingLocal.whatHappened === matchingLocal.cause) {
                                matchingLocal.whatHappened = aiIssue.whatHappened;
                            }
                        } else {
                            issues.push(aiIssue);
                        }
                    }
                }
            } catch (err: any) {
                console.warn('CodeSense: Gemini AI analysis skipped or errored:', err?.message || err);
            }
        }

        return issues;
    }

    /**
     * Local AST & Cross-file static analysis using the Project Dependency Graph
     */
    public runLocalCrossFileAnalysis(document: vscode.TextDocument, relPath: string): CodeIssue[] {
        const issues: CodeIssue[] = [];
        const graph = this.graphManager.getGraph();
        let node = graph.nodes.get(relPath);

        // Ensure standalone files (without an open workspace folder) are always indexed
        if (!node) {
            this.graphManager.indexDocument(document);
            node = this.graphManager.getGraph().nodes.get(relPath);
        }

        if (!node) {
            node = {
                filePath: relPath,
                fileName: path.basename(relPath),
                exports: [],
                imports: [],
                calls: [],
                updatedAt: Date.now()
            };
        }

        const text = document.getText();
        const lines = text.split('\n');
        const currentFileName = path.basename(relPath);
        const ext = path.extname(currentFileName).toLowerCase();
        const langId = document.languageId || '';

        // 1. Cross-File Dependency & Export/Import Analysis
        this.analyzeCrossFileDependencies(document, relPath, lines, node, graph, issues);

        // 2. Language-Specific Static & Semantic Analyzers
        if (langId === 'python' || ext === '.py') {
            this.analyzePython(document, relPath, lines, node, graph, issues);
        } else if (langId.includes('javascript') || langId.includes('typescript') || ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
            this.analyzeJavaScript(document, relPath, lines, node, graph, issues);
        } else if (langId === 'java' || ext === '.java') {
            this.analyzeJava(document, relPath, lines, issues);
        } else if (langId === 'html' || ['.html', '.htm'].includes(ext)) {
            this.analyzeHTML(document, relPath, lines, issues);
        } else if (langId === 'css' || ext === '.css') {
            this.analyzeCSS(document, relPath, lines, issues);
        }

        return issues;
    }

    /**
     * Cross-File Dependency & Function Signature Checker
     */
    private analyzeCrossFileDependencies(
        document: vscode.TextDocument,
        relPath: string,
        lines: string[],
        node: any,
        graph: any,
        issues: CodeIssue[]
    ): void {
        const currentFileName = path.basename(relPath);

        // Check 1: Cross-File Missing Exports
        for (const imp of node.imports) {
            const targetEdge = graph.edges.find((e: any) => e.fromFile === relPath && e.symbol === imp.symbol);
            if (targetEdge) {
                const targetNode = graph.nodes.get(targetEdge.toFile);
                if (targetNode) {
                    const hasExport = targetNode.exports.some((e: any) => e.name === imp.symbol || e.kind === 'default');
                    if (!hasExport) {
                        const lineIndex = Math.max(0, imp.line - 1);
                        const lineText = lines[lineIndex] || '';
                        const startChar = Math.max(0, lineText.indexOf(imp.symbol));
                        const endChar = startChar + imp.symbol.length;

                        const targetFileName = path.basename(targetEdge.toFile);
                        const isPython = currentFileName.endsWith('.py') || targetFileName.endsWith('.py');

                        let suggestedSymbol: string | undefined;
                        for (const exp of targetNode.exports) {
                            if (exp.kind === 'function') {
                                const impSuffix = imp.symbol.split('_').pop() || '';
                                const expSuffix = exp.name.split('_').pop() || '';
                                if (impSuffix.length > 2 && expSuffix.length > 2 && impSuffix === expSuffix) {
                                    suggestedSymbol = exp.name;
                                    break;
                                }
                            }
                        }

                        const errorName = isPython ? 'Missing Function' : 'Missing Function or Value';
                        const locationText = `${currentFileName} – Line ${imp.line}`;
                        const whatHappened = `Your ${currentFileName} file is trying to use '${imp.symbol}', but we couldn't find it in ${targetFileName}.`;
                        const whyHappened = suggestedSymbol
                            ? `'${targetFileName}' does not export '${imp.symbol}'. However, it does have a function called '${suggestedSymbol}'.`
                            : isPython
                            ? `The function might have a different name, or you may have forgotten to create it in '${targetFileName}'.`
                            : `Files keep code private by default. '${imp.symbol}' was never exported from '${targetEdge.toFile}', so this file cannot see or use it.`;

                        const howToFix = suggestedSymbol
                            ? `Change '${imp.symbol}' to '${suggestedSymbol}', or create '${imp.symbol}' inside '${targetFileName}'.`
                            : isPython
                            ? `Check ${targetFileName} and make sure the function exists with the correct name.`
                            : `Check '${targetFileName}' and make sure '${imp.symbol}' exists with 'export' in front of it.`;

                        const correctedCode = suggestedSymbol
                            ? (isPython ? `from ${path.basename(targetEdge.toFile, '.py')} import ${suggestedSymbol}` : `import { ${suggestedSymbol} } from './${path.basename(targetEdge.toFile, path.extname(targetEdge.toFile))}'`)
                            : (isPython ? `# Inside ${targetFileName}:\ndef ${imp.symbol}():\n    pass` : `export const ${imp.symbol} = ...; // Inside ${targetFileName}`);

                        const replacementCode = suggestedSymbol ? suggestedSymbol : undefined;

                        issues.push({
                            id: `missing-export-${relPath}-${imp.line}`,
                            fileUri: document.uri,
                            line: imp.line,
                            startChar: startChar >= 0 ? startChar : 0,
                            endChar: endChar > startChar ? endChar : lineText.length,
                            severity: vscode.DiagnosticSeverity.Error,
                            errorName,
                            locationText,
                            whatHappened,
                            whyHappened,
                            howToFix,
                            whyFixCorrect: `Using the correct exported symbol allows the module loader to bind the reference properly.`,
                            sideEffects: `Functions calling '${imp.symbol}' will now execute without an import error.`,
                            correctedCode,
                            cause: `Files keep code private by default. '${imp.symbol}' was never exported from '${targetEdge.toFile}', so this file cannot see or use it.`,
                            fix: howToFix,
                            relatedFile: targetEdge.toFile,
                            relatedSymbol: imp.symbol,
                            replacementCode,
                            source: 'codesense-ast'
                        });
                    }
                }
            }
        }

        // Check 2: Cross-File Function Signature / Parameter Count Mismatches
        for (const call of node.calls) {
            const importedEdge = graph.edges.find((e: any) => e.fromFile === relPath && e.symbol === call.name);
            let targetNode = importedEdge ? graph.nodes.get(importedEdge.toFile) : undefined;
            let targetFile = importedEdge ? importedEdge.toFile : undefined;

            if (!targetNode) {
                const localExport = node.exports.find((e: any) => e.name === call.name && e.kind === 'function');
                if (localExport) {
                    targetNode = node;
                    targetFile = relPath;
                }
            }

            if (targetNode) {
                const targetExport = targetNode.exports.find((e: any) => e.name === call.name && e.kind === 'function');

                if (targetExport && targetExport.params) {
                    const expectedCount = targetExport.params.length;
                    if (call.argCount < expectedCount) {
                        const lineIndex = Math.max(0, call.line - 1);
                        const lineText = lines[lineIndex] || '';
                        const startChar = Math.max(0, lineText.indexOf(call.name));
                        const closingParen = lineText.indexOf(')', startChar);
                        const endChar = closingParen !== -1 ? closingParen + 1 : startChar + call.name.length;

                        const missingParams = targetExport.params.slice(call.argCount).join(', ');
                        const expectedParamsList = targetExport.params.join(', ');
                        const targetFileName = targetFile ? path.basename(targetFile) : currentFileName;

                        const existingArgs = closingParen !== -1 ? lineText.slice(lineText.indexOf('(', startChar) + 1, closingParen).trim() : '';
                        const correctedCallArgs = existingArgs.length > 0 ? `${existingArgs}, ${missingParams}` : targetExport.params.join(', ');
                        const correctedCode = `${call.name}(${correctedCallArgs})`;

                        const errorName = 'Missing Function Input';
                        const locationText = `${currentFileName} – Line ${call.line}`;
                        const whatHappened = `You called '${call.name}()' with ${call.argCount} input${call.argCount === 1 ? '' : 's'}, but it needs ${expectedCount} input${expectedCount === 1 ? '' : 's'} (${expectedParamsList}).`;
                        const whyHappened = `'${call.name}' in '${targetFileName}' needs ${expectedCount} inputs (${expectedParamsList}). Without all inputs, the function gets empty data and cannot calculate the result.`;
                        const howToFix = `Provide the missing input (${missingParams}) inside '${call.name}()', or make that input optional in '${targetFileName}'.`;

                        issues.push({
                            id: `sig-mismatch-${relPath}-${call.line}`,
                            fileUri: document.uri,
                            line: call.line,
                            startChar: startChar >= 0 ? startChar : 0,
                            endChar: endChar > startChar ? endChar : lineText.length,
                            severity: vscode.DiagnosticSeverity.Error,
                            errorName,
                            locationText,
                            whatHappened,
                            whyHappened,
                            howToFix,
                            whyFixCorrect: `Passing all required parameters satisfies the function's contract and prevents missing argument errors.`,
                            sideEffects: `Ensure the argument values passed match the expected types.`,
                            correctedCode,
                            cause: `'${call.name}' needs ${expectedCount} inputs (${expectedParamsList}). Without all inputs, the function gets empty data and cannot calculate the result.`,
                            fix: `Provide the missing input (${missingParams}) inside '${call.name}()'.`,
                            relatedFile: targetFile !== relPath ? targetFile : undefined,
                            relatedSymbol: call.name,
                            replacementCode: correctedCode,
                            source: 'codesense-ast'
                        });
                    }

                    if (targetExport.isAsync) {
                        const lineIndex = Math.max(0, call.line - 1);
                        const lineText = lines[lineIndex] || '';
                        if (!lineText.includes('await') && !lineText.includes('.then(')) {
                            const startChar = Math.max(0, lineText.indexOf(call.name));
                            const errorName = 'Missing await Keyword';
                            const locationText = `${currentFileName} – Line ${call.line}`;
                            const whatHappened = `You called the async function '${call.name}()' without using 'await'.`;
                            const whyHappened = `'${call.name}' is an async function that needs time to finish in the background. Without 'await', your code moves ahead before the result is ready.`;
                            const howToFix = `Add 'await' before '${call.name}()' to wait for the result.`;
                            const correctedCode = `await ${call.name}(`;

                            issues.push({
                                id: `async-mismatch-${relPath}-${call.line}`,
                                fileUri: document.uri,
                                line: call.line,
                                startChar: startChar >= 0 ? startChar : 0,
                                endChar: startChar + call.name.length,
                                severity: vscode.DiagnosticSeverity.Warning,
                                errorName,
                                locationText,
                                whatHappened,
                                whyHappened,
                                howToFix,
                                whyFixCorrect: `'await' suspends execution until the Promise settles, ensuring the resolved value is returned.`,
                                sideEffects: `The enclosing function must be marked as 'async'.`,
                                correctedCode,
                                cause: `'${call.name}' is an async function that needs time to finish. Without 'await', your code moves ahead before the result is ready.`,
                                fix: `Add 'await' before '${call.name}()' to wait for the result.`,
                                relatedFile: targetFile !== relPath ? targetFile : undefined,
                                relatedSymbol: call.name,
                                replacementCode: correctedCode,
                                source: 'codesense-ast'
                            });
                        }
                    }
                }
            }
        }
    }

    /**
     * Executes the dedicated Python AST and Semantic analyzer script.
     * Communicates via stdin/stdout with high performance (<15ms).
     */
    private runPythonSubprocessAnalyzer(
        document: vscode.TextDocument,
        relPath: string
    ): CodeIssue[] | null {
        try {
            const candidatePaths = [
                path.join(__dirname, 'py_analyzer.py'),
                path.join(__dirname, '../src/py_analyzer.py'),
                path.join(process.cwd(), 'src/py_analyzer.py'),
                path.join(process.cwd(), 'out/py_analyzer.py')
            ];

            let scriptPath = '';
            for (const p of candidatePaths) {
                if (fs.existsSync(p)) {
                    scriptPath = p;
                    break;
                }
            }

            if (!scriptPath) {
                return null;
            }

            const code = document.getText();
            const currentFileName = path.basename(relPath);
            const pythonCommands = ['python', 'py', 'python3'];

            for (const cmd of pythonCommands) {
                try {
                    const proc = spawnSync(cmd, [scriptPath, currentFileName], {
                        input: code,
                        encoding: 'utf8',
                        timeout: 4000
                    });

                    if (proc.status === 0 && proc.stdout && proc.stdout.trim().startsWith('[')) {
                        const rawIssues = JSON.parse(proc.stdout);
                        if (Array.isArray(rawIssues)) {
                            return rawIssues.map((item: any, idx: number) => ({
                                id: `py-ast-${relPath}-${item.line}-${item.startChar}-${idx}`,
                                fileUri: document.uri,
                                line: item.line,
                                startChar: item.startChar >= 0 ? item.startChar : 0,
                                endChar: item.endChar || (item.startChar + 1),
                                severity: item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
                                errorName: item.errorName,
                                locationText: `${currentFileName} – Line ${item.line}`,
                                whatHappened: item.whatHappened,
                                whyHappened: item.whyHappened,
                                howToFix: item.howToFix,
                                whyFixCorrect: item.whyFixCorrect || 'This fix conforms to standard Python language specifications.',
                                sideEffects: item.sideEffects || 'None.',
                                correctedCode: item.correctedCode || '',
                                cause: item.whatHappened,
                                fix: item.howToFix,
                                replacementCode: item.replacementCode || item.correctedCode || undefined,
                                source: 'codesense-ast'
                            }));
                        }
                    }
                } catch {
                    // Try next command
                }
            }
        } catch {
            // Subprocess not available
        }
        return null;
    }

    /**
     * Comprehensive Python Static, Semantic, Runtime & Logic Analyzer
     * Runs both native Python AST analysis (if python available) and resilient TypeScript multi-pass rules.
     * Never stops after finding one error; analyzes all code blocks and lines.
     */
    private analyzePython(
        document: vscode.TextDocument,
        relPath: string,
        lines: string[],
        node: any,
        graph: any,
        issues: CodeIssue[]
    ): void {
        const currentFileName = path.basename(relPath);

        // 1. Try Native Python AST & Symtable Engine (<15ms)
        const pyEngineIssues = this.runPythonSubprocessAnalyzer(document, relPath);
        if (pyEngineIssues !== null) {
            for (const pIssue of pyEngineIssues) {
                issues.push(pIssue);
            }
            return;
        }

        // 2. Pure TypeScript Multi-Pass Fallback (runs ONLY if Python is not on PATH or failed)
        const builtins = new Set([
            'print', 'len', 'sum', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'bool',
            'type', 'isinstance', 'enumerate', 'zip', 'min', 'max', 'abs', 'round', 'open', 'input',
            'super', 'True', 'False', 'None', 'self', 'cls', 'Exception', 'ValueError', 'TypeError',
            'KeyError', 'IndexError', 'ZeroDivisionError', 'NameError', 'getattr', 'setattr', 'hasattr',
            'sorted', 'reversed', 'all', 'any', 'map', 'filter', 'iter', 'next', 'id'
        ]);

        const assignedVars = new Map<string, { type: 'string' | 'number' | 'list' | 'dict' | 'unknown', line: number }>();
        const assignedFunctions = new Set<string>();
        const importedSymbols = new Set<string>();
        const definedDictKeys = new Set<string>();

        // Pre-pass: Index top-level imports, function definitions, and dictionary keys
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            const dictMatches = trimmed.matchAll(/["']([a-zA-Z0-9_]+)["']\s*:/g);
            for (const m of dictMatches) {
                definedDictKeys.add(m[1]);
            }
            const defMatch = trimmed.match(/^def\s+([a-zA-Z0-9_]+)\s*\(/);
            if (defMatch) {
                assignedFunctions.add(defMatch[1]);
            }
            const classMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)/);
            if (classMatch) {
                assignedFunctions.add(classMatch[1]);
            }
            const fromImpMatch = trimmed.match(/^from\s+[a-zA-Z0-9_.]+\s+import\s+(.+)$/);
            if (fromImpMatch) {
                fromImpMatch[1].split(',').forEach(s => importedSymbols.add(s.trim()));
            }
            const impMatch = trimmed.match(/^import\s+([a-zA-Z0-9_]+)/);
            if (impMatch) {
                importedSymbols.add(impMatch[1]);
            }
        }

        // Bracket balance tracking
        const bracketStack: Array<{ char: string; line: number; col: number }> = [];
        const bracketPairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
        const openingBrackets: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const lineNum = i + 1;
            const cleanLine = rawLine.split('#')[0];
            let inStr = false;
            let quoteChar: string | null = null;

            for (let c = 0; c < cleanLine.length; c++) {
                const char = cleanLine[c];
                if (char === '"' || char === "'") {
                    if (!inStr) {
                        inStr = true;
                        quoteChar = char;
                    } else if (quoteChar === char && (c === 0 || cleanLine[c - 1] !== '\\')) {
                        inStr = false;
                    }
                } else if (!inStr) {
                    if (openingBrackets[char]) {
                        bracketStack.push({ char, line: lineNum, col: c });
                    } else if (bracketPairs[char]) {
                        if (bracketStack.length > 0 && bracketStack[bracketStack.length - 1].char === bracketPairs[char]) {
                            bracketStack.pop();
                        } else {
                            issues.push({
                                id: `py-mismatched-bracket-${lineNum}-${c}`,
                                fileUri: document.uri,
                                line: lineNum,
                                startChar: c,
                                endChar: c + 1,
                                severity: vscode.DiagnosticSeverity.Error,
                                errorName: `Mismatched Bracket '${char}'`,
                                locationText: `${currentFileName} – Line ${lineNum}`,
                                whatHappened: `Closing bracket '${char}' has no matching opening bracket.`,
                                whyHappened: `Every closing bracket in Python must correspond to an opening bracket of the same type.`,
                                howToFix: `Remove '${char}' or add the matching opening bracket '${bracketPairs[char]}'.`,
                                whyFixCorrect: `Brackets must be properly balanced.`,
                                sideEffects: `None.`,
                                correctedCode: rawLine.slice(0, c) + rawLine.slice(c + 1),
                                replacementCode: rawLine.slice(0, c) + rawLine.slice(c + 1),
                                cause: `Closing bracket '${char}' has no matching opening bracket.`,
                                fix: `Remove '${char}' or add opening bracket '${bracketPairs[char]}'.`,
                                source: 'codesense-ast'
                            });
                        }
                    }
                }
            }
        }

        for (const b of bracketStack) {
            const targetLine = lines[b.line - 1] || '';
            issues.push({
                id: `py-unclosed-bracket-${b.line}-${b.col}`,
                fileUri: document.uri,
                line: b.line,
                startChar: b.col,
                endChar: b.col + 1,
                severity: vscode.DiagnosticSeverity.Error,
                errorName: `Unclosed Bracket '${b.char}'`,
                locationText: `${currentFileName} – Line ${b.line}`,
                whatHappened: `Opening bracket '${b.char}' is never closed.`,
                whyHappened: `In Python, all brackets must be closed with '${openingBrackets[b.char]}' before block or file ends.`,
                howToFix: `Add closing '${openingBrackets[b.char]}' before the end of the statement.`,
                whyFixCorrect: `Proper bracket pairing is required by Python syntax.`,
                sideEffects: `None.`,
                correctedCode: targetLine + openingBrackets[b.char],
                replacementCode: targetLine + openingBrackets[b.char],
                cause: `Opening bracket '${b.char}' is never closed.`,
                fix: `Add closing bracket '${openingBrackets[b.char]}'.`,
                source: 'codesense-ast'
            });
        }

        let currentScopeParams = new Set<string>();

        // Multi-pass line-by-line inspection (NO continue statements skipping other checks!)
        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const lineNum = i + 1;
            const trimmed = rawLine.trim();

            if (trimmed.startsWith('#') || trimmed.length === 0) {
                continue;
            }

            // 1. Extra Colon (::)
            if (/::+\s*$/.test(trimmed)) {
                const colIdx = rawLine.lastIndexOf('::');
                issues.push({
                    id: `py-extra-colon-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: colIdx,
                    endChar: rawLine.length,
                    severity: vscode.DiagnosticSeverity.Error,
                    errorName: 'Extra Colon (::)',
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: `You typed two colons (::) at the end of the line instead of one.`,
                    whyHappened: `Python only needs a single colon (:) to define a block or statement. Two colons cause a syntax error.`,
                    howToFix: `Remove the extra colon so only one ':' remains at the end.`,
                    whyFixCorrect: `Python grammar strictly expects a single ':' to open a code block.`,
                    sideEffects: `None. The statement will parse cleanly.`,
                    correctedCode: rawLine.replace(/\s*::+\s*$/, ':'),
                    cause: `In Python, code blocks end with a single ':'. Having '::' causes a syntax error.`,
                    fix: `Remove the extra ':' at the end of this line.`,
                    replacementCode: rawLine.replace(/\s*::+\s*$/, ':'),
                    source: 'codesense-ast'
                });
            } else if (/^(if|for|while|def|class|elif|else|try|except|finally|with)\b/.test(trimmed)) {
                // Missing Colon check
                const cleanPart = trimmed.split('#')[0].trimEnd();
                if (!cleanPart.endsWith(':') && !cleanPart.endsWith('\\') && !cleanPart.includes('lambda')) {
                    const keywordMatch = trimmed.match(/^(if|for|while|def|class|elif|else|try|except|finally|with)\b/);
                    const keyword = keywordMatch ? keywordMatch[1] : 'statement';
                    issues.push({
                        id: `py-colon-${lineNum}`,
                        fileUri: document.uri,
                        line: lineNum,
                        startChar: rawLine.length - trimmed.length,
                        endChar: rawLine.length,
                        severity: vscode.DiagnosticSeverity.Error,
                        errorName: `Missing Colon after '${keyword}'`,
                        locationText: `${currentFileName} – Line ${lineNum}`,
                        whatHappened: `You forgot to add a colon (:) after the ${keyword} statement.`,
                        whyHappened: `Python needs a colon to understand where a code block starts.`,
                        howToFix: `Add ':' to the end of this line.`,
                        whyFixCorrect: `A colon is mandatory in Python syntax to signal an indented code block.`,
                        sideEffects: `None.`,
                        correctedCode: rawLine.trimEnd() + ':',
                        cause: `In Python, '${keyword}' statements must end with ':'.`,
                        fix: `Add ':' to the end of this line.`,
                        replacementCode: rawLine.trimEnd() + ':',
                        source: 'codesense-ast'
                    });
                }
            }

            // 2. Single equals in condition: if x = 5:
            const singleEqMatch = rawLine.match(/^(\s*(?:if|elif|while)\s+[^=!<>#\n]+?)\s*=\s*([^=][^#\n]*):?\s*$/);
            if (singleEqMatch && !rawLine.includes('==') && !rawLine.includes('<=') && !rawLine.includes('>=') && !rawLine.includes('!=')) {
                issues.push({
                    id: `py-single-eq-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: rawLine.indexOf('='),
                    endChar: rawLine.indexOf('=') + 1,
                    severity: vscode.DiagnosticSeverity.Error,
                    errorName: 'Assignment in Condition',
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: `You used a single equals sign (=) instead of double equals (==) in your condition.`,
                    whyHappened: `In Python, '=' is used to assign values, while '==' is used to check if two things are equal.`,
                    howToFix: `Change '=' to '==' to compare values.`,
                    whyFixCorrect: `'==' evaluates to a boolean (True/False) comparison required by conditions.`,
                    sideEffects: `None.`,
                    correctedCode: rawLine.replace(/(\b(?:if|elif|while)\b\s+[^=!<>\n]+?)\s*=\s*([^=])/, '$1 == $2'),
                    cause: `Using '=' inside a condition attempts assignment instead of equality comparison. Use '=='.`,
                    fix: `Change '=' to '==' in this condition.`,
                    replacementCode: rawLine.replace(/(\b(?:if|elif|while)\b\s+[^=!<>\n]+?)\s*=\s*([^=])/, '$1 == $2'),
                    source: 'codesense-ast'
                });
            }

            // 3. Division by Zero (Literal zero or ZeroDivisionError)
            const divZeroMatch = trimmed.match(/(?:\/|%|\/\/)\s*0(?![0-9.])/);
            if (divZeroMatch) {
                const matchPos = rawLine.indexOf(divZeroMatch[0]);
                issues.push({
                    id: `py-div-zero-literal-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: matchPos >= 0 ? matchPos : 0,
                    endChar: matchPos >= 0 ? matchPos + divZeroMatch[0].length : rawLine.length,
                    severity: vscode.DiagnosticSeverity.Error,
                    errorName: 'Division by Zero (ZeroDivisionError)',
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: `You are dividing a number directly by zero.`,
                    whyHappened: `In Python and all programming languages, division by zero is mathematically undefined and raises ZeroDivisionError.`,
                    howToFix: `Replace 0 with a valid non-zero divisor, or check that the divisor is not zero before dividing.`,
                    whyFixCorrect: `Dividing by a non-zero number prevents the runtime program crash.`,
                    sideEffects: `Check dependent calculations that consume this result.`,
                    correctedCode: rawLine.replace(/\/\s*0\b/, '/ 1'),
                    cause: `Dividing by literal zero causes Python to crash with ZeroDivisionError at runtime.`,
                    fix: `Use a non-zero divisor or add a condition.`,
                    replacementCode: rawLine.replace(/\/\s*0\b/, '/ 1'),
                    source: 'codesense-ast'
                });
            }

            // 4. Function definition header tracking
            const funcDef = trimmed.match(/^def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
            if (funcDef) {
                currentScopeParams = new Set(
                    funcDef[2].split(',').map(s => s.trim().split('=')[0].trim()).filter(s => s.length > 0 && s !== 'self' && s !== 'cls')
                );
            }

            // 5. For loop header: for student in student_list
            const forMatch = trimmed.match(/^for\s+([a-zA-Z0-9_,\s]+)\s+in\s+([a-zA-Z0-9_]+)/);
            if (forMatch) {
                const loopTarget = forMatch[2].trim();
                const loopVars = forMatch[1].split(',').map(s => s.trim());

                if (!builtins.has(loopTarget) && !assignedVars.has(loopTarget) && !currentScopeParams.has(loopTarget) && !importedSymbols.has(loopTarget) && !assignedFunctions.has(loopTarget)) {
                    issues.push({
                        id: `py-undef-loop-${lineNum}`,
                        fileUri: document.uri,
                        line: lineNum,
                        startChar: rawLine.indexOf(loopTarget),
                        endChar: rawLine.indexOf(loopTarget) + loopTarget.length,
                        severity: vscode.DiagnosticSeverity.Error,
                        errorName: 'Undefined Variable in Loop',
                        locationText: `${currentFileName} – Line ${lineNum}`,
                        whatHappened: `You are trying to iterate over '${loopTarget}', but it was never defined or assigned in this file.`,
                        whyHappened: `Python needs a defined collection to iterate over. '${loopTarget}' has not been assigned.`,
                        howToFix: `Define and populate '${loopTarget}' before this loop (e.g. ${loopTarget} = [...]).`,
                        whyFixCorrect: `Python requires an existing iterable object to loop through.`,
                        sideEffects: `Ensure the list items match the fields accessed inside the loop.`,
                        correctedCode: `# Define '${loopTarget}' before this loop:\n${loopTarget} = []\n${rawLine.replace(/::+$/, ':')}`,
                        cause: `'${loopTarget}' is undefined. Python cannot iterate over a variable that does not exist.`,
                        fix: `Define '${loopTarget}' as a list before this loop.`,
                        source: 'codesense-ast'
                    });
                }
                loopVars.forEach(v => assignedVars.set(v, { type: 'unknown', line: lineNum }));
            }

            // 6. Incompatible Type Operation: age = "19"; age = age + 5
            const typeAddMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\s*\+\s*(\d+)$/);
            if (typeAddMatch) {
                const lhs = typeAddMatch[1];
                const operand = typeAddMatch[2];
                const addedNum = typeAddMatch[3];
                const prev = assignedVars.get(operand);

                if (prev && prev.type === 'string') {
                    issues.push({
                        id: `py-type-str-int-${lineNum}`,
                        fileUri: document.uri,
                        line: lineNum,
                        startChar: rawLine.indexOf(`${operand} + ${addedNum}`),
                        endChar: rawLine.indexOf(`${operand} + ${addedNum}`) + `${operand} + ${addedNum}`.length,
                        severity: vscode.DiagnosticSeverity.Error,
                        errorName: 'Type Error: Unsupported Operand Types (str + int)',
                        locationText: `${currentFileName} – Line ${lineNum}`,
                        whatHappened: `You are trying to add a number (${addedNum}) directly to a text string ('${operand}').`,
                        whyHappened: `In Python, the '+' operator does not automatically convert text to numbers or numbers to text. Adding 'str' + 'int' raises a TypeError.`,
                        howToFix: `Convert '${operand}' to an integer using int(${operand}) before adding, or define it as a number without quotes.`,
                        whyFixCorrect: `int(${operand}) + ${addedNum} performs proper numeric addition.`,
                        sideEffects: `If other functions expect '${operand}' to remain a string, format it with str() afterwards.`,
                        correctedCode: rawLine.replace(`${operand} + ${addedNum}`, `int(${operand}) + ${addedNum}`),
                        cause: `Cannot concatenate str and int. In Python, use int(${operand}) + ${addedNum}.`,
                        fix: `Wrap '${operand}' in int(${operand}).`,
                        replacementCode: rawLine.replace(`${operand} + ${addedNum}`, `int(${operand}) + ${addedNum}`),
                        source: 'codesense-ast'
                    });
                    assignedVars.set(lhs, { type: 'number', line: lineNum });
                }
            }

            // Track string assignments: var = "text"
            const strAssignMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*(["'].*["'])$/);
            if (strAssignMatch) {
                assignedVars.set(strAssignMatch[1], { type: 'string', line: lineNum });
            }

            // 7. General Assignment: varName = rhs
            const assignMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*=(?!=)\s*(.+)$/);
            if (assignMatch) {
                const varName = assignMatch[1];
                const rhs = assignMatch[2];

                // Check for undefined variables in RHS
                const cleanedRhs = rhs.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
                const idents = cleanedRhs.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g) || [];

                for (const ident of idents) {
                    const keywords = ['def', 'class', 'if', 'else', 'elif', 'for', 'while', 'return', 'lambda', 'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None'];
                    if (keywords.includes(ident) || ident === varName) continue;
                    // Skip attribute accesses: e.g. obj.property
                    const identIdx = rawLine.indexOf(ident);
                    if (identIdx > 0 && rawLine[identIdx - 1] === '.') continue;

                    if (!builtins.has(ident) && !assignedVars.has(ident) && !currentScopeParams.has(ident) && !assignedFunctions.has(ident) && !importedSymbols.has(ident) && ident.length >= 2) {
                        issues.push({
                            id: `py-undef-var-${lineNum}-${ident}`,
                            fileUri: document.uri,
                            line: lineNum,
                            startChar: identIdx >= 0 ? identIdx : 0,
                            endChar: (identIdx >= 0 ? identIdx : 0) + ident.length,
                            severity: vscode.DiagnosticSeverity.Error,
                            errorName: `Undefined Variable '${ident}' (NameError)`,
                            locationText: `${currentFileName} – Line ${lineNum}`,
                            whatHappened: `Variable '${ident}' is used in this expression before being defined or assigned.`,
                            whyHappened: `In Python, variables must be created and given a value before you can use them. Using '${ident}' here causes a NameError crash.`,
                            howToFix: `Assign a value to '${ident}' before this line (e.g. ${ident} = ...).`,
                            whyFixCorrect: `In Python, variables must be created before being referenced in calculations.`,
                            sideEffects: `Ensure the assigned type matches what this expression expects.`,
                            correctedCode: `# Assign '${ident}' before this line:\n${ident} = 0\n${rawLine}`,
                            cause: `'${ident}' is used before being defined in this scope. Python raises a NameError.`,
                            fix: `Assign '${ident}' a value before using it.`,
                            source: 'codesense-ast'
                        });
                    }
                }
                assignedVars.set(varName, { type: 'unknown', line: lineNum });
            }

            // 8. Standalone function calls (never match dot-methods like obj.get())
            const commonMethods = new Set([
                'get', 'keys', 'values', 'items', 'update', 'pop', 'clear', 'copy',
                'append', 'extend', 'insert', 'remove', 'sort', 'reverse', 'count', 'index',
                'upper', 'lower', 'strip', 'lstrip', 'rstrip', 'split', 'rsplit', 'join', 'replace',
                'find', 'rfind', 'startswith', 'endswith', 'encode', 'decode', 'format',
                'add', 'discard', 'union', 'intersection', 'difference',
                'read', 'write', 'close', 'open', 'flush', 'seek', 'tell'
            ]);
            const callMatches = Array.from(trimmed.matchAll(/(?<!\.)\b([a-zA-Z0-9_]+)\s*\(/g));
            for (const cm of callMatches) {
                const funcName = cm[1];
                const funcIdx = rawLine.indexOf(funcName + '(');
                if (funcIdx > 0 && rawLine[funcIdx - 1] === '.') continue; // Method call
                if (commonMethods.has(funcName)) continue;

                const keywords = ['print', 'return', 'if', 'while', 'for', 'with', 'assert', 'yield', 'def', 'class', 'elif', 'except', 'lambda'];
                if (!keywords.includes(funcName) && !builtins.has(funcName) && !assignedFunctions.has(funcName) && !importedSymbols.has(funcName)) {
                    issues.push({
                        id: `py-undef-func-${lineNum}-${funcName}`,
                        fileUri: document.uri,
                        line: lineNum,
                        startChar: funcIdx >= 0 ? funcIdx : rawLine.indexOf(funcName),
                        endChar: (funcIdx >= 0 ? funcIdx : rawLine.indexOf(funcName)) + funcName.length,
                        severity: vscode.DiagnosticSeverity.Error,
                        errorName: `Calling Undefined Function '${funcName}' (NameError)`,
                        locationText: `${currentFileName} – Line ${lineNum}`,
                        whatHappened: `You are calling '${funcName}()', but this function was never defined in this file or imported from another module.`,
                        whyHappened: `Python must have a definition (def ${funcName}(): ...) or an import before you can invoke it. Calling it raises a NameError.`,
                        howToFix: `Define 'def ${funcName}():' or import it from the module where it is implemented.`,
                        whyFixCorrect: `Declaring or importing the function provides the bytecode instructions Python needs to execute.`,
                        sideEffects: `Check if this function exists in another file and add a corresponding import.`,
                        correctedCode: `# Define function before calling:\ndef ${funcName}():\n    pass\n\n${rawLine}`,
                        cause: `'${funcName}' is undefined. Calling an undefined function causes a NameError.`,
                        fix: `Define or import '${funcName}'.`,
                        source: 'codesense-ast'
                    });
                }
            }

            // 9. Dictionary Key Error: case-mismatches against defined keys
            const keyMatch = trimmed.match(/\[["']([a-zA-Z0-9_]+)["']\]/);
            if (keyMatch) {
                const keyName = keyMatch[1];
                let expectedKey: string | null = null;
                let isCaseMismatch = false;

                if (definedDictKeys.size > 0 && !definedDictKeys.has(keyName)) {
                    for (const dk of definedDictKeys) {
                        if (dk.toLowerCase() === keyName.toLowerCase()) {
                            expectedKey = dk;
                            isCaseMismatch = true;
                            break;
                        }
                    }
                }

                if (expectedKey) {
                    const startIdx = rawLine.indexOf(`["${keyName}"]`) !== -1 ? rawLine.indexOf(`["${keyName}"]`) : rawLine.indexOf(`['${keyName}']`);
                    const endIdx = startIdx !== -1 ? startIdx + keyName.length + 4 : rawLine.length;
                    const errorTitle = isCaseMismatch ? `Incorrect Dictionary Key '${keyName}' (KeyError - Case Mismatch)` : `Incorrect Dictionary Key '${keyName}' (KeyError)`;
                    const explanation = isCaseMismatch
                        ? `Python dictionary keys are case-sensitive. Accessing '${keyName}' instead of defined '${expectedKey}' raises KeyError at runtime.`
                        : `Python dictionaries only match the exact key names defined in your data. Accessing '${keyName}' raises a KeyError crash at runtime.`;

                    issues.push({
                        id: `py-dict-key-${lineNum}`,
                        fileUri: document.uri,
                        line: lineNum,
                        startChar: startIdx >= 0 ? startIdx : 0,
                        endChar: endIdx,
                        severity: vscode.DiagnosticSeverity.Error,
                        errorName: errorTitle,
                        locationText: `${currentFileName} – Line ${lineNum}`,
                        whatHappened: `You are accessing key '${keyName}', but the defined key is '${expectedKey}'.`,
                        whyHappened: explanation,
                        howToFix: `Change '["${keyName}"]' to '["${expectedKey}"]'.`,
                        whyFixCorrect: `Using exact key '${expectedKey}' retrieves the value without a KeyError crash.`,
                        sideEffects: `None.`,
                        correctedCode: rawLine.replace(`["${keyName}"]`, `["${expectedKey}"]`).replace(`['${keyName}']`, `['${expectedKey}']`),
                        cause: explanation,
                        fix: `Change '${keyName}' to '${expectedKey}'.`,
                        replacementCode: rawLine.replace(`["${keyName}"]`, `["${expectedKey}"]`).replace(`['${keyName}']`, `['${expectedKey}']`),
                        source: 'codesense-ast'
                    });
                }
            }

            // 10. Security: Hardcoded credential
            const secMatch = trimmed.match(/\b(password|passwd|api_key|secret_key|auth_token)\s*=\s*["']([^"']{4,})["']/i);
            if (secMatch) {
                issues.push({
                    id: `py-sec-cred-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: rawLine.indexOf(secMatch[0]),
                    endChar: rawLine.indexOf(secMatch[0]) + secMatch[0].length,
                    severity: vscode.DiagnosticSeverity.Warning,
                    errorName: `Security Vulnerability: Hardcoded Credential '${secMatch[1]}'`,
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: `A secret or credential '${secMatch[1]}' appears hardcoded in plain text.`,
                    whyHappened: `Hardcoding credentials exposes sensitive passwords and tokens in source control.`,
                    howToFix: `Load from environment variables: os.environ.get('${secMatch[1].toUpperCase()}').`,
                    whyFixCorrect: `Environment variables separate sensitive credentials from code.`,
                    sideEffects: `Set the environment variable in runtime environments.`,
                    correctedCode: `import os\n${secMatch[1]} = os.environ.get("${secMatch[1].toUpperCase()}", "")`,
                    cause: `Hardcoded credential '${secMatch[1]}' found in source code.`,
                    fix: `Load '${secMatch[1]}' from environment variables.`,
                    source: 'codesense-ast'
                });
            }

            // 11. Security: Code Injection via eval() or exec()
            if (/\b(?:eval|exec)\s*\(/.test(trimmed)) {
                issues.push({
                    id: `py-sec-eval-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: 0,
                    endChar: rawLine.length,
                    severity: vscode.DiagnosticSeverity.Warning,
                    errorName: "Security Vulnerability: Arbitrary Code Execution (eval/exec)",
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: "Using 'eval()' or 'exec()' allows dynamic execution of untrusted code.",
                    whyHappened: "'eval()' parses and executes arbitrary strings as Python code, enabling Remote Code Execution (RCE).",
                    howToFix: "Use ast.literal_eval() for safe literal parsing, or replace with static logic.",
                    whyFixCorrect: "ast.literal_eval() safely parses standard Python data literals without executing arbitrary code.",
                    sideEffects: "Inputs must be valid Python literals.",
                    correctedCode: rawLine.replace(/\beval\s*\(/, 'ast.literal_eval('),
                    cause: "Arbitrary code execution risk with eval/exec.",
                    fix: "Use ast.literal_eval() for safe evaluation.",
                    source: 'codesense-ast'
                });
            }

            // 12. Security: SQL Injection String Concatenation
            if (/(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+.+\s+SET|DELETE\s+FROM)\s+.*["']\s*\+\s*[a-zA-Z_]/i.test(trimmed)) {
                issues.push({
                    id: `py-sec-sqli-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: 0,
                    endChar: rawLine.length,
                    severity: vscode.DiagnosticSeverity.Warning,
                    errorName: "Security Vulnerability: SQL Injection Risk",
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: "You are building a SQL query by concatenating dynamic variables into a raw SQL string.",
                    whyHappened: "String concatenation allows user inputs to alter SQL query structure (SQL Injection).",
                    howToFix: "Use parameterized queries or prepared statements (e.g. cursor.execute(query, params)).",
                    whyFixCorrect: "Parameterized queries separate SQL structure from user data, preventing SQL injection.",
                    sideEffects: "Requires parameter placeholder syntax (e.g. %s or ?).",
                    correctedCode: rawLine,
                    cause: "SQL injection risk via string concatenation.",
                    fix: "Use parameterized queries or prepared statements.",
                    source: 'codesense-ast'
                });
            }

            // 13. Bare except:
            if (/^\s*except\s*:\s*$/.test(rawLine)) {
                issues.push({
                    id: `py-bare-except-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: rawLine.indexOf('except:'),
                    endChar: rawLine.indexOf('except:') + 7,
                    severity: vscode.DiagnosticSeverity.Warning,
                    errorName: "Bare 'except:' Clause (Swallows System Signals)",
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: "This block uses a bare 'except:' clause without specifying an exception class.",
                    whyHappened: "A bare 'except:' catches BaseException, including KeyboardInterrupt and SystemExit, preventing clean script termination.",
                    howToFix: "Specify 'except Exception:' to catch standard execution errors safely.",
                    whyFixCorrect: "Catching 'Exception' leaves interrupt and exit signals unblocked.",
                    sideEffects: "Ctrl+C interrupts will now work properly.",
                    correctedCode: rawLine.replace('except:', 'except Exception:'),
                    replacementCode: rawLine.replace('except:', 'except Exception:'),
                    cause: "Bare except: catches system interrupt and exit signals.",
                    fix: "Specify 'except Exception:'.",
                    source: 'codesense-ast'
                });
            }
        }
    }

    /**
     * Comprehensive JavaScript & TypeScript Static, Semantic & Syntax Analyzer
     */
    private analyzeJavaScript(
        document: vscode.TextDocument,
        relPath: string,
        lines: string[],
        node: any,
        graph: any,
        issues: CodeIssue[]
    ): void {
        const currentFileName = path.basename(relPath);

        // Check for unclosed brackets and division by zero
        let openBraces = 0;
        let openParens = 0;
        let openBrackets = 0;

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const lineNum = i + 1;
            const trimmed = rawLine.trim();

            if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

            // Division by zero
            if (/(?:\/|%)\s*0(?![0-9.])/g.test(trimmed)) {
                issues.push({
                    id: `js-div-zero-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: 0,
                    endChar: rawLine.length,
                    severity: vscode.DiagnosticSeverity.Warning,
                    errorName: 'Division by Zero (Returns Infinity / NaN)',
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: `You are dividing by zero in JavaScript.`,
                    whyHappened: `In JavaScript, dividing by 0 results in Infinity or NaN, which propagates through calculations and corrupts data.`,
                    howToFix: `Ensure the denominator is non-zero before dividing.`,
                    whyFixCorrect: `Using a verified non-zero denominator prevents Infinity and NaN values.`,
                    sideEffects: `Check dependent arithmetic.`,
                    correctedCode: rawLine.replace(/\/\s*0\b/, '/ 1'),
                    cause: `Dividing by zero in JS produces Infinity or NaN.`,
                    fix: `Ensure divisor is not zero.`,
                    replacementCode: rawLine.replace(/\/\s*0\b/, '/ 1'),
                    source: 'codesense-ast'
                });
            }

            // Const re-assignment: const x = 1; x = 2;
            const constMatch = trimmed.match(/^const\s+([a-zA-Z0-9_]+)\s*=/);
            if (constMatch) {
                const constVar = constMatch[1];
                for (let j = i + 1; j < lines.length; j++) {
                    const nextTrimmed = lines[j].trim();
                    if (new RegExp(`^${constVar}\\s*=(?!=)`).test(nextTrimmed)) {
                        issues.push({
                            id: `js-const-reassign-${j + 1}`,
                            fileUri: document.uri,
                            line: j + 1,
                            startChar: 0,
                            endChar: lines[j].length,
                            severity: vscode.DiagnosticSeverity.Error,
                            errorName: 'TypeError: Assignment to Constant Variable',
                            locationText: `${currentFileName} – Line ${j + 1}`,
                            whatHappened: `You are trying to reassign '${constVar}', which was declared as a constant with 'const'.`,
                            whyHappened: `Variables declared with 'const' cannot be reassigned after initialization. Attempting to reassign raises a TypeError at runtime.`,
                            howToFix: `Change the initial declaration on Line ${lineNum} from 'const' to 'let', or avoid reassigning '${constVar}'.`,
                            whyFixCorrect: `'let' permits variable reassignment while maintaining block scope.`,
                            sideEffects: `Ensure other parts of your code expect '${constVar}' to mutate.`,
                            correctedCode: `let ${constVar} = ...`,
                            cause: `Assignment to constant variable '${constVar}'. In JavaScript, 'const' variables cannot be reassigned.`,
                            fix: `Change 'const' to 'let' on line ${lineNum}.`,
                            source: 'codesense-ast'
                        });
                        break;
                    }
                }
            }
        }
    }

    /**
     * Comprehensive Java Static & Syntax Analyzer
     */
    private analyzeJava(
        document: vscode.TextDocument,
        relPath: string,
        lines: string[],
        issues: CodeIssue[]
    ): void {
        const currentFileName = path.basename(relPath);
        const expectedClassName = path.basename(relPath, '.java');

        let openBraces = 0;

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const lineNum = i + 1;
            const trimmed = rawLine.trim();

            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

            // 1. Class name matching file name
            const classMatch = trimmed.match(/^public\s+class\s+([a-zA-Z0-9_]+)/);
            if (classMatch) {
                const declaredClass = classMatch[1];
                if (declaredClass !== expectedClassName) {
                    issues.push({
                        id: `java-class-name-${lineNum}`,
                        fileUri: document.uri,
                        line: lineNum,
                        startChar: rawLine.indexOf(declaredClass),
                        endChar: rawLine.indexOf(declaredClass) + declaredClass.length,
                        severity: vscode.DiagnosticSeverity.Error,
                        errorName: 'Class Name Mismatch',
                        locationText: `${currentFileName} – Line ${lineNum}`,
                        whatHappened: `Public class '${declaredClass}' does not match the file name '${currentFileName}'.`,
                        whyHappened: `In Java, a public class must be defined in a source file with the exact same name (case-sensitive) followed by '.java'.`,
                        howToFix: `Rename the class to '${expectedClassName}', or rename the file to '${declaredClass}.java'.`,
                        whyFixCorrect: `Java compiler requires public class names to match their compilation unit file names.`,
                        sideEffects: `References to this class in other Java packages must use '${expectedClassName}'.`,
                        correctedCode: rawLine.replace(`class ${declaredClass}`, `class ${expectedClassName}`),
                        cause: `Public class '${declaredClass}' should be declared in a file named '${declaredClass}.java'.`,
                        fix: `Rename class to '${expectedClassName}'.`,
                        replacementCode: rawLine.replace(`class ${declaredClass}`, `class ${expectedClassName}`),
                        source: 'codesense-ast'
                    });
                }
            }

            // 2. Missing semicolon at end of statement
            if (trimmed.length > 0 && !trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith('}') && !trimmed.endsWith(':')) {
                const isControlOrHeader = /^(package|import|public|private|protected|class|interface|enum|if|else|for|while|try|catch|finally|switch|default|case)\b/.test(trimmed) || trimmed.includes('{') || trimmed.includes('}');
                if (!isControlOrHeader && (trimmed.includes('=') || trimmed.includes('System.out.println') || trimmed.includes('return') || trimmed.includes('('))) {
                    issues.push({
                        id: `java-semicolon-${lineNum}`,
                        fileUri: document.uri,
                        line: lineNum,
                        startChar: rawLine.length - 1,
                        endChar: rawLine.length,
                        severity: vscode.DiagnosticSeverity.Error,
                        errorName: 'Missing Semicolon (;)',
                        locationText: `${currentFileName} – Line ${lineNum}`,
                        whatHappened: `You forgot to end this statement with a semicolon (;).`,
                        whyHappened: `In Java, every statement must terminate with a semicolon. Missing semicolons cause a compilation error.`,
                        howToFix: `Add ';' at the end of the line.`,
                        whyFixCorrect: `Terminating the statement with ';' allows the javac compiler to parse the instruction cleanly.`,
                        sideEffects: `None.`,
                        correctedCode: rawLine.trimEnd() + ';',
                        cause: `Java statements must end with ';'.`,
                        fix: `Add ';' at the end of this line.`,
                        replacementCode: rawLine.trimEnd() + ';',
                        source: 'codesense-ast'
                    });
                }
            }

            // 3. Division by Zero: 100 / 0
            if (/(?:\/|%)\s*0(?![0-9.])/g.test(trimmed)) {
                issues.push({
                    id: `java-div-zero-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: 0,
                    endChar: rawLine.length,
                    severity: vscode.DiagnosticSeverity.Error,
                    errorName: 'ArithmeticException: / by zero',
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: `You are dividing an integer by zero.`,
                    whyHappened: `In Java, integer division by zero throws an unhandled java.lang.ArithmeticException at runtime.`,
                    howToFix: `Replace 0 with a non-zero number, or verify the denominator with an 'if (divisor != 0)' guard.`,
                    whyFixCorrect: `Ensuring a non-zero denominator prevents the ArithmeticException crash.`,
                    sideEffects: `None.`,
                    correctedCode: rawLine.replace(/\/\s*0\b/, '/ 1'),
                    cause: `Integer division by zero throws java.lang.ArithmeticException.`,
                    fix: `Use a non-zero divisor.`,
                    replacementCode: rawLine.replace(/\/\s*0\b/, '/ 1'),
                    source: 'codesense-ast'
                });
            }

            // 4. Type mismatch: String message = 123;
            const strNumMismatch = trimmed.match(/^String\s+([a-zA-Z0-9_]+)\s*=\s*(\d+)\s*;?/);
            if (strNumMismatch) {
                issues.push({
                    id: `java-type-mismatch-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: 0,
                    endChar: rawLine.length,
                    severity: vscode.DiagnosticSeverity.Error,
                    errorName: 'Type Mismatch: Incompatible Types (int cannot be converted to String)',
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: `You are assigning an integer (${strNumMismatch[2]}) to a variable of type String.`,
                    whyHappened: `Java is a strictly typed language. An 'int' cannot be implicitly converted to a 'String'.`,
                    howToFix: `Wrap the number in quotes ("${strNumMismatch[2]}"), or use String.valueOf(${strNumMismatch[2]}).`,
                    whyFixCorrect: `String.valueOf converts the primitive int into a heap-allocated String object.`,
                    sideEffects: `None.`,
                    correctedCode: rawLine.replace(strNumMismatch[2], `"${strNumMismatch[2]}"`),
                    cause: `Incompatible types: int cannot be converted to java.lang.String.`,
                    fix: `Change to "${strNumMismatch[2]}" or String.valueOf(${strNumMismatch[2]}).`,
                    replacementCode: rawLine.replace(strNumMismatch[2], `"${strNumMismatch[2]}"`),
                    source: 'codesense-ast'
                });
            }
        }
    }

    /**
     * Comprehensive HTML Static & Tag Balancer
     */
    private analyzeHTML(
        document: vscode.TextDocument,
        relPath: string,
        lines: string[],
        issues: CodeIssue[]
    ): void {
        const currentFileName = path.basename(relPath);
        const text = document.getText();
        const seenIds = new Set<string>();

        const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const lineNum = i + 1;
            const trimmed = rawLine.trim();

            // 1. Check for void tags incorrectly written with closing tags: </br>, </img>, </input>
            const voidClosingMatch = trimmed.match(/<\/\s*(br|img|input|hr|link|meta)\s*>/i);
            if (voidClosingMatch) {
                const tag = voidClosingMatch[1].toLowerCase();
                issues.push({
                    id: `html-void-close-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: rawLine.indexOf(voidClosingMatch[0]),
                    endChar: rawLine.indexOf(voidClosingMatch[0]) + voidClosingMatch[0].length,
                    severity: vscode.DiagnosticSeverity.Warning,
                    errorName: 'Invalid HTML: Void Element Closing Tag',
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: `You wrote a closing tag for the void element '<${tag}>'.`,
                    whyHappened: `In HTML5, void elements like <br>, <img>, <input>, and <hr> cannot have end tags.`,
                    howToFix: `Remove '</${tag}>'.`,
                    whyFixCorrect: `Removing '</${tag}>' satisfies the HTML5 specification.`,
                    sideEffects: `None.`,
                    correctedCode: rawLine.replace(voidClosingMatch[0], ''),
                    cause: `Void element '<${tag}>' must not have an end tag '</${tag}>'.`,
                    fix: `Remove '</${tag}>'.`,
                    replacementCode: rawLine.replace(voidClosingMatch[0], ''),
                    source: 'codesense-ast'
                });
            }

            // 2. Check <img> missing required 'src' attribute
            const imgMatch = trimmed.match(/<img\b([^>]*)>/i);
            if (imgMatch && !imgMatch[1].toLowerCase().includes('src=')) {
                issues.push({
                    id: `html-img-no-src-${lineNum}`,
                    fileUri: document.uri,
                    line: lineNum,
                    startChar: rawLine.indexOf('<img'),
                    endChar: rawLine.indexOf('>') + 1,
                    severity: vscode.DiagnosticSeverity.Error,
                    errorName: 'Missing Required Attribute: src on <img>',
                    locationText: `${currentFileName} – Line ${lineNum}`,
                    whatHappened: `The <img> tag is missing its required 'src' attribute.`,
                    whyHappened: `The browser requires a 'src' attribute specifying the image URL to render. Without it, the image element is broken.`,
                    howToFix: `Add src="path/to/image.png" to the <img> tag.`,
                    whyFixCorrect: `'src' specifies the resource location for the image.`,
                    sideEffects: `Ensures the image loads successfully in the browser.`,
                    correctedCode: rawLine.replace(/<img\b/i, '<img src="image.png" '),
                    cause: `<img> element requires a 'src' attribute to display image content.`,
                    fix: `Add src="..." to this <img> tag.`,
                    replacementCode: rawLine.replace(/<img\b/i, '<img src="image.png" '),
                    source: 'codesense-ast'
                });
            }

            // 3. Duplicate IDs
            const idMatch = trimmed.match(/\bid=["']([a-zA-Z0-9_-]+)["']/i);
            if (idMatch) {
                const idVal = idMatch[1];
                if (seenIds.has(idVal)) {
                    issues.push({
                        id: `html-dup-id-${lineNum}-${idVal}`,
                        fileUri: document.uri,
                        line: lineNum,
                        startChar: rawLine.indexOf(idMatch[0]),
                        endChar: rawLine.indexOf(idMatch[0]) + idMatch[0].length,
                        severity: vscode.DiagnosticSeverity.Warning,
                        errorName: 'Duplicate HTML ID Attribute',
                        locationText: `${currentFileName} – Line ${lineNum}`,
                        whatHappened: `The id '${idVal}' is used multiple times in this document.`,
                        whyHappened: `In HTML, every 'id' attribute must be unique across the entire document. Duplicate IDs break document.getElementById and CSS styling.`,
                        howToFix: `Change '${idVal}' to a unique identifier or use a class instead.`,
                        whyFixCorrect: `Unique IDs ensure predictable JavaScript DOM selection and CSS specificity.`,
                        sideEffects: `Check any JS querySelector or CSS styles targeting #${idVal}.`,
                        correctedCode: rawLine.replace(`id="${idVal}"`, `class="${idVal}"`),
                        cause: `The id '${idVal}' is already defined earlier in this HTML document.`,
                        fix: `Change id to a class or use a unique name.`,
                        replacementCode: rawLine.replace(`id="${idVal}"`, `class="${idVal}"`),
                        source: 'codesense-ast'
                    });
                } else {
                    seenIds.add(idVal);
                }
            }
        }
    }

    /**
     * Comprehensive CSS Static & Syntax Analyzer
     */
    private analyzeCSS(
        document: vscode.TextDocument,
        relPath: string,
        lines: string[],
        issues: CodeIssue[]
    ): void {
        const currentFileName = path.basename(relPath);

        const commonMisspellings: Record<string, string> = {
            'colr': 'color',
            'colour': 'color',
            'backgroud': 'background',
            'pading': 'padding',
            'margn': 'margin',
            'widht': 'width',
            'heigth': 'height',
            'heigt': 'height',
            'disply': 'display',
            'positon': 'position'
        };

        let inRule = false;

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const lineNum = i + 1;
            const trimmed = rawLine.trim();

            if (trimmed.startsWith('/*') || trimmed.length === 0) continue;

            if (trimmed.includes('{')) inRule = true;
            if (trimmed.includes('}')) inRule = false;

            if (inRule && !trimmed.includes('{') && !trimmed.includes('}')) {
                // 1. Misspelled property name: e.g. colr: red;
                const propMatch = trimmed.match(/^([a-zA-Z-]+)\s*:\s*(.+)$/);
                if (propMatch) {
                    const prop = propMatch[1].toLowerCase();
                    const val = propMatch[2];

                    if (commonMisspellings[prop]) {
                        const correctProp = commonMisspellings[prop];
                        issues.push({
                            id: `css-misspelled-prop-${lineNum}`,
                            fileUri: document.uri,
                            line: lineNum,
                            startChar: rawLine.indexOf(prop),
                            endChar: rawLine.indexOf(prop) + prop.length,
                            severity: vscode.DiagnosticSeverity.Error,
                            errorName: 'Invalid CSS Property Name',
                            locationText: `${currentFileName} – Line ${lineNum}`,
                            whatHappened: `Unknown property '${prop}'. Did you mean '${correctProp}'?`,
                            whyHappened: `Web browsers discard unknown CSS properties, causing styles not to render.`,
                            howToFix: `Change '${prop}' to '${correctProp}'.`,
                            whyFixCorrect: `'${correctProp}' is a valid W3C CSS property recognized by all browsers.`,
                            sideEffects: `The element's style will now apply.`,
                            correctedCode: rawLine.replace(prop, correctProp),
                            cause: `'${prop}' is not a valid CSS property name.`,
                            fix: `Replace with '${correctProp}'.`,
                            replacementCode: rawLine.replace(prop, correctProp),
                            source: 'codesense-ast'
                        });
                    }

                    // 2. Missing unit on non-zero numeric dimensions: width: 300;
                    if (['width', 'height', 'margin', 'padding', 'top', 'left', 'right', 'bottom', 'font-size'].includes(prop)) {
                        const noUnitMatch = val.match(/^(\d+)\s*;?$/);
                        if (noUnitMatch && noUnitMatch[1] !== '0') {
                            issues.push({
                                id: `css-missing-unit-${lineNum}`,
                                fileUri: document.uri,
                                line: lineNum,
                                startChar: rawLine.indexOf(noUnitMatch[1]),
                                endChar: rawLine.indexOf(noUnitMatch[1]) + noUnitMatch[1].length,
                                severity: vscode.DiagnosticSeverity.Error,
                                errorName: 'Missing Unit in CSS Dimension (e.g. px, rem, %)',
                                locationText: `${currentFileName} – Line ${lineNum}`,
                                whatHappened: `You specified '${prop}: ${noUnitMatch[1]}' without a unit.`,
                                whyHappened: `In CSS, non-zero length values require a unit (like px, rem, em, %). Browsers in standard mode ignore unitless lengths.`,
                                howToFix: `Add 'px' after the number (e.g. ${noUnitMatch[1]}px).`,
                                whyFixCorrect: `Specifying 'px' converts the number into a valid CSS length recognized by browsers.`,
                                sideEffects: `The layout dimension will take effect immediately.`,
                                correctedCode: rawLine.replace(noUnitMatch[1], `${noUnitMatch[1]}px`),
                                cause: `CSS dimension '${prop}' requires a unit (like px).`,
                                fix: `Add 'px' after ${noUnitMatch[1]}.`,
                                replacementCode: rawLine.replace(noUnitMatch[1], `${noUnitMatch[1]}px`),
                                source: 'codesense-ast'
                            });
                        }
                    }

                    // 3. Missing semicolon at end of declaration
                    if (!val.endsWith(';') && i < lines.length - 1 && !lines[i + 1].includes('}')) {
                        issues.push({
                            id: `css-missing-semi-${lineNum}`,
                            fileUri: document.uri,
                            line: lineNum,
                            startChar: rawLine.length - 1,
                            endChar: rawLine.length,
                            severity: vscode.DiagnosticSeverity.Error,
                            errorName: 'Missing Semicolon (;) in CSS Rule',
                            locationText: `${currentFileName} – Line ${lineNum}`,
                            whatHappened: `CSS property declaration is missing a closing semicolon (;).`,
                            whyHappened: `In CSS, declarations inside a block must be separated by semicolons. Without it, the browser fails to parse the subsequent property.`,
                            howToFix: `Add ';' to the end of this line.`,
                            whyFixCorrect: `Semicolons delineate property declarations in CSS.`,
                            sideEffects: `The following CSS properties will now be parsed correctly.`,
                            correctedCode: rawLine.trimEnd() + ';',
                            cause: `Missing ';' between CSS property declarations.`,
                            fix: `Add ';' at the end of this line.`,
                            replacementCode: rawLine.trimEnd() + ';',
                            source: 'codesense-ast'
                        });
                    }
                }
            }
        }
    }

    /**
     * Queries Google Gemini with the code AND whole-codebase dependency context
     */
    private async runGeminiAnalysis(
        document: vscode.TextDocument,
        relPath: string,
        apiKey: string
    ): Promise<CodeIssue[]> {
        const configManager = ConfigManager.getInstance();
        const modelName = configManager.getModelName();
        const genAI = new GoogleGenerativeAI(apiKey);

        const code = document.getText();
        const crossFileContext = this.graphManager.getCrossFileContext(relPath);

        const prompt = `You are CodeSense, an expert code analysis engine and helpful coding mentor.
Perform a COMPREHENSIVE, THOROUGH AUDIT of this entire file across all 21 categories of programming issues.
Do NOT stop after finding 1 or 2 issues. Inspect the ENTIRE file line by line and report ALL detected problems.

SUPPORTED LANGUAGES: Python, JavaScript, TypeScript, Java, HTML, CSS.

21 CRITICAL AUDIT CATEGORIES TO CHECK:
1. Syntax Errors: Missing/extra colons, unclosed brackets/braces/parentheses, mismatched tags, missing semicolons.
2. Logical Errors: Incorrect comparison operators (e.g. '=' in condition), inverted conditionals, flawed conditions.
3. Runtime Errors: Division by zero ('100 / 0', 'n / 0'), unhandled exceptions, unsupported operations.
4. Undefined Variables & Functions: Using identifiers before assignment, referencing missing globals, calling undefined functions ('display_student_details()').
5. Incorrect Variable References: Variable name typos ('student_list' vs 'student_database').
6. Type Errors & Incompatible Operations: Adding text and numbers without conversion (e.g. 'str + int' like age = "19"; age = age + 5), passing wrong types (e.g. passing integer ID to dictionary getter).
7. Missing Imports & Dependencies: Using symbols without importing them from their origin modules.
8. Incorrect Function Arguments: Wrong parameter counts, missing arguments, misplaced arguments.
9. Missing / Incorrect Return Statements: Non-void methods missing returns, returning wrong data shapes.
10. Indentation & Formatting Issues: Inconsistent indentation levels, tabs mixed with spaces, empty blocks.
11. Incorrect Data Structures & Dictionary Keys: Accessing non-existent dictionary keys ('student_name' vs 'name'), indexing non-subscriptables.
12. Array & Index Errors: Out-of-bounds indexing, off-by-one errors.
13. Null / None Reference Errors: Calling methods on None / null / undefined without null-checks or optional chaining.
14. Division by Zero: Math operations dividing by 0 or empty list lengths.
15. Exception Handling Problems: Bare 'except:' statements, swallowed exceptions.
16. Infinite Loop Risks: 'while True:' without break/return conditions.
17. Memory & Performance Issues: Redundant computations in loops, memory leaks.
18. Security Vulnerabilities: Hardcoded credentials/tokens, SQL injection, eval() usage, XSS.
19. Incorrect API Usage: Deprecated function calls, bad argument formats.
20. Deprecated Functions & Methods: Calling obsolete language methods.
21. Dependency & Compatibility Issues: Cross-file contract breaks and mismatching exports.

Multi-File Context:
${crossFileContext}

Current File (${relPath}) [Language: ${document.languageId}]:
\`\`\`${document.languageId}
${code}
\`\`\`

Return a strictly valid JSON array of objects with this schema:
[
  {
    "line": number (1-indexed line number where the issue occurs),
    "symbol": string (token or name involved, or null),
    "severity": "error" or "warning",
    "errorName": "Precise name (e.g. 'Division by Zero (ZeroDivisionError)', 'Type Error: Unsupported Operand Types (str + int)', 'Undefined Variable (NameError)', 'Calling Undefined Function (NameError)')",
    "whatHappened": "What is wrong? Clear 1-2 sentence description.",
    "whyHappened": "Why did it happen? Underlying language mechanism explained simply.",
    "locationText": "Exact file and line (e.g. '${relPath} – Line 14')",
    "howToFix": "What is the correct solution? Step-by-step resolution.",
    "whyFixCorrect": "Why is the proposed solution correct? Language justification.",
    "sideEffects": "Which other functions or files could be affected? Possible side effects.",
    "correctedCode": "The exact fixed code line or snippet",
    "replacementCode": "The exact drop-in replacement line for VS Code QuickFix, or null"
  }
]

Do NOT return markdown fences like \`\`\`json. Return ONLY raw JSON array. If there are no issues, return [].`;

        // Try primary model with automatic fallbacks for maximum reliability
        const candidateModels = Array.from(new Set([
            modelName,
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-flash-latest'
        ]));
        let responseText = '';

        for (const mName of candidateModels) {
            try {
                const model = genAI.getGenerativeModel({ model: mName });
                const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`Gemini API timeout for ${mName} (6500ms)`)), 6500)
                );
                const result = await Promise.race([model.generateContent(prompt), timeoutPromise]);
                const rawText = result?.response?.text()?.trim();
                if (rawText && rawText.length > 0) {
                    responseText = rawText;
                    break;
                }
            } catch (err: any) {
                console.warn(`CodeSense: Model ${mName} attempt skipped:`, err?.message || err);
            }
        }

        if (!responseText) {
            return [];
        }

        if (responseText.startsWith('```')) {
            responseText = responseText.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
        }

        try {
            const rawIssues = JSON.parse(responseText);
            if (!Array.isArray(rawIssues)) {
                return [];
            }

            const parsedIssues: CodeIssue[] = [];
            const lines = code.split('\n');
            const currentFileName = path.basename(relPath);

            for (const item of rawIssues) {
                if (!item.line || (!item.whatHappened && !item.cause) || (!item.howToFix && !item.fix)) {
                    continue;
                }

                const lineIndex = Math.min(Math.max(0, item.line - 1), lines.length - 1);
                const lineText = lines[lineIndex] || '';

                let startChar = 0;
                let endChar = lineText.length;

                if (item.symbol && lineText.includes(item.symbol)) {
                    startChar = lineText.indexOf(item.symbol);
                    endChar = startChar + item.symbol.length;
                }

                const errorName = item.errorName || 'Code Issue';
                const whatHappened = item.whatHappened || item.cause;
                const whyHappened = item.whyHappened || item.cause;
                const howToFix = item.howToFix || item.fix;
                const whyFixCorrect = item.whyFixCorrect || 'This fix conforms to standard language semantics.';
                const sideEffects = item.sideEffects || 'None.';
                const correctedCode = item.correctedCode || item.replacementCode;

                parsedIssues.push({
                    id: `ai-issue-${relPath}-${item.line}-${Date.now()}-${Math.random()}`,
                    fileUri: document.uri,
                    line: item.line,
                    startChar,
                    endChar,
                    severity: item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
                    errorName,
                    locationText: `${currentFileName} – Line ${item.line}`,
                    whatHappened,
                    whyHappened,
                    howToFix,
                    whyFixCorrect,
                    sideEffects,
                    correctedCode,
                    cause: item.cause || `${whatHappened} ${whyHappened}`.trim(),
                    fix: howToFix,
                    relatedFile: item.relatedFile || undefined,
                    relatedSymbol: item.symbol || undefined,
                    replacementCode: item.replacementCode || correctedCode || undefined,
                    source: 'codesense-ai'
                });
            }

            return parsedIssues;
        } catch (e) {
            console.error('CodeSense: Failed to parse Gemini response JSON:', responseText);
            return [];
        }
    }
}
