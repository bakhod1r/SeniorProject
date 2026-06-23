# Python Functions & Builtin Functions — Optimization Exercises

## Instructions

Each exercise presents **slow** Python code. Your task is to:

1. **Analyze** why the code is slow
2. **Optimize** it using the technique described
3. **Measure** the improvement with `timeit`
4. **Explain** the optimization at the bytecode/CPython level

Difficulty levels: **Easy** (straightforward optimization), **Medium** (requires deeper knowledge), **Hard** (requires CPython internals understanding)

---

## Score Card

| # | Difficulty | Technique | Speedup Achieved | Notes |
|---|---|---|---|---|
| 1 | Easy | Local variable caching | ___x | |
| 2 | Easy | Builtin vs custom | ___x | |
| 3 | Easy | `operator` module | ___x | |
| 4 | Medium | `functools.lru_cache` | ___x | |
| 5 | Medium | `map()` vs loop | ___x | |
| 6 | Medium | Avoiding function call overhead | ___x | |
| 7 | Medium | `__slots__` callable class | ___x | |
| 8 | Hard | `functools.reduce` + `operator` | ___x | |
| 9 | Hard | Bytecode-aware optimization | ___x | |
| 10 | Hard | C-level dispatch optimization | ___x | |
| 11 | Hard (Bonus) | Complete pipeline optimization | ___x | |

**Total exercises completed: ___ / 11**

---

## Easy

### Exercise 1: Local Variable Caching

**Technique:** Cache global/builtin lookups as local variables.

**Why it works:** `LOAD_FAST` (local variable) is a direct array index — O(1) with no hash table lookup. `LOAD_GLOBAL` requires a dictionary lookup in `f_globals` and potentially `f_builtins`.

```python
import timeit
import math

# SLOW VERSION: Repeatedly looks up globals/builtins
def compute_distances_slow(points):
    """Calculate distance from origin for each point"""
    distances = []
    for x, y in points:
        dist = math.sqrt(x * x + y * y)
        distances.append(dist)
    return distances

# Generate test data
points = [(i * 0.1, i * 0.2) for i in range(10000)]

# Benchmark slow version
t_slow = timeit.timeit(lambda: compute_distances_slow(points), number=100)
print(f"Slow: {t_slow:.4f}s")
```

**Your task:** Optimize by caching `math.sqrt` and `list.append` as local variables.

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit
import math

# SLOW VERSION
def compute_distances_slow(points):
    distances = []
    for x, y in points:
        dist = math.sqrt(x * x + y * y)
        distances.append(dist)
    return distances

# FAST VERSION: Cache lookups as locals
def compute_distances_fast(points):
    _sqrt = math.sqrt     # LOAD_FAST instead of LOAD_GLOBAL + LOAD_ATTR
    distances = []
    _append = distances.append  # LOAD_FAST instead of LOAD_ATTR each iteration
    for x, y in points:
        _append(_sqrt(x * x + y * y))
    return distances

# FASTEST: Use list comprehension (C-level loop)
def compute_distances_fastest(points):
    _sqrt = math.sqrt
    return [_sqrt(x * x + y * y) for x, y in points]

# Benchmark
points = [(i * 0.1, i * 0.2) for i in range(10000)]

t_slow = timeit.timeit(lambda: compute_distances_slow(points), number=100)
t_fast = timeit.timeit(lambda: compute_distances_fast(points), number=100)
t_fastest = timeit.timeit(lambda: compute_distances_fastest(points), number=100)

print(f"Slow (global lookups):  {t_slow:.4f}s")
print(f"Fast (local caching):   {t_fast:.4f}s  ({t_slow/t_fast:.2f}x speedup)")
print(f"Fastest (comprehension): {t_fastest:.4f}s  ({t_slow/t_fastest:.2f}x speedup)")

# Verify correctness
assert compute_distances_slow(points) == compute_distances_fast(points)
assert compute_distances_slow(points) == compute_distances_fastest(points)
```

**Expected speedup:** 1.2-1.5x for local caching, 1.5-2x for list comprehension.

**Bytecode explanation:**
```
# Slow: math.sqrt lookup each iteration
LOAD_GLOBAL  math           # dict lookup in f_globals
LOAD_ATTR    sqrt           # descriptor lookup
CALL         1

# Fast: _sqrt is a local
LOAD_FAST    _sqrt          # direct array index (one instruction)
CALL         1
```

</details>

---

### Exercise 2: Builtin vs Custom Implementation

**Technique:** Use C-implemented builtins instead of Python-level equivalents.

**Why it works:** Builtins like `sum()`, `max()`, `min()`, `len()` are implemented in C and operate at C speed. Python loops have per-iteration overhead from the bytecode interpreter.

```python
import timeit

# SLOW VERSION: Custom Python implementation
def sum_slow(numbers):
    total = 0
    for n in numbers:
        total += n
    return total

def max_slow(numbers):
    if not numbers:
        raise ValueError("empty sequence")
    result = numbers[0]
    for n in numbers[1:]:
        if n > result:
            result = n
    return result

def any_slow(iterable):
    for item in iterable:
        if item:
            return True
    return False

numbers = list(range(100000))
```

**Your task:** Replace with builtins and measure the difference.

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit

# SLOW: Python-level loops
def sum_slow(numbers):
    total = 0
    for n in numbers:
        total += n
    return total

def max_slow(numbers):
    if not numbers:
        raise ValueError("empty sequence")
    result = numbers[0]
    for n in numbers[1:]:
        if n > result:
            result = n
    return result

def any_slow(iterable):
    for item in iterable:
        if item:
            return True
    return False

# FAST: C-level builtins
sum_fast = sum     # Already a builtin
max_fast = max     # Already a builtin
any_fast = any     # Already a builtin

# Benchmark
numbers = list(range(100000))
booleans = [False] * 99999 + [True]

print("=== sum ===")
t1 = timeit.timeit(lambda: sum_slow(numbers), number=100)
t2 = timeit.timeit(lambda: sum_fast(numbers), number=100)
print(f"  Custom:  {t1:.4f}s")
print(f"  Builtin: {t2:.4f}s  ({t1/t2:.1f}x faster)")

print("\n=== max ===")
t1 = timeit.timeit(lambda: max_slow(numbers), number=100)
t2 = timeit.timeit(lambda: max_fast(numbers), number=100)
print(f"  Custom:  {t1:.4f}s")
print(f"  Builtin: {t2:.4f}s  ({t1/t2:.1f}x faster)")

print("\n=== any ===")
t1 = timeit.timeit(lambda: any_slow(booleans), number=100)
t2 = timeit.timeit(lambda: any_fast(booleans), number=100)
print(f"  Custom:  {t1:.4f}s")
print(f"  Builtin: {t2:.4f}s  ({t1/t2:.1f}x faster)")

# Verify correctness
assert sum_slow(numbers) == sum_fast(numbers)
assert max_slow(numbers) == max_fast(numbers)
assert any_slow(booleans) == any_fast(booleans)
```

**Expected speedup:** 3-10x depending on the builtin.

**Why:** Builtins skip the entire Python bytecode interpreter loop. `sum()` in C is essentially:
```c
while (item = PyIter_Next(iter)) {
    temp = PyNumber_Add(result, item);
    result = temp;
}
```
No `LOAD_FAST`, no `BINARY_ADD`, no `STORE_FAST` — just raw C.

</details>

---

### Exercise 3: The `operator` Module

**Technique:** Replace lambdas with `operator` module functions.

**Why it works:** `operator.itemgetter()` and `operator.attrgetter()` are C-implemented and avoid the overhead of creating and calling a Python lambda function.

```python
import timeit

# SLOW VERSION: Lambdas everywhere
data = [{"name": f"user_{i}", "score": i % 100, "age": 20 + i % 30}
        for i in range(10000)]

def sort_by_score_slow(data):
    return sorted(data, key=lambda x: x["score"])

def sort_by_multiple_slow(data):
    return sorted(data, key=lambda x: (x["score"], x["age"]))

def extract_scores_slow(data):
    return list(map(lambda x: x["score"], data))

def extract_pairs_slow(data):
    return list(map(lambda x: (x["name"], x["score"]), data))
```

**Your task:** Replace lambdas with `operator.itemgetter` and measure.

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit
from operator import itemgetter

data = [{"name": f"user_{i}", "score": i % 100, "age": 20 + i % 30}
        for i in range(10000)]

# SLOW: lambda functions
def sort_by_score_slow(data):
    return sorted(data, key=lambda x: x["score"])

def sort_by_multiple_slow(data):
    return sorted(data, key=lambda x: (x["score"], x["age"]))

def extract_scores_slow(data):
    return list(map(lambda x: x["score"], data))

def extract_pairs_slow(data):
    return list(map(lambda x: (x["name"], x["score"]), data))

# FAST: operator.itemgetter
def sort_by_score_fast(data):
    return sorted(data, key=itemgetter("score"))

def sort_by_multiple_fast(data):
    return sorted(data, key=itemgetter("score", "age"))

def extract_scores_fast(data):
    return list(map(itemgetter("score"), data))

def extract_pairs_fast(data):
    return list(map(itemgetter("name", "score"), data))

# Benchmark
for name, slow, fast in [
    ("sort single key", sort_by_score_slow, sort_by_score_fast),
    ("sort multi key", sort_by_multiple_slow, sort_by_multiple_fast),
    ("extract single", extract_scores_slow, extract_scores_fast),
    ("extract pair", extract_pairs_slow, extract_pairs_fast),
]:
    t_slow = timeit.timeit(lambda s=slow: s(data), number=100)
    t_fast = timeit.timeit(lambda f=fast: f(data), number=100)
    print(f"{name:20s}: lambda={t_slow:.4f}s  itemgetter={t_fast:.4f}s  "
          f"({t_slow/t_fast:.2f}x)")

# Verify correctness
assert sort_by_score_slow(data) == sort_by_score_fast(data)
assert extract_scores_slow(data) == extract_scores_fast(data)

# Also works with attrgetter for objects
from operator import attrgetter

class User:
    def __init__(self, name, score):
        self.name = name
        self.score = score

users = [User(f"user_{i}", i % 100) for i in range(10000)]

t_lambda = timeit.timeit(
    lambda: sorted(users, key=lambda u: u.score), number=100)
t_attrgetter = timeit.timeit(
    lambda: sorted(users, key=attrgetter("score")), number=100)
print(f"\nattrgetter: lambda={t_lambda:.4f}s  attrgetter={t_attrgetter:.4f}s  "
      f"({t_lambda/t_attrgetter:.2f}x)")
```

**Expected speedup:** 1.2-2x.

**Why:** `operator.itemgetter` is a C-implemented callable that avoids:
- Python function call overhead (frame creation)
- LOAD_FAST/BINARY_SUBSCR bytecode execution
- Lambda's MAKE_FUNCTION overhead (if created in a loop)

</details>

---

## Medium

### Exercise 4: `functools.lru_cache` for Recursive Functions

**Technique:** Use `lru_cache` to memoize expensive recursive computations.

**Why it works:** `lru_cache` is implemented in C (since Python 3.8) and uses an efficient doubly-linked list + dict structure for O(1) lookup and eviction.

```python
import timeit

# SLOW VERSION: Exponential time complexity O(2^n)
def fibonacci_slow(n):
    if n <= 1:
        return n
    return fibonacci_slow(n - 1) + fibonacci_slow(n - 2)

# This takes forever for large n
t = timeit.timeit(lambda: fibonacci_slow(30), number=1)
print(f"fibonacci_slow(30): {t:.4f}s")

# Try fibonacci_slow(50) and it will take hours...
```

**Your task:** Apply `lru_cache` and also write a manual cache version. Compare both with the slow version.

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit
from functools import lru_cache

# SLOW: O(2^n) — exponential
def fibonacci_slow(n):
    if n <= 1:
        return n
    return fibonacci_slow(n - 1) + fibonacci_slow(n - 2)

# FAST 1: lru_cache — O(n) first call, O(1) subsequent
@lru_cache(maxsize=None)
def fibonacci_cached(n):
    if n <= 1:
        return n
    return fibonacci_cached(n - 1) + fibonacci_cached(n - 2)

# FAST 2: Manual memoization — O(n) first call, O(1) subsequent
def fibonacci_manual(n, _cache={}):
    if n in _cache:
        return _cache[n]
    if n <= 1:
        result = n
    else:
        result = fibonacci_manual(n - 1) + fibonacci_manual(n - 2)
    _cache[n] = result
    return result

# FAST 3: Iterative — O(n), no function call overhead
def fibonacci_iterative(n):
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

# Benchmark
print("=== Small input (n=30) ===")
t_slow = timeit.timeit(lambda: fibonacci_slow(30), number=1)
print(f"  Slow (recursive):     {t_slow:.4f}s")

fibonacci_cached.cache_clear()  # Reset cache
t_cached_first = timeit.timeit(lambda: fibonacci_cached(30), number=1)
print(f"  lru_cache (1st call): {t_cached_first:.6f}s  ({t_slow/t_cached_first:.0f}x)")

t_cached_repeat = timeit.timeit(lambda: fibonacci_cached(30), number=10000)
print(f"  lru_cache (cached):   {t_cached_repeat:.6f}s for 10K calls")

t_manual = timeit.timeit(lambda: fibonacci_manual(30), number=10000)
print(f"  Manual cache:         {t_manual:.6f}s for 10K calls")

t_iter = timeit.timeit(lambda: fibonacci_iterative(30), number=10000)
print(f"  Iterative:            {t_iter:.6f}s for 10K calls")

# Large input — only possible with optimization
print("\n=== Large input (n=500) ===")
fibonacci_cached.cache_clear()
t1 = timeit.timeit(lambda: fibonacci_cached(500), number=1)
print(f"  lru_cache:   {t1:.6f}s")

t2 = timeit.timeit(lambda: fibonacci_iterative(500), number=1)
print(f"  Iterative:   {t2:.6f}s")

# lru_cache stats
print(f"\n  Cache info: {fibonacci_cached.cache_info()}")

# Verify correctness
assert fibonacci_cached(30) == fibonacci_slow(30)
assert fibonacci_manual(30) == fibonacci_slow(30)
assert fibonacci_iterative(30) == fibonacci_slow(30)

# Real-world example: memoizing expensive computations
@lru_cache(maxsize=256)
def count_paths(m, n):
    """Count unique paths in an m x n grid (dynamic programming)"""
    if m == 1 or n == 1:
        return 1
    return count_paths(m - 1, n) + count_paths(m, n - 1)

print(f"\nPaths in 20x20 grid: {count_paths(20, 20)}")
print(f"Cache info: {count_paths.cache_info()}")
```

**Expected speedup:** 100,000x+ for n=30.

**Key insight:** `lru_cache` with `maxsize=None` is essentially an infinite dict cache implemented in C, making it faster than a manual Python dict cache.

</details>

---

### Exercise 5: `map()` and Comprehensions vs Loops

**Technique:** Replace explicit loops with `map()`, `filter()`, and comprehensions.

**Why it works:** `map()` calls the function at C level, and list comprehensions use a special `LIST_APPEND` bytecode that's faster than `LOAD_ATTR` + `CALL` for `list.append()`.

```python
import timeit

# SLOW VERSION: Explicit loop with append
def transform_slow(data):
    result = []
    for item in data:
        if item % 2 == 0:
            result.append(item ** 2)
    return result

def convert_types_slow(strings):
    result = []
    for s in strings:
        result.append(int(s))
    return result

def apply_multiple_slow(data, functions):
    """Apply multiple functions to each item"""
    results = []
    for item in data:
        transformed = item
        for func in functions:
            transformed = func(transformed)
        results.append(transformed)
    return results

data = list(range(100000))
strings = [str(i) for i in range(100000)]
```

**Your task:** Rewrite using comprehensions, `map()`, and `filter()`. Benchmark all approaches.

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit
from functools import reduce

data = list(range(100000))
strings = [str(i) for i in range(100000)]

# --- Transform: filter + map ---

def transform_slow(data):
    result = []
    for item in data:
        if item % 2 == 0:
            result.append(item ** 2)
    return result

def transform_comprehension(data):
    return [item ** 2 for item in data if item % 2 == 0]

def transform_map_filter(data):
    return list(map(lambda x: x ** 2, filter(lambda x: x % 2 == 0, data)))

print("=== Filter + Transform ===")
for name, fn in [("loop", transform_slow),
                  ("comprehension", transform_comprehension),
                  ("map+filter", transform_map_filter)]:
    t = timeit.timeit(lambda f=fn: f(data), number=50)
    print(f"  {name:20s}: {t:.4f}s")

# --- Type conversion ---

def convert_types_slow(strings):
    result = []
    for s in strings:
        result.append(int(s))
    return result

def convert_types_map(strings):
    return list(map(int, strings))  # int is C-implemented, no lambda needed

def convert_types_comp(strings):
    return [int(s) for s in strings]

print("\n=== Type Conversion ===")
for name, fn in [("loop", convert_types_slow),
                  ("map(int, ...)", convert_types_map),
                  ("comprehension", convert_types_comp)]:
    t = timeit.timeit(lambda f=fn: f(strings), number=50)
    print(f"  {name:20s}: {t:.4f}s")

# --- Apply multiple functions ---

def apply_multiple_slow(data, functions):
    results = []
    for item in data:
        transformed = item
        for func in functions:
            transformed = func(transformed)
        results.append(transformed)
    return results

def apply_multiple_reduce(data, functions):
    def apply_all(x):
        return reduce(lambda val, fn: fn(val), functions, x)
    return list(map(apply_all, data))

def apply_multiple_compose(data, functions):
    # Pre-compose all functions into one
    def composed(x):
        for fn in functions:
            x = fn(x)
        return x
    return [composed(item) for item in data]

funcs = [lambda x: x + 1, lambda x: x * 2, lambda x: x - 3]
small_data = list(range(50000))

print("\n=== Apply Multiple Functions ===")
for name, fn in [("nested loop", lambda: apply_multiple_slow(small_data, funcs)),
                  ("reduce+map", lambda: apply_multiple_reduce(small_data, funcs)),
                  ("compose+comp", lambda: apply_multiple_compose(small_data, funcs))]:
    t = timeit.timeit(fn, number=50)
    print(f"  {name:20s}: {t:.4f}s")

# Verify correctness
assert transform_slow(data) == transform_comprehension(data)
assert convert_types_slow(strings) == convert_types_map(strings)
```

**Expected speedup:**
- Comprehensions vs loops: 1.2-1.5x
- `map(int, ...)` vs loop: 1.5-2x (because `int` is called directly in C, no Python-level `CALL`)

</details>

---

### Exercise 6: Reducing Function Call Overhead

**Technique:** Minimize the number of Python function calls in hot paths.

**Why it works:** Each Python function call requires creating a frame object, pushing to the call stack, and executing several bytecodes. In tight loops, this overhead dominates.

```python
import timeit

# SLOW VERSION: Multiple function calls per iteration
def validate_and_transform_slow(data):
    """Validate each item, transform if valid"""

    def is_valid(x):
        return isinstance(x, (int, float)) and x >= 0

    def transform(x):
        return round(x ** 0.5, 2)

    def format_result(x):
        return f"{x:.2f}"

    results = []
    for item in data:
        if is_valid(item):
            transformed = transform(item)
            formatted = format_result(transformed)
            results.append(formatted)
    return results

data = list(range(50000))
t = timeit.timeit(lambda: validate_and_transform_slow(data), number=50)
print(f"Slow: {t:.4f}s")
```

**Your task:** Inline the function calls and reduce overhead.

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit

# SLOW: 3 function calls per valid item
def validate_and_transform_slow(data):
    def is_valid(x):
        return isinstance(x, (int, float)) and x >= 0

    def transform(x):
        return round(x ** 0.5, 2)

    def format_result(x):
        return f"{x:.2f}"

    results = []
    for item in data:
        if is_valid(item):
            transformed = transform(item)
            formatted = format_result(transformed)
            results.append(formatted)
    return results

# FAST 1: Inline everything
def validate_and_transform_inlined(data):
    _isinstance = isinstance
    _round = round
    _int_float = (int, float)
    results = []
    _append = results.append
    for item in data:
        if _isinstance(item, _int_float) and item >= 0:
            _append(f"{_round(item ** 0.5, 2):.2f}")
    return results

# FAST 2: List comprehension (even less overhead)
def validate_and_transform_comp(data):
    _round = round
    return [f"{_round(item ** 0.5, 2):.2f}"
            for item in data
            if isinstance(item, (int, float)) and item >= 0]

# FAST 3: Precompute with generator chain
def validate_and_transform_gen(data):
    _round = round
    valid = (item for item in data if isinstance(item, (int, float)) and item >= 0)
    return [f"{_round(item ** 0.5, 2):.2f}" for item in valid]

# Benchmark
data = list(range(50000))

print("=== Function Call Overhead ===")
for name, fn in [
    ("3 calls/item", validate_and_transform_slow),
    ("inlined", validate_and_transform_inlined),
    ("comprehension", validate_and_transform_comp),
    ("generator chain", validate_and_transform_gen),
]:
    t = timeit.timeit(lambda f=fn: f(data), number=50)
    print(f"  {name:20s}: {t:.4f}s")

# Verify
assert validate_and_transform_slow(data) == validate_and_transform_inlined(data)
assert validate_and_transform_slow(data) == validate_and_transform_comp(data)
```

**Expected speedup:** 1.5-2.5x.

**Key insight:** In CPython, every function call requires:
1. `CALL` instruction evaluation
2. Frame creation (~100-200ns)
3. Argument parsing
4. Stack manipulation

Inlining eliminates all of this. But maintain readability — only inline in proven hot paths.

</details>

---

### Exercise 7: Callable Class with `__slots__`

**Technique:** Use `__slots__` on callable classes to reduce memory and improve attribute access speed.

```python
import timeit
import sys

# SLOW VERSION: Regular class callable
class Multiplier:
    def __init__(self, factor):
        self.factor = factor

    def __call__(self, x):
        return x * self.factor

# Usage
double = Multiplier(2)
data = list(range(100000))

t = timeit.timeit(lambda: [double(x) for x in data], number=50)
print(f"Regular class: {t:.4f}s")
print(f"Size: {sys.getsizeof(double)} bytes (+ __dict__: {sys.getsizeof(double.__dict__)})")
```

**Your task:** Optimize with `__slots__` and compare with a closure approach.

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit
import sys

# SLOW: Regular class with __dict__
class MultiplierDict:
    def __init__(self, factor):
        self.factor = factor

    def __call__(self, x):
        return x * self.factor

# FAST 1: Class with __slots__
class MultiplierSlots:
    __slots__ = ('factor',)

    def __init__(self, factor):
        self.factor = factor

    def __call__(self, x):
        return x * self.factor

# FAST 2: Closure (no class overhead at all)
def make_multiplier(factor):
    def multiply(x):
        return x * factor
    return multiply

# FAST 3: functools.partial (C-implemented)
from functools import partial
from operator import mul

def multiply_two(factor, x):
    return factor * x

data = list(range(100000))

# Create instances
dict_mult = MultiplierDict(2)
slots_mult = MultiplierSlots(2)
closure_mult = make_multiplier(2)
partial_mult = partial(mul, 2)  # Using C-level operator.mul

print("=== Memory Comparison ===")
print(f"  Regular class: {sys.getsizeof(dict_mult)} + dict({sys.getsizeof(dict_mult.__dict__)})")
print(f"  Slots class:   {sys.getsizeof(slots_mult)} (no __dict__)")
print(f"  Closure:       {sys.getsizeof(closure_mult)}")
print(f"  Partial:       {sys.getsizeof(partial_mult)}")

print("\n=== Speed Comparison ===")
for name, fn in [
    ("Regular class", dict_mult),
    ("Slots class", slots_mult),
    ("Closure", closure_mult),
    ("partial(mul, 2)", partial_mult),
]:
    t = timeit.timeit(lambda f=fn: [f(x) for x in data], number=50)
    print(f"  {name:20s}: {t:.4f}s")

# With map() instead of comprehension
print("\n=== With map() ===")
for name, fn in [
    ("Slots class", slots_mult),
    ("Closure", closure_mult),
    ("partial(mul, 2)", partial_mult),
]:
    t = timeit.timeit(lambda f=fn: list(map(f, data)), number=50)
    print(f"  {name:20s}: {t:.4f}s")

# Verify correctness
assert [dict_mult(x) for x in range(10)] == [slots_mult(x) for x in range(10)]
assert [dict_mult(x) for x in range(10)] == [closure_mult(x) for x in range(10)]
assert [dict_mult(x) for x in range(10)] == [partial_mult(x) for x in range(10)]
```

**Expected speedup:** `partial(mul, 2)` with `map()` is typically fastest because both `partial`, `mul`, and `map` are C-implemented.

</details>

---

## Hard

### Exercise 8: `functools.reduce` + `operator` Pipeline

**Technique:** Combine `functools.reduce` with `operator` module for efficient aggregations.

```python
import timeit
from typing import List, Dict

# SLOW VERSION: Multiple passes over data
def analyze_transactions_slow(transactions: List[Dict]) -> Dict:
    """Analyze a list of transactions"""
    # Pass 1: Total amount
    total = 0
    for t in transactions:
        total += t["amount"]

    # Pass 2: Count by category
    categories = {}
    for t in transactions:
        cat = t["category"]
        if cat not in categories:
            categories[cat] = 0
        categories[cat] += 1

    # Pass 3: Max transaction
    max_amount = transactions[0]["amount"]
    for t in transactions[1:]:
        if t["amount"] > max_amount:
            max_amount = t["amount"]

    # Pass 4: Average
    average = total / len(transactions)

    return {
        "total": total,
        "average": average,
        "max": max_amount,
        "categories": categories,
    }

# Generate test data
import random
random.seed(42)
categories = ["food", "transport", "entertainment", "utilities", "shopping"]
transactions = [
    {"id": i, "amount": random.uniform(1, 500), "category": random.choice(categories)}
    for i in range(100000)
]
```

**Your task:** Rewrite using builtins, `operator`, and single-pass algorithms.

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit
import random
from operator import itemgetter
from collections import Counter
from functools import reduce

random.seed(42)
categories_list = ["food", "transport", "entertainment", "utilities", "shopping"]
transactions = [
    {"id": i, "amount": random.uniform(1, 500), "category": random.choice(categories_list)}
    for i in range(100000)
]

# SLOW: 4 passes over data
def analyze_slow(transactions):
    total = 0
    for t in transactions:
        total += t["amount"]

    categories = {}
    for t in transactions:
        cat = t["category"]
        if cat not in categories:
            categories[cat] = 0
        categories[cat] += 1

    max_amount = transactions[0]["amount"]
    for t in transactions[1:]:
        if t["amount"] > max_amount:
            max_amount = t["amount"]

    return {
        "total": total,
        "average": total / len(transactions),
        "max": max_amount,
        "categories": categories,
    }

# FAST 1: Builtins + operator
def analyze_builtins(transactions):
    _get_amount = itemgetter("amount")
    _get_category = itemgetter("category")

    amounts = list(map(_get_amount, transactions))
    total = sum(amounts)

    return {
        "total": total,
        "average": total / len(transactions),
        "max": max(amounts),
        "categories": dict(Counter(map(_get_category, transactions))),
    }

# FAST 2: Single pass
def analyze_single_pass(transactions):
    _get = dict.__getitem__
    total = 0.0
    max_amount = float('-inf')
    categories = {}

    for t in transactions:
        amount = t["amount"]
        total += amount
        if amount > max_amount:
            max_amount = amount
        cat = t["category"]
        categories[cat] = categories.get(cat, 0) + 1

    return {
        "total": total,
        "average": total / len(transactions),
        "max": max_amount,
        "categories": categories,
    }

# FAST 3: Single pass with local caching
def analyze_optimized(transactions):
    total = 0.0
    max_amount = float('-inf')
    categories = {}
    _get = categories.get

    for t in transactions:
        amount = t["amount"]
        total += amount
        if amount > max_amount:
            max_amount = amount
        cat = t["category"]
        categories[cat] = _get(cat, 0) + 1

    n = len(transactions)
    return {
        "total": total,
        "average": total / n,
        "max": max_amount,
        "categories": categories,
    }

# Benchmark
print("=== Transaction Analysis ===")
for name, fn in [
    ("4 passes", analyze_slow),
    ("builtins+operator", analyze_builtins),
    ("single pass", analyze_single_pass),
    ("single pass+cache", analyze_optimized),
]:
    t = timeit.timeit(lambda f=fn: f(transactions), number=20)
    print(f"  {name:22s}: {t:.4f}s")

# Verify correctness
result_slow = analyze_slow(transactions)
result_fast = analyze_builtins(transactions)
assert abs(result_slow["total"] - result_fast["total"]) < 0.01
assert abs(result_slow["max"] - result_fast["max"]) < 0.01
assert result_slow["categories"] == result_fast["categories"]
```

**Expected speedup:** 1.5-2.5x for single pass with local caching.

**Key insight:** Reducing passes over data matters more than micro-optimizations when the dataset is large. Cache locality (accessing memory sequentially) is also a factor.

</details>

---

### Exercise 9: Bytecode-Aware Optimization

**Technique:** Understand which Python constructs produce faster bytecode.

```python
import timeit
import dis

# These pairs of functions do the same thing but produce different bytecodes.
# Your task: Predict which is faster and verify with timeit.

# Pair 1: Membership testing
def membership_list(x, data):
    return x in data

def membership_set(x, data):
    return x in data

# Pair 2: Boolean conversion
def bool_explicit(x):
    if x:
        return True
    return False

def bool_cast(x):
    return bool(x)

def bool_double_not(x):
    return not not x

# Pair 3: Conditional assignment
def conditional_if(x):
    if x > 0:
        result = x
    else:
        result = -x

def conditional_ternary(x):
    result = x if x > 0 else -x

def conditional_abs(x):
    result = abs(x)
```

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit
import dis

# === Pair 1: Membership testing ===
print("=== Membership Testing ===")

data_list = list(range(10000))
data_set = set(data_list)
data_tuple = tuple(data_list)

# Test with element that's near the end
test_val = 9999

t_list = timeit.timeit(lambda: test_val in data_list, number=10000)
t_set = timeit.timeit(lambda: test_val in data_set, number=10000)
t_tuple = timeit.timeit(lambda: test_val in data_tuple, number=10000)

print(f"  list 'in':  {t_list:.4f}s")
print(f"  set 'in':   {t_set:.4f}s  ({t_list/t_set:.0f}x faster)")
print(f"  tuple 'in': {t_tuple:.4f}s")

# Bytecode is identical — the difference is in the __contains__ implementation
# set.__contains__ is O(1) hash lookup
# list.__contains__ is O(n) linear scan

# === Pair 2: Boolean conversion ===
print("\n=== Boolean Conversion ===")

def bool_if(x):
    if x:
        return True
    return False

def bool_cast(x):
    return bool(x)

def bool_not_not(x):
    return not not x

for test_val in [42, 0, "", "hello", [], [1]]:
    pass  # Just verifying they all return the same thing
    assert bool_if(test_val) == bool_cast(test_val) == bool_not_not(test_val)

t1 = timeit.timeit(lambda: bool_if(42), number=1000000)
t2 = timeit.timeit(lambda: bool_cast(42), number=1000000)
t3 = timeit.timeit(lambda: bool_not_not(42), number=1000000)

print(f"  if/else:   {t1:.4f}s")
print(f"  bool():    {t2:.4f}s")
print(f"  not not:   {t3:.4f}s")

# Show bytecode
print("\n  bool() bytecode:")
dis.dis(bool_cast)
print("\n  not not bytecode:")
dis.dis(bool_not_not)

# not not is typically fastest because:
# - UNARY_NOT is a single fast opcode (no function call)
# - bool() requires LOAD_GLOBAL + CALL (function call overhead)

# === Pair 3: Conditional assignment ===
print("\n=== Conditional Assignment ===")

def cond_if(x):
    if x > 0:
        return x
    else:
        return -x

def cond_ternary(x):
    return x if x > 0 else -x

def cond_abs(x):
    return abs(x)

t1 = timeit.timeit(lambda: cond_if(42), number=1000000)
t2 = timeit.timeit(lambda: cond_ternary(42), number=1000000)
t3 = timeit.timeit(lambda: cond_abs(42), number=1000000)

print(f"  if/else:   {t1:.4f}s")
print(f"  ternary:   {t2:.4f}s")
print(f"  abs():     {t3:.4f}s")

# abs() calls C-level function for int/float — single type check + operation
# ternary and if/else produce similar bytecode but ternary is slightly more compact

# === Pair 4: String building ===
print("\n=== String Building ===")

words = ["hello", "world", "foo", "bar"] * 1000

def str_concat(words):
    result = ""
    for w in words:
        result += " " + w
    return result

def str_join(words):
    return " ".join(words)

def str_format(words):
    return " ".join(f"{w}" for w in words)

t1 = timeit.timeit(lambda: str_concat(words), number=100)
t2 = timeit.timeit(lambda: str_join(words), number=100)
t3 = timeit.timeit(lambda: str_format(words), number=100)

print(f"  += concat:   {t1:.4f}s")
print(f"  str.join():  {t2:.4f}s  ({t1/t2:.1f}x faster)")
print(f"  f-string:    {t3:.4f}s")

# str.join() is O(n) — it pre-calculates the total length and copies once
# += is O(n^2) in the worst case (though CPython has an optimization for this)

# === Pair 5: Dictionary access ===
print("\n=== Dict Access Patterns ===")

d = {str(i): i for i in range(1000)}

def dict_get(d, key):
    return d.get(key, None)

def dict_try(d, key):
    try:
        return d[key]
    except KeyError:
        return None

def dict_in(d, key):
    if key in d:
        return d[key]
    return None

# Key exists (common case)
t1 = timeit.timeit(lambda: dict_get(d, "500"), number=100000)
t2 = timeit.timeit(lambda: dict_try(d, "500"), number=100000)
t3 = timeit.timeit(lambda: dict_in(d, "500"), number=100000)

print(f"  .get() (key exists):      {t1:.4f}s")
print(f"  try/except (key exists):  {t2:.4f}s")
print(f"  'in' check (key exists):  {t3:.4f}s")

# Key missing
t1 = timeit.timeit(lambda: dict_get(d, "missing"), number=100000)
t2 = timeit.timeit(lambda: dict_try(d, "missing"), number=100000)
t3 = timeit.timeit(lambda: dict_in(d, "missing"), number=100000)

print(f"  .get() (key missing):     {t1:.4f}s")
print(f"  try/except (key missing): {t2:.4f}s  (exception overhead!)")
print(f"  'in' check (key missing): {t3:.4f}s")

# When key usually exists: try/except is fastest (no overhead on success)
# When key often missing: .get() or 'in' check (exceptions are expensive)
```

</details>

---

### Exercise 10: C-Level Dispatch Optimization

**Technique:** Arrange code so CPython can use faster C-level dispatch paths.

**Why it works:** CPython has specialized fast paths for certain patterns. Understanding them lets you write code that hits these fast paths.

```python
import timeit

# SLOW: This triggers generic Python-level dispatch
class Vector:
    def __init__(self, x, y, z):
        self.x = x
        self.y = y
        self.z = z

    def dot(self, other):
        return self.x * other.x + self.y * other.y + self.z * other.z

    def length(self):
        return (self.x ** 2 + self.y ** 2 + self.z ** 2) ** 0.5

    def normalized(self):
        l = self.length()
        return Vector(self.x / l, self.y / l, self.z / l)

def compute_angles_slow(vectors, reference):
    """Compute angle between each vector and a reference"""
    results = []
    for v in vectors:
        dot = v.dot(reference)
        mag_v = v.length()
        mag_r = reference.length()
        cos_angle = dot / (mag_v * mag_r)
        # Clamp to [-1, 1] to avoid acos domain errors
        cos_angle = max(-1, min(1, cos_angle))
        results.append(cos_angle)
    return results

import random
random.seed(42)
vectors = [Vector(random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))
           for _ in range(50000)]
reference = Vector(1, 0, 0)
```

**Your task:** Optimize using `__slots__`, local caching, and tuple-based computation.

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit
import random
import math

random.seed(42)

# SLOW: Regular class with attribute access overhead
class VectorSlow:
    def __init__(self, x, y, z):
        self.x = x
        self.y = y
        self.z = z

    def dot(self, other):
        return self.x * other.x + self.y * other.y + self.z * other.z

    def length(self):
        return (self.x ** 2 + self.y ** 2 + self.z ** 2) ** 0.5

def compute_slow(vectors, reference):
    results = []
    for v in vectors:
        dot = v.dot(reference)
        mag_v = v.length()
        mag_r = reference.length()
        cos_angle = dot / (mag_v * mag_r)
        cos_angle = max(-1, min(1, cos_angle))
        results.append(cos_angle)
    return results

# FAST 1: __slots__ class with cached reference values
class VectorSlots:
    __slots__ = ('x', 'y', 'z')

    def __init__(self, x, y, z):
        self.x = x
        self.y = y
        self.z = z

def compute_slots(vectors, ref):
    """Slots class + precomputed reference + local caching"""
    _sqrt = math.sqrt
    _max = max
    _min = min

    ref_x, ref_y, ref_z = ref.x, ref.y, ref.z
    ref_mag = _sqrt(ref_x * ref_x + ref_y * ref_y + ref_z * ref_z)

    results = []
    _append = results.append

    for v in vectors:
        vx, vy, vz = v.x, v.y, v.z
        dot = vx * ref_x + vy * ref_y + vz * ref_z
        mag_v = _sqrt(vx * vx + vy * vy + vz * vz)
        cos_angle = dot / (mag_v * ref_mag)
        _append(_max(-1.0, _min(1.0, cos_angle)))

    return results

# FAST 2: Tuple-based (avoid attribute access entirely)
def compute_tuples(vectors, ref):
    """Pure tuples — no attribute access, no object overhead"""
    _sqrt = math.sqrt

    ref_x, ref_y, ref_z = ref
    ref_mag = _sqrt(ref_x * ref_x + ref_y * ref_y + ref_z * ref_z)

    results = []
    _append = results.append

    for vx, vy, vz in vectors:
        dot = vx * ref_x + vy * ref_y + vz * ref_z
        mag_v = _sqrt(vx * vx + vy * vy + vz * vz)
        cos_angle = dot / (mag_v * ref_mag)
        _append(max(-1.0, min(1.0, cos_angle)))

    return results

# FAST 3: Tuple + list comprehension
def compute_comp(vectors, ref):
    """List comprehension with tuples"""
    _sqrt = math.sqrt
    rx, ry, rz = ref
    rm = _sqrt(rx*rx + ry*ry + rz*rz)

    return [
        max(-1.0, min(1.0,
            (vx*rx + vy*ry + vz*rz) / (_sqrt(vx*vx + vy*vy + vz*vz) * rm)
        ))
        for vx, vy, vz in vectors
    ]

# Generate test data
N = 50000

# Slow vectors
vectors_slow = [VectorSlow(random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))
                for _ in range(N)]
ref_slow = VectorSlow(1, 0, 0)

# Slots vectors (reuse same random seed)
random.seed(42)
vectors_slots = [VectorSlots(random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))
                 for _ in range(N)]
ref_slots = VectorSlots(1, 0, 0)

# Tuple vectors
random.seed(42)
vectors_tuples = [(random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))
                  for _ in range(N)]
ref_tuple = (1.0, 0.0, 0.0)

# Benchmark
print("=== Vector Angle Computation ===")
t1 = timeit.timeit(lambda: compute_slow(vectors_slow, ref_slow), number=10)
t2 = timeit.timeit(lambda: compute_slots(vectors_slots, ref_slots), number=10)
t3 = timeit.timeit(lambda: compute_tuples(vectors_tuples, ref_tuple), number=10)
t4 = timeit.timeit(lambda: compute_comp(vectors_tuples, ref_tuple), number=10)

print(f"  Regular class:      {t1:.4f}s")
print(f"  __slots__ + cache:  {t2:.4f}s  ({t1/t2:.2f}x)")
print(f"  Tuples:             {t3:.4f}s  ({t1/t3:.2f}x)")
print(f"  Tuples + comp:      {t4:.4f}s  ({t1/t4:.2f}x)")

# Verify correctness (compare a few values)
r1 = compute_slow(vectors_slow, ref_slow)[:5]
r2 = compute_slots(vectors_slots, ref_slots)[:5]
r3 = compute_tuples(vectors_tuples, ref_tuple)[:5]
for a, b, c in zip(r1, r2, r3):
    assert abs(a - b) < 1e-10
    assert abs(a - c) < 1e-10
print("\nAll results match!")
```

**Expected speedup:** 2-4x from regular class to tuples.

**Why tuples are fastest:**
- No attribute lookup (`LOAD_ATTR` bytecode) — tuple unpacking uses `UNPACK_SEQUENCE` (fast C operation)
- Tuples are immutable and have smaller memory footprint
- Better cache locality (contiguous memory)
- No `__dict__` or descriptor protocol involved

</details>

---

### Exercise 11 (Bonus): Complete Pipeline Optimization

**Technique:** Apply all learned optimizations to a real-world data processing pipeline.

```python
import timeit
import json

# Simulated log data
def generate_logs(n):
    import random
    random.seed(42)
    levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
    services = ["auth", "api", "db", "cache", "worker"]

    logs = []
    for i in range(n):
        logs.append({
            "timestamp": 1000000 + i,
            "level": random.choice(levels),
            "service": random.choice(services),
            "message": f"Log message {i} from service " + random.choice(services),
            "response_time": random.uniform(0.001, 5.0),
            "status_code": random.choice([200, 200, 200, 201, 400, 404, 500]),
        })
    return logs

logs = generate_logs(100000)

# SLOW VERSION: Process logs
def analyze_logs_slow(logs):
    """Analyze log data — unoptimized"""
    results = {}

    # Count by level
    level_counts = {}
    for log in logs:
        level = log["level"]
        if level in level_counts:
            level_counts[level] += 1
        else:
            level_counts[level] = 1
    results["level_counts"] = level_counts

    # Count errors by service
    error_counts = {}
    for log in logs:
        if log["level"] in ["ERROR", "CRITICAL"]:
            service = log["service"]
            if service in error_counts:
                error_counts[service] += 1
            else:
                error_counts[service] = 1
    results["error_counts"] = error_counts

    # Average response time per service
    service_times = {}
    service_counts = {}
    for log in logs:
        service = log["service"]
        rt = log["response_time"]
        if service in service_times:
            service_times[service] += rt
            service_counts[service] += 1
        else:
            service_times[service] = rt
            service_counts[service] = 1
    results["avg_response_times"] = {}
    for service in service_times:
        results["avg_response_times"][service] = (
            service_times[service] / service_counts[service]
        )

    # P95 response times
    service_all_times = {}
    for log in logs:
        service = log["service"]
        if service not in service_all_times:
            service_all_times[service] = []
        service_all_times[service].append(log["response_time"])
    results["p95_response_times"] = {}
    for service, times in service_all_times.items():
        sorted_times = sorted(times)
        idx = int(len(sorted_times) * 0.95)
        results["p95_response_times"][service] = sorted_times[idx]

    # Error rate
    total = len(logs)
    errors = sum(1 for log in logs if log["level"] in ["ERROR", "CRITICAL"])
    results["error_rate"] = errors / total

    # Slow endpoints (response_time > 2.0)
    slow_logs = []
    for log in logs:
        if log["response_time"] > 2.0:
            slow_logs.append({
                "service": log["service"],
                "response_time": log["response_time"],
                "status_code": log["status_code"],
            })
    results["slow_count"] = len(slow_logs)

    return results

t = timeit.timeit(lambda: analyze_logs_slow(logs), number=10)
print(f"Slow: {t:.4f}s")
```

**Your task:** Apply every optimization technique from this document:
1. Single pass where possible
2. Local variable caching
3. `operator.itemgetter`
4. `collections.Counter` / `collections.defaultdict`
5. List comprehensions
6. Set for membership testing

<details>
<summary><strong>Optimized Solution</strong></summary>

```python
import timeit
import random
from collections import defaultdict, Counter
from operator import itemgetter

def generate_logs(n):
    random.seed(42)
    levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
    services = ["auth", "api", "db", "cache", "worker"]

    logs = []
    for i in range(n):
        logs.append({
            "timestamp": 1000000 + i,
            "level": random.choice(levels),
            "service": random.choice(services),
            "message": f"Log message {i} from service " + random.choice(services),
            "response_time": random.uniform(0.001, 5.0),
            "status_code": random.choice([200, 200, 200, 201, 400, 404, 500]),
        })
    return logs

logs = generate_logs(100000)

# SLOW: Multiple passes, no caching, no builtins
def analyze_slow(logs):
    results = {}

    level_counts = {}
    for log in logs:
        level = log["level"]
        if level in level_counts:
            level_counts[level] += 1
        else:
            level_counts[level] = 1
    results["level_counts"] = level_counts

    error_counts = {}
    for log in logs:
        if log["level"] in ["ERROR", "CRITICAL"]:
            service = log["service"]
            if service in error_counts:
                error_counts[service] += 1
            else:
                error_counts[service] = 1
    results["error_counts"] = error_counts

    service_times = {}
    service_counts = {}
    for log in logs:
        service = log["service"]
        rt = log["response_time"]
        if service in service_times:
            service_times[service] += rt
            service_counts[service] += 1
        else:
            service_times[service] = rt
            service_counts[service] = 1
    results["avg_response_times"] = {}
    for service in service_times:
        results["avg_response_times"][service] = service_times[service] / service_counts[service]

    service_all_times = {}
    for log in logs:
        service = log["service"]
        if service not in service_all_times:
            service_all_times[service] = []
        service_all_times[service].append(log["response_time"])
    results["p95_response_times"] = {}
    for service, times in service_all_times.items():
        sorted_times = sorted(times)
        idx = int(len(sorted_times) * 0.95)
        results["p95_response_times"][service] = sorted_times[idx]

    total = len(logs)
    errors = sum(1 for log in logs if log["level"] in ["ERROR", "CRITICAL"])
    results["error_rate"] = errors / total

    slow_logs = []
    for log in logs:
        if log["response_time"] > 2.0:
            slow_logs.append({"service": log["service"],
                             "response_time": log["response_time"],
                             "status_code": log["status_code"]})
    results["slow_count"] = len(slow_logs)

    return results

# OPTIMIZED: Single pass + builtins + caching
def analyze_optimized(logs):
    # Pre-allocate data structures
    level_counts = Counter()
    error_counts = Counter()
    service_time_sums = defaultdict(float)
    service_time_counts = defaultdict(int)
    service_all_times = defaultdict(list)
    error_total = 0
    slow_count = 0

    # Set for O(1) membership testing
    _error_levels = frozenset({"ERROR", "CRITICAL"})

    # Local variable caching
    _error_levels_check = _error_levels.__contains__

    # SINGLE PASS over all logs
    for log in logs:
        level = log["level"]
        service = log["service"]
        rt = log["response_time"]

        # Level counting
        level_counts[level] += 1

        # Error tracking
        if _error_levels_check(level):
            error_counts[service] += 1
            error_total += 1

        # Response time tracking
        service_time_sums[service] += rt
        service_time_counts[service] += 1
        service_all_times[service].append(rt)

        # Slow endpoint counting
        if rt > 2.0:
            slow_count += 1

    # Compute derived metrics
    n = len(logs)

    avg_response_times = {
        service: service_time_sums[service] / service_time_counts[service]
        for service in service_time_sums
    }

    p95_response_times = {}
    for service, times in service_all_times.items():
        times.sort()  # In-place sort is faster than sorted()
        p95_response_times[service] = times[int(len(times) * 0.95)]

    return {
        "level_counts": dict(level_counts),
        "error_counts": dict(error_counts),
        "avg_response_times": avg_response_times,
        "p95_response_times": p95_response_times,
        "error_rate": error_total / n,
        "slow_count": slow_count,
    }

# MAXIMUM OPTIMIZATION: itemgetter + everything
def analyze_max(logs):
    _get_level = itemgetter("level")
    _get_service = itemgetter("service")
    _get_rt = itemgetter("response_time")
    _error_levels = frozenset({"ERROR", "CRITICAL"})

    level_counts = Counter(map(_get_level, logs))

    error_counts = Counter()
    service_time_sums = defaultdict(float)
    service_time_counts = defaultdict(int)
    service_all_times = defaultdict(list)
    error_total = 0
    slow_count = 0

    for log in logs:
        level = log["level"]
        service = log["service"]
        rt = log["response_time"]

        if level in _error_levels:
            error_counts[service] += 1
            error_total += 1

        service_time_sums[service] += rt
        service_time_counts[service] += 1
        service_all_times[service].append(rt)

        if rt > 2.0:
            slow_count += 1

    n = len(logs)

    avg_response_times = {
        s: service_time_sums[s] / service_time_counts[s]
        for s in service_time_sums
    }

    p95_response_times = {}
    for service, times in service_all_times.items():
        times.sort()
        p95_response_times[service] = times[int(len(times) * 0.95)]

    return {
        "level_counts": dict(level_counts),
        "error_counts": dict(error_counts),
        "avg_response_times": avg_response_times,
        "p95_response_times": p95_response_times,
        "error_rate": error_total / n,
        "slow_count": slow_count,
    }

# Benchmark
print("=== Log Analysis Pipeline ===")
for name, fn in [
    ("Slow (6 passes)", analyze_slow),
    ("Optimized (1 pass)", analyze_optimized),
    ("Max optimized", analyze_max),
]:
    t = timeit.timeit(lambda f=fn: f(logs), number=10)
    print(f"  {name:25s}: {t:.4f}s")

# Verify correctness
r_slow = analyze_slow(logs)
r_opt = analyze_optimized(logs)
r_max = analyze_max(logs)

assert r_slow["level_counts"] == r_opt["level_counts"] == r_max["level_counts"]
assert r_slow["error_counts"] == r_opt["error_counts"] == r_max["error_counts"]
assert abs(r_slow["error_rate"] - r_opt["error_rate"]) < 1e-10
assert r_slow["slow_count"] == r_opt["slow_count"] == r_max["slow_count"]

for service in r_slow["avg_response_times"]:
    assert abs(r_slow["avg_response_times"][service] -
               r_opt["avg_response_times"][service]) < 1e-10

print("\nAll results verified correct!")
```

**Expected speedup:** 2-4x from slow to optimized.

**Optimization checklist applied:**
- [x] Single pass (6 passes -> 1 pass)
- [x] `frozenset` for O(1) membership testing
- [x] `collections.Counter` for counting
- [x] `collections.defaultdict` for grouping
- [x] In-place `list.sort()` instead of `sorted()` (avoids copy)
- [x] Precomputed constants (`_error_levels`)
- [x] Local variable caching
- [x] Dict comprehension for derived metrics

</details>

---

## Summary: Optimization Techniques Reference

| Technique | When to Use | Expected Speedup |
|---|---|---|
| Local variable caching | Hot loops with global/attr lookups | 1.1-1.5x |
| Builtin over custom | Any equivalent builtin exists | 2-10x |
| `operator` module | Replacing lambdas for sorting/mapping | 1.2-2x |
| `functools.lru_cache` | Pure functions with repeated inputs | 10-100,000x |
| `map()` + builtins | Applying a C function to each item | 1.3-2x |
| Inlining functions | Hot inner loops | 1.5-2.5x |
| `__slots__` | Many instances of a class | 1.1-1.5x (+ memory) |
| `collections.Counter` | Counting occurrences | 1.5-3x |
| `frozenset` membership | `x in large_collection` | 100-1000x vs list |
| Single pass algorithms | Multiple passes over same data | 2-6x |
| List comprehensions | Building lists from loops | 1.2-1.5x |
| Tuple unpacking | Replacing attribute access | 1.5-3x |

### Golden Rules

1. **Measure first** — never optimize without benchmarks
2. **Profile** — find the actual bottleneck (`cProfile`, `timeit`)
3. **Algorithmic > Micro** — O(n) to O(log n) beats any micro-optimization
4. **Readability matters** — only optimize proven hot paths
5. **Test after** — verify optimized code produces identical results
