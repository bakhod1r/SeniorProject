# Meet in the Middle (MITM) — Interview Preparation

Meet in the middle is a favorite interview topic because it rewards a single crisp insight — *"split the `2^n` search into two halves of `2^(n/2)` and combine the two lists"* — and then tests whether you can (a) pick the right **combine** (hashing vs sort+binary-search vs two-pointer), (b) handle **counting** with duplicate sums correctly, (c) recognize the same square-root trick behind 4-sum, baby-step giant-step, and bidirectional BFS, and (d) know **when MITM is the wrong tool** (small weights → DP; tiny `n` → brute force). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Subset summing to exactly `S`? | enumerate halves, hash/binary-search combine | `O(2^(n/2) · n)` |
| Max subset sum `≤ capacity` (huge weights) | sort one half, binary-search complement | `O(2^(n/2) · n)` |
| Count subsets summing to `S` | frequency map of one half | `O(2^(n/2))` avg |
| Count subsets with sum `≤ S` | sort both, two-pointer suffix count | `O(2^(n/2))` after sort |
| 4 arrays, one element each, sum to 0 | split into two pairs, complement lookup | `O(N²)` |
| Discrete log `a^x ≡ b (mod p)` | baby-step giant-step | `O(√p)` |
| Shortest path, start & goal known | bidirectional BFS | `O(b^(d/2))` |
| **Small weights subset sum** | **pseudo-poly DP, not MITM** | `O(n·W)` |

The square-root law (one idea, many costumes):

```text
problem                brute force      MITM
subset sum (n items)   2^n              2^(n/2)
4-sum (arrays len N)   N^4              N²
discrete log (mod p)   p                √p
shortest path (depth d) b^d             b^(d/2)
```

Core algorithm:

```text
mitm(arr, S):
    mid   = n / 2
    left  = all subset sums of arr[:mid]    # 2^(n/2) values
    right = all subset sums of arr[mid:]    # 2^(n/2) values
    sort(left) (or hash it)
    for b in right:
        if (S - b) in left: return YES
    return NO
# time O(2^(n/2) · n), space O(2^(n/2))
```

Key facts:
- **`2^(n/2) = √(2^n)`** — halving the exponent is the whole win.
- The **empty subset** (sum `0`) is valid; always include it.
- **Memory caps the technique at `n ≈ 50`** (`2^25 ≈ 33M` entries per half).
- Use **64-bit** sums; subset sums of big numbers overflow `int32`.
- For **counting**, use a frequency map (not a `set`) to keep multiplicities.

---

## Junior Questions (12 Q&A)

### J1. What is meet in the middle?
A technique to speed up an `O(2^n)` brute-force search: split the `n` items into two halves, enumerate all `2^(n/2)` outcomes of each half independently, then combine the two lists (sort+search, two-pointer, or hashing). The total cost is about `O(2^(n/2) · n)` — the square root of brute force.

### J2. Why is the speedup a "square root"?
Because `2^(n/2) = (2^n)^(1/2) = √(2^n)`. Brute force on 40 items is `2^40 ≈ 10^12`; MITM is `2^20 ≈ 10^6` per half. Taking the square root of an exponential is the difference between minutes and microseconds.

### J3. Walk me through MITM for subset sum.
Split the array into left and right halves. Compute every subset sum of the left half (`2^(n/2)` sums) and of the right half. Sort the left list. For each right sum `b`, binary-search the left list for `S − b`; a hit means some subset (left part + right part) sums to `S`.

### J4. Why split into exactly two equal halves?
The enumeration cost is `2^k + 2^(n−k)`, minimized at `k = n/2`. An unbalanced split like `30 + 10` leaves a `2^30` half that defeats the purpose. Balanced splitting is the optimum.

### J5. Do you include the empty subset?
Yes. The empty subset has sum `0` and is a valid subset. Dropping it breaks targets that need one half to contribute nothing (e.g. `S` reachable entirely from the other half, or `S = 0`).

### J6. What's the memory cost, and why does it matter?
`O(2^(n/2))` — you store one half's list of subset sums. For `n = 40` that's ~1M numbers (~8 MB), fine. For `n = 60` it's ~10^9 numbers (~8 GB), infeasible. Memory is what caps MITM at roughly `n ≤ 50`.

### J7. How is the combine step done?
Three ways: (1) **hashing** — put one list in a hash set, probe with the other's complements (`O(1)` avg); (2) **sort + binary search** — sort one list, binary-search each complement (`O(log)`); (3) **sort both + two-pointer** — sweep two pointers inward (`O(1)` per step after sort).

### J8. When is MITM the wrong tool?
When `n ≤ 20` (brute force is simpler) or when the weights are small (a pseudo-polynomial `O(n·W)` DP is better and handles huge `n`). MITM shines only when `n` is moderate (30–50) and the weights are too large for a DP table.

### J9. Why do you need 64-bit integers?
Subset sums of 40 numbers up to `10^9` reach `4 × 10^10`, which overflows 32-bit `int`. Use `int64`/`long` for all sums to avoid silent wraparound producing wrong matches.

### J10. What's the time complexity overall?
`O(2^(n/2) · n)`. The `2^(n/2)` is the enumeration and combine; the `n` (or `log 2^(n/2) = n/2`) comes from sorting/binary search. With hashing the average is `O(2^(n/2))` flat.

### J11. Is MITM a divide-and-conquer algorithm?
It's divide-and-conquer flavored: it divides the search space into two halves and combines. But unlike classic D&C, it splits exactly *once* (no recursion) and spends its cleverness on the combine step.

### J12 (analysis). Why can't you just use a hash set for everything?
A hash set answers existence in `O(1)`, but it has no order, so it cannot answer "largest subset sum `≤ S`" or "closest to `S`" — those need a sorted list and binary search. And for counting `≤ S` you need a range query, which a sorted array + two-pointer provides but a set does not.

---

## Middle Questions (12 Q&A)

### M1. Prove MITM correctness for subset sum.
Every subset `T` splits uniquely as `T = A ∪ B` with `A ⊆ left`, `B ⊆ right`, and `σ(T) = σ(A) + σ(B)`. So a subset summing to `S` exists iff some left sum `a` and right sum `b` have `a + b = S`, i.e. `S − b ∈ {left sums}`. The combine tests exactly this.

### M2. How do you count subsets summing to exactly `S`?
Build a frequency map of left sums (`value → count`). Then `answer = Σ over right sums b of freqLeft[S − b]`. This is a convolution of the two halves' multiplicity functions and correctly handles duplicate sums. A `set` would undercount duplicates.

### M3. How do you count subsets with sum `≤ S`?
Sort both lists. Two-pointer: `i` ascending over left, `j` descending over right. Whenever `left[i] + right[j] ≤ S`, every `right[0..j]` also qualifies for this `i`, so add `j + 1` to the count and advance `i`. One `O(2^(n/2))` sweep after the sort.

### M4. How does MITM solve 4-sum (four arrays summing to zero)?
Split the four arrays into two pairs `(A, B)` and `(C, D)`. Enumerate all `N²` sums `A[i] + B[j]` into a frequency map, and all `N²` sums `C[k] + D[l]`. For each `cd`, add `freq[−cd]`. Total `O(N²)` vs `O(N^4)` brute force.

### M5. What is baby-step giant-step?
A number-theoretic MITM for discrete log `a^x ≡ b (mod p)`. Write `x = i·m − j` with `m = ⌈√p⌉`. Baby steps tabulate `b·a^j` for `j < m`; giant steps compute `a^(i·m)` and look them up. A collision gives `x = i·m − j`. It turns `O(p)` into `O(√p)`.

### M6. How is bidirectional BFS a MITM?
Search forward from the start and backward from the goal simultaneously; stop when the frontiers meet. Each side only reaches depth `d/2`, so `O(b^d)` becomes `O(b^(d/2))`. "Reachable in `d/2` steps forward" and "backward" are the two half-lists; the meeting node is the combine match.

### M7. When does MITM beat DP, and when does DP win?
MITM wins when weights are **huge** and `n` is small (≤ ~45) — it's insensitive to weight magnitude. DP (`O(n·W)`) wins when weights `W` are **small** (≤ ~10^6) — it's insensitive to `n` and handles `n = 10000`. Always ask "how big is `W`?" first.

### M8. How do you avoid overflow?
Use 64-bit sums everywhere. In Go/Java cast to `int64`/`long` before adding. For sums that can exceed `int64`, use 128-bit or big integers, or reduce mod a prime if the problem allows.

### M9. Why expand the smaller frontier in bidirectional BFS?
To balance the work between the two sides. If one frontier grows much faster, expanding it wastes effort; always expanding the smaller frontier keeps both near `b^(d/2)` and minimizes total nodes visited.

### M10. How do you find the maximum subset sum that is `≤ capacity`?
This is knapsack with huge weights. Sort the right list. For each left sum `a ≤ cap`, binary-search the right list for the largest `b ≤ cap − a`, and track `max(a + b)`. `O(2^(n/2) · n)`.

### M11. Why can't MITM count simple paths in a graph?
The "no repeated vertex" constraint *couples* the two halves — a path's left part restricts which vertices the right part may use. MITM requires the two halves to be **independent** (separable). Simple-path counting is not separable, so MITM (like matrix powers) cannot do it.

### M12 (analysis). What's the Schroeppel-Shamir improvement?
It reduces MITM's space from `O(2^(n/2))` to `O(2^(n/4))` while keeping `O(2^(n/2))` time, by splitting into four quarters and *generating* the two half-lists in sorted order on demand (via heaps) instead of materializing them. The canonical space–time trade-off result.

---

## Senior Questions (10 Q&A)

### S1. How large can `n` be for MITM, and why?
Roughly `n ≤ 50`. The space is `O(2^(n/2))`: at `n = 50` each half-list is `2^25 ≈ 33M` int64 (~268 MB); at `n = 60` it's `2^30 ≈ 10^9` (~8 GB), infeasible. MITM is a `30 ≤ n ≤ 50` technique; state that bound in any design.

### S2. When would branch-and-bound beat MITM?
For *optimization* (max subset sum ≤ cap) on typical instances with good pruning bounds, B&B often finishes in microseconds — far faster than MITM's *unconditional* `2^(n/2)` enumeration. MITM wins on adversarial instances (B&B's worst case is `2^n`) and for counting/decision variants where a worst-case guarantee matters.

### S3. How do you handle counting correctly with duplicate sums?
Use a frequency map (`value → count`), not a `set`. For exact `S`, sum `freqLeft[S − b]` over right sums. For `≤ S`, sort both and two-pointer-count the suffix. A `set` collapses duplicate sums and silently undercounts the number of subsets.

### S4. Why does cache behavior favor sorted arrays over hashing at large `n`?
A hash set of tens of millions of entries has random-access probes that thrash the cache once it exceeds L2/L3. Two contiguous sorted arrays swept by two pointers stream memory linearly. So despite hashing's better paper constant, sorted+two-pointer is often faster in practice for `n ≥ 44`.

### S5. How do you save memory beyond materializing both halves?
Materialize and sort only the **left** half; **stream** the right half (generate each right sum on the fly and probe left immediately, never storing the full right list). This halves peak memory. For a deeper cut, use Schroeppel-Shamir (4-way split, generate sorted streams) for `O(2^(n/4))` space.

### S6. How do you verify a MITM solution?
Keep a brute-force oracle (enumerate all `2^n` subsets) for `n ≤ 18` and compare existence/count/closest entrywise. Property tests: empty subset present, half-list size `== 2^(half)`, counting ≥ 1 whenever detection says exists, and for BSGS a round-trip `a^x ≡ b`. Determinism across languages on the same input.

### S7. What breaks bidirectional BFS?
Expanding only one side (loses the `√` speedup); stopping on the first edge-touch without level discipline (returns a non-shortest path — must check all meetings at the meeting level); and using forward adjacency for the backward search on a *directed* graph (must use reverse adjacency).

### S8. When does baby-step giant-step fail, and what's the fix?
Basic BSGS needs `gcd(a, p) = 1` and a known group order. On composite moduli or smooth-order groups it's weak. Pohlig-Hellman reduces to prime-power subgroups and combines via CRT; cryptographic groups choose an order with a large prime factor specifically to defeat BSGS/Pohlig-Hellman.

### S9. How do you pick between MITM, DP, brute force, and B&B?
`n ≤ 20` → brute force. Small `W` → `O(n·W)` DP (any `n`). Huge `W`, `n ≤ 45`, decision/counting → MITM (worst-case guarantee). Optimization with good bounds → B&B. `n ≥ 60` → none fits; approximation or structure. The deciding question is the magnitude of `W` and whether you need a worst-case guarantee.

### S10 (analysis). Is MITM a complexity-class improvement?
No. It halves an exponent — `2^n → 2^(n/2)` — but the problem stays exponential in `n` (subset sum is NP-complete; counting is #P-hard). MITM is a square-root *speedup*, not a move into `P`. The pseudo-polynomial DP is polynomial only because it's parameterized by the value magnitude `W`, a different axis.

---

## Professional Questions (8 Q&A)

### P1. Design a service answering "is there a subset of these (≤45) huge weights summing to `S`?"
Enumerate the two halves once per request (or cache if the weight set is fixed across requests). Materialize and sort the left half, stream the right and binary-search. Use 64-bit sums with an overflow guard. Reject `n > 50` with a "use DP or B&B" error. Log a memory estimate (`2^(n/2)·8` bytes) before allocating. Parallelize the two enumerations.

### P2. The weights are small (≤ 10^6) but `n = 5000`. What do you do?
Not MITM — `2^2500` is absurd. Use the pseudo-polynomial DP: a boolean (or counting) DP over reachable sums `0..W`, `O(n·W)`. This is insensitive to `n` and handles `n = 5000` easily because `W` is small. MITM ignores `W` and would be catastrophically slow here.

### P3. How would you reduce MITM's memory footprint at `n = 50`?
First, stream the right half (store only left) — halves peak memory. Second, dedup the left half for *decision* problems (collapse equal sums) — saves memory when many subsets share sums. Third, for the tightest budget, Schroeppel-Shamir's 4-way split generates sorted streams via heaps for `O(2^(n/4))` space. Use flat primitive arrays, not boxed objects.

### P4. How do you debug "the count is wrong" in a MITM counting solution?
Run the brute-force oracle on the same small input and diff. Check the three usual suspects: a `set` used instead of a frequency map (collapses duplicates), the empty subset missing, and an off-by-one in the split. Assert each half-list has exactly `2^(half)` entries — a short list means enumeration terminated early.

### P5. When is the optimization variant (max ≤ cap) better solved by B&B than MITM?
When the instance has good bounds (sorted items, tight pruning) so B&B's tree collapses to a tiny fraction of `2^n` — common on "easy" real instances. MITM always pays the full `2^(n/2)`. The senior call: B&B for typical optimization with bounds; MITM when you need a guaranteed worst-case (adversarial tests, `n ≈ 40`).

### P6. How do you parallelize MITM and 4-sum?
The two half-enumerations are independent — run them on separate threads. The combine's probe loop (for each right value, search left) parallelizes across right values. For 4-sum, the two pair-enumerations are independent. The only serial point is the final reduction (merging counts). MITM is embarrassingly parallel.

### P7. How does discrete-log MITM connect to cryptography?
Baby-step giant-step (and Pohlig-Hellman) break discrete log in `O(√N)` or faster on smooth-order groups, which is why secure groups use a prime-order (or large-prime-factor) order — to force the `√N` work to be astronomically large. MITM is thus both an attack tool and a reason cryptographers choose their parameters carefully.

### P8 (analysis). Why is the balanced split provably optimal?
The total enumeration cost is `2^k + 2^(n−k)`, a convex function of `k` symmetric about `n/2`. A convex symmetric function is minimized at its axis of symmetry, `k = n/2`. Any imbalance makes the larger half's `2^(larger)` dominate and grow exponentially, so `k = n/2` is the unique optimum.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you turned an infeasible brute force into a feasible algorithm.
Look for a concrete story: an exponential search (`n ≈ 40`) that timed out, the realization that the state split into two independent halves, the MITM rewrite to `2^(n/2)`, and the measured speedup. Strong answers mention the memory budget check and validation against the old brute force on small inputs.

### B2. A teammate used MITM where a simple DP would do. How do you handle it?
Point out calmly that the weights are small, so an `O(n·W)` DP is simpler, uses far less memory, and scales to large `n` — whereas MITM burns `2^(n/2)` memory for no reason. Frame the rule: "MITM is for huge weights and small `n`; small weights → DP." A teaching moment, not blame.

### B3. Design a feature to find the shortest connection between two users in a social graph.
Bidirectional BFS: both endpoints are known, the graph is huge, and degrees-of-separation `d` is small but the frontier `b^d` is enormous. Expand the smaller frontier from each side, stop when they meet at depth `d/2`, cutting `b^d` to `b^(d/2)`. Discuss reverse adjacency for directed follows and the level-discipline for shortest-path correctness.

### B4. How would you explain MITM to a junior engineer?
Use the two-detectives analogy: split the mansion into west and east wings, each detective lists every possible loot total from their wing, then they meet in the lobby and check if one total plus the other equals the stolen amount. Lead with the two gotchas: include the empty subset, and watch memory (you must write down one detective's list).

### B5. Your MITM job is using too much memory at scale. How do you investigate?
Each half-list is `2^(n/2)` int64 = `2^(n/2)·8` bytes; check whether `n` crept past ~50. Confirm you're streaming the right half, not materializing both. Verify flat primitive arrays, not boxed objects. For counting, ensure you're not also storing bitmasks unnecessarily. If still tight, switch to Schroeppel-Shamir's `O(2^(n/4))` space.

---

## Coding Challenges

### Challenge 1: Subset Sum Closest to Target

**Problem.** Given `n` integers (`n ≤ 40`) and a target `S`, find the subset whose sum is **closest to `S`** (minimize `|sum − S|`). Return that closest achievable sum.

**Example.**
```text
arr = [7, 2, 5, 10, 8], S = 15  ->  15  (e.g. {7,8} or {5,10})
arr = [3, 34, 4, 12, 5, 2], S = 30 -> 30 (e.g. {34} is 34; {12,5,3,4,2}=26; {34}... closest is 31? compute)
```

**Constraints.** `1 ≤ n ≤ 40`, values and `S` up to `10^9`.

**Brute force.** All `2^n` subsets — infeasible for `n = 40`.

**Optimal.** MITM: enumerate halves, sort right, for each left sum binary-search the closest complement. `O(2^(n/2) · n)`.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func subsetSums(items []int64) []int64 {
	out := []int64{0}
	for _, x := range items {
		cur := append([]int64(nil), out...)
		for _, s := range cur {
			out = append(out, s+x)
		}
	}
	return out
}

func absI(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func closestSubsetSum(arr []int64, S int64) int64 {
	mid := len(arr) / 2
	left := subsetSums(arr[:mid])
	right := subsetSums(arr[mid:])
	sort.Slice(right, func(i, j int) bool { return right[i] < right[j] })

	best := int64(1) << 62
	bestSum := int64(0)
	for _, a := range left {
		need := S - a // want right value closest to `need`
		idx := sort.Search(len(right), func(i int) bool { return right[i] >= need })
		for _, cand := range []int{idx - 1, idx} {
			if cand >= 0 && cand < len(right) {
				total := a + right[cand]
				if absI(total-S) < best {
					best = absI(total - S)
					bestSum = total
				}
			}
		}
	}
	return bestSum
}

func main() {
	fmt.Println(closestSubsetSum([]int64{7, 2, 5, 10, 8}, 15))     // 15
	fmt.Println(closestSubsetSum([]int64{3, 34, 4, 12, 5, 2}, 30)) // closest achievable to 30
}
```

**Java.**
```java
import java.util.*;

public class ClosestSubsetSum {

    static long[] subsetSums(long[] items) {
        long[] out = {0};
        for (long x : items) {
            long[] cur = Arrays.copyOf(out, out.length * 2);
            for (int i = 0; i < out.length; i++) cur[out.length + i] = out[i] + x;
            out = cur;
        }
        return out;
    }

    static long closest(long[] arr, long S) {
        int mid = arr.length / 2;
        long[] left = subsetSums(Arrays.copyOfRange(arr, 0, mid));
        long[] right = subsetSums(Arrays.copyOfRange(arr, mid, arr.length));
        Arrays.sort(right);
        long best = Long.MAX_VALUE, bestSum = 0;
        for (long a : left) {
            long need = S - a;
            int idx = Arrays.binarySearch(right, need);
            if (idx < 0) idx = -idx - 1;
            for (int cand : new int[]{idx - 1, idx}) {
                if (cand >= 0 && cand < right.length) {
                    long total = a + right[cand];
                    if (Math.abs(total - S) < best) {
                        best = Math.abs(total - S);
                        bestSum = total;
                    }
                }
            }
        }
        return bestSum;
    }

    public static void main(String[] args) {
        System.out.println(closest(new long[]{7, 2, 5, 10, 8}, 15));     // 15
        System.out.println(closest(new long[]{3, 34, 4, 12, 5, 2}, 30));
    }
}
```

**Python.**
```python
from bisect import bisect_left


def subset_sums(items):
    out = [0]
    for x in items:
        out += [s + x for s in out]
    return out


def closest_subset_sum(arr, S):
    mid = len(arr) // 2
    left = subset_sums(arr[:mid])
    right = sorted(subset_sums(arr[mid:]))
    best, best_sum = float("inf"), 0
    for a in left:
        need = S - a
        idx = bisect_left(right, need)
        for cand in (idx - 1, idx):
            if 0 <= cand < len(right):
                total = a + right[cand]
                if abs(total - S) < best:
                    best, best_sum = abs(total - S), total
    return best_sum


if __name__ == "__main__":
    print(closest_subset_sum([7, 2, 5, 10, 8], 15))      # 15
    print(closest_subset_sum([3, 34, 4, 12, 5, 2], 30))
```

---

### Challenge 2: 4-Sum II (count tuples summing to zero)

**Problem.** Given four arrays `A, B, C, D` of length `N`, count tuples `(i, j, k, l)` with `A[i] + B[j] + C[k] + D[l] = 0`.

**Example.**
```text
A=[1,2], B=[-2,-1], C=[-1,2], D=[0,2]  ->  2
```

**Constraints.** `1 ≤ N ≤ 500` (so `N² = 250,000`).

**Optimal.** MITM split into two pairs, complement lookup. `O(N²)`.

**Go.**
```go
package main

import "fmt"

func fourSumCount(A, B, C, D []int64) int64 {
	freq := make(map[int64]int64)
	for _, a := range A {
		for _, b := range B {
			freq[a+b]++
		}
	}
	var total int64
	for _, c := range C {
		for _, d := range D {
			total += freq[-(c + d)]
		}
	}
	return total
}

func main() {
	fmt.Println(fourSumCount(
		[]int64{1, 2}, []int64{-2, -1}, []int64{-1, 2}, []int64{0, 2})) // 2
}
```

**Java.**
```java
import java.util.*;

public class FourSumII {
    static long fourSumCount(int[] A, int[] B, int[] C, int[] D) {
        HashMap<Long, Long> freq = new HashMap<>();
        for (int a : A)
            for (int b : B)
                freq.merge((long) a + b, 1L, Long::sum);
        long total = 0;
        for (int c : C)
            for (int d : D)
                total += freq.getOrDefault(-((long) c + d), 0L);
        return total;
    }

    public static void main(String[] args) {
        System.out.println(fourSumCount(
            new int[]{1, 2}, new int[]{-2, -1}, new int[]{-1, 2}, new int[]{0, 2})); // 2
    }
}
```

**Python.**
```python
from collections import Counter


def four_sum_count(A, B, C, D):
    freq = Counter(a + b for a in A for b in B)
    return sum(freq[-(c + d)] for c in C for d in D)


if __name__ == "__main__":
    print(four_sum_count([1, 2], [-2, -1], [-1, 2], [0, 2]))  # 2
```

---

### Challenge 3: Count Subsets with Sum ≤ S

**Problem.** Given `n` integers (`n ≤ 40`) and a bound `S`, count how many subsets have sum `≤ S` (including the empty subset).

**Example.**
```text
arr = [1, 2, 3], S = 3  ->  6  ({}, {1}, {2}, {3}, {1,2}, {3})... count subsets with sum<=3
```

**Optimal.** MITM, sort both halves, two-pointer suffix count. `O(2^(n/2))` after sort.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func subsetSums(items []int64) []int64 {
	out := []int64{0}
	for _, x := range items {
		cur := append([]int64(nil), out...)
		for _, s := range cur {
			out = append(out, s+x)
		}
	}
	return out
}

func countLeq(arr []int64, S int64) int64 {
	mid := len(arr) / 2
	left := subsetSums(arr[:mid])
	right := subsetSums(arr[mid:])
	sort.Slice(left, func(i, j int) bool { return left[i] < left[j] })
	sort.Slice(right, func(i, j int) bool { return right[i] < right[j] })
	var count int64
	j := len(right) - 1
	for i := 0; i < len(left); i++ {
		for j >= 0 && left[i]+right[j] > S {
			j--
		}
		if j < 0 {
			break
		}
		count += int64(j + 1)
	}
	return count
}

func main() {
	fmt.Println(countLeq([]int64{1, 2, 3}, 3))
}
```

**Java.**
```java
import java.util.*;

public class CountLeqS {
    static long[] subsetSums(long[] items) {
        long[] out = {0};
        for (long x : items) {
            long[] cur = Arrays.copyOf(out, out.length * 2);
            for (int i = 0; i < out.length; i++) cur[out.length + i] = out[i] + x;
            out = cur;
        }
        return out;
    }

    static long countLeq(long[] arr, long S) {
        int mid = arr.length / 2;
        long[] left = subsetSums(Arrays.copyOfRange(arr, 0, mid));
        long[] right = subsetSums(Arrays.copyOfRange(arr, mid, arr.length));
        Arrays.sort(left);
        Arrays.sort(right);
        long count = 0;
        int j = right.length - 1;
        for (int i = 0; i < left.length; i++) {
            while (j >= 0 && left[i] + right[j] > S) j--;
            if (j < 0) break;
            count += (j + 1);
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countLeq(new long[]{1, 2, 3}, 3));
    }
}
```

**Python.**
```python
def subset_sums(items):
    out = [0]
    for x in items:
        out += [s + x for s in out]
    return out


def count_leq(arr, S):
    mid = len(arr) // 2
    left = sorted(subset_sums(arr[:mid]))
    right = sorted(subset_sums(arr[mid:]))
    count, j = 0, len(right) - 1
    for a in left:
        while j >= 0 and a + right[j] > S:
            j -= 1
        if j < 0:
            break
        count += j + 1
    return count


if __name__ == "__main__":
    print(count_leq([1, 2, 3], 3))
```

---

### Challenge 4: Discrete Logarithm (Baby-Step Giant-Step)

**Problem.** Given a prime `p`, a base `a`, and a target `b`, find the smallest `x ≥ 0` with `a^x ≡ b (mod p)`, or report none. Use baby-step giant-step in `O(√p)`.

**Example.**
```text
a=2, b=22, p=29  ->  some x with 2^x % 29 == 22
a=3, b=1,  p=7   ->  0  (3^0 = 1)
```

**Python.**
```python
import math


def bsgs(a, b, p):
    a %= p
    b %= p
    m = math.isqrt(p - 1) + 1
    table = {}
    cur = b
    for j in range(m):                 # baby steps: b * a^j
        table.setdefault(cur, j)
        cur = cur * a % p
    am = pow(a, m, p)                   # a^m
    giant = 1
    for i in range(m + 1):             # giant steps: a^(i*m)
        if giant in table:
            x = i * m - table[giant]
            if x >= 0:
                return x
        giant = giant * am % p
    return -1


if __name__ == "__main__":
    print(bsgs(2, 22, 29))
    print(bsgs(3, 1, 7))   # 0
```

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func powmod(a, e, mod int64) int64 {
	a %= mod
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

func bsgs(a, b, p int64) int64 {
	a %= p
	b %= p
	m := int64(math.Sqrt(float64(p-1))) + 1
	table := make(map[int64]int64)
	cur := b
	for j := int64(0); j < m; j++ {
		if _, ok := table[cur]; !ok {
			table[cur] = j
		}
		cur = cur * a % p
	}
	am := powmod(a, m, p)
	giant := int64(1)
	for i := int64(0); i <= m; i++ {
		if j, ok := table[giant]; ok {
			x := i*m - j
			if x >= 0 {
				return x
			}
		}
		giant = giant * am % p
	}
	return -1
}

func main() {
	fmt.Println(bsgs(2, 22, 29))
	fmt.Println(bsgs(3, 1, 7)) // 0
}
```

**Java.**
```java
import java.util.*;

public class DiscreteLog {
    static long powmod(long a, long e, long mod) {
        a %= mod;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }

    static long bsgs(long a, long b, long p) {
        a %= p; b %= p;
        long m = (long) Math.sqrt(p - 1) + 1;
        Map<Long, Long> table = new HashMap<>();
        long cur = b;
        for (long j = 0; j < m; j++) {
            table.putIfAbsent(cur, j);
            cur = cur * a % p;
        }
        long am = powmod(a, m, p);
        long giant = 1;
        for (long i = 0; i <= m; i++) {
            Long j = table.get(giant);
            if (j != null) {
                long x = i * m - j;
                if (x >= 0) return x;
            }
            giant = giant * am % p;
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(bsgs(2, 22, 29));
        System.out.println(bsgs(3, 1, 7)); // 0
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Split the `2^n` search into two halves of `2^(n/2)`, enumerate each, and combine the two lists — square root of brute force."*
- Immediately flag the two gotchas: **include the empty subset** and **watch memory** (the `2^(n/2)` list caps `n` at ~50).
- Pick the combine to match the query: **hashing** for existence, **sort + binary search** for closest/≤-S, **sort + two-pointer** for counting.
- For counting, stress **frequency maps, not sets** — duplicates matter.
- Recognize MITM in disguise: **4-sum** (two pairs), **baby-step giant-step** (discrete log), **bidirectional BFS** (two frontiers).
- Know when *not* to use it: small weights → **DP**; tiny `n` → brute force; optimization with bounds → **branch-and-bound**.
- Always offer to verify against a brute-force oracle on small inputs.

