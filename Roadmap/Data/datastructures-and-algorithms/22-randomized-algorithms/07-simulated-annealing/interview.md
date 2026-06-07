# Simulated Annealing — Interview Preparation

Simulated annealing is a favourite interview topic because it rewards one crisp insight — *"always accept better moves, accept worse ones with probability `exp(-Δ/T)`, and cool `T` from hot (explore) to cold (exploit)"* — and then tests whether you can (a) explain *why* accepting worse moves escapes local minima, (b) describe cooling schedules and their trade-offs, (c) design a good neighbor/move operator with incremental `Δ`, (d) compare SA to hill climbing, tabu search, and genetic algorithms, and (e) state the convergence theory (Boltzmann stationary distribution, logarithmic-cooling guarantee). This file is a tiered question bank (junior → professional), behavioral prompts, and a full end-to-end coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Answer |
|----------|--------|
| Accept a better move (`Δ ≤ 0`)? | Always |
| Accept a worse move (`Δ > 0`)? | With probability `exp(-Δ/T)` |
| What is `Δ`? | `new_cost − current_cost` |
| High `T`? | Accepts many worse moves → **explore** |
| Low `T`? | Rejects worse moves → **exploit / hill climb** |
| Default cooling | Geometric `T ← α·T`, `α ∈ [0.95, 0.999]` |
| What to return? | The saved **best**, not current |
| Stationary distribution | Boltzmann `π_T(s) ∝ exp(-E(s)/T)` |
| Convergence guarantee | Logarithmic cooling `T_k = d^*/log(k+2)` → global optimum, prob 1 |
| Maximize instead? | Minimize `-objective` |

Core loop:

```text
anneal(start, T0, alpha, Tmin):
    current = start;  best = start
    T = T0
    while T > Tmin:
        neighbor = move(current)
        delta = cost(neighbor) - cost(current)
        if delta <= 0 or random() < exp(-delta/T):
            current = neighbor
        if cost(current) < cost(best):
            best = copy(current)
        T = alpha * T
    return best
```

---

## Junior Questions (14 Q&A)

### J1. What problem does simulated annealing solve?
Global optimization: finding a solution that minimizes (or maximizes) a cost function over a large, rugged search space where exact methods are too slow.

### J2. State the acceptance rule in one sentence.
Always accept a move that is better or equal (`Δ ≤ 0`); accept a worse move (`Δ > 0`) with probability `exp(-Δ/T)`.

### J3. What is `Δ`?
The change in cost from the current solution to the proposed neighbor: `Δ = cost(neighbor) − cost(current)`. Negative means better.

### J4. What does the temperature `T` control?
The willingness to accept worse moves. High `T` → accept many (explore); low `T` → accept few (exploit). It is swept from high to low.

### J5. Why does SA accept worse moves at all?
To escape local minima. A strictly downhill search gets trapped in the first valley; accepting occasional uphill moves lets SA cross ridges to deeper valleys.

### J6. What is the metallurgy analogy?
Heat metal so atoms move freely, then cool slowly so they settle into a strong low-energy crystal. SA "heats" (explores) then "cools" (settles) to a low-cost state.

### J7. What is a cooling schedule? Name the common one.
The rule for lowering `T` over time. The common default is **geometric**: `T ← α·T` with `α` near 1 (e.g. 0.99).

### J8. Why must you track `best` separately from `current`?
Because SA accepts worse moves, the final `current` may not be the best ever visited. You return the saved `best`.

### J9. How is SA different from hill climbing?
Hill climbing only accepts better moves and gets stuck in local minima. SA accepts worse moves with probability `exp(-Δ/T)`, so it escapes them. Same per-step cost.

### J10. What is a "neighbor" or "move"?
A small random change to the current solution (nudge a number, swap two cities, flip a bit). Neighbors should be *close* so changes are gradual.

### J11. What happens to `exp(-Δ/T)` as `T → 0`?
It goes to 0 for any worsening, so SA stops accepting worse moves — it becomes pure hill climbing.

### J12. How do you avoid dividing by zero in `exp(-Δ/T)`?
Stop the loop (or floor `T`) before `T` reaches 0; e.g. run while `T > T_min` for a small `T_min`.

### J13. Is SA deterministic?
No — it uses randomness for proposals and acceptance, so different seeds give different results. Seed the RNG to make a single run reproducible.

### J14. What is the role of the cooling rate `α`?
It controls how fast `T` drops in geometric cooling (`T ← α·T`). Larger `α` (closer to 1) cools slower (more exploration); smaller `α` cools faster (risk of quenching).

---

## Middle Questions (14 Q&A)

### M1. How do you choose `T0`?
From data: sample random moves, measure the typical worsening `Δ̄`, and set `T0 = -Δ̄ / ln(p0)` for a target initial acceptance `p0 ≈ 0.8`.

### M2. What is quenching?
Cooling too fast (small `α` or low `T0`): SA freezes into a poor local minimum, behaving like hill climbing. Fix by cooling slower or starting hotter.

### M3. Compare geometric, linear, and logarithmic cooling.
Geometric (`T←α·T`) is the fast practical default. Linear (`T−step`) wastes time hot. Logarithmic (`c/log(k+2)`) is the only one with a convergence proof but is far too slow to use.

### M4. What makes a good move operator?
Small changes (small `Δ`), full connectivity of the search space, cheap to apply, and ideally an **incremental** `Δ` computable in `O(1)`.

### M5. Give the incremental `Δ` for TSP 2-opt.
Removing edges `(a,b)` and `(c,d)` and reconnecting as `(a,c)`,`(b,d)`: `Δ = dist(a,c)+dist(b,d)−dist(a,b)−dist(c,d)`. `O(1)`, even though the tour has `n` cities.

### M6. Why is the acceptance probability `exp(-Δ/T)` and not something else?
It is the Metropolis rule that makes the Boltzmann distribution `∝ exp(-E/T)` the chain's stationary distribution — the unique symmetric-proposal choice with that property.

### M7. SA vs random-restart hill climbing — when each?
Random-restart suits landscapes with few scattered local minima. SA suits rugged landscapes where one informed trajectory (with restarts) explores better than many blind greedy descents.

### M8. How do you tune the iteration count / `α` to a budget?
Given `I` iterations from `T0` to `T_min`, set `α = (T_min/T0)^(1/I)` so cooling spans exactly the budget.

### M9. Why scale the move/step size with temperature?
Large steps when hot (coarse exploration), small steps when cold (fine refinement). A common choice is step `σ ∝ T`.

### M10. What does the acceptance-rate curve tell you?
It should start ~0.8 and decay smoothly to ~0. A sudden crash to 0 means quenching (cool slower / hotter start); staying high means cooling too slowly.

### M11. SA vs tabu search?
Tabu search avoids cycling by forbidding recently-visited solutions (memory); SA uses probabilistic acceptance (no memory). Tabu can be stronger on structured combinatorial problems; SA is simpler and memoryless.

### M12. How does SA maximize instead of minimize?
Minimize the negated objective: optimize `-g`. Keep `Δ = new_cost − current_cost` with the negated cost.

### M13. What is reheating and when do you use it?
Bumping `T` back up after the search stalls (no improvement for `K` steps), then resuming cooling. It re-injects exploration to escape a basin SA settled into too early, while the global `best` is preserved.

### M14. How do you handle a hard constraint in SA?
Either restrict the move set so every neighbor is feasible, or fold the constraint into the cost as a penalty term `λ·violation` — letting SA violate it while hot and squeezing violations out while cold.

---

## Senior Questions (14 Q&A)

### S1. How do you make SA fast at production scale?
Incremental `Δ` (compute-then-commit), cheap moves, short-circuit `exp` for downhill moves, and reuse buffers. This maximizes iterations/sec, enabling slower cooling and better answers.

### S2. Describe parallel SA strategies.
Independent multi-start (embarrassingly parallel, take best), periodic best-sharing, and **parallel tempering** (replicas at different temperatures swapping configurations). Tempering is strongest on rugged landscapes.

### S3. What is parallel tempering / replica exchange?
Run replicas at temperatures hot→cold; periodically swap configurations between adjacent temperatures with a Metropolis-like criterion, so good configs found hot migrate to cold replicas for refinement.

### S4. How do you make a stochastic SA reproducible?
Seed every RNG explicitly, derive per-worker seeds deterministically from a master seed, aggregate floating-point deterministically (or use fixed-point cost), pin runtime versions, and log seed + params for replay.

### S5. What stopping criteria do you use?
Combine: temperature floor, time/iteration budget, and stagnation (no improvement for `K` steps). On stagnation with budget left, reheat or restart instead of quitting.

### S6. Walk through SA for VLSI placement.
State = cell positions; move = move/swap a cell (windowed, window shrinks as it cools); cost = wirelength + congestion + timing penalties; incremental `Δ` re-evaluates only the nets touched. Origin of the TimberWolf placer.

### S7. How do you handle hard constraints in SA?
Fold them into the cost as **penalty terms** (soft constraints) so the search may violate them while hot and clean them up while cold; or restrict the move set so neighbors are always feasible.

### S8. When would you choose an exact solver over SA?
When a MILP/CP solver can model and solve the instance within budget — you get a **proven optimal** with a certificate. Use SA when the solver cannot finish, or as a post-optimizer on its output.

### S9. How do you diagnose "SA is stuck"?
Watch `best_cost` flatlining early plus an acceptance rate that crashed to 0 — classic quenching. Remedy: raise `α`/`T0`, add reheating, or switch to tempering.

### S10. Trade-off: many short runs vs few long runs?
Many short runs maximize diversity (good if local minima are scattered); few long runs maximize depth (good if the global basin is hard to descend). Tune to the landscape.

### S11. What is "compute-then-commit" and why?
Compute `Δ` from local contributions *without mutating* state; mutate (commit) only if accepted. Avoids expensive rollbacks on rejection, the key to high-throughput SA.

### S12. How does SA fit a service architecture?
Build incremental cost model → fan out `N` seeded workers → aggregate global best → stop on budget/convergence, emitting metrics (acceptance rate, best cost, iters/sec) throughout.

### S13. How do you size the iteration budget for a latency-bound SA service?
Calibrate `iterations_per_second` on representative hardware, multiply by the deadline (minus a serialization margin) for the budget, and set `α` so cooling spans it. Use SA's anytime property to always return the best found by the deadline.

### S14. How do you benchmark SA in CI given its randomness?
Pin a fixed seed and a fixed instance suite, record the best cost, and alert on regressions beyond a tolerance. Without a pinned seed, quality drift hides in the stochastic noise.

---

## Professional / Theory Questions (12 Q&A)

### P1. Model SA as a Markov chain.
Time-homogeneous (fixed `T`) chain with `P_T(s,s') = g(s,s')·min(1, exp(-Δ/T))` for neighbors, plus a self-loop for rejections. Connectivity ⇒ irreducible; worse-neighbor rejections ⇒ aperiodic ⇒ unique stationary distribution.

### P2. What is the stationary distribution and prove it.
Boltzmann `π_T(s) ∝ exp(-E(s)/T)`. Prove via detailed balance: with symmetric proposals, `π_T(s)P_T(s,s') = π_T(s')P_T(s',s)` reduces to `g(s,s')e^{-E(s')/T}/Z` on both sides.

### P3. What happens to `π_T` as `T → 0`?
It concentrates uniformly on the global minima `S^*`: factor out `e^{-E^*/T}`; non-optimal states' numerators vanish, optimal ones stay 1, giving `1/|S^*|` on `S^*`.

### P4. State the logarithmic-cooling convergence theorem.
(Geman-Geman) If `T_k ≥ c^*/log(k+2)` for a landscape constant `c^*`, the cooling chain converges to the uniform distribution on global minima (finds the optimum with prob 1).

### P5. What is Hajek's sharp condition?
SA converges to global minima iff `Σ_k exp(-d^*/T_k) = ∞`, where `d^*` is the **critical depth** — the deepest non-optimal local minimum's barrier. The sharp constant is exactly `c^* = d^*`.

### P6. Why is the convergence guarantee impractical?
Logarithmic cooling needs `~exp(d^*/T)` iterations to reach temperature `T` — exponential in `1/T`. Real systems cool geometrically (exponentially faster) and forgo the guarantee.

### P7. Why does fixed-`T` SA not solve the problem?
It samples from `π_T`, which still has mass on non-optimal states; and as `T→0` the mixing time blows up like `exp(Δ/T)`. Cooling is what tracks `π_T` down to its optimal limit.

### P8. How does the No-Free-Lunch theorem apply?
Averaged over all cost functions, SA cannot beat random search. Its real-world success comes from exploitable landscape structure (small moves → small `Δ`), not universal superiority.

### P9. Relate SA to MCMC.
Fixed-`T` SA is exactly Metropolis-Hastings sampling from `π_T`. SA is "MCMC with an annealed target," in the same family as simulated tempering and annealed importance sampling.

### P10. Why does parallel tempering inherit SA's theory?
It is a product Markov chain over replicas whose swap moves themselves satisfy detailed balance, so the whole construction is a valid MCMC with a known stationary distribution — extending SA's convergence apparatus while mixing faster.

### P11. Why does the partition function `Z(T)` never need to be computed?
Acceptance depends only on the ratio `π_T(s')/π_T(s) = exp(-Δ/T)`, in which the intractable normalizer `Z(T)` cancels. This is the same reason Metropolis-Hastings can sample a distribution known only up to a constant — and what makes SA runnable.

### P12. Relate SA to Langevin dynamics / SGLD.
Continuous SA with Gaussian proposals has a diffusion limit `dX = -∇E dt + sqrt(2T) dW` — the Langevin SDE whose stationary density is again Boltzmann. Annealing `T → 0` gives global convergence (Chiang-Hwang-Sheu); SGLD is its gradient-based discretization, making SA the discrete, gradient-free ancestor of noise-injected optimizers.

---

## Behavioral / Design Prompts (5)

1. *"You shipped SA for route optimization and results vary run to run; a customer reports a regression."* Walk through reproducibility: fixed seeds, replay logs (seed + params + input hash), deterministic aggregation, and a regression test pinning the seed.
2. *"SA returns mediocre tours; how do you debug?"* Plot `best_cost` and acceptance-rate curves; check for quenching (crash to 0) vs drifting; verify `best` (not `current`) is returned; confirm `Δ` is incremental; try restarts/tempering.
3. *"Stakeholder wants a guarantee of optimality."* Explain the logarithmic-cooling theorem and why it is impractical; offer an exact solver (MILP/CP) with a certificate if it fits the budget, or SA + a lower bound to *bound* the gap.
4. *"Cost evaluation is the bottleneck."* Move to compute-then-commit incremental `Δ`; maintain local contributions; short-circuit `exp`; profile iterations/sec.
5. *"Choose between SA and a genetic algorithm for a new problem."* Ask: do solutions recombine meaningfully (favor GA) or is it a single-trajectory rugged landscape with cheap incremental moves (favor SA)? Consider memory (SA `O(1)` vs GA `O(pop)`).

---

## Coding Challenge (3 Languages)

### Challenge: Minimize a multi-modal function with simulated annealing

> **Problem.** Given `f(x) = x·sin(x) + 0.5·cos(2x)` on `[-10, 10]`, find `x` minimizing `f`. The function has several local minima; plain hill climbing from a random start frequently fails. Implement SA with geometric cooling, a temperature floor, best-tracking, and a fixed seed for reproducibility. Return the best `x` and `f(x)`.
>
> **Requirements:** always accept `Δ ≤ 0`; accept `Δ > 0` with probability `exp(-Δ/T)`; cool `T ← α·T`; stop at `T < T_min`; return `best`, not `current`; seed the RNG.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
)

func f(x float64) float64 {
	return x*math.Sin(x) + 0.5*math.Cos(2*x)
}

func clamp(x, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, x))
}

func anneal(seed int64) (bestX, bestE float64) {
	rng := rand.New(rand.NewSource(seed))
	lo, hi := -10.0, 10.0
	T, Tmin, alpha := 10.0, 1e-4, 0.999

	x := lo + rng.Float64()*(hi-lo)
	e := f(x)
	bestX, bestE = x, e
	for T > Tmin {
		sigma := math.Max(0.05, T/10.0*2.0) // step shrinks with T
		xn := clamp(x+(rng.Float64()*2-1)*sigma, lo, hi)
		en := f(xn)
		delta := en - e
		if delta <= 0 || rng.Float64() < math.Exp(-delta/T) {
			x, e = xn, en
		}
		if e < bestE {
			bestX, bestE = x, e
		}
		T *= alpha
	}
	return
}

func main() {
	bx, be := anneal(123)
	fmt.Printf("best x = %.4f, f(x) = %.4f\n", bx, be)
}
```

#### Java

```java
import java.util.Random;

public class Solution {
    static double f(double x) {
        return x * Math.sin(x) + 0.5 * Math.cos(2 * x);
    }

    static double clamp(double x, double lo, double hi) {
        return Math.max(lo, Math.min(hi, x));
    }

    static double[] anneal(long seed) {
        Random rng = new Random(seed);
        double lo = -10, hi = 10;
        double T = 10.0, Tmin = 1e-4, alpha = 0.999;

        double x = lo + rng.nextDouble() * (hi - lo);
        double e = f(x), bestX = x, bestE = e;
        while (T > Tmin) {
            double sigma = Math.max(0.05, T / 10.0 * 2.0);
            double xn = clamp(x + (rng.nextDouble() * 2 - 1) * sigma, lo, hi);
            double en = f(xn), delta = en - e;
            if (delta <= 0 || rng.nextDouble() < Math.exp(-delta / T)) {
                x = xn; e = en;
            }
            if (e < bestE) { bestX = x; bestE = e; }
            T *= alpha;
        }
        return new double[]{bestX, bestE};
    }

    public static void main(String[] args) {
        double[] r = anneal(123);
        System.out.printf("best x = %.4f, f(x) = %.4f%n", r[0], r[1]);
    }
}
```

#### Python

```python
import math
import random


def f(x):
    return x * math.sin(x) + 0.5 * math.cos(2 * x)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def anneal(seed=123):
    rng = random.Random(seed)
    lo, hi = -10.0, 10.0
    T, Tmin, alpha = 10.0, 1e-4, 0.999

    x = rng.uniform(lo, hi)
    e = f(x)
    best_x, best_e = x, e
    while T > Tmin:
        sigma = max(0.05, T / 10.0 * 2.0)           # step shrinks with T
        xn = clamp(x + rng.uniform(-1, 1) * sigma, lo, hi)
        en = f(xn)
        delta = en - e
        if delta <= 0 or rng.random() < math.exp(-delta / T):   # Metropolis
            x, e = xn, en
        if e < best_e:                              # track best!
            best_x, best_e = x, e
        T *= alpha                                  # geometric cooling
    return best_x, best_e


if __name__ == "__main__":
    bx, be = anneal(123)
    print(f"best x = {bx:.4f}, f(x) = {be:.4f}")
```

**Expected:** a point near the global minimum (`f ≈ -9.5` near `x ≈ 7.98` for this `f`), reliably found despite the multiple local minima — where hill climbing from a bad start would fail. Try several seeds and keep the best to see the restart effect.

**Follow-ups the interviewer may ask:**
- *Make it deterministic-optimal* → discuss logarithmic cooling and why it is impractical; or grid + local refine for a 1-D problem.
- *Generalize to TSP* → swap the move for 2-opt and use the incremental `Δ` formula.
- *Parallelize* → independent seeded workers, take the global best; mention parallel tempering.
- *Tune `T0` automatically* → sample random `Δ`, set `T0 = -Δ̄/ln(0.8)`.

---

### Challenge 2: TSP tour with incremental 2-opt SA

> **Problem.** Given `n` city coordinates, find a short closed tour visiting each city exactly once. Implement SA with the **2-opt** move and its `O(1)` incremental `Δ = dist(a,c)+dist(b,d)−dist(a,b)−dist(c,d)`. Maintain a running tour length updated by `Δ` (never recompute the whole tour inside the loop), track `best`, and seed the RNG.
>
> **Why this is the canonical SA interview problem:** it forces you to demonstrate incremental cost evaluation, a structure-preserving move (the tour stays a permutation), and best-tracking — the three things that separate a toy SA from a usable one.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
)

type Pt struct{ X, Y float64 }

func d(a, b Pt) float64 { return math.Hypot(a.X-b.X, a.Y-b.Y) }

func tourLen(p []Pt, t []int) float64 {
	s := 0.0
	for i := range t {
		s += d(p[t[i]], p[t[(i+1)%len(t)]])
	}
	return s
}

func annealTSP(p []Pt, seed int64) ([]int, float64) {
	rng := rand.New(rand.NewSource(seed))
	n := len(p)
	t := rng.Perm(n)
	cur := tourLen(p, t)
	best := append([]int(nil), t...)
	bestLen := cur
	T, Tmin, alpha := cur/float64(n), 1e-6, 0.9995
	for T > Tmin {
		i, k := rng.Intn(n), rng.Intn(n)
		if i == k {
			T *= alpha
			continue
		}
		if i > k {
			i, k = k, i
		}
		a, b := t[i], t[(i+1)%n]
		c, e := t[k], t[(k+1)%n]
		delta := d(p[a], p[c]) + d(p[b], p[e]) - d(p[a], p[b]) - d(p[c], p[e])
		if delta <= 0 || rng.Float64() < math.Exp(-delta/T) {
			for l, r := i+1, k; l < r; l, r = l+1, r-1 { // 2-opt reverse
				t[l], t[r] = t[r], t[l]
			}
			cur += delta
			if cur < bestLen {
				bestLen = cur
				copy(best, t)
			}
		}
		T *= alpha
	}
	return best, bestLen
}

func main() {
	p := []Pt{{0, 0}, {1, 5}, {5, 2}, {6, 6}, {2, 3}, {8, 1}, {3, 7}, {7, 4}}
	_, l := annealTSP(p, 42)
	fmt.Printf("best tour length = %.4f\n", l)
}
```

#### Java

```java
import java.util.Random;

public class TspSA {
    record Pt(double x, double y) {}

    static double d(Pt a, Pt b) { return Math.hypot(a.x() - b.x(), a.y() - b.y()); }

    static double tourLen(Pt[] p, int[] t) {
        double s = 0;
        for (int i = 0; i < t.length; i++) s += d(p[t[i]], p[t[(i + 1) % t.length]]);
        return s;
    }

    static double annealTSP(Pt[] p, long seed) {
        Random rng = new Random(seed);
        int n = p.length;
        int[] t = new int[n];
        for (int i = 0; i < n; i++) t[i] = i;
        for (int i = n - 1; i > 0; i--) { int j = rng.nextInt(i + 1); int tmp = t[i]; t[i] = t[j]; t[j] = tmp; }
        double cur = tourLen(p, t), best = cur;
        double T = cur / n, Tmin = 1e-6, alpha = 0.9995;
        while (T > Tmin) {
            int i = rng.nextInt(n), k = rng.nextInt(n);
            if (i == k) { T *= alpha; continue; }
            if (i > k) { int s = i; i = k; k = s; }
            int a = t[i], b = t[(i + 1) % n], c = t[k], e = t[(k + 1) % n];
            double delta = d(p[a], p[c]) + d(p[b], p[e]) - d(p[a], p[b]) - d(p[c], p[e]);
            if (delta <= 0 || rng.nextDouble() < Math.exp(-delta / T)) {
                for (int l = i + 1, r = k; l < r; l++, r--) { int tmp = t[l]; t[l] = t[r]; t[r] = tmp; }
                cur += delta;
                if (cur < best) best = cur;
            }
            T *= alpha;
        }
        return best;
    }

    public static void main(String[] args) {
        Pt[] p = {new Pt(0,0), new Pt(1,5), new Pt(5,2), new Pt(6,6),
                  new Pt(2,3), new Pt(8,1), new Pt(3,7), new Pt(7,4)};
        System.out.printf("best tour length = %.4f%n", annealTSP(p, 42));
    }
}
```

#### Python

```python
import math
import random


def d(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def tour_len(p, t):
    return sum(d(p[t[i]], p[t[(i + 1) % len(t)]]) for i in range(len(t)))


def anneal_tsp(p, seed=42):
    rng = random.Random(seed)
    n = len(p)
    t = list(range(n))
    rng.shuffle(t)
    cur = tour_len(p, t)
    best, best_len = t[:], cur
    T, Tmin, alpha = cur / n, 1e-6, 0.9995
    while T > Tmin:
        i, k = rng.randrange(n), rng.randrange(n)
        if i == k:
            T *= alpha
            continue
        if i > k:
            i, k = k, i
        a, b = t[i], t[(i + 1) % n]
        c, e = t[k], t[(k + 1) % n]
        delta = d(p[a], p[c]) + d(p[b], p[e]) - d(p[a], p[b]) - d(p[c], p[e])
        if delta <= 0 or rng.random() < math.exp(-delta / T):   # Metropolis
            t[i + 1:k + 1] = reversed(t[i + 1:k + 1])           # 2-opt reverse
            cur += delta                                        # incremental!
            if cur < best_len:
                best_len, best = cur, t[:]
        T *= alpha
    return best, best_len


if __name__ == "__main__":
    _, best_len = anneal_tsp([(0, 0), (1, 5), (5, 2), (6, 6),
                              (2, 3), (8, 1), (3, 7), (7, 4)], 42)
    print(f"best tour length = {best_len:.4f}")
```

**Key points the interviewer is checking:**
- The `Δ` formula is `O(1)` — four distance lookups regardless of `n`. Recomputing `tour_len` inside the loop would be the rookie mistake.
- The segment reversal applies the move *only on acceptance*; on rejection nothing mutates (compute-then-commit).
- `best` is copied (not aliased) so later moves cannot corrupt the saved tour.
- A final `assert abs(tour_len(p, best) - best_len) < 1e-6` catches floating-point drift in the running total — a good thing to mention proactively.

---

**Next step:** Practice with [`tasks.md`](./tasks.md) — 15 graded exercises (beginner → advanced) plus a benchmark task, all in Go, Java, and Python.
