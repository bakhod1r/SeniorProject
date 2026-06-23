# Python Functions & Builtin Functions — Interview Questions

## Table of Contents

1. [Junior Level (5-7 Questions)](#junior-level)
2. [Middle Level (4-6 Questions)](#middle-level)
3. [Senior Level (4-6 Questions)](#senior-level)
4. [Scenario-Based Questions (3-5)](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### Q1: What is the difference between `def` and `lambda` in Python?

<details>
<summary><strong>Answer</strong></summary>

`def` creates a named function with a full function body (multiple statements, docstrings, etc.). `lambda` creates an anonymous function limited to a single expression.

```python
# def — named, multi-statement
def add(a, b):
    """Add two numbers"""
    result = a + b
    return result

# lambda — anonymous, single expression
add_lambda = lambda a, b: a + b

print(add(2, 3))        # 5
print(add_lambda(2, 3))  # 5

# Key differences:
# 1. lambda cannot contain statements (no if/for/while blocks, no assignments)
# 2. lambda has no __name__ (well, it's '<lambda>')
# 3. lambda cannot have a docstring
# 4. def can contain multiple expressions and statements

print(add.__name__)         # 'add'
print(add_lambda.__name__)  # '<lambda>'
```

**When to use lambda:** Short throwaway functions, typically as arguments to `sorted()`, `map()`, `filter()`.

</details>

---

### Q2: What are `*args` and `**kwargs`? How do they work?

<details>
<summary><strong>Answer</strong></summary>

`*args` collects extra positional arguments into a **tuple**. `**kwargs` collects extra keyword arguments into a **dict**.

```python
def demo(*args, **kwargs):
    print(f"args type: {type(args)}, value: {args}")
    print(f"kwargs type: {type(kwargs)}, value: {kwargs}")

demo(1, 2, 3, name="Alice", age=25)
# args type: <class 'tuple'>, value: (1, 2, 3)
# kwargs type: <class 'dict'>, value: {'name': 'Alice', 'age': 25}

# You can use any names, the * and ** are what matter
def another(*positionals, **named):
    print(positionals, named)

another(10, 20, x=30)  # (10, 20) {'x': 30}

# Unpacking when calling
def add(a, b, c):
    return a + b + c

numbers = [1, 2, 3]
print(add(*numbers))  # 6

params = {'a': 10, 'b': 20, 'c': 30}
print(add(**params))  # 60
```

</details>

---

### Q3: What is the difference between a parameter and an argument?

<details>
<summary><strong>Answer</strong></summary>

- **Parameter** — the variable name in the function *definition*
- **Argument** — the actual value passed when *calling* the function

```python
# x and y are PARAMETERS
def multiply(x, y):
    return x * y

# 3 and 4 are ARGUMENTS
result = multiply(3, 4)

# Named parameter types:
# 1. Positional parameter
# 2. Default parameter
# 3. *args (variable positional)
# 4. Keyword-only parameter
# 5. **kwargs (variable keyword)

def example(pos, default=10, *args, keyword_only, **kwargs):
    pass

# Argument passing styles:
example(1)                          # Error: keyword_only missing
example(1, keyword_only="value")    # OK
example(1, 20, 30, keyword_only=5, extra="hi")  # OK
```

</details>

---

### Q4: Name 5 commonly used Python builtin functions and explain each.

<details>
<summary><strong>Answer</strong></summary>

```python
# 1. len() — returns the number of items in a container
print(len([1, 2, 3]))       # 3
print(len("hello"))          # 5
print(len({'a': 1, 'b': 2}))  # 2

# 2. range() — generates a sequence of numbers
print(list(range(5)))        # [0, 1, 2, 3, 4]
print(list(range(2, 8, 2)))  # [2, 4, 6]

# 3. enumerate() — adds index to an iterable
fruits = ['apple', 'banana', 'cherry']
for i, fruit in enumerate(fruits, start=1):
    print(f"{i}. {fruit}")
# 1. apple
# 2. banana
# 3. cherry

# 4. sorted() — returns a new sorted list
nums = [3, 1, 4, 1, 5]
print(sorted(nums))                    # [1, 1, 3, 4, 5]
print(sorted(nums, reverse=True))      # [5, 4, 3, 1, 1]
print(sorted("hello"))                 # ['e', 'h', 'l', 'l', 'o']

# 5. zip() — combines iterables element-wise
names = ['Alice', 'Bob']
ages = [25, 30]
for name, age in zip(names, ages):
    print(f"{name} is {age}")
# Alice is 25
# Bob is 30
```

</details>

---

### Q5: What does the `return` statement do? What happens if a function has no `return`?

<details>
<summary><strong>Answer</strong></summary>

`return` exits the function and sends a value back to the caller. Without `return` (or with a bare `return`), the function returns `None`.

```python
def with_return():
    return 42

def without_return():
    x = 42  # no return statement

def bare_return():
    return  # returns None explicitly

print(with_return())     # 42
print(without_return())  # None
print(bare_return())     # None

# return can send back multiple values (as a tuple)
def get_coordinates():
    return 10, 20, 30

x, y, z = get_coordinates()
print(x, y, z)  # 10 20 30

result = get_coordinates()
print(type(result))  # <class 'tuple'>
print(result)         # (10, 20, 30)
```

</details>

---

### Q6: What is variable scope in Python? Explain LEGB rule.

<details>
<summary><strong>Answer</strong></summary>

Python resolves variable names using the **LEGB** rule — searching in this order:

1. **L**ocal — inside the current function
2. **E**nclosing — in any enclosing function(s)
3. **G**lobal — at the module level
4. **B**uiltin — Python's built-in names

```python
x = "global"

def outer():
    x = "enclosing"

    def inner():
        x = "local"
        print(x)  # "local" — found in Local scope

    inner()
    print(x)  # "enclosing" — inner's x doesn't affect outer

outer()
print(x)  # "global" — outer's x doesn't affect global

# Builtin example
print(len)  # <built-in function len> — found in Builtin scope

# Without local, falls through to enclosing
def outer2():
    msg = "from outer"
    def inner2():
        print(msg)  # "from outer" — found in Enclosing scope
    inner2()

outer2()
```

</details>

---

### Q7: What is a default argument? What is the danger with mutable defaults?

<details>
<summary><strong>Answer</strong></summary>

A default argument provides a fallback value when the caller doesn't pass one. **Mutable defaults are shared across calls**, which is a common Python pitfall.

```python
# Safe: immutable default
def greet(name="World"):
    return f"Hello, {name}!"

print(greet())         # Hello, World!
print(greet("Alice"))  # Hello, Alice!

# DANGER: mutable default
def append_to(item, target=[]):
    target.append(item)
    return target

print(append_to(1))  # [1]
print(append_to(2))  # [1, 2]  <-- BUG! Expected [2]
print(append_to(3))  # [1, 2, 3]  <-- BUG! Expected [3]

# The default list is created ONCE and shared across all calls
# Fix: use None as default
def append_to_fixed(item, target=None):
    if target is None:
        target = []
    target.append(item)
    return target

print(append_to_fixed(1))  # [1]
print(append_to_fixed(2))  # [2]  Correct!
```

</details>

---

## Middle Level

### Q1: Explain closures in Python. When are they useful?

<details>
<summary><strong>Answer</strong></summary>

A **closure** is a function that remembers the values from its enclosing scope even after the enclosing function has finished executing.

Three conditions for a closure:
1. A nested function
2. The nested function references a variable from the enclosing scope
3. The enclosing function returns the nested function

```python
def make_multiplier(factor):
    """Factory function — returns a closure"""
    def multiply(x):
        return x * factor  # 'factor' is captured from enclosing scope
    return multiply

double = make_multiplier(2)
triple = make_multiplier(3)

print(double(5))   # 10
print(triple(5))   # 15

# The closure retains access to 'factor' even after make_multiplier returned
print(double.__closure__)                    # (<cell ...>,)
print(double.__closure__[0].cell_contents)   # 2

# Practical use: creating configurable validators
def make_range_validator(min_val, max_val):
    def validate(value):
        if min_val <= value <= max_val:
            return True
        raise ValueError(f"{value} not in range [{min_val}, {max_val}]")
    return validate

validate_age = make_range_validator(0, 150)
validate_score = make_range_validator(0, 100)

print(validate_age(25))    # True
print(validate_score(85))  # True

try:
    validate_age(200)
except ValueError as e:
    print(e)  # 200 not in range [0, 150]

# Closures with nonlocal — mutable state
def make_counter():
    count = 0
    def increment():
        nonlocal count
        count += 1
        return count
    return increment

counter = make_counter()
print(counter())  # 1
print(counter())  # 2
print(counter())  # 3
```

</details>

---

### Q2: How do decorators work internally? Write a decorator with arguments.

<details>
<summary><strong>Answer</strong></summary>

A decorator is syntactic sugar for wrapping a function. `@decorator` is equivalent to `func = decorator(func)`.

```python
import functools
import time

# Simple decorator (no arguments)
def timer(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__} took {elapsed:.4f}s")
        return result
    return wrapper

@timer
def slow_function():
    time.sleep(0.1)
    return "done"

slow_function()  # slow_function took 0.100Xs

# Decorator WITH arguments — requires an extra layer
def retry(max_attempts=3, exceptions=(Exception,)):
    """Decorator factory — returns the actual decorator"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    print(f"Attempt {attempt}/{max_attempts} failed: {e}")
            raise last_exception
        return wrapper
    return decorator

# Usage:
@retry(max_attempts=3, exceptions=(ValueError,))
def risky_operation(x):
    import random
    if random.random() < 0.7:
        raise ValueError("Random failure!")
    return x * 2

try:
    result = risky_operation(21)
    print(f"Success: {result}")
except ValueError:
    print("All attempts failed")

# What @retry(max_attempts=3) actually does:
# 1. retry(max_attempts=3) is called -> returns 'decorator'
# 2. decorator(risky_operation) is called -> returns 'wrapper'
# 3. risky_operation now points to 'wrapper'
```

</details>

---

### Q3: Explain the difference between `map()`, `filter()`, and list comprehensions. When to use each?

<details>
<summary><strong>Answer</strong></summary>

```python
numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# map() — apply a function to each element
squared_map = list(map(lambda x: x ** 2, numbers))
print(squared_map)  # [1, 4, 9, 16, 25, 36, 49, 64, 81, 100]

# Equivalent list comprehension
squared_comp = [x ** 2 for x in numbers]
print(squared_comp)  # Same result

# filter() — keep elements where function returns True
evens_filter = list(filter(lambda x: x % 2 == 0, numbers))
print(evens_filter)  # [2, 4, 6, 8, 10]

# Equivalent list comprehension
evens_comp = [x for x in numbers if x % 2 == 0]
print(evens_comp)  # Same result

# Combined map + filter
even_squares_func = list(map(lambda x: x ** 2, filter(lambda x: x % 2 == 0, numbers)))
even_squares_comp = [x ** 2 for x in numbers if x % 2 == 0]
print(even_squares_func)  # [4, 16, 36, 64, 100]
print(even_squares_comp)  # Same, but much more readable

# When to use each:
# - List comprehension: DEFAULT choice, most Pythonic, most readable
# - map(): when applying an existing named function (no lambda needed)
#     list(map(str, numbers))  # cleaner than [str(x) for x in numbers]
# - filter(): rarely preferred, but sometimes with existing predicates
#     list(filter(str.isdigit, strings))

# Performance note: list comprehensions are generally fastest
import timeit

t_map = timeit.timeit(lambda: list(map(lambda x: x*2, range(1000))), number=10000)
t_comp = timeit.timeit(lambda: [x*2 for x in range(1000)], number=10000)
print(f"\nmap + lambda: {t_map:.3f}s")
print(f"comprehension: {t_comp:.3f}s")
```

</details>

---

### Q4: What is `functools.wraps` and why is it important for decorators?

<details>
<summary><strong>Answer</strong></summary>

`functools.wraps` preserves the original function's metadata (`__name__`, `__doc__`, `__module__`, `__qualname__`, `__dict__`, `__wrapped__`) when wrapping it with a decorator.

```python
import functools

# WITHOUT functools.wraps
def bad_decorator(func):
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper

@bad_decorator
def my_function():
    """This is my function's docstring"""
    pass

print(my_function.__name__)  # 'wrapper'  <-- WRONG!
print(my_function.__doc__)   # None       <-- LOST!

# WITH functools.wraps
def good_decorator(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper

@good_decorator
def my_function2():
    """This is my function's docstring"""
    pass

print(my_function2.__name__)     # 'my_function2'  <-- Correct!
print(my_function2.__doc__)      # "This is my function's docstring"
print(my_function2.__wrapped__)  # <function my_function2 at 0x...>

# Why it matters:
# 1. Debugging: stack traces show the right function name
# 2. Documentation: help() shows the right docstring
# 3. Introspection: tools like inspect work correctly
# 4. __wrapped__ allows accessing the original function

import inspect
print(inspect.signature(my_function2))  # Shows correct signature
```

</details>

---

### Q5: What is the difference between `global` and `nonlocal` keywords?

<details>
<summary><strong>Answer</strong></summary>

- `global` — declares that a variable references the **module-level** (global) scope
- `nonlocal` — declares that a variable references the **nearest enclosing** (non-global) scope

```python
count = 0  # Global variable

def using_global():
    global count
    count += 1  # Modifies the global 'count'

def outer():
    count = 100  # Enclosing variable

    def using_nonlocal():
        nonlocal count
        count += 1  # Modifies outer's 'count', NOT global

    print(f"Before: {count}")  # 100
    using_nonlocal()
    print(f"After: {count}")   # 101

# Demonstrate
print(f"Global before: {count}")  # 0
using_global()
print(f"Global after: {count}")   # 1

outer()
print(f"Global unchanged by nonlocal: {count}")  # 1

# Key differences:
# 1. global always refers to module scope
# 2. nonlocal refers to the nearest enclosing function's scope
# 3. nonlocal CANNOT refer to global scope — it requires an enclosing function
# 4. nonlocal requires the variable to already exist in the enclosing scope

# This would be an error:
# def broken():
#     nonlocal x  # SyntaxError: no binding for nonlocal 'x' found
#     x = 10
```

</details>

---

### Q6: How does Python handle function arguments — by value or by reference?

<details>
<summary><strong>Answer</strong></summary>

Python uses **"pass by object reference"** (sometimes called "pass by assignment"). The function receives a reference to the same object, but reassigning the parameter does not affect the caller.

```python
# Immutable objects — APPEAR like pass-by-value
def try_change_int(x):
    print(f"  Inside (before): id={id(x)}, value={x}")
    x = x + 1  # Creates a NEW int object, rebinds x
    print(f"  Inside (after):  id={id(x)}, value={x}")

n = 42
print(f"Before: id={id(n)}, value={n}")
try_change_int(n)
print(f"After:  id={id(n)}, value={n}")  # Unchanged!

print()

# Mutable objects — APPEAR like pass-by-reference (for mutations)
def try_change_list(lst):
    print(f"  Inside (before): id={id(lst)}, value={lst}")
    lst.append(99)  # Mutates the SAME object
    print(f"  Inside (after):  id={id(lst)}, value={lst}")

my_list = [1, 2, 3]
print(f"Before: id={id(my_list)}, value={my_list}")
try_change_list(my_list)
print(f"After:  id={id(my_list)}, value={my_list}")  # Changed!

print()

# BUT reassignment doesn't affect the caller
def try_reassign_list(lst):
    lst = [10, 20, 30]  # Rebinds local 'lst' to a NEW list
    print(f"  Inside: {lst}")

my_list2 = [1, 2, 3]
try_reassign_list(my_list2)
print(f"After reassign: {my_list2}")  # Still [1, 2, 3]

# Summary:
# - Mutation (append, update, etc.) affects the original object
# - Reassignment (=) creates a new local binding
# - This applies to ALL objects — the behavior depends on
#   whether you mutate or reassign
```

</details>

---

## Senior Level

### Q1: Explain Python's descriptor protocol and how it relates to functions/methods.

<details>
<summary><strong>Answer</strong></summary>

Functions are **descriptors** — they implement `__get__`, which is how Python transforms a function into a bound method when accessed via an instance.

```python
class MyClass:
    def method(self):
        return "called"

obj = MyClass()

# When you access obj.method, Python calls:
# MyClass.__dict__['method'].__get__(obj, MyClass)

func = MyClass.__dict__['method']
print(f"Function type: {type(func)}")           # <class 'function'>
print(f"Has __get__:   {hasattr(func, '__get__')}")  # True

# Manual descriptor call
bound = func.__get__(obj, MyClass)
print(f"Bound type:    {type(bound)}")           # <class 'method'>
print(f"bound.__self__: {bound.__self__}")       # <__main__.MyClass object>
print(f"bound.__func__: {bound.__func__}")       # <function method>

# This is why self is automatically passed
print(bound())  # "called" — self is obj

# Custom descriptor that acts like a function
class LazyProperty:
    """Descriptor that computes value once and caches it"""
    def __init__(self, func):
        self.func = func
        self.attr_name = func.__name__

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        value = self.func(obj)
        setattr(obj, self.attr_name, value)  # Replace descriptor with value
        return value

class Circle:
    def __init__(self, radius):
        self.radius = radius

    @LazyProperty
    def area(self):
        print("Computing area...")
        import math
        return math.pi * self.radius ** 2

c = Circle(5)
print(c.area)   # Computing area... 78.539...
print(c.area)   # 78.539... (cached, no "Computing" message)
```

</details>

---

### Q2: How would you implement a thread-safe memoization decorator?

<details>
<summary><strong>Answer</strong></summary>

```python
import functools
import threading
import time
from collections import OrderedDict

class ThreadSafeLRUCache:
    """Thread-safe LRU cache decorator with size limit"""

    def __init__(self, maxsize=128):
        self.maxsize = maxsize
        self.cache = OrderedDict()
        self.lock = threading.RLock()  # Re-entrant lock
        self.hits = 0
        self.misses = 0

    def __call__(self, func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))

            with self.lock:
                if key in self.cache:
                    self.hits += 1
                    self.cache.move_to_end(key)
                    return self.cache[key]

            # Compute outside the lock to allow concurrency
            result = func(*args, **kwargs)

            with self.lock:
                self.misses += 1
                self.cache[key] = result
                if len(self.cache) > self.maxsize:
                    self.cache.popitem(last=False)

            return result

        wrapper.cache_info = lambda: {
            'hits': self.hits,
            'misses': self.misses,
            'size': len(self.cache),
            'maxsize': self.maxsize,
        }
        wrapper.cache_clear = lambda: self._clear()
        return wrapper

    def _clear(self):
        with self.lock:
            self.cache.clear()
            self.hits = self.misses = 0

# Usage
@ThreadSafeLRUCache(maxsize=64)
def expensive_computation(n):
    time.sleep(0.01)  # Simulate work
    return n ** 2

# Test with threads
results = {}

def worker(n):
    results[n] = expensive_computation(n)

threads = [threading.Thread(target=worker, args=(i % 10,)) for i in range(50)]
for t in threads:
    t.start()
for t in threads:
    t.join()

print(f"Results: {dict(sorted(results.items()))}")
print(f"Cache info: {expensive_computation.cache_info()}")

# Compare with stdlib functools.lru_cache (also thread-safe since 3.2)
@functools.lru_cache(maxsize=64)
def stdlib_cached(n):
    time.sleep(0.01)
    return n ** 2

# Note: functools.lru_cache holds the lock during computation,
# which prevents concurrent computation of different keys.
# Our implementation releases the lock during computation.
```

</details>

---

### Q3: Explain how `functools.singledispatch` works and implement a simplified version.

<details>
<summary><strong>Answer</strong></summary>

`singledispatch` enables function overloading based on the type of the first argument.

```python
from functools import singledispatch

@singledispatch
def process(data):
    """Default implementation"""
    raise TypeError(f"Unsupported type: {type(data)}")

@process.register(int)
def _(data):
    return f"Integer: {data * 2}"

@process.register(str)
def _(data):
    return f"String: {data.upper()}"

@process.register(list)
def _(data):
    return f"List with {len(data)} items: {data}"

print(process(42))          # Integer: 84
print(process("hello"))     # String: HELLO
print(process([1, 2, 3]))   # List with 3 items: [1, 2, 3]

# --- Simplified implementation ---
import functools

def my_singledispatch(default_func):
    """Simplified single-dispatch generic function"""
    registry = {object: default_func}

    @functools.wraps(default_func)
    def dispatch(*args, **kwargs):
        arg_type = type(args[0])
        # Walk the MRO to find the best match
        for cls in arg_type.__mro__:
            if cls in registry:
                return registry[cls](*args, **kwargs)
        return default_func(*args, **kwargs)

    def register(type_):
        def decorator(func):
            registry[type_] = func
            return func
        return decorator

    dispatch.register = register
    dispatch.registry = registry
    return dispatch

# Test our implementation
@my_singledispatch
def serialize(obj):
    return str(obj)

@serialize.register(int)
def _(obj):
    return f"int:{obj}"

@serialize.register(dict)
def _(obj):
    return f"dict:{len(obj)} keys"

print(serialize(42))             # int:42
print(serialize({"a": 1}))      # dict:1 keys
print(serialize(3.14))          # 3.14 (falls through to default)

# MRO resolution: bool is a subclass of int
print(serialize(True))          # int:1 (matches int via MRO)
```

</details>

---

### Q4: What are the performance implications of nested function definitions? When should you avoid them?

<details>
<summary><strong>Answer</strong></summary>

```python
import timeit
import dis

# Every call to outer() creates a NEW function object for inner()
def outer_with_nested():
    def inner(x):
        return x * 2
    return inner(42)

# Module-level function — created once
def module_inner(x):
    return x * 2

def outer_without_nested():
    return module_inner(42)

# Benchmark
t_nested = timeit.timeit(outer_with_nested, number=1_000_000)
t_flat = timeit.timeit(outer_without_nested, number=1_000_000)
print(f"Nested function:      {t_nested:.4f}s")
print(f"Module-level function: {t_flat:.4f}s")
print(f"Overhead: {((t_nested/t_flat) - 1)*100:.1f}%")

# Show the MAKE_FUNCTION bytecode in nested case
print("\n=== Bytecode for nested case ===")
dis.dis(outer_with_nested)

# When nested functions are WORTH it:
# 1. Closures — when you NEED to capture enclosing state
# 2. Decorators — the wrapping pattern requires it
# 3. Encapsulation — hiding helper functions from module scope
# 4. Factory functions — creating specialized functions

# When to AVOID nested functions:
# 1. Hot loops where the function doesn't need closure variables
# 2. When the inner function could be a module-level function
# 3. Deep nesting (3+ levels) — hurts readability

# Memory note: each closure keeps references alive
def memory_leak_risk():
    large_data = [0] * 10_000_000  # 80MB+

    def small_func():
        return 42  # Doesn't use large_data but...

    # If small_func captured ANY variable from this scope,
    # large_data would be kept alive via the frame.
    # CPython is smart enough to NOT create a closure here
    # since small_func doesn't reference any enclosing variables.

    return small_func

f = memory_leak_risk()
print(f"\nClosure: {f.__closure__}")  # None — no closure, no leak
```

</details>

---

### Q5: How does Python implement default argument values at the bytecode level? Why are they evaluated once?

<details>
<summary><strong>Answer</strong></summary>

```python
import dis

# Default values are stored as part of the FUNCTION OBJECT,
# not re-evaluated on each call.

def func_with_defaults(a, b=[], c={}):
    pass

# Defaults are stored in __defaults__
print(f"__defaults__: {func_with_defaults.__defaults__}")
# ({} and [] are created ONCE when the def statement executes)

# Look at how the function is created
source = '''
def f(a, b=[], c={"key": "val"}):
    pass
'''
code = compile(source, "<demo>", "exec")
print("\n=== Bytecode for function creation ===")
dis.dis(code)
# You'll see:
#   BUILD_LIST 0          -> creates the default []
#   LOAD_CONST 'key'
#   LOAD_CONST 'val'
#   BUILD_MAP 1           -> creates the default {"key": "val"}
#   BUILD_TUPLE 2         -> packs defaults into a tuple
#   ... MAKE_FUNCTION     -> creates function with these defaults

# This is why mutable defaults are shared:
print(f"\nDefault list id: {id(func_with_defaults.__defaults__[0])}")
func_with_defaults(1)  # Uses the same list object
func_with_defaults(1)  # Same list object again

# Proving defaults are on the function object
def append_default(item, lst=[]):
    lst.append(item)
    return lst

print(f"\nBefore calls: {append_default.__defaults__}")
append_default(1)
print(f"After call 1: {append_default.__defaults__}")
append_default(2)
print(f"After call 2: {append_default.__defaults__}")
# The default tuple's list is being mutated in place!
```

</details>

---

### Q6: Explain the `__call__` protocol and how it interacts with Python's function call mechanism.

<details>
<summary><strong>Answer</strong></summary>

```python
# Any object with __call__ is "callable"
class Adder:
    def __init__(self, n):
        self.n = n
        self.call_count = 0

    def __call__(self, x):
        self.call_count += 1
        return x + self.n

add5 = Adder(5)
print(add5(10))          # 15
print(add5(20))          # 25
print(add5.call_count)   # 2
print(callable(add5))    # True

# How CPython resolves __call__:
# 1. First checks tp_call slot on the TYPE (not the instance)
# 2. For user classes, tp_call -> slot_tp_call -> looks up __call__ on the type
# 3. This means __call__ must be on the CLASS, not the instance

class Demo:
    pass

d = Demo()
d.__call__ = lambda: "instance"  # This won't work for calling!

try:
    d()  # TypeError: 'Demo' object is not callable
except TypeError as e:
    print(f"Error: {e}")

# But this works:
Demo.__call__ = lambda self: "class level"
print(d())  # "class level"

# Practical use: stateful decorators using callable classes
import functools

class CountCalls:
    """Decorator that counts function calls"""
    def __init__(self, func):
        functools.update_wrapper(self, func)
        self.func = func
        self.count = 0

    def __call__(self, *args, **kwargs):
        self.count += 1
        return self.func(*args, **kwargs)

@CountCalls
def my_function(x):
    return x * 2

my_function(5)
my_function(10)
print(f"Call count: {my_function.count}")  # 2
print(f"Name: {my_function.__name__}")     # 'my_function' (preserved)
```

</details>

---

## Scenario-Based Questions

### Scenario 1: Debugging a Production Issue with Decorators

> Your team's API has a `@cache` decorator applied to a function that returns user data. Users report seeing other users' data. What happened and how do you fix it?

<details>
<summary><strong>Answer</strong></summary>

The cache key likely doesn't account for the user identity, so one user's cached response is served to another.

```python
import functools
import time

# THE BUG: cache key is based only on function arguments
user_db = {1: "Alice", 2: "Bob", 3: "Charlie"}

@functools.lru_cache(maxsize=128)
def get_user_data(user_id):
    """Simulates DB call"""
    time.sleep(0.1)
    return {"id": user_id, "name": user_db[user_id], "timestamp": time.time()}

# This seems fine at first...
print(get_user_data(1))  # Alice's data
print(get_user_data(2))  # Bob's data

# But the REAL bug scenario: caching based on request parameters
# that don't include user context

@functools.lru_cache(maxsize=128)
def get_dashboard_data(page="home"):
    """BUG: Same cache key for all users on the same page!"""
    # In reality, this would use request context to get current user
    import random
    user = random.choice(["Alice", "Bob"])  # Simulating different users
    return {"page": page, "user": user, "data": "sensitive"}

# User A gets their data
result1 = get_dashboard_data("home")
print(f"First call: {result1}")

# User B gets User A's cached data!
result2 = get_dashboard_data("home")
print(f"Second call (SAME data!): {result2}")

# FIX 1: Include user identity in cache key
def user_aware_cache(maxsize=128):
    def decorator(func):
        @functools.lru_cache(maxsize=maxsize)
        def cached_func(user_id, *args, **kwargs):
            return func(user_id, *args, **kwargs)

        @functools.wraps(func)
        def wrapper(user_id, *args, **kwargs):
            return cached_func(user_id, *args, **kwargs)

        wrapper.cache_clear = cached_func.cache_clear
        wrapper.cache_info = cached_func.cache_info
        return wrapper
    return decorator

# FIX 2: Use TTL to limit stale data
class TTLCache:
    def __init__(self, maxsize=128, ttl=60):
        self.maxsize = maxsize
        self.ttl = ttl
        self.cache = {}

    def __call__(self, func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))
            now = time.time()

            if key in self.cache:
                result, timestamp = self.cache[key]
                if now - timestamp < self.ttl:
                    return result

            result = func(*args, **kwargs)
            self.cache[key] = (result, now)

            # Evict old entries
            if len(self.cache) > self.maxsize:
                oldest_key = min(self.cache, key=lambda k: self.cache[k][1])
                del self.cache[oldest_key]

            return result
        return wrapper

@TTLCache(maxsize=128, ttl=5)
def safe_get_data(user_id, page):
    return {"user": user_id, "page": page}

print(safe_get_data(1, "home"))
print(safe_get_data(2, "home"))  # Different result — user_id in key
```

</details>

---

### Scenario 2: Optimizing a Slow Data Pipeline

> You have a data processing pipeline that applies 10 transformations to each item in a large list. Each transformation is a separate function. The pipeline is too slow. How do you optimize it?

<details>
<summary><strong>Answer</strong></summary>

```python
import time
import timeit
from functools import reduce
from operator import methodcaller

# Simulated transformations
def strip_whitespace(s):
    return s.strip()

def lowercase(s):
    return s.lower()

def remove_punctuation(s):
    return ''.join(c for c in s if c.isalnum() or c.isspace())

def collapse_spaces(s):
    return ' '.join(s.split())

def truncate(s):
    return s[:100]

# Approach 1: SLOW — apply each function in a loop
def pipeline_naive(data):
    transforms = [strip_whitespace, lowercase, remove_punctuation,
                  collapse_spaces, truncate]
    result = []
    for item in data:
        for fn in transforms:
            item = fn(item)
        result.append(item)
    return result

# Approach 2: Compose functions into ONE function
def compose(*funcs):
    """Compose functions: compose(f, g, h)(x) == h(g(f(x)))"""
    def composed(x):
        for fn in funcs:
            x = fn(x)
        return x
    return composed

def pipeline_composed(data):
    transform = compose(strip_whitespace, lowercase, remove_punctuation,
                        collapse_spaces, truncate)
    return [transform(item) for item in data]

# Approach 3: Use map() for C-level iteration
def pipeline_map(data):
    transform = compose(strip_whitespace, lowercase, remove_punctuation,
                        collapse_spaces, truncate)
    return list(map(transform, data))

# Approach 4: Combine operations to reduce function call overhead
def pipeline_combined(data):
    """Minimize function calls by combining operations"""
    result = []
    for s in data:
        s = ' '.join(s.strip().lower().split())
        s = ''.join(c for c in s if c.isalnum() or c.isspace())
        result.append(s[:100])
    return result

# Benchmark
test_data = ["  Hello, World!  This is a TEST...  " * 5] * 1000

print("=== Pipeline Performance ===")
for name, fn in [("Naive loop", pipeline_naive),
                  ("Composed", pipeline_composed),
                  ("Map-based", pipeline_map),
                  ("Combined ops", pipeline_combined)]:
    t = timeit.timeit(lambda: fn(test_data), number=100)
    print(f"  {name:20s}: {t:.4f}s")

# Key insights:
# 1. Reduce number of function calls (each call has overhead)
# 2. Combine compatible operations into single passes
# 3. Use generator pipelines for memory efficiency with large data
# 4. Consider multiprocessing for CPU-bound transforms
```

</details>

---

### Scenario 3: Designing a Plugin System

> You need to design a plugin system where third-party developers register functions that your framework calls. How do you design the registration, validation, and execution?

<details>
<summary><strong>Answer</strong></summary>

```python
import functools
import inspect
from typing import Callable, Dict, List, Any, Optional
from dataclasses import dataclass, field

@dataclass
class PluginInfo:
    name: str
    func: Callable
    priority: int = 0
    description: str = ""
    version: str = "1.0.0"

class PluginRegistry:
    """A type-safe plugin system using function registration"""

    def __init__(self):
        self._hooks: Dict[str, List[PluginInfo]] = {}
        self._validators: Dict[str, Callable] = {}

    def hook(self, hook_name: str, priority: int = 0,
             description: str = "", version: str = "1.0.0"):
        """Decorator to register a function as a hook handler"""
        def decorator(func: Callable) -> Callable:
            # Validate signature if a validator is registered
            if hook_name in self._validators:
                self._validate_signature(func, hook_name)

            info = PluginInfo(
                name=func.__qualname__,
                func=func,
                priority=priority,
                description=description or func.__doc__ or "",
                version=version,
            )

            self._hooks.setdefault(hook_name, []).append(info)
            # Keep sorted by priority (highest first)
            self._hooks[hook_name].sort(key=lambda p: -p.priority)

            return func  # Don't wrap — return original
        return decorator

    def define_hook(self, hook_name: str, signature: Callable):
        """Define expected signature for a hook"""
        self._validators[hook_name] = signature

    def _validate_signature(self, func: Callable, hook_name: str):
        expected = inspect.signature(self._validators[hook_name])
        actual = inspect.signature(func)

        expected_params = list(expected.parameters.values())
        actual_params = list(actual.parameters.values())

        if len(expected_params) != len(actual_params):
            raise TypeError(
                f"Plugin '{func.__qualname__}' for hook '{hook_name}' "
                f"expects {len(expected_params)} params, got {len(actual_params)}"
            )

    def call(self, hook_name: str, *args, **kwargs) -> List[Any]:
        """Call all registered handlers for a hook"""
        results = []
        for plugin in self._hooks.get(hook_name, []):
            try:
                result = plugin.func(*args, **kwargs)
                results.append((plugin.name, result))
            except Exception as e:
                results.append((plugin.name, f"ERROR: {e}"))
        return results

    def call_pipeline(self, hook_name: str, initial_value, *args, **kwargs):
        """Chain handlers: output of one becomes input of the next"""
        value = initial_value
        for plugin in self._hooks.get(hook_name, []):
            try:
                value = plugin.func(value, *args, **kwargs)
            except Exception as e:
                print(f"Plugin {plugin.name} failed: {e}")
        return value

    def list_hooks(self):
        for hook_name, plugins in self._hooks.items():
            print(f"\nHook: {hook_name}")
            for p in plugins:
                print(f"  [{p.priority:3d}] {p.name} v{p.version}: {p.description}")


# Usage
registry = PluginRegistry()

# Define expected hook signature
registry.define_hook("on_request", lambda request: None)
registry.define_hook("transform_response", lambda response, request: None)

# Register plugins
@registry.hook("on_request", priority=10, description="Log all requests")
def logging_plugin(request):
    print(f"  LOG: {request}")
    return None

@registry.hook("on_request", priority=5, description="Validate auth")
def auth_plugin(request):
    if "token" not in request:
        return "UNAUTHORIZED"
    return None

@registry.hook("transform_response", priority=10)
def add_headers(response, request):
    response["headers"] = {"X-Plugin": "active"}
    return response

@registry.hook("transform_response", priority=5)
def compress_response(response, request):
    response["compressed"] = True
    return response

# List all hooks
registry.list_hooks()

# Execute hooks
print("\n=== Calling on_request hook ===")
results = registry.call("on_request", {"path": "/api", "token": "abc"})
for name, result in results:
    print(f"  {name}: {result}")

print("\n=== Pipeline: transform_response ===")
response = registry.call_pipeline(
    "transform_response",
    {"body": "Hello"},
    request={"path": "/api"}
)
print(f"  Final response: {response}")
```

</details>

---

### Scenario 4: Memory Leak from Closures

> Your long-running server's memory keeps growing. Profiling shows it's related to closures in your event handler registration. Diagnose and fix.

<details>
<summary><strong>Answer</strong></summary>

```python
import weakref
import gc
import sys

# THE BUG: Closures keep large objects alive
class EventSystem:
    def __init__(self):
        self.handlers = {}

    def on(self, event, handler):
        self.handlers.setdefault(event, []).append(handler)

    def emit(self, event, *args):
        for handler in self.handlers.get(event, []):
            handler(*args)

class DataProcessor:
    def __init__(self, name, data_size=1_000_000):
        self.name = name
        self.data = bytearray(data_size)  # 1MB of data

    def register(self, events):
        # BUG: lambda captures 'self', keeping DataProcessor alive forever!
        events.on("process", lambda item: self.handle(item))

    def handle(self, item):
        return f"{self.name} processed {item}"

# Demonstration of the leak
events = EventSystem()
for i in range(10):
    proc = DataProcessor(f"proc_{i}")
    proc.register(events)
    # proc goes out of scope but the closure keeps it alive!

gc.collect()
print(f"DataProcessor instances alive: "
      f"{sum(1 for obj in gc.get_objects() if isinstance(obj, DataProcessor))}")
# All 10 are still alive because closures hold references!

# FIX 1: Use weakref in closures
class FixedEventSystem:
    def __init__(self):
        self.handlers = {}

    def on(self, event, handler):
        self.handlers.setdefault(event, []).append(handler)

    def emit(self, event, *args):
        # Clean up dead weak references
        live_handlers = []
        for handler in self.handlers.get(event, []):
            try:
                result = handler(*args)
                live_handlers.append(handler)
            except ReferenceError:
                pass  # Object was garbage collected
        self.handlers[event] = live_handlers

class FixedProcessor:
    def __init__(self, name, data_size=1_000_000):
        self.name = name
        self.data = bytearray(data_size)

    def register(self, events):
        # FIX: Use weakref so the closure doesn't prevent GC
        ref = weakref.ref(self)

        def handler(item):
            obj = ref()
            if obj is not None:
                return obj.handle(item)
            raise ReferenceError("Object collected")

        events.on("process", handler)

    def handle(self, item):
        return f"{self.name} processed {item}"

# Test the fix
fixed_events = FixedEventSystem()
processors = []
for i in range(10):
    proc = FixedProcessor(f"fixed_{i}")
    proc.register(fixed_events)
    if i < 3:  # Only keep references to first 3
        processors.append(proc)

gc.collect()
alive = sum(1 for obj in gc.get_objects() if isinstance(obj, FixedProcessor))
print(f"\nFixed: only {alive} FixedProcessor instances alive (expected 3)")

# FIX 2: Use bound methods with weakref (cleaner)
class CleanProcessor:
    def __init__(self, name):
        self.name = name
        self.data = bytearray(1_000_000)

    def register(self, events):
        # Store a weak reference to the bound method
        events.on("process", weakref.WeakMethod(self.handle))

    def handle(self, item):
        return f"{self.name}: {item}"
```

</details>

---

### Scenario 5: Dynamic Function Generation for an API Framework

> You need to generate route handler functions dynamically based on a configuration file. Each route has different parameter validation. How do you approach this?

<details>
<summary><strong>Answer</strong></summary>

```python
import functools
import inspect
from typing import Any, Dict, List, Optional, Callable

# Configuration (normally loaded from YAML/JSON)
ROUTE_CONFIG = {
    "/users": {
        "method": "GET",
        "params": {"page": {"type": "int", "default": 1, "min": 1},
                   "limit": {"type": "int", "default": 20, "min": 1, "max": 100}},
        "handler": "list_users",
    },
    "/users/{id}": {
        "method": "GET",
        "params": {"id": {"type": "int", "min": 1}},
        "handler": "get_user",
    },
    "/search": {
        "method": "GET",
        "params": {"q": {"type": "str", "required": True, "min_length": 1},
                   "category": {"type": "str", "default": "all",
                                "choices": ["all", "books", "music"]}},
        "handler": "search",
    },
}

def create_validator(param_name: str, rules: dict) -> Callable:
    """Generate a validation function from config rules"""
    param_type = {"int": int, "str": str, "float": float, "bool": bool}[rules["type"]]

    def validate(value):
        # Type coercion
        try:
            value = param_type(value)
        except (ValueError, TypeError):
            raise ValueError(f"'{param_name}' must be {rules['type']}")

        # Range validation for numbers
        if isinstance(value, (int, float)):
            if "min" in rules and value < rules["min"]:
                raise ValueError(f"'{param_name}' must be >= {rules['min']}")
            if "max" in rules and value > rules["max"]:
                raise ValueError(f"'{param_name}' must be <= {rules['max']}")

        # String validation
        if isinstance(value, str):
            if "min_length" in rules and len(value) < rules["min_length"]:
                raise ValueError(f"'{param_name}' must be at least {rules['min_length']} chars")
            if "choices" in rules and value not in rules["choices"]:
                raise ValueError(f"'{param_name}' must be one of {rules['choices']}")

        return value

    validate.__name__ = f"validate_{param_name}"
    return validate

def generate_handler(route: str, config: dict) -> Callable:
    """Dynamically generate a validated handler function"""

    # Build validators for each parameter
    validators = {}
    defaults = {}
    required = set()

    for param_name, rules in config.get("params", {}).items():
        validators[param_name] = create_validator(param_name, rules)
        if "default" in rules:
            defaults[param_name] = rules["default"]
        elif rules.get("required", True):
            required.add(param_name)

    handler_name = config["handler"]

    def handler(**raw_params):
        """Dynamically generated handler with validation"""
        # Apply defaults
        params = {**defaults, **raw_params}

        # Check required params
        missing = required - set(params.keys())
        if missing:
            raise ValueError(f"Missing required parameters: {missing}")

        # Validate each parameter
        validated = {}
        errors = []
        for name, value in params.items():
            if name in validators:
                try:
                    validated[name] = validators[name](value)
                except ValueError as e:
                    errors.append(str(e))
            else:
                validated[name] = value

        if errors:
            raise ValueError(f"Validation errors: {'; '.join(errors)}")

        return {"route": route, "handler": handler_name, "params": validated}

    handler.__name__ = handler_name
    handler.__doc__ = f"Handler for {config['method']} {route}"
    handler.__route__ = route
    handler.__method__ = config["method"]

    return handler

# Generate all handlers
handlers = {}
for route, config in ROUTE_CONFIG.items():
    handlers[route] = generate_handler(route, config)

# Test the generated handlers
print("=== Generated Handlers ===")
for route, handler in handlers.items():
    print(f"\n{handler.__method__} {route} -> {handler.__name__}()")

# Valid calls
print("\n=== Valid Calls ===")
print(handlers["/users"](page="2", limit="50"))
print(handlers["/users/{id}"](id="42"))
print(handlers["/search"](q="python", category="books"))

# Using defaults
print("\n=== With Defaults ===")
print(handlers["/users"]())  # Uses default page=1, limit=20
print(handlers["/search"](q="test"))  # Uses default category="all"

# Validation errors
print("\n=== Validation Errors ===")
for test_name, route, params in [
    ("Missing required", "/search", {}),
    ("Invalid type", "/users", {"page": "abc"}),
    ("Out of range", "/users", {"limit": "200"}),
    ("Invalid choice", "/search", {"q": "test", "category": "invalid"}),
]:
    try:
        handlers[route](**params)
    except ValueError as e:
        print(f"  {test_name}: {e}")
```

</details>

---

## FAQ

### 1. Can a function modify a global variable without the `global` keyword?

Yes, if the variable is **mutable** and you **mutate** it (not reassign it).

```python
my_list = [1, 2, 3]

def modify_without_global():
    my_list.append(4)  # Mutation — works without 'global'

def reassign_without_global():
    # This creates a LOCAL variable, doesn't affect global
    my_list = [10, 20]  # New local binding

modify_without_global()
print(my_list)  # [1, 2, 3, 4] — global was mutated

reassign_without_global()
print(my_list)  # [1, 2, 3, 4] — global unchanged
```

---

### 2. What is the maximum recursion depth in Python?

Default is 1000. You can change it with `sys.setrecursionlimit()`, but deep recursion is generally discouraged.

```python
import sys

print(f"Default limit: {sys.getrecursionlimit()}")  # 1000

# You can increase it (but beware of stack overflow)
sys.setrecursionlimit(5000)

# Better approach: convert recursion to iteration
def factorial_recursive(n):
    if n <= 1:
        return 1
    return n * factorial_recursive(n - 1)

def factorial_iterative(n):
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result

# Reset to default
sys.setrecursionlimit(1000)
```

---

### 3. Is `lambda` slower than `def`?

No. Once created, a lambda and a def function with the same body execute at the same speed. The only difference is creation context (lambda can only hold one expression).

```python
import timeit

def def_double(x):
    return x * 2

lambda_double = lambda x: x * 2

t_def = timeit.timeit(lambda: def_double(42), number=1_000_000)
t_lambda = timeit.timeit(lambda: lambda_double(42), number=1_000_000)

print(f"def:    {t_def:.4f}s")
print(f"lambda: {t_lambda:.4f}s")
# Essentially identical
```

---

### 4. When should I use `functools.partial` instead of a lambda?

`partial` is preferred when you're fixing arguments of an existing function. It's clearer, has a proper repr, and is slightly faster.

```python
from functools import partial

# Lambda approach
sort_by_age_lambda = lambda people: sorted(people, key=lambda p: p['age'])

# Partial approach (when applicable)
import operator
get_age = operator.itemgetter('age')
sort_by_age_partial = partial(sorted, key=get_age)

people = [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]
print(sort_by_age_partial(people))

# partial has better repr for debugging
print(repr(sort_by_age_partial))
# functools.partial(<built-in function sorted>, key=operator.itemgetter('age'))
```

---

### 5. How do type hints affect function performance?

Type hints have **zero runtime cost** in normal execution. They're metadata stored in `__annotations__` and not enforced unless you use a runtime type checker.

```python
import timeit

def without_hints(x, y):
    return x + y

def with_hints(x: int, y: int) -> int:
    return x + y

t1 = timeit.timeit(lambda: without_hints(1, 2), number=1_000_000)
t2 = timeit.timeit(lambda: with_hints(1, 2), number=1_000_000)

print(f"Without hints: {t1:.4f}s")
print(f"With hints:    {t2:.4f}s")
# Same performance

print(f"\nAnnotations: {with_hints.__annotations__}")
# {'x': <class 'int'>, 'y': <class 'int'>, 'return': <class 'int'>}
```

---

### 6. What is the difference between `sorted()` and `list.sort()`?

```python
# sorted() — returns a NEW list, works on any iterable
original = [3, 1, 2]
new_list = sorted(original)
print(f"original: {original}")  # [3, 1, 2] (unchanged)
print(f"sorted:   {new_list}")  # [1, 2, 3]

# Also works on non-list iterables
print(sorted("hello"))        # ['e', 'h', 'l', 'l', 'o']
print(sorted({3, 1, 2}))      # [1, 2, 3]

# list.sort() — sorts IN PLACE, returns None, only works on lists
data = [3, 1, 2]
result = data.sort()
print(f"data:   {data}")     # [1, 2, 3] (modified)
print(f"result: {result}")   # None (returns nothing!)
```

---

### 7. Can you have a function inside a dictionary?

Yes. Functions are first-class objects and can be stored anywhere.

```python
# Function dispatch table
def add(a, b): return a + b
def sub(a, b): return a - b
def mul(a, b): return a * b

operations = {
    "+": add,
    "-": sub,
    "*": mul,
    "/": lambda a, b: a / b,
}

# Use it
op = "+"
result = operations[op](10, 5)
print(f"10 {op} 5 = {result}")  # 10 + 5 = 15

# Command pattern
commands = {
    "greet": lambda name: f"Hello, {name}!",
    "farewell": lambda name: f"Goodbye, {name}!",
    "shout": lambda name: f"HEY {name.upper()}!",
}

for cmd in ["greet", "farewell", "shout"]:
    print(commands[cmd]("Alice"))
```
