# Exponential Search — Junior Level

> **Read time: ~30 minutes** · **Audience:** Engineers who already know binary search and want to learn the **only** comparison-based search that beats binary search when the target is near the front of a very large or unbounded sorted sequence.

Exponential Search — also called **galloping search** or **unbounded binary search** — is one of those algorithms that seems pointless at first ("isn't binary search already O(log n)?") and then turns out to be **the** algorithm you need the moment you face a sorted stream of unknown length, or a sorted array where the target is almost certainly near the beginning. It is the search inside Python's Timsort merge step, the algorithm behind the classic LeetCode "Search in a Sorted Array of Unknown Size" problem, and the reason Java's `Arrays.sort` of partially-sorted data is so embarrassingly fast.

This document teaches you exponential search **from the ground up**: the two-phase "gallop then refine" structure, the O(log p) complexity derivation (note: `p`, not `n`!), why it beats plain binary search when `p << n`, the canonical implementations in Go / Java / Python, and a side-by-side comparison with the closely related jump search.

---

## Table of Contents

1. [Introduction — Gallop, then Bisect](#introduction)
2. [Prerequisites — Sorted Data + Random Access](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Two Phases](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Variants — Base-2 vs Base-1.5, Galloping with Hint](#variants)
11. [Error Handling](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Gallop, then Bisect

Imagine an alphabetically sorted list of every research paper ever published by a university — millions of entries, and the list is so long the system can't even tell you its total length quickly. You're looking for a paper titled "An Algorithm for Cosmic Microwave Background Calibration" — definitely in the **A** range, so almost certainly within the first few thousand entries.

If you used **plain binary search**, you would first need to know the length of the list, then start probing the middle of the *entire* list — somewhere around the letter **M**. That's wasted work: you already suspect the answer is near the front.

**Exponential search** is the algorithm for exactly this situation. You do two phases:

**Phase 1 — Gallop (expand).** Start at index 1. Check `arr[1]`. Too small? Jump to index 2. Still too small? Jump to 4, 8, 16, 32, … Each step *doubles* the index you probe. The moment `arr[i] >= target` (or you fall off the end), you stop.

**Phase 2 — Bisect (refine).** You now have a bounded range — somewhere between the last probe that was too small and the current probe — which is guaranteed to contain the target if it exists. Run a normal binary search on that range.

The two phases together take **O(log p)** time, where `p` is the position of the target. If the target is at index 5 in a billion-element array, exponential search finds it in about **6** probes. Plain binary search would take **30** probes. And for a sorted stream of *unknown* length where binary search literally cannot start (it needs `hi = n - 1`), exponential search is the only option.

Exponential search is the bridge between "I know nothing about where the target is" (do a binary search of the whole thing) and "I have a good guess near the front" (gallop forward until you overshoot).

---

<a name="prerequisites"></a>
## 2. Prerequisites — Sorted Data + Random Access

Same as binary search, but with one important twist:

1. **A sorted sequence.** Ascending order is conventional. The sort order must be consistent with the comparator you use.
2. **Random access to elements by index in O(1).** Arrays, slices, `ArrayList`. Linked lists kill the asymptotic advantage.
3. **A total order.** Same as binary search — `<`, `==`, `>` must form a consistent total order.
4. **Length may be unknown.** This is the new twist. Plain binary search needs `n` up front to set `hi = n - 1`. Exponential search **discovers** the upper bound by galloping until it overshoots — no `n` required.

If your sequence is unbounded (an infinite sorted stream, a sorted file you don't want to `seek(0, SEEK_END)` on, a sorted Kafka partition with sorted offsets), exponential search is essentially the **only** comparison-based search that works correctly.

If your data is sorted **and** you know `n` **and** the target's expected position is roughly uniform, plain binary search is simpler and equally fast. Exponential search shines when at least one of these is true:
- The length is unknown / expensive to compute.
- The target is heuristically expected near the beginning.
- You are doing many searches and most targets cluster near a known anchor (galloping with a hint).

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Gallop phase** | The exponential-probing phase. Index doubles each step (1, 2, 4, 8, …) until the probe value meets or exceeds the target. |
| **Refine phase** | The binary-search phase that narrows the bounded range produced by the gallop. |
| **Bound** | The first index `i` where `arr[i] >= target` (or `n`, if every element is smaller). The gallop's job is to find a small enough `i`. |
| **Galloping search** | Synonym for exponential search, especially when used inside merge algorithms (Timsort). |
| **Unbounded binary search** | Synonym, emphasizing the unknown-length use case. |
| **Probe** | A single index access `arr[i]`. Each gallop step is one probe; each binary-search iteration is one probe. |
| **Overshoot** | The first gallop probe where `arr[i] >= target`. Marks the right end of the refine range. |
| **`p`** | The target's actual index. Exponential search is O(log p), independent of array length `n`. |
| **Base of doubling** | The multiplier between consecutive probe indices. Usually 2; rarely 1.5 or 3. |
| **Galloping with a hint** | Variant where the gallop starts at a hinted index (e.g., the previous match) instead of index 1, useful in merge algorithms. |
| **`minGallop`** | Timsort's adaptive threshold — how many losing one-side picks before switching from linear merge to galloping. Default 7. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Two Phases

### 4.1 Phase 1 — The gallop

```
bound = 1
while bound < n and arr[bound] < target:
    bound = bound * 2
```

You start at index 1 (not 0 — see §11 on why), check the value there, and **double** the index each iteration while the value is still strictly less than the target. When `arr[bound] >= target` (or you fall off the end with `bound >= n`), you stop.

After the gallop, three things are guaranteed:
1. **`bound / 2` is a "definitely too small" lower bound** — every element at index `<= bound / 2` was either strictly less than the target or never checked because we already moved past it.
2. **`min(bound, n - 1)` is a "definitely large enough" upper bound** — either `arr[bound] >= target` or we've fallen off the end (target absent if it would be larger than every element).
3. **The target, if present, is in `[bound / 2, min(bound, n - 1)]`** — a range of size at most `bound / 2` (because `bound - bound/2 = bound/2`).

That last point is the magic. You went from "infinite possible positions" to "at most `bound/2` positions" using only `⌈log₂(bound)⌉` probes.

### 4.2 Phase 2 — The bisect

Now run a standard binary search on `[bound/2, min(bound, n - 1)]`. Because the range has size at most `bound/2`, the binary search takes `⌈log₂(bound/2)⌉` = `⌈log₂(bound)⌉ - 1` probes.

### 4.3 Why "exponential"?

The index increases as `1, 2, 4, 8, 16, …, 2^k, …` — a geometric series with ratio 2. Each probe **doubles** the explored range, hence "exponential growth of the probed range" — exponential search.

Visually:

```
Probes:        1     2     4         8                 16
Indices:       •     •     •         •                 •
Array:    [ . . . . . . . . . . . . . . . . . . . . . . . ]
              ↑___gallops doubled the reach___↑
                                  ↑_______binary search this range_______↑
```

### 4.4 Total time

`gallop probes` + `binary search probes` = `⌈log₂(bound)⌉` + `⌈log₂(bound/2)⌉` ≈ `2 log₂(bound)` = **O(log p)**

where `p` is the target's actual position (`bound ≈ 2p` after the gallop). This is **better than O(log n)** when `p << n`, and **identical to O(log n)** in the worst case (target near the end).

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

Let `p` = the target's index (or `n` if absent), `n` = total length.

| Aspect | Complexity |
|---|---|
| **Best case** | O(1) — target at `arr[0]` (handled as a special case) |
| **Average case** | O(log p) |
| **Worst case** | O(log p) — never worse than 2·⌈log₂(p)⌉ probes |
| **Space (iterative)** | O(1) — three integer variables |
| **Space (recursive)** | O(log p) — recursion stack |
| **Probes during gallop** | ⌈log₂(p + 1)⌉ |
| **Probes during bisect** | ⌈log₂(p + 1)⌉ |
| **Probes total (worst)** | 2·⌈log₂(p + 1)⌉ |
| **Requires sorted input** | YES |
| **Requires known length** | NO — works on streams of unknown size |

**Concrete numbers**, target at index `p` in an array of length `n`:

| `n` | `p` | Plain binary search | Exponential search |
|---|---|---|---|
| 10⁹ | 5 | 30 probes | ~6 probes |
| 10⁹ | 100 | 30 probes | ~14 probes |
| 10⁹ | 10⁵ | 30 probes | ~34 probes |
| 10⁹ | 10⁹ / 2 | 30 probes | ~60 probes |
| Unknown | 100 | **cannot start** | ~14 probes |

Exponential search wins big when the target is near the front, and loses by a constant factor of ~2 when the target is near the back. When the length is unknown, it is the only option.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 Looking for a chapter in a long book without a table of contents

You suspect the chapter is near the front. You don't open to the middle (that wastes a flip). You open to page 2, then page 4, then 8, then 16. Once you overshoot the chapter, you binary-search the bounded range between your last two probes. This is exponential search.

### 6.2 Hunting in a sorted dump of log timestamps

You have a multi-gigabyte append-only log of timestamps, sorted by time. You want the entries from "5 seconds ago". The relevant entries are right near the **end** of the file — so you flip the algorithm: gallop **backward** from the end. Same idea, mirrored. The general principle: gallop from your best guess of the answer's position.

### 6.3 A submarine sonar ping

A submarine looking for the seafloor pings with a short delay, then doubles the delay each time it hears no echo. Once it hears an echo, it bisects between the last two delay values to localize the depth. Exponential search is essentially "I don't know the scale, so I'll discover it by doubling".

### 6.4 The Tim Peters merge

Tim Peters, author of Python's Timsort, observed that when merging two sorted runs `A` and `B`, sometimes one run "wins" many consecutive elements in a row. Instead of comparing them one by one (linear merge), Timsort **gallops** — uses exponential search to find how many elements of `A` are less than the next element of `B`, then copies them in bulk. We cover this in §14 and `senior.md`.

### 6.5 Going up a staircase in fog

You can't see how tall the staircase is. You take 1 step, then 2, then 4, then 8 — each time doubling and feeling for the top. The moment your foot doesn't find a step, you know the top is between your last two attempts, and you bisect from there. Exponential search applied to climbing.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros
- **Works on sequences of unknown length.** Plain binary search needs `n`; exponential search discovers it.
- **Faster than binary search when the target is near the front.** O(log p) instead of O(log n).
- **Asymptotically optimal.** Bentley & Yao (1976) proved that no comparison-based algorithm can do unbounded sorted search in fewer than O(log p) probes — exponential search matches that bound.
- **Simple to implement.** Two short loops — gallop, then standard binary search.
- **The natural fit for galloping merges.** Used in Timsort, Java's TimSort, and modern adaptive sorters.
- **Tiny memory footprint.** Same O(1) as binary search.

### Cons
- **Slower than binary search by a constant factor when the target is near the end.** Up to 2× more probes (you "wasted" the gallop phase).
- **Two phases doubles the code complexity.** Off-by-one bugs in either phase cost you.
- **Index doubling can overflow on 32-bit systems for very large arrays.** Bound the multiplication by `min(bound * 2, n)`.
- **Useless on unsorted data.** Same restriction as binary search.
- **Useless on linked lists.** Same O(n) per probe issue as binary search.
- **No standard library version in most languages.** You implement it. (Python's `bisect` doesn't have it; Go and Java don't either. C++ STL has nothing.)

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Search for `target = 23` in `[3, 7, 11, 15, 19, 23, 27, 31, 35, 39, 43, 47, 51]` (n = 13).

```
Indices:  0  1   2   3   4   5   6   7   8   9  10  11  12
Array:   [3, 7, 11, 15, 19, 23, 27, 31, 35, 39, 43, 47, 51]
```

**Phase 1 — Gallop.**

```
bound = 1                       arr[1] = 7,   7 < 23 → bound = 2
bound = 2                       arr[2] = 11,  11 < 23 → bound = 4
bound = 4                       arr[4] = 19,  19 < 23 → bound = 8
bound = 8                       arr[8] = 35,  35 >= 23 → STOP
```

Gallop probes: 4.

**Phase 2 — Bisect on range `[bound / 2, min(bound, n - 1)] = [4, 8]`.**

```
Iter 1: lo=4, hi=8, mid=6, arr[6]=27, 27 > 23 → hi = 5
Iter 2: lo=4, hi=5, mid=4, arr[4]=19, 19 < 23 → lo = 5
Iter 3: lo=5, hi=5, mid=5, arr[5]=23, 23 == 23 → return 5
```

Bisect probes: 3. **Total probes: 7.** 

Plain binary search on `n = 13` would use `⌈log₂(14)⌉ = 4` probes. Exponential search used 7 — worse here, because the target was near the middle. The advantage shows up when `n` is huge and the target is near the front.

---

Now search for `target = 11` in the same array.

**Phase 1 — Gallop.**

```
bound = 1                       arr[1] = 7,   7 < 11 → bound = 2
bound = 2                       arr[2] = 11,  11 >= 11 → STOP
```

Gallop probes: 2.

**Phase 2 — Bisect on `[1, 2]`.**

```
Iter 1: lo=1, hi=2, mid=1, arr[1]=7, 7 < 11 → lo = 2
Iter 2: lo=2, hi=2, mid=2, arr[2]=11, 11 == 11 → return 2
```

Bisect probes: 2. **Total: 4 probes.** Binary search on `n = 13` would also use 4. Tie.

Now search for `target = 11` in an array of **1 billion** elements where 11 is at index 2.

```
Gallop: 2 probes  (arr[1]=7, arr[2]=11 >= 11, stop)
Bisect: ~1 probe  (range [1, 2] resolves immediately)
Total: ~3 probes.

Binary search would use ⌈log₂(10⁹ + 1)⌉ = 30 probes.
Speedup: 10×.
```

This is the regime where exponential search shines.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Classic exponential search (known length)

**Go:**
```go
package expsearch

// ExponentialSearch returns the index of target in a sorted slice, or -1 if absent.
// The slice MUST be sorted in ascending order.
func ExponentialSearch(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    if arr[0] == target {
        return 0
    }
    // Phase 1: gallop forward until arr[bound] >= target or bound >= n
    bound := 1
    for bound < n && arr[bound] < target {
        bound *= 2
    }
    // Phase 2: binary search on [bound/2, min(bound, n-1)]
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
public final class ExponentialSearch {
    private ExponentialSearch() {}

    /** Returns index of target, or -1 if absent. arr MUST be sorted ascending. */
    public static int search(int[] arr, int target) {
        int n = arr.length;
        if (n == 0) return -1;
        if (arr[0] == target) return 0;

        // Phase 1: gallop
        int bound = 1;
        while (bound < n && arr[bound] < target) {
            bound *= 2;        // could overflow at 2^30; see Performance Tips
        }

        // Phase 2: binary search on [bound/2, min(bound, n-1)]
        int lo = bound / 2;
        int hi = Math.min(bound, n - 1);
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (arr[mid] == target) return mid;
            if (arr[mid] < target) lo = mid + 1;
            else                   hi = mid - 1;
        }
        return -1;
    }
}
```

**Python:**
```python
def exponential_search(arr: list[int], target: int) -> int:
    """Return index of target, or -1 if absent. arr MUST be sorted ascending."""
    n = len(arr)
    if n == 0:
        return -1
    if arr[0] == target:
        return 0

    # Phase 1: gallop
    bound = 1
    while bound < n and arr[bound] < target:
        bound *= 2

    # Phase 2: binary search on [bound // 2, min(bound, n - 1)]
    lo = bound // 2
    hi = min(bound, n - 1)
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

### 9.2 Exponential search on an unknown-length sequence

When the data source is a stream or virtual array of unknown length, you query it via a function `get(i)` that returns the value or a sentinel (e.g., `Integer.MAX_VALUE`, or raises `IndexOutOfBoundsException`) if `i >= length`.

**Python:**
```python
def search_unknown_size(reader, target: int) -> int:
    """reader.get(i) returns arr[i] or 2**31 - 1 ('infinity') if i out of bounds."""
    INF = 2**31 - 1

    # Phase 1: gallop until reader.get(bound) >= target
    bound = 1
    while reader.get(bound) < target:
        bound *= 2

    # Phase 2: binary search on [bound // 2, bound] — treat OOB reads as INF
    lo, hi = bound // 2, bound
    while lo <= hi:
        mid = (lo + hi) // 2
        v = reader.get(mid)
        if v == target:
            return mid
        if v < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

**Go (with an OOB-safe reader interface):**
```go
type Reader interface {
    Get(i int) int          // returns INF if i >= length
}

const INF = int(^uint(0) >> 1)   // max int

func SearchUnknownSize(r Reader, target int) int {
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
public interface Reader {
    int get(int i);     // returns Integer.MAX_VALUE if i out of bounds
}

public static int searchUnknownSize(Reader r, int target) {
    int bound = 1;
    while (r.get(bound) < target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        int v = r.get(mid);
        if (v == target) return mid;
        if (v < target) lo = mid + 1;
        else            hi = mid - 1;
    }
    return -1;
}
```

This is **LeetCode 702 — Search in a Sorted Array of Unknown Size**. The canonical answer is exactly this code.

### 9.3 Exponential search with a starting hint

When you have a heuristic for where the target probably is, start the gallop from that hint instead of index 1.

**Python:**
```python
def gallop_from_hint(arr, target, hint):
    """
    Search for target near `hint`. Used inside merge algorithms when the
    previous match was at `hint - 1` and we expect this one to be nearby.
    """
    n = len(arr)
    if arr[hint] == target:
        return hint

    # Gallop in the correct direction
    if arr[hint] < target:
        # gallop forward
        lo = hint
        step = 1
        while lo + step < n and arr[lo + step] < target:
            lo += step
            step *= 2
        hi = min(lo + step, n - 1)
    else:
        # gallop backward
        hi = hint
        step = 1
        while hi - step >= 0 and arr[hi - step] > target:
            hi -= step
            step *= 2
        lo = max(hi - step, 0)

    # Standard binary search on [lo, hi]
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

This is the **galloping search** used inside Timsort's `mergeLo` and `mergeHi` routines. The `hint` is usually the position of the last successful match — if consecutive matches are clustered, gallop-from-hint is dramatically faster than restarting from index 1.

---

<a name="variants"></a>
## 10. Variants — Base-2 vs Base-1.5, Galloping with Hint

### 10.1 Base of doubling

Standard exponential search doubles the index (`bound *= 2`). You could also triple, or use base 1.5, etc.

| Base | Probes during gallop | Range size after gallop | Total worst case |
|---|---|---|---|
| 1.5 | ~`log_{1.5}(p)` ≈ `1.71 · log₂ p` | ~`p / 1.5` | `2.71 · log₂ p` |
| **2 (standard)** | ~`log₂ p` | ~`p / 2` | `2 · log₂ p` |
| 3 | ~`log₃(p)` ≈ `0.63 · log₂ p` | ~`2p / 3` | `2.21 · log₂ p` |
| `e` (theoretical optimum) | ~`log_e(p) = ln p` | ~`p / e` | `2.16 · log₂ p` |

**Base 2 is the practical sweet spot.** Bases > 2 mean fewer gallop probes but a bigger refine range, hurting the binary-search phase. Bases < 2 mean more gallop probes but a smaller refine range. The asymptotic optimum is `base = e`, but the difference from base 2 is negligible and integer arithmetic favors powers of 2 (you can use shifts).

### 10.2 Galloping with a hint (Timsort)

Instead of starting the gallop at `bound = 1`, start at a hinted index `h`. The gallop probes `h, h + 1, h + 2, h + 4, h + 8, …`. When merging two sorted runs, the hint is the last matched position in the other run — consecutive matches are very likely to be clustered.

Timsort goes further: it switches **adaptively** between linear scan and galloping based on a counter called `minGallop`. After 7 (default) consecutive losing picks for one side, it switches to galloping. When galloping stops being faster, it decrements `minGallop` and switches back. This adaptive behavior is what makes Timsort excellent on partially sorted real-world data.

We cover the full Timsort merge in `senior.md`.

### 10.3 Backward gallop

For sorted-descending data, or for finding the target when you suspect it's near the **end**, you gallop backward from `n - 1`: `n - 1, n - 2, n - 4, n - 8, …`. Same algorithm, mirrored. Used in Timsort's `mergeHi`.

---

<a name="errors"></a>
## 11. Error Handling

| Error | Cause | Mitigation |
|---|---|---|
| **`bound` overflow** | `bound *= 2` doubles past `INT_MAX` | Cap with `bound = min(bound * 2, n)` or use `int64` |
| **Empty array** | `n = 0`, `arr[0]` would crash | Check `n == 0` first and return -1 |
| **Index 0 not checked** | Algorithm starts at `bound = 1`, missing `arr[0]` | Special-case `arr[0] == target` at the top, or start `bound = 0` (but then doubling needs a `+1`) |
| **Target larger than all** | Gallop runs until `bound >= n`, then binary search returns -1 | Works correctly; just make sure `hi = min(bound, n - 1)` |
| **OOB reads on unknown-size streams** | `reader.get(bound)` with `bound >= length` | The reader contract must return a sentinel (INF) on OOB, not crash |
| **Array not sorted** | Caller's responsibility | Same as binary search — silent wrong answers; add a debug assert if paranoid |
| **`int` overflow in `mid`** | `(lo + hi) / 2` overflows | Same fix as binary search: `lo + (hi - lo) / 2` |

### Why start at `bound = 1` instead of `bound = 0`?

If you start at `bound = 0` and then write `bound *= 2`, you get `bound = 0` forever — infinite loop. Two fixes:
- Special-case `arr[0]` at the top and start the gallop at `bound = 1`. **This is the standard pattern.**
- Or write `bound = bound * 2 + 1` (so `0 → 1 → 3 → 7 → 15 → …`), but then the gallop produces a non-power-of-2 range that complicates the refine phase.

We always use the standard pattern: handle index 0 specially, then gallop from 1.

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Avoid `bound *= 2` overflow.** On 32-bit signed `int`, `bound` overflows past 2³⁰. Write `bound = min(bound * 2, n)` or use `int64`.

2. **Use shift instead of multiplication.** `bound = bound << 1` is equivalent to `bound *= 2` and one cycle faster on some hardware. The JIT will do this for you in Java; Go and Python don't care.

3. **Don't gallop past `n - 1` unnecessarily.** Cap `bound` at `n - 1` immediately when it exceeds — saves one wasted probe.

4. **For tiny arrays (n < 32), use plain binary search.** Exponential search's gallop phase is wasted overhead.

5. **For arrays where target distribution is uniform, use plain binary search.** Exponential search adds constant overhead with no asymptotic gain.

6. **For galloping merges (Timsort), use the adaptive variant.** Pure exponential search is too aggressive when the runs are interleaved evenly.

7. **Cache the last hit position.** When doing many exponential searches on the same array (e.g., merging two sorted streams), restart from the previous hit — this is "galloping with a hint" and can turn O(log p) per query into O(1) per query for clustered queries.

8. **Branch on the special cases up front.** `arr[0]` check saves a wasted gallop iteration when the target is at index 0. The early return is a real performance win for sentinel-heavy queries.

9. **For unbounded streams, design the reader to return INF on OOB rather than throw.** Exception-based control flow in the gallop is 100× slower than a sentinel check.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Document the precondition** — input must be sorted ascending, just like binary search.
- **Always handle index 0 specially** before galloping.
- **Cap `bound` at `n - 1`** during the gallop to avoid OOB reads.
- **Always run a real binary search in phase 2.** Some incorrect implementations write a linear scan in phase 2 — that destroys the O(log p) guarantee.
- **Pick one bound style (inclusive `[lo, hi]` or half-open `[lo, hi)`) for the bisect phase** and stick to it. The bisect is just binary search; all of binary search's pitfalls apply.
- **For unknown-size streams, define the reader contract clearly.** OOB returns INF, never throws.
- **Test the four critical edge cases:** target at index 0; target at index `n - 1`; target greater than all elements; target between two galloping probes.
- **For galloping merges, use the standard adaptive `minGallop` heuristic** — don't reinvent.
- **When in doubt, use binary search.** Exponential search is a specialized tool for unknown-size or front-loaded targets. If you have neither situation, plain binary search is simpler and equally fast.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Input | Expected |
|---|---|---|
| Empty array | `[]`, target = anything | `-1` |
| Single element, match | `[7]`, target = 7 | `0` (handled by special case) |
| Single element, no match | `[7]`, target = 5 | `-1` |
| Target at index 0 | `[3, 5, 7]`, target = 3 | `0` (special case) |
| Target at index 1 | `[3, 5, 7]`, target = 5 | `1` (gallop: `bound = 1`, hit) |
| Target at last index | `[3, 5, 7]`, target = 7 | `2` (gallop overshoots to bound = 4 ≥ n = 3, then bisect [1, 2]) |
| Target larger than all | `[3, 5, 7]`, target = 9 | `-1` (gallop reaches `bound >= n`, bisect returns -1) |
| Target smaller than `arr[0]` | `[3, 5, 7]`, target = 1 | `-1` (special case fails, gallop stops at `bound = 1` because `arr[1] = 5 >= 1`, bisect [0, 1] returns -1) |
| Array length is power of 2 | length 8, target at 6 | `6` (gallop: 1, 2, 4, 8 — hits `bound >= n` at 8, bisect [4, 7]) |
| Array length 1 less than power of 2 | length 7, target at 5 | `5` (gallop: 1, 2, 4, 8 ≥ 7 → bound = 8, bisect [4, 6]) |
| All equal | `[5, 5, 5, 5]`, target = 5 | `0` (special case returns 0 immediately) |
| All equal, target absent | `[5, 5, 5, 5]`, target = 4 | `-1` |
| Two elements, target at 1 | `[3, 7]`, target = 7 | `1` (gallop: `bound = 1`, `arr[1] = 7 >= 7`, bisect [0, 1] returns 1) |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Forgetting to handle index 0.** Starting at `bound = 1` means `arr[0]` is never probed. Add the special case `if arr[0] == target: return 0`.

2. **Linear scan in phase 2.** Some implementations forget to use binary search for the refine phase and instead do `for i in range(bound//2, bound): if arr[i] == target ...`. That destroys the O(log p) guarantee — the algorithm becomes O(p).

3. **Wrong refine range.** Using `[bound / 2, bound]` when `bound >= n` causes OOB. Cap with `hi = min(bound, n - 1)`.

4. **Doubling overflow.** `bound *= 2` on 32-bit `int` can wrap to a negative number, causing `arr[bound]` to throw `ArrayIndexOutOfBoundsException`. Cap with `min(bound * 2, n)`.

5. **Using exponential search when plain binary is fine.** If you know `n` and the target distribution is uniform, exponential search adds 2× overhead with no benefit. Use binary.

6. **Forgetting that the gallop is one-directional.** Exponential search only goes forward. If you suspect the target is near the end of a descending sequence, gallop *backward* from `n - 1`. If unsure, plain binary search.

7. **Galloping with no hint when one is available.** In merge algorithms, the previous matched position is the natural hint. Restarting from `bound = 1` each time wastes log² probes.

8. **OOB exception instead of sentinel in unknown-size readers.** Catching exceptions in the gallop loop is hundreds of times slower than a sentinel check. Design the reader to return INF.

9. **Comparing the wrong relation.** Gallop uses `arr[bound] < target` (strict less than). Using `<=` would skip past the target and force the bisect to find it again — still correct, just slower.

10. **Mixing up `bound` and `bound - 1` in the refine range.** The correct range is `[bound / 2, min(bound, n - 1)]`. `bound / 2` is included; `bound` itself is included only if in-bounds.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
PHASE 1 — GALLOP
    if arr is empty:        return -1
    if arr[0] == target:    return 0
    bound = 1
    while bound < n and arr[bound] < target:
        bound *= 2          (or min(bound*2, n) to avoid overflow)

PHASE 2 — BISECT
    lo = bound / 2
    hi = min(bound, n - 1)
    while lo <= hi:
        mid = lo + (hi - lo) / 2
        if arr[mid] == target:    return mid
        if arr[mid] <  target:    lo = mid + 1
        if arr[mid] >  target:    hi = mid - 1
    return -1

COMPLEXITY
    Time:  O(log p) where p is target's index (or n if absent)
    Space: O(1) iterative
    Probes: 2 × ⌈log₂(p + 1)⌉ worst case

WHEN TO USE
    ✓ Unknown / unbounded length
    ✓ Target likely near the front
    ✓ Galloping merge (Timsort)
    ✗ Random target in known-size array (use binary)
    ✗ Linked list (use linear)
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders the array as horizontal cells and visualizes both phases:

- **Phase 1 (gallop):** the probed indices `1, 2, 4, 8, …` light up in yellow as the gallop expands. The current `bound` is shown with an orange arrow.
- **Phase 2 (bisect):** once the gallop overshoots, the bounded refine range `[bound/2, bound]` is highlighted in blue, and a standard binary-search animation runs inside it with `lo`, `mid`, `hi` pointers.

Statistics show the number of gallop probes, bisect probes, total probes, and the theoretical `2 × ⌈log₂(p + 1)⌉` bound. A speed slider and custom input field let you experiment with different array sizes and target positions.

Run the animation for a target at index 5 in a 100-element array, then again for a target at index 50, and watch the gallop phase's cost change — it's the most intuitive way to see why exponential search beats binary search for front-loaded targets.

---

<a name="summary"></a>
## 18. Summary

- Exponential Search (Galloping / Unbounded Binary Search) is binary search's specialized cousin for sorted data of **unknown length** or with **front-loaded targets**.
- It runs in **two phases**: gallop (double the index until you overshoot the target) then bisect (binary search the bounded range).
- Total time: **O(log p)** where `p` is the target's actual index, **not** the array length `n`. This beats plain binary search when `p << n`.
- For known-size random-target searches, plain binary search is simpler and equally fast.
- For sorted streams, infinite arrays, sorted append-only logs, or galloping merges (Timsort), it is the natural — often the only — choice.
- Common pitfalls: forgetting to special-case index 0, doubling overflow, using a linear scan in phase 2, wrong refine range when `bound >= n`.
- The cheat sheet on §16 is the entire algorithm in 10 lines. Memorize it.

Master exponential search and you can search any sorted sequence — bounded or unbounded, finite or infinite — in optimal asymptotic time. Then the next step is `middle.md`, where we connect it to jump search, see how Timsort uses galloping in production, and prove the Bentley-Yao optimality bound.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Bentley & Yao**, "An Almost Optimal Algorithm for Unbounded Searching," *Information Processing Letters* 5(3), 1976. The original paper introducing exponential search and proving its optimality among comparison-based unbounded searches.
- **Tim Peters**, "Listsort.txt" — the Python source-tree document describing Timsort's merge algorithm and the `minGallop` heuristic. Read alongside `Objects/listobject.c` in CPython.
- **Stefan Edelkamp & Armin Weiß**, "Worst-case Efficient Sorting with QuickMergesort" (2018). Modern analysis of merge variants using galloping.
- **Sedgewick & Wayne**, *Algorithms* 4e, §1.1 (binary search context).
- **LeetCode 702** — Search in a Sorted Array of Unknown Size. The canonical interview problem for exponential search.
- **LeetCode 34, 35, 704** — classical binary search; do these first to ensure phase 2 is solid.
- Continue with `middle.md` for the comparison with jump search, Timsort's adaptive merge, and binary-search-of-the-predicate variants on unbounded ranges.
