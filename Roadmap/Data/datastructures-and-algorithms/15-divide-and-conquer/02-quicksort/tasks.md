# Quicksort (Divide and Conquer by Partitioning) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the partition / quicksort / quickselect logic and validate against the evaluation criteria.
> **Always test against the language's built-in sort on random inputs — including empty, single-element, all-equal, sorted, and reverse-sorted arrays — before trusting your implementation.**

---

## Beginner Tasks (5)

### Task 1 — Lomuto partition

**Problem.** Implement `partition(a, lo, hi)` using **Lomuto's scheme** with `a[hi]` as the pivot. Rearrange `a[lo..hi]` so everything `≤ pivot` is on the left and everything `> pivot` on the right, and return the pivot's final index `p` (where `a[p] == pivot`).

**Input / Output spec.**
- Read `n`, then `n` integers into `a`. Use `lo = 0`, `hi = n-1`.
- Print the returned pivot index `p`, then the partitioned array.

**Constraints.**
- `1 ≤ n ≤ 1000`, values fit in 32-bit.

**Hint.** Keep a boundary `i = lo - 1`; for each `j`, if `a[j] <= pivot` then `i++` and swap `a[i], a[j]`. Finally swap `a[i+1]` with `a[hi]` and return `i+1`.

**Starter — Go.**
```go
package main

import "fmt"

func partition(a []int, lo, hi int) int {
	// TODO: Lomuto; pivot = a[hi]; return pivot's final index
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	a := make([]int, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	p := partition(a, 0, n-1)
	fmt.Println(p)
	fmt.Println(a)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int partition(int[] a, int lo, int hi) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        int p = partition(a, 0, n - 1);
        System.out.println(p);
        System.out.println(Arrays.toString(a));
    }
}
```

**Starter — Python.**
```python
import sys


def partition(a, lo, hi):
    # TODO: Lomuto; pivot = a[hi]; return pivot's final index
    return 0


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    a = [int(next(data)) for _ in range(n)]
    p = partition(a, 0, n - 1)
    print(p)
    print(a)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `a[p] == pivot`, everything left is `≤ pivot`, everything right is `> pivot`.
- The array is a permutation of the input (no lost/duplicated elements).
- Correct on a 1-element array (returns `0`).

---

### Task 2 — Basic recursive quicksort

**Problem.** Using your Task 1 partition, implement `quicksort(a, lo, hi)` that sorts `a` in place. Use the last element as the pivot (no randomization yet).

**Input / Output spec.**
- Read `n`, then `n` integers. Print the sorted array.

**Constraints.** `1 ≤ n ≤ 10^4` (keep `n` modest — fixed pivot is `O(n²)` on sorted input).

**Hint.** Base case `if lo >= hi: return`. Partition, then recurse on `(lo, p-1)` and `(p+1, hi)`.

**Reference oracle.** Compare against the language's built-in sort on random inputs.

**Evaluation criteria.**
- Matches the built-in sort on random arrays, including duplicates.
- Handles empty and single-element arrays.
- Correct base case (no infinite recursion).

---

### Task 3 — Randomized quicksort

**Problem.** Add a **random pivot** to Task 2: before partitioning, swap a uniformly random index in `[lo, hi]` to `hi`. Confirm it now sorts a large already-sorted array fast (no `O(n²)` blowup).

**Input / Output spec.**
- Read `n`, then `n` integers. Print the sorted array.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** One RNG call per recursive frame. Seed the RNG for reproducibility in tests.

**Worked check.** Sort `[0, 1, 2, …, 100000]` (already sorted). The fixed-pivot version (Task 2) is `O(n²)` and times out; the randomized version is `O(n log n)` and finishes instantly. This contrast is the whole point of randomization.

**Evaluation criteria.**
- Sorts a 10^6 already-sorted array in well under a second.
- Matches the built-in sort on random, sorted, and reverse-sorted inputs.
- Uses exactly one random pivot selection per partition.

---

### Task 4 — Insertion-sort cutoff hybrid

**Problem.** Improve Task 3 by switching to **insertion sort** for subarrays of size `≤ CUTOFF` (use `CUTOFF = 16`). This avoids recursion overhead on tiny ranges.

**Input / Output spec.**
- Read `n`, then `n` integers. Print the sorted array.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** In `quicksort`, if `hi - lo + 1 <= CUTOFF`, call `insertionSort(a, lo, hi)` and return; otherwise partition and recurse.

**Evaluation criteria.**
- Identical output to Task 3 (correctness unchanged).
- Measurably faster than Task 3 on random inputs (benchmark and report).
- Insertion sort is restricted to `[lo, hi]` (does not touch elements outside the range).

---

### Task 5 — Detect whether an array is sorted (the verifier)

**Problem.** Implement `isSorted(a)` returning `true` iff `a[i] <= a[i+1]` for all `i`. Then write a test harness that, for 1000 random inputs, runs your quicksort and asserts the result `isSorted` **and** is a permutation of the input (multiset equality).

**Input / Output spec.**
- No stdin; run the self-test and print `PASS` / `FAIL` with a counterexample on failure.

**Constraints.** Random arrays of size `0..50`, values `-50..50`.

**Hint.** Multiset equality: sort both with the built-in sort and compare, or use a frequency map.

**Evaluation criteria.**
- `isSorted` is correct on edge cases (empty, single element, all-equal).
- The harness catches a deliberately broken quicksort (e.g. one that drops an element).
- Tests include all-equal, sorted, and reverse-sorted arrays, not just random ones.

---

## Intermediate Tasks (5)

### Task 6 — Hoare partition with correct bounds

**Problem.** Implement quicksort using the **Hoare** partition (pivot = first element, two pointers moving inward, return a split point). Get the recursion bounds right: recurse on `(lo, p)` and `(p+1, hi)`, **not** `(lo, p-1)`.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** `i = lo-1, j = hi+1`; `do i++ while a[i] < pivot`; `do j-- while a[j] > pivot`; if `i >= j` return `j`, else swap and repeat. Test specifically on all-equal arrays — Hoare must stay `O(n log n)` there.

**Evaluation criteria.**
- Matches the built-in sort, including on all-equal and few-distinct arrays.
- Does **not** infinite-loop on duplicates (a classic Hoare-bounds bug).
- Roughly fewer swaps than Lomuto on random data (instrument and compare).

---

### Task 7 — Median-of-three pivot

**Problem.** Replace the random pivot with **median-of-three** (median of `a[lo]`, `a[mid]`, `a[hi]`). Show it avoids the `O(n²)` trap on already-sorted and reverse-sorted input.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** Sort the three sentinels so `a[lo] <= a[mid] <= a[hi]`, then move the median to `hi` (for Lomuto). This also lets you skip those elements in the partition.

**Evaluation criteria.**
- Sorted and reverse-sorted inputs of size 10^6 finish quickly (not `O(n²)`).
- Matches the built-in sort on all test families.
- Handles tiny ranges (size 1–2) without out-of-bounds indexing.

---

### Task 8 — Three-way quicksort (Dutch National Flag)

**Problem.** Implement **three-way** quicksort that partitions into `< pivot`, `== pivot`, `> pivot` and recurses only on the outer regions. Demonstrate it sorts an all-equal array in `O(n)`.

**Constraints.** `1 ≤ n ≤ 10^6`, but the array may have very few distinct values.

**Hint.** Three pointers `lt, i, gt`. If `a[i] < pivot`: swap to `<`, advance `lt, i`. If `a[i] > pivot`: swap to `>`, decrement `gt` (do **not** advance `i`). Else advance `i`. Recurse `(lo, lt-1)` and `(gt+1, hi)`.

**Reference oracle (Python).**
```python
def brute_sorted(a):
    return sorted(a)   # the oracle
```

**Evaluation criteria.**
- An all-equal array of size 10^6 sorts in `O(n)` (near-instant; two-way Lomuto would be `O(n²)`).
- Matches the built-in sort on few-distinct and random arrays.
- The `>` branch does **not** advance `i` (verify on a small trace).

---

### Task 9 — Quickselect (k-th smallest)

**Problem.** Implement `quickselect(a, k)` returning the k-th smallest element (1-indexed) in expected `O(n)`, recursing into only one side. The array may be reordered.

**Constraints.** `1 ≤ k ≤ n ≤ 10^6`.

**Reference oracle (Python).**
```python
def brute_kth(a, k):
    return sorted(a)[k - 1]   # 1-indexed
```

**Hint.** Partition; if the pivot lands at rank `k-1` (0-indexed), return it; else recurse into the side containing rank `k-1`. Use a loop (not deep recursion) for `O(1)`–`O(log n)` extra space.

**Evaluation criteria.**
- Matches `brute_kth` for all `k` on random and duplicate-heavy arrays.
- Expected `O(n)`: a 10^6 array finishes far faster than a full sort.
- Correct for `k = 1` (min) and `k = n` (max).

---

### Task 10 — Sort objects by a key (and observe instability)

**Problem.** Sort an array of `(key, originalIndex)` pairs by `key` using quicksort. Then **demonstrate instability**: find an input where two equal-key elements come out in a different relative order than the input. Finally, make it stable by breaking ties on `originalIndex` and show the order is now preserved.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Compare by `key`; for the stable variant, compare by `(key, originalIndex)`. Document that the stable version costs the extra index field.

**Evaluation criteria.**
- Produces a key-sorted array matching the built-in sort by key.
- Exhibits a concrete instability example with the plain comparator.
- The tie-broken comparator yields a stable result (equal keys keep input order).

---

## Advanced Tasks (5)

### Task 11 — Introsort (quicksort + heapsort guard + insertion cutoff)

**Problem.** Implement **introsort**: run quicksort with a depth limit of `2⌊log₂ n⌋`; when the limit is hit, sort that subarray with **heapsort**; below `CUTOFF = 16`, use insertion sort. Guarantee `O(n log n)` worst case.

**Constraints.** `1 ≤ n ≤ 10^6`, including adversarial inputs.

**Hint.** Pass a `depthLimit` down the recursion, decrementing each level; at `0`, call `heapsort(a, lo, hi)`. Use median-of-three pivots and tail-call elimination.

**Adversarial check.** Feed a sorted array *and* a "median-of-three killer" pattern. Introsort must stay `O(n log n)` (the heapsort guard engages) — instrument max recursion depth and assert it never exceeds `2⌊log₂ n⌋ + O(1)`.

**Evaluation criteria.**
- Matches the built-in sort on all inputs.
- Max recursion depth stays `O(log n)` even on adversarial inputs.
- Comparison count stays `O(n log n)` (not `O(n²)`) on the killer input.

---

### Task 12 — Median-of-medians (worst-case O(n) selection)

**Problem.** Implement deterministic worst-case `O(n)` selection using **median-of-medians** (BFPRT): groups of 5, recursively select the median of group-medians as the pivot, partition, recurse into one side.

**Constraints.** `1 ≤ k ≤ n ≤ 10^6`.

**Hint.** Groups of 5; sort each group (`O(1)`), collect medians, recursively `select` their median, partition around it, recurse. The recurrence `T(n) ≤ T(n/5) + T(7n/10) + O(n)` is linear because `1/5 + 7/10 < 1`.

**Evaluation criteria.**
- Matches `sorted(a)[k-1]` for all `k`.
- Stays linear even on adversarial inputs that break randomized quickselect (instrument the comparison count — it must be `O(n)`, not `O(n²)`).
- Document that the constant is large (slower than randomized quickselect in practice).

---

### Task 13 — Dual-pivot quicksort (Yaroslavskiy)

**Problem.** Implement **dual-pivot** quicksort: choose two pivots `p1 ≤ p2`, partition into three regions (`< p1`, `p1 ≤ x ≤ p2`, `> p2`) in one pass, and recurse on all three. This is the scheme Java uses for primitive arrays.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** Use `a[lo]` and `a[hi]` as the two pivots (swap so `a[lo] ≤ a[hi]`). Maintain `lt`, `gt`, and a scan pointer; carefully handle elements equal to either pivot. Recurse on the three sub-ranges.

**Evaluation criteria.**
- Matches the built-in sort on all test families.
- Correct three-region partition (verify the invariants on a small trace).
- Benchmark against single-pivot quicksort and report comparison/swap counts.

---

### Task 14 — Adversarial benchmark suite

**Problem.** Build a benchmark that runs your quicksort variants (Lomuto fixed-pivot, randomized, median-of-three, three-way, introsort) on a battery of inputs: random, sorted, reverse-sorted, all-equal, few-distinct, organ-pipe (`0,1,2,…,n/2,…,2,1,0`), and a sawtooth pattern. Report wall-clock time and comparison counts; identify which variant survives which pathology.

**Constraints.** `V = 100000`; cap fixed-pivot runs that risk `O(n²)` so the suite finishes.

**Starter — Python.**
```python
import random
import time
from typing import List, Callable

MOD = 1_000_000_007


def gen_random(n, seed):
    r = random.Random(seed)
    return [r.randint(0, n) for _ in range(n)]


def gen_sorted(n):
    return list(range(n))


def gen_reverse(n):
    return list(range(n, 0, -1))


def gen_all_equal(n):
    return [7] * n


def gen_few_distinct(n, seed):
    r = random.Random(seed)
    return [r.randint(0, 3) for _ in range(n)]


def gen_organ_pipe(n):
    half = list(range(n // 2))
    return half + half[::-1]


def time_sort(sort_fn: Callable, a: List[int]) -> float:
    b = a[:]
    start = time.perf_counter()
    sort_fn(b)
    elapsed = time.perf_counter() - start
    assert b == sorted(a), "incorrect sort!"
    return elapsed


def main():
    n = 100_000
    inputs = {
        "random": gen_random(n, 1),
        "sorted": gen_sorted(n),
        "reverse": gen_reverse(n),
        "all_equal": gen_all_equal(n),
        "few_distinct": gen_few_distinct(n, 2),
        "organ_pipe": gen_organ_pipe(n),
    }
    # TODO: register your sort variants here and time each input pattern
    # for name, a in inputs.items():
    #     print(name, time_sort(my_introsort, a))
    print("register sort variants and run")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same inputs across Go, Java, and Python.
- Fixed-pivot Lomuto is `O(n²)` on sorted/reverse/all-equal; randomized/median-of-three fix sorted/reverse; three-way fixes all-equal/few-distinct; introsort survives everything.
- Report includes mean over ≥ 3 runs and does not time input generation or array cloning.
- Writeup: a table of which variant is robust against which pathology.

---

### Task 15 — Classify the right tool

**Problem.** Implement `classify(problem)` that, given a problem's constraints `(need_stable, need_worst_case_guarantee, query_type, key_distribution, data_location)`, returns one of: `QUICKSORT`, `INTROSORT`, `MERGESORT`, `HEAPSORT`, `THREE_WAY_QUICKSORT`, `QUICKSELECT`, `HEAP_TOPK`. Justify each decision.

**Constraints / cases to handle.**
- In-memory array, average speed, stability not needed → `QUICKSORT` (randomized) or `INTROSORT`.
- Needs stability → `MERGESORT`.
- Needs guaranteed `O(n log n)` worst case → `INTROSORT` (or `HEAPSORT` if `O(1)` space required).
- Many duplicate keys → `THREE_WAY_QUICKSORT`.
- k-th order statistic, in memory → `QUICKSELECT`.
- Top-k streaming / small k / immutable input → `HEAP_TOPK`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The traps: assuming quicksort is stable, and using a full sort when only an order statistic is needed.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- The stability and worst-case branches cite the right reasons (instability of quicksort; `O(n²)` worst case without a guard).
- Justification references the right complexity (`O(n log n)`, `O(n)`, `O(n log k)`, `O(n log d)`).

---

### Task 16 — Branchless (block) partition

**Problem.** Implement a **branchless block partition** in the spirit of BlockQuicksort: instead of branching `if a[j] <= pivot` per element, scan a fixed-size block, record into a small offset buffer the indices of elements that need to move (using arithmetic, no data-dependent branch), then perform the swaps in a tight loop. Use it inside quicksort and benchmark against the naive branchy Lomuto on random data.

**Constraints.** `1 ≤ n ≤ 10^6`; block size `B = 64`.

**Hint.** For a block, compute `offsets[count] = blockStart + t; count += (a[blockStart+t] <= pivot)`. The `+=` of a boolean is branchless. Then swap the buffered offsets into place. The point is to convert the unpredictable branch into predictable arithmetic the CPU pipelines well.

**Evaluation criteria.**
- Produces the same partition result as naive Lomuto (verify on small inputs).
- Measurably faster than branchy Lomuto on random data (report the speedup; on random inputs the branch is ~50% mispredicted).
- Correct on edge cases: all-equal, already-sorted, blocks smaller than `B` at the tail.

---

### Task 17 — Stable quicksort via index tagging

**Problem.** Make quicksort **stable** by tagging each element with its original index and breaking comparison ties on that index. Demonstrate that equal-key elements retain their input order, and discuss the `O(n)` extra-space cost that this incurs (eliminating the in-place advantage).

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Sort pairs `(key, originalIndex)`; the comparator is `(k1, i1) < (k2, i2)` iff `k1 < k2 or (k1 == k2 and i1 < i2)`. Because all tagged keys are now distinct, the sort is automatically stable on the original key.

**Evaluation criteria.**
- Output matches a known stable sort (e.g. Python's `sorted` with `key=lambda p: p[0]`) including the order of equal keys.
- Explicitly reports the extra `O(n)` space for the index field.
- Notes that this is rarely worth it — a stable merge sort is the usual choice when stability is required.

---

## Benchmark Task

### Task B — Quicksort vs Merge Sort crossover and memory

**Problem.** Empirically compare quicksort (introsort) against merge sort across input patterns and sizes. Implement both, then measure wall-clock time and peak extra memory for:

- **(a) Quicksort/introsort:** in place, `O(log n)` extra memory.
- **(b) Merge sort:** stable, `O(n)` extra memory.

Measure for `n ∈ {10^3, 10^4, 10^5, 10^6}` on random, sorted, and all-equal inputs. Report a table comparing time and memory, and note where each wins.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen(n, seed):
    r = random.Random(seed)
    return [r.randint(0, n) for _ in range(n)]


def introsort(a: List[int]) -> None:
    # TODO: introsort (quicksort + heapsort guard + insertion cutoff)
    a.sort()  # placeholder


def mergesort(a: List[int]) -> List[int]:
    # TODO: stable merge sort, O(n) scratch
    return sorted(a)  # placeholder


def time_inplace(sort_fn, a) -> float:
    b = a[:]
    t = time.perf_counter()
    sort_fn(b)
    dt = time.perf_counter() - t
    assert b == sorted(a)
    return dt


def main():
    for n in [1000, 10_000, 100_000, 1_000_000]:
        a = gen(n, 42)
        t_intro = time_inplace(introsort, a)
        t0 = time.perf_counter()
        _ = mergesort(a[:])
        t_merge = time.perf_counter() - t0
        print(f"n={n:<9d} introsort={t_intro*1000:8.2f}ms  mergesort={t_merge*1000:8.2f}ms")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same inputs across Go, Java, and Python.
- Quicksort/introsort wins wall-clock time on random data (smaller constant, in place); merge sort wins on stability and worst-case predictability.
- Report quicksort's `O(log n)` extra memory vs merge sort's `O(n)`.
- Report mean over ≥ 3 runs; do not time input generation.
- Writeup: when you would choose each (stability, memory, worst-case guarantee, cache behavior).

---

## General Guidance for All Tasks

- **Always validate against the built-in sort first.** Run on small arrays including empty, single-element, all-equal, sorted, and reverse-sorted, and diff against `sorted(a)` before trusting the implementation on large inputs.
- **Randomize or median-of-three the pivot.** A fixed first/last pivot is an `O(n²)` time bomb on sorted input — never ship it.
- **Get `lo >= hi` base case and the recursion bounds right.** Lomuto recurses on `(lo, p-1)`/`(p+1, hi)`; Hoare on `(lo, p)`/`(p+1, hi)`. The wrong bound infinite-loops or drops elements.
- **Use three-way partitioning for duplicate-heavy keys.** It turns the all-equal `O(n²)` disaster into `O(n)`.
- **Bound the stack** by recursing the smaller side and looping the larger (tail-call elimination) — `O(log n)` depth.
- **Quicksort is not stable.** If a task needs stable order, use merge sort or tag elements with their original index.
- **Use quickselect, not a full sort,** when only an order statistic is needed — expected `O(n)` beats `O(n log n)`.
- **Reuse one tested `partition`.** Most bugs live in the partition and its recursion bounds; write it once, test it hard, parameterize the pivot rule.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
