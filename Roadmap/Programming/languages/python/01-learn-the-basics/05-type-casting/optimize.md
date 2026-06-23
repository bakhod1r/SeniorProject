# Type Casting -- Optimization Exercises

> Optimize each slow type casting pattern. Measure the improvement with `timeit`.

---

## Score Card

| # | Difficulty | Topic | Type | Optimized? | Speedup |
|---|:----------:|-------|:----:|:----------:|:-------:|
| 1 | Easy | f-string vs str() concatenation | CPU | [ ] | ___x |
| 2 | Easy | map(int) vs comprehension | CPU | [ ] | ___x |
| 3 | Easy | set() for deduplication | CPU | [ ] | ___x |
| 4 | Medium | Avoid repeated int() on same values | CPU | [ ] | ___x |
| 5 | Medium | Local variable lookup for built-ins | CPU | [ ] | ___x |
| 6 | Medium | Batch struct.pack vs individual | CPU/Memory | [ ] | ___x |
| 7 | Medium | Pre-validated vs try/except casting | CPU | [ ] | ___x |
| 8 | Hard | NumPy vectorized conversion | CPU | [ ] | ___x |
| 9 | Hard | array.array vs list for homogeneous data | Memory | [ ] | ___x |
| 10 | Hard | Multiprocessing for bulk casting | CPU | [ ] | ___x |

**Total optimized: ___ / 10**

---

## Exercise 1: f-string vs str() Concatenation

**Difficulty:** Easy

```python
import timeit

# SLOW: String concatenation with str()
def format_message_slow(name: str, age: int, score: float) -> str:
    """Build a message using str() concatenation."""
    return "Name: " + str(name) + ", Age: " + str(age) + ", Score: " + str(score)


name, age, score = "Alice", 30, 95.5

slow_time = timeit.timeit(lambda: format_message_slow(name, age, score), number=1_000_000)
print(f"Slow (str + concat): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

f-strings are compiled to a single `FORMAT_VALUE` + `BUILD_STRING` bytecode sequence, avoiding multiple `LOAD_GLOBAL` + `CALL` instructions for each `str()` call.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

name, age, score = "Alice", 30, 95.5

# SLOW
def format_slow(name, age, score):
    return "Name: " + str(name) + ", Age: " + str(age) + ", Score: " + str(score)

# FAST: f-string
def format_fast(name, age, score):
    return f"Name: {name}, Age: {age}, Score: {score}"

slow_time = timeit.timeit(lambda: format_slow(name, age, score), number=1_000_000)
fast_time = timeit.timeit(lambda: format_fast(name, age, score), number=1_000_000)

print(f"Slow (concat): {slow_time:.4f}s")
print(f"Fast (f-str):  {fast_time:.4f}s")
print(f"Speedup:       {slow_time / fast_time:.1f}x")
# Typical speedup: 2-3x
```

**Why it's faster:** The `str() + concatenation` approach performs 3 global lookups (`str`), 3 function calls, and 5 string concatenations (each creating a new string object). The f-string approach uses `FORMAT_VALUE` bytecode instructions that directly call `tp_str` on each object and `BUILD_STRING` to combine them in a single allocation.

</details>

---

## Exercise 2: map(int) vs List Comprehension

**Difficulty:** Easy

```python
import timeit

# SLOW: List comprehension with int()
def convert_slow(data: list[str]) -> list[int]:
    """Convert strings to ints using list comprehension."""
    return [int(x) for x in data]


data = [str(i) for i in range(200_000)]

slow_time = timeit.timeit(lambda: convert_slow(data), number=20)
print(f"Slow (comprehension): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

`map()` is implemented in C and avoids the Python-level loop overhead (no `FOR_ITER`, `STORE_FAST`, `LIST_APPEND` bytecodes).

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

data = [str(i) for i in range(200_000)]

# SLOW
def convert_slow(data):
    return [int(x) for x in data]

# FAST: map() is a C-level loop
def convert_fast(data):
    return list(map(int, data))

slow_time = timeit.timeit(lambda: convert_slow(data), number=20)
fast_time = timeit.timeit(lambda: convert_fast(data), number=20)

print(f"Slow (comprehension): {slow_time:.4f}s")
print(f"Fast (map):           {fast_time:.4f}s")
print(f"Speedup:              {slow_time / fast_time:.1f}x")
# Typical speedup: 1.1-1.3x
```

**Why it's faster:** `map()` iterates in C, avoiding the overhead of Python bytecode dispatch (`FOR_ITER`, `STORE_FAST`, `LOAD_FAST`, `LIST_APPEND`). For simple one-argument conversions like `int()`, the C-level loop in `map()` is more efficient.

</details>

---

## Exercise 3: set() for Deduplication vs Manual Loop

**Difficulty:** Easy

```python
import timeit

# SLOW: Manual deduplication with type casting
def dedupe_slow(items: list[str]) -> list[int]:
    """Convert and deduplicate using a manual loop."""
    result = []
    for item in items:
        value = int(item)
        if value not in result:  # O(n) lookup in list!
            result.append(value)
    return result


data = [str(i % 1000) for i in range(50_000)]

slow_time = timeit.timeit(lambda: dedupe_slow(data), number=5)
print(f"Slow (manual): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

`value not in result` is O(n) for a list but O(1) for a set. Convert to set first, then to list.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

data = [str(i % 1000) for i in range(50_000)]

# SLOW: O(n^2) due to list membership check
def dedupe_slow(items):
    result = []
    for item in items:
        value = int(item)
        if value not in result:
            result.append(value)
    return result

# FAST: O(n) using set for deduplication
def dedupe_fast(items):
    return list(set(map(int, items)))

# FAST + sorted (if order matters)
def dedupe_fast_sorted(items):
    return sorted(set(map(int, items)))

slow_time = timeit.timeit(lambda: dedupe_slow(data), number=5)
fast_time = timeit.timeit(lambda: dedupe_fast(data), number=5)

print(f"Slow (manual O(n^2)): {slow_time:.4f}s")
print(f"Fast (set O(n)):      {fast_time:.4f}s")
print(f"Speedup:              {slow_time / fast_time:.1f}x")
# Typical speedup: 50-200x for large datasets
```

**Why it's faster:** `list.__contains__` is O(n) -- it scans the entire list. `set.__contains__` is O(1) average -- it uses a hash table. For 50K items with 1K unique values, the list approach does ~25 million comparisons vs ~50K hash lookups.

</details>

---

## Exercise 4: Caching Repeated Conversions

**Difficulty:** Medium

```python
import timeit

# SLOW: Converting the same strings repeatedly
def process_log_slow(log_entries: list[dict]) -> list[dict]:
    """Process log entries, converting repeated status codes."""
    results = []
    for entry in log_entries:
        results.append({
            "status": int(entry["status"]),
            "method": str(entry["method"]).upper(),
            "time_ms": float(entry["time"]),
        })
    return results


# Simulate log data with many repeated values
import random
log_data = [
    {"status": random.choice(["200", "301", "404", "500"]),
     "method": random.choice(["get", "post", "put"]),
     "time": str(random.uniform(0.1, 500.0))}
    for _ in range(100_000)
]

slow_time = timeit.timeit(lambda: process_log_slow(log_data), number=5)
print(f"Slow (no cache): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

There are only 4 unique status codes and 3 unique methods. Cache the conversions in a dictionary.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
import random

log_data = [
    {"status": random.choice(["200", "301", "404", "500"]),
     "method": random.choice(["get", "post", "put"]),
     "time": str(random.uniform(0.1, 500.0))}
    for _ in range(100_000)
]

# SLOW
def process_slow(log_data):
    results = []
    for entry in log_data:
        results.append({
            "status": int(entry["status"]),
            "method": str(entry["method"]).upper(),
            "time_ms": float(entry["time"]),
        })
    return results

# FAST: Pre-cache repeated conversions
def process_fast(log_data):
    status_cache = {}
    method_cache = {}
    results = []

    for entry in log_data:
        # Cache status conversion
        s = entry["status"]
        if s not in status_cache:
            status_cache[s] = int(s)

        # Cache method conversion
        m = entry["method"]
        if m not in method_cache:
            method_cache[m] = m.upper()

        results.append({
            "status": status_cache[s],
            "method": method_cache[m],
            "time_ms": float(entry["time"]),  # Unique values, no point caching
        })
    return results

slow_time = timeit.timeit(lambda: process_slow(log_data), number=5)
fast_time = timeit.timeit(lambda: process_fast(log_data), number=5)

print(f"Slow (no cache): {slow_time:.4f}s")
print(f"Fast (cached):   {fast_time:.4f}s")
print(f"Speedup:         {slow_time / fast_time:.1f}x")
# Typical speedup: 1.2-1.5x
```

**Why it's faster:** `int("200")` is called 100K times but there are only 4 unique values. With caching, `int()` is called only 4 times and the rest are O(1) dictionary lookups. The speedup depends on the ratio of unique to total values.

</details>

---

## Exercise 5: Local Variable Lookup for Built-ins

**Difficulty:** Medium

```python
import timeit

# SLOW: Global lookup for int() on every iteration
def convert_global(data: list[str]) -> list[int]:
    """Convert using global int() lookup."""
    result = []
    for x in data:
        result.append(int(x))
    return result


data = [str(i) for i in range(200_000)]

slow_time = timeit.timeit(lambda: convert_global(data), number=10)
print(f"Slow (global lookup): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Each `int(x)` in the loop does a `LOAD_GLOBAL` bytecode instruction. Assign `int` to a local variable before the loop to use `LOAD_FAST` instead.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

data = [str(i) for i in range(200_000)]

# SLOW: LOAD_GLOBAL for int + LOAD_ATTR for append
def convert_global(data):
    result = []
    for x in data:
        result.append(int(x))
    return result

# FAST: Local references use LOAD_FAST (faster than LOAD_GLOBAL)
def convert_local(data):
    _int = int            # LOAD_FAST instead of LOAD_GLOBAL
    result = []
    _append = result.append  # LOAD_FAST instead of LOAD_ATTR
    for x in data:
        _append(_int(x))
    return result

slow_time = timeit.timeit(lambda: convert_global(data), number=10)
fast_time = timeit.timeit(lambda: convert_local(data), number=10)

print(f"Slow (global):  {slow_time:.4f}s")
print(f"Fast (local):   {fast_time:.4f}s")
print(f"Speedup:        {slow_time / fast_time:.1f}x")
# Typical speedup: 1.1-1.3x
```

**Why it's faster:** `LOAD_GLOBAL` searches the global dict, then the builtin dict. `LOAD_FAST` accesses a C-level array by index -- it is a simple pointer dereference. Similarly, `result.append` does `LOAD_FAST` + `LOAD_ATTR` on every iteration, while `_append` is just `LOAD_FAST`.

</details>

---

## Exercise 6: Batch struct.pack vs Individual

**Difficulty:** Medium

```python
import timeit
import struct

# SLOW: Individual struct.pack calls
def pack_slow(data: list[int]) -> list[bytes]:
    """Pack each integer individually."""
    return [struct.pack('i', x) for x in data]


data = list(range(100_000))

slow_time = timeit.timeit(lambda: pack_slow(data), number=20)
print(f"Slow (individual pack): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Use a single `struct.pack()` call with a format string like `'100000i'` to pack all values at once.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
import struct

data = list(range(100_000))

# SLOW: N individual pack calls
def pack_slow(data):
    return [struct.pack('i', x) for x in data]

# FAST: Single pack call with batch format
def pack_fast(data):
    return struct.pack(f'{len(data)}i', *data)

# FASTER: Use array.array for zero-copy buffer
def pack_fastest(data):
    import array
    arr = array.array('i', data)
    return arr.tobytes()

slow_time = timeit.timeit(lambda: pack_slow(data), number=20)
fast_time = timeit.timeit(lambda: pack_fast(data), number=20)
fastest_time = timeit.timeit(lambda: pack_fastest(data), number=20)

print(f"Slow (individual):  {slow_time:.4f}s")
print(f"Fast (batch pack):  {fast_time:.4f}s")
print(f"Fastest (array):    {fastest_time:.4f}s")
print(f"Speedup (batch):    {slow_time / fast_time:.1f}x")
print(f"Speedup (array):    {slow_time / fastest_time:.1f}x")
# Typical: batch 5-10x, array 10-30x
```

**Why it's faster:** Individual `struct.pack('i', x)` creates a new `bytes` object for each call (100K allocations). Batch `struct.pack('100000i', *data)` creates a single `bytes` object. `array.array.tobytes()` is even faster because `array` already stores data as C integers, so `tobytes()` is essentially a `memcpy`.

</details>

---

## Exercise 7: Pre-validated vs Try/Except Casting

**Difficulty:** Medium

```python
import timeit

# SLOW (for valid data): try/except on every item
def cast_try_except(data: list[str]) -> list[int]:
    """Cast with try/except on every item."""
    result = []
    for item in data:
        try:
            result.append(int(item))
        except ValueError:
            result.append(0)
    return result


# Mostly valid data (99% valid)
import random
data = [str(i) if random.random() < 0.99 else "bad" for i in range(100_000)]

slow_time = timeit.timeit(lambda: cast_try_except(data), number=10)
print(f"try/except: {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

When data is mostly valid, <code>try/except</code> is fine. But when data has many errors, the exception overhead becomes significant. Pre-validation with <code>.isdigit()</code> or <code>.lstrip('-').isdigit()</code> avoids exception creation.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
import random

# Mostly valid data (99% valid)
data_valid = [str(i) if random.random() < 0.99 else "bad" for i in range(100_000)]

# Mostly INVALID data (only 1% valid)
data_invalid = ["bad" if random.random() < 0.99 else str(i) for i in range(100_000)]

def cast_try(data):
    result = []
    for item in data:
        try:
            result.append(int(item))
        except ValueError:
            result.append(0)
    return result

def cast_precheck(data):
    result = []
    for item in data:
        # Handle negative numbers too
        if item.lstrip('-').isdigit():
            result.append(int(item))
        else:
            result.append(0)
    return result

# Test with mostly VALID data
t1 = timeit.timeit(lambda: cast_try(data_valid), number=10)
t2 = timeit.timeit(lambda: cast_precheck(data_valid), number=10)
print("=== Mostly valid data (99% valid) ===")
print(f"try/except:   {t1:.4f}s")
print(f"pre-check:    {t2:.4f}s")
print(f"Winner:       {'try/except' if t1 < t2 else 'pre-check'}")

# Test with mostly INVALID data
t3 = timeit.timeit(lambda: cast_try(data_invalid), number=10)
t4 = timeit.timeit(lambda: cast_precheck(data_invalid), number=10)
print("\n=== Mostly invalid data (99% invalid) ===")
print(f"try/except:   {t3:.4f}s")
print(f"pre-check:    {t4:.4f}s")
print(f"Speedup:      {t3 / t4:.1f}x")
# pre-check is much faster when exceptions are frequent
```

**Why it matters:** Creating an exception object is expensive (it captures the traceback). When 99% of items raise `ValueError`, `try/except` creates 99K exception objects. Pre-checking with `isdigit()` avoids all exception overhead. For mostly-valid data, `try/except` is slightly faster (no pre-check overhead on the happy path).

</details>

---

## Exercise 8: NumPy Vectorized Conversion

**Difficulty:** Hard

```python
import timeit

# SLOW: Pure Python conversion
def convert_python(data: list[str]) -> list[float]:
    """Convert strings to floats using pure Python."""
    return [float(x) for x in data]


data = [str(i * 0.1) for i in range(500_000)]

slow_time = timeit.timeit(lambda: convert_python(data), number=10)
print(f"Slow (Python): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

NumPy's `np.array(data, dtype=np.float64)` uses optimized C code for bulk string-to-float conversion and stores results in a contiguous memory block.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
import sys

data = [str(i * 0.1) for i in range(500_000)]

# SLOW: Pure Python
def convert_python(data):
    return [float(x) for x in data]

# FAST: NumPy vectorized
try:
    import numpy as np

    def convert_numpy(data):
        return np.array(data, dtype=np.float64)

    slow_time = timeit.timeit(lambda: convert_python(data), number=10)
    fast_time = timeit.timeit(lambda: convert_numpy(data), number=10)

    print(f"Python list comp: {slow_time:.4f}s")
    print(f"NumPy:            {fast_time:.4f}s")
    print(f"Speedup:          {slow_time / fast_time:.1f}x")

    # Memory comparison
    py_result = convert_python(data)
    np_result = convert_numpy(data)
    py_mem = sys.getsizeof(py_result) + len(py_result) * sys.getsizeof(1.0)
    np_mem = np_result.nbytes + sys.getsizeof(np_result)
    print(f"\nPython memory: {py_mem:>12,} bytes")
    print(f"NumPy memory:  {np_mem:>12,} bytes")
    print(f"Memory saving: {py_mem / np_mem:.1f}x")
except ImportError:
    print("NumPy not installed. Run: pip install numpy")
```

**Why it's faster:** NumPy parses strings in optimized C code and stores floats in a contiguous C array (8 bytes per float). Python's `list[float]` stores pointers (8 bytes each) to individual `float` objects (24 bytes each). NumPy is typically 2-5x faster and uses ~5x less memory.

</details>

---

## Exercise 9: array.array vs list for Homogeneous Data

**Difficulty:** Hard

```python
import timeit
import sys

# SLOW: Store converted integers in a regular list
def store_in_list(data: list[str]) -> list:
    """Convert and store in a Python list."""
    return [int(x) for x in data]


data = [str(i) for i in range(500_000)]

slow_time = timeit.timeit(lambda: store_in_list(data), number=10)
print(f"List storage: {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

<code>array.array('l', ...)</code> stores raw C longs without Python object overhead. Good for storage, but conversion is still needed.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
import sys
import array

data = [str(i) for i in range(500_000)]

# Approach 1: Python list
def to_list(data):
    return [int(x) for x in data]

# Approach 2: array.array (must convert to list first, then to array)
def to_array(data):
    return array.array('l', map(int, data))

# Approach 3: array.array from pre-existing list
def to_array_from_list(int_list):
    return array.array('l', int_list)

slow_time = timeit.timeit(lambda: to_list(data), number=10)
fast_time = timeit.timeit(lambda: to_array(data), number=10)

print(f"Python list:   {slow_time:.4f}s")
print(f"array.array:   {fast_time:.4f}s")

# Memory comparison
list_result = to_list(data)
array_result = to_array(data)

list_mem = sys.getsizeof(list_result)
array_mem = sys.getsizeof(array_result)

# For list, also count the int objects themselves
sample_int_size = sys.getsizeof(list_result[0])
total_list_mem = list_mem + len(list_result) * sample_int_size

print(f"\nlist memory (container):    {list_mem:>12,} bytes")
print(f"list memory (total w/objs): {total_list_mem:>12,} bytes")
print(f"array.array memory:         {array_mem:>12,} bytes")
print(f"Memory reduction:           {total_list_mem / array_mem:.1f}x")
# Typical: 4-8x memory reduction
```

**Why it's better:** `list` stores pointers to individual `int` objects. Each `int` is a `PyLongObject` (28+ bytes). `array.array('l', ...)` stores raw 8-byte C `long` values contiguously -- no per-element object overhead. For 500K integers: list uses ~18MB, array uses ~4MB.

</details>

---

## Exercise 10: Multiprocessing for Bulk Casting

**Difficulty:** Hard

```python
import timeit

# SLOW: Single-process bulk casting
def cast_single(data: list[str]) -> list[int]:
    """Convert strings to ints in a single process."""
    return list(map(int, data))


data = [str(i) for i in range(2_000_000)]

slow_time = timeit.timeit(lambda: cast_single(data), number=3)
print(f"Single process: {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

The GIL prevents threading from helping. Use <code>multiprocessing.Pool.map()</code> to distribute work across CPU cores. Be aware of serialization overhead for inter-process communication.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
import multiprocessing as mp
import os

data = [str(i) for i in range(2_000_000)]

def cast_chunk(chunk: list[str]) -> list[int]:
    """Convert a chunk of strings to ints."""
    return list(map(int, chunk))

def cast_single(data):
    return list(map(int, data))

def cast_multiprocess(data, num_workers=None):
    if num_workers is None:
        num_workers = os.cpu_count() or 4

    # Split data into chunks
    chunk_size = len(data) // num_workers
    chunks = [data[i:i + chunk_size] for i in range(0, len(data), chunk_size)]

    with mp.Pool(num_workers) as pool:
        results = pool.map(cast_chunk, chunks)

    # Flatten results
    return [item for sublist in results for item in sublist]


if __name__ == "__main__":
    # Single process
    t1 = timeit.timeit(lambda: cast_single(data), number=3)
    print(f"Single process:     {t1:.4f}s")

    # Multiprocess
    t2 = timeit.timeit(lambda: cast_multiprocess(data), number=3)
    print(f"Multi process ({os.cpu_count()} cores): {t2:.4f}s")
    print(f"Speedup:            {t1 / t2:.1f}x")

    # Note: For small datasets, multiprocessing is SLOWER due to
    # serialization overhead (pickling data between processes).
    # Break-even point is typically around 100K-500K items.
    print(f"\nBreak-even analysis:")
    for size in [10_000, 50_000, 100_000, 500_000, 1_000_000]:
        small_data = data[:size]
        ts = timeit.timeit(lambda: cast_single(small_data), number=5)
        tm = timeit.timeit(lambda: cast_multiprocess(small_data, 4), number=5)
        winner = "MP" if tm < ts else "SP"
        print(f"  n={size:>10,}: single={ts:.3f}s, multi={tm:.3f}s -> {winner}")
```

**Why it works:** The GIL prevents `threading` from parallelizing CPU-bound type casting. `multiprocessing` creates separate Python processes, each with its own GIL. The data is split into chunks, each process converts its chunk, and results are combined. Overhead comes from pickling data between processes, so this only pays off for large datasets (100K+ items).

</details>

<details>
<summary>Learn More</summary>

- For I/O-bound casting (e.g., reading from files + casting), `threading` or `asyncio` can help because I/O releases the GIL.
- `concurrent.futures.ProcessPoolExecutor` is a higher-level alternative to `multiprocessing.Pool`.
- For the best performance, use NumPy which releases the GIL during array operations and avoids pickling overhead entirely.

</details>
