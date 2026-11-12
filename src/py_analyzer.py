#!/usr/bin/env python3
"""
CodeSense Deep Static, Semantic & Runtime Python Analyzer v1.3.0
Comprehensive, General-Purpose Python Code Analyzer.
Emits a structured JSON array of CodeIssue objects to stdout.

Architectural highlights:
- Error-tolerant multi-pass AST parser
- Universal scope tree with closures, comprehensions, lambdas, and except handlers
- Forward-reference awareness (functions & globals defined below caller in same file)
- Recursive target unpacking (tuples, lists, starred targets)
- Exact argument validation for built-in methods (str, dict, list, set, tuple)
- Exact argument validation for built-in functions (len, abs, round, isinstance, etc.)
- User-defined class & instance method signature validation (respecting self/cls)
- Expression type inference (constructors, method returns, binary ops, assignments)
- Conservative method resolution: zero false positives on unknown/untyped objects
- Membership-guarded dictionary access detection
- Comment-aware line analysis
"""

import sys
import ast
import re
import json

# ---------------------------------------------------------------------------
# Standard Built-in Names & Types (Functions, Exceptions, Constants, Magic)
# ---------------------------------------------------------------------------
STANDARD_BUILTINS = {
    # Built-in Functions
    "abs", "aiter", "all", "anext", "any", "ascii", "bin", "bool", "breakpoint",
    "bytearray", "bytes", "callable", "chr", "classmethod", "compile", "complex",
    "delattr", "dict", "dir", "divmod", "enumerate", "eval", "exec", "filter",
    "float", "format", "frozenset", "getattr", "globals", "hasattr", "hash",
    "help", "hex", "id", "input", "int", "isinstance", "issubclass", "iter",
    "len", "list", "locals", "map", "max", "memoryview", "min", "next",
    "object", "oct", "open", "ord", "pow", "print", "property", "range",
    "repr", "reversed", "round", "set", "setattr", "slice", "sorted",
    "staticmethod", "str", "sum", "super", "tuple", "type", "vars", "zip",
    "__import__",
    # Built-in Constants
    "True", "False", "None", "NotImplemented", "Ellipsis", "__debug__",
    # Common Python Magics / Keywords in Scopes
    "self", "cls", "__name__", "__file__", "__doc__", "__all__",
    "__version__", "__author__", "__package__", "__spec__", "__loader__",
    "__builtins__", "__annotations__", "__class__", "__path__",
    # Standard Exceptions
    "BaseException", "Exception", "ArithmeticError", "BufferError",
    "LookupError", "AssertionError", "AttributeError", "EOFError",
    "FloatingPointError", "GeneratorExit", "ImportError", "IndexError",
    "KeyError", "KeyboardInterrupt", "MemoryError", "NameError",
    "NotImplementedError", "OSError", "OverflowError", "RecursionError",
    "ReferenceError", "RuntimeError", "StopAsyncIteration", "StopIteration",
    "SyntaxError", "IndentationError", "TabError", "SystemError",
    "SystemExit", "TypeError", "UnboundLocalError", "UnicodeError",
    "UnicodeEncodeError", "UnicodeDecodeError", "UnicodeTranslateError",
    "ValueError", "ZeroDivisionError", "EnvironmentError", "IOError",
    "WindowsError", "BlockingIOError", "ChildProcessError", "ConnectionError",
    "BrokenPipeError", "ConnectionAbortedError", "ConnectionRefusedError",
    "ConnectionResetError", "FileExistsError", "FileNotFoundError",
    "InterruptedError", "IsADirectoryError", "NotADirectoryError",
    "PermissionError", "ProcessLookupError", "TimeoutError", "Warning",
    "UserWarning", "DeprecationWarning", "PendingDeprecationWarning",
    "SyntaxWarning", "RuntimeWarning", "FutureWarning", "ImportWarning",
    "UnicodeWarning", "BytesWarning", "ResourceWarning"
}

# ---------------------------------------------------------------------------
# Built-in Method Argument Specifications
# (min_args, max_args, human_readable_desc)
# ---------------------------------------------------------------------------
BUILTIN_METHOD_SPECS = {
    "str": {
        "upper": (0, 0, "str.upper() takes no arguments"),
        "lower": (0, 0, "str.lower() takes no arguments"),
        "capitalize": (0, 0, "str.capitalize() takes no arguments"),
        "title": (0, 0, "str.title() takes no arguments"),
        "swapcase": (0, 0, "str.swapcase() takes no arguments"),
        "casefold": (0, 0, "str.casefold() takes no arguments"),
        "strip": (0, 1, "str.strip() takes at most 1 argument (chars)"),
        "lstrip": (0, 1, "str.lstrip() takes at most 1 argument (chars)"),
        "rstrip": (0, 1, "str.rstrip() takes at most 1 argument (chars)"),
        "split": (0, 2, "str.split() takes at most 2 arguments (sep, maxsplit)"),
        "rsplit": (0, 2, "str.rsplit() takes at most 2 arguments (sep, maxsplit)"),
        "splitlines": (0, 1, "str.splitlines() takes at most 1 argument (keepends)"),
        "join": (1, 1, "str.join() takes exactly one argument (iterable)"),
        "replace": (2, 3, "str.replace() takes 2 or 3 arguments (old, new[, count])"),
        "find": (1, 3, "str.find() takes 1 to 3 arguments (sub[, start[, end]])"),
        "rfind": (1, 3, "str.rfind() takes 1 to 3 arguments (sub[, start[, end]])"),
        "index": (1, 3, "str.index() takes 1 to 3 arguments (sub[, start[, end]])"),
        "rindex": (1, 3, "str.rindex() takes 1 to 3 arguments (sub[, start[, end]])"),
        "count": (1, 3, "str.count() takes 1 to 3 arguments (sub[, start[, end]])"),
        "startswith": (1, 3, "str.startswith() takes 1 to 3 arguments (prefix[, start[, end]])"),
        "endswith": (1, 3, "str.endswith() takes 1 to 3 arguments (suffix[, start[, end]])"),
        "center": (1, 2, "str.center() takes 1 or 2 arguments (width[, fillchar])"),
        "ljust": (1, 2, "str.ljust() takes 1 or 2 arguments (width[, fillchar])"),
        "rjust": (1, 2, "str.rjust() takes 1 or 2 arguments (width[, fillchar])"),
        "zfill": (1, 1, "str.zfill() takes exactly one argument (width)"),
        "encode": (0, 2, "str.encode() takes at most 2 arguments (encoding, errors)"),
        "isalnum": (0, 0, "str.isalnum() takes no arguments"),
        "isalpha": (0, 0, "str.isalpha() takes no arguments"),
        "isascii": (0, 0, "str.isascii() takes no arguments"),
        "isdecimal": (0, 0, "str.isdecimal() takes no arguments"),
        "isdigit": (0, 0, "str.isdigit() takes no arguments"),
        "isidentifier": (0, 0, "str.isidentifier() takes no arguments"),
        "islower": (0, 0, "str.islower() takes no arguments"),
        "isnumeric": (0, 0, "str.isnumeric() takes no arguments"),
        "isprintable": (0, 0, "str.isprintable() takes no arguments"),
        "isspace": (0, 0, "str.isspace() takes no arguments"),
        "istitle": (0, 0, "str.istitle() takes no arguments"),
        "isupper": (0, 0, "str.isupper() takes no arguments"),
    },
    "dict": {
        "get": (1, 2, "dict.get() takes 1 or 2 arguments (key[, default])"),
        "keys": (0, 0, "dict.keys() takes no arguments"),
        "values": (0, 0, "dict.values() takes no arguments"),
        "items": (0, 0, "dict.items() takes no arguments"),
        "clear": (0, 0, "dict.clear() takes no arguments"),
        "copy": (0, 0, "dict.copy() takes no arguments"),
        "pop": (1, 2, "dict.pop() takes 1 or 2 arguments (key[, default])"),
        "popitem": (0, 0, "dict.popitem() takes no arguments"),
        "setdefault": (1, 2, "dict.setdefault() takes 1 or 2 arguments (key[, default])"),
        "update": (0, 1, "dict.update() takes at most 1 positional argument"),
    },
    "list": {
        "append": (1, 1, "list.append() takes exactly one argument"),
        "extend": (1, 1, "list.extend() takes exactly one argument (iterable)"),
        "insert": (2, 2, "list.insert() takes exactly 2 arguments (index, object)"),
        "remove": (1, 1, "list.remove() takes exactly one argument (value)"),
        "pop": (0, 1, "list.pop() takes at most 1 argument (index)"),
        "clear": (0, 0, "list.clear() takes no arguments"),
        "index": (1, 3, "list.index() takes 1 to 3 arguments (value[, start[, stop]])"),
        "count": (1, 1, "list.count() takes exactly one argument (value)"),
        "sort": (0, 0, "list.sort() takes no positional arguments (use key=... and reverse=...)"),
        "reverse": (0, 0, "list.reverse() takes no arguments"),
        "copy": (0, 0, "list.copy() takes no arguments"),
    },
    "set": {
        "add": (1, 1, "set.add() takes exactly one argument (element)"),
        "remove": (1, 1, "set.remove() takes exactly one argument (element)"),
        "discard": (1, 1, "set.discard() takes exactly one argument (element)"),
        "pop": (0, 0, "set.pop() takes no arguments"),
        "clear": (0, 0, "set.clear() takes no arguments"),
        "copy": (0, 0, "set.copy() takes no arguments"),
        "symmetric_difference": (1, 1, "set.symmetric_difference() takes exactly one argument"),
        "issubset": (1, 1, "set.issubset() takes exactly one argument"),
        "issuperset": (1, 1, "set.issuperset() takes exactly one argument"),
        "isdisjoint": (1, 1, "set.isdisjoint() takes exactly one argument"),
        "union": (0, None, "set.union() accepts any number of arguments"),
        "intersection": (0, None, "set.intersection() accepts any number of arguments"),
        "difference": (0, None, "set.difference() accepts any number of arguments"),
        "update": (0, None, "set.update() accepts any number of arguments"),
    },
    "tuple": {
        "count": (1, 1, "tuple.count() takes exactly one argument (value)"),
        "index": (1, 3, "tuple.index() takes 1 to 3 arguments (value[, start[, stop]])"),
    }
}

# ---------------------------------------------------------------------------
# Built-in Function Argument Specifications
# (min_args, max_args, human_readable_desc)
# ---------------------------------------------------------------------------
BUILTIN_FUNC_SPECS = {
    "len": (1, 1, "len() takes exactly one argument"),
    "abs": (1, 1, "abs() takes exactly one argument"),
    "round": (1, 2, "round() takes 1 or 2 arguments (number[, ndigits])"),
    "int": (0, 2, "int() takes at most 2 arguments (x[, base])"),
    "float": (0, 1, "float() takes at most 1 argument"),
    "bool": (0, 1, "bool() takes at most 1 argument"),
    "str": (0, 3, "str() takes at most 3 arguments"),
    "range": (1, 3, "range() takes 1 to 3 arguments ([start,] stop[, step])"),
    "isinstance": (2, 2, "isinstance() takes exactly 2 arguments (object, classinfo)"),
    "issubclass": (2, 2, "issubclass() takes exactly 2 arguments (class, classinfo)"),
    "enumerate": (1, 2, "enumerate() takes 1 or 2 arguments (iterable[, start])"),
    "reversed": (1, 1, "reversed() takes exactly one argument"),
    "sum": (1, 2, "sum() takes 1 or 2 arguments (iterable[, start])"),
    "pow": (2, 3, "pow() takes 2 or 3 arguments (base, exp[, mod])"),
    "divmod": (2, 2, "divmod() takes exactly 2 arguments (a, b)"),
    "id": (1, 1, "id() takes exactly one argument"),
    "hash": (1, 1, "hash() takes exactly one argument"),
    "repr": (1, 1, "repr() takes exactly one argument"),
    "ascii": (1, 1, "ascii() takes exactly one argument"),
    "ord": (1, 1, "ord() takes exactly one argument"),
    "chr": (1, 1, "chr() takes exactly one argument"),
    "bin": (1, 1, "bin() takes exactly one argument"),
    "oct": (1, 1, "oct() takes exactly one argument"),
    "hex": (1, 1, "hex() takes exactly one argument"),
    "next": (1, 2, "next() takes 1 or 2 arguments (iterator[, default])"),
    "iter": (1, 2, "iter() takes 1 or 2 arguments"),
    "getattr": (2, 3, "getattr() takes 2 or 3 arguments (object, name[, default])"),
    "setattr": (3, 3, "setattr() takes exactly 3 arguments (object, name, value)"),
    "hasattr": (2, 2, "hasattr() takes exactly 2 arguments (object, name)"),
    "delattr": (2, 2, "delattr() takes exactly 2 arguments (object, name)"),
    "vars": (0, 1, "vars() takes at most 1 argument"),
    "dir": (0, 1, "dir() takes at most 1 argument"),
    "type": (1, 3, "type() takes 1 or 3 arguments"),
    "min": (1, None, "min() expects at least 1 argument"),
    "max": (1, None, "max() expects at least 1 argument"),
    "zip": (0, None, "zip() accepts any number of arguments"),
    "print": (0, None, "print() accepts any number of arguments"),
}

# Universal method and attribute names that exist on object or common stdlib
UNIVERSAL_METHODS = {
    "__str__", "__repr__", "__eq__", "__ne__", "__lt__", "__le__",
    "__gt__", "__ge__", "__hash__", "__bool__", "__class__", "__doc__",
    "__dict__", "__module__", "__init__", "__new__", "__del__",
    "__getattr__", "__setattr__", "__delattr__", "__dir__",
    "__sizeof__", "__format__",
}
COMMON_SAFE_METHODS = {
    "read", "write", "close", "open", "flush", "seek", "tell", "readline",
    "readlines", "writelines", "fileno", "truncate",
    "match", "search", "findall", "finditer", "sub", "subn", "split",
    "fullmatch", "group", "groups", "groupdict", "span", "start", "end",
    "strftime", "strptime", "timestamp", "date", "time", "today",
    "now", "utcnow", "combine", "replace", "astimezone",
    "acquire", "release", "wait", "notify", "notify_all",
    "start", "join", "run", "terminate", "kill", "is_alive",
    "get", "put", "empty", "full", "qsize",
    "send", "recv", "connect", "bind", "listen", "accept",
    "encode", "decode", "dump", "dumps", "load", "loads",
    "fit", "predict", "transform", "fit_transform", "score",
    "head", "tail", "describe", "info", "value_counts", "groupby",
    "merge", "concat", "pivot", "melt", "dropna", "fillna",
    "reset_index", "set_index", "sort_values", "sort_index",
    "to_csv", "to_json", "to_dict", "to_list", "to_numpy",
    "numpy", "tensor", "cuda", "cpu", "detach", "backward",
    "forward", "parameters", "state_dict", "load_state_dict",
    "plot", "show", "savefig", "figure", "subplot", "title",
    "xlabel", "ylabel", "legend", "grid",
    "reshape", "flatten", "transpose", "dot", "sum", "mean",
    "std", "var", "max", "min", "argmax", "argmin", "clip",
}

ALL_SAFE_METHOD_NAMES = (
    set(BUILTIN_METHOD_SPECS["str"].keys()) |
    set(BUILTIN_METHOD_SPECS["dict"].keys()) |
    set(BUILTIN_METHOD_SPECS["list"].keys()) |
    set(BUILTIN_METHOD_SPECS["set"].keys()) |
    set(BUILTIN_METHOD_SPECS["tuple"].keys()) |
    UNIVERSAL_METHODS | COMMON_SAFE_METHODS
)


def _extract_target_names(node):
    """Recursively unpack all variable names from any assignment/loop target."""
    names = []
    if node is None:
        return names
    if isinstance(node, ast.Name):
        names.append(node.id)
    elif isinstance(node, (ast.Tuple, ast.List)):
        for elt in node.elts:
            names.extend(_extract_target_names(elt))
    elif isinstance(node, ast.Starred):
        names.extend(_extract_target_names(node.value))
    return names


def analyze_python_code(code: str, filename: str = "script.py"):
    issues = []
    lines = code.split("\n")
    total_lines = len(lines)

    def get_line_safe(ln):
        if 1 <= ln <= total_lines:
            return lines[ln - 1]
        return ""

    def is_comment_line(raw_line: str) -> bool:
        return raw_line.strip().startswith("#")

    def strip_inline_comment(text: str) -> str:
        in_str = False
        quote_char = None
        i = 0
        while i < len(text):
            c = text[i]
            if not in_str:
                if c in ('"', "'"):
                    if text[i:i+3] in ('"""', "'''"):
                        quote_char = text[i:i+3]
                        in_str = True
                        i += 3
                        continue
                    else:
                        quote_char = c
                        in_str = True
                elif c == '#':
                    return text[:i]
            else:
                if isinstance(quote_char, str) and len(quote_char) == 3:
                    if text[i:i+3] == quote_char:
                        in_str = False
                        quote_char = None
                        i += 3
                        continue
                elif c == quote_char and (i == 0 or text[i-1] != '\\'):
                    in_str = False
                    quote_char = None
            i += 1
        return text

    # =========================================================================
    # PASS 1: Token, Syntax, Indentation & Formatting Checks
    # =========================================================================

    # 1.1 Extra Colons (::)
    for idx, raw_line in enumerate(lines):
        line_num = idx + 1
        if is_comment_line(raw_line):
            continue
        trimmed = strip_inline_comment(raw_line).strip()
        if not trimmed:
            continue
        if re.search(r'::+\s*$', trimmed):
            start_col = raw_line.rfind("::")
            issues.append({
                "line": line_num,
                "startChar": start_col,
                "endChar": len(raw_line.rstrip()),
                "severity": "error",
                "errorName": "Extra Colon (::)",
                "whatHappened": "You typed two colons (::) at the end of the line instead of one.",
                "whyHappened": "Python syntax requires a single colon (:) to define blocks. Double colons cause a SyntaxError.",
                "howToFix": "Remove the extra colon so only one ':' remains.",
                "whyFixCorrect": "Single colon is the valid Python syntax for block headers.",
                "sideEffects": "None. The statement will parse cleanly.",
                "correctedCode": re.sub(r'\s*::+\s*$', ':', raw_line.rstrip()),
                "replacementCode": re.sub(r'\s*::+\s*$', ':', raw_line.rstrip())
            })

    # 1.2 Missing Colons on block statements
    for idx, raw_line in enumerate(lines):
        line_num = idx + 1
        if is_comment_line(raw_line):
            continue
        trimmed_nc = strip_inline_comment(raw_line).strip()
        if not trimmed_nc:
            continue
        kw_match = re.match(r'^(def|class|if|elif|else|for|while|try|except|finally|with)\b', trimmed_nc)
        if kw_match:
            kw = kw_match.group(1)
            clean_part = trimmed_nc.rstrip()
            if not clean_part.endswith(":") and not clean_part.endswith("\\") and "::" not in clean_part:
                if "lambda" not in clean_part:
                    issues.append({
                        "line": line_num,
                        "startChar": len(raw_line) - len(raw_line.lstrip()),
                        "endChar": len(raw_line.rstrip()),
                        "severity": "error",
                        "errorName": f"Missing Colon after '{kw}'",
                        "whatHappened": f"You forgot to add a colon (:) after the {kw} statement.",
                        "whyHappened": "Python uses colons to indicate the start of an indented block.",
                        "howToFix": "Add a colon (:) at the end of this line.",
                        "whyFixCorrect": "A colon is required by Python grammar.",
                        "sideEffects": "None.",
                        "correctedCode": raw_line.rstrip() + ":",
                        "replacementCode": raw_line.rstrip() + ":"
                    })

    # 1.3 Assignment in condition: if x = 5:
    for idx, raw_line in enumerate(lines):
        line_num = idx + 1
        if is_comment_line(raw_line):
            continue
        trimmed_nc = strip_inline_comment(raw_line).strip()
        if not trimmed_nc:
            continue
        if re.match(r'^(?:if|elif|while)\b', trimmed_nc):
            cond_part = trimmed_nc.rstrip(": ")
            m = re.search(r'(?<![=!<>:+\-*/%&|^])=(?![=])', cond_part)
            if m:
                issues.append({
                    "line": line_num,
                    "startChar": raw_line.find("="),
                    "endChar": raw_line.find("=") + 1,
                    "severity": "error",
                    "errorName": "Assignment in Condition",
                    "whatHappened": "You used a single equals sign (=) instead of double equals (==) in a condition.",
                    "whyHappened": "'=' assigns a value, while '==' compares values. Python does not allow assignment inside 'if' conditions.",
                    "howToFix": "Change '=' to '==' to compare values.",
                    "whyFixCorrect": "'==' performs equality comparison.",
                    "sideEffects": "None.",
                    "correctedCode": raw_line.replace("=", "==", 1),
                    "replacementCode": raw_line.replace("=", "==", 1)
                })

    # 1.4 Bracket Balance
    bracket_stack = []
    pairs = {')': '(', ']': '[', '}': '{'}
    opening_brackets = {'(': ')', '[': ']', '{': '}'}

    for idx, raw_line in enumerate(lines):
        line_num = idx + 1
        clean_line = strip_inline_comment(raw_line)
        in_str = False
        quote_char = None
        i = 0
        while i < len(clean_line):
            char = clean_line[i]
            if not in_str:
                if char in ('"', "'"):
                    if clean_line[i:i+3] in ('"""', "'''"):
                        quote_char = clean_line[i:i+3]
                        in_str = True
                        i += 3
                        continue
                    else:
                        quote_char = char
                        in_str = True
                elif char in opening_brackets:
                    bracket_stack.append((char, line_num, i))
                elif char in pairs:
                    if bracket_stack and bracket_stack[-1][0] == pairs[char]:
                        bracket_stack.pop()
                    else:
                        issues.append({
                            "line": line_num,
                            "startChar": i,
                            "endChar": i + 1,
                            "severity": "error",
                            "errorName": f"Unexpected Closing Bracket '{char}'",
                            "whatHappened": f"Found closing '{char}' without matching opening bracket.",
                            "whyHappened": "Every closing bracket must have a matching opening bracket.",
                            "howToFix": f"Remove the extra '{char}' or add the matching opening bracket.",
                            "whyFixCorrect": "Proper bracket matching is required for valid syntax.",
                            "sideEffects": "None.",
                            "correctedCode": raw_line
                        })
            else:
                if isinstance(quote_char, str) and len(quote_char) == 3:
                    if clean_line[i:i+3] == quote_char:
                        in_str = False
                        quote_char = None
                        i += 3
                        continue
                elif char == quote_char and (i == 0 or clean_line[i-1] != '\\'):
                    in_str = False
                    quote_char = None
            i += 1

    for char, l_num, c_idx in bracket_stack:
        target_line = get_line_safe(l_num)
        issues.append({
            "line": l_num,
            "startChar": c_idx,
            "endChar": c_idx + 1,
            "severity": "error",
            "errorName": f"Unclosed Bracket '{char}'",
            "whatHappened": f"Opening bracket '{char}' is never closed.",
            "whyHappened": f"In Python, opening bracket '{char}' must be closed with '{opening_brackets[char]}'.",
            "howToFix": f"Add closing '{opening_brackets[char]}' before the end of the block or expression.",
            "whyFixCorrect": "Proper bracket matching is required for valid syntax.",
            "sideEffects": "None.",
            "correctedCode": target_line + opening_brackets[char],
            "replacementCode": target_line + opening_brackets[char]
        })

    # 1.5 Mixed Tabs and Spaces
    for idx, raw_line in enumerate(lines):
        line_num = idx + 1
        if not raw_line.strip() or is_comment_line(raw_line):
            continue
        indent = len(raw_line) - len(raw_line.lstrip())
        leading = raw_line[:indent]
        if "\t" in leading and " " in leading:
            issues.append({
                "line": line_num,
                "startChar": 0,
                "endChar": indent,
                "severity": "error",
                "errorName": "Mixed Tabs and Spaces (TabError)",
                "whatHappened": "This line mixes tabs and spaces for indentation.",
                "whyHappened": "Python 3 strictly disallows mixing tabs and spaces in indentation.",
                "howToFix": "Convert tabs to spaces (use 4 spaces per indent level).",
                "whyFixCorrect": "Consistent space indentation prevents TabError runtime crashes.",
                "sideEffects": "None.",
                "correctedCode": " " * indent + raw_line.lstrip(),
                "replacementCode": " " * indent + raw_line.lstrip()
            })

    # =========================================================================
    # PASS 2: Resilient AST Parsing & Deep Semantic Analysis
    # =========================================================================

    sanitized_lines = list(lines)

    for char, l_num, c_idx in bracket_stack:
        if 1 <= l_num <= len(sanitized_lines):
            sanitized_lines[l_num - 1] += opening_brackets[char]

    for idx, s_line in enumerate(sanitized_lines):
        tr = s_line.strip()
        if "::" in tr:
            sanitized_lines[idx] = s_line.replace("::", ":")
        tr2 = sanitized_lines[idx].strip()
        if re.search(r'^(?:if|elif|while)\b', tr2):
            sanitized_lines[idx] = re.sub(r'(?<![=!<>:+\-*/%&|^])=(?![=])', '==', sanitized_lines[idx])
        tr3 = sanitized_lines[idx].strip()
        for kw in ("def", "class", "if", "elif", "else", "for", "while", "try", "except", "finally", "with"):
            if (tr3 == kw or tr3.startswith(kw + " ") or tr3.startswith(kw + "(")) and not tr3.endswith(":") and not tr3.endswith("\\"):
                sanitized_lines[idx] = sanitized_lines[idx].rstrip() + ":"
                break

    parsed_tree = None
    parse_attempts = 0
    max_attempts = 20

    while parse_attempts < max_attempts:
        parse_attempts += 1
        try:
            parsed_tree = ast.parse("\n".join(sanitized_lines), filename)
            break
        except SyntaxError as e:
            err_line = e.lineno or 1
            if not any(iss["line"] == err_line and "Syntax" in iss["errorName"] for iss in issues):
                col_offset = max(0, (e.offset or 1) - 1)
                issues.append({
                    "line": err_line,
                    "startChar": col_offset,
                    "endChar": max(col_offset + 1, col_offset + 3),
                    "severity": "error",
                    "errorName": f"SyntaxError: {e.msg or 'Invalid Syntax'}",
                    "whatHappened": f"Python syntax error: {e.msg or 'invalid syntax'}.",
                    "whyHappened": "The code violates Python grammar rules at this position.",
                    "howToFix": "Correct the syntax according to Python language rules.",
                    "whyFixCorrect": "Code must conform to Python syntax rules.",
                    "sideEffects": "None.",
                    "correctedCode": get_line_safe(err_line)
                })
            if 1 <= err_line <= len(sanitized_lines):
                orig_indent = len(sanitized_lines[err_line - 1]) - len(sanitized_lines[err_line - 1].lstrip())
                sanitized_lines[err_line - 1] = (" " * orig_indent) + "pass"
            else:
                break

    if parsed_tree:
        # Pre-pass A: Function signatures (all functions defined in this file)
        function_signatures = {}
        for n in ast.walk(parsed_tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                args = n.args
                total_pos = len(args.args)
                defaults_count = len(args.defaults)
                req_pos = total_pos - defaults_count
                has_vararg = args.vararg is not None
                has_kwarg = args.kwarg is not None
                param_names = [a.arg for a in args.args]
                function_signatures[n.name] = {
                    "required": req_pos,
                    "total": total_pos,
                    "has_vararg": has_vararg,
                    "has_kwarg": has_kwarg,
                    "params": param_names,
                    "line": n.lineno
                }

        # Pre-pass B: Class definitions & method signatures
        class_methods = {}
        for n in ast.walk(parsed_tree):
            if isinstance(n, ast.ClassDef):
                class_methods[n.name] = {}
                for item in n.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        args = item.args
                        total_pos = len(args.args)
                        defaults_count = len(args.defaults)
                        req_pos = total_pos - defaults_count
                        has_vararg = args.vararg is not None
                        has_kwarg = args.kwarg is not None
                        param_names = [a.arg for a in args.args]
                        class_methods[n.name][item.name] = {
                            "required": req_pos,
                            "total": total_pos,
                            "has_vararg": has_vararg,
                            "has_kwarg": has_kwarg,
                            "params": param_names,
                            "line": item.lineno
                        }

        # Pre-pass C: List literal sizes (variable_name -> length)
        list_literal_sizes = {}
        for n in ast.walk(parsed_tree):
            if isinstance(n, ast.Assign):
                if isinstance(n.value, ast.List):
                    for target in n.targets:
                        if isinstance(target, ast.Name):
                            list_literal_sizes[target.id] = len(n.value.elts)
                elif isinstance(n.value, ast.Constant) and isinstance(n.value.value, str):
                    for target in n.targets:
                        if isinstance(target, ast.Name):
                            list_literal_sizes[target.id] = len(n.value.value)

        # Pre-pass D: Dict keys per variable
        dict_var_keys = {}
        for n in ast.walk(parsed_tree):
            if isinstance(n, ast.Assign) and isinstance(n.value, ast.Dict):
                for target in n.targets:
                    if isinstance(target, ast.Name):
                        keys_set = set()
                        for k in n.value.keys:
                            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                                keys_set.add(k.value)
                        dict_var_keys[target.id] = keys_set

        # Pre-pass E: All module-level assigned names (visible to all functions in this file)
        module_assigned_names = set()
        for stmt in getattr(parsed_tree, "body", []):
            if isinstance(stmt, ast.Assign):
                for t in stmt.targets:
                    module_assigned_names.update(_extract_target_names(t))
            elif isinstance(stmt, (ast.AugAssign, ast.AnnAssign)):
                module_assigned_names.update(_extract_target_names(stmt.target))
            elif isinstance(stmt, ast.Import):
                for alias in stmt.names:
                    module_assigned_names.add(alias.asname or alias.name.split(".")[0])
            elif isinstance(stmt, ast.ImportFrom):
                for alias in stmt.names:
                    module_assigned_names.add(alias.asname or alias.name)

        # Main Semantic Visitor
        class DeepSemanticVisitor(ast.NodeVisitor):
            def __init__(self):
                self.scopes = [{
                    "assigned": set(module_assigned_names),
                    "types": {},
                    "calls": set(),
                    "globals": set()
                }]
                self.defined_funcs = set(function_signatures.keys())
                self.defined_classes = set(class_methods.keys())
                self.imported_names = set()
                self.called_funcs = set()
                self.builtin_names = set(STANDARD_BUILTINS)

            def _is_defined(self, name, node=None):
                for scope in reversed(self.scopes):
                    if name in scope["assigned"] or name in scope["globals"]:
                        return True
                if name in self.builtin_names:
                    return True
                if name in self.imported_names:
                    return True
                if name in self.defined_classes:
                    return True
                if len(self.scopes) > 1:
                    # Inside function/class: all functions & module globals defined in this file are in scope
                    if name in self.defined_funcs or name in module_assigned_names:
                        return True
                else:
                    # At module level: function must be defined at or before this line
                    if name in function_signatures:
                        func_line = function_signatures[name].get("line", 0)
                        if node and node.lineno >= func_line:
                            return True
                    if name in class_methods:
                        return True
                return False

            def _infer_type(self, name):
                for sc in reversed(self.scopes):
                    if name in sc.get("types", {}):
                        return sc["types"][name]
                return None

            def _record_type(self, name, t):
                if t:
                    self.scopes[-1].setdefault("types", {})[name] = t

            def infer_node_type(self, node):
                if node is None:
                    return None
                if isinstance(node, ast.Constant):
                    if isinstance(node.value, str):
                        return "str"
                    if isinstance(node.value, bool):
                        return "bool"
                    if isinstance(node.value, int):
                        return "int"
                    if isinstance(node.value, float):
                        return "float"
                    if isinstance(node.value, bytes):
                        return "bytes"
                    return None
                if isinstance(node, (ast.List, ast.ListComp)):
                    return "list"
                if isinstance(node, (ast.Dict, ast.DictComp)):
                    return "dict"
                if isinstance(node, (ast.Set, ast.SetComp)):
                    return "set"
                if isinstance(node, ast.Tuple):
                    return "tuple"
                if isinstance(node, ast.JoinedStr):
                    return "str"
                if isinstance(node, (ast.Compare, ast.UnaryOp, ast.BoolOp)):
                    return "bool"
                if isinstance(node, ast.Name):
                    return self._infer_type(node.id)

                if isinstance(node, ast.Call):
                    if isinstance(node.func, ast.Name):
                        fn = node.func.id
                        if fn in ("str", "repr", "ascii", "chr", "bin", "oct", "hex"):
                            return "str"
                        if fn in ("int", "round", "abs", "len", "ord", "id", "hash"):
                            return "int"
                        if fn in ("float",):
                            return "float"
                        if fn in ("bool", "isinstance", "issubclass", "hasattr"):
                            return "bool"
                        if fn in ("list",):
                            return "list"
                        if fn in ("dict",):
                            return "dict"
                        if fn in ("set",):
                            return "set"
                        if fn in ("tuple",):
                            return "tuple"
                        if fn in ("bytes", "bytearray"):
                            return "bytes"
                        if fn in self.defined_classes:
                            return fn

                    if isinstance(node.func, ast.Attribute):
                        attr = node.func.attr
                        if attr in ("upper", "lower", "strip", "lstrip", "rstrip", "capitalize",
                                    "title", "swapcase", "casefold", "replace", "join",
                                    "center", "ljust", "rjust", "zfill", "format"):
                            return "str"
                        if attr in ("split", "rsplit", "splitlines"):
                            return "list"
                        if attr in ("startswith", "endswith", "isalnum", "isalpha", "isascii",
                                    "isdecimal", "isdigit", "isidentifier", "islower", "isnumeric",
                                    "isprintable", "isspace", "istitle", "isupper"):
                            return "bool"
                        if attr in ("find", "rfind", "index", "rindex", "count"):
                            return "int"
                        if attr in ("keys", "values", "items"):
                            return "list"
                        if attr in ("copy",):
                            return self.infer_node_type(node.func.value)

                if isinstance(node, ast.BinOp):
                    lt = self.infer_node_type(node.left)
                    rt = self.infer_node_type(node.right)
                    if isinstance(node.op, ast.Add):
                        if lt == "str" and rt == "str":
                            return "str"
                        if lt == "list" and rt == "list":
                            return "list"
                        if lt in ("int", "float") and rt in ("int", "float"):
                            return "float" if (lt == "float" or rt == "float") else "int"
                    elif isinstance(node.op, (ast.Sub, ast.Mult, ast.FloorDiv, ast.Mod, ast.Pow)):
                        if lt in ("int", "float") and rt in ("int", "float"):
                            return "float" if (lt == "float" or rt == "float") else "int"
                    elif isinstance(node.op, ast.Div):
                        if lt in ("int", "float") and rt in ("int", "float"):
                            return "float"

                return None

            # Imports
            def visit_Import(self, node):
                for alias in node.names:
                    name = alias.asname or alias.name.split(".")[0]
                    self.imported_names.add(name)
                    self.scopes[-1]["assigned"].add(name)
                self.generic_visit(node)

            def visit_ImportFrom(self, node):
                for alias in node.names:
                    if alias.name == "*":
                        continue
                    name = alias.asname or alias.name
                    self.imported_names.add(name)
                    self.scopes[-1]["assigned"].add(name)
                self.generic_visit(node)

            # Function / Class definitions
            def visit_FunctionDef(self, node):
                self.defined_funcs.add(node.name)
                self.scopes[-1]["assigned"].add(node.name)
                func_scope = {"assigned": set(), "types": {}, "calls": set(), "globals": set()}
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

            visit_AsyncFunctionDef = visit_FunctionDef

            def visit_ClassDef(self, node):
                self.defined_classes.add(node.name)
                self.scopes[-1]["assigned"].add(node.name)
                class_scope = {"assigned": set(), "types": {}, "calls": set(), "globals": set()}
                self.scopes.append(class_scope)
                self.generic_visit(node)
                self.scopes.pop()

            # Comprehensions (create dedicated local scope)
            def visit_ListComp(self, node):
                comp_scope = {"assigned": set(), "types": {}, "calls": set(), "globals": set()}
                for gen in node.generators:
                    self.visit(gen.iter)
                    for tname in _extract_target_names(gen.target):
                        comp_scope["assigned"].add(tname)
                    for if_c in gen.ifs:
                        self.scopes.append(comp_scope)
                        self.visit(if_c)
                        self.scopes.pop()
                self.scopes.append(comp_scope)
                self.visit(node.elt)
                self.scopes.pop()

            visit_SetComp = visit_ListComp
            visit_GeneratorExp = visit_ListComp

            def visit_DictComp(self, node):
                comp_scope = {"assigned": set(), "types": {}, "calls": set(), "globals": set()}
                for gen in node.generators:
                    self.visit(gen.iter)
                    for tname in _extract_target_names(gen.target):
                        comp_scope["assigned"].add(tname)
                    for if_c in gen.ifs:
                        self.scopes.append(comp_scope)
                        self.visit(if_c)
                        self.scopes.pop()
                self.scopes.append(comp_scope)
                self.visit(node.key)
                self.visit(node.value)
                self.scopes.pop()

            # Lambdas (create dedicated parameter scope)
            def visit_Lambda(self, node):
                lambda_scope = {"assigned": set(), "types": {}, "calls": set(), "globals": set()}
                for a in node.args.args:
                    lambda_scope["assigned"].add(a.arg)
                for a in node.args.kwonlyargs:
                    lambda_scope["assigned"].add(a.arg)
                if node.args.vararg:
                    lambda_scope["assigned"].add(node.args.vararg.arg)
                if node.args.kwarg:
                    lambda_scope["assigned"].add(node.args.kwarg.arg)
                self.scopes.append(lambda_scope)
                self.visit(node.body)
                self.scopes.pop()

            # Walrus operator (:=)
            def visit_NamedExpr(self, node):
                self.visit(node.value)
                if isinstance(node.target, ast.Name):
                    self.scopes[-1]["assigned"].add(node.target.id)

            # Assignments with recursive target unpacking
            def visit_Assign(self, node):
                self.visit(node.value)
                inferred = self.infer_node_type(node.value)
                for target in node.targets:
                    for name in _extract_target_names(target):
                        self.scopes[-1]["assigned"].add(name)
                        if inferred:
                            self._record_type(name, inferred)

            def visit_AugAssign(self, node):
                for name in _extract_target_names(node.target):
                    self.scopes[-1]["assigned"].add(name)
                self.visit(node.value)

            def visit_AnnAssign(self, node):
                if node.value:
                    self.visit(node.value)
                for name in _extract_target_names(node.target):
                    self.scopes[-1]["assigned"].add(name)
                    if isinstance(node.annotation, ast.Name):
                        ann = node.annotation.id.lower()
                        if ann in BUILTIN_METHOD_SPECS or ann in self.defined_classes:
                            self._record_type(name, ann)

            def visit_For(self, node):
                self.visit(node.iter)
                for name in _extract_target_names(node.target):
                    self.scopes[-1]["assigned"].add(name)
                for stmt in node.body:
                    self.visit(stmt)
                for stmt in node.orelse:
                    self.visit(stmt)

            visit_AsyncFor = visit_For

            def visit_With(self, node):
                for item in node.items:
                    self.visit(item.context_expr)
                    if item.optional_vars:
                        for name in _extract_target_names(item.optional_vars):
                            self.scopes[-1]["assigned"].add(name)
                for stmt in node.body:
                    self.visit(stmt)

            visit_AsyncWith = visit_With

            def visit_Global(self, node):
                for name in node.names:
                    self.scopes[-1]["globals"].add(name)

            # BinOp: division-by-zero & type mismatch
            def visit_BinOp(self, node):
                if isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
                    if isinstance(node.right, ast.Constant) and node.right.value == 0:
                        target_line = get_line_safe(node.lineno)
                        issues.append({
                            "line": node.lineno,
                            "startChar": node.col_offset,
                            "endChar": node.end_col_offset or (node.col_offset + 5),
                            "severity": "error",
                            "errorName": "Division by Zero (ZeroDivisionError)",
                            "whatHappened": "You are dividing a number directly by zero.",
                            "whyHappened": "In Python and mathematics, division by zero is undefined and immediately crashes with ZeroDivisionError.",
                            "howToFix": "Replace 0 with a non-zero divisor, or check that the divisor is not zero before dividing.",
                            "whyFixCorrect": "Using a non-zero divisor prevents the ZeroDivisionError crash.",
                            "sideEffects": "Check dependent calculations.",
                            "correctedCode": target_line.replace("/ 0", "/ 1"),
                            "replacementCode": target_line.replace("/ 0", "/ 1")
                        })

                if isinstance(node.op, ast.Add):
                    lt = self.infer_node_type(node.left)
                    rt = self.infer_node_type(node.right)
                    if (lt == "str" and rt in ("int", "float")) or (lt in ("int", "float") and rt == "str"):
                        target_line = get_line_safe(node.lineno)
                        issues.append({
                            "line": node.lineno,
                            "startChar": node.col_offset,
                            "endChar": node.end_col_offset or (node.col_offset + 7),
                            "severity": "error",
                            "errorName": "Type Error: Unsupported Operand Types (str + int)",
                            "whatHappened": "You are trying to add a string and a number together directly.",
                            "whyHappened": "In Python, '+' between str and int raises TypeError: can only concatenate str (not int) to str.",
                            "howToFix": "Convert the string to int with int(), or the number to str with str().",
                            "whyFixCorrect": "Explicit type conversion ensures both operands share compatible types.",
                            "sideEffects": "Verify input string format.",
                            "correctedCode": target_line
                        })

                self.generic_visit(node)

            # Calls: Functions, Methods, and Built-ins
            def visit_Call(self, node):
                has_star_unpack = any(isinstance(a, ast.Starred) for a in node.args)
                has_dstar_unpack = any(kw.arg is None for kw in node.keywords)

                # Case 1: Plain function call  func(...)
                if isinstance(node.func, ast.Name):
                    fn_name = node.func.id
                    self.called_funcs.add((fn_name, node.lineno))

                    # 1.A Undefined function check
                    if not self._is_defined(fn_name, node):
                        target_line = get_line_safe(node.lineno)
                        issues.append({
                            "line": node.lineno,
                            "startChar": node.func.col_offset,
                            "endChar": node.func.end_col_offset or (node.func.col_offset + len(fn_name)),
                            "severity": "error",
                            "errorName": f"Calling Undefined Function '{fn_name}' (NameError)",
                            "whatHappened": f"You called '{fn_name}()', but this function was never defined or imported.",
                            "whyHappened": f"Python cannot execute a function that has not been defined in scope. It raises NameError: name '{fn_name}' is not defined.",
                            "howToFix": f"Define 'def {fn_name}():' or import it from the module where it is implemented.",
                            "whyFixCorrect": "Declaring the function gives Python the bytecode instructions needed to execute it.",
                            "sideEffects": "Check for function name spelling mistakes.",
                            "correctedCode": f"def {fn_name}():\n    pass\n\n{target_line}"
                        })

                    # 1.B Same-file user function argument count validation
                    elif fn_name in function_signatures and not has_star_unpack and not has_dstar_unpack:
                        sig = function_signatures[fn_name]
                        if not sig["has_vararg"]:
                            given_pos = len(node.args)
                            given_kw = {kw.arg for kw in node.keywords if kw.arg}
                            total_supplied = given_pos + len(given_kw)
                            if total_supplied < sig["required"]:
                                target_line = get_line_safe(node.lineno)
                                missing_params = sig["params"][total_supplied:sig["required"]]
                                issues.append({
                                    "line": node.lineno,
                                    "startChar": node.func.col_offset,
                                    "endChar": node.func.end_col_offset or (node.func.col_offset + len(fn_name)),
                                    "severity": "error",
                                    "errorName": f"Wrong Number of Arguments: '{fn_name}()' (TypeError)",
                                    "whatHappened": f"You called '{fn_name}()' with {total_supplied} argument(s), but it requires {sig['required']} argument(s): ({', '.join(sig['params'][:sig['required']])}).",
                                    "whyHappened": "Python raises TypeError at runtime when a function does not receive all its required arguments.",
                                    "howToFix": f"Add the missing argument(s): {', '.join(missing_params)}. Call should look like: {fn_name}({', '.join(sig['params'])}).",
                                    "whyFixCorrect": "Providing all required arguments satisfies the function's contract and prevents TypeError.",
                                    "sideEffects": "Check the function definition to understand what each argument expects.",
                                    "correctedCode": target_line,
                                    "replacementCode": target_line
                                })
                            elif not sig["has_kwarg"] and total_supplied > sig["total"]:
                                target_line = get_line_safe(node.lineno)
                                issues.append({
                                    "line": node.lineno,
                                    "startChar": node.func.col_offset,
                                    "endChar": node.func.end_col_offset or (node.func.col_offset + len(fn_name)),
                                    "severity": "error",
                                    "errorName": f"Too Many Arguments: '{fn_name}()' (TypeError)",
                                    "whatHappened": f"You called '{fn_name}()' with {total_supplied} argument(s), but it only accepts {sig['total']}.",
                                    "whyHappened": "Python raises TypeError at runtime when too many arguments are passed to a function.",
                                    "howToFix": f"Remove the extra argument(s). The function signature is: {fn_name}({', '.join(sig['params'])}).",
                                    "whyFixCorrect": "Matching the number of arguments to the function signature prevents TypeError.",
                                    "sideEffects": "None.",
                                    "correctedCode": target_line
                                })

                    # 1.C Built-in function argument count validation
                    elif fn_name in BUILTIN_FUNC_SPECS and not has_star_unpack and not has_dstar_unpack:
                        min_a, max_a, desc = BUILTIN_FUNC_SPECS[fn_name]
                        supplied = len(node.args)
                        if supplied < min_a:
                            target_line = get_line_safe(node.lineno)
                            issues.append({
                                "line": node.lineno,
                                "startChar": node.func.col_offset,
                                "endChar": node.func.end_col_offset or (node.func.col_offset + len(fn_name)),
                                "severity": "error",
                                "errorName": f"Wrong Number of Arguments: '{fn_name}()' (TypeError)",
                                "whatHappened": f"You called '{fn_name}()' with {supplied} argument(s), but {desc}.",
                                "whyHappened": f"Python raises TypeError at runtime when '{fn_name}()' does not receive enough arguments.",
                                "howToFix": f"Provide the required arguments to '{fn_name}()'.",
                                "whyFixCorrect": "Meeting the argument requirements satisfies Python's built-in function signature.",
                                "sideEffects": "None.",
                                "correctedCode": target_line
                            })
                        elif max_a is not None and supplied > max_a:
                            target_line = get_line_safe(node.lineno)
                            issues.append({
                                "line": node.lineno,
                                "startChar": node.func.col_offset,
                                "endChar": node.func.end_col_offset or (node.func.col_offset + len(fn_name)),
                                "severity": "error",
                                "errorName": f"Too Many Arguments: '{fn_name}()' (TypeError)",
                                "whatHappened": f"You called '{fn_name}()' with {supplied} argument(s), but {desc}.",
                                "whyHappened": f"Python raises TypeError at runtime when too many arguments are passed to '{fn_name}()'.",
                                "howToFix": f"Remove the extra argument(s) from '{fn_name}()'.",
                                "whyFixCorrect": "Matching the expected argument count prevents TypeError crashes.",
                                "sideEffects": "None.",
                                "correctedCode": target_line
                            })

                    # 1.D User class instantiation __init__ argument validation
                    elif fn_name in class_methods and "__init__" in class_methods[fn_name] and not has_star_unpack and not has_dstar_unpack:
                        init_sig = class_methods[fn_name]["__init__"]
                        eff_req = max(0, init_sig["required"] - 1)
                        eff_tot = max(0, init_sig["total"] - 1)
                        given_pos = len(node.args)
                        given_kw = {kw.arg for kw in node.keywords if kw.arg}
                        total_supplied = given_pos + len(given_kw)
                        if total_supplied < eff_req:
                            target_line = get_line_safe(node.lineno)
                            missing_params = init_sig["params"][1 + total_supplied:1 + eff_req]
                            issues.append({
                                "line": node.lineno,
                                "startChar": node.func.col_offset,
                                "endChar": node.func.end_col_offset or (node.func.col_offset + len(fn_name)),
                                "severity": "error",
                                "errorName": f"Wrong Number of Arguments: '{fn_name}()' (TypeError)",
                                "whatHappened": f"You instantiated '{fn_name}()' with {total_supplied} argument(s), but its __init__ requires {eff_req} argument(s): ({', '.join(init_sig['params'][1:1+eff_req])}).",
                                "whyHappened": "Python raises TypeError when class constructor parameters are missing.",
                                "howToFix": f"Pass the required arguments: {', '.join(missing_params)}.",
                                "whyFixCorrect": "Supplying all required constructor arguments satisfies class initialization.",
                                "sideEffects": "None.",
                                "correctedCode": target_line
                            })
                        elif not init_sig["has_vararg"] and not init_sig["has_kwarg"] and total_supplied > eff_tot:
                            target_line = get_line_safe(node.lineno)
                            issues.append({
                                "line": node.lineno,
                                "startChar": node.func.col_offset,
                                "endChar": node.func.end_col_offset or (node.func.col_offset + len(fn_name)),
                                "severity": "error",
                                "errorName": f"Too Many Arguments: '{fn_name}()' (TypeError)",
                                "whatHappened": f"You instantiated '{fn_name}()' with {total_supplied} argument(s), but it accepts at most {eff_tot}.",
                                "whyHappened": "Python raises TypeError when too many arguments are passed to a class constructor.",
                                "howToFix": f"Remove extra argument(s). Expected: {fn_name}({', '.join(init_sig['params'][1:])}).",
                                "whyFixCorrect": "Matching constructor parameters prevents TypeError crashes.",
                                "sideEffects": "None.",
                                "correctedCode": target_line
                            })

                # Case 2: Method call  obj.method(...)
                elif isinstance(node.func, ast.Attribute):
                    method_name = node.func.attr
                    obj_node = node.func.value
                    obj_type = self.infer_node_type(obj_node)

                    # 2.A Built-in Type Method Argument Count Validation
                    if obj_type in BUILTIN_METHOD_SPECS and method_name in BUILTIN_METHOD_SPECS[obj_type] and not has_star_unpack and not has_dstar_unpack:
                        min_a, max_a, desc = BUILTIN_METHOD_SPECS[obj_type][method_name]
                        supplied = len(node.args)
                        if supplied < min_a:
                            target_line = get_line_safe(node.lineno)
                            issues.append({
                                "line": node.lineno,
                                "startChar": node.func.col_offset,
                                "endChar": node.func.end_col_offset or (node.func.col_offset + len(method_name)),
                                "severity": "error",
                                "errorName": f"Wrong Number of Arguments: '{obj_type}.{method_name}()' (TypeError)",
                                "whatHappened": f"You called '{obj_type}.{method_name}()' with {supplied} argument(s), but {desc}.",
                                "whyHappened": f"Python raises TypeError at runtime when '{obj_type}.{method_name}()' does not receive enough arguments.",
                                "howToFix": f"Provide the required arguments according to {desc}.",
                                "whyFixCorrect": "Meeting the argument requirements satisfies Python's built-in method signature.",
                                "sideEffects": "None.",
                                "correctedCode": target_line
                            })
                        elif max_a is not None and supplied > max_a:
                            target_line = get_line_safe(node.lineno)
                            issues.append({
                                "line": node.lineno,
                                "startChar": node.func.col_offset,
                                "endChar": node.func.end_col_offset or (node.func.col_offset + len(method_name)),
                                "severity": "error",
                                "errorName": f"Too Many Arguments: '{obj_type}.{method_name}()' (TypeError)",
                                "whatHappened": f"You called '{obj_type}.{method_name}()' with {supplied} argument(s), but {desc}.",
                                "whyHappened": f"Python raises TypeError at runtime when arguments are passed to a method that accepts fewer or no arguments.",
                                "howToFix": f"Remove the extra argument(s). For example: {obj_type}.{method_name}() takes {max_a} argument(s).",
                                "whyFixCorrect": "Matching the expected argument count prevents TypeError crashes.",
                                "sideEffects": "Check whether you intended to pass the argument to another function.",
                                "correctedCode": target_line
                            })

                    # 2.A.2 Built-in Type Invalid Method Call (AttributeError)
                    elif obj_type in BUILTIN_METHOD_SPECS and method_name not in BUILTIN_METHOD_SPECS[obj_type] and not method_name.startswith('__'):
                        import difflib
                        target_line = get_line_safe(node.lineno)
                        matches = difflib.get_close_matches(method_name, BUILTIN_METHOD_SPECS[obj_type].keys(), n=1, cutoff=0.55)
                        suggestion = matches[0] if matches else None
                        
                        fix_text = f"Did you mean '{obj_type}.{suggestion}()'?" if suggestion else f"Check Python documentation for available '{obj_type}' methods."
                        corrected = target_line.replace(f".{method_name}(", f".{suggestion}(") if suggestion else target_line
                        
                        issues.append({
                            "line": node.lineno,
                            "startChar": node.func.col_offset,
                            "endChar": node.func.end_col_offset or (node.func.col_offset + len(method_name)),
                            "severity": "error",
                            "errorName": f"AttributeError: '{obj_type}' object has no attribute '{method_name}'",
                            "whatHappened": f"'{obj_type}' objects do not have a '{method_name}' method or attribute.",
                            "whyHappened": f"Python built-in type '{obj_type}' does not define '{method_name}'. Calling it raises an AttributeError at runtime.",
                            "howToFix": fix_text,
                            "whyFixCorrect": f"Using valid '{obj_type}' methods avoids AttributeError exceptions.",
                            "sideEffects": "Ensure the replacement method has the intended behavior.",
                            "correctedCode": corrected,
                            "replacementCode": corrected if suggestion else None
                        })

                    # 2.B User Class Instance Method Argument Validation
                    elif obj_type in class_methods and not has_star_unpack and not has_dstar_unpack:
                        methods = class_methods[obj_type]
                        if method_name in methods:
                            m_sig = methods[method_name]
                            eff_req = max(0, m_sig["required"] - 1)
                            eff_tot = max(0, m_sig["total"] - 1)
                            given_pos = len(node.args)
                            given_kw = {kw.arg for kw in node.keywords if kw.arg}
                            total_supplied = given_pos + len(given_kw)
                            if total_supplied < eff_req:
                                target_line = get_line_safe(node.lineno)
                                missing_params = m_sig["params"][1 + total_supplied:1 + eff_req]
                                issues.append({
                                    "line": node.lineno,
                                    "startChar": node.func.col_offset,
                                    "endChar": node.func.end_col_offset or (node.func.col_offset + len(method_name)),
                                    "severity": "error",
                                    "errorName": f"Wrong Number of Arguments: '{obj_type}.{method_name}()' (TypeError)",
                                    "whatHappened": f"You called '{obj_type}.{method_name}()' with {total_supplied} argument(s), but it requires {eff_req} argument(s): ({', '.join(m_sig['params'][1:1+eff_req])}).",
                                    "whyHappened": "Python raises TypeError when required method arguments are missing.",
                                    "howToFix": f"Add the missing argument(s): {', '.join(missing_params)}.",
                                    "whyFixCorrect": "Passing all required parameters satisfies the method's signature.",
                                    "sideEffects": "None.",
                                    "correctedCode": target_line
                                })
                            elif not m_sig["has_vararg"] and not m_sig["has_kwarg"] and total_supplied > eff_tot:
                                target_line = get_line_safe(node.lineno)
                                issues.append({
                                    "line": node.lineno,
                                    "startChar": node.func.col_offset,
                                    "endChar": node.func.end_col_offset or (node.func.col_offset + len(method_name)),
                                    "severity": "error",
                                    "errorName": f"Too Many Arguments: '{obj_type}.{method_name}()' (TypeError)",
                                    "whatHappened": f"You called '{obj_type}.{method_name}()' with {total_supplied} argument(s), but it accepts at most {eff_tot}.",
                                    "whyHappened": "Python raises TypeError when too many arguments are passed to an instance method.",
                                    "howToFix": f"Remove extra argument(s). Expected: {method_name}({', '.join(m_sig['params'][1:])}).",
                                    "whyFixCorrect": "Matching method parameters prevents TypeError crashes.",
                                    "sideEffects": "None.",
                                    "correctedCode": target_line
                                })
                        elif method_name not in UNIVERSAL_METHODS and method_name not in ALL_SAFE_METHOD_NAMES:
                            target_line = get_line_safe(node.lineno)
                            issues.append({
                                "line": node.lineno,
                                "startChar": node.func.col_offset,
                                "endChar": node.func.end_col_offset or (node.func.col_offset + len(method_name)),
                                "severity": "error",
                                "errorName": f"AttributeError: '{obj_type}' object has no attribute '{method_name}'",
                                "whatHappened": f"You called '{obj_type}.{method_name}()', but class '{obj_type}' does not define a method named '{method_name}'.",
                                "whyHappened": "Python raises AttributeError when you call a method that does not exist on the class.",
                                "howToFix": f"Define 'def {method_name}(self):' in class '{obj_type}', or fix the spelling.",
                                "whyFixCorrect": "Declaring the method on the class satisfies attribute resolution.",
                                "sideEffects": "None.",
                                "correctedCode": target_line
                            })

                # Security: eval() and exec()
                if isinstance(node.func, ast.Name) and node.func.id in ("eval", "exec"):
                    target_line = get_line_safe(node.lineno)
                    issues.append({
                        "line": node.lineno,
                        "startChar": node.func.col_offset,
                        "endChar": node.func.end_col_offset or (node.func.col_offset + len(node.func.id)),
                        "severity": "warning",
                        "errorName": f"Security Vulnerability: Arbitrary Code Execution via '{node.func.id}()'",
                        "whatHappened": f"Calling '{node.func.id}()' enables dynamic, arbitrary code execution.",
                        "whyHappened": f"'{node.func.id}()' parses and executes untrusted strings directly as code, leading to Remote Code Execution (RCE).",
                        "howToFix": "Use ast.literal_eval() for safe data parsing, or replace with static logic.",
                        "whyFixCorrect": "ast.literal_eval() parses Python literals without executing arbitrary code.",
                        "sideEffects": "Input must be valid Python literals.",
                        "correctedCode": target_line.replace(f"{node.func.id}(", "ast.literal_eval(")
                    })

                self.generic_visit(node)

            # Name: undefined variable
            def visit_Name(self, node):
                if isinstance(node.ctx, ast.Load):
                    name = node.id
                    if (name, node.lineno) in self.called_funcs:
                        return
                    if not self._is_defined(name, node):
                        target_line = get_line_safe(node.lineno)
                        issues.append({
                            "line": node.lineno,
                            "startChar": node.col_offset,
                            "endChar": node.end_col_offset or (node.col_offset + len(name)),
                            "severity": "error",
                            "errorName": f"Undefined Variable '{name}' (NameError)",
                            "whatHappened": f"Variable '{name}' is used before it is defined or assigned in this scope.",
                            "whyHappened": f"In Python, variables must be created and given a value before they can be used. Python raises NameError when '{name}' is not found.",
                            "howToFix": f"Define and assign '{name}' before this line. For example: {name} = <value>",
                            "whyFixCorrect": "Assigning the variable places it in scope for subsequent evaluation.",
                            "sideEffects": "Ensure the variable type matches what the code expects.",
                            "correctedCode": f"{name} = None  # TODO: replace with actual value\n{target_line}"
                        })
                self.generic_visit(node)

            # Subscript: index-out-of-range & dict key validation
            def visit_Subscript(self, node):
                target_line = get_line_safe(node.lineno)

                if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
                    key_val = node.slice.value
                    subscript_var = None
                    if isinstance(node.value, ast.Name):
                        subscript_var = node.value.id

                    line_text = get_line_safe(node.lineno)
                    is_membership_guarded = bool(
                        re.search(rf'["\']{re.escape(key_val)}["\']\s+in\s+{re.escape(subscript_var or "")}', line_text)
                    )

                    if not is_membership_guarded and subscript_var and subscript_var in dict_var_keys:
                        known_keys = dict_var_keys[subscript_var]
                        if known_keys and key_val not in known_keys:
                            matching_case = next(
                                (k for k in known_keys if k.lower() == key_val.lower()), None
                            )
                            if matching_case:
                                issues.append({
                                    "line": node.lineno,
                                    "startChar": node.slice.col_offset,
                                    "endChar": node.slice.end_col_offset or (node.slice.col_offset + len(key_val) + 2),
                                    "severity": "error",
                                    "errorName": f"Incorrect Dictionary Key '{key_val}' (KeyError – Case Mismatch)",
                                    "whatHappened": f"You accessed key '{key_val}', but the dictionary defines '{matching_case}' (different case).",
                                    "whyHappened": f"Python dictionary keys are case-sensitive. '{key_val}' and '{matching_case}' are treated as different keys.",
                                    "howToFix": f"Change [\"{key_val}\"] to [\"{matching_case}\"].",
                                    "whyFixCorrect": f"Using the exact case '{matching_case}' matches the key defined in the dictionary.",
                                    "sideEffects": "None.",
                                    "correctedCode": target_line.replace(f'"{key_val}"', f'"{matching_case}"').replace(f"'{key_val}'", f"'{matching_case}'"),
                                    "replacementCode": target_line.replace(f'"{key_val}"', f'"{matching_case}"').replace(f"'{key_val}'", f"'{matching_case}'")
                                })
                            else:
                                known = "', '".join(sorted(known_keys))
                                issues.append({
                                    "line": node.lineno,
                                    "startChar": node.slice.col_offset,
                                    "endChar": node.slice.end_col_offset or (node.slice.col_offset + len(key_val) + 2),
                                    "severity": "error",
                                    "errorName": f"Possible KeyError: Key '{key_val}' Not in Dictionary '{subscript_var}'",
                                    "whatHappened": f"You accessed '{subscript_var}[\"{key_val}\"]', but '{subscript_var}' was defined with keys: '{known}'.",
                                    "whyHappened": f"Accessing a key that does not exist in a dictionary raises KeyError at runtime.",
                                    "howToFix": f"Use one of the defined keys: '{known}', or use {subscript_var}.get('{key_val}', default) to safely handle missing keys.",
                                    "whyFixCorrect": "Using a defined key prevents KeyError, or .get() provides a safe default.",
                                    "sideEffects": "If the key is correct at runtime (e.g. dynamically added), use .get() instead.",
                                    "correctedCode": target_line.replace(f'["{key_val}"]', f'.get("{key_val}")').replace(f"['{key_val}']", f".get('{key_val}')"),
                                    "replacementCode": target_line.replace(f'["{key_val}"]', f'.get("{key_val}")').replace(f"['{key_val}']", f".get('{key_val}')")
                                })

                elif isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, int):
                    idx_val = node.slice.value
                    subscript_var = None
                    if isinstance(node.value, ast.Name):
                        subscript_var = node.value.id
                    if subscript_var and subscript_var in list_literal_sizes:
                        list_len = list_literal_sizes[subscript_var]
                        effective_idx = idx_val if idx_val >= 0 else list_len + idx_val
                        if effective_idx < 0 or effective_idx >= list_len:
                            issues.append({
                                "line": node.lineno,
                                "startChar": node.slice.col_offset,
                                "endChar": node.slice.end_col_offset or (node.slice.col_offset + len(str(idx_val))),
                                "severity": "error",
                                "errorName": f"Index Out of Range: {subscript_var}[{idx_val}] (IndexError)",
                                "whatHappened": f"You accessed index {idx_val} of '{subscript_var}', but it only has {list_len} element(s) (valid indices: 0 to {list_len - 1}).",
                                "whyHappened": f"Python lists are zero-indexed. Accessing index {idx_val} on a list of {list_len} elements raises IndexError at runtime.",
                                "howToFix": f"Use a valid index between 0 and {list_len - 1}, or check the list length with len({subscript_var}) before accessing.",
                                "whyFixCorrect": "Staying within the valid index range prevents IndexError crashes.",
                                "sideEffects": "Verify which element you actually need.",
                                "correctedCode": target_line.replace(f"[{idx_val}]", f"[{list_len - 1}]  # last valid index"),
                                "replacementCode": target_line.replace(f"[{idx_val}]", f"[{list_len - 1}]")
                            })

                elif isinstance(node.slice, ast.Call) and isinstance(node.slice.func, ast.Name) and node.slice.func.id == "print":
                    subscript_var = node.value.id if isinstance(node.value, ast.Name) else "container"
                    issues.append({
                        "line": node.lineno,
                        "startChar": node.slice.col_offset,
                        "endChar": node.slice.end_col_offset or (node.slice.col_offset + 5),
                        "severity": "error",
                        "errorName": f"Invalid Index Type: {subscript_var}[print(...)] (TypeError)",
                        "whatHappened": f"You used the return value of 'print()' as an index for '{subscript_var}'.",
                        "whyHappened": "In Python, 'print()' outputs text to the console and returns 'None'. Subscripting a sequence with None raises TypeError: list indices must be integers or slices, not NoneType.",
                        "howToFix": "Use an integer index directly instead of calling print() inside the brackets.",
                        "whyFixCorrect": "List indices must be integers or slice objects.",
                        "sideEffects": "Move the print statement outside the subscript if you want to display the value.",
                        "correctedCode": target_line
                    })

                elif isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, float):
                    subscript_var = node.value.id if isinstance(node.value, ast.Name) else "sequence"
                    issues.append({
                        "line": node.lineno,
                        "startChar": node.slice.col_offset,
                        "endChar": node.slice.end_col_offset or (node.slice.col_offset + len(str(node.slice.value))),
                        "severity": "error",
                        "errorName": f"Invalid Index Type: Float Index '{node.slice.value}' (TypeError)",
                        "whatHappened": f"You used a float ({node.slice.value}) as a list or sequence index.",
                        "whyHappened": "Python sequence indices must be integers. Passing a float raises TypeError: list indices must be integers or slices, not float.",
                        "howToFix": f"Use an integer or cast to integer: int({node.slice.value}).",
                        "whyFixCorrect": "Integer indices match Python list subscript specifications.",
                        "sideEffects": "Ensure floor truncation does not select the wrong element.",
                        "correctedCode": target_line.replace(str(node.slice.value), str(int(node.slice.value)))
                    })

                self.generic_visit(node)

            # Exception handling
            def visit_ExceptHandler(self, node):
                if node.type:
                    self.visit(node.type)
                if node.name:
                    self.scopes[-1]["assigned"].add(node.name)
                if node.type is None:
                    target_line = get_line_safe(node.lineno)
                    issues.append({
                        "line": node.lineno,
                        "startChar": node.col_offset,
                        "endChar": node.col_offset + 6,
                        "severity": "warning",
                        "errorName": "Bare 'except:' Clause (Swallows All Exceptions)",
                        "whatHappened": "This block uses a bare 'except:' without specifying an exception class.",
                        "whyHappened": "A bare 'except:' catches BaseException, including KeyboardInterrupt and SystemExit, preventing clean termination.",
                        "howToFix": "Specify 'except Exception:' to catch standard execution errors safely.",
                        "whyFixCorrect": "Catching 'Exception' leaves interrupt and system exit signals unblocked.",
                        "sideEffects": "Ctrl+C interrupts will now work properly.",
                        "correctedCode": target_line.replace("except:", "except Exception:"),
                        "replacementCode": target_line.replace("except:", "except Exception:")
                    })
                for stmt in node.body:
                    self.visit(stmt)

            # Duplicate dict keys
            def visit_Dict(self, node):
                seen_keys = {}
                for key_node in node.keys:
                    if isinstance(key_node, ast.Constant):
                        k_val = str(key_node.value)
                        if k_val in seen_keys:
                            target_line = get_line_safe(key_node.lineno)
                            issues.append({
                                "line": key_node.lineno,
                                "startChar": key_node.col_offset,
                                "endChar": key_node.end_col_offset or (key_node.col_offset + len(k_val) + 2),
                                "severity": "warning",
                                "errorName": f"Duplicate Dictionary Key '{k_val}'",
                                "whatHappened": f"The dictionary defines key '{k_val}' more than once.",
                                "whyHappened": "Later duplicate keys silently overwrite earlier values in Python dictionaries.",
                                "howToFix": f"Remove or rename the duplicate '{k_val}' key.",
                                "whyFixCorrect": "Dictionary keys must be unique for predictable data access.",
                                "sideEffects": "None.",
                                "correctedCode": target_line
                            })
                        else:
                            seen_keys[k_val] = key_node.lineno
                self.generic_visit(node)

        visitor = DeepSemanticVisitor()
        visitor.visit(parsed_tree)

    # =========================================================================
    # PASS 3: Security & Code Quality Regex Patterns
    # =========================================================================
    for idx, raw_line in enumerate(lines):
        line_num = idx + 1
        if is_comment_line(raw_line):
            continue
        trimmed = strip_inline_comment(raw_line).strip()
        if not trimmed:
            continue

        sec_match = re.search(
            r'\b[a-zA-Z0-9_]*(?:password|passwd|api_key|secret_key|auth_token|access_token)[a-zA-Z0-9_]*\s*=\s*["\'"]([^"\']{4,})["\'"]',
            trimmed, re.IGNORECASE
        )
        if sec_match:
            sec_var = sec_match.group(0).split('=')[0].strip()
            issues.append({
                "line": line_num,
                "startChar": raw_line.find(sec_match.group(0)),
                "endChar": raw_line.find(sec_match.group(0)) + len(sec_match.group(0)),
                "severity": "warning",
                "errorName": f"Security Vulnerability: Hardcoded Credential '{sec_var}'",
                "whatHappened": f"A sensitive credential '{sec_var}' is hardcoded in plain text in the source code.",
                "whyHappened": "Committing credentials to source code exposes sensitive tokens and keys to anyone who can view the code.",
                "howToFix": f"Load the value from an environment variable: os.environ.get('{sec_var.upper()}').",
                "whyFixCorrect": "Environment variables separate secrets from source code and prevent accidental exposure.",
                "sideEffects": "Configure the environment variable before running the application.",
                "correctedCode": f'import os\n{sec_var} = os.environ.get("{sec_var.upper()}", "")'
            })

        sql_match = re.search(
            r'(SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+.+\s+SET|DELETE\s+FROM)\s+.*["\'"]?\s*[\+%]\s*[a-zA-Z_]',
            trimmed, re.IGNORECASE
        )
        if sql_match:
            issues.append({
                "line": line_num,
                "startChar": raw_line.find(sql_match.group(0)),
                "endChar": len(raw_line.rstrip()),
                "severity": "warning",
                "errorName": "Security Vulnerability: SQL Injection Risk",
                "whatHappened": "You are constructing a SQL query by concatenating dynamic variables into a raw SQL string.",
                "whyHappened": "String concatenation allows malicious input to alter the SQL query structure (SQL Injection).",
                "howToFix": "Use parameterized queries: cursor.execute(query, (params,))",
                "whyFixCorrect": "Parameterized queries sanitize all parameters and prevent SQL injection.",
                "sideEffects": "Requires query parameter placeholder syntax (e.g. %s or ?).",
                "correctedCode": raw_line
            })

    # Deduplicate by (line, errorName, startChar)
    seen = set()
    deduped = []
    for iss in issues:
        key = (iss["line"], iss["errorName"], iss["startChar"])
        if key not in seen:
            seen.add(key)
            deduped.append(iss)

    deduped.sort(key=lambda x: (x["line"], x["startChar"]))
    return deduped


if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        target_file = sys.argv[1] if len(sys.argv) > 1 else "script.py"
        results = analyze_python_code(input_data, target_file)
        sys.stdout.write(json.dumps(results, indent=2))
        sys.stdout.flush()
    except Exception as exc:
        import traceback
        sys.stderr.write(f"Error during analysis: {exc}\n{traceback.format_exc()}\n")
        sys.stdout.write("[]")
        sys.stdout.flush()
