# Bitmask DP (DP over Subsets) — Middle Level

> **Focus:** The `O(3^n)` submask enumeration (DP over *sub*sets, not just subsets), the assignment problem as a one-dimensional `dp[mask]`, counting Hamiltonian paths by summing instead of minimising, the full toolkit of bit tricks (lowbit, popcount, iterating set bits), and how to choose between these formulations.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Submask Enumeration: the O(3^n) Sum](#submask-enumeration-the-o3n-sum)
4. [The Assignment Problem](#the-assignment-problem)
5. [Counting Hamiltonian Paths](#counting-hamiltonian-paths)
6. [Bit Tricks Reference](#bit-tricks-reference)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was: a subset is an integer, and `dp[mask][last]` solves TSP in `O(2^n · n^2)`. At middle level you start asking the questions that decide *which* bitmask formulation a problem needs and how fast it really is:

- Some problems require iterating not just over all masks, but over all **submasks of each mask** — the famous `O(3^n)` enumeration. Why `3^n` and not `4^n`?
- The **assignment problem** (match `n` workers to `n` jobs at minimum cost) only needs a *one-dimensional* `dp[mask]` — the second coordinate is implied. Why?
- **Counting** Hamiltonian paths is the same DP as Held-Karp but you replace `min` with `+`. What changes and what doesn't?
- What is the complete bag of **bit tricks** — `lowbit`, `popcount`, iterating set bits, iterating submasks — and which to reach for when?

These distinctions separate "I memorised Held-Karp" from "I can pick the right subset DP and predict its complexity before writing a line."

---

## Deeper Concepts

### Two flavours of subset iteration

There are two completely different loops, and confusing them is a common source of wrong complexity estimates.

1. **Iterate all subsets** of `n` items: `for mask in 0 .. 2^n − 1`. This is `O(2^n)` masks total.
2. **Iterate all submasks of one fixed mask**: given `mask`, visit every `sub` whose bits are a subset of `mask`'s bits. A mask with `b` set bits has `2^b` submasks.

If you do submask enumeration *for every* mask, the total work is `Σ_mask 2^{popcount(mask)} = 3^n` (derived below). That `O(3^n)` is the signature of set-partition / set-cover style DPs.

### Push vs pull transitions

- **Push (forward):** from a computed `dp[mask]`, update larger states `dp[mask | (1<<i)]`. Natural for Held-Karp.
- **Pull (backward):** to compute `dp[mask]`, read from smaller states — e.g. `dp[mask without lowbit]` for assignment, or over all submasks for partitioning.

Both are valid as long as the iteration order respects dependencies. Masks are processed in increasing numeric order; adding a bit increases the integer, removing a bit decreases it, so "smaller masks first" always works.

### The state-design lever

The single most important middle-level skill is choosing the *minimal* state. Held-Karp needs `dp[mask][last]` because the next cost depends on where you are. The assignment problem needs only `dp[mask]` because the "row index" is determined by how many bits are already set (`popcount(mask)`) — you assign workers in a fixed order, so the current worker is implied. Removing a dimension turns `O(2^n · n^2)` into `O(2^n · n)` — a factor-`n` win and an `n×` smaller table.

---

## Submask Enumeration: the O(3^n) Sum

### The submask iteration idiom

To visit every submask `sub` of a fixed `mask` (including `mask` itself and `0`), use this classic loop:

```
sub = mask
while sub > 0:
    ... use sub ...
    sub = (sub - 1) & mask
# then handle sub = 0 separately if you need the empty submask
```

The trick: `sub - 1` borrows through the low zero bits, and `& mask` snaps the result back to a valid submask of `mask`. This enumerates submasks in *decreasing* order, each exactly once, with no skips.

### Why the total is `3^n`

Iterating submasks of *every* mask costs:

```
Σ over all masks of (number of submasks of that mask)
  = Σ_{mask} 2^{popcount(mask)}
```

Group masks by popcount. There are `C(n, b)` masks with exactly `b` bits set, each having `2^b` submasks:

```
Σ_{b=0}^{n} C(n, b) · 2^b = (1 + 2)^n = 3^n      (binomial theorem)
```

The combinatorial intuition is cleaner: for each of the `n` items, in the (mask, submask) pair it is in exactly one of **three** states — *not in mask*, *in mask but not in submask*, or *in both*. Three independent choices per item gives `3^n` total (mask, submask) pairs. That is the entire derivation.

### Where it is used

Submask enumeration appears whenever a state is built by **splitting a set into two parts**: partition a set into groups, set-cover where each "item" covers a chosen subset, or "best way to partition `mask` into one valid group plus the rest." The recurrence typically reads:

```
dp[mask] = best over submask sub of mask of  combine(value(sub), dp[mask ^ sub])
```

— and the cost of evaluating all such `dp[mask]` is exactly `O(3^n)`.

---

## The Assignment Problem

**Problem.** `n` workers and `n` jobs; assigning worker `i` to job `j` costs `cost[i][j]`. Assign every worker to exactly one distinct job at minimum total cost. (This is minimum-cost perfect matching on a small bipartite graph.)

**Bitmask DP.** Let `dp[mask]` = the minimum cost to assign the first `popcount(mask)` workers to exactly the set of jobs in `mask`. The clever part: the worker index is *not* a separate dimension — it equals `popcount(mask)`, because we assign workers in order `0, 1, 2, …`. So:

```
i = popcount(mask)                 // the next worker to place
dp[mask] = min over job j in mask of
             dp[mask without j] + cost[i-1][j]
```

with `dp[0] = 0`. The answer is `dp[(1<<n) - 1]`.

**Complexity.** `2^n` masks, each scanning up to `n` jobs → **`O(2^n · n)`**, with `O(2^n)` space. This beats listing all `n!` assignments and is simpler than (though asymptotically worse for large `n` than) the Hungarian algorithm. For `n ≤ 20` the bitmask DP is the easy, fast choice.

**Why the dimension collapses.** Because we always assign worker `popcount(mask)` next, there is never ambiguity about *which* worker the current step concerns. Contrast TSP, where after visiting a set of cities you could be at *any* of them — hence the extra `[last]` dimension. State design is the whole game.

---

## Counting Hamiltonian Paths

**Problem.** Count the number of paths that visit every vertex exactly once (in a directed or undirected graph), possibly between fixed endpoints.

**Bitmask DP.** Identical structure to Held-Karp, but `dp[mask][last]` now holds a **count**, and the recurrence **sums** instead of taking a min:

```
dp[mask][last] = Σ over prev in (mask without last), with edge prev→last, of
                   dp[mask without last][prev]
```

Base case: `dp[1<<s][s] = 1` for each allowed start `s` (or just the fixed start). The number of Hamiltonian paths ending anywhere is `Σ_last dp[full][last]`; for a *cycle* (Hamiltonian cycle count) restrict to paths that can return to the start and divide by symmetry as appropriate.

**What changes vs TSP:** the operator (`+` instead of `min`), the base value (`1` instead of `0`), and that you usually want the *sum over all `last`*, not the min. The complexity is the same `O(2^n · n^2)`. Because counts can be huge, take them mod a prime if the problem asks.

**Connection to inclusion-exclusion.** Counting Hamiltonian paths also has a clever `O(2^n · n)` inclusion-exclusion formula (Karp's / Ryser-style), but the subset DP above is the most natural starting point and is covered in depth in [`professional.md`](./professional.md).

---

## Bit Tricks Reference

| Trick | Expression | Use |
|-------|-----------|-----|
| Lowest set bit (isolated) | `mask & (-mask)` | Peel off one element; the value is a power of two. |
| Index of lowest set bit | `trailing_zeros(mask)` | Which item the lowbit corresponds to. |
| Clear lowest set bit | `mask & (mask - 1)` | Remove one element; loop until `0` to visit all set bits. |
| Population count | `popcount(mask)` | Size of the subset (number of items). |
| Is `sub` a submask of `mask`? | `(sub & mask) == sub` | Subset test. |
| Iterate set bits | `while mask: i = lowbit_index; mask &= mask-1` | Visit each member once. |
| Iterate submasks | `sub = mask; while sub: ...; sub=(sub-1)&mask` | Visit every subset of `mask`. |
| Complement within `n` bits | `mask ^ ((1<<n) - 1)` | The items *not* in `mask`. |

**Library functions:** Go `bits.OnesCount`, `bits.TrailingZeros`; Java `Integer.bitCount`, `Integer.numberOfTrailingZeros`; Python `int.bit_count()` (3.10+) or `bin(x).count("1")`, and `(x & -x).bit_length() - 1` for the low-bit index.

---

## Comparison with Alternatives

### Subset DP vs other approaches

| Problem | Bitmask DP | Polynomial alternative | When bitmask wins |
|---------|-----------|------------------------|-------------------|
| TSP / shortest Hamiltonian | `O(2^n · n^2)` | none (NP-hard) | always, for `n ≤ ~20` |
| Assignment / min-cost matching | `O(2^n · n)` | Hungarian `O(n^3)` | small `n` (≤ ~15), simpler code |
| Count Hamiltonian paths | `O(2^n · n^2)` | inclusion-exclusion `O(2^n · n)` | both exponential; DP is clearer |
| Set cover (min subsets) | `O(2^n · m)` over universe | greedy approximation | when exact optimum needed, small universe |
| Partition into `k` groups | `O(3^n)` submask DP | none general | small `n` (≤ ~18) |

### The complexity ladder

| Loop shape | Total work | Typical use |
|------------|-----------|-------------|
| `for mask` | `O(2^n)` | precompute per-mask values (e.g. group cost) |
| `for mask, for bit` | `O(2^n · n)` | assignment, SOS-style DP |
| `for mask, for last, for prev` | `O(2^n · n^2)` | Held-Karp TSP / Hamiltonian |
| `for mask, for submask` | `O(3^n)` | partition / set-cover DP |

A practical sanity check: `3^n` grows *much* faster than `2^n`. `3^18 ≈ 4 × 10^8` (feasible), `3^20 ≈ 3.5 × 10^9` (borderline), `3^21+` is too slow. `2^n · n^2` is feasible to about `n = 20` as well. Know which loop you're writing — it sets your ceiling.

---

## Code Examples

### Assignment problem — `dp[mask]`, O(2^n · n)

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

const INF = 1 << 30

// assign returns the minimum total cost of assigning worker i (= popcount so far)
// to a distinct job, for all n workers. cost is n x n.
func assign(cost [][]int) int {
	n := len(cost)
	full := (1 << n) - 1
	dp := make([]int, 1<<n)
	for i := range dp {
		dp[i] = INF
	}
	dp[0] = 0
	for mask := 0; mask <= full; mask++ {
		if dp[mask] == INF {
			continue
		}
		i := bits.OnesCount(uint(mask)) // next worker to place
		if i >= n {
			continue
		}
		for j := 0; j < n; j++ {
			if mask&(1<<j) != 0 {
				continue // job j already taken
			}
			nm := mask | (1 << j)
			if c := dp[mask] + cost[i][j]; c < dp[nm] {
				dp[nm] = c
			}
		}
	}
	return dp[full]
}

func main() {
	cost := [][]int{
		{9, 2, 7},
		{6, 4, 3},
		{5, 8, 1},
	}
	fmt.Println("min assignment cost =", assign(cost)) // 2 + 3 + ... best matching
}
```

#### Java

```java
public class Assignment {
    static final int INF = 1 << 30;

    static int assign(int[][] cost) {
        int n = cost.length;
        int full = (1 << n) - 1;
        int[] dp = new int[1 << n];
        java.util.Arrays.fill(dp, INF);
        dp[0] = 0;
        for (int mask = 0; mask <= full; mask++) {
            if (dp[mask] == INF) continue;
            int i = Integer.bitCount(mask); // next worker
            if (i >= n) continue;
            for (int j = 0; j < n; j++) {
                if ((mask & (1 << j)) != 0) continue;
                int nm = mask | (1 << j);
                dp[nm] = Math.min(dp[nm], dp[mask] + cost[i][j]);
            }
        }
        return dp[full];
    }

    public static void main(String[] args) {
        int[][] cost = {
            {9, 2, 7},
            {6, 4, 3},
            {5, 8, 1},
        };
        System.out.println("min assignment cost = " + assign(cost));
    }
}
```

#### Python

```python
INF = float("inf")


def assign(cost):
    n = len(cost)
    full = (1 << n) - 1
    dp = [INF] * (1 << n)
    dp[0] = 0
    for mask in range(full + 1):
        if dp[mask] == INF:
            continue
        i = bin(mask).count("1")  # next worker to place
        if i >= n:
            continue
        for j in range(n):
            if mask & (1 << j):
                continue
            nm = mask | (1 << j)
            c = dp[mask] + cost[i][j]
            if c < dp[nm]:
                dp[nm] = c
    return dp[full]


if __name__ == "__main__":
    cost = [
        [9, 2, 7],
        [6, 4, 3],
        [5, 8, 1],
    ]
    print("min assignment cost =", assign(cost))
```

### Submask enumeration — partition cost into valid groups, O(3^n)

This computes, for example, the minimum number of "good" groups needed to partition all `n` items, where `good[sub]` says whether subset `sub` forms a valid group.

#### Python

```python
INF = float("inf")


def min_groups(n, good):
    """good[sub] = True if the subset `sub` is a valid single group.
    Returns the fewest valid groups partitioning all n items."""
    full = (1 << n) - 1
    dp = [INF] * (1 << n)
    dp[0] = 0
    for mask in range(1, full + 1):
        sub = mask
        while sub > 0:
            if good[sub] and dp[mask ^ sub] + 1 < dp[mask]:
                dp[mask] = dp[mask ^ sub] + 1
            sub = (sub - 1) & mask
    return dp[full]


if __name__ == "__main__":
    n = 3
    # Every singleton and the pair {0,1} are valid groups; nothing else.
    good = [False] * (1 << n)
    for i in range(n):
        good[1 << i] = True
    good[0b011] = True
    print(min_groups(n, good))  # {0,1} + {2} => 2 groups
```

#### Go

```go
package main

import "fmt"

const INF = 1 << 30

func minGroups(n int, good []bool) int {
	full := (1 << n) - 1
	dp := make([]int, 1<<n)
	for i := range dp {
		dp[i] = INF
	}
	dp[0] = 0
	for mask := 1; mask <= full; mask++ {
		for sub := mask; sub > 0; sub = (sub - 1) & mask {
			if good[sub] && dp[mask^sub]+1 < dp[mask] {
				dp[mask] = dp[mask^sub] + 1
			}
		}
	}
	return dp[full]
}

func main() {
	n := 3
	good := make([]bool, 1<<n)
	for i := 0; i < n; i++ {
		good[1<<i] = true
	}
	good[0b011] = true
	fmt.Println(minGroups(n, good)) // 2
}
```

#### Java

```java
public class MinGroups {
    static final int INF = 1 << 30;

    static int minGroups(int n, boolean[] good) {
        int full = (1 << n) - 1;
        int[] dp = new int[1 << n];
        java.util.Arrays.fill(dp, INF);
        dp[0] = 0;
        for (int mask = 1; mask <= full; mask++) {
            for (int sub = mask; sub > 0; sub = (sub - 1) & mask) {
                if (good[sub] && dp[mask ^ sub] + 1 < dp[mask]) {
                    dp[mask] = dp[mask ^ sub] + 1;
                }
            }
        }
        return dp[full];
    }

    public static void main(String[] args) {
        int n = 3;
        boolean[] good = new boolean[1 << n];
        for (int i = 0; i < n; i++) good[1 << i] = true;
        good[0b011] = true;
        System.out.println(minGroups(n, good)); // 2
    }
}
```

### Counting Hamiltonian paths — sum instead of min

#### Python

```python
MOD = 1_000_000_007


def count_hamiltonian_paths(adj):
    """adj[i][j] = 1 if directed edge i->j. Count Ham. paths over all start/end."""
    n = len(adj)
    full = (1 << n) - 1
    # dp[mask][last] = number of paths visiting exactly `mask`, ending at `last`
    dp = [[0] * n for _ in range(1 << n)]
    for s in range(n):
        dp[1 << s][s] = 1  # a path of one vertex
    for mask in range(1 << n):
        for last in range(n):
            cur = dp[mask][last]
            if cur == 0 or not (mask & (1 << last)):
                continue
            for nxt in range(n):
                if (mask & (1 << nxt)) or not adj[last][nxt]:
                    continue
                nm = mask | (1 << nxt)
                dp[nm][nxt] = (dp[nm][nxt] + cur) % MOD
    return sum(dp[full][last] for last in range(n)) % MOD


if __name__ == "__main__":
    # complete graph on 3 vertices: 3! = 6 directed Hamiltonian paths
    adj = [[0, 1, 1], [1, 0, 1], [1, 1, 0]]
    print(count_hamiltonian_paths(adj))  # 6
```

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

func countHamiltonianPaths(adj [][]int) int64 {
	n := len(adj)
	full := (1 << n) - 1
	dp := make([][]int64, 1<<n)
	for m := range dp {
		dp[m] = make([]int64, n)
	}
	for s := 0; s < n; s++ {
		dp[1<<s][s] = 1
	}
	for mask := 0; mask <= full; mask++ {
		for last := 0; last < n; last++ {
			cur := dp[mask][last]
			if cur == 0 || mask&(1<<last) == 0 {
				continue
			}
			for nxt := 0; nxt < n; nxt++ {
				if mask&(1<<nxt) != 0 || adj[last][nxt] == 0 {
					continue
				}
				nm := mask | (1 << nxt)
				dp[nm][nxt] = (dp[nm][nxt] + cur) % MOD
			}
		}
	}
	var total int64
	for last := 0; last < n; last++ {
		total = (total + dp[full][last]) % MOD
	}
	return total
}

func main() {
	adj := [][]int{{0, 1, 1}, {1, 0, 1}, {1, 1, 0}}
	fmt.Println(countHamiltonianPaths(adj)) // 6
}
```

#### Java

```java
public class CountHamPaths {
    static final long MOD = 1_000_000_007L;

    static long count(int[][] adj) {
        int n = adj.length;
        int full = (1 << n) - 1;
        long[][] dp = new long[1 << n][n];
        for (int s = 0; s < n; s++) dp[1 << s][s] = 1;
        for (int mask = 0; mask <= full; mask++) {
            for (int last = 0; last < n; last++) {
                long cur = dp[mask][last];
                if (cur == 0 || (mask & (1 << last)) == 0) continue;
                for (int nxt = 0; nxt < n; nxt++) {
                    if ((mask & (1 << nxt)) != 0 || adj[last][nxt] == 0) continue;
                    int nm = mask | (1 << nxt);
                    dp[nm][nxt] = (dp[nm][nxt] + cur) % MOD;
                }
            }
        }
        long total = 0;
        for (int last = 0; last < n; last++) total = (total + dp[full][last]) % MOD;
        return total;
    }

    public static void main(String[] args) {
        int[][] adj = {{0, 1, 1}, {1, 0, 1}, {1, 1, 0}};
        System.out.println(count(adj)); // 6
    }
}
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Submask loop misses `sub = 0` | `while sub > 0` stops before the empty submask. | Handle `sub = 0` after the loop if the empty set is a valid case. |
| Submask loop visits the same submask twice | Forgot the `& mask` after `sub - 1`. | Always `sub = (sub - 1) & mask`. |
| Wrong worker index in assignment | Used a fixed counter instead of `popcount(mask)`. | The next worker is exactly `popcount(mask)`. |
| Counts overflow when counting paths | Counts grow exponentially. | Reduce mod a prime after each addition. |
| `popcount` mismatch with item index | Confused "how many bits set" with "which bit." | `popcount` = size; `trailing_zeros` = index of low bit. |
| `dp[mask]` read before computed | Iterated masks in the wrong order. | Increasing numeric order; smaller masks (fewer/cleared bits) come first. |

---

## Performance Analysis

| `n` | `2^n` | `2^n · n` (assignment) | `2^n · n^2` (TSP) | `3^n` (submask DP) |
|-----|-------|------------------------|-------------------|--------------------|
| 10 | 1 024 | ~10 K | ~100 K | ~59 K |
| 15 | 32 768 | ~0.5 M | ~7 M | ~14 M |
| 18 | 262 144 | ~4.7 M | ~85 M | ~387 M |
| 20 | 1 048 576 | ~21 M | ~419 M | ~3.5 B |
| 22 | 4 194 304 | ~92 M | ~2 B | ~31 B |

The practical ceilings: assignment (`2^n · n`) reaches `n ≈ 20–22`; TSP (`2^n · n^2`) reaches `n ≈ 18–20`; submask DP (`3^n`) reaches `n ≈ 18–19`. Beyond these, memory (`2^n`) usually fails before time does.

```python
import time


def bench_tsp(n, seed=1):
    import random
    r = random.Random(seed)
    dist = [[r.randint(1, 100) for _ in range(n)] for _ in range(n)]
    start = time.perf_counter()
    # ... run Held-Karp ...
    return time.perf_counter() - start

# Typical: n=18 Held-Karp finishes in a few seconds in CPython;
# in Go/Java it is well under a second.
```

The biggest constant-factor wins: a **flat 1D `dp` array**, skipping `INF`/zero states early, the hardware `popcount`, and (for the submask DP) ordering work so the inner submask loop touches contiguous memory.

---

## Best Practices

- **Pick the minimal state.** If the "current position" is implied (assignment), drop the second dimension and save a factor of `n`.
- **Match the operator to the goal:** `min` for shortest/cheapest, `+` (mod `p`) for counting, `OR` for feasibility.
- **Use the canonical submask idiom** `sub = (sub - 1) & mask` — it is correct and `O(3^n)` overall; do not reinvent it.
- **Reach for library popcount / trailing-zeros** rather than hand loops; they are one instruction.
- **Reduce counts mod a prime** the moment they can exceed your integer type.
- **Always test against a brute-force oracle** (permutations for TSP/Hamiltonian, all matchings for assignment) on small `n`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level perspective the animation reinforces:
> - Masks fill in **popcount order**, so you can watch 1-bit states feed 2-bit states feed 3-bit states.
> - Each transition adds exactly one bit (`mask | (1<<next)`), the same move whether you `min` (TSP) or `+` (counting).
> - The bits of each mask are drawn explicitly, making the "subset = integer" encoding concrete.

---

## Summary

Middle-level bitmask DP is about choosing the right formulation. There are two distinct iterations: over **all masks** (`O(2^n)`) and over **all submasks of each mask** (`O(3^n)`, because each item is independently *out / in-mask-only / in-both*). The **assignment problem** collapses to a one-dimensional `dp[mask]` in `O(2^n · n)` because the current worker equals `popcount(mask)`. **Counting Hamiltonian paths** is Held-Karp with `+` replacing `min` (take it mod a prime). **Partition / set-cover** DPs use submask enumeration at `O(3^n)`. Master the bit tricks — `lowbit = mask & -mask`, clear-low-bit `mask & (mask-1)`, popcount, the submask idiom — and you can read off a subset DP's complexity from the shape of its loops, and pick the cheapest formulation before writing code.
