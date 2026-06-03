# Egg Dropping Puzzle (DP Minimax) — Senior Level

> The egg-drop DP is a tiny algorithm with an outsized decision surface: the *same* problem is solved by a quadratic table, a log-time dual, a closed form, or a one-line formula, and choosing wrong by an order of magnitude is the difference between a microsecond and an infeasible job. At the senior level the work is in *constraint-driven formulation selection*, overflow and big-`n` discipline, strategy reconstruction, and a testing harness that pins the minimax answer exactly.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Choosing the Formulation by Constraints](#2-choosing-the-formulation-by-constraints)
3. [Big n and the Trials Dual](#3-big-n-and-the-trials-dual)
4. [The Binomial / Binary-Search Approach](#4-the-binomial--binary-search-approach)
5. [Strategy Reconstruction in Production](#5-strategy-reconstruction-in-production)
6. [Numerical and Overflow Engineering](#6-numerical-and-overflow-engineering)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

> **Reading guide.** Sections 2–4 cover formulation selection and the large-`n` regime; sections 5–6 cover reconstruction and the economics of eggs; section 7 is performance; sections 8–9 are testing and failure modes. If you only read one thing, read section 1.1 (the core reframe) and section 2 (the decision table).

---

## 1. Introduction

At the senior level the question is no longer "what is the recurrence" but "which of the four equivalent computations do I actually run, and what breaks when I scale it?" The egg-drop problem appears in three practical guises that share one engine:

1. **Pure puzzle / interview** — given `(k, n)`, return the minimum worst-case trial count, often with the explicit dropping strategy. `n` is small; clarity wins.
2. **Threshold-finding with a destructive-test budget** — "what is the fewest irreversible experiments that always pin a breaking point", where the candidate range `n` can be enormous (`10^9` request rates, load values, version numbers). Here the quadratic table is fatal and the trials dual is mandatory.
3. **Capacity / scheduling sub-problem** — the minimax recurrence shows up inside larger DPs (e.g. "minimize the worst-case rounds of a probing protocol"); you need the formulation that composes cleanly and avoids recomputation.

All three reduce to: *decide whether you are computing trials-from-floors (`dp[e][f]`) or floors-from-trials (`g(e, t)`), pick the cheapest method for the constraint regime, keep the arithmetic exact, and verify against a brute-force oracle.* This document treats those decisions in production terms.

---

### 1.1 The Core Reframe

Every senior decision in this document flows from one observation: the problem has **two equivalent state spaces**. The textbook one is indexed by `(eggs, floors)` and is large in the floor dimension; the dual is indexed by `(eggs, trials)` and is *small* in the trial dimension because the answer `t*` is at most `n` and usually `O(log n)`. Re-indexing by the small dimension — the trial count — is what turns an infeasible `O(k·n²)` into a trivial `O(k·log n)`. Hold this reframe in mind; everything below is its consequence.

## 2. Choosing the Formulation by Constraints

The four exact methods are mathematically identical but have wildly different cost profiles. The senior skill is matching method to constraints.

| Constraint regime | Best method | Cost | Why |
|-------------------|-------------|------|-----|
| Small `n` (≤ few thousand), want full table | classic `dp[e][f]` | `O(k·n²)` | simplest, table reusable for many queries |
| Medium `n`, want per-state answers | classic + convex binary search on `x` | `O(k·n·log n)` | unimodal inner cost prunes the floor scan |
| Large `n`, only the count | **trials dual** `g(e, t)` | `O(k·t*)` | no `n` dependence except via `t*` |
| Large `n`, `k = 2` | closed form `t(t+1)/2 ≥ n` | `O(1)` | triangular-number inversion |
| Large `n`, large `k` | binomial `Σ C(t, i)` or trials dual | `O(k·t*)` ≈ `O(k·log n)` | `g` collapses toward binary search |
| `k ≥ ⌈log₂(n+1)⌉` | binary search | `O(log n)` | eggs are not the bottleneck |

**The decision rule in one breath:** if you need the count and `n` is large, use the trials dual; if `k = 2`, use the closed form; if you need the full per-state table or the strategy at every state, build the classic table (with the convex speedup if `n` is medium). Always cap `k` at `⌈log₂(n+1)⌉` — eggs beyond that are dead weight and only inflate the loop.

### 2.1 The capping optimization, formally

With `n` floors there are `n + 1` possible critical floors, so any strategy needs at least `⌈log₂(n+1)⌉` drops (each drop is one bit). With that many eggs you can binary-search, achieving the bound. Hence `dp[k][n] = dp[min(k, ⌈log₂(n+1)⌉)][n]`, and you should replace `k` accordingly before any loop. This turns a "`k = 10^6` eggs" input into an effective `k ≈ 30`, removing a six-order-of-magnitude waste.

### 2.1b Quick self-test for "which method?"

Ask three questions in order:

1. **Is `k == 2`?** If yes, use the closed form `t(t+1)/2 ≥ n` (`O(1)`). Done.
2. **After capping `k` at `⌈log₂(n+1)⌉`, is `k == cap`?** If yes, the answer is `⌈log₂(n+1)⌉` (binary search). Done.
3. **Otherwise, is `n` large (> ~10^5) or do I only need the count?** If yes, run the trials dual (`O(k·log n)`); if I need the full per-state table on a small `n`, build the classic table (with the convex/monotone speedup for medium `n`).

This three-question funnel resolves essentially every input. The most common production mistake is skipping question 2 — failing to cap eggs — and then either looping uselessly over millions of eggs or, worse, building the quadratic table for a large `n`.

### 2.2 When the recurrence is a sub-problem

If egg-drop is nested inside a bigger DP, prefer the trials dual: its state `(e, t)` has small `t*`, so memoizing it across the outer DP is cheap, whereas the `dp[e][f]` table is `O(k·n)` per outer state and rarely affordable. Cache the dual table once for the maximum `(k, n)` seen and slice into it.

---

## 3. Big n and the Trials Dual

### 3.1 Why the dual is the only option for large n

The classic table is `O(k·n²)` time and `O(k·n)` space. For `n = 10^9` that is `10^{18}` operations and `10^{10}` integers — both impossible. The trials dual `g(e, t) = g(e-1, t-1) + g(e, t-1) + 1` runs `t*` iterations of `O(k)` work with `O(k)` space, where `t*` is the answer. For `n = 10^9` with plentiful eggs `t* ≈ 30`; with `k = 2`, `t* ≈ 44721`. Either way it is trivially feasible.

### 3.2 Growth-rate reasoning as a sanity check

`g(e, t)` grows like `t^e / e!` for fixed `e`, and like `2^t` once `e ≥ t`. So:

- For `k = 2`: `t* ≈ √(2n)`.
- For `k = 3`: `t* ≈ (6n)^{1/3}`.
- For `k ≥ ⌈log₂(n+1)⌉`: `t* = ⌈log₂(n+1)⌉`.

If your computed `t*` is wildly off these magnitudes, you have a bug. This back-of-envelope check is the senior's first line of defense against an incorrect answer that "looks like a number".

### 3.3 The crossover with eggs

As `k` rises from `1` to `log₂ n`, `t*` falls from `n` to `log₂ n`. The marginal value of an extra egg is large near `k = 1` (each egg roughly takes a root of `n`) and zero past the binary-search threshold. Knowing this lets you answer product questions like "is a third sample worth the cost?" — for `n = 100`, going `1 → 2` eggs cuts trials `100 → 14`, `2 → 3` cuts `14 → 9`, `3 → 4` cuts `9 → 8`; diminishing fast.

---

## 4. The Binomial / Binary-Search Approach

### 4.1 The closed form

The maximum floors coverable with `e` eggs and `t` trials is

```
g(e, t) = Σ_{i=1}^{e} C(t, i).
```

The answer is the smallest `t` with this sum `≥ n`. Two ways to find `t`:

- **Linear scan on `t`**, evaluating the sum incrementally (`C(t, i) = C(t, i-1)·(t-i+1)/i`). Cost `O(k·t*)`.
- **Binary search on `t`** over `[1, n]`, since `g(k, t)` is monotonically increasing in `t`. Cost `O(k·log n·log n)` — useful only when you cannot bound `t*` a priori; the linear scan is usually simpler and faster because `t*` is small.

### 4.2 Why binomials

The closed form is the count of distinct break/survive outcome sequences of length `≤ t` using at most `e` breaks: a decision tree of height `t` with at most `e` "break" edges on any root-to-leaf path can have at most `Σ_{i=0}^{e} C(t, i)` leaves, and subtracting the all-survive leaf gives the `Σ_{i=1}^{e} C(t, i)` floors. The information-theoretic reading: each drop is a bit, but you may "spend" at most `e` of them on breaks. The full proof is in [`professional.md`](./professional.md).

### 4.3 Overflow discipline

`C(t, i)` grows fast; for large `t` and `k` it overflows 64-bit. Mitigations: cap the running sum at `n` and break the inner loop the instant it reaches `n` (you never need the true overflowing value); or use a language big-integer type if you must compute exact `g`. The incremental form `c = c*(t-i+1)/i` stays integer-valued because consecutive binomials divide evenly, but the *intermediate* `c*(t-i+1)` can overflow before the division — use a wide accumulator or reorder.

---

## 5. Strategy Reconstruction in Production

Returning the count is rarely enough in practice; the caller wants the *plan*: "drop from floor 14 first; if it breaks scan 1..13, else drop from 27, …". Two reconstruction routes:

### 5.1 From the trials dual (cheapest)

At the top level with `t*` trials and `k` eggs, the first drop is at floor `g(k-1, t*-1) + 1` from the bottom of the active range. On a **break**, recurse on the lower block with `(k-1, t*-1)`; on a **survive**, recurse on the upper block with `(k, t*-1)`. This emits the full decision tree in `O(t*)` per root-to-leaf path without ever materializing the `O(k·n)` table.

### 5.2 From the classic table (when you already built it)

Store `choice[e][f] = argmin_x ...` while filling `dp`. To reconstruct, start at `(k, n)`, drop at `choice[k][n]`, and follow the break/survive branch into `(e-1, x-1)` or `(e, f-x)`. This costs `O(k·n)` extra memory for `choice` but gives the strategy for *every* `(e, f)`, useful if many queries share the table.

### 5.3 Validating the emitted strategy

A reconstructed strategy must (a) never exceed `t*` drops on any path, (b) never use more than `k` eggs (breaks) on any path, and (c) distinguish all `n + 1` critical floors. A simulation harness that walks the tree for every possible `T ∈ {0, …, n}` and asserts the drop count `≤ t*` is the gold-standard test — it catches off-by-one reconstruction bugs that the count alone hides.

---

## 6. Numerical and Overflow Engineering

### 6.1 The trials dual stays small

`g(e, t)` only needs to be compared against `n`, so cap it: `g[e] = min(g[e-1] + g[e] + 1, n)`. This guarantees no overflow regardless of how large `t` could grow, and the comparison `g[k] >= n` still terminates correctly.

### 6.2 The binomial path needs care

`C(t, i)` for `t` in the tens of thousands (the `k = 2`, `n = 10^9` regime) and `i` up to `k` can exceed 64-bit. Because the *sum* is capped at `n`, break out the moment `total >= n`; you never need the overflowing tail. If exactness of `g` itself is required (rare), use big integers.

### 6.3 The k=2 sqrt

`t = ⌈(-1 + √(1 + 8n)) / 2⌉`. Floating `sqrt` on `1 + 8n` for `n` near `10^{18}` loses precision; use integer square root (`isqrt`) and a correction loop (`while t*(t+1)/2 < n: t += 1`, and a decrement check) to land exactly on the boundary. An off-by-one here silently returns `t* - 1`, an *under*-count that would claim an impossible guarantee.

---

## 6.4 The Economics of an Extra Egg

A recurring product question is "is it worth buying another sample/prototype to test?" The marginal value of the `e`-th egg is precisely `g(e, t) − g(e-1, t) = C(t, e)` floors of extra reach at trial budget `t` (proved in [`professional.md`](./professional.md) §9.1). Translated to the trial count for fixed `n`:

| `n` | 1 egg | 2 eggs | 3 eggs | 4 eggs | 5 eggs | ... | floor |
|-----|-------|--------|--------|--------|--------|-----|-------|
| 100 | 100 | 14 | 9 | 8 | 8 | ... | 7 |
| 1000 | 1000 | 45 | 19 | 14 | 12 | ... | 10 |
| 10^6 | 10^6 | 1414 | 181 | 63 | 36 | ... | 20 |

The first egg-to-second jump is enormous (a square-root collapse); each subsequent egg yields less, and beyond `⌈log₂(n+1)⌉` eggs the trial count cannot drop at all. So the senior answer to "buy another sample?" is: *yes, dramatically, for the first one or two; rapidly diminishing after that; never past `log₂ n`.* This is the egg-drop analogue of the classic "marginal cost vs marginal benefit" curve, and it falls straight out of the binomial structure.

## 7. Code Examples

### 7.1 Go — formulation dispatcher with egg capping and strategy reconstruction

```go
package main

import (
	"fmt"
	"math/bits"
)

// minTrials picks the cheapest exact method and caps eggs at the binary-search bound.
func minTrials(k, n int) int {
	if n == 0 {
		return 0
	}
	cap := bits.Len(uint(n)) // ceil(log2(n+1)) upper-ish bound; refine below
	for (1 << (cap - 1)) >= n+1 {
		cap--
	}
	for (1<<cap)-1 < n {
		cap++
	}
	if k > cap {
		k = cap // eggs beyond the binary-search bound are useless
	}
	g := make([]int, k+1)
	t := 0
	for g[k] < n {
		t++
		for e := k; e >= 1; e-- {
			v := g[e-1] + g[e] + 1
			if v > n {
				v = n // cap to avoid overflow; comparison still valid
			}
			g[e] = v
		}
	}
	return t
}

// strategy emits the optimal first-drop floors along the "all survive" spine.
func strategy(k, n int) []int {
	t := minTrials(k, n)
	floors := []int{}
	base := 0     // bottom of the active range (exclusive)
	eggs := k
	for trials := t; trials > 0 && base < n; trials-- {
		// floors below a break, with eggs-1 eggs and trials-1 trials:
		below := coverable(eggs-1, trials-1, n)
		drop := base + below + 1
		if drop > n {
			drop = n
		}
		floors = append(floors, drop)
		base = drop // survive -> climb
	}
	return floors
}

func coverable(e, t, cap int) int {
	g := make([]int, e+1)
	for s := 1; s <= t; s++ {
		for ee := e; ee >= 1; ee-- {
			v := g[ee-1] + g[ee] + 1
			if v > cap {
				v = cap
			}
			g[ee] = v
		}
	}
	if e == 0 {
		return 0
	}
	return g[e]
}

func main() {
	fmt.Println(minTrials(2, 100)) // 14
	fmt.Println(strategy(2, 100))  // [14 27 39 50 60 69 77 84 90 95 99 100]
}
```

### 7.2 Java — binomial method with overflow-safe capping

```java
public class EggDropBinomial {
    // Smallest t with sum_{i=1..k} C(t,i) >= n, capping the sum to dodge overflow.
    static int minTrials(int k, int n) {
        if (n == 0) return 0;
        int cap = 0;
        while ((1L << cap) - 1 < n) cap++; // ceil(log2(n+1))
        if (k > cap) k = cap;
        for (int t = 1; ; t++) {
            long total = 0, c = 1; // C(t,0)
            for (int i = 1; i <= k; i++) {
                c = c * (t - i + 1) / i;
                total += c;
                if (total >= n) return t; // never let total overflow meaningfully
            }
        }
    }

    public static void main(String[] args) {
        System.out.println(minTrials(2, 100));            // 14
        System.out.println(minTrials(3, 100));            // 9
        System.out.println(minTrials(1_000_000, 1_000_000_000)); // capped: ~30
    }
}
```

### 7.3 Python — trials dual plus a strategy simulator (the gold-standard test)

```python
def min_trials(k: int, n: int) -> int:
    if n == 0:
        return 0
    cap = (n + 1).bit_length()  # >= ceil(log2(n+1))
    while (1 << (cap - 1)) - 1 >= n:
        cap -= 1
    while (1 << cap) - 1 < n:
        cap += 1
    k = min(k, cap)
    g = [0] * (k + 1)
    t = 0
    while g[k] < n:
        t += 1
        for e in range(k, 0, -1):
            g[e] = min(g[e - 1] + g[e] + 1, n)  # cap to avoid overflow
    return t


def coverable(e: int, t: int, cap: int) -> int:
    g = [0] * (e + 1)
    for _ in range(t):
        for ee in range(e, 0, -1):
            g[ee] = min(g[ee - 1] + g[ee] + 1, cap)
    return g[e] if e > 0 else 0


def simulate(k: int, n: int) -> int:
    """Worst-case drops over all T in 0..n, following the optimal balanced strategy.
    Returns the max drops used; must equal min_trials(k, n)."""
    from functools import lru_cache

    @lru_cache(maxsize=None)
    def worst(eggs, lo, hi):  # floors (lo, hi] still ambiguous
        if hi - lo == 0:
            return 0
        if eggs == 1:
            return hi - lo  # linear scan
        # optimal balanced first drop
        drop = lo + coverable(eggs - 1, min_trials(eggs - 1, hi - lo - 1) + 1, hi - lo) + 1
        drop = min(drop, hi)
        broke = worst(eggs - 1, lo, drop - 1)
        survived = worst(eggs, drop, hi)
        return 1 + max(broke, survived)

    return worst(k, 0, n)


if __name__ == "__main__":
    print(min_trials(2, 100))  # 14
    assert simulate(2, 100) == min_trials(2, 100)
    assert simulate(3, 50) == min_trials(3, 50)
    print("strategy simulation matches the DP answer")
```

---

## 7.4 A Worked Constraint-to-Method Trace

To make the dispatch concrete, here is how a senior reasons through four real query shapes:

| Query | Reasoning | Method | Result |
|-------|-----------|--------|--------|
| `k=2, n=100` | `k = 2` exactly | `K2_CLOSED_FORM` | `⌈(-1+√801)/2⌉ = 14` |
| `k=2, n=10^18` | `k = 2`, but `n` huge | `K2_CLOSED_FORM` | `√(2·10^18) ≈ 1.41·10^9` |
| `k=10^6, n=10^9` | cap `k` to `⌈log₂(10^9+1)⌉ = 30`; now `k ≥ 30 = cap` | `BINARY_SEARCH` | `30` |
| `k=5, n=10^9` | `k = 5 < 30`, large `n` | `TRIALS_DUAL` | dual loop, `t* ≈ (120·10^9)^{1/5} ≈ 164` |

The third row is the trap that catches juniors: a "million eggs" input looks like it needs a giant loop, but the egg-cap collapses it to the 30-drop binary-search answer instantly. The fourth row shows the dual doing real work — `t* ≈ 164` iterations of `O(5)` each, microseconds total, where the `O(k·n²)` table would need `~5·10^{18}` operations.

## 7.5 Composing Egg-Drop Inside a Larger DP

When the minimax recurrence is a *sub-routine* of a bigger optimization (e.g. "minimize the worst-case rounds of a multi-stage probing protocol where each stage is an egg-drop"), three engineering rules apply:

1. **Memoize the dual, not the table.** The dual state `(e, t)` is tiny (`t* = O(log n)`), so caching `g(e, t)` across outer states is cheap; caching `dp[e][f]` (size `O(k·n)`) per outer state usually is not.
2. **Precompute once at the largest scale.** Build `g(e, t)` for the maximum `(k, n)` the outer DP will ever request, then slice into it with binary search per inner query — `O(log t*)` per lookup.
3. **Keep the answer monotone-friendly.** `dp[k][n]` is non-decreasing in `n` and non-increasing in `k`; an outer DP that relies on monotonicity (for a Lagrangian or parametric search) can exploit this directly instead of recomputing.

## 8. Observability and Testing

An egg-drop result is a single integer — one wrong value looks like any other. Build verification in from day one.

| Check | Why |
|-------|-----|
| Brute-force recursion oracle on small `(k, n)` | Catches off-by-one in the split and the base cases. |
| Growth-magnitude sanity (`t* ≈ √(2n)` for `k=2`, etc.) | Flags a result off by an order of magnitude. |
| `dp[1][n] == n` and `dp[k][0] == 0` | Confirms the base cases. |
| `dp[k][n] == ⌈log₂(n+1)⌉` for `k ≥ log₂(n+1)` | Confirms the egg-cap and binary-search limit. |
| Cross-method agreement (table vs dual vs binomial vs `k=2` form) | Four independent computations agreeing is strong evidence. |
| Strategy simulator over all `T` | Confirms the reconstructed plan never exceeds `t*` and uses `≤ k` breaks. |
| Monotonicity: `dp[k][n]` non-decreasing in `n`, non-increasing in `k` | A violation is an immediate red flag. |

The single most valuable test is **cross-method agreement plus the strategy simulator**: compute `t*` four ways and assert equality, then simulate the emitted strategy against every possible critical floor. Together they catch essentially every real bug.

### 8.1 A property-test battery

```text
for random small k in [1, 8], n in [0, 64]:
    assert table(k, n) == dual(k, n) == binomial(k, n)       # cross-method
    assert table(1, n) == n                                  # one egg
    assert table(k, 0) == 0                                  # zero floors
    if k >= ceil(log2(n+1)): assert table(k, n) == ceil(log2(n+1))
    assert dual(k, n) <= dual(k, n+1)                        # monotone in n
    assert dual(k+1, n) <= dual(k, n)                        # monotone in k
    assert simulate(k, n) == table(k, n)                     # strategy is valid & tight
```

### 8.2 Production guardrails

For a service answering "min destructive tests" queries: log the back-of-envelope magnitude (`√(2n)` etc.) alongside each result so anomalies stand out; validate inputs (`k ≥ 0`, `n ≥ 0`); cap `k` before looping; and short-circuit the closed form for `k = 2`. Cache the dual table once for the largest `(k, n)` seen and slice it for repeated queries.

---

### 8.3 Cross-method agreement harness (the most valuable test)

Because four independent computations must produce the same integer, disagreement among them localizes bugs precisely. A compact harness:

```python
def table(k, n):
    dp = [[0] * (n + 1) for _ in range(k + 1)]
    for f in range(n + 1):
        dp[1][f] = f
    for e in range(2, k + 1):
        for f in range(1, n + 1):
            best = f
            for x in range(1, f + 1):
                best = min(best, 1 + max(dp[e - 1][x - 1], dp[e][f - x]))
            dp[e][f] = best
    return dp[k][n]


def dual(k, n):
    if n == 0:
        return 0
    g = [0] * (k + 1)
    t = 0
    while g[k] < n:
        t += 1
        for e in range(k, 0, -1):
            g[e] = min(g[e - 1] + g[e] + 1, n)
    return t


def binomial(k, n):
    if n == 0:
        return 0
    t = 0
    while True:
        t += 1
        total, c = 0, 1
        for i in range(1, k + 1):
            c = c * (t - i + 1) // i
            total += c
            if total >= n:
                return t


def cross_check():
    for k in range(1, 7):
        for n in range(0, 61):
            a, b, c = table(k, n), dual(k, n), binomial(k, n)
            assert a == b == c, (k, n, a, b, c)
    print("table == dual == binomial on all k<=6, n<=60")
```

When this passes, the three formulations agree on hundreds of instances; a single mismatch immediately tells you which method (and which `(k, n)`) is wrong. Pair it with the strategy simulator from §7.3 of the code examples and you have near-complete coverage.

## 9. Failure Modes

### 9.1 Quadratic table on large n

Building `dp[e][f]` when `n = 10^9` exhausts memory and time. Mitigation: detect large `n` and route to the trials dual or closed form.

### 9.2 Off-by-one in the floor split

"Below `x`" is `x-1` floors; "above `x`" is `f-x` floors. Swapping or miscounting yields `13` instead of `14`. Mitigation: the brute-force oracle on small `n` catches this immediately.

### 9.3 Wrong base case for one egg

Setting `dp[1][f]` to anything but `f` (e.g. `log f`, mistaking it for the unlimited-egg case) under-counts and claims an impossible guarantee. Mitigation: assert `dp[1][n] == n` in tests.

### 9.4 Overflow in binomials or sqrt

`C(t, i)` overflows 64-bit for large `t`; floating `sqrt` rounds the `k=2` answer down by one. Both produce *under*-counts that falsely claim a guarantee. Mitigation: cap sums at `n`; use integer sqrt with a correction loop.

### 9.5 Updating g in the wrong order

Iterating `e` low→high reads the current trial's `g[e-1]`, double-counting and over-estimating coverage (under-counting trials). Mitigation: always iterate `e` high→low; the cross-method test catches the discrepancy.

### 9.6 Forgetting to cap eggs

A `k = 10^6` input with `n = 1000` loops a million eggs uselessly. Mitigation: replace `k` with `min(k, ⌈log₂(n+1)⌉)` up front.

### 9.7 Confusing the answer with the critical floor

The DP returns the *number of trials*, not the critical floor `T` (which is discovered by running the experiment). Conflating them is a modeling error. Mitigation: name the function `minTrials`, never `findFloor`.

---

## 10. Summary

- The egg-drop minimax DP has four equivalent computations — classic table (`O(k·n²)`), convex-pruned table (`O(k·n·log n)`), trials dual (`O(k·log n)`), and the `k=2` closed form (`O(1)`). The senior skill is matching method to constraints.
- **Cap eggs at `⌈log₂(n+1)⌉`** before any loop; extra eggs cannot beat the binary-search lower bound.
- For **large `n`** the only viable methods are the **trials dual** `g(e,t)=g(e-1,t-1)+g(e,t-1)+1` (smallest `t` with `g(k,t) ≥ n`) and the **binomial closed form** `Σ C(t,i)`; the quadratic table is infeasible.
- **Overflow discipline:** cap `g` at `n`; cap binomial sums at `n` and break early; use integer sqrt for `k=2`. Under-counts falsely claim impossible guarantees, so err toward exactness.
- **Strategy reconstruction** comes for free from the dual (first drop at `g(k-1, t*-1) + 1`); validate it with a simulator that walks every possible critical floor and asserts `≤ t*` drops and `≤ k` breaks.
- **Testing** rests on cross-method agreement plus the strategy simulator, anchored by a brute-force recursion oracle on small inputs and growth-magnitude sanity checks.

### Production checklist

Before shipping an egg-drop solver, confirm each of the following:

1. **Eggs capped** at `⌈log₂(n+1)⌉` before any loop.
2. **`g` capped at `n`** in the dual to prevent overflow.
3. **`k = 2` routed to the closed form** with integer sqrt and a correction loop.
4. **Base cases asserted** in tests: `dp[1][n] == n`, `dp[k][0] == 0`, `dp[k][n] == ⌈log₂(n+1)⌉` for `k ≥ ⌈log₂(n+1)⌉`.
5. **Cross-method agreement** (table vs dual vs binomial) on small inputs in CI.
6. **Strategy simulator** validating any emitted plan against every `T ∈ {0..n}`.
7. **Monotonicity guards**: `dp` non-decreasing in `n`, non-increasing in `k`.
8. **Naming discipline**: the function returns trials, not the critical floor — name it `minTrials`, never `findFloor`.

Each item maps to a failure mode in §9; the checklist is the operational distillation of this document.

### Decision summary

- **Small `n`, full table or per-state strategy** → classic `dp[e][f]` (with convex binary search if `n` is medium).
- **Large `n`, just the count** → trials dual `g(e, t)`, `O(k·log n)`.
- **`k = 2`** → closed form `t(t+1)/2 ≥ n`, `O(1)`.
- **Large `k`** → cap at `⌈log₂(n+1)⌉`, then dual or binomial.
- **Need the dropping plan** → reconstruct from the dual, then simulate over all `T` to validate.
- **`k ≥ log₂(n+1)`** → plain binary search; eggs are not the bottleneck.

### Real-world mapping

The egg-drop DP is the exact model for "find a threshold with a fixed budget of destructive tests":

- **Crash-testing prototypes** — a limited number of crash-test units (eggs) to find the impact speed (floor) at which a part fails.
- **Load/stress testing** — a fixed number of irreversible stress runs to locate the load at which a system degrades, when each run consumes a sacrificial environment.
- **Version bisection with expensive setup** — when reproducing a regression burns a costly, non-reusable resource per attempt, the minimax DP bounds the worst-case attempts.
- **A/B teardown experiments** — destructive experiments where you cannot re-run the same subject.

In every case the senior moves are identical: cap the "eggs" at `⌈log₂(n+1)⌉`, use the trials dual for large ranges, reconstruct and simulate the test schedule, and — crucially — confirm the test is *deterministic and sharp*; if the threshold is noisy, the minimax guarantee is void and a statistical method is required instead.

References to study further: the minimax / decision-tree formulation, the binomial-sum identity `Σ C(t, i)`, convexity of the inner cost for the `O(k·n·log n)` speedup, and sibling DP topics in `13-dynamic-programming`. The mathematical proofs of correctness and the convexity argument are in [`professional.md`](./professional.md).
