# Knight's Tour (Backtracking + Warnsdorff's Heuristic) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the backtracking and/or Warnsdorff logic and validate against the evaluation criteria.
> **Always validate any tour you produce: every label `0…N²-1` must appear exactly once, and consecutive labels must be a knight move apart.**

---

## Shared Reference

All tasks use the same eight knight-move offsets and the same bounds convention. Keep these handy:

```text
DR = [-2, -2, -1, -1,  1,  1,  2,  2]
DC = [-1,  1, -2,  2, -2,  2, -1,  1]
on_board(r, c)  :=  0 <= r < n  and  0 <= c < n
degree(r, c)    :=  count of (nr,nc) = (r+DR[i], c+DC[i]) that are on-board and unvisited
```

Backtracking template every solver builds on:

```text
solve(r, c, step):
    mark board[r][c] = step          # choose
    if step == n*n - 1: return done  # base case
    for (nr, nc) in candidates(r, c) sorted by Warnsdorff degree:
        if solve(nr, nc, step+1): return true   # explore
    board[r][c] = -1                 # un-choose
    return false
```

Difficulty guide: **Beginner** builds the primitives, **Intermediate** assembles full solvers with heuristics, **Advanced** adds budgets, iteration, and construction for scale.

---

## Beginner Tasks (5)

### Task 1 — Legal-move generator

**Problem.** Implement `legalMoves(n, r, c, visited)` that returns the list of on-board, unvisited squares reachable from `(r, c)` by one knight move.

**Input / Output spec.**
- Inputs: board size `n`, position `(r, c)`, a `visited` grid.
- Output: list of `(nr, nc)` pairs.

**Constraints.** `1 ≤ n ≤ 50`. Use the eight standard offsets.

**Hint.** Bounds-check `0 ≤ nr < n` and `0 ≤ nc < n` *before* indexing `visited`.

**Starter — Go.**
```go
package main

import "fmt"

var dr = []int{-2, -2, -1, -1, 1, 1, 2, 2}
var dc = []int{-1, 1, -2, 2, -2, 2, -1, 1}

func legalMoves(n, r, c int, visited [][]bool) [][2]int {
	// TODO: return on-board, unvisited knight moves from (r,c)
	return nil
}

func main() {
	visited := make([][]bool, 5)
	for i := range visited {
		visited[i] = make([]bool, 5)
	}
	fmt.Println(legalMoves(5, 0, 0, visited))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static final int[] DR = {-2, -2, -1, -1, 1, 1, 2, 2};
    static final int[] DC = {-1, 1, -2, 2, -2, 2, -1, 1};

    static List<int[]> legalMoves(int n, int r, int c, boolean[][] visited) {
        // TODO: return on-board, unvisited knight moves from (r,c)
        return new ArrayList<>();
    }

    public static void main(String[] args) {
        boolean[][] visited = new boolean[5][5];
        for (int[] m : legalMoves(5, 0, 0, visited)) System.out.println(Arrays.toString(m));
    }
}
```

**Starter — Python.**
```python
DR = [-2, -2, -1, -1, 1, 1, 2, 2]
DC = [-1, 1, -2, 2, -2, 2, -1, 1]


def legal_moves(n, r, c, visited):
    # TODO: return on-board, unvisited knight moves from (r, c)
    return []


if __name__ == "__main__":
    visited = [[False] * 5 for _ in range(5)]
    print(legal_moves(5, 0, 0, visited))
```

**Evaluation.** From `(0,0)` on a `5×5` empty board, exactly `(1,2)` and `(2,1)` should be returned.

---

### Task 2 — Degree of a square

**Problem.** Implement `degree(n, r, c, visited)` = number of legal unvisited onward moves from `(r, c)`.

**Input / Output spec.** Inputs as Task 1; output a single integer in `0…8`.

**Constraints.** `1 ≤ n ≤ 50`.

**Hint.** Reuse `legalMoves` and return its length, or count inline.

**Starter — Go.**
```go
func degree(n, r, c int, visited [][]bool) int {
	// TODO: count legal unvisited onward moves
	return 0
}
```

**Starter — Java.**
```java
static int degree(int n, int r, int c, boolean[][] visited) {
    // TODO: count legal unvisited onward moves
    return 0;
}
```

**Starter — Python.**
```python
def degree(n, r, c, visited):
    # TODO: count legal unvisited onward moves
    return 0
```

**Evaluation.** A corner of an empty board has degree 2; a center square of a large board has degree 8.

---

### Task 3 — Tour validator

**Problem.** Implement `isValidOpenTour(board)` that checks the board is a valid open tour: a bijection onto `0…N²-1` with consecutive labels a knight move apart.

**Input / Output spec.** Input: `N×N` integer board. Output: boolean.

**Constraints.** `1 ≤ N ≤ 50`.

**Hint.** Map each label to its position, then check adjacency for `k` and `k+1`.

**Starter — Go.**
```go
func isValidOpenTour(board [][]int) bool {
	// TODO: bijection 0..N*N-1 and knight-adjacent consecutive labels
	return false
}
```

**Starter — Java.**
```java
static boolean isValidOpenTour(int[][] board) {
    // TODO: bijection 0..N*N-1 and knight-adjacent consecutive labels
    return false;
}
```

**Starter — Python.**
```python
def is_valid_open_tour(board):
    # TODO: bijection 0..N*N-1 and knight-adjacent consecutive labels
    return False
```

**Evaluation.** Feed a known-good `5×5` tour (true) and a shuffled board (false).

---

### Task 4 — Naive backtracking tour (small N)

**Problem.** Find an open tour on `N ≤ 6` from `(0,0)` using plain backtracking with the moves tried in fixed order (no Warnsdorff). Return the board or report none.

**Input / Output spec.** Input `N`; output the labeled board or "no tour".

**Constraints.** `1 ≤ N ≤ 6` (naive search is too slow beyond this).

**Hint.** Choose/explore/undo; base case `step == N*N-1`.

**Starter — Go.**
```go
func naiveTour(n int) ([][]int, bool) {
	// TODO: plain backtracking, fixed move order
	return nil, false
}
```

**Starter — Java.**
```java
static boolean naiveTour(int[][] board, int n, int r, int c, int step) {
    // TODO: plain backtracking, fixed move order
    return false;
}
```

**Starter — Python.**
```python
def naive_tour(n):
    # TODO: plain backtracking, fixed move order
    return None
```

**Evaluation.** Returns a valid tour for `N=5,6`; "no tour" for `N=3,4`.

---

### Task 5 — Existence predicate (open tours, square boards)

**Problem.** Implement `openTourExists(n)` returning whether an `n×n` open tour exists.

**Input / Output spec.** Input `n`; output boolean.

**Constraints.** `1 ≤ n ≤ 1000`.

**Hint.** None for `n ∈ {2,3,4}`; exists for `n = 1` (trivial) and all `n ≥ 5`.

**Starter — Go.**
```go
func openTourExists(n int) bool {
	// TODO
	return false
}
```

**Starter — Java.**
```java
static boolean openTourExists(int n) {
    // TODO
    return false;
}
```

**Starter — Python.**
```python
def open_tour_exists(n):
    # TODO
    return False
```

**Evaluation.** `false` for 2,3,4; `true` for 1,5,6,8.

---

## Intermediate Tasks (4)

### Task 6 — Warnsdorff-ordered backtracking

**Problem.** Find an open tour from `(r0,c0)` using min-degree (Warnsdorff) move ordering with a backtracking fallback. Must work for `N` up to a few hundred quickly.

**Input / Output spec.** Inputs `N, r0, c0`; output labeled board or "no tour".

**Constraints.** `5 ≤ N ≤ 300`.

**Hint.** Sort candidates by `degree` ascending before recursing.

**Starter — Go.**
```go
func warnsdorffTour(n, r0, c0 int) ([][]int, bool) {
	// TODO: min-degree ordering + backtracking fallback
	return nil, false
}
```

**Starter — Java.**
```java
static boolean warnsdorffTour(int[][] board, int n, int r, int c, int step) {
    // TODO: min-degree ordering + backtracking fallback
    return false;
}
```

**Starter — Python.**
```python
def warnsdorff_tour(n, r0=0, c0=0):
    # TODO: min-degree ordering + backtracking fallback
    return None
```

**Evaluation.** Produces a valid tour for `N=50,100` essentially instantly.

---

### Task 7 — Tie-break by distance from center

**Problem.** Extend Task 6 so that, among equal-degree candidates, the one **farther from the board center** is tried first. Use integer squared distance.

**Input / Output spec.** Same as Task 6.

**Constraints.** `5 ≤ N ≤ 500`. No floating point in the comparison.

**Hint.** Sort key `(degree, -dist)` where `dist = (2r-(n-1))² + (2c-(n-1))²`.

**Starter — Go.**
```go
func warnsdorffTie(n, r0, c0 int) ([][]int, bool) {
	// TODO: secondary key = larger distance from center (integer)
	return nil, false
}
```

**Starter — Java.**
```java
static boolean warnsdorffTie(int[][] board, int n, int r, int c, int step) {
    // TODO: secondary key = larger distance from center (integer)
    return false;
}
```

**Starter — Python.**
```python
def warnsdorff_tie(n, r0=0, c0=0):
    # TODO: secondary key = larger distance from center (integer)
    return None
```

**Evaluation.** Solves boards where plain min-degree (Task 6) backtracks, with fewer or zero backtracks.

---

### Task 8 — Closed-tour finder

**Problem.** Find a **closed** (re-entrant) tour on `N×N` from `(0,0)`, where the last square is a knight move from the start. Return "no tour" when none exists.

**Input / Output spec.** Input `N`; output labeled closed tour or "no tour".

**Constraints.** `6 ≤ N ≤ 12` (even-area boards). Refuse odd-area boards in `O(1)`.

**Hint.** Add the closing knight-move test at the base case; use Warnsdorff ordering + backtracking.

**Starter — Go.**
```go
func closedTour(n int) ([][]int, bool) {
	// TODO: backtracking with closing-move base case
	return nil, false
}
```

**Starter — Java.**
```java
static boolean closedTour(int[][] board, int n, int r, int c, int step, int sr, int sc) {
    // TODO: backtracking with closing-move base case
    return false;
}
```

**Starter — Python.**
```python
def closed_tour(n):
    # TODO: backtracking with closing-move base case
    return None
```

**Evaluation.** Returns a valid closed tour on `6×6` and `8×8`; "no tour" for `5×5` (odd area).

---

### Task 9 — Count tours on a small board

**Problem.** Count all open tours from `(0,0)` on a small board using exhaustive backtracking without early stopping.

**Input / Output spec.** Input `N`; output an integer count.

**Constraints.** `1 ≤ N ≤ 6`.

**Hint.** Remove the early `return`; increment a counter at the base case and undo on the way out.

**Starter — Go.**
```go
func countTours(n, r0, c0 int) int {
	// TODO: exhaustive backtracking, no early stop
	return 0
}
```

**Starter — Java.**
```java
static int countTours(int n, int r0, int c0) {
    // TODO: exhaustive backtracking, no early stop
    return 0;
}
```

**Starter — Python.**
```python
def count_tours(n, r0=0, c0=0):
    # TODO: exhaustive backtracking, no early stop
    return 0
```

**Evaluation.** Cross-check small counts against a second independent run; the count for `5×5` from a corner is a fixed number you can memoize as a regression test.

---

## Advanced Tasks (3)

### Task 10 — Bounded backtracking with node budget

**Problem.** Add a node budget to the Warnsdorff backtracking solver. If the number of recursive calls exceeds `c·N²`, abort and return a typed "budget exceeded" result instead of hanging.

**Input / Output spec.** Inputs `N, r0, c0, budgetFactor`; output tour, "no tour", or "budget exceeded".

**Constraints.** `5 ≤ N ≤ 1000`. Must never exceed the budget.

**Hint.** Carry a mutable counter; check it at the top of each call.

**Starter — Go.**
```go
func boundedTour(n, r0, c0, budgetFactor int) ([][]int, string) {
	// returns (board, "ok") | (nil, "no tour") | (nil, "budget")
	return nil, "no tour"
}
```

**Starter — Java.**
```java
// return 0=ok (board filled), 1=no tour, 2=budget exceeded
static int boundedTour(int[][] board, int n, int budgetFactor) {
    // TODO
    return 1;
}
```

**Starter — Python.**
```python
def bounded_tour(n, r0=0, c0=0, budget_factor=50):
    # return ("ok", board) | ("no_tour", None) | ("budget", None)
    return ("no_tour", None)
```

**Evaluation.** On a valid board the budget is never hit; an artificially tiny budget triggers the "budget" result cleanly.

---

### Task 11 — Iterative (explicit-stack) tour

**Problem.** Reimplement the Warnsdorff tour **without recursion**, using an explicit stack of `(square, candidateIndex)` frames so very large boards do not overflow the call stack.

**Input / Output spec.** Inputs `N, r0, c0`; output labeled board or "no tour".

**Constraints.** `5 ≤ N ≤ 2000`. Must not use language recursion.

**Hint.** Each stack frame stores the current square and an index into its sorted candidate list; push to advance, pop to backtrack (and unmark).

**Starter — Go.**
```go
func iterativeTour(n, r0, c0 int) ([][]int, bool) {
	// TODO: explicit stack, Warnsdorff ordering
	return nil, false
}
```

**Starter — Java.**
```java
static int[][] iterativeTour(int n, int r0, int c0) {
    // TODO: explicit stack, Warnsdorff ordering
    return null;
}
```

**Starter — Python.**
```python
def iterative_tour(n, r0=0, c0=0):
    # TODO: explicit stack, Warnsdorff ordering
    return None
```

**Evaluation.** Produces a valid tour for `N=1000` without a stack-overflow error.

---

### Task 12 — Divide-and-conquer constructive tour (large even boards)

**Problem.** Implement a constructive open or closed tour for large **even** `n×n` boards (`n ≥ 6`) by building tours on quadrants and splicing them, achieving `O(n²)` time with no search. You may precompute small base-case tours.

**Input / Output spec.** Input even `n ≥ 6`; output a valid labeled tour.

**Constraints.** `n` even, `6 ≤ n ≤ 4096`. No backtracking search on the full board.

**Hint.** Recurse to `n/2` quadrants; seed base cases for small `n`; remove one edge per quadrant cycle and reconnect across seams (Parberry-style).

**Starter — Go.**
```go
func constructiveTour(n int) [][]int {
	// TODO: quadrant divide-and-conquer; seed small base cases
	return nil
}
```

**Starter — Java.**
```java
static int[][] constructiveTour(int n) {
    // TODO: quadrant divide-and-conquer; seed small base cases
    return null;
}
```

**Starter — Python.**
```python
def constructive_tour(n):
    # TODO: quadrant divide-and-conquer; seed small base cases
    return None
```

**Evaluation.** Output passes the tour validator for `n = 8, 16, 64` and completes in linear time (no exponential blowup), far faster than search at large `n`.

---

## Submission Checklist

- [ ] Every produced tour passes a strict validator (bijection + knight adjacency, plus closing edge for closed tours).
- [ ] Bounds are checked **before** indexing the board.
- [ ] Degree counts only **unvisited** squares.
- [ ] Warnsdorff ordering is used wherever speed matters; backtracking remains as a fallback.
- [ ] Existence rules are applied so impossible boards are refused in `O(1)`.
- [ ] Large-board solutions avoid recursion-depth limits (iterative or constructive).
- [ ] Solutions are deterministic (fixed move order + integer tie-break).
- [ ] All three languages (Go, Java, Python) compile and run.
