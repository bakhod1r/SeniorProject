# Merge Sort (The Canonical Divide-and-Conquer Algorithm) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the merge-sort logic and validate against the evaluation criteria.
> **Always verify with two invariants on random inputs: the output is sorted (`is_sorted`) AND it is a permutation of the input (same multiset). Sorted-but-not-a-permutation is the most common silent bug.**

---

## How to Approach These Tasks

1. Implement the **merge primitive** first (Task 1) and test it in isolation — most sort bugs live here.
2. Build top-down (Task 2) and bottom-up (Task 3) on top of that one merge.
3. Reuse the merge for the derived problems: inversions (Task 4), reverse pairs (Task 10), `k`-way merge (Task 8).
4. Always run the **is-sorted + multiset** self-check (bottom of this file) before trusting any result.

---

## Beginner Tasks (5)

### Task 1 — Merge two sorted arrays

**Problem.** Implement `merge(L, R)` that combines two already-sorted arrays into one sorted array using a two-pointer scan. Must be **stable** (take from the left on ties) and `O(|L| + |R|)`.

**Input / Output spec.**
- Read `p`, then `L` (`p` ints), then `q`, then `R` (`q` ints).
- Print the merged sorted array, space-separated.

**Constraints.**
- `0 ≤ p, q ≤ 10^5`, both inputs already sorted ascending.
- Each element copied exactly once (no re-sorting).

**Hint.** Two pointers `i, j`; while both in range, copy the smaller (`L[i] <= R[j]` → take `L`); then drain the two tails.

**Starter — Go.**
```go
package main

import "fmt"

func merge(L, R []int) []int {
	// TODO: two-pointer merge, "<=" for stability, drain both tails
	return nil
}

func main() {
	var p int
	fmt.Scan(&p)
	L := make([]int, p)
	for i := range L {
		fmt.Scan(&L[i])
	}
	var q int
	fmt.Scan(&q)
	R := make([]int, q)
	for i := range R {
		fmt.Scan(&R[i])
	}
	out := merge(L, R)
	for i, v := range out {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(v)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int[] merge(int[] L, int[] R) {
        // TODO
        return null;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int p = sc.nextInt();
        int[] L = new int[p];
        for (int i = 0; i < p; i++) L[i] = sc.nextInt();
        int q = sc.nextInt();
        int[] R = new int[q];
        for (int i = 0; i < q; i++) R[i] = sc.nextInt();
        int[] out = merge(L, R);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < out.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(out[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def merge(L, R):
    # TODO
    return []


def main():
    data = iter(sys.stdin.read().split())
    p = int(next(data))
    L = [int(next(data)) for _ in range(p)]
    q = int(next(data))
    R = [int(next(data)) for _ in range(q)]
    print(" ".join(map(str, merge(L, R))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct merged output, verified on a hand example.
- Stable (left on ties); `O(p + q)` (each element copied once).
- Both leftover tails drained (no dropped elements).

---

### Task 2 — Top-down merge sort

**Problem.** Implement recursive top-down merge sort for an integer array. Use a single shared buffer allocated once. Return/print the sorted array.

**Input / Output spec.**
- Read `n`, then `n` ints.
- Print the sorted array.

**Constraints.** `0 ≤ n ≤ 10^6`.

**Hint.** Base case `hi - lo <= 1`; `mid = lo + (hi - lo)/2`; recurse on both halves; merge. Allocate the buffer once at the top, not inside `merge`.

**Reference oracle (Python) — use this to validate.**
```python
def oracle_sorted(a):
    return sorted(a)   # compare your output to this on random inputs
```

**Evaluation criteria.**
- Matches `sorted(a)` on random arrays of sizes 0, 1, 2, and large.
- One buffer allocated (no per-merge allocation).
- `O(n log n)` time, `O(n)` extra space.

---

### Task 3 — Bottom-up (iterative) merge sort

**Problem.** Implement bottom-up merge sort: merge runs of width 1, then 2, then 4, … doubling until the run covers the array. No recursion.

**Input / Output spec.**
- Read `n`, then `n` ints. Print the sorted array.

**Constraints.** `0 ≤ n ≤ 10^6`.

**Hint.** Outer loop `width = 1, 2, 4, …`; inner loop `lo = 0, 2*width, …`; `mid = min(lo+width, n)`, `hi = min(lo+2*width, n)`; merge `[lo, hi)`. Reuse the same `merge` as Task 2.

**Worked check.** For `n = 8`, the merges happen in three passes: widths 1, 2, 4 — matching `log₂ 8 = 3` levels. For power-of-two `n`, bottom-up does the same merges as top-down.

**Evaluation criteria.**
- Matches `sorted(a)` and your Task 2 output on random inputs.
- Uses `O(1)` control space (no recursion stack).
- Correct handling when `n` is not a power of two (uneven final run).

---

### Task 4 — Count inversions

**Problem.** Count inversions — pairs `(i, j)` with `i < j` and `a[i] > a[j]` — using the merge step. Output the count.

**Input / Output spec.**
- Read `n`, then `n` ints. Print the inversion count.

**Constraints.** `1 ≤ n ≤ 10^5`; use a 64-bit counter (`n(n-1)/2` can exceed 32-bit).

**Hint.** During each merge, when you take an element from the **right** half, add `(mid - i)` (the number of remaining left elements) to the counter.

**Worked check.** `[2,4,1,3,5] → 3`; reverse-sorted `[5,4,3,2,1] → 10 = 5·4/2`; sorted array → `0`.

**Reference oracle (Python).**
```python
def brute_inversions(a):
    n = len(a)
    return sum(1 for i in range(n) for j in range(i + 1, n) if a[i] > a[j])
```

**Evaluation criteria.**
- Matches `brute_inversions` for small `n` (`≤ 500`).
- 64-bit counter; correct on reverse-sorted (`n(n-1)/2`).
- `O(n log n)`.

---

**Common-bug checklist for Task 4.**
- Adding to the counter on a **left** pick instead of a right pick (counts nothing).
- Adding `1` instead of `(mid - i)` (counts only adjacent inversions, misses the rest).
- 32-bit overflow on large reverse-sorted arrays (`n(n-1)/2`).

---

### Task 5 — Stability check

**Problem.** Sort an array of `(key, originalIndex)` records by `key` using merge sort, and verify the result is **stable** (equal keys keep ascending `originalIndex`). Print `STABLE` or `UNSTABLE`.

**Input / Output spec.**
- Read `n`, then `n` keys. Tag each with its input index, sort by key, then check.
- Print `STABLE` if for every group of equal keys the indices are ascending, else `UNSTABLE`.

**Constraints.** `1 ≤ n ≤ 10^5`, many duplicate keys.

**Hint.** Use `<=` in the merge. After sorting, scan adjacent equal-key pairs and confirm their original indices are increasing. A `<` merge would print `UNSTABLE`.

**Evaluation criteria.**
- Reports `STABLE` for a correct `<=` merge.
- Reports `UNSTABLE` if you deliberately switch to `<` (sanity test).
- Works with all-equal keys (the strongest stability test).

---

## Intermediate Tasks (5)

### Task 6 — Sort a linked list (O(1) extra space)

**Problem.** Sort a singly linked list with merge sort in `O(n log n)` time and `O(1)` extra space (besides recursion). The sort must be stable. Return the new head.

**Constraints.** `0 ≤ n ≤ 10^5`.

**Hint.** Split with slow/fast pointers; cut with `slow.next = None`; recursively sort each half; merge by relinking `next` pointers (no buffer). Use `<=` for stability.

**Reference oracle (Python).**
```python
def oracle_list(vals):
    return sorted(vals)   # collect your list's values and compare
```

**Evaluation criteria.**
- Matches `sorted(vals)` on random lists, including empty and single-node.
- No array buffer used (only pointer relinking).
- Stable (verify with keyed nodes if duplicates present).

---

### Task 7 — Natural merge sort

**Problem.** Implement natural merge sort: identify maximal ascending **runs**, then merge adjacent runs pairwise until one remains. On already-sorted input it must finish in `O(n)` (a single run, no merges).

**Constraints.** `0 ≤ n ≤ 10^6`.

**Hint.** First scan to collect run boundaries (`a[j] <= a[j+1]` extends a run). If there is a single run, return immediately. Otherwise merge adjacent run pairs each pass, halving the run count.

**Worked check.** `[1,2,3,4,5]` → one run → returned in `O(n)`. `[1,3,5,2,4,6]` → two runs `[1,3,5]` and `[2,4,6]` → one merge.

**Evaluation criteria.**
- Already-sorted input does **zero** merges (`O(n)`).
- Matches `sorted(a)` on random inputs.
- Degrades to `O(n log n)` on reverse-sorted / random input.

---

### Task 8 — K-way merge with a heap

**Problem.** Merge `k` sorted arrays into one sorted array using a min-heap (the merge phase of external sort). Output the merged array.

**Constraints.** `1 ≤ k ≤ 10^4`, total elements `N ≤ 10^6`.

**Hint.** Push the head `(value, listId, index)` of each non-empty list into a min-heap. Repeatedly pop the min, emit it, and push the next element from the same list. `O(N log k)`.

**Reference oracle (Python).**
```python
def brute_kway(lists):
    out = []
    for l in lists:
        out.extend(l)
    return sorted(out)
```

**Evaluation criteria.**
- Matches `brute_kway` (concatenate + sort) on random sorted lists.
- `O(N log k)` (heap of size `k`, not `N`).
- Handles empty input lists gracefully.

---

### Task 9 — Merge sort with insertion-sort cutoff

**Problem.** Implement merge sort that switches to insertion sort for subarrays of length `≤ CUTOFF` (e.g. 16), and skips the merge when `a[mid-1] <= a[mid]`. Measure the speedup vs plain merge sort.

**Constraints.** `0 ≤ n ≤ 10^6`, `CUTOFF ∈ [8, 64]`.

**Hint.** Replace the base case `hi - lo <= 1` with `hi - lo <= CUTOFF → insertion_sort(a, lo, hi)`. Add `if a[mid-1] <= a[mid]: return` before the merge.

**Evaluation criteria.**
- Matches `sorted(a)` on random inputs.
- Measurably faster than plain merge sort on random arrays (report the ratio).
- Nearly-sorted input is much faster (the merge-skip fires).

---

### Task 10 — Reverse pairs (variant inversion count)

**Problem.** Count **reverse pairs**: pairs `(i, j)` with `i < j` and `a[i] > 2·a[j]`. Use a merge-sort framework with a separate counting scan before each merge.

**Constraints.** `1 ≤ n ≤ 5·10^4`; values may be large (use 64-bit).

**Hint.** Before merging two sorted halves, run a two-pointer scan: for each `i` in the left half, advance a pointer `j` in the right half while `a[i] > 2·a[j]`, adding `(j - mid)` to the count. Then do the normal merge.

**Reference oracle (Python).**
```python
def brute_reverse_pairs(a):
    n = len(a)
    return sum(1 for i in range(n) for j in range(i + 1, n) if a[i] > 2 * a[j])
```

**Evaluation criteria.**
- Matches `brute_reverse_pairs` for small `n` (`≤ 500`).
- Counting scan is separate from (and before) the merge.
- `O(n log n)`; 64-bit counter.

---

## Advanced Tasks (5)

### Task 11 — External merge sort simulation

**Problem.** Simulate external merge sort: given a large list and a `chunk_size` (the "RAM budget"), sort each chunk in memory (a sorted **run**), then `k`-way merge all runs into the final sorted output. Report the number of runs.

**Constraints.** `1 ≤ n ≤ 10^6`, `1 ≤ chunk_size ≤ n`.

**Hint.** Phase 1: `runs = [sorted(data[i:i+chunk_size]) for i in 0..n step chunk_size]`. Phase 2: `k`-way merge (Task 8). The run count is `⌈n / chunk_size⌉`.

**Evaluation criteria.**
- Output matches `sorted(data)`.
- Run count equals `⌈n / chunk_size⌉`.
- Merge phase uses a heap (`O(n log k)`), not repeated full re-sorts.

---

### Task 12 — Stable sort by index tagging

**Problem.** Make an *unstable* sort behave stably by tagging each record with its global input index and breaking ties on it. Demonstrate with a `k`-way merge across runs that were formed out of original order.

**Constraints.** `1 ≤ n ≤ 10^5`, many duplicate keys.

**Hint.** Sort key becomes `(key, globalIndex)`. Equal `key` breaks on `globalIndex` (unique, monotone in input order), so equal records emerge in input order. Verify the result is stable even when runs are merged in a different order than input.

**Evaluation criteria.**
- Output is stable (equal keys in ascending original index).
- Works even when runs/partitions are processed out of input order.
- Documents that the index tag costs one extra comparison field.

---

### Task 13 — Ping-pong buffer merge sort

**Problem.** Implement bottom-up merge sort with **ping-pong buffers**: alternate source/destination each pass to eliminate the copy-back, and ensure the final result lands in the caller's array (handle parity).

**Constraints.** `0 ≤ n ≤ 10^6`.

**Hint.** Merge from `src` into `dst`, then swap references. After all passes, if the sorted data is in the scratch buffer (odd number of passes), copy it back once.

**Evaluation criteria.**
- Matches `sorted(a)`; result is in the original array regardless of pass parity.
- Performs no per-pass copy-back (only the final parity copy if needed).
- Measurably fewer data moves than the copy-back version.

---

### Task 14 — Parallel merge sort

**Problem.** Implement parallel merge sort: sort the two halves concurrently (goroutines / threads / `ForkJoinPool` / `multiprocessing` or `concurrent.futures`) down to a granularity threshold, then merge. Below the threshold, sort sequentially.

**Constraints.** `1 ≤ n ≤ 10^7`, threshold ≈ 8192.

**Hint.** `if hi - lo <= THRESHOLD: sequentialSort; else: spawn both halves, sync, merge`. The final merge is sequential here; note it as the Amdahl bottleneck. Be careful with shared buffer access (each subarray writes a disjoint range).

**Degree-of-parallelism note.** With a sequential final merge, parallelism is limited to `O(log n)`. A true parallel merge (median split + binary search) would lift it to near-linear; implementing that is a stretch goal.

**Evaluation criteria.**
- Matches `sorted(a)` on random inputs.
- Measurable speedup vs sequential on a multicore machine for large `n`.
- No data races (disjoint write ranges; buffer used safely).

---

### Task 15 — Choose the right sort

**Problem.** Given a problem description with constraints `(n, in_memory, stability_required, key_type, untrusted_input)`, implement `classify(...)` that returns one of: `MERGE_SORT`, `QUICKSORT`, `HEAPSORT`, `EXTERNAL_MERGE_SORT`, or `COUNTING_OR_RADIX`. Justify each decision.

**Constraints / cases to handle.**
- Data larger than RAM → `EXTERNAL_MERGE_SORT`.
- Stability required (object sort) → `MERGE_SORT` (Timsort-style).
- In-RAM primitives, no stability, speed matters → `QUICKSORT` (introsort).
- Worst-case guarantee + `O(1)` space, no stability → `HEAPSORT`.
- Integer keys in a small range → `COUNTING_OR_RADIX` (beats `O(n log n)`).

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The `COUNTING_OR_RADIX` case is the trap — non-comparison sorts escape the `Ω(n log n)` bound only for restricted key domains.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `COUNTING_OR_RADIX` branch cites the comparison-sort lower bound it escapes.
- Justification references the right property (guarantee, stability, space, IO).

---

## Benchmark Task

### Task B — Merge sort vs quicksort vs library sort crossover

**Problem.** Empirically compare three sorts on the same seeded random data and on adversarial (already-sorted, reverse-sorted) data. Implement and time:

- **(a) Top-down merge sort** (with buffer reuse and cutoff).
- **(b) Simple quicksort** (random or median-of-three pivot).
- **(c) Library sort** (`sort.Ints` / `Arrays.sort` / `sorted`).

Measure wall-clock time for `n ∈ {10^3, 10^4, 10^5, 10^6}` on (i) random, (ii) sorted, (iii) reverse-sorted inputs. Report a table; note where naive quicksort degrades to `O(n²)` on sorted input (if no randomization).

**Starter — Python.**
```python
import random
import time
from typing import List


def gen(n: int, seed: int, kind: str) -> List[int]:
    r = random.Random(seed)
    a = [r.randint(0, 10**9) for _ in range(n)]
    if kind == "sorted":
        a.sort()
    elif kind == "reverse":
        a.sort(reverse=True)
    return a


def merge_sort(a):
    # TODO: top-down with buffer reuse + insertion cutoff
    return a


def quicksort(a):
    # TODO: simple quicksort; note degradation on sorted input without randomization
    return a


def bench(fn, a) -> float:
    data = a[:]                      # do not time the clone
    start = time.perf_counter()
    fn(data)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n        kind     merge_ms   quick_ms   lib_ms")
    for n in [1_000, 10_000, 100_000, 1_000_000]:
        for kind in ["random", "sorted", "reverse"]:
            a = gen(n, 42, kind)
            m = mean_ms([bench(merge_sort, a) for _ in range(3)])
            q = mean_ms([bench(quicksort, a) for _ in range(3)])
            lib = mean_ms([bench(lambda x: x.sort(), a) for _ in range(3)])
            print(f"{n:<8d} {kind:<8s} {m:<10.2f} {q:<10.2f} {lib:<8.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same data across Go, Java, and Python.
- Merge sort's time is stable across all three input kinds (no degradation); naive quicksort degrades on sorted/reverse input.
- Library sort (often Timsort/introsort) is fastest or competitive; explain why.
- Report includes the mean across at least 3 runs and does not time data generation or cloning.
- Writeup: a short note on when merge sort's stability/guarantee justifies its `O(n)` memory cost over quicksort.

---

## General Guidance for All Tasks

- **Always validate against the oracle first.** Compare your output to a trusted library sort on random inputs of many sizes (including 0, 1, 2), then trust your implementation on large inputs.
- **Check BOTH invariants:** the output is sorted AND a permutation of the input (same multiset). Use a checksum/XOR for the permutation check on large inputs.
- **Allocate the buffer once.** Never allocate a temp array inside `merge`; thread one shared buffer through, or ping-pong two.
- **Use `<=` for stability.** Take from the left run on ties; `<` breaks stability silently.
- **Compute `mid` overflow-safely:** `lo + (hi - lo)/2`, not `(lo + hi)/2`.
- **Use 64-bit counters** when counting inversions or reverse pairs.
- **Drain both tails** after the main merge loop, or you will drop elements.
- **Pick the variant deliberately:** top-down (clarity), bottom-up (no stack), natural (adaptive), linked-list (`O(1)` extra), external (data > RAM).

## Self-Check Invariants (use on every task)

```python
def is_sorted(a):
    return all(a[i] <= a[i + 1] for i in range(len(a) - 1))


def same_multiset(a, b):
    from collections import Counter
    return Counter(a) == Counter(b)


def check(original, result):
    # The two invariants that together prove a sort is correct.
    assert is_sorted(result), "output is not sorted"
    assert same_multiset(original, result), "output is not a permutation of the input"
    return True
```

Run `check(original_copy, your_output)` on random inputs of sizes `{0, 1, 2, 3, 16, 17, 1000, 100000}` and on the adversarial inputs (already-sorted, reverse-sorted, all-equal). The **multiset** half of the check is what catches the most common silent bug — a botched leftover-drain that produces a sorted-but-incomplete array. `is_sorted` alone would pass it.

## Difficulty Progression

- **Beginner (1–5):** the merge primitive, top-down and bottom-up sorts, inversion counting, and stability — the irreducible core.
- **Intermediate (6–10):** the variants that make merge sort uniquely valuable — linked-list (`O(1)` space), natural (adaptive), `k`-way (external merge phase), cutoff tuning, and the reverse-pairs inversion variant.
- **Advanced (11–15):** production concerns — external sort, stability via index tagging, ping-pong buffers, parallelism, and the meta-skill of choosing the right sort.
- **Benchmark (B):** empirical comparison against quicksort and the library sort, including the adversarial inputs where naive quicksort degrades but merge sort does not.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
