# Sets — Optimization Exercises

> Optimize each slow code snippet. Measure the improvement with `timeit`.

---

## Score Card

| # | Difficulty | Topic | Optimized? | Speedup |
|---|:----------:|-------|:----------:|:-------:|
| 1 | Easy | List to set lookup | [ ] | ___x |
| 2 | Easy | Dedup with loop | [ ] | ___x |
| 3 | Easy | Set creation | [ ] | ___x |
| 4 | Medium | Intersection via loop | [ ] | ___x |
| 5 | Medium | Multiple membership checks | [ ] | ___x |
| 6 | Medium | Difference via filter | [ ] | ___x |
| 7 | Medium | Union of many sets | [ ] | ___x |
| 8 | Hard | Large-scale dedup | [ ] | ___x |
| 9 | Hard | Subset check | [ ] | ___x |
| 10 | Hard | Counting unique elements | [ ] | ___x |
| 11 | Hard | Symmetric difference of N sets | [ ] | ___x |

**Total optimized: ___ / 11**

---

## Exercise 1: List Membership to Set Membership

**Difficulty:** Easy

```python
import timeit

# SLOW: O(n) lookup in a list
def check_banned_users_slow(users: list[str], banned: list[str]) -> list[str]:
    """Return users that are banned."""
    result = []
    for user in users:
        if user in banned:  # O(n) per check
            result.append(user)
    return result


users = [f"user_{i}" for i in range(10_000)]
banned = [f"user_{i}" for i in range(0, 10_000, 3)]

slow_time = timeit.timeit(lambda: check_banned_users_slow(users, banned), number=10)
print(f"Slow: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
# FAST: O(1) lookup in a set
def check_banned_users_fast(users: list[str], banned: list[str]) -> list[str]:
    banned_set = set(banned)  # O(n) once
    return [user for user in users if user in banned_set]  # O(1) per check


fast_time = timeit.timeit(lambda: check_banned_users_fast(users, banned), number=10)
print(f"Fast: {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 100-500x
```

**Why it's faster:** Converting the banned list to a set is O(n) once, then each lookup is O(1) instead of O(n).

</details>

---

## Exercise 2: Deduplication with Loop vs Set

**Difficulty:** Easy

```python
import timeit

# SLOW: Dedup with nested check
def deduplicate_slow(items: list[int]) -> list[int]:
    result = []
    for item in items:
        if item not in result:  # O(n) per check in list!
            result.append(item)
    return result


data = list(range(5000)) * 3  # 15,000 items, 5,000 unique

slow_time = timeit.timeit(lambda: deduplicate_slow(data), number=10)
print(f"Slow: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Use set for O(1) seen-check
def deduplicate_fast(items: list[int]) -> list[int]:
    seen: set[int] = set()
    result: list[int] = []
    for item in items:
        if item not in seen:  # O(1) per check
            seen.add(item)
            result.append(item)
    return result


fast_time = timeit.timeit(lambda: deduplicate_fast(data), number=10)
print(f"Fast: {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 50-200x
```

**Why it's faster:** Checking `item not in result` (a list) is O(n). Checking `item not in seen` (a set) is O(1).

</details>

---

## Exercise 3: Set Construction — Literal vs Constructor

**Difficulty:** Easy

```python
import timeit

# SLOW: Using set() constructor with a list
def create_set_slow():
    return set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

slow_time = timeit.timeit(create_set_slow, number=1_000_000)
print(f"Constructor: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Using set literal
def create_set_fast():
    return {1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

fast_time = timeit.timeit(create_set_fast, number=1_000_000)
print(f"Literal: {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 1.5-3x
```

**Why it's faster:** `set([...])` creates a temporary list, then converts it. The literal `{...}` uses the `BUILD_SET` bytecode directly.

</details>

---

## Exercise 4: Manual Intersection vs Set Intersection

**Difficulty:** Medium

```python
import timeit

# SLOW: Manual intersection with nested loops
def find_common_slow(list_a: list[int], list_b: list[int]) -> list[int]:
    common = []
    for item in list_a:
        if item in list_b and item not in common:
            common.append(item)
    return common


a = list(range(10_000))
b = list(range(5_000, 15_000))

slow_time = timeit.timeit(lambda: find_common_slow(a, b), number=5)
print(f"Manual: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Native set intersection
def find_common_fast(list_a: list[int], list_b: list[int]) -> set[int]:
    return set(list_a) & set(list_b)


fast_time = timeit.timeit(lambda: find_common_fast(a, b), number=5)
print(f"Set intersection: {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 100-1000x
```

**Why it's faster:** The manual approach is O(n*m). Set intersection is O(min(n, m)) since both lookups and the intersection algorithm are optimized in C.

</details>

---

## Exercise 5: Repeated Membership Checks

**Difficulty:** Medium

```python
import timeit

# SLOW: Converting to set every time
def process_events_slow(events: list[dict], valid_types: list[str]) -> list[dict]:
    result = []
    for event in events:
        if event["type"] in set(valid_types):  # Creates a new set every iteration!
            result.append(event)
    return result


events = [{"type": f"type_{i % 20}", "data": i} for i in range(100_000)]
valid_types = [f"type_{i}" for i in range(10)]

slow_time = timeit.timeit(lambda: process_events_slow(events, valid_types), number=5)
print(f"Slow: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Create set once, outside the loop
def process_events_fast(events: list[dict], valid_types: list[str]) -> list[dict]:
    valid_set = set(valid_types)  # Create once
    return [event for event in events if event["type"] in valid_set]


fast_time = timeit.timeit(lambda: process_events_fast(events, valid_types), number=5)
print(f"Fast: {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# Typical speedup: 2-10x
```

**Why it's faster:** Creating `set(valid_types)` once outside the loop avoids constructing a new set object for each of the 100,000 iterations.

</details>

---

## Exercise 6: Difference via Filter vs Set Operation

**Difficulty:** Medium

```python
import timeit

# SLOW: Using filter and lambda
def exclude_items_slow(all_items: list[str], exclude: list[str]) -> list[str]:
    return list(filter(lambda x: x not in exclude, all_items))


all_items = [f"item_{i}" for i in range(50_000)]
exclude = [f"item_{i}" for i in range(0, 50_000, 2)]

slow_time = timeit.timeit(lambda: exclude_items_slow(all_items, exclude), number=3)
print(f"Filter: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Set difference
def exclude_items_fast(all_items: list[str], exclude: list[str]) -> set[str]:
    return set(all_items) - set(exclude)


# FAST (preserving order): Set lookup in list comprehension
def exclude_items_fast_ordered(all_items: list[str], exclude: list[str]) -> list[str]:
    exclude_set = set(exclude)
    return [item for item in all_items if item not in exclude_set]


fast_time = timeit.timeit(lambda: exclude_items_fast(all_items, exclude), number=3)
fast_ordered_time = timeit.timeit(lambda: exclude_items_fast_ordered(all_items, exclude), number=3)
print(f"Set diff: {fast_time:.4f}s")
print(f"Set lookup (ordered): {fast_ordered_time:.4f}s")
print(f"Speedup (set diff): {slow_time / fast_time:.1f}x")
print(f"Speedup (ordered): {slow_time / fast_ordered_time:.1f}x")
```

**Why it's faster:** `filter(lambda x: x not in exclude, ...)` checks against a list (O(n) per check). Set difference is O(n+m).

</details>

---

## Exercise 7: Union of Many Sets

**Difficulty:** Medium

```python
import timeit

# SLOW: Accumulating with | operator in a loop
def merge_tags_slow(tag_lists: list[set[str]]) -> set[str]:
    result = set()
    for tags in tag_lists:
        result = result | tags  # Creates a new set each time!
    return result


tag_lists = [{f"tag_{j}" for j in range(i, i + 50)} for i in range(1000)]

slow_time = timeit.timeit(lambda: merge_tags_slow(tag_lists), number=20)
print(f"Slow (| in loop): {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
# FAST v1: Use |= (in-place union)
def merge_tags_fast_inplace(tag_lists: list[set[str]]) -> set[str]:
    result: set[str] = set()
    for tags in tag_lists:
        result |= tags  # Modifies in-place — no new object
    return result

# FAST v2: Use set.union with unpacking
def merge_tags_fast_unpack(tag_lists: list[set[str]]) -> set[str]:
    if not tag_lists:
        return set()
    return set().union(*tag_lists)  # Single C-level call

# FAST v3: Use itertools.chain
from itertools import chain
def merge_tags_fast_chain(tag_lists: list[set[str]]) -> set[str]:
    return set(chain.from_iterable(tag_lists))


inplace_time = timeit.timeit(lambda: merge_tags_fast_inplace(tag_lists), number=20)
unpack_time = timeit.timeit(lambda: merge_tags_fast_unpack(tag_lists), number=20)
chain_time = timeit.timeit(lambda: merge_tags_fast_chain(tag_lists), number=20)

print(f"In-place |=:    {inplace_time:.4f}s (speedup: {slow_time/inplace_time:.1f}x)")
print(f"union(*args):   {unpack_time:.4f}s (speedup: {slow_time/unpack_time:.1f}x)")
print(f"chain + set():  {chain_time:.4f}s (speedup: {slow_time/chain_time:.1f}x)")
```

**Why it's faster:** `result | tags` creates a new set object each iteration. `result |= tags` modifies in place. `set().union(*tag_lists)` does everything in one C-level call.

</details>

---

## Exercise 8: Large-Scale Deduplication

**Difficulty:** Hard

```python
import timeit

# SLOW: Sorting and comparing adjacent elements
def deduplicate_sort(items: list[str]) -> list[str]:
    if not items:
        return []
    sorted_items = sorted(items)
    result = [sorted_items[0]]
    for i in range(1, len(sorted_items)):
        if sorted_items[i] != sorted_items[i - 1]:
            result.append(sorted_items[i])
    return result


# 1M items with ~50% duplicates
import random
random.seed(42)
data = [f"item_{random.randint(0, 500_000)}" for _ in range(1_000_000)]

slow_time = timeit.timeit(lambda: deduplicate_sort(data), number=3)
print(f"Sort-based: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Direct set conversion
def deduplicate_set(items: list[str]) -> set[str]:
    return set(items)

# FAST (preserving order): dict.fromkeys
def deduplicate_ordered(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


set_time = timeit.timeit(lambda: deduplicate_set(data), number=3)
ordered_time = timeit.timeit(lambda: deduplicate_ordered(data), number=3)

print(f"set():           {set_time:.4f}s (speedup: {slow_time/set_time:.1f}x)")
print(f"dict.fromkeys(): {ordered_time:.4f}s (speedup: {slow_time/ordered_time:.1f}x)")
```

**Why it's faster:** Sorting is O(n log n). Set construction is O(n) average. `dict.fromkeys()` is also O(n) and preserves insertion order.

</details>

---

## Exercise 9: Subset Check — Manual vs Built-in

**Difficulty:** Hard

```python
import timeit

# SLOW: Manual subset check
def is_subset_slow(small: set, large: set) -> bool:
    for item in small:
        if item not in large:
            return False
    return True


small_set = set(range(1000))
large_set = set(range(1_000_000))

slow_time = timeit.timeit(lambda: is_subset_slow(small_set, large_set), number=1000)
print(f"Manual loop: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
# FAST: Built-in issubset / <= operator
fast_time_method = timeit.timeit(
    lambda: small_set.issubset(large_set), number=1000
)
fast_time_op = timeit.timeit(
    lambda: small_set <= large_set, number=1000
)

print(f"issubset(): {fast_time_method:.4f}s (speedup: {slow_time/fast_time_method:.1f}x)")
print(f"<= operator: {fast_time_op:.4f}s (speedup: {slow_time/fast_time_op:.1f}x)")
```

**Why it's faster:** `issubset()` is implemented in C with optimizations (e.g., early size check — if `len(small) > len(large)`, immediately return False).

</details>

---

## Exercise 10: Counting Unique Elements in Chunks

**Difficulty:** Hard

```python
import timeit

# SLOW: Process all at once, then count
def count_unique_slow(chunks: list[list[int]]) -> int:
    all_items = []
    for chunk in chunks:
        all_items.extend(chunk)
    return len(set(all_items))


chunks = [list(range(i, i + 10_000)) for i in range(0, 100_000, 100)]

slow_time = timeit.timeit(lambda: count_unique_slow(chunks), number=10)
print(f"Extend all then set: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
from itertools import chain

# FAST v1: Build set incrementally
def count_unique_fast_incremental(chunks: list[list[int]]) -> int:
    unique: set[int] = set()
    for chunk in chunks:
        unique.update(chunk)
    return len(unique)

# FAST v2: chain.from_iterable
def count_unique_fast_chain(chunks: list[list[int]]) -> int:
    return len(set(chain.from_iterable(chunks)))


inc_time = timeit.timeit(lambda: count_unique_fast_incremental(chunks), number=10)
chain_time = timeit.timeit(lambda: count_unique_fast_chain(chunks), number=10)

print(f"Incremental update: {inc_time:.4f}s (speedup: {slow_time/inc_time:.1f}x)")
print(f"chain + set:        {chain_time:.4f}s (speedup: {slow_time/chain_time:.1f}x)")
```

**Why it's faster:** The slow version builds a massive list first (O(n) memory for `all_items`), then creates a set. The fast versions avoid the intermediate list entirely. `set.update()` adds elements in-place, and `chain.from_iterable()` lazily iterates without materializing the full list.

</details>

---

## Exercise 11: Symmetric Difference of N Sets

**Difficulty:** Hard

```python
import timeit
from functools import reduce

# SLOW: Pairwise symmetric difference with reduce (creates many intermediate sets)
def symmetric_diff_slow(sets: list[set[int]]) -> set[int]:
    return reduce(lambda a, b: a ^ b, sets)


# 100 sets, each with 10,000 elements
test_sets = [set(range(i, i + 10_000)) for i in range(0, 1_000_000, 10_000)]

slow_time = timeit.timeit(lambda: symmetric_diff_slow(test_sets), number=10)
print(f"Reduce ^: {slow_time:.4f}s")
```

<details>
<summary>Optimized Solution</summary>

```python
from collections import Counter
from itertools import chain

# FAST: Count occurrences, keep odd-count elements
def symmetric_diff_fast(sets: list[set[int]]) -> set[int]:
    counts: dict[int, int] = {}
    for s in sets:
        for elem in s:
            counts[elem] = counts.get(elem, 0) + 1
    return {elem for elem, count in counts.items() if count % 2 == 1}


# FAST v2: Using Counter
def symmetric_diff_counter(sets: list[set[int]]) -> set[int]:
    counts = Counter(chain.from_iterable(sets))
    return {elem for elem, count in counts.items() if count % 2 == 1}


fast_time = timeit.timeit(lambda: symmetric_diff_fast(test_sets), number=10)
counter_time = timeit.timeit(lambda: symmetric_diff_counter(test_sets), number=10)

print(f"Manual count: {fast_time:.4f}s (speedup: {slow_time/fast_time:.1f}x)")
print(f"Counter:      {counter_time:.4f}s (speedup: {slow_time/counter_time:.1f}x)")
```

**Why it's faster:** `reduce` with `^` creates N-1 intermediate sets, each potentially large. The counting approach iterates all elements once (O(total elements)) and filters by parity.

</details>
