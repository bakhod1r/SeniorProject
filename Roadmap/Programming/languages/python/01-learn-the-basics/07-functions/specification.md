# Python Functions — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, §8.7 — Function definitions
  https://docs.python.org/3/reference/compound_stmts.html#function-definitions
- **§6.2.4 — Calls:** https://docs.python.org/3/reference/expressions.html#calls
- **§7.6 — `return` statement:** https://docs.python.org/3/reference/simple_stmts.html#the-return-statement
- **§6.2.9 — `yield` expressions:** https://docs.python.org/3/reference/expressions.html#yield-expressions
- **§4.2 — Naming and binding:** https://docs.python.org/3/reference/executionmodel.html#naming-and-binding
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

### 2.1 Function Definition
```
funcdef          ::= [decorators] "def" funcname [type_params] "(" [parameter_list] ")"
                     ["->" expression] ":" suite
decorators       ::= decorator+
decorator        ::= "@" assignment_expression NEWLINE
funcname         ::= identifier
type_params      ::= "[" type_param ("," type_param)* "]"   # Python 3.12
```

### 2.2 Parameter List
```
parameter_list   ::= defparameter ("," defparameter)* ["," [parameter_list_starargs]]
                   | parameter_list_starargs
parameter_list_starargs ::= "*" [parameter] ("," defparameter)* ["," ["**" parameter [","]]]
                           | "**" parameter [","]
defparameter     ::= parameter ["=" expression]
parameter        ::= identifier [":" expression]  # name with optional annotation
```

### 2.3 Call Expressions
```
call             ::= primary "(" [argument_list [","]] ")"
argument_list    ::= positional_args ["," starred_and_keywords] ["," kwargs]
                   | starred_and_keywords ["," kwargs]
                   | kwargs
positional_args  ::= assignment_expression ("," assignment_expression)*
                   | "*" expression ("," "*" expression)* ["," starred_keywords]
starred_keywords ::= ("*" expression | keyword_item) ("," "*" expression | "," keyword_item)*
kwargs           ::= "**" expression ("," "**" expression)* [","]
keyword_item     ::= identifier "=" expression
```

### 2.4 Lambda Expression
```
lambda_expr ::= "lambda" [parameter_list_no_default] ":" expression
```

---

## 3. Core Rules and Constraints

### 3.1 Parameter Types
Python 3 supports five kinds of parameters (PEP 570):
1. **Positional-or-keyword:** Standard `def f(a, b)`.
2. **Positional-only** (before `/`): `def f(a, b, /, c)` — `a` and `b` cannot be passed by name.
3. **Keyword-only** (after `*` or `*args`): `def f(*, k)` or `def f(*args, k)`.
4. **`*args`** — collects extra positional arguments as a tuple.
5. **`**kwargs`** — collects extra keyword arguments as a dict.

Parameter order rule:
```
positional_only /  positional_or_keyword * *args keyword_only **kwargs
```

### 3.2 Default Values
- Default values are evaluated **once** at function definition time, not each call.
- Mutable defaults (list, dict, set) are shared across calls — common pitfall.
- Use `None` as default and initialize inside the function body.

### 3.3 Scoping: LEGB Rule Applied to Functions
- Each function call creates a new **local scope** (frame).
- Local variables include: parameters, names assigned in the function body.
- `global name` declares a name as referring to the module-level binding.
- `nonlocal name` declares a name as referring to the nearest enclosing function scope (not module).
- A name used in a function but not assigned there is looked up in enclosing → global → built-in scopes.
- A name assigned in a function is **local** by default — even reading it before assignment in the same scope raises `UnboundLocalError`.

### 3.4 `return` Statement
- `return [expression_list]` exits the function and returns the value.
- `return` without a value returns `None`.
- A function with no `return` statement implicitly returns `None`.
- In a generator function, `return value` raises `StopIteration(value)`.

### 3.5 `yield` Makes a Generator
- A function containing `yield` or `yield from` is a **generator function**.
- Calling it returns a **generator object** without executing the body.
- `next()` on the generator runs until the next `yield` expression.
- `yield from iterable` delegates to a sub-iterator (PEP 380).

### 3.6 Decorators
- `@expr` before `def` applies the decorator: `f = expr(f)` semantically.
- Decorators are evaluated at function definition time.
- Multiple decorators are applied bottom-up (innermost first).
- `functools.wraps` is used to preserve `__name__`, `__doc__`, `__annotations__`, `__dict__`, `__module__`, `__qualname__`, `__wrapped__`.

### 3.7 Annotations
- Parameter and return annotations are stored in `function.__annotations__`.
- Annotations have no runtime effect.
- `from __future__ import annotations` (PEP 563) makes them lazy strings.
- `inspect.get_annotations()` (Python 3.10+) resolves annotations safely.

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Function Object Attributes
```python
function.__name__         # str: unqualified name
function.__qualname__     # str: qualified name (e.g. "Class.method")
function.__doc__          # str | None: docstring
function.__module__       # str: defining module name
function.__defaults__     # tuple | None: positional default values
function.__kwdefaults__   # dict | None: keyword-only default values
function.__code__         # code object
function.__globals__      # module's global namespace dict
function.__annotations__  # dict of annotations
function.__closure__      # tuple of cells | None (for closures)
function.__dict__         # namespace for arbitrary attributes
function.__wrapped__      # original function if decorated with functools.wraps
```

### 4.2 Callable Protocol
```python
object.__call__(self, *args, **kwargs)
# An object is callable if it defines __call__.
# callable(obj) checks for __call__ without invoking it.
```

### 4.3 Descriptor Protocol (Relevant for Methods)
```python
# When a function is accessed as a class attribute, __get__ converts it to a method:
function.__get__(obj, objtype=None) -> bound_method | function
```

### 4.4 Generator Object Protocol
```python
generator.__next__()              # advance; raises StopIteration when done
generator.send(value)             # send value to yield; returns next yielded value
generator.throw(type[, value[, tb]])  # raise exception at yield point
generator.close()                 # raises GeneratorExit at yield point
generator.__iter__() -> self      # generators are iterators
```

---

## 5. Behavioral Specification

### 5.1 Argument Binding Rules
When calling `f(a, b, c=1, *args, **kwargs)`:
1. Positional arguments are bound to positional parameters in order.
2. Keyword arguments are matched by name.
3. Excess positionals go into `*args`.
4. Excess keywords go into `**kwargs`.
5. If a required parameter (no default) is missing → `TypeError`.
6. If a parameter receives both positional and keyword argument → `TypeError`.

### 5.2 Positional-Only Parameters (`/`)
- Parameters before `/` can only be passed positionally.
- Prevents callers from breaking on parameter name changes.
- Example: `dict(a=1)` — `a` is a keyword; `len([1,2,3])` — `obj` in C is positional-only.

### 5.3 Closure Semantics
- A closure captures variables by **reference** (via cell objects), not by value.
- The cell holds the current binding of the variable at the time of access, not definition.
- Common pitfall in loops: all closures share the same cell.

### 5.4 `functools.wraps` Semantics
- Copies `__name__`, `__qualname__`, `__doc__`, `__dict__`, `__annotations__`, `__module__` from wrapped to wrapper.
- Sets `__wrapped__ = wrapped`.
- Required for introspection tools (`inspect.signature`, `help()`) to see the original signature.

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- Default values evaluated once at function definition time.
- Positional arguments bind left-to-right.
- `*args` is always a `tuple`; `**kwargs` is always a `dict`.
- `return` without expression returns `None`.
- Generator function body does not execute until `next()` is called.
- `yield from` propagates `send()` and `throw()` calls to the sub-iterator.

### 6.2 Undefined / Implementation-Defined
- **Call stack depth limit:** `sys.getrecursionlimit()` (default 1000 in CPython). PyPy may have a different default.
- **`co_*` code object attributes:** internal representation of bytecode; not part of the language spec.
- **Closure cell internals:** `cell_contents` attribute is CPython-specific.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 Mutable Default Argument Trap
```python
def append_item(item, lst=[]):   # lst shared across all calls
    lst.append(item)
    return lst

print(append_item(1))   # [1]
print(append_item(2))   # [1, 2]  — same list!
print(append_item(3))   # [1, 2, 3]

# Fix:
def append_item_safe(item, lst=None):
    if lst is None:
        lst = []
    lst.append(item)
    return lst
```

### 7.2 Closure Captures Variable Reference (Not Value)
```python
# TRAP: all closures reference the same 'i' cell
funcs = [lambda: i for i in range(5)]
print([f() for f in funcs])   # [4, 4, 4, 4, 4]  — all see i=4

# Fix: default argument captures the value at definition time
funcs = [lambda i=i: i for i in range(5)]
print([f() for f in funcs])   # [0, 1, 2, 3, 4]
```

### 7.3 `UnboundLocalError` — Assignment Makes Name Local
```python
x = 10

def f():
    print(x)   # UnboundLocalError! x is local because assigned below
    x = 20

# Fix:
def g():
    global x
    print(x)   # 10
    x = 20
```

### 7.4 `nonlocal` for Nested Functions
```python
def counter():
    count = 0
    def increment():
        nonlocal count
        count += 1
        return count
    return increment

c = counter()
print(c())   # 1
print(c())   # 2
print(c())   # 3
```

### 7.5 `yield from` Return Value
```python
def sub():
    yield 1
    yield 2
    return "sub_done"   # becomes the value of 'yield from'

def main():
    result = yield from sub()   # result = "sub_done"
    print(f"Sub returned: {result}")
    yield 3

for v in main():
    print(v)   # 1, 2, 3
```

### 7.6 Positional-Only Parameters (`/`)
```python
def add(a, b, /, c=0):
    return a + b + c

add(1, 2)         # OK
add(1, 2, c=3)    # OK
# add(a=1, b=2)   # TypeError: a is positional-only
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| Generator functions | PEP 255 | Python 2.2 |
| Decorators | PEP 318 | Python 2.4 |
| `functools.wraps` | — | Python 2.5 |
| `yield from` | PEP 380 | Python 3.3 |
| `async def` / `await` | PEP 492 | Python 3.5 |
| Function annotations | PEP 3107 | Python 3.0 |
| `nonlocal` statement | PEP 3104 | Python 3.0 |
| Keyword-only arguments | PEP 3102 | Python 3.0 |
| Positional-only parameters `/` | PEP 570 | Python 3.8 |
| Walrus operator in defaults (N/A; in body) | PEP 572 | Python 3.8 |
| `inspect.get_annotations()` | PEP 563 | Python 3.10 |
| ParamSpec, Concatenate | PEP 612 | Python 3.10 |
| `typing.TypeVarTuple` | PEP 646 | Python 3.11 |
| Type parameters in `def` | PEP 695 | Python 3.12 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython Frame Objects
- Each function call creates a `frame` object containing locals, code object, and execution state.
- `sys._getframe(n)` returns the n-th frame up the call stack (CPython-specific).
- `inspect.currentframe()` is the portable equivalent.

### 9.2 CPython Recursion Limit
- Default: 1000 frames (`sys.getrecursionlimit()`).
- Exceeding raises `RecursionError` (previously `RuntimeError`).
- Can be increased via `sys.setrecursionlimit()` but risks C stack overflow for very large values.

### 9.3 CPython Function Call Overhead
- Python function calls are expensive relative to C; each call allocates a frame.
- Built-in functions (C-level) bypass frame creation.
- `LOAD_FAST` bytecode accesses locals by index (fast); `LOAD_GLOBAL` uses dict lookup.

### 9.4 PyPy JIT
- Hot function calls are JIT-compiled; warm-up cost but then near-C speed.
- Trace-based JIT benefits most from simple loops and numeric functions.

---

## 10. Spec Compliance Checklist

- [ ] Mutable default arguments avoided; use `None` sentinel instead
- [ ] Closures understood: capture by reference, not value
- [ ] `global` / `nonlocal` used correctly for non-local assignments
- [ ] `UnboundLocalError` risk understood for functions that assign a name
- [ ] `*args` is a `tuple`, `**kwargs` is a `dict` — not lists
- [ ] Decorator application order understood (bottom-up, or right-to-left)
- [ ] `functools.wraps` used in custom decorators
- [ ] `yield from` propagates `send()`, `throw()`, and `return` value
- [ ] Positional-only parameters (`/`) understood
- [ ] Keyword-only parameters (after `*`) understood
- [ ] Annotations are metadata only; not enforced at runtime
- [ ] Generator function body not executed until `next()` is called

---

## 11. Official Examples (Runnable Python 3.10+)

```python
import functools
from typing import Callable, TypeVar

T = TypeVar("T")

# ----------------------------------------------------------------
# 1. All parameter types in one function
# ----------------------------------------------------------------
def full_params(pos_only, /, normal, *args, kw_only, **kwargs):
    print(f"pos_only={pos_only!r}")
    print(f"normal={normal!r}")
    print(f"args={args!r}")
    print(f"kw_only={kw_only!r}")
    print(f"kwargs={kwargs!r}")

full_params(1, 2, 3, 4, kw_only="k", extra="x")
# pos_only=1, normal=2, args=(3, 4), kw_only='k', kwargs={'extra': 'x'}


# ----------------------------------------------------------------
# 2. Default arguments (evaluated once)
# ----------------------------------------------------------------
import time

def cached_now(ts=None):
    if ts is None:
        ts = time.time()
    return ts

# Calling multiple times returns different values (ts=None each time)
print(cached_now())
print(cached_now())


# ----------------------------------------------------------------
# 3. *args and **kwargs unpacking in calls
# ----------------------------------------------------------------
def add(a, b, c):
    return a + b + c

args_tuple = (1, 2, 3)
kwargs_dict = {"a": 1, "b": 2, "c": 3}

print(add(*args_tuple))    # 6
print(add(**kwargs_dict))  # 6
print(add(1, *[2, 3]))     # 6


# ----------------------------------------------------------------
# 4. Generator function
# ----------------------------------------------------------------
def countdown(n: int):
    while n > 0:
        yield n
        n -= 1

for val in countdown(5):
    print(val, end=" ")   # 5 4 3 2 1
print()

# Generator as iterator
gen = countdown(3)
print(next(gen))   # 3
print(next(gen))   # 2
print(list(gen))   # [1]  — exhausts the generator


# ----------------------------------------------------------------
# 5. yield from
# ----------------------------------------------------------------
def chain(*iterables):
    for it in iterables:
        yield from it

print(list(chain([1, 2], [3, 4], [5])))  # [1, 2, 3, 4, 5]


# ----------------------------------------------------------------
# 6. Closure and nonlocal
# ----------------------------------------------------------------
def make_accumulator(start=0):
    total = start
    def add(n):
        nonlocal total
        total += n
        return total
    return add

acc = make_accumulator()
print(acc(10))  # 10
print(acc(5))   # 15
print(acc(3))   # 18


# ----------------------------------------------------------------
# 7. Decorator
# ----------------------------------------------------------------
def timing(func):
    import time
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__} took {elapsed:.6f}s")
        return result
    return wrapper

@timing
def slow_sum(n: int) -> int:
    return sum(range(n))

result = slow_sum(100_000)
print(result)   # 4999950000


# ----------------------------------------------------------------
# 8. Class decorator
# ----------------------------------------------------------------
def singleton(cls):
    instances = {}
    @functools.wraps(cls)
    def get_instance(*args, **kwargs):
        if cls not in instances:
            instances[cls] = cls(*args, **kwargs)
        return instances[cls]
    return get_instance

@singleton
class Config:
    def __init__(self, val=42):
        self.val = val

c1 = Config()
c2 = Config()
print(c1 is c2)   # True


# ----------------------------------------------------------------
# 9. Positional-only parameters (PEP 570)
# ----------------------------------------------------------------
def normalize(x, y, z, /, scale=1.0):
    import math
    length = math.sqrt(x**2 + y**2 + z**2)
    return (x/length * scale, y/length * scale, z/length * scale)

print(normalize(1, 0, 0))        # (1.0, 0.0, 0.0)
print(normalize(1, 0, 0, scale=2.0))  # (2.0, 0.0, 0.0)
# normalize(x=1, y=0, z=0)  # TypeError


# ----------------------------------------------------------------
# 10. Lambda
# ----------------------------------------------------------------
square = lambda x: x ** 2
print(square(5))   # 25

pairs = [(1, 3), (2, 1), (3, 2)]
pairs.sort(key=lambda p: p[1])
print(pairs)   # [(2, 1), (3, 2), (1, 3)]


# ----------------------------------------------------------------
# 11. Type parameters in function def (Python 3.12, PEP 695)
# ----------------------------------------------------------------
def first[T](lst: list[T]) -> T:
    return lst[0]

print(first([1, 2, 3]))        # 1
print(first(["a", "b", "c"]))  # a


# ----------------------------------------------------------------
# 12. Introspecting function metadata
# ----------------------------------------------------------------
import inspect

def greet(name: str, greeting: str = "Hello") -> str:
    """Return a greeting string."""
    return f"{greeting}, {name}!"

sig = inspect.signature(greet)
print(sig)                          # (name: str, greeting: str = 'Hello') -> str
print(greet.__annotations__)        # {'name': <class 'str'>, ...}
print(greet.__defaults__)           # ('Hello',)
print(greet.__doc__)                # Return a greeting string.
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §8.7 | Function definitions | https://docs.python.org/3/reference/compound_stmts.html#function-definitions |
| §6.2.4 | Calls | https://docs.python.org/3/reference/expressions.html#calls |
| §7.6 | `return` statement | https://docs.python.org/3/reference/simple_stmts.html#the-return-statement |
| §6.2.9 | `yield` expression | https://docs.python.org/3/reference/expressions.html#yield-expressions |
| §4.2.2 | Scoping and namespaces | https://docs.python.org/3/reference/executionmodel.html#resolution-of-names |
| §3.2 | Function object type | https://docs.python.org/3/reference/datamodel.html#user-defined-functions |
| `functools` | Higher-order functions | https://docs.python.org/3/library/functools.html |
| `inspect` | Introspection | https://docs.python.org/3/library/inspect.html |
| PEP 255 | Generator functions | https://peps.python.org/pep-0255/ |
| PEP 318 | Decorators | https://peps.python.org/pep-0318/ |
| PEP 380 | `yield from` | https://peps.python.org/pep-0380/ |
| PEP 570 | Positional-only params | https://peps.python.org/pep-0570/ |
| PEP 695 | Type parameter syntax | https://peps.python.org/pep-0695/ |
