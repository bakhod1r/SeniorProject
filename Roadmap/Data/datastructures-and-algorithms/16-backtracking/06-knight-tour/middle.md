# Knight's Tour (Backtracking + Warnsdorff's Heuristic) — Middle Level

> **Focus:** Why naive backtracking is hopeless, exactly how Warnsdorff's rule prunes the search to near-linear, the tie-breaking refinements that fix its remaining failures, the difference between open and closed (re-entrant) tours, which boards admit tours at all, and how the whole thing is a **Hamiltonian path** in the knight graph.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Warnsdorff's Rule in Depth](#warnsdorffs-rule-in-depth)
4. [Tie-Breaking Refinements](#tie-breaking-refinements)
5. [Open vs Closed Tours](#open-vs-closed-tours)
6. [Existence Conditions](#existence-conditions)
7. [Hamiltonian-Path Framing](#hamiltonian-path-framing)
8. [Comparison with Alternatives](#comparison-with-alternatives)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Best Practices](#best-practices)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)

---

## Introduction

At junior level the message was: *backtracking finds a tour, Warnsdorff makes it fast.* At middle level you need to understand **why** each piece behaves the way it does and **when** it breaks:

- Why is naive backtracking exponential, and what does the search tree actually look like?
- *Why* does "fewest onward moves first" work so well — what is the structural intuition?
- Warnsdorff sometimes fails. What tie-breaking refinements (Roth, Squirrel, distance-to-center) rescue it?
- How exactly do open and closed tours differ in code and in existence?
- Which `N×N` (and `M×N`) boards have a tour at all, and what is the parity argument behind closed tours?
- Why is the Knight's Tour just a special case of the **Hamiltonian path** problem, and what does that buy us?

These are the questions that separate "I copied a Warnsdorff implementation" from "I can reason about its failure modes and pick the right variant."

---

## Deeper Concepts

### The search tree of naive backtracking

Model the search as a tree. The root is the start square; each node's children are the legal unvisited moves from it (up to 8). A full tour is a root-to-leaf path of depth `N²-1`. Naive backtracking does a depth-first walk of this tree, trying children **in fixed order**.

The disaster is that most root-to-leaf attempts **fail near the bottom**. The knight wanders, isolates a corner, and only discovers the dead end after `N²-k` correct-looking moves — then unwinds and tries again. With branching factor up to 8 and depth `N²`, the tree has up to `8^(N²)` leaves. On `8×8` that is astronomically large. The reason naive search ever finishes is luck in the move order, not algorithmic merit.

### What pruning means here

"Pruning" = cutting branches before exploring them. Warnsdorff does not literally delete branches; it **reorders** them so that the *first* branch tried is overwhelmingly likely to be a complete tour. When the first DFS path succeeds, the rest of the tree is never touched — that is the practical equivalent of pruning everything else. The search visits roughly `N²` nodes instead of exponentially many.

### Degree and the "trap" intuition

Define the **degree** of an unvisited square as the number of unvisited squares a knight move away from it. Two facts make degree the right thing to minimize on:

1. **Degrees only decrease.** Every move you make removes one square from the board, so the degree of every remaining square can only stay the same or drop. A low-degree square is a square *about to die*.
2. **Degree-0 (or degree-1 that you do not enter) is fatal.** If an unvisited square reaches degree 0 and it is not your current target, the tour is doomed — you can never get there. Visiting low-degree squares first prevents them from being stranded.

So Warnsdorff is a greedy strategy that attacks the most fragile part of the board first, keeping options open everywhere else.

### The degree-monotonicity invariant, stated carefully

Let `deg_t(s)` be the degree of unvisited square `s` after `t` moves. The key invariant:

- For any unvisited square `s`, `deg_{t+1}(s) ≤ deg_t(s)` — degrees never increase.
- A move into `s` decreases the degree of each of `s`'s unvisited neighbors by exactly 1.
- Once `deg_t(s) = 0` for an unvisited `s` that is not the current square, the partial tour is doomed.

From this it follows that the danger of stranding a square grows over time, never shrinks. The whole justification of "smallest degree first" rests on this monotonicity: you cannot rescue a square later that you neglect now, because its degree only falls. This is also why a *forced move* (a unique degree-1 unvisited square) should be taken immediately — delaying it can only push it to degree 0.

---

## Warnsdorff's Rule in Depth

The rule, precisely: **from the current square, among all legal unvisited moves, go to the one whose destination has the minimum degree (fewest unvisited onward moves).**

```
nextMove(r, c):
    best = none; bestDeg = +infinity
    for each legal unvisited move (nr, nc):
        d = degree(nr, nc)          # count unvisited onward moves
        if d < bestDeg:
            bestDeg = d; best = (nr, nc)
    return best
```

Pure Warnsdorff (no backtracking) is **O(N²)**: `N²` moves, each scanning ≤ 8 candidates and computing each candidate's degree in ≤ 8 work — constant per step. That is the near-linear behavior people cite.

Empirically, pure Warnsdorff succeeds on the vast majority of boards and start squares. But it is a **heuristic with no completeness guarantee**: there exist boards/starts where the greedy choice leads to an unavoidable dead end. The classic robust design is **Warnsdorff for ordering + backtracking fallback** — try candidates in ascending-degree order, and if the whole subtree fails, undo and try the next. You keep near-linear typical performance and recover full correctness.

### Why a tie-break is needed

The rule says "minimum degree", but several candidates often *tie* at the same degree. Which one you pick among ties dramatically affects whether pure Warnsdorff succeeds. Arbitrary tie-breaking causes most of Warnsdorff's failures, so the refinements below all concern the tie-break.

### The two roles Warnsdorff plays

It is worth separating the two distinct ways Warnsdorff's degree can be used, because problems sometimes need one and not the other:

- **As a move-ordering heuristic inside backtracking.** Here the degree only decides *which candidate to try first*. Correctness is guaranteed by the backtracking, and Warnsdorff just makes the first attempt almost always succeed. This is the robust default.
- **As a standalone greedy decision rule.** Here the degree decides the move *and there is no undo*. This is `O(N²)` and fast, but incomplete — it can dead-end. Use it only when speed matters more than a guarantee, or as a quick first attempt before falling back to full search.

Most production code uses the first role; competitive-programming "find any tour fast" solutions often use the second and accept the small failure risk (or add a tie-break that empirically eliminates it for the constraints given).

### Worked degree calculation

To make the rule concrete, here is how a single step scores its candidates on a partially filled board. Suppose the knight is at `(2, 2)` on a `6×6` board and several squares are already visited. The procedure:

1. Generate the up-to-8 destinations by adding each `(dr, dc)` offset.
2. Discard any that are off-board or already visited.
3. For each surviving destination, count *its* unvisited on-board neighbors — that is its degree.
4. Choose the destination with the smallest degree (apply tie-break if needed).

A possible result:

```text
from (2,2), legal unvisited candidates and their degrees:
  (0,1) -> degree 3
  (0,3) -> degree 4
  (4,1) -> degree 2   <-- minimum, choose this
  (4,3) -> degree 3
  (1,4) -> degree 5
```

Warnsdorff jumps to `(4,1)` because degree 2 is the smallest. Note the degrees are computed *after* marking `(2,2)` visited, so `(2,2)` never counts toward any candidate's degree.

---

## Tie-Breaking Refinements

When multiple candidate moves share the minimum degree, you need a secondary rule. Common ones:

| Tie-break | Rule | Effect |
|-----------|------|--------|
| **Arbitrary / first-found** | Pick whichever appears first in your move array. | Simple but causes the most failures. |
| **Pohl / Roth** | Among min-degree ties, recurse one level: pick the candidate whose *own* best onward move has the lowest degree. | Look-ahead; fixes many ties. |
| **Distance from center** | Among ties, prefer the square **farthest from the board center** (closest to an edge/corner). | Edges are more constrained; clearing them early helps. |
| **Squirrel / fixed corner order** | Among ties, use a fixed deterministic ordering (e.g., by `(row, col)`). | Reproducible; combined with center bias, very robust. |

The most widely cited robust variant is **min-degree, ties broken toward the corner/edge (largest distance from center)**. Intuitively, when two moves are equally constrained, the one nearer the boundary is more likely to become a trap later, so visit it now. With a good tie-break, pure Warnsdorff finds open tours on all boards up to large `N` with no backtracking at all — but a backtracking fallback is still the safe production choice.

```python
def warnsdorff_key(nr, nc, n):
    deg = degree(nr, nc)
    # secondary: prefer farther from center
    cr, cc = (n - 1) / 2.0, (n - 1) / 2.0
    dist = (nr - cr) ** 2 + (nc - cc) ** 2
    return (deg, -dist)   # min degree, then max distance
```

---

## Open vs Closed Tours

- **Open tour:** visits every square once; the end square is anywhere. Base case: `step == N²-1`.
- **Closed (re-entrant) tour:** an open tour whose **last square is a knight-move from the start**, so the knight could continue forever in a cycle. Base case: `step == N²-1` **and** `(start)` is reachable from the final square by one knight move.

In code the only change is the base-case test:

```python
def is_done_closed(r, c, step, start):
    if step != n * n - 1:
        return False
    # last square must be a knight move from start
    sr, sc = start
    for i in range(8):
        if r + DR[i] == sr and c + DC[i] == sc:
            return True
    return False
```

Closed tours are stricter and rarer. Warnsdorff alone is *less* reliable for closed tours, because the greedy walk does not aim to land adjacent to the start — you typically rely more on backtracking, or run Warnsdorff and verify/repair the closing condition.

A useful fact: a closed tour is a **Hamiltonian cycle** on the knight graph; an open tour is a **Hamiltonian path**. Every closed tour can be "opened" at any edge to give `N²` open tours, but not every open tour can be closed.

### Symmetric (centrally symmetric) tours

A further refinement some problems ask for is a **symmetric** tour — one invariant under 180° rotation of the board. These exist only for certain board sizes and are harder to find than ordinary tours. They are mostly an aesthetic/competition curiosity, but it is worth knowing the vocabulary: a tour can be *open*, *closed*, *symmetric*, or *magic* (where the visit-order numbers form a magic square — a famously rare property that does **not** exist for the standard `8×8` semimagic constraints in the strictest sense, though semimagic tours do exist). When an interviewer mentions "magic knight's tour", they mean the visit-number grid having constant row and column sums.

### Comparing open and closed difficulty

In practice:

- **Open tours** are easy: Warnsdorff with a decent tie-break finds one almost instantly on any `N ≥ 5`.
- **Closed tours** are noticeably harder for a greedy walk, because the heuristic has no incentive to end adjacent to the start. You typically either (a) run backtracking with the closed base case, or (b) generate an open tour and check/repair the closing edge.
- **Existence** also differs: open tours exist for all `N ≥ 5`, but closed tours require even area and obey Schwenk's stricter conditions.

### Converting between open and closed

If you have a closed tour and want an open one, simply "cut" the cycle at any of its `N²` edges: the result is an open tour, and there are `N²` such cuts (each a different open tour). The reverse is not free — given an open tour, its two endpoints may not be a knight move apart, so you cannot always close it. This asymmetry is why closed tours are the scarcer, harder object: every closed tour yields many open tours, but most open tours yield no closed tour.

---

## Existence Conditions

Not every board has a tour. Key results to memorize:

- **No open tour** exists for `N×N` with `N ∈ {1 (trivial), 2, 3, 4}` in the sense that `2×2`, `3×3`, and `4×4` have no full tour; `1×1` is the trivial single square. **Open tours exist for every `N ≥ 5`.**
- For general `M×N` boards (`M ≤ N`), an open tour exists **iff** none of these hold: `M = 1` or `M = 2`; `M = 3` with `N ∈ {3, 5, 6}`; `M = 4` with `N = 4`. (Schwenk-style classification, open-tour version.) Otherwise an open tour exists.

### Parity argument for closed tours

Color the board like a chessboard. **Every knight move flips color** (black↔white). A closed tour is a cycle of length `N²`; to return to the start color it must make an even number of moves, so `N²` must be **even**, meaning the board must have an **even number of squares**. Therefore:

- A closed tour requires an **even** number of squares. Any board with an odd number of squares (e.g., `5×5` = 25) has **no closed tour** — though it may have an open tour.

**Schwenk's theorem** gives the exact condition for closed tours on `M×N` boards (`M ≤ N`): a closed knight's tour exists **unless** one or more of these holds:
1. `M` and `N` are both odd (odd total squares → fails the parity argument);
2. `M ∈ {1, 2, 4}`;
3. `M = 3` and `N ∈ {4, 6, 8}`.

So, for example, `8×8` has closed tours; `5×5` (odd total) has none; `4×N` never has a closed tour.

---

## Hamiltonian-Path Framing

Build the **knight graph** `G`:
- **Vertices** = the `N²` squares.
- **Edges** = pairs of squares one knight move apart.

Then:
- An **open knight's tour** = a **Hamiltonian path** in `G`.
- A **closed knight's tour** = a **Hamiltonian cycle** in `G`.

Finding a Hamiltonian path in a general graph is **NP-complete** (decision) / **NP-hard** (search). So in the worst case the Knight's Tour inherits that hardness — which is why naive backtracking is exponential and why no polynomial-time *general* algorithm is known.

What saves us is **structure**. The knight graph is sparse (max degree 8), highly regular, and locally constrained. Warnsdorff's degree heuristic exploits exactly this locality. There are also **constructive** proofs (divide-and-conquer, covered in `senior.md` and `professional.md`) that build tours on large boards directly, sidestepping search entirely. The takeaway: the problem is NP-hard *in general*, but the knight graph's special structure makes it practically easy.

---

## Comparison with Alternatives

| Approach | Typical time | Correct? | Notes |
|----------|--------------|----------|-------|
| Naive backtracking (fixed move order) | Exponential | Yes (if it finishes) | Unusable beyond ~`6×6` without luck. |
| Backtracking + Warnsdorff ordering | ~`O(N²)` typical | Yes | The standard robust choice. |
| Pure Warnsdorff (no backtracking) | `O(N²)` | No guarantee | Fast, fails on some boards/starts. |
| Warnsdorff + good tie-break, no backtracking | `O(N²)` | Empirically very high success | Still no proof of completeness. |
| Divide-and-conquer construction | `O(N²)` | Yes (large boards) | Builds tours by stitching board quadrants; best for huge `N`. |
| General Hamiltonian-path solver | Exponential | Yes | Ignores knight structure; pointless here. |

The sweet spot for most engineering needs is **backtracking + Warnsdorff + a center-distance tie-break**. For genuinely huge boards, switch to the constructive method.

### Choosing an approach by scenario

- **"Find any tour on `8×8` for a demo."** Warnsdorff + backtracking fallback. Done in microseconds.
- **"Find a tour on a `200×200` board."** Same approach still works in milliseconds; Warnsdorff keeps it near-linear.
- **"Generate tours on a `5000×5000` board for art."** Use divide-and-conquer construction; search is wasteful and risks recursion limits.
- **"Count tours on `5×5`."** Exhaustive backtracking without early stopping.
- **"Need a closed tour on `8×8`."** Backtracking with the closed base case (greedy alone is unreliable here).
- **"Prove no tour exists on `4×4`."** Cite existence rules / Schwenk; no search needed.

---

## Code Examples

### Warnsdorff with center-distance tie-break and backtracking fallback

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

var dr = []int{-2, -2, -1, -1, 1, 1, 2, 2}
var dc = []int{-1, 1, -2, 2, -2, 2, -1, 1}

type KT struct {
	n     int
	board [][]int
}

func (k *KT) ok(r, c int) bool { return r >= 0 && r < k.n && c >= 0 && c < k.n }

func (k *KT) degree(r, c int) int {
	d := 0
	for i := 0; i < 8; i++ {
		nr, nc := r+dr[i], c+dc[i]
		if k.ok(nr, nc) && k.board[nr][nc] == -1 {
			d++
		}
	}
	return d
}

type cand struct {
	r, c, deg int
	dist      float64
}

func (k *KT) solve(r, c, step int) bool {
	k.board[r][c] = step
	if step == k.n*k.n-1 {
		return true
	}
	var cs []cand
	cr := float64(k.n-1) / 2
	for i := 0; i < 8; i++ {
		nr, nc := r+dr[i], c+dc[i]
		if k.ok(nr, nc) && k.board[nr][nc] == -1 {
			dist := (float64(nr)-cr)*(float64(nr)-cr) + (float64(nc)-cr)*(float64(nc)-cr)
			cs = append(cs, cand{nr, nc, k.degree(nr, nc), dist})
		}
	}
	sort.Slice(cs, func(a, b int) bool {
		if cs[a].deg != cs[b].deg {
			return cs[a].deg < cs[b].deg // min degree
		}
		return cs[a].dist > cs[b].dist // tie: farther from center first
	})
	for _, m := range cs {
		if k.solve(m.r, m.c, step+1) {
			return true
		}
	}
	k.board[r][c] = -1
	return false
}

func main() {
	k := &KT{n: 8}
	k.board = make([][]int, k.n)
	for i := range k.board {
		k.board[i] = make([]int, k.n)
		for j := range k.board[i] {
			k.board[i][j] = -1
		}
	}
	if k.solve(0, 0, 0) {
		fmt.Println("tour found")
	} else {
		fmt.Println("no tour")
	}
}
```

#### Java

```java
import java.util.*;

public class WarnsdorffTour {
    static final int[] DR = {-2, -2, -1, -1, 1, 1, 2, 2};
    static final int[] DC = {-1, 1, -2, 2, -2, 2, -1, 1};
    int n;
    int[][] board;

    boolean ok(int r, int c) { return r >= 0 && r < n && c >= 0 && c < n; }

    int degree(int r, int c) {
        int d = 0;
        for (int i = 0; i < 8; i++) {
            int nr = r + DR[i], nc = c + DC[i];
            if (ok(nr, nc) && board[nr][nc] == -1) d++;
        }
        return d;
    }

    boolean solve(int r, int c, int step) {
        board[r][c] = step;
        if (step == n * n - 1) return true;
        double cr = (n - 1) / 2.0;
        List<double[]> cs = new ArrayList<>(); // {nr, nc, degree, dist}
        for (int i = 0; i < 8; i++) {
            int nr = r + DR[i], nc = c + DC[i];
            if (ok(nr, nc) && board[nr][nc] == -1) {
                double dist = (nr - cr) * (nr - cr) + (nc - cr) * (nc - cr);
                cs.add(new double[]{nr, nc, degree(nr, nc), dist});
            }
        }
        cs.sort((a, b) -> {
            if (a[2] != b[2]) return Double.compare(a[2], b[2]); // min degree
            return Double.compare(b[3], a[3]);                   // tie: farther first
        });
        for (double[] m : cs) {
            if (solve((int) m[0], (int) m[1], step + 1)) return true;
        }
        board[r][c] = -1;
        return false;
    }

    public static void main(String[] args) {
        WarnsdorffTour kt = new WarnsdorffTour();
        kt.n = 8;
        kt.board = new int[kt.n][kt.n];
        for (int[] row : kt.board) Arrays.fill(row, -1);
        System.out.println(kt.solve(0, 0, 0) ? "tour found" : "no tour");
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)

DR = [-2, -2, -1, -1, 1, 1, 2, 2]
DC = [-1, 1, -2, 2, -2, 2, -1, 1]


def warnsdorff_tour(n, start=(0, 0)):
    board = [[-1] * n for _ in range(n)]
    cr = (n - 1) / 2.0

    def ok(r, c):
        return 0 <= r < n and 0 <= c < n

    def degree(r, c):
        return sum(1 for i in range(8)
                   if ok(r + DR[i], c + DC[i]) and board[r + DR[i]][c + DC[i]] == -1)

    def solve(r, c, step):
        board[r][c] = step
        if step == n * n - 1:
            return True
        cands = []
        for i in range(8):
            nr, nc = r + DR[i], c + DC[i]
            if ok(nr, nc) and board[nr][nc] == -1:
                dist = (nr - cr) ** 2 + (nc - cr) ** 2
                cands.append((degree(nr, nc), -dist, nr, nc))  # min deg, then far
        cands.sort()
        for _, _, nr, nc in cands:
            if solve(nr, nc, step + 1):
                return True
        board[r][c] = -1
        return False

    return board if solve(start[0], start[1], 0) else None


if __name__ == "__main__":
    print("tour found" if warnsdorff_tour(8) else "no tour")
```

**What it does:** finds an open tour on `8×8` using min-degree ordering, breaking ties toward the board edge, and backtracking if a dead end appears.

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Pure Warnsdorff fails on a valid board | Bad tie-break among equal-degree moves. | Add a center-distance tie-break and/or backtracking fallback. |
| Closed-tour search never succeeds | Greedy never aims to land adjacent to start. | Use backtracking with the closed base case; do not rely on greedy. |
| "No tour" on `5×5` closed | `5×5` has 25 (odd) squares → no closed tour exists. | Expect this; only open tours exist for odd-area boards. |
| Float precision in tie-break | Comparing squared distances as floats. | Use integer squared distance; avoid `sqrt`. |
| Exponential time despite Warnsdorff | Degree counts include visited squares. | Count only **unvisited** onward moves. |

---

## Performance Analysis

- **Pure Warnsdorff:** `O(N²)` moves × `O(1)` per-move scoring = **O(N²)** total. This is the near-linear behavior.
- **Backtracking fallback cost:** zero in the common case (first path succeeds). When it fires, worst case is exponential, but with a good tie-break this is essentially never reached for open tours.
- **Memory:** `O(N²)` board + `O(N²)` recursion depth. Convert to an explicit stack for very large `N` to avoid call-stack limits.
- **Constant factors:** computing degree re-scans 8 neighbors per candidate, so each step does ≤ 64 cell touches — negligible.
- **Closed tours:** more backtracking on average; budget for it or use constructive methods.

The practical lesson: with min-degree + center-distance tie-break, an `8×8` open tour is found in microseconds with no backtracking; scale to thousands per side and you should move to divide-and-conquer construction.

### Where time actually goes

Profiling a Warnsdorff solver, the cost breaks down as:

- **Candidate generation:** 8 offset additions + bounds/visited checks per step.
- **Degree scoring:** for each of ≤ 8 candidates, another ≤ 8 neighbor checks ⇒ up to 64 cell reads per step.
- **Sorting:** sorting ≤ 8 candidates is negligible (constant).
- **Recursion/stack overhead:** one frame per move; `N²` frames deep at most.

So the dominant per-step cost is the degree scoring (the nested 8×8), and the total is `Θ(N²)` with a small constant. There is no hidden quadratic-per-step blow-up. If you need to squeeze constants, cache each square's static neighbor list and maintain a live degree array updated incrementally on each move/undo, turning per-step scoring from `O(64)` into `O(8)`.

---

## Best Practices

- Default to **min-degree ordering + center-distance tie-break + backtracking fallback** — robust and fast.
- Keep degree counting restricted to **unvisited** squares; this is the most common subtle bug.
- For closed tours, lean on backtracking and verify the closing knight-move at the base case.
- Use **integer** squared distances for tie-breaks to avoid floating-point noise and `sqrt`.
- Know the existence rules so you can answer "no tour" *immediately* for `2×2`, `3×3`, `4×4`, odd-area closed tours, etc., instead of searching.
- Validate output: each number `0…N²-1` appears once and consecutive numbers are a knight move apart (plus the closing move for closed tours).

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The **degree score** rendered on each candidate square (the Warnsdorff number)
> - The greedy pick of the **lowest-degree** candidate, with ties broken by distance
> - The growing path with **visit-order numbers**
> - **Backtracking** when a dead end appears, undoing the last move
> - Adjustable `N` and Play / Pause / Step controls

---

## Summary

Naive backtracking explores a tree with branching factor up to 8 and depth `N²`, so it is exponential and fails near the leaves over and over. **Warnsdorff's rule** reorders candidates by **degree** (unvisited onward moves) and visits the most-constrained square first, because degrees only decrease and low-degree squares become traps — this makes the *first* DFS path almost always a complete tour, giving **O(N²)** typical performance. Ties at equal degree are where pure Warnsdorff fails, so a **tie-break** (commonly: prefer squares farther from center) plus a **backtracking fallback** restores robustness. **Open** tours need only fill the board; **closed** tours must also end a knight-move from the start, which by a chessboard-coloring **parity** argument requires an even number of squares — formalized by **Schwenk's theorem**. The whole problem is a **Hamiltonian path/cycle** in the knight graph: NP-hard in general, but tractable here thanks to structure and heuristics.

---

## Key Takeaways Checklist

- [ ] Naive backtracking is exponential; never run it on boards beyond `~6×6` without ordering.
- [ ] Warnsdorff = minimum onward **degree** first; it makes typical search `O(N²)`.
- [ ] Degree counts **only unvisited** squares; compute it after marking the current square.
- [ ] Ties need a secondary rule; "farther from center" is a robust, deterministic choice.
- [ ] Warnsdorff is a **heuristic** — keep a backtracking fallback for guaranteed correctness.
- [ ] Open tour = Hamiltonian path; closed tour = Hamiltonian cycle (extra closing-move test).
- [ ] Closed tours need **even area** (bipartite parity); Schwenk gives the exact conditions.
- [ ] Open tours exist for every `N ≥ 5`; none for `N ∈ {2,3,4}`.
- [ ] For huge boards, construct (divide-and-conquer) instead of searching.

---

## Further Reading

- H. C. von Warnsdorff (1823) — the original minimum-degree heuristic.
- I. Pohl, "A method for finding Hamilton paths and Knight's tours" (1967) — the lookahead tie-break.
- A. J. Schwenk (1991) — exact closed-tour existence for rectangular boards.
- Sibling `junior.md` — the backtracking template and the eight knight moves.
- Sibling `senior.md` — production architecture, bounded fallback, and large-board construction.
- Sibling `professional.md` — Hamiltonicity, NP-hardness, and the theory behind the heuristic.
- Sibling topic `14-greedy-algorithms` — the greedy mindset and where it does and does not give guarantees.
