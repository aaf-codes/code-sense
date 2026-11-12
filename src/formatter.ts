import * as path from 'path';
import { CodeIssue } from './types';
import { ThemeManager } from './theme';

/**
 * Returns a friendly language identifier for code blocks.
 */
function resolveLanguage(fileName: string, languageId?: string): string {
    if (languageId && languageId !== 'plaintext') {
        return languageId;
    }
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
        case '.py':
            return 'python';
        case '.js':
        case '.mjs':
        case '.cjs':
            return 'javascript';
        case '.ts':
            return 'typescript';
        case '.jsx':
            return 'javascriptreact';
        case '.tsx':
            return 'typescriptreact';
        case '.java':
            return 'java';
        case '.html':
        case '.htm':
            return 'html';
        case '.css':
            return 'css';
        default:
            return 'text';
    }
}

/**
 * Derives a human-friendly error title if not explicitly provided.
 */
export function deriveFriendlyErrorName(issue: CodeIssue): string {
    if (issue.errorName) {
        return issue.errorName;
    }
    const lowerCause = (issue.cause || '').toLowerCase();
    if (lowerCause.includes('colon') || lowerCause.includes(':')) {
        return 'Missing Colon';
    }
    if (lowerCause.includes('zero') || lowerCause.includes('division')) {
        return 'Division by Zero';
    }
    if (lowerCause.includes('type') || lowerCause.includes('concatenate') || lowerCause.includes('subscriptable')) {
        return 'Type Error';
    }
    if (lowerCause.includes('not exported') || lowerCause.includes('never exported') || lowerCause.includes('cannot see or use')) {
        return 'Missing Function or Value';
    }
    if (lowerCause.includes('undefined') || lowerCause.includes('not defined')) {
        return 'Undefined Variable or Function';
    }
    if (lowerCause.includes('input') || lowerCause.includes('argument') || lowerCause.includes('parameter')) {
        return 'Missing Function Input';
    }
    if (lowerCause.includes('await') || lowerCause.includes('async')) {
        return 'Missing await Keyword';
    }
    if (lowerCause.includes('indent') || lowerCause.includes('tab')) {
        return 'Indentation Error';
    }
    return 'Code Issue';
}

/**
 * Generates the beginner-friendly markdown representation used in VS Code Hovers.
 * Styles error cards according to the active CodeSense theme with high contrast and readable text.
 */
export function formatBeginnerMarkdown(issue: CodeIssue, languageId?: string): string {
    const fileName = path.basename(issue.fileUri.fsPath);
    const lang = resolveLanguage(fileName, languageId);

    const errorName = deriveFriendlyErrorName(issue);
    const location = issue.locationText || `${fileName} – Line ${issue.line}`;
    const whatHappened = issue.whatHappened || issue.cause;
    const whyHappened = issue.whyHappened || issue.cause;
    const howToFix = issue.howToFix || issue.fix;
    const whyFixCorrect = issue.whyFixCorrect;
    const sideEffects = issue.sideEffects;
    const correctedCode = issue.correctedCode || issue.replacementCode;

    const theme = ThemeManager.getInstance().getTheme();
    const { colors } = theme;

    const errorIcon = colors.badgeEmoji.error;
    const successIcon = colors.badgeEmoji.success;
    const themeIcon = colors.badgeEmoji.themeIcon;

    let md = `### ${themeIcon} CodeSense`;
    if (theme.id !== 'default') {
        md += ` *(${theme.name})*`;
    }
    md += `\n\n`;

    md += `**${errorIcon} Error:** ${errorName}\n\n`;
    md += `**📍 Location:** \`${location}\`\n\n`;
    md += `**💡 What is wrong?**\n${whatHappened}\n\n`;
    md += `**🤔 Why did this happen?**\n${whyHappened}\n\n`;
    md += `**🔧 Correct solution:**\n${howToFix}\n\n`;

    if (whyFixCorrect && whyFixCorrect.trim().length > 0) {
        md += `**🎯 Why this solution is correct:**\n${whyFixCorrect}\n\n`;
    }

    if (sideEffects && sideEffects.trim().length > 0) {
        md += `**⚠️ Side Effects & Impact:**\n${sideEffects}\n\n`;
    }

    if (issue.relatedFile) {
        md += `🌐 **Connected File:** \`${issue.relatedFile}\`\n\n`;
    }

    if (correctedCode && correctedCode.trim().length > 0) {
        md += `**${successIcon} Corrected Code:**\n\`\`\`${lang}\n${correctedCode.trim()}\n\`\`\`\n`;
    }

    return md;
}

/**
 * Generates a clean plain-text formatted explanation for tooltips and Problems panel.
 */
export function formatBeginnerPlainText(issue: CodeIssue): string {
    const fileName = path.basename(issue.fileUri.fsPath);
    const errorName = deriveFriendlyErrorName(issue);
    const location = issue.locationText || `${fileName} – Line ${issue.line}`;
    const whatHappened = issue.whatHappened || issue.cause;
    const whyHappened = issue.whyHappened || issue.cause;
    const howToFix = issue.howToFix || issue.fix;
    const correctedCode = issue.correctedCode || issue.replacementCode;

    const theme = ThemeManager.getInstance().getTheme();
    const errorIcon = theme.colors.badgeEmoji.error;
    const successIcon = theme.colors.badgeEmoji.success;

    let text = `${errorIcon} Error: ${errorName}\n` +
               `📍 Location: ${location}\n\n` +
               `💡 What happened?\n${whatHappened}\n\n` +
               `🤔 Why did this happen?\n${whyHappened}\n\n` +
               `🔧 How to fix it?\n${howToFix}`;

    if (issue.relatedFile) {
        text += `\n\n🌐 Connected File: ${issue.relatedFile}`;
    }

    if (correctedCode && correctedCode.trim().length > 0) {
        text += `\n\n${successIcon} Corrected Code:\n${correctedCode.trim()}`;
    }

    return text;
}

/**
 * Generates the formatted message for VS Code Diagnostic squiggles and Problems table.
 */
export function formatBeginnerDiagnostic(issue: CodeIssue): string {
    const fileName = path.basename(issue.fileUri.fsPath);
    const errorName = deriveFriendlyErrorName(issue);
    const location = issue.locationText || `${fileName} – Line ${issue.line}`;
    const whatHappened = issue.whatHappened || issue.cause;
    const whyHappened = issue.whyHappened || issue.cause;
    const howToFix = issue.howToFix || issue.fix;
    const correctedCode = issue.correctedCode || issue.replacementCode;

    const theme = ThemeManager.getInstance().getTheme();
    const errorIcon = theme.colors.badgeEmoji.error;
    const successIcon = theme.colors.badgeEmoji.success;

    let text = `[CodeSense] ${errorIcon} Error: ${errorName}\n` +
               `📍 Location: ${location}\n\n` +
               `💡 What happened?\n${whatHappened}\n\n` +
               `🤔 Why did this happen?\n${whyHappened}\n\n` +
               `🔧 How to fix it?\n${howToFix}`;

    if (issue.relatedFile) {
        text += `\n\n🌐 Connected File: ${issue.relatedFile}`;
    }

    if (correctedCode && correctedCode.trim().length > 0) {
        text += `\n\n${successIcon} Corrected Code:\n${correctedCode.trim()}`;
    }

    return text;
}

