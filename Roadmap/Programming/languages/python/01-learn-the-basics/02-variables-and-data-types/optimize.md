# Variables and Data Types — Optimize the Code

> Each exercise contains working but inefficient code. Your task is to optimize it for better performance, lower memory usage, or cleaner design.

---

## Optimization 1: String Concatenation in a Loop (Junior)

**Problem:** Building a large string by concatenation in a loop.

```python
def build_report(items: list[dict]) -> str:
    """Build a CSV report from items."""
    report = "id,name,value\n"
    for item in items:
        report += f"{item['id']},{item['name']},{item['value']}\n"
    return report


items = [{"id": i, "name": f"item_{i}", "value": i * 1.5} for i in range(100_000)]

import time
start = time.perf_counter()
result = build_report(items)
elapsed = time.perf_counter() - start
print(f"Time: {elapsed:.3f}s, Length: {len(result):,} chars")
```

**Why it's slow:** String concatenation with `+=` creates a new string object each iteration. For N items, this is O(N^2) because each concatenation copies the entire string.

<details>
<summary>Optimized Solution</summary>

```python
def build_report_optimized(items: list[dict]) -> str:
    """Build a CSV report using join — O(N) instead of O(N^2)."""
    lines = ["id,name,value"]
    for item in items:
        lines.append(f"{item['id']},{item['name']},{item['value']}")
    return "\n".join(lines) + "\n"


# Even better: use io.StringIO for streaming
import io

def build_report_stringio(items: list[dict]) -> str:
    """Build a CSV report using StringIO — avoids list overhead."""
    buffer = io.StringIO()
    buffer.write("id,name,value\n")
    for item in items:
        buffer.write(f"{item['id']},{item['name']},{item['value']}\n")
    return buffer.getvalue()


# Benchmark
items = [{"id": i, "name": f"item_{i}", "value": i * 1.5} for i in range(100_000)]

import time
for func, label in [(build_report_optimized, "join"), (build_report_stringio, "StringIO")]:
    start = time.perf_counter()
    result = func(items)
    elapsed = time.perf_counter() - start
    print(f"{label:10}: {elapsed:.3f}s, Length: {len(result):,} chars")
```

**Speedup:** 10-100x faster for large datasets. `join()` allocates the final string once.

</details>

---

## Optimization 2: Repeated Type Checking (Junior)

**Problem:** Using `type()` comparison instead of `isinstance()`.

```python
def process_value(value) -> str:
    """Convert a value to a display string based on its type."""
    if type(value) == int:
        return f"Integer: {value}"
    elif type(value) == float:
        return f"Float: {value:.2f}"
    elif type(value) == str:
        return f"String: '{value}'"
    elif type(value) == bool:
        return f"Boolean: {value}"
    elif type(value) == list:
        return f"List with {len(value)} items"
    elif type(value) == dict:
        return f"Dict with {len(value)} keys"
    elif type(value) == type(None):
        return "None"
    else:
        return f"Unknown: {value}"


# Bug: bool is a subclass of int, so True matches int before bool!
print(process_value(True))   # "Integer: True" — WRONG!
print(process_value(42))     # "Integer: 42"
print(process_value(3.14))   # "Float: 3.14"
```

<details>
<summary>Optimized Solution</summary>

```python
def process_value_optimized(value) -> str:
    """Convert a value using isinstance — handles subclasses correctly."""
    # Check bool BEFORE int (bool is subclass of int)
    if isinstance(value, bool):
        return f"Boolean: {value}"
    elif isinstance(value, int):
        return f"Integer: {value}"
    elif isinstance(value, float):
        return f"Float: {value:.2f}"
    elif isinstance(value, str):
        return f"String: '{value}'"
    elif isinstance(value, list):
        return f"List with {len(value)} items"
    elif isinstance(value, dict):
        return f"Dict with {len(value)} keys"
    elif value is None:
        return "None"
    else:
        return f"Unknown: {value}"


# Even faster for hot paths — use a dispatch dict:
_FORMATTERS = {
    bool: lambda v: f"Boolean: {v}",
    int: lambda v: f"Integer: {v}",
    float: lambda v: f"Float: {v:.2f}",
    str: lambda v: f"String: '{v}'",
    list: lambda v: f"List with {len(v)} items",
    dict: lambda v: f"Dict with {len(v)} keys",
    type(None): lambda v: "None",
}


def process_value_dispatch(value) -> str:
    """O(1) type dispatch using dict lookup."""
    formatter = _FORMATTERS.get(type(value))
    if formatter:
        return formatter(value)
    return f"Unknown: {value}"


print(process_value_optimized(True))   # "Boolean: True" — correct!
print(process_value_dispatch(True))    # "Boolean: True" — correct!
```

**Key improvements:**
1. `isinstance()` handles inheritance correctly
2. Check `bool` before `int` since `bool` is a subclass
3. Dispatch dict is O(1) instead of O(N) type checks

</details>

---

## Optimization 3: Storing Large Number of Small Objects (Middle)

**Problem:** Using regular classes to store millions of records.

```python
import sys
import tracemalloc


class User:
    def __init__(self, id: int, name: str, email: str, active: bool):
        self.id = id
        self.name = name
        self.email = email
        self.active = active


def create_users(n: int) -> list[User]:
    return [User(i, f"user_{i}", f"user_{i}@example.com", i % 2 == 0) for i in range(n)]


N = 500_000
tracemalloc.start()
users = create_users(N)
current, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()

print(f"Users: {N:,}")
print(f"Memory: {current / 1024 / 1024:.1f} MB")
print(f"Per user: {current / N:.0f} bytes")
```

<details>
<summary>Optimized Solution</summary>

```python
import sys
import tracemalloc


# Option 1: __slots__ class
class UserSlots:
    __slots__ = ("id", "name", "email", "active")

    def __init__(self, id: int, name: str, email: str, active: bool):
        self.id = id
        self.name = name
        self.email = email
        self.active = active


# Option 2: NamedTuple (immutable, even smaller)
from typing import NamedTuple

class UserTuple(NamedTuple):
    id: int
    name: str
    email: str
    active: bool


# Option 3: Slots dataclass
from dataclasses import dataclass

@dataclass(slots=True)
class UserDC:
    id: int
    name: str
    email: str
    active: bool


N = 500_000

for cls, label in [(UserSlots, "__slots__"), (UserTuple, "NamedTuple"), (UserDC, "slots dataclass")]:
    tracemalloc.start()
    users = [cls(i, f"user_{i}", f"user_{i}@example.com", i % 2 == 0) for i in range(N)]
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    print(f"{label:20}: {current / 1024 / 1024:.1f} MB ({current / N:.0f} bytes/user)")
    del users
```

**Expected results:**
- Regular class: ~300+ bytes/user
- `__slots__`: ~170 bytes/user (~40-50% savings)
- `NamedTuple`: ~150 bytes/user

</details>

---

## Optimization 4: Global Variable Access in Hot Loop (Middle)

**Problem:** Accessing global variables inside a tight loop.

```python
import time
import math

THRESHOLD = 100.0
MULTIPLIER = 2.5


def process_data(data: list[float]) -> list[float]:
    """Process data using global constants — slow due to LOAD_GLOBAL."""
    result = []
    for value in data:
        if value > THRESHOLD:
            result.append(math.sqrt(value) * MULTIPLIER)
        else:
            result.append(value * MULTIPLIER)
    return result


data = [float(i) for i in range(1_000_000)]
start = time.perf_counter()
result = process_data(data)
elapsed = time.perf_counter() - start
print(f"Time: {elapsed:.3f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
import time
import math


THRESHOLD = 100.0
MULTIPLIER = 2.5


def process_data_optimized(data: list[float]) -> list[float]:
    """Process data with localized globals — LOAD_FAST instead of LOAD_GLOBAL."""
    # Localize globals and builtins for LOAD_FAST access
    threshold = THRESHOLD
    multiplier = MULTIPLIER
    sqrt = math.sqrt
    append = list.append

    result: list[float] = []
    result_append = result.append

    for value in data:
        if value > threshold:
            result_append(sqrt(value) * multiplier)
        else:
            result_append(value * multiplier)

    return result


# Even faster: list comprehension (runs in C, avoids APPEND overhead)
def process_data_comprehension(data: list[float]) -> list[float]:
    threshold = THRESHOLD
    multiplier = MULTIPLIER
    sqrt = math.sqrt
    return [
        sqrt(v) * multiplier if v > threshold else v * multiplier
        for v in data
    ]


data = [float(i) for i in range(1_000_000)]

for func, label in [
    (process_data_optimized, "Localized"),
    (process_data_comprehension, "Comprehension"),
]:
    start = time.perf_counter()
    result = func(data)
    elapsed = time.perf_counter() - start
    print(f"{label:15}: {elapsed:.3f}s")
```

**Why it's faster:**
- `LOAD_FAST` (local variable, array index) is ~2x faster than `LOAD_GLOBAL` (dict lookup)
- List comprehension runs partly in C and avoids method lookup overhead
- Localizing `math.sqrt` avoids attribute lookup on every iteration

</details>

---

## Optimization 5: Dictionary Creation from Pairs (Middle)

**Problem:** Inefficient dictionary construction.

```python
def build_index(items: list[tuple[str, int]]) -> dict[str, int]:
    """Build a name->id index from (name, id) pairs."""
    index = {}
    for name, id_val in items:
        if name not in index:
            index[name] = id_val
    return index


items = [(f"key_{i % 10000}", i) for i in range(1_000_000)]

import time
start = time.perf_counter()
index = build_index(items)
elapsed = time.perf_counter() - start
print(f"Time: {elapsed:.3f}s, Size: {len(index):,}")
```

<details>
<summary>Optimized Solution</summary>

```python
import time


def build_index_optimized(items: list[tuple[str, int]]) -> dict[str, int]:
    """Build index using dict comprehension — first occurrence wins."""
    # Reverse iterate so first occurrence wins (last write in reversed = first in original)
    return {name: id_val for name, id_val in reversed(items)}


def build_index_setdefault(items: list[tuple[str, int]]) -> dict[str, int]:
    """Build index using setdefault — avoids double lookup."""
    index: dict[str, int] = {}
    for name, id_val in items:
        index.setdefault(name, id_val)
    return index


items = [(f"key_{i % 10000}", i) for i in range(1_000_000)]

for func, label in [
    (build_index_optimized, "dict comprehension (reversed)"),
    (build_index_setdefault, "setdefault"),
]:
    start = time.perf_counter()
    index = func(items)
    elapsed = time.perf_counter() - start
    print(f"{label:35}: {elapsed:.3f}s, Size: {len(index):,}")
```

**Key insight:** `setdefault` does the lookup and insert in a single C call, avoiding the overhead of `if key not in dict` followed by `dict[key] = value`.

</details>

---

## Optimization 6: Memory-Wasteful Numeric Storage (Senior)

**Problem:** Storing large arrays of numbers as Python lists.

```python
import sys
import time


def compute_stats(numbers: list[float]) -> dict:
    """Compute basic statistics."""
    n = len(numbers)
    mean = sum(numbers) / n
    variance = sum((x - mean) ** 2 for x in numbers) / n
    std_dev = variance ** 0.5
    return {"mean": mean, "std_dev": std_dev, "min": min(numbers), "max": max(numbers)}


# List of 1 million floats
numbers = [float(i) for i in range(1_000_000)]

print(f"Memory: {sys.getsizeof(numbers) / 1024 / 1024:.1f} MB (just the list object)")
# Each float object: 24 bytes + 8 bytes pointer in list = 32 bytes per number
# Total: ~32 MB for 1M numbers

start = time.perf_counter()
stats = compute_stats(numbers)
elapsed = time.perf_counter() - start
print(f"Time: {elapsed:.3f}s")
print(f"Stats: {stats}")
```

<details>
<summary>Optimized Solution</summary>

```python
import sys
import time
import array
import numpy as np


# Option 1: array.array (stdlib, no dependencies)
def compute_stats_array(numbers: array.array) -> dict:
    n = len(numbers)
    total = sum(numbers)
    mean = total / n
    variance = sum((x - mean) ** 2 for x in numbers) / n
    return {"mean": mean, "std_dev": variance ** 0.5,
            "min": min(numbers), "max": max(numbers)}


# Option 2: numpy (fastest, most memory efficient)
def compute_stats_numpy(numbers: np.ndarray) -> dict:
    return {
        "mean": float(np.mean(numbers)),
        "std_dev": float(np.std(numbers)),
        "min": float(np.min(numbers)),
        "max": float(np.max(numbers)),
    }


N = 1_000_000

# Python list
py_list = [float(i) for i in range(N)]
list_size = sys.getsizeof(py_list) + N * sys.getsizeof(0.0)

# array.array
arr = array.array("d", range(N))  # 'd' = double (8 bytes per element)
arr_size = sys.getsizeof(arr)

# numpy array
np_arr = np.arange(N, dtype=np.float64)
np_size = np_arr.nbytes

print(f"Memory comparison:")
print(f"  Python list:  {list_size / 1024 / 1024:.1f} MB ({list_size / N:.0f} bytes/elem)")
print(f"  array.array:  {arr_size / 1024 / 1024:.1f} MB ({arr_size / N:.0f} bytes/elem)")
print(f"  numpy array:  {np_size / 1024 / 1024:.1f} MB ({np_size / N:.0f} bytes/elem)")

# Speed comparison
for data, func, label in [
    (py_list, compute_stats, "Python list"),
    (arr, compute_stats_array, "array.array"),
    (np_arr, compute_stats_numpy, "numpy"),
]:
    start = time.perf_counter()
    stats = func(data)
    elapsed = time.perf_counter() - start
    print(f"  {label:15}: {elapsed:.4f}s")
```

**Expected results:**
- Python list: ~32 MB (24 bytes/float + 8 bytes/pointer)
- array.array: ~8 MB (8 bytes/double, packed)
- numpy: ~8 MB (8 bytes/double, packed, vectorized operations)
- numpy is 10-100x faster for numeric operations due to C/SIMD

</details>

---

## Optimization 7: Expensive isinstance() in Hot Path (Senior)

**Problem:** Using isinstance() with many types in a frequently called function.

```python
import time
from typing import Any


def serialize(value: Any) -> str:
    """Serialize a value to JSON-like string."""
    if isinstance(value, bool):
        return "true" if value else "false"
    elif isinstance(value, int):
        return str(value)
    elif isinstance(value, float):
        return f"{value:.6f}"
    elif isinstance(value, str):
        return f'"{value}"'
    elif isinstance(value, (list, tuple)):
        inner = ", ".join(serialize(item) for item in value)
        return f"[{inner}]"
    elif isinstance(value, dict):
        pairs = ", ".join(f'"{k}": {serialize(v)}' for k, v in value.items())
        return f"{{{pairs}}}"
    elif value is None:
        return "null"
    else:
        return f'"{value!s}"'


# Benchmark
data = [
    {"name": f"user_{i}", "age": 20 + i, "score": i * 1.5, "active": i % 2 == 0}
    for i in range(10_000)
]

start = time.perf_counter()
for _ in range(10):
    result = serialize(data)
elapsed = time.perf_counter() - start
print(f"Time: {elapsed:.3f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
import time
from typing import Any
from functools import singledispatch


# Option 1: singledispatch — O(1) type dispatch
@singledispatch
def serialize_fast(value: Any) -> str:
    return f'"{value!s}"'

@serialize_fast.register(bool)
def _(value: bool) -> str:
    return "true" if value else "false"

@serialize_fast.register(int)
def _(value: int) -> str:
    return str(value)

@serialize_fast.register(float)
def _(value: float) -> str:
    return f"{value:.6f}"

@serialize_fast.register(str)
def _(value: str) -> str:
    return f'"{value}"'

@serialize_fast.register(list)
@serialize_fast.register(tuple)
def _(value: list | tuple) -> str:
    inner = ", ".join(serialize_fast(item) for item in value)
    return f"[{inner}]"

@serialize_fast.register(dict)
def _(value: dict) -> str:
    pairs = ", ".join(f'"{k}": {serialize_fast(v)}' for k, v in value.items())
    return f"{{{pairs}}}"

@serialize_fast.register(type(None))
def _(value: None) -> str:
    return "null"


# Option 2: Manual dispatch dict (fastest for known types)
def make_serializer():
    def _serialize_bool(v): return "true" if v else "false"
    def _serialize_int(v): return str(v)
    def _serialize_float(v): return f"{v:.6f}"
    def _serialize_str(v): return f'"{v}"'
    def _serialize_none(v): return "null"

    dispatch = {
        bool: _serialize_bool,
        int: _serialize_int,
        float: _serialize_float,
        str: _serialize_str,
        type(None): _serialize_none,
    }

    def serialize_dispatch(value):
        t = type(value)
        handler = dispatch.get(t)
        if handler:
            return handler(value)
        if isinstance(value, (list, tuple)):
            inner = ", ".join(serialize_dispatch(item) for item in value)
            return f"[{inner}]"
        if isinstance(value, dict):
            pairs = ", ".join(f'"{k}": {serialize_dispatch(v)}' for k, v in value.items())
            return f"{{{pairs}}}"
        return f'"{value!s}"'

    return serialize_dispatch

serialize_dispatch = make_serializer()


# Benchmark
data = [
    {"name": f"user_{i}", "age": 20 + i, "score": i * 1.5, "active": i % 2 == 0}
    for i in range(10_000)
]

for func, label in [(serialize_fast, "singledispatch"), (serialize_dispatch, "manual dispatch")]:
    start = time.perf_counter()
    for _ in range(10):
        result = func(data)
    elapsed = time.perf_counter() - start
    print(f"{label:20}: {elapsed:.3f}s")
```

**Why it's faster:**
- `singledispatch` uses MRO-based caching for O(1) dispatch
- Manual dispatch dict avoids the chain of `isinstance()` calls
- For known leaf types, dict lookup is significantly faster than sequential isinstance

</details>

---

## Optimization 8: Excessive Object Creation (Senior)

**Problem:** Creating many temporary objects in a data pipeline.

```python
import time


def process_records(records: list[dict]) -> list[dict]:
    """Process records — creates many intermediate objects."""
    # Step 1: Filter active records
    active = [r for r in records if r["active"]]

    # Step 2: Transform
    transformed = []
    for r in active:
        transformed.append({
            "id": r["id"],
            "name": r["name"].upper(),
            "score": r["score"] * 1.1,
        })

    # Step 3: Sort
    sorted_records = sorted(transformed, key=lambda r: r["score"], reverse=True)

    # Step 4: Take top 100
    return sorted_records[:100]


records = [
    {"id": i, "name": f"user_{i}", "score": float(i % 100), "active": i % 3 != 0}
    for i in range(1_000_000)
]

start = time.perf_counter()
result = process_records(records)
elapsed = time.perf_counter() - start
print(f"Time: {elapsed:.3f}s, Results: {len(result)}")
```

<details>
<summary>Optimized Solution</summary>

```python
import time
import heapq


def process_records_optimized(records: list[dict], top_n: int = 100) -> list[dict]:
    """Process records with minimal intermediate objects.

    Key optimizations:
    1. Generator pipeline — no intermediate lists
    2. heapq.nlargest — O(N log K) instead of O(N log N) for full sort
    3. Single pass through data
    """
    # Generator: filter + transform in one pass (no intermediate list)
    active_transformed = (
        {"id": r["id"], "name": r["name"].upper(), "score": r["score"] * 1.1}
        for r in records
        if r["active"]
    )

    # heapq.nlargest: O(N log K) where K=100 << N=1M
    return heapq.nlargest(top_n, active_transformed, key=lambda r: r["score"])


# Even more optimized: avoid dict creation until final step
def process_records_minimal(records: list[dict], top_n: int = 100) -> list[dict]:
    """Minimize object creation by deferring dict construction."""
    # Extract only what we need: (score, index) tuples
    scored = (
        (r["score"] * 1.1, i)
        for i, r in enumerate(records)
        if r["active"]
    )

    # Get top N by score — only tuples, no dicts yet
    top_indices = heapq.nlargest(top_n, scored, key=lambda x: x[0])

    # Build dicts only for the top N results
    return [
        {
            "id": records[i]["id"],
            "name": records[i]["name"].upper(),
            "score": score,
        }
        for score, i in top_indices
    ]


records = [
    {"id": i, "name": f"user_{i}", "score": float(i % 100), "active": i % 3 != 0}
    for i in range(1_000_000)
]

for func, label in [
    (process_records_optimized, "Generator + heapq"),
    (process_records_minimal, "Minimal objects"),
]:
    start = time.perf_counter()
    result = func(records)
    elapsed = time.perf_counter() - start
    print(f"{label:25}: {elapsed:.3f}s, Results: {len(result)}")
```

**Key improvements:**
1. Generator pipeline avoids creating intermediate lists (millions of dicts saved)
2. `heapq.nlargest(100, ...)` is O(N log 100) vs O(N log N) for full sort
3. Deferred dict construction — only create 100 output dicts, not 666K

</details>

---

## Optimization 9: Inefficient Interning Pattern (Professional)

**Problem:** High memory usage from repeated string keys in a large dataset.

```python
import sys
import tracemalloc


def load_events(n: int) -> list[dict]:
    """Load events — each event has the same set of keys."""
    events = []
    for i in range(n):
        events.append({
            "event_type": "page_view" if i % 2 == 0 else "click",
            "user_id": f"user_{i % 1000}",
            "timestamp": 1700000000 + i,
            "metadata": {
                "browser": "chrome" if i % 3 == 0 else "firefox",
                "os": "linux" if i % 4 == 0 else "windows",
                "version": f"v{i % 10}",
            },
        })
    return events


N = 500_000
tracemalloc.start()
events = load_events(N)
current, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()

print(f"Events: {N:,}")
print(f"Memory: {current / 1024 / 1024:.1f} MB")
```

<details>
<summary>Optimized Solution</summary>

```python
import sys
import tracemalloc


def load_events_optimized(n: int) -> list[dict]:
    """Load events with string interning for repeated values."""
    # Pre-intern all known repeated strings
    intern = sys.intern
    event_types = {intern("page_view"), intern("click")}
    browsers = {intern("chrome"), intern("firefox")}
    os_names = {intern("linux"), intern("windows")}
    versions = {intern(f"v{i}"): intern(f"v{i}") for i in range(10)}
    user_ids = {i: intern(f"user_{i}") for i in range(1000)}

    # Pre-intern dict keys (Python interns simple string literals automatically,
    # but being explicit helps)
    k_event = intern("event_type")
    k_user = intern("user_id")
    k_time = intern("timestamp")
    k_meta = intern("metadata")
    k_browser = intern("browser")
    k_os = intern("os")
    k_version = intern("version")

    events = []
    for i in range(n):
        events.append({
            k_event: intern("page_view") if i % 2 == 0 else intern("click"),
            k_user: user_ids[i % 1000],
            k_time: 1700000000 + i,
            k_meta: {
                k_browser: intern("chrome") if i % 3 == 0 else intern("firefox"),
                k_os: intern("linux") if i % 4 == 0 else intern("windows"),
                k_version: versions.get(i % 10, intern(f"v{i % 10}")),
            },
        })
    return events


# Even more optimized: use slots class instead of dict
from dataclasses import dataclass

@dataclass(slots=True)
class Metadata:
    browser: str
    os: str
    version: str

@dataclass(slots=True)
class Event:
    event_type: str
    user_id: str
    timestamp: int
    metadata: Metadata


def load_events_dataclass(n: int) -> list[Event]:
    """Load events as dataclass instances — smaller than dicts."""
    intern = sys.intern
    user_ids = {i: intern(f"user_{i}") for i in range(1000)}
    versions = {i: intern(f"v{i}") for i in range(10)}

    events = []
    for i in range(n):
        events.append(Event(
            event_type=intern("page_view") if i % 2 == 0 else intern("click"),
            user_id=user_ids[i % 1000],
            timestamp=1700000000 + i,
            metadata=Metadata(
                browser=intern("chrome") if i % 3 == 0 else intern("firefox"),
                os=intern("linux") if i % 4 == 0 else intern("windows"),
                version=versions[i % 10],
            ),
        ))
    return events


N = 500_000

for func, label in [
    (load_events_optimized, "Interned dicts"),
    (load_events_dataclass, "Slots dataclass"),
]:
    tracemalloc.start()
    events = func(N)
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    print(f"{label:20}: {current / 1024 / 1024:.1f} MB")
    del events
```

**Why it saves memory:**
1. String interning: instead of 500K copies of `"page_view"`, one shared object
2. User ID interning: 1000 unique strings shared across 500K events
3. `__slots__` dataclass: no per-instance `__dict__` overhead
4. Combined savings: often 30-60% memory reduction

</details>

---

## Optimization 10: Slow Variable Lookup in Recursive Function (Professional)

**Problem:** Recursive function with repeated global/builtin lookups.

```python
import time


def flatten(nested):
    """Flatten a deeply nested list structure."""
    result = []
    for item in nested:
        if isinstance(item, list):
            result.extend(flatten(item))
        else:
            result.append(item)
    return result


# Generate deeply nested structure
def make_nested(depth, breadth):
    if depth == 0:
        return list(range(breadth))
    return [make_nested(depth - 1, breadth) for _ in range(breadth)]


data = make_nested(5, 4)  # 4^5 = 1024 leaf lists, 4096 total items

start = time.perf_counter()
for _ in range(1000):
    result = flatten(data)
elapsed = time.perf_counter() - start
print(f"Time: {elapsed:.3f}s, Items: {len(result):,}")
```

<details>
<summary>Optimized Solution</summary>

```python
import time
from collections import deque


# Option 1: Iterative with stack (avoids recursion overhead)
def flatten_iterative(nested: list) -> list:
    """Flatten using an explicit stack — no recursion overhead."""
    result = []
    stack = deque([nested])
    isinstance_check = isinstance  # Localize builtin
    result_append = result.append

    while stack:
        current = stack.pop()
        if isinstance_check(current, list):
            stack.extend(reversed(current))  # Maintain order
        else:
            result_append(current)

    return result


# Option 2: Optimized recursive with localized builtins
def flatten_optimized(nested, _isinstance=isinstance, _list=list):
    """Flatten with localized builtins — LOAD_FAST instead of LOAD_GLOBAL."""
    result = []
    _extend = result.extend
    _append = result.append

    for item in nested:
        if _isinstance(item, _list):
            _extend(flatten_optimized(item, _isinstance, _list))
        else:
            _append(item)

    return result


# Option 3: Generator-based (memory efficient for very large structures)
def flatten_gen(nested):
    """Generator-based flatten — yields items lazily."""
    for item in nested:
        if isinstance(item, list):
            yield from flatten_gen(item)
        else:
            yield item


# Generate test data
def make_nested(depth, breadth):
    if depth == 0:
        return list(range(breadth))
    return [make_nested(depth - 1, breadth) for _ in range(breadth)]


data = make_nested(5, 4)

for func, label in [
    (flatten_iterative, "Iterative (stack)"),
    (flatten_optimized, "Recursive (localized)"),
    (lambda d: list(flatten_gen(d)), "Generator"),
]:
    start = time.perf_counter()
    for _ in range(1000):
        result = func(data)
    elapsed = time.perf_counter() - start
    print(f"{label:25}: {elapsed:.3f}s, Items: {len(result):,}")
```

**Key optimizations:**
1. Iterative approach avoids Python function call overhead (~100ns per call)
2. Localized builtins (`_isinstance`, `_list`) use `LOAD_FAST` instead of `LOAD_GLOBAL`
3. Generator approach uses O(depth) memory instead of O(N) for intermediate lists
4. `deque` as stack is faster than list for append/pop operations

</details>
