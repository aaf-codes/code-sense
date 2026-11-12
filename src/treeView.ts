import * as vscode from 'vscode';
import * as path from 'path';
import { DiagnosticsManager } from './diagnostics';
import { CodebaseGraphManager } from './graph';
import { CodeIssue } from './types';
import { formatBeginnerPlainText } from './formatter';
import { ThemeManager } from './theme';
import { ConfigManager } from './config';

export class ProjectErrorMapProvider implements vscode.TreeDataProvider<TreeItemNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItemNode | undefined | null | void> = new vscode.EventEmitter<TreeItemNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItemNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private diagnosticsManager: DiagnosticsManager;
    private graphManager: CodebaseGraphManager;

    constructor(diagnosticsManager: DiagnosticsManager, graphManager: CodebaseGraphManager) {
        this.diagnosticsManager = diagnosticsManager;
        this.graphManager = graphManager;

        // Auto-refresh error map when issues change
        this.diagnosticsManager.onIssuesChanged(() => {
            this.refresh();
        });

        // Auto-refresh error map when theme changes in Theme Studio
        ThemeManager.getInstance().onThemeChanged(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItemNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItemNode): Promise<TreeItemNode[]> {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const graph = this.graphManager.getGraph();
        const issuesMap = this.diagnosticsManager.getAllIssues();
        const resolvedMap = this.diagnosticsManager.getResolvedIssues();

        if (!element) {
            // Root elements: List all project files with 🔴, 🟠, 🟢 indicators and error counts
            const filePaths = new Set<string>();

            // Files from AST graph
            for (const relPath of graph.nodes.keys()) {
                filePaths.add(relPath);
            }

            // Files with active diagnostics
            for (const uriKey of issuesMap.keys()) {
                const uri = vscode.Uri.parse(uriKey);
                const rel = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
                filePaths.add(rel);
            }

            // Files with resolved diagnostics
            for (const uriKey of resolvedMap.keys()) {
                const uri = vscode.Uri.parse(uriKey);
                const rel = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
                filePaths.add(rel);
            }

            // Files from workspace scan if graph is new
            if (filePaths.size === 0) {
                const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,py}', '**/node_modules/**');
                for (const f of files) {
                    const rel = path.relative(rootPath, f.fsPath).replace(/\\/g, '/');
                    filePaths.add(rel);
                }
            }

            const sortedFiles = Array.from(filePaths).sort();
            const nodes: TreeItemNode[] = [];

            for (const relPath of sortedFiles) {
                const fullPath = path.resolve(rootPath, relPath);
                const fileUri = vscode.Uri.file(fullPath);
                const issues = issuesMap.get(fileUri.toString()) || [];
                const resolved = resolvedMap.get(fileUri.toString()) || [];
                const fileName = path.basename(relPath);

                const activeCount = issues.length;
                const resolvedCount = resolved.length;
                const errCount = issues.filter(i => i.severity === vscode.DiagnosticSeverity.Error).length;

                const theme = ThemeManager.getInstance().getTheme();
                const errBadge = theme.colors.badgeEmoji.error;
                const warnBadge = theme.colors.badgeEmoji.warning;
                const okBadge = theme.id === 'default' ? '🟢' : theme.colors.badgeEmoji.themeIcon;
                const successBadge = theme.colors.badgeEmoji.success;

                // Status indicators: styled according to active CodeSense theme
                let badge = okBadge;
                let desc = 'No errors';
                let nodeType: 'errorFile' | 'cleanFile' = 'cleanFile';

                if (activeCount >= 2 || errCount >= 2) {
                    badge = errBadge;
                    desc = resolvedCount > 0 ? `${activeCount} errors (${resolvedCount} fixed ${successBadge})` : `${activeCount} errors`;
                    nodeType = 'errorFile';
                } else if (activeCount === 1) {
                    badge = warnBadge;
                    desc = resolvedCount > 0 ? `1 error (${resolvedCount} fixed ${successBadge})` : `1 error`;
                    nodeType = 'errorFile';
                } else if (resolvedCount > 0) {
                    badge = okBadge;
                    desc = `All ${resolvedCount} error(s) corrected! ${successBadge}`;
                    nodeType = 'cleanFile';
                }

                const fileItem = new TreeItemNode(
                    `${badge} ${fileName}`,
                    desc,
                    (activeCount > 0 || resolvedCount > 0) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    nodeType
                );

                fileItem.filePath = relPath;
                fileItem.resourceUri = fileUri;
                fileItem.issues = issues;
                fileItem.resolvedIssues = resolved;
                fileItem.contextValue = 'errorMapFile';
                fileItem.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [fileUri]
                };

                nodes.push(fileItem);
            }

            if (nodes.length === 0) {
                return [
                    new TreeItemNode(
                        'No project files found',
                        'Open files or run workspace scan to see Project Error Map.',
                        vscode.TreeItemCollapsibleState.None,
                        'info'
                    )
                ];
            }

            return nodes;
        } else if (element.filePath) {
            // Child elements of a file: Detected errors, Corrected errors, and dependencies
            const children: TreeItemNode[] = [];
            const fileIssues = element.issues || [];
            const fileResolved = element.resolvedIssues || [];
            const relPath = element.filePath;

            // 1. Active detected errors
            const theme = ThemeManager.getInstance().getTheme();
            const errIcon = theme.colors.badgeEmoji.error;
            const successIcon = theme.colors.badgeEmoji.success;

            for (const issue of fileIssues) {
                const label = issue.errorName ? `${errIcon} Line ${issue.line}: ${issue.errorName}` : `${errIcon} Line ${issue.line}: ${issue.cause}`;
                const description = issue.whatHappened || issue.fix;
                const item = new TreeItemNode(
                    label,
                    description,
                    vscode.TreeItemCollapsibleState.None,
                    issue.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'
                );

                item.command = {
                    command: 'vscode.open',
                    title: 'Go to issue',
                    arguments: [
                        issue.fileUri,
                        {
                            selection: new vscode.Range(
                                issue.line - 1,
                                issue.startChar,
                                issue.line - 1,
                                issue.endChar
                            )
                        }
                    ]
                };

                item.tooltip = formatBeginnerPlainText(issue);
                item.contextValue = 'codeSenseIssueItem';
                item.issue = issue;
                children.push(item);
            }

            // 2. Corrected / Resolved errors with friendly hints
            for (const res of fileResolved) {
                const label = res.errorName ? `Line ${res.line}: ${res.errorName} – Corrected!` : `Line ${res.line}: Fixed!`;
                const hint = res.resolvedHint || 'Fixed and verified ✅';
                const item = new TreeItemNode(
                    label,
                    hint,
                    vscode.TreeItemCollapsibleState.None,
                    'resolved'
                );

                const mdTooltip = new vscode.MarkdownString();
                mdTooltip.appendMarkdown(`### ✅ Error Corrected!\n\n`);
                mdTooltip.appendMarkdown(`**📍 Location:** \`${path.basename(element.filePath)} – Line ${res.line}\`\n\n`);
                if (res.errorName) {
                    mdTooltip.appendMarkdown(`**🔴 Original Issue:** ${res.errorName}\n\n`);
                }
                mdTooltip.appendMarkdown(`**💡 Status:** This line has been corrected. CodeSense verified that the code is now valid!\n\n`);
                mdTooltip.appendMarkdown(`*Click to view corrected line in ${path.basename(element.filePath)}.*`);

                item.tooltip = mdTooltip;
                item.command = {
                    command: 'vscode.open',
                    title: 'Go to corrected line',
                    arguments: [
                        res.fileUri,
                        {
                            selection: new vscode.Range(
                                res.line - 1,
                                res.startChar,
                                res.line - 1,
                                res.endChar
                            )
                        }
                    ]
                };
                item.contextValue = 'codeSenseResolvedItem';
                item.issue = res;
                children.push(item);
            }

            // 3. Cross-file dependencies
            const fileNode = graph.nodes.get(relPath);
            if (fileNode) {
                // Imports
                for (const imp of fileNode.imports) {
                    const depItem = new TreeItemNode(
                        `🔗 Imports '${imp.symbol}'`,
                        `from ${imp.rawSource} (Line ${imp.line})`,
                        vscode.TreeItemCollapsibleState.None,
                        'dependency'
                    );
                    depItem.tooltip = `Cross-file import: '${imp.symbol}' from ${imp.rawSource}`;
                    children.push(depItem);
                }

                // Files that depend on this file
                const dependentEdges = graph.edges.filter(e => e.toFile === relPath);
                for (const edge of dependentEdges) {
                    const depItem = new TreeItemNode(
                        `🔗 Used by ${path.basename(edge.fromFile)}`,
                        `uses '${edge.symbol}'`,
                        vscode.TreeItemCollapsibleState.None,
                        'dependency'
                    );
                    depItem.tooltip = `Cross-file dependent: '${edge.fromFile}' imports '${edge.symbol}' from this file`;
                    children.push(depItem);
                }
            }

            return children;
        }

        return [];
    }
}

export class CodeSenseIssuesProvider implements vscode.TreeDataProvider<TreeItemNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItemNode | undefined | null | void> = new vscode.EventEmitter<TreeItemNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItemNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private diagnosticsManager: DiagnosticsManager;

    constructor(diagnosticsManager: DiagnosticsManager) {
        this.diagnosticsManager = diagnosticsManager;
        this.diagnosticsManager.onIssuesChanged(() => {
            this._onDidChangeTreeData.fire();
        });
        ThemeManager.getInstance().onThemeChanged(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItemNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItemNode): Promise<TreeItemNode[]> {
        if (!element) {
            // Root elements: Group by file
            const issuesMap = this.diagnosticsManager.getAllIssues();
            const fileNodes: TreeItemNode[] = [];

            for (const [uriKey, issues] of issuesMap.entries()) {
                if (issues.length === 0) {
                    continue;
                }
                const uri = vscode.Uri.parse(uriKey);
                const fileName = path.basename(uri.fsPath);
                const fileNode = new TreeItemNode(
                    fileName,
                    `${issues.length} issue${issues.length > 1 ? 's' : ''}`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'file'
                );
                fileNode.resourceUri = uri;
                fileNode.issues = issues;
                fileNodes.push(fileNode);
            }

            if (fileNodes.length === 0) {
                return Promise.resolve([
                    new TreeItemNode(
                        'No issues detected',
                        'Codebase looks clean! Run "CodeSense: Analyze Current File" to scan.',
                        vscode.TreeItemCollapsibleState.None,
                        'info'
                    )
                ]);
            }

            return Promise.resolve(fileNodes);
        } else if (element.issues) {
            // Child elements: Issues in the file
            const issueNodes = element.issues.map(issue => {
                const label = issue.errorName ? `Line ${issue.line}: ${issue.errorName}` : `Line ${issue.line}: ${issue.cause}`;
                const description = issue.whatHappened ? issue.whatHappened : (issue.relatedFile ? `Fix: ${issue.fix} (via ${issue.relatedFile})` : `Fix: ${issue.fix}`);
                const item = new TreeItemNode(
                    label,
                    description,
                    vscode.TreeItemCollapsibleState.None,
                    issue.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'
                );

                item.command = {
                    command: 'vscode.open',
                    title: 'Go to issue',
                    arguments: [
                        issue.fileUri,
                        {
                            selection: new vscode.Range(
                                issue.line - 1,
                                issue.startChar,
                                issue.line - 1,
                                issue.endChar
                            )
                        }
                    ]
                };

                item.tooltip = formatBeginnerPlainText(issue);
                return item;
            });

            return Promise.resolve(issueNodes);
        }

        return Promise.resolve([]);
    }
}

export class CodebaseGraphProvider implements vscode.TreeDataProvider<TreeItemNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItemNode | undefined | null | void> = new vscode.EventEmitter<TreeItemNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItemNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private graphManager: CodebaseGraphManager;

    constructor(graphManager: CodebaseGraphManager) {
        this.graphManager = graphManager;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItemNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItemNode): Thenable<TreeItemNode[]> {
        const graph = this.graphManager.getGraph();

        if (!element) {
            // List all indexed files
            const nodes: TreeItemNode[] = [];
            for (const [relPath, fileNode] of graph.nodes.entries()) {
                const item = new TreeItemNode(
                    fileNode.fileName,
                    relPath,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'graphFile'
                );
                item.filePath = relPath;
                nodes.push(item);
            }

            if (nodes.length === 0) {
                return Promise.resolve([
                    new TreeItemNode(
                        'Graph empty',
                        'Open files or run workspace scan to build dependency graph.',
                        vscode.TreeItemCollapsibleState.None,
                        'info'
                    )
                ]);
            }

            return Promise.resolve(nodes);
        } else if (element.filePath) {
            // Show exports and imports of this file
            const fileNode = graph.nodes.get(element.filePath);
            if (!fileNode) {
                return Promise.resolve([]);
            }

            const children: TreeItemNode[] = [];

            // Exports
            for (const exp of fileNode.exports) {
                const params = exp.params ? `(${exp.params.join(', ')})` : '';
                children.push(new TreeItemNode(
                    `Export: ${exp.name}${params}`,
                    `Line ${exp.line} (${exp.kind})`,
                    vscode.TreeItemCollapsibleState.None,
                    'export'
                ));
            }

            // Imports
            for (const imp of fileNode.imports) {
                children.push(new TreeItemNode(
                    `Import: ${imp.symbol}`,
                    `from '${imp.rawSource}' (Line ${imp.line})`,
                    vscode.TreeItemCollapsibleState.None,
                    'import'
                ));
            }

            return Promise.resolve(children);
        }

        return Promise.resolve([]);
    }
}

export class TreeItemNode extends vscode.TreeItem {
    public issues?: CodeIssue[];
    public resolvedIssues?: CodeIssue[];
    public filePath?: string;
    public issue?: CodeIssue;

    constructor(
        label: string,
        description: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        type: 'file' | 'error' | 'warning' | 'info' | 'graphFile' | 'export' | 'import' | 'cleanFile' | 'errorFile' | 'dependency' | 'resolved'
    ) {
        super(label, collapsibleState);
        this.description = description;

        if (type === 'error') {
            this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
        } else if (type === 'warning') {
            this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
        } else if (type === 'resolved') {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        } else if (type === 'file' || type === 'errorFile') {
            this.iconPath = new vscode.ThemeIcon('file-code');
        } else if (type === 'cleanFile') {
            this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else if (type === 'dependency') {
            this.iconPath = new vscode.ThemeIcon('references');
        } else if (type === 'graphFile') {
            this.iconPath = new vscode.ThemeIcon('file-submodule');
        } else if (type === 'export') {
            this.iconPath = new vscode.ThemeIcon('symbol-function');
        } else if (type === 'import') {
            this.iconPath = new vscode.ThemeIcon('symbol-interface');
        } else {
            this.iconPath = new vscode.ThemeIcon('info');
        }
    }
}
