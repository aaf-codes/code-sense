import * as assert from 'assert';
import * as vscode from 'vscode';
import { CodebaseGraphManager } from '../graph';

suite('CodeSense Test Suite', () => {
    vscode.window.showInformationMessage('Starting CodeSense tests.');

    test('GraphManager parses JavaScript exports and imports correctly', () => {
        const manager = new CodebaseGraphManager();
        const codeA = `
            export function calculateDiscount(price, rate) {
                return price * rate;
            }
            export const tax = 0.05;
        `;
        const codeB = `
            import { calculateDiscount } from './mathUtils';
            const res = calculateDiscount(100);
        `;

        const nodeA = (manager as any).parseJavaScriptAST('mathUtils.js', 'mathUtils.js', codeA);
        const nodeB = (manager as any).parseJavaScriptAST('checkout.js', 'checkout.js', codeB);

        assert.strictEqual(nodeA.exports.length, 2);
        assert.strictEqual(nodeA.exports[0].name, 'calculateDiscount');
        assert.deepStrictEqual(nodeA.exports[0].params, ['price', 'rate']);

        assert.strictEqual(nodeB.imports.length, 1);
        assert.strictEqual(nodeB.imports[0].symbol, 'calculateDiscount');
        assert.strictEqual(nodeB.calls.length, 1);
        assert.strictEqual(nodeB.calls[0].argCount, 1);
    });

    test('GraphManager parses Python function and class definitions correctly', () => {
        const manager = new CodebaseGraphManager();
        const pyCode = `
import math
from utils import format_currency

def calculate_tax(amount, rate):
    return amount * rate

class InvoiceService:
    def process(self, order_id):
        pass
        `;

        const pyNode = (manager as any).parsePythonSymbols('main.py', 'main.py', pyCode);
        assert.strictEqual(pyNode.exports.length, 2);
        assert.strictEqual(pyNode.exports[0].name, 'calculate_tax');
        assert.deepStrictEqual(pyNode.exports[0].params, ['amount', 'rate']);
        assert.strictEqual(pyNode.exports[1].name, 'InvoiceService');
        assert.strictEqual(pyNode.imports.length, 2);
    });
});
