# Bitmask DP (DP over Subsets) — Interview Preparation

Bitmask DP is a favourite interview topic because it rewards one crisp insight — *"a subset of `n` items is an integer, so `dp[mask]` can be indexed by a subset"* — and then tests whether you can (a) write the right recurrence (Held-Karp for TSP, `dp[mask]` for assignment), (b) get the bit operations exactly right, (c) read off the complexity (`2^n · n^2`, `2^n · n`, or `3^n`) from the loop shape, and (d) know the `2^n` feasibility wall. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| TSP / shortest Hamiltonian tour | `dp[mask][last]`, Held-Karp | `O(2^n · n^2)` |
| Shortest Hamiltonian path | Held-Karp, no return edge | `O(2^n · n^2)` |
| Count Hamiltonian paths | `dp[mask][last]`, sum | `O(2^n · n^2)` |
| Min-cost assignment / matching | `dp[mask]`, `i = popcount(mask)` | `O(2^n · n)` |
| Partition into `k` equal subsets | `dp[mask]` over used items | `O(2^n · n)` / `O(3^n)` |
| Set cover (min subsets) | `dp[coveredMask]` | `O(2^U · #sets)` |
| **Counting *simple* paths in big graph** | **NP-hard / #P-hard — no fast method** | — |

Essential bit operations:

```text
in mask?         mask & (1 << i)
add item i        mask | (1 << i)
remove item i     mask & ~(1 << i)
toggle item i     mask ^ (1 << i)
full set          (1 << n) - 1
popcount          bits.OnesCount / Integer.bitCount / int.bit_count()
lowest set bit    mask & (-mask)
clear lowest bit  mask & (mask - 1)
iterate submasks  sub = mask; while sub: ...; sub = (sub-1) & mask
```

Core Held-Karp skeleton:

```text
dp[1<<0][0] = 0; rest = INF
for mask in 0 .. (1<<n)-1:
    for last in mask (and dp[mask][last] < INF):
        for next not in mask:
            dp[mask|(1<<next)][next] = min(..., dp[mask][last] + dist[last][next])
answer = min over last of dp[full][last] + dist[last][0]
```

Key facts:
- **Subset = integer**; the table has `2^n` entries — the `2^n` wall caps `n` at ~20.
- `dp[0]` / `dp[{start}][start]` is the base case; initialise the rest to `INF` (min) or `0` (count).
- Held-Karp is `O(2^n · n^2)` vs brute force `O(n!)`.
- Counts overflow fast → take them **mod a prime**.
- It computes over **simple paths** (visited set encoded) — that is why it's exponential.

---

## Junior Questions (12 Q&A)

### J1. How do you represent a subset as an integer?
One bit per item: bit `i` is `1` if item `i` is in the set, else `0`. A subset of `n` items is an integer in `[0, 2^n)`. So `{0, 2, 3}` is `1101₂ = 13`.

### J2. How do you test if item `i` is in `mask`?
`mask & (1 << i)` is nonzero iff item `i` is present. A common bug is writing `mask & i`, which tests the wrong thing.

### J3. What is `dp[mask][last]` in Held-Karp?
The minimum cost of a path starting at city `0`, having visited exactly the cities in `mask`, and currently sitting at city `last` (which must be in `mask`).

### J4. What is the Held-Karp recurrence?
`dp[mask][last] = min over prev in mask\{last} of dp[mask\{last}][prev] + dist[prev][last]`. Each step appends one city to the path.

### J5. What is the base case?
`dp[1<<0][0] = 0` — only city `0` visited, sitting at city `0`, cost zero. Everything else starts at `INF`.

### J6. How do you get the final tour cost?
After the full mask `(1<<n)-1`, add the return edge: `min over last of dp[full][last] + dist[last][0]`. For a Hamiltonian *path* (no return), omit the `+ dist[last][0]`.

### J7. Why process masks in increasing numeric order?
Removing a city clears a bit, which makes the integer smaller. So a state's dependencies are always at smaller mask values — already computed when you reach the current mask. No sorting needed.

### J8. What is the time and space complexity of Held-Karp?
`O(2^n · n^2)` time (`2^n` masks × `n` choices of `last` × `n` choices of `prev`) and `O(2^n · n)` space.

### J9. Why is this better than brute force?
Brute force tries all `(n−1)!` tours. Held-Karp reuses subproblem answers, turning factorial into `2^n · n^2`. At `n = 15` that is millions of operations instead of trillions.

### J10. What is the largest `n` you can handle?
Roughly `n ≤ 20`, because the table has `2^n` entries — memory (and time) becomes infeasible beyond that. At `n = 20` that is ~1M masks.

### J11. How do you count the set bits of a mask?
Use the hardware popcount: `bits.OnesCount` (Go), `Integer.bitCount` (Java), `int.bit_count()` or `bin(x).count("1")` (Python).

### J12 (analysis). Why must `last` be inside `mask`?
`dp[mask][last]` describes a path that has *visited* `last`, so `last ∈ mask` by definition. Entries where `last ∉ mask` are meaningless and should be skipped — processing them corrupts results.

---

## Middle Questions (12 Q&A)

### M1. Prove the Held-Karp recurrence is correct.
Induction on `|mask|`. Base: `dp[{0}][0] = 0`. Step: any path visiting exactly `mask` ending at `last` arrives from a penultimate vertex `prev ∈ mask\{last}`; removing the last edge gives a path visiting `mask\{last}` ending at `prev`. This bijection makes `dp[mask][last] = min_prev dp[mask\{last}][prev] + dist[prev][last]`.

### M2. Why does the assignment problem need only `dp[mask]`, not `dp[i][mask]`?
Because after assigning workers `0..i`, you have used exactly `i+1` jobs, so `i = popcount(mask)` is determined by the mask. The worker index is a function of the mask, not an independent coordinate — drop it for `O(2^n · n)`.

### M3. How do you enumerate all submasks of a mask?
`sub = mask; while sub > 0: use(sub); sub = (sub - 1) & mask`. The `(sub-1) & mask` snaps back to the next-lower submask. Handle `sub = 0` separately if the empty set matters.

### M4. Why is iterating all submasks of all masks `O(3^n)`?
For each item, in the (mask, submask) pair it is independently *not in mask*, *in mask only*, or *in both* — three choices per item, `3^n` total pairs. Equivalently `Σ_k C(n,k) 2^k = 3^n`.

### M5. How do you count Hamiltonian paths?
Same DP as Held-Karp but `dp[mask][last]` is a count and you **sum** predecessors instead of taking `min`; base `dp[1<<s][s] = 1`. Answer is `Σ_last dp[full][last]`. Take it mod a prime since counts explode.

### M6. What's the difference between `min`, sum, and OR in these DPs?
The recurrence skeleton is identical; only the combine operator changes: `min` for cheapest, `+` (mod p) for counting, `OR` for feasibility/reachability. Pick the operator that matches the question.

### M7. What does `mask & (-mask)` give you?
The lowest set bit, isolated as a power of two. `mask & (mask - 1)` clears that lowest bit. Together they let you iterate set bits one at a time.

### M8. How do you avoid overflow when counting?
Reduce mod a prime after every addition. In Go/Java keep counts in 64-bit and reduce; the values otherwise grow exponentially in `n`.

### M9. How do you handle "partition into groups"?
Submask DP: `dp[mask] = best over submask sub of mask` where `sub` is one valid group and `dp[mask ^ sub]` covers the rest. This is `O(3^n)`.

### M10. When is layered/iterative DP preferable to a bitmask DP?
When the state is not naturally a subset, or `n` is too large. Bitmask DP only fits when the state is "which small set of items is chosen/visited" and `n ≤ ~20`.

### M11. Why can't you use bitmask DP for simple-path counting on a large graph?
Because the state must encode the visited set (to forbid repeats), which is `2^V`. For large `V` that is infeasible; counting simple paths is #P-hard in general. Bitmask DP works only when `V` is small.

### M12 (analysis). How big is the Held-Karp table exactly?
The number of `(mask, last)` pairs with `last ∈ mask` is `Σ_mask popcount(mask) = n · 2^{n−1}`. That is the `Θ(2^n · n)` space, feeding the `Θ(2^n · n^2)` time.

---

## Senior Questions (10 Q&A)

### S1. `n = 25`. Bitmask DP is out of memory. What do you do?
`2^25` cells is too much. Options: minimise the mask width (fix symmetric coordinates, decompose into independent components), use **branch-and-bound** with the Held-Karp 1-tree lower bound (exact, `O(n)` memory), or **meet-in-the-middle** if the problem splits into two independent halves (`~2^{n/2}`).

### S2. How do you compute an exact count larger than a 64-bit integer?
Run the counting DP under several coprime primes and recombine with CRT. The runs are independent (parallelisable). Estimate the magnitude to pick the number of primes.

### S3. What is broken-profile DP and when do you use it?
A grid-filling DP where the mask is the column *frontier* (which cells protrude into the next column), processed cell-by-cell. Used for tiling counts. Make the **narrow** grid dimension the mask width; cost is `O(k · 2^m)` for height `k`, width `m`.

### S4. How does the assignment bitmask DP compare to the Hungarian algorithm?
Hungarian is `O(n^3)` — polynomial, the right tool for large `n`. The bitmask DP is `O(2^n · n)` — exponential but simpler to code, and competitive for `n ≤ ~15`. Choose by `n`.

### S5. How do you make the transition loop fast on a sparse graph?
Precompute neighbour bitmasks `adj[i]`. Then the valid next vertices are `adj[last] & ~mask`, iterated by peeling low bits (`trailing_zeros`, then `cands &= cands-1`). This turns the dense `O(n)` scan into `O(degree)`.

### S6. What is the SOS (sum-over-subsets) transform and why does it matter?
It computes `F[S] = Σ_{T ⊑ S} f[T]` for all `S` in `O(2^n · n)` instead of the naive `O(3^n)`. It (and its Möbius inverse) underlies fast inclusion-exclusion and subset convolution, often turning an `O(3^n)` DP into `O(2^n · n)` or `O(2^n · n^2)`.

### S7. How do you verify a bitmask DP when the table is too big to inspect?
Brute-force oracle on small `n` (permutations for TSP/Hamiltonian, all matchings for assignment), property tests (base case, symmetry of tour cost under reversal, counts consistent across CRT primes), and a memory/`n`-cap guard that fails fast rather than OOM.

### S8. How do you parallelise a bitmask DP?
Masks of the *same popcount* depend only on lower-popcount masks, so they are mutually independent — parallelise within each popcount layer, sync between layers. Submask DPs parallelise per outer mask; CRT counting parallelises across primes.

### S9. Why is TSP not solvable in polynomial time, and what does that imply for bitmask DP?
TSP is NP-hard (reduction from Hamiltonian Cycle, Karp 1972). So no polynomial exact algorithm is expected, and `O(2^n n^2)` Held-Karp is essentially the best exact worst-case bound known. Whether a deterministic `(2−ε)^n` exact TSP exists is open.

### S10 (analysis). When is a partition DP `O(3^n)` and when can you reduce it?
The naive "for each mask, for each submask" partition DP is `O(3^n)`. If the combine is a sum (or a bounded `(min,+)`), you can often apply SOS / subset convolution to reach `O(2^n · n)` or `O(2^n · n^2)` — the difference between `n = 18` and `n = 22` feasibility.

---

## Professional Questions (8 Q&A)

### P1. Design a route-optimisation service that solves exact TSP for delivery batches.
Cap batch size at `n ≤ ~18` so Held-Karp fits (`2^n n^2` time, `2^n n` memory); validate `n` up front and reject/queue oversized batches for a heuristic path (Lin-Kernighan). Precompute the distance matrix once. For batches in the 20s, switch to branch-and-bound with the 1-tree lower bound. Log the memory estimate (`2^n · cellBytes`) before allocating.

### P2. The exact tour count overflows. How do you return an exact big number?
Run the counting DP mod several coprime primes (`10^9+7`, `998244353`, …), reconstruct with CRT. Each prime is an independent job. Use `λ_max`-style magnitude estimates only if counting walks; for path/tour counts bound by `n!` to size the prime set.

### P3. Your bitmask DP is correct but too slow at `n = 20`. Optimisations?
Flat 1D `dp` array (cache locality), skip `INF`/zero states, adjacency-bitmask pruning to iterate only valid transitions, 32-bit cells if values fit, and parallelism across same-popcount masks. If only feasibility is needed, pack `dp` as a bitset (64× memory and speed). If the structure allows, drop a dimension (assignment).

### P4. How do you debug "the tour cost is wrong"?
Run the brute-force permutation oracle on the same small input and diff. Check the usual suspects: membership test (`mask & (1<<i)`), uninitialised `dp` (must be `INF` except base), and the return-edge off-by-one (tour adds `dist[last][0]`, path does not). Verify on a 3-city example by hand.

### P5. When is bitmask DP the *wrong* tool even for small `n`?
When a polynomial algorithm exists: min-cost matching on large `n` → Hungarian `O(n^3)`; shortest path → Dijkstra; MST → Kruskal. Also when the state needs unbounded history (not a fixed subset), or when an approximate answer at scale is acceptable (heuristics).

### P6. Explain the dimension collapse in the assignment DP.
A reachable state has `worker = popcount(mask)` because assigning `i+1` workers uses `i+1` jobs. The worker index is determined by the mask, so `dp[worker][mask]` reduces to `dp[mask]`. This is a general principle: eliminate any coordinate that is a function of another.

### P7. How does inclusion-exclusion give an `O(2^n · n)` Hamiltonian-path count?
Count, for each vertex subset `S`, the length-`(n−1)` walks staying within `S` (a fast `O(n)` recurrence per `S`), then alternate-sign sum over `S` to sieve out walks missing a vertex. Walks using all `n` vertices are exactly Hamiltonian paths. `2^n` subsets × `O(n)` = `O(2^n n)`, beating the `O(2^n n^2)` DP.

### P8 (analysis). Why is the submask enumeration base `3` and not `4`?
For a (mask, submask) pair `T ⊑ S`, each item is in exactly one of three states: out of `S`; in `S` but not `T`; in both. The fourth combination (in `T`, out of `S`) violates `T ⊑ S`. Three states per item over `n` items gives `3^n`. A naive "all masks × all masks" bound gives the wrong `4^n`.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a factorial brute force with an exponential DP.
Look for a concrete story: an exact small-`n` optimisation (routing, scheduling) where `(n−1)!` blew up, the insight that the state was a *subset* + a small coordinate, the measured speedup, and crucially the correctness check against the old brute force on small inputs.

### B2. A teammate ran bitmask TSP on `n = 30` and it crashed. How do you respond?
Explain the `2^n` wall calmly: `2^30 ≈ 10^9` cells × `n` is tens of GB — it cannot fit. Offer the alternatives (branch-and-bound, meet-in-the-middle, or a heuristic if approximate is acceptable) and add an `n`-cap validator so it fails fast next time. Frame it as a teaching moment.

### B3. Design a feature that assigns `n` tasks to `n` people minimising total cost.
For small `n`, the bitmask assignment DP (`O(2^n n)`); for large `n`, the Hungarian algorithm (`O(n^3)`). Discuss where the cutover is (~15), how costs are sourced, ties, and infeasible assignments (cost `INF`). Mention that exactness matters here, unlike approximate routing.

### B4. How would you explain bitmask DP to a junior engineer?
Start from "a row of light switches *is* a number." Show `dp[mask]` as a logbook indexed by which switches are on. Walk Held-Karp on 3 cities by hand. Lead with the two gotchas: the `2^n` memory wall (small `n` only) and the membership test `mask & (1<<i)`. Good mentoring leads with the pitfalls.

### B5. Your scheduling job's memory is spiking. How do you investigate?
Each `dp` cell is `8·2^n·n` bytes; check whether `n` (the mask width) crept up, whether you're allocating per-mask instead of once, and whether an implied dimension can be dropped. Profile allocations. The fix is usually capping/minimising `n` plus reusing a single preallocated table.

---

## Coding Challenges

### Challenge 1: Held-Karp TSP (minimum tour cost)

**Problem.** Given an `n × n` distance matrix, return the minimum cost of a tour that starts and ends at city `0`, visiting every city exactly once.

**Example.**
```text
dist = [[0,10,15],[10,0,20],[15,20,0]], n = 3  ->  45  (0→1→2→0 or 0→2→1→0)
```

**Constraints.** `1 ≤ n ≤ 18`, distances fit in 32 bits.

**Brute force.** All `(n−1)!` permutations — infeasible past `n ≈ 11`.

**Optimal.** Held-Karp, `O(2^n · n^2)`.

**Go.**
```go
package main

import "fmt"

const INF = 1 << 30

func tsp(dist [][]int) int {
	n := len(dist)
	if n == 1 {
		return 0
	}
	full := (1 << n) - 1
	dp := make([][]int, 1<<n)
	for m := range dp {
		dp[m] = make([]int, n)
		for j := range dp[m] {
			dp[m][j] = INF
		}
	}
	dp[1][0] = 0
	for mask := 0; mask <= full; mask++ {
		for last := 0; last < n; last++ {
			if dp[mask][last] == INF || mask&(1<<last) == 0 {
				continue
			}
			for next := 0; next < n; next++ {
				if mask&(1<<next) != 0 {
					continue
				}
				nm := mask | (1 << next)
				if c := dp[mask][last] + dist[last][next]; c < dp[nm][next] {
					dp[nm][next] = c
				}
			}
		}
	}
	best := INF
	for last := 1; last < n; last++ {
		if dp[full][last] != INF && dp[full][last]+dist[last][0] < best {
			best = dp[full][last] + dist[last][0]
		}
	}
	return best
}

func main() {
	dist := [][]int{{0, 10, 15}, {10, 0, 20}, {15, 20, 0}}
	fmt.Println(tsp(dist)) // 45
}
```

**Java.**
```java
public class TSP {
    static final int INF = 1 << 30;

    static int tsp(int[][] dist) {
        int n = dist.length;
        if (n == 1) return 0;
        int full = (1 << n) - 1;
        int[][] dp = new int[1 << n][n];
        for (int[] r : dp) java.util.Arrays.fill(r, INF);
        dp[1][0] = 0;
        for (int mask = 0; mask <= full; mask++)
            for (int last = 0; last < n; last++) {
                if (dp[mask][last] == INF || (mask & (1 << last)) == 0) continue;
                for (int next = 0; next < n; next++) {
                    if ((mask & (1 << next)) != 0) continue;
                    int nm = mask | (1 << next);
                    dp[nm][next] = Math.min(dp[nm][next], dp[mask][last] + dist[last][next]);
                }
            }
        int best = INF;
        for (int last = 1; last < n; last++)
            if (dp[full][last] != INF)
                best = Math.min(best, dp[full][last] + dist[last][0]);
        return best;
    }

    public static void main(String[] args) {
        int[][] dist = {{0, 10, 15}, {10, 0, 20}, {15, 20, 0}};
        System.out.println(tsp(dist)); // 45
    }
}
```

**Python.**
```python
INF = float("inf")


def tsp(dist):
    n = len(dist)
    if n == 1:
        return 0
    full = (1 << n) - 1
    dp = [[INF] * n for _ in range(1 << n)]
    dp[1][0] = 0
    for mask in range(full + 1):
        for last in range(n):
            cur = dp[mask][last]
            if cur == INF or not (mask & (1 << last)):
                continue
            for nxt in range(n):
                if mask & (1 << nxt):
                    continue
                nm = mask | (1 << nxt)
                if cur + dist[last][nxt] < dp[nm][nxt]:
                    dp[nm][nxt] = cur + dist[last][nxt]
    return min(dp[full][last] + dist[last][0] for last in range(1, n))


if __name__ == "__main__":
    dist = [[0, 10, 15], [10, 0, 20], [15, 20, 0]]
    print(tsp(dist))  # 45
```

---

### Challenge 2: Assignment Problem (minimum-cost perfect matching)

**Problem.** Given an `n × n` cost matrix, assign each worker to a distinct job minimising total cost. Return the minimum cost.

**Example.**
```text
cost = [[9,2,7],[6,4,3],[5,8,1]] -> 9  (w0→j1=2, w1→j0=6, w2→j2=1)
```

**Constraints.** `1 ≤ n ≤ 18`.

**Optimal.** `dp[mask]`, `O(2^n · n)`.

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

const INF = 1 << 30

func assign(cost [][]int) int {
	n := len(cost)
	full := (1 << n) - 1
	dp := make([]int, 1<<n)
	for i := range dp {
		dp[i] = INF
	}
	dp[0] = 0
	for mask := 0; mask <= full; mask++ {
		if dp[mask] == INF {
			continue
		}
		i := bits.OnesCount(uint(mask))
		if i >= n {
			continue
		}
		for j := 0; j < n; j++ {
			if mask&(1<<j) != 0 {
				continue
			}
			nm := mask | (1 << j)
			if c := dp[mask] + cost[i][j]; c < dp[nm] {
				dp[nm] = c
			}
		}
	}
	return dp[full]
}

func main() {
	cost := [][]int{{9, 2, 7}, {6, 4, 3}, {5, 8, 1}}
	fmt.Println(assign(cost)) // 9
}
```

**Java.**
```java
public class Assignment {
    static final int INF = 1 << 30;

    static int assign(int[][] cost) {
        int n = cost.length, full = (1 << n) - 1;
        int[] dp = new int[1 << n];
        java.util.Arrays.fill(dp, INF);
        dp[0] = 0;
        for (int mask = 0; mask <= full; mask++) {
            if (dp[mask] == INF) continue;
            int i = Integer.bitCount(mask);
            if (i >= n) continue;
            for (int j = 0; j < n; j++) {
                if ((mask & (1 << j)) != 0) continue;
                int nm = mask | (1 << j);
                dp[nm] = Math.min(dp[nm], dp[mask] + cost[i][j]);
            }
        }
        return dp[full];
    }

    public static void main(String[] args) {
        int[][] cost = {{9, 2, 7}, {6, 4, 3}, {5, 8, 1}};
        System.out.println(assign(cost)); // 9
    }
}
```

**Python.**
```python
INF = float("inf")


def assign(cost):
    n = len(cost)
    full = (1 << n) - 1
    dp = [INF] * (1 << n)
    dp[0] = 0
    for mask in range(full + 1):
        if dp[mask] == INF:
            continue
        i = bin(mask).count("1")
        if i >= n:
            continue
        for j in range(n):
            if mask & (1 << j):
                continue
            nm = mask | (1 << j)
            if dp[mask] + cost[i][j] < dp[nm]:
                dp[nm] = dp[mask] + cost[i][j]
    return dp[full]


if __name__ == "__main__":
    cost = [[9, 2, 7], [6, 4, 3], [5, 8, 1]]
    print(assign(cost))  # 9
```

---

### Challenge 3: Count Hamiltonian Paths

**Problem.** Given a directed graph as an adjacency matrix (`adj[i][j] = 1` if edge `i→j`), count the number of Hamiltonian paths (visiting every vertex exactly once, any start/end), mod `10^9 + 7`.

**Example.**
```text
adj = [[0,1,1],[1,0,1],[1,1,0]] (complete K3) -> 6  (all 3! orderings)
```

**Constraints.** `1 ≤ n ≤ 18`.

**Optimal.** `dp[mask][last]` with summation, `O(2^n · n^2)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func countHam(adj [][]int) int64 {
	n := len(adj)
	full := (1 << n) - 1
	dp := make([][]int64, 1<<n)
	for m := range dp {
		dp[m] = make([]int64, n)
	}
	for s := 0; s < n; s++ {
		dp[1<<s][s] = 1
	}
	for mask := 0; mask <= full; mask++ {
		for last := 0; last < n; last++ {
			cur := dp[mask][last]
			if cur == 0 || mask&(1<<last) == 0 {
				continue
			}
			for nxt := 0; nxt < n; nxt++ {
				if mask&(1<<nxt) != 0 || adj[last][nxt] == 0 {
					continue
				}
				nm := mask | (1 << nxt)
				dp[nm][nxt] = (dp[nm][nxt] + cur) % MOD
			}
		}
	}
	var total int64
	for last := 0; last < n; last++ {
		total = (total + dp[full][last]) % MOD
	}
	return total
}

func main() {
	adj := [][]int{{0, 1, 1}, {1, 0, 1}, {1, 1, 0}}
	fmt.Println(countHam(adj)) // 6
}
```

**Java.**
```java
public class CountHam {
    static final long MOD = 1_000_000_007L;

    static long count(int[][] adj) {
        int n = adj.length, full = (1 << n) - 1;
        long[][] dp = new long[1 << n][n];
        for (int s = 0; s < n; s++) dp[1 << s][s] = 1;
        for (int mask = 0; mask <= full; mask++)
            for (int last = 0; last < n; last++) {
                long cur = dp[mask][last];
                if (cur == 0 || (mask & (1 << last)) == 0) continue;
                for (int nxt = 0; nxt < n; nxt++) {
                    if ((mask & (1 << nxt)) != 0 || adj[last][nxt] == 0) continue;
                    int nm = mask | (1 << nxt);
                    dp[nm][nxt] = (dp[nm][nxt] + cur) % MOD;
                }
            }
        long total = 0;
        for (int last = 0; last < n; last++) total = (total + dp[full][last]) % MOD;
        return total;
    }

    public static void main(String[] args) {
        int[][] adj = {{0, 1, 1}, {1, 0, 1}, {1, 1, 0}};
        System.out.println(count(adj)); // 6
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def count_ham(adj):
    n = len(adj)
    full = (1 << n) - 1
    dp = [[0] * n for _ in range(1 << n)]
    for s in range(n):
        dp[1 << s][s] = 1
    for mask in range(full + 1):
        for last in range(n):
            cur = dp[mask][last]
            if cur == 0 or not (mask & (1 << last)):
                continue
            for nxt in range(n):
                if (mask & (1 << nxt)) or not adj[last][nxt]:
                    continue
                nm = mask | (1 << nxt)
                dp[nm][nxt] = (dp[nm][nxt] + cur) % MOD
    return sum(dp[full][last] for last in range(n)) % MOD


if __name__ == "__main__":
    adj = [[0, 1, 1], [1, 0, 1], [1, 1, 0]]
    print(count_ham(adj))  # 6
```

---

### Challenge 4: Partition to K Equal-Sum Subsets

**Problem.** Given an array `nums` and integer `k`, decide whether `nums` can be partitioned into `k` non-empty subsets all with equal sum. Return `true`/`false`. (LeetCode 698.)

**Example.**
```text
nums = [4,3,2,3,5,2,1], k = 4 -> true  (target sum 5 each: [5],[1,4],[2,3],[2,3])
```

**Constraints.** `1 ≤ k ≤ n ≤ 16`.

**Approach.** `dp[mask]` = remainder toward the current bucket's target after using exactly the items in `mask`; reachable means a valid filling exists. If `sum % k != 0` it's impossible. `O(2^n · n)`.

**Go.**
```go
package main

import "fmt"

func canPartitionKSubsets(nums []int, k int) bool {
	n := len(nums)
	total := 0
	for _, v := range nums {
		total += v
	}
	if total%k != 0 {
		return false
	}
	target := total / k
	full := (1 << n) - 1
	// dp[mask] = -1 if unreachable, else used sum within the current bucket (0..target-1)
	dp := make([]int, 1<<n)
	for i := range dp {
		dp[i] = -1
	}
	dp[0] = 0
	for mask := 0; mask <= full; mask++ {
		if dp[mask] == -1 {
			continue
		}
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 || dp[mask]+nums[i] > target {
				continue
			}
			nm := mask | (1 << i)
			if dp[nm] == -1 {
				dp[nm] = (dp[mask] + nums[i]) % target
			}
		}
	}
	return dp[full] == 0
}

func main() {
	fmt.Println(canPartitionKSubsets([]int{4, 3, 2, 3, 5, 2, 1}, 4)) // true
}
```

**Java.**
```java
public class PartitionK {
    static boolean canPartition(int[] nums, int k) {
        int n = nums.length, total = 0;
        for (int v : nums) total += v;
        if (total % k != 0) return false;
        int target = total / k, full = (1 << n) - 1;
        int[] dp = new int[1 << n];
        java.util.Arrays.fill(dp, -1);
        dp[0] = 0;
        for (int mask = 0; mask <= full; mask++) {
            if (dp[mask] == -1) continue;
            for (int i = 0; i < n; i++) {
                if ((mask & (1 << i)) != 0 || dp[mask] + nums[i] > target) continue;
                int nm = mask | (1 << i);
                if (dp[nm] == -1) dp[nm] = (dp[mask] + nums[i]) % target;
            }
        }
        return dp[full] == 0;
    }

    public static void main(String[] args) {
        System.out.println(canPartition(new int[]{4, 3, 2, 3, 5, 2, 1}, 4)); // true
    }
}
```

**Python.**
```python
def can_partition_k_subsets(nums, k):
    n = len(nums)
    total = sum(nums)
    if total % k != 0:
        return False
    target = total // k
    full = (1 << n) - 1
    dp = [-1] * (1 << n)  # -1 = unreachable; else used sum in current bucket
    dp[0] = 0
    for mask in range(full + 1):
        if dp[mask] == -1:
            continue
        for i in range(n):
            if (mask & (1 << i)) or dp[mask] + nums[i] > target:
                continue
            nm = mask | (1 << i)
            if dp[nm] == -1:
                dp[nm] = (dp[mask] + nums[i]) % target
    return dp[full] == 0


if __name__ == "__main__":
    print(can_partition_k_subsets([4, 3, 2, 3, 5, 2, 1], 4))  # True
```

---

## Final Tips

- Lead with the one-liner: *"A subset of `n` items is an integer, so I index a DP table by the subset; Held-Karp solves TSP in `O(2^n · n^2)`."*
- Immediately flag the two gotchas: the **`2^n` memory wall** (small `n` only) and the **membership test `mask & (1<<i)`**.
- State the recurrence and the base case precisely; mention the dependency order (masks increase, dependencies decrease).
- For assignment, explain the **dimension collapse** (`worker = popcount(mask)`) — interviewers love it.
- For counting, switch `min → +` and take it **mod a prime**.
- Always offer to verify against a brute-force oracle on small `n`, and know the alternatives (branch-and-bound, meet-in-the-middle, Hungarian) when `n` is too large.
