# Convex Hull Trick (CHT) and Li Chao Tree — Middle Level

> **Focus:** the three concrete data structures — monotone deque CHT (amortized `O(1)`), dynamic CHT for arbitrary slope order (`O(log n)`), and the Li Chao segment tree (`O(log C)`) — when each applies, how min/max and lines/segments change the code, and how CHT compares to its sibling DP optimizations (divide-and-conquer and Knuth).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The Monotone Deque CHT](#the-monotone-deque-cht)
4. [The Dynamic / General CHT](#the-dynamic--general-cht)
5. [The Li Chao Tree](#the-li-chao-tree)
6. [Min vs Max, Lines vs Segments](#min-vs-max-lines-vs-segments)
7. [Comparison with D&C and Knuth Optimization](#comparison-with-dc-and-knuth-optimization)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was: a transition `dp[i] = min_j (m_j·x_i + b_j)` is a query against the **lower envelope** of lines, and the Convex Hull Trick keeps only the envelope lines so queries are fast. At middle level you start choosing *which* data structure to build, because the right choice depends entirely on the input's structure:

- Are the **slopes** inserted in monotone (sorted) order? If yes, a deque suffices.
- Are the **query x-values** monotone? If yes, a moving pointer makes queries amortized `O(1)`; if no, you binary-search the deque.
- Is *neither* monotone — lines added in arbitrary slope order, queries at arbitrary points? Then you need either a balanced-BST "dynamic CHT" or, more simply, a **Li Chao tree**.

These three structures all solve the same envelope problem with different trade-offs, and knowing when each applies — plus how min/max and "add a line" vs "add a segment" change the code — is the core middle-level skill. We also place CHT next to its siblings: **divide-and-conquer optimization** and **Knuth optimization** attack *different* transition shapes, and recognizing which optimization a problem wants is half the battle.

---

## Deeper Concepts

### The envelope, restated precisely

Given lines `L_j(x) = m_j·x + b_j`, the **lower envelope** is `env(x) = min_j L_j(x)`. Three facts drive every implementation:

1. **`env` is convex** (a pointwise minimum of linear functions is concave for max / convex for min — for the *minimum* of lines it is concave, but the *winning-line index* is monotone in `x`; the curve bends upward at breakpoints). The breakpoints (where the winning line changes) occur at line intersections.
2. **On the envelope, lines appear sorted by slope.** As `x → +∞`, the line with the smallest slope wins the minimum; as `x → −∞`, the largest slope wins.
3. **A line is on the envelope iff there is some `x` where it is the unique minimum.** Equivalently, it is *not* dominated by any combination of two other lines.

### The bad-line (middle-line) test

When you have three lines `L1, L2, L3` in slope order and want to know whether the *middle* one `L2` ever wins, compare two intersection x-values:

```
x(L1, L2) = (b2 - b1) / (m1 - m2)    // where L1 and L2 cross
x(L1, L3) = (b3 - b1) / (m1 - m3)    // where L1 and L3 cross
```

If `x(L1, L3) ≤ x(L1, L2)`, then by the time `L1` would hand off to `L2`, `L3` has already taken over — so `L2` never wins and is **bad** (remove it). To avoid floating point, **cross-multiply** (being careful with the sign of the denominators, which the monotone ordering keeps consistent):

```
(b3 - b1) * (m1 - m2)  ≤  (b2 - b1) * (m1 - m3)   →  L2 is bad
```

This single inequality is the engine of both the monotone deque and the dynamic CHT. The full correctness argument is in [`professional.md`](./professional.md).

### Worked bad-line decision

Take three lines `L1:(m=2,b=0)`, `L2:(m=0,b=1)`, `L3:(m=-2,b=0)` (decreasing slopes). Compute the two products:

```
(b3 - b1)(m1 - m2) = (0 - 0)(2 - 0) = 0
(b2 - b1)(m1 - m3) = (1 - 0)(2 - (-2)) = 4
0 <= 4  → L2 is bad, pop it.
```

Sanity check: at `x = 0.5`, `L1 = 1`, `L2 = 1`, `L3 = -1` — `L3` already beats `L2`, so `L2` never wins; the test correctly pops it. Now lower `L2` to `b = -2`: `(b2-b1)(m1-m3) = (-2)(4) = -8`, and `0 <= -8` is **false**, so `L2` is kept — and indeed at `x = 0`, `L2 = -2` beats both others. The single inequality decides envelope membership with pure integer arithmetic.

### Why the deque, not just a stack

A plain stack supports push and pop-from-back, which is all the monotone CHT needs when slopes go one way and queries go the other (the common case). You need a true **deque** (pop from *both* ends) only in the rarer "Li-Chao-free" setup where you must also discard lines from the *front* — for instance when queries arrive in *decreasing* `x` while slopes are inserted in the matching direction, so the front of the envelope becomes irrelevant. Most contest templates use a stack plus a forward pointer; reach for the double-ended version only when the access pattern genuinely requires front removal.

---

## The Monotone Deque CHT

**Preconditions:** lines inserted with **monotone slopes** (say non-increasing for min), and queries either monotone (pointer) or arbitrary (binary search).

**Insert:** push the new line to the back of a deque; while the last *two* existing lines plus the new one show the middle is bad, pop the back. Amortized `O(1)` because each line is pushed and popped at most once.

**Query (monotone x, pointer):** keep an index `ptr`. While the next line is `≤` the current one at `x`, advance `ptr`. Amortized `O(1)` because `ptr` only moves forward across all queries.

**Query (arbitrary x, binary search):** the deque's lines have monotone slopes, so their pairwise breakpoints are sorted; binary-search for the segment containing `x`. `O(log n)`.

The deque (rather than a plain stack) is needed only when you must also *remove from the front* — e.g. when the query x-values are decreasing and you process lines in the other slope direction. In the most common contest setup (slopes one way, queries the other) a stack plus a forward pointer is enough.

---

## The Dynamic / General CHT

When slopes arrive in **arbitrary** order, you cannot just push/pop a deque, because a newly inserted line might belong in the *middle* of the slope order. The dynamic CHT stores lines in a balanced BST / ordered map keyed by slope, and on insert:

1. Find the neighbors by slope.
2. Check whether the new line is dominated by its neighbors (if so, discard it).
3. Otherwise insert it, then repeatedly remove now-bad neighbors on the left and right using the same middle-line test.

Each insert touches `O(1)` amortized neighbors but costs `O(log n)` for the BST operations; queries binary-search the breakpoints in `O(log n)`. This is powerful but fiddly — the C++ `LineContainer` (a famous `std::multiset`-based implementation) is the canonical example. For most purposes the **Li Chao tree is simpler and just as asymptotically good**, which is why many practitioners reach for it instead.

---

## The Li Chao Tree

A Li Chao tree is a segment tree over the discretized x-range `[xlo, xhi]`. Each node owns a sub-interval and stores **one line** — the line that is lowest at that node's midpoint (for min queries). The invariant: at every node, the stored line is the best among all inserted lines *at the node's midpoint*, and the true best line for any `x` is found somewhere on the root-to-leaf path to `x`.

**Insert a line `f`:** at a node covering `[l, r]` with midpoint `m`, current line `g`:
- Compare `f(m)` and `g(m)`; keep the lower as the node's line, call the other `f` (the "loser").
- The loser can only beat the winner on *one* side (left or right of `m`), because two lines cross at most once. Recurse the loser into that side.
- Stop at leaves. Each insert touches one node per level → `O(log C)`.

**Query at `x`:** walk root-to-leaf toward `x`, taking the minimum of the line stored at every node visited. `O(log C)`.

No slope sorting, no monotone-query requirement, lines and queries fully interleaved — this robustness is the Li Chao tree's whole selling point. The cost is a `log C` factor tied to the coordinate range (vs `log n` tied to the number of lines), and a slightly larger constant than a tuned monotone CHT.

**Dynamic Li Chao:** if `C` is huge (e.g. `x` up to `10⁹`), allocate child nodes lazily instead of preallocating `2C` nodes. This keeps memory at `O((n+Q) log C)`.

### Walking through a Li Chao insert

Domain `[0, 7]`, root midpoint `3`. Insert `f = 0·x + 5` (the node was empty, so `f` is stored). Now insert `g = 2·x + 0`:

- At the root midpoint `x = 3`: `g(3) = 6` vs `f(3) = 5`. `f` is lower, so `f` stays at the root and `g` is the "loser".
- Where can `g` still win? Check the left endpoint `x = 0`: `g(0) = 0 < f(0) = 5`. So `g` is lower on the left — recurse `g` into the left child `[0, 3]`.
- In `[0, 3]` (empty), `g` is stored.

A query at `x = 0` walks root → left child, taking the min of `f(0) = 5` and `g(0) = 0`, returning `0` — correct, since `g` is the lower line at `x = 0`. The descent touched one node per level (`O(log C)`), and the loser escaped into exactly one child because two lines cross at most once. That "cross at most once" fact is the whole reason the insert is `O(log C)` rather than `O(C)`.

---

## Min vs Max, Lines vs Segments

### Min vs Max

The default presentation is **min** (lower envelope). For **max** (upper envelope):

- **Negate:** insert `(-m, -b)`, query the min structure, negate the result. `max_j(m_j x + b_j) = -min_j(-m_j x - b_j)`. This is the safest, least error-prone approach — write the min structure once and never touch the comparison logic.
- **Flip comparisons:** change `<` to `>` (and reverse slope-ordering) throughout. Faster to read but easier to get subtly wrong.

### Lines vs Segments

Sometimes a line is only valid on a *sub-range* of `x` — for instance, state `j` can only transition to states `i` with `x_i` in some interval. Then you are inserting a **segment** `(m, b)` valid on `[lo, hi]`, not a full line.

- **CHT** does not naturally support segments — its envelope assumes every line spans all `x`.
- **Li Chao tree** supports segment insertion: descend to the `O(log C)` canonical nodes covering `[lo, hi]` (exactly as a segment tree decomposes a range), and run the line-insert procedure within each of those subtrees. Cost rises to `O(log² C)` per segment insert (because each of `O(log C)` canonical nodes does an `O(log C)` line insert), while queries stay `O(log C)`.

This makes the Li Chao tree strictly more general than CHT: it handles arbitrary order *and* range-restricted lines.

### A note on the negation trick for max

The negation recipe `max_j(m_j x + b_j) = -min_j(-m_j x - b_j)` is worth internalizing with a concrete check. Lines `y = x`, `y = -x`, `y = 3`. The max at `x = -5, 0, 5` is `max(|x|, 3) = 5, 3, 5`. Insert the negated lines `(-1, 0), (1, 0), (0, -3)` into a min structure: at `x = -5`, `min(5, -5, -3) = -5`, negate to `5`. At `x = 0`, `min(0, 0, -3) = -3`, negate to `3`. At `x = 5`, `min(-5, 5, -3) = -5`, negate to `5`. The negated-min reproduces the max exactly. Because negation touches only two well-defined spots (the insert and the return) while leaving the proven min logic byte-for-byte unchanged, it is far less bug-prone than flipping every comparison — the single most common min/max mistake.

---

## Comparison with D&C and Knuth Optimization

CHT/Li Chao is one of three classic 1D/2D DP speedups. They are **not** interchangeable — each fits a different transition shape.

| Optimization | Transition shape it speeds up | Precondition | Typical speedup |
|--------------|-------------------------------|--------------|-----------------|
| **Convex Hull Trick / Li Chao** | `dp[i] = min_j (m_j·x_i + b_j)` — minimum of **lines** | cost linearizes into `m_j·x_i + b_j` | `O(n²) → O(n log n)` or `O(n)` |
| **Divide & Conquer (sibling `08`)** | `dp[i][j] = min_{k} (dp[i-1][k] + C(k, j))` with **monotone optimal split** `opt(j) ≤ opt(j+1)` | the argmin is monotone in `j` | `O(k n²) → O(k n log n)` |
| **Knuth (sibling `09`)** | interval DP `dp[i][j] = min_{i≤k<j}(dp[i][k]+dp[k+1][j]) + C(i,j)` | quadrangle inequality + monotonicity → `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]` | `O(n³) → O(n²)` |

How to tell them apart:

- **Does the cost factor into a line in the query variable?** → CHT/Li Chao.
- **Is it a layered `dp[i][j]` with a monotone best-split index?** → Divide & Conquer optimization.
- **Is it an interval merge satisfying the quadrangle inequality?** → Knuth.

Crucially, the *condition* that enables CHT is a **convexity/Monge** structure on the cost — the same family of conditions (quadrangle inequality, total monotonicity) that underlies D&C and Knuth. The connection is deep: all three exploit that an optimal "decision" moves monotonically, so you never re-examine choices you have already ruled out. [`professional.md`](./professional.md) makes the Monge/convexity condition precise. Sometimes a single problem can be solved by *either* CHT or D&C optimization; CHT is usually faster (`O(n log n)` vs `O(n log n)` too, but smaller constants) when the line form is available, while D&C optimization works even when the cost does not linearize but the argmin is still monotone.

### A concrete decision walkthrough

Suppose you face `dp[i] = min_{j<i}(dp[j] + (x[i] - x[j])²) + cost[i]`. Ask the three questions in order:

1. **Does the cost factor into a line in `x[i]`?** Expand: `(x[i]-x[j])² = x[i]² - 2x[j]·x[i] + x[j]²`. Yes — slope `-2x[j]`, intercept `dp[j]+x[j]²`, `i`-only term `x[i]²+cost[i]`. → **CHT applies.** Reach for it (fastest).
2. Had the cost been, say, `dp[j] + |x[i] - x[j]|·w[j]` (an absolute value), step 1 would fail — `|·|` is not a single line. Then ask: **is the argmin monotone (Monge cost)?** If yes → **D&C optimization.**
3. Had it been an interval merge `dp[i][j] = min_k(dp[i][k]+dp[k+1][j]) + w(i,j)` with `w` satisfying the quadrangle inequality → **Knuth.**

Working the questions top-down keeps you from defaulting to the wrong tool out of habit. The first question — "linear in the query variable?" — is the fast discriminator for CHT and is exactly the linearization check expanded in [`professional.md`](./professional.md) Section 10.3.

---

## Code Examples

### Li Chao Tree (minimum), arbitrary insert/query order

The most robust general-purpose structure. Range `[XLO, XHI]`; each node stores one line.

#### Go

```go
package main

import "fmt"

const NEG = int64(-2e18)
const INF = int64(2e18)

type Line struct{ m, b int64 }

func (l Line) at(x int64) int64 {
	if l.m == 0 && l.b == INF {
		return INF // "no line" sentinel
	}
	return l.m*x + l.b
}

type LiChao struct {
	xlo, xhi int64
	line     []Line
	lc, rc   []int
	next     int
}

func NewLiChao(xlo, xhi int64, cap int) *LiChao {
	t := &LiChao{xlo: xlo, xhi: xhi}
	t.line = make([]Line, cap)
	t.lc = make([]int, cap)
	t.rc = make([]int, cap)
	for i := range t.line {
		t.line[i] = Line{0, INF}
		t.lc[i] = -1
		t.rc[i] = -1
	}
	t.next = 1 // node 0 is the root
	return t
}

func (t *LiChao) insert(node int, l, r int64, nw Line) {
	m := l + (r-l)/2
	left := nw.at(l) < t.line[node].at(l)
	mid := nw.at(m) < t.line[node].at(m)
	if mid {
		t.line[node], nw = nw, t.line[node]
	}
	if l == r {
		return
	}
	if left != mid {
		if t.lc[node] == -1 {
			t.lc[node] = t.next
			t.next++
		}
		t.insert(t.lc[node], l, m, nw)
	} else {
		if t.rc[node] == -1 {
			t.rc[node] = t.next
			t.next++
		}
		t.insert(t.rc[node], m+1, r, nw)
	}
}

func (t *LiChao) Add(m, b int64) { t.insert(0, t.xlo, t.xhi, Line{m, b}) }

func (t *LiChao) query(node int, l, r, x int64) int64 {
	if node == -1 {
		return INF
	}
	res := t.line[node].at(x)
	m := l + (r-l)/2
	if x <= m {
		if v := t.query(t.lc[node], l, m, x); v < res {
			res = v
		}
	} else {
		if v := t.query(t.rc[node], m+1, r, x); v < res {
			res = v
		}
	}
	return res
}

func (t *LiChao) Query(x int64) int64 { return t.query(0, t.xlo, t.xhi, x) }

func bruteMin(lines [][2]int64, x int64) int64 {
	best := INF
	for _, l := range lines {
		if v := l[0]*x + l[1]; v < best {
			best = v
		}
	}
	return best
}

func main() {
	lines := [][2]int64{{3, 10}, {2, 5}, {1, 3}, {0, 0}, {-1, 4}, {-2, 1}}
	t := NewLiChao(-10, 10, 4*len(lines)+4)
	for _, l := range lines {
		t.Add(l[0], l[1])
	}
	for x := int64(-5); x <= 5; x++ {
		fmt.Printf("x=%d  lichao=%d  brute=%d\n", x, t.Query(x), bruteMin(lines, x))
	}
}
```

#### Java

```java
import java.util.*;

public class LiChaoTree {
    static final long INF = (long) 2e18;
    long xlo, xhi;
    long[] M, B;
    int[] lc, rc;
    int next = 1;

    LiChaoTree(long xlo, long xhi, int cap) {
        this.xlo = xlo; this.xhi = xhi;
        M = new long[cap]; B = new long[cap]; lc = new int[cap]; rc = new int[cap];
        Arrays.fill(B, INF); Arrays.fill(lc, -1); Arrays.fill(rc, -1);
    }

    long at(int node, long x) { return (B[node] == INF) ? INF : M[node] * x + B[node]; }

    void insert(int node, long l, long r, long m, long b) {
        long mid = l + (r - l) / 2;
        boolean left = (m * l + b) < at(node, l);
        boolean midB = (m * mid + b) < at(node, mid);
        if (midB) { long tm = M[node], tb = B[node]; M[node] = m; B[node] = b; m = tm; b = tb; }
        if (l == r) return;
        if (left != midB) {
            if (lc[node] == -1) { lc[node] = next++; }
            insert(lc[node], l, mid, m, b);
        } else {
            if (rc[node] == -1) { rc[node] = next++; }
            insert(rc[node], mid + 1, r, m, b);
        }
    }

    void add(long m, long b) { insert(0, xlo, xhi, m, b); }

    long query(int node, long l, long r, long x) {
        if (node == -1) return INF;
        long res = at(node, x), mid = l + (r - l) / 2;
        if (x <= mid) res = Math.min(res, query(lc[node], l, mid, x));
        else res = Math.min(res, query(rc[node], mid + 1, r, x));
        return res;
    }

    long query(long x) { return query(0, xlo, xhi, x); }

    static long bruteMin(long[][] lines, long x) {
        long best = INF;
        for (long[] l : lines) best = Math.min(best, l[0] * x + l[1]);
        return best;
    }

    public static void main(String[] args) {
        long[][] lines = {{3, 10}, {2, 5}, {1, 3}, {0, 0}, {-1, 4}, {-2, 1}};
        LiChaoTree t = new LiChaoTree(-10, 10, 4 * lines.length + 4);
        for (long[] l : lines) t.add(l[0], l[1]);
        for (long x = -5; x <= 5; x++)
            System.out.println("x=" + x + " lichao=" + t.query(x) + " brute=" + bruteMin(lines, x));
    }
}
```

#### Python

```python
import sys
INF = 1 << 62


class LiChao:
    """Li Chao tree for MIN queries over integer x in [xlo, xhi]."""

    def __init__(self, xlo, xhi):
        self.xlo, self.xhi = xlo, xhi
        self.M = [0]
        self.B = [INF]   # node 0 = root, holds "no line"
        self.lc = [-1]
        self.rc = [-1]

    def _new(self):
        self.M.append(0); self.B.append(INF); self.lc.append(-1); self.rc.append(-1)
        return len(self.M) - 1

    def _at(self, node, x):
        return INF if self.B[node] == INF else self.M[node] * x + self.B[node]

    def add(self, m, b):
        self._insert(0, self.xlo, self.xhi, m, b)

    def _insert(self, node, l, r, m, b):
        mid = (l + r) // 2
        left = (m * l + b) < self._at(node, l)
        midv = (m * mid + b) < self._at(node, mid)
        if midv:
            m, self.M[node] = self.M[node], m
            b, self.B[node] = self.B[node], b
        if l == r:
            return
        if left != midv:
            if self.lc[node] == -1:
                self.lc[node] = self._new()
            self._insert(self.lc[node], l, mid, m, b)
        else:
            if self.rc[node] == -1:
                self.rc[node] = self._new()
            self._insert(self.rc[node], mid + 1, r, m, b)

    def query(self, x):
        node, l, r, res = 0, self.xlo, self.xhi, INF
        while node != -1:
            res = min(res, self._at(node, x))
            mid = (l + r) // 2
            if x <= mid:
                node, r = self.lc[node], mid
            else:
                node, l = self.rc[node], mid + 1
        return res


def brute_min(lines, x):
    return min(m * x + b for m, b in lines)


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    lines = [(3, 10), (2, 5), (1, 3), (0, 0), (-1, 4), (-2, 1)]
    t = LiChao(-10, 10)
    for m, b in lines:
        t.add(m, b)
    for x in range(-5, 6):
        print(f"x={x} lichao={t.query(x)} brute={brute_min(lines, x)}")
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Slopes not monotone but using deque CHT | Newly inserted line belongs mid-order; deque invariant breaks. | Use dynamic CHT or Li Chao for arbitrary slope order. |
| Queries not monotone but using pointer | Pointer only moves forward → wrong line. | Binary-search the deque, or use Li Chao. |
| Equal slopes | Division by `m1 - m2 = 0` in float intersection. | Use the cross-multiplied test; keep the lower-intercept line. |
| Query x outside Li Chao range | Returns stale/sentinel value. | Size `[xlo, xhi]` to cover all queries; or clamp. |
| Min/max mismatch | Lower-envelope code used for max. | Negate `(m, b)` and the answer, or flip all comparisons consistently. |
| Segment (not full line) needed | Plain CHT assumes full-range lines. | Use Li Chao segment insertion (`O(log² C)`). |
| Overflow | `m·x` or cross products exceed 64-bit. | Use `int64`/`long`; bound `|m|·|x|`; pick `INF` below overflow. |

---

## Performance Analysis

| Structure | Insert | Query | Memory | Notes |
|-----------|--------|-------|--------|-------|
| Monotone deque CHT | amortized `O(1)` | `O(1)` ptr / `O(log n)` BS | `O(n)` | smallest constants; strict preconditions |
| Dynamic CHT (BST) | `O(log n)` | `O(log n)` | `O(n)` | arbitrary slopes; fiddly to implement |
| Li Chao (static) | `O(log C)` | `O(log C)` | `O(C)` | preallocate `~4C` nodes |
| Li Chao (dynamic) | `O(log C)` | `O(log C)` | `O((n+Q) log C)` | lazy nodes for huge `C` |
| Li Chao (segments) | `O(log² C)` | `O(log C)` | `O((n log C)`) | range-restricted lines |

Rule of thumb for a DP with `n` states each doing one envelope query:

- Monotone setup → **`O(n)`** total (the asymptotically best; reach for it when preconditions hold).
- Otherwise → **`O(n log n)`** (dynamic CHT) or **`O(n log C)`** (Li Chao).

For `n = 10⁶`, the monotone CHT runs in milliseconds; Li Chao with `log C ≈ 30` runs in tens of milliseconds — both fine, with the deque having the edge on constants.

### Back-of-envelope cost comparison

For the canonical DP with `n` states, one query per state:

| `n` | naive `O(n²)` | monotone CHT `O(n)` | Li Chao `O(n log C)`, `log C ≈ 21` |
|-----|--------------|---------------------|-------------------------------------|
| 10³ | 10⁶ ops | 10³ ops | ~2·10⁴ ops |
| 10⁵ | 10¹⁰ (seconds+) | 10⁵ ops | ~2·10⁶ ops |
| 10⁶ | 10¹² (infeasible) | 10⁶ ops (ms) | ~2·10⁷ ops (tens of ms) |

The naive approach is the baseline every fast structure must beat; it becomes infeasible around `n = 10⁵`. The monotone CHT is both asymptotically and constant-factor optimal — *when its preconditions hold*. Li Chao trades a `log C` factor for never needing to verify a precondition. The practical rule: prove the order assumptions to earn the `O(n)`, or pay the `log` for robustness. This is the same trade-off the benchmark task (Task B in [`tasks.md`](./tasks.md)) measures empirically.

---

## Best Practices

- **Default to Li Chao** for arbitrary order; switch to monotone CHT only when you can *prove* slopes and queries are monotone (and it matters for speed).
- **Negate for max** rather than rewriting comparisons — fewer places to get a sign wrong.
- **Keep the cross-multiplied (integer) test**; never compute intersection x as a float in the hot path.
- **Validate against the brute oracle** on random small inputs for every structure you implement.
- **Size the coordinate range** (`xlo, xhi`) of a Li Chao tree to cover every query coordinate; for huge ranges, go dynamic (lazy nodes).
- **Choose between CHT, D&C, and Knuth by transition shape**, not by habit — they optimize different forms.
- **Cross-validate two structures.** A min-CHT and a Li Chao tree compute the same envelope value by entirely different mechanisms; running both on random inputs and asserting equality is a strong correctness signal — a bug in one is unlikely to be mirrored in the other.
- **Track the argmin if the DP needs the partition.** Attach the originating state index `j` to each line so a query yields both the value and the `j` that achieved it; backtrack to reconstruct the decisions. (Detailed in [`senior.md`](./senior.md).)
- **Compress coordinates when queries are offline.** Collecting all query x-values up front and building the Li Chao tree over the compressed indices shrinks `C` to `O(n+Q)` and removes the "range too small" risk entirely.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - Inserting lines one by one and the lower envelope redrawing.
> - The deque **popping useless middle lines** as new lines dominate them, with the cross-multiplied test shown.
> - A query at `x` resolved by reading the lowest line — the same answer the brute oracle gives.

---

## Summary

Three structures solve the same lower-envelope problem with different trade-offs. The **monotone deque CHT** is the fastest (amortized `O(1)`) but demands sorted slopes and (for the pointer query) sorted queries. The **dynamic CHT** relaxes the slope-order requirement at `O(log n)` per operation using a balanced BST. The **Li Chao tree** is the most robust — arbitrary insert/query order, even range-restricted *segments* — at `O(log C)` per operation, and is the recommended default. Min becomes max by negating `(m, b)` and the answer. The technique belongs to the DP-optimization family with **divide-and-conquer** (monotone argmin over layered DP) and **Knuth** (interval DP with the quadrangle inequality); the three optimize different transition shapes but all rest on the same underlying convexity/Monge structure. Pick the structure by the input's order properties, keep integer comparisons, and always test against brute force.

### Quick reference

| If your input is... | Use | Per-op cost |
|---------------------|-----|-------------|
| slopes sorted, queries sorted | monotone CHT (pointer) | amortized `O(1)` |
| slopes sorted, queries any order | CHT + binary search | `O(log n)` |
| slopes any order | dynamic CHT or Li Chao | `O(log n)` / `O(log C)` |
| range-restricted lines (segments) | Li Chao segments | `O(log² C)` insert |
| maximum instead of minimum | negate `(m,b)` into any of the above | same |
| lines added and removed over time | offline D&C over time + Li Chao | `O(log T log C)` amortized |

### One-paragraph recap

If a transition reads `dp[i] = g(i) + min_j(m_j·x_i + b_j)`, each `j` is a line and `dp[i]` is a lower-envelope query at `x_i`. With sorted slopes and queries, a deque + pointer answers in amortized `O(1)`; with sorted slopes only, binary-search the deque in `O(log n)`; with arbitrary order or range-restricted segments, a Li Chao tree answers in `O(log C)`. Max is min on negated lines. The structure you pick is dictated entirely by the order properties of the input — prove them to earn the fast variant, or default to Li Chao for safety. Next, read [`senior.md`](./senior.md) for the production hazards (overflow, floats, argmin recovery) and [`professional.md`](./professional.md) for the correctness proofs and the Monge condition that unifies CHT with its sibling optimizations.
