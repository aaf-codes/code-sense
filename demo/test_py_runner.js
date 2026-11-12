const { spawnSync } = require('child_process');
const path = require('path');

const testCode = `
# 1. Extra colon and undefined variable in loop
for student in student_list::
    print(student['name'], student['age'])

# 2. Undefined variables in expression
average = total_marks / len(students)

# 3. Division by zero
result = 100 / 0

# 4. KeyError in dictionary key
print(students[0]["student_name"])

# 5. Type error: str + int
age = "19"
age = age + 5

# 6. Undefined function call
display_student_details()

# 7. Extra colon on def
def calculate_grade(marks)::
    if marks >= 90:
        return 'A'
    else:
        return 'B'

# 8. Hardcoded password
password = "admin_secret_123"

# 9. Code injection via eval
eval("2 + 2")

# 10. SQL Injection
query = "SELECT * FROM users WHERE id = " + user_id
`;

const proc = spawnSync('python', [path.join(__dirname, '../src/py_analyzer.py'), 'test.py'], {
    input: testCode,
    encoding: 'utf8'
});

if (proc.error) {
    console.error("Spawn error:", proc.error);
} else {
    try {
        const issues = JSON.parse(proc.stdout);
        console.log(`========================================`);
        console.log(`Total issues detected: ${issues.length}`);
        console.log(`========================================`);
        issues.forEach((issue, idx) => {
            console.log(`[#${idx + 1}] Line ${issue.line} [${issue.severity.toUpperCase()}]: ${issue.errorName}`);
            console.log(`     💡 ${issue.whatHappened}`);
            console.log(`     🔧 ${issue.howToFix}`);
        });
    } catch (e) {
        console.error("Failed to parse output:", proc.stdout, proc.stderr);
    }
}

