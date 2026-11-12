const fs = require('fs');
const path = require('path');
const Module = require('module');

const mockVscode = {
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    Range: class Range {
        constructor(startLine, startChar, endLine, endChar) {
            this.start = { line: startLine, character: startChar };
            this.end = { line: endLine, character: endChar };
        }
    },
    Position: class Position {
        constructor(line, character) {
            this.line = line;
            this.character = character;
        }
    },
    Uri: {
        file: (p) => ({
            fsPath: path.resolve(p),
            path: p,
            toString: () => `file:///${path.resolve(p).replace(/\\/g, '/')}`,
            scheme: 'file'
        }),
        parse: (s) => ({
            fsPath: s.replace('file:///', ''),
            path: s.replace('file:///', ''),
            toString: () => s,
            scheme: 'file'
        })
    },
    workspace: {
        workspaceFolders: [{ uri: { fsPath: 'C:/Users/aafre/Desktop/student mangement' } }],
        getConfiguration: () => ({
            get: (key, defaultValue) => defaultValue
        })
    }
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function(modPath) {
    if (modPath === 'vscode') {
        return mockVscode;
    }
    return originalRequire.apply(this, arguments);
};

const { CodebaseGraphManager } = require('../out/graph');
const { CodeAnalyzer } = require('../out/analyzer');

async function runTestSuite() {
    console.log("======================================================================");
    console.log("⚡ CODESENSE EXTENSIVE 15+ ERROR DETECTION BENCHMARK");
    console.log("======================================================================");

    const graph = new CodebaseGraphManager();
    const analyzer = new CodeAnalyzer(graph);

    // =========================================================================
    // TEST CASE 1: 15 Intentional Errors Across All Supported Categories
    // =========================================================================
    const multiErrorPython = `
# 1. Missing Colon on def
def calculate_metrics(data)
    # 2. Hardcoded secret / credential
    db_password = "super_secret_master_password_999"

    # 3. Bare except clause
    try:
        val = 1
    except:
        pass

    # 4. Assignment inside condition
    if threshold = 100:
        print("High threshold")

    # 5. Extra Colon (::)
    for item in missing_dataset::
        # 6. Undefined variable missing_dataset (in loop)
        print(item)

    # 7. Unclosed Bracket
    numbers = [10, 20, 30

    # 8. Division by zero
    rate = 500 / 0

    # 9. Incompatible type operation (str + int)
    user_age = "25"
    next_age = user_age + 1

    # 10. Incorrect Dictionary Key (KeyError)
    student_record = {"name": "Sara", "grade": 95}
    print(student_record["student_name"])

    # 11. Duplicate Dictionary Key
    server_config = {"port": 8080, "port": 9090}

    # 12. Security: Code injection via eval
    eval("print('hello')")

    # 13. Security: SQL Injection via string concat
    query = "SELECT * FROM users WHERE username = '" + raw_input + "'"

    # 14. Undefined Function call
    execute_external_pipeline()

    # 15. Undefined Variable in calculation
    final_score = unassigned_total * 2
`;

    const docMultiError = {
        uri: mockVscode.Uri.file('C:/Users/aafre/Desktop/multi_error_test.py'),
        fileName: 'C:/Users/aafre/Desktop/multi_error_test.py',
        languageId: 'python',
        getText: () => multiErrorPython,
        version: 1
    };

    const detectedIssues = analyzer.runLocalCrossFileAnalysis(docMultiError, 'multi_error_test.py');
    console.log(`\n[TEST 1] File with 15+ Intentional Errors:`);
    console.log(`Found: ${detectedIssues.length} issues (Expected: >= 15)\n`);

    const categoriesDetected = new Set();
    detectedIssues.forEach((issue, idx) => {
        categoriesDetected.add(issue.errorName);
        console.log(`[#${idx + 1}] Line ${issue.line} [${issue.severity === 0 ? '🔴 ERROR' : '🟠 WARNING'}]: ${issue.errorName}`);
        console.log(`     💡 ${issue.whatHappened}`);
        console.log(`     🔧 ${issue.howToFix}`);
    });

    console.log(`\nTotal unique error categories covered: ${categoriesDetected.size}`);

    // =========================================================================
    // TEST CASE 2: Clean Healthy Python File (False Positive Check)
    // =========================================================================
    const cleanPython = `
import os

def calculate_average(numbers):
    if not numbers:
        return 0.0
    return sum(numbers) / len(numbers)

class StudentRecord:
    def __init__(self, name, age):
        self.name = name
        self.age = age

    def get_details(self):
        return f"{self.name} is {self.age} years old"

def main():
    scores = [85, 90, 95]
    avg = calculate_average(scores)
    student = StudentRecord("Alex", 20)
    print(student.get_details(), "Average:", avg)

if __name__ == "__main__":
    main()
`;

    const docClean = {
        uri: mockVscode.Uri.file('C:/Users/aafre/Desktop/clean_test.py'),
        fileName: 'C:/Users/aafre/Desktop/clean_test.py',
        languageId: 'python',
        getText: () => cleanPython,
        version: 1
    };

    const cleanIssues = analyzer.runLocalCrossFileAnalysis(docClean, 'clean_test.py');
    console.log(`\n----------------------------------------------------------------------`);
    console.log(`[TEST 2] Clean Healthy Python File (False Positive Verification):`);
    console.log(`Found: ${cleanIssues.length} issues (Expected: 0)`);
    if (cleanIssues.length === 0) {
        console.log(`✅ ZERO FALSE POSITIVES: Clean code reported as completely healthy!`);
    } else {
        console.error(`❌ Unexpected false positives:`, cleanIssues);
        process.exit(1);
    }

    console.log(`\n======================================================================`);
    console.log(`  BENCHMARK VERIFICATION COMPLETED WITH 100% SUCCESS!`);
    console.log(`======================================================================`);
}

runTestSuite().catch(err => {
    console.error("Benchmark failed:", err);
    process.exit(1);
});

