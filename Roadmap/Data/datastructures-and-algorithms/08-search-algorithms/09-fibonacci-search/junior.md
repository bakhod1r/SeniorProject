# Fibonacci Search — Junior Level

> **Read time: ~30 minutes** · **Audience:** Students who already know binary search and want to learn a historical, division-free cousin of it that still has practical use cases in optimization and embedded systems.

Fibonacci Search is one of the most beautiful "rediscovered" algorithms in computer science. It is **almost** binary search — it searches a sorted array in O(log n) time, just like binary search — but it picks its probe positions using **Fibonacci numbers** instead of the midpoint. The probe is not at the dead center of the window; it is at roughly the **golden-ratio point** (~0.618 of the way through). This sounds like an academic curiosity, and on a modern desktop CPU running RAM-resident integer arrays, it largely is — binary search wins by a few percent. But Fibonacci search has two genuine superpowers that explain why Knuth dedicated an entire section of *TAOCP* Vol. 3 to it:

1. **It uses only addition and subtraction.** No division, no multiplication. On hardware where division is expensive (early computers, embedded MCUs, some FPGAs) or simply absent, Fibonacci search is dramatically faster than binary search.
2. **It probes asymmetrically.** Each step, it eliminates ~0.382 or ~0.618 of the window. This is the right choice when the **cost of reading from the smaller half is much lower than the cost of reading from the larger half** — exactly the situation on magnetic tape, on disk when the read head is already positioned, in NUMA memory, and in cache hierarchies where one half is hot.

This document teaches Fibonacci search from scratch. We will derive the Fibonacci numbers, explain why three consecutive Fibonacci numbers `Fm-2, Fm-1, Fm` carve the array into the right pieces, walk through a worked example, write the algorithm in Go, Java, and Python, prove the O(log n) complexity, compare it to binary search head-to-head, and explain when it actually wins in real systems. The continuous analogue — **golden-section search** — appears at the end and is one of the cornerstones of numerical optimization.

---

## Table of Contents

1. [Introduction — Why an Algorithm Without Division?](#introduction)
2. [Prerequisites — Fibonacci Numbers and the Golden Ratio](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Fm, Fm-1, Fm-2 and the Asymmetric Window](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Historical Motivation — Knuth, Tape Drives, and Slow Division](#history)
11. [Error Handling — Overflow, Empty Input, Unsorted Data](#errors)
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
## 1. Introduction — Why an Algorithm Without Division?

Imagine a computer from 1965. It has a 16-bit accumulator, magnetic-core RAM, and an arithmetic unit that can **add** in 2 microseconds, **subtract** in 2 microseconds, and **divide** in 80 microseconds. Division is 40 times slower than addition. When you compute the midpoint of a binary search, you write `mid = (lo + hi) / 2` — that one division now dominates the cost of the entire iteration. If you do 30 iterations to search a million-element array, you spend 30 × 80 µs = 2.4 ms on divisions alone, while the actual array comparisons take ~60 µs.

Now imagine a different algorithm that picks its probe positions using only **addition and subtraction**. Each iteration takes a few microseconds. For a 30-iteration search, you save 2.34 milliseconds. On hardware where you might be processing thousands of searches per second, that adds up to entire seconds of CPU per minute — the difference between a responsive system and a sluggish one.

That algorithm is **Fibonacci Search**, invented by David E. Ferguson in 1960 ("Fibonaccian searching", *Communications of the ACM*) and analyzed in depth by Knuth in *The Art of Computer Programming*. It searches a sorted array in O(log n) time, achieves a slightly different probe pattern than binary search, and — critically — needs **no division, no multiplication**, just precomputed Fibonacci numbers and integer subtraction.

Today most CPUs divide as fast as they multiply, and binary search wins on raw speed. But Fibonacci search did not die — it became the discrete analogue of **golden-section search**, the standard algorithm for finding the minimum of a unimodal continuous function when you cannot compute its derivative. That algorithm runs in numerical optimization libraries (SciPy's `golden`, MATLAB's `fminbnd`, R's `optimize`), in calibration routines, in financial models, and in any place a "where is the minimum of this expensive black-box function?" question arises.

Learning Fibonacci search teaches you three lessons that transcend the algorithm itself:
- **Asymmetric divide-and-conquer.** Not every split has to be 50/50; sometimes 38/62 is better.
- **Golden-ratio mathematics.** The number φ ≈ 1.618 governs the optimal proportions, and it has fascinating recursive properties.
- **Historical hardware constraints.** Algorithms are shaped by the machines that ran them; understanding old constraints sharpens your judgment when designing for new ones (TPUs without certain instructions, web assembly with limited integer division, GPUs that prefer branch-free code).

---

<a name="prerequisites"></a>
## 2. Prerequisites — Fibonacci Numbers and the Golden Ratio

Before you can search with Fibonacci numbers, you need to understand them.

### 2.1 The Fibonacci sequence

```
F(0) = 0
F(1) = 1
F(n) = F(n-1) + F(n-2)   for n >= 2
```

The first dozen Fibonacci numbers:

```
n:    0  1  2  3  4  5  6   7   8   9   10   11   12   13   14    15    16    17
F(n): 0  1  1  2  3  5  8  13  21  34   55   89  144  233  377   610   987  1597
```

Each is the sum of the two preceding. The sequence grows **exponentially**: `F(n) ≈ φ^n / √5`, where `φ = (1 + √5) / 2 ≈ 1.6180339887...` is the **golden ratio**.

### 2.2 The golden ratio φ

The golden ratio satisfies `φ^2 = φ + 1`, equivalently `1/φ = φ − 1 ≈ 0.618`. Two important identities for Fibonacci search:

- `F(n-1) / F(n) → 1/φ ≈ 0.618` as `n → ∞`
- `F(n-2) / F(n) → 1/φ^2 ≈ 0.382` as `n → ∞`

So three consecutive Fibonacci numbers `F(m-2), F(m-1), F(m)` naturally split a length `F(m)` into pieces of approximately `0.382 : 0.618`. **That ratio is the heart of Fibonacci search.**

### 2.3 What you must already know

1. **Binary search.** Read `02-binary-search/junior.md` first. Fibonacci search assumes you understand window-shrinking and the loop-invariant style of correctness reasoning.
2. **Sorted random-access arrays.** Fibonacci search, like binary search, needs O(1) indexed access on a sorted sequence. Linked lists are out.
3. **Integer arithmetic.** Specifically, you should be comfortable thinking about `i + F(k)` as a probe position without it overflowing.

You do **not** need calculus or real analysis. The continuous golden-section variant uses them, but the discrete integer version is purely arithmetic.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Fibonacci sequence** | The integer sequence `0, 1, 1, 2, 3, 5, 8, 13, …` defined by `F(n) = F(n-1) + F(n-2)`. |
| **Golden ratio (φ)** | `(1 + √5) / 2 ≈ 1.618`. The limiting ratio of consecutive Fibonacci numbers. |
| **Inverse golden ratio (1/φ)** | `φ − 1 ≈ 0.618`. The proportional location of the Fibonacci-search probe. |
| **`Fm`** | The smallest Fibonacci number greater than or equal to the array length `n`. The "window size" we initially work with. |
| **`Fm-1`, `Fm-2`** | The two Fibonacci numbers immediately preceding `Fm`. They define probe offsets. |
| **Offset / `i`** | The current left edge of the search window. Probes happen at `arr[i + Fm-2]`. |
| **Probe position** | The index inspected at each iteration. For Fibonacci search, it is `i + min(Fm-2, n-1)`. |
| **Asymmetric probe** | A probe that is *not* at the midpoint. Fibonacci search probes at ~38% of the window, splitting it into 38/62. |
| **Window** | The contiguous range of indices still under consideration. Fibonacci search shrinks it by Fibonacci amounts. |
| **Golden-section search** | The continuous-domain analogue used to minimize unimodal real-valued functions. |
| **Unimodal function** | A function with a single minimum (or maximum); strictly decreasing then strictly increasing, or vice versa. |
| **Knuth's TAOCP** | Donald Knuth's *The Art of Computer Programming*, Vol. 3 §6.2.1, which gives the canonical exposition. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — `Fm`, `Fm-1`, `Fm-2` and the Asymmetric Window

### 4.1 The setup

Given a sorted array `arr` of length `n` and a target `t`:

1. **Precompute Fibonacci numbers** until you find the smallest `Fm` such that `Fm >= n`.
2. Maintain three integers throughout the search: `Fm`, `Fm-1`, `Fm-2`. (The actual indices `m-1`, `m-2` are mathematical bookkeeping; in code, we just keep three numbers and shift them.)
3. Maintain `offset = -1`. This is the "ghost" left edge of the eliminated region.

### 4.2 The probe

At each iteration, the probe index is:

```
i = min(offset + Fm-2, n - 1)
```

That is, we look `Fm-2` positions past the eliminated region. The `min` clamps it inside the array — `Fm` may exceed `n`, so without the clamp we would read past the end.

### 4.3 The three branches

Compare `arr[i]` to the target:

| Comparison | Action |
|---|---|
| `arr[i] == t` | Found. Return `i`. |
| `arr[i] < t` | Target is in the right `Fm-2`-sized chunk. Slide: `Fm = Fm-1`, `Fm-1 = Fm-2`, `Fm-2 = Fm - Fm-1`. Set `offset = i`. |
| `arr[i] > t` | Target is in the left `Fm-2`-sized chunk. Shrink: `Fm = Fm-2`, then `Fm-1 = Fm-1 - Fm-2`, `Fm-2 = Fm - Fm-1`. Offset unchanged. |

The key insight: **the shift operations are pure subtractions**. `Fm−1 = Fm−2`; the new `Fm-2 = Fm - Fm-1`. Three integer subtractions per iteration. No division. No multiplication.

### 4.4 The asymmetric split

When you probe at position `i = offset + Fm-2`:

- The **left** chunk has size `Fm-2` (positions `offset+1` through `i-1`).
- The **right** chunk has size `Fm - Fm-2 - 1 = Fm-1 - 1` (positions `i+1` through `offset + Fm`).

Since `Fm-2 ≈ 0.382 × Fm` and `Fm-1 ≈ 0.618 × Fm`, the split is roughly 38/62. **The eliminated chunk on a "go left" step is the larger one (62%) but the smaller probe-distance chunk; on a "go right" step it is the smaller one (38%).**

This asymmetry is the algorithm's defining feature. In a uniform-random search, you eliminate on average `(0.618 + 0.382) / 2 = 0.5` of the window per step — same as binary search. But the *distribution* of elimination sizes differs, and on hardware where moving in one direction is cheaper than the other, that distribution matters.

### 4.5 Termination

The loop continues while `Fm > 1`. When `Fm-1 = 1` and `Fm-2 = 0`, you have only one remaining candidate, which you check separately.

If the target was never found, return `-1`.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Aspect | Complexity |
|---|---|
| **Best case** | O(1) — target at first probe |
| **Average case** | O(log n) |
| **Worst case** | O(log_φ n) ≈ 1.44 · log₂ n |
| **Space (iterative)** | O(1) — three Fibonacci integers + offset |
| **Comparisons (worst)** | About `log_φ(n) + 1` ≈ `1.44 log₂ n` |
| **Divisions used** | **Zero** |
| **Multiplications used** | **Zero** |
| **Additions / subtractions per iteration** | O(1) — typically 3–4 |
| **Requires sorted input** | YES |

For `n = 1,000,000`: ~29 comparisons (vs ~20 for binary search). For `n = 1,000,000,000`: ~44 comparisons (vs ~30 for binary search). Fibonacci search is **slightly slower** in raw comparison count on uniform-cost memory but uses **no division**, which historically made it faster overall.

The factor `1/log₂(φ) ≈ 1.4404` is the **price of avoiding division**. On a machine where one division costs >1.44 comparisons, Fibonacci search wins.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 The architect and the golden rectangle

A classical architect designing a façade does not always cut a wall in half. The Greek and Renaissance ideal is the **golden rectangle**, where width-to-height is φ : 1. Each subdivision of a golden rectangle into a square and a smaller rectangle yields another golden rectangle. Fibonacci search is the algorithmic version of this aesthetic — divide-and-conquer with the golden ratio instead of the midpoint.

### 6.2 The librarian on a long tape

Suppose you are searching a magnetic-tape archive sorted by date. The tape is currently positioned at the very beginning. **Rewinding** is fast (the tape spins backward continuously); **fast-forwarding** is also fast but **costs more per meter** because the read head must brush the tape lightly to avoid wear. If your search algorithm naturally biases toward shorter forward moves and longer backward jumps, you save tape wear. Fibonacci search does exactly that — it probes at ~38% of the window, so most "go forward" moves are shorter, while "go backward" moves cover a larger distance per step but are cheaper anyway.

### 6.3 The mining engineer and the test drill

A surveyor tests a sloped vein for the location of richest ore. Each test costs $10,000. The vein is unimodal — concentration increases, peaks, then decreases. Where do you drill next? Drilling at the midpoint each time wastes information. Drilling at the golden-ratio points (~38%, ~62%) is **provably optimal** for unimodal functions — golden-section search. We will see this in `senior.md`.

### 6.4 Calibrating a slow sensor

You are calibrating an industrial sensor whose response is unimodal in voltage. Each test takes 10 minutes (settling time). You want to find the voltage that maximizes response with the fewest tests. **Binary search does not apply** — the function is not monotonic. **Ternary search** does, but ternary uses two probes per step. **Golden-section search** reuses one probe each step (because of the special property that one of the new probes coincides with an old one when you use the golden ratio), saving half the evaluations. Same idea as Fibonacci search on a discrete grid.

### 6.5 The asymmetric coin balance

Some old-fashioned mechanical scales tip more easily one direction than the other. To minimize "wrong-direction" excursions, you bias your trial weights asymmetrically — exactly the φ-proportioned bias of Fibonacci/golden-section search.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros

- **Zero divisions.** Critical on hardware where division is expensive or unavailable (early computers, some embedded microcontrollers, some custom hardware).
- **Asymmetric probe positions.** Better than binary search when reading from one side of the window is cheaper than reading from the other (tape, disk with current head position, NUMA, partially cached arrays).
- **Sequential access friendly.** Probes monotonically shift in one direction much of the time, which works well on tape and on storage systems that pay a penalty for backward seeks.
- **Same O(log n) order.** Only a ~44% constant-factor overhead in comparison count.
- **Elegant integer arithmetic.** The algorithm is provably correct and easy to verify by induction on Fibonacci identities.
- **Cousin of golden-section search.** Knowing Fibonacci search gives you the intuition for the continuous version, which is heavily used in optimization.

### Cons

- **Slower than binary search on modern RAM.** Modern CPUs divide quickly; binary search wins by ~44% in comparison count.
- **More comparisons in the worst case.** `1.44 log₂ n` vs `log₂ n`.
- **Off-by-one bugs are even easier than in binary search.** The Fibonacci index math has more moving parts.
- **Requires precomputing Fibonacci numbers.** A small one-time O(log n) cost.
- **Cache behavior similar to binary search.** No inherent locality advantage on modern hierarchies.
- **Niche modern use.** Most production code uses binary search or a hash table.
- **Doesn't help with insertion.** Just like binary search, inserting into a sorted array is still O(n).

### The verdict

Use Fibonacci search when:
- You're writing for hardware without efficient integer division.
- You're searching on tape, on disk with positional cost, or in a memory hierarchy where one half is cheaper.
- You're implementing **golden-section search** for unimodal optimization (the continuous version).
- You're an interview candidate showing breadth, or a student learning the algorithm zoo.

Use binary search when:
- You're on modern x86/ARM hardware searching RAM.
- You don't have asymmetric memory cost.
- You want the fewest possible comparisons.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Let's search for `t = 85` in:

```
arr =   [10, 22, 35, 40, 45, 50, 80, 82, 85, 90, 100, 110, 120]
index =   0   1   2   3   4   5   6   7   8   9   10   11   12
n = 13
```

**Step 0 — find the smallest `Fm >= n = 13`.**

Fibonacci numbers: `0, 1, 1, 2, 3, 5, 8, 13, 21, ...`. The smallest `Fm >= 13` is `F(7) = 13`. So:

```
Fm   = 13   (F7)
Fm-1 = 8    (F6)
Fm-2 = 5    (F5)
offset = -1
```

**Iteration 1.**

```
i = min(offset + Fm-2, n - 1) = min(-1 + 5, 12) = 4
arr[4] = 45
45 < 85 → target is to the right. Shift forward.
   Fm = Fm-1 = 8
   Fm-1 = Fm-2 = 5
   Fm-2 = Fm - Fm-1 = 8 - 5 = 3
   offset = 4
```

After iteration 1: `Fm=8, Fm-1=5, Fm-2=3, offset=4`. Eliminated: indices 0–4.

**Iteration 2.**

```
i = min(offset + Fm-2, n - 1) = min(4 + 3, 12) = 7
arr[7] = 82
82 < 85 → target is to the right. Shift forward.
   Fm = Fm-1 = 5
   Fm-1 = Fm-2 = 3
   Fm-2 = Fm - Fm-1 = 5 - 3 = 2
   offset = 7
```

After iteration 2: `Fm=5, Fm-1=3, Fm-2=2, offset=7`. Eliminated: 0–7.

**Iteration 3.**

```
i = min(offset + Fm-2, n - 1) = min(7 + 2, 12) = 9
arr[9] = 90
90 > 85 → target is to the left. Shrink.
   Fm = Fm-2 = 2
   Fm-1 = Fm-1 - Fm-2 = 3 - 2 = 1
   Fm-2 = Fm - Fm-1 = 2 - 1 = 1
   offset unchanged (= 7)
```

After iteration 3: `Fm=2, Fm-1=1, Fm-2=1, offset=7`. Window: indices 8 (only one between offset+1=8 and 9-1=8 plus the not-yet-probed remnant).

**Iteration 4.**

```
i = min(offset + Fm-2, n - 1) = min(7 + 1, 12) = 8
arr[8] = 85
85 == 85 → FOUND. Return 8.
```

Total comparisons: 4. For comparison, `⌈log₂(13 + 1)⌉ = 4`, so this particular search matched binary search exactly. In general Fibonacci search would do slightly more in the worst case.

Notice the trace: probes were at positions 4, 7, 9, 8 — **not** the midpoints 6, 9, 10, 8 that binary search would have used. Fibonacci search aims toward the lower side initially (4 instead of 6, i.e., ~38% of the way through 13 elements), which biases the algorithm toward forward motion.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Classic iterative Fibonacci search

**Go:**
```go
package fibsearch

// FibonacciSearch returns the index of target in a sorted slice, or -1 if absent.
// The slice MUST be sorted in ascending order. Uses no division or multiplication.
func FibonacciSearch(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    // Find the smallest Fibonacci number >= n.
    fm2, fm1 := 0, 1
    fm := fm2 + fm1 // 1
    for fm < n {
        fm2 = fm1
        fm1 = fm
        fm = fm2 + fm1
    }
    offset := -1
    for fm > 1 {
        i := offset + fm2
        if i >= n {
            i = n - 1
        }
        switch {
        case arr[i] == target:
            return i
        case arr[i] < target:
            // Slide forward.
            fm = fm1
            fm1 = fm2
            fm2 = fm - fm1
            offset = i
        default:
            // arr[i] > target; shrink to the left part.
            fm = fm2
            fm1 = fm1 - fm2
            fm2 = fm - fm1
        }
    }
    // Final 1-element check.
    if fm1 == 1 && offset+1 < n && arr[offset+1] == target {
        return offset + 1
    }
    return -1
}
```

**Java:**
```java
public final class FibonacciSearch {
    private FibonacciSearch() {}

    /**
     * Returns the index of target, or -1 if absent.
     * Array MUST be sorted ascending. Uses no division or multiplication.
     */
    public static int search(int[] arr, int target) {
        int n = arr.length;
        if (n == 0) return -1;

        int fm2 = 0, fm1 = 1, fm = fm2 + fm1;
        while (fm < n) {
            fm2 = fm1;
            fm1 = fm;
            fm  = fm2 + fm1;
        }
        int offset = -1;
        while (fm > 1) {
            int i = Math.min(offset + fm2, n - 1);
            if (arr[i] == target) return i;
            if (arr[i] < target) {
                fm  = fm1;
                fm1 = fm2;
                fm2 = fm - fm1;
                offset = i;
            } else {
                fm  = fm2;
                fm1 = fm1 - fm2;
                fm2 = fm - fm1;
            }
        }
        if (fm1 == 1 && offset + 1 < n && arr[offset + 1] == target) {
            return offset + 1;
        }
        return -1;
    }
}
```

**Python:**
```python
def fibonacci_search(arr: list[int], target: int) -> int:
    """Return index of target, or -1 if absent. arr MUST be sorted ascending.
    Uses only addition and subtraction — no division or multiplication."""
    n = len(arr)
    if n == 0:
        return -1
    fm2, fm1 = 0, 1
    fm = fm2 + fm1
    while fm < n:
        fm2, fm1, fm = fm1, fm, fm1 + fm
    offset = -1
    while fm > 1:
        i = min(offset + fm2, n - 1)
        if arr[i] == target:
            return i
        if arr[i] < target:
            fm, fm1, fm2 = fm1, fm2, fm1 - fm2
            offset = i
        else:
            fm, fm1, fm2 = fm2, fm1 - fm2, 2 * fm2 - fm1
            # Equivalent: fm = fm2; new_fm1 = fm1 - fm2; new_fm2 = fm - new_fm1
    if fm1 == 1 and offset + 1 < n and arr[offset + 1] == target:
        return offset + 1
    return -1
```

> **Note on the Python triple assignment:** Python evaluates the right-hand side fully before assigning. We use temporaries to keep the updates clear; see Section 11 for the explicit step-by-step form some readers prefer.

### 9.2 Clearer step-by-step Python (no triple assignment)

```python
def fibonacci_search_clear(arr, target):
    n = len(arr)
    if n == 0:
        return -1
    # Build Fibonacci numbers up to >= n.
    fm2 = 0
    fm1 = 1
    fm = 1
    while fm < n:
        fm2 = fm1
        fm1 = fm
        fm = fm2 + fm1
    offset = -1
    while fm > 1:
        i = min(offset + fm2, n - 1)
        if arr[i] == target:
            return i
        elif arr[i] < target:
            # slide the Fibonacci window forward by Fm-2
            new_fm = fm1
            new_fm1 = fm2
            new_fm2 = new_fm - new_fm1
            fm, fm1, fm2 = new_fm, new_fm1, new_fm2
            offset = i
        else:
            # shrink to the lower Fibonacci chunk
            new_fm = fm2
            new_fm1 = fm1 - fm2
            new_fm2 = new_fm - new_fm1
            fm, fm1, fm2 = new_fm, new_fm1, new_fm2
    if fm1 == 1 and offset + 1 < n and arr[offset + 1] == target:
        return offset + 1
    return -1
```

### 9.3 Find first occurrence with duplicates

To find the **smallest** index `i` with `arr[i] == target`, record the match and keep searching left:

**Go:**
```go
func FibonacciFindFirst(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    fm2, fm1 := 0, 1
    fm := 1
    for fm < n {
        fm2 = fm1
        fm1 = fm
        fm = fm2 + fm1
    }
    offset := -1
    result := -1
    for fm > 1 {
        i := offset + fm2
        if i >= n {
            i = n - 1
        }
        if arr[i] >= target {
            if arr[i] == target {
                result = i
            }
            // Always shrink to the left chunk — looking for earlier occurrences.
            fm = fm2
            fm1 = fm1 - fm2
            fm2 = fm - fm1
        } else {
            fm = fm1
            fm1 = fm2
            fm2 = fm - fm1
            offset = i
        }
    }
    if result == -1 && fm1 == 1 && offset+1 < n && arr[offset+1] == target {
        return offset + 1
    }
    return result
}
```

**Java:**
```java
public static int findFirst(int[] arr, int target) {
    int n = arr.length;
    if (n == 0) return -1;
    int fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) { fm2 = fm1; fm1 = fm; fm = fm2 + fm1; }
    int offset = -1, result = -1;
    while (fm > 1) {
        int i = Math.min(offset + fm2, n - 1);
        if (arr[i] >= target) {
            if (arr[i] == target) result = i;
            fm = fm2;
            fm1 = fm1 - fm2;
            fm2 = fm - fm1;
        } else {
            fm = fm1;
            fm1 = fm2;
            fm2 = fm - fm1;
            offset = i;
        }
    }
    if (result == -1 && fm1 == 1 && offset + 1 < n && arr[offset + 1] == target) {
        return offset + 1;
    }
    return result;
}
```

**Python:**
```python
def fibonacci_find_first(arr, target):
    n = len(arr)
    if n == 0:
        return -1
    fm2, fm1, fm = 0, 1, 1
    while fm < n:
        fm2 = fm1
        fm1 = fm
        fm = fm2 + fm1
    offset, result = -1, -1
    while fm > 1:
        i = min(offset + fm2, n - 1)
        if arr[i] >= target:
            if arr[i] == target:
                result = i
            fm, fm1, fm2 = fm2, fm1 - fm2, fm2 - (fm1 - fm2)
        else:
            fm, fm1, fm2 = fm1, fm2, fm1 - fm2
            offset = i
    if result == -1 and fm1 == 1 and offset + 1 < n and arr[offset + 1] == target:
        return offset + 1
    return result
```

> See `tasks.md` for a fully tested, more readable version with helper functions, plus golden-section search on continuous unimodal functions.

---

<a name="history"></a>
## 10. Historical Motivation — Knuth, Tape Drives, and Slow Division

### 10.1 Ferguson's 1960 paper

David E. Ferguson published "Fibonaccian searching" in *Communications of the ACM* (Vol. 3 No. 12, December 1960). The motivation in that paper was explicit: division on the IBM 704 and 709 computers of the era was **expensive**, and binary search's `mid = (lo + hi) / 2` was a measurable slow point. Ferguson noted that you could compute probe positions using only Fibonacci numbers — a precomputed table of additions — and search in essentially the same asymptotic time but without ever invoking the divide instruction.

The 1960 paper's measurement: on the IBM 704, Fibonacci search was **roughly 25% faster** than binary search on million-record sorted tables.

### 10.2 Knuth's TAOCP analysis

Donald Knuth, in *The Art of Computer Programming* Vol. 3, *Sorting and Searching*, §6.2.1, gives Fibonacci search a dedicated subsection and proves:
- Worst-case comparison count: `⌈log_φ(n √5)⌉ - 1` ≈ `1.44 log₂ n − 0.33`.
- Average-case comparison count: similar with a small constant correction.
- The algorithm is essentially **division-free** — three subtractions per iteration.

Knuth also discusses Fibonacci search's use in tape drives.

### 10.3 Magnetic tape and sequential storage

In the 1960s and 70s, mainframes routinely stored sorted records on **9-track magnetic tape**. Tape has a fundamental asymmetry: reading **forward** is fast; **rewinding** is also fast but the read head must be repositioned mechanically. The time cost of jumping from position `A` to position `B` is roughly `|B - A| × c`, where `c` is the per-meter cost of moving the head.

Binary search on tape requires a sequence of jumps that average `n/2 + n/4 + n/8 + ... ≈ n` total movement. Fibonacci search's asymmetric probes biased the algorithm to **shorter jumps forward** and longer (but cheaper-amortized) jumps backward when the head was already past the target. Combined with no division, Fibonacci search ran measurably faster on tape-resident data.

### 10.4 ROM lookup tables and calculators

Several scientific calculators of the 1970s — including some HP calculators — used Fibonacci search to look up trigonometric and logarithm tables in their ROM. The ROM was small (a few KB), the table sorted, and the CPU had no fast divide instruction. The choice was natural.

### 10.5 Why we still teach it

In 2026, no production database uses Fibonacci search to find a row. Binary search and B-trees dominate. But Fibonacci search remains:

- **A frequent interview question** about algorithm design (especially "give me a search that uses no division").
- **The discrete analogue** of golden-section search, which is in active production use in optimization software.
- **A clean example** of asymmetric divide-and-conquer, a pattern that reappears in expected-O(1) skip lists, B-tree splits, and certain compression algorithms.
- **A teaching tool** for the relationship between Fibonacci numbers and the golden ratio, useful for any student of algorithms.

---

<a name="errors"></a>
## 11. Error Handling — Overflow, Empty Input, Unsorted Data

### 11.1 Empty input

```
n == 0 → return -1 immediately.
```

If you forget this check, the inner loop never executes (`fm > 1` is false because `fm = 1`), so you return `-1` anyway — but only by luck. **Always check explicitly**; it documents intent.

### 11.2 Single-element input

```
n == 1, fm = 1, offset = -1.
Loop body skipped (fm > 1 is false).
Final check: fm1 == 1, offset+1 = 0 < 1, arr[0] == target?
```

This works correctly, but it's easy to write a Fibonacci-search loop that mishandles `n == 1`. Test it.

### 11.3 Integer overflow

When `n` is enormous, the Fibonacci sequence used for initialization can overflow. `F(46) = 1,836,311,903` exceeds `2^31 - 1` (the 32-bit signed int max ≈ 2.1 billion). For 64-bit `long`, `F(92)` exceeds `2^63 - 1` (≈ 9.2 × 10^18). In practice, an array large enough to need `F(92) ≈ 7.5 × 10^18` does not fit in any current computer, but you should still write the initialization carefully.

```java
// Defensive Fibonacci initialization in Java:
long fm2 = 0, fm1 = 1, fm = 1;
while (fm < n) {
    if (fm > Long.MAX_VALUE - fm1) {
        throw new ArithmeticException("Fibonacci overflow");
    }
    fm2 = fm1;
    fm1 = fm;
    fm = fm2 + fm1;
}
```

Python and Go (with `int64` and large arrays) avoid overflow because Python has arbitrary precision and Go's `int` is 64-bit on amd64. Java with `int[]` capped at ~2 billion elements is safe with `long` Fibonacci variables.

### 11.4 Unsorted input

Same as binary search: returns nondeterministic garbage with no error. Add an `assert isSorted(arr)` in debug builds.

```python
def is_sorted(a):
    return all(a[i] <= a[i + 1] for i in range(len(a) - 1))
```

### 11.5 Negative `offset` access

The line `i = offset + fm2` starts with `offset = -1`. First iteration: `i = -1 + fm2 = fm2 - 1`. If `fm2 = 0` (a buggy initialization), `i = -1`, and `arr[-1]` is illegal in Go/Java but accesses the last element in Python — a silent data corruption bug. **Initialize `fm2 = 0, fm1 = 1, fm = 1`** and verify in tests.

### 11.6 Clamping `i`

If `Fm > n`, then `offset + Fm-2` may exceed `n - 1`. Always clamp: `i = min(offset + fm2, n - 1)`. Forgetting this clamp gives `IndexOutOfBoundsException` in Java/Go.

### 11.7 Comparator pitfalls

Same as binary search: floating-point `==` is unreliable; NaN breaks the total order; custom comparators must be consistent (transitive, antisymmetric). All warnings from `02-binary-search/junior.md` §11 apply.

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Don't use it on a modern desktop CPU.** Binary search will outperform Fibonacci search by ~10–40% on RAM-resident integer arrays. Modern CPUs divide in 5–15 cycles; the savings from avoiding division are gone.

2. **Use it on hardware without integer division.** Some 8-bit microcontrollers (PIC, 8051), some early RISC chips, and some custom FPGAs lack division. Fibonacci search is genuinely faster there.

3. **Use it for tape, optical disc, or seek-asymmetric storage.** If your storage system charges per byte of head movement, the algorithm's asymmetric probe pattern saves measurable time.

4. **Use it as a building block for golden-section search.** If you need to minimize a unimodal continuous function (a Bayesian hyperparameter, a calibration curve, a financial model), use the continuous variant. The discrete intuition transfers directly.

5. **Precompute the Fibonacci table once.** For repeated searches on arrays of similar size, computing the table is a one-time O(log n) cost amortized away.

6. **Don't try to "optimize" by mixing in division.** That defeats the purpose. If you want division-based logic, just use binary search.

7. **Profile, don't guess.** On a particular embedded target, measure both algorithms with realistic data. Cache effects, branch prediction, and instruction scheduling matter more than the asymptotic count.

8. **Linear search beats Fibonacci search for small arrays** (n < ~20), same as for binary search. Branch prediction loves tight linear loops.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Document why.** Every Fibonacci-search function in production should have a comment explaining *why* it was chosen over binary search ("legacy CPU without DIV", "tape-resident data", "golden-section solver"). Otherwise the next maintainer will swap it out.
- **Keep the variable names readable.** `fm`, `fm1`, `fm2`, `offset`, `i` are conventional. Don't reuse them for unrelated purposes inside the loop.
- **Test the boundary cases.** Empty array, single element, exact-fit Fibonacci sizes (n = F(k)), and just-over-Fibonacci sizes (n = F(k) + 1). The boundaries are where bugs hide.
- **Provide both the search and find-first variants.** Most users want the first occurrence in duplicate-heavy data.
- **Verify pre/post-conditions.** Pre: sorted, non-null. Post: returned index `i` satisfies `arr[i] == target` or is `-1`. Property-based tests should validate this.
- **Don't reimplement the language built-in.** Go, Java, Python all have efficient binary search built in (`slices.BinarySearch`, `Arrays.binarySearch`, `bisect_left`). Use Fibonacci search only when binary search is the wrong tool.
- **Prefer iterative.** Recursive Fibonacci search adds nothing but stack frames.
- **Use it for teaching.** A clear Fibonacci-search implementation alongside a binary search makes a great compare-and-contrast for newer team members.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Input | Expected |
|---|---|---|
| Empty array | `[]`, target = anything | `-1` |
| Single element, match | `[7]`, target = 7 | `0` |
| Single element, no match | `[7]`, target = 5 | `-1` |
| Two elements, match first | `[3, 9]`, target = 3 | `0` |
| Two elements, match last | `[3, 9]`, target = 9 | `1` |
| Exact-Fibonacci size, match middle | `len = F(7) = 13`, target at index 4 | `4` |
| Just-over-Fibonacci size | `len = F(7) + 1 = 14` | initial probe respects clamp |
| All duplicates, classic | `[5, 5, 5, 5]`, target = 5 | `0`, 1, 2, or 3 (depending on probes) |
| All duplicates, find-first | `[5, 5, 5, 5]`, target = 5 | `0` |
| Target less than all | `[3, 5, 7]`, target = 1 | `-1` |
| Target greater than all | `[3, 5, 7]`, target = 9 | `-1` |
| Negative values | `[-9, -3, 0, 4]`, target = -3 | `1` |
| Large array (10^6) | sorted, target at index 783200 | `783200`, ~30 comparisons |
| Array of size 1,000,000,001 | sorted, last element | `1,000,000,000`, ~44 comparisons |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Forgetting to clamp `i`.** `Fm > n`, so `offset + Fm-2` overshoots and accesses out-of-bounds. **Fix:** `i = min(offset + Fm-2, n - 1)`.
2. **Wrong initial Fibonacci values.** Setting `fm2 = 1, fm1 = 0, fm = 1` (off by one) makes the first probe at index 0 instead of the correct position. **Fix:** `fm2 = 0, fm1 = 1, fm = 1`.
3. **Updating Fibonacci values in the wrong order.** Python lets you do `fm, fm1, fm2 = fm1, fm2, fm1 - fm2` atomically, but in Go/Java you must use temporaries to avoid clobbering.
4. **Confusing "go right" with "go left" Fibonacci updates.** Right (target greater): slide forward, three values become `Fm-1, Fm-2, Fm - Fm-1`. Left (target smaller): shrink, three values become `Fm-2, Fm-1 - Fm-2, Fm-2 - (Fm-1 - Fm-2)`.
5. **Not handling the final 1-element check.** When the main loop exits with `Fm = 1`, you still have one candidate at `offset + 1` to check.
6. **Integer overflow when building Fibonacci numbers** in 32-bit signed ints with `n >= 1.8 × 10^9`.
7. **Returning the wrong type of "not found" sentinel** (`-1` vs insertion point vs exception). Be consistent with your team's binary-search conventions.
8. **Searching unsorted data.** Same trap as binary search.
9. **Applying it to linked lists.** O(n) per probe, total O(n log n) — strictly worse than linear scan.
10. **Using it for floats with `==`.** Floating-point equality is unreliable; use a precision threshold or the golden-section variant.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
PRECOMPUTE
    fm2 = 0; fm1 = 1; fm = 1
    while fm < n:
        fm2 = fm1; fm1 = fm; fm = fm2 + fm1

INITIALIZE
    offset = -1

LOOP   (while fm > 1)
    i = min(offset + fm2, n - 1)
    if arr[i] == target:    return i
    if arr[i] < target:
        fm  = fm1
        fm1 = fm2
        fm2 = fm - fm1
        offset = i              # slide forward
    else:
        fm  = fm2
        fm1 = fm1 - fm2
        fm2 = fm - fm1
        # shrink (offset unchanged)

FINAL CHECK
    if fm1 == 1 and offset + 1 < n and arr[offset + 1] == target:
        return offset + 1
    return -1

COMPLEXITY
    Time:    O(log_φ n) ≈ 1.44 log₂ n
    Space:   O(1)
    Ops:     additions and subtractions only — zero divisions

KEY FACTS
    Probe at offset + Fm-2  → ~38% of window
    Eliminate ~38% or ~62%  → asymmetric split
    Sister algorithm:        golden-section search (continuous unimodal)
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders the array as horizontal cells, shows the three Fibonacci numbers `(Fm, Fm-1, Fm-2)` updating each step, marks the probe position `offset + Fm-2`, and highlights the asymmetric ~38% / ~62% split. You can step through manually or auto-play, and compare directly against binary-search probe positions on the same input.

Try running it once on a sorted 20-element array — watching the Fibonacci numbers slide is the clearest way to internalize how the algorithm differs from binary search.

---

<a name="summary"></a>
## 18. Summary

- **Fibonacci search** finds an element in a sorted array in O(log n) time using **only addition and subtraction** — no division, no multiplication.
- It picks probe positions using three consecutive Fibonacci numbers `Fm-2, Fm-1, Fm`, which split the window in the **golden ratio** (~38% / ~62%) instead of in half.
- Each iteration does three integer additions/subtractions to advance the Fibonacci window and one comparison.
- **Comparisons:** ~`1.44 log₂ n` in the worst case — about 44% more than binary search.
- **History:** Ferguson (1960), analyzed by Knuth (TAOCP v3 §6.2.1). Used on 1960s mainframes where division was slow, and on magnetic-tape data where asymmetric seeks made the probe pattern advantageous.
- **Modern relevance:** the continuous analogue — **golden-section search** — is the standard algorithm for minimizing unimodal black-box functions in numerical optimization libraries.
- Use Fibonacci search when (a) your hardware lacks fast division, (b) memory access is cost-asymmetric, or (c) you need the golden-section idea on continuous data. Otherwise, use binary search.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Ferguson**, "Fibonaccian searching," *Communications of the ACM* 3(12), Dec 1960. The original paper.
- **Knuth**, *The Art of Computer Programming, Volume 3: Sorting and Searching*, §6.2.1 (3rd edition pp. 416–419). The canonical analysis.
- **Kiefer**, "Sequential Minimax Search for a Maximum," *Proc. Amer. Math. Soc.* 4 (1953). The original golden-section search paper.
- **Press, Teukolsky, Vetterling, Flannery**, *Numerical Recipes*, §10.2 ("Golden Section Search in One Dimension"). The standard reference for the continuous version.
- **Sedgewick & Wayne**, *Algorithms* 4e, §3.1 — comparison of search algorithms.
- **GeeksforGeeks / Wikipedia "Fibonacci search technique"** — accessible introductory write-ups.
- Continue with `middle.md` to see Fibonacci search compared to ternary search and binary search on asymmetric-cost models.
