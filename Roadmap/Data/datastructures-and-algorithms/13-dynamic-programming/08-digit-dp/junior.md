# Digit DP (Counting Numbers in a Range with Digit Constraints) — Junior Level

> **One-line summary:** Digit DP counts how many integers in a range satisfy a digit-based rule by building the number **one digit at a time, most significant first**, while tracking a tiny state — the position, whether we are still "stuck to" the upper bound (the *tight* flag), whether we have only written leading zeros so far, and one problem-specific accumulator (like the running digit sum). Memoizing over that state turns an exponential count into a fast `O(digits × states × base)` computation.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Suppose someone asks: *"How many integers from `0` up to `N` have digits that add up to exactly `S`?"* For example, with `N = 100` and `S = 5`, the answers are `5, 14, 23, 32, 41, 50, 104?` — wait, `104 > 100`, so it does not count — leaving `5, 14, 23, 32, 41, 50` and `100` has digit sum `1`, so the count is `6` for two-digit numbers plus the right one-digit and three-digit numbers. Counting by hand is already fiddly at `N = 100`. Now make `N = 10^18`. There are a *quintillion* numbers to inspect. A loop that visits each one would run for centuries.

There is a beautiful technique that sidesteps the whole quintillion. Instead of iterating over numbers, we iterate over **digit positions**. We build a candidate number digit by digit, from the most significant digit down to the least, and at every step we only need to remember a handful of facts:

> **The canonical Digit DP state is `(position, tight, started, accumulator)`** — where do we count from? how does the upper bound constrain us right now? have we placed a real (non-leading-zero) digit yet? and what running quantity does the problem care about (here, the digit sum so far)?

Because the *number of distinct states* is tiny — proportional to `digits × 2 × 2 × (range of the accumulator)` — and many different prefixes funnel into the same state, we can **memoize** and reuse work. A count that naively takes `O(N)` time collapses to roughly `O(number_of_digits × number_of_states × base)`, which for `N = 10^18` is a few tens of thousands of operations instead of a quintillion.

This running file uses one concrete problem the whole way through:

> **Running example: count integers in `[0, N]` whose digits sum to exactly `S`.**

Once you can do that, every other Digit DP problem — *divisible by `K`*, *no two equal adjacent digits*, *contains a forbidden digit or not*, *digits in non-decreasing order*, *count occurrences of a specific digit* — is the **same skeleton** with a different accumulator. That reuse is the entire payoff of learning the pattern once.

One idea to lock in from minute one: Digit DP almost always answers **"how many numbers `≤ N`"**, written `f(N)`. To count in an arbitrary interval `[L, R]` you compute `f(R) − f(L − 1)` — the same prefix-subtraction trick you have seen with prefix sums. We will lean on this constantly.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Recursion** — a function that calls itself with a smaller subproblem. Digit DP is recursion over digit positions.
- **Memoization / top-down DP** — caching a function's result keyed by its arguments so it is computed once. See sibling topics `01-fibonacci-memoization` and `02-tabulation-vs-memoization`.
- **Place value / positional notation** — that `345` means `3·100 + 4·10 + 5`, and that a number is just a list of digits.
- **Basic counting (the multiplication principle)** — if a prefix has `c` completions and there are `b` free choices for the next digit, you get `c · b` total.
- **Big-O notation** — `O(N)` vs `O(digits × states)` and why the second is astronomically smaller.
- **Arrays and 2D/3D indexing** — the memo table is indexed by the state tuple.

Optional but helpful:

- A glance at **prefix sums**, since `f(R) − f(L−1)` is the same idea applied to counts.
- Familiarity with **modular arithmetic** (`% K`), used when the accumulator is "remainder mod `K`".

---

## Glossary

| Term | Meaning |
|------|---------|
| **Digit DP** | A dynamic-programming technique that counts numbers satisfying digit constraints by recursing over digit positions with a small memoized state. |
| **Bound number `N`** | The upper limit of the range, stored as its **string of digits** so it works for `N` far beyond 64-bit integers. |
| **Position (`pos`)** | The index of the digit we are about to choose, going from the most significant (`pos = 0`) to the least. |
| **Tight (bound) flag** | `true` if every digit so far has exactly matched `N`'s prefix, so the current digit is capped at `N[pos]`; `false` once we have gone strictly below `N`, after which all `base` digits are free. |
| **Leading-zero / started flag** | `true` once we have placed a non-zero digit (the "real" number has started). Distinguishes a written `0` digit from "no digit yet". |
| **Accumulator** | The problem-specific running quantity carried in the state: digit sum, remainder mod `K`, last digit, a bitmask of used digits, etc. |
| **State** | The tuple `(pos, tight, started, accumulator)` that fully describes a subproblem. |
| **`f(N)`** | The count of valid numbers in `[0, N]`. The answer for `[L, R]` is `f(R) − f(L−1)`. |
| **Free digit** | A position where `tight` is `false`, so any digit `0..base-1` is allowed. |
| **Base** | The number of digit values (10 for decimal; the technique works for any base). |

---

## Core Concepts

### 1. A Number Is Just a List of Digits

The first mental shift: stop thinking of `N` as a single integer and start thinking of it as a sequence of digits, most significant first. For `N = 325`, that is `[3, 2, 5]`. We will choose our candidate number's digits left to right, one per recursion level. The position index `pos` tells us which digit we are deciding now.

We always store `N` as a **string** (or an array of digit ints). This is what lets Digit DP handle `N = 10^18` or even a 100-digit `N` — we never need `N` to fit in a machine integer, only its digits.

### 2. The Tight (Bound) Flag — the Heart of the Technique

When we build a number with the same number of digits as `N` and we want it to stay `≤ N`, the constraint is subtle. As long as every digit we have written so far *exactly equals* `N`'s corresponding digit, we are "riding the boundary" — the next digit cannot exceed `N`'s next digit, or we would overshoot. We call this state **tight**.

The moment we place a digit *strictly smaller* than `N`'s digit at that position, we drop below `N` for good. From then on, **every remaining digit is free** to be anything in `0..base-1`, because no matter what we pick, the number stays below `N`. We call this state **free** (`tight = false`).

```
N = 3 2 5
    ↑
choose first digit d in 0..3 (capped by N[0]=3 because we are tight):
  d = 0,1,2  → now we are FREE (below N), rest of digits unrestricted
  d = 3      → still TIGHT (matched N's digit), next digit capped by N[1]=2
```

This single boolean is what makes the count correct *and* lets us memoize, as the next concept explains.

### 3. Why We Recurse Position by Position

A valid number `≤ N` with the digit property is built one digit at a time. At each position we try each allowed digit, update the accumulator, and recurse to the next position. When we run out of positions (`pos == len(N)`), we check whether the accumulated state satisfies the target and return `1` (valid) or `0` (invalid). Summing over all digit choices at every level counts all valid numbers — exactly like exploring a tree of digit choices, but smartly.

### 4. Memoization: Why It Is Fast

A pure digit-by-digit recursion explores `base^digits` leaves — exponential. The rescue is that **most of those branches share the same future**. Once we are `tight = false` (free), the only things that affect how many valid completions remain are `pos` and the `accumulator`. Two completely different prefixes that reach the same `(pos, accumulator)` in the free state have *identical* counts of completions. So we cache the result keyed by `(pos, started, accumulator)` for the free states and reuse it.

```
memo[pos][started][accumulator] = number of valid completions from here, assuming free
```

This collapses the exponential tree into a small table.

### 5. The Tight States Are NOT Cached

Here is the subtlety that trips up nearly everyone. When `tight = true`, the set of allowed digits at this position depends on `N` — it is capped at `N[pos]`. A tight `(pos, accumulator)` therefore has a *different* number of completions than a free `(pos, accumulator)` with the same values. Worse, for a fixed `N` there is **exactly one** tight prefix at each position (the prefix equal to `N` so far), so caching it gains nothing and risks returning a wrong (free) cached value.

> **Rule: memoize only the `tight = false` states. Never store or read the cache when `tight` is `true`.**

We will see this in every code sample: the cache read/write is guarded by `if !tight`.

### 6. The Leading-Zero (`started`) Flag

What is the digit sum of the number `7`? It is `7`. But if we are building three-digit-wide candidates for `N = 325`, the number `7` is written as `0 0 7`. Those two leading zeros are *not real digits* — they must not count toward "no two equal adjacent digits" (the two `0`s would falsely look adjacent-equal), nor toward "count of digit 0", nor toward "non-decreasing order". For the plain digit-sum problem the leading zeros add `0` and are harmless, but for most other constraints you must know whether the real number has started yet. The `started` flag tracks that: it flips from `false` to `true` the first time we place a non-zero digit.

### 7. Counting `[L, R]` via `f(R) − f(L − 1)`

Digit DP computes `f(X)` = count of valid numbers in `[0, X]`. To count in an interval:

```
answer for [L, R]  =  f(R) − f(L − 1)
```

This is the exact analogue of prefix sums: "valid numbers up to `R`" minus "valid numbers up to `L−1`" leaves "valid numbers in `[L, R]`". You compute `L − 1` once (as a string/big number if needed), run the same `f` twice, and subtract. (Middle level covers the big-`N` subtraction carefully.)

---

## Big-O Summary

Let `D` = number of digits in `N` (about `log₁₀ N`), `B` = base (10 for decimal), and `M` = the number of distinct accumulator values.

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Brute force: test every number in `[0, N]` | **O(N · D)** | O(1) | Hopeless for `N = 10^18`. |
| Digit DP, single `f(N)` | **O(D · M · B)** | O(D · M) | The standard method; `B` is the per-state digit loop. |
| Range `[L, R]` = `f(R) − f(L−1)` | O(D · M · B) | O(D · M) | Two `f` calls; same asymptotics. |
| Reading one memo entry | O(1) | — | After it is filled. |
| Digit-sum problem specifically | O(D · (9D) · B) | O(D · 9D) | Accumulator = sum, ranges `0..9D`. |

The headline cost is **`O(D · M · B)`** — polynomial in the *number of digits*, not in `N` itself. For `N = 10^18` that is roughly `18 × (small M) × 10` ≈ tens of thousands of operations. The exponential `O(N)` is gone.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Building the number digit by digit | Setting a combination lock from the leftmost dial to the rightmost, one wheel at a time. |
| The tight flag | A "speed limit" sign: while you exactly match the boundary you must obey the cap `N[pos]`; once you drop below, the limit is lifted and you can pick any digit. |
| Free state (`tight = false`) | Once you are below the boundary, every remaining dial spins freely through all 10 numbers. |
| Memoization | A notebook where you jot "from this dial position with this running sum, there are exactly 42 valid endings" — so you never recompute it. |
| Leading-zero flag | Knowing whether you have "started writing" the number or are still padding with blanks; a blank is not the digit `0`. |
| `f(R) − f(L−1)` | Counting people who entered a building by time `R` minus those who entered by time `L−1` gives those who entered during `(L−1, R]`. |

Where the analogy breaks: a real combination lock has independent dials, but in Digit DP the dials are *coupled* through the tight flag — early choices constrain later ones until you go below the bound.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Counts over ranges as huge as `10^18` (or bigger, with string `N`) in `O(D · M · B)`. | Only **counts** numbers; it does not list them efficiently (listing is `O(answer)`). |
| One skeleton solves a whole family of digit-constraint problems — just swap the accumulator. | Designing the right accumulator (and bounding `M`) takes practice. |
| The `f(R) − f(L−1)` trick handles arbitrary intervals uniformly. | The tight/leading-zero/cache interplay is a notorious source of off-by-one and cache-pollution bugs. |
| Works in any base with no change of idea. | If the accumulator's range is large (e.g., the full number value), the state blows up and DP fails. |
| Memoization makes it fast and the code is short once internalized. | Easy to silently corrupt results by caching tight states or mishandling leading zeros. |

**When to use:** counting (not listing) integers in `[0, N]` or `[L, R]` that satisfy a property expressible as a *small* running state over digits — digit sum, divisibility, adjacency rules, monotonic digits, digit-frequency constraints, forbidden digits.

**When NOT to use:** when you must *enumerate* the numbers (Digit DP only counts), when the property needs the whole number's value (no small accumulator), or when the range is tiny enough that a plain loop is simpler and clearer.

---

## Step-by-Step Walkthrough

Let us count integers in `[0, N]` with digit sum exactly `S`, using a small concrete case so we can verify by hand: **`N = 21`, `S = 3`**.

By hand, the numbers in `[0, 21]` with digit sum `3` are: `3`, `12`, `21`, and `30`? — `30 > 21`, drop it. So the answer is **`{3, 12, 21}` → 3 numbers**. Let us see Digit DP reach the same count.

Write `N = "21"`, so digits are `[2, 1]`, two positions. We recurse from `pos = 0` with `tight = true` (we start riding the bound) and running `sum = 0`.

```
pos=0, tight=true, sum=0   (cap = N[0] = 2, so first digit d ∈ {0,1,2})

 ├─ d=0 → sum=0, now tight=false (0 < 2)        prefix "0_"
 │    pos=1, tight=false, sum=0   (free: d ∈ 0..9)
 │      need final sum = 3 → choose d=3 → "03" = 3  ✓ (1 way)
 │
 ├─ d=1 → sum=1, now tight=false (1 < 2)        prefix "1_"
 │    pos=1, tight=false, sum=1   (free: d ∈ 0..9)
 │      need d so that 1+d = 3 → d=2 → "12" = 12 ✓ (1 way)
 │
 └─ d=2 → sum=2, still tight=true (2 == 2)      prefix "2_"
      pos=1, tight=true, sum=2   (cap = N[1] = 1, so d ∈ {0,1})
        d=0 → "20", sum=2 ✗ (need 3)
        d=1 → "21", sum=3 ✓ (1 way)   ← this is the tight leaf
```

Adding the checkmarks: `03 (=3)`, `12`, `21` → **3 numbers**, matching the hand count.

Notice three things this tiny tree already teaches:

1. **Leading zeros are fine for digit sum.** `"03"` is the number `3`; its leading zero contributes `0` to the sum, so it counts correctly. (For other constraints we would need the `started` flag — see Core Concept 6.)
2. **The tight branch (`d = 2`) is capped** at `N[1] = 1`, so it could not try `d = 2..9` at the last position. That cap is exactly what keeps us `≤ 21`.
3. **The free branches explored the full `0..9`** for the last digit, but only the digit completing the sum to `3` was valid. Two different free prefixes (`"0_"` with sum 0, `"1_"` with sum 1) reach *different* `(pos, sum)` states, so no caching reuse happened here — but on larger `N` many prefixes collapse to the same `(pos=1, sum=1)` free state, and *that* is where memoization saves the day.

When `pos == 2` (past the last digit) we would check `sum == S` and return `1` or `0`; in the trace above we folded that base case into the last-digit choice for brevity.

---

## Code Examples

### Example: Count integers in `[0, N]` with digit sum exactly `S`

We pass `N` as a **string** so it scales past 64-bit. The recursion carries `(pos, tight, sum)`. (We omit `started` here because leading zeros do not affect a digit *sum*; the middle file adds it for constraints that need it.) The memo is read/written only when `tight` is false.

#### Go

```go
package main

import "fmt"

func countDigitSum(N string, S int) int64 {
	d := len(N)
	// memo[pos][sum]; -1 = uncomputed. Only for the FREE (tight=false) states.
	memo := make([][]int64, d)
	for i := range memo {
		memo[i] = make([]int64, S+1)
		for j := range memo[i] {
			memo[i][j] = -1
		}
	}

	var rec func(pos int, tight bool, sum int) int64
	rec = func(pos, _sum int, tight bool, sum int) int64 { return 0 } // placeholder, replaced below
	_ = rec

	var solve func(pos int, tight bool, sum int) int64
	solve = func(pos int, tight bool, sum int) int64 {
		if sum > S {
			return 0 // prune: already overshot the target sum
		}
		if pos == d {
			if sum == S {
				return 1
			}
			return 0
		}
		if !tight && memo[pos][sum] != -1 {
			return memo[pos][sum] // cache hit — only for free states
		}
		limit := 9
		if tight {
			limit = int(N[pos] - '0') // capped by the bound's digit
		}
		var total int64
		for dig := 0; dig <= limit; dig++ {
			nextTight := tight && (dig == limit)
			total += solve(pos+1, nextTight, sum+dig)
		}
		if !tight {
			memo[pos][sum] = total // store only free-state results
		}
		return total
	}
	return solve(0, true, 0)
}

func main() {
	fmt.Println(countDigitSum("21", 3))   // 3  -> {3, 12, 21}
	fmt.Println(countDigitSum("100", 5))  // numbers in [0,100] with digit sum 5
	fmt.Println(countDigitSum("1000000000000000000", 1)) // huge N, instant
}
```

#### Java

```java
public class DigitSumCount {

    static int D, S;
    static int[] digits;
    static long[][] memo; // memo[pos][sum], free states only; -1 = uncomputed

    static long solve(int pos, boolean tight, int sum) {
        if (sum > S) return 0;            // prune
        if (pos == D) return (sum == S) ? 1 : 0;
        if (!tight && memo[pos][sum] != -1) return memo[pos][sum];

        int limit = tight ? digits[pos] : 9;
        long total = 0;
        for (int dig = 0; dig <= limit; dig++) {
            boolean nextTight = tight && (dig == limit);
            total += solve(pos + 1, nextTight, sum + dig);
        }
        if (!tight) memo[pos][sum] = total;
        return total;
    }

    static long countDigitSum(String N, int s) {
        D = N.length();
        S = s;
        digits = new int[D];
        for (int i = 0; i < D; i++) digits[i] = N.charAt(i) - '0';
        memo = new long[D][S + 1];
        for (long[] row : memo) java.util.Arrays.fill(row, -1);
        return solve(0, true, 0);
    }

    public static void main(String[] args) {
        System.out.println(countDigitSum("21", 3));   // 3
        System.out.println(countDigitSum("100", 5));
        System.out.println(countDigitSum("1000000000000000000", 1)); // instant
    }
}
```

#### Python

```python
from functools import lru_cache


def count_digit_sum(N: str, S: int) -> int:
    digits = [int(c) for c in N]
    D = len(digits)

    # lru_cache keys on (pos, tight, sum). We deliberately let it cache all states,
    # but tight=True states are unique per pos for a fixed N, so they never collide
    # with the free ones (tight is part of the key). The classic optimization is to
    # NOT key on tight and skip caching when tight — shown in middle.md.
    @lru_cache(maxsize=None)
    def solve(pos: int, tight: bool, s: int) -> int:
        if s > S:
            return 0  # prune
        if pos == D:
            return 1 if s == S else 0
        limit = digits[pos] if tight else 9
        total = 0
        for dig in range(0, limit + 1):
            next_tight = tight and (dig == limit)
            total += solve(pos + 1, next_tight, s + dig)
        return total

    result = solve(0, True, 0)
    solve.cache_clear()  # clear between different N to avoid stale entries
    return result


if __name__ == "__main__":
    print(count_digit_sum("21", 3))    # 3 -> {3, 12, 21}
    print(count_digit_sum("100", 5))
    print(count_digit_sum("1" + "0" * 18, 1))  # huge N, instant
```

**What it does:** builds each candidate digit by digit, caps the digit at `N[pos]` while tight, accumulates the running digit sum, and returns `1` at the end exactly when `sum == S`. The free-state memo makes it fast.
**Run:** `go run main.go` | `javac DigitSumCount.java && java DigitSumCount` | `python digitsum.py`

> Note: the Go sample includes an unused placeholder `rec` only to mirror common scaffolding; the real worker is `solve`. You can delete `rec` safely.

---

## Coding Patterns

### Pattern 1: Brute-Force Counter (the oracle you test against)

**Intent:** Before trusting Digit DP, count the slow, obvious way on small `N` and check they agree.

```python
def count_digit_sum_bruteforce(N: int, S: int) -> int:
    return sum(1 for x in range(0, N + 1)
               if sum(int(c) for c in str(x)) == S)
```

This is `O(N · digits)` — too slow for huge `N`, but a perfect correctness oracle for `N ≤ 10^5`. Your Digit DP must match it for every small `N` and `S`.

### Pattern 2: The Range Wrapper `f(R) − f(L−1)`

**Intent:** Turn the "`≤ N`" counter into an interval counter.

```python
def count_in_range(L: int, R: int, S: int) -> int:
    # f(X) = count_digit_sum(str(X), S)
    return count_digit_sum(str(R), S) - count_digit_sum(str(L - 1), S)
```

If `L == 0`, then `L − 1 = −1`; just treat `f(−1) = 0` (no numbers below zero). Middle level handles big-`L` string subtraction.

### Pattern 3: The Universal Digit-DP Skeleton

**Intent:** Every Digit DP looks like this; only the accumulator update and the final test change.

```mermaid
graph TD
    A["solve(pos, tight, started, acc)"] --> B{pos == len?}
    B -- yes --> C[return is_valid acc ? 1 : 0]
    B -- no --> D[limit = tight ? N[pos] : base-1]
    D --> E[loop dig = 0..limit]
    E --> F[update acc, started; nextTight = tight && dig==limit]
    F --> G["recurse solve(pos+1, nextTight, ...)"]
    G --> H{tight?}
    H -- no --> I[store memo, then return sum]
    H -- yes --> J[return sum without caching]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Count too large | Cached the **tight** state and reused it as if free. | Guard cache read/write with `if not tight`. |
| Off-by-one on `[L, R]` | Used `f(R) − f(L)` instead of `f(R) − f(L−1)`. | Subtract `f(L−1)`; the lower bound is inclusive. |
| Wrong answer when `L = 0` | Computed `f(−1)` incorrectly. | Define `f(−1) = 0`. |
| Stale results across calls (Python `lru_cache`) | Cache from a previous `N` leaked into the next run. | `cache_clear()` between different bounds, or pass `N` into the key. |
| `IndexError` on `N[pos]` | Recursed past the last position without a base case. | Return at `pos == len(N)`. |
| Negative array index in memo | Accumulator went out of its declared range (e.g., `sum > S`). | Prune `sum > S` early, or size the table to the true max. |
| Counts overflow (rare) | Huge `N` with permissive constraint exceeds 64-bit. | Use `long`/`int64`, or take the count mod a prime if the problem asks. |

---

## Performance Tips

- **Cache only the free states.** Reading/writing the memo only when `tight` is false is both *correct* and *fast* — tight states are unique per position and not worth caching.
- **Prune impossible accumulators early.** For digit sum, `if sum > S: return 0` cuts whole subtrees before recursing.
- **Size the memo to the real accumulator range.** For digit sum that is `0..S` (or `0..9D`); for "mod `K`" it is `0..K−1`. A right-sized table keeps memory tiny.
- **Reset (not reallocate) the memo** between the two `f` calls if you reuse a global table — fill with `-1`, do not allocate twice in a hot loop.
- **Keep the state minimal.** Every extra dimension multiplies the table size; drop any flag the specific problem does not need (e.g., `started` is unnecessary for plain digit sum).

---

## Best Practices

- Always test Digit DP against the brute-force oracle (Pattern 1) on every `N` from `0` to a few thousand before trusting it.
- Pass `N` as a **string** from the start; never assume it fits in `int`.
- Write the recursion with the exact signature `solve(pos, tight, started, acc)` even if a flag is unused for this problem — it makes adapting to the next problem mechanical.
- Decide up front whether the problem needs `started` (most non-sum problems do) and document why.
- Implement `f(N)` once and build `[L, R]` on top of it with `f(R) − f(L−1)`; do not write two separate counters.
- Name the base/limit logic clearly (`limit = tight ? N[pos] : base-1`) so the tight cap is obvious to a reviewer.

---

## Edge Cases & Pitfalls

- **`N = 0`** — the only number is `0`; `f(0)` should count it (digit sum `0`). Make sure the recursion returns the right value for a single-position bound.
- **`S = 0`** — only the number `0` (and leading-zero representations of it) has digit sum `0`. Watch how leading zeros interact with `started` here.
- **`L = 0`** — `f(L−1) = f(−1) = 0`; do not call the DP with a negative bound.
- **Leading zeros** — harmless for digit *sum*, but they break "no two equal adjacent digits", "non-decreasing digits", and "count of digit 0". Use the `started` flag for those (middle level).
- **Single-digit `N`** — `D = 1`; the recursion has one position. Still correct, but a common place for off-by-one base-case bugs.
- **Caching tight states** — the single most common correctness bug. Tight states must never be served from (or written to) the free-state cache.
- **Accumulator out of range** — if you forget to prune, `sum` can exceed your table size and crash or corrupt.

---

## Common Mistakes

1. **Caching the tight state.** Reusing a tight result as if it were free inflates the count. Always guard with `if not tight`.
2. **`f(R) − f(L)` instead of `f(R) − f(L−1)`.** Off-by-one that drops or double-counts the endpoint `L`.
3. **Forgetting the `started` flag** on problems where leading zeros matter (adjacency, monotonic digits, digit-0 counting).
4. **Treating `N` as an `int`.** For `N = 10^18` you need a string; otherwise it overflows or you cannot even read it.
5. **Wrong `nextTight`.** It must be `tight && (dig == limit)`; using `dig == 9` or forgetting the `&& tight` part corrupts the bound.
6. **No base case / wrong base case.** Forgetting `pos == len(N)` returns garbage; returning `1` unconditionally counts invalid numbers.
7. **Mutating shared memo across different `N`** without clearing it, leaking stale counts between calls.

---

## Cheat Sheet

| Question | State accumulator | Final test |
|----------|-------------------|------------|
| Digit sum `= S` in `[0, N]` | running sum | `sum == S` |
| Divisible by `K` | running value `mod K` | `rem == 0` |
| No two equal adjacent digits | last digit placed | (checked during recursion) |
| Count of digit `d` | running count of `d` seen | return that count (sum over paths) |
| No forbidden digits | (none — just restrict the digit loop) | reached the end |
| Digits non-decreasing | last digit placed | (only allow `dig ≥ last`) |
| Range `[L, R]` | wrap any of the above | `f(R) − f(L−1)` |

Core skeleton:

```
solve(pos, tight, started, acc):
    if pos == len(N): return isValid(acc, started) ? 1 : 0
    if not tight and memo[pos][...] set: return memo[pos][...]   # FREE states only
    limit = tight ? N[pos] : base-1
    total = 0
    for dig in 0..limit:
        total += solve(pos+1, tight && dig==limit, started || dig>0, update(acc,dig))
    if not tight: memo[pos][...] = total
    return total
# cost: O(D · states · base);  range = f(R) - f(L-1)
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The bound number `N`'s digits laid out with the current position highlighted
> - The **tight branch** (capped at `N[pos]`) versus the **free branch** (all digits allowed) splitting at each position
> - The running accumulator (digit sum) updating as digits are placed
> - Counts bubbling up from the leaves and accumulating toward the root
> - Step / Run / Reset controls to watch each digit decision unfold

---

## Summary

Digit DP counts numbers in a range that satisfy a digit-based rule by building the number **one digit at a time, most significant first**, instead of iterating over the numbers themselves. The state is small: `(pos, tight, started, accumulator)`. The **tight flag** caps the current digit at `N[pos]` while we ride the boundary and frees all later digits once we drop below; the **started flag** distinguishes real digits from leading-zero padding; and the **accumulator** carries whatever the problem measures — for our running example, the digit sum. We **memoize only the free (`tight = false`) states**, because tight states are unique per position and caching them would corrupt the count. The whole thing runs in `O(D · states · base)` — polynomial in the number of digits, so `N = 10^18` is trivial. And ranges come for free via `f(R) − f(L−1)`. Master this one skeleton with the digit-sum example, and divisibility, adjacency, monotonicity, and digit-frequency problems all fall to the same code.

---

## Further Reading

- *Competitive Programmer's Handbook* (Laaksonen) — the chapter on Digit DP and counting problems.
- Sibling topic `01-fibonacci-memoization` — the memoization foundation Digit DP builds on.
- Sibling topic `02-tabulation-vs-memoization` — top-down vs bottom-up table filling.
- cp-algorithms.com — "Digit DP" and related counting techniques.
- AtCoder DP Contest, problem S ("Digit Sum") — the canonical first Digit DP exercise.
- LeetCode 233 ("Number of Digit One"), 357, 902, 1012 — classic Digit DP practice problems.
