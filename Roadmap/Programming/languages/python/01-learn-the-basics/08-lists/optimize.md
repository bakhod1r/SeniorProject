# Python Lists — Optimization Exercises

> Optimize each slow list pattern. Measure the improvement with `timeit`.

---

## Score Card

| # | Difficulty | Topic | Type | Optimized? | Speedup |
|---|:----------:|-------|:----:|:----------:|:-------:|
| 1 | Easy | List comprehension vs loop + append | CPU | [ ] | ___x |
| 2 | Easy | Pre-allocation vs dynamic growth | Memory/CPU | [ ] | ___x |
| 3 | Easy | `in` on list vs set | CPU | [ ] | ___x |
| 4 | Medium | deque vs list for queue operations | CPU | [ ] | ___x |
| 5 | Medium | bisect for sorted insertion | CPU | [ ] | ___x |
| 6 | Medium | array module vs list for typed data | Memory | [ ] | ___x |
| 7 | Medium | Avoiding repeated list concatenation | CPU/Memory | [ ] | ___x |
| 8 | Hard | numpy vs list for numeric operations | CPU | [ ] | ___x |
| 9 | Hard | Slot-based filtering vs list rebuilds | CPU | [ ] | ___x |
| 10 | Hard | memoryview vs list slicing for large data | Memory/CPU | [ ] | ___x |

**Total optimized: ___ / 10**

---

## Exercise 1: List Comprehension vs Loop + Append

**Difficulty:** Easy

```python
import timeit

# SLOW: Building a filtered list with a for loop and append
def filter_evens_slow(data: list[int]) -> list[int]:
    """Return only even numbers from the list."""
    result = []
    for x in data:
        if x % 2 == 0:
            result.append(x)
    return result


data = list(range(1_000_000))

slow_time = timeit.timeit(lambda: filter_evens_slow(data), number=10)
print(f"Slow (loop + append): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

List comprehensions compile to optimized bytecode that uses `LIST_APPEND` directly, skipping the overhead of looking up and calling `.append()` as a method on each iteration.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: List comprehension with condition
def filter_evens_fast(data: list[int]) -> list[int]:
    """Return only even numbers from the list."""
    return [x for x in data if x % 2 == 0]


fast_time = timeit.timeit(lambda: filter_evens_fast(data), number=10)
print(f"Fast (comprehension):  {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.3-2x
```

**Why it's faster:** Each iteration of the slow version does `LOAD_ATTR` (look up `append`), `CALL_FUNCTION`, and `POP_TOP`. The comprehension uses a single `LIST_APPEND` bytecode instruction with no function call overhead. Use `dis.dis()` to compare:

```python
import dis
dis.dis(filter_evens_slow)
dis.dis("[x for x in data if x % 2 == 0]")
```

</details>

---

## Exercise 2: Pre-allocation vs Dynamic Growth

**Difficulty:** Easy

```python
import timeit

# SLOW: Let the list grow dynamically with repeated appends
def build_squares_slow(n: int) -> list[int]:
    """Build a list of n squared values."""
    result = []
    for i in range(n):
        result.append(i * i)
    return result


n = 1_000_000

slow_time = timeit.timeit(lambda: build_squares_slow(n), number=10)
print(f"Slow (dynamic growth): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

When a list grows beyond its current allocation, CPython must allocate a larger array and copy all elements. Pre-allocating with <code>[None] * n</code> avoids all resize-and-copy operations.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Pre-allocate the list, then fill by index
def build_squares_fast(n: int) -> list[int]:
    """Build a list of n squared values with pre-allocation."""
    result = [0] * n  # pre-allocate
    for i in range(n):
        result[i] = i * i
    return result

# FASTEST: List comprehension (combines pre-allocation + fill)
def build_squares_fastest(n: int) -> list[int]:
    """Build a list of n squared values with comprehension."""
    return [i * i for i in range(n)]


fast_time = timeit.timeit(lambda: build_squares_fast(n), number=10)
fastest_time = timeit.timeit(lambda: build_squares_fastest(n), number=10)
print(f"Fast (pre-allocate):   {fast_time:.4f}s  Speedup: {slow_time / fast_time:.1f}x")
print(f"Fastest (comprehension): {fastest_time:.4f}s  Speedup: {slow_time / fastest_time:.1f}x")
# Pre-allocate typical speedup: 1.2-1.5x
# Comprehension typical speedup: 1.5-2.5x
```

**Why it's faster:** CPython lists use an over-allocation strategy (growth factor ~1.125), but for large lists, the repeated realloc + memcpy adds up. Pre-allocation eliminates all resizing. The list comprehension goes further by using optimized C-level loops.

```python
import sys
# Compare memory: dynamic list may over-allocate
dynamic = []
for i in range(1000):
    dynamic.append(i)
prealloc = list(range(1000))
print(f"Dynamic:     {sys.getsizeof(dynamic)} bytes")
print(f"Pre-alloc:   {sys.getsizeof(prealloc)} bytes")
```

</details>

---

## Exercise 3: `in` on List vs Set

**Difficulty:** Easy

```python
import timeit

# SLOW: Checking membership in a list (O(n) per lookup)
def count_common_slow(list_a: list[int], list_b: list[int]) -> int:
    """Count how many elements of list_a appear in list_b."""
    count = 0
    for item in list_a:
        if item in list_b:  # O(n) linear scan each time
            count += 1
    return count


list_a = list(range(10_000))
list_b = list(range(5_000, 15_000))

slow_time = timeit.timeit(lambda: count_common_slow(list_a, list_b), number=3)
print(f"Slow (in list): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

<code>x in list</code> is O(n) because it scans every element. <code>x in set</code> is O(1) because sets use hash tables. Convert <code>list_b</code> to a set before the loop.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Convert to set for O(1) lookups
def count_common_fast(list_a: list[int], list_b: list[int]) -> int:
    """Count how many elements of list_a appear in list_b."""
    set_b = set(list_b)  # O(n) one-time cost
    count = 0
    for item in list_a:
        if item in set_b:  # O(1) hash lookup
            count += 1
    return count

# FASTEST: Use set intersection
def count_common_fastest(list_a: list[int], list_b: list[int]) -> int:
    """Count common elements using set intersection."""
    return len(set(list_a) & set(list_b))


fast_time = timeit.timeit(lambda: count_common_fast(list_a, list_b), number=3)
fastest_time = timeit.timeit(lambda: count_common_fastest(list_a, list_b), number=3)
print(f"Fast (in set):           {fast_time:.4f}s  Speedup: {slow_time / fast_time:.1f}x")
print(f"Fastest (intersection):  {fastest_time:.4f}s  Speedup: {slow_time / fastest_time:.1f}x")
# Typical speedup: 100-1000x for large lists
```

**Why it's faster:** The slow version is O(n*m) — for each of 10,000 items in `list_a`, it scans up to 10,000 items in `list_b`. The fast version is O(n+m) — O(m) to build the set, then O(1) per lookup. The set intersection is even faster because it runs entirely in C.

</details>

---

## Exercise 4: deque vs List for Queue Operations

**Difficulty:** Medium

```python
import timeit

# SLOW: Using a list as a queue (pop from front)
def process_queue_slow(n: int) -> int:
    """Simulate a queue: enqueue n items, then dequeue all."""
    queue = []
    for i in range(n):
        queue.append(i)          # enqueue: O(1) amortized
    total = 0
    while queue:
        total += queue.pop(0)    # dequeue: O(n) — shifts all elements!
    return total


n = 50_000

slow_time = timeit.timeit(lambda: process_queue_slow(n), number=5)
print(f"Slow (list.pop(0)): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

<code>list.pop(0)</code> is O(n) because it must shift every remaining element one position to the left. <code>collections.deque</code> is implemented as a doubly-linked list of blocks, making <code>popleft()</code> O(1).

</details>

<details>
<summary>Optimized Solution</summary>

```python
from collections import deque

# FAST: Using deque for O(1) popleft
def process_queue_fast(n: int) -> int:
    """Simulate a queue with deque: enqueue n items, then dequeue all."""
    queue = deque()
    for i in range(n):
        queue.append(i)          # enqueue: O(1)
    total = 0
    while queue:
        total += queue.popleft()  # dequeue: O(1)
    return total


fast_time = timeit.timeit(lambda: process_queue_fast(n), number=5)
print(f"Fast (deque.popleft): {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 10-100x depending on n
```

**Why it's faster:** A `list` is backed by a contiguous C array. Removing from the front requires shifting all elements: O(n) per pop, making the full drain O(n^2). `collections.deque` uses a doubly-linked list of fixed-size blocks, so `popleft()` is O(1) — just advance a pointer. Total drain is O(n).

| Operation | list | deque |
|-----------|------|-------|
| `append(x)` | O(1) amortized | O(1) |
| `pop()` (from end) | O(1) | O(1) |
| `pop(0)` / `popleft()` | O(n) | O(1) |
| `insert(0, x)` / `appendleft(x)` | O(n) | O(1) |
| `x[i]` random access | O(1) | O(n) |

</details>

---

## Exercise 5: bisect for Sorted Insertion

**Difficulty:** Medium

```python
import timeit

# SLOW: Maintaining a sorted list by sorting after each insert
def build_sorted_slow(data: list[int]) -> list[int]:
    """Build a sorted list by inserting elements one at a time."""
    sorted_list = []
    for item in data:
        sorted_list.append(item)
        sorted_list.sort()  # O(n log n) after EVERY insert!
    return sorted_list


import random
random.seed(42)
data = [random.randint(0, 1_000_000) for _ in range(20_000)]

slow_time = timeit.timeit(lambda: build_sorted_slow(data), number=3)
print(f"Slow (sort after each insert): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

<code>bisect.insort()</code> uses binary search to find the correct position (O(log n)) and then inserts at that position (O(n) for the shift, but with fast C-level memcpy). It avoids the O(n log n) full sort on every insertion.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import bisect

# FAST: Use bisect.insort for O(n) insert into sorted position
def build_sorted_fast(data: list[int]) -> list[int]:
    """Build a sorted list using bisect for each insertion."""
    sorted_list = []
    for item in data:
        bisect.insort(sorted_list, item)  # binary search + insert
    return sorted_list

# FASTEST: Just sort once at the end
def build_sorted_fastest(data: list[int]) -> list[int]:
    """Sort the entire list at once."""
    return sorted(data)


fast_time = timeit.timeit(lambda: build_sorted_fast(data), number=3)
fastest_time = timeit.timeit(lambda: build_sorted_fastest(data), number=3)
print(f"Fast (bisect.insort):  {fast_time:.4f}s  Speedup: {slow_time / fast_time:.1f}x")
print(f"Fastest (sorted once): {fastest_time:.4f}s  Speedup: {slow_time / fastest_time:.1f}x")
# bisect typical speedup: 5-20x
# sorted() typical speedup: 100-1000x
```

**Why it's faster:**
- **Slow:** O(n^2 log n) total — calls `sort()` (O(n log n)) after each of n insertions.
- **bisect.insort:** O(n^2) total — binary search is O(log n), but the insert/shift is O(n). Still much faster because `memcpy` in C is fast.
- **sorted() once:** O(n log n) total — Timsort is highly optimized.

**When to use bisect:** When you need the list to stay sorted after **each** insert (e.g., streaming data, priority queues). If you can batch all data first, just sort once.

```python
# Useful bisect functions:
import bisect
a = [1, 3, 5, 7, 9]
print(bisect.bisect_left(a, 5))   # 2 — index where 5 would go (left of existing)
print(bisect.bisect_right(a, 5))  # 3 — index where 5 would go (right of existing)
bisect.insort(a, 6)               # a = [1, 3, 5, 6, 7, 9]
```

</details>

---

## Exercise 6: array Module vs List for Typed Data

**Difficulty:** Medium

```python
import timeit
import sys

# SLOW: Using a list of floats (each element is a full Python object)
def sum_floats_list(n: int) -> float:
    """Sum n float values stored in a regular list."""
    data = [float(i) for i in range(n)]
    return sum(data)


n = 1_000_000

slow_time = timeit.timeit(lambda: sum_floats_list(n), number=5)
data_list = [float(i) for i in range(n)]
list_size = sys.getsizeof(data_list) + sum(sys.getsizeof(x) for x in data_list[:100]) / 100 * n
print(f"Slow (list of floats): {slow_time:.4f}s")
print(f"List memory estimate:  {list_size / 1024 / 1024:.1f} MB")
```

<details>
<summary>Hint</summary>

The <code>array</code> module stores values as compact C-level types (8 bytes per <code>double</code>) instead of full Python float objects (~28 bytes each). This reduces memory and improves cache locality.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import array
import sys

# FAST: Using array.array for compact typed storage
def sum_floats_array(n: int) -> float:
    """Sum n float values stored in an array.array."""
    data = array.array('d', (float(i) for i in range(n)))  # 'd' = C double
    return sum(data)


fast_time = timeit.timeit(lambda: sum_floats_array(n), number=5)
data_arr = array.array('d', (float(i) for i in range(n)))
arr_size = sys.getsizeof(data_arr)
print(f"Fast (array.array):    {fast_time:.4f}s  Speedup: {slow_time / fast_time:.1f}x")
print(f"Array memory:          {arr_size / 1024 / 1024:.1f} MB")
print(f"Memory savings:        {(1 - arr_size / list_size) * 100:.0f}%")
# Typical memory savings: 60-80%
```

**Why it's faster:**

| Feature | `list` | `array.array` |
|---------|--------|---------------|
| Element storage | Pointer to Python object | Raw C value |
| Per-element cost | ~28 bytes (float obj) + 8 bytes (pointer) | 8 bytes (double) |
| 1M floats | ~34 MB | ~8 MB |
| Cache friendly | No (scattered objects) | Yes (contiguous) |

**Common type codes:**

```python
import array
array.array('b', ...)   # signed char (1 byte)
array.array('i', ...)   # signed int (2-4 bytes)
array.array('l', ...)   # signed long (4-8 bytes)
array.array('f', ...)   # float (4 bytes)
array.array('d', ...)   # double (8 bytes)
```

**When to use:** File I/O, network protocols, or any scenario where you have large homogeneous numeric data but do not want the numpy dependency.

</details>

---

## Exercise 7: Avoiding Repeated List Concatenation

**Difficulty:** Medium

```python
import timeit

# SLOW: Building a list by repeated concatenation
def build_by_concat_slow(n: int) -> list[int]:
    """Build a list by concatenating one element at a time."""
    result = []
    for i in range(n):
        result = result + [i]  # Creates a NEW list each time!
    return result


n = 50_000

slow_time = timeit.timeit(lambda: build_by_concat_slow(n), number=3)
print(f"Slow (result = result + [i]): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

<code>result = result + [i]</code> creates a brand new list and copies all existing elements on every iteration: O(n) per step, O(n^2) total. Compare with <code>result += [i]</code> which uses <code>__iadd__</code> (in-place extend) and <code>result.append(i)</code>.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST Option 1: Use append
def build_by_append(n: int) -> list[int]:
    """Build a list with append — O(1) amortized per operation."""
    result = []
    for i in range(n):
        result.append(i)
    return result

# FAST Option 2: Use += (in-place extend, NOT the same as +)
def build_by_iadd(n: int) -> list[int]:
    """Build a list with += which calls __iadd__ (extend in-place)."""
    result = []
    for i in range(n):
        result += [i]  # This is result.__iadd__([i]), modifies in-place
    return result

# FASTEST: List comprehension
def build_by_comprehension(n: int) -> list[int]:
    """Build a list with comprehension."""
    return [i for i in range(n)]


append_time = timeit.timeit(lambda: build_by_append(n), number=3)
iadd_time = timeit.timeit(lambda: build_by_iadd(n), number=3)
comp_time = timeit.timeit(lambda: build_by_comprehension(n), number=3)

print(f"Fast (append):         {append_time:.4f}s  Speedup: {slow_time / append_time:.1f}x")
print(f"Fast (+=):             {iadd_time:.4f}s  Speedup: {slow_time / iadd_time:.1f}x")
print(f"Fastest (comprehension): {comp_time:.4f}s  Speedup: {slow_time / comp_time:.1f}x")
# + creates new list: O(n^2) total
# append: O(n) total
# Typical speedup: 50-500x for n=50000
```

**Critical difference:**

```python
a = [1, 2, 3]
b = a

a = a + [4]    # Creates NEW list. b is still [1, 2, 3]. id(a) changed.
# vs
a += [4]       # Calls a.__iadd__([4]) — extends IN-PLACE. b is also [1,2,3,4]. id(a) unchanged.
# vs
a.append(4)    # Extends in-place. Same as +=  for single items.
```

</details>

---

## Exercise 8: numpy vs List for Numeric Operations

**Difficulty:** Hard

```python
import timeit

# SLOW: Element-wise operations with Python lists
def vector_operations_slow(n: int) -> list[float]:
    """Multiply two vectors element-wise, then sum with a third."""
    a = [float(i) for i in range(n)]
    b = [float(i * 2) for i in range(n)]
    c = [float(i * 3) for i in range(n)]

    # result = a * b + c (element-wise)
    result = []
    for i in range(n):
        result.append(a[i] * b[i] + c[i])
    return result


n = 1_000_000

slow_time = timeit.timeit(lambda: vector_operations_slow(n), number=3)
print(f"Slow (Python lists): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

<code>numpy</code> performs element-wise operations in compiled C/Fortran code on contiguous memory. A single <code>a * b + c</code> expression replaces the entire Python loop, eliminating per-element Python overhead.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import numpy as np

# FAST: numpy vectorized operations
def vector_operations_fast(n: int) -> np.ndarray:
    """Multiply two vectors element-wise, then sum with a third (numpy)."""
    a = np.arange(n, dtype=np.float64)
    b = np.arange(n, dtype=np.float64) * 2
    c = np.arange(n, dtype=np.float64) * 3

    result = a * b + c  # Vectorized: runs in C, no Python loop
    return result


fast_time = timeit.timeit(lambda: vector_operations_fast(n), number=3)
print(f"Fast (numpy):        {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 20-100x
```

**Why it's faster:**

| Aspect | Python list loop | numpy vectorized |
|--------|-----------------|------------------|
| Per-element overhead | Python bytecode dispatch | None (C loop) |
| Memory layout | Scattered Python objects | Contiguous C array |
| CPU optimization | No SIMD | Uses SIMD (SSE/AVX) |
| Operation fusion | 2 separate passes | Fused in one pass |

**Memory comparison:**

```python
import sys
import numpy as np

py_list = [float(i) for i in range(1_000_000)]
np_array = np.arange(1_000_000, dtype=np.float64)

print(f"Python list: {sys.getsizeof(py_list) / 1024 / 1024:.1f} MB (pointers only)")
print(f"numpy array: {np_array.nbytes / 1024 / 1024:.1f} MB (actual data)")
# Python list: ~8 MB pointers + ~28 MB float objects = ~36 MB
# numpy array: ~8 MB total
```

**When NOT to use numpy:** Small lists (< 100 elements) where setup overhead dominates, or when elements are heterogeneous types.

</details>

---

## Exercise 9: Slot-Based Filtering vs List Rebuilds

**Difficulty:** Hard

```python
import timeit

# SLOW: Repeatedly rebuilding a list with filter conditions
def multi_filter_slow(data: list[int]) -> list[int]:
    """Apply multiple filter conditions sequentially (rebuilds list each time)."""
    # Filter 1: Keep only positives
    result = []
    for x in data:
        if x > 0:
            result.append(x)

    # Filter 2: Keep only evens
    temp = []
    for x in result:
        if x % 2 == 0:
            temp.append(x)
    result = temp

    # Filter 3: Keep only values < 500000
    temp = []
    for x in result:
        if x < 500_000:
            temp.append(x)
    result = temp

    # Filter 4: Keep only values not divisible by 3
    temp = []
    for x in result:
        if x % 3 != 0:
            temp.append(x)
    result = temp

    return result


import random
random.seed(42)
data = [random.randint(-100_000, 1_000_000) for _ in range(1_000_000)]

slow_time = timeit.timeit(lambda: multi_filter_slow(data), number=5)
print(f"Slow (sequential rebuilds): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Each filter pass creates a new intermediate list. Combine all conditions into a single pass, or use a generator pipeline to avoid materializing intermediate lists.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST Option 1: Single-pass with combined condition
def multi_filter_fast(data: list[int]) -> list[int]:
    """Apply all filter conditions in a single list comprehension."""
    return [
        x for x in data
        if x > 0 and x % 2 == 0 and x < 500_000 and x % 3 != 0
    ]

# FAST Option 2: Generator pipeline (memory-efficient for huge data)
def multi_filter_generator(data: list[int]) -> list[int]:
    """Apply filters via chained generators — no intermediate lists."""
    step1 = (x for x in data if x > 0)
    step2 = (x for x in step1 if x % 2 == 0)
    step3 = (x for x in step2 if x < 500_000)
    step4 = (x for x in step3 if x % 3 != 0)
    return list(step4)  # Single materialization at the end


fast_time = timeit.timeit(lambda: multi_filter_fast(data), number=5)
gen_time = timeit.timeit(lambda: multi_filter_generator(data), number=5)
print(f"Fast (single comprehension): {fast_time:.4f}s  Speedup: {slow_time / fast_time:.1f}x")
print(f"Fast (generator pipeline):   {gen_time:.4f}s  Speedup: {slow_time / gen_time:.1f}x")
# Typical speedup: 2-4x
```

**Why it's faster:**

| Approach | Intermediate lists | Passes over data | Memory |
|----------|:-----------------:|:----------------:|:------:|
| Sequential rebuilds | 4 | 4 | 4x |
| Single comprehension | 0 | 1 | 1x |
| Generator pipeline | 0 | 1 (lazy) | ~0 (streaming) |

The single-pass comprehension wins on speed. The generator pipeline wins on memory for datasets that do not fit in RAM. Both avoid creating throwaway intermediate lists.

**Benchmark memory usage:**

```python
import tracemalloc

tracemalloc.start()
result_slow = multi_filter_slow(data)
slow_mem = tracemalloc.get_traced_memory()[1]
tracemalloc.stop()

tracemalloc.start()
result_fast = multi_filter_fast(data)
fast_mem = tracemalloc.get_traced_memory()[1]
tracemalloc.stop()

print(f"Slow peak memory: {slow_mem / 1024 / 1024:.1f} MB")
print(f"Fast peak memory: {fast_mem / 1024 / 1024:.1f} MB")
```

</details>

---

## Exercise 10: memoryview vs List Slicing for Large Data

**Difficulty:** Hard

```python
import timeit

# SLOW: Repeatedly slicing a large list (copies data each time)
def process_chunks_slow(data: list[int], chunk_size: int) -> int:
    """Process data in chunks by slicing — each slice copies elements."""
    total = 0
    for start in range(0, len(data), chunk_size):
        chunk = data[start:start + chunk_size]  # Creates a NEW list copy
        total += sum(chunk)
    return total


data = list(range(2_000_000))
chunk_size = 1000

slow_time = timeit.timeit(lambda: process_chunks_slow(data, chunk_size), number=5)
print(f"Slow (list slicing): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Each <code>data[start:end]</code> slice creates a new list and copies all elements in that range. <code>memoryview</code> creates a zero-copy view over a buffer (like <code>bytearray</code> or <code>array.array</code>), so slicing is O(1) regardless of chunk size.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import array as arr

# FAST: Use array + memoryview for zero-copy slicing
def process_chunks_fast(data_array: arr.array, chunk_size: int) -> int:
    """Process data in chunks using memoryview — zero-copy slicing."""
    mv = memoryview(data_array)
    total = 0
    for start in range(0, len(data_array), chunk_size):
        chunk = mv[start:start + chunk_size]  # Zero-copy: O(1) slice
        total += sum(chunk)
    return total


# Convert to array.array for memoryview support
data_array = arr.array('l', range(2_000_000))

fast_time = timeit.timeit(lambda: process_chunks_fast(data_array, chunk_size), number=5)
print(f"Fast (memoryview):   {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.5-3x (more if chunks are large)
```

**Why it's faster:**

| Operation | `list[start:end]` | `memoryview[start:end]` |
|-----------|:-----------------:|:----------------------:|
| Time complexity | O(k) where k = chunk size | O(1) |
| Memory | Allocates new list + copies k elements | No allocation (view only) |
| Supports | Any sequence | Buffer protocol objects |

**When to use memoryview:**
- Processing large binary data in chunks (file I/O, network packets)
- Image processing (pixel buffer manipulation)
- Any scenario with repeated slicing of large contiguous data

**Limitations:**
- Only works with objects that support the buffer protocol: `bytes`, `bytearray`, `array.array`, `numpy.ndarray`
- Does NOT work with regular Python `list` (lists store pointers, not contiguous data)
- For pure Python lists, use index-based iteration instead of slicing:

```python
# Alternative for regular lists: iterate by index (no copies)
def process_chunks_index(data: list[int], chunk_size: int) -> int:
    """Process chunks by index range — no slice copies."""
    total = 0
    for start in range(0, len(data), chunk_size):
        end = min(start + chunk_size, len(data))
        chunk_sum = 0
        for i in range(start, end):
            chunk_sum += data[i]
        total += chunk_sum
    return total
```

</details>

---

## Summary: When to Use What

| Scenario | Slow Pattern | Fast Pattern | Module |
|----------|-------------|-------------|--------|
| Build a filtered list | `for` + `append` + `if` | List comprehension | built-in |
| Build a known-size list | `append` in loop | `[0]*n` + index assign | built-in |
| Membership testing | `x in list` | `x in set` | built-in |
| Queue (FIFO) | `list.pop(0)` | `deque.popleft()` | `collections` |
| Sorted insertion | `append` + `sort()` | `bisect.insort()` | `bisect` |
| Large numeric arrays | `list` of `float` | `array.array('d', ...)` | `array` |
| List building | `result = result + [x]` | `result.append(x)` | built-in |
| Vector math | Python loop | `numpy` vectorized | `numpy` |
| Multi-condition filter | Sequential list rebuilds | Single comprehension | built-in |
| Chunk processing | `data[start:end]` slice | `memoryview` slice | built-in |

---

## Profiling Checklist

Before optimizing, always measure first:

```python
# 1. timeit — micro-benchmarks
import timeit
timeit.timeit(lambda: your_function(), number=100)

# 2. cProfile — find bottleneck functions
import cProfile
cProfile.run('your_function()')

# 3. tracemalloc — memory profiling
import tracemalloc
tracemalloc.start()
your_function()
snapshot = tracemalloc.take_snapshot()
for stat in snapshot.statistics('lineno')[:10]:
    print(stat)

# 4. sys.getsizeof — object size
import sys
print(sys.getsizeof(your_list))

# 5. memory_profiler (pip install memory-profiler)
# @profile decorator on functions, run with: python -m memory_profiler script.py
```
