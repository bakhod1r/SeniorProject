# Kadane's Algorithm / Maximum Subarray — Senior Level

> Kadane's is rarely the bottleneck on a small array — but the moment the data is a stream that never ends, the grid is large enough that the `O(R²·C)` 2D reduction dominates a job's runtime, the sums overflow a 32-bit accumulator on a hot path, or the "best subarray" feeds a trading/anomaly-detection pipeline where the empty-vs-all-negative contract is a correctness incident, every detail (initialization, overflow, numeric type, online maintenance, failure modes) becomes a production concern.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Streaming / Online Kadane](#2-streaming--online-kadane)
3. [Overflow and Numeric Engineering](#3-overflow-and-numeric-engineering)
4. [Scaling the 2D Submatrix](#4-scaling-the-2d-submatrix)
5. [The Empty-Subarray Contract](#5-the-empty-subarray-contract)
6. [Variant Engineering at Scale](#6-variant-engineering-at-scale)
7. [Performance Engineering](#7-performance-engineering)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is the recurrence" but "what system am I embedding this in, and what breaks when I scale it?" Maximum-subarray shows up in production in several guises that share one engine:

1. **Best-window analytics on a stream** — "what is the most profitable consecutive run of ticks so far?" where the data arrives one element at a time and never stops. Kadane's `O(1)`-state form is *the* online algorithm here.
2. **2D hot-spot detection** — "find the brightest rectangular region of a heatmap / the densest submatrix." This is the `O(R²·C)` reduction, and at realistic grid sizes it dominates the job.
3. **Anomaly / change detection** — the maximum-subarray statistic (and its product/circular cousins) appears in genomics (maximum-scoring segment), signal processing, and finance.

All of them reduce to: *maintain a running best-ending-here under the right operator, track the global best, and respect the empty-subarray contract.* The senior-level decisions are: how to keep the state online, how to keep the arithmetic overflow-free, how to make the `O(R²·C)` scan fast, and how to verify the result when the input is too large or too live to brute-force.

This document treats those decisions in production terms.

---

## 2. Streaming / Online Kadane

### 2.1 Why Kadane's is already an online algorithm

Kadane's processes each element exactly once and keeps `O(1)` state. That makes it a true **streaming** algorithm: feed it elements as they arrive, query `bestSoFar` at any time, and the answer is correct for everything seen so far. No buffering, no second pass, no windowing.

```
type KadaneStream struct {
    bestEndingHere int64
    bestSoFar      int64
    started        bool
}

push(x):
    if not started:
        bestEndingHere = x; bestSoFar = x; started = true
    else:
        bestEndingHere = max(x, bestEndingHere + x)
        bestSoFar = max(bestSoFar, bestEndingHere)
query(): return bestSoFar
```

### 2.2 What streaming Kadane cannot do

Streaming Kadane answers "best subarray over the whole prefix seen so far." It **cannot** answer "best subarray within the last `W` elements" (a sliding window of fixed width), because removing the oldest element may invalidate `bestEndingHere`, and the discarded-prefix information is gone. For a **fixed-width sliding window** maximum-subarray, you need a monotonic-deque-over-prefix-sums approach or a segment tree of `(total, bestPrefix, bestSuffix, best)` nodes — not plain Kadane's. Be explicit about which question the stream is asking.

### 2.3 Resettable / sessionized streams

Many real streams are *sessionized* — you want the best run *within the current session*, resetting at session boundaries. This is just re-initializing the two variables at each boundary. The danger is resetting to `0` instead of the first element of the new session, which reintroduces the all-negative bug per session.

### 2.3b Watermarks and late data

Real streams have out-of-order arrivals. Kadane's assumes a fixed left-to-right order; if an element arrives "late" (logically belongs earlier in the sequence), the `O(1)` state cannot retroactively splice it in — the discarded-prefix information is gone. Production options: (a) buffer within a bounded reordering window and only commit Kadane state past a watermark, accepting bounded latency; (b) if late data is rare and approximate answers are acceptable, ignore it and log the drop rate; (c) for exactness, fall back to the mergeable-segment tree (§2.4), which *can* incorporate a correction by re-merging the affected leaf. Choosing among these is a latency-vs-exactness trade, and it must be a conscious decision — silently feeding out-of-order data to scalar Kadane produces a wrong answer that looks plausible.

### 2.4 Mergeable segments (for parallel / distributed streams)

If the stream is sharded across workers, each shard can compute a **summary** `(total, bestPrefix, bestSuffix, best)` for its chunk, and these summaries **merge associatively**:

```
merge(L, R):
    total      = L.total + R.total
    bestPrefix = max(L.bestPrefix, L.total + R.bestPrefix)
    bestSuffix = max(R.bestSuffix, R.total + L.bestSuffix)
    best       = max(L.best, R.best, L.bestSuffix + R.bestPrefix)
```

This monoid is the key to distributed and segment-tree maximum-subarray. It is also the divide-and-conquer node from `middle.md`, promoted to a first-class data structure. Because `merge` is associative, you can fold shards in any order or in a tree — essential for MapReduce-style pipelines.

---

## 3. Overflow and Numeric Engineering

### 3.1 The overflow budget (sum variant)

The running sum can reach `n · max|a[i]|`. With `n = 10^9` and elements up to `10^9`, that is `10^18` — near the `int64` limit (`~9.2·10^18`). For larger products of the bounds, use `int128`, big integers, or saturating arithmetic. A 32-bit accumulator overflows at a mere `~2.1·10^9`, which `n = 10^5` elements of size `10^5` already exceed.

### 3.2 The overflow budget (product variant)

Products explode far faster: `2^63` is reached after only ~63 elements of value `2`. Three strategies:

- **64-bit with overflow detection** — check `__builtin_mul_overflow` / `Math.multiplyHigh` and clamp or error.
- **Big integers** — exact but slow (`O(digits)` per multiply); fine for small `n`.
- **Logarithms** — track `Σ log|a[i]|` and a sign/zero flag, comparing magnitudes in log-space; loses exactness and mishandles zeros, so use only for "which window is largest," not the exact value.

### 3.3 Floating-point inputs

If the array is `float64` (e.g., returns, signal amplitudes), Kadane's still works, but watch **catastrophic cancellation**: adding a large positive then a large negative loses precision. For long streams, periodic use of Kahan/compensated summation in the `bestEndingHere + x` step preserves accuracy. The comparison `max(x, be + x)` is itself exact; only the accumulation drifts.

### 3.4 Unsigned and modular pitfalls

Never run Kadane's on **unsigned** types — the `bestEndingHere + a[i]` and the `max` logic both rely on signed comparison; an unsigned wrap turns a "negative prefix" into a huge positive and corrupts the restart decision. And maximum-subarray is *not* a modular-arithmetic problem: do not reduce sums mod `p` (that destroys the ordering the `max` depends on).

### 3.5 Overflow worked numbers

A concrete sizing exercise that should be done before shipping:

```
elements |a[i]| ≤ A,  array length ≤ n.   worst-case |sum| ≤ n·A.

  n=1e5,  A=1e4   →  n·A = 1e9    < 2.1e9 (int32 limit)  → int32 RISKY (signed sum of negatives too)
  n=1e6,  A=1e4   →  n·A = 1e10   > int32                → use int64
  n=1e9,  A=1e9   →  n·A = 1e18   < 9.2e18 (int64 limit)  → int64 OK
  n=1e9,  A=1e10  →  n·A = 1e19   > int64                 → need int128 / bigint

products: |a[i]| ≥ 2 over m elements → |product| ≥ 2^m;  2^63 reached at m ≈ 63.
```

Encode the chosen bound as a startup assertion: `assert(n * maxAbs <= TYPE_MAX)` (computed in a wider type) so the job fails fast on a too-small accumulator rather than silently wrapping in production. The product case almost always needs explicit overflow detection regardless of `n`, because even a short run of moderate values overflows.

---

## 4. Scaling the 2D Submatrix

### 4.1 The cost reality

The 2D reduction is `O(R² · C)` — quadratic in one dimension. For a `2000 × 2000` heatmap that is `~1.6·10^10` operations: tens of seconds in a tight language, minutes in Python. Senior levers:

- **Transpose so the squared factor is the smaller side.** `O(min(R,C)² · max(R,C))`. For a `4000 × 100` grid, transposing turns `4000²·100` into `100²·4000` — a 1600× win.
- **Incremental column-sum band.** Accumulate `colSum[c] += grid[bottom][c]` as `bottom` grows; never re-sum a band. (Already standard; verify it in code review.)
- **Parallelize across `top` rows.** Each `top` is an independent outer iteration; distribute them across threads. The `colSum` band is per-iteration, so there is no shared mutable state.
- **Cache-friendly traversal.** Store the grid row-major and iterate `colSum[c] += grid[bottom][c]` with `c` innermost for streamed reads.

### 4.2 When the 2D reduction is the wrong tool

If you only need an **approximate** hot region, or the grid is enormous (`10^4 × 10^4`), `O(R²·C)` is infeasible. Alternatives: 2D prefix sums plus a bounded-size sliding window (if the rectangle dimensions are constrained), FFT-based correlation for fixed-size kernels, or downsampling. State the constraint: the exact maximum-sum submatrix of arbitrary dimensions has no known truly-subquadratic algorithm for general grids.

### 4.3 Sparse and thresholded grids

For sparse grids (mostly zeros), the column-sum band is mostly unchanged between `bottom` steps; you can skip Kadane recomputation when no column in the band changed sign-relevantly — a heuristic, not an asymptotic improvement, but a real constant-factor win on sparse heatmaps.

### 4.4 The transpose decision, with numbers

The transpose lever is the single highest-leverage optimization for non-square grids. Concretely:

```
grid 4000 × 100:
  no transpose:  R²·C = 4000² · 100   = 1.6e12 ops   (tens of seconds, JIT)
  transpose:     C²·R = 100²  · 4000  = 4.0e7  ops    (milliseconds)
  speedup ≈ 40,000×

grid 1000 × 1000 (square):
  transpose makes no difference (R = C).
```

Rule: if `R > C`, transpose; the cost is one `O(R·C)` copy, dwarfed by the `O(min²·max)` scan it enables. Bake the check into the entry point so callers never pay the un-transposed cost by accident. For a *streaming* 2D feed (rows arriving over time) you cannot transpose freely; instead maintain 2D prefix sums incrementally and query fixed-size or bounded rectangles, trading the arbitrary-rectangle generality for online updates.

---

## 5. The Empty-Subarray Contract

The single most consequential senior decision is the **contract**: is the empty subarray (sum `0`) a valid answer?

| Contract | Initialization | All-negative answer | Use case |
|----------|----------------|---------------------|----------|
| Non-empty required (classic) | `best = a[0]` | least-negative element | "best real run" |
| Empty allowed (sum `0` floor) | `best = 0`; `be = 0` | `0` (choose nothing) | "best run or do nothing" (e.g., optional trade) |

These are **different problems**, and shipping the wrong one is a silent correctness bug that passes most tests (any array with a positive element gives the same answer). The all-negative array is the only input that distinguishes them — which is exactly why it must be in the test suite, fed from the *human-specified* requirement, not re-derived. In a financial "best holding period" feature, "empty allowed" means "you could decline to trade"; "non-empty" means "you must hold at least one day." The business meaning dictates the contract.

---

## 6. Variant Engineering at Scale

### 6.1 One core, many operators

A production max-subarray utility should factor out the **combine operator** and the **identity/initialization**. The sum, product, and bounded-length variants share the sweep skeleton; only the per-element update and the state shape differ.

| Variant | State | Per-element update |
|---------|-------|--------------------|
| Max sum | `be` | `be = max(x, be + x)` |
| Max product | `(curMin, curMax)` | swap on `x<0`; `curMax=max(x, curMax·x)`, `curMin=min(x, curMin·x)` |
| Circular max | `(curMax, curMin, total)` | run max-Kadane and min-Kadane together; combine at end |
| Mergeable segment | `(total, bestPrefix, bestSuffix, best)` | the associative `merge` of §2.4 |

### 6.2 Bounded-length variants

"Maximum-sum subarray with **at least** `k` elements" and "**at most** `k` elements" come up in production (minimum holding period, maximum exposure window). They are **not** plain Kadane's:

- **At least `k`:** for each `r`, the subarray must start at or before `r − k + 1`. Use prefix sums `P`; the answer for endpoint `r` is `P[r+1] − min(P[l])` over `l ≤ r − k + 1`. Maintain that running minimum prefix as `r` advances (a one-pass `O(n)` sweep): `best = max(best, windowSum_k + kadaneOnRunningBest)`, where you combine the mandatory `k`-block with the optional extra extension. Concretely, keep a rolling sum of the last `k` elements and a Kadane-like "best optional extension to the left," giving `O(n)`.
- **At most `k`:** maintain `min(P[l])` only over a window `l ∈ [r−k+1, r]` using a monotonic deque, so `P[r+1] − minPrefixInWindow` is the best subarray ending at `r` of length `≤ k`. `O(n)` with the deque.

Both keep linear time; the bound is enforced through the prefix-sum + windowed-minimum lens (the same lens as the `professional.md` prefix-minimum equivalence), not through the raw `be = max(x, be+x)` recurrence, which has no notion of length.

### 6.3 Returning indices in every variant

Production callers almost always want the *location*, not just the value. Bake index tracking into the core (the `start`-reset pattern from `middle.md`) and return `(value, l, r)` everywhere. Retrofitting indices later is error-prone.

---

## 7. Performance Engineering

### 7.1 The inner loop is the budget

Kadane's inner loop is one add and one (or two) comparisons. For the 1D case there is little to optimize beyond:

- **Branchless max** where the compiler does not already vectorize it (rarely needed; modern compilers handle `max` well).
- **Avoid bounds checks** in the hot loop (Go: range over a slice; Java: hoist `a.length`; Python: this is the bottleneck — use NumPy or PyPy for `10^8`-scale).
- **Sequential access** — already optimal; never randomize.

### 7.2 SIMD and the 2D case

The 2D column-sum accumulation (`colSum[c] += grid[bottom][c]`) is a pure vector add — auto-vectorizes well and can be handed to SIMD/BLAS-style routines. The Kadane scan over `colSum` is inherently sequential (each step depends on the last), so parallelism in 2D lives in the **outer `top` loop** and the **column-sum vector add**, not inside Kadane.

### 7.3 Memory

1D Kadane is `O(1)` extra space. The 2D variant needs only an `O(C)` band, not a full `O(R·C)` copy — verify you are not materializing per-band submatrices. The mergeable-segment tree is `O(n)` for range queries; build it only if you actually need queries on a mutable array.

### 7.3b Branch prediction on the restart decision

The inner-loop branch `a[i] > be + a[i]` (the restart test) is data-dependent. On arrays with long monotone runs (mostly extending or mostly restarting) it predicts well; on adversarial alternating-sign data the misprediction rate rises and can measurably slow the loop. A branchless rewrite — `be = max(a[i], be + a[i])` compiled to a conditional-move — sidesteps this and is what most optimizing compilers already emit for `max`. If profiling shows the restart branch as a misprediction hotspot, confirm the compiler chose `cmov`; manual branchless code is rarely needed but is the fallback. This is a constant-factor concern only — the asymptotics are untouched — but on a `10^9`-element hot path it is the difference between meeting and missing a latency budget.

The same observation applies to the min/max-tracking product loop and the simultaneous max/min circular loop: each has a data-dependent comparison per element, and each compiles cleanly to conditional moves. Verify the generated assembly once for the hot variant; do not micro-optimize the cold ones.

### 7.4 Language realities

In a JIT/AOT language (Go, Java, Rust, C++) Kadane's runs `~10^9` elements/second. In CPython it is `~10^7`/second — two orders slower. For large arrays in Python, vectorize: a NumPy formulation of the prefix-minimum approach (`np.maximum.accumulate` on `prefix − np.minimum.accumulate(prefix)`) runs in compiled C, recovering the speed while staying readable.

---

## 8. Code Examples

### 8.1 Go — streaming Kadane with mergeable segments

```go
package main

import "fmt"

const negInf = int64(-1) << 62

type Seg struct {
	total, bestPrefix, bestSuffix, best int64
}

func leaf(x int64) Seg { return Seg{x, x, x, x} }

func merge(l, r Seg) Seg {
	max3 := func(a, b, c int64) int64 {
		m := a
		if b > m {
			m = b
		}
		if c > m {
			m = c
		}
		return m
	}
	return Seg{
		total:      l.total + r.total,
		bestPrefix: max3(l.bestPrefix, l.total+r.bestPrefix, negInf),
		bestSuffix: max3(r.bestSuffix, r.total+l.bestSuffix, negInf),
		best:       max3(l.best, r.best, l.bestSuffix+r.bestPrefix),
	}
}

// Stream maintains the running answer in O(1) state.
type Stream struct {
	be, best int64
	started  bool
}

func (s *Stream) Push(x int64) {
	if !s.started {
		s.be, s.best, s.started = x, x, true
		return
	}
	if x > s.be+x {
		s.be = x
	} else {
		s.be += x
	}
	if s.be > s.best {
		s.best = s.be
	}
}

func main() {
	var s Stream
	for _, x := range []int64{-2, 1, -3, 4, -1, 2, 1, -5, 4} {
		s.Push(x)
	}
	fmt.Println("streaming best:", s.best) // 6

	// distributed: split into two shards, summarize, merge
	left := merge(merge(merge(leaf(-2), leaf(1)), leaf(-3)), leaf(4))
	right := merge(merge(merge(merge(leaf(-1), leaf(2)), leaf(1)), leaf(-5)), leaf(4))
	fmt.Println("merged best:", merge(left, right).best) // 6
}
```

### 8.2 Java — overflow-safe Kadane with explicit contract

```java
public class SafeKadane {
    // contract: empty subarray NOT allowed; throws on empty input.
    static long maxSubarrayNonEmpty(int[] a) {
        if (a.length == 0) throw new IllegalArgumentException("empty input");
        long be = a[0], best = a[0];
        for (int i = 1; i < a.length; i++) {
            // 64-bit accumulation avoids 32-bit overflow on large arrays
            be = Math.max((long) a[i], be + a[i]);
            best = Math.max(best, be);
        }
        return best;
    }

    // contract: empty subarray allowed (floor of 0).
    static long maxSubarrayAllowEmpty(int[] a) {
        long be = 0, best = 0;
        for (int x : a) {
            be = Math.max(0, be + x);
            best = Math.max(best, be);
        }
        return best;
    }

    public static void main(String[] args) {
        int[] allNeg = {-3, -1, -2};
        System.out.println(maxSubarrayNonEmpty(allNeg));  // -1
        System.out.println(maxSubarrayAllowEmpty(allNeg)); // 0  (different contract!)
    }
}
```

### 8.3 Python — scalable 2D submatrix with transpose optimization

```python
def kadane(col_sum):
    be = best = col_sum[0]
    for i in range(1, len(col_sum)):
        be = max(col_sum[i], be + col_sum[i])
        best = max(best, be)
    return best


def max_submatrix(grid):
    if not grid or not grid[0]:
        raise ValueError("empty grid")
    R, C = len(grid), len(grid[0])
    # transpose so the squared loop runs over the smaller dimension
    if R > C:
        grid = [list(row) for row in zip(*grid)]
        R, C = C, R
    best = grid[0][0]
    for top in range(R):
        col_sum = [0] * C
        for bottom in range(top, R):
            row = grid[bottom]
            for c in range(C):
                col_sum[c] += row[c]      # incremental band; never re-sum
            best = max(best, kadane(col_sum))
    return best


if __name__ == "__main__":
    g = [
        [1, 2, -1, -4, -20],
        [-8, -3, 4, 2, 1],
        [3, 8, 10, 1, 3],
        [-4, -1, 1, 7, -6],
    ]
    print(max_submatrix(g))  # 29
```

---

## 9. Observability and Testing

A maximum-subarray result is a single number — one wrong value looks like any other. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force `O(n²)` oracle on small `n` | Catches initialization, off-by-one, and contract bugs. |
| All-negative array | The one input that distinguishes the two contracts; must be explicit. |
| Single-element and empty array | Boundary of the loop and the input guard. |
| All-positive array | Answer must equal the total sum (run never restarts). |
| Index-reconstruction round-trip | Recomputed sum of `a[l..r]` must equal the reported value. |
| Product variant on `[neg, neg]`, `[neg, 0, neg]` | Verifies the min/max swap and the zero reset. |
| Circular variant on all-negative | Verifies the wrap-empty guard. |
| Mergeable-segment associativity | `merge` must be associative: random splits give identical `best`. |

The single most valuable test is the **brute-force oracle** comparison on random small arrays *including all-negative and mixed-sign cases*. It catches the overwhelming majority of bugs.

### 9.1 Property tests

```text
for random array a (sizes 1..8, values -5..5, including all-negative):
    assert kadane(a) == bruteforce(a)
    (value, l, r) = kadane_with_indices(a)
    assert value == sum(a[l:r+1])               # reconstruction consistency
    assert max_product(a) == bruteforce_product(a)
for random split point s:
    assert seg(a) == merge(seg(a[:s]), seg(a[s:]))   # monoid associativity
```

These run on a few hundred random instances per CI build and give high confidence. The associativity test is especially good at catching a broken `merge` that happens to be correct only for balanced splits.

### 9.1b A merge associativity counter-trace

To see why the test matters, here is a *broken* merge that passes naive tests but fails associativity — a real bug pattern:

```
BROKEN merge (forgets L.total in bestPrefix):
    bestPrefix = max(L.bestPrefix, R.bestPrefix)        // WRONG: missing L.total +
    ...

On a = [3, -10, 3, 3]:
    leftmost-balanced fold:  merge(merge(3,-10), merge(3,3))  → best = 6   (correct: a[2..3])
    left-to-right fold:      ((( 3 ⊕ -10) ⊕ 3) ⊕ 3)         → best = 6   (still correct here)
On a = [-10, 3, 3, -10]:
    balanced:  best computed as 6   (correct)
    the broken bestPrefix yields a wrong cross term on some splits → best = 3  (WRONG)
```

The defect surfaces only when a prefix that should carry `L.total` is combined across a particular split point — exactly what randomized associativity testing (compare `seg(a)` against `merge(seg(a[:s]), seg(a[s:]))` for random `s`) catches and what example-based tests on a single split miss.

### 9.2 Production guardrails

For a service computing best-window statistics at scale: log the **window indices** alongside the value so an anomalous answer is inspectable; assert the reconstructed sum matches; validate the numeric type can hold `n · max|a[i]|` before running (fail fast on overflow risk); and pin the empty-subarray contract in a config flag that is logged, so a contract regression is visible in audit trails.

---

## 10. Failure Modes

### 10.1 The phantom-zero (wrong contract)

Initializing `best = 0` when the contract requires a non-empty subarray silently returns `0` on all-negative input. Passes every test that has a positive element. Mitigation: initialize to `a[0]`, and put an all-negative case in the suite tied to the stated contract.

### 10.2 Silent overflow

A 32-bit accumulator (or 64-bit for products) wraps and produces a plausible wrong number. Mitigation: size the accumulator to `n · max|a[i]|` (sum) and use overflow-detecting multiply or big integers (product); fail fast if the type cannot hold the worst case.

### 10.3 Product variant tracking only the max

Tracking only `curMax` misses positive products formed by two negatives. Mitigation: always carry `curMin` too and swap on a negative element.

### 10.4 Circular wrap-empty

`total − minSubarray` returns `0` when all elements are negative, implying the empty subarray. Mitigation: if the plain Kadane max is negative, return it directly.

### 10.5 Sliding-window confusion

Using streaming Kadane to answer "best subarray in the last `W` elements." Plain Kadane cannot evict old elements. Mitigation: use a monotonic-deque-over-prefix-sums or a segment tree for fixed-width windows; document that streaming Kadane is prefix-only.

### 10.6 2D blow-up

Running `O(R²·C)` on a tall-thin grid without transposing, or materializing per-band submatrices. Mitigation: transpose so the squared factor is the smaller side; keep only the `O(C)` band.

### 10.7 Floating-point drift

Long `float64` streams accumulate rounding in `bestEndingHere`. Mitigation: compensated (Kahan) summation in the accumulation step; the `max` comparison itself is exact.

### 10.8 Subarray-vs-subsequence confusion

A requirement that turns out to permit gaps is not a maximum-subarray problem at all (the answer is just the sum of the positives). Mitigation: confirm "contiguous" in the spec; the brute-force oracle should be the *contiguous* one so a mismatch surfaces early.

### 10.9 Out-of-order stream corruption

Feeding logically-out-of-order elements to scalar streaming Kadane (§2.3b) silently corrupts the answer, because the `O(1)` state cannot re-splice a late element into the middle of the discarded history. Mitigation: order by a watermark before pushing, or use the re-mergeable segment tree if exactness under reordering is required. This failure is invisible in tests that feed data in order.

### 10.10 Resetting sessionized streams to zero

In a sessionized stream (§2.3), resetting the running state to `0` at a session boundary instead of to the first element of the new session reintroduces the phantom-zero bug *per session* — an all-negative session wrongly reports `0`. Mitigation: at each boundary, initialize from the next element, not `0`, and carry the contract through the reset.

### 10.11 Timing the wrong thing in benchmarks

A common measurement error: timing graph/array generation or array cloning alongside the algorithm, which dwarfs Kadane's actual `O(n)` cost and makes it look slow. Mitigation: clone inputs *outside* the timed region, warm up the JIT, and report the mean of several runs (see [`tasks.md`](./tasks.md) Task B). Kadane's true throughput is `~10^9` elements/sec compiled; a benchmark showing far less is usually measuring allocation.

---

## 11. Summary

- Kadane's `O(1)`-state form is a genuine **streaming** algorithm for the prefix maximum-subarray; it cannot do fixed-width sliding windows (use prefix-sum + monotonic deque or a segment tree for those).
- Chunk summaries `(total, bestPrefix, bestSuffix, best)` **merge associatively**, enabling distributed and segment-tree maximum-subarray — the divide-and-conquer node promoted to a data structure.
- **Overflow** is the dominant numeric hazard: size accumulators to `n·max|a[i]|` for sums; products explode in ~63 steps, so detect overflow, use big integers, or work in log-space.
- The **empty-subarray contract** is a correctness decision, not a detail: non-empty (init to `a[0]`) vs empty-allowed (floor of `0`) are different problems distinguished only by the all-negative case — pin it to the business requirement and test it.
- The **2D submatrix** is `O(R²·C)`; transpose so the squared factor is the smaller side, accumulate the column band incrementally, and parallelize across the outer `top` loop.
- **Bounded-length** ("at least/at most `k`") variants are linear via the prefix-sum + windowed-minimum lens, not via the raw `be = max(x, be+x)` recurrence, which has no length notion.
- Always keep a brute-force oracle and feed it the all-negative, single-element, and all-positive cases; it catches the contract, overflow, and off-by-one bugs that account for nearly every real failure.

### Decision summary

- **Stream, prefix best** → streaming Kadane, `O(1)` state.
- **Distributed / range queries** → mergeable segment monoid / segment tree.
- **Large sums or products** → 64-bit / int128 / big-int / log-space per the worst-case bound.
- **2D hot region** → row-band + 1D Kadane, transposed to the smaller squared factor.
- **At least/at most `k`** → prefix sums + windowed minimum (monotonic deque), not raw Kadane.
- **Empty allowed?** → decide from the requirement; the all-negative test is the discriminator.
- **Gaps allowed (subsequence)?** → not a max-subarray problem; sum the positives.
- **Out-of-order stream?** → watermark-buffer before scalar Kadane, or use a re-mergeable segment tree.
- **Penalized / length-weighted?** → subtract the penalty per element and run plain Kadane on the shifted array.

### Production readiness checklist

Before shipping a maximum-subarray component, confirm:

1. **Contract pinned** — non-empty vs empty-allowed, logged in config, with an all-negative test tied to it.
2. **Accumulator sized** — `assert(n·maxAbs ≤ TYPE_MAX)` at startup; products use overflow detection.
3. **Indices returned** — callers almost always need `(value, l, r)`; bake it in, don't retrofit.
4. **Oracle in CI** — `O(n²)` brute force compared on random small inputs including all-negative, zeros, single-element.
5. **2D transposed** — entry point transposes when `R > C`; band kept at `O(C)`.
6. **Stream ordering** — out-of-order policy decided (buffer / drop / re-merge); not silently fed to scalar Kadane.
7. **Benchmark hygiene** — generation/cloning outside the timed region; mean of ≥3 warmed runs.

Each item maps to a failure mode in §10; the checklist is the operational form of this whole document.

References to study further: Bentley's *Programming Pearls* (the origin and the `O(n)` derivation), the maximum-scoring-segment problem in bioinformatics (Ruzzo–Tompa, for the all-maximal-segments variant relevant to anomaly detection), the segment-tree maximum-subarray monoid (the standard competitive-programming structure for range queries), Kahan compensated summation (for long floating-point streams), and sibling topics `13-dynamic-programming` and the `sliding-window-technique` skill. The mathematical underpinnings — the optimality proof, the prefix-minimum equivalence, the segment-monoid associativity, and the bounded-length reductions — are developed in [`professional.md`](./professional.md); the variant implementations and their edge cases are in [`middle.md`](./middle.md); end-to-end interview-grade solutions are in [`interview.md`](./interview.md).
