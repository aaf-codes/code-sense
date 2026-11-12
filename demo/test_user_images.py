import subprocess
import json

code1 = """from calculator import calculate_average
from report import generate_report

def main():
    student = fetch_student(101)

    # ERROR 3: Undefined variable 'marks_list'
    marks_list = student["marks"]
    average = calculate_average(marks_list)

    insert_student(student)

    # ERROR 4: Incorrect function argument count
    generate_report(student, average)

if __name__ == "__main__":
    main()
"""

code2 = """# ERROR 1: Undefined variable 'student_list'
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
"""

for name, code in [('Image 1 (main.py)', code1), ('Image 2 (test.py)', code2)]:
    res = subprocess.run(['python', 'src/py_analyzer.py'], input=code, text=True, capture_output=True)
    print(f'=== {name} ===')
    try:
        data = json.loads(res.stdout)
        print(f'Total issues: {len(data)}')
        for item in data:
            print(f'  L{item["line"]}: [{item["errorName"]}] {item["message"]}')
    except Exception as e:
        print('Error:', e)
        print('stdout:', res.stdout)
        print('stderr:', res.stderr)

