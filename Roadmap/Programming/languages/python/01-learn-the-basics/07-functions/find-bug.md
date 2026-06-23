# Python Functions & Builtin Functions — Find the Bug

## Instructions

Each exercise contains a buggy Python function. Your task is to:

1. **Read** the code carefully
2. **Identify** the bug(s)
3. **Explain** why the bug occurs
4. **Fix** the code

Difficulty levels: **Easy** (1-2 bugs), **Medium** (2-3 bugs), **Hard** (subtle/tricky bugs)

---

## Score Card

| # | Difficulty | Bug Type | Found? | Fixed? |
|---|---|---|---|---|
| 1 | Easy | Mutable Default Argument | [ ] | [ ] |
| 2 | Easy | Missing Return | [ ] | [ ] |
| 3 | Easy | Scope Confusion | [ ] | [ ] |
| 4 | Medium | Late Binding Closure | [ ] | [ ] |
| 5 | Medium | *args/**kwargs Errors | [ ] | [ ] |
| 6 | Medium | Decorator Bug | [ ] | [ ] |
| 7 | Medium | Builtin Shadowing | [ ] | [ ] |
| 8 | Hard | Closure + Mutation | [ ] | [ ] |
| 9 | Hard | Default + Generator | [ ] | [ ] |
| 10 | Hard | Recursion + Scope | [ ] | [ ] |
| 11 | Hard (Bonus) | Multiple Combined Bugs | [ ] | [ ] |

**Total: ___ / 11**

---

## Easy

### Bug 1: The Accumulating Shopping Cart

```python
def add_to_cart(item, cart=[]):
    """Add an item to the shopping cart"""
    cart.append(item)
    return cart

# Customer 1
cart1 = add_to_cart("apple")
cart1 = add_to_cart("banana", cart1)
print(f"Customer 1: {cart1}")

# Customer 2 — should be a fresh cart!
cart2 = add_to_cart("milk")
print(f"Customer 2: {cart2}")

# Expected:
# Customer 1: ['apple', 'banana']
# Customer 2: ['milk']

# Actual:
# Customer 1: ['apple', 'banana']
# Customer 2: ['apple', 'banana', 'milk']  <-- BUG!
```

<details>
<summary><strong>Bug Explanation</strong></summary>

The default argument `cart=[]` is evaluated **once** when the function is defined, not each time the function is called. All calls without an explicit `cart` share the same list object.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
def add_to_cart(item, cart=None):
    """Add an item to the shopping cart"""
    if cart is None:
        cart = []
    cart.append(item)
    return cart

# Customer 1
cart1 = add_to_cart("apple")
cart1 = add_to_cart("banana", cart1)
print(f"Customer 1: {cart1}")  # ['apple', 'banana']

# Customer 2
cart2 = add_to_cart("milk")
print(f"Customer 2: {cart2}")  # ['milk']  Correct!
```

</details>

---

### Bug 2: The Silent Calculator

```python
def calculate_total(prices, tax_rate=0.08):
    """Calculate total price with tax"""
    subtotal = sum(prices)
    tax = subtotal * tax_rate
    total = subtotal + tax
    print(f"Subtotal: ${subtotal:.2f}, Tax: ${tax:.2f}, Total: ${total:.2f}")

# Usage
prices = [10.99, 24.99, 5.50]
result = calculate_total(prices)
discounted = result * 0.9  # 10% discount

# Expected: discounted = total * 0.9
# Actual: TypeError: unsupported operand type(s) for *: 'NoneType' and 'float'
```

<details>
<summary><strong>Bug Explanation</strong></summary>

The function prints the total but never **returns** it. In Python, functions without a `return` statement return `None`. So `result` is `None`, and `None * 0.9` raises a `TypeError`.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
def calculate_total(prices, tax_rate=0.08):
    """Calculate total price with tax"""
    subtotal = sum(prices)
    tax = subtotal * tax_rate
    total = subtotal + tax
    print(f"Subtotal: ${subtotal:.2f}, Tax: ${tax:.2f}, Total: ${total:.2f}")
    return total  # <-- FIX: return the result

prices = [10.99, 24.99, 5.50]
result = calculate_total(prices)
discounted = result * 0.9
print(f"After 10% discount: ${discounted:.2f}")
```

</details>

---

### Bug 3: The Unmodified Counter

```python
counter = 0

def increment():
    counter += 1

def get_counter():
    return counter

increment()
increment()
increment()
print(f"Counter: {get_counter()}")

# Expected: Counter: 3
# Actual: UnboundLocalError: local variable 'counter' referenced before assignment
```

<details>
<summary><strong>Bug Explanation</strong></summary>

When Python sees `counter += 1` (which is `counter = counter + 1`), it treats `counter` as a **local** variable because of the assignment. But it hasn't been defined locally yet, so reading it on the right side of `+=` raises `UnboundLocalError`.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
counter = 0

def increment():
    global counter  # <-- FIX: declare as global
    counter += 1

def get_counter():
    return counter

increment()
increment()
increment()
print(f"Counter: {get_counter()}")  # Counter: 3

# Better approach: avoid global state
class Counter:
    def __init__(self):
        self.value = 0

    def increment(self):
        self.value += 1

    def get(self):
        return self.value

c = Counter()
c.increment()
c.increment()
c.increment()
print(f"Counter: {c.get()}")  # Counter: 3
```

</details>

---

## Medium

### Bug 4: The Broken Button Factory

```python
def create_buttons():
    """Create 5 buttons that should print their index when clicked"""
    buttons = []
    for i in range(5):
        def on_click():
            print(f"Button {i} clicked")
        buttons.append(on_click)
    return buttons

buttons = create_buttons()
for btn in buttons:
    btn()

# Expected:
# Button 0 clicked
# Button 1 clicked
# Button 2 clicked
# Button 3 clicked
# Button 4 clicked

# Actual:
# Button 4 clicked
# Button 4 clicked
# Button 4 clicked
# Button 4 clicked
# Button 4 clicked
```

<details>
<summary><strong>Bug Explanation</strong></summary>

This is the **late binding closure** problem. All `on_click` functions share the same closure variable `i`. By the time any button is clicked, the loop has finished and `i` equals `4`.

The closure captures the **variable** `i`, not its **value** at the time of function creation.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
# Fix 1: Default argument captures current value
def create_buttons_v1():
    buttons = []
    for i in range(5):
        def on_click(i=i):  # <-- FIX: default arg captures current i
            print(f"Button {i} clicked")
        buttons.append(on_click)
    return buttons

# Fix 2: Use functools.partial
from functools import partial

def create_buttons_v2():
    def on_click(i):
        print(f"Button {i} clicked")
    return [partial(on_click, i) for i in range(5)]

# Fix 3: Factory function creates a new scope
def create_buttons_v3():
    def make_handler(i):
        def on_click():
            print(f"Button {i} clicked")
        return on_click
    return [make_handler(i) for i in range(5)]

print("=== Fix 1 (default arg) ===")
for btn in create_buttons_v1():
    btn()

print("\n=== Fix 2 (partial) ===")
for btn in create_buttons_v2():
    btn()

print("\n=== Fix 3 (factory) ===")
for btn in create_buttons_v3():
    btn()
```

</details>

---

### Bug 5: The Confused Merger

```python
def merge_configs(*configs, **overrides):
    """Merge multiple config dicts and apply overrides"""
    result = {}
    for config in configs:
        result.update(config)
    result.update(overrides)
    return result

# This works fine:
base = {"host": "localhost", "port": 8080}
prod = {"host": "prod.example.com", "debug": False}
merged = merge_configs(base, prod, port=443)
print(merged)

# But this fails:
def apply_defaults(func, defaults):
    """Call func with default keyword arguments"""
    return func(**defaults)

defaults = {"host": "localhost", "port": 8080, "debug": True}
extra = {"port": 443}

# Trying to pass both defaults and extra overrides
try:
    result = merge_configs(**defaults, **extra)
    print(result)
except TypeError as e:
    print(f"Error: {e}")

# Expected: {'host': 'localhost', 'port': 443, 'debug': True}
# Actual: TypeError: merge_configs() got multiple values for keyword argument 'port'
```

<details>
<summary><strong>Bug Explanation</strong></summary>

When using `**defaults, **extra` in a function call, Python merges them into a single `**kwargs`. Since both have the key `"port"`, Python raises a `TypeError` about duplicate keyword arguments — this happens **before** the function body executes.

This is different from `dict.update()` behavior, which silently overwrites duplicates.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
def merge_configs(*configs, **overrides):
    """Merge multiple config dicts and apply overrides"""
    result = {}
    for config in configs:
        result.update(config)
    result.update(overrides)
    return result

defaults = {"host": "localhost", "port": 8080, "debug": True}
extra = {"port": 443}

# Fix 1: Merge the dicts before unpacking
merged_kwargs = {**defaults, **extra}  # Dict merge handles duplicates
result = merge_configs(**merged_kwargs)
print(f"Fix 1: {result}")

# Fix 2: Pass as positional dict arguments
result = merge_configs(defaults, extra)
print(f"Fix 2: {result}")

# Fix 3: Use | operator (Python 3.9+)
result = merge_configs(defaults | extra)
print(f"Fix 3: {result}")
```

</details>

---

### Bug 6: The Broken Timer Decorator

```python
import time

def timer(func):
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        end = time.time()
        print(f"{func.__name__} took {end - start:.4f}s")
        return result
    return wrapper

@timer
def fetch_data(url):
    """Fetch data from a URL"""
    time.sleep(0.1)  # Simulate network call
    return {"data": "result"}

# Bug 1: Lost metadata
print(f"Function name: {fetch_data.__name__}")  # 'wrapper', not 'fetch_data'
print(f"Docstring: {fetch_data.__doc__}")        # None

# Bug 2: Can't access the original function
# help(fetch_data)  # Shows wrapper's info

# Bug 3: Breaks introspection
import inspect
print(f"Signature: {inspect.signature(fetch_data)}")  # (*args, **kwargs)
```

<details>
<summary><strong>Bug Explanation</strong></summary>

Three bugs:
1. The wrapper function replaces the original function's `__name__`, `__doc__`, and other metadata
2. There's no way to access the original unwrapped function
3. `inspect.signature()` shows the generic `(*args, **kwargs)` instead of `(url)`

The fix is to use `@functools.wraps(func)` which copies metadata and adds `__wrapped__`.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
import time
import functools

def timer(func):
    @functools.wraps(func)  # <-- FIX: preserves metadata
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        end = time.time()
        print(f"{func.__name__} took {end - start:.4f}s")
        return result
    return wrapper

@timer
def fetch_data(url):
    """Fetch data from a URL"""
    time.sleep(0.1)
    return {"data": "result"}

# Now metadata is preserved
print(f"Function name: {fetch_data.__name__}")  # 'fetch_data'
print(f"Docstring: {fetch_data.__doc__}")        # 'Fetch data from a URL'

# Can access original via __wrapped__
print(f"Original: {fetch_data.__wrapped__}")

# Signature is correct
import inspect
print(f"Signature: {inspect.signature(fetch_data)}")  # (url)
```

</details>

---

### Bug 7: The Surprising Shadow

```python
def process_data(items):
    """Process a list of items"""
    # Filter valid items
    list = [item for item in items if item > 0]  # Bug: shadowing builtin!

    # Get unique items
    set = {item for item in list}  # Bug: shadowing builtin!

    # Sort them
    sorted_items = sorted(set)  # Bug: 'sorted' still works, but...

    # Calculate stats
    total = sum(sorted_items)
    count = len(sorted_items)

    return {
        "items": list,        # Using shadowed name
        "unique": set,        # Using shadowed name
        "sorted": sorted_items,
        "total": total,
        "count": count,
    }

# This might work the first time...
result = process_data([3, -1, 4, 1, 5, 9, 2, 6, 5, 3])
print(result)

# But now try to use builtins after calling this function:
# list() still works at module level because the shadowing is local
# However, INSIDE the function, you can't use list() or set() as constructors

# The real bug shows when you try this inside the function:
def process_data_v2(items):
    list = [item for item in items if item > 0]

    # Now try to use list() as a constructor:
    try:
        copy = list(items)  # TypeError: 'list' object is not callable!
    except TypeError as e:
        print(f"Bug! {e}")

    return list

process_data_v2([1, 2, 3])
```

<details>
<summary><strong>Bug Explanation</strong></summary>

The code uses `list` and `set` as variable names, **shadowing** the Python builtin functions `list()` and `set()`. Within the function's scope, `list` no longer refers to the type constructor but to the local variable. Any attempt to use `list()` or `set()` as constructors within the function will fail with a `TypeError`.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
def process_data(items):
    """Process a list of items"""
    # Use descriptive names that don't shadow builtins
    valid_items = [item for item in items if item > 0]
    unique_items = set(valid_items)  # Now set() works as a constructor
    sorted_items = sorted(unique_items)

    total = sum(sorted_items)
    count = len(sorted_items)

    return {
        "items": valid_items,
        "unique": unique_items,
        "sorted": sorted_items,
        "total": total,
        "count": count,
    }

result = process_data([3, -1, 4, 1, 5, 9, 2, 6, 5, 3])
print(result)

# Common builtin names to NEVER use as variables:
# list, dict, set, tuple, str, int, float, bool, type,
# id, input, print, len, range, map, filter, zip, sum,
# min, max, sorted, reversed, enumerate, any, all, hash,
# format, open, file, dir, help, next, iter, super, object
```

</details>

---

## Hard

### Bug 8: The Leaky Accumulator

```python
def make_accumulator(initial_values):
    """Create an accumulator that tracks values"""
    values = initial_values  # Bug 1: aliasing, not copying!

    def add(x):
        values.append(x)
        return sum(values)

    def reset():
        nonlocal values
        values = []  # Bug 2: creates new list, closure still has old ref in add()
        # Actually: nonlocal rebinds 'values' for both add and reset (same cell)
        # The real bug is that reset works, but the original list is still modified

    def get():
        return values

    return add, reset, get

# Setup
original = [1, 2, 3]
add, reset, get = make_accumulator(original)

# Bug 1: original list is modified!
add(4)
print(f"Accumulator: {get()}")    # [1, 2, 3, 4]
print(f"Original: {original}")    # [1, 2, 3, 4]  <-- BUG! Should be [1, 2, 3]

# After reset, add still works but original was already modified
reset()
add(10)
print(f"After reset+add: {get()}")  # [10]
print(f"Original: {original}")      # [1, 2, 3, 4]  <-- permanently damaged
```

<details>
<summary><strong>Bug Explanation</strong></summary>

Two bugs:

1. **Aliasing instead of copying:** `values = initial_values` doesn't copy the list — it creates an alias. Modifying `values` also modifies `initial_values` (they're the same object).

2. **Reset behavior:** While `nonlocal values; values = []` does correctly rebind the shared cell variable (all three functions — add, reset, get — share the same cell), the original list has already been mutated and that damage cannot be undone.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
def make_accumulator(initial_values):
    """Create an accumulator that tracks values"""
    values = list(initial_values)  # <-- FIX 1: copy the list

    def add(x):
        nonlocal values
        values.append(x)
        return sum(values)

    def reset():
        nonlocal values
        values = list(initial_values)  # <-- FIX 2: reset to a copy of initial

    def get():
        return list(values)  # <-- FIX 3: return a copy to prevent external mutation

    return add, reset, get

original = [1, 2, 3]
add, reset, get = make_accumulator(original)

add(4)
print(f"Accumulator: {get()}")  # [1, 2, 3, 4]
print(f"Original: {original}")  # [1, 2, 3]  <-- safe!

reset()
add(10)
print(f"After reset+add: {get()}")  # [1, 2, 3, 10]
print(f"Original: {original}")      # [1, 2, 3]  <-- still safe!
```

</details>

---

### Bug 9: The Phantom Generator

```python
def create_processors(operations):
    """Create a list of data processors from operation configs"""
    processors = []

    for op in operations:
        name = op["name"]
        params = op.get("params", {})

        # Create a generator-based processor
        def process(data, name=name, params=params):  # Default arg fix for name
            for item in data:
                if name == "double":
                    yield item * params.get("factor", 2)
                elif name == "filter":
                    if item > params.get("threshold", 0):
                        yield item
                elif name == "offset":
                    yield item + params.get("amount", 0)

        processors.append(process)

    return processors

# Setup
operations = [
    {"name": "double", "params": {"factor": 3}},
    {"name": "filter", "params": {"threshold": 5}},
    {"name": "offset", "params": {"amount": 10}},
]

processors = create_processors(operations)
data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# Bug: params dict is mutable and shared!
operations[0]["params"]["factor"] = 100  # Modify after creation

# Process data through each processor
for proc in processors:
    result = list(proc(data))
    print(f"Result: {result}")

# Expected for "double": [3, 6, 9, 12, 15, 18, 21, 24, 27, 30] (factor=3)
# Actual for "double":   [100, 200, 300, ...] (factor=100) <-- BUG!
```

<details>
<summary><strong>Bug Explanation</strong></summary>

While the code correctly uses default arguments to capture `name`, the `params` default argument captures a **reference to the dict**, not a copy. When the original `operations[0]["params"]` is modified after `create_processors()` returns, the default argument still references the same dict object.

The default argument `params=params` binds the variable to the dict object at definition time — but since dicts are mutable, external changes to that dict are visible through the default.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
def create_processors(operations):
    """Create a list of data processors from operation configs"""
    processors = []

    for op in operations:
        name = op["name"]
        params = dict(op.get("params", {}))  # <-- FIX: copy the dict

        def process(data, name=name, params=params):
            for item in data:
                if name == "double":
                    yield item * params.get("factor", 2)
                elif name == "filter":
                    if item > params.get("threshold", 0):
                        yield item
                elif name == "offset":
                    yield item + params.get("amount", 0)

        processors.append(process)

    return processors

# Alternative fix using a factory function for complete isolation:
def create_processors_v2(operations):
    def make_processor(name, params):
        params = dict(params)  # Defensive copy
        def process(data):
            for item in data:
                if name == "double":
                    yield item * params.get("factor", 2)
                elif name == "filter":
                    if item > params.get("threshold", 0):
                        yield item
                elif name == "offset":
                    yield item + params.get("amount", 0)
        return process

    return [make_processor(op["name"], op.get("params", {})) for op in operations]

# Test
operations = [
    {"name": "double", "params": {"factor": 3}},
    {"name": "filter", "params": {"threshold": 5}},
    {"name": "offset", "params": {"amount": 10}},
]

processors = create_processors(operations)
operations[0]["params"]["factor"] = 100  # This no longer affects processors

data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
for proc in processors:
    result = list(proc(data))
    print(f"Result: {result}")
# double now correctly uses factor=3
```

</details>

---

### Bug 10: The Recursive Trap

```python
def make_tree_printer(indent_char="  "):
    """Create a function that pretty-prints a tree structure"""

    def print_tree(node, depth=0):
        """Print a tree node and its children recursively"""
        prefix = indent_char * depth
        print(f"{prefix}{node['name']}")

        children = node.get("children", [])

        # Bug: This modifies the original tree!
        children.sort(key=lambda c: c["name"])

        for child in children:
            print_tree(child, depth + 1)

    return print_tree

# Setup
tree = {
    "name": "root",
    "children": [
        {
            "name": "charlie",
            "children": [
                {"name": "zeta"},
                {"name": "alpha"},
            ]
        },
        {"name": "alice"},
        {"name": "bob"},
    ]
}

# Print the tree (this sorts it as a side effect!)
printer = make_tree_printer()
print("=== First print ===")
printer(tree)

# Original tree is now sorted — might break other code
print(f"\nOriginal order: {[c['name'] for c in tree['children']]}")
# Expected: ['charlie', 'alice', 'bob']
# Actual:   ['alice', 'bob', 'charlie']  <-- BUG! Tree was mutated!

# Even worse: if you have code that depends on insertion order
import json
print(f"\nTree is modified:\n{json.dumps(tree, indent=2)}")
```

<details>
<summary><strong>Bug Explanation</strong></summary>

`children.sort()` sorts the list **in place**, modifying the original tree structure. The function is supposed to only **print** the tree, but it has the side effect of permanently reordering all children. This is especially dangerous because:

1. The caller doesn't expect a "print" function to modify data
2. The mutation happens at every level of the tree
3. The bug is silent — no error is raised

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
def make_tree_printer(indent_char="  "):
    """Create a function that pretty-prints a tree structure"""

    def print_tree(node, depth=0):
        prefix = indent_char * depth
        print(f"{prefix}{node['name']}")

        children = node.get("children", [])

        # FIX: Use sorted() which returns a NEW list instead of sort() which mutates
        for child in sorted(children, key=lambda c: c["name"]):
            print_tree(child, depth + 1)

    return print_tree

tree = {
    "name": "root",
    "children": [
        {
            "name": "charlie",
            "children": [
                {"name": "zeta"},
                {"name": "alpha"},
            ]
        },
        {"name": "alice"},
        {"name": "bob"},
    ]
}

printer = make_tree_printer()
print("=== Print (sorted display) ===")
printer(tree)

print(f"\nOriginal order preserved: {[c['name'] for c in tree['children']]}")
# ['charlie', 'alice', 'bob'] — unchanged!
```

</details>

---

### Bug 11 (Bonus): The Cascading Disaster

This function has **multiple** interacting bugs. Find all of them.

```python
import time

def create_rate_limiter(max_calls=5, period=60, log=[]):
    """Create a rate limiter that limits function calls"""
    call_times = []

    def limiter(func):
        def wrapper(*args, **kwargs):
            now = time.time()

            # Clean up old entries
            while call_times and call_times[0] < now - period:
                call_times.pop()  # Bug 1: pop() removes from the END, not beginning

            if len(call_times) >= max_calls:
                log.append(f"Rate limited: {func.__name__}")  # Bug 2: mutable default
                return None  # Bug 3: silent failure, no indication to caller

            call_times.append(now)
            log.append(f"Called: {func.__name__}")
            result = func(*args, **kwargs)
            # Bug 4: no return statement for the result!

        return wrapper
    return limiter

# Usage
@create_rate_limiter(max_calls=2, period=1)
def api_call(endpoint):
    """Call an API endpoint"""
    return f"Response from {endpoint}"

# Test
for i in range(5):
    result = api_call(f"/api/{i}")
    print(f"Call {i}: {result}")

# Expected:
# Call 0: Response from /api/0
# Call 1: Response from /api/1
# Call 2: None (rate limited)
# Call 3: None (rate limited)
# Call 4: None (rate limited)

# Actual:
# Call 0: None  <-- Bug 4!
# Call 1: None
# Call 2: None
# etc.
```

<details>
<summary><strong>Bug Explanation</strong></summary>

**Bug 1: `call_times.pop()` removes from the wrong end.**
`list.pop()` without an argument removes the **last** element. Since `call_times` is appended to chronologically, the oldest entries are at the beginning. We need `call_times.pop(0)` or better yet, use a different approach.

**Bug 2: Mutable default `log=[]`.**
The default `log` list is shared across all calls to `create_rate_limiter()`. Creating multiple rate limiters without explicitly passing `log` means they all share the same log.

**Bug 3: Silent failure on rate limit.**
Returning `None` silently is bad practice. The caller has no way to distinguish between "rate limited" and "function returned None naturally."

**Bug 4: Missing `return` in wrapper.**
The wrapper function calls `func(*args, **kwargs)` and stores the result, but never returns it. So the wrapper always returns `None`.

</details>

<details>
<summary><strong>Fixed Code</strong></summary>

```python
import time
import functools
from collections import deque

class RateLimitExceeded(Exception):
    """Raised when rate limit is exceeded"""
    pass

def create_rate_limiter(max_calls=5, period=60, log=None):
    """Create a rate limiter that limits function calls"""
    if log is None:  # FIX Bug 2: don't use mutable default
        log = []

    call_times = deque()  # deque is more efficient for popleft

    def limiter(func):
        @functools.wraps(func)  # Bonus fix: preserve metadata
        def wrapper(*args, **kwargs):
            now = time.time()

            # Clean up old entries
            while call_times and call_times[0] < now - period:
                call_times.popleft()  # FIX Bug 1: remove from the LEFT (oldest)

            if len(call_times) >= max_calls:
                log.append(f"Rate limited: {func.__name__}")
                raise RateLimitExceeded(  # FIX Bug 3: raise exception instead of silent None
                    f"{func.__name__} rate limit exceeded: "
                    f"{max_calls} calls per {period}s"
                )

            call_times.append(now)
            log.append(f"Called: {func.__name__}")
            result = func(*args, **kwargs)
            return result  # FIX Bug 4: actually return the result!

        return wrapper
    return limiter

# Usage
@create_rate_limiter(max_calls=2, period=1)
def api_call(endpoint):
    """Call an API endpoint"""
    return f"Response from {endpoint}"

for i in range(5):
    try:
        result = api_call(f"/api/{i}")
        print(f"Call {i}: {result}")
    except RateLimitExceeded as e:
        print(f"Call {i}: BLOCKED - {e}")

# Now we get:
# Call 0: Response from /api/0
# Call 1: Response from /api/1
# Call 2: BLOCKED - api_call rate limit exceeded: 2 calls per 1s
# Call 3: BLOCKED - ...
# Call 4: BLOCKED - ...
```

</details>

---

## Summary

### Bug Pattern Checklist

When reviewing Python functions, always check for:

- [ ] **Mutable default arguments** — use `None` and create inside function
- [ ] **Missing return statements** — especially when chaining results
- [ ] **Scope confusion** — `global` / `nonlocal` when modifying outer variables
- [ ] **Late binding closures** — use default args or factory functions
- [ ] **Argument unpacking conflicts** — `**dict1, **dict2` with overlapping keys
- [ ] **Missing `@functools.wraps`** — on all decorator wrappers
- [ ] **Shadowing builtins** — never use `list`, `dict`, `set`, `str`, etc. as variable names
- [ ] **Aliasing vs copying** — `a = b` vs `a = list(b)` for mutable objects
- [ ] **In-place vs new** — `list.sort()` vs `sorted(list)`
- [ ] **Silent failures** — functions returning `None` unexpectedly
