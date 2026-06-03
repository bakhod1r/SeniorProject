# Minimax and Alpha-Beta Pruning — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the minimax / alpha-beta logic and validate against the evaluation criteria.
> **Always verify alpha-beta against plain minimax on small positions — they must return the identical value. Pruning is lossless; any disagreement is a bug.**

---

## Beginner Tasks (5)

### Task 1 — Detect the winner of a tic-tac-toe board

**Problem.** Implement `winner(board)` for a length-9 board (`1` = X, `-1` = O, `0` = empty). Return `1` if X has three in a row, `-1` if O does, `0` otherwise. Check all 8 lines (3 rows, 3 cols, 2 diagonals).

**Input / Output spec.**
- Read 9 integers (the board, row-major).
- Print `1`, `-1`, or `0`.

**Constraints.** Exactly 9 cells, each in `{-1, 0, 1}`.

**Hint.** Precompute the 8 winning lines as index triples; a line wins if its three cells are equal and nonzero.

**Starter — Go.**
```go
package main

import "fmt"

var lines = [8][3]int{{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}}

func winner(b []int) int {
	// TODO: return 1 if X wins, -1 if O wins, else 0
	return 0
}

func main() {
	b := make([]int, 9)
	for i := range b {
		fmt.Scan(&b[i])
	}
	fmt.Println(winner(b))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static final int[][] LINES = {{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}};

    static int winner(int[] b) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int[] b = new int[9];
        for (int i = 0; i < 9; i++) b[i] = sc.nextInt();
        System.out.println(winner(b));
    }
}
```

**Starter — Python.**
```python
import sys

LINES = [(0,1,2),(3,4,5),(6,7,8),(0,3,6),(1,4,7),(2,5,8),(0,4,8),(2,4,6)]


def winner(b):
    # TODO
    return 0


def main():
    b = list(map(int, sys.stdin.read().split()))[:9]
    print(winner(b))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on hand-built winning rows, columns, and both diagonals.
- Returns `0` for empty and for drawn-full boards.
- Does not falsely report a win for an empty line (three zeros).

---

### Task 2 — Minimax value of a tic-tac-toe position

**Problem.** Given a board and the player to move (`1` = X/MAX, `-1` = O/MIN), return the minimax value from X's perspective by searching to the end of the game. Use `+1 / 0 / -1` for X-win / draw / O-win.

**Input / Output spec.**
- Read 9 integers (the board), then the player (`1` or `-1`).
- Print the minimax value.

**Constraints.** Standard `3×3`; full search.

**Hint.** Make–recurse–undo: set `b[i] = player`, recurse with `-player`, then reset `b[i] = 0`. Check `winner` first, then "board full" (draw).

**Reference oracle (Python) — search to the end.**
```python
def minimax(b, player):
    w = winner(b)
    if w != 0:
        return w
    if all(c != 0 for c in b):
        return 0
    vals = []
    for i in range(9):
        if b[i] == 0:
            b[i] = player
            vals.append(minimax(b, -player))
            b[i] = 0
    return max(vals) if player == 1 else min(vals)
```

**Worked check.** From `[1,1,0, -1,-1,0, 0,0,0]` with player `1` (X to move), X plays cell `2` to complete the top row and win, so the value is `+1`. From `[1,-1,1, -1,1,-1, 0,0,0]` with player `1`, X plays cell `6` or `8` for a diagonal/column — verify the minimax value is `+1` if a forced win exists, else `0`.

**Evaluation criteria.**
- Empty board returns `0` (perfect play draws).
- A board with an immediate winning move for the mover returns `+1` (X) or `-1` (O).
- Matches the reference oracle on random small positions.
- Correctly handles the case where the mover has *no* winning move but can force a draw (returns `0`, not a loss).

---

### Task 3 — Best move for tic-tac-toe

**Problem.** Given a board and the player to move, return the **index** of an optimal move (any move attaining the minimax value). Fold depth into the score so the engine prefers faster wins.

**Input / Output spec.**
- Read the board and the player.
- Print the chosen cell index `0..8`.

**Constraints.** Board must have at least one empty cell.

**Hint.** Run the minimax loop at the top level and remember the argmax (for X) / argmin (for O). Use a win score like `±(10 - depth)` so quicker wins rank higher.

**Worked check.** From `[1,1,0, -1,-1,0, 0,0,0]` with player `1` (X), the optimal move is cell `2` (completing the top row for an immediate win). From the empty board, value is `0`; any first move that keeps the draw is acceptable.

**Evaluation criteria.**
- Always returns a cell achieving the optimal value.
- Prefers an immediate winning move over a delayed one (depth folding works).
- Never returns an occupied cell.

---

### Task 4 — Add alpha-beta and count nodes

**Problem.** Take your Task 2 minimax and add alpha-beta pruning. Count the number of nodes visited with and without pruning on the empty board, and confirm the returned value is unchanged.

**Input / Output spec.**
- No input; run on the empty board.
- Print `value`, `nodes_plain`, `nodes_alphabeta`.

**Constraints.** Standard `3×3`.

**Hint.** At a MAX node update `alpha = max(alpha, best)` and `break` when `alpha >= beta`; at a MIN node update `beta = min(beta, best)` and `break` when `beta <= alpha`. Increment a global counter at each call.

**Reference oracle (Python) — node-counting alpha-beta.**
```python
nodes = 0

def ab(b, player, alpha, beta):
    global nodes
    nodes += 1
    w = winner(b)
    if w != 0:
        return w
    if all(c != 0 for c in b):
        return 0
    if player == 1:
        best = -2
        for i in range(9):
            if b[i] == 0:
                b[i] = 1
                best = max(best, ab(b, -1, alpha, beta))
                b[i] = 0
                alpha = max(alpha, best)
                if alpha >= beta:
                    break
        return best
    best = 2
    for i in range(9):
        if b[i] == 0:
            b[i] = -1
            best = min(best, ab(b, 1, alpha, beta))
            b[i] = 0
            beta = min(beta, best)
            if beta <= alpha:
                break
    return best
```

**Evaluation criteria.**
- `value` is identical for plain minimax and alpha-beta (it must be — pruning is lossless).
- `nodes_alphabeta` is substantially smaller than `nodes_plain`.
- Cutoffs use `>=` / `<=` correctly at the right node types.
- Re-running with a different move order yields the same value but a different node count.

---

### Task 5 — Subtraction game by minimax

**Problem.** A pile of `n` stones; each turn a player removes `1`, `2`, or `3` stones; the player taking the last stone wins. Return `True` if the player to move wins under optimal play, by minimax. Verify against the closed form (lose iff `n % 4 == 0`).

**Input / Output spec.**
- Read `n`. Print `True`/`False`.

**Constraints.** `0 ≤ n ≤ 1000` (use memoization).

**Hint.** A position is a win if **some** move leads to a position that is a loss for the opponent. Base case: `n == 0` means the player to move just lost (opponent took the last stone).

**Reference oracle (Python).**
```python
from functools import lru_cache

@lru_cache(maxsize=None)
def wins(n):
    if n == 0:
        return False
    return any(not wins(n - take) for take in range(1, min(3, n) + 1))
# wins(n) == (n % 4 != 0)
```

**Evaluation criteria.**
- `wins(0)=False`, `wins(4)=False`, `wins(8)=False`; all others up to a bound are `True`.
- Matches `n % 4 != 0` for all `n` in range.
- Memoized so large `n` is instant.

---

## Intermediate Tasks (5)

### Task 6 — Negamax for tic-tac-toe

**Problem.** Reimplement tic-tac-toe search as **negamax** (a single maximizing branch) with alpha-beta. The evaluation must be from the side-to-move's perspective. Confirm the value matches the MAX/MIN minimax from Task 2.

**Constraints.** Standard `3×3`.

**Hint.** Recurse with `v = -negamax(child, -beta, -alpha)`. On a terminal win, the side that *just moved* won, so the value for the side-to-move is negative: return `-(10 - depth)`. Draw returns `0`.

**Evaluation criteria.**
- Single branch (no separate MAX/MIN code).
- Correct bound swap `(-beta, -alpha)`.
- Value matches the MAX/MIN version for every position (translate perspective when comparing).

---

### Task 7 — Connect-style game on a small board (depth-limited)

**Problem.** On a `4×4` board, two players drop into columns (gravity); a player wins with **3 in a row** (horizontal, vertical, or diagonal). Implement depth-limited negamax with alpha-beta and a simple evaluation function (e.g., count of open 2-in-a-rows minus the opponent's). Return the best column for the player to move.

**Constraints.** `4×4` board, win length 3, search depth `≤ 6`.

**Hint.** Moves are the non-full columns. Make a move = drop a disc into the lowest empty cell of a column; unmake = remove it. Use a depth limit and call `eval` at depth 0. Fold depth into terminal win/loss scores.

**Reference oracle (Python) — full search for small depths.**
```python
def negamax(state, depth, alpha, beta):
    w = state.winner()
    if w != 0:
        return -(1000 - state.plies)   # side to move loses if opponent just won
    if state.full() or depth == 0:
        return state.evaluate()        # side-to-move relative heuristic
    best = -10**9
    for col in state.legal_columns():
        state.drop(col)
        v = -negamax(state, depth - 1, -beta, -alpha)
        state.undrop(col)
        best = max(best, v)
        alpha = max(alpha, v)
        if alpha >= beta:
            break
    return best
```

**Evaluation criteria.**
- Finds an immediate winning drop when one exists.
- Blocks an immediate opponent win when forced.
- Alpha-beta value equals plain negamax value at the same depth.

---

### Task 8 — Transposition table for tic-tac-toe

**Problem.** Add a transposition table to your tic-tac-toe negamax, keyed by a packed board + side-to-move. Store the value and the search depth; reuse entries with sufficient depth. Report the node-count reduction versus no TT.

**Constraints.** Standard `3×3`.

**Hint.** Pack the board into a base-3 integer (each cell `-1,0,1` → `0,1,2`) and combine with the side-to-move bit. Probe before searching; store after. Tic-tac-toe transpositions are common (the same position arises via different move orders), so the TT should noticeably cut nodes.

**Evaluation criteria.**
- TT value matches the no-TT value for every position.
- Node count with the TT is lower than without.
- Entry reuse honors the stored depth (do not reuse a too-shallow entry for a deeper requirement).

---

### Task 9 — Iterative deepening with a node budget

**Problem.** Implement iterative deepening on the `4×4` connect game (Task 7): search depth 1, 2, 3, … reusing a transposition table between iterations, until a node budget is exhausted. Return the best move from the deepest completed iteration.

**Constraints.** `4×4` board; node budget passed as a parameter.

**Hint.** Keep the TT across iterations — do not clear it. Track the best move per completed depth; if the budget is exceeded mid-iteration, return the previous iteration's best move (never a half-searched root). Use the previous iteration's TT best-move to order moves in the next.

**Evaluation criteria.**
- TT persists across iterations (verified by a higher hit rate at deeper iterations).
- Returns the best move from the last *completed* depth on budget exhaustion.
- Deeper iterations prune better than they would without the seeded ordering.

---

### Task 10 — Move ordering and its effect on pruning

**Problem.** On the `4×4` connect game, measure the node count of alpha-beta under three move orderings: (a) natural column order, (b) center-first ordering, (c) best-first using the previous iteration's TT move. Report how node counts shrink as ordering improves.

**Constraints.** `4×4` board, fixed depth (e.g., 6).

**Hint.** The value must be identical across all three orderings (ordering never changes the result). Only the node count changes. Center-first usually beats natural order; TT-best-first usually beats center-first, approaching the `O(b^(d/2))` ideal.

**Evaluation criteria.**
- Identical value across all three orderings.
- Strictly non-increasing node counts from (a) → (b) → (c) on average.
- A short writeup relating the measured effective branching factor to `√b`.

---

## Advanced Tasks (5)

### Task 11 — Zobrist hashing with incremental update

**Problem.** Implement Zobrist hashing for tic-tac-toe: precompute random 64-bit keys per (cell, player) plus a side-to-move key. Maintain the position hash incrementally through make/unmake (XOR in/out). Assert that making then unmaking a move restores the original hash, and that two different move orders reaching the same position produce the same hash.

**Constraints.** Standard `3×3`; 64-bit keys; fixed RNG seed for reproducibility.

**Hint.** XOR is its own inverse, so unmake reuses the same XOR as make. Use the hash as the TT key instead of the base-3 pack from Task 8. Different move orders to the same board must collide *intentionally* (that is the point of a transposition).

**Evaluation criteria.**
- Make-then-unmake restores the hash exactly (returns to the start hash).
- Two move orders reaching an identical position yield the same hash.
- The TT keyed by Zobrist hash gives the same values as the base-3-keyed TT.

---

### Task 12 — Quiescence search on a capture game

**Problem.** Define a tiny capture game (e.g., a 1-D board where pieces can capture adjacent enemy pieces, value = piece-count difference). Implement depth-limited negamax with a **quiescence search** that, at the depth limit, continues searching only capture moves until the position is quiet. Compare the evaluation accuracy with and without quiescence on positions with a pending capture at the horizon.

**Constraints.** Small board; depth limit `≤ 4`; quiescence on captures only.

**Hint.** Quiescence uses a **stand-pat** value (the static eval, the option to not capture): if it already exceeds `beta`, cut; otherwise raise `alpha` and try captures. Without quiescence, a position with a pending recapture at the horizon is misvalued (the horizon effect).

**Worked check.** Construct a position where, at the depth limit, the side to move appears up one piece (static eval `+1`) but the opponent has an immediate recapture restoring material (true value `0`). A plain depth-limited search returns `+1`; quiescence searches the recapture and returns `0`. The two-line difference is the horizon error, made concrete.

**Reference oracle (Python) — quiescence skeleton.**
```python
def quiescence(state, alpha, beta):
    stand_pat = state.evaluate()          # option to not capture
    if stand_pat >= beta:
        return beta
    alpha = max(alpha, stand_pat)
    for m in state.capture_moves():
        state.make(m)
        v = -quiescence(state, -beta, -alpha)
        state.unmake(m)
        if v >= beta:
            return beta
        alpha = max(alpha, v)
    return alpha
```

**Evaluation criteria.**
- Quiescence resolves a pending capture that a plain depth-limited search misvalues.
- Stand-pat correctly bounds the quiescence recursion (a quiet position returns its static eval).
- Documents a concrete position where the two evaluations differ.
- Quiescence terminates (capture-only restriction reduces material each ply).

---

### Task 13 — Principal Variation Search (PVS)

**Problem.** Implement PVS on the `4×4` connect game: search the first (best-guess) move with a full window, then search remaining moves with a null window `(alpha, alpha+1)`; on a null-window fail-high, **re-search** with the full window. Confirm the value matches plain alpha-beta and count the node savings.

**Constraints.** `4×4` board; depth `≤ 6`; requires move ordering (TT best move first).

**Hint.** The null-window search is cheap because it only asks "is this move better than `alpha`?" If it answers "yes" (fails high), you do not yet know how much better, so re-search with `(alpha, beta)`. Forgetting the re-search makes the engine reject a genuinely better move.

**Evaluation criteria.**
- Value identical to plain alpha-beta at the same depth.
- Correct re-search on null-window fail-high (no missed better moves).
- Node count lower than plain alpha-beta when ordering is good.

---

### Task 14 — General Nim and Sprague-Grundy verification

**Problem.** Implement two solvers for multi-pile Nim (take any positive number from one pile; last stone wins): (a) the `O(n)` XOR closed form, and (b) a minimax/Grundy solver that computes the Grundy value of each pile and XORs them. Verify both agree, and that they match a brute-force minimax on small inputs.

**Constraints.** `1 ≤ piles ≤ 6`, each pile `≤ 30` for the brute-force check; XOR form handles any size.

**Hint.** For standard Nim, the Grundy value of a pile of size `k` is `k` itself, so the Sprague-Grundy XOR reduces to the plain pile XOR (siblings `14-nim`, `15-sprague-grundy`). The position is a loss for the mover iff the XOR is `0`.

**Evaluation criteria.**
- XOR form and Grundy form agree on all test inputs.
- Both match brute-force minimax for small piles.
- The intractable-vs-tractable insight is noted: Nim needs no tree search.

---

### Task 15 — Classify the right search technique

**Problem.** Given a game description and constraints `(branching_factor, search_depth, has_chance, has_hidden_info, has_closed_form)`, implement `classify(...)` (or write an analysis) that returns one of: `ALPHA_BETA`, `MINIMAX_FULL`, `SPRAGUE_GRUNDY`, `EXPECTIMINIMAX`, `MCTS`, or `NOT_APPLICABLE`. Justify each decision.

**Constraints / cases to handle.**
- Two-player, zero-sum, perfect info, small fully-searchable tree → `MINIMAX_FULL` (or `ALPHA_BETA`).
- Large tree, good eval available → `ALPHA_BETA`.
- Impartial take-away game with algebraic structure → `SPRAGUE_GRUNDY` (no tree).
- Chance nodes (dice) → `EXPECTIMINIMAX`.
- Huge branching, weak eval (Go-like) → `MCTS`.
- Hidden information / cooperative / non-zero-sum → `NOT_APPLICABLE` (for plain minimax).

**Hint.** Encode the decision rules from `middle.md` and `professional.md`. The traps: a closed-form game (Nim) does not need a tree; chance/hidden information break the zero-sum perfect-information assumption minimax requires.

**Evaluation criteria.**
- Correctly classifies all six canonical cases.
- The `NOT_APPLICABLE` branch explicitly cites the broken assumption (chance, hidden info, or non-zero-sum).
- Justification references the right complexity (`O(b^d)`, `O(b^(d/2))`, `O(1)`/`O(n)` for Sprague-Grundy).

---

## Benchmark Task

### Task B — Ordering quality vs node count crossover

**Problem.** Empirically demonstrate how move ordering drives alpha-beta toward the `O(b^(d/2))` ideal. On a fixed game (the `4×4` connect game, or a synthetic uniform `(b, d)` tree with random leaf values), measure the leaves examined under: (a) worst-case ordering, (b) random ordering, (c) perfect ordering (best move first everywhere). Plot leaves examined vs depth and compare to `b^d`, `b^(3d/4)`, and `b^(d/2)`.

**Starter — Python.**
```python
import random
import math


def build_tree(b, d, rng):
    """Full uniform tree of branching b, depth d, with random leaf values."""
    if d == 0:
        return rng.randint(-100, 100)
    return [build_tree(b, d - 1, rng) for _ in range(b)]


leaves = 0


def alphabeta(node, alpha, beta, maximizing, order):
    global leaves
    if not isinstance(node, list):
        leaves += 1
        return node
    children = node[:]
    # TODO: reorder `children` per `order` ("worst", "random", "perfect")
    if maximizing:
        best = -math.inf
        for c in children:
            best = max(best, alphabeta(c, alpha, beta, False, order))
            alpha = max(alpha, best)
            if alpha >= beta:
                break
        return best
    else:
        best = math.inf
        for c in children:
            best = min(best, alphabeta(c, alpha, beta, True, order))
            beta = min(beta, best)
            if beta <= alpha:
                break
        return best


def main():
    rng = random.Random(42)
    b, d = 4, 6
    for order in ("worst", "random", "perfect"):
        global leaves
        leaves = 0
        tree = build_tree(b, d, rng)
        val = alphabeta(tree, -math.inf, math.inf, True, order)
        print(f"order={order:8s} value={val:5d} leaves={leaves:7d} "
              f"b^d={b**d} b^(d/2)={b**(d//2)}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same tree across Go, Java, and Python.
- Value is **identical** across all three orderings (ordering never changes the result).
- Leaf counts: worst ≈ `b^d`, random between, perfect ≈ `b^(d/2)`. Report the measured numbers against the theoretical bounds.
- A short writeup connecting perfect ordering to the Knuth-Moore `b^⌈d/2⌉ + b^⌊d/2⌋ - 1` and the `√b` effective branching factor.

---

## General Guidance for All Tasks

- **Always verify alpha-beta against plain minimax** on small positions. Pruning is lossless: the value must be identical. Any disagreement is a bug (usually a swapped MAX/MIN, a missing negamax bound swap, or a TT bound treated as exact).
- **Get the base cases right.** Check `winner` before "board full"; a board can be full *and* won. For subtraction/Nim games, "no move available" means the player to move just lost.
- **Make–recurse–undo.** Mutate one shared board and restore it; never forget the undo. Copying the board at every node is wasteful and bug-prone.
- **Fold depth into win/loss scores** so the engine prefers faster wins and slower losses (`±(BIG - plies)`).
- **In negamax, evaluate from the side-to-move's perspective** and pass `(-beta, -alpha)` to children. The eval must be antisymmetric.
- **Honor TT entry depth and flags.** Only reuse an entry whose stored depth meets the requirement; treat LOWER/UPPER as bounds, only EXACT as a direct return.
- **Recognize closed-form games.** Nim and impartial take-away games are solved by Sprague-Grundy XOR (siblings `14-nim`, `15-sprague-grundy`) — no tree search needed.
- **Use the empty-board oracle.** For tic-tac-toe, the empty board is a draw (value `0`). Any implementation returning nonzero there has a bug — the cheapest, most decisive sanity check available.
- **Test ordering-invariance.** For any alpha-beta task, re-running with a permuted move order must yield the identical value (only the node count may change). A value that depends on move order signals a bug.

Each task must be implemented and tested in **Go, Java, and Python**, with identical results across all three on the same inputs (and the same RNG seed where randomness is involved).
