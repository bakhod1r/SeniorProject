# Convex Hull Trick (CHT) and Li Chao Tree — Senior Level

> The envelope idea is simple; the production hazards are not. Integer slopes overflow, float intersection points round the wrong way near ties, the "monotone" precondition silently fails on adversarial input, the Li Chao range is mis-sized, and the wrong variant is chosen for the access pattern. Each of these is a correctness or latency incident, and each is preventable with a discipline that this document lays out.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Numeric Overflow with Integer Slopes](#2-numeric-overflow-with-integer-slopes)
3. [Float vs Exact Comparisons](#3-float-vs-exact-comparisons)
4. [Choosing the Right Variant](#4-choosing-the-right-variant)
5. [Li Chao: Range Sizing and Dynamic Nodes](#5-li-chao-range-sizing-and-dynamic-nodes)
6. [Recovering the Argmin / Path Reconstruction](#6-recovering-the-argmin--path-reconstruction)
7. [Testing Strategy](#7-testing-strategy)
8. [Code Examples](#8-code-examples)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At senior level the question stops being "how does the envelope work" and becomes "what breaks when I ship this against real input at scale?". CHT and Li Chao show up in production-adjacent settings — large-`n` DP in competitive programming, cost-minimization layers in batch pipelines, piecewise-linear cost models — and the same three failure axes recur:

1. **Arithmetic** — `m·x` overflows; the cross-multiplied bad-line test overflows even when the answer would not; the `INF` sentinel collides with real values.
2. **Comparison semantics** — floating-point intersection points round inconsistently; ties (equal slopes, coincident lines) are handled differently in insert vs query.
3. **Access pattern assumptions** — the "monotone slopes / monotone queries" precondition of the fast CHT is asserted but not verified, and an adversarial or simply unsorted input produces silently wrong answers.

This document treats each axis in engineering terms, then covers variant selection, range sizing, path reconstruction (which the DP almost always needs), and a testing strategy strong enough to trust the result when the input is too large to brute-force.

The recurring theme is that **CHT/Li Chao bugs are silent**. A corrupted envelope still returns *a* number for every query; an overflow wraps to a plausible-looking value; a violated monotone precondition produces correct answers on the (sorted) test inputs and wrong ones on adversarial production data. There is no exception, no crash, no obviously-bad output — just a quietly wrong DP result. Every practice in this document exists to convert these silent failures into loud, testable, observable ones *before* they reach production: overflow budgets computed up front, preconditions asserted, two structures differentially tested, and the whole DP validated against a brute oracle on small inputs.

---

## 2. Numeric Overflow with Integer Slopes

### 2.1 The evaluation overflow

A line evaluates as `m·x + b`. If `|m| ≤ 10⁹` and `|x| ≤ 10⁹`, then `|m·x| ≤ 10¹⁸`, which is within `int64` (`≈ 9.2·10¹⁸`) but leaves little room. Add `b` (also up to `~10¹⁸` in a DP that accumulates costs) and you can cross the boundary. Mitigations:

- **Bound the product analytically** before coding: compute `max|m| · max|x| + max|b|` and confirm it fits with margin.
- **Use a wider accumulator** (`__int128` in C++, `math/big` or careful `int64` reasoning in Go, `BigInteger` only as a last resort in Java, arbitrary precision free in Python) where the DP value range demands it.
- **Pick `INF` deliberately**: a common choice is `INF = 2·10¹⁸` or `1<<62`, but ensure that `INF` never participates in an arithmetic that overflows (in the Li Chao `at`, guard the sentinel and return `INF` directly rather than computing `m·x+b` on a sentinel line).

### 2.2 The cross-test overflow (the subtle one)

The division-free bad-line test multiplies *differences*:

```
(b3 - b1) * (m1 - m2)   vs   (b2 - b1) * (m1 - m3)
```

Each factor can be `~2·10¹⁸` if intercepts and slopes both span `±10⁹`+accumulated cost, and their **product** is then `~4·10³⁶` — far beyond `int64`. This overflow is insidious because the *final* DP answer fits in 64 bits, so you do not suspect the intermediate. Fixes:

- **128-bit intermediate** for the cross product (`__int128`, or split into hi/lo, or use a big-integer just for the comparison).
- **Compute the intersection x as a rational and compare carefully**, still in 128-bit.
- **In Java**, use `Math.multiplyHigh` / `Math.fma`-style 128-bit emulation, or `BigInteger` for the comparison only (slower but safe).
- **In Go**, use `math/bits.Mul64`/`Add64` for a 128-bit product, or `math/big.Int` for the comparison.

A practical rule: if both slope and intercept ranges exceed `~10⁹`, assume the cross product needs 128 bits and code it that way from the start.

### 2.4 A concrete overflow budget worksheet

Before writing a line of CHT code, fill in this worksheet from the problem constraints:

```
max |slope m|          = M_m      (e.g. 2*max|x_j|  for the (x_i-x_j)^2 transition)
max |query x|          = X        (e.g. max|x_i|)
max |intercept b|      = M_b      (e.g. max dp value + max x_j^2)
evaluation  |m*x + b|  = M_m * X + M_b           must fit in the eval type
cross-test  product    = (2*M_b) * (2*M_m)       must fit in the compare type
```

For `|x| ≤ 10⁶` and a DP value up to `~10¹⁵`: evaluation is `2·10⁶ · 10⁶ + 10¹⁵ ≈ 3·10¹⁵`, comfortably inside `int64`. But the cross product is `(2·10¹⁵)·(4·10⁶) ≈ 8·10²¹` — **already past `int64`** (`9.2·10¹⁸`). So even at modest coordinate ranges, the CHT cross test needs care once DP values grow large. This worksheet, done once, tells you exactly which operations need a wider type and whether Li Chao (no cross product) sidesteps the issue entirely.

### 2.3 Li Chao avoids the cross-test overflow

The Li Chao tree never computes intersection points — it only *evaluates* lines at integer midpoints and compares the two values. So it is subject to the **evaluation** overflow (Section 2.1) but **not** the cross-product overflow (Section 2.2). This is a real reason to prefer Li Chao when coefficient ranges are large: fewer overflow surfaces.

---

## 3. Float vs Exact Comparisons

### 3.1 Why floats break the CHT

The textbook bad-line test divides to get an intersection x:

```
x(L1, L2) = (b2 - b1) / (m1 - m2)
```

Comparing two such floating-point x-values fails near ties: when three lines nearly concur, the rounded comparison can pop a line that should stay (or keep one that should go), corrupting the envelope. The corruption is *silent* — the structure still returns *an* answer, just the wrong one on some queries. Always prefer the **cross-multiplied integer** comparison (Section 2.2), which is exact.

### 3.2 When floats are unavoidable

If slopes/intercepts are genuinely real-valued (e.g. a continuous cost model), you cannot cross-multiply into exact integers. Then:

- Use a **tolerance** `eps` in the comparison, chosen relative to the data magnitude (`eps ≈ 1e-9 · scale`), not an absolute constant.
- Prefer **Li Chao**, which only evaluates and compares line *values* (one subtraction), avoiding the more error-prone intersection division entirely. The numerical error in a single `m·x+b` is far more controllable than in a quotient near a near-degenerate intersection.
- Consider **rationalizing**: scale all inputs by a common denominator to make them integers, if the problem permits.

### 3.3 Tie handling must be consistent

Two lines with equal slope never cross; keep the one with the smaller intercept (for min). Coincident lines (same `m` and `b`) are harmless duplicates. The danger is handling ties one way during `insert` and another during `query` — e.g. `<` in one and `≤` in the other — which can make the pointer/binary-search land on a line that the insert logic considered dominated. Use the **same strict/non-strict convention everywhere**, and document it.

### 3.4 Equal-slope insertion in the monotone CHT

The monotone CHT inserts slopes in (say) non-increasing order, so equal consecutive slopes are possible. When the new line has the *same* slope as the deque's back line, they are parallel: only the one with the smaller intercept can ever be on the lower envelope. The clean fix is to **drop the new line if its intercept is not strictly better**, or replace the back line if it is — *before* running the bad-line test (whose denominator `m1 − m2` would be zero for equal slopes and must never be reached). Implementations that forget this either divide by zero (float version) or feed a zero factor into the cross product (integer version), corrupting the test. Pre-filtering equal slopes is a two-line guard that removes an entire class of edge-case bugs.

---

## 4. Choosing the Right Variant

A decision procedure, in priority order:

1. **Are slopes inserted in monotone order AND queries in monotone order?**
   → Monotone deque CHT with a moving pointer. Amortized `O(1)`, smallest constants. *But verify the precondition* (Section 7.2) — do not assume.
2. **Monotone slopes, arbitrary queries?**
   → Monotone deque CHT with binary-search queries. `O(log n)` per query.
3. **Arbitrary slopes, but no range-restricted segments, and you trust your BST code?**
   → Dynamic CHT (`LineContainer`-style). `O(log n)`.
4. **Anything else — arbitrary order, segments, large coefficients, want robustness?**
   → **Li Chao tree** (static if `C` is small, dynamic/lazy if `C` is huge). `O(log C)`. This is the default for non-trivial production use because it has the fewest sharp edges.

Secondary considerations:

- **Coefficient magnitude:** large coefficients favor Li Chao (no cross-product overflow).
- **Coordinate range vs line count:** if `C` (coordinate range) ≫ `n` (lines), the `log C` of Li Chao may exceed the `log n` of a dynamic CHT — but coordinate compression often shrinks `C` to `O(n)`.
- **Memory:** static Li Chao preallocates `~4C` nodes; dynamic Li Chao uses `O((n+Q) log C)`.
- **Need to delete lines?** None of these support deletion cleanly; if you need a *sliding window* of lines, that is the much harder "fully dynamic / kinetic" regime — usually solved by offline divide-and-conquer over time rather than an online structure.

### 4.1 The offline-over-time pattern for deletions

When lines have an active *time interval* `[t_in, t_out)` and queries happen at specific times, simulate deletions offline:

1. Build a segment tree over the **time** axis `[0, T)`.
2. Insert each line into the `O(log T)` canonical time-nodes whose intervals are covered by `[t_in, t_out)`.
3. DFS the time tree, maintaining a Li Chao tree: on entering a node, push that node's lines; answer queries at the leaves; on leaving, pop (or, more practically, use a rollback/persistent Li Chao or rebuild per branch).

Each line participates in `O(log T)` nodes, and each query is answered against exactly the lines active at its time — without any online deletion. Total `O((#lines + #queries) · log T · log C)`. This is Task 13 in [`tasks.md`](./tasks.md), and the canonical way to handle "lines come and go" with structures that only support insertion.

---

## 5. Li Chao: Range Sizing and Dynamic Nodes

### 5.1 Sizing `[xlo, xhi]`

A static Li Chao tree must cover **every query x-coordinate**. If a query falls outside `[xlo, xhi]`, you read a node that was never updated for that region and get a wrong (often sentinel) value. Two approaches:

- **Coordinate compression:** collect all query x-values up front, sort/unique them, and build the tree over the compressed indices. This shrinks `C` to the number of distinct queries and removes the "range too small" risk entirely. It requires offline queries (all known in advance).
- **Wide fixed range:** set `[xlo, xhi]` to the full theoretical range (e.g. `[-10⁹, 10⁹]`). Safe online, but uses `log C ≈ 31` and, if static, infeasible memory (`4·2·10⁹` nodes) — so a wide range *forces* dynamic (lazy) node allocation.

### 5.2 Dynamic (lazy) nodes

For a huge range, allocate child nodes only when an insert descends into them. Memory becomes `O((#inserts) · log C)`. This is the version to ship for online queries over a large coordinate domain; the code examples in [`middle.md`](./middle.md) already use lazy `-1` children for exactly this reason.

### 5.3 Midpoint computation

Use `mid = l + (r - l) / 2`, not `(l + r) / 2`, to avoid overflow when `l + r` exceeds the integer range (e.g. `l, r` near `±10⁹` summing past `2·10⁹` is fine for `int64` but the habit matters for `int32` and for negative ranges where `(l+r)/2` rounds toward zero inconsistently).

### 5.4 Static node-pool sizing

A static Li Chao tree over a domain of size `C` and depth `d = ⌈log₂ C⌉` needs a node pool sized for the worst-case structure. For a recursive pointer layout, `4C` nodes is the safe upper bound; for a compressed-coordinate domain of `m` distinct points, `4m` suffices. Under-sizing the pool is a classic crash (index out of bounds) or silent corruption (overwriting another node). For a **dynamic** tree, the pool grows by at most one node per level per insert, so `~(#inserts)·d` nodes — size the pool to that, with margin. A guard that asserts `next < cap` before allocating turns a silent overflow into a clear failure during testing.

### 5.5 Recursion depth

A recursive Li Chao insert/query recurses to depth `d = ⌈log₂ C⌉` — about `31` for `C = 2·10⁹`. This is shallow and safe in Go and Java, but in Python the default recursion limit (`1000`) is comfortably above `31`, so the only Python concern is the constant overhead of recursion; an iterative query (as in the `middle.md` examples) shaves it. For very deep custom domains, prefer the iterative query and an explicit stack for insert.

---

## 6. Recovering the Argmin / Path Reconstruction

A DP usually needs not just the optimal *value* but the optimal *decision* — which `j` achieved `dp[i] = min_j(...)`. The envelope structures return the value; to recover the argmin:

- **Store, alongside each line, the index `j` that created it.** When a query reads the best line, it also yields the originating `j`. For the Li Chao tree, attach `j` to each node's line. For CHT, store `j` with each `(m, b)`.
- **Then backtrack:** keep `parent[i] = j` for each state, and walk back from the final state to reconstruct the path/decisions.

This adds `O(1)` per line and `O(n)` reconstruction, and is essential in scheduling/partitioning problems where the *partition*, not its cost, is the deliverable. A subtlety: with tie-breaking, the argmin you recover is the one your comparison convention prefers — if the problem requires a *specific* tie-break (lexicographically smallest partition, say), encode that into the comparison.

### 6.1 Reconstruction example

For the partition DP `dp[i] = min_{j<i}(dp[j] + (x[i]-x[j])²) + cost[i]`, store `(m_j, b_j, j)` per line. When computing `dp[i]`, the envelope query returns both the value and the `j` that produced the winning line; set `parent[i] = j`. After the table is filled, walk `i = n-1, parent[n-1], parent[parent[n-1]], …` until reaching the base state `0`; reversing that list gives the chosen partition boundaries. The reconstructed partition's recomputed cost must equal `dp[n-1]` — a built-in correctness assertion. Note the argmin returned under a tie depends on which equal-cost line the structure happened to store; if the spec demands "fewest segments" or "lexicographically smallest", augment the comparison to prefer the line that yields that property, consistently in both insert and query.

---

## 7. Testing Strategy

A CHT/Li Chao result is opaque: one wrong entry looks like any other number. Build verification in from the start.

### 7.1 The brute-force oracle

The single most valuable test: a `min_j(m_j·x+b_j)` loop. For random sets of `n ≤ 200` lines and random query x-values (including extremes, ties, equal slopes, and out-of-pattern orders), assert the fast structure matches the oracle on *every* query. This catches the overwhelming majority of bugs: sign errors in the bad-line test, min/max confusion, off-by-one in the pointer, and Li Chao recursion-side mistakes.

### 7.2 Precondition assertions for the monotone CHT

The monotone CHT is correct *only* if slopes are inserted monotone and (for the pointer) queries are monotone. In debug builds, **assert** these:

```text
assert: each inserted slope is <= the previous inserted slope   (non-increasing)
assert: each query x is >= the previous query x                 (non-decreasing)
```

An adversarial or merely unsorted input that violates these produces silently wrong answers in release; the assertion turns a silent corruption into a loud failure during testing.

### 7.3 Property tests

| Property | Why |
|----------|-----|
| Matches brute oracle on random inputs | Catches nearly all logic bugs. |
| Query at a line's "obviously best" x returns that line | Sanity for insert correctness. |
| Adding a strictly dominated line never changes any query result | Verifies bad-line pruning. |
| Adding a strictly dominating line lowers (or keeps) every min query | Monotonicity of the envelope under insertion. |
| Min structure + negation equals a separately written max structure | Catches sign convention drift. |
| Determinism across Go/Java/Python on the same seed | Cross-language consistency. |

### 7.4 Stress against the wider DP

Beyond the structure itself, test the *whole DP*: brute-force the `O(n²)` DP on small `n` and compare to the CHT-accelerated `O(n log n)` version. This catches transition-linearization mistakes (a wrong `m_j` or `b_j`) that the structure-only oracle cannot, because the structure is fed whatever lines you give it — if those lines are wrong, the structure faithfully returns the wrong answer.

### 7.5 Cross-structure differential testing

A particularly strong test runs **two independent implementations** — a min-CHT and a Li Chao tree — on the same random line/query stream and asserts they return identical values on every query. They compute the same mathematical quantity (the envelope minimum) through completely different mechanisms (slope-ordered deque vs midpoint-keyed segment tree), so a bug in one is overwhelmingly unlikely to be mirrored in the other. When they disagree, the brute oracle breaks the tie and localizes the fault. This catches subtle bugs that a single-structure-vs-oracle test can miss when the oracle and the structure happen to share a flawed assumption (e.g. both mis-handling a tie the same way).

### 7.6 What to log in production

For a service answering envelope queries at scale, log: the **structure variant** chosen per request (to catch a config that silently fell back to the wrong one); a **periodic invariant check** (e.g. re-run a handful of queries against the brute oracle on a shadow copy); the **node count** of any dynamic Li Chao tree (a runaway count signals a missing coordinate compression); and an **overflow guard** that asserts evaluated values stay within `[−INF/2, INF/2]`. These turn the otherwise-opaque "wrong number" failures into observable, alertable events.

---

## 8. Code Examples

### 8.1 Go — 128-bit safe bad-line test for the monotone CHT

```go
package main

import (
	"fmt"
	"math/bits"
)

// signedMulCmp compares a*b vs c*d for int64 operands using 128-bit products,
// returning -1, 0, or 1. Avoids the cross-product overflow of the bad-line test.
func signedMulCmp(a, b, c, d int64) int {
	neg := false
	ua, ub, uc, ud := uint64(a), uint64(b), uint64(c), uint64(d)
	if a < 0 {
		ua = uint64(-a)
		neg = !neg
	}
	if b < 0 {
		ub = uint64(-b)
		neg = !neg
	}
	hi1, lo1 := bits.Mul64(ua, ub)
	negCD := false
	if c < 0 {
		uc = uint64(-c)
		negCD = !negCD
	}
	if d < 0 {
		ud = uint64(-d)
		negCD = !negCD
	}
	hi2, lo2 := bits.Mul64(uc, ud)
	// compare signed magnitudes
	sgn := func(neg bool) int {
		if neg {
			return -1
		}
		return 1
	}
	s1, s2 := sgn(neg), sgn(negCD)
	if s1 != s2 {
		if s1 < s2 {
			return -1
		}
		return 1
	}
	// same sign: compare magnitudes, then apply sign
	cmpMag := 0
	if hi1 != hi2 {
		if hi1 < hi2 {
			cmpMag = -1
		} else {
			cmpMag = 1
		}
	} else if lo1 != lo2 {
		if lo1 < lo2 {
			cmpMag = -1
		} else {
			cmpMag = 1
		}
	}
	return s1 * cmpMag
}

type Line struct{ m, b int64 }

// bad: is l2 (middle) useless given l1 (before) and l3 (after)?
// (b3-b1)*(m1-m2) <= (b2-b1)*(m1-m3)
func bad(l1, l2, l3 Line) bool {
	c := signedMulCmp(l3.b-l1.b, l1.m-l2.m, l2.b-l1.b, l1.m-l3.m)
	return c <= 0
}

func main() {
	a := Line{-2, 3}
	b := Line{-1, 1}
	c := Line{0, 0}
	fmt.Println("is b bad given a,c?", bad(a, b, c)) // overflow-safe comparison
}
```

### 8.2 Java — Li Chao with attached argmin index for reconstruction

```java
import java.util.*;

public class LiChaoArgmin {
    static final long INF = (long) 4e18;
    long xlo, xhi;
    long[] M, B; int[] J, lc, rc; int next = 1;

    LiChaoArgmin(long xlo, long xhi, int cap) {
        this.xlo = xlo; this.xhi = xhi;
        M = new long[cap]; B = new long[cap]; J = new int[cap];
        lc = new int[cap]; rc = new int[cap];
        Arrays.fill(B, INF); Arrays.fill(J, -1);
        Arrays.fill(lc, -1); Arrays.fill(rc, -1);
    }

    long at(int node, long x) { return B[node] == INF ? INF : M[node] * x + B[node]; }

    void insert(int node, long l, long r, long m, long b, int j) {
        long mid = l + (r - l) / 2;
        boolean left = (m * l + b) < at(node, l);
        boolean midB = (m * mid + b) < at(node, mid);
        if (midB) {
            long tm = M[node], tb = B[node]; int tj = J[node];
            M[node] = m; B[node] = b; J[node] = j;
            m = tm; b = tb; j = tj;
        }
        if (l == r || b == INF) return;
        if (left != midB) {
            if (lc[node] == -1) lc[node] = next++;
            insert(lc[node], l, mid, m, b, j);
        } else {
            if (rc[node] == -1) rc[node] = next++;
            insert(rc[node], mid + 1, r, m, b, j);
        }
    }

    void add(long m, long b, int j) { insert(0, xlo, xhi, m, b, j); }

    // returns {value, argmin index}
    long[] query(long x) {
        int node = 0; long l = xlo, r = xhi, best = INF; int arg = -1;
        while (node != -1) {
            long v = at(node, x);
            if (v < best) { best = v; arg = J[node]; }
            long mid = l + (r - l) / 2;
            if (x <= mid) { node = lc[node]; r = mid; }
            else { node = rc[node]; l = mid + 1; }
        }
        return new long[]{best, arg};
    }

    public static void main(String[] args) {
        LiChaoArgmin t = new LiChaoArgmin(-10, 10, 200);
        t.add(2, 5, 0);
        t.add(-1, 4, 1);
        t.add(0, 0, 2);
        long[] r = t.query(3);
        System.out.println("min=" + r[0] + " from line index " + r[1]);
    }
}
```

### 8.3 Python — full DP with CHT plus brute-force DP oracle (transition test)

```python
INF = float("inf")


def dp_brute(x, cost):
    """dp[i] = min_{j<i} ( dp[j] + (x[i]-x[j])^2 ) + cost[i];  dp[0]=cost[0]."""
    n = len(x)
    dp = [INF] * n
    dp[0] = cost[0]
    for i in range(1, n):
        for j in range(i):
            dp[i] = min(dp[i], dp[j] + (x[i] - x[j]) ** 2 + cost[i])
    return dp[n - 1]


class CHTMin:
    """slopes inserted non-increasing; queries non-decreasing."""
    def __init__(self):
        self.ms, self.bs = [], []
        self.ptr = 0

    def _bad(self, m1, b1, m2, b2, m3, b3):
        return (b3 - b1) * (m1 - m2) <= (b2 - b1) * (m1 - m3)

    def add(self, m, b):
        while len(self.ms) >= 2 and self._bad(self.ms[-2], self.bs[-2],
                                              self.ms[-1], self.bs[-1], m, b):
            self.ms.pop(); self.bs.pop()
        self.ms.append(m); self.bs.append(b)
        self.ptr = min(self.ptr, len(self.ms) - 1)

    def query(self, x):
        at = lambda i: self.ms[i] * x + self.bs[i]
        while self.ptr + 1 < len(self.ms) and at(self.ptr + 1) <= at(self.ptr):
            self.ptr += 1
        return at(self.ptr)


def dp_cht(x, cost):
    # x must be sorted for slopes (-2*x_j) to be non-increasing.
    n = len(x)
    dp = [0] * n
    dp[0] = cost[0]
    cht = CHTMin()
    cht.add(-2 * x[0], dp[0] + x[0] ** 2)  # line for j=0
    for i in range(1, n):
        dp[i] = x[i] ** 2 + cost[i] + cht.query(x[i])
        cht.add(-2 * x[i], dp[i] + x[i] ** 2)
    return dp[n - 1]


if __name__ == "__main__":
    import random
    for _ in range(2000):
        n = random.randint(1, 8)
        x = sorted(random.randint(0, 20) for _ in range(n))
        cost = [random.randint(0, 10) for _ in range(n)]
        assert dp_cht(x, cost) == dp_brute(x, cost), (x, cost)
    print("all random DP tests passed")
```

The Python example tests the *entire DP*, not just the structure — exactly the Section 7.4 discipline. It will catch a wrong slope/intercept derivation that a structure-only test would miss.

---

## 9. Failure Modes

### 9.1 Cross-product overflow

The bad-line test's products exceed 64 bits even when the DP answer fits. Symptom: wrong pops, corrupted envelope, sporadically wrong queries. Mitigation: 128-bit intermediate (Section 2.2), or use Li Chao which never multiplies differences.

### 9.2 Float intersection rounding

Computing intersection x as a float and comparing near-degenerate values pops the wrong line. Symptom: rare wrong answers that vanish when you perturb inputs. Mitigation: exact cross-multiplied integer comparison; if forced into floats, use a scaled tolerance and prefer Li Chao.

### 9.3 Unverified monotone precondition

The monotone CHT is used on input whose slopes or queries are not actually sorted. Symptom: wrong answers on some inputs, correct on others (the sorted ones). Mitigation: assert the precondition in debug; fall back to Li Chao when order is not guaranteed.

### 9.4 Min/max sign confusion

Lower-envelope logic applied to a max query (or stale comparisons after a copy-paste from a min template). Symptom: answers are the *negation* or a different extreme. Mitigation: negate `(m, b)` and the answer for max; never hand-edit comparison directions.

### 9.5 Li Chao range too small / mis-sized

A query falls outside `[xlo, xhi]`, or the static node array is too small for the number of inserts. Symptom: sentinel/garbage values, or index-out-of-bounds. Mitigation: coordinate-compress, or use a wide range with dynamic nodes; size the node pool to `~4C` (static) or count inserts (dynamic).

### 9.6 Forgotten `i`-only term

The `x_i²` (or other term depending only on `i`) is left *inside* the min instead of factored out and added back. Symptom: systematically wrong DP values that still "look plausible". Mitigation: the whole-DP brute oracle (Section 7.4) catches this immediately.

### 9.7 Argmin not tracked

The DP needs the partition/decision but the structure only returns the value. Symptom: correct cost, no way to output the solution. Mitigation: attach the originating index `j` to each line and backtrack (Section 6).

### 9.8 Sentinel arithmetic overflow

A "no line" sentinel stored as `(0, INF)` is evaluated as `0·x + INF` and then added to another large value, overflowing. Symptom: huge negative numbers from wraparound. Mitigation: guard the sentinel in `at()` and return `INF` directly; keep `INF` comfortably below the overflow threshold.

### 9.9 Worked failure: the silent cross-product overflow

Concretely, take two candidate envelope triples with `b`-values around `10¹⁵` and slopes around `10⁶`. The cross product `(b3−b1)(m1−m2)` is about `(2·10¹⁵)·(2·10⁶) = 4·10²¹`. In signed `int64` this wraps around to a pseudo-random value in `[−2⁶³, 2⁶³)`. The bad-line comparison `lhs ≤ rhs` then compares two *garbage* numbers, popping or keeping lines arbitrarily. The corrupted deque still answers queries (returning *some* line's value), so the final DP value is merely *wrong*, not crashing — and on small test inputs (where products stay small) it is *correct*, so the bug ships. This is the archetypal "passes the small tests, fails in production" CHT failure, and the reason the overflow-budget worksheet (Section 2.4) and the 128-bit cross test (Section 8.1 Go example) are non-negotiable once DP values are large.

### 9.10 Worked failure: querying before seeding the base line

If the DP loop queries `dp[i]` before the base line for `dp[0]` (or the smallest valid `j`) has been inserted, the structure is empty and returns the `INF` sentinel; `dp[i]` then becomes `INF + g(i)`, which either overflows or propagates `INF` through the whole table, producing a final answer of `INF` or garbage. Mitigation: insert the base-case line(s) *before* the first dependent query, and assert the structure is non-empty at query time in debug builds.

---

## 10. Summary

- **Two overflow surfaces:** evaluating `m·x` (both CHT and Li Chao) and the cross-product in the bad-line test (CHT only). When coefficients exceed `~10⁹`, use 128-bit intermediates for the cross test — or prefer Li Chao, which never computes it.
- **Exact over float:** cross-multiply the bad-line test into integers; floating intersection points round inconsistently near ties and silently corrupt the envelope. If reals are unavoidable, use a scaled tolerance and lean on Li Chao's evaluate-and-compare simplicity.
- **Choose by access pattern:** monotone slopes + monotone queries → deque CHT with pointer (`O(1)`); monotone slopes only → CHT + binary search; arbitrary order → Li Chao (the robust default). Verify the monotone precondition with assertions — never assume it.
- **Size Li Chao deliberately:** coordinate-compress for offline queries, or use a wide range with dynamic (lazy) nodes for online large-domain queries; use `mid = l + (r-l)/2`.
- **Track the argmin** by attaching the originating state index to each line; backtrack to reconstruct the partition the DP actually needs.
- **Test in layers:** a structure-level brute oracle on random lines, monotone-precondition assertions, envelope property tests, and a *whole-DP* brute oracle to catch transition-linearization errors. The whole-DP oracle is the one that catches the forgotten `x_i²` and the wrong slope.

### Decision summary

- **Large `n`, monotone slopes & queries** → monotone deque CHT, `O(n)`.
- **Monotone slopes, arbitrary queries** → CHT + binary search, `O(n log n)`.
- **Arbitrary order, robustness, large coefficients, or segments** → Li Chao tree, `O(n log C)`.
- **Need the partition, not just the cost** → attach argmin index, backtrack.
- **Cost does not linearize but argmin is monotone** → divide-and-conquer optimization (sibling `08`).
- **Interval DP with quadrangle inequality** → Knuth (sibling `09`).
- **Lines come and go over time** → offline divide-and-conquer over time + Li Chao (Section 4.1).
- **Real-valued coefficients** → Li Chao with a scaled tolerance; avoid intersection-based CHT.
- **Large coefficients (DP values past `~10⁹`)** → Li Chao (no cross product) or 128-bit cross test.

### Pre-ship checklist

1. Filled the overflow-budget worksheet (Section 2.4); chose eval and compare types accordingly.
2. Used the cross-multiplied integer test (or Li Chao) — no float intersections in the hot path.
3. Picked min/max via negation, not hand-flipped comparisons.
4. Asserted the monotone precondition (if using the monotone CHT) in debug builds.
5. Seeded the base line before the first dependent query.
6. Sized the Li Chao node pool (static `4C`/`4m`, or dynamic `(#inserts)·d`) and the coordinate range to cover all queries.
7. Validated the *whole DP* against the `O(n²)` brute oracle on small `n`, and differentially tested CHT vs Li Chao.
8. Attached the argmin index if the partition is the deliverable.

Run this checklist on every CHT/Li Chao change. Each item maps to a silent-failure mode (Section 9) and converts it into something caught before production: items 1–2 catch overflow, 3–4 catch min/max and precondition bugs, 5 catches the empty-structure query, 6 catches range/memory errors, 7 catches transition-linearization mistakes, and 8 ensures the DP can actually emit its required output. The single highest-value item is 7 — the whole-DP brute oracle — because it is the only check that validates the *lines you feed in*, not merely the structure that consumes them.
