# Rod Cutting (Unbounded DP) — Senior Level

> Rod cutting is a clean `O(n^2)` textbook DP — but the moment `n` is large, the rod is real steel feeding a cutting line, kerf and yield matter, or the problem grows a second stock dimension, the gap between the textbook recurrence and the *actual* industrial cutting-stock problem (which is NP-hard) becomes a design and correctness decision. This document treats the production realities: scaling `n`, the connection to (and divergence from) real cutting-stock, memory layout, testing, and failure modes.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Scaling n: When O(n^2) Hurts](#2-scaling-n-when-on2-hurts)
3. [The Real Cutting-Stock Connection (and Why It Is Harder)](#3-the-real-cutting-stock-connection-and-why-it-is-harder)
4. [Memory and Layout](#4-memory-and-layout)
5. [Variant Engineering: Cost-Per-Cut, Bounded, Multi-Stock](#5-variant-engineering-cost-per-cut-bounded-multi-stock)
6. [Numerical and Integer Concerns](#6-numerical-and-integer-concerns)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is not "what is the recurrence" but "what am I actually modeling, and what breaks when I scale or productionize it?" Rod cutting shows up in three guises that share one DP engine:

1. **Pure value DP under a length budget** — "maximize revenue cutting one rod of length `n` with a known price-per-length table." This is the textbook case, `O(n^2)`, exact integer arithmetic.
2. **Profit DP with operational costs** — "maximize revenue *minus* per-cut kerf/labor cost, possibly with a minimum sellable length." Still polynomial, but the recurrence must model where costs are incurred or it silently overstates profit.
3. **A subproblem inside true cutting-stock** — the 1-D rod recurrence is the *pricing/column-generation* inner loop of the real industrial problem (minimize the number of stock rods to satisfy a demand for many piece lengths). The outer problem is **NP-hard**; rod cutting is the easy, exact inner piece.

Each guise reuses the same `dp` fill; what differs is the semiring (max-revenue vs min-cost vs feasibility), the cost model, and whether rod cutting is the *whole* problem or merely an inner loop. Getting these distinctions right up front prevents the two most expensive senior mistakes: shipping a quadratic loop that should have been `O(n·m)`, and promising an exact polynomial answer for a problem that is actually NP-hard.

The senior decisions are: how to keep `n` (and any second dimension) tractable, how to model costs without corrupting the objective, how to lay out memory for large fills, and how to verify a result whose value is opaque.

A useful mental frame: the *textbook* recurrence is a solved problem — you will almost never get it wrong after the junior level. What actually breaks in production is everything *around* it: the inner loop that scans `1..len` instead of the offered lengths and blows the latency budget; the 32-bit accumulator that wraps on a long rod; the cut model that forgets the saw destroys material; the cache rebuilt per request; and, most dangerously, the conflation of this polynomial problem with the NP-hard cutting-stock problem a stakeholder actually has in mind. This document is organized around those failure surfaces, not the recurrence itself.

---

## 2. Scaling n: When O(n^2) Hurts

### 2.1 The quadratic wall

The plain fill is `Θ(n^2)`: the outer loop runs `n` times, the inner first-cut loop up to `n`. For `n` up to a few tens of thousands this is fine. At `n = 10^5` it is `~10^10` operations — too slow for an interactive request. Three escape routes, in order of preference:

- **Bound the distinct piece lengths.** In practice a price sheet has `m` *distinct* sellable lengths, `m ≪ n` (you cannot sell a 7,431-long piece if no one quotes it). Iterate only over those `m` lengths: `O(n · m)`. This is the single biggest real-world win — the inner loop is over *offered* lengths, not over `1..len`.
- **Exploit structure in the price table.** If `price[c]` is *concave* or *linear* in `c`, the optimum has a simple closed form (e.g., for linear prices, sell whole or all-unit pieces — no DP needed). Detect and special-case these.
- **Approximate / greedy for monotone-density tables.** If the price *density* `price[c]/c` has a single best length, repeatedly cutting that length (and handling the small remainder) is near-optimal or exact; verify against the DP offline.

### 2.2 The `O(n · m)` reformulation

When only `m` distinct lengths `L = {ℓ_1, …, ℓ_m}` are sellable, the recurrence restricts the inner loop:

```
dp[len] = max over ℓ in L with ℓ <= len of ( price[ℓ] + dp[len - ℓ] )
```

This is the standard unbounded-knapsack loop (sibling `02`) and is `O(n · m)`. For a price sheet with, say, 30 lengths and `n = 10^6`, that is `3·10^7` operations — feasible — versus `5·10^11` for the dense `O(n^2)` loop. **Always reduce the inner loop to the offered lengths in production.**

### 2.3 Single-source vs all-lengths

The DP naturally computes `dp[len]` for *every* `len` up to `n`. If many rods of different lengths share one price sheet, that is a feature: one `O(n·m)` fill answers all of them by table lookup. Do not recompute per rod — fill once to the maximum length, then `dp[len]` is an `O(1)` query for any shorter rod, and reconstruction is `O(len)` per query.

### 2.4 A Concrete Latency Budget

To make the asymptotics tangible, here is a back-of-envelope latency table assuming ~`10^9` simple operations/second (a conservative compiled-language rate):

| `n` | dense `O(n^2)` ops | dense latency | `m=30` offered `O(n·m)` ops | offered latency |
|-----|--------------------|---------------|------------------------------|-----------------|
| `10^3` | `5·10^5` | < 1 ms | `3·10^4` | < 1 ms |
| `10^4` | `5·10^7` | ~50 ms | `3·10^5` | < 1 ms |
| `10^5` | `5·10^9` | ~5 s | `3·10^6` | ~3 ms |
| `10^6` | `5·10^{11}` | ~8 min | `3·10^7` | ~30 ms |

The dense fill crosses from "interactive" to "batch-only" around `n = 10^4`–`10^5`; the offered-lengths fill stays interactive far beyond. In a request-serving context, the offered-lengths reformulation is not an optimization — it is the difference between a viable endpoint and a timeout. Profile with the *actual* `m` (distinct quoted lengths), which is usually a few dozen regardless of `n`.

---

## 3. The Real Cutting-Stock Connection (and Why It Is Harder)

### 3.1 What the textbook problem is *not*

Textbook rod cutting maximizes the revenue of cutting **one** rod given a price *per length*. The real **cutting-stock problem (CSP)** is different and much harder: you have an unlimited supply of identical stock rods of length `Λ`, a **demand** `d_ℓ` for pieces of each length `ℓ`, and you want to **minimize the number of stock rods** used (equivalently, minimize waste/trim) to meet all demands. There is no per-length "price"; the objective is rod count.

### 3.2 Why CSP is NP-hard

1-D cutting-stock is NP-hard (it contains bin-packing as a special case: packing items into bins of size `Λ` is exactly choosing how to cut stock rods to satisfy unit demands). Bin-packing is NP-hard, so CSP is too. There is no known polynomial algorithm; you fall back to:

- **ILP formulations** solved with branch-and-bound / branch-and-price.
- **Column generation (Gilmore-Gomory).** The classic approach: the *master* LP chooses how many of each *cutting pattern* to use; the *pricing subproblem* — "find the most valuable new pattern" — is exactly an **unbounded knapsack on one rod**, i.e. **rod cutting**, where the per-length "prices" are the LP dual values. So textbook rod cutting is literally the polynomial inner engine that makes the NP-hard outer problem tractable in practice.

### 3.3 The boundary, precisely

| Aspect | Textbook rod cutting | Real cutting-stock |
|--------|----------------------|--------------------|
| Objective | maximize revenue (prices given) | minimize stock rods / waste (no prices) |
| Input | one rod, price-per-length | many identical stock rods, demand-per-length |
| Complexity | `O(n^2)` or `O(n·m)`, exact | NP-hard (contains bin-packing) |
| Role of rod cutting | the whole problem | the pricing subproblem of column generation |
| Constraints | none (unbounded) | demand satisfaction, integer pattern counts |

The senior takeaway: when a stakeholder says "we want to cut steel optimally," clarify *which* problem. If they have prices and one rod, it is the polynomial DP here. If they have demands and want to minimize stock/waste, it is NP-hard CSP, and rod cutting is only the inner loop — do not promise an exact polynomial solution for the outer problem.

### 3.4 How Rod Cutting Serves as the Pricing Subproblem

In Gilmore-Gomory column generation, the master LP minimizes `Σ_p x_p` (number of rods cut with pattern `p`) subject to meeting demand `Σ_p a_{ℓp} x_p ≥ d_ℓ` for each length `ℓ`, where `a_{ℓp}` is how many length-`ℓ` pieces pattern `p` produces. Solving the LP relaxation yields **dual values** `π_ℓ` (the marginal value of producing one more length-`ℓ` piece). The pricing subproblem asks: *is there a cutting pattern with reduced cost `< 0`*, i.e. a pattern `p` with `Σ_ℓ a_{ℓp} π_ℓ > 1`? Finding the *most* valuable pattern is:

```
maximize  Σ_ℓ a_ℓ · π_ℓ   subject to   Σ_ℓ a_ℓ · ℓ ≤ Λ,   a_ℓ ∈ ℤ_{≥0}
```

which is **exactly unbounded knapsack** (capacity `Λ`, item `ℓ` has weight `ℓ` and value `π_ℓ`) — i.e. **rod cutting with the dual values as prices**. Each column-generation iteration runs one `O(Λ·m)` rod-cutting DP to find the entering pattern, adds it to the master LP, and repeats until no improving pattern exists. So the polynomial rod-cutting DP is invoked many times inside the (exponential-worst-case) outer loop. Understanding this is the difference between "I know a textbook DP" and "I understand where it lives in a real optimization stack."

### 3.5 When the Approximation Is Good Enough

For many real lines, the LP relaxation's rounded solution (round pattern counts up) is within a few percent of optimal — the **rounding gap** for 1-D cutting-stock is provably small (the "modified integer round-up property" holds for almost all instances). So in practice you often *do not* solve the NP-hard integer problem exactly: you solve the LP via column generation (rod cutting inside), round, and accept a near-optimal plan. Set this expectation with stakeholders: "exact is intractable, but we get provably-near-optimal cheaply."

---

## 4. Memory and Layout

### 4.1 The `dp` array

Plain rod cutting needs one `dp[0..n]` array and one `choice[0..n]` array — `O(n)` space, `8(n+1)` bytes each for 64-bit values. For `n = 10^6` that is ~8 MB per array, comfortable. There is no 2-D table for the unbounded single-rod case (unlike 0/1 knapsack, which sometimes uses a 2-D table before space optimization).

### 4.2 When the bounded/multi-stock variant grows a dimension

The bounded variant (caps per length) or a multi-stock-length variant can introduce a second dimension (which type, or which stock length). Keep it 1-D when possible by the rolling-array trick (process types in an outer loop, update `dp[0..n]` in place with the correct loop direction). Only materialize a 2-D table when you must reconstruct *which type* contributed at each step and the rolling array loses that information — then store a compact `choice` per cell or recompute the decision by re-deriving from the 1-D table.

**Worked memory budget.** Concrete numbers for `int64` arrays:

| `n` | `dp[]` (8(n+1) B) | `+ choice[]` | 2-D bounded `[m][n]`, `m=30` |
|-----|-------------------|--------------|------------------------------|
| `10^3` | ~8 KB | ~16 KB | ~240 KB |
| `10^4` | ~80 KB | ~160 KB | ~2.4 MB |
| `10^5` | ~800 KB | ~1.6 MB | ~24 MB |
| `10^6` | ~8 MB | ~16 MB | ~240 MB |

The 1-D arrays stay comfortably in cache-friendly territory through `n = 10^5`; the 2-D bounded table is what forces a memory conversation at scale. The rolling-array reformulation keeps even the bounded variant at the 1-D footprint, materializing the second dimension only on the reconstruction path — usually the right tradeoff.

### 4.3 Reconstruction storage

`choice[0..n]` is the cheap, standard reconstruction aid. An alternative that avoids the extra array: after computing `dp[]`, *re-derive* the cut at each step by scanning offered lengths for the one satisfying `dp[len] == price[ℓ] + dp[len - ℓ]`. That trades `O(n)` reconstruction-array space for `O(len · m)` recomputation time on the reconstruction path — worth it only when memory is the binding constraint.

### 4.4 Cache and Concurrency for Batched Service

A service answering many rod-cutting queries against a slowly-changing price sheet should treat the filled `dp[]` and `choice[]` as a **read-only cache built once per price-sheet version**:

- **Build once, share read-only.** Fill `dp[0..N]` (to the maximum supported rod length `N`) when the price sheet loads. Subsequent queries are `O(1)` value lookups and `O(len)` reconstructions against the immutable arrays — safe to share across threads/goroutines without locking.
- **Invalidate on price change.** When the sheet changes, rebuild the tables and atomically swap the shared pointer (copy-on-write). Never mutate the live arrays in place while readers are active.
- **Do not rebuild per request.** Rebuilding `dp[]` for every query is the dominant latency and GC regression at scale — the rod-cutting analogue of rebuilding a matrix-power ladder per request. Symptom: latency scaling with `N` (or `N·m`) on *every* call instead of only on price-sheet updates.

This pattern turns an `O(N·m)` fill into a per-version cost amortized over millions of `O(1)` queries.

---

## 5. Variant Engineering: Cost-Per-Cut, Bounded, Multi-Stock

### 5.1 Cost-per-cut at scale

Charging a fee `cutCost` per saw cut (kerf + labor) changes the objective to profit. The recurrence subtracts the fee only when a remainder is severed (`c < len`); selling whole costs nothing. A common real refinement: the kerf also *consumes length* — each cut destroys `κ` units of material. Then cutting a length-`c` first piece off a length-`len` rod leaves `len - c - κ` (not `len - c`). Model it as:

```
dp[len] = max( price[len],                              # sell whole, no cut
               max over c in 1..len-κ-1 of price[c] + dp[len - c - κ] - cutCost )
```

The `- κ` inside the index is the *material loss*; the `- cutCost` is the *money loss*. Both must be modeled or yield estimates are wrong on a real line. This is still `O(n·m)`.

### 5.2 Bounded with binary splitting

When each length has a cap `limit[ℓ]`, the naive "try `0..limit[ℓ]` copies" loop is `O(n · Σ limit[ℓ])`. Binary-split each bounded type into `O(log limit[ℓ])` pseudo-items of sizes `1, 2, 4, …` (powers of two summing to the cap), then run 0/1 knapsack over the pseudo-items: `O(n · Σ log limit[ℓ])`. This is the standard bounded-knapsack speedup and matters when caps are large. For a cap of `10^6`, that is a `~50,000×` reduction in the per-length work (`10^6` vs `~20`), the difference between minutes and milliseconds at large `n`.

### 5.3 Multiple stock lengths

If stock comes in several base lengths `Λ_1, …, Λ_s` (each with a cost), and you want the cheapest way to obtain a target multiset of pieces, you are drifting toward CSP and away from the clean DP. For a *single* target rod with a *choice* of where to start, it stays a DP; for *demand satisfaction across many rods*, it is NP-hard (Section 3). Know which side of the line you are on before committing to an exact algorithm.

### 5.4 Reconstruction in the Variant World

Each variant changes what `choice[]` must record:

- **Plain / cost-per-cut:** `choice[len]` = first-cut length; reconstruction is the standard backward walk. The cost-per-cut variant's `choice[]` is structurally identical — the fee affects the *value*, not the *decision encoding*.
- **Kerf:** the backward walk must subtract `choice[len] + κ` (piece plus destroyed material), not just `choice[len]`; otherwise reconstructed pieces overshoot the rod. The emitted *sold* lengths still sum to less than `n` by the total kerf — assert `Σ pieces + κ·(#cuts) == n`.
- **Bounded:** `choice[]` over a 1-D rolling array loses *which type* was added at each capacity. Either keep a 2-D `choice[type][len]` (more memory) or re-derive by scanning types whose `dp` delta matches. Track the remaining cap per type during reconstruction to stay consistent.

The general rule: the reconstruction invariant must be *restated per variant* (what should the pieces, plus losses, sum to?), and asserted — silent reconstruction drift is the variant-specific failure that the plain-case invariant does not catch.

### 5.5 Worked Kerf Example

`price = [_, 1, 5, 8, 9]`, `cutCost = 0`, kerf `κ = 1`, `n = 4`. Each split destroys 1 unit:

```
dp[0]=0, dp[1]=price[1]=1
dp[2]: sell whole price[2]=5; or cut c=1 -> leaves 2-1-κ=0 -> price[1]+dp[0]=1. Best 5.
dp[3]: whole price[3]=8; cut c=1 -> leaves 3-1-1=1 -> price[1]+dp[1]=2; cut c=2 -> leaves 0 -> price[2]=5. Best 8.
dp[4]: whole price[4]=9; cut c=1 -> leaves 2 -> price[1]+dp[2]=6; cut c=2 -> leaves 1 -> price[2]+dp[1]=6;
       cut c=3 -> leaves 0 -> price[3]=8. Best 9 (sell whole).
```

With kerf, the `2+2` plan that won the plain problem now needs `2 + κ + 2 = 5 > 4` of material — impossible — so the rod is sold whole for `9`. Modeling the kerf flipped the optimum; ignoring it (using the plain DP) would have falsely claimed `10` from a `2+2` cut that physically does not fit.

---

## 6. Numerical and Integer Concerns

### 6.1 Overflow

Revenue accumulates additively across up to `n` pieces. With prices up to `P` and `n` pieces, the max revenue is `≤ n · P`. For `n = 10^6` and `P = 10^4`, that is `10^{10}` — overflows 32-bit `int`. **Use 64-bit** (`int64`/`long`) for `dp[]` in any non-toy instance. The cost-per-cut variant can go *negative* transiently in candidates; ensure the type is signed and the `best` initializer is truly minimal (`Int64.Min`, not `0`).

### 6.2 No floating point

All quantities (lengths, prices, counts) are integers. Do not introduce `double` for "average price" heuristics on the exact path — rounding can flip a tie and produce a suboptimal cut list. Keep floats out of the DP; use them only in offline analysis (e.g., estimating `price[c]/c` density for special-casing). The one legitimate place floating point appears is the *LP relaxation* of the outer cutting-stock problem (Section 3.4) — but even there, the rod-cutting pricing subproblem itself stays integer; only the master LP's dual values are real-valued, and they feed in as *prices*, not as table indices.

### 6.3 Sentinels

For the min-style or feasibility-style variants (e.g., "must use exactly length `n`, return -1 if impossible"), use a sentinel (`-INF`/`None`) distinct from any real revenue, and propagate it correctly (`sentinel + anything = sentinel`). Mixing a `0` sentinel with a legitimate `0` revenue is a classic bug.

### 6.4 Sentinel Arithmetic Safety

When the recurrence adds `price[c] + dp[len - c]` and `dp[len - c]` may be a `-INF` sentinel, a naive `INF = Long.MIN_VALUE` will *underflow* on addition. Use a sentinel with headroom: `NEG = Long.MIN_VALUE / 4`, and **skip** sentinel operands before adding (`if dp[rem] == NEG: continue`). This mirrors the `INF = MAX/4` discipline used in min-plus matrix algebra: leave enough room that an accidental add of two sentinels does not wrap around into a plausible-looking value. A wrapped sentinel is the worst kind of bug — it produces a large finite number that passes casual inspection but is meaningless.

### 6.5 Exact Counts Beyond One Word

If a downstream requirement needs the *exact* optimal revenue and it exceeds 64 bits (only when `n·P` is astronomically large — rare for revenue, common for the *count of optimal plans*), two options:

- **Big integers.** Switch `dp[]` to arbitrary-precision integers (Python `int`, Java `BigInteger`, Go `math/big`). Each add/compare is no longer `O(1)` but `O(digits)`, so the fill becomes `O(n·m·digits)`. Acceptable for modest `n`.
- **CRT across primes.** Run the DP independently modulo several coprime primes whose product exceeds the value's bound (`n·P`, or the count bound), then reconstruct via the Chinese Remainder Theorem. Each modular run is `O(n·m)` and they are embarrassingly parallel. This is the right choice when the value is large but bounded and the per-prime arithmetic stays single-word.

For the common case — revenue fitting in 64 bits — neither is needed; this is purely for exact large-magnitude requirements, most often when *counting* optimal cut plans (which grows like the number of compositions) rather than valuing them.

---

## 7. Code Examples

### 7.1 Go — `O(n·m)` rod cutting over offered lengths, 64-bit, with reconstruction

```go
package main

import "fmt"

// Offered length ell with price p.
type Offer struct{ Len int; Price int64 }

func rodCutOffered(offers []Offer, n int) (int64, []int) {
	const negInf = int64(-1) << 62
	dp := make([]int64, n+1)
	choice := make([]int, n+1) // chosen length, 0 = none
	for length := 1; length <= n; length++ {
		dp[length] = negInf
		for _, o := range offers {
			if o.Len <= length {
				if v := o.Price + dp[length-o.Len]; v > dp[length] {
					dp[length] = v
					choice[length] = o.Len
				}
			}
		}
		if dp[length] == negInf {
			dp[length] = 0 // no offer fits this exact length; leave it unfilled
			choice[length] = 0
		}
	}
	pieces := []int{}
	for length := n; length > 0 && choice[length] > 0; length -= choice[length] {
		pieces = append(pieces, choice[length])
	}
	return dp[n], pieces
}

func main() {
	offers := []Offer{{1, 1}, {2, 5}, {3, 8}, {6, 17}}
	rev, cuts := rodCutOffered(offers, 8)
	fmt.Println("revenue:", rev, "cuts:", cuts)
}
```

### 7.2 Java — cost-per-cut with material kerf

```java
public class RodKerf {
    // price indexed by length; cutCost per cut; kerf = material lost per cut.
    static long rodCutKerf(long[] price, int n, long cutCost, int kerf) {
        final long NEG = Long.MIN_VALUE / 4;
        long[] dp = new long[n + 1];
        for (int length = 1; length <= n; length++) {
            long best = price[length];                 // sell whole, no cut, no kerf
            for (int c = 1; c + kerf < length; c++) {  // a real split: needs room for kerf + remainder
                int rem = length - c - kerf;
                if (dp[rem] == NEG) continue;
                long v = price[c] + dp[rem] - cutCost;
                if (v > best) best = v;
            }
            dp[length] = best;
        }
        return dp[n];
    }

    public static void main(String[] args) {
        long[] price = {0, 1, 5, 8, 9, 10, 17, 17, 20};
        System.out.println(rodCutKerf(price, 8, 1, 0)); // kerf=0 -> plain cost-per-cut
    }
}
```

### 7.3 Python — fill once, query many rods; verify reconstruction

```python
def build_dp(price_by_len, n):
    """price_by_len: dict {length: price}. Fill dp[0..n] over offered lengths."""
    NEG = float("-inf")
    dp = [0] * (n + 1)
    choice = [0] * (n + 1)
    offers = sorted(price_by_len.items())
    for length in range(1, n + 1):
        best, bc = NEG, 0
        for ell, p in offers:
            if ell <= length:
                v = p + dp[length - ell]
                if v > best:
                    best, bc = v, ell
        dp[length] = best if best != NEG else 0
        choice[length] = bc
    return dp, choice


def reconstruct(choice, n):
    pieces, length = [], n
    while length > 0 and choice[length] > 0:
        pieces.append(choice[length])
        length -= choice[length]
    return pieces


if __name__ == "__main__":
    prices = {1: 1, 2: 5, 3: 8, 6: 17}
    dp, choice = build_dp(prices, 8)
    # one fill answers every rod length up to 8 by lookup:
    for rod in (4, 6, 8):
        cuts = reconstruct(choice, rod)
        assert sum(cuts) == rod, "pieces must sum to rod length"
        assert sum(prices[c] for c in cuts) == dp[rod], "prices must sum to dp"
        print(rod, "->", dp[rod], cuts)
```

### 7.4 Python — brute-force oracle and a property-test harness

```python
import random
from functools import lru_cache


def brute(price, n):
    @lru_cache(None)
    def f(m):
        if m == 0:
            return 0
        return max(price[c] + f(m - c) for c in range(1, m + 1))
    return f(n)


def dp_value(price, n):
    dp = [0] * (n + 1)
    for length in range(1, n + 1):
        dp[length] = max(price[c] + dp[length - c] for c in range(1, length + 1))
    return dp[n]


def property_tests(trials=300):
    rng = random.Random(7)
    for _ in range(trials):
        n = rng.randint(0, 14)
        price = [0] + [rng.randint(0, 9) for _ in range(n)]
        assert dp_value(price, n) == brute(price, n), (price, n)
        assert dp_value(price, 0) == 0
    print("all property tests passed")


if __name__ == "__main__":
    property_tests()
```

This is the harness referenced in Section 8: a few hundred random small instances comparing the DP against the brute-force oracle catches base-case, loop-range, and reuse bugs before they reach production.

---

## 8. Observability and Testing

A DP result is opaque — one wrong `dp[n]` looks like any other number. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force recursion oracle on small `n` | Catches base-case, loop-range, and reuse bugs. |
| Reconstruction invariants (`Σ pieces == n`, `Σ prices == dp[n]`) | Catches `choice[]` recording bugs and off-by-ones. |
| Monotonicity sanity (`dp[len] >= dp[len-1]` when a length-1 price is non-negative) | A non-monotone curve usually signals a bug (you can always sell an extra unit). |
| `dp[0] == 0` | Confirms the base case. |
| Cost-per-cut: `cutCost = 0` reduces to plain | Regression anchor for the variant. |
| Bounded: `limit = ∞` reduces to unbounded | Regression anchor for the bounded path. |
| Determinism across languages | Same offers, same `n`, same tie convention → identical Go/Java/Python output. |

The single most valuable test is the **brute-force oracle**: a recursive `max` over first cuts for `n <= ~20`, compared to the DP. It catches the overwhelming majority of bugs. The second most valuable is the **reconstruction invariant** pair — they turn a silent wrong cut list into a loud assertion failure.

### 8.1 A property-test battery

```text
for random small price sheet, random n in [0, 18]:
    assert dp_value(sheet, n) == brute_recursive(sheet, n)     # the oracle
    cuts = reconstruct(...)
    assert sum(cuts) == n                                       # covers the rod
    assert sum(price[c] for c in cuts) == dp_value(sheet, n)    # achieves the optimum
    assert dp_value(sheet, 0) == 0                              # base case
for cost variant:
    assert dp_cost(sheet, n, 0) == dp_value(sheet, n)           # cost 0 == plain
```

Run on a few hundred random sheets in CI. The oracle plus the two reconstruction invariants give high confidence; the `cost = 0` and `limit = ∞` reductions guard the variants against drift.

### 8.2 Production Guardrails

For a live cutting-optimization service, add runtime guardrails beyond CI tests:

- **Input validator.** Assert `n ≥ 0`, all prices non-negative (or document the signed case), and the price index range matches `n`. Reject malformed sheets at the boundary, not deep in the DP.
- **Magnitude check.** Log `dp[n]` alongside the bound `n · max_price` (Proposition 5.3 in [`professional.md`](./professional.md)); a result near the bound on a sparse sheet is suspicious and worth flagging.
- **Reconstruction assertion in production (sampled).** On a sampled fraction of requests, run the two invariants (`Σ pieces == n`, `Σ prices == dp[n]`) live; a failure indicates a corrupted cache or a code regression and should page.
- **Version stamping.** Tag each cached table with the price-sheet version and a content hash, so a stale or mismatched cache is detectable in logs.

### 8.3 What a Wrong Answer Looks Like

Because `dp[n]` is a bare number, distinguish the common failure signatures:

| Symptom | Likely cause |
|---------|--------------|
| Answer slightly *too low* | inner loop misses `c = len` (no sell-whole) |
| Answer wildly large / negative | 32-bit overflow, or wrapped sentinel |
| Answer too *high* vs reality | unbounded loop used for a bounded/0-1 problem (over-reuse) |
| Pieces don't sum to `n` | reconstruction subtracts wrong amount (kerf or off-by-one) |
| Right value, wrong cuts | inconsistent tie rule across versions |

Matching a symptom to its cause turns debugging from guesswork into a lookup. The brute-force oracle on the same input confirms the diagnosis.

---

## 9. Failure Modes

### 9.1 Inner loop over `1..len` at scale
Iterating every integer length when only `m` are offered turns `O(n·m)` into `O(n^2)` and blows the latency budget. Mitigation: loop over offered lengths only (Section 2.2).

### 9.2 32-bit overflow
Large `n` and prices push revenue past `2^31`. Symptom: a suddenly negative or wrapped `dp[n]`. Mitigation: 64-bit `dp[]`; signed type for the cost variant.

### 9.3 Cut cost charged on the whole rod
Subtracting `cutCost` even when `c = len` undercounts the sell-whole profit and flips decisions. Mitigation: charge only when a remainder is severed (`c < len`).

### 9.4 Forgotten kerf material loss
Modeling the per-cut *fee* but not the per-cut *material loss* `κ` overestimates yield on a real line (you "recover" length the saw actually destroyed). Mitigation: subtract `κ` from the remainder index, not just money from the value.

### 9.5 Treating unbounded as 0/1 (or vice versa)
Using the 0/1 loop direction forbids reusing a length (undercounts revenue); using the unbounded loop for a bounded problem reuses beyond the cap (overcounts). Mitigation: pin down reuse semantics and pick the matching loop structure (Section 5.2).

### 9.6 Promising an exact polynomial solution for real cutting-stock
Confusing the polynomial single-rod DP with the NP-hard demand-satisfaction CSP leads to an undeliverable promise. Mitigation: clarify the objective (revenue vs rod-count/waste); for CSP, use column generation with rod cutting as the *inner* pricing step (Section 3.2), and set expectations about heuristic/ILP solve times.

### 9.7 Memo initialized to a legitimate value
A `0`-initialized memo collides with `dp[0] = 0` and short-circuits recomputation. Mitigation: a sentinel distinct from any real revenue.

### 9.8 Non-deterministic cut lists
Inconsistent `>`/`>=` tie handling across runs or languages yields different (still optimal) cut lists, breaking golden tests. Mitigation: fix one tie convention and document it.

### 9.9 Rebuilding the DP table per request
In a batched service, recomputing `dp[]` from scratch for every query (instead of caching the per-version fill) wastes `O(N·m)` per request and churns the allocator. Symptom: latency scaling on every call rather than only on price-sheet updates. Mitigation: build once per price-sheet version, share read-only, swap atomically on change (Section 4.4).

### 9.10 Unvalidated stakeholder "stops" vs "cuts" vs "pieces"
Business language is ambiguous: "5 cuts" might mean 5 saw operations (6 pieces) or 5 resulting pieces. Misreading it shifts every index. Mitigation: pin down the unit explicitly and translate to the recurrence; assert against a human-specified expected output, since the math is internally consistent for *some* interpretation and will not flag the mismatch itself.

---

### 9.11 A Failure-Mode Triage Flow

When a production rod-cutting result is reported wrong, work the failure modes in cost order (cheapest checks first):

```
1. Re-run the brute-force oracle on the exact reported input (small n).
   -> mismatch confirms a real bug; match suggests a spec/units misread (9.10).
2. Inspect the inner loop range: does it reach c = len?  (9.3 / too-low symptom)
3. Check the accumulator type and sentinel headroom.       (9.2, 6.4 / wild values)
4. Verify reuse semantics vs the loop structure.           (9.5 / too-high symptom)
5. Run the reconstruction invariants live.                 (9.4 missing-kerf / sum mismatch)
6. Confirm the cache is per-version, not per-request.       (9.9 / latency, not value)
```

This ordering reflects that the cheapest, highest-yield check (the oracle) catches most bugs, and the structural checks (loop range, types, reuse) catch the rest. Latency regressions (step 6) are distinct from value bugs and surface in metrics, not in wrong numbers.

## 10. Summary

- Plain rod cutting is `O(n^2)` and exact, but in production the inner loop should iterate over the `m` *offered* lengths, giving `O(n·m)` — the single biggest practical speedup, and it makes large `n` feasible.
- One fill to the maximum length answers *every* shorter rod by `O(1)` lookup; do not recompute per rod.
- The textbook problem (maximize revenue, prices given, one rod) is **not** the industrial **cutting-stock problem** (minimize stock rods / waste to meet demands), which is **NP-hard** (it contains bin-packing). Rod cutting is the polynomial **pricing subproblem** inside Gilmore-Gomory column generation for CSP — the easy inner engine of a hard outer problem.
- Model costs precisely: charge a cut fee only when a remainder is severed (`c < len`), and subtract the kerf material loss `κ` from the remainder index when the saw consumes material — both or your yield is wrong.
- Use 64-bit revenue; keep floats out of the exact path; use sentinels distinct from legitimate revenues.
- Memory is `O(n)` (one `dp` plus one `choice`); only the bounded/multi-stock variants grow a dimension, and binary splitting keeps the bounded case `O(n · Σ log limit)`.
- Test with a brute-force oracle and the two reconstruction invariants (pieces sum to `n`, prices sum to `dp[n]`); anchor variants with `cutCost = 0` and `limit = ∞` reductions.

### Decision summary

- **One rod, prices given, modest `n`** → plain `O(n^2)` DP.
- **One rod, `m` offered lengths, large `n`** → `O(n·m)` unbounded-knapsack loop.
- **Per-cut fee / kerf** → model fee on `c < len` and material loss on the remainder index.
- **Capped lengths** → bounded knapsack; binary-split large caps.
- **Minimize stock rods / waste to meet demand** → NP-hard CSP; column generation with rod cutting as the pricing step; expect ILP/heuristic solve times.
- **Many queries, one slowly-changing sheet** → build the table once per version, share read-only, swap on change.
- **Batch / offline, exact value needed beyond one machine word** → CRT across primes (size by `n·P`), or big integers if `n` is small.

### Operational checklist

Before shipping a rod-cutting service, confirm:

1. Inner loop iterates **offered** lengths, not `1..len` (latency).
2. `dp[]` is **64-bit** and sentinels have headroom (`MIN/4`).
3. The sell-whole option (`c = len`) is reachable in the loop.
4. Reconstruction invariants are asserted (live-sampled in prod).
5. Cut fees charged only on `c < len`; kerf subtracted from the remainder index.
6. The table is **cached per price-sheet version**, not rebuilt per request.
7. Reuse semantics (unbounded / bounded / 0-1) match the loop structure.
8. The brute-force oracle runs in CI on random small instances.

References to study further: CLRS Ch. 15 (rod cutting as the DP introduction); Gilmore & Gomory (1961, 1963) on the cutting-stock problem and column generation; Martello & Toth, *Knapsack Problems*, for bounded-knapsack binary splitting; sibling topics `02-unbounded-knapsack` and `19-coin-change`.
