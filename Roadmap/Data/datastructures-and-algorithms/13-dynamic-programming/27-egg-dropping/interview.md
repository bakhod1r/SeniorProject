# Egg Dropping Puzzle (DP Minimax) — Interview Preparation

The egg-drop puzzle is a perennial interview favorite because it rewards a single crisp insight — *"`dp[e][f] = 1 + min_x max(break, survive)` is a minimax DP"* — and then tests whether you can (a) get the base cases and the floor split exactly right, (b) recognize the dramatically faster **trials reformulation** `g(e,t) = g(e-1,t-1) + g(e,t-1) + 1`, (c) produce the **binomial closed form** `Σ C(t, i)` and the **`k = 2` √(2n) jump strategy**, and (d) avoid the classic trap of summing or averaging the two branches instead of taking the `max`. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Min trials, `k` eggs, `n` floors | `dp[e][f] = 1 + min_x max(dp[e-1][x-1], dp[e][f-x])` | `O(k·n²)` |
| Same, with convex pruning | binary search on the unimodal inner cost | `O(k·n·log n)` |
| Same, fast | trials dual: smallest `t` with `g(k, t) ≥ n` | `O(k·log n)` |
| Max floors, `e` eggs, `t` trials | `g(e, t) = g(e-1, t-1) + g(e, t-1) + 1` | `O(k·t)` |
| Max floors closed form | `g(e, t) = Σ_{i=1}^{e} C(t, i)` | `O(k·t)` |
| `k = 2` | smallest `t` with `t(t+1)/2 ≥ n` ≈ `√(2n)` | `O(1)` |
| Unlimited eggs / lower bound | `⌈log₂(n+1)⌉` (binary search) | `O(log n)` |
| Reconstruct the strategy | first drop = `g(k-1, t*-1) + 1`, recurse | `O(t*)` per path |

Core recurrences:

```text
trials-from-floors (minimax):
  dp[e][f] = 1 + min_{x=1..f} max( dp[e-1][x-1] , dp[e][f-x] )
  base: dp[1][f] = f, dp[e][0] = 0, dp[e][1] = 1

floors-from-trials (dual, fast):
  g(e, t) = g(e-1, t-1) + g(e, t-1) + 1
  answer = min { t : g(k, t) >= n }
```

Key facts:
- **Minimax:** you `min` over the drop floor, the adversary `max`es over break/survive. Never sum or average.
- **Below a drop at `x`:** `x-1` floors. **Above:** `f-x` floors. The `+1` is the current drop.
- `dp[1][f] = f` (one egg = linear scan); `dp[k][0] = 0`; `dp[k][n] ≥ ⌈log₂(n+1)⌉`.
- For `2` eggs and `100` floors the answer is **14** (`13·14/2 = 91 < 100 ≤ 105`).

---

## Junior Questions (12 Q&A)

### J1. What is the egg-dropping problem actually asking?
Not "what is the critical floor" (that depends on the building) but "what is the **minimum number of drops that always suffices** to find it, in the worst case, playing optimally with `k` eggs?" The critical floor `T` is where eggs start breaking; you want the fewest guaranteed trials.

### J2. Why is it called a minimax problem?
You **minimize** over your choice — which floor to drop from — while an adversary **maximizes** over the outcome you cannot control — whether the egg breaks or survives. The recurrence is literally `min_x max(break, survive)`.

### J3. What does `dp[e][f]` mean?
The minimum number of trials that guarantees finding the critical floor with `e` eggs and `f` floors still to distinguish. The answer to the puzzle is `dp[k][n]`.

### J4. Write the recurrence.
`dp[e][f] = 1 + min over x in [1..f] of max(dp[e-1][x-1], dp[e][f-x])`. The first drop is at floor `x`; if it breaks you have `e-1` eggs and the `x-1` floors below; if it survives you have `e` eggs and the `f-x` floors above; the `+1` is the drop itself.

### J5. Why `max` of the two branches, not the sum?
You only ever experience one outcome, but your guarantee must hold for the worst one. The adversary chooses the worse branch, so you plan for the `max`. Summing would count drops you never make.

### J6. What is `dp[1][f]` and why?
`f`. With one egg you must scan floors `1, 2, 3, …` from the bottom; if you skipped a floor and the egg broke, you would not know which skipped floor was critical, and you have no egg left to check.

### J7. What is `dp[e][0]`?
`0`. With zero floors there is nothing to distinguish — the critical floor is already known to be `0`.

### J8. For 2 eggs and 100 floors, what is the answer?
`14`. With 2 eggs and `t` trials you can cover `t(t+1)/2` floors; `13·14/2 = 91 < 100`, but `14·15/2 = 105 ≥ 100`, so 14 trials suffice and 13 do not.

### J9. What is the optimal first drop for 2 eggs, 100 floors?
Floor `14`. If it breaks, scan floors `1..13` (worst case 13 more drops = 14 total). If it survives, jump to `14 + 13 = 27`, then `27 + 12 = 39`, …, shrinking the jump by one each time.

### J10. How does the answer change with more eggs?
It falls from `n` (one egg, linear scan) toward `⌈log₂(n+1)⌉` (many eggs, binary search). Each extra egg lets you take bigger first jumps. Past `⌈log₂(n+1)⌉` eggs, more eggs do not help.

### J11. What is the time complexity of the basic DP?
`O(k·n²)`: there are `O(k·n)` states, and each scans all `O(n)` candidate first-drop floors.

### J12 (analysis). Why is it dynamic programming and not greedy?
The optimal first drop depends on the optimal solutions to *both* sub-ranges (below and above), which overlap across states — classic overlapping subproblems and optimal substructure. A purely greedy "always halve" ignores the egg constraint and fails when an egg might break early.

---

## Middle Questions (12 Q&A)

### M1. Prove the recurrence is correct.
Induction on `(e, f)`. Base: `dp[1][f] = f` (linear scan), `dp[e][0] = 0`. Step: any strategy makes a first drop at some `x`; break ⇒ subproblem `(e-1, x-1)`, survive ⇒ subproblem `(e, f-x)`. The adversary picks the worse branch (`max`), you pick the best `x` (`min`), plus 1 for the drop. So `dp[e][f] = 1 + min_x max(dp[e-1][x-1], dp[e][f-x])`.

### M2. What is the trials reformulation?
Flip the question: `g(e, t)` = the maximum floors coverable with `e` eggs and `t` trials. Then `g(e, t) = g(e-1, t-1) + g(e, t-1) + 1` (floors below + floors above + the drop), and the answer is the smallest `t` with `g(k, t) ≥ n`. It is `O(k·log n)`.

### M3. Why is the trials reformulation so much faster?
It has no inner minimization — the recurrence is a plain `O(1)` sum — and the number of trials `t*` is small (at most `n`, usually `O(log n)`). So the work is `O(k)` per trial over `t*` trials, versus `O(n)` per state over `O(k·n)` states.

### M4. What is the binomial closed form?
`g(e, t) = Σ_{i=1}^{e} C(t, i)`. The answer is the smallest `t` with this sum `≥ n`. It counts decision-tree leaves of height `t` using at most `e` break-edges.

### M5. Derive the `k = 2` closed form.
`g(2, t) = g(1, t-1) + g(2, t-1) + 1 = (t-1) + g(2, t-1) + 1 = g(2, t-1) + t`. Unrolling: `g(2, t) = 1 + 2 + … + t = t(t+1)/2`. So `dp[2][n]` is the smallest `t` with `t(t+1)/2 ≥ n`, about `√(2n)`.

### M6. Explain the 2-egg jump strategy.
Drop the first egg from floor `t`, then `t + (t-1)`, then `+(t-2)`, …, shrinking each jump by one. The shrinking exactly compensates for trials already used: after `j` survives, `t-j` trials remain, so the next safe jump is `t-j`. If the first egg ever breaks, linear-scan the floors just below with the second egg.

### M7. The inner cost `max(dp[e-1][x-1], dp[e][f-x])` — what shape is it in `x`?
Unimodal (a valley). `dp[e-1][x-1]` rises with `x` (more floors below), `dp[e][f-x]` falls with `x` (fewer above), so their `max` dips to a minimum at the crossover. That lets binary search find the optimal `x` in `O(log n)`, giving `O(k·n·log n)`.

### M8. How do you reconstruct the actual dropping strategy?
Store the optimal first drop `x*` per state (or compute `g(k-1, t*-1) + 1` from the dual). At the top, drop at `x*`; on break recurse into `(e-1, x*-1)`, on survive into `(e, f-x*)`. This emits the full decision tree.

### M9. What is the lower bound and why?
`⌈log₂(n+1)⌉`. Each drop yields at most one bit (break/survive), and you must distinguish `n+1` possible critical floors, so you need at least `log₂(n+1)` bits. Binary search achieves it when eggs are plentiful.

### M10. Why cap the number of eggs?
With `n` floors you never need more than `⌈log₂(n+1)⌉` eggs — that many lets you binary-search, hitting the lower bound. Extra eggs cannot reduce the count, so replace `k` with `min(k, ⌈log₂(n+1)⌉)` to avoid wasted work.

### M11. What goes wrong if you update `g[e]` from low `e` to high `e`?
You read the *current* trial's `g[e-1]` instead of the previous trial's, double-counting and overestimating coverage (so undercounting trials). Always iterate `e` from high to low when using a rolling 1D array.

### M12 (analysis). How does the answer interpolate between extremes?
`dp[1][n] = n` (linear), `dp[2][n] ≈ √(2n)`, `dp[e][n] ≈ (e!·n)^{1/e}`, and `dp[k][n] = ⌈log₂(n+1)⌉` for `k ≥ log₂(n+1)`. Each extra egg takes roughly another root of `n`, until binary search takes over.

---

## Senior Questions (10 Q&A)

### S1. How would you solve it for `n = 10^9`?
The `O(k·n²)` table is infeasible. Use the trials dual `g(e, t) = g(e-1, t-1) + g(e, t-1) + 1`, growing `t` until `g(k, t) ≥ n`. It is `O(k·log n)` for large `k` and uses `O(k)` space. Cap the sum at `n` to avoid overflow.

### S2. When do you use the closed form vs the dual?
For `k = 2`, the closed form `t(t+1)/2 ≥ n` is `O(1)` — invert with integer sqrt and a correction step. For general `k`, the dual and the binomial form are both `O(k·t*)`; pick whichever is cleaner. For `k ≥ log₂(n+1)`, just return `⌈log₂(n+1)⌉`.

### S3. How do you reconstruct and validate the strategy in production?
Reconstruct from the dual: first drop at `g(k-1, t*-1) + 1`, recurse on break/survive. Validate with a simulator that walks the decision tree for every possible critical floor `T ∈ {0..n}` and asserts the drop count never exceeds `t*` and never uses more than `k` breaks.

### S4. What are the main correctness pitfalls?
Off-by-one in the split (`x-1` below, `f-x` above), wrong one-egg base case (`dp[1][f]` must be `f`, not `log f`), summing/averaging instead of `max`, treating `dp[0][f>0]` as `0` instead of `∞`, and `sqrt`/binomial rounding that *under*-counts and falsely claims a guarantee.

### S5. How do you avoid overflow?
Cap `g` at `n` (`g[e] = min(g[e-1]+g[e]+1, n)`) since you only compare against `n`. Cap binomial sums at `n` and break early. For `k=2`, use integer sqrt with a correction loop, not floating sqrt on `1 + 8n`.

### S6. Is there an `O(k·n)` table method?
Yes. The inner objective is unimodal *and* its argmin `x*(e, f)` is monotone non-decreasing in `f` (Monge structure). Sweeping `f` upward and advancing `x*` monotonically (a two-pointer) makes the inner work amortize to `O(1)` per state, giving `O(k·n)`.

### S7. How do you test it when you cannot brute-force large `n`?
Cross-method agreement: compute `t*` four ways (table, dual, binomial, `k=2` form) on small inputs and assert equality. Add monotonicity checks (`dp` non-decreasing in `n`, non-increasing in `k`), the `dp[1][n] == n` check, and the strategy simulator. Anchor with a brute-force recursion oracle on tiny `(k, n)`.

### S8. What is the connection to decision trees?
A strategy is a binary decision tree: drops are internal nodes, break/survive are children, leaves are determined critical floors. Worst-case trials = tree height. The egg limit caps the number of break-edges per root-to-leaf path at `k`, which is exactly why the leaf count is `Σ_{i=1}^{k} C(t, i)`.

### S9. When is matrix-exponentiation-style thinking irrelevant here?
The recurrence is not a fixed linear map over a small state vector (the state grows with floors), so there is no `log`-time matrix trick on `n`. The `log n` speed comes from the *dual* shrinking the iteration count, not from exponentiating a transition. Mentioning that distinction shows depth.

### S10 (analysis). Why does the closed form truncate the binomial sum at `k` terms?
`Σ_{i=0}^{t} C(t, i) = 2^t` counts all decision-tree leaves; truncating at `k` (`Σ_{i=1}^{k} C(t, i)`) counts only paths using at most `k` break-edges — exactly the egg budget. When `k ≥ t`, the sum reaches `2^t - 1` and you recover binary search. The egg constraint *is* the truncation.

---

## Professional Questions (8 Q&A)

### P1. Design a service answering "min destructive tests to find a breaking point" over a huge candidate range.
Cap eggs (samples) at `⌈log₂(n+1)⌉`. For `k = 2`, return the closed form. For general `k`, run the trials dual once and cache `g(·, ·)` for the largest `(k, n)` seen, slicing for repeated queries. Log the back-of-envelope magnitude (`√(2n)`, etc.) alongside each result for anomaly detection.

### P2. The product team says "we have a million samples and a billion candidate values." What do you compute?
Cap the million samples to `⌈log₂(10^9 + 1)⌉ ≈ 30`; beyond that, samples are wasted. Then it is the binary-search regime: the answer is `⌈log₂(n+1)⌉ ≈ 30`. Returning `30` from a capped dual in microseconds beats naively looping a million eggs.

### P3. How do you handle the request for the exact dropping plan, not just the count?
Reconstruct from the dual without materializing the `O(k·n)` table: at each level the first drop is `g(k-1, t*-1) + 1` above the current range floor; recurse with `(k-1, t*-1)` on break and `(k, t*-1)` on survive. Emit the tree in `O(t*)` per path, then validate by simulating every `T`.

### P4. How do you debug "the answer is 13 when it should be 14"?
Off-by-one in the split is the prime suspect: confirm "below a drop at `x`" is `x-1` floors and "above" is `f-x`. Run the brute-force recursion on `(2, 100)` and diff. Check the `k=2` sqrt did not round down (it would give 13). Assert `g(2, 13) = 91 < 100 ≤ 105 = g(2, 14)`.

### P5. When is this DP the wrong model entirely?
When tests are non-destructive (just binary-search), reusable infinitely (no egg constraint), or **noisy** (the threshold is probabilistic). The DP assumes a perfectly sharp deterministic critical floor; for noisy thresholds you need a statistical/sequential-testing approach, not minimax DP.

### P6. How would you parallelize a batch of `(k, n)` queries?
The queries are independent, so distribute them across workers. Within a worker, cache the dual table `g(·, ·)` up to the maximum `(k, n)` and answer each query by a single comparison-scan into it. The `k=2` closed-form queries need no table at all.

### P7. Explain the diminishing returns of eggs precisely.
The `e`-th egg adds exactly `C(t, e)` floors of reach at trial budget `t` (since `g(e, t) - g(e-1, t) = C(t, e)`). This is large for `e ≪ t/2`, then declines, and is `0` once `e > t`. So the first few eggs each take a root of `n` off the trial count; beyond `log₂ n` eggs the marginal benefit is zero.

### P8 (analysis). Why is averaging the branches a correctness bug, not just a pessimism choice?
Averaging assumes a probability distribution over the critical floor, but the problem demands a *guarantee* for every floor. The adversary can place `T` in the more expensive branch every time, so an averaged strategy can exceed its claimed bound on real inputs. Only the `max` yields a valid worst-case guarantee.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a brute-force search with an exact optimization.
Look for a concrete story: a "minimum tests / probes / rounds" task, the realization that the worst case was a minimax DP (or its faster dual), the measured speedup, and the correctness check against a brute-force oracle. Strong answers mention the off-by-one and base-case care taken.

### B2. A teammate's egg-drop code averages the two branches and ships a wrong guarantee. How do you respond?
Explain calmly that the problem needs a worst-case guarantee, so the adversary picks the worse branch — it must be `max`, not average. Show a tiny counterexample where averaging under-counts. Frame it as the minimax distinction, a teaching moment, not blame.

### B3. Design a feature to find the load at which a service starts failing, with a limited number of destructive load tests.
Map it to egg-drop: load values are floors, destructive tests are eggs. Use the trials dual to compute the minimum guaranteed tests, reconstruct the test schedule (which loads to try, in order), and discuss that real failures are noisy — so you would either repeat tests or switch to a statistical method.

### B4. How would you explain the trials reformulation to a junior engineer?
Start with the slow question ("fewest drops for `n` floors") and flip it to the easy one ("most floors I can cover with `t` drops"). Show `g(e, t) = below + above + the drop = g(e-1, t-1) + g(e, t-1) + 1`, then "grow `t` until coverage reaches `n`." Emphasize that flipping the question removed the expensive inner search.

### B5. Your egg-drop service is slow on large inputs. How do you investigate?
Check whether someone built the `O(k·n²)` table for a large `n` — that is the usual culprit. Confirm eggs are capped at `⌈log₂(n+1)⌉`, the dual uses a rolling `O(k)` array, and `g` is capped at `n` to avoid big-integer slowdowns. Profile; the fix is almost always "switch to the dual and cap eggs."

---

## Coding Challenges

### Challenge 1: Minimum Trials (Classic Minimax DP)

**Problem.** Given `k` eggs and `n` floors, return the minimum number of trials that guarantees finding the critical floor.

**Example.**
```text
k = 2, n = 100  ->  14
k = 1, n = 100  ->  100
k = 3, n = 100  ->  9
```

**Constraints.** `1 ≤ k ≤ 100`, `0 ≤ n ≤ 5000` (so the `O(k·n²)` table is feasible).

**Optimal here.** Classic table, `O(k·n²)`.

**Go.**
```go
package main

import "fmt"

func eggDrop(k, n int) int {
	dp := make([][]int, k+1)
	for e := range dp {
		dp[e] = make([]int, n+1)
	}
	for f := 0; f <= n; f++ {
		dp[1][f] = f
	}
	for e := 1; e <= k; e++ {
		dp[e][0] = 0
		if n >= 1 {
			dp[e][1] = 1
		}
	}
	for e := 2; e <= k; e++ {
		for f := 2; f <= n; f++ {
			best := f
			for x := 1; x <= f; x++ {
				worst := dp[e-1][x-1]
				if dp[e][f-x] > worst {
					worst = dp[e][f-x]
				}
				if 1+worst < best {
					best = 1 + worst
				}
			}
			dp[e][f] = best
		}
	}
	return dp[k][n]
}

func main() {
	fmt.Println(eggDrop(2, 100)) // 14
	fmt.Println(eggDrop(1, 100)) // 100
	fmt.Println(eggDrop(3, 100)) // 9
}
```

**Java.**
```java
public class EggDrop {
    static int eggDrop(int k, int n) {
        int[][] dp = new int[k + 1][n + 1];
        for (int f = 0; f <= n; f++) dp[1][f] = f;
        for (int e = 1; e <= k; e++) { dp[e][0] = 0; if (n >= 1) dp[e][1] = 1; }
        for (int e = 2; e <= k; e++)
            for (int f = 2; f <= n; f++) {
                int best = f;
                for (int x = 1; x <= f; x++) {
                    int worst = Math.max(dp[e - 1][x - 1], dp[e][f - x]);
                    best = Math.min(best, 1 + worst);
                }
                dp[e][f] = best;
            }
        return dp[k][n];
    }

    public static void main(String[] args) {
        System.out.println(eggDrop(2, 100)); // 14
        System.out.println(eggDrop(1, 100)); // 100
        System.out.println(eggDrop(3, 100)); // 9
    }
}
```

**Python.**
```python
def egg_drop(k: int, n: int) -> int:
    dp = [[0] * (n + 1) for _ in range(k + 1)]
    for f in range(n + 1):
        dp[1][f] = f
    for e in range(1, k + 1):
        dp[e][0] = 0
        if n >= 1:
            dp[e][1] = 1
    for e in range(2, k + 1):
        for f in range(2, n + 1):
            best = f
            for x in range(1, f + 1):
                worst = max(dp[e - 1][x - 1], dp[e][f - x])
                best = min(best, 1 + worst)
            dp[e][f] = best
    return dp[k][n]


if __name__ == "__main__":
    print(egg_drop(2, 100))  # 14
    print(egg_drop(1, 100))  # 100
    print(egg_drop(3, 100))  # 9
```

---

### Challenge 2: Minimum Trials via the Trials Reformulation (Large n)

**Problem.** Same as Challenge 1 but `n` can be up to `10^18`, so the quadratic table is infeasible. Use the floors-from-trials dual.

**Example.**
```text
k = 2, n = 100         ->  14
k = 10, n = 1000000000 ->  30
```

**Constraints.** `1 ≤ k ≤ 64`, `0 ≤ n ≤ 10^18`.

**Optimal.** Trials dual, `O(k·log n)`; cap `g` at `n` to avoid overflow.

**Go.**
```go
package main

import "fmt"

func eggDropFast(k, n int) int {
	if n == 0 {
		return 0
	}
	g := make([]int, k+1)
	t := 0
	for g[k] < n {
		t++
		for e := k; e >= 1; e-- {
			v := g[e-1] + g[e] + 1
			if v > n {
				v = n // cap; we only compare against n
			}
			g[e] = v
		}
	}
	return t
}

func main() {
	fmt.Println(eggDropFast(2, 100))            // 14
	fmt.Println(eggDropFast(10, 1_000_000_000)) // 30
}
```

**Java.**
```java
public class EggDropFast {
    static int eggDropFast(int k, long n) {
        if (n == 0) return 0;
        long[] g = new long[k + 1];
        int t = 0;
        while (g[k] < n) {
            t++;
            for (int e = k; e >= 1; e--) {
                long v = g[e - 1] + g[e] + 1;
                g[e] = Math.min(v, n); // cap
            }
        }
        return t;
    }

    public static void main(String[] args) {
        System.out.println(eggDropFast(2, 100));            // 14
        System.out.println(eggDropFast(10, 1_000_000_000)); // 30
    }
}
```

**Python.**
```python
def egg_drop_fast(k: int, n: int) -> int:
    if n == 0:
        return 0
    g = [0] * (k + 1)
    t = 0
    while g[k] < n:
        t += 1
        for e in range(k, 0, -1):
            g[e] = min(g[e - 1] + g[e] + 1, n)  # cap; only compared against n
    return t


if __name__ == "__main__":
    print(egg_drop_fast(2, 100))             # 14
    print(egg_drop_fast(10, 1_000_000_000))  # 30
```

---

### Challenge 3: Two Eggs Closed Form

**Problem.** With exactly `2` eggs and `n` floors, return the minimum guaranteed trials using the closed form `smallest t with t(t+1)/2 ≥ n`. Must be `O(1)` (plus a sqrt).

**Example.**
```text
n = 100  ->  14
n = 10   ->  4
n = 1    ->  1
```

**Constraints.** `0 ≤ n ≤ 10^18`. Watch for floating-sqrt rounding.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func eggDropTwo(n int64) int64 {
	if n == 0 {
		return 0
	}
	t := int64((math.Sqrt(float64(1+8*n)) - 1) / 2)
	for t*(t+1)/2 < n { // correct any sqrt under-estimate
		t++
	}
	for t > 0 && (t-1)*t/2 >= n { // and any over-estimate
		t--
	}
	return t
}

func main() {
	fmt.Println(eggDropTwo(100)) // 14
	fmt.Println(eggDropTwo(10))  // 4
	fmt.Println(eggDropTwo(1))   // 1
}
```

**Java.**
```java
public class EggDropTwo {
    static long eggDropTwo(long n) {
        if (n == 0) return 0;
        long t = (long) ((Math.sqrt(1 + 8.0 * n) - 1) / 2);
        while (t * (t + 1) / 2 < n) t++;          // fix under-estimate
        while (t > 0 && (t - 1) * t / 2 >= n) t--; // fix over-estimate
        return t;
    }

    public static void main(String[] args) {
        System.out.println(eggDropTwo(100)); // 14
        System.out.println(eggDropTwo(10));  // 4
        System.out.println(eggDropTwo(1));   // 1
    }
}
```

**Python.**
```python
import math


def egg_drop_two(n: int) -> int:
    if n == 0:
        return 0
    t = (math.isqrt(1 + 8 * n) - 1) // 2
    while t * (t + 1) // 2 < n:        # fix under-estimate
        t += 1
    while t > 0 and (t - 1) * t // 2 >= n:  # fix over-estimate
        t -= 1
    return t


if __name__ == "__main__":
    print(egg_drop_two(100))  # 14
    print(egg_drop_two(10))   # 4
    print(egg_drop_two(1))    # 1
```

---

### Challenge 4: Reconstruct the Dropping Strategy

**Problem.** Given `k` eggs and `n` floors, return the list of first-drop floors along the "all survive" spine of the optimal strategy (the floors you would drop from if every egg keeps surviving). For `2` eggs and `100` floors this is `[14, 27, 39, 50, 60, 69, 77, 84, 90, 95, 99, 100]`.

**Approach.** Compute `t* = minTrials(k, n)`. The first drop is `coverable(k-1, t*-1) + 1` above the current range floor; on survive, climb to that floor and repeat with one fewer trial.

**Python.**
```python
def coverable(e: int, t: int, cap: int) -> int:
    if e <= 0 or t <= 0:
        return 0
    g = [0] * (e + 1)
    for _ in range(t):
        for ee in range(e, 0, -1):
            g[ee] = min(g[ee - 1] + g[ee] + 1, cap)
    return g[e]


def min_trials(k: int, n: int) -> int:
    if n == 0:
        return 0
    g = [0] * (k + 1)
    t = 0
    while g[k] < n:
        t += 1
        for e in range(k, 0, -1):
            g[e] = min(g[e - 1] + g[e] + 1, n)
    return t


def strategy_spine(k: int, n: int) -> list:
    t = min_trials(k, n)
    floors, base, trials, eggs = [], 0, t, k
    while trials > 0 and base < n:
        below = coverable(eggs - 1, trials - 1, n)
        drop = min(base + below + 1, n)
        floors.append(drop)
        base = drop  # survive -> climb
        trials -= 1
    return floors


if __name__ == "__main__":
    print(strategy_spine(2, 100))
    # [14, 27, 39, 50, 60, 69, 77, 84, 90, 95, 99, 100]
```

**Go.**
```go
package main

import "fmt"

func coverable(e, t, cap int) int {
	if e <= 0 || t <= 0 {
		return 0
	}
	g := make([]int, e+1)
	for s := 0; s < t; s++ {
		for ee := e; ee >= 1; ee-- {
			v := g[ee-1] + g[ee] + 1
			if v > cap {
				v = cap
			}
			g[ee] = v
		}
	}
	return g[e]
}

func minTrials(k, n int) int {
	if n == 0 {
		return 0
	}
	g := make([]int, k+1)
	t := 0
	for g[k] < n {
		t++
		for e := k; e >= 1; e-- {
			v := g[e-1] + g[e] + 1
			if v > n {
				v = n
			}
			g[e] = v
		}
	}
	return t
}

func strategySpine(k, n int) []int {
	t := minTrials(k, n)
	floors := []int{}
	base, trials, eggs := 0, t, k
	for trials > 0 && base < n {
		below := coverable(eggs-1, trials-1, n)
		drop := base + below + 1
		if drop > n {
			drop = n
		}
		floors = append(floors, drop)
		base = drop
		trials--
	}
	return floors
}

func main() {
	fmt.Println(strategySpine(2, 100))
	// [14 27 39 50 60 69 77 84 90 95 99 100]
}
```

**Java.**
```java
import java.util.*;

public class StrategySpine {
    static int coverable(int e, int t, int cap) {
        if (e <= 0 || t <= 0) return 0;
        long[] g = new long[e + 1];
        for (int s = 0; s < t; s++)
            for (int ee = e; ee >= 1; ee--)
                g[ee] = Math.min(g[ee - 1] + g[ee] + 1, cap);
        return (int) g[e];
    }

    static int minTrials(int k, int n) {
        if (n == 0) return 0;
        long[] g = new long[k + 1];
        int t = 0;
        while (g[k] < n) {
            t++;
            for (int e = k; e >= 1; e--) g[e] = Math.min(g[e - 1] + g[e] + 1, n);
        }
        return t;
    }

    static List<Integer> strategySpine(int k, int n) {
        int t = minTrials(k, n);
        List<Integer> floors = new ArrayList<>();
        int base = 0, trials = t, eggs = k;
        while (trials > 0 && base < n) {
            int below = coverable(eggs - 1, trials - 1, n);
            int drop = Math.min(base + below + 1, n);
            floors.add(drop);
            base = drop;
            trials--;
        }
        return floors;
    }

    public static void main(String[] args) {
        System.out.println(strategySpine(2, 100));
        // [14, 27, 39, 50, 60, 69, 77, 84, 90, 95, 99, 100]
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"`dp[e][f] = 1 + min_x max(dp[e-1][x-1], dp[e][f-x])` — minimize over the drop floor, maximize over break/survive."*
- Immediately flag the two gotchas: **it is `max`, never sum or average**, and **one egg means a linear scan (`dp[1][f] = f`)**.
- If `n` is large, pivot to the **trials reformulation** `g(e,t) = g(e-1,t-1) + g(e,t-1) + 1` and "grow `t` until `g(k,t) ≥ n`" — `O(k·log n)`.
- Know the **binomial closed form** `Σ C(t, i)` and the **`k = 2` √(2n) jump** (14 drops for 100 floors) cold.
- Mention **capping eggs at `⌈log₂(n+1)⌉`** and offer to **reconstruct and simulate** the strategy to validate.
