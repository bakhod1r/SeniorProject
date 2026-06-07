# Quickselect and the k-th Order Statistic — Interview Preparation

> Tiered questions (Junior → Middle → Senior → Professional) followed by a 3-language coding challenge.
> "k-th smallest" is stated 1-based in prose; code uses 0-based index `k-1` unless noted.

## Junior Questions

| # | Question | Answer Focus |
|---|----------|--------------|
| 1 | What is Quickselect? | Find the k-th smallest element using Quick Sort's partition, but recurse into only ONE side. |
| 2 | What is the "k-th order statistic"? | The k-th smallest element. 1st = min, n-th = max, (n/2)-th = median. |
| 3 | How is Quickselect different from Quick Sort? | Quick Sort recurses into both sides; Quickselect recurses into only the side containing rank k. |
| 4 | What is the expected time complexity? | Expected O(n) with a random pivot. |
| 5 | What is the worst-case time complexity? | O(n²) with a naive pivot on adversarial input. |
| 6 | What does the partition step give you "for free"? | The pivot lands at its final sorted position, so you learn its exact rank. |
| 7 | After partition, how do you decide which side to keep? | Compare pivot index p with k: p==k done; k<p go left; k>p go right. |
| 8 | How do you find the median with Quickselect? | Select the element at rank n/2 (0-based index (n-1)//2). |
| 9 | Does Quickselect sort the array? | No. It only partitions; the array ends up partially ordered around the answer. |
| 10 | Does Quickselect modify the input? | Yes, it reorders in place. Copy the array first if the caller needs the original. |
| 11 | What is the space complexity? | O(1) extra if iterative; O(log n) stack if recursive (average). |
| 12 | How do you find the minimum or maximum with it? | k=0 gives the min, k=n-1 gives the max. |

## Middle Questions

| # | Question | Answer Focus |
|---|----------|--------------|
| 1 | Why is Quickselect O(n) but Quick Sort O(n log n)? | One side recursion → work shrinks geometrically (n + n/2 + n/4 + ... = 2n). Quick Sort redoes full n per level. |
| 2 | Why does a random pivot give expected O(n)? | A random pivot is "good" (middle half) with prob 1/2, so every ~2 steps the size drops to ≤ 3n/4; T(n) ≤ T(3n/4)+O(n) = O(n). |
| 3 | When does Quickselect degrade to O(n²)? | Always-bad pivot (e.g. first element on sorted input) shaves one element per step. |
| 4 | How do you get the top-k with Quickselect? | Select at rank k-1; then arr[:k] are the k smallest (unordered). Sort the front if you need order: O(n + k log k). |
| 5 | Quickselect vs heap-based top-k? | Quickselect O(n) but needs all data in memory and mutates it; heap O(n log k) but streams and uses only O(k) memory. |
| 6 | Quickselect vs full sort for the median? | Quickselect O(n); sort O(n log n). Use selection when you need one rank, not full order. |
| 7 | How do you handle many duplicates? | 3-way (Dutch flag) partition: <, ==, > pivot. If k falls in the equal region, return immediately. Keeps it O(n). |
| 8 | What is partial sorting? | Producing the k smallest in sorted order — via Quickselect+sort-front (O(n+k log k)) or a size-k heap (O(n log k)). |
| 9 | Why prefer the iterative form? | No recursion stack → O(1) space and no stack-overflow risk on bad pivots. |
| 10 | What's the expected comparison count for the median? | About 3.4n comparisons. |
| 11 | What is median-of-medians at a high level? | A deterministic pivot rule (BFPRT) giving worst-case O(n); used as a fallback, not the default. |
| 12 | When would you choose a heap over Quickselect? | Streaming/larger-than-memory data, or tiny k where O(n log k) with small constants beats reordering the whole array. |

## Senior Questions

| # | Question | Answer Focus |
|---|----------|--------------|
| 1 | What is introselect and why use it? | Quickselect (random/median-of-three) with a median-of-medians fallback when recursion depth exceeds a limit → average speed + guaranteed O(n) worst case. |
| 2 | What does C++ `std::nth_element` do and how? | Rearranges so the nth element is in its sorted position with smaller before / larger after; implemented as introselect; linear average. |
| 3 | Which languages have stdlib selection? | C++ `nth_element`, Rust `select_nth_unstable`, NumPy `partition`. Go and Java lack it (use a heap or a helper). |
| 4 | How do you find top-k over a stream? | Bounded min-heap of size k: push if < k, else replace min when larger. O(n log k), O(k) memory, one pass. |
| 5 | How do you compute p99 latency over a billion requests? | Quantile sketch (t-digest / KLL): single-pass, constant memory, mergeable, bounded error. Exact selection is wasteful at that scale. |
| 6 | Is Quickselect an algorithmic-complexity DoS risk? | Yes with deterministic pivots — adversarial input forces O(n²). Defend with random pivots, introselect, input caps, timeouts. |
| 7 | How would you select across sharded data? | Local top-k per shard then merge (O(M·k) network), or iterative count-and-narrow rounds for an exact distributed median. |
| 8 | Can selection be parallelized? | Partition can (parallel prefix-sum, O(log²n) span), but the keep-one-side recursion limits gains; parallelize only the first few huge levels. |
| 9 | Why does Quickselect mutate matter in a service? | Concurrent reads must snapshot/copy; otherwise the shared array is reordered under other readers. |
| 10 | When is BFPRT alone (not introselect) appropriate? | Hard real-time deadlines or untrusted input where even rare O(n²) and dependence on RNG are unacceptable. |
| 11 | Quickselect can't run on a stream — why? | It needs random access to the whole dataset to partition and recurse; a stream gives one pass. |
| 12 | What metrics would you alarm on for a selection service? | p99 latency vs p50, max recursion depth (> 2 log n), BFPRT-fallback rate (spikes = attack), input size vs cap. |

## Professional Questions

| # | Question | Answer Focus |
|---|----------|--------------|
| 1 | Prove Quickselect correct. | Induction on subarray size; partition postcondition puts pivot at rank q; rank-<q lies left, rank->q lies right; recurse the side containing k. |
| 2 | Prove expected O(n) via the geometric series. | Good pivot (prob 1/2) → size ≤ 3n/4; E[T] ≤ Σ 2·(3/4)^j n = 2n·4 = 8n = O(n); equivalently T(n) ≤ T(3n/4)+O(n). |
| 3 | Prove expected O(n) with indicator variables. | E[T(n)] from the averaged recurrence; substitution shows E[T(n)] ≤ 4n. |
| 4 | State and solve the median-of-medians recurrence. | T(n) ≤ T(n/5) + T(7n/10) + O(n); since 1/5 + 7/10 = 9/10 < 1, substitution T(n) ≤ cn gives O(n). |
| 5 | Why does median-of-medians guarantee each side ≤ 7n/10? | Median of medians beats ≥ 3 elements in each of ~n/10 groups → ≥ 3n/10 below and above → other side ≤ 7n/10. |
| 6 | Why group size 5, not 3? | With 3, recurrence is T(n/3)+T(2n/3)+O(n), fractions sum to 1 → O(n log n). 5 gives 9/10 < 1 → linear. |
| 7 | What is the lower bound for selection? | Ω(n) — every element must be read, or an adversary makes it the answer. Selection is Θ(n). |
| 8 | What is the exact comparison cost of min-and-max? | ⌈3n/2⌉ − 2: process in pairs, route smaller/larger to running min/max. |
| 9 | Give a high-probability bound. | Chernoff on number of "good" splits: O(n) with probability ≥ 1 − n^{−c}. |
| 10 | Why is selection asymptotically easier than sorting? | Sorting is Ω(n log n) (decision tree / log n!); selection is Θ(n). Naming one ranked element needs less information than ordering all. |
| 11 | What does Floyd–Rivest achieve? | Expected ~1.5n comparisons for the median (near the lower bound) by sampling to pick two tight bracketing pivots. |
| 12 | How does introselect combine both proofs in practice? | Randomized fast path (expected O(n)) plus depth-triggered BFPRT (worst-case O(n)) → matches the Θ(n) bound with good constants. |

## System Design Discussion (Longer-Form Answers)

These are open-ended prompts where the interviewer wants reasoning, not a one-liner.

**"Design a service that returns the p50/p90/p99 latency over the last 5 minutes for a high-QPS API."**
Do not buffer all samples and Quickselect — at high QPS that is too much memory and recompute. Use a **mergeable quantile sketch** (t-digest or KLL) per time bucket: each worker maintains a sketch over a single pass (O(1) memory per percentile target, bounded error), buckets roll over every few seconds, and the coordinator **merges** sketches across workers and time windows to answer any percentile in O(1). Mention the exactness trade-off: sketches give ±0.1–1% rank error, which is acceptable for SLO dashboards. Quickselect would only appear if a caller needed an *exact* percentile of an in-memory snapshot.

**"Return the 100 most-viewed pages from a 10 TB access log."**
The log does not fit in memory, so Quickselect is out. Map-reduce style: each shard counts views locally (hash aggregation), keeps its **local top-100 with a size-100 heap**, and ships only 100 (page, count) pairs to a coordinator. The coordinator merges `shards × 100` candidates and runs one final selection (heap or Quickselect on that small set). Network cost is O(shards × k), independent of log size. This "local-top-k then merge" is the canonical scalable top-k.

**"Find the exact median of integers spread across 1000 machines without moving the data."**
Use **count-and-narrow**: binary-search the value range. Each round, broadcast a candidate value; every machine reports how many of its elements are below it (one local pass); sum the counts; move the candidate toward rank n/2. A few dozen rounds pin the exact median. Communication is tiny (one number per machine per round); the cost is the number of rounds × local passes. If approximate is acceptable, a single round of merged sketches replaces the whole protocol.

**"Your search ranking endpoint takes user-supplied arrays and returns the median score. How do you prevent a DoS?"**
A deterministic-pivot Quickselect is an algorithmic-complexity attack surface — sorted input forces O(n²). Defenses, layered: (1) **random pivot** from a non-guessable seed so no fixed input is bad; (2) **introselect** so even unlucky/crafted pivot sequences cap at O(n); (3) **input size limits** and a **per-request timeout**; (4) consider a one-time **shuffle**. Mention monitoring the BFPRT-fallback rate as an attack signal.

---

## Rapid-Fire Round

Quick one-liners interviewers use as warm-ups or sanity checks:

| Q | A |
|---|---|
| One-sentence definition of Quickselect? | Quick Sort that recurses into only the side containing rank k → expected O(n). |
| The defining difference from Quick Sort? | One recursive call instead of two. |
| Expected vs worst time? | Expected O(n); worst O(n²) (naive pivot) or O(n) (median-of-medians). |
| What makes it expected-linear? | Geometric series from recursing into one shrinking side. |
| What's the median's rank? | n/2 (0-based (n-1)//2). |
| k-th largest in terms of smallest? | (n-k)-th smallest, 0-based n-k. |
| Does it sort? | No — it partitions; output is partitioned around the answer. |
| Is it stable? | No. |
| Does it mutate input? | Yes, in place. |
| Best tool for streaming top-k? | Size-k heap, O(n log k). |
| Best tool for the median in memory? | Quickselect, O(n). |
| What does `nth_element` use? | Introselect. |
| Is Quickselect Las Vegas or Monte Carlo? | Las Vegas — always correct, variable time. |
| Group size in median-of-medians? | 5. |
| The BFPRT recurrence? | T(n) = T(n/5) + T(7n/10) + O(n) = O(n). |
| Selection lower bound? | Ω(n) — every element must be read. |

## Edge-Case Quiz

Interviewers test whether you handle the corners. Walk through each:

**Q: `nums = [1], k = 1`?** → Single element; `lo == hi`, return `nums[0] = 1`. The loop body never runs.

**Q: `nums = [5, 5, 5, 5], k = 2`?** → All equal. Plain Lomuto still returns `5` correctly, but each partition removes only the pivot → O(n²). For many duplicates use 3-way partition; the answer is `5` regardless.

**Q: `nums = [1,2,3,4,5], k = 1` with first-element pivot?** → Sorted input + bad pivot = O(n²). With a random pivot it's expected O(n). Answer is `1` either way; the point is the complexity.

**Q: `k = 0` or `k > n`?** → Invalid (for 1-based k). Validate and reject before any work; otherwise you index out of bounds.

**Q: Negative numbers? Floats?** → Fine — selection only needs a total order. Beware `NaN` in floats (breaks comparisons); filter it first.

**Q: Does Quickselect return the index or the value?** → As written, the value. If you need the index, track original positions or return the partition index when `p == k`.

**Q: After `findKthLargest`, is the array sorted?** → No. It is partitioned around the answer: everything before index `n-k` is `≤` the answer, everything after is `≥`. Do not rely on full order.

---

## Trade-off Deep Dives

Interviewers often push on *why* one choice over another. Be ready to defend these.

**"Quickselect is O(n) and a heap is O(n log k) — so always use Quickselect, right?"**
No. Asymptotics ignore constants and assumptions. Quickselect needs the **whole array in memory with random access** and **mutates** it; a heap needs only **O(k) memory**, makes **one cache-friendly pass**, and works on a **stream**. For tiny k on huge or streaming data, the heap is faster in wall-clock and the only feasible option. Quickselect wins when k is near the middle (the median) and the data is already in memory.

**"Why not just sort and index? It's simpler."**
For a single rank, sorting wastes a `log n` factor (O(n log n) vs O(n)). But if you need **many** ranks from the **same** data, sort once and index many times — the one-time O(n log n) amortizes below repeated O(n) selections. Also, if the data is already nearly sorted, an adaptive sort (TimSort/Pdqsort) may beat Quickselect's constants. So "sort and index" is the right call for repeated queries or small n.

**"When is plain Quickselect dangerous?"**
When the input is **adversarial or untrusted** and the pivot is deterministic — O(n²) DoS. Fix: random pivot + introselect + input limits. Also dangerous on **duplicate-heavy** data with strict Lomuto (can degrade); fix with 3-way partition.

**"Expected O(n) vs worst-case O(n) — does the difference matter in practice?"**
For batch jobs, rarely — randomized Quickselect's bad tail has probability vanishing polynomially in n. For **latency-SLA** paths (p99 budgets) or **untrusted input**, yes — use introselect to make the bound hard. The median-of-medians constant (~5n+ comparisons) is worse on average, so use it only as a fallback, not the default.

**"How would you pick top-k if k changes per query but data is static?"**
Sort once (O(n log n)); every top-k query is then O(k) by slicing. Repeated selection would redo O(n) each time. If data is dynamic (inserts/deletes), use an order-statistic tree for O(log n) per query and update.

---

## Complexity Reference

| Operation | Quickselect | Heap (size k) | Full sort |
|-----------|-------------|---------------|-----------|
| k-th element | O(n) exp | O(n log k) | O(n log n) |
| Median | O(n) exp | O(n log n) eff. | O(n log n) |
| Top-k unordered | O(n) exp | O(n log k) | O(n log n) |
| Top-k sorted | O(n + k log k) | O(n log k) | O(n log n) |
| Worst case | O(n²) / O(n) introselect | O(n log k) | O(n log n) |
| Space | O(1) | O(k) | O(1)–O(n) |
| Streaming? | No | Yes | No |

---

## Coding Challenge (3 Languages)

### Challenge: k-th Largest Element in an Array

> Given an integer array `nums` and an integer `k`, return the **k-th largest** element (1-based: `k=1` is the maximum).
> You must do better than a full sort on average — implement **Quickselect with a random pivot** in **expected O(n)**.
> Note the twist: the k-th *largest* equals the `(n-k)`-th *smallest* (0-based index `n - k`).
>
> Examples:
> - `nums = [3,2,1,5,6,4], k = 2` → `5`
> - `nums = [3,2,3,1,2,4,5,5,6], k = 4` → `4`

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

// findKthLargest returns the k-th largest (1-based). Expected O(n).
func findKthLargest(nums []int, k int) int {
	a := append([]int(nil), nums...) // copy: don't mutate caller's slice
	target := len(a) - k             // k-th largest = (n-k)-th smallest (0-based)
	lo, hi := 0, len(a)-1
	for lo < hi {
		p := partition(a, lo, hi)
		if p == target {
			return a[p]
		} else if target < p {
			hi = p - 1
		} else {
			lo = p + 1
		}
	}
	return a[lo]
}

func partition(a []int, lo, hi int) int {
	idx := lo + rand.Intn(hi-lo+1)
	a[idx], a[hi] = a[hi], a[idx]
	pivot, i := a[hi], lo-1
	for j := lo; j < hi; j++ {
		if a[j] < pivot {
			i++
			a[i], a[j] = a[j], a[i]
		}
	}
	a[i+1], a[hi] = a[hi], a[i+1]
	return i + 1
}

func main() {
	fmt.Println(findKthLargest([]int{3, 2, 1, 5, 6, 4}, 2))             // 5
	fmt.Println(findKthLargest([]int{3, 2, 3, 1, 2, 4, 5, 5, 6}, 4))    // 4
}
```

#### Java

```java
import java.util.Random;

public class Solution {
    private static final Random RNG = new Random();

    // k-th largest (1-based). Expected O(n).
    public static int findKthLargest(int[] nums, int k) {
        int[] a = nums.clone();          // don't mutate the caller's array
        int target = a.length - k;       // (n-k)-th smallest, 0-based
        int lo = 0, hi = a.length - 1;
        while (lo < hi) {
            int p = partition(a, lo, hi);
            if (p == target) return a[p];
            else if (target < p) hi = p - 1;
            else lo = p + 1;
        }
        return a[lo];
    }

    private static int partition(int[] a, int lo, int hi) {
        int idx = lo + RNG.nextInt(hi - lo + 1);
        swap(a, idx, hi);
        int pivot = a[hi], i = lo - 1;
        for (int j = lo; j < hi; j++) {
            if (a[j] < pivot) { i++; swap(a, i, j); }
        }
        swap(a, i + 1, hi);
        return i + 1;
    }

    private static void swap(int[] a, int i, int j) {
        int t = a[i]; a[i] = a[j]; a[j] = t;
    }

    public static void main(String[] args) {
        System.out.println(findKthLargest(new int[]{3, 2, 1, 5, 6, 4}, 2));          // 5
        System.out.println(findKthLargest(new int[]{3, 2, 3, 1, 2, 4, 5, 5, 6}, 4)); // 4
    }
}
```

#### Python

```python
import random

def find_kth_largest(nums, k):
    """k-th largest (1-based). Expected O(n)."""
    a = nums[:]                 # copy; selection mutates
    target = len(a) - k         # (n-k)-th smallest, 0-based
    lo, hi = 0, len(a) - 1
    while lo < hi:
        p = partition(a, lo, hi)
        if p == target:
            return a[p]
        elif target < p:
            hi = p - 1
        else:
            lo = p + 1
    return a[lo]

def partition(a, lo, hi):
    idx = random.randint(lo, hi)
    a[idx], a[hi] = a[hi], a[idx]
    pivot, i = a[hi], lo - 1
    for j in range(lo, hi):
        if a[j] < pivot:
            i += 1
            a[i], a[j] = a[j], a[i]
    a[i + 1], a[hi] = a[hi], a[i + 1]
    return i + 1

if __name__ == "__main__":
    print(find_kth_largest([3, 2, 1, 5, 6, 4], 2))           # 5
    print(find_kth_largest([3, 2, 3, 1, 2, 4, 5, 5, 6], 4))  # 4
```

### Follow-up Discussion Points

- **Why a random pivot?** Without it, a sorted input forces O(n²); with it, expected O(n) on every input. Interviewers love asking what happens on already-sorted input.
- **Handle duplicates** (Example 2 has them): plain Lomuto still returns the correct value, but for many duplicates switch to a 3-way partition to keep balance and avoid O(n²).
- **Worst-case guarantee:** mention introselect / median-of-medians if asked to remove the O(n²) tail.
- **Streaming variant:** if the array does not fit in memory, switch to a size-k min-heap → O(n log k), O(k) memory.
- **Edge cases:** validate `1 <= k <= n`; single-element array; all-equal array.

---

## Coding Challenge 2: Top-k Frequent Elements

> Given an array `nums` and integer `k`, return the `k` most frequent elements (any order).
> Target **better than O(n log n)**: count frequencies, then **Quickselect on the (value, count) pairs by count** to isolate the top k — expected O(n).
>
> Example: `nums = [1,1,1,2,2,3], k = 2` → `[1, 2]`.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

func topKFrequent(nums []int, k int) []int {
	freq := map[int]int{}
	for _, x := range nums {
		freq[x]++
	}
	type pair struct{ val, cnt int }
	pairs := make([]pair, 0, len(freq))
	for v, c := range freq {
		pairs = append(pairs, pair{v, c})
	}
	// Quickselect so the k highest-count pairs end up at the end.
	target := len(pairs) - k
	lo, hi := 0, len(pairs)-1
	for lo < hi {
		idx := lo + rand.Intn(hi-lo+1)
		pairs[idx], pairs[hi] = pairs[hi], pairs[idx]
		pivot, i := pairs[hi].cnt, lo-1
		for j := lo; j < hi; j++ {
			if pairs[j].cnt < pivot {
				i++
				pairs[i], pairs[j] = pairs[j], pairs[i]
			}
		}
		pairs[i+1], pairs[hi] = pairs[hi], pairs[i+1]
		p := i + 1
		if p == target {
			break
		} else if target < p {
			hi = p - 1
		} else {
			lo = p + 1
		}
	}
	out := make([]int, 0, k)
	for i := len(pairs) - k; i < len(pairs); i++ {
		out = append(out, pairs[i].val)
	}
	return out
}

func main() {
	fmt.Println(topKFrequent([]int{1, 1, 1, 2, 2, 3}, 2)) // [1 2] (order may vary)
}
```

#### Java

```java
import java.util.*;

public class TopKFrequent {
    static final Random RNG = new Random();

    public static int[] topKFrequent(int[] nums, int k) {
        Map<Integer, Integer> freq = new HashMap<>();
        for (int x : nums) freq.merge(x, 1, Integer::sum);

        int[][] pairs = new int[freq.size()][2]; // {value, count}
        int idx = 0;
        for (var e : freq.entrySet()) pairs[idx++] = new int[]{e.getKey(), e.getValue()};

        int target = pairs.length - k, lo = 0, hi = pairs.length - 1;
        while (lo < hi) {
            int r = lo + RNG.nextInt(hi - lo + 1);
            swap(pairs, r, hi);
            int pivot = pairs[hi][1], i = lo - 1;
            for (int j = lo; j < hi; j++)
                if (pairs[j][1] < pivot) swap(pairs, ++i, j);
            swap(pairs, i + 1, hi);
            int p = i + 1;
            if (p == target) break;
            else if (target < p) hi = p - 1;
            else lo = p + 1;
        }
        int[] out = new int[k];
        for (int i = 0; i < k; i++) out[i] = pairs[pairs.length - 1 - i][0];
        return out;
    }

    static void swap(int[][] a, int i, int j) { int[] t = a[i]; a[i] = a[j]; a[j] = t; }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(topKFrequent(new int[]{1,1,1,2,2,3}, 2)));
    }
}
```

#### Python

```python
import random
from collections import Counter

def top_k_frequent(nums, k):
    pairs = list(Counter(nums).items())   # [(value, count), ...]
    target = len(pairs) - k
    lo, hi = 0, len(pairs) - 1
    while lo < hi:
        r = random.randint(lo, hi)
        pairs[r], pairs[hi] = pairs[hi], pairs[r]
        pivot, i = pairs[hi][1], lo - 1
        for j in range(lo, hi):
            if pairs[j][1] < pivot:
                i += 1
                pairs[i], pairs[j] = pairs[j], pairs[i]
        pairs[i + 1], pairs[hi] = pairs[hi], pairs[i + 1]
        p = i + 1
        if p == target:
            break
        elif target < p:
            hi = p - 1
        else:
            lo = p + 1
    return [v for v, _ in pairs[len(pairs) - k:]]

if __name__ == "__main__":
    print(top_k_frequent([1, 1, 1, 2, 2, 3], 2))  # [1, 2] (order may vary)
```

**Talking points:** counting is O(n); Quickselect over the distinct pairs is expected O(m) where m = number of distinct values ≤ n. Total expected O(n), beating the heap solution's O(n log k) when k is large relative to the number of distinct elements. If the interviewer wants streaming, pivot to a size-k heap of (count, value).

---

## Variations You Might Be Asked to Code

Selection shows up wearing many costumes. Recognize the disguise and map it back to "select rank k":

| Problem prompt | Reduction | Rank to select (0-based) |
|----------------|-----------|--------------------------|
| Kth largest element | select from the high end | `n - k` |
| Median of an array | one (or two) selections | `(n-1)//2` (and `n//2`) |
| K closest points to origin | select by squared distance | `k - 1`, take front |
| Kth largest by frequency | count, then select pairs by count | `m - k` over distinct pairs |
| Wiggle sort / quartile split | select the median, then 3-way partition | median rank |
| Top k frequent words | count + select (tie-break lexicographically) | `m - k` |
| Find the kth smallest in a sorted matrix | binary search on value + count (not Quickselect) | n/a — different technique |
| Kth smallest in a BST | in-order traversal counting (not Quickselect) | n/a — tree technique |

The last two are traps: when the data has *structure* (sorted rows, a BST), a structure-aware method beats Quickselect. State that distinction — interviewers reward knowing when **not** to reach for Quickselect.

### Mini-prompt: median of two sorted arrays

A famous hard variant. Quickselect is **not** the intended solution — the arrays are already sorted, so binary search on the partition point gives O(log(min(m, n))). Mention this to show you match the algorithm to the input's structure rather than reflexively applying Quickselect.

---

## Whiteboard Tips

- **State the one-line idea first:** "Quickselect is Quick Sort that recurses into only the side containing rank k, giving expected O(n)."
- **Nail the index convention out loud:** say whether `k` is 1-based or 0-based before writing code; convert at the boundary. Most interview bugs are here.
- **Write the partition you know cold** (Lomuto is easiest to get right under pressure). Mention Hoare only if asked.
- **Always use a random pivot** and explain why (avoids O(n²) on sorted input). It is a one-line change that impresses.
- **Mention the worst case proactively:** "O(n²) worst case; introselect/median-of-medians removes it." Shows depth.
- **Compare to the alternatives unprompted:** heap (O(n log k), streaming) and full sort (O(n log n)). Demonstrates judgment.
- **Test on the spot:** single element, k at both ends, duplicates, already-sorted input.

## Common Interview Pitfalls

| Pitfall | Consequence | Fix |
|---------|-------------|-----|
| Recursing into both sides | Accidentally wrote Quick Sort → O(n log n) | Recurse into one side only |
| First/last element as pivot | O(n²) on sorted input | Random pivot |
| 1-based vs 0-based mix-up | Off-by-one, returns neighbor | Convert k explicitly; comment it |
| `<=` in Lomuto on all-equal data | No shrink → infinite loop / O(n²) | Strict `<`; 3-way for duplicates |
| Forgetting input is mutated | Surprising upstream bugs | Copy first if caller needs order |
| Claiming worst-case O(n) for plain Quickselect | Wrong; it's O(n²) worst | Say "expected O(n); introselect for worst-case" |

---

## Final Checklist Before the Interview

Run through this list the night before:

- [ ] I can write Lomuto partition from memory, correctly, in under two minutes.
- [ ] I default to a **random pivot** and can explain why in one sentence.
- [ ] I recurse/loop into **one side only** and never accidentally write Quick Sort.
- [ ] I state my **k convention** (1-based vs 0-based) out loud and convert at the boundary.
- [ ] I can convert "k-th largest" to "(n-k)-th smallest" without hesitating.
- [ ] I know the complexities cold: **O(n) expected, O(n²) worst, O(n) introselect**.
- [ ] I can compare to a **heap** (streaming, O(n log k)) and a **full sort** (O(n log n)).
- [ ] I mention the **worst-case fix** (introselect / median-of-medians) proactively.
- [ ] I test single-element, all-equal, sorted, and k-at-the-ends cases.
- [ ] I remember Quickselect **mutates** the input and **does not** sort it.

If every box is checked, Quickselect questions — and their many disguises (k-th largest, top-k, median, k closest points) — are routine.

---

Next step: practice with [tasks.md](./tasks.md) to implement Quickselect, top-k, median-of-medians, and the streaming variants yourself.
