# Merge Sort (The Canonical Divide-and-Conquer Algorithm) — Interview Preparation

Merge sort is a favourite interview topic because it rewards a single crisp insight — *"split in half, sort each half, merge in linear time"* — and then tests whether you can (a) prove it is `O(n log n)` via the recurrence, (b) implement the merge correctly and **stably**, (c) recognize the same merge skeleton behind linked-list sorting, counting inversions, and external sort, and (d) compare it intelligently with quicksort. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Answer | Complexity |
|----------|--------|------------|
| Time, all cases | guaranteed `O(n log n)` | best = avg = worst |
| Auxiliary space (array) | `O(n)` (+ `O(log n)` stack) | not in-place |
| Auxiliary space (linked list) | `O(1)` extra | just relink |
| Stable? | **Yes** (take left on ties, `<=`) | — |
| Recurrence | `T(n) = 2T(n/2) + O(n)` | `= O(n log n)` |
| Count inversions | instrument the merge (`+= mid - i`) | `O(n log n)` |
| Sort huge data (> RAM) | external merge sort | `O((N/B) log_{M/B}(N/B))` IO |
| vs quicksort | guaranteed/stable vs in-place/cache-fast | — |

Core algorithm:

```text
mergeSort(a, lo, hi):
    if hi - lo <= 1: return            # base: 0 or 1 element
    mid = lo + (hi - lo)/2
    mergeSort(a, lo, mid)
    mergeSort(a, mid, hi)
    merge(a, lo, mid, hi)              # two-pointer, "<=" keeps it STABLE

# T(n) = 2T(n/2) + O(n) = O(n log n);  O(n) extra space (array)
```

Merge step:

```text
merge(L, R):
    i = j = 0
    while i<|L| and j<|R|:
        if L[i] <= R[j]: take L[i]; i++     # "<=" → stable
        else:            take R[j]; j++
    drain remaining of L, then of R
```

Key facts:
- **Length of recursion = `log n`**, **work per level = `O(n)`** → `O(n log n)`.
- `<=` (take from the **left**) = stable; `<` breaks stability.
- Array merge needs an `O(n)` buffer; linked-list merge needs none.
- Taking from the **right** run during a merge counts inversions.

---

## Junior Questions (12 Q&A)

### J1. What are the three steps of merge sort?
**Divide** the array into two halves; **conquer** by recursively sorting each half; **combine** the two sorted halves with a linear-time merge. This is the canonical divide-and-conquer pattern.

### J2. What is the base case?
A subarray of length 0 or 1. A single element (or empty) is already sorted, so the recursion stops there and starts merging back up.

### J3. How does the merge step work?
Walk both sorted halves with two pointers `i` and `j`. Compare the front elements, copy the smaller one to the output, advance that pointer. When one half is exhausted, copy the rest of the other. Each element is copied once, so it is `O(n)`.

### J4. What is the time complexity, and why?
`O(n log n)` in all cases. There are `log₂ n` levels of recursion (halving down to size 1), and each level does `O(n)` total merging work, so `n × log n`. The recurrence is `T(n) = 2T(n/2) + O(n)`.

### J5. Is merge sort stable?
Yes, as long as the merge takes from the **left** half on ties (`L[i] <= R[j]`). Equal elements keep their original relative order. Using `<` instead would break stability.

### J6. How much extra memory does merge sort use?
For arrays, `O(n)` auxiliary space for the merge buffer (you cannot overwrite the input while reading it), plus `O(log n)` recursion stack. It is **not** in-place. For linked lists, only `O(1)` extra.

### J7. Why is merge sort not in-place for arrays?
Merging two sorted halves requires a temporary buffer to hold the merged result before copying it back — you cannot interleave them in place without `O(n)` work or complex rotations. So standard array merge sort trades `O(n)` memory for simplicity and stability.

### J8. What happens on an already-sorted array?
Plain merge sort still does all the merges — `O(n log n)`. With the optimization "skip the merge if `a[mid-1] <= a[mid]`", already-sorted input becomes much faster (this is the seed of natural merge sort).

### J9. Best, average, worst case?
All three are `O(n log n)`. Unlike quicksort, there is no input that degrades merge sort — its performance does not depend on the data's order.

### J10. What is the difference between top-down and bottom-up merge sort?
Top-down is the recursive version (split, recurse, merge). Bottom-up is iterative: merge runs of width 1, then 2, then 4, … doubling each pass with no recursion. Same `O(n log n)`; bottom-up uses no recursion stack.

### J11. Can merge sort sort a linked list well?
Yes — it is the ideal sort for linked lists. Splitting uses slow/fast pointers, and merging just re-links nodes, needing **no** extra buffer (`O(1)` extra space). Quicksort, by contrast, needs random access.

### J12 (analysis). Why is the merge step `O(n)` and not `O(n²)`?
Because each element is copied to the output exactly once. The two pointers only ever move forward, so the total number of steps is the combined length of the two halves — linear, not quadratic.

---

## Middle Questions (12 Q&A)

### M1. Prove merge sort is `O(n log n)`.
Solve `T(n) = 2T(n/2) + cn`. By the recursion tree, every level has total cost `cn` (the subproblem sizes per level sum to `n`), and there are `log₂ n` levels, giving `cn log n = O(n log n)`. Equivalently, the Master Theorem case 2 (`a=2, b=2, f(n)=Θ(n)=Θ(n^{log_b a})`) gives `Θ(n log n)`.

### M2. When is quicksort better than merge sort?
For in-RAM arrays of primitives: quicksort is in-place (`O(log n)` stack vs `O(n)` buffer) and far more cache-friendly, so its constant factors win. The risk is its `O(n²)` worst case, mitigated by randomized/median-of-three pivots or introsort (switch to heapsort).

### M3. When is merge sort better than quicksort?
When you need a worst-case `O(n log n)` guarantee, **stability**, sorting of **linked lists** (`O(1)` extra space), or **external sorting** of data larger than RAM. Also when comparisons are expensive (long strings, deep comparators), since merge sort does fewer comparisons.

### M4. How do you count inversions with merge sort?
Run merge sort; during each merge, whenever you take an element from the **right** half, it is smaller than all remaining left-half elements, so add `(mid - i)` to the counter. Total inversions come out in `O(n log n)`.

### M5. What is natural merge sort?
It exploits existing sorted **runs** instead of starting from size-1 pieces. Scan for maximal ascending runs, then merge adjacent runs repeatedly. On already-sorted input (one run) it is `O(n)`; on random input it degrades to `O(n log n)`. It is the core idea behind Timsort.

### M6. How does ping-ponging buffers help?
Standard merge writes to a buffer then copies back to the source every level — `n` extra moves per level. Ping-pong alternates which array is source vs destination across levels, eliminating the copy-back (track parity so the result lands in the original array). Roughly halves data movement.

### M7. What is the insertion-sort cutoff and why use it?
For small subarrays (length `≤ ~16`), recursion and merge overhead exceed a simple insertion sort. Sorting tiny runs with insertion sort, then merging upward, is a constant-factor win used by essentially every production merge sort (Timsort's `minrun` is 32–64).

### M8. Why does `<=` vs `<` matter in the merge?
`L[i] <= R[j]` takes the left (earlier) element on ties, preserving input order among equal keys → **stable**. `L[i] < R[j]` takes the right element on ties, emitting a later element first → **unstable**. The one character is the whole difference.

### M9. What is external merge sort?
For data too large for RAM: read RAM-sized chunks, sort each in memory, write them back as sorted **runs** on disk, then `k`-way merge the runs (with a min-heap) into longer runs until one remains. The number of merge passes is `⌈log_k(N/M)⌉`; minimizing passes minimizes IO.

### M10. Is bottom-up merge sort the same as top-down?
For power-of-two `n` they do exactly the same merges in the same size order — only the scheduling differs (loop vs recursion). Bottom-up uses `O(1)` control space (no recursion stack). Both are `O(n log n)` and stable.

### M11. How do you sort a linked list with merge sort?
Find the middle with slow/fast pointers, cut the list in two (`slow.next = None`), recursively sort each half, then merge by re-linking nodes (no buffer). This gives a stable `O(n log n)` sort with `O(1)` extra space — merge sort's killer application.

### M12 (analysis). What is the comparison-sort lower bound and is merge sort optimal?
Any comparison sort needs `Ω(n log n)` comparisons, because its decision tree must have `≥ n!` leaves, so its height is `≥ lg(n!) = Ω(n log n)`. Merge sort achieves `O(n log n)`, so it is asymptotically optimal among comparison sorts.

---

## Senior Questions (10 Q&A)

### S1. How would you sort 1 TB of data on a machine with 16 GB of RAM?
External merge sort. Phase 1: read 16 GB chunks, sort each in memory, spill as sorted runs to disk (~64 runs). Phase 2: `k`-way merge the runs with a min-heap. With `k` large enough (limited by buffer memory), one or two merge passes suffice. Minimize passes (`⌈log_k(N/M)⌉`) since IO dominates; use large sequential buffers.

### S2. How do you parallelize merge sort?
The two recursive halves are independent — sort them on separate threads down to a granularity cutoff, then merge. The final sequential merge is an Amdahl bottleneck; remove it with a **parallel merge** (median split + binary search to partition the merge into independent pieces). This is what `Arrays.parallelSort` does.

### S3. Why do standard libraries use merge sort (Timsort) for objects?
A library object sort must be **stable**, **never quadratic**, and **fast on real-world partially-ordered data**. Merge sort gives stability + the `O(n log n)` guarantee; adaptivity (natural runs + galloping) gives real-world speed. Quicksort gives neither stability nor a worst-case guarantee, so it is reserved for primitive arrays where those do not matter.

### S4. How do you keep a parallel or external merge sort stable?
Tag each record with its **global input index** and break ties on it. Whenever partitioning or run-merging could reorder equal keys, the index tie-breaker restores input order. This makes any sort stable at the cost of one extra comparison field.

### S5. What is Timsort and what are its key tricks?
An adaptive, stable merge sort (Python `sorted`, Java object sort). Tricks: (1) `minrun` — extend short runs and insertion-sort them; (2) **galloping** — exponential search when one run dominates the merge, cutting comparisons to `O(log n)`; (3) a run-length **stack with balancing invariants** guaranteeing `O(n log n)` while exploiting order for `O(n)` on sorted data.

### S6. What are the main performance levers in merge sort?
Allocate the buffer once (not per merge), ping-pong to avoid copy-backs, insertion-sort cutoff below ~16, skip the merge when `a[mid-1] <= a[mid]`, and gallop on one-sided runs. For objects, sort references not payloads. For external/parallel, tune `k`/granularity.

### S7. How do you verify a sort is correct at scale?
Two cheap invariants run together: **is-sorted** (one `O(n)` scan) and **multiset/permutation** (same elements with same multiplicities — verify with a checksum/XOR before and after). Sorted-but-not-a-permutation (dropped/duplicated elements from a botched leftover-drain) is the most common silent bug, and is-sorted alone misses it.

### S8. When would you NOT use merge sort?
When sorting in-RAM arrays of primitives where memory is tight and stability is irrelevant — heapsort (`O(1)` space, guaranteed) or quicksort/introsort (cache-fast) win. Merge sort's `O(n)` buffer and extra data movement are pure overhead there.

### S9. How does merge sort map to GPUs / SIMD?
The scalar merge's data-dependent branch is poison on SIMD. **Bitonic merge sort** is a data-oblivious comparison network (fixed comparison pattern, depth `O(log² n)`) that maps cleanly to GPU lanes — asymptotically worse (`n log² n`) but far faster on massively parallel hardware.

### S10 (analysis). Why is external merge sort's IO complexity optimal?
In the external-memory (DAM) model, sorting requires `Θ((N/B) log_{M/B}(N/B))` block transfers (Aggarwal-Vitter lower bound). External merge sort matches it: run formation reads+writes once, and each `k`-way merge pass (with `k ≈ M/B`) reduces runs by a factor `M/B` while reading+writing once, for `log_{M/B}(N/M)` passes. With realistic `M/B`, that is just 1–2 passes.

---

## Professional Questions (8 Q&A)

### P1. Design a service that sorts user-uploaded files larger than memory.
Stream the file in `M`-sized chunks; sort each chunk (any `O(n log n)` sort) and spill to temp storage as a sorted run. Then `k`-way merge the runs with a min-heap, streaming the output. Choose `k` and buffer sizes to hit 1–2 passes. Preserve stability by tagging records with input order if needed. Emit metrics: run count, pass count, bytes read/written. Clean up temp files on success or failure.

### P2. Your object sort must be stable and never quadratic. What do you implement?
An adaptive merge sort (Timsort-style): detect natural runs, extend short ones to `minrun` with insertion sort, merge runs using a balanced run-length stack to guarantee `O(n log n)`, with galloping for one-sided merges. Stability comes from the left-on-ties merge rule. This is exactly what Java's `Arrays.sort(Object[])` and Python's `list.sort` do.

### P3. A teammate's merge sort is slow and GC-heavy. How do you diagnose it?
Profile allocations — the classic cause is allocating a temp array inside every `merge` call (`O(n log n)` allocations). Fix: allocate one shared buffer and thread it through, or ping-pong two buffers. Also check for a missing small-run cutoff and unnecessary copy-backs. For objects, ensure it sorts references, not deep-copied records.

### P4. How do you decide merge sort vs quicksort vs heapsort in a code review?
Ask three questions: (1) Is stability required? → merge sort. (2) Is a worst-case `O(n log n)` guarantee required (SLA, untrusted input)? → merge sort or heapsort. (3) Is it an in-RAM primitive array where speed/cache dominate and stability is irrelevant? → quicksort/introsort. Linked list or data > RAM → merge sort. Memory-tight + guarantee + no stability → heapsort.

### P5. How would you count inversions across a distributed dataset?
Count local inversions per shard with the merge-based counter, then count **cross-shard** inversions: for each pair of shards in order, count pairs `(x in earlier shard, y in later shard)` with `x > y` using the merge/two-pointer idea on the sorted shards (or order-statistic structures). Sum local + cross. Tag with global index to disambiguate equal keys.

### P6. Explain the 2015 Timsort bug and its lesson.
Timsort's run-length stack maintains invariants ensuring balanced merges and a bounded stack size. A formal-methods analysis found an off-by-one in invariant maintenance that could overflow the preallocated stack on pathological run-length sequences, crashing. The fix enlarged the bound. Lesson: merge-scheduling invariants are subtle, must be proven, and need adversarial (not just random) testing.

### P7. How do automata/streaming connect to merge sort?
The merge primitive is a streaming `k`-way operator: it consumes `k` sorted streams and emits one sorted stream with `O(1)` state per stream plus an `O(log k)` heap. This composes into pipelines (sort-merge join in databases, MapReduce reduce phase), where the sortedness invariant is maintained across stages without materializing the whole dataset.

### P8 (analysis). Why can't a comparison sort beat `O(n log n)`, and how do radix/counting sorts escape it?
The decision-tree lower bound: distinguishing `n!` orderings needs tree height `≥ lg(n!) = Ω(n log n)` comparisons. Counting/radix/bucket sorts escape this by **not comparing** — they exploit key structure (integer ranges, digits) to place elements directly, achieving `O(n)` or `O(nk)` for restricted key domains, outside the comparison model.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose merge sort over a faster average-case sort.
Look for a concrete story: untrusted input or an SLA where quicksort's `O(n²)` worst case was unacceptable, or a multi-key sort needing stability, or a linked-list/external-data situation. Strong answers cite the guarantee/stability requirement, the measured impact, and the verification against a library sort.

### B2. A merge sort silently drops elements in production. How do you debug it?
Add the **multiset/permutation invariant**: output must contain the same elements with the same multiplicities as the input (cheap checksum/XOR before and after). The likely culprit is a missing leftover-drain (only one of the two tails copied) or a wrong merge range. is-sorted alone would not catch it — sorted-but-incomplete passes that check.

### B3. Design a feature to sort a feed of events that arrives faster than memory allows.
External/streaming merge sort: buffer events into RAM-sized sorted runs, spill to disk, and `k`-way merge on read. Discuss back-pressure, run sizing, pass count vs buffer budget, and stability (tag with arrival index). For continuous streams, maintain sorted runs and merge lazily on query.

### B4. How would you explain merge sort to a junior engineer?
Use the card analogy: split the deck in half, have helpers sort each half, then zipper the two sorted halves by repeatedly taking the smaller top card. Emphasize the two properties they will be asked about: it is **stable** (take the left card on ties) and **guaranteed `O(n log n)`** (no bad inputs). Lead with the merge step — it is the whole trick.

### B5. Your sort job uses too much memory at scale. How do you investigate?
Each `n`-element buffer is `O(n)` extra; check whether you allocate per merge (GC churn) instead of once. For objects, confirm you sort references, not copies. If the data genuinely exceeds RAM, switch to external merge sort. Profile allocations; the fix is usually buffer reuse plus, if needed, externalization.

---

## Coding Challenges

### Challenge 1: Stable Merge Sort

**Problem.** Implement a stable merge sort for an integer array. Return the sorted array. Equal elements must retain input order (verify with keyed records if asked).

**Example.**
```text
[5, 2, 4, 7, 1, 3, 2, 6]  ->  [1, 2, 2, 3, 4, 5, 6, 7]
```

**Constraints.** `0 ≤ n ≤ 10^6`.

**Approach.** Top-down recursion with one shared buffer; `<=` in the merge for stability.

**Go.**
```go
package main

import "fmt"

func merge(a []int, lo, mid, hi int, buf []int) {
	i, j, k := lo, mid, lo
	for i < mid && j < hi {
		if a[i] <= a[j] {
			buf[k] = a[i]
			i++
		} else {
			buf[k] = a[j]
			j++
		}
		k++
	}
	for i < mid {
		buf[k] = a[i]
		i++
		k++
	}
	for j < hi {
		buf[k] = a[j]
		j++
		k++
	}
	copy(a[lo:hi], buf[lo:hi])
}

func sortRec(a []int, lo, hi int, buf []int) {
	if hi-lo <= 1 {
		return
	}
	mid := lo + (hi-lo)/2
	sortRec(a, lo, mid, buf)
	sortRec(a, mid, hi, buf)
	merge(a, lo, mid, hi, buf)
}

func MergeSort(a []int) []int {
	if len(a) > 1 {
		sortRec(a, 0, len(a), make([]int, len(a)))
	}
	return a
}

func main() {
	fmt.Println(MergeSort([]int{5, 2, 4, 7, 1, 3, 2, 6})) // [1 2 2 3 4 5 6 7]
}
```

**Java.**
```java
import java.util.Arrays;

public class StableMergeSort {
    static void merge(int[] a, int lo, int mid, int hi, int[] buf) {
        int i = lo, j = mid, k = lo;
        while (i < mid && j < hi) buf[k++] = (a[i] <= a[j]) ? a[i++] : a[j++];
        while (i < mid) buf[k++] = a[i++];
        while (j < hi)  buf[k++] = a[j++];
        System.arraycopy(buf, lo, a, lo, hi - lo);
    }

    static void sortRec(int[] a, int lo, int hi, int[] buf) {
        if (hi - lo <= 1) return;
        int mid = lo + (hi - lo) / 2;
        sortRec(a, lo, mid, buf);
        sortRec(a, mid, hi, buf);
        merge(a, lo, mid, hi, buf);
    }

    public static int[] sort(int[] a) {
        if (a.length > 1) sortRec(a, 0, a.length, new int[a.length]);
        return a;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(sort(new int[]{5, 2, 4, 7, 1, 3, 2, 6})));
    }
}
```

**Python.**
```python
def merge_sort(a):
    if len(a) <= 1:
        return a
    buf = [0] * len(a)

    def rec(lo, hi):
        if hi - lo <= 1:
            return
        mid = lo + (hi - lo) // 2
        rec(lo, mid)
        rec(mid, hi)
        i, j, k = lo, mid, lo
        while i < mid and j < hi:
            if a[i] <= a[j]:
                buf[k] = a[i]; i += 1
            else:
                buf[k] = a[j]; j += 1
            k += 1
        while i < mid:
            buf[k] = a[i]; i += 1; k += 1
        while j < hi:
            buf[k] = a[j]; j += 1; k += 1
        a[lo:hi] = buf[lo:hi]

    rec(0, len(a))
    return a


if __name__ == "__main__":
    print(merge_sort([5, 2, 4, 7, 1, 3, 2, 6]))  # [1, 2, 2, 3, 4, 5, 6, 7]
```

---

### Challenge 2: Count Inversions

**Problem.** Given an array, count the number of inversions — pairs `(i, j)` with `i < j` and `a[i] > a[j]`. Use the merge step. Return the count.

**Example.**
```text
[2, 4, 1, 3, 5]  ->  3   (pairs: (2,1), (4,1), (4,3))
[5, 4, 3, 2, 1]  ->  10  (reverse-sorted → n(n-1)/2)
```

**Constraints.** `1 ≤ n ≤ 10^5`; use a 64-bit counter.

**Go.**
```go
package main

import "fmt"

func countInv(a []int, lo, hi int, buf []int) int64 {
	if hi-lo <= 1 {
		return 0
	}
	mid := lo + (hi-lo)/2
	inv := countInv(a, lo, mid, buf) + countInv(a, mid, hi, buf)
	i, j, k := lo, mid, lo
	for i < mid && j < hi {
		if a[i] <= a[j] {
			buf[k] = a[i]
			i++
		} else {
			inv += int64(mid - i) // a[j] < all remaining a[i:mid]
			buf[k] = a[j]
			j++
		}
		k++
	}
	for i < mid {
		buf[k] = a[i]
		i++
		k++
	}
	for j < hi {
		buf[k] = a[j]
		j++
		k++
	}
	copy(a[lo:hi], buf[lo:hi])
	return inv
}

func CountInversions(a []int) int64 {
	return countInv(a, 0, len(a), make([]int, len(a)))
}

func main() {
	fmt.Println(CountInversions([]int{2, 4, 1, 3, 5})) // 3
	fmt.Println(CountInversions([]int{5, 4, 3, 2, 1})) // 10
}
```

**Java.**
```java
public class CountInversions {
    static long countInv(int[] a, int lo, int hi, int[] buf) {
        if (hi - lo <= 1) return 0;
        int mid = lo + (hi - lo) / 2;
        long inv = countInv(a, lo, mid, buf) + countInv(a, mid, hi, buf);
        int i = lo, j = mid, k = lo;
        while (i < mid && j < hi) {
            if (a[i] <= a[j]) buf[k++] = a[i++];
            else { inv += mid - i; buf[k++] = a[j++]; }
        }
        while (i < mid) buf[k++] = a[i++];
        while (j < hi)  buf[k++] = a[j++];
        System.arraycopy(buf, lo, a, lo, hi - lo);
        return inv;
    }

    public static long count(int[] a) {
        return countInv(a, 0, a.length, new int[a.length]);
    }

    public static void main(String[] args) {
        System.out.println(count(new int[]{2, 4, 1, 3, 5})); // 3
        System.out.println(count(new int[]{5, 4, 3, 2, 1})); // 10
    }
}
```

**Python.**
```python
def count_inversions(a):
    buf = [0] * len(a)

    def rec(lo, hi):
        if hi - lo <= 1:
            return 0
        mid = lo + (hi - lo) // 2
        inv = rec(lo, mid) + rec(mid, hi)
        i, j, k = lo, mid, lo
        while i < mid and j < hi:
            if a[i] <= a[j]:
                buf[k] = a[i]; i += 1
            else:
                inv += mid - i            # a[j] < all remaining a[i:mid]
                buf[k] = a[j]; j += 1
            k += 1
        while i < mid:
            buf[k] = a[i]; i += 1; k += 1
        while j < hi:
            buf[k] = a[j]; j += 1; k += 1
        a[lo:hi] = buf[lo:hi]
        return inv

    return rec(0, len(a))


if __name__ == "__main__":
    print(count_inversions([2, 4, 1, 3, 5]))  # 3
    print(count_inversions([5, 4, 3, 2, 1]))  # 10
```

---

### Challenge 3: Sort a Linked List (O(1) extra space)

**Problem.** Sort a singly linked list in `O(n log n)` time using `O(1)` extra space (besides recursion). Return the new head. The sort must be stable.

**Approach.** Split with slow/fast pointers, recursively sort each half, merge by relinking nodes.

**Go.**
```go
package main

import "fmt"

type Node struct {
	Val  int
	Next *Node
}

func sortList(head *Node) *Node {
	if head == nil || head.Next == nil {
		return head
	}
	slow, fast := head, head.Next
	for fast != nil && fast.Next != nil {
		slow = slow.Next
		fast = fast.Next.Next
	}
	mid := slow.Next
	slow.Next = nil // cut
	return mergeLists(sortList(head), sortList(mid))
}

func mergeLists(a, b *Node) *Node {
	dummy := &Node{}
	tail := dummy
	for a != nil && b != nil {
		if a.Val <= b.Val { // "<=" → stable
			tail.Next = a
			a = a.Next
		} else {
			tail.Next = b
			b = b.Next
		}
		tail = tail.Next
	}
	if a != nil {
		tail.Next = a
	} else {
		tail.Next = b
	}
	return dummy.Next
}

func build(vals []int) *Node {
	dummy := &Node{}
	t := dummy
	for _, v := range vals {
		t.Next = &Node{Val: v}
		t = t.Next
	}
	return dummy.Next
}

func main() {
	h := sortList(build([]int{5, 2, 4, 7, 1, 3, 2, 6}))
	for n := h; n != nil; n = n.Next {
		fmt.Print(n.Val, " ")
	}
	fmt.Println() // 1 2 2 3 4 5 6 7
}
```

**Java.**
```java
public class SortLinkedList {
    static class Node {
        int val; Node next;
        Node(int v) { val = v; }
    }

    static Node sortList(Node head) {
        if (head == null || head.next == null) return head;
        Node slow = head, fast = head.next;
        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
        }
        Node mid = slow.next;
        slow.next = null;                  // cut
        return merge(sortList(head), sortList(mid));
    }

    static Node merge(Node a, Node b) {
        Node dummy = new Node(0), tail = dummy;
        while (a != null && b != null) {
            if (a.val <= b.val) { tail.next = a; a = a.next; }
            else                { tail.next = b; b = b.next; }
            tail = tail.next;
        }
        tail.next = (a != null) ? a : b;
        return dummy.next;
    }

    static Node build(int[] vals) {
        Node dummy = new Node(0), t = dummy;
        for (int v : vals) { t.next = new Node(v); t = t.next; }
        return dummy.next;
    }

    public static void main(String[] args) {
        Node h = sortList(build(new int[]{5, 2, 4, 7, 1, 3, 2, 6}));
        StringBuilder sb = new StringBuilder();
        for (Node n = h; n != null; n = n.next) sb.append(n.val).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

**Python.**
```python
class Node:
    def __init__(self, val, nxt=None):
        self.val = val
        self.next = nxt


def sort_list(head):
    if head is None or head.next is None:
        return head
    slow, fast = head, head.next
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
    mid = slow.next
    slow.next = None                       # cut
    return _merge(sort_list(head), sort_list(mid))


def _merge(a, b):
    dummy = Node(0)
    tail = dummy
    while a and b:
        if a.val <= b.val:                 # "<=" → stable
            tail.next = a; a = a.next
        else:
            tail.next = b; b = b.next
        tail = tail.next
    tail.next = a if a else b
    return dummy.next


def build(vals):
    dummy = Node(0)
    t = dummy
    for v in vals:
        t.next = Node(v); t = t.next
    return dummy.next


if __name__ == "__main__":
    h = sort_list(build([5, 2, 4, 7, 1, 3, 2, 6]))
    out = []
    while h:
        out.append(h.val); h = h.next
    print(out)  # [1, 2, 2, 3, 4, 5, 6, 7]
```

---

### Challenge 4: K-Way Merge of Sorted Lists

**Problem.** Merge `k` sorted lists into one sorted list using a min-heap (the merge phase of external sort). Return the merged list.

**Approach.** Push the head of each list into a min-heap; repeatedly pop the minimum and push the next element from the same list. `O(N log k)` where `N` is the total element count.

**Python.**
```python
import heapq


def merge_k_sorted(lists):
    heap = []
    for r, lst in enumerate(lists):
        if lst:
            heapq.heappush(heap, (lst[0], r, 0))   # (value, list_id, index)
    out = []
    while heap:
        val, r, idx = heapq.heappop(heap)
        out.append(val)
        if idx + 1 < len(lists[r]):
            heapq.heappush(heap, (lists[r][idx + 1], r, idx + 1))
    return out


if __name__ == "__main__":
    print(merge_k_sorted([[1, 4, 7], [2, 5, 8], [3, 6, 9]]))
    # [1, 2, 3, 4, 5, 6, 7, 8, 9]
```

**Go.**
```go
package main

import (
	"container/heap"
	"fmt"
)

type item struct{ val, list, idx int }
type pq []item

func (p pq) Len() int            { return len(p) }
func (p pq) Less(a, b int) bool  { return p[a].val < p[b].val }
func (p pq) Swap(a, b int)       { p[a], p[b] = p[b], p[a] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(item)) }
func (p *pq) Pop() interface{}   { o := *p; n := len(o); x := o[n-1]; *p = o[:n-1]; return x }

func mergeKSorted(lists [][]int) []int {
	h := &pq{}
	for r, l := range lists {
		if len(l) > 0 {
			*h = append(*h, item{l[0], r, 0})
		}
	}
	heap.Init(h)
	out := []int{}
	for h.Len() > 0 {
		it := heap.Pop(h).(item)
		out = append(out, it.val)
		if it.idx+1 < len(lists[it.list]) {
			heap.Push(h, item{lists[it.list][it.idx+1], it.list, it.idx + 1})
		}
	}
	return out
}

func main() {
	fmt.Println(mergeKSorted([][]int{{1, 4, 7}, {2, 5, 8}, {3, 6, 9}}))
}
```

**Java.**
```java
import java.util.*;

public class MergeKSorted {
    public static List<Integer> merge(int[][] lists) {
        // {value, listId, index}
        PriorityQueue<int[]> pq = new PriorityQueue<>((x, y) -> Integer.compare(x[0], y[0]));
        for (int r = 0; r < lists.length; r++)
            if (lists[r].length > 0) pq.add(new int[]{lists[r][0], r, 0});
        List<Integer> out = new ArrayList<>();
        while (!pq.isEmpty()) {
            int[] it = pq.poll();
            out.add(it[0]);
            if (it[2] + 1 < lists[it[1]].length)
                pq.add(new int[]{lists[it[1]][it[2] + 1], it[1], it[2] + 1});
        }
        return out;
    }

    public static void main(String[] args) {
        System.out.println(merge(new int[][]{{1, 4, 7}, {2, 5, 8}, {3, 6, 9}}));
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Split in half, recursively sort each half, merge in linear time — `T(n) = 2T(n/2) + O(n) = O(n log n)`, guaranteed and stable."*
- Immediately flag the two signature properties: **stable** (take left on ties) and **`O(n)` extra space** (for arrays).
- If asked to count inversions or merge `k` lists, reach for the **merge step** — it is the reusable core.
- For linked lists, mention **`O(1)` extra space** via relinking; for huge data, mention **external merge sort**.
- Always offer to verify with the **is-sorted + multiset** invariant pair on random inputs.
