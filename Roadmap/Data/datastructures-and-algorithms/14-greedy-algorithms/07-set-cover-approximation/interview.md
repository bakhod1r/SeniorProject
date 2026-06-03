# Set Cover Approximation — Interview Preparation

Greedy Set Cover is a favorite for interviews that probe the boundary between greedy algorithms, NP-hardness, and approximation theory. It is simple enough to state in one sentence, deep enough to ask "why is the ratio exactly `ln n`," and practical enough to turn into a coding challenge (cover everything with the fewest sets, weighted cost, max coverage under a budget). This file is a curated bank of questions by seniority, behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Fact | Statement |
|------|-----------|
| Problem | Cover universe `U` with the fewest given sets (or least total cost). **NP-hard.** |
| Greedy rule | Repeatedly pick the set covering the most **still-uncovered** elements. |
| Weighted rule | Pick the set with the smallest **cost / newly-covered count**. |
| Guarantee | `greedy ≤ H(n)·OPT`, `H(n) = 1 + 1/2 + … + 1/n ≈ ln n + 1` (also `H(d)`, `d` = largest set). |
| Tightness | Halving instances force `≈ ln n · OPT`; the bound is real. |
| Hardness | No poly algorithm beats `(1−o(1))·ln n` unless `P = NP` (Feige). |
| Max coverage | Maximize coverage with `k` sets → greedy gives `1 − 1/e ≈ 0.632` (tight). |
| LP | `OPT_LP ≤ OPT`; integrality gap `Θ(log n)`; frequency rounding → `f`-approx. |
| Vertex cover | Set cover with frequency `f = 2` → `2`-approximation. |
| Submodularity | Coverage has diminishing returns → why greedy works. |
| Complexity | `~O(m·n)` naive; `O(N log m)` with inverted index. |
| Feasible iff | union of all sets = `U`. |

Build recipe (unweighted):

```text
covered[] = false; numCovered = 0; chosen = []
while numCovered < n:
    pick set with MAX (# uncovered elements it contains)
    mark its elements covered; add to chosen
answer = chosen   (a cover, size ≤ H(n)·OPT)
```

Objective choice:

```text
cover all, fewest sets   -> max gain greedy            (H(n))
cover all, cheapest cost  -> min cost/gain greedy        (H(n))
max coverage, k sets      -> max gain greedy, k picks    (1 - 1/e)
low frequency f           -> LP frequency rounding       (f-approx)
small m, need exact OPT    -> ILP / brute force
```

---

## Junior Questions (12 Q&A)

### J1. What is the Set Cover problem?
Given a universe `U` of `n` elements and a collection of sets (each a subset of `U`), choose the fewest sets whose union covers all of `U`.

### J2. Why can't we just find the exact minimum?
Set Cover is **NP-hard**. The number of sub-collections is `2^m`, and no polynomial-time algorithm is known (or expected) to find the exact minimum. So we approximate.

### J3. State the greedy algorithm.
While some element is uncovered: pick the set that covers the most **still-uncovered** elements, add it to the solution, and mark those elements covered. Repeat until everything is covered.

### J4. What is the key subtlety in greedy?
You must evaluate each set by how many **currently uncovered** elements it has — not its original size. A set's value shrinks as the algorithm proceeds.

### J5. What guarantee does greedy give?
It uses at most `H(n) = 1 + 1/2 + … + 1/n ≈ ln(n) + 1` times the optimal number of sets. For a million elements that is at most ~14× optimal.

### J6. Is greedy optimal?
No. It is an **approximation** — usually close to optimal but not always equal. There are instances where it uses `≈ ln n` times the optimum.

### J7. What is the time complexity?
Roughly `O(m·n)` for the naive version (each round scans all sets), where `m` = number of sets, `n` = universe size.

### J8. When does no cover exist?
When some element belongs to no set — then the union of all sets is not `U`, and the instance is infeasible. Greedy detects this when the best gain becomes 0 while elements remain.

### J9. Walk through a tiny example.
`U = {1,2,3,4,5}`, sets `{123},{24},{34},{45},{5}`. Round 1: `{123}` covers 3 (most) → pick it. Remaining `{4,5}`. Round 2: `{45}` covers 2 → pick it. Done: 2 sets, which is optimal here.

### J10. How is this different from finding a minimum spanning tree or shortest path?
Those are solvable exactly in polynomial time. Set Cover is NP-hard, so greedy gives an *approximate* answer with a *provable ratio*, not the exact optimum.

### J11. How would you track which elements are covered?
A boolean array indexed by element id (`O(1)` membership), plus a running `numCovered` counter so the termination check is `O(1)`.

### J12. How do you verify your implementation?
Brute force: try all `2^m` sub-collections, keep the smallest cover, compare to greedy on tiny instances. Also check known cases: a single set equal to `U` → 1; `n` singletons → `n`.

---

## Middle Questions (12 Q&A)

### M1. What exactly does an approximation ratio of `H(n)` mean?
For *every* input, greedy's cover is at most `H(n)` times the optimal. It is a worst-case guarantee; typical instances are much closer to optimal.

### M2. Why does the harmonic number appear?
In the charging analysis, each element pays a price `1/gain` when covered. With `r` elements left, some set covers `≥ r/OPT` of them, so prices look like `OPT/r, OPT/(r−1), …`, summing to `OPT·H(n)`.

### M3. How does greedy change for weighted set cover?
Pick the set with the smallest **cost per newly covered element**: `cost(S) / |S \ covered|`. Same `H(n)` guarantee, now against total cost. Unit costs recover the unweighted rule.

### M4. Sketch why greedy achieves `H(n)`.
When `r` elements remain, OPT covers them with `OPT` sets, so some set has cost-effectiveness `≤ OPT/r`. Greedy picks at least that good, so each element's price is `≤ OPT/(remaining)`; summing gives `H(n)·OPT`.

### M5. What is the LP relaxation?
Replace `xᵢ ∈ {0,1}` with `xᵢ ∈ [0,1]` in the covering ILP. The LP is polynomial-time solvable and gives `OPT_LP ≤ OPT`, a lower bound used by rounding algorithms.

### M6. What is frequency rounding and what does it give?
Let `f` be the max number of sets any element is in. Round every `xᵢ ≥ 1/f` to 1 — an `f`-approximation. For vertex cover `f = 2`, giving the classic 2-approximation.

### M7. What is the integrality gap and why does it matter?
The worst-case ratio `OPT / OPT_LP`, which is `Θ(log n)` for set cover. It means *no* algorithm using only this LP can beat `Θ(log n)` — explaining why greedy and LP rounding both land at `Θ(log n)`.

### M8. What is Max k-Coverage and its guarantee?
Maximize the number of elements covered using exactly `k` sets. Greedy (pick max gain `k` times) achieves `1 − 1/e ≈ 0.632` of optimal, which is tight unless `P = NP`.

### M9. Why is the coverage function submodular?
Adding a set never decreases coverage (monotone), and a set's marginal gain only shrinks as more sets are chosen (diminishing returns). This is exactly why greedy is provably good.

### M10. How do set cover and vertex cover relate?
Vertex cover is set cover where the universe is the edges and each vertex is the set of edges it touches — so every element has frequency `f = 2`. That structure enables a 2-approximation.

### M11. What is the dual-fitting view of the proof?
The per-element prices, scaled by `1/H(n)`, form a feasible solution to the LP dual. By weak duality their sum is `≤ OPT`, which reproves `greedy ≤ H(n)·OPT` and yields a certificate.

### M12. When is greedy not the right choice?
When `m` is small enough for an exact ILP and you need OPT; when frequency `f` is a small constant (LP rounding beats `ln n`); or when the structure is geometric/interval-based and admits an exact or constant-factor algorithm.

---

## Senior Questions (10 Q&A)

### S1. Design a service that selects the fewest resources covering a universe.
Share an inverted index (element → sets) and covered-state. Behind an objective contract (`min-count` / `min-cost` / `max-coverage-k`), select a scoring rule. Use lazy greedy for scale, return the cover plus metadata (full coverage? guarantee bound?).

### S2. How do you scale greedy beyond the naive `O(m·n)` rescan?
Build an inverted index so only sets sharing a newly covered element update their gain (total work `O(N)`), keep gains in a priority queue, and use lazy evaluation (CELF) so you re-evaluate only stale top candidates.

### S3. Why does lazy greedy work and is it exact?
Coverage is monotone submodular, so gains only shrink. A stale gain is an upper bound; if it is below the current best, the set can't be the max and is skipped. Lazy greedy returns the *same* cover as eager greedy, just faster.

### S4. Give three real applications.
Sensor/monitor placement (fewest sensors covering all locations), feature selection (informative feature subset), influence/ad targeting (seeds maximizing reach — max coverage `1−1/e`), facility location, and test-suite minimization.

### S5. How do you parallelize greedy?
Greedy is sequential (each pick depends on the last). Parallelize *within* a round (gain evaluation is embarrassingly parallel) and *across* requests. For web scale, use distributed/streaming greedy across shards, accepting a small ratio loss.

### S6. When use bitsets vs an inverted index?
Bitsets (gain = `popcount(set & ~covered)`) win when the universe is moderate (fits in memory as bits) — streaming, cache-friendly, 10–50× faster. Sparse inverted index wins when `n` is huge and sets are sparse (dense bitsets would OOM).

### S7. What do you instrument in production?
Cover size/cost, ratio to LP lower bound, uncovered-element rate (infeasibility), lazy re-evaluations per solve, per-solve latency by size, objective-mode counter, and cache hit ratio by instance hash.

### S8. What is the most dangerous failure mode?
An infeasible instance misread as a valid cover — the loop ends on an empty heap leaving an element uncovered, and the caller assumes everything is covered. Always check `numCovered == n` on exit and flag uncovered elements.

### S9. How do you cache results safely?
Greedy is deterministic in (sets, costs, objective, tie-break), so cache on a canonical instance hash. Fix the tie-break (smallest index) for reproducibility across runs and machines.

### S10. When would you reach for an ILP instead?
When `m` is small enough that a branch-and-bound ILP solver (CBC, Gurobi) finishes, and the business truly needs the exact minimum rather than a provably-good approximation.

---

## Professional / Theory Questions (8 Q&A)

### P1. Prove the `H(n)` bound.
Order elements `e₁…e_n` by when greedy covers them. Just before `eₖ`, `r ≥ n−k+1` remain; OPT covers them with cost `≤ OPT`, so some set has ratio `≤ OPT/r`; greedy picks at least that good, so `price(eₖ) ≤ OPT/(n−k+1)`. Sum: `cost = Σ price(eₖ) ≤ OPT·Σ 1/j = H(n)·OPT`.

### P2. Why is the bound tight?
Halving/partition-system instances delay a few stubborn elements to the last, expensive rounds. Greedy is lured into `≈ log₂ n` (or `ln n`) sets while OPT is `2` (or `OPT`), giving ratio `Θ(log n)`. So no `o(log n)` analysis is possible.

### P3. State Feige's hardness result.
Unless `P = NP`, no polynomial algorithm approximates set cover within `(1 − ε)·ln n` for any `ε > 0` (Feige 1998; tightened to `(1−o(1))ln n` by Dinur–Steurer 2014). Hence greedy's `ln n + Θ(1)` is essentially optimal.

### P4. Prove the `1 − 1/e` bound for max coverage.
With `OPT` the optimal `k`-coverage and `Aᵢ` greedy's value after `i` picks, submodularity gives a step with gain `≥ (OPT − f(Aᵢ))/k`, so `OPT − f(A_{i+1}) ≤ (1 − 1/k)(OPT − f(Aᵢ))`. Unrolling `k` times: `OPT − f(A_k) ≤ (1−1/k)^k OPT ≤ e^{−1}OPT`, so `f(A_k) ≥ (1−1/e)OPT`.

### P5. Explain the LP, its dual, and dual fitting.
Primal: `min Σ cᵢxᵢ` s.t. `Σ_{e∈Sᵢ} xᵢ ≥ 1`. Dual: `max Σ yₑ` s.t. `Σ_{e∈Sᵢ} yₑ ≤ cᵢ`. Dual fitting sets `yₑ = price(e)/H(n)`; this `y` is dual-feasible, so `Σ yₑ ≤ OPT`, giving `cost/H(n) ≤ OPT`.

### P6. What is the integrality gap and how is it bounded?
`max OPT/OPT_LP = Θ(log n)`. Upper bound `H(n)` from dual fitting (`OPT ≤ H(n)·OPT_LP`); lower bound from partition-system instances where the LP spreads weight evenly (cost ≈ 1) but any integral cover needs `Θ(log n)` sets.

### P7. Give the complexity of the efficient implementation.
With an inverted index, each incidence is touched a constant number of times, so total gain-update work is `O(N)` (`N` = number of (element,set) incidences); with a heap for argmax, `O(N log m)`. Bitset variant: `O(min(m,n)·m·n/w)`.

### P8. How does randomized rounding give `O(log n)`?
Include set `i` with probability `x*ᵢ`; one round leaves `e` uncovered with probability `≤ e^{−1}`. After `O(log n)` independent rounds, `Pr[e uncovered] ≤ 1/n²`; union bound gives full coverage w.h.p. at expected cost `O(log n)·OPT_LP`.

---

## Behavioral Questions (5)

### B1. Tell me about a time you accepted a "good enough" answer instead of the perfect one.
*Structure (STAR):* describe an NP-hard selection problem (Situation/Task), recognizing exact optimization was infeasible and choosing greedy with its `ln n` guarantee (Action), and shipping a fast, provably-near-optimal solution with verification (Result). Emphasize matching the algorithm to the *intractability* of the problem.

### B2. Describe a time a "complete" result silently wasn't.
Talk about a cover that omitted an element because the instance was infeasible (an element in no set) and the loop ended on an empty queue. How you detected it (post-condition check `numCovered == n`) and fixed it (explicit infeasible flag + uncovered list). Lesson: verify the post-condition, never trust the loop.

### B3. How did you decide between exact and approximate?
Explain weighing instance size (small `m` → ILP for exact OPT), the consumer's tolerance (a monitoring plan tolerates a slightly larger cover; a billing total may not), and latency. Show you matched the tool to the requirement, not the reverse.

### B4. Tell me about explaining a non-obvious guarantee to stakeholders.
Describe explaining "at most `ln n + 1` times the ideal" in business terms ("never more than ~14× for a million items, usually far closer"), and that it is *provably the best any fast method can do*. Tailoring theory to the audience is the point.

### B5. A time you built a verification harness before trusting your code.
The brute-force exact set-cover oracle: you built it first, validated greedy on every small instance and known identities (single set = 1, `n` singletons = `n`), and caught a "used original size instead of live gain" bug instantly. Emphasize "trust but verify."

---

## Coding Challenges

### Challenge 1 — Greedy Set Cover (minimize number of sets)

**Problem.** Given a universe `{0..n-1}` and sets, return a cover using few sets via greedy.

#### Go
```go
package main

import "fmt"

func greedySetCover(n int, sets [][]int) []int {
	covered := make([]bool, n)
	numCovered := 0
	var chosen []int
	for numCovered < n {
		best, bestGain := -1, 0
		for i, s := range sets {
			gain := 0
			for _, e := range s {
				if !covered[e] {
					gain++
				}
			}
			if gain > bestGain {
				bestGain, best = gain, i
			}
		}
		if best == -1 || bestGain == 0 {
			break
		}
		chosen = append(chosen, best)
		for _, e := range sets[best] {
			if !covered[e] {
				covered[e] = true
				numCovered++
			}
		}
	}
	return chosen
}

func main() {
	sets := [][]int{{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}}
	fmt.Println(greedySetCover(5, sets)) // [0 3]
}
```

#### Java
```java
import java.util.*;

public class Challenge1 {
    static List<Integer> cover(int n, int[][] sets) {
        boolean[] covered = new boolean[n];
        int numCovered = 0;
        List<Integer> chosen = new ArrayList<>();
        while (numCovered < n) {
            int best = -1, bestGain = 0;
            for (int i = 0; i < sets.length; i++) {
                int gain = 0;
                for (int e : sets[i]) if (!covered[e]) gain++;
                if (gain > bestGain) { bestGain = gain; best = i; }
            }
            if (best == -1 || bestGain == 0) break;
            chosen.add(best);
            for (int e : sets[best])
                if (!covered[e]) { covered[e] = true; numCovered++; }
        }
        return chosen;
    }

    public static void main(String[] args) {
        int[][] sets = {{0, 1, 2}, {1, 3}, {2, 3}, {3, 4}, {4}};
        System.out.println(cover(5, sets)); // [0, 3]
    }
}
```

#### Python
```python
def greedy_set_cover(n, sets):
    covered = [False] * n
    num_covered = 0
    chosen = []
    while num_covered < n:
        best, best_gain = -1, 0
        for i, s in enumerate(sets):
            gain = sum(1 for e in s if not covered[e])
            if gain > best_gain:
                best_gain, best = gain, i
        if best == -1 or best_gain == 0:
            break
        chosen.append(best)
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
    return chosen


print(greedy_set_cover(5, [[0, 1, 2], [1, 3], [2, 3], [3, 4], [4]]))  # [0, 3]
```

### Challenge 2 — Weighted Set Cover (minimize total cost)

**Problem.** Each set has a cost; minimize total cost via cost-effectiveness greedy.

#### Go
```go
package main

import "fmt"

func weightedCover(n int, sets [][]int, cost []float64) ([]int, float64) {
	covered := make([]bool, n)
	numCovered := 0
	var chosen []int
	total := 0.0
	for numCovered < n {
		best := -1
		bestRatio := 0.0
		for i, s := range sets {
			gain := 0
			for _, e := range s {
				if !covered[e] {
					gain++
				}
			}
			if gain == 0 {
				continue
			}
			r := cost[i] / float64(gain)
			if best == -1 || r < bestRatio {
				bestRatio, best = r, i
			}
		}
		if best == -1 {
			break
		}
		chosen = append(chosen, best)
		total += cost[best]
		for _, e := range sets[best] {
			if !covered[e] {
				covered[e] = true
				numCovered++
			}
		}
	}
	return chosen, total
}

func main() {
	sets := [][]int{{0, 1, 2}, {0, 1}, {2, 3}}
	cost := []float64{3, 1, 1}
	c, t := weightedCover(4, sets, cost)
	fmt.Println(c, t) // [1 2] 2
}
```

#### Java
```java
import java.util.*;

public class Challenge2 {
    static Object[] cover(int n, int[][] sets, double[] cost) {
        boolean[] covered = new boolean[n];
        int numCovered = 0;
        List<Integer> chosen = new ArrayList<>();
        double total = 0.0;
        while (numCovered < n) {
            int best = -1;
            double bestRatio = 0.0;
            for (int i = 0; i < sets.length; i++) {
                int gain = 0;
                for (int e : sets[i]) if (!covered[e]) gain++;
                if (gain == 0) continue;
                double r = cost[i] / gain;
                if (best == -1 || r < bestRatio) { bestRatio = r; best = i; }
            }
            if (best == -1) break;
            chosen.add(best);
            total += cost[best];
            for (int e : sets[best])
                if (!covered[e]) { covered[e] = true; numCovered++; }
        }
        return new Object[]{chosen, total};
    }

    public static void main(String[] args) {
        int[][] sets = {{0, 1, 2}, {0, 1}, {2, 3}};
        double[] cost = {3, 1, 1};
        Object[] r = cover(4, sets, cost);
        System.out.println(r[0] + " " + r[1]); // [1, 2] 2.0
    }
}
```

#### Python
```python
def weighted_cover(n, sets, cost):
    covered = [False] * n
    num_covered = 0
    chosen, total = [], 0.0
    while num_covered < n:
        best, best_ratio = -1, 0.0
        for i, s in enumerate(sets):
            gain = sum(1 for e in s if not covered[e])
            if gain == 0:
                continue
            r = cost[i] / gain
            if best == -1 or r < best_ratio:
                best_ratio, best = r, i
        if best == -1:
            break
        chosen.append(best)
        total += cost[best]
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
    return chosen, total


print(weighted_cover(4, [[0, 1, 2], [0, 1], [2, 3]], [3, 1, 1]))  # ([1, 2], 2.0)
```

### Challenge 3 — Max k-Coverage (maximize elements with a budget of k sets)

**Problem.** Pick exactly `k` sets maximizing the number of covered elements (greedy → `1 − 1/e`).

#### Go
```go
package main

import "fmt"

func maxCoverage(n int, sets [][]int, k int) ([]int, int) {
	covered := make([]bool, n)
	numCovered := 0
	var chosen []int
	for len(chosen) < k {
		best, bestGain := -1, 0
		for i, s := range sets {
			gain := 0
			for _, e := range s {
				if !covered[e] {
					gain++
				}
			}
			if gain > bestGain {
				bestGain, best = gain, i
			}
		}
		if best == -1 || bestGain == 0 {
			break // nothing left to cover
		}
		chosen = append(chosen, best)
		for _, e := range sets[best] {
			if !covered[e] {
				covered[e] = true
				numCovered++
			}
		}
	}
	return chosen, numCovered
}

func main() {
	sets := [][]int{{0, 1, 2, 3}, {0, 1}, {2, 3, 4}, {4, 5}}
	c, cov := maxCoverage(6, sets, 2)
	fmt.Println(c, "covers", cov) // [0 3] covers 6 (S0={0,1,2,3} then S3={4,5})
}
```

#### Java
```java
import java.util.*;

public class Challenge3 {
    static Object[] maxCoverage(int n, int[][] sets, int k) {
        boolean[] covered = new boolean[n];
        int numCovered = 0;
        List<Integer> chosen = new ArrayList<>();
        while (chosen.size() < k) {
            int best = -1, bestGain = 0;
            for (int i = 0; i < sets.length; i++) {
                int gain = 0;
                for (int e : sets[i]) if (!covered[e]) gain++;
                if (gain > bestGain) { bestGain = gain; best = i; }
            }
            if (best == -1 || bestGain == 0) break;
            chosen.add(best);
            for (int e : sets[best])
                if (!covered[e]) { covered[e] = true; numCovered++; }
        }
        return new Object[]{chosen, numCovered};
    }

    public static void main(String[] args) {
        int[][] sets = {{0, 1, 2, 3}, {0, 1}, {2, 3, 4}, {4, 5}};
        Object[] r = maxCoverage(6, sets, 2);
        System.out.println(r[0] + " covers " + r[1]); // [0, 3] covers 6
    }
}
```

#### Python
```python
def max_coverage(n, sets, k):
    covered = [False] * n
    num_covered = 0
    chosen = []
    while len(chosen) < k:
        best, best_gain = -1, 0
        for i, s in enumerate(sets):
            gain = sum(1 for e in s if not covered[e])
            if gain > best_gain:
                best_gain, best = gain, i
        if best == -1 or best_gain == 0:
            break
        chosen.append(best)
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
    return chosen, num_covered


print(max_coverage(6, [[0, 1, 2, 3], [0, 1], [2, 3, 4], [4, 5]], 2))  # ([0, 3], 6)
```

### Challenge 4 — Brute-Force Optimum (oracle for testing)

**Problem.** For `m ≤ ~20`, find the exact minimum cover by trying all sub-collections; use it to validate greedy.

#### Python
```python
def brute_min_cover(n, sets):
    full = (1 << n) - 1
    masks = [sum(1 << e for e in s) for s in sets]
    best = None
    for sub in range(1 << len(sets)):
        cov = 0
        cnt = 0
        for i in range(len(sets)):
            if sub & (1 << i):
                cov |= masks[i]
                cnt += 1
        if cov == full and (best is None or cnt < best):
            best = cnt
    return best  # size of optimal cover, or None if infeasible


sets = [[0, 1, 2], [1, 3], [2, 3], [3, 4], [4]]
print("OPT =", brute_min_cover(5, sets))                 # 2
print("greedy size =", len(greedy_set_cover(5, sets)))   # 2 (matches here)
```

(Go and Java versions iterate `1 << m` bitmasks, OR the precomputed set masks, and track the smallest count whose union is the full mask.)

---

## Common Pitfalls

- **Using a set's original size instead of its live gain** — the #1 correctness bug.
- **Not detecting infeasibility** — looping forever (or returning a partial cover) when an element is in no set.
- **Claiming greedy is optimal** — it is an `H(n)`-approximation, not the minimum.
- **Confusing set cover (min sets to cover all, `H(n)`) with max coverage (max elements with `k` sets, `1−1/e`)** — different objectives, different guarantees.
- **Float ratio mis-ordering in the weighted version** — cross-multiply integers when exactness matters.
- **Forgetting frequency `f` is per-element** — it is the max number of sets an element is in, not the set size.
- **Non-deterministic tie-breaking** — makes results irreproducible and tests flaky.

---

## What Interviewers Are Really Testing

- **Recognizing intractability:** do you see an NP-hard problem and reach for a *provably-good approximation* instead of brute force?
- **Approximation literacy:** can you state the `H(n) = ln n + 1` ratio, *and* explain it is essentially optimal (Feige), *and* sketch the charging proof if pushed?
- **Objective judgment:** do you distinguish min-count, min-cost, and max-coverage-under-budget, with their different guarantees (`H(n)` vs `H(n)` vs `1−1/e`)?
- **Correctness discipline:** do you build a brute-force oracle, check known identities, and verify full coverage on exit instead of trusting one run?
- **Scaling sense:** do you know the naive `O(m·n)` rescan is wasteful and reach for an inverted index / lazy greedy / bitsets at scale?
</content>
