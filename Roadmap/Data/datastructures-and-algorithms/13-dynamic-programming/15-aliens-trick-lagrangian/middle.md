# Aliens Trick (Lagrangian Relaxation) — Middle Level

> **Focus:** *Why* convexity of `opt(k)` makes the item count `cnt(λ)` monotone in `λ` (so binary search is valid), how to **remove the penalty** correctly to recover `opt(k) = f(λ) − λ·k`, how to handle **exactly-`k` vs at-most-`k`** and the dangerous **collinear / tie** case, and exactly how the Aliens trick differs from — and composes with — the Convex Hull Trick (sibling `10`) and Divide & Conquer optimization (sibling `12`).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The Geometry: Tangent Lines to a Convex Curve](#the-geometry-tangent-lines-to-a-convex-curve)
4. [Removing the Penalty Correctly](#removing-the-penalty-correctly)
5. [Exactly-k vs At-Most-k and Tie Handling](#exactly-k-vs-at-most-k-and-tie-handling)
6. [Comparison with CHT, D&C, and Plain DP](#comparison-with-cht-dc-and-plain-dp)
7. [Advanced Patterns](#advanced-patterns)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was a recipe: add a penalty `λ`, solve the unconstrained DP, binary-search `λ` so the count hits `k`, subtract `λ·k`. At middle level you ask the questions that decide whether your solution is *fast* **and** *correct*:

- *Why* is the item count `cnt(λ)` monotone in `λ`, and what exactly does convexity of `opt(k)` have to do with it?
- *Why* does subtracting `λ·k` recover the **exact** `opt(k)`, and not an approximation or a bound?
- What happens when `opt(k)` has **collinear** points so that one `λ` is optimal for a whole *range* of counts, and the binary search "never lands on exactly `k`"?
- How do I adapt the recipe for **at-most-`k`** instead of **exactly-`k`**, and for **maximization** instead of minimization?
- How does this relate to the *other* DP optimizations — and when do I **stack** Aliens on top of CHT or D&C?

These are the questions that separate "I copied a template" from "I can recognize when Lagrangian relaxation applies, prove it works, and adapt it to the collinear corner cases that decide AC vs WA."

---

## Deeper Concepts

### The exactly-`k` DP and its Lagrangian relaxation

We optimize, over a count `c` of items:

```
opt(k) = min { task cost using exactly k items }      (a minimization)
```

The **Lagrangian relaxation** drops the hard "exactly `k`" constraint and *prices* the count with a multiplier `λ`:

```
L(λ) = min over ALL counts c  of  ( opt(c) + λ · c )
     = f(λ)        (the penalized optimum; what the cheap DP computes)
```

For any fixed `λ`, `f(λ)` is easy because there is no count dimension — the DP just decides, at each transition, whether opening another item is worth its toll `λ`. The genius is that we can choose `λ` so the *unconstrained* optimum *happens to* use exactly `k` items.

### Why `f(λ)` is a lower envelope of lines

Rewrite `f(λ)` as a minimization over a *family of lines* in the variable `λ`:

```
f(λ) = min over c  of  ( opt(c) + c · λ )
```

For each fixed count `c`, the term `opt(c) + c·λ` is a **straight line** in `λ` with slope `c` and intercept `opt(c)`. So `f(λ)` is the **lower envelope** (pointwise minimum) of these lines — which is automatically a **concave**, piecewise-linear function of `λ`. The line achieving the minimum at a given `λ` is the count the penalized optimum picks: that is `cnt(λ)`.

As `λ` increases, the minimizing line shifts to **smaller slope `c`** (steeper-sloped lines lose to flatter ones for large `λ`). Hence **`cnt(λ)` is non-increasing in `λ`** — the monotonicity that makes the binary search valid. This holds **only if** the points `(c, opt(c))` form a **convex** set, i.e. every count `c` actually appears on the lower envelope; if some `(c, opt(c))` lies *above* the hull of its neighbors (non-convex), that count is **never** the unique minimizer for any `λ`, and the trick can never produce exactly that count.

### The convexity prerequisite, stated precisely

For a **minimization**, `opt(k)` is convex iff its first differences are non-decreasing:

```
opt(k) − opt(k−1)  ≤  opt(k+1) − opt(k)      for all k        (CONVEX, min)
```

Intuitively, each additional item helps **less and less** (marginal improvement shrinks; the cost increments grow). When this holds, every `k` lies on the lower hull of `(k, opt(k))`, so some slope `λ` exposes it as the unique minimizer — and binary search can find that slope. For a **maximization**, the mirror condition is **concavity** (differences non-increasing), and you *subtract* the penalty.

### Why convexity is the make-or-break property

If `opt(k)` is **not** convex, the point `(k, opt(k))` may sit *strictly above* the line joining `(k−1, opt(k−1))` and `(k+1, opt(k+1))`. Then for *every* slope `λ`, either `k−1` or `k+1` (or some farther count) beats `k` — the tangent line never touches `k`. Binary search will oscillate around `k` and converge to a `λ` whose optimum uses `k−1` or `k+1` items, and the recovered value `f(λ) − λ·k` is **garbage**. This is the single most dangerous failure mode, and it is *silent*: no crash, just a wrong number. Verifying convexity (by proof or by an empirical increment check) is mandatory.

---

## The Geometry: Tangent Lines to a Convex Curve

The cleanest mental model: plot the points `(k, opt(k))` for `k = 0, 1, …`. Convexity means they sit on a **bowl-shaped** lower hull.

- A penalty `λ` corresponds to a **line of slope `−λ`** swept up from below (because we minimize `opt(c) + λ·c`, the supporting line touches the bowl where its slope matches).
- Pressing that line up until it just **touches** the bowl gives a **tangent point**; the `k` at that point is `cnt(λ)`.
- **Decreasing `λ`** (flatter penalty, gentler slope) slides the tangent point to the **right** (larger `k`); **increasing `λ`** slides it **left** (smaller `k`). That sliding is exactly the monotonicity `cnt(λ)` non-increasing in `λ`.

```mermaid
graph LR
    A["opt(k) bowl (convex)"] --> B["press line slope −λ from below"]
    B --> C["tangent point at k = cnt(λ)"]
    C --> D{cnt(λ) vs target k}
    D -->|too left, cnt<k| E["decrease λ → slide right"]
    D -->|too right, cnt>k| F["increase λ → slide left"]
    D -->|tangent at k| G["recover opt(k)=f(λ)−λ·k"]
    E --> B
    F --> B
```

The recovery formula falls straight out of the geometry: when the tangent line touches at `k`, its **intercept** (value at `λ` mapped back) equals `opt(k)`. Algebraically, the tangent line is `y = f(λ) + (something)`; evaluating it gives `opt(k) = f(λ) − λ·k`. The subtraction simply removes the `k` tolls that the penalized value bundled in.

### Why the tangent point lands on a *vertex* of the hull

The lower hull of a convex point set is piecewise linear; its **vertices** are the counts `k` that are *uniquely* optimal for some open interval of slopes. Between two adjacent vertices runs an **edge** — a stretch of slope where *two* counts tie. The binary search on `λ` is really a search for the slope interval (vertex) corresponding to `k`. When `k` is a vertex, a whole interval of `λ` gives `cnt(λ) = k`, and any such `λ` recovers `opt(k)`. When `k` sits on an **edge** (collinear with its neighbors), no `λ` gives `cnt(λ) = k` *uniquely* — that is the collinear case treated below.

### A worked slope-interval calculation

Take a convex `opt = (opt(1), opt(2), opt(3), opt(4)) = (100, 52, 30, 16)`. The marginal differences are `Δ(2) = −48`, `Δ(3) = −22`, `Δ(4) = −14` — non-decreasing, so convex. Each count `k` is uniquely optimal for the slope interval bounded by its neighbouring marginals. Count `k = 2` is the minimizer of `opt(c) + λ·c` precisely when:

```
opt(2) + 2λ ≤ opt(1) + 1λ   ⟺   52 + 2λ ≤ 100 + λ   ⟺   λ ≤ 48
opt(2) + 2λ ≤ opt(3) + 3λ   ⟺   52 + 2λ ≤ 30 + 3λ   ⟺   λ ≥ 22
```

So `cnt(λ) = 2` exactly for `λ ∈ [22, 48]` — a whole interval, because `k = 2` is a hull vertex. The width of that interval is `48 − 22 = 26`, the gap between the marginals `|Δ(2)| − |Δ(3)| = 48 − 22`. Binary-searching `λ` lands *somewhere* inside `[22, 48]`, and **any** point there recovers `opt(2) = f(λ) − 2λ`: at `λ = 30`, `f(30) = 52 + 60 = 112`, and `112 − 60 = 52`; at `λ = 40`, `f(40) = 52 + 80 = 132`, and `132 − 80 = 52`. The recovered value is invariant across the interval — the sanity check from the recovery section.

---

## Removing the Penalty Correctly

The recovery step is where a surprising number of bugs hide.

### The identity

If, at penalty `λ*`, the penalized optimum uses exactly `k` items, then:

```
f(λ*) = opt(k) + λ* · k      ⟹      opt(k) = f(λ*) − λ* · k
```

This is **exact**, not approximate, *because* `opt(k)` is convex: the relaxation `f(λ)` is tight at the count it selects. There is no "duality gap" — Lagrangian relaxation of a convex problem with the multiplier set to the supporting slope recovers the constrained optimum exactly.

### Subtract `λ · k`, using the **target** `k`

A subtle but critical rule: **subtract `λ · k` with the target `k`, not the count the probe returned.** When `opt(k)` is a hull vertex, the probe's count equals `k` and it makes no difference. But in the **collinear** case (below), the probe at the boundary `λ` may report `k−1` or `k+1` items while `opt(k)` still lies on the line `f(λ) − λ·k`. Using the *target* `k` in the subtraction is what makes the recovery land on `opt(k)` exactly. (The professional file proves this.)

### A worked recovery

From junior: `a = [1,3,2,4]`, target `k = 2`. At `λ* = 20` we found `f(20) = 92` with `cnt(20) = 2`. Recovery:

```
opt(2) = f(20) − 20·2 = 92 − 40 = 52   ✓
```

Now suppose `λ* = 18` *also* gave `cnt = 2` but `f(18) = 56 + 2·18 = ...` — whatever `λ` in the valid interval, the recovery `f(λ) − λ·2` returns the **same** `52`, because along the tangent the penalized value moves by exactly `+λ·2` as `λ` changes. That invariance is the sanity check: *any* `λ` in the count-`k` interval recovers the same `opt(k)`.

---

## Exactly-k vs At-Most-k and Tie Handling

### At-most-`k`

If the constraint is "use **at most** `k` items," and using fewer items is allowed (and never penalized beyond their own cost), then for a *minimization* with convex `opt(k)`, **`opt` is non-increasing then flat or the minimum is at the largest allowed count** — but the clean statement is: `min_{c ≤ k} opt(c)`. Because `opt` is convex (bowl-shaped), `min_{c≤k} opt(c)` is achieved either at `c = k` or at the **global minimum** count `c*` if `c* ≤ k`. Two common handlings:

- If you *also* added the penalty only to *force* the count and items are otherwise free to skip, "at most `k`" often means you can stop early. Binary-searching `λ ≥ 0` and taking `cnt(λ) ≤ k` finds it.
- More simply: solve exactly-`c` for the relevant `c` via the same machinery and take the best `c ≤ k`. Usually one Aliens search with the right boundary suffices.

### Exactly-`k` is the hard one

"Exactly `k`" is what the trick is really for, and it is where collinearity bites. Two sub-cases:

1. **`k` is a hull vertex.** A whole open interval of `λ` gives `cnt(λ) = k`; binary search lands inside it; recovery is trivial.
2. **`k` is on a hull edge (collinear).** Several consecutive counts `…, k−1, k, k+1, …` are collinear on the lower hull. Then there is a *single* slope `λ*` for which all of them are simultaneously optimal, and for `λ` slightly above `λ*` the count is the **left** endpoint, for `λ` slightly below it is the **right** endpoint. The count `cnt(λ)` **jumps over** the interior values — including possibly your `k`.

### Handling the collinear / tie case

The robust recipe (detailed and proved in [`professional.md`](./professional.md)):

1. Binary-search to the **boundary slope** `λ*` — the smallest `λ` for which `cnt(λ) ≤ k` (using a tie-break that makes `cnt(λ)` well-defined and monotone).
2. At `λ*`, the penalized optimum value `f(λ*)` is on the supporting line. **Recover with the target `k`**: `opt(k) = f(λ*) − λ* · k`. Because `k` lies on the same line as the boundary counts, this is exact even though `cnt(λ*) ≠ k`.

The key tie-handling implementation detail: when solving the penalized DP, **break ties consistently** — e.g. among equal penalized values prefer the path with **fewer** items. That makes `cnt(λ)` the *left* endpoint of each collinear stretch and keeps it monotone, so the binary search on the boundary is well-defined.

### Why "subtract `λ·k` with target `k`" is safe on an edge

On a collinear edge, all the points `(c, opt(c))` for `c` in `[c_left, c_right]` lie on a line `opt(c) = α − λ*·c` for the boundary slope `λ*` and some intercept `α`. Then `f(λ*) = α` (the common minimized value), and `opt(k) = α − λ*·k = f(λ*) − λ*·k` for **every** `c = k` in the stretch — so the target-`k` recovery is exact regardless of which endpoint the probe's count landed on.

---

## Comparison with CHT, D&C, and Plain DP

The Aliens trick is a *different kind* of DP optimization than CHT (sibling `10`) and D&C (sibling `12`): those speed up **one layer** of a DP; Aliens **removes a whole dimension** (the count `k`). They are *complementary*, and frequently used **together**.

| | What it does | Structural requirement | Cost effect |
|---|--------------|------------------------|-------------|
| **Aliens trick (this)** | Removes the **count `k`** dimension via a penalty + binary search on `λ` | `opt(k)` **convex** in `k` | `O(k · DP)` → `O(log(range) · DP)` |
| **Convex Hull Trick (10)** | Speeds up a **linear-cost** transition within one layer | cost factors into **lines**: `dp[t] + a[t]·x[j] + b[t]` | `O(n²)` layer → `O(n)`–`O(n log n)` |
| **Divide & Conquer opt (12)** | Speeds up a **layered partition** transition within one layer | optimal split **monotone** (Monge cost) | `O(n²)` layer → `O(n log n)` |
| **Plain DP** | Baseline; carries the count dimension explicitly | none | `O(k · n …)` |

### Aliens *composes* with CHT / D&C

The penalized DP `g[j] = min_{t<j} ( g[t] + cost(t, j) + λ )` is itself a single-layer DP. If `cost` is linear in a query (e.g. `(P[j]−P[t])²` expands to a line in `P[j]`), you solve each `f(λ)` with **CHT** in `O(n)`. If `cost` is a Monge function, you solve each `f(λ)` with **D&C** in `O(n log n)`. So the full Aliens solution is:

```
total = O( log(range) · cost_of_one_penalized_DP )
      = O( log(range) · n )         using CHT inside
      = O( log(range) · n log n )   using D&C inside
```

This stacking is the standard way IOI-Aliens-style problems are solved: *Aliens removes `k`, CHT or D&C makes each probe linear-ish.*

### Decision rule

```
Does the problem force EXACTLY k items, and is opt(k) convex?   → use Aliens (remove k)
   Is the penalized transition cost linear in a query?          → inner = CHT (topic 10)
   Is the penalized transition a Monge partition cost?          → inner = D&C (topic 12)
   Otherwise                                                     → inner = plain O(n) / O(n^2)
No count constraint, just one slow layer?                       → use CHT or D&C directly
```

### A worked side-by-side

Squared-segment-sum partition into exactly `k` pieces:

- **Without Aliens:** `dp[i][j] = min_{t<j}( dp[i-1][t] + (P[j]−P[t])² )`, `O(k·n²)` naively, or `O(k·n log n)` with D&C per layer — still has the `k` factor.
- **With Aliens:** penalize, drop the `i` dimension, solve `g[j] = min_{t<j}( g[t] + (P[j]−P[t])² + λ )` per probe. Expanding `(P[j]−P[t])²` shows the `t`-part is a line in `P[j]`, so **CHT** gives each probe `O(n)`; binary search over `λ` gives `O(n log(range))` total — the `k` factor is **gone**.

That is why the canonical IOI "Aliens" solution is "Aliens trick + Convex Hull Trick."

### When the trick gives no win

Three situations where Aliens looks applicable but buys nothing:

1. **`k` is small.** If `k` is a fixed small constant (say `k ≤ 50`), the count-indexed DP `O(k · DP)` is already cheap and far simpler. Aliens earns its complexity only when `k` can grow toward `n`.
2. **Penalizing does not simplify the DP.** The whole premise is that *removing* the count dimension yields a cheaper DP. If the count was not the expensive part — if the per-layer transition is the bottleneck and is unchanged by the penalty — you gain nothing.
3. **`opt(k)` is not convex.** Then the trick is not merely useless, it is *wrong*. There is no `λ` exposing a non-hull count, so the search converges to a neighbour and the recovery is garbage. (See the proof in [`professional.md`](./professional.md) that non-hull counts are unreachable.)

The middle-level discipline is to ask all three questions *before* writing code: is `k` large, does penalizing simplify, and is `opt(k)` convex?

---

## Advanced Patterns

### Pattern: Tracking the count along the optimal path

The penalized DP must report not just `f(λ)` but `cnt(λ)`. Carry a parallel `cnt[]` array; when you relax `g[j]` from `g[t]`, set `cnt[j] = cnt[t] + 1` (one more item). On ties in `g`, pick the count consistent with your tie-break (fewer or more items).

### Pattern: Real vs integer `λ`

- **Integer `λ`** (when inputs/costs are integers): binary-search `λ` over an integer range `[0, MAXSLOPE]`. The hull slopes are integers (differences of integer `opt` values), so an integer search lands exactly on the boundary. Preferred — no precision issues.
- **Real `λ`**: binary-search a `double` for ~50–100 iterations. Simpler to reason about, but watch precision: stop when the count stabilizes, then recover. Risky for tight problems; prefer integer when possible.

### Pattern: Maximization variant

For `max`-problems with **concave** `opt(k)`, **subtract** the penalty: `f(λ) = max_c ( opt(c) − λ·c )`, and `cnt(λ)` is **non-decreasing** in `λ`. Recovery: `opt(k) = f(λ) + λ·k`. Everything mirrors; only the signs and monotonicity direction flip.

### Pattern: Composing with CHT (the canonical IOI build)

```text
binary search λ:
    f, cnt = penalized_DP_with_CHT(λ)     # O(n): lines added as t increases
    steer λ by cnt vs k
answer = f(λ*) − λ* · k
```

### Pattern: Boundary search for collinear `k`

```text
# find smallest λ with cnt(λ) ≤ k  (ties → fewer items)
lo, hi = 0, MAXSLOPE
while lo < hi:
    mid = (lo + hi) // 2
    _, c = solve(mid)
    if c <= k: hi = mid
    else:      lo = mid + 1
f, _ = solve(lo)
answer = f - lo * k     # target k, exact even on a collinear edge
```

---

## Code Examples

### Reusable Aliens solver with explicit (value, count) and target-`k` recovery

#### Go

```go
package main

import "fmt"

const INF = int64(1) << 62

var prefix []int64

func cost(t, j int) int64 {
	s := prefix[j] - prefix[t]
	return s * s
}

// penalized DP: returns f(λ) and segment count (ties → FEWER segments).
func solve(n int, lambda int64) (int64, int) {
	g := make([]int64, n+1)
	cnt := make([]int, n+1)
	for j := 1; j <= n; j++ {
		best, bestCnt := INF, 0
		for t := 0; t < j; t++ {
			v := g[t] + cost(t, j) + lambda
			c := cnt[t] + 1
			if v < best || (v == best && c < bestCnt) {
				best, bestCnt = v, c
			}
		}
		g[j], cnt[j] = best, bestCnt
	}
	return g[n], cnt[n]
}

func aliens(a []int, K int) int64 {
	n := len(a)
	prefix = make([]int64, n+1)
	for i, x := range a {
		prefix[i+1] = prefix[i] + int64(x)
	}
	lo, hi := int64(0), int64(1)<<40
	for lo < hi { // smallest λ with cnt(λ) <= K
		mid := (lo + hi) / 2
		if _, c := solve(n, mid); c <= K {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	f, _ := solve(n, lo)
	return f - lo*int64(K) // recover with TARGET K
}

func main() {
	fmt.Println(aliens([]int{1, 3, 2, 4}, 2)) // 52
}
```

#### Java

```java
public class AliensMiddle {
    static final long INF = 1L << 62;
    static long[] prefix;

    static long cost(int t, int j) {
        long s = prefix[j] - prefix[t];
        return s * s;
    }

    // {f(lambda), segmentCount}; ties → fewer segments
    static long[] solve(int n, long lambda) {
        long[] g = new long[n + 1];
        int[] cnt = new int[n + 1];
        for (int j = 1; j <= n; j++) {
            long best = INF; int bestCnt = 0;
            for (int t = 0; t < j; t++) {
                long v = g[t] + cost(t, j) + lambda;
                int c = cnt[t] + 1;
                if (v < best || (v == best && c < bestCnt)) { best = v; bestCnt = c; }
            }
            g[j] = best; cnt[j] = bestCnt;
        }
        return new long[]{g[n], cnt[n]};
    }

    static long aliens(int[] a, int K) {
        int n = a.length;
        prefix = new long[n + 1];
        for (int i = 0; i < n; i++) prefix[i + 1] = prefix[i] + a[i];
        long lo = 0, hi = 1L << 40;
        while (lo < hi) {
            long mid = (lo + hi) / 2;
            if (solve(n, mid)[1] <= K) hi = mid; else lo = mid + 1;
        }
        long f = solve(n, lo)[0];
        return f - lo * K;
    }

    public static void main(String[] args) {
        System.out.println(aliens(new int[]{1, 3, 2, 4}, 2)); // 52
    }
}
```

#### Python

```python
INF = 1 << 62


def aliens(a, K):
    n = len(a)
    prefix = [0] * (n + 1)
    for i, x in enumerate(a):
        prefix[i + 1] = prefix[i] + x

    def cost(t, j):
        s = prefix[j] - prefix[t]
        return s * s

    def solve(lam):
        g = [0] * (n + 1)
        cnt = [0] * (n + 1)
        for j in range(1, n + 1):
            best, best_cnt = INF, 0
            for t in range(j):
                v = g[t] + cost(t, j) + lam
                c = cnt[t] + 1
                if v < best or (v == best and c < best_cnt):  # fewer segments
                    best, best_cnt = v, c
            g[j], cnt[j] = best, best_cnt
        return g[n], cnt[n]

    lo, hi = 0, 1 << 40
    while lo < hi:                      # smallest λ with cnt(λ) <= K
        mid = (lo + hi) // 2
        _, c = solve(mid)
        if c <= K:
            hi = mid
        else:
            lo = mid + 1
    f, _ = solve(lo)
    return f - lo * K                   # recover with TARGET K


if __name__ == "__main__":
    print(aliens([1, 3, 2, 4], 2))      # 52
```

### Brute-force oracle that builds `opt(k)` and checks convexity

#### Python

```python
def brute_opt(a):
    """Return opt[k] = min cost using exactly k segments, for all k, via O(n^2 * k) DP."""
    INF = 1 << 62
    n = len(a)
    pre = [0] * (n + 1)
    for i, x in enumerate(a):
        pre[i + 1] = pre[i] + x

    def cost(t, j):
        s = pre[j] - pre[t]
        return s * s

    dp = [[INF] * (n + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    for i in range(1, n + 1):
        for j in range(i, n + 1):
            for t in range(i - 1, j):
                if dp[i - 1][t] < INF:
                    dp[i][j] = min(dp[i][j], dp[i - 1][t] + cost(t, j))
    opt = [dp[k][n] for k in range(n + 1)]

    # convexity check: first differences non-decreasing (minimization)
    diffs = [opt[k] - opt[k - 1] for k in range(2, n + 1) if opt[k] < INF and opt[k - 1] < INF]
    for i in range(1, len(diffs)):
        assert diffs[i - 1] <= diffs[i], ("non-convex!", diffs)
    return opt
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `opt(k)` not convex | Tangent line misses `k`; binary search converges to wrong `λ`; wrong answer, no crash. | Prove convexity (Monge/convex cost), or assert non-decreasing increments on a brute `opt(k)`. |
| Recovered with probe's count | On a collinear edge the count ≠ `k`; using it gives the wrong value. | Subtract `λ · k` using the **target** `k`. |
| `cnt(λ)` jumps over `k` | `k` is on a hull edge; no `λ` gives `cnt = k` exactly. | Boundary search (smallest `λ` with `cnt ≤ k`) + target-`k` recovery. |
| Inconsistent tie-break | `cnt(λ)` nondeterministic; search oscillates. | Fix a tie-break (fewer items) in the DP; apply it everywhere. |
| Wrong penalty sign | Used `−λ` for a min problem (or `+λ` for max). | `+λ` per item for min, `−λ` for max; monotonicity must point the right way. |
| Range too narrow | True boundary slope outside `[lo, hi]`. | Bound `hi` by the max possible `|opt(k)−opt(k−1)|`. |
| Float `λ` precision | Count flickers near the boundary; never stabilizes. | Prefer integer `λ` for integer inputs; otherwise fixed iteration count + tolerance. |

---

## Performance Analysis

| `n`, `k` | Naive `O(k · n log n)` (D&C per layer) | Aliens `O(n log(range))` (CHT inner) | speedup |
|----------|----------------------------------------|--------------------------------------|---------|
| `n = 10^4`, `k = 10^3` | ~1.3·10^8 | ~10^4 · 40 = 4·10^5 | ~300× |
| `n = 10^5`, `k = 10^4` | ~1.7·10^{10} | ~10^5 · 40 = 4·10^6 | ~4000× |
| `n = 10^5`, `k = 10^5` | ~1.7·10^{11} (TLE) | ~4·10^6 | feasible |
| `n = 10^6`, `k = 10^6` | infeasible | ~10^6 · 50 = 5·10^7 | feasible |

The Aliens cost is `O(log(range) · DP_cost)`. With `log(range) ≈ 40` integer probes and an `O(n)` CHT-accelerated penalized DP, the total is `O(40 n)` — independent of `k`. That `k`-independence is the entire point: as `k` grows toward `n`, the naive blows up while Aliens stays flat.

The dominant cost is re-running the penalized DP `O(log(range))` times. Because each run is `O(n)` (with CHT) or `O(n log n)` (with D&C), the constant factor is small. The binary search adds only the logarithmic number of repetitions.

```python
# Sanity: n = 2·10^5, k up to n, integer λ search ~45 probes, each O(n) with CHT
# → ~9·10^6 ops, well under a second. The naive O(k·n log n) would be ~10^{11}.
```

The single biggest practical win is making each `f(λ)` cheap (CHT/D&C inner); the second is using **integer `λ`** so the search terminates exactly.

---

## Best Practices

- **Confirm convexity first.** Prove it from the cost structure, or assert non-decreasing increments of a brute-force `opt(k)` on small inputs. Never deploy unverified.
- **Return (value, count)** from the penalized DP and **drive the search by count**.
- **Recover with the target `k`** (`f(λ) − λ·k`), correct even on collinear edges.
- **Use the boundary search** (smallest `λ` with `cnt ≤ k`) so the collinear case "just works."
- **Fix one tie-break** (prefer fewer items) and use it in the DP and the search consistently.
- **Prefer integer `λ`** for integer costs; reserve real `λ` for genuinely continuous problems.
- **Compose the inner DP** with CHT (linear cost) or D&C (Monge cost) to make each probe `O(n)`–`O(n log n)`.
- **Test against an `O(k · n)` oracle** on small inputs, diffing `opt(k)` for every `k`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The convex `opt(k)` bowl with each count `k` as a hull vertex.
> - The slope-`−λ` line pressed up to **tangency**, with the tangent `k` shown as `cnt(λ)`.
> - Decreasing `λ` sliding the tangent point right (more items), increasing `λ` sliding it left.
> - A **collinear edge** demonstration where `cnt(λ)` jumps over interior counts, and the boundary-`λ` recovery still lands on `opt(k)`.
> - The binary search on `λ` shown as a shrinking slope interval, with a per-probe log of `cnt(λ)`.

---

## Summary

The **Aliens trick** is **Lagrangian relaxation** of an exactly-`k` DP: price the count with a multiplier `λ`, solve the count-free penalized DP `f(λ) = min_c ( opt(c) + λ·c )`, and binary-search `λ`. It works because `f(λ)` is the **lower envelope of the lines** `opt(c) + c·λ`, so the selected count `cnt(λ)` is **monotone** in `λ` — *provided* `opt(k)` is **convex** in `k` (each count is a hull vertex). The recovery `opt(k) = f(λ) − λ·k` is **exact** (no duality gap) for convex problems, and must use the **target `k`** so it stays correct even when `k` lies on a **collinear hull edge**, where `cnt(λ)` jumps over `k` and you binary-search the **boundary slope** instead. The trick **removes the count dimension** (`O(k·DP)` → `O(log(range)·DP)`) and **composes** with the Convex Hull Trick (sibling `10`, linear cost) or Divide & Conquer optimization (sibling `12`, Monge cost) to make each `f(λ)` fast — the canonical IOI "Aliens" build. The golden rules: **verify convexity**, **break ties consistently (fewer items)**, **recover with the target `k`**, and **prefer integer `λ`**.

---

**Next step:** [`senior.md`](./senior.md) — applying Aliens to large partition/segmentation/budget problems, combining with CHT/D&C in production, and numerical / integer-`λ` pitfalls at scale.
