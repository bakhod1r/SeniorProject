# The 15-Puzzle and 8-Puzzle (IDA* / Heuristic Search) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the heuristic-search logic and validate against the evaluation criteria.
> **Always test the IDA* optimal length against a brute-force BFS on the 8-puzzle before trusting the solver on larger boards.**

---

## Beginner Tasks (5)

### Task 1 — Solvability test (both widths)

**Problem.** Implement `solvable(board, s)` that returns whether a flat board (length `s²`, `0` = blank) can reach the goal. Use inversion parity: odd width → inversions even; even width → `inversions + blankRowFromBottom` even (0-based distance from the bottom row).

**Input / Output spec.**
- Read `s`, then the `s²` board values.
- Print `true` or `false`.

**Constraints.**
- `2 ≤ s ≤ 5`, board is a permutation of `0..s²−1`.

**Hint.** Count inversions over the blank-omitted sequence in `O(N²)`. For even `s`, add `(s−1) − rowFromTop(blank)`.

**Starter — Go.**
```go
package main

import "fmt"

func solvable(board []int, s int) bool {
	// TODO: count inversions (skip 0), apply parity rule for odd/even s
	return false
}

func main() {
	var s int
	fmt.Scan(&s)
	b := make([]int, s*s)
	for i := range b {
		fmt.Scan(&b[i])
	}
	fmt.Println(solvable(b, s))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static boolean solvable(int[] board, int s) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int s = sc.nextInt();
        int[] b = new int[s * s];
        for (int i = 0; i < b.length; i++) b[i] = sc.nextInt();
        System.out.println(solvable(b, s));
    }
}
```

**Starter — Python.**
```python
import sys


def solvable(board, s):
    # TODO
    return False


def main():
    data = iter(sys.stdin.read().split())
    s = int(next(data))
    b = [int(next(data)) for _ in range(s * s)]
    print(str(solvable(b, s)).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct for the solved goal (`true`), and a single-swap board (`false` on odd width).
- Even-width rule includes the blank row.
- `O(N²)` inversion count.

---

### Task 2 — Hamming heuristic

**Problem.** Implement `hamming(board, s)`: count tiles not in their goal cell, excluding the blank. The goal cell of tile `v` is `((v−1)/s, (v−1)%s)`.

**Input / Output spec.**
- Read `s`, then the board. Print the integer Hamming distance.

**Constraints.** `2 ≤ s ≤ 5`.

**Hint.** Tile `v` at index `i` is misplaced iff `i != v−1`. Never count `0`.

**Evaluation criteria.**
- Returns `0` exactly at the goal.
- Excludes the blank.
- Matches a hand count on a small board.

---

### Task 3 — Manhattan heuristic

**Problem.** Implement `manhattan(board, s)`: sum over tiles of `|row − goalRow| + |col − goalCol|`. Exclude the blank.

**Input / Output spec.**
- Read `s`, then the board. Print the integer Manhattan distance.

**Constraints.** `2 ≤ s ≤ 5`.

**Hint.** Goal of tile `v` is `((v−1)/s, (v−1)%s)`; current is `(i/s, i%s)`.

**Reference oracle (Python) — Manhattan must dominate Hamming.**
```python
def check_dominance(board, s):
    return manhattan(board, s) >= hamming(board, s)
```

**Reference oracle (Python) — full Manhattan for cross-check.**
```python
def manhattan_ref(board, s):
    total = 0
    for i, v in enumerate(board):
        if v == 0:
            continue
        goal = v - 1
        total += abs(i // s - goal // s) + abs(i % s - goal % s)
    return total
```

**Evaluation criteria.**
- Returns `0` at the goal.
- `manhattan ≥ hamming` for all boards (admissibility ladder).
- Matches a hand calculation on a `3×3`.

---

### Task 4 — Move generation without reversal

**Problem.** Implement `successors(board, s, prevBlank)` returning all boards reachable by one move, **excluding** the move that returns the blank to `prevBlank`. Pass `prevBlank = −1` at the root.

**Input / Output spec.**
- Given a board, side, and previous blank index, return the list of successor boards (each a new array) plus the new blank index.

**Constraints.** `2 ≤ s ≤ 5`.

**Hint.** Find the blank, try the 4 directions within bounds, skip the target equal to `prevBlank`.

**Reference oracle (Python).**
```python
DR = (-1, 1, 0, 0)
DC = (0, 0, -1, 1)


def successors(board, s, prev_blank):
    out = []
    bl = board.index(0)
    r, c = bl // s, bl % s
    for dr, dc in zip(DR, DC):
        nr, nc = r + dr, c + dc
        if 0 <= nr < s and 0 <= nc < s:
            ni = nr * s + nc
            if ni == prev_blank:
                continue
            nb = list(board)
            nb[bl], nb[ni] = nb[ni], nb[bl]
            out.append((nb, ni))
    return out
```

**Evaluation criteria.**
- Corner blank yields 2 successors; edge yields 3; interior yields 4 (minus the reverse).
- Never includes the reverse move.
- Each successor differs from the input by exactly one swap.

---

### Task 5 — BFS optimal length (8-puzzle ground truth)

**Problem.** Implement `bfsLen(board)` for the 3×3 8-puzzle returning the optimal number of moves to the goal, or `−1` if unsolvable. This is the ground-truth oracle for later tasks.

**Input / Output spec.**
- Read the 9 board values. Print the optimal move count.

**Constraints.** `s = 3` only (181,440 reachable states fit in memory).

**Hint.** Standard BFS over states (use a tuple/string key for the visited set). Stop at the goal.

**Reference oracle (Python).**
```python
from collections import deque

GOAL = (1, 2, 3, 4, 5, 6, 7, 8, 0)
DR = (-1, 1, 0, 0)
DC = (0, 0, -1, 1)


def bfs_len(board):
    start = tuple(board)
    if start == GOAL:
        return 0
    seen = {start}
    q = deque([(start, 0)])
    while q:
        s, d = q.popleft()
        bl = s.index(0)
        r, c = bl // 3, bl % 3
        for dr, dc in zip(DR, DC):
            nr, nc = r + dr, c + dc
            if 0 <= nr < 3 and 0 <= nc < 3:
                ni = nr * 3 + nc
                lst = list(s)
                lst[bl], lst[ni] = lst[ni], lst[bl]
                ns = tuple(lst)
                if ns == GOAL:
                    return d + 1
                if ns not in seen:
                    seen.add(ns)
                    q.append((ns, d + 1))
    return -1
```

**Evaluation criteria.**
- Returns `0` for the solved board, `1` for a one-move scramble.
- Returns `−1` (or never enqueues the goal) for unsolvable boards.
- Used as the oracle in Tasks 6–8.

---

## Intermediate Tasks (5)

### Task 6 — IDA* with Manhattan (8-puzzle)

**Problem.** Implement `solveLen(board)` using IDA* with Manhattan distance, returning the optimal move count for any solvable 8-puzzle. Forbid the reverse move.

**Input / Output spec.**
- Read the 9 board values. Print the optimal move count (assume solvable, or test first).

**Constraints.** `s = 3`, optimal length ≤ 31.

**Hint.** Outer loop raises the bound to the minimum `f` that exceeded it; inner bounded DFS returns `FOUND` (e.g. `−1`) on `h == 0`. Track the previous blank to skip reversals.

**Reference skeleton (Python) — fill in `manhattan` and the DFS body.**
```python
def solve_len(board):
    b = list(board)
    blank = b.index(0)
    bound = manhattan_ref(b, 3)

    def dfs(blank, g, prev):
        h = manhattan_ref(b, 3)
        f = g + h
        if f > bound:
            return f
        if h == 0:
            return -1            # FOUND sentinel
        best = 1 << 30
        r, c = blank // 3, blank % 3
        for dr, dc in zip(DR, DC):
            nr, nc = r + dr, c + dc
            if 0 <= nr < 3 and 0 <= nc < 3:
                ni = nr * 3 + nc
                if ni == prev:
                    continue
                b[blank], b[ni] = b[ni], b[blank]
                t = dfs(ni, g + 1, blank)
                b[blank], b[ni] = b[ni], b[blank]
                if t == -1:
                    return -1
                best = min(best, t)
        return best

    while True:
        t = dfs(blank, 0, -1)
        if t == -1:
            return bound
        if t == 1 << 30:
            return -1
        bound = t
```

**Evaluation criteria.**
- Matches `bfs_len` (Task 5) on 200 random solvable boards.
- Returns `0` at the goal.
- Memory is `O(d)` (no visited set).

---

### Task 7 — IDA* with linear conflict

**Problem.** Add the linear-conflict term to the heuristic (`Manhattan + 2 × conflicts`) and confirm it (a) is admissible and (b) expands no more nodes than plain Manhattan. Count and report nodes expanded for both.

**Input / Output spec.**
- Read the board. Print the optimal length plus node counts for Manhattan vs linear conflict.

**Constraints.** `s = 3` (or small 4×4 for a stretch goal).

**Hint.** A conflict pair = two tiles both belonging to and currently in the same line, but in reversed order; add 2 each.

**Evaluation criteria.**
- Same optimal length as Task 6 (admissible).
- `linearConflict(board) ≥ manhattan(board)` always.
- Node count with linear conflict ≤ node count with Manhattan.

---

### Task 8 — Reconstruct the move sequence

**Problem.** Extend Task 6 to return the actual sequence of moves (list of tile values slid, or directions U/D/L/R), not just the length. Verify by replaying the moves onto the start board and checking it reaches the goal.

**Input / Output spec.**
- Read the board. Print the optimal length, then the move sequence.

**Constraints.** `s = 3`.

**Hint.** Append the moved tile (or direction) to a path list before recursing, pop on backtrack, and capture the path when `h == 0`.

**Evaluation criteria.**
- Replaying the returned moves reaches the goal exactly.
- The sequence length equals the optimal length from BFS.
- Reversal moves never appear consecutively (sanity).

---

### Task 9 — Random solvable board generator

**Problem.** Implement `randomSolvable(s, seed)` that returns a uniformly-random *solvable* board for side `s`. Generate by starting from the goal and applying a long random walk of legal moves (which preserves solvability), or by rejection sampling on the parity test.

**Input / Output spec.**
- Read `s` and `seed`. Print a solvable board.

**Constraints.** `2 ≤ s ≤ 4`.

**Hint.** A random walk from the goal is guaranteed solvable and avoids the parity bookkeeping; use a fixed seed for cross-language determinism.

**Evaluation criteria.**
- Every generated board passes `solvable` (Task 1).
- Same seed → same board across Go, Java, and Python (if using the random-walk method with a shared PRNG spec).
- Covers a range of difficulties.

---

### Task 10 — Incremental Manhattan update

**Problem.** Modify the IDA* DFS to pass `h` down and update it in `O(1)` per move (`new_h = h − dist(tile, from) + dist(tile, to)`) instead of recomputing Manhattan from scratch. Verify the incremental `h` equals the full recompute at every node (assertion in debug mode).

**Input / Output spec.**
- Read the board. Print the optimal length (must match Task 6) and a confirmation that incremental `h` matched the recompute throughout.

**Constraints.** `s = 3` or `s = 4`.

**Hint.** Only the tile that slides into the old blank cell changes its Manhattan contribution; the blank contributes nothing.

**Evaluation criteria.**
- Optimal length unchanged from Task 6.
- Incremental `h == manhattan(board)` at every visited node.
- Measurable speedup over the recompute version.

---

## Advanced Tasks (5)

### Task 11 — Build a 6-tile pattern database

**Problem.** Build an additive pattern database for a chosen 6-tile group of the 15-puzzle by backward 0/1-BFS from the goal (group-tile moves cost 1, others 0). Index by a perfect rank of the group's positions. Serialize the table.

**Input / Output spec.**
- Given the group (list of tile values), build and report the number of entries and the maximum distance.

**Constraints.** `s = 4`, group size 6 (~5.7M placements).

**Hint.** Use a deque for 0/1-BFS: push 0-cost moves to the front, 1-cost to the back. Verify the rank is a bijection (round-trip rank/unrank).

**Evaluation criteria.**
- Table size equals the placement count for the group.
- Distance `0` only at the abstract goal.
- Round-trip rank/unrank is the identity (no collisions).

---

### Task 12 — Disjoint additive heuristic for the 15-puzzle

**Problem.** Combine two (or three) disjoint PDBs (e.g. 7-8 split) by **summing** their values, and add the diagonal-reflection `max` booster. Plug it into IDA* and optimally solve a set of hard 15-puzzle instances.

**Input / Output spec.**
- Read a 15-puzzle board. Print the optimal move count.

**Constraints.** `s = 4`; instances up to ~50 optimal moves should solve quickly.

**Hint.** Disjoint groups + own-group accounting let you sum (not max). Reflection gives a second admissible bound; take the max of direct and reflected.

**Evaluation criteria.**
- Admissible: optimal length matches BFS on small/medium boards reachable by both.
- Sum-of-PDBs `≥` Manhattan on the same board.
- Solves harder instances with far fewer nodes than Manhattan + linear conflict.

---

### Task 13 — Bounded transposition table in IDA*

**Problem.** Add a fixed-size transposition table that cuts a node if the same state was already reached at this IDA* iteration with `g' ≤ g` (sound dominance). Reset/version the table per iteration. Measure node-count reduction while preserving optimality.

**Input / Output spec.**
- Read a board. Print the optimal length and node counts with and without the table.

**Constraints.** `s = 3` or `s = 4`; table capped (e.g. a few million entries).

**Hint.** Key the table by a packed board encoding. Only prune on `g' ≤ g` for the *same* state; never prune across iterations without versioning.

**Evaluation criteria.**
- Optimal length identical to the no-table solver (optimality preserved).
- Node count reduced on boards with many transpositions.
- Table memory stays bounded (does not regress IDA*'s `O(d)` advantage to `O(states)`).

---

### Task 14 — Solver with a node/time budget

**Problem.** Make IDA* abortable: pass a maximum node-expansion budget; if exceeded, return "gave up" rather than running unbounded. This protects a service from pathological inputs (e.g. an 80-move board with a weak heuristic).

**Input / Output spec.**
- Read a board and a budget `B`. Print the optimal length, or `TIMEOUT` if more than `B` nodes were expanded.

**Constraints.** `s = 3` or `s = 4`.

**Hint.** Increment a counter per DFS entry; on exceeding `B`, unwind with a sentinel. Distinguish "no solution" (unsolvable) from "budget exceeded".

**Evaluation criteria.**
- Returns the optimal length when the budget is sufficient.
- Returns `TIMEOUT` (not a wrong answer) when the budget is exhausted.
- Never returns a non-optimal length silently.

---

### Task 15 — Classify the right search method

**Problem.** Implement `classify(s, heuristicStrength, memoryBudget)` returning one of: `BFS` (small board, plenty of memory), `ASTAR` (medium, frontier fits), `IDA_STAR` (large, tight memory), `IDA_STAR_PDB` (hard 15-puzzle), or `UNSOLVABLE_FIRST` (always check parity). Justify each.

**Constraints / cases to handle.**
- `s = 3`, ample memory → `BFS` acceptable (or IDA*).
- `s = 4`, weak heuristic, tight memory → `IDA_STAR`.
- `s = 4`, hard instances → `IDA_STAR_PDB`.
- Any board → run the parity test first (`UNSOLVABLE_FIRST`).

**Hint.** Encode the decision rules from `middle.md` and `senior.md`: memory drives IDA* vs A*; heuristic strength drives Manhattan vs PDB; solvability is always checked first.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- Always prepends the solvability check.
- Justification cites the right complexity (`O(states)` BFS memory vs `O(d)` IDA* memory).

---

## Benchmark Task

### Task B — Heuristic strength vs node count

**Problem.** On a fixed set of seeded solvable 15-puzzle instances, measure the number of nodes IDA* expands under three heuristics: Manhattan, Manhattan + linear conflict, and (if built) additive PDB. Report a table of optimal length, nodes (Manhattan), nodes (linear conflict), and nodes (PDB).

**Starter — Python.**
```python
import random
import time

S = 4
DR = (-1, 1, 0, 0)
DC = (0, 0, -1, 1)


def random_solvable(seed, walk=80):
    r = random.Random(seed)
    b = list(range(1, 16)) + [0]
    blank = 15
    prev = -1
    for _ in range(walk):
        moves = []
        rr, cc = blank // S, blank % S
        for dr, dc in zip(DR, DC):
            nr, nc = rr + dr, cc + dc
            if 0 <= nr < S and 0 <= nc < S:
                ni = nr * S + nc
                if ni != prev:
                    moves.append(ni)
        ni = r.choice(moves)
        b[blank], b[ni] = b[ni], b[blank]
        prev, blank = blank, ni
    return b


def manhattan(b):
    d = 0
    for i, v in enumerate(b):
        if v == 0:
            continue
        d += abs(i // S - (v - 1) // S) + abs(i % S - (v - 1) % S)
    return d


# TODO: linear_conflict(b), pdb_value(b), and an IDA* that counts nodes.


def main():
    print("seed  optimal  nodes_manhattan  nodes_linconf")
    for seed in range(5):
        b = random_solvable(seed)
        # TODO: run IDA* with each heuristic, count nodes, print row
        print(seed, manhattan(b))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same instance across Go, Java, and Python (shared random-walk spec).
- Optimal length identical under all (admissible) heuristics.
- Node count strictly decreases (usually) from Manhattan → linear conflict → PDB.
- Report includes the mean across the instance set and excludes generation time.
- Writeup: a short note on how heuristic strength shrinks the effective branching factor.

---

## General Guidance for All Tasks

- **Always validate against BFS on the 8-puzzle first.** Every IDA* task can be checked against `bfs_len` (Task 5) on small boards; diff the optimal length and only then trust the solver on the 15-puzzle.
- **Check solvability before searching.** Half of random boards are unsolvable; the parity test (Task 1) is `O(N²)` and saves an unbounded failed search.
- **Never inflate the heuristic.** Manhattan, linear conflict, and proper PDBs are admissible; multiplying or otherwise overestimating breaks optimality.
- **Never count the blank.** It is not a tile to place; counting it corrupts Hamming/Manhattan.
- **Forbid the reverse move.** Pass the previous blank index and skip moving back into it.
- **Return the overshoot, not the bound.** On prune return `f`; raise the threshold to the minimum overshoot so IDA* stays optimal and efficient.
- **Make/undo in place.** Swap to move, recurse, swap back — preserves `O(d)` memory and avoids per-node allocation.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
