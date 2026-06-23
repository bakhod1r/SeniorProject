# Basic Syntax — Optimization Exercises

> Optimize each slow code snippet. Measure the improvement with `timeit`.

---

## Score Card

| # | Difficulty | Topic | Type | Optimized? | Speedup |
|---|:----------:|-------|:----:|:----------:|:-------:|
| 1 | Easy | print vs sys.stdout.write | I/O | [ ] | ___x |
| 2 | Easy | f-string vs format vs % | CPU | [ ] | ___x |
| 3 | Easy | Multiple assignment vs separate | CPU | [ ] | ___x |
| 4 | Medium | Walrus operator | CPU | [ ] | ___x |
| 5 | Medium | Short-circuit evaluation | CPU | [ ] | ___x |
| 6 | Medium | Local vs global variable lookup | CPU | [ ] | ___x |
| 7 | Medium | Chained comparison vs and | CPU | [ ] | ___x |
| 8 | Hard | __slots__ impact | Memory | [ ] | ___x |
| 9 | Hard | Interning strings | Memory | [ ] | ___x |
| 10 | Hard | Compiled regex vs re.match | CPU | [ ] | ___x |

**Total optimized: ___ / 10**

---

## Exercise 1: print vs sys.stdout.write

**Difficulty:** Easy

```python
import timeit
import sys
import io

# SLOW: Using print() in a tight loop
def write_lines_slow(n: int) -> None:
    """Write n lines to a string buffer using print()."""
    buf = io.StringIO()
    for i in range(n):
        print(f"line {i}", file=buf)  # print adds newline, flushes formatting
    buf.getvalue()


n = 50_000

slow_time = timeit.timeit(lambda: write_lines_slow(n), number=5)
print(f"Slow (print): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

`print()` does extra work: it converts arguments to strings, adds a separator, adds a newline, and calls the file's `write()` method. If you already have the exact string you want to write, you can skip all that overhead.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Using sys.stdout.write (or buffer.write) directly
def write_lines_fast(n: int) -> None:
    """Write n lines to a string buffer using write()."""
    buf = io.StringIO()
    write = buf.write  # Cache the method lookup
    for i in range(n):
        write(f"line {i}\n")  # Direct write — no extra processing
    buf.getvalue()


fast_time = timeit.timeit(lambda: write_lines_fast(n), number=5)
print(f"Fast (write): {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.5-3x
```

**Why it's faster:** `print()` internally converts all arguments via `str()`, joins them with `sep`, appends `end` (default `\n`), then calls `file.write()`. Calling `write()` directly with a pre-formatted string skips all that overhead. Caching `buf.write` as a local variable also avoids repeated attribute lookup.

</details>

<details>
<summary>Learn More</summary>

- `print()` is a convenience function. For high-throughput I/O, `sys.stdout.write()` or `file.write()` is preferred.
- Caching method lookups (e.g., `write = buf.write`) in a local variable avoids repeated `__getattr__` calls — this is a common micro-optimization in CPython.
- For bulk output, consider building a list of strings and calling `"\n".join(lines)` once at the end.

</details>

---

## Exercise 2: f-string vs format() vs % Formatting

**Difficulty:** Easy

```python
import timeit

name = "Alice"
age = 30
city = "Tashkent"

# SLOW: Using .format() method
def format_method():
    return "Name: {}, Age: {}, City: {}".format(name, age, city)

# SLOWER: Using % operator
def format_percent():
    return "Name: %s, Age: %d, City: %s" % (name, age, city)


fmt_time = timeit.timeit(format_method, number=1_000_000)
pct_time = timeit.timeit(format_percent, number=1_000_000)
print(f".format(): {fmt_time:.4f}s")
print(f"%%:        {pct_time:.4f}s")
```

<details>
<summary>Hint</summary>

Python 3.6+ introduced f-strings (formatted string literals). They are parsed at compile time into efficient concatenation code, avoiding the runtime overhead of method calls like `.format()` or the `%` operator.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Using f-string
def format_fstring():
    return f"Name: {name}, Age: {age}, City: {city}"


fast_time = timeit.timeit(format_fstring, number=1_000_000)
print(f"f-string:  {fast_time:.4f}s")
print(f"Speedup vs .format(): {fmt_time / fast_time:.1f}x")
print(f"Speedup vs %%:        {pct_time / fast_time:.1f}x")
# Typical speedup: 1.3-2x
```

**Why it's faster:** f-strings are compiled into a `FORMAT_VALUE` + `BUILD_STRING` bytecode sequence at compile time. `.format()` performs a method call, argument parsing, and template parsing at runtime. `%` formatting also involves runtime parsing of the format string.

</details>

<details>
<summary>Learn More</summary>

- Use `dis.dis(format_fstring)` to see the efficient bytecode generated for f-strings.
- f-strings also support `=` for debugging: `f"{name=}"` produces `name='Alice'`.
- For repeated formatting of the same template with different data, `str.format_map()` with a dict can also be efficient — but f-strings are still faster for simple cases.

</details>

---

## Exercise 3: Multiple Assignment vs Separate Statements

**Difficulty:** Easy

```python
import timeit

# SLOW: Separate assignment statements
def assign_separate():
    x = 1
    y = 2
    z = 3
    temp = x
    x = y
    y = z
    z = temp
    return x, y, z


slow_time = timeit.timeit(assign_separate, number=2_000_000)
print(f"Separate assignments: {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Python supports tuple packing/unpacking, which lets you assign and swap multiple variables in a single statement. The interpreter optimizes this into stack rotations instead of creating temporary variables.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Tuple unpacking assignment and swap
def assign_multiple():
    x, y, z = 1, 2, 3
    x, y, z = y, z, x  # Single-line swap — no temp variable
    return x, y, z


fast_time = timeit.timeit(assign_multiple, number=2_000_000)
print(f"Multiple assignment: {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.2-1.8x
```

**Why it's faster:** Tuple unpacking uses `ROT_THREE` / `ROT_TWO` bytecodes for swaps, which manipulate the stack directly. Separate assignments require more `STORE_FAST` and `LOAD_FAST` bytecodes and an explicit temp variable. Fewer bytecodes = fewer interpreter loop iterations.

</details>

<details>
<summary>Learn More</summary>

- Python's swap idiom `a, b = b, a` is idiomatic and optimized — never use a temp variable.
- Tuple unpacking works with any iterable on the right side: `a, b, c = range(3)`.
- Extended unpacking with `*` is also supported: `first, *rest = [1, 2, 3, 4]`.

</details>

---

## Exercise 4: Walrus Operator (:=) to Avoid Repeated Computation

**Difficulty:** Medium

```python
import timeit
import re

# SLOW: Calling an expensive function twice
def process_lines_slow(lines: list[str]) -> list[tuple[str, str]]:
    """Extract (line, match) pairs for lines matching a pattern."""
    pattern = r"\b[A-Z]{3}-\d{4}\b"  # e.g., ABC-1234
    results = []
    for line in lines:
        if re.search(pattern, line):
            match = re.search(pattern, line)  # Duplicate call!
            results.append((line, match.group()))
    return results


lines = [f"Order {chr(65 + i % 26)}{chr(65 + (i*7) % 26)}{chr(65 + (i*13) % 26)}-{i:04d} confirmed"
         for i in range(20_000)]

slow_time = timeit.timeit(lambda: process_lines_slow(lines), number=5)
print(f"Slow (double search): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

The walrus operator `:=` (assignment expression), introduced in Python 3.8, lets you assign a value inside an expression. This means you can call `re.search()` once, assign the result, and check it — all in the `if` condition.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Using walrus operator to call re.search() once
def process_lines_fast(lines: list[str]) -> list[tuple[str, str]]:
    pattern = r"\b[A-Z]{3}-\d{4}\b"
    results = []
    for line in lines:
        if (match := re.search(pattern, line)):  # Single call!
            results.append((line, match.group()))
    return results


fast_time = timeit.timeit(lambda: process_lines_fast(lines), number=5)
print(f"Fast (walrus):        {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.5-2x
```

**Why it's faster:** The slow version calls `re.search()` twice for every matching line. The walrus operator captures the result of the first call, eliminating the redundant computation entirely.

</details>

<details>
<summary>Learn More</summary>

- The walrus operator `:=` is especially useful with `while` loops: `while (chunk := file.read(8192)): ...`
- It also works in list comprehensions: `[m.group() for line in lines if (m := re.search(pattern, line))]`
- PEP 572 introduced assignment expressions in Python 3.8.

</details>

---

## Exercise 5: Short-Circuit Evaluation

**Difficulty:** Medium

```python
import timeit

def expensive_check(x: int) -> bool:
    """Simulate an expensive validation."""
    total = 0
    for i in range(100):
        total += i * x
    return total % 7 == 0

# SLOW: Expensive check runs first, even when cheap check would reject
def filter_items_slow(items: list[int]) -> list[int]:
    results = []
    for item in items:
        if expensive_check(item) and item > 500:  # Expensive first!
            results.append(item)
    return results


items = list(range(1000))

slow_time = timeit.timeit(lambda: filter_items_slow(items), number=20)
print(f"Slow (expensive first): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Python's `and` operator short-circuits: if the left operand is `False`, the right operand is never evaluated. Place the cheapest check first so that expensive checks are skipped whenever possible.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Cheap check first — short-circuit skips expensive check for ~50% of items
def filter_items_fast(items: list[int]) -> list[int]:
    results = []
    for item in items:
        if item > 500 and expensive_check(item):  # Cheap first!
            results.append(item)
    return results


fast_time = timeit.timeit(lambda: filter_items_fast(items), number=20)
print(f"Fast (cheap first):     {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.5-2x
```

**Why it's faster:** When `item > 500` is `False` (roughly half the items), `expensive_check()` is never called due to short-circuit evaluation. In the slow version, `expensive_check()` runs for every single item before the cheap `item > 500` is even tested.

</details>

<details>
<summary>Learn More</summary>

- Short-circuit evaluation also works with `or`: if the left is `True`, the right is skipped.
- This pattern is critical in database queries: filter on indexed columns before expensive joins.
- In list comprehensions, the same principle applies: `[x for x in items if x > 500 if expensive_check(x)]`.

</details>

---

## Exercise 6: Local vs Global Variable Lookup

**Difficulty:** Medium

```python
import timeit
import math

# SLOW: Accessing math.sqrt as a global + attribute lookup each iteration
def compute_slow(n: int) -> float:
    total = 0.0
    for i in range(1, n):
        total += math.sqrt(i)  # Global lookup 'math' + attribute lookup 'sqrt'
    return total


n = 500_000

slow_time = timeit.timeit(lambda: compute_slow(n), number=5)
print(f"Slow (global lookup): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

In CPython, local variable access uses `LOAD_FAST` (array index lookup), while global variable access uses `LOAD_GLOBAL` (dictionary lookup). Attribute access like `math.sqrt` adds another dictionary lookup on top. Caching the function in a local variable eliminates both lookups per iteration.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Cache the function as a local variable
def compute_fast(n: int) -> float:
    sqrt = math.sqrt  # Local variable — LOAD_FAST
    total = 0.0
    for i in range(1, n):
        total += sqrt(i)  # Single LOAD_FAST
    return total


fast_time = timeit.timeit(lambda: compute_fast(n), number=5)
print(f"Fast (local lookup):  {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.1-1.4x
```

**Why it's faster:** `math.sqrt` requires two dictionary lookups per call: `LOAD_GLOBAL` for `math` (checks local dict, then global dict, then builtins), then `LOAD_ATTR` for `sqrt`. A local variable uses `LOAD_FAST`, which is a simple array index operation — no hash table involved.

</details>

<details>
<summary>Learn More</summary>

- Use `dis.dis(compute_slow)` and `dis.dis(compute_fast)` to see the bytecode difference.
- This technique is used extensively in the Python standard library (e.g., `json` encoder).
- The speedup is more significant in tight loops with millions of iterations.
- You can also pass frequently used globals as default arguments: `def f(n, _sqrt=math.sqrt)`.

</details>

---

## Exercise 7: Chained Comparison vs Separate and

**Difficulty:** Medium

```python
import timeit

# SLOW: Separate comparisons joined with 'and'
def validate_range_slow(values: list[int]) -> list[bool]:
    results = []
    for v in values:
        results.append(0 < v and v < 100 and v != 50)  # 'v' evaluated multiple times
    return results


values = list(range(-1000, 1000)) * 100  # 200,000 items

slow_time = timeit.timeit(lambda: validate_range_slow(values), number=5)
print(f"Slow (separate and): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Python supports chained comparisons like `0 < v < 100`. This is not just syntactic sugar — the interpreter evaluates `v` only once in the chain and can optimize the bytecode for the comparison sequence.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Chained comparison — v is loaded once for the chain
def validate_range_fast(values: list[int]) -> list[bool]:
    results = []
    for v in values:
        results.append(0 < v < 100 and v != 50)  # Chained: v evaluated once
    return results


fast_time = timeit.timeit(lambda: validate_range_fast(values), number=5)
print(f"Fast (chained):      {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.1-1.3x
```

**Why it's faster:** In `0 < v and v < 100`, the variable `v` is loaded from the stack twice and the `and` operator introduces an extra jump in bytecode. In `0 < v < 100`, `v` is loaded once and the comparison chain uses `DUP_TOP` + `ROT_THREE`, which is slightly more efficient. The improvement is modest but measurable in tight loops.

</details>

<details>
<summary>Learn More</summary>

- Chained comparisons are also more readable: `a <= b <= c` is clearer than `a <= b and b <= c`.
- Chains can be arbitrarily long: `0 < a < b < c < 100` works.
- The key optimization is that intermediate values are only evaluated once: `0 < expensive() < 100` calls `expensive()` once, while `0 < expensive() and expensive() < 100` calls it twice.

</details>

---

## Exercise 8: __slots__ for Memory Optimization

**Difficulty:** Hard

```python
import timeit
import sys

# SLOW: Regular class with __dict__
class PointRegular:
    def __init__(self, x: float, y: float, z: float):
        self.x = x
        self.y = y
        self.z = z


# Create many instances and measure memory
regular_points = [PointRegular(float(i), float(i+1), float(i+2)) for i in range(100_000)]
regular_size = sys.getsizeof(regular_points[0]) + sys.getsizeof(regular_points[0].__dict__)
print(f"Regular class instance size: {regular_size} bytes")
print(f"Total for 100k points: ~{regular_size * 100_000 / 1024 / 1024:.1f} MB")

slow_time = timeit.timeit(
    lambda: [PointRegular(float(i), float(i+1), float(i+2)) for i in range(10_000)],
    number=20
)
print(f"Slow (regular class): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

By default, Python objects store their attributes in a `__dict__` dictionary. This is flexible but wasteful for objects with a fixed set of attributes. The `__slots__` declaration tells Python to use a compact, fixed-size struct instead — saving both memory (no dict) and time (faster attribute access).

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Class with __slots__ — no __dict__, fixed attributes
class PointSlotted:
    __slots__ = ('x', 'y', 'z')

    def __init__(self, x: float, y: float, z: float):
        self.x = x
        self.y = y
        self.z = z


slotted_points = [PointSlotted(float(i), float(i+1), float(i+2)) for i in range(100_000)]
slotted_size = sys.getsizeof(slotted_points[0])
print(f"Slotted class instance size: {slotted_size} bytes")
print(f"Total for 100k points: ~{slotted_size * 100_000 / 1024 / 1024:.1f} MB")
print(f"Memory savings: {(regular_size - slotted_size) / regular_size * 100:.0f}%")

fast_time = timeit.timeit(
    lambda: [PointSlotted(float(i), float(i+1), float(i+2)) for i in range(10_000)],
    number=20
)
print(f"Fast (slotted class): {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical memory savings: 30-50%
# Typical speedup: 1.1-1.3x (creation), faster attribute access
```

**Why it's faster:** `__slots__` eliminates the per-instance `__dict__` (which is a hash table). Instead, attributes are stored as a C-level struct with fixed offsets. This saves ~40-60 bytes per instance and makes attribute access faster (direct pointer offset vs. hash lookup).

</details>

<details>
<summary>Learn More</summary>

- `__slots__` prevents dynamic attribute assignment: `point.w = 4` will raise `AttributeError`.
- To allow both `__slots__` and dynamic attributes, include `'__dict__'` in `__slots__` — but this defeats the purpose.
- `__slots__` works with inheritance, but each class in the hierarchy must define its own `__slots__`.
- For data-heavy classes with millions of instances (e.g., game entities, ORM rows), `__slots__` can save gigabytes of RAM.
- Consider `dataclasses` with `slots=True` (Python 3.10+): `@dataclass(slots=True)`.

</details>

---

## Exercise 9: String Interning for Memory and Comparison Speed

**Difficulty:** Hard

```python
import timeit
import sys

# SLOW: Millions of duplicate strings consuming separate memory
def create_records_slow(n: int) -> list[dict]:
    """Create records with repeated status strings — each is a new object."""
    records = []
    statuses = ["active", "inactive", "pending", "suspended", "deleted"]
    for i in range(n):
        records.append({
            "id": i,
            "status": str(statuses[i % 5]),  # str() forces a new string object
        })
    return records


n = 500_000

slow_time = timeit.timeit(lambda: create_records_slow(n), number=3)
records_slow = create_records_slow(n)

# Check: are the strings the same object?
print(f"Same object? {records_slow[0]['status'] is records_slow[5]['status']}")
print(f"Slow creation: {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

`sys.intern()` ensures that strings with the same content share the same object in memory. This saves memory (one object instead of many copies) and makes equality comparison O(1) via pointer comparison (`is` check) instead of character-by-character comparison.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Intern repeated strings — same content shares one object
def create_records_fast(n: int) -> list[dict]:
    """Create records with interned status strings."""
    statuses = [sys.intern(s) for s in ["active", "inactive", "pending", "suspended", "deleted"]]
    records = []
    for i in range(n):
        records.append({
            "id": i,
            "status": statuses[i % 5],  # All point to the same interned object
        })
    return records


fast_time = timeit.timeit(lambda: create_records_fast(n), number=3)
records_fast = create_records_fast(n)

print(f"Same object? {records_fast[0]['status'] is records_fast[5]['status']}")
print(f"Fast creation: {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")

# Measure comparison speed
s1 = records_slow[0]["status"]
s2 = records_slow[5]["status"]
s3 = records_fast[0]["status"]
s4 = records_fast[5]["status"]

cmp_slow = timeit.timeit(lambda: s1 == s2, number=5_000_000)
cmp_fast = timeit.timeit(lambda: s3 is s4, number=5_000_000)  # Pointer comparison!
print(f"Comparison (==): {cmp_slow:.4f}s")
print(f"Comparison (is): {cmp_fast:.4f}s")
print(f"Comparison speedup: {cmp_slow / cmp_fast:.1f}x")
# Typical speedup: 1.5-3x creation, 2-5x comparison
```

**Why it's faster:** Without interning, each `str()` call creates a new string object even if the content is identical — 500,000 records with 5 statuses means 500,000 separate string objects. With interning, there are only 5 string objects total, shared by reference. Equality via `is` compares pointers (one CPU instruction) instead of characters.

</details>

<details>
<summary>Learn More</summary>

- CPython automatically interns small strings and identifiers, but `str()` or string concatenation may bypass this.
- `sys.intern()` is most useful for strings that appear millions of times: column names, status codes, keys.
- Interned strings are never garbage collected, so only intern strings with a bounded set of values.
- Dictionary key lookups in CPython use interning internally — this is why dict lookups are fast for string keys.

</details>

---

## Exercise 10: Compiled Regex vs re.match on Every Call

**Difficulty:** Hard

```python
import timeit
import re

# SLOW: Calling re.match() with a pattern string each time
def extract_emails_slow(lines: list[str]) -> list[str]:
    """Extract email addresses from lines using re.search() each call."""
    emails = []
    for line in lines:
        match = re.search(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", line)
        if match:
            emails.append(match.group())
    return emails


lines = [f"Contact user_{i}@example.com for details about order #{i}" for i in range(50_000)]
lines += [f"No email here, just order #{i}" for i in range(50_000)]  # 50% no match

slow_time = timeit.timeit(lambda: extract_emails_slow(lines), number=3)
print(f"Slow (re.search): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

`re.search(pattern, string)` compiles the pattern into a regex object on every call. Python caches the last few patterns (up to `re._MAXCACHE = 512`), but the cache lookup itself has overhead. Pre-compiling with `re.compile()` skips this entirely.

</details>

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Pre-compile the regex pattern once
def extract_emails_fast(lines: list[str]) -> list[str]:
    """Extract email addresses using a pre-compiled regex."""
    pattern = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
    search = pattern.search  # Cache method lookup too
    emails = []
    for line in lines:
        match = search(line)
        if match:
            emails.append(match.group())
    return emails


# FASTEST: Combine with walrus operator and list comprehension
def extract_emails_fastest(lines: list[str]) -> list[str]:
    pattern = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
    return [m.group() for line in lines if (m := pattern.search(line))]


fast_time = timeit.timeit(lambda: extract_emails_fast(lines), number=3)
fastest_time = timeit.timeit(lambda: extract_emails_fastest(lines), number=3)
print(f"Fast (compiled):          {fast_time:.4f}s (speedup: {slow_time/fast_time:.1f}x)")
print(f"Fastest (compiled+walrus): {fastest_time:.4f}s (speedup: {slow_time/fastest_time:.1f}x)")
# Typical speedup: 1.1-1.5x (compiled), 1.2-1.8x (compiled + walrus)
```

**Why it's faster:** `re.search()` must look up the pattern in the internal cache (a dictionary), check if it is compiled, and dispatch to the compiled version. `pattern.search()` skips the cache lookup entirely and calls the C-level match function directly. The walrus + list comprehension version additionally avoids the overhead of `list.append()` in a loop.

</details>

<details>
<summary>Learn More</summary>

- Always use `re.compile()` when the same pattern is used more than a few times — it is the idiomatic Python approach.
- The internal cache (`re._MAXCACHE`) defaults to 512 entries. If your program uses more than 512 distinct patterns, older ones are evicted and recompiled.
- For ultra-high-performance regex, consider the `regex` third-party module or `re2` (Google's RE2 engine via `google-re2`).
- `re.compile()` with `re.VERBOSE` flag lets you write readable multi-line patterns with comments.

</details>

---

## Cheat Sheet

| Pattern | Slow | Fast | Type | Typical Gain |
|---------|------|------|:----:|:------------:|
| Output in loop | `print(x)` | `buf.write(x + "\n")` | I/O | 1.5-3x |
| String formatting | `"{}".format(x)` | `f"{x}"` | CPU | 1.3-2x |
| Variable swap | `temp=a; a=b; b=temp` | `a, b = b, a` | CPU | 1.2-1.8x |
| Avoid double call | `if f(x): y = f(x)` | `if (y := f(x)):` | CPU | 1.5-2x |
| Condition order | `expensive() and cheap()` | `cheap() and expensive()` | CPU | 1.5-2x |
| Attribute lookup | `math.sqrt(i)` in loop | `sqrt = math.sqrt` | CPU | 1.1-1.4x |
| Chained compare | `a < x and x < b` | `a < x < b` | CPU | 1.1-1.3x |
| Instance memory | Regular class | `__slots__` class | Memory | 30-50% less |
| String dedup | Separate string objects | `sys.intern()` | Memory | 2-5x compare |
| Regex reuse | `re.search(pat, s)` | `compiled.search(s)` | CPU | 1.1-1.5x |
