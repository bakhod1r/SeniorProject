# Linear Search — Specification

## Table of Contents

1. [Algorithm Reference](#algorithm-reference)
2. [Public API](#public-api)
3. [Core Rules](#core-rules)
4. [Language-Specific Functions](#language-specific-functions)
5. [Edge Cases](#edge-cases)
6. [Compliance Checklist](#compliance-checklist)
7. [Conformance Tests](#conformance-tests)

---

## Algorithm Reference

**Name:** Linear Search (a.k.a. Sequential Search)

**Inputs:**
- `arr`: an iterable / array of elements of type `T`.
- `target`: a value of type `T` (or a predicate `T -> bool`).

**Output:**
- The **first** index `i` such that `arr[i] == target` (or `predicate(arr[i])` is `true`).
- A sentinel ("not found") value if no such index exists.

**Pseudocode:**

```
function linear_search(arr, target):
    for i from 0 to length(arr) - 1:
        if equal(arr[i], target):
            return i
    return NOT_FOUND
```

**Complexity:**
- Time: O(n) worst, O(1) best, O(n) average.
- Space: O(1).
- Comparisons: ≤ n.

**Determinism:** Yes. Same input → same output.

---

## Public API

### Canonical Signature

```text
linear_search(arr: Sequence[T], target: T) -> int
    Returns: index of first occurrence of target, or -1 if absent.
    Raises:  TypeError if arr is None / not iterable.
    O(n) time, O(1) space.
```

### Variants

```text
linear_search_all(arr: Sequence[T], target: T) -> List[int]
    Returns: list of all indices where target appears (possibly empty).
    O(n) time, O(k) space (k = match count).

linear_search_last(arr: Sequence[T], target: T) -> int
    Returns: index of LAST occurrence, or -1.
    O(n) time, O(1) space.

linear_search_predicate(arr: Sequence[T], pred: Callable[[T], bool]) -> int
    Returns: index of first element where pred(element) is True, or -1.
    O(n) time + cost of predicate per call.

linear_search_count(arr: Sequence[T], target: T) -> int
    Returns: count of occurrences (0 if absent).
    O(n) time, O(1) space.
```

---

## Core Rules

| # | Rule | Rationale |
|---|------|-----------|
| 1 | **Iterate left-to-right** by default. | Stable, deterministic, matches all stdlibs. |
| 2 | **Return first match.** | Standard contract; "find any" is ambiguous. |
| 3 | **Return sentinel for absent.** Use `-1` (int sentinel), `None` / `null`, `Optional.empty()`, or `(zero_value, false)` per language idioms. | Distinguishes "not found" from "found at index 0." |
| 4 | **Use the language's equality operator.** `==` for primitives; `.equals()` / `__eq__` / value semantics for objects. | Predictable, leverages user-defined equality. |
| 5 | **Stop on first match (early exit).** | Halves average comparisons; required for correctness if "first" is the contract. |
| 6 | **Do not mutate `arr`** (except in documented sentinel-search variants). | Pure functions are testable and thread-safe. |
| 7 | **Handle empty array** by returning the sentinel. No exception. | Empty is a valid input. |
| 8 | **Handle null `arr`** with explicit error (or treat as empty — be consistent in your library). | Avoid silent NPEs. |
| 9 | **Be O(1) auxiliary space.** | The whole point of linear search; do not allocate proportional to n. |
| 10 | **Document the not-found sentinel** in the API contract. | Caller needs to know whether to check `== -1`, `is None`, etc. |

---

## Language-Specific Functions

### Python

```python
# Membership test (linear search, returns bool)
target in arr                              # → bool, O(n) for list, O(1) for set/dict

# Find first index (linear search, raises on absent)
arr.index(target)                          # → int, raises ValueError if absent
arr.index(target, start, end)              # search slice [start, end)

# Count occurrences
arr.count(target)                          # → int, 0 if absent, O(n)

# Predicate search via generator
next((i for i, x in enumerate(arr) if pred(x)), -1)

# Functional style
from itertools import takewhile
import operator
```

| API | Returns | On Absent |
|-----|---------|-----------|
| `x in arr` | bool | `False` |
| `arr.index(x)` | int | raises `ValueError` |
| `arr.count(x)` | int | `0` |

### Java

```java
import java.util.*;

// List
list.contains(target)                      // → boolean
list.indexOf(target)                       // → int, -1 if absent
list.lastIndexOf(target)                   // → int, -1 if absent

// Arrays
Arrays.asList(arr).indexOf(target)         // boxed; O(n)
Arrays.stream(arr).anyMatch(x -> x == target)   // boolean

// Collections
Collections.frequency(coll, target)        // → int count

// Stream API (predicate-based)
list.stream()
    .filter(x -> x.getAge() > 30)
    .findFirst()                           // → Optional<T>
```

| API | Returns | On Absent |
|-----|---------|-----------|
| `list.contains(o)` | boolean | `false` |
| `list.indexOf(o)` | int | `-1` |
| `stream.findFirst()` | `Optional<T>` | `Optional.empty()` |

### Go

```go
import "slices"   // requires Go 1.21+

slices.Contains(s, v)                      // → bool
slices.Index(s, v)                         // → int, -1 if absent
slices.IndexFunc(s, func(x T) bool { ... }) // predicate-based

// Pre-Go 1.21: hand-roll
for i, x := range s {
    if x == v { return i }
}

// Bytes: SIMD-accelerated
import "bytes"
bytes.IndexByte(b, byte('a'))              // → int, -1 if absent
```

| API | Returns | On Absent |
|-----|---------|-----------|
| `slices.Contains` | bool | `false` |
| `slices.Index` | int | `-1` |
| `bytes.IndexByte` | int | `-1` |

### JavaScript / TypeScript

```javascript
arr.indexOf(target)                        // → number, -1 if absent (uses ===)
arr.lastIndexOf(target)                    // → number, -1 if absent
arr.includes(target)                       // → boolean (uses SameValueZero, handles NaN)
arr.find(predicate)                        // → element or undefined
arr.findIndex(predicate)                   // → number, -1 if absent
arr.findLast(predicate)                    // → element or undefined  (ES2023)
arr.findLastIndex(predicate)               // → number, -1 if absent  (ES2023)
arr.some(predicate)                        // → boolean
```

| API | Returns | On Absent | Equality |
|-----|---------|-----------|----------|
| `indexOf` | number | `-1` | `===` (NaN never matches) |
| `includes` | boolean | `false` | SameValueZero (NaN matches) |
| `findIndex` | number | `-1` | predicate |

### Rust

```rust
use std::iter::Iterator;

vec.contains(&target)                      // → bool
vec.iter().position(|&x| x == target)      // → Option<usize>
vec.iter().find(|&&x| x > 5)               // → Option<&T>
vec.iter().any(|&x| x == target)           // → bool

// memchr crate for SIMD byte search
memchr::memchr(byte, &haystack)            // → Option<usize>
```

### C++

```cpp
#include <algorithm>

std::find(v.begin(), v.end(), target)              // → iterator, end() if absent
std::find_if(v.begin(), v.end(), pred)             // → iterator, end() if absent
std::count(v.begin(), v.end(), target)             // → ptrdiff_t
std::any_of(v.begin(), v.end(), pred)              // → bool

// Distance
auto it = std::find(v.begin(), v.end(), target);
auto idx = (it == v.end()) ? -1 : std::distance(v.begin(), it);
```

### C

```c
#include <string.h>
char* strchr(const char* s, int c);                // → ptr or NULL, O(n)
char* strstr(const char* h, const char* needle);   // → ptr or NULL, O(n*m) naive
void* memchr(const void* s, int c, size_t n);      // SIMD-optimized

// For arbitrary types, hand-roll:
for (size_t i = 0; i < n; i++) {
    if (arr[i] == target) return (long)i;
}
return -1;
```

---

## Edge Cases

| Case | Expected Behavior | Notes |
|------|-------------------|-------|
| Empty array | Return -1 (or `false`) | No comparisons performed |
| Single element matching | Return 0 | One comparison |
| Single element non-matching | Return -1 | One comparison |
| Target at index 0 | Return 0 | Best case (1 comparison) |
| Target at last index | Return n-1 | Worst case (n comparisons) |
| Target absent | Return -1 | Worst case (n comparisons) |
| All elements equal target | Return 0 | First match wins |
| All elements equal, target different | Return -1 | n comparisons |
| Duplicate occurrences | Return **first** index | Per contract |
| `null` / `None` array | Raise `TypeError`/`NPE` (or treat as empty per library policy) | Document choice |
| `null` / `None` element with non-null target | Skip; not equal | No exception |
| `null` / `None` target with `null` element | Match (in most languages) | `None == None` is True |
| NaN target with NaN element | **Mismatch** with `==`; **match** with `Object.equals` / `SameValueZero` | IEEE-754 quirk |
| Floating point near-equality | Use tolerance, not `==` | `abs(a - b) < eps` |
| Mutation during iteration | Undefined / `ConcurrentModificationException` / panic | Don't do it |
| Very large array (n > 10^9) | May exceed `int32` index — use `int64`/`size_t` | Watch for overflow |
| Custom comparator | Provide `Comparator` / `__eq__` / `Eq` impl | Test for symmetry & transitivity |

---

## Compliance Checklist

Use this checklist when implementing `linear_search` for a library or production codebase:

### API Contract

- [ ] Function returns `int` (index) — not `bool`.
- [ ] Sentinel value (`-1` / `None` / `Optional.empty()`) is documented.
- [ ] Empty array returns sentinel without exception.
- [ ] Null array policy is explicit (raise vs. return sentinel).
- [ ] Function name is consistent with language idioms (`find`, `index`, `indexOf`, etc.).

### Behavior

- [ ] Returns the **first** match (leftmost).
- [ ] Stops scanning on first match (early exit).
- [ ] Does not mutate the input array.
- [ ] Uses idiomatic equality for `T` (`==` / `.equals()` / `__eq__`).
- [ ] Handles `null` / `None` elements correctly.
- [ ] Handles NaN per documented contract.

### Performance

- [ ] O(n) worst case, O(1) auxiliary space.
- [ ] No allocation inside the loop.
- [ ] Inlinable / monomorphizable for hot paths.
- [ ] SIMD-accelerated for byte/int arrays where the language allows.

### Robustness

- [ ] Tested with empty, single-element, all-match, no-match, duplicates.
- [ ] Tested with negative indices and very large arrays.
- [ ] Thread-safe for concurrent reads (no shared mutable state).
- [ ] Documented as **not** thread-safe for concurrent writes.

### Documentation

- [ ] Big-O is documented.
- [ ] Sentinel value is documented in javadoc / docstring / godoc.
- [ ] Examples cover found and not-found cases.
- [ ] When to prefer `HashSet.contains` over linear `contains` is mentioned.

---

## Conformance Tests

A reference test suite (pseudocode):

```python
def test_linear_search_compliance():
    # Empty
    assert linear_search([], 5) == -1

    # Single match
    assert linear_search([5], 5) == 0

    # Single mismatch
    assert linear_search([3], 5) == -1

    # First position
    assert linear_search([5, 1, 2], 5) == 0

    # Last position
    assert linear_search([1, 2, 5], 5) == 2

    # Middle
    assert linear_search([1, 5, 2], 5) == 1

    # Duplicates → first
    assert linear_search([5, 5, 5], 5) == 0

    # Absent
    assert linear_search([1, 2, 3], 9) == -1

    # All match
    assert linear_search([5, 5, 5, 5], 5) == 0

    # All match, different target
    assert linear_search([5, 5, 5, 5], 1) == -1

    # Stability: returns leftmost
    assert linear_search(['a', 'b', 'a'], 'a') == 0

    # Strings
    assert linear_search(['hello', 'world'], 'world') == 1

    # None / null handling
    assert linear_search([None, 1, 2], None) == 0

    # Negative numbers
    assert linear_search([-3, -1, -2], -1) == 1

    # Large array
    big = list(range(1_000_000))
    assert linear_search(big, 999_999) == 999_999
    assert linear_search(big, -1) == -1
```

A library passing all tests above is considered **specification-compliant** for the canonical `linear_search` contract.
