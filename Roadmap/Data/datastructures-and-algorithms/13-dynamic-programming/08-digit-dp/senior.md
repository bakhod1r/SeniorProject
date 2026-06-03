# Digit DP (Counting Numbers in a Range with Digit Constraints) — Senior Level

> Digit DP is rarely the bottleneck on a single small query — but the moment the bound is a multi-hundred-digit string, the accumulator's range threatens to explode the state table, the counts must be exact modulo a prime, or the same DP serves thousands of range queries per second, every detail (state keying, cache lifecycle, accumulator bounding, leading-zero semantics, correctness under big-number bounds) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [State Explosion and How to Bound It](#2-state-explosion-and-how-to-bound-it)
3. [Cache Keying and Lifecycle](#3-cache-keying-and-lifecycle)
4. [Big-N: String Bounds and Arbitrary Bases](#4-big-n-string-bounds-and-arbitrary-bases)
5. [Top-Down vs Bottom-Up at Scale](#5-top-down-vs-bottom-up-at-scale)
6. [Correctness Testing Against Brute Force](#6-correctness-testing-against-brute-force)
7. [Modular Counts and Summed Quantities](#7-modular-counts-and-summed-quantities)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does the tight flag work" but "what is the *state*, how large does it get, and what breaks when I scale it?". Digit DP shows up in three production guises that share one engine:

1. **Exact counting under a huge bound** — "how many `k`-digit-or-fewer numbers satisfy a digit predicate", where the bound is `10^18` or a 200-digit string, and the answer is exact, often mod a prime.
2. **Summed quantities over a range** — not "how many numbers", but "the total digit sum of all numbers in `[L, R]`", or "the total count of digit `7` across the range". The base case returns a value, not a 0/1 flag.
3. **Batched range queries** — thousands of `[L, R]` queries against the same predicate, where rebuilding the memo per query is the dominant cost.

All three reduce to: *encode the predicate as a small running accumulator, recurse over digit positions with the tight/started flags, memoize the free states, and contract via `f(R) − f(L−1)`.* The senior decisions are: how to keep the accumulator's range small, how to key and reuse the cache safely, how to stay correct and exact when the bound is a string in an arbitrary base, and how to verify when the range is too large to brute-force.

This document treats those decisions in production terms.

---

## 2. State Explosion and How to Bound It

### 2.1 The state-count budget

The free-state count is `D × started(2) × M`, where `M` is the number of distinct accumulator values, and each state costs `O(base)`. So total work is `O(D · M · base)`. The entire performance story is `M`. When `M` is small (digit sum: `O(9D)`; remainder: `K`; last digit: `base+1`), Digit DP is trivially fast. When `M` is large or unbounded, the technique fails.

### 2.2 The classic explosions

| Naive accumulator | Range `M` | Fix |
|-------------------|-----------|-----|
| The number's full value | `N` (unbounded) | Never carry the value; carry `value mod K` for divisibility, or a derived quantity. |
| Full digit-frequency vector (count of each digit) | `(D+1)^base` | Carry only what the predicate needs — a bitmask `2^base`, or a single count. |
| Pair `(sum, product)` of digits | `9D × 9^D` | The product is unbounded; if the predicate truly needs it, Digit DP may be the wrong tool. |
| Sorted multiset of digits | exponential | Usually reducible to a count or mask; rethink the predicate. |

The senior skill is recognizing, *before coding*, whether the predicate admits a small accumulator. If the minimal sufficient statistic about the prefix is bounded, Digit DP works; if it is unbounded (you need the whole prefix), it does not.

### 2.3 Bounding tricks

- **Mod instead of value.** Divisibility → `rem mod K`. Any "value satisfies a linear/modular condition" reduces to a residue.
- **Cap-and-clamp.** If the predicate only cares whether the digit sum is `≥ S` or `≤ S`, clamp the accumulator at `S+1` ("at least `S`") so `M = S+2` regardless of how large the true sum gets.
- **Mask instead of multiset.** "All digits distinct" → a `base`-bit mask, `M = 2^base`. "Contains digit 7 at least once" → a single boolean, `M = 2`.
- **Drop dimensions.** If the predicate is symmetric in a way that makes `started` irrelevant (digit sum), drop it. Each dropped flag halves (or better) the table.

### 2.4 Multi-accumulator products

When the predicate needs two independent quantities (e.g., "digit sum `= S` AND divisible by `K`"), the state is their product: `M = (9D+1) × K`. Multiplying ranges multiplies the table. Carry only the conjuncts the problem demands, and prune impossible combinations early.

### 2.5 Case study: a state that explodes and how to rescue it

A real interview/contest trap: *"count numbers in `[0, N]` whose digits, multiplied together, equal `Q`."* The naive accumulator is the running product, which ranges over an enormous set (any product of digits) — not bounded by `poly(D)`. Three escalating rescues:

1. **Clamp at `Q+1`.** If we only care whether the product equals `Q`, clamp the running product: once it exceeds `Q` it can never come back down (digits are `≥ 0`; a digit `0` zeros it, handled separately). State the accumulator as `min(product, Q+1)` plus a "saw a zero" bit. `M` drops to `O(Q)`.
2. **Restrict to divisors of `Q`.** A valid running product must *divide* `Q` (else it can never reach `Q` by multiplying more digits). Index the accumulator by the divisor of `Q` reached so far. `M = d(Q)`, the number of divisors — typically tiny (a few hundred even for large `Q`).
3. **Factor-exponent vector.** Track the exponent of each prime factor of `Q` accumulated so far, capped at `Q`'s exponent. This is the divisor lattice in coordinate form; `M = Π (e_i + 1) = d(Q)` again.

The progression — raw product (`∞`) → clamp (`O(Q)`) → divisor index (`d(Q)`) — is the canonical senior move: **find the coarsest sufficient statistic.** If even that is too large, the predicate is genuinely outside Digit DP's reach (Section 10's "predicate needs the whole value").

| Accumulator choice | `M` for `Q = 720` | Verdict |
|--------------------|-------------------|---------|
| Raw product | unbounded | infeasible |
| Clamp at `Q+1` | `721` | feasible, a bit wasteful |
| Divisor index | `d(720) = 30` | best |

---

## 3. Cache Keying and Lifecycle

### 3.1 The tight-state rule, restated as policy

For a fixed bound, **there is exactly one tight prefix per position**. Therefore:

- A tight state is visited at most once per `f(N)` call → caching it yields no reuse.
- If the cache key omits `tight`, a tight visit and a free visit to the same `(pos, acc)` collide and corrupt each other (different completion counts). **Silently wrong.**

Policy: either include `tight` in the key (wastes space, never wrong) or — the idiomatic choice — **never read or write the cache when `tight` is true**. The `started` flag, by contrast, *is* part of the key, because both `started` values are reachable in the free region and have genuinely different completion counts.

### 3.2 Cache lifecycle across two `f` calls

`[L, R] = f(R) − f(L−1)` runs the DP twice. The memo is **a function of the bound `N`** (the limit at each position is `N[pos]`), so a memo built for `R` is *invalid* for `L−1`. Three correct lifecycles:

1. **Fresh memo per `f` call.** Simplest, always correct. A `D × 2 × M` table is cheap to allocate.
2. **Reset (fill `-1`) between calls** if you reuse a global table — `O(D · M)` per reset, avoids reallocation.
3. **Memo only the free states** (which are independent of the bound!) and share across calls. This is subtle: the *free*-state value `solve(pos, started, acc)` with `tight = false` genuinely does not depend on `N`, because once free, the limit is always `base-1`. So a free-state memo *can* be shared across different bounds. Many libraries exploit this: one persistent free-state table, recomputed tight path per bound. It is the fastest batched design but demands that the cache key truly excludes `tight` *and* that you never write a tight result into it.

### 3.3 Persistent free-state cache for batched queries

For thousands of queries with the same predicate and base but different bounds, build the free-state memo **once** (it is bound-independent) and reuse it for every `f(·)`. Only the tight path — `O(D · base)` per call — is recomputed per bound. This turns each query from `O(D · M · base)` into `O(D · base)` after the first. Concretely, prefer a top-down function whose memo is keyed on `(pos, started, acc)` (no `tight`), with the tight branch handled by a separate non-memoized walk down `N`'s digits. This is the production pattern for high-QPS digit-constraint services.

### 3.4 Language-specific cache hazards

- **Python `lru_cache`** keying on `(pos, tight, started, acc)` is correct but caches tight entries (harmless, just wasteful) and, critically, **persists across `f` calls** — you must `cache_clear()` between different bounds or the limit baked into the closure goes stale. The cleaner design closes the memo over `N` and recreates it per call.
- **Go/Java explicit arrays** must be reset (filled with the sentinel) between bounds, or allocated fresh.
- **Recursion depth** equals `D` (the digit count). For a 10^18 bound that is 19 — trivial. For a 100 000-digit bound, a recursive top-down blows the stack; switch to bottom-up tabulation (Section 5).

---

## 4. Big-N: String Bounds and Arbitrary Bases

### 4.1 The bound is always a string

Storing `N` as its digit array is what lets Digit DP scale past any integer type. Nothing in the algorithm uses `N`'s integer value — only `N[pos]` and `len(N)`. A 200-digit `N` costs the same per-state work as an 18-digit one; only `D` grows linearly. The only integer arithmetic is the accumulator update (`sum + dig`, `(rem*base + dig) % K`), which stays bounded by the accumulator's design.

### 4.2 `L − 1` on a string

The single big-number operation is the decrement for the lower bound. Borrow across trailing zeros, then strip leading zeros (avoiding the empty string → `"0"`). Handle `L = "0"` by treating `f(-1) = 0`. A buggy decrement is a top-three failure mode because it survives every algebraic test and only shows up as an off-by-one on real ranges.

### 4.3 Arbitrary bases

Digit DP is base-agnostic. Replace `base = 10` with any `b`, parse `N` in base `b`, and the digit loop runs `0..min(N[pos], b-1)`. Applications: counting binary representations with a popcount constraint (base 2), base-`b` palindromes, "numbers whose base-`b` digits are non-decreasing". The accumulator update for divisibility becomes `rem' = (rem*b + dig) % K`. The leading-zero semantics are identical. The only caveat: confirm whether the problem fixes the *value* range `[L, R]` (decimal) but constrains *base-`b` digits* — then convert the bounds to base `b` once and run the DP there.

### 4.4 Fixed-width vs variable-width counting

Some problems count over a fixed digit width `W` (e.g., "8-digit PINs"); others over `[0, N]` (variable width, where shorter numbers are leading-zero-padded). The `started` flag is what reconciles them: with `started`, a width-`D` frame correctly counts all numbers with `≤ D` real digits. For fixed-width-only counting (no shorter numbers), drop `started` and forbid the all-padding case.

### 4.5 Worked layered-DP collapse: counting valid tokens (no bound)

When there is a fixed *width* but no upper-bound `N`, Digit DP's tight machinery is unnecessary and the problem becomes a pure matrix power. Example: count `D`-digit tokens valid iff (a) no digit is `0`, (b) no two adjacent digits are equal, and (c) the digit sum is divisible by 9.

The state is `(last digit, sum mod 9)`: `last ∈ {1..9}` (no zeros → 9 values) and `sum mod 9 ∈ {0..8}` (9 values), so `|S| = 81`. The layer-independent transition `T[(l,r)][(l',r')] = 1` iff `l' ≠ l` and `r' = (r + l') mod 9`, with `l' ∈ {1..9}`. The count of valid width-`D` tokens is `(init vector) · T^D · (accepting mask)`:

- **Layered DP:** `D` matrix-vector products, `O(|S|² · D) = 81² · D` — best for moderate `D`.
- **Matrix power:** `T^D` by binary exponentiation, `O(|S|³ log D) = 81³ · log D` — best for `D = 10^18`.

This is the senior recognition: **fixed-width digit counting with a layer-independent transition is a matrix-power problem** (sibling `11-graphs/32-paths-fixed-length`). Add an upper bound `N` and it reverts to standard Digit DP — state `(pos, tight, started, last, sum mod 9)`, the tight flag returns, and the answer is `f(N)`. The bounded and unbounded framings are the two faces of the same digit automaton (`professional.md` §5).

---

## 5. Top-Down vs Bottom-Up at Scale

### 5.1 Top-down (memoized recursion)

The natural form: `solve(pos, tight, started, acc)` with a memo on free states. Pros: mirrors the problem, only visits reachable states, easy to add accumulators. Cons: recursion depth `= D` (stack risk for enormous `D`), function-call overhead, cache-clear discipline.

### 5.2 Bottom-up (tabulation)

Fill `dp[pos][started][acc]` from `pos = D` down to `0` for the free states, then handle the tight path as a separate forward pass that, at each position, "branches off" the free count for digits below `N[pos]` and continues tight on `dig == N[pos]`. This avoids recursion entirely (safe for million-digit bounds), is cache-friendlier, and the free table is bound-independent (Section 3.3). Cons: more code, the tight-path bookkeeping is error-prone.

### 5.2b Worked top-down trace with memo reuse (`N = 345`, digit sum `= 7`)

To see *where* memoization actually pays off — which is invisible on the tiny `N = 21` of the junior file — trace `f("345")` for digit sum 7. The free table `memo[pos][sum]` is keyed on `(pos, sum)` for `tight = false`:

```
Tight spine: positions 0,1,2 with N = 3,4,5.
  pos 0 tight (sum 0): digits 0,1,2 go FREE; digit 3 stays tight.
    digit 0 → free(pos1, sum0)   ─┐
    digit 1 → free(pos1, sum1)    │  three DISTINCT free states at pos1,
    digit 2 → free(pos1, sum2)   ─┘  each computed once and cached.
    digit 3 → tight(pos1, sum3)
  pos 1 tight (sum3): digits 0,1,2,3 go FREE → free(pos2, sum3..6); digit 4 tight.
    digit 0 → free(pos2, sum3)
    digit 1 → free(pos2, sum4)
    ...
    digit 4 → tight(pos2, sum7)
```

Now the reuse: `free(pos1, sum1)` (reached via tight-spine digit 1 at pos 0) internally calls `free(pos2, sum1..)`. Separately, `free(pos1, sum2)` calls `free(pos2, sum2..)`. Many of these `free(pos2, ·)` calls **collide** — e.g. `free(pos2, sum=5)` is reached from `(pos1,sum1)+digit4`, from `(pos1,sum2)+digit3`, from `(pos1,sum3)+digit2`, and so on. The first computes it; the rest are `O(1)` memo hits. For a 3-digit bound the savings are modest, but for `N = 10^18` the same `free(pos, sum)` is reached from exponentially many prefixes, and the memo collapses all of them into one computation. **The memo hit count grows with `D`; the distinct-state count stays `O(D · M)`.** Instrumenting `memoHits` (as the animation does) makes this concrete: the ratio of hits to distinct states is the compression factor the technique buys.

### 5.3 The "free-table + tight-walk" decomposition

The cleanest scalable form separates the two concerns:

```
free[pos][started][acc] = number of valid completions from pos onward, all digits free
answer = walk down N's digits:
    at each pos, for each dig < N[pos]: add free[pos+1][started'][acc']   (we just went below N)
    for dig == N[pos]: stay tight, continue to pos+1
    at pos == D (fell off the bottom still tight): add 1 if the tight prefix (== N) is valid
```

`free` is filled once (bottom-up), independent of `N`; the tight walk is a single `O(D · base)` pass per bound. This is both stack-safe and the foundation of the persistent-cache batched design. It is worth internalizing because it cleanly explains *why* tight states are not cached: they are not in the `free` table at all — they live only on the single walk.

---

## 6. Correctness Testing Against Brute Force

A Digit DP result is opaque — one wrong count looks like any other plausible number. The non-negotiable defense is a brute-force oracle.

```python
def brute(N_int, predicate):
    return sum(1 for x in range(0, N_int + 1) if predicate(x))
```

Run `assert digit_dp(str(N)) == brute(N, predicate)` for **every** `N` in `[0, 50000]` (and a few larger), for every parameter (`S`, `K`, base, forbidden set). This catches the entire dominant bug class: the off-by-one between "length = digits", the leading-zero mishandling, the tight-cache pollution, the `f(R) − f(L−1)` endpoint error, and the `L − 1` decrement bug. Property tests (Section 9) extend this to ranges.

The oracle must be fed the **same human-specified parameters**, not a re-derived bound — a re-derivation can replicate the very off-by-one you are trying to catch.

---

## 7. Modular Counts and Summed Quantities

### 7.1 Exact counts mod a prime

When the count can exceed 64 bits (permissive predicates over a huge bound), reduce in the accumulation: `total = (total + child) % MOD`. The base-case return is `1` (or `0`), already small. There is no `value` to overflow because the accumulator is bounded by design; only the *count itself* grows, so the modulus lives on `total`.

### 7.2 Summing a quantity over the range

A whole class of problems asks not "how many numbers" but "the sum of `g(x)` over valid `x` in `[L, R]`" — e.g., the total digit sum of all numbers in the range, or the total number of `7`s. Two production-grade techniques:

- **Return a value, not 0/1.** For "total count of digit 7", carry the running count `c7` of sevens and return `c7` at the base case; the recursion sums it over all numbers. The accumulator (sevens so far) is bounded by `D`.
- **Carry a (count, sum) pair.** To total digit sums, each state returns `(numNumbers, sumOfTheirDigitSums)`. The combine rule: when appending `dig` across `cnt` completed numbers contributing `s`, the new sum contribution is `s + dig·cnt`. This `(count, sum)` pair semiring is the standard way to total an additive quantity over a range — `M` stays the count-DP's `M`, and each cell carries two longs instead of one.

### 7.3 The `(count, sum)` combine, precisely

```
state value = (cnt, sm)   # cnt valid completions; sm = total of g over them
combine over a digit dig that contributes w to g per number:
    child = (c, s)
    contribution = (c, s + w * c)     # each of the c numbers gains w
total over digits = elementwise sum of contributions
```

This generalizes to any additive `g` (digit sum, count of a digit, weighted positional sums). It is the senior idiom for "sum over a range" and composes with the usual accumulators and flags.

### 7.4 Inclusion-exclusion and the negative-residue hazard

Some senior problems combine Digit DP results by inclusion-exclusion: "count numbers divisible by 2 **or** 3" is `f_2 + f_3 − f_6`. The subtraction is the trap. Over a prime modulus, a count difference can go negative *before* reduction, and in Go and Java `%` keeps the sign of the dividend, so `(a - b) % p` may be negative. Always normalize:

```go
result := ((countA - countB) % MOD + MOD) % MOD
```

The same hazard appears in `f(R) − f(L−1)` under a modulus. Three rules:

1. **Compute the difference, then normalize once** with `((d % p) + p) % p`.
2. **Never reduce the two terms to different moduli** and subtract — keep one modulus throughout.
3. **For exact (non-modular) counts, the difference is naturally non-negative** (by Theorem 4.1's set algebra), so a negative result there signals a real bug — assert `f(R) >= f(L−1)` as a guardrail.

For disjunctions of *digit-set* predicates (e.g. "contains a 7 or contains a 3"), prefer the **product-automaton conjunction** for the `∧` term and inclusion-exclusion only at the top level; nesting inclusion-exclusion inside the recursion is error-prone and usually unnecessary.

---

## 8. Code Examples

### 8.1 Go — free-table + tight-walk (stack-safe, bound-independent free states)

```go
package main

import "fmt"

// Count numbers in [0, N] (N as digit string) with digit sum exactly S,
// using a bottom-up free table plus a single tight walk. Stack-safe for huge D.
func countDigitSumScalable(N string, S int) int64 {
	D := len(N)
	// free[pos][sum] = #completions from pos onward with all digits free,
	// such that the FINAL total digit sum is exactly S. Bound-independent.
	free := make([][]int64, D+1)
	for p := 0; p <= D; p++ {
		free[p] = make([]int64, S+1)
	}
	// base: at pos==D, the running sum must already equal S.
	for s := 0; s <= S; s++ {
		if s == S {
			free[D][s] = 1
		}
	}
	for pos := D - 1; pos >= 0; pos-- {
		for s := 0; s <= S; s++ {
			var t int64
			for dig := 0; dig <= 9 && s+dig <= S; dig++ {
				t += free[pos+1][s+dig]
			}
			free[pos][s] = t
		}
	}
	// tight walk down N's digits
	var ans int64
	sum := 0
	for pos := 0; pos < D; pos++ {
		nd := int(N[pos] - '0')
		for dig := 0; dig < nd; dig++ { // strictly below N's digit -> become free
			if sum+dig <= S {
				ans += free[pos+1][sum+dig]
			}
		}
		sum += nd // take N's digit, stay tight
		if sum > S {
			break // tight prefix already overshoots; no tight completion possible
		}
	}
	if sum == S { // N itself is valid (fell off the bottom still tight)
		ans++
	}
	return ans
}

func main() {
	fmt.Println(countDigitSumScalable("21", 3))  // 3
	fmt.Println(countDigitSumScalable("100", 1)) // 1,10,100 -> 3
}
```

### 8.2 Java — sum of a quantity over a range via (count, sum) pair

```java
public class TotalDigitSum {
    // Returns the SUM of digit-sums of all integers in [0, N].
    static int D;
    static int[] dig;
    static long[][] cnt; // cnt[pos][s] for free states
    static long[][] sm;  // sm[pos][s] total digit-sum over those completions
    static boolean[][] seen;

    // returns {count, totalDigitSum} of completions from pos with running sum s, free.
    static long[] solve(int pos, int s) {
        if (pos == D) return new long[]{1, s};
        if (seen[pos][s]) return new long[]{cnt[pos][s], sm[pos][s]};
        long c = 0, total = 0;
        for (int d = 0; d <= 9; d++) {
            long[] child = solve(pos + 1, s + d);
            c += child[0];
            total += child[1];
        }
        seen[pos][s] = true;
        cnt[pos][s] = c;
        sm[pos][s] = total;
        return new long[]{c, total};
    }

    static long totalDigitSum(String N) {
        D = N.length();
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        int maxSum = 9 * D;
        cnt = new long[D + 1][maxSum + 1];
        sm = new long[D + 1][maxSum + 1];
        seen = new boolean[D + 1][maxSum + 1];
        // tight walk accumulating answer
        long count = 0, ans = 0;
        int run = 0;
        for (int pos = 0; pos < D; pos++) {
            for (int d = 0; d < dig[pos]; d++) {
                long[] child = solve(pos + 1, run + d);
                ans += child[1];
            }
            run += dig[pos];
        }
        ans += run; // N itself contributes its own digit sum
        return ans;
    }

    public static void main(String[] args) {
        System.out.println(totalDigitSum("12")); // 0+1+2+...+9+(1+0)+(1+1)+(1+2)=45+1+2+3=51
    }
}
```

### 8.3 Python — arbitrary base, modular count

```python
from functools import lru_cache

MOD = 1_000_000_007


def count_no_forbidden_base(N_digits, base, forbidden):
    """Count numbers in [0, value(N_digits)] in given base whose base-`base`
    digits avoid all digits in `forbidden`. N_digits is a list of base-`base` digits."""
    D = len(N_digits)
    forb = set(forbidden)

    @lru_cache(maxsize=None)
    def solve(pos, tight):
        if pos == D:
            return 1
        limit = N_digits[pos] if tight else base - 1
        total = 0
        for d in range(limit + 1):
            if d in forb:
                continue
            total = (total + solve(pos + 1, tight and d == limit)) % MOD
        return total

    res = solve(0, True)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    # decimal [0, 25], forbid digit 3: drop 3,13,23 -> count
    print(count_no_forbidden_base([2, 5], 10, {3}))
    # base 2, bound 1011b (=11), forbid nothing -> all 12 numbers 0..11
    print(count_no_forbidden_base([1, 0, 1, 1], 2, set()))
```

---

## 9. Observability and Testing

| Check | Why |
|-------|-----|
| Brute-force oracle for all `N ≤ 50000`, all params | Catches off-by-one, leading-zero, tight-cache, decrement bugs. |
| `f(0)` correctness | Confirms the single-position base case and `started`/`0` handling. |
| `f(R) − f(L−1)` on random small `[L, R]` | Catches endpoint and decrement errors. |
| Monotonicity: `f` non-decreasing in `N` | A count of `[0, N]` can never shrink as `N` grows. |
| Additivity: `f(R) = f(M) + (count in (M, R])` | Range decomposition sanity. |
| Base-change consistency | Same value range counted in two bases (where meaningful) agrees. |
| Modular vs exact agreement on small inputs | The mod path matches the exact path when both fit in 64 bits. |

### 9.1 A property-test battery

```text
for random N in [0, 50000], random params:
    assert digit_dp(str(N)) == brute(N)                      # the oracle
    assert digit_dp(str(N)) >= digit_dp(str(N-1))            # monotone (count)
for random 0 <= L <= R <= 50000:
    assert range_dp(L, R) == sum(predicate(x) for x in [L,R])# range oracle
    assert range_dp(L, R) == f(R) - f(L-1)                   # decomposition
assert handles N as a 200-digit string without overflow      # big-N path
```

The oracle plus the range decomposition test, run on a few thousand random instances, gives high confidence. The monotonicity test is a cheap, always-on guardrail in production.

### 9.2 Production guardrails

For a service answering range-count queries: validate that `L ≤ R` and both parse as base-`b` numerals; reject or clamp absurd accumulator parameters (`K = 0`, negative `S`); log the digit count `D` and accumulator size `M` per query so an anomalous (expensive) query stands out; and pre-build the bound-independent free table at startup so per-request work is just the `O(D · base)` tight walk.

### 9.3 A complete fuzz-test harness

The single most effective verification is a randomized comparison against brute force. A production-grade harness in Python:

```python
import random


def fuzz(digit_dp, predicate, trials=20000, max_n=5000):
    """digit_dp(N_str) -> int ; predicate(x) -> bool. Asserts they agree."""
    for _ in range(trials):
        N = random.randint(0, max_n)
        expected = sum(1 for x in range(N + 1) if predicate(x))
        got = digit_dp(str(N))
        assert got == expected, f"N={N}: dp={got} brute={expected}"
    # also test the range form
    for _ in range(trials // 4):
        L = random.randint(0, max_n)
        R = random.randint(L, max_n)
        exp = sum(1 for x in range(L, R + 1) if predicate(x))
        lo = "-1" if L == 0 else str(L - 1)
        got = digit_dp(str(R)) - digit_dp(lo)
        assert got == exp, f"[{L},{R}]: dp={got} brute={exp}"
    print("all fuzz trials passed")


# Example wiring for "divisible by 7":
# fuzz(lambda n: f(n, 7), lambda x: x % 7 == 0)
```

Run this in CI on every change. It exercises the four highest-frequency bug classes — tight-cache pollution, leading-zero handling, the `nextTight` formula, and the `f(R) − f(L−1)` decrement — across thousands of random instances. The range-form half specifically catches `decString` borrow bugs that the single-`f` half cannot see.

### 9.4 Differential testing across languages

Because the same Digit DP is implemented in Go, Java, and Python here, a strong guardrail is **cross-language differential testing**: feed the same `(N, params)` to all three and assert identical output. Divergence almost always means a 32-bit-vs-64-bit overflow in one language (e.g., a Java `int` accumulator where Go used `int64`) or a `%` sign difference on a subtraction. This is the cheapest way to catch language-specific integer hazards that a single-language test suite misses.

---

## 10. Failure Modes

### 10.1 Caching the tight state
Reusing a tight result as if free inflates the count. Mitigation: skip the cache when tight, or key on `tight`. The free-table + tight-walk design (Section 5.3) sidesteps it structurally — tight states are never in the table.

### 10.2 Stale cache across bounds
A memo built for `R` reused for `L−1` returns wrong counts (the per-position limit changed). Mitigation: fresh/reset memo per `f` call, or cache only the bound-independent free states.

### 10.3 Leading-zero mishandling
Padding zeros counted as real digits corrupts adjacency, monotonic, digit-frequency, and mask predicates. Mitigation: gate the accumulator update on `started`; test with numbers far shorter than `D`.

### 10.4 Accumulator explosion
Carrying the full value, a frequency vector, or a product blows up `M`. Mitigation: reduce to a residue, clamp, or bitmask; if the minimal sufficient statistic is genuinely unbounded, Digit DP is the wrong tool.

### 10.5 Big-N decrement bug
A wrong `L − 1` on a string survives all algebraic tests and surfaces only as an off-by-one on real ranges. Mitigation: a unit-tested `decString` covering trailing-zero borrow and leading-zero strip.

### 10.6 Stack overflow on enormous `D`
Top-down recursion has depth `D`; a million-digit bound overflows the stack. Mitigation: switch to the bottom-up free-table + tight-walk form.

### 10.7 Endpoint-semantics confusion
"Strictly less than", "at most", "between inclusive" each map to a different `f(·)` combination. Mitigation: pin the inclusive/exclusive semantics before coding and verify with the range oracle.

### 10.8 `0` included/excluded incorrectly
Whether the number `0` satisfies the predicate (and whether the problem even admits it) is governed by `started` and `isValid`. Mitigation: decide `0`'s status explicitly; test `f(0)` directly.

### 10.9 Negative result from a modular subtraction
`f(R) − f(L−1)` (or an inclusion-exclusion combination) under a prime modulus can produce a negative intermediate because Go/Java `%` keeps the dividend's sign. Mitigation: normalize with `((d % p) + p) % p`; for exact counts assert `f(R) ≥ f(L−1)` as a guardrail (it must hold by Theorem 4.1's set algebra).

---

## 11. Summary

- Digit DP's cost is `O(D · M · base)`; the **accumulator range `M` is the entire performance story**. Bound it with residues, clamps, and masks; never carry the raw value.
- **Tight states are unique per bound and must stay out of the cache** — skip caching when tight, or key on `tight`, or use the free-table + tight-walk decomposition that never puts them in the table.
- The **free-state table is bound-independent**, which enables a persistent cache for batched queries: build once, answer each query with an `O(D · base)` tight walk.
- The bound is **always a string**, so Digit DP scales to hundreds of digits and any base; the only big-number arithmetic is a carefully tested `L − 1` decrement for `f(R) − f(L−1)`.
- For enormous `D`, prefer **bottom-up tabulation** over recursion to stay stack-safe.
- **Summed quantities** over a range use a `(count, sum)` pair (or a value-returning base case) — the senior idiom for "total digit sum over `[L, R]`" and similar.
- **Always keep a brute-force oracle** over all small `N` and parameters; it catches the length off-by-one, the leading-zero mistake, the tight-cache pollution, the decrement bug, and the endpoint error that together account for nearly every real Digit DP defect.

### Decision summary

- **Huge bound, small predicate state, exact count** → top-down Digit DP, free states memoized, `O(D · M · base)`; reduce mod a prime if the count overflows.
- **Many range queries, same predicate** → free-table + tight-walk, persistent bound-independent cache, `O(D · base)` per query.
- **Enormous digit count (≫ 64-bit)** → string bound + bottom-up tabulation; no recursion.
- **Sum of a quantity over the range** → `(count, sum)` pair semiring.
- **Predicate needs the whole prefix value** → stop; the accumulator is unbounded and Digit DP does not apply.
- **Tiny range** → just loop; it is the oracle anyway.

References to study further: AtCoder DP Contest problem S, the `(count, sum)` pair technique for summed quantities, automaton-based digit constraints (forbidden-substring counting via Aho-Corasick), arbitrary-base digit DP, and sibling topics `01-fibonacci-memoization`, `02-tabulation-vs-memoization`, and the broader `13-dynamic-programming` family.
