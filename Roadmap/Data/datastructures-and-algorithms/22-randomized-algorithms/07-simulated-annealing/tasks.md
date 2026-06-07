# Simulated Annealing — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a precise spec and starter code. Implement the SA logic and validate against the evaluation criteria.
> **Golden rules to check in every task:** always accept `Δ ≤ 0`; accept `Δ > 0` with probability `exp(-Δ/T)`; cool `T` every iteration; never divide by `T = 0` (use a `T_min` floor); and **return the saved `best`, not the final `current`**. Seed your RNG for reproducible grading.

---

## Beginner Tasks (5)

### Task 1 — The Metropolis acceptance function

**Problem.** Implement `accept(delta, T, u)` returning `true` iff a move with cost change `delta` should be accepted at temperature `T`, given a uniform random `u ∈ [0,1)`. Rule: accept if `delta <= 0`, else accept iff `u < exp(-delta/T)`.

**Spec.** Inputs: `delta` (float), `T > 0` (float), `u ∈ [0,1)` (float). Output: boolean.

**Constraints.** Do not call `exp` when `delta <= 0` (short-circuit). Assume `T > 0`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func accept(delta, T, u float64) bool {
	// TODO: short-circuit for delta <= 0, else compare u to exp(-delta/T)
	_ = math.Exp
	return false
}

func main() {
	fmt.Println(accept(-1, 5, 0.9)) // true (better)
	fmt.Println(accept(2, 5, 0.3))  // true if 0.3 < exp(-0.4)=0.670
	fmt.Println(accept(2, 0.1, 0.3))// false (cold: exp(-20)≈0)
}
```

**Starter — Java.**
```java
public class Task1 {
    static boolean accept(double delta, double T, double u) {
        // TODO
        return false;
    }
    public static void main(String[] args) {
        System.out.println(accept(-1, 5, 0.9));
        System.out.println(accept(2, 5, 0.3));
        System.out.println(accept(2, 0.1, 0.3));
    }
}
```

**Starter — Python.**
```python
import math

def accept(delta, T, u):
    # TODO
    return False

if __name__ == "__main__":
    print(accept(-1, 5, 0.9))
    print(accept(2, 5, 0.3))
    print(accept(2, 0.1, 0.3))
```

- **Evaluation:** correct boolean for better/worse moves; no `exp` call when `delta <= 0`.

---

### Task 2 — Geometric cooling schedule

**Problem.** Write `cooling(T0, alpha, Tmin)` that returns the list of temperatures `T0, T0·α, T0·α², …` down to (but not below) `Tmin`. Then report how many steps it takes.

**Spec.** Inputs: `T0`, `alpha ∈ (0,1)`, `Tmin`. Output: the count of temperatures `> Tmin`.

**Constraints.** `0 < alpha < 1`, `0 < Tmin < T0`. The closed form is `ceil(log(Tmin/T0)/log(alpha))` — verify your loop matches it.

**Starter — Python.**
```python
import math

def cooling_steps(T0, alpha, Tmin):
    # TODO: count multiply-by-alpha steps from T0 down to Tmin
    return 0

if __name__ == "__main__":
    print(cooling_steps(10.0, 0.99, 1e-3))  # ~916
```
*(Provide equivalent Go and Java starters.)*

- **Evaluation:** loop count equals the closed-form value; handle `alpha` near 1.

---

### Task 3 — Minimize a 1-D function

**Problem.** Minimize `f(x) = (x-3)^2 + 2` on `[-10, 10]` with SA. (This is convex — a sanity check; SA should find `x ≈ 3`, `f ≈ 2`.)

**Spec.** Implement geometric cooling, best-tracking, fixed seed. Return `(best_x, best_f)`.

**Constraints.** `T0 = 5`, `alpha = 0.995`, `Tmin = 1e-3`, move = `x ± uniform(0,1)`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
	"math/rand"
)

func f(x float64) float64 { return (x-3)*(x-3) + 2 }

func anneal(seed int64) (float64, float64) {
	// TODO: SA loop with best-tracking; clamp x to [-10,10]
	_ = rand.NewSource
	_ = math.Exp
	return 0, 0
}

func main() {
	x, fx := anneal(1)
	fmt.Printf("%.3f %.3f\n", x, fx) // ~3.000 ~2.000
}
```
*(Provide equivalent Java and Python starters.)*

- **Evaluation:** `best_f` within `0.01` of `2.0`; returns `best`, not `current`.

---

### Task 4 — Best-so-far tracking with mutable state

**Problem.** Minimize the same `f(x)=(x-3)^2+2` but store the solution as a 1-element list/slice `[x]` (a mutable container). Demonstrate that you must **copy** into `best`, not alias it.

**Spec.** Keep `current = [x]` and `best = [x]`. After updating `current[0]`, ensure `best` is unaffected unless you explicitly copy.

**Constraints.** Show one buggy run (aliasing) and one correct run (copy), printing both results.

**Starter — Python.**
```python
import math, random

def f(x):
    return (x - 3) ** 2 + 2

def anneal(seed, alias_bug):
    rng = random.Random(seed)
    current = [rng.uniform(-10, 10)]
    best = current if alias_bug else current[:]   # BUG vs COPY
    # TODO: SA loop; on improvement set best
    return best[0], f(best[0])

if __name__ == "__main__":
    print(anneal(1, alias_bug=True))   # likely wrong
    print(anneal(1, alias_bug=False))  # correct
```
*(Provide equivalent Go and Java starters using slices/arrays.)*

- **Evaluation:** correct run returns `best_f ≈ 2`; the aliasing run visibly differs.

---

### Task 5 — Maximize via negation

**Problem.** SA minimizes. Maximize `g(x) = -(x-2)^2 + 10` on `[-10,10]` by minimizing `-g`. The maximum is `10` at `x=2`.

**Spec.** Define `cost(x) = -g(x)`; run SA; report `best_x` and `g(best_x)`.

**Constraints.** Confirm `g(best_x) ≈ 10` and `best_x ≈ 2`.

**Starter — Java.**
```java
import java.util.Random;

public class Task5 {
    static double g(double x) { return -(x - 2) * (x - 2) + 10; }
    static double cost(double x) { return -g(x); }
    static double[] anneal(long seed) {
        // TODO: minimize cost; track best
        return new double[]{0, 0};
    }
    public static void main(String[] args) {
        double[] r = anneal(2);
        System.out.printf("x=%.3f g=%.3f%n", r[0], g(r[0]));
    }
}
```
*(Provide equivalent Go and Python starters.)*

- **Evaluation:** `g(best_x)` within `0.01` of `10`.

---

## Intermediate Tasks (5)

### Task 6 — Auto-tune `T0` from sampled deltas

**Problem.** Implement `estimate_T0(f, lo, hi, rng, p0=0.8)` that samples ~100 random moves, averages the positive `Δ`, and returns `T0 = -Δ̄ / ln(p0)`. Use it to anneal a multi-modal `f`.

**Spec.** Return `T0`; then run SA with it and report the best.

**Constraints.** Handle the case of zero positive deltas (fall back to `T0 = 1`).

**Starter — Python.**
```python
import math, random

def estimate_T0(f, lo, hi, rng, p0=0.8):
    # TODO: sample 100 random moves, average positive deltas, return -avg/ln(p0)
    return 1.0
```
*(Provide Go and Java starters.)*

- **Evaluation:** early acceptance rate measured over the first 200 iterations is ~0.8 (±0.1).

---

### Task 7 — Temperature-scaled step size

**Problem.** Minimize `f(x)=sin(x)·x` on `[-15,15]` with a step size `σ = max(0.05, k·T)` so moves shrink as it cools. Compare final quality against a fixed step `σ = 1.0` over 10 seeds.

**Spec.** Report mean `best_f` for both step strategies.

**Constraints.** Same `T0, alpha, Tmin` for both; only the step rule differs.

**Starter — Go.**
```go
// TODO: two anneal variants (scaled vs fixed step); average best over seeds 0..9
```
*(Provide full Go, Java, Python.)*

- **Evaluation:** scaled-step mean `best_f` is no worse than fixed-step (usually better).

---

### Task 8 — Acceptance-rate logging

**Problem.** Instrument SA to record the **windowed acceptance rate** (fraction of proposed moves accepted, in windows of 100 iterations). Return the list of window rates.

**Spec.** Run on any multi-modal `f`; output the acceptance-rate curve.

**Constraints.** The curve should start high (~0.8) and decay toward ~0.

**Starter — Python.**
```python
def anneal_logged(f, lo, hi, seed):
    # TODO: track accepted/proposed per 100-iter window; return list of rates
    return []
```
*(Provide Go and Java starters.)*

- **Evaluation:** first window rate `> 0.6`, last window rate `< 0.1`.

---

### Task 9 — SA for TSP with 2-opt (incremental Δ)

**Problem.** Given `n` 2-D points, find a short tour with SA using the **2-opt** move and the incremental `Δ = dist(a,c)+dist(b,d)−dist(a,b)−dist(c,d)`. Maintain a running `cur` length updated by `Δ` (never recompute the whole tour inside the loop).

**Spec.** Input: list of points. Output: best tour length.

**Constraints.** Use incremental `Δ`; `T0 = tour_len/n`, `alpha = 0.9995`, `Tmin = 1e-4`. Validate `cur` against a full recompute at the end.

**Starter — Python.**
```python
import math, random

def dist(a, b):
    return math.hypot(a[0]-b[0], a[1]-b[1])

def tour_len(pts, t):
    return sum(dist(pts[t[i]], pts[t[(i+1) % len(t)]]) for i in range(len(t)))

def sa_tsp(pts, seed=0):
    # TODO: 2-opt move, incremental delta, best-tracking
    return float("inf")
```
*(Provide Go and Java starters.)*

- **Evaluation:** final `cur` equals a fresh `tour_len(best)`; result beats a random tour and beats greedy 2-opt-from-start on rugged instances.

---

### Task 10 — Multiple restarts

**Problem.** Wrap any SA into `multi_start(R, ...)` that runs `R` independent SA trajectories with distinct deterministic seeds and returns the global best. Show that `R=20` beats `R=1` on a multi-modal `f`.

**Spec.** Output: best over all restarts, plus how many restarts found the global basin.

**Constraints.** Per-restart seed = `base_seed + r`.

**Starter — Java.**
```java
public class Task10 {
    static double[] multiStart(int R, long baseSeed) {
        // TODO: run R anneals, keep global best
        return new double[]{0, 0};
    }
}
```
*(Provide Go and Python starters.)*

- **Evaluation:** `R=20` mean best strictly better than `R=1` mean best over 10 base seeds.

---

## Advanced Tasks (5)

### Task 11 — Reheating on stagnation

**Problem.** Add reheating: if no improvement to `best` occurs in `K` consecutive iterations, reset `T` back to a fraction of `T0` (e.g. `0.5·T0`) and continue. Show it escapes a basin that plain geometric cooling gets stuck in.

**Spec.** Parameter `K` (stagnation window). Output: best with and without reheating on the same seed.

**Constraints.** Cap total reheats to avoid infinite runs; respect a global iteration budget.

**Starter — Python.**
```python
def anneal_reheat(f, lo, hi, seed, K=2000, max_reheats=5):
    # TODO: track iterations since last improvement; reheat when it exceeds K
    return None
```
*(Provide Go and Java starters.)*

- **Evaluation:** on a crafted rugged `f`, reheating finds a strictly better `best` than no-reheat for the same seed.

---

### Task 12 — Parallel multi-start (threads/processes)

**Problem.** Run `N` SA workers concurrently (goroutines / `ExecutorService` / `ProcessPoolExecutor`) with deterministic per-worker seeds, and aggregate the global best. Ensure the result is reproducible (same `N` + same base seed ⇒ same best).

**Spec.** Output: global best length/cost and the seed that produced it.

**Constraints.** No shared mutable state without synchronization; deterministic aggregation (e.g. reduce by min in a fixed order).

**Starter — Go.**
```go
// TODO: launch N goroutines, each runs saWorker(seed); collect bests under a mutex
```
*(Provide Go, Java, Python.)*

- **Evaluation:** identical output across two runs with the same `N` and base seed; faster wall-clock than sequential for `N>1`.

---

### Task 13 — Parallel tempering (replica exchange)

**Problem.** Implement parallel tempering: maintain `m` replicas at temperatures `T_1 < T_2 < … < T_m`. Each replica does SA-style local moves at its fixed temperature; every `L` steps, attempt to swap adjacent replicas `i, i+1` with probability `min(1, exp((E_i − E_{i+1})·(1/T_i − 1/T_{i+1})))`. Return the global best across all replicas.

**Spec.** Inputs: cost function, `m` temperatures, swap interval `L`. Output: best cost.

**Constraints.** Swap criterion must satisfy detailed balance (use the formula above). Track the global best across replicas and time.

**Starter — Python.**
```python
import math, random

def parallel_tempering(cost, neighbor, init, temps, L, steps, seed=0):
    # TODO: m replicas; local Metropolis moves; periodic adjacent swaps
    return float("inf")
```
*(Provide Go and Java starters.)*

- **Evaluation:** on a rugged landscape, tempering finds a better best than single-temperature SA with the same total move budget.

---

### Task 14 — Constraint penalties (scheduling)

**Problem.** Schedule `J` jobs (each with a duration and a deadline) onto `M` machines to minimize **total tardiness**, encoded as a soft penalty `Σ max(0, finish_j − deadline_j)`. Move = reassign or swap a job between machines. Use SA with incremental penalty updates (only the affected machines change).

**Spec.** Input: jobs (duration, deadline), `M`. Output: best total tardiness and the assignment.

**Constraints.** Incremental `Δ` (do not recompute all machines per move); validate final cost by full recompute.

**Starter — Java.**
```java
public class Task14 {
    // jobs[j] = {duration, deadline}; assign to machines; minimize total tardiness
    static double anneal(int[][] jobs, int M, long seed) {
        // TODO: SA with reassign/swap moves and incremental tardiness delta
        return Double.MAX_VALUE;
    }
}
```
*(Provide Go and Python starters.)*

- **Evaluation:** incremental cost matches full recompute; result beats round-robin assignment.

---

### Task 15 — Schedule comparison harness

**Problem.** Build a harness that runs SA on the same TSP/function instance with **geometric**, **linear**, **logarithmic**, and **Lundy-Mees** cooling schedules under an equal *iteration budget*, and reports each schedule's mean best over 10 seeds plus the acceptance-rate curves.

**Spec.** Output: a small table of `schedule → mean best, std`.

**Constraints.** Equalize total iterations across schedules so the comparison is fair.

**Starter — Python.**
```python
def compare_schedules(instance, schedules, budget, seeds):
    # schedules: dict name -> function(k, T0, ...) -> T_k
    # TODO: run SA under each schedule for `budget` iters over `seeds`; tabulate
    return {}
```
*(Provide Go and Java starters.)*

- **Evaluation:** geometric and Lundy-Mees outperform logarithmic at equal *practical* budget (logarithmic cools too slowly to reach cold within budget); table is reproducible.

---

## Benchmark Task

> Compare SA performance across all 3 languages: time to run a fixed iteration budget on a multi-modal function, and the best value found (with a fixed seed for fairness).

#### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
	"time"
)

func f(x float64) float64 { return x*math.Sin(x) + 0.5*math.Cos(2*x) }

func annealN(seed int64, iters int) float64 {
	rng := rand.New(rand.NewSource(seed))
	lo, hi := -10.0, 10.0
	x := lo + rng.Float64()*(hi-lo)
	e := f(x)
	best := e
	T := 10.0
	alpha := math.Pow(1e-4/10.0, 1.0/float64(iters))
	for i := 0; i < iters; i++ {
		sigma := math.Max(0.05, T/10.0*2.0)
		xn := math.Max(lo, math.Min(hi, x+(rng.Float64()*2-1)*sigma))
		en := f(xn)
		d := en - e
		if d <= 0 || rng.Float64() < math.Exp(-d/T) {
			x, e = xn, en
		}
		if e < best {
			best = e
		}
		T *= alpha
	}
	return best
}

func main() {
	for _, iters := range []int{10000, 100000, 1000000} {
		start := time.Now()
		best := annealN(42, iters)
		fmt.Printf("iters=%8d: best=%.4f  time=%.3f ms\n",
			iters, best, float64(time.Since(start).Microseconds())/1000.0)
	}
}
```

#### Java

```java
public class Benchmark {
    static double f(double x) { return x * Math.sin(x) + 0.5 * Math.cos(2 * x); }

    static double annealN(long seed, int iters) {
        java.util.Random rng = new java.util.Random(seed);
        double lo = -10, hi = 10;
        double x = lo + rng.nextDouble() * (hi - lo), e = f(x), best = e;
        double T = 10.0, alpha = Math.pow(1e-4 / 10.0, 1.0 / iters);
        for (int i = 0; i < iters; i++) {
            double sigma = Math.max(0.05, T / 10.0 * 2.0);
            double xn = Math.max(lo, Math.min(hi, x + (rng.nextDouble() * 2 - 1) * sigma));
            double en = f(xn), d = en - e;
            if (d <= 0 || rng.nextDouble() < Math.exp(-d / T)) { x = xn; e = en; }
            if (e < best) best = e;
            T *= alpha;
        }
        return best;
    }

    public static void main(String[] args) {
        for (int iters : new int[]{10000, 100000, 1000000}) {
            long start = System.nanoTime();
            double best = annealN(42, iters);
            double ms = (System.nanoTime() - start) / 1_000_000.0;
            System.out.printf("iters=%8d: best=%.4f  time=%.3f ms%n", iters, best, ms);
        }
    }
}
```

#### Python

```python
import math, random, time


def f(x):
    return x * math.sin(x) + 0.5 * math.cos(2 * x)


def anneal_n(seed, iters):
    rng = random.Random(seed)
    lo, hi = -10.0, 10.0
    x = rng.uniform(lo, hi)
    e = f(x)
    best = e
    T = 10.0
    alpha = (1e-4 / 10.0) ** (1.0 / iters)
    for _ in range(iters):
        sigma = max(0.05, T / 10.0 * 2.0)
        xn = max(lo, min(hi, x + rng.uniform(-1, 1) * sigma))
        en = f(xn)
        d = en - e
        if d <= 0 or rng.random() < math.exp(-d / T):
            x, e = xn, en
        if e < best:
            best = e
        T *= alpha
    return best


if __name__ == "__main__":
    for iters in (10_000, 100_000, 1_000_000):
        start = time.perf_counter()
        best = anneal_n(42, iters)
        ms = (time.perf_counter() - start) * 1000
        print(f"iters={iters:>8}: best={best:.4f}  time={ms:.3f} ms")
```

**What to observe:** more iterations → slower cooling → better `best` (anytime behavior); Go/Java run far faster per iteration than Python; and the best value converges toward the global minimum as the budget grows. Use this harness to justify your iteration budget for a given latency target.
