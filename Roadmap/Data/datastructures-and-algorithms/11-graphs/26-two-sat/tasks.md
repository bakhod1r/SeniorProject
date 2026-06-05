# 2-SAT (2-Satisfiability) — Practice Tasks

> **One-line summary:** Fifteen graded problems (5 beginner, 5 intermediate, 5 advanced) plus a benchmark, each with a statement, constraints, hints, and full Go / Java / Python solutions. Every solution reuses the canonical implication-graph + Tarjan-SCC 2-SAT engine; the difficulty lives in the **modeling** — turning each problem's rules into 2-CNF clauses.

All solutions assume the literal encoding `xi=true → 2i`, `xi=false → 2i+1`, `neg(v) = v ^ 1`, and the assignment rule `xi = true ⟺ comp[2i] < comp[2i+1]` (Tarjan reverse-topological numbering).

---

## Table of Contents

- [Reusable Engine](#reusable-engine)
- [Beginner Tasks](#beginner-tasks)
  - [B1. Decide Satisfiability](#b1-decide-satisfiability)
  - [B2. Force a Variable](#b2-force-a-variable)
  - [B3. Implication Chain](#b3-implication-chain)
  - [B4. Mutual Exclusion](#b4-mutual-exclusion)
  - [B5. Recover an Assignment](#b5-recover-an-assignment)
- [Intermediate Tasks](#intermediate-tasks)
  - [I1. Two-Room Placement](#i1-two-room-placement)
  - [I2. Graph 2-Coloring via 2-SAT](#i2-graph-2-coloring-via-2-sat)
  - [I3. Interval Scheduling on Two Machines](#i3-interval-scheduling-on-two-machines)
  - [I4. Boolean Equality / Inequality System](#i4-boolean-equality--inequality-system)
  - [I5. Conflict Core for UNSAT](#i5-conflict-core-for-unsat)
- [Advanced Tasks](#advanced-tasks)
  - [A1. Label Placement (above/below)](#a1-label-placement-abovebelow)
  - [A2. At-Most-One via Prefix Encoding](#a2-at-most-one-via-prefix-encoding)
  - [A3. Forced-Literal Detection](#a3-forced-literal-detection)
  - [A4. Lexicographically Smallest Assignment](#a4-lexicographically-smallest-assignment)
  - [A5. Count Free Variables](#a5-count-free-variables)
- [Benchmark](#benchmark)

---

## Reusable Engine

Every task below builds on this 2-SAT engine. It is presented once; tasks reference `TwoSAT` and add clauses.

#### Go
```go
package twosat

type TwoSAT struct {
	N   int
	adj [][]int
}

func New(n int) *TwoSAT { return &TwoSAT{N: n, adj: make([][]int, 2*n)} }

func node(v int, val bool) int {
	if val {
		return 2 * v
	}
	return 2*v + 1
}
func neg(x int) int { return x ^ 1 }

// (a==va) OR (b==vb)
func (t *TwoSAT) Or(a int, va bool, b int, vb bool) {
	x, y := node(a, va), node(b, vb)
	t.adj[neg(x)] = append(t.adj[neg(x)], y)
	t.adj[neg(y)] = append(t.adj[neg(y)], x)
}

func (t *TwoSAT) Solve() ([]bool, []int, bool) {
	M := 2 * t.N
	index := make([]int, M)
	low := make([]int, M)
	on := make([]bool, M)
	comp := make([]int, M)
	for i := range index {
		index[i], comp[i] = -1, -1
	}
	var stk []int
	idx, cc := 0, 0
	for s := 0; s < M; s++ {
		if index[s] != -1 {
			continue
		}
		type fr struct{ v, p int }
		st := []fr{{s, 0}}
		for len(st) > 0 {
			f := &st[len(st)-1]
			v := f.v
			if f.p == 0 {
				index[v], low[v] = idx, idx
				idx++
				stk = append(stk, v)
				on[v] = true
			}
			if f.p < len(t.adj[v]) {
				w := t.adj[v][f.p]
				f.p++
				if index[w] == -1 {
					st = append(st, fr{w, 0})
				} else if on[w] && index[w] < low[v] {
					low[v] = index[w]
				}
				continue
			}
			if low[v] == index[v] {
				for {
					w := stk[len(stk)-1]
					stk = stk[:len(stk)-1]
					on[w] = false
					comp[w] = cc
					if w == v {
						break
					}
				}
				cc++
			}
			st = st[:len(st)-1]
			if len(st) > 0 {
				p := st[len(st)-1].v
				if low[v] < low[p] {
					low[p] = low[v]
				}
			}
		}
	}
	res := make([]bool, t.N)
	for i := 0; i < t.N; i++ {
		if comp[2*i] == comp[2*i+1] {
			return nil, comp, false
		}
		res[i] = comp[2*i] < comp[2*i+1]
	}
	return res, comp, true
}
```

#### Java
```java
import java.util.*;

public class TwoSAT {
    final int N;
    final List<List<Integer>> adj;
    int[] comp;

    TwoSAT(int n) {
        N = n;
        adj = new ArrayList<>();
        for (int i = 0; i < 2 * n; i++) adj.add(new ArrayList<>());
    }

    static int node(int v, boolean val) { return val ? 2 * v : 2 * v + 1; }
    static int neg(int x) { return x ^ 1; }

    void or(int a, boolean va, int b, boolean vb) {
        int x = node(a, va), y = node(b, vb);
        adj.get(neg(x)).add(y);
        adj.get(neg(y)).add(x);
    }

    boolean[] solve() {
        int M = 2 * N;
        int[] index = new int[M], low = new int[M];
        comp = new int[M];
        boolean[] on = new boolean[M];
        Arrays.fill(index, -1);
        Arrays.fill(comp, -1);
        int[] stk = new int[M];
        int sp = 0, idx = 0, cc = 0;
        for (int s = 0; s < M; s++) {
            if (index[s] != -1) continue;
            Deque<int[]> st = new ArrayDeque<>();
            st.push(new int[]{s, 0});
            while (!st.isEmpty()) {
                int[] f = st.peek();
                int v = f[0];
                if (f[1] == 0) { index[v] = low[v] = idx++; stk[sp++] = v; on[v] = true; }
                if (f[1] < adj.get(v).size()) {
                    int w = adj.get(v).get(f[1]++);
                    if (index[w] == -1) st.push(new int[]{w, 0});
                    else if (on[w]) low[v] = Math.min(low[v], index[w]);
                    continue;
                }
                if (low[v] == index[v]) {
                    while (true) { int w = stk[--sp]; on[w] = false; comp[w] = cc; if (w == v) break; }
                    cc++;
                }
                st.pop();
                if (!st.isEmpty()) low[st.peek()[0]] = Math.min(low[st.peek()[0]], low[v]);
            }
        }
        boolean[] res = new boolean[N];
        for (int i = 0; i < N; i++) {
            if (comp[2 * i] == comp[2 * i + 1]) return null;
            res[i] = comp[2 * i] < comp[2 * i + 1];
        }
        return res;
    }
}
```

#### Python
```python
class TwoSAT:
    def __init__(self, n):
        self.N = n
        self.adj = [[] for _ in range(2 * n)]
        self.comp = None

    @staticmethod
    def _node(v, val):
        return 2 * v if val else 2 * v + 1

    def Or(self, a, va, b, vb):
        x, y = self._node(a, va), self._node(b, vb)
        self.adj[x ^ 1].append(y)
        self.adj[y ^ 1].append(x)

    def solve(self):
        M = 2 * self.N
        index = [-1] * M
        low = [0] * M
        self.comp = [-1] * M
        on = [False] * M
        stk = []
        idx = cc = 0
        for s in range(M):
            if index[s] != -1:
                continue
            st = [(s, 0)]
            while st:
                v, p = st[-1]
                if p == 0:
                    index[v] = low[v] = idx
                    idx += 1
                    stk.append(v)
                    on[v] = True
                if p < len(self.adj[v]):
                    w = self.adj[v][p]
                    st[-1] = (v, p + 1)
                    if index[w] == -1:
                        st.append((w, 0))
                    elif on[w]:
                        low[v] = min(low[v], index[w])
                    continue
                if low[v] == index[v]:
                    while True:
                        w = stk.pop()
                        on[w] = False
                        self.comp[w] = cc
                        if w == v:
                            break
                    cc += 1
                st.pop()
                if st:
                    pp = st[-1][0]
                    low[pp] = min(low[pp], low[v])
        res = [False] * self.N
        for i in range(self.N):
            if self.comp[2 * i] == self.comp[2 * i + 1]:
                return None
            res[i] = self.comp[2 * i] < self.comp[2 * i + 1]
        return res
```

---

## Beginner Tasks

### B1. Decide Satisfiability

**Statement.** Given `n` boolean variables and `m` clauses (each `(a==va ∨ b==vb)`), output `SAT` or `UNSAT`.

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ m ≤ 5·10^5`.

**Hints.**
1. Build the implication graph, run SCC.
2. UNSAT iff some variable shares an SCC with its negation.
3. No assignment needed — just the verdict.

#### Go
```go
package main

import "fmt"

func main() {
	// (x0 ∨ x1) ∧ (¬x0 ∨ x1)
	ts := New(2)
	ts.Or(0, true, 1, true)
	ts.Or(0, false, 1, true)
	if _, _, ok := ts.Solve(); ok {
		fmt.Println("SAT")
	} else {
		fmt.Println("UNSAT")
	}
}
```

#### Java
```java
public class B1 {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(2);
        ts.or(0, true, 1, true);
        ts.or(0, false, 1, true);
        System.out.println(ts.solve() == null ? "UNSAT" : "SAT");
    }
}
```

#### Python
```python
ts = TwoSAT(2)
ts.Or(0, True, 1, True)
ts.Or(0, False, 1, True)
print("UNSAT" if ts.solve() is None else "SAT")
```

---

### B2. Force a Variable

**Statement.** Given a formula, additionally force `x_k = true`. Output SAT/UNSAT.

**Constraints.** Same as B1.

**Hints.**
1. Forcing `x_k = true` is the unit clause `(x_k ∨ x_k)`.
2. As an edge that is `¬x_k ⇒ x_k`.
3. Add it, then solve normally.

#### Go
```go
package main

import "fmt"

func main() {
	ts := New(2)
	ts.Or(0, true, 1, true) // (x0 ∨ x1)
	ts.Or(0, true, 0, true) // force x0 = true
	a, _, ok := ts.Solve()
	fmt.Println(ok, a)
}
```

#### Java
```java
public class B2 {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(2);
        ts.or(0, true, 1, true);
        ts.or(0, true, 0, true); // force x0
        boolean[] a = ts.solve();
        System.out.println(a == null ? "UNSAT" : java.util.Arrays.toString(a));
    }
}
```

#### Python
```python
ts = TwoSAT(2)
ts.Or(0, True, 1, True)
ts.Or(0, True, 0, True)  # force x0 = true
print(ts.solve())
```

---

### B3. Implication Chain

**Statement.** Given implications `a_i ⇒ b_i` ("if `a_i` then `b_i`"), decide if they can all hold together with optional forced literals.

**Constraints.** `1 ≤ n ≤ 10^5`, implications up to `5·10^5`.

**Hints.**
1. `A ⇒ B` is the clause `(¬A ∨ B)`.
2. In `Or` terms: `Or(A, false, B, true)`.
3. Chains are just many such clauses.

#### Go
```go
package main

import "fmt"

func main() {
	ts := New(3)
	ts.Or(0, false, 1, true) // x0 ⇒ x1
	ts.Or(1, false, 2, true) // x1 ⇒ x2
	ts.Or(0, true, 0, true)  // force x0 true → forces x1, x2 true
	a, _, ok := ts.Solve()
	fmt.Println(ok, a) // true [true true true]
}
```

#### Java
```java
public class B3 {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(3);
        ts.or(0, false, 1, true);
        ts.or(1, false, 2, true);
        ts.or(0, true, 0, true);
        System.out.println(java.util.Arrays.toString(ts.solve()));
    }
}
```

#### Python
```python
ts = TwoSAT(3)
ts.Or(0, False, 1, True)  # x0 ⇒ x1
ts.Or(1, False, 2, True)  # x1 ⇒ x2
ts.Or(0, True, 0, True)   # force x0
print(ts.solve())  # [True, True, True]
```

---

### B4. Mutual Exclusion

**Statement.** Given pairs that "cannot both be true," decide satisfiability with the constraint that at least one global variable must be true.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hints.**
1. "u, v not both true" → `(¬xu ∨ ¬xv)` → `Or(u, false, v, false)`.
2. "force at least one of all" can be a chain of OR clauses or a single forced variable for a simplified version.

#### Go
```go
package main

import "fmt"

func main() {
	ts := New(3)
	ts.Or(0, false, 1, false) // not both 0,1
	ts.Or(1, false, 2, false) // not both 1,2
	ts.Or(0, true, 2, true)   // at least one of 0,2
	a, _, ok := ts.Solve()
	fmt.Println(ok, a)
}
```

#### Java
```java
public class B4 {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(3);
        ts.or(0, false, 1, false);
        ts.or(1, false, 2, false);
        ts.or(0, true, 2, true);
        System.out.println(java.util.Arrays.toString(ts.solve()));
    }
}
```

#### Python
```python
ts = TwoSAT(3)
ts.Or(0, False, 1, False)
ts.Or(1, False, 2, False)
ts.Or(0, True, 2, True)
print(ts.solve())
```

---

### B5. Recover an Assignment

**Statement.** If SAT, print a satisfying assignment as a 0/1 string; else `UNSAT`. Then verify it.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hints.**
1. `solve` already returns the assignment via `comp[2i] < comp[2i+1]`.
2. Verify by re-evaluating every clause.
3. Verification is a cheap `O(m)` safety net.

#### Go
```go
package main

import "fmt"

func main() {
	ts := New(2)
	ts.Or(0, true, 1, true)
	ts.Or(0, false, 1, true)
	ts.Or(0, false, 1, false)
	a, _, ok := ts.Solve()
	if !ok {
		fmt.Println("UNSAT")
		return
	}
	for _, b := range a {
		if b {
			fmt.Print("1")
		} else {
			fmt.Print("0")
		}
	}
	fmt.Println()
}
```

#### Java
```java
public class B5 {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(2);
        ts.or(0, true, 1, true);
        ts.or(0, false, 1, true);
        ts.or(0, false, 1, false);
        boolean[] a = ts.solve();
        if (a == null) { System.out.println("UNSAT"); return; }
        StringBuilder sb = new StringBuilder();
        for (boolean b : a) sb.append(b ? '1' : '0');
        System.out.println(sb);
    }
}
```

#### Python
```python
ts = TwoSAT(2)
ts.Or(0, True, 1, True)
ts.Or(0, False, 1, True)
ts.Or(0, False, 1, False)
a = ts.solve()
print("UNSAT" if a is None else "".join("1" if b else "0" for b in a))
```

---

## Intermediate Tasks

### I1. Two-Room Placement

**Statement.** `n` guests each go to room A (`true`) or B (`false`). Given constraints "u and v cannot share room A" and "u and v must be in different rooms," produce a valid placement or report infeasible.

**Constraints.** `1 ≤ n ≤ 10^5`, constraints up to `5·10^5`.

**Hints.**
1. "not both A" → `Or(u, false, v, false)`.
2. "must differ" → `Or(u, true, v, true)` and `Or(u, false, v, false)`.
3. This generalizes graph 2-coloring.

#### Go
```go
package main

import "fmt"

func main() {
	ts := New(4)
	ts.Or(0, false, 1, false) // 0,1 not both A
	// 2,3 must differ:
	ts.Or(2, true, 3, true)
	ts.Or(2, false, 3, false)
	a, _, ok := ts.Solve()
	fmt.Println(ok, a)
}
```

#### Java
```java
public class I1 {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(4);
        ts.or(0, false, 1, false);
        ts.or(2, true, 3, true);
        ts.or(2, false, 3, false);
        System.out.println(java.util.Arrays.toString(ts.solve()));
    }
}
```

#### Python
```python
def two_room(n, not_both_a, differ):
    ts = TwoSAT(n)
    for u, v in not_both_a:
        ts.Or(u, False, v, False)
    for u, v in differ:
        ts.Or(u, True, v, True)
        ts.Or(u, False, v, False)
    return ts.solve()


print(two_room(4, [(0, 1)], [(2, 3)]))
```

---

### I2. Graph 2-Coloring via 2-SAT

**Statement.** Given an undirected graph, color each vertex with one of two colors such that adjacent vertices differ. Output a coloring or `IMPOSSIBLE`.

**Constraints.** `1 ≤ V ≤ 10^5`, `0 ≤ E ≤ 5·10^5`.

**Hints.**
1. One boolean per vertex (color 0 / 1).
2. Each edge `(u, v)` → "must differ" = `(xu ∨ xv) ∧ (¬xu ∨ ¬xv)`.
3. SAT iff the graph is bipartite. (2-SAT gives the same answer a BFS-bipartite check would, with explicit colors.)

#### Go
```go
package main

import "fmt"

func twoColor(v int, edges [][2]int) ([]bool, bool) {
	ts := New(v)
	for _, e := range edges {
		ts.Or(e[0], true, e[1], true)
		ts.Or(e[0], false, e[1], false)
	}
	a, _, ok := ts.Solve()
	return a, ok
}

func main() {
	a, ok := twoColor(4, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}})
	fmt.Println(ok, a) // bipartite cycle → SAT
	b, ok2 := twoColor(3, [][2]int{{0, 1}, {1, 2}, {2, 0}})
	fmt.Println(ok2, b) // odd cycle → UNSAT
}
```

#### Java
```java
public class I2 {
    static boolean[] twoColor(int v, int[][] edges) {
        TwoSAT ts = new TwoSAT(v);
        for (int[] e : edges) {
            ts.or(e[0], true, e[1], true);
            ts.or(e[0], false, e[1], false);
        }
        return ts.solve();
    }
    public static void main(String[] args) {
        System.out.println(java.util.Arrays.toString(twoColor(4, new int[][]{{0,1},{1,2},{2,3},{3,0}})));
        System.out.println(twoColor(3, new int[][]{{0,1},{1,2},{2,0}}) == null ? "IMPOSSIBLE" : "ok");
    }
}
```

#### Python
```python
def two_color(v, edges):
    ts = TwoSAT(v)
    for u, w in edges:
        ts.Or(u, True, w, True)
        ts.Or(u, False, w, False)
    return ts.solve()


print(two_color(4, [(0, 1), (1, 2), (2, 3), (3, 0)]))  # bipartite → coloring
print(two_color(3, [(0, 1), (1, 2), (2, 0)]))          # odd cycle → None
```

---

### I3. Interval Scheduling on Two Machines

**Statement.** Each job runs on machine A (`true`) or B (`false`). Some pairs of jobs overlap in time and cannot run on the same machine. Decide feasibility and assign machines.

**Constraints.** `1 ≤ n ≤ 10^5`, overlapping pairs up to `5·10^5`.

**Hints.**
1. Overlapping pair `(i, j)` cannot share a machine → they must differ → `(xi ∨ xj) ∧ (¬xi ∨ ¬xj)`.
2. This is again the "must differ" 2-coloring on the conflict graph.
3. Feasible iff the conflict (overlap) graph is bipartite.

#### Go
```go
package main

import "fmt"

func schedule(n int, conflicts [][2]int) ([]bool, bool) {
	ts := New(n)
	for _, c := range conflicts {
		ts.Or(c[0], true, c[1], true)
		ts.Or(c[0], false, c[1], false)
	}
	a, _, ok := ts.Solve()
	return a, ok
}

func main() {
	a, ok := schedule(3, [][2]int{{0, 1}, {1, 2}})
	fmt.Println(ok, a) // path → SAT
}
```

#### Java
```java
public class I3 {
    static boolean[] schedule(int n, int[][] conflicts) {
        TwoSAT ts = new TwoSAT(n);
        for (int[] c : conflicts) {
            ts.or(c[0], true, c[1], true);
            ts.or(c[0], false, c[1], false);
        }
        return ts.solve();
    }
    public static void main(String[] args) {
        System.out.println(java.util.Arrays.toString(schedule(3, new int[][]{{0,1},{1,2}})));
    }
}
```

#### Python
```python
def schedule(n, conflicts):
    ts = TwoSAT(n)
    for i, j in conflicts:
        ts.Or(i, True, j, True)
        ts.Or(i, False, j, False)
    return ts.solve()


print(schedule(3, [(0, 1), (1, 2)]))
```

---

### I4. Boolean Equality / Inequality System

**Statement.** Given constraints of the form `xi == xj` or `xi != xj`, decide if a consistent assignment exists.

**Constraints.** `1 ≤ n ≤ 10^5`, constraints up to `5·10^5`.

**Hints.**
1. `xi == xj` ⇔ `(xi ⇒ xj) ∧ (xj ⇒ xi)` = `(¬xi ∨ xj) ∧ (¬xj ∨ xi)`.
2. `xi != xj` ⇔ `(xi ∨ xj) ∧ (¬xi ∨ ¬xj)`.
3. (Union-Find also solves equality systems; 2-SAT handles mixed eq/neq uniformly and yields concrete values.)

#### Go
```go
package main

import "fmt"

func main() {
	ts := New(3)
	// x0 == x1
	ts.Or(0, false, 1, true)
	ts.Or(1, false, 0, true)
	// x1 != x2
	ts.Or(1, true, 2, true)
	ts.Or(1, false, 2, false)
	a, _, ok := ts.Solve()
	fmt.Println(ok, a)
}
```

#### Java
```java
public class I4 {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(3);
        ts.or(0, false, 1, true);  // x0==x1
        ts.or(1, false, 0, true);
        ts.or(1, true, 2, true);   // x1!=x2
        ts.or(1, false, 2, false);
        System.out.println(java.util.Arrays.toString(ts.solve()));
    }
}
```

#### Python
```python
ts = TwoSAT(3)
# x0 == x1
ts.Or(0, False, 1, True)
ts.Or(1, False, 0, True)
# x1 != x2
ts.Or(1, True, 2, True)
ts.Or(1, False, 2, False)
print(ts.solve())
```

---

### I5. Conflict Core for UNSAT

**Statement.** When a formula is UNSAT, find one variable `xi` that shares an SCC with `¬xi` (the witness of unsatisfiability).

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hints.**
1. Run the SCC pass and inspect `comp[]`.
2. The first `i` with `comp[2i] == comp[2i+1]` is a witness.
3. To get the full conflicting clause set you would trace a cycle through `2i` and `2i+1`; reporting the variable is the minimal witness.

#### Go
```go
package main

import "fmt"

func main() {
	ts := New(2)
	ts.Or(0, true, 0, true)   // force x0 true
	ts.Or(0, false, 0, false) // force x0 false → conflict
	_, comp, ok := ts.Solve()
	if ok {
		fmt.Println("SAT")
		return
	}
	for i := 0; i < ts.N; i++ {
		if comp[2*i] == comp[2*i+1] {
			fmt.Printf("conflict at variable x%d\n", i)
			break
		}
	}
}
```

#### Java
```java
public class I5 {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(2);
        ts.or(0, true, 0, true);
        ts.or(0, false, 0, false);
        if (ts.solve() != null) { System.out.println("SAT"); return; }
        for (int i = 0; i < ts.N; i++)
            if (ts.comp[2 * i] == ts.comp[2 * i + 1]) {
                System.out.println("conflict at variable x" + i);
                break;
            }
    }
}
```

#### Python
```python
ts = TwoSAT(2)
ts.Or(0, True, 0, True)
ts.Or(0, False, 0, False)
if ts.solve() is not None:
    print("SAT")
else:
    for i in range(ts.N):
        if ts.comp[2 * i] == ts.comp[2 * i + 1]:
            print(f"conflict at variable x{i}")
            break
```

---

## Advanced Tasks

### A1. Label Placement (above/below)

**Statement.** `n` points on a line each get a label placed **above** (`true`) or **below** (`false`). Some pairs of labels would overlap if placed on the same side; such pairs must be on opposite sides. Some labels are fixed to a side. Decide a valid placement.

**Constraints.** `1 ≤ n ≤ 10^5`, overlap pairs up to `5·10^5`.

**Hints.**
1. "pair must differ" → `(xi ∨ xj) ∧ (¬xi ∨ ¬xj)`.
2. Fixed-above → force `(xi ∨ xi)`; fixed-below → `(¬xi ∨ ¬xi)`.
3. Classic cartographic 2-SAT application.

#### Go
```go
package main

import "fmt"

func main() {
	ts := New(4)
	// labels 0,1 overlap above → must differ
	ts.Or(0, true, 1, true)
	ts.Or(0, false, 1, false)
	// label 2 fixed above
	ts.Or(2, true, 2, true)
	// labels 2,3 must differ → forces 3 below
	ts.Or(2, true, 3, true)
	ts.Or(2, false, 3, false)
	a, _, ok := ts.Solve()
	fmt.Println(ok, a)
}
```

#### Java
```java
public class A1 {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(4);
        ts.or(0, true, 1, true);
        ts.or(0, false, 1, false);
        ts.or(2, true, 2, true);   // fix 2 above
        ts.or(2, true, 3, true);
        ts.or(2, false, 3, false);
        System.out.println(java.util.Arrays.toString(ts.solve()));
    }
}
```

#### Python
```python
ts = TwoSAT(4)
ts.Or(0, True, 1, True)     # 0,1 differ
ts.Or(0, False, 1, False)
ts.Or(2, True, 2, True)     # fix 2 above
ts.Or(2, True, 3, True)     # 2,3 differ
ts.Or(2, False, 3, False)
print(ts.solve())
```

---

### A2. At-Most-One via Prefix Encoding

**Statement.** Given a group of `k` variables, enforce "at most one is true" using only `O(k)` clauses (not `O(k^2)`), introducing auxiliary variables. Then solve.

**Constraints.** `1 ≤ k ≤ 10^5`.

**Hints.**
1. Add prefix variables `p_0..p_{k-1}` (`pi` = "some `xj`, `j ≤ i`, is true").
2. Clauses: `xi ⇒ pi`, `p(i-1) ⇒ pi`, `xi ⇒ ¬p(i-1)`.
3. Original vars `0..k-1`, prefix vars `k..2k-1`.

#### Go
```go
package main

import "fmt"

func atMostOne(k int, force []int) ([]bool, bool) {
	ts := New(2 * k) // 0..k-1 originals, k..2k-1 prefix
	p := func(i int) int { return k + i }
	for i := 0; i < k; i++ {
		ts.Or(i, false, p(i), true) // xi ⇒ pi
		if i > 0 {
			ts.Or(p(i-1), false, p(i), true) // p(i-1) ⇒ pi
			ts.Or(i, false, p(i-1), false)   // xi ⇒ ¬p(i-1)
		}
	}
	for _, f := range force {
		ts.Or(f, true, f, true) // force xf = true
	}
	a, _, ok := ts.Solve()
	if !ok {
		return nil, false
	}
	return a[:k], true
}

func main() {
	a, ok := atMostOne(4, []int{1}) // force x1 true; others must be false
	fmt.Println(ok, a)
	_, ok2 := atMostOne(4, []int{1, 2}) // two forced true → violates at-most-one
	fmt.Println(ok2)
}
```

#### Java
```java
public class A2 {
    static boolean[] atMostOne(int k, int[] force) {
        TwoSAT ts = new TwoSAT(2 * k);
        for (int i = 0; i < k; i++) {
            ts.or(i, false, k + i, true);
            if (i > 0) {
                ts.or(k + i - 1, false, k + i, true);
                ts.or(i, false, k + i - 1, false);
            }
        }
        for (int f : force) ts.or(f, true, f, true);
        boolean[] a = ts.solve();
        if (a == null) return null;
        return java.util.Arrays.copyOf(a, k);
    }
    public static void main(String[] args) {
        System.out.println(java.util.Arrays.toString(atMostOne(4, new int[]{1})));
        System.out.println(atMostOne(4, new int[]{1, 2}) == null ? "UNSAT" : "SAT");
    }
}
```

#### Python
```python
def at_most_one(k, force):
    ts = TwoSAT(2 * k)
    p = lambda i: k + i
    for i in range(k):
        ts.Or(i, False, p(i), True)            # xi ⇒ pi
        if i > 0:
            ts.Or(p(i - 1), False, p(i), True)  # p(i-1) ⇒ pi
            ts.Or(i, False, p(i - 1), False)    # xi ⇒ ¬p(i-1)
    for f in force:
        ts.Or(f, True, f, True)
    a = ts.solve()
    return a[:k] if a is not None else None


print(at_most_one(4, [1]))     # only x1 true
print(at_most_one(4, [1, 2]))  # None (violates at-most-one)
```

---

### A3. Forced-Literal Detection

**Statement.** Given a satisfiable formula, determine for each variable whether it is **forced** (takes the same value in *every* satisfying assignment) and report which value.

**Constraints.** `1 ≤ n ≤ 5·10^4`, `m ≤ 2·10^5`.

**Hints.**
1. `xi` is forced-true iff forcing `xi = false` makes the formula UNSAT.
2. For each variable, copy the clause set, add the forcing clause, re-solve.
3. `O(n)` solves of `O(n+m)` each — fine for moderate `n`. (A single-pass SCC method exists but is trickier.)

#### Go
```go
package main

import "fmt"

func forced(n int, clauses [][4]int) []int {
	// returns -1 (free), 0 (forced false), 1 (forced true)
	res := make([]int, n)
	build := func(extra [4]int) bool {
		ts := New(n)
		for _, c := range clauses {
			ts.Or(c[0], c[1] == 1, c[2], c[3] == 1)
		}
		ts.Or(extra[0], extra[1] == 1, extra[2], extra[3] == 1)
		_, _, ok := ts.Solve()
		return ok
	}
	for i := 0; i < n; i++ {
		canFalse := build([4]int{i, 0, i, 0})
		canTrue := build([4]int{i, 1, i, 1})
		switch {
		case canTrue && !canFalse:
			res[i] = 1
		case canFalse && !canTrue:
			res[i] = 0
		default:
			res[i] = -1
		}
	}
	return res
}

func main() {
	// (x0) ∧ (x0 ∨ x1): x0 forced true, x1 free
	cls := [][4]int{{0, 1, 0, 1}, {0, 1, 1, 1}}
	fmt.Println(forced(2, cls)) // [1 -1]
}
```

#### Java
```java
public class A3 {
    static int[] forced(int n, int[][] clauses) {
        int[] res = new int[n];
        for (int i = 0; i < n; i++) {
            boolean canFalse = build(n, clauses, new int[]{i, 0, i, 0});
            boolean canTrue = build(n, clauses, new int[]{i, 1, i, 1});
            res[i] = (canTrue && !canFalse) ? 1 : (canFalse && !canTrue) ? 0 : -1;
        }
        return res;
    }
    static boolean build(int n, int[][] clauses, int[] extra) {
        TwoSAT ts = new TwoSAT(n);
        for (int[] c : clauses) ts.or(c[0], c[1] == 1, c[2], c[3] == 1);
        ts.or(extra[0], extra[1] == 1, extra[2], extra[3] == 1);
        return ts.solve() != null;
    }
    public static void main(String[] args) {
        int[][] cls = {{0,1,0,1},{0,1,1,1}};
        System.out.println(java.util.Arrays.toString(forced(2, cls))); // [1, -1]
    }
}
```

#### Python
```python
def forced(n, clauses):
    def build(extra):
        ts = TwoSAT(n)
        for a, va, b, vb in clauses:
            ts.Or(a, va, b, vb)
        ts.Or(*extra)
        return ts.solve() is not None

    res = []
    for i in range(n):
        can_false = build((i, False, i, False))
        can_true = build((i, True, i, True))
        if can_true and not can_false:
            res.append(1)
        elif can_false and not can_true:
            res.append(0)
        else:
            res.append(-1)
    return res


cls = [(0, True, 0, True), (0, True, 1, True)]  # (x0) ∧ (x0∨x1)
print(forced(2, cls))  # [1, -1]
```

---

### A4. Lexicographically Smallest Assignment

**Statement.** Among all satisfying assignments, find the lexicographically smallest one (prefer `x0=false`, then `x1=false`, ...), where `false < true`.

**Constraints.** `1 ≤ n ≤ 2·10^3` (greedy re-solve approach), `m ≤ 10^4`.

**Hints.**
1. Greedily fix `x0=false` if the rest is still SAT, else `x0=true`; fix it, move on.
2. Each step adds a forcing clause and re-solves.
3. `O(n)` solves — keep `n` modest for this naive version.

#### Go
```go
package main

import "fmt"

func lexSmallest(n int, clauses [][4]int) ([]bool, bool) {
	type lit struct {
		v   int
		val bool
	}
	var fixed []lit
	feasibleWith(n, clauses, fixed) // ensure base SAT
	if !feasibleWith(n, clauses, fixed) {
		return nil, false
	}
	res := make([]bool, n)
	for i := 0; i < n; i++ {
		try := append(fixed, lit{i, false})
		if feasibleWith(n, clauses, try) {
			fixed = try
			res[i] = false
		} else {
			fixed = append(fixed, lit{i, true})
			res[i] = true
		}
	}
	return res, true
}

func feasibleWith(n int, clauses [][4]int, fixed []struct {
	v   int
	val bool
}) bool {
	ts := New(n)
	for _, c := range clauses {
		ts.Or(c[0], c[1] == 1, c[2], c[3] == 1)
	}
	for _, f := range fixed {
		ts.Or(f.v, f.val, f.v, f.val)
	}
	_, _, ok := ts.Solve()
	return ok
}

func main() {
	cls := [][4]int{{0, 1, 1, 1}} // (x0 ∨ x1)
	a, ok := lexSmallest(2, cls)
	fmt.Println(ok, a) // smallest: x0=false, x1=true → [false true]
}
```

#### Java
```java
import java.util.*;
public class A4 {
    static boolean feasibleWith(int n, int[][] clauses, List<int[]> fixed) {
        TwoSAT ts = new TwoSAT(n);
        for (int[] c : clauses) ts.or(c[0], c[1] == 1, c[2], c[3] == 1);
        for (int[] f : fixed) ts.or(f[0], f[1] == 1, f[0], f[1] == 1);
        return ts.solve() != null;
    }
    static boolean[] lexSmallest(int n, int[][] clauses) {
        List<int[]> fixed = new ArrayList<>();
        if (!feasibleWith(n, clauses, fixed)) return null;
        boolean[] res = new boolean[n];
        for (int i = 0; i < n; i++) {
            fixed.add(new int[]{i, 0});
            if (feasibleWith(n, clauses, fixed)) { res[i] = false; }
            else { fixed.remove(fixed.size() - 1); fixed.add(new int[]{i, 1}); res[i] = true; }
        }
        return res;
    }
    public static void main(String[] args) {
        System.out.println(Arrays.toString(lexSmallest(2, new int[][]{{0,1,1,1}}))); // [false, true]
    }
}
```

#### Python
```python
def lex_smallest(n, clauses):
    def feasible_with(fixed):
        ts = TwoSAT(n)
        for a, va, b, vb in clauses:
            ts.Or(a, va, b, vb)
        for v, val in fixed:
            ts.Or(v, val, v, val)
        return ts.solve() is not None

    if not feasible_with([]):
        return None
    fixed, res = [], [False] * n
    for i in range(n):
        if feasible_with(fixed + [(i, False)]):
            fixed.append((i, False)); res[i] = False
        else:
            fixed.append((i, True)); res[i] = True
    return res


print(lex_smallest(2, [(0, True, 1, True)]))  # [False, True]
```

---

### A5. Count Free Variables

**Statement.** A variable is **free** if both `xi=true` and `xi=false` extend to some satisfying assignment. Count how many variables are free.

**Constraints.** `1 ≤ n ≤ 5·10^3`, `m ≤ 2·10^4`.

**Hints.**
1. Reuse the forced-detection logic: a variable is free iff both forcings stay SAT.
2. Count variables that are *not* forced.
3. This is the complement of A3's forced count.

#### Go
```go
package main

import "fmt"

func countFree(n int, clauses [][4]int) int {
	f := forced(n, clauses) // from A3
	cnt := 0
	for _, x := range f {
		if x == -1 {
			cnt++
		}
	}
	return cnt
}

func main() {
	cls := [][4]int{{0, 1, 0, 1}, {0, 1, 1, 1}} // x0 forced, x1 free
	fmt.Println(countFree(2, cls))              // 1
}
```

#### Java
```java
public class A5 {
    public static void main(String[] args) {
        int[][] cls = {{0,1,0,1},{0,1,1,1}};
        int[] f = A3.forced(2, cls);
        int cnt = 0;
        for (int x : f) if (x == -1) cnt++;
        System.out.println(cnt); // 1
    }
}
```

#### Python
```python
def count_free(n, clauses):
    return sum(1 for x in forced(n, clauses) if x == -1)  # forced() from A3


cls = [(0, True, 0, True), (0, True, 1, True)]
print(count_free(2, cls))  # 1
```

---

## Benchmark

**Goal.** Confirm the solver is linear: solving time should grow roughly proportionally to `n + m`. Generate random satisfiable formulas at density `ρ = m/n ≈ 0.8` (below the threshold, so usually SAT) and time the solve.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func bench(n int) {
	m := int(0.8 * float64(n))
	ts := New(n)
	for i := 0; i < m; i++ {
		a, b := rand.Intn(n), rand.Intn(n)
		ts.Or(a, rand.Intn(2) == 0, b, rand.Intn(2) == 0)
	}
	start := time.Now()
	_, _, ok := ts.Solve()
	fmt.Printf("n=%d m=%d sat=%v time=%v\n", n, m, ok, time.Since(start))
}

func main() {
	for _, n := range []int{10000, 100000, 1000000} {
		bench(n)
	}
}
```

#### Java
```java
import java.util.*;
public class Bench {
    static void bench(int n) {
        int m = (int) (0.8 * n);
        Random r = new Random(1);
        TwoSAT ts = new TwoSAT(n);
        for (int i = 0; i < m; i++)
            ts.or(r.nextInt(n), r.nextBoolean(), r.nextInt(n), r.nextBoolean());
        long t0 = System.nanoTime();
        boolean ok = ts.solve() != null;
        System.out.printf("n=%d m=%d sat=%b time=%.2fms%n", n, m, ok, (System.nanoTime() - t0) / 1e6);
    }
    public static void main(String[] args) {
        for (int n : new int[]{10000, 100000, 1000000}) bench(n);
    }
}
```

#### Python
```python
import random, time


def bench(n):
    m = int(0.8 * n)
    ts = TwoSAT(n)
    for _ in range(m):
        a, b = random.randrange(n), random.randrange(n)
        ts.Or(a, random.random() < 0.5, b, random.random() < 0.5)
    t0 = time.perf_counter()
    ok = ts.solve() is not None
    print(f"n={n} m={m} sat={ok} time={(time.perf_counter() - t0) * 1000:.2f}ms")


for n in (10000, 100000, 1000000):
    bench(n)
```

**Expected.** Solve time scales linearly with `n + m`. Go and Java handle `n = 10^6` in tens to low hundreds of milliseconds; Python is ~10–50× slower but still linear. Doubling `n` should roughly double the time — the signature of an `O(n + m)` algorithm. If you observe super-linear growth, the bottleneck is graph construction (allocation/boxing), not the SCC pass — switch to CSR adjacency as described in `senior.md` and `professional.md`.
