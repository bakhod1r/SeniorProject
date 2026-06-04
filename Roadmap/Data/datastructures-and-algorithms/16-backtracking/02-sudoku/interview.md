# Sudoku Solver (Backtracking + Constraint Propagation) — Interview Preparation

Sudoku is a favorite interview problem because it rewards a single crisp insight — *"it's backtracking: find an empty cell, try each legal digit, recurse, undo on a dead end"* — and then tests whether you can (a) check the three constraints correctly (row, column, **and box**), (b) make it fast with **bitmasks** and the **MRV** heuristic, (c) recognize **constraint propagation** (naked/hidden singles) and the **exact-cover / DLX** reframing, and (d) avoid the classic traps (forgetting the box rule, not undoing on backtrack, assuming a unique solution). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Solve a 9×9 puzzle | backtracking + MRV + bitmasks | microseconds (bounded) |
| Check a cell placement is legal | `rowMask | colMask | boxMask` bit test | O(1) |
| Pick which empty cell to fill next | MRV (fewest candidates) | O(81) per choice |
| Fill cells with no guessing | constraint propagation (singles) | O(81 × passes) |
| Verify exactly one solution | count solutions, cap at 2 | search-bounded |
| Fastest general solver / all solutions | Dancing Links (Algorithm X) | exact cover |
| Generalized `N²×N²` solvability | — | NP-complete |

Core algorithm:

```text
solve():
    cell = findMRV()              # empty cell with fewest candidates
    if no cell: return true       # solved
    if cell has 0 candidates: return false
    for each candidate d:
        place d (grid + row/col/box masks)
        if solve(): return true
        undo d
    return false
```

Key facts:
- **Three constraints:** no repeated digit in any row, column, or 3×3 **box**. Box id = `(r/3)*3 + c/3`.
- **Bitmask:** bit `d-1` set ⇒ digit `d` used. `candidates = ~(row|col|box) & 0x1FF`.
- **MRV** does not change correctness — only the search-tree shape. Biggest speedup on hard puzzles.
- **Uniqueness** = count solutions, stop at 2. A proper puzzle has exactly one.
- **Walks vs simple paths** has no analog here — but "find one" vs "count all / verify unique" does.

---

## Junior Questions (10 Q&A)

### J1. State the rules of Sudoku.
Fill a 9×9 grid with digits 1-9 so that each row, each column, and each 3×3 box contains every digit exactly once. Some cells start filled (givens) and may not be changed.

### J2. What algorithm solves a Sudoku?
Backtracking (depth-first search): find an empty cell, try each digit 1-9 that is legal, recurse, and if the recursion fails, undo the digit and try the next. If no digit works, return failure so the caller backtracks.

### J3. How do you check whether placing digit `d` at `(r, c)` is legal?
Ensure `d` is not already in row `r`, column `c`, or the 3×3 box containing `(r, c)`. The box index is `(r/3)*3 + c/3`.

### J4. What does "backtracking" mean here concretely?
When a branch leads to a state where some empty cell has no legal digit, you undo the most recent placement (restore the cell to empty and revert any bookkeeping) and try the next option. You "back track" up the recursion tree.

### J5. Why is undoing on failure essential?
Each recursive call mutates the shared grid. If you don't restore the cell (and masks) after a failed branch, later branches see phantom values and produce wrong results. Place and undo must be symmetric.

### J6. What is a candidate?
A digit that can legally go in a given empty cell right now — i.e. it does not clash with any digit already in that cell's row, column, or box.

### J7. What is the MRV heuristic?
Minimum Remaining Values: instead of filling the next empty cell, fill the empty cell with the **fewest candidates**. It minimizes branching and catches contradictions early — a large speedup.

### J8. How does a bitmask speed up legality checks?
Keep a 9-bit integer per row, column, and box; bit `d-1` set means digit `d` is present. Then used digits = `row | col | box`, candidates = `~used & 0x1FF`, and counting candidates is one `popcount`. No looping over cells.

### J9. What is a naked single?
An empty cell with exactly one candidate. That digit is forced — you can place it with no guessing. Filling naked singles repeatedly is part of constraint propagation.

### J10. What's the worst-case time complexity?
For the generalized `N²×N²` problem it is exponential (NP-complete). For the fixed 9×9 size with MRV and bitmasks it is effectively constant — microseconds to milliseconds — because the grid is bounded.

---

## Middle Questions (10 Q&A)

### M1. Walk through the bitmask candidate computation.
For cell `(r,c)` in box `b`, `used = rowMask[r] | colMask[c] | boxMask[b]`. Candidates are the complement within 9 bits: `cand = ~used & 0x1FF`. The `& 0x1FF` is mandatory — `~used` sets all high bits, which would otherwise look like phantom candidates.

### M2. Why does MRV give such a large speedup, and does it affect correctness?
It does not affect correctness — it only changes the order of search, not the set of solutions. It speeds things up by minimizing the branching factor at each node (forced single-candidate cells cost nothing) and by detecting zero-candidate contradictions at the shallowest possible depth, pruning huge subtrees.

### M3. What is a hidden single and how does it differ from a naked single?
A hidden single is a digit that can legally go in only one cell of a row/column/box, even if that cell has other candidates. A naked single is a cell with only one candidate. Hidden singles catch placements naked-single scanning misses; together they solve most easy/medium puzzles with no guessing.

### M4. How do you check that a puzzle has exactly one solution?
Count solutions but stop as soon as you find a second (`limit = 2`). Count 0 = unsolvable/invalid, 1 = proper (unique), ≥2 = multiple solutions. You never enumerate all completions of a sparse grid.

### M5. How do you iterate only the candidate digits from a mask?
`bit = m & (-m)` isolates the lowest set bit; the digit is its position (`bit_length()` in Python, `numberOfTrailingZeros + 1` in Java/Go). Then `m &= m - 1` clears it. This visits exactly the legal digits, skipping impossible ones.

### M6. How do you maintain masks across placements?
Incrementally. `place`: set bit `d-1` in row/col/box masks and write the grid. `unplace`: clear the same bit and zero the grid cell. Never recompute masks from the whole grid per call.

### M7. What is constraint propagation and when does it pay off?
Repeatedly applying forced-move logic (naked + hidden singles) to a fixpoint before guessing. It often solves easy puzzles with zero search and drastically reduces guesses on hard ones. It costs per-node overhead, so for a pure speed solver MRV+bitmasks may suffice; for generators and difficulty rating it's essential.

### M8. How do you handle an invalid puzzle (duplicate given)?
Validate the givens first: reject if any digit repeats in a row, column, or box. Otherwise the solver will just report "no solution," which you should distinguish from "invalid input" for the user.

### M9. What's the difference between "find a solution" and "count solutions"?
Finding stops at the first complete grid. Counting continues, accumulating solutions (capped at 2 for uniqueness). The same backtracking skeleton serves both — counting just doesn't return early on the first success.

### M10. How does the box index formula work?
`(r/3)*3 + c/3` with integer division. `r/3` and `c/3` are each 0, 1, or 2 (which band/stack), and `(r/3)*3 + c/3` maps the nine (band, stack) pairs to 0-8. The naive `r/3 + c/3` is wrong (only yields 0-4).

---

## Senior Questions (8 Q&A)

### S1. Explain Algorithm X and Dancing Links.
Algorithm X solves exact cover: pick a column, branch over the rows covering it, cover the columns/rows that conflict, recurse, uncover on backtrack. Dancing Links stores the matrix as a sparse 4-way linked structure; covering splices a node out (`x.up.down=x.down; x.down.up=x.up`) and uncovering writes the node's own pointers back — O(1) and exactly reversible, so backtracking is allocation-free.

### S2. How is Sudoku an exact-cover problem?
324 constraint columns in four families of 81 (cell-filled, row-has-digit, column-has-digit, box-has-digit) and 729 candidate rows ("place digit `d` at `(r,c)`"), each row covering exactly 4 columns. A valid grid is a selection of rows covering every column exactly once. Givens pre-cover their rows.

### S3. When would you use DLX over MRV-backtracking?
When you must enumerate all solutions (uniqueness checking), when a generator hammers the solver and per-solve cost/allocations matter, or for other exact-cover puzzles. For one-off solving of human puzzles, MRV+bitmasks is already instant and simpler.

### S4. How do you generate a proper Sudoku puzzle?
Make a random full grid (solve an empty grid with randomized candidate order). Then dig holes one at a time in random order, re-checking uniqueness (`countSolutions(2) == 1`) after every removal; revert any removal that breaks uniqueness. Optionally enforce symmetric digging.

### S5. How do you rate difficulty?
Not by solver node count (it doesn't match human difficulty). Use a logic-solver that applies human techniques in tiers (singles → locked candidates → pairs/triples → fish → chains) to a fixpoint and reports the hardest technique required. Puzzles needing pure guessing are "diabolical" or improper.

### S6. What's the connection to constraint satisfaction (CSP)?
Sudoku is a finite-domain CSP with `AllDifferent` constraints on each unit. Backtracking is the generic CSP solver, MRV is the most-constrained-variable heuristic, and propagation is local-consistency enforcement. Full GAC on `AllDifferent` (Régin's matching algorithm) generalizes naked/hidden singles.

### S7. How do you make one engine serve both solving and generation?
Separate randomization from the search: inject a candidate-ordering function (deterministic for solving, shuffled for generation), seed the RNG explicitly for reproducibility, and reuse the engine (don't rebuild the DLX matrix per uniqueness check inside the generator loop).

### S8. What is the minimum number of clues, and why does it matter?
17. McGuire et al. (2012) proved by exhaustive search that no proper puzzle has 16 or fewer clues. It bounds how far a generator can dig while keeping uniqueness, and 17-clue puzzles are the stress case where MRV's early-contradiction advantage matters most.

---

## Professional Questions (6 Q&A)

### P1. Is Sudoku NP-complete? Be precise.
The *generalized* `N²×N²` problem is NP-complete (Yato & Seta 2003), by reduction from Latin-square completion. The fixed 9×9 puzzle is constant-size, hence trivially in P. The another-solution (uniqueness) problem is also NP-complete, which is why uniqueness checking is as hard as solving in general.

### P2. How many valid 9×9 grids are there, and why does the number matter operationally?
6,670,903,752,021,072,936,960 ≈ 6.671 × 10²¹ (Felgenhauer & Jarvis 2005); 5,472,730,538 up to symmetry (Russell & Jarvis, via Burnside). It matters because a uniqueness checker must never try to enumerate completions of a sparse grid — cap solution counting at 2.

### P3. Prove that placing a hidden single never loses a solution.
A hidden single is a digit `d` that is a candidate in only one empty cell `x` of a unit `U`. Every solution must place `d` exactly once in `U` (the unit bijection). Since `x` is the only cell of `U` where `d` is legal, every solution sets `g(x)=d`. The placement is implied by all solutions, so pruning the alternatives loses none.

### P4. Why is Dancing Links' undo O(1) and exact?
Covering a node only rewrites its neighbors' pointers and leaves the node's own `up`/`down` pointers intact. Uncovering writes `x.up.down = x; x.down.up = x`, re-creating the original links against the same neighbors. Provided uncovers run in reverse order of covers, the structure is restored bit-for-bit — no allocation, no copying.

### P5. MRV is a heuristic — can it ever be wrong or suboptimal?
It can never be *wrong*: any deterministic cell/column choice yields the same solution set (the correctness induction is independent of the choice). It can be *suboptimal* in node count on constructed adversarial instances, since it has no lookahead. But for Sudoku it is empirically dominant and provably safe to always apply.

### P6. What's an unavoidable set and how does it relate to proper puzzles?
A set of cells of a solved grid whose values can be rearranged into a different valid grid. A clue set yields a proper puzzle only if it intersects (hits) every unavoidable set — otherwise the alternate grid is a second solution. Proper puzzles are exactly hitting sets of the unavoidable-set hypergraph; the minimum hitting-set size over all grids is 17.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you optimized a brute-force search.
Look for a concrete story: a backtracking search that was too slow, a profile pointing at branching factor, the insight to add MRV / propagation / better pruning, and a measured speedup (e.g. millions of nodes to hundreds). Strong answers mention verifying the optimized version against the slow one on the same inputs.

### B2. A teammate's puzzle generator occasionally ships puzzles with two solutions. How do you debug it?
Almost always the uniqueness check is wrong: it checks against the original puzzle instead of the current dug state, or it doesn't re-check after every removal, or it short-circuits incorrectly. Reproduce with a fixed RNG seed, add an assertion that `countSolutions(2) == 1` after each accepted removal, and bisect.

### B3. Design a hint feature for a Sudoku app.
Use a logic-solver that finds the *easiest* applicable human technique (naked/hidden single, then harder) and surfaces it as a hint ("cell (3,5) is a hidden single for 7 in its box"). This needs the propagation/technique machinery, not raw backtracking, so hints match how humans solve.

### B4. How would you explain backtracking to a junior using Sudoku?
Crossword-in-pencil analogy: write a guess, keep filling, and erase back to the last fork when something can't fit. Then introduce MRV ("fill the cell with the fewest options first — fewer ways to go wrong") and the two gotchas: check the box rule too, and always undo on backtrack.

### B5. Your solver service is slow under load generating puzzles. How do you investigate?
Profile allocations and per-solve cost. The usual culprits: rebuilding the DLX matrix per uniqueness check instead of reusing it, copying the whole grid per recursion instead of mutating in place, or an uncapped solution counter. Fix: reuse the engine, mutate-and-restore, cap counting at 2, and parallelize across puzzles.

---

## Coding Challenges

### Challenge 1: Solve a Sudoku (backtracking)

**Problem.** Given a 9×9 grid (`0` = empty), fill it in place so it satisfies all Sudoku constraints. Assume a solution exists.

**Example.** The canonical puzzle below has a unique solution; fill it.

**Approach.** Plain backtracking with an O(1) legality check.

**Go.**
```go
package main

import "fmt"

func legal(g *[9][9]int, r, c, d int) bool {
	for i := 0; i < 9; i++ {
		if g[r][i] == d || g[i][c] == d {
			return false
		}
	}
	br, bc := (r/3)*3, (c/3)*3
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if g[br+i][bc+j] == d {
				return false
			}
		}
	}
	return true
}

func solve(g *[9][9]int) bool {
	for r := 0; r < 9; r++ {
		for c := 0; c < 9; c++ {
			if g[r][c] == 0 {
				for d := 1; d <= 9; d++ {
					if legal(g, r, c, d) {
						g[r][c] = d
						if solve(g) {
							return true
						}
						g[r][c] = 0
					}
				}
				return false // no digit fit: backtrack
			}
		}
	}
	return true // no empty cell: solved
}

func main() {
	g := [9][9]int{
		{5, 3, 0, 0, 7, 0, 0, 0, 0}, {6, 0, 0, 1, 9, 5, 0, 0, 0},
		{0, 9, 8, 0, 0, 0, 0, 6, 0}, {8, 0, 0, 0, 6, 0, 0, 0, 3},
		{4, 0, 0, 8, 0, 3, 0, 0, 1}, {7, 0, 0, 0, 2, 0, 0, 0, 6},
		{0, 6, 0, 0, 0, 0, 2, 8, 0}, {0, 0, 0, 4, 1, 9, 0, 0, 5},
		{0, 0, 0, 0, 8, 0, 0, 7, 9},
	}
	solve(&g)
	for _, row := range g {
		fmt.Println(row)
	}
}
```

**Java.**
```java
public class SolveSudoku {
    static boolean legal(int[][] g, int r, int c, int d) {
        for (int i = 0; i < 9; i++)
            if (g[r][i] == d || g[i][c] == d) return false;
        int br = (r / 3) * 3, bc = (c / 3) * 3;
        for (int i = 0; i < 3; i++)
            for (int j = 0; j < 3; j++)
                if (g[br + i][bc + j] == d) return false;
        return true;
    }

    static boolean solve(int[][] g) {
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                if (g[r][c] == 0) {
                    for (int d = 1; d <= 9; d++)
                        if (legal(g, r, c, d)) {
                            g[r][c] = d;
                            if (solve(g)) return true;
                            g[r][c] = 0;
                        }
                    return false;
                }
        return true;
    }

    public static void main(String[] args) {
        int[][] g = {
            {5, 3, 0, 0, 7, 0, 0, 0, 0}, {6, 0, 0, 1, 9, 5, 0, 0, 0},
            {0, 9, 8, 0, 0, 0, 0, 6, 0}, {8, 0, 0, 0, 6, 0, 0, 0, 3},
            {4, 0, 0, 8, 0, 3, 0, 0, 1}, {7, 0, 0, 0, 2, 0, 0, 0, 6},
            {0, 6, 0, 0, 0, 0, 2, 8, 0}, {0, 0, 0, 4, 1, 9, 0, 0, 5},
            {0, 0, 0, 0, 8, 0, 0, 7, 9},
        };
        solve(g);
        for (int[] row : g) System.out.println(java.util.Arrays.toString(row));
    }
}
```

**Python.**
```python
def legal(g, r, c, d):
    for i in range(9):
        if g[r][i] == d or g[i][c] == d:
            return False
    br, bc = (r // 3) * 3, (c // 3) * 3
    for i in range(3):
        for j in range(3):
            if g[br + i][bc + j] == d:
                return False
    return True


def solve(g):
    for r in range(9):
        for c in range(9):
            if g[r][c] == 0:
                for d in range(1, 10):
                    if legal(g, r, c, d):
                        g[r][c] = d
                        if solve(g):
                            return True
                        g[r][c] = 0
                return False        # no digit fit: backtrack
    return True                      # no empty cell: solved


if __name__ == "__main__":
    g = [
        [5, 3, 0, 0, 7, 0, 0, 0, 0], [6, 0, 0, 1, 9, 5, 0, 0, 0],
        [0, 9, 8, 0, 0, 0, 0, 6, 0], [8, 0, 0, 0, 6, 0, 0, 0, 3],
        [4, 0, 0, 8, 0, 3, 0, 0, 1], [7, 0, 0, 0, 2, 0, 0, 0, 6],
        [0, 6, 0, 0, 0, 0, 2, 8, 0], [0, 0, 0, 4, 1, 9, 0, 0, 5],
        [0, 0, 0, 0, 8, 0, 0, 7, 9],
    ]
    solve(g)
    for row in g:
        print(row)
```

---

### Challenge 2: Bitmask + MRV Solver

**Problem.** Solve the puzzle but using bitmask candidate sets and the MRV heuristic for speed. Return the solved grid.

**Approach.** Maintain `rowMask/colMask/boxMask`; pick the empty cell with the fewest candidates; iterate only candidate bits.

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

type S struct {
	g             [9][9]int
	row, col, box [9]int
}

func box(r, c int) int { return (r/3)*3 + c/3 }

func (s *S) load(g [9][9]int) {
	s.g = g
	for r := 0; r < 9; r++ {
		for c := 0; c < 9; c++ {
			if d := g[r][c]; d != 0 {
				b := 1 << (d - 1)
				s.row[r] |= b; s.col[c] |= b; s.box[box(r, c)] |= b
			}
		}
	}
}

func (s *S) solve() bool {
	best, br, bc, bm, found := 10, 0, 0, 0, false
	for r := 0; r < 9; r++ {
		for c := 0; c < 9; c++ {
			if s.g[r][c] == 0 {
				m := ^(s.row[r] | s.col[c] | s.box[box(r, c)]) & 0x1FF
				cnt := bits.OnesCount(uint(m))
				if cnt < best {
					best, br, bc, bm, found = cnt, r, c, m, true
				}
			}
		}
	}
	if !found {
		return true
	}
	for m := bm; m != 0; m &= m - 1 {
		bit := m & (-m)
		d := bits.TrailingZeros(uint(bit)) + 1
		s.g[br][bc] = d
		s.row[br] |= bit; s.col[bc] |= bit; s.box[box(br, bc)] |= bit
		if s.solve() {
			return true
		}
		s.g[br][bc] = 0
		s.row[br] &^= bit; s.col[bc] &^= bit; s.box[box(br, bc)] &^= bit
	}
	return false
}

func main() {
	var s S
	s.load([9][9]int{
		{5, 3, 0, 0, 7, 0, 0, 0, 0}, {6, 0, 0, 1, 9, 5, 0, 0, 0},
		{0, 9, 8, 0, 0, 0, 0, 6, 0}, {8, 0, 0, 0, 6, 0, 0, 0, 3},
		{4, 0, 0, 8, 0, 3, 0, 0, 1}, {7, 0, 0, 0, 2, 0, 0, 0, 6},
		{0, 6, 0, 0, 0, 0, 2, 8, 0}, {0, 0, 0, 4, 1, 9, 0, 0, 5},
		{0, 0, 0, 0, 8, 0, 0, 7, 9},
	})
	s.solve()
	for _, row := range s.g {
		fmt.Println(row)
	}
}
```

**Java.**
```java
public class BitmaskMRV {
    int[][] g; int[] row = new int[9], col = new int[9], box = new int[9];
    static int box(int r, int c) { return (r / 3) * 3 + c / 3; }

    BitmaskMRV(int[][] g) {
        this.g = g;
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                if (g[r][c] != 0) {
                    int b = 1 << (g[r][c] - 1);
                    row[r] |= b; col[c] |= b; box[box(r, c)] |= b;
                }
    }

    boolean solve() {
        int best = 10, br = -1, bc = -1, bm = 0;
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                if (g[r][c] == 0) {
                    int m = ~(row[r] | col[c] | box[box(r, c)]) & 0x1FF;
                    int cnt = Integer.bitCount(m);
                    if (cnt < best) { best = cnt; br = r; bc = c; bm = m; }
                }
        if (br == -1) return true;
        for (int m = bm; m != 0; m &= m - 1) {
            int bit = m & (-m), d = Integer.numberOfTrailingZeros(bit) + 1;
            g[br][bc] = d;
            row[br] |= bit; col[bc] |= bit; box[box(br, bc)] |= bit;
            if (solve()) return true;
            g[br][bc] = 0;
            row[br] &= ~bit; col[bc] &= ~bit; box[box(br, bc)] &= ~bit;
        }
        return false;
    }

    public static void main(String[] args) {
        int[][] g = {
            {5, 3, 0, 0, 7, 0, 0, 0, 0}, {6, 0, 0, 1, 9, 5, 0, 0, 0},
            {0, 9, 8, 0, 0, 0, 0, 6, 0}, {8, 0, 0, 0, 6, 0, 0, 0, 3},
            {4, 0, 0, 8, 0, 3, 0, 0, 1}, {7, 0, 0, 0, 2, 0, 0, 0, 6},
            {0, 6, 0, 0, 0, 0, 2, 8, 0}, {0, 0, 0, 4, 1, 9, 0, 0, 5},
            {0, 0, 0, 0, 8, 0, 0, 7, 9},
        };
        BitmaskMRV s = new BitmaskMRV(g);
        s.solve();
        for (int[] r : s.g) System.out.println(java.util.Arrays.toString(r));
    }
}
```

**Python.**
```python
def box(r, c):
    return (r // 3) * 3 + c // 3


def solve(g, row, col, bx):
    best, choice = 10, None
    for r in range(9):
        for c in range(9):
            if g[r][c] == 0:
                m = ~(row[r] | col[c] | bx[box(r, c)]) & 0x1FF
                cnt = bin(m).count("1")
                if cnt < best:
                    best, choice = cnt, (r, c, m)
    if choice is None:
        return True
    r, c, mask = choice
    while mask:
        bit = mask & (-mask)
        d = bit.bit_length()
        g[r][c] = d
        row[r] |= bit; col[c] |= bit; bx[box(r, c)] |= bit
        if solve(g, row, col, bx):
            return True
        g[r][c] = 0
        row[r] &= ~bit; col[c] &= ~bit; bx[box(r, c)] &= ~bit
        mask &= mask - 1
    return False


if __name__ == "__main__":
    g = [
        [5, 3, 0, 0, 7, 0, 0, 0, 0], [6, 0, 0, 1, 9, 5, 0, 0, 0],
        [0, 9, 8, 0, 0, 0, 0, 6, 0], [8, 0, 0, 0, 6, 0, 0, 0, 3],
        [4, 0, 0, 8, 0, 3, 0, 0, 1], [7, 0, 0, 0, 2, 0, 0, 0, 6],
        [0, 6, 0, 0, 0, 0, 2, 8, 0], [0, 0, 0, 4, 1, 9, 0, 0, 5],
        [0, 0, 0, 0, 8, 0, 0, 7, 9],
    ]
    row = [0] * 9; col = [0] * 9; bx = [0] * 9
    for r in range(9):
        for c in range(9):
            if g[r][c]:
                b = 1 << (g[r][c] - 1)
                row[r] |= b; col[c] |= b; bx[box(r, c)] |= b
    solve(g, row, col, bx)
    for r in g:
        print(r)
```

---

### Challenge 3: Validity Checker

**Problem.** Given a 9×9 grid (possibly partially filled, `0` = empty), return whether it is currently valid — no digit repeats in any row, column, or box. Empty cells are ignored.

**Approach.** Scan each unit, tracking seen digits with a bitmask; a repeat sets an already-set bit.

**Go.**
```go
package main

import "fmt"

func validUnit(cells []int) bool {
	seen := 0
	for _, d := range cells {
		if d == 0 {
			continue
		}
		bit := 1 << (d - 1)
		if seen&bit != 0 {
			return false
		}
		seen |= bit
	}
	return true
}

func isValid(g [9][9]int) bool {
	for i := 0; i < 9; i++ {
		var rowC, colC []int
		for j := 0; j < 9; j++ {
			rowC = append(rowC, g[i][j])
			colC = append(colC, g[j][i])
		}
		if !validUnit(rowC) || !validUnit(colC) {
			return false
		}
	}
	for br := 0; br < 9; br += 3 {
		for bc := 0; bc < 9; bc += 3 {
			var boxC []int
			for i := 0; i < 3; i++ {
				for j := 0; j < 3; j++ {
					boxC = append(boxC, g[br+i][bc+j])
				}
			}
			if !validUnit(boxC) {
				return false
			}
		}
	}
	return true
}

func main() {
	g := [9][9]int{
		{5, 3, 0, 0, 7, 0, 0, 0, 0}, {6, 0, 0, 1, 9, 5, 0, 0, 0},
		{0, 9, 8, 0, 0, 0, 0, 6, 0}, {8, 0, 0, 0, 6, 0, 0, 0, 3},
		{4, 0, 0, 8, 0, 3, 0, 0, 1}, {7, 0, 0, 0, 2, 0, 0, 0, 6},
		{0, 6, 0, 0, 0, 0, 2, 8, 0}, {0, 0, 0, 4, 1, 9, 0, 0, 5},
		{0, 0, 0, 0, 8, 0, 0, 7, 9},
	}
	fmt.Println(isValid(g)) // true
}
```

**Java.**
```java
public class ValidityChecker {
    static boolean validUnit(int[] cells) {
        int seen = 0;
        for (int d : cells) {
            if (d == 0) continue;
            int bit = 1 << (d - 1);
            if ((seen & bit) != 0) return false;
            seen |= bit;
        }
        return true;
    }

    static boolean isValid(int[][] g) {
        for (int i = 0; i < 9; i++) {
            int[] rowC = new int[9], colC = new int[9];
            for (int j = 0; j < 9; j++) { rowC[j] = g[i][j]; colC[j] = g[j][i]; }
            if (!validUnit(rowC) || !validUnit(colC)) return false;
        }
        for (int br = 0; br < 9; br += 3)
            for (int bc = 0; bc < 9; bc += 3) {
                int[] boxC = new int[9]; int k = 0;
                for (int i = 0; i < 3; i++)
                    for (int j = 0; j < 3; j++) boxC[k++] = g[br + i][bc + j];
                if (!validUnit(boxC)) return false;
            }
        return true;
    }

    public static void main(String[] args) {
        int[][] g = {
            {5, 3, 0, 0, 7, 0, 0, 0, 0}, {6, 0, 0, 1, 9, 5, 0, 0, 0},
            {0, 9, 8, 0, 0, 0, 0, 6, 0}, {8, 0, 0, 0, 6, 0, 0, 0, 3},
            {4, 0, 0, 8, 0, 3, 0, 0, 1}, {7, 0, 0, 0, 2, 0, 0, 0, 6},
            {0, 6, 0, 0, 0, 0, 2, 8, 0}, {0, 0, 0, 4, 1, 9, 0, 0, 5},
            {0, 0, 0, 0, 8, 0, 0, 7, 9},
        };
        System.out.println(isValid(g)); // true
    }
}
```

**Python.**
```python
def valid_unit(cells):
    seen = 0
    for d in cells:
        if d == 0:
            continue
        bit = 1 << (d - 1)
        if seen & bit:
            return False
        seen |= bit
    return True


def is_valid(g):
    for i in range(9):
        if not valid_unit([g[i][j] for j in range(9)]):
            return False
        if not valid_unit([g[j][i] for j in range(9)]):
            return False
    for br in range(0, 9, 3):
        for bc in range(0, 9, 3):
            box_cells = [g[br + i][bc + j] for i in range(3) for j in range(3)]
            if not valid_unit(box_cells):
                return False
    return True


if __name__ == "__main__":
    g = [
        [5, 3, 0, 0, 7, 0, 0, 0, 0], [6, 0, 0, 1, 9, 5, 0, 0, 0],
        [0, 9, 8, 0, 0, 0, 0, 6, 0], [8, 0, 0, 0, 6, 0, 0, 0, 3],
        [4, 0, 0, 8, 0, 3, 0, 0, 1], [7, 0, 0, 0, 2, 0, 0, 0, 6],
        [0, 6, 0, 0, 0, 0, 2, 8, 0], [0, 0, 0, 4, 1, 9, 0, 0, 5],
        [0, 0, 0, 0, 8, 0, 0, 7, 9],
    ]
    print(is_valid(g))  # True
```

---

### Challenge 4: Count Solutions / Uniqueness

**Problem.** Given a 9×9 puzzle, return the number of solutions, capped at 2 (so the result is 0, 1, or 2 meaning "≥2"). Use it to decide whether the puzzle is *proper* (exactly one solution).

**Approach.** Backtracking solution counter with MRV, stopping once the count reaches 2.

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

type C struct {
	g             [9][9]int
	row, col, box [9]int
}

func bx(r, c int) int { return (r/3)*3 + c/3 }

func (s *C) load(g [9][9]int) {
	s.g = g
	for r := 0; r < 9; r++ {
		for c := 0; c < 9; c++ {
			if d := g[r][c]; d != 0 {
				b := 1 << (d - 1)
				s.row[r] |= b; s.col[c] |= b; s.box[bx(r, c)] |= b
			}
		}
	}
}

func (s *C) count(limit int) int {
	best, br, bc, bm, found := 10, 0, 0, 0, false
	for r := 0; r < 9; r++ {
		for c := 0; c < 9; c++ {
			if s.g[r][c] == 0 {
				m := ^(s.row[r] | s.col[c] | s.box[bx(r, c)]) & 0x1FF
				if cnt := bits.OnesCount(uint(m)); cnt < best {
					best, br, bc, bm, found = cnt, r, c, m, true
				}
			}
		}
	}
	if !found {
		return 1
	}
	total := 0
	for m := bm; m != 0; m &= m - 1 {
		bit := m & (-m)
		d := bits.TrailingZeros(uint(bit)) + 1
		s.g[br][bc] = d
		s.row[br] |= bit; s.col[bc] |= bit; s.box[bx(br, bc)] |= bit
		total += s.count(limit)
		s.g[br][bc] = 0
		s.row[br] &^= bit; s.col[bc] &^= bit; s.box[bx(br, bc)] &^= bit
		if total >= limit {
			break
		}
	}
	return total
}

func main() {
	var s C
	s.load([9][9]int{
		{5, 3, 0, 0, 7, 0, 0, 0, 0}, {6, 0, 0, 1, 9, 5, 0, 0, 0},
		{0, 9, 8, 0, 0, 0, 0, 6, 0}, {8, 0, 0, 0, 6, 0, 0, 0, 3},
		{4, 0, 0, 8, 0, 3, 0, 0, 1}, {7, 0, 0, 0, 2, 0, 0, 0, 6},
		{0, 6, 0, 0, 0, 0, 2, 8, 0}, {0, 0, 0, 4, 1, 9, 0, 0, 5},
		{0, 0, 0, 0, 8, 0, 0, 7, 9},
	})
	n := s.count(2)
	fmt.Println(n, "→ proper:", n == 1)
}
```

**Java.**
```java
public class CountSolutions {
    int[][] g; int[] row = new int[9], col = new int[9], box = new int[9];
    static int bx(int r, int c) { return (r / 3) * 3 + c / 3; }

    CountSolutions(int[][] g) {
        this.g = g;
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                if (g[r][c] != 0) {
                    int b = 1 << (g[r][c] - 1);
                    row[r] |= b; col[c] |= b; box[bx(r, c)] |= b;
                }
    }

    int count(int limit) {
        int best = 10, br = -1, bc = -1, bm = 0;
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                if (g[r][c] == 0) {
                    int m = ~(row[r] | col[c] | box[bx(r, c)]) & 0x1FF;
                    int cnt = Integer.bitCount(m);
                    if (cnt < best) { best = cnt; br = r; bc = c; bm = m; }
                }
        if (br == -1) return 1;
        int total = 0;
        for (int m = bm; m != 0; m &= m - 1) {
            int bit = m & (-m), d = Integer.numberOfTrailingZeros(bit) + 1;
            g[br][bc] = d;
            row[br] |= bit; col[bc] |= bit; box[bx(br, bc)] |= bit;
            total += count(limit);
            g[br][bc] = 0;
            row[br] &= ~bit; col[bc] &= ~bit; box[bx(br, bc)] &= ~bit;
            if (total >= limit) break;
        }
        return total;
    }

    public static void main(String[] args) {
        int[][] g = {
            {5, 3, 0, 0, 7, 0, 0, 0, 0}, {6, 0, 0, 1, 9, 5, 0, 0, 0},
            {0, 9, 8, 0, 0, 0, 0, 6, 0}, {8, 0, 0, 0, 6, 0, 0, 0, 3},
            {4, 0, 0, 8, 0, 3, 0, 0, 1}, {7, 0, 0, 0, 2, 0, 0, 0, 6},
            {0, 6, 0, 0, 0, 0, 2, 8, 0}, {0, 0, 0, 4, 1, 9, 0, 0, 5},
            {0, 0, 0, 0, 8, 0, 0, 7, 9},
        };
        int n = new CountSolutions(g).count(2);
        System.out.println(n + " -> proper: " + (n == 1));
    }
}
```

**Python.**
```python
def bx(r, c):
    return (r // 3) * 3 + c // 3


def count(g, row, col, box, limit=2):
    best, choice = 10, None
    for r in range(9):
        for c in range(9):
            if g[r][c] == 0:
                m = ~(row[r] | col[c] | box[bx(r, c)]) & 0x1FF
                cnt = bin(m).count("1")
                if cnt < best:
                    best, choice = cnt, (r, c, m)
    if choice is None:
        return 1
    r, c, mask = choice
    total = 0
    while mask:
        bit = mask & (-mask)
        d = bit.bit_length()
        g[r][c] = d
        row[r] |= bit; col[c] |= bit; box[bx(r, c)] |= bit
        total += count(g, row, col, box, limit)
        g[r][c] = 0
        row[r] &= ~bit; col[c] &= ~bit; box[bx(r, c)] &= ~bit
        if total >= limit:
            break
        mask &= mask - 1
    return total


if __name__ == "__main__":
    g = [
        [5, 3, 0, 0, 7, 0, 0, 0, 0], [6, 0, 0, 1, 9, 5, 0, 0, 0],
        [0, 9, 8, 0, 0, 0, 0, 6, 0], [8, 0, 0, 0, 6, 0, 0, 0, 3],
        [4, 0, 0, 8, 0, 3, 0, 0, 1], [7, 0, 0, 0, 2, 0, 0, 0, 6],
        [0, 6, 0, 0, 0, 0, 2, 8, 0], [0, 0, 0, 4, 1, 9, 0, 0, 5],
        [0, 0, 0, 0, 8, 0, 0, 7, 9],
    ]
    row = [0] * 9; col = [0] * 9; box = [0] * 9
    for r in range(9):
        for c in range(9):
            if g[r][c]:
                b = 1 << (g[r][c] - 1)
                row[r] |= b; col[c] |= b; box[bx(r, c)] |= b
    n = count(g, row, col, box, 2)
    print(n, "-> proper:", n == 1)
```

---

## Final Tips

- Lead with the one-liner: *"It's backtracking — find an empty cell, try each legal digit, recurse, undo on a dead end."*
- Immediately flag the box rule (most candidates forget it) and the **undo on backtrack** (the #1 bug).
- Offer the speedups proactively: **bitmasks** for O(1) checks/enumeration and **MRV** (fewest-candidate cell first) for the big win — and note MRV changes only speed, never correctness.
- If asked about generation/verification, reach for **count solutions capped at 2** (uniqueness) and mention the dig-out generator.
- For "fastest possible," mention **Dancing Links / Algorithm X** and the exact-cover reformulation as the professional method.
- Always offer to verify a solved grid with a validity checker — a solved grid is opaque and one wrong cell looks like any other.
```