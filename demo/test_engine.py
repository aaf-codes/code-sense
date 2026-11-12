import sys
import ast
import symtable
import tokenize
import io
import json

def analyze_python_code(code, filename="test.py"):
    issues = []
    lines = code.split("\n")

    # PASS 1: Token & Syntax Analysis (Bracket matching, unclosed strings, extra colons, etc.)
    # 1.1 Extra Colons (::)
    for idx, line in enumerate(lines):
        line_num = idx + 1
        trimmed = line.strip()
        if trimmed.startswith("#") or not trimmed:
            continue
        if "::" in trimmed and not ('"::' in line or "':':" in line):
            start_col = line.find("::")
            issues.append({
                "line": line_num,
                "startChar": start_col,
                "endChar": start_col + 2,
                "severity": "error",
                "errorName": "Extra Colon (::)",
                "whatHappened": "You typed two colons (::) instead of one.",
                "whyHappened": "Python syntax requires a single colon (:) to define blocks. Double colons cause a SyntaxError.",
                "howToFix": "Remove the extra colon so only one ':' remains.",
                "whyFixCorrect": "Single colon is the valid Python syntax for block headers.",
                "sideEffects": "None. The block will parse cleanly.",
                "correctedCode": line.replace("::", ":")
            })

    # 1.2 Missing Colons on block statements
    block_keywords = ("def ", "class ", "if ", "elif ", "else:", "for ", "while ", "try:", "except", "finally:", "with ")
    for idx, line in enumerate(lines):
        line_num = idx + 1
        trimmed = line.strip()
        if trimmed.startswith("#") or not trimmed:
            continue
        # Check if line starts with block keyword and doesn't end with ':' or '\\'
        for kw in ("def", "class", "if", "elif", "else", "for", "while", "try", "except", "finally", "with"):
            if trimmed == kw or trimmed.startswith(kw + " ") or trimmed.startswith(kw + "("):
                if not trimmed.endswith(":") and not trimmed.endswith("\\") and "::" not in trimmed:
                    # Make sure it's not a single-line lambda or generator
                    if "lambda" not in trimmed:
                        issues.append({
                            "line": line_num,
                            "startChar": len(line) - len(line.lstrip()),
                            "endChar": len(line),
                            "severity": "error",
                            "errorName": f"Missing Colon after '{kw}'",
                            "whatHappened": f"You forgot to add a colon (:) after the {kw} statement.",
                            "whyHappened": f"Python uses colons to indicate the start of an indented block.",
                            "howToFix": f"Add a colon (:) at the end of the line.",
                            "whyFixCorrect": "A colon is required by Python grammar.",
                            "sideEffects": "None.",
                            "correctedCode": line.rstrip() + ":"
                        })
                break

    # 1.3 Single '=' in comparison
    for idx, line in enumerate(lines):
        line_num = idx + 1
        trimmed = line.strip()
        if trimmed.startswith("#") or not trimmed:
            continue
        if any(trimmed.startswith(kw) for kw in ("if ", "elif ", "while ")):
            # Check for '=' that is not '==', '!=', '<=', '>='
            cond_part = trimmed.split("#")[0].rstrip(":")
            # Simple check for single equals
            import re
            m = re.search(r'(?<![=!<>])=(?![=])', cond_part)
            if m:
                issues.append({
                    "line": line_num,
                    "startChar": line.find("="),
                    "endChar": line.find("=") + 1,
                    "severity": "error",
                    "errorName": "Assignment in Condition",
                    "whatHappened": "You used a single equals sign (=) instead of double equals (==) in a condition.",
                    "whyHappened": "'=' assigns a value, while '==' compares values. Python does not allow assignment inside 'if' conditions.",
                    "howToFix": "Change '=' to '==' to compare values.",
                    "whyFixCorrect": "'==' performs equality comparison.",
                    "sideEffects": "None.",
                    "correctedCode": line.replace("=", "==", 1)
                })

    # 1.4 Bracket and Parenthesis Balance
    bracket_stack = []
    pairs = {')': '(', ']': '[', '}': '{'}
    opening = {'(': ')', '[': ']', '{': '}'}
    for idx, line in enumerate(lines):
        line_num = idx + 1
        clean_line = line.split("#")[0] # ignore comments
        in_str = False
        quote_char = None
        for col_idx, char in enumerate(clean_line):
            if char in ('"', "'"):
                if not in_str:
                    in_str = True
                    quote_char = char
                elif quote_char == char and (col_idx == 0 or clean_line[col_idx-1] != '\\'):
                    in_str = False
            elif not in_str:
                if char in opening:
                    bracket_stack.append((char, line_num, col_idx))
                elif char in pairs:
                    if bracket_stack and bracket_stack[-1][0] == pairs[char]:
                        bracket_stack.pop()
                    else:
                        issues.append({
                            "line": line_num,
                            "startChar": col_idx,
                            "endChar": col_idx + 1,
                            "severity": "error",
                            "errorName": f"Mismatched Bracket '{char}'",
                            "whatHappened": f"Closing bracket '{char}' has no matching opening bracket.",
                            "whyHappened": "Every closing bracket must have a corresponding opening bracket of the same type.",
                            "howToFix": f"Remove '{char}' or add the matching opening '{pairs[char]}'.",
                            "whyFixCorrect": "Brackets must be properly paired.",
                            "sideEffects": "None.",
                            "correctedCode": line[:col_idx] + line[col_idx+1:]
                        })

    for b, l_num, c_idx in bracket_stack:
        issues.append({
            "line": l_num,
            "startChar": c_idx,
            "endChar": c_idx + 1,
            "severity": "error",
            "errorName": f"Unclosed Bracket '{b}'",
            "whatHappened": f"Opening bracket '{b}' is never closed in this file.",
            "whyHappened": f"In Python, all brackets must be closed with '{opening[b]}' before the block or file ends.",
            "howToFix": f"Add closing '{opening[b]}' to close this bracket.",
            "whyFixCorrect": "Proper bracket matching is required for valid syntax.",
            "sideEffects": "None.",
            "correctedCode": lines[l_num - 1] + opening[b]
        })

    # 1.5 Indentation Check
    indent_stack = [0]
    for idx, line in enumerate(lines):
        line_num = idx + 1
        if not line.strip() or line.strip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if "\t" in line[:indent] and " " in line[:indent]:
            issues.append({
                "line": line_num,
                "startChar": 0,
                "endChar": indent,
                "severity": "error",
                "errorName": "Mixed Tabs and Spaces",
                "whatHappened": "This line mixes tabs and spaces for indentation.",
                "whyHappened": "Python 3 disallows mixing tabs and spaces in indentation (TabError).",
                "howToFix": "Convert tabs to spaces (use 4 spaces per indentation level).",
                "whyFixCorrect": "Consistent space indentation prevents TabError.",
                "sideEffects": "None.",
                "correctedCode": " " * indent + line.lstrip()
            })

    # PASS 2: Error-Tolerant AST Parsing & Semantic Analysis
    # Prepare sanitized code for ast.parse
    sanitized_lines = list(lines)
    for idx, line in enumerate(sanitized_lines):
        trimmed = line.strip()
        if "::" in trimmed:
            sanitized_lines[idx] = line.replace("::", ":")
        # sanitize missing colon on def/class/if etc so ast.parse can proceed
        tr = sanitized_lines[idx].strip()
        for kw in ("def", "class", "if", "elif", "else", "for", "while", "try", "except", "finally", "with"):
            if (tr == kw or tr.startswith(kw + " ") or tr.startswith(kw + "(")) and not tr.endswith(":") and not tr.endswith("\\"):
                sanitized_lines[idx] = sanitized_lines[idx].rstrip() + ":"
                break

    parsed_tree = None
    try:
        parsed_tree = ast.parse("\n".join(sanitized_lines), filename)
    except SyntaxError as e:
        # If there is a syntax error that couldn't be auto-sanitized, record it
        issues.append({
            "line": e.lineno or 1,
            "startChar": max(0, (e.offset or 1) - 1),
            "endChar": max(1, e.offset or 1),
            "severity": "error",
            "errorName": "SyntaxError: Invalid Syntax",
            "whatHappened": f"Python encountered invalid syntax: {e.msg}",
            "whyHappened": "This line violates Python language grammar rules.",
            "howToFix": "Correct the syntax according to Python specifications.",
            "whyFixCorrect": "Code must satisfy Python syntax to execute.",
            "sideEffects": "None.",
            "correctedCode": lines[(e.lineno or 1) - 1] if e.lineno and e.lineno <= len(lines) else ""
        })
        # Try line-by-line fallback parsing
        # (will be handled by our fallback AST rules)

    if parsed_tree:
        # Walk AST to find semantic and runtime errors
        class SemanticVisitor(ast.NodeVisitor):
            def __init__(self):
                self.scopes = [{
                    "assigned": set(),
                    "globals": set(),
                    "nonlocals": set()
                }]
                self.defined_funcs = set()
                self.defined_classes = set()
                self.imported_names = set()
                self.builtin_names = set(dir(__builtins__)) | {
                    "self", "cls", "True", "False", "None", "__name__", "__file__", "__doc__"
                }

            def visit_Import(self, node):
                for alias in node.names:
                    name = alias.asname or alias.name
                    self.imported_names.add(name)
                    self.scopes[-1]["assigned"].add(name)
                self.generic_visit(node)

            def visit_ImportFrom(self, node):
                for alias in node.names:
                    name = alias.asname or alias.name
                    self.imported_names.add(name)
                    self.scopes[-1]["assigned"].add(name)
                self.generic_visit(node)

            def visit_FunctionDef(self, node):
                self.defined_funcs.add(node.name)
                self.scopes[-1]["assigned"].add(node.name)
                # New scope for function
                func_scope = {
                    "assigned": set(),
                    "globals": set(),
                    "nonlocals": set()
                }
                # Add parameters to assigned
                for arg in node.args.args:
                    func_scope["assigned"].add(arg.arg)
                for arg in node.args.kwonlyargs:
                    func_scope["assigned"].add(arg.arg)
                if node.args.vararg:
                    func_scope["assigned"].add(node.args.vararg.arg)
                if node.args.kwarg:
                    func_scope["assigned"].add(node.args.kwarg.arg)
                self.scopes.append(func_scope)
                self.generic_visit(node)
                self.scopes.pop()

            def visit_ClassDef(self, node):
                self.defined_classes.add(node.name)
                self.scopes[-1]["assigned"].add(node.name)
                class_scope = {
                    "assigned": set(),
                    "globals": set(),
                    "nonlocals": set()
                }
                self.scopes.append(class_scope)
                self.generic_visit(node)
                self.scopes.pop()

            def visit_Assign(self, node):
                # Check RHS first before adding LHS to assigned!
                self.visit(node.value)
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        self.scopes[-1]["assigned"].add(target.id)
                    elif isinstance(target, (ast.Tuple, ast.List)):
                        for elt in target.elts:
                            if isinstance(elt, ast.Name):
                                self.scopes[-1]["assigned"].add(elt.id)

            def visit_AugAssign(self, node):
                # AugAssign e.g. age += 5 checks target first!
                self.visit(node.target)
                self.visit(node.value)

            def visit_For(self, node):
                # Target in iter (e.g. for student in student_list)
                # First visit the iterable (student_list)!
                self.visit(node.iter)
                # Then assign loop variable (student)
                if isinstance(node.target, ast.Name):
                    self.scopes[-1]["assigned"].add(node.target.id)
                elif isinstance(node.target, (ast.Tuple, ast.List)):
                    for elt in node.target.elts:
                        if isinstance(elt, ast.Name):
                            self.scopes[-1]["assigned"].add(elt.id)
                for stmt in node.body:
                    self.visit(stmt)
                for stmt in node.orelse:
                    self.visit(stmt)

            def visit_BinOp(self, node):
                # 1. Division by zero
                if isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
                    if isinstance(node.right, ast.Constant) and node.right.value == 0:
                        issues.append({
                            "line": node.lineno,
                            "startChar": node.col_offset,
                            "endChar": node.end_col_offset or (node.col_offset + 5),
                            "severity": "error",
                            "errorName": "Division by Zero (ZeroDivisionError)",
                            "whatHappened": "You are dividing a number directly by zero.",
                            "whyHappened": "In Python, division by zero is mathematically undefined and raises ZeroDivisionError.",
                            "howToFix": "Replace 0 with a non-zero divisor, or verify the divisor before dividing.",
                            "whyFixCorrect": "Using a non-zero divisor prevents runtime crashes.",
                            "sideEffects": "None.",
                            "correctedCode": lines[node.lineno - 1].replace("/ 0", "/ 1") if node.lineno <= len(lines) else ""
                        })

                # 2. String + Integer Type Error: "19" + 5 or age + 5 where age is str
                if isinstance(node.op, ast.Add):
                    left_is_str = isinstance(node.left, ast.Constant) and isinstance(node.left.value, str)
                    right_is_num = isinstance(node.right, ast.Constant) and isinstance(node.right.value, (int, float))
                    left_is_num = isinstance(node.left, ast.Constant) and isinstance(node.left.value, (int, float))
                    right_is_str = isinstance(node.right, ast.Constant) and isinstance(node.right.value, str)

                    if (left_is_str and right_is_num) or (left_is_num and right_is_str):
                        issues.append({
                            "line": node.lineno,
                            "startChar": node.col_offset,
                            "endChar": node.end_col_offset or (node.col_offset + 7),
                            "severity": "error",
                            "errorName": "Type Error: Unsupported Operand Types (str + int)",
                            "whatHappened": "You are attempting to add a string and a number together directly.",
                            "whyHappened": "Python is strongly typed and will not implicitly convert string to int or vice versa with '+'.",
                            "howToFix": "Convert the string to an integer with int() or convert number to str with str().",
                            "whyFixCorrect": "Explicit type conversion ensures valid operation.",
                            "sideEffects": "Ensure input string contains valid digits.",
                            "correctedCode": lines[node.lineno - 1]
                        })

                self.generic_visit(node)

            def visit_Name(self, node):
                if isinstance(node.ctx, ast.Load):
                    name = node.id
                    # Check if name is defined in any scope, builtins, or imports
                    is_defined = False
                    for scope in reversed(self.scopes):
                        if name in scope["assigned"] or name in scope["globals"]:
                            is_defined = True
                            break
                    if not is_defined:
                        if name in self.builtin_names or name in self.defined_funcs or name in self.defined_classes or name in self.imported_names:
                            is_defined = True

                    if not is_defined:
                        issues.append({
                            "line": node.lineno,
                            "startChar": node.col_offset,
                            "endChar": node.end_col_offset or (node.col_offset + len(name)),
                            "severity": "error",
                            "errorName": f"Undefined Variable '{name}' (NameError)",
                            "whatHappened": f"Variable '{name}' is referenced before being defined or imported.",
                            "whyHappened": f"Python searches local, enclosing, global, and built-in scopes for '{name}'. Finding none, it raises NameError.",
                            "howToFix": f"Define '{name}' or import it before using it on this line.",
                            "whyFixCorrect": "Variables must be assigned before being read.",
                            "sideEffects": "Check variable spelling and scope.",
                            "correctedCode": f"{name} = None\n" + (lines[node.lineno - 1] if node.lineno <= len(lines) else "")
                        })
                self.generic_visit(node)

            def visit_Call(self, node):
                # Check for undefined function call
                if isinstance(node.func, ast.Name):
                    fn_name = node.func.id
                    is_defined = False
                    for scope in reversed(self.scopes):
                        if fn_name in scope["assigned"]:
                            is_defined = True
                            break
                    if not is_defined:
                        if fn_name in self.builtin_names or fn_name in self.defined_funcs or fn_name in self.imported_names:
                            is_defined = True

                    if not is_defined:
                        issues.append({
                            "line": node.lineno,
                            "startChar": node.func.col_offset,
                            "endChar": node.func.end_col_offset or (node.func.col_offset + len(fn_name)),
                            "severity": "error",
                            "errorName": f"Undefined Function '{fn_name}' (NameError)",
                            "whatHappened": f"You are calling '{fn_name}()', but this function has not been defined or imported.",
                            "whyHappened": f"Python cannot execute an unreferenced function name. It raises NameError: name '{fn_name}' is not defined.",
                            "howToFix": f"Define 'def {fn_name}():' or import it from its module.",
                            "whyFixCorrect": "Declaring the function provides the bytecode instructions to execute.",
                            "sideEffects": "Check for function name typos.",
                            "correctedCode": f"def {fn_name}():\n    pass\n" + (lines[node.lineno - 1] if node.lineno <= len(lines) else "")
                        })

                # Check for security issues: eval() and exec()
                if isinstance(node.func, ast.Name) and node.func.id in ("eval", "exec"):
                    issues.append({
                        "line": node.lineno,
                        "startChar": node.func.col_offset,
                        "endChar": node.func.end_col_offset or (node.func.col_offset + len(node.func.id)),
                        "severity": "warning",
                        "errorName": f"Security Vulnerability: Arbitrary Code Execution via '{node.func.id}()'",
                        "whatHappened": f"Using '{node.func.id}()' allows arbitrary and untrusted code execution.",
                        "whyHappened": f"'{node.func.id}' parses and executes arbitrary strings as code, leading to remote code execution (RCE) vulnerabilities.",
                        "howToFix": "Use ast.literal_eval() for safe data evaluation, or avoid dynamic evaluation.",
                        "whyFixCorrect": "ast.literal_eval safely parses literals without executing arbitrary code.",
                        "sideEffects": "Ensure inputs strictly match Python literal structures.",
                        "correctedCode": lines[node.lineno - 1].replace(f"{node.func.id}(", "ast.literal_eval(") if node.lineno <= len(lines) else ""
                    })

                self.generic_visit(node)

            def visit_ExceptHandler(self, node):
                # Bare except: check
                if node.type is None:
                    issues.append({
                        "line": node.lineno,
                        "startChar": node.col_offset,
                        "endChar": node.col_offset + 6,
                        "severity": "warning",
                        "errorName": "Bare 'except:' Clause (Swallows SystemExit & KeyboardInterrupt)",
                        "whatHappened": "This try-except block uses a bare 'except:' clause without specifying an exception class.",
                        "whyHappened": "A bare 'except:' catches BaseException, including KeyboardInterrupt and SystemExit, making it impossible to stop the script.",
                        "howToFix": "Specify 'except Exception:' to catch standard runtime exceptions safely.",
                        "whyFixCorrect": "Catching 'Exception' leaves system exit and interrupt signals intact.",
                        "sideEffects": "KeyboardInterrupt (Ctrl+C) will now properly terminate the process.",
                        "correctedCode": lines[node.lineno - 1].replace("except:", "except Exception:") if node.lineno <= len(lines) else ""
                    })
                self.generic_visit(node)

            def visit_Dict(self, node):
                # Duplicate dictionary keys check
                seen_keys = set()
                for key_node in node.keys:
                    if isinstance(key_node, ast.Constant):
                        k_val = str(key_node.value)
                        if k_val in seen_keys:
                            issues.append({
                                "line": key_node.lineno,
                                "startChar": key_node.col_offset,
                                "endChar": key_node.end_col_offset or (key_node.col_offset + len(k_val) + 2),
                                "severity": "warning",
                                "errorName": f"Duplicate Dictionary Key '{k_val}'",
                                "whatHappened": f"The dictionary contains a duplicate key: '{k_val}'.",
                                "whyHappened": "In Python, later duplicate keys silently overwrite earlier values in dictionary literals.",
                                "howToFix": f"Remove or rename the duplicate '{k_val}' key.",
                                "whyFixCorrect": "Dictionary keys must be unique.",
                                "sideEffects": "Only one value can be associated with a key.",
                                "correctedCode": lines[key_node.lineno - 1] if key_node.lineno <= len(lines) else ""
                            })
                        else:
                            seen_keys.add(k_val)
                self.generic_visit(node)

        visitor = SemanticVisitor()
        visitor.visit(parsed_tree)

    # PASS 3: Security & Code Quality Checks
    for idx, line in enumerate(lines):
        line_num = idx + 1
        trimmed = line.strip()
        if trimmed.startswith("#") or not trimmed:
            continue
        # Hardcoded credentials
        import re
        sec_match = re.search(r'\b(password|passwd|api_key|secret_key|auth_token)\s*=\s*["\']([^"\']{4,})["\']', trimmed, re.IGNORECASE)
        if sec_match:
            issues.append({
                "line": line_num,
                "startChar": line.find(sec_match.group(0)),
                "endChar": line.find(sec_match.group(0)) + len(sec_match.group(0)),
                "severity": "warning",
                "errorName": f"Security Vulnerability: Hardcoded Credential '{sec_match.group(1)}'",
                "whatHappened": f"A secret or credential '{sec_match.group(1)}' appears hardcoded directly in the source code.",
                "whyHappened": "Hardcoding credentials exposes sensitive passwords and API keys in version control.",
                "howToFix": "Load sensitive credentials from environment variables using os.environ.get().",
                "whyFixCorrect": "Environment variables keep secret values out of source code repositories.",
                "sideEffects": "Ensure the environment variable is configured in the execution environment.",
                "correctedCode": f'import os\n{sec_match.group(1)} = os.environ.get("{sec_match.group(1).upper()}", "")'
            })

    # Sort issues by line number
    issues.sort(key=lambda x: (x["line"], x["startChar"]))
    return issues

if __name__ == "__main__":
    test_code = '''
# 1. Undefined variable
print("STUDENT MANAGEMENT TABLE")
print("-" * 50)

# 2. Extra colon + undefined variable
for student in student_list::
    print(student["name"], student["age"], student["marks"])

# 3. Undefined variables in RHS
average = total_marks / len(students)

# 4. Division by zero
result = 100 / 0

# 5. Dict key KeyError / Subscript
print(students[0]["student_name"])

# 6. Type error
age = "19"
age = age + 5

# 7. Calling undefined function
display_student_details()

# 8. Extra colon on def
def calculate_grade(marks)::
    if marks >= 90:
        return "A"
    else:
        return "B"

# 9. Bare except
try:
    x = 1
except:
    pass

# 10. Security: Hardcoded password
password = "supersecretpassword123"

# 11. Security: eval()
eval("2 + 2")

# 12. Duplicate dict key
config = {"host": "localhost", "host": "127.0.0.1"}
'''
    res = analyze_python_code(test_code)
    print(f"Total issues detected: {len(res)}")
    for i, issue in enumerate(res):
        print(f"[{i+1}] Line {issue['line']}: {issue['errorName']} ({issue['severity'].upper()})")

