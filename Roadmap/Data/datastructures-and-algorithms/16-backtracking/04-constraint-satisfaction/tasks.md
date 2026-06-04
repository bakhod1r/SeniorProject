# Constraint Satisfaction Problems (CSP) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the CSP modeling and backtracking/propagation logic and validate against the evaluation criteria.
> **Always test against a brute-force generate-and-test oracle on small inputs before trusting your solver, and independently re-validate every returned assignment against all constraints.**

---

## Beginner Tasks (4)

### Task 1 — Consistency check

**Problem.** Implement `consistent(var, value, assignment, neighbors)` that returns whether assigning `value` to `var` violates any `≠` constraint with already-assigned neighbors.

**Input / Output spec.**
- Inputs: a variable id, a candidate value, a map of assigned variables → values, and a neighbor list for `var`.
- Output: `true` if no assigned neighbor already holds `value`, else `false`.

**Constraints.**
- Up to `1000` variables; neighbor lists may be large.
- Only assigned neighbors constrain the check.

**Hint.** Loop the neighbors; return `false` on the first assigned neighbor whose value equals `value`.

**Starter — Go.**
```go
package main

import "fmt"

func consistent(v, val int, assign map[int]int, neighbors []int) bool {
	// TODO: return false if any assigned neighbor holds val
	return true
}

func main() {
	assign := map[int]int{1: 0, 2: 1}
	fmt.Println(consistent(0, 0, assign, []int{1, 2})) // false
	fmt.Println(consistent(0, 2, assign, []int{1, 2})) // true
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static boolean consistent(int v, int val, Map<Integer, Integer> assign, int[] neighbors) {
        // TODO
        return true;
    }

    public static void main(String[] args) {
        Map<Integer, Integer> assign = Map.of(1, 0, 2, 1);
        System.out.println(consistent(0, 0, assign, new int[]{1, 2})); // false
        System.out.println(consistent(0, 2, assign, new int[]{1, 2})); // true
    }
}
```

**Starter — Python.**
```python
def consistent(v, val, assign, neighbors):
    # TODO: return False if any assigned neighbor holds val
    return True


if __name__ == "__main__":
    assign = {1: 0, 2: 1}
    print(consistent(0, 0, assign, [1, 2]))  # False
    print(consistent(0, 2, assign, [1, 2]))  # True
```

---

### Task 2 — MRV variable selection

**Problem.** Given current domains (a map from variable to list of legal values) and a set of assigned variables, return the unassigned variable with the fewest remaining values (break ties by smallest id).

**Input / Output spec.**
- Inputs: `domains`, `assigned` set.
- Output: the chosen variable id, or `-1` if none unassigned.

**Constraints.** `1 ≤ vars ≤ 10⁴`. Deterministic tie-break required.

**Hint.** Track best count and best id; iterate variables in increasing id order.

**Starter — Go.**
```go
package main

import "fmt"

func selectMRV(domains map[int][]int, assigned map[int]bool, vars []int) int {
	// TODO: smallest domain among unassigned; tie -> smallest id
	return -1
}

func main() {
	domains := map[int][]int{0: {1, 2, 3}, 1: {2}, 2: {1, 2}}
	fmt.Println(selectMRV(domains, map[int]bool{}, []int{0, 1, 2})) // 1
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static int selectMRV(Map<Integer, List<Integer>> domains, Set<Integer> assigned, int[] vars) {
        // TODO
        return -1;
    }

    public static void main(String[] args) {
        Map<Integer, List<Integer>> domains = new HashMap<>();
        domains.put(0, List.of(1, 2, 3));
        domains.put(1, List.of(2));
        domains.put(2, List.of(1, 2));
        System.out.println(selectMRV(domains, new HashSet<>(), new int[]{0, 1, 2})); // 1
    }
}
```

**Starter — Python.**
```python
def select_mrv(domains, assigned, variables):
    # TODO: smallest domain among unassigned; tie -> smallest id
    return -1


if __name__ == "__main__":
    domains = {0: [1, 2, 3], 1: [2], 2: [1, 2]}
    print(select_mrv(domains, set(), [0, 1, 2]))  # 1
```

---

### Task 3 — Forward checking step

**Problem.** After assigning `var = value`, prune `value` from each unassigned neighbor's domain. Return the list of neighbors whose domain became empty (wipeouts). Do not mutate domains of assigned neighbors.

**Input / Output spec.**
- Inputs: `var`, `value`, `domains`, `neighbors`, `assigned` set.
- Output: list of wiped-out neighbor ids (empty list if none).

**Constraints.** Domains are lists/sets of ints. Mutation in place is allowed.

**Hint.** For each unassigned neighbor, remove `value`; if its domain is now empty, record it.

**Starter — Go.**
```go
package main

import "fmt"

func forwardCheck(v, val int, domains map[int][]int, neighbors []int, assigned map[int]bool) []int {
	// TODO: prune val from unassigned neighbors; collect wipeouts
	return nil
}

func main() {
	domains := map[int][]int{1: {0}, 2: {0, 1}}
	fmt.Println(forwardCheck(0, 0, domains, []int{1, 2}, map[int]bool{})) // [1]
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static List<Integer> forwardCheck(int v, int val, Map<Integer, List<Integer>> domains,
                                      int[] neighbors, Set<Integer> assigned) {
        // TODO
        return new ArrayList<>();
    }

    public static void main(String[] args) {
        Map<Integer, List<Integer>> domains = new HashMap<>();
        domains.put(1, new ArrayList<>(List.of(0)));
        domains.put(2, new ArrayList<>(List.of(0, 1)));
        System.out.println(forwardCheck(0, 0, domains, new int[]{1, 2}, new HashSet<>())); // [1]
    }
}
```

**Starter — Python.**
```python
def forward_check(v, val, domains, neighbors, assigned):
    # TODO: prune val from unassigned neighbors; collect wipeouts
    return []


if __name__ == "__main__":
    domains = {1: [0], 2: [0, 1]}
    print(forward_check(0, 0, domains, [1, 2], set()))  # [1]
```

---

### Task 4 — Map coloring decision (2 colors)

**Problem.** Given an undirected graph, decide whether it is 2-colorable (i.e. bipartite) using a CSP backtracking solver. Return `true`/`false`.

**Input / Output spec.**
- Inputs: `n` (vertices), `edges` (list of pairs).
- Output: boolean.

**Constraints.** `1 ≤ n ≤ 1000`. Graph may be disconnected.

**Hint.** Domain `{0, 1}`; backtrack with `≠` constraints, or recognize this is just bipartiteness.

**Starter — Go.**
```go
package main

import "fmt"

func twoColorable(n int, edges [][2]int) bool {
	// TODO: backtracking CSP with 2 colors
	return false
}

func main() {
	fmt.Println(twoColorable(3, [][2]int{{0, 1}, {1, 2}}))           // true
	fmt.Println(twoColorable(3, [][2]int{{0, 1}, {1, 2}, {2, 0}}))   // false
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    static boolean twoColorable(int n, int[][] edges) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        System.out.println(twoColorable(3, new int[][]{{0, 1}, {1, 2}}));            // true
        System.out.println(twoColorable(3, new int[][]{{0, 1}, {1, 2}, {2, 0}}));    // false
    }
}
```

**Starter — Python.**
```python
def two_colorable(n, edges):
    # TODO: backtracking CSP with 2 colors
    return False


if __name__ == "__main__":
    print(two_colorable(3, [(0, 1), (1, 2)]))           # True
    print(two_colorable(3, [(0, 1), (1, 2), (2, 0)]))   # False
```

---

## Intermediate Tasks (3)

### Task 5 — Graph coloring with MRV + forward checking

**Problem.** Return a proper `k`-coloring of an undirected graph using backtracking with MRV variable selection and forward checking, or report that none exists.

**Input / Output spec.**
- Inputs: `n`, `k`, `edges`.
- Output: a length-`n` array of colors `0..k-1`, or `null`/`None`/`nil` if infeasible.

**Constraints.** `1 ≤ n ≤ 200`, `1 ≤ k ≤ 8`. Must use MRV and restore domains on backtrack.

**Hint.** Use a bitset/boolean array per vertex for the domain; wipeout = no bit set.

**Starter — Go.**
```go
package main

import "fmt"

func kColor(n, k int, edges [][2]int) ([]int, bool) {
	// TODO: MRV + forward checking backtracking
	return nil, false
}

func main() {
	col, ok := kColor(4, 3, [][2]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}})
	fmt.Println(col, ok)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    static int[] kColor(int n, int k, int[][] edges) {
        // TODO: MRV + forward checking; return null if infeasible
        return null;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            kColor(4, 3, new int[][]{{0, 1}, {1, 2}, {2, 0}, {2, 3}})));
    }
}
```

**Starter — Python.**
```python
def k_color(n, k, edges):
    # TODO: MRV + forward checking backtracking
    return None


if __name__ == "__main__":
    print(k_color(4, 3, [(0, 1), (1, 2), (2, 0), (2, 3)]))
```

---

### Task 6 — AC-3 with a custom constraint

**Problem.** Implement AC-3 for a binary CSP defined by a predicate `allowed(x, vx, y, vy)`. Return reduced domains, or signal inconsistency on a wipeout. Test on the constraint `vx < vy` over a small chain.

**Input / Output spec.**
- Inputs: `domains` (map var → values), `neighbors` (map var → list), `allowed` predicate.
- Output: reduced domains and a boolean consistency flag.

**Constraints.** `1 ≤ vars ≤ 500`, `|domain| ≤ 50`. Must re-enqueue arcs correctly after pruning.

**Hint.** Queue all arcs; on a successful revise, re-enqueue `(z, x)` for neighbors `z ≠ y`.

**Starter — Go.**
```go
package main

import "fmt"

func ac3(domains map[int][]int, neighbors map[int][]int,
	allowed func(x, vx, y, vy int) bool) bool {
	// TODO: arc-consistency fixpoint; false on wipeout
	return true
}

func main() {
	domains := map[int][]int{0: {1, 2, 3}, 1: {1, 2, 3}}
	neighbors := map[int][]int{0: {1}, 1: {0}}
	allowed := func(x, vx, y, vy int) bool {
		if x < y {
			return vx < vy
		}
		return vy < vx
	}
	fmt.Println(ac3(domains, neighbors, allowed), domains)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    interface Quad { boolean ok(int x, int vx, int y, int vy); }

    static boolean ac3(Map<Integer, List<Integer>> domains,
                       Map<Integer, List<Integer>> neighbors, Quad allowed) {
        // TODO
        return true;
    }

    public static void main(String[] args) {
        Map<Integer, List<Integer>> domains = new HashMap<>();
        domains.put(0, new ArrayList<>(List.of(1, 2, 3)));
        domains.put(1, new ArrayList<>(List.of(1, 2, 3)));
        Map<Integer, List<Integer>> neighbors = Map.of(0, List.of(1), 1, List.of(0));
        Quad allowed = (x, vx, y, vy) -> x < y ? vx < vy : vy < vx;
        System.out.println(ac3(domains, neighbors, allowed) + " " + domains);
    }
}
```

**Starter — Python.**
```python
from collections import deque


def ac3(domains, neighbors, allowed):
    # TODO: arc-consistency fixpoint; False on wipeout
    return True


if __name__ == "__main__":
    domains = {0: [1, 2, 3], 1: [1, 2, 3]}
    neighbors = {0: [1], 1: [0]}
    allowed = lambda x, vx, y, vy: (vx < vy) if x < y else (vy < vx)
    print(ac3(domains, neighbors, allowed), domains)
```

---

### Task 7 — Cryptarithmetic verifier and solver

**Problem.** Given three words `a + b = c`, find a digit assignment to distinct letters (no leading zeros) making the equation hold, or report none. Return the mapping.

**Input / Output spec.**
- Inputs: three uppercase words.
- Output: map letter → digit, or none.

**Constraints.** Total distinct letters ≤ 10. Words length ≤ 8.

**Hint.** Collect distinct letters and leading letters; backtrack over digit assignment; verify the sum at a complete assignment.

**Starter — Go.**
```go
package main

import "fmt"

func solveCrypto(a, b, c string) (map[byte]int, bool) {
	// TODO: assign distinct digits, no leading zeros, check a+b==c
	return nil, false
}

func main() {
	sol, ok := solveCrypto("SEND", "MORE", "MONEY")
	fmt.Println(sol, ok)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    static Map<Character, Integer> solveCrypto(String a, String b, String c) {
        // TODO
        return null;
    }

    public static void main(String[] args) {
        System.out.println(solveCrypto("SEND", "MORE", "MONEY"));
    }
}
```

**Starter — Python.**
```python
def solve_crypto(a, b, c):
    # TODO: distinct digits, no leading zeros, a + b == c
    return None


if __name__ == "__main__":
    print(solve_crypto("SEND", "MORE", "MONEY"))
```

---

## Advanced Tasks (3)

### Task 8 — Generic CSP solver with MAC

**Problem.** Build a reusable solver taking variables, domains, neighbors, and a binary constraint predicate; solve with backtracking + MRV + MAC (AC-3 at each node). Demonstrate on an `n=8` N-Queens CSP.

**Input / Output spec.**
- Inputs: model components and a constraint callback.
- Output: a satisfying assignment, or none.

**Constraints.** Must snapshot/restore domains per node; must not corrupt state across branches.

**Hint.** After assigning `X=v`, set `domain[X]={v}`, seed AC-3 with arcs `(Y, X)` for neighbors, and recurse on a domain copy.

**Starter — Go.**
```go
package main

import "fmt"

func solveMAC(vars []int, domains map[int][]int, neighbors map[int][]int,
	ok func(a, va, b, vb int) bool) (map[int]int, bool) {
	// TODO: MRV + MAC backtracking
	return nil, false
}

func main() {
	n := 8
	vars := make([]int, n)
	domains := map[int][]int{}
	neighbors := map[int][]int{}
	for r := 0; r < n; r++ {
		vars[r] = r
		d := make([]int, n)
		for c := 0; c < n; c++ {
			d[c] = c
		}
		domains[r] = d
		for r2 := 0; r2 < n; r2++ {
			if r2 != r {
				neighbors[r] = append(neighbors[r], r2)
			}
		}
	}
	ok := func(a, ca, b, cb int) bool {
		dr := a - b
		if dr < 0 {
			dr = -dr
		}
		dc := ca - cb
		if dc < 0 {
			dc = -dc
		}
		return ca != cb && dr != dc
	}
	sol, found := solveMAC(vars, domains, neighbors, ok)
	fmt.Println(sol, found)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task8 {
    interface Quad { boolean ok(int a, int va, int b, int vb); }

    static Map<Integer, Integer> solveMAC(int[] vars, Map<Integer, List<Integer>> domains,
                                          Map<Integer, List<Integer>> neighbors, Quad c) {
        // TODO: MRV + MAC
        return null;
    }

    public static void main(String[] args) {
        int n = 8;
        int[] vars = new int[n];
        Map<Integer, List<Integer>> domains = new HashMap<>(), neighbors = new HashMap<>();
        for (int r = 0; r < n; r++) {
            vars[r] = r;
            List<Integer> d = new ArrayList<>();
            for (int cc = 0; cc < n; cc++) d.add(cc);
            domains.put(r, d);
            List<Integer> nb = new ArrayList<>();
            for (int r2 = 0; r2 < n; r2++) if (r2 != r) nb.add(r2);
            neighbors.put(r, nb);
        }
        Quad c = (a, ca, b, cb) -> ca != cb && Math.abs(a - b) != Math.abs(ca - cb);
        System.out.println(solveMAC(vars, domains, neighbors, c));
    }
}
```

**Starter — Python.**
```python
def solve_mac(variables, domains, neighbors, ok):
    # TODO: MRV + MAC (AC-3 at each node)
    return None


if __name__ == "__main__":
    n = 8
    variables = list(range(n))
    domains = {r: list(range(n)) for r in range(n)}
    neighbors = {r: [r2 for r2 in range(n) if r2 != r] for r in range(n)}
    ok = lambda a, ca, b, cb: ca != cb and abs(a - b) != abs(ca - cb)
    print(solve_mac(variables, domains, neighbors, ok))
```

---

### Task 9 — Sudoku as a CSP

**Problem.** Solve a 9×9 Sudoku modeled as a CSP: 81 cell variables, domains `1..9`, `AllDifferent` over each row, column, and 3×3 box. Use MRV + forward checking (or MAC). Return the completed grid.

**Input / Output spec.**
- Input: 9×9 grid with `0` for blanks.
- Output: solved grid, or report unsolvable.

**Constraints.** Standard Sudoku rules. Should solve typical boards quickly via propagation.

**Hint.** Precompute each cell's "peers" (the up-to-20 cells sharing a unit) as its neighbors; the constraint is `≠` among peers.

**Starter — Go.**
```go
package main

import "fmt"

func solveSudoku(grid [9][9]int) ([9][9]int, bool) {
	// TODO: CSP with AllDifferent (as != among peers), MRV + forward checking
	return grid, false
}

func main() {
	var g [9][9]int
	// 0 = blank; fill a puzzle here
	g[0] = [9]int{5, 3, 0, 0, 7, 0, 0, 0, 0}
	out, ok := solveSudoku(g)
	fmt.Println(out, ok)
}
```

**Starter — Java.**
```java
public class Task9 {
    static boolean solveSudoku(int[][] grid) {
        // TODO: CSP MRV + forward checking; mutate grid in place
        return false;
    }

    public static void main(String[] args) {
        int[][] g = new int[9][9];
        g[0] = new int[]{5, 3, 0, 0, 7, 0, 0, 0, 0};
        System.out.println(solveSudoku(g));
    }
}
```

**Starter — Python.**
```python
def solve_sudoku(grid):
    # TODO: CSP with AllDifferent peers, MRV + forward checking
    return False


if __name__ == "__main__":
    g = [[0] * 9 for _ in range(9)]
    g[0] = [5, 3, 0, 0, 7, 0, 0, 0, 0]
    print(solve_sudoku(g))
```

---

### Task 10 — Exam scheduling CSP

**Problem.** Schedule `m` exams into `s` time slots so that no student has two exams in the same slot. Input: a list of student enrollments (each student lists the exams they take). Two exams sharing any student conflict (a `≠` constraint). Return a slot assignment per exam, or report infeasible.

**Input / Output spec.**
- Inputs: `m` (exams), `s` (slots), `enrollments` (list of exam-id lists per student).
- Output: array of slot per exam, or none.

**Constraints.** `1 ≤ m ≤ 100`, `1 ≤ s ≤ 12`. This is graph coloring with `s` colors on the conflict graph.

**Hint.** Build the conflict graph (edge between exams sharing a student), then run your `k`-coloring solver with `k = s`. Use MRV + forward checking.

**Starter — Go.**
```go
package main

import "fmt"

func scheduleExams(m, s int, enrollments [][]int) ([]int, bool) {
	// TODO: build conflict graph, color with s colors
	return nil, false
}

func main() {
	enroll := [][]int{{0, 1}, {1, 2}, {0, 2}}
	sol, ok := scheduleExams(3, 3, enroll)
	fmt.Println(sol, ok)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    static int[] scheduleExams(int m, int s, List<List<Integer>> enrollments) {
        // TODO: conflict graph + s-coloring
        return null;
    }

    public static void main(String[] args) {
        List<List<Integer>> enroll = List.of(
            List.of(0, 1), List.of(1, 2), List.of(0, 2));
        System.out.println(Arrays.toString(scheduleExams(3, 3, enroll)));
    }
}
```

**Starter — Python.**
```python
def schedule_exams(m, s, enrollments):
    # TODO: build conflict graph, color with s colors (MRV + forward checking)
    return None


if __name__ == "__main__":
    enroll = [[0, 1], [1, 2], [0, 2]]
    print(schedule_exams(3, 3, enroll))
```

---

## Evaluation Criteria

| Criterion | What to check |
|-----------|---------------|
| Correctness | Returned assignment satisfies *all* constraints (re-validate independently). |
| Completeness | Returns a solution when one exists; returns failure cleanly when none does. |
| Heuristics | MRV (and degree tie-break) actually used where required. |
| Propagation | Forward checking / AC-3 prunes domains and detects wipeouts. |
| State hygiene | Domains and assignments fully restored on backtrack — no cross-branch corruption. |
| Edge cases | Empty domains, isolated variables, unsolvable instances, multiple solutions. |
| Testing | Compared against a brute-force oracle on small inputs. |

Test every solution in Go, Java, and Python. For each task, write at least one solvable case, one unsolvable case, and (where relevant) one case with multiple valid outputs.
