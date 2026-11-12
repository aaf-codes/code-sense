import * as vscode from 'vscode';
import { ThemeManager, CodeSenseTheme } from './theme';

export class ThemeStudioViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codesense.themeStudioView';
    private _view?: vscode.WebviewView;

    constructor(private readonly extensionUri: vscode.Uri) {
        ThemeManager.getInstance().onThemeChanged(() => {
            this.updateHtml();
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        this.updateHtml();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            const themeManager = ThemeManager.getInstance();
            switch (message.command) {
                case 'applyTheme':
                    await themeManager.setTheme(message.themeId);
                    const applied = themeManager.getTheme();
                    vscode.window.showInformationMessage(
                        `CodeSense Theme Applied: ${applied.name} ${applied.colors.badgeEmoji.themeIcon}`
                    );
                    break;
                case 'resetTheme':
                    await themeManager.resetToDefault();
                    vscode.window.showInformationMessage('CodeSense: Reset to Default Theme.');
                    break;
            }
        });
    }

    public refresh(): void {
        this.updateHtml();
    }

    private updateHtml(): void {
        if (!this._view) {
            return;
        }
        this._view.webview.html = this.getHtmlForWebview(this._view.webview);
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const themeManager = ThemeManager.getInstance();
        const activeTheme = themeManager.getTheme();
        const activeId = themeManager.getActiveThemeId();
        const allThemes = themeManager.getAllThemes();

        // Filter out default from main 4 card grid, show it as Reset button at bottom
        const previewThemes = allThemes.filter(t => t.id !== 'default');

        const cardsHtml = previewThemes.map(t => {
            const isActive = t.id === activeId;
            const swatches = t.previewSwatches.map(hex => 
                `<span class="swatch-dot" style="background-color: ${hex};" title="${hex}"></span>`
            ).join('');

            return `
            <div class="theme-card ${isActive ? 'active' : ''}" style="border-left-color: ${t.colors.primary};">
                <div class="card-header">
                    <div class="theme-title-wrap">
                        <span class="theme-icon">${t.colors.badgeEmoji.themeIcon}</span>
                        <div>
                            <div class="theme-name">${t.name}</div>
                            <div class="theme-tagline">${t.tagline}</div>
                        </div>
                    </div>
                    ${isActive ? '<span class="active-badge">✓ ACTIVE</span>' : ''}
                </div>

                <!-- Swatches -->
                <div class="swatches-container">
                    ${swatches}
                </div>

                <!-- Mini Preview Box -->
                <div class="preview-mini-box" style="background-color: ${t.colors.background}; border: 1px solid ${t.colors.border}; color: ${t.colors.text};">
                    <div class="preview-header" style="color: ${t.colors.primary};">
                        <span>${t.colors.badgeEmoji.error} Error Detected</span>
                    </div>
                    <div class="preview-body" style="background-color: ${t.colors.surface}; border-left: 3px solid ${t.colors.errorBadge};">
                        <span style="color: ${t.colors.textMuted}; font-size: 11px;">Missing Colon</span>
                        <div style="font-family: monospace; font-size: 11px; color: ${t.colors.text}; margin-top: 2px;">
                            def main()<b>:</b>
                        </div>
                    </div>
                </div>

                <!-- Action Button -->
                <div class="card-action">
                    ${isActive 
                        ? `<button class="btn-applied" disabled style="background-color: ${t.colors.primary}; color: ${t.colors.buttonText};">✓ Currently Active</button>`
                        : `<button class="btn-apply" onclick="applyTheme('${t.id}')" style="border: 1px solid ${t.colors.primary}; color: ${t.colors.primary};">Apply Theme</button>`
                    }
                </div>
            </div>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CodeSense Theme Studio</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground, #CCCCCC);
            background-color: transparent;
            padding: 12px;
            user-select: none;
        }

        .studio-header {
            margin-bottom: 14px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-sideBar-border, rgba(255,255,255,0.1));
        }

        .studio-header h3 {
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            color: var(--vscode-sideBarTitle-foreground, #FFFFFF);
        }

        .studio-header p {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #888888);
            margin-top: 4px;
            line-height: 1.4;
        }

        .theme-card {
            background: var(--vscode-editor-background, rgba(255,255,255,0.03));
            border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
            border-left-width: 4px;
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 12px;
            transition: all 0.2s ease;
        }

        .theme-card:hover {
            border-color: var(--vscode-focusBorder, #007ACC);
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        }

        .theme-card.active {
            border-color: var(--vscode-focusBorder, #007ACC);
            background: rgba(255,255,255,0.06);
            box-shadow: 0 0 10px rgba(0, 122, 204, 0.25);
        }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 8px;
        }

        .theme-title-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .theme-icon {
            font-size: 18px;
        }

        .theme-name {
            font-weight: 600;
            font-size: 13px;
            color: var(--vscode-foreground, #FFFFFF);
        }

        .theme-tagline {
            font-size: 10px;
            color: var(--vscode-descriptionForeground, #888888);
        }

        .active-badge {
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.5px;
            padding: 2px 6px;
            border-radius: 10px;
            background-color: var(--vscode-badge-background, #007ACC);
            color: var(--vscode-badge-foreground, #FFFFFF);
        }

        .swatches-container {
            display: flex;
            gap: 6px;
            margin-bottom: 8px;
        }

        .swatch-dot {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 1px solid rgba(255,255,255,0.2);
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            display: inline-block;
        }

        .preview-mini-box {
            border-radius: 4px;
            padding: 8px;
            margin-bottom: 8px;
            font-size: 11px;
        }

        .preview-header {
            font-weight: 600;
            font-size: 11px;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .preview-body {
            border-radius: 2px;
            padding: 4px 6px;
        }

        .card-action {
            margin-top: 4px;
        }

        .btn-apply {
            width: 100%;
            padding: 5px 10px;
            background: transparent;
            font-size: 11px;
            font-weight: 600;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .btn-apply:hover {
            opacity: 0.85;
            background: rgba(255,255,255,0.08);
            transform: translateY(-1px);
        }

        .btn-applied {
            width: 100%;
            padding: 5px 10px;
            font-size: 11px;
            font-weight: 600;
            border-radius: 4px;
            border: none;
            opacity: 0.95;
            cursor: default;
        }

        .footer-section {
            margin-top: 16px;
            padding-top: 10px;
            border-top: 1px solid var(--vscode-sideBar-border, rgba(255,255,255,0.1));
            text-align: center;
        }

        .btn-reset {
            width: 100%;
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground, #3A3D41);
            color: var(--vscode-button-secondaryForeground, #FFFFFF);
            border: 1px solid var(--vscode-widget-border, transparent);
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
            font-weight: 500;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: background 0.15s;
        }

        .btn-reset:hover {
            background: var(--vscode-button-secondaryHoverBackground, #45494E);
        }

        .active-status-bar {
            margin-top: 8px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground, #888888);
        }
    </style>
</head>
<body>
    <div class="studio-header">
        <h3>🎨 Theme Studio</h3>
        <p>Switch CodeSense visual theme across error cards, error map, and AI diff tools.</p>
    </div>

    <!-- Theme Cards List -->
    <div id="themes-list">
        ${cardsHtml}
    </div>

    <!-- Footer: Reset to Default -->
    <div class="footer-section">
        <button class="btn-reset" onclick="resetTheme()">
            ↺ Reset to Default Theme
        </button>
        <div class="active-status-bar">
            Current Theme: <b>${activeTheme.name}</b> ${activeTheme.colors.badgeEmoji.themeIcon}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function applyTheme(themeId) {
            vscode.postMessage({
                command: 'applyTheme',
                themeId: themeId
            });
        }

        function resetTheme() {
            vscode.postMessage({
                command: 'resetTheme'
            });
        }
    </script>
</body>
</html>`;
    }
}
