# Constraint Satisfaction Problems (CSP) — Interview Preparation

CSP is a favourite interview topic because it tests one crisp idea — *model the problem as variables/domains/constraints and search with backtracking* — and then probes whether you can make it fast with the standard heuristics (MRV, degree, LCV) and propagation (forward checking, AC-3, MAC). Interviewers love it because graph coloring, N-Queens, Sudoku, cryptarithmetic, and scheduling are all the *same* problem in disguise. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| CSP | `(X, D, C)` — variables, domains, constraints |
| Backtracking | assign, check consistency, recurse, undo |
| MRV | pick variable with fewest legal values (fail-first) |
| Degree heuristic | MRV tie-break: most constraints with unassigned vars |
| LCV | pick value ruling out fewest neighbor options |
| Forward checking | prune neighbor domains after each assignment |
| AC-3 | enforce arc consistency network-wide, `O(e·d³)` |
| MAC | run AC-3 at every search node |
| Backjumping | jump back to the real culprit, not just one level |
| Complexity | NP-complete in general |

Core algorithm:

```text
backtrack(assignment, domains):
    if complete: return assignment
    X = MRV(unassigned)                 # degree breaks ties
    for v in LCV-order(X):
        if consistent(X=v, assignment):
            assign X=v; propagate (forward check / AC-3)
            if no wipeout and backtrack(...): return solution
            undo propagation; unassign X
    return failure
```

Key facts:
- Backtracking is **sound and complete** but exponential worst case.
- MRV is the highest-leverage heuristic; LCV only helps when seeking *one* solution.
- AC-3 is a *pruner*, not a *decider* — arc consistency does not guarantee solvability.
- CSP is NP-complete; reduce from 3-COLORING or 3-SAT to prove it.

---

## Junior Questions (10 Q&A)

### J1. What are the three components of a CSP?
Variables `X` (what we decide), domains `D` (allowed values per variable), and constraints `C` (rules on which value-combinations are legal). A solution is a complete assignment satisfying all constraints.

### J2. What is backtracking search?
A depth-first search over partial assignments: pick an unassigned variable, try a value, check it's consistent with assigned variables, recurse; if a dead end is hit, undo the last choice and try another value. Undoing is the "backtrack."

### J3. What does "consistent" mean for a partial assignment?
It violates no constraint *all of whose variables are already assigned*. Constraints touching unassigned variables aren't yet decided.

### J4. Why is plain backtracking exponential?
With `n` variables and domain size `d`, the assignment tree has up to `dⁿ` leaves. Without pruning you may explore exponentially many.

### J5. What is the MRV heuristic?
Minimum Remaining Values: choose the unassigned variable with the fewest legal values left. It fails fast (high in the tree) and is the single most effective ordering heuristic.

### J6. What is forward checking?
After assigning `X = v`, remove `v` (or now-inconsistent values) from the domains of `X`'s unassigned neighbors. If any neighbor's domain empties (a wipeout), backtrack immediately.

### J7. How is map coloring a CSP?
Each region is a variable, its domain is the set of colors, and each pair of adjacent regions has a `≠` constraint. A proper coloring is a solution.

### J8. What's the difference between a constraint check and a solution?
A consistency check is *local* (no broken constraint so far); a solution is *global and complete* (all variables assigned, all constraints satisfied). A consistent partial assignment is not a solution.

### J9. Why must you undo assignments on backtrack?
So sibling branches see clean state. Leftover assignments or pruned domains corrupt the rest of the search, causing wrong or missing answers.

### J10. Name two example CSPs besides map coloring.
N-Queens (variables = queens/columns, constraint = no two attack), Sudoku (variables = cells, domains = 1–9, `AllDifferent` per row/column/box), cryptarithmetic, exam scheduling.

---

## Mid-Level Questions (8 Q&A)

### M1. Compare forward checking with AC-3.
Forward checking only prunes the *direct neighbors* of the just-assigned variable (one constraint deep). AC-3 enforces full arc consistency across the whole network, re-checking arcs whenever a domain shrinks — it catches dead ends forward checking misses, at higher cost.

### M2. What's the degree heuristic and when do you use it?
Pick the variable in the most constraints with still-unassigned variables. Use it to break MRV ties — especially at the start when all domains are equal size.

### M3. What is LCV and when does it *not* help?
Least Constraining Value: try the value eliminating the fewest neighbor options first. It speeds up finding *one* solution; it gives no benefit when finding *all* solutions or proving unsatisfiability, because you try every value anyway.

### M4. Explain AC-3 in a sentence and give its complexity.
Maintain a queue of arcs; revise each arc by deleting tail values lacking support; when a domain shrinks, re-enqueue arcs pointing into it; repeat to a fixpoint. Complexity `O(e·d³)`.

### M5. Does arc consistency mean the CSP is solvable?
No. A triangle of variables with domain `{R, G}` and `≠` constraints is arc consistent but unsatisfiable (can't 2-color a triangle). AC-3 prunes and can prove infeasibility (empty domain) but doesn't decide solvability in general.

### M6. What is MAC?
Maintaining Arc Consistency: run AC-3 at every search node after each assignment, propagating its consequences throughout the network. It explores far fewer nodes than forward checking on hard problems, at more cost per node.

### M7. How would you model SEND + MORE = MONEY?
Variables = letters (+ carry variables), domains = digits 0–9 (leading letters 1–9), constraints = `AllDifferent` over letters plus the column-addition equations with carries. The unique solution is 9567 + 1085 = 10652.

### M8. Why is the `AllDifferent` global constraint better than pairwise `≠`?
A dedicated `AllDifferent` propagator (Régin's matching algorithm) achieves generalized arc consistency: it spots, e.g., that 4 variables sharing only 3 values is already impossible — something `O(n²)` pairwise `≠` constraints discover much later or not until search.

---

## Senior Questions (7 Q&A)

### S1. When would you choose forward checking over MAC?
On loosely constrained problems with large branching where AC-3's per-node cost outweighs the extra pruning. Always measure node count *and* wall-clock — fewer nodes is worthless if each node is far slower.

### S2. Explain conflict-directed backjumping.
Instead of undoing the most recent decision, jump back to the deepest *earlier* variable that actually caused the conflict (its conflict set), skipping irrelevant intervening choices, and propagate the conflict set upward. It avoids re-exploring dead ends that don't involve the recent decisions.

### S3. What is no-good learning?
Recording a proven-inconsistent partial assignment as a new constraint so the solver never re-enters it anywhere. It's the CSP analogue of SAT's conflict-driven clause learning (CDCL). You must minimize and periodically delete learned no-goods to control memory.

### S4. Build or buy?
For most production problems, encode to a mature CP/SAT solver (OR-Tools CP-SAT, Gecode, Choco) and inherit learning, restarts, and strong propagators. Hand-roll only for tiny dependency footprints, embedded targets, or exotic constraints.

### S5. How do you encode a finite-domain CSP into SAT?
Direct encoding: Boolean `x_{v,d}` = "v takes d," with at-least-one and at-most-one clauses per variable, and clauses per constraint forbidding illegal tuples. Order encoding is better for inequalities. The encoding choice strongly affects performance.

### S6. How do you test a CSP solver?
Independent solution validator (re-check all constraints), known-answer instances (SEND+MORE=MONEY, fixed Sudoku boards), brute-force oracle for small `n`, property-based tests (generate solvable instances from a known solution, assert a solution is found; generate unsatisfiable ones, assert failure), and metrics on node/backtrack counts.

### S7. What's the role of symmetry breaking?
Many CSPs have symmetric solutions (color permutations, board reflections). Adding symmetry-breaking constraints (fix the first region's color, impose lexicographic order) prunes the search by the symmetry-group size — often the biggest cheap win.

---

## Behavioral / Design Prompts

- *"Walk me through choosing a propagation strategy for a real scheduling system."* — Discuss measuring node counts, staged propagation, global `cumulative`/`AllDifferent` constraints, and falling back to CP-SAT.
- *"Tell me about a time a search-based feature was too slow."* — Frame the MRV/propagation/symmetry-breaking levers; emphasize measurement before optimization.
- *"How would you explain backtracking to a non-engineer?"* — Use the crossword-in-pencil or wedding-seating analogy.
- *"Your CSP solver returns a wrong answer in production. How do you debug?"* — Solution validator, deterministic seed, shrink to minimal failing instance, compare against brute-force oracle.

---

## Coding Challenge 1: Graph Coloring CSP

**Problem.** Given an undirected graph and `k` colors, decide whether a proper coloring exists and return one. Use backtracking with MRV and forward checking.

#### Go

```go
package main

import "fmt"

func colorGraph(n, k int, edges [][2]int) ([]int, bool) {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	color := make([]int, n)
	for i := range color {
		color[i] = -1
	}
	domains := make([][]bool, n)
	for i := range domains {
		domains[i] = make([]bool, k)
		for c := 0; c < k; c++ {
			domains[i][c] = true
		}
	}

	selectMRV := func() int {
		best, bestN := -1, 1<<30
		for v := 0; v < n; v++ {
			if color[v] != -1 {
				continue
			}
			cnt := 0
			for c := 0; c < k; c++ {
				if domains[v][c] {
					cnt++
				}
			}
			if cnt < bestN {
				best, bestN = v, cnt
			}
		}
		return best
	}

	var bt func(assigned int) bool
	bt = func(assigned int) bool {
		if assigned == n {
			return true
		}
		v := selectMRV()
		for c := 0; c < k; c++ {
			if !domains[v][c] {
				continue
			}
			ok := true
			for _, nb := range adj[v] {
				if color[nb] == c {
					ok = false
					break
				}
			}
			if !ok {
				continue
			}
			color[v] = c
			pruned := []int{}
			wipe := false
			for _, nb := range adj[v] {
				if color[nb] == -1 && domains[nb][c] {
					domains[nb][c] = false
					pruned = append(pruned, nb)
					empty := true
					for cc := 0; cc < k; cc++ {
						if domains[nb][cc] {
							empty = false
							break
						}
					}
					if empty {
						wipe = true
					}
				}
			}
			if !wipe && bt(assigned+1) {
				return true
			}
			for _, nb := range pruned {
				domains[nb][c] = true
			}
			color[v] = -1
		}
		return false
	}

	if bt(0) {
		return color, true
	}
	return nil, false
}

func main() {
	edges := [][2]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}}
	if col, ok := colorGraph(4, 3, edges); ok {
		fmt.Println("Coloring:", col)
	} else {
		fmt.Println("No coloring")
	}
}
```

#### Java

```java
import java.util.*;

public class GraphColoring {
    static int n, k;
    static List<Integer>[] adj;
    static int[] color;
    static boolean[][] domains;

    static int selectMRV() {
        int best = -1, bestN = Integer.MAX_VALUE;
        for (int v = 0; v < n; v++) {
            if (color[v] != -1) continue;
            int cnt = 0;
            for (int c = 0; c < k; c++) if (domains[v][c]) cnt++;
            if (cnt < bestN) { best = v; bestN = cnt; }
        }
        return best;
    }

    static boolean bt(int assigned) {
        if (assigned == n) return true;
        int v = selectMRV();
        for (int c = 0; c < k; c++) {
            if (!domains[v][c]) continue;
            boolean ok = true;
            for (int nb : adj[v]) if (color[nb] == c) { ok = false; break; }
            if (!ok) continue;
            color[v] = c;
            List<Integer> pruned = new ArrayList<>();
            boolean wipe = false;
            for (int nb : adj[v]) {
                if (color[nb] == -1 && domains[nb][c]) {
                    domains[nb][c] = false;
                    pruned.add(nb);
                    boolean empty = true;
                    for (int cc = 0; cc < k; cc++) if (domains[nb][cc]) { empty = false; break; }
                    if (empty) wipe = true;
                }
            }
            if (!wipe && bt(assigned + 1)) return true;
            for (int nb : pruned) domains[nb][c] = true;
            color[v] = -1;
        }
        return false;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        n = 4; k = 3;
        int[][] edges = {{0, 1}, {1, 2}, {2, 0}, {2, 3}};
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int[] e : edges) { adj[e[0]].add(e[1]); adj[e[1]].add(e[0]); }
        color = new int[n];
        Arrays.fill(color, -1);
        domains = new boolean[n][k];
        for (boolean[] row : domains) Arrays.fill(row, true);
        System.out.println(bt(0) ? "Coloring: " + Arrays.toString(color) : "No coloring");
    }
}
```

#### Python

```python
def color_graph(n, k, edges):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)
    color = [-1] * n
    domains = [set(range(k)) for _ in range(n)]

    def select_mrv():
        return min((v for v in range(n) if color[v] == -1),
                   key=lambda v: len(domains[v]))

    def bt(assigned):
        if assigned == n:
            return True
        v = select_mrv()
        for c in list(domains[v]):
            if any(color[nb] == c for nb in adj[v]):
                continue
            color[v] = c
            pruned = []
            wipe = False
            for nb in adj[v]:
                if color[nb] == -1 and c in domains[nb]:
                    domains[nb].discard(c)
                    pruned.append(nb)
                    if not domains[nb]:
                        wipe = True
            if not wipe and bt(assigned + 1):
                return True
            for nb in pruned:
                domains[nb].add(c)
            color[v] = -1
        return False

    return (color, True) if bt(0) else (None, False)


if __name__ == "__main__":
    col, ok = color_graph(4, 3, [(0, 1), (1, 2), (2, 0), (2, 3)])
    print("Coloring:", col if ok else "No coloring")
```

---

## Coding Challenge 2: Cryptarithmetic Solver (SEND + MORE = MONEY)

**Problem.** Assign distinct digits to distinct letters so the addition holds, with no leading zeros. Return the mapping. Backtracking over digit permutations with pruning suffices for this size.

#### Go

```go
package main

import "fmt"

func solveCrypto() map[byte]int {
	letters := []byte{'S', 'E', 'N', 'D', 'M', 'O', 'R', 'Y'}
	used := [10]bool{}
	assign := map[byte]int{}

	value := func(word string) int {
		v := 0
		for i := 0; i < len(word); i++ {
			v = v*10 + assign[word[i]]
		}
		return v
	}

	var bt func(i int) bool
	bt = func(i int) bool {
		if i == len(letters) {
			if assign['S'] == 0 || assign['M'] == 0 {
				return false
			}
			return value("SEND")+value("MORE") == value("MONEY")
		}
		for d := 0; d < 10; d++ {
			if used[d] {
				continue
			}
			if (letters[i] == 'S' || letters[i] == 'M') && d == 0 {
				continue
			}
			used[d] = true
			assign[letters[i]] = d
			if bt(i + 1) {
				return true
			}
			used[d] = false
			delete(assign, letters[i])
		}
		return false
	}

	if bt(0) {
		return assign
	}
	return nil
}

func main() {
	sol := solveCrypto()
	fmt.Println(sol) // map[D:7 E:5 M:1 N:6 O:0 R:8 S:9 Y:2]
}
```

#### Java

```java
import java.util.*;

public class Cryptarithmetic {
    static char[] letters = {'S', 'E', 'N', 'D', 'M', 'O', 'R', 'Y'};
    static boolean[] used = new boolean[10];
    static Map<Character, Integer> assign = new HashMap<>();

    static int value(String w) {
        int v = 0;
        for (char ch : w.toCharArray()) v = v * 10 + assign.get(ch);
        return v;
    }

    static boolean bt(int i) {
        if (i == letters.length) {
            if (assign.get('S') == 0 || assign.get('M') == 0) return false;
            return value("SEND") + value("MORE") == value("MONEY");
        }
        for (int d = 0; d < 10; d++) {
            if (used[d]) continue;
            if ((letters[i] == 'S' || letters[i] == 'M') && d == 0) continue;
            used[d] = true;
            assign.put(letters[i], d);
            if (bt(i + 1)) return true;
            used[d] = false;
            assign.remove(letters[i]);
        }
        return false;
    }

    public static void main(String[] args) {
        System.out.println(bt(0) ? assign : "No solution");
    }
}
```

#### Python

```python
def solve_crypto():
    letters = ['S', 'E', 'N', 'D', 'M', 'O', 'R', 'Y']
    used = [False] * 10
    assign = {}

    def value(word):
        v = 0
        for ch in word:
            v = v * 10 + assign[ch]
        return v

    def bt(i):
        if i == len(letters):
            if assign['S'] == 0 or assign['M'] == 0:
                return False
            return value("SEND") + value("MORE") == value("MONEY")
        for d in range(10):
            if used[d]:
                continue
            if letters[i] in ('S', 'M') and d == 0:
                continue
            used[d] = True
            assign[letters[i]] = d
            if bt(i + 1):
                return True
            used[d] = False
            del assign[letters[i]]
        return False

    return assign if bt(0) else None


if __name__ == "__main__":
    print(solve_crypto())  # {'S':9,'E':5,'N':6,'D':7,'M':1,'O':0,'R':8,'Y':2}
```

---

## Coding Challenge 3: AC-3 Arc Consistency

**Problem.** Implement AC-3 over a binary CSP given domains and a constraint predicate. Return reduced domains, or report inconsistency on a wipeout.

#### Go

```go
package main

import "fmt"

func ac3(domains map[int][]int, neighbors map[int][]int,
	ok func(a, va, b, vb int) bool) bool {
	type arc struct{ x, y int }
	var q []arc
	for x, nbs := range neighbors {
		for _, y := range nbs {
			q = append(q, arc{x, y})
		}
	}
	revise := func(x, y int) bool {
		removed := false
		kept := []int{}
		for _, vx := range domains[x] {
			support := false
			for _, vy := range domains[y] {
				if ok(x, vx, y, vy) {
					support = true
					break
				}
			}
			if support {
				kept = append(kept, vx)
			} else {
				removed = true
			}
		}
		domains[x] = kept
		return removed
	}
	for len(q) > 0 {
		a := q[0]
		q = q[1:]
		if revise(a.x, a.y) {
			if len(domains[a.x]) == 0 {
				return false
			}
			for _, z := range neighbors[a.x] {
				if z != a.y {
					q = append(q, arc{z, a.x})
				}
			}
		}
	}
	return true
}

func main() {
	domains := map[int][]int{0: {0}, 1: {0, 1, 2}, 2: {0, 1, 2}}
	neighbors := map[int][]int{0: {1, 2}, 1: {0, 2}, 2: {0, 1}}
	ok := func(a, va, b, vb int) bool { return va != vb }
	if ac3(domains, neighbors, ok) {
		fmt.Println("Arc consistent:", domains)
	} else {
		fmt.Println("Inconsistent")
	}
}
```

#### Java

```java
import java.util.*;

public class AC3Challenge {
    interface Quad { boolean ok(int a, int va, int b, int vb); }

    static boolean ac3(Map<Integer, List<Integer>> domains,
                       Map<Integer, List<Integer>> neighbors, Quad c) {
        Deque<int[]> q = new ArrayDeque<>();
        for (int x : neighbors.keySet())
            for (int y : neighbors.get(x)) q.add(new int[]{x, y});
        while (!q.isEmpty()) {
            int[] a = q.poll();
            if (revise(domains, a[0], a[1], c)) {
                if (domains.get(a[0]).isEmpty()) return false;
                for (int z : neighbors.get(a[0]))
                    if (z != a[1]) q.add(new int[]{z, a[0]});
            }
        }
        return true;
    }

    static boolean revise(Map<Integer, List<Integer>> dom, int x, int y, Quad c) {
        boolean removed = false;
        List<Integer> kept = new ArrayList<>();
        for (int vx : dom.get(x)) {
            boolean support = false;
            for (int vy : dom.get(y)) if (c.ok(x, vx, y, vy)) { support = true; break; }
            if (support) kept.add(vx); else removed = true;
        }
        dom.put(x, kept);
        return removed;
    }

    public static void main(String[] args) {
        Map<Integer, List<Integer>> domains = new HashMap<>();
        domains.put(0, new ArrayList<>(List.of(0)));
        domains.put(1, new ArrayList<>(List.of(0, 1, 2)));
        domains.put(2, new ArrayList<>(List.of(0, 1, 2)));
        Map<Integer, List<Integer>> neighbors = Map.of(
            0, List.of(1, 2), 1, List.of(0, 2), 2, List.of(0, 1));
        System.out.println(ac3(domains, neighbors, (a, va, b, vb) -> va != vb)
            ? "Arc consistent: " + domains : "Inconsistent");
    }
}
```

#### Python

```python
from collections import deque


def ac3(domains, neighbors, ok):
    def revise(x, y):
        removed = False
        kept = []
        for vx in domains[x]:
            if any(ok(x, vx, y, vy) for vy in domains[y]):
                kept.append(vx)
            else:
                removed = True
        domains[x] = kept
        return removed

    q = deque((x, y) for x in neighbors for y in neighbors[x])
    while q:
        x, y = q.popleft()
        if revise(x, y):
            if not domains[x]:
                return False
            for z in neighbors[x]:
                if z != y:
                    q.append((z, x))
    return True


if __name__ == "__main__":
    domains = {0: [0], 1: [0, 1, 2], 2: [0, 1, 2]}
    neighbors = {0: [1, 2], 1: [0, 2], 2: [0, 1]}
    ok = lambda a, va, b, vb: va != vb
    print("Arc consistent:" if ac3(domains, neighbors, ok) else "Inconsistent", domains)
```

---

## Coding Challenge 4: Generic Backtracking CSP Solver

**Problem.** Write a reusable solver: given variables, domains, a neighbor map, and a binary constraint predicate, return a solution via backtracking + MRV + forward checking. Demonstrate on N-Queens (n=6) modeled as a CSP (variable = column index per row, constraint = no same column and no diagonal attack).

#### Go

```go
package main

import "fmt"

func solveCSP(vars []int, domains map[int][]int, neighbors map[int][]int,
	ok func(a, va, b, vb int) bool) (map[int]int, bool) {
	assign := map[int]int{}
	dom := map[int][]int{}
	for k, v := range domains {
		dom[k] = append([]int{}, v...)
	}
	consistent := func(v, val int) bool {
		for _, nb := range neighbors[v] {
			if vv, has := assign[nb]; has && !ok(v, val, nb, vv) {
				return false
			}
		}
		return true
	}
	selectMRV := func() int {
		best, bestN := -1, 1<<30
		for _, v := range vars {
			if _, has := assign[v]; has {
				continue
			}
			if len(dom[v]) < bestN {
				best, bestN = v, len(dom[v])
			}
		}
		return best
	}
	var bt func() bool
	bt = func() bool {
		if len(assign) == len(vars) {
			return true
		}
		v := selectMRV()
		for _, val := range dom[v] {
			if !consistent(v, val) {
				continue
			}
			assign[v] = val
			saved := map[int][]int{}
			wipe := false
			for _, nb := range neighbors[v] {
				if _, has := assign[nb]; has {
					continue
				}
				saved[nb] = dom[nb]
				kept := []int{}
				for _, w := range dom[nb] {
					if ok(nb, w, v, val) {
						kept = append(kept, w)
					}
				}
				dom[nb] = kept
				if len(kept) == 0 {
					wipe = true
				}
			}
			if !wipe && bt() {
				return true
			}
			for nb, d := range saved {
				dom[nb] = d
			}
			delete(assign, v)
		}
		return false
	}
	if bt() {
		return assign, true
	}
	return nil, false
}

func main() {
	n := 6
	vars := make([]int, n)
	domains := map[int][]int{}
	neighbors := map[int][]int{}
	for r := 0; r < n; r++ {
		vars[r] = r
		col := make([]int, n)
		for c := 0; c < n; c++ {
			col[c] = c
		}
		domains[r] = col
		for r2 := 0; r2 < n; r2++ {
			if r2 != r {
				neighbors[r] = append(neighbors[r], r2)
			}
		}
	}
	ok := func(a, ca, b, cb int) bool {
		return ca != cb && abs(a-b) != abs(ca-cb)
	}
	if sol, found := solveCSP(vars, domains, neighbors, ok); found {
		fmt.Println("Queens (row->col):", sol)
	} else {
		fmt.Println("No solution")
	}
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
```

#### Java

```java
import java.util.*;

public class GenericCSP {
    interface Quad { boolean ok(int a, int va, int b, int vb); }
    int[] vars;
    Map<Integer, List<Integer>> domains, neighbors;
    Quad c;
    Map<Integer, Integer> assign = new HashMap<>();

    boolean consistent(int v, int val) {
        for (int nb : neighbors.get(v)) {
            Integer vv = assign.get(nb);
            if (vv != null && !c.ok(v, val, nb, vv)) return false;
        }
        return true;
    }

    int selectMRV() {
        int best = -1, bestN = Integer.MAX_VALUE;
        for (int v : vars) {
            if (assign.containsKey(v)) continue;
            if (domains.get(v).size() < bestN) { best = v; bestN = domains.get(v).size(); }
        }
        return best;
    }

    boolean bt() {
        if (assign.size() == vars.length) return true;
        int v = selectMRV();
        for (int val : new ArrayList<>(domains.get(v))) {
            if (!consistent(v, val)) continue;
            assign.put(v, val);
            Map<Integer, List<Integer>> saved = new HashMap<>();
            boolean wipe = false;
            for (int nb : neighbors.get(v)) {
                if (assign.containsKey(nb)) continue;
                saved.put(nb, domains.get(nb));
                List<Integer> kept = new ArrayList<>();
                for (int w : domains.get(nb)) if (c.ok(nb, w, v, val)) kept.add(w);
                domains.put(nb, kept);
                if (kept.isEmpty()) wipe = true;
            }
            if (!wipe && bt()) return true;
            for (var e : saved.entrySet()) domains.put(e.getKey(), e.getValue());
            assign.remove(v);
        }
        return false;
    }

    public static void main(String[] args) {
        int n = 6;
        GenericCSP s = new GenericCSP();
        s.vars = new int[n];
        s.domains = new HashMap<>();
        s.neighbors = new HashMap<>();
        for (int r = 0; r < n; r++) {
            s.vars[r] = r;
            List<Integer> col = new ArrayList<>();
            for (int cc = 0; cc < n; cc++) col.add(cc);
            s.domains.put(r, col);
            List<Integer> nb = new ArrayList<>();
            for (int r2 = 0; r2 < n; r2++) if (r2 != r) nb.add(r2);
            s.neighbors.put(r, nb);
        }
        s.c = (a, ca, b, cb) -> ca != cb && Math.abs(a - b) != Math.abs(ca - cb);
        System.out.println(s.bt() ? "Queens (row->col): " + s.assign : "No solution");
    }
}
```

#### Python

```python
def solve_csp(variables, domains, neighbors, ok):
    domains = {k: list(v) for k, v in domains.items()}
    assign = {}

    def consistent(v, val):
        return all(ok(v, val, nb, assign[nb])
                   for nb in neighbors[v] if nb in assign)

    def select_mrv():
        return min((v for v in variables if v not in assign),
                   key=lambda v: len(domains[v]))

    def bt():
        if len(assign) == len(variables):
            return True
        v = select_mrv()
        for val in list(domains[v]):
            if not consistent(v, val):
                continue
            assign[v] = val
            saved, wipe = {}, False
            for nb in neighbors[v]:
                if nb in assign:
                    continue
                saved[nb] = domains[nb]
                domains[nb] = [w for w in domains[nb] if ok(nb, w, v, val)]
                if not domains[nb]:
                    wipe = True
            if not wipe and bt():
                return True
            for nb, d in saved.items():
                domains[nb] = d
            del assign[v]
        return False

    return (dict(assign), True) if bt() else (None, False)


if __name__ == "__main__":
    n = 6
    variables = list(range(n))
    domains = {r: list(range(n)) for r in range(n)}
    neighbors = {r: [r2 for r2 in range(n) if r2 != r] for r in range(n)}
    ok = lambda a, ca, b, cb: ca != cb and abs(a - b) != abs(ca - cb)
    sol, found = solve_csp(variables, domains, neighbors, ok)
    print("Queens (row->col):", sol if found else "No solution")
```

---

## Final Tips

- State the model out loud first: "variables are X, domains are Y, constraints are Z." It impresses interviewers and prevents bugs.
- Reach for **MRV + forward checking** as your default; mention AC-3/MAC as the next step if pressed on performance.
- Remember the trap: **arc consistency does not imply a solution** — say it before they ask.
- Know that CSP is **NP-complete** and how to prove it (reduce from 3-COLORING / 3-SAT).
- For "find all solutions," drop LCV (no benefit) and don't stop at the first solution.
- Always restore domains/assignments on backtrack — narrate the undo so the interviewer sees you won't corrupt state.
