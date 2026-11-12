import * as vscode from 'vscode';
import { ThemeManager, THEMES } from './theme';

export class ThemeTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly themeId: string,
        public readonly isActive: boolean
    ) {
        super(label, collapsibleState);
        this.description = description;

        if (isActive) {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        } else if (themeId === 'default') {
            this.iconPath = new vscode.ThemeIcon('discard');
        } else {
            this.iconPath = new vscode.ThemeIcon('color-mode', new vscode.ThemeColor('symbolIcon.colorForeground'));
        }

        this.contextValue = 'codesenseThemeItem';
    }
}

export class ThemeStudioTreeProvider implements vscode.TreeDataProvider<ThemeTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ThemeTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor() {
        ThemeManager.getInstance().onThemeChanged(() => {
            this.refresh();
        });
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public getTreeItem(element: ThemeTreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(): Promise<ThemeTreeItem[]> {
        const themeManager = ThemeManager.getInstance();
        const activeId = themeManager.getActiveThemeId();

        const themeList = [
            THEMES['solar-flare'],
            THEMES['neon-tokyo'],
            THEMES['crimson-night'],
            THEMES['latte-cream']
        ];

        const items: ThemeTreeItem[] = [];

        for (const t of themeList) {
            const isActive = t.id === activeId;
            const item = new ThemeTreeItem(
                `${t.colors.badgeEmoji.themeIcon} ${t.name}`,
                isActive ? '✓ ACTIVE' : t.tagline,
                vscode.TreeItemCollapsibleState.None,
                t.id,
                isActive
            );

            item.command = {
                command: 'codesense.applyThemeFromStudio',
                title: 'Apply Theme',
                arguments: [t.id]
            };

            const mdTooltip = new vscode.MarkdownString();
            mdTooltip.appendMarkdown(`### ${t.colors.badgeEmoji.themeIcon} ${t.name} ${isActive ? '*(Currently Active)*' : ''}\n\n`);
            mdTooltip.appendMarkdown(`**Colors:** ${t.tagline}\n\n`);
            mdTooltip.appendMarkdown(`- **Primary Accent:** \`${t.colors.primary}\`\n`);
            mdTooltip.appendMarkdown(`- **Secondary Accent:** \`${t.colors.secondary}\`\n`);
            mdTooltip.appendMarkdown(`- **Error Badge:** \`${t.colors.errorBadge}\` (${t.colors.badgeEmoji.error})\n`);
            mdTooltip.appendMarkdown(`- **Success Badge:** \`${t.colors.successBadge}\` (${t.colors.badgeEmoji.success})\n\n`);
            mdTooltip.appendMarkdown(`*Click to apply ${t.name} to CodeSense instantly.*`);
            item.tooltip = mdTooltip;

            items.push(item);
        }

        // Reset to Default option
        const isDefault = activeId === 'default';
        const resetItem = new ThemeTreeItem(
            '↺ Reset to Default',
            isDefault ? '✓ ACTIVE' : 'Standard native VS Code theme',
            vscode.TreeItemCollapsibleState.None,
            'default',
            isDefault
        );
        resetItem.command = {
            command: 'codesense.resetTheme',
            title: 'Reset Theme to Default'
        };
        items.push(resetItem);

        return Promise.resolve(items);
    }
}

