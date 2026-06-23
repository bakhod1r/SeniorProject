# Python Type Casting -- Find the Bug

> Find and fix the bug in each code snippet. Each exercise has a difficulty level and a hidden solution.

---

## Easy (4 Bugs)

### Bug 1: String Concatenation Type Error

```python
def greet(name, age):
    """Create a greeting message."""
    return "Hello, " + name + "! You are " + age + " years old."

print(greet("Alice", 30))
```

<details>
<summary>Hint</summary>
Python cannot concatenate <code>str</code> and <code>int</code> with <code>+</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** `age` is an `int`, but `+` requires all operands to be `str`.

```python
def greet(name, age):
    """Create a greeting message."""
    return f"Hello, {name}! You are {age} years old."  # FIX: use f-string

# Alternative fix:
# return "Hello, " + name + "! You are " + str(age) + " years old."

print(greet("Alice", 30))  # Hello, Alice! You are 30 years old.
```
</details>

---

### Bug 2: Comparing String Input to Integer

```python
def check_age():
    """Check if user is an adult."""
    age = input("Enter your age: ")
    if age >= 18:
        print("You are an adult.")
    else:
        print("You are a minor.")

# check_age()  # Uncomment to test
# Simulated input:
age = "25"
if age >= 18:
    print("Adult")
else:
    print("Minor")
```

<details>
<summary>Hint</summary>
<code>input()</code> returns a <code>str</code>. Comparing <code>str >= int</code> raises <code>TypeError</code> in Python 3.
</details>

<details>
<summary>Solution</summary>

**Bug:** `age` is a string, and `str >= int` raises `TypeError`.

```python
age = "25"
if int(age) >= 18:  # FIX: convert to int before comparison
    print("Adult")
else:
    print("Minor")
```
</details>

---

### Bug 3: Float String to Int

```python
def parse_price(price_str):
    """Parse a price string to integer cents."""
    return int(price_str) * 100

# Test
print(parse_price("19.99"))  # Expected: 1999
```

<details>
<summary>Hint</summary>
<code>int("19.99")</code> raises <code>ValueError</code>. You need an intermediate step.
</details>

<details>
<summary>Solution</summary>

**Bug:** `int()` cannot parse a float string directly.

```python
def parse_price(price_str):
    """Parse a price string to integer cents."""
    return int(float(price_str) * 100)  # FIX: convert to float first

# Alternative with better precision:
def parse_price_precise(price_str):
    from decimal import Decimal
    return int(Decimal(price_str) * 100)

print(parse_price("19.99"))         # 1999
print(parse_price_precise("19.99")) # 1999
```
</details>

---

### Bug 4: Boolean Parsing from String

```python
def load_config(settings):
    """Load settings and cast boolean values."""
    debug = bool(settings.get("debug", "false"))
    verbose = bool(settings.get("verbose", "false"))
    return {"debug": debug, "verbose": verbose}

config = load_config({"debug": "false", "verbose": "true"})
print(config)
# Expected: {'debug': False, 'verbose': True}
# Actual: ???
```

<details>
<summary>Hint</summary>
<code>bool("false")</code> is <code>True</code> because <code>"false"</code> is a non-empty string.
</details>

<details>
<summary>Solution</summary>

**Bug:** `bool("false")` returns `True` because any non-empty string is truthy.

```python
def load_config(settings):
    """Load settings and cast boolean values."""
    debug = settings.get("debug", "false").lower() == "true"      # FIX
    verbose = settings.get("verbose", "false").lower() == "true"   # FIX
    return {"debug": debug, "verbose": verbose}

config = load_config({"debug": "false", "verbose": "true"})
print(config)  # {'debug': False, 'verbose': True}
```
</details>

---

## Medium (4 Bugs)

### Bug 5: Silent Data Loss with int()

```python
def calculate_average(scores_str):
    """Calculate average from a comma-separated string of scores."""
    scores = scores_str.split(",")
    total = sum(int(s) for s in scores)
    average = total / len(scores)
    return average

# Test
result = calculate_average("85,92,78.5,90,88.5")
print(f"Average: {result}")  # Expected: 86.8, but some scores are floats!
```

<details>
<summary>Hint</summary>
<code>int("78.5")</code> raises <code>ValueError</code>. Even if it didn't, <code>int()</code> truncates.
</details>

<details>
<summary>Solution</summary>

**Bug:** Some scores have decimal points. `int("78.5")` raises `ValueError`, and even if we used `int(float(...))`, we would lose precision.

```python
def calculate_average(scores_str):
    """Calculate average from a comma-separated string of scores."""
    scores = scores_str.split(",")
    total = sum(float(s.strip()) for s in scores)  # FIX: use float() instead of int()
    average = total / len(scores)
    return average

result = calculate_average("85,92,78.5,90,88.5")
print(f"Average: {result}")  # Average: 86.8
```
</details>

---

### Bug 6: isinstance Check Order

```python
def classify_value(value):
    """Classify a value by its type."""
    if isinstance(value, int):
        return "integer"
    elif isinstance(value, bool):
        return "boolean"
    elif isinstance(value, float):
        return "float"
    elif isinstance(value, str):
        return "string"
    return "unknown"

# Test
print(classify_value(True))    # Expected: "boolean"
print(classify_value(42))      # Expected: "integer"
print(classify_value(3.14))    # Expected: "float"
```

<details>
<summary>Hint</summary>
<code>bool</code> is a subclass of <code>int</code>. <code>isinstance(True, int)</code> is <code>True</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** `bool` is checked AFTER `int`, but since `bool` is a subclass of `int`, `isinstance(True, int)` returns `True` and the `bool` branch is never reached.

```python
def classify_value(value):
    """Classify a value by its type."""
    if isinstance(value, bool):       # FIX: check bool FIRST
        return "boolean"
    elif isinstance(value, int):
        return "integer"
    elif isinstance(value, float):
        return "float"
    elif isinstance(value, str):
        return "string"
    return "unknown"

print(classify_value(True))    # "boolean" (correct!)
print(classify_value(42))      # "integer"
print(classify_value(3.14))    # "float"
```
</details>

---

### Bug 7: Loss of Large Integer Precision

```python
def transfer_id(id_string):
    """Convert a large ID string to an integer for processing."""
    # Convert via float for 'scientific notation support'
    return int(float(id_string))

# Test
id_str = "9007199254740993"
result = transfer_id(id_str)
expected = 9007199254740993
print(f"Expected: {expected}")
print(f"Got:      {result}")
print(f"Match:    {result == expected}")
```

<details>
<summary>Hint</summary>
<code>float</code> has only 53 bits of precision (IEEE 754). Large integers lose precision when routed through <code>float</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** `float` has 53 bits of mantissa precision. The integer `9007199254740993` exceeds this, so `float()` rounds it to `9007199254740992.0`, and `int()` gives the wrong value.

```python
def transfer_id(id_string):
    """Convert a large ID string to an integer for processing."""
    # FIX: convert directly to int, don't go through float
    return int(id_string)

id_str = "9007199254740993"
result = transfer_id(id_str)
expected = 9007199254740993
print(f"Expected: {expected}")
print(f"Got:      {result}")
print(f"Match:    {result == expected}")  # True
```
</details>

---

### Bug 8: dict() from Duplicate Keys

```python
def merge_pairs(pair_list):
    """Merge a list of key-value pairs into a dictionary."""
    result = dict(pair_list)
    # Verify all items are preserved
    assert len(result) == len(pair_list), "All items should be in the dict"
    return result

# Test
pairs = [("name", "Alice"), ("age", "30"), ("name", "Bob")]
print(merge_pairs(pairs))
```

<details>
<summary>Hint</summary>
<code>dict()</code> silently overwrites duplicate keys. The last value wins.
</details>

<details>
<summary>Solution</summary>

**Bug:** `dict()` silently drops duplicate keys (keeping the last value). The assertion fails because 3 pairs become 2 dict entries.

```python
from collections import defaultdict


def merge_pairs(pair_list):
    """Merge a list of key-value pairs, collecting duplicates into lists."""
    result = defaultdict(list)
    for key, value in pair_list:
        result[key].append(value)
    return dict(result)  # FIX: preserve all values


# Alternative: detect and warn about duplicates
def merge_pairs_strict(pair_list):
    result = {}
    for key, value in pair_list:
        if key in result:
            raise ValueError(f"Duplicate key: {key!r}")
        result[key] = value
    return result


pairs = [("name", "Alice"), ("age", "30"), ("name", "Bob")]
print(merge_pairs(pairs))
# {'name': ['Alice', 'Bob'], 'age': ['30']}
```
</details>

---

## Hard (4 Bugs)

### Bug 9: Custom __bool__ vs __len__ Conflict

```python
class TaskQueue:
    def __init__(self):
        self.tasks = []
        self.completed = 0

    def add(self, task):
        self.tasks.append(task)

    def complete(self, task):
        self.tasks.remove(task)
        self.completed += 1

    def __len__(self):
        """Return total tasks processed (completed + pending)."""
        return self.completed + len(self.tasks)

    def __bool__(self):
        """Return True if there are pending tasks."""
        return len(self.tasks) > 0


q = TaskQueue()
print(f"Empty queue bool: {bool(q)}")  # False (no pending tasks)
print(f"Empty queue len:  {len(q)}")   # 0

q.add("task1")
q.add("task2")
q.complete("task1")

print(f"After work bool:  {bool(q)}")  # True (1 pending task)
print(f"After work len:   {len(q)}")   # 2 (1 completed + 1 pending)

# Bug: complete all tasks
q.complete("task2")
print(f"All done bool: {bool(q)}")     # False (no pending)
print(f"All done len:  {len(q)}")      # 2 (2 completed + 0 pending)

# The bug: using 'if q' after all tasks are done
if q:
    print("Queue has work")
else:
    print("Queue is idle")

# But len(q) == 2, which is confusing!
# The semantics of __bool__ and __len__ are inconsistent.
```

<details>
<summary>Hint</summary>
When <code>bool()</code> returns <code>False</code> but <code>len()</code> returns non-zero, it confuses users. The semantics should be consistent.
</details>

<details>
<summary>Solution</summary>

**Bug:** `__bool__` and `__len__` have inconsistent semantics. `len(q) == 2` but `bool(q) == False`. This violates the principle of least surprise.

```python
class TaskQueue:
    def __init__(self):
        self._pending = []
        self._completed_count = 0

    def add(self, task):
        self._pending.append(task)

    def complete(self, task):
        self._pending.remove(task)
        self._completed_count += 1

    def __len__(self):
        """Return number of PENDING tasks (consistent with __bool__)."""
        return len(self._pending)  # FIX: len = pending count

    def __bool__(self):
        """Return True if there are pending tasks."""
        return len(self._pending) > 0

    @property
    def total_processed(self) -> int:
        """Total tasks ever processed (separate from len)."""
        return self._completed_count + len(self._pending)


q = TaskQueue()
q.add("task1")
q.add("task2")
q.complete("task1")
q.complete("task2")

print(f"bool(q): {bool(q)}")           # False
print(f"len(q):  {len(q)}")            # 0 (consistent!)
print(f"total:   {q.total_processed}") # 2
```
</details>

---

### Bug 10: NaN Comparison Trap

```python
def find_invalid_readings(readings):
    """Find readings that are NaN (not a number)."""
    invalid = []
    for i, reading in enumerate(readings):
        value = float(reading)
        if value == float("nan"):
            invalid.append(i)
    return invalid

# Test
readings = ["3.14", "nan", "2.71", "nan", "1.41"]
result = find_invalid_readings(readings)
print(f"Invalid indices: {result}")  # Expected: [1, 3]
# Actual: ???
```

<details>
<summary>Hint</summary>
<code>float("nan") == float("nan")</code> is <code>False</code> (IEEE 754 standard).
</details>

<details>
<summary>Solution</summary>

**Bug:** `NaN != NaN` by IEEE 754 standard. The equality check `value == float("nan")` always returns `False`.

```python
import math


def find_invalid_readings(readings):
    """Find readings that are NaN (not a number)."""
    invalid = []
    for i, reading in enumerate(readings):
        value = float(reading)
        if math.isnan(value):  # FIX: use math.isnan()
            invalid.append(i)
    return invalid

readings = ["3.14", "nan", "2.71", "nan", "1.41"]
result = find_invalid_readings(readings)
print(f"Invalid indices: {result}")  # [1, 3]
```
</details>

---

### Bug 11: __int__ vs __index__ for Slicing

```python
class Offset:
    """Represents an offset value for array access."""
    def __init__(self, value):
        self.value = value

    def __int__(self):
        return int(self.value)

data = [10, 20, 30, 40, 50]
offset = Offset(2)

# This works:
print(f"int(offset) = {int(offset)}")

# This fails:
try:
    print(f"data[offset] = {data[offset]}")
except TypeError as e:
    print(f"Error: {e}")

# This also fails:
try:
    print(f"bin(offset) = {bin(offset)}")
except TypeError as e:
    print(f"Error: {e}")
```

<details>
<summary>Hint</summary>
Indexing and <code>bin()</code> require <code>__index__</code>, not <code>__int__</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** List indexing, slicing, `bin()`, `hex()`, and `oct()` require `__index__`, not `__int__`. These operations need an **exact** integer.

```python
class Offset:
    """Represents an offset value for array access."""
    def __init__(self, value):
        self.value = value

    def __int__(self):
        return int(self.value)

    def __index__(self):  # FIX: implement __index__
        return int(self.value)

data = [10, 20, 30, 40, 50]
offset = Offset(2)

print(f"int(offset) = {int(offset)}")       # 2
print(f"data[offset] = {data[offset]}")     # 30
print(f"bin(offset) = {bin(offset)}")        # 0b10
print(f"hex(offset) = {hex(offset)}")        # 0x2
```
</details>

---

### Bug 12: Circular Import with Custom Converter

```python
class Celsius:
    def __init__(self, temp):
        self.temp = float(temp)

    def to_fahrenheit(self):
        return Fahrenheit(self.temp * 9/5 + 32)

    def __float__(self):
        return self.temp

    def __repr__(self):
        return f"Celsius({self.temp})"


class Fahrenheit:
    def __init__(self, temp):
        self.temp = float(temp)

    def to_celsius(self):
        return Celsius((self.temp - 32) * 5/9)

    def __float__(self):
        return self.temp

    def __eq__(self, other):
        if isinstance(other, Celsius):
            # Bug: infinite recursion potential
            return self == other.to_fahrenheit()
        if isinstance(other, Fahrenheit):
            return abs(self.temp - other.temp) < 0.01
        return NotImplemented

    def __repr__(self):
        return f"Fahrenheit({self.temp})"


# Test
c = Celsius(100)
f = Fahrenheit(212)
print(c.to_fahrenheit())  # Fahrenheit(212.0)

# This causes infinite recursion:
try:
    print(f == c)  # f == c -> f == c.to_fahrenheit() -> f == Fahrenheit(212) -> ...
except RecursionError as e:
    print(f"RecursionError: {e}")
```

<details>
<summary>Hint</summary>
<code>self == other.to_fahrenheit()</code> creates a new <code>Fahrenheit</code>, but then the <code>isinstance(other, Celsius)</code> branch is taken again if the comparison chain involves a Celsius object.
</details>

<details>
<summary>Solution</summary>

**Bug:** `f == c` calls `Fahrenheit.__eq__`, which converts `c` to Fahrenheit and calls `self == Fahrenheit(212)`. This should work, but the issue is if someone compares in the other direction or the Celsius class also has an `__eq__` that calls `to_fahrenheit`. The real fix is to compare using a common representation.

```python
class Celsius:
    def __init__(self, temp):
        self.temp = float(temp)

    def __float__(self):
        return self.temp

    def __eq__(self, other):
        if isinstance(other, Fahrenheit):
            # FIX: compare using raw float values in same unit
            return abs(self.temp - (other.temp - 32) * 5/9) < 0.01
        if isinstance(other, Celsius):
            return abs(self.temp - other.temp) < 0.01
        return NotImplemented

    def __repr__(self):
        return f"Celsius({self.temp})"


class Fahrenheit:
    def __init__(self, temp):
        self.temp = float(temp)

    def __float__(self):
        return self.temp

    def __eq__(self, other):
        if isinstance(other, Celsius):
            # FIX: convert directly using formula, not recursive comparison
            return abs(self.temp - (other.temp * 9/5 + 32)) < 0.01
        if isinstance(other, Fahrenheit):
            return abs(self.temp - other.temp) < 0.01
        return NotImplemented

    def __repr__(self):
        return f"Fahrenheit({self.temp})"


c = Celsius(100)
f = Fahrenheit(212)
print(f == c)  # True (no recursion!)
print(c == f)  # True
```
</details>

---

## Score Card

| # | Difficulty | Topic | Fixed? |
|---|:----------:|-------|:------:|
| 1 | Easy | String concatenation TypeError | [ ] |
| 2 | Easy | Comparing str to int | [ ] |
| 3 | Easy | Float string to int() | [ ] |
| 4 | Easy | bool("false") is True | [ ] |
| 5 | Medium | int() on float strings | [ ] |
| 6 | Medium | isinstance check order (bool/int) | [ ] |
| 7 | Medium | Large int precision via float | [ ] |
| 8 | Medium | dict() drops duplicate keys | [ ] |
| 9 | Hard | __bool__ vs __len__ semantics | [ ] |
| 10 | Hard | NaN comparison trap | [ ] |
| 11 | Hard | __int__ vs __index__ | [ ] |
| 12 | Hard | Recursive __eq__ in conversions | [ ] |

**Total fixed: ___ / 12**
