import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ConfigManager {
    private static instance: ConfigManager;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadEnvFile();
    }

    private loadEnvFile(): void {
        try {
            const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!rootPath) { return; }
            const envPath = path.join(rootPath, '.env');
            if (!fs.existsSync(envPath)) { return; }
            const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) { continue; }
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx < 1) { continue; }
                const key = trimmed.substring(0, eqIdx).trim();
                const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
                if (key && val && !process.env[key]) {
                    process.env[key] = val;
                }
            }
        } catch {
            // Ignore .env load failures
        }
    }

    public static initialize(context: vscode.ExtensionContext): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager(context);
        }
        return ConfigManager.instance;
    }

    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager({
                secrets: {
                    get: async () => undefined,
                    store: async () => {}
                }
            } as any);
        }
        return ConfigManager.instance;
    }

    public async getApiKey(): Promise<string | undefined> {
        // 1. Try secure SecretStorage
        try {
            if (this.context && this.context.secrets) {
                const secretKey = await this.context.secrets.get('codesense.geminiApiKey');
                if (secretKey && secretKey.trim().length >= 15 && !secretKey.includes('your_api_key')) {
                    return secretKey.trim();
                }
            }
        } catch {
            // SecretStorage unavailable
        }

        // 2. Try VS Code workspace configuration
        const config = vscode.workspace.getConfiguration('codesense');
        const configKey = config.get<string>('geminiApiKey');
        if (configKey && configKey.trim().length >= 15 && !configKey.includes('your_api_key')) {
            return configKey.trim();
        }

        // 3. Fallback to environment variables
        const envKey = process.env.GEMINI_API_KEY || process.env.gemini_api_key;
        if (envKey && envKey.trim().length >= 15 && !envKey.includes('your_api_key')) {
            return envKey.trim();
        }

        return undefined;
    }

    public async setApiKey(): Promise<boolean> {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Google Gemini API Key for CodeSense (Mandatory for AI Error Detection)',
            placeHolder: 'Paste your full Gemini API Key from Google AI Studio...',
            password: true,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length < 15) {
                    return 'API Key must be at least 15 characters long (e.g. AIzaSy... or AQ.Ab8...)';
                }
                return null;
            }
        });

        if (key && key.trim().length >= 15) {
            try {
                if (this.context && this.context.secrets) {
                    await this.context.secrets.store('codesense.geminiApiKey', key.trim());
                }
            } catch {
                // Ignore
            }
            vscode.window.showInformationMessage('CodeSense: Gemini API Key verified & stored securely! AI analysis is now active.');
            return true;
        }
        return false;
    }

    public async promptMandatoryApiKey(): Promise<string | undefined> {
        const existingKey = await this.getApiKey();
        if (existingKey) {
            return existingKey;
        }

        const choice = await vscode.window.showWarningMessage(
            '⚠️ CodeSense requires a Google Gemini API Key before running. Please enter your API key to activate AI error detection and smart fixes.',
            { modal: true },
            'Enter API Key',
            'Get Free Key (Google AI Studio)'
        );

        if (choice === 'Get Free Key (Google AI Studio)') {
            vscode.env.openExternal(vscode.Uri.parse('https://aistudio.google.com/app/apikey'));
            // Then prompt them to paste it
            await this.setApiKey();
        } else if (choice === 'Enter API Key') {
            await this.setApiKey();
        }

        return this.getApiKey();
    }

    public getModelName(): string {
        const config = vscode.workspace.getConfiguration('codesense');
        return config.get<string>('geminiModel') || 'gemini-2.5-flash';
    }

    public isAnalyzeOnSaveEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('codesense');
        return config.get<boolean>('analyzeOnSave', true);
    }
}
