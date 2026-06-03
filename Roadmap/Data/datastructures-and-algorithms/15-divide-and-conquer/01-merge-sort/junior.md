# Merge Sort (The Canonical Divide-and-Conquer Algorithm) — Junior Level

> **One-line summary:** Merge sort sorts an array by **splitting** it in half, **recursively sorting** each half, and **merging** the two sorted halves into one sorted whole. The merge step walks two sorted lists with two pointers and always picks the smaller front element. It runs in guaranteed `O(n log n)` time, is **stable**, and uses `O(n)` extra memory.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Imagine someone hands you a shuffled deck of 1000 numbered cards and asks you to sort it. One tempting approach is to scan the whole pile looking for the smallest card, set it aside, then scan again for the next smallest, and so on. That is selection sort, and it does roughly `1000 × 1000 = 1,000,000` comparisons — painfully slow as the pile grows.

Merge sort takes a smarter, almost lazy route. Instead of solving the big problem directly, it says: *"I do not know how to sort 1000 cards, but if you give me two already-sorted piles, I can zipper them together into one sorted pile very fast."* So it splits the deck in half, asks someone else to sort each half (who in turn split again, and again, until each pile has a single card — which is trivially sorted), and then it merges the sorted halves back up.

This is the essence of **divide and conquer**, and merge sort is its textbook example:

> **Divide** the array into two halves. **Conquer** (recursively sort) each half. **Combine** the two sorted halves with a linear-time merge.

The single fact that makes merge sort fast is the **merge step**: two sorted lists of total length `n` can be combined into one sorted list of length `n` in just `O(n)` time, by walking both with two pointers and always taking the smaller front element. Because the array is halved each level, there are only `log₂ n` levels, and each level does `O(n)` total merging work. Multiply those together and you get the famous bound:

> **`T(n) = 2·T(n/2) + O(n) = O(n log n)`.**

Unlike quicksort, this `O(n log n)` is a **guarantee**, not an average — there is no adversarial input that degrades merge sort to `O(n²)`. Merge sort is also **stable** (equal elements keep their original relative order) and is the algorithm of choice when data is too large to fit in memory (**external sort**) or stored in a **linked list** (where merging needs no extra array at all).

A few ideas connect to siblings you may meet later:
- The same divide/conquer/combine skeleton powers **quicksort** (`02-quicksort`), **binary search**, and **fast Fourier transform**.
- Counting **inversions** (how far an array is from sorted) falls out of the merge step almost for free.
- The recurrence `T(n) = 2T(n/2) + O(n)` is solved by the **Master Theorem** (proved in [`professional.md`](./professional.md)).

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Arrays / lists** — indexing, slicing, and copying a contiguous block of elements.
- **Recursion** — a function that calls itself on smaller inputs, with a base case that stops the recursion.
- **Comparisons** — knowing how to ask "is `a` less than `b`?" for whatever you are sorting.
- **Big-O notation** — `O(n)`, `O(n log n)`, `O(log n)`, and what "linear" vs "linearithmic" mean.
- **Loops and two pointers** — walking two sequences at once with two index variables.

Optional but helpful:

- A glance at **selection sort** or **insertion sort** so you can feel why `O(n log n)` beats `O(n²)`.
- Familiarity with the **call stack** — recursion uses `O(log n)` stack frames here.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Divide and conquer** | Solve a problem by splitting it into smaller subproblems, solving those, and combining the results. |
| **Merge** | Combine two already-sorted lists into one sorted list in linear time using two pointers. |
| **Stable sort** | A sort where elements that compare equal keep their original relative order. Merge sort is stable. |
| **Auxiliary space** | Extra memory used beyond the input. Array merge sort needs `O(n)` auxiliary space. |
| **In-place** | Using only `O(1)` (or `O(log n)`) extra memory. Standard array merge sort is **not** in-place. |
| **Top-down merge sort** | The recursive version: split, recurse, merge. |
| **Bottom-up merge sort** | The iterative version: merge runs of size 1, then 2, then 4, … with no recursion. |
| **Run** | A maximal already-sorted stretch of the array (used in natural merge sort). |
| **Recurrence** | An equation describing the running time in terms of smaller inputs, e.g. `T(n) = 2T(n/2) + O(n)`. |
| **Inversion** | A pair of indices `(i, j)` with `i < j` but `a[i] > a[j]` — an out-of-order pair. |
| **External sort** | Sorting data too large to fit in RAM, using disk and merging sorted chunks. |

---

## Core Concepts

### 1. Divide / Conquer / Combine

Merge sort has exactly three moves, applied recursively:

```
mergeSort(a, lo, hi):
    if hi - lo <= 1: return          # 0 or 1 element is already sorted (base case)
    mid = (lo + hi) / 2
    mergeSort(a, lo, mid)            # divide + conquer left half
    mergeSort(a, mid, hi)            # divide + conquer right half
    merge(a, lo, mid, hi)            # combine the two sorted halves
```

The recursion keeps halving the range until each piece has one element. A single element is sorted by definition — that is the **base case** that stops the recursion. Then, on the way back up, `merge` stitches sorted pieces into bigger sorted pieces.

### 2. The Merge Step (the heart of the algorithm)

Given two sorted lists `L` and `R`, produce one sorted list. Walk both with pointers `i` (into `L`) and `j` (into `R`). At each step compare the two front elements and copy the smaller one out; advance that pointer. When one list runs out, copy the rest of the other.

```
merge(L, R):
    i = j = 0
    out = []
    while i < len(L) and j < len(R):
        if L[i] <= R[j]:   out.append(L[i]); i += 1     # "<=" keeps it STABLE
        else:              out.append(R[j]); j += 1
    append remaining of L (from i)
    append remaining of R (from j)
    return out
```

Each element is copied exactly once, so merging two lists of total size `n` is `O(n)`. The `<=` (taking from the **left** on ties) is what makes the sort **stable**.

### 3. Why It Is `O(n log n)`

Picture the recursion as a tree. The top level splits `n` into two halves and later merges them — `O(n)` work. The next level has two pieces of size `n/2`, each merged in `O(n/2)`, totaling `O(n)` again. Every level does `O(n)` total work, and there are `log₂ n` levels (because you can only halve `n` about `log₂ n` times before reaching size 1). So:

```
total work = (work per level) × (number of levels) = O(n) × O(log n) = O(n log n)
```

This is the **recursion-tree** intuition; the formal **Master Theorem** proof is in [`professional.md`](./professional.md).

### 4. Stability

A sort is **stable** if two records that compare equal stay in their original order. This matters when you sort by one key but care about a previous order (e.g., sort people by age, keeping alphabetical order within each age). Merge sort is stable as long as the merge takes from the **left** list on ties (`L[i] <= R[j]`). Switch to `<` and you break stability.

### 5. Auxiliary Space — `O(n)`

The array merge needs a temporary buffer to hold the merged output before copying it back (you cannot overwrite the input while still reading it). That buffer is `O(n)`. Plus the recursion stack is `O(log n)` deep. So standard array merge sort is **not in-place** — it trades memory for its clean structure and stability.

### 6. Top-Down vs Bottom-Up

- **Top-down** (recursive): the version above. Easy to read; uses the call stack.
- **Bottom-up** (iterative): skip recursion entirely. First merge every adjacent pair of size-1 runs, then every pair of size-2 runs, then size-4, doubling the run width until it covers the whole array. Same `O(n log n)`, no recursion stack, often friendlier for very large arrays.

---

## Big-O Summary

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Best case | **O(n log n)** | O(n) | Even already-sorted input still does all the merges. |
| Average case | **O(n log n)** | O(n) | Same as best — input does not matter. |
| Worst case | **O(n log n)** | O(n) | Guaranteed; no `O(n²)` blow-up ever. |
| Merge of two halves | O(n) | O(n) | Two-pointer linear scan. |
| Recursion depth | O(log n) | O(log n) stack | Halving down to size 1. |
| Linked-list merge sort | O(n log n) | **O(1)** extra (+`O(log n)` stack) | No copy buffer needed; just relink. |
| Counting inversions | O(n log n) | O(n) | Falls out of the merge step. |

The headline is **`O(n log n)` in all cases** plus **`O(n)` auxiliary space** (for arrays). That worst-case guarantee is merge sort's signature strength.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Divide step | Splitting a huge pile of exam papers into two smaller piles, then handing each to a helper. |
| Conquer step | Each helper recursively splits and sorts their pile the same way. |
| Merge step | Two helpers each hold a **sorted** stack; you repeatedly take the smaller top card from the two stacks to build one sorted stack. |
| Stability | When two papers tie on score, you keep the one that was already on top first — preserving the earlier ordering. |
| Bottom-up merge | Instead of recursing, you first pair up single papers, then pair up the pairs, then the quads — sweeping the table in passes. |
| External sort | The table is too small to hold every paper at once, so you sort chunks that fit, set them aside (on the floor / on disk), then merge the chunks. |
| Linked-list merge | The papers are on a string (a linked list); to merge you just re-tie the knots, never needing a second table. |

Where the analogy breaks: real card-merging is cheap because you can see both tops; in code, the cost is the comparisons and copies, which is exactly what the `O(n)` per level counts.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| **Guaranteed `O(n log n)`** in best, average, and worst case — no bad inputs. | Needs **`O(n)` auxiliary memory** for arrays (quicksort is in-place). |
| **Stable** — preserves the order of equal elements. | Not cache-friendly: it copies between buffers, more memory traffic than quicksort. |
| **Predictable** — performance does not depend on input order. | Constant factors are higher than quicksort, so it is often slightly slower in practice on in-RAM arrays. |
| **Excellent for linked lists** — `O(1)` extra space, no random access needed. | Recursive version uses `O(log n)` stack; deep recursion needs care in some languages. |
| **The natural choice for external / huge-data sorting** (merge sorted chunks from disk). | More code than a simple insertion/selection sort for tiny inputs. |
| **Easily parallelized** — independent halves can be sorted on different cores. | The merge buffer allocation can pressure the garbage collector if done per call. |

**When to use:** you need a worst-case guarantee, you need **stability**, you are sorting **linked lists**, you are sorting data that does not fit in memory, or you want easy parallelism.

**When NOT to use:** memory is extremely tight and the data is an array (prefer in-place heapsort or quicksort), or the array is tiny (insertion sort wins on small `n`).

---

## Step-by-Step Walkthrough

Sort the array `[5, 2, 4, 7, 1, 3, 2, 6]` (8 elements). Note the two `2`s — we will watch stability.

**Divide** (split until single elements):

```
[5, 2, 4, 7, 1, 3, 2, 6]
        /              \
[5, 2, 4, 7]        [1, 3, 2, 6]
   /     \             /     \
[5,2]   [4,7]       [1,3]   [2,6]
 / \     / \         / \     / \
[5][2] [4][7]     [1][3]  [2][6]
```

**Conquer + Combine** (merge back up). Each merge zips two sorted lists:

```
Level (size-1 → size-2):
  merge [5],[2] → [2,5]
  merge [4],[7] → [4,7]
  merge [1],[3] → [1,3]
  merge [2],[6] → [2,6]

Level (size-2 → size-4):
  merge [2,5],[4,7] → [2,4,5,7]
  merge [1,3],[2,6] → [1,2,3,6]

Level (size-4 → size-8):
  merge [2,4,5,7],[1,2,3,6] → [1,2,2,3,4,5,6,7]
```

**Trace one merge in detail** — `merge([2,4,5,7], [1,2,3,6])`:

```
L = [2,4,5,7]   R = [1,2,3,6]   out = []
compare 2 vs 1 → take 1 (R)         out=[1]
compare 2 vs 2 → take 2 (L, "<=")   out=[1,2]   ← LEFT 2 (the original a[1]) goes first → STABLE
compare 4 vs 2 → take 2 (R)         out=[1,2,2]
compare 4 vs 3 → take 3 (R)         out=[1,2,2,3]
compare 4 vs 6 → take 4 (L)         out=[1,2,2,3,4]
compare 5 vs 6 → take 5 (L)         out=[1,2,2,3,4,5]
compare 7 vs 6 → take 6 (R)         out=[1,2,2,3,4,5,6]
R empty → copy rest of L: 7         out=[1,2,2,3,4,5,6,7]
```

Final sorted array: `[1, 2, 2, 3, 4, 5, 6, 7]`. The two `2`s kept their original relative order because the merge prefers the **left** list on ties.

There were **3 levels** of merging (`log₂ 8 = 3`), each doing `O(8)` total work — exactly the `O(n log n)` shape.

---

## Code Examples

### Example: Top-Down Merge Sort (recursive)

#### Go

```go
package main

import "fmt"

// merge combines the two sorted halves a[lo:mid] and a[mid:hi] using a buffer.
func merge(a []int, lo, mid, hi int, buf []int) {
	i, j, k := lo, mid, lo
	for i < mid && j < hi {
		if a[i] <= a[j] { // "<=" → take from left on ties → STABLE
			buf[k] = a[i]
			i++
		} else {
			buf[k] = a[j]
			j++
		}
		k++
	}
	for i < mid { // copy any leftover from the left half
		buf[k] = a[i]
		i++
		k++
	}
	for j < hi { // copy any leftover from the right half
		buf[k] = a[j]
		j++
		k++
	}
	copy(a[lo:hi], buf[lo:hi]) // write the merged run back into a
}

func mergeSort(a []int, lo, hi int, buf []int) {
	if hi-lo <= 1 { // 0 or 1 element is already sorted
		return
	}
	mid := (lo + hi) / 2
	mergeSort(a, lo, mid, buf)
	mergeSort(a, mid, hi, buf)
	merge(a, lo, mid, hi, buf)
}

func MergeSort(a []int) {
	buf := make([]int, len(a)) // one shared buffer, allocated once
	mergeSort(a, 0, len(a), buf)
}

func main() {
	a := []int{5, 2, 4, 7, 1, 3, 2, 6}
	MergeSort(a)
	fmt.Println(a) // [1 2 2 3 4 5 6 7]
}
```

#### Java

```java
import java.util.Arrays;

public class MergeSort {
    static void merge(int[] a, int lo, int mid, int hi, int[] buf) {
        int i = lo, j = mid, k = lo;
        while (i < mid && j < hi) {
            if (a[i] <= a[j]) buf[k++] = a[i++]; // "<=" → stable
            else              buf[k++] = a[j++];
        }
        while (i < mid) buf[k++] = a[i++];
        while (j < hi)  buf[k++] = a[j++];
        System.arraycopy(buf, lo, a, lo, hi - lo);
    }

    static void mergeSort(int[] a, int lo, int hi, int[] buf) {
        if (hi - lo <= 1) return;
        int mid = (lo + hi) >>> 1;
        mergeSort(a, lo, mid, buf);
        mergeSort(a, mid, hi, buf);
        merge(a, lo, mid, hi, buf);
    }

    public static void sort(int[] a) {
        int[] buf = new int[a.length];
        mergeSort(a, 0, a.length, buf);
    }

    public static void main(String[] args) {
        int[] a = {5, 2, 4, 7, 1, 3, 2, 6};
        sort(a);
        System.out.println(Arrays.toString(a)); // [1, 2, 2, 3, 4, 5, 6, 7]
    }
}
```

#### Python

```python
def merge(a, lo, mid, hi, buf):
    i, j, k = lo, mid, lo
    while i < mid and j < hi:
        if a[i] <= a[j]:        # "<=" → take from left on ties → STABLE
            buf[k] = a[i]
            i += 1
        else:
            buf[k] = a[j]
            j += 1
        k += 1
    while i < mid:              # leftover left half
        buf[k] = a[i]
        i += 1
        k += 1
    while j < hi:               # leftover right half
        buf[k] = a[j]
        j += 1
        k += 1
    a[lo:hi] = buf[lo:hi]       # copy merged run back


def _mergesort(a, lo, hi, buf):
    if hi - lo <= 1:
        return
    mid = (lo + hi) // 2
    _mergesort(a, lo, mid, buf)
    _mergesort(a, mid, hi, buf)
    merge(a, lo, mid, hi, buf)


def merge_sort(a):
    buf = [0] * len(a)         # one shared buffer
    _mergesort(a, 0, len(a), buf)
    return a


if __name__ == "__main__":
    print(merge_sort([5, 2, 4, 7, 1, 3, 2, 6]))  # [1, 2, 2, 3, 4, 5, 6, 7]
```

**What it does:** sorts the 8-element array from the walkthrough, preserving the order of the two `2`s.
**Run:** `go run main.go` | `javac MergeSort.java && java MergeSort` | `python merge_sort.py`

---

## Coding Patterns

### Pattern 1: Allocate the buffer ONCE, not per call

**Intent:** A naive merge sort allocates a fresh temporary array inside every `merge` call — that is `O(n log n)` allocations and heavy GC pressure. Instead, allocate a single `O(n)` buffer up front and pass it down. All three code examples above do this.

### Pattern 2: Two-pointer merge

**Intent:** The merge is the reusable core. Walk two sorted ranges with `i` and `j`, copy the smaller, advance, then drain the leftovers. This same two-pointer idea reappears in counting inversions and in the linked-list variant.

```python
def two_way_merge(L, R):
    out, i, j = [], 0, 0
    while i < len(L) and j < len(R):
        if L[i] <= R[j]:
            out.append(L[i]); i += 1
        else:
            out.append(R[j]); j += 1
    out.extend(L[i:]); out.extend(R[j:])
    return out
```

### Pattern 3: Bottom-up (iterative) merge sort

**Intent:** Avoid recursion entirely. Merge runs of width 1, then 2, then 4, … doubling each pass.

```python
def merge_sort_bottom_up(a):
    n = len(a)
    buf = list(a)
    width = 1
    while width < n:
        for lo in range(0, n, 2 * width):
            mid = min(lo + width, n)
            hi = min(lo + 2 * width, n)
            merge(a, lo, mid, hi, buf)   # reuse the same merge
        width *= 2
    return a
```

```mermaid
graph TD
    A["Unsorted array (n elements)"] -->|divide| B["Left half n/2"]
    A -->|divide| C["Right half n/2"]
    B -->|recurse| D["sorted left"]
    C -->|recurse| E["sorted right"]
    D -->|merge O(n)| F["Sorted array"]
    E -->|merge O(n)| F
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Array unsorted after running | Wrong base case or wrong `mid` split. | Base case is `hi - lo <= 1`; `mid = (lo + hi) / 2`. |
| Stability lost (equal elements reorder) | Used `<` instead of `<=` in the merge. | Take from the **left** list on ties: `a[i] <= a[j]`. |
| `IndexError` / out-of-bounds in merge | Forgot to drain leftover elements of one half. | After the main loop, copy *both* remaining tails. |
| Infinite recursion / stack overflow | Base case never reached (e.g. `mid` equals `lo` or `hi`). | Ensure both halves are strictly smaller than the whole. |
| Result has duplicated or missing values | Merged back into the wrong index range. | Write merged output into `[lo, hi)` only; copy that slice back. |
| Slow + heavy GC | Allocating a buffer inside each `merge`. | Allocate one buffer once and pass it down. |
| Integer overflow in `mid` (large arrays, C/Java) | `(lo + hi)` overflows. | Use `lo + (hi - lo) / 2` or unsigned shift `(lo + hi) >>> 1`. |

---

## Performance Tips

- **Allocate the buffer once.** A single shared `O(n)` buffer beats per-call allocation by a wide margin.
- **Cut off to insertion sort for small subarrays.** For runs of length `≤ 16` or so, insertion sort is faster (less overhead). Many production merge sorts do this.
- **Skip the merge when already ordered.** If `a[mid-1] <= a[mid]`, the two halves are already in order — skip the merge entirely. This makes nearly-sorted input much faster (the idea behind *natural* merge sort).
- **Ping-pong the buffers.** Alternate which array is source and which is destination each level to avoid copying the merged run back every time.
- **Prefer bottom-up for very large arrays** to dodge recursion overhead and deep stacks.
- **Use the linked-list variant** when you have a list, not an array — it needs no buffer at all.

---

## Best Practices

- Always use `<=` (take from the left) in the merge to keep the sort **stable**.
- Use a half-open range convention `[lo, hi)` consistently to avoid off-by-one bugs.
- Compute `mid` overflow-safely: `lo + (hi - lo) / 2`.
- Test against a trusted library sort on random arrays of many sizes (including 0 and 1).
- Document whether your variant is stable, in-place, top-down or bottom-up — these are the properties callers care about.
- For huge inputs, decide deliberately between recursive (clean) and iterative bottom-up (no deep stack).

---

## Edge Cases & Pitfalls

- **Empty array (`n = 0`)** — must return immediately; the base case `hi - lo <= 1` handles it.
- **Single element (`n = 1`)** — already sorted; base case returns.
- **Two elements** — one comparison, one possible swap via merge.
- **All equal elements** — merge does `n` comparisons per level; stability still holds.
- **Already sorted input** — still does all merges (`O(n log n)`) unless you add the "skip if ordered" optimization.
- **Reverse-sorted input** — same `O(n log n)`; no degradation (unlike naive quicksort's `O(n²)`).
- **Duplicate keys with satellite data** — stability matters; verify equal records keep their order.
- **Odd lengths** — the split `mid = (lo+hi)/2` gives halves differing by one; that is fine.
- **Very large `n`** — watch recursion depth (`O(log n)` is shallow, but pick bottom-up if worried) and buffer memory (`O(n)`).

---

## Common Mistakes

1. **Using `<` instead of `<=`** in the merge — silently breaks stability.
2. **Allocating a buffer inside every merge** — turns a fast sort into a GC-thrashing one.
3. **Forgetting to copy the leftover tail** of one half after the main merge loop — drops elements.
4. **Wrong base case** (`hi - lo == 0` only, or recursing on equal `lo`/`hi`) — infinite recursion.
5. **Overwriting the input while still reading it** — you must merge into a separate buffer, not in place naively.
6. **Off-by-one on the merge range** — always merge exactly `[lo, hi)` and copy back that same slice.
7. **Assuming merge sort is in-place** — standard array merge sort uses `O(n)` extra memory; only the linked-list version is `O(1)` extra.
8. **`mid` integer overflow** for very large indices in Java/C/Go — use the overflow-safe formula.

---

## Cheat Sheet

| Question | Answer |
|----------|--------|
| Time complexity (all cases) | `O(n log n)` |
| Auxiliary space (array) | `O(n)` (+ `O(log n)` stack) |
| Auxiliary space (linked list) | `O(1)` extra |
| Stable? | **Yes** (with `<=` in merge) |
| In-place? | **No** (for arrays) |
| Recurrence | `T(n) = 2T(n/2) + O(n)` |
| Base case | subarray of size `0` or `1` |
| Stability rule | take from the **left** list on ties |
| Best for | linked lists, external sort, stability, guaranteed worst case |

Core algorithm:

```
mergeSort(a, lo, hi):
    if hi - lo <= 1: return
    mid = lo + (hi - lo)/2
    mergeSort(a, lo, mid)
    mergeSort(a, mid, hi)
    merge(a, lo, mid, hi)      # two-pointer, "<=" keeps it stable

# T(n) = 2T(n/2) + O(n) = O(n log n);  O(n) extra space
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The **divide** phase splitting the array down to single elements.
> - The **merge** phase zipping sorted halves with the two-pointer scan.
> - Highlighting the compared front elements and which one is copied out.
> - Step / Run / Reset controls to watch each merge build a larger sorted run.

---

## Summary

Merge sort is the canonical divide-and-conquer sort: split the array in half, recursively sort each half, then merge the two sorted halves in linear time with a two-pointer scan. Because the array halves at each level (`log₂ n` levels) and each level does `O(n)` merging work, the running time is a guaranteed `O(n log n)` — best, average, and worst case alike, with no adversarial input. It is **stable** when the merge takes from the left list on ties, and it uses `O(n)` auxiliary memory for arrays (but only `O(1)` extra for linked lists). Master the merge step — the linear-time zipper of two sorted lists — and you have the key to merge sort, external sorting, and counting inversions all at once.

---

## Further Reading

- *Introduction to Algorithms* (CLRS), Chapter 2 — merge sort, the merge procedure, and the recurrence.
- *Algorithms* (Sedgewick & Wayne) — top-down and bottom-up merge sort, with cutoff and ping-pong optimizations.
- Sibling topic `02-quicksort` — the other great divide-and-conquer sort (in-place, average `O(n log n)`).
- Sibling topic on the **Master Theorem** — formally solving `T(n) = 2T(n/2) + O(n)`.
- `sorting-algorithms` skill — stability, comparison-sort lower bound, and choosing the right sort.
- cp-algorithms.com — "Sorting" and "Inversion count using merge sort".
