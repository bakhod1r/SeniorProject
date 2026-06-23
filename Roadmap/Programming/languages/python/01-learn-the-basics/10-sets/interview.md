# Sets — Interview Questions

---

## Junior Level (5-7 Questions)

### Q1: What is a set in Python and how does it differ from a list?

<details>
<summary>Answer</summary>

A set is an **unordered collection of unique, hashable elements**. Key differences from lists:

| Feature | Set | List |
|---------|-----|------|
| Order | Unordered | Ordered (preserves insertion order) |
| Duplicates | Not allowed | Allowed |
| Indexing | Not supported | Supported (`list[0]`) |
| Lookup | O(1) average | O(n) |
| Elements | Must be hashable | Any type |
| Syntax | `{1, 2, 3}` | `[1, 2, 3]` |

```python
my_list = [1, 2, 2, 3]  # [1, 2, 2, 3] — keeps duplicates
my_set = {1, 2, 2, 3}   # {1, 2, 3} — removes duplicates
```

</details>

### Q2: How do you create an empty set? Why can't you use `{}`?

<details>
<summary>Answer</summary>

Use `set()` to create an empty set. `{}` creates an empty **dictionary**, not a set, because dict literals came first in Python's history.

```python
empty_set = set()       # Correct
empty_dict = {}         # This is a dict!
print(type({}))         # <class 'dict'>
print(type(set()))      # <class 'set'>
```

</details>

### Q3: What is the difference between `remove()` and `discard()`?

<details>
<summary>Answer</summary>

Both remove an element from a set, but they differ in error handling:

- **`remove(x)`** — raises `KeyError` if `x` is not in the set
- **`discard(x)`** — does nothing if `x` is not in the set (no error)

```python
s = {1, 2, 3}
s.discard(10)   # No error
s.remove(10)    # KeyError: 10
```

**Best practice:** Use `discard()` when you are not sure the element exists.

</details>

### Q4: How do you remove duplicates from a list?

<details>
<summary>Answer</summary>

**Simple (does not preserve order):**
```python
unique = list(set(original_list))
```

**Preserving order:**
```python
def remove_duplicates(items):
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result
```

**Python 3.7+ (using dict):**
```python
unique = list(dict.fromkeys(original_list))
```

</details>

### Q5: What are the four main set operations?

<details>
<summary>Answer</summary>

| Operation | Operator | Method | Result |
|-----------|----------|--------|--------|
| Union | `a \| b` | `a.union(b)` | All elements from both sets |
| Intersection | `a & b` | `a.intersection(b)` | Elements common to both |
| Difference | `a - b` | `a.difference(b)` | Elements in `a` but not `b` |
| Symmetric Difference | `a ^ b` | `a.symmetric_difference(b)` | Elements in either but not both |

```python
a = {1, 2, 3}
b = {3, 4, 5}
print(a | b)   # {1, 2, 3, 4, 5}
print(a & b)   # {3}
print(a - b)   # {1, 2}
print(a ^ b)   # {1, 2, 4, 5}
```

</details>

### Q6: What is a frozenset and when would you use it?

<details>
<summary>Answer</summary>

A `frozenset` is an **immutable** version of a set. It cannot be modified after creation.

**Use cases:**
- As a dictionary key (regular sets are unhashable)
- As an element of another set
- For constant/config values that should not change

```python
# Regular set cannot be a dict key
# {frozenset({1, 2}): "value"}  # Works
# {{1, 2}: "value"}             # TypeError

config = frozenset({"feature_a", "feature_b"})
# config.add("feature_c")  # AttributeError
```

</details>

### Q7: What does this code output?

```python
s = {True, 1, 0, False, 1.0}
print(s)
print(len(s))
```

<details>
<summary>Answer</summary>

Output:
```
{True, 0}
2
```

`True == 1 == 1.0` and `False == 0`, so they are considered the same values. The set keeps the first encountered representation.

</details>

---

## Middle Level (4-6 Questions)

### Q1: Why must set elements be hashable? What makes an object hashable?

<details>
<summary>Answer</summary>

Sets use **hash tables** internally. Each element's hash determines its storage slot. For this to work:

1. The object must implement `__hash__()` — returns an integer
2. The object must implement `__eq__()` — for collision resolution
3. The **hash/eq contract** must hold: `if a == b then hash(a) == hash(b)`
4. The hash must not change during the object's lifetime

**Hashable:** `int`, `str`, `float`, `tuple` (if all elements are hashable), `frozenset`
**Unhashable:** `list`, `dict`, `set` (they are mutable)

```python
# Custom hashable class
class Point:
    def __init__(self, x, y):
        self.x, self.y = x, y
    def __hash__(self):
        return hash((self.x, self.y))
    def __eq__(self, other):
        return isinstance(other, Point) and (self.x, self.y) == (other.x, other.y)
```

</details>

### Q2: What is the time complexity of set operations?

<details>
<summary>Answer</summary>

| Operation | Average | Worst Case |
|-----------|---------|------------|
| `x in s` | O(1) | O(n) |
| `s.add(x)` | O(1) | O(n) (resize) |
| `s.remove(x)` | O(1) | O(n) |
| `s \| t` (union) | O(len(s) + len(t)) | O(len(s) * len(t)) |
| `s & t` (intersection) | O(min(len(s), len(t))) | O(len(s) * len(t)) |
| `s - t` (difference) | O(len(s)) | O(len(s) * len(t)) |
| `s <= t` (subset) | O(len(s)) | O(len(s) * len(t)) |

Worst case occurs with pathological hash collisions (all elements in the same bucket).

</details>

### Q3: Explain the difference between set operators and set methods.

<details>
<summary>Answer</summary>

**Operators** (`|`, `&`, `-`, `^`) require **both operands to be sets**.
**Methods** (`.union()`, `.intersection()`, etc.) accept **any iterable**.

```python
s = {1, 2, 3}

# Operator — TypeError with non-set
# s | [4, 5]  # TypeError: unsupported operand type(s)

# Method — works with any iterable
s.union([4, 5])           # OK
s.intersection(range(3))  # OK
s.difference("abc")       # OK (iterates chars)

# Methods also accept multiple arguments
s.union([4], [5], [6])    # {1, 2, 3, 4, 5, 6}
```

</details>

### Q4: How do sets handle hash collisions?

<details>
<summary>Answer</summary>

CPython uses **open addressing** with perturbation-based probing:

1. Compute `slot = hash(element) & mask`
2. If slot is occupied by a different element (collision), compute next slot:
   ```
   perturb >>= 5
   slot = (slot * 5 + perturb + 1) & mask
   ```
3. Repeat until an empty slot is found

This avoids clustering issues of pure linear probing while being cache-friendly.

```python
# All elements hash to slot 0 — forces collision chain
class BadHash:
    def __init__(self, val):
        self.val = val
    def __hash__(self):
        return 0  # All same hash!
    def __eq__(self, other):
        return isinstance(other, BadHash) and self.val == other.val

# Lookup degrades to O(n)
import timeit
s = {BadHash(i) for i in range(1000)}
print(timeit.timeit(lambda: BadHash(999) in s, number=10000))
```

</details>

### Q5: When would you use a set vs a dict for membership testing?

<details>
<summary>Answer</summary>

| Use Case | Choose | Why |
|----------|--------|-----|
| Simple membership check | `set` | Lower memory, simpler code |
| Membership + associated data | `dict` | Store key-value pairs |
| Need ordered unique elements | `dict.fromkeys()` | Dicts preserve insertion order (3.7+) |
| Need counting | `collections.Counter` | Dict subclass for counting |

```python
# Just membership
banned_users: set[str] = {"user1", "user2"}

# Membership + data
user_roles: dict[str, str] = {"user1": "admin", "user2": "editor"}

# Ordered unique
ordered_unique = list(dict.fromkeys([3, 1, 2, 1, 3]))  # [3, 1, 2]
```

</details>

### Q6: What happens internally when a set resizes?

<details>
<summary>Answer</summary>

When the load factor exceeds ~2/3, CPython:

1. Allocates a new table (typically 2x-4x the current size, always power of 2)
2. Rehashes ALL existing elements into the new table
3. Frees the old table (unless it was the inline `smalltable`)

This is an O(n) operation, but happens infrequently enough that amortized cost is O(1).

```python
import sys
s = set()
sizes = []
for i in range(100):
    prev = sys.getsizeof(s)
    s.add(i)
    curr = sys.getsizeof(s)
    if curr != prev:
        sizes.append((i, prev, curr))
        print(f"Resize at {i} elements: {prev} -> {curr} bytes")
```

</details>

---

## Senior Level (4-6 Questions)

### Q1: How would you implement a thread-safe set in Python?

<details>
<summary>Answer</summary>

While individual set operations are atomic under the GIL, compound operations (check-then-act) are not. A proper thread-safe set requires explicit locking:

```python
import threading
from typing import TypeVar, Generic

T = TypeVar("T")

class ThreadSafeSet(Generic[T]):
    def __init__(self):
        self._data: set[T] = set()
        self._lock = threading.RLock()

    def add(self, item: T) -> bool:
        """Add item. Returns True if it was actually added."""
        with self._lock:
            size_before = len(self._data)
            self._data.add(item)
            return len(self._data) > size_before

    def add_if_absent(self, item: T) -> bool:
        """Atomic check-and-add. Returns True if added."""
        with self._lock:
            if item not in self._data:
                self._data.add(item)
                return True
            return False

    def snapshot(self) -> frozenset[T]:
        with self._lock:
            return frozenset(self._data)
```

Key considerations:
- Use `RLock` (reentrant) to allow nested locking
- Return `frozenset` snapshots for safe iteration
- Atomic compound operations (check-then-act) inside a single `with self._lock:` block

</details>

### Q2: Design a caching system using sets for cache invalidation tags.

<details>
<summary>Answer</summary>

```python
from __future__ import annotations
from typing import Any
from collections import defaultdict
import time


class TagBasedCache:
    """Cache with set-based tag invalidation."""

    def __init__(self):
        self._cache: dict[str, tuple[Any, frozenset[str], float]] = {}
        self._tag_to_keys: dict[str, set[str]] = defaultdict(set)

    def set(self, key: str, value: Any, tags: set[str], ttl: float = 300) -> None:
        frozen_tags = frozenset(tags)
        self._cache[key] = (value, frozen_tags, time.monotonic() + ttl)
        for tag in tags:
            self._tag_to_keys[tag].add(key)

    def get(self, key: str) -> Any | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        value, tags, expires = entry
        if time.monotonic() > expires:
            self._evict(key, tags)
            return None
        return value

    def invalidate_tags(self, tags: set[str]) -> int:
        """Invalidate all cache entries matching ANY of the given tags."""
        keys_to_invalidate: set[str] = set()
        for tag in tags:
            keys_to_invalidate |= self._tag_to_keys.get(tag, set())

        for key in keys_to_invalidate:
            entry = self._cache.pop(key, None)
            if entry:
                _, entry_tags, _ = entry
                for t in entry_tags:
                    self._tag_to_keys[t].discard(key)

        return len(keys_to_invalidate)

    def _evict(self, key: str, tags: frozenset[str]) -> None:
        self._cache.pop(key, None)
        for tag in tags:
            self._tag_to_keys[tag].discard(key)
```

Architecture: Uses `frozenset` for immutable tag storage and `set` for reverse index mapping. Tag invalidation is O(number of affected keys).

</details>

### Q3: Explain the memory overhead of sets vs alternative data structures for membership testing.

<details>
<summary>Answer</summary>

```python
import sys

n = 1_000_000

# Option 1: set — ~40-50 bytes per element total
s = set(range(n))
set_size = sys.getsizeof(s)

# Option 2: frozenset — similar to set
fs = frozenset(range(n))
frozenset_size = sys.getsizeof(fs)

# Option 3: sorted list + bisect — ~8 bytes per element
import array
a = array.array("q", sorted(range(n)))
array_size = sys.getsizeof(a)

# Option 4: bytearray bitmap — 1 byte per possible value
ba = bytearray(n)
for i in range(n):
    ba[i] = 1
bitmap_size = sys.getsizeof(ba)

print(f"set:       {set_size:>12,} bytes (hash table overhead)")
print(f"frozenset: {frozenset_size:>12,} bytes")
print(f"array:     {array_size:>12,} bytes (O(log n) lookup)")
print(f"bitmap:    {bitmap_size:>12,} bytes (O(1) lookup, limited range)")
```

| Structure | Memory/element | Lookup | Insert | Constraints |
|-----------|:-------------:|:------:|:------:|------------|
| `set` | ~50 bytes | O(1) | O(1) | Hashable elements |
| `sorted array` | ~8 bytes | O(log n) | O(n) | Comparable elements |
| `bitmap` | ~1 bit | O(1) | O(1) | Integer range known |
| `bloom filter` | ~10 bits | O(1) | O(1) | False positives possible |

</details>

### Q4: How does PYTHONHASHSEED protect against hash collision attacks?

<details>
<summary>Answer</summary>

Before Python 3.3, string hashes were deterministic. An attacker could craft inputs that all map to the same hash bucket, degrading O(1) to O(n) — a **HashDoS** attack.

**PYTHONHASHSEED** seeds string hashing with a random value at interpreter startup:

```python
import os, sys

# Each Python process gets a different seed
print(f"PYTHONHASHSEED: {os.environ.get('PYTHONHASHSEED', 'random')}")
print(f"hash('hello'): {hash('hello')}")  # Different each run

# Integers are NOT affected — hash(42) is always 42
print(f"hash(42): {hash(42)}")  # Always 42
```

**Impact on sets:**
- Iteration order changes between runs
- Tests that depend on set ordering break
- Fix: `PYTHONHASHSEED=0` for reproducible tests, or use `sorted()` for deterministic output

**What is NOT protected:** Integer and float hashes are still deterministic, so integer-based HashDoS is theoretically possible.

</details>

### Q5: How would you efficiently find the symmetric difference of 100 sets?

<details>
<summary>Answer</summary>

The symmetric difference of multiple sets (elements appearing in an **odd** number of sets) can be computed efficiently:

```python
from functools import reduce
from collections import Counter
from typing import Iterable


# Method 1: Reduce with ^ (simple but creates many intermediate sets)
def symmetric_diff_reduce(sets: list[set]) -> set:
    return reduce(set.symmetric_difference, sets)


# Method 2: Count occurrences — keep elements appearing odd number of times
def symmetric_diff_counter(sets: list[set]) -> set:
    counts: Counter = Counter()
    for s in sets:
        counts.update(s)
    return {elem for elem, count in counts.items() if count % 2 == 1}


# Method 3: XOR-based bitwise (for integer elements in known range)
def symmetric_diff_bitwise(sets: list[set[int]], max_val: int) -> set[int]:
    bits = bytearray(max_val + 1)
    for s in sets:
        for elem in s:
            bits[elem] ^= 1
    return {i for i, b in enumerate(bits) if b}


# Benchmark
import timeit
test_sets = [set(range(i, i + 1000)) for i in range(0, 100_000, 1000)]

t1 = timeit.timeit(lambda: symmetric_diff_reduce(test_sets), number=100)
t2 = timeit.timeit(lambda: symmetric_diff_counter(test_sets), number=100)
print(f"Reduce: {t1:.3f}s, Counter: {t2:.3f}s")
```

</details>

### Q6: Describe the internal difference between `set` and `frozenset` in CPython.

<details>
<summary>Answer</summary>

Both use the same `PySetObject` C struct, but differ in:

1. **Type object**: `PySet_Type` vs `PyFrozenSet_Type`
2. **`hash` field**: Sets store `-1` (sentinel for "no hash"). Frozensets compute and cache their hash.
3. **Mutation methods**: `set` exposes `add`, `remove`, `discard`, `pop`, `clear`, `update`. `frozenset` does not.
4. **Empty singleton**: `frozenset()` returns a cached singleton. `set()` always creates a new object.
5. **`tp_hash` slot**: `set` has `tp_hash = PyObject_HashNotImplemented` (unhashable). `frozenset` computes hash from element hashes using XOR with mixing.

```python
a = frozenset()
b = frozenset()
print(a is b)  # True — singleton

c = set()
d = set()
print(c is d)  # False — always new object

print(hash(frozenset({1, 2})))  # Some integer
# hash(set())  # TypeError: unhashable type: 'set'
```

</details>

---

## Scenario-Based Questions (3-5)

### Scenario 1: Data Deduplication Pipeline

**Problem:** You receive 10 million user records per day from multiple sources. Each record has an email field. Design a deduplication pipeline.

<details>
<summary>Answer</summary>

```python
from typing import Iterator, Dict, Any


def deduplicate_stream(
    records: Iterator[Dict[str, Any]],
    key_field: str = "email",
) -> Iterator[Dict[str, Any]]:
    """Memory-efficient deduplication for streaming data."""
    seen: set[str] = set()

    for record in records:
        key = record.get(key_field, "").lower().strip()
        if key and key not in seen:
            seen.add(key)
            yield record

# For very large datasets, consider:
# 1. Bloom filter for probabilistic dedup (saves memory)
# 2. Partitioned processing (hash key % N partitions)
# 3. External storage (Redis SET, database DISTINCT)
```

**Memory analysis:** 10M emails averaging 25 chars each: ~50 bytes/string + ~50 bytes/set_entry = ~1 GB. For tighter memory, use a Bloom filter (~15 MB at 0.1% false positive rate).

</details>

### Scenario 2: Real-Time Access Control

**Problem:** Design a permission system where users can have multiple roles, each with a set of permissions. Check access in < 1 microsecond.

<details>
<summary>Answer</summary>

```python
from functools import lru_cache


class AccessControl:
    def __init__(self):
        self._role_perms: dict[str, frozenset[str]] = {}

    def define_role(self, role: str, perms: set[str]) -> None:
        self._role_perms[role] = frozenset(perms)
        self._resolve_cached.cache_clear()

    @lru_cache(maxsize=1024)
    def _resolve_cached(self, roles: frozenset[str]) -> frozenset[str]:
        """Cached permission resolution."""
        result: set[str] = set()
        for role in roles:
            result |= self._role_perms.get(role, frozenset())
        return frozenset(result)

    def check(self, user_roles: frozenset[str], required: str) -> bool:
        resolved = self._resolve_cached(user_roles)
        return required in resolved  # O(1) lookup

# Frozenset as cache key enables LRU caching of permission resolution
```

</details>

### Scenario 3: API Rate Limiter

**Problem:** Implement a rate limiter that tracks active API keys and blocks banned keys.

<details>
<summary>Answer</summary>

```python
import time
import threading
from collections import defaultdict


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window = window_seconds
        self._banned: set[str] = set()
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def ban(self, api_key: str) -> None:
        with self._lock:
            self._banned.add(api_key)

    def unban(self, api_key: str) -> None:
        with self._lock:
            self._banned.discard(api_key)

    def is_allowed(self, api_key: str) -> bool:
        with self._lock:
            # O(1) ban check
            if api_key in self._banned:
                return False

            now = time.monotonic()
            # Clean old requests
            reqs = self._requests[api_key]
            cutoff = now - self.window
            self._requests[api_key] = [t for t in reqs if t > cutoff]

            if len(self._requests[api_key]) >= self.max_requests:
                return False

            self._requests[api_key].append(now)
            return True
```

</details>

---

## FAQ

### Q: Are Python sets ordered?

**A:** No. Unlike dicts (which preserve insertion order since Python 3.7), sets do **not** guarantee any order. If you need ordered unique elements, use `dict.fromkeys()`.

### Q: Can I store `None` in a set?

**A:** Yes. `None` is hashable. `{None, 1, 2}` is valid.

### Q: Is `set` or `frozenset` faster?

**A:** For individual operations (add, lookup), they are the same speed. `frozenset` has an advantage when used as a dict key or set element because its hash is cached after first computation.

### Q: How much memory does a set use compared to a list?

**A:** A set uses roughly 4-8x more memory per element than a list, due to hash table overhead (empty slots, hash caching). For 1000 integers: list ~8 KB, set ~32 KB.

### Q: Can I use a set as a dictionary key?

**A:** No — sets are mutable and unhashable. Use `frozenset` instead: `{frozenset({1, 2}): "value"}`.
