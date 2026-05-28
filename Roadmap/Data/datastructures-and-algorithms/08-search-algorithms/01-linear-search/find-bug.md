# Linear Search — Find the Bug

12 buggy implementations. Find the bug, explain it, and write the fix. Each bug is realistic — drawn from real-world code reviews and Stack Overflow questions.

## Table of Contents

1. [Bug 1 — Off-by-One Loop Bound](#bug-1-off-by-one-loop-bound)
2. [Bug 2 — Returning bool Instead of Index](#bug-2-returning-bool-instead-of-index)
3. [Bug 3 — Missing Not-Found Case](#bug-3-missing-not-found-case)
4. [Bug 4 — NaN Silent Failure](#bug-4-nan-silent-failure)
5. [Bug 5 — Mutation During Iteration](#bug-5-mutation-during-iteration)
6. [Bug 6 — Recursive Stack Overflow](#bug-6-recursive-stack-overflow)
7. [Bug 7 — Parallel Race Condition](#bug-7-parallel-race-condition)
8. [Bug 8 — Comparator Symmetry Violation](#bug-8-comparator-symmetry-violation)
9. [Bug 9 — Returns Last Instead of First](#bug-9-returns-last-instead-of-first)
10. [Bug 10 — Case-Sensitive String Search](#bug-10-case-sensitive-string-search)
11. [Bug 11 — Integer Overflow in Counter](#bug-11-integer-overflow-in-counter)
12. [Bug 12 — Generic Type Bounds](#bug-12-generic-type-bounds)

---

## Bug 1 — Off-by-One Loop Bound

### Buggy — Go
```go
func LinearSearch(arr []int, target int) int {
    for i := 0; i <= len(arr); i++ {  // ← BUG
        if arr[i] == target {
            return i
        }
    }
    return -1
}
```

### Buggy — Java
```java
public static int linearSearch(int[] arr, int target) {
    for (int i = 0; i <= arr.length; i++) {  // ← BUG
        if (arr[i] == target) return i;
    }
    return -1;
}
```

### Buggy — Python
```python
def linear_search(arr, target):
    for i in range(len(arr) + 1):  # ← BUG
        if arr[i] == target:
            return i
    return -1
```

### Bug
Loop bound is `<= len(arr)` (inclusive) instead of `< len(arr)` (exclusive). The last iteration accesses `arr[len(arr)]` — **index out of bounds**. In Go: panic. In Java: `ArrayIndexOutOfBoundsException`. In Python: `IndexError`.

### Fix
Use `<` (Go/Java) or `range(len(arr))` (Python).

```go
for i := 0; i < len(arr); i++ { ... }
```

### Lesson
Off-by-one is the most common bug in linear search. Use `for x := range arr` (Go) or `enumerate(arr)` (Python) to eliminate the index entirely when possible.

---

## Bug 2 — Returning bool Instead of Index

### Buggy — Go
```go
func LinearSearch(arr []int, target int) bool {
    for _, v := range arr {
        if v == target {
            return true
        }
    }
    return false
}

// Caller:
idx := LinearSearch(arr, 5)  // ← compile error or wrong type
arr[idx] = 99                 // even if it compiled, semantics are wrong
```

### Buggy — Java
```java
public static boolean linearSearch(int[] arr, int target) {
    for (int v : arr) {
        if (v == target) return true;
    }
    return false;
}
```

### Buggy — Python
```python
def linear_search(arr, target):
    for v in arr:
        if v == target:
            return True
    return False
```

### Bug
The function returns a `bool` (`true`/`false` for present/absent), but the caller often needs the **index** to read or modify the element. Once you've thrown away the index, the caller must do their own linear search.

### Fix
Return the index (`-1` if absent). The caller can derive a bool with `idx >= 0`.

```python
def linear_search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1
```

### Lesson
**Return more information, not less.** Indices are richer than booleans; let the caller throw away what they don't need.

---

## Bug 3 — Missing Not-Found Case

### Buggy — Go
```go
func LinearSearch(arr []int, target int) int {
    for i, v := range arr {
        if v == target {
            return i
        }
    }
    // ← BUG: no return statement
}
```

(Go won't compile — but the bug shape is real in JavaScript/TypeScript.)

### Buggy — JavaScript
```javascript
function linearSearch(arr, target) {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === target) {
            return i;
        }
    }
    // ← BUG: returns undefined for not-found
}

// Caller:
const idx = linearSearch([1, 2, 3], 9);   // → undefined
arr[idx];                                  // → undefined (but no error)
if (idx === -1) { ... }                    // → never true!
```

### Buggy — Python
```python
def linear_search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    # ← BUG: returns None for not-found

idx = linear_search([1, 2, 3], 9)   # → None
if idx >= 0:                         # → TypeError: '>=' not supported with 'NoneType'
    ...
```

### Bug
Forgetting the `return -1` after the loop. In statically-typed languages, the compiler catches it. In dynamic languages, the function silently returns `undefined` / `None`, breaking callers that assume an integer.

### Fix
Always have an explicit `return -1` after the loop.

```python
def linear_search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1   # ← required
```

### Lesson
Document and **enforce** the return type. In TypeScript: `function linearSearch(...): number`. In Python: type hints + mypy. Don't rely on duck typing for sentinel values.

---

## Bug 4 — NaN Silent Failure

### Buggy — Python
```python
import math

arr = [1.0, 2.0, math.nan, 4.0]

def linear_search(arr, target):
    for i, v in enumerate(arr):
        if v == target:    # ← BUG when target is NaN
            return i
    return -1

print(linear_search(arr, math.nan))   # → -1, but NaN IS in the array!
```

### Buggy — Java
```java
double[] arr = {1.0, 2.0, Double.NaN, 4.0};
double target = Double.NaN;

for (int i = 0; i < arr.length; i++) {
    if (arr[i] == target) {   // ← always false for NaN
        return i;
    }
}
return -1;   // → -1, even though NaN is at index 2
```

### Buggy — JavaScript
```javascript
const arr = [1, 2, NaN, 4];
arr.indexOf(NaN);    // → -1 (uses ===, NaN === NaN is false)
```

### Bug
IEEE-754 specifies `NaN != NaN`. Any comparison involving NaN returns `false`, so equality-based search **never finds NaN**.

### Fix
Use a NaN-aware equality:

```python
def is_equal(a, b):
    if isinstance(a, float) and isinstance(b, float):
        if math.isnan(a) and math.isnan(b):
            return True
    return a == b
```

In JavaScript, use `Array.prototype.includes` (uses SameValueZero, which treats NaN as equal to itself).

In Java, use `Double.equals` (boxed) instead of `==`.

### Lesson
Floating-point equality is full of traps. Always be explicit about NaN handling, and consider whether equality is even the right check (vs. tolerance-based comparison).

---

## Bug 5 — Mutation During Iteration

### Buggy — Go
```go
func RemoveAll(arr []int, target int) []int {
    for i, v := range arr {
        if v == target {
            arr = append(arr[:i], arr[i+1:]...)  // ← BUG: mutates while iterating
        }
    }
    return arr
}
```

### Buggy — Java
```java
public static void removeAll(List<Integer> list, int target) {
    for (int i = 0; i < list.size(); i++) {
        if (list.get(i) == target) {
            list.remove(i);  // ← BUG: shifts subsequent elements; we skip one
        }
    }
}

// Or with iterator:
for (Integer v : list) {
    if (v == target) {
        list.remove(v);  // ← ConcurrentModificationException
    }
}
```

### Buggy — Python
```python
def remove_all(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            arr.pop(i)  # ← BUG: corrupts iteration

remove_all([1, 2, 2, 3], 2)
# Expected: [1, 3]
# Actual:   [1, 2, 3] — second 2 was skipped
```

### Bug
After `pop(i)`, all subsequent indices shift down by 1. The for-loop's next iteration uses the **old** index, skipping an element. For consecutive matches (like `[1, 2, 2, 3]`), only every other one is removed.

### Fix
Several options:

**1. Iterate in reverse:**
```python
for i in range(len(arr) - 1, -1, -1):
    if arr[i] == target:
        arr.pop(i)
```

**2. Build a new list:**
```python
arr[:] = [v for v in arr if v != target]   # in-place
# or
return [v for v in arr if v != target]
```

**3. Use the language idiom:**
```java
list.removeIf(v -> v == target);
```

### Lesson
**Never mutate a collection while iterating over it.** Either iterate over a copy, iterate in reverse (for index-based deletion), or use the language's bulk operations.

---

## Bug 6 — Recursive Stack Overflow

### Buggy — Python
```python
import sys

def linear_search_recursive(arr, target, i=0):
    if i >= len(arr):
        return -1
    if arr[i] == target:
        return i
    return linear_search_recursive(arr, target, i + 1)

big = list(range(10_000))
linear_search_recursive(big, 9999)
# RecursionError: maximum recursion depth exceeded
```

### Buggy — Java
```java
public static int linearSearchRecursive(int[] arr, int target, int i) {
    if (i >= arr.length) return -1;
    if (arr[i] == target) return i;
    return linearSearchRecursive(arr, target, i + 1);
}

// For arr.length > ~10000, throws StackOverflowError.
```

### Buggy — Go
```go
func LinearSearchRecursive(arr []int, target, i int) int {
    if i >= len(arr) { return -1 }
    if arr[i] == target { return i }
    return LinearSearchRecursive(arr, target, i+1)
}

// Go's default stack is 1 MB but grows up to 1 GB — can hit OOM
// before stack overflow on huge arrays.
```

### Bug
Each recursive call adds a stack frame. For n > 1000 (Python), > ~10000 (Java), > millions (Go), the stack overflows.

### Fix
Use iteration. There is **no reason** to recurse for linear search — it has no divide-and-conquer structure.

```python
def linear_search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1
```

### Lesson
Recursion is for tree/graph problems. Iteration is for sequential traversal. Use the natural fit. Python and Java do not optimize tail calls; even tail-recursive code overflows.

---

## Bug 7 — Parallel Race Condition

### Buggy — Go
```go
import "sync"

func ParallelSearch(arr []int, target int) int {
    found := -1   // ← shared mutable state
    var wg sync.WaitGroup
    chunks := 4
    chunkSize := len(arr) / chunks
    for c := 0; c < chunks; c++ {
        wg.Add(1)
        go func(start int) {
            defer wg.Done()
            for i := start; i < start+chunkSize; i++ {
                if arr[i] == target {
                    found = i   // ← BUG: data race on `found`
                }
            }
        }(c * chunkSize)
    }
    wg.Wait()
    return found
}
```

### Buggy — Java
```java
import java.util.concurrent.*;

public static int parallelSearch(int[] arr, int target) {
    int[] found = {-1};   // ← shared mutable
    ExecutorService es = Executors.newFixedThreadPool(4);
    int chunkSize = arr.length / 4;
    for (int c = 0; c < 4; c++) {
        final int start = c * chunkSize;
        es.submit(() -> {
            for (int i = start; i < start + chunkSize; i++) {
                if (arr[i] == target) {
                    found[0] = i;   // ← race condition
                }
            }
        });
    }
    es.shutdown();
    es.awaitTermination(1, TimeUnit.MINUTES);
    return found[0];
}
```

### Buggy — Python
```python
from concurrent.futures import ThreadPoolExecutor

def parallel_search(arr, target):
    found = [-1]   # ← shared
    chunk = len(arr) // 4
    def worker(start):
        for i in range(start, start + chunk):
            if arr[i] == target:
                found[0] = i   # ← Python's GIL makes this lucky, but still racy
    with ThreadPoolExecutor(max_workers=4) as ex:
        for c in range(4):
            ex.submit(worker, c * chunk)
    return found[0]
```

### Bug
Multiple threads write to `found` concurrently. Without synchronization:
- Go: data race detected by `-race`; result may be **any** match (not first).
- Java: similar; no atomicity guarantees on `found[0]`.
- Python: GIL provides accidental atomicity for single-store reads, but the result is still nondeterministic across runs.

Also, **workers don't stop** once a match is found — they keep scanning their entire chunks, wasting CPU.

### Fix
Use atomic operations + cooperative cancellation:

```go
import "sync/atomic"
import "context"

func ParallelSearch(arr []int, target int) int {
    var found int64 = -1
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    var wg sync.WaitGroup
    chunkSize := (len(arr) + 3) / 4
    for c := 0; c < 4; c++ {
        wg.Add(1)
        start := c * chunkSize
        end := start + chunkSize
        if end > len(arr) { end = len(arr) }
        go func(lo, hi int) {
            defer wg.Done()
            for i := lo; i < hi; i++ {
                select {
                case <-ctx.Done(): return
                default:
                }
                if arr[i] == target {
                    // CAS: only set if no smaller index already set
                    for {
                        cur := atomic.LoadInt64(&found)
                        if cur != -1 && cur < int64(i) { return }
                        if atomic.CompareAndSwapInt64(&found, cur, int64(i)) {
                            cancel()
                            return
                        }
                    }
                }
            }
        }(start, end)
    }
    wg.Wait()
    return int(atomic.LoadInt64(&found))
}
```

### Lesson
Concurrent writes to shared state require atomic primitives (or message passing). Always run with `-race` (Go), `ThreadSanitizer` (C++), or static analyzers in CI.

---

## Bug 8 — Comparator Symmetry Violation

### Buggy — Java
```java
import java.util.Comparator;

class Item {
    int id;
    String name;
}

Comparator<Item> wrongCmp = (a, b) -> a.name.compareToIgnoreCase(b.name);

// Linear search with custom comparator
public static int findItem(Item[] arr, Item target, Comparator<Item> cmp) {
    for (int i = 0; i < arr.length; i++) {
        if (cmp.compare(arr[i], target) == 0) {
            return i;
        }
    }
    return -1;
}

// Usage:
Item target = new Item();
target.name = null;   // ← NPE inside compareToIgnoreCase
findItem(items, target, wrongCmp);
```

### Bug
The comparator does not handle `null` names — `null.compareToIgnoreCase(x)` throws NPE. Also, the comparator is not **symmetric** if items with null names are compared in different orders (depending on which side is null).

### Fix
Write a defensive comparator:

```java
Comparator<Item> safeCmp = Comparator.nullsFirst(
    Comparator.comparing(
        i -> i.name,
        Comparator.nullsFirst(String.CASE_INSENSITIVE_ORDER)
    )
);
```

### Lesson
Comparators must satisfy **reflexivity, symmetry, transitivity, and null safety**. Linear search with a custom comparator inherits all the comparator's bugs. Test the comparator independently with property-based tests.

---

## Bug 9 — Returns Last Instead of First

### Buggy — Go
```go
func FindFirst(arr []int, target int) int {
    found := -1
    for i, v := range arr {
        if v == target {
            found = i  // ← BUG: keeps overwriting, returns LAST match
        }
    }
    return found
}

FindFirst([]int{5, 3, 5, 7, 5}, 5)  // → 4 (last 5), expected 0
```

### Buggy — Python
```python
def find_first(arr, target):
    found = -1
    for i, v in enumerate(arr):
        if v == target:
            found = i   # ← keeps updating
    return found
```

### Bug
Without an early return / break, the loop keeps overwriting `found` with each new match. The function returns the **last** index, not the **first**.

### Fix
Return immediately on first match:

```go
func FindFirst(arr []int, target int) int {
    for i, v := range arr {
        if v == target {
            return i   // ← early exit
        }
    }
    return -1
}
```

### Lesson
The "first match" contract requires **early exit**. If you genuinely want the last match, scan in reverse — don't scan forward and overwrite.

---

## Bug 10 — Case-Sensitive String Search

### Buggy — Python
```python
words = ["Hello", "WORLD", "foo", "Bar"]

def find_word(words, target):
    for i, w in enumerate(words):
        if w == target:
            return i
    return -1

find_word(words, "hello")  # → -1, but user expected 0 (case-insensitive search)
```

### Buggy — Java
```java
String[] words = {"Hello", "WORLD", "foo", "Bar"};
for (int i = 0; i < words.length; i++) {
    if (words[i].equals("hello")) return i;   // ← case-sensitive, misses "Hello"
}
```

### Bug
String equality is case-sensitive by default. User-input search terms rarely match the exact case of stored data, leading to false negatives.

### Fix
Normalize both sides — but be careful about Unicode:

```python
def find_word(words, target):
    target_lower = target.casefold()   # ← casefold > lower for Unicode
    for i, w in enumerate(words):
        if w.casefold() == target_lower:
            return i
    return -1
```

```java
words[i].equalsIgnoreCase("hello");
// Or for Unicode correctness:
words[i].toLowerCase(Locale.ROOT).equals("hello".toLowerCase(Locale.ROOT));
```

### Lesson
String search needs an explicit policy on case, locale, accent normalization, and whitespace. `casefold` (Python) and `equalsIgnoreCase` (Java) handle the common case, but for Turkish dotless I, German ß, etc., use ICU.

---

## Bug 11 — Integer Overflow in Counter

### Buggy — Java
```java
public static int countMatches(int[] arr, int target) {
    int count = 0;       // ← only goes up to 2^31 - 1
    for (int v : arr) {
        if (v == target) {
            count++;
        }
    }
    return count;
}

// On a 4-billion-element array (yes, possible with off-heap memory in Java 21),
// count silently wraps to negative.
```

### Buggy — C
```c
int count_matches(const int* arr, size_t n, int target) {
    int count = 0;        // ← int = 32-bit on most platforms
    for (size_t i = 0; i < n; i++) {
        if (arr[i] == target) count++;
    }
    return count;          // ← undefined behavior on overflow
}
```

### Buggy — Go
```go
func Count(arr []int32, target int32) int32 {
    var count int32       // ← max 2^31 - 1
    for _, v := range arr {
        if v == target {
            count++
        }
    }
    return count
}
```

### Bug
A counter typed `int` (32-bit) overflows after 2^31 - 1 ≈ 2.1 billion matches. In Java, this wraps to a negative number silently. In C, it's **undefined behavior** (and can be exploited to break loops). In Go, similar wrap.

### Fix
Use a wider type:

```java
public static long countMatches(int[] arr, int target) {
    long count = 0;
    for (int v : arr) if (v == target) count++;
    return count;
}
```

```go
func Count(arr []int32, target int32) int64 {
    var count int64
    for _, v := range arr {
        if v == target {
            count++
        }
    }
    return count
}
```

### Lesson
Choose counter widths to **exceed the maximum possible count, with margin**. For very large data sets, default to 64-bit. In safety-critical code, use checked arithmetic (`Math.addExact` in Java).

---

## Bug 12 — Generic Type Bounds

### Buggy — Java
```java
public static <T> int linearSearch(T[] arr, T target) {
    for (int i = 0; i < arr.length; i++) {
        if (arr[i] == target) {   // ← BUG: identity comparison, not equality
            return i;
        }
    }
    return -1;
}

String[] s = {"apple", new String("apple"), "banana"};
linearSearch(s, "apple");          // → 0 (lucky — interned)
linearSearch(s, new String("apple"));  // → -1 (not the same object!)
```

### Buggy — Go
```go
// Pre-Go 1.18 — no generics. Hand-rolled with interface{}:
func LinearSearch(arr []interface{}, target interface{}) int {
    for i, v := range arr {
        if v == target {   // ← BUG: works for primitives, but not for slice/map values
            return i
        }
    }
    return -1
}

// Go 1.18+ with generics:
func LinearSearchGeneric[T comparable](arr []T, target T) int {
    for i, v := range arr {
        if v == target {
            return i
        }
    }
    return -1
}
// `comparable` excludes slices, maps, funcs — but doesn't help with structs
// containing those, which panic at runtime when compared.
```

### Bug
Java's `==` on object references checks **identity**, not value equality. Two `String` objects with the same content are different references unless interned, so `==` returns `false`.

In Go, the `comparable` constraint allows compile-time-comparable types but doesn't enforce semantic equality (e.g., two `time.Time` values with the same instant compare unequal due to monotonic clock).

### Fix
**Java:** use `Objects.equals` (handles null + delegates to `equals`):

```java
public static <T> int linearSearch(T[] arr, T target) {
    for (int i = 0; i < arr.length; i++) {
        if (Objects.equals(arr[i], target)) {
            return i;
        }
    }
    return -1;
}
```

**Go:** for types where `==` is the wrong notion of equality, accept a comparator:

```go
func LinearSearchFunc[T any](arr []T, eq func(T) bool) int {
    for i, v := range arr {
        if eq(v) {
            return i
        }
    }
    return -1
}

// Usage:
idx := LinearSearchFunc(times, func(t time.Time) bool {
    return t.Equal(target)   // monotonic-aware equality
})
```

### Lesson
Generic / dynamic equality is a minefield. Always think about what equality **means** for your type:
- Primitives → `==` works.
- Strings → `equals` (Java), `==` (Go), `==` (Python).
- Custom objects → require an `Equals` / `__eq__` / `Comparable` impl.
- Floats → use tolerance.
- Time → use a domain-aware comparison.

---

## Summary

| # | Bug | Category |
|---|-----|----------|
| 1 | Off-by-one bound | Loop control |
| 2 | bool instead of index | API design |
| 3 | Missing not-found return | Control flow |
| 4 | NaN equality | Floating point |
| 5 | Mutation while iterating | Concurrency / iteration |
| 6 | Recursive stack overflow | Algorithm choice |
| 7 | Parallel race | Concurrency |
| 8 | Comparator violation | Custom equality |
| 9 | Returns last not first | Control flow |
| 10 | Case-sensitive search | Domain modeling |
| 11 | Counter overflow | Numeric correctness |
| 12 | Generic identity vs equality | Type system |

Linear search is "trivial" in the textbook sense, but production code is full of these bugs. Most modern style guides forbid hand-written linear search in favor of `slices.Index`, `Objects.equals`, `Stream.findFirst`, etc. — precisely because they handle these traps for you.
