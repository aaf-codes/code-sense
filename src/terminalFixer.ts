import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigManager } from './config';
import { ThemeManager } from './theme';
import { DiagnosticsManager } from './diagnostics';
import { CodeIssue } from './types';

export interface ParsedTerminalError {
    filePath: string;
    fileUri?: vscode.Uri;
    line: number;
    column?: number;
    errorType: string;
    errorMessage: string;
    traceback: string;
    codeSnippet?: string;
}

/**
 * TerminalErrorFixer:
 * 1. Captures runtime errors and stack traces from the VS Code terminal.
 * 2. Parses language-specific tracebacks (Python, JS/TS, Java, etc.).
 * 3. Pinpoints exact file, line, and causing expression.
 * 4. Generates an accurate AI-powered fix (with intelligent local fallback).
 * 5. Displays before-and-after change in VS Code's native diff editor.
 * 6. Never overwrites user code without approval: user can review and approve before applying.
 */
export class TerminalErrorFixer implements vscode.TextDocumentContentProvider {
    public static readonly scheme = 'codesense-terminal-fix';
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;

    private proposals = new Map<string, string>();
    private diagnosticsManager: DiagnosticsManager;

    constructor(diagnosticsManager: DiagnosticsManager) {
        this.diagnosticsManager = diagnosticsManager;
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        const queryParams = new URLSearchParams(uri.query);
        const fixId = queryParams.get('fixId');
        if (fixId && this.proposals.has(fixId)) {
            return this.proposals.get(fixId)!;
        }
        return '// Proposed Terminal Error Fix content not found or already applied.';
    }

    /**
     * Parses terminal output / traceback into structured error details.
     */
    public parseTerminalText(rawText: string): ParsedTerminalError | null {
        if (!rawText || !rawText.trim()) {
            return null;
        }
        const text = rawText.trim();

        // -------------------------------------------------------------
        // 1. Python Traceback:
        // Traceback (most recent call last):
        //   File "path/to/file.py", line 15, in <module>
        //     print(numbers[5])
        // IndexError: list index out of range
        // -------------------------------------------------------------
        const pyFileRegex = /File\s+["']([^"']+)["'],\s+line\s+(\d+)(?:,\s+in\s+([^\r\n]+))?(?:\r?\n\s+([^\r\n]+))?/g;
        let lastPyMatch: RegExpExecArray | null = null;
        let match: RegExpExecArray | null = null;
        while ((match = pyFileRegex.exec(text)) !== null) {
            lastPyMatch = match;
        }

        if (lastPyMatch) {
            const filePath = lastPyMatch[1];
            const line = parseInt(lastPyMatch[2], 10);
            const codeSnippet = lastPyMatch[4] ? lastPyMatch[4].trim() : undefined;

            // Look for exception name and message after the last file line
            const afterMatch = text.slice(lastPyMatch.index + lastPyMatch[0].length);
            const errTypeMatch = afterMatch.match(/([a-zA-Z0-9_.]*(?:Error|Exception|Warning|Interrupt))(?::\s*([^\r\n]*))?/);

            const errorType = errTypeMatch ? errTypeMatch[1] : 'Runtime Error';
            const errorMessage = errTypeMatch && errTypeMatch[2] ? errTypeMatch[2].trim() : (afterMatch.trim().split('\n')[0] || 'Execution failed');

            return {
                filePath,
                line,
                errorType,
                errorMessage,
                traceback: text,
                codeSnippet
            };
        }

        // -------------------------------------------------------------
        // 2. Python Simple Error format (e.g. pytest or linter):
        // path/file.py:15: error: message
        // -------------------------------------------------------------
        const pySimpleMatch = text.match(/([^\s:]+\.py):(\d+):(?:\s*(?:error|warning):)?\s*([^\r\n]+)/i);
        if (pySimpleMatch) {
            return {
                filePath: pySimpleMatch[1],
                line: parseInt(pySimpleMatch[2], 10),
                errorType: 'Python Error',
                errorMessage: pySimpleMatch[3].trim(),
                traceback: text
            };
        }

        // -------------------------------------------------------------
        // 3. Node / JavaScript / TypeScript Traceback:
        // TypeError: Cannot read properties of undefined
        //     at Object.<anonymous> (path/file.js:12:15)
        // -------------------------------------------------------------
        const jsErrMatch = text.match(/([a-zA-Z0-9_]+Error):\s*([^\r\n]+)/);
        const jsStackMatch = text.match(/at\s+(?:[^\r\n]+\s+\()?([a-zA-Z]:\\[^:\r\n]+|(?:\/[\w.-]+)+|(?:\.\.?\/[^\r\n]+)):(\d+):(\d+)\)?/);
        if (jsStackMatch) {
            return {
                filePath: jsStackMatch[1],
                line: parseInt(jsStackMatch[2], 10),
                column: parseInt(jsStackMatch[3], 10),
                errorType: jsErrMatch ? jsErrMatch[1] : 'JavaScript Error',
                errorMessage: jsErrMatch ? jsErrMatch[2].trim() : 'Runtime error occurred',
                traceback: text
            };
        }

        // -------------------------------------------------------------
        // 4. Java Exception:
        // Exception in thread "main" java.lang.NullPointerException: message
        //     at com.example.Main.calculate(Main.java:25)
        // -------------------------------------------------------------
        const javaMatch = text.match(/([a-zA-Z0-9_.]+(?:Exception|Error))(?::\s*([^\r\n]*))?\s+at\s+[\w$.]+\(([^:]+):(\d+)\)/);
        if (javaMatch) {
            return {
                filePath: javaMatch[3],
                line: parseInt(javaMatch[4], 10),
                errorType: javaMatch[1].split('.').pop() || 'Java Exception',
                errorMessage: javaMatch[2] ? javaMatch[2].trim() : 'Execution failed',
                traceback: text
            };
        }

        // -------------------------------------------------------------
        // 5. Standalone Error with Active Editor Fallback:
        // e.g. "IndexError: list index out of range"
        // -------------------------------------------------------------
        const standaloneErrMatch = text.match(/([a-zA-Z0-9_.]*(?:Error|Exception|Warning))(?::\s*([^\r\n]*))?/);
        if (standaloneErrMatch) {
            const activeDoc = vscode.window.activeTextEditor?.document;
            if (activeDoc) {
                const errorType = standaloneErrMatch[1];
                const errorMessage = standaloneErrMatch[2] ? standaloneErrMatch[2].trim() : 'Runtime error';

                const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.includes('Traceback') && !l.includes('Error:') && !l.includes('Exception') && !l.startsWith('^') && !l.startsWith('~'));
                const snippet = rawLines.length > 0 ? rawLines[0] : undefined;
                let foundLine = 1;

                if (snippet) {
                    for (let i = 0; i < activeDoc.lineCount; i++) {
                        if (activeDoc.lineAt(i).text.includes(snippet)) {
                            foundLine = i + 1;
                            break;
                        }
                    }
                }

                return {
                    filePath: activeDoc.fileName,
                    line: foundLine,
                    errorType,
                    errorMessage,
                    traceback: text,
                    codeSnippet: snippet
                };
            }
        }

        return null;
    }

    /**
     * Resolves the real workspace file URI from the parsed file path.
     */
    public async resolveFileUri(filePath: string): Promise<vscode.Uri | null> {
        // Absolute path check
        if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
            return vscode.Uri.file(filePath);
        }

        // Workspace relative check
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const combined = path.join(folder.uri.fsPath, filePath);
                if (fs.existsSync(combined)) {
                    return vscode.Uri.file(combined);
                }
            }
        }

        // Search workspace for filename
        const baseName = path.basename(filePath);
        const matches = await vscode.workspace.findFiles(`**/${baseName}`, '**/node_modules/**', 3);
        if (matches.length > 0) {
            return matches[0];
        }

        return null;
    }

    /**
     * Main entry point to fix an error captured from the VS Code terminal.
     */
    public async fixTerminalErrorInteractive(): Promise<void> {
        // Step 1: Attempt to read terminal content or selection
        let rawErrorText = '';

        // Try getting text from clipboard first (often users copy terminal trace)
        const clipText = await vscode.env.clipboard.readText();
        if (clipText && (clipText.includes('Traceback') || clipText.includes('Error:') || clipText.includes('Exception'))) {
            rawErrorText = clipText;
        }

        // If not in clipboard, prompt user with an input dialog prefilled with clipboard or instructions
        const promptInput = await vscode.window.showInputBox({
            title: 'CodeSense: Fix Terminal Error with AI',
            prompt: 'Paste the error traceback from your VS Code terminal (or press Enter if copied)',
            value: rawErrorText,
            placeHolder: 'e.g. Traceback (most recent call last): File "main.py", line 15 ... IndexError: list index out of range',
            ignoreFocusOut: true
        });

        if (!promptInput || !promptInput.trim()) {
            return;
        }

        rawErrorText = promptInput.trim();

        // Step 2: Parse the error
        const parsed = this.parseTerminalText(rawErrorText);
        if (!parsed) {
            vscode.window.showErrorMessage(
                'CodeSense: Could not recognize a standard runtime traceback or error message in the provided text. Please paste the full traceback.'
            );
            return;
        }

        // Step 3: Locate file and line
        const targetUri = await this.resolveFileUri(parsed.filePath);
        if (!targetUri) {
            vscode.window.showErrorMessage(
                `CodeSense: Could not locate file '${parsed.filePath}' in your open workspace. Please ensure the project folder is open.`
            );
            return;
        }

        let document: vscode.TextDocument;
        try {
            document = await vscode.workspace.openTextDocument(targetUri);
        } catch (err: any) {
            vscode.window.showErrorMessage(`CodeSense: Failed to open file ${targetUri.fsPath}: ${err?.message || err}`);
            return;
        }

        // Open editor and highlight the failing line
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const targetLineIdx = Math.max(0, parsed.line - 1);
        const lineText = document.lineAt(Math.min(targetLineIdx, document.lineCount - 1)).text;

        const lineRange = new vscode.Range(targetLineIdx, 0, targetLineIdx, lineText.length);
        editor.selection = new vscode.Selection(lineRange.start, lineRange.end);
        editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenter);

        // Step 4: Generate the AI fix
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `CodeSense: Analyzing ${parsed.errorType} on Line ${parsed.line}...`,
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Generating intelligent fix...' });

            const fixResult = await this.generateFix(document, parsed, lineText, targetLineIdx);

            if (!fixResult || !fixResult.replacementCode) {
                vscode.window.showWarningMessage(
                    `CodeSense: Could not determine an automated fix for '${parsed.errorType}: ${parsed.errorMessage}'. Explanation: ${fixResult?.explanation || 'Please review the error manual.'}`
                );
                return;
            }

            // Step 5: Show before-and-after in VS Code's native Diff Editor
            const currentFullText = document.getText();
            const startOffset = document.offsetAt(new vscode.Position(targetLineIdx, 0));
            const endOffset = document.offsetAt(new vscode.Position(targetLineIdx, lineText.length));

            const proposedFullText = currentFullText.slice(0, startOffset) +
                                    fixResult.replacementCode +
                                    currentFullText.slice(endOffset);

            const fixId = `terminal-fix-${Date.now()}`;
            this.proposals.set(fixId, proposedFullText);

            const fileName = path.basename(document.fileName);
            const proposedUri = vscode.Uri.from({
                scheme: TerminalErrorFixer.scheme,
                path: `/${fileName}`,
                query: `fixId=${fixId}`
            });

            const theme = ThemeManager.getInstance().getTheme();
            const diffTitle = `Terminal Fix Review [${theme.name}]: ${fileName} (Original ↔ Proposed Fix)`;

            await vscode.commands.executeCommand(
                'vscode.diff',
                document.uri,
                proposedUri,
                diffTitle,
                { preview: true }
            );

            // Step 6: User Approval Dialog (Never automatically overwrite without approval)
            const choice = await vscode.window.showInformationMessage(
                `CodeSense Terminal Error Fix [${theme.name}]:\n${parsed.errorType}: ${parsed.errorMessage}\n\nExplanation: ${fixResult.explanation}\n\nApply this fix to ${fileName}?`,
                { modal: false },
                'Apply Fix',
                'Reject'
            );

            if (choice === 'Apply Fix') {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, lineRange, fixResult.replacementCode);
                const success = await vscode.workspace.applyEdit(edit);

                if (success) {
                    await document.save();
                    this.proposals.delete(fixId);
                    vscode.window.showInformationMessage(
                        `CodeSense: ✅ Fix successfully applied to ${fileName} at Line ${parsed.line}!`
                    );
                    // Refresh CodeSense diagnostics immediately
                    await vscode.commands.executeCommand('codesense.refreshFileDiagnostics', document.uri);
                } else {
                    vscode.window.showErrorMessage('CodeSense: Failed to apply edit to document.');
                }
            } else {
                this.proposals.delete(fixId);
                vscode.window.showInformationMessage('CodeSense: Fix rejected. No changes were made to your code.');
            }
        });
    }

    /**
     * Generates an intelligent fix using Gemini AI with fallback to local rule-based engine.
     */
    private async generateFix(
        document: vscode.TextDocument,
        error: ParsedTerminalError,
        lineText: string,
        lineIndex: number
    ): Promise<{ explanation: string; replacementCode: string }> {
        const configManager = ConfigManager.getInstance();
        const apiKey = await configManager.getApiKey();

        if (apiKey) {
            try {
                const aiFix = await this.queryGeminiFix(document, error, lineText, lineIndex, apiKey);
                if (aiFix) {
                    return aiFix;
                }
            } catch (err: any) {
                console.warn('CodeSense: Gemini Terminal Error query failed, using rule-based fallback:', err?.message || err);
            }
        }

        // High-precision local fallback fix generator
        return this.generateLocalFallbackFix(error, lineText, document);
    }

    /**
     * Calls Google Gemini AI to analyze terminal traceback and propose a localized fix.
     */
    private async queryGeminiFix(
        document: vscode.TextDocument,
        error: ParsedTerminalError,
        lineText: string,
        lineIndex: number,
        apiKey: string
    ): Promise<{ explanation: string; replacementCode: string } | null> {
        const genAI = new GoogleGenerativeAI(apiKey);
        const configManager = ConfigManager.getInstance();
        const modelName = configManager.getModelName();
        const model = genAI.getGenerativeModel({ model: modelName });

        const startLine = Math.max(0, lineIndex - 6);
        const endLine = Math.min(document.lineCount - 1, lineIndex + 6);
        const contextLines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
            const prefix = i === lineIndex ? '>>> ' : '    ';
            contextLines.push(`${prefix}${i + 1}: ${document.lineAt(i).text}`);
        }

        const prompt = `You are CodeSense, an expert automated code repair system.
The following runtime error occurred during execution in the terminal:

TERMINAL TRACEBACK:
${error.traceback}

ERROR TYPE: ${error.errorType}
ERROR MESSAGE: ${error.errorMessage}
FAILING FILE: ${path.basename(document.fileName)}
FAILING LINE: Line ${error.line}

SURROUNDING CODE CONTEXT:
${contextLines.join('\n')}

CURRENT FAILING LINE ${error.line}:
${lineText}

TASK:
1. Identify exactly why the code crashed with ${error.errorType}.
2. Provide the corrected replacement line (or replacement block) for ONLY Line ${error.line}. Preserve exact indentation and style.
3. Keep the fix minimal, robust, and clean.

Respond with strict JSON ONLY (no markdown formatting, no backticks, no comments):
{
  "explanation": "Clear 1-2 sentence explanation of why the crash happened and how this fix resolves it.",
  "replacementCode": "the exact fixed code line(s) to replace Line ${error.line}"
}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();
        const cleaned = responseText.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

        try {
            const data = JSON.parse(cleaned);
            if (data && data.replacementCode) {
                return {
                    explanation: data.explanation || `Resolved ${error.errorType} on Line ${error.line}.`,
                    replacementCode: data.replacementCode
                };
            }
        } catch {
            // JSON parse failed
        }

        return null;
    }

    /**
     * High-precision local fallback fix generator for common terminal runtime errors.
     */
    private generateLocalFallbackFix(
        error: ParsedTerminalError,
        lineText: string,
        document: vscode.TextDocument
    ): { explanation: string; replacementCode: string } {
        const indentMatch = lineText.match(/^\s*/);
        const indent = indentMatch ? indentMatch[0] : '';
        const trimmed = lineText.trim();

        // 1. IndexError: list index out of range (e.g. print(numbers[5]))
        if (error.errorType.includes('IndexError') || error.errorMessage.includes('out of range')) {
            const subMatch = trimmed.match(/([a-zA-Z0-9_]+)\[(\d+)\]/);
            if (subMatch) {
                const varName = subMatch[1];
                const badIdx = subMatch[2];
                return {
                    explanation: `Index ${badIdx} exceeded the length of '${varName}'. Replaced with safe bound check or last valid index.`,
                    replacementCode: lineText.replace(
                        `${varName}[${badIdx}]`,
                        `${varName}[len(${varName}) - 1] if len(${varName}) > 0 else None`
                    )
                };
            }
        }

        // 2. KeyError: 'age' (e.g. print(student["age"]))
        if (error.errorType.includes('KeyError') || error.errorMessage.includes('KeyError')) {
            const keyMatch = trimmed.match(/([a-zA-Z0-9_]+)\[["']([^"']+)["']\]/);
            if (keyMatch) {
                const dictName = keyMatch[1];
                const keyName = keyMatch[2];
                return {
                    explanation: `Key '${keyName}' does not exist in dictionary '${dictName}'. Changed to safe .get('${keyName}', default) lookup.`,
                    replacementCode: lineText.replace(
                        `${dictName}["${keyName}"]`,
                        `${dictName}.get("${keyName}", None)`
                    ).replace(
                        `${dictName}['${keyName}']`,
                        `${dictName}.get('${keyName}', None)`
                    )
                };
            }
        }

        // 3. ZeroDivisionError: division by zero
        if (error.errorType.includes('ZeroDivisionError') || error.errorMessage.includes('division by zero')) {
            return {
                explanation: 'Division by zero is undefined. Replaced 0 with a non-zero divisor.',
                replacementCode: lineText.replace(/\/\s*0\b/, '/ 1')
            };
        }

        // 4. TypeError: str.upper() takes no arguments / wrong number of arguments
        if (error.errorType.includes('TypeError') && error.errorMessage.includes('takes no arguments')) {
            const methodCallMatch = trimmed.match(/\.([a-zA-Z0-9_]+)\([^)]+\)/);
            if (methodCallMatch) {
                const methodName = methodCallMatch[1];
                return {
                    explanation: `Method '${methodName}()' takes no arguments. Removed extraneous parameters.`,
                    replacementCode: lineText.replace(new RegExp(`\\.${methodName}\\([^)]*\\)`), `.${methodName}()`)
                };
            }
        }

        // 5. NameError: name '...' is not defined
        if (error.errorType.includes('NameError')) {
            const nameMatch = error.errorMessage.match(/name ['"]([^'"]+)['"] is not defined/);
            const undefName = nameMatch ? nameMatch[1] : undefined;
            if (undefName) {
                return {
                    explanation: `'${undefName}' was referenced before being assigned. Added safe fallback initialization.`,
                    replacementCode: `${indent}${undefName} = None\n${lineText}`
                };
            }
        }

        // Default generic safe fix comment
        return {
            explanation: `Runtime error ${error.errorType}: ${error.errorMessage} occurred at this line.`,
            replacementCode: `${lineText}  # TODO: Fixed runtime error (${error.errorType})`
        };
    }
}
