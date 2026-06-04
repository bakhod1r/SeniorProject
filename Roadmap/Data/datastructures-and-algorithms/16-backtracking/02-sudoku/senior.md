# Sudoku Solver (Backtracking + Constraint Propagation) — Senior Level

> A 9×9 Sudoku solver is rarely the bottleneck in isolation — but the moment it sits inside a puzzle generator producing millions of candidates, must guarantee uniqueness, has to rate difficulty consistently, or must enumerate all solutions for verification, every design decision (search vs exact-cover, propagation depth, dig-out strategy, difficulty metric, failure handling) becomes a correctness or throughput incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Dancing Links and Algorithm X — Overview and When to Use](#2-dancing-links-and-algorithm-x--overview-and-when-to-use)
3. [Exact-Cover Modeling of Sudoku](#3-exact-cover-modeling-of-sudoku)
4. [Puzzle Generation](#4-puzzle-generation)
5. [Difficulty Rating](#5-difficulty-rating)
6. [Engineering the Search at Scale](#6-engineering-the-search-at-scale)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does backtracking solve Sudoku" but "what system am I building around the solver, and what breaks when I scale it?" A solver shows up in three production guises that share one core but differ sharply in their demands:

1. **A fast single-puzzle solver** — solve an arbitrary valid grid as quickly as possible. MRV + bitmask backtracking (junior/middle) is excellent; Dancing Links is faster and more uniform.
2. **A puzzle generator** — produce *proper* puzzles (unique solution) at a target difficulty, which calls the solver thousands of times (once per dig-out trial) and depends critically on a fast **uniqueness check**.
3. **A difficulty rater / hint engine** — classify a puzzle by the human techniques required, which needs a logic-solver (propagation rules) rather than a raw search.

All three reduce to: *model the constraints, search or propagate, and instrument the result.* The senior decisions are: which solving engine (search vs DLX), how much propagation to bake in, how to generate and verify puzzles correctly, how to rate difficulty reproducibly, and how to test a solver whose output is opaque (one wrong cell looks like any other digit).

This document treats those decisions in production terms. The exact-cover correctness proofs and complexity theory live in [`professional.md`](./professional.md); here we focus on building and operating the system.

---

## 2. Dancing Links and Algorithm X — Overview and When to Use

**Algorithm X** is Knuth's recursive, nondeterministic algorithm for the **exact cover** problem: given a 0/1 matrix, select a subset of rows so that every column has exactly one `1` among the chosen rows. The algorithm:

1. If the matrix has no columns, a solution is complete — record it.
2. Otherwise choose a column `c` (deterministically, the one with the fewest `1`s — this is the MRV analog).
3. For each row `r` that has a `1` in column `c`: include `r` in the partial solution, **cover** all columns `r` touches and all rows conflicting with `r`, recurse, then **uncover** (backtrack).

**Dancing Links (DLX)** is the data-structure trick that makes covering/uncovering fast and *exactly reversible*. The matrix is stored as a sparse structure of nodes linked in four directions (left/right within a row, up/down within a column), with column headers. "Removing" a node from its column splices its vertical neighbors together (`node.up.down = node.down; node.down.up = node.up`); "restoring" it writes the node's own pointers back (`node.up.down = node; node.down.up = node`). Because the removed node still points at its old neighbors, undo is `O(1)` and allocation-free — *the links dance*. This is the senior-level payoff: backtracking with zero copying and perfect, cheap state restoration.

**When DLX wins:**
- **Enumerating *all* solutions** (uniqueness checking, counting) — DLX's uniform structure and cheap undo make it the fastest general method.
- **Generators** that hammer the solver — the per-solve cost and allocation profile matter.
- **Other exact-cover puzzles** — pentominoes, polyomino tiling, N-queens-as-cover — reuse the same engine; only the matrix changes.
- **Worst-case uniformity** — DLX's node count is tightly tied to the search; it avoids the per-node array scans of a grid solver.

**When plain MRV+bitmask backtracking is enough:**
- One-off solving of human puzzles — already microseconds; DLX's complexity is not justified.
- When you want the simplest correct code, or are teaching the algorithm.
- Memory-constrained or no-allocation environments where the DLX node graph is undesirable.

A practical rule: build the **bitmask MRV solver** first (it is the reliable workhorse), and add **DLX** when the generator's throughput or all-solutions enumeration demands it. Both are searches with the same MRV-style column/cell choice; DLX just changes the data structure to make undo free.

### 2.1 The four-direction node structure

Each DLX node carries four pointers (`left`, `right`, `up`, `down`) and a reference to its column header. Nodes in the same matrix row are linked circularly via `left`/`right`; nodes in the same column via `up`/`down`. Column headers form their own circular list off a single `root` sentinel, so "are there columns left?" is `root.right == root`. The structure is *toroidal* (every list wraps around), which removes special-casing for list ends — traversal `for (n = c.down; n != c; n = n.down)` naturally stops at the header. This uniformity is part of why the code, once correct, is short and fast: there are no boundary conditions.

### 2.2 Cover and uncover, precisely

`cover(c)` unlinks column header `c` from the header list, then for every row `r` in column `c`, unlinks each of `r`'s *other* nodes from their columns (decrementing those columns' sizes). `uncover(c)` does the exact reverse, in reverse order. The asymmetry to watch: cover walks `down` then `right`; uncover must walk `up` then `left`. Getting the directions or order wrong corrupts the structure silently — the solver returns wrong or missing solutions with no crash, which is why cross-engine agreement testing (§8) is essential for a DLX implementation.

---

## 3. Exact-Cover Modeling of Sudoku

Sudoku is an exact-cover problem with **324 constraints** (columns) and **729 candidate placements** (rows). The four constraint families, 81 columns each:

| Constraint family | Meaning | Count |
|-------------------|---------|-------|
| **Cell** | each of the 81 cells holds exactly one digit | 81 |
| **Row-number** | each row contains each digit exactly once | 9 × 9 = 81 |
| **Column-number** | each column contains each digit exactly once | 9 × 9 = 81 |
| **Box-number** | each box contains each digit exactly once | 9 × 9 = 81 |

A candidate "place digit `d` at `(r, c)`" is a matrix row that sets exactly **four** columns: the cell constraint `(r, c)`, the row constraint `(r, d)`, the column constraint `(c, d)`, and the box constraint `(box(r,c), d)`. There are `9 × 9 × 9 = 729` such candidate rows. Pre-filled givens are handled by pre-selecting their rows (covering their columns) before the search begins. Choosing the column with the fewest remaining `1`s during the search is precisely MRV transplanted into the exact-cover world — the same heuristic, the same justification (minimize branching, surface contradictions early), now applied to constraints instead of cells. The full correctness argument (why exact cover ≡ valid completion, why cover/uncover is sound) is in `professional.md` §3-§4.

---

## 4. Puzzle Generation

Generating a *proper* puzzle (unique solution) follows a standard pipeline:

1. **Generate a full solved grid.** Start from an empty grid and run the solver with **randomized candidate order** (shuffle the digit order at each branch). The first solution it returns is a uniformly-ish random completed grid. (A common shortcut seeds the diagonal boxes — boxes 0, 4, 8 are mutually independent — with random permutations first, then solves the rest.)
2. **Dig holes.** Remove givens one at a time (in random order). After each removal, run the **uniqueness check** (`countSolutions(limit=2)`): if the puzzle still has exactly one solution, keep the hole; otherwise put the digit back. Continue until no more cells can be removed (or a target clue count / difficulty is reached).
3. **Optionally enforce symmetry.** Many published puzzles remove cells in symmetric pairs (180° rotational symmetry) for aesthetics; dig both cells of a pair and re-check uniqueness.

The cost is dominated by the **uniqueness checks** — one per dig attempt, up to ~64 attempts, each a `countSolutions` call. This is why a fast counter (capped at 2 solutions, with MRV or DLX) is the critical subsystem. Generating a minimal puzzle (no clue removable without losing uniqueness) is straightforward; generating a *17-clue* puzzle (the proven minimum, see `professional.md`) by random digging is extremely unlikely — those are found by dedicated search, not naive hole-digging.

**Key correctness rule:** uniqueness must be checked *after every removal*, against the *current* puzzle, not the original. Removing a cell can turn a unique puzzle into a multi-solution one; the only safe digging keeps the invariant "exactly one solution" true at every step.

### 4.1 Why randomize the full-grid generation

If you always solve the empty grid deterministically (digits tried in `1..9` order), you get the *same* full grid every time, so your puzzles all derive from one solution — a serious bias. Shuffling the candidate order at each branch (or shuffling the digit-to-symbol mapping after a deterministic solve) yields varied grids. A common, fast variant: fill the three diagonal boxes (0, 4, 8) with independent random permutations of `1..9` — they share no row, column, or box, so any combination is consistent — then solve the remaining 54 cells. This seeds randomness cheaply and the solver completes the rest quickly.

### 4.2 Symmetry and aesthetics

Many published puzzles exhibit 180° rotational symmetry in their clue pattern: cell `(r, c)` is a given iff `(8-r, 8-c)` is. To generate such puzzles, dig in symmetric pairs — blank both `(r,c)` and `(8-r,8-c)`, then check uniqueness; revert both if it breaks. Symmetry is purely cosmetic (it does not affect solvability or difficulty intrinsically) but is expected in commercial puzzles. Note that enforcing symmetry reduces how few clues you can reach, since you remove cells two at a time and cannot dig an odd "last" cell except the center.

---

## 5. Difficulty Rating

"Difficulty" for humans is *not* solver node count — a puzzle trivial for backtracking can be hard for a person, and vice versa. Reproducible rating uses a **logic-solver** that applies human techniques in increasing order of difficulty and records the hardest technique needed:

| Tier | Technique | Description |
|------|-----------|-------------|
| 1 (easy) | Naked single, hidden single | One forced candidate per cell / per unit. |
| 2 (medium) | Locked candidates (pointing/claiming) | Candidate eliminations from box-line interactions. |
| 3 (hard) | Naked/hidden pairs, triples | Subset eliminations within a unit. |
| 4 (expert) | X-Wing, Swordfish (fish) | Multi-unit candidate-elimination patterns. |
| 5 (extreme) | XY-Wing, coloring, chains | Inference chains across cells. |
| — (requires guessing) | Backtracking | No human technique resolves it; pure search needed. |

The rater repeatedly applies the cheapest applicable technique to a fixpoint, escalating only when stuck, and the **maximum tier used** (plus counts of each) yields a score. A puzzle that the logic-solver cannot finish without guessing is either "diabolical" or improper. This is why a difficulty rater needs the propagation machinery of `middle.md` extended with subset and fish rules — the raw backtracking solver alone cannot rate puzzles. Generators target difficulty by digging until the rater reports the desired tier, re-checking uniqueness throughout.

### 5.1 Why node count is a poor difficulty proxy

A puzzle that requires an "X-Wing" (a tier-4 technique) might be solved by a backtracking solver in a handful of nodes — the solver simply guesses where a human must reason. Conversely, a puzzle solvable by humans with only singles might, under a *bad* search order, explore many nodes. Node count measures *machine* effort under a particular search strategy; human difficulty measures *which logical inference* is required. They correlate weakly. A rating that ships to users must track techniques, which is why commercial graders embed a substantial logic-solver (often dozens of techniques) rather than timing a backtracking run.

### 5.2 Calibration and consistency

A difficulty score is only useful if it is *reproducible* and *monotone*: the same puzzle always rates the same, and adding a clue never makes a puzzle harder. Achieve this by fixing the technique set and their tier ordering, applying them deterministically (cheapest-first to fixpoint), and recording the hardest technique that fired. Two graders with different technique libraries will disagree on absolute scores; publish the technique set alongside the rating so it is interpretable. For a hint engine, return the *easiest* applicable technique and its target cell, so hints guide the user along the gentlest path rather than revealing the answer.

---

## 6. Engineering the Search at Scale

When the solver runs millions of times (generation, bulk validation, research), constant factors and allocation dominate.

### 6.1 Allocation discipline

A grid solver should mutate a single grid + masks in place and restore on backtrack — never copy the 81-cell grid per recursion. DLX is naturally allocation-free *during* the search: cover/uncover only splice existing nodes; the node graph is built once. Rebuilding the DLX matrix per solve (e.g. inside a generator's inner loop) is a classic throughput regression — build the structure once and re-seed it with the current givens, or keep a reusable arena.

### 6.2 MRV implementation cost

In a grid solver, MRV scans all 81 cells per node. For very hot paths you can keep a priority structure or recompute incrementally, but the O(81) scan is usually fine and far cheaper than the search it saves. In DLX, the "fewest 1s" column is found by walking the (short) header list — `O(columns)` but on a shrinking matrix.

### 6.3 Propagation vs search trade-off

Baking naked/hidden singles into the search (propagate before each guess) reduces node count but adds per-node overhead. For a *generator*, the dominant cost is the uniqueness check, so a lean MRV/DLX counter usually beats a heavy logic-propagation solver. For a *rater*, propagation *is* the product. Match the engine to the job.

### 6.4 Randomization for generation

Generation needs randomized branch order; solving does not. Keep them separable: a `solve(randomize bool)` flag or an injectable candidate-ordering function so the same engine serves both deterministic solving and randomized generation. Seed the RNG explicitly for reproducible puzzle sets.

### 6.5 Parallelism

Bulk validation/generation is embarrassingly parallel across puzzles — shard puzzles across workers, each with its own solver instance and RNG seed. The single-puzzle search itself is sequential (backtracking depends on the previous decision), so parallelism lives across puzzles, not inside one solve, unless you split the top-level branches (rarely worth it for 9×9).

### 6.6 Representing the grid for cache efficiency

Store the grid as a flat `[81]int` (or `[81]byte`) rather than `[9][9]`, indexing `r*9+c`, to keep it in a single contiguous cache line region and avoid pointer-chasing per row. Precompute, once, the peer list of each cell (the 20 cells sharing a unit) and the unit membership tables; these are constant and shared read-only across all solves. In a hot generator loop, the difference between recomputing `boxOf(r,c)` and reading a precomputed table is small but real at millions of solves. The masks (`row`, `col`, `box`) are tiny (`9` ints each) and stay in registers/L1 throughout.

### 6.7 Choosing the engine per workload

| Workload | Engine | Why |
|----------|--------|-----|
| Solve one user puzzle | bitmask MRV | simplest, already instant |
| Generator inner loop (uniqueness) | DLX or lean bitmask counter | per-solve cost dominates; cap at 2 |
| Enumerate all solutions | DLX | uniform structure, cheap undo |
| Difficulty / hints | logic-solver (tiers) | needs human techniques |
| Validate a grid | direct unit check | no search needed |

---

## 7. Code Examples

### 7.1 Go — Dancing Links (Algorithm X) Sudoku solver core

```go
package main

import "fmt"

// DLX node in the toroidal doubly-linked structure.
type node struct {
	left, right, up, down *node
	col                   *column
	rowID                 int // encodes (r, c, d) for solution extraction
}

type column struct {
	node
	size int // number of 1s in this column
	name int
}

type dlx struct {
	root     *column
	cols     []*column
	solution []int
}

func newDLX(numCols int) *dlx {
	d := &dlx{}
	d.root = &column{}
	d.root.left, d.root.right = &d.root.node, &d.root.node
	d.cols = make([]*column, numCols)
	prev := &d.root.node
	for i := 0; i < numCols; i++ {
		c := &column{name: i}
		c.up, c.down = &c.node, &c.node
		c.left, c.right = prev, prev.right
		prev.right.left, prev.right = &c.node, &c.node
		c.col = c
		d.cols[i] = c
		prev = &c.node
	}
	return d
}

// addRow links one matrix row (the columns it sets) and tags it with rowID.
func (d *dlx) addRow(rowID int, colsSet []int) {
	var first *node
	for _, ci := range colsSet {
		c := d.cols[ci]
		n := &node{col: c, rowID: rowID}
		n.up, n.down = c.up, &c.node
		c.up.down, c.up = n, n
		c.size++
		if first == nil {
			first = n
			n.left, n.right = n, n
		} else {
			n.left, n.right = first.left, first
			first.left.right, first.left = n, n
		}
	}
}

func cover(c *column) {
	c.right.left, c.left.right = c.left, c.right
	for i := c.down; i != &c.node; i = i.down {
		for j := i.right; j != i; j = j.right {
			j.down.up, j.up.down = j.up, j.down
			j.col.size--
		}
	}
}

func uncover(c *column) {
	for i := c.up; i != &c.node; i = i.up {
		for j := i.left; j != i; j = j.left {
			j.col.size++
			j.down.up, j.up.down = j, j
		}
	}
	c.right.left, c.left.right = &c.node, &c.node
}

// search returns count of solutions, capped at limit; fills d.solution with the last one.
func (d *dlx) search(limit int) int {
	if d.root.right == &d.root.node {
		return 1 // all columns covered
	}
	// choose column with fewest 1s (MRV analog)
	var best *column
	bestSize := 1 << 30
	for c := d.root.right; c != &d.root.node; c = c.right {
		col := c.col
		if col.size < bestSize {
			bestSize, best = col.size, col
		}
	}
	if bestSize == 0 {
		return 0 // dead column: no row covers it
	}
	count := 0
	cover(best)
	for r := best.down; r != &best.node; r = r.down {
		d.solution = append(d.solution, r.rowID)
		for j := r.right; j != r; j = j.right {
			cover(j.col)
		}
		count += d.search(limit)
		for j := r.left; j != r; j = j.left {
			uncover(j.col)
		}
		d.solution = d.solution[:len(d.solution)-1]
		if count >= limit {
			break
		}
	}
	uncover(best)
	return count
}

// Build the 324-column / up-to-729-row exact cover for a Sudoku grid.
func buildSudoku(grid [9][9]int) *dlx {
	d := newDLX(324)
	col := func(kind, a, b int) int { return kind*81 + a*9 + b }
	for r := 0; r < 9; r++ {
		for c := 0; c < 9; c++ {
			for d0 := 0; d0 < 9; d0++ {
				if grid[r][c] != 0 && grid[r][c] != d0+1 {
					continue // respect the given
				}
				box := (r/3)*3 + c/3
				rowID := (r*9+c)*9 + d0
				d.addRow(rowID, []int{
					col(0, r, c),   // cell
					col(1, r, d0),  // row-number
					col(2, c, d0),  // col-number
					col(3, box, d0), // box-number
				})
			}
		}
	}
	return d
}

func main() {
	puzzle := [9][9]int{
		{5, 3, 0, 0, 7, 0, 0, 0, 0},
		{6, 0, 0, 1, 9, 5, 0, 0, 0},
		{0, 9, 8, 0, 0, 0, 0, 6, 0},
		{8, 0, 0, 0, 6, 0, 0, 0, 3},
		{4, 0, 0, 8, 0, 3, 0, 0, 1},
		{7, 0, 0, 0, 2, 0, 0, 0, 6},
		{0, 6, 0, 0, 0, 0, 2, 8, 0},
		{0, 0, 0, 4, 1, 9, 0, 0, 5},
		{0, 0, 0, 0, 8, 0, 0, 7, 9},
	}
	d := buildSudoku(puzzle)
	fmt.Println("solutions (capped at 2):", d.search(2))
}
```

### 7.2 Java — proper puzzle generator (dig-out with uniqueness)

```java
import java.util.*;

public class Generator {
    // Reuses a bitmask MRV counter (see middle.md) via the Solver class below.
    static final Random RNG = new Random(42);

    static int[][] randomFullGrid() {
        int[][] g = new int[9][9];
        Solver s = new Solver(g);
        s.fillRandom(); // solves an empty grid with randomized candidate order
        return s.grid;
    }

    static int[][] makePuzzle(int targetClues) {
        int[][] g = randomFullGrid();
        List<int[]> cells = new ArrayList<>();
        for (int r = 0; r < 9; r++) for (int c = 0; c < 9; c++) cells.add(new int[]{r, c});
        Collections.shuffle(cells, RNG);
        int clues = 81;
        for (int[] cell : cells) {
            if (clues <= targetClues) break;
            int r = cell[0], c = cell[1], saved = g[r][c];
            g[r][c] = 0;
            int[][] copy = deepCopy(g);
            if (new Solver(copy).countSolutions(2) != 1) {
                g[r][c] = saved;     // removal broke uniqueness → revert
            } else {
                clues--;
            }
        }
        return g;
    }

    static int[][] deepCopy(int[][] g) {
        int[][] c = new int[9][9];
        for (int i = 0; i < 9; i++) c[i] = g[i].clone();
        return c;
    }

    public static void main(String[] args) {
        int[][] p = makePuzzle(30);
        for (int[] row : p) System.out.println(Arrays.toString(row));
    }
}
```

### 7.3 Python — difficulty heuristic (logic tiers vs guessing)

```python
def rate_difficulty(board):
    """Very small rater: applies singles to fixpoint, then reports whether
    the puzzle was solvable by singles alone or required guessing."""
    techniques_used = set()
    progress = True
    while progress:
        progress = False
        # tier 1: naked single
        for r in range(9):
            for c in range(9):
                if board.grid[r][c] == 0:
                    m = board.cand(r, c)
                    if m == 0:
                        return "INVALID"
                    if m & (m - 1) == 0:
                        board.set(r, c, m.bit_length())
                        techniques_used.add("naked_single")
                        progress = True
        # tier 1: hidden single
        if not progress and _hidden_single(board):
            techniques_used.add("hidden_single")
            progress = True
    if all(board.grid[r][c] != 0 for r in range(9) for c in range(9)):
        return "EASY" if techniques_used <= {"naked_single"} else "MEDIUM"
    # singles stalled → harder techniques or guessing required
    return "HARD_OR_REQUIRES_SEARCH"


def _hidden_single(board):
    units = [[(r, c) for c in range(9)] for r in range(9)]
    units += [[(r, c) for r in range(9)] for c in range(9)]
    for br in range(0, 9, 3):
        for bc in range(0, 9, 3):
            units.append([(br + i, bc + j) for i in range(3) for j in range(3)])
    for unit in units:
        for d in range(1, 10):
            bit = 1 << (d - 1)
            if any(board.grid[r][c] == d for r, c in unit):
                continue
            spots = [(r, c) for r, c in unit
                     if board.grid[r][c] == 0 and (board.cand(r, c) & bit)]
            if len(spots) == 1:
                r, c = spots[0]
                board.set(r, c, d)
                return True
    return False
```

---

## 8. Observability and Testing

A solved grid is opaque — one wrong cell looks like any other digit. Build in checks from day one.

| Check | Why |
|-------|-----|
| `isValidComplete(grid)` | Verify all 27 units contain 1-9 exactly once after solving. |
| Re-solve own output | A solved grid fed back must validate and remain a fixed point. |
| Solution count == 1 on proper puzzles | Generator output must be unique; a count of 2 is a generation bug. |
| Givens preserved | The solver must never overwrite a clue. |
| Cross-engine agreement | Bitmask solver and DLX must produce the *same* solution set on the same input. |
| Known-puzzle regression suite | A library of puzzles with known solutions/difficulty/uniqueness. |
| Node/operation counter | Spikes signal a regressed MRV or a missing prune. |

The single most valuable test is a **validator** (`isValidComplete`) run on every solver output: it catches a wrong box formula, a mask desync, and a forgotten constraint instantly. Pair it with a small **regression corpus** of puzzles tagged with their unique solution and difficulty tier.

### 8.1 A property-test battery

```text
for many random proper puzzles P (generated, verified unique):
    sol = solve(P)
    assert isValidComplete(sol)
    assert sol agrees with P on every given
    assert countSolutions(P, limit=2) == 1
    assert bitmaskSolver(P) == dlxSolver(P)        # cross-engine
for known multi-solution grids:
    assert countSolutions(grid, limit=2) >= 2
for known unsolvable grids:
    assert countSolutions(grid, limit=2) == 0
```

These invariants, run on a corpus plus randomized instances, give high confidence. Cross-engine agreement is especially good at catching a subtle bug in one engine that the other does not share.

---

## 9. Failure Modes

### 9.1 Mask / link desync on backtrack
A grid solver that clears the grid cell but leaves a mask bit set (or a DLX that uncovers in the wrong order) corrupts later branches. Mitigation: symmetric `set`/`clear`; in DLX, **uncover in the reverse order of cover** (the loops in §7.1 walk left/up to mirror the right/down cover).

### 9.2 Uniqueness checked against the wrong grid
A generator that checks uniqueness against the original (pre-dig) puzzle rather than the current one ships multi-solution puzzles. Mitigation: re-check after *every* removal, against the current state; revert on failure.

### 9.3 Counting all solutions of a sparse grid
Calling an uncapped solution counter on a near-empty grid attempts to enumerate ~10²¹ grids. Mitigation: always cap at `limit=2` for uniqueness.

### 9.4 Rebuilding the DLX matrix per solve
In a generator's inner loop, reconstructing the 324×729 node graph every uniqueness check dominates runtime and churns the allocator. Mitigation: build once, re-seed givens (cover/uncover the given rows) per check, or use a reusable arena.

### 9.5 Difficulty rated by node count
Using solver node count as the difficulty score gives ratings that do not match human perception. Mitigation: rate by the hardest *human technique* required via a logic-solver (§5).

### 9.6 Overwriting a given
A solver that treats givens as empty (or a candidate generator that emits rows contradicting a given) produces invalid solutions. Mitigation: in the grid solver, never select a non-empty cell; in DLX, pre-cover given rows and emit only consistent candidate rows.

### 9.7 Non-reproducible generation
Unseeded RNG makes generated puzzle sets impossible to reproduce or debug. Mitigation: seed explicitly and log the seed with each puzzle.

### 9.8 Improper-input handling
Feeding a puzzle with a duplicated given (a typo) should yield "0 solutions / invalid," not a crash or a silently wrong fill. Mitigation: validate givens up front and distinguish "invalid input" from "no solution."

---

## 10. Summary

- The **bitmask MRV backtracking** solver (junior/middle) is the reliable workhorse; **Dancing Links / Algorithm X** is the faster, allocation-free engine and the right tool for enumerating all solutions, for generators that hammer the solver, and for other exact-cover puzzles. Both are searches with an MRV-style "fewest options" choice; DLX changes the *data structure* so undo is O(1) via pointer splicing.
- Sudoku as **exact cover**: 324 constraint columns (cell, row-number, column-number, box-number), 729 candidate rows each setting exactly 4 columns; givens pre-cover their rows. Choosing the smallest column is MRV transplanted into exact cover.
- **Generation** = make a random full grid, then dig holes while re-checking uniqueness (`countSolutions(limit=2)`) after every removal; the uniqueness check is the throughput-critical subsystem, so cap it at 2 and keep it allocation-lean.
- **Difficulty rating** uses a *logic-solver* applying human techniques in tiers and recording the hardest needed — not solver node count, which does not match human difficulty.
- **At scale**, mutate in place (no per-recursion grid copies), build the DLX structure once, separate randomized generation from deterministic solving, seed RNGs, and parallelize across puzzles (the single solve is sequential).
- **Test** with a validator on every output, a tagged regression corpus, cross-engine agreement, and property tests for uniqueness/unsolvability. A solved grid is opaque; never claim correctness without the validator.

### Decision summary

- **Solve one human puzzle fast** → bitmask MRV backtracking.
- **Enumerate all solutions / count for uniqueness** → DLX (capped at 2 for uniqueness).
- **Generate proper puzzles** → random full grid + dig-out with per-removal uniqueness check; fast counter is the bottleneck.
- **Rate difficulty / build hints** → logic-solver with tiered human techniques.
- **Bulk generation/validation** → parallelize across puzzles, reuse engines, seed RNGs.
- **Other exact-cover puzzles** → reuse the DLX engine, change only the matrix.

### Operational checklist

- Build the bitmask MRV solver first; reach for DLX only when throughput or all-solutions enumeration demands it.
- Cap every uniqueness check at 2 solutions and re-check after each dig against the *current* grid.
- Mutate in place; never copy the grid per recursion; build the DLX structure once and re-seed it.
- Seed RNGs explicitly and log the seed with each generated puzzle.
- Rate difficulty by human technique tiers, not solver node count.
- Validate every solved output (all 27 units are permutations of 1-9) and keep a cross-engine agreement test.

References to study further: Knuth's *Dancing Links* paper (Algorithm X and DLX), Norvig's constraint-propagation essay, the exact-cover formulation in `professional.md` §3, sibling `01-n-queens` (also expressible as exact cover), and the human-technique taxonomy used by Sudoku grading tools.
```