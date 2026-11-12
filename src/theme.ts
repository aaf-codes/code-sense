import * as vscode from 'vscode';

export interface CodeSenseTheme {
    id: string;
    name: string;
    tagline: string;
    type: 'dark' | 'light';
    colors: {
        primary: string;           // Main accent / header
        secondary: string;         // Secondary accent / links / subtitle
        background: string;        // Card & panel background
        surface: string;           // Container surface
        border: string;            // Border highlight
        text: string;              // High contrast readable text
        textMuted: string;         // Secondary text
        errorBadge: string;        // Error highlight
        warningBadge: string;      // Warning highlight
        successBadge: string;      // Corrected / Success highlight
        buttonBackground: string;  // Button fill
        buttonText: string;        // Button label
        badgeEmoji: {
            error: string;
            warning: string;
            success: string;
            themeIcon: string;
        };
    };
    previewSwatches: string[];
}

export const THEMES: Record<string, CodeSenseTheme> = {
    'solar-flare': {
        id: 'solar-flare',
        name: 'Solar Flare',
        tagline: 'Sunset orange, violet & warm dark',
        type: 'dark',
        colors: {
            primary: '#FF6B35',
            secondary: '#9D4EDD',
            background: '#16101E',
            surface: '#241830',
            border: '#FF6B35',
            text: '#FDF0ED',
            textMuted: '#D4B8D1',
            errorBadge: '#FF4D6D',
            warningBadge: '#FF9E00',
            successBadge: '#38B000',
            buttonBackground: '#FF6B35',
            buttonText: '#FFFFFF',
            badgeEmoji: {
                error: '💥',
                warning: '🟠',
                success: '✨',
                themeIcon: '☀️'
            }
        },
        previewSwatches: ['#FF6B35', '#9D4EDD', '#F72585', '#241830', '#16101E']
    },
    'neon-tokyo': {
        id: 'neon-tokyo',
        name: 'Neon Tokyo',
        tagline: 'Neon pink, electric cyan & deep black',
        type: 'dark',
        colors: {
            primary: '#00F0FF',
            secondary: '#FF007F',
            background: '#090912',
            surface: '#121224',
            border: '#00F0FF',
            text: '#F0F6FC',
            textMuted: '#8B949E',
            errorBadge: '#FF007F',
            warningBadge: '#FFE600',
            successBadge: '#00F0FF',
            buttonBackground: '#00F0FF',
            buttonText: '#090912',
            badgeEmoji: {
                error: '⚡',
                warning: '🟡',
                success: '💠',
                themeIcon: '🏙️'
            }
        },
        previewSwatches: ['#00F0FF', '#FF007F', '#7928CA', '#121224', '#090912']
    },
    'crimson-night': {
        id: 'crimson-night',
        name: 'Crimson Night',
        tagline: 'Burgundy, wine red, rose & charcoal',
        type: 'dark',
        colors: {
            primary: '#FF4D6D',
            secondary: '#8B0000',
            background: '#141012',
            surface: '#24171D',
            border: '#8B0000',
            text: '#F8EDEB',
            textMuted: '#C9ADA7',
            errorBadge: '#FF4D6D',
            warningBadge: '#E07A5F',
            successBadge: '#52B788',
            buttonBackground: '#8B0000',
            buttonText: '#FFFFFF',
            badgeEmoji: {
                error: '🩸',
                warning: '🍷',
                success: '🌹',
                themeIcon: '🌙'
            }
        },
        previewSwatches: ['#FF4D6D', '#8B0000', '#5B0E1D', '#24171D', '#141012']
    },
    'latte-cream': {
        id: 'latte-cream',
        name: 'Latte Cream',
        tagline: 'Warm cream, coffee brown & soft beige',
        type: 'light',
        colors: {
            primary: '#4A2E1B',
            secondary: '#8C5A3C',
            background: '#FAF3E0',
            surface: '#EFE5D3',
            border: '#CDB599',
            text: '#2B1810',
            textMuted: '#6F4E37',
            errorBadge: '#B22222',
            warningBadge: '#C86400',
            successBadge: '#2D6A4F',
            buttonBackground: '#4A2E1B',
            buttonText: '#FAF3E0',
            badgeEmoji: {
                error: '☕',
                warning: '🥐',
                success: '🌱',
                themeIcon: '🧁'
            }
        },
        previewSwatches: ['#4A2E1B', '#8C5A3C', '#CDB599', '#EFE5D3', '#FAF3E0']
    },
    'default': {
        id: 'default',
        name: 'Default (Native)',
        tagline: 'Clean native VS Code theme',
        type: 'dark',
        colors: {
            primary: '#3794FF',
            secondary: '#007ACC',
            background: '#1E1E1E',
            surface: '#252526',
            border: '#3C3C3C',
            text: '#CCCCCC',
            textMuted: '#858585',
            errorBadge: '#F14C4C',
            warningBadge: '#CCA700',
            successBadge: '#73C991',
            buttonBackground: '#0E639C',
            buttonText: '#FFFFFF',
            badgeEmoji: {
                error: '🔴',
                warning: '🟠',
                success: '✅',
                themeIcon: '⚡'
            }
        },
        previewSwatches: ['#3794FF', '#007ACC', '#F14C4C', '#252526', '#1E1E1E']
    }
};

export class ThemeManager {
    private static instance: ThemeManager;
    private context: vscode.ExtensionContext;
    private activeThemeId: string = 'default';

    private _onThemeChanged = new vscode.EventEmitter<CodeSenseTheme>();
    public readonly onThemeChanged = this._onThemeChanged.event;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadPersistedTheme();
    }

    public static initialize(context: vscode.ExtensionContext): ThemeManager {
        if (!ThemeManager.instance) {
            ThemeManager.instance = new ThemeManager(context);
        }
        return ThemeManager.instance;
    }

    public static getInstance(): ThemeManager {
        if (!ThemeManager.instance) {
            ThemeManager.instance = new ThemeManager({
                globalState: {
                    get: () => 'default',
                    update: async () => {}
                }
            } as any);
        }
        return ThemeManager.instance;
    }

    private loadPersistedTheme(): void {
        const stored = this.context.globalState.get<string>('codesense.activeTheme');
        const configTheme = vscode.workspace.getConfiguration('codesense').get<string>('theme');
        const candidate = stored || configTheme || 'default';

        if (THEMES[candidate]) {
            this.activeThemeId = candidate;
        } else {
            this.activeThemeId = 'default';
        }
    }

    public getTheme(): CodeSenseTheme {
        return THEMES[this.activeThemeId] || THEMES['default'];
    }

    public getActiveThemeId(): string {
        return this.activeThemeId;
    }

    public getAllThemes(): CodeSenseTheme[] {
        // Return exactly the 4 user-requested themes in order, plus default
        return [
            THEMES['solar-flare'],
            THEMES['neon-tokyo'],
            THEMES['crimson-night'],
            THEMES['latte-cream'],
            THEMES['default']
        ];
    }

    public async setTheme(themeId: string): Promise<void> {
        if (!THEMES[themeId]) {
            themeId = 'default';
        }

        this.activeThemeId = themeId;
        await this.context.globalState.update('codesense.activeTheme', themeId);

        try {
            await vscode.workspace.getConfiguration('codesense').update('theme', themeId, vscode.ConfigurationTarget.Global);
        } catch {
            // Ignore config update failures if in restricted workspace
        }

        const newTheme = this.getTheme();
        this._onThemeChanged.fire(newTheme);
    }

    public async resetToDefault(): Promise<void> {
        await this.setTheme('default');
    }
}
