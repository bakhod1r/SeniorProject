# Divide and Conquer DP Optimization — Senior Level

> Divide-and-conquer DP optimization is rarely the bottleneck on a small input — but the moment `n` is large, the cost function is subtle, or the monotonicity is *assumed* rather than *proven*, every detail (verifying `opt` monotonicity, the per-call cost of evaluating `C`, recursion depth, memory layout, tie-breaking, and the silent-wrong-answer failure mode) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Recognizing Applicability](#2-recognizing-applicability)
3. [Verifying Monotonicity in Production](#3-verifying-monotonicity-in-production)
4. [Cost-Function Evaluation Cost](#4-cost-function-evaluation-cost)
5. [Memory and Layout Engineering](#5-memory-and-layout-engineering)
6. [Recursion vs Explicit Stack](#6-recursion-vs-explicit-stack)
7. [Reconstruction at Scale](#7-reconstruction-at-scale)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does the `compute` recursion work" but "is this technique *applicable* to the problem in front of me, and what breaks when I scale it?". Divide-and-conquer DP optimization shows up in three guises that look different but share one engine:

1. **Array/sequence partitioning** — split `n` items into exactly `K` contiguous groups minimizing a sum of per-group costs (the canonical case). `n` up to `10^5`–`10^6`, `K` from a handful to a few hundred.
2. **k-means / 1-D clustering** — partition sorted points into `K` clusters minimizing total within-cluster variance; the variance cost is Monge, so this is exactly our DP.
3. **Layered optimization with a fixed number of stages** — any DP `dp[i][j] = min_k ( dp[i-1][k] + C(k, j) )` where stages are identical and `C` is Monge.

All three reduce to: *verify the cost is Monge (so `opt` is monotone), then fill each of `K` rows in `O(n log n)` with the `compute` recursion.* The senior-level decisions are: how to *confirm* applicability without a silent wrong answer, how to keep `C` evaluable in `O(1)` (or pay the price), how to manage memory and recursion depth at scale, and how to test a result whose only symptom of a bug is "a number that is plausibly wrong."

This document treats those decisions in production terms.

---

## 2. Recognizing Applicability

The technique applies **only** to the layered shape with monotone `opt`. The recognition checklist:

1. **Is the recurrence layered?** It must be `dp[i][j] = min_k ( dp[i-1][k] + C(k, j) )` — a cell depends on the *previous layer*, not on two smaller cells of the same DP. If it is `dp[i][k] + dp[k][j]` (interval), that is Knuth's domain (sibling `12`), not this one.
2. **Is `C(k, j)` a fixed function of the endpoints?** It must not depend on the path taken to reach `k`. If it does, the argmin theory breaks.
3. **Does `C` satisfy the quadrangle (Monge) inequality?** This is the crux. If yes, `opt(i, j)` is provably non-decreasing in `j` and the technique is correct. If you cannot prove it, you must verify empirically and accept the risk (Section 3).
4. **Is the cost linear in a query value?** If `C(k, j) = a[k]·x[j] + b[k]`, prefer the Convex Hull Trick (sibling `10`) — it can reach `O(n)` per layer with monotone queries and supports online insertion.
5. **Is `n` large enough to matter?** For `n ≤ a few thousand`, the naive `O(n²)` per layer is simpler and fast; the optimization earns its complexity only for large `n`.

### 2.1 A modeling discipline

When you suspect "layered partition → divide-and-conquer," write `C(k, j)` *explicitly as a function of `k` and `j` only*. The act of writing it often reveals whether the cost truly depends only on the endpoints (applicable) or smuggles in path/history information (not applicable). If you cannot express `C` without referencing how `k` was reached, this is the wrong tool.

### 2.2 Common applicable problems

| Problem | Cost `C(k, j)` | Monge? |
|---------|----------------|--------|
| Min sum of squared segment sums | `(P[j] - P[k])²` | yes |
| 1-D k-means (sorted points) | within-segment SSE | yes |
| Min total "inversions" partition | pair count inside `[k, j)` | yes |
| Optimal segmented regression (piecewise constant) | segment SSE | yes |
| Min sum of `(len)²` or convex-of-length | convex function of `j - k` | yes |

### 2.3 Common *inapplicable* look-alikes

- **Longest/heaviest path with revisits** — no fixed `C(k, j)`.
- **Costs depending on which elements were already used elsewhere** — breaks the endpoint-only assumption.
- **Non-Monge penalties** (e.g. some max-based or non-convex costs) — `opt` may not be monotone.

### 2.4 The decision flow in production

A concise flowchart that a senior engineer runs mentally before writing a line of code:

```
1. Is the recurrence dp[i-1][k] + C(k, j)?        no → wrong family (Knuth? plain DP?)
2. Does C depend only on (k, j)?                  no → not applicable
3. Is C linear in some query value x[j]?          yes → prefer CHT (topic 10)
4. Is C Monge (quadrangle inequality)?            no → must verify empirically or use naive O(n²)
5. Is n large enough that O(n²) per layer hurts?  no → just use naive (simpler, safer)
6. Is the log n factor across K layers decisive?  yes → consider SMAWK O(n) per layer
otherwise → divide-and-conquer O(K n log n)
```

The most consequential branch is step 4: skipping it is how teams ship a silently-wrong solution. The second most consequential is step 5 — applying a subtle optimization where the naive `O(n²)` would have been fast enough and far less bug-prone is a classic over-engineering trap.

---

## 3. Verifying Monotonicity in Production

The defining hazard of this technique: **when monotonicity fails, you get a wrong answer with no crash, no exception, no warning.** Senior practice is to make that failure *loud* before it reaches users.

### 3.1 Three levels of confidence

1. **Algebraic proof of the quadrangle inequality.** The gold standard. Prove `C(a,c) + C(b,d) ≤ C(a,d) + C(b,c)` for `a ≤ b ≤ c ≤ d` from the closed form of `C`. If you have this, the technique is provably correct and you need no runtime checks for correctness (only for bugs).
2. **Local-form proof.** Prove the local inequality `C(a,c) + C(a+1,c+1) ≤ C(a,c+1) + C(a+1,c)`, which implies the full quadrangle inequality and is usually a single, checkable inequality.
3. **Empirical verification.** Build the brute-force `opt` table on random small inputs and assert `opt[j] ≤ opt[j+1]`. This *finds counterexamples* but does not *prove* their absence; treat it as a strong test, not a proof.

### 3.2 An empirical monotonicity harness

Run this in CI on many random instances spanning the input distribution:

```text
for many random small (a, K):
    dp_brute, opt_brute = brute_force_with_opt(a, K)   # O(K n^2), captures argmins
    for each layer i, each column j >= 2:
        assert opt_brute[i][j-1] <= opt_brute[i][j]     # monotonicity
    dp_fast = divide_and_conquer(a, K)
    assert dp_fast == dp_brute[K][n]                     # value agreement
```

If the monotonicity assertion ever fires, the divide-and-conquer result is untrustworthy for that cost — fall back to the naive `O(n²)` (or use a different optimization).

### 3.3 Guarding against distribution shift

A cost can be Monge on the test distribution but not in a corner of the input space (negative weights, zero-length segments, ties). Senior practice: fuzz the *edges* of the input domain (all-equal arrays, single huge element, alternating signs) where Monge proofs often slip. Many "it works on the samples but fails on the judge" incidents trace to an untested corner of the cost.

---

## 4. Cost-Function Evaluation Cost

The entire `O(K n log n)` analysis assumes `C(k, j)` is `O(1)`. If it is `O(c)`, every bound carries a factor of `c`.

### 4.1 The `O(1)` ideal: prefix sums

For costs expressible from prefix aggregates — `(P[j]-P[k])²`, segment sum, segment count — precompute prefix sums once (`O(n)`) and evaluate `C` in `O(1)`. This is the common, happy case.

### 4.2 The harder case: within-segment variance / SSE

For k-means / SSE, `C(k, j) = Σ x² - (Σ x)² / (j - k)`, which is `O(1)` from prefix sums of `x` and `x²`. Always look for a closed form before resorting to anything slower.

### 4.3 When `C` cannot be `O(1)`: the moving-pointer trick

If `C(k, j)` can only be computed incrementally (e.g. it depends on counts of distinct values in `[k, j)`, as in some "minimum cost to partition with distinctness penalty" problems), a pure divide-and-conquer fill is awkward because the scan jumps around. Two options:

- **Mo-like add/remove pointers** inside `compute`: maintain a window and add/remove elements as `k` and `mid` move. This works but the amortized analysis is delicate; the divide-and-conquer access pattern is *not* monotone, so naive pointer movement can be `O(n²)`.
- **Switch to the SMAWK algorithm** (totally-monotone matrix searching) when the cost supports `O(1)` comparison of matrix entries; SMAWK does the row in `O(n)` and has a cleaner access pattern.

If `C` is genuinely `O(c)` per call with no incremental structure, accept `O(K n c log n)` and decide whether that still beats the naive `O(K n² c)`.

### 4.4 Numerical concerns

Squared and variance costs grow as `O((Σ)²)`, which for `n = 10^6` and values up to `10^9` can reach `10^{30}` — far beyond 64-bit. Senior practice: bound the maximum possible cost up front and choose `int64`, `int128`, or big integers / floating point accordingly. A silent overflow in `C` is a classic cause of a "plausible but wrong" answer.

### 4.5 A concrete cost-magnitude bound

Before choosing a numeric type, compute the worst case explicitly. For squared-segment-sum cost with `n` elements each `≤ V`, the largest single segment sum is `n·V`, so the largest single-segment cost is `(n·V)²`. The total over `K` segments is at most `K·(n·V)²`, but the *minimum* (what `dp[K][n]` holds) is far smaller; the danger is the intermediate `C(k, j)` and partial `dp` values. Worked: `n = 10^6`, `V = 10^4` gives `n·V = 10^{10}`, so `(n·V)² = 10^{20}` — that overflows signed `int64` (max ~`9.2·10^{18}`). Mitigation: either use `int128`/big integers, or observe that the *answer* `dp[K][n]` is bounded by the single-segment cost `(P[n])² = (n·V)²` only when `K = 1`; for `K > 1` the squared sums are smaller because the array is split, so a tighter bound may keep you in `int64`. The point is to *prove* the bound, not assume it.

### 4.6 Floating-point pitfalls in the variance cost

The SSE closed form `Σx² − (Σx)²/(j−k)` subtracts two large quantities and can suffer **catastrophic cancellation** when the two terms are nearly equal (a near-constant segment). Symptoms: tiny negative SSE values (mathematically impossible) that then compare wrongly in the argmin. Mitigations: clamp negative SSE to `0`; use a numerically stable variance formula (Welford-style) if precision matters; or, for integer inputs, keep the cost as an exact integer expression `((j−k)·Σx² − (Σx)²)` (scaled by `(j−k)`) and compare scaled values, deferring the division. The scaled-integer comparison avoids floating point entirely and is the senior default when inputs are integers.

---

## 5. Memory and Layout Engineering

### 5.1 Rolling rows

Row `i` reads only row `i-1`. Keep two arrays `dpPrev`, `dpCur` of size `n+1` and swap them each layer. Memory `O(n)` instead of `O(K n)`. This is mandatory when `K·n` would blow the memory budget (e.g. `K = 1000`, `n = 10^6` → `10^9` cells of `int64` = 8 GB, infeasible; rolling makes it 8 MB).

### 5.2 When you must keep all rows: reconstruction

If you need the actual cuts, you must keep the `opt[i][j]` table (one `int` per cell), which is `O(K n)`. For `K·n` too large to store, use the **Hirschberg-style** divide-and-conquer-over-layers trick: reconstruct by recursively solving half the layers on half the array, trading time for `O(n)` reconstruction memory. This is rarely needed but is the senior fallback when both `K` and `n` are large.

### 5.3 Cache behavior

The scan in `compute` reads `dpPrev[k]` for `k` in a contiguous window and `prefix[k]`, `prefix[mid]`. Storing `dpPrev` and `prefix` as flat arrays (not arrays-of-arrays) keeps these reads cache-friendly. The recursion's column visitation is *not* sequential, but the split-point scan within each call *is*, which is where the time goes.

### 5.4 Avoiding per-layer allocation

Allocating a fresh `dpCur` each layer pressures the allocator/GC. Preallocate once and reset to `INF` per layer (a `memset`/`fill`), or ping-pong two preallocated buffers.

---

## 6. Recursion vs Explicit Stack

For `n = 10^6`, the `compute` recursion's call tree has `O(n)` nodes and depth `O(log n)` along any path — but languages with shallow default stacks (Python's default ~1000) or strict stack limits can still overflow if the implementation is not careful.

### 6.1 Python

Raise the recursion limit (`sys.setrecursionlimit(1 << 20)`) and be aware of the per-frame overhead. For very large `n`, convert `compute` to an explicit stack of `(l, r, optL, optR)` tuples to avoid both the limit and the interpreter's frame cost.

### 6.2 Go / Java

The default goroutine/thread stack grows, so recursion depth `O(log n)` is fine. The risk is not depth but the *number of calls* (`O(n)`); function-call overhead is negligible next to the arithmetic, so recursion is fine in practice.

### 6.3 Explicit-stack form

```text
stack = [(0, n, 0, n)]
while stack not empty:
    (l, r, optL, optR) = stack.pop()
    if l > r: continue
    mid = (l + r) / 2
    scan [optL, min(optR, mid-1)] for bestK, dpCur[mid]
    stack.push((l, mid-1, optL, bestK))
    stack.push((mid+1, r, bestK, optR))
```

Functionally identical, no recursion-depth risk, slightly more bookkeeping.

---

## 7. Reconstruction at Scale

When the deliverable is the *partition* (not just its cost), record `opt[i][mid] = bestK` inside `compute` as you resolve each column. Then backtrack:

```text
i, j = K, n
segments = []
while i > 0:
    k = opt[i][j]
    segments.append([k, j))
    j, i = k, i - 1
reverse(segments)
```

Two caveats at scale:

- **Memory**: storing all `opt[i][j]` is `O(K n)`. If that exceeds budget, use the Hirschberg layer-splitting reconstruction (Section 5.2).
- **Tie consistency**: the reconstructed segmentation depends on the tie-break rule. Document that you keep the smallest `k`; otherwise two correct runs can report different (equally optimal) partitions, which surprises users diffing outputs.

---

## 8. Code Examples

### 8.1 Go — production fill with `opt` recording and monotonicity assertion (debug build)

```go
package main

import "fmt"

const INF = int64(1) << 62

type Solver struct {
	prefix        []int64
	dpPrev, dpCur []int64
	opt           [][]int // opt[i][j], for reconstruction
	layer         int
	checkMono     bool
	lastOpt       []int // per-layer last argmin to assert monotonicity
}

func (s *Solver) cost(k, j int) int64 {
	d := s.prefix[j] - s.prefix[k]
	return d * d
}

func (s *Solver) compute(l, r, optL, optR int) {
	if l > r {
		return
	}
	mid := (l + r) / 2
	best, bestK := INF, optL
	hi := optR
	if hi > mid-1 {
		hi = mid - 1
	}
	for k := optL; k <= hi; k++ {
		if s.dpPrev[k] >= INF {
			continue
		}
		if v := s.dpPrev[k] + s.cost(k, mid); v < best {
			best, bestK = v, k
		}
	}
	s.dpCur[mid] = best
	if s.opt != nil {
		s.opt[s.layer][mid] = bestK
	}
	if s.checkMono { // debug-only: argmins must be non-decreasing in column
		if s.lastOpt[mid] = bestK; mid > 0 && s.lastOpt[mid-1] > bestK && s.lastOpt[mid-1] != -1 {
			panic(fmt.Sprintf("monotonicity violated at mid=%d", mid))
		}
	}
	s.compute(l, mid-1, optL, bestK)
	s.compute(mid+1, r, bestK, optR)
}

func (s *Solver) Solve(a []int, K int) int64 {
	n := len(a)
	s.prefix = make([]int64, n+1)
	for i, x := range a {
		s.prefix[i+1] = s.prefix[i] + int64(x)
	}
	s.dpPrev = make([]int64, n+1)
	s.dpCur = make([]int64, n+1)
	for j := range s.dpPrev {
		s.dpPrev[j] = INF
	}
	s.dpPrev[0] = 0
	for i := 1; i <= K; i++ {
		s.layer = i
		for j := range s.dpCur {
			s.dpCur[j] = INF
		}
		s.compute(0, n, 0, n)
		s.dpPrev, s.dpCur = s.dpCur, s.dpPrev
	}
	return s.dpPrev[n]
}

func main() {
	s := &Solver{}
	fmt.Println(s.Solve([]int{1, 3, 2, 4}, 2)) // 52
}
```

### 8.2 Java — explicit-stack form (no recursion-depth risk) with rolled rows

```java
import java.util.ArrayDeque;
import java.util.Arrays;

public class DCDPSenior {
    static final long INF = 1L << 62;
    long[] prefix, dpPrev, dpCur;

    long cost(int k, int j) {
        long d = prefix[j] - prefix[k];
        return d * d;
    }

    void fillRow(int n) {
        Arrays.fill(dpCur, INF);
        // frames: l, r, optL, optR packed as int[]
        ArrayDeque<int[]> stack = new ArrayDeque<>();
        stack.push(new int[]{0, n, 0, n});
        while (!stack.isEmpty()) {
            int[] f = stack.pop();
            int l = f[0], r = f[1], optL = f[2], optR = f[3];
            if (l > r) continue;
            int mid = (l + r) / 2;
            long best = INF; int bestK = optL, hi = Math.min(optR, mid - 1);
            for (int k = optL; k <= hi; k++) {
                if (dpPrev[k] >= INF) continue;
                long v = dpPrev[k] + cost(k, mid);
                if (v < best) { best = v; bestK = k; }
            }
            dpCur[mid] = best;
            stack.push(new int[]{l, mid - 1, optL, bestK});
            stack.push(new int[]{mid + 1, r, bestK, optR});
        }
    }

    long solve(int[] a, int K) {
        int n = a.length;
        prefix = new long[n + 1];
        for (int i = 0; i < n; i++) prefix[i + 1] = prefix[i] + a[i];
        dpPrev = new long[n + 1];
        dpCur = new long[n + 1];
        Arrays.fill(dpPrev, INF);
        dpPrev[0] = 0;
        for (int i = 0; i < K; i++) {
            fillRow(n);
            long[] t = dpPrev; dpPrev = dpCur; dpCur = t;
        }
        return dpPrev[n];
    }

    public static void main(String[] args) {
        System.out.println(new DCDPSenior().solve(new int[]{1, 3, 2, 4}, 2)); // 52
    }
}
```

### 8.3 Python — fill with reconstruction of the actual cuts

```python
import sys

INF = 1 << 62


def solve_with_cuts(a, K):
    n = len(a)
    pre = [0] * (n + 1)
    for i, x in enumerate(a):
        pre[i + 1] = pre[i] + x

    def cost(k, j):
        d = pre[j] - pre[k]
        return d * d

    dp_prev = [INF] * (n + 1)
    dp_prev[0] = 0
    dp_cur = [INF] * (n + 1)
    opt = [[0] * (n + 1) for _ in range(K + 1)]

    def compute(layer, l, r, opt_l, opt_r):
        if l > r:
            return
        mid = (l + r) // 2
        best, best_k = INF, opt_l
        hi = min(opt_r, mid - 1)
        for k in range(opt_l, hi + 1):
            if dp_prev[k] >= INF:
                continue
            v = dp_prev[k] + cost(k, mid)
            if v < best:
                best, best_k = v, k
        dp_cur[mid] = best
        opt[layer][mid] = best_k
        compute(layer, l, mid - 1, opt_l, best_k)
        compute(layer, mid + 1, r, best_k, opt_r)

    for i in range(1, K + 1):
        for j in range(n + 1):
            dp_cur[j] = INF
        compute(i, 0, n, 0, n)
        dp_prev, dp_cur = dp_cur, dp_prev

    # reconstruct (note: dp_prev now holds row K after the final swap)
    cuts = []
    j, i = n, K
    while i > 0:
        k = opt[i][j]
        cuts.append((k, j))
        j, i = k, i - 1
    cuts.reverse()
    return dp_prev[n], cuts


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    print(solve_with_cuts([1, 3, 2, 4], 2))  # (52, [(0, 2), (2, 4)])
```

---

## 9. Observability and Testing

A divide-and-conquer DP result is opaque — one wrong number looks like any other. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force `O(K n²)` oracle on small `n, K` | Catches off-by-one in split ranges and base case. |
| Monotonicity assertion on the oracle's `opt` table | Confirms the technique is even applicable to this cost. |
| Value agreement (fast == brute) entrywise | Catches `compute` window bugs. |
| Cost-function unit tests (`C(k,j)` vs naive sum) | The cost is where overflow and off-by-one hide. |
| Overflow guard (max cost < type max) | A silent overflow yields a plausible wrong answer. |
| Tie-break consistency test | Ensures reconstruction is deterministic. |
| Edge inputs (all equal, single element, `K=1`, `K=n`) | Monge proofs often slip at the boundaries. |

The single most valuable test is the **brute-force oracle plus monotonicity assertion** on a few hundred random small instances. It catches both classes of bug: the implementation bug (windows, base case) and the *applicability* bug (cost not actually Monge).

### 9.1 A property-test battery

```text
for random small (a in [-W, W]^n, K in [1, n]):
    assert dcdp(a, K) == brute(a, K)                 # value
    assert opt_brute is non-decreasing per layer      # applicability
    assert cost(k, j) == sum(a[k:j])**2 for samples    # cost correctness
    assert reconstructed cuts re-sum to dcdp cost      # reconstruction
```

### 9.2 Production guardrails

For a service running this on user data: validate `1 ≤ K ≤ n`; bound and log the maximum possible cost magnitude to catch overflow risk; and, if the cost's Monge property is only *empirically* believed, run a cheap shadow check (the naive `O(n²)` on a small downsample) and alert on disagreement.

---

## 10. Failure Modes

### 10.1 Silent wrong answer from non-Monge cost

The headline failure. If `C` is not Monge, `opt` may not be monotone, the recursion prunes the true optimum, and you get a wrong but plausible number. Mitigation: prove the quadrangle inequality, or run the monotonicity assertion in CI; never assume.

### 10.2 Tie-break inconsistency

Breaking ties toward the larger `k` can both corrupt the recursion windows and make reconstruction non-deterministic. Mitigation: strict `<`, keep the smallest `k`, and unit-test it.

### 10.3 Cost-function overflow

Squared/variance costs overflow 64-bit for large `n` and large values. Mitigation: compute the worst-case cost magnitude, pick a wide enough type (`int128`/big-int) or detect and reject oversized inputs.

### 10.4 Empty-segment / off-by-one in the window

Forgetting `hi = min(optR, mid-1)` admits an empty last segment, producing a bogus `C(mid, mid)` term. Mitigation: clamp `hi`, and test `K = n` (every element its own segment) explicitly.

### 10.5 Recursion-depth blow-up (Python)

Default recursion limits abort large instances. Mitigation: raise the limit or use the explicit-stack form (Section 6.3).

### 10.6 Wrong tool: interval DP

Using divide-and-conquer optimization on a `dp[i][k] + dp[k][j]` interval recurrence is a category error — that is Knuth's optimization (sibling `12`), with a different fill order and a two-sided bound. Mitigation: classify the recurrence shape first.

### 10.7 Expensive cost killing the asymptotics

If `C` is `O(n)` per call (no prefix-sum closed form), the row becomes `O(n² log n)`, *worse* than the naive `O(n²)`. Mitigation: find an `O(1)` closed form, use incremental pointers carefully, or switch to SMAWK.

### 10.8 Memory blow-up from keeping all rows

Storing `dp[K][n]` or `opt[K][n]` when `K·n` is huge exhausts memory. Mitigation: roll two rows for the value; use Hirschberg layer-splitting for reconstruction when both `K` and `n` are large.

### 10.9 Float comparison instability in the argmin

With a floating-point cost (SSE/variance), two candidate splits can produce values that differ only in the last bits, and rounding can make the recursion pick a different argmin than the brute force — usually harmless for the *cost* but it can make `opt` appear to "decrease" by one index and trip an over-strict monotonicity assertion. Mitigation: compare with a small tolerance in the assertion (not in the algorithm), or use the scaled-integer cost (Section 4.6) so comparisons are exact. Never loosen the algorithm's `<` to `<=` to "fix" this — that changes the tie-break and can genuinely corrupt the windows.

### 10.10 Treating the optimization as a black box

A subtle organizational failure: copying a `compute` template from a reference without re-deriving why it is correct for *this* cost. The template is correct only under monotone `opt`; pasting it onto a new cost without the Monge check is how the silent-wrong-answer bug (10.1) enters a codebase. Mitigation: require, in code review, an explicit comment citing either the quadrangle-inequality proof or the CI monotonicity assertion for every new cost the template is applied to.

---

## 11. Summary

- The technique applies **only** to layered DPs `dp[i][j] = min_k ( dp[i-1][k] + C(k, j) )` whose cost `C` is **Monge**, making `opt(i, j)` non-decreasing in `j`. Recognizing the shape and confirming the Monge property is the first senior decision.
- The defining hazard is a **silent wrong answer** when monotonicity fails. Prove the quadrangle inequality, or assert monotonicity on a brute-force `opt` table in CI — never assume.
- The `O(K n log n)` bound assumes `C` is `O(1)`. Keep it so with prefix sums (and prefix sums of squares for variance/SSE); otherwise the asymptotics inflate by the cost-eval factor or you must move to SMAWK / incremental pointers.
- Roll two `dp` rows for `O(n)` memory; keep the `opt` table only for reconstruction, and use Hirschberg layer-splitting when `K·n` is too large to store.
- Use recursion freely in Go/Java; in Python raise the recursion limit or convert `compute` to an explicit `(l, r, optL, optR)` stack for very large `n`.
- Break ties toward the **smallest `k`** for both correctness of the recursion windows and deterministic reconstruction.
- Always keep a brute-force `O(K n²)` oracle and a monotonicity assertion; together they catch implementation bugs and applicability bugs — the two ways this technique goes wrong.

### Decision summary

- **Layered partition, Monge cost, large `n`** → divide-and-conquer optimization (`O(K n log n)`).
- **Layered partition, linear cost** → Convex Hull Trick (sibling `10`).
- **Interval DP `dp[i][k]+dp[k][j]`** → Knuth optimization (sibling `12`).
- **Need every column min of a totally-monotone matrix in linear time** → SMAWK.
- **Cost not `O(1)`, no closed form** → incremental pointers or SMAWK; reconsider whether the optimization still beats `O(n²)`.
- **Monotonicity unprovable and unverifiable** → fall back to the naive `O(n²)`; do not gamble on a silent wrong answer.

References to study further: Yao's quadrangle-inequality speedup (1980); the SMAWK algorithm for totally-monotone matrices (Aggarwal-Klawe-Moran-Shor-Wilber 1987); the connection between 1-D k-means and Monge DPs; Hirschberg's linear-space DP reconstruction; and sibling topics `10-convex-hull-trick` and `12-knuth-optimization`.
