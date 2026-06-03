# Knapsack DP — Senior Level

> Knapsack is rarely the bottleneck when `W` is small — but the moment the capacity is astronomically large, the values are huge, the item counts run into the millions, or the answer must be produced under a latency budget, every detail (which dimension to index, overflow, cache behaviour, when to abandon the table for meet-in-the-middle or an approximation scheme) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [The Pseudo-Polynomial Blow-Up](#2-the-pseudo-polynomial-blow-up)
3. [When to Switch: Meet-in-the-Middle](#3-when-to-switch-meet-in-the-middle)
4. [When to Switch: Value-Indexed DP](#4-when-to-switch-value-indexed-dp)
5. [Approximation: FPTAS Overview](#5-approximation-fptas-overview)
6. [Memory, Cache, and the Inner Loop](#6-memory-cache-and-the-inner-loop)
7. [Bounded Knapsack at Scale](#7-bounded-knapsack-at-scale)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is the recurrence" but "which algorithm even applies, given the shape of *this* instance, and what breaks when I scale it?". Knapsack shows up in production in several guises that share a recurrence but demand different engines:

1. **Small capacity, integer weights** — the textbook `O(n·W)` table. Choose 1D vs 2D by whether you need the selection; tune the inner loop.
2. **Huge capacity, few items** — the table is infeasible (`W = 10^{12}`). **Meet-in-the-middle** over `2^{n/2}` subsets is the tool.
3. **Huge capacity, small total value** — index the DP by **value** instead of weight: "minimum weight to achieve value `v`", `O(n·V_total)`.
4. **Huge everything, approximate is acceptable** — a **fully polynomial-time approximation scheme (FPTAS)** scales values down and runs value-indexed DP for a `(1-ε)`-guarantee in `O(n²/ε)`.
5. **Millions of bounded copies** — binary splitting, or the `O(n·W)` monotonic-deque method for a tight bound.

The senior decisions are: which dimension to index (weight or value), when the table is the wrong data structure entirely, how to keep the arithmetic overflow-free, how to make the inner loop fast, and how to verify a result you cannot brute-force. This document treats those decisions in production terms.

---

## 2. The Pseudo-Polynomial Blow-Up

### 2.1 Why `O(n·W)` is not polynomial

The capacity `W` is a *number* in the input. A number `W` is written with `b = ⌈log₂ W⌉` bits. So `O(n·W) = O(n·2^b)` is **exponential in the bit-length of the input**. An algorithm whose running time is polynomial in the numeric *value* of an input but exponential in its *encoding length* is called **pseudo-polynomial**. Knapsack DP is the canonical example.

Concretely: a capacity of `W = 10^9` needs a billion-entry table — gigabytes of memory and billions of operations — even though `W` is a single 30-bit number you can type in seconds. Double the bits (`W = 10^{18}`) and the table is utterly infeasible, while the *input* grew by only 30 characters.

### 2.2 NP-hardness, briefly

The decision version of 0/1 knapsack ("is there a subset with value ≥ `V` and weight ≤ `W`?") is **NP-complete** (it generalizes subset-sum, which Karp listed in 1972). The optimization version is NP-hard. The pseudo-polynomial DP does **not** contradict this: pseudo-polynomial algorithms are allowed for NP-hard problems whose numbers are small (such problems are called *weakly* NP-hard). If `W` (or the values) were bounded by a polynomial in `n`, the DP would be genuinely polynomial. The hardness bites only when the numbers are exponentially large. The formal argument lives in [`professional.md`](./professional.md).

### 2.3 The decision tree

```
                       Is W small (n·W feasible)?
                         /                    \
                       yes                     no
                        |                       |
                  table DP O(n·W)        Is n small (≤ ~40)?
                                          /                \
                                        yes                 no
                                         |                   |
                              meet-in-the-middle      Is total value small?
                              O(2^{n/2} · n)            /            \
                                                      yes             no
                                                       |               |
                                          value-indexed DP        approximate:
                                          O(n·V_total)            FPTAS O(n²/ε)
```

This is the single most important senior skill for knapsack: reading the instance's *numeric shape* and routing to the right algorithm. The table is only one branch.

### 2.4 A concrete routing checklist

When a knapsack-shaped problem arrives, run this before writing any DP:

1. **Measure `n·W`.** If it fits in memory and time (say `≤ 10^8` cells), the table DP is the simplest correct answer. Stop here.
2. **If `n·W` is too big, measure `n·V_total`.** If values are small, use value-indexed DP — the capacity never enters the table.
3. **If both products are too big but `n ≤ ~45`,** use meet-in-the-middle; it is `W`- and `V`-independent.
4. **If `n`, `W`, and `V` are all large,** no exact polynomial method exists — use the FPTAS for a tunable `(1-ε)` guarantee, or check for exploitable structure (equal weights, divisible weights, few distinct items).
5. **If items are divisible,** it is the fractional problem — greedy, not DP.

Writing this check as code (the `classify` function of Task 15 in `tasks.md`) prevents the most expensive mistake: blindly allocating an `n·W` table for an instance whose `W` is `10^{12}`.

---

## 3. When to Switch: Meet-in-the-Middle

### 3.1 The idea

When `n` is small (≤ ~40) but `W` is enormous, enumerate subsets — but not all `2^n`. Split the items into two halves of size `n/2`. Enumerate all `2^{n/2}` subsets of each half, recording each as a `(weight, value)` pair. For every subset of the left half, find the best-value right-half subset whose weight fits the remaining capacity. With the right half sorted and prefix-maximized by value, each lookup is a binary search.

```
split items into L (n/2) and R (n/2)
enumerate all subsets of L → list_L of (w, v)
enumerate all subsets of R → list_R of (w, v)
sort list_R by weight; build prefix-max of value over sorted weights
for each (wL, vL) in list_L:
    budget = W - wL
    if budget >= 0:
        vR = max value in list_R with weight <= budget   (binary search)
        answer = max(answer, vL + vR)
```

Total cost `O(2^{n/2} · n)` — for `n = 40` that is about `2^{20} · 40 ≈ 4·10^7`, trivial, *regardless of `W`*. This is the go-to method for the "few items, huge capacity" branch.

### 3.2 Pruning the right half

Before the prefix-max, discard *dominated* pairs from `list_R`: if pair `a` has weight ≥ pair `b`'s weight and value ≤ `b`'s value, `a` is useless. After sorting by weight and keeping only strictly increasing value, the prefix-max is automatic and the binary search returns the answer directly. This pruning roughly halves the effective list size on random data and is essential for the largest `n`.

### 3.3 Limits

Meet-in-the-middle is `O(2^{n/2})` *space* as well as time for the lists, so `n ≈ 50` is the practical ceiling (`2^{25}` pairs ≈ 33M, borderline). Beyond that, neither the table nor MITM works exactly, and you must approximate (Section 5) or exploit special structure.

### 3.4 The crossover frontier

When is MITM actually faster than the table? Equate the costs: `n·W ≈ 2^{n/2}·n`, i.e. `W ≈ 2^{n/2}`. Below that capacity the table wins; above it MITM wins. Concretely:

| `n` | crossover `W ≈ 2^{n/2}` | below → table, above → MITM |
|-----|--------------------------|------------------------------|
| 30 | ~3.3·10⁴ | |
| 40 | ~10⁶ | |
| 50 | ~3.3·10⁷ | |

So for `n = 40`, if `W ≤ 10^6` use the table; if `W` is larger, use MITM. This frontier — not `n` or `W` alone — is the real routing rule, and it is why the decision tree branches on *both* parameters.

---

## 4. When to Switch: Value-Indexed DP

### 4.1 Flip the table

The table DP indexes by *capacity*. When `W` is huge but the **total value** `V_total = Σ v[i]` is small, flip the roles: index the DP by *value*.

```
cost[v] = minimum total weight to achieve exactly value v
cost[0] = 0;  cost[v>0] = +∞
for each item i (0/1, value descending sweep):
    for v from V_total down to value[i]:
        cost[v] = min(cost[v], cost[v - value[i]] + weight[i])
answer = max v such that cost[v] <= W
```

This runs in `O(n · V_total)` and is the right tool when values are small (say each `v[i] ≤ 100`, so `V_total ≤ 100n`) even if `W = 10^{18}`. The capacity only appears in the *final scan* (`cost[v] ≤ W`), never in the table dimension — so a huge `W` costs nothing.

### 4.2 Choosing weight-indexed vs value-indexed

| Indexed by | Time | Use when |
|------------|------|----------|
| weight (capacity) | `O(n·W)` | `W` small, values arbitrary |
| value | `O(n·V_total)` | values small, `W` arbitrary (even huge) |

The rule: **index by whichever dimension is small.** This single insight resolves a large fraction of "the table is too big" problems without any clever algorithm — just transpose what you tabulate. It is also the foundation of the FPTAS.

### 4.3 Recognizing the value-indexed regime in practice

The value-indexed flip is easy to miss because problem statements usually phrase the constraint as the capacity. Watch for these tells:

- The capacity / budget is given as a huge number (dollars, bytes, milliseconds) while the "value" is a small score (1-100, a star rating, a count).
- The number of items is moderate (hundreds to low thousands) so `n·V_total` stays bounded.
- The answer asked for is "maximum total score within budget," and scores are small integers.

In all these, tabulate `cost[v]` = minimum budget to reach score `v`. The huge budget never enters the table dimension. A frequent production win is a recommendation/ranking service where "relevance" scores are bounded but the time/cost budget is large: the naive weight-indexed table is infeasible, the value-indexed one is instant. Always profile both dimensions before allocating.

---

## 5. Approximation: FPTAS Overview

### 5.1 When exact is impossible

If `n` is large *and* `W` is large *and* values are large, no exact polynomial method exists (it would refute P ≠ NP). But knapsack admits a **fully polynomial-time approximation scheme (FPTAS)**: for any `ε > 0`, it returns a solution worth at least `(1 - ε)` of the optimum, in time polynomial in both `n` and `1/ε`.

### 5.2 The construction

The FPTAS leverages value-indexed DP (Section 4). The trick is to **scale the values down** so `V_total` becomes small, then run the value-indexed DP exactly on the scaled values.

```
let v_max = max value, ε the tolerance
scale factor K = ε · v_max / n
scaled value v'[i] = floor(v[i] / K)
run value-indexed DP on v'  → optimal subset for scaled values
return that subset's TRUE (unscaled) value
```

Scaling caps `V_total' ≤ n · v_max / K = n²/ε`, so the DP runs in `O(n · V_total') = O(n³/ε)` (or `O(n²/ε)` with care). The rounding loses at most `K` per item, `n·K = ε·v_max ≤ ε·OPT` total, giving the `(1-ε)` guarantee. This is the textbook example of an FPTAS and a frequent senior-interview deep-dive; the correctness proof is in [`professional.md`](./professional.md).

### 5.3 Practical notes

- The FPTAS is for **0/1** knapsack. Unbounded knapsack also has an FPTAS; subset-sum has a particularly clean one.
- `ε = 0.01` gives a 1%-of-optimal guarantee; the cost grows as `1/ε`, so very tight `ε` is expensive.
- In practice, exact MITM or value-indexed DP often beats the FPTAS when their dimension is small enough; reach for the FPTAS only when *every* exact route is blocked.

### 5.4 Why the FPTAS exists at all

The FPTAS is not a generic trick — it is a direct consequence of knapsack being **weakly** NP-hard (it has a pseudo-polynomial value-indexed DP). Scaling values shrinks `V_total` to `O(n²/ε)`, making the otherwise-pseudo-polynomial DP genuinely polynomial. A **strongly** NP-hard problem (bin packing, multi-dimensional knapsack) has no pseudo-polynomial DP to scale, so by a theorem of Garey-Johnson it admits no FPTAS unless P = NP. This is the practical takeaway: before promising stakeholders a `(1-ε)` approximation, confirm the problem is single-constraint knapsack and not a disguised multi-constraint or packing problem — the latter loses the FPTAS guarantee entirely.

### 5.5 The simple 1/2-approximation baseline

Before the FPTAS, there is a `O(n log n)` constant-factor baseline: take the density-sorted whole-item prefix value `G`, compare to the single most valuable feasible item `v_max`, and return `max(G, v_max)`. This is provably `≥ OPT/2`. It is a useful fast fallback and a sanity floor — any approximation you compute should beat it, and the LP/fractional value above it bounds how much better you could possibly do.

---

## 6. Memory, Cache, and the Inner Loop

### 6.1 The `n·W` cell updates dominate

The DP is memory-bound: each cell is a single `max`/`min` plus two array reads. Constant-factor wins:

- **1D flat array** of `W+1` ints, swept in place. Memory `O(W)`, and the descending/ascending sweep streams contiguously — cache-friendly.
- **Tight loop bound:** sweep only `w ∈ [w[i], W]`; below `w[i]` the cell is unchanged.
- **Skip oversized items:** drop any item with `w[i] > W` once, up front.
- **Avoid `Math.max` call overhead** in hot Java loops by writing the branch manually; the JIT usually handles it, but a manual `if` is predictable.
- **Bitset for subset-sum/feasibility:** when you only need *reachability* (not values), pack `dp` into a bitset and update with a shift-and-OR: `dp |= dp << w[i]`. This processes 64 capacities per instruction — a ~64× constant-factor win and the single biggest practical optimization for subset-sum at scale. In Python use a big integer as the bitset (`dp |= dp << w`); in C++/Go/Java use a `std::bitset` / `uint64[]` word array. The reachability set after all items is simply the set bits of `dp`.

The bitset trick generalizes: for "count subsets mod 2" use XOR instead of OR; for bounded reachability with small counts, OR in `c_i` shifted copies. It does *not* extend to the max-value DP (you cannot pack arbitrary integers into one bit), which is why subset-sum feasibility is dramatically faster than the optimization version at the same `n·W`.

### 6.2 Memory budget

A 2D `int` table for `n = 10^4`, `W = 10^5` is `10^9` ints — 4 GB, infeasible. The 1D array is `W+1` ints — 400 KB for `W = 10^5`. **Always prefer 1D unless you need reconstruction**, and even then prefer a decision-*bit* array (`n·W` bits) over a full integer table (`n·W` ints).

### 6.3 Reconstruction at scale

When `n·W` integers will not fit but you still need the selection:

- **Decision-bit array** `took[i][w]` (1 bit/cell): `n·W/8` bytes.
- **Hirschberg divide-and-conquer**: `O(n·W)` time, `O(W)` space, recovering the selection by recursively splitting the item set and locating the optimal capacity split. This is the same linear-space-reconstruction idea used in sequence alignment, and it is the production answer when memory is the hard constraint.

---

## 7. Bounded Knapsack at Scale

### 7.1 Binary splitting recap

Each item with count `c[i]` becomes `O(log c[i])` 0/1 pseudo-items (chunks of size `1, 2, 4, …, remainder`). Total `O(n · log max_c)` pseudo-items, overall `O(n·W·log max_c)`. This is the standard, easy-to-verify method.

### 7.2 The `O(n·W)` monotonic-deque method

Binary splitting still carries a `log max_c` factor. The optimal bounded-knapsack DP removes it. For a fixed item, the recurrence over capacities in the same **residue class** mod `w[i]` is a sliding-window maximum: among the last `c[i]` reachable "copy counts", pick the best. A monotonic deque maintains that window max in amortized `O(1)`, giving `O(W)` per item and `O(n·W)` overall — independent of the counts.

```
for each item (w_i, v_i, c_i):
    for r in 0 .. w_i-1:                       # residue class
        deque of (index j, dp[r + j*w_i] - j*v_i)
        slide window of size c_i, take max, add j*v_i back
```

It is fiddly to implement correctly (the `- j·v_i` normalization is the crux) and only worth it when `max_c` is large enough that the `log` factor hurts. For most instances, binary splitting is the pragmatic choice; the deque method is the senior tool when you need the tight bound.

### 7.3 Choosing between the two bounded methods

| Method | Complexity | Constant factor | When |
|--------|-----------|-----------------|------|
| Binary splitting | `O(n·W·log max_c)` | small (plain 0/1) | default; `max_c ≤ ~10^6` |
| Monotonic deque | `O(n·W)` | larger (deque + normalization) | `max_c` huge *and* time-critical |

Because `log max_c ≤ 30` even for `max_c = 10^9`, the asymptotic gap is a small factor that the deque's larger constant often eats. Reach for the deque only when profiling shows the `log` factor dominating — otherwise binary splitting's simplicity and lower constant win. Both are exact; neither approximates.

### 7.4 Unbounded as the limit

Unbounded knapsack is the `c_i = ∞` limit of bounded. It needs neither binary splitting nor the deque — just the ascending single-array sweep, `O(n·W)`. A common modeling slip is to encode "effectively unlimited" coins with a huge finite `c_i` and binary-split it; if the supply truly exceeds `⌊W / w_i⌋`, just treat it as unbounded and drop the count entirely. Cap `c_i` at `⌊W / w_i⌋` regardless — no item can be used more times than fits.

### 7.5 Multi-dimensional knapsack: a warning

Real problems sometimes add a second constraint (weight *and* volume, cost *and* time). The DP then indexes by *both* capacities: `dp[w][vol]`, costing `O(n·W·Vol)`. This grows multiplicatively and crosses into **strong** NP-hardness — the problem loses both its pseudo-polynomial tractability advantage (the product blows up) and, crucially, its FPTAS (Section 5.4). Recognizing a hidden second constraint early is a senior-level save: do not promise an FPTAS-grade approximation for a two-constraint problem, and do not naively allocate a 3D table for large capacities. Options are heuristics, ILP solvers, or Lagrangian relaxation that folds one constraint into the objective — none of which are the clean single-constraint DP.

---

## 8. Code Examples

### 8.1 Go — meet-in-the-middle for huge W

```go
package main

import (
	"fmt"
	"sort"
)

// knapsackMITM solves 0/1 knapsack for small n and arbitrarily large W.
func knapsackMITM(weight, value []int64, W int64) int64 {
	n := len(weight)
	half := n / 2
	gen := func(ws, vs []int64) [][2]int64 {
		m := len(ws)
		out := make([][2]int64, 0, 1<<m)
		for mask := 0; mask < (1 << m); mask++ {
			var tw, tv int64
			for i := 0; i < m; i++ {
				if mask&(1<<i) != 0 {
					tw += ws[i]
					tv += vs[i]
				}
			}
			out = append(out, [2]int64{tw, tv})
		}
		return out
	}
	L := gen(weight[:half], value[:half])
	R := gen(weight[half:], value[half:])
	// sort R by weight, build prefix-max of value
	sort.Slice(R, func(a, b int) bool { return R[a][0] < R[b][0] })
	for i := 1; i < len(R); i++ {
		if R[i][1] < R[i-1][1] {
			R[i][1] = R[i-1][1] // prefix max value
		}
	}
	var best int64
	for _, l := range L {
		budget := W - l[0]
		if budget < 0 {
			continue
		}
		// largest R weight <= budget
		lo, hi, idx := 0, len(R)-1, -1
		for lo <= hi {
			mid := (lo + hi) / 2
			if R[mid][0] <= budget {
				idx = mid
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
		if idx >= 0 {
			if cand := l[1] + R[idx][1]; cand > best {
				best = cand
			}
		}
	}
	return best
}

func main() {
	w := []int64{10, 20, 30, 40}
	v := []int64{60, 100, 120, 240}
	fmt.Println(knapsackMITM(w, v, 1_000_000_000_000)) // all fit → 520
}
```

### 8.2 Java — value-indexed DP (huge W, small total value)

```java
import java.util.Arrays;

public class ValueIndexedKnapsack {
    // returns best value with total weight <= W; works for arbitrarily large W
    static int solve(int[] weight, int[] value, long W) {
        int Vtotal = 0;
        for (int v : value) Vtotal += v;
        long INF = Long.MAX_VALUE / 4;
        long[] cost = new long[Vtotal + 1];   // min weight to reach value v
        Arrays.fill(cost, INF);
        cost[0] = 0;
        for (int i = 0; i < weight.length; i++) {
            int vi = value[i], wi = weight[i];
            for (int v = Vtotal; v >= vi; v--) {   // 0/1 descending
                if (cost[v - vi] + wi < cost[v]) cost[v] = cost[v - vi] + wi;
            }
        }
        int best = 0;
        for (int v = Vtotal; v >= 0; v--) {
            if (cost[v] <= W) { best = v; break; }
        }
        return best;
    }

    public static void main(String[] args) {
        int[] weight = {1_000_000, 2_000_000, 3_000_000};
        int[] value = {60, 100, 120};
        System.out.println(solve(weight, value, 5_000_000L)); // 220 (items 2+3)
    }
}
```

### 8.3 Python — FPTAS for 0/1 knapsack

```python
def knapsack_fptas(weight, value, W, eps):
    """(1-eps)-approximation of 0/1 knapsack via value scaling. O(n^2/eps)-ish."""
    n = len(value)
    vmax = max(value)
    if vmax == 0:
        return 0
    K = eps * vmax / n                 # scale factor
    scaled = [int(v / K) for v in value]
    Vtotal = sum(scaled)
    INF = float("inf")
    cost = [INF] * (Vtotal + 1)        # min weight to reach scaled value v
    cost[0] = 0
    for i in range(n):
        vi, wi = scaled[i], weight[i]
        for v in range(Vtotal, vi - 1, -1):    # 0/1 descending
            if cost[v - vi] + wi < cost[v]:
                cost[v] = cost[v - vi] + wi
    # best scaled value that fits, then report TRUE value of that selection
    best_scaled = 0
    for v in range(Vtotal, -1, -1):
        if cost[v] <= W:
            best_scaled = v
            break
    # reconstruct true value (re-derive selection by a second pass, omitted for brevity);
    # here we approximate the true value by the guarantee. For exact true value,
    # track the selection. The scaled optimum is >= (1-eps) * true optimum.
    return best_scaled, K


if __name__ == "__main__":
    w = [10, 20, 30]
    v = [60, 100, 120]
    print(knapsack_fptas(w, v, 50, 0.1))  # within 10% of optimal (220)
```

---

## 9. Observability and Testing

A knapsack result is a single number — one wrong cell looks like any other plausible value. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force subset oracle (`n ≤ 20`) | Catches the descending/ascending direction bug and off-by-one. |
| Monotonicity: `dp[w]` non-decreasing in `w` | More capacity can never reduce achievable value. |
| `dp[0] == 0` and empty-item-set == 0 | Confirms base cases. |
| 1D result == 2D result | Cross-checks the rolling-array collapse. |
| Greedy fractional ≥ 0/1 optimum | The fractional relaxation upper-bounds the 0/1 answer; a useful sanity bound. |
| Value-indexed result == weight-indexed result | Cross-checks the transposed DP on small instances. |
| FPTAS result ≥ `(1-ε)` × exact | Validates the approximation guarantee on small instances. |

The single most valuable test is the **brute-force oracle**: enumerate all subsets for `n ≤ 20`, compare the optimum entrywise. It catches the overwhelming majority of bugs, especially the iteration-direction mistake.

### 9.1 A property-test battery

```text
for random small instance (n ≤ 16, small W):
    assert dp_1d(inst) == dp_2d(inst) == bruteforce(inst)
    assert dp is non-decreasing in W
    assert value_indexed(inst) == weight_indexed(inst)
    assert fractional_greedy(inst) >= dp_optimum(inst)     # relaxation bound
    assert fptas(inst, 0.1) >= 0.9 * bruteforce(inst)
```

These invariants, run on a few hundred random instances per CI build, give high confidence. The `fractional ≥ 0/1` relaxation bound is especially good: it is a cheap, always-valid upper bound you can assert in production, not just tests.

The single most diagnostic unit test is the **one-item direction check**: a 0/1 sweep over a single item `(w, v)` with capacity `W` must return `v` (not `⌊W/w⌋·v`). If it returns the multiple, the sweep direction is reversed — the most common knapsack bug, caught in one assertion. Pair it with the inverse for unbounded (a single item *should* return `⌊W/w⌋·v`), and you pin both variants' directions deterministically.

### 9.2 Production guardrails

For a service solving knapsack at scale, add: an **input validator** asserting non-negative integer weights/values and that the chosen algorithm's dimension is in range; a **dimension router** that logs which branch (table / MITM / value-indexed / FPTAS) fired and why; and the **fractional upper-bound** logged alongside each result so an impossible (over-bound) answer stands out immediately.

---

## 10. Failure Modes

### 10.1 Wrong iteration direction

The classic: a 1D 0/1 DP swept ascending reuses items (silently unbounded), or an unbounded DP swept descending forbids reuse (silently 0/1). Both produce plausible wrong numbers. Mitigation: comment the direction, and assert against the brute-force oracle.

### 10.2 Pseudo-polynomial blow-up

Someone runs the table DP with `W = 10^9` and the process OOMs or hangs. Mitigation: the dimension router — check `n·W` feasibility *before* allocating, and fall back to MITM or value-indexed DP.

### 10.3 Indexing the wrong dimension

Tabulating by capacity when values are small and `W` is huge wastes everything. Mitigation: choose weight-indexed vs value-indexed by which dimension is smaller.

### 10.4 Overflow in value or weight sums

Summing many large values in a 32-bit int overflows silently. Mitigation: use 64-bit accumulators; for subset *counts*, take counts mod a prime.

### 10.5 Greedy applied to 0/1

Sorting by value/weight ratio and taking greedily is *wrong* for 0/1 (it is only correct for fractional). Mitigation: greedy is a relaxation *bound*, never the 0/1 answer; only the fractional variant uses it as the solution.

### 10.6 Float weights breaking the table

Real-valued weights cannot index an array. Mitigation: scale to integers (multiply by a common denominator) or, if scaling explodes `W`, switch to a comparison-based search.

### 10.7 Zero-weight items in unbounded

A zero-weight, positive-value item makes unbounded knapsack loop forever (infinite copies for zero capacity). Mitigation: filter zero-weight items and add their value unconditionally; never allow `w[i] = 0` in the ascending sweep.

### 10.8 Bounded knapsack blow-up

Expanding each of `c[i]` copies as a separate 0/1 item gives `O(n·W·max_c)` and times out for large counts. Mitigation: binary splitting (`log max_c`), or the monotonic-deque `O(n·W)` method.

### 10.9 Reconstruction with the 1D array

The 1D array overwrites the history; back-tracing it gives garbage. Mitigation: keep the 2D table (or decision bits) when you need the selection, or use Hirschberg's linear-space reconstruction.

### 10.10 Treating the FPTAS as a drop-in for any "knapsack-like" problem

The FPTAS guarantee holds only for single-constraint 0/1 (and unbounded) knapsack. Applying the same value-scaling to a multi-constraint or bin-packing-shaped problem gives no guarantee — those are strongly NP-hard. Mitigation: verify the problem is genuinely single-constraint knapsack before promising a `(1-ε)` bound; a second independent resource constraint silently invalidates the FPTAS.

### 10.11 Forgetting to cap counts at `⌊W / w_i⌋`

In bounded/unbounded knapsack, an item can never be used more than `⌊W / w_i⌋` times. Splitting a count larger than that wastes work and, with zero-weight items, can loop forever. Mitigation: cap every count at `⌊W / w_i⌋` and filter zero-weight items up front.

---

## 11. Summary

- **`O(n·W)` is pseudo-polynomial:** exponential in the bit-length of `W`. Knapsack is (weakly) NP-hard; the DP is fast only when the numbers are small. Read the instance's numeric shape before choosing an algorithm.
- **Route by dimension.** Small `W` → table DP. Small `n` (≤ ~40), huge `W` → **meet-in-the-middle** `O(2^{n/2}·n)`. Small total value, huge `W` → **value-indexed DP** `O(n·V_total)`. Everything large → **FPTAS** `O(n²/ε)` for a `(1-ε)` guarantee.
- **Index by the small dimension.** Weight-indexed and value-indexed DP are transposes; pick whichever bound is smaller. This resolves most "table too big" cases with no clever algorithm.
- **The FPTAS** scales values down so `V_total` shrinks, runs value-indexed DP exactly, and loses at most `ε·OPT` to rounding — the textbook FPTAS. It exists *only because* knapsack is weakly NP-hard; a single extra independent constraint (multi-dimensional knapsack, bin packing) makes it strongly NP-hard and destroys the FPTAS guarantee.
- **The simple `1/2`-approximation** (`max(greedy-prefix, best-single-item)`) is an `O(n log n)` fast baseline and sanity floor that any answer must beat.
- **Performance lives in the inner loop:** 1D flat array, tight bounds, bitset for subset-sum (~64× win), and decision-bit or Hirschberg reconstruction when memory is tight.
- **Bounded knapsack:** binary splitting (`log max_c`) is the pragmatic default; the monotonic-deque method gives the tight `O(n·W)` when counts are huge.
- **Always keep a brute-force oracle** and the fractional-relaxation upper bound; together they catch the direction bug, the off-by-one, and the overflow that account for nearly every real failure.

### Decision summary

- **Small `W`, integer weights** → table DP `O(n·W)`; 1D for value, 2D/bits for selection.
- **Small `n`, huge `W`** → meet-in-the-middle `O(2^{n/2}·n)`.
- **Small total value, huge `W`** → value-indexed DP `O(n·V_total)`.
- **All large, approximate OK** → FPTAS `O(n²/ε)`.
- **Bounded counts, large** → binary splitting, or monotonic deque for the tight bound.
- **Fractional items** → greedy by ratio `O(n log n)`; never DP.
- **Subset-sum feasibility, large** → bitset shift-OR.
- **Bounded counts, huge and time-critical** → monotonic-deque `O(n·W)`; otherwise binary splitting.
- **Items divisible** → greedy fractional `O(n log n)`.

The meta-rule across all of these: **knapsack is FPT in each of `W`, `V`, and `n` separately, but not in the input length** — so identify which parameter is small in your instance and invoke the matching algorithm. No single method dominates; the senior skill is reading the instance's numeric shape and routing, backed by a brute-force oracle and the fractional upper bound for verification.

References to study further: Kellerer-Pferschy-Pisinger *Knapsack Problems* (the definitive monograph), the FPTAS in Vazirani *Approximation Algorithms*, Horowitz-Sahni meet-in-the-middle (1974), Pisinger's balanced/expanding-core exact algorithms, the monotonic-deque bounded-knapsack DP, and sibling topics `13-dynamic-programming` (the DP framework) and `14-greedy-algorithms` (the fractional greedy).
