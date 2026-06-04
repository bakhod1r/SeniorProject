# Knight's Tour (Backtracking + Warnsdorff's Heuristic) — Interview Preparation

The Knight's Tour is a beloved interview problem because it rewards one crisp insight — *"a tour is a Hamiltonian path on the knight graph, found by backtracking and accelerated by Warnsdorff's degree heuristic"* — and then probes whether you can (a) write clean backtracking with the choose/explore/undo pattern, (b) make it fast with the minimum-degree rule, (c) reason about which boards even *have* a tour (open vs closed, Schwenk/parity), and (d) recognize that Warnsdorff is a heuristic with no guarantee, so a fallback is needed. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Find any open tour | backtracking + Warnsdorff ordering | ~`O(N²)` typical, exp. worst |
| Find a tour fast on large board | Warnsdorff (min-degree) ordering | `O(N²)` typical |
| Check a closed (re-entrant) tour | open tour + last square knight-move from start | `O(N²)` |
| Count tours on a small board | exhaustive backtracking (no early stop) | exponential |
| Does an open tour exist `N×N`? | none for `N ∈ {2,3,4}`; exists `N ≥ 5` | `O(1)` |
| Does a closed tour exist `M×N`? | Schwenk's theorem | `O(1)` |

The eight knight moves:

```text
(dr, dc) in { (-2,-1),(-2,+1),(-1,-2),(-1,+2),
              (+1,-2),(+1,+2),(+2,-1),(+2,+1) }
```

Core backtracking skeleton:

```text
solve(r, c, step):
    board[r][c] = step                    # choose
    if step == N*N - 1: return true       # base case
    cands = legal unvisited moves sorted by degree (Warnsdorff)
    for (nr, nc) in cands:
        if solve(nr, nc, step+1): return true   # explore
    board[r][c] = -1                      # undo
    return false
```

Key facts:
- **Length is in moves:** a full tour makes `N²-1` moves over `N²` squares.
- **Warnsdorff = min onward degree first**; it is a heuristic, not a guarantee → keep backtracking.
- **Closed tour needs even area** (bipartite parity); odd×odd boards have none.
- **Hamiltonian path** in the knight graph; NP-hard in general, easy here via structure.

---

## Junior Questions (10 Q&A)

**Q1. What is a knight's tour?**
A sequence of legal knight moves that visits every square of an `N×N` board exactly once.

**Q2. How does a knight move?**
In an "L": two squares one way then one square perpendicular — eight possible offsets `(±1,±2)` and `(±2,±1)`.

**Q3. What is backtracking here?**
Place the knight (mark the square with its step number), recurse on each legal unvisited move; if all fail, undo the mark and return failure.

**Q4. How do you represent the board?**
An `N×N` integer grid: `-1` = unvisited, otherwise the step number on which the knight landed there.

**Q5. Why is naive backtracking slow?**
Branching factor up to 8 over depth `N²` gives an exponential search tree; the knight strands corners and backtracks enormously.

**Q6. What is Warnsdorff's rule?**
Always move to the unvisited square with the fewest onward unvisited moves (minimum degree).

**Q7. Why does Warnsdorff help?**
Low-degree squares become traps if left for later (degrees only decrease), so visiting them first keeps the board flexible and the first path usually completes.

**Q8. Open vs closed tour?**
Open ends anywhere; closed ends on a square a knight move from the start (forming a cycle).

**Q9. Does every board have a tour?**
No. `2×2`, `3×3`, `4×4` have no open tour; open tours exist for `N ≥ 5`.

**Q10. What is the "degree" of a square?**
The count of unvisited squares reachable from it in one knight move.

---

## Middle Questions (8 Q&A)

**Q1. What is the time complexity of Warnsdorff-ordered search?**
Typically `O(N²)` — each of `N²` moves scans ≤ 8 candidates with `O(1)` degree counts. Worst case stays exponential because it is a heuristic.

**Q2. Why must degree count only unvisited squares?**
Visited squares cannot be entered; counting them would mis-rank candidates and break the heuristic.

**Q3. When does Warnsdorff need a tie-break?**
When multiple candidates share the minimum degree; arbitrary tie-breaking causes most failures.

**Q4. What is a good tie-break?**
Among equal-degree candidates, prefer the one farther from the board center (nearer the edge/corner), then a fixed lexicographic order for determinism.

**Q5. Why does a closed tour require an even number of squares?**
Knight moves alternate square colors (the knight graph is bipartite); a cycle must return to the start color, needing an even number of moves, so `N²` must be even.

**Q6. How do you adapt the base case for a closed tour?**
At `step == N²-1`, additionally require that the start square is one knight move from the current square.

**Q7. What is the relationship to graph theory?**
An open tour is a Hamiltonian path and a closed tour a Hamiltonian cycle in the knight graph.

**Q8. Why can't you trust pure Warnsdorff in production?**
It is a greedy heuristic with no completeness proof and documented failures; pair it with a backtracking fallback.

---

## Senior / Staff Questions (8 Q&A)

**Q1. How would you generate a tour on a 1000×1000 board?**
Not by search — use a divide-and-conquer constructive method (build quadrant tours, splice their cycles) in `O(N²)`.

**Q2. How do you bound a pathological search?**
Add a node budget and a wall-clock deadline; return a typed timeout instead of hanging.

**Q3. How do you make output reproducible?**
Fixed move-offset order and a deterministic integer tie-break (no floating point).

**Q4. State Schwenk's theorem.**
An `M×N` (`M≤N`) board has a closed tour unless: both dimensions odd; or `M ∈ {1,2,4}`; or `M=3` with `N ∈ {4,6,8}`.

**Q5. How do you validate a tour?**
Check it is a bijection onto `0…N²-1` and that consecutive step numbers sit a knight move apart (plus the closing edge for closed tours).

**Q6. What is the worst-case complexity of naive backtracking?**
`O(8^(N²))` — exponential in the number of squares.

**Q7. How would you architect a tour-generation service?**
Layers: `O(1)` existence check → constructive for large boards → Warnsdorff fast path → bounded backtracking fallback → validator.

**Q8. What metrics would you expose?**
Nodes expanded, backtrack count, which layer answered, peak recursion depth, and elapsed time.

---

## Behavioral Prompts

- **"Tell me about a time a 'good enough' heuristic failed in production."** Warnsdorff is a perfect anchor: describe the heuristic, the rare failure mode, and how you added a correct fallback with budgets and metrics.
- **"How do you decide between a clever heuristic and a guaranteed-correct method?"** Discuss layering: heuristic for the common fast case, exhaustive/constructive for correctness and scale.
- **"Describe debugging a problem that only appeared at scale."** Recursion-depth/stack overflow on large boards, fixed by an explicit stack or switching to the constructive method.
- **"How do you make a nondeterministic algorithm testable?"** Fixed orderings, deterministic tie-breaks, and golden-tour snapshot tests.

---

## Coding Challenge 1 — Find an Open Tour via Backtracking + Warnsdorff

**Problem.** Given `N` and a start `(r0, c0)`, return an `N×N` board labeled `0…N²-1` giving an open tour, or report none.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

var dr = []int{-2, -2, -1, -1, 1, 1, 2, 2}
var dc = []int{-1, 1, -2, 2, -2, 2, -1, 1}

func findTour(n, r0, c0 int) ([][]int, bool) {
	board := make([][]int, n)
	for i := range board {
		board[i] = make([]int, n)
		for j := range board[i] {
			board[i][j] = -1
		}
	}
	ok := func(r, c int) bool { return r >= 0 && r < n && c >= 0 && c < n }
	degree := func(r, c int) int {
		d := 0
		for i := 0; i < 8; i++ {
			if nr, nc := r+dr[i], c+dc[i]; ok(nr, nc) && board[nr][nc] == -1 {
				d++
			}
		}
		return d
	}
	var solve func(r, c, step int) bool
	solve = func(r, c, step int) bool {
		board[r][c] = step
		if step == n*n-1 {
			return true
		}
		type cand struct{ r, c, deg int }
		var cs []cand
		for i := 0; i < 8; i++ {
			nr, nc := r+dr[i], c+dc[i]
			if ok(nr, nc) && board[nr][nc] == -1 {
				cs = append(cs, cand{nr, nc, degree(nr, nc)})
			}
		}
		sort.Slice(cs, func(a, b int) bool { return cs[a].deg < cs[b].deg })
		for _, m := range cs {
			if solve(m.r, m.c, step+1) {
				return true
			}
		}
		board[r][c] = -1
		return false
	}
	return board, solve(r0, c0, 0)
}

func main() {
	b, ok := findTour(5, 0, 0)
	fmt.Println("found:", ok)
	if ok {
		for _, row := range b {
			fmt.Println(row)
		}
	}
}
```

#### Java

```java
import java.util.*;

public class FindTour {
    static final int[] DR = {-2, -2, -1, -1, 1, 1, 2, 2};
    static final int[] DC = {-1, 1, -2, 2, -2, 2, -1, 1};
    static int n;
    static int[][] board;

    static boolean ok(int r, int c) { return r >= 0 && r < n && c >= 0 && c < n; }

    static int degree(int r, int c) {
        int d = 0;
        for (int i = 0; i < 8; i++)
            if (ok(r + DR[i], c + DC[i]) && board[r + DR[i]][c + DC[i]] == -1) d++;
        return d;
    }

    static boolean solve(int r, int c, int step) {
        board[r][c] = step;
        if (step == n * n - 1) return true;
        List<int[]> cs = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            int nr = r + DR[i], nc = c + DC[i];
            if (ok(nr, nc) && board[nr][nc] == -1) cs.add(new int[]{nr, nc, degree(nr, nc)});
        }
        cs.sort(Comparator.comparingInt(a -> a[2]));
        for (int[] m : cs) if (solve(m[0], m[1], step + 1)) return true;
        board[r][c] = -1;
        return false;
    }

    public static void main(String[] args) {
        n = 5;
        board = new int[n][n];
        for (int[] row : board) Arrays.fill(row, -1);
        boolean found = solve(0, 0, 0);
        System.out.println("found: " + found);
        if (found) for (int[] row : board) System.out.println(Arrays.toString(row));
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)

DR = [-2, -2, -1, -1, 1, 1, 2, 2]
DC = [-1, 1, -2, 2, -2, 2, -1, 1]


def find_tour(n, r0=0, c0=0):
    board = [[-1] * n for _ in range(n)]

    def ok(r, c):
        return 0 <= r < n and 0 <= c < n

    def degree(r, c):
        return sum(1 for i in range(8)
                   if ok(r + DR[i], c + DC[i]) and board[r + DR[i]][c + DC[i]] == -1)

    def solve(r, c, step):
        board[r][c] = step
        if step == n * n - 1:
            return True
        cands = sorted(((degree(r + DR[i], c + DC[i]), r + DR[i], c + DC[i])
                        for i in range(8)
                        if ok(r + DR[i], c + DC[i]) and board[r + DR[i]][c + DC[i]] == -1))
        for _, nr, nc in cands:
            if solve(nr, nc, step + 1):
                return True
        board[r][c] = -1
        return False

    return board if solve(r0, c0, 0) else None


if __name__ == "__main__":
    b = find_tour(5)
    print("found:", b is not None)
    if b:
        for row in b:
            print(row)
```

---

## Coding Challenge 2 — Pure Warnsdorff Walk (No Backtracking)

**Problem.** Implement a single greedy Warnsdorff walk from `(r0,c0)`. Return the tour if greedy succeeds, else `null` (demonstrating the heuristic can fail).

#### Go

```go
package main

import "fmt"

var dr = []int{-2, -2, -1, -1, 1, 1, 2, 2}
var dc = []int{-1, 1, -2, 2, -2, 2, -1, 1}

func warnsdorffWalk(n, r0, c0 int) ([][]int, bool) {
	board := make([][]int, n)
	for i := range board {
		board[i] = make([]int, n)
		for j := range board[i] {
			board[i][j] = -1
		}
	}
	ok := func(r, c int) bool { return r >= 0 && r < n && c >= 0 && c < n }
	degree := func(r, c int) int {
		d := 0
		for i := 0; i < 8; i++ {
			if nr, nc := r+dr[i], c+dc[i]; ok(nr, nc) && board[nr][nc] == -1 {
				d++
			}
		}
		return d
	}
	r, c := r0, c0
	for step := 0; step < n*n; step++ {
		board[r][c] = step
		if step == n*n-1 {
			return board, true
		}
		best, bestDeg := -1, 9
		var br, bc int
		for i := 0; i < 8; i++ {
			nr, nc := r+dr[i], c+dc[i]
			if ok(nr, nc) && board[nr][nc] == -1 {
				if d := degree(nr, nc); d < bestDeg {
					bestDeg, br, bc, best = d, nr, nc, 1
				}
			}
		}
		if best == -1 {
			return nil, false // dead end: greedy failed
		}
		r, c = br, bc
	}
	return board, true
}

func main() {
	b, ok := warnsdorffWalk(8, 0, 0)
	fmt.Println("greedy succeeded:", ok)
	if ok {
		fmt.Println("top-left step:", b[0][0])
	}
}
```

#### Java

```java
import java.util.*;

public class WarnsdorffWalk {
    static final int[] DR = {-2, -2, -1, -1, 1, 1, 2, 2};
    static final int[] DC = {-1, 1, -2, 2, -2, 2, -1, 1};

    static int[][] walk(int n, int r0, int c0) {
        int[][] board = new int[n][n];
        for (int[] row : board) Arrays.fill(row, -1);
        int r = r0, c = c0;
        for (int step = 0; step < n * n; step++) {
            board[r][c] = step;
            if (step == n * n - 1) return board;
            int bestDeg = 9, br = -1, bc = -1;
            for (int i = 0; i < 8; i++) {
                int nr = r + DR[i], nc = c + DC[i];
                if (nr >= 0 && nr < n && nc >= 0 && nc < n && board[nr][nc] == -1) {
                    int d = 0;
                    for (int k = 0; k < 8; k++) {
                        int ar = nr + DR[k], ac = nc + DC[k];
                        if (ar >= 0 && ar < n && ac >= 0 && ac < n && board[ar][ac] == -1) d++;
                    }
                    if (d < bestDeg) { bestDeg = d; br = nr; bc = nc; }
                }
            }
            if (br == -1) return null; // dead end
            r = br; c = bc;
        }
        return board;
    }

    public static void main(String[] args) {
        int[][] b = walk(8, 0, 0);
        System.out.println("greedy succeeded: " + (b != null));
        if (b != null) System.out.println("top-left step: " + b[0][0]);
    }
}
```

#### Python

```python
DR = [-2, -2, -1, -1, 1, 1, 2, 2]
DC = [-1, 1, -2, 2, -2, 2, -1, 1]


def warnsdorff_walk(n, r0=0, c0=0):
    board = [[-1] * n for _ in range(n)]

    def ok(r, c):
        return 0 <= r < n and 0 <= c < n

    def degree(r, c):
        return sum(1 for i in range(8)
                   if ok(r + DR[i], c + DC[i]) and board[r + DR[i]][c + DC[i]] == -1)

    r, c = r0, c0
    for step in range(n * n):
        board[r][c] = step
        if step == n * n - 1:
            return board
        best = None
        best_deg = 9
        for i in range(8):
            nr, nc = r + DR[i], c + DC[i]
            if ok(nr, nc) and board[nr][nc] == -1:
                d = degree(nr, nc)
                if d < best_deg:
                    best_deg, best = d, (nr, nc)
        if best is None:
            return None  # dead end: greedy failed
        r, c = best
    return board


if __name__ == "__main__":
    b = warnsdorff_walk(8, 0, 0)
    print("greedy succeeded:", b is not None)
    if b:
        print("top-left step:", b[0][0])
```

---

## Coding Challenge 3 — Count All Open Tours on a Small Board

**Problem.** Count every open tour from a given start on a small `N×N` board (e.g., `5×5`). Use exhaustive backtracking *without* early stopping.

#### Go

```go
package main

import "fmt"

var dr = []int{-2, -2, -1, -1, 1, 1, 2, 2}
var dc = []int{-1, 1, -2, 2, -2, 2, -1, 1}

func countTours(n, r0, c0 int) int {
	board := make([][]bool, n)
	for i := range board {
		board[i] = make([]bool, n)
	}
	ok := func(r, c int) bool { return r >= 0 && r < n && c >= 0 && c < n }
	count := 0
	var dfs func(r, c, step int)
	dfs = func(r, c, step int) {
		board[r][c] = true
		if step == n*n-1 {
			count++
		} else {
			for i := 0; i < 8; i++ {
				nr, nc := r+dr[i], c+dc[i]
				if ok(nr, nc) && !board[nr][nc] {
					dfs(nr, nc, step+1)
				}
			}
		}
		board[r][c] = false
	}
	dfs(r0, c0, 0)
	return count
}

func main() {
	fmt.Println("tours from (0,0) on 5x5:", countTours(5, 0, 0))
}
```

#### Java

```java
public class CountTours {
    static final int[] DR = {-2, -2, -1, -1, 1, 1, 2, 2};
    static final int[] DC = {-1, 1, -2, 2, -2, 2, -1, 1};
    static int n, count;
    static boolean[][] board;

    static boolean ok(int r, int c) { return r >= 0 && r < n && c >= 0 && c < n; }

    static void dfs(int r, int c, int step) {
        board[r][c] = true;
        if (step == n * n - 1) {
            count++;
        } else {
            for (int i = 0; i < 8; i++) {
                int nr = r + DR[i], nc = c + DC[i];
                if (ok(nr, nc) && !board[nr][nc]) dfs(nr, nc, step + 1);
            }
        }
        board[r][c] = false;
    }

    public static void main(String[] args) {
        n = 5;
        board = new boolean[n][n];
        count = 0;
        dfs(0, 0, 0);
        System.out.println("tours from (0,0) on 5x5: " + count);
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)

DR = [-2, -2, -1, -1, 1, 1, 2, 2]
DC = [-1, 1, -2, 2, -2, 2, -1, 1]


def count_tours(n, r0=0, c0=0):
    board = [[False] * n for _ in range(n)]
    count = 0

    def ok(r, c):
        return 0 <= r < n and 0 <= c < n

    def dfs(r, c, step):
        nonlocal count
        board[r][c] = True
        if step == n * n - 1:
            count += 1
        else:
            for i in range(8):
                nr, nc = r + DR[i], c + DC[i]
                if ok(nr, nc) and not board[nr][nc]:
                    dfs(nr, nc, step + 1)
        board[r][c] = False

    dfs(r0, c0, 0)
    return count


if __name__ == "__main__":
    print("tours from (0,0) on 5x5:", count_tours(5, 0, 0))
```

---

## Coding Challenge 4 — Closed-Tour Check

**Problem.** Given a completed tour (board labeled `0…N²-1`), decide whether it is a **closed** tour: consecutive steps are knight moves, and the last square is a knight move from the first.

#### Go

```go
package main

import "fmt"

func isKnightMove(r1, c1, r2, c2 int) bool {
	dr, dc := abs(r1-r2), abs(c1-c2)
	return (dr == 1 && dc == 2) || (dr == 2 && dc == 1)
}
func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func isClosedTour(board [][]int) bool {
	n := len(board)
	pos := make(map[int][2]int)
	for r := 0; r < n; r++ {
		for c := 0; c < n; c++ {
			pos[board[r][c]] = [2]int{r, c}
		}
	}
	for k := 0; k < n*n-1; k++ {
		a, b := pos[k], pos[k+1]
		if !isKnightMove(a[0], a[1], b[0], b[1]) {
			return false
		}
	}
	first, last := pos[0], pos[n*n-1]
	return isKnightMove(first[0], first[1], last[0], last[1])
}

func main() {
	// a small hand-checkable example would go here; demo with a stub board
	fmt.Println("define a tour board and call isClosedTour(board)")
}
```

#### Java

```java
import java.util.*;

public class ClosedTourCheck {
    static boolean knight(int r1, int c1, int r2, int c2) {
        int dr = Math.abs(r1 - r2), dc = Math.abs(c1 - c2);
        return (dr == 1 && dc == 2) || (dr == 2 && dc == 1);
    }

    static boolean isClosed(int[][] board) {
        int n = board.length;
        int[][] pos = new int[n * n][2];
        for (int r = 0; r < n; r++)
            for (int c = 0; c < n; c++) { pos[board[r][c]][0] = r; pos[board[r][c]][1] = c; }
        for (int k = 0; k < n * n - 1; k++)
            if (!knight(pos[k][0], pos[k][1], pos[k + 1][0], pos[k + 1][1])) return false;
        return knight(pos[0][0], pos[0][1], pos[n * n - 1][0], pos[n * n - 1][1]);
    }

    public static void main(String[] args) {
        System.out.println("define a tour board and call isClosed(board)");
    }
}
```

#### Python

```python
def knight(r1, c1, r2, c2):
    dr, dc = abs(r1 - r2), abs(c1 - c2)
    return (dr, dc) in {(1, 2), (2, 1)}


def is_closed_tour(board):
    n = len(board)
    pos = {board[r][c]: (r, c) for r in range(n) for c in range(n)}
    for k in range(n * n - 1):
        (r1, c1), (r2, c2) = pos[k], pos[k + 1]
        if not knight(r1, c1, r2, c2):
            return False
    (r1, c1), (r2, c2) = pos[0], pos[n * n - 1]
    return knight(r1, c1, r2, c2)


if __name__ == "__main__":
    print("define a tour board and call is_closed_tour(board)")
```

---

## Closing Tips

- Lead with the one-liner: *"It's a Hamiltonian path on the knight graph; backtracking finds it, Warnsdorff's min-degree rule makes it fast."*
- Volunteer that **Warnsdorff is a heuristic** — interviewers love the candidate who notes the missing guarantee and adds a fallback.
- Know the existence facts cold: no open tour for `N ∈ {2,3,4}`; closed tours need even area; quote Schwenk if pressed.
- Always state complexity precisely: typical `O(N²)` with Warnsdorff, worst-case exponential for naive backtracking.
- For "count tours", make clear you remove the early `return true` and decrement-on-exit, never short-circuit.
