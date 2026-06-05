# Aliens Trick (Lagrangian Relaxation) — Interview Preparation

The Aliens trick is a favourite mid-to-senior competitive-programming and interview topic because it rewards a single crisp insight — *"to force **exactly `k`** items, add a penalty `λ` per item, solve the cheap unconstrained DP, and **binary-search `λ`** until the count hits `k`, then recover `f(λ) − λ·k`"* — and then tests whether you can (a) recognize the **exactly-`k`** DP shape, (b) justify the **convexity** of `opt(k)` that makes the count monotone in `λ`, (c) write the penalized solver returning `(value, count)` with correct **tie handling** and **recovery**, and (d) compose it with its inner accelerators **CHT** (topic 10) and **D&C** (topic 12). This file is a curated question bank by seniority, behavioral prompts, and an end-to-end coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Problem this solves | exactly-`k` `opt(k)` | — |
| Penalized objective | `f(λ) = min_c ( opt(c) + λ·c )` | one cheap DP per probe |
| What `λ` controls | item count `cnt(λ)`, monotone in `λ` | — |
| Prerequisite | `opt(k)` **convex** in `k` | — |
| Search | binary search on `λ`, driven by `cnt` | `O(log range)` probes |
| Recover | `opt(k) = f(λ) − λ·k` (target `k`) | `O(1)` |
| **Total** | `O(log(range) · DP_cost)` | removes the `k` factor |
| Inner: linear cost | **CHT** (topic 10) | `O(n)` per probe |
| Inner: Monge cost | **D&C** (topic 12) | `O(n log n)` per probe |

The Lagrangian envelope:

```text
f(λ) = min over c of ( opt(c) + c·λ )    # lower envelope of lines, slope c, intercept opt(c)
cnt(λ) = slope (count) of the minimal line ;  non-increasing in λ when opt(k) is convex
opt(k) = f(λ*) − λ*·k                     # exact recovery at a supporting slope λ*
```

Core loop:

```text
lo, hi = 0, MAXSLOPE
while lo < hi:
    mid = (lo + hi) / 2
    (f, cnt) = solve_penalized(mid)        # +λ per item; ties → FEWER items
    if cnt <= k: hi = mid                    # too few/equal → λ may be too big
    else:        lo = mid + 1                 # too many → raise λ
(f, _) = solve_penalized(lo)
answer = f - lo * k                          # recover with TARGET k
```

Key facts:
- Works because `opt(k)` is **convex** ⟹ `cnt(λ)` **monotone** ⟹ binary search valid.
- Recovery is **exact** (strong duality, no gap) for convex problems.
- **Subtract `λ·k` with the target `k`**, correct even on collinear edges.
- Break ties toward **fewer items** for a well-defined monotone count.
- If `opt(k)` is **not** convex, the answer is silently wrong.

---

## Junior Questions (12 Q&A)

### J1. What problem does the Aliens trick solve?
Optimization DPs with a hard "use **exactly `k`** items/segments/groups" constraint, where the count dimension makes the DP cost `O(k · DP)`. The trick removes that dimension.

### J2. What is the core idea in one sentence?
Replace "exactly `k`" with "any number of items, but pay a penalty `λ` per item," solve the cheap unconstrained DP, and binary-search `λ` so the unconstrained optimum uses exactly `k` items.

### J3. What is `opt(k)`?
The optimal (minimum) cost when forced to use exactly `k` items. Computing it for every `k` is what we avoid.

### J4. What is `f(λ)`?
The penalized optimum: `f(λ) = min over any count c of ( opt(c) + λ·c )` — solved by a DP with **no count dimension**, paying `λ` per item.

### J5. How does `λ` control the item count?
Higher `λ` makes items expensive, so the optimum uses **fewer**; lower `λ` makes them cheap, so it uses **more**. The count `cnt(λ)` is monotone in `λ`.

### J6. Why can we binary-search `λ`?
Because `cnt(λ)` is monotone in `λ`. Too many items → raise `λ`; too few → lower `λ`; until `cnt(λ) = k`.

### J7. How do you recover the true answer for exactly `k`?
`opt(k) = f(λ) − λ·k`. The penalized value bundles in `λ·k` of toll; subtracting it gives the real cost.

### J8. What is the time complexity?
`O(log(range) · DP_cost)` — a `log(range)` factor (a few dozen probes) replaces the `k` factor.

### J9. Why is it called the "Aliens trick"?
After IOI 2016 problem "Aliens," the contest problem that popularized the technique.

### J10. For a minimization, do you add or subtract the penalty?
**Add** `λ` per item. (For a maximization you subtract.)

### J11. What single property must `opt(k)` have for the trick to work?
**Convexity** in `k`: the marginal cost increments `opt(k) − opt(k−1)` are non-decreasing.

### J12 (analysis). What happens if `opt(k)` is not convex?
The tangent line can miss your `k`; the binary search converges to the wrong `λ` and the recovered value is wrong — with no crash. Always verify convexity first.

---

## Middle Questions (12 Q&A)

### M1. Why does convexity make `cnt(λ)` monotone?
`f(λ) = min_c ( opt(c) + c·λ )` is the lower envelope of lines with slope `c` and intercept `opt(c)`. As `λ` grows, the minimal line shifts to smaller slope (count), so `cnt(λ)` is non-increasing — but only if every `c` is on the hull, which is exactly convexity.

### M2. Why is the recovery `f(λ) − λ·k` exact, not a bound?
Strong duality: for a convex problem, the Lagrangian relaxation is **tight** at the count it selects. At a supporting slope, `f(λ) = opt(k) + λ·k`, so `opt(k) = f(λ) − λ·k` exactly — no duality gap.

### M3. What does the penalized DP return, and why two values?
It returns `(f(λ), cnt(λ))` — the penalized optimum **and** the item count. The binary search is driven by the **count**, not the value (the value is concave, not monotone).

### M4. Why drive the search by count and not by value?
`f(λ)` is concave in `λ`, so a value comparison is ill-posed. The count `cnt(λ)` is monotone, giving a clean step predicate `cnt(λ) ≤ k`.

### M5. What is the geometric picture?
Plot `(k, opt(k))` as a convex bowl. A penalty `λ` is a line of slope `−λ` pressed up from below; the tangent point's `k` is `cnt(λ)`. Lowering `λ` slides the tangent right; the search finds the `λ` whose tangent is at `k`.

### M6. What is the "collinear points" problem?
When several consecutive `opt(k)` are collinear (a hull edge), one slope `λ*` is optimal for all of them, so `cnt(λ)` **jumps over** the interior counts — possibly your `k` — and the search "never lands on exactly `k`."

### M7. How do you handle the collinear case?
Binary-search the **boundary slope** (smallest `λ` with `cnt(λ) ≤ k`, ties → fewer items) and **recover with the target `k`**. Because `k` lies on the same supporting line, `f(λ⁰) − λ⁰·k` is exact even though `cnt(λ⁰) ≠ k`.

### M8. Why subtract `λ·k` with the target `k` and not the probed count?
On a collinear edge the probe's count differs from `k`, but `opt(k)` still lies on the line `f(λ) − λ·k`. Using the target `k` lands on `opt(k)` exactly.

### M9. How do you break ties in the penalized DP?
Among equal penalized values, prefer **fewer items**. This makes `cnt(λ)` the left endpoint of each collinear stretch and keeps it monotone, so the search is well-defined.

### M10. Exactly-`k` vs at-most-`k` — what changes?
"At most `k`" is `min_{c ≤ k} opt(c)`; for convex `opt` this is either at `c = k` or at the global minimum count. "Exactly `k`" is the harder one and the real use of the trick.

### M11. Integer vs real `λ` — which and why?
Prefer **integer `λ`** for integer inputs: hull slopes are integer differences `opt(k) − opt(k−1)`, so an integer search lands exactly on the boundary with no precision issues. Use real `λ` (fixed iterations) only for continuous problems.

### M12. How is Aliens different from CHT / D&C?
CHT and D&C speed up **one layer** of a DP; Aliens **removes the count dimension**. They are complementary and often composed — Aliens removes `k`, then CHT/D&C makes each penalized `f(λ)` fast.

---

## Senior Questions (10 Q&A)

### S1. How do you compose Aliens with the Convex Hull Trick?
The penalized DP `g[j] = min_{t<j}(g[t] + cost(t,j) + λ)` is single-layer. If `cost` is linear in a query of `j` (e.g. `(P[j]−P[t])²` expands to a line in `P[j]`), maintain a line hull and answer each `g[j]` in `O(1)`/`O(log n)`. Total `O(n log(range))` — the canonical IOI-Aliens build.

### S2. How do you compose Aliens with Divide & Conquer optimization?
If `cost` is Monge but not line-decomposable, fill each penalized row with the D&C recursion in `O(n log n)`; total `O(n log n · log(range))`.

### S3. How do you pick the binary-search range for `λ`?
`lo = 0` (items free → max count). `hi` must exceed the largest marginal cost `|opt(k) − opt(k−1)|`; a safe coarse bound is the maximum single-item cost. Tighten it to avoid `λ·k` overflow.

### S4. What overflow risks exist and how do you mitigate them?
Squared/penalized costs and `λ·k` can exceed 64-bit (e.g. `(n·V)²` and `λ·k`). Bound the magnitude up front; use `int64`/`int128`/big-int deliberately; verify `hi·k` fits the type.

### S5. How do you verify convexity in production?
Best: prove it (Monge cost ⟹ convex `opt`, or diminishing returns). Otherwise: build the count-indexed `opt(k)` table on random small inputs and assert non-decreasing increments in CI, fuzzing edge inputs (all-equal, single huge element, `k=1`, `k=n`).

### S6. What is the dominant failure mode and how is it caught?
A **silent wrong answer** when `opt(k)` is non-convex. Caught by a count-indexed `O(k·DP)` oracle plus a convexity assertion run on many random small instances.

### S7. Why might the reconstructed partition not use exactly `k` pieces?
On a collinear edge, the *value* `opt(k)` is exact but the reconstructed count may be the edge's left endpoint. If an exactly-`k` witness is required, split/merge within the collinear stretch (all such configs are equally optimal).

### S8. How do you test recovery correctness?
Recovery invariance: for two different `λ` in the count-`k` interval, `f(λ) − λ·k` must give the same value (`opt(k)`). Plus value agreement with the oracle for every `k`.

### S9. When should you NOT use the Aliens trick?
When `k` is small (naive `O(k·DP)` is simpler and fast), when penalizing does not simplify the DP, or when `opt(k)` is non-convex (the trick is unsafe).

### S10. What numeric subtlety arises with floating-point variance/SSE costs?
Catastrophic cancellation in `Σx² − (Σx)²/(j−t)` yields tiny negative SSE that mis-orders the argmin. Use a scaled-integer cost or a stable variance formula; never loosen the algorithm's strict `<` to "fix" it.

### S11. How would you set the binary-search upper bound formally?
`hi = max_k |opt(k) − opt(k−1)|`, the largest marginal — every hull-edge slope is bounded by it, so the whole supporting-slope range lies in `[0, hi]`. In code, use a computable over-estimate (e.g. max single-item cost). Over-estimating only adds `O(log)` probes but watch `hi·k` overflow.

### S12. Can the Aliens trick handle two simultaneous count constraints?
In principle yes: use a multiplier *vector* `λ = (λ₁, λ₂)` and require `opt(k₁, k₂)` to be **jointly convex**. But the clean 1-D binary search no longer applies (coordinates interact), so you need a 2-D parametric/subgradient search and richer tie-handling. In practice `m = 1` dominates; `m = 2` is rare and finicky.

---

## Professional Questions (8 Q&A)

### P1. State and prove that convex `opt` implies `cnt(λ)` is non-increasing.
Let `c₁ = cnt(λ₁)`, `c₂ = cnt(λ₂)`, `λ₁ < λ₂`. Optimality gives `opt(c₁)+λ₁c₁ ≤ opt(c₂)+λ₁c₂` and `opt(c₂)+λ₂c₂ ≤ opt(c₁)+λ₂c₁`. Adding: `(λ₁−λ₂)(c₁−c₂) ≤ 0`; since `λ₁−λ₂ < 0`, `c₁ ≥ c₂`. ∎

### P2. Why is convexity *necessary*, not just sufficient?
A count `c` is selected by some `λ` iff `(c, opt(c))` is on the lower hull (admits a supporting line). If `opt` is non-convex, the non-hull point is below no supporting line, so **no** `λ` selects it — the search can never reach that `c`.

### P3. Prove strong duality: `opt(k) = max_λ ( f(λ) − λ·k )`.
Weak: `f(λ) ≤ opt(k) + λk` ⟹ `f(λ) − λk ≤ opt(k)` for all `λ`. Strong: at a supporting slope `λ*`, `f(λ*) = opt(k) + λ*k`, attaining equality. Hence the max equals `opt(k)` with no gap. ∎

### P4. Why is `f(λ)` concave and piecewise linear?
It is the pointwise minimum of affine functions `opt(c) + c·λ` (one per count); a min of affine functions is concave, and over finitely many `c` it is piecewise linear.

### P5. Why recover with the target `k` on a collinear edge?
On the stretch, `opt(c) = α − λ*·c` for all `c ∈ [c_L, c_R]` and `f(λ*) = α`. So `opt(k) = α − λ*·k = f(λ*) − λ*·k` for any `k` in the stretch, independent of the probed count.

### P6. Give the time and space complexity with proof.
Time `O(log R · D)`: `O(log R)` probes, each one penalized DP at cost `D`, plus `O(1)` recovery. Space `O(n)`: one `g[·]` row and one `cnt[·]` row reused across probes, independent of `k`.

### P7. When does a Monge cost guarantee convex `opt(k)`?
If the partition cost `C` satisfies the quadrangle inequality, an uncrossing/exchange argument gives `2·opt(k+1) ≤ opt(k) + opt(k+2)`, i.e. `Δ(k+1) ≤ Δ(k+2)` — convexity (the value function is convex in the number of parts).

### P8. How does the maximization mirror work?
For concave `opt`, define `f(λ) = max_c ( opt(c) − λc )`; `cnt(λ)` is non-decreasing in `λ`, and `opt(k) = f(λ*) + λ*·k`. Apply the minimization theory to `−opt`.

### P9. Express the recovery as a Legendre–Fenchel conjugate.
`f(λ) = min_x ( opt(x) + λx )` is (the negation of) the conjugate of `opt` at `−λ`. For convex `opt`, conjugation is an involution, so `opt(k) = max_λ ( f(λ) − λk )` reconstructs `opt` exactly. For non-convex `opt`, this reconstructs the **convex hull** `\widehat{opt}(k) ≤ opt(k)` — the precise origin of the duality gap.

### P10. What exactly does the Aliens trick compute on a non-convex `opt`?
It computes `\widehat{opt}(k)`, the **lower convex hull** value at `k`. This equals `opt(k)` iff `(k, opt(k))` is a hull point; otherwise it under-reports by the vertical gap to the hull. That one fact captures the whole correctness theory.

### P11. Why is the count predicate `cnt(λ) ≤ k` monotone but `f(λ) ≤ v` is not usable?
`cnt(λ)` is non-increasing in `λ` (Theorem 3.1), so `cnt(λ) ≤ k` is a clean step predicate. `f(λ)` is **concave** (a min of affine functions), so it rises then falls — there is no threshold `λ` making `f(λ) ≤ v` monotone. Hence the search must branch on the count.

### P12. Sketch the proof that Monge cost ⟹ convex `opt(k)`.
Overlay an optimal `(k−1)`-partition and `(k+1)`-partition; the latter has two extra cuts. Route one cut into the smaller partition and remove one from the larger, producing two `k`-partitions. The quadrangle inequality guarantees each uncrossing (crossing → nested boundary swap) does not raise cost, giving `cost(Π') + cost(Π'') ≤ opt(k−1) + opt(k+1)`. Optimality of `opt(k)` gives `2·opt(k) ≤ opt(k−1) + opt(k+1)` — convexity.

---

## Rapid-Fire Trap Table

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Answer wrong on one input, fine on others | `opt(k)` non-convex (or non-convex corner) | Verify convexity; fall back to count-indexed DP |
| Answer is the penalized cost, way too big | Forgot to subtract `λ·k` | Recover `f(λ) − λ·k` |
| Search loops / never lands on `k` | Collinear edge; chasing `cnt == k` | Boundary search (`cnt ≤ k`) + target-`k` recovery |
| Off by exactly the toll on edges | Recovered with probed count, not target `k` | Subtract `λ·k` with the **target** `k` |
| Plausible but wrong large-input answer | Overflow in `f(λ)` or `λ·k` | Bound magnitudes; widen type; tighten `hi` |
| Search goes the wrong direction | Penalty sign flipped | `+λ` for min, `−λ` for max |
| Float-`λ` never stabilizes | Count flicker at the boundary | Fixed iteration count; prefer integer `λ` |
| Correct value, wrong number of pieces | Witness on a collinear edge | Split/merge within the stretch to reach `k` |

---

## Behavioral / System-Design Prompts

- **"Walk me through deciding whether Aliens applies to a new problem."** Check for a hard exactly-`k` constraint, prove/verify `opt(k)` convex, confirm the penalized DP is cheaper, and ensure you can compute the count. Mention the silent-wrong-answer risk and the convexity assertion.
- **"A teammate says 'the search found `λ` where `cnt = k`, so we're done.' What do you add?"** That works for hull vertices, but on a collinear edge `cnt(λ)` jumps over `k`; use the boundary search and recover with the target `k` so the edge case is handled, and document the fewest-items tie-break.
- **"How do you regression-test an Aliens solution you can't eyeball?"** A count-indexed `O(k·DP)` oracle for value agreement on every `k`, a convexity assertion on the oracle's `opt(k)`, a recovery-invariance check across two valid `λ`, and edge-input fuzzing (`k=1`, `k=n`, all-equal).
- **"You shipped an Aliens solution and a customer reports a wrong number on one input. How do you debug?"** Reproduce, run the count-indexed oracle on that input, check the convexity assertion (applicability bug) and the recovery/penalty-sign/range (implementation bug), and check overflow.
- **"How would you make the per-probe DP fast?"** Identify the cost structure: linear → CHT, Monge → D&C, simple → monotonic `O(n)`. State both preconditions (convexity for Aliens, plus the inner method's).
- **"Why integer `λ`?"** Exact boundary slopes, clean termination, no float flicker; reserve real `λ` for continuous problems.

### Common Misconceptions to Correct

- *"The trick finds an approximate answer."* — No; for convex `opt` the recovery is **exact** (strong duality, zero gap). It under-reports only on **non-convex** instances (where it returns the hull value).
- *"You binary-search `λ` until `f(λ)` is minimized."* — No; `f(λ)` is concave and you do **not** minimize it. You search the `λ` whose **count** matches `k`.
- *"`cnt(λ) = k` always exists."* — Only when `k` is a hull vertex. On a collinear edge, no `λ` gives `cnt = k`; use the boundary search.
- *"Aliens replaces CHT/D&C."* — No; it is **orthogonal**. CHT/D&C speed up one layer; Aliens removes the count dimension. They compose.

### One-Minute Whiteboard Recipe

A compact script to recite when asked to "explain the Aliens trick":

1. **Spot it.** The DP forces *exactly `k`* items and the `k` dimension dominates the cost.
2. **Penalize.** Add `λ` per item (subtract for max); the count dimension disappears.
3. **Justify.** `opt(k)` must be **convex** — say why (Monge cost / diminishing returns).
4. **Search.** Binary-search `λ`; each probe solves the cheap penalized DP and returns `(f, cnt)`; steer by `cnt` vs `k`.
5. **Handle ties.** Fewest-items tie-break; boundary search (`cnt ≤ k`) so collinear `k` is reachable.
6. **Recover.** `opt(k) = f(λ) − λ·k` with the **target** `k`.
7. **Speed up the inner DP.** CHT (linear cost) or D&C (Monge) makes each probe `O(n)`/`O(n log n)` → total `O(log(range)·DP)`.

If you can produce these seven steps and name the convexity precondition, you have demonstrated mastery of the topic.

### Two Follow-Up Questions Interviewers Love

- **"What does the trick return if `opt(k)` is *not* convex?"** It returns the **lower convex hull value** `\widehat{opt}(k) ≤ opt(k)` — exact only when `k` is a hull point, otherwise an under-estimate. Naming the convex hull (rather than vaguely "a wrong answer") signals you understand the duality theory.
- **"Prove the count is monotone in `λ` in two lines."** Optimality at `λ₁, λ₂` gives `opt(c₁)+λ₁c₁ ≤ opt(c₂)+λ₁c₂` and the symmetric inequality; adding yields `(λ₁−λ₂)(c₁−c₂) ≤ 0`, so `λ₁ < λ₂ ⟹ c₁ ≥ c₂`. The exchange argument is the cleanest possible proof and interviewers expect it from senior candidates.

---

## Coding Challenge (3 Languages)

### Challenge: Split Array into Exactly `K` Subarrays Minimizing Sum of Squared Subarray Sums

> Given an integer array `a` of length `n` and an integer `K` (`1 ≤ K ≤ n`), partition `a` into exactly `K` **contiguous, non-empty** subarrays, minimizing the sum over subarrays of `(subarray sum)²`. Return the minimum total.
>
> Use the **Aliens trick**: binary-search a penalty `λ` added per subarray, solve the penalized DP (here a clear `O(n²)` inner DP — replace with CHT for `O(n)`), drive the search by the subarray count (ties → fewer subarrays), and recover `f(λ) − λ·K`.
>
> Example: `a = [1, 3, 2, 4]`, `K = 2` → split `[1,3] | [2,4]`, cost `4² + 6² = 52`.

#### Go

```go
package main

import "fmt"

const INF = int64(1) << 62

func splitExactlyK(a []int, K int) int64 {
	n := len(a)
	prefix := make([]int64, n+1)
	for i, x := range a {
		prefix[i+1] = prefix[i] + int64(x)
	}
	cost := func(t, j int) int64 {
		s := prefix[j] - prefix[t]
		return s * s
	}
	// penalized DP: returns f(λ) and subarray count (ties → fewer subarrays)
	solve := func(lambda int64) (int64, int) {
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
	lo, hi := int64(0), prefix[n]*prefix[n] // safe slope bound
	for lo < hi { // smallest λ with cnt(λ) <= K
		mid := lo + (hi-lo)/2
		if _, c := solve(mid); c <= K {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	f, _ := solve(lo)
	return f - lo*int64(K) // recover with target K
}

func main() {
	fmt.Println(splitExactlyK([]int{1, 3, 2, 4}, 2)) // 52
	fmt.Println(splitExactlyK([]int{1, 3, 2, 4}, 4)) // 30 (each element alone)
	fmt.Println(splitExactlyK([]int{1, 3, 2, 4}, 1)) // 100 (one piece, 10^2)
}
```

#### Java

```java
public class SplitExactlyK {
    static final long INF = 1L << 62;

    static long splitExactlyK(int[] a, int K) {
        int n = a.length;
        long[] prefix = new long[n + 1];
        for (int i = 0; i < n; i++) prefix[i + 1] = prefix[i] + a[i];

        // penalized DP returning {f(lambda), count}; ties → fewer subarrays
        java.util.function.LongFunction<long[]> solve = (lambda) -> {
            long[] g = new long[n + 1];
            int[] cnt = new int[n + 1];
            for (int j = 1; j <= n; j++) {
                long best = INF; int bestCnt = 0;
                for (int t = 0; t < j; t++) {
                    long s = prefix[j] - prefix[t];
                    long v = g[t] + s * s + lambda;
                    int c = cnt[t] + 1;
                    if (v < best || (v == best && c < bestCnt)) { best = v; bestCnt = c; }
                }
                g[j] = best; cnt[j] = bestCnt;
            }
            return new long[]{g[n], cnt[n]};
        };

        long lo = 0, hi = prefix[n] * prefix[n];
        while (lo < hi) {                          // smallest λ with cnt(λ) <= K
            long mid = lo + (hi - lo) / 2;
            if (solve.apply(mid)[1] <= K) hi = mid; else lo = mid + 1;
        }
        long f = solve.apply(lo)[0];
        return f - lo * (long) K;                  // recover with target K
    }

    public static void main(String[] args) {
        System.out.println(splitExactlyK(new int[]{1, 3, 2, 4}, 2)); // 52
        System.out.println(splitExactlyK(new int[]{1, 3, 2, 4}, 4)); // 30
        System.out.println(splitExactlyK(new int[]{1, 3, 2, 4}, 1)); // 100
    }
}
```

#### Python

```python
INF = 1 << 62


def split_exactly_k(a, K):
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
                if v < best or (v == best and c < best_cnt):  # fewer subarrays
                    best, best_cnt = v, c
            g[j], cnt[j] = best, best_cnt
        return g[n], cnt[n]

    lo, hi = 0, prefix[n] * prefix[n]
    while lo < hi:                       # smallest λ with cnt(λ) <= K
        mid = (lo + hi) // 2
        _, c = solve(mid)
        if c <= K:
            hi = mid
        else:
            lo = mid + 1
    f, _ = solve(lo)
    return f - lo * K                    # recover with target K


if __name__ == "__main__":
    print(split_exactly_k([1, 3, 2, 4], 2))  # 52
    print(split_exactly_k([1, 3, 2, 4], 4))  # 30
    print(split_exactly_k([1, 3, 2, 4], 1))  # 100
```

**Discussion points the interviewer is listening for:**
- The inner DP here is `O(n²)`; the *real* speedup comes from replacing it with **CHT** (`(P[j]−P[t])²` is linear in `P[j]`) for `O(n)` per probe, giving `O(n log(range))` total — independent of `K`.
- The cost `(P[j]−P[t])²` is Monge, so `opt(k)` is **convex** — the precondition that makes the trick valid; mention how you would assert it.
- Tie-break toward **fewer** subarrays and **recovery with the target `K`** make the collinear case correct.
- Bound `hi` by `(total sum)²` and watch `hi·K` for overflow; prefer `int64` and verify the magnitude.

---

## Warm-Up Exercise: Convexity Check + Recovery Invariance

> A quick self-test that exercises the *theory* rather than the search. Given the array of `opt(k)` values for `k = 0..n`, (1) decide whether `opt` is convex (non-decreasing first differences), and (2) for a hull-vertex `k`, verify that recovering with two different supporting `λ` yields the same `opt(k)`.

#### Go

```go
package main

import "fmt"

func isConvex(opt []int64) bool {
	for k := 2; k < len(opt); k++ {
		if opt[k]-opt[k-1] < opt[k-1]-opt[k-2] {
			return false // first differences must be non-decreasing
		}
	}
	return true
}

// f(λ) over a KNOWN opt[] (counts are indices); returns f and cnt (fewest items on ties).
func f(opt []int64, lambda int64) (int64, int) {
	best, bestC := int64(1)<<62, 0
	for c := 1; c < len(opt); c++ {
		v := opt[c] + lambda*int64(c)
		if v < best {
			best, bestC = v, c
		}
	}
	return best, bestC
}

func main() {
	opt := []int64{0, 100, 52, 30, 16} // index = count; convex
	fmt.Println("convex:", isConvex(opt)) // true
	// k=2 is a vertex on λ ∈ [22,48]; recovery invariant:
	f1, _ := f(opt, 30)
	f2, _ := f(opt, 40)
	fmt.Println(f1-30*2, f2-40*2) // 52 52
}
```

#### Java

```java
public class Warmup {
    static boolean isConvex(long[] opt) {
        for (int k = 2; k < opt.length; k++)
            if (opt[k] - opt[k - 1] < opt[k - 1] - opt[k - 2]) return false;
        return true;
    }
    static long[] f(long[] opt, long lambda) {
        long best = 1L << 62; int bestC = 0;
        for (int c = 1; c < opt.length; c++) {
            long v = opt[c] + lambda * c;
            if (v < best) { best = v; bestC = c; }
        }
        return new long[]{best, bestC};
    }
    public static void main(String[] args) {
        long[] opt = {0, 100, 52, 30, 16};
        System.out.println("convex: " + isConvex(opt)); // true
        System.out.println((f(opt, 30)[0] - 30 * 2) + " " + (f(opt, 40)[0] - 40 * 2)); // 52 52
    }
}
```

#### Python

```python
def is_convex(opt):
    return all(opt[k] - opt[k - 1] >= opt[k - 1] - opt[k - 2] for k in range(2, len(opt)))


def f(opt, lam):
    best, best_c = 1 << 62, 0
    for c in range(1, len(opt)):
        v = opt[c] + lam * c
        if v < best:
            best, best_c = v, c
    return best, best_c


if __name__ == "__main__":
    opt = [0, 100, 52, 30, 16]          # index = count; convex
    print("convex:", is_convex(opt))    # True
    f1, _ = f(opt, 30)
    f2, _ = f(opt, 40)
    print(f1 - 30 * 2, f2 - 40 * 2)     # 52 52
```

**Why this matters:** the warm-up isolates the two facts the full trick depends on — *convexity* (so the search is valid) and *recovery invariance* (so any supporting `λ` works). If a candidate cannot articulate these, they will misapply the trick on the harder partition problem above.

---

**Next step:** [`tasks.md`](./tasks.md) — graded practice tasks (beginner → advanced) in Go, Java, and Python.
