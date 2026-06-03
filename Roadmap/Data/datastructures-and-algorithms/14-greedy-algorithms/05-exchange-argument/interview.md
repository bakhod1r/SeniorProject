# Exchange Argument — Interview Questions & Answers

> A tiered bank of 74 questions on the exchange argument and greedy-correctness proofs, from "what is it" through full proof construction, whiteboard scenarios, proof-sketch drills, and a coding verification challenge in Go, Java, and Python. Each answer is self-contained; the coding challenge asks you to build a brute-force-vs-greedy checker.

## Table of Contents
1. [Fundamentals (Q1–Q12)](#fundamentals-q1q12)
2. [Proof Construction (Q13–Q26)](#proof-construction-q13q26)
3. [When Greedy Fails (Q27–Q34)](#when-greedy-fails-q27q34)
4. [Matroids & Advanced (Q35–Q44)](#matroids--advanced-q35q44)
5. [Rapid-Fire (Q45–Q60)](#rapid-fire-q45q60)
6. [Scenario & Whiteboard (Q61–Q66)](#scenario--whiteboard-q61q66)
7. [Coding Challenge: Greedy-vs-Brute Verifier](#coding-challenge-greedy-vs-brute-verifier)

---

## Fundamentals (Q1–Q12)

### Q1. What is an exchange argument, in one sentence?
**A.** It is a proof technique for greedy-algorithm optimality: take any optimal solution, repeatedly swap one of its elements for the element greedy chose — showing each swap keeps the solution valid and no worse — until the optimal solution has been transformed into the greedy one, proving greedy is also optimal.

### Q2. Why do greedy algorithms need a correctness proof at all?
**A.** A greedy algorithm commits to a locally-best choice and never reconsiders it. That myopia is fast but can foreclose a better global solution. Many plausible greedy rules are subtly wrong (coin change on `{1,3,4}`), so "it looks right" is not evidence — only a proof (or an exhaustive test) establishes optimality.

### Q3. What are the four steps of a generic exchange argument?
**A.** (1) Set up: let `G` be greedy's solution and `OPT` any optimum; if equal, done. (2) Find the first place they differ (an inversion). (3) Exchange greedy's choice into `OPT` and prove the result is valid and *no worse*. (4) Iterate: each swap removes one inversion and never worsens the objective, so finitely many swaps turn `OPT` into `G`.

### Q4. Why does the exchange need to show "no worse" rather than "strictly better"?
**A.** Because `OPT` is already optimal — a strictly better solution would be a contradiction. The goal is to show you can keep `OPT`'s quality while making it look more like `G`. "No worse" is exactly the right and achievable target.

### Q5. What is the difference between the exchange argument and "greedy stays ahead"?
**A.** Both prove greedy optimality. The exchange argument *transforms* an optimum into greedy via swaps. "Greedy stays ahead" instead *inducts* a per-step progress measure, proving greedy never falls behind any other solution after each step — no swapping. Order/cost problems suit exchange; count/coverage problems suit stays-ahead.

### Q6. Give a problem best proved by exchange and one best proved by stays-ahead.
**A.** Minimize maximum lateness (EDF) is best by exchange (adjacent swap of an inverted pair). Interval scheduling (maximize number of non-overlapping intervals) is best by stays-ahead (the `k`-th chosen interval finishes no later than any optimum's `k`-th).

### Q7. What is an "inversion" and why does it matter?
**A.** An inversion is a pair of elements appearing out of greedy's preferred order. It matters because each exchange removes (at least) one inversion, and the inversion count is a non-negative integer — so the process strictly decreases and must terminate, which is what closes the proof.

### Q8. Why do we usually swap *adjacent* elements?
**A.** Swapping adjacent elements changes only those two elements' positions (and finish times), so the "no worse" inequality involves just two terms and is easy to verify. Any sequence with an inversion has an adjacent inversion, so restricting to adjacent swaps loses no generality.

### Q9. What is "optimal substructure" and why does the exchange argument need it?
**A.** Optimal substructure means an optimal solution to the whole problem contains an optimal solution to a smaller subproblem (the problem that remains after fixing greedy's first choice). The exchange argument needs it so that "fix greedy's first choice, then recurse" is valid — it licenses the inductive step that closes the loop.

### Q10. What is the "greedy-choice property"?
**A.** The property that *some* optimal solution makes the same first choice greedy does. A single exchange establishes it: take any optimum, swap greedy's first choice in, show it stays optimal. Greedy-choice property + optimal substructure ⇒ greedy is optimal.

### Q11. How do you *disprove* a greedy strategy?
**A.** Produce one counterexample: an input where a brute-force oracle finds a strictly better solution than greedy. A single counterexample is a complete disproof. Example: coin change `{1,3,4}`, target `6` — greedy uses 3 coins (`4+1+1`), optimum uses 2 (`3+3`).

### Q12. Does the exchange argument affect the algorithm's runtime?
**A.** No. It is offline pen-and-paper (or machine-checked) reasoning establishing correctness. The algorithm's runtime is whatever it is — typically `O(n log n)` for a sort-and-sweep greedy. The proof adds zero runtime cost.

---

## Proof Construction (Q13–Q26)

### Q13. Prove the earliest-finish greedy is optimal for activity selection.
**A.** Let `a₁` be the globally earliest-finishing activity. *Greedy-choice:* take any optimum `S*`, let `a_k` be its earliest finisher; since `f(a₁) ≤ f(a_k)`, replacing `a_k` with `a₁` keeps compatibility (every other member starts after `f(a_k) ≥ f(a₁)`) and the same size, so some optimum contains `a₁`. *Substructure:* after `a₁`, the residual is the activity-selection instance on activities starting `≥ f(a₁)`, which greedy solves; combining gives an optimal whole by induction. ∎

### Q14. Prove EDF minimizes maximum lateness.
**A.** Take an optimal, idle-free schedule. While it has an inversion (`a` before `b` with `d_a > d_b`), pick an *adjacent* one and swap. Only `a, b` change finish times; after the swap the later-finisher is `a` with lateness `(C) − d_a < (C) − d_b`, which was the old finisher `b`'s lateness — so the pair's max lateness does not increase, hence the global max does not increase. Each swap removes an inversion; finitely many swaps yield the inversion-free EDF order. So EDF is optimal. ∎

### Q15. Prove ratio greedy is optimal for fractional knapsack.
**A.** Sort by `ρ = v/w` descending. Take an optimum `x`. If it differs from greedy `g`, there is a higher-ratio item `a` with `x_a < g_a` and a lower-ratio item `b` with `x_b > 0`. Transfer a tiny weight `δ` from `b` to `a`: weight unchanged, value changes by `δ(ρ_a − ρ_b) ≥ 0`. So value doesn't drop and `x` moves toward `g`. Iterating drives `x → g`, so greedy is optimal. ∎

### Q16. Prove Huffman coding produces a minimum-cost prefix code (sketch).
**A.** *Leaf swap:* the two least-frequent symbols `x, y` can be moved to two deepest sibling leaves without increasing cost, since `(f_deep − f_x)(depth_deep − depth_x) ≥ 0`. So some optimum has `x, y` as deepest siblings — exactly what Huffman merges. *Substructure:* merging `x, y` into `z` (freq `f_x+f_y`) shifts the cost by the constant `f_x+f_y`, so the residual instance has the same optimum. Induction on alphabet size finishes the proof. ∎

### Q17. In the EDF proof, why can we assume the optimal schedule has no idle time?
**A.** Sliding jobs earlier to remove idle gaps only *decreases* finish times, which can only decrease lateness. So any schedule can be made idle-free without increasing `L_max`; assuming idle-free loses no optimality and simplifies the inversion argument.

### Q18. What potential function guarantees the exchange terminates?
**A.** A non-negative integer that strictly decreases with each swap — typically the number of inversions relative to greedy's order, or the number of positions where the current solution disagrees with `G`. Because it cannot decrease below zero, only finitely many swaps occur.

### Q19. Why is the fractional knapsack greedy correct but the 0/1 version wrong?
**A.** In the fractional case you can transfer an infinitesimal weight from a lower-ratio to a higher-ratio item, which never lowers value — the `ε`-transfer exchange works. In 0/1 you cannot take fractions, so swapping items can overshoot capacity or waste it; the no-worse swap fails. Indivisibility breaks the exchange; 0/1 needs DP.

### Q20. How would you prove Smith's rule (minimize Σ wⱼCⱼ) optimal?
**A.** Sequence by `pⱼ/wⱼ` ascending. Swapping an adjacent inverted pair `(a before b with pₐ/wₐ > p_b/w_b)` changes the total weighted completion time by `w_b·pₐ − wₐ·p_b > 0`, so the swap toward Smith order strictly reduces cost. Hence the inversion-free Smith order is optimal — the same adjacency-swap shape as EDF, different inequality.

### Q21. What goes wrong if you swap non-adjacent elements?
**A.** Swapping distant elements changes the finish times of *all* elements between them, so "only two quantities change" no longer holds and the clean two-term inequality breaks. You would have to bound a whole block of changes, which is much harder. Reducing to adjacent swaps (always possible) keeps the argument local.

### Q22. How do ties (equal keys) complicate an exchange proof?
**A.** Ties make "the first place greedy and OPT differ" ambiguous and can let the swap be cost-neutral in a way that doesn't reduce the potential. Fix a deterministic tie-break (e.g., by index) so greedy's order is total, and verify the swap still strictly reduces the inversion count under that tie-break.

### Q23. Can the exchange argument prove there is a *unique* optimum?
**A.** No — it only proves greedy is *an* optimum. There may be many optimal solutions; the exchange transforms *one* of them into `G`. Uniqueness, when it holds, needs a separate argument (e.g., strict inequalities in every swap).

### Q24. Walk through converting a "stays-ahead" proof into an exchange proof for interval scheduling.
**A.** Stays-ahead shows greedy's `k`-th interval finishes no later than any optimum's `k`-th. The exchange version: given an optimum, replace its earliest-finishing interval with greedy's earliest-finishing one (which finishes no later), preserving compatibility and count; recurse on the rest. Both rest on the same fact — greedy's earliest-finish choice dominates — packaged differently.

### Q25. What is the role of the brute-force oracle in proof construction?
**A.** It is the empirical safety net. Before investing in a proof, you differential-test greedy against an exhaustive oracle on small inputs. If they ever disagree, the rule is false and there is nothing to prove. The oracle also serves as a regression check that your "no worse" reasoning matches reality.

### Q26. How do you structure the induction that closes an exchange argument?
**A.** Strong induction on instance size. Base: size 0/1 trivially optimal. Step: by the greedy-choice property some optimum makes greedy's first choice; by optimal substructure the remainder is a smaller instance the induction hypothesis covers; greedy on the original after its first choice *is* greedy on the remainder, so greedy is optimal on the whole.

---

## When Greedy Fails (Q27–Q34)

### Q27. Give the canonical counterexample to greedy coin change.
**A.** Denominations `{1, 3, 4}`, amount `6`. Greedy takes the largest coin ≤ remaining: `4`, then `1`, then `1` → 3 coins. The optimum is `3 + 3` → 2 coins. So "largest coin first" is not optimal for general denomination systems.

### Q28. For which coin systems *is* greedy optimal?
**A.** "Canonical" coin systems (like US coins `{1,5,10,25}`) where greedy equals the optimum for every amount. Determining whether a system is canonical requires checking small amounts up to a bound (Pearson's algorithm), not a greedy intuition — the proof is nontrivial.

### Q29. Why does greedy-by-ratio fail for 0/1 knapsack? Give a counterexample.
**A.** Indivisibility means a high-ratio item can occupy capacity that a combination of lower-ratio items would have used more valuably. Capacity `5`, items `(value 6, weight 4)`, `(5, 3)`, `(5, 2)`: greedy by ratio may take the `(6,4)` item (value 6, no room left for weight-3), while `(5,3)+(5,2)` fits weight 5 for value 10.

### Q30. How do you recognize, structurally, that greedy will fail?
**A.** Watch for: indivisible items whose choices interact through a shared resource (capacity), objectives that are not separable across the greedy order, and the absence of a matroid structure. The empirical tell is a small counterexample from the oracle; the structural tell is that the feasibility family violates the matroid exchange axiom.

### Q31. If greedy fails, what do you switch to?
**A.** For exact optimality with optimal substructure but no greedy-choice property: **dynamic programming** (e.g., DP coin change `O(V·|C|)`, 0/1 knapsack `O(nW)`). For NP-hard problems: an **approximation algorithm** with a proven ratio (greedy set cover `H_n`, vertex cover `2`).

### Q32. Can a failing exchange step itself help you find a counterexample?
**A.** Yes. When you try to prove "no worse" and find a case where the swap *strictly worsens* the objective, that case is a recipe for a concrete counterexample — instantiate it with numbers and you have disproved greedy. A failing exchange is the formal shadow of a counterexample.

### Q33. Is greedy ever a good choice even when it's not optimal?
**A.** Often, yes — as a fast approximation or heuristic, or as a subroutine. Greedy set cover is within `ln n` of optimal and is the best possible polynomial ratio (under standard assumptions). The key is to *prove the ratio*, not claim exactness.

### Q34. Coin change `{1,3,4}` fails greedy — does it have optimal substructure?
**A.** Yes: an optimal way to make `V` coins uses an optimal way to make `V − c` for some coin `c`. It has optimal substructure but *not* the greedy-choice property (the largest coin isn't always in an optimum). That combination — OS but not GC — is exactly when DP works and greedy doesn't.

---

## Matroids & Advanced (Q35–Q44)

### Q35. What is a matroid?
**A.** A pair `(E, ℐ)` of a ground set and a family of "independent" subsets satisfying: `∅` is independent; subsets of independent sets are independent (hereditary); and the **exchange axiom** — if `A, B` are independent with `|A| < |B|`, some element of `B \ A` can be added to `A` keeping it independent.

### Q36. State the Rado–Edmonds theorem.
**A.** For a hereditary family `(E, ℐ)`, the matroid greedy (sort by weight descending, add if independence preserved) maximizes total weight for *every* non-negative weight function **if and only if** `(E, ℐ)` is a matroid. So matroids are exactly the structures where greedy is universally optimal.

### Q37. How is the matroid exchange axiom related to the exchange argument?
**A.** It is the abstraction of it. Every concrete swap ("a heavier feasible element can be exchanged in") is an instance of "a smaller independent set can be grown using an element of a larger one." The Rado–Edmonds optimality proof *is* the exchange argument, written once for all matroids.

### Q38. Give three example matroids and the greedy they induce.
**A.** Graphic matroid (forests) → Kruskal's MST; uniform matroid `U_{k,n}` (subsets of size ≤ k) → "take the k heaviest"; partition matroid (≤ cᵢ per group) → bounded-per-category selection.

### Q39. Why is Kruskal's algorithm optimal "for free" given matroids?
**A.** Forests of a graph form the graphic matroid, and edge weights form the weight function. By Rado–Edmonds the matroid greedy (Kruskal, adding the lightest edge that keeps the set acyclic/independent) is optimal — no separate cut/cycle proof needed; that proof is just the exchange axiom on graphs.

### Q40. What happens with two matroids (matroid intersection)?
**A.** Maximizing weight over the intersection of two matroids (e.g., bipartite matching) is *not* solvable by greedy, but it *is* solvable in polynomial time by Edmonds' matroid-intersection algorithm. Three or more matroids is NP-hard in general. This pinpoints the frontier of the greedy paradigm.

### Q41. How would you *empirically* test whether a feasibility family is a matroid?
**A.** Over a small ground set, enumerate all subsets; check `∅` is independent, that every subset of each independent set is independent (hereditary), and that for every pair `A, B` of independent sets with `|A| < |B|`, some element of `B \ A` extends `A`. A violation is a witness that it's not a matroid (and that greedy may fail).

### Q42. What is a greedoid, and when do you need it?
**A.** A greedoid relaxes the hereditary axiom but keeps a (different) exchange/accessibility property; it captures order-dependent greedy algorithms (some shortest-path-style sweeps) that matroids do not. You need it when correctness depends on the *order* of construction, not just the final set.

### Q43. How does LP duality relate to the exchange argument?
**A.** For LP-expressible problems, greedy optimality also follows from exhibiting a dual certificate matching the primal greedy value. The exchange argument is the combinatorial shadow of constructing that dual. For matroids, the rank function is the dual object, and Rado–Edmonds corresponds to the integrality of the matroid polytope.

### Q44. What is the `(1 − 1/e)` greedy bound, and how does it connect here?
**A.** For maximizing a monotone submodular function under a cardinality (uniform-matroid) constraint, the greedy algorithm achieves at least `(1 − 1/e)` of the optimum — a tight bound. It generalizes matroid greedy to submodular objectives and is proved with an exchange-flavored marginal-gain argument; under a general matroid constraint, continuous-greedy achieves the same ratio.

---

## Rapid-Fire (Q45–Q60)

### Q45. Exchange or stays-ahead for Huffman?
**A.** Exchange (leaf swap of the two least-frequent symbols).

### Q46. One-line reason coin change greedy can be wrong.
**A.** The locally largest coin can force more coins overall than a combination of smaller ones; the structure isn't a matroid.

### Q47. What single artifact disproves a greedy claim?
**A.** One counterexample input where a brute-force oracle beats greedy.

### Q48. What two properties together guarantee greedy is optimal?
**A.** The greedy-choice property and optimal substructure.

### Q49. What potential decreases each swap?
**A.** The inversion count (a non-negative integer), guaranteeing termination.

### Q50. Exchange or stays-ahead for interval scheduling?
**A.** Stays-ahead (greedy's `k`-th finish ≤ optimum's `k`-th).

### Q51. Which exchange shape fits fractional knapsack?
**A.** The `ε`-transfer (move infinitesimal weight to a higher-ratio item).

### Q52. Which exchange shape fits MST?
**A.** The cut/cycle swap (replace a heavy cycle edge with a lighter cross-cut edge).

### Q53. Name the theorem that says "greedy optimal ⟺ matroid."
**A.** The Rado–Edmonds theorem.

### Q54. Greedy on two matroids — optimal?
**A.** No; greedy fails, but matroid intersection solves it in polynomial time.

### Q55. Does the exchange argument prove uniqueness of the optimum?
**A.** No — only that greedy is *an* optimum.

### Q56. What replaces exact optimality for NP-hard greedy problems?
**A.** A proven approximation ratio (e.g., `H_n` for set cover).

### Q57. Why prefer adjacent swaps?
**A.** Only two finish times change, so the "no worse" inequality has two terms.

### Q58. What does the brute-force oracle do in the workflow?
**A.** It is the ground truth on small inputs — disprove a greedy before proving it.

### Q59. Smith's rule sorts by what key?
**A.** Processing time over weight, `pⱼ/wⱼ`, ascending.

### Q60. If "no worse" cannot be shown, what have you likely found?
**A.** That greedy is wrong — go construct the counterexample.

---

## Scenario & Whiteboard (Q61–Q66)

### Q61. (Whiteboard) An interviewer claims "to schedule jobs to minimize the number of late jobs, run shortest-job-first." Evaluate.
**A.** This is the *minimize number of tardy jobs* problem, and SJF is **not** correct — the optimal greedy is **Moore–Hodgson**: process jobs in deadline order, and whenever the running set becomes infeasible, drop the *longest* job processed so far. I would (1) state I suspect SJF is wrong, (2) build the brute oracle (try all subsets to keep on time), (3) differential-test SJF — it will mismatch — then (4) present Moore–Hodgson with its exchange justification (dropping the longest job frees the most time while losing only one job, an exchange that is no worse). The discipline: disprove the claimed rule, then supply the provably correct one.

### Q62. (Scenario) You inherit a greedy routine in production with no proof. How do you gain confidence it's correct?
**A.** Three layers. (1) **Differential testing**: write an exhaustive oracle and run greedy vs oracle on *all* inputs up to `n = 7–8` plus thousands of random tiny inputs including ties/zeros/duplicates; any mismatch is a bug. (2) **Structural analysis**: encode the feasibility predicate and check the matroid axioms on small ground sets — if it's a matroid, Rado–Edmonds certifies optimality with no hand proof. (3) **Recorded proof**: if not a matroid, require a written exchange argument plus regression tests on its identified failure case (ties, capacity). I'd wire (1) into CI so the property is continuously monitored.

### Q63. (Whiteboard) Prove or disprove: "for minimizing total completion time `ΣCⱼ` on one machine, shortest-processing-time-first is optimal."
**A.** **True** — it's the unit-weight case of Smith's rule. Exchange proof: with all weights equal, swapping an adjacent inverted pair `(a before b, pₐ > p_b)` changes `ΣCⱼ` by `pₐ − p_b > 0`, so the swap toward SPT order strictly reduces total completion time. Hence the inversion-free SPT order is optimal. I'd verify with a permutation oracle on `n ≤ 7`.

### Q64. (Scenario) A teammate "proved" a greedy by exchange but it fails a test. Where is the bug, usually?
**A.** Almost always in the R3 "no worse" step — either they swapped non-adjacent elements (so more than two quantities changed and the inequality is unsound), assumed a strict order where ties exist, or quietly assumed optimal substructure that doesn't hold. The failing test is correct; I'd reconstruct the exact swap on that input and watch the objective *increase*, which pinpoints the false inequality.

### Q65. (Whiteboard) Given an independence oracle, how do you decide in code whether greedy will be optimal for all weights?
**A.** Check the three matroid axioms by brute force over all `2ⁿ` subsets of a small ground set: `∅` independent, hereditary (every subset of an independent set is independent), and the exchange axiom (for independent `A, B` with `|A| < |B|`, some `x ∈ B\A` extends `A`). If all hold, Rado–Edmonds guarantees greedy is optimal for *every* non-negative weight. As a cross-check, fuzz random weights and assert `greedy == brute` exactly when the axioms hold.

### Q66. (Scenario) When would you *not* attempt an exchange argument at all?
**A.** When greedy is provably wrong (non-matroid, no no-worse swap) — switch to DP for exact optimality; when the problem is NP-hard — prove an approximation ratio instead (charging/primal-dual, not exact exchange); when the objective is multi-criteria/Pareto — exchange assumes a single scalar objective; and for online/adversarial input — use competitive analysis. Knowing the technique's boundary is as valuable as wielding it.

---

## Coding Challenge: Greedy-vs-Brute Verifier

**Task.** Implement a verification harness that, for the "minimize maximum lateness" problem, (a) runs the EDF greedy, (b) runs a brute-force permutation oracle, and (c) reports whether they agree across a battery of random small instances — empirically certifying the exchange argument. Then add a second check that *catches* the wrong greedy "shortest processing time first" failing. Each language must print that EDF always matches brute, and that SPT-first does *not*.

### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
)

type Job struct{ t, d int }

func edf(jobs []Job) int { // CORRECT: earliest deadline first
	js := append([]Job(nil), jobs...)
	sort.Slice(js, func(i, j int) bool { return js[i].d < js[j].d })
	return maxLateness(js)
}

func spt(jobs []Job) int { // WRONG (for max lateness): shortest processing time first
	js := append([]Job(nil), jobs...)
	sort.Slice(js, func(i, j int) bool { return js[i].t < js[j].t })
	return maxLateness(js)
}

func maxLateness(order []Job) int {
	time, mx := 0, 0
	for _, j := range order {
		time += j.t
		if v := time - j.d; v > mx {
			mx = v
		}
	}
	return mx
}

func brute(jobs []Job) int {
	idx := make([]int, len(jobs))
	for i := range idx {
		idx[i] = i
	}
	best := 1 << 30
	var perm func(k int)
	perm = func(k int) {
		if k == len(idx) {
			order := make([]Job, len(idx))
			for i, id := range idx {
				order[i] = jobs[id]
			}
			if v := maxLateness(order); v < best {
				best = v
			}
			return
		}
		for i := k; i < len(idx); i++ {
			idx[k], idx[i] = idx[i], idx[k]
			perm(k + 1)
			idx[k], idx[i] = idx[i], idx[k]
		}
	}
	perm(0)
	return best
}

func randInstance(r *rand.Rand) []Job {
	n := 2 + r.Intn(5) // 2..6 jobs
	jobs := make([]Job, n)
	for i := range jobs {
		jobs[i] = Job{1 + r.Intn(6), 1 + r.Intn(12)}
	}
	return jobs
}

func main() {
	r := rand.New(rand.NewSource(1))
	edfOK, sptOK := true, true
	for i := 0; i < 5000; i++ {
		inst := randInstance(r)
		opt := brute(inst)
		if edf(inst) != opt {
			edfOK = false
		}
		if spt(inst) != opt {
			sptOK = false // SPT will mismatch on some instance
		}
	}
	fmt.Println("EDF always optimal:", edfOK)         // true
	fmt.Println("SPT-first always optimal:", sptOK)   // false
}
```

### Java

```java
import java.util.*;

public class Verifier {
    record Job(int t, int d) {}

    static int maxLateness(List<Job> order) {
        int time = 0, mx = 0;
        for (Job j : order) { time += j.t(); mx = Math.max(mx, time - j.d()); }
        return mx;
    }

    static int edf(List<Job> jobs) {
        List<Job> js = new ArrayList<>(jobs);
        js.sort(Comparator.comparingInt(Job::d));
        return maxLateness(js);
    }

    static int spt(List<Job> jobs) {  // WRONG for max lateness
        List<Job> js = new ArrayList<>(jobs);
        js.sort(Comparator.comparingInt(Job::t));
        return maxLateness(js);
    }

    static int best;
    static int brute(List<Job> jobs) {
        best = Integer.MAX_VALUE;
        permute(jobs, new boolean[jobs.size()], new ArrayList<>());
        return best;
    }
    static void permute(List<Job> jobs, boolean[] used, List<Job> cur) {
        if (cur.size() == jobs.size()) { best = Math.min(best, maxLateness(cur)); return; }
        for (int i = 0; i < jobs.size(); i++) {
            if (used[i]) continue;
            used[i] = true; cur.add(jobs.get(i));
            permute(jobs, used, cur);
            cur.remove(cur.size() - 1); used[i] = false;
        }
    }

    public static void main(String[] args) {
        Random r = new Random(1);
        boolean edfOK = true, sptOK = true;
        for (int it = 0; it < 5000; it++) {
            int n = 2 + r.nextInt(5);
            List<Job> inst = new ArrayList<>();
            for (int i = 0; i < n; i++) inst.add(new Job(1 + r.nextInt(6), 1 + r.nextInt(12)));
            int opt = brute(inst);
            if (edf(inst) != opt) edfOK = false;
            if (spt(inst) != opt) sptOK = false;
        }
        System.out.println("EDF always optimal: " + edfOK);        // true
        System.out.println("SPT-first always optimal: " + sptOK);  // false
    }
}
```

### Python

```python
import random
from itertools import permutations


def max_lateness(order):
    time = mx = 0
    for t, d in order:
        time += t
        mx = max(mx, time - d)
    return mx


def edf(jobs):  # CORRECT
    return max_lateness(sorted(jobs, key=lambda j: j[1]))


def spt(jobs):  # WRONG for max lateness
    return max_lateness(sorted(jobs, key=lambda j: j[0]))


def brute(jobs):
    return min(max_lateness(order) for order in permutations(jobs))


def rand_instance(rng):
    n = rng.randint(2, 6)
    return [(rng.randint(1, 6), rng.randint(1, 12)) for _ in range(n)]


if __name__ == "__main__":
    rng = random.Random(1)
    edf_ok = spt_ok = True
    for _ in range(5000):
        inst = rand_instance(rng)
        opt = brute(inst)
        if edf(inst) != opt:
            edf_ok = False
        if spt(inst) != opt:
            spt_ok = False
    print("EDF always optimal:", edf_ok)        # True
    print("SPT-first always optimal:", spt_ok)  # False
```

**What it does:** runs 5000 random small instances, confirming EDF matches the exhaustive optimum every time (the exchange argument made concrete) while exposing that the plausible-looking "shortest processing time first" rule is *not* optimal — a worked example of disproof-by-oracle.
**Run:** `go run main.go` | `javac Verifier.java && java Verifier` | `python verifier.py`

### Follow-up discussion points

- **Why does SPT fail but EDF succeed?** EDF's adjacency-swap exchange shows reordering an inverted (by deadline) pair never raises max lateness; SPT optimizes the wrong key (processing time) and has no such no-worse swap — the oracle finds instances where a longer-but-tighter-deadline job should run first.
- **How big should test instances be?** Keep `n ≤ 8`; the oracle is `Θ(n!)`. 5000 random instances at `n ≤ 6` give high confidence and run in well under a second.
- **What would you add for production confidence?** Exhaustive enumeration of *all* instances up to `n = 5` (not just random), deliberate tie inputs (equal deadlines), and a fixed-seed regression so failures reproduce.
- **How does this connect to the proof?** The harness is the empirical mirror of Schema 2.1: if a no-worse swap always exists (EDF), greedy matches the oracle; if it doesn't (SPT), the oracle exhibits the counterexample.

### Extension: minimize the counterexample (delta-debugging)

A strong follow-up is "when SPT fails, can you *minimize* the counterexample?" The technique is delta-debugging: greedily remove jobs from the failing instance while the mismatch persists. The minimal instance is the cleanest disproof and often reveals the structural reason (e.g., a long job with a tight deadline that must run before a short loose one). Below is the Python core; Go/Java mirror it.

```python
def minimize(inst, greedy, brute):
    changed = True
    while changed and len(inst) > 1:
        changed = False
        for i in range(len(inst)):
            smaller = inst[:i] + inst[i + 1:]
            if greedy(smaller) != brute(smaller):   # mismatch still present
                inst = smaller
                changed = True
                break
    return inst
```

Discussing this signals you understand that a *small* counterexample is far more convincing — and debuggable — than a large random one.

---

## Bonus: Proof-Sketch Drills (Q67–Q74)

Quick "give the exchange in one or two sentences" drills — the kind an interviewer fires after a full proof.

### Q67. One-line exchange for activity selection.
**A.** Replace any optimum's earliest-finishing activity with the globally earliest-finishing one; compatibility and count are preserved.

### Q68. One-line exchange for fractional knapsack.
**A.** Move an `ε` of weight from a lower-ratio item to a higher-ratio one; value changes by `δ(ρ_high − ρ_low) ≥ 0`.

### Q69. One-line exchange for Huffman.
**A.** Swap the two least-frequent symbols to the two deepest sibling leaves; cost change is `(f_deep − f_rare)(depth_deep − depth_rare) ≥ 0`.

### Q70. One-line exchange for MST (Kruskal).
**A.** Add the lightest non-tree edge to an optimum, creating a cycle; remove the cycle's heaviest edge — weight does not increase.

### Q71. One-line termination argument for any adjacency-swap proof.
**A.** Each swap removes one inversion; the inversion count is a non-negative integer, so the process terminates.

### Q72. One-line reason 0/1 knapsack breaks the `ε`-transfer.
**A.** Indivisibility forbids moving an `ε` of an item, so the continuous no-worse transfer is unavailable.

### Q73. One-line statement of the matroid exchange axiom.
**A.** If `A, B` are independent and `|A| < |B|`, some element of `B \ A` can be added to `A` keeping it independent.

### Q74. One-line link between the matroid axiom and a concrete swap.
**A.** Every concrete "exchange a heavier feasible element in without loss" is an instance of the matroid axiom "grow a smaller independent set using an element of a larger one."

---

## Interview Strategy Notes

- **Lead with disproof when asked "is this greedy correct?"** Stating "let me first try to break it with a small case" signals maturity; interviewers value the instinct to find a counterexample before committing to a proof.
- **Name the swap shape explicitly.** Saying "this is an adjacency-swap exchange" or "an `ε`-transfer" shows you have a framework, not just memorized proofs.
- **Always end an exchange proof with the termination argument.** Many candidates do the swap and forget to say *why it terminates* (the inversion count decreases). The interviewer is listening for that.
- **Know the failure twins.** For every correct greedy you can prove, know its near-miss that fails: EDF vs SPT, fractional vs 0/1 knapsack, canonical vs general coins. The contrast demonstrates real understanding.
- **Mention matroids only when relevant.** Dropping "this is the graphic matroid, so Rado–Edmonds applies" for MST is impressive; forcing matroid language onto a non-matroid problem is a red flag.
- **Tie handling is a common follow-up.** Be ready to say how equal keys are resolved and why the proof still holds (the swap is cost-neutral under a fixed tie-break).

---

## Quick-Reference Comparison Table

A compact cheat sheet of the classic greedy problems an interviewer is likely to probe.

| Problem | Greedy key | Correct? | Proof tool | Swap shape |
|---------|-----------|----------|-----------|-----------|
| Activity selection | earliest finish | yes | exchange / stays-ahead | interval swap |
| Interval point cover | earliest right endpoint | yes | exchange | interval swap |
| Minimize max lateness | earliest deadline (EDF) | yes | exchange | adjacency |
| Minimize ΣCⱼ | shortest processing (SPT) | yes | exchange | adjacency |
| Minimize Σwⱼ Cⱼ | `pⱼ/wⱼ` ascending (Smith) | yes | exchange | adjacency |
| Min tardy jobs | Moore–Hodgson | yes | exchange | drop-longest swap |
| Fractional knapsack | value/weight ratio | yes | exchange | `ε`-transfer |
| Huffman coding | merge two least-frequent | yes | exchange + substructure | leaf swap |
| MST | lightest safe edge | yes | exchange / matroid | cut/cycle |
| Job sequencing (deadlines, profit) | profit descending | yes | matroid (transversal) | — |
| Coin change (general) | largest coin | **no** | (counterexample) | — |
| 0/1 knapsack | value/weight ratio | **no** | (counterexample) → DP | — |
| Min platforms (longest-first) | longest duration | **no** | (counterexample) | — |
| Set cover | most-new-elements | approx | charging (`H_n` ratio) | — |

The "no" and "approx" rows are the disproof/approximation traps; being able to instantly produce their counterexamples (or quote their ratios) is what separates a memorizer from someone who understands the technique.
