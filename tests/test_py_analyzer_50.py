#!/usr/bin/env python3
"""
CodeSense Comprehensive Regression Test Suite (70 Varied Test Cases)
Tests:
1. Zero False Positives on valid Python code:
   - Built-in methods with valid argument counts (str, dict, list, set, tuple)
   - Built-in functions, conversions, math, os, json, random
   - Comprehensions (list, dict, set), generator expressions, lambdas
   - Forward-referenced functions in main()
   - Recursive/nested variable unpacking, Walrus operator, except ... as e
   - Custom classes, constructors, methods, inheritance, super()
2. 100% Accurate Detection on genuine errors:
   - Method argument count mismatches (str.upper(val), dict.get(), list.append(1, 2))
   - Function argument count mismatches (len(), abs(1, 2), calculate(10))
   - Class method & constructor argument mismatches
   - Syntax errors (colons, assignment in condition, unclosed brackets)
   - Runtime & Semantic errors (ZeroDivision, str+int, IndexError, KeyError, NameError)
   - Security warnings (hardcoded credentials, SQL injection)
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from py_analyzer import analyze_python_code

TEST_CASES = [
    # =========================================================================
    # PART 1: VALID PYTHON CODE (Must produce 0 false positives)
    # =========================================================================

    # --- Group A: Valid Method Calls with Various Valid Argument Counts ---
    {
        "id": "V01",
        "name": "dict.get() with 1 argument (key)",
        "code": 'd = {"name": "Sara"}\nx = d.get("name")\nprint(x)',
        "expect_issues": False
    },
    {
        "id": "V02",
        "name": "dict.get() with 2 arguments (key, default)",
        "code": 'student = {"name": "Sara"}\nage = student.get("age", "Not available")\nprint(age)',
        "expect_issues": False
    },
    {
        "id": "V03",
        "name": "dict.pop() with 1 and 2 arguments",
        "code": 'd = {"a": 1, "b": 2}\nval1 = d.pop("a")\nval2 = d.pop("c", 0)',
        "expect_issues": False
    },
    {
        "id": "V04",
        "name": "dict.setdefault(), keys(), values(), items()",
        "code": 'd = {"x": 10}\nd.setdefault("y", 20)\nk = list(d.keys())\nv = list(d.values())\ni = list(d.items())',
        "expect_issues": False
    },
    {
        "id": "V05",
        "name": "str.upper(), lower(), strip() with 0 arguments",
        "code": 'name = "Sara"\nprint(name.upper())\nprint(name.lower())\nprint(name.strip())',
        "expect_issues": False
    },
    {
        "id": "V06",
        "name": "str.strip() with 1 argument (chars)",
        "code": 's = "###hello###"\nclean = s.strip("#")\nprint(clean)',
        "expect_issues": False
    },
    {
        "id": "V07",
        "name": "str.split() with 0, 1, and 2 arguments",
        "code": 's = "a,b,c,d"\np0 = s.split()\np1 = s.split(",")\np2 = s.split(",", 2)',
        "expect_issues": False
    },
    {
        "id": "V08",
        "name": "str.replace() with 2 and 3 arguments",
        "code": 'text = "apple apple apple"\nr1 = text.replace("apple", "orange")\nr2 = text.replace("apple", "orange", 1)',
        "expect_issues": False
    },
    {
        "id": "V09",
        "name": "str.join() with exactly 1 argument",
        "code": 'words = ["hello", "world"]\njoined = " ".join(words)',
        "expect_issues": False
    },
    {
        "id": "V10",
        "name": "str.find(), count(), startswith(), endswith()",
        "code": 's = "hello world"\nidx = s.find("world")\ncnt = s.count("l")\nb1 = s.startswith("hel")\nb2 = s.endswith("rld")',
        "expect_issues": False
    },
    {
        "id": "V11",
        "name": "list.append() with exactly 1 argument",
        "code": 'nums = [1, 2, 3]\nnums.append(4)',
        "expect_issues": False
    },
    {
        "id": "V12",
        "name": "list.extend() and insert() with valid arguments",
        "code": 'nums = [1, 2]\nnums.extend([3, 4])\nnums.insert(0, 0)',
        "expect_issues": False
    },
    {
        "id": "V13",
        "name": "list.pop() with 0 and 1 argument",
        "code": 'items = [10, 20, 30]\nlast = items.pop()\nfirst = items.pop(0)',
        "expect_issues": False
    },
    {
        "id": "V14",
        "name": "list.sort() with key and reverse kwargs, and list.reverse()",
        "code": 'names = ["Sara", "Aisha", "Zara"]\nnames.sort(key=len, reverse=True)\nnames.reverse()',
        "expect_issues": False
    },
    {
        "id": "V15",
        "name": "set.add(), discard(), remove() with 1 argument",
        "code": 's = {1, 2, 3}\ns.add(4)\ns.discard(2)\ns.remove(1)',
        "expect_issues": False
    },
    {
        "id": "V16",
        "name": "set.union() and intersection() with multiple sets",
        "code": 's1 = {1, 2}\ns2 = {2, 3}\ns3 = {3, 4}\nu = s1.union(s2, s3)\ni = s1.intersection(s2)',
        "expect_issues": False
    },
    {
        "id": "V17",
        "name": "tuple.count() and tuple.index() with valid arguments",
        "code": 't = (1, 2, 2, 3)\nc = t.count(2)\nidx = t.index(3)',
        "expect_issues": False
    },

    # --- Group B: Valid Built-in Functions & Standard Types ---
    {
        "id": "V18",
        "name": "Built-ins: len, sum, abs, round, range",
        "code": 'nums = [1, 2, 3]\nl = len(nums)\ns = sum(nums)\na = abs(-5)\nr = round(3.14159, 2)\nrg = list(range(1, 10, 2))',
        "expect_issues": False
    },
    {
        "id": "V19",
        "name": "Built-ins: isinstance, issubclass, enumerate, zip",
        "code": 'val = 10\nis_num = isinstance(val, int)\nfor i, v in enumerate(["a", "b"]):\n    print(i, v)\npairs = list(zip([1, 2], ["x", "y"]))',
        "expect_issues": False
    },
    {
        "id": "V20",
        "name": "Valid type casting: int, float, str, bool, list, dict, set",
        "code": 's = str(123)\ni = int("123")\nf = float("3.14")\nb = bool(1)\nl = list((1, 2))\nd = dict()\nst = set([1, 2])',
        "expect_issues": False
    },

    # --- Group C: Valid User Classes and Methods ---
    {
        "id": "V21",
        "name": "User class with constructor and instance methods",
        "code": 'class Student:\n    def __init__(self, name, age):\n        self.name = name\n        self.age = age\n    def get_info(self):\n        return f"{self.name} is {self.age}"\ns = Student("Sara", 20)\nprint(s.get_info())',
        "expect_issues": False
    },
    {
        "id": "V22",
        "name": "User class with default constructor parameters",
        "code": 'class Config:\n    def __init__(self, host="localhost", port=8080):\n        self.host = host\n        self.port = port\nc1 = Config()\nc2 = Config("127.0.0.1")\nc3 = Config("127.0.0.1", 9000)',
        "expect_issues": False
    },
    {
        "id": "V23",
        "name": "Class inheritance and super() calls",
        "code": 'class Animal:\n    def __init__(self, name):\n        self.name = name\nclass Dog(Animal):\n    def __init__(self, name, breed):\n        super().__init__(name)\n        self.breed = breed\nd = Dog("Buddy", "Golden")',
        "expect_issues": False
    },

    # --- Group D: Valid Imports and External Modules ---
    {
        "id": "V24",
        "name": "Import math and call math functions",
        "code": 'import math\nsq = math.sqrt(25)\nval = math.floor(3.9)\npi = math.pi',
        "expect_issues": False
    },
    {
        "id": "V25",
        "name": "from os import path and file operations",
        "code": 'from os import path\nexists = path.isfile("test.txt")\njoined = path.join("dir", "file.py")',
        "expect_issues": False
    },
    {
        "id": "V26",
        "name": "Import json and serialization",
        "code": 'import json\ndata = {"scores": [90, 80]}\nraw = json.dumps(data)\nobj = json.loads(raw)',
        "expect_issues": False
    },

    # --- Group E: Advanced Python Scopes, Closures, Comprehensions & Idioms ---
    {
        "id": "V27",
        "name": "List comprehension with loop variable scoping",
        "code": 'squares = [x * x for x in range(10)]\nevens = [n for n in squares if n % 2 == 0]',
        "expect_issues": False
    },
    {
        "id": "V28",
        "name": "Dict and set comprehensions",
        "code": 'square_map = {x: x * x for x in range(5)}\nunique_lengths = {len(w) for w in ["apple", "banana", "pear"]}',
        "expect_issues": False
    },
    {
        "id": "V29",
        "name": "Lambda function with parameters",
        "code": 'add = lambda a, b: a + b\nprint(add(2, 3))',
        "expect_issues": False
    },
    {
        "id": "V30",
        "name": "Forward-referenced functions in main() (standard Python idiom)",
        "code": 'def main():\n    setup()\n    run_loop()\n\ndef setup():\n    pass\n\ndef run_loop():\n    pass\n\nmain()',
        "expect_issues": False
    },
    {
        "id": "V31",
        "name": "try ... except Exception as e: block",
        "code": 'try:\n    val = int("123")\nexcept Exception as e:\n    print(e)',
        "expect_issues": False
    },
    {
        "id": "V32",
        "name": "Nested tuple unpacking in assignment",
        "code": 'a, (b, c) = (1, (2, 3))\nprint(a + b + c)',
        "expect_issues": False
    },
    {
        "id": "V33",
        "name": "with open(...) as f context manager",
        "code": 'with open("test.txt", "r") as f:\n    content = f.read()\n    lines = f.readlines()',
        "expect_issues": False
    },
    {
        "id": "V34",
        "name": "Student management average calculation program",
        "code": 'students = [\n    {"name": "Sara", "marks": [90, 95]},\n    {"name": "Aisha", "marks": [85, 92]}\n]\nfor s in students:\n    avg = sum(s["marks"]) / len(s["marks"])\n    print(s["name"], avg)',
        "expect_issues": False
    },
    {
        "id": "V35",
        "name": "Ternary dictionary key guard (age in student)",
        "code": 'student = {"name": "Sara"}\nage_text = student["age"] if "age" in student else "Unknown"\nprint(age_text)',
        "expect_issues": False
    },
    {
        "id": "V36",
        "name": "Safe third-party client method call (unknown type)",
        "code": 'def fetch_user_data(client, user_id):\n    res = client.get_user_profile(user_id, format="json")\n    return res',
        "expect_issues": False
    },
    {
        "id": "V37",
        "name": "Function with *args and **kwargs",
        "code": 'def log_event(event_type, *args, **kwargs):\n    print(event_type, args, kwargs)\nlog_event("login", 1, 2, user="Sara")',
        "expect_issues": False
    },
    {
        "id": "V38",
        "name": "Chained string methods: strip().upper()",
        "code": 'text = "  hello world  "\nres = text.strip().upper()\nprint(res)',
        "expect_issues": False
    },
    {
        "id": "V39",
        "name": "Standard built-in exceptions used directly",
        "code": 'def validate(x):\n    if x < 0:\n        raise ValueError("Must be positive")\n    if not isinstance(x, int):\n        raise TypeError("Must be an integer")',
        "expect_issues": False
    },
    {
        "id": "V40",
        "name": "Walrus operator (:=) assigning in conditional",
        "code": 'text = "hello"\nif (n := len(text)) > 3:\n    print(n)',
        "expect_issues": False
    },

    # =========================================================================
    # PART 2: GENUINE ERRORS (Must be accurately detected)
    # =========================================================================

    # --- Group F: Method Argument Count Mismatches ---
    {
        "id": "E41",
        "name": "str(value).upper(value) - upper takes no arguments",
        "code": 'def upper(value):\n    return str(value).upper(value)',
        "expect_issues": True,
        "expected_error": "Too Many Arguments: 'str.upper()'"
    },
    {
        "id": "E42",
        "name": "str.lower(10) - lower takes no arguments",
        "code": 'name = "Sara"\nprint(name.lower(10))',
        "expect_issues": True,
        "expected_error": "Too Many Arguments: 'str.lower()'"
    },
    {
        "id": "E43",
        "name": "str.join() with 0 arguments (requires 1)",
        "code": 's = ","\nprint(s.join())',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments: 'str.join()'"
    },
    {
        "id": "E44",
        "name": "dict.get() with 0 arguments (requires at least 1)",
        "code": 'd = {"name": "Sara"}\nprint(d.get())',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments: 'dict.get()'"
    },
    {
        "id": "E45",
        "name": "dict.get() with 3 arguments (accepts at most 2)",
        "code": 'd = {"name": "Sara"}\nprint(d.get("name", "N/A", "extra"))',
        "expect_issues": True,
        "expected_error": "Too Many Arguments: 'dict.get()'"
    },
    {
        "id": "E46",
        "name": "list.append() with 2 arguments (takes exactly 1)",
        "code": 'nums = [1, 2, 3]\nnums.append(4, 5)',
        "expect_issues": True,
        "expected_error": "Too Many Arguments: 'list.append()'"
    },
    {
        "id": "E47",
        "name": "list.append() with 0 arguments (takes exactly 1)",
        "code": 'nums = [1, 2, 3]\nnums.append()',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments: 'list.append()'"
    },
    {
        "id": "E48",
        "name": "set.add() with 0 arguments (takes exactly 1)",
        "code": 's = {1, 2}\ns.add()',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments: 'set.add()'"
    },
    {
        "id": "E49",
        "name": "set.add() with 2 arguments (takes exactly 1)",
        "code": 's = {1, 2}\ns.add(3, 4)',
        "expect_issues": True,
        "expected_error": "Too Many Arguments: 'set.add()'"
    },

    # --- Group G: Built-in Function Argument Count Mismatches ---
    {
        "id": "E50",
        "name": "len() with 0 arguments (takes exactly 1)",
        "code": 'length = len()',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments: 'len()'"
    },
    {
        "id": "E51",
        "name": "len() with 2 arguments (takes exactly 1)",
        "code": 'nums = [1, 2]\nlength = len(nums, nums)',
        "expect_issues": True,
        "expected_error": "Too Many Arguments: 'len()'"
    },
    {
        "id": "E52",
        "name": "isinstance() with 1 argument (takes exactly 2)",
        "code": 'check = isinstance(10)',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments: 'isinstance()'"
    },

    # --- Group H: User Function and Class Method Argument Mismatches ---
    {
        "id": "E53",
        "name": "User function missing required argument: calculate(10)",
        "code": 'def calculate(a, b):\n    return a + b\nprint(calculate(10))',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments: 'calculate()'"
    },
    {
        "id": "E54",
        "name": "User function with too many arguments: square(10, 20)",
        "code": 'def square(n):\n    return n * n\nprint(square(10, 20))',
        "expect_issues": True,
        "expected_error": "Too Many Arguments: 'square()'"
    },
    {
        "id": "E55",
        "name": "User class method missing required argument",
        "code": 'class Calculator:\n    def add(self, a, b):\n        return a + b\nc = Calculator()\nprint(c.add(10))',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments: 'Calculator.add()'"
    },
    {
        "id": "E56",
        "name": "User class method with too many arguments",
        "code": 'class Greeter:\n    def greet(self):\n        return "Hello"\ng = Greeter()\nprint(g.greet("Extra"))',
        "expect_issues": True,
        "expected_error": "Too Many Arguments: 'Greeter.greet()'"
    },
    {
        "id": "E57",
        "name": "Class constructor missing required parameters",
        "code": 'class Student:\n    def __init__(self, name, age):\n        self.name = name\n        self.age = age\ns = Student()',
        "expect_issues": True,
        "expected_error": "Wrong Number of Arguments: 'Student()'"
    },

    # --- Group I: Syntax Errors ---
    {
        "id": "E58",
        "name": "Extra colon on for loop: for x in items::",
        "code": 'for x in [1, 2]::\n    print(x)',
        "expect_issues": True,
        "expected_error": "Extra Colon"
    },
    {
        "id": "E59",
        "name": "Missing colon after def statement",
        "code": 'def get_total(x, y)\n    return x + y',
        "expect_issues": True,
        "expected_error": "Missing Colon"
    },
    {
        "id": "E60",
        "name": "Assignment in condition: if x = 10:",
        "code": 'x = 10\nif x = 10:\n    print(x)',
        "expect_issues": True,
        "expected_error": "Assignment in Condition"
    },
    {
        "id": "E61",
        "name": "Unclosed bracket: data = [1, 2, 3",
        "code": 'data = [1, 2, 3',
        "expect_issues": True,
        "expected_error": "Unclosed Bracket"
    },

    # --- Group J: Runtime and Semantic Errors ---
    {
        "id": "E62",
        "name": "Division by zero literal: 100 / 0",
        "code": 'result = 100 / 0',
        "expect_issues": True,
        "expected_error": "Division by Zero"
    },
    {
        "id": "E63",
        "name": "Type error: str + int unsupported operand",
        "code": 'age = "20"\ntotal = age + 5',
        "expect_issues": True,
        "expected_error": "Type Error"
    },
    {
        "id": "E64",
        "name": "IndexError: numbers[5] on list of 3 items",
        "code": 'numbers = [10, 20, 30]\nprint(numbers[5])',
        "expect_issues": True,
        "expected_error": "Index Out of Range"
    },
    {
        "id": "E65",
        "name": "KeyError: student['age'] on dict literal without 'age'",
        "code": 'student = {"name": "Sara"}\nprint(student["age"])',
        "expect_issues": True,
        "expected_error": "KeyError"
    },
    {
        "id": "E66",
        "name": "NameError: calling completely undefined function",
        "code": 'non_existent_function_call_xyz()',
        "expect_issues": True,
        "expected_error": "Calling Undefined Function"
    },
    {
        "id": "E67",
        "name": "NameError: referencing completely undefined variable",
        "code": 'print(completely_undefined_var_12345)',
        "expect_issues": True,
        "expected_error": "Undefined Variable"
    },
    {
        "id": "E68",
        "name": "Duplicate dictionary key warning",
        "code": 'd = {"name": "Sara", "name": "Aisha"}',
        "expect_issues": True,
        "expected_error": "Duplicate Dictionary Key"
    },
    {
        "id": "E69",
        "name": "Security: Hardcoded secret key warning",
        "code": 'secret_key = "AIzaSyD_my_secret_token_value"',
        "expect_issues": True,
        "expected_error": "Hardcoded Credential"
    },
    {
        "id": "E70",
        "name": "Security: SQL injection concatenation warning",
        "code": 'query = "SELECT * FROM accounts WHERE id = " + user_input',
        "expect_issues": True,
        "expected_error": "SQL Injection"
    }
]

def run_suite():
    passed = 0
    failed = 0

    print("=" * 78)
    print("CodeSense Analyzer Comprehensive Regression Suite (70 Varied Test Cases)")
    print("=" * 78)

    for tc in TEST_CASES:
        issues = analyze_python_code(tc["code"], "test.py")
        has_issues = len(issues) > 0

        if not tc["expect_issues"]:
            if not has_issues:
                passed += 1
                print(f"[PASS] {tc['id']}: {tc['name']} -> 0 false positives")
            else:
                failed += 1
                print(f"[FAIL] {tc['id']}: {tc['name']} -> FALSE POSITIVE DETECTED!")
                for iss in issues:
                    print(f"       Line {iss['line']}: [{iss['errorName']}] {iss['whatHappened']}")
        else:
            expected = tc.get("expected_error", "")
            matched = any(expected.lower() in iss["errorName"].lower() for iss in issues)
            if matched:
                passed += 1
                found_names = [iss["errorName"] for iss in issues if expected.lower() in iss["errorName"].lower()]
                print(f"[PASS] {tc['id']}: {tc['name']} -> Detected: {found_names[0]}")
            else:
                failed += 1
                print(f"[FAIL] {tc['id']}: {tc['name']} -> MISSED ERROR! Expected '{expected}'")
                print(f"       Found issues: {[iss['errorName'] for iss in issues]}")

    print("=" * 78)
    print(f"RESULTS: {passed} / {len(TEST_CASES)} tests PASSED. (Failed: {failed})")
    print("=" * 78)

    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(run_suite())
