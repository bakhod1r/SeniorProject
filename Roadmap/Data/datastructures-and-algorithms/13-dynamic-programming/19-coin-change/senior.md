# Coin Change (Unbounded Counting DP) — Senior Level

> Coin change is trivial on small inputs — but the moment the target `V` is large, the counts must be exact modulo a prime, the coin system's canonicity decides whether you may legally use greedy, or the same engine must serve min/count/feasibility in one service, every detail (overflow, modulus, big-integer counts, sweep direction, canonical-system verification, testing the loop order) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
   - 1.1 The three failure-prone decisions
2. [Large-V Concerns and the Pseudo-Polynomial Trap](#2-large-v-concerns-and-the-pseudo-polynomial-trap)
   - 2.4 Large-V decision checklist
   - 2.5 Worked large-V example
3. [Big-Integer Counts, Modulus, and CRT](#3-big-integer-counts-modulus-and-crt)
   - 3.5 Worked CRT example
4. [Canonical Coin Systems: When Greedy Is Provably Optimal](#4-canonical-coin-systems-when-greedy-is-provably-optimal)
   - 4.5 Canonicity is fragile under edits
5. [Bounded and Multi-Constraint Variants at Scale](#5-bounded-and-multi-constraint-variants-at-scale)
   - 5.4 Worked bounded vs unbounded contrast
6. [A Unified Coin-Change Engine](#6-a-unified-coin-change-engine)
   - 6.1 The cube of variants
   - 6.2 Worked impossibility example
7. [Performance Engineering](#7-performance-engineering)
   - 7.4 The modulus-reduction micro-optimization
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
   - 9.3 Metrics and SLOs
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "what are the two recurrences" but "what system am I modeling, and what breaks when I scale it?". Coin change shows up in production guises that look different but share one engine:

1. **Exact counting under a huge target** — "how many ways to make `V`", `V` up to `10^5`–`10^6`, answer exact modulo a prime. The combinations loop order is load-bearing.
2. **Minimization with impossibility** — "fewest coins, or report impossible", where the `∞` sentinel and the `-1` mapping are correctness-critical and a frequent source of off-by-one and overflow bugs.
3. **Greedy in disguise** — a real cashier/ATM service where greedy is `O(n)` and tempting; the senior decision is whether the deployed coin system is **canonical** (greedy provably optimal) and whether it can change (a new denomination breaks the proof).

All three reduce to: *choose the recurrence, choose the loop order (combinations vs permutations), choose the sweep direction (unbounded vs bounded), keep the arithmetic exact and overflow-free, and verify against an oracle when `V` is too large to enumerate.* This document treats those decisions in production terms.

The unifying observation: coin change is roughly fifteen lines of DP wrapped in a great deal of *judgement* — which variant, which arithmetic, which fast-path, which scaling escape hatch. The senior work is almost entirely that wrapping, not the loop itself.

### 1.1 The three failure-prone decisions, up front

Before any code, a senior engineer pins down three orthogonal choices, because getting any one wrong is a silent correctness bug, not a crash:

1. **Objective:** min coins (`min`, `+1`, base `0`, `∞` sentinel) vs count ways (`+`, base `1`).
2. **Order (count only):** combinations (coin-outer) vs permutations (amount-outer). This is the bug that ships most often because both produce plausible numbers.
3. **Supply:** unbounded (forward sweep) vs bounded/0-1 (backward sweep, binary split).

These three axes form a cube; each cell is a legitimate, different problem. The single most damaging incident in this space is shipping the wrong cell — e.g. counting permutations when the product manager meant combinations — because nothing throws, the numbers look reasonable, and only a careful oracle or the `P ≥ N` inequality catches it. The rest of this file assumes you have nailed the cube and focuses on scaling the chosen cell.

---

## 2. Large-V Concerns and the Pseudo-Polynomial Trap

### 2.1 Why `O(V·n)` is not "polynomial"

The runtime `O(V·n)` is polynomial in the numeric **value** `V`, but `V` is given in `O(log V)` bits. So the algorithm is **pseudo-polynomial**: exponential in the input *size*. At `V = 10^9` the `dp[]` array needs `~4` GB (32-bit) or `~8` GB (64-bit) — it does not fit in memory, and even if it did, `10^9 · n` operations is too slow. This is the single most important scaling fact about coin change.

### 2.2 What to do when `V` is huge

- **If the coin set is tiny and fixed**, the number of ways satisfies a **linear recurrence** (the generating function is rational — see professional file), so you can compute the count for huge `V` with **matrix exponentiation** in `O(c_max^3 · log V)` or Kitamasa in `O(c_max^2 log V)`, where `c_max` is the largest coin. This is the same machinery as `11-graphs/32-paths-fixed-length`.
- **If you only need min-coins and the system is canonical**, greedy is `O(n log n)` regardless of `V` — no table at all.
- **If the answer is "is `V` reachable at all"**, this is the **Frobenius / Chicken McNugget** problem; for coprime coins all `V` beyond the Frobenius number `g(a,b) = ab - a - b` (two-coin case) are reachable, resolved in `O(1)` without a table.
- **Otherwise** accept that exact large-`V` coin change is genuinely hard and bound the input.

### 2.3 Reachability structure for large V

For coins with `gcd = d`, only amounts divisible by `d` are reachable. Dividing through by `d` shrinks `V` by a factor of `d`. After that, beyond the Frobenius number every amount is reachable, so for large `V` past that threshold min-coins becomes near-greedy and counting grows by a fixed quasi-polynomial. Detecting `d = gcd(coins)` and the reachability threshold is an `O(n)` pre-filter that resolves many huge-`V` queries without a `dp[]` array.

### 2.4 A concrete large-V decision checklist

When a query arrives with a large `V`, run this triage before allocating any `dp[]`:

1. **gcd filter.** If `gcd(coins) ∤ V`, the amount is unreachable — return `-1` (min) or `0` (count) in `O(n)`.
2. **Memory budget.** Is `V + 1` integers within the allocation budget (e.g. `V ≤ 10^7` for an 80 MB cap at 8 bytes)? If yes, the ordinary DP is fine.
3. **Tiny fixed coin set?** If `|coins|` is small and the set is fixed across queries, derive the linear recurrence from the GF denominator once, then answer each huge-`V` query by matrix exponentiation in `O(d³ log V)`.
4. **Min-coins on a canonical system?** Then greedy answers in `O(n log n)` with no table at all — verify canonicity once (Section 4).
5. **Only reachability?** gcd + Frobenius threshold resolves it in `O(1)` past the threshold.

The mistake is to skip triage and blindly allocate `dp[V]`; at `V = 10^9` that is an instant OOM. The triage turns most large-`V` queries into `O(1)`–`O(log V)` work.

### 2.5 Worked large-V example

Coins `{4, 6, 9}`, query `V = 10^9 + 1`. Step 1: `gcd(4,6,9) = 1`, and `1 | V`, so not eliminated by gcd. Step 2: `V + 1 ≈ 10^9` integers — too big to allocate. Step 3: the coin set is fixed and small (`c_max = 9`), so `N(V)` obeys a recurrence of order `≤ 4+6+9 = 19`; build the companion matrix and power it in `O(19³ log V) ≈ 19³ · 30 ≈ 2×10^5` operations — instant. Step 5 (if only reachability mattered): the Frobenius number of `{4,6,9}` is small (single digits after the gcd-1 reduction), so `V = 10^9+1` is trivially reachable. This is the difference between an impossible 4 GB allocation and a microsecond answer.

---

## 3. Big-Integer Counts, Modulus, and CRT

### 3.1 Counts explode

The number of ways to make `V` grows roughly polynomially in `V` for a fixed coin set (degree = `n - 1` for `n` coins), but the *constant* and the actual values overflow 64-bit integers for modest `V`. Two strategies:

- **Modular counting:** the problem says "modulo `10^9 + 7`". Reduce `dp[v] %= MOD` after each `+=`. The recurrence is purely additive, so reduction commutes with it — no correctness loss.
- **Big integers:** if the exact value is required, use arbitrary-precision integers (Python native, Go `math/big`, Java `BigInteger`). Each addition is now `O(digits)`, so the total cost gains a `O(log answer)` factor.

### 3.2 Why min-coins never needs a modulus

Min-coins answers are bounded by `V` (you never use more than `V` coins of value 1), so they fit in a 32-bit int easily. Only the **counting** variant overflows. Never apply a modulus to min-coins — taking `min` of residues is meaningless: `min(3, (10^9+5) mod p)` could pick the wrong representative and silently corrupt the optimum.

### 3.3 CRT for exact large counts

When the exact count exceeds a single prime's range but you want to avoid big-integer cost, run the counting DP under several coprime primes `p₁, p₂, …` and reconstruct via CRT. Each prime is an independent, embarrassingly parallel DP pass. Estimate the magnitude (count `~ V^{n-1}/((n-1)! · Πc_i)` for large `V`) to choose how many primes you need.

### 3.4 Negative-residue hygiene

The counting recurrence is additive, so residues stay in `[0, p)` naturally. Negative residues only appear if you use **inclusion-exclusion** over coin subsets (a technique for some constrained counting variants); then normalize with `((x % p) + p) % p`.

### 3.5 Worked CRT example

Suppose the true count `N(V) = 1_000_000_021` (just above `p₁ = 10^9 + 7`). Running the DP mod `p₁` gives `r₁ = 1_000_000_021 mod (10^9+7) = 14`. Running mod `p₂ = 998_244_353` gives `r₂ = 1_000_000_021 mod 998_244_353 = 1_755_668`. CRT reconstructs the unique value in `[0, p₁·p₂)` congruent to both:

```
inv = p₁^{-1} mod p₂
t   = ((r₂ - r₁) · inv) mod p₂
x   = r₁ + p₁ · t          # = 1_000_000_021, recovered exactly
```

Because `p₁·p₂ ≈ 10^{18}`, two primes recover any exact count below `~10^{18}`; for larger counts add more primes. Each modular run is independent, so an `m`-prime reconstruction is `m` parallel DP passes plus an `O(m²)` CRT combine — the standard way to get exact large counts without paying big-integer cost inside the hot loop.

---

## 4. Canonical Coin Systems: When Greedy Is Provably Optimal

A coin system is **canonical** if the greedy algorithm (take the largest coin ≤ remaining amount, repeat) yields the minimum coin count for **every** amount. Real currencies are deliberately designed canonical. For an arbitrary set you must verify.

### 4.1 The counterexample, restated precisely

`{1, 3, 4}` is **non-canonical**: at `V = 6`, greedy yields `4 + 1 + 1` (3 coins) but optimal is `3 + 3` (2 coins). The smallest amount where greedy fails is the *witness*; here it is `6`.

A second memorable witness: `{1, 7, 10}` fails at `V = 14`, where greedy takes `10 + 1 + 1 + 1 + 1` (5 coins) but optimal is `7 + 7` (2 coins) — a dramatic gap of 3 coins. These witnesses are worth memorizing for interviews and as regression-test fixtures: any canonicity bug should immediately fail on `{1,3,4}@6` and `{1,7,10}@14`.

### 4.2 Pearson's algorithm (testing canonicity)

You do **not** need to check all amounts. Pearson (2005) proved that the smallest counterexample, if one exists, lies in a bounded range, and gave an `O(n^3)`-style algorithm: for a sorted system `c_1 < … < c_n` (with `c_1 = 1`), the smallest counterexample `w` (if any) satisfies `c_3 < w < c_{n} + c_{n-1}`. The procedure: for each candidate, compare the greedy representation against the optimal (computed by a small DP) and report the first mismatch. If none in the bounded window, the system is canonical. The bound makes this a *finite, cheap* check, not an infinite search.

### 4.3 The practical rule

- **Fixed, known-canonical system** (e.g. `{1,5,10,25}`): greedy is safe, `O(n)` per query.
- **Configurable / user-supplied denominations**: you cannot assume canonicity. Either run Pearson's test once when the system is configured (and cache the verdict), or just always use DP.
- **A new coin gets added**: re-run the canonicity test — adding a denomination can turn a canonical system non-canonical.

### 4.4 Why canonical systems exist by design

Currency designers pick denominations (typically `1-2-5` or `1-2-5-10` decade patterns) precisely so greedy works for human cashiers. The `1-2-5` pattern is canonical; many `1-2-5`-like systems are. This is an engineering choice, not an accident — and it is why the textbook greedy "works" on the coins in your pocket but not on adversarial interview inputs.

### 4.5 Canonicity is fragile under edits

A subtle production hazard: a canonical system can become non-canonical when you **add** a denomination, and a non-canonical one can become canonical when you **remove** one. Examples:

- `{1, 5, 10, 25}` (US) is canonical. Adding a hypothetical `{1, 5, 10, 20, 25}` introduces the classic `30 = 25+5` (2 coins) vs greedy `25+1+1+1+1+1`... actually greedy gives `25+5 = 2` here, but other amounts can break — the point is you **must re-test**, never assume the edit preserves canonicity.
- A configuration UI that lets an operator add a "promotional denomination" must re-run Pearson's test and surface the verdict, because shipping greedy on a now-non-canonical system silently overcharges customers coins.

The operational rule: **treat the canonicity verdict as a derived property of the coin set, recomputed (and cached) on every coin-set change, never assumed.** Store it next to the coin set; gate the greedy fast-path on it.

---

## 5. Bounded and Multi-Constraint Variants at Scale

### 5.1 Bounded supply

Coin `c_i` available `k_i` times. Binary-split each into `O(log k_i)` 0/1 items and run the 0/1 (backward-sweep) DP — `O(V · Σ log k_i)`. For *counting* with multiplicities, the generating-function product (Section below) is the cleanest exact method.

**Why binary splitting is `O(log k_i)`.** A budget `k_i` decomposes into chunks `1, 2, 4, …, 2^{t-1}, r` where `r = k_i - (2^t - 1)` is the remainder. Any usage count `0..k_i` is a subset sum of these `O(log k_i)` chunks (standard binary representation argument), so the bounded coin becomes `O(log k_i)` independent 0/1 items. A naive third loop over `0..k_i` would instead be `O(k_i)` per coin — exponentially worse when `k_i` is large (e.g. `k_i = 10^6` becomes `~20` items, not a million). This is the same technique used for bounded knapsack in sibling `02-knapsack`.

### 5.2 Generating-function view (production-relevant)

The number of ways to make `V` with unbounded coins is `[x^V] Π_i 1/(1 - x^{c_i})`. With bounded coin `c_i` (≤ `k_i` uses) it is `[x^V] Π_i (1 - x^{(k_i+1)c_i})/(1 - x^{c_i})`. Multiplying these polynomials mod `x^{V+1}` *is* the DP — each factor's expansion is one coin's inner loop. This view makes the bounded case a clean polynomial product and is the right mental model for "ways with at most `k_i` of each".

### 5.3 Multi-dimensional constraints

"Make `V` using exactly `m` coins" adds a dimension: `dp[m][v]` = ways using exactly `m` coins. "Make `V` with coins from at most `t` distinct denominations" adds a subset/count dimension. Each extra constraint multiplies the table size; keep dimensions minimal and watch the memory.

### 5.4 Worked bounded vs unbounded contrast

Coins `{1, 2}`, target `V = 4`. Unbounded combinations: `{1,1,1,1}, {1,1,2}, {2,2}` = **3**. Now bound coin `1` to at most `2` uses (`k_1 = 2`), coin `2` to at most `1` use (`k_2 = 1`):

```
unbounded GF coefficient: [x^4] 1/((1-x)(1-x^2))            = 3
bounded   GF coefficient: [x^4] (1+x+x^2)(1+x^2)             = 1   (only {2... } no, let's expand)
   (1 + x + x^2)(1 + x^2) = 1 + x + 2x^2 + x^3 + x^4
   [x^4] = 1   -> the single multiset {1,1,2}  (two 1s + one 2)
```

The bound `k_1 = 2` forbids `{1,1,1,1}` and `k_2 = 1` forbids `{2,2}`, leaving exactly one. Running this as a DP: binary-split coin `1` (count 2 → chunks of 1 and 1, i.e. two 0/1 items of value 1) and coin `2` (count 1 → one 0/1 item of value 2), then a backward sweep gives `dp[4] = 1`. This concretely shows why bounded change needs the 0/1 (backward) machinery, not the unbounded forward sweep — the forward sweep would still count `{1,1,1,1}` and `{2,2}`.

---

## 6. A Unified Coin-Change Engine

A production library should expose one core that is parameterized by:

- **Objective:** `MIN` (combine with `min`, accumulate `+1`) or `COUNT` (combine with `+`).
- **Order semantics:** `COMBINATIONS` (coin-outer) or `PERMUTATIONS` (amount-outer).
- **Supply:** `UNBOUNDED` (forward sweep) or `BOUNDED`/`0-1` (backward sweep, possibly binary-split).
- **Arithmetic:** plain `int`, `mod p`, or big integer.

The loop skeleton barely changes; only the combine operator, the base value (`0` for min, `1` for count), the loop nesting, and the sweep direction do. Encapsulating these prevents the classic bug of shipping a permutations loop for a combinations problem.

### 6.1 The cube of variants

| Objective | Order | Supply | Loop | Sweep | Base | Combine |
|-----------|-------|--------|------|-------|------|---------|
| min | n/a (idempotent) | unbounded | coin-outer | forward | `dp[0]=0`, rest `∞` | `min(dp[v], dp[v-c]+1)` |
| count | combinations | unbounded | coin-outer | forward | `dp[0]=1` | `dp[v] += dp[v-c]` |
| count | permutations | unbounded | amount-outer | forward | `dp[0]=1` | `dp[v] += dp[v-c]` |
| count | combinations | bounded/0-1 | item-outer | **backward** | `dp[0]=1` | `dp[v] += dp[v-c]` |
| feasible | n/a (idempotent) | unbounded | coin-outer | forward | `reach[0]=true` | `reach[v] |= reach[v-c]` |

A single tested core that takes `(objective, order, supply)` and dispatches to the right row eliminates the entire class of "wrong cell" bugs. The min and feasibility rows are loop-order-free (idempotent combine); only the count rows are order-sensitive — which is exactly the axis most likely to be set wrong.

### 6.2 Worked impossibility example

Coins `{3, 5}`, target `V = 7`. Min DP:

```
init:  dp = [0, ∞, ∞, ∞, ∞, ∞, ∞, ∞]
coin 3: dp[3]=1, dp[6]=2                      dp = [0,∞,∞,1,∞,∞,2,∞]
coin 5: dp[5]=1, dp[8] (out of range)         dp = [0,∞,∞,1,∞,1,2,∞]
```

`dp[7] = ∞` ⇒ return `-1`. Indeed `7` is not representable by `{3,5}` (it is below the Frobenius number `g(3,5)=7`... actually `7 = g(3,5)` is the *largest* non-representable amount). The engine maps the `∞` sentinel to `-1`; a service that returned the raw `INF = 8` here would be a classic bug. Note the count variant would return `0` for the same query — the two objectives signal impossibility differently (`-1` vs `0`), which the unified engine must handle per-row.

---

## 7. Performance Engineering

### 7.1 The inner loop dominates

`O(V·n)` means the `dp[v] += dp[v-c]` (or `min`) inner loop runs `V·n` times. Wins:

- **Flat 1D array** of the right integer width; avoid boxed types (Java `Long[]` vs `long[]` is a 5–10× difference).
- **Reduce mod p only in counting**, once per `+=`; deferring with a wider accumulator before reducing cuts division count.
- **Skip coins `> V`** and dedupe coins up front.
- **Start the inner loop at `c`** to skip the unreachable prefix and avoid a bounds check.
- **Cache locality:** the forward sweep over a contiguous `dp[]` is already cache-friendly; keep `dp[]` as a single allocation, not a list of objects.

### 7.2 Memory

`dp[]` is `O(V)` of one integer each. At `V = 10^7` with 8-byte longs that is 80 MB — large but feasible; at `V = 10^9` it is infeasible (Section 2). For multi-dimensional variants, roll the smaller dimension to keep only two slices when possible.

### 7.3 Parallelism

The counting DP has a sequential dependency within a coin's sweep (`dp[v]` depends on `dp[v-c]`), so a single sweep does not trivially parallelize. But **across CRT primes** the whole DP is independent and parallelizable, and **across independent queries** on the same coin set you can batch. For the matrix-exponentiation large-`V` route, the multiply parallelizes across rows.

### 7.4 The modulus-reduction micro-optimization

In the counting variant the inner line is `dp[v] = (dp[v] + dp[v-c]) % MOD`. The `%` is a division, the most expensive integer op in the loop. Since both operands are already in `[0, MOD)`, their sum is in `[0, 2·MOD)`, so a single conditional subtraction replaces the division:

```
dp[v] += dp[v-c]
if dp[v] >= MOD: dp[v] -= MOD
```

This is typically 2–4× faster than `%` on the hot path and is exact because at most one wraparound can occur per addition. The same trick does **not** apply to min-coins (no modulus there). For batched/large workloads this single change is often the difference between meeting and missing a latency target, since the inner loop runs `V·n` times.

---

## 8. Code Examples

The three examples below each highlight a distinct senior concern: Go shows the conditional-subtract modulus optimization, Java shows the Pearson-style canonicity check that gates the greedy fast-path, and Python shows the large-`V` recurrence route. All three are validated the same way — against a brute-force oracle on small inputs — before being trusted at scale.

### 8.1 Go — modular counting with overflow-safe accumulation

```go
package main

import "fmt"

const MOD = 1_000_000_007

// countWaysMod: number of COMBINATIONS to make amount, mod p.
func countWaysMod(coins []int, amount int) int64 {
	dp := make([]int64, amount+1)
	dp[0] = 1
	for _, c := range coins { // coin-outer => combinations
		for v := c; v <= amount; v++ {
			dp[v] += dp[v-c]
			if dp[v] >= MOD {
				dp[v] -= MOD // cheaper than % for a single add
			}
		}
	}
	return dp[amount]
}

func main() {
	fmt.Println(countWaysMod([]int{1, 2, 5}, 6))   // 5
	fmt.Println(countWaysMod([]int{1, 2, 5}, 100))  // big, reduced mod p
}
```

### 8.2 Java — canonicity (Pearson-style) check, bounded window

```java
import java.util.*;

public class Canonical {
    // Optimal min-coins via DP up to `limit`.
    static int[] minCoinsTable(int[] coins, int limit) {
        final int INF = 1 << 29;
        int[] dp = new int[limit + 1];
        Arrays.fill(dp, INF);
        dp[0] = 0;
        for (int v = 1; v <= limit; v++)
            for (int c : coins)
                if (c <= v && dp[v - c] + 1 < dp[v]) dp[v] = dp[v - c] + 1;
        return dp;
    }

    // Greedy coin count (assumes coins sorted descending, contains 1).
    static int greedy(int[] desc, int v) {
        int cnt = 0;
        for (int c : desc) { cnt += v / c; v %= c; }
        return cnt;
    }

    // Returns the smallest counterexample, or -1 if canonical (within window).
    static int smallestCounterexample(int[] coins) {
        int[] sorted = coins.clone();
        Arrays.sort(sorted);
        int[] desc = sorted.clone();
        for (int i = 0; i < desc.length / 2; i++) {
            int t = desc[i]; desc[i] = desc[desc.length - 1 - i]; desc[desc.length - 1 - i] = t;
        }
        int n = sorted.length;
        int window = sorted[n - 1] + sorted[n - 2]; // safe upper bound region
        int[] dp = minCoinsTable(sorted, window);
        for (int v = 1; v <= window; v++)
            if (greedy(desc, v) != dp[v]) return v;
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(smallestCounterexample(new int[]{1, 3, 4}));   // 6 (non-canonical)
        System.out.println(smallestCounterexample(new int[]{1, 5, 10, 25})); // -1 (canonical)
    }
}
```

### 8.3 Python — large-V counting via matrix exponentiation (fixed small coin set)

```python
MOD = 1_000_000_007


def mat_mul(a, b):
    n, m, p = len(a), len(b), len(b[0])
    c = [[0] * p for _ in range(n)]
    for i in range(n):
        for t in range(m):
            if a[i][t]:
                ait, bt, ci = a[i][t], b[t], c[i]
                for j in range(p):
                    ci[j] = (ci[j] + ait * bt[j]) % MOD
    return c


def mat_pow(a, k):
    n = len(a)
    r = [[1 if i == j else 0 for j in range(n)] for i in range(n)]
    while k > 0:
        if k & 1:
            r = mat_mul(r, a)
        a = mat_mul(a, a)
        k >>= 1
    return r


def count_ways_huge_V(coins, V):
    """
    For a FIXED small coin set, ways(V) satisfies a linear recurrence whose
    order <= max(coins). Here we demonstrate the {1,2} case where
    ways(V) satisfies ways(V) = ways(V-1) + ways(V-2) - ways(V-3) ... ;
    in practice derive the recurrence from the GF denominator (professional.md).
    For brevity we fall back to the table when V is small.
    """
    cmax = max(coins)
    # Build base ways[0..2*cmax] by direct DP, then a recurrence would extend it.
    limit = min(V, 4 * cmax)
    dp = [0] * (limit + 1)
    dp[0] = 1
    for c in coins:
        for v in range(c, limit + 1):
            dp[v] = (dp[v] + dp[v - c]) % MOD
    if V <= limit:
        return dp[V]
    # For V beyond the table, the rational GF gives a fixed-order recurrence;
    # extend with matrix exponentiation on that recurrence (see professional.md).
    raise NotImplementedError("derive recurrence from GF denominator for huge V")


if __name__ == "__main__":
    print(count_ways_huge_V([1, 2], 6))   # combinations of {1,2} making 6 = 4
```

---

## 9. Observability and Testing

A coin-change result is opaque — one wrong number looks like any other. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force recursive oracle on small `V` | Catches loop-order (combinations/permutations) and base-case bugs. |
| `ways(0) == 1`, `minCoins(0) == 0` | Confirms the base cases. |
| Permutations ≥ combinations always | A sanity inequality on the two counts. |
| Greedy == DP on a *canonical* system | Confirms the canonicity assumption per system. |
| Greedy ≠ DP somewhere on `{1,3,4}` | Regression that catches accidentally trusting greedy. |
| Monotonic growth of `ways(V)` | Counts should grow with `V` for a coin set containing `1`. |
| Cross-language determinism | Same inputs, same modulus → identical Go/Java/Python output. |

The single most valuable test is the **brute-force oracle**: a slow recursion that recomputes min and count for `V ≤ 30`, compared exactly. It catches the overwhelming majority of bugs — especially the silent permutations-vs-combinations flip.

### 9.1 A property-test battery

```text
for random small coin set C (containing 1), random V in [0, 30]:
    assert count_combinations(C, V) == brute_combinations(C, V)
    assert count_permutations(C, V) == brute_permutations(C, V)
    assert count_permutations(C, V) >= count_combinations(C, V)
    assert min_coins(C, V) == brute_min(C, V)
    assert count_combinations(C, 0) == 1 and min_coins(C, 0) == 0
for a known non-canonical set {1,3,4}:
    assert greedy(6) > min_coins({1,3,4}, 6)   # 3 > 2
```

### 9.2 Production guardrails

For a change-making service: validate that the coin set contains `1` (else many amounts are unreachable) or explicitly handle unreachable amounts; assert `V` is within the memory budget before allocating `dp[]`; log the canonicity verdict of the active coin system so an operator can see whether greedy is legal; and emit the chosen objective/order/supply triple alongside each result so an anomalous answer reveals a misconfiguration.

### 9.3 Metrics and SLOs worth tracking

| Metric | Why it matters | Alert when |
|--------|----------------|------------|
| `V` distribution (p50/p99) | Detects pseudo-polynomial blowup risk | p99 `V` approaches the memory-budget ceiling |
| Fraction of queries served by greedy fast-path | Confirms canonicity assumption is paying off | Drops unexpectedly (a coin-set edit flipped canonicity) |
| Unreachable-amount rate | High rate may signal a missing `1`-coin or bad input | Spikes above baseline |
| `dp[]` allocation bytes | Memory pressure from large `V` | Exceeds budget |
| Per-query latency vs `V·n` | Confirms `O(V·n)` scaling, no accidental quadratic | Superlinear in `V·n` |
| Count-overflow / modulus-applied flag | Ensures counts don't silently wrap | Count near `2^63` without a modulus |

### 9.4 The single highest-value test, restated

If you write only one test, write the **brute-force oracle comparison**: a slow recursion computing `M`, `N`, and `P` for `V ≤ 30` on random small coin sets, asserting the DP matches all three. It catches the loop-order flip (the dominant production bug), the `dp[0]` base-case error, the `∞`/`-1` mistake, and the forward/backward sweep error in one stroke. Add the `P ≥ N` inequality and the `greedy == DP iff canonical` checks as cheap second-line defenses. Everything else (CRT, matrix-exponentiation route, bounded GF) should be validated against this same oracle on inputs small enough to enumerate before being trusted on large inputs.

---

## 10. Failure Modes

### 10.1 Silent permutations-for-combinations

The most common production bug: an amount-outer loop ships for a combinations problem, producing a plausible but wrong (too large) count. Mitigation: encapsulate the order in the engine and property-test against the oracle; the permutations≥combinations inequality also surfaces gross errors.

This bug is especially insidious because it passes the most obvious sanity check — the count is positive, grows with `V`, and is `0` for unreachable amounts — yet is silently inflated by the number of orderings. A single oracle comparison on `{1,2}@3` (combinations `2` vs permutations `3`) instantly distinguishes the two; without it the error can survive to production undetected.

### 10.2 Min-coins overflow / wrong impossibility

`INF = MAX_INT` then `+1` wraps negative and corrupts the `min`; or the `∞` sentinel is returned instead of `-1`. Mitigation: `INF = amount + 1`, and explicitly map `dp[V] >= INF` to `-1`.

### 10.3 Greedy on a non-canonical system

Someone uses greedy because "it works on real coins" and ships a suboptimal min-coins on an arbitrary set. Mitigation: run Pearson's canonicity test when the system is configured; default to DP for user-supplied coins.

### 10.4 Pseudo-polynomial blowup

Treating `O(V·n)` as "polynomial" and accepting `V = 10^9` leads to OOM or timeout. Mitigation: bound `V`; for huge `V` with a tiny coin set, switch to the recurrence/matrix-exponentiation route; for canonical min-coins, use greedy (no table).

### 10.5 Counting overflow without a modulus

For large `V` the count exceeds 64 bits and silently wraps. Mitigation: take `mod p` when asked, or use big integers; estimate the magnitude via `N(V) ~ V^{n-1}/((n-1)!·Πc_i)` to decide how many bits (and CRT primes) you need.

### 10.6 Bounded coin treated as unbounded

A forward sweep on a limited-supply coin allows infinite reuse. Mitigation: backward sweep for 0/1, binary-split bounded coins; test against an explicit bounded oracle.

### 10.7 Duplicate or zero-value coins

A duplicated denomination double-counts in the counting variant; a zero-value coin causes an infinite loop or division by zero. Mitigation: validate the coin set (positive, distinct) before running.

### 10.8 Off-by-one between "amount" and "value units"

Business requirements often phrase amounts in dollars while coins are in cents (or vice versa). Mixing units silently corrupts every answer — `dp[]` is indexed by the *same unit* as the coins. Always normalize amount and coins to a single integer unit (cents) before building the table, and document the unit. This off-by-unit error survives all algebraic tests (the math is correct in *whatever* unit you fed it) and only surfaces against real expected outputs — another reason the brute-force oracle must be fed the same human-specified inputs, not re-derived ones. The analogous trap in the graph sibling is "edges vs stops"; here it is "dollars vs cents".

### 10.9 Assuming a canonical verdict survives a config change

Covered in Section 4.5: a cached "canonical = true" verdict that is not invalidated when an operator edits the coin set leads to greedy silently overcharging. Mitigation: tie the verdict's lifetime to the coin-set version; recompute on every change.

---

## 11. Summary

- The `O(V·n)` DP is **pseudo-polynomial** — fine for moderate `V`, infeasible at `V = 10^9`. For huge `V` with a small fixed coin set, the count obeys a linear recurrence (rational generating function) computable by matrix exponentiation / Kitamasa; for canonical min-coins, greedy needs no table at all.
- **Counting overflows**; reduce `mod p` (the recurrence is additive, so reduction commutes) or use big integers, with CRT across primes for exact large values. **Min-coins never needs a modulus** — its answers are bounded by `V`.
- A coin system is **canonical** when greedy is optimal for every amount. Real currencies are canonical by design; arbitrary sets are not (`{1,3,4}` fails at `6`). Verify with **Pearson's** bounded-window test before trusting greedy, and re-verify whenever a denomination changes.
- **Bounded** change: binary-split into 0/1 items (`O(V·Σ log k_i)`); the **generating-function product** `Π (1 - x^{(k_i+1)c_i})/(1 - x^{c_i})` is the clean exact counting view.
- A **unified engine** parameterizes objective (min/count), order (combinations/permutations ⇒ coin-outer/amount-outer), supply (unbounded/bounded ⇒ forward/backward sweep), and arithmetic — preventing the silent loop-order bug.
- Performance lives in the `O(V·n)` inner loop: flat primitive arrays, start at `c`, dedupe/skip large coins, reduce mod only in counting. Parallelize across CRT primes and queries, not within a sweep.
- Always keep a brute-force oracle; it catches the permutations/combinations flip, the `∞`/`-1` mistake, and the base-case mistake that together account for nearly every real bug.

### Decision summary

- **Moderate `V`, arbitrary coins, count** → 1D coin-outer DP, `mod p` if asked, conditional-subtract instead of `%`.
- **Moderate `V`, arbitrary coins, min** → 1D min DP with `INF = V+1`, map `∞` to `-1`.
- **Huge `V`, tiny fixed coin set, count** → recurrence from GF denominator + matrix exponentiation, `O(d³ log V)`.
- **Min-coins on a verified canonical system** → greedy, `O(n log n)`, no table.
- **Bounded supply** → binary-split to 0/1 (`O(V·Σ log k_i)`), backward sweep, or GF product.
- **Exact large count** → big integers, or CRT across primes (parallel passes).
- **Configurable coins** → run Pearson canonicity test on every coin-set change before allowing greedy; cache the verdict with the coin-set version.
- **Only reachability for huge `V`** → gcd filter + Frobenius threshold, `O(n)`.
- **Any variant** → keep the brute-force oracle and the `P ≥ N` invariant as the front-line correctness net.

### Closing note

The senior reality of coin change is that the *algorithm* is the easy part — it is `O(V·n)` in fifteen lines. The hard part is the surrounding system: pinning the objective/order/supply cube so you compute the right quantity, keeping the arithmetic exact (modulus, CRT, big integers) without overflow, gating the greedy fast-path on a freshly-verified canonicity check, side-stepping the pseudo-polynomial wall for huge `V` via recurrences or reachability shortcuts, and instrumenting it all so a misconfiguration shows up as an alert rather than a silently-wrong invoice. Every one of those concerns is invisible on a LeetCode-sized input and decisive at production scale.

For the full mathematical treatment of every claim here — the optimal-substructure and combinations/permutations proofs, the generating-function derivations, the Pearson canonicity theorem, and the Frobenius/reachability results — see the companion [`professional.md`](./professional.md).

References: CLRS (making change / rod cutting), Pearson (2005) "A polynomial-time algorithm for the change-making problem", Flajolet-Sedgewick *Analytic Combinatorics* (rational GFs for partitions), sibling topics `02-knapsack`, `21-rod-cutting`, `22-subset-sum-partition`, and `11-graphs/32-paths-fixed-length` (matrix exponentiation for the large-`V` recurrence).
