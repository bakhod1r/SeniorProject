# Bitmask DP (DP over Subsets) — Senior Level

> Bitmask DP is a precision instrument with a hard physical limit: the table has `2^n` entries, so every byte per entry and every factor of `n` in the transition is multiplied by an exponential. At the senior level the questions are no longer "what is the recurrence" but "is `n` small enough to even attempt this, what breaks when it isn't, and what do I reach for instead (branch-and-bound, meet-in-the-middle, broken-profile, polynomial special cases)?"

## Table of Contents
1. [Introduction](#1-introduction)
2. [The 2^n Memory Wall](#2-the-2n-memory-wall)
3. [Feasibility: When Bitmask DP Is the Right Tool](#3-feasibility-when-bitmask-dp-is-the-right-tool)
4. [Alternatives When n Is Too Large](#4-alternatives-when-n-is-too-large)
5. [Profile / Broken-Profile DP](#5-profile--broken-profile-dp)
6. [Top-Down vs Bottom-Up at Scale](#6-top-down-vs-bottom-up-at-scale)
7. [Performance Engineering](#7-performance-engineering)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Production Case Studies](#11-production-case-studies)
12. [Summary](#12-summary)

---

## 1. Introduction

Senior-level bitmask DP usually shows up in three guises that share one engine — a table indexed by a subset of a small ground set:

1. **Exact optimisation on a small set** — TSP, scheduling on identical machines, minimum-cost assignment, partition into balanced groups. The answer must be optimal; `n` is small by problem design or by aggressive state minimisation.
2. **Exact counting on a small set** — count Hamiltonian paths, count perfect matchings (the permanent), count valid partitions. Same DP, summing semiring, taken mod a prime.
3. **Grid / profile DP** — tilings, broken-profile DP, where the "subset" is the *frontier* of a partially filled grid (one bit per column).

All three reduce to: define a state that is (a subset) possibly times (a tiny extra coordinate), bound `|states| = 2^n · poly`, fill in dependency order, and read the answer. The senior decisions are: *how to keep `n` (the mask width) small, how to keep memory under the `2^n` wall, how to fall back when `n` is too large, and how to verify when the table is too big to inspect.*

This document treats those four decisions in production terms.

---

## 2. The 2^n Memory Wall

### 2.1 The arithmetic of the wall

The table has `2^n` entries (times a small factor for an extra coordinate like `last`). Memory per problem, with an 8-byte cell:

| `n` | `2^n` | `dp[mask]` (8 B) | `dp[mask][last]` (8 B · n) |
|-----|-------|------------------|----------------------------|
| 16 | 65 536 | 0.5 MB | 8 MB |
| 18 | 262 144 | 2 MB | 38 MB |
| 20 | 1 048 576 | 8 MB | 168 MB |
| 22 | 4 194 304 | 34 MB | 740 MB |
| 24 | 16 777 216 | 134 MB | 3.2 GB |
| 26 | 67 108 864 | 537 MB | 14 GB |

The `dp[mask][last]` column shows why `n ≈ 20` is the practical TSP ceiling and `n ≈ 24` the ceiling for one-dimensional `dp[mask]` — memory fails before patience does. *Time* (`2^n · n^2`) is roughly the same ceiling, so the two constraints bind together.

### 2.2 Shrinking the cell

- **Narrower integers.** If costs fit in 32 bits, use `int32`/`int` not `int64` — halves the table.
- **Counting mod a 31-bit prime** fits in 32 bits; no need for 64-bit cells.
- **Bitset for feasibility** (`dp[mask] ∈ {0,1}`) packs 64 masks per machine word — a 64× memory cut for reachability-style DPs.
- **Drop a dimension** (Section 3): assignment needs only `dp[mask]`, not `dp[mask][worker]`, because the worker is `popcount(mask)`.

### 2.3 Shrinking the mask width

The lever with the biggest payoff is reducing `n` itself, since it sits in the exponent:

- **Fix symmetric coordinates.** TSP can pin the start city, removing the rotational degree of freedom (a factor of `n`, not of `2^n`, but free).
- **Component decomposition.** If the ground set splits into independent components, run the DP per component over a smaller mask each — `2^{n1} + 2^{n2}` instead of `2^{n1+n2}`.
- **Meet-in-the-middle.** Split `n` items into two halves of `n/2`; enumerate `2^{n/2}` on each side and combine — turns `2^n` into `~2^{n/2}` for problems that admit it (Section 4).

### 2.4 Iterative deepening / on-the-fly states

When most masks are unreachable (sparse state space, e.g. graphs with few edges), a hash map keyed by reachable masks beats a dense `2^n` array. The trade-off is constant-factor overhead per access; use it only when the reachable fraction is small (say < 1–2%).

---

## 3. Feasibility: When Bitmask DP Is the Right Tool

### 3.1 The decision checklist

Before writing a bitmask DP, confirm:

1. **`n ≤ ~20`** (for `2^n · n^2`) or **`n ≤ ~24`** (for `2^n`). If `n` is larger and cannot be minimised, stop — choose an alternative (Section 4).
2. **The state is genuinely a subset of a small set** — "which items are chosen/visited/covered." If the natural state needs to remember an *ordering* beyond "current element," the state is bigger than a subset and `2^n` understates it.
3. **The transition is local** — extend by one element, or split into a submask plus the rest. If you must remember unbounded history, bitmask DP does not apply (this is exactly the walks-vs-simple-paths boundary from graph theory: the simple-path constraint forces the visited-set state).
4. **Optimal substructure holds** — the best answer for `mask` is built from best answers for sub-states. For min/sum/OR semirings this is automatic.

### 3.2 Recognising the disguises

Senior practice is recognising that a problem *is* a subset DP even when phrased differently:

- "Schedule `n` jobs on machines minimising makespan, `n ≤ 16`" → partition `mask` into machine-loads, `O(3^n)` submask DP.
- "Cheapest way to cover all `m` requirements using items, each item covers a set" → set cover, `dp[coveredMask]`, `O(2^m · #items)`.
- "Count ways to tile / arrange in a grid with `≤ ~14` columns" → broken-profile DP, mask = column frontier (Section 5).
- "Minimum cost to pair up `2k` points" → min-cost matching, `dp[mask]` pairing the lowest unset bit with a partner.

### 3.3 When it is the wrong tool (even for small n)

- A **polynomial algorithm exists**: min-cost perfect matching on large `n` is Hungarian `O(n^3)`; MST, shortest paths, max-flow all have polynomial solutions — do not force a `2^n` DP.
- The problem wants an **approximate / heuristic** answer at scale (real-world TSP with thousands of cities) → Lin-Kernighan, Christofides, OR-tools, not Held-Karp.
- `n` is small but there are **many independent instances**; sometimes batching or a closed form beats re-running an exponential DP per instance.

---

## 4. Alternatives When n Is Too Large

### 4.1 Branch-and-bound

For TSP with `n` in the 20s–40s, exact branch-and-bound with a good lower bound (e.g. the 1-tree / Held-Karp lower bound, or a reduced-cost-matrix bound) routinely solves instances that `2^n` DP cannot fit in memory. It explores a search tree, pruning subtrees whose lower bound exceeds the best tour found. Worst case is still exponential, but typical instances are solved far faster, and memory is `O(n)` not `O(2^n)`. The bitmask DP's `O(2^n)` is a *guaranteed* bound; branch-and-bound trades the guarantee for usually-better behaviour and tiny memory.

### 4.2 Meet-in-the-middle (MITM)

When the problem decomposes into two independent halves, enumerate `2^{n/2}` partial solutions per half, sort/hash one side, and combine in `O(2^{n/2} · poly)`. Classic for subset-sum / partition (`2^{n/2}` instead of `2^n` — `n` up to ~40), and for some path problems where the meeting point is a fixed midpoint. MITM does not apply to general TSP (the halves are not independent), but it is the first thing to try when `2^n` is just out of reach and the structure permits a split.

### 4.3 Polynomial special cases

If the cost structure is special, a polynomial algorithm may exist: TSP on a tree is trivial; on points in convex position it is the convex hull; bitonic TSP is `O(n^2)` DP; assignment is `O(n^3)` Hungarian. Always check whether the instance has exploitable structure before committing to exponential time.

### 4.4 Approximation and heuristics

For metric TSP, Christofides gives a `1.5`-approximation in polynomial time; nearest-neighbour + 2-opt/Lin-Kernighan gives excellent practical tours. When optimality is not required, these scale to millions of cities. The senior judgement call is *whether the application needs the exact optimum* — if not, an exponential exact algorithm is the wrong investment.

### 4.5 The decision table

| Situation | Tool | Cost |
|-----------|------|------|
| Exact, `n ≤ ~20`, subset state | bitmask DP | `O(2^n · n^2)` time, `O(2^n · n)` memory |
| Exact, `n` in 20s–40s, good bound | branch-and-bound | exponential worst case, `O(n)` memory |
| Exact, splits into 2 halves | meet-in-the-middle | `~O(2^{n/2})` |
| Polynomial structure present | the specialised poly algorithm | `O(n^3)` or better |
| Approximate ok, huge `n` | Christofides / LK heuristics | polynomial |
| Min-cost matching, large `n` | Hungarian | `O(n^3)` |

---

## 5. Profile / Broken-Profile DP

A specialised but production-relevant member of the family: **profile DP** for filling grids (tilings, placements). Here the bitmask is not a subset of objects but the **frontier** of a partially filled grid — one bit per column indicating whether that cell is already occupied by a piece protruding from the previous row.

- **Broken-profile (plug) DP** processes the grid **cell by cell** (not row by row), carrying a mask of the `m`-cell frontier between the last filled cell and the wrap-around. State is `dp[cellIndex][profileMask]`, transitions decide what piece covers the current cell. Width `m ≤ ~14–16` keeps `2^m` tractable.
- Classic problems: count domino/tromino tilings of an `m × k` board, count ways to fill with given pieces, minimum broken cells. The grid height `k` can be large (it is just the layer count, `O(k · 2^m · transitions)`); only the *width* `m` sits in the exponent.

The senior insight: choose the smaller dimension as the profile width. A `100 × 12` board is `O(100 · 2^{12})`, but transposed to `12 × 100` it would be `O(12 · 2^{100})` — infeasible. **Always make the narrow dimension the mask.** Broken-profile DP additionally only needs `O(2^m)` memory (two rolling layers), independent of `k`.

### 5.1 Row-profile vs broken-profile

Two common framings:

- **Row profile (simpler).** Process the grid one full **row** at a time. The mask is the set of columns occupied in the next row by vertical pieces protruding from the current row. The transition enumerates compatible pairs of (current-row mask, next-row mask), often with a recursion that lays horizontal pieces within a row. Cost `O(rows · 2^{2m})` in the naive pairing, reducible to `O(rows · 3^m)` by laying pieces left-to-right.
- **Broken profile (plug DP, finer).** Process **cell by cell**, so the mask straddles the boundary between filled and unfilled cells (the "broken" frontier). State is `O(2^m)` and each cell has a constant number of transitions, giving `O(rows · cols · 2^m)` — usually the better constant, and the right tool when pieces are irregular (L-trominoes, polyominoes) where whole-row pairing is awkward.

For dominoes either works; for richer tile sets the broken-profile variant generalises more cleanly because the local decision at each cell is small and explicit.

### 5.2 When the profile itself needs more than one bit per column

If a cell can be in more than two states (empty / filled is two — but "filled by piece type A vs B" is three), the profile becomes a base-`b` number, not a bitmask, with `b^m` states. The same DP runs; you just trade the cheap bit operations for base-`b` digit extraction. This still lives in the bitmask-DP family conceptually, but the `2^m` becomes `b^m` and the width ceiling drops accordingly. Recognising when two bits per column are genuinely needed (vs an over-modelled state) is a senior judgement call — over-modelling silently blows the exponent.

---

## 6. Top-Down vs Bottom-Up at Scale

Both fill the same `2^n`-sized table; the choice affects constant factors, memory access, and which states get touched.

### 6.1 Bottom-up (iterative over masks)

Loop `for mask in 0 .. 2^n−1`, updating in dependency order. Advantages: no recursion overhead, predictable memory access, trivially parallelisable across same-popcount masks, and *every* state is computed whether or not it is reachable. Disadvantage: it computes unreachable states too — wasteful on sparse graphs where most masks never occur.

### 6.2 Top-down (memoised recursion)

Recurse on `(mask, last)`, caching results. Advantages: only **reachable** states are ever computed — a large saving when the graph is sparse (a path graph reaches `O(n^2)` states, not `2^n`). Disadvantages: recursion stack depth `O(n)`, hash-map or array-cache overhead, and worse cache locality. The deep insight: *top-down naturally prunes unreachable states; bottom-up does not.* On a complete graph they touch the same states and bottom-up wins on constants; on a sparse graph top-down can be dramatically faster because it follows only real edges.

### 6.3 The hybrid: reachable-set BFS over masks

A middle ground processes masks in BFS/popcount layers but maintains an explicit *reachable set* (a hash set or a bitset of seen masks), expanding only from reachable states. This keeps bottom-up's cache behaviour while gaining top-down's pruning. Use it when the reachable fraction is moderate (a few percent) — too sparse and a plain hash-map memoisation is simpler; too dense and the dense array wins.

### 6.4 Recursion-depth and stack safety

Top-down Held-Karp recurses to depth `n` (one frame per city added). For `n ≤ 20` this is harmless, but in languages with small default stacks (or when wrapping the DP in a larger recursive solver) prefer an explicit stack or the iterative form. The memoisation cache should be a dense `2^n · n` array when the graph is dense, and a hash map only when you have measured that the reachable fraction is small — a hash map's per-access overhead can erase the pruning win on dense inputs.

---

## 7. Performance Engineering

### 7.1 Memory layout dominates

The `2^n` table is large and accessed in mask order; locality matters:

- **Flat 1D array** indexed `mask * n + last` (row-major in `last`) so the inner `last`/`prev` loops stream contiguously.
- **Rolling layers by popcount** are *not* generally possible (a mask's dependencies are scattered across all lower popcounts), but for problems where transitions only add one bit you can still benefit from processing masks grouped by popcount for cache warmth.
- **Avoid per-mask allocation.** Preallocate the whole `dp` once; never allocate inside the mask loop.

### 7.2 Pruning and early exit

- **Skip `INF` / zero states** before the inner loop — they cannot extend anything.
- **Require `last ∈ mask`** and `next ∉ mask` with cheap bit tests, before touching the cost matrix.
- **Reachability pruning:** if the graph is sparse, precompute adjacency bitmasks `adj[i]` so "neighbours of `i` not yet visited" is `adj[i] & ~mask`, iterated by peeling low bits — skips the dense `for next` scan entirely.

### 7.3 Bit-parallel transitions

Iterate only the *valid* next elements using bit tricks instead of a full `0..n` scan:

```
cands := adj[last] & ^mask          // unvisited neighbours of `last`
for cands != 0 {
    next := bits.TrailingZeros(cands)
    cands &= cands - 1              // clear that bit
    ...
}
```

On sparse graphs this turns the inner `O(n)` scan into `O(degree)`.

### 7.4 Parallelism

The mask loop has scattered dependencies, but masks of the *same popcount* are independent of each other (each depends only on lower-popcount masks). So you can parallelise across all masks with a given popcount, syncing between popcount layers. The submask DP parallelises per outer `mask`. Counting under multiple CRT primes is embarrassingly parallel across primes.

---

## 8. Code Examples

### 8.1 Go — Held-Karp with adjacency-bitmask pruning and a flat table

```go
package main

import (
	"fmt"
	"math/bits"
)

const INF = 1 << 30

// tspPruned: Held-Karp using neighbour bitmasks to skip non-edges.
// dist[i][j] == INF means "no edge". Flat dp indexed mask*n+last.
func tspPruned(dist [][]int, adj []uint) int {
	n := len(dist)
	if n == 1 {
		return 0
	}
	full := (1 << n) - 1
	dp := make([]int, (1<<n)*n)
	for i := range dp {
		dp[i] = INF
	}
	dp[(1<<0)*n+0] = 0

	for mask := 0; mask <= full; mask++ {
		for last := 0; last < n; last++ {
			cur := dp[mask*n+last]
			if cur == INF || mask&(1<<last) == 0 {
				continue
			}
			cands := adj[last] & ^uint(mask) // unvisited neighbours of last
			for cands != 0 {
				next := bits.TrailingZeros(cands)
				cands &= cands - 1
				nm := mask | (1 << next)
				if c := cur + dist[last][next]; c < dp[nm*n+next] {
					dp[nm*n+next] = c
				}
			}
		}
	}
	best := INF
	for last := 1; last < n; last++ {
		v := dp[full*n+last]
		if v != INF && dist[last][0] != INF && v+dist[last][0] < best {
			best = v + dist[last][0]
		}
	}
	return best
}

func main() {
	dist := [][]int{{0, 10, 15}, {10, 0, 20}, {15, 20, 0}}
	adj := []uint{0b110, 0b101, 0b011} // every pair adjacent here
	fmt.Println(tspPruned(dist, adj)) // 45
}
```

### 8.2 Java — counting under two CRT primes (exact large counts)

```java
public class CountTwoPrimes {
    static long countMod(int[][] adj, long mod) {
        int n = adj.length, full = (1 << n) - 1;
        long[][] dp = new long[1 << n][n];
        for (int s = 0; s < n; s++) dp[1 << s][s] = 1 % mod;
        for (int mask = 0; mask <= full; mask++)
            for (int last = 0; last < n; last++) {
                long cur = dp[mask][last];
                if (cur == 0 || (mask & (1 << last)) == 0) continue;
                for (int nxt = 0; nxt < n; nxt++) {
                    if ((mask & (1 << nxt)) != 0 || adj[last][nxt] == 0) continue;
                    int nm = mask | (1 << nxt);
                    dp[nm][nxt] = (dp[nm][nxt] + cur) % mod;
                }
            }
        long total = 0;
        for (int last = 0; last < n; last++) total = (total + dp[full][last]) % mod;
        return total;
    }

    public static void main(String[] args) {
        int[][] adj = {{0, 1, 1}, {1, 0, 1}, {1, 1, 0}};
        long[] primes = {1_000_000_007L, 998_244_353L};
        for (long p : primes)
            System.out.println("mod " + p + ": " + countMod(adj, p));
        // Combine via CRT if the true count may exceed one prime.
    }
}
```

### 8.3 Python — broken-profile DP (count domino tilings of m x k)

```python
def count_tilings(m, k):
    """Count ways to tile an m-row by k-column board with 1x2 dominoes.
    Profile = bitmask of which cells in the current column stick into the next.
    m (the narrow dimension) is the mask width."""
    full = (1 << m) - 1
    # dp over columns; state = profile mask carried to the next column
    dp = [0] * (1 << m)
    dp[0] = 1
    for _ in range(k):
        ndp = [0] * (1 << m)
        for profile in range(1 << m):
            if dp[profile] == 0:
                continue
            # fill current column given `profile` of cells already occupied
            _fill(0, profile, 0, dp[profile], m, ndp)
        dp = ndp
    return dp[0]


def _fill(row, profile, nextProfile, ways, m, ndp):
    if row == m:
        ndp[nextProfile] += ways
        return
    if profile & (1 << row):
        # already occupied by a horizontal domino from previous column
        _fill(row + 1, profile, nextProfile, ways, m, ndp)
    else:
        # place a horizontal domino: occupies this cell and protrudes right
        _fill(row + 1, profile, nextProfile | (1 << row), ways, m, ndp)
        # place a vertical domino: needs the next row free in this column
        if row + 1 < m and not (profile & (1 << (row + 1))):
            _fill(row + 2, profile, nextProfile, ways, m, ndp)


if __name__ == "__main__":
    print(count_tilings(2, 3))  # 3
    print(count_tilings(4, 4))  # 36
```

### 8.4 Go — top-down memoised Held-Karp (prunes unreachable states)

```go
package main

import "fmt"

const INF = 1 << 30

type solver struct {
	n     int
	dist  [][]int
	memo  [][]int
	seen  [][]bool
}

// solve returns the cheapest path visiting exactly `mask`, ending at `last`.
func (s *solver) solve(mask, last int) int {
	if mask == (1<<0) && last == 0 {
		return 0 // base case
	}
	if !(mask&(1<<last) != 0) || mask&1 == 0 {
		return INF // last must be in mask; city 0 always in mask
	}
	if s.seen[mask][last] {
		return s.memo[mask][last]
	}
	s.seen[mask][last] = true
	prevMask := mask ^ (1 << last)
	best := INF
	for prev := 0; prev < s.n; prev++ {
		if prevMask&(1<<prev) == 0 {
			continue
		}
		sub := s.solve(prevMask, prev)
		if sub != INF && sub+s.dist[prev][last] < best {
			best = sub + s.dist[prev][last]
		}
	}
	s.memo[mask][last] = best
	return best
}

func tspTopDown(dist [][]int) int {
	n := len(dist)
	if n == 1 {
		return 0
	}
	full := (1 << n) - 1
	s := &solver{n: n, dist: dist}
	s.memo = make([][]int, 1<<n)
	s.seen = make([][]bool, 1<<n)
	for i := range s.memo {
		s.memo[i] = make([]int, n)
		s.seen[i] = make([]bool, n)
	}
	best := INF
	for last := 1; last < n; last++ {
		v := s.solve(full, last)
		if v != INF && v+dist[last][0] < best {
			best = v + dist[last][0]
		}
	}
	return best
}

func main() {
	dist := [][]int{{0, 10, 15}, {10, 0, 20}, {15, 20, 0}}
	fmt.Println(tspTopDown(dist)) // 45
}
```

The top-down version only recurses into states it actually needs; on a sparse graph (where `prevMask` rarely has all bits) this touches far fewer than `2^n · n` states. On a complete graph it touches the same states as bottom-up but pays recursion overhead — so choose by graph density.

---

## 9. Observability and Testing

A bitmask DP result is opaque — one wrong cell looks like any other number. Build in checks from the start.

| Check | Why |
|-------|-----|
| Brute-force oracle on small `n` | Permutations for TSP/Hamiltonian, all matchings for assignment, all partitions for grouping. Catches the dominant bug class. |
| `n = 1` and empty-set base case | Confirms base initialisation (`dp[1<<0][0]=0`, `dp[0]=0`). |
| Symmetry sanity (symmetric `dist`) | Tour cost must be invariant under reversing the tour. |
| Counting parity / known formula | Domino tilings of `2×k` are Fibonacci-like; assert against the closed form. |
| Determinism across languages | Same seed → identical Go/Java/Python outputs. |
| Memory guard | Assert `n ≤ NMAX` before allocating `2^n` — fail fast, not OOM. |

The single most valuable test is the **brute-force oracle**: recompute the answer the obvious exponential way for `n ≤ 8`, compare exactly. It catches the off-by-one (return edge), the uninitialised `dp`, and the wrong membership test that together account for nearly every real bug.

### 9.1 Property-test battery

```text
for random small instance (n <= 8):
    assert bitmaskDP(instance) == bruteforce(instance)         # the oracle
    assert dp base case set correctly (dp[1<<start][start]==0)
    assert symmetric dist => cost(tour) == cost(reverse(tour))
for counting variant:
    assert count mod p1 and mod p2 are consistent with brute count
    assert empty graph => 0 Hamiltonian paths for n >= 2
```

### 9.2 Production guardrails

For a service running subset DPs: an **`n`-cap validator** (reject inputs with `n > NMAX` rather than OOM), a **memory estimate** logged before allocation (`2^n · cellBytes`), and a **timeout** since worst-case time is exponential. For counting services add a **magnitude estimate** so an anomalous count stands out.

---

## 10. Failure Modes

### 10.1 OOM from the 2^n wall
Allocating `dp` for `n` past the ceiling exhausts memory. Mitigation: validate `n ≤ NMAX` up front; estimate `2^n · cellBytes` and reject early; consider MITM / branch-and-bound instead.

### 10.2 Uninitialised or wrongly initialised table
Leaving `dp` at zero makes every state look free (for min) or empty (for count). Mitigation: fill with `INF` (min) or `0` with explicit base cases (count); unit-test the base case.

### 10.3 Wrong membership / bit operator
`mask & i` instead of `mask & (1 << i)`, or `|` where `^` was meant, silently corrupts. Mitigation: centralise bit ops in named helpers; test on a 3-bit example by hand.

### 10.4 Return-edge off-by-one
Tour vs path differ only in adding `dist[last][0]`. Using the wrong one passes structural tests but fails on real expected outputs. Mitigation: name the variant in code; oracle on a known small tour.

### 10.5 Overflow
`INF + cost` wrapping, or counts exceeding the integer type. Mitigation: skip `INF` states before adding; reduce counts mod a prime; size `INF` so `INF + maxEdge` cannot overflow.

### 10.6 Submask loop bugs
Forgetting `& mask` (visits invalid submasks) or `while sub > 0` dropping the empty submask. Mitigation: use the canonical idiom; decide explicitly whether the empty submask is a valid case.

### 10.7 Profile-DP wrong axis
Choosing the wide dimension as the mask makes `2^m` explode. Mitigation: always make the **narrow** dimension the profile width; assert `m ≤ ~16`.

### 10.8 Mistaking it for a polynomial problem
Forcing `2^n` DP where Hungarian / shortest-path / MST solves it in polynomial time. Mitigation: before reaching for bitmask DP, ask whether a known polynomial algorithm fits — exponential time should be a last resort, not a reflex.

---

## 11. Production Case Studies

### 11.1 Last-mile delivery routing

A courier service optimises the visiting order for each driver's daily stops. Stops per route are deliberately capped (e.g. ≤ 16) so Held-Karp gives the *exact* optimal sub-route in milliseconds, while a higher-level heuristic clusters stops into routes. The architecture decision is the cap: above ~18 stops the team falls back to Lin-Kernighan with a 2-opt polish, accepting near-optimal. The bitmask DP is reserved for the small, exactness-critical inner problem — a textbook "exact core, heuristic shell" split.

### 11.2 Manufacturing job assignment

A factory assigns `n` jobs to `n` stations with station-specific setup costs. With `n ≤ 14`, the `dp[mask]` assignment DP (`O(2^n n)`) runs faster to *implement and audit* than wiring up a Hungarian solver, and the cost matrix changes every shift so the simplicity pays off. The team validates each run against a brute-force matching on the previous shift's smaller data, catching a cost-matrix transposition bug that the algebraic tests missed — the recurring lesson that the brute-force oracle on real inputs beats synthetic property tests.

### 11.3 Tiling / panel-cutting estimator

A fabrication shop estimates how many ways a fixed-width panel can be cut into standard pieces — a broken-profile DP with the *width* (≤ 12 slots) as the mask and the *length* (hundreds of units) as the rolling layer. Because the length is large and the width small, the `O(length · 2^{width})` sweep is fast and uses `O(2^{width})` memory. When a marketing page needed counts for very long panels, the team swapped the sweep for transfer-matrix exponentiation (`O(2^{3·width} log length)`), reusing the same per-column transition matrix — the bridge to fast matrix exponentiation described in [`professional.md`](./professional.md).

### 11.4 The recurring architectural pattern

Across these, the senior pattern is identical: **isolate a small, exactness-critical subset problem, solve it with bitmask DP under a hard `n`-cap, and wrap it in a heuristic or decomposition for the large-scale structure.** The cap is a first-class design parameter (logged, alerted on, and enforced by an input validator), and the brute-force oracle on real historical inputs is the production safety net.

---

## 12. Summary

- The `2^n` table is the defining constraint: `n ≤ ~20` for `2^n · n^2` (TSP), `n ≤ ~24` for `2^n` (assignment/partition). Memory and time bind together at roughly the same ceiling.
- Shrink the exponent before shrinking the cell: minimise the mask width (fix symmetric coordinates, decompose components, meet-in-the-middle), then narrow the cell (32-bit, bitset for feasibility, drop implied dimensions).
- Feasibility checklist: `n` small, state genuinely a subset, transition local, optimal substructure. If any fails — especially if `n` is too large or the state needs unbounded history — choose an alternative.
- Alternatives: **branch-and-bound** (exact, `O(n)` memory, usually fast) for moderate `n`; **meet-in-the-middle** (`~2^{n/2}`) when the problem splits; polynomial special cases (Hungarian, bitonic TSP); approximation (Christofides, Lin-Kernighan) when optimality is not required.
- **Profile / broken-profile DP** uses the grid *frontier* as the mask; always make the narrow dimension the profile width, giving `O(k · 2^m)` with `O(2^m)` memory.
- Performance lives in the table: flat layout, skip dead states, adjacency-bitmask pruning to iterate only valid transitions, parallelise across same-popcount masks and across CRT primes.
- Always keep a brute-force oracle; it catches the return-edge off-by-one, the uninitialised table, and the wrong bit test that account for nearly every real bug.

### Decision summary

- **Exact, small `n`, subset state** → bitmask DP (`O(2^n · n^2)`), CRT primes for exact large counts.
- **Exact, moderate `n`, good bound** → branch-and-bound.
- **Splits into halves** → meet-in-the-middle.
- **Polynomial structure** → the specialised algorithm (Hungarian, bitonic, tree TSP).
- **Grid filling, narrow width** → broken-profile DP.
- **Huge `n`, approximate ok** → Christofides / Lin-Kernighan.
- **Large `n`, optimal required, no structure** → likely intractable; reset expectations.

References to study further: Held-Karp (1962), branch-and-bound for TSP (Little et al. 1963), Held-Karp 1-tree lower bound, meet-in-the-middle (Horowitz-Sahni 1974), Hungarian algorithm (Kuhn 1955), broken-profile / plug DP, Ryser's formula for the permanent, and sibling DP topics in `13-dynamic-programming`.
