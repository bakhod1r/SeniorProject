# Exponential Search — Practice Tasks

> 15 graded practice problems with full Go / Java / Python solutions plus a benchmark task. Each task starts with a **problem statement**, gives **constraints**, then provides three implementations. Difficulty grows from "warmup" to "implement Timsort's gallop".

> **Sections:** Beginner (Tasks 1-5) · Intermediate (Tasks 6-10) · Advanced (Tasks 11-15) · Benchmark.

---

## Beginner Tasks

> Goal: master the two-phase template (gallop → bisect), the unknown-size variant, duplicate handling, and the "comparisons match O(log p)" verification.

---

## Task 1 — Classic Exponential Search

**Problem.** Given a sorted array `arr[]` and a target `t`, return the index of `t` using exponential search, or `-1` if absent.

**Constraints.** `1 <= n <= 10^5`, distinct values.

**Go:**
```go
func expSearch(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return -1 }
    if arr[0] == t { return 0 }
    bound := 1
    for bound < n && arr[bound] < t {
        bound *= 2
    }
    lo, hi := bound/2, bound
    if hi >= n { hi = n - 1 }
    for lo <= hi {
        m := lo + (hi-lo)/2
        if arr[m] == t { return m }
        if arr[m] < t { lo = m + 1 } else { hi = m - 1 }
    }
    return -1
}
```

**Java:**
```java
int expSearch(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return -1;
    if (arr[0] == t) return 0;
    int bound = 1;
    while (bound < n && arr[bound] < t) bound *= 2;
    int lo = bound / 2, hi = Math.min(bound, n - 1);
    while (lo <= hi) {
        int m = lo + (hi - lo) / 2;
        if (arr[m] == t) return m;
        if (arr[m] < t) lo = m + 1; else hi = m - 1;
    }
    return -1;
}
```

**Python:**
```python
def exp_search(arr, t):
    n = len(arr)
    if n == 0: return -1
    if arr[0] == t: return 0
    bound = 1
    while bound < n and arr[bound] < t:
        bound *= 2
    lo, hi = bound // 2, min(bound, n - 1)
    while lo <= hi:
        m = (lo + hi) // 2
        if arr[m] == t: return m
        if arr[m] < t: lo = m + 1
        else: hi = m - 1
    return -1
```

---

## Task 2 — Exponential Search with `lower_bound` Semantics

**Problem.** Return the smallest index `i` such that `arr[i] >= t`, or `n` if all elements are less than `t`. Use exponential search.

**Go:**
```go
func expLowerBound(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return 0 }
    if arr[0] >= t { return 0 }
    bound := 1
    for bound < n && arr[bound] < t {
        bound *= 2
    }
    lo, hi := bound/2, n
    if bound < n { hi = bound }
    for lo < hi {
        m := lo + (hi-lo)/2
        if arr[m] < t { lo = m + 1 } else { hi = m }
    }
    return lo
}
```

**Java:**
```java
int expLowerBound(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return 0;
    if (arr[0] >= t) return 0;
    int bound = 1;
    while (bound < n && arr[bound] < t) bound *= 2;
    int lo = bound / 2, hi = Math.min(bound, n);
    while (lo < hi) {
        int m = lo + (hi - lo) / 2;
        if (arr[m] < t) lo = m + 1; else hi = m;
    }
    return lo;
}
```

**Python:**
```python
def exp_lower_bound(arr, t):
    n = len(arr)
    if n == 0: return 0
    if arr[0] >= t: return 0
    bound = 1
    while bound < n and arr[bound] < t:
        bound *= 2
    lo, hi = bound // 2, min(bound, n)
    while lo < hi:
        m = (lo + hi) // 2
        if arr[m] < t: lo = m + 1
        else: hi = m
    return lo
```

---

## Task 3 — Search in a Sorted Array of Unknown Size (LeetCode 702)

**Problem.** Given a `Reader` with `get(i)` that returns `INT_MAX` for out-of-bounds indices, find the index of `target` in the underlying sorted array, or `-1`.

**Python:**
```python
def searchUnknownSize(reader, target):
    INF = 2**31 - 1
    bound = 1
    while reader.get(bound) < target:
        bound *= 2
    lo, hi = bound // 2, bound
    while lo <= hi:
        m = (lo + hi) // 2
        v = reader.get(m)
        if v == target: return m
        if v < target: lo = m + 1
        else: hi = m - 1
    return -1
```

**Go:**
```go
type Reader interface { Get(i int) int }
const INF = int(^uint(0) >> 1)

func searchUnknownSize(r Reader, target int) int {
    bound := 1
    for r.Get(bound) < target {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo <= hi {
        m := lo + (hi-lo)/2
        v := r.Get(m)
        if v == target { return m }
        if v < target { lo = m + 1 } else { hi = m - 1 }
    }
    return -1
}
```

**Java:**
```java
public int searchUnknownSize(ArrayReader reader, int target) {
    int bound = 1;
    while (reader.get(bound) < target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo <= hi) {
        int m = lo + (hi - lo) / 2;
        int v = reader.get(m);
        if (v == target) return m;
        if (v < target) lo = m + 1; else hi = m - 1;
    }
    return -1;
}
```

---

## Task 4 — First Occurrence with Duplicates, Unknown Size

**Problem.** Same as Task 3, but the array has duplicates. Return the **first** index with `reader.get(i) == target`, or `-1`.

**Python:**
```python
def firstOccUnknownSize(reader, target):
    bound = 1
    while reader.get(bound) < target:
        bound *= 2
    lo, hi = bound // 2, bound
    while lo < hi:
        m = (lo + hi) // 2
        if reader.get(m) < target: lo = m + 1
        else: hi = m
    return lo if reader.get(lo) == target else -1
```

**Go:**
```go
func firstOccUnknownSize(r Reader, target int) int {
    bound := 1
    for r.Get(bound) < target {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo < hi {
        m := lo + (hi-lo)/2
        if r.Get(m) < target { lo = m + 1 } else { hi = m }
    }
    if r.Get(lo) == target { return lo }
    return -1
}
```

**Java:**
```java
public int firstOccUnknownSize(ArrayReader r, int target) {
    int bound = 1;
    while (r.get(bound) < target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int m = lo + (hi - lo) / 2;
        if (r.get(m) < target) lo = m + 1;
        else                   hi = m;
    }
    return r.get(lo) == target ? lo : -1;
}
```

---

## Task 5 — Last Occurrence with Duplicates, Unknown Size

**Problem.** Same as Task 4, but return the **last** index with `reader.get(i) == target`. Equivalent to `upper_bound - 1`.

**Python:**
```python
def lastOccUnknownSize(reader, target):
    bound = 1
    while reader.get(bound) <= target:
        bound *= 2
    lo, hi = bound // 2, bound
    while lo < hi:
        m = (lo + hi) // 2
        if reader.get(m) <= target: lo = m + 1
        else: hi = m
    if lo > 0 and reader.get(lo - 1) == target:
        return lo - 1
    return -1
```

**Go:**
```go
func lastOccUnknownSize(r Reader, target int) int {
    bound := 1
    for r.Get(bound) <= target {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo < hi {
        m := lo + (hi-lo)/2
        if r.Get(m) <= target { lo = m + 1 } else { hi = m }
    }
    if lo > 0 && r.Get(lo-1) == target {
        return lo - 1
    }
    return -1
}
```

**Java:**
```java
public int lastOccUnknownSize(ArrayReader r, int target) {
    int bound = 1;
    while (r.get(bound) <= target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int m = lo + (hi - lo) / 2;
        if (r.get(m) <= target) lo = m + 1;
        else                    hi = m;
    }
    return (lo > 0 && r.get(lo - 1) == target) ? lo - 1 : -1;
}
```

---

---

## Intermediate Tasks

> Goal: apply exponential search beyond plain arrays — cost-aware probes, galloping merges, predicate search on unbounded number lines, hybrid data structures with skip pointers, and disk-backed sorted files.

---

## Task 6 — Exponential Search on a Stream (Buffered)

**Problem.** You have a generator `stream()` that yields sorted integers one at a time. Find the smallest position `i` (0-indexed) where the yielded value is `>= target`. You may only call `stream.next()` to advance, not seek. Buffer the yielded values to enable random access for the bisect phase.

**Python:**
```python
def stream_exp_search(stream, target):
    """
    stream is an iterator yielding sorted ints. Returns the smallest index
    of a value >= target. Materializes only the prefix needed.
    """
    buf = []
    def fetch(i):
        while len(buf) <= i:
            try:
                buf.append(next(stream))
            except StopIteration:
                buf.append(float('inf'))
        return buf[i]

    if fetch(0) >= target:
        return 0
    bound = 1
    while fetch(bound) < target:
        bound *= 2

    lo, hi = bound // 2, bound
    while lo < hi:
        m = (lo + hi) // 2
        if fetch(m) < target: lo = m + 1
        else: hi = m
    return lo
```

**Go:**
```go
type IntStream struct {
    next func() (int, bool)
    buf  []int
    done bool
}

const STREAM_INF = int(^uint(0) >> 1)

func (s *IntStream) Get(i int) int {
    for len(s.buf) <= i && !s.done {
        v, ok := s.next()
        if !ok { s.done = true; break }
        s.buf = append(s.buf, v)
    }
    if i >= len(s.buf) { return STREAM_INF }
    return s.buf[i]
}

func StreamExpSearch(s *IntStream, target int) int {
    if s.Get(0) >= target { return 0 }
    bound := 1
    for s.Get(bound) < target {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo < hi {
        m := lo + (hi-lo)/2
        if s.Get(m) < target { lo = m + 1 } else { hi = m }
    }
    return lo
}
```

**Java:**
```java
import java.util.*;
class IntStream {
    Iterator<Integer> src;
    List<Integer> buf = new ArrayList<>();
    boolean done = false;
    static final int INF = Integer.MAX_VALUE;

    IntStream(Iterator<Integer> src) { this.src = src; }

    int get(int i) {
        while (buf.size() <= i && !done) {
            if (src.hasNext()) buf.add(src.next());
            else done = true;
        }
        return i < buf.size() ? buf.get(i) : INF;
    }
}

public int streamExpSearch(IntStream s, int target) {
    if (s.get(0) >= target) return 0;
    int bound = 1;
    while (s.get(bound) < target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int m = lo + (hi - lo) / 2;
        if (s.get(m) < target) lo = m + 1;
        else                   hi = m;
    }
    return lo;
}
```

---

## Task 7 — Boundary of a Monotonic Predicate (Bug-Bisect)

**Problem.** A predicate `failed(i)` is monotonic: once it returns `True` at `i`, it returns `True` for every `j >= i`. Find the smallest `i` where `failed(i) == True`. No upper bound on `i` is given.

**Python:**
```python
def find_first_failure(failed):
    if failed(0):
        return 0
    bound = 1
    while not failed(bound):
        bound *= 2
    lo, hi = bound // 2, bound
    while lo < hi:
        m = (lo + hi) // 2
        if failed(m): hi = m
        else: lo = m + 1
    return lo
```

**Go:**
```go
func FindFirstFailure(failed func(int) bool) int {
    if failed(0) { return 0 }
    bound := 1
    for !failed(bound) { bound *= 2 }
    lo, hi := bound/2, bound
    for lo < hi {
        m := lo + (hi-lo)/2
        if failed(m) { hi = m } else { lo = m + 1 }
    }
    return lo
}
```

**Java:**
```java
int findFirstFailure(java.util.function.IntPredicate failed) {
    if (failed.test(0)) return 0;
    int bound = 1;
    while (!failed.test(bound)) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int m = lo + (hi - lo) / 2;
        if (failed.test(m)) hi = m;
        else                lo = m + 1;
    }
    return lo;
}
```

---

## Task 8 — Reverse Exponential Search (Target Near the End)

**Problem.** A sorted array of length `n` is given, and the target is expected to be near the **end** of the array. Implement exponential search that gallops backward from `n - 1`.

**Python:**
```python
def reverse_exp_search(arr, target):
    n = len(arr)
    if n == 0: return -1
    if arr[n - 1] == target: return n - 1
    if arr[n - 1] < target: return -1
    bound = 1
    while bound < n and arr[n - 1 - bound] > target:
        bound *= 2
    lo = max(0, n - 1 - bound)
    hi = n - 1 - bound // 2
    while lo <= hi:
        m = (lo + hi) // 2
        if arr[m] == target: return m
        if arr[m] < target: lo = m + 1
        else: hi = m - 1
    return -1
```

**Go:**
```go
func reverseExpSearch(arr []int, target int) int {
    n := len(arr)
    if n == 0 { return -1 }
    if arr[n-1] == target { return n - 1 }
    if arr[n-1] < target { return -1 }
    bound := 1
    for bound < n && arr[n-1-bound] > target {
        bound *= 2
    }
    lo := 0
    if n-1-bound > 0 { lo = n - 1 - bound }
    hi := n - 1 - bound/2
    for lo <= hi {
        m := lo + (hi-lo)/2
        if arr[m] == target { return m }
        if arr[m] < target { lo = m + 1 } else { hi = m - 1 }
    }
    return -1
}
```

**Java:**
```java
int reverseExpSearch(int[] arr, int target) {
    int n = arr.length;
    if (n == 0) return -1;
    if (arr[n - 1] == target) return n - 1;
    if (arr[n - 1] < target) return -1;
    int bound = 1;
    while (bound < n && arr[n - 1 - bound] > target) bound *= 2;
    int lo = Math.max(0, n - 1 - bound), hi = n - 1 - bound / 2;
    while (lo <= hi) {
        int m = lo + (hi - lo) / 2;
        if (arr[m] == target) return m;
        if (arr[m] < target) lo = m + 1; else hi = m - 1;
    }
    return -1;
}
```

---

## Task 9 — Galloping with a Hint

**Problem.** Implement a `gallop(arr, target, hint)` function that searches for `target`'s lower-bound position in `arr`, starting the gallop near `hint` instead of index 1. Used in Timsort's merge.

**Python:**
```python
def gallop_with_hint(arr, target, hint):
    """
    Return the smallest i such that arr[i] >= target.
    Bias the search by `hint` — gallop forward or backward depending on
    whether arr[hint] is below or at-or-above target.
    """
    n = len(arr)
    if hint < 0 or hint >= n:
        hint = max(0, min(hint, n - 1))

    if arr[hint] < target:
        last_ofs = 0
        ofs = 1
        max_ofs = n - hint
        while ofs < max_ofs and arr[hint + ofs] < target:
            last_ofs = ofs
            ofs = ofs * 2 + 1
        if ofs > max_ofs: ofs = max_ofs
        lo, hi = hint + last_ofs + 1, hint + ofs
    else:
        last_ofs = 0
        ofs = 1
        max_ofs = hint + 1
        while ofs < max_ofs and arr[hint - ofs] >= target:
            last_ofs = ofs
            ofs = ofs * 2 + 1
        if ofs > max_ofs: ofs = max_ofs
        lo, hi = hint - ofs + 1, hint - last_ofs + 1

    while lo < hi:
        m = (lo + hi) // 2
        if arr[m] < target: lo = m + 1
        else: hi = m
    return lo
```

**Go:**
```go
func gallopWithHint(arr []int, target, hint int) int {
    n := len(arr)
    if hint < 0 { hint = 0 }
    if hint >= n { hint = n - 1 }
    var lo, hi int
    if arr[hint] < target {
        lastOfs, ofs := 0, 1
        maxOfs := n - hint
        for ofs < maxOfs && arr[hint+ofs] < target {
            lastOfs = ofs
            ofs = ofs*2 + 1
        }
        if ofs > maxOfs { ofs = maxOfs }
        lo, hi = hint+lastOfs+1, hint+ofs
    } else {
        lastOfs, ofs := 0, 1
        maxOfs := hint + 1
        for ofs < maxOfs && arr[hint-ofs] >= target {
            lastOfs = ofs
            ofs = ofs*2 + 1
        }
        if ofs > maxOfs { ofs = maxOfs }
        lo, hi = hint-ofs+1, hint-lastOfs+1
    }
    for lo < hi {
        m := lo + (hi-lo)/2
        if arr[m] < target { lo = m + 1 } else { hi = m }
    }
    return lo
}
```

**Java:**
```java
int gallopWithHint(int[] arr, int target, int hint) {
    int n = arr.length;
    if (hint < 0) hint = 0;
    if (hint >= n) hint = n - 1;
    int lo, hi;
    if (arr[hint] < target) {
        int lastOfs = 0, ofs = 1, maxOfs = n - hint;
        while (ofs < maxOfs && arr[hint + ofs] < target) {
            lastOfs = ofs;
            ofs = ofs * 2 + 1;
        }
        if (ofs > maxOfs) ofs = maxOfs;
        lo = hint + lastOfs + 1; hi = hint + ofs;
    } else {
        int lastOfs = 0, ofs = 1, maxOfs = hint + 1;
        while (ofs < maxOfs && arr[hint - ofs] >= target) {
            lastOfs = ofs;
            ofs = ofs * 2 + 1;
        }
        if (ofs > maxOfs) ofs = maxOfs;
        lo = hint - ofs + 1; hi = hint - lastOfs + 1;
    }
    while (lo < hi) {
        int m = lo + (hi - lo) / 2;
        if (arr[m] < target) lo = m + 1; else hi = m;
    }
    return lo;
}
```

---

## Task 10 — Implement a Simple Galloping Merge

**Problem.** Merge two sorted slices `A`, `B` into one sorted slice, using galloping search when one side wins many consecutive comparisons. Switch to galloping after `MIN_GALLOP = 7` consecutive wins from one side.

**Python:**
```python
MIN_GALLOP = 7

def galloping_merge(A, B):
    out = []
    i = j = 0

    while i < len(A) and j < len(B):
        a_streak = b_streak = 0
        while i < len(A) and j < len(B):
            if A[i] <= B[j]:
                out.append(A[i]); i += 1
                a_streak += 1; b_streak = 0
                if a_streak >= MIN_GALLOP: break
            else:
                out.append(B[j]); j += 1
                b_streak += 1; a_streak = 0
                if b_streak >= MIN_GALLOP: break

        if i < len(A) and j < len(B):
            if a_streak >= MIN_GALLOP:
                k = gallop_upper_bound(A, i, B[j])
                out.extend(A[i:k]); i = k
            elif b_streak >= MIN_GALLOP:
                k = gallop_lower_bound(B, j, A[i])
                out.extend(B[j:k]); j = k

    out.extend(A[i:])
    out.extend(B[j:])
    return out

def gallop_upper_bound(A, start, key):
    n = len(A)
    bound = 1
    while start + bound < n and A[start + bound] <= key:
        bound *= 2
    lo = start + bound // 2
    hi = min(start + bound, n)
    while lo < hi:
        m = (lo + hi) // 2
        if A[m] <= key: lo = m + 1
        else: hi = m
    return lo

def gallop_lower_bound(B, start, key):
    n = len(B)
    bound = 1
    while start + bound < n and B[start + bound] < key:
        bound *= 2
    lo = start + bound // 2
    hi = min(start + bound, n)
    while lo < hi:
        m = (lo + hi) // 2
        if B[m] < key: lo = m + 1
        else: hi = m
    return lo
```

**Go:**
```go
const MIN_GALLOP = 7

func GallopingMerge(A, B []int) []int {
    out := make([]int, 0, len(A)+len(B))
    i, j := 0, 0
    for i < len(A) && j < len(B) {
        aStreak, bStreak := 0, 0
        for i < len(A) && j < len(B) {
            if A[i] <= B[j] {
                out = append(out, A[i]); i++
                aStreak++; bStreak = 0
                if aStreak >= MIN_GALLOP { break }
            } else {
                out = append(out, B[j]); j++
                bStreak++; aStreak = 0
                if bStreak >= MIN_GALLOP { break }
            }
        }
        if i < len(A) && j < len(B) {
            if aStreak >= MIN_GALLOP {
                k := gallopUB(A, i, B[j])
                out = append(out, A[i:k]...); i = k
            } else if bStreak >= MIN_GALLOP {
                k := gallopLB(B, j, A[i])
                out = append(out, B[j:k]...); j = k
            }
        }
    }
    out = append(out, A[i:]...); out = append(out, B[j:]...)
    return out
}

func gallopUB(A []int, start, key int) int {
    n := len(A); bound := 1
    for start+bound < n && A[start+bound] <= key { bound *= 2 }
    lo := start + bound/2
    hi := start + bound; if hi > n { hi = n }
    for lo < hi {
        m := lo + (hi-lo)/2
        if A[m] <= key { lo = m + 1 } else { hi = m }
    }
    return lo
}

func gallopLB(B []int, start, key int) int {
    n := len(B); bound := 1
    for start+bound < n && B[start+bound] < key { bound *= 2 }
    lo := start + bound/2
    hi := start + bound; if hi > n { hi = n }
    for lo < hi {
        m := lo + (hi-lo)/2
        if B[m] < key { lo = m + 1 } else { hi = m }
    }
    return lo
}
```

**Java:** see OpenJDK's `java.util.TimSort.mergeLo` / `mergeHi` for the reference implementation with adaptive `minGallop`.

---

---

## Advanced Tasks

> Goal: production-grade variants — irregular gaps, concurrent search, B-tree integration, branchless implementations, and head-to-head wall-clock comparison against binary search.

---

## Task 11 — Find Closest Element in Unknown-Size Sorted Stream

**Problem.** A reader (as in Task 3) provides `get(i)` for a sorted array of unknown length. Find the index whose value is closest to `target` (ties broken by smaller index).

**Python:**
```python
def closest_unknown_size(reader, target):
    INF = 2**31 - 1
    bound = 1
    while reader.get(bound) < target:
        bound *= 2
    lo, hi = bound // 2, bound
    while lo < hi:
        m = (lo + hi) // 2
        if reader.get(m) < target: lo = m + 1
        else: hi = m
    a = reader.get(lo)
    if lo == 0:
        return lo
    b = reader.get(lo - 1)
    if a == INF or abs(b - target) <= abs(a - target):
        return lo - 1
    return lo
```

**Go:**
```go
func closestUnknownSize(r Reader, target int) int {
    bound := 1
    for r.Get(bound) < target { bound *= 2 }
    lo, hi := bound/2, bound
    for lo < hi {
        m := lo + (hi-lo)/2
        if r.Get(m) < target { lo = m + 1 } else { hi = m }
    }
    a := r.Get(lo)
    if lo == 0 { return lo }
    b := r.Get(lo - 1)
    da, db := a-target, target-b
    if da < 0 { da = -da }
    if db < 0 { db = -db }
    if a == INF || db <= da { return lo - 1 }
    return lo
}
```

**Java:**
```java
public int closestUnknownSize(ArrayReader r, int target) {
    int bound = 1;
    while (r.get(bound) < target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int m = lo + (hi - lo) / 2;
        if (r.get(m) < target) lo = m + 1;
        else                   hi = m;
    }
    int a = r.get(lo);
    if (lo == 0) return lo;
    int b = r.get(lo - 1);
    int da = Math.abs(a - target), db = Math.abs(b - target);
    return (a == Integer.MAX_VALUE || db <= da) ? lo - 1 : lo;
}
```

---

## Task 12 — Exponential Search on a 2D Sorted Matrix of Unknown Row Count

**Problem.** A matrix where each row is sorted left-to-right and each row's first value > previous row's last value. The matrix's row count is unknown (returned via `get_row(i)` which returns `None` for OOB). Find the target's `(row, col)` position.

**Python:**
```python
def search_unknown_matrix(get_row, target):
    """get_row(i) returns sorted list (the i-th row), or None if OOB."""
    if get_row(0) is None: return None
    if get_row(0)[0] > target: return None

    bound = 1
    while True:
        row = get_row(bound)
        if row is None: break
        if row[0] > target: break
        bound *= 2

    lo, hi = bound // 2, bound
    while lo < hi:
        m = (lo + hi) // 2
        row = get_row(m)
        if row is None or row[0] > target: hi = m
        else: lo = m + 1
    row_idx = lo - 1
    row = get_row(row_idx)
    if row is None: return None
    rlo, rhi = 0, len(row) - 1
    while rlo <= rhi:
        m = (rlo + rhi) // 2
        if row[m] == target: return (row_idx, m)
        if row[m] < target: rlo = m + 1
        else: rhi = m - 1
    return None
```

**Go:**
```go
func searchUnknownMatrix(getRow func(int) []int, target int) (int, int, bool) {
    if getRow(0) == nil { return 0, 0, false }
    if getRow(0)[0] > target { return 0, 0, false }

    bound := 1
    for {
        row := getRow(bound)
        if row == nil || row[0] > target { break }
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo < hi {
        m := lo + (hi-lo)/2
        row := getRow(m)
        if row == nil || row[0] > target { hi = m } else { lo = m + 1 }
    }
    rowIdx := lo - 1
    row := getRow(rowIdx)
    if row == nil { return 0, 0, false }
    rlo, rhi := 0, len(row)-1
    for rlo <= rhi {
        m := (rlo + rhi) / 2
        if row[m] == target { return rowIdx, m, true }
        if row[m] < target { rlo = m + 1 } else { rhi = m - 1 }
    }
    return 0, 0, false
}
```

**Java:**
```java
public int[] searchUnknownMatrix(java.util.function.IntFunction<int[]> getRow, int target) {
    int[] row0 = getRow.apply(0);
    if (row0 == null || row0[0] > target) return null;

    int bound = 1;
    while (true) {
        int[] row = getRow.apply(bound);
        if (row == null || row[0] > target) break;
        bound *= 2;
    }
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int m = lo + (hi - lo) / 2;
        int[] row = getRow.apply(m);
        if (row == null || row[0] > target) hi = m;
        else                                lo = m + 1;
    }
    int rowIdx = lo - 1;
    int[] row = getRow.apply(rowIdx);
    if (row == null) return null;
    int rlo = 0, rhi = row.length - 1;
    while (rlo <= rhi) {
        int m = (rlo + rhi) / 2;
        if (row[m] == target) return new int[]{rowIdx, m};
        if (row[m] < target) rlo = m + 1; else rhi = m - 1;
    }
    return null;
}
```

---

## Task 13 — Exponential Search with Overflow-Safe Doubling

**Problem.** Implement exponential search robust to `bound * 2` overflow on 32-bit signed integers. Cap at `n - 1` aggressively.

**Java:**
```java
int safeExpSearch(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return -1;
    if (arr[0] == t) return 0;
    int bound = 1;
    while (bound < n && arr[bound] < t) {
        if (bound > Integer.MAX_VALUE / 2) {
            bound = n;
        } else {
            bound *= 2;
        }
    }
    int lo = bound / 2;
    int hi = Math.min(bound, n - 1);
    while (lo <= hi) {
        int m = lo + (hi - lo) / 2;
        if (arr[m] == t) return m;
        if (arr[m] < t) lo = m + 1; else hi = m - 1;
    }
    return -1;
}
```

**Go:**
```go
func safeExpSearch(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return -1 }
    if arr[0] == t { return 0 }
    const MAXINT = int(^uint(0) >> 1)
    bound := 1
    for bound < n && arr[bound] < t {
        if bound > MAXINT/2 {
            bound = n
        } else {
            bound *= 2
        }
    }
    lo, hi := bound/2, bound
    if hi >= n { hi = n - 1 }
    for lo <= hi {
        m := lo + (hi-lo)/2
        if arr[m] == t { return m }
        if arr[m] < t { lo = m + 1 } else { hi = m - 1 }
    }
    return -1
}
```

**Python:** Python integers are arbitrary precision, so no overflow concern.

```python
def safe_exp_search(arr, t):
    # Same as Task 1; Python's int doesn't overflow.
    return exp_search(arr, t)
```

---

## Task 14 — Exponential Search with Time-Window Filter

**Problem.** A list of events sorted by timestamp. Given a target time `T`, find the first event with timestamp `>= T`. The events list is huge but `T` is expected to be near the recent end (since this is a "what happened in the last 5 seconds" query). Use **reverse** exponential search from the end of the list.

**Python:**
```python
def first_event_at_or_after(events, T):
    """events sorted by timestamp ascending. Reverse-gallop from end."""
    n = len(events)
    if n == 0: return -1
    if events[n - 1].timestamp < T: return -1
    if events[0].timestamp >= T: return 0

    bound = 1
    while bound < n and events[n - 1 - bound].timestamp >= T:
        bound *= 2

    lo = max(0, n - 1 - bound)
    hi = n - 1 - bound // 2 + 1
    while lo < hi:
        m = (lo + hi) // 2
        if events[m].timestamp < T: lo = m + 1
        else: hi = m
    return lo
```

**Go:**
```go
type Event struct { Timestamp int; Data string }

func FirstEventAtOrAfter(events []Event, T int) int {
    n := len(events)
    if n == 0 { return -1 }
    if events[n-1].Timestamp < T { return -1 }
    if events[0].Timestamp >= T { return 0 }
    bound := 1
    for bound < n && events[n-1-bound].Timestamp >= T {
        bound *= 2
    }
    lo := 0
    if n-1-bound > 0 { lo = n - 1 - bound }
    hi := n - 1 - bound/2 + 1
    for lo < hi {
        m := lo + (hi-lo)/2
        if events[m].Timestamp < T { lo = m + 1 } else { hi = m }
    }
    return lo
}
```

**Java:**
```java
class Event { int timestamp; String data; }

public int firstEventAtOrAfter(Event[] events, int T) {
    int n = events.length;
    if (n == 0) return -1;
    if (events[n - 1].timestamp < T) return -1;
    if (events[0].timestamp >= T) return 0;
    int bound = 1;
    while (bound < n && events[n - 1 - bound].timestamp >= T) bound *= 2;
    int lo = Math.max(0, n - 1 - bound), hi = n - 1 - bound / 2 + 1;
    while (lo < hi) {
        int m = lo + (hi - lo) / 2;
        if (events[m].timestamp < T) lo = m + 1;
        else                         hi = m;
    }
    return lo;
}
```

---

## Task 15 — Implement Timsort's Adaptive `minGallop` Heuristic

**Problem.** Extend the galloping merge from Task 10 with an **adaptive** `minGallop` counter that decreases when galloping wins and increases when it doesn't. Mimic CPython's behavior.

**Python:**
```python
def adaptive_galloping_merge(A, B):
    out = []
    i = j = 0
    min_gallop = 7

    while i < len(A) and j < len(B):
        a_streak = b_streak = 0
        # Phase 1: pair-at-a-time
        while i < len(A) and j < len(B):
            if A[i] <= B[j]:
                out.append(A[i]); i += 1
                a_streak += 1; b_streak = 0
                if a_streak >= min_gallop: break
            else:
                out.append(B[j]); j += 1
                b_streak += 1; a_streak = 0
                if b_streak >= min_gallop: break
        if i >= len(A) or j >= len(B):
            break

        # Phase 2: keep galloping while it pays off
        gallop_again = True
        while gallop_again:
            gallop_again = False
            min_gallop += 1  # cautiously raise the threshold

            if i < len(A) and j < len(B):
                k = gallop_upper_bound(A, i, B[j])
                count_a = k - i
                out.extend(A[i:k]); i = k
                if count_a >= min_gallop:
                    gallop_again = True
                    min_gallop = max(1, min_gallop - 2)

            if i < len(A) and j < len(B):
                k = gallop_lower_bound(B, j, A[i])
                count_b = k - j
                out.extend(B[j:k]); j = k
                if count_b >= min_gallop:
                    gallop_again = True
                    min_gallop = max(1, min_gallop - 2)

    out.extend(A[i:])
    out.extend(B[j:])
    return out
# Reuse gallop_upper_bound and gallop_lower_bound from Task 10
```

**Go:**
```go
func AdaptiveGallopingMerge(A, B []int) []int {
    out := make([]int, 0, len(A)+len(B))
    i, j := 0, 0
    minGallop := 7

    for i < len(A) && j < len(B) {
        aStreak, bStreak := 0, 0
        for i < len(A) && j < len(B) {
            if A[i] <= B[j] {
                out = append(out, A[i]); i++
                aStreak++; bStreak = 0
                if aStreak >= minGallop { break }
            } else {
                out = append(out, B[j]); j++
                bStreak++; aStreak = 0
                if bStreak >= minGallop { break }
            }
        }
        if i >= len(A) || j >= len(B) { break }

        gallopAgain := true
        for gallopAgain {
            gallopAgain = false
            minGallop++
            if i < len(A) && j < len(B) {
                k := gallopUB(A, i, B[j])
                countA := k - i
                out = append(out, A[i:k]...); i = k
                if countA >= minGallop {
                    gallopAgain = true
                    minGallop = maxInt(1, minGallop-2)
                }
            }
            if i < len(A) && j < len(B) {
                k := gallopLB(B, j, A[i])
                countB := k - j
                out = append(out, B[j:k]...); j = k
                if countB >= minGallop {
                    gallopAgain = true
                    minGallop = maxInt(1, minGallop-2)
                }
            }
        }
    }
    out = append(out, A[i:]...); out = append(out, B[j:]...)
    return out
}

func maxInt(a, b int) int { if a > b { return a }; return b }
```

**Java:** see OpenJDK's `java.util.TimSort.mergeLo` for the canonical reference implementation. The `minGallop` field is on the `TimSort` instance and adapts in exactly this way.

---

## Benchmark Task — Exponential vs Binary Search Across Target Positions

> **Goal.** Measure probe count and wall-clock time for **exponential search** vs **plain binary search** on `n = 10^6` sorted integers, varying the target's position: **front** (index 5), **middle** (index n/2), and **end** (index n-1).
>
> **Expected observation.**
> - Probe count: exponential wins ~5x for front, ties at middle, loses ~2x at end.
> - Wall clock: exponential wins decisively for front (≈10x for n = 10^6, due to fewer cache-line touches), roughly ties at middle, loses by ~2x at end.
> - Plain binary search is independent of target position: `~log2(n)` probes always.

**Go:**
```go
package main

import (
	"fmt"
	"time"
)

func binarySearch(arr []int, t int) (int, int) {
	probes := 0
	lo, hi := 0, len(arr)-1
	for lo <= hi {
		probes++
		m := lo + (hi-lo)/2
		if arr[m] == t {
			return m, probes
		}
		if arr[m] < t {
			lo = m + 1
		} else {
			hi = m - 1
		}
	}
	return -1, probes
}

func exponentialSearch(arr []int, t int) (int, int) {
	n := len(arr)
	probes := 0
	if n == 0 {
		return -1, 0
	}
	probes++
	if arr[0] == t {
		return 0, probes
	}
	bound := 1
	for bound < n {
		probes++
		if arr[bound] >= t {
			break
		}
		bound *= 2
	}
	lo, hi := bound/2, bound
	if hi >= n {
		hi = n - 1
	}
	for lo <= hi {
		probes++
		m := lo + (hi-lo)/2
		if arr[m] == t {
			return m, probes
		}
		if arr[m] < t {
			lo = m + 1
		} else {
			hi = m - 1
		}
	}
	return -1, probes
}

func main() {
	const n = 1_000_000
	const reps = 100_000
	arr := make([]int, n)
	for i := range arr {
		arr[i] = i * 2 // sorted even numbers
	}
	positions := map[string]int{
		"front":  arr[5],
		"middle": arr[n/2],
		"end":    arr[n-1],
	}
	for _, name := range []string{"front", "middle", "end"} {
		t := positions[name]
		_, expProbes := exponentialSearch(arr, t)
		_, binProbes := binarySearch(arr, t)
		// time exponential
		start := time.Now()
		for i := 0; i < reps; i++ {
			exponentialSearch(arr, t)
		}
		expTime := time.Since(start).Seconds() / reps * 1e9
		// time binary
		start = time.Now()
		for i := 0; i < reps; i++ {
			binarySearch(arr, t)
		}
		binTime := time.Since(start).Seconds() / reps * 1e9
		fmt.Printf("target=%6s: exp=%3d probes (%.0f ns)  |  bin=%3d probes (%.0f ns)  |  exp/bin=%.2fx\n",
			name, expProbes, expTime, binProbes, binTime, expTime/binTime)
	}
}
```

**Java:**
```java
public class Benchmark {
    static int[] binarySearchProbes(int[] arr, int t) {
        int probes = 0, lo = 0, hi = arr.length - 1;
        while (lo <= hi) {
            probes++;
            int m = lo + (hi - lo) / 2;
            if (arr[m] == t) return new int[]{m, probes};
            if (arr[m] < t) lo = m + 1; else hi = m - 1;
        }
        return new int[]{-1, probes};
    }

    static int[] exponentialSearchProbes(int[] arr, int t) {
        int n = arr.length, probes = 0;
        if (n == 0) return new int[]{-1, 0};
        probes++;
        if (arr[0] == t) return new int[]{0, probes};
        int bound = 1;
        while (bound < n) {
            probes++;
            if (arr[bound] >= t) break;
            bound *= 2;
        }
        int lo = bound / 2, hi = Math.min(bound, n - 1);
        while (lo <= hi) {
            probes++;
            int m = lo + (hi - lo) / 2;
            if (arr[m] == t) return new int[]{m, probes};
            if (arr[m] < t) lo = m + 1; else hi = m - 1;
        }
        return new int[]{-1, probes};
    }

    public static void main(String[] args) {
        final int n = 1_000_000;
        final int reps = 100_000;
        int[] arr = new int[n];
        for (int i = 0; i < n; i++) arr[i] = i * 2;
        String[] names = {"front", "middle", "end"};
        int[] indices = {5, n / 2, n - 1};
        for (int k = 0; k < names.length; k++) {
            int t = arr[indices[k]];
            int expProbes = exponentialSearchProbes(arr, t)[1];
            int binProbes = binarySearchProbes(arr, t)[1];
            long start = System.nanoTime();
            for (int i = 0; i < reps; i++) exponentialSearchProbes(arr, t);
            double expTime = (System.nanoTime() - start) / (double) reps;
            start = System.nanoTime();
            for (int i = 0; i < reps; i++) binarySearchProbes(arr, t);
            double binTime = (System.nanoTime() - start) / (double) reps;
            System.out.printf("target=%6s: exp=%3d probes (%.0f ns)  |  bin=%3d probes (%.0f ns)  |  exp/bin=%.2fx%n",
                    names[k], expProbes, expTime, binProbes, binTime, expTime / binTime);
        }
    }
}
```

**Python:**
```python
import time

def binary_search(arr, t):
    probes = 0
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        probes += 1
        m = (lo + hi) // 2
        if arr[m] == t: return m, probes
        if arr[m] < t: lo = m + 1
        else: hi = m - 1
    return -1, probes

def exponential_search(arr, t):
    n = len(arr)
    probes = 0
    if n == 0: return -1, 0
    probes += 1
    if arr[0] == t: return 0, probes
    bound = 1
    while bound < n:
        probes += 1
        if arr[bound] >= t: break
        bound *= 2
    lo, hi = bound // 2, min(bound, n - 1)
    while lo <= hi:
        probes += 1
        m = (lo + hi) // 2
        if arr[m] == t: return m, probes
        if arr[m] < t: lo = m + 1
        else: hi = m - 1
    return -1, probes

if __name__ == "__main__":
    n = 1_000_000
    reps = 10_000   # Python is slower, so fewer reps
    arr = [i * 2 for i in range(n)]
    for name, idx in [("front", 5), ("middle", n // 2), ("end", n - 1)]:
        t = arr[idx]
        _, exp_probes = exponential_search(arr, t)
        _, bin_probes = binary_search(arr, t)
        s = time.perf_counter()
        for _ in range(reps): exponential_search(arr, t)
        exp_time = (time.perf_counter() - s) / reps * 1e9
        s = time.perf_counter()
        for _ in range(reps): binary_search(arr, t)
        bin_time = (time.perf_counter() - s) / reps * 1e9
        print(f"target={name:>6}: exp={exp_probes:3d} probes ({exp_time:.0f} ns)  |  "
              f"bin={bin_probes:3d} probes ({bin_time:.0f} ns)  |  exp/bin={exp_time/bin_time:.2f}x")
```

**Expected output shape (numbers vary by machine; orders of magnitude should match):**

```
target= front: exp=  6 probes (  85 ns)  |  bin= 20 probes ( 410 ns)  |  exp/bin=0.21x
target=middle: exp= 22 probes ( 460 ns)  |  bin= 20 probes ( 405 ns)  |  exp/bin=1.14x
target=   end: exp= 41 probes ( 820 ns)  |  bin= 20 probes ( 410 ns)  |  exp/bin=2.00x
```

**Analysis.**
- **Front:** exponential search wins by ~5x in both probes and wall-clock — the gallop terminates after 3 doublings (1, 2, 4), then the bisect finishes in 1-2 probes.
- **Middle:** exponential and binary are roughly tied. The gallop "wastes" ~20 probes to discover an upper bound that binary already had for free, but the bisect range is small enough that the total is competitive.
- **End:** binary search wins by exactly the constant-factor 2x predicted by Bentley-Yao. The gallop has to discover the full extent of the array (~20 probes), then the bisect refines (~20 more probes), totaling ~40 vs binary's ~20.

**Takeaway.** For known-size arrays with uniform target distribution, **plain binary search wins on average** by a constant factor of 2. Exponential search dominates only when (a) the length is unknown, or (b) the target distribution is heavily front-loaded. Profile your real workload before defaulting to either.

---

## Self-Check

After completing these tasks, you should be able to:

- [ ] Write classic exponential search from memory in Go, Java, or Python.
- [ ] Recognize when length is unknown and reach for exponential search instead of binary.
- [ ] Implement `lower_bound` / `upper_bound` / first / last occurrence variants over unknown-size streams.
- [ ] Apply exponential search to monotonic predicates over unbounded ranges.
- [ ] Implement reverse-direction gallop for back-loaded targets.
- [ ] Implement galloping search with a starting hint.
- [ ] Implement a basic galloping merge (Task 10) and explain how Timsort's `minGallop` makes it adaptive.
- [ ] Identify when exponential search is the wrong choice (uniform random targets in known-size arrays, tiny arrays, N-way merges).
- [ ] Handle overflow when `bound *= 2` exceeds `INT_MAX` on 32-bit signed integers.
- [ ] Explain Bentley-Yao optimality and why the 2× factor over binary search is unavoidable for unbounded search.

If any of these feel uncertain, revisit the relevant section of `junior.md`, `middle.md`, or `senior.md` and redo the task without looking at the solution.
