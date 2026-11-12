const path = require('path');
const fs = require('fs');

// Test 1: Python test.py
const testPyContent = `
# ERROR 1: Undefined variable 'student_list'
print("STUDENT MANAGEMENT TABLE")
print("-" * 50)

# ERROR 2: Incorrect variable name 'student_list'
for student in student_list::
    print(student["name"], student["age"], student["marks"])

# ERROR 3: Undefined variable 'total_marks'
average = total_marks / len(students)

# ERROR 4: Division by zero
result = 100 / 0

# ERROR 5: Incorrect dictionary key 'student_name'
print(students[0]["student_name"])

# ERROR 6: Incorrect data type operation
age = "19"
age = age + 5

# ERROR 7: Calling an undefined function
display_student_details()

# ERROR 8: Incorrect indentation
def calculate_grade(marks)::
    if marks >= 90:
        return "A"
    else:
        return "B"
`;

// Test 2: Java Test.java
const testJavaContent = `
public class WrongName {
    public static void main(String[] args) {
        int x = 100 / 0;
        String message = 123;
        System.out.println("Hello World")
        calculateScore();
    }
}
`;

// Test 3: HTML test.html
const testHtmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Test Page</title>
</head>
<body>
    <div>
        <p>Unclosed paragraph
        <img alt="test">
        <a class="btn">Click me</a>
    </div>
    <div id="duplicate">First</div>
    <div id="duplicate">Second</div>
    </br>
</body>
</html>
`;

// Test 4: CSS test.css
const testCssContent = `
.container {
    colr: red;
    width: 300;
    margin: 10px
    padding: 5px;
`;

console.log("Tests defined successfully.");
