# Python Lists — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What is a Python list and how is it different from an array?

**Answer:**
A Python list is an ordered, mutable collection that can hold items of any type. Unlike arrays in languages like C or Java, Python lists:
- Can store mixed types (`[1, "hello", 3.14]`)
- Dynamically resize as items are added/removed
- Store pointers to objects, not raw values

```python
# List — heterogeneous, dynamic
my_list = [1, "hello", 3.14, True]

# array.array — homogeneous, typed (closer to C arrays)
import array
my_array = array.array("i", [1, 2, 3])  # only integers
```

Python's `list` is technically a dynamic array of pointers, not a linked list.

---

### 2. What is the difference between `append()` and `extend()`?

**Answer:**
- `append(x)` adds `x` as a **single element** to the end of the list
- `extend(iterable)` adds **each element** from the iterable individually

```python
a = [1, 2, 3]
a.append([4, 5])
print(a)  # [1, 2, 3, [4, 5]]  — nested list added as one element

b = [1, 2, 3]
b.extend([4, 5])
print(b)  # [1, 2, 3, 4, 5]    — elements added individually
```

---

### 3. What is list slicing? Explain with examples.

**Answer:**
Slicing extracts a portion of a list using `list[start:stop:step]`:
- `start` — inclusive beginning index (default: 0)
- `stop` — exclusive ending index (default: end)
- `step` — stride between elements (default: 1)

```python
nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

print(nums[2:5])    # [2, 3, 4]       — indices 2, 3, 4
print(nums[:3])     # [0, 1, 2]       — first 3
print(nums[7:])     # [7, 8, 9]       — from index 7 to end
print(nums[::2])    # [0, 2, 4, 6, 8] — every 2nd element
print(nums[::-1])   # [9, 8, ..., 0]  — reversed copy
print(nums[1:7:2])  # [1, 3, 5]       — indices 1, 3, 5
```

Slicing always creates a **new list** (shallow copy).

---

### 4. What is a list comprehension and when would you use it?

**Answer:**
A list comprehension is a concise way to create a list from an iterable:

```python
# Syntax: [expression for item in iterable if condition]

# Equivalent to:
# result = []
# for item in iterable:
#     if condition:
#         result.append(expression)

squares = [x**2 for x in range(10)]
# [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]

evens = [x for x in range(20) if x % 2 == 0]
# [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]
```

**When to use:** For simple transformations and filters. For complex logic (multiple statements, side effects), use a regular `for` loop.

---

### 5. What happens when you do `b = a` where `a` is a list? How do you make a copy?

**Answer:**
`b = a` does **not** create a copy — both variables reference the **same** list object:

```python
a = [1, 2, 3]
b = a
b.append(4)
print(a)  # [1, 2, 3, 4] — a is affected!

# Ways to copy:
c = a.copy()        # shallow copy
d = a[:]            # shallow copy via slice
e = list(a)         # shallow copy via constructor

import copy
f = copy.deepcopy(a)  # deep copy (for nested lists)
```

---

### 6. What is the difference between `sort()` and `sorted()`?

**Answer:**

| Feature | `list.sort()` | `sorted(iterable)` |
|---------|:------------:|:-------------------:|
| Returns | `None` | New sorted list |
| Modifies original | Yes (in-place) | No |
| Works on | Lists only | Any iterable |
| Memory | O(1) extra | O(n) — creates new list |

```python
nums = [3, 1, 4, 1, 5]

# sort() — in-place, returns None
result = nums.sort()
print(result)  # None
print(nums)    # [1, 1, 3, 4, 5]

# sorted() — returns new list
nums = [3, 1, 4, 1, 5]
result = sorted(nums)
print(result)  # [1, 1, 3, 4, 5]
print(nums)    # [3, 1, 4, 1, 5] — unchanged
```

---

### 7. How do you remove duplicates from a list while preserving order?

**Answer:**

```python
# Method 1: dict.fromkeys (Python 3.7+ guarantees order)
items = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]
unique = list(dict.fromkeys(items))
print(unique)  # [3, 1, 4, 5, 9, 2, 6]

# Method 2: seen set (explicit)
seen = set()
unique = []
for item in items:
    if item not in seen:
        seen.add(item)
        unique.append(item)

# Method 3: set() — does NOT preserve order
unique_unordered = list(set(items))
```

---

## Middle Level

### 1. Explain the time complexity of common list operations.

**Answer:**

| Operation | Time Complexity | Reason |
|-----------|:--------------:|--------|
| `list[i]` | O(1) | Direct pointer access (array of pointers) |
| `list.append(x)` | O(1) amortized | Over-allocation, occasional O(n) realloc |
| `list.insert(0, x)` | O(n) | Must shift all elements right |
| `list.pop()` | O(1) | Remove from end |
| `list.pop(0)` | O(n) | Must shift all elements left |
| `x in list` | O(n) | Linear scan |
| `list.sort()` | O(n log n) | Timsort algorithm |
| `list.copy()` | O(n) | Copy all pointers |
| `list.extend(iter)` | O(k) | k = length of iter |

**Key insight:** Use `collections.deque` if you need O(1) operations on both ends.

---

### 2. What is Python's Timsort algorithm and why was it chosen?

**Answer:**
Timsort is a hybrid sorting algorithm combining merge sort and insertion sort, designed by Tim Peters in 2002 for Python.

Key properties:
- **Stable** — equal elements maintain their relative order
- **Adaptive** — exploits pre-existing order ("natural runs") in the data
- **O(n log n)** worst case, **O(n)** best case (fully sorted data)
- Uses insertion sort for small runs (< 64 elements)

```python
# Timsort's stability is crucial for multi-key sorting
records = [("Alice", 3), ("Bob", 1), ("Charlie", 3), ("Diana", 1)]

# Sort by second element — stable sort preserves name order within same value
records.sort(key=lambda x: x[1])
print(records)
# [('Bob', 1), ('Diana', 1), ('Alice', 3), ('Charlie', 3)]
```

Timsort is now used in Java (since JDK 7), Android, and Swift.

---

### 3. What is the mutable default argument problem and how do you fix it?

**Answer:**
Default argument values are evaluated **once** when the function is defined, not on each call. If the default is a mutable object (like a list), it is shared across all calls:

```python
# ❌ Bug — all calls share the same list
def add_item(item, lst=[]):
    lst.append(item)
    return lst

print(add_item("a"))  # ['a']
print(add_item("b"))  # ['a', 'b'] — unexpected!
print(add_item("c"))  # ['a', 'b', 'c'] — keeps growing

# ✅ Fix — use None sentinel
def add_item(item, lst=None):
    if lst is None:
        lst = []
    lst.append(item)
    return lst
```

**Why it happens:** Python stores the default value as an attribute of the function object (`add_item.__defaults__`). Each call reuses the same object.

---

### 4. Explain shallow copy vs deep copy for nested lists.

**Answer:**

```python
import copy

original = [[1, 2, 3], [4, 5, 6]]

# Shallow copy — new outer list, same inner lists
shallow = original.copy()
shallow[0][0] = 99
print(original[0][0])  # 99 — inner list was shared!
print(original is shallow)     # False — different outer lists
print(original[0] is shallow[0])  # True — same inner list!

# Deep copy — everything is independent
original = [[1, 2, 3], [4, 5, 6]]
deep = copy.deepcopy(original)
deep[0][0] = 99
print(original[0][0])  # 1 — completely independent
print(original[0] is deep[0])  # False
```

**When to use deep copy:** Only when you have nested mutable objects and need full independence. Deep copy is ~100x slower than shallow copy.

---

### 5. How would you efficiently flatten a nested list?

**Answer:**

```python
from itertools import chain

# Method 1: List comprehension (one level)
nested = [[1, 2], [3, 4], [5, 6]]
flat = [item for sublist in nested for item in sublist]
# [1, 2, 3, 4, 5, 6]

# Method 2: itertools.chain (one level, more efficient)
flat = list(chain.from_iterable(nested))

# Method 3: Recursive flatten (arbitrary depth)
def flatten(lst):
    for item in lst:
        if isinstance(item, list):
            yield from flatten(item)
        else:
            yield item

deeply_nested = [1, [2, [3, [4, 5]], 6], 7]
print(list(flatten(deeply_nested)))  # [1, 2, 3, 4, 5, 6, 7]

# Method 4: sum() — works but creates O(n^2) intermediate lists!
flat = sum(nested, [])  # ❌ Don't use for large lists
```

---

### 6. What is the `*` (star/splat) operator used for with lists?

**Answer:**

```python
# 1. Unpacking in assignments
first, *rest = [1, 2, 3, 4, 5]
print(first)  # 1
print(rest)   # [2, 3, 4, 5]

head, *middle, tail = [1, 2, 3, 4, 5]
print(middle)  # [2, 3, 4]

# 2. Merging lists (PEP 448)
a = [1, 2]
b = [3, 4]
merged = [*a, *b, 5]  # [1, 2, 3, 4, 5]

# 3. Unpacking into function arguments
def add(x, y, z):
    return x + y + z

nums = [1, 2, 3]
print(add(*nums))  # 6

# 4. List repetition
zeros = [0] * 5  # [0, 0, 0, 0, 0]
```

---

## Senior Level

### 1. How does CPython implement lists internally? Describe the over-allocation strategy.

**Answer:**
CPython implements lists as a `PyListObject` struct containing:
- `ob_refcnt` — reference count
- `ob_type` — pointer to `PyList_Type`
- `ob_size` — actual number of elements (`len()`)
- `ob_item` — pointer to a C array of `PyObject*` pointers
- `allocated` — number of slots available

When `append()` is called and `ob_size == allocated`, CPython reallocates with over-allocation:

```
new_allocated = (newsize >> 3) + (newsize < 9 ? 3 : 6) + newsize
```

This gives a growth pattern of approximately 0, 4, 8, 16, 24, 32, 40, 52, 64... — roughly 12.5% over-allocation. This ensures O(1) amortized cost for `append()`.

The `ob_item` array stores **pointers** to Python objects (8 bytes each on 64-bit), not the objects themselves. This is why Python lists use more memory than C arrays.

---

### 2. Are Python list operations thread-safe under the GIL?

**Answer:**
Individual bytecode operations are atomic under the GIL, so a single `lst.append(x)` won't corrupt the list. However, **compound operations are NOT thread-safe**:

```python
import threading

# NOT safe — read-modify-write is multiple bytecodes
shared = [0]
def increment():
    for _ in range(100_000):
        shared[0] += 1  # LOAD + ADD + STORE — not atomic

threads = [threading.Thread(target=increment) for _ in range(4)]
for t in threads: t.start()
for t in threads: t.join()
print(shared[0])  # < 400,000 due to race conditions
```

**Solutions:**
1. `threading.Lock` for shared state
2. `queue.Queue` for producer-consumer
3. `multiprocessing` with `Manager().list()` for cross-process sharing
4. Immutable data patterns — don't share mutable lists

---

### 3. How does `list.sort()` protect against mutation during sorting?

**Answer:**
CPython temporarily sets the list to empty during sorting:

```c
// In list_sort_impl:
saved_ob_item = self->ob_item;
self->ob_item = NULL;
Py_SET_SIZE(self, 0);
self->allocated = -1;  // sentinel value
```

If the comparison function (`key=`) tries to modify the list, CPython detects `allocated == -1` and raises `ValueError: list modified during sort`.

```python
# This will raise ValueError
data = [3, 1, 4, 1, 5]

def evil_key(x):
    data.append(0)  # try to modify during sort
    return x

data.sort(key=evil_key)
# ValueError: list modified during sort
```

---

### 4. Compare the performance of `list` vs `array.array` vs `numpy.ndarray` for numerical operations.

**Answer:**

```python
import timeit
import array
import sys

n = 1_000_000

# Memory comparison
lst = list(range(n))
arr = array.array("q", range(n))

print(f"list:  {sys.getsizeof(lst):>12,} bytes (pointers only)")
print(f"array: {sys.getsizeof(arr):>12,} bytes (raw values)")
# list stores 8-byte pointers + each int object (~28 bytes)
# Total list memory: ~36MB for 1M ints
# array stores 8-byte raw int64 values: ~8MB

# Speed comparison: sum
t_list = timeit.timeit("sum(lst)", globals={"lst": lst}, number=10)
t_arr = timeit.timeit("sum(arr)", globals={"arr": arr}, number=10)
print(f"sum(list):  {t_list:.3f}s")
print(f"sum(array): {t_arr:.3f}s")
# array.array sum is ~2x faster (less pointer chasing)

# NumPy is 10-100x faster for vectorized operations
# import numpy as np
# np_arr = np.arange(n)
# t_np = timeit.timeit("np_arr.sum()", globals={"np_arr": np_arr}, number=10)
```

| Feature | `list` | `array.array` | `numpy.ndarray` |
|---------|:------:|:-------------:|:---------------:|
| Memory per int | ~36 bytes | 8 bytes | 8 bytes |
| Heterogeneous | Yes | No | No |
| Vectorized math | No | No | Yes |
| Indexing speed | O(1) | O(1) | O(1) |
| Sum of 1M ints | ~50ms | ~25ms | ~1ms |

---

### 5. How would you implement a memory-efficient sorted list with O(log n) search?

**Answer:**

```python
import bisect

class SortedList:
    """Sorted list using bisect for O(log n) search."""

    def __init__(self):
        self._data = []

    def add(self, value):
        bisect.insort(self._data, value)  # O(log n) search + O(n) insert

    def remove(self, value):
        idx = bisect.bisect_left(self._data, value)
        if idx < len(self._data) and self._data[idx] == value:
            del self._data[idx]  # O(n) shift
        else:
            raise ValueError(f"{value} not in list")

    def __contains__(self, value):
        idx = bisect.bisect_left(self._data, value)
        return idx < len(self._data) and self._data[idx] == value

    def range_query(self, lo, hi):
        left = bisect.bisect_left(self._data, lo)
        right = bisect.bisect_right(self._data, hi)
        return self._data[left:right]
```

For better performance on large datasets, consider the `sortedcontainers.SortedList` library which uses a B-tree-like structure for O(log n) insertions.

---

### 6. Explain the late binding closure problem with lists and how to fix it.

**Answer:**

```python
# The problem:
functions = [lambda x: x * i for i in range(5)]
print([f(2) for f in functions])
# [8, 8, 8, 8, 8] — all return 2*4=8!

# Why: All lambdas capture the variable 'i' by reference.
# When called, i=4 (the last value of the loop).

# Fix 1: Default argument captures current value
functions = [lambda x, i=i: x * i for i in range(5)]
print([f(2) for f in functions])
# [0, 2, 4, 6, 8] ✅

# Fix 2: functools.partial
from functools import partial
def multiply(x, factor):
    return x * factor

functions = [partial(multiply, factor=i) for i in range(5)]
print([f(2) for f in functions])
# [0, 2, 4, 6, 8] ✅
```

---

## Scenario-Based Questions

### 1. Your Python web service returns a list of user records from the database. Users report that sometimes the response includes duplicate entries. How would you debug and fix this?

**Answer:**
1. **Check the database query** — add `DISTINCT` or verify JOIN conditions
2. **Log the raw query results** to confirm duplicates come from DB vs code
3. **Deduplicate in Python** as a safety measure:

```python
def deduplicate_by_id(records: list[dict]) -> list[dict]:
    """Remove duplicates while preserving order."""
    seen = set()
    result = []
    for record in records:
        if record["id"] not in seen:
            seen.add(record["id"])
            result.append(record)
    return result
```

4. **Add a unique constraint** to the database to prevent duplicates at the source
5. **Write a test** that verifies uniqueness of the response

---

### 2. You have a function that processes a list of 10 million items. It works correctly but is too slow. Memory usage is also high. How do you optimize it?

**Answer:**
1. **Profile first** — use `cProfile` and `tracemalloc` to find bottlenecks
2. **Use generators instead of lists** for intermediate transformations:

```python
# ❌ Creates 3 intermediate lists
filtered = [x for x in data if x > 0]
transformed = [x * 2 for x in filtered]
result = [x for x in transformed if x < 1000]

# ✅ Use generators — O(1) memory for intermediates
filtered = (x for x in data if x > 0)
transformed = (x * 2 for x in filtered)
result = [x for x in transformed if x < 1000]
```

3. **Consider `numpy`** for numerical operations (10-100x faster)
4. **Process in batches** to limit peak memory
5. **Use `bisect`** instead of linear search if the data is sorted
6. **Convert to `set`** for membership testing (`in` on list is O(n), on set is O(1))

---

### 3. A colleague's code uses `list * n` to create a 2D grid. All rows update simultaneously when one cell changes. Explain the bug.

**Answer:**

```python
# The bug:
grid = [[0] * 5] * 3  # Creates 3 references to the SAME inner list
grid[0][0] = 1
print(grid)
# [[1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0]]
# All rows changed!

# Why: * replicates references, not values
print(grid[0] is grid[1])  # True — same object

# Fix:
grid = [[0] * 5 for _ in range(3)]  # 3 independent lists
grid[0][0] = 1
print(grid)
# [[1, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]
```

Note: `[0] * 5` is safe because integers are immutable — you can't modify 0 in place. The problem only occurs with mutable objects (lists, dicts, custom objects).

---

### 4. Your team needs to implement a rate limiter that tracks the last N API requests per user. Which data structure would you use and why?

**Answer:**
Use `collections.deque(maxlen=N)` instead of a list:

```python
from collections import deque
from time import time


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window = window_seconds
        self.requests: dict[str, deque[float]] = {}

    def is_allowed(self, user_id: str) -> bool:
        now = time()
        if user_id not in self.requests:
            self.requests[user_id] = deque(maxlen=self.max_requests)

        window = self.requests[user_id]

        # Remove expired timestamps
        while window and window[0] < now - self.window:
            window.popleft()  # O(1) with deque

        if len(window) < self.max_requests:
            window.append(now)
            return True
        return False
```

**Why deque over list:**
- `deque.popleft()` is O(1) vs `list.pop(0)` is O(n)
- `maxlen` automatically discards old entries
- Better memory behavior for sliding window patterns

---

### 5. Your application runs out of memory when loading a large CSV file into a list. How do you handle this?

**Answer:**

```python
# ❌ Loads entire file into memory
with open("huge.csv") as f:
    all_lines = f.readlines()  # list of all lines in memory

# ✅ Option 1: Process line by line (generator)
def process_csv(filename):
    with open(filename) as f:
        for line in f:  # file object is an iterator — one line at a time
            yield line.strip().split(",")

# ✅ Option 2: Batch processing
def process_in_batches(filename, batch_size=10000):
    batch = []
    with open(filename) as f:
        for line in f:
            batch.append(line.strip().split(","))
            if len(batch) >= batch_size:
                yield batch
                batch = []
    if batch:
        yield batch

# ✅ Option 3: Use pandas with chunking
import pandas as pd
for chunk in pd.read_csv("huge.csv", chunksize=50000):
    process(chunk)

# ✅ Option 4: Memory-mapped file for random access
import mmap
with open("huge.csv", "r") as f:
    mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
```

---

## FAQ

### Q: Can I use a list as a dictionary key?

**A:** No. Lists are mutable and therefore unhashable. Dict keys must be hashable (immutable). Convert to a tuple first:

```python
# ❌ TypeError: unhashable type: 'list'
d = {[1, 2, 3]: "value"}

# ✅ Convert to tuple
d = {(1, 2, 3): "value"}
```

### Q: What is the maximum size of a Python list?

**A:** `sys.maxsize` elements (9,223,372,036,854,775,807 on 64-bit systems). In practice, you'll run out of memory long before reaching this limit. Each element requires at least 8 bytes for the pointer, so a max-size list would need ~64 petabytes just for pointers.

### Q: Is `list.append()` or `list += [x]` faster?

**A:** `append()` is faster. `list += [x]` creates a temporary list `[x]` and calls `list.extend()`, which has overhead from iterating the temporary list. `append()` directly calls the C function with the single item.

### Q: What do interviewers look for when asking about lists?

**A:** Key evaluation criteria:
- **Junior:** Can create, index, slice, and iterate lists. Knows common methods.
- **Middle:** Understands time complexity, knows when to use alternatives (deque, set, dict). Can spot mutable default argument bugs. Uses comprehensions properly.
- **Senior:** Understands CPython internals (over-allocation, PyListObject), GIL implications, memory profiling. Can design production systems with appropriate data structures.

### Q: When should I use a list vs a tuple?

**A:** Use a **tuple** when:
- Data should not change after creation (immutable)
- You need to use it as a dict key or set element (hashable)
- It represents a fixed-structure record (coordinates, RGB values)
- You want slightly better memory efficiency

Use a **list** when:
- You need to add, remove, or modify elements
- The collection size changes over time
- Order matters and you need sorting
