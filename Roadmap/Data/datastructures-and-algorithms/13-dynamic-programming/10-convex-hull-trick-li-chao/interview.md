# Convex Hull Trick (CHT) and Li Chao Tree — Interview Preparation

Convex Hull Trick is a favourite interview topic because it rewards a single crisp insight — *"a DP transition `dp[i] = min_j (m_j·x_i + b_j)` is a lower-envelope query"* — and then tests whether you can (a) recognize the linear form hiding inside a quadratic-looking cost, (b) pick the right structure (monotone CHT, dynamic CHT, or Li Chao) for the input's order, (c) keep the comparison exact and overflow-free, and (d) avoid the min/max sign trap. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `min_j(m_j·x+b_j)`, slopes & queries monotone | monotone deque CHT (pointer) | amortized `O(1)` |
| `min_j(m_j·x+b_j)`, slopes monotone, any query | CHT + binary search | `O(log n)` |
| `min_j(m_j·x+b_j)`, slopes arbitrary | dynamic CHT (sorted set) | `O(log n)` |
| Anything, arbitrary insert/query order | Li Chao tree | `O(log C)` |
| Range-restricted line (segment) | Li Chao segment insert | `O(log² C)` |
| Max instead of min | negate `(m, b)` and answer | same |
| Verify correctness | brute-force `min_j` oracle | `O(n)` per query |

The line/DP correspondence:

```text
dp[i] = g(i) + min_j ( m_j * x_i + b_j )
                       ^slope    ^intercept (b_j = dp[j] + stuff(j))
add line (m_j, b_j) after computing dp[j];  query envelope at x = x_i;  add g(i).
```

Bad-line test (min, division-free, slopes monotone): pop middle line `L2` when
```
(b3 - b1)*(m1 - m2) <= (b2 - b1)*(m1 - m3)
```

Key facts:
- The lower envelope is **convex**; the winning line's slope is **monotone** in `x`.
- Monotone CHT needs sorted slopes (and, for the pointer query, sorted `x`).
- Li Chao needs a known x-range (or dynamic nodes); no sorting required.
- `m·x` and the cross-product can **overflow** — size your integer types.
- Min ↔ max by negating `(m, b)` and the answer.

---

## Junior Questions (12 Q&A)

### J1. What kind of DP transition does CHT optimize?
Transitions of the form `dp[i] = min over j (m_j·x_i + b_j)`, where `m_j, b_j` depend only on `j` (known once `dp[j]` is computed) and only `x_i` depends on `i`. Each `j` is a line; computing `dp[i]` is one lower-envelope query at `x = x_i`.

### J2. What is the lower envelope?
The pointwise minimum of all the lines: `E(x) = min_j (m_j x + b_j)`. It is a convex, piecewise-linear curve. At any `x`, exactly one line is lowest, and CHT keeps only the lines that are lowest somewhere.

### J3. Why can some lines be thrown away?
A line that is never the minimum at any `x` (dominated by the others) never affects an answer, so it is removed. Keeping only the envelope lines makes queries fast.

### J4. How do you turn `dp[i] = min_j(dp[j] + (x_i - x_j)^2)` into lines?
Expand `(x_i - x_j)^2 = x_i^2 - 2x_j x_i + x_j^2`. Factor out `x_i^2` (same for every `j`). What remains in the min is `(-2x_j)·x_i + (dp[j] + x_j^2)` — a line with slope `m_j = -2x_j` and intercept `b_j = dp[j] + x_j^2`. Add `x_i^2` back after the query.

### J5. What is the complexity gain?
The naive transition loops over all `j` (`O(n)` per state, `O(n²)` total). CHT/Li Chao answer each query in `O(log)` or amortized `O(1)`, giving `O(n log n)` or `O(n)`.

### J6. What's the difference between the monotone CHT and the Li Chao tree?
Monotone CHT keeps envelope lines in a deque, needs sorted slopes (and sorted queries for the `O(1)` pointer), and is the fastest. The Li Chao tree is a segment tree of lines that handles any insert/query order in `O(log C)` with no sorting — more robust, slightly slower.

### J7. How do you handle a maximum instead of a minimum?
Negate: insert `(-m, -b)` into the min structure and negate the result, because `max_j(m_j x+b_j) = -min_j(-m_j x - b_j)`. Or flip all comparisons consistently.

### J8. Why avoid floating-point intersection points?
Comparing intersection x-values as floats rounds inconsistently near ties and pops the wrong line, silently corrupting the envelope. Use the cross-multiplied integer comparison instead.

### J9. What if two lines have the same slope?
They never cross; keep the one with the smaller intercept (for min). The cross test must not divide by `m1 - m2 = 0` — the division-free form handles this.

### J10. What does a query at `x` actually do in the monotone CHT?
With sorted queries, a pointer walks forward along the deque while the next line gives a smaller value at `x`, then returns the current line's value. Amortized `O(1)` because the pointer only moves forward.

### J11. Can `m·x` overflow?
Yes. If `|m|` and `|x|` are around `10⁹`, `m·x` reaches `10¹⁸`, near the `int64` limit. Use 64-bit types and watch the cross-product in the bad-line test, which can need 128 bits.

### J12 (analysis). Why is the lower envelope convex?
A pointwise minimum of affine (straight-line) functions is concave; the curve bends only one way, so the winning line changes in a monotone order as `x` increases. That monotonicity is exactly what makes the pointer and binary-search queries correct.

---

## Middle Questions (12 Q&A)

### M1. State and justify the bad-line test.
For three lines in slope order `m1 > m2 > m3`, the middle `L2` is dominated iff the intersection of `L1,L3` is at an `x` ≤ the intersection of `L1,L2`. Cross-multiplied (denominators positive): `(b3-b1)(m1-m2) ≤ (b2-b1)(m1-m3)`. If true, `L3` overtakes `L1` before `L2` ever would, so `L2` never wins — pop it.

### M2. When is the monotone deque CHT applicable?
When slopes are inserted in monotone order (so the deque stays an envelope) and, for the amortized-`O(1)` pointer query, queries arrive in monotone order. If queries are arbitrary, binary-search the deque (`O(log n)`); if slopes are arbitrary, use a dynamic CHT or Li Chao.

### M3. Explain the Li Chao insert in one paragraph.
At a node covering `[l,r]` with midpoint `m`, compare the new line and the stored line at `m`; keep the lower at the node. The loser can beat the winner on at most one side (two lines cross once), so recurse the loser into that side. One descent root-to-leaf, `O(log C)`.

### M4. Explain the Li Chao query.
Walk root-to-leaf toward `x`, taking the minimum of the line stored at every node on the path. Every line that could be optimal at `x` is encountered on that path, so the path-min is the true envelope value. `O(log C)`.

### M5. How do you support lines valid only on a sub-range (segments)?
Only the Li Chao tree supports this. Decompose `[lo,hi]` into the `O(log C)` canonical segment-tree nodes and run a line-insert within each. Cost `O(log² C)` per segment; queries stay `O(log C)`. The plain CHT cannot represent range-restricted lines.

### M6. CHT vs Li Chao — which would you reach for by default?
Li Chao, because it tolerates arbitrary insert/query order and even segments, with no sorting and one fewer overflow surface (it never computes intersection cross-products). Use the monotone CHT only when you can prove slopes and queries are monotone and you need the smaller constant factor.

### M7. How does CHT relate to divide-and-conquer optimization?
Both exploit a monotone optimal decision. D&C optimization (sibling `08`) applies to layered `dp_t[i] = min_k(dp_{t-1}[k] + C(k,i))` when the argmin `opt(i)` is monotone. CHT is the special case where the cost linearizes into lines `m_j x_i + b_j`. If the cost is Monge but not linear, use D&C optimization.

### M8. How does CHT relate to Knuth optimization?
Knuth (sibling `09`) speeds up interval DP `dp[i][j] = min_k(dp[i][k]+dp[k+1][j]) + w(i,j)` when `w` satisfies the quadrangle inequality, giving `O(n²)` from `O(n³)`. Same Monge/convexity family as CHT, different transition shape (interval merge vs linear-min).

### M9. What is the right identity / initial state for the structure?
Start the structure empty (or with a `+∞` sentinel line for min). Seed the DP base case (`dp[0]` etc.) and insert its line before any query that depends on it. A common bug is querying before inserting the base line.

### M10. How do you avoid overflow in the bad-line test?
The products `(b3-b1)(m1-m2)` can reach `~4·10³⁶` even when the DP answer fits in 64 bits. Use a 128-bit intermediate (`__int128`, `math/bits.Mul64`, or `BigInteger` for the comparison), or sidestep it entirely with a Li Chao tree.

### M11. Why must slopes be monotone for the cross-multiplied test to be exact?
Cross-multiplying preserves the inequality direction only if the denominators `m1-m2` and `m1-m3` have a known sign. Monotone slope insertion keeps both positive, so the integer comparison is exact. Lose monotonicity and a denominator can flip sign, breaking the test.

### M12 (analysis). What is the asymptotic cost of building the envelope of `n` lines?
`Θ(n log n)` if slopes are unsorted (dual to convex hull, with an `Ω(n log n)` lower bound from sorting). `Θ(n)` if slopes arrive sorted — the monotone CHT exploits that the input already did the sorting work.

---

## Senior Questions (10 Q&A)

### S1. How do you choose between the three structures in production?
Decision order: monotone slopes + monotone queries → deque CHT with pointer (`O(1)`); monotone slopes only → CHT + binary search; arbitrary order, large coefficients, or segments → Li Chao (robust default). Always *verify* the monotone precondition with assertions rather than assuming it.

### S2. Where can integer overflow bite, and how do you handle each?
Two surfaces: (1) evaluating `m·x` (both structures) — bound `max|m|·max|x|+max|b|` and use 64-bit with headroom; (2) the cross-product in the CHT bad-line test — use 128-bit intermediates. Li Chao avoids surface (2) entirely since it only evaluates lines.

### S3. When are floats unavoidable, and what do you do?
When slopes/intercepts are genuinely real. Then prefer Li Chao (one subtraction per comparison, no error-prone division), use a tolerance scaled to the data magnitude, or rationalize inputs by a common denominator to recover integers.

### S4. How do you recover the optimal decision (not just its cost)?
Attach the originating state index `j` to each line. When a query reads the best line it also yields the `j` that produced it; store `parent[i]=j` and backtrack from the final state to reconstruct the partition/path. Encode any required tie-break into the comparison.

### S5. How do you size a Li Chao tree's coordinate range?
It must cover every query `x`. For offline queries, coordinate-compress to `O(n+Q)` distinct values. For online queries over a huge domain, use a wide range with dynamic (lazy) node allocation, memory `O((n+Q) log C)`. Compute `mid = l + (r-l)/2` to avoid overflow.

### S6. How do you test a CHT/Li Chao when input is too large to brute-force?
Layered testing: a structure-level brute oracle (`min_j` loop) on random small line sets and random queries; monotone-precondition assertions in debug builds; envelope property tests (a dominated line never changes any answer); and crucially a *whole-DP* brute oracle on small `n` to catch transition-linearization errors the structure-only test cannot see.

### S7. Can you delete lines from these structures?
Not cleanly — none support deletion. A sliding window of lines (insert and remove over time) is the "fully dynamic / kinetic" regime, usually solved **offline** with divide-and-conquer over the time axis (each line active on a time interval, inserted into the canonical nodes), rather than an online structure.

### S8. Li Chao's `log C` vs CHT's `log n` — when does it matter?
Li Chao's per-op cost depends on the coordinate range `C`; CHT's on the number of lines `n`. If `C ≫ n` and you cannot compress coordinates (online, huge domain), a dynamic CHT's `log n` can beat Li Chao's `log C`. After coordinate compression, `C` drops to `O(n)` and the two are comparable.

### S9. A problem's cost is `dp[j] + a·x_i² + b·x_i·x_j + c·x_j²` style — can CHT apply?
Yes if it factors so the `i`-only terms (`a·x_i²`) leave the min and the cross term `b·x_i·x_j` is linear in `x_i` with a `j`-dependent slope. Then slope `m_j = b·x_j` (plus any linear-in-`x_j` piece), intercept `b_j = dp[j] + c·x_j²`. If it does not factor into `φ(j)·ψ(i)`, CHT does not apply — consider D&C optimization if the argmin is still monotone.

### S10 (analysis). Why is the monotone-query pointer correct, and why does it fail on unsorted queries?
The winning line's slope is monotone in `x` (envelope convexity), so as queries increase, the optimal deque index only moves forward; a never-retreating pointer is correct and amortizes to `O(1)`. On unsorted queries the optimum can jump backward, which the forward-only pointer cannot follow — it returns a wrong line. Use binary search or Li Chao for arbitrary `x`.

---

## Professional Questions (8 Q&A)

### P1. Prove the lower envelope is convex and why it matters.
A pointwise minimum of affine functions is concave: `E(θx+(1-θ)y) ≥ θE(x)+(1-θ)E(y)` since the min of a sum is at least the sum of the mins. Concavity (a single bend direction) implies the winning line's slope is monotone in `x`, which is the structural fact every fast query method exploits.

### P2. Design a service that answers many `min_j(m_j x + b_j)` queries over a growing line set.
If lines and queries interleave in arbitrary order, use a dynamic Li Chao tree with lazy nodes over the full coordinate domain; each insert/query is `O(log C)`. Attach the argmin index for decision recovery. If lines are batch-loaded with sorted slopes and queries are sorted, switch to a monotone CHT for `O(1)` amortized. Guard the `INF` sentinel against overflow.

### P3. The cross-product overflows 64 bits but the DP answer fits. What do you do?
Use a 128-bit intermediate just for the comparison (`__int128` / `math/bits.Mul64` / `BigInteger`), or switch to Li Chao, which never computes the cross-product — it only evaluates `m·x+b` and compares values, so it has one fewer overflow surface. Bound `max|m|·max|x|+max|b|` to confirm evaluation itself is safe.

### P4. How do you debug "the DP answer is wrong" when using CHT?
Run the whole-DP brute oracle (`O(n²)`) on the same small inputs and diff. Check: (a) the `i`-only term was factored *out* of the min and added back; (b) `m_j` and `b_j` are derived correctly; (c) min/max sign convention is consistent; (d) the base line is inserted before its first dependent query; (e) overflow in the cross test. The structure faithfully returns the wrong answer if fed wrong lines, so test the transition, not just the structure.

### P5. When is the line/envelope form the wrong tool?
When the cost does not factor into `φ(j)·ψ(i)` (no linear form). Then CHT cannot represent decisions as lines. If the argmin is still monotone (Monge cost), use divide-and-conquer optimization; if it is an interval-merge with the quadrangle inequality, use Knuth; if no monotonicity holds, fall back to the `O(n²)` DP or a different technique.

### P6. How would you handle lines that are only active during a time window (insert + later remove)?
Offline divide-and-conquer over time: build a segment tree on the time axis, insert each line into the `O(log T)` canonical time-nodes covering its active window, then DFS the time tree maintaining a Li Chao tree, querying at each leaf's time. This simulates deletions without an online deletable structure, at `O((n+Q) log T log C)`.

### P7. Connect CHT to the Monge condition and its sibling optimizations.
A cost `C(j,i)` that is Monge (quadrangle inequality) forces the optimal `j` to be monotone in `i`. CHT is the case where `C` additionally linearizes into `φ(j)ψ(i)`, letting each decision be a literal line and the optimum be found by envelope geometry. D&C optimization and Knuth use the same monotone-argmin property for non-linearizable Monge costs in layered and interval DPs respectively.

### P8 (analysis). Prove the monotone CHT does `O(n)` total work over `n` inserts.
Each insert pushes one line and pops some. A popped line (failed the bad-line test) is never re-inserted, so total pops over all inserts ≤ `n`. Per-insert work is `O(1)` push + `O(#pops)`, and `Σ#pops ≤ n`, so total is `O(n)` — amortized `O(1)` per insert by the accounting method.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you turned an `O(n²)` DP into something faster.
Look for a concrete story: a transition that profiled as an `O(n)` inner min-loop, the insight that each term was linear in the query variable (`m_j x_i + b_j`), the choice of structure based on whether slopes/queries were sorted, and the measured speedup. Strong answers mention validating against the original `O(n²)` version and handling overflow/sign conventions.

### B2. A teammate's CHT gives wrong answers on some inputs but not others. How do you help?
Most likely the monotone-query precondition is violated on the failing inputs (the ones with unsorted `x`). Add an assertion, confirm, and switch those code paths to binary-search queries or a Li Chao tree. Frame it as "the structure has a precondition the input no longer satisfies", not as blame, and add the precondition assertion to prevent regressions.

### B3. Design a cost-minimization feature with a piecewise-linear cost model.
Model each option as a line `m·x + b` (rate × usage + fixed cost); the cheapest option at a usage level is a lower-envelope query. Use a Li Chao tree for arbitrary option-add and query order; attach the option id for recovery. Discuss overflow if rates/usage are large, and float handling if costs are continuous (tolerance + Li Chao).

### B4. How would you explain CHT to a junior engineer?
Use phone plans: each plan is a line (monthly fee + per-minute rate). The cheapest plan at each usage level traces a curve (the lower envelope); plans that are never cheapest get dropped from the brochure. A query is "I'll use `x` minutes — which plan is cheapest?". Then show that a DP whose cost looks like this can answer each state in `O(log)` instead of scanning all plans. Lead with the two gotchas: min/max sign, and overflow.

### B5. Your CHT-based job uses too much memory at scale. How do you investigate?
For a static Li Chao tree, check the preallocated node count (`~4C`) — a huge coordinate range without compression bloats it; switch to coordinate compression or dynamic lazy nodes. For the deque CHT, confirm you store flat arrays of `(m,b)` not boxed objects. Profile allocations; the fix is usually compression plus reusing buffers.

---

## Coding Challenges

### Challenge 1: DP Solvable by CHT — Minimum Cost Partition

**Problem.** You have points `x[0] < x[1] < … < x[n-1]` and a per-point cost `cost[i]`. Define
`dp[i] = min over j<i ( dp[j] + (x[i]-x[j])^2 ) + cost[i]`, with `dp[0] = cost[0]`. Return `dp[n-1]`.

**Example.**
```text
x = [0, 2, 5, 7], cost = [0, 1, 2, 1]  ->  dp computed by the recurrence; verify vs brute.
```

**Constraints.** `1 ≤ n ≤ 2·10⁵`, `0 ≤ x[i], cost[i] ≤ 10⁶`, `x` strictly increasing.

**Insight.** `(x_i - x_j)^2 = x_i² - 2x_j x_i + x_j²`; line for `j` is slope `-2x_j`, intercept `dp[j]+x_j²`; query at `x_i`, add `x_i²+cost[i]`. Slopes `-2x_j` are decreasing (x increasing) and queries `x_i` increasing → monotone CHT.

**Go.**
```go
package main

import "fmt"

type Line struct{ m, b int64 }

func (l Line) at(x int64) int64 { return l.m*x + l.b }

type CHT struct {
	ls  []Line
	ptr int
}

func (c *CHT) bad(l1, l2, l3 Line) bool {
	return (l3.b-l1.b)*(l1.m-l2.m) <= (l2.b-l1.b)*(l1.m-l3.m)
}

func (c *CHT) add(m, b int64) {
	l := Line{m, b}
	for len(c.ls) >= 2 && c.bad(c.ls[len(c.ls)-2], c.ls[len(c.ls)-1], l) {
		c.ls = c.ls[:len(c.ls)-1]
	}
	c.ls = append(c.ls, l)
	if c.ptr >= len(c.ls) {
		c.ptr = len(c.ls) - 1
	}
}

func (c *CHT) query(x int64) int64 {
	if c.ptr >= len(c.ls) {
		c.ptr = len(c.ls) - 1
	}
	for c.ptr+1 < len(c.ls) && c.ls[c.ptr+1].at(x) <= c.ls[c.ptr].at(x) {
		c.ptr++
	}
	return c.ls[c.ptr].at(x)
}

func solve(x, cost []int64) int64 {
	n := len(x)
	dp := make([]int64, n)
	dp[0] = cost[0]
	var c CHT
	c.add(-2*x[0], dp[0]+x[0]*x[0])
	for i := 1; i < n; i++ {
		dp[i] = x[i]*x[i] + cost[i] + c.query(x[i])
		c.add(-2*x[i], dp[i]+x[i]*x[i])
	}
	return dp[n-1]
}

func main() {
	x := []int64{0, 2, 5, 7}
	cost := []int64{0, 1, 2, 1}
	fmt.Println(solve(x, cost))
}
```

**Java.**
```java
public class MinPartition {
    static long[] M = new long[200005];
    static long[] B = new long[200005];
    static int sz = 0, ptr = 0;

    static long at(int i, long x) { return M[i] * x + B[i]; }

    static boolean bad(int i1, int i2, long m3, long b3) {
        return (b3 - B[i1]) * (M[i1] - M[i2]) <= (B[i2] - B[i1]) * (M[i1] - m3);
    }

    static void add(long m, long b) {
        while (sz >= 2 && bad(sz - 2, sz - 1, m, b)) sz--;
        M[sz] = m; B[sz] = b; sz++;
        if (ptr >= sz) ptr = sz - 1;
    }

    static long query(long x) {
        if (ptr >= sz) ptr = sz - 1;
        while (ptr + 1 < sz && at(ptr + 1, x) <= at(ptr, x)) ptr++;
        return at(ptr, x);
    }

    static long solve(long[] x, long[] cost) {
        int n = x.length;
        long[] dp = new long[n];
        sz = 0; ptr = 0;
        dp[0] = cost[0];
        add(-2 * x[0], dp[0] + x[0] * x[0]);
        for (int i = 1; i < n; i++) {
            dp[i] = x[i] * x[i] + cost[i] + query(x[i]);
            add(-2 * x[i], dp[i] + x[i] * x[i]);
        }
        return dp[n - 1];
    }

    public static void main(String[] args) {
        long[] x = {0, 2, 5, 7}, cost = {0, 1, 2, 1};
        System.out.println(solve(x, cost));
    }
}
```

**Python.**
```python
class CHT:
    def __init__(self):
        self.ls = []
        self.ptr = 0

    @staticmethod
    def _bad(l1, l2, l3):
        return (l3[1] - l1[1]) * (l1[0] - l2[0]) <= (l2[1] - l1[1]) * (l1[0] - l3[0])

    def add(self, m, b):
        l = (m, b)
        while len(self.ls) >= 2 and self._bad(self.ls[-2], self.ls[-1], l):
            self.ls.pop()
        self.ls.append(l)
        self.ptr = min(self.ptr, len(self.ls) - 1)

    def query(self, x):
        at = lambda i: self.ls[i][0] * x + self.ls[i][1]
        while self.ptr + 1 < len(self.ls) and at(self.ptr + 1) <= at(self.ptr):
            self.ptr += 1
        return at(self.ptr)


def solve(x, cost):
    n = len(x)
    dp = [0] * n
    dp[0] = cost[0]
    c = CHT()
    c.add(-2 * x[0], dp[0] + x[0] ** 2)
    for i in range(1, n):
        dp[i] = x[i] ** 2 + cost[i] + c.query(x[i])
        c.add(-2 * x[i], dp[i] + x[i] ** 2)
    return dp[n - 1]


if __name__ == "__main__":
    print(solve([0, 2, 5, 7], [0, 1, 2, 1]))
```

---

### Challenge 2: Implement a Li Chao Tree (min)

**Problem.** Support `add(m, b)` (insert line) and `query(x)` (minimum line value at `x`) for integer `x` in `[-10⁶, 10⁶]`, arbitrary insert/query order.

**Optimal.** `O(log C)` per operation.

**Go.**
```go
package main

import "fmt"

const INF = int64(1) << 62

type node struct {
	m, b   int64
	lc, rc int
}

type LiChao struct {
	xlo, xhi int64
	nodes    []node
}

func New(xlo, xhi int64) *LiChao {
	t := &LiChao{xlo: xlo, xhi: xhi}
	t.nodes = []node{{0, INF, -1, -1}}
	return t
}

func (t *LiChao) at(i int, x int64) int64 {
	if t.nodes[i].b == INF {
		return INF
	}
	return t.nodes[i].m*x + t.nodes[i].b
}

func (t *LiChao) newNode() int {
	t.nodes = append(t.nodes, node{0, INF, -1, -1})
	return len(t.nodes) - 1
}

func (t *LiChao) insert(i int, l, r, m, b int64) {
	mid := l + (r-l)/2
	left := m*l + b
	if t.nodes[i].b == INF || left < t.at(i, l) {
	}
	// compare at midpoint
	curMid := t.at(i, mid)
	newMid := m*mid + b
	if t.nodes[i].b == INF || newMid < curMid {
		m, t.nodes[i].m = t.nodes[i].m, m
		b, t.nodes[i].b = t.nodes[i].b, b
	}
	if b == INF || l == r {
		return
	}
	if m*l+b < t.at(i, l) {
		if t.nodes[i].lc == -1 {
			t.nodes[i].lc = t.newNode()
		}
		t.insert(t.nodes[i].lc, l, mid, m, b)
	} else if m*r+b < t.at(i, r) {
		if t.nodes[i].rc == -1 {
			t.nodes[i].rc = t.newNode()
		}
		t.insert(t.nodes[i].rc, mid+1, r, m, b)
	}
}

func (t *LiChao) Add(m, b int64) { t.insert(0, t.xlo, t.xhi, m, b) }

func (t *LiChao) Query(x int64) int64 {
	i, l, r := 0, t.xlo, t.xhi
	best := INF
	for i != -1 {
		if v := t.at(i, x); v < best {
			best = v
		}
		mid := l + (r-l)/2
		if x <= mid {
			i, r = t.nodes[i].lc, mid
		} else {
			i, l = t.nodes[i].rc, mid+1
		}
	}
	return best
}

func main() {
	t := New(-1000000, 1000000)
	t.Add(2, 5)
	t.Add(-1, 4)
	t.Add(0, 0)
	for _, x := range []int64{-3, 0, 3} {
		fmt.Printf("min at %d = %d\n", x, t.Query(x))
	}
}
```

**Java.**
```java
import java.util.*;

public class LiChao {
    static final long INF = (long) 4e18;
    long xlo, xhi;
    ArrayList<long[]> mb = new ArrayList<>(); // {m, b}
    ArrayList<int[]> ch = new ArrayList<>();   // {lc, rc}

    LiChao(long xlo, long xhi) {
        this.xlo = xlo; this.xhi = xhi;
        mb.add(new long[]{0, INF}); ch.add(new int[]{-1, -1});
    }

    long at(int i, long x) { return mb.get(i)[1] == INF ? INF : mb.get(i)[0] * x + mb.get(i)[1]; }

    int newNode() { mb.add(new long[]{0, INF}); ch.add(new int[]{-1, -1}); return mb.size() - 1; }

    void insert(int i, long l, long r, long m, long b) {
        long mid = l + (r - l) / 2;
        long newMid = m * mid + b;
        if (mb.get(i)[1] == INF || newMid < at(i, mid)) {
            long tm = mb.get(i)[0], tb = mb.get(i)[1];
            mb.set(i, new long[]{m, b}); m = tm; b = tb;
        }
        if (b == INF || l == r) return;
        if (m * l + b < at(i, l)) {
            if (ch.get(i)[0] == -1) ch.get(i)[0] = newNode();
            insert(ch.get(i)[0], l, mid, m, b);
        } else if (m * r + b < at(i, r)) {
            if (ch.get(i)[1] == -1) ch.get(i)[1] = newNode();
            insert(ch.get(i)[1], mid + 1, r, m, b);
        }
    }

    void add(long m, long b) { insert(0, xlo, xhi, m, b); }

    long query(long x) {
        int i = 0; long l = xlo, r = xhi, best = INF;
        while (i != -1) {
            best = Math.min(best, at(i, x));
            long mid = l + (r - l) / 2;
            if (x <= mid) { i = ch.get(i)[0]; r = mid; }
            else { i = ch.get(i)[1]; l = mid + 1; }
        }
        return best;
    }

    public static void main(String[] args) {
        LiChao t = new LiChao(-1000000, 1000000);
        t.add(2, 5); t.add(-1, 4); t.add(0, 0);
        for (long x : new long[]{-3, 0, 3})
            System.out.println("min at " + x + " = " + t.query(x));
    }
}
```

**Python.**
```python
import sys
INF = 1 << 62


class LiChao:
    def __init__(self, xlo, xhi):
        self.xlo, self.xhi = xlo, xhi
        self.M = [0]; self.B = [INF]; self.lc = [-1]; self.rc = [-1]

    def _new(self):
        self.M.append(0); self.B.append(INF); self.lc.append(-1); self.rc.append(-1)
        return len(self.M) - 1

    def _at(self, i, x):
        return INF if self.B[i] == INF else self.M[i] * x + self.B[i]

    def add(self, m, b):
        self._insert(0, self.xlo, self.xhi, m, b)

    def _insert(self, i, l, r, m, b):
        mid = (l + r) // 2
        if self.B[i] == INF or m * mid + b < self._at(i, mid):
            m, self.M[i] = self.M[i], m
            b, self.B[i] = self.B[i], b
        if b == INF or l == r:
            return
        if m * l + b < self._at(i, l):
            if self.lc[i] == -1:
                self.lc[i] = self._new()
            self._insert(self.lc[i], l, mid, m, b)
        elif m * r + b < self._at(i, r):
            if self.rc[i] == -1:
                self.rc[i] = self._new()
            self._insert(self.rc[i], mid + 1, r, m, b)

    def query(self, x):
        i, l, r, best = 0, self.xlo, self.xhi, INF
        while i != -1:
            best = min(best, self._at(i, x))
            mid = (l + r) // 2
            if x <= mid:
                i, r = self.lc[i], mid
            else:
                i, l = self.rc[i], mid + 1
        return best


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    t = LiChao(-10**6, 10**6)
    for m, b in [(2, 5), (-1, 4), (0, 0)]:
        t.add(m, b)
    for x in (-3, 0, 3):
        print(f"min at {x} = {t.query(x)}")
```

---

### Challenge 3: Min/Max Line Container

**Problem.** Build a container supporting `addLine(m, b)` and `query(x)` returning the **maximum** of all lines at `x`. Use a min structure plus negation. Arbitrary order → wrap a Li Chao tree.

**Approach.** Insert `(-m, -b)` into a min Li Chao; return `-query_min(x)`.

**Go.**
```go
package main

import "fmt"

// Reuse the LiChao from Challenge 2 (min). Here a self-contained max wrapper.
const INF = int64(1) << 62

type MaxContainer struct{ tree *liMin }

type liMin struct {
	xlo, xhi int64
	m, b     []int64
	lc, rc   []int
}

func newLi(xlo, xhi int64) *liMin {
	return &liMin{xlo, xhi, []int64{0}, []int64{INF}, []int{-1}, []int{-1}}
}
func (t *liMin) at(i int, x int64) int64 {
	if t.b[i] == INF {
		return INF
	}
	return t.m[i]*x + t.b[i]
}
func (t *liMin) nn() int {
	t.m = append(t.m, 0)
	t.b = append(t.b, INF)
	t.lc = append(t.lc, -1)
	t.rc = append(t.rc, -1)
	return len(t.m) - 1
}
func (t *liMin) ins(i int, l, r, m, b int64) {
	mid := l + (r-l)/2
	if t.b[i] == INF || m*mid+b < t.at(i, mid) {
		m, t.m[i] = t.m[i], m
		b, t.b[i] = t.b[i], b
	}
	if b == INF || l == r {
		return
	}
	if m*l+b < t.at(i, l) {
		if t.lc[i] == -1 {
			t.lc[i] = t.nn()
		}
		t.ins(t.lc[i], l, mid, m, b)
	} else if m*r+b < t.at(i, r) {
		if t.rc[i] == -1 {
			t.rc[i] = t.nn()
		}
		t.ins(t.rc[i], mid+1, r, m, b)
	}
}
func (t *liMin) q(x int64) int64 {
	i, l, r, best := 0, t.xlo, t.xhi, INF
	for i != -1 {
		if v := t.at(i, x); v < best {
			best = v
		}
		mid := l + (r-l)/2
		if x <= mid {
			i, r = t.lc[i], mid
		} else {
			i, l = t.rc[i], mid+1
		}
	}
	return best
}

func NewMax(xlo, xhi int64) *MaxContainer { return &MaxContainer{newLi(xlo, xhi)} }
func (c *MaxContainer) AddLine(m, b int64) { c.tree.ins(0, c.tree.xlo, c.tree.xhi, -m, -b) }
func (c *MaxContainer) Query(x int64) int64 { return -c.tree.q(x) }

func main() {
	c := NewMax(-1000, 1000)
	c.AddLine(1, 0)  // y = x
	c.AddLine(-1, 0) // y = -x
	c.AddLine(0, 3)  // y = 3
	for _, x := range []int64{-5, 0, 5} {
		fmt.Printf("max at %d = %d\n", x, c.Query(x)) // |x| vs 3
	}
}
```

**Java.**
```java
import java.util.*;

public class MaxContainer {
    static final long INF = (long) 4e18;
    long xlo, xhi;
    ArrayList<long[]> mb = new ArrayList<>();
    ArrayList<int[]> ch = new ArrayList<>();

    MaxContainer(long xlo, long xhi) {
        this.xlo = xlo; this.xhi = xhi;
        mb.add(new long[]{0, INF}); ch.add(new int[]{-1, -1});
    }
    long at(int i, long x) { return mb.get(i)[1] == INF ? INF : mb.get(i)[0] * x + mb.get(i)[1]; }
    int nn() { mb.add(new long[]{0, INF}); ch.add(new int[]{-1, -1}); return mb.size() - 1; }
    void ins(int i, long l, long r, long m, long b) {
        long mid = l + (r - l) / 2;
        if (mb.get(i)[1] == INF || m * mid + b < at(i, mid)) {
            long tm = mb.get(i)[0], tb = mb.get(i)[1];
            mb.set(i, new long[]{m, b}); m = tm; b = tb;
        }
        if (b == INF || l == r) return;
        if (m * l + b < at(i, l)) {
            if (ch.get(i)[0] == -1) ch.get(i)[0] = nn();
            ins(ch.get(i)[0], l, mid, m, b);
        } else if (m * r + b < at(i, r)) {
            if (ch.get(i)[1] == -1) ch.get(i)[1] = nn();
            ins(ch.get(i)[1], mid + 1, r, m, b);
        }
    }
    void addLine(long m, long b) { ins(0, xlo, xhi, -m, -b); }
    long query(long x) {
        int i = 0; long l = xlo, r = xhi, best = INF;
        while (i != -1) {
            best = Math.min(best, at(i, x));
            long mid = l + (r - l) / 2;
            if (x <= mid) { i = ch.get(i)[0]; r = mid; } else { i = ch.get(i)[1]; l = mid + 1; }
        }
        return -best;
    }
    public static void main(String[] args) {
        MaxContainer c = new MaxContainer(-1000, 1000);
        c.addLine(1, 0); c.addLine(-1, 0); c.addLine(0, 3);
        for (long x : new long[]{-5, 0, 5})
            System.out.println("max at " + x + " = " + c.query(x));
    }
}
```

**Python.**
```python
import sys
INF = 1 << 62


class MaxContainer:
    """Maximum line container via negation into a min Li Chao tree."""
    def __init__(self, xlo, xhi):
        self.xlo, self.xhi = xlo, xhi
        self.M = [0]; self.B = [INF]; self.lc = [-1]; self.rc = [-1]

    def _new(self):
        self.M.append(0); self.B.append(INF); self.lc.append(-1); self.rc.append(-1)
        return len(self.M) - 1

    def _at(self, i, x):
        return INF if self.B[i] == INF else self.M[i] * x + self.B[i]

    def _ins(self, i, l, r, m, b):
        mid = (l + r) // 2
        if self.B[i] == INF or m * mid + b < self._at(i, mid):
            m, self.M[i] = self.M[i], m
            b, self.B[i] = self.B[i], b
        if b == INF or l == r:
            return
        if m * l + b < self._at(i, l):
            if self.lc[i] == -1:
                self.lc[i] = self._new()
            self._ins(self.lc[i], l, mid, m, b)
        elif m * r + b < self._at(i, r):
            if self.rc[i] == -1:
                self.rc[i] = self._new()
            self._ins(self.rc[i], mid + 1, r, m, b)

    def add_line(self, m, b):
        self._ins(0, self.xlo, self.xhi, -m, -b)

    def query(self, x):
        i, l, r, best = 0, self.xlo, self.xhi, INF
        while i != -1:
            best = min(best, self._at(i, x))
            mid = (l + r) // 2
            if x <= mid:
                i, r = self.lc[i], mid
            else:
                i, l = self.rc[i], mid + 1
        return -best


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    c = MaxContainer(-1000, 1000)
    for m, b in [(1, 0), (-1, 0), (0, 3)]:
        c.add_line(m, b)
    for x in (-5, 0, 5):
        print(f"max at {x} = {c.query(x)}")  # max(|x|, 3)
```

---

### Challenge 4: Frog Jump DP (CHT classic)

**Problem.** A frog is at stone `1` and wants to reach stone `n`. Stone `i` has height `h[i]`. A jump from `i` to `j>i` costs `(h[i]-h[j])² + C` for a constant `C`. Minimize total cost to reach `n`. Heights are **non-increasing** (so slopes are monotone), classic CHT.

**Insight.** `dp[j] = min_{i<j} ( dp[i] + (h[i]-h[j])² ) + C`. Expand: line for `i` is slope `-2h[i]`, intercept `dp[i]+h[i]²`; query at `h[j]`, add `h[j]²+C`.

**Python.**
```python
class CHT:
    def __init__(self):
        self.ls = []
        self.ptr = 0

    @staticmethod
    def _bad(l1, l2, l3):
        return (l3[1] - l1[1]) * (l1[0] - l2[0]) <= (l2[1] - l1[1]) * (l1[0] - l3[0])

    def add(self, m, b):
        l = (m, b)
        while len(self.ls) >= 2 and self._bad(self.ls[-2], self.ls[-1], l):
            self.ls.pop()
        self.ls.append(l)
        self.ptr = min(self.ptr, len(self.ls) - 1)

    def query(self, x):
        at = lambda i: self.ls[i][0] * x + self.ls[i][1]
        while self.ptr + 1 < len(self.ls) and at(self.ptr + 1) <= at(self.ptr):
            self.ptr += 1
        return at(self.ptr)


def frog(h, C):
    # queries h[j] must be monotone for the pointer; sort/assumption: heights non-increasing
    n = len(h)
    dp = [0] * n
    c = CHT()
    c.add(-2 * h[0], dp[0] + h[0] ** 2)
    for j in range(1, n):
        dp[j] = h[j] ** 2 + C + c.query(h[j])
        c.add(-2 * h[j], dp[j] + h[j] ** 2)
    return dp[n - 1]


if __name__ == "__main__":
    print(frog([10, 8, 5, 3, 1], 2))
```

**Go.**
```go
package main

import "fmt"

type Line struct{ m, b int64 }

func (l Line) at(x int64) int64 { return l.m*x + l.b }

type CHT struct {
	ls  []Line
	ptr int
}

func bad(l1, l2, l3 Line) bool {
	return (l3.b-l1.b)*(l1.m-l2.m) <= (l2.b-l1.b)*(l1.m-l3.m)
}
func (c *CHT) add(m, b int64) {
	l := Line{m, b}
	for len(c.ls) >= 2 && bad(c.ls[len(c.ls)-2], c.ls[len(c.ls)-1], l) {
		c.ls = c.ls[:len(c.ls)-1]
	}
	c.ls = append(c.ls, l)
	if c.ptr >= len(c.ls) {
		c.ptr = len(c.ls) - 1
	}
}
func (c *CHT) query(x int64) int64 {
	if c.ptr >= len(c.ls) {
		c.ptr = len(c.ls) - 1
	}
	for c.ptr+1 < len(c.ls) && c.ls[c.ptr+1].at(x) <= c.ls[c.ptr].at(x) {
		c.ptr++
	}
	return c.ls[c.ptr].at(x)
}

func frog(h []int64, C int64) int64 {
	n := len(h)
	dp := make([]int64, n)
	var c CHT
	c.add(-2*h[0], dp[0]+h[0]*h[0])
	for j := 1; j < n; j++ {
		dp[j] = h[j]*h[j] + C + c.query(h[j])
		c.add(-2*h[j], dp[j]+h[j]*h[j])
	}
	return dp[n-1]
}

func main() {
	fmt.Println(frog([]int64{10, 8, 5, 3, 1}, 2))
}
```

**Java.**
```java
public class Frog {
    static long[] M = new long[200005], B = new long[200005];
    static int sz = 0, ptr = 0;
    static long at(int i, long x) { return M[i] * x + B[i]; }
    static boolean bad(int i1, int i2, long m3, long b3) {
        return (b3 - B[i1]) * (M[i1] - M[i2]) <= (B[i2] - B[i1]) * (M[i1] - m3);
    }
    static void add(long m, long b) {
        while (sz >= 2 && bad(sz - 2, sz - 1, m, b)) sz--;
        M[sz] = m; B[sz] = b; sz++;
        if (ptr >= sz) ptr = sz - 1;
    }
    static long query(long x) {
        if (ptr >= sz) ptr = sz - 1;
        while (ptr + 1 < sz && at(ptr + 1, x) <= at(ptr, x)) ptr++;
        return at(ptr, x);
    }
    static long frog(long[] h, long C) {
        int n = h.length; long[] dp = new long[n];
        sz = 0; ptr = 0;
        add(-2 * h[0], dp[0] + h[0] * h[0]);
        for (int j = 1; j < n; j++) {
            dp[j] = h[j] * h[j] + C + query(h[j]);
            add(-2 * h[j], dp[j] + h[j] * h[j]);
        }
        return dp[n - 1];
    }
    public static void main(String[] args) {
        System.out.println(frog(new long[]{10, 8, 5, 3, 1}, 2));
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"`dp[i] = min_j(m_j·x_i+b_j)` is a lower-envelope query; answer it in `O(log)` or amortized `O(1)` with CHT/Li Chao."*
- Immediately flag the gotchas: **min vs max sign**, **integer overflow** (especially the cross-product), and the **monotone precondition** of the fast CHT.
- Show you can **linearize** a quadratic-looking cost by expanding `(x_i - x_j)²` and factoring out the `i`-only term.
- Default to **Li Chao** for arbitrary order; mention the monotone CHT as the `O(1)` specialization when slopes and queries are sorted.
- Relate it to **D&C optimization** and **Knuth** as the sibling DP optimizations chosen by transition shape.
- Always offer to verify against a brute-force `min_j` oracle (and the whole-DP `O(n²)` oracle) on small inputs.
