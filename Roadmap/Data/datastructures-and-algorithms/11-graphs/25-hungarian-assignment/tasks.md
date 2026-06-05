# Hungarian Algorithm (Kuhn-Munkres) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages. The core solver is the `O(n³)` potentials/augmenting-path template; reuse it across tasks.

---

## Beginner Tasks (5)

### Task 1 — Implement the core O(n³) solver

**Problem.** Read an `n × n` cost matrix and print the minimum total assignment cost.

**Input / Output spec.**
- Input: `n`, then `n` lines of `n` integers (the cost matrix).
- Output: the minimum total cost (one integer).

**Constraints.**
- `1 <= n <= 400`, `0 <= cost[i][j] <= 10^6`.
- Time `O(n³)`, space `O(n²)`.

**Hint.** Use the 1-indexed potentials template with `u`, `v`, `p`, `way`, `minv`, `used`. Set `INF = MaxInt/2` to avoid overflow.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	cost := make([][]int, n)
	for i := range cost {
		cost[i] = make([]int, n)
		for j := range cost[i] {
			fmt.Fscan(in, &cost[i][j])
		}
	}
	u := make([]int, n+1)
	v := make([]int, n+1)
	p := make([]int, n+1)
	way := make([]int, n+1)
	for i := 1; i <= n; i++ {
		p[0] = i
		j0 := 0
		minv := make([]int, n+1)
		used := make([]bool, n+1)
		for j := range minv {
			minv[j] = INF
		}
		for {
			used[j0] = true
			i0, delta, j1 := p[j0], INF, -1
			for j := 1; j <= n; j++ {
				if used[j] {
					continue
				}
				cur := cost[i0-1][j-1] - u[i0] - v[j]
				if cur < minv[j] {
					minv[j], way[j] = cur, j0
				}
				if minv[j] < delta {
					delta, j1 = minv[j], j
				}
			}
			for j := 0; j <= n; j++ {
				if used[j] {
					u[p[j]] += delta
					v[j] -= delta
				} else {
					minv[j] -= delta
				}
			}
			j0 = j1
			if p[j0] == 0 {
				break
			}
		}
		for j0 != 0 {
			j1 := way[j0]
			p[j0] = p[j1]
			j0 = j1
		}
	}
	total := 0
	for j := 1; j <= n; j++ {
		total += cost[p[j]-1][j-1]
	}
	fmt.Println(total)
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task1 {
    static final int INF = Integer.MAX_VALUE / 2;
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[][] cost = new int[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++) cost[i][j] = sc.nextInt();
        int[] u = new int[n + 1], v = new int[n + 1], p = new int[n + 1], way = new int[n + 1];
        for (int i = 1; i <= n; i++) {
            p[0] = i; int j0 = 0;
            int[] minv = new int[n + 1]; boolean[] used = new boolean[n + 1];
            Arrays.fill(minv, INF);
            do {
                used[j0] = true; int i0 = p[j0], delta = INF, j1 = -1;
                for (int j = 1; j <= n; j++) {
                    if (used[j]) continue;
                    int cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                }
                for (int j = 0; j <= n; j++) {
                    if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
                    else minv[j] -= delta;
                }
                j0 = j1;
            } while (p[j0] != 0);
            do { int j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 != 0);
        }
        int total = 0;
        for (int j = 1; j <= n; j++) total += cost[p[j] - 1][j - 1];
        System.out.println(total);
    }
}
```

**Reference — Python.**
```python
import sys
INF = float("inf")

def main():
    data = sys.stdin.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    cost = [[int(data[idx + i * n + j]) for j in range(n)] for i in range(n)]
    u = [0] * (n + 1); v = [0] * (n + 1); p = [0] * (n + 1); way = [0] * (n + 1)
    for i in range(1, n + 1):
        p[0] = i; j0 = 0
        minv = [INF] * (n + 1); used = [False] * (n + 1)
        while True:
            used[j0] = True; i0, delta, j1 = p[j0], INF, -1
            for j in range(1, n + 1):
                if used[j]:
                    continue
                cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                if cur < minv[j]:
                    minv[j], way[j] = cur, j0
                if minv[j] < delta:
                    delta, j1 = minv[j], j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta; v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while j0 != 0:
            j1 = way[j0]; p[j0] = p[j1]; j0 = j1
    print(sum(cost[p[j] - 1][j - 1] for j in range(1, n + 1)))

main()
```

- **Constraints:** correct `O(n³)`; test with `n = 1`, all-equal matrices, and the `3×3` example (answer `23`).
- **Expected Output:** the minimum total cost.
- **Evaluation:** correctness, overflow safety, complexity.

---

### Task 2 — Recover and print the assignment

**Problem.** In addition to the cost, print which worker is assigned to each job (`job j -> worker w`).

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= n <= 400`. After solving, `assignment[j-1] = p[j]-1`.
- **Hint:** the `p[]` array already holds `p[j] = worker matched to job j`. Convert to 0-indexed for output.
- **Expected Output:** total cost, then `n` lines `job j -> worker w`.

---

### Task 3 — Brute-force oracle for validation

**Problem.** Implement an `O(n·n!)` brute-force assignment solver (try all permutations) and use it to validate your Hungarian solver on random `n ≤ 8` matrices.

- Provide starter code in all 3 languages (permutation enumeration + min over total costs).
- **Constraints:** `1 <= n <= 8`. Generate 1000 random matrices, assert both solvers agree.
- **Hint:** Go — recursive permutation; Java — `next_permutation`-style or recursion; Python — `itertools.permutations`.
- **Expected Output:** "OK" if all trials match, else the failing matrix.

---

### Task 4 — Maximization via transform

**Problem.** Given an `n × n` **profit** matrix, find the assignment maximizing total profit.

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= n <= 400`, `0 <= profit <= 10^6`.
- **Hint:** transform `cost[i][j] = BIG - profit[i][j]` with `BIG = max profit`, solve the min problem, return `n*BIG - minCost`.
- **Expected Output:** the maximum total profit.

---

### Task 5 — Pad a rectangular matrix to square

**Problem.** Read an `r × c` cost matrix (`r` may differ from `c`), pad it to `max(r,c) × max(r,c)` with `0`-cost dummies, and solve.

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= r, c <= 300`.
- **Hint:** real-to-dummy pairings cost `0` (an unassigned item). Report only the real assignments (ignore pairings to dummy rows/columns).
- **Expected Output:** total real cost, then the real worker→job pairs.

---

## Intermediate Tasks (5)

### Task 6 — Verify the optimality certificate

**Problem.** After solving, assert the three complementary-slackness conditions: (1) dual feasibility `cost[i][j] - u[i] - v[j] ≥ 0` for all `i,j`; (2) matched edges are tight; (3) `total == Σu + Σv`.

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= n <= 300`. The assertions must hold on every input.
- **Hint:** expose `u`, `v` from the solver. A failing assertion means a potential-update bug.
- **Expected Output:** "certificate OK" and the total cost.

---

### Task 7 — Forbidden assignments

**Problem.** Some `(worker, job)` pairs are forbidden (given as a list). Find the cheapest assignment that uses no forbidden pair, or report "infeasible."

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= n <= 300`. Set forbidden cells to `BIG = 10× max plausible total`.
- **Hint:** after solving, if any chosen cell equals `BIG`, the instance is infeasible (no perfect matching avoids forbidden cells).
- **Expected Output:** the min cost, or `infeasible`.

---

### Task 8 — Connected-component decomposition

**Problem.** Given a sparse cost matrix (most cells are "no edge"/infinite), split the bipartite graph into connected components using union-find, solve each independently, and combine.

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= n <= 2000`, but each component `≤ 200`.
- **Hint:** union worker `i` and job `j` whenever `(i,j)` has a finite cost; solve each component's padded square submatrix.
- **Expected Output:** the total cost; verify it matches a dense solve on small inputs.

---

### Task 9 — LeetCode 1947-style: maximum compatibility

**Problem.** `m` students and `m` mentors each answered `q` yes/no questions. Compatibility of a pair = number of matching answers. Assign students to mentors to **maximize** total compatibility. (Generalizes LeetCode "Maximum Compatibility Score Sum.")

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= m <= 8`, `1 <= q <= 8` (so brute force also works — use it to validate Hungarian).
- **Hint:** build the compatibility matrix, then maximize via the `BIG - score` transform.
- **Expected Output:** the maximum total compatibility.

---

### Task 10 — Tracker data association

**Problem.** Given `T` track positions and `D` detection positions in 2D, build a cost matrix of Euclidean distances, gate out pairs farther than `R`, solve the rectangular assignment, and output matches within the gate (unmatched tracks "coast").

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= T, D <= 300`, gate radius `R`.
- **Hint:** forbid out-of-gate pairs with a large cost; reject matched pairs above `R` in post-processing (output gate).
- **Expected Output:** the list of `track -> detection` matches and the list of unmatched tracks.

---

## Advanced Tasks (5)

### Task 11 — TSP lower bound via assignment relaxation

**Problem.** Given a distance matrix for `n` cities, compute the assignment-problem lower bound for the TSP (forbid the diagonal so no city maps to itself). This bound is `≤` the optimal tour length and is used in branch-and-bound.

- Provide starter code in all 3 languages.
- **Constraints:** `2 <= n <= 400`.
- **Hint:** set `cost[i][i] = BIG`, solve, return the total. Note it may form subtours (that is why it is only a *lower bound*).
- **Expected Output:** the assignment lower bound.

---

### Task 12 — Negative costs

**Problem.** Solve an assignment problem where costs may be negative. Verify the potentials version handles them directly, and also implement the "shift up by `-min`" approach for a non-negative-only solver; confirm both give the same assignment.

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= n <= 300`, `-10^6 <= cost <= 10^6`.
- **Hint:** the standard template needs no change; the shift approach adds `-min` to every cell, then subtracts `n·(-min)` from the result.
- **Expected Output:** the min cost (same from both methods).

---

### Task 13 — Bottleneck assignment

**Problem.** Instead of minimizing the *sum*, minimize the **maximum** single assignment cost. Solve by binary-searching a threshold `T` and testing for a perfect matching using only edges with `cost ≤ T` (unweighted bipartite matching).

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= n <= 400`. Binary search over distinct cost values.
- **Hint:** this is a *different objective* — the Hungarian sum-solver does not directly apply; use Kuhn's/Hopcroft-Karp feasibility test inside the search.
- **Expected Output:** the minimized maximum cost.

---

### Task 14 — k-best assignments

**Problem.** Find the `k` cheapest *distinct* assignments (not just the cheapest), using Murty's algorithm: repeatedly solve assignment subproblems with edges forced-in / forced-out to partition the solution space.

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= n <= 100`, `1 <= k <= 50`.
- **Hint:** maintain a priority queue of constrained subproblems; each pop yields the next-best assignment and spawns `n` children with forced constraints.
- **Expected Output:** the `k` total costs in non-decreasing order.

---

### Task 15 — Compare against min-cost max-flow

**Problem.** Model the assignment problem as a min-cost max-flow network (source→worker cap 1, worker→job cap 1 cost `c`, job→sink cap 1), solve it with an SSP/Dijkstra-potentials MCMF, and confirm it returns the same optimum as your Hungarian solver.

- Provide starter code in all 3 languages.
- **Constraints:** `1 <= n <= 200`.
- **Hint:** the flow value must be `n`; the min cost equals the Hungarian answer. Use Johnson-style potentials to allow Dijkstra despite zero-cost back edges.
- **Expected Output:** matching total costs from both methods, and a confirmation they agree.

---

## Benchmark Task

> Compare performance across all 3 languages on random dense assignment instances.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{50, 100, 200, 400}
	for _, n := range sizes {
		cost := make([][]int, n)
		for i := range cost {
			cost[i] = make([]int, n)
			for j := range cost[i] {
				cost[i][j] = rand.Intn(1000)
			}
		}
		start := time.Now()
		reps := 5
		for r := 0; r < reps; r++ {
			minCostAssignment(cost) // from interview.md Challenge 1
		}
		elapsed := time.Since(start)
		fmt.Printf("n=%4d: %.3f ms\n", n, float64(elapsed.Milliseconds())/float64(reps))
	}
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {50, 100, 200, 400};
        Random rng = new Random(1);
        for (int n : sizes) {
            int[][] cost = new int[n][n];
            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++) cost[i][j] = rng.nextInt(1000);
            int reps = 5;
            long start = System.nanoTime();
            for (int r = 0; r < reps; r++)
                MinCostAssignment.minCost(cost); // from interview.md Challenge 1
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%4d: %.3f ms%n", n, elapsed / reps / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import random, timeit
# min_cost_assignment from interview.md Challenge 1

for n in (50, 100, 200, 400):
    cost = [[random.randint(0, 999) for _ in range(n)] for _ in range(n)]
    t = timeit.timeit(lambda: min_cost_assignment(cost), number=5)
    print(f"n={n:>4}: {t / 5 * 1000:.3f} ms")
```

> Expect roughly cubic growth: doubling `n` multiplies time by ~8. Pure Python is ~50–100× slower than Go/Java; for production-scale `n`, use `scipy.optimize.linear_sum_assignment`.
