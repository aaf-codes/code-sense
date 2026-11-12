import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigManager } from './config';
import { CodebaseGraphManager } from './graph';
import { CodeAnalyzer } from './analyzer';
import { DiagnosticsManager } from './diagnostics';
import { CodeSenseIssuesProvider, CodebaseGraphProvider, ProjectErrorMapProvider } from './treeView';
import { AIFixProvider } from './fixProvider';
import { CodeIssue } from './types';
import { ThemeManager } from './theme';
import { ThemeStudioTreeProvider } from './themeTreeProvider';
import { TerminalErrorFixer } from './terminalFixer';

let statusBarItem: vscode.StatusBarItem;
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_DELAY_MS = 400;

/**
 * Checks whether a document is a supported code file for CodeSense.
 */
function isSupportedDocument(doc: vscode.TextDocument): boolean {
    if (!doc || doc.isUntitled || doc.uri.scheme !== 'file') {
        return false;
    }
    const supportedLangs = [
        'javascript', 'typescript', 'javascriptreact', 'typescriptreact',
        'python', 'java', 'html', 'css'
    ];
    if (supportedLangs.includes(doc.languageId)) {
        return true;
    }
    const ext = path.extname(doc.fileName).toLowerCase();
    return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.html', '.htm', '.css'].includes(ext);
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('CodeSense extension is now active!');

    // 1. Initialize Managers
    const themeManager = ThemeManager.initialize(context);
    const configManager = ConfigManager.initialize(context);
    const graphManager = new CodebaseGraphManager();
    const analyzer = new CodeAnalyzer(graphManager);
    const diagnosticsManager = new DiagnosticsManager();

    // 2. Build initial workspace dependency graph in background & run initial workspace error check
    graphManager.buildWorkspaceGraph().then(async () => {
        await scanAndAnalyzeWorkspace();
    }).catch(err => {
        console.error('CodeSense: Failed to build workspace graph:', err);
    });

    // 3. Register Language Providers (Diagnostics, Hovers, QuickFixes)
    const supportedLanguages = [
        { language: 'javascript' },
        { language: 'typescript' },
        { language: 'javascriptreact' },
        { language: 'typescriptreact' },
        { language: 'python' },
        { language: 'java' },
        { language: 'html' },
        { language: 'css' }
    ];

    const hoverDisposable = vscode.languages.registerHoverProvider(supportedLanguages, diagnosticsManager);
    const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
        supportedLanguages,
        diagnosticsManager,
        {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        }
    );

    context.subscriptions.push(hoverDisposable, codeActionDisposable, diagnosticsManager);

    // 4. Register Tree View Providers for Sidebar (Feature 1: Project Error Map)
    const errorMapProvider = new ProjectErrorMapProvider(diagnosticsManager, graphManager);
    const issuesProvider = new CodeSenseIssuesProvider(diagnosticsManager);
    const graphProvider = new CodebaseGraphProvider(graphManager);

    // Register Tree Views and keep disposables in subscriptions
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('codesense.errorMapView', errorMapProvider),
        vscode.window.registerTreeDataProvider('codesense.issuesView', issuesProvider),
        vscode.window.registerTreeDataProvider('codesense.graphView', graphProvider)
    );

    // Register CodeSense Theme Studio in sidebar
    const themeStudioProvider = new ThemeStudioTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('codesense.themeStudioView', themeStudioProvider)
    );

    // 5. Feature 2: One-Click AI Fix Provider (Native Diff Editor & Confirmation)
    const aiFixProvider = new AIFixProvider(diagnosticsManager);
    const aiFixContentDisposable = vscode.workspace.registerTextDocumentContentProvider(
        AIFixProvider.scheme,
        aiFixProvider
    );
    context.subscriptions.push(aiFixContentDisposable, aiFixProvider);

    // 5.B Feature 3: Terminal Error Fixer (Native Diff Editor & Confirmation)
    const terminalFixer = new TerminalErrorFixer(diagnosticsManager);
    const terminalFixerDisposable = vscode.workspace.registerTextDocumentContentProvider(
        TerminalErrorFixer.scheme,
        terminalFixer
    );
    context.subscriptions.push(terminalFixerDisposable);

    aiFixProvider.setOnFixAppliedCallback(async (fileUri) => {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri.toString());
        if (doc) {
            await triggerImmediateAnalysis(doc, false);
        } else {
            try {
                const opened = await vscode.workspace.openTextDocument(fileUri);
                await triggerImmediateAnalysis(opened, false);
            } catch {
                // Ignore
            }
        }
        errorMapProvider.refresh();
        issuesProvider.refresh();
    });

    // 6. Status Bar Item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'codesense.analyzeCurrentFile';
    statusBarItem.text = '$(eye) CodeSense: Ready';
    statusBarItem.tooltip = 'Click to run CodeSense Multi-File Error Analysis';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Initial check on Launch: Prompt user for mandatory Gemini API Key
    configManager.getApiKey().then(async key => {
        if (!key) {
            statusBarItem.text = '$(key) CodeSense: Enter Gemini API Key';
            statusBarItem.tooltip = 'Click to enter Gemini API Key to enable deep AI error detection';
            statusBarItem.command = 'codesense.setApiKey';
            // Prompt user immediately so entering API key is compulsory before running
            await configManager.promptMandatoryApiKey();
        }
    });

    // Run immediate local AST analysis on all visible editors right away on launch!
    for (const visibleEditor of vscode.window.visibleTextEditors) {
        if (isSupportedDocument(visibleEditor.document)) {
            runFastLocalCheck(visibleEditor.document);
        }
    }
    const initialEditor = vscode.window.activeTextEditor;
    if (initialEditor && isSupportedDocument(initialEditor.document)) {
        setTimeout(() => {
            triggerImmediateAnalysis(initialEditor.document, false);
        }, 300);
    }

    // Helper: Run workspace-wide scan and local AST checks across all supported files
    async function scanAndAnalyzeWorkspace() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;

        const files = await vscode.workspace.findFiles(
            '**/*.{js,jsx,ts,tsx,py,java,html,htm,css}',
            '**/node_modules/**'
        );

        for (const fileUri of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                if (isSupportedDocument(doc)) {
                    runFastLocalCheck(doc);
                }
            } catch {
                // Ignore unreadable files
            }
        }
        errorMapProvider.refresh();
        issuesProvider.refresh();
    }

    // Helper: Run fast local AST check (< 5ms) to update diagnostics and immediately clear resolved squiggles
    function runFastLocalCheck(doc: vscode.TextDocument) {
        if (!isSupportedDocument(doc)) {
            return;
        }
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const relPath = rootPath ? path.relative(rootPath, doc.fileName).replace(/\\/g, '/') : path.basename(doc.fileName);

        // Update live graph node
        graphManager.indexDocument(doc);
        graphProvider.refresh();

        // Fast local AST analysis (< 5ms)
        const localIssues = analyzer.runLocalCrossFileAnalysis(doc, relPath);

        // Update diagnostics right away so resolved squiggles disappear instantly!
        diagnosticsManager.setIssuesForFile(doc.uri, localIssues);
        errorMapProvider.refresh();
        issuesProvider.refresh();

        const errCount = localIssues.filter(i => i.severity === vscode.DiagnosticSeverity.Error).length;
        const warnCount = localIssues.filter(i => i.severity === vscode.DiagnosticSeverity.Warning).length;

        if (localIssues.length > 0) {
            statusBarItem.text = `$(error) CodeSense: ${errCount} error(s), ${warnCount} warning(s)`;
        } else {
            statusBarItem.text = '$(check) CodeSense: Clean';
        }
    }

    // Helper: Analyze a document and synchronize real-time diagnostics
    async function analyzeDoc(doc: vscode.TextDocument, showFeedback = true, cascade = true) {
        if (!isSupportedDocument(doc)) {
            return;
        }

        const startVersion = doc.version;

        // 1. ALWAYS run fast local AST check (<5ms) immediately! Never block squiggles or hover!
        runFastLocalCheck(doc);

        let apiKey = await configManager.getApiKey();
        if (!apiKey) {
            statusBarItem.text = '$(key) CodeSense: Enter Gemini API Key';
            statusBarItem.tooltip = 'Click to configure your Gemini API Key for deep AI reasoning';
            statusBarItem.command = 'codesense.setApiKey';
            if (showFeedback) {
                apiKey = await configManager.promptMandatoryApiKey();
            }
            if (!apiKey) {
                if (cascade) {
                    await reanalyzeDependentFiles(doc);
                }
                return;
            }
        }

        statusBarItem.text = '$(sync~spin) CodeSense: Analyzing with AI...';

        try {
            // 2. Run full analysis (Local AST + Gemini AI)
            const issues = await analyzer.analyzeDocument(doc);

            // If user typed during analysis, re-run fast local check on current live document
            if (doc.version !== startVersion) {
                runFastLocalCheck(doc);
                return;
            }

            // Update diagnostics: automatically removes resolved errors and highlights remaining ones
            diagnosticsManager.setIssuesForFile(doc.uri, issues);
            errorMapProvider.refresh();
            issuesProvider.refresh();

            const errCount = issues.filter(i => i.severity === vscode.DiagnosticSeverity.Error).length;
            const warnCount = issues.filter(i => i.severity === vscode.DiagnosticSeverity.Warning).length;

            if (issues.length > 0) {
                statusBarItem.text = `$(error) CodeSense: ${errCount} error(s), ${warnCount} warning(s)`;
                if (showFeedback) {
                    vscode.window.showInformationMessage(
                        `CodeSense found ${issues.length} issue(s) with beginner-friendly explanations & inline highlights. Check the CodeSense sidebar!`,
                        'View Issues'
                    ).then(selection => {
                        if (selection === 'View Issues') {
                            vscode.commands.executeCommand('codesense.issuesView.focus');
                        }
                    });
                }
            } else {
                statusBarItem.text = '$(check) CodeSense: Clean';
                if (showFeedback) {
                    vscode.window.showInformationMessage('CodeSense: No errors found! Code looks healthy.');
                }
            }

            // If this file's changes can affect other dependent files in the project, re-analyze them
            if (cascade) {
                await reanalyzeDependentFiles(doc);
            }
        } catch (error: any) {
            statusBarItem.text = '$(alert) CodeSense: Error';
            console.error('CodeSense analysis failed:', error);
            if (showFeedback) {
                vscode.window.showErrorMessage(`CodeSense analysis failed: ${error.message || error}`);
            }
        }
    }

    // Helper: Re-analyze files that import symbols from this file
    async function reanalyzeDependentFiles(doc: vscode.TextDocument) {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!rootPath) {
            return;
        }
        const relPath = path.relative(rootPath, doc.fileName).replace(/\\/g, '/');
        const graph = graphManager.getGraph();

        const dependentRelPaths = new Set<string>();
        for (const edge of graph.edges) {
            if (edge.toFile === relPath && edge.fromFile !== relPath) {
                dependentRelPaths.add(edge.fromFile);
            }
        }

        for (const depRelPath of dependentRelPaths) {
            const depUri = vscode.Uri.file(path.join(rootPath, depRelPath));
            const hasIssues = diagnosticsManager.getAllIssues().has(depUri.toString());
            const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === depUri.fsPath);

            if (openDoc) {
                scheduleAnalysis(openDoc, 300);
            } else if (hasIssues) {
                try {
                    const depDoc = await vscode.workspace.openTextDocument(depUri);
                    scheduleAnalysis(depDoc, 300);
                } catch {
                    // Ignore
                }
            }
        }
    }

    // Helper: Schedule debounced analysis on document changes
    function scheduleAnalysis(doc: vscode.TextDocument, delay: number = DEBOUNCE_DELAY_MS) {
        if (!isSupportedDocument(doc)) {
            return;
        }

        const key = doc.uri.toString();
        const existingTimer = debounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(async () => {
            debounceTimers.delete(key);
            await analyzeDoc(doc, false, true);
        }, delay);

        debounceTimers.set(key, timer);
    }

    // Helper: Immediately trigger analysis (cancelling any pending debounce timer)
    async function triggerImmediateAnalysis(doc: vscode.TextDocument, showFeedback = false) {
        if (!isSupportedDocument(doc)) {
            return;
        }

        const key = doc.uri.toString();
        const existingTimer = debounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
            debounceTimers.delete(key);
        }

        await analyzeDoc(doc, showFeedback, true);
    }

    // 6. Register Commands
    const analyzeCurrentFileCmd = vscode.commands.registerCommand('codesense.analyzeCurrentFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('CodeSense: No active file to analyze.');
            return;
        }
        await triggerImmediateAnalysis(editor.document, true);
    });

    const analyzeWorkspaceCmd = vscode.commands.registerCommand('codesense.analyzeWorkspace', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'CodeSense: Analyzing Entire Workspace...',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Building multi-file graph...' });
            await graphManager.buildWorkspaceGraph();
            graphProvider.refresh();

            const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,py}', '**/node_modules/**');
            let totalIssues = 0;

            for (let i = 0; i < files.length; i++) {
                const fileUri = files[i];
                progress.report({
                    message: `Analyzing ${i + 1}/${files.length} files...`,
                    increment: (1 / files.length) * 100
                });

                try {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    const issues = await analyzer.analyzeDocument(doc);
                    diagnosticsManager.setIssuesForFile(doc.uri, issues);
                    totalIssues += issues.length;
                } catch {
                    // Continue
                }
            }

            vscode.window.showInformationMessage(
                `CodeSense Workspace Scan Complete: Detected ${totalIssues} issue(s) across ${files.length} files.`
            );
            errorMapProvider.refresh();
        });
    });

    const clearIssuesCmd = vscode.commands.registerCommand('codesense.clearIssues', () => {
        diagnosticsManager.clearAll();
        errorMapProvider.refresh();
        statusBarItem.text = '$(eye) CodeSense: Cleared';
        vscode.window.showInformationMessage('CodeSense: Diagnostics cleared.');
    });

    const setApiKeyCmd = vscode.commands.registerCommand('codesense.setApiKey', async () => {
        const saved = await configManager.setApiKey();
        if (saved) {
            statusBarItem.text = '$(eye) CodeSense: Ready';
            statusBarItem.tooltip = 'Click to run CodeSense Multi-File Error Analysis';
            statusBarItem.command = 'codesense.analyzeCurrentFile';
            errorMapProvider.refresh();
            issuesProvider.refresh();
            const editor = vscode.window.activeTextEditor;
            if (editor && isSupportedDocument(editor.document)) {
                await triggerImmediateAnalysis(editor.document, true);
            }
        }
    });

    const showGraphCmd = vscode.commands.registerCommand('codesense.showGraph', async () => {
        await vscode.commands.executeCommand('codesense.graphView.focus');
    });

    // Feature 2 Command: One-Click AI Fix with native Diff Review
    const fixWithAICmd = vscode.commands.registerCommand(
        'codesense.fixWithAI',
        async (arg1?: any, arg2?: any) => {
            let fileUri: vscode.Uri | undefined;
            let targetIssue: CodeIssue | string | undefined;

            if (arg1 instanceof vscode.Uri) {
                fileUri = arg1;
                targetIssue = arg2;
            } else if (arg1 && typeof arg1 === 'object' && 'issue' in arg1) {
                targetIssue = arg1.issue;
                fileUri = arg1.issue?.fileUri || arg1.resourceUri;
            } else if (vscode.window.activeTextEditor) {
                fileUri = vscode.window.activeTextEditor.document.uri;
            }

            if (!fileUri) {
                vscode.window.showWarningMessage('CodeSense: No active file to apply AI fix.');
                return;
            }

            await aiFixProvider.startAIFix(fileUri, targetIssue);
        }
    );

    // Command invoked when QuickFix or AI Fix is applied
    const refreshFileDiagnosticsCmd = vscode.commands.registerCommand(
        'codesense.refreshFileDiagnostics',
        async (fileUri: vscode.Uri, resolvedIssueId?: string) => {
            if (fileUri && resolvedIssueId) {
                diagnosticsManager.markIssueResolved(fileUri, resolvedIssueId, 'Fixed via QuickFix ✅');
            }
            if (!fileUri) {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    runFastLocalCheck(editor.document);
                    await triggerImmediateAnalysis(editor.document, false);
                }
                return;
            }
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri.toString());
            if (doc) {
                runFastLocalCheck(doc);
                await triggerImmediateAnalysis(doc, false);
            } else {
                try {
                    const openedDoc = await vscode.workspace.openTextDocument(fileUri);
                    runFastLocalCheck(openedDoc);
                    await triggerImmediateAnalysis(openedDoc, false);
                } catch {
                    // Ignore
                }
            }
            errorMapProvider.refresh();
            issuesProvider.refresh();
        }
    );

    // Theme Studio Commands
    const openThemeStudioCmd = vscode.commands.registerCommand('codesense.openThemeStudio', async () => {
        await vscode.commands.executeCommand('codesense.themeStudioView.focus');
    });

    const selectThemeCmd = vscode.commands.registerCommand('codesense.selectTheme', async () => {
        const allThemes = themeManager.getAllThemes();
        const activeId = themeManager.getActiveThemeId();

        const items = allThemes.map(t => ({
            label: `${t.colors.badgeEmoji.themeIcon} ${t.name}`,
            description: t.id === activeId ? '✓ (Currently Active)' : t.tagline,
            detail: `Primary: ${t.colors.primary} | Error: ${t.colors.errorBadge} | Style: ${t.type.toUpperCase()}`,
            themeId: t.id
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a visual theme for CodeSense UI & error cards'
        });

        if (picked) {
            await themeManager.setTheme(picked.themeId);
            const newTheme = themeManager.getTheme();
            vscode.window.showInformationMessage(
                `CodeSense: Switched to ${newTheme.name} ${newTheme.colors.badgeEmoji.themeIcon}!`
            );
        }
    });

    const resetThemeCmd = vscode.commands.registerCommand('codesense.resetTheme', async () => {
        await themeManager.resetToDefault();
        vscode.window.showInformationMessage('CodeSense: Reset to Default Theme.');
    });

    const applyThemeFromStudioCmd = vscode.commands.registerCommand(
        'codesense.applyThemeFromStudio',
        async (themeId: string) => {
            if (!themeId) {
                return;
            }
            await themeManager.setTheme(themeId);
            const newTheme = themeManager.getTheme();
            vscode.window.showInformationMessage(
                `CodeSense: Switched to ${newTheme.name} ${newTheme.colors.badgeEmoji.themeIcon}!`
            );
        }
    );

    const fixTerminalErrorCmd = vscode.commands.registerCommand(
        'codesense.fixTerminalError',
        async () => {
            await terminalFixer.fixTerminalErrorInteractive();
        }
    );

    context.subscriptions.push(
        analyzeCurrentFileCmd,
        analyzeWorkspaceCmd,
        clearIssuesCmd,
        setApiKeyCmd,
        showGraphCmd,
        fixWithAICmd,
        refreshFileDiagnosticsCmd,
        openThemeStudioCmd,
        selectThemeCmd,
        resetThemeCmd,
        applyThemeFromStudioCmd,
        fixTerminalErrorCmd
    );

    // 7. Real-Time Document Change Listener with Immediate Fast Local Check (<5ms)
    const onDidChangeDocDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length === 0) {
            return;
        }
        if (isSupportedDocument(event.document)) {
            // Instantly re-verify local AST so fixed errors disappear immediately as the user types
            runFastLocalCheck(event.document);

            // Schedule debounced AI / multi-file analysis
            scheduleAnalysis(event.document, DEBOUNCE_DELAY_MS);
        }
    });
    context.subscriptions.push(onDidChangeDocDisposable);

    // 8. Auto-analyze on Save (Immediate)
    const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (isSupportedDocument(doc)) {
            await triggerImmediateAnalysis(doc, false);
        }
    });
    context.subscriptions.push(onSaveDisposable);

    // 9. Document Close Listener (Cleanup timers & temporary diagnostics)
    const onCloseDisposable = vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        const existingTimer = debounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
            debounceTimers.delete(key);
        }
        if (doc.isUntitled || doc.uri.scheme !== 'file') {
            diagnosticsManager.clearForFile(doc.uri);
        }
    });
    context.subscriptions.push(onCloseDisposable);

    // 10. Active Editor Change Listener (Immediately runs fast local check & updates status bar)
    const onActiveEditorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (!editor || !isSupportedDocument(editor.document)) {
            return;
        }

        // Always run fast local AST check immediately on editor focus / tab switch
        runFastLocalCheck(editor.document);

        const apiKey = await configManager.getApiKey();
        if (!apiKey) {
            statusBarItem.text = '$(key) CodeSense: Enter API Key (Required)';
            statusBarItem.tooltip = 'Click to enter your Gemini API Key (Compulsory to run CodeSense)';
            statusBarItem.command = 'codesense.setApiKey';
            return;
        }

        // Schedule analysis for the newly active editor
        scheduleAnalysis(editor.document, 1000);
    });
    context.subscriptions.push(onActiveEditorChangeDisposable);

    // 11. Document Open Listener (Runs instant local check whenever a file is opened)
    const onDidOpenDocDisposable = vscode.workspace.onDidOpenTextDocument((doc) => {
        if (isSupportedDocument(doc)) {
            runFastLocalCheck(doc);
        }
    });
    context.subscriptions.push(onDidOpenDocDisposable);
}

export function deactivate() {
    for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
    }
    debounceTimers.clear();

    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
