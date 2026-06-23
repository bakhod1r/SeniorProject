# Python Loops — Interview Questions

---

## Junior Level (5-7 Questions)

### Q1: What is the difference between `for` and `while` loops in Python?

<details>
<summary>Answer</summary>

A `for` loop iterates over a known sequence (list, string, range, etc.) — you know what you're iterating over. A `while` loop repeats as long as a condition is `True` — you don't necessarily know how many iterations will occur.

```python
# for — iterates over items
for fruit in ["apple", "banana"]:
    print(fruit)

# while — repeats until condition fails
count = 0
while count < 3:
    print(count)
    count += 1
```

**Key difference:** `for` handles iteration automatically via the iterator protocol. `while` requires manual state management (you update the condition variable yourself).
</details>

---

### Q2: What do `break` and `continue` do?

<details>
<summary>Answer</summary>

- `break` — immediately exits the **innermost** loop entirely
- `continue` — skips the rest of the current iteration and moves to the **next** iteration

```python
for i in range(10):
    if i == 3:
        continue  # skip 3
    if i == 7:
        break     # stop at 7
    print(i)
# Output: 0, 1, 2, 4, 5, 6
```

Important: In nested loops, `break` and `continue` only affect the innermost loop.
</details>

---

### Q3: What does `range(1, 10, 2)` produce?

<details>
<summary>Answer</summary>

It produces the sequence `1, 3, 5, 7, 9`.

- `start=1` — begins at 1
- `stop=10` — goes up to but **not including** 10
- `step=2` — increments by 2

```python
print(list(range(1, 10, 2)))  # [1, 3, 5, 7, 9]
```

The stop value is always **exclusive**.
</details>

---

### Q4: What is the `else` clause on a loop?

<details>
<summary>Answer</summary>

The `else` block of a `for` or `while` loop executes **only if the loop completed normally** — i.e., without hitting a `break`.

```python
# else runs because no break was triggered
for n in [2, 4, 6]:
    if n % 2 != 0:
        break
else:
    print("All even!")  # This prints

# else does NOT run because break was triggered
for n in [2, 3, 6]:
    if n % 2 != 0:
        break
else:
    print("All even!")  # This does NOT print
```

A helpful mental model: think of `else` as "no-break".
</details>

---

### Q5: How do `enumerate()` and `zip()` work?

<details>
<summary>Answer</summary>

`enumerate(iterable, start=0)` wraps an iterable and yields `(index, value)` tuples:

```python
for i, color in enumerate(["red", "green", "blue"], start=1):
    print(i, color)
# 1 red, 2 green, 3 blue
```

`zip(iter1, iter2, ...)` pairs elements from multiple iterables. It stops at the shortest:

```python
names = ["Alice", "Bob"]
ages = [25, 30, 35]
for name, age in zip(names, ages):
    print(name, age)
# Alice 25, Bob 30  — "35" is dropped
```

Use `itertools.zip_longest()` to include all elements with a fill value.
</details>

---

### Q6: What is wrong with this code?

```python
numbers = [1, 2, 3, 4, 5]
for n in numbers:
    if n % 2 == 0:
        numbers.remove(n)
print(numbers)
```

<details>
<summary>Answer</summary>

**Problem:** Modifying a list while iterating over it causes skipped elements. When you remove an element, the list shrinks and the iterator's index advances past the next element.

**Expected:** `[1, 3, 5]`
**Actual result:** `[1, 3, 5]` may appear correct by luck, but `4` is actually skipped in the check. If the list were `[2, 4, 6, 8]`, you'd get `[4, 8]` — clearly wrong.

**Fix — use a list comprehension:**
```python
numbers = [n for n in numbers if n % 2 != 0]
```

**Or iterate over a copy:**
```python
for n in numbers[:]:
    if n % 2 == 0:
        numbers.remove(n)
```
</details>

---

### Q7: What is a list comprehension and when should you use it?

<details>
<summary>Answer</summary>

A list comprehension is a concise syntax for creating a new list by transforming or filtering elements:

```python
# Syntax: [expression for item in iterable if condition]
squares = [x ** 2 for x in range(10) if x % 2 == 0]
# [0, 4, 16, 36, 64]
```

**Use when:**
- Simple transformation or filtering
- Result needs to be a list

**Don't use when:**
- Logic requires multiple statements, side effects, or error handling
- The comprehension would be hard to read (nested, complex conditions)
- You don't need the full list in memory (use a generator expression instead)
</details>

---

## Middle Level (4-6 Questions)

### Q1: Explain the iterator protocol in Python.

<details>
<summary>Answer</summary>

The iterator protocol consists of two methods:

1. `__iter__()` — returns the iterator object itself
2. `__next__()` — returns the next value, or raises `StopIteration` when exhausted

Every `for` loop uses this protocol under the hood:

```python
# This:
for x in [1, 2, 3]:
    print(x)

# Is equivalent to:
it = iter([1, 2, 3])  # calls __iter__()
while True:
    try:
        x = next(it)  # calls __next__()
        print(x)
    except StopIteration:
        break
```

An **iterable** is any object with `__iter__()` (lists, strings, dicts, files).
An **iterator** is an object with both `__iter__()` and `__next__()`.

Key distinction: iterables can create multiple iterators. An iterator can only be consumed once.
</details>

---

### Q2: What is the difference between a generator and a list comprehension? When would you use each?

<details>
<summary>Answer</summary>

| Aspect | List Comprehension | Generator Expression |
|--------|-------------------|---------------------|
| Syntax | `[x for x in ...]` | `(x for x in ...)` |
| Memory | O(n) — stores all values | O(1) — one value at a time |
| Reusable | Yes — iterate multiple times | No — exhausted after one pass |
| Speed | Slightly faster for small data | Better for large/infinite data |

```python
# List comprehension — all values in memory
squares = [x**2 for x in range(1_000_000)]  # ~8 MB

# Generator — lazy, one at a time
squares = (x**2 for x in range(1_000_000))  # ~200 bytes
```

**Use list comprehension when:**
- You need random access, `len()`, or multiple iterations
- Data fits comfortably in memory

**Use generator when:**
- Data is very large or infinite
- You only need a single pass
- Used as argument to `sum()`, `max()`, `min()`, `any()`, `all()`
</details>

---

### Q3: What is "late binding" in closures, and how does it affect loops?

<details>
<summary>Answer</summary>

Python closures capture **variables**, not **values**. The variable is looked up at **call time**, not at definition time.

```python
# Bug: all functions return 4
funcs = [lambda: i for i in range(5)]
print([f() for f in funcs])  # [4, 4, 4, 4, 4]

# Why: all lambdas share the same variable 'i'
# When called, 'i' is 4 (the last value from the loop)
```

**Fix 1 — default argument capture:**
```python
funcs = [lambda i=i: i for i in range(5)]
print([f() for f in funcs])  # [0, 1, 2, 3, 4]
```

**Fix 2 — `functools.partial`:**
```python
from functools import partial
funcs = [partial(lambda i: i, i) for i in range(5)]
```

This is one of the most commonly tested Python gotchas in interviews.
</details>

---

### Q4: Compare `itertools.chain()`, `itertools.product()`, and `itertools.groupby()`.

<details>
<summary>Answer</summary>

**`chain(*iterables)`** — concatenates iterables sequentially:
```python
import itertools
list(itertools.chain([1, 2], [3, 4]))  # [1, 2, 3, 4]
```

**`product(*iterables)`** — cartesian product (replaces nested loops):
```python
list(itertools.product("AB", [1, 2]))
# [('A', 1), ('A', 2), ('B', 1), ('B', 2)]
```

**`groupby(iterable, key)`** — groups consecutive elements with the same key:
```python
data = [("A", 1), ("A", 2), ("B", 3)]
for key, group in itertools.groupby(data, key=lambda x: x[0]):
    print(key, list(group))
# A [('A', 1), ('A', 2)]
# B [('B', 3)]
```

**Important:** `groupby` only groups **consecutive** elements. Data must be sorted by key first if you want all groups.
</details>

---

### Q5: How do you optimize a loop that checks membership in a large list?

<details>
<summary>Answer</summary>

Convert the list to a `set` before the loop:

```python
# ❌ O(n * m) — list lookup is O(m) per check
large_list = list(range(100_000))
for item in data:
    if item in large_list:  # O(m) each time
        process(item)

# ✅ O(n + m) — set lookup is O(1) per check
large_set = set(large_list)  # O(m) one-time conversion
for item in data:
    if item in large_set:   # O(1) each time
        process(item)
```

This is one of the most impactful optimizations you can make. For 100K items checked against 100K items:
- List: ~10 billion comparisons
- Set: ~200K operations
</details>

---

### Q6: What is the walrus operator and how is it used in loops?

<details>
<summary>Answer</summary>

The walrus operator `:=` (PEP 572, Python 3.8+) assigns a value as part of an expression:

```python
# Without walrus — duplicated call
line = input(">> ")
while line != "quit":
    process(line)
    line = input(">> ")

# With walrus — DRY
while (line := input(">> ")) != "quit":
    process(line)

# In list comprehension — filter + use match
import re
results = [
    m.group()
    for text in texts
    if (m := re.search(r"\d+", text))
]
```

**Use when:** The assignment is naturally part of the condition. **Avoid** in complex expressions where it hurts readability.
</details>

---

## Senior Level (4-6 Questions)

### Q1: Explain how `FOR_ITER` works at the bytecode level.

<details>
<summary>Answer</summary>

The `FOR_ITER` opcode:
1. Pops the top of stack (the iterator)
2. Calls `tp_iternext` (C-level slot) on the iterator
3. If a value is returned, pushes it onto the stack and continues
4. If `NULL` is returned (StopIteration), jumps to `END_FOR`

In Python 3.11+, `FOR_ITER` can be **specialized**:
- `FOR_ITER_RANGE` — optimized for `range()` objects, uses C integer arithmetic directly
- `FOR_ITER_LIST` — optimized for lists, accesses the internal C array directly
- `FOR_ITER_TUPLE` — optimized for tuples

The specialized versions avoid the generic `tp_iternext` function pointer call, making them 20-40% faster for their specific types.

```python
import dis
def f():
    for i in range(10):
        pass
dis.dis(f)  # Shows FOR_ITER (or FOR_ITER_RANGE after warmup)
```
</details>

---

### Q2: Design a generator pipeline for processing a 100GB log file. What are the memory and performance considerations?

<details>
<summary>Answer</summary>

```python
from typing import Generator, Iterable
import gzip
import json
import re

def read_lines(path: str) -> Generator[str, None, None]:
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", buffering=8192) as f:
        yield from f  # yields one line at a time

def parse_json_lines(lines: Iterable[str]) -> Generator[dict, None, None]:
    for line in lines:
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue

def filter_errors(records: Iterable[dict]) -> Generator[dict, None, None]:
    for record in records:
        if record.get("level") == "ERROR":
            yield record

def extract_fields(records: Iterable[dict]) -> Generator[dict, None, None]:
    for record in records:
        yield {
            "timestamp": record["ts"],
            "message": record["msg"],
            "service": record.get("service", "unknown"),
        }

# Pipeline — O(1) memory regardless of file size
pipeline = extract_fields(filter_errors(parse_json_lines(read_lines("app.log.gz"))))
for record in pipeline:
    write_to_output(record)
```

**Memory considerations:**
- Each stage holds only one item at a time — total memory is O(1)
- File I/O is buffered (8KB default), not loaded entirely
- `gzip.open` decompresses on-the-fly

**Performance considerations:**
- Single-threaded: I/O-bound, limited by disk read speed
- To parallelize: use `multiprocessing` to process chunks, or `aiofiles` for async I/O
- Avoid `itertools.tee()` on this pipeline — it would buffer items in memory
</details>

---

### Q3: Why is `sum(range(n))` faster than `sum(i for i in range(n))`?

<details>
<summary>Answer</summary>

Two reasons:

1. **`range` is a C type** — `sum()` can iterate over it using the optimized `tp_iternext` slot of `PyRangeObject`, which generates integers using C arithmetic and avoids Python frame creation.

2. **Generator overhead** — `(i for i in range(n))` creates a `PyGenObject` with its own suspended frame. Each `next()` call:
   - Resumes the generator frame
   - Executes `FOR_ITER` on the range
   - `YIELD_VALUE` suspends the frame again
   - This adds ~3-5 opcodes per item

Even better: `sum(range(n))` in CPython has a fast path that recognizes `range` and can use C-level accumulation.

```python
import timeit
n = 10_000_000
t1 = timeit.timeit(lambda: sum(range(n)), number=10)
t2 = timeit.timeit(lambda: sum(i for i in range(n)), number=10)
print(f"sum(range):     {t1:.3f}s")
print(f"sum(generator): {t2:.3f}s")
# sum(range) is typically 2-3x faster
```
</details>

---

### Q4: How does Python 3.11+ adaptive specialization improve loop performance?

<details>
<summary>Answer</summary>

CPython 3.11 introduced the **specializing adaptive interpreter** (PEP 659):

1. **Quickening:** After a function is called a few times, its bytecodes are replaced with "quickened" versions that track type information.

2. **Specialization:** If a bytecode consistently sees the same types, it's replaced with a type-specialized version:
   - `FOR_ITER` → `FOR_ITER_RANGE` (for range objects)
   - `BINARY_OP` → `BINARY_OP_ADD_INT` (for int+int)
   - `COMPARE_OP` → `COMPARE_OP_INT` (for int<int)
   - `LOAD_ATTR` → `LOAD_ATTR_INSTANCE_VALUE` (for known class attributes)

3. **De-optimization:** If types change, the specialized instruction falls back to the generic version and may re-specialize later.

Impact on loops: A tight `for i in range(n): total += i` loop can be 20-40% faster in 3.11+ because:
- `FOR_ITER_RANGE` avoids generic iterator protocol
- `BINARY_OP_ADD_INT` avoids type checking
- `COMPARE_OP_INT` avoids generic comparison dispatch
</details>

---

### Q5: Compare the performance of `multiprocessing`, `threading`, and `asyncio` for loop-heavy workloads.

<details>
<summary>Answer</summary>

| Approach | Best for | GIL impact | Overhead |
|----------|----------|-----------|----------|
| `threading` | I/O-bound loops | GIL released during I/O | Low (shared memory) |
| `multiprocessing` | CPU-bound loops | Each process has its own GIL | High (process creation + IPC) |
| `asyncio` | High-concurrency I/O | Single thread, no GIL issue | Very low (coroutine switch) |

```python
# CPU-bound: multiprocessing wins
from multiprocessing import Pool
def cpu_work(n):
    return sum(i*i for i in range(n))

with Pool(4) as p:
    results = p.map(cpu_work, [1_000_000] * 4)

# I/O-bound: asyncio wins
import asyncio, aiohttp
async def fetch_all(urls):
    async with aiohttp.ClientSession() as s:
        tasks = [s.get(u) for u in urls]
        return await asyncio.gather(*tasks)
```

**Key insight:** For pure Python loops doing CPU work, `threading` provides **no speedup** (and often makes it slower due to GIL contention). Use `multiprocessing` or NumPy/C extensions.
</details>

---

### Q6: How would you implement a rate-limited async iterator?

<details>
<summary>Answer</summary>

```python
import asyncio
from typing import AsyncIterator, TypeVar, AsyncIterable

T = TypeVar("T")

class RateLimitedIterator(AsyncIterator[T]):
    """Wraps an async iterable with rate limiting."""

    def __init__(
        self,
        source: AsyncIterable[T],
        max_per_second: float,
    ) -> None:
        self.source = source.__aiter__()
        self.interval = 1.0 / max_per_second
        self.last_yield = 0.0

    def __aiter__(self) -> AsyncIterator[T]:
        return self

    async def __anext__(self) -> T:
        # Enforce rate limit
        now = asyncio.get_event_loop().time()
        elapsed = now - self.last_yield
        if elapsed < self.interval:
            await asyncio.sleep(self.interval - elapsed)

        try:
            value = await self.source.__anext__()
        except StopAsyncIteration:
            raise

        self.last_yield = asyncio.get_event_loop().time()
        return value

# Usage
async def api_calls():
    for i in range(100):
        yield f"request_{i}"

async def main():
    async for item in RateLimitedIterator(api_calls(), max_per_second=10):
        print(f"Processing: {item}")

# asyncio.run(main())
```
</details>

---

## Scenario-Based Questions (3-5)

### Scenario 1: Your API endpoint processes a list of 1 million records and returns a JSON response. It causes OOM errors. How do you fix it?

<details>
<summary>Answer</summary>

**Root cause:** Loading all 1M records into a list before serializing.

**Solutions (in order of preference):**

1. **Streaming response with generator:**
```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import json

app = FastAPI()

@app.get("/records")
async def get_records():
    async def generate():
        yield "["
        first = True
        async for record in fetch_records_cursor():
            if not first:
                yield ","
            yield json.dumps(record)
            first = False
        yield "]"

    return StreamingResponse(generate(), media_type="application/json")
```

2. **Pagination:** Return records in pages of 100-1000 items.

3. **Server-side cursor:** Use database cursor to fetch rows on demand.

4. **Background job:** For very large exports, process async and provide a download link.
</details>

---

### Scenario 2: You notice a Python service using 100% CPU on one core. Profiling shows a tight loop is the bottleneck. What are your options?

<details>
<summary>Answer</summary>

**Diagnosis first:**
```bash
py-spy top --pid <PID>  # See which function is hot
```

**Options ranked by impact:**

1. **Algorithmic improvement** — Can you reduce O(n^2) to O(n log n)? E.g., replace list membership checks with set lookups.

2. **NumPy/pandas vectorization** — If numerical, replace Python loop with vectorized C operations (10-100x speedup).

3. **C extension** — Rewrite the hot loop in C/Cython:
```python
# cython_module.pyx
def fast_loop(double[:] data):
    cdef double total = 0
    cdef int i
    for i in range(len(data)):
        total += data[i] * data[i]
    return total
```

4. **`multiprocessing`** — Parallelize across cores if work is independent.

5. **PyPy** — Switch interpreter for 5-30x speedup on pure Python loops.

6. **List comprehension** — Minor (30-50%) speedup by moving loop to C level.
</details>

---

### Scenario 3: A colleague writes a function that creates 100 threads to process items in a loop. Each thread does CPU-intensive work. Performance is worse than single-threaded. Why?

<details>
<summary>Answer</summary>

**Cause:** The GIL (Global Interpreter Lock).

For CPU-bound Python code, only one thread executes at a time. With 100 threads:
1. Only one thread runs Python bytecode
2. Other 99 threads are blocked waiting for the GIL
3. GIL acquisition/release adds overhead (~5ms switch interval)
4. Cache thrashing from context switches degrades performance

**The fix:**
```python
# ❌ Threading — no speedup for CPU-bound
import threading
threads = [threading.Thread(target=cpu_work, args=(chunk,)) for chunk in chunks]

# ✅ Multiprocessing — each process has its own GIL
from multiprocessing import Pool
with Pool(os.cpu_count()) as pool:
    results = pool.map(cpu_work, chunks)
```

**When threading IS useful:** I/O-bound work (network, disk). The GIL is released during I/O operations.
</details>

---

### Scenario 4: You need to iterate over a generator in multiple places but it gets exhausted after the first use. How do you solve this?

<details>
<summary>Answer</summary>

**Option 1 — Materialize into a list** (if data fits in memory):
```python
data = list(generator)
# Now you can iterate multiple times
```

**Option 2 — Use `itertools.tee()`** (if iterators advance at similar pace):
```python
import itertools
gen1, gen2 = itertools.tee(generator, 2)
# gen1 and gen2 are independent iterators
# Warning: if one advances far ahead, tee buffers items in memory
```

**Option 3 — Make the source re-iterable** (best design):
```python
class ReIterableSource:
    def __init__(self, path: str):
        self.path = path

    def __iter__(self):
        with open(self.path) as f:
            for line in f:
                yield line.strip()

# Each for loop creates a fresh generator
source = ReIterableSource("data.txt")
for line in source: ...  # first pass
for line in source: ...  # second pass — works!
```

Option 3 is the best pattern because it clearly separates the **iterable** (can create iterators) from the **iterator** (consumed once).
</details>

---

### Scenario 5: You are reviewing code that uses `eval()` inside a loop to process user-provided expressions. What are the risks and alternatives?

<details>
<summary>Answer</summary>

**Risks:**
1. **Arbitrary code execution** — `eval("__import__('os').system('rm -rf /')")` executes system commands
2. **Data exfiltration** — `eval("open('/etc/passwd').read()")`
3. **Denial of Service** — `eval("'a' * 10**10")` exhausts memory

**Alternatives:**

1. **`ast.literal_eval()`** — safe for parsing Python literals (strings, numbers, tuples, lists, dicts):
```python
import ast
result = ast.literal_eval("[1, 2, 3]")  # Safe
```

2. **Whitelist approach** — map allowed operations:
```python
OPERATIONS = {
    "add": lambda a, b: a + b,
    "mul": lambda a, b: a * b,
}
for expr in user_expressions:
    op, *args = expr.split()
    if op in OPERATIONS:
        result = OPERATIONS[op](*map(float, args))
```

3. **Expression parser** — use a library like `simpleeval` for safe expression evaluation.

4. **Domain-specific language** — define a restricted syntax and parse it yourself.
</details>

---

## FAQ

### Q: Is `for i in range(len(list))` ever correct?

Yes, but rarely. Use it when you need to **modify** the list at specific indices:
```python
for i in range(len(items)):
    items[i] = items[i].upper()
```
But even then, a list comprehension is usually better:
```python
items = [item.upper() for item in items]
```

### Q: Can you use `else` on a `while` loop?

Yes. The `else` block on a `while` loop runs when the condition becomes `False` naturally (not via `break`):
```python
n = 10
while n > 0:
    n -= 1
else:
    print("Loop finished normally")  # Prints
```

### Q: What is faster — `for` loop or `while` loop?

`for` loop is generally faster because:
1. `FOR_ITER` is a single opcode optimized for iteration
2. `while` requires `COMPARE_OP` + `POP_JUMP_IF_FALSE` each iteration
3. `for` over `range()` gets specialized to `FOR_ITER_RANGE` in Python 3.11+

### Q: How do you iterate over a dictionary?

```python
d = {"a": 1, "b": 2}

# Keys (default)
for key in d:
    print(key)

# Values
for value in d.values():
    print(value)

# Key-value pairs
for key, value in d.items():
    print(key, value)
```

Since Python 3.7, dictionaries maintain **insertion order**.

### Q: What happens to the loop variable after the loop ends?

The loop variable persists in the current scope with its last value:
```python
for i in range(5):
    pass
print(i)  # 4

# But if the iterable is empty:
for i in []:
    pass
# print(i)  # NameError if i wasn't defined before
```
