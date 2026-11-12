import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import { WorkspaceGraph, FileGraphNode, SymbolExport, SymbolImport, FunctionCallInfo, DependencyEdge } from './types';

// Support both ESM and CJS bundle exports for @babel/traverse
const traverse: typeof traverseModule = (traverseModule as any).default || traverseModule;

export class CodebaseGraphManager {
    private graph: WorkspaceGraph = {
        nodes: new Map<string, FileGraphNode>(),
        edges: []
    };

    public getGraph(): WorkspaceGraph {
        return this.graph;
    }

    /**
     * Index all code files in the current workspace
     */
    public async buildWorkspaceGraph(): Promise<void> {
        this.graph.nodes.clear();
        this.graph.edges = [];

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const files = await vscode.workspace.findFiles(
            '**/*.{js,jsx,ts,tsx,py,java,html,htm,css}',
            '**/node_modules/**'
        );

        for (const fileUri of files) {
            await this.indexFile(fileUri);
        }

        this.resolveEdges();
    }

    /**
     * Parse and index a live TextDocument into the knowledge graph
     */
    public async indexDocument(document: vscode.TextDocument): Promise<void> {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const relPath = path.relative(rootPath, document.fileName).replace(/\\/g, '/');
        const content = document.getText();
        const ext = path.extname(document.fileName).toLowerCase();

        let node: FileGraphNode;
        if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
            node = this.parseJavaScriptAST(document.fileName, relPath, content);
        } else if (ext === '.py') {
            node = this.parsePythonSymbols(document.fileName, relPath, content);
        } else if (ext === '.java') {
            node = this.parseJavaSymbols(document.fileName, relPath, content);
        } else {
            node = {
                filePath: relPath,
                fileName: path.basename(relPath),
                exports: [],
                imports: [],
                calls: [],
                updatedAt: Date.now()
            };
        }

        this.graph.nodes.set(relPath, node);
        this.resolveEdges();
    }

    /**
     * Parse and index a single file into the knowledge graph
     */
    public async indexFile(fileUri: vscode.Uri): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            await this.indexDocument(document);
        } catch {
            // Tolerate unparseable files
        }
    }

    private parseJavaScriptAST(fullPath: string, relPath: string, code: string): FileGraphNode {
        const exports: SymbolExport[] = [];
        const imports: SymbolImport[] = [];
        const calls: FunctionCallInfo[] = [];

        try {
            const ast = parser.parse(code, {
                sourceType: 'unambiguous',
                plugins: [
                    'typescript',
                    'jsx',
                    'decorators-legacy',
                    'classProperties',
                    'asyncGenerators',
                    'dynamicImport',
                    'objectRestSpread'
                ],
                errorRecovery: true
            });

            traverse(ast, {
                // Track imports
                ImportDeclaration(p: any) {
                    const rawSource = p.node.source.value;
                    const line = p.node.loc?.start.line || 1;

                    for (const specifier of p.node.specifiers) {
                        if (specifier.type === 'ImportSpecifier') {
                            imports.push({
                                symbol: specifier.local.name,
                                rawSource,
                                sourcePath: rawSource,
                                line,
                                isDefault: false
                            });
                        } else if (specifier.type === 'ImportDefaultSpecifier') {
                            imports.push({
                                symbol: specifier.local.name,
                                rawSource,
                                sourcePath: rawSource,
                                line,
                                isDefault: true
                            });
                        }
                    }
                },

                // Track function calls
                CallExpression(p: any) {
                    const callee = p.node.callee;
                    const line = p.node.loc?.start.line || 1;
                    const argCount = p.node.arguments.length;

                    if (callee.type === 'Identifier') {
                        calls.push({
                            name: callee.name,
                            line,
                            argCount
                        });
                    } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
                        calls.push({
                            name: callee.property.name,
                            line,
                            argCount
                        });
                    }
                },

                // Track named exports
                ExportNamedDeclaration(p: any) {
                    const line = p.node.loc?.start.line || 1;
                    if (p.node.declaration) {
                        const decl = p.node.declaration;
                        if (decl.type === 'FunctionDeclaration' && decl.id) {
                            const params = decl.params.map((param: any) => param.name || (param.left?.name) || 'arg');
                            exports.push({
                                name: decl.id.name,
                                kind: 'function',
                                line,
                                params,
                                isAsync: decl.async
                            });
                        } else if (decl.type === 'VariableDeclaration') {
                            for (const vDecl of decl.declarations) {
                                if (vDecl.id.type === 'Identifier') {
                                    let params: string[] | undefined;
                                    let isAsync = false;
                                    if (vDecl.init && (vDecl.init.type === 'ArrowFunctionExpression' || vDecl.init.type === 'FunctionExpression')) {
                                        params = vDecl.init.params.map((pr: any) => pr.name || (pr.left?.name) || 'arg');
                                        isAsync = vDecl.init.async;
                                    }
                                    exports.push({
                                        name: vDecl.id.name,
                                        kind: params ? 'function' : 'variable',
                                        line,
                                        params,
                                        isAsync
                                    });
                                }
                            }
                        } else if (decl.type === 'ClassDeclaration' && decl.id) {
                            exports.push({
                                name: decl.id.name,
                                kind: 'class',
                                line
                            });
                        }
                    }
                },

                // Track default export
                ExportDefaultDeclaration(p: any) {
                    const line = p.node.loc?.start.line || 1;
                    const decl = p.node.declaration;
                    let name = 'default';
                    if (decl.id && decl.id.name) {
                        name = decl.id.name;
                    }
                    exports.push({
                        name,
                        kind: 'default',
                        line
                    });
                }
            });
        } catch {
            // Graceful AST fallback
        }

        return {
            filePath: relPath,
            fileName: path.basename(relPath),
            exports,
            imports,
            calls,
            updatedAt: Date.now()
        };
    }

    private parsePythonSymbols(fullPath: string, relPath: string, code: string): FileGraphNode {
        const exports: SymbolExport[] = [];
        const imports: SymbolImport[] = [];
        const calls: FunctionCallInfo[] = [];

        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // def function_name(a, b):
            const defMatch = line.match(/^def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
            if (defMatch) {
                const params = defMatch[2].split(',').map(s => s.trim()).filter(s => s.length > 0 && s !== 'self');
                exports.push({
                    name: defMatch[1],
                    kind: 'function',
                    line: lineNum,
                    params
                });
            }

            // class ClassName:
            const classMatch = line.match(/^class\s+([a-zA-Z0-9_]+)/);
            if (classMatch) {
                exports.push({
                    name: classMatch[1],
                    kind: 'class',
                    line: lineNum
                });
            }

            // from module import symbol
            const fromImportMatch = line.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+([a-zA-Z0-9_,\s*]+)/);
            if (fromImportMatch) {
                const rawSource = fromImportMatch[1];
                const importedSymbols = fromImportMatch[2].split(',').map(s => s.trim()).filter(s => s.length > 0);
                for (const sym of importedSymbols) {
                    imports.push({
                        symbol: sym,
                        rawSource,
                        sourcePath: rawSource,
                        line: lineNum
                    });
                }
            }

            // import module
            const importMatch = line.match(/^import\s+([a-zA-Z0-9_]+)/);
            if (importMatch && !line.includes('from')) {
                imports.push({
                    symbol: importMatch[1],
                    rawSource: importMatch[1],
                    sourcePath: importMatch[1],
                    line: lineNum
                });
            }

            // Function calls like calculate_tax(100) or get_student("Alice")
            if (!line.trim().startsWith('#')) {
                const callRegex = /\b([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
                let match: RegExpExecArray | null;
                while ((match = callRegex.exec(line)) !== null) {
                    const calleeName = match[1];
                    const reserved = ['def', 'class', 'if', 'elif', 'while', 'for', 'return', 'import', 'from', 'with', 'print', 'except', 'lambda'];
                    if (!reserved.includes(calleeName)) {
                        const rawArgs = match[2].trim();
                        const argCount = rawArgs.length === 0 ? 0 : rawArgs.split(',').length;
                        calls.push({
                            name: calleeName,
                            line: lineNum,
                            argCount
                        });
                    }
                }
            }
        }

        return {
            filePath: relPath,
            fileName: path.basename(relPath),
            exports,
            imports,
            calls,
            updatedAt: Date.now()
        };
    }

    private parseJavaSymbols(fullPath: string, relPath: string, code: string): FileGraphNode {
        const exports: SymbolExport[] = [];
        const imports: SymbolImport[] = [];
        const calls: FunctionCallInfo[] = [];

        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            const trimmed = line.trim();

            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                continue;
            }

            // class/interface/enum: public class UserManagement
            const classMatch = line.match(/\b(?:class|interface|enum)\s+([a-zA-Z0-9_]+)/);
            if (classMatch) {
                exports.push({
                    name: classMatch[1],
                    kind: 'class',
                    line: lineNum
                });
            }

            // Methods: public static void main(String[] args) or int calculateScore(int a)
            const methodMatch = line.match(/\b(?:public|protected|private|static|\s)+[\w<>[\],\s]+\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:throws\s+[\w,\s]+)?\s*\{?/);
            if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
                const rawParams = methodMatch[2].trim();
                const params = rawParams.length === 0 ? [] : rawParams.split(',').map(p => p.trim().split(/\s+/).pop() || 'arg');
                exports.push({
                    name: methodMatch[1],
                    kind: 'function',
                    line: lineNum,
                    params
                });
            }

            // import java.util.List; or import com.app.Service;
            const importMatch = line.match(/^import\s+(?:static\s+)?([a-zA-Z0-9_.*]+);/);
            if (importMatch) {
                const fullImport = importMatch[1];
                const sym = fullImport.split('.').pop() || fullImport;
                imports.push({
                    symbol: sym,
                    rawSource: fullImport,
                    sourcePath: fullImport,
                    line: lineNum
                });
            }

            // Function calls: obj.method() or method()
            const callRegex = /\b([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
            let match: RegExpExecArray | null;
            while ((match = callRegex.exec(line)) !== null) {
                const callee = match[1];
                const reserved = ['if', 'for', 'while', 'switch', 'catch', 'super', 'this', 'return', 'throw', 'new', 'synchronized'];
                if (!reserved.includes(callee)) {
                    const rawArgs = match[2].trim();
                    const argCount = rawArgs.length === 0 ? 0 : rawArgs.split(',').length;
                    calls.push({
                        name: callee,
                        line: lineNum,
                        argCount
                    });
                }
            }
        }

        return {
            filePath: relPath,
            fileName: path.basename(relPath),
            exports,
            imports,
            calls,
            updatedAt: Date.now()
        };
    }

    private resolveEdges(): void {
        this.graph.edges = [];
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

        for (const [relPath, node] of this.graph.nodes.entries()) {
            const fileDir = path.dirname(path.join(rootPath, relPath));

            for (const imp of node.imports) {
                // If it's a relative import like ./utils or ../helpers, or same-directory module in Python
                const isExplicitRelative = imp.rawSource.startsWith('.');
                const candidateSource = isExplicitRelative ? imp.rawSource : `./${imp.rawSource}`;
                const resolvedTarget = this.resolveRelativeFilePath(fileDir, isExplicitRelative ? imp.rawSource : candidateSource, rootPath);
                if (resolvedTarget) {
                    this.graph.edges.push({
                        fromFile: relPath,
                        toFile: resolvedTarget,
                        symbol: imp.symbol,
                        type: 'IMPORTS'
                    });
                }
            }
        }
    }

    private resolveRelativeFilePath(dir: string, rawSource: string, rootPath: string): string | undefined {
        const potentialExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js', '.py', '.java', '.html', '.css'];
        for (const ext of potentialExtensions) {
            const candidate = path.resolve(dir, rawSource + ext);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return path.relative(rootPath, candidate).replace(/\\/g, '/');
            }
        }
        return undefined;
    }

    /**
     * Retrieve cross-file context summary for LLM prompt or diagnosis
     */
    public getCrossFileContext(relPath: string): string {
        const node = this.graph.nodes.get(relPath);
        if (!node) {
            return 'No multi-file graph available for this file.';
        }

        const lines: string[] = [];
        lines.push(`--- Cross-File Dependencies for ${relPath} ---`);

        // 1. Files this file imports from
        const importedEdges = this.graph.edges.filter(e => e.fromFile === relPath);
        if (importedEdges.length > 0) {
            lines.push('Direct Imported Dependencies:');
            for (const edge of importedEdges) {
                const targetNode = this.graph.nodes.get(edge.toFile);
                if (targetNode) {
                    const matchedExport = targetNode.exports.find(exp => exp.name === edge.symbol);
                    if (matchedExport) {
                        const paramsDesc = matchedExport.params ? `(${matchedExport.params.join(', ')})` : '';
                        lines.push(`  • Imports '${edge.symbol}' from '${edge.toFile}' -> Defined as: ${matchedExport.kind} ${matchedExport.name}${paramsDesc} at line ${matchedExport.line}`);
                    } else {
                        lines.push(`  • WARNING: Imports '${edge.symbol}' from '${edge.toFile}', but '${edge.toFile}' does NOT export this symbol!`);
                    }
                }
            }
        }

        // 2. Files that depend on this file
        const dependentEdges = this.graph.edges.filter(e => e.toFile === relPath);
        if (dependentEdges.length > 0) {
            lines.push('Files Depending On This File:');
            for (const edge of dependentEdges) {
                lines.push(`  • '${edge.fromFile}' imports '${edge.symbol}' from this file`);
            }
        }

        return lines.join('\n');
    }
}
