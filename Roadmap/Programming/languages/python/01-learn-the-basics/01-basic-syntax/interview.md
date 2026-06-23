# Basic Syntax — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What is indentation in Python, and why is it important?

**Answer:**
Indentation (whitespace at the beginning of a line) defines code blocks in Python. Unlike C, Java, or JavaScript which use `{}`, Python enforces indentation as part of its syntax. If indentation is wrong, Python raises `IndentationError`.

```python
# Correct
if True:
    print("inside if")  # 4 spaces
print("outside if")

# Wrong — causes IndentationError
if True:
print("missing indent")
```

The standard is **4 spaces** per indentation level (PEP 8). Never mix tabs and spaces.

---

### 2. What is dynamic typing in Python?

**Answer:**
Dynamic typing means Python determines the type of a variable at runtime, not at compile time. You don't need to declare types — just assign a value. The same variable can hold different types at different times.

```python
x = 42          # x is int
x = "hello"     # now x is str — no error
x = [1, 2, 3]   # now x is list
print(type(x))  # <class 'list'>
```

This provides flexibility but can lead to runtime errors that static typing would catch at compile time.

---

### 3. What is the difference between `=` and `==`?

**Answer:**
- `=` is the **assignment operator** — it assigns a value to a variable
- `==` is the **equality operator** — it compares two values and returns `True` or `False`

```python
x = 5       # assignment: x now holds 5
print(x == 5)  # comparison: True
print(x == 3)  # comparison: False
```

---

### 4. What does `input()` return in Python?

**Answer:**
`input()` always returns a **string**, regardless of what the user types. If you need a number, you must convert it explicitly.

```python
age = input("Enter your age: ")  # user types "25"
print(type(age))    # <class 'str'>
print(age + 1)      # TypeError!

age = int(input("Enter your age: "))  # convert to int
print(age + 1)      # 26
```

---

### 5. What are Python's naming conventions?

**Answer:**
Python follows PEP 8 naming conventions:
- **Variables and functions:** `snake_case` — `user_name`, `get_data()`
- **Constants:** `UPPER_SNAKE_CASE` — `MAX_RETRIES`, `PI`
- **Classes:** `PascalCase` — `UserProfile`, `HttpClient`
- **Private members:** Leading underscore — `_internal_method`
- **"Dunder" (magic) methods:** Double underscores — `__init__`, `__str__`

```python
MAX_CONNECTIONS = 100       # constant
user_count = 0              # variable
class DatabaseConnection:   # class
    def _validate(self):    # private method
        pass
```

---

### 6. What is the difference between `//` and `/` in Python?

**Answer:**
- `/` is **true division** — always returns a `float`
- `//` is **floor division** — returns the largest integer less than or equal to the result

```python
print(7 / 2)    # 3.5 (float)
print(7 // 2)   # 3   (int — rounded down)
print(-7 // 2)  # -4  (rounded toward negative infinity!)
```

---

### 7. How do you write multi-line code in Python?

**Answer:**
Three ways:
1. **Backslash `\`** — explicit line continuation
2. **Parentheses `()`** — implicit line continuation (preferred)
3. **Triple quotes `"""`** — for multi-line strings

```python
# Backslash
total = 1 + 2 + \
        3 + 4

# Parentheses (preferred)
total = (1 + 2 +
         3 + 4)

# Triple-quoted string
message = """This is
a multi-line
string."""
```

---

## Middle Level

### 8. What is the walrus operator (`:=`) and when should you use it?

**Answer:**
The walrus operator (`:=`), introduced in Python 3.8 (PEP 572), is an **assignment expression** — it assigns a value and returns it in one step.

```python
# Without walrus — compute twice or use temporary variable
data = get_data()
if data:
    process(data)

# With walrus — compute once, test, and use
if data := get_data():
    process(data)

# In while loops
while chunk := f.read(8192):
    process(chunk)

# In list comprehensions
results = [clean for raw in data if (clean := transform(raw)) is not None]
```

**When to use:** When you need to both compute and test a value, especially in `while` loops and comprehensions.
**When NOT to use:** When it reduces readability — simple assignments should stay on their own line.

---

### 9. Explain the difference between EAFP and LBYL in Python.

**Answer:**
- **LBYL (Look Before You Leap):** Check conditions before acting
- **EAFP (Easier to Ask Forgiveness than Permission):** Try the operation and handle exceptions

```python
# LBYL — common in C/Java
if "key" in dictionary:
    value = dictionary["key"]
else:
    value = default

# EAFP — Pythonic
try:
    value = dictionary["key"]
except KeyError:
    value = default

# Best: use .get() for simple cases
value = dictionary.get("key", default)
```

EAFP is generally preferred in Python because:
1. It avoids race conditions (the key could be removed between check and access)
2. It's often faster when the exception is rare (no double lookup)
3. It follows Python's culture and the Zen of Python

---

### 10. How does `match/case` (structural pattern matching) differ from `if/elif` chains?

**Answer:**
`match/case` (Python 3.10+, PEP 634) goes beyond simple value comparison — it **destructures** data:

```python
# if/elif — only value comparison
def handle(cmd):
    if cmd["action"] == "move" and "x" in cmd and "y" in cmd:
        x, y = cmd["x"], cmd["y"]
        return move(x, y)

# match/case — destructuring + type checking in one step
def handle(cmd):
    match cmd:
        case {"action": "move", "x": int(x), "y": int(y)}:
            return move(x, y)
        case {"action": "quit"}:
            return quit()
        case _:
            raise ValueError(f"Unknown: {cmd}")
```

Key differences:
- Pattern matching can **bind variables** from the matched structure
- It supports **type guards** (`int(x)` checks type AND binds)
- It supports **OR patterns** (`case "quit" | "exit":`)
- `if/elif` is better for complex boolean logic with `and`/`or`

---

### 11. What are the performance implications of f-strings vs other formatting methods?

**Answer:**

```python
import timeit

name = "Alice"
age = 30

# f-string — fastest (compiled to bytecode)
timeit.timeit(lambda: f"Hello, {name}! Age: {age}", number=1000000)
# ~0.15s

# str.format() — slower (runtime parsing)
timeit.timeit(lambda: "Hello, {}! Age: {}".format(name, age), number=1000000)
# ~0.25s

# % formatting — moderate
timeit.timeit(lambda: "Hello, %s! Age: %d" % (name, age), number=1000000)
# ~0.20s
```

f-strings are fastest because they compile to `FORMAT_VALUE` + `BUILD_STRING` bytecode — no runtime string parsing.

---

### 12. What is the `__all__` variable and why is it important?

**Answer:**
`__all__` is a list of names that should be exported when someone does `from module import *`. It serves as the module's public API.

```python
# mymodule.py
__all__ = ["public_function", "PublicClass"]

def public_function(): ...
class PublicClass: ...
def _private_helper(): ...  # not in __all__
def internal_util(): ...     # not in __all__ — won't be exported
```

Without `__all__`, `import *` exports all names that don't start with `_`. With `__all__`, only listed names are exported. This is critical for large packages.

---

### 13. How does Python handle chained comparisons internally?

**Answer:**
Python's chained comparisons like `1 < x < 10` are syntactic sugar for `(1 < x) and (x < 10)`, but with an important optimization: `x` is evaluated only once.

```python
# Chained comparison
1 < x < 10
# Equivalent to: (1 < x) and (x < 10)
# But x is evaluated only once!

# This matters when x is a function call
1 < expensive_func() < 10
# expensive_func() is called only ONCE
# Unlike: 1 < expensive_func() and expensive_func() < 10
```

---

## Senior Level

### 14. How does CPython's `LOAD_FAST` differ from `LOAD_GLOBAL` at the bytecode level?

**Answer:**
- `LOAD_FAST` accesses `f_localsplus[index]` — a C array lookup by integer index. It's O(1) with minimal overhead.
- `LOAD_GLOBAL` calls `PyDict_GetItem(f_globals, name)` — a hash table lookup. If not found, it falls back to `PyDict_GetItem(f_builtins, name)`.

```python
import dis

x = 42
def local_access():
    x = 42
    return x  # LOAD_FAST — ~50ns

def global_access():
    return x  # LOAD_GLOBAL — ~80ns
```

In tight loops over millions of iterations, binding globals to local variables can yield 20-30% speedup:

```python
def fast_loop(items):
    local_len = len  # bind built-in to local
    return [local_len(item) for item in items]
```

---

### 15. Explain CPython's integer caching and string interning mechanisms.

**Answer:**
**Integer caching:** CPython pre-allocates integers from -5 to 256 at startup. Any reference to these values points to the same object:

```python
a = 256; b = 256; print(a is b)  # True — cached
a = 257; b = 257; print(a is b)  # False — new objects
```

**String interning:** CPython automatically interns strings that look like identifiers (alphanumeric + underscore). Other strings can be manually interned with `sys.intern()`:

```python
import sys
a = sys.intern("hello world")
b = sys.intern("hello world")
print(a is b)  # True — same object
```

Interning saves memory and speeds up `==` comparison (becomes pointer comparison when both are interned).

---

### 16. Is `x += 1` thread-safe in CPython? Explain at the bytecode level.

**Answer:**
**No.** `x += 1` compiles to four bytecode instructions:

```
LOAD_FAST    x    # read x
LOAD_CONST   1    # push 1
BINARY_ADD        # compute x + 1
STORE_FAST   x    # write result back
```

The GIL can be released between any two instructions (every 5ms by default). If two threads execute `x += 1` simultaneously:
1. Thread 1 reads `x = 5` (LOAD_FAST)
2. GIL switches to Thread 2
3. Thread 2 reads `x = 5` (LOAD_FAST), computes 6, stores 6
4. GIL switches back to Thread 1
5. Thread 1 computes 6, stores 6
6. Result: `x = 6` instead of `x = 7`

Use `threading.Lock` for thread safety.

---

### 17. How does the specializing adaptive interpreter (Python 3.11+) optimize basic operations?

**Answer:**
Python 3.11 (PEP 659) introduces "quickening" — after several executions, generic bytecode is replaced with type-specialized versions:

- `BINARY_ADD` → `BINARY_ADD_INT` (skips `PyNumber_Add` type dispatch)
- `LOAD_GLOBAL` → `LOAD_GLOBAL_BUILTIN` (skips global dict lookup)
- `LOAD_ATTR` → `LOAD_ATTR_INSTANCE_VALUE` (direct `__dict__` access)
- `COMPARE_OP` → `COMPARE_OP_INT` (int-specific comparison)

If types change, the specialization "de-optimizes" back to generic bytecode. This provides 10-60% speedup for type-stable code without JIT compilation.

---

### 18. How would you design a Python plugin architecture without metaclasses?

**Answer:**
Use `__init_subclass__` (PEP 487, Python 3.6+):

```python
class PluginBase:
    _registry: dict[str, type] = {}

    def __init_subclass__(cls, *, name: str = "", **kwargs):
        super().__init_subclass__(**kwargs)
        plugin_name = name or cls.__name__.lower()
        PluginBase._registry[plugin_name] = cls

    @classmethod
    def get_plugin(cls, name: str) -> type:
        return cls._registry[name]

class CSVPlugin(PluginBase, name="csv"):
    def process(self, data): ...

class JSONPlugin(PluginBase, name="json"):
    def process(self, data): ...

# Auto-registered
plugin_cls = PluginBase.get_plugin("csv")
plugin = plugin_cls()
```

This is cleaner than metaclasses, works with `mypy`, and doesn't interfere with standard inheritance.

---

### 19. What is the descriptor protocol and how does it affect attribute access?

**Answer:**
The descriptor protocol defines how Python resolves `obj.attr`:

1. Check `type(obj).__mro__` for a **data descriptor** (has `__get__` AND `__set__`/`__delete__`)
2. Check `obj.__dict__` for an instance attribute
3. Check `type(obj).__mro__` for a **non-data descriptor** (has only `__get__`)
4. Raise `AttributeError`

```python
class CachedProperty:
    """Non-data descriptor — instance dict wins after first access."""
    def __init__(self, func):
        self.func = func
        self.attrname = None

    def __set_name__(self, owner, name):
        self.attrname = name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        value = self.func(obj)
        obj.__dict__[self.attrname] = value  # cache in instance dict
        return value

class MyClass:
    @CachedProperty
    def expensive(self):
        return compute_something()  # called only once
```

---

## Scenario-Based Questions

### 20. You're reviewing code where a developer wrote a 50-line `if/elif/else` chain to handle different command types. How would you refactor it?

**Answer:**
Three approaches depending on complexity:

1. **Dictionary dispatch** (simplest):
```python
HANDLERS = {
    "create": handle_create,
    "update": handle_update,
    "delete": handle_delete,
}

def handle(command_type, data):
    handler = HANDLERS.get(command_type)
    if handler is None:
        raise ValueError(f"Unknown command: {command_type}")
    return handler(data)
```

2. **Pattern matching** (when destructuring is needed):
```python
match command:
    case {"type": "create", "data": dict(data)}:
        return create(data)
```

3. **Plugin registry** (when extensibility is needed):
```python
class CommandHandler:
    _registry = {}
    def __init_subclass__(cls, command=None, **kwargs):
        if command:
            CommandHandler._registry[command] = cls
```

---

### 21. A junior developer's code has `from module import *` throughout. What problems does this cause and how would you fix it?

**Answer:**
Problems:
1. **Namespace pollution** — imported names can shadow local names or builtins
2. **Hidden dependencies** — impossible to know where a name comes from
3. **Broken IDE support** — autocomplete and refactoring tools can't trace origins
4. **`__all__` sensitivity** — behavior changes if the module updates `__all__`

Fix:
```python
# ❌ Bad
from os.path import *
from utils import *

# ✅ Explicit imports
from os.path import join, exists, basename
from utils import validate_input, format_output

# ✅ Or import the module
import os.path
import utils
```

---

### 22. Your Python application runs correctly but is 3x slower than expected in production. The code is simple (no I/O, no network). Where do you look first?

**Answer:**
1. **Profile with `cProfile`**: `python -m cProfile -s cumulative app.py`
2. **Check for global variable access in tight loops** — bind to local variables
3. **Check for unnecessary object creation** — use `__slots__` for high-frequency objects
4. **Check for string concatenation in loops** — use `"".join()`
5. **Check for list membership tests** — convert to `set` for O(1) lookup
6. **Check comprehensions vs explicit loops** — comprehensions are 2x faster
7. **Profile memory with `tracemalloc`** — GC pressure from many small objects
8. **Check Python version** — Python 3.11+ is 10-60% faster due to specializing interpreter

---

## FAQ

### Q: Should I always use f-strings?

**A:** For Python 3.6+, yes. f-strings are the fastest and most readable formatting method. The only exceptions:
- When you need to define the format string dynamically (use `.format()`)
- When logging (use `logger.info("msg %s", var)` — deferred formatting)
- When working with i18n/l10n (use `.format()` with translation strings)

### Q: Is Python's dynamic typing a strength or weakness?

**A:** Both — it's a trade-off:
- **Strength:** Rapid prototyping, polymorphism without interfaces, less boilerplate
- **Weakness:** Runtime errors instead of compile-time, harder refactoring at scale

The modern solution is **gradual typing**: use type hints (PEP 484) + `mypy` to get static type checking benefits while keeping Python's flexibility.

### Q: What do interviewers look for when asking about basic syntax?

**A:**
- **Junior:** Can write correct Python, follows PEP 8, understands dynamic typing
- **Middle:** Knows walrus operator, pattern matching, EAFP vs LBYL, performance implications
- **Senior:** Understands bytecode (LOAD_FAST vs LOAD_GLOBAL), GIL implications, descriptor protocol, can design plugin architectures
