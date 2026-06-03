# Digit DP (Counting Numbers in a Range with Digit Constraints) — Middle Level

> **Focus:** Why leading-zero handling is mandatory for most constraints, how `[L, R]` decomposes into `f(R) − f(L−1)` even when `L` and `R` are 100-digit strings, how to swap accumulators (remainder mod `K`, masks, last digit) into the *same* skeleton, the exact reason tight states must stay out of the cache, and how Digit DP compares with the alternatives.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Multiple Accumulators](#multiple-accumulators)
6. [Range Decomposition and Big-N Subtraction](#range-decomposition-and-big-n-subtraction)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single skeleton: recurse over digit positions carrying `(pos, tight, started, accumulator)`, memoize the free states, and read off `f(N)`. At middle level you start asking the engineering questions that decide whether the solution is *correct* on the awkward inputs and *general* across the problem family:

- When exactly does the leading-zero (`started`) flag change the answer, and what breaks if you omit it?
- How do you turn `[L, R]` into two `f(·)` calls when `L` and `R` are too big for any integer type — and how do you compute `L − 1` on a digit string?
- How do you fit *different* accumulators — remainder mod `K`, a bitmask of used digits, the last digit — into the same recursion without rewriting it?
- Why, precisely, must the tight state stay out of the cache, and what is the cost of getting that wrong?
- When is Digit DP the right tool versus a closed-form combinatorial formula or a plain loop?

These questions separate "I copied a digit-sum template" from "I can model any digit-constraint counting problem and trust the edges."

---

## Deeper Concepts

### Restating the recurrence with all four state fields

Let `solve(pos, tight, started, acc)` return the number of valid completions of the number from position `pos` onward, given:

- `pos` — the next digit index (`0` = most significant).
- `tight` — whether the prefix so far equals `N`'s prefix (so this digit is capped at `N[pos]`).
- `started` — whether a non-zero digit has been placed yet (whether the "real" number has begun).
- `acc` — the problem-specific accumulator.

```
solve(pos, tight, started, acc):
    if pos == D:
        return isValid(acc, started)              # 1 or 0
    limit = tight ? N[pos] : base-1
    total = 0
    for dig in 0..limit:
        nstarted = started || (dig != 0)
        ntight   = tight && (dig == limit)
        nacc     = update(acc, dig, started)       # update depends on started for some problems
        total   += solve(pos+1, ntight, nstarted, nacc)
    if not tight: memo[pos][started][acc] = total  # FREE states only
    return total
```

The accumulator update sometimes depends on `started` (e.g., for "non-decreasing digits" you ignore leading zeros when deciding the last digit). That coupling is exactly why `started` is part of the state, not a side variable.

### The leading-zero flag, precisely

A number written to width `D` is left-padded with zeros: `7` inside a 3-digit frame is `007`. Those padding zeros are *not real digits*. The `started` flag is `false` while we are still in the padding and flips to `true` on the first non-zero digit. Three classes of constraint **need** it:

| Constraint | Why leading zeros corrupt the naive version |
|------------|---------------------------------------------|
| No two equal adjacent digits | `0070` would treat the two padding `0`s as "adjacent equal" and wrongly reject. |
| Digits non-decreasing | Padding `0`s are `≤` everything, so they pass silently, but the *first real* digit must be compared against "nothing", not against a fake `0`. |
| Count occurrences of digit `0` | Padding zeros would be counted as real `0` digits, inflating the count for `0`. |
| Count of distinct digits / bitmask | Padding zeros would set bit `0` in the mask before the number even starts. |

For the plain **digit sum**, leading zeros add `0` and are harmless — which is why the junior file could skip `started`. Treat that as the exception, not the rule.

> **Convention:** the number `0` itself. With `started`, `0` is the unique value where `started` stays `false` for every position. Decide explicitly whether `0` is "valid" for your predicate (often it is, sometimes the problem excludes it), and encode that in `isValid(acc, started)`.

### Why tight states must not be cached — the precise argument

Fix the bound `N`. At a given position `pos`, **there is exactly one tight prefix**: the prefix equal to `N[0..pos-1]`. Every other prefix is free. So:

1. **No reuse to gain.** A tight `(pos, ...)` is visited at most once during a single `f(N)` computation. Caching something visited once buys nothing.
2. **Active harm if keyed without `tight`.** If your cache key omits `tight` (a common space optimization), then a tight visit and a free visit to the *same* `(pos, acc)` would share a slot. They have **different** completion counts (tight is capped at `N[pos]`, free allows all `base` digits). Whichever writes first poisons the other. The result is silently wrong.

There are two clean ways to be correct:

- **Key on `tight`** (include it in the memo dimensions) — then tight and free never collide, but you waste space on tight entries that are never reused.
- **Skip caching when tight** (the idiomatic choice) — `if not tight` guards both the read and the write. This is the smallest correct cache.

Both appear in the code below. The skip-when-tight version is standard.

### The state-count bound (where the speed comes from)

The number of *distinct free states* is `D × 2 (started) × M (accumulator values)`. Each is computed once and loops over `base` digits. Hence `O(D · M · base)`. The tight states add only `O(D · base)` more (one tight prefix per position). For digit sum, `M = O(9D)`; for "mod `K`", `M = K`; for a bitmask over 10 digits, `M = 2^10`. **The accumulator's range is the whole performance story** — keep it small.

---

## Comparison with Alternatives

### Digit DP vs brute-force loop vs closed-form

| Approach | Time for `[0, N]` | Good when |
|----------|-------------------|-----------|
| Brute-force loop over all numbers | `O(N · D)` | `N ≤ ~10^7`; trivially correct, used as the oracle |
| **Digit DP** | `O(D · M · base)` | `N` huge (up to `10^18` or string `N`), property has a small accumulator |
| Closed-form combinatorics | `O(D)` or `O(1)` | The count has a clean formula (e.g., "numbers with all distinct digits") |
| Inclusion-exclusion / stars-and-bars | varies | Digit-sum counts can sometimes be done with binomials, but Digit DP is more general |

Concrete table (`base = 10`):

| `N` | Brute-force ops (`N`) | Digit DP ops (`D · M · 10`, digit-sum `M≈9D`) | Winner |
|------|-----------------------|-----------------------------------------------|--------|
| 100 | 100 | ~2 × 18 × 10 ≈ 360 | brute force (simpler) |
| 10⁴ | 10⁴ | ~4 × 36 × 10 ≈ 1 440 | tie |
| 10⁹ | 10⁹ | ~9 × 81 × 10 ≈ 7 290 | Digit DP |
| 10¹⁸ | 10¹⁸ (impossible) | ~18 × 162 × 10 ≈ 29 160 | Digit DP |

The lesson: for **small `N`**, just loop — it is simpler and the oracle anyway. For **large `N`**, Digit DP wins by an astronomical margin, and the cost is essentially independent of `N` (only of its digit count).

### Digit DP vs a closed-form formula

Some digit-constraint counts have neat formulas: the number of `D`-digit strings with strictly increasing digits is `C(9, D)`-ish; the number with all distinct digits is a falling-factorial product. When a formula exists it is `O(1)`–`O(D)` and beats Digit DP. But formulas are brittle: change "increasing" to "increasing with digit sum `≤ S` and not containing `4`" and the formula evaporates while Digit DP just adds accumulator fields. **Digit DP is the general hammer; reach for a formula only when the problem is clean and you are sure.**

---

## Advanced Patterns

### Pattern: No two equal adjacent digits (needs `started` + last digit)

The accumulator is the **last placed digit** (or a sentinel meaning "none yet"). We forbid `dig == last` once started.

```text
state: (pos, tight, started, last)   last ∈ {0..9} or -1 (none)
at each dig: if started and dig == last: skip
             nstarted = started || dig != 0
             nlast = (nstarted ? dig : -1)
```

Leading zeros must not be treated as a "last digit" of `0`, or you would wrongly forbid the first real digit from being `0`. That is exactly why `started` gates `last`.

### Pattern: Numbers without forbidden digits (no accumulator at all)

"Count numbers in `[0, N]` that never use the digit `4`" needs **no accumulator** — you simply skip `dig == 4` in the digit loop. The state is just `(pos, tight, started)`. This is the simplest Digit DP and a good sanity exercise.

### Pattern: Digits in non-decreasing order (last digit, gated by started)

Allow `dig` only if `not started or dig >= last`. The accumulator is `last`; `started` ensures the *first real* digit has no lower bound.

### Pattern: Count of a given digit (accumulator = running count)

To count, across all valid numbers, how many times digit `7` appears (a *sum*, not a *count of numbers*), carry `cnt7` and at the base case **return `cnt7`** rather than `1`. The recursion then sums digit-7 occurrences over all numbers `≤ N`. This is the subtle "sum of a quantity over a range" variant — the base case returns a value other than `0/1`.

---

## Multiple Accumulators

The accumulator does not have to be a single integer. You can carry several fields at once; the state space is their product, so keep each small.

### Remainder mod `K` (divisibility)

To count numbers in `[0, N]` divisible by `K`, carry the running value **mod `K`**. When you append digit `dig`, the value updates as `value = value * base + dig`, so:

```
rem' = (rem * base + dig) % K
```

At the base case, valid iff `rem == 0` (and, if the problem excludes `0`, gate on `started`). The accumulator range is `0..K-1`, so `M = K` and the cost is `O(D · K · base)`. This is the cleanest demonstration that the accumulator is just "whatever finite state the predicate needs."

### Bitmask of used digits

For constraints like "count numbers whose digits are all distinct" or "uses an even number of distinct digits", carry a `base`-bit **mask** of which digits have appeared. Appending `dig` sets bit `dig`. With `started` you avoid setting bit `0` from padding. `M = 2^base` (1024 for decimal), so this is heavier — viable but watch the size.

### Combining accumulators

You can carry, say, `(rem mod K, digitSum)` together: the state becomes `(pos, tight, started, rem, sum)` and `M = K × (9D+1)`. Multiplying accumulator ranges multiplies the table — so combine only what the predicate truly needs, and prune aggressively.

---

## Range Decomposition and Big-N Subtraction

### The decomposition

```
count valid in [L, R]  =  f(R) − f(L − 1)
```

where `f(X)` counts valid numbers in `[0, X]`. This is prefix subtraction on counts. Two practical wrinkles:

1. **`L = 0`** → `L − 1 = −1`; define `f(−1) = 0` (no numbers below zero) and skip the call.
2. **`L` is a huge string** → you cannot do `L - 1` in an `int`. Subtract one on the digit string.

### Decrementing a digit string by one

To compute `L − 1` when `L` is a string of digits:

```
def dec_string(s):           # s is a non-negative integer as a string, s != "0"
    digits = list(s)
    i = len(digits) - 1
    while i >= 0 and digits[i] == '0':
        digits[i] = '9'      # borrow
        i -= 1
    digits[i] = str(int(digits[i]) - 1)
    result = ''.join(digits).lstrip('0')
    return result or '0'     # avoid empty string
```

This is the only "big number" arithmetic Digit DP needs — a single decrement. (`R` is used as-is; you never add to it.)

### Inclusive vs exclusive endpoints

Digit DP's `f(X)` is inclusive of `X`. So `[L, R]` (both inclusive) is `f(R) − f(L−1)`. If a problem says "strictly less than `R`", use `f(R−1)`. Pin the endpoint semantics down before coding — this is the #1 off-by-one source.

---

## Code Examples

### Count divisible-by-`K` in `[L, R]` (remainder accumulator) — Go

```go
package main

import "fmt"

func countDivisible(N string, K int) int64 {
	if N == "-1" { // sentinel for f(-1)
		return 0
	}
	d := len(N)
	// memo[pos][rem]; free states only.
	memo := make([][]int64, d)
	for i := range memo {
		memo[i] = make([]int64, K)
		for j := range memo[i] {
			memo[i][j] = -1
		}
	}
	var solve func(pos int, tight bool, rem int) int64
	solve = func(pos int, tight bool, rem int) int64 {
		if pos == d {
			if rem == 0 {
				return 1
			}
			return 0
		}
		if !tight && memo[pos][rem] != -1 {
			return memo[pos][rem]
		}
		limit := 9
		if tight {
			limit = int(N[pos] - '0')
		}
		var total int64
		for dig := 0; dig <= limit; dig++ {
			total += solve(pos+1, tight && dig == limit, (rem*10+dig)%K)
		}
		if !tight {
			memo[pos][rem] = total
		}
		return total
	}
	return solve(0, true, 0)
}

// decString returns the decimal string of (value(s) - 1) for s != "0".
func decString(s string) string {
	b := []byte(s)
	i := len(b) - 1
	for i >= 0 && b[i] == '0' {
		b[i] = '9'
		i--
	}
	b[i]--
	// strip leading zeros
	k := 0
	for k < len(b)-1 && b[k] == '0' {
		k++
	}
	return string(b[k:])
}

func main() {
	// count multiples of 3 in [10, 25]
	L, R, K := "10", "25", 3
	var lowered string
	if L == "0" {
		lowered = "-1"
	} else {
		lowered = decString(L)
	}
	ans := countDivisible(R, K) - countDivisible(lowered, K)
	fmt.Println("multiples of 3 in [10,25]:", ans) // 12,15,18,21,24 -> 5
}
```

### Count divisible-by-`K` in `[L, R]` — Java

```java
public class DivisibleRange {
    static int D, K;
    static int[] digits;
    static long[][] memo;

    static long solve(int pos, boolean tight, int rem) {
        if (pos == D) return rem == 0 ? 1 : 0;
        if (!tight && memo[pos][rem] != -1) return memo[pos][rem];
        int limit = tight ? digits[pos] : 9;
        long total = 0;
        for (int dig = 0; dig <= limit; dig++) {
            total += solve(pos + 1, tight && dig == limit, (rem * 10 + dig) % K);
        }
        if (!tight) memo[pos][rem] = total;
        return total;
    }

    static long f(String N, int k) {
        if (N.equals("-1")) return 0;
        D = N.length();
        K = k;
        digits = new int[D];
        for (int i = 0; i < D; i++) digits[i] = N.charAt(i) - '0';
        memo = new long[D][K];
        for (long[] row : memo) java.util.Arrays.fill(row, -1);
        return solve(0, true, 0);
    }

    static String decString(String s) {
        char[] b = s.toCharArray();
        int i = b.length - 1;
        while (i >= 0 && b[i] == '0') { b[i] = '9'; i--; }
        b[i]--;
        int k = 0;
        while (k < b.length - 1 && b[k] == '0') k++;
        return new String(b, k, b.length - k);
    }

    public static void main(String[] args) {
        String L = "10", R = "25";
        int k = 3;
        String lowered = L.equals("0") ? "-1" : decString(L);
        System.out.println("multiples of 3 in [10,25]: " + (f(R, k) - f(lowered, k))); // 5
    }
}
```

### Count divisible-by-`K` in `[L, R]` — Python

```python
from functools import lru_cache


def f(N: str, K: int) -> int:
    if N == "-1":
        return 0
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos: int, tight: bool, rem: int) -> int:
        if pos == D:
            return 1 if rem == 0 else 0
        limit = digits[pos] if tight else 9
        total = 0
        for dig in range(limit + 1):
            total += solve(pos + 1, tight and dig == limit, (rem * 10 + dig) % K)
        return total

    res = solve(0, True, 0)
    solve.cache_clear()
    return res


def dec_string(s: str) -> str:
    b = list(s)
    i = len(b) - 1
    while i >= 0 and b[i] == "0":
        b[i] = "9"
        i -= 1
    b[i] = str(int(b[i]) - 1)
    return "".join(b).lstrip("0") or "0"


def count_divisible_range(L: str, R: str, K: int) -> int:
    lowered = "-1" if L == "0" else dec_string(L)
    return f(R, K) - f(lowered, K)


if __name__ == "__main__":
    print(count_divisible_range("10", "25", 3))  # 5: 12,15,18,21,24
```

### No two equal adjacent digits (started + last) — Python

```python
from functools import lru_cache


def count_no_adjacent_equal(N: str) -> int:
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos: int, tight: bool, started: bool, last: int) -> int:
        if pos == D:
            return 1  # every fully built number that survived the constraint is valid
        limit = digits[pos] if tight else 9
        total = 0
        for dig in range(limit + 1):
            if started and dig == last:
                continue  # adjacent equal forbidden
            nstarted = started or dig != 0
            nlast = dig if nstarted else -1
            total += solve(pos + 1, tight and dig == limit, nstarted, nlast)
        return total

    res = solve(0, True, False, -1)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    print(count_no_adjacent_equal("100"))  # numbers in [0,100] with no two equal adjacent digits
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Tight and free share a cache slot | Key omits `tight`; counts silently wrong. | Either key on `tight` or skip caching when tight. |
| `L − 1` on a string mishandled | Borrow logic wrong → wrong lower bound. | Use a tested `decString`; handle all-zeros borrow. |
| `L = 0` calls DP with `"-1"` | DP indexes `N[pos]` on a bad string. | Treat `f(-1) = 0` before recursing. |
| Leading zeros counted as real | Adjacency / digit-count / mask corrupted. | Gate the accumulator update on `started`. |
| Stale cache across `f(R)` and `f(L−1)` | Python `lru_cache` shared between bounds. | `cache_clear()` per call, or build memo per `N`. |
| Accumulator out of declared range | `rem` or `sum` overflows table dimension. | Size table to `K` / `9D+1`; prune impossible states. |
| `0` wrongly included/excluded | `isValid` ignores `started`. | Decide `0`'s validity explicitly and encode it. |

---

## Performance Analysis

| Accumulator | `M` (states) | Cost `O(D · M · base)` for `D=18` | Notes |
|-------------|--------------|-----------------------------------|-------|
| Forbidden digits (none) | `O(1)` | ~18 × 2 × 10 ≈ 360 | `started` doubles it |
| Remainder mod `K` (`K=1000`) | `1000` | ~18 × 1000 × 10 ≈ 180 000 | scales with `K` |
| Digit sum (`≤ 9D`) | `~162` | ~18 × 162 × 10 ≈ 29 000 | tiny |
| Last digit (adjacency) | `~11` | ~18 × 11 × 2 × 10 ≈ 4 000 | `started`×`last` |
| Digit bitmask | `1024` | ~18 × 1024 × 2 × 10 ≈ 370 000 | heaviest common one |

The dominant cost is `M × base` per position, repeated over `D` positions. The single biggest performance lever is **shrinking the accumulator range**: prune impossible accumulators (`sum > S`), use `mod K` instead of the raw value, and drop the `started` dimension when the predicate does not need it.

```python
import time

def benchmark(N_str, K):
    start = time.perf_counter()
    _ = f(N_str, K)
    return time.perf_counter() - start

# Typical: N = "1" + "0"*18 (10^18), K = 1000 -> well under 0.1s in CPython.
```

Because the cost depends on the *digit count* and the accumulator range, not on `N`, a 60-digit `N` (string input) costs barely more than an 18-digit one.

---

## Best Practices

- **Decide the four state fields explicitly** for each problem: which of `started` / accumulator does the predicate actually need? Drop the unused ones.
- **Skip caching tight states** (`if not tight`) — the smallest correct cache and the idiomatic form.
- **Gate accumulator updates on `started`** whenever leading zeros could be mistaken for real digits.
- **Implement `f(X)` once**, build `[L, R]` as `f(R) − f(L−1)`, and reuse a tested `decString` for the lower bound.
- **Always test against the brute-force oracle** on every `N` and parameter up to a few thousand.
- **Prune impossible accumulators early** to keep `M` (and the table) small.
- **Treat `N` as a string everywhere**; never let it pass through an `int`.

---

## A Worked Leading-Zero Failure

Nothing cements the `started` flag like watching it break. Take **"count integers in `[0, 100]` with no two equal adjacent digits"** and a *buggy* version that omits `started` (treating leading zeros as real digits).

The bound is `N = "100"`, so we build 3-wide candidates. Consider the number `5`, padded as `005`:

```
buggy run (no started): digits are 0, 0, 5
    position 0: place 0
    position 1: place 0  → adjacent to previous 0 → WRONGLY rejected ("00")
    the number 5 is never counted!
```

The two padding zeros look like an adjacent-equal pair, so every single-digit number `1..9` (padded `00d`) is wrongly rejected, and so is every two-digit number starting after a padded zero. The count comes out far too low.

```
correct run (with started):
    position 0: place 0 → started stays false, last = "none" (-1)
    position 1: place 0 → started still false (no real digit yet), last still -1
                           → NOT compared, NOT rejected
    position 2: place 5 → started becomes true, last = 5, number = 5  ✓ counted
```

Run both against the brute-force oracle:

```python
def brute_no_adj(N):
    def ok(x):
        s = str(x)
        return all(s[i] != s[i+1] for i in range(len(s)-1))
    return sum(1 for x in range(N+1) if ok(x))

# brute_no_adj(100) = 91  (only 11, 22, ..., 99 are rejected: 9 numbers; 101 numbers in [0,100] minus... )
# the buggy DP returns far less; the correct DP returns 91.
```

The lesson, made concrete: for **any** predicate whose per-digit rule looks at *previous real digits* (adjacency, monotonicity) or *counts/sets of real digits* (digit-frequency, masks), the `started` flag is not optional — it is the only thing that prevents padding zeros from being mistaken for the number's actual digits. The digit-*sum* predicate is the lone common exception, because adding a padding zero changes nothing.

### Debugging checklist when a Digit DP is wrong

When your count disagrees with the oracle, check in this order — these are ranked by how often they are the culprit:

1. **Are tight states being cached?** Add the `if not tight` guard around both the read and the write. (Over-counts.)
2. **Is `nextTight` exactly `tight && dig == limit`?** A common typo is `dig == 9` or dropping the `&& tight`. (Corrupts the bound.)
3. **Is `started` handled?** If the predicate looks at previous real digits, padding zeros must not participate. (Under- or over-counts depending on the rule.)
4. **Is the range `f(R) − f(L−1)`, not `f(R) − f(L)`?** And is `f(−1) = 0`? (Off-by-one at the endpoint.)
5. **Is `L − 1` computed correctly on the string?** Borrow across trailing zeros, strip leading zeros. (Wrong lower bound.)
6. **Is the memo cleared/rebuilt between the two `f` calls?** (Stale counts.)

Fix the smallest failing `N` first — the bug is almost always visible at `N ≤ 30`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The bound `N`'s digits with the tight branch (capped at `N[pos]`) drawn distinctly from the free branch.
> - The accumulator (digit sum) and the `started` flag updating as each digit is chosen.
> - How counts from the leaves bubble up and how free subtrees reuse memoized results.

---

## Summary

Middle-level Digit DP is about getting the *edges* right and the *family* general. The leading-zero (`started`) flag is mandatory for any constraint where padding zeros could masquerade as real digits — adjacency, monotonicity, digit-frequency, masks — and optional only for the digit *sum*. Ranges decompose as `f(R) − f(L−1)`, and because `L` and `R` can be 100-digit strings, the only big-number arithmetic you need is a careful string decrement. The accumulator is just "whatever finite state the predicate needs": a remainder mod `K` for divisibility (`rem' = (rem·base + dig) mod K`), a bitmask for digit-set constraints, the last digit for adjacency/monotonicity, or a running count when you sum a quantity over the range. And the tight states stay out of the cache — they are unique per position, so caching them gains nothing and, if keyed carelessly, silently corrupts the free-state counts. Master the four-field skeleton with these accumulators and the whole digit-constraint counting family collapses into one well-tested function.
