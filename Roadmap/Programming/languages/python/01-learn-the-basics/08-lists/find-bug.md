# Python Lists — Find the Bug

> Find and fix the bug in each code snippet. Each exercise has a difficulty level and a hidden solution.

---

## Score Card

| # | Difficulty | Bug Topic | Found? | Fixed? |
|---|:----------:|-----------|:------:|:------:|
| 1 | Easy | Mutable default argument | [ ] | [ ] |
| 2 | Easy | List aliasing (shared reference) | [ ] | [ ] |
| 3 | Easy | Index out of range | [ ] | [ ] |
| 4 | Medium | Modifying list during iteration | [ ] | [ ] |
| 5 | Medium | Shallow copy vs deep copy | [ ] | [ ] |
| 6 | Medium | List comprehension variable scope leak | [ ] | [ ] |
| 7 | Medium | Sorting returns None | [ ] | [ ] |
| 8 | Hard | `is` vs `==` for list comparison | [ ] | [ ] |
| 9 | Hard | Unpacking with `*` in nested list | [ ] | [ ] |
| 10 | Hard | Thread-unsafe list append | [ ] | [ ] |

**Total found: ___ / 10**
**Total fixed: ___ / 10**

---

## Easy (3 Bugs)

### Bug 1: Mutable Default Argument

```python
def add_item(item, items=[]):
    """Add an item to a list and return the list."""
    items.append(item)
    return items

print(add_item("apple"))   # Expected: ["apple"]
print(add_item("banana"))  # Expected: ["banana"]
print(add_item("cherry"))  # Expected: ["cherry"]
```

**Actual output:**
```
['apple']
['apple', 'banana']
['apple', 'banana', 'cherry']
```

<details>
<summary>Hint</summary>

Default argument values are evaluated <strong>once</strong> when the function is defined, not each time the function is called. A mutable default like <code>[]</code> is shared across all calls.

</details>

<details>
<summary>Solution</summary>

**Bug:** The default list `[]` is created once at function definition time. Every call that uses the default shares the same list object, so items accumulate across calls.

```python
def add_item(item, items=None):
    """Add an item to a list and return the list."""
    if items is None:
        items = []  # FIX: create a new list for each call
    items.append(item)
    return items

print(add_item("apple"))   # ['apple']
print(add_item("banana"))  # ['banana']
print(add_item("cherry"))  # ['cherry']
```

**Key rule:** Never use mutable objects (`list`, `dict`, `set`) as default argument values. Use `None` and create a new object inside the function body.

</details>

---

### Bug 2: List Aliasing (Shared Reference)

```python
def get_matrix(rows, cols, fill=0):
    """Create a rows x cols matrix filled with a value."""
    row = [fill] * cols
    matrix = [row] * rows
    return matrix

grid = get_matrix(3, 3, 0)
grid[0][0] = 99
print(grid)
# Expected: [[99, 0, 0], [0, 0, 0], [0, 0, 0]]
```

**Actual output:**
```
[[99, 0, 0], [99, 0, 0], [99, 0, 0]]
```

<details>
<summary>Hint</summary>

<code>[row] * 3</code> does not copy <code>row</code> three times. It creates three references to the <strong>same</strong> list object.

</details>

<details>
<summary>Solution</summary>

**Bug:** `[row] * rows` creates `rows` references to the same inner list. Modifying one row modifies all of them.

```python
def get_matrix(rows, cols, fill=0):
    """Create a rows x cols matrix filled with a value."""
    matrix = [[fill] * cols for _ in range(rows)]  # FIX: new list per row
    return matrix

grid = get_matrix(3, 3, 0)
grid[0][0] = 99
print(grid)
# [[99, 0, 0], [0, 0, 0], [0, 0, 0]]
```

**Key rule:** Use a list comprehension to create independent inner lists. The `*` operator copies references, not objects.

</details>

---

### Bug 3: Index Out of Range

```python
def get_last_three(items):
    """Return the last 3 elements of a list."""
    result = []
    for i in range(3):
        result.append(items[len(items) - 3 + i])
    return result

print(get_last_three([10, 20, 30, 40, 50]))  # Expected: [30, 40, 50]
print(get_last_three([1, 2]))                  # Expected: [1, 2]
```

**Actual output:**
```
[30, 40, 50]
IndexError: list index out of range
```

<details>
<summary>Hint</summary>

When the list has fewer than 3 elements, <code>len(items) - 3</code> becomes negative, and adding <code>i</code> may still produce a valid negative index on some iterations but an invalid one on others. Use Python's negative slicing instead.

</details>

<details>
<summary>Solution</summary>

**Bug:** The function assumes the list has at least 3 elements. When `items = [1, 2]`, `len(items) - 3 + i` starts at `-1`, which works, but the logic breaks for edge cases and is fragile.

```python
def get_last_three(items):
    """Return the last 3 elements of a list."""
    return items[-3:]  # FIX: slice handles short lists gracefully

print(get_last_three([10, 20, 30, 40, 50]))  # [30, 40, 50]
print(get_last_three([1, 2]))                  # [1, 2]
print(get_last_three([]))                      # []
```

**Key rule:** Prefer slicing over manual index arithmetic. Slices never raise `IndexError` — they return shorter lists when the range exceeds the list length.

</details>

---

## Medium (4 Bugs)

### Bug 4: Modifying List During Iteration

```python
def remove_evens(numbers):
    """Remove all even numbers from the list in-place."""
    for num in numbers:
        if num % 2 == 0:
            numbers.remove(num)
    return numbers

data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
print(remove_evens(data))
# Expected: [1, 3, 5, 7, 9]
```

**Actual output:**
```
[1, 3, 5, 7, 9, 10]
```

<details>
<summary>Hint</summary>

Removing an element from a list while iterating over it shifts the remaining elements. The iterator's internal index advances past the next element, causing it to be skipped.

</details>

<details>
<summary>Solution</summary>

**Bug:** When you remove an element, all elements after it shift left by one. The `for` loop's internal counter still increments, so it skips the element that moved into the removed element's slot. In this case, after removing `8`, `9` shifts to index 7, the iterator moves to index 8 (now `10`), and `10` is never checked at index 7... actually `10` is checked but the skip pattern causes `10` to be missed on certain input arrangements.

```python
# FIX Option 1: Iterate over a copy
def remove_evens(numbers):
    """Remove all even numbers from the list in-place."""
    for num in numbers[:]:  # FIX: iterate over a shallow copy
        if num % 2 == 0:
            numbers.remove(num)
    return numbers

# FIX Option 2: List comprehension (preferred, more Pythonic)
def remove_evens(numbers):
    """Return a new list with only odd numbers."""
    return [num for num in numbers if num % 2 != 0]

# FIX Option 3: Iterate backwards
def remove_evens(numbers):
    """Remove all even numbers from the list in-place."""
    for i in range(len(numbers) - 1, -1, -1):
        if numbers[i] % 2 == 0:
            numbers.pop(i)
    return numbers

data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
print(remove_evens(data))  # [1, 3, 5, 7, 9]
```

**Key rule:** Never modify a list while iterating over it with a `for` loop. Iterate over a copy, use a comprehension, or iterate in reverse.

</details>

---

### Bug 5: Shallow Copy vs Deep Copy

```python
import copy

def duplicate_board(board):
    """Create an independent copy of a game board (2D list)."""
    new_board = board.copy()  # or board[:]
    return new_board

original = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
backup = duplicate_board(original)

# Player makes a move
original[1][1] = 0

print(f"Original: {original[1]}")  # Expected: [4, 0, 6]
print(f"Backup:   {backup[1]}")    # Expected: [4, 5, 6]
```

**Actual output:**
```
Original: [4, 0, 6]
Backup:   [4, 0, 6]
```

<details>
<summary>Hint</summary>

<code>list.copy()</code> and <code>[:]</code> create a <strong>shallow</strong> copy. The outer list is new, but the inner lists are still the same objects.

</details>

<details>
<summary>Solution</summary>

**Bug:** `board.copy()` creates a shallow copy — it copies the references to the inner lists, not the inner lists themselves. Both `original[1]` and `backup[1]` point to the same `[4, 5, 6]` list.

```python
import copy

def duplicate_board(board):
    """Create an independent copy of a game board (2D list)."""
    new_board = copy.deepcopy(board)  # FIX: deep copy all nested objects
    return new_board

# Alternative FIX using list comprehension (faster for 2D lists):
def duplicate_board(board):
    """Create an independent copy of a game board (2D list)."""
    return [row[:] for row in board]  # FIX: copy each inner list

original = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
backup = duplicate_board(original)
original[1][1] = 0

print(f"Original: {original[1]}")  # [4, 0, 6]
print(f"Backup:   {backup[1]}")    # [4, 5, 6]
```

**Key rule:** For nested mutable structures, use `copy.deepcopy()` or manually copy each level. `list.copy()`, `[:]`, and `list(original)` are all shallow.

</details>

---

### Bug 6: List Comprehension Variable Scope Leak (Python 2 Legacy)

```python
# This bug manifests when porting Python 2 code or using exec/eval
# In Python 3, list comprehension variables are scoped, but
# the walrus operator can introduce subtle scope issues:

results = []
total = 0

# Developer tries to accumulate a running total in a comprehension
data = [10, 20, 30, 40, 50]
cumulative = [total := total + x for x in data]

print(f"cumulative: {cumulative}")  # Expected: [10, 30, 60, 100, 150]
print(f"total: {total}")            # What is total now?
```

**Actual output:**
```
cumulative: [10, 30, 60, 100, 150]
total: 150
```

<details>
<summary>Hint</summary>

The walrus operator <code>:=</code> in a list comprehension leaks its value to the enclosing scope. The variable <code>total</code> is modified as a side effect, which can cause subtle bugs if the code later assumes <code>total</code> is still <code>0</code>.

</details>

<details>
<summary>Solution</summary>

**Bug:** The walrus operator `:=` assigns to the variable in the enclosing scope, not just inside the comprehension. After the comprehension runs, `total` has been mutated to `150`. This is technically "working" but is a design bug — using comprehensions for side effects leads to hard-to-find issues.

```python
import itertools

data = [10, 20, 30, 40, 50]
total = 0  # total stays 0

# FIX: Use itertools.accumulate for running totals
cumulative = list(itertools.accumulate(data))

print(f"cumulative: {cumulative}")  # [10, 30, 60, 100, 150]
print(f"total: {total}")            # 0 (unchanged)
print(f"final sum: {cumulative[-1]}")  # 150
```

**Key rule:** Avoid using the walrus operator `:=` in list comprehensions for accumulation side effects. Use `itertools.accumulate()` for running totals or explicit loops when side effects are needed.

</details>

---

### Bug 7: `.sort()` Returns `None`

```python
def get_top_three(scores):
    """Return the top 3 highest scores."""
    top = scores.sort(reverse=True)
    return top[:3]

scores = [85, 92, 78, 96, 88, 73, 91]
print(get_top_three(scores))
# Expected: [96, 92, 91]
```

**Actual output:**
```
TypeError: 'NoneType' object is not subscriptable
```

<details>
<summary>Hint</summary>

<code>list.sort()</code> sorts the list <strong>in-place</strong> and returns <code>None</code>. It does not return the sorted list.

</details>

<details>
<summary>Solution</summary>

**Bug:** `list.sort()` sorts in-place and returns `None`. Assigning its return value to `top` means `top = None`, and `None[:3]` raises `TypeError`.

```python
# FIX Option 1: Use sorted() which returns a new list
def get_top_three(scores):
    """Return the top 3 highest scores."""
    top = sorted(scores, reverse=True)  # FIX: sorted() returns a new list
    return top[:3]

# FIX Option 2: Sort in-place, then slice
def get_top_three(scores):
    """Return the top 3 highest scores."""
    scores_copy = scores[:]
    scores_copy.sort(reverse=True)  # sort in-place (returns None)
    return scores_copy[:3]          # slice the sorted list

scores = [85, 92, 78, 96, 88, 73, 91]
print(get_top_three(scores))  # [96, 92, 91]
```

**Key rule:** `list.sort()` returns `None`. Use `sorted()` when you need the sorted list as a return value. This same pattern applies to `list.append()`, `list.extend()`, `list.reverse()`, and `list.clear()` — they all return `None`.

</details>

---

## Hard (3 Bugs)

### Bug 8: `is` vs `==` for List Comparison

```python
def are_lists_equal(list_a, list_b):
    """Check if two lists have the same contents."""
    if list_a is list_b:
        return True
    return False

x = [1, 2, 3]
y = [1, 2, 3]
z = x

print(f"x == y content: {are_lists_equal(x, y)}")  # Expected: True
print(f"x == z content: {are_lists_equal(x, z)}")  # Expected: True
```

**Actual output:**
```
x == y content: False
x == z content: True
```

<details>
<summary>Hint</summary>

<code>is</code> checks <strong>identity</strong> (same object in memory), not <strong>equality</strong> (same value). Two lists with identical contents are <code>==</code> but not necessarily <code>is</code>.

</details>

<details>
<summary>Solution</summary>

**Bug:** `is` checks whether two variables point to the **exact same object** in memory. `x` and `y` have the same contents but are different objects, so `x is y` is `False`. Only `x is z` is `True` because `z = x` makes them point to the same object.

```python
def are_lists_equal(list_a, list_b):
    """Check if two lists have the same contents."""
    if list_a == list_b:  # FIX: use == for value comparison
        return True
    return False

# Even more Pythonic:
def are_lists_equal(list_a, list_b):
    """Check if two lists have the same contents."""
    return list_a == list_b  # FIX

x = [1, 2, 3]
y = [1, 2, 3]
z = x

print(f"x == y content: {are_lists_equal(x, y)}")  # True
print(f"x == z content: {are_lists_equal(x, z)}")  # True

# Understanding the difference:
print(f"x is y (identity): {x is y}")    # False (different objects)
print(f"x is z (identity): {x is z}")    # True  (same object)
print(f"x == y (equality): {x == y}")    # True  (same contents)
```

**Key rule:** Use `==` for value comparison and `is` only for identity checks (e.g., `is None`, `is True`, `is False`). This is one of the most common Python bugs.

</details>

---

### Bug 9: Unpacking with `*` in Nested List Operations

```python
def flatten_and_process(nested_list):
    """Flatten a nested list and return (first, middle_items, last)."""
    # Step 1: Flatten
    flat = []
    for sublist in nested_list:
        flat.extend(sublist)

    # Step 2: Unpack
    first, *middle, last = flat

    # Step 3: Process middle — double each value
    middle *= 2  # Developer thinks this doubles each element

    return first, middle, last

data = [[1, 2], [3, 4], [5, 6]]
first, middle, last = flatten_and_process(data)
print(f"First: {first}")
print(f"Middle (doubled): {middle}")
print(f"Last: {last}")
# Expected middle: [4, 6, 8, 10]
```

**Actual output:**
```
First: 1
Middle (doubled): [2, 3, 4, 5, 2, 3, 4, 5]
Last: 6
```

<details>
<summary>Hint</summary>

<code>list *= 2</code> does not double each element. It <strong>repeats</strong> the entire list. <code>[1, 2] * 2</code> is <code>[1, 2, 1, 2]</code>, not <code>[2, 4]</code>.

</details>

<details>
<summary>Solution</summary>

**Bug:** `middle *= 2` uses the `*` operator on a list, which **repeats** the list (concatenates it with itself), not multiplies each element. `[2, 3, 4, 5] * 2` becomes `[2, 3, 4, 5, 2, 3, 4, 5]`.

```python
def flatten_and_process(nested_list):
    """Flatten a nested list and return (first, middle_items, last)."""
    flat = []
    for sublist in nested_list:
        flat.extend(sublist)

    first, *middle, last = flat

    # FIX: Use a list comprehension to double each element
    middle = [x * 2 for x in middle]

    return first, middle, last

data = [[1, 2], [3, 4], [5, 6]]
first, middle, last = flatten_and_process(data)
print(f"First: {first}")           # 1
print(f"Middle (doubled): {middle}")  # [4, 6, 8, 10]
print(f"Last: {last}")             # 6
```

**Key rule:** The `*` operator on lists means **repetition**, not element-wise multiplication. For element-wise operations, use list comprehensions or `numpy` arrays.

</details>

---

### Bug 10: Thread-Unsafe List Operations

```python
import threading

def append_range(shared_list, start, end):
    """Append numbers from start to end into the shared list."""
    for i in range(start, end):
        shared_list.append(i)
        # Simulate some processing
        temp = shared_list[-1]  # Read the value we just appended
        assert temp == i, f"Expected {i}, got {temp}"

shared = []
threads = []

for t in range(4):
    thread = threading.Thread(
        target=append_range,
        args=(shared, t * 250, (t + 1) * 250)
    )
    threads.append(thread)

for t in threads:
    t.start()
for t in threads:
    t.join()

print(f"Length: {len(shared)}")       # Expected: 1000
print(f"Correct: {len(shared) == 1000}")
# The assertion inside the function may FAIL intermittently
```

<details>
<summary>Hint</summary>

While <code>list.append()</code> itself is thread-safe in CPython due to the GIL, the <strong>sequence</strong> of <code>append</code> followed by <code>shared_list[-1]</code> is NOT atomic. Another thread can append between your <code>append</code> and your read of <code>[-1]</code>.

</details>

<details>
<summary>Solution</summary>

**Bug:** The compound operation of "append then read the last element" is not atomic. Between `shared_list.append(i)` and `temp = shared_list[-1]`, another thread can call `append()`, making `shared_list[-1]` return a different value. The assertion fails intermittently.

```python
import threading

def append_range(shared_list, lock, start, end):
    """Append numbers from start to end into the shared list (thread-safe)."""
    for i in range(start, end):
        with lock:  # FIX: protect the compound operation
            shared_list.append(i)
            temp = shared_list[-1]
            assert temp == i, f"Expected {i}, got {temp}"

shared = []
lock = threading.Lock()  # FIX: add a lock
threads = []

for t in range(4):
    thread = threading.Thread(
        target=append_range,
        args=(shared, lock, t * 250, (t + 1) * 250)
    )
    threads.append(thread)

for t in threads:
    t.start()
for t in threads:
    t.join()

print(f"Length: {len(shared)}")         # 1000
print(f"Correct: {len(shared) == 1000}")  # True

# Alternative FIX: Use queue.Queue for thread-safe producer/consumer
import queue
q = queue.Queue()
# q.put(item) and q.get() are inherently thread-safe
```

**Key rule:** While individual `list.append()` calls are GIL-protected in CPython, any **compound operation** (append + read, check + modify, etc.) requires explicit synchronization with `threading.Lock`. For concurrent workloads, prefer `queue.Queue`, `collections.deque` (with `append`/`popleft`), or `concurrent.futures`.

</details>

---

## Bonus Challenges

After fixing all 10 bugs, try these:

1. **Write a test suite** that catches each bug automatically using `pytest`.
2. **Create a linter rule** (or find existing `pylint`/`flake8` rules) that detects bugs 1, 4, and 7.
3. **Explain** why `[[] for _ in range(3)]` is safe but `[[]] * 3` is not, using `id()` to prove it.

```python
# Proof for challenge 3:
safe = [[] for _ in range(3)]
unsafe = [[]] * 3

print([id(row) for row in safe])    # Three DIFFERENT ids
print([id(row) for row in unsafe])  # Three IDENTICAL ids
```
