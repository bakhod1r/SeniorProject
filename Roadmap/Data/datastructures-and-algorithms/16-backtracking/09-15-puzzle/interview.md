# The 15-Puzzle and 8-Puzzle (IDA* / Heuristic Search) — Interview Preparation

The sliding-tile puzzle is a favorite interview problem because it rewards a few crisp insights — *"check solvability with inversion parity," "use Manhattan distance as an admissible heuristic," "run IDA* so memory stays `O(d)`"* — and then tests whether you can (a) prove your heuristic never overestimates, (b) explain why IDA* beats A* on memory, (c) generate moves without re-exploring the reverse, and (d) recognize when a stronger heuristic (linear conflict, pattern databases) is needed. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Is the board solvable? (3×3) | inversion parity (even) | `O(N²)` |
| Is the board solvable? (4×4) | `inv + blankRowFromBottom` parity | `O(N²)` |
| Estimate moves left (weak) | Hamming (misplaced tiles) | `O(N)` |
| Estimate moves left (strong) | Manhattan distance | `O(N)` |
| Even stronger, still admissible | Manhattan + linear conflict | `O(N·s)` |
| State of the art | disjoint additive pattern databases | `O(1)` lookup |
| Find the optimal solution | IDA* (`f = g + h` bounded DFS) | exp. in depth, `O(d)` memory |
| BFS shortest (8-puzzle only) | plain BFS | `O(states)` time + memory |

Core algorithm:

```text
IDA*(start):
    bound = h(start)
    loop:
        t = dfs(start, g=0, bound)
        if t == FOUND: return path
        if t == INF:   return unsolvable
        bound = t                 # smallest f that exceeded the bound

dfs(state, g, bound):
    f = g + h(state)
    if f > bound: return f
    if isGoal(state): return FOUND
    best = INF
    for move in moves(state) except reverse:
        apply(move)
        t = dfs(state, g+1, bound)
        if t == FOUND: return FOUND
        best = min(best, t)
        undo(move)
    return best
```

Key facts:
- **Length = number of moves** (tile slides); each move costs 1.
- **Admissible `h`** (`h ≤ true`) ⇒ first IDA* solution is optimal.
- **Manhattan ≥ Hamming**; both admissible; never count the blank.
- IDA* memory is **`O(d)`**; A* memory is **`O(b^d)`** — the decisive difference on the 15-puzzle.
- Half of all scrambles are **unsolvable** — always test parity first.

---

## Junior Questions (10 Q&A)

### J1. What is the 8-puzzle / 15-puzzle?
A `3×3` (or `4×4`) frame of numbered tiles with one blank. A move slides a tile adjacent to the blank into the blank's cell. The goal is the ordered arrangement. Solving = fewest moves from a scramble to the goal.

### J2. Why can't you just use BFS on the 15-puzzle?
BFS finds the optimal length but stores every visited state. The 15-puzzle has `≈ 10^13` reachable states — far more than fits in memory. BFS is fine for the 8-puzzle (181,440 states) but hopeless for the 15-puzzle.

### J3. What is a heuristic here?
A function `h(state)` that estimates the number of moves remaining to the goal. A good heuristic guides the search toward the goal and lets us prune hopeless branches.

### J4. What is the Manhattan distance heuristic?
For each tile, add `|row − goalRow| + |col − goalCol|`. It is the total grid distance every tile must travel, ignoring obstacles. The blank is not counted.

### J5. What does "admissible" mean and why does it matter?
An admissible heuristic never overestimates the true remaining cost (`h ≤ true`). It matters because with an admissible heuristic, the first solution A*/IDA* finds is guaranteed to be the shortest.

### J6. What is `f = g + h`?
`g` is moves made so far; `h` is the estimate of moves left; `f` estimates the total solution length through this state. IDA* prunes any path whose `f` exceeds the current threshold.

### J7. What is IDA*?
Iterative Deepening A*: a depth-first search bounded by `f = g + h`. It prunes paths with `f > threshold`, and if no solution is found, raises the threshold to the smallest `f` that exceeded it, then repeats.

### J8. Why is IDA* better than A* for the 15-puzzle?
A* stores the whole frontier and closed set — `O(b^d)` memory — which exhausts RAM. IDA* is just DFS, storing only the current path — `O(d)` memory — so it solves boards A* cannot.

### J9. Why forbid the reverse move?
The move that undoes the previous move returns to the parent state, wasting work and creating 2-cycles. Skipping it nearly halves the branching factor.

### J10. Are all scrambles solvable?
No — exactly half are. Whether a board is solvable is decided by an inversion-parity rule. Always test before searching; otherwise the solver loops forever on an unsolvable board.

---

## Middle Questions (10 Q&A)

### M1. State the solvability rule for both sizes.
Read tiles in order, omitting the blank, and count inversions. For odd width (3×3): solvable iff inversions are even. For even width (4×4): solvable iff `inversions + blankRowFromBottom` is even (parity of the conserved quantity).

### M2. Why does the parity rule work?
A horizontal move doesn't change any tile's relative reading order, so inversions are unchanged. A vertical move jumps the blank over `width−1` tiles, changing inversions by `width−1`. For odd width that's even (parity preserved); for even width it's odd, but the blank's row also flips, so `inv + blankRow` parity is preserved.

### M3. Prove Manhattan is admissible.
Each move changes exactly one tile's Manhattan distance by `±1`, so one move reduces total Manhattan by at most 1. To reach the goal (Manhattan 0) you need at least `Manhattan(start)` moves. Hence `Manhattan ≤ trueDistance`.

### M4. What is linear conflict and why is it still admissible?
When two tiles are in their goal row (or column) but reversed, one must leave the line and return — 2 moves Manhattan never counts. Adding 2 per conflict (carefully, minimum tiles to remove) stays a lower bound because those detour moves are disjoint from Manhattan's accounting.

### M5. Why does IDA* raise the threshold to the *minimum exceeding* f?
Nothing has an `f` strictly between the old bound and that minimum, so any intermediate bound would prune identically. Jumping to the minimum overshoot skips no solutions and wastes no passes, keeping IDA* optimal and efficient.

### M6. How do you update Manhattan in O(1) per move?
A move shifts one tile by one cell, so only that tile's contribution changes: `new_h = h − dist(tile, oldCell) + dist(tile, newCell)`. The blank contributes nothing. This avoids the `O(N)` recompute.

### M7. Compare IDA*, A*, BFS, Dijkstra for this problem.
BFS/Dijkstra: optimal but `O(states)` memory — only 8-puzzle. A*: optimal, fewer expansions, but `O(b^d)` frontier memory. IDA*: optimal, `O(d)` memory, slight re-exploration overhead — the canonical 15-puzzle solver.

### M8. What is the re-exploration overhead of IDA*?
Each iteration re-expands prior nodes, but node counts grow geometrically with the bound, so the last iteration dominates and total overhead is a small constant factor — like plain iterative deepening DFS.

### M9. How do you generate successors correctly?
The blank moves up/down/left/right within grid bounds, swapping with the neighbor. Skip the move that returns the blank to its previous cell. At most 4 successors; corners give 2, edges 3.

### M10. When is Manhattan not enough?
The hardest 15-puzzles (optimal length 80) expand astronomically many nodes with Manhattan alone. Linear conflict helps; pattern databases are needed for the worst cases.

---

## Senior Questions (8 Q&A)

### S1. What is a pattern database (PDB)?
Precompute, for a subset of tiles, the exact minimum moves to place just those tiles (ignoring others) for every configuration, stored in a table keyed by their positions. Looking it up gives an admissible heuristic far stronger than Manhattan.

### S2. Why are PDBs admissible?
Solving the relaxed sub-puzzle (only the pattern tiles matter) is a lower bound on solving the full puzzle — you can't solve the whole without at least solving the part. So the precomputed exact sub-distance never overestimates.

### S3. What makes additive PDBs additive?
Partition tiles into disjoint groups and, when building each group's table, count only moves of that group's tiles. Then each real move is charged to exactly one group, so summing the group values stays admissible — letting you `sum` instead of the much weaker `max`.

### S4. How do you build a PDB?
Backward BFS (0/1-BFS, since non-group tile moves cost 0) from the goal over the abstract state space. Each abstract state's BFS depth is its exact group distance. Index by a perfect permutation rank into a flat table; build once, memory-map read-only.

### S5. How big are the tables and how do you fit them?
A group of `m` tiles on 16 cells has `16·15·…·(16−m+1)` placements, ~1 byte each. The 7-8 split is ~115 MB. Compression, nibble-packing, or smaller partitions (5-5-5) reduce it; serialize once and `mmap` to share across threads.

### S6. Why is IDA* still preferred even with strong PDBs?
The frontier in A* can exceed the PDB itself in memory. IDA* keeps `O(d)` memory regardless of heuristic strength, and a strong PDB shrinks `b_eff` so re-exploration overhead is negligible. Hence PDB + IDA* is the standard optimal solver.

### S7. How do you handle transpositions in IDA*?
IDA* has no closed set, so it re-explores states reached via different move orders. The reverse-move check kills 2-cycles; a bounded transposition table can cut longer ones — but only with a *sound* dominance test (`g' ≤ g` same state) and per-iteration versioning, or optimality breaks.

### S8. How do you verify the solver returns optimal answers?
Compare IDA* optimal length against BFS on the 8-puzzle for many random boards; assert `h(goal)=0`, admissibility (`h ≤ trueDist`) and consistency on small boards; check PDB completeness; and replay the returned solution to confirm it reaches the goal.

---

## Professional Questions (6 Q&A)

### P1. Prove IDA* returns an optimal solution.
With admissible `h`, every node on an optimal path has `f = g + h ≤ g + trueDist = C*`, so the optimal path is never pruned once `bound ≥ C*`. Bounds rise to exactly the next achievable `f`, so the first bound `≥ C*` equals `C*`, and that iteration reaches the goal at depth `C*`. No solution is shorter than `C*`, so the answer is optimal.

### P2. Why is the generalized (N²−1)-puzzle NP-hard?
Ratner & Warmuth (1990) proved finding the *shortest* solution to the `(N²−1)`-puzzle (with `N` part of the input) is NP-complete, and NP-hard even to approximate. Feasibility (solvability) is polynomial via parity, and *some* solution of length `O(N³)` is polynomial-time findable; only *optimization* is hard.

### P3. How many states does the 15-puzzle have and why half?
`16! ≈ 2.09 × 10^{13}` total, but only `16!/2 ≈ 1.05 × 10^{13}` are reachable. A move is an odd permutation combined with a blank-distance parity flip, conserving `sgn(π)·(−1)^{blankDist}`, which splits arrangements into two equal classes; only the goal's class is reachable.

### P4. Explain admissibility vs consistency and why Manhattan has both.
Admissible: `h ≤ trueDist` (never overestimate). Consistent: `h(s) ≤ cost(s,s') + h(s')` (triangle inequality). Manhattan changes by exactly `±1` per move, giving both: it never exceeds the true distance and satisfies the monotone step bound. Consistency implies admissibility.

### P5. Why can additive PDBs be summed but non-additive ones only maxed?
Additive PDBs charge each real move to exactly one disjoint group, so `Σ group ≤ total moves`. Non-additive (overlapping/full-cost) PDBs may charge a move in multiple groups, so summing overcounts and can overestimate — only `max` is then guaranteed admissible.

### P6. Analyze IDA*'s total node count.
Let `n_i` be nodes at bound `b_i`. For a branching tree, `n_i ≈ b_eff^{b_i}`, so `Σ n_i ≤ n_I · b_eff/(b_eff−1) = O(n_I)` — a constant factor over the last iteration. The bound degrades only for near-linear graphs (`b_eff → 1`), which the puzzle is not.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you traded compute for memory (or vice versa).
Look for a concrete story like choosing IDA* over A* to fit a search in memory at the cost of some re-exploration, with measured impact (e.g., "A* OOM'd at 20M frontier nodes; IDA* finished in `O(d)` memory at ~1.5× the node expansions"). Strong answers cite the verification against a slower exact baseline.

### B2. A teammate's solver returns non-optimal solutions. How do you debug?
Suspect an inadmissible heuristic first (returns too-short paths) or broken threshold logic (too-long). Compare against BFS optimal length on the 8-puzzle, assert `h ≤ trueDist` on small boards, and check the threshold rises to the minimum overshoot. Frame it as a verification gap, not blame.

### B3. Design a service that solves user-submitted 15-puzzles optimally.
Validate solvability via parity (reject early), load additive PDBs memory-mapped at startup (shared, read-only), run PDB + IDA* per request with `O(d)` memory, replay-validate the solution before returning, and cap compute per request with a node-count budget. Log optimal length and node count for anomaly detection.

### B4. How would you explain IDA* to a junior?
Use the road-trip budget analogy: set a budget (`h(start)`), explore all routes within budget, and if none reach the destination, raise the budget to the cheapest route that just overshot. Emphasize the two gotchas first: check solvability, and never inflate the heuristic.

### B5. Your solver is too slow on hard boards. Where do you look?
Heuristic strength is the dominant lever — move from Manhattan to linear conflict to PDBs. Then constant factors: forbid the reverse move, update `h` incrementally, make/undo in place. Confirm the PDB actually loaded (a silent fallback to Manhattan explodes node counts).

---

## Coding Challenges

### Challenge 1: Solvability Check

**Problem.** Given a flat board (length `s²`, `0` = blank) and the side `s`, return whether it is solvable.

**Example.**
```text
[1,2,3,4,5,6,7,8,0], s=3  -> true   (already solved)
[1,2,3,4,5,6,8,7,0], s=3  -> false  (one inversion, odd)
```

**Approach.** Count inversions ignoring the blank; for even `s` add the blank's row from the bottom; check parity.

**Go.**
```go
package main

import "fmt"

func solvable(board []int, s int) bool {
	inv := 0
	flat := []int{}
	for _, v := range board {
		if v != 0 {
			flat = append(flat, v)
		}
	}
	for i := 0; i < len(flat); i++ {
		for j := i + 1; j < len(flat); j++ {
			if flat[i] > flat[j] {
				inv++
			}
		}
	}
	if s%2 == 1 {
		return inv%2 == 0
	}
	blank := 0
	for i, v := range board {
		if v == 0 {
			blank = i
		}
	}
	rowFromTop := blank / s
	rowFromBottom := (s - 1) - rowFromTop // 0-based distance from bottom
	return (inv+rowFromBottom)%2 == 0
}

func main() {
	fmt.Println(solvable([]int{1, 2, 3, 4, 5, 6, 7, 8, 0}, 3)) // true
	fmt.Println(solvable([]int{1, 2, 3, 4, 5, 6, 8, 7, 0}, 3)) // false
}
```

**Java.**
```java
public class Solvable {
    static boolean solvable(int[] board, int s) {
        int inv = 0;
        int[] flat = new int[board.length];
        int n = 0;
        for (int v : board) if (v != 0) flat[n++] = v;
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++)
                if (flat[i] > flat[j]) inv++;
        if (s % 2 == 1) return inv % 2 == 0;
        int blank = 0;
        for (int i = 0; i < board.length; i++) if (board[i] == 0) blank = i;
        int rowFromBottom = (s - 1) - (blank / s);
        return (inv + rowFromBottom) % 2 == 0;
    }

    public static void main(String[] args) {
        System.out.println(solvable(new int[]{1, 2, 3, 4, 5, 6, 7, 8, 0}, 3)); // true
        System.out.println(solvable(new int[]{1, 2, 3, 4, 5, 6, 8, 7, 0}, 3)); // false
    }
}
```

**Python.**
```python
def solvable(board, s):
    flat = [v for v in board if v != 0]
    inv = sum(
        1
        for i in range(len(flat))
        for j in range(i + 1, len(flat))
        if flat[i] > flat[j]
    )
    if s % 2 == 1:
        return inv % 2 == 0
    blank = board.index(0)
    row_from_bottom = (s - 1) - (blank // s)
    return (inv + row_from_bottom) % 2 == 0


if __name__ == "__main__":
    print(solvable([1, 2, 3, 4, 5, 6, 7, 8, 0], 3))  # True
    print(solvable([1, 2, 3, 4, 5, 6, 8, 7, 0], 3))  # False
```

---

### Challenge 2: Manhattan Distance Heuristic

**Problem.** Given a flat board and side `s`, return the Manhattan distance heuristic (sum over tiles of grid distance to the goal cell; goal of tile `v` is `((v−1)/s, (v−1)%s)`; blank excluded).

**Example.**
```text
[1,2,3,4,5,6,7,8,0], s=3 -> 0
[1,2,3,4,5,6,0,7,8], s=3 -> 2   (7 off by 1, 8 off by 1)
```

**Go.**
```go
package main

import "fmt"

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func manhattan(board []int, s int) int {
	d := 0
	for i, v := range board {
		if v == 0 {
			continue
		}
		gr, gc := (v-1)/s, (v-1)%s
		d += abs(i/s-gr) + abs(i%s-gc)
	}
	return d
}

func main() {
	fmt.Println(manhattan([]int{1, 2, 3, 4, 5, 6, 7, 8, 0}, 3)) // 0
	fmt.Println(manhattan([]int{1, 2, 3, 4, 5, 6, 0, 7, 8}, 3)) // 2
}
```

**Java.**
```java
public class Manhattan {
    static int manhattan(int[] board, int s) {
        int d = 0;
        for (int i = 0; i < board.length; i++) {
            int v = board[i];
            if (v == 0) continue;
            int gr = (v - 1) / s, gc = (v - 1) % s;
            d += Math.abs(i / s - gr) + Math.abs(i % s - gc);
        }
        return d;
    }

    public static void main(String[] args) {
        System.out.println(manhattan(new int[]{1, 2, 3, 4, 5, 6, 7, 8, 0}, 3)); // 0
        System.out.println(manhattan(new int[]{1, 2, 3, 4, 5, 6, 0, 7, 8}, 3)); // 2
    }
}
```

**Python.**
```python
def manhattan(board, s):
    d = 0
    for i, v in enumerate(board):
        if v == 0:
            continue
        gr, gc = (v - 1) // s, (v - 1) % s
        d += abs(i // s - gr) + abs(i % s - gc)
    return d


if __name__ == "__main__":
    print(manhattan([1, 2, 3, 4, 5, 6, 7, 8, 0], 3))  # 0
    print(manhattan([1, 2, 3, 4, 5, 6, 0, 7, 8], 3))  # 2
```

---

### Challenge 3: 8-Puzzle IDA* Solver

**Problem.** Given a solvable 8-puzzle, return the optimal number of moves (and optionally the move list) using IDA* with Manhattan distance.

**Example.**
```text
[1,2,3,4,5,6,7,0,8], s=3 -> 1   (slide 8 left)
```

**Go.**
```go
package main

import "fmt"

const S = 3

var dr = []int{-1, 1, 0, 0}
var dc = []int{0, 0, -1, 1}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func manhattan(b []int) int {
	d := 0
	for i, v := range b {
		if v == 0 {
			continue
		}
		gr, gc := (v-1)/S, (v-1)%S
		d += abs(i/S-gr) + abs(i%S-gc)
	}
	return d
}

func dfs(b []int, blank, g, bound, prev int) int {
	h := manhattan(b)
	f := g + h
	if f > bound {
		return f
	}
	if h == 0 {
		return -1
	}
	min := 1 << 30
	r, c := blank/S, blank%S
	for d := 0; d < 4; d++ {
		nr, nc := r+dr[d], c+dc[d]
		if nr < 0 || nr >= S || nc < 0 || nc >= S {
			continue
		}
		ni := nr*S + nc
		if ni == prev {
			continue
		}
		b[blank], b[ni] = b[ni], b[blank]
		t := dfs(b, ni, g+1, bound, blank)
		b[blank], b[ni] = b[ni], b[blank]
		if t == -1 {
			return -1
		}
		if t < min {
			min = t
		}
	}
	return min
}

func solveLen(start []int) int {
	b := append([]int{}, start...)
	blank := 0
	for i, v := range b {
		if v == 0 {
			blank = i
		}
	}
	bound := manhattan(b)
	for {
		t := dfs(b, blank, 0, bound, -1)
		if t == -1 {
			return bound
		}
		if t == 1<<30 {
			return -1
		}
		bound = t
	}
}

func main() {
	fmt.Println(solveLen([]int{1, 2, 3, 4, 5, 6, 7, 0, 8})) // 1
}
```

**Java.**
```java
public class EightIDA {
    static final int S = 3;
    static final int[] DR = {-1, 1, 0, 0};
    static final int[] DC = {0, 0, -1, 1};

    static int manhattan(int[] b) {
        int d = 0;
        for (int i = 0; i < b.length; i++) {
            int v = b[i];
            if (v == 0) continue;
            d += Math.abs(i / S - (v - 1) / S) + Math.abs(i % S - (v - 1) % S);
        }
        return d;
    }

    static int dfs(int[] b, int blank, int g, int bound, int prev) {
        int h = manhattan(b), f = g + h;
        if (f > bound) return f;
        if (h == 0) return -1;
        int min = Integer.MAX_VALUE, r = blank / S, c = blank % S;
        for (int d = 0; d < 4; d++) {
            int nr = r + DR[d], nc = c + DC[d];
            if (nr < 0 || nr >= S || nc < 0 || nc >= S) continue;
            int ni = nr * S + nc;
            if (ni == prev) continue;
            swap(b, blank, ni);
            int t = dfs(b, ni, g + 1, bound, blank);
            swap(b, blank, ni);
            if (t == -1) return -1;
            if (t < min) min = t;
        }
        return min;
    }

    static void swap(int[] b, int i, int j) { int t = b[i]; b[i] = b[j]; b[j] = t; }

    static int solveLen(int[] start) {
        int[] b = start.clone();
        int blank = 0;
        for (int i = 0; i < b.length; i++) if (b[i] == 0) blank = i;
        int bound = manhattan(b);
        while (true) {
            int t = dfs(b, blank, 0, bound, -1);
            if (t == -1) return bound;
            if (t == Integer.MAX_VALUE) return -1;
            bound = t;
        }
    }

    public static void main(String[] args) {
        System.out.println(solveLen(new int[]{1, 2, 3, 4, 5, 6, 7, 0, 8})); // 1
    }
}
```

**Python.**
```python
S = 3
DR = (-1, 1, 0, 0)
DC = (0, 0, -1, 1)


def manhattan(b):
    d = 0
    for i, v in enumerate(b):
        if v == 0:
            continue
        d += abs(i // S - (v - 1) // S) + abs(i % S - (v - 1) % S)
    return d


def dfs(b, blank, g, bound, prev):
    h = manhattan(b)
    f = g + h
    if f > bound:
        return f
    if h == 0:
        return -1
    best = 1 << 30
    r, c = blank // S, blank % S
    for d in range(4):
        nr, nc = r + DR[d], c + DC[d]
        if not (0 <= nr < S and 0 <= nc < S):
            continue
        ni = nr * S + nc
        if ni == prev:
            continue
        b[blank], b[ni] = b[ni], b[blank]
        t = dfs(b, ni, g + 1, bound, blank)
        b[blank], b[ni] = b[ni], b[blank]
        if t == -1:
            return -1
        best = min(best, t)
    return best


def solve_len(start):
    b = list(start)
    blank = b.index(0)
    bound = manhattan(b)
    while True:
        t = dfs(b, blank, 0, bound, -1)
        if t == -1:
            return bound
        if t == 1 << 30:
            return -1
        bound = t


if __name__ == "__main__":
    print(solve_len([1, 2, 3, 4, 5, 6, 7, 0, 8]))  # 1
```

---

### Challenge 4: Linear Conflict Heuristic

**Problem.** Given a flat board and side `s`, return `Manhattan + 2 × (linear conflicts in rows and columns)`. A conflict is a pair of tiles both in their goal line but reversed.

**Example.**
```text
goal row [2,1,3] in a 3-wide row where tiles 1,2 both belong there but reversed -> +2
```

**Go.**
```go
package main

import "fmt"

const S = 3

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func linearConflict(b []int) int {
	h := 0
	for i, v := range b {
		if v == 0 {
			continue
		}
		gr, gc := (v-1)/S, (v-1)%S
		h += abs(i/S-gr) + abs(i%S-gc)
	}
	// row conflicts
	for row := 0; row < S; row++ {
		for i := 0; i < S; i++ {
			a := b[row*S+i]
			if a == 0 || (a-1)/S != row {
				continue
			}
			for j := i + 1; j < S; j++ {
				bb := b[row*S+j]
				if bb == 0 || (bb-1)/S != row {
					continue
				}
				if a > bb {
					h += 2
				}
			}
		}
	}
	// column conflicts
	for col := 0; col < S; col++ {
		for i := 0; i < S; i++ {
			a := b[i*S+col]
			if a == 0 || (a-1)%S != col {
				continue
			}
			for j := i + 1; j < S; j++ {
				bb := b[j*S+col]
				if bb == 0 || (bb-1)%S != col {
					continue
				}
				if a > bb {
					h += 2
				}
			}
		}
	}
	return h
}

func main() {
	fmt.Println(linearConflict([]int{2, 1, 3, 4, 5, 6, 7, 8, 0}))
}
```

**Java.**
```java
public class LinearConflict {
    static final int S = 3;

    static int linearConflict(int[] b) {
        int h = 0;
        for (int i = 0; i < b.length; i++) {
            int v = b[i];
            if (v == 0) continue;
            h += Math.abs(i / S - (v - 1) / S) + Math.abs(i % S - (v - 1) % S);
        }
        for (int row = 0; row < S; row++)
            for (int i = 0; i < S; i++) {
                int a = b[row * S + i];
                if (a == 0 || (a - 1) / S != row) continue;
                for (int j = i + 1; j < S; j++) {
                    int bb = b[row * S + j];
                    if (bb == 0 || (bb - 1) / S != row) continue;
                    if (a > bb) h += 2;
                }
            }
        for (int col = 0; col < S; col++)
            for (int i = 0; i < S; i++) {
                int a = b[i * S + col];
                if (a == 0 || (a - 1) % S != col) continue;
                for (int j = i + 1; j < S; j++) {
                    int bb = b[j * S + col];
                    if (bb == 0 || (bb - 1) % S != col) continue;
                    if (a > bb) h += 2;
                }
            }
        return h;
    }

    public static void main(String[] args) {
        System.out.println(linearConflict(new int[]{2, 1, 3, 4, 5, 6, 7, 8, 0}));
    }
}
```

**Python.**
```python
S = 3


def linear_conflict(b):
    h = 0
    for i, v in enumerate(b):
        if v == 0:
            continue
        h += abs(i // S - (v - 1) // S) + abs(i % S - (v - 1) % S)
    for row in range(S):
        for i in range(S):
            a = b[row * S + i]
            if a == 0 or (a - 1) // S != row:
                continue
            for j in range(i + 1, S):
                bb = b[row * S + j]
                if bb == 0 or (bb - 1) // S != row:
                    continue
                if a > bb:
                    h += 2
    for col in range(S):
        for i in range(S):
            a = b[i * S + col]
            if a == 0 or (a - 1) % S != col:
                continue
            for j in range(i + 1, S):
                bb = b[j * S + col]
                if bb == 0 or (bb - 1) % S != col:
                    continue
                if a > bb:
                    h += 2
    return h


if __name__ == "__main__":
    print(linear_conflict([2, 1, 3, 4, 5, 6, 7, 8, 0]))
```

---

## Final Tips

- Lead with the three pillars: *"check solvability (inversion parity), use an admissible heuristic (Manhattan), solve with IDA* so memory is `O(d)`."*
- Immediately flag the two gotchas: **half of boards are unsolvable** and **never inflate the heuristic** (it breaks optimality).
- If asked why not A*, answer **memory**: A* is `O(b^d)`, IDA* is `O(d)`.
- For harder instances, mention **linear conflict** then **disjoint additive pattern databases** as the strength ladder.
- Always offer to verify against **BFS optimal length on the 8-puzzle**.
