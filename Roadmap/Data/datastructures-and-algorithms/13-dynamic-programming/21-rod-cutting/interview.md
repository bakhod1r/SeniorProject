# Rod Cutting (Unbounded DP) — Interview Preparation

Rod cutting is a beloved interview opener because it rewards one crisp insight — *"`dp[len] = max over first cut c of (price[c] + dp[len - c])`"* — and then probes whether you can (a) justify the recurrence via optimal substructure, (b) implement it cleanly bottom-up *and* top-down, (c) **reconstruct** the actual cuts (not just the value), (d) adapt it to the **cost-per-cut** and **bounded** twists, and (e) recognize it as **unbounded knapsack** (`02`) and a cousin of **coin change** (`19`). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Max revenue for length `n` | `dp[len]=max_c(price[c]+dp[len-c])` | `O(n^2)` (or `O(n·m)`) |
| Reconstruct the cut list | `choice[]` + backward walk | `O(n)` |
| Cost-per-cut (fee per saw cut) | subtract fee when `c < len` | `O(n^2)` |
| Bounded (cap per length) | bounded knapsack | `O(n·Σ limit)` → `O(n·Σ log limit)` |
| Same as which classic problem? | **unbounded knapsack** | — |
| Cousin problem (different objective) | **coin change** (`min`/count) | — |
| **Count *simple/unique-use* selections** | that's **0/1**, a different recurrence | — |

Semiring view (the operator changes; the first-cut decomposition does not):

```text
problem               operator   recurrence
rod cutting (max)     max, +     dp[len]   = max_c (price[c] + dp[len-c])
coin change (min)     min, +     f[amt]    = min_c (1 + f[amt-coin_c])
coin change (count)   +,  ×      g[amt]   += g[amt-coin]    (coins OUTERMOST)
compositions (count)  +,  ×      a[n]      = Σ_c a[n-c]
```

Core algorithm:

```text
rodCut(price, n):
    dp[0] = 0
    for len = 1..n:
        best = -inf
        for c = 1..len:
            if price[c] + dp[len-c] > best:
                best = price[c] + dp[len-c]; choice[len] = c
        dp[len] = best
    # reconstruct: len=n; while len>0: emit choice[len]; len -= choice[len]
    return dp[n]
```

Key facts:
- **Length = sum of pieces**; the optimum fills the rod exactly (when a non-negative unit length is sellable).
- `dp[0] = 0` is the base case; forgetting it breaks everything.
- The inner loop must reach `c = len` (the sell-whole option).
- **Unbounded**: each length is reusable, so the recurrence references the *same* `dp` array.
- Revenue overflows 32-bit for large `n`/prices — use 64-bit.

---

## Junior Questions (12 Q&A)

### J1. What does `dp[len]` represent?
The maximum revenue obtainable from a rod of length `len`, given the price-per-length table. The final answer is `dp[n]`.

### J2. State the recurrence and the base case.
`dp[len] = max over c in 1..len of (price[c] + dp[len - c])`, with `dp[0] = 0`. Each `c` is the length of the first piece cut off; the remainder `len - c` is solved optimally.

### J3. Why is it enough to try only the *first* cut?
Every cutting plan has some leftmost piece of some length `c`; the recurrence tries all of them. The remainder is a smaller rod handled by `dp[len - c]`. So enumerating first cuts enumerates all plans, with no double counting.

### J4. What is the time and space complexity?
`O(n^2)` time (outer loop over `len`, inner over the first cut `c`), `O(n)` space (a 1-D `dp` array). If only `m` distinct lengths are sellable, the inner loop shrinks to `O(n·m)`.

### J5. Is this an unbounded or a 0/1 problem?
Unbounded: each piece length can be used any number of times (you can cut as many length-2 pieces as you like). That is why `dp[len - c]` may reuse the same length again.

### J6. How do you find the best revenue for a length-4 rod with prices `[_,1,5,8,9]`?
`dp[1]=1, dp[2]=5, dp[3]=8, dp[4]=max(1+8, 5+5, 8+1, 9+0)=10`. Best is 10, achieved by two length-2 pieces (`5+5`), beating selling whole (9).

### J7. What is `dp[0]` and why does it matter?
`dp[0] = 0` — an empty rod earns nothing. It is the base case that anchors the recurrence; without it, every `dp[len]` is undefined.

### J8. How do you recover *which* pieces to cut, not just the revenue?
Record `choice[len]` = the first cut that achieved `dp[len]`, then walk backward: `len -= choice[len]`, emitting each `choice[len]` as a piece, until `len = 0`.

### J9. What's a common off-by-one bug here?
Stopping the inner loop at `len - 1`, which forbids the "sell whole" option (`c = len`). The loop must include `c = len`.

### J10. Why can the answer overflow `int`?
Revenue is the sum of up to `n` piece prices; for large `n` and prices it can exceed `2^31`. Use 64-bit (`int64`/`long`).

### J11. Does the price table have to be increasing?
No. Prices need not grow with length; the DP handles any table. The non-linearity is what makes cutting decisions nontrivial.

### J12 (analysis). Why is the DP `O(n^2)` while brute force is exponential?
Brute force tries all `2^{n-1}` compositions. The DP reuses each subproblem `dp[len]` — there are only `n+1` of them — so overlapping subproblems collapse the exponential search to quadratic.

---

## Middle Questions (12 Q&A)

### M1. Prove the recurrence is correct.
Induction on `len`. Base `dp[0]=0`. For the step: (≥) prepending a piece `c` to the optimal plan of `len-c` gives revenue `price[c]+dp[len-c]`, so `dp[len] ≥ max_c(...)`; (≤) an optimal plan of `len` has a first piece `c`, whose tail is optimal for `len-c` (optimal substructure), so `dp[len] = price[c]+dp[len-c] ≤ max_c(...)`. Equality follows.

### M2. Prove optimal substructure.
Exchange argument: if the tail of an optimal plan for `len` were not optimal for the remainder `len - c_1`, swapping in a better tail would raise the total revenue — contradicting the plan's optimality. Hence the tail is optimal.

### M3. Top-down vs bottom-up — when does each win?
Both are `O(n^2)`. Bottom-up (tabulation) is the default for rod cutting because every subproblem is reached anyway, with no recursion overhead or stack risk. Top-down (memoized) shines when subproblems are sparse or the recursive form is clearer — less relevant here, but worth knowing.

### M4. How do you handle a cost per saw cut?
`dp[len] = max_c (price[c] + dp[len-c] - fee·[c < len])`. Charge the fee only when a remainder is severed (`c < len`); selling whole (`c = len`) makes zero cuts. An `m`-piece plan thus pays `m - 1` fees.

### M5. Why is charging the fee on every branch wrong?
Charging the fee when `c = len` penalizes selling the rod whole as if it required a cut, counting `m` fees for an `m`-piece plan instead of `m - 1`. It flips decisions when whole is optimal.

### M6. What changes for the bounded variant (cap per length)?
The unbounded reuse is no longer allowed. Process lengths one at a time (bounded knapsack), allowing `0..limit[ℓ]` copies of each, reading from the table *before* that length was considered to enforce the cap. Complexity `O(n·Σ limit)`, or `O(n·Σ log limit)` with binary splitting.

### M7. How is rod cutting the same as unbounded knapsack?
Map item `i` → piece of length `i`, `weight[i] = i`, `value[i] = price[i]`, capacity `W = n`. The unbounded-knapsack recurrence `dp[w]=max_i(value[i]+dp[w-weight[i]])` becomes exactly the rod recurrence. Rod cutting is the special case with one item per integer length and exact capacity filling.

### M8. How does coin change relate?
Same unbounded "reference `dp[amount - coin]`" shape, different objective: min coins (`min`, `+1`), or count combinations (`Σ`, with coins outermost). Rod cutting maximizes a value sum.

### M9. What two invariants verify your reconstruction?
The emitted pieces must (1) sum to `n` and (2) have prices summing to `dp[n]`. If either fails, the `choice[]` recording is buggy.

### M10. How do ties affect the cut list?
Several first cuts may tie for `dp[len]`. Using `>` keeps the first winner, `>=` the last; both are valid optima. Fix one convention for deterministic output.

### M11. Why doesn't loop order matter for rod cutting but matters for coin-change counting?
`max`/`min` are insensitive to the order candidates are considered. Counting *combinations*, by contrast, must avoid counting permutations, which requires iterating coins outermost. Rod cutting's `max` objective is immune to this subtlety.

### M12 (analysis). Is rod cutting polynomial?
It is *pseudo-polynomial*: `O(n·m)` is polynomial in the rod *value* `n` but exponential in its bit-length `log n`. Same classification as knapsack. The input size is `Θ(m)` prices, not `n`.

---

## Senior Questions (10 Q&A)

### S1. For very large `n`, how do you avoid `O(n^2)`?
Iterate the inner loop only over the `m` *offered* lengths (those with a quoted price), giving `O(n·m)`. In practice `m ≪ n`, so this is the dominant real-world speedup. Special-case linear/concave price tables that have closed-form optima.

### S2. How does rod cutting connect to the industrial cutting-stock problem?
The textbook problem (maximize revenue, one rod) is polynomial. The real cutting-stock problem (minimize stock rods/waste to meet a demand for many lengths) is **NP-hard** (it contains bin-packing). Rod cutting is the polynomial **pricing subproblem** inside Gilmore-Gomory column generation, where the per-length "prices" are LP dual values.

### S3. How do you model a saw kerf that also destroys material?
Beyond a money fee per cut, each cut consumes `κ` units of length. The remainder index becomes `len - c - κ` (not `len - c`), so `dp[len] = max(price[len], max_{c} price[c] + dp[len-c-κ] - fee)`. Modeling only the fee but not the material loss overestimates yield.

### S4. How would you serve many rods sharing one price sheet?
Fill `dp[]` once up to the maximum length (`O(n·m)`), then each rod length is an `O(1)` value lookup and `O(len)` reconstruction. Do not recompute the DP per rod.

### S5. How do you keep the bounded variant efficient when caps are large?
Binary-split each cap `b_ℓ` into pseudo-items of sizes `1, 2, 4, …` summing to `b_ℓ`, then run 0/1 knapsack over them: `O(n·Σ log b_ℓ)` instead of `O(n·Σ b_ℓ)`.

### S6. How do you verify correctness when you can't eyeball `dp[n]`?
Brute-force recursion oracle for small `n`; reconstruction invariants (pieces sum to `n`, prices sum to `dp[n]`); monotonicity sanity (`dp[len] ≥ dp[len-1]` when a non-negative unit price exists); and regression anchors (`cutCost=0` reduces to plain, `limit=∞` reduces to unbounded).

### S7. What are the integer/overflow concerns?
Revenue can reach `n·max_price`, overflowing 32-bit. Use 64-bit `dp[]`. The cost-per-cut variant produces transiently negative candidates, so use a signed type and a truly minimal `best` initializer. Keep floats off the exact path.

### S8. When is greedy correct for rod cutting?
Almost never for arbitrary tables — picking the highest price-density length repeatedly can be suboptimal because of the remainder. Greedy is exact only for special structures (e.g., linear prices). Always verify a greedy heuristic against the DP offline.

### S9. How would you reconstruct without an extra `choice[]` array?
After computing `dp[]`, re-derive each cut by scanning offered lengths for the one with `dp[len] == price[ℓ] + dp[len-ℓ]`. This trades `O(n)` reconstruction-array space for `O(len·m)` recomputation on the reconstruction path.

### S10 (analysis). Why does the optimum fill the rod exactly?
If a non-negative unit length (length 1) is sellable, any leftover capacity can be converted to revenue by adding length-1 pieces, so no optimal plan leaves a stub. If length 1 is not offered or has negative price, the general unbounded-knapsack `≤` formulation (allowing `dp[w]=dp[w-1]`) is needed.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an exponential search with a DP.
Look for a concrete story: an enumeration that blew up, the insight that the problem had optimal substructure and overlapping subproblems, the recurrence you wrote, and the measured speedup. Strong answers mention validating the DP against the old brute force on small inputs.

### B2. A teammate used the plain rod-cutting recurrence for a problem where each length can be used only once. How do you respond?
Explain calmly that "use once" is 0/1 knapsack, not unbounded — the loop structure differs (descending capacity / per-item dimension). Show a tiny counterexample where unbounded reuse overcounts. Frame it as a quick teaching moment about reuse semantics.

### B3. Design a feature that maximizes revenue from cutting raw stock given a live price sheet.
Discuss filling `dp[]` over offered lengths (`O(n·m)`), reconstructing the cut list, modeling per-cut fees and kerf, and handling the multi-rod / demand case (which tips into NP-hard cutting-stock — set expectations and reach for column generation). Mention 64-bit revenue and caching the fill across rods.

### B4. How would you explain rod cutting to a junior engineer?
Use the saw analogy: stand at the saw, decide the length of the *first* board to cut off, then repeat on the leftover; a card pinned to each leftover length tells you the best you can get. Lead with the two gotchas: include the sell-whole option, and remember `dp[0]=0`.

### B5. Your cutting-optimization job is too slow at scale. How do you investigate?
Check whether the inner loop iterates all `1..len` instead of the `m` offered lengths (the usual culprit — `O(n^2)` vs `O(n·m)`). Confirm the DP is filled once and reused across rods, not recomputed. Profile; the fix is usually restricting the inner loop and caching the fill.

---

## Coding Challenges

### Challenge 1: Maximum Revenue

**Problem.** Given a price table `price[1..n]` (with `price[0]=0`) and rod length `n`, return the maximum revenue from cutting the rod.

**Example.**
```text
price = [_,1,5,8,9,10,17,17,20], n = 8  ->  22   (e.g., 2 + 6 = 5 + 17)
price = [_,1,5,8,9], n = 4              ->  10   (2 + 2 = 5 + 5)
```

**Constraints.** `1 ≤ n ≤ 10^4`, prices fit in 32-bit but revenue may need 64-bit.

**Optimal.** Bottom-up DP, `O(n^2)`.

**Go.**
```go
package main

import "fmt"

func maxRevenue(price []int64, n int) int64 {
	dp := make([]int64, n+1)
	for length := 1; length <= n; length++ {
		best := int64(-1) << 62
		for c := 1; c <= length; c++ {
			if v := price[c] + dp[length-c]; v > best {
				best = v
			}
		}
		dp[length] = best
	}
	return dp[n]
}

func main() {
	price := []int64{0, 1, 5, 8, 9, 10, 17, 17, 20}
	fmt.Println(maxRevenue(price, 8)) // 22
	fmt.Println(maxRevenue([]int64{0, 1, 5, 8, 9}, 4)) // 10
}
```

**Java.**
```java
public class MaxRevenue {
    static long maxRevenue(long[] price, int n) {
        long[] dp = new long[n + 1];
        for (int length = 1; length <= n; length++) {
            long best = Long.MIN_VALUE;
            for (int c = 1; c <= length; c++) {
                long v = price[c] + dp[length - c];
                if (v > best) best = v;
            }
            dp[length] = best;
        }
        return dp[n];
    }

    public static void main(String[] args) {
        long[] price = {0, 1, 5, 8, 9, 10, 17, 17, 20};
        System.out.println(maxRevenue(price, 8)); // 22
        System.out.println(maxRevenue(new long[]{0, 1, 5, 8, 9}, 4)); // 10
    }
}
```

**Python.**
```python
def max_revenue(price, n):
    dp = [0] * (n + 1)
    for length in range(1, n + 1):
        dp[length] = max(price[c] + dp[length - c] for c in range(1, length + 1))
    return dp[n]


if __name__ == "__main__":
    print(max_revenue([0, 1, 5, 8, 9, 10, 17, 17, 20], 8))  # 22
    print(max_revenue([0, 1, 5, 8, 9], 4))                  # 10
```

---

### Challenge 2: Print the Cuts (Reconstruction)

**Problem.** Same input as Challenge 1, but also return the list of cut lengths achieving the maximum.

**Example.**
```text
price = [_,1,5,8,9], n = 4  ->  revenue 10, cuts [2, 2]
```

**Optimal.** DP with a `choice[]` array, then a backward walk, `O(n^2)` + `O(n)`.

**Go.**
```go
package main

import "fmt"

func rodCutWithPieces(price []int64, n int) (int64, []int) {
	dp := make([]int64, n+1)
	choice := make([]int, n+1)
	for length := 1; length <= n; length++ {
		best := int64(-1) << 62
		for c := 1; c <= length; c++ {
			if v := price[c] + dp[length-c]; v > best {
				best = v
				choice[length] = c
			}
		}
		dp[length] = best
	}
	pieces := []int{}
	for length := n; length > 0; length -= choice[length] {
		pieces = append(pieces, choice[length])
	}
	return dp[n], pieces
}

func main() {
	rev, cuts := rodCutWithPieces([]int64{0, 1, 5, 8, 9}, 4)
	fmt.Println(rev, cuts) // 10 [2 2]
}
```

**Java.**
```java
import java.util.*;

public class RodCutPieces {
    static long solve(long[] price, int n, List<Integer> out) {
        long[] dp = new long[n + 1];
        int[] choice = new int[n + 1];
        for (int length = 1; length <= n; length++) {
            long best = Long.MIN_VALUE;
            for (int c = 1; c <= length; c++) {
                long v = price[c] + dp[length - c];
                if (v > best) { best = v; choice[length] = c; }
            }
            dp[length] = best;
        }
        for (int len = n; len > 0; len -= choice[len]) out.add(choice[len]);
        return dp[n];
    }

    public static void main(String[] args) {
        List<Integer> cuts = new ArrayList<>();
        long rev = solve(new long[]{0, 1, 5, 8, 9}, 4, cuts);
        System.out.println(rev + " " + cuts); // 10 [2, 2]
    }
}
```

**Python.**
```python
def rod_cut_with_pieces(price, n):
    dp = [0] * (n + 1)
    choice = [0] * (n + 1)
    for length in range(1, n + 1):
        best = float("-inf")
        for c in range(1, length + 1):
            v = price[c] + dp[length - c]
            if v > best:
                best, choice[length] = v, c
        dp[length] = best
    pieces, length = [], n
    while length > 0:
        pieces.append(choice[length])
        length -= choice[length]
    return dp[n], pieces


if __name__ == "__main__":
    print(rod_cut_with_pieces([0, 1, 5, 8, 9], 4))  # (10, [2, 2])
```

---

### Challenge 3: Cost-Per-Cut Variant

**Problem.** Each saw cut costs a fixed fee `cutCost`. Selling the rod whole makes zero cuts; an `m`-piece plan makes `m - 1` cuts. Maximize revenue minus total cut cost.

**Example.**
```text
price = [_,1,5,8,9], n = 4, cutCost = 1
  splitting into 2+2 earns 10 but pays 1 cut -> profit 9;
  selling whole earns 9, pays 0 -> profit 9; answer 9.
```

**Optimal.** DP charging the fee only when `c < len`, `O(n^2)`.

**Go.**
```go
package main

import "fmt"

func rodCutCost(price []int64, n int, cutCost int64) int64 {
	dp := make([]int64, n+1)
	for length := 1; length <= n; length++ {
		best := int64(-1) << 62
		for c := 1; c <= length; c++ {
			fee := int64(0)
			if c < length {
				fee = cutCost
			}
			if v := price[c] + dp[length-c] - fee; v > best {
				best = v
			}
		}
		dp[length] = best
	}
	return dp[n]
}

func main() {
	fmt.Println(rodCutCost([]int64{0, 1, 5, 8, 9}, 4, 1)) // 9
}
```

**Java.**
```java
public class RodCutCost {
    static long rodCutCost(long[] price, int n, long cutCost) {
        long[] dp = new long[n + 1];
        for (int length = 1; length <= n; length++) {
            long best = Long.MIN_VALUE;
            for (int c = 1; c <= length; c++) {
                long fee = (c < length) ? cutCost : 0;
                long v = price[c] + dp[length - c] - fee;
                if (v > best) best = v;
            }
            dp[length] = best;
        }
        return dp[n];
    }

    public static void main(String[] args) {
        System.out.println(rodCutCost(new long[]{0, 1, 5, 8, 9}, 4, 1)); // 9
    }
}
```

**Python.**
```python
def rod_cut_cost(price, n, cut_cost):
    dp = [0] * (n + 1)
    for length in range(1, n + 1):
        best = float("-inf")
        for c in range(1, length + 1):
            fee = 0 if c == length else cut_cost
            v = price[c] + dp[length - c] - fee
            best = max(best, v)
        dp[length] = best
    return dp[n]


if __name__ == "__main__":
    print(rod_cut_cost([0, 1, 5, 8, 9], 4, 1))  # 9
```

---

### Challenge 4: Bounded Pieces (Limited Supply per Length)

**Problem.** Each length `ℓ` may be cut at most `limit[ℓ]` times. Maximize revenue. (`limit[ℓ] = ∞` recovers plain rod cutting.)

**Example.**
```text
price = [_,1,5,8,9], n = 4, limit = [_, 0, 1, 0, 0]
  only length-2 pieces allowed, at most one -> best is one length-2 piece (5)
  plus the remaining length 2 cannot be sold (limit 1) -> revenue 5.
```

**Optimal.** Bounded knapsack over lengths, `O(n·Σ limit)`.

**Go.**
```go
package main

import "fmt"

// limit[l] = max copies of length l; price[l] its price. Returns best revenue.
func rodCutBounded(price []int64, limit []int, n int) int64 {
	neg := int64(-1) << 62
	dp := make([]int64, n+1)
	for i := 1; i <= n; i++ {
		dp[i] = neg // dp[i] = best revenue using exactly capacity i
	}
	// dp here means "best revenue filling exactly i"; dp[0]=0
	for ell := 1; ell <= n; ell++ {
		if limit[ell] == 0 {
			continue
		}
		for q := 1; q <= limit[ell]; q++ { // one bounded copy at a time
			used := q * ell
			if used > n {
				break
			}
			// process descending to use each (ell,q) group like a 0/1 item set is subtle;
			// simplest correct: iterate copies and update from a snapshot.
		}
	}
	// Simpler, clearly correct formulation below:
	return rodCutBoundedSimple(price, limit, n)
}

func rodCutBoundedSimple(price []int64, limit []int, n int) int64 {
	neg := int64(-1) << 62
	dp := make([]int64, n+1) // dp[w] = best revenue for capacity exactly... use <= via 0 baseline
	for ell := 1; ell <= n; ell++ {
		if limit[ell] == 0 {
			continue
		}
		nd := make([]int64, n+1)
		copy(nd, dp)
		for q := 1; q <= limit[ell] && q*ell <= n; q++ {
			used := q * ell
			for w := used; w <= n; w++ {
				if dp[w-used] != neg {
					if v := dp[w-used] + price[ell]*int64(q); v > nd[w] {
						nd[w] = v
					}
				}
			}
		}
		dp = nd
	}
	return dp[n]
}

func main() {
	price := []int64{0, 1, 5, 8, 9}
	limit := []int{0, 0, 1, 0, 0}
	fmt.Println(rodCutBounded(price, limit, 4)) // 5
}
```

**Java.**
```java
public class RodCutBounded {
    static long rodCutBounded(long[] price, int[] limit, int n) {
        long[] dp = new long[n + 1]; // dp[w] = best revenue filling capacity w (0 baseline)
        for (int ell = 1; ell <= n; ell++) {
            if (limit[ell] == 0) continue;
            long[] nd = dp.clone();
            for (int q = 1; q <= limit[ell] && q * ell <= n; q++) {
                int used = q * ell;
                for (int w = used; w <= n; w++) {
                    long v = dp[w - used] + price[ell] * q;
                    if (v > nd[w]) nd[w] = v;
                }
            }
            dp = nd;
        }
        return dp[n];
    }

    public static void main(String[] args) {
        long[] price = {0, 1, 5, 8, 9};
        int[] limit = {0, 0, 1, 0, 0};
        System.out.println(rodCutBounded(price, limit, 4)); // 5
    }
}
```

**Python.**
```python
def rod_cut_bounded(price, limit, n):
    dp = [0] * (n + 1)  # dp[w] = best revenue filling capacity w
    for ell in range(1, n + 1):
        if limit[ell] == 0:
            continue
        nd = dp[:]  # 0 copies of ell baseline
        q = 1
        while q <= limit[ell] and q * ell <= n:
            used = q * ell
            for w in range(used, n + 1):
                v = dp[w - used] + price[ell] * q
                if v > nd[w]:
                    nd[w] = v
            q += 1
        dp = nd
    return dp[n]


if __name__ == "__main__":
    print(rod_cut_bounded([0, 1, 5, 8, 9], [0, 0, 1, 0, 0], 4))  # 5
```

---

## Final Tips

- Lead with the one-liner: *"`dp[len] = max over first cut c of (price[c] + dp[len-c])`, filled bottom-up in `O(n^2)`."*
- Immediately flag the two gotchas: **include the sell-whole option** (`c = len`) and **`dp[0] = 0`**.
- Offer **reconstruction** unprompted — interviewers love that you return the cuts, not just the value, and that you verify pieces sum to `n` and prices sum to `dp[n]`.
- If asked about a per-cut fee, charge it **only when `c < len`**; explain why charging it on the whole rod is wrong.
- Name the connection: rod cutting **is** unbounded knapsack (`02`), and shares its skeleton with coin change (`19`) — only the objective changes.
- For large `n`, mention restricting the inner loop to the `m` *offered* lengths (`O(n·m)`), and that the real cutting-stock problem is NP-hard.
