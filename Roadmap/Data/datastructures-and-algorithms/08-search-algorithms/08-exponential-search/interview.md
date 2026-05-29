# Exponential Search — Interview Questions & Coding Challenges

> **Audience:** Anyone preparing for software engineering interviews where exponential search may appear — typically when interviewers explore "what if you don't know the array's length?", parametric search variants, or merge-sort internals. Includes conceptual questions across levels and 6 coding challenges with full Go / Java / Python solutions.

---

## Section A — Conceptual Questions

### Junior level

**Q1. What is exponential search and how is it different from binary search?**
Exponential search is a two-phase algorithm: (1) **gallop** — start at index 1 and double the probe index (1, 2, 4, 8, …) until `arr[i] >= target` or `i >= n`; (2) **bisect** — binary search the range `[i/2, min(i, n-1)]`. Binary search is one-phase and requires `n` to be known. Exponential search works on **unknown-length** sequences and beats binary search when the target is near the front.

**Q2. What's the time complexity of exponential search?**
**O(log p)** where `p` is the target's index, not the total array length `n`. This is `O(log n)` in the worst case (target near the end), but `O(log p)` is much faster when `p << n`.

**Q3. Why does exponential search start at index 1, not index 0?**
Because `bound *= 2` starting from 0 stays at 0 forever — infinite loop. Standard pattern: special-case `arr[0] == target` first, then start the gallop at `bound = 1`.

**Q4. What's the space complexity?**
O(1) iterative. O(log p) recursive due to call stack (rarely used).

**Q5. What happens if the array length is less than `bound` after doubling?**
The gallop loop exits because `bound < n` becomes false. The bisect range is `[bound / 2, min(bound, n - 1)]` — capped at `n - 1` to prevent OOB. Plain binary search runs on that capped range and either finds the target or returns -1.

**Q6. Can exponential search be used on an unsorted array?**
No. Same precondition as binary search — sorted ascending.

**Q7. Can it be used on a linked list?**
Same problem as binary search. Each index probe costs O(n) on a singly linked list, destroying the asymptotic advantage. Use linear search on linked lists.

### Middle level

**Q8. When would you use exponential search instead of plain binary search?**
Three cases:
- The array's length is **unknown** (e.g., a sorted stream, an OOB-returning oracle).
- The target is **expected near the front** of a very large array.
- You're inside a **merge algorithm** (Timsort), where galloping detects long winning streaks.

For random targets in known-size arrays, plain binary search is simpler and slightly faster on the worst case.

**Q9. How does exponential search compare to jump search?**
Jump search probes additively (`+ √n`), exponential probes multiplicatively (`× 2`). Jump is O(√n); exponential is O(log p). Exponential is asymptotically better and works on unknown-size data. Jump is useful only on slow sequential-access media (tape) where seek distance dominates.

**Q10. How does Timsort use galloping?**
After `minGallop` (default 7) consecutive picks from one side in a 2-way merge, Timsort switches from pair-at-a-time to **galloping mode**: it uses exponential search to find how many of the winning side's elements are less than the top of the other side, then bulk-copies them. The `minGallop` threshold is **adaptive** — it increases when galloping doesn't pay off and decreases when it does.

**Q11. Why does the doubling work `(ofs << 1) + 1` in Timsort's gallop instead of just `ofs *= 2`?**
Two reasons: (1) starting `ofs = 0` and doubling would be stuck at 0 — `(0 << 1) + 1 = 1` moves forward; (2) the `+1` provides a guard against integer overflow (negative result indicates overflow, handled by capping at `max_ofs`).

**Q12. What's the canonical LeetCode problem for exponential search?**
**LeetCode 702 — Search in a Sorted Array of Unknown Size.** You're given a `Reader` object with `get(i)` that returns `INT_MAX` for out-of-bounds indices. The expected solution is exponential search + binary search.

### Senior level

**Q13. Why is exponential search optimal for unbounded sorted search?**
Bentley & Yao (1976) proved that any comparison-based algorithm for unbounded sorted search must make at least `2 log₂ p − O(1)` probes in the worst case. Exponential search matches this bound (within constants). The factor of 2 is unavoidable — half the probes discover the range, half localize within it.

**Q14. Why is the factor of 2 versus binary search unavoidable?**
Information-theoretically: discovering an upper bound `b ≥ p` requires `log₂ p` bits of information; localizing within `[0, b]` requires another `log₂ p` bits. Each comparison yields at most 1 bit. Total: `2 log₂ p` probes.

**Q15. How does exponential search interact with LSM-tree compaction?**
LSM-tree compaction does N-way merges of sorted SSTables. For N = 2, galloping search detects long winning streaks and bulk-copies them, just like Timsort. For N > 2, a min-heap is used instead (galloping doesn't help when multiple sides can win at any time).

**Q16. Can exponential search be applied to predicates, not just sorted arrays?**
Yes. Generalize to "find the smallest `i` where a monotonic predicate `p(i)` is true, with no upper bound given". Gallop until `p(bound) = True`, then binary-search `[bound/2, bound]` for the boundary. Same O(log p) total cost.

**Q17. What's the relationship between exponential search and skip lists?**
A skip list's multi-level forward pointers structurally embed exponential search: walking forward at level `k` skips `~2^k` elements, dropping a level halves the stride. The overall search is exponential search structured into the data layout. Used in Redis sorted sets, LevelDB memtables.

### Professional level

**Q18. Prove correctness of exponential search.**
Two invariants:
- **Gallop:** `arr[bound / 2] < target` before each iteration (initially `bound / 2 = 0`, established by special-case check).
- **Bisect:** `arr[lo - 1] < target` and `arr[hi] >= target` before each iteration.

Termination: gallop doubles `bound`, so it exits after `⌈log₂(p + 1)⌉ + 1` iterations. Bisect strictly decreases `hi - lo`, exits in `O(log(bound))` iterations. Postcondition: `lo = hi` gives the lower bound of `target`.

**Q19. What's the average-case probe count under a uniform target distribution?**
About `2 log₂ n − 2.88` probes — twice plain binary search's `log₂ n` on average. This is why exponential search is **the wrong default** for uniform target distributions on known-size arrays.

**Q20. When does exponential search beat plain binary search asymptotically?**
When the target's expected position is sublinear in `n`. E.g., if `p = O(log n)` on average (front-loaded), exponential search runs in `O(log log n)` while binary search still runs in `O(log n)`.

---

## Section B — Coding Challenges

### Challenge 1 — Classic Exponential Search

> Given a sorted array of integers and a target, find the index of the target using exponential search, or return -1 if absent.

**Go:**
```go
func exponentialSearch(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    if arr[0] == target {
        return 0
    }
    bound := 1
    for bound < n && arr[bound] < target {
        bound *= 2
    }
    lo := bound / 2
    hi := bound
    if hi >= n {
        hi = n - 1
    }
    for lo <= hi {
        mid := lo + (hi-lo)/2
        switch {
        case arr[mid] == target:
            return mid
        case arr[mid] < target:
            lo = mid + 1
        default:
            hi = mid - 1
        }
    }
    return -1
}
```

**Java:**
```java
public int exponentialSearch(int[] arr, int target) {
    int n = arr.length;
    if (n == 0) return -1;
    if (arr[0] == target) return 0;
    int bound = 1;
    while (bound < n && arr[bound] < target) bound *= 2;
    int lo = bound / 2, hi = Math.min(bound, n - 1);
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) lo = mid + 1;
        else                   hi = mid - 1;
    }
    return -1;
}
```

**Python:**
```python
def exponential_search(arr, target):
    n = len(arr)
    if n == 0: return -1
    if arr[0] == target: return 0
    bound = 1
    while bound < n and arr[bound] < target:
        bound *= 2
    lo, hi = bound // 2, min(bound, n - 1)
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target: return mid
        if arr[mid] < target: lo = mid + 1
        else: hi = mid - 1
    return -1
```

**Complexity:** O(log p) time, O(1) space.

---

### Challenge 2 — Search in a Sorted Array of Unknown Size (LeetCode 702)

> You're given a `Reader` interface with `get(i)` that returns `INT_MAX` if `i` is out of bounds. The underlying array is sorted ascending. Find the target's index, or -1.

**Strategy:** the entire point of this problem is exponential search. You cannot use binary search because you don't know `n`.

**Go:**
```go
type Reader interface { Get(i int) int }

const INF = int(^uint(0) >> 1)   // max int

func search(r Reader, target int) int {
    bound := 1
    for r.Get(bound) < target {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo <= hi {
        mid := lo + (hi-lo)/2
        v := r.Get(mid)
        switch {
        case v == target:
            return mid
        case v < target:
            lo = mid + 1
        default:
            hi = mid - 1
        }
    }
    return -1
}
```

**Java:**
```java
public int search(ArrayReader reader, int target) {
    int bound = 1;
    while (reader.get(bound) < target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        int v = reader.get(mid);
        if (v == target) return mid;
        if (v < target) lo = mid + 1;
        else            hi = mid - 1;
    }
    return -1;
}
```

**Python:**
```python
def search(reader, target):
    bound = 1
    while reader.get(bound) < target:
        bound *= 2
    lo, hi = bound // 2, bound
    while lo <= hi:
        mid = (lo + hi) // 2
        v = reader.get(mid)
        if v == target: return mid
        if v < target: lo = mid + 1
        else: hi = mid - 1
    return -1
```

**Complexity:** O(log p) time, O(1) space. **The canonical "exponential search" interview problem.**

---

### Challenge 3 — Find First Occurrence in a Sorted Array with Duplicates and Unknown Size

> Given a `Reader` (as in Challenge 2) where the underlying array has duplicates, return the **first** index `i` with `reader.get(i) == target`, or -1 if absent.

**Strategy:** exponential gallop to find an upper bound, then `lower_bound` style binary search.

**Python:**
```python
def first_occurrence(reader, target):
    bound = 1
    while reader.get(bound) < target:
        bound *= 2
    lo, hi = bound // 2, bound
    while lo < hi:
        mid = (lo + hi) // 2
        if reader.get(mid) < target:
            lo = mid + 1
        else:
            hi = mid
    return lo if reader.get(lo) == target else -1
```

**Go:**
```go
func firstOccurrence(r Reader, target int) int {
    bound := 1
    for r.Get(bound) < target {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo < hi {
        mid := lo + (hi-lo)/2
        if r.Get(mid) < target {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    if r.Get(lo) == target {
        return lo
    }
    return -1
}
```

**Java:**
```java
public int firstOccurrence(ArrayReader r, int target) {
    int bound = 1;
    while (r.get(bound) < target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (r.get(mid) < target) lo = mid + 1;
        else                     hi = mid;
    }
    return r.get(lo) == target ? lo : -1;
}
```

**Complexity:** O(log p) time, O(1) space.

---

### Challenge 4 — Find Position in an Infinite Monotonic Sequence

> A function `f(i)` defined for all `i >= 0` is **monotonically non-decreasing**. Find the smallest `i` such that `f(i) >= target`. (No upper bound on `i` is given.)

**Strategy:** exponential search on the predicate `f(i) >= target`. This is the unbounded "find first true" template.

**Python:**
```python
def find_first_index(f, target):
    """Smallest i >= 0 with f(i) >= target. f is monotonically non-decreasing."""
    if f(0) >= target:
        return 0
    bound = 1
    while f(bound) < target:
        bound *= 2
    lo, hi = bound // 2, bound
    while lo < hi:
        mid = (lo + hi) // 2
        if f(mid) < target:
            lo = mid + 1
        else:
            hi = mid
    return lo
```

**Go:**
```go
func FindFirstIndex(f func(int) int, target int) int {
    if f(0) >= target {
        return 0
    }
    bound := 1
    for f(bound) < target {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo < hi {
        mid := lo + (hi-lo)/2
        if f(mid) < target {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    return lo
}
```

**Java:**
```java
public int findFirstIndex(java.util.function.IntUnaryOperator f, int target) {
    if (f.applyAsInt(0) >= target) return 0;
    int bound = 1;
    while (f.applyAsInt(bound) < target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (f.applyAsInt(mid) < target) lo = mid + 1;
        else                            hi = mid;
    }
    return lo;
}
```

**Complexity:** O(log p) calls to `f`, O(1) space. Generalizes parametric binary search to unknown answer ranges.

---

### Challenge 5 — Implement `gallopLeft` (Timsort's Inner Loop)

> Given a sorted slice `arr[base..base+length)`, a `key`, and a starting hint position, return the number of elements in the slice that are strictly less than `key`. Use a bidirectional galloping search.

**Strategy:** decide direction based on `arr[base + hint]` vs. `key`, then gallop in that direction, then refine with binary search.

**Python:**
```python
def gallop_left(key, arr, base, length, hint):
    """
    Return k such that arr[base + k - 1] < key <= arr[base + k].
    Used inside Timsort's merge to bulk-copy from one run.
    """
    last_ofs = 0
    ofs = 1

    if key > arr[base + hint]:
        # gallop forward
        max_ofs = length - hint
        while ofs < max_ofs and key > arr[base + hint + ofs]:
            last_ofs = ofs
            ofs = (ofs << 1) + 1
            if ofs <= 0:               # overflow
                ofs = max_ofs
        if ofs > max_ofs:
            ofs = max_ofs
        last_ofs += hint
        ofs += hint
    else:
        # gallop backward
        max_ofs = hint + 1
        while ofs < max_ofs and key <= arr[base + hint - ofs]:
            last_ofs = ofs
            ofs = (ofs << 1) + 1
            if ofs <= 0:
                ofs = max_ofs
        if ofs > max_ofs:
            ofs = max_ofs
        last_ofs, ofs = hint - ofs, hint - last_ofs

    # binary search refine on (last_ofs, ofs]
    last_ofs += 1
    while last_ofs < ofs:
        m = last_ofs + ((ofs - last_ofs) >> 1)
        if key > arr[base + m]:
            last_ofs = m + 1
        else:
            ofs = m
    return ofs
```

**Go:**
```go
func gallopLeft(key int, arr []int, base, length, hint int) int {
    lastOfs := 0
    ofs := 1
    if key > arr[base+hint] {
        maxOfs := length - hint
        for ofs < maxOfs && key > arr[base+hint+ofs] {
            lastOfs = ofs
            ofs = (ofs << 1) + 1
            if ofs <= 0 {
                ofs = maxOfs
            }
        }
        if ofs > maxOfs {
            ofs = maxOfs
        }
        lastOfs += hint
        ofs += hint
    } else {
        maxOfs := hint + 1
        for ofs < maxOfs && key <= arr[base+hint-ofs] {
            lastOfs = ofs
            ofs = (ofs << 1) + 1
            if ofs <= 0 {
                ofs = maxOfs
            }
        }
        if ofs > maxOfs {
            ofs = maxOfs
        }
        lastOfs, ofs = hint-ofs, hint-lastOfs
    }
    lastOfs++
    for lastOfs < ofs {
        m := lastOfs + (ofs-lastOfs)/2
        if key > arr[base+m] {
            lastOfs = m + 1
        } else {
            ofs = m
        }
    }
    return ofs
}
```

**Java:** see OpenJDK's `java.util.TimSort.gallopLeft` for the canonical reference.

**Complexity:** O(log k) where `k` is the distance from `hint` to the answer. The hint makes near-hint queries very fast.

---

### Challenge 6 — Search the Boundary of a Monotonic Predicate (Bug-Bisect)

> You have a sequence of API responses for requests numbered `0, 1, 2, …`. Each response is either OK or FAILED, and once a request fails, every subsequent request also fails. You don't know the total number of requests. Find the smallest request number that failed, using as few API calls as possible.

**Strategy:** exponential search on the predicate `request_i_failed`.

**Python:**
```python
def find_first_failure(api_call):
    """api_call(i) returns True if request i failed, False if OK."""
    if api_call(0):
        return 0
    bound = 1
    while not api_call(bound):
        bound *= 2
    lo, hi = bound // 2, bound
    while lo < hi:
        mid = (lo + hi) // 2
        if api_call(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo
```

**Go:**
```go
func FindFirstFailure(apiCall func(int) bool) int {
    if apiCall(0) {
        return 0
    }
    bound := 1
    for !apiCall(bound) {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo < hi {
        mid := lo + (hi-lo)/2
        if apiCall(mid) {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}
```

**Java:**
```java
public int findFirstFailure(java.util.function.IntPredicate apiCall) {
    if (apiCall.test(0)) return 0;
    int bound = 1;
    while (!apiCall.test(bound)) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (apiCall.test(mid)) hi = mid;
        else                   lo = mid + 1;
    }
    return lo;
}
```

**Complexity:** O(log p) API calls where `p` is the first failing request number. Generalizes `git bisect` to unbounded sequences.

---

## Section C — Common Interview Pitfalls

### Pitfall 1 — Forgetting the index-0 special case
Starting `bound = 1` and doubling means `arr[0]` is never probed. Add the check `if arr[0] == target: return 0` (and `if n == 0: return -1`) before the gallop.

### Pitfall 2 — Doubling overflow
`bound *= 2` on 32-bit `int` overflows past 2³⁰. Either use `int64` or cap with `bound = min(bound * 2, n)`. Java's TimSort uses `(ofs << 1) + 1` and checks `ofs <= 0` as the overflow guard.

### Pitfall 3 — Linear scan in phase 2
Some candidates write `for i in range(bound // 2, bound): if arr[i] == target: ...` in phase 2 instead of binary search. This destroys the O(log p) guarantee. Always use binary search in the refine phase.

### Pitfall 4 — Wrong bisect range when `bound >= n`
After the gallop, `bound` may have exceeded `n - 1`. The bisect range is `[bound / 2, min(bound, n - 1)]`. Forgetting the `min` causes `arr[hi]` to throw OOB.

### Pitfall 5 — OOB exceptions in unknown-size readers
For unknown-size readers (LC 702), some candidates wrap `reader.get(i)` in try/except. **Exception-based control flow is hundreds of times slower than a sentinel check.** The reader contract should return INF on OOB; design around it.

### Pitfall 6 — Confusing exponential search with jump search
Jump search is `O(√n)`, exponential is `O(log p)`. They are completely different algorithms with different use cases. Don't conflate them in interviews.

### Pitfall 7 — Using exponential search when binary search is fine
If `n` is known and the target distribution is uniform, exponential search is **slower** on average. The interviewer may probe: "Why exponential here and not plain binary?" — be ready to justify.

### Pitfall 8 — Asking "is the array length known?" too late
For unknown-length problems (LC 702-style), exponential search is the *only* answer. If you start coding plain binary search and then realize you don't have `n`, you've burned 5 minutes. Always clarify the input contract first.

### Pitfall 9 — Incorrect direction in galloping with hint
In Timsort's `gallopLeft`, you gallop **forward** when `key > arr[base + hint]` and **backward** when `key <= arr[base + hint]`. Getting the direction wrong gallops in the wrong way and finds an incorrect insertion point.

### Pitfall 10 — Not handling the absent-target case in phase 2
After phase 2, the algorithm must check `arr[lo] == target` (or `reader.get(lo) == target`) to confirm the target was actually found vs. the algorithm finding the insertion point. Returning `lo` directly without this check returns the wrong index when target is absent.

---

## Section D — Mock Interview Drill

A typical 45-minute interview involving exponential search:

1. **Warm-up (5 min):** "Write classic binary search." (You demonstrate fluency.)
2. **Twist (5 min):** "What if you don't know `n`?" (Lead-in for exponential search.)
3. **Core problem (20 min):** LeetCode 702 (Search in Sorted Array of Unknown Size).
4. **Discussion (10 min):** Complexity, why exponential beats binary here, what happens for huge `n` with target at index 5, real-world uses (Timsort, Kafka).
5. **Stretch (5 min):** "How would you find the **first** occurrence with duplicates?" or "How does this relate to galloping merge in Timsort?"

**Drill questions to practice aloud:**
- *"Walk me through exponential search step by step on `[1, 3, 5, 7, 9, 11, 13]` searching for 9."*
- *"What's the time complexity, and why isn't it just O(log n)?"*
- *"What's the difference between O(log p) and O(log n)?"*
- *"Why start at `bound = 1` and not `bound = 0`?"*
- *"How would your algorithm change if duplicates were allowed?"*
- *"Where in production is exponential search used?"* (Timsort merge, Kafka offset lookup, LC 702.)
- *"Could you describe Timsort's `minGallop` heuristic?"*

Memorize the two-phase template, the `bound *= 2` doubling, and the `[bound / 2, min(bound, n - 1)]` refine range. With those three patterns plus the special-case for index 0, you have the entire algorithm.
