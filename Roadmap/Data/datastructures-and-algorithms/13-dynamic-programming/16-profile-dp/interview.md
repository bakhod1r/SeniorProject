# Profile DP / Broken Profile DP (Tiling a Grid with a Frontier Bitmask) — Interview Preparation

Profile DP is a favorite interview topic because it rewards one crisp insight — *"sweep the grid cell by cell, carry an `m`-bit frontier mask, branch on skip / vertical / horizontal"* — and then tests whether you can (a) keep the cost `O(n·m·2^m)` by rotating so `m` is the narrow dimension, (b) keep it correct with the right mask encoding and modular arithmetic, (c) recognize the same skeleton behind trominoes, grid independent sets, and large-`n` transfer-matrix exponentiation, and (d) avoid the trap of using the large dimension as `m`. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Count domino tilings of `n × m` | broken-profile DP, narrow `m` | `O(n·m·2^m)` |
| Same, astronomically large `n`, tiny `m` | transfer-matrix exponentiation | `O(8^m log n)` |
| Tilings with L-trominoes / mixed pieces | profile DP, wider mask | `O(n·m·poly)` |
| Max independent set on a grid | profile DP, select/skip rule | `O(n·m·2^m)` |
| Count grid independent sets | profile DP, sum over masks | `O(n·m·2^m)` |
| `2 × n` domino count | Fibonacci | `F(n+1)` |
| Both dimensions large (planar) | Kasteleyn Pfaffian | `O((nm)^3)` |
| **Perfect matchings in 3D / non-planar** | **#P-complete — no fast method** | — |

Core algorithm (broken profile):

```text
rotate so m = min(rows, cols); if n*m odd return 0
dp[0] = 1                                   # empty frontier
for r in 0..n-1:
  for c in 0..m-1:
    ndp = zeros(2^m); bit = 1<<c
    for mask with dp[mask] != 0:
      if mask & bit:  ndp[mask ^ bit] += dp[mask]                       # filled → advance
      else:
        if r+1 < n:               ndp[mask | bit] += dp[mask]           # vertical
        if c+1 < m and right free: ndp[mask | (1<<(c+1))] += dp[mask]   # horizontal
    dp = ndp
return dp[0]                                # O(n*m*2^m), mod p
```

Key facts:
- **Exponential only in the narrow dimension `m`** → always rotate so `m = min(rows, cols)`.
- State is `(cell, m-bit mask)`; mask bit `c` = "frontier cell in column `c` already covered."
- **Odd area** (`n·m` odd) → 0 tilings.
- The answer is `dp[mask = 0]` after all cells (for tilings); independent-set counting sums over **all** masks.
- Counts overflow fast → take mod a prime; the domino transition is purely additive.

---

## Junior Questions (12 Q&A)

### J1. What is the state in profile DP for domino tiling?
A pair `(cell position, mask)`. The position is where we are in the cell-by-cell sweep (reading order). The `mask` is `m` bits, one per column of the frontier, recording which frontier cells are already covered by a previously placed domino.

### J2. Why is the mask only `m` bits?
Because the frontier — the boundary between decided and undecided cells — is always exactly `m` cells wide (a staircase of `m−c` cells in the current row plus `c` cells in the next). Dominoes are local, so only those `m` cells' coverage can still affect future placements.

### J3. What are the transitions at a cell?
If the current cell's bit is **set** (already covered), advance and clear the bit. If it is **free**, either place a **vertical** domino (cover the cell below, set its bit; needs a row below) or a **horizontal** domino (cover the free cell to the right, set its bit; needs a column to the right and that cell free).

### J4. Why must you rotate so `m` is the smaller dimension?
The cost is `O(n·m·2^m)` — exponential only in `m`. Using the large dimension as `m` makes `2^m` astronomical. Swapping to `m = min(rows, cols)` is one line and can change feasibility by hundreds of orders of magnitude.

### J5. What is the time complexity?
`O(n·m·2^m)`: `n·m` cells, `2^m` masks per cell, O(1) work per mask (at most three transitions). Space is `O(2^m)` with a rolling array.

### J6. Why take the count modulo a prime?
Tiling counts grow exponentially in the grid area and overflow 64-bit integers. Problems ask for the count mod a prime like `10^9 + 7`; you reduce after every addition.

### J7. When are there zero tilings?
When the grid has an odd number of cells (`n·m` odd), since each domino covers exactly two cells. Reject this case immediately and return 0.

### J8. How do you read the final answer?
After sweeping all `n·m` cells, the answer is `dp[mask = 0]` — the only complete tiling state has an empty frontier (no domino pokes past the bottom-right edge). Do **not** sum over all masks for tiling counts.

### J9. What is a good sanity check for your code?
The `2 × n` board has exactly `Fibonacci(n+1)` tilings, and the `8 × 8` board has `12988816`. Both are easy to assert.

### J10. What does "broken profile" mean?
Advancing the DP **one cell at a time** (the profile is "broken" mid-row) rather than a whole row at a time. This keeps the mask exactly `m` bits and makes each transition O(1).

### J11. Can profile DP handle blocked / pre-filled cells?
Yes. A blocked cell is treated as "already covered" — when the sweep reaches it, you skip without placing a domino (and never place a domino onto it). This is one of profile DP's strengths.

### J12 (analysis). Why is the state space bounded even though there are exponentially many tilings?
Because the only thing the future needs from the past is the frontier shape — `m` bits — not the full arrangement of decided dominoes. This "memorylessness" (dominoes are local) collapses exponentially many histories into `2^m` states.

---

## Middle Questions (12 Q&A)

### M1. Prove the broken-profile DP counts each tiling exactly once.
Reading order fixes which cell is decided next, so every tiling induces a **unique** decision sequence (skip / vertical / horizontal per free cell). Conversely each valid decision path assembles one tiling. This bijection between tilings and root-to-leaf decision paths ending at `(nm, mask=0)` means `dp[nm][0]` counts each tiling exactly once.

### M2. Compare broken profile vs full-row profile.
Broken profile advances one cell, transition O(1), total `O(n·m·2^m)`. Full-row profile advances a whole row, enumerating row fillings — naive transition is `O(4^m)` (over `(mask, next_mask)` pairs) or `O(3^m)`/`O(m·2^m)` with a careful column recursion. Broken profile is usually preferred for its O(1) step and easy per-cell extensions.

### M3. How do you choose which dimension is `m`?
Always `m = min(rows, cols)`. The runtime is exponential in `m` and linear in the other dimension, so picking the smaller side as `m` is mandatory.

### M4. How does profile DP connect to the transfer-matrix method?
For fixed small `m`, the row-to-row map is a fixed `2^m × 2^m` matrix `T` where `T[mask][next] =` ways a row with incoming occupancy `mask` produces outgoing `next`. Then `Z(n,m) = (T^n)[0][0]`, and `T^n` is computed by binary exponentiation in `O(8^m log n)`.

### M5. When is matrix exponentiation worth it over the sweep?
Only when `n` is astronomically large (`10^18`) and `m` is tiny enough that cubing a `2^m × 2^m` matrix (`8^m` per multiply) is affordable. For typical `n`, the linear sweep is simpler and faster.

### M6. Why does the `2 × n` domino count equal Fibonacci?
With `m = 2`, the reachable transfer matrix is `T = [[1,1],[1,0]]` — the Fibonacci matrix. So `Z(2,n) = F(n+1)`. The first column of a `2 × n` board is either a single vertical (leaving a `2 × (n−1)`) or two horizontals stacked (leaving a `2 × (n−2)`), the Fibonacci recurrence.

### M7. How do you adapt profile DP to L-trominoes?
At a free cell, enumerate each of the L-tromino's rotations that fit, updating the bits of all three covered cells. The frontier may need more than `m` bits (or 2 bits per column) because a tromino can protrude further than one row. Mixed domino+tromino tilings union the transition sets.

### M8. How do you count grid independent sets with profile DP?
Bit `c` = "is the frontier cell in column `c` selected?". At cell `(r,c)`: always allow "skip" (clear the bit); allow "select" only if the up-neighbor (bit `c`) and left-neighbor (bit `c−1`) are not selected. The answer sums over **all** final masks (every state is a valid endpoint).

### M9. What is the right mask encoding, and why is it bug-prone?
Two conventions exist: "set bit on placement" (vertical sets the below-cell bit; advancing past a filled cell clears it) and "bit = free/occupied for next row." Both are correct; mixing them silently corrupts the transition. Pick one, document the bit meaning, and verify on a `2×3`.

### M10. How do you avoid overflow?
The domino transition is purely additive, so reduce mod `p` after each addition; adding two reduced residues stays well within `int64`. For weighted/colored variants with multiplications, reduce after the multiply or bound a 128-bit accumulator.

### M11. Why can't profile DP handle both-large grids?
`2^m` explodes when `m` is large. For large planar grids you switch to the Kasteleyn Pfaffian (`O((nm)^3)`); for 3D/non-planar matching counting, the problem is #P-complete and has no known polynomial algorithm.

### M12 (analysis). What is the growth rate of the tiling count?
For fixed `m`, `Z(n,m) = Θ(λ_max(m)^n)` where `λ_max(m)` is the Perron eigenvalue of the transfer matrix. As `m → ∞`, the per-cell growth constant tends to the dimer constant `exp(G/π) ≈ 1.3385` (`G` = Catalan's constant).

---

## Senior Questions (10 Q&A)

### S1. How would you count tilings of a `12 × 10^18` board?
`m = 12`, `n = 10^18`. Iterating `n` rows is infeasible, so build the `2^12 × 2^12` transfer matrix `T` (prune to reachable masks) and compute `(T^n)[0][0]` by binary exponentiation — `O(8^m log n)` with `m = 12`... which is `8^12` per multiply, far too large. So in practice reduce the matrix to *reachable* masks (far fewer than `4096`) before cubing, or accept that `m = 12` is at the edge — matrix exponentiation shines for `m ≤ ~6–8`.

### S2. How do you keep the per-cell sweep fast?
Zero-skip (`if dp[mask]==0: continue`) is the biggest win — reachable masks are sparse. Use a flat integer-indexed array, ping-pong two rolling buffers, hoist `bit = 1<<c` and bounds checks out of the mask loop, and avoid per-cell allocation.

### S3. How do you compute an exact (non-modular) huge count?
The exact count has `Θ(nm)` digits, so big-integer arithmetic erodes performance. Run the DP under several coprime primes and reconstruct via CRT, sizing the number of primes from the growth estimate `λ_max^n`. The per-prime runs are independent and parallelizable.

### S4. How does the technique generalize beyond dominoes?
Same frontier skeleton: trominoes/polyominoes enumerate piece placements (wider mask for taller pieces); independent sets store select/skip bits with up+left checks; proper `q`-colorings store a color per column (`q^m` states); connectivity-constrained counts (Hamiltonicity) need a plug/connectivity profile (Bell/Catalan-sized state).

### S5. How do you make one implementation serve max-weight and counting?
Parameterize by semiring: `(+, ×)` for counting, `(max, +)` for max-weight packing, `(OR, AND)` for feasibility. The sweep and transitions are identical; only the combine operations and the identity change. This mirrors the semiring abstraction in matrix-power-on-graphs.

### S6. When is the Kasteleyn Pfaffian the right tool instead of profile DP?
When **both** dimensions are large and the grid is planar. The Pfaffian/determinant method counts domino tilings of any planar grid in `O((nm)^3)`, whereas profile DP is exponential in the narrow dimension. Profile DP wins only when one dimension is small.

### S7. How do you verify correctness when the board is too big to brute-force?
Keep a brute-force backtracking oracle for grids up to `~6×6` and diff exactly. Add anchors: `2 × n == F(n+1)`, `8 × 8 == 12988816`, rotation symmetry `count(n,m) == count(m,n)`, odd-area `== 0`, and cross-check the sweep against the transfer-matrix path. Determinism across languages is another strong check.

### S8. What are the main failure modes in production?
Un-rotated dimension (the catastrophe), silent overflow (missing modulus), reading the wrong final state (summing all masks for tilings), mask-encoding confusion, off-by-one bit indexing, matrix exponentiation with too-large `m`, and rebuilding the transfer matrix/ladder per query in a batched service.

### S9. How would you handle a board with forbidden cells?
Treat a forbidden cell as permanently "covered": when the sweep reaches it, skip it (advance) and never place a domino onto it; when a vertical/horizontal would land on it, that transition is illegal. The frontier machinery is otherwise unchanged — profile DP handles holes naturally, which the closed-form formula cannot.

### S10 (analysis). Why does the spectral (eigenvalue) view fail for exact counts?
`Z(n,m) = Σ_r c_r λ_r^n`, but the transfer-matrix eigenvalues are generally irrational algebraic numbers. Floating-point evaluation gives an approximation, not an exact integer, and reducing an irrational mod `p` is meaningless. Eigenvalues give the growth rate; exact counts require integer DP/matrix arithmetic mod a prime.

---

## Professional Questions (8 Q&A)

### P1. Design a service that answers "number of domino tilings of `n × m`" for many queries.
For varied small `m`, each query is one `O(n·m·2^m)` sweep. If queries share `m` but vary huge `n`, precompute the transfer matrix `T` and its squaring ladder once, then each query multiplies the ladder entries whose bits are set in `n` (`O(8^m·popcount(n))`). Always rotate to `m = min`, reduce mod the required prime, and shard across CRT primes for exact large values.

### P2. How do you handle the exact (non-modular) count at scale?
The value has `Θ(nm)` digits; big-integer matrix/DP costs grow with size. Use CRT across enough coprime primes to cover the value's range (estimate via the dimer growth constant), run independent modular DPs in parallel, and reconstruct. Pure big-integer DP is the fallback when CRT is awkward.

### P3. Your narrow dimension is `m = 20`. The sweep is too slow. What do you do?
`2^20 ≈ 10^6` masks per cell. First confirm `m = min`. Exploit zero-skip aggressively (reachable masks are far fewer). Consider whether the problem has extra structure (symmetry, blocked-cell sparsity) to shrink the state. If `n` is also huge, matrix exponentiation is infeasible at `m=20`; if the grid is large in both dimensions and planar, switch to the Kasteleyn Pfaffian.

### P4. How do you debug "the tiling count is wrong" in production?
Run the brute-force backtracking oracle on the same small inputs and diff. Check the usual suspects: un-rotated dimension, missing modulus, wrong final read (`dp[0]` vs sum), mask-encoding mismatch, and bit-index off-by-one. Verify rotation symmetry and the Fibonacci / `8×8` anchors. Cross-check the sweep against the transfer-matrix path.

### P5. When is profile DP the wrong choice entirely?
When both dimensions are large (`2^m` explodes) — use Kasteleyn for planar grids. When the count is over 3D/non-planar graphs — #P-complete, no fast method. When you need a *single* tiling rather than a count — use bipartite matching / a constructive algorithm. When the constraint is non-local and cannot be summarized by a fixed-width frontier.

### P6. How would you parallelize a batch of tiling-count queries?
Precompute the transfer-matrix squaring ladder once (shared read-only). Distribute queries (each a different `n`) across workers; each composes the cached ladder. Across CRT primes, each prime is an independent job. The matrix multiply itself parallelizes over output rows for large state sets.

### P7. How do trominoes and polyominoes change the model?
The transition at a free cell enumerates every placement of every piece anchored there that fits within the board and the current frontier. The frontier width must cover each piece's full vertical reach, so taller pieces need a wider mask (or multiple bits per column to encode partial protrusions). The correctness proof (bijection over the last decision) is unchanged.

### P8 (analysis). Why does the Kasteleyn formula not replace profile DP for grids with holes?
Kasteleyn's Pfaffian method gives a clean determinant for the *full* planar grid via a special edge orientation, but arbitrary holes/forbidden cells change the graph in ways that complicate the orientation and the closed form. Profile DP handles forbidden cells trivially (treat as pre-covered), which is why it remains the practical tool for irregular boards with a small dimension.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you collapsed an exponential search into a polynomial DP.
Look for a concrete story: a counting/packing task with a small dimension, the realization that only a fixed-width frontier mattered (memorylessness), encoding it as a bitmask, and the measured speedup from infeasible to instant. Strong answers cite validation against a brute-force oracle and the Fibonacci / `8×8` anchors.

### B2. A teammate used the large dimension as the bitmask width and the job OOM'd. How do you handle it?
Explain calmly that the cost is exponential in the *narrow* dimension, so `m = min(rows, cols)` is mandatory — a one-line swap. Show the `2^m` blowup with numbers (`m=12` vs `m=1000`). Frame it as a quick teaching moment and add an assertion/guard so the un-rotated case is caught early.

### B3. Design a feature that counts the ways to fully cover a parking grid with `1×2` cars.
This is domino tiling with possible blocked cells (occupied spots). Use broken-profile DP with the narrow dimension as `m`, treat occupied spots as pre-covered, take the count mod a prime, and validate against brute force on small lots. Mention rotation, odd-area rejection, and that holes are handled naturally.

### B4. How would you explain profile DP to a junior engineer?
Use the zipper analogy: sweep cell by cell; everything behind the zipper is sealed (decided), and the only thing that matters is the shape of the teeth at the line — encode that as a bitmask. At each free cell you either drop a peg down (vertical) or snap two teeth together (horizontal). Lead with the two gotchas: rotate so `m` is small, and take the count mod `p`.

### B5. Your tiling-count job uses too much memory at scale. How do you investigate?
Each rolling layer is `8·2^m` bytes; check whether `m` is the small dimension (the usual culprit). Confirm you ping-pong two buffers rather than allocating per cell. For batched queries, verify the transfer-matrix ladder is shared, not duplicated per request. Profile allocations; the fix is usually rotation plus buffer reuse.

---

## Coding Challenges

### Challenge 1: Count Domino Tilings of an n × m Grid (mod p)

**Problem.** Count the number of ways to tile an `n × m` grid with `1×2` dominoes, modulo `10^9 + 7`.

**Example.**
```text
n=2, m=3 -> 3
n=2, m=4 -> 5     (Fibonacci F(5))
n=8, m=8 -> 12988816
```

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ m ≤ 16` (or rotate so the small side ≤ 16).

**Optimal.** Broken-profile DP, `O(n·m·2^m)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func countTilings(n, m int) int64 {
	if (n*m)%2 != 0 {
		return 0
	}
	if m > n {
		n, m = m, n
	}
	full := 1 << m
	dp := make([]int64, full)
	dp[0] = 1
	for r := 0; r < n; r++ {
		for c := 0; c < m; c++ {
			ndp := make([]int64, full)
			bit := 1 << c
			for mask := 0; mask < full; mask++ {
				v := dp[mask]
				if v == 0 {
					continue
				}
				if mask&bit != 0 {
					t := mask ^ bit
					ndp[t] = (ndp[t] + v) % MOD
				} else {
					if r+1 < n {
						t := mask | bit
						ndp[t] = (ndp[t] + v) % MOD
					}
					if c+1 < m && mask&(1<<(c+1)) == 0 {
						t := mask | (1 << (c + 1))
						ndp[t] = (ndp[t] + v) % MOD
					}
				}
			}
			dp = ndp
		}
	}
	return dp[0]
}

func main() {
	fmt.Println(countTilings(2, 3)) // 3
	fmt.Println(countTilings(2, 4)) // 5
	fmt.Println(countTilings(8, 8)) // 12988816
}
```

**Java.**
```java
public class CountTilings {
    static final long MOD = 1_000_000_007L;

    static long countTilings(int n, int m) {
        if (((long) n * m) % 2 != 0) return 0;
        if (m > n) { int t = n; n = m; m = t; }
        int full = 1 << m;
        long[] dp = new long[full];
        dp[0] = 1;
        for (int r = 0; r < n; r++)
            for (int c = 0; c < m; c++) {
                long[] ndp = new long[full];
                int bit = 1 << c;
                for (int mask = 0; mask < full; mask++) {
                    long v = dp[mask];
                    if (v == 0) continue;
                    if ((mask & bit) != 0) {
                        ndp[mask ^ bit] = (ndp[mask ^ bit] + v) % MOD;
                    } else {
                        if (r + 1 < n) ndp[mask | bit] = (ndp[mask | bit] + v) % MOD;
                        if (c + 1 < m && (mask & (1 << (c + 1))) == 0) {
                            int t = mask | (1 << (c + 1));
                            ndp[t] = (ndp[t] + v) % MOD;
                        }
                    }
                }
                dp = ndp;
            }
        return dp[0];
    }

    public static void main(String[] args) {
        System.out.println(countTilings(2, 3)); // 3
        System.out.println(countTilings(2, 4)); // 5
        System.out.println(countTilings(8, 8)); // 12988816
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def count_tilings(n, m):
    if (n * m) % 2 != 0:
        return 0
    if m > n:
        n, m = m, n
    full = 1 << m
    dp = [0] * full
    dp[0] = 1
    for r in range(n):
        for c in range(m):
            ndp = [0] * full
            bit = 1 << c
            for mask in range(full):
                v = dp[mask]
                if not v:
                    continue
                if mask & bit:
                    ndp[mask ^ bit] = (ndp[mask ^ bit] + v) % MOD
                else:
                    if r + 1 < n:
                        ndp[mask | bit] = (ndp[mask | bit] + v) % MOD
                    if c + 1 < m and not (mask & (1 << (c + 1))):
                        t = mask | (1 << (c + 1))
                        ndp[t] = (ndp[t] + v) % MOD
            dp = ndp
    return dp[0]


if __name__ == "__main__":
    print(count_tilings(2, 3))  # 3
    print(count_tilings(2, 4))  # 5
    print(count_tilings(8, 8))  # 12988816
```

---

### Challenge 2: Tilings with L-Trominoes (and dominoes), Count

**Problem.** Count the ways to tile an `n × m` grid using **L-trominoes** (3-cell L pieces, all 4 rotations). For simplicity here we count tilings by L-trominoes only when `n·m` is divisible by 3 (else 0). Use profile DP where the frontier encodes 2 bits per column is unnecessary for this anchored formulation; we track per-column "filled?" with a recursion that places a tromino anchored at the first free cell.

**Approach.** A robust formulation: process cells in reading order; at the first free cell `(r,c)`, try each L-tromino rotation whose cells are all in-bounds and currently free, mark them, recurse, unmark. Memoize on `(r, c, frontier-mask)` where the mask covers the next two rows' relevant cells. For interview scope, the cleaner runnable version below uses the broken-profile-with-extended-mask idea via recursion + memo on `(pos, mask)` with the mask covering the current and next row band (2 rows × `m`), since a tromino spans at most 2 rows.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

// L-tromino tiling via memoized recursion on a 2-row sliding window.
// Mask has 2*m bits: low m bits = current row occupancy, high m bits = next row.
func countTrominoes(n, m int) int64 {
	if (n*m)%3 != 0 {
		return 0
	}
	memo := map[[2]int]int64{}
	var solve func(pos, mask int) int64
	total := n * m
	var rec func(pos, mask int) int64
	rec = func(pos, mask int) int64 {
		if pos == total {
			if mask == 0 {
				return 1
			}
			return 0
		}
		key := [2]int{pos, mask}
		if v, ok := memo[key]; ok {
			return v
		}
		r, c := pos/m, pos%m
		_ = r
		bit := 1 << c
		var res int64
		if mask&bit != 0 {
			// already filled: advance, shift window when wrapping a row
			res = rec(pos+1, shift(mask, c, m))
		} else {
			// try the four L-trominoes anchored with a cell at (r,c) as the
			// top-left-most free cell; place by setting the 3 covered bits.
			for _, cells := range lShapes(c, m) {
				if fits(mask, cells) {
					res = (res + rec(pos+1, shift(applyCells(mask, cells), c, m))) % MOD
				}
			}
		}
		memo[key] = res
		return res
	}
	_ = solve
	return rec(0, 0)
}

// Helpers operate on a 2*m-bit window: bit i (0<=i<m) = current row col i;
// bit m+i = next row col i.
func fits(mask int, cells []int) bool {
	for _, b := range cells {
		if mask&(1<<b) != 0 {
			return false
		}
	}
	return true
}
func applyCells(mask int, cells []int) int {
	for _, b := range cells {
		mask |= 1 << b
	}
	return mask
}
func shift(mask, c, m int) int {
	if c == m-1 {
		// move to next row: next-row bits become current-row bits
		return mask >> m
	}
	return mask
}

// lShapes returns bit-position triples (within the 2*m window) for the four
// L-tromino rotations anchored so that (current row, col c) is covered.
func lShapes(c, m int) [][]int {
	cur := c
	nxt := m + c
	res := [][]int{}
	// shape covering (r,c),(r,c+1),(r+1,c)
	if c+1 < m {
		res = append(res, []int{cur, cur + 1, nxt})
	}
	// (r,c),(r,c+1),(r+1,c+1)
	if c+1 < m {
		res = append(res, []int{cur, cur + 1, nxt + 1})
	}
	// (r,c),(r+1,c),(r+1,c+1)
	if c+1 < m {
		res = append(res, []int{cur, nxt, nxt + 1})
	}
	// (r,c),(r+1,c),(r+1,c-1)
	if c-1 >= 0 {
		res = append(res, []int{cur, nxt, nxt - 1})
	}
	return res
}

func main() {
	fmt.Println(countTrominoes(2, 3)) // tilings of 2x3 by L-trominoes = 2
	fmt.Println(countTrominoes(3, 2)) // rotation symmetric = 2
}
```

**Java.**
```java
import java.util.*;

public class CountTrominoes {
    static final long MOD = 1_000_000_007L;
    static int M, TOTAL;
    static HashMap<Long, Long> memo;

    static long rec(int pos, int mask) {
        if (pos == TOTAL) return mask == 0 ? 1 : 0;
        long key = ((long) pos << 32) | (mask & 0xffffffffL);
        Long cached = memo.get(key);
        if (cached != null) return cached;
        int c = pos % M;
        int bit = 1 << c;
        long res = 0;
        if ((mask & bit) != 0) {
            res = rec(pos + 1, shift(mask, c));
        } else {
            for (int[] cells : lShapes(c)) {
                boolean ok = true;
                int nm = mask;
                for (int b : cells) {
                    if ((nm & (1 << b)) != 0) { ok = false; break; }
                    nm |= 1 << b;
                }
                if (ok) res = (res + rec(pos + 1, shift(nm, c))) % MOD;
            }
        }
        memo.put(key, res);
        return res;
    }

    static int shift(int mask, int c) { return c == M - 1 ? mask >> M : mask; }

    static List<int[]> lShapes(int c) {
        int cur = c, nxt = M + c;
        List<int[]> r = new ArrayList<>();
        if (c + 1 < M) {
            r.add(new int[]{cur, cur + 1, nxt});
            r.add(new int[]{cur, cur + 1, nxt + 1});
            r.add(new int[]{cur, nxt, nxt + 1});
        }
        if (c - 1 >= 0) r.add(new int[]{cur, nxt, nxt - 1});
        return r;
    }

    static long countTrominoes(int n, int m) {
        if (((long) n * m) % 3 != 0) return 0;
        M = m; TOTAL = n * m; memo = new HashMap<>();
        return rec(0, 0);
    }

    public static void main(String[] args) {
        System.out.println(countTrominoes(2, 3)); // 2
        System.out.println(countTrominoes(3, 2)); // 2
    }
}
```

**Python.**
```python
import sys
from functools import lru_cache

MOD = 1_000_000_007


def count_trominoes(n, m):
    if (n * m) % 3 != 0:
        return 0
    total = n * m

    def l_shapes(c):
        cur, nxt = c, m + c
        res = []
        if c + 1 < m:
            res.append((cur, cur + 1, nxt))
            res.append((cur, cur + 1, nxt + 1))
            res.append((cur, nxt, nxt + 1))
        if c - 1 >= 0:
            res.append((cur, nxt, nxt - 1))
        return res

    def shift(mask, c):
        return mask >> m if c == m - 1 else mask

    sys.setrecursionlimit(1 << 20)

    @lru_cache(maxsize=None)
    def rec(pos, mask):
        if pos == total:
            return 1 if mask == 0 else 0
        c = pos % m
        bit = 1 << c
        if mask & bit:
            return rec(pos + 1, shift(mask, c))
        res = 0
        for cells in l_shapes(c):
            nm = mask
            ok = True
            for b in cells:
                if nm & (1 << b):
                    ok = False
                    break
                nm |= 1 << b
            if ok:
                res = (res + rec(pos + 1, shift(nm, c))) % MOD
        return res

    return rec(0, 0)


if __name__ == "__main__":
    print(count_trominoes(2, 3))  # 2
    print(count_trominoes(3, 2))  # 2
```

---

### Challenge 3: Maximum Independent Set on a Grid (Profile DP)

**Problem.** Given an `n × m` grid where each cell has a non-negative weight, choose a subset of cells with no two orthogonally adjacent, maximizing the total weight. Use profile DP with the narrow dimension as `m`.

**Approach.** Broken profile with `max`-plus combine. Bit `c` of the mask = "frontier cell in column `c` is selected." At cell `(r,c)`: option skip (clear bit); option select (legal iff up-neighbor bit `c` and left-neighbor bit `c−1` are unset), adding `weight[r][c]`.

**Go.**
```go
package main

import "fmt"

func maxIndependentSet(w [][]int64) int64 {
	n := len(w)
	if n == 0 {
		return 0
	}
	m := len(w[0])
	// assume m is the narrow dimension (rotate beforehand if needed)
	full := 1 << m
	neg := int64(-1) << 60
	dp := make([]int64, full)
	for i := range dp {
		dp[i] = neg
	}
	dp[0] = 0
	for r := 0; r < n; r++ {
		for c := 0; c < m; c++ {
			ndp := make([]int64, full)
			for i := range ndp {
				ndp[i] = neg
			}
			bit := 1 << c
			leftbit := 0
			if c > 0 {
				leftbit = 1 << (c - 1)
			}
			for mask := 0; mask < full; mask++ {
				if dp[mask] == neg {
					continue
				}
				// skip (clear bit c)
				t := mask &^ bit
				if dp[mask] > ndp[t] {
					ndp[t] = dp[mask]
				}
				// select if up and left not selected
				if mask&bit == 0 && (c == 0 || mask&leftbit == 0) {
					t2 := mask | bit
					cand := dp[mask] + w[r][c]
					if cand > ndp[t2] {
						ndp[t2] = cand
					}
				}
			}
			dp = ndp
		}
	}
	best := neg
	for _, v := range dp {
		if v > best {
			best = v
		}
	}
	return best
}

func main() {
	w := [][]int64{{1, 2, 3}, {4, 5, 6}}
	fmt.Println(maxIndependentSet(w)) // choose non-adjacent cells for max weight
}
```

**Java.**
```java
public class MaxIndependentSet {
    static long solve(long[][] w) {
        int n = w.length;
        if (n == 0) return 0;
        int m = w[0].length;
        int full = 1 << m;
        long NEG = Long.MIN_VALUE / 4;
        long[] dp = new long[full];
        java.util.Arrays.fill(dp, NEG);
        dp[0] = 0;
        for (int r = 0; r < n; r++)
            for (int c = 0; c < m; c++) {
                long[] ndp = new long[full];
                java.util.Arrays.fill(ndp, NEG);
                int bit = 1 << c;
                int leftbit = c > 0 ? 1 << (c - 1) : 0;
                for (int mask = 0; mask < full; mask++) {
                    if (dp[mask] == NEG) continue;
                    int t = mask & ~bit;
                    if (dp[mask] > ndp[t]) ndp[t] = dp[mask];
                    if ((mask & bit) == 0 && (c == 0 || (mask & leftbit) == 0)) {
                        int t2 = mask | bit;
                        long cand = dp[mask] + w[r][c];
                        if (cand > ndp[t2]) ndp[t2] = cand;
                    }
                }
                dp = ndp;
            }
        long best = NEG;
        for (long v : dp) best = Math.max(best, v);
        return best;
    }

    public static void main(String[] args) {
        long[][] w = {{1, 2, 3}, {4, 5, 6}};
        System.out.println(solve(w));
    }
}
```

**Python.**
```python
def max_independent_set(w):
    n = len(w)
    if n == 0:
        return 0
    m = len(w[0])
    full = 1 << m
    NEG = float("-inf")
    dp = [NEG] * full
    dp[0] = 0
    for r in range(n):
        for c in range(m):
            ndp = [NEG] * full
            bit = 1 << c
            leftbit = 1 << (c - 1) if c > 0 else 0
            for mask in range(full):
                if dp[mask] == NEG:
                    continue
                t = mask & ~bit                      # skip
                if dp[mask] > ndp[t]:
                    ndp[t] = dp[mask]
                if not (mask & bit) and (c == 0 or not (mask & leftbit)):
                    t2 = mask | bit                  # select
                    cand = dp[mask] + w[r][c]
                    if cand > ndp[t2]:
                        ndp[t2] = cand
            dp = ndp
    return max(dp)


if __name__ == "__main__":
    print(max_independent_set([[1, 2, 3], [4, 5, 6]]))
```

---

### Challenge 4: Domino Tilings for Astronomically Large n via Transfer Matrix

**Problem.** Given a tiny fixed `m` (e.g. `m ≤ 5`) and an astronomically large `n` (up to `10^18`), count domino tilings of `n × m` mod `10^9 + 7` using transfer-matrix exponentiation.

**Approach.** Build `T[next][mask]` = ways a row with incoming occupancy `mask` produces outgoing `next`, by a column recursion. Then the answer is `(T^n)[0][0]`.

**Python.**
```python
MOD = 1_000_000_007


def build_T(m):
    full = 1 << m
    T = [[0] * full for _ in range(full)]

    def fill(mask, col, cur, nxt):
        if col == m:
            T[nxt][mask] += 1
            return
        if (mask >> col) & 1 or (cur >> col) & 1:
            fill(mask, col + 1, cur, nxt)
        else:
            fill(mask, col + 1, cur | (1 << col), nxt | (1 << col))   # vertical
            if col + 1 < m and not ((mask >> (col + 1)) & 1) and not ((cur >> (col + 1)) & 1):
                fill(mask, col + 1, cur | (1 << col) | (1 << (col + 1)), nxt)  # horizontal

    for mask in range(full):
        fill(mask, 0, 0, 0)
    return T


def mat_mul(a, b):
    n = len(a)
    c = [[0] * n for _ in range(n)]
    for i in range(n):
        ai = a[i]
        ci = c[i]
        for t in range(n):
            if ai[t]:
                ait, bt = ai[t], b[t]
                for j in range(n):
                    ci[j] = (ci[j] + ait * bt[j]) % MOD
    return c


def mat_pow(a, k):
    n = len(a)
    r = [[1 if i == j else 0 for j in range(n)] for i in range(n)]
    while k > 0:
        if k & 1:
            r = mat_mul(r, a)
        a = mat_mul(a, a)
        k >>= 1
    return r


def count_large_n(m, n):
    if (m * n) % 2 != 0:
        return 0
    T = build_T(m)
    Tn = mat_pow(T, n)
    return Tn[0][0]


if __name__ == "__main__":
    print(count_large_n(2, 8))            # F(9) = 34
    print(count_large_n(3, 4))            # 3x4 ... matches sweep
    print(count_large_n(2, 1_000_000_000))  # huge n, instant
```

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

var M, FULL int
var T [][]int64

func fill(mask, col, cur, nxt int) {
	if col == M {
		T[nxt][mask]++
		return
	}
	if (mask>>col)&1 == 1 || (cur>>col)&1 == 1 {
		fill(mask, col+1, cur, nxt)
	} else {
		fill(mask, col+1, cur|(1<<col), nxt|(1<<col))
		if col+1 < M && (mask>>(col+1))&1 == 0 && (cur>>(col+1))&1 == 0 {
			fill(mask, col+1, cur|(1<<col)|(1<<(col+1)), nxt)
		}
	}
}

func mul(a, b [][]int64) [][]int64 {
	c := make([][]int64, FULL)
	for i := range c {
		c[i] = make([]int64, FULL)
		for t := 0; t < FULL; t++ {
			if a[i][t] == 0 {
				continue
			}
			for j := 0; j < FULL; j++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func matPow(a [][]int64, k int64) [][]int64 {
	r := make([][]int64, FULL)
	for i := range r {
		r[i] = make([]int64, FULL)
		r[i][i] = 1
	}
	for k > 0 {
		if k&1 == 1 {
			r = mul(r, a)
		}
		a = mul(a, a)
		k >>= 1
	}
	return r
}

func countLargeN(m int, n int64) int64 {
	if (int64(m)*n)%2 != 0 {
		return 0
	}
	M = m
	FULL = 1 << m
	T = make([][]int64, FULL)
	for i := range T {
		T[i] = make([]int64, FULL)
	}
	for mask := 0; mask < FULL; mask++ {
		fill(mask, 0, 0, 0)
	}
	return matPow(T, n)[0][0]
}

func main() {
	fmt.Println(countLargeN(2, 8))            // 34
	fmt.Println(countLargeN(2, 1_000_000_000)) // instant
}
```

**Java.**
```java
public class LargeNTiling {
    static final long MOD = 1_000_000_007L;
    static int M, FULL;
    static long[][] T;

    static void fill(int mask, int col, int cur, int nxt) {
        if (col == M) { T[nxt][mask]++; return; }
        if (((mask >> col) & 1) != 0 || ((cur >> col) & 1) != 0) {
            fill(mask, col + 1, cur, nxt);
        } else {
            fill(mask, col + 1, cur | (1 << col), nxt | (1 << col));
            if (col + 1 < M && ((mask >> (col + 1)) & 1) == 0 && ((cur >> (col + 1)) & 1) == 0)
                fill(mask, col + 1, cur | (1 << col) | (1 << (col + 1)), nxt);
        }
    }

    static long[][] mul(long[][] a, long[][] b) {
        long[][] c = new long[FULL][FULL];
        for (int i = 0; i < FULL; i++)
            for (int t = 0; t < FULL; t++) {
                if (a[i][t] == 0) continue;
                long ait = a[i][t];
                for (int j = 0; j < FULL; j++)
                    c[i][j] = (c[i][j] + ait * b[t][j]) % MOD;
            }
        return c;
    }

    static long[][] matPow(long[][] a, long k) {
        long[][] r = new long[FULL][FULL];
        for (int i = 0; i < FULL; i++) r[i][i] = 1;
        while (k > 0) {
            if ((k & 1) == 1) r = mul(r, a);
            a = mul(a, a);
            k >>= 1;
        }
        return r;
    }

    static long count(int m, long n) {
        if (((long) m * n) % 2 != 0) return 0;
        M = m; FULL = 1 << m; T = new long[FULL][FULL];
        for (int mask = 0; mask < FULL; mask++) fill(mask, 0, 0, 0);
        return matPow(T, n)[0][0];
    }

    public static void main(String[] args) {
        System.out.println(count(2, 8));             // 34
        System.out.println(count(2, 1_000_000_000L)); // instant
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Sweep the grid cell by cell, carry an `m`-bit frontier mask; at a free cell branch into vertical / horizontal; cost `O(n·m·2^m)`."*
- Immediately flag the two gotchas: **rotate so `m` is the narrow dimension** and **take the count mod `p`**.
- If asked for max-weight or feasibility instead of counting, reach for the **semiring swap** — same sweep, `(max,+)` or `(OR,AND)` combine.
- For astronomically large `n` with tiny `m`, mention the **transfer-matrix exponentiation** (`O(8^m log n)`); for both-large planar grids, mention the **Kasteleyn Pfaffian** (`O((nm)^3)`).
- Always offer to verify against a brute-force backtracking oracle on small grids, plus the Fibonacci `2×n` and `8×8 = 12988816` anchors.
