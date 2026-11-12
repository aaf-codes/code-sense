import * as vscode from 'vscode';
import { CodeIssue } from './types';
import { formatBeginnerMarkdown, formatBeginnerDiagnostic } from './formatter';

export class DiagnosticsManager implements vscode.HoverProvider, vscode.CodeActionProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private currentIssues: Map<string, CodeIssue[]> = new Map();
    private resolvedIssues: Map<string, CodeIssue[]> = new Map();
    private onIssuesChangedEmitter = new vscode.EventEmitter<void>();
    public readonly onIssuesChanged = this.onIssuesChangedEmitter.event;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('codesense');
    }

    public getDiagnosticCollection(): vscode.DiagnosticCollection {
        return this.diagnosticCollection;
    }

    public getAllIssues(): Map<string, CodeIssue[]> {
        return this.currentIssues;
    }

    public getResolvedIssues(): Map<string, CodeIssue[]> {
        return this.resolvedIssues;
    }

    /**
     * Mark an issue as resolved immediately (e.g. when QuickFix or AI Fix is applied).
     * Clears the red underline instantly from the editor without waiting.
     */
    public markIssueResolved(fileUri: vscode.Uri, issueId: string, resolvedHint?: string): void {
        const uriKey = fileUri.toString();
        const activeIssues = this.currentIssues.get(uriKey) || [];
        const index = activeIssues.findIndex(i => i.id === issueId);

        if (index !== -1) {
            const resolvedIssue = activeIssues.splice(index, 1)[0];
            resolvedIssue.resolved = true;
            resolvedIssue.resolvedAt = Date.now();
            resolvedIssue.resolvedHint = resolvedHint || `Corrected: ${resolvedIssue.errorName || 'Fixed line'} ✅`;

            // Record in resolved issues map
            const fileResolved = this.resolvedIssues.get(uriKey) || [];
            if (!fileResolved.some(r => r.id === resolvedIssue.id)) {
                fileResolved.push(resolvedIssue);
                this.resolvedIssues.set(uriKey, fileResolved);
            }

            this.currentIssues.set(uriKey, activeIssues);

            // Re-render remaining diagnostics immediately (clears this resolved error squiggle!)
            this.updateDiagnosticsForFile(fileUri, activeIssues);
            this.onIssuesChangedEmitter.fire();
        }
    }

    public setIssuesForFile(fileUri: vscode.Uri, issues: CodeIssue[]): void {
        const uriKey = fileUri.toString();
        const previousIssues = this.currentIssues.get(uriKey) || [];

        // Deduplicate issues to avoid displaying identical duplicate squiggles
        const uniqueIssues: CodeIssue[] = [];
        for (const issue of issues) {
            const isDuplicate = uniqueIssues.some(existing => {
                // Must be on the exact same line
                if (existing.line !== issue.line) {
                    return false;
                }
                // If they have identical ID, it's a duplicate
                if (existing.id === issue.id) {
                    return true;
                }
                // If they have the exact same character span AND exact same error title, it's duplicate
                if (existing.startChar === issue.startChar &&
                    existing.endChar === issue.endChar &&
                    existing.errorName === issue.errorName) {
                    return true;
                }
                // If both have the exact same cause text on the same line
                if (existing.cause === issue.cause && Math.abs(existing.startChar - issue.startChar) <= 1) {
                    return true;
                }
                return false;
            });

            if (!isDuplicate) {
                uniqueIssues.push(issue);
            }
        }

        // Detect issues that were previously active and are now FIXED by the user!
        const newlyResolved = previousIssues.filter(prev =>
            !uniqueIssues.some(curr =>
                curr.id === prev.id ||
                (curr.line === prev.line && (curr.errorName === prev.errorName || curr.startChar === prev.startChar))
            )
        );

        if (newlyResolved.length > 0) {
            const fileResolved = this.resolvedIssues.get(uriKey) || [];
            for (const res of newlyResolved) {
                if (!fileResolved.some(r => r.id === res.id || (r.line === res.line && r.errorName === res.errorName))) {
                    fileResolved.push({
                        ...res,
                        resolved: true,
                        resolvedAt: Date.now(),
                        resolvedHint: `Corrected: ${res.errorName || 'Fixed line'} ✅`
                    });
                }
            }
            this.resolvedIssues.set(uriKey, fileResolved);
        }

        this.currentIssues.set(uriKey, uniqueIssues);
        this.updateDiagnosticsForFile(fileUri, uniqueIssues);
        this.onIssuesChangedEmitter.fire();
    }

    private updateDiagnosticsForFile(fileUri: vscode.Uri, issues: CodeIssue[]): void {
        const diagnostics: vscode.Diagnostic[] = [];

        for (const issue of issues) {
            const startLine = Math.max(0, issue.line - 1);
            const endLine = issue.endLine ? Math.max(0, issue.endLine - 1) : startLine;
            const range = new vscode.Range(startLine, issue.startChar, endLine, issue.endChar);

            // Format beginner-friendly diagnostic message
            const message = formatBeginnerDiagnostic(issue);

            const diagnostic = new vscode.Diagnostic(range, message, issue.severity);
            diagnostic.source = issue.source === 'codesense-ai' ? 'CodeSense AI' : 'CodeSense AST';
            diagnostic.code = issue.id;

            if (issue.relatedFile) {
                diagnostic.relatedInformation = [
                    new vscode.DiagnosticRelatedInformation(
                        new vscode.Location(fileUri, range),
                        `Linked to '${issue.relatedFile}'`
                    )
                ];
            }

            diagnostics.push(diagnostic);
        }

        // Setting this immediately updates or clears red squiggles in VS Code!
        this.diagnosticCollection.set(fileUri, diagnostics);
    }

    public clearAll(): void {
        this.diagnosticCollection.clear();
        this.currentIssues.clear();
        this.resolvedIssues.clear();
        this.onIssuesChangedEmitter.fire();
    }

    public clearForFile(fileUri: vscode.Uri): void {
        this.diagnosticCollection.delete(fileUri);
        this.currentIssues.delete(fileUri.toString());
        this.onIssuesChangedEmitter.fire();
    }

    // Hover Provider: rich beginner-friendly card tooltip on mouse hover
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Hover> {
        const issues = this.currentIssues.get(document.uri.toString()) || [];
        const matchingIssue = issues.find(i => {
            const line = i.line - 1;
            return line === position.line && position.character >= i.startChar && position.character <= i.endChar;
        });

        if (!matchingIssue) {
            return null;
        }

        const mdContent = formatBeginnerMarkdown(matchingIssue, document.languageId);
        const md = new vscode.MarkdownString(mdContent);
        md.isTrusted = true;
        md.supportHtml = true;

        return new vscode.Hover(md);
    }

    // Code Action Provider: QuickFix lightbulb
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
        const actions: vscode.CodeAction[] = [];
        const issues = this.currentIssues.get(document.uri.toString()) || [];

        for (const diagnostic of context.diagnostics) {
            const matchingIssue = issues.find(i => i.id === diagnostic.code);
            const fixCode = matchingIssue?.replacementCode;
            if (matchingIssue && fixCode) {
                // 1. One-Click AI Fix: Displays native VS Code Diff Editor with Apply / Reject
                const aiFixAction = new vscode.CodeAction(
                    `✨ Fix with AI (Review Diff): ${matchingIssue.fix}`,
                    vscode.CodeActionKind.QuickFix
                );
                aiFixAction.diagnostics = [diagnostic];
                aiFixAction.isPreferred = true;
                aiFixAction.command = {
                    command: 'codesense.fixWithAI',
                    title: 'Fix with AI (Review Diff)',
                    arguments: [document.uri, matchingIssue]
                };
                actions.push(aiFixAction);

                // 2. Direct QuickFix
                const action = new vscode.CodeAction(
                    `⚡ Fix: ${matchingIssue.fix}`,
                    vscode.CodeActionKind.QuickFix
                );
                action.diagnostics = [diagnostic];

                const edit = new vscode.WorkspaceEdit();
                const targetRange = new vscode.Range(
                    matchingIssue.line - 1,
                    matchingIssue.startChar,
                    (matchingIssue.endLine || matchingIssue.line) - 1,
                    matchingIssue.endChar
                );

                edit.replace(document.uri, targetRange, fixCode);
                action.edit = edit;
                action.command = {
                    command: 'codesense.refreshFileDiagnostics',
                    title: 'Refresh Diagnostics',
                    arguments: [document.uri, matchingIssue.id]
                };
                actions.push(action);
            }
        }

        return actions;
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
        this.onIssuesChangedEmitter.dispose();
    }
}
