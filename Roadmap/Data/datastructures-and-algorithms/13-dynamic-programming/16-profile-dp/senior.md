# Profile DP / Broken Profile DP (Tiling a Grid with a Frontier Bitmask) — Senior Level

> Profile DP is rarely the bottleneck on a small board — but the moment the narrow dimension `m` creeps toward 18, the long dimension `n` becomes astronomically large, the counts must be exact modulo a prime, or the piece set grows beyond dominoes, every detail (the `2^m` memory wall, transfer-matrix exponentiation for huge `n`, overflow, brute-force validation, and a dozen subtle failure modes) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [The 2^m Memory and Time Wall](#2-the-2m-memory-and-time-wall)
3. [Big n via Transfer-Matrix Exponentiation](#3-big-n-via-transfer-matrix-exponentiation)
4. [Modular Arithmetic and Overflow](#4-modular-arithmetic-and-overflow)
5. [Generalizing the Piece Set and Constraints](#5-generalizing-the-piece-set-and-constraints)
6. [Performance Engineering of the Sweep](#6-performance-engineering-of-the-sweep)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing Against Brute Force](#8-observability-and-testing-against-brute-force)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does the frontier mask work" but "what am I actually modeling, and what breaks when I scale it?". Profile DP shows up in three guises that share one engine:

1. **Counting tilings / packings under a small-width constraint** — dominoes, L-trominoes, polyominoes, on an `n × m` grid where `m` is small and `n` can be large. The answer is exact mod a prime.
2. **Counting grid configurations with local constraints** — independent sets, proper colorings, "no two adjacent X", Ising-like states — anything where a cell's legality depends only on its immediate neighbors, summarizable by a fixed-width frontier.
3. **Astronomically large `n`** — the same row-to-row map iterated `n = 10^18` times, solved by raising the transfer matrix to the `n`-th power.

All three reduce to: *define a frontier whose width is the narrow dimension `m`; sweep, carrying a `2^m`-state mask; for very large `n`, exponentiate the transfer matrix instead of iterating.* The senior decisions are: how to keep `m` small, how to keep the arithmetic exact and overflow-free, how to make the per-cell sweep fast, when to switch to matrix exponentiation, and how to verify when the board is too big to brute-force.

This document treats those decisions in production terms, with the `n × m` domino tiling as the anchor and trominoes / independent sets as the generalizations.

### 1.1 The three decisions that define a profile-DP implementation

Before writing code, a senior engineer settles three things, because each one is a different failure mode if gotten wrong:

1. **Which dimension is `m`?** Always the smaller — cost is exponential in it. This is non-negotiable and worth an assertion.
2. **What does a mask bit mean, and what is the terminal condition?** For domino tilings, bit = "frontier cell covered," terminal `mask = 0`. For independent sets, bit = "selected," terminal = any mask. Mixing these up silently corrupts results.
3. **Which regime are we in — sweep or matrix power?** Typical `n` → sweep; astronomical `n` with tiny `m` → transfer matrix. The wrong choice is either infeasible (iterating `10^18` rows) or wasteful (cubing a huge matrix).

Everything else — overflow handling, buffer reuse, zero-skip — is constant-factor engineering on top of these three decisions.

---

## 2. The 2^m Memory and Time Wall

### 2.1 Where the exponent lives

Time is `O(n · m · 2^m)`; the rolling DP array is `O(2^m)` (two layers). Both are exponential in `m` only. The practical ceiling:

| `m` | `2^m` | rolling array (`int64`) | verdict |
|-----|-------|--------------------------|---------|
| 14 | 16K | 128 KB | comfortable |
| 16 | 64K | 512 KB | fine |
| 18 | 256K | 2 MB | borderline; needs zero-skip + tight inner loop |
| 20 | 1M | 8 MB | usually too slow per cell unless `n` is small |
| 22 | 4M | 32 MB | rarely feasible by sweep; consider other structure |

The lever is **always** to make `m = min(rows, cols)`. A board given as `12 × 10^6` must be processed with `m = 12`, not `m = 10^6`. This single rotation is the difference between `~5·10^7` operations and impossibility.

### 2.2 Reachable masks are sparse

Although there are `2^m` masks, the number *reachable at a given cell* is far smaller — many bit patterns can never arise (e.g., in the broken profile a mask whose set bits would imply an impossible partial cover). The zero-skip (`if dp[mask]==0: continue`) exploits this and is the single most important constant-factor optimization; on real instances it routinely prunes the work by 3–10×. For very tight `m`, store only the reachable masks in a hash map and iterate those, trading array locality for a smaller iteration set.

### 2.3 Memory layout

Use a **flat array** of size `2^m` indexed by the integer mask — no arrays-of-arrays, no maps in the hot loop unless masks are genuinely sparse. Ping-pong two preallocated arrays (`dp`, `ndp`) and zero `ndp` each cell instead of allocating; per-cell allocation is the dominant GC cost at scale.

### 2.4 A capacity-planning worked example

Suppose a service must answer "domino tilings of `n × m`" with `m` ranging up to 16 and `n` up to `10^5`. Worst case `m = 16`: `2^16 = 65536` masks, two rolling layers of `int64` = `2 · 512 KB = 1 MB` — trivially in cache. Time: `n·m·2^m = 10^5 · 16 · 65536 ≈ 1.05 · 10^{11}` raw mask-iterations, but the zero-skip typically prunes reachable masks to a small fraction, bringing real work to `~10^{10}` or less. At `~10^8`–`10^9` ops/sec in a tight Go/Java loop, that is seconds — acceptable for a batch job, marginal for an interactive request. Mitigations if it must be interactive: cap `m` lower (reject `m > 14` to a slower path), precompute results for common `(n,m)`, or switch to the transfer matrix when `n` dominates. The lesson: the `2^m` term sets the *memory* ceiling, but the `n·2^m` product sets the *latency*, and only the zero-skip rescues the realistic case.

---

## 3. Big n via Transfer-Matrix Exponentiation

### 3.1 The row-to-row operator

For fixed small `m`, the full-row profile's transition is a fixed `2^m × 2^m` matrix `T`:

```
T[mask][next_mask] = number of ways to fill a row whose incoming occupancy
                     is `mask`, leaving outgoing occupancy `next_mask`.
```

`T` is built once by the column recursion (middle.md). A tiling of `n` rows is a walk of length `n` from mask `0` to mask `0` in the graph whose adjacency-count matrix is `T`. Hence

```
answer = (T^n)[0][0].
```

### 3.2 Why exponentiation, and its cost

Iterating the row map is `O(n · poly(2^m))`. When `n` is astronomically large (`10^18`), iterate is infeasible, but **binary exponentiation** of `T` gives `T^n` in `O((2^m)^3 · log n) = O(8^m · log n)`. The `n`-dependence collapses from linear to logarithmic. This is exactly sibling topic `11-graphs` `32-paths-fixed-length`: the masks are vertices, `T` is the adjacency-count matrix, tilings are length-`n` walks, and matrix power counts them.

| Regime | Method | Cost |
|--------|--------|------|
| typical `n`, small `m` | broken-profile sweep | `O(n · m · 2^m)` |
| astronomical `n`, tiny `m` | transfer-matrix exponentiation | `O(8^m · log n)` |

The crossover is steep: cubing a `2^m × 2^m` matrix is `8^m`, so exponentiation only pays off when `m` is tiny (say `m ≤ 6–8`, where `8^m ≤ ~16M`) **and** `n` is huge enough that `n · m · 2^m` would not finish. For `m = 2` (the `2 × n` board) `T = [[1,1],[1,0]]` and `T^n` is the Fibonacci matrix — `O(log n)` Fibonacci, a classic.

### 3.3 Reducing the matrix dimension

Only **reachable** masks participate in any walk from `0` back to `0`; pruning unreachable masks shrinks `T` from `2^m` to the number of valid row-occupancy patterns (often much smaller, e.g. for dominoes only masks expressible as a partial vertical-protrusion set). Halving the dimension is an 8× speedup on the cube. Build `T` on the reachable subgraph only.

### 3.4 Closed-form / Kitamasa shortcut for the sequence

When you only need the *sequence* `Z(n, m)` for fixed small `m` (not the full matrix), the row counts obey a linear recurrence of order equal to the degree of `T`'s minimal polynomial on the cyclic subspace from `e_0` — at most `2^m`, usually far fewer after reduction (order 2 for `m=2`, the Fibonacci recurrence). You can then compute `Z(n,m)` by **Kitamasa** (polynomial exponentiation modulo the characteristic polynomial) in `O((deg)² log n)`, beating the `O(8^m log n)` matrix power when the reduced degree is small. In practice: derive the recurrence once (e.g. `Z(3, 2k) = 4·Z(3, 2k−2) − Z(3, 2k−4)`), then iterate it for moderate `n` or Kitamasa it for huge `n`. This is the same matrix-vs-polynomial trade-off as in sibling `11-graphs` `32-paths-fixed-length`.

### 3.4b A worked `m = 3` transfer matrix and its exponentiation

To make the abstract `T` concrete, build it for `m = 3` over the full `2^3 = 8` masks. Bit `c` of an incoming mask means "column `c` of this row is already occupied by a vertical protruding from the row above." Running the column recursion `fill(mask, 0, 0, 0)` for each incoming `mask` produces the outgoing masks (the protrusions this row sends down). The nonzero entries `w(mask, next_mask)` are:

```
incoming 000 (all free):  next ∈ {111 (3 verticals), 100 (h at 0-1, v at 2),
                                   001 (v at 0, h at 1-2), 000 (... not possible: 3 cells
                                   cannot be all-horizontal), }
   careful enumeration for width 3:
     000 -> 111   (v,v,v)
     000 -> 001   (v at col0, horizontal at cols1-2)
     000 -> 100   (horizontal at cols0-1, v at col2)
incoming 001 (col0 occupied): cover cols1,2 -> 110 (v,v) or 000 (horizontal 1-2)
     001 -> 110 ; 001 -> 000
incoming 010 (col1 occupied): cols0,2 free but not adjacent -> both must be vertical
     010 -> 101
incoming 011 (cols0,1 occupied): col2 free -> vertical
     011 -> 100
incoming 100 (col2 occupied): cover cols0,1 -> 011 (v,v) or 000 (horizontal 0-1)
     100 -> 011 ; 100 -> 000
incoming 101 (cols0,2 occupied): col1 free -> vertical
     101 -> 010
incoming 110 (cols1,2 occupied): col0 free -> vertical
     110 -> 001
incoming 111 (all occupied): nothing to place
     111 -> 000
```

Writing `T[next][incoming]` (column = incoming, so the recurrence is `g_{r+1} = T·g_r`) over the order `(000,001,010,011,100,101,110,111)`:

```
        in:  000 001 010 011 100 101 110 111
next 000:  [  0   1   0   0   1   0   0   1 ]
next 001:  [  1   0   0   0   0   0   1   0 ]
next 010:  [  0   0   0   0   0   1   0   0 ]
next 011:  [  0   0   0   0   1   0   0   0 ]
next 100:  [  1   0   0   1   0   0   0   0 ]
next 101:  [  0   0   1   0   0   0   0   0 ]
next 110:  [  0   1   0   0   0   0   0   0 ]
next 111:  [  1   0   0   0   0   0   0   0 ]
```

Iterating `g_{r+1} = T·g_r` from `g_0 = e_{000}` gives the `(T^r)[000][000]` sequence `1, 0, 3, 0, 11, 0, 41, …` — exactly the `3 × n` tiling counts (`0` for odd `r` because `3·r` is odd). Reducing to the reachable masks `{000, 001, 100, 011, 110, 111}` and eliminating the transient odd states yields the order-2 recurrence `Z(r,3) = 4·Z(r-2,3) − Z(r-4,3)`, which `1,3,11,41,153` satisfies (`41 = 4·11 − 3`, `153 = 4·41 − 11`). For astronomical `n` you raise this `8×8` (or pruned `6×6`) `T` to the `n`-th power by binary exponentiation in `O(8^3 log n) = O(512 log n)` operations — `n = 10^{18}` is ~60 multiplies of an `8×8` matrix, microseconds.

### 3.4c Benchmark table: `2^m` state growth across `m = 1..6`

The transfer matrix is `2^m × 2^m`, so cubing it for one squaring step costs `(2^m)^3 = 8^m`. This is the hard ceiling on the matrix-exponentiation regime:

| `m` | `2^m` masks | matrix entries `4^m` | one multiply `8^m` | full `T^n` (`8^m · log₂ n`, `n=10^18`, `log₂n≈60`) | verdict for matrix power |
|-----|-------------|----------------------|---------------------|---------------------------------------------------|--------------------------|
| 1 | 2 | 4 | 8 | ~480 | trivial |
| 2 | 4 | 16 | 64 | ~3.8K | trivial (Fibonacci) |
| 3 | 8 | 64 | 512 | ~31K | trivial |
| 4 | 16 | 256 | 4096 | ~246K | instant |
| 5 | 32 | 1024 | 32768 | ~2.0M | fast |
| 6 | 64 | 4096 | 262144 | ~15.7M | still sub-second |

Beyond `m = 6` the `8^m` cube term dominates: `m = 8` is `8^8 ≈ 1.7·10^7` per multiply (`~10^9` for the full ladder — borderline), and `m = 10` is `8^{10} ≈ 10^9` per multiply, infeasible for repeated squaring. This is why the matrix-power route is reserved for *tiny* `m` and *astronomical* `n`; for everything else the `O(n·m·2^m)` sweep wins because its cost is only *linear* in `2^m`, not cubic. Pruning `T` to reachable masks (Section 3.3) effectively lowers `m` by a bit or two, pushing the feasible ceiling to roughly `m ≤ 8`.

### 3.5 Caching the squaring ladder for batched large-`n` queries

When many queries share `m` but differ in huge `n`, build the squaring ladder `T^{2^0}, T^{2^1}, …, T^{2^{60}}` once (`O(8^m · 60)`), store it read-only, and answer each query by multiplying the ladder entries whose bits are set in that query's `n`. Pushing the row vector `e_0` through the ladder instead of multiplying full matrices drops per-query cost to `O(4^m · popcount(n))`. The ladder is shareable across threads and request handlers; rebuilding it per request is a classic latency and GC regression (Failure Mode 9.7).

---

## 4. Modular Arithmetic and Overflow

### 4.1 Overflow budget

The domino transition has only additions, so in `int64` with `p < 2^31` (e.g. `10^9 + 7`), adding two reduced residues stays below `2^31 < 2^63` — safe. Reduce after each add. For piece sets or weighted variants that **multiply** weights into the transition (e.g. colored tiles), the product of two reduced residues is `< 2^62`; reduce after the multiply or use a 128-bit accumulator with a proven term bound.

### 4.2 Choosing the modulus

| Modulus | Use |
|---------|-----|
| `10^9 + 7`, `998244353` | The problem dictates it; `998244353` is NTT-friendly if polynomial tricks follow. |
| Multiple coprime primes + CRT | When the exact count exceeds one prime's range; run the sweep independently per prime and recombine. |
| `2^64` implicit | When the answer is wanted mod `2^64` — natural `uint64` wraparound, no explicit reduction. |

If the problem wants the **exact** non-modular count and it is huge (tiling counts grow like `λ^(n·m)`), use big integers; each addition then costs `O(digits)` and the timing analysis changes accordingly.

### 4.3 Negative residues

The domino DP is purely additive and non-negative, so negative residues never arise. They can appear in **inclusion-exclusion** variants (e.g. counting tilings avoiding a configuration by subtracting). Normalize with `((x % p) + p) % p` in Go/Java where `%` can return negatives.

### 4.4 Deferred reduction for throughput

Because the domino transition only *adds*, you can defer the `% p` to reduce the number of expensive modulo operations. If each addend is `< p < 2^31`, you can accumulate up to `~2^{32}` of them in an `int64` before overflow, so reducing once every (say) cell rather than every add is safe and faster. For weighted/multiplicative variants the budget shrinks: the product of two residues is `< 2^{62}`, leaving little headroom, so reduce after each multiply or use a 128-bit accumulator with a proven term bound `⌊(2^{63}-1)/(p-1)²⌋`. Measure before micro-optimizing: on many inputs the zero-skip already dominates and the modulo is not the bottleneck.

### 4.5 CRT pipeline for exact large counts

When the exact (non-modular) count is required and exceeds one prime's range (recall the count has `≈ 0.42·nm` bits, Section on growth), run the identical sweep under several coprime primes `p_1, p_2, …` and reconstruct via the Chinese Remainder Theorem. Each prime is an independent full run — embarrassingly parallel across cores or machines:

```
count mod p1 ─┐
count mod p2 ─┼─ CRT ─→ count mod (p1·p2·…)  (= exact, if the product exceeds the true value)
count mod p3 ─┘
```

Estimate the number of primes from the dimer growth constant: `bits ≈ 0.42·n·m`, so `#primes ≈ bits / log₂(p)`. This is the standard exact-counting pipeline and mirrors the CRT approach in the matrix-power topic.

---

## 5. Generalizing the Piece Set and Constraints

The frontier mask machinery is far more general than dominoes. The senior payoff is recognizing when a problem is "profile DP in disguise."

### 5.1 L-trominoes and polyominoes

An **L-tromino** covers 3 cells in an L shape (4 rotations). The broken-profile transition at a free cell now enumerates each rotation that fits, updating possibly two frontier bits at once. The state may need to track partial pieces that span more than the current cell, which can push the mask beyond `m` bits (e.g. encode "how far a piece protrudes" with 2 bits per column). General polyomino tiling uses the same idea: the mask must encode enough of the boundary to know which placements are legal — its width grows with the piece's vertical extent. Mixed domino+tromino tilings just union the transition sets.

A robust engineering pattern for trominoes: use a **two-row band** mask of `2m` bits (current row + next row), since an L-tromino spans at most 2 rows. At the first free cell, try each of the 4 rotations whose 3 cells are in-bounds and free, set their bits, recurse/advance, and shift the band down when crossing a row boundary. The parity reject becomes `(n·m) % 3 != 0`. This is exactly the formulation in the interview challenge and Task 9; it keeps the per-cell work bounded while correctly handling the larger vertical reach.

### 5.2 Independent sets on a grid

Count subsets of cells with no two orthogonally adjacent (a grid independent set). Broken profile: bit `c` of the frontier = "is the cell in column `c` of the frontier *selected*?" At cell `(r,c)`, choose select (legal only if the left neighbor `(r,c-1)` and the up neighbor `(r-1,c)` are not selected — both recoverable from the mask) or skip. The transition is O(1) and the cost is `O(n · m · 2^m)`. Maximum independent set (weighted) uses the same sweep with `max` instead of sum. This is a frontier "connectivity-free" constraint — purely local — and is the gentlest non-tiling profile DP.

### 5.3 Proper colorings and Ising-like sums

Counting proper `q`-colorings of a grid, or summing `exp(-βH)` over Ising configurations, is profile DP where the frontier stores each column's *color/spin* (so `q^m` states instead of `2^m`). The transition checks adjacency constraints against the stored frontier. Same skeleton, wider alphabet.

### 5.4 Connectivity profiles (overview)

Some problems require the frontier to encode not just "filled/free" but **how frontier cells are connected** to each other (e.g. counting Hamiltonian cycles, spanning structures, or single-connected-component tilings). The mask then carries a *matching/partition* of the frontier cells — a **plug/connectivity profile** — and the state count grows like the Catalan / Bell numbers of `m` rather than `2^m`. This "broken-profile with connectivity" (sometimes called the *plug DP* or *Hamiltonicity profile*) is the advanced frontier of this technique; it is mentioned here as the natural generalization but its full treatment (rank/connectivity encoding, Cut&Count) is beyond the domino case.

### 5.5 Recognizing a profile-DP problem in disguise

The senior skill is *spotting* that a problem is profile DP. A checklist:

1. **Is it a grid (or a thin strip) with per-cell local constraints?** If a cell's legality depends only on a bounded neighborhood (up/left/diagonal), a fixed-width frontier can summarize it.
2. **Is one dimension small (`≤ ~18`)?** That dimension becomes `m`; cost is exponential in it.
3. **Is the question a count, a max/min, or a feasibility?** Choose the semiring accordingly — counting `(+,×)`, optimization `(max/min,+)`, feasibility `(OR,AND)`.
4. **Does the constraint involve global connectivity?** If yes, you need a plug/connectivity profile (5.4); if no (dominoes, independent sets, colorings), a simple filled/selected bit suffices.
5. **Is `n` astronomically large?** If yes and `m` is tiny, build the transfer matrix and exponentiate.

If a problem fails (1) or (2) — non-local constraint, or both dimensions large — profile DP is the wrong tool (use Kasteleyn for planar both-large, or accept #P for non-planar). The discipline of writing the per-cell transition explicitly *reveals* whether the state is truly fixed-width: if you cannot summarize the past in `m` bits without referencing unbounded history, the technique does not apply.

---

## 6. Performance Engineering of the Sweep

### 6.1 The inner loop dominates

`log n` matters only in the matrix-exponentiation regime. For the sweep, the cost is the `2^m` mask loop executed `n·m` times. Every constant-factor win multiplies through:

- **Zero-skip:** `if dp[mask]==0: continue` — the biggest single win; reachable masks are sparse.
- **Flat arrays, integer-indexed:** no maps, no nested slices in the hot path.
- **Precompute per-cell constants:** `bit = 1<<c`, `rightBit = 1<<(c+1)`, and `canVert = (r+1<n)` hoisted out of the mask loop.
- **Branch-light transition:** compute the two/three target masks and add; avoid per-mask reallocation.
- **Reuse buffers:** ping-pong `dp`/`ndp`; zero `ndp` with a fast fill, not reallocation.

### 6.2 Parallelism

The mask loop for a single cell is data-parallel over masks (each mask writes to a few targets — use atomic adds or per-thread partial arrays merged after). Across CRT primes, each prime is an independent full run — embarrassingly parallel. Binary exponentiation of `T` is sequential across squarings, so parallelism lives inside each matrix multiply (over output rows).

### 6.3 Memory

Rolling array: `8 · 2^m` bytes per layer. For `m = 18`, that is 2 MB per layer, 4 MB ping-ponged — fits in L2/L3, so the sweep is largely compute-bound. For the transfer matrix, `T` is `8 · 4^m` bytes — `m = 8` gives 512 KB, `m = 10` gives 8 MB; the cube is the cost, not storage.

### 6.4 Caching across queries

When many queries share the board shape (same `m`) but differ in `n`, precompute the transfer matrix `T` once and the squaring ladder `T^{2^0}, T^{2^1}, …`; each query for a given `n` multiplies the ladder entries whose bits are set in `n`, in `O(8^m · popcount(n))`. The ladder is read-only after construction and shareable across threads — do not rebuild it per query.

### 6.5 Iteration order and the inner-loop shape

The hot loop is `for mask in 0..2^m-1`. Two disciplines matter at scale. First, **hoist invariants**: `bit`, `rbit = 1<<(c+1)`, and the boolean `canVert = r+1<n` do not depend on `mask`, so compute them once per cell, not per mask. Second, **write to at most two/three targets and continue**: the domino transition never reads back from `ndp`, so there is no aliasing hazard between `dp` and `ndp` (they are distinct buffers), and the writes are to a small set of mask-derived indices that stay cache-resident for `m ≤ 18`. Avoid clever bit tricks that defeat the branch predictor — a clear `if mask&bit { ... } else { ... }` predicts well because reachable masks cluster. Profiling typically shows the modulo (`% p`) as the single hottest instruction; a Barrett/Montgomery reduction or deferred reduction (the transition is additive, so several adds can accumulate before one reduction) is the main micro-optimization beyond the zero-skip.

---

## 7. Code Examples

### 7.1 Go — broken-profile with flat array, zero-skip, rolling buffers

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
	ndp := make([]int64, full)
	dp[0] = 1
	for r := 0; r < n; r++ {
		canVert := r+1 < n
		for c := 0; c < m; c++ {
			for i := range ndp {
				ndp[i] = 0
			}
			bit := 1 << c
			rbit := 1 << (c + 1)
			canHorizCol := c+1 < m
			for mask := 0; mask < full; mask++ {
				v := dp[mask]
				if v == 0 {
					continue // zero-skip: reachable masks are sparse
				}
				if mask&bit != 0 {
					t := mask ^ bit
					ndp[t] = (ndp[t] + v) % MOD
				} else {
					if canVert {
						t := mask | bit
						ndp[t] = (ndp[t] + v) % MOD
					}
					if canHorizCol && mask&rbit == 0 {
						t := mask | rbit
						ndp[t] = (ndp[t] + v) % MOD
					}
				}
			}
			dp, ndp = ndp, dp // ping-pong
		}
	}
	return dp[0]
}

func main() {
	fmt.Println(countTilings(8, 8))   // 12988816
	fmt.Println(countTilings(1000, 12))
}
```

### 7.2 Java — transfer-matrix exponentiation for astronomically large n (m fixed small)

```java
public class TilingTransfer {
    static final long MOD = 1_000_000_007L;
    static int M, FULL;

    // Build T[mask][next_mask] via a column recursion that fills one row.
    static long[][] buildT() {
        long[][] T = new long[FULL][FULL];
        for (int mask = 0; mask < FULL; mask++) fill(mask, 0, 0, 0, T);
        return T;
    }

    static void fill(int mask, int col, int curRow, int nextRow, long[][] T) {
        if (col == M) { T[nextRow][mask]++; return; } // column-major into T (apply as T*g)
        if (((mask >> col) & 1) != 0 || ((curRow >> col) & 1) != 0) {
            fill(mask, col + 1, curRow, nextRow, T);
        } else {
            fill(mask, col + 1, curRow | (1 << col), nextRow | (1 << col), T); // vertical
            if (col + 1 < M && ((mask >> (col + 1)) & 1) == 0 && ((curRow >> (col + 1)) & 1) == 0)
                fill(mask, col + 1, curRow | (1 << col) | (1 << (col + 1)), nextRow, T); // horizontal
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

    static long[][] matPow(long[][] a, long n) {
        long[][] r = new long[FULL][FULL];
        for (int i = 0; i < FULL; i++) r[i][i] = 1;
        while (n > 0) {
            if ((n & 1) == 1) r = mul(r, a);
            a = mul(a, a);
            n >>= 1;
        }
        return r;
    }

    static long count(int m, long n) {
        M = m; FULL = 1 << m;
        long[][] T = buildT();
        long[][] Tn = matPow(T, n);
        return Tn[0][0]; // start empty (mask 0), end empty
    }

    public static void main(String[] args) {
        System.out.println(count(2, 8));            // 34  (Fibonacci F(9))
        System.out.println(count(4, 1_000_000_000L)); // huge n, instant
    }
}
```

### 7.3 Python — independent sets on a grid (same frontier skeleton, max or count)

```python
MOD = 1_000_000_007


def count_independent_sets(n, m):
    """Count subsets of cells with no two orthogonally adjacent."""
    if m > n:
        n, m = m, n
    full = 1 << m
    dp = [0] * full
    dp[0] = 1
    for r in range(n):
        for c in range(m):
            ndp = [0] * full
            bit = 1 << c
            leftbit = 1 << (c - 1) if c > 0 else 0
            for mask in range(full):
                v = dp[mask]
                if not v:
                    continue
                # bit c of `mask` currently holds the up-neighbor's selection state
                up_selected = mask & bit
                # option 1: do NOT select (r,c) -> clear its frontier bit
                t = mask & ~bit
                ndp[t] = (ndp[t] + v) % MOD
                # option 2: select (r,c) -> legal iff up and left are not selected
                left_selected = (mask & leftbit) if c > 0 else 0
                if not up_selected and not left_selected:
                    t = mask | bit
                    ndp[t] = (ndp[t] + v) % MOD
            dp = ndp
    return sum(dp) % MOD


if __name__ == "__main__":
    # 2x2 grid independent sets: 7 (empty,4 singles,2 diagonals)
    print(count_independent_sets(2, 2))   # 7
    print(count_independent_sets(3, 3))   # 63
```

---

## 8. Observability and Testing Against Brute Force

A profile-DP result is opaque — one wrong count looks like any other large number. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force backtracking oracle on small grids | Catches transition bugs, off-by-one in bit indexing, wrong final read. |
| `2 × n` equals Fibonacci `F(n+1)` | Closed-form anchor for the simplest non-trivial case. |
| `8 × 8 = 12988816` (known value) | Catches subtle systemic errors. |
| Odd area returns 0 | Confirms the parity guard. |
| Symmetry: count(n,m) == count(m,n) | The rotation must not change the answer. |
| Sweep vs transfer-matrix agreement | Two independent code paths computing the same number. |
| Determinism across languages | Same inputs/modulus → identical Go/Java/Python outputs. |

The single most valuable test is the **brute-force oracle**: recursive backtracking that places a domino on the first free cell, for grids up to `~6×6`, compared exactly. It catches the overwhelming majority of bugs.

### 8.1 A property-test battery

```text
for small n, m in [1..6]:
    assert tilings(n, m) == bruteforce(n, m)       # the oracle
    assert tilings(n, m) == tilings(m, n)          # rotation symmetry
    if (n*m) odd: assert tilings(n, m) == 0        # parity
assert tilings(2, k) == fib(k+1) for k in [1..20]  # closed form
assert tilings(8, 8) == 12988816                   # known value
assert sweep(n, m) == transfer_matrix(n, m)        # two paths agree
```

A few hundred random small instances plus these anchors give high confidence.

### 8.2 A worked validation session

Concretely, a CI test for a new implementation runs:

```text
1. tilings(1,1) == 0       # odd area
2. tilings(1,2) == 1       # single horizontal
3. tilings(2,2) == 2       # two verticals or two horizontals
4. tilings(2,3) == 3       # the running example
5. tilings(2,n) == fib(n+1) for n in 1..30
6. tilings(8,8) == 12988816
7. tilings(n,m) == tilings(m,n) for 50 random small (n,m)
8. tilings(n,m) == bruteforce(n,m) for all n,m <= 6
9. sweep(n,m) == transfer_matrix(n,m) for m <= 4, n <= 50
```

If step 4 fails but step 3 passes, suspect the *last-row* vertical guard (`r+1<n`) or the horizontal range guard. If step 6 fails while small cases pass, suspect an overflow/modulus bug that only manifests at larger counts. If step 7 fails, the rotation is buggy. If step 9 fails, the transfer-matrix construction (`w(μ,μ')`) disagrees with the sweep — usually a mask-encoding mismatch between the two code paths. This diagnostic-by-which-test-fails approach localizes the bug class quickly, which is the whole point of keeping multiple independent checks.

### 8.3 Production guardrails

For a service answering tiling-count queries: validate that `m = min(rows, cols)` was actually applied (a magnitude/timeout guard catches the un-rotated disaster); log the chosen `m` and `2^m` so an anomalous resource spike is attributable; and assert the result equals the cross-check (transfer matrix vs sweep) on a sampled fraction of queries.

---

## 9. Failure Modes

### 9.1 Un-rotated dimension (the catastrophe)
Using the large side as `m` makes `2^m` astronomical — OOM or timeout. Mitigation: `m = min(n, m)` as the first line; assert it.

### 9.2 Silent overflow
Forgetting the modulus yields plausible but wrong numbers. Mitigation: reduce after every add; for weighted/multiplicative variants, bound the accumulator or reduce after the multiply.

### 9.3 Wrong final read
Summing all masks (for tiling) instead of reading `dp[0]` over-counts — it includes configurations with dominoes poking past the edge. Mitigation: only the empty frontier `mask = 0` is a complete tiling. (Note: independent-set counting *does* sum all masks, because every frontier state is a valid endpoint — know which problem you are in.)

### 9.4 Mask-encoding confusion
Mixing "set on placement" and "free bit" conventions corrupts the transition. Mitigation: document the bit meaning; keep the invariant "when the sweep reaches a cell, its bit reflects prior coverage."

### 9.5 Off-by-one in bit positions
Shifting by `c-1`/`c+1` where `c` is meant. Mitigation: trace a `2×3` by hand against the known answer 3.

### 9.6 Matrix exponentiation with too-large `m`
Cubing a `2^m × 2^m` matrix is `8^m`; for `m = 12` that is `8^12 ≈ 6.9·10^10` per multiply — infeasible. Mitigation: matrix power only for tiny `m`; otherwise iterate the sweep. Prune `T` to reachable masks.

### 9.7 Rebuilding the transfer matrix or ladder per query
In a batched service, recomputing `T` (or its squaring ladder) per request wastes work and allocates. Mitigation: build once at startup, share read-only.

### 9.8 Generalization that silently needs a wider mask
Adding L-trominoes or larger polyominoes can require more than `m` bits (pieces protrude further than one row). Using an `m`-bit mask then under-counts/over-counts. Mitigation: re-derive the frontier width for the new piece set; the mask must encode the full boundary the pieces can reach.

### 9.9 A worked failure-mode diagnosis
A team reports their `12 × 12` domino count is wrong intermittently. Diagnosis path: (a) `8×8` anchor passes → not a systemic transition bug; (b) odd-area and small brute-force pass → transition logic is correct; (c) the wrong answers appear only for *some* inputs and look like negative or wildly large numbers → an **overflow/modulus** issue. Inspection finds a weighted variant where two residues are multiplied without reduction before the next add, overflowing `int64` for some masks. Fix: reduce after the multiply (or bound the deferred accumulator). The takeaway: anchors that pass *exclude* whole bug classes, so the order of checks (systemic → logic → overflow) localizes the fault fast. Intermittent (input-dependent) wrongness almost always points at arithmetic, not structure.

### 9.10 Off-by-one between "size" and "cells"
Business specs often say "cover a `5 × 8` region" but the data structure is 0-indexed and the region might be inclusive/exclusive on the boundary, or the small dimension might be reported as the *long* side. This off-by-one survives the algebraic anchors (the math is correct for *some* dimensions) and only surfaces against the human-specified expected output. Mitigation: pin down exactly what the dimensions mean, feed the brute-force oracle the *same* human-specified board, and never re-derive the dimensions from a formula that might encode the same misunderstanding.

---

## 10. Summary

- The broken-profile sweep counts tilings in `O(n · m · 2^m)` and uses `O(2^m)` rolling memory — exponential **only** in the narrow dimension, so the first and most important rule is `m = min(rows, cols)`.
- Reachable masks are sparse; the **zero-skip** is the single biggest constant-factor win, followed by flat arrays and ping-ponged buffers.
- For **astronomically large `n`** with tiny `m`, the row-to-row map is a fixed `2^m × 2^m` transfer matrix `T`; `(T^n)[0][0]` is the count, computable in `O(8^m log n)` by binary exponentiation — exactly the matrix-power-on-graphs view (sibling `11-graphs` `32-paths-fixed-length`), with the `2 × n` case being the Fibonacci matrix.
- Keep counts exact mod a prime; CRT across primes for exact large values; the domino transition is purely additive, so overflow is easy to bound.
- The frontier skeleton generalizes: L-trominoes (wider mask), grid independent sets (per-cell select/skip with up+left checks), proper colorings (`q^m` states), and connectivity/plug profiles for Hamiltonicity-style problems.
- Always keep a brute-force backtracking oracle and the Fibonacci / `8×8 = 12988816` anchors; they catch the rotation mistake, the modulus mistake, the final-read mistake, and the bit-index off-by-one that together account for nearly every real bug.

### Decision summary

- **Small/medium `n`, small `m`, counting** → broken-profile sweep `O(n·m·2^m)`.
- **Astronomical `n`, tiny `m`** → transfer-matrix exponentiation `O(8^m log n)`.
- **Both dimensions large** → stop; profile DP does not apply.
- **Exact large count** → CRT across primes, independent sweeps.
- **Beyond dominoes (trominoes/polyominoes)** → re-derive frontier width; transition enumerates piece placements.
- **Local-constraint counting (independent sets, colorings)** → same frontier skeleton, different per-cell rule and (possibly) alphabet.
- **Connectivity-constrained counts** → plug/connectivity profile (advanced; beyond the domino case).

### Production readiness checklist

Before shipping a profile-DP service, confirm:

- [ ] `m = min(rows, cols)` is enforced and asserted (the catastrophe guard).
- [ ] Odd-area / balance reject runs before allocation.
- [ ] Rolling buffers are ping-ponged, not reallocated per cell.
- [ ] Zero-skip is in the inner loop.
- [ ] Modulus is a named constant; arithmetic cannot overflow before reduction.
- [ ] Brute-force oracle, Fibonacci, and `8×8` anchors are in CI.
- [ ] Rotation-symmetry property test is in CI.
- [ ] For large `n`: transfer-matrix ladder is built once and shared read-only.
- [ ] Result is read from the correct terminal state (`mask=0` for tilings; all masks for independent sets).
- [ ] A magnitude/timeout guard catches an accidental un-rotated input in production.

References to study further: the transfer-matrix method (Flajolet-Sedgewick, *Analytic Combinatorics* Ch. V), the Kasteleyn / Temperley-Fisher determinant formula for domino tilings, broken-profile and plug DP write-ups on cp-algorithms.com, Cut&Count / connectivity DP for Hamiltonicity, and sibling topic `11-graphs` `32-paths-fixed-length` for the matrix-exponentiation engine that powers the large-`n` regime.
