#!/usr/bin/env python3
"""
CodeSense Comprehensive Regression Test Suite (35 Test Cases)
Verifies:
1. Zero false positives on valid Python code (built-ins, dict/list/str/set methods, imports, classes).
2. 100% accurate detection of genuine syntax, semantic, runtime, and security errors.
"""

import os
import sys

# Ensure src is in python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from py_analyzer import analyze_python_code

# =========================================================================
# TEST SUITE
# =========================================================================

TEST_CASES = [
    # --- Category A: Valid Dictionary Methods (Expected: 0 errors) ---
    {
        "id": "TC01",
        "name": "Valid dict.get() method",
        "code": 'student = {"name": "Sara"}\nage = student.get("age", 20)\nprint(age)',
        "expect_issues": False
    },
    {
        "id": "TC02",
        "name": "Valid dict.keys(), values(), items() methods",
        "code": 'student = {"name": "Sara", "grade": "A"}\nk = list(student.keys())\nv = list(student.values())\ni = list(student.items())',
        "expect_issues": False
    },
    {
        "id": "TC03",
        "name": "Valid dict.update(), pop(), clear() methods",
        "code": 'data = {"a": 1}\ndata.update({"b": 2})\nval = data.pop("b")\ndata.clear()',
        "expect_issues": False
    },

    # --- Category B: Valid List Methods (Expected: 0 errors) ---
    {
        "id": "TC04",
        "name": "Valid list.append(), extend(), insert() methods",
        "code": 'nums = [1, 2, 3]\nnums.append(4)\nnums.extend([5, 6])\nnums.insert(0, 0)',
        "expect_issues": False
    },
    {
        "id": "TC05",
        "name": "Valid list.remove(), pop(), sort(), reverse() methods",
        "code": 'items = ["banana", "apple", "cherry"]\nitems.sort()\nitems.reverse()\nitems.remove("apple")\nlast = items.pop()',
        "expect_issues": False
    },

    # --- Category C: Valid String Methods (Expected: 0 errors) ---
    {
        "id": "TC06",
        "name": "Valid str.upper(), lower(), strip() methods",
        "code": 'text = "  Hello World  "\nu = text.upper()\nl = text.lower()\ns = text.strip()',
        "expect_issues": False
    },
    {
        "id": "TC07",
        "name": "Valid str.split(), replace(), join(), startswith(), endswith()",
        "code": 's = "a,b,c"\nparts = s.split(",")\njoined = "-".join(parts)\nrep = s.replace(",", ";")\nbool1 = s.startswith("a")\nbool2 = s.endswith("c")',
        "expect_issues": False
    },

    # --- Category D: Valid Set Methods (Expected: 0 errors) ---
    {
        "id": "TC08",
        "name": "Valid set.add(), discard(), union(), intersection()",
        "code": 's1 = {1, 2, 3}\ns1.add(4)\ns1.discard(1)\ns2 = {3, 4, 5}\nu = s1.union(s2)\ni = s1.intersection(s2)',
        "expect_issues": False
    },

    # --- Category E: Valid Built-in Functions & Flow (Expected: 0 errors) ---
    {
        "id": "TC09",
        "name": "Standard built-ins (len, sum, range, enumerate, zip)",
        "code": 'nums = [10, 20, 30]\ntotal = sum(nums)\nlength = len(nums)\nfor idx, val in enumerate(nums):\n    print(idx, val)\npairs = list(zip(nums, nums))',
        "expect_issues": False
    },
    {
        "id": "TC10",
        "name": "Valid type conversions (int, str, float, bool, list, dict)",
        "code": 's = "123"\nn = int(s)\nf = float(n)\nst = str(f)\nb = bool(n)\nl = list()\nd = dict()',
        "expect_issues": False
    },

    # --- Category F: Valid Classes, Methods & Inheritance (Expected: 0 errors) ---
    {
        "id": "TC11",
        "name": "Class definition with __init__ and instance methods",
        "code": 'class Student:\n    def __init__(self, name, score):\n        self.name = name\n        self.score = score\n    def get_grade(self):\n        return "A" if self.score >= 90 else "B"\ns = Student("Sara", 95)\nprint(s.get_grade())',
        "expect_issues": False
    },
    {
        "id": "TC12",
        "name": "Class inheritance and super() calls",
        "code": 'class Person:\n    def __init__(self, name):\n        self.name = name\nclass Teacher(Person):\n    def __init__(self, name, subject):\n        super().__init__(name)\n        self.subject = subject\nt = Teacher("Dr. Smith", "Physics")',
        "expect_issues": False
    },

    # --- Category G: Valid Imports & Module Usage (Expected: 0 errors) ---
    {
        "id": "TC13",
        "name": "Import math and call math functions",
        "code": 'import math\nval = math.sqrt(16)\npi = math.pi\ns = math.sin(0)',
        "expect_issues": False
    },
    {
        "id": "TC14",
        "name": "from os import path and use path methods",
        "code": 'from os import path\nexists = path.exists("test.txt")\nbase = path.basename("/a/b/c.py")',
        "expect_issues": False
    },
    {
        "id": "TC15",
        "name": "Import json and use json.loads / json.dumps",
        "code": 'import json\nraw = \'{"score": 100}\'\nobj = json.loads(raw)\nout = json.dumps(obj)',
        "expect_issues": False
    },

    # --- Category H: Valid Functions, Scopes & Recursion (Expected: 0 errors) ---
    {
        "id": "TC16",
        "name": "Nested functions with closures",
        "code": 'def make_multiplier(factor):\n    def multiply(x):\n        return x * factor\n    return multiply\ndouble = make_multiplier(2)\nprint(double(5))',
        "expect_issues": False
    },
    {
        "id": "TC17",
        "name": "Recursive factorial function with correct arguments",
        "code": 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\nprint(factorial(5))',
        "expect_issues": False
    },
    {
        "id": "TC18",
        "name": "Function with default arguments and variable kwargs",
        "code": 'def greet(name, greeting="Hello", *args, **kwargs):\n    return f"{greeting}, {name}"\nprint(greet("Sara"))\nprint(greet("Sara", "Hi"))',
        "expect_issues": False
    },

    # --- Category I: Genuine Syntax Errors (Must be detected!) ---
    {
        "id": "TC19",
        "name": "Extra double colon (::)",
        "code": 'for i in range(10)::\n    print(i)',
        "expect_issues": True,
        "expected_error": "Extra Colon"
    },
    {
        "id": "TC20",
        "name": "Missing colon after def statement",
        "code": 'def calculate(a, b)\n    return a + b',
        "expect_issues": True,
        "expected_error": "Missing Colon"
    },
    {
        "id": "TC21",
        "name": "Missing colon after if statement",
        "code": 'x = 10\nif x > 5\n    print(x)',
        "expect_issues": True,
        "expected_error": "Missing Colon"
    },
    {
        "id": "TC22",
        "name": "Assignment in condition (if x = 5:)",
        "code": 'x = 10\nif x = 5:\n    print("five")',
        "expect_issues": True,
        "expected_error": "Assignment in Condition"
    },
    {
        "id": "TC23",
        "name": "Unclosed parenthesis",
        "code": 'print("Hello World"',
        "expect_issues": True,
        "expected_error": "Unclosed Bracket"
    },

    # --- Category J: Genuine Semantic / Runtime Errors (Must be detected!) ---
    {
        "id": "TC24",
        "name": "Division by zero literal",
        "code": 'result = 100 / 0',
        "expect_issues": True,
        "expected_error": "Division by Zero"
    },
    {
        "id": "TC25",
        "name": "Unsupported operand types (str + int)",
        "code": 'age = "19"\ntotal = age + 5',
        "expect_issues": True,
        "expected_error": "Type Error"
    },
    {
        "id": "TC26",
        "name": "Index out of range on known list literal",
        "code": 'numbers = [10, 20, 30]\nprint(numbers[5])',
        "expect_issues": True,
        "expected_error": "Index Out of Range"
    },
    {
        "id": "TC27",
        "name": "KeyError on known dict literal",
        "code": 'student = {"name": "Sara"}\nprint(student["age"])',
        "expect_issues": True,
        "expected_error": "KeyError"
    },
    {
        "id": "TC28",
        "name": "Function call with missing required arguments",
        "code": 'def calculate(a, b):\n    return a + b\nprint(calculate(10))',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments"
    },
    {
        "id": "TC29",
        "name": "Function call with too many arguments",
        "code": 'def square(n):\n    return n * n\nprint(square(10, 20))',
        "expect_issues": True,
        "expected_error": "Too Many Arguments"
    },
    {
        "id": "TC30",
        "name": "Calling completely undefined function",
        "code": 'display_student_analytics_report()',
        "expect_issues": True,
        "expected_error": "Calling Undefined Function"
    },
    {
        "id": "TC31",
        "name": "Accessing undefined variable",
        "code": 'print(completely_undefined_variable_xyz)',
        "expect_issues": True,
        "expected_error": "Undefined Variable"
    },

    # --- Category K: Code Quality & Security (Must be detected!) ---
    {
        "id": "TC32",
        "name": "Bare except clause",
        "code": 'try:\n    x = 1\nexcept:\n    pass',
        "expect_issues": True,
        "expected_error": "Bare 'except:'"
    },
    {
        "id": "TC33",
        "name": "Duplicate dictionary key",
        "code": 'd = {"name": "Sara", "name": "Aisha"}',
        "expect_issues": True,
        "expected_error": "Duplicate Dictionary Key"
    },
    {
        "id": "TC34",
        "name": "Hardcoded API key security warning",
        "code": 'gemini_api_key = "AIzaSyD-abc123456789xyz"',
        "expect_issues": True,
        "expected_error": "Hardcoded Credential"
    },
    {
        "id": "TC35",
        "name": "SQL injection via string concatenation",
        "code": 'query = "SELECT * FROM users WHERE username = \'" + user_input + "\'"',
        "expect_issues": True,
        "expected_error": "SQL Injection"
    }
]

def run_all_tests():
    passed = 0
    failed = 0

    print("=" * 70)
    print("CodeSense Analyzer Regression Test Suite (35 Test Cases)")
    print("=" * 70)

    for tc in TEST_CASES:
        issues = analyze_python_code(tc["code"], "test.py")
        has_issues = len(issues) > 0

        if not tc["expect_issues"]:
            # Expecting clean code
            if not has_issues:
                passed += 1
                print(f"[PASS] {tc['id']}: {tc['name']} -> 0 false positives")
            else:
                failed += 1
                print(f"[FAIL] {tc['id']}: {tc['name']} -> FALSE POSITIVE DETECTED!")
                for iss in issues:
                    print(f"       Line {iss['line']}: [{iss['errorName']}] {iss['whatHappened']}")
        else:
            # Expecting error detection
            expected_keyword = tc.get("expected_error", "")
            matched = any(expected_keyword.lower() in iss["errorName"].lower() for iss in issues)
            if matched:
                passed += 1
                found_names = [iss["errorName"] for iss in issues if expected_keyword.lower() in iss["errorName"].lower()]
                print(f"[PASS] {tc['id']}: {tc['name']} -> Accurately detected: {found_names[0]}")
            else:
                failed += 1
                print(f"[FAIL] {tc['id']}: {tc['name']} -> MISSED ERROR! Expected '{expected_keyword}'")
                print(f"       Found issues: {[iss['errorName'] for iss in issues]}")

    print("=" * 70)
    print(f"SUMMARY: {passed} / {len(TEST_CASES)} tests PASSED. (Failed: {failed})")
    print("=" * 70)

    if failed == 0:
        print("ALL 35 TEST CASES PASSED PERFECTLY WITH ZERO FALSE POSITIVES!")
        return 0
    else:
        print(f"WARNING: {failed} test case(s) failed!")
        return 1

if __name__ == "__main__":
    sys.exit(run_all_tests())

