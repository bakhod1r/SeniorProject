# Loops — Optimization Exercises

> Optimize each slow loop pattern. Measure the improvement with `timeit`.

---

## Score Card

| # | Difficulty | Topic | Type | Optimized? | Speedup |
|---|:----------:|-------|:----:|:----------:|:-------:|
| 1 | Easy | List comprehension vs for loop | CPU | [ ] | ___x |
| 2 | Easy | enumerate vs range(len) | CPU | [ ] | ___x |
| 3 | Easy | join vs += for strings | CPU/Memory | [ ] | ___x |
| 4 | Medium | Generator vs list in loop | Memory | [ ] | ___x |
| 5 | Medium | map/filter vs loops | CPU | [ ] | ___x |
| 6 | Medium | Avoiding global lookups in loops | CPU | [ ] | ___x |
| 7 | Medium | itertools usage | CPU | [ ] | ___x |
| 8 | Hard | numpy vectorization vs loops | CPU | [ ] | ___x |
| 9 | Hard | multiprocessing for CPU-bound loops | CPU | [ ] | ___x |
| 10 | Hard | C extension via ctypes for hot loops | CPU | [ ] | ___x |

**Total optimized: ___ / 10**

---

## Exercise 1: List Comprehension vs For Loop

**Difficulty:** Easy

```python
import timeit

# SLOW: Building a list with a for loop and append
def squares_slow(n: int) -> list[int]:
    """Build a list of squares using a for loop."""
    result = []
    for i in range(n):
        result.append(i * i)
    return result


n = 500_000

slow_time = timeit.timeit(lambda: squares_slow(n), number=10)
print(f"Slow (for + append): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

List comprehensions are not just syntactic sugar — they compile to a dedicated `LIST_APPEND` bytecode that avoids the overhead of looking up and calling the `.append()` method on every iteration.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: List comprehension — single expression, optimized bytecode
def squares_fast(n: int) -> list[int]:
    """Build a list of squares using a list comprehension."""
    return [i * i for i in range(n)]


fast_time = timeit.timeit(lambda: squares_fast(n), number=10)
print(f"Fast (comprehension): {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.3-2x
```

**Why it's faster:** In a for loop, each iteration does `LOAD_ATTR` (look up `append`), `CALL_FUNCTION`, and `POP_TOP`. A list comprehension uses `LIST_APPEND`, a single bytecode instruction that directly appends to the list without any function call overhead. The comprehension also runs in its own scope, which CPython can optimize further.

</details>

<details>
<summary>Learn More</summary>

- Use `dis.dis(squares_slow)` and `dis.dis("[i*i for i in range(10)]")` to compare bytecode.
- List comprehensions also have a memory advantage: CPython pre-sizes the internal array when it can predict the length from `range()`.
- For side-effect-only loops (e.g., calling `print()`), do NOT use a comprehension — use a regular `for` loop. Comprehensions are for building data.
- Nested comprehensions are fine: `[x*y for x in rows for y in cols]` is faster than nested `for` + `append`.

</details>

---

## Exercise 2: enumerate vs range(len)

**Difficulty:** Easy

```python
import timeit

# SLOW: Using range(len()) to get both index and value
def index_values_slow(data: list[int]) -> list[tuple[int, int]]:
    """Pair each element with its index using range(len())."""
    result = []
    for i in range(len(data)):
        result.append((i, data[i]))  # data[i] is a separate subscript operation
    return result


data = list(range(500_000))

slow_time = timeit.timeit(lambda: index_values_slow(data), number=10)
print(f"Slow (range(len)): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

`enumerate()` is a built-in iterator implemented in C that yields `(index, value)` tuples directly, avoiding the cost of a separate `data[i]` subscript operation on each iteration. It also reads more clearly.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: enumerate yields (index, value) pairs natively
def index_values_fast(data: list[int]) -> list[tuple[int, int]]:
    """Pair each element with its index using enumerate()."""
    return [(i, v) for i, v in enumerate(data)]


fast_time = timeit.timeit(lambda: index_values_fast(data), number=10)
print(f"Fast (enumerate):  {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.3-1.8x
```

**Why it's faster:** `range(len(data))` + `data[i]` performs two operations per iteration: the range yields an index, then `data.__getitem__(i)` fetches the value (hash + bounds check). `enumerate()` is a single C-level iterator that yields both values at once with zero Python-level overhead per item.

</details>

<details>
<summary>Learn More</summary>

- `enumerate()` accepts a `start` parameter: `enumerate(data, start=1)` begins counting at 1.
- For dicts, use `dict.items()` instead of iterating over keys and looking up values.
- `zip()` is the counterpart when you need to iterate over two sequences in parallel — also implemented in C.
- The `range(len())` anti-pattern is the most common Python performance mistake in code reviews.

</details>

---

## Exercise 3: join vs += for String Concatenation

**Difficulty:** Easy

```python
import timeit

# SLOW: Building a string with += in a loop
def concat_slow(n: int) -> str:
    """Build a large string by concatenating with +=."""
    result = ""
    for i in range(n):
        result += f"item-{i},"  # Creates a new string object every iteration
    return result


n = 100_000

slow_time = timeit.timeit(lambda: concat_slow(n), number=5)
print(f"Slow (+=):   {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Strings in Python are immutable. Every `+=` creates a brand-new string, copies all existing characters plus the new part. This turns an O(n) task into O(n^2). Building a list and calling `str.join()` once at the end avoids all the copying.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Collect parts in a list, join once at the end
def concat_fast(n: int) -> str:
    """Build a large string using join()."""
    parts = [f"item-{i}" for i in range(n)]
    return ",".join(parts)


fast_time = timeit.timeit(lambda: concat_fast(n), number=5)
print(f"Fast (join): {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 2-10x (grows with n)
```

**Why it's faster:** `str.join()` first scans the list to compute the total length, allocates a single buffer of the exact size, then copies each piece once. The `+=` approach copies the entire accumulated string on every iteration, resulting in O(n^2) total character copies versus O(n) for `join()`. The difference grows dramatically with `n`.

</details>

<details>
<summary>Learn More</summary>

- CPython has a special optimization where `+=` on a string with refcount 1 can resize in-place. But this is an implementation detail, not guaranteed, and fails when other references exist.
- For file-like output, use `io.StringIO()` as a buffer — it behaves like `join()` internally.
- The `join()` pattern is also cleaner: `"\n".join(lines)` vs. a loop with `result += line + "\n"`.
- This same principle applies to bytes: use `b"".join(chunks)` instead of `result += chunk`.

</details>

---

## Exercise 4: Generator vs List in Loop

**Difficulty:** Medium

```python
import timeit
import sys

# SLOW: Building a full intermediate list just to iterate over it
def sum_of_squares_slow(n: int) -> int:
    """Sum of squares using an intermediate list."""
    squares = [i * i for i in range(n)]  # Allocates entire list in memory
    total = 0
    for s in squares:
        total += s
    return total


n = 2_000_000

slow_time = timeit.timeit(lambda: sum_of_squares_slow(n), number=5)

# Show memory difference
list_size = sys.getsizeof([i * i for i in range(n)])
print(f"List memory: {list_size / 1024 / 1024:.1f} MB")
print(f"Slow (list intermediate): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

If you only need to iterate once over the results, a generator expression `(x for x in ...)` produces items one at a time without storing the entire sequence in memory. For aggregation functions like `sum()`, passing a generator avoids the intermediate list entirely.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Generator expression — no intermediate list in memory
def sum_of_squares_fast(n: int) -> int:
    """Sum of squares using a generator expression with sum()."""
    return sum(i * i for i in range(n))  # Generator — O(1) memory


fast_time = timeit.timeit(lambda: sum_of_squares_fast(n), number=5)

gen_size = sys.getsizeof(i * i for i in range(n))
print(f"Generator memory: {gen_size} bytes")
print(f"Fast (generator + sum): {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.2-2x (plus massive memory savings)
```

**Why it's faster:** The list comprehension allocates a list of 2 million integers (~17 MB), then iterates over it again. The generator feeds items directly into `sum()` one at a time, using only ~120 bytes regardless of `n`. Less memory allocation = less GC pressure = faster execution. `sum()` is also implemented in C and runs faster than a Python `for` loop with `+=`.

</details>

<details>
<summary>Learn More</summary>

- Use generators when: you iterate once, the data is large, or you only need a subset (e.g., `any()`, `all()`, `min()`, `max()`).
- Use lists when: you need random access, you iterate multiple times, or you need `len()`.
- `itertools` functions (e.g., `chain`, `islice`) work with generators and maintain the lazy-evaluation benefit.
- Generator expressions can be chained: `sum(x for x in (i*i for i in range(n)) if x % 2 == 0)`.

</details>

---

## Exercise 5: map/filter vs Explicit Loops

**Difficulty:** Medium

```python
import timeit

# SLOW: Explicit loop with conditional append
def transform_filter_slow(data: list[int]) -> list[str]:
    """Convert even numbers to hex strings using a for loop."""
    result = []
    for x in data:
        if x % 2 == 0:
            result.append(hex(x))
    return result


data = list(range(1_000_000))

slow_time = timeit.timeit(lambda: transform_filter_slow(data), number=5)
print(f"Slow (for loop): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

`map()` and `filter()` are built-in functions implemented in C. They apply a function to each element (or filter elements) without the overhead of a Python-level loop, `if` statement, or `.append()` call. Combined, they can replace a loop+conditional+transform pattern.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: map + filter — C-level iteration
def transform_filter_fast(data: list[int]) -> list[str]:
    """Convert even numbers to hex strings using map + filter."""
    return list(map(hex, filter(lambda x: x % 2 == 0, data)))


# FASTEST: List comprehension — best of both worlds
def transform_filter_fastest(data: list[int]) -> list[str]:
    """Convert even numbers to hex strings using a list comprehension."""
    return [hex(x) for x in data if x % 2 == 0]


fast_time = timeit.timeit(lambda: transform_filter_fast(data), number=5)
fastest_time = timeit.timeit(lambda: transform_filter_fastest(data), number=5)
print(f"Fast (map+filter):     {fast_time:.4f}s (speedup: {slow_time/fast_time:.1f}x)")
print(f"Fastest (comprehension): {fastest_time:.4f}s (speedup: {slow_time/fastest_time:.1f}x)")
# Typical speedup: 1.1-1.5x (map/filter), 1.3-1.8x (comprehension)
```

**Why it's faster:** `map()` and `filter()` push the iteration into C, removing per-iteration Python bytecode overhead. However, the `lambda` in `filter()` adds a function call cost per element. The list comprehension avoids the lambda and uses `LIST_APPEND` bytecode, making it the fastest pure-Python option. Use `map()` when the transform function is already a built-in (like `hex`, `str`, `int`) — no lambda needed.

</details>

<details>
<summary>Learn More</summary>

- `map(func, iterable)` is fastest when `func` is a C built-in (`hex`, `str`, `len`, `int`).
- If `func` is a lambda, a list comprehension is usually equal or faster.
- `filter(None, iterable)` is a fast way to remove falsy values (0, None, "", [], etc.).
- `itertools.starmap(func, iterable_of_tuples)` is the multi-argument version of `map()`.
- In Python 3, `map()` and `filter()` return iterators — wrap with `list()` if you need a list.

</details>

---

## Exercise 6: Avoiding Global Lookups in Loops

**Difficulty:** Medium

```python
import timeit
import math

# SLOW: Global and attribute lookups on every iteration
def compute_distances_slow(coords: list[tuple[float, float]]) -> list[float]:
    """Compute Euclidean distance from origin for each point."""
    distances = []
    for x, y in coords:
        distances.append(math.sqrt(x * x + y * y))  # LOAD_GLOBAL + LOAD_ATTR per iteration
    return distances


coords = [(float(i), float(i + 1)) for i in range(300_000)]

slow_time = timeit.timeit(lambda: compute_distances_slow(coords), number=5)
print(f"Slow (global lookups): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Every `math.sqrt` inside the loop requires `LOAD_GLOBAL` (dictionary lookup for `math`) followed by `LOAD_ATTR` (dictionary lookup for `sqrt`). Similarly, `distances.append` requires `LOAD_FAST` + `LOAD_ATTR`. Caching both as local variables before the loop replaces all of these with simple `LOAD_FAST` (array index) operations.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Cache global/attribute lookups as local variables
def compute_distances_fast(coords: list[tuple[float, float]]) -> list[float]:
    """Compute distances with cached local lookups."""
    sqrt = math.sqrt       # Cache function as local
    result = []
    append = result.append  # Cache method as local
    for x, y in coords:
        append(sqrt(x * x + y * y))  # Two LOAD_FAST calls only
    return result


# FASTEST: Comprehension + local cache (comprehension scope is local too)
def compute_distances_fastest(coords: list[tuple[float, float]]) -> list[float]:
    sqrt = math.sqrt
    return [sqrt(x * x + y * y) for x, y in coords]


fast_time = timeit.timeit(lambda: compute_distances_fast(coords), number=5)
fastest_time = timeit.timeit(lambda: compute_distances_fastest(coords), number=5)
print(f"Fast (cached locals):     {fast_time:.4f}s (speedup: {slow_time/fast_time:.1f}x)")
print(f"Fastest (comprehension):  {fastest_time:.4f}s (speedup: {slow_time/fastest_time:.1f}x)")
# Typical speedup: 1.2-1.5x (cached), 1.3-1.8x (comprehension)
```

**Why it's faster:** In CPython, `LOAD_FAST` is an array index into the local variable table — O(1) with no hashing. `LOAD_GLOBAL` searches the local dict, then global dict, then builtins dict. `LOAD_ATTR` performs another dict lookup on the object. Over 300,000 iterations, eliminating two dict lookups per iteration saves significant time.

</details>

<details>
<summary>Learn More</summary>

- This technique is used throughout the Python standard library (e.g., `json/encoder.py`).
- The default-argument trick also works: `def f(coords, _sqrt=math.sqrt)` — the default is evaluated once at function definition time.
- List comprehensions automatically create a local scope, so `[math.sqrt(x) ...]` still does `LOAD_GLOBAL` for `math` each time. Cache it before the comprehension: `sqrt = math.sqrt; [sqrt(x) ...]`.
- Profile before optimizing: `python -m cProfile script.py` or `line_profiler` for line-by-line data.

</details>

---

## Exercise 7: itertools for Efficient Loop Patterns

**Difficulty:** Medium

```python
import timeit
from itertools import chain, product

# SLOW: Manual nested loop to flatten a list of lists
def flatten_slow(nested: list[list[int]]) -> list[int]:
    """Flatten a list of lists using nested for loops."""
    result = []
    for sublist in nested:
        for item in sublist:
            result.append(item)
    return result

# SLOW: Manual cartesian product with nested loops
def cartesian_slow(a: list[int], b: list[str], c: list[float]) -> list[tuple]:
    """Compute cartesian product of three lists."""
    result = []
    for x in a:
        for y in b:
            for z in c:
                result.append((x, y, z))
    return result


nested = [list(range(100)) for _ in range(5000)]  # 5000 sublists of 100 items
a = list(range(50))
b = [chr(65 + i) for i in range(26)]
c = [float(i) / 10 for i in range(20)]

slow_flat = timeit.timeit(lambda: flatten_slow(nested), number=5)
slow_cart = timeit.timeit(lambda: cartesian_slow(a, b, c), number=5)
print(f"Slow flatten:   {slow_flat:.4f}s")
print(f"Slow cartesian: {slow_cart:.4f}s")
```

<details>
<summary>Hint</summary>

`itertools.chain.from_iterable()` flattens an iterable of iterables in C, without any Python-level nested loop. `itertools.product()` computes the cartesian product of multiple iterables entirely in C, replacing deeply nested `for` loops.

</details>

<details>
<summary>Optimized Solution</summary>

```python
from itertools import chain, product

# FAST: chain.from_iterable — C-level flatten
def flatten_fast(nested: list[list[int]]) -> list[int]:
    """Flatten using itertools.chain.from_iterable."""
    return list(chain.from_iterable(nested))

# FAST: itertools.product — C-level cartesian product
def cartesian_fast(a: list[int], b: list[str], c: list[float]) -> list[tuple]:
    """Compute cartesian product using itertools.product."""
    return list(product(a, b, c))


fast_flat = timeit.timeit(lambda: flatten_fast(nested), number=5)
fast_cart = timeit.timeit(lambda: cartesian_fast(a, b, c), number=5)
print(f"Fast flatten:   {fast_flat:.4f}s (speedup: {slow_flat/fast_flat:.1f}x)")
print(f"Fast cartesian: {fast_cart:.4f}s (speedup: {slow_cart/fast_cart:.1f}x)")
# Typical speedup: 2-4x (flatten), 2-5x (cartesian)
```

**Why it's faster:** `chain.from_iterable()` is implemented entirely in C — it iterates over each sub-iterable and yields items one by one with zero Python-level overhead per item. The manual version pays for `LOAD_ATTR` (append), `CALL_FUNCTION`, and `POP_TOP` bytecodes on every single item. `product()` similarly avoids the overhead of N nested Python `for` loops and builds tuples in C.

</details>

<details>
<summary>Learn More</summary>

- Key `itertools` functions for loop optimization:
  - `chain.from_iterable()` — flatten nested iterables
  - `product()` — replace nested for loops
  - `groupby()` — replace manual grouping logic
  - `islice()` — slice an iterator without materializing it
  - `accumulate()` — running totals without a manual loop
  - `compress()` — filter by a selector iterable
- `itertools` functions return iterators, so wrap with `list()` only when you need a list.
- Combine with `operator` module for even more speed: `itertools.starmap(operator.mul, pairs)` is faster than a lambda.

</details>

---

## Exercise 8: NumPy Vectorization vs Python Loops

**Difficulty:** Hard

```python
import timeit

# SLOW: Pure Python loop for numerical computation
def moving_average_slow(data: list[float], window: int) -> list[float]:
    """Compute moving average using a Python loop."""
    result = []
    for i in range(len(data) - window + 1):
        total = 0.0
        for j in range(window):
            total += data[i + j]
        result.append(total / window)
    return result


data = [float(i) + 0.5 for i in range(100_000)]
window = 50

slow_time = timeit.timeit(lambda: moving_average_slow(data, window), number=3)
print(f"Slow (Python loop): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

NumPy performs operations on entire arrays at the C level using SIMD instructions, bypassing the Python interpreter loop entirely. For a moving average, `np.convolve` or `np.cumsum` can compute the result in one vectorized pass.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import numpy as np

# FAST: NumPy vectorized moving average using cumsum
def moving_average_fast(data_np: np.ndarray, window: int) -> np.ndarray:
    """Compute moving average using NumPy cumulative sum trick."""
    cumsum = np.cumsum(data_np)
    cumsum[window:] = cumsum[window:] - cumsum[:-window]
    return cumsum[window - 1:] / window


data_np = np.array(data)

fast_time = timeit.timeit(lambda: moving_average_fast(data_np, window), number=3)
print(f"Fast (NumPy cumsum): {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")

# Verify correctness
py_result = moving_average_slow(data[:1000], window)
np_result = moving_average_fast(np.array(data[:1000]), window).tolist()
assert all(abs(a - b) < 1e-10 for a, b in zip(py_result, np_result)), "Results mismatch!"
print("Correctness verified.")
# Typical speedup: 50-200x
```

**Why it's faster:** The Python loop executes ~5 million (100k x 50) individual addition operations, each requiring bytecode dispatch, type checking, and Python object creation. NumPy's `cumsum` performs the same math in a single C loop over a contiguous memory buffer using CPU SIMD instructions. The cumsum trick reduces the moving average from O(n*w) to O(n) — a huge algorithmic improvement on top of the constant-factor speedup from C-level execution.

</details>

<details>
<summary>Learn More</summary>

- Rule of thumb: if you are looping over numbers in Python, you should probably be using NumPy.
- Key vectorization patterns:
  - Replace `for` + `if` with boolean indexing: `arr[arr > 0]`
  - Replace nested loops with broadcasting: `a[:, None] + b[None, :]`
  - Replace accumulation loops with `np.cumsum`, `np.cumprod`, `np.diff`
- `np.vectorize()` is NOT true vectorization — it is a convenience wrapper that still loops in Python.
- For DataFrames, pandas uses NumPy under the hood. Avoid `.iterrows()` and use vectorized operations.
- If NumPy is not available, consider `array` module for typed arrays — faster than lists for numeric data.

</details>

---

## Exercise 9: multiprocessing for CPU-Bound Loops

**Difficulty:** Hard

```python
import timeit
import math

# SLOW: Single-threaded CPU-bound computation
def is_prime(n: int) -> bool:
    """Check if n is prime."""
    if n < 2:
        return False
    if n < 4:
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True

def count_primes_slow(numbers: list[int]) -> int:
    """Count primes in a list — single process."""
    return sum(1 for n in numbers if is_prime(n))


# Large numbers to make primality testing expensive
numbers = list(range(100_000, 200_000))

slow_time = timeit.timeit(lambda: count_primes_slow(numbers), number=3)
result_slow = count_primes_slow(numbers)
print(f"Slow (single process): {slow_time:.4f}s — found {result_slow} primes")
```

<details>
<summary>Hint</summary>

Python's GIL (Global Interpreter Lock) prevents threads from running Python bytecode in parallel. For CPU-bound work, `multiprocessing` spawns separate processes, each with its own GIL, allowing true parallel execution across CPU cores. `multiprocessing.Pool.map()` distributes chunks of work across a pool of worker processes.

</details>

<details>
<summary>Optimized Solution</summary>

```python
from multiprocessing import Pool, cpu_count

# FAST: Distribute work across multiple CPU cores
def count_primes_chunk(chunk: list[int]) -> int:
    """Count primes in a chunk — runs in a worker process."""
    return sum(1 for n in chunk if is_prime(n))

def count_primes_fast(numbers: list[int]) -> int:
    """Count primes using multiprocessing Pool."""
    n_workers = cpu_count()
    chunk_size = len(numbers) // n_workers
    chunks = [numbers[i:i + chunk_size] for i in range(0, len(numbers), chunk_size)]

    with Pool(n_workers) as pool:
        results = pool.map(count_primes_chunk, chunks)
    return sum(results)


fast_time = timeit.timeit(lambda: count_primes_fast(numbers), number=3)
result_fast = count_primes_fast(numbers)
assert result_fast == result_slow, f"Mismatch: {result_fast} != {result_slow}"
print(f"Fast ({cpu_count()} processes): {fast_time:.4f}s — found {result_fast} primes")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 2-8x depending on CPU core count
```

**Why it's faster:** Each worker process runs in its own interpreter with its own GIL, allowing true parallel execution of CPU-bound Python code. On an 8-core machine, the work is split into 8 chunks, each processed independently. The overhead is process creation and data serialization (pickle), so this is only beneficial when the per-chunk work is substantially larger than the overhead — as is the case with primality testing.

</details>

<details>
<summary>Learn More</summary>

- Use `multiprocessing.Pool` for data parallelism (same function, different data chunks).
- Use `concurrent.futures.ProcessPoolExecutor` for a higher-level API with `submit()` and `as_completed()`.
- `pool.imap_unordered()` is faster when order does not matter — it yields results as they complete.
- For shared state between processes, use `multiprocessing.Manager()` or `multiprocessing.shared_memory`.
- Python 3.13+ (free-threaded build) can run threads in parallel without the GIL — but multiprocessing remains the portable approach.
- Avoid multiprocessing for I/O-bound tasks — use `asyncio` or `threading` instead.
- The overhead of process creation means multiprocessing only helps when each task takes at least several milliseconds.

</details>

---

## Exercise 10: C Extension via ctypes for Hot Loops

**Difficulty:** Hard

```python
import timeit

# SLOW: Pure Python hot loop — sum of absolute differences
def sum_abs_diff_slow(a: list[float], b: list[float]) -> float:
    """Compute sum of absolute differences between two lists."""
    total = 0.0
    for i in range(len(a)):
        total += abs(a[i] - b[i])
    return total


import random
random.seed(42)
n = 1_000_000
a = [random.random() for _ in range(n)]
b = [random.random() for _ in range(n)]

slow_time = timeit.timeit(lambda: sum_abs_diff_slow(a, b), number=5)
print(f"Slow (Python loop): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

You can write a tiny C function, compile it into a shared library, and call it from Python using `ctypes`. The C function operates on raw memory buffers with no Python object overhead, making it orders of magnitude faster for numerical loops. Use `ctypes.CDLL` to load the library and define argument/return types.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import ctypes
import tempfile
import os
import subprocess
import array

# Step 1: Write a small C file
c_code = r"""
#include <math.h>

double sum_abs_diff(const double* a, const double* b, int n) {
    double total = 0.0;
    for (int i = 0; i < n; i++) {
        total += fabs(a[i] - b[i]);
    }
    return total;
}
"""

# Step 2: Compile the C code into a shared library
tmpdir = tempfile.mkdtemp()
c_path = os.path.join(tmpdir, "fast_math.c")
so_path = os.path.join(tmpdir, "fast_math.so")

with open(c_path, "w") as f:
    f.write(c_code)

subprocess.run(
    ["gcc", "-O2", "-shared", "-fPIC", "-o", so_path, c_path, "-lm"],
    check=True,
)

# Step 3: Load and call via ctypes
lib = ctypes.CDLL(so_path)
lib.sum_abs_diff.argtypes = [
    ctypes.POINTER(ctypes.c_double),
    ctypes.POINTER(ctypes.c_double),
    ctypes.c_int,
]
lib.sum_abs_diff.restype = ctypes.c_double

# Convert Python lists to C-compatible arrays
arr_a = (ctypes.c_double * n)(*a)
arr_b = (ctypes.c_double * n)(*b)

def sum_abs_diff_fast() -> float:
    return lib.sum_abs_diff(arr_a, arr_b, n)


fast_time = timeit.timeit(sum_abs_diff_fast, number=5)

# Verify correctness
py_result = sum_abs_diff_slow(a, b)
c_result = sum_abs_diff_fast()
assert abs(py_result - c_result) < 1e-6, f"Mismatch: {py_result} vs {c_result}"
print(f"Fast (C/ctypes): {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
print("Correctness verified.")
# Typical speedup: 30-100x

# Cleanup
os.remove(c_path)
os.remove(so_path)
os.rmdir(tmpdir)
```

**Why it's faster:** The Python loop executes 1 million iterations, each involving: bytecode dispatch, `LOAD_FAST`, `BINARY_SUBSCR` (with bounds checking), `BINARY_SUBTRACT` (creating a new float object), `abs()` (function call + type dispatch), and `BINARY_ADD`. The C version operates directly on contiguous `double` arrays in a single tight loop — no object creation, no type checking, no interpreter overhead. The compiler also applies SIMD vectorization with `-O2`.

</details>

<details>
<summary>Learn More</summary>

- `ctypes` is in the standard library — no external dependencies needed.
- For production code, consider these alternatives:
  - **Cython**: Write Python-like code that compiles to C. Easier than raw C.
  - **cffi**: A more Pythonic alternative to `ctypes` for calling C code.
  - **pybind11**: Best for calling C++ code from Python.
  - **Numba** (`@jit`): JIT-compiles Python functions to machine code using LLVM. Zero C code needed.
- When using `ctypes`, always set `.argtypes` and `.restype` — without them, ctypes assumes all arguments and return values are `int`, leading to crashes on 64-bit systems.
- Use `array.array('d', data)` to create C-compatible arrays without copying: `ctypes.c_double * n` copies, but `array` can share the buffer via `ctypes.cast`.
- NumPy arrays can be passed directly to ctypes: `a.ctypes.data_as(ctypes.POINTER(ctypes.c_double))`.

</details>

---

## Cheat Sheet

| Pattern | Slow | Fast | Type | Typical Gain |
|---------|------|------|:----:|:------------:|
| List building | `for` + `append()` | List comprehension | CPU | 1.3-2x |
| Index + value | `range(len(x))` + `x[i]` | `enumerate(x)` | CPU | 1.3-1.8x |
| String concat | `result += s` in loop | `"".join(parts)` | CPU/Mem | 2-10x |
| Intermediate data | `[x for x in ...]` then loop | Generator `(x for x in ...)` | Memory | 1.2-2x |
| Transform + filter | `for` + `if` + `append` | `map()`/`filter()` or comprehension | CPU | 1.3-1.8x |
| Global lookups | `math.sqrt` in loop | `sqrt = math.sqrt` before loop | CPU | 1.2-1.5x |
| Nested loops | Manual nested `for` | `itertools.product`, `chain` | CPU | 2-5x |
| Numeric loops | Python `for` over numbers | NumPy vectorization | CPU | 50-200x |
| CPU-bound parallel | Single-process loop | `multiprocessing.Pool.map()` | CPU | 2-8x |
| Hot inner loop | Pure Python arithmetic | C function via `ctypes` | CPU | 30-100x |
