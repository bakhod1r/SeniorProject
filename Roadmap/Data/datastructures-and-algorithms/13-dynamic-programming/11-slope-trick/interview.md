# Slope Trick — Interview Preparation

Slope Trick is a high-signal interview topic because it rewards a single crisp insight — *"a DP whose state is a convex piecewise-linear cost function can be carried as two heaps of breakpoints plus a minimum value"* — and then tests whether you can (a) recognize that the carried function is convex, (b) translate each transition into the operation catalog (`|x−a|`, one-sided ramps, prefix-min, shift), (c) keep the heap directions and lazy offsets consistent, and (d) reduce variants (strict vs non-strict, min vs max) correctly. This file is a curated question bank by seniority, behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool / Operation | Cost |
|----------|------------------|------|
| Carry a convex PL cost function `f(x)` | `(minVal, L max-heap, R min-heap)` | `O(1)` read |
| Match this element to value `a` | `add |x − a|` | `O(log n)` |
| Penalize exceeding `a` | `(x − a)_+`: push to `R` | `O(log n)` |
| Penalize falling below `a` | `(a − x)_+`: push to `L` | `O(log n)` |
| Later value may be `≥` current | prefix-min: clear `R` | `O(1)` |
| Later value may be `≤` current | prefix-min: clear `L` | `O(1)` |
| Function shifts right by `c` | lazy offset bump | `O(1)` |
| Whole make-monotone DP | relax + `add |x − a|` per step | `O(n log n)` |
| Maximize a concave function | mirror everything (negate) | same |
| Verify | brute `O(n·V)` table DP | `O(nV)` |

The function/heap correspondence (reconstruction formula):

```text
f(x) = minVal + Σ_{l in L} max(0, l - x) + Σ_{r in R} max(0, x - r)
L = max-heap of left breakpoints (top = left floor)
R = min-heap of right breakpoints (top = right floor)
argmin interval = [L.top(), R.top()]
```

`add |x − a|` (the core primitive):
```
push a into L; push a into R
if L.top() > R.top():
    l = L.pop(); r = R.pop(); minVal += l - r; push r into L; push l into R
```

Key facts:
- The carried function must be **convex** (or concave, mirrored) — non-convex is *unrepresentable*.
- `L` is a **max-heap**, `R` is a **min-heap** — swapping them is the #1 bug.
- Prefix-min relaxation = **clearing one heap**; it encodes a monotone constraint.
- Lazy offsets make shifts `O(1)`; reset the offset when you clear a heap.
- Strict-increasing reduces to non-decreasing via `c_i = a_i − i`.
- Complexity is `O(n log n)`, **independent of the value range** `V`.

---

## Junior Questions (12 Q&A)

### J1. What kind of DP does Slope Trick optimize?
A DP whose *state* at each step is a one-variable **convex piecewise-linear cost function** `f_i(x)` (best cost so far given the current value is `x`), updated step by step with penalties like `|x − a|`. The answer is `min_x f_n(x)`.

### J2. What does "convex piecewise-linear" mean?
The function's graph is made of straight segments, and the slopes of those segments only *increase* as `x` grows — a valley shape. Convexity means it bends only upward.

### J3. How is the function stored without storing every value?
By its **breakpoints** (where the slope changes) and its **minimum value**. Left-of-floor breakpoints go in a max-heap `L`, right-of-floor breakpoints in a min-heap `R`, and `minVal` is a scalar.

### J4. Why two heaps, one max and one min?
So that `L.top()` (the largest left breakpoint) and `R.top()` (the smallest right breakpoint) are the *boundaries of the flat minimum region* — readable in `O(1)`. The max-heap exposes the left floor, the min-heap the right floor.

### J5. What does `add |x − a|` do to the representation?
Push `a` into both heaps. If the tops then cross (`L.top() > R.top()`), the floor rose: pop both, add `L.top() − R.top()` to `minVal`, and push them back swapped.

### J6. What is the prefix-min relaxation?
Replacing `f(x)` with `min_{y ≤ x} f(y)` — the value may "slide right freely". In the representation this just **clears the right heap `R`**, flattening the ascending side.

### J7. What is the classic problem Slope Trick solves?
Minimum total cost `Σ |a_i − b_i|` to turn an array into a **non-decreasing** (or strictly increasing) one. Each step is: clear `R` (relax), then `add |x − a_i|`; the answer accumulates in `minVal`.

### J8. What is the time complexity?
`O(n log n)` for `n` steps (each does `O(1)` heap operations of `O(log n)`), and crucially it is **independent of the value range** — a range of `10¹⁸` costs nothing extra.

### J9. What breaks if the function is not convex?
Everything. A non-convex function has multiple valleys and *cannot* be written as `minVal` + two breakpoint heaps. Slope Trick is invalid; convexity is a hard precondition.

### J10. What is `minVal`?
The current minimum value of the carried function — the valley floor height. It is maintained incrementally (incremented on each rebalance), never recomputed by scanning.

### J11. Can the cost overflow?
Yes. `minVal` can reach `n · maxValue`. Use 64-bit (`int64`/`long`).

### J12 (analysis). Why does clearing a heap cost `O(1)` amortized?
Each breakpoint is inserted once and deleted (cleared) at most once across the whole run, so the *total* clearing work over `n` steps is `O(n)` — amortized `O(1)` per step.

### J13. What does the argmin region of `f` correspond to?
The flat interval `[L.top(), R.top()]` where `f` attains `minVal`. Any value in this interval is an optimal choice for the current element. In the make-monotone problem it is the range of equally-good values for `b_i`.

### J14. Why store negatives in Python's heapq for the max-heap?
`heapq` is a min-heap only. To get a max-heap, push `−value` and negate on pop. This is simpler and faster than wrapping values in a comparison class.

---

## Middle Questions (14 Q&A)

### M1. State the reconstruction formula.
`f(x) = minVal + Σ_{l ∈ L} max(0, l − x) + Σ_{r ∈ R} max(0, x − r)`. It says the value at `x` is the floor plus one unit per left-breakpoint you are below and per right-breakpoint you are above.

### M2. Why must `minVal` increase on a rebalance?
When the tops cross during `add |x − a|`, the V's arm raised the old floor; the amount it rose is exactly `L.top() − R.top()` before swapping. Forgetting to add it under-counts the cost.

### M3. How do one-sided penalties differ from `|x − a|`?
`(x − a)_+ = max(x − a, 0)` adds a single **right** breakpoint (push to `R`); `(a − x)_+` adds a single **left** breakpoint (push to `L`). They model asymmetric costs (e.g. late is penalized, early is free).

### M4. How do lazy offsets work and when do you need them?
Store `addL`, `addR` so a stored raw value `v` means true value `v + add`. A horizontal shift bumps the offsets in `O(1)` instead of re-keying every breakpoint. Needed when the function shifts horizontally (rate-limited / floor-widening transitions).

### M5. Why reset a heap's offset when you clear it?
Because the next push stores `true − add`; a stale offset would place new breakpoints at wrong true positions, corrupting all subsequent costs.

### M6. How does the strict-increasing variant reduce to non-decreasing?
Set `c_i = a_i − i`. Then `b_i < b_{i+1} ⟺ (b_i − i) ≤ (b_{i+1} − (i+1))`, and `|a_i − b_i| = |c_i − d_i|` with `d_i = b_i − i`. So solve the non-decreasing problem on `c`.

### M7. When can you collapse to a single heap?
When every step relaxes the same side (clears `R`), `R` stays empty, so you keep only `L` (max-heap) and `minVal`. This is the make-non-decreasing routine.

### M8. How does Slope Trick differ from Convex Hull Trick?
Slope Trick *edits one convex function* step by step; CHT *selects the minimum over many lines* `min_j(m_j x + b_j)`. Different transition shapes. Slope Trick's structure is two heaps; CHT's is a line deque or Li Chao tree.

### M9. What is the discriminator between the two?
Ask: is the DP state a *function of `x`* that I edit (add penalty, relax)? → Slope Trick. Is the DP *value a number computed as a min over candidate lines*? → CHT.

### M10. Which convexity-preserving operations are in the catalog?
Adding any convex PL term (`|x−a|`, ramps), prefix-min on either side, horizontal shift, adding a constant, and infimal convolution with a convex function (floor-widening). All keep `f` convex.

### M11. Which operations break convexity?
Subtracting a convex term (adding a concave one), a downward spike/reward, a forbidden interval (value can't be in `[p,q]`), or composing with a non-monotone map. Any of these invalidates Slope Trick.

### M12 (analysis). Why is the complexity independent of the value range?
Nothing is indexed by value — the heaps store *breakpoints* (at most `O(n)` of them), not a per-value table. So the cost is `O(n log n)` whether the range is `100` or `10¹⁸`.

### M13. How do you handle weighted penalties `w·|x − a|`?
Treat the weight as the breakpoint's multiplicity: push `a` with count `w`. For large weights, store `(value, count)` pairs in the heap and move `min(count_l, count_r)` units per rebalance, keeping the work `O(n log n)` rather than `O(Σ w)`.

### M14. What is the reconstruction formula and why does it matter?
`f(x) = minVal + Σ_L max(0, l−x) + Σ_R max(0, x−r)`. It is the *semantic contract* of the representation: every operation is defined and verified by how it transforms this formula's value. It lets you unit-test each operation by evaluating `f` two ways.

---

## Senior Questions (14 Q&A)

### S1. Where does Slope Trick appear in production?
Just-in-time scheduling (earliness/tardiness penalties), L1 isotonic regression (monotone curve fitting under absolute loss), and logistics smoothing (a quantity changing under convex holding/shortage costs with rate limits).

### S2. How do you reconstruct the actual optimal array, not just the cost?
Snapshot the floor boundary (`L.top()` or `R.top()`) after each step; backward, set `b_n =` final argmin and `b_i = min(b_{i+1}, snapshot_i)` for non-decreasing. Assert the recomputed cost equals `minVal`.

### S3. Why are Slope-Trick bugs dangerous?
They are **silent**: a corrupted convex representation still returns *a* number, an offset drift still places breakpoints *somewhere*, a wrong reduction is correct on symmetric tests. No crash — just a wrong answer that ships.

### S4. What invariant would you assert in debug builds?
`L.top() + addL ≤ R.top() + addR` (heaps do not overlap — the function is convex) after every operation, and `minVal` is non-decreasing across penalty additions.

### S5. How do you test a Slope-Trick solution?
A whole-DP brute `O(n·V)` oracle on small random inputs (catches modeling errors), the I1 convexity assertion, symmetry property tests (reversed input gives the mirrored cost), and a reconstruction checksum.

### S6. How do you decide between Slope Trick, CHT, and plain DP?
Editable convex function → Slope Trick; `min` over lines → CHT; small value range with arbitrary transition → plain `O(n·V)` DP; Monge but non-linear → D&C or Knuth optimization.

### S7. What is the cost of reconstruction in time and memory?
`O(n)` extra memory (one boundary snapshot per step) and `O(n)` time for the backward pass. Storing the whole heap per step is `O(n²)` and almost never needed.

### S8. How do you handle a maximization (concave) problem?
Negate the function — carry `−f` — and reuse the convex (min) engine, negating the final answer. This reuses the proven code instead of hand-flipping every heap direction and comparison.

### S9. How would you classify whether a new problem is Slope-Trick-amenable?
Check: state is a 1-variable cost function; prove it is convex by induction (base convex, each transition a convexity-preserving catalog op); express the final answer as `min_x f_n(x)`. If any cost term is concave, it is not amenable.

### S10. What does the prefix-min relaxation correspond to in the make-monotone DP?
The monotone constraint: after committing `b_i`, the next `b_{i+1}` must be `≥ b_i`, so the cost to reach `b_{i+1} = x` is `min_{y ≤ x} f_i(y)` — exactly clearing the right heap.

### S11. When do you need two distinct lazy offsets instead of one?
When the two sides shift independently — e.g. the floor widens asymmetrically (right side moves out by `k`, left stays). A global shift bumps both equally and could use one; keep offsets out entirely unless the problem demands them.

### S12 (analysis). What scheduling penalty shape makes it a clean Slope-Trick DP?
A convex (asymmetric V) penalty `α·(d − t)_+ + β·(t − d)_+` per job — a sum of one-sided ramps. The carried "minimum penalty vs completion time" function stays convex, so each job is a couple of ramp additions plus relaxations.

### S13. How would you debug a Slope-Trick solution that is wrong on one large test but right on small ones?
This is the signature of a silent bug. Check, in order: (1) the I1 invariant `L.top() ≤ R.top()` — if it fails, a non-convex term or offset drift slipped in; (2) heap directions; (3) the `minVal` increment on rebalance; (4) the reduction (strict vs non-strict). Reproduce on the smallest failing input by binary-searching the test, then assert against the brute oracle.

### S14. When is plain `O(n·V)` DP the better engineering choice over Slope Trick?
When the value range `V` is small (say `≤ 10³`) and the team values simplicity and obvious correctness over the `log` factor. The table DP is trivial to write and verify; Slope Trick's payoff appears only when `V` is large enough to make the table infeasible. Pick the simplest tool that meets the constraints.

---

## Professional / Theory Questions (8 Q&A)

### P1. Prove the reconstruction formula `f(x) = minVal + Σ_L max(0, l−x) + Σ_R max(0, x−r)`.
Both sides are convex PL. They agree on the floor `[max L, min R]` (all `max(0,·)` terms vanish there, giving `minVal`). The slopes match: crossing a left breakpoint `l` going left adds slope `−1` per its multiplicity; crossing a right breakpoint `r` going right adds `+1`. Equal value on an interval plus equal slope jumps everywhere ⇒ identical functions.

### P2. Prove `add |x − a|` is correct.
`|x − a| = max(0, a−x) + max(0, x−a)`, so by the formula it is "push `a` to `L` and `R`". This may break the no-overlap invariant `max L ≤ min R` only if `a` is outside the floor; the rebalance pops the crossed tops `l, r`, charges `minVal += l − r` (the floor rose by that), and re-inserts swapped to restore the invariant — leaving the multiset union (hence the function) correct.

### P3. Prove prefix-min `min_{y ≤ x} f(y)` clears the right heap.
For convex `f` with floor `[ℓ, r]`: for `x ≥ ℓ` the min over `y ≤ x` reaches the floor, so the result is `minVal` (flat); for `x < ℓ` it equals `f(x)` (the descending side). That is exactly the formula with `R = ∅`. The minimum value is unchanged.

### P4. Why is convexity necessary (not just convenient)?
A non-convex PL function has non-monotone slopes and multiple local minima; the reconstruction formula is convex for *every* choice of breakpoint multisets, so no triple `(minVal, L, R)` can represent it. It is a representability impossibility, not a performance caveat.

### P5. Prove the `O(n log n)` complexity and value-range independence.
`n` steps × `O(1)` catalog operations × `O(log n)` per heap op; clears amortize to `O(n)` total (each breakpoint deleted at most once). No structure is indexed by value, so the range `V` never appears. Total `O(n log n)`, space `O(n)`.

### P6. State the lower bound.
`Ω(n log n)` in the comparison model: the make-monotone optimum encodes order statistics of `a`, so an `o(n log n)` algorithm would sort faster than the comparison bound allows. The heap work *is* the necessary incremental sort.

### P7. How does Slope Trick relate to L-convexity / Monge?
It efficiently solves a 1D **L♮-convex** program: a separable convex objective subject to difference constraints (`b_{i+1} − b_i ≥ 0`). Discrete convex analysis guarantees the parametric optimal-value function stays convex (the induction), and the Monge structure makes the greedy "pull the top down" rebalance globally optimal.

### P8. Relate floor-widening to infimal convolution.
"You may move forward by `0..c`" is infimal convolution with the box indicator `h(x) = 0` on `[0,c]`, `+∞` else: `(f □ h)(x) = min_{x−c ≤ u ≤ x} f(u)`. For convex `f` this shifts the right floor out by `c`, implemented by a lazy offset `addR += c` in `O(1)`.

### P9. Is the computed cost affected by how ties are broken in the heaps?
No. The cost (`minVal`) depends only on the breakpoint *multisets* and `minVal`, not on internal ordering of equal elements. Two correct implementations with different tie orders agree on the cost. Only the *reconstructed witness* `b` can differ under ties.

### P10. Why is the make-monotone optimum the median of merged pools?
It is exactly L1 isotonic regression, whose solution is the median of each maximal pool of adjacent violators. The Slope-Trick floor at each step is the median of the active pool, which is why the two-heap structure (left max-heap, right min-heap) mirrors the streaming-median structure — both track a median via balanced heaps.

### P11. State the overflow bound for make-monotone.
For `|a_i| ≤ A`, the final `minVal ≤ 2nA` (each step lifts the floor by at most the spread `2A`). With `n ≤ 10⁶`, `A ≤ 10⁹`, that is `≤ 2·10¹⁵`, safely inside `int64`. No products are computed (unlike CHT), so this accumulation is the only overflow surface.

### P12. Place Slope Trick in discrete convex analysis.
It solves a 1D **L♮-convex** minimization: separable convex objective plus difference constraints. The catalog operations (add separable convex, partial minimization, infimal convolution with a box) are all L♮-convexity-preserving, so the value function stays L♮-convex — a unified theorem covering every operation, and the abstract reason the induction goes through.

---

## Behavioral / Communication Prompts

- **Explain Slope Trick to a teammate in two minutes.** Lead with "the DP state is a convex valley-shaped cost function; we store only the valley floor's height and the breakpoints, as two heaps." Then show `add |x−a|` and the make-monotone loop.
- **A reviewer says your answer is wrong on one large test but right on small ones.** Walk through the silent-failure modes: non-convexity slipping in, offset drift after a clear, wrong heap direction. Reach for the I1 assertion and the brute oracle.
- **Justify choosing Slope Trick over a table DP.** The value range is huge (`10⁹`+); the table DP is `O(nV)` and infeasible, while Slope Trick is `O(n log n)` and range-independent.
- **Defend the convexity precondition.** Show that one concave cost term creates a second valley that the two heaps cannot represent — so you must prove convexity before coding, not after.

---

## Problem Patterns to Recognize

Interviewers rarely say "use Slope Trick" — they describe a problem and expect you to spot the structure. The recurring signals:

| Problem phrasing | Likely Slope-Trick mapping |
|------------------|----------------------------|
| "make the array non-decreasing / non-increasing with minimum total change" | make-monotone DP; relax + `add |x − a_i|` |
| "make it strictly increasing" | the same after `c_i = a_i − i` |
| "fit a monotone curve minimizing absolute deviation" | L1 isotonic regression = make-monotone |
| "minimize earliness + tardiness penalties in a fixed job order" | scheduling DP; one-sided ramps + shifts |
| "the quantity may change by at most `k` per step, minimize convex cost" | rate-limited DP; lazy floor-widening |
| "equalize values under a monotone profile" | equalization = make-monotone (median tracking) |

The common thread: a **convex cost as a function of a single evolving quantity**, with penalties for deviating from targets and a monotonicity or rate constraint linking consecutive steps. If you see that shape, carry the convex function in two heaps.

### A 60-second recognition drill

Given a transition, answer three questions fast:
1. Is the state a cost *function* `f(x)` of one variable? (If it is a single number minimized over lines → CHT.)
2. Does each step *add a convex penalty* and/or *take a prefix-min*? (If it subtracts or forbids → not Slope Trick.)
3. Is the answer `min_x f_n(x)`? (If you need the whole function at the end, that is fine; if you need something non-convex of it, reconsider.)

Three yeses → write the two-heap engine. This drill is what separates candidates who *memorized* the make-monotone code from those who *understand* the technique well enough to apply it to an unfamiliar problem.

## Coding Challenge (3 Languages)

### Challenge: Minimum Cost to Make an Array Non-Decreasing

> Given an integer array `a`, find the minimum total cost `Σ |a_i − b_i|` over all non-decreasing arrays `b` (`b_1 ≤ b_2 ≤ … ≤ b_n`). Solve in `O(n log n)` with Slope Trick (single max-heap), and validate against the `O(n·V)` brute oracle.

**Approach.** Carry the convex cost function. Each step relaxes (later `b` may be larger ⇒ clear the right side, leaving only a max-heap `L`) and adds `|x − a_i|`: push `a_i`; if the heap top now exceeds `a_i`, pull it down to `a_i` and pay the difference. The accumulated cost is the answer.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

type maxHeap []int64

func (h maxHeap) Len() int            { return len(h) }
func (h maxHeap) Less(i, j int) bool  { return h[i] > h[j] }
func (h maxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxHeap) Push(x interface{}) { *h = append(*h, x.(int64)) }
func (h *maxHeap) Pop() interface{}   { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func minCostNonDecreasing(a []int64) int64 {
	L := &maxHeap{}
	heap.Init(L)
	var cost int64
	for _, v := range a {
		heap.Push(L, v)
		if (*L)[0] > v {
			top := heap.Pop(L).(int64)
			cost += top - v
			heap.Push(L, v)
		}
	}
	return cost
}

func bruteForce(a []int64) int64 {
	const V = 60
	prev := make([]int64, V)
	for x := 0; x < V; x++ {
		prev[x] = abs64(a[0] - int64(x))
	}
	for i := 1; i < len(a); i++ {
		cur := make([]int64, V)
		best := int64(1 << 60)
		for x := 0; x < V; x++ {
			if prev[x] < best {
				best = prev[x]
			}
			cur[x] = best + abs64(a[i]-int64(x))
		}
		prev = cur
	}
	ans := int64(1 << 60)
	for _, v := range prev {
		if v < ans {
			ans = v
		}
	}
	return ans
}

func abs64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func main() {
	tests := [][]int64{{3, 1, 2}, {5, 4, 3, 2, 1}, {1, 2, 3}, {2, 2, 1, 1, 1}}
	for _, t := range tests {
		fmt.Printf("a=%v  slope=%d  brute=%d\n", t, minCostNonDecreasing(t), bruteForce(t))
	}
}
```

#### Java

```java
import java.util.*;

public class Solution {
    static long minCostNonDecreasing(long[] a) {
        PriorityQueue<Long> L = new PriorityQueue<>(Collections.reverseOrder());
        long cost = 0;
        for (long v : a) {
            L.add(v);
            if (L.peek() > v) {
                long top = L.poll();
                cost += top - v;
                L.add(v);
            }
        }
        return cost;
    }

    static long bruteForce(long[] a) {
        final int V = 60;
        long[] prev = new long[V];
        for (int x = 0; x < V; x++) prev[x] = Math.abs(a[0] - x);
        for (int i = 1; i < a.length; i++) {
            long[] cur = new long[V];
            long best = Long.MAX_VALUE / 4;
            for (int x = 0; x < V; x++) {
                best = Math.min(best, prev[x]);
                cur[x] = best + Math.abs(a[i] - x);
            }
            prev = cur;
        }
        long ans = Long.MAX_VALUE / 4;
        for (long v : prev) ans = Math.min(ans, v);
        return ans;
    }

    public static void main(String[] args) {
        long[][] tests = {{3, 1, 2}, {5, 4, 3, 2, 1}, {1, 2, 3}, {2, 2, 1, 1, 1}};
        for (long[] t : tests)
            System.out.println("a=" + Arrays.toString(t)
                + " slope=" + minCostNonDecreasing(t)
                + " brute=" + bruteForce(t));
    }
}
```

#### Python

```python
import heapq


def min_cost_non_decreasing(a):
    L = []  # max-heap via negation
    cost = 0
    for v in a:
        heapq.heappush(L, -v)
        if -L[0] > v:
            top = -heapq.heappop(L)
            cost += top - v
            heapq.heappush(L, -v)
    return cost


def brute_force(a):
    V = 60
    prev = [abs(a[0] - x) for x in range(V)]
    for i in range(1, len(a)):
        best = float("inf")
        cur = []
        for x in range(V):
            best = min(best, prev[x])
            cur.append(best + abs(a[i] - x))
        prev = cur
    return min(prev)


if __name__ == "__main__":
    tests = [[3, 1, 2], [5, 4, 3, 2, 1], [1, 2, 3], [2, 2, 1, 1, 1]]
    for t in tests:
        print(f"a={t} slope={min_cost_non_decreasing(t)} brute={brute_force(t)}")
```

**Expected output (all three):**
```
a=[3 1 2]  slope=2  brute=2
a=[5 4 3 2 1]  slope=6  brute=6
a=[1 2 3]  slope=0  brute=0
a=[2 2 1 1 1]  slope=1  brute=1
```

### Follow-up Challenge: Strictly Increasing Variant

> Same problem but `b` must be **strictly** increasing. Reduce to the non-decreasing routine.

```python
def min_cost_strictly_increasing(a):
    c = [a[i] - i for i in range(len(a))]   # the key reduction
    return min_cost_non_decreasing(c)
```

In Go/Java, transform `a[i] -= i` (use a copy) before calling `minCostNonDecreasing`. The cost is identical to the non-decreasing problem on `c`; reconstructing the actual `b` requires the backward-pass snapshot described in `senior.md` Section 5.

### Discussion points the interviewer looks for

- Recognizing the carried function is **convex** and stays convex (proof by induction).
- Translating the monotone constraint into a **prefix-min relaxation** (clearing a heap).
- Correct **heap direction** (`L` max-heap) and **`minVal` accounting** on the pull.
- The **`c_i = a_i − i`** reduction for the strict variant.
- Validating against the **brute `O(n·V)` oracle** and noting Slope Trick's **value-range independence**.

### Second Challenge: Two-Heap Running Median (the structural cousin)

> Maintain the median of a stream of integers, supporting `add(x)` and `median()`. Use a max-heap for the lower half and a min-heap for the upper half, rebalancing to keep their sizes within one. This is the structural cousin of Slope Trick: the same two heaps, the same `L.top() ≤ R.top()` invariant, with the median sitting in the floor interval.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

type maxH []int
func (h maxH) Len() int { return len(h) }
func (h maxH) Less(i, j int) bool { return h[i] > h[j] }
func (h maxH) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *maxH) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *maxH) Pop() interface{} { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

type minH []int
func (h minH) Len() int { return len(h) }
func (h minH) Less(i, j int) bool { return h[i] < h[j] }
func (h minH) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *minH) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *minH) Pop() interface{} { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

type MedianStream struct{ lo *maxH; hi *minH }

func NewMedianStream() *MedianStream {
	m := &MedianStream{lo: &maxH{}, hi: &minH{}}
	heap.Init(m.lo); heap.Init(m.hi)
	return m
}
func (m *MedianStream) Add(x int) {
	heap.Push(m.lo, x)
	heap.Push(m.hi, heap.Pop(m.lo))
	if m.hi.Len() > m.lo.Len() {
		heap.Push(m.lo, heap.Pop(m.hi))
	}
}
func (m *MedianStream) Median() float64 {
	if m.lo.Len() > m.hi.Len() {
		return float64((*m.lo)[0])
	}
	return (float64((*m.lo)[0]) + float64((*m.hi)[0])) / 2
}

func main() {
	m := NewMedianStream()
	for _, x := range []int{5, 1, 3, 2, 4} {
		m.Add(x)
		fmt.Printf("after %d: median=%.1f\n", x, m.Median())
	}
}
```

#### Java

```java
import java.util.*;

public class MedianStream {
    PriorityQueue<Integer> lo = new PriorityQueue<>(Collections.reverseOrder());
    PriorityQueue<Integer> hi = new PriorityQueue<>();
    void add(int x) {
        lo.add(x);
        hi.add(lo.poll());
        if (hi.size() > lo.size()) lo.add(hi.poll());
    }
    double median() {
        if (lo.size() > hi.size()) return lo.peek();
        return (lo.peek() + hi.peek()) / 2.0;
    }
    public static void main(String[] args) {
        MedianStream m = new MedianStream();
        for (int x : new int[]{5, 1, 3, 2, 4}) {
            m.add(x);
            System.out.printf("after %d: median=%.1f%n", x, m.median());
        }
    }
}
```

#### Python

```python
import heapq

class MedianStream:
    def __init__(self):
        self.lo = []  # max-heap via negation
        self.hi = []  # min-heap
    def add(self, x):
        heapq.heappush(self.lo, -x)
        heapq.heappush(self.hi, -heapq.heappop(self.lo))
        if len(self.hi) > len(self.lo):
            heapq.heappush(self.lo, -heapq.heappop(self.hi))
    def median(self):
        if len(self.lo) > len(self.hi):
            return -self.lo[0]
        return (-self.lo[0] + self.hi[0]) / 2

if __name__ == "__main__":
    m = MedianStream()
    for x in [5, 1, 3, 2, 4]:
        m.add(x)
        print(f"after {x}: median={m.median()}")
```

**The connection to articulate:** both structures keep `top(lo) ≤ top(hi)` (the I1 invariant) and the answer lives in the gap `[top(lo), top(hi)]`. Slope Trick generalizes this from "track the median" to "track the entire convex cost function" — the median is just the minimizer of `Σ |x − a_i|`, which is exactly the floor of the carried function. Recognizing this parallel signals deep understanding.
