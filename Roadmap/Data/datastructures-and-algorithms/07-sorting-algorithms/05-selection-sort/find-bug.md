# Selection Sort — Find the Bug

> 12 buggy implementations. Each shows the broken code, an explanation of why it fails, and the corrected version. Selection Sort looks deceptively simple — these bugs catch even experienced engineers.

---

## Bug 1: Off-by-One in Inner Loop (Misses Last Element)

### Buggy (Python)
```python
def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n - 1):   # BUG: should be `n`, not `n - 1`
            if arr[j] < arr[min_idx]:
                min_idx = j
        arr[i], arr[min_idx] = arr[min_idx], arr[i]
    return arr
```

### Why it fails
The inner loop scans `[i+1, n-1)` and never touches index `n-1`. The last element is excluded from every minimum search, so if the smallest remaining value lives at the end, it stays put. Output for `[3,1,4,5,2]` becomes `[1,3,4,5,2]` — the trailing `2` is invisible to every pass.

### Fix
```python
for j in range(i + 1, n):   # include n - 1
```

---

## Bug 2: Missing Self-Swap Skip (Selection Sort Becomes Unstable Even for Equal Elements)

### Buggy (Go)
```go
func SelectionSort(a []int) {
    for i := 0; i < len(a)-1; i++ {
        minIdx := i
        for j := i + 1; j < len(a); j++ {
            if a[j] < a[minIdx] {
                minIdx = j
            }
        }
        // BUG: always swap, even when minIdx == i
        a[i], a[minIdx] = a[minIdx], a[i]
    }
}
```

### Why it fails
Functionally correct but **wastes the main advantage of Selection Sort**: minimum write count. On already-sorted input you perform `n-1` redundant self-swaps — meaningless for RAM but catastrophic for **flash memory / EEPROM** where each write costs an erase cycle and consumes endurance budget. Selection Sort's whole reason to exist is "minimize writes."

### Fix
```go
if minIdx != i {
    a[i], a[minIdx] = a[minIdx], a[i]
}
```

---

## Bug 3: Wrong Direction (Picks Maximum Instead of Minimum)

### Buggy (Java)
```java
public static void selectionSort(int[] a) {
    for (int i = 0; i < a.length - 1; i++) {
        int minIdx = i;
        for (int j = i + 1; j < a.length; j++) {
            if (a[j] > a[minIdx]) {   // BUG: > instead of <
                minIdx = j;
            }
        }
        int t = a[i]; a[i] = a[minIdx]; a[minIdx] = t;
    }
}
```

### Why it fails
Picks the **maximum** of the unsorted suffix and swaps it to the front. Output is neither ascending nor descending — it's garbage. For descending-from-the-back you'd need to scan from the right and swap to the back. The comparator direction must match where you place the selected element.

### Fix
```java
if (a[j] < a[minIdx]) { ... }   // ascending: track the min
```

---

## Bug 4: "Stable" Variant That Isn't (Wrong Equal-Key Handling)

### Buggy (Python)
```python
def stable_selection_sort(arr):
    """Attempts stable variant by inserting min instead of swapping."""
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] <= arr[min_idx]:   # BUG: <= breaks stability
                min_idx = j
        arr[i], arr[min_idx] = arr[min_idx], arr[i]   # still using swap
    return arr
```

### Why it fails
Two breakage modes:
1. `<=` (instead of `<`) makes the algorithm prefer the **last** equal element rather than the first, so equal keys are reordered.
2. Even with strict `<`, **the swap itself is what makes Selection Sort unstable**. Swapping `arr[i]` with `arr[min_idx]` jumps the value at `i` over a stretch of intermediate elements, possibly leapfrogging an equal key. Example: `[2a, 2b, 1]` → swap `arr[0]` with `arr[2]` → `[1, 2b, 2a]`. Order of `2a`/`2b` flipped.

### Fix
True stable Selection Sort requires **shifting** instead of swapping (O(n²) writes, defeating the whole point):
```python
def stable_selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]:    # strict <
                min_idx = j
        # shift [i..min_idx-1] right by one, then place min at i
        v = arr[min_idx]
        arr[i+1:min_idx+1] = arr[i:min_idx]
        arr[i] = v
    return arr
```
**Trade-off:** stability now costs you O(n²) writes — you've lost Selection Sort's only advantage.

---

## Bug 5: Infinite Recursion (Wrong Base Case)

### Buggy (Python)
```python
def selection_sort_rec(arr, start=0):
    if start == len(arr):       # BUG: should also handle start == len-1
        return
    min_idx = start
    for j in range(start, len(arr)):   # BUG: starts at `start`, not start+1
        if arr[j] < arr[min_idx]:
            min_idx = j
    arr[start], arr[min_idx] = arr[min_idx], arr[start]
    selection_sort_rec(arr, start)     # BUG: forgot `start + 1`
```

### Why it fails
Three compounding bugs cause infinite recursion. The recursive call passes the same `start` instead of `start+1`, so the base case is never reached. Even if the base case worked, `range(start, len(arr))` includes the current position, which is harmless for finding the min but wastes work.

### Fix
```python
def selection_sort_rec(arr, start=0):
    if start >= len(arr) - 1:     # last single element is trivially sorted
        return
    min_idx = start
    for j in range(start + 1, len(arr)):
        if arr[j] < arr[min_idx]:
            min_idx = j
    if min_idx != start:
        arr[start], arr[min_idx] = arr[min_idx], arr[start]
    selection_sort_rec(arr, start + 1)
```

---

## Bug 6: Comparator Subtraction Overflow (Java)

### Buggy (Java)
```java
public static void selectionSort(Integer[] a, Comparator<Integer> cmp) {
    for (int i = 0; i < a.length - 1; i++) {
        int minIdx = i;
        for (int j = i + 1; j < a.length; j++) {
            if (cmp.compare(a[j], a[minIdx]) < 0) {
                minIdx = j;
            }
        }
        Integer t = a[i]; a[i] = a[minIdx]; a[minIdx] = t;
    }
}

// Caller:
Comparator<Integer> bad = (x, y) -> x - y;        // BUG: silent overflow
selectionSort(new Integer[]{Integer.MIN_VALUE, Integer.MAX_VALUE, 0}, bad);
```

### Why it fails
`Integer.MIN_VALUE - Integer.MAX_VALUE` wraps around to `1` (positive), so the comparator says "MIN is greater than MAX." Selection Sort then "correctly" follows broken signals and produces a wrong order. Same trap exists in C, Go (with int32), and any language with two's-complement integer wraparound.

### Fix
```java
Comparator<Integer> good = Integer::compare;        // safe
// or:
Comparator<Integer> good2 = (x, y) -> Integer.compare(x, y);
```
For doubles use `Double.compare` (handles `NaN` and `-0.0`/`+0.0`).

---

## Bug 7: NaN Handling Breaks Comparison (Float Arrays)

### Buggy (Go)
```go
func SelectionSortFloat(a []float64) {
    for i := 0; i < len(a)-1; i++ {
        minIdx := i
        for j := i + 1; j < len(a); j++ {
            if a[j] < a[minIdx] {   // BUG: NaN poisons all comparisons
                minIdx = j
            }
        }
        a[i], a[minIdx] = a[minIdx], a[i]
    }
}

// Caller:
arr := []float64{3.0, math.NaN(), 1.0, 2.0}
SelectionSortFloat(arr)   // → result depends on NaN position; not totally ordered
```

### Why it fails
IEEE-754 specifies that **every comparison with NaN returns false**: `NaN < x`, `x < NaN`, and `NaN == x` are all false. Selection Sort relies on `<` to be a strict weak ordering. NaN violates it: NaN is incomparable to everything, so `min_idx` may "lock onto" a NaN position and refuse to move, or skip past NaN leaving it stranded. Result: the array is not in any meaningful order, and it's deterministically wrong (not a transient race).

### Fix
Decide on a NaN policy first. Option A: route NaN to the end.
```go
less := func(x, y float64) bool {
    if math.IsNaN(x) { return false }   // NaN sorts to back
    if math.IsNaN(y) { return true }
    return x < y
}
// then use less() instead of `<`
```
Option B: reject input with NaN and return an error. Java users: `Double.compare` already imposes a total order (NaN > +∞).

---

## Bug 8: Off-by-One Outer Bound (Skips Final Pair Check)

### Buggy (Python)
```python
def selection_sort(arr):
    n = len(arr)
    for i in range(n - 2):              # BUG: should be n - 1
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]:
                min_idx = j
        arr[i], arr[min_idx] = arr[min_idx], arr[i]
    return arr
```

### Why it fails
With `n = 5` the loop runs `i = 0..2`. After three passes, indices 0, 1, 2 are placed correctly but indices 3 and 4 are never compared against each other, so any disorder between the last two elements survives. `[5,4,3,2,1]` after the buggy code becomes `[1,2,3,5,4]`.

> Why does the standard say `n - 1` (not `n`)? Because the final element is *automatically* in place once the first `n-1` are correct. So `n - 1` is the right count, but `n - 2` is one too few.

### Fix
```python
for i in range(n - 1):
```

---

## Bug 9: Mutating During Iteration (Removing Sorted Elements)

### Buggy (Python)
```python
def selection_sort_buggy(arr):
    """Attempts an O(n²) selection sort by repeatedly removing the min."""
    out = []
    for i in range(len(arr)):           # BUG: len(arr) snapshots ONCE at loop start...
        m = min(arr)
        out.append(m)
        arr.remove(m)                    # ...but arr shrinks each iteration → IndexError or incomplete
    return out
```

### Why it fails
Subtle in Python: `range(len(arr))` evaluates `len(arr)` once. But then each iteration mutates `arr`, so `min(arr)` eventually runs on an empty list, raising `ValueError: min() arg is an empty sequence`. Even when it doesn't crash, the pattern is fragile: in languages where the iterator is a live view (e.g., Java `ArrayList` iterator) you get `ConcurrentModificationException`. The general lesson: never mutate the collection you're iterating over.

### Fix
Don't reinvent — use index-based in-place selection sort. If you really want the "extract min" pattern, work on a copy and iterate by count:
```python
def selection_sort_extract(arr):
    work = list(arr)            # copy; do not mutate input
    out = []
    while work:
        m = min(work)
        out.append(m)
        work.remove(m)          # mutates `work`, not the iterator we're using
    return out
# Note: O(n²) time and O(n) extra space — strictly worse than in-place.
```

---

## Bug 10: Wrong Stable Variant (Insertion-Style Shift With Off-by-One)

### Buggy (Java)
```java
public static void stableSelectionSort(int[] a) {
    for (int i = 0; i < a.length - 1; i++) {
        int minIdx = i;
        for (int j = i + 1; j < a.length; j++) {
            if (a[j] < a[minIdx]) minIdx = j;
        }
        int v = a[minIdx];
        // BUG: shift bounds wrong — overwrites a[i] before saving min
        for (int k = minIdx; k > i; k--) {
            a[k] = a[k - 1];           // shifts right; needs k from minIdx down to i+1
        }
        a[i] = v;
    }
}
```

### Why it fails
This particular shift loop is *almost* right but easy to get wrong by one. If you accidentally write `for (int k = minIdx + 1; ...)` you walk off the end. If you write `k >= i` you overwrite the freshly-placed `a[i]` next iteration. The version above is *correct* but only because `v` is captured before the shift — change the order of those lines and you destroy the value. The bug is **fragility**: stable Selection Sort has no margin for index errors.

### Fix
Use `System.arraycopy` (clearer, faster, no manual indexing):
```java
int v = a[minIdx];
System.arraycopy(a, i, a, i + 1, minIdx - i);   // shift [i..minIdx-1] one right
a[i] = v;
```
**Reminder:** stable Selection Sort costs O(n²) writes — you've traded away the one reason to pick Selection Sort over Insertion Sort.

---

## Bug 11: Parallel Min-Find Race Condition

### Buggy (Go)
```go
func ParallelSelectionSort(a []int) {
    var wg sync.WaitGroup
    for i := 0; i < len(a)-1; i++ {
        minIdx := i
        chunkSize := (len(a) - i - 1) / 4
        for w := 0; w < 4; w++ {
            wg.Add(1)
            go func(start, end int) {
                defer wg.Done()
                for j := start; j < end; j++ {
                    if a[j] < a[minIdx] {        // BUG: read of shared minIdx
                        minIdx = j               // BUG: write race
                    }
                }
            }(i+1+w*chunkSize, i+1+(w+1)*chunkSize)
        }
        wg.Wait()
        a[i], a[minIdx] = a[minIdx], a[i]
    }
}
```

### Why it fails
Multiple goroutines read and write `minIdx` without synchronization. This is a textbook data race: `go test -race` flags it immediately. Even without a race, the comparison `a[j] < a[minIdx]` reads `a[minIdx]` mid-update from another goroutine, so a worker can update `minIdx` to a *worse* candidate. Closure capture of `minIdx` by reference compounds the bug — every goroutine sees the same variable.

### Fix
Each worker computes a **local** min over its chunk, then the main goroutine reduces:
```go
type result struct{ idx int }
results := make([]result, 4)
for w := 0; w < 4; w++ {
    wg.Add(1)
    go func(w, start, end int) {
        defer wg.Done()
        local := start
        for j := start + 1; j < end; j++ {
            if a[j] < a[local] { local = j }
        }
        results[w] = result{local}
    }(w, i+1+w*chunkSize, i+1+(w+1)*chunkSize)
}
wg.Wait()
minIdx := i
for _, r := range results {
    if a[r.idx] < a[minIdx] { minIdx = r.idx }
}
```
**Caveat:** for n < ~10,000 the goroutine overhead dwarfs the win. Selection Sort is rarely the right algorithm to parallelize.

---

## Bug 12: Generic Compare Function That Doesn't Define a Total Order

### Buggy (Python)
```python
def selection_sort_by(arr, key):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if key(arr[j]) < key(arr[min_idx]):
                min_idx = j
        arr[i], arr[min_idx] = arr[min_idx], arr[i]
    return arr

# Caller passes a non-deterministic key:
import random
selection_sort_by([{"id": 1}, {"id": 2}, {"id": 3}], key=lambda x: random.random())
# BUG: key() returns a different value each call → no total order
```

### Why it fails
Selection Sort assumes `key(x)` is a *function* (same input → same output). If `key` is non-deterministic (random, time-based, depends on global state), the algorithm "compares" the same element to itself with different values, breaks transitivity, and produces a different "sorted" order on every run. Worse, in some languages this corrupts internal data structures — Java's `TimSort` will throw `IllegalArgumentException: Comparison method violates its general contract` if it detects the inconsistency. Selection Sort is too dumb to detect it; it just produces wrong output silently.

### Fix
Pre-compute keys once (Schwartzian transform), or document that `key` must be deterministic and pure:
```python
def selection_sort_by(arr, key):
    n = len(arr)
    keys = [key(x) for x in arr]            # compute once
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if keys[j] < keys[min_idx]:
                min_idx = j
        if min_idx != i:
            arr[i], arr[min_idx] = arr[min_idx], arr[i]
            keys[i], keys[min_idx] = keys[min_idx], keys[i]   # keep aligned
    return arr
```
The Schwartzian transform also amortizes expensive keys (regex match, hash, network lookup) — `O(n)` evaluations instead of `O(n²)`.

---

## Summary Table

| # | Bug | Symptom | Root Cause |
|---|-----|---------|------------|
| 1 | Inner loop `n-1` | Last element never selected | Off-by-one |
| 2 | No self-swap skip | Wasted writes (deadly on flash) | Missing guard |
| 3 | `>` instead of `<` | Wrong order | Comparator direction |
| 4 | `<=` "stable" variant | Equal keys reordered | Strict-vs-loose + swap semantics |
| 5 | Recursive | Infinite recursion / stack overflow | Wrong base case + missing increment |
| 6 | `a - b` comparator | Wraparound → wrong order | Two's-complement overflow |
| 7 | Float `<` with NaN | Non-totally-ordered output | IEEE-754 NaN semantics |
| 8 | Outer loop `n-2` | Last two elements unsorted | Off-by-one |
| 9 | `arr.remove(min)` while iterating | Crash / wrong length | Mutating live collection |
| 10 | Manual shift in stable variant | Index slip overwrites elements | Fragile manual indexing |
| 11 | Parallel min-find | Data race, wrong min | Shared mutable state |
| 12 | Non-deterministic key | Different output every run | Key not a pure function |

**Meta-lesson:** Selection Sort is the simplest sort, yet 12 distinct bug families fit on one page. Simplicity does not mean correctness — every loop boundary, every comparison direction, every shared variable is a hazard.
