# Variables and Data Types — Find the Bug

> Find and fix the bug in each code snippet. Each exercise contains exactly one bug related to variables and data types.

---

## Bug 1: The Disappearing Default (Junior)

```python
def add_student(name, students=[]):
    """Add a student to the list and return the list."""
    students.append(name)
    return students


# Expected: each call returns a list with only one student
result1 = add_student("Alice")
result2 = add_student("Bob")
result3 = add_student("Charlie")

print(result1)  # Expected: ["Alice"]
print(result2)  # Expected: ["Bob"]
print(result3)  # Expected: ["Charlie"]
```

<details>
<summary>Bug</summary>

The default argument `students=[]` is created once at function definition time and shared across all calls.

</details>

<details>
<summary>Fix</summary>

```python
def add_student(name, students=None):
    """Add a student to the list and return the list."""
    if students is None:
        students = []
    students.append(name)
    return students

result1 = add_student("Alice")
result2 = add_student("Bob")
result3 = add_student("Charlie")

print(result1)  # ["Alice"]
print(result2)  # ["Bob"]
print(result3)  # ["Charlie"]
```

</details>

---

## Bug 2: Wrong Comparison (Junior)

```python
def check_none(value):
    """Check if a value is None."""
    if value == None:
        return "Value is None"
    elif value == False:
        return "Value is False"
    elif value == 0:
        return "Value is zero"
    else:
        return f"Value is {value}"


# This function gives wrong results for some inputs
print(check_none(None))     # Expected: "Value is None"     -> OK
print(check_none(False))    # Expected: "Value is False"    -> BUG: "Value is None"? No, gets "Value is False"
print(check_none(0))        # Expected: "Value is zero"     -> BUG: returns "Value is False"
print(check_none(""))       # Expected: "Value is "         -> OK
```

<details>
<summary>Bug</summary>

`0 == False` is `True` in Python because `bool` is a subclass of `int`. The function uses `==` instead of `is` for singleton/identity checks. When `value=0`, it matches `value == False` before reaching `value == 0`.

</details>

<details>
<summary>Fix</summary>

```python
def check_none(value):
    """Check if a value is None, False, or zero — using identity for singletons."""
    if value is None:
        return "Value is None"
    elif value is False:
        return "Value is False"
    elif value == 0:
        return "Value is zero"
    else:
        return f"Value is {value}"

print(check_none(None))     # "Value is None"
print(check_none(False))    # "Value is False"
print(check_none(0))        # "Value is zero"
print(check_none(""))       # "Value is "
```

</details>

---

## Bug 3: The Shared List (Junior)

```python
def create_matrix(rows, cols, default=0):
    """Create a matrix (list of lists) filled with default value."""
    row = [default] * cols
    matrix = [row] * rows
    return matrix


grid = create_matrix(3, 3, 0)
grid[0][0] = 99
print(grid)
# Expected: [[99, 0, 0], [0, 0, 0], [0, 0, 0]]
# Actual:   [[99, 0, 0], [99, 0, 0], [99, 0, 0]]
```

<details>
<summary>Bug</summary>

`[row] * rows` creates a list with `rows` references to the SAME list object. Modifying one row modifies all of them.

</details>

<details>
<summary>Fix</summary>

```python
def create_matrix(rows, cols, default=0):
    """Create a matrix (list of lists) filled with default value."""
    return [[default] * cols for _ in range(rows)]


grid = create_matrix(3, 3, 0)
grid[0][0] = 99
print(grid)  # [[99, 0, 0], [0, 0, 0], [0, 0, 0]]
```

</details>

---

## Bug 4: Float Precision (Junior)

```python
def calculate_total(prices):
    """Calculate total price with tax."""
    subtotal = sum(prices)
    tax = subtotal * 0.1
    total = subtotal + tax

    # Verify the math
    expected = 33.0
    if total == expected:
        print(f"Total: ${total:.2f} - CORRECT")
    else:
        print(f"Total: ${total:.2f} - ERROR! Expected ${expected:.2f}")
    return total


prices = [10.0, 10.0, 10.0]  # subtotal = 30.0, tax = 3.0, total = 33.0
calculate_total(prices)

# Try with these prices:
prices2 = [0.1, 0.2, 0.3]  # subtotal = 0.6, tax = 0.06, total = 0.66
# But 0.1 + 0.2 + 0.3 != 0.6 in floating point!
total = sum(prices2)
print(f"0.1 + 0.2 + 0.3 = {total}")  # Not exactly 0.6
print(f"Equal to 0.6? {total == 0.6}")  # False!
```

<details>
<summary>Bug</summary>

Floating-point arithmetic introduces precision errors. `0.1 + 0.2 + 0.3` does not equal `0.6` exactly due to IEEE 754 representation.

</details>

<details>
<summary>Fix</summary>

```python
import math
from decimal import Decimal


def calculate_total(prices):
    """Calculate total price with tax — using proper float comparison."""
    subtotal = sum(prices)
    tax = subtotal * 0.1
    total = subtotal + tax

    expected = 33.0
    if math.isclose(total, expected, rel_tol=1e-9):
        print(f"Total: ${total:.2f} - CORRECT")
    else:
        print(f"Total: ${total:.2f} - ERROR! Expected ${expected:.2f}")
    return total


# For financial calculations, use Decimal:
def calculate_total_precise(prices: list[str]) -> Decimal:
    """Calculate total using Decimal for exact arithmetic."""
    decimal_prices = [Decimal(p) for p in prices]
    subtotal = sum(decimal_prices)
    tax = subtotal * Decimal("0.1")
    return subtotal + tax


print(calculate_total_precise(["0.1", "0.2", "0.3"]))  # 0.66 exactly
```

</details>

---

## Bug 5: Scope Confusion (Middle)

```python
x = 10

def modify():
    print(f"x before: {x}")
    x = x + 1
    print(f"x after: {x}")

modify()
```

<details>
<summary>Bug</summary>

`UnboundLocalError: local variable 'x' referenced before assignment`. Python sees `x = x + 1` and marks `x` as a local variable for the entire function. So when `print(f"x before: {x}")` runs, the local `x` has not been assigned yet.

</details>

<details>
<summary>Fix</summary>

```python
# Option 1: Use global keyword
x = 10

def modify():
    global x
    print(f"x before: {x}")
    x = x + 1
    print(f"x after: {x}")

modify()

# Option 2 (better): Pass as argument and return
def modify_pure(value: int) -> int:
    print(f"x before: {value}")
    value = value + 1
    print(f"x after: {value}")
    return value

x = 10
x = modify_pure(x)
```

</details>

---

## Bug 6: Late Binding Closure (Middle)

```python
def create_multipliers():
    """Create a list of multiplier functions."""
    multipliers = []
    for i in range(5):
        multipliers.append(lambda x: x * i)
    return multipliers


mults = create_multipliers()
print(mults[0](10))  # Expected: 0,  Actual: 40
print(mults[1](10))  # Expected: 10, Actual: 40
print(mults[2](10))  # Expected: 20, Actual: 40
print(mults[3](10))  # Expected: 30, Actual: 40
print(mults[4](10))  # Expected: 40, Actual: 40
```

<details>
<summary>Bug</summary>

All lambdas share the same enclosing variable `i`. By the time they are called, the loop has finished and `i = 4`. This is the classic late-binding closure bug.

</details>

<details>
<summary>Fix</summary>

```python
# Fix 1: Capture i as a default argument
def create_multipliers():
    multipliers = []
    for i in range(5):
        multipliers.append(lambda x, i=i: x * i)  # i=i captures current value
    return multipliers

# Fix 2: Use functools.partial
from functools import partial

def create_multipliers_v2():
    def multiply(i, x):
        return x * i
    return [partial(multiply, i) for i in range(5)]

# Fix 3: Use a factory function
def create_multipliers_v3():
    def make_mult(i):
        return lambda x: x * i
    return [make_mult(i) for i in range(5)]

mults = create_multipliers()
for idx in range(5):
    print(f"mults[{idx}](10) = {mults[idx](10)}")  # 0, 10, 20, 30, 40
```

</details>

---

## Bug 7: String Identity Trap (Middle)

```python
def cache_lookup(key, cache):
    """Look up a key in cache using identity check for performance."""
    for cached_key, value in cache.items():
        if key is cached_key:  # Using 'is' for "faster" comparison
            return value
    return None


cache = {}
cache["user_123"] = {"name": "Alice"}
cache["user_456"] = {"name": "Bob"}

# This works (string literals are interned):
print(cache_lookup("user_123", cache))  # {"name": "Alice"}

# This might fail (dynamically created string):
user_id = "user_" + str(123)
print(cache_lookup(user_id, cache))  # None! Even though user_id == "user_123"
```

<details>
<summary>Bug</summary>

Using `is` for string comparison instead of `==`. Dynamically constructed strings may not be interned, so identity comparison fails even when values are equal.

</details>

<details>
<summary>Fix</summary>

```python
def cache_lookup(key, cache):
    """Look up a key in cache using value comparison."""
    for cached_key, value in cache.items():
        if key == cached_key:  # Use == for value comparison
            return value
    return None

# Or simply use dict's built-in lookup (which uses == internally):
def cache_lookup_simple(key, cache):
    return cache.get(key)
```

</details>

---

## Bug 8: Type Coercion Surprise (Middle)

```python
def parse_config(config_str: str) -> dict:
    """Parse a simple key=value config string."""
    config = {}
    for line in config_str.strip().split("\n"):
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        # "Smart" type detection
        if value.lower() == "true":
            config[key] = True
        elif value.lower() == "false":
            config[key] = False
        elif value.isdigit():
            config[key] = int(value)
        else:
            config[key] = value

    return config


config_text = """
port = 8080
debug = true
name = MyApp
timeout = -30
ratio = 3.14
count = 0
"""

config = parse_config(config_text)
print(config)
# Bug: timeout = "-30" stays as string (isdigit() is False for negative numbers)
# Bug: ratio = "3.14" stays as string (isdigit() is False for floats)
# Bug: count = 0 is parsed as int, but what about "00" or "007"?
```

<details>
<summary>Bug</summary>

`str.isdigit()` only returns True for strings of digits (no negative sign, no decimal point). So `-30` and `3.14` are not parsed as numbers. Also, `isdigit()` returns True for Unicode digit characters like `\u00b2` (superscript 2).

</details>

<details>
<summary>Fix</summary>

```python
def parse_config(config_str: str) -> dict:
    """Parse a simple key=value config string with proper type detection."""
    config = {}
    for line in config_str.strip().split("\n"):
        if not line.strip() or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if value.lower() == "true":
            config[key] = True
        elif value.lower() == "false":
            config[key] = False
        else:
            # Try int first, then float, then keep as string
            try:
                config[key] = int(value)
            except ValueError:
                try:
                    config[key] = float(value)
                except ValueError:
                    config[key] = value

    return config

config = parse_config(config_text)
print(config)
# {'port': 8080, 'debug': True, 'name': 'MyApp', 'timeout': -30, 'ratio': 3.14, 'count': 0}
```

</details>

---

## Bug 9: Shallow Copy Trap (Senior)

```python
import copy


def process_users(users_data: list[dict]) -> list[dict]:
    """Process user data: add computed fields without modifying the original."""
    processed = users_data.copy()  # "Copy" the list

    for user in processed:
        user["full_name"] = f"{user['first_name']} {user['last_name']}"
        user["email_lower"] = user["email"].lower()

    return processed


original = [
    {"first_name": "Alice", "last_name": "Smith", "email": "Alice@Example.com"},
    {"first_name": "Bob", "last_name": "Jones", "email": "Bob@Example.com"},
]

processed = process_users(original)

# Check: did the original get modified?
print("original[0] keys:", list(original[0].keys()))
# Bug: original[0] now has 'full_name' and 'email_lower' too!
```

<details>
<summary>Bug</summary>

`users_data.copy()` is a shallow copy. It creates a new list, but the dicts inside are the same objects. Modifying `user` in the loop modifies the original dicts.

</details>

<details>
<summary>Fix</summary>

```python
import copy


def process_users(users_data: list[dict]) -> list[dict]:
    """Process user data: add computed fields without modifying the original."""
    # Option 1: Deep copy
    processed = copy.deepcopy(users_data)

    # Option 2: Create new dicts
    # processed = [{**user} for user in users_data]

    for user in processed:
        user["full_name"] = f"{user['first_name']} {user['last_name']}"
        user["email_lower"] = user["email"].lower()

    return processed

original = [
    {"first_name": "Alice", "last_name": "Smith", "email": "Alice@Example.com"},
]
processed = process_users(original)
print("original keys:", list(original[0].keys()))   # Only original keys
print("processed keys:", list(processed[0].keys()))  # Includes computed fields
```

</details>

---

## Bug 10: Boolean Arithmetic Trap (Senior)

```python
def count_active_users(users: list[dict]) -> dict:
    """Count active and inactive users."""
    active = 0
    inactive = 0

    for user in users:
        active += user["is_active"]      # True = 1, False = 0
        inactive += not user["is_active"] # not True = False = 0, not False = True = 1

    return {"active": active, "inactive": inactive, "total": active + inactive}


users = [
    {"name": "Alice", "is_active": True},
    {"name": "Bob", "is_active": False},
    {"name": "Charlie", "is_active": 1},     # 1 instead of True
    {"name": "Dave", "is_active": 0},          # 0 instead of False
    {"name": "Eve", "is_active": "yes"},       # String! Truthy but not True
    {"name": "Frank", "is_active": ""},         # Empty string! Falsy but not False
]

result = count_active_users(users)
print(result)
# Bug: "yes" adds 1 to active (because bool("yes") = True, and "yes" is truthy)
# But "yes" + 0 = "yes0"... actually no, + on str and int raises TypeError!
# Actually: active += "yes" raises TypeError: unsupported operand type(s)
```

<details>
<summary>Bug</summary>

The code assumes `is_active` is always `bool` or `int`. When `is_active` is a string like `"yes"`, `active += "yes"` raises `TypeError`. Even if it did not error, the arithmetic semantics would be wrong.

</details>

<details>
<summary>Fix</summary>

```python
def count_active_users(users: list[dict]) -> dict:
    """Count active and inactive users with proper type handling."""
    active = 0
    inactive = 0

    for user in users:
        # Convert to bool explicitly — handles any truthy/falsy value
        is_active = bool(user["is_active"])
        if is_active:
            active += 1
        else:
            inactive += 1

    return {"active": active, "inactive": inactive, "total": active + inactive}


users = [
    {"name": "Alice", "is_active": True},
    {"name": "Bob", "is_active": False},
    {"name": "Charlie", "is_active": 1},
    {"name": "Dave", "is_active": 0},
    {"name": "Eve", "is_active": "yes"},
    {"name": "Frank", "is_active": ""},
]

result = count_active_users(users)
print(result)  # {'active': 3, 'inactive': 3, 'total': 6}
```

</details>

---

## Bug 11: Global Variable Race (Senior)

```python
import threading

counter = 0


def increment(n: int) -> None:
    """Increment global counter n times."""
    global counter
    for _ in range(n):
        counter += 1  # Read, increment, write — NOT atomic!


threads = [threading.Thread(target=increment, args=(100_000,)) for _ in range(10)]
for t in threads:
    t.start()
for t in threads:
    t.join()

print(f"Expected: 1,000,000")
print(f"Actual:   {counter:,}")
# Bug: counter is usually less than 1,000,000 due to race condition
```

<details>
<summary>Bug</summary>

`counter += 1` is not atomic. It compiles to multiple bytecodes: `LOAD_GLOBAL`, `LOAD_CONST`, `BINARY_ADD`, `STORE_GLOBAL`. The GIL can release between any of these, causing lost updates.

</details>

<details>
<summary>Fix</summary>

```python
import threading

counter = 0
lock = threading.Lock()


def increment(n: int) -> None:
    """Increment global counter n times — thread-safe."""
    global counter
    for _ in range(n):
        with lock:
            counter += 1


# Or better: avoid global state entirely
from collections import defaultdict

def increment_local(n: int) -> int:
    """Return local count — no shared state."""
    return n


threads = []
results = []

def worker(n: int) -> None:
    results.append(increment_local(n))

lock2 = threading.Lock()

def worker_safe(n: int) -> None:
    count = increment_local(n)
    with lock2:
        results.append(count)

threads = [threading.Thread(target=worker_safe, args=(100_000,)) for _ in range(10)]
for t in threads:
    t.start()
for t in threads:
    t.join()

print(f"Total: {sum(results):,}")  # Always 1,000,000
```

</details>

---

## Bug 12: Dictionary Key Type Collision (Professional)

```python
def build_lookup(items: list) -> dict:
    """Build a lookup table from items."""
    lookup = {}
    for item in items:
        lookup[item["key"]] = item["value"]
    return lookup


items = [
    {"key": True, "value": "boolean_true"},
    {"key": 1, "value": "integer_one"},
    {"key": 1.0, "value": "float_one"},
    {"key": False, "value": "boolean_false"},
    {"key": 0, "value": "integer_zero"},
    {"key": 0.0, "value": "float_zero"},
]

lookup = build_lookup(items)
print(f"Number of entries: {len(lookup)}")
print(lookup)
# Expected: 6 entries
# Actual: 2 entries! Because True==1==1.0 and False==0==0.0
```

<details>
<summary>Bug</summary>

`True == 1 == 1.0` and `hash(True) == hash(1) == hash(1.0)`. Same for `False/0/0.0`. Python treats them as the same dict key, so later values overwrite earlier ones.

</details>

<details>
<summary>Fix</summary>

```python
def build_lookup(items: list) -> dict:
    """Build a lookup table with type-aware keys."""
    lookup = {}
    for item in items:
        key = item["key"]
        # Use (type_name, value) as composite key to distinguish types
        typed_key = (type(key).__name__, key)
        lookup[typed_key] = item["value"]
    return lookup


items = [
    {"key": True, "value": "boolean_true"},
    {"key": 1, "value": "integer_one"},
    {"key": 1.0, "value": "float_one"},
    {"key": False, "value": "boolean_false"},
    {"key": 0, "value": "integer_zero"},
    {"key": 0.0, "value": "float_zero"},
]

lookup = build_lookup(items)
print(f"Number of entries: {len(lookup)}")  # 6
for k, v in lookup.items():
    print(f"  {k} -> {v}")
```

</details>
