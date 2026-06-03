# Profile DP / Broken Profile DP (Tiling a Grid with a Frontier Bitmask) — Middle Level

> **Focus:** The precise broken-profile (cell-by-cell) transition rules, why the mask is exactly `m` bits, the comparison with full-row profile DP, how to choose the small dimension, and the link to the transfer-matrix method that turns fixed-small-`m` tilings into a matrix power.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The Broken-Profile Transition, Precisely](#the-broken-profile-transition-precisely)
4. [Full-Row Profile DP and How It Compares](#full-row-profile-dp-and-how-it-compares)
5. [Choosing the Small Dimension](#choosing-the-small-dimension)
6. [The Transfer-Matrix Link](#the-transfer-matrix-link)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single picture: sweep the grid cell by cell, carry an `m`-bit frontier mask, branch on *skip / vertical / horizontal*, and `dp[mask=0]` at the end is the count. At middle level you start asking the engineering and modeling questions that decide whether your solution is correct *and* fast:

- What *exactly* does each mask bit mean, and why is the mask always exactly `m` bits in the broken-profile formulation (never `m+1`, never variable)?
- What is the precise transition at a free cell vs a filled cell, and why are those the only moves?
- When is the **full-row profile** (advance a whole row at a time) preferable to the **broken profile** (advance one cell), and how do their costs differ?
- How do I choose which dimension is `m`, and what happens to the constant factor when `m` is, say, 14 vs 18?
- How does the *same* recurrence, for a fixed small `m`, become a **transfer matrix** whose `n`-th power gives the answer — turning `O(n)` into `O(log n)`?

These are the questions that separate "I memorized the domino DP" from "I can adapt profile DP to trominoes, blocked cells, colorings, and large `n`."

---

## Deeper Concepts

### The state, restated precisely

Index cells in reading order `pos = r*m + c`, `pos ∈ {0, …, n·m}`. Define

```
dp[pos][mask] = number of ways to consistently place dominoes covering
                cells 0 … pos-1 (plus any cross-frontier halves)
                such that the current frontier equals `mask`.
```

The **frontier** at `pos = r*m + c` is the set of `m` cells:

```
(r, c), (r, c+1), …, (r, m-1),      ← cells in the current row not yet decided, from c rightward
(r+1, 0), (r+1, 1), …, (r+1, c-1)   ← cells in the next row already "reached into" from above
```

That is exactly `m` cells — a staircase. Bit `b` of the mask, in the standard broken-profile encoding, says: **is the frontier cell in column `b` already filled by a previously placed domino?** A vertical domino at `(r, c)` reaches into `(r+1, c)`, so it sets the column-`c` bit; that bit is read when the sweep later reaches `(r+1, c)`.

### Why exactly `m` bits

The frontier always has exactly `m` cells because at every `pos` the staircase consists of `(m - c)` cells in row `r` plus `c` cells in row `r+1`, totaling `m`. As `c` advances from `0` to `m-1`, the staircase shifts down by one cell, but its size never changes. This is the elegance of the broken profile: a fixed-width window slides over the grid, so the state is uniformly `2^m` masks at every cell — no special cases at row boundaries.

### Why those are the only moves

Dominoes are local: each covers two orthogonally adjacent cells. When we arrive at the first undecided cell `(r, c)`:

- It must end up covered. The dominoes that can cover it are: a **vertical** with its lower half at `(r,c)` (upper half at `(r-1,c)` — but that was decided earlier, so this case is represented by the bit already being *set*), a **vertical** with its upper half at `(r,c)` (lower half at `(r+1,c)`), or a **horizontal** with its left half at `(r,c)` (right half at `(r,c+1)`). A horizontal with `(r,c)` as the *right* half would have been placed when we decided `(r,c-1)`.
- So when the bit for `(r,c)` is **set**, the cell is already covered (by an earlier vertical-from-above or horizontal-from-left); we only advance. When it is **free**, we choose vertical-down or horizontal-right.

No other placement can touch `(r,c)` without violating the reading-order discipline, which is why the move set is complete and each tiling maps to exactly one decision path.

---

## The Broken-Profile Transition, Precisely

Process cell `(r, c)`, `bit = 1 << c`, current mask `mask`, ways `v = dp[mask]`:

**Case A — `mask & bit != 0` (cell already filled).**
The cell was covered by a domino placed earlier. The only action is to advance to the next cell and **clear** this column's bit (it now lies behind the frontier):
```
next_mask = mask ^ bit            # clear bit c
ndp[next_mask] += v
```

**Case B — `mask & bit == 0` (cell free).** Two sub-moves:

1. **Vertical** `(r,c)-(r+1,c)` — legal iff `r + 1 < n`. Set the column-`c` bit so the cell below is marked filled:
   ```
   ndp[mask | bit] += v
   ```
2. **Horizontal** `(r,c)-(r,c+1)` — legal iff `c + 1 < m` **and** the right cell is free (`mask & (1 << (c+1)) == 0`). Mark column `c+1` filled:
   ```
   ndp[mask | (1 << (c+1))] += v
   ```

After processing all masks for cell `(r,c)`, set `dp = ndp` and move to `pos+1`.

> **Encoding subtlety.** Two equivalent encodings circulate. (1) "Set bit on placement" — a vertical *sets* bit `c` to mark the below-cell filled, and advancing past a filled cell *clears* it (used above and in junior.md). (2) "Bit = free vs occupied for the next row" — some references invert the meaning. Both are correct; pick one, write it down, and never mix them. The invariant that must hold either way: when the sweep *reaches* a cell, its bit correctly reflects whether a previously placed domino already covers it.

**Base and answer.** `dp[0] = 1` before cell 0 (empty frontier). The answer is `dp[0]` after all `n·m` cells (the frontier must be empty — nothing pokes past the bottom-right corner).

### A trace of the `2×3` board

`n=2, m=3`. Reading order `(0,0)(0,1)(0,2)(1,0)(1,1)(1,2)`. Start `dp[000]=1`.

```
(0,0) free:  vert→ set bit0: dp'[001]+=1 ;  horiz(0,1 free)→ set bit1: dp'[010]+=1
(0,1):
  from 001 (bit1=0, free): vert→001|010=011 ; horiz(c+1=2 free)→001|100=101
  from 010 (bit1=1, filled): advance clear→000
(0,2):
  from 011 (bit2=0 free): vert→011|100=111 ; horiz: c+1=3 out of range → none
  from 101 (bit2=1 filled): advance clear→001
  from 000 (bit2=0 free): vert→100 ; horiz out of range → none
(1,0):  r+1=2 not < n, so NO vertical allowed from here on (last row)
  from 111 (bit0=1 filled): clear→110
  from 001 (bit0=1 filled): clear→000
  from 100 (bit0=0 free): horiz(c+1=1 free)→100|010=110 ; vertical illegal
(1,1):
  from 110 (bit1=1 filled): clear→100
  from 000 (bit1=0 free): horiz(c+1=2 free)→000|100=100 ; vertical illegal
  (two contributions land on 100)
(1,2):
  from 100 (bit2=1 filled): clear→000   ← three ways funnel here
final dp[000] = 3   ✓
```

Three paths, matching the three tilings A/B/C from junior.md. Notice how in the last row vertical moves vanish (`r+1 < n` fails), forcing horizontals — exactly the real constraint.

---

## Full-Row Profile DP and How It Compares

There is an older, equally valid formulation that advances a **whole row at a time** instead of one cell.

**State:** `g[r][mask]` = number of ways to fill rows `0 … r-1` completely, where `mask` (m bits) records which cells of **row `r`** are *already occupied* by verticals coming down from row `r-1`.

**Transition (row `r` → row `r+1`):** enumerate every way to fill the remaining free cells of row `r` (those with `mask` bit 0) using horizontal dominoes within the row and vertical dominoes that protrude into row `r+1`. Each such filling produces a `next_mask` describing which cells of row `r+1` are occupied by those protruding verticals. This inner enumeration is itself a small recursion over the `m` columns of the row.

```
for each mask (row r occupancy):
    enumerate fillings of row r → produce next_mask for row r+1
    g[r+1][next_mask] += g[r][mask]
answer = g[n][0]
```

### Broken profile vs full-row profile

| Aspect | Broken profile (cell by cell) | Full-row profile (row by row) |
|--------|------------------------------|-------------------------------|
| State granularity | one cell per step | one row per step |
| Mask width | exactly `m` bits, always | `m` bits |
| Transition per state | **O(1)** (3 fixed moves) | enumerate row fillings: up to `O(2^m)` or a sub-recursion per `(mask, next_mask)` pair |
| Total time | **O(n · m · 2^m)** | `O(n · 2^m · 2^m) = O(n · 4^m)` naive, or `O(n · 3^m)` / `O(n·m·2^m)` with a careful column recursion |
| Conceptual load | one slide-the-window rule | row-filling enumeration (more bookkeeping) |
| Ease of adding pieces (trominoes, blocked cells) | easier — local per-cell rules | harder — must extend the row enumeration |

**Bottom line.** The **broken profile** is usually preferred today: its transition is O(1) per state, giving a clean `O(n·m·2^m)`, and per-cell local rules make it easy to add L-trominoes, blocked cells, or coloring constraints. The **full-row profile** is conceptually closer to the transfer-matrix picture (each row is one matrix step) and is fine when `m` is very small, but its naive transition can be `O(4^m)` if you enumerate `(mask, next_mask)` pairs without care. Both compute the same number; they differ in how the work is sliced.

A useful mental model: the broken profile *is* the full-row profile with the per-row enumeration unrolled into `m` micro-steps, one per column, which is precisely what makes each micro-step O(1).

### Column-profile vs broken-profile: a concrete state-count table

It is worth seeing, in numbers, how the two formulations spend their state budget. Both carry an `m`-bit mask, so the *space* is the same `2^m`. The difference is in the **number of transition evaluations** and the **shape of the inner loop**.

| `m` | masks `2^m` | broken-profile transitions per row (`m · 2^m`) | full-row naive transitions per row (`2^m · 2^m = 4^m`) | naive ratio (`4^m / (m·2^m)` ) |
|-----|-------------|-----------------------------------------------|--------------------------------------------------------|--------------------------------|
| 2 | 4 | 8 | 16 | 2.0 |
| 4 | 16 | 64 | 256 | 4.0 |
| 6 | 64 | 384 | 4096 | 10.7 |
| 8 | 256 | 2048 | 65536 | 32.0 |
| 10 | 1024 | 10240 | ~1.05M | 102.4 |
| 12 | 4096 | 49152 | ~16.8M | 341.3 |

The "broken-profile transitions per row" column is exact: `m` micro-steps, each scanning `2^m` masks, each doing O(1) work. The "full-row naive" column is the cost if you enumerate every `(mask, next_mask)` pair blindly; the careful column recursion of the full-row method avoids most of those pairs and lands at roughly `O(m · 2^m)` as well — but only if you precompute the transition list once. The table makes the lesson tangible: a naive full-row pairing scales as `4^m`, which is `341×` worse than the broken profile at `m = 12` and grows without bound. The broken profile gives you the good asymptotics by construction, with no precomputation step to forget.

A second number worth internalizing: of the `2^m` masks, only a fraction are *reachable* at any given cell. For dominoes at `m = 12`, empirically only a few hundred to roughly a thousand masks carry nonzero counts at a typical cell (versus the full `4096`), so the zero-skip turns the `49152` figure above into something closer to `m · (reachable) ≈ 12 · 800 ≈ 9600` real updates per row — another `5×` constant-factor saving on top of the asymptotic win.

---

## Choosing the Small Dimension

The cost is `O(n · m · 2^m)`, exponential **only** in `m`. So:

> **Always set `m = min(rows, cols)` and `n = max(rows, cols)`.**

Concrete impact for a `1000 × 12` board:

| Treat as | `m` | `2^m` | rough states | feasible? |
|----------|-----|-------|--------------|-----------|
| `n=1000, m=12` | 12 | 4096 | `1000·12·4096 ≈ 5·10^7` | yes, instant |
| `n=12, m=1000` | 1000 | `2^1000` | astronomical | no |

The swap is one line and changes the runtime by hundreds of orders of magnitude. The practical ceiling for the narrow dimension is roughly:

| `m` | `2^m` | Comment |
|-----|-------|---------|
| ≤ 10 | ≤ 1024 | trivial |
| 11–14 | 2K–16K | comfortable |
| 15–16 | 32K–64K | fine, watch memory of the rolling array |
| 17–18 | 128K–256K | borderline; needs zero-skip and tight code |
| ≥ 19 | ≥ 512K | usually too slow per cell; consider transfer-matrix or a smaller `m` |

If **both** dimensions are large, profile DP does not apply — that is a fundamental limitation, not an implementation gap.

---

## The Transfer-Matrix Link

When `m` is fixed and **small**, the row-to-row map of the full-row profile is a **fixed linear operator** that does not depend on which row you are at. That operator is a `2^m × 2^m` matrix `T`:

```
T[mask][next_mask] = number of ways to fill a row whose incoming
                     occupancy is `mask`, producing outgoing occupancy `next_mask`.
```

Then the vector of row-occupancy counts evolves by `g_{r+1} = T · g_r`, and after `n` rows the answer is the appropriate entry of `T^n` applied to the initial vector `e_0` (the all-free start), read at `next_mask = 0`:

```
answer = (T^n)[0][0]            # start empty, end empty
```

Because matrix multiplication is associative, you can compute `T^n` by **binary exponentiation** in `O((2^m)^3 · log n)` — turning the `O(n · …)` row sweep into `O(log n)` matrix multiplies. This is the bridge to sibling topic `11-graphs` `32-paths-fixed-length` (matrix exponentiation on graphs): the row-occupancy masks are the "vertices" of a graph, `T` is its adjacency-count matrix, and a tiling is a **walk** of length `n` from mask `0` back to mask `0`.

| Method | Cost | Best when |
|--------|------|-----------|
| Broken-profile DP | `O(n · m · 2^m)` | typical `n`, small `m`; easiest to code and extend |
| Full-row profile DP | `O(n · poly(2^m))` | small `m`; conceptual stepping stone |
| Transfer-matrix exponentiation | `O(8^m · log n)` | **astronomically large `n`**, very small `m` (`2^m` small enough to cube) |

The crossover: matrix exponentiation wins only when `n` is enormous (e.g. `n = 10^18`) and `m` is tiny enough that `(2^m)^3` is affordable. For everyday `n`, the linear broken-profile sweep is simpler and faster. The professional file proves the recurrence/transfer-matrix correspondence; the `2 × n` special case famously gives `T = [[1,1],[1,0]]`, the Fibonacci matrix.

### A worked `2 × n` transfer matrix

For `m = 2`, consider only the **reachable** row-occupancy masks `{00, 11}` (intermediate masks `01`, `10` are transient within a row and do not survive a full row fill from an empty start). Filling one row:

- from incoming `00` (both free): two verticals → outgoing `11`; one horizontal → outgoing `00`. So `00 → 11` and `00 → 00`, each one way.
- from incoming `11` (both occupied by verticals from above): nothing to place → outgoing `00`. So `11 → 00`, one way.

As a matrix on `(00, 11)` with `T[next][incoming]`:

```
T = [ [1, 1],     # next=00 from incoming 00 (horizontal) or 11 (forced)
      [1, 0] ]    # next=11 from incoming 00 (two verticals)
```

This is exactly `[[1,1],[1,0]]` — the Fibonacci matrix. Then `Z(2,n) = (T^n)[00][00] = F(n+1)`. For `n=3`: `T^3` gives `(T^3)[0][0] = 3`, matching the `2×3` count. This concrete construction is what the transfer-matrix exponentiation code (senior/interview files) generalizes to larger `m`.

### When NOT to bother with the transfer matrix

If `n ≤ ~10^7`, the linear sweep finishes in well under a second for small `m` and is far simpler to write and debug. Reach for matrix exponentiation only when `n` is genuinely astronomical (`≥ 10^9`–`10^18`) and `m` is small enough (`m ≤ ~6` for a full `2^m` matrix, or after reducing to reachable masks) that cubing the matrix is affordable. Over-engineering a matrix power for moderate `n` is a common middle-level mistake.

---

## Code Examples

### Broken-profile domino count (rolling array, mod p)

The clean reference implementation. State `dp[mask]` rolls one cell at a time.

#### Go

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
	for _, mm := range []int{1, 2, 3, 4, 5} {
		fmt.Printf("2 x %d = %d\n", mm, countTilings(2, mm))
	}
	fmt.Println("8 x 8 =", countTilings(8, 8)) // 12988816
}
```

#### Java

```java
public class BrokenProfile {
    static final long MOD = 1_000_000_007L;

    static long countTilings(int n, int m) {
        if (((long) n * m) % 2 != 0) return 0;
        if (m > n) { int t = n; n = m; m = t; }
        int full = 1 << m;
        long[] dp = new long[full];
        dp[0] = 1;
        for (int r = 0; r < n; r++) {
            for (int c = 0; c < m; c++) {
                long[] ndp = new long[full];
                int bit = 1 << c;
                for (int mask = 0; mask < full; mask++) {
                    long v = dp[mask];
                    if (v == 0) continue;
                    if ((mask & bit) != 0) {
                        int t = mask ^ bit;
                        ndp[t] = (ndp[t] + v) % MOD;
                    } else {
                        if (r + 1 < n) {
                            int t = mask | bit;
                            ndp[t] = (ndp[t] + v) % MOD;
                        }
                        if (c + 1 < m && (mask & (1 << (c + 1))) == 0) {
                            int t = mask | (1 << (c + 1));
                            ndp[t] = (ndp[t] + v) % MOD;
                        }
                    }
                }
                dp = ndp;
            }
        }
        return dp[0];
    }

    public static void main(String[] args) {
        for (int mm = 1; mm <= 5; mm++)
            System.out.println("2 x " + mm + " = " + countTilings(2, mm));
        System.out.println("8 x 8 = " + countTilings(8, 8));
    }
}
```

#### Python

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
                    t = mask ^ bit
                    ndp[t] = (ndp[t] + v) % MOD
                else:
                    if r + 1 < n:
                        t = mask | bit
                        ndp[t] = (ndp[t] + v) % MOD
                    if c + 1 < m and not (mask & (1 << (c + 1))):
                        t = mask | (1 << (c + 1))
                        ndp[t] = (ndp[t] + v) % MOD
            dp = ndp
    return dp[0]


if __name__ == "__main__":
    for mm in range(1, 6):
        print(f"2 x {mm} = {count_tilings(2, mm)}")
    print("8 x 8 =", count_tilings(8, 8))  # 12988816
```

### Full-row profile (column recursion) — for contrast

This fills a whole row at once via a small recursion over columns, producing the next row's occupancy. Shown in Python; it computes the same answers.

```python
MOD = 1_000_000_007


def count_tilings_rowprofile(n, m):
    if (n * m) % 2 != 0:
        return 0
    if m > n:
        n, m = m, n
    full = 1 << m
    # transitions[mask] = list of next_masks reachable by filling a row with incoming `mask`
    transitions = [[] for _ in range(full)]

    def fill(mask, col, cur_row, next_row):
        # mask: incoming occupancy; cur_row/next_row built so far
        if col == m:
            transitions[mask].append(next_row)
            return
        if (mask >> col) & 1 or (cur_row >> col) & 1:
            fill(mask, col + 1, cur_row, next_row)        # already occupied → skip
        else:
            # vertical: occupies this row's cell, protrudes into next row
            fill(mask, col + 1, cur_row | (1 << col), next_row | (1 << col))
            # horizontal: occupies this and next column of this row
            if col + 1 < m and not ((mask >> (col + 1)) & 1) and not ((cur_row >> (col + 1)) & 1):
                fill(mask, col + 1, cur_row | (1 << col) | (1 << (col + 1)), next_row)

    for mask in range(full):
        fill(mask, 0, 0, 0)

    g = [0] * full
    g[0] = 1
    for _ in range(n):
        ng = [0] * full
        for mask in range(full):
            if g[mask]:
                for nm in transitions[mask]:
                    ng[nm] = (ng[nm] + g[mask]) % MOD
        g = ng
    return g[0]


if __name__ == "__main__":
    print(count_tilings_rowprofile(8, 8))  # 12988816 — matches broken profile
```

Both implementations agree on every input; the broken profile is shorter and its transition is strictly O(1).

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Large dimension used as `m` | `2^m` allocation explodes / OOM. | Swap so `m = min(n, m)` first. |
| Forgot mod | 64-bit overflow → garbage counts. | Reduce after every `+`. |
| Wrong final read | Summed all masks instead of `mask=0`. | Answer is `dp[0]` after all cells; only the empty frontier is a complete tiling. |
| Mixed mask encodings | Used "set on place" and "free bit" conventions together. | Pick one encoding; document the bit meaning; keep the invariant. |
| Vertical/horizontal off the board | Missing `r+1<n` / `c+1<m` guard. | Guard both, and require the right cell free for horizontal. |
| Full-row transitions rebuilt per row | Recomputing `transitions[]` inside the row loop wastes `O(2^m)` each row. | Precompute transitions once before the row loop. |
| Odd area not rejected | Wasted work (still returns 0). | Early `if (n*m)%2: return 0`. |

---

## Performance Analysis

| `m` | `2^m` | states per cell | total ops for `n` rows (`n·m·2^m`) |
|-----|-------|-----------------|-------------------------------------|
| 8 | 256 | 256 | `n · 8 · 256 = 2048 n` |
| 12 | 4096 | 4096 | `n · 12 · 4096 ≈ 49152 n` |
| 16 | 65536 | 65536 | `n · 16 · 65536 ≈ 10^6 n` |
| 18 | 262144 | 262144 | `n · 18 · 262144 ≈ 4.7·10^6 n` |

For `m = 16, n = 1000`, that is `~10^9` raw mask-iterations — but the **zero-skip** (`if dp[mask]==0: continue`) prunes most masks (reachable masks are far fewer than `2^m`), often dropping the real work by an order of magnitude. The single biggest constant-factor win in pure Go/Java/Python is exactly this zero-skip, followed by using a **rolling array** (memory `O(2^m)` instead of `O(n·m·2^m)`).

```python
import time

def benchmark(n, m):
    start = time.perf_counter()
    count_tilings(n, m)
    return time.perf_counter() - start

# Typical: n=1000, m=12 → well under a second in CPython with zero-skip.
```

When `n` is astronomically large (`10^18`) and `m` is tiny, switch to **transfer-matrix exponentiation** (`O(8^m log n)`): the per-step cost rises to cubing a `2^m × 2^m` matrix, but the `n`-dependence drops to `log n`.

---

## Best Practices

- **Rotate first:** `m = min(n, m)` before anything else. This is the dominant correctness-of-performance decision.
- **Roll the array:** keep only `dp` and `ndp` of size `2^m`; do not store all `n·m` layers.
- **Zero-skip** every iteration; reachable masks are sparse.
- **Pick one mask encoding** and write the bit meaning in a comment; most bugs are encoding confusion.
- **Reject odd area** immediately.
- **Validate** against the brute-force backtracking oracle on small grids, against Fibonacci for `2 × n`, and against `8 × 8 = 12988816`.
- **Reach for the transfer matrix** only when `n` is enormous and `m` is tiny; otherwise the linear sweep is simpler and faster.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The fixed-width **frontier window** sliding one cell at a time across the grid.
> - The mask bits flipping on a **vertical** placement (bit set for the cell below) and on a **horizontal** placement (right cell consumed), and clearing when the sweep advances past a filled cell.
> - The running per-mask counts and how they funnel to `dp[0]` — the final tiling count.

---

## Summary

The broken-profile DP slides a fixed-width `m`-bit window (the frontier) across the grid one cell at a time. At each cell the rule is mechanical: a **filled** cell only advances and clears its bit; a **free** cell branches into *place vertical* (set the below-cell bit, if there is a row below) or *place horizontal* (consume the free right cell). Because every step is O(1), the whole count is `O(n · m · 2^m)` — exponential only in the narrow dimension, so always rotate to `m = min(n, m)`. The full-row profile is an equivalent formulation that advances a whole row per step; it is the conceptual stepping stone to the **transfer-matrix** view, where a fixed `2^m × 2^m` matrix `T` maps row-occupancy to row-occupancy and `(T^n)[0][0]` is the tiling count — computable in `O(log n)` by matrix exponentiation when `n` is astronomically large and `m` is tiny. Master the broken profile and you can extend it to trominoes, blocked cells, and grid independent sets with only local rule changes.

### Key takeaways

- The mask is **exactly `m` bits** at every cell because the staircase frontier always has `m` cells — a uniform sliding window, no row-boundary special cases.
- The transition is **O(1)**: filled→advance, free→{vertical, horizontal}, guarded by `r+1<n` / `c+1<m` and right-cell-free.
- **Rotate so `m = min(n, m)`** — the cost is exponential only in `m`; this single decision dominates feasibility.
- The **broken profile** is the full-row profile with the row-fill enumeration unrolled into `m` O(1) micro-steps.
- The **transfer matrix** `T` (`2^m × 2^m`) turns the row recurrence into `(T^n)[0][0]`; exponentiate it only when `n` is astronomical and `m` is tiny.
- Validate against the brute-force oracle, the Fibonacci `2 × n` closed form, and `8 × 8 = 12988816`.
- The same skeleton, with a different per-cell rule and possibly a wider alphabet, counts grid independent sets and proper colorings — profile DP is about *local constraints summarized by a fixed-width frontier*, not dominoes specifically.
