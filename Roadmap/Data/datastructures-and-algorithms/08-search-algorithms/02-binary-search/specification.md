# Binary Search — Specification & Reference

> **Audience:** Anyone reading this in five years to remember exactly what binary search guarantees and which language API to call. This is the canonical reference; treat it as the spec sheet.

---

## 1. Algorithm Reference

**Name.** Binary Search (a.k.a. half-interval search, logarithmic search, binary chop).

**Inputs.**
- A sorted indexable sequence `A` of length `n`, sorted in non-decreasing order with respect to a total-order comparator `cmp`.
- A query value `t` of the same comparable type.

**Output.**
- An integer `i ∈ [0, n)` such that `A[i] = t` (exact-search variant), **or** the conventional "not found" value (`-1` in Go/Java/Python by convention; an `Optional` in some APIs).
- Variants return `lower_bound`, `upper_bound`, or insertion point instead.

**Time complexity.** `O(log n)` worst case. Best case `O(1)`. Average case `O(log n)`.

**Space complexity.** `O(1)` iterative. `O(log n)` recursive (call-stack depth).

**Worst-case comparison count.** `⌈log₂(n + 1)⌉`.

**Required preconditions.**
- `A` is sorted in the order expected by `cmp`.
- `cmp` is a total order: trichotomy (`<`, `=`, `>` are mutually exclusive and exhaustive) and transitivity.
- `A` supports O(1) random access by index (arrays, slices, `ArrayList`; **not** linked lists).

**Allowed but unusual inputs.**
- Empty array (`n = 0`): always returns "not found" / insertion point 0.
- Single-element array: works correctly.
- Arrays with duplicate keys: exact search returns *some* matching index; use `lower_bound` / `upper_bound` for first / last.

---

## 2. API

### 2.1 Generic specification

```
function binary_search(A: SortedSequence<T>, t: T, cmp: (T, T) -> int) -> Index | NotFound
    Precondition: ∀i. cmp(A[i], A[i+1]) ≤ 0
    Postcondition (success): cmp(A[result], t) = 0
    Postcondition (failure): ∀i. cmp(A[i], t) ≠ 0
```

### 2.2 Variant signatures

```
exact_search(A, t)        -> Index | -1                  # any matching index
lower_bound(A, t)         -> Index ∈ [0, n]              # smallest i with A[i] ≥ t
upper_bound(A, t)         -> Index ∈ [0, n]              # smallest i with A[i] > t
insertion_point(A, t)     -> Index ∈ [0, n]              # alias for lower_bound
find_first(A, t)          -> Index | -1                  # smallest i with A[i] = t
find_last(A, t)           -> Index | -1                  # largest i with A[i] = t
count(A, t)               -> int                          # upper_bound - lower_bound
range(A, t)               -> [Index, Index]              # [first, last] of equal run
```

### 2.3 Predicate variant

```
find_first_true(lo, hi, p: Index -> bool) -> Index ∈ [lo, hi]
    Precondition: p is monotonic on [lo, hi]: p(i) = true ⇒ p(j) = true for all j ≥ i
    Postcondition: result is the smallest i ∈ [lo, hi] with p(i) = true (or hi if none)
```

---

## 3. Core Rules

### 3.1 The input MUST be sorted

If `A` is not sorted with respect to `cmp`, the result is **undefined**. No language's standard library checks this — the cost (O(n)) would defeat the purpose. It is the caller's responsibility.

**Mitigation.** In debug builds, assert sortedness:
- Python: `assert all(a <= b for a, b in zip(A, A[1:]))`
- Go: use `slices.IsSorted` before calling `slices.BinarySearch`
- Java: use `Arrays.stream(A).reduce((a, b) -> { assert a <= b; return b; })` or a guard helper

In production, **trust your data invariants** — the array came from a sort or from an inherently sorted source (timestamps, monotonic IDs, append-only logs).

### 3.2 The comparator MUST define a total order

Properties required:
- **Reflexivity:** `cmp(x, x) = 0`.
- **Antisymmetry:** `cmp(x, y) = -cmp(y, x)`.
- **Transitivity:** if `cmp(x, y) ≤ 0` and `cmp(y, z) ≤ 0`, then `cmp(x, z) ≤ 0`.
- **Trichotomy:** exactly one of `<`, `=`, `>` holds for every pair.

**Common violations:**
- Floating-point `NaN` violates trichotomy (`NaN < x`, `NaN = x`, `NaN > x` are all false). Filter out NaN before searching, or use a comparator like `Float.compare` / `math.NaN-aware` ordering that places NaN at one end.
- Comparing structures by a subset of fields and assuming uniqueness (e.g., comparing only the timestamp when two events can share a timestamp) — leads to `0` being returned for distinct elements; binary search may return *any* such index.
- Locale-dependent string comparison that changes between sort time and search time (different `LC_COLLATE`).

### 3.3 The result of `binary_search` is one matching index, not necessarily the first

`Arrays.binarySearch` (Java), `slices.BinarySearch` (Go), and `bisect_left`/`bisect_right` (Python) have **distinct contracts**. Read the table in §4.

### 3.4 `upper_bound - lower_bound = count of equal elements`

Always. This identity is the safest way to count occurrences without iterating.

---

## 4. Language-Specific APIs

### 4.1 Python — `bisect` module

```python
from bisect import bisect_left, bisect_right, insort_left, insort_right

bisect_left(a, x, lo=0, hi=len(a), *, key=None)
    # Smallest i in [lo, hi) such that a[i] >= x.
    # If x is present, returns the index of the leftmost occurrence.
bisect_right(a, x, lo=0, hi=len(a), *, key=None)
    # Smallest i in [lo, hi) such that a[i] > x.
insort_left(a, x, lo=0, hi=len(a), *, key=None)
    # Insert x into a in sorted order, before any equal elements.
insort_right(a, x, lo=0, hi=len(a), *, key=None)
    # Insert x after any equal elements.
```

- **Returns:** integer in `[0, len(a)]`. Never throws `KeyError` or `ValueError`.
- **Edge cases:** empty list returns `0`. Out-of-range `lo`/`hi` raises `ValueError`.
- **`key=` parameter** added in Python 3.10 — sorts/searches by `key(element)` like `sorted(..., key=...)`. `bisect_left(a, x, key=lambda r: r.timestamp)`.

**Idiom for exact search:**
```python
i = bisect_left(a, x)
found = i != len(a) and a[i] == x
```

### 4.2 Java — `Arrays` and `Collections`

```java
int Arrays.binarySearch(int[] a, int key)
int Arrays.binarySearch(int[] a, int fromIndex, int toIndex, int key)
int Arrays.binarySearch(Object[] a, Object key)
<T> int Arrays.binarySearch(T[] a, T key, Comparator<? super T> c)
// Same for long[], double[], float[], char[], byte[], short[].

<T> int Collections.binarySearch(List<? extends Comparable<? super T>> list, T key)
<T> int Collections.binarySearch(List<? extends T> list, T key, Comparator<? super T> c)
```

- **Returns:** if found, the index of any matching element (no guarantee of first/last/middle when duplicates exist). If not found, `-(insertion_point) - 1`.
- **Recovering insertion point:** `int ip = -result - 1;`
- **Comparator must be consistent with equals** (otherwise behavior is undefined).
- **Performance note:** `Collections.binarySearch(List, ...)` runs in O(log n) for `RandomAccess` lists (`ArrayList`) and **O(n)** for non-random-access lists (`LinkedList`).
- **No first/last variants in standard library.** Use `TreeMap.floorKey` / `ceilingKey` / `firstKey` / `lastKey` from `NavigableMap` for similar semantics.

**Idiom:**
```java
int idx = Arrays.binarySearch(a, key);
if (idx < 0) {
    int insertionPoint = -idx - 1;
    // not found; insertionPoint is where to insert
}
```

### 4.3 Go — `sort` and `slices` packages

```go
// Generic (Go 1.21+, recommended)
import "slices"
func slices.BinarySearch[S ~[]E, E cmp.Ordered](x S, target E) (int, bool)
func slices.BinarySearchFunc[S ~[]E, E, T any](x S, target T, cmp func(E, T) int) (int, bool)

// Older API (still supported)
import "sort"
func sort.SearchInts(a []int, x int) int             // lower_bound semantics
func sort.SearchStrings(a []string, x string) int
func sort.SearchFloat64s(a []float64, x float64) int
func sort.Search(n int, f func(int) bool) int        // generic predicate search
```

- **`slices.BinarySearch` returns `(index, found)`.** If `found`, `index` is any matching position. If not, `index` is the insertion point (lower-bound semantics).
- **`sort.Search(n, f)` returns** the smallest `i ∈ [0, n]` such that `f(i) == true`. The "find first true" template.
- **Comparator for `BinarySearchFunc`:** returns negative / zero / positive (like `strings.Compare`).

**Idiom (modern):**
```go
idx, found := slices.BinarySearch(a, target)
if !found {
    // idx is the insertion point
}
```

**Idiom (classic):**
```go
idx := sort.SearchInts(a, target)
if idx < len(a) && a[idx] == target {
    // found at idx
}
```

### 4.4 C++ — `<algorithm>`

```cpp
template <class It, class T>
bool   std::binary_search(It first, It last, const T& value);   // returns bool only!
template <class It, class T>
It     std::lower_bound  (It first, It last, const T& value);   // iterator to first >= value
template <class It, class T>
It     std::upper_bound  (It first, It last, const T& value);   // iterator to first > value
template <class It, class T>
auto   std::equal_range  (It first, It last, const T& value);   // {lower, upper} pair
```

- **`std::binary_search` returns only `bool`** — to get the index, use `std::lower_bound` and check.
- All four take an optional comparator: `std::lower_bound(first, last, value, cmp)`.
- **C++20:** the `<ranges>` versions: `std::ranges::binary_search`, `std::ranges::lower_bound`, etc.
- For non-random-access iterators (e.g., `std::list`), runs in O(n) iterator advances although still O(log n) comparisons. Effectively O(n) total. Avoid.

**Idiom:**
```cpp
auto it = std::lower_bound(v.begin(), v.end(), target);
if (it != v.end() && *it == target) {
    size_t idx = it - v.begin();
    // found
}
```

### 4.5 Rust — `slice` methods

```rust
impl<T: Ord> [T] {
    fn binary_search(&self, x: &T) -> Result<usize, usize>;
    fn binary_search_by<F>(&self, f: F) -> Result<usize, usize>
        where F: FnMut(&T) -> Ordering;
    fn binary_search_by_key<B, F>(&self, b: &B, f: F) -> Result<usize, usize>
        where F: FnMut(&T) -> B, B: Ord;
    fn partition_point<P>(&self, pred: P) -> usize
        where P: FnMut(&T) -> bool;     // first index where pred is false
}
```

- **`Result<usize, usize>`:** `Ok(idx)` if found (any matching index), `Err(insertion_point)` if not.
- **`partition_point`** is the "find first false" version of the predicate template.

---

## 5. Edge Cases — Specification

| Case | `A` | `t` | Expected |
|---|---|---|---|
| Empty | `[]` | anything | not found / insertion 0 |
| Single match | `[5]` | 5 | index 0 |
| Single no-match | `[5]` | 3 | not found / insertion 0 |
| Single no-match (greater) | `[5]` | 7 | not found / insertion 1 |
| All elements smaller than t | `[1, 2, 3]` | 9 | not found / insertion 3 |
| All elements greater than t | `[7, 8, 9]` | 1 | not found / insertion 0 |
| Target equals all | `[5, 5, 5]` | 5 | exact: any of 0,1,2; first: 0; last: 2 |
| Duplicates with target | `[1, 5, 5, 5, 9]` | 5 | first: 1; last: 3 |
| Sentinel min | `[INT_MIN, 0, INT_MAX]` | INT_MIN | 0 |
| Sentinel max | `[INT_MIN, 0, INT_MAX]` | INT_MAX | 2 |
| Float NaN in data | undefined | undefined | UNDEFINED — filter NaN first |
| Custom comparator returning `0` for non-equal items | undefined | undefined | UNDEFINED — fix comparator |

---

## 6. Compliance Checklist

Before deploying any custom binary search to production, verify:

- [ ] Loop uses `lo + (hi - lo) / 2` for `mid` (overflow-safe).
- [ ] Bound style is consistent throughout (`[lo, hi]` inclusive **or** `[lo, hi)` half-open, not mixed).
- [ ] Loop terminates in all paths (each iteration strictly decreases `hi - lo`).
- [ ] Empty array returns the correct sentinel (-1 or insertion point 0).
- [ ] Single-element array works (both match and no-match).
- [ ] Target equal to first / last element returns the correct index.
- [ ] Duplicates: documented whether you return first, last, or any.
- [ ] Comparator is total (no `NaN` issues, transitivity verified).
- [ ] Input sortedness is enforced or asserted in debug.
- [ ] Recursive variant has tail-call optimization or bounded depth (`O(log n)` is fine).
- [ ] Returns the **insertion point** (or sentinel) when not found, per documented contract.
- [ ] Tested against the language's standard library on a randomized property test (10,000 inputs).
- [ ] Performance benchmarked vs. `Arrays.binarySearch` / `bisect_left` / `slices.BinarySearch` — your custom version should be no slower.
- [ ] If custom predicate ("find first true"), the predicate is monotonic on the search range.

---

## 7. Common Specification Confusions

### "Why does Java's `Arrays.binarySearch` return a negative number?"

It encodes the insertion point so that **one return value** carries both "not found" and "where to insert". The encoding `-(ip) - 1` (instead of just `-ip`) is needed because insertion point `0` would otherwise collide with the valid index `0`. Decode: `ip = -result - 1`.

This is more compact than returning a tuple but error-prone — if you forget to negate, you get bizarre indices into the negative half of the array.

### "Why doesn't `bisect_left` return whether the element was found?"

By design: the caller can check `a[i] == t` in O(1). Returning a bool would force allocations on JVM-style platforms; in Python it would be a tuple. The `bisect` module prioritizes simplicity and speed.

### "Why does `slices.BinarySearch` return `(int, bool)`?"

Go style — "two return values, the second one a status". Idiomatic in Go (see `map["key"]`, `os.Open`, etc.). The bool removes ambiguity at zero cost.

### "Why does `std::binary_search` return only `bool`?"

Historical accident in the C++98 standard library. To get the index, use `std::lower_bound` and check. The committee has not deprecated `std::binary_search` because of backward compatibility, but the standard recommendation is to use `std::lower_bound`.

### "Why does `Collections.binarySearch` accept a `List` and run in O(n) on `LinkedList`?"

Because the `List` interface doesn't distinguish random-access from sequential-access. `Collections.binarySearch` does dispatch on `RandomAccess` and uses an iterator-based variant for non-random-access lists, which performs O(log n) comparisons but O(n) total time. Avoid binary-searching a `LinkedList`; convert to an array first or use a different structure.

---

## 8. Reference Card

```
LANGUAGE        EXACT-SEARCH                        LOWER_BOUND                   "FIND FIRST TRUE"
Python          (manual; bisect_left + check)       bisect_left(a, t)             (manual loop)
Java            Arrays.binarySearch(a, t)           (manual loop or stream)       (manual loop)
Go              slices.BinarySearch(a, t)           sort.SearchInts(a, t)         sort.Search(n, f)
C++             (manual; lower_bound + check)       std::lower_bound(b, e, t)     (manual loop)
Rust            slice::binary_search(&[T], &t)      slice::partition_point(p)     slice::partition_point(p)

RETURN ON NOT FOUND
Python          insertion point (just an int)
Java            -(insertion point) - 1
Go              (insertion point, false)
C++             iterator pointing at insertion point (== end() if past last)
Rust            Err(insertion point)
```

---

## 9. Versioning Notes

- **Python `bisect.key=`** added in 3.10 (October 2021). Earlier versions need `[key(x) for x in a]` projection.
- **Go `slices.BinarySearch`** added in 1.21 (August 2023). Earlier versions use `sort.Search`/`sort.SearchInts`.
- **Java `Arrays.binarySearch`** present since 1.2 (1998). Overflow-safe `mid` calculation fixed in JDK 6 (2006).
- **C++ `<ranges>` binary search** added in C++20 (2020).
- **Rust `partition_point`** stabilized in 1.52 (May 2021).

If your project supports older runtimes, fall back to manual implementations or `bisect_left` / `sort.Search` / `Collections.binarySearch` with manual key projection.
