# Jump Search (Block Search) — Junior Level

> **Read time: ~30 minutes** · **Audience:** First-year CS students, bootcamp grads, anyone who has already met linear search and binary search and wants to understand the **middle ground** that lives between them.

Jump Search is the algorithm everyone learns **right after** binary search and immediately forgets — until one day they hit a sorted dataset where binary search is *not* the right answer, and then they reach for jump search and look like a wizard. It is the canonical `O(√n)` algorithm: faster than linear, slower than binary, but uniquely well-suited to **forward-only**, **sequential-access**, or **expensive-backward-seek** storage — magnetic tape, paged log files, singly-linked lists with skip pointers, and streaming sorted data.

This document teaches jump search the way you would teach it to a friend who already understands binary search: we start by deriving **why** the block size is `√n` (not `n/4`, not `n/2` — `√n`, exactly), we walk through the algorithm step-by-step on a 16-element array, we cover the three classical variants, we work through the edge cases that trip people up, and we make crystal clear **when** to use jump search and when binary search is still the right answer. By the end, you will be able to write jump search from memory in any language and explain in one sentence why `√n` is the optimal block size.

---

## Table of Contents

1. [Introduction — Between Linear and Binary](#introduction)
2. [Prerequisites — Sorted Data is REQUIRED](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Block Size, Jump Phase, Linear Phase](#core-concepts)
5. [Why `√n`? The One-Line Derivation](#derivation)
6. [Big-O Summary](#big-o-summary)
7. [Real-World Analogies](#analogies)
8. [Pros and Cons](#pros-and-cons)
9. [Step-by-Step Walkthrough](#walkthrough)
10. [Code Examples — Go, Java, Python](#code-examples)
11. [Variants — Fixed, Variable, Multi-Level](#variants)
12. [When Jump Beats Binary](#when-jump-wins)
13. [Performance Tips](#performance-tips)
14. [Best Practices](#best-practices)
15. [Edge Cases](#edge-cases)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Visual Animation Reference](#animation)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Between Linear and Binary

Picture three search strategies on a sorted array of 10,000 elements:

- **Linear search** checks every element from index 0 onward. Worst case: 10,000 comparisons.
- **Binary search** halves the candidate window each step. Worst case: ⌈log₂(10,001)⌉ = 14 comparisons.
- **Jump search** takes giant fixed-size strides — say, 100 indices at a time — until it overshoots the target, then walks **backward one step at a time** inside the last block. Worst case: 100 jumps + 100 linear steps = 200 comparisons.

Linear is **O(n)**. Binary is **O(log n)**. Jump is **O(√n)**. In the canonical hierarchy:

```
linear  O(n)       ▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶  10,000
jump    O(√n)      ▶▶                    200
binary  O(log n)   ▶                     14
```

Jump search sits **strictly between** linear and binary. So why does it exist at all if binary is faster?

Three reasons, each worth understanding:

1. **Binary search needs random access.** It probes positions `n/2`, then `n/4` or `3n/4`, then `n/8` or `3n/8`, etc. — totally unpredictable jumps. On data structures where forward access is cheap but backward access is expensive (magnetic tape, sequential files, singly-linked lists), binary search is *much* slower than the theory suggests. Jump search uses **only forward jumps**, then **only backward linear steps inside a single small block** — much friendlier to such storage.

2. **Jump search has only `O(√n)` "random" probes.** The remaining `O(√n)` work is sequential. On disk-backed data where each seek costs ~10 ms, doing 14 binary-search seeks (140 ms) can be slower than doing `√n = 100` cheap forward steps and then `√n` sequential reads (a single seek plus 100 reads, ~25 ms).

3. **Jump search is the conceptual ancestor of exponential / galloping search** (next topic), of **skip lists** (we'll get there), and of **sqrt decomposition** in competitive programming. Understanding jump search makes those topics click instantly.

In modern in-memory work on RAM arrays, **binary search wins**. Almost always. Jump search is a niche tool — but in its niche, it is the right tool. Learn it for the niche and for the conceptual leverage.

---

<a name="prerequisites"></a>
## 2. Prerequisites — Sorted Data is REQUIRED

Like binary search, jump search **only works on sorted data**. The "I overshot, the target must be in the last block" logic depends on the array being monotonically non-decreasing (or non-increasing — just flip the comparisons).

You also need:

1. **A sorted sequence.** Ascending or descending; pick one and adjust the comparison.
2. **Random access OR cheap forward iteration with cheap "rewind one block".** Pure arrays satisfy this trivially. Linked lists with backward pointers (doubly linked lists) qualify. Sequential streams that allow seek-to-position do too. Pure forward iterators (without buffering the last block) do **not**.
3. **A total order.** Same as binary search — `NaN`, partial orders, and inconsistent comparators break the algorithm.

If your data is not sorted, sort it first or use a hash table (for exact-match) or linear search (for one-off small searches).

**When to choose jump over binary** (preview — full discussion in §12):
- Forward seeks are cheap but backward seeks are expensive (tape, append-only logs).
- You have a **sorted singly-linked list with skip pointers** spaced `√n` apart.
- The access pattern matters more than the asymptotic comparison count (cache, prefetch, sequential bandwidth).
- The data structure is conceptually defined by blocks (sqrt decomposition).

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Block** | A contiguous group of `m` consecutive elements. Jump search treats the array as `⌈n/m⌉` blocks. |
| **Block size `m`** | Number of elements per block. Optimal value is `⌊√n⌋`. |
| **Jump phase** | The first phase: skip forward by `m` indices repeatedly until the current element is ≥ target (or you fall off the end). |
| **Overshoot** | The condition `arr[step] ≥ target` (or end of array). Marks the **end** of the block that must contain the target if it exists. |
| **Linear (back-scan) phase** | The second phase: starting from the previous block boundary, walk forward one element at a time until you find the target or pass it. |
| **Sorted predecessor block** | The block ending at index `step - 1`. The block where the target, if present, **must** lie. |
| **Block boundary** | An index that is a multiple of `m`: `0, m, 2m, 3m, ...`. The jump phase only ever inspects block boundaries. |
| **Sentinel** | A virtual value at position `n` (out of bounds) treated as `+∞` to simplify the overshoot check. |
| **Two-phase search** | A general pattern: coarse-grained scan + fine-grained scan inside the located region. Jump search is the simplest instance. |
| **Sqrt decomposition** | A broader family of `O(√n)` algorithms (range queries, Mo's algorithm) that all split the data into `√n`-sized blocks. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Block Size, Jump Phase, Linear Phase

### 4.1 The two phases

Jump search has exactly two phases, and you must understand both as a single connected unit:

**Phase 1 — Jump phase:**
```
step = m                         # m = ⌊√n⌋
prev = 0
while step < n and arr[step - 1] < target:
    prev = step
    step += m
```

We jump by `m` indices at a time. We stop when either (a) we fell off the end of the array, or (b) the element at the **right edge** of the current block is `≥ target`. At that moment, the target (if present) must live in `[prev, step - 1]`.

Why check `arr[step - 1]` and not `arr[step]`? Both work; the version above keeps `step` as a "next block start" pointer, which feels natural and avoids one off-by-one. Many textbook versions use `arr[step]` and shift conventions; we'll cover both in §10.

**Phase 2 — Linear phase:**
```
while prev < min(step, n) and arr[prev] < target:
    prev += 1
if prev < n and arr[prev] == target:
    return prev
return -1
```

We linear-scan the block `[prev, min(step, n))`. If the target is there, we return its index. If we step past it (i.e., we find an element strictly greater than the target), or we reach the block end without a match, the target is absent.

### 4.2 The shape of the algorithm

Visually, jump search looks like this on an array of size 16 with block size 4:

```
indices: 0  1  2  3 | 4  5  6  7 | 8  9 10 11 |12 13 14 15
         ^           ^           ^           ^
         block 0     block 1     block 2     block 3
```

The jump phase visits indices `3, 7, 11, 15` (the **right edges** of each block — version A). The linear phase, once we overshoot, walks backward from the overshoot point to the previous edge and forward through the block.

### 4.3 Three constants to remember

- `n` — array length.
- `m` — block size; optimal `m = ⌊√n⌋`.
- `step` — current jump position; advances by `m` each jump.

Everything else is derivative.

---

<a name="derivation"></a>
## 5. Why `√n`? The One-Line Derivation

Let `m` be the block size. Worst-case cost is:

```
Cost(m) = (number of jumps) + (size of one block)
       = ⌈n/m⌉ + (m - 1)
       ≈ n/m + m
```

This is a function of `m`. Take the derivative with respect to `m`:

```
d/dm (n/m + m) = -n/m² + 1
```

Set to zero:
```
-n/m² + 1 = 0
m² = n
m = √n
```

The total cost at the optimum is:
```
Cost(√n) = n/√n + √n = √n + √n = 2√n
```

So jump search makes **at most ~2√n comparisons** in the worst case, dropping the constant: **O(√n)**.

### Why exactly `√n` and not anything else?

The cost function `f(m) = n/m + m` is a classic AM-GM scenario. By the inequality of arithmetic and geometric means:

```
n/m + m  ≥  2 · √((n/m) · m)  =  2 · √n
```

with equality iff `n/m = m`, i.e., `m = √n`. Any other choice of `m` makes one phase (jumps or backscan) longer than the other and the total worse.

### Concrete numbers

| `n` | `√n` | Linear | Jump (≈ 2√n) | Binary |
|---|---|---|---|---|
| 16 | 4 | 16 | 8 | 5 |
| 100 | 10 | 100 | 20 | 7 |
| 10,000 | 100 | 10,000 | 200 | 14 |
| 1,000,000 | 1,000 | 1,000,000 | 2,000 | 20 |
| 10⁹ | ~31,623 | 10⁹ | ~63,246 | 30 |

Jump search scales much better than linear and noticeably worse than binary. The crossover where jump becomes worth it over linear is around `n ≈ 50`; the crossover where binary beats jump on RAM is *always* — binary wins on raw comparisons for any `n ≥ 1`. Jump only wins on **access cost**, not on comparison count.

### What if `m` is suboptimal?

Pick `m = √n / 2` (too small): you do `2√n` jumps and `√n/2` linear steps. Total ≈ `2.5 · √n`. Worse.

Pick `m = 2√n` (too big): you do `√n/2` jumps and `2√n` linear steps. Total ≈ `2.5 · √n`. Same penalty.

Pick `m = n^(1/3)`: total ≈ `n^(2/3) + n^(1/3)` ≈ `n^(2/3)` — much worse, because the jump phase dominates.

Pick `m = log n`: total ≈ `n/log n + log n` — basically linear. Useless.

Only `m = √n` (or very close) gives `O(√n)`. This is why jump search is sometimes called **`√n`-search**.

---

<a name="big-o-summary"></a>
## 6. Big-O Summary

| Aspect | Complexity |
|---|---|
| **Best case** | O(1) — target lies at the first jump boundary |
| **Average case** | O(√n) |
| **Worst case** | O(√n) ≈ 2√n comparisons |
| **Space (iterative)** | O(1) — a handful of integer variables |
| **Comparisons (jump phase, worst)** | ⌈√n⌉ |
| **Comparisons (linear phase, worst)** | ⌊√n⌋ |
| **Comparisons (total, worst)** | ≤ 2⌈√n⌉ |
| **Forward seeks** | O(√n) |
| **Backward seeks** | 0 (jump phase) + O(√n) (linear phase, all within one block) |
| **Random-access requirement** | YES (but only at block boundaries during jump phase) |
| **Requires sorted input** | YES |

For `n = 1,000,000`: ~2,000 comparisons. For `n = 1,000,000,000`: ~63,000 comparisons. The square root grows slowly but not as slowly as the logarithm.

---

<a name="analogies"></a>
## 7. Real-World Analogies

### 7.1 Skimming a book by chapter

You want to find the chapter that introduces the word "Stoicism" in a 800-page philosophy book. You don't read every page (linear) and you don't randomly flip (binary requires knowing the structure). Instead, you flip in **chunks of ~30 pages**, glancing at the first page of each chunk. Once you overshoot the topic, you back up and read the previous chunk carefully. That is jump search with block size ~30.

### 7.2 Scanning a fence for the right plank

A 100-meter fence with painted planks, looking for the one marked "12345". You walk forward in 10-meter strides, glancing at the plank under your feet at each stop. Once you see a number greater than 12345, you back up 10 meters and walk plank-by-plank. Jump phase = 10 strides. Linear phase = up to 10 planks. Total ≈ 20 steps, vs. 100 for linear.

### 7.3 Magnetic tape

This is the **historical** use case. On magnetic tape, forward rewind is fast (the motor only spins one direction efficiently); backward rewind requires reversing the motor, much slower. So you fast-forward in 1-second bursts, sampling what's there. Once you overshoot the timestamp you want, you slow-rewind through the last burst until you find the event. Modern SSDs have killed this use case for RAM-scale data, but if you ever build a tape-archive system (yes, AWS Glacier is partly tape), the design still applies.

### 7.4 Looking for an entry in a sorted log file with newline-aligned blocks

If you have a 100 GB sorted log file but you don't want to do 30 random seeks (binary search), you might use jump search: seek to byte offsets `0, 1MB, 2MB, 3MB, ...`, read the first line at each offset to get the timestamp, jump until you overshoot, then linear-scan within the 1 MB block. Each seek is ~10 ms; reading 1 MB sequentially is ~5 ms. Jump search does ~30 seeks + 1 linear scan = ~305 ms. Binary search does ~30 seeks + 30 ~5KB-context reads = ~300 ms — almost identical, but the linear scan of jump search is more cache-friendly (sequential prefetch wins).

### 7.5 Galloping search in TimSort

Java's TimSort and Python's old `list.sort()` use a variant called **galloping search** — start with step 1, then 2, 4, 8, 16, ... (doubling). This is *exponential search*, the next topic. It's a generalization of jump search where the block size grows geometrically rather than staying at `√n`.

---

<a name="pros-and-cons"></a>
## 8. Pros and Cons

### Pros
- **`O(√n)` time** — strictly better than linear on large arrays.
- **Only forward jumps** during the coarse phase. Friendly to forward-iterator storage.
- **Only backward steps within one block**, so total backward movement is bounded by `√n` — important on tape, paged storage, or anything where backward seeks cost more than forward.
- **Tiny memory**: O(1) — a few integer variables.
- **Trivial to implement**: 10-line algorithm, no off-by-one nightmares like the `lo < hi` vs `lo <= hi` debates of binary search.
- **Conceptual gateway** to sqrt decomposition, skip lists, and galloping search.
- **No integer-overflow trap** — no `mid = (lo + hi) / 2` to mess up.
- **Predictable backward seek distance** (≤ `√n` per query), useful when backward I/O is metered.

### Cons
- **Slower than binary search on RAM**. The `O(√n)` comparison count is much worse than `O(log n)` once `n > ~16`.
- **Requires sorted input.** Same constraint as binary search.
- **Picking the wrong block size kills performance.** `m = n/2` or `m = 1` makes it equivalent to linear search.
- **Linear phase has unpredictable branches.** Not as cache-friendly as a single contiguous sequential read.
- **Not adaptive.** Plain jump search doesn't speed up when the target is near index 0 (exponential search does).
- **Useless on un-sorted or randomly distributed data.**
- **No clear win on modern in-RAM workloads.** For `n` that fits in RAM and supports random access, binary search is essentially always better.

---

<a name="walkthrough"></a>
## 9. Step-by-Step Walkthrough

Search for `target = 55` in the sorted array:

```
arr   = [0, 1, 4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144, 169, 196, 225]
index =  0  1  2  3   4   5   6   7   8   9   10   11   12   13   14   15
```

`n = 16`, so `m = ⌊√16⌋ = 4`. Blocks: `[0..3]`, `[4..7]`, `[8..11]`, `[12..15]`.

### Jump phase

```
step = 4, prev = 0
arr[step - 1] = arr[3] = 9. Is 9 < 55? YES → jump again.
    prev = 4, step = 8.

arr[step - 1] = arr[7] = 49. Is 49 < 55? YES → jump again.
    prev = 8, step = 12.

arr[step - 1] = arr[11] = 121. Is 121 < 55? NO → stop jumping.
```

After the jump phase: `prev = 8, step = 12`. The target, if present, lies in `[8, 11]`.

Jump comparisons so far: 3.

### Linear phase

Walk `prev` forward from 8:
```
arr[8]  = 64.  Is 64 < 55? NO. Stop walking.
```

Now check exact match:
```
arr[8] = 64, target = 55. Not equal → return -1.
```

Total: 3 jump comparisons + 1 linear comparison = 4. Versus binary search's 4 (`⌈log₂(17)⌉ = 5`), and versus linear search's 9 (would scan indices 0..8 to confirm 55 is not present). Jump is competitive here on a tiny array.

### A successful search

Now search for `target = 81` in the same array:

```
Jump 1: step = 4, arr[3] = 9 < 81 → continue. prev=4, step=8.
Jump 2: step = 8, arr[7] = 49 < 81 → continue. prev=8, step=12.
Jump 3: step = 12, arr[11] = 121. 121 < 81? NO → stop. Block = [8, 11].

Linear scan from prev=8:
    arr[8] = 64. 64 < 81 → prev=9.
    arr[9] = 81. 81 == 81 → return 9.
```

Found at index 9 with 3 jumps + 2 linear comparisons = 5 total.

### A successful boundary search

Search for `target = 121` (which lives at index 11, exactly at a block boundary in version A):

```
Jump 1: step=4,  arr[3]=9  < 121 → continue. prev=4, step=8.
Jump 2: step=8,  arr[7]=49 < 121 → continue. prev=8, step=12.
Jump 3: step=12, arr[11]=121. Is 121 < 121? NO → stop.
                  Block = [8, 11].

Linear scan from prev=8:
    arr[8]=64  < 121 → prev=9.
    arr[9]=81  < 121 → prev=10.
    arr[10]=100 < 121 → prev=11.
    arr[11]=121 == 121 → return 11.
```

Found at index 11 with 3 jumps + 4 linear comparisons = 7 total.

This is the worst case for a block: 3 jumps + 4 linear = `2 · √16 - 1`. Right at the predicted bound `2√n - 1`.

---

<a name="code-examples"></a>
## 10. Code Examples — Go, Java, Python

### 10.1 Classic jump search (fixed `√n` block size)

**Go:**
```go
package jumpsearch

import "math"

// JumpSearch returns the index of target in a sorted slice, or -1 if absent.
// The slice MUST be sorted in ascending order.
func JumpSearch(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }

    // Phase 1: jump forward in blocks of m until we overshoot or run out.
    prev := 0
    step := m
    for step < n && arr[step-1] < target {
        prev = step
        step += m
    }

    // Phase 2: linear scan inside [prev, min(step, n)).
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if arr[i] == target {
            return i
        }
        if arr[i] > target {
            return -1
        }
    }
    return -1
}
```

**Java:**
```java
public final class JumpSearch {
    private JumpSearch() {}

    /**
     * Returns the index of target in a sorted array, or -1 if absent.
     * Array MUST be sorted ascending.
     */
    public static int search(int[] arr, int target) {
        int n = arr.length;
        if (n == 0) return -1;

        int m = Math.max(1, (int) Math.sqrt(n));

        // Phase 1: jump in blocks of m.
        int prev = 0;
        int step = m;
        while (step < n && arr[step - 1] < target) {
            prev = step;
            step += m;
        }

        // Phase 2: linear scan inside [prev, min(step, n)).
        int end = Math.min(step, n);
        for (int i = prev; i < end; i++) {
            if (arr[i] == target) return i;
            if (arr[i] > target) return -1;
        }
        return -1;
    }
}
```

**Python:**
```python
import math

def jump_search(arr: list[int], target: int) -> int:
    """Return the index of target in a sorted list, or -1 if absent.
    arr MUST be sorted ascending."""
    n = len(arr)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))

    # Phase 1: jump forward in blocks of m.
    prev = 0
    step = m
    while step < n and arr[step - 1] < target:
        prev = step
        step += m

    # Phase 2: linear scan inside [prev, min(step, n)).
    for i in range(prev, min(step, n)):
        if arr[i] == target:
            return i
        if arr[i] > target:
            return -1
    return -1
```

### 10.2 The "block right-edge" convention (most textbooks)

The version above keeps `step` pointing at the **next block start** (so we check `arr[step - 1]`). Many textbooks use a different convention where `step` points at the **current block right-edge**:

**Python:**
```python
import math

def jump_search_textbook(arr, target):
    n = len(arr)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))

    # Phase 1: step is the right-edge index of the current block.
    step = m
    prev = 0
    while step < n and arr[min(step, n) - 1] < target:
        prev = step
        step += m
        if prev >= n:
            return -1

    # Phase 2: linear scan from prev forward.
    while prev < min(step, n) and arr[prev] < target:
        prev += 1

    if prev < n and arr[prev] == target:
        return prev
    return -1
```

Both versions are correct; they differ in exactly which boundary `step` represents. **Pick one and stick with it** in a codebase — mixing them is exactly like mixing inclusive and half-open bounds in binary search.

### 10.3 Returning the insertion point (jump-lower-bound)

If, instead of `-1`, you want the index where `target` would be inserted to keep the array sorted:

**Go:**
```go
func JumpLowerBound(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return 0
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev := 0
    step := m
    for step < n && arr[step-1] < target {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if arr[i] >= target {
            return i
        }
    }
    return n
}
```

**Java:**
```java
public static int jumpLowerBound(int[] arr, int target) {
    int n = arr.length;
    if (n == 0) return 0;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && arr[step - 1] < target) {
        prev = step;
        step += m;
    }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) {
        if (arr[i] >= target) return i;
    }
    return n;
}
```

**Python:**
```python
import math

def jump_lower_bound(arr, target):
    n = len(arr)
    if n == 0:
        return 0
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and arr[step - 1] < target:
        prev = step
        step += m
    end = min(step, n)
    for i in range(prev, end):
        if arr[i] >= target:
            return i
    return n
```

### 10.4 Find first occurrence with duplicates

When the array contains duplicates and you want the **smallest** index with `arr[i] == target`, the simplest correct approach is to compute `jump_lower_bound(arr, target)` and check whether the returned index actually holds the target:

**Python:**
```python
def jump_find_first(arr, target):
    i = jump_lower_bound(arr, target)
    if i < len(arr) and arr[i] == target:
        return i
    return -1
```

This is the same trick binary search uses — `bisect_left` plus an existence check.

---

<a name="variants"></a>
## 11. Variants — Fixed, Variable, Multi-Level

### 11.1 Fixed block size `√n`

The classic version. Block size is computed once and never changes. Worst case `2√n`. Best when you know `n` up front and forward seeks are cheap.

### 11.2 Variable block size (`√n` then `√(remaining)`)

Start with block size `√n`. After overshooting, the block has size `√n`. Inside it, you can do a recursive jump search with block size `√(√n) = n^(1/4)`. Total: `√n + n^(1/4) + n^(1/8) + ...` — converges to roughly `2√n`, but the constant inside the linear phase improves.

Implementation is more complex and rarely worth it in practice — the savings are constant-factor, and binary search inside the block gives `√n + log(√n) = √n + (1/2)log n`, which is essentially `√n` for any realistic `n` and easier to write.

**Python:**
```python
import math

def jump_search_hybrid(arr, target):
    """Jump to find block, then BINARY search inside the block."""
    n = len(arr)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and arr[step - 1] < target:
        prev = step
        step += m
    # Binary search inside [prev, min(step, n))
    lo, hi = prev, min(step, n) - 1
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

This is `O(√n + log √n) = O(√n)`. The constant on the linear phase improves from `√n` to `(1/2) log n`. Useful only when the linear phase is the bottleneck and the block fits in cache.

### 11.3 Multi-level (cubic) jump search

Pick block size `m = n^(1/3)`. Outer jumps: `n / n^(1/3) = n^(2/3)`. That's worse than `√n`. So pure cubic jumps are bad. But: do **two levels** of jumps. Outer block `n^(1/3)`, inner block `n^(1/3)`, final linear `n^(1/3)`. Total: `3 · n^(1/3) = O(n^(1/3))`.

This generalizes to `k-level jump search` with cost `O(k · n^(1/(k+1)))`. As `k → log n`, this becomes `O(log n)` — and we have rediscovered binary search.

**Educational takeaway:** jump search with two levels is a `O(n^(1/3))` algorithm, three levels is `O(n^(1/4))`, etc. Binary search is the limit as the level count grows. This is why people sometimes describe jump search as a "stepping stone to binary search".

**Python (two-level, didactic):**
```python
def jump_search_two_level(arr, target):
    n = len(arr)
    if n == 0:
        return -1
    big = max(1, round(n ** (2/3)))
    small = max(1, round(n ** (1/3)))

    # Outer jumps by `big`
    prev = 0
    step = big
    while step < n and arr[step - 1] < target:
        prev = step
        step += big

    # Middle jumps by `small`
    end = min(step, n)
    mid_step = prev + small
    mid_prev = prev
    while mid_step < end and arr[mid_step - 1] < target:
        mid_prev = mid_step
        mid_step += small

    # Final linear scan
    for i in range(mid_prev, min(mid_step, n)):
        if arr[i] == target:
            return i
        if arr[i] > target:
            return -1
    return -1
```

In practice, you never use this. But seeing the structure clarifies why `√n` is the sweet spot for one-level jump search.

### 11.4 Backward-only jump search (search in descending order)

If the array is sorted in **descending** order, flip the comparisons. The structure is identical; only `<` becomes `>` in the loop conditions. Useful when scanning "most recent first" sorted streams.

---

<a name="when-jump-wins"></a>
## 12. When Jump Beats Binary

This is the section everyone asks about. Binary search is `O(log n)`; jump search is `O(√n)`. So when does the slower asymptotic algorithm win?

### 12.1 Forward seeks cheap, backward seeks expensive

The flagship case. Magnetic tape, append-only logs, mechanical disks under specific access patterns, network paged data. Binary search does ~`log n` *random* probes that can go forward or backward unpredictably. Jump search does `√n` purely **forward** probes during the jump phase, and only does backward probes during the linear scan **within a single small block** — so the total backward movement is bounded by `√n` cells, never crossing block boundaries.

If forward access costs `f` and backward access costs `b >> f`, jump search wins whenever:
```
b · log n  >  f · 2√n
i.e., b/f > 2√n / log n
```
For `n = 10⁶`, `2√n / log n ≈ 2000 / 20 = 100`. So if backward seeks are >100× more expensive than forward, jump search wins.

### 12.2 Sorted singly-linked lists with skip pointers

A plain singly-linked list cannot be binary-searched in `O(log n)` because each `mid` access costs `O(n)`. But: if you augment the list with **skip pointers** spaced `√n` apart (every `√n`-th node knows a direct pointer to the next `√n`-th node), then jump search becomes natural:

```
1 → 4 → 9 → 16 → 25 → 36 → 49 → 64 → 81 → 100
↓                 ↓                  ↓
 skip-4 ━━━━━━━━━━ skip-4 ━━━━━━━━━━ ...
```

You jump along the skip-pointer chain (O(√n)), then walk through the sublist (O(√n)). Total `O(√n)`. This is the conceptual ancestor of **skip lists**, which use multiple levels and randomization to achieve `O(log n)` expected.

### 12.3 Streaming sorted data where seek-back is metered

Reading from S3 with byte-range requests. Each request has fixed overhead. Binary search needs ~`log n` requests; jump search needs `√n` requests but they're all forward, so you can pipeline them and stream the resulting block sequentially.

For `n = 10⁹` items in a sorted file with 4 KB pages: binary needs ~30 random reads (each ~10 ms = 300 ms total); jump needs ~31,000 sequential reads at megabytes/second (~30 ms streamed) + one block scan. Jump wins by an order of magnitude on bandwidth-bounded storage.

### 12.4 SIMD-accelerated linear scan inside blocks

When the linear phase fits in cache, modern CPUs can compare 8–16 elements per cycle using SIMD (`_mm256_cmpgt_epi32`, NEON's `vceqq_s32`). Suddenly the `√n` linear phase costs only `√n / 16` cycles, while binary search's `log n` probes each cause an L1 cache miss. For arrays of ~10⁵ ints, jump search with SIMD can beat naive binary search.

### 12.5 When you're already doing block-aligned bookkeeping

In **sqrt decomposition** for range queries on a mutable array (sum / max / xor over `[l, r]`), the array is conceptually split into `√n` blocks with per-block aggregates. Searching within this layout uses jump-search-like patterns naturally — you don't pay extra for the block structure because it's already there.

### 12.6 The honest answer for in-RAM arrays today

**Binary search wins**. The L3 cache, branch predictor, and 64-bit address space make `log n` comparisons trivial. Jump search on an in-RAM `int[]` is an academic curiosity. The interesting cases are all in I/O-bound, restricted-access, or block-structured settings.

---

<a name="performance-tips"></a>
## 13. Performance Tips

1. **Use `int(math.sqrt(n))` carefully.** In Go, `math.Sqrt` returns `float64`; for very large `n`, integer rounding can off-by-one. Prefer `math.isqrt` in Python (3.8+), and a hand-rolled integer-sqrt or `(int) Math.sqrt(n)` with a check in Java/Go.

2. **Clamp `m ≥ 1`.** If `n = 1`, `√n = 1`, fine. If you accidentally compute `m = 0` (e.g., from float rounding on `n = 0` or `n = 1`), the jump phase loops forever or skips the array entirely.

3. **Special-case `n == 0`.** Return `-1` immediately. Don't divide by zero.

4. **For tiny arrays (n < 16), just use linear search.** The overhead of computing `√n` and the branch mispredicts of the jump loop cost more than 16 sequential comparisons.

5. **For large RAM arrays, use binary search.** Don't reach for jump search out of pedagogical attachment.

6. **For sorted files on disk, prefer block sizes aligned to the underlying page** (4 KB, 16 KB) rather than the literal `√n`. The `√n` formula is a theoretical optimum that ignores I/O block alignment; in practice you want `m` such that one block = one I/O unit.

7. **Combine with binary search.** The hybrid in §11.2 (jump to find the block, then binary search inside) is `O(√n + log √n) = O(√n)` in the worst case but with a much smaller constant on the linear phase.

8. **Don't use `for i in range(prev, step)` if `step > n`.** Always clamp the loop bound with `min(step, n)`.

---

<a name="best-practices"></a>
## 14. Best Practices

- **Document the precondition.** Every jump-search function should declare "input MUST be sorted ascending" in its docstring.
- **Always compute `m = max(1, isqrt(n))`** — avoid `m = 0`.
- **Use `min(step, n)` when bounding the linear phase** — otherwise you read past the end.
- **Prefer the lower-bound variant for the linear phase** — break on `arr[i] > target`, not just on `arr[i] == target`. This handles "not found" in `O(√n)` worst case instead of degrading to `O(n)` for missing targets that happen to fall into the last block.
- **Document which `step` convention you use** (right-edge vs. next-block-start). Avoid mixing.
- **Use built-in binary search instead** unless you have a specific reason to use jump.
- **Benchmark before claiming a win.** On modern RAM, jump search is almost always slower than binary search — quantify it before adopting jump for "performance".

---

<a name="edge-cases"></a>
## 15. Edge Cases

| Case | Input | Expected |
|---|---|---|
| Empty array | `[]`, target = anything | `-1` |
| Single element, match | `[7]`, target = 7 | `0` |
| Single element, miss | `[7]`, target = 5 | `-1` |
| Single element, miss above | `[7]`, target = 9 | `-1` |
| Target less than first | `[3, 5, 7]`, target = 1 | `-1` |
| Target greater than last | `[3, 5, 7]`, target = 9 | `-1` (loop exits with `step ≥ n`) |
| Target at first index | `[3, 5, 7, 9]`, target = 3 | `0` |
| Target at last index | `[3, 5, 7, 9]`, target = 9 | `3` |
| Target at block boundary | `[1, 2, 3, 4, 5, 6, 7, 8, 9]`, target = 3 | `2` (correct boundary handling) |
| `n` not a perfect square | `[1..10]`, target = 7 | `6` (m = 3, blocks 0-2, 3-5, 6-8, 9) |
| All duplicates, match | `[5, 5, 5, 5]`, target = 5 | `0` (or first found; index 0 with lower-bound variant) |
| Duplicates, miss | `[5, 5, 5, 5]`, target = 4 | `-1` |
| Negative values | `[-9, -3, 0, 4]`, target = -3 | `1` |
| Very large `n`, target near front | `n=10⁶`, target at index 100 | Found in ~1 jump + ~100 linear = 101 comparisons (jump search is *not* adaptive — see exponential search for adaptive variant) |
| Target == element at jump boundary | `[1, 2, 3, 4]` with m=2, target=2 (at index 1, end of block 0) | Found at index 1; jump phase stops at first iteration, linear scan finds it |

---

<a name="common-mistakes"></a>
## 16. Common Mistakes

1. **Using `m = 0` when `n` is 0 or 1.** Always `m = max(1, isqrt(n))`. Otherwise infinite loop or division error.
2. **Forgetting to clamp the linear phase.** `for i in range(prev, step)` reads past the end when `step > n`. Use `min(step, n)`.
3. **Mixing `step` conventions.** Some textbooks use `step` as the *next block start* (check `arr[step - 1]`); others use it as *current block right edge* (check `arr[step]`). Pick one.
4. **Using float `sqrt` without rounding.** `int(math.sqrt(n))` for `n` near a perfect square can return `m - 1` due to floating-point rounding. Prefer integer `isqrt` or check `m * m <= n < (m+1) * (m+1)`.
5. **Returning early on `arr[mid] > target` in the jump phase.** The jump phase should keep walking forward (or stop and switch to linear). Don't return `-1` just because the current jump overshoots — the target may still be in the previous block.
6. **Linear phase that misses the last block.** If the loop exits the jump phase because `step ≥ n`, the last block is `[prev, n - 1]`, not `[prev, step - 1]`. The fix is `for i in range(prev, min(step, n))`.
7. **Treating jump search as adaptive.** Jump search is `O(√n)` worst case **regardless** of where the target is. Even for targets at index 0, you do at least one comparison. For adaptivity (work proportional to target position), use exponential search.
8. **Applying jump search to a singly-linked list without skip pointers.** Each jump still costs `O(m)`, so total jump phase is `O(n/m · m) = O(n)`. No improvement over linear.
9. **Forgetting jump search needs sorted data.** Same silent-bug class as binary search.
10. **Choosing `m` from the size of the data type instead of the array.** A common bug: `m = sqrt(MAX_INT)` instead of `sqrt(n)`. Compute `m` from `len(arr)`, not from value ranges.

---

<a name="cheat-sheet"></a>
## 17. Cheat Sheet

```
SETUP
    n = len(arr)
    m = max(1, isqrt(n))           # block size = ⌊√n⌋
    prev = 0
    step = m                       # right-edge index of current block (+1)

JUMP PHASE (forward, by blocks of m)
    while step < n and arr[step - 1] < target:
        prev = step
        step += m

LINEAR PHASE (forward, inside one block)
    end = min(step, n)
    for i in [prev, end):
        if arr[i] == target: return i
        if arr[i] >  target: return -1    # short-circuit
    return -1

COMPLEXITY
    Time:   O(√n)        ≈ 2√n comparisons worst-case
    Space:  O(1)
    Forward seeks: O(√n)
    Backward seeks (inside one block): O(√n)

POSITION IN HIERARCHY
    linear  O(n)      ←  jump  O(√n)  ←  binary  O(log n)

DERIVATION OF √n
    Cost(m) = n/m + m
    d/dm   = -n/m² + 1 = 0
    m*     = √n
    cost*  = 2√n

WHEN TO USE
    - Forward seeks cheap, backward seeks expensive
    - Singly-linked list + skip pointers spaced √n apart
    - Streaming sorted data with metered seek-back
    - Sqrt decomposition / block-aligned workloads
    - NOT for in-RAM random-access arrays (binary search wins)
```

---

<a name="animation"></a>
## 18. Visual Animation Reference

See `animation.html` in this folder. It renders the array as horizontal cells, color-codes the jump phase (yellow), the overshoot detection (red), and the linear back-scan inside the located block (green). A speed slider, custom input field, and target field let you experiment. Stats display the iteration count, jump comparisons, linear comparisons, the theoretical `2⌈√n⌉` bound, and the current block under inspection.

Walking through a 25-element search step by step on the animation makes the two-phase structure click in a way that reading code does not.

---

<a name="summary"></a>
## 19. Summary

- Jump search finds an element in a **sorted** array in `O(√n)` time and `O(1)` space by skipping forward in fixed blocks of size `m = ⌊√n⌋`, detecting overshoot, then linear-scanning the previous block.
- The block size `√n` is optimal: the cost function `n/m + m` is minimized at `m = √n` by AM-GM (or one-line calculus). Any other choice gives a worse constant.
- Jump search lives strictly between linear (`O(n)`) and binary (`O(log n)`). For random-access RAM arrays, binary search is always better. Jump's niche is **forward-cheap / backward-expensive storage**, **skip-pointered linked lists**, **streaming sorted data**, and **sqrt decomposition**.
- The two-phase structure (jump phase + linear phase) is a template that reappears in exponential search, skip lists, and `√n` decomposition. Internalizing it pays off later.
- Pitfalls are simpler than binary search's: clamp `m ≥ 1`, clamp the linear bound with `min(step, n)`, document your `step` convention. No integer-overflow trap, no `lo < hi` vs `lo <= hi` debate.

Once you have jump search in your head, **exponential / galloping search** (doubling instead of fixed `√n`), **skip lists** (multi-level skip pointers with `log n` expected lookup), and **fractional cascading** (cross-array shared structure) become natural extensions.

---

<a name="further-reading"></a>
## 20. Further Reading

- **Shneiderman**, "Jump Searching: A Fast Sequential Search Technique" (CACM, 1978). The original paper introducing block search with rigorous analysis of optimal block size.
- **Knuth**, *The Art of Computer Programming, Volume 3: Sorting and Searching*, §6.2.1. Touches jump search alongside other "block / multi-level" search variants.
- **Sedgewick & Wayne**, *Algorithms*, 4th ed., §3.1 — comparison of search algorithms, with jump search as an interlude before binary search.
- **Bentley & Yao**, "An Almost Optimal Algorithm for Unbounded Searching" (1976). Introduces exponential search, the direct successor of jump search.
- **Pugh**, "Skip Lists: A Probabilistic Alternative to Balanced Trees" (1990). The randomized multi-level generalization of jump-with-skip-pointers.
- **LeetCode** problems with skip-pointer / block patterns: 1146 ("Snapshot Array"), 981 ("Time-Based Key-Value Store") — both use sorted arrays with periodic boundary jumping.
- Continue with `middle.md` for the variant family: block sizes other than `√n`, jump-then-binary hybrids, jump on linked lists with skip pointers, and the deep comparison with exponential search.
