# Slope Trick — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the convex-function (two-heap) logic and validate against the evaluation criteria.
> **Always test against a brute-force `O(n·V)` table-DP oracle (or a direct brute over feasible `b`) on small inputs before trusting the Slope-Trick structure.**

---

## Beginner Tasks (5)

### Task 1 — Brute-force make-non-decreasing oracle (the reference)

**Problem.** Implement `bruteCost(a)` returning the minimum `Σ |a_i − b_i|` over non-decreasing `b`, using an `O(n·V)` table DP over a small value range. This is the oracle every later task validates against.

**Input / Output spec.**
- Read `n`, then `n` integers `a_1 … a_n` (all in `[0, 50]`).
- Print `bruteCost(a)`.

**Constraints.** `1 ≤ n ≤ 1000`, `0 ≤ a_i ≤ 50`. Use `int64`/`long`.

**Hint.** `dp[i][x] = (min over y ≤ x of dp[i-1][y]) + |a_i − x|`; carry a running prefix-min across `x`.

**Starter — Go.**
```go
package main

import "fmt"

func bruteCost(a []int64) int64 {
	const V = 60
	// TODO: table DP with prefix-min over x
	return 0
}

func main() {
	fmt.Println(bruteCost([]int64{3, 1, 2})) // expect 2
}
```

**Starter — Java.**
```java
public class Task1 {
    static long bruteCost(long[] a) {
        final int V = 60;
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        System.out.println(bruteCost(new long[]{3, 1, 2})); // expect 2
    }
}
```

**Starter — Python.**
```python
def brute_cost(a):
    V = 60
    # TODO: table DP with prefix-min over x
    return 0

if __name__ == "__main__":
    print(brute_cost([3, 1, 2]))  # expect 2
```

- **Evaluation:** correctness on `[3,1,2]→2`, `[1,2,3]→0`, `[5,4,3,2,1]→6`.

---

### Task 2 — Slope-Trick make-non-decreasing (single max-heap)

**Problem.** Implement `slopeCost(a)` with a single max-heap: for each `a_i`, push it; if the top exceeds `a_i`, pop it, add `top − a_i` to the cost, and push `a_i` back. Return the cost.

**Constraints.** `1 ≤ n ≤ 10⁶`, `|a_i| ≤ 10⁹`. Use 64-bit.

**Hint.** This is exactly the relax-then-`add |x−a_i|` loop where `R` stays empty.

**Starter — Go.**
```go
package main

import (
	"container/heap"
	"fmt"
)

type maxHeap []int64
func (h maxHeap) Len() int { return len(h) }
func (h maxHeap) Less(i, j int) bool { return h[i] > h[j] }
func (h maxHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *maxHeap) Push(x interface{}) { *h = append(*h, x.(int64)) }
func (h *maxHeap) Pop() interface{} { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func slopeCost(a []int64) int64 {
	// TODO: single max-heap routine
	return 0
}

func main() { fmt.Println(slopeCost([]int64{3, 1, 2})) } // expect 2
```

**Starter — Java.**
```java
import java.util.*;
public class Task2 {
    static long slopeCost(long[] a) {
        PriorityQueue<Long> L = new PriorityQueue<>(Collections.reverseOrder());
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        System.out.println(slopeCost(new long[]{3, 1, 2})); // expect 2
    }
}
```

**Starter — Python.**
```python
import heapq

def slope_cost(a):
    L = []  # max-heap via negation
    # TODO
    return 0

if __name__ == "__main__":
    print(slope_cost([3, 1, 2]))  # expect 2
```

- **Evaluation:** matches Task 1 on random arrays; handles `n = 10⁶` in time.

---

### Task 3 — Make non-increasing

**Problem.** Minimum `Σ |a_i − b_i|` over **non-increasing** `b` (`b_1 ≥ b_2 ≥ …`). Solve by reversing the array and reusing Task 2 (a non-increasing array is a non-decreasing array read backward).

**Constraints.** Same as Task 2.

**Hint.** `nonIncreasingCost(a) = slopeCost(reverse(a))`.

**Starter spec (all languages).** Implement `nonIncreasingCost(a)` returning the cost; internally reverse `a` and call your Task-2 routine. Validate against a brute `O(n·V)` non-increasing oracle (prefix-min becomes suffix-min, i.e. min over `y ≥ x`).

- **Evaluation:** `[1,2,3] → 2`, `[3,2,1] → 0`, `[1,3,2] → 1`.

---

### Task 4 — Reconstruct the optimal non-decreasing array

**Problem.** Extend Task 2 to also return one optimal `b`. Snapshot the floor (`L.top()` after each pull) per step; backward, set `b_n =` last snapshot and `b_i = min(b_{i+1}, snapshot_i)`. Assert the recomputed cost equals the Slope-Trick cost.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** Store `bound[i] = L.top()` after processing `a_i`; backward-propagate the non-decreasing constraint.

**Starter — Python.**
```python
import heapq

def solve(a):
    L = []
    cost = 0
    bound = []
    for v in a:
        heapq.heappush(L, -v)
        if -L[0] > v:
            top = -heapq.heappop(L)
            cost += top - v
            heapq.heappush(L, -v)
        bound.append(-L[0])      # floor after this step
    n = len(a)
    b = [0] * n
    b[-1] = bound[-1]
    for i in range(n - 2, -1, -1):
        b[i] = min(bound[i], b[i + 1])
    assert sum(abs(a[i] - b[i]) for i in range(n)) == cost
    return cost, b

if __name__ == "__main__":
    print(solve([3, 1, 2]))  # (2, [1, 1, 2])
```

- **Evaluation:** the returned `b` is non-decreasing and recomputes to the reported cost.

---

### Task 5 — Maximize a concave function (mirror)

**Problem.** Given `a`, find the **maximum** of `Σ (−|a_i − b_i|)` (equivalently minimum `Σ|a_i − b_i|`) subject to non-decreasing `b` — but implement it by *negating* and reusing the convex min engine, to practice the min↔max mirror. Confirm the mirrored result equals the direct cost.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** The maximum total reward is `−(minimum total cost)`. Carry `−f` (concave) by negating, or simply return `−slopeCost(a)` and verify.

**Starter spec (all languages).** Implement `maxReward(a) = -slopeCost(a)` and assert `maxReward(a) == -bruteCost(a)` on random small inputs. Write one sentence explaining why mirroring (negation) is safer than hand-flipping every heap comparison.

- **Evaluation:** the assertion passes; explanation correctly identifies that negation touches only two sites.

---

## Intermediate Tasks (5)

### Task 6 — Strictly increasing (CF 713C)

**Problem.** Minimum `Σ |a_i − b_i|` over **strictly increasing** `b`. Reduce to non-decreasing via `c_i = a_i − i`, then call Task 2.

**Constraints.** `1 ≤ n ≤ 5·10⁵`, `|a_i| ≤ 10⁹`. Use 64-bit (the `−i` can make `c_i` negative).

**Hint.** `strictCost(a) = slopeCost([a[i] - i for i in range(n)])`.

**Starter — Go.**
```go
func strictCost(a []int64) int64 {
	c := make([]int64, len(a))
	for i := range a {
		c[i] = a[i] - int64(i)
	}
	return slopeCost(c) // from Task 2
}
```

**Starter — Java / Python:** analogous (`c[i] = a[i] - i`, then `slopeCost(c)`).

- **Evaluation:** validate against a brute over feasible strictly-increasing `b` on small `n`; check the classic CF 713C sample.

---

### Task 7 — Full two-heap engine with the operation catalog

**Problem.** Implement a `Slope` class/struct supporting `addAbs(a)` (|x−a|), `addRampUp(a)` ((x−a)_+), `addRampDown(a)` ((a−x)_+), `relaxLeft()` (clear `R`), `relaxRight()` (clear `L`), `shift(c)` (lazy), and `minimum()`. Maintain `minVal`, `L` (max-heap), `R` (min-heap), `addL`, `addR`.

**Constraints.** Each operation `O(log n)` (or `O(1)` for relax/shift/minimum).

**Hint.** Push `true − add`; read `raw + add`; reset offset on clear. Assert `L.top()+addL ≤ R.top()+addR` after each mutation in debug.

**Starter spec (all languages).** Implement the engine, then re-solve make-non-decreasing as `relaxLeft(); addAbs(a_i)` per step and confirm it matches Task 2.

- **Evaluation:** all catalog methods correct; invariant assertion never fires on valid (convex) input.

---

### Task 8 — Asymmetric (earliness/tardiness) penalty

**Problem.** Given target values `d_i` and weights `α, β`, minimize `Σ [ α·(d_i − b_i)_+ + β·(b_i − d_i)_+ ]` over non-decreasing `b`. Each step relaxes then adds `α` ramp-downs and `β` ramp-ups at `d_i`.

**Constraints.** `1 ≤ n ≤ 10⁵`, small `α, β ≤ 100`.

**Hint.** Adding the asymmetric V with slope `−α` left and `+β` right means pushing `d_i` into `L` repeated `α` times and into `R` repeated `β` times (with rebalances) — or use weighted breakpoints. For small `α, β`, repeated pushes are acceptable.

**Starter spec (all languages).** Implement `jitCost(d, alpha, beta)` using the Task-7 engine (`relaxLeft`, then `alpha × addRampDown(d_i)`, `beta × addRampUp(d_i)`). Validate against a brute `O(n·V)` DP with the asymmetric penalty.

- **Evaluation:** matches the brute oracle; degenerate `α = β = 1` reproduces the make-non-decreasing cost.

---

### Task 9 — Classify: is this DP Slope-Trick-amenable?

**Problem.** Given several DP transition descriptions (as text), classify each as **Slope Trick**, **Convex Hull Trick**, or **neither**, with a one-line reason. Implement a small function returning the label for a few hard-coded cases, but the real deliverable is the reasoning.

Cases to classify:
1. `f_i(x) = (min_{y ≤ x} f_{i-1}(y)) + |x − a_i|`
2. `dp[i] = min_{j<i}(dp[j] + (x_i − x_j)²)`
3. `f_i(x) = f_{i-1}(x) − |x − a_i|` (a reward for being far)
4. `f_i(x) = f_{i-1}(x) + max(0, x − a_i)` then `shift(1)`
5. `dp[i][j] = min_k(dp[i][k] + dp[k+1][j]) + w(i,j)` with `w` Monge

**Hint.** Editable convex function → Slope Trick; min over lines → CHT; concave term or interval-merge → neither (the last is Knuth).

- **Evaluation:** 1 → Slope Trick; 2 → CHT; 3 → neither (concave, non-convex); 4 → Slope Trick; 5 → neither (Knuth). Reasons must cite convexity / line-form / shape.

---

### Task 10 — Lazy-shift floor widening

**Problem.** Solve a smoothing DP: a quantity `b_i` must satisfy `b_i ≤ b_{i+1} ≤ b_i + k` (may rise by at most `k` per step) and minimize `Σ |a_i − b_i|`. Use the Task-7 engine: each step `relaxLeft()`, then widen the floor by bumping `addR += k` (the right side may move out by `k`), then `addAbs(a_i)`.

**Constraints.** `1 ≤ n ≤ 10⁵`, `0 ≤ k ≤ 10⁹`.

**Hint.** The "rise by at most `k`" is the box infimal convolution that shifts the right floor out by `k` — a single `addR += k`.

**Starter spec (all languages).** Implement `smoothCost(a, k)` and validate against a brute `O(n·V²)` (or `O(n·V·k)`) DP on small inputs.

- **Evaluation:** matches the brute oracle; `k = ∞` (very large) reduces to the unconstrained make-non-decreasing cost.

---

## Advanced Tasks (5)

### Task 11 — Both-sided constraint (unimodal target)

**Problem.** Make `b` first non-decreasing up to some index then non-increasing (a "mountain"), minimizing `Σ |a_i − b_i|`. Run the non-decreasing Slope Trick left-to-right (cost `up[i]` of making prefix non-decreasing ending at peak `i`) and right-to-left (cost `down[i]`), then combine. Requires per-position cost arrays, not just the final `minVal`.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** Compute prefix make-non-decreasing costs and suffix make-non-increasing costs; the answer is `min_i (up_to_i + down_from_i − |a_i − peak|)` carefully avoiding double counting; simpler: `min_i (prefixCost[i] + suffixCost[i+1])`.

**Starter spec (all languages).** Implement `mountainCost(a)`; validate against a brute that tries every peak index with an `O(n·V)` DP per side on small inputs.

- **Evaluation:** matches the brute oracle on small random arrays.

---

### Task 12 — L1 isotonic regression with weights

**Problem.** Given points `(a_i)` and positive integer weights `w_i`, fit a non-decreasing `b` minimizing `Σ w_i·|a_i − b_i|`. Generalize the single-heap routine: a weighted point is `w_i` breakpoints at `a_i` (push `w_i` copies, with `w_i` possible pulls).

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ w_i ≤ 100`.

**Hint.** Weight `w_i` = multiplicity `w_i` of the breakpoint at `a_i`. For larger weights, store `(value, count)` pairs in the heap to avoid `Σ w_i` pushes.

**Starter spec (all languages).** Implement `weightedIsotonicCost(a, w)`; validate against a brute `O(n·V)` weighted DP.

- **Evaluation:** matches the oracle; equal weights reduce to Task 2.

---

### Task 13 — Reconstruct under a tie-break rule

**Problem.** For make-non-decreasing, when the optimal `b` is not unique, return the **lexicographically smallest** optimal `b`. Augment the floor snapshot and backward pass to prefer smaller values on ties.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** On the backward pass, when both `bound[i]` and `b_{i+1}` are valid, take the smaller; verify cost equals `minVal`, then check no smaller feasible `b` has equal cost on small inputs.

**Starter spec (all languages).** Implement `solveLexSmallest(a)` returning `(cost, b)`; validate `b` is lexicographically smallest among optimal arrays by brute force on small `n`.

- **Evaluation:** `b` is optimal in cost and lexicographically minimal.

---

### Task 14 — Differential test: Slope Trick vs CHT

**Problem.** For a DP solvable both ways (e.g. a separable-convex monotone fit that also admits a line formulation on a transformed instance), implement *both* a Slope-Trick solution and a Convex-Hull-Trick solution and assert they produce identical costs on random inputs. Where they disagree, the brute oracle localizes the bug.

**Constraints.** `n ≤ 2000` for the differential harness.

**Hint.** Use the make-non-decreasing problem for Slope Trick and a brute `min_j` oracle (or a Li Chao tree from sibling `10`) for the line-based check on the same instance; the point is the *methodology* of cross-validation.

**Starter spec (all languages).** Implement the harness: generate random small instances, run both solvers and the brute oracle, assert all three agree.

- **Evaluation:** the harness runs thousands of random cases with no mismatch.

---

### Task 15 — Streaming median connection

**Problem.** Show empirically that the make-non-decreasing single-heap routine, when the array is already used as the *running fit*, relates to the two-heaps **streaming median**. Implement a streaming-median structure (max-heap of the lower half, min-heap of the upper half) and observe that its rebalance logic mirrors the Slope-Trick `add |x−a|`. Compare outputs on a stream and write a short note on the structural parallel.

**Constraints.** `1 ≤ n ≤ 10⁶` for the median stream.

**Hint.** Both keep a max-heap and a min-heap with `top(L) ≤ top(R)`; the Slope-Trick floor `[L.top, R.top]` is the median interval. The parallel is that the convex function's minimizer (the median of the breakpoints) is what both structures track.

**Starter spec (all languages).** Implement `runningMedian(stream)` with two heaps; write a comment explaining how its invariant `top(L) ≤ top(R)` is the same (I1) invariant Slope Trick maintains.

- **Evaluation:** correct running medians; a clear written note on the Slope-Trick ↔ median heap parallel.

---

## Benchmark Task

> Compare make-non-decreasing performance across all 3 languages: Slope Trick (`O(n log n)`) vs the table DP (`O(n·V)`). Show the table DP becoming infeasible as `V` grows while Slope Trick stays flat in `V`.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, n := range sizes {
		a := make([]int64, n)
		for i := range a {
			a[i] = int64(rand.Intn(1_000_000_000)) // huge range: kills table DP
		}
		start := time.Now()
		_ = slopeCost(a) // from Task 2
		fmt.Printf("n=%7d  slope=%.3f ms\n", n, float64(time.Since(start).Microseconds())/1000.0)
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        Random rnd = new Random(1);
        for (int n : sizes) {
            long[] a = new long[n];
            for (int i = 0; i < n; i++) a[i] = rnd.nextInt(1_000_000_000);
            long start = System.nanoTime();
            Task2.slopeCost(a); // your Task-2 routine
            System.out.printf("n=%7d  slope=%.3f ms%n", n, (System.nanoTime() - start) / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import random
import time

sizes = [1000, 10000, 100000, 1000000]
for n in sizes:
    a = [random.randint(0, 1_000_000_000) for _ in range(n)]
    start = time.perf_counter()
    slope_cost(a)  # from Task 2
    print(f"n={n:>7}  slope={(time.perf_counter() - start) * 1000:.3f} ms")
```

- **Expected observation:** Slope Trick scales as `O(n log n)` and is unaffected by the `10⁹` value range; the table DP (if you add it) is infeasible at that range, demonstrating Slope Trick's value-range independence.
