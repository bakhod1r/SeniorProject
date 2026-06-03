# Matrix Chain Multiplication (MCM) — Senior Level

> The textbook `O(n³)` MCM is rarely the hard part. The senior reality is that the *same* interval-DP shape governs database join ordering, tensor-contraction planning, and any associative-reduction scheduler — and in those settings the cost model is estimated (not exact), `n` can be large, the operation generalizes from a chain to a tree, and a wrong order is a real latency or out-of-memory incident, not a wrong answer.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Production Cost Models Beyond p·q·r](#2-production-cost-models-beyond-pqr)
3. [Join-Order Optimization as Generalized MCM](#3-join-order-optimization-as-generalized-mcm)
4. [Tensor Contraction Ordering](#4-tensor-contraction-ordering)
5. [When n Is Large: Heuristics and Sub-Cubic Methods](#5-when-n-is-large-heuristics-and-sub-cubic-methods)
6. [Memory Engineering](#6-memory-engineering)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is the recurrence" but "what am I actually scheduling, and what breaks when I scale it?" Matrix Chain Multiplication shows up in three production guises that look different but share one engine:

1. **Literal matrix/tensor chains** — numerical and ML pipelines that multiply a fixed sequence of matrices many times; the optimal order, computed once, is reused across millions of evaluations.
2. **Relational join ordering** — a SQL query joining `n` tables is an associative chain whose intermediate sizes (and thus cost) depend on order; the optimizer runs an interval DP to pick the cheapest plan.
3. **General associative-reduction scheduling** — merging sorted runs, concatenating ropes, combining partial aggregates — anywhere combining two partials has a size-dependent cost.

All three reduce to: *define a cost for combining two adjacent (or, in the tree case, any two) sub-results, then choose the combination order that minimizes total cost via an interval (or subset) DP.* The senior decisions are: what cost model to use, how large `n` can get before `O(n³)` (or `O(2ⁿ)` for trees) fails, how to keep the tables in memory, and how to verify a planner whose "correct" answer is defined only by a cost estimate.

This document treats those decisions in production terms. The recurring theme: the `O(n³)` recurrence is the easy part; the hard part is choosing the cost model, recognizing whether the operation is commutative, picking the right objective (FLOPs vs memory), and verifying a planner whose "correct" answer is only as good as its cost estimates.

---

## 2. Production Cost Models Beyond p·q·r

The classic `p·q·r` counts scalar multiplications under the *schoolbook* algorithm. Real systems rarely care about that exact number; they care about wall-clock time or memory, which the scalar count only approximates.

### 2.1 What the schoolbook model ignores

- **Sub-cubic multiply.** Strassen and successors multiply `m×m` matrices in `O(m^2.807)` and below. Under such a kernel the per-multiply cost is no longer `p·q·r`, so the *optimal order can differ* from the schoolbook optimum. If your runtime uses Strassen for large blocks, feed the DP the kernel's actual cost function, not `p·q·r`.
- **Cache and memory bandwidth.** A multiply that fits in L2 is far cheaper per FLOP than one that streams from DRAM. Two orders with equal scalar counts can differ several-fold in time.
- **Parallelism.** On a GPU, a few large multiplies often beat many small ones because launch overhead dominates; the scalar-optimal order may under-utilize the device.
- **Numerical conditioning.** Different orders accumulate floating-point error differently. For ill-conditioned chains, the cheapest order may not be the most accurate; some pipelines deliberately choose a costlier, better-conditioned order.

### 2.2 Plugging a custom cost into the DP

The interval DP is agnostic to the cost function. Replace the term `p[i-1]·p[k]·p[j]` with `combineCost(shape(i,k), shape(k+1,j))` where `combineCost` encodes your real model (FLOPs under Strassen, estimated rows for a join, bytes moved). The recurrence, fill order, and reconstruction are unchanged. **The single most valuable senior habit is to parameterize the DP by the cost function** so the same tested skeleton serves matrices, joins, and tensors.

### 2.3 Estimated vs exact costs

For matrices the shapes are known exactly, so `p·q·r` is exact. For joins the "shape" is an estimated cardinality from statistics/histograms, which can be wildly wrong; the DP then optimizes an *estimate*, and a good plan under a bad estimate can be a disaster. This is why query optimizers pair the DP with cardinality-estimation quality monitoring and runtime re-optimization — the algorithm is only as good as its cost inputs.

### 2.4 A concrete cost-model failure

Consider a chain where two orders have *identical* scalar-multiplication counts but very different runtimes. Order A does its largest multiply on a `2000×2000` intermediate that spills L3 cache and streams from DRAM; order B does an equal-FLOP multiply on a `200×20000` intermediate that, although the same scalar count, has far worse temporal locality. The schoolbook DP rates them equal; the runtime does not. The lesson: when the binding resource is bandwidth or cache rather than raw FLOPs, the `p·q·r` model is a *proxy* whose ranking can disagree with reality. A production planner that matters should either (a) calibrate `combineCost` against measured kernel timings, or (b) accept that the DP gives a *good* plan, not necessarily *the* fastest, and leave final tuning to an autotuner.

### 2.5 Why we still default to p·q·r

Despite all the caveats, `p·q·r` is the right default for most code. It is exact for the schoolbook kernel, requires no profiling, is monotone and well-behaved (so the DP is stable), and produces plans that are usually within a small factor of the true optimum even under a more complex kernel. Reach for a custom `combineCost` only when measurement shows the schoolbook ranking is materially wrong — premature cost-model sophistication is a classic over-engineering trap.

---

## 3. Join-Order Optimization as Generalized MCM

A query `R₁ ⋈ R₂ ⋈ ⋯ ⋈ Rₙ` is the canonical production MCM.

### 3.1 Linear chains vs bushy trees

Pure MCM assumes the matrices keep their *original adjacency* — you may only combine contiguous sub-chains. For joins, the join graph may allow **any** subset of relations to be joined (a "bushy" plan), not just contiguous ones, because join is commutative as well as associative. This generalizes the interval DP (state = contiguous range, `O(n²)` states) to a **subset DP** (state = subset of relations, `O(2ⁿ)` states) — the System R / Selinger algorithm.

| Plan space | State | DP cost | Used by |
|------------|-------|---------|---------|
| Left-deep only | sequence position | `O(n·2ⁿ)` | classic Selinger |
| Bushy (all subsets) | subset of relations | `O(3ⁿ)` | full DPccp |
| Contiguous chain (no reordering) | interval `[i,j]` | `O(n³)` | literal MCM |

The literal-MCM interval DP is the **special case** where reordering is forbidden. When commutativity is allowed, the cheaper interval DP no longer suffices and you pay the exponential subset DP — which is why optimizers cap `n` (e.g., switch to greedy/genetic heuristics past ~12 relations).

### 3.2 The cost function for joins

`combineCost(S, T)` ≈ estimated cardinality of `S ⋈ T` times a per-tuple constant, where cardinality is derived from selectivities and table statistics. The DP minimizes total estimated cost over plans. Crucially the "dimension array" analog (cardinalities) is *uncertain*, so robustness to estimation error matters as much as the DP itself.

### 3.3 Why the senior takeaway is "know the boundary"

The interval DP (`O(n³)`) is correct only when reordering is disallowed (true matrix chains). The moment the operation is also commutative (joins, addition trees), you are in subset-DP territory and must bound `n` or switch to heuristics. Misapplying the cheap interval DP to a commutative problem silently leaves better (bushy) plans on the table.

---

## 4. Tensor Contraction Ordering

Contracting a tensor network (einsum, tensor trains, attention computations) generalizes MCM from a chain to a graph.

### 4.1 The contraction-path problem

Each tensor is a node; shared indices are edges. Contracting two tensors costs the product of all involved index dimensions and yields a new tensor whose shape drops the contracted indices. Choosing the order (the *contraction path*) determines intermediate sizes — the dominant factor in both FLOPs and peak memory. For a 1-D chain (matrix-train), this is exactly MCM. For general networks it is NP-hard, and libraries (`opt_einsum`, `cotengra`) use a mix of exact DP for small networks and heuristics (greedy, simulated annealing, graph-partitioning) for large ones.

### 4.2 FLOPs vs peak memory

The MCM objective is total FLOPs. In ML the binding constraint is often **peak memory** (the largest intermediate must fit in VRAM), a different objective: you might accept more FLOPs to keep the largest intermediate small. The interval DP generalizes — replace "sum of costs, minimized" with "max intermediate size, minimized" (a min-max DP) — but the two optima differ, so be explicit about which you want.

### 4.3 Reuse across evaluations

A contraction path (or matrix-chain order) is computed once and reused across every forward/backward pass. The `O(n³)` planning cost amortizes to zero against millions of executions, so spending more on planning (even exhaustive search for small `n`) is almost always worth it. This is the inverse of the typical "the algorithm runs once per input" assumption — here the *plan* is the product.

### 4.4 Path caching and signature keys

Because the path depends only on the *shapes* (and which indices are shared), not on the tensor contents, cache the computed path keyed by a *shape signature* — a hashable tuple of dimensions and the contraction pattern. In a training loop the same einsum shape recurs every iteration; recomputing the path each time is pure waste. Libraries like `opt_einsum` expose exactly this: build the path once, then call `contract` with the cached path object. The same pattern applies to literal matrix chains in a hot loop — key the optimal order by the dimension array and reuse it.

### 4.5 Greedy paths in practice

For tensor networks too large for exact DP, the default production heuristic is *greedy*: repeatedly contract the pair whose result is smallest (or whose cost is lowest) until one tensor remains. Greedy is `O(m² log m)` with a heap and, while not optimal, is usually within a small factor and dramatically faster to plan. `opt_einsum` uses greedy by default above a node-count threshold and falls back to exhaustive/DP only for small networks — a direct analog of the matrix-chain "DP for small `n`, heuristic for large `n`" rule.

---

## 5. When n Is Large: Heuristics and Sub-Cubic Methods

### 5.1 Hu-Shing O(n log n) for the literal chain

For a true (non-commutative, contiguous) matrix chain, Hu & Shing's algorithm solves MCM in `O(n log n)` by mapping it to minimum-weight convex-polygon triangulation and peeling triangles around minimum-weight vertices. It is the asymptotically optimal exact method but intricate to implement; reach for it only when `n` is large enough (thousands) that the `O(n³)` DP's runtime is the bottleneck — uncommon for matrix chains, more plausible for very long tensor trains.

### 5.2 Greedy heuristics

A cheap, often-good heuristic: repeatedly perform the *currently cheapest* adjacent multiply (or, for joins, greedily pick the smallest-result join) until one matrix remains. This is `O(n²)` or `O(n log n)` with a heap and gives plans typically within a small factor of optimal. Production planners frequently use greedy or randomized greedy as a fast fallback past the DP's feasibility limit.

### 5.3 Branch-and-bound and beam search

For commutative (join/tensor) problems where the subset DP's `O(3ⁿ)` is infeasible past ~15 nodes, branch-and-bound with a good lower bound, or beam search keeping the `b` best partial plans, trades optimality for tractability. The DP remains the gold standard to validate the heuristic on small instances.

### 5.4 Decision guide

| Situation | Method | Cost |
|-----------|--------|------|
| Literal matrix chain, `n` ≤ few thousand | interval DP | `O(n³)` |
| Literal matrix chain, `n` large | Hu-Shing | `O(n log n)` |
| Commutative joins, `n` ≤ ~12 | subset DP (Selinger/DPccp) | `O(3ⁿ)` |
| Commutative joins/tensors, `n` large | greedy / branch-and-bound / annealing | poly to exponential, no guarantee |
| Need peak-memory-optimal (tensors) | min-max interval/subset DP | same shape, different objective |

---

## 6. Memory Engineering

### 6.1 Table footprint

The `dp` and `split` tables are each `O(n²)`. With `int64` entries that is `8n²` bytes per table — 80 KB for `n = 100`, 8 MB for `n = 1000`, 800 MB for `n = 10000`. Past a few thousand matrices the `O(n²)` memory, not the `O(n³)` time, can be the first wall.

### 6.2 Half-table storage

Only the upper triangle `i ≤ j` is ever used. Packing into a triangular array halves memory and improves cache locality. For huge `n` this is the difference between fitting in RAM and not.

### 6.3 Cost-only mode

If only the minimum cost is needed (not the parenthesization), drop the `split` table entirely — half the memory. Many planners first compute cost to decide *whether* to optimize, then reconstruct only if worthwhile.

### 6.4 Streaming reconstruction

Reconstruction reads the split table in `O(n)`; it does not need the `dp` table. If `dp` was computed in cost-only mode, recompute `split` lazily or store only the diagonal bands actually consulted. For most `n` this is over-engineering; it matters only at the extreme scale where `n²` tables dominate the memory budget.

### 6.5 Cache behavior of the fill order

The standard fill order (`L`, then `i`, then `k`) accesses `dp[i][k]` along a row and `dp[k+1][j]` along a column for each cell. The column access is the cache-unfriendly one. For large `n`, storing the table in a layout that makes the inner-loop reads contiguous — or transposing one of the operands' access patterns — measurably improves throughput. With a triangular flat array (Section 6.2) you control the exact memory layout, which is the main reason to prefer it beyond the memory saving. Below a few hundred matrices the whole table fits in L2 and none of this matters; the optimization is purely for the rare large-`n` regime.

### 6.6 Recomputation vs storage trade-off

A subtle option for memory-extreme cases: store only the `dp` *diagonal bands* of length up to some window `W`, and for the split table store nothing — instead, when reconstructing, recompute each needed `argmin` on demand from the (windowed) `dp` values. This trades reconstruction time (now `O(n²)` instead of `O(n)`) for `O(nW)` memory instead of `O(n²)`. It is a niche technique, justified only when `n` is so large that the `O(n²)` split table will not fit but the cost still must be computed. For essentially all real matrix chains, store both tables and move on.

---

## 7. Code Examples

### 7.1 Go — cost-function-parameterized interval DP

```go
package main

import (
	"fmt"
	"math"
)

// CombineCost returns the cost of the final multiply combining
// left sub-chain [i..k] with right sub-chain [k+1..j].
type CombineCost func(p []int, i, k, j int) int64

// Schoolbook p·q·r model.
func schoolbook(p []int, i, k, j int) int64 {
	return int64(p[i-1]) * int64(p[k]) * int64(p[j])
}

func chainDP(p []int, cost CombineCost) (int64, [][]int) {
	n := len(p) - 1
	dp := make([][]int64, n+1)
	split := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int64, n+1)
		split[i] = make([]int, n+1)
	}
	for L := 2; L <= n; L++ {
		for i := 1; i+L-1 <= n; i++ {
			j := i + L - 1
			dp[i][j] = math.MaxInt64
			for k := i; k < j; k++ {
				c := dp[i][k] + dp[k+1][j] + cost(p, i, k, j)
				if c < dp[i][j] {
					dp[i][j] = c
					split[i][j] = k
				}
			}
		}
	}
	return dp[1][n], split
}

func main() {
	p := []int{40, 20, 30, 10, 30}
	cost, _ := chainDP(p, schoolbook)
	fmt.Println("schoolbook optimum:", cost) // 26000
	// Swap in a different cost model by passing another CombineCost.
}
```

### 7.2 Java — half-table (triangular) storage for large n

```java
public class MCMTriangular {
    // Pack upper-triangular dp[i][j] (1<=i<=j<=n) into a flat array.
    static int idx(int i, int j, int n) {
        // offset of row i plus (j-i)
        return i * (n + 1) + j;
    }

    static long solve(int[] p) {
        int n = p.length - 1;
        long[] dp = new long[(n + 1) * (n + 1)];
        for (int L = 2; L <= n; L++) {
            for (int i = 1; i + L - 1 <= n; i++) {
                int j = i + L - 1;
                long best = Long.MAX_VALUE;
                long pi = p[i - 1], pj = p[j];
                for (int k = i; k < j; k++) {
                    long c = dp[idx(i, k, n)] + dp[idx(k + 1, j, n)]
                            + pi * p[k] * pj;
                    if (c < best) best = c;
                }
                dp[idx(i, j, n)] = best;
            }
        }
        return dp[idx(1, n, n)];
    }

    public static void main(String[] args) {
        int[] p = {40, 20, 30, 10, 30};
        System.out.println("min cost: " + solve(p)); // 26000
    }
}
```

### 7.3 Python — peak-memory-optimal (min-max) variant for tensors

```python
import math


def mcm_min_flops(p):
    """Minimize total scalar multiplications (classic MCM)."""
    n = len(p) - 1
    dp = [[0] * (n + 1) for _ in range(n + 1)]
    for L in range(2, n + 1):
        for i in range(1, n - L + 2):
            j = i + L - 1
            dp[i][j] = min(
                dp[i][k] + dp[k + 1][j] + p[i - 1] * p[k] * p[j]
                for k in range(i, j)
            )
    return dp[1][n]


def mcm_min_peak(p):
    """Minimize the largest intermediate matrix size (a peak-memory proxy)."""
    n = len(p) - 1
    dp = [[0] * (n + 1) for _ in range(n + 1)]
    for L in range(2, n + 1):
        for i in range(1, n - L + 2):
            j = i + L - 1
            best = math.inf
            for k in range(i, j):
                # peak of this plan = max(peak left, peak right, size of result)
                result_size = p[i - 1] * p[j]
                peak = max(dp[i][k], dp[k + 1][j], result_size)
                best = min(best, peak)
            dp[i][j] = best
    return dp[1][n]


if __name__ == "__main__":
    p = [40, 20, 30, 10, 30]
    print("min FLOPs optimum:", mcm_min_flops(p))   # 26000
    print("min peak-size optimum:", mcm_min_peak(p))  # different objective
```

The min-FLOPs and min-peak optima generally differ — proof that "the optimal order" is objective-dependent, the central senior caveat for tensor work.

### 7.4 Go — greedy fallback for large n

When `n` exceeds the DP's feasibility window, a greedy heuristic produces a good plan fast. This repeatedly performs the cheapest currently-available adjacent multiply.

```go
package main

import "fmt"

// greedyOrder repeatedly merges the adjacent pair with the smallest
// immediate multiply cost. Not optimal, but O(n^2) and usually close.
func greedyCost(dims []int) int64 {
	// dims is a mutable copy of p; we collapse adjacent entries.
	d := append([]int(nil), dims...)
	var total int64
	for len(d) > 2 {
		bestI, bestCost := 1, int64(-1)
		for i := 1; i < len(d)-1; i++ {
			c := int64(d[i-1]) * int64(d[i]) * int64(d[i+1])
			if bestCost < 0 || c < bestCost {
				bestCost = c
				bestI = i
			}
		}
		total += bestCost
		// collapse matrices (bestI-1, bestI) -> remove dim d[bestI]
		d = append(d[:bestI], d[bestI+1:]...)
	}
	return total
}

func main() {
	p := []int{40, 20, 30, 10, 30}
	fmt.Println("greedy cost:", greedyCost(p)) // a valid (maybe non-optimal) plan
}
```

For the sample chain greedy may or may not hit the `26000` optimum; the point is it runs in `O(n²)` with no `O(n²)` table, suitable when `n` is large. Always validate the heuristic against the exact DP on small instances and report the approximation gap.

### 7.5 Python — plan caching by dimension signature

```python
import functools


@functools.lru_cache(maxsize=None)
def optimal_cost(p_tuple):
    """Cache the optimal cost keyed by the immutable dimension signature."""
    p = p_tuple
    n = len(p) - 1
    dp = [[0] * (n + 1) for _ in range(n + 1)]
    for L in range(2, n + 1):
        for i in range(1, n - L + 2):
            j = i + L - 1
            dp[i][j] = min(dp[i][k] + dp[k + 1][j] + p[i - 1] * p[k] * p[j]
                           for k in range(i, j))
    return dp[1][n]


if __name__ == "__main__":
    # Same chain shape queried many times -> computed once, then cached.
    sig = (40, 20, 30, 10, 30)
    for _ in range(1000):
        optimal_cost(sig)            # only the first call does O(n^3) work
    print(optimal_cost(sig))         # 26000
    print(optimal_cost.cache_info()) # hits=999, misses=1
```

The `cache_info()` line is itself an observability hook: in a service, a low hit rate means chain shapes are too varied for caching to help; a high hit rate confirms the plan is being reused as intended.

---

## 7.6 Numerical Conditioning: When Cheapest Is Not Best

A rarely-discussed senior concern: for floating-point matrices, *different multiplication orders accumulate rounding error differently*. The scalar-multiplication-optimal order minimizes FLOPs, which often (but not always) also minimizes error — yet for ill-conditioned chains the two can diverge.

- **More FLOPs can mean more error**, since each multiply-add introduces rounding; fewer operations is a reasonable error proxy, so the min-FLOPs plan is usually a *good* conditioning choice too.
- **But intermediate magnitude matters more.** An order that produces a huge intermediate (large dynamic range) before a cancellation can lose precision catastrophically, even with fewer total FLOPs. A costlier order keeping intermediates well-scaled may be more accurate.
- **Decision.** For most numerical pipelines, min-FLOPs is fine and conditioning is a non-issue. When accuracy is paramount (scientific computing, iterative solvers), validate the chosen order's accuracy against a reference (e.g., higher precision) and, if it fails, prefer an order with smaller intermediate dynamic range — a different objective the DP can target if you define `combineCost` to penalize magnitude.

The general principle: the scalar-multiplication count is a *cost* model, not an *accuracy* model. Senior engineers keep the two concerns separate and only conflate them after confirming, by measurement, that they agree for the workload at hand.

## 7.7 Determinism and Tie-Breaking

When the optimal cost is achieved by multiple splits, the chosen parenthesization depends on the tie-break rule (e.g., "first improving `k`" vs "strict less-than"). This matters in three production contexts:

1. **Cross-language parity.** The Go, Java, and Python implementations must agree on the *plan*, not just the cost, for golden-file tests to pass. Fix a single tie-break rule (commonly: keep the *first* `k` that achieves the minimum, i.e., use strict `<` so earlier `k` wins ties).
2. **Reproducible benchmarks.** A nondeterministic plan choice makes runtime comparisons noisy. Determinism removes a confound.
3. **Cache keys.** If the plan is cached and later compared, nondeterminism causes spurious cache misses or mismatches.

The replay check (Section 8) is tie-break-agnostic: every optimal plan, whatever the tie-break, replays to the same `dp[1][n]`. So determinism is about reproducibility, not correctness.

## 8. Observability and Testing

An MCM result is opaque: one wrong split looks like any other plan. Build checks in from day one.

| Check | Why |
|-------|-----|
| Brute-force oracle on small `n` (`n ≤ 12`) | Catches recurrence and indexing bugs. |
| `dp[i][i] == 0` for all `i` | Confirms the base case. |
| Cost matches a *replay* | Sum the `p·q·r` of each multiply in the reconstructed order; it must equal `dp[1][n]`. |
| Reconstruction is a valid full binary tree | Exactly `n-1` internal nodes, `n` leaves, each matrix used once. |
| Monotonicity sanity | Adding a matrix never decreases the optimum (for positive dims). |
| Determinism across languages | Same `p` → identical cost and (with a fixed tie-break) identical split in Go/Java/Python. |

The single most valuable test is the **replay check**: independently re-sum the costs of the multiplies in the order the split table dictates, and assert it equals `dp[1][n]`. This catches a split table that disagrees with the cost table — a subtle bug where `min` and the recorded `k` drift apart (often from setting `split` outside the `if cost < best` guard).

### 8.1 A property-test battery

```text
for random small chain p, n in [1, 12]:
    assert dp[1][n] == brute_force(p)               # the oracle
    assert dp[i][i] == 0 for all i
    assert replay_cost(split, p) == dp[1][n]        # reconstruction agrees
    assert tree_leaf_count(split) == n              # valid full binary tree
    assert mcm(p) <= mcm(p with one dim doubled)    # monotone in dims
```

For the join/tensor generalizations, additionally fuzz the cost function: the DP must remain optimal under *any* nonnegative cost, so randomized cost matrices are a strong test that the skeleton is truly cost-agnostic.

### 8.2 The replay check, in code

```python
def replay_cost(p, split, i, j):
    """Independently re-sum the cost of the plan encoded by `split`."""
    if i == j:
        return 0
    k = split[i][j]
    left = replay_cost(p, split, i, k)
    right = replay_cost(p, split, k + 1, j)
    return left + right + p[i - 1] * p[k] * p[j]


def verify(p, dp, split):
    n = len(p) - 1
    assert replay_cost(p, split, 1, n) == dp[1][n], "split table disagrees with cost!"
    # also assert leaf count == n (valid full binary tree)
    leaves = []

    def walk(i, j):
        if i == j:
            leaves.append(i)
        else:
            k = split[i][j]
            walk(i, k)
            walk(k + 1, j)

    walk(1, n)
    assert sorted(leaves) == list(range(1, n + 1)), "each matrix must appear once!"
```

Wire `verify` into CI to run on every random instance. It is the single highest-value guard because it cross-checks the *two* tables (`dp` and `split`) against each other independently — a bug that corrupts one but not the other (the most common subtle failure) is caught immediately.

### 8.3 Production metrics to emit

In a service that plans chains at scale, emit: the planning latency (should scale ≈ `n³`), the cache hit rate for plan reuse (Section 7.5), the achieved cost vs a cheap lower bound (sum of the `n-1` smallest possible per-step costs) to flag anomalies, and — for the heuristic path — the approximation gap measured periodically against the exact DP on a sampled small instance. A planning latency that grows faster than `n³`, or a heuristic gap that drifts upward, are early signals of a regression.

---

## 9. Failure Modes

### 9.1 Wrong fill order
Looping `i, j` directly reads uncomputed sub-intervals → plausible but wrong plans. Mitigation: iterate by chain length, or memoize.

### 9.2 Integer overflow
`p[i-1]·p[k]·p[j]` overflows 32-bit for dimensions in the thousands; `dp[1][n]` can overflow 64-bit for very long chains with large dims. Mitigation: 64-bit (or 128-bit / floating cost) and a magnitude estimate logged alongside.

### 9.3 Split table disagrees with cost
Setting `split[i][j]` outside the `if c < best` guard records a `k` that did not win. Symptom: replay cost ≠ `dp[1][n]`. Mitigation: set cost and split together, atomically, inside the guard.

### 9.4 Applying interval DP to a commutative problem
Using the `O(n³)` contiguous interval DP for joins (which are commutative) silently misses bushy plans. Mitigation: recognize commutativity → use subset DP, bounding `n` or falling back to heuristics.

### 9.5 Optimizing the wrong objective
Minimizing FLOPs when the binding constraint is peak memory (common on GPUs) yields a plan that OOMs. Mitigation: pick the objective deliberately (min-sum vs min-max DP).

### 9.6 Trusting a cost estimate that is wrong
For joins/tensors the "dimensions" are estimated cardinalities; a bad estimate yields a bad plan even with a perfect DP. Mitigation: monitor estimation error, support runtime re-optimization, and prefer plans robust to estimate variance.

### 9.7 Recursion stack overflow in reconstruction
A left-leaning split tree on huge `n` overflows recursive reconstruction. Mitigation: iterative stack-based reconstruction.

### 9.8 Recomputing the plan per execution
In a hot loop that multiplies the *same* chain shape millions of times, recomputing the `O(n³)` order each time is pure waste. Mitigation: compute the order once, cache it keyed by the dimension signature, and reuse.

### 9.9 Confusing the plan with the computation
A conceptual failure mode: teams sometimes implement MCM and then *actually multiply* the matrices inside the DP, conflating planning with execution. MCM should output only an *order* (a parenthesization or contraction path); the heavy numerical multiply is a separate step driven by that order. Mixing them couples the cheap planner to the expensive runtime and prevents caching the plan. Mitigation: keep `planOrder(shapes) -> tree` and `execute(tree, matrices) -> result` as distinct, separately tested functions.

### 9.10 Stale plans after a shape change
When a cached plan is keyed too coarsely (e.g., by table name rather than by actual cardinalities/shapes), a change in the underlying data invalidates the plan but the cache still serves the old one. Symptom: a plan that was optimal becomes badly suboptimal after data drift. Mitigation: key the cache on the exact shape/cardinality signature, and invalidate on statistics refresh.

---

## 10. Summary

- The `O(n³)` interval DP is the workhorse, but the senior reality is that the *same skeleton* governs matrix chains, database join ordering, and tensor contraction — so **parameterize the DP by a cost function** rather than hard-coding `p·q·r`.
- The schoolbook `p·q·r` model ignores sub-cubic multiply, cache, parallelism, and conditioning; feed the DP your real cost when those matter, and the optimal order can change.
- Joins add **commutativity**, pushing you from the `O(n³)` interval DP to the `O(3ⁿ)` subset DP (Selinger/DPccp); bound `n` or fall back to greedy/branch-and-bound. Misapplying the cheap interval DP to a commutative problem leaves better plans unexplored.
- Tensor contraction generalizes MCM to a graph (NP-hard); a chain reduces to literal MCM. Decide between **min-FLOPs** and **min-peak-memory** objectives explicitly — their optima differ.
- For huge literal chains, **Hu-Shing** gives `O(n log n)`; for huge commutative problems, heuristics (greedy, branch-and-bound, annealing) trade optimality for tractability, validated against the DP on small instances.
- Memory is `O(n²)` for the tables — the first wall past a few thousand matrices. Use triangular packing, cost-only mode, and plan caching.
- Test with a brute-force oracle and especially the **replay check** (re-sum the reconstructed plan's costs == `dp[1][n]`), which catches the split/cost disagreement that is the dominant subtle bug.

### Decision summary

- **Literal chain, moderate `n`** → interval DP, `O(n³)`, schoolbook or custom cost.
- **Literal chain, huge `n`** → Hu-Shing, `O(n log n)`.
- **Commutative joins, small `n`** → subset DP (bushy plans).
- **Commutative joins/tensors, large `n`** → greedy / branch-and-bound / annealing.
- **GPU/tensor, memory-bound** → min-peak (min-max) DP, not min-FLOPs.
- **Same chain reused many times** → compute the plan once, cache and reuse.
- **Floating-point accuracy critical** → validate the min-FLOPs order's conditioning; switch to a magnitude-aware objective only if measurement shows it matters.
- **Cross-language parity required** → fix a deterministic tie-break so the *plan* (not just the cost) is reproducible.

### The one-sentence senior summary

If you remember nothing else: *MCM's `O(n³)` recurrence is trivial; the engineering is choosing the cost model, recognizing commutativity (interval DP vs subset DP), picking FLOPs-vs-memory as the objective, caching the plan, and verifying with a replay check — because a planner is only as good as its cost inputs and as correct as its weakest test.*

References to study further: Selinger et al. (System R join ordering), the DPccp/DPhyp algorithms (Moerkotte), Hu-Shing optimal triangulation, `opt_einsum` and `cotengra` for tensor-contraction paths, Strassen and sub-cubic matrix multiply, and sibling interval-DP topics (optimal BST, polygon triangulation).
