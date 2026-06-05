import * as vscode from 'vscode';
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import * as neo4j from 'neo4j-driver';
import process from 'process';

const genAI = new GoogleGenerativeAI(process.env.gemini_api_key); // use environment variable or fallback to hardcoded key (not recommended)

// 2. Neo4j Configuration
const URI = 'bolt+s://7fb9c957.databases.neo4j.io'; 
const USER = 'neo4j';
const PASSWORD = 'tZlKL1BfAbZS2eIBqHIDu-wLPGNNeTPpYXpg3dTEQMQ'; 

const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('ai-code-analyzer.helloWorld', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const text = editor.document.getText();
        
        try {
            vscode.window.showInformationMessage('Analyzing your code...');
            
            // The modern, required Gemini request structure
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent({
                contents: [{ 
                    role: "user", 
                    parts: [{ text: `Analyze this code and provide feedback: ${text}` }] 
                }]
            });
            
            const analysis = result.response.text();
            
            const doc = await vscode.workspace.openTextDocument({
                content: analysis,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            // Check the Debug Console for the REAL error details
            console.error("DETAILED AI ERROR:", error);
            vscode.window.showErrorMessage('Error: Check Debug Console for details.');
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { driver.close(); }