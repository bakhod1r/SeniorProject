# Quicksort (Divide and Conquer by Partitioning) — Interview Preparation

Quicksort is a perennial interview favourite because it rewards a single crisp insight — *"partition around a pivot, recurse on both sides, no merge"* — and then probes whether you can (a) implement the partition correctly (Lomuto or Hoare), (b) reason about average `O(n log n)` vs worst `O(n²)` and how to avoid the latter, (c) recognize the same partition behind quickselect, three-way (Dutch flag), and introsort, and (d) avoid the classic traps of the sorted-input worst case, the all-equal pathology, and accidental reliance on stability. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Answer | Complexity |
|----------|--------|------------|
| Sort an array in place, average fast | Quicksort (randomized pivot) | avg `O(n log n)`, worst `O(n²)` |
| Worst-case `O(n log n)` guaranteed | Introsort (quicksort + heapsort guard) | `O(n log n)` |
| k-th smallest element | Quickselect | expected `O(n)`, worst `O(n²)` |
| k-th smallest, worst-case linear | Median-of-medians (BFPRT) | `O(n)` worst |
| Many duplicate keys | Three-way (Dutch National Flag) partition | `O(n log d)`, `d` = distinct |
| Need stability | Merge sort / TimSort, **not** quicksort | `O(n log n)` |
| Bound stack depth | Recurse small side, loop large side | `O(log n)` stack |

Partition schemes:

```text
scheme   pivot      pointers          returns            equal keys
Lomuto   last       i (boundary) + j  pivot final index  all to one side (O(n^2) on all-equal)
Hoare    first      i, j inward       split point        split across both sides (graceful)
3-way    any        lt, i, gt         (lt, gt) range     isolated, never re-touched
```

Core algorithm:

```text
quicksort(a, lo, hi):
    if lo >= hi: return
    swap random index in [lo,hi] to hi      # randomize pivot
    p = partition(a, lo, hi)                 # Lomuto, pivot a[hi]
    quicksort(a, lo, p-1)
    quicksort(a, p+1, hi)
# average O(n log n), worst O(n^2), in place, NOT stable
```

Key facts:
- **No merge step** — the pivot lands between the two sides, both sorted in place.
- **Pivot quality is everything**: random / median-of-three avoids the `O(n²)` sorted-input trap.
- **Not stable**; equal elements may be reordered.
- **Quickselect** drops one of the two recursions → expected `O(n)`.

---

## Junior Questions (12 Q&A)

### J1. What is the core idea of quicksort?
Pick a **pivot**, **partition** the array so everything `≤ pivot` is on the left and everything `> pivot` is on the right (the pivot lands in its final sorted position), then recursively sort the two sides. It is divide-and-conquer where all the work is in the *divide* (partition) — there is **no merge step**.

### J2. What does the partition step do?
It rearranges a subarray around the pivot and returns the pivot's final index. After partitioning, the pivot is in its correct sorted slot, everything left is `≤` it, everything right is `>` it. It runs in `O(n)` with one linear scan.

### J3. What is the time complexity of quicksort?
Average and best case `O(n log n)`; worst case `O(n²)`. The worst case happens when the pivot is consistently the smallest or largest element, producing maximally unbalanced splits.

### J4. When does the `O(n²)` worst case happen?
When the splits are always unbalanced — classically, a fixed first/last pivot on an **already-sorted or reverse-sorted** array, where each pivot is the extreme element and the partition peels off only one element per level.

### J5. How do you avoid the worst case?
Choose the pivot **randomly** or by **median-of-three** (median of first, middle, last). This makes the bad splits depend on randomness, not on the input order, so an adversary or sorted input can no longer force `O(n²)`.

### J6. Is quicksort stable?
No. The swaps during partitioning can reorder elements that compare equal. If you need stability, use merge sort.

### J7. Is quicksort in place? How much extra memory?
Yes, it sorts within the original array using only `O(log n)` extra memory for the recursion stack (with balanced splits). It needs no second array, unlike merge sort which needs `O(n)`.

### J8. What is the base case of the recursion?
A subarray of 0 or 1 elements is already sorted, so `if lo >= hi: return`. Getting this wrong (e.g. `lo > hi` only, or recursing on the pivot index) can cause infinite recursion.

### J9. What is the pivot, and how is it chosen?
The pivot is the reference element you partition around. Common choices: first, last, random, or median-of-three. Random or median-of-three are preferred to avoid the sorted-input trap.

### J10. After partitioning, why don't you re-sort the pivot?
The pivot is already in its final sorted position — everything left is `≤` it and everything right is `>` it. So you recurse on `lo..p-1` and `p+1..hi`, *excluding* the pivot at `p`.

### J11. How does quicksort compare to merge sort at a glance?
Both are `O(n log n)` on average. Quicksort is in place (`O(log n)` space), not stable, with `O(n²)` worst case. Merge sort is stable, guaranteed `O(n log n)`, but needs `O(n)` extra space.

### J12 (analysis). Why is there no merge step in quicksort?
Because the partition places the pivot between the two sides with the ordering guarantee `left ≤ pivot ≤ right`. Once both sides are sorted in place, the whole range is sorted — there is nothing to combine. Merge sort, by contrast, splits trivially and does its work combining.

---

## Middle Questions (12 Q&A)

### M1. Explain Lomuto vs Hoare partition.
**Lomuto:** one boundary index `i` plus a scan `j`, pivot at the end, returns the pivot's final index, more swaps, sends equal keys to one side (`O(n²)` on all-equal). **Hoare:** two pointers moving inward, pivot at the start, returns a split point (not the pivot's index), ~3× fewer swaps, splits equal keys across both sides (graceful on all-equal). Hoare is the original 1961 scheme and underlies most libraries.

### M2. Why does Hoare handle duplicates better than Lomuto?
Hoare's two pointers stop on `a[i] ≥ pivot` and `a[j] ≤ pivot`, so equal elements get distributed across both sides, keeping the split balanced. Lomuto's `a[j] ≤ pivot` test sends *all* equal elements to the left, so an all-equal array splits into `0` and `n-1` — `O(n²)`.

### M3. What are the recursion bounds for Hoare vs Lomuto?
Lomuto returns the pivot index `p`; recurse on `(lo, p-1)` and `(p+1, hi)`. Hoare returns a split point `q`; recurse on `(lo, q)` and `(q+1, hi)` — note `q`, **not** `q-1`, because the pivot may not be at `q`. Mixing these up is the #1 Hoare bug.

### M4. How does three-way partitioning work and when do you use it?
The Dutch National Flag scheme partitions into `< pivot`, `== pivot`, `> pivot` in one pass using three pointers `lt, i, gt`. You recurse only on the `<` and `>` regions; equal keys are placed once and never touched again. Use it when the array has **many duplicate keys** — it turns the all-equal `O(n²)` case into `O(n)`.

### M5. Explain the three-way partition pointer logic.
Maintain `[lo..lt-1] < v`, `[lt..i-1] == v`, `[i..gt]` unknown, `[gt+1..hi] > v`. If `a[i] < v`: swap to the `<` region, advance `lt` and `i`. If `a[i] > v`: swap to the `>` region, decrement `gt`, **do not advance `i`** (the swapped-in element is unscanned). If `a[i] == v`: advance `i`.

### M6. What is quickselect and why is it `O(n)`?
Quickselect finds the k-th smallest element using the same partition, but recurses into **only one** side (the one containing rank `k`). Quicksort recurses into both (`T(n)=2T(n/2)+O(n)=O(n log n)`); quickselect recurses into one (`T(n)=T(n/2)+O(n)=O(n)`), because the partition costs form a geometric series `n + n/2 + n/4 + … = 2n`.

### M7. What is median-of-three and what does it buy you?
Pick the median of `a[lo]`, `a[mid]`, `a[hi]` as the pivot. It is nearly free (3 comparisons), eliminates the `O(n²)` trap on sorted/reverse-sorted input, and as a bonus the three sentinels can be skipped in the partition. It still has rare adversarial bad cases (the "median-of-three killer").

### M8. How do you bound the recursion stack depth?
Recurse into the **smaller** partition and loop (iterate) on the larger one (tail-call elimination). Since each recursive call handles at most half the elements, the depth is `O(log n)` even on bad splits — preventing stack overflow on large arrays.

### M9. Why is a constant-fraction split still `O(n log n)`?
A 90:10 split at every level still shrinks the problem geometrically: depth `log_{10/9} n`, which is `O(log n)`. With `O(n)` work per level, the total is `O(n log n)`. Quicksort only fails when splits are near-extreme *every* time; it does not need perfect halving.

### M10. What is median-of-medians and when is it used?
The BFPRT algorithm picks a provably good pivot in `O(n)` (median of group-of-5 medians), guaranteeing quickselect runs in **worst-case `O(n)`**. Its constant is large, so it is used as a *guard* (introselect), not the primary path; randomized quickselect (expected `O(n)`, small constant) is faster in practice.

### M11. Compare quicksort to heapsort.
Both `O(n log n)` average. Quicksort has a smaller constant and better cache behavior (sequential scan) but `O(n²)` worst case. Heapsort guarantees `O(n log n)` and uses `O(1)` space but jumps around memory (poor cache). Heapsort is the worst-case fallback inside introsort.

### M12 (analysis). What is the average comparison count, exactly?
Randomized quicksort makes `2(n+1)H_n - 4n ≈ 1.386 n log₂ n` comparisons on average, where `H_n` is the harmonic number. That is about 39% above the information-theoretic minimum `n log₂ n`, but the small per-comparison constant makes it fast in wall-clock time.

---

## Senior Questions (10 Q&A)

### S1. What is introsort and why does it exist?
Introsort runs quicksort but monitors recursion depth; if depth exceeds `2⌊log₂ n⌋` (a sign of bad pivots), it switches that subarray to **heapsort** for a guaranteed `O(n log n)`, and uses insertion sort for small ranges. It exists because the C++ standard mandates `O(n log n)` worst case, which plain quicksort cannot provide. `std::sort` is introsort.

### S2. How is quicksort a security concern?
A deterministic pivot lets an attacker craft a "killer" input (McIlroy 1999) forcing `O(n²)`, a CPU-exhaustion denial of service. Defenses: **randomized pivot** (makes targeting infeasible) plus the **introsort depth guard** (bounds damage to `O(n log n)` regardless).

### S3. How does randomization defeat adversarial inputs?
The expected `O(n log n)` is over the algorithm's internal coin flips, not over inputs, so it holds for *every* input including adversarial ones. An attacker who knows your code still cannot predict the random pivots, so cannot force bad splits — *provided the RNG seed is unpredictable* (otherwise they replay it).

### S4. What is dual-pivot quicksort?
Yaroslavskiy's scheme (used by Java's `Arrays.sort` for primitives) partitions around **two** pivots `p1 ≤ p2` into three regions. It does fewer comparisons and cache misses on many real inputs. It is not stable, which is fine for primitives where equal elements are indistinguishable.

### S5. What is pattern-defeating quicksort (pdqsort)?
The Rust/Go unstable sort. It combines median-of-three/ninther pivots, an introsort depth guard, detection of highly-unbalanced splits (reacting by shuffling to break patterns), already-sorted-run detection for near-`O(n)` on sorted input, and **block (branchless) partitioning** for speed. It is the current state of the art for unstable in-place sorting.

### S6. How do you make the partition fast on modern hardware?
The `if a[j] <= pivot` branch is data-dependent and mispredicted ~half the time on random data, flushing the pipeline. **Block / branchless partitioning** (BlockQuicksort) replaces the branch with arithmetic that records offsets into a buffer, then does swaps in a tight loop — roughly doubling throughput. Sequential scanning is already cache-friendly.

### S7. How do you implement worst-case `O(n)` selection?
Introselect: randomized quickselect for the common path, with a **median-of-medians** fallback when recursion goes too deep, guaranteeing `O(n)`. `std::nth_element` is introselect. Median-of-medians uses groups of 5 and the recurrence `T(n) ≤ T(n/5) + T(7n/10) + O(n)`, which is linear because `1/5 + 7/10 < 1`.

### S8. When should you NOT use quicksort?
When you need stability (use merge/TimSort), a hard worst-case `O(n log n)` with `O(1)` space (use heapsort), to sort linked lists or external data (merge sort fits), or when input is untrusted and you have no depth guard (use introsort). Also for top-k streaming, a bounded heap beats a full sort.

### S9. How do you choose between quickselect and a heap for top-k?
Heap (`O(n log k)`) for **streaming**, **small k**, or **immutable input** — it holds only `k` elements and does not mutate the array. Quickselect (expected `O(n)`) for **in-memory**, **large k**, **mutation allowed** — it partitions the array around rank `k`.

### S10 (analysis). Why does quickselect's expected time form a geometric series?
A random pivot leaves, on average, a constant fraction in the side we recurse into (expected size `≤ 3n/4`). The partition costs are `n + (3/4)n + (9/16)n + … = n · 1/(1-3/4) = 4n`, a convergent geometric series → `O(n)`. Quicksort instead pays `n` at each of `log n` levels (both sides) → `O(n log n)`. Dropping one recursion collapses the log factor.

---

## Professional Questions (8 Q&A)

### P1. Walk through the randomized-quicksort expected-comparison proof.
Number elements by sorted rank `z_1 < … < z_n`. `z_i` and `z_j` are compared iff the first pivot chosen from `Z_{ij} = {z_i,…,z_j}` is `z_i` or `z_j` (probability `2/(j-i+1)`, since the first pivot is uniform over the `j-i+1` elements). Summing indicators: `E[T] = Σ_{i<j} 2/(j-i+1) = 2(n+1)H_n - 4n ≈ 1.386 n log₂ n`. The expectation is over coin flips, so it holds for every input.

### P2. Prove the worst case is `Θ(n²)`.
The recurrence is `T(n) = T(i) + T(n-1-i) + (n-1)`. The work-maximizing split is the extreme one (`i ∈ {0, n-1}`) because `i² + (n-1-i)²` is convex, maximized at endpoints. That gives `T(n) = T(n-1) + (n-1)`, unrolling to `Σ m = n(n-1)/2 = Θ(n²)`. A fixed last-element pivot achieves it on sorted input.

### P3. Why is groups-of-5 the right choice in median-of-medians?
The pivot guarantees discarding `≥ 3n/10` elements, so we recurse on `≤ 7n/10`, plus `n/5` to find the median of medians: `T(n) ≤ T(n/5) + T(7n/10) + O(n)`. Since `1/5 + 7/10 = 9/10 < 1`, this solves to `O(n)`. Groups of 3 give `1/3 + 2/3 = 1`, which is *not* linear; 5 is the smallest group size that works.

### P4. State and justify the comparison-sort lower bound.
Any comparison sort is a binary decision tree with `≥ n!` leaves (one per permutation), so height `≥ log₂(n!) = Θ(n log n)` by Stirling. Hence `Ω(n log n)` comparisons in the worst case. Randomized quicksort's `1.386 n log₂ n` is within a constant factor — asymptotically optimal. Only non-comparison sorts (radix, counting) beat it, by exploiting key structure.

### P5. How does three-way quicksort achieve `O(n log d)` for `d` distinct keys?
Each three-way partition isolates *all* elements equal to the pivot and never re-touches them, so each distinct value becomes a pivot at most once along any root-to-leaf path. The recursion depth is bounded by `O(log d)` (you can only split into new distinct-value groups), giving `O(n log d)` — the entropy-optimal bound for sorting a multiset.

### P6. Why is quicksort not stable, and how would you make it stable?
In-place partitioning swaps non-adjacent equal elements, inverting their original order. To make it stable, tag each element with its original index and break comparison ties by that index — but this costs `O(n)` extra space, eliminating the in-place advantage. In practice, if stability is required, use a merge-based stable sort instead.

### P7. Prove the stack space is `O(log n)` with small-side-first recursion.
Each recursive call handles the smaller partition, of size `< size/2`. So along any recursion chain the size at least halves each step, bounding depth by `⌊log₂ n⌋`. The larger side is handled by the enclosing loop (no new frame). Hence `O(log n)` stack regardless of pivot quality — decoupling stack depth from the `O(n²)` time risk.

### P8 (analysis). How concentrated is randomized quicksort around its mean?
Tightly. The comparison count has mean `Θ(n log n)` and standard deviation `Θ(n)`, so the spread is small relative to the mean. Moreover `Pr[T > c n log n] ≤ n^{-d}` (high-probability bound via Chernoff on the count of "good" pivots in each recursion chain). The `O(n²)` case is super-polynomially unlikely — the theoretical license for using it in production.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you fixed a performance problem caused by a bad algorithm choice.
Look for a concrete story: a sort or selection that blew up (e.g. `O(n²)` on sorted input, or all-equal keys), a profile pinpointing it, the fix (randomize pivot, three-way partition, or switch to introsort/heap), and the measured improvement. Strong answers mention verifying correctness against a built-in sort and adding a regression test on the pathological input.

### B2. A teammate's sort is occasionally very slow in production. How do you investigate?
Hypothesize the `O(n²)` quicksort pathology. Check the pivot rule (fixed first/last?), the input shape (sorted? all-equal? few-distinct?), and whether there is a depth guard. Add comparison-count and recursion-depth metrics; an `n²` spike confirms it. Fix with randomization + introsort guard (for the worst case) and three-way partition (for duplicates).

### B3. Design a service to compute the median (or p99 latency) of a large in-memory dataset.
This is quickselect (expected `O(n)`), or introselect for a worst-case guarantee. Discuss: mutating vs copying the array, handling untrusted input (randomized/seeded pivot to resist DoS), and the streaming alternative (a heap or a sketch like t-digest if data does not fit in memory). For percentiles, partition around the rank.

### B4. How would you explain quicksort to a junior engineer?
Lead with the mail-sorting analogy: pick a reference letter (pivot), split the pile into "before" and "after" in one pass, then apply the same rule to each pile. Emphasize the two gotchas first: it is **not stable**, and a **bad pivot on sorted input is `O(n²)`** — so always randomize or use median-of-three. Good mentoring leads with the pitfalls.

### B5. Your sort runs on user-supplied data and comparators. What are the risks?
Two: (1) an adversary crafting a killer input to force `O(n²)` — mitigate with randomization + introsort depth guard; (2) an inconsistent comparator (violating strict-weak-ordering) driving an optimized partition out of bounds — mitigate with bounds-safe partition loops or comparator validation (Java throws `IllegalArgumentException` for this).

---

## Coding Challenges

### Challenge 1: In-Place Quicksort (randomized, Lomuto)

**Problem.** Sort an integer array in place using quicksort with a randomized pivot. Must be `O(n log n)` expected and not allocate a second array.

**Example.**
```text
[3,7,8,5,2,1,9,5,4] -> [1,2,3,4,5,5,7,8,9]
[] -> []   ;   [1] -> [1]   ;   [2,2,2] -> [2,2,2]
```

**Constraints.** `0 ≤ n ≤ 10^6`, values fit in 32-bit.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
)

func partition(a []int, lo, hi int) int {
	pivot := a[hi]
	i := lo - 1
	for j := lo; j < hi; j++ {
		if a[j] <= pivot {
			i++
			a[i], a[j] = a[j], a[i]
		}
	}
	a[i+1], a[hi] = a[hi], a[i+1]
	return i + 1
}

func quicksort(a []int, lo, hi int) {
	for lo < hi { // tail-call elimination on the larger side
		r := lo + rand.Intn(hi-lo+1)
		a[r], a[hi] = a[hi], a[r]
		p := partition(a, lo, hi)
		if p-lo < hi-p {
			quicksort(a, lo, p-1)
			lo = p + 1
		} else {
			quicksort(a, p+1, hi)
			hi = p - 1
		}
	}
}

func Sort(a []int) { quicksort(a, 0, len(a)-1) }

func main() {
	a := []int{3, 7, 8, 5, 2, 1, 9, 5, 4}
	Sort(a)
	fmt.Println(a)
}
```

**Java.**
```java
import java.util.Random;

public class InPlaceQuicksort {
    static final Random rng = new Random();

    static int partition(int[] a, int lo, int hi) {
        int pivot = a[hi], i = lo - 1;
        for (int j = lo; j < hi; j++)
            if (a[j] <= pivot) { i++; int t = a[i]; a[i] = a[j]; a[j] = t; }
        int t = a[i + 1]; a[i + 1] = a[hi]; a[hi] = t;
        return i + 1;
    }

    static void quicksort(int[] a, int lo, int hi) {
        while (lo < hi) {
            int r = lo + rng.nextInt(hi - lo + 1);
            int t = a[r]; a[r] = a[hi]; a[hi] = t;
            int p = partition(a, lo, hi);
            if (p - lo < hi - p) { quicksort(a, lo, p - 1); lo = p + 1; }
            else { quicksort(a, p + 1, hi); hi = p - 1; }
        }
    }

    public static void sort(int[] a) { quicksort(a, 0, a.length - 1); }

    public static void main(String[] args) {
        int[] a = {3, 7, 8, 5, 2, 1, 9, 5, 4};
        sort(a);
        System.out.println(java.util.Arrays.toString(a));
    }
}
```

**Python.**
```python
import random
import sys

sys.setrecursionlimit(1_000_000)


def partition(a, lo, hi):
    pivot = a[hi]
    i = lo - 1
    for j in range(lo, hi):
        if a[j] <= pivot:
            i += 1
            a[i], a[j] = a[j], a[i]
    a[i + 1], a[hi] = a[hi], a[i + 1]
    return i + 1


def quicksort(a, lo, hi):
    while lo < hi:                       # loop the larger side
        r = random.randint(lo, hi)
        a[r], a[hi] = a[hi], a[r]
        p = partition(a, lo, hi)
        if p - lo < hi - p:
            quicksort(a, lo, p - 1)
            lo = p + 1
        else:
            quicksort(a, p + 1, hi)
            hi = p - 1


def sort(a):
    quicksort(a, 0, len(a) - 1)


if __name__ == "__main__":
    a = [3, 7, 8, 5, 2, 1, 9, 5, 4]
    sort(a)
    print(a)
```

---

### Challenge 2: Quickselect — k-th Smallest Element

**Problem.** Return the k-th smallest element (1-indexed) of an unsorted array in expected `O(n)` without fully sorting.

**Example.**
```text
[7,2,9,4,1,8,3], k=3 -> 3   (sorted: 1,2,3,4,7,8,9)
[7,2,9,4,1,8,3], k=1 -> 1
```

**Constraints.** `1 ≤ k ≤ n ≤ 10^6`.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
)

func kthSmallest(a []int, k int) int { // k is 1-indexed
	target := k - 1
	lo, hi := 0, len(a)-1
	for lo < hi {
		r := lo + rand.Intn(hi-lo+1)
		a[r], a[hi] = a[hi], a[r]
		pivot := a[hi]
		i := lo - 1
		for j := lo; j < hi; j++ {
			if a[j] <= pivot {
				i++
				a[i], a[j] = a[j], a[i]
			}
		}
		i++
		a[i], a[hi] = a[hi], a[i]
		if target == i {
			return a[i]
		} else if target < i {
			hi = i - 1
		} else {
			lo = i + 1
		}
	}
	return a[lo]
}

func main() {
	fmt.Println(kthSmallest([]int{7, 2, 9, 4, 1, 8, 3}, 3)) // 3
}
```

**Java.**
```java
import java.util.Random;

public class KthSmallest {
    static final Random rng = new Random();

    static int kthSmallest(int[] a, int k) { // 1-indexed
        int target = k - 1, lo = 0, hi = a.length - 1;
        while (lo < hi) {
            int r = lo + rng.nextInt(hi - lo + 1);
            int t = a[r]; a[r] = a[hi]; a[hi] = t;
            int pivot = a[hi], i = lo - 1;
            for (int j = lo; j < hi; j++)
                if (a[j] <= pivot) { i++; int s = a[i]; a[i] = a[j]; a[j] = s; }
            i++;
            int s = a[i]; a[i] = a[hi]; a[hi] = s;
            if (target == i) return a[i];
            else if (target < i) hi = i - 1;
            else lo = i + 1;
        }
        return a[lo];
    }

    public static void main(String[] args) {
        System.out.println(kthSmallest(new int[]{7, 2, 9, 4, 1, 8, 3}, 3)); // 3
    }
}
```

**Python.**
```python
import random


def kth_smallest(a, k):  # 1-indexed
    target = k - 1
    lo, hi = 0, len(a) - 1
    while lo < hi:
        r = random.randint(lo, hi)
        a[r], a[hi] = a[hi], a[r]
        pivot = a[hi]
        i = lo - 1
        for j in range(lo, hi):
            if a[j] <= pivot:
                i += 1
                a[i], a[j] = a[j], a[i]
        i += 1
        a[i], a[hi] = a[hi], a[i]
        if target == i:
            return a[i]
        elif target < i:
            hi = i - 1
        else:
            lo = i + 1
    return a[lo]


if __name__ == "__main__":
    print(kth_smallest([7, 2, 9, 4, 1, 8, 3], 3))  # 3
```

---

### Challenge 3: Sort Colors (Three-Way / Dutch National Flag)

**Problem.** Given an array containing only `0`, `1`, `2` (red/white/blue), sort it in place in a single pass using `O(1)` extra space. (LeetCode 75.) This is one partition of three-way quicksort with pivot `1`.

**Example.**
```text
[2,0,2,1,1,0] -> [0,0,1,1,2,2]
```

**Constraints.** `1 ≤ n ≤ 3·10^5`, values in `{0,1,2}`.

**Go.**
```go
package main

import "fmt"

func sortColors(a []int) {
	lt, i, gt := 0, 0, len(a)-1
	for i <= gt {
		switch {
		case a[i] < 1:
			a[lt], a[i] = a[i], a[lt]
			lt++
			i++
		case a[i] > 1:
			a[i], a[gt] = a[gt], a[i]
			gt--
		default:
			i++
		}
	}
}

func main() {
	a := []int{2, 0, 2, 1, 1, 0}
	sortColors(a)
	fmt.Println(a) // [0 0 1 1 2 2]
}
```

**Java.**
```java
public class SortColors {
    static void sortColors(int[] a) {
        int lt = 0, i = 0, gt = a.length - 1;
        while (i <= gt) {
            if (a[i] < 1) { int t = a[lt]; a[lt] = a[i]; a[i] = t; lt++; i++; }
            else if (a[i] > 1) { int t = a[i]; a[i] = a[gt]; a[gt] = t; gt--; }
            else i++;
        }
    }

    public static void main(String[] args) {
        int[] a = {2, 0, 2, 1, 1, 0};
        sortColors(a);
        System.out.println(java.util.Arrays.toString(a)); // [0, 0, 1, 1, 2, 2]
    }
}
```

**Python.**
```python
def sort_colors(a):
    lt, i, gt = 0, 0, len(a) - 1
    while i <= gt:
        if a[i] < 1:
            a[lt], a[i] = a[i], a[lt]
            lt += 1
            i += 1
        elif a[i] > 1:
            a[i], a[gt] = a[gt], a[i]
            gt -= 1
        else:
            i += 1


if __name__ == "__main__":
    a = [2, 0, 2, 1, 1, 0]
    sort_colors(a)
    print(a)  # [0, 0, 1, 1, 2, 2]
```

---

### Challenge 4: Kth Largest Element (quickselect variant + heap alternative)

**Problem.** Return the k-th **largest** element in an array. (LeetCode 215.) Give the quickselect solution (expected `O(n)`) and note when a heap is preferable.

**Approach.** The k-th largest is the `(n - k)`-th smallest (0-indexed). Run quickselect for that rank. For a *streaming* or small-`k` setting, a bounded min-heap of size `k` (`O(n log k)`) is preferable because it does not need all data in memory and does not mutate the input.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
)

func findKthLargest(a []int, k int) int {
	target := len(a) - k // 0-indexed rank of the k-th largest
	lo, hi := 0, len(a)-1
	for lo < hi {
		r := lo + rand.Intn(hi-lo+1)
		a[r], a[hi] = a[hi], a[r]
		pivot := a[hi]
		i := lo - 1
		for j := lo; j < hi; j++ {
			if a[j] <= pivot {
				i++
				a[i], a[j] = a[j], a[i]
			}
		}
		i++
		a[i], a[hi] = a[hi], a[i]
		if target == i {
			return a[i]
		} else if target < i {
			hi = i - 1
		} else {
			lo = i + 1
		}
	}
	return a[lo]
}

func main() {
	fmt.Println(findKthLargest([]int{3, 2, 1, 5, 6, 4}, 2)) // 5
}
```

**Java.**
```java
import java.util.PriorityQueue;
import java.util.Random;

public class KthLargest {
    static final Random rng = new Random();

    // Quickselect: expected O(n)
    static int findKthLargest(int[] a, int k) {
        int target = a.length - k, lo = 0, hi = a.length - 1;
        while (lo < hi) {
            int r = lo + rng.nextInt(hi - lo + 1);
            int t = a[r]; a[r] = a[hi]; a[hi] = t;
            int pivot = a[hi], i = lo - 1;
            for (int j = lo; j < hi; j++)
                if (a[j] <= pivot) { i++; int s = a[i]; a[i] = a[j]; a[j] = s; }
            i++;
            int s = a[i]; a[i] = a[hi]; a[hi] = s;
            if (target == i) return a[i];
            else if (target < i) hi = i - 1;
            else lo = i + 1;
        }
        return a[lo];
    }

    // Heap alternative: O(n log k), good for streaming / small k
    static int findKthLargestHeap(int[] a, int k) {
        PriorityQueue<Integer> minHeap = new PriorityQueue<>();
        for (int x : a) {
            minHeap.offer(x);
            if (minHeap.size() > k) minHeap.poll();
        }
        return minHeap.peek();
    }

    public static void main(String[] args) {
        System.out.println(findKthLargest(new int[]{3, 2, 1, 5, 6, 4}, 2));     // 5
        System.out.println(findKthLargestHeap(new int[]{3, 2, 1, 5, 6, 4}, 2)); // 5
    }
}
```

**Python.**
```python
import heapq
import random


def find_kth_largest(a, k):           # quickselect, expected O(n)
    target = len(a) - k
    lo, hi = 0, len(a) - 1
    while lo < hi:
        r = random.randint(lo, hi)
        a[r], a[hi] = a[hi], a[r]
        pivot = a[hi]
        i = lo - 1
        for j in range(lo, hi):
            if a[j] <= pivot:
                i += 1
                a[i], a[j] = a[j], a[i]
        i += 1
        a[i], a[hi] = a[hi], a[i]
        if target == i:
            return a[i]
        elif target < i:
            hi = i - 1
        else:
            lo = i + 1
    return a[lo]


def find_kth_largest_heap(a, k):       # O(n log k), streaming-friendly
    return heapq.nlargest(k, a)[-1]


if __name__ == "__main__":
    print(find_kth_largest([3, 2, 1, 5, 6, 4], 2))       # 5
    print(find_kth_largest_heap([3, 2, 1, 5, 6, 4], 2))  # 5
```

---

## Final Tips

- Lead with the one-liner: *"Partition around a pivot, recurse on both sides, no merge — average `O(n log n)`, in place, not stable."*
- Immediately flag the two gotchas: **bad pivot → `O(n²)` on sorted input** (fix: randomize / median-of-three) and **not stable**.
- If asked about duplicates, reach for **three-way (Dutch National Flag)** partitioning.
- For k-th-order statistics, mention **quickselect** (expected `O(n)`) and **median-of-medians / introselect** for the worst-case guarantee.
- For a worst-case `O(n log n)` guarantee, mention **introsort** (heapsort fallback on deep recursion).
- Always offer to verify against the language's built-in sort on random, sorted, reverse, and all-equal inputs.
