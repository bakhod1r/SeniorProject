# Heap Sort — Junior Level

> **One-line summary:** Heap Sort builds a max-heap from the array, then repeatedly extracts the maximum element to the end of the array, achieving guaranteed `O(n log n)` time and `O(1)` extra space — but it is **not stable** and has poor cache locality.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros-cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#visual-animation-reference)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

**Heap Sort** is a comparison-based, in-place sorting algorithm invented by **J. W. J. Williams in 1964**, the same person who introduced the binary heap data structure. It is one of the few sorting algorithms that combines **three desirable guarantees** simultaneously:

| Property | Heap Sort | Quick Sort | Merge Sort |
|----------|-----------|------------|------------|
| Worst-case time | **O(n log n)** ✅ | O(n²) ❌ | O(n log n) ✅ |
| In-place (O(1) space) | ✅ | ✅ (with care) | ❌ (O(n)) |
| Stable | ❌ | ❌ | ✅ |

That worst-case guarantee is why Heap Sort is used as the **fallback** when Quick Sort's recursion depth grows too large in **Introsort** — the algorithm behind C++ `std::sort` and Rust's `slice::sort_unstable`.

The algorithm works in two clean phases:

1. **Build a max-heap** from the input array — `O(n)` time using Floyd's bottom-up algorithm.
2. **Extract the max** repeatedly: swap the root with the last element, shrink the heap, and **sift the new root down** — `n` extractions × `O(log n)` each = `O(n log n)`.

You should learn Heap Sort even if you never write it from scratch in production, because:

- The underlying **binary heap** is the data structure behind every priority queue (`heapq`, `PriorityQueue`, `container/heap`, `std::priority_queue`).
- It is the canonical **in-place O(n log n)** algorithm — a benchmark for what is achievable.
- Interview questions like "find the k-th largest element" or "merge k sorted lists" use heaps.

---

## Prerequisites

Before you start, you should be comfortable with:

- **Arrays and zero-based indexing** — heaps are stored in arrays.
- **Recursion** — the `siftDown` helper is naturally recursive (though we usually iterate).
- **Integer arithmetic** — parent and child indices use `(i-1)/2`, `2i+1`, `2i+2`.
- **Big-O notation** — you should know what `O(n log n)` and `O(log n)` mean.
- **Comparison operators** — `<`, `>`, `<=`, `>=` (for max-heap vs min-heap).
- **Optional but helpful**: prior exposure to **binary trees**, even if only on paper.

If you have not yet read `01-bubble-sort/junior.md` and `04-quick-sort/junior.md`, do those first. Heap Sort is harder to grok than either.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Binary heap** | A complete binary tree where every parent satisfies a heap property relative to its children. Stored as an array. |
| **Max-heap** | Heap where parent ≥ both children. Root holds the maximum. |
| **Min-heap** | Heap where parent ≤ both children. Root holds the minimum. |
| **Complete binary tree** | All levels full except possibly the last, which fills left-to-right. This shape lets us store the tree in a flat array with no gaps. |
| **Heap property / heap invariant** | The ordering rule: max-heap = parent ≥ children; min-heap = parent ≤ children. |
| **Sift down (heapify-down, percolate-down, bubble-down)** | Restore the heap property by swapping a node with its larger child, repeatedly, until it lands. |
| **Sift up (heapify-up, percolate-up, bubble-up)** | Restore the heap property by swapping a node with its parent, repeatedly, until it lands. |
| **Build-heap** | Convert an arbitrary array into a heap. Takes `O(n)` if done bottom-up (Floyd's algorithm). |
| **Extract-max / extract-min** | Remove and return the root. `O(log n)` because of one sift-down. |
| **Heapify** | Sometimes means "sift down a single node," sometimes means "build the entire heap." Context-dependent. |
| **Floyd's algorithm** | Build-heap by sifting down from the last non-leaf node back to the root. `O(n)` total. |
| **Priority queue** | An abstract data type supporting insert and extract-min/max. Most often implemented with a binary heap. |
| **Stable sort** | Equal keys preserve their relative input order. Heap Sort is **not** stable. |
| **In-place** | Uses `O(1)` extra memory beyond the input array. Heap Sort is in-place. |
| **Comparison sort** | Sorts purely by `compare(a, b)`. Lower bound `Ω(n log n)`. Heap Sort matches this. |

---

## Core Concepts

### 1. The Array-as-Tree Mapping

A binary heap is a **complete binary tree**, so we can store it in an array with **no pointers**. For an element at index `i` (zero-based):

```
parent(i) = (i - 1) / 2     // integer division
left(i)   = 2 * i + 1
right(i)  = 2 * i + 2
```

Example — the array `[9, 7, 8, 4, 6, 5, 3, 1, 2]` represents this max-heap:

```
              9              (index 0)
            /   \
           7     8           (1, 2)
          / \   / \
         4   6 5   3         (3, 4, 5, 6)
        / \
       1   2                 (7, 8)
```

Verify: `arr[0]=9 ≥ arr[1]=7` ✅, `arr[0]=9 ≥ arr[2]=8` ✅, `arr[1]=7 ≥ arr[3]=4` ✅, etc.

### 2. Sift Down (the workhorse)

When a node violates the heap property by being **smaller than at least one child**, fix it by swapping with the **larger child**, then recurse. This is `O(log n)` because the tree height is `⌊log₂ n⌋`.

```
siftDown(arr, i, n):
    while 2*i + 1 < n:                 // while node has at least a left child
        left  = 2*i + 1
        right = 2*i + 2
        largest = i
        if left  < n and arr[left]  > arr[largest]: largest = left
        if right < n and arr[right] > arr[largest]: largest = right
        if largest == i: break          // heap property satisfied
        swap(arr, i, largest)
        i = largest
```

### 3. Build-Heap in O(n)

The naive approach — insert elements one by one and sift up each — is `O(n log n)`. Floyd's bottom-up build is `O(n)`:

```
buildMaxHeap(arr):
    for i from n/2 - 1 down to 0:      // last non-leaf to root
        siftDown(arr, i, n)
```

Why `O(n)`? Most nodes are near the bottom and need very few sift-down steps. We give a formal proof in `professional.md`. Intuition: ~n/2 leaves do zero work, ~n/4 nodes do one swap each, ~n/8 do two, and so on. The total is `n × Σ k/2ᵏ ≤ 2n`.

### 4. The Heap Sort Algorithm

```
heapSort(arr):
    n = len(arr)
    buildMaxHeap(arr)                  // O(n)
    for end from n - 1 down to 1:
        swap(arr, 0, end)              // move max to its final position
        siftDown(arr, 0, end)          // restore heap on first `end` elements
```

After `swap(arr, 0, end)`, `arr[end]` holds the largest remaining value, and we treat the heap as having only `end` elements (so the sorted region grows from the right).

### 5. Why Max-Heap for Ascending Order?

Counterintuitive at first: to sort **ascending**, use a **max-heap**. Reason: each extracted max goes to the **end** of the array. After `n−1` extractions, the smallest is at index 0 and the largest at index `n−1` — ascending order.

If you used a min-heap for ascending order, you'd need an auxiliary output array (because the extracted min goes at the **front** but the heap occupies that space). That breaks the in-place property.

---

## Big-O Summary

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Build-heap (Floyd's) | **O(n)** | O(1) | Tighter than the obvious `O(n log n)` bound. |
| Sift down / sift up (single call) | **O(log n)** | O(1) | Tree height bound. |
| Insert (priority queue) | **O(log n)** | O(1) amortized for dynamic array. |
| Extract max/min | **O(log n)** | O(1) | One sift down from the root. |
| Peek (look at root) | **O(1)** | O(1) | |
| Decrease-key (with index) | **O(log n)** | O(1) | Needs an "index map" alongside the heap. |
| **Heap Sort — best** | **O(n log n)** | **O(1)** | Even already-sorted input takes `O(n log n)`. |
| **Heap Sort — average** | **O(n log n)** | O(1) | |
| **Heap Sort — worst** | **O(n log n)** | O(1) | Best worst-case guarantee among in-place sorts. |
| **Stable** | ❌ No | — | Equal keys can be reordered during sift down. |

Notice: Heap Sort has **no `O(n)` best case**. Even if the input is already sorted ascending (which is a valid min-heap, not a max-heap), build-heap still does `O(n)` work and the extraction phase still does `O(n log n)`.

---

## Real-World Analogies

### 1. Tournament Bracket

In a single-elimination tournament, the champion (root) is the strongest. To find the runner-up, you only re-play matches involving the champion's path — `O(log n)` games — not the whole tournament. Sift down is exactly this: the new candidate at the root "challenges" its way down.

### 2. Hospital Triage

Patients arrive in random order, but the most critical is always treated first. The triage queue is a **max-heap on severity**. New patients insert in `O(log n)`; the next-to-treat is the root, extractable in `O(log n)`.

### 3. Top of the Mountain

Build-heap is like organizing a pyramid of stones: each parent must be heavier than its kids. Heap Sort then says, "take the heaviest stone off the top, put it aside, re-balance, repeat" — until the pyramid is gone and the stones lie in order from heaviest to lightest.

### 4. CPU Scheduler

A priority-based OS scheduler keeps runnable threads in a heap keyed on dynamic priority. Pop the highest-priority thread, run it, possibly re-insert with a lower priority. Linux's old `O(1) scheduler` and BSD's `kqueue` use heap-like structures.

---

## Pros & Cons

### Pros

- **Guaranteed `O(n log n)` worst case.** Unlike Quick Sort, no adversarial input can degrade it.
- **In-place.** Only `O(1)` auxiliary memory.
- **No worst-case extra recursion.** Sift-down can be iterative.
- **The data structure underneath (the heap) is independently useful** — every priority queue is a heap.
- **Performs well on memory-constrained devices** — no recursion stack, no allocation.

### Cons

- **Not stable.** Equal keys can swap during sift-down.
- **Poor cache behavior.** Children at index `2i+1`, `2i+2` are often far away in memory; each level doubles the stride. Cache misses dominate runtime.
- **Slower constant factor** than Quick Sort or Merge Sort in practice — typically 2–3× slower wall-clock.
- **Two sequential passes over the array** (build, then extract) — hard to parallelize naturally.
- **Adversarial branch prediction** — sift-down chooses the larger child, which is data-dependent and unpredictable.

> **Rule of thumb:** never write Heap Sort by hand for production data sorting. Use the standard library. Heap Sort's real-world role is (a) inside Introsort as a fallback and (b) as a priority queue.

---

## Step-by-Step Walkthrough

Let's sort `[4, 10, 3, 5, 1]` ascending using a max-heap.

### Phase 1 — Build the max-heap

The last non-leaf is at index `n/2 - 1 = 5/2 - 1 = 1`.

**i = 1** (value 10): children at 3 (=5) and 4 (=1). 10 > 5 and 10 > 1 → no swap.

```
Tree:        4               Array: [4, 10, 3, 5, 1]
           /   \
         10     3
         / \
        5   1
```

**i = 0** (value 4): children at 1 (=10) and 2 (=3). Largest is 10 → swap 4 and 10.

```
Array: [10, 4, 3, 5, 1]
Now sift-down from i=1 (value 4): children 3 (=5), 4 (=1). Largest 5 → swap.
Array: [10, 5, 3, 4, 1]
i=3: no children. Stop.
```

Final heap:

```
              10
            /    \
           5      3
          / \
         4   1
```

### Phase 2 — Extract max repeatedly

**Step 1:** swap root (10) with last (1). Array `[1, 5, 3, 4, 10]`. Shrink heap to size 4. Sift down from 0:

- i=0 (value 1), children 1 (=5), 2 (=3). Largest 5 → swap. Array `[5, 1, 3, 4, 10]`.
- i=1 (value 1), child 3 (=4). 4 > 1 → swap. Array `[5, 4, 3, 1, 10]`.

**Step 2:** swap root (5) with index 3 (=1). Array `[1, 4, 3, 5, 10]`. Shrink to 3. Sift down:

- i=0 (value 1), children 1 (=4), 2 (=3). Largest 4 → swap. Array `[4, 1, 3, 5, 10]`.
- i=1 (value 1), no children (left = 3 ≥ heap size 3). Stop.

**Step 3:** swap root (4) with index 2 (=3). Array `[3, 1, 4, 5, 10]`. Shrink to 2. Sift down:

- i=0 (value 3), child 1 (=1). 3 ≥ 1. Stop.

**Step 4:** swap root (3) with index 1 (=1). Array `[1, 3, 4, 5, 10]`. Shrink to 1. Done.

Final sorted array: `[1, 3, 4, 5, 10]` ✅.

---

## Code Examples

### Go — clean, iterative, in-place

```go
package main

import "fmt"

// HeapSort sorts arr ascending in place using a max-heap.
func HeapSort(arr []int) {
	n := len(arr)
	// Phase 1: build max-heap (Floyd's bottom-up, O(n))
	for i := n/2 - 1; i >= 0; i-- {
		siftDown(arr, i, n)
	}
	// Phase 2: extract max repeatedly
	for end := n - 1; end > 0; end-- {
		arr[0], arr[end] = arr[end], arr[0] // move current max to end
		siftDown(arr, 0, end)               // restore heap on first `end` elements
	}
}

// siftDown restores the max-heap property at root, treating arr[0:n] as the heap.
func siftDown(arr []int, root, n int) {
	for {
		left := 2*root + 1
		if left >= n {
			return // root is a leaf
		}
		largest := left
		right := left + 1
		if right < n && arr[right] > arr[left] {
			largest = right
		}
		if arr[root] >= arr[largest] {
			return // heap property holds
		}
		arr[root], arr[largest] = arr[largest], arr[root]
		root = largest
	}
}

func main() {
	a := []int{4, 10, 3, 5, 1}
	HeapSort(a)
	fmt.Println(a) // [1 3 4 5 10]
}
```

### Java — generics with `Comparable`

```java
import java.util.Arrays;

public class HeapSort {

    public static <T extends Comparable<T>> void sort(T[] arr) {
        int n = arr.length;
        // Build max-heap
        for (int i = n / 2 - 1; i >= 0; i--) {
            siftDown(arr, i, n);
        }
        // Extract max repeatedly
        for (int end = n - 1; end > 0; end--) {
            T tmp = arr[0]; arr[0] = arr[end]; arr[end] = tmp;
            siftDown(arr, 0, end);
        }
    }

    private static <T extends Comparable<T>> void siftDown(T[] arr, int root, int n) {
        while (true) {
            int left = 2 * root + 1;
            if (left >= n) return;
            int largest = left;
            int right = left + 1;
            if (right < n && arr[right].compareTo(arr[left]) > 0) largest = right;
            if (arr[root].compareTo(arr[largest]) >= 0) return;
            T tmp = arr[root]; arr[root] = arr[largest]; arr[largest] = tmp;
            root = largest;
        }
    }

    public static void main(String[] args) {
        Integer[] a = {4, 10, 3, 5, 1};
        sort(a);
        System.out.println(Arrays.toString(a)); // [1, 3, 4, 5, 10]
    }
}
```

### Python — readable, beginner-friendly

```python
def heap_sort(arr: list[int]) -> None:
    """Sort `arr` ascending in place using a max-heap."""
    n = len(arr)
    # Phase 1: build max-heap (Floyd's bottom-up, O(n))
    for i in range(n // 2 - 1, -1, -1):
        sift_down(arr, i, n)
    # Phase 2: extract max repeatedly
    for end in range(n - 1, 0, -1):
        arr[0], arr[end] = arr[end], arr[0]
        sift_down(arr, 0, end)


def sift_down(arr: list[int], root: int, n: int) -> None:
    """Restore the max-heap property at `root`, given the heap is arr[0:n]."""
    while True:
        left = 2 * root + 1
        if left >= n:
            return
        largest = left
        right = left + 1
        if right < n and arr[right] > arr[left]:
            largest = right
        if arr[root] >= arr[largest]:
            return
        arr[root], arr[largest] = arr[largest], arr[root]
        root = largest


if __name__ == "__main__":
    a = [4, 10, 3, 5, 1]
    heap_sort(a)
    print(a)  # [1, 3, 4, 5, 10]
```

> **Tip:** Python's standard library has `heapq`, which is a **min-heap** API. To sort ascending with `heapq`, you push everything and pop everything (`O(n log n)`), but it requires `O(n)` extra space because `heapq` does not sort in place. The hand-written version above is the truly in-place version.

---

## Coding Patterns

### Pattern 1: Sift down vs sift up

- **Build-heap** uses **sift down** (bottom-up build).
- **Insert** uses **sift up** (place at end, swim up).
- **Extract-root** uses **sift down** (replace root with last, sink down).

```python
def sift_up(arr, i):
    while i > 0:
        parent = (i - 1) // 2
        if arr[parent] >= arr[i]:
            return
        arr[parent], arr[i] = arr[i], arr[parent]
        i = parent
```

### Pattern 2: Min-heap from max-heap

Negate values:

```python
import heapq
nums = [3, 1, 4, 1, 5, 9, 2, 6]
neg = [-x for x in nums]
heapq.heapify(neg)        # max-heap behaviour
print(-heapq.heappop(neg))  # 9
```

Or wrap with a key class implementing reverse `__lt__`. Or use a min-heap of `(-priority, value)` tuples.

### Pattern 3: K-th largest (top-k)

Maintain a **min-heap of size k**. Whenever you see a new element greater than the heap's min, replace it.

```python
import heapq

def k_largest(nums, k):
    heap = nums[:k]
    heapq.heapify(heap)              # O(k)
    for x in nums[k:]:
        if x > heap[0]:
            heapq.heapreplace(heap, x)  # pop + push in one O(log k)
    return heap[0]                    # the k-th largest
```

Total time: `O(n log k)` — much better than sorting (`O(n log n)`) when `k ≪ n`.

### Pattern 4: Merge k sorted lists

Min-heap of `(value, list_idx, element_idx)` triples. Pop the smallest, push the next from that list. `O(N log k)` where `N = total elements`.

---

## Error Handling

Heap Sort itself rarely throws, but production code wraps it with checks.

```python
def heap_sort_safe(arr):
    if arr is None:
        raise ValueError("arr must not be None")
    if not all(isinstance(x, (int, float)) for x in arr):
        raise TypeError("all elements must be numeric")
    if any(x != x for x in arr):  # NaN check
        raise ValueError("NaN cannot be sorted (no total order)")
    heap_sort(arr)
```

```go
func HeapSort(arr []int) error {
    if arr == nil {
        return fmt.Errorf("arr must not be nil")
    }
    // ...
    return nil
}
```

```java
public static <T extends Comparable<T>> void sort(T[] arr) {
    if (arr == null) throw new NullPointerException("arr must not be null");
    for (T t : arr) if (t == null) throw new NullPointerException("null elements not supported");
    // ...
}
```

> **NaN warning:** floating-point NaN breaks the heap invariant because `NaN < x`, `NaN > x`, and `NaN == x` are all false. Heap Sort with NaN in the array produces **non-deterministic** output. Filter NaNs first.

---

## Performance Tips

1. **Use `>=` (not `>`) in the early-exit check.** This avoids one extra swap when the parent equals the larger child.
2. **Iterate, don't recurse, in `siftDown`.** Compilers usually convert tail-recursive sift-down to a loop, but Java's JIT may not always inline; iterative is safer.
3. **Inline the comparison.** Going through `Comparable.compareTo` is a virtual call; for primitive arrays, prefer specialized code.
4. **Cache the value being sifted.** Instead of swapping at each step, store the sifting value once and only write it at the final position. This halves the writes.
5. **For very large arrays, consider d-ary heaps (d=4 or d=8).** Children fit in one cache line, sift-down is shallower (`log_d n` instead of `log_2 n`), trading more comparisons per node for fewer cache misses.
6. **Avoid Heap Sort on small arrays.** For `n < 16`, insertion sort wins.

---

## Best Practices

- **Use `heapq` / `PriorityQueue` / `container/heap` from the standard library** for production priority-queue use. Don't roll your own.
- **For sorting**, use `sort.Slice` (Go), `Arrays.sort` (Java), `sorted()` (Python). All use Introsort, Tim Sort, or pdqsort — all faster than hand-written Heap Sort.
- **When you do need O(n log n) worst case** (real-time systems, security-sensitive code immune to QuickSort attacks), Heap Sort is the right choice.
- **Document the lack of stability** — equal keys may swap.
- **Be explicit about max vs min.** It is easy to write code that mixes both up.
- **Write tests with: empty array, single element, two elements, already-sorted, reverse-sorted, duplicates, all-equal, large random.**

---

## Edge Cases

| Input | Heap Sort behavior |
|-------|--------------------|
| `[]` | Returns immediately. `n/2 - 1 = -1`, loop does not execute. |
| `[42]` | Build-heap loop does not execute. Extract loop does not execute (`end = 0`). |
| `[2, 1]` | Build-heap: i=0, swap to `[2,1]`. Already a heap. Extract: swap → `[1,2]`. ✅ |
| `[5, 5, 5, 5]` | Equal keys. Builds OK. Extraction shuffles them; final result is `[5,5,5,5]`. (But original order may be lost — not stable.) |
| `[1, 2, 3, 4, 5]` (already sorted) | Still `O(n log n)`. No "best case" speedup. |
| `[5, 4, 3, 2, 1]` (reverse) | Builds in one pass (already a max-heap!). Extraction phase still `O(n log n)`. |
| Very large `n` (10⁸) | Cache misses dominate; expect 3–5× slower than `Arrays.sort`. |
| `Integer.MIN_VALUE` mixed with normal ints | No issue — comparison is fine. |
| Floating-point NaN | Undefined behavior; filter first. |
| Custom objects with broken `compareTo` (not transitive) | Heap invariant breaks; results garbage. |

---

## Common Mistakes

### Mistake 1: Wrong child indices

```python
# WRONG — these are 1-indexed formulas
left = 2 * i
right = 2 * i + 1
```

Correct (zero-indexed):

```python
left  = 2 * i + 1
right = 2 * i + 2
```

### Mistake 2: Sift-down compares with parent instead of larger child

```python
# WRONG
if arr[i] < arr[left]:
    swap(arr, i, left)
```

You must compare both children and pick the **larger** (for max-heap). Otherwise the heap invariant breaks: after sifting, the new parent might be smaller than the right child.

### Mistake 3: Off-by-one in build-heap loop

```python
# WRONG — starts past the last non-leaf
for i in range(n // 2, -1, -1): ...
```

The last non-leaf is `n // 2 - 1` (zero-indexed). Starting at `n // 2` does extra work but is harmless (sifting a leaf is a no-op). Starting at `n // 2 + 1` would skip the right node — broken.

### Mistake 4: Forgetting to shrink the heap during extraction

```python
# WRONG — sifts down on the full array, undoing the swap
for end in range(n - 1, 0, -1):
    arr[0], arr[end] = arr[end], arr[0]
    sift_down(arr, 0, n)   # should be `end`, not `n`
```

### Mistake 5: Using min-heap for ascending order in-place

Min-heap pops the min into index 0 — but that's where the heap root is. You'd overwrite live heap data. Use max-heap for ascending in place.

### Mistake 6: Treating Python's `heapq` as a max-heap

```python
import heapq
heapq.heappush(h, 5)
heapq.heappush(h, 3)
heapq.heappop(h)   # 3, NOT 5  — heapq is a min-heap
```

Negate values or wrap them to get max-heap behaviour.

### Mistake 7: Iterating while modifying a heap

If you `for x in heap: ...` and call `heappush`/`heappop` inside, you mutate the underlying list during iteration. Always copy or convert to a sorted list first.

### Mistake 8: Recursion depth on huge arrays

Recursive sift-down on `n = 10⁹` would recurse `log₂(10⁹) ≈ 30` levels — that's fine. But naive recursive **build-heap** that traverses the array recursively could blow the stack. Use the iterative build (`for i := n/2-1; i >= 0; i--`).

---

## Cheat Sheet

```text
            ┌──────────────────────────────────────────────────────┐
            │                  HEAP SORT                            │
            ├──────────────────────────────────────────────────────┤
            │  Time (best/avg/worst):     O(n log n) / O(n log n)  │
            │  Space:                     O(1) — in-place           │
            │  Stable:                    NO                        │
            │  Adaptive:                  NO                        │
            │  Online:                    NO                        │
            │  In-place:                  YES                       │
            ├──────────────────────────────────────────────────────┤
            │  parent(i) = (i - 1) / 2                              │
            │  left(i)   = 2*i + 1                                  │
            │  right(i)  = 2*i + 2                                  │
            ├──────────────────────────────────────────────────────┤
            │  Build-heap: O(n) bottom-up, sift-down each non-leaf │
            │  Extract-max: O(log n) — swap root with last, sift  │
            │  Total: O(n) + n × O(log n) = O(n log n)             │
            ├──────────────────────────────────────────────────────┤
            │  Use cases:                                          │
            │  • Introsort fallback (worst-case guarantee)         │
            │  • Priority queues (Dijkstra, Huffman, schedulers)   │
            │  • Top-k via min-heap of size k                      │
            │  AVOID for sorting in modern hot loops:              │
            │  • Cache-unfriendly                                  │
            │  • Slower than Tim Sort / pdqsort in practice        │
            └──────────────────────────────────────────────────────┘
```

---

## Visual Animation Reference

Open `animation.html` in a browser. You will see:

- The array drawn both as **bars** (linear view) and as a **binary tree** (SVG).
- Color codes: **blue** = default, **purple** = current node being sifted, **red** = comparing children, **yellow** = swap, **green** = sorted (placed in final position at end).
- The animation runs in two phases: **build-heap** (you'll see sift-downs starting from the middle of the array, working back to the root), then **extract-max** (you'll see the root swap with the last unsorted element, then sift down to restore the heap).
- Stats panel shows: pass number, comparisons, swaps, current heap size.

Use the **Step** button to advance one operation at a time and trace the algorithm by hand.

---

## Summary

- Heap Sort is **`O(n log n)` in all cases**, **in-place**, and **not stable**.
- The algorithm has two phases: **build a max-heap (`O(n)`)** then **extract max `n` times (`O(n log n)`)**.
- The underlying data structure is a **binary heap** stored in an array using simple index arithmetic.
- The key operation is **sift down**, which restores the heap invariant by swapping with the larger child until the position is valid.
- It is **slower in practice** than Quick Sort or Merge Sort on cache-rich modern hardware, but its **worst-case guarantee** makes it valuable as a fallback (Introsort) and in real-time / security-critical contexts.
- The heap data structure itself is wildly useful: every priority queue, Dijkstra's algorithm, Huffman coding, top-k queries, and event-driven simulations are heap-powered.

> **Next steps:** read `middle.md` for deeper invariant analysis and the `O(n)` build-heap proof intuition, then `senior.md` for production patterns (Introsort, distributed top-k, priority queues at scale).

---

## Further Reading

### Books

- **CLRS, _Introduction to Algorithms_, 3rd ed.**, Chapter 6 — the canonical treatment.
- **Sedgewick & Wayne, _Algorithms_, 4th ed.**, Section 2.4 — priority queues.
- **Skiena, _The Algorithm Design Manual_**, Section 4.3 — heap sort.

### Papers

- Williams, J. W. J. (1964). _Heapsort_, Algorithm 232, Communications of the ACM 7(6):347–348. The original.
- Floyd, R. W. (1964). _Treesort 3_, Communications of the ACM 7(12):701. The `O(n)` build-heap.
- Musser, D. R. (1997). _Introspective Sorting and Selection Algorithms_. The Introsort paper — Heap Sort as fallback.

### Online

- **Khan Academy — Heap Sort**, interactive visualization.
- **VisuAlgo — Heap**, beautiful animation by Steven Halim.
- **Python `heapq` docs** — `https://docs.python.org/3/library/heapq.html`
- **Java `PriorityQueue`** — `https://docs.oracle.com/javase/8/docs/api/java/util/PriorityQueue.html`
- **Go `container/heap`** — `https://pkg.go.dev/container/heap`

### Related topics in this roadmap

- `04-quick-sort/` — the algorithm Heap Sort backs up in Introsort.
- `05-merge-sort/` — the other guaranteed `O(n log n)` algorithm (but `O(n)` space).
- `09-graph-algorithms/dijkstra/` — uses min-heap.
- `10-greedy-algorithms/huffman-coding/` — uses min-heap.
