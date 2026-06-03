# Meet in the Middle (MITM) — Senior Level

> Meet in the middle is a precision instrument: it converts an intractable `O(2^n)` search into a feasible `O(2^(n/2))` one — but only over a narrow window of `n` (roughly 30–50), and only by paying `O(2^(n/2))` memory. At scale, every detail (the memory blow-up of the two half-lists, overflow in the sums, deduplication for counting, cache behavior of the combine, and whether DP or branch-and-bound would simply win) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [The Memory Wall: 2^(n/2) Lists in Practice](#2-the-memory-wall-2n2-lists-in-practice)
3. [When MITM Beats DP — and When It Loses](#3-when-mitm-beats-dp--and-when-it-loses)
4. [Branch-and-Bound: the Other Competitor](#4-branch-and-bound-the-other-competitor)
5. [Deduplication, Overflow, and Numeric Hazards](#5-deduplication-overflow-and-numeric-hazards)
6. [Cache Behavior and Combine Engineering](#6-cache-behavior-and-combine-engineering)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does split-and-combine work" but "is MITM actually the right tool, and what breaks when I scale it?". Meet in the middle shows up in three production guises that share one engine:

1. **Exact subset selection over a small set with huge values** — "is there a subset summing to `S`", "max subset sum `≤ capacity`", where `n ≤ ~45` and weights are too large for an `O(n·W)` table.
2. **Counting under a constraint** — "how many subsets sum to `S`", "how many are `≤ S`", which forces correct handling of duplicate sums.
3. **Search-space halving on graphs / groups** — bidirectional BFS and baby-step giant-step, where the same `√` speedup applies to path-finding and discrete logarithm.

All three reduce to: *enumerate two independent halves of size `2^(n/2)` (or `√(state space)`), store one as a list, and combine by sorting / hashing / two-pointer.* The senior-level decisions are: how to keep the half-lists in memory, how to keep the arithmetic exact and overflow-free, how to deduplicate when counting, how to make the combine cache-friendly, and — most importantly — how to recognize when a pseudo-polynomial DP or a branch-and-bound search would be strictly better than MITM.

This document treats those decisions in production terms.

---

## 2. The Memory Wall: 2^(n/2) Lists in Practice

### 2.1 The hard ceiling

MITM's time is `O(2^(n/2) · n)`, but its *space* is `O(2^(n/2))`, and space is the binding constraint. The per-half list holds `2^(n/2)` 64-bit integers:

| `n` | `2^(n/2)` entries | bytes (int64) | feasible? |
|-----|-------------------|---------------|-----------|
| 40 | ~1.05 M | ~8 MB | yes, trivially |
| 44 | ~4.2 M | ~33 MB | yes |
| 48 | ~16.8 M | ~134 MB | yes, watch GC |
| 50 | ~33.5 M | ~268 MB | borderline |
| 56 | ~268 M | ~2.1 GB | risky |
| 60 | ~1.07 G | ~8.6 GB | infeasible on most machines |

Beyond `n ≈ 50`, the two sorted lists (plus the bitmask companions if you reconstruct subsets) push memory past typical limits, and the GC/allocator overhead of multi-hundred-megabyte arrays dominates wall-clock time even before you run out of RAM. **MITM is a `30 ≤ n ≤ 50` technique.** State that bound explicitly in any design doc.

### 2.2 Splitting the split: 4-way MITM

When `n` creeps toward 50 and memory is tight, a partial mitigation is to split into **four** quarters instead of two halves. Enumerate each quarter (`2^(n/4)` each), combine quarters pairwise into two sorted half-lists *without materializing the full Cartesian product* by streaming a merge, and combine those. This keeps peak memory at `O(2^(n/4))` per quarter while preserving `O(2^(n/2) · n)`-ish time — at the cost of substantially more complex code. Reserve it for the cases where the straightforward two-way split just barely overflows memory.

### 2.3 Reconstruction doubles the cost

If you must report *which* items form the subset (not just that one exists), store the generating bitmask alongside each sum. That doubles the per-entry size (sum + mask) and, more importantly, prevents some compact representations. Budget for it: reconstruction roughly doubles memory and forces you to carry the mask through the sort.

### 2.4 Streaming the right half

The left half must be materialized (you sort or hash it). The **right half can be streamed**: generate each right sum on the fly and probe the left structure immediately, never storing the full right list. This halves peak memory — store only `sumsL`, iterate `sumsR` lazily. A standard and cheap win.

---

## 3. When MITM Beats DP — and When It Loses

The single most important senior judgment is choosing between MITM and pseudo-polynomial DP. Both solve subset-sum; they dominate in disjoint regimes.

### 3.1 The decision rule

```
Let n = item count, W = magnitude of target / total sum.

if n <= 20:                 brute force        (O(2^n), simplest)
elif W <= ~10^7:            DP over W          (O(n·W), insensitive to n)
elif n <= ~45:              MITM               (O(2^(n/2)), insensitive to W)
else:                       neither pure tool fits — branch-and-bound,
                            approximation, or problem-specific structure
```

- **DP wins when `W` is small.** The `O(n·W)` boolean/counting DP handles `n = 10000` effortlessly if `W ≤ 10^6`. MITM cannot touch this — it ignores `W` and pays `2^(n/2)`.
- **MITM wins when `W` is huge and `n` is small.** Weights up to `10^15` make the DP table un-allocatable; MITM is *insensitive to weight magnitude* and only cares that `n ≤ ~45`.
- **The danger zone** is large `n` *and* large `W` together — neither pure tool fits, and you fall back to branch-and-bound, FPTAS approximation, or exploiting special structure.

### 3.2 The crossover is about `W`, not just `n`

A frequent senior mistake is reaching for MITM by reflex on any subset-sum problem. Always ask first: **how big is `W`?** If the target and total are bounded by a few million, DP is simpler, faster, and uses less memory. MITM's whole reason to exist is *large values*; using it when DP would do is over-engineering that also burns more memory.

### 3.3 Counting changes the calculus

For *counting* subsets summing to `S`:
- DP gives exact counts in `O(n·W)` and handles overflow with a modulus naturally.
- MITM gives exact counts in `O(2^(n/2) · n)` but you must implement frequency-map combining carefully to handle duplicate sums.

If `W` is small, the counting DP is almost always the better engineering choice — fewer moving parts, no duplicate-handling subtlety.

### 3.4 A Worked Tool-Selection Walkthrough

Three real scenarios, same family of problem, three different answers:

**Scenario A — "Is there a subset of these 38 transaction amounts (each up to \$1,000,000.00, stored as integer cents up to `10^8`) summing to exactly the disputed total?"**
- `n = 38`, `W ≈ 38 × 10^8 ≈ 4 × 10^9`.
- DP table of `4 × 10^9` booleans = `4 GB` — too big.
- MITM: `2^19 ≈ 524K` per half (~4 MB), combine in milliseconds. **→ MITM.**

**Scenario B — "Count subsets of 2,000 item weights (each ≤ 5,000) summing to a target ≤ 100,000."**
- `n = 2000` (`2^1000` is absurd), `W = 100,000`.
- MITM impossible. DP: `n·W = 2 × 10^8` operations, `O(W)` memory. **→ DP.**

**Scenario C — "Find the max-value subset of 40 items fitting a knapsack of capacity `10^14`, weights up to `10^13`."**
- `n = 40`, huge capacity, optimization.
- DP table un-allocatable. Two choices: MITM (`2^20` per half, dominance-staircase combine, worst-case guarantee) or branch-and-bound (often faster on easy instances, `2^n` worst case). For a *worst-case SLA*, **→ MITM**; for *typical inputs with good bounds*, **→ B&B**.

The discriminator each time is the pair `(n, W)` plus whether a worst-case guarantee is required. Memorize the lattice: small `n` → brute; small `W` → DP; huge `W` + small `n` → MITM (decision/counting) or B&B (optimization, typical case).

---

## 4. Branch-and-Bound: the Other Competitor

For the *optimization* version (max subset sum `≤ capacity`, i.e. subset-sum knapsack), a well-tuned **branch-and-bound** (B&B) DFS with good pruning frequently beats MITM in practice on real instances, even though its worst case is `O(2^n)`.

### 4.1 Why B&B can win

B&B sorts items, then DFS-includes/excludes each, pruning a branch when:
- the partial sum already exceeds the capacity, or
- even taking *all* remaining items cannot beat the best found so far (a bound).

On structured or "easy" instances, these prunes cut the tree to a tiny fraction of `2^n`, finishing far faster than MITM's *unconditional* `2^(n/2)` enumeration. MITM has no early exit — it always builds both full half-lists.

### 4.2 When MITM still wins

B&B's worst case is the full `2^n` tree (adversarial instances with weak bounds). MITM's `2^(n/2)` is a *guaranteed* worst-case bound, not a best-case hope. For:
- adversarial / hard instances where B&B's pruning fails,
- decision/counting variants (not just optimization),
- `n` comfortably in the 35–45 window,

MITM's predictable square-root cost is the safer choice. The senior call: **B&B for typical optimization instances with good bounds; MITM when you need a worst-case guarantee or a counting/decision answer.** In contest settings with adversarial tests and `n ≈ 40`, MITM is the reliable pick.

---

## 5. Deduplication, Overflow, and Numeric Hazards

### 5.1 Overflow budget

Subset sums of `n` values each up to `V` reach `n·V`. For `n = 40` and `V = 10^15`, that is `4 × 10^16` — under `2^63 ≈ 9.2 × 10^18`, so `int64` is safe, but only barely. With larger `V` or `n` you can overflow. Mitigations:
- Use 64-bit throughout; in Go/Java the product/sum types must be `int64`/`long`.
- If sums can exceed `int64`, use 128-bit or big integers (with a real time cost), or reduce mod a prime if the problem permits.
- Negative weights are fine algebraically but disable the "prune negative complement" optimization.

### 5.2 Deduplication for counting

When **counting** subsets that hit `S`, duplicate sum *values* must be counted with multiplicity, not collapsed. A `set` silently undercounts. Use:
- a **frequency map** (`value → count`) for the left half, then for each right value `b` add `freqL[S − b]`;
- for `≤ S`, the **two-pointer suffix count** (sort both lists; never dedup — every entry is a distinct subset even if values collide).

Conversely, for **decision** (existence) you *may* dedup the list to shrink it (collapsing equal sums), which can meaningfully reduce memory when many subsets share sums (e.g. many zeros or repeated weights). Decision dedup good; counting dedup catastrophic.

### 5.3 Sorting stability and the bitmask companion

If you sort `(sum, mask)` pairs to reconstruct the subset, sort by `sum` only; the mask rides along. Do not let the mask perturb the order (it would still be correct for detection but confuses any "first match" reconstruction logic). Keep the comparison keyed strictly on the sum.

### 5.4 A Worked Dedup Disaster

Consider `arr = [0, 0, 0, 5]`, counting subsets summing to `5`. Split `L = [0, 0]`, `R = [0, 5]`.

```
sumsL = [0, 0, 0, 0]      (all four subsets of {0,0} sum to 0)
sumsR = [0, 5, 0, 5]      (subsets of {0,5}: {}, {5}, {0}, {0,5})
```

The subsets summing to `5` pair each left `0` with each right `5`. There are `4` left zeros and `2` right fives, so `4 × 2 = 8` subsets sum to `5`. The **frequency-map** combine gives `c_L(0) = 4`; for each right `5`, add `c_L(5 − 5) = c_L(0) = 4`; two rights with value `5` → `4 + 4 = 8` ✓. A **`set`-based** combine would store `setL = {0}` and, for each *distinct* right value `5`, check `0 ∈ setL` → true, counting just `1`. It misses the `8×` multiplicity by a factor of 8. Zeros and repeated weights are exactly where this bug bites hardest, and they are common in real data (free items, padding, duplicate SKUs). **Always frequency-map for counting.**

### 5.5 Verifying No Overflow Empirically

A cheap guardrail: track the running maximum absolute sum during enumeration and assert it stays well below `2^63`.

```python
def subset_sums_guarded(items):
    out = [0]
    LIMIT = (1 << 62)              # leave headroom below 2^63
    for x in items:
        out += [s + x for s in out]
        if out and max(abs(out[-1]), abs(out[0])) > LIMIT:
            raise OverflowError("subset sums exceed safe int64 range; use 128-bit/bigint")
    return out
```

This fails loudly the moment sums approach the danger zone, converting a silent wraparound bug into an explicit, debuggable error — far better than a wrong match discovered weeks later in production.

---

## 6. Cache Behavior and Combine Engineering

`2^(n/2)` can be tens of millions of entries; how you touch that memory dominates wall-clock time.

### 6.1 Sort + two-pointer is cache-friendly; hashing is not

- **Two contiguous sorted arrays swept by two pointers** stream memory linearly — near-perfect cache behavior. This is the fastest combine for counting at large `n`.
- **A hash set of `2^(n/2)` entries** has random-access probes that thrash the cache once the table exceeds L2/L3. For `n ≥ 44` the hash combine, while `O(2^(n/2))` in theory, can be slower in practice than the sorted two-pointer because of cache misses.

Senior guidance: at large `n`, prefer **sorted arrays + two-pointer / binary search** over hashing for the combine, despite hashing's better asymptotic constant on paper. The cache effects invert the ranking.

A quick way to confirm this on your own hardware:

```python
import time, random

def bench_combine(n, seed=1):
    r = random.Random(seed)
    arr = [r.randint(1, 10**12) for _ in range(n)]
    mid = n // 2
    def sums(items):
        out = [0]
        for x in items:
            out += [s + x for s in out]
        return out
    left, right = sums(arr[:mid]), sums(arr[mid:])
    S = sum(arr) // 2
    # hash combine
    t0 = time.perf_counter()
    setL = set(left)
    _ = any((S - b) in setL for b in right)
    t_hash = time.perf_counter() - t0
    # sort + two-pointer combine
    t0 = time.perf_counter()
    left.sort(); right.sort()
    i, j = 0, len(right) - 1
    while i < len(left) and j >= 0:
        s = left[i] + right[j]
        if s == S: break
        if s < S: i += 1
        else: j -= 1
    t_sort = time.perf_counter() - t0
    return t_hash, t_sort

# Run for n in {32, 40, 44}; watch the sorted combine overtake hashing as n grows.
```

The crossover where the sorted combine wins is hardware-dependent (cache size) but typically appears around `n = 42–46`. Measure on your target machine rather than trusting the asymptotic constant.

### 6.2 Incremental enumeration

Build each half-list by **doubling**: start with `[0]`, and for each item append `(existing + item)`. This is `O(2^(n/2))` total and writes sequentially (cache-friendly), versus the per-mask inner loop at `O(2^(n/2) · n/2)` with strided reads. Always enumerate incrementally.

### 6.3 Flat arrays, not arrays-of-structs

Store sums as a flat primitive array (`[]int64` / `long[]`), not boxed objects. For reconstruction, keep a *parallel* `[]int` mask array rather than an array of `(sum, mask)` structs — better cache density and less GC pressure. Sort with an index permutation if you need both arrays aligned.

### 6.4 Parallelism

The two halves are independent — enumerate and sort them on two threads. The combine sweep is sequential but the *probe loop* (for each right value, binary-search left) parallelizes trivially across right values. For 4-sum, the two pair-enumerations are independent. MITM is embarrassingly parallel up to the final reduction.

---

## 7. Code Examples

### 7.1 Go — memory-lean MITM: materialize left, stream right

```go
package main

import (
	"fmt"
	"sort"
)

// maxSubsetLeq returns the maximum subset sum that is ≤ capacity (knapsack, huge weights).
func maxSubsetLeq(arr []int64, cap int64) int64 {
	mid := len(arr) / 2

	// Materialize and sort ONLY the left half.
	left := []int64{0}
	for _, x := range arr[:mid] {
		cur := append([]int64(nil), left...)
		for _, s := range cur {
			left = append(left, s+x)
		}
	}
	sort.Slice(left, func(i, j int) bool { return left[i] < left[j] })

	best := int64(-1)
	// Stream the right half: generate each right sum, probe left, never store full right list.
	var rec func(idx int, sum int64)
	rec = func(idx int, sum int64) {
		if idx == len(arr) {
			if sum <= cap {
				// largest left value with left[i] <= cap - sum
				room := cap - sum
				lo, hi := 0, len(left)-1
				k := -1
				for lo <= hi {
					m := (lo + hi) / 2
					if left[m] <= room {
						k = m
						lo = m + 1
					} else {
						hi = m - 1
					}
				}
				if k >= 0 && sum+left[k] > best {
					best = sum + left[k]
				}
			}
			return
		}
		rec(idx+1, sum)            // exclude
		rec(idx+1, sum+arr[idx])   // include
	}
	rec(mid, 0)
	return best
}

func main() {
	arr := []int64{15, 34, 4, 12, 5, 2}
	fmt.Println(maxSubsetLeq(arr, 20)) // best subset sum not exceeding 20
}
```

### 7.2 Java — exact counting with a frequency map (dedup-correct)

```java
import java.util.*;

public class CountExact {

    static long[] subsetSums(long[] items) {
        long[] out = {0};
        for (long x : items) {
            long[] cur = Arrays.copyOf(out, out.length * 2);
            for (int i = 0; i < out.length; i++) cur[out.length + i] = out[i] + x;
            out = cur;
        }
        return out;
    }

    // Count subsets summing to exactly S, handling duplicate sums with multiplicity.
    static long countExact(long[] arr, long S) {
        int mid = arr.length / 2;
        long[] left = subsetSums(Arrays.copyOfRange(arr, 0, mid));
        long[] right = subsetSums(Arrays.copyOfRange(arr, mid, arr.length));
        HashMap<Long, Long> freq = new HashMap<>();
        for (long a : left) freq.merge(a, 1L, Long::sum);
        long count = 0;
        for (long b : right) count += freq.getOrDefault(S - b, 0L);
        return count;
    }

    public static void main(String[] args) {
        long[] arr = {3, 1, 1, 2, 2, 3};
        System.out.println(countExact(arr, 4)); // counts ALL subsets summing to 4
    }
}
```

### 7.3 Python — bidirectional BFS (MITM on a graph)

```python
from collections import deque


def bidirectional_bfs(adj, src, dst):
    """Shortest unweighted distance src->dst via two frontiers meeting in the middle."""
    if src == dst:
        return 0
    df = {src: 0}                      # forward distances
    db = {dst: 0}                      # backward distances
    ff, bf = deque([src]), deque([dst])
    while ff and bf:
        # Always expand the smaller frontier (balances work).
        if len(ff) <= len(bf):
            for _ in range(len(ff)):
                u = ff.popleft()
                for v in adj[u]:
                    if v in db:
                        return df[u] + 1 + db[v]
                    if v not in df:
                        df[v] = df[u] + 1
                        ff.append(v)
        else:
            for _ in range(len(bf)):
                u = bf.popleft()
                for v in adj[u]:        # assumes undirected; use reverse adj if directed
                    if v in df:
                        return db[u] + 1 + df[v]
                    if v not in db:
                        db[v] = db[u] + 1
                        bf.append(v)
    return -1


if __name__ == "__main__":
    adj = {0: [1, 2], 1: [0, 3], 2: [0, 3], 3: [1, 2, 4], 4: [3]}
    print(bidirectional_bfs(adj, 0, 4))  # 3
```

### 7.4 Go — branch-and-bound for comparison (the MITM alternative)

```go
package main

import (
	"fmt"
	"sort"
)

// bestKnapsack: max subset sum ≤ cap via branch-and-bound (the competitor to MITM).
func bestKnapsack(w []int64, cap int64) int64 {
	// Sort descending so the bound prunes early.
	sort.Slice(w, func(i, j int) bool { return w[i] > w[j] })
	// suffix[i] = sum of w[i:]  (upper bound on what remains)
	suffix := make([]int64, len(w)+1)
	for i := len(w) - 1; i >= 0; i-- {
		suffix[i] = suffix[i+1] + w[i]
	}
	best := int64(0)
	var dfs func(i int, sum int64)
	dfs = func(i int, sum int64) {
		if sum > best {
			best = sum
		}
		if i == len(w) {
			return
		}
		// Bound: even taking all remaining cannot beat best → prune.
		if sum+suffix[i] <= best {
			return
		}
		if sum+w[i] <= cap { // include w[i]
			dfs(i+1, sum+w[i])
		}
		dfs(i+1, sum) // exclude w[i]
	}
	dfs(0, 0)
	return best
}

func main() {
	fmt.Println(bestKnapsack([]int64{15, 34, 4, 12, 5, 2}, 20)) // 20 ({15,5})
}
```

This B&B finishes in microseconds on easy instances by pruning, but its worst case is the full `2^n` tree — exactly the trade-off discussed in Section 4. Run it alongside the MITM version (7.1) and compare on both random and adversarial inputs to see when each wins.

---

## 8. Observability and Testing

A MITM result is opaque — one wrong count or a missed subset looks like any other number. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force oracle on small `n` (`≤ 18`) | Catches the empty-subset bug, the split off-by-one, and combine errors. |
| Half-list size assertion (`len == 2^|half|`) | Confirms enumeration produced every subset (no early termination). |
| Empty subset present (`0 ∈ sumsL` and `0 ∈ sumsR`) | The empty subset is valid; missing it breaks targets reachable by one empty half. |
| Counting vs detection cross-check | Count via frequency map ≥ 1 whenever detection says "exists." |
| Overflow guard | Assert sums stay within `int64`; log `max|sum|` vs `2^63`. |
| Symmetry of split | Swapping which half is sorted/streamed must give the same answer. |
| Determinism across languages | Same input → identical Go/Java/Python output. |

The single most valuable test is the **brute-force oracle**: enumerate all `2^n` subsets directly for `n ≤ 18` and compare existence/count/closest entrywise. It catches the overwhelming majority of bugs.

### 8.1 A property-test battery

```text
for random small array (n ≤ 16), random target S:
    assert mitm_exists(arr, S)      == brute_exists(arr, S)
    assert mitm_count_exact(arr, S) == brute_count_exact(arr, S)
    assert mitm_count_leq(arr, S)   == brute_count_leq(arr, S)
    assert mitm_max_leq(arr, S)     == brute_max_leq(arr, S)
    assert 0 in subset_sums(left) and 0 in subset_sums(right)   # empty subset
for BSGS:
    assert a^bsgs(a,b,p) % p == b   # round-trip the discrete log
```

These invariants, run on a few hundred random instances, give high confidence. The exact-count test is especially good at catching a `set`-based combine that silently collapses duplicate sums.

### 8.2 Production guardrails

For a service answering subset-sum queries at scale, add: a **memory estimate** (`2^(n/2) · 8` bytes) logged and checked against a budget before allocating; an **`n`-bound validator** that rejects `n > 50` with a clear "use DP/B&B instead" error; and a **round-trip assertion** (for BSGS / discrete log, verify `a^x ≡ b`) so an anomalous answer fails loudly rather than silently.

---

## 9. Failure Modes

### 9.1 Memory blow-up at large `n`

Running MITM at `n = 58` allocates two `~5 GB` lists and either OOMs or thrashes. Mitigation: enforce the `n ≤ ~50` bound; stream the right half; use 4-way split if marginally over; otherwise switch tools.

### 9.2 Silent counting error via `set`

Using a `set` (not a frequency map) for the left list when *counting* collapses duplicate sums, undercounting. Symptom: counts wrong only when weights repeat or many subsets share a sum. Mitigation: frequency map for counting; reserve `set` for detection-only dedup.

### 9.3 Overflow in the sums

Subset sums exceed `int32` (or even `int64` for extreme inputs) and wrap to garbage, producing wrong matches. Mitigation: `int64` everywhere, assert against `2^63`, escalate to 128-bit/bigint when needed.

### 9.4 Wrong tool: MITM where DP wins

Reaching for MITM when `W` is small wastes memory and time versus the simpler `O(n·W)` DP. Mitigation: check `W` first; only use MITM when values are huge and `n ≤ ~45`.

### 9.5 Wrong tool: MITM where B&B wins

For *optimization* on easy instances, MITM's unconditional `2^(n/2)` enumeration is slower than a well-pruned branch-and-bound that finishes in microseconds. Mitigation: for optimization with good bounds, try B&B first; keep MITM as the worst-case-guarantee fallback.

### 9.6 Unbalanced split

Splitting `n = 40` as `30 + 10` leaves a `2^30` half that defeats the technique. Mitigation: always split `⌈n/2⌉ / ⌊n/2⌋`.

### 9.7 Bidirectional BFS correctness traps

Expanding only one side (loses the `√` speedup), or stopping on the first edge-touch without level discipline (returns a non-shortest path), or using forward adjacency for the backward search on a *directed* graph (wrong frontier). Mitigation: expand the smaller frontier, advance level by level and check all meetings at the meeting level, and use the *reverse* adjacency for the backward BFS on directed graphs.

### 9.8 BSGS on non-coprime base

Baby-step giant-step assumes `gcd(a, p) = 1` (and a known group order). On composite moduli or when `a` shares a factor with the modulus, the basic algorithm fails. Mitigation: use the extended BSGS variant that factors out common divisors, or restrict to prime moduli with primitive roots.

---

## 10. Summary

- MITM converts `O(2^n)` into `O(2^(n/2) · n)` time but pays `O(2^(n/2))` **memory** — the binding constraint that caps the technique at roughly `n ≤ 50`. Know and state that bound.
- The most important senior judgment is **tool selection**: brute force for `n ≤ 20`; pseudo-polynomial DP when `W` is small (insensitive to `n`); MITM when `W` is huge and `n ≤ ~45` (insensitive to `W`); branch-and-bound for optimization with good bounds; and "neither" when `n` and `W` are both large.
- **Counting** demands a frequency map (exact) or a two-pointer suffix sweep (`≤ S`); a `set` silently undercounts duplicates. **Detection** may dedup to save memory.
- **Overflow** is a real hazard: `int64` is usually but not always enough; assert against `2^63` and escalate to 128-bit/bigint when sums can exceed it.
- **Cache behavior** inverts the textbook ranking at large `n`: sorted arrays + two-pointer beat hashing because hash probes thrash the cache once the table exceeds L2/L3. Enumerate incrementally, store flat primitive arrays, and stream the right half to halve peak memory.
- The same `√` idea recurs as **bidirectional BFS** (`O(b^d) → O(b^(d/2))`, expand the smaller frontier, level discipline, reverse adjacency for directed) and **baby-step giant-step** (`O(p) → O(√p)`, needs `gcd(a,p)=1`).
- Always keep a **brute-force oracle**; it catches the empty-subset bug, the split off-by-one, the duplicate-counting mistake, and the overflow that together account for nearly every real bug.

### Decision summary

- **`n ≤ 20`** → brute force.
- **Small `W`** → `O(n·W)` DP (works for huge `n`).
- **Huge `W`, `n ≤ ~45`, decision/counting** → MITM (worst-case `O(2^(n/2))` guarantee).
- **Optimization, typical instances, good bounds** → branch-and-bound; MITM as worst-case fallback.
- **Shortest path, start and goal known** → bidirectional BFS.
- **Discrete log over a coprime base** → baby-step giant-step.
- **`n ≥ 60`** → neither pure tool; approximation, structure, or rethink.

References to study further: Horowitz-Sahni (1974) for the original subset-sum MITM; Schroeppel-Shamir for the `O(2^(n/2))`-time `O(2^(n/4))`-space refinement; Shanks' baby-step giant-step for discrete log; Pohlig-Hellman for composite-order groups; and the branch-and-bound knapsack literature. Sibling topics: `02-binary-search`, `12-dynamic-programming` (`knapsack`), and graph search (`bidirectional BFS`).

