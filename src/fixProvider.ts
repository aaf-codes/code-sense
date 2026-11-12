import * as vscode from 'vscode';
import * as path from 'path';
import { DiagnosticsManager } from './diagnostics';
import { CodeIssue } from './types';
import { ThemeManager } from './theme';

/**
 * Manages One-Click AI Fixes using VS Code's native Diff Editor.
 * Displays side-by-side comparison with Apply and Reject options.
 */
export class AIFixProvider implements vscode.TextDocumentContentProvider {
    public static readonly scheme = 'codesense-fix';
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;

    private proposals = new Map<string, string>();
    private diagnosticsManager: DiagnosticsManager;
    private onFixAppliedCallback?: (fileUri: vscode.Uri) => Promise<void>;

    constructor(diagnosticsManager: DiagnosticsManager) {
        this.diagnosticsManager = diagnosticsManager;
    }

    public setOnFixAppliedCallback(cb: (fileUri: vscode.Uri) => Promise<void>): void {
        this.onFixAppliedCallback = cb;
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        const queryParams = new URLSearchParams(uri.query);
        const fixId = queryParams.get('fixId');
        if (fixId && this.proposals.has(fixId)) {
            return this.proposals.get(fixId)!;
        }
        return '// Proposed AI fix content not found or already applied.';
    }

    /**
     * Triggers the One-Click AI Fix flow:
     * 1. Calculates proposed corrected code.
     * 2. Displays before-and-after change in VS Code's native diff editor.
     * 3. Prompts user with Apply and Reject options.
     * 4. Modifies code ONLY if approved by user.
     */
    public async startAIFix(fileUri: vscode.Uri, issueOrId?: CodeIssue | string): Promise<void> {
        let document: vscode.TextDocument;
        try {
            document = await vscode.workspace.openTextDocument(fileUri);
        } catch (err: any) {
            vscode.window.showErrorMessage(`CodeSense: Could not open document: ${err?.message || err}`);
            return;
        }

        const issues = this.diagnosticsManager.getAllIssues().get(fileUri.toString()) || [];
        if (issues.length === 0) {
            vscode.window.showInformationMessage('CodeSense: No active errors in this file to fix!');
            return;
        }

        let targetIssue: CodeIssue | undefined;
        if (typeof issueOrId === 'string') {
            targetIssue = issues.find(i => i.id === issueOrId);
        } else if (issueOrId && typeof issueOrId === 'object' && 'id' in issueOrId) {
            targetIssue = issueOrId;
        }

        // If not specified, pick issue at current cursor position or first issue
        if (!targetIssue) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.toString() === fileUri.toString()) {
                const curLine = editor.selection.active.line + 1;
                targetIssue = issues.find(i => i.line === curLine) || issues[0];
            } else {
                targetIssue = issues[0];
            }
        }

        if (!targetIssue) {
            vscode.window.showWarningMessage('CodeSense: No error found to fix.');
            return;
        }

        const replacementCode = targetIssue.replacementCode || targetIssue.correctedCode;
        if (!replacementCode) {
            vscode.window.showWarningMessage(
                `CodeSense: No automated fix snippet available for "${targetIssue.errorName || 'this issue'}". Please follow the steps in the error tooltip.`
            );
            return;
        }

        // Compute proposed content using exact target range
        const currentText = document.getText();
        const startLine = Math.max(0, targetIssue.line - 1);
        const endLine = targetIssue.endLine ? Math.max(0, targetIssue.endLine - 1) : startLine;

        const targetRange = new vscode.Range(
            startLine,
            targetIssue.startChar,
            endLine,
            targetIssue.endChar
        );

        const startOffset = document.offsetAt(targetRange.start);
        const endOffset = document.offsetAt(targetRange.end);
        const proposedText = currentText.slice(0, startOffset) + replacementCode + currentText.slice(endOffset);

        // Store proposal in virtual provider under unique fixId
        const fixId = `fix-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.proposals.set(fixId, proposedText);

        const fileName = path.basename(document.fileName);
        const proposedUri = vscode.Uri.from({
            scheme: AIFixProvider.scheme,
            path: `/${fileName}`,
            query: `fixId=${fixId}`
        });

        const theme = ThemeManager.getInstance().getTheme();
        const diffTitle = `AI Fix Review [${theme.name}]: ${fileName} (Original ↔ Proposed Fix)`;

        // 1. Open native VS Code Diff Editor
        await vscode.commands.executeCommand(
            'vscode.diff',
            document.uri,
            proposedUri,
            diffTitle,
            { preview: true }
        );

        // 2. Prompt user with Apply and Reject options
        const errorTitle = targetIssue.errorName || 'Detected Issue';
        const choice = await vscode.window.showInformationMessage(
            `CodeSense [${theme.name}] AI Fix: Proposed solution for "${errorTitle}" on Line ${targetIssue.line}.\nApply this fix to ${fileName}?`,
            { modal: false },
            'Apply Fix',
            'Reject'
        );

        if (choice === 'Apply Fix') {
            // Immediately mark resolved in diagnostics manager to clear the red line without waiting
            this.diagnosticsManager.markIssueResolved(
                document.uri,
                targetIssue.id,
                `Fixed with AI (${theme.name}) ${theme.colors.badgeEmoji.success}`
            );

            // User approved: Apply changes via WorkspaceEdit
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, targetRange, replacementCode);
            const applied = await vscode.workspace.applyEdit(edit);

            this.proposals.delete(fixId);

            if (applied) {
                // Focus the modified document
                await vscode.window.showTextDocument(document.uri, { preview: false });

                // Immediately trigger re-analysis and refresh error map & diagnostics
                if (this.onFixAppliedCallback) {
                    await this.onFixAppliedCallback(document.uri);
                }

                vscode.window.showInformationMessage(`CodeSense: ✅ AI fix successfully applied to ${fileName}!`);
            } else {
                vscode.window.showErrorMessage(`CodeSense: Failed to apply edit to ${fileName}.`);
            }
        } else {
            // User rejected: Do NOT modify code
            this.proposals.delete(fixId);
            vscode.window.showInformationMessage('CodeSense: ❌ AI fix was rejected. No changes were made.');
        }
    }

    public dispose(): void {
        this.proposals.clear();
        this._onDidChange.dispose();
    }
}

