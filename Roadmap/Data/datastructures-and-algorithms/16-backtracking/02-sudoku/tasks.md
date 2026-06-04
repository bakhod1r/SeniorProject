# Sudoku Solver (Backtracking + Constraint Propagation) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the backtracking / bitmask / propagation logic and validate against the evaluation criteria.
> **Always validate a solved grid with a validity checker, and verify uniqueness with a solution counter capped at 2, before trusting any solver output.**

---

## Beginner Tasks (5)

### Task 1 — Legality check for a single placement

**Problem.** Implement `legal(grid, r, c, d)` returning whether digit `d` (1-9) can be placed at empty cell `(r, c)` without clashing with its row, column, or 3×3 box.

**Input / Output spec.**
- Read the 9×9 grid (`0` = empty), then `r`, `c`, `d`.
- Print `true` or `false`.

**Constraints.**
- `0 ≤ r, c ≤ 8`, `1 ≤ d ≤ 9`, the target cell is empty.

**Hint.** Box origin is `((r/3)*3, (c/3)*3)`. Check all 9 cells of the row, all 9 of the column, and the 9 of the box.

**Starter — Go.**
```go
package main

import "fmt"

func legal(g [9][9]int, r, c, d int) bool {
	// TODO: check row, column, and 3x3 box
	return false
}

func main() {
	var g [9][9]int
	for i := 0; i < 9; i++ {
		for j := 0; j < 9; j++ {
			fmt.Scan(&g[i][j])
		}
	}
	var r, c, d int
	fmt.Scan(&r, &c, &d)
	fmt.Println(legal(g, r, c, d))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static boolean legal(int[][] g, int r, int c, int d) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int[][] g = new int[9][9];
        for (int i = 0; i < 9; i++)
            for (int j = 0; j < 9; j++) g[i][j] = sc.nextInt();
        int r = sc.nextInt(), c = sc.nextInt(), d = sc.nextInt();
        System.out.println(legal(g, r, c, d));
    }
}
```

**Starter — Python.**
```python
import sys


def legal(g, r, c, d):
    # TODO
    return False


def main():
    data = iter(sys.stdin.read().split())
    g = [[int(next(data)) for _ in range(9)] for _ in range(9)]
    r, c, d = int(next(data)), int(next(data)), int(next(data))
    print(str(legal(g, r, c, d)).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct box-origin formula `((r/3)*3, (c/3)*3)`.
- Returns `false` if `d` appears in the row, column, or box; `true` otherwise.
- Verified by hand on a small example.

---

### Task 2 — Plain backtracking solver

**Problem.** Implement `solve(grid)` that fills the grid in place using plain backtracking (try 1-9 in each empty cell, check legality, recurse, undo). Assume a solution exists.

**Input / Output spec.**
- Read the 9×9 grid. Print the solved grid, 9 rows of 9 space-separated digits.

**Constraints.** Valid puzzle with at least one solution.

**Hint.** Find the first empty cell; if none, return `true`. Otherwise try each legal digit, recurse, and restore on failure.

**Starter — Python.**
```python
def find_empty(g):
    for r in range(9):
        for c in range(9):
            if g[r][c] == 0:
                return r, c
    return None


def solve(g):
    cell = find_empty(g)
    if cell is None:
        return True
    r, c = cell
    for d in range(1, 10):
        if legal(g, r, c, d):     # reuse Task 1's legal()
            g[r][c] = d
            if solve(g):
                return True
            g[r][c] = 0           # undo
    return False
```

**Evaluation criteria.**
- Output passes a validity check (each row/col/box is `1..9` once).
- Givens are unchanged.
- Returns the (a) solution; for proper puzzles it is the unique one.

---

### Task 3 — Bitmask candidate set

**Problem.** Implement `candidates(grid, r, c)` that returns the 9-bit mask of digits legal at empty cell `(r, c)`, using `rowMask/colMask/boxMask` built from the grid.

**Input / Output spec.**
- Read the grid, then `r`, `c`. Print the candidate digits in increasing order, space-separated (empty line if none).

**Constraints.** `(r, c)` is empty.

**Hint.** `used = rowMask[r] | colMask[c] | boxMask[box]`; `cand = ~used & 0x1FF`. Iterate set bits with `bit = m & -m`.

**Worked check.** If a cell's row, column, and box together use `{3,5,7,9}`, the candidate mask is the other five digits `{1,2,4,6,8}`.

**Evaluation criteria.**
- Always `& 0x1FF` after complement (no phantom high-bit candidates).
- Output digits match a brute-force "try 1-9 and test legality" reference.

---

### Task 4 — MRV cell selection

**Problem.** Implement `find_mrv(grid)` that returns the empty cell `(r, c)` with the fewest candidates (and its candidate mask), or signals "no empty cell." Break ties by scan order.

**Input / Output spec.**
- Read the grid. Print `r c count` of the chosen cell, or `none` if the grid is full.

**Constraints.** Standard 9×9.

**Hint.** Scan all empties, track the minimum candidate count; early-exit on a cell with ≤1 candidate.

**Evaluation criteria.**
- Picks a cell with the global minimum candidate count.
- Returns "none" on a full grid; returns a 0-candidate cell (count 0) if one exists (a contradiction signal).

---

### Task 5 — Validity checker for a partial grid

**Problem.** Implement `is_valid(grid)` for a possibly-partial grid: no digit repeats in any row, column, or box (empty cells ignored). Return `true`/`false`.

**Input / Output spec.**
- Read the grid. Print `true`/`false`.

**Constraints.** Entries in `0..9`.

**Hint.** For each of the 27 units, track a `seen` bitmask; a repeat means a bit is already set.

**Evaluation criteria.**
- Detects a duplicate in a row, a column, and a box (test all three).
- Treats `0` as empty and ignores it.
- Returns `true` for the canonical puzzle's givens.

---

## Intermediate Tasks (5)

### Task 6 — Backtracking + MRV + bitmasks (fast solver)

**Problem.** Combine Tasks 2-5 into a fast solver: maintain `rowMask/colMask/boxMask` incrementally, select cells by MRV, and iterate candidate bits. Solve and print the grid.

**Constraints.** Any valid 9×9 puzzle, including hard 17-clue puzzles.

**Hint.** `place`/`unplace` must update the grid *and* all three masks symmetrically. Treat a 0-candidate MRV cell as immediate failure.

**Reference oracle (Python) — validate the output.**
```python
def is_valid_complete(g):
    for i in range(9):
        if sorted(g[i]) != list(range(1, 10)):
            return False
        if sorted(g[r][i] for r in range(9)) != list(range(1, 10)):
            return False
    for br in range(0, 9, 3):
        for bc in range(0, 9, 3):
            box = [g[br + i][bc + j] for i in range(3) for j in range(3)]
            if sorted(box) != list(range(1, 10)):
                return False
    return True
```

**Evaluation criteria.**
- Output passes `is_valid_complete`.
- Solves a hard 17-clue puzzle in well under a millisecond.
- Masks restored exactly on every backtrack (no drift).

---

### Task 7 — Constraint propagation: naked singles

**Problem.** Implement `propagate_naked(grid)` that repeatedly fills every cell with exactly one candidate until none remain, returning `False` if a contradiction (0-candidate cell) appears.

**Constraints.** Standard 9×9.

**Hint.** Loop with a "made progress" flag; a cell's candidate mask `m` is a naked single iff `m != 0 and m & (m-1) == 0`.

**Reference (Python).**
```python
def propagate_naked(g, row, col, box):
    changed = True
    while changed:
        changed = False
        for r in range(9):
            for c in range(9):
                if g[r][c] == 0:
                    m = ~(row[r] | col[c] | box[bx(r, c)]) & 0x1FF
                    if m == 0:
                        return False           # contradiction
                    if m & (m - 1) == 0:       # exactly one candidate
                        d = m.bit_length()
                        g[r][c] = d
                        b = 1 << (d - 1)
                        row[r] |= b; col[c] |= b; box[bx(r, c)] |= b
                        changed = True
    return True
```

**Evaluation criteria.**
- Easy puzzles are fully or nearly solved by naked singles alone.
- Returns `False` on a grid with a 0-candidate cell.
- Reaches a fixpoint (stops when a full pass changes nothing).

---

### Task 8 — Constraint propagation: hidden singles

**Problem.** Implement `propagate_hidden(grid)` that places, for each unit, any digit that is a candidate in exactly one empty cell of that unit. Combine with naked singles into a full propagation pass.

**Constraints.** Standard 9×9.

**Hint.** For each of the 27 units and each digit `d` not yet in the unit, collect the empty cells where `d` is a candidate; if exactly one, place it. Loop naked+hidden to a fixpoint.

**Reference oracle (Python).**
```python
def solved_by_singles(grid):
    # returns True iff naked+hidden singles alone complete the grid
    # (use your propagate_naked + propagate_hidden to a fixpoint, then check fullness)
    ...
```

**Evaluation criteria.**
- Places hidden singles that naked-single scanning misses.
- Combined propagation solves many medium puzzles with zero guessing.
- Correctly skips digits already present in a unit.

---

### Task 9 — Uniqueness check (count solutions, cap at 2)

**Problem.** Implement `count_solutions(grid, limit=2)` returning the number of solutions, stopping at `limit`. Use it to classify a puzzle as `UNSOLVABLE` (0), `PROPER` (1), or `MULTIPLE` (≥2).

**Constraints.** `1 ≤ given clues`; grid may be sparse.

**Hint.** Backtracking counter with MRV; accumulate solution counts and break when the total reaches `limit`. Never enumerate all solutions of a sparse grid.

**Reference oracle (Python).**
```python
def brute_count(grid, limit=2):
    # plain (no MRV) backtracking counter, for cross-checking on small/easy inputs
    ...
```

**Evaluation criteria.**
- Returns 1 for the canonical proper puzzle.
- Returns ≥2 for a puzzle with a known second solution (e.g. remove a key clue).
- Returns 0 for an over-constrained/invalid grid.
- Caps at 2 (does not attempt full enumeration).

---

### Task 10 — Pretty-print and parse a puzzle string

**Problem.** Parse a Sudoku from an 81-character string (digits `1-9`, `.` or `0` for empty) into a grid, and pretty-print a grid with box separators. Implement `parse(s)` and `pretty(grid)`.

**Constraints.** Input string length exactly 81.

**Hint.** Map index `i` to `(i//9, i%9)`. Pretty-print with `+-------+-------+-------+` separators every 3 rows and `|` every 3 columns.

**Evaluation criteria.**
- Round-trips: `pretty(parse(s))` shows the same digits as `s`.
- Handles both `.` and `0` as empty.
- Rejects strings not of length 81 with a clear error.

---

## Advanced Tasks (5)

### Task 11 — Dancing Links (Algorithm X) solver

**Problem.** Implement a DLX-based exact-cover solver for Sudoku: build the 324-column / up-to-729-row matrix, run Algorithm X with the smallest-column heuristic, and extract the solved grid. Support counting solutions (cap at 2).

**Constraints.** Standard 9×9; must handle givens by pre-covering their rows.

**Hint.** Columns: 4 families × 81 (cell, row-number, column-number, box-number). Each candidate `(r,c,d)` sets exactly 4 columns. `cover`/`uncover` must be exact mirror operations; uncover in reverse order of cover.

**Evaluation criteria.**
- Produces the same solution as the bitmask MRV solver (cross-engine agreement).
- Counting (cap 2) agrees with Task 9 on proper, multiple, and unsolvable inputs.
- Backtracking is allocation-free during search (structure built once).

---

### Task 12 — Proper puzzle generator

**Problem.** Implement `generate(target_clues)` that produces a proper (unique-solution) puzzle: make a random full grid, then dig holes in random order, re-checking uniqueness after each removal and reverting any removal that breaks it.

**Constraints.** `target_clues ≥ 17` (the proven minimum). Seed the RNG for reproducibility.

**Hint.** Random full grid = solve an empty grid with shuffled candidate order. Dig: for each cell in random order, blank it, check `count_solutions(2) == 1`, revert if not. Optionally dig symmetric pairs.

**Reference skeleton (Python).**
```python
import random


def generate(target_clues, seed=42):
    rng = random.Random(seed)
    grid = random_full_grid(rng)          # solve empty grid, shuffled candidates
    cells = [(r, c) for r in range(9) for c in range(9)]
    rng.shuffle(cells)
    clues = 81
    for r, c in cells:
        if clues <= target_clues:
            break
        saved = grid[r][c]
        grid[r][c] = 0
        if count_solutions_fresh(grid) != 1:   # rebuild masks + count, cap 2
            grid[r][c] = saved                 # revert: removal broke uniqueness
        else:
            clues -= 1
    return grid
```

**Evaluation criteria.**
- Output is always proper (`count_solutions == 1`).
- Reproducible with a fixed seed.
- Uniqueness is checked after *every* removal against the current grid, not the original.
- Never drops below a feasible clue count for that grid.

---

### Task 13 — Difficulty classifier (logic tiers)

**Problem.** Implement `classify(grid)` returning a difficulty label by applying human techniques in increasing order and reporting the hardest needed: `EASY` (naked singles only), `MEDIUM` (hidden singles), `HARD` (locked candidates / pairs), or `REQUIRES_SEARCH` (singles+ stall, guessing needed).

**Constraints.** Standard 9×9 proper puzzle.

**Hint.** Apply the cheapest applicable technique to a fixpoint; escalate only when stuck. The label is the highest tier used (plus "requires search" if even the implemented techniques stall before completion).

**Evaluation criteria.**
- An easy puzzle classifies as `EASY`; a puzzle needing hidden singles as `MEDIUM`.
- A puzzle the implemented techniques cannot finish reports `REQUIRES_SEARCH`.
- Difficulty is based on *techniques*, not solver node count.

---

### Task 14 — Generalized N²×N² solver

**Problem.** Generalize the bitmask MRV solver to order `n` (grid `N×N`, `N = n²`, `n×n` boxes). For `n = 2` (4×4), `n = 3` (9×9), and `n = 4` (16×16), solve a given puzzle. Use `N`-bit masks.

**Constraints.** `2 ≤ n ≤ 4`; masks need up to `N` bits (use 64-bit integers for `N ≤ 16`... `N=16` needs 16 bits, fine).

**Hint.** Replace hard-coded `9`, `3`, `0x1FF` with `N`, `n`, and `(1<<N)-1`. Box id = `(r/n)*n + c/n`. The same backtracking + MRV logic carries over unchanged.

**Degree sanity check.** A 4×4 puzzle is trivial; a 16×16 puzzle is meaningfully harder and exercises the mask width. Assert each unit ends as a permutation of `1..N`.

**Evaluation criteria.**
- Solves 4×4, 9×9, and 16×16 puzzles correctly (validity check generalized to `N`).
- Mask width and box formula correct for each `n`.
- Same code path for all `n` (no per-size special cases beyond constants).

---

### Task 15 — Decide the right tool

**Problem.** Implement `classify_approach(task)` (or a short analysis) that, given a request, returns the best approach: `BACKTRACK_MRV` (solve one puzzle), `DLX` (enumerate/count all solutions, generator inner loop), `PROPAGATION_RATER` (difficulty/hints), `VALIDATE_ONLY` (just check a grid), or `INTRACTABLE_GENERAL` (generalized N²×N² worst case is NP-complete). Justify each.

**Constraints / cases to handle.**
- Solve a single human 9×9 puzzle → `BACKTRACK_MRV`.
- Count all solutions / verify uniqueness at scale → `DLX`.
- Rate difficulty or give hints → `PROPAGATION_RATER`.
- Check a user-entered grid is legal → `VALIDATE_ONLY`.
- Worst-case generalized solvability → `INTRACTABLE_GENERAL` (NP-complete).

**Hint.** Encode the decision rules from `senior.md` and `professional.md`. The trap is treating uniqueness checking as trivial — it is NP-complete in the generalized setting and needs a real (capped) search.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `INTRACTABLE_GENERAL` branch cites the NP-completeness of generalized Sudoku.
- Justification references the right method and cost (bitmask MRV, exact-cover DLX, propagation tiers).

---

## Benchmark Task

### Task B — Plain vs MRV vs propagation+MRV node counts

**Problem.** Empirically compare three solver configurations on a fixed set of puzzles by **counting nodes** (recursive calls) and wall-clock time:

- **(a) Fixed-order backtracking** — fill the first empty cell, try 1-9.
- **(b) MRV + bitmasks** — fill the fewest-candidate cell.
- **(c) Propagation (singles) + MRV** — propagate to a fixpoint before each guess.

Run on an easy puzzle, a medium puzzle, and a hard 17-clue puzzle (fixed inputs). Report node counts and times in a table; identify how much MRV and propagation each reduce the search.

**Starter — Python.**
```python
import time

PUZZLES = {
    "easy": "...",     # 81-char strings; fill with real puzzles
    "medium": "...",
    "hard17": "...",
}


def parse(s):
    return [[0 if ch in ".0" else int(ch) for ch in s[i * 9:(i + 1) * 9]]
            for i in range(9)]


def solve_fixed(grid, stats):
    # TODO: fixed-order backtracking; stats["nodes"] += 1 per call
    return True


def solve_mrv(grid, masks, stats):
    # TODO: MRV + bitmasks
    return True


def solve_prop_mrv(grid, masks, stats):
    # TODO: propagate singles to fixpoint, then MRV-guess
    return True


def bench(fn, factory, n=5):
    best = float("inf")
    for _ in range(n):
        args, stats = factory()
        start = time.perf_counter()
        fn(*args, stats)
        best = min(best, time.perf_counter() - start)
    return best, stats["nodes"]


def main():
    print("puzzle   config        nodes      ms")
    for name, s in PUZZLES.items():
        # TODO: wire up the three configs and print a row each
        pass


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same fixed puzzles produce the same node counts across Go, Java, and Python.
- MRV (b) shows far fewer nodes than fixed order (a) on the hard puzzle (often 1-3 orders of magnitude).
- Propagation+MRV (c) shows the fewest guesses; easy/medium puzzles approach zero guesses.
- Report includes node counts *and* time, and uses fixed inputs (does not time parsing).
- Writeup: a short note on how much MRV and propagation each saved and why (branching factor, early contradiction detection).

---

## General Guidance for All Tasks

- **Always validate solved output.** Run a complete-grid validity check (each of the 27 units is a permutation of `1..9`) before trusting any solver. A solved grid is opaque; one wrong cell looks like any other digit.
- **Verify uniqueness with a capped counter.** Use `count_solutions(grid, limit=2)`; never attempt to enumerate all completions of a sparse grid (there are ~6.67 × 10²¹ full grids).
- **Get `place`/`unplace` symmetric.** The most common backtracking bug is leaving a mask bit set after restoring the grid cell. Write them as a matched pair.
- **Box index = `(r/3)*3 + c/3`.** Not `r/3 + c/3`. Generalize to `(r/n)*n + c/n` for order `n`.
- **Always `& 0x1FF` after complementing** the used mask, or stray high bits become phantom candidates and corrupt MRV counts.
- **Separate solving from generation.** Inject candidate ordering (deterministic vs shuffled) and seed RNGs explicitly for reproducible puzzle sets.
- **Match the engine to the job.** Bitmask MRV for solving, DLX for enumeration/uniqueness at scale, propagation tiers for difficulty/hints.
- **Reuse the `place`/`unplace` pair and the `candidates` helper across tasks.** Most tasks build on Tasks 1-5; write those carefully once and compose them.
- **Cross-check engines.** Once you have both a bitmask solver (Task 6) and DLX (Task 11), assert they produce the same solution and the same solution count on the same inputs — the strongest single correctness check.
- **Use the 81-character string format** (Task 10) for test fixtures; it makes puzzle corpora compact and easy to diff across languages.

## Suggested Progression

A sensible order to tackle these: start with Tasks 1-5 (the building blocks: legality, plain backtracking, candidates, MRV, validation). Combine them into the fast solver of Task 6. Add the propagation rules (Tasks 7-8) and the uniqueness counter (Task 9), then the I/O helpers (Task 10). The advanced track (Tasks 11-15) builds the professional toolkit: Dancing Links, generation, difficulty rating, generalization, and the meta-skill of choosing the right approach. The benchmark (Task B) ties it together by measuring what MRV and propagation actually save. Each task reuses earlier ones, so a clean, well-tested `place`/`unplace`/`candidates`/`findMRV` foundation pays off throughout.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs (and the same RNG seed for generation tasks).
```