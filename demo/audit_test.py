import ast

code = open('C:/Users/aafre/Desktop/student mangement/main.py', encoding='utf-8').read()
tree = ast.parse(code)

class TestVisitor(ast.NodeVisitor):
    def __init__(self):
        self.scopes = [{'assigned': set(), 'types': {}, 'calls': set(), 'globals': set()}]
        self.defined_funcs = set()
        self.defined_classes = set()
        self.imported_names = set()
        self.called_funcs = set()
        self.builtin_names = set(dir(__builtins__)) | {'self', 'cls', 'True', 'False', 'None', '__name__', '__file__', '__doc__'}

    def visit_ClassDef(self, node):
        print(f'ClassDef: {node.name} -> added to defined_classes and scope[assigned]')
        self.defined_classes.add(node.name)
        self.scopes[-1]['assigned'].add(node.name)
        class_scope = {'assigned': set(), 'types': {}, 'calls': set(), 'globals': set()}
        self.scopes.append(class_scope)
        self.generic_visit(node)
        self.scopes.pop()

    def visit_FunctionDef(self, node):
        print(f'FunctionDef: {node.name} -> added to defined_funcs')
        self.defined_funcs.add(node.name)
        self.scopes[-1]['assigned'].add(node.name)
        func_scope = {'assigned': set(), 'types': {}, 'calls': set(), 'globals': set()}
        for arg in node.args.args:
            func_scope['assigned'].add(arg.arg)
        self.scopes.append(func_scope)
        self.generic_visit(node)
        self.scopes.pop()

    def visit_Assign(self, node):
        self.visit(node.value)
        for target in node.targets:
            if isinstance(target, ast.Name):
                self.scopes[-1]['assigned'].add(target.id)
                print(f'  Assign: {target.id} -> scope[assigned]')

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name):
            fn = node.func.id
            self.called_funcs.add((fn, node.lineno))
            is_defined = False
            for scope in reversed(self.scopes):
                if fn in scope['assigned']:
                    is_defined = True
                    break
            if not is_defined:
                if fn in self.builtin_names or fn in self.defined_funcs or fn in self.imported_names:
                    is_defined = True
            if not is_defined:
                print(f'  UNDEF FUNCTION CALL: {fn}() at line {node.lineno}')
            else:
                # Check arg count
                if fn in self.defined_funcs:
                    pass  # Would need function signature lookup
        self.generic_visit(node)

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            name = node.id
            if (name, node.lineno) in self.called_funcs:
                return
            is_defined = any(name in scope['assigned'] or name in scope['globals'] for scope in self.scopes)
            if not is_defined:
                is_defined = name in self.builtin_names or name in self.defined_funcs or name in self.defined_classes or name in self.imported_names
            if not is_defined:
                print(f'  UNDEFINED VAR: {name} at line {node.lineno}')
        self.generic_visit(node)

    def visit_Subscript(self, node):
        if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
            key_val = node.slice.value
            print(f'  Subscript with string key: [{key_val}] at line {node.lineno}')
        elif isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, int):
            print(f'  Subscript with int index: [{node.slice.value}] at line {node.lineno}')
        self.generic_visit(node)

v = TestVisitor()
v.visit(tree)

print()
print('=== SUMMARY ===')
print('defined_classes:', v.defined_classes)
print('defined_funcs:', v.defined_funcs)
print()
print('KEY FINDINGS:')
print('1. print(marks) - marks IS in defined_classes, so NOT flagged as undefined (CORRECT)')
print('2. student["age"] - "age" key IS in all_dict_keys? NO - only "name" is defined in dict literal')
print('3. numbers[5] - IndexError - static analysis CANNOT know list length at runtime in general')
print('4. calculate(10) - only 1 arg given but needs 2 - requires function signature tracking')

