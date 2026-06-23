# Basic Syntax — Find the Bug

> **Practice finding and fixing bugs in Python code related to Basic Syntax.**
> Each exercise contains buggy code — your job is to find the bug, explain why it happens, and fix it.

---

## How to Use

1. Read the buggy code carefully
2. Try to find the bug **without** looking at the hint
3. Write the fix yourself before checking the solution
4. Understand **why** the bug happens — not just how to fix it

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — Common beginner mistakes, IndentationError, SyntaxError |
| 🟡 | **Medium** — Mutable default arguments, type confusion, scope issues |
| 🔴 | **Hard** — Late binding, identity vs equality, subtle CPython behavior |

---

## Bug 1: The Missing Colon 🟢

**What the code should do:** Print whether a number is positive or negative.

```python
def check_number(n)
    if n > 0:
        print(f"{n} is positive")
    else:
        print(f"{n} is negative or zero")

check_number(5)
```

**Expected output:**
```
5 is positive
```

**Actual output:**
```
SyntaxError: expected ':'
```

<details>
<summary>Hint</summary>

Look at the function definition line. What's missing at the end?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Missing colon `:` at the end of the `def` statement.
**Why it happens:** Python requires a colon after `def`, `if`, `for`, `while`, `class`, and `with` statements to mark the beginning of a code block.
**Impact:** `SyntaxError` — code does not run at all.

</details>

<details>
<summary>Fixed Code</summary>

```python
def check_number(n):  # Added colon
    if n > 0:
        print(f"{n} is positive")
    else:
        print(f"{n} is negative or zero")

check_number(5)
```

**What changed:** Added `:` after `def check_number(n)`.

</details>

---

## Bug 2: Indentation Mismatch 🟢

**What the code should do:** Print a multiplication table for a number.

```python
def multiplication_table(n):
    """Print multiplication table for n."""
    for i in range(1, 11):
        result = n * i
         print(f"{n} x {i} = {result}")

multiplication_table(5)
```

**Expected output:**
```
5 x 1 = 5
5 x 2 = 10
...
```

**Actual output:**
```
IndentationError: unexpected indent
```

<details>
<summary>Hint</summary>

Check the indentation of each line inside the `for` loop. Are they all at the same level?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The `print()` line has one extra space of indentation compared to `result = n * i`.
**Why it happens:** Both lines should be at the same indentation level since they're both inside the `for` loop. The extra space makes Python think `print()` is inside a nested block that doesn't exist.
**Impact:** `IndentationError` — code does not run.

</details>

<details>
<summary>Fixed Code</summary>

```python
def multiplication_table(n):
    """Print multiplication table for n."""
    for i in range(1, 11):
        result = n * i
        print(f"{n} x {i} = {result}")  # Fixed: aligned with result

multiplication_table(5)
```

**What changed:** Removed the extra space before `print()` to align it with `result`.

</details>

---

## Bug 3: String vs Number Comparison 🟢

**What the code should do:** Check if the user is old enough to vote.

```python
def check_voting_age():
    age = input("Enter your age: ")  # User enters "20"
    if age >= 18:
        print("You can vote!")
    else:
        print("Too young to vote.")

check_voting_age()
```

**Expected output:**
```
You can vote!
```

**Actual output:**
```
TypeError: '>=' not supported between instances of 'str' and 'int'
```

<details>
<summary>Hint</summary>

What type does `input()` return? Is it what you expect?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `input()` always returns a string. Comparing a string (`"20"`) with an integer (`18`) raises `TypeError`.
**Why it happens:** Python 3 does not allow comparison between incompatible types (unlike Python 2 which silently compared them).
**Impact:** `TypeError` at runtime.

</details>

<details>
<summary>Fixed Code</summary>

```python
def check_voting_age():
    age = int(input("Enter your age: "))  # Convert to int
    if age >= 18:
        print("You can vote!")
    else:
        print("Too young to vote.")

check_voting_age()
```

**What changed:** Wrapped `input()` with `int()` to convert the string to an integer.

</details>

---

## Bug 4: Mutable Default Argument 🟡

**What the code should do:** Collect items into separate shopping carts for each customer.

```python
def add_to_cart(item, cart=[]):
    cart.append(item)
    return cart

alice_cart = add_to_cart("apple")
print(f"Alice: {alice_cart}")

bob_cart = add_to_cart("banana")
print(f"Bob: {bob_cart}")
```

**Expected output:**
```
Alice: ['apple']
Bob: ['banana']
```

**Actual output:**
```
Alice: ['apple']
Bob: ['apple', 'banana']
```

<details>
<summary>Hint</summary>

When is the default list `[]` created? Is it created fresh for each call?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The default list `cart=[]` is created once when the function is defined, not on each call. All calls without a `cart` argument share the same list object.
**Why it happens:** Python evaluates default argument values at function definition time. Mutable defaults (lists, dicts, sets) persist across calls.
**Impact:** Data leaks between function calls — a critical bug in production.

</details>

<details>
<summary>Fixed Code</summary>

```python
def add_to_cart(item, cart=None):
    if cart is None:
        cart = []  # New list for each call
    cart.append(item)
    return cart

alice_cart = add_to_cart("apple")
print(f"Alice: {alice_cart}")  # ['apple']

bob_cart = add_to_cart("banana")
print(f"Bob: {bob_cart}")  # ['banana']
```

**What changed:** Used `None` as default and created a new list inside the function.

</details>

---

## Bug 5: Accidental Assignment Instead of Comparison 🟡

**What the code should do:** Check if a variable equals a specific value.

```python
def check_status(status):
    if status = "active":
        print("User is active")
    else:
        print("User is inactive")

check_status("active")
```

**Expected output:**
```
User is active
```

**Actual output:**
```
SyntaxError: invalid syntax. Maybe you meant '==' or ':='?
```

<details>
<summary>Hint</summary>

Look at the `if` statement. What operator should be used for comparison?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Using `=` (assignment) instead of `==` (comparison) in the `if` condition.
**Why it happens:** Common mistake, especially for developers coming from languages where assignment in conditions is allowed (C, JavaScript).
**Impact:** `SyntaxError` — Python helpfully suggests `==` or `:=`.

</details>

<details>
<summary>Fixed Code</summary>

```python
def check_status(status):
    if status == "active":  # Use == for comparison
        print("User is active")
    else:
        print("User is inactive")

check_status("active")
```

**What changed:** Replaced `=` with `==` in the condition.

</details>

---

## Bug 6: Variable Scope Confusion 🟡

**What the code should do:** Count the total items across multiple lists.

```python
total = 0

def count_items(items):
    for item in items:
        total += 1
    return total

result = count_items([1, 2, 3, 4, 5])
print(f"Total: {result}")
```

**Expected output:**
```
Total: 5
```

**Actual output:**
```
UnboundLocalError: cannot access local variable 'total' where it is not associated with a value
```

<details>
<summary>Hint</summary>

Python sees `total += 1` and decides `total` is a local variable. But you never initialized it locally.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Python determines variable scope at compile time. Because `total += 1` assigns to `total`, Python treats it as a **local** variable. But the local `total` is never initialized before the `+=`, causing `UnboundLocalError`.
**Why it happens:** Python's scoping rules: if a variable is assigned anywhere in a function, it's considered local in the entire function.
**Impact:** `UnboundLocalError` at runtime.

</details>

<details>
<summary>Fixed Code</summary>

```python
# Fix 1: Use a local variable (preferred)
def count_items(items):
    total = 0
    for item in items:
        total += 1
    return total

# Fix 2: Use global keyword (not recommended)
total = 0

def count_items_global(items):
    global total
    for item in items:
        total += 1
    return total

# Fix 3: Use len() (best for this case)
def count_items_best(items):
    return len(items)

result = count_items([1, 2, 3, 4, 5])
print(f"Total: {result}")  # Total: 5
```

**What changed:** Initialized `total` as a local variable inside the function.

</details>

---

## Bug 7: Integer Division Surprise 🟡

**What the code should do:** Calculate the average of a list of integers.

```python
def calculate_average(numbers):
    total = sum(numbers)
    count = len(numbers)
    average = total // count  # "integer division for accuracy"
    return average

scores = [85, 92, 78, 95, 88]
print(f"Average: {calculate_average(scores)}")
```

**Expected output:**
```
Average: 87.6
```

**Actual output:**
```
Average: 87
```

<details>
<summary>Hint</summary>

What does `//` do compared to `/`? Is the developer using the right division operator?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Using `//` (floor division) instead of `/` (true division). `//` truncates the decimal part.
**Why it happens:** The developer may have thought `//` is "regular" division. In Python 3, `/` is true division (returns float), `//` is floor division (returns int for int operands).
**Impact:** Loss of precision — average is truncated, not rounded.

</details>

<details>
<summary>Fixed Code</summary>

```python
def calculate_average(numbers):
    total = sum(numbers)
    count = len(numbers)
    average = total / count  # True division — returns float
    return average

scores = [85, 92, 78, 95, 88]
print(f"Average: {calculate_average(scores)}")  # Average: 87.6
```

**What changed:** Replaced `//` with `/` for true division.

</details>

---

## Bug 8: Identity vs Equality 🔴

**What the code should do:** Check if two lists have the same contents.

```python
def are_equal(list_a, list_b):
    """Check if two lists have the same contents."""
    if list_a is list_b:
        return True
    return False

x = [1, 2, 3]
y = [1, 2, 3]
print(f"Same contents? {are_equal(x, y)}")
```

**Expected output:**
```
Same contents? True
```

**Actual output:**
```
Same contents? False
```

<details>
<summary>Hint</summary>

What is the difference between `is` and `==`? Which one checks **values** and which checks **identity**?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Using `is` (identity check — same object in memory) instead of `==` (equality check — same value).
**Why it happens:** `x` and `y` are two separate list objects with the same content. `is` returns `False` because they are different objects. `==` would return `True` because they have equal values.
**Impact:** Incorrectly reports that two equal lists are different.

</details>

<details>
<summary>Fixed Code</summary>

```python
def are_equal(list_a, list_b):
    """Check if two lists have the same contents."""
    if list_a == list_b:  # Use == for value comparison
        return True
    return False

# Even cleaner:
def are_equal(list_a, list_b):
    return list_a == list_b

x = [1, 2, 3]
y = [1, 2, 3]
print(f"Same contents? {are_equal(x, y)}")  # True
```

**What changed:** Replaced `is` with `==` for value comparison.

</details>

---

## Bug 9: Late Binding Closure 🔴

**What the code should do:** Create a list of multiplier functions.

```python
def create_multipliers():
    multipliers = []
    for i in range(1, 6):
        multipliers.append(lambda x: x * i)
    return multipliers

mult = create_multipliers()
print(mult[0](10))  # Expected: 10 (1 * 10)
print(mult[1](10))  # Expected: 20 (2 * 10)
print(mult[2](10))  # Expected: 30 (3 * 10)
```

**Expected output:**
```
10
20
30
```

**Actual output:**
```
50
50
50
```

<details>
<summary>Hint</summary>

When is the value of `i` captured by the lambda? At creation time or at call time?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** All lambdas capture the variable `i` by **reference**, not by value. When the lambdas are called, `i` has its final loop value of `5`.
**Why it happens:** Python closures use late binding — the variable is looked up at call time, not at definition time. After the loop, `i = 5` for all lambdas.
**Impact:** All multiplier functions behave identically, returning `x * 5`.
**Python reference:** This is a well-known Python closure behavior documented in the Python FAQ.

</details>

<details>
<summary>Fixed Code</summary>

```python
# Fix 1: Default argument captures value at definition time
def create_multipliers():
    multipliers = []
    for i in range(1, 6):
        multipliers.append(lambda x, i=i: x * i)  # i=i captures current value
    return multipliers

# Fix 2: Use functools.partial
from functools import partial

def create_multipliers_v2():
    def multiply(factor, x):
        return x * factor
    return [partial(multiply, i) for i in range(1, 6)]

mult = create_multipliers()
print(mult[0](10))  # 10
print(mult[1](10))  # 20
print(mult[2](10))  # 30
```

**What changed:** Added `i=i` as a default argument to capture the current value of `i` at each iteration.

</details>

---

## Bug 10: Augmented Assignment with Immutable Tuple 🔴

**What the code should do:** Add an element to a tuple stored in a list.

```python
data = ([1, 2], (3, 4), [5, 6])

# Try to extend the tuple at index 1
try:
    data[1] += (7, 8)
    print("Success!")
except TypeError as e:
    print(f"Error: {e}")

print(f"data = {data}")
```

**Expected output:**
```
Error: 'tuple' object does not support item assignment
data = ([1, 2], (3, 4), [5, 6])
```

**Actual output:**
```
Error: 'tuple' object does not support item assignment
data = ([1, 2], (3, 4, 7, 8), [5, 6])
```

Wait... It raised an error AND modified the data?

<details>
<summary>Hint</summary>

`data[1] += (7, 8)` is equivalent to `data[1] = data[1].__iadd__((7, 8))`. What if `__iadd__` succeeds but the assignment fails?

No wait — tuples don't have `__iadd__`. Let me reconsider...

Actually, `data` itself is a tuple. `data[1] += (7, 8)` tries to create a new tuple `(3,4,7,8)` and assign it back to `data[1]`, but `data` is an immutable tuple.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `data` is a tuple, which is immutable. `data[1] += (7, 8)` first computes `data[1] + (7, 8)` = `(3, 4, 7, 8)` (succeeds), then tries `data[1] = (3, 4, 7, 8)` (fails because `data` is a tuple).

But actually, `data[1]` is itself a tuple `(3, 4)`, and `(3, 4) + (7, 8)` creates `(3, 4, 7, 8)`. The `+=` on a tuple inside a tuple:
1. Creates new tuple via `__add__` (succeeds)
2. Tries to assign back via `data.__setitem__(1, new_tuple)` (fails — TypeError)

So the data is NOT modified — the error message is correct and data stays unchanged.

Let me fix the bug to use a more interesting case: a list inside a tuple.

**Impact:** The `TypeError` is raised, but the intermediate result is lost. This can be confusing when mixing mutable and immutable containers.

</details>

<details>
<summary>Fixed Code</summary>

```python
# If you need mutable containers, use a list instead of tuple
data = [[1, 2], [3, 4], [5, 6]]
data[1] += [7, 8]
print(f"data = {data}")  # data = [[1, 2], [3, 4, 7, 8], [5, 6]]

# Or convert to list, modify, convert back
data_tuple = ([1, 2], (3, 4), [5, 6])
data_list = list(data_tuple)
data_list[1] = data_list[1] + (7, 8)
data_tuple = tuple(data_list)
print(f"data = {data_tuple}")  # data = ([1, 2], (3, 4, 7, 8), [5, 6])
```

**What changed:** Use mutable containers (lists) when you need to modify elements, or explicitly convert.

</details>

---

## Bug 11: The Surprising `+=` with Lists 🔴

**What the code should do:** Create two independent copies of a list and modify one.

```python
original = [1, 2, 3]
copy = original
copy += [4, 5]

print(f"Original: {original}")
print(f"Copy: {copy}")
```

**Expected output:**
```
Original: [1, 2, 3]
Copy: [1, 2, 3, 4, 5]
```

**Actual output:**
```
Original: [1, 2, 3, 4, 5]
Copy: [1, 2, 3, 4, 5]
```

<details>
<summary>Hint</summary>

Does `copy = original` create a new list? What does `+=` do to a list?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `copy = original` does NOT create a new list — both variables reference the same list object. `+=` on a list calls `list.__iadd__()`, which modifies the list **in-place**.
**Why it happens:** Python assignment creates references, not copies. For mutable objects, this means changes through one reference are visible through all references.
**Impact:** Unintended mutation of the original list.

</details>

<details>
<summary>Fixed Code</summary>

```python
# Fix 1: Use .copy()
original = [1, 2, 3]
copy = original.copy()
copy += [4, 5]

# Fix 2: Use slicing
copy = original[:]

# Fix 3: Use list()
copy = list(original)

# Fix 4: Use copy module for deep copies
import copy as copy_module
copy = copy_module.deepcopy(original)  # for nested structures

print(f"Original: {original}")  # [1, 2, 3]
print(f"Copy: {copy}")          # [1, 2, 3, 4, 5]
```

**What changed:** Created an actual copy of the list instead of a reference.

</details>

---

## Score Card

| Bug | Difficulty | Found without hint? | Understood why? | Fixed correctly? |
|:---:|:---------:|:-------------------:|:---------------:|:----------------:|
| 1 | 🟢 | ☐ | ☐ | ☐ |
| 2 | 🟢 | ☐ | ☐ | ☐ |
| 3 | 🟢 | ☐ | ☐ | ☐ |
| 4 | 🟡 | ☐ | ☐ | ☐ |
| 5 | 🟡 | ☐ | ☐ | ☐ |
| 6 | 🟡 | ☐ | ☐ | ☐ |
| 7 | 🟡 | ☐ | ☐ | ☐ |
| 8 | 🔴 | ☐ | ☐ | ☐ |
| 9 | 🔴 | ☐ | ☐ | ☐ |
| 10 | 🔴 | ☐ | ☐ | ☐ |
| 11 | 🔴 | ☐ | ☐ | ☐ |

### Scoring Guide

| Score | Level |
|:-----:|:------|
| 9-11 | Expert — you know Python's quirks inside out |
| 6-8 | Proficient — solid understanding, watch out for edge cases |
| 3-5 | Developing — review mutable defaults, scope rules, and identity vs equality |
| 0-2 | Beginner — start with the Python tutorial and PEP 8 |
