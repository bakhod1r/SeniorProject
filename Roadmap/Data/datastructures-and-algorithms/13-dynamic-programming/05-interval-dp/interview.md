# Interval DP (DP over Ranges `[i..j]`) — Interview Preparation

Interval DP is a favourite interview topic because it rewards a single crisp insight — *"the state is a contiguous range `[i..j]`, and you combine sub-ranges over a split point"* — and then tests whether you can (a) fill the table in the correct increasing-length order, (b) choose between **split-point** and **last-operated-element** framing, (c) recognize the same `O(n³)` skeleton behind matrix chain, burst balloons, palindrome partitioning, and stone games, and (d) know when the quadrangle inequality unlocks Knuth's `O(n²)` speedup. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Cheapest parenthesization of a matrix chain | split-point interval DP | `O(n³)` (→ `O(n²)` Knuth) |
| Optimal binary search tree | split-point (root = k) | `O(n³)` (→ `O(n²)` Knuth) |
| Min cost to merge adjacent stone piles | split-point, cost = range sum | `O(n³)` (→ `O(n²)` Knuth) |
| Max coins (burst balloons) | last-operated-element | `O(n³)` |
| Min cuts for palindrome partition | palindrome interval table + linear DP | `O(n²)` |
| Stone game (two-player, take ends) | interval DP, max-of-min | `O(n²)` |
| Remove boxes (block scoring) | 3D interval DP `dp[i][j][carry]` | `O(n⁴)` |
| **Merge ANY two piles (not adjacent)** | **Huffman greedy, NOT interval DP** | `O(n log n)` |

Two framings (the combine changes; the increasing-length fill order does not):

```text
framing           halves read              k range        when
split-point       dp[i][k], dp[k+1][j]     i..j-1         operation does NOT alter neighbors
last-element      dp[i][k], dp[k][j]       i+1..j-1       operation DOES alter neighbors (burst/remove)
```

Core algorithm:

```text
for length = 1..n:                 # base length-1, then increasing
    for i = 0..n-length:
        j = i + length - 1
        dp[i][j] = BEST_INIT       # +inf for min, -inf/0 for max
        for k in split_range(i, j):
            dp[i][j] = best(dp[i][j], dp[i][k] + dp[k(+1)][j] + cost(i,k,j))
answer = dp[0][n-1]                 # O(n^3) time, O(n^2) space
```

Key facts:
- **State = interval `[i..j]`**, transition = choose split / last element.
- Fill **by increasing length**; never plain ascending `i, j`.
- Initialize cells to `±∞` before a min/max loop.
- Hoist range-sum costs out of the inner loop (prefix sums) — else `O(n⁴)`.
- Knuth `O(n²)` applies iff the endpoint-only cost satisfies the quadrangle inequality.

---

## Junior Questions (12 Q&A)

### J1. What is the state in interval DP?
A contiguous range `[i..j]`. `dp[i][j]` holds the optimal answer (min cost, max value, count) for just the sub-sequence from index `i` to index `j`. There are `O(n²)` such states.

### J2. What does the transition do?
It picks a **split point** `k` inside `[i..j]`, combining the optimal answers of the two sub-ranges plus a join cost: `dp[i][j] = best over k of dp[i][k] + dp[k+1][j] + cost(i,k,j)`.

### J3. Why fill the table by increasing interval length?
Because `dp[i][j]` depends only on **strictly shorter** sub-ranges. Filling shortest-first guarantees every sub-range it reads is already computed. Plain ascending `i, j` order reads uncomputed cells and is wrong.

### J4. What is the base case?
The smallest ranges, usually length 1. For matrix chain `dp[i][i] = 0` (a single matrix needs no multiplication). Getting the base case and the length-loop start value right is where most beginner bugs live.

### J5. What is the time and space complexity?
`O(n³)` time — `O(n²)` intervals times `O(n)` split points — and `O(n²)` space for the table. Comfortable up to `n ≈ 500`.

### J6. Walk me through matrix chain on `dims = [10,30,5,60]`.
Three matrices. `dp[0][1]=10·30·5=1500`, `dp[1][2]=30·5·60=9000`. For the full range, split `k=0` gives `9000+10·30·60=27000`, split `k=1` gives `1500+10·5·60=4500`. Minimum is `4500` — parenthesization `(M0 M1) M2`.

### J7. What does `cost(i,k,j)` represent?
The extra cost of joining the two sub-ranges at split `k`. For matrix chain it is `dims[i]·dims[k+1]·dims[j+1]` (the final multiply); for stone merging it is `sum(stones[i..j])`.

### J8. Where is the final answer in the table?
At `dp[0][n-1]` — the cell for the whole sequence, which is the last one filled (the longest interval).

### J9. Can interval DP be written recursively?
Yes — top-down memoization: a recursive `solve(i, j)` that caches results per `(i, j)` pair. Same `O(n³)`; bottom-up has lower constants and no recursion-depth limit.

### J10. What is burst balloons asking?
Given balloon values, burst them one by one; bursting balloon `k` earns `left·k·right` of its *current* neighbors. Maximize total coins. It is interval DP with the last-element framing.

### J11. Why pad burst balloons with 1s?
So the boundary balloons have well-defined neighbors. Padding `1` on both ends makes the products at the edges valid (multiplying by 1 doesn't change them).

### J12 (analysis). Why is the naive (no-DP) approach exponential?
The number of parenthesizations of an `n`-chain is the Catalan number `C_{n-1} = Θ(4ⁿ / n^{1.5})`. Trying them all is exponential; interval DP reuses the `O(n²)` overlapping subproblems to make it polynomial.

---

## Middle Questions (12 Q&A)

### M1. Prove that the matrix-chain recurrence is correct.
Every parenthesization has a unique outermost product splitting the chain at some `k`. The cost is the optimal left sub-product plus the optimal right sub-product plus the final multiply `r_i·r_{k+1}·r_{j+1}`. By optimal substructure (cut-and-paste), minimizing over `k` gives the optimum.

### M2. What is the difference between split-point and last-element framing?
Split-point partitions `[i..j]` into adjacent halves `[i..k]` and `[k+1..j]` — used when the join doesn't change the elements inside. Last-element fixes which element of `(i, j)` is operated on *last*, with halves `(i, k)` and `(k, j)` sharing `k` — used when an operation changes neighbors (burst/remove).

### M3. Why can't you use a split-point recurrence for burst balloons?
Because bursting in the left half changes the right half's neighbors — the subproblems aren't independent. Fixing the *last* burst freezes its neighbors at the stable boundaries `i` and `j`, restoring independence. First-vs-last is a correctness issue, not a style choice.

### M4. How do you set up optimal BST as interval DP?
`dp[i][j] = min over root k of dp[i][k-1] + dp[k+1][j] + freqSum(i..j)`. Choosing `k` as the root pushes every key in `[i..j]` one level deeper, adding `freqSum(i..j)` to the cost. Base `dp[i][i-1] = 0`.

### M5. Why does the `+freqSum(i..j)` term appear in optimal BST?
Making any key the root increases the depth of every key in the range by exactly one, so the expected-cost contribution rises by the sum of their access frequencies — independent of which key is the root.

### M6. How do you avoid turning `O(n³)` into `O(n⁴)`?
Never recompute a range-sum cost inside the `k` loop. Precompute prefix sums so `sum(i..j)` is `O(1)`, and hoist any `k`-independent cost out of the inner loop.

### M7. How does stone merging differ from the Huffman problem?
Stone merging requires merging **adjacent** piles → interval DP, `O(n³)`/`O(n²)`. If you may merge **any two** piles, it's Huffman, solved greedily with a heap in `O(n log n)`. The adjacency constraint is what forces interval DP.

### M8. How do you reconstruct the optimal parenthesization?
Store the winning split `split[i][j] = k` whenever you update `dp[i][j]`, then walk that table recursively: `build(i, j)` returns `(build(i, split) build(split+1, j))`.

### M9. What is the quadrangle inequality, informally?
A discrete convexity condition on the cost: `cost(a,c)+cost(b,d) ≤ cost(a,d)+cost(b,c)` for `a≤b≤c≤d`. When it holds (plus monotonicity), the optimal split is monotone and Knuth's optimization gives `O(n²)`.

### M10. Which classic problems satisfy the quadrangle inequality?
Matrix chain, optimal BST, and stone merging — their costs are range-sum or boundary-dimension functions that satisfy QI. They are the standard Knuth-optimization examples.

### M11. How do you solve palindrome partitioning with the fewest cuts?
First build a palindrome table `pal[i][j]` (an interval DP filled by length: `pal[i][j] = s[i]==s[j] and (j-i<2 or pal[i+1][j-1])`), then a linear DP `cuts[j] = min over i of cuts[i-1]+1` when `s[i..j]` is a palindrome. Total `O(n²)`.

### M12 (analysis). When does an interval problem need a third state dimension?
When the merge cost depends on context *outside* the interval — like removing boxes, where the score of a block depends on same-colored boxes attached from outside. You add a `carry` dimension `dp[i][j][carry]`, raising the cost to `O(n⁴)`.

---

## Senior Questions (10 Q&A)

### S1. How do you decide between top-down and bottom-up for interval DP?
Prototype top-down (memoized recursion) to get the recurrence right. Port to bottom-up for the hot path: lower constant factor, no stack-overflow risk, cache-friendly diagonal sweep. For interval DP the whole triangle is usually needed anyway, so bottom-up's "fills everything" isn't wasteful.

### S2. When exactly does Knuth's optimization apply?
The DP must be `dp[i][j] = min_k (dp[i][k]+dp[k+1][j]) + w(i,j)` with `w` depending only on `(i,j)` and satisfying the quadrangle inequality plus monotonicity. Then the optimal split is monotone `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`, the per-cell scan telescopes, and total work is `O(n²)`.

### S3. What goes wrong if you apply Knuth without verifying QI?
The monotone-split window can exclude the true optimum, returning a *suboptimal* answer with no error raised. Always cross-check the optimized version against the `O(n³)` baseline on thousands of random small instances, and assert the `opt` table is monotone.

### S4. How does the divide-and-conquer optimization differ from Knuth?
D&C targets the *layered partition* shape `dp[t][j] = min_i dp[t-1][i] + C(i,j)` (split into exactly `m` groups), giving `O(mn log n)` per the monotone optimal cut. Knuth targets the single-table interval shape, giving `O(n²)`. Both rest on monotonicity of the optimal split, but they are not interchangeable.

### S5. How do you parallelize an interval DP?
Cells of the same interval length are independent (they read only strictly-shorter intervals, already done). Fill each length's anti-diagonal in parallel across threads with a barrier between lengths. The `k` loop within a cell is sequential, but there are `O(n)` independent cells per length.

### S6. How much memory does interval DP use, and how do you reduce it?
`O(n²)` — `8n²` bytes for `int64`. Only the upper triangle is used, so you can pack it into `n(n+1)/2`. The 3D removing-boxes variant is `O(n³)` space and `O(n⁴)` time — bound the `carry` dimension to its realized range and use a hash-map memo top-down.

### S7. How do you verify correctness when `n` is large?
Brute-force oracle (enumerate all parenthesizations) for `n ≤ 8`; baseline-vs-optimized cross-check for any Knuth/D&C version; reconstruction round-trip (re-evaluate the reconstructed plan's cost, assert it equals `dp[0][n-1]`); and a monotonicity assertion on the `opt` table.

### S8. What is the most common performance regression in interval DP?
Recomputing a range-sum cost inside the inner `k` loop, silently making the DP `O(n⁴)`. Symptom: `n=500` is fast but `n=1000` is ~16× slower than expected. Fix with prefix sums and hoisting.

### S9. How do you recognize that a problem is interval DP rather than another DP?
The subproblem must be a **contiguous range** built from smaller contiguous ranges. If the subproblem is a prefix (one endpoint) it's linear DP; if it's an arbitrary subset it's bitmask DP; if merges need not be adjacent it's greedy/Huffman.

### S10 (analysis). Why is the optimal split monotone under QI?
If `cost` satisfies QI, the relative advantage of a larger split index over a smaller one is monotone as the interval grows — so the argmin cannot move left. Formally `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`, the staircase property that both Knuth and D&C exploit.

---

## Professional Questions (8 Q&A)

### P1. Design a service that answers "cheapest merge plan for sub-range `[i..j]`" over a fixed sequence.
If `n` is small, precompute the full `dp` table once (`O(n³)` or `O(n²)` with Knuth) and serve `O(1)` reads of `dp[i][j]`. Cache the `split` table only if clients need the actual plan, not just the cost. The table is read-only after construction — share it across request handlers; never rebuild per request.

### P2. Your interval DP is correct on small inputs but wrong when a value recurs across a split. What's the diagnosis?
You're likely missing a state dimension. The 2D `dp[i][j]` assumes the optimum for `[i..j]` is independent of everything outside it; if the merge cost depends on external context (same-colored boxes attached from outside), you need a third `carry` dimension — at `O(n⁴)`.

### P3. The matrix is `n=3000`; `O(n³)` is too slow. What do you do?
Check whether the cost satisfies the quadrangle inequality; if so apply Knuth's optimization for `O(n²)` (3000² is trivial). If not, optimize constants (flat array, hoisted cost, anti-diagonal parallelism) and accept `O(n³)`, or reconsider whether the problem is really interval DP (maybe it's a layered partition → D&C, or greedy).

### P4. How do you debug "the optimal cost is wrong" in production interval DP?
Run the brute-force oracle on the exact small failing input and diff. Check the three usual suspects: wrong fill order (must be increasing length), missing `±∞` initialization before the min/max loop, and off-by-one split bounds (`k ∈ [i,j-1]` for splits, `(i,j)` for last-element). Verify base cases and that range-sum costs use prefix sums.

### P5. When is interval DP the wrong tool entirely?
When subproblems are arbitrary subsets (use bitmask DP); when merges/combinations need not be adjacent (use greedy/Huffman); when the sequence is huge and no QI/D&C optimization applies; or when the problem is actually a prefix/linear DP. State the contiguity requirement explicitly to avoid forcing interval DP where it doesn't fit.

### P6. How would you handle a removing-boxes-style problem at scale?
Use the 3D state `dp[i][j][carry]` top-down with memoization so only reachable `(i,j,carry)` triples are materialized; the realized `carry` is bounded by same-color run lengths, usually `≪ n`. Collapse leading same-color runs to shrink the state space, and measure realized state count in production.

### P7. How do automata / palindrome structure connect to interval DP?
The palindrome table `pal[i][j]` is itself an interval DP (filled by length, reading the inner range `pal[i+1][j-1]`). Many string-partitioning problems layer a linear DP on top of such an interval table. The pattern — an interval table feeding a linear DP — recurs across string problems.

### P8 (analysis). Why does QI reduce the third factor but not below `O(n²)`?
QI makes the optimal split monotone, so each cell's scan amortizes to `O(1)` and the total is `O(n²)`. You cannot go below `O(n²)` in general because there are `Θ(n²)` interval states to fill (and to answer sub-range queries you must store `Θ(n²)` outputs) — `O(n²)` matches the state/output lower bound up to constants.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an exponential search with a DP.
Look for a concrete story: a "try all orderings/groupings" task that blew up combinatorially, the insight that the optimum for a range decomposes over a split (overlapping subproblems), the `O(n³)` interval DP that replaced it, and the measured speedup. Strong answers mention verifying against the slow brute force on small inputs.

### B2. A teammate applied Knuth's optimization and shipped wrong (suboptimal) results. How do you handle it?
Explain calmly that Knuth requires the cost to satisfy the quadrangle inequality, which their cost doesn't. Show a small counterexample where the monotone window skips the true optimum. The fix: verify QI (prove it or cross-check against the `O(n³)` baseline on random instances) before optimizing; fall back to the baseline if QI fails. Frame it as a teaching moment about preconditions.

### B3. Design a feature that finds the cheapest way to combine a pipeline of operators.
This is matrix-chain-flavored interval DP: each adjacent pair of operators can be fused at some cost; the optimal fusion order decomposes over a split. Discuss building the `dp[i][j]` cost table, reconstructing the plan, handling `n` in the hundreds with `O(n³)`, and whether the fusion cost satisfies QI for an `O(n²)` speedup.

### B4. How would you explain interval DP to a junior engineer?
Start from matrix chain: the product is the same but the *order* of multiplication changes the cost wildly. Whatever the best order is, there's some outermost multiplication splitting the chain in two — try every split, take the cheapest. Then: store the answer for every range `[i..j]`, fill short ranges first. Lead with the two gotchas: fill order must be by length, and pick split-vs-last-element correctly.

### B5. Your interval-DP job is using too much memory. How do you investigate?
Each `int64` table is `8n²` bytes; check whether `n` ballooned or whether you added an unnecessary third dimension (8n³ bytes). Confirm you're not storing the `split` table when only the cost is needed. For 3D variants, switch to top-down with a hash memo so only reachable states are stored, and bound the `carry` to its realized range. Profile allocations.

---

## Coding Challenges

### Challenge 1: Matrix Chain Multiplication

**Problem.** Given `dims` of length `n+1` (so `n` matrices, `M_t` is `dims[t] × dims[t+1]`), return the minimum number of scalar multiplications to compute the product.

**Example.**
```text
dims = [10,30,5,60]  ->  4500   ((M0 M1) M2)
dims = [40,20,30,10,30] -> 26000
```

**Constraints.** `2 ≤ len(dims) ≤ 500`, `1 ≤ dims[t] ≤ 500`.

**Optimal.** Split-point interval DP, `O(n³)` (Knuth `O(n²)`).

**Go.**
```go
package main

import "fmt"

func matrixChain(dims []int) int64 {
	n := len(dims) - 1
	dp := make([][]int64, n)
	for i := range dp {
		dp[i] = make([]int64, n)
	}
	for length := 2; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			dp[i][j] = 1 << 62
			for k := i; k < j; k++ {
				c := dp[i][k] + dp[k+1][j] +
					int64(dims[i])*int64(dims[k+1])*int64(dims[j+1])
				if c < dp[i][j] {
					dp[i][j] = c
				}
			}
		}
	}
	return dp[0][n-1]
}

func main() {
	fmt.Println(matrixChain([]int{10, 30, 5, 60}))          // 4500
	fmt.Println(matrixChain([]int{40, 20, 30, 10, 30}))     // 26000
}
```

**Java.**
```java
public class MatrixChain {
    static long matrixChain(int[] dims) {
        int n = dims.length - 1;
        long[][] dp = new long[n][n];
        for (int length = 2; length <= n; length++) {
            for (int i = 0; i + length - 1 < n; i++) {
                int j = i + length - 1;
                dp[i][j] = Long.MAX_VALUE;
                for (int k = i; k < j; k++) {
                    long c = dp[i][k] + dp[k + 1][j]
                           + (long) dims[i] * dims[k + 1] * dims[j + 1];
                    if (c < dp[i][j]) dp[i][j] = c;
                }
            }
        }
        return dp[0][n - 1];
    }

    public static void main(String[] args) {
        System.out.println(matrixChain(new int[]{10, 30, 5, 60}));       // 4500
        System.out.println(matrixChain(new int[]{40, 20, 30, 10, 30}));  // 26000
    }
}
```

**Python.**
```python
def matrix_chain(dims):
    n = len(dims) - 1
    dp = [[0] * n for _ in range(n)]
    for length in range(2, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            dp[i][j] = float("inf")
            for k in range(i, j):
                c = dp[i][k] + dp[k + 1][j] + dims[i] * dims[k + 1] * dims[j + 1]
                if c < dp[i][j]:
                    dp[i][j] = c
    return dp[0][n - 1]


if __name__ == "__main__":
    print(matrix_chain([10, 30, 5, 60]))         # 4500
    print(matrix_chain([40, 20, 30, 10, 30]))    # 26000
```

---

### Challenge 2: Burst Balloons

**Problem.** Balloons with values `nums`. Bursting balloon `k` (with current neighbors `L`, `R`) earns `L·nums[k]·R`. After bursting, neighbors become adjacent. Maximize total coins.

**Example.**
```text
nums = [3,1,5,8]  ->  167   (burst 1, then 5, then 3, then 8)
nums = [1,5]      ->  10
```

**Constraints.** `1 ≤ len(nums) ≤ 500`, `0 ≤ nums[k] ≤ 100`.

**Optimal.** Last-element interval DP on the padded array, `O(n³)`.

**Go.**
```go
package main

import "fmt"

func maxCoins(nums []int) int {
	a := make([]int, len(nums)+2)
	a[0], a[len(a)-1] = 1, 1
	copy(a[1:], nums)
	n := len(a)
	dp := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int, n)
	}
	for length := 2; length < n; length++ {
		for i := 0; i+length < n; i++ {
			j := i + length
			for k := i + 1; k < j; k++ { // k burst last in (i, j)
				coins := dp[i][k] + dp[k][j] + a[i]*a[k]*a[j]
				if coins > dp[i][j] {
					dp[i][j] = coins
				}
			}
		}
	}
	return dp[0][n-1]
}

func main() {
	fmt.Println(maxCoins([]int{3, 1, 5, 8})) // 167
	fmt.Println(maxCoins([]int{1, 5}))       // 10
}
```

**Java.**
```java
public class BurstBalloons {
    static int maxCoins(int[] nums) {
        int n = nums.length + 2;
        int[] a = new int[n];
        a[0] = 1; a[n - 1] = 1;
        for (int i = 0; i < nums.length; i++) a[i + 1] = nums[i];
        int[][] dp = new int[n][n];
        for (int length = 2; length < n; length++) {
            for (int i = 0; i + length < n; i++) {
                int j = i + length;
                for (int k = i + 1; k < j; k++) {
                    int coins = dp[i][k] + dp[k][j] + a[i] * a[k] * a[j];
                    if (coins > dp[i][j]) dp[i][j] = coins;
                }
            }
        }
        return dp[0][n - 1];
    }

    public static void main(String[] args) {
        System.out.println(maxCoins(new int[]{3, 1, 5, 8})); // 167
        System.out.println(maxCoins(new int[]{1, 5}));       // 10
    }
}
```

**Python.**
```python
def max_coins(nums):
    a = [1] + nums + [1]
    n = len(a)
    dp = [[0] * n for _ in range(n)]
    for length in range(2, n):
        for i in range(n - length):
            j = i + length
            for k in range(i + 1, j):  # k burst LAST in (i, j)
                coins = dp[i][k] + dp[k][j] + a[i] * a[k] * a[j]
                if coins > dp[i][j]:
                    dp[i][j] = coins
    return dp[0][n - 1]


if __name__ == "__main__":
    print(max_coins([3, 1, 5, 8]))  # 167
    print(max_coins([1, 5]))        # 10
```

---

### Challenge 3: Palindrome Partitioning II (Minimum Cuts)

**Problem.** Given a string `s`, partition it so every substring is a palindrome, using the minimum number of cuts. Return that minimum.

**Example.**
```text
s = "aab"   ->  1   ("aa" | "b")
s = "abccba" -> 0   (already a palindrome)
```

**Constraints.** `1 ≤ len(s) ≤ 2000`.

**Optimal.** Interval DP palindrome table `pal[i][j]` + linear cut DP, `O(n²)`.

**Go.**
```go
package main

import "fmt"

func minCut(s string) int {
	n := len(s)
	if n == 0 {
		return 0
	}
	pal := make([][]bool, n)
	for i := range pal {
		pal[i] = make([]bool, n)
	}
	// fill by increasing length so pal[i+1][j-1] is ready
	for length := 1; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			if s[i] == s[j] && (j-i < 2 || pal[i+1][j-1]) {
				pal[i][j] = true
			}
		}
	}
	cuts := make([]int, n)
	for j := 0; j < n; j++ {
		if pal[0][j] {
			cuts[j] = 0
			continue
		}
		cuts[j] = j // worst case: cut before every char
		for i := 1; i <= j; i++ {
			if pal[i][j] && cuts[i-1]+1 < cuts[j] {
				cuts[j] = cuts[i-1] + 1
			}
		}
	}
	return cuts[n-1]
}

func main() {
	fmt.Println(minCut("aab"))    // 1
	fmt.Println(minCut("abccba")) // 0
}
```

**Java.**
```java
public class PalindromeCut {
    static int minCut(String s) {
        int n = s.length();
        if (n == 0) return 0;
        boolean[][] pal = new boolean[n][n];
        for (int length = 1; length <= n; length++) {
            for (int i = 0; i + length - 1 < n; i++) {
                int j = i + length - 1;
                if (s.charAt(i) == s.charAt(j) && (j - i < 2 || pal[i + 1][j - 1]))
                    pal[i][j] = true;
            }
        }
        int[] cuts = new int[n];
        for (int j = 0; j < n; j++) {
            if (pal[0][j]) { cuts[j] = 0; continue; }
            cuts[j] = j;
            for (int i = 1; i <= j; i++) {
                if (pal[i][j] && cuts[i - 1] + 1 < cuts[j])
                    cuts[j] = cuts[i - 1] + 1;
            }
        }
        return cuts[n - 1];
    }

    public static void main(String[] args) {
        System.out.println(minCut("aab"));    // 1
        System.out.println(minCut("abccba")); // 0
    }
}
```

**Python.**
```python
def min_cut(s):
    n = len(s)
    if n == 0:
        return 0
    pal = [[False] * n for _ in range(n)]
    for length in range(1, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            if s[i] == s[j] and (j - i < 2 or pal[i + 1][j - 1]):
                pal[i][j] = True
    cuts = [0] * n
    for j in range(n):
        if pal[0][j]:
            cuts[j] = 0
            continue
        cuts[j] = j
        for i in range(1, j + 1):
            if pal[i][j] and cuts[i - 1] + 1 < cuts[j]:
                cuts[j] = cuts[i - 1] + 1
    return cuts[n - 1]


if __name__ == "__main__":
    print(min_cut("aab"))     # 1
    print(min_cut("abccba"))  # 0
```

---

### Challenge 4: Stone Game (Merge Adjacent Piles, Minimum Cost)

**Problem.** `n` piles in a row with weights `stones`. Merging two **adjacent** piles costs the sum of their weights; the result is one pile of that combined weight. Merge everything into one pile with minimum total cost.

**Example.**
```text
stones = [4,1,1,4]  ->  18
stones = [1,2,3]    ->  9    (merge 1,2 -> cost 3; then 3,3 -> cost 6; total 9)
```

**Constraints.** `1 ≤ n ≤ 500`, `1 ≤ stones[t] ≤ 1000`.

**Optimal.** Split-point interval DP, cost = range sum (Knuth `O(n²)`).

**Go.**
```go
package main

import "fmt"

func mergeStones(stones []int) int64 {
	n := len(stones)
	if n <= 1 {
		return 0
	}
	prefix := make([]int64, n+1)
	for i, x := range stones {
		prefix[i+1] = prefix[i] + int64(x)
	}
	dp := make([][]int64, n)
	for i := range dp {
		dp[i] = make([]int64, n)
	}
	for length := 2; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			dp[i][j] = 1 << 62
			rs := prefix[j+1] - prefix[i]
			for k := i; k < j; k++ {
				c := dp[i][k] + dp[k+1][j] + rs
				if c < dp[i][j] {
					dp[i][j] = c
				}
			}
		}
	}
	return dp[0][n-1]
}

func main() {
	fmt.Println(mergeStones([]int{4, 1, 1, 4})) // 18
	fmt.Println(mergeStones([]int{1, 2, 3}))    // 9
}
```

**Java.**
```java
public class StoneMerge {
    static long mergeStones(int[] stones) {
        int n = stones.length;
        if (n <= 1) return 0;
        long[] prefix = new long[n + 1];
        for (int i = 0; i < n; i++) prefix[i + 1] = prefix[i] + stones[i];
        long[][] dp = new long[n][n];
        for (int length = 2; length <= n; length++) {
            for (int i = 0; i + length - 1 < n; i++) {
                int j = i + length - 1;
                dp[i][j] = Long.MAX_VALUE;
                long rs = prefix[j + 1] - prefix[i];
                for (int k = i; k < j; k++) {
                    long c = dp[i][k] + dp[k + 1][j] + rs;
                    if (c < dp[i][j]) dp[i][j] = c;
                }
            }
        }
        return dp[0][n - 1];
    }

    public static void main(String[] args) {
        System.out.println(mergeStones(new int[]{4, 1, 1, 4})); // 18
        System.out.println(mergeStones(new int[]{1, 2, 3}));    // 9
    }
}
```

**Python.**
```python
def merge_stones(stones):
    n = len(stones)
    if n <= 1:
        return 0
    prefix = [0]
    for x in stones:
        prefix.append(prefix[-1] + x)
    dp = [[0] * n for _ in range(n)]
    for length in range(2, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            dp[i][j] = float("inf")
            rs = prefix[j + 1] - prefix[i]
            for k in range(i, j):
                c = dp[i][k] + dp[k + 1][j] + rs
                if c < dp[i][j]:
                    dp[i][j] = c
    return dp[0][n - 1]


if __name__ == "__main__":
    print(merge_stones([4, 1, 1, 4]))  # 18
    print(merge_stones([1, 2, 3]))     # 9
```

---

## Final Tips

- Lead with the one-liner: *"The state is a contiguous range `[i..j]`; combine sub-ranges over a split point, filling the table by increasing interval length, in `O(n³)`."*
- Immediately flag the two decisions: **split-point vs last-operated-element** framing, and **increasing-length fill order**.
- For burst/remove problems, explain *why* last-element framing makes the subproblems independent (the last operation's neighbors are the stable boundaries).
- If the cost is endpoint-only and convex, mention **Knuth's optimization** (`O(n²)` under the quadrangle inequality) as the speedup beyond the baseline.
- Watch for the greedy trap: if merges need not be adjacent it's **Huffman**, not interval DP.
- Always offer to verify against a brute-force "all parenthesizations" oracle on small inputs.
