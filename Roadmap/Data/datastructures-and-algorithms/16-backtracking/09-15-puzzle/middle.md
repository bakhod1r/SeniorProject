# The 15-Puzzle and 8-Puzzle (IDA* / Heuristic Search) — Middle Level

> **Focus:** the solvability parity test in full, the heuristic ladder (Hamming → Manhattan → linear conflict → walking distance), the precise mechanics of IDA* (why the threshold rises to the *next* `f`, the cost-bounded DFS, incremental heuristic updates, move generation without reversal), and how IDA* compares with A*, BFS, and Dijkstra.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The Solvability Parity Test](#the-solvability-parity-test)
4. [The Heuristic Ladder](#the-heuristic-ladder)
5. [IDA* Mechanics in Detail](#ida-mechanics-in-detail)
6. [Move Generation](#move-generation)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was: run IDA* with Manhattan distance and check solvability first. At middle level you start asking the engineering and theory questions that decide whether your solver is *correct*, *optimal*, and *fast enough*:

- *Why* does the inversion-parity rule decide solvability, and why does the even-width 15-puzzle add the blank's row?
- Manhattan beats Hamming — by how much, and what beats Manhattan? (Linear conflict, walking distance.)
- What exactly does IDA* do between iterations, and why is raising the threshold to the *minimum exceeding `f`* both correct and efficient?
- How do you update the heuristic in `O(1)` per move instead of recomputing it?
- When is A* actually the better choice, and when is plain BFS fine?

These are the questions that separate "I copied an IDA* template" from "I can reason about why it returns the optimal answer and how to make it 10× faster."

---

## Deeper Concepts

### The search problem, restated

We search the implicit graph `G = (states, moves)`. Each state is a permutation of `{0, 1, …, N}` arranged on the grid (`0` = blank). A move is a transposition of the blank with an orthogonally adjacent tile. We want a shortest path (fewest moves) from `start` to `goal`. Because the graph is unweighted (each move costs 1), shortest path = fewest edges, and any admissible-heuristic informed search returns an optimal solution.

### The cost model

Every move costs exactly 1, so `g(state)` is the number of moves from the start, and the optimal solution length is the graph distance from `start` to `goal`. The heuristic `h(state)` estimates the remaining distance. The estimate is **admissible** if `h(state) ≤ trueDistance(state, goal)` for all states, and **consistent** (monotone) if `h(s) ≤ cost(s, s') + h(s')` for every neighbor `s'`. Manhattan distance is both admissible and consistent — proofs in `professional.md`.

### Why informed search wins

The state space branches by ~3 (4 grid neighbors minus the reverse move minus boundary). An uninformed search to depth `d` touches `O(3^d)` nodes. A good heuristic prunes any subtree whose `f = g + h` exceeds the optimal length `C*`, because such a subtree cannot contain an optimal solution. The tighter `h` is to the truth, the more it prunes — and the effective branching factor of IDA* drops dramatically, which is the entire reason the 15-puzzle is solvable at all.

---

## The Solvability Parity Test

Not all `(N+1)!` arrangements are reachable from the goal — exactly half are. The reachable half is characterized by an invariant that no legal move can change.

### Inversions

Write the board as a sequence by reading rows top-to-bottom, left-to-right, **omitting the blank**. An **inversion** is a pair `(i, j)` with `i < j` (positions in the sequence) but `value[i] > value[j]`. Count them all; call it `inv`.

### The rule

- **Odd width (3×3 8-puzzle, 5×5 24-puzzle):** the board is solvable **iff `inv` is even**.
- **Even width (4×4 15-puzzle):** the board is solvable **iff `inv + r` is even**, where `r` is the row index of the blank counted **from the bottom, 1-based** (bottom row = 1). Equivalently: blank on an even row from the bottom requires odd `inv`; blank on an odd row from the bottom requires even `inv`.

### Why it works (intuition; full proof in professional.md)

A horizontal blank move swaps the blank with a left/right neighbor — in the reading sequence this swaps two *adjacent* non-blank elements only when... actually a horizontal move does **not** change the relative order of any two tiles (the blank just trades places with one tile, and the blank is omitted from the sequence), so it changes inversions by `0`. A vertical blank move jumps the blank over `width − 1` tiles in the reading order, which permutes those tiles cyclically and changes the inversion count's parity by `width − 1`. For odd width, `width − 1` is even, so parity of `inv` is invariant — hence `inv mod 2` is conserved and must match the goal's (which is 0, even). For even width, `width − 1` is odd, so each vertical move flips `inv` parity *and* moves the blank one row, so `inv + blankRow` parity is the conserved quantity. The goal has `inv = 0` and blank in the bottom-right; matching that invariant is the solvability condition.

### Code

```python
def solvable(board, width):
    inv = 0
    flat = [x for x in board if x != 0]
    for i in range(len(flat)):
        for j in range(i + 1, len(flat)):
            if flat[i] > flat[j]:
                inv += 1
    if width % 2 == 1:           # odd width
        return inv % 2 == 0
    # even width: add blank's row from the bottom (1-based)
    blank_index = board.index(0)
    row_from_top = blank_index // width
    row_from_bottom = width - row_from_top   # 1-based from bottom
    return (inv + row_from_bottom) % 2 == 0
```

---

## The Heuristic Ladder

Stronger admissible heuristics prune more. Here is the ladder from weakest to strongest practical heuristic (all admissible).

| Heuristic | Definition | Admissible? | Relative strength |
|-----------|-----------|-------------|-------------------|
| **Hamming** | number of tiles not in their goal cell (blank excluded) | yes | weakest; each misplaced tile needs ≥ 1 move |
| **Manhattan** | `Σ` over tiles of `|r−gr| + |c−gc|` | yes | strong; each tile must travel its grid distance |
| **Manhattan + Linear Conflict** | Manhattan plus 2 per conflicting pair in a row/column | yes | stronger; corrects for tiles that must pass each other |
| **Walking Distance** | precomputed table of vertical/horizontal "row-group" moves | yes | very strong; near state-of-the-art among hand-crafted heuristics |

### Hamming

Counts misplaced tiles. Admissible because fixing each misplaced tile takes at least one move. Weak: it ignores *how far* a tile is, so a tile one cell away and a tile across the board both count as 1.

### Manhattan distance

For each tile, the minimum number of moves to bring it home *if no other tiles were in the way* is its Manhattan grid distance. Summing over all tiles is admissible because each move advances exactly one tile by one cell, so the total displacement decreases by at most 1 per move. Manhattan dominates Hamming (`Manhattan ≥ Hamming` always), which means it expands no more nodes and usually far fewer.

### Linear conflict

Manhattan undercounts when two tiles are in their goal row (or column) but in the wrong order relative to each other. To reorder them, one must temporarily leave the row, costing **2 extra moves** beyond Manhattan that Manhattan never accounts for. The **linear-conflict** heuristic adds 2 for each such conflicting pair (carefully, so the additions stay admissible — at most the minimum number of tiles that must leave the line). It typically cuts IDA* node counts on the 15-puzzle by a large factor versus plain Manhattan, while remaining admissible.

```python
def linear_conflict(board, side):
    h = manhattan(board, side)
    # row conflicts
    for row in range(side):
        for i in range(side):
            a = board[row * side + i]
            if a == 0 or (a - 1) // side != row:
                continue  # a not a tile whose goal row is this row
            for j in range(i + 1, side):
                b = board[row * side + j]
                if b == 0 or (b - 1) // side != row:
                    continue
                if a > b:   # both in goal row but out of order
                    h += 2
    # column conflicts
    for col in range(side):
        for i in range(side):
            a = board[i * side + col]
            if a == 0 or (a - 1) % side != col:
                continue
            for j in range(i + 1, side):
                b = board[j * side + col]
                if b == 0 or (b - 1) % side != col:
                    continue
                if a > b:
                    h += 2
    return h
```

### Walking distance

A precomputed lookup that treats each row (and each column) as a group and counts the minimum number of vertical (resp. horizontal) moves to sort the groups, accounting for interactions Manhattan misses. It is admissible, additive across the two axes, and very strong — often used in fast 15-puzzle solvers before pattern databases (which `senior.md` covers) took the crown.

---

## IDA* Mechanics in Detail

IDA* = iterative deepening, but the cutoff is `f = g + h` rather than raw depth.

### The outer loop

```
threshold = h(start)
loop:
    (found, next_threshold) = dfs(start, g=0, threshold)
    if found: return solution
    if next_threshold == INF: return unsolvable
    threshold = next_threshold
```

### The bounded DFS

```
dfs(state, g, threshold):
    f = g + h(state)
    if f > threshold: return (false, f)          # prune; report the overshoot
    if isGoal(state): return (true, g)
    min_over = INF
    for s' in successors(state) excluding reverse:
        (found, t) = dfs(s', g+1, threshold)
        if found: return (true, t)
        min_over = min(min_over, t)
    return (false, min_over)
```

### Why the threshold rises to the minimum exceeding `f`

When a DFS pass with bound `B` fails, every pruned node had `f > B`. The smallest such `f`, call it `B'`, is the next value worth trying: any bound between `B` and `B'` would prune exactly the same nodes (nothing has `f` in `(B, B')`), so jumping straight to `B'` skips no solutions and wastes no passes. Because `h` is admissible, the optimal solution length `C*` is one of the threshold values the loop will reach, and the *first* time the bound equals `C*` the DFS finds the goal (its `f` along the optimal path never exceeds `C*`). Hence IDA* returns an optimal solution.

### Why memory is `O(d)`

The DFS stores only the current root-to-node path on the call stack — at most `threshold` deep, which is `O(d)` where `d = C*`. No open list, no closed set. This is the decisive advantage over A* on the 15-puzzle, whose frontier can hold tens of millions of nodes.

### The cost of re-exploration

Each iteration re-expands the nodes of all previous iterations. But the number of nodes with `f ≤ B` grows geometrically with `B` (because the tree branches), so the final iteration dominates the total: the overhead is a constant factor (typically `< 2×`) over a single perfectly-bounded search. This is the same argument that makes plain iterative-deepening DFS asymptotically as good as BFS.

### Incremental heuristic update

Recomputing `h` from scratch at each node is `O(N)`. Since a move shifts exactly one tile by one cell, you can pass `h` down and adjust it in `O(1)`:

```
new_h = h - manhattan_of(moved_tile, old_cell) + manhattan_of(moved_tile, new_cell)
```

Only the moved tile's contribution changes (the blank has no Manhattan contribution). For linear conflict the incremental update is trickier (conflicts in the affected row/column must be recomputed) but still local. The `O(1)` Manhattan delta is one of the largest practical speedups.

---

## Move Generation

### Successors

From a state, the blank can move up, down, left, or right, subject to grid bounds. Each move swaps the blank with the neighbor in that direction. At most 4 successors; corners give 2, edges give 3, interior gives 4.

### Forbidding the reverse move

If the previous move slid the blank from cell `p` to cell `q`, the move that slides it back from `q` to `p` reproduces the parent state and must be skipped. Track the previous blank position (or the previous direction and forbid its inverse). This drops the effective branching factor from ~3 to ~2.13 on the 15-puzzle.

### No general cycle detection in IDA*

Unlike A* with a closed set, IDA* does not remember visited states, so longer cycles (returning to an earlier state via 4+ moves) are not detected. The reversal check kills 2-cycles cheaply; the `f`-pruning kills most longer cycles indirectly (revisiting a state with higher `g` raises `f` and gets cut). Adding a small transposition table to catch more cycles is a senior-level optimization (`senior.md`).

---

## Comparison with Alternatives

### IDA* vs A* vs BFS vs Dijkstra

| Algorithm | Optimal? | Memory | Best for |
|-----------|----------|--------|----------|
| BFS | yes (unit cost) | **O(states)** | tiny state spaces (8-puzzle) |
| Dijkstra | yes (any non-neg cost) | O(states) | weighted graphs; overkill for unit-cost puzzles |
| A* (Manhattan) | yes | **O(b^d)** frontier | medium spaces where the frontier fits in RAM |
| **IDA*** (Manhattan) | yes | **O(d)** | huge spaces with tight memory — the 15-puzzle |

- **BFS** ignores the heuristic and expands by depth; it finds the optimal length but stores every state — fine for 181,440 8-puzzle states, hopeless for `10^13` 15-puzzle states.
- **Dijkstra** generalizes BFS to weighted edges. The puzzle has unit edges, so Dijkstra reduces to BFS and gains nothing while still storing all states.
- **A*** uses the heuristic to expand fewest nodes, but keeps an open priority queue and a closed set — `O(b^d)` memory. On the 15-puzzle the frontier can exceed available RAM before a solution is found.
- **IDA*** trades a little redundant computation for `O(d)` memory and the same optimality. That trade is why it, not A*, is the canonical 15-puzzle solver.

### Node-count comparison (typical 15-puzzle instance)

| Heuristic | A* nodes (illustrative) | IDA* nodes (illustrative) |
|-----------|-------------------------|---------------------------|
| Hamming | very large (memory blows) | very large |
| Manhattan | large but smaller | comparable, far less memory |
| Manhattan + linear conflict | much smaller | much smaller, `O(d)` memory |

The point is not the exact numbers but the shape: stronger heuristics shrink node counts by orders of magnitude, and IDA* gets that benefit at constant memory.

---

## Code Examples

### IDA* with incremental Manhattan + linear conflict (15-puzzle ready)

#### Go

```go
package main

import "fmt"

const SIDE = 4 // 15-puzzle

var dr = []int{-1, 1, 0, 0}
var dc = []int{0, 0, -1, 1}

func manhattan(b []int) int {
	d := 0
	for i, v := range b {
		if v == 0 {
			continue
		}
		gr, gc := (v-1)/SIDE, (v-1)%SIDE
		r, c := i/SIDE, i%SIDE
		d += abs(r-gr) + abs(c-gc)
	}
	return d
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// delta in Manhattan when tile `tile` moves from cell `from` to cell `to`
func manhattanDelta(tile, from, to int) int {
	gr, gc := (tile-1)/SIDE, (tile-1)%SIDE
	fr, fc := from/SIDE, from%SIDE
	tr, tc := to/SIDE, to%SIDE
	before := abs(fr-gr) + abs(fc-gc)
	after := abs(tr-gr) + abs(tc-gc)
	return after - before
}

func dfs(b []int, blank, g, h, bound, prev int, path *[]int) int {
	f := g + h
	if f > bound {
		return f
	}
	if h == 0 {
		return -1
	}
	min := 1 << 30
	r, c := blank/SIDE, blank%SIDE
	for d := 0; d < 4; d++ {
		nr, nc := r+dr[d], c+dc[d]
		if nr < 0 || nr >= SIDE || nc < 0 || nc >= SIDE {
			continue
		}
		ni := nr*SIDE + nc
		if ni == prev {
			continue
		}
		tile := b[ni]
		nh := h + manhattanDelta(tile, ni, blank) // tile slides into blank cell
		b[blank], b[ni] = b[ni], b[blank]
		*path = append(*path, tile)
		t := dfs(b, ni, g+1, nh, bound, blank, path)
		if t == -1 {
			return -1
		}
		if t < min {
			min = t
		}
		*path = (*path)[:len(*path)-1]
		b[blank], b[ni] = b[ni], b[blank]
	}
	return min
}

func solve(b []int) []int {
	blank := 0
	for i, v := range b {
		if v == 0 {
			blank = i
		}
	}
	bound := manhattan(b)
	h0 := bound
	path := []int{}
	for {
		t := dfs(b, blank, 0, h0, bound, -1, &path)
		if t == -1 {
			return path
		}
		if t == 1<<30 {
			return nil
		}
		bound = t
	}
}

func main() {
	b := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15}
	sol := solve(b)
	fmt.Println("moves:", len(sol), sol)
}
```

#### Java

```java
import java.util.*;

public class IDAStar {
    static final int SIDE = 4;
    static final int[] DR = {-1, 1, 0, 0};
    static final int[] DC = {0, 0, -1, 1};

    static int manhattan(int[] b) {
        int d = 0;
        for (int i = 0; i < b.length; i++) {
            int v = b[i];
            if (v == 0) continue;
            int gr = (v - 1) / SIDE, gc = (v - 1) % SIDE;
            d += Math.abs(i / SIDE - gr) + Math.abs(i % SIDE - gc);
        }
        return d;
    }

    static int delta(int tile, int from, int to) {
        int gr = (tile - 1) / SIDE, gc = (tile - 1) % SIDE;
        int before = Math.abs(from / SIDE - gr) + Math.abs(from % SIDE - gc);
        int after = Math.abs(to / SIDE - gr) + Math.abs(to % SIDE - gc);
        return after - before;
    }

    static int dfs(int[] b, int blank, int g, int h, int bound, int prev, List<Integer> path) {
        int f = g + h;
        if (f > bound) return f;
        if (h == 0) return -1;
        int min = Integer.MAX_VALUE;
        int r = blank / SIDE, c = blank % SIDE;
        for (int d = 0; d < 4; d++) {
            int nr = r + DR[d], nc = c + DC[d];
            if (nr < 0 || nr >= SIDE || nc < 0 || nc >= SIDE) continue;
            int ni = nr * SIDE + nc;
            if (ni == prev) continue;
            int tile = b[ni];
            int nh = h + delta(tile, ni, blank);
            swap(b, blank, ni);
            path.add(tile);
            int t = dfs(b, ni, g + 1, nh, bound, blank, path);
            if (t == -1) return -1;
            if (t < min) min = t;
            path.remove(path.size() - 1);
            swap(b, blank, ni);
        }
        return min;
    }

    static void swap(int[] b, int i, int j) { int t = b[i]; b[i] = b[j]; b[j] = t; }

    static List<Integer> solve(int[] b) {
        int blank = 0;
        for (int i = 0; i < b.length; i++) if (b[i] == 0) blank = i;
        int bound = manhattan(b), h0 = bound;
        List<Integer> path = new ArrayList<>();
        while (true) {
            int t = dfs(b, blank, 0, h0, bound, -1, path);
            if (t == -1) return path;
            if (t == Integer.MAX_VALUE) return null;
            bound = t;
        }
    }

    public static void main(String[] args) {
        int[] b = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15};
        List<Integer> sol = solve(b);
        System.out.println("moves: " + sol.size() + " " + sol);
    }
}
```

#### Python

```python
SIDE = 4
DR = (-1, 1, 0, 0)
DC = (0, 0, -1, 1)


def manhattan(b):
    d = 0
    for i, v in enumerate(b):
        if v == 0:
            continue
        gr, gc = (v - 1) // SIDE, (v - 1) % SIDE
        d += abs(i // SIDE - gr) + abs(i % SIDE - gc)
    return d


def delta(tile, frm, to):
    gr, gc = (tile - 1) // SIDE, (tile - 1) % SIDE
    before = abs(frm // SIDE - gr) + abs(frm % SIDE - gc)
    after = abs(to // SIDE - gr) + abs(to % SIDE - gc)
    return after - before


def dfs(b, blank, g, h, bound, prev, path):
    f = g + h
    if f > bound:
        return f
    if h == 0:
        return -1
    best = 1 << 30
    r, c = blank // SIDE, blank % SIDE
    for d in range(4):
        nr, nc = r + DR[d], c + DC[d]
        if not (0 <= nr < SIDE and 0 <= nc < SIDE):
            continue
        ni = nr * SIDE + nc
        if ni == prev:
            continue
        tile = b[ni]
        nh = h + delta(tile, ni, blank)
        b[blank], b[ni] = b[ni], b[blank]
        path.append(tile)
        t = dfs(b, ni, g + 1, nh, bound, blank, path)
        if t == -1:
            return -1
        best = min(best, t)
        path.pop()
        b[blank], b[ni] = b[ni], b[blank]
    return best


def solve(board):
    b = list(board)
    blank = b.index(0)
    bound = manhattan(b)
    path = []
    while True:
        t = dfs(b, blank, 0, bound, bound, -1, path)
        if t == -1:
            return path
        if t == 1 << 30:
            return None
        bound = t


if __name__ == "__main__":
    b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15]
    print("moves:", solve(b))
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Unsolvable board fed to IDA* | Search never terminates (no goal in its half). | Run the parity test first; reject before searching. |
| Non-admissible heuristic | Returns a sub-optimal length. | Use Manhattan / linear conflict; never inflate. |
| Incremental `h` drifts from true `h` | A subtle delta bug compounds over the path. | Periodically assert `h == manhattan(board)` in debug builds. |
| Threshold stuck | Returned the bound, not the exceeding `f`. | On prune return `f`; propagate the minimum overshoot. |
| Stack overflow | Deep recursion on 60+ move solutions. | Increase recursion limit or use an explicit stack. |
| Reverse move not skipped | 2-cycle ping-pong inflates node count. | Pass and check the previous blank index. |

---

## Performance Analysis

The dominant cost is the number of nodes the final IDA* iteration expands, which is `O(b_eff^{C*})` where `b_eff` is the *effective* branching factor after pruning and `C*` is the optimal depth.

| Lever | Effect |
|-------|--------|
| Forbid reverse move | `b_eff`: ~3 → ~2.13 (15-puzzle) |
| Manhattan vs Hamming | typically `> 100×` fewer nodes |
| Linear conflict on top | further large factor (often several×) |
| Incremental `h` | `O(1)` vs `O(N)` per node — constant-factor on the inner loop |
| In-place make/undo | avoids per-node board allocation |

A representative random 15-puzzle instance (optimal ~ 45–55 moves) is solvable with Manhattan + linear conflict in IDA* in well under a second; the hardest instances (optimal 80) need pattern databases (`senior.md`) to be practical. The 8-puzzle is trivial under any of these heuristics.

```python
# Sanity: IDA* optimal length must equal BFS optimal length on the 8-puzzle.
# Run on many random solvable 3x3 boards and assert equality.
```

The single biggest constant-factor wins are the reverse-move check and the incremental Manhattan delta; the single biggest asymptotic win is a stronger heuristic (linear conflict, then pattern databases).

---

## Best Practices

- **Always run the parity test** for the correct width before searching.
- **Use the strongest admissible heuristic you can afford** — Manhattan + linear conflict is the practical sweet spot before pattern databases.
- **Pass `h` incrementally** with an `O(1)` delta; verify it against a full recompute in tests.
- **Forbid the reverse move** via the previous blank index.
- **Return the overshoot `f`** on prune so the threshold advances to exactly the next achievable value.
- **Verify against BFS** on the 8-puzzle for many random boards; same optimal length.
- **Make/undo in place** to keep memory at `O(d)` and avoid GC churn.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The board with the blank sliding, annotated with `g`, `h`, and `f = g + h` at each node.
> - The IDA* threshold value rising across iterations, shown as a running budget.
> - Nodes pruned when `f > threshold` (backtracking) versus nodes expanded.
> - The final optimal solution path, replayed move by move.

---

## Summary

The 15-puzzle is a shortest-path search on a `10^13`-state graph, made tractable by informed search. The **inversion-parity test** decides solvability — even `inv` for odd-width boards, `inv + blankRowFromBottom` even for even-width boards — and the invariance comes from horizontal moves preserving inversions while vertical moves change them by `width − 1`. The **heuristic ladder** climbs Hamming → Manhattan → Manhattan+linear-conflict → walking distance, each admissible and each pruning more than the last. **IDA*** is a depth-first search bounded by `f = g + h`; raising the threshold to the smallest exceeding `f` makes it optimal with admissible `h` while using only `O(d)` memory, which is exactly why it beats A* (`O(b^d)` memory) and BFS/Dijkstra (`O(states)`) on the 15-puzzle. Forbid the reverse move, update `h` incrementally, and verify against BFS on the 8-puzzle, and you have a correct, optimal, fast solver — with pattern databases (`senior.md`) waiting for the hardest instances.
