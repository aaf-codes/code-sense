import * as vscode from 'vscode';

export interface CodeIssue {
    id: string;
    fileUri: vscode.Uri;
    line: number;           // 1-indexed
    endLine?: number;       // 1-indexed
    startChar: number;      // 0-indexed
    endChar: number;        // 0-indexed
    severity: vscode.DiagnosticSeverity;
    cause: string;          // Line 1: Why the error occurs (backward compatible)
    fix: string;            // Line 2: What is going to fix it (backward compatible)
    replacementCode?: string; // Proposed fix code snippet for QuickFix
    source: 'codesense-ast' | 'codesense-ai';
    relatedFile?: string;   // Relative path to cross-file trigger
    relatedSymbol?: string; // Function/class/variable name involved
    detailedExplanation?: string;

    // Comprehensive Explanatory Sections
    errorName?: string;       // 🔴 Error: Simple name in plain words
    locationText?: string;    // 📍 Location: Exact file name and line number
    whatHappened?: string;    // 💡 What happened? 1-2 simple sentences explaining what is wrong
    whyHappened?: string;     // 🤔 Why did this happen? Friendly beginner explanation
    howToFix?: string;        // 🔧 How to fix it? Clear, simple steps to solve the problem
    whyFixCorrect?: string;   // 🎯 Why is the proposed solution correct?
    sideEffects?: string;     // ⚠️ Which other functions/files could be affected & potential side effects?
    correctedCode?: string;   // ✅ Corrected Code: Snippet in code block

    // Resolved / Corrected Tracking for Project Error Map
    resolved?: boolean;       // True if this error was fixed/corrected
    resolvedAt?: number;      // Timestamp when the error was corrected
    resolvedHint?: string;    // Friendly hint showing how it was fixed
}

export interface SymbolExport {
    name: string;
    kind: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'default';
    line: number;
    params?: string[];
    isAsync?: boolean;
}

export interface SymbolImport {
    symbol: string;
    sourcePath: string; // resolved relative or absolute
    rawSource: string;  // e.g. './utils'
    line: number;
    isDefault?: boolean;
}

export interface FunctionCallInfo {
    name: string;
    line: number;
    argCount: number;
}

export interface FileGraphNode {
    filePath: string;
    fileName: string;
    exports: SymbolExport[];
    imports: SymbolImport[];
    calls: FunctionCallInfo[];
    updatedAt: number;
}

export interface DependencyEdge {
    fromFile: string;
    toFile: string;
    symbol: string;
    type: 'IMPORTS' | 'CALLS';
}

export interface WorkspaceGraph {
    nodes: Map<string, FileGraphNode>;
    edges: DependencyEdge[];
}
