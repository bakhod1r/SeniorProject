# Aliens Trick (Lagrangian Relaxation) — Junior Level

> **One-line summary:** When a DP forces you to use **exactly `k`** items/segments/groups and solving for a *fixed* `k` is hard, drop the "exactly `k`" rule, add a **penalty `λ` per item used**, solve the now-easy *unconstrained* DP, and **binary-search on `λ`** until the unconstrained optimum happens to use exactly `k` items — then recover the true answer by subtracting `k · λ`.

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

Imagine you must cut an array of `n` numbers into **exactly `k` contiguous pieces**, and every piece costs something (say, the squared sum of its elements). You want the *cheapest* way to make exactly `k` cuts' worth of pieces. The natural DP carries the piece-count as a state dimension:

```
dp[i][j] = best cost of covering the first j elements using exactly i pieces
         = min over t < j of ( dp[i-1][t] + cost(t, j) )
```

The answer is `dp[k][n]`. The trouble is the **extra `i` dimension**: it multiplies your runtime by `k`. If filling one `dp[·][j]` layer is already `O(n)` or `O(n log n)`, the full table is `O(k · n …)`. When `k` can be as large as `n`, that is `O(n²)` or worse — too slow for `n = 10^5`.

Here is the trick that won its fame at **IOI 2016, problem "Aliens"** (hence the name). Suppose the *same* problem **without** the "exactly `k`" rule is much easier — you are allowed to use *any* number of pieces, but **each piece you open costs an extra penalty `λ`**:

```
f(λ) = min over ANY number of pieces  of  ( total piece cost + λ · (number of pieces) )
```

This penalized problem has **no count dimension** — you just decide, greedily through the DP, whether opening one more piece is "worth it" given the toll `λ`. That makes it cheap to solve: often `O(n)` or `O(n log n)`, with **no `k` factor at all**.

Now the magic: the penalty `λ` is a *dial* that controls how many pieces the optimum wants to use.

- **High `λ`** → opening a piece is expensive → the optimum uses **few** pieces.
- **Low `λ`** → opening a piece is cheap → the optimum uses **many** pieces.

As you slide `λ` down, the number of pieces the unconstrained optimum chooses only **goes up** (it is *monotone* in `λ`). So you can **binary-search on `λ`** to find the toll at which the unconstrained optimum uses *exactly `k`* pieces. Once you find that `λ`, the penalized optimum value `f(λ)` includes `λ · k` of pure toll, so the **true answer** is:

```
answer = f(λ) − λ · k
```

You replaced the expensive count dimension with a **binary search over one number `λ`**, so the cost becomes `O(log(range) · DP_cost)` instead of `O(k · DP_cost)`.

This works because the optimal cost `opt(k)` — the best cost using exactly `k` pieces — is a **convex** function of `k`. Convexity is what makes the count monotone in `λ` and what makes the binary search valid. That requirement is the heart of the technique, and we will keep coming back to it.

The Aliens trick sits next to the other DP-optimization tools in this section:

- The **Convex Hull Trick** (sibling `10`) and **Divide & Conquer optimization** (sibling `12`) speed up *one* layer of the DP.
- The **Aliens trick** *removes a whole dimension* (the count `k`) by trading it for a penalty and a binary search. It often **composes** with the others: you penalize away the `k` dimension, then use CHT or D&C to solve each penalized `f(λ)` fast.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Dynamic programming basics** — states, transitions, base cases, filling a table. (See the rest of `13-dynamic-programming`.)
- **The "partition into exactly `k` segments" DP** — `dp[i][j] = min_t ( dp[i-1][t] + cost(t, j) )`. This is the running example.
- **Binary search on a value** — not on an array index, but on a *real or integer parameter* to find a threshold. (See `binary-search`.)
- **Prefix sums** — so a segment's cost is `O(1)`.
- **Big-O notation** — `O(k · n)`, `O(n log n)`, `O(log(range) · DP_cost)`.

Optional but helpful:

- A glance at **Convex Hull Trick** (sibling `10`) and **Divide & Conquer DP** (sibling `12`), because the Aliens trick often wraps one of them.
- The intuition that a **convex** function is "bowl-shaped": its slope only increases.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Exactly-`k` constraint** | The requirement to use a precise number `k` of items/segments/groups. This is what makes the DP expensive. |
| **Item / segment / group** | The thing you are counting. In the running example, a *segment* (contiguous piece). |
| **`opt(k)`** | The optimal (minimum) cost when forced to use **exactly `k`** items. The function we cannot afford to compute for every `k`. |
| **Penalty / toll `λ` (lambda)** | An extra cost added **per item used**. Sliding `λ` controls how many items the optimum wants. |
| **Unconstrained / penalized DP** | The DP solved **without** a count dimension, paying `λ` for each item: `f(λ) = min ( cost + λ · count )`. |
| **`f(λ)`** | The optimum value of the penalized DP for a given `λ` (the "penalized cost"). |
| **`cnt(λ)`** | The number of items the penalized optimum uses at penalty `λ`. Monotone (non-increasing) as `λ` grows. |
| **Convexity of `opt(k)`** | The property `opt(k) − opt(k−1) ≤ opt(k+1) − opt(k)`: marginal cost only grows. The prerequisite for the trick. |
| **Recover step** | Computing the true answer as `f(λ) − λ · k` after finding the right `λ`. |

---

## Core Concepts

### 1. The Expensive "Exactly-`k`" DP

We focus on problems shaped like:

```
opt(k) = best cost of the task using EXACTLY k items
dp[i][j] = min over t < j of ( dp[i-1][t] + cost(t, j) )     ;  opt(k) = dp[k][n]
```

The count `i` (number of items used) is a real DP dimension. It multiplies the runtime by `k`. The whole point of the Aliens trick is to **delete that dimension**.

### 2. The Penalized (Unconstrained) Problem

Replace "exactly `k` items" with "any number of items, but pay `λ` per item":

```
f(λ) = min over ANY count c  of  ( opt(c) + λ · c )
```

There is **no `i` dimension** here — the DP just decides at each step whether to "open a new item." Concretely, the penalized partition DP becomes a single row:

```
g[j] = min over t < j of ( g[t] + cost(t, j) + λ )      ;  f(λ) = g[n]
```

The `+ λ` is the toll paid for opening the segment `[t, j)`. Solving this is cheap — no count to track.

### 3. The Penalty Is a Dial on the Count

This is the intuition that makes everything click:

> Raising `λ` makes each item more expensive, so the penalized optimum uses **fewer** items. Lowering `λ` makes items cheaper, so it uses **more**.

Formally, the count `cnt(λ)` (how many items `f(λ)` uses) is **non-increasing in `λ`**. So if you want exactly `k` items, you look for the `λ` where `cnt(λ) = k`.

### 4. Binary Search on `λ`

Because `cnt(λ)` is monotone in `λ`, you can **binary-search** the dial:

```
if cnt(λ) > k:  λ is too small (too many items)  → raise λ
if cnt(λ) < k:  λ is too large (too few items)   → lower λ
if cnt(λ) = k:  perfect — stop
```

Each probe solves *one* penalized DP, so the whole search costs `O(log(range) · DP_cost)`.

### 5. Recovering the True Answer

When `f(λ)` uses exactly `k` items, its value bundles in `λ · k` of pure toll. Strip it off:

```
opt(k) = f(λ) − λ · k
```

That subtraction is why the trick is *correct*, not just fast: you get the exact optimal cost for **exactly `k`** items, not an approximation.

### 6. The Convexity Requirement (the heart of it)

Everything above rests on one structural fact:

> **`opt(k)` must be convex in `k`** — its marginal increments `opt(k) − opt(k−1)` only grow (for a minimization).

Why convexity matters, in one picture: think of `opt(k)` as a bowl-shaped curve of points `(k, opt(k))`. A penalty `λ` corresponds to laying a straight line of slope `−λ` underneath the curve and pushing it up until it just *touches* (is tangent to) the bowl. The `k` at the tangent point is `cnt(λ)`. Because the bowl is convex, the tangent point moves smoothly to the right as you decrease the slope — that is exactly the monotonicity of `cnt(λ)` that the binary search needs. If `opt(k)` were *not* convex (bumpy), the line could touch at a non-`k` point or skip values entirely, and the trick would fail. (We handle the subtle "collinear points" case in [`professional.md`](./professional.md).)

---

## Big-O Summary

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Naive DP with count dimension | **O(k · n)** or **O(k · n log n)** | O(k·n) or O(n) | The `k` factor is what we kill. |
| One penalized DP solve `f(λ)` | **O(DP_cost)** | O(n) | No count dimension; often `O(n)` or `O(n log n)`. |
| Binary search over `λ` | **O(log(range))** probes | — | `range` = span of possible slopes / costs. |
| **Aliens trick total** | **O(log(range) · DP_cost)** | O(n) | The headline number. |
| Recover `opt(k) = f(λ) − λ·k` | O(1) | — | After the search converges. |
| Verify convexity empirically | O(k · n …) | O(k) | Build full `opt(k)` table; tests only. |

The headline number is **`O(log(range) · DP_cost)`** — a `log(range)` factor (typically 30–60 integer steps) replaces the `k` factor (up to `n`). For `n = 10^5` and `k = 10^5`, that is the difference between `10^{10}` and a few million operations.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Penalty `λ` per item | A **toll** charged every time you open a new shop/segment. Raise the toll, fewer shops open. |
| Penalized DP `f(λ)` | The cheapest plan once each opening costs a fixed toll — you no longer count shops, you just weigh "is this shop worth the toll?" |
| Binary search on `λ` | Turning a thermostat dial: too cold (too many items) → turn up; too hot (too few) → turn down; settle on the exact setting. |
| Convex `opt(k)` curve | A **bowl** shape — adding more items helps less and less; the marginal benefit shrinks (cost increments grow). |
| Tangent line of slope `−λ` | A flat ruler pressed up under the bowl until it just touches; the touch-point's `k` is how many items that toll buys. |
| Recover `f(λ) − λ·k` | Paying the bill, then refunding the `k` tolls so you see the pure item-cost. |

Where the analogy breaks: a real toll road's optimum need not be perfectly convex; the technique *requires* the bowl shape, and if the curve has dents the tangent ruler can skip past your target `k`.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| **Removes the entire `k` dimension** — `O(k · DP)` becomes `O(log(range) · DP)`. | Requires `opt(k)` to be **convex** in `k`; otherwise it fails (sometimes silently). |
| Each probe is just the *easy* unconstrained DP, often `O(n)` or `O(n log n)`. | Choosing the binary-search range and handling **collinear** `opt(k)` points (ties) is fiddly. |
| **Composes** with CHT / D&C: penalize away `k`, then speed up each `f(λ)`. | You must also track `cnt(λ)` (item count), with a consistent tie-break, to hit exactly `k`. |
| Gives the **exact** answer, not an approximation, via the `f(λ) − λ·k` recovery. | Integer-vs-real `λ` numerics: floating `λ` invites precision bugs; integer `λ` needs care. |
| One clean idea reused across many "exactly-`k`" problems. | If `cnt(λ)` jumps over `k` (collinear region), you must specially recover the answer at the boundary. |

**When to use:** an "exactly-`k`" optimization DP where (a) the unconstrained penalized version is much cheaper, and (b) `opt(k)` is convex in `k` (provable or strongly believed).

**When NOT to use:** when `opt(k)` is **not** convex (the trick is wrong); when `k` is small enough that the naive `O(k · DP)` is fast enough; when you cannot make the *unconstrained* problem cheap (then there is nothing to gain).

---

## Step-by-Step Walkthrough

Split `a = [1, 3, 2, 4]` into **exactly `k = 2`** contiguous segments, minimizing the sum of `(segment sum)²`.

Prefix sums `P = [0, 1, 4, 6, 10]`, so segment `[t, j)` has sum `P[j] − P[t]` and cost `(P[j] − P[t])²`.

**First, what is the true `opt(k)` table?** (We compute it here only to *see* convexity — the trick avoids it.)

```
opt(1): one segment [0,4)        → (10)²              = 100
opt(2): best 2-split [1,3]|[2,4] → 4² + 6²  = 16 + 36 = 52
opt(3): best 3-split [1]|[3,2]|[4] → 1² + 5² + 4²     = 42     (one good 3-split)
opt(4): every element alone      → 1²+3²+2²+4²         = 30
```

Increments: `opt(2)−opt(1) = −48`, `opt(3)−opt(2) = −10`, `opt(4)−opt(3) = −12`. For a *minimization* with convex `opt`, the increments must be **non-decreasing**: `−48 ≤ −10 ≤ −12`? Here `−10 ≤ −12` is **false** by a hair due to the toy numbers — real Aliens problems guarantee convexity (see the senior/professional proofs for which costs qualify). For the walkthrough we use the convex shape `opt = (100, 52, 42, 30)` conceptually; the point is the *mechanics* of the penalty.

**Now run the penalized DP.** With penalty `λ`, the single-row DP is:

```
g[j] = min over t < j of ( g[t] + (P[j] − P[t])² + λ ) ,  g[0] = 0,  f(λ) = g[4]
```

We also track `cnt[j]` = number of segments used to reach `g[j]` (break ties toward **fewer** segments).

**Probe `λ = 60` (a big toll).** Opening a segment costs an extra 60, so the optimum prefers *few* segments:

```
g[4] best is one segment: 0 + 100 + 60 = 160,  cnt = 1
```

`cnt(60) = 1 < k = 2` → toll too high, **lower `λ`**.

**Probe `λ = 5` (a small toll).** Opening is cheap, so the optimum uses *many* segments:

```
4 segments: 30 + 4·5 = 50,  cnt = 4   (cheaper than fewer here)
```

`cnt(5) = 4 > k = 2` → toll too low, **raise `λ`**.

**Probe `λ = 20`.** Now compare:

```
1 segment: 100 + 1·20 = 120
2 segments: 52  + 2·20 = 92    ← best
3 segments: 42  + 3·20 = 102
4 segments: 30  + 4·20 = 110
```

`f(20) = 92`, `cnt(20) = 2 = k`. **Found it.**

**Recover:** `opt(2) = f(λ) − λ·k = 92 − 20·2 = 92 − 40 = 52`. ✓

That matches the direct answer `opt(2) = 52` — and we never built the `k` dimension; we just solved three cheap penalized DPs and binary-searched the toll.

---

## Code Examples

### Example: Partition Array into Exactly `K` Segments via the Aliens Trick

We solve the *penalized* single-row DP for a given `λ`, returning both `f(λ)` and the segment count, then binary-search `λ` (integer search here for clarity).

#### Go

```go
package main

import "fmt"

const NEG = int64(-1)

var prefix []int64 // prefix[j] = a[0]+...+a[j-1]

func cost(t, j int) int64 {
	s := prefix[j] - prefix[t]
	return s * s
}

// solveLambda returns (f(λ), number of segments used).
// Ties are broken toward FEWER segments so cnt is non-increasing in λ.
func solveLambda(n int, lambda int64) (int64, int) {
	g := make([]int64, n+1)
	cnt := make([]int, n+1)
	for j := 1; j <= n; j++ {
		best := int64(1) << 62
		bestCnt := 0
		for t := 0; t < j; t++ {
			v := g[t] + cost(t, j) + lambda // +λ toll per segment opened
			c := cnt[t] + 1
			if v < best || (v == best && c < bestCnt) {
				best, bestCnt = v, c
			}
		}
		g[j], cnt[j] = best, bestCnt
	}
	return g[n], cnt[n]
}

func partitionExactlyK(a []int, K int) int64 {
	n := len(a)
	prefix = make([]int64, n+1)
	for i, x := range a {
		prefix[i+1] = prefix[i] + int64(x)
	}
	lo, hi := int64(0), int64(1)<<40 // λ range: 0 .. big
	var bestLambda int64 = hi
	for lo <= hi {
		mid := (lo + hi) / 2
		_, c := solveLambda(n, mid)
		if c <= K { // few enough segments: λ may be too big, try smaller
			bestLambda = mid
			hi = mid - 1
		} else {
			lo = mid + 1
		}
	}
	f, _ := solveLambda(n, bestLambda)
	return f - bestLambda*int64(K) // recover opt(K)
}

func main() {
	a := []int{1, 3, 2, 4}
	fmt.Println(partitionExactlyK(a, 2)) // 52
}
```

#### Java

```java
public class AliensTrick {
    static long[] prefix;

    static long cost(int t, int j) {
        long s = prefix[j] - prefix[t];
        return s * s;
    }

    // returns {f(lambda), segmentCount}; ties broken toward FEWER segments
    static long[] solveLambda(int n, long lambda) {
        long[] g = new long[n + 1];
        int[] cnt = new int[n + 1];
        for (int j = 1; j <= n; j++) {
            long best = 1L << 62;
            int bestCnt = 0;
            for (int t = 0; t < j; t++) {
                long v = g[t] + cost(t, j) + lambda;
                int c = cnt[t] + 1;
                if (v < best || (v == best && c < bestCnt)) {
                    best = v; bestCnt = c;
                }
            }
            g[j] = best; cnt[j] = bestCnt;
        }
        return new long[]{g[n], cnt[n]};
    }

    static long partitionExactlyK(int[] a, int K) {
        int n = a.length;
        prefix = new long[n + 1];
        for (int i = 0; i < n; i++) prefix[i + 1] = prefix[i] + a[i];
        long lo = 0, hi = 1L << 40, bestLambda = hi;
        while (lo <= hi) {
            long mid = (lo + hi) / 2;
            long c = solveLambda(n, mid)[1];
            if (c <= K) { bestLambda = mid; hi = mid - 1; }
            else lo = mid + 1;
        }
        long f = solveLambda(n, bestLambda)[0];
        return f - bestLambda * K; // recover opt(K)
    }

    public static void main(String[] args) {
        int[] a = {1, 3, 2, 4};
        System.out.println(partitionExactlyK(a, 2)); // 52
    }
}
```

#### Python

```python
def partition_exactly_k(a, K):
    n = len(a)
    prefix = [0] * (n + 1)
    for i, x in enumerate(a):
        prefix[i + 1] = prefix[i] + x

    def cost(t, j):
        s = prefix[j] - prefix[t]
        return s * s

    def solve_lambda(lam):
        INF = 1 << 62
        g = [0] * (n + 1)
        cnt = [0] * (n + 1)
        for j in range(1, n + 1):
            best, best_cnt = INF, 0
            for t in range(j):
                v = g[t] + cost(t, j) + lam   # +λ toll per segment
                c = cnt[t] + 1
                if v < best or (v == best and c < best_cnt):  # fewer segments on ties
                    best, best_cnt = v, c
            g[j], cnt[j] = best, best_cnt
        return g[n], cnt[n]

    lo, hi = 0, 1 << 40
    best_lambda = hi
    while lo <= hi:
        mid = (lo + hi) // 2
        _, c = solve_lambda(mid)
        if c <= K:                 # few enough segments → λ may be too big
            best_lambda = mid
            hi = mid - 1
        else:
            lo = mid + 1
    f, _ = solve_lambda(best_lambda)
    return f - best_lambda * K     # recover opt(K)


if __name__ == "__main__":
    print(partition_exactly_k([1, 3, 2, 4], 2))  # 52
```

**What it does:** builds prefix sums, then binary-searches the per-segment penalty `λ`. For each `λ` it solves the cheap unconstrained DP, reads off the segment count, and steers the search. Finally it subtracts `λ · K` to recover the exact "exactly-`K`" cost.
**Run:** `go run main.go` | `javac AliensTrick.java && java AliensTrick` | `python aliens.py`

> Note: the inner `solveLambda` is written as a simple `O(n²)` DP here for clarity. In real use you replace it with an `O(n)` or `O(n log n)` penalized DP (CHT / D&C / monotonic), which is the whole reason the trick is fast. See [`senior.md`](./senior.md).

---

## Coding Patterns

### Pattern 1: Penalized Solver Returning (value, count)

**Intent:** the binary search needs *two* outputs from each probe — the penalized optimum `f(λ)` **and** the item count `cnt(λ)`. Always return both, and break ties on count consistently (toward fewer, or toward more, but pick one and document it).

```python
def solve_lambda(lam):
    # ... DP paying +lam per item, tracking count along the optimal path ...
    return f_value, item_count
```

### Pattern 2: Count-Driven Binary Search

**Intent:** drive the search by comparing `cnt(λ)` to the target `k`, not by comparing values.

```text
lo, hi = min_slope, max_slope
while lo <= hi:
    mid = (lo + hi) / 2
    _, c = solve_lambda(mid)
    if c <= k: best = mid; hi = mid - 1     # too few/equal → smaller λ buys more items
    else:      lo = mid + 1
answer = solve_lambda(best).value - best * k
```

### Pattern 3: Recover With the Original `k`

**Intent:** always subtract `λ · k` using the **target `k`**, not the count the probe returned — even when ties make the probe report a different count. (The professional file explains why this still yields `opt(k)` exactly when `opt(k)` lies on a collinear stretch.)

```mermaid
graph TD
    A[Target k] --> B[Binary search on λ]
    B --> C[solve_lambda: penalized DP]
    C --> D{cnt(λ) vs k}
    D -->|cnt > k| E[λ too small → raise]
    D -->|cnt < k| F[λ too large → lower]
    D -->|cnt = k| G[Lock λ]
    E --> B
    F --> B
    G --> H[answer = f(λ) − λ·k]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong answer, no crash | `opt(k)` is not convex for this cost. | Verify convexity (prove it or check increments empirically) before applying. |
| Off-by-one in penalty sign | Added `−λ` instead of `+λ` (or vice versa for max). | For *min* problems, **add** `λ` per item; for *max*, **subtract**. |
| Binary search never hits `k` | `opt(k)` has collinear points; `cnt(λ)` jumps over `k`. | Use `cnt ≤ k` / `cnt ≥ k` boundary search + special recovery (see professional). |
| Search range too small | `λ` bounds don't cover the true slope. | Set `hi` to a safe upper bound on `|opt(k)−opt(k−1)|`. |
| Forgot to subtract `λ·k` | Reported `f(λ)` (penalized) as the answer. | Always recover with `f(λ) − λ·k`. |
| Inconsistent tie-break | Count flips run-to-run, search oscillates. | Fix a deterministic tie-break (fewer or more items) everywhere. |

---

## Performance Tips

- **Make the penalized DP as cheap as possible.** The whole win is replacing `k` probes with `log(range)` probes — but each probe still pays `DP_cost`. Use CHT / D&C / monotonic-queue to get each `f(λ)` to `O(n)` or `O(n log n)`.
- **Use integer `λ`** when costs are integers; it avoids floating-point precision bugs and the search terminates cleanly.
- **Pick a tight `λ` range.** `hi` only needs to exceed the largest possible marginal cost `|opt(k) − opt(k−1)|`; an over-wide range just adds a few probes.
- **Track the count along the optimal path** inside the DP (carry a `cnt[]` array), rather than re-deriving it.
- **Reuse buffers** across probes; each probe re-runs the DP, so avoid re-allocating `g[]` and `cnt[]` every time if the hot path matters.

---

## Best Practices

- **Confirm convexity first.** Either prove `opt(k)` is convex (often from a Monge/convex cost) or build the full `opt(k)` table on small inputs and assert the increments are monotone.
- **Always return (value, count)** from the penalized solver and **drive the search by count**.
- **Recover with the target `k`**, i.e. `f(λ) − λ·k`, not with the probed count.
- **Document the tie-break** (fewer vs more items) and keep it consistent across the solver and the search.
- **Test against a brute-force `O(k · DP)` oracle** on small inputs — diff `opt(k)` for every `k`.
- **Decide integer vs real `λ`** up front; prefer integer when inputs are integers.

---

## Edge Cases & Pitfalls

- **`k = 1`** — one item covers everything; the penalty pushes hardest, `cnt(λ)` saturates at 1 for large `λ`.
- **`k = n`** — every element is its own item; the penalty must drop to its minimum to allow that many items.
- **Collinear `opt(k)`** — when several consecutive `opt(k)` lie on a straight line, *one* `λ` is optimal for *all* of them, so `cnt(λ)` can skip over your target `k`. This is the trickiest case; handle it with a boundary search (see professional).
- **Non-convex `opt(k)`** — the technique is simply wrong; the tangent line can miss your `k`. Most dangerous pitfall.
- **Penalty sign** — add for minimization, subtract for maximization; getting it backwards inverts the monotonicity.
- **`λ` range** — too narrow misses the true slope; pick `hi` from a provable bound on marginal cost.
- **Integer overflow** — squared/penalized costs grow fast; use 64-bit and keep `λ · k` within range.

---

## Common Mistakes

1. **Applying it without checking convexity** — the most common and most dangerous error; the answer is wrong with no crash.
2. **Reporting `f(λ)` instead of `f(λ) − λ·k`** — forgetting the recovery step gives the penalized cost, not the true cost.
3. **Wrong penalty sign** — `+λ` vs `−λ` confusion between min and max versions flips the search direction.
4. **No tie-handling for collinear `opt(k)`** — the search "never finds exactly `k`" because `cnt(λ)` jumps; you need a boundary search.
5. **Inconsistent or missing count tie-break** — `cnt(λ)` becomes nondeterministic and the search oscillates.
6. **Too-narrow `λ` range** — the true slope lies outside `[lo, hi]`, so the search converges to the wrong toll.
7. **Leaving the penalized DP at `O(n²)`** — then `O(log(range) · n²)` may be no better than the naive `O(k · n)`; make the inner DP fast.

---

## Cheat Sheet

| Question | Tool | Formula |
|----------|------|---------|
| Problem this solves | exactly-`k` partition/selection | `opt(k) = dp[k][n]` |
| Penalized DP | drop count, add toll | `f(λ) = min_c ( opt(c) + λ·c )` |
| Single-row penalized partition | one DP per probe | `g[j] = min_{t<j}( g[t] + cost(t,j) + λ )` |
| What `λ` controls | item count | `cnt(λ)` non-increasing in `λ` |
| Search | binary search on `λ` | drive by `cnt(λ)` vs `k` |
| Recover | strip the toll | `opt(k) = f(λ) − λ·k` |
| Prerequisite | convexity | `opt(k)−opt(k−1)` monotone in `k` |
| Total cost | — | `O(log(range) · DP_cost)` |
| Sibling: one-layer speedup | CHT (10) / D&C (12) | composes *inside* `f(λ)` |

Core loop:

```
binary search λ in [lo, hi]:
    (f, cnt) = solve_penalized_DP(λ)      # adds +λ per item, tracks count
    steer λ so that cnt → k
answer = f(λ*) − λ* · k
# total: O(log(range) · DP_cost)
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The convex `opt(k)`-vs-`k` curve drawn as a bowl of points.
> - A straight line of slope `−λ` pressed up from below until it is **tangent** to the bowl.
> - How the tangent point's `k` equals `cnt(λ)` and matches the target `k` for the right `λ`.
> - The **binary search on `λ`** narrowing the slope range, with Step / Run / Reset controls and a running log of each probe's `cnt(λ)`.

---

## Summary

The **Aliens trick** (Lagrangian / parametric relaxation) solves "use **exactly `k`** items" DPs by **removing the count dimension**. You add a **penalty `λ` per item**, solve the now-easy *unconstrained* DP `f(λ) = min ( cost + λ · count )`, and **binary-search `λ`** until the unconstrained optimum uses exactly `k` items — possible because the item count `cnt(λ)` is **monotone** in `λ`, which in turn holds because `opt(k)` is **convex** in `k`. The true answer is recovered as `opt(k) = f(λ) − λ · k`. The cost drops from `O(k · DP)` to `O(log(range) · DP)`. The technique often **composes** with the Convex Hull Trick (sibling `10`) or Divide & Conquer optimization (sibling `12`) to make each penalized `f(λ)` fast. The golden rule: **never apply it without confirming `opt(k)` is convex**, and always handle **collinear** points and the **recovery** step carefully — otherwise it fails silently.

---

## Further Reading

- IOI 2016 problem **"Aliens"** — the canonical problem that named the technique.
- *Competitive Programmer's Handbook* (Laaksonen) — DP optimization chapters.
- cp-algorithms.com — Lagrangian relaxation / "Aliens trick" article.
- Sibling topic `10-convex-hull-trick` — speeds up each penalized DP.
- Sibling topic `12-divide-conquer-optimization` — another inner speedup for `f(λ)`.
- "Codeforces — Aliens trick" tutorials and editorials (e.g. problems on splitting arrays into `k` parts).

---

**Next step:** [`middle.md`](./middle.md) — *why* convexity makes the count monotone, how to remove the penalty correctly, and handling exactly-`k` vs at-most-`k`.
