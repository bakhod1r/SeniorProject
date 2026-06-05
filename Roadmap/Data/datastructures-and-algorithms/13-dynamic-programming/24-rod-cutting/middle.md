# Rod Cutting (Unbounded DP) — Middle Level

> **Focus:** Top-down memoization vs bottom-up tabulation (same recurrence, different mechanics), clean reconstruction of the cut list, the **cost-per-cut** variant (a fee for each saw cut), the **bounded** variant (each length usable a limited number of times), and how rod cutting is literally unbounded knapsack (`02`) and a cousin of coin change (`19`).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Top-Down Memoization vs Bottom-Up Tabulation](#top-down-memoization-vs-bottom-up-tabulation)
4. [Reconstruction of the Cut List](#reconstruction-of-the-cut-list)
5. [The Cost-Per-Cut Variant](#the-cost-per-cut-variant)
6. [The Bounded Variant](#the-bounded-variant)
7. [Relation to Unbounded Knapsack and Coin Change](#relation-to-unbounded-knapsack-and-coin-change)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was a single recurrence: `dp[len] = max_c (price[c] + dp[len - c])`, base `dp[0] = 0`, filled in `O(n^2)`. At middle level you start asking the engineering questions that decide whether your solution is *correct under variation* and *fast enough*:

- Should I write this **top-down** (recursion + memo) or **bottom-up** (iterative table)? When does each win?
- How do I cleanly **reconstruct** the cuts, and how do I verify the reconstruction is consistent with the value?
- What changes when each saw cut **costs money** (a kerf or labor fee)? The naive recurrence overcounts profit.
- What changes when each piece length can be used **at most once** (or a fixed number of times)? That breaks the unbounded assumption and adds a dimension.
- Why is rod cutting *exactly* **unbounded knapsack** (`02`), and how does that lens transfer to **coin change** (`19`)?

These are the questions that separate "I memorized the recurrence" from "I can adapt it to the problem in front of me."

A guiding principle for everything below: the *recurrence* is fixed, but the *objective* and the *constraints* are dials. Turning the objective dial changes `max` to `min` or `Σ` (rod cutting vs coin change). Turning the constraint dials adds costs (cost-per-cut), material loss (kerf), or supply caps (bounded). The skill is recognizing which dial a problem turns and adjusting exactly that part of the recurrence — not rewriting it from scratch each time.

---

## Deeper Concepts

### The recurrence, restated with first-cut decomposition

Let `dp[len]` be the maximum revenue for a rod of length `len`. Every nonempty cutting plan has a *leftmost piece* of some length `c`, leaving a rod of length `len - c`:

```
dp[0]   = 0
dp[len] = max over c in 1..len of ( price[c] + dp[len - c] )
```

The decomposition over the *first* piece is what makes the subproblems strictly smaller and non-overlapping in their decision: we never double-count an arrangement because each arrangement has exactly one first piece. The unbounded character is visible in the index `dp[len - c]` — the same `dp` array, so the remainder may cut another length-`c` piece. (Formal proof of optimal substructure: [`professional.md`](./professional.md).)

### Two equivalent computations

The recurrence does not dictate *how* you evaluate it. Two standard mechanics:

1. **Top-down (memoization).** Write the recurrence directly as a recursive function `solve(len)`; cache each result so it is computed once. Natural and close to the math; risks deep recursion.
2. **Bottom-up (tabulation).** Fill `dp[0..n]` iteratively so every dependency `dp[len - c]` is ready. No recursion; cache-friendly; the production default.

Both are `O(n^2)` time and `O(n)` space and produce identical answers. The choice is about ergonomics, stack safety, and constant factors — covered next.

---

## Top-Down Memoization vs Bottom-Up Tabulation

| Aspect | Top-down (memoized recursion) | Bottom-up (tabulation) |
|--------|-------------------------------|------------------------|
| Shape | `solve(len)` calls `solve(len - c)`, cached | `for len = 1..n: for c = 1..len` |
| Order | Lazy — only the subproblems actually reached | Eager — all `dp[0..n]` |
| Stack | Recursion depth up to `O(n)` (risk of overflow) | None |
| Constant factor | Function-call + memo-lookup overhead | Tight loops, cache-friendly |
| When better | Sparse subproblem space; quick to write; matches the math | Dense space (rod cutting reaches *all* `dp[0..n]`); large `n`; production |
| Reconstruction | Store `choice[len]` on the winning branch | Store `choice[len]` in the inner loop |

For rod cutting specifically, the bottom-up version reaches *every* `dp[0..n]` anyway (there is no sparsity to exploit), so tabulation is the better default: no recursion overhead, no stack risk, predictable memory. Memoization shines when subproblems are sparse or when the recurrence is easier to reason about recursively — neither strongly applies here, but knowing both is essential because other DPs do benefit from memo's laziness.

### Subtlety: memoization still needs a correct base and a sentinel

A memo table needs a "not computed yet" sentinel distinct from a legitimate result. For rod cutting all revenues are `>= 0`, so a sentinel like `-1` (or `None`) works. Do not initialize the memo to `0` — `0` is a valid answer (`dp[0]`), and you would never recompute the others.

### Worked trace: same answer, two orders

For `price = [_, 1, 5, 8, 9]`, `n = 4`, both mechanics reach `dp[4] = 10`:

```
Bottom-up (eager, increasing len):
  dp[0]=0 -> dp[1]=1 -> dp[2]=5 -> dp[3]=8 -> dp[4]=10        (each ready before use)

Top-down (lazy, call order from solve(4)):
  solve(4) needs solve(3),solve(2),solve(1),solve(0)
  solve(3) needs solve(2),solve(1),solve(0)   <- solve(2) cached after first eval
  ...
  every solve(r) computed once, then served from the memo
```

The bottom-up order is exactly a topological order of the dependency `dp[len] -> dp[len - c]`; top-down discovers that order implicitly via recursion and the memo. Because rod cutting's dependencies form a simple chain (every smaller length is needed), the two visit the *same* set of subproblems — confirming there is no laziness to exploit, so tabulation's lower constant factor wins.

---

## Reconstruction of the Cut List

Computing `dp[n]` is half the job; a real consumer wants the *pieces*. The standard technique records, for each length, the **first cut** that achieved the optimum:

```
in the inner loop, when (price[c] + dp[len - c]) beats the best so far:
    best = price[c] + dp[len - c]
    choice[len] = c
```

Then walk backward from `n`:

```
pieces = []
len = n
while len > 0:
    pieces.append(choice[len])
    len -= choice[len]
```

**Verification invariant.** After reconstruction, assert two things: (1) the pieces sum to `n`, and (2) their prices sum to `dp[n]`. If either fails, the `choice[]` recording is buggy (often an off-by-one or a `>` vs `>=` inconsistency). This pair of checks catches almost every reconstruction error.

**Ties.** Multiple first cuts can tie for the best. Using `>` keeps the *first* winning `c`; using `>=` keeps the *last*. Both are optimal cut lists, but pick one convention and stick to it so outputs are deterministic and tests are stable.

---

## The Cost-Per-Cut Variant

Real saws lose material and labor to each cut. Suppose each *saw cut* costs a fixed fee `cutCost`. Selling the rod whole makes **zero** cuts; splitting into `m` pieces makes `m - 1` cuts. We want to maximize **revenue minus total cut cost**.

The clean way to model "number of cuts" in the first-cut recurrence: cutting off a first piece of length `c < len` is *one* cut (separating the first piece from the remainder); taking the whole rod (`c = len`) is *zero* cuts. So:

```
dp[0]   = 0
dp[len] = max over c in 1..len of:
            price[c] + dp[len - c]  - (cutCost if c < len else 0)
```

The term `- cutCost` is charged exactly when we actually sever a remainder (`c < len`). Selling whole (`c = len`, remainder length 0) incurs no cut. This correctly accounts for the `m - 1` cuts of an `m`-piece plan, because each split in the recursive unfolding contributes one `cutCost`, and the final whole-piece base contributes none.

**Why the naive `- cutCost` on every branch is wrong.** If you subtract `cutCost` even when `c = len`, you penalize selling the rod whole as if it required a cut, undercounting its profit and producing wrong decisions when "sell whole" is optimal. The `c < len` guard is the crux.

This variant still fills in `O(n^2)` and reconstructs identically (the `choice[]` array is unchanged in structure). It is a common interview twist precisely because it tests whether you understand *where* a cut happens in the decomposition. (Analyzed formally in [`professional.md`](./professional.md).)

---

## The Bounded Variant

Plain rod cutting is **unbounded**: you may cut as many length-`c` pieces as you like. The **bounded** variant caps usage — e.g., the market buys at most `limit[c]` pieces of length `c`. Now the unbounded recurrence is wrong because it can reuse a length beyond its cap.

Bounding adds a dimension: process piece lengths one at a time (like 0/1 knapsack), tracking how many of each you have used. The cleanest formulation iterates over piece *types*, and for each type allows `0..limit[c]` copies:

```
dp[0..n] = 0
for each piece length c with cap limit[c] and price price[c]:
    new_dp = copy(dp)              # 0 copies of c is the baseline
    for q = 1..limit[c]:           # use q copies of length c
        used_len = q * c
        for len = used_len..n:
            cand = price[c]*q + dp[len - used_len]   # dp WITHOUT type c
            new_dp[len] = max(new_dp[len], cand)
    dp = new_dp
answer = dp[n]
```

This is the **bounded knapsack** structure (a.k.a. multiple knapsack). A subtle point: to forbid reusing a type beyond its cap, the candidate must reference `dp` *before* type `c` was considered (the pre-`c` table), which is why we read from `dp` and write to `new_dp`. Equivalently you can iterate `len` *descending* in a single shared array per fixed quantity, mirroring the 0/1 trick. The complexity becomes `O(n * Σ_c limit[c])` in the simplest form; binary-splitting each bounded type reduces it to `O(n * Σ_c log(limit[c]))` (mentioned in [`senior.md`](./senior.md)).

**Special case — exactly one of each (0/1 rod cutting).** If `limit[c] = 1` for every `c`, each length may be used at most once. This is genuine 0/1 knapsack over lengths, *not* the plain rod-cutting recurrence; using the unbounded loop would wrongly reuse lengths.

**Worked bounded example.** `price = [_, 1, 5, 8, 9]`, `n = 4`, `limit = [_, 0, 1, 0, 0]` (only length-2 pieces, at most one):

```
start dp = [0, -, -, -, -]   (capacity 0 = revenue 0)
process length 2 (price 5, cap 1):
  q=1: used=2; dp[2] = dp[0] + 5 = 5; dp[4] = dp[2_old] ... but dp[2_old] was empty,
       so only dp[2] becomes 5. (cap 1 forbids a second length-2 piece for dp[4].)
final dp[4] = dp[4] stayed at "no exact fill" -> revenue from the one length-2 piece is 5
```

The unbounded recurrence would have allowed `2 + 2 = 10`, but the cap of one length-2 piece limits revenue to `5` (the remaining length-2 segment is unsellable). This is precisely where the unbounded loop gives a *wrong* (too high) answer if misapplied.

---

## Relation to Unbounded Knapsack and Coin Change

Rod cutting is not *like* unbounded knapsack — it **is** unbounded knapsack with a special structure.

### The mapping, in one table

| Rod cutting | Unbounded knapsack |
|-------------|--------------------|
| rod length `n` | capacity `W` |
| piece length `i` | item weight `i` |
| `price[i]` | item value |
| reusable lengths | items reusable |
| optimum fills the rod | (knapsack may leave slack) |

The only real difference is framing: rod cutting *always* fills capacity exactly (because length-1 pieces can absorb any remainder at non-negative price), whereas general unbounded knapsack may leave capacity unused. Mechanically, the code is identical.

### Rod cutting = unbounded knapsack (sibling `02`)

In unbounded knapsack you have items with `weight[i]` and `value[i]`, a capacity `W`, and may use each item any number of times; maximize value with total weight `<= W`. Map:

```
item i           <->  piece of length i
weight[i] = i    <->  the piece's length
value[i]  = price[i]  <->  the piece's price
capacity  W = n  <->  the rod length n
```

Two structural specializations make rod cutting a *special case*: (1) the weights are exactly `1, 2, …, n` (one item per integer length), and (2) the optimum *fills the capacity exactly* (a rod is fully cut — no leftover), because every unit of length can always be sold as length-1 pieces, so there is never a reason to leave capacity unused. The unbounded-knapsack recurrence

```
dp[w] = max over items i with weight[i] <= w of ( value[i] + dp[w - weight[i]] )
```

with the rod mapping becomes exactly `dp[len] = max_c (price[c] + dp[len - c])`. If you can solve one, you can solve the other by relabeling.

### Coin change (sibling `19`) — the same unbounded skeleton, different objective

Coin change uses the identical "reference `dp[amount - coin]`" unbounded shape, but optimizes a *different* quantity:

| Problem | Objective | Recurrence |
|---------|-----------|------------|
| Rod cutting | **maximize** revenue | `dp[len] = max_c (price[c] + dp[len - c])` |
| Coin change (min coins) | **minimize** count | `dp[amt] = min_c (1 + dp[amt - coin_c])` |
| Coin change (count ways) | **count** combinations | `ways[amt] = Σ_c ways[amt - coin_c]` (ordered loops to avoid double-count) |

The unbounded structure — same array, smaller index, item reusable — is shared by all three. The differences are the operator (`max`/`min`/`Σ`) and, for counting combinations, the loop order (iterate coins outermost to count *combinations*, not *permutations*). Recognizing this family means you write the skeleton once and swap the objective. (Counting-flavored note in [`professional.md`](./professional.md).)

---

## Code Examples

### Top-down memoized rod cutting with reconstruction

#### Go

```go
package main

import "fmt"

func rodCutMemo(price []int, n int) (int, []int) {
	memo := make([]int, n+1)
	choice := make([]int, n+1)
	for i := range memo {
		memo[i] = -1 // sentinel: not computed
	}
	var solve func(length int) int
	solve = func(length int) int {
		if length == 0 {
			return 0
		}
		if memo[length] >= 0 {
			return memo[length]
		}
		best := -1 << 62
		for c := 1; c <= length; c++ {
			if v := price[c] + solve(length-c); v > best {
				best = v
				choice[length] = c
			}
		}
		memo[length] = best
		return best
	}
	rev := solve(n)
	pieces := []int{}
	for length := n; length > 0; length -= choice[length] {
		pieces = append(pieces, choice[length])
	}
	return rev, pieces
}

func main() {
	price := []int{0, 1, 5, 8, 9, 10, 17, 17, 20}
	rev, cuts := rodCutMemo(price, 8)
	fmt.Println("revenue:", rev, "cuts:", cuts) // 22 [2 6] (or [6 2]) etc.
}
```

#### Java

```java
import java.util.*;

public class RodCutMemo {
    static int[] memo, choice;
    static int[] price;

    static int solve(int length) {
        if (length == 0) return 0;
        if (memo[length] >= 0) return memo[length];
        int best = Integer.MIN_VALUE;
        for (int c = 1; c <= length; c++) {
            int v = price[c] + solve(length - c);
            if (v > best) { best = v; choice[length] = c; }
        }
        return memo[length] = best;
    }

    public static void main(String[] args) {
        price = new int[]{0, 1, 5, 8, 9, 10, 17, 17, 20};
        int n = 8;
        memo = new int[n + 1];
        choice = new int[n + 1];
        Arrays.fill(memo, -1);
        int rev = solve(n);
        List<Integer> cuts = new ArrayList<>();
        for (int len = n; len > 0; len -= choice[len]) cuts.add(choice[len]);
        System.out.println("revenue: " + rev + " cuts: " + cuts);
    }
}
```

#### Python

```python
import sys
from functools import lru_cache


def rod_cut_memo(price, n):
    choice = [0] * (n + 1)
    sys.setrecursionlimit(10000)

    @lru_cache(maxsize=None)
    def solve(length):
        if length == 0:
            return 0
        best = float("-inf")
        for c in range(1, length + 1):
            v = price[c] + solve(length - c)
            if v > best:
                best = v
                choice[length] = c
        return best

    rev = solve(n)
    pieces, length = [], n
    while length > 0:
        pieces.append(choice[length])
        length -= choice[length]
    return rev, pieces


if __name__ == "__main__":
    price = [0, 1, 5, 8, 9, 10, 17, 17, 20]
    print(rod_cut_memo(price, 8))  # (22, [...])
```

### Cost-per-cut bottom-up

#### Python

```python
def rod_cut_with_cost(price, n, cut_cost):
    """Maximize revenue minus a fixed fee per saw cut.
    Selling whole = 0 cuts; an m-piece plan = m-1 cuts."""
    dp = [0] * (n + 1)
    choice = [0] * (n + 1)
    for length in range(1, n + 1):
        best = float("-inf")
        for c in range(1, length + 1):
            fee = 0 if c == length else cut_cost   # a cut only if a remainder exists
            v = price[c] + dp[length - c] - fee
            if v > best:
                best = v
                choice[length] = c
        dp[length] = best
    return dp[n], choice


if __name__ == "__main__":
    price = [0, 1, 5, 8, 9]
    print(rod_cut_with_cost(price, 4, cut_cost=1)[0])  # cuts now penalized
```

#### Go

```go
package main

import "fmt"

func rodCutWithCost(price []int, n, cutCost int) int {
	dp := make([]int, n+1)
	for length := 1; length <= n; length++ {
		best := -1 << 62
		for c := 1; c <= length; c++ {
			fee := 0
			if c < length {
				fee = cutCost
			}
			if v := price[c] + dp[length-c] - fee; v > best {
				best = v
			}
		}
		dp[length] = best
	}
	return dp[n]
}

func main() {
	price := []int{0, 1, 5, 8, 9}
	fmt.Println(rodCutWithCost(price, 4, 1))
}
```

#### Java

```java
public class RodCutCost {
    static int rodCutWithCost(int[] price, int n, int cutCost) {
        int[] dp = new int[n + 1];
        for (int length = 1; length <= n; length++) {
            int best = Integer.MIN_VALUE;
            for (int c = 1; c <= length; c++) {
                int fee = (c < length) ? cutCost : 0;
                int v = price[c] + dp[length - c] - fee;
                if (v > best) best = v;
            }
            dp[length] = best;
        }
        return dp[n];
    }

    public static void main(String[] args) {
        int[] price = {0, 1, 5, 8, 9};
        System.out.println(rodCutWithCost(price, 4, 1));
    }
}
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Memo initialized to `0` | `0` is a valid answer (`dp[0]`), so other entries are never recomputed. | Use a sentinel like `-1` or `None`. |
| Cut cost charged on whole rod | Penalizing `c = len` undercounts the sell-whole profit. | Charge the fee only when `c < len`. |
| Bounded variant reuses a type | Writing into the same `dp` row lets a type be reused beyond its cap. | Read from the pre-`c` table (`dp`), write to `new_dp`; or iterate `len` descending. |
| Reconstruction loops forever | `choice[len] == 0` for some `len >= 1`. | Ensure every reachable `choice[len]` is set to `>= 1`. |
| Recursion stack overflow | Deep top-down recursion for large `n`. | Raise the recursion limit or switch to bottom-up. |
| Wrong tie behavior | Mixing `>` and `>=` across runs gives non-deterministic cut lists. | Pick one comparison convention. |

---

## Performance Analysis

| Variant | Time | Space | Notes |
|---------|------|-------|-------|
| Plain rod cutting (top-down or bottom-up) | `O(n^2)` | `O(n)` | Two nested loops / one memo over lengths. |
| Cost-per-cut | `O(n^2)` | `O(n)` | Same loops, one extra subtraction. |
| Bounded (naive copies) | `O(n · Σ_c limit[c])` | `O(n)` | Iterate quantities per type. |
| Bounded (binary splitting) | `O(n · Σ_c log limit[c])` | `O(n)` | Group quantities into powers of two. |
| Reconstruction | `O(n)` | `O(n)` | Backward walk of `choice[]`. |

The dominant cost in all plain variants is the `O(n^2)` double loop. For `n = 10,000` that is ~`10^8` simple operations — sub-second in compiled languages, a second or two in CPython. The bottom-up table is the constant-factor winner; memoization adds call overhead but the same asymptotics.

```python
import time

def bench(n):
    price = [0] + [ (i * 7) % 13 + 1 for i in range(1, n + 1) ]
    start = time.perf_counter()
    dp = [0] * (n + 1)
    for length in range(1, n + 1):
        best = 0
        for c in range(1, length + 1):
            v = price[c] + dp[length - c]
            if v > best:
                best = v
        dp[length] = best
    return time.perf_counter() - start

# Typical: n=2000 -> well under a second in CPython for the bottom-up table.
```

---

## Best Practices

- **Default to bottom-up** for rod cutting; it reaches every subproblem anyway, avoids stack risk, and is cache-friendly.
- **Always record `choice[]`** in the same inner loop that computes the value — value and decision belong together.
- **Verify reconstruction** with the two invariants: pieces sum to `n`, prices sum to `dp[n]`.
- **Guard the cut fee with `c < len`** in the cost-per-cut variant — the single most common bug in that twist.
- **Distinguish unbounded vs bounded vs 0/1 up front** — they need different loop structures; the wrong one silently gives wrong answers.
- **Reuse the knapsack lens** — recognizing rod cutting as unbounded knapsack lets you reuse a tested skeleton and transfer to coin change.
- **Use 64-bit revenue** for large `n` and prices to avoid overflow.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The `dp[]` array filling left to right, with each `len` trying every first cut `c`.
> - The candidate `price[c] + dp[len - c]` shown per cut, the maximum kept, and `choice[len]` recorded.
> - The backward reconstruction walk drawing the chosen pieces on a rod.
> - A view that maps the same fill onto the unbounded-knapsack capacity table.

---

## When to Reach for Each Variant

A quick decision guide consolidating the variants above:

| Situation | Recurrence to use | Why |
|-----------|-------------------|-----|
| Reuse allowed, maximize revenue | plain `dp[len]=max_c(price[c]+dp[len-c])` | unbounded; the default |
| Each saw cut costs a fee | subtract fee when `c < len` | charge `m-1` cuts for `m` pieces |
| Saw destroys material | subtract kerf `κ` from the remainder index | model physical loss |
| Each length capped | bounded knapsack (per-type loop) | forbids over-reuse |
| Each length usable once | 0/1 knapsack (descending capacity) | distinct from unbounded |
| Many rods, one sheet | fill `dp[]` once, look up | amortize the fill |

The common error is reflexively applying the plain recurrence to a capped or use-once problem; the result is silently too high because it reuses lengths it should not. Always state reuse semantics before coding.

## Summary

The rod-cutting recurrence `dp[len] = max_c (price[c] + dp[len - c])` can be evaluated **top-down** (memoized recursion — natural, lazy, stack-bound) or **bottom-up** (tabulation — eager, cache-friendly, the production default); both are `O(n^2)` time and `O(n)` space and agree exactly. **Reconstruction** records the winning first cut in `choice[]` and walks it backward in `O(n)`, verified by the invariant that pieces sum to `n` and prices sum to `dp[n]`. The **cost-per-cut** variant subtracts a fee only when a remainder is actually severed (`c < len`), correctly charging `m - 1` cuts for an `m`-piece plan. The **bounded** variant caps each length's usage, which breaks the unbounded reuse and adds a quantity dimension (bounded-knapsack structure). Finally, rod cutting *is* unbounded knapsack (`02`) with weights `1..n` and a capacity that is always filled exactly, and it shares its unbounded skeleton with coin change (`19`) — only the objective (`max`/`min`/`Σ`) differs. Master the two mechanics, reconstruction, and the two variants, and the whole unbounded-DP family opens up.
