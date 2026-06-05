# Topological Sort — Interview Preparation

Topological sort is one of the highest-yield graph topics in interviews: it shows up directly (Course Schedule, Alien Dictionary, Parallel Courses, Minimum Height Trees) and indirectly as the engine of DAG dynamic programming. It is small enough to code on a whiteboard, has two interchangeable algorithms (Kahn's and DFS), and carries a few signature "gotchas" — edge direction, non-uniqueness, cycle detection, and disconnected components — that separate a candidate who memorized the API from one who understands the structure. This file is a curated question bank by seniority, behavioral/system-design prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Answer |
|------|--------|
| Definition | Linear order of a DAG's vertices where every edge `u → v` has `u` before `v`. |
| Exists iff | The graph is a **DAG** (no directed cycle). |
| Algorithm 1 | **Kahn's** — BFS on in-degree; emit in-degree-0 vertices, decrement successors. |
| Algorithm 2 | **DFS** — reverse of finish order (reverse post-order). |
| Complexity | `O(V + E)` time, `O(V)` space, both algorithms. |
| Cycle test (Kahn) | Emitted fewer than `V` vertices ⟹ cycle. |
| Cycle test (DFS) | Found a **back edge** (edge to a gray / on-stack vertex) ⟹ cycle. |
| Unique order? | Usually **no** — many valid orders. |
| Lexicographically smallest | Kahn's with a **min-heap** frontier — `O(V log V + E)`. |
| Counting all orders | **#P-complete** in general. |
| Edge meaning | `u → v` = "`u` must come before `v`". |

Kahn's skeleton:

```text
indeg[] -> queue all in-degree-0 vertices
while queue: u = pop(); emit u; for u->w: if --indeg[w]==0: push(w)
emitted == V ? valid order : cycle
```

DFS skeleton:

```text
for each unvisited v: dfs(v)
dfs(u): for u->w: dfs(w) if white / report cycle if gray ; then append u
answer = appended-list reversed
```

---

## Junior Questions (12 Q&A)

### J1. What is a topological sort?
It is a linear ordering of the vertices of a directed acyclic graph such that for every directed edge `u → v`, `u` appears before `v` in the ordering. Intuitively it is a valid order to perform tasks so that every prerequisite is completed before the task that needs it. It only exists for DAGs.

### J2. When does a topological order exist?
Exactly when the graph is acyclic. If there is a directed cycle `a → b → … → a`, you would need each vertex before itself, which is impossible. So "has a topological order" and "is a DAG" are equivalent statements.

### J3. What are the two standard algorithms?
Kahn's algorithm (BFS-based: repeatedly remove a vertex with in-degree 0) and the DFS-based method (run DFS and take the reverse of the order in which vertices finish). Both run in `O(V + E)`.

### J4. What is in-degree and why does Kahn's algorithm use it?
The in-degree of a vertex is the number of edges pointing into it — the count of unfinished prerequisites. A vertex with in-degree 0 has no remaining prerequisites and is "ready" to be emitted. Kahn's algorithm repeatedly emits ready vertices and decrements the in-degree of their successors.

### J5. How does Kahn's algorithm detect a cycle?
If the graph has a cycle, the vertices on that cycle never reach in-degree 0 (each always has an unprocessed predecessor on the cycle), so they are never emitted. After the loop, if you emitted fewer than `V` vertices, a cycle exists.

### J6. How does the DFS method detect a cycle?
With a three-color scheme: white (unvisited), gray (on the current recursion stack), black (finished). If DFS ever encounters an edge to a gray vertex, that is a back edge and proves a cycle.

### J7. Why is the reverse of the DFS finish order a topological order?
Because for any edge `u → v` in a DAG, `v` finishes before `u` (DFS either recurses into `v` and finishes it before returning to finish `u`, or `v` was already finished). Listing by decreasing finish time therefore puts `u` before `v` for every edge.

### J8. Is a topological order unique?
Usually not. Whenever two vertices have no path between them, either can come first. A chain graph has a unique order; an edgeless graph of `n` vertices has `n!` orders. Tests should check the ordering property, not a single hard-coded answer.

### J9. What is the time and space complexity?
`O(V + E)` time and `O(V)` auxiliary space for both algorithms (plus `O(E)` to store the graph). You touch each vertex and each edge a constant number of times.

### J10. How do you handle a disconnected graph?
Start from every source (Kahn) or loop over every vertex and start a DFS from each unvisited one. If you only start from a single vertex, you will miss entire components.

### J11. Which way does the dependency edge point?
If "task A depends on B", then B must come first, so the edge is `B → A` and A's in-degree increases. Reversing this is the single most common bug and yields the reverse order.

### J12 (analysis). What real systems use topological sort?
Build systems (`make`, `bazel`), package/dependency managers, task schedulers (Airflow, CI pipelines), course-prerequisite planning, spreadsheet recalculation, instruction scheduling in compilers, and symbol resolution in linkers — anything with "do these in a valid order" constraints.

---

## Middle Questions (12 Q&A)

### M1. Walk through Kahn's algorithm step by step.
Compute in-degrees for all vertices. Enqueue every vertex with in-degree 0. While the queue is non-empty, dequeue `u`, append it to the output, and for each edge `u → w` decrement `indeg[w]`; if it hits 0, enqueue `w`. At the end, if the output has all `V` vertices, it is a valid order; otherwise the graph has a cycle.

### M2. How do you get the lexicographically smallest topological order?
Replace Kahn's FIFO queue with a min-heap (priority queue) keyed by vertex id. At each step, emit the smallest-numbered ready vertex. This greedy choice yields the lexicographically smallest order at a cost of `O(V log V + E)`.

### M3. Kahn's vs DFS — when do you pick each?
Kahn's is iterative (no recursion-depth risk), naturally lets you steer the order (lexicographic, priority), and reports a cycle via "emitted < V". DFS reuses an existing DFS, gives you finish times for other algorithms, and pinpoints *where* a cycle is via the back edge. For very deep graphs prefer Kahn's to avoid stack overflow.

### M4. How do you find the longest path in a DAG?
Process vertices in topological order and relax forward: `dist[w] = max(dist[w], dist[u] + weight(u,w))`. Because `u` precedes `w`, `dist[u]` is final before it is used. This is `O(V + E)` — longest path is NP-hard on general graphs but linear on DAGs. With weights = durations it is the critical path.

### M5. How do you do shortest path in a DAG, and why not Dijkstra?
Same idea: relax edges in topological order using `min`. It is `O(V + E)` (faster than Dijkstra's `O(E log V)`) and, crucially, it works with negative edge weights, which Dijkstra cannot handle.

### M6. How would you reconstruct the actual cycle for an error message?
Use DFS. When you find a back edge `u → w` with `w` gray, walk the recursion stack from `u` back up to `w`; that path plus the edge `u → w` is the cycle. Kahn's only tells you a cycle exists; reconstructing it from Kahn's requires a second search over the leftover in-degree-positive subgraph.

### M7. How do you count the number of paths between two vertices in a DAG?
Topologically sort, set `count[s] = 1`, and sweep: for each `u` in order, `count[w] += count[u]` for every edge `u → w`. `count[t]` is the number of distinct `s → t` paths. One linear pass.

### M8. How many distinct topological orders does a DAG have, and how do you count them?
That count is the number of linear extensions of the poset. Exact counting is #P-complete in general; the practical exact method is a `2^V` subset DP (`dp[mask] += dp[mask without v]` for each `v` whose predecessors are all in `mask`), feasible only for `V` up to ~20.

### M9. How do you solve "Course Schedule II" (return an order, or empty if impossible)?
Build the graph with edge `prerequisite → course`, run Kahn's. If you emit all courses, return the order; otherwise return an empty array (a cycle means no valid schedule).

### M10. How do you parallelize tasks given a dependency DAG?
Run Kahn's but emit *all* current in-degree-0 vertices at once as a "level"; everything in a level is independent and can run in parallel. Levels run one after another (barrier between them), or you use a worker pool that pulls any ready task (maximal parallelism). The number of levels equals the longest path — the makespan floor.

### M11. What is the Minimum Height Trees problem and how does topo-sort-style peeling solve it?
Given an undirected tree, find the root(s) that minimize tree height. Repeatedly "peel" all current leaves (degree-1 nodes), like Kahn's on in-degree, until 1 or 2 nodes remain — those are the centroids and the minimum-height roots. It is the undirected analogue of in-degree-0 peeling.

### M12 (analysis). Why is processing in topological order the right precondition for DAG DP?
Because it guarantees that when you reach a vertex, every vertex it depends on has already been computed. That is exactly the precondition every forward dynamic program needs — topological order is "iterative memoization without recursion".

---

## Senior Questions (10 Q&A)

### S1. How do you topologically order a graph that may contain cycles?
Compute strongly connected components (Tarjan or Kosaraju), collapse each SCC into a single super-node to form the condensation (which is always a DAG), then topologically sort the condensation. This gives a meaningful block-level order even though the original graph is not a DAG.

### S2. Design the scheduler for a build system like make -j.
Build a DAG of targets; pre-validate acyclicity (reject circular dependencies with the cycle path). Maintain atomic in-degree counters; a worker pool pulls ready (in-degree-0) targets; when a target finishes it atomically decrements successors and enqueues any that hit 0. Track a "remaining" counter to know when the whole build is done. Prioritize critical-path targets to minimize wall-clock time.

### S3. How does parallel Kahn stay correct without a global lock?
Each vertex's in-degree is an atomic counter. When a task finishes, it atomically decrements each successor; the decrement that drives a counter to exactly 0 is the single thread that enqueues that successor. Because exactly one decrement reaches 0, each successor is enqueued exactly once — no duplicates, no missed wake-ups, no global lock.

### S4. What is the critical path and why does it bound parallelism?
The critical path is the longest weighted chain through the DAG. Even with infinite workers, wall-clock time cannot be less than the critical-path length, because those tasks must run sequentially. So `makespan ≥ max(critical_path, total_work / workers)`; adding workers only helps until `total_work / workers` drops below the critical path.

### S5. What concurrency bugs are specific to parallel topological execution?
Double-completion: a retried task reports "done" twice, decrementing successors' in-degrees twice and launching them before their real predecessors finish — guard with idempotent completion (CAS a done flag). And the terminator bug: an empty ready queue does not mean "finished" if workers are still in flight — track a separate atomic remaining-task counter.

### S6. How do you maintain a topological order when edges arrive dynamically?
Use an online topological order algorithm (e.g. Pearce–Kelly): on each edge insertion, only re-order the affected region between the endpoints rather than re-sorting the whole graph. Detect cycles incrementally — an edge that would point "backward" past the entire affected range closes a cycle.

### S7. How would you detect and report circular dependencies to a user clearly?
DFS-based detection gives the cycle directly: at the back edge, walk the gray stack to reconstruct `A → B → C → A`. Surface that exact path in the error, not just "a cycle exists". Do this in a pre-flight pass before executing anything.

### S8. When is DFS topo sort dangerous, and what is the fix?
On very deep graphs the recursion can overflow the stack (depth up to `V`). Fix: use Kahn's iterative algorithm, or an explicit-stack iterative DFS, or raise the recursion limit. For 10⁶-deep chains, recursion will crash; Kahn's will not.

### S9. How do you topologically process an extremely large graph that does not fit in memory?
Use external-memory / time-forward processing: stream edges and use a priority-queue-based technique to deliver each vertex's "ready" signal in topological order, achieving `O(sort(E))` I/O complexity rather than random access. Distributed frameworks (Spark, Pregel) layer the DAG and process level by level.

### S10 (analysis). Why can DAG shortest path handle negative weights when Dijkstra cannot?
Dijkstra relies on the greedy invariant that once a vertex is settled its distance is final, which fails with negative edges. In a DAG, processing in topological order guarantees all predecessors of a vertex are finalized before it, so relaxation is correct regardless of sign — no greedy assumption is needed.

---

## Professional Questions (8 Q&A)

### P1. Formally, what is a topological order in order-theoretic terms?
It is a linear extension of the strict partial order induced by the DAG's reachability relation. A bijection that orders every edge correctly necessarily orders every reachable pair correctly (by transitivity), so "orders all edges" and "is a linear extension" are equivalent.

### P2. Prove that a DAG always has at least one source.
Suppose not: every vertex has in-degree ≥ 1. Then from any vertex you can always step to a predecessor; following predecessors through a finite vertex set must eventually revisit a vertex, forming a directed cycle — contradicting acyclicity. Hence a source exists. (Dually, a sink exists.)

### P3. What is the complexity of counting all topological orders, and what can you do about it?
Counting linear extensions is #P-complete (Brightwell & Winkler, 1991), so no polynomial exact algorithm is expected. Exactly, you use `O(2^V · V)` subset DP for small `V`. For large posets, a fully polynomial randomized approximation scheme exists (Dyer–Frieze–Kannan; Bubley–Dyer's rapidly mixing chain), giving a `(1 ± ε)` estimate in polynomial time.

### P4. How do you maintain acyclicity / topological order under incremental edge insertions?
Use an online topological ordering algorithm. Pearce–Kelly performs well in practice; Bender, Fineman, Gilbert & Tarjan give an `O(n^{2.5})` worst-case total bound for `n` insertions. Each insertion that would create a back edge across the whole ordering signals a new cycle, giving incremental cycle detection.

### P5. Why is topological sort memory-bound, and how do you optimize cache behavior?
It does `O(1)` work per edge but one pointer-chase per adjacency traversal. Store the graph in CSR (compressed sparse row) so each vertex's neighbours are contiguous, renumber vertices by BFS/space-filling order to localize the random in-degree writes, and prefer a contiguous FIFO frontier over a pointer-chasing structure.

### P6. Give the external-memory complexity of topological sort.
`Θ(sort(E)) = Θ((E/B) log_{M/B}(E/B))` I/Os using time-forward processing (Chiang et al.), because the naive internal algorithm's random adjacency access is I/O-inefficient. This matches the external sorting lower bound.

### P7. Characterize DAGs where counting topological orders is easy.
Total orders (chains) have exactly 1; antichains of `n` elements have `n!`; forest posets have a closed hook-length-style product formula `n! / ∏ subtree_size(v)`; series-parallel posets admit polynomial structural recursion. The hardness is in general posets, not these structured families.

### P8 (analysis). Contrast the difficulty of finding one topological order versus counting them.
Finding one is `Θ(V + E)` — optimal and trivial. Counting all is #P-complete — intractable. This is a clean textbook example of the gap between *search* (find a witness) and *counting* (count all witnesses): the same structure is easy to satisfy once and provably hard to enumerate.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you modeled a problem as a dependency graph.
Look for a structured story: the problem (e.g. ordering data-pipeline jobs, resolving config includes), recognizing the "X must come before Y" structure, choosing topological sort, handling the cycle case (reporting circular dependencies), and what you measured. Strong answers mention the non-uniqueness of the order and how they made the result deterministic when needed.

### B2. Design a task scheduler that runs jobs respecting dependencies, with maximum parallelism.
Topological/parallel-Kahn is the core answer. Discuss: pre-flight cycle detection, a thread-safe ready set fed by atomic in-degree decrements, a worker pool, critical-path prioritization for latency, retries with idempotent completion, and observability (ready-set size, longest-blocked task, critical path). Call out the makespan floor = critical path.

### B3. Design a build system that only rebuilds what changed.
Model files/targets as a DAG; topologically sort to order compiles; on a change, recompute the affected subgraph incrementally (online topological order) rather than re-sorting everything. Discuss content hashing for "did this actually change", caching, and parallel execution of independent targets.

### B4. A teammate says "just use DFS, topological sort is always DFS." How do you respond?
Both Kahn's and DFS are valid and `O(V+E)`. DFS risks stack overflow on deep graphs and is awkward when you need to steer the order (lexicographic, priority); Kahn's is iterative and naturally supports a prioritized frontier and easy "emitted < V" cycle detection. Pick by the constraints, not dogma. Use it as a teaching moment about trade-offs.

### B5. Your dependency-driven workflow engine occasionally hangs. How do you investigate?
First check whether the input graph is actually a DAG — a missed cycle looks exactly like a hang. Then look for the terminator bug (empty ready set treated as "done" or vice versa), double-completion under retries, and tasks blocking on shared resources not modeled as edges. Add metrics: ready-set size, in-flight count, longest-blocked task. A ready-set of 0 with tasks remaining is the smoking gun.

---

## Coding Challenges

### Challenge 1: Course Schedule II

**Problem.** There are `numCourses` courses labeled `0..numCourses-1`. Given `prerequisites` where `[a, b]` means you must take `b` before `a`, return any valid ordering of courses to finish them all. If it is impossible (a cycle), return an empty array.

**Example.**

```text
numCourses = 4, prerequisites = [[1,0],[2,0],[3,1],[3,2]]
Output: [0, 1, 2, 3]   (or [0, 2, 1, 3] — both valid)
```

**Constraints.** `1 <= numCourses <= 2000`, `0 <= prerequisites.length <= numCourses*(numCourses-1)`, no duplicate pairs.

**Approach.** Build edges `b → a` (prerequisite first), run Kahn's algorithm. If the emitted order has all `numCourses` courses, return it; else return `[]`. `O(V + E)`.

**Go.**

```go
package main

import "fmt"

func findOrder(numCourses int, prerequisites [][]int) []int {
	adj := make([][]int, numCourses)
	indeg := make([]int, numCourses)
	for _, p := range prerequisites {
		a, b := p[0], p[1] // take b before a => edge b -> a
		adj[b] = append(adj[b], a)
		indeg[a]++
	}
	queue := []int{}
	for v := 0; v < numCourses; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	order := []int{}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		order = append(order, u)
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				queue = append(queue, w)
			}
		}
	}
	if len(order) != numCourses {
		return []int{}
	}
	return order
}

func main() {
	fmt.Println(findOrder(4, [][]int{{1, 0}, {2, 0}, {3, 1}, {3, 2}}))
	fmt.Println(findOrder(2, [][]int{{0, 1}, {1, 0}})) // cycle -> []
}
```

**Java.**

```java
import java.util.*;

public class CourseScheduleII {
    public int[] findOrder(int numCourses, int[][] prerequisites) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[numCourses];
        for (int[] p : prerequisites) {
            adj.get(p[1]).add(p[0]); // b -> a
            indeg[p[0]]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < numCourses; v++) if (indeg[v] == 0) q.add(v);
        int[] order = new int[numCourses];
        int idx = 0;
        while (!q.isEmpty()) {
            int u = q.poll();
            order[idx++] = u;
            for (int w : adj.get(u)) if (--indeg[w] == 0) q.add(w);
        }
        return idx == numCourses ? order : new int[0];
    }

    public static void main(String[] args) {
        CourseScheduleII s = new CourseScheduleII();
        System.out.println(Arrays.toString(
            s.findOrder(4, new int[][]{{1,0},{2,0},{3,1},{3,2}})));
    }
}
```

**Python.**

```python
from collections import deque


def find_order(num_courses, prerequisites):
    adj = [[] for _ in range(num_courses)]
    indeg = [0] * num_courses
    for a, b in prerequisites:          # take b before a => edge b -> a
        adj[b].append(a)
        indeg[a] += 1
    queue = deque(v for v in range(num_courses) if indeg[v] == 0)
    order = []
    while queue:
        u = queue.popleft()
        order.append(u)
        for w in adj[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                queue.append(w)
    return order if len(order) == num_courses else []


if __name__ == "__main__":
    print(find_order(4, [[1, 0], [2, 0], [3, 1], [3, 2]]))
    print(find_order(2, [[0, 1], [1, 0]]))  # cycle -> []
```

**Follow-up.** Course Schedule I asks only *whether* you can finish — return `len(order) == numCourses`. To get the lexicographically smallest order, swap the queue for a min-heap.

---

### Challenge 2: Alien Dictionary

**Problem.** Given a list of words sorted lexicographically by an unknown alien alphabet, return any valid ordering of the alphabet's letters. Return `""` if no valid order exists (contradiction / cycle), or if the input is invalid (a longer word is a prefix of an earlier shorter word).

**Example.**

```text
words = ["wrt", "wrf", "er", "ett", "rftt"]
Output: "wertf"
```

**Constraints.** `1 <= words.length <= 100`, `1 <= words[i].length <= 100`, lowercase letters.

**Approach.** Each adjacent pair of words gives one ordering constraint at their first differing character: `c1 → c2`. Build a graph over the letters that appear, topologically sort it. Detect the invalid-prefix case (`"abc"` before `"ab"`) and cycles. `O(total characters)`.

**Go.**

```go
package main

import "fmt"

func alienOrder(words []string) string {
	adj := map[byte]map[byte]bool{}
	indeg := map[byte]int{}
	for _, w := range words {
		for i := 0; i < len(w); i++ {
			if _, ok := indeg[w[i]]; !ok {
				indeg[w[i]] = 0
				adj[w[i]] = map[byte]bool{}
			}
		}
	}
	for i := 0; i+1 < len(words); i++ {
		a, b := words[i], words[i+1]
		minLen := len(a)
		if len(b) < minLen {
			minLen = len(b)
		}
		j := 0
		for ; j < minLen; j++ {
			if a[j] != b[j] {
				if !adj[a[j]][b[j]] {
					adj[a[j]][b[j]] = true
					indeg[b[j]]++
				}
				break
			}
		}
		if j == minLen && len(a) > len(b) {
			return "" // "abc" before "ab" is invalid
		}
	}
	queue := []byte{}
	for c, d := range indeg {
		if d == 0 {
			queue = append(queue, c)
		}
	}
	res := []byte{}
	for len(queue) > 0 {
		c := queue[0]
		queue = queue[1:]
		res = append(res, c)
		for nb := range adj[c] {
			indeg[nb]--
			if indeg[nb] == 0 {
				queue = append(queue, nb)
			}
		}
	}
	if len(res) != len(indeg) {
		return "" // cycle
	}
	return string(res)
}

func main() {
	fmt.Println(alienOrder([]string{"wrt", "wrf", "er", "ett", "rftt"}))
}
```

**Java.**

```java
import java.util.*;

public class AlienDictionary {
    public String alienOrder(String[] words) {
        Map<Character, Set<Character>> adj = new HashMap<>();
        Map<Character, Integer> indeg = new HashMap<>();
        for (String w : words)
            for (char c : w.toCharArray()) {
                adj.putIfAbsent(c, new HashSet<>());
                indeg.putIfAbsent(c, 0);
            }
        for (int i = 0; i + 1 < words.length; i++) {
            String a = words[i], b = words[i + 1];
            int min = Math.min(a.length(), b.length()), j = 0;
            for (; j < min; j++) {
                char x = a.charAt(j), y = b.charAt(j);
                if (x != y) {
                    if (adj.get(x).add(y)) indeg.put(y, indeg.get(y) + 1);
                    break;
                }
            }
            if (j == min && a.length() > b.length()) return "";
        }
        Deque<Character> q = new ArrayDeque<>();
        for (var e : indeg.entrySet()) if (e.getValue() == 0) q.add(e.getKey());
        StringBuilder sb = new StringBuilder();
        while (!q.isEmpty()) {
            char c = q.poll();
            sb.append(c);
            for (char nb : adj.get(c))
                if (indeg.merge(nb, -1, Integer::sum) == 0) q.add(nb);
        }
        return sb.length() == indeg.size() ? sb.toString() : "";
    }

    public static void main(String[] args) {
        System.out.println(new AlienDictionary()
            .alienOrder(new String[]{"wrt", "wrf", "er", "ett", "rftt"}));
    }
}
```

**Python.**

```python
from collections import deque, defaultdict


def alien_order(words):
    adj = defaultdict(set)
    indeg = {c: 0 for w in words for c in w}
    for a, b in zip(words, words[1:]):
        for x, y in zip(a, b):
            if x != y:
                if y not in adj[x]:
                    adj[x].add(y)
                    indeg[y] += 1
                break
        else:
            if len(a) > len(b):        # "abc" before "ab" is invalid
                return ""
    queue = deque(c for c in indeg if indeg[c] == 0)
    res = []
    while queue:
        c = queue.popleft()
        res.append(c)
        for nb in adj[c]:
            indeg[nb] -= 1
            if indeg[nb] == 0:
                queue.append(nb)
    return "".join(res) if len(res) == len(indeg) else ""


if __name__ == "__main__":
    print(alien_order(["wrt", "wrf", "er", "ett", "rftt"]))  # wertf
```

**Follow-up.** Watch the two invalid cases: the prefix violation (`["abc","ab"]`) and a true cycle. Both must return `""`.

---

### Challenge 3: Parallel Courses (minimum semesters)

**Problem.** There are `n` courses `1..n` and `relations` where `[a, b]` means `a` must be taken before `b`. In one semester you may take any number of courses whose prerequisites are all already taken. Return the minimum number of semesters to take all courses, or `-1` if impossible (cycle).

**Example.**

```text
n = 3, relations = [[1,3],[2,3]]
Output: 2   (semester 1: courses 1,2 ; semester 2: course 3)
```

**Constraints.** `1 <= n <= 5000`, no duplicate relations.

**Approach.** Level-by-level Kahn's: each "level" is one semester — take all current in-degree-0 courses simultaneously. The number of levels is the answer; if you cannot take all `n`, return `-1`. The level count equals the longest path length. `O(V + E)`.

**Go.**

```go
package main

import "fmt"

func minimumSemesters(n int, relations [][]int) int {
	adj := make([][]int, n+1)
	indeg := make([]int, n+1)
	for _, r := range relations {
		adj[r[0]] = append(adj[r[0]], r[1])
		indeg[r[1]]++
	}
	queue := []int{}
	for v := 1; v <= n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	semesters, taken := 0, 0
	for len(queue) > 0 {
		semesters++
		next := []int{}
		for _, u := range queue {
			taken++
			for _, w := range adj[u] {
				indeg[w]--
				if indeg[w] == 0 {
					next = append(next, w)
				}
			}
		}
		queue = next
	}
	if taken != n {
		return -1
	}
	return semesters
}

func main() {
	fmt.Println(minimumSemesters(3, [][]int{{1, 3}, {2, 3}})) // 2
	fmt.Println(minimumSemesters(3, [][]int{{1, 2}, {2, 3}, {3, 1}})) // -1
}
```

**Java.**

```java
import java.util.*;

public class ParallelCourses {
    public int minimumSemesters(int n, int[][] relations) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i <= n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n + 1];
        for (int[] r : relations) { adj.get(r[0]).add(r[1]); indeg[r[1]]++; }

        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 1; v <= n; v++) if (indeg[v] == 0) q.add(v);
        int semesters = 0, taken = 0;
        while (!q.isEmpty()) {
            semesters++;
            int sz = q.size();
            for (int i = 0; i < sz; i++) {
                int u = q.poll();
                taken++;
                for (int w : adj.get(u)) if (--indeg[w] == 0) q.add(w);
            }
        }
        return taken == n ? semesters : -1;
    }

    public static void main(String[] args) {
        System.out.println(new ParallelCourses()
            .minimumSemesters(3, new int[][]{{1, 3}, {2, 3}})); // 2
    }
}
```

**Python.**

```python
from collections import deque


def minimum_semesters(n, relations):
    adj = [[] for _ in range(n + 1)]
    indeg = [0] * (n + 1)
    for a, b in relations:
        adj[a].append(b)
        indeg[b] += 1
    queue = deque(v for v in range(1, n + 1) if indeg[v] == 0)
    semesters = taken = 0
    while queue:
        semesters += 1
        for _ in range(len(queue)):
            u = queue.popleft()
            taken += 1
            for w in adj[u]:
                indeg[w] -= 1
                if indeg[w] == 0:
                    queue.append(w)
    return semesters if taken == n else -1


if __name__ == "__main__":
    print(minimum_semesters(3, [[1, 3], [2, 3]]))          # 2
    print(minimum_semesters(3, [[1, 2], [2, 3], [3, 1]]))  # -1
```

**Follow-up.** The number of semesters equals the longest path in the DAG. If each course took a different amount of time, you would weight vertices and compute the weighted critical path instead.

---

### Challenge 4: Minimum Height Trees

**Problem.** Given an undirected tree of `n` nodes (`0..n-1`) and its `edges`, a node can be chosen as a root. Return all roots that give a tree of minimum height.

**Example.**

```text
n = 6, edges = [[3,0],[3,1],[3,2],[3,4],[5,4]]
Output: [3, 4]
```

**Constraints.** `1 <= n <= 2*10^4`, the input forms a valid tree.

**Approach.** Topological-style **leaf peeling**: repeatedly remove all current leaves (degree-1 nodes), exactly like removing in-degree-0 vertices in Kahn's, until 1 or 2 nodes remain. Those are the tree's centroids and the minimum-height roots. `O(V + E)`.

**Go.**

```go
package main

import "fmt"

func findMinHeightTrees(n int, edges [][]int) []int {
	if n == 1 {
		return []int{0}
	}
	adj := make([]map[int]bool, n)
	for i := range adj {
		adj[i] = map[int]bool{}
	}
	for _, e := range edges {
		adj[e[0]][e[1]] = true
		adj[e[1]][e[0]] = true
	}
	leaves := []int{}
	for v := 0; v < n; v++ {
		if len(adj[v]) == 1 {
			leaves = append(leaves, v)
		}
	}
	remaining := n
	for remaining > 2 {
		remaining -= len(leaves)
		next := []int{}
		for _, leaf := range leaves {
			for nb := range adj[leaf] {
				delete(adj[nb], leaf)
				if len(adj[nb]) == 1 {
					next = append(next, nb)
				}
			}
		}
		leaves = next
	}
	return leaves
}

func main() {
	fmt.Println(findMinHeightTrees(6, [][]int{{3, 0}, {3, 1}, {3, 2}, {3, 4}, {5, 4}}))
}
```

**Java.**

```java
import java.util.*;

public class MinimumHeightTrees {
    public List<Integer> findMinHeightTrees(int n, int[][] edges) {
        if (n == 1) return List.of(0);
        List<Set<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new HashSet<>());
        for (int[] e : edges) { adj.get(e[0]).add(e[1]); adj.get(e[1]).add(e[0]); }

        List<Integer> leaves = new ArrayList<>();
        for (int v = 0; v < n; v++) if (adj.get(v).size() == 1) leaves.add(v);

        int remaining = n;
        while (remaining > 2) {
            remaining -= leaves.size();
            List<Integer> next = new ArrayList<>();
            for (int leaf : leaves)
                for (int nb : adj.get(leaf)) {
                    adj.get(nb).remove(leaf);
                    if (adj.get(nb).size() == 1) next.add(nb);
                }
            leaves = next;
        }
        return leaves;
    }

    public static void main(String[] args) {
        System.out.println(new MinimumHeightTrees().findMinHeightTrees(
            6, new int[][]{{3, 0}, {3, 1}, {3, 2}, {3, 4}, {5, 4}}));
    }
}
```

**Python.**

```python
def find_min_height_trees(n, edges):
    if n == 1:
        return [0]
    adj = [set() for _ in range(n)]
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)
    leaves = [v for v in range(n) if len(adj[v]) == 1]
    remaining = n
    while remaining > 2:
        remaining -= len(leaves)
        nxt = []
        for leaf in leaves:
            for nb in adj[leaf]:
                adj[nb].discard(leaf)
                if len(adj[nb]) == 1:
                    nxt.append(nb)
        leaves = nxt
    return leaves


if __name__ == "__main__":
    print(find_min_height_trees(6, [[3, 0], [3, 1], [3, 2], [3, 4], [5, 4]]))
```

**Follow-up.** A tree has at most two centroids, which is why the answer has 1 or 2 nodes. The peeling is the undirected analogue of Kahn's in-degree-0 removal.

---

## Common Pitfalls in Interviews

- **Reversing the edge direction.** "A depends on B" is the edge `B → A`. Getting this backwards yields the reverse order and passes small tests by luck.
- **Forgetting to reverse the DFS finish list.** Finish order is the *reverse* of a topological order.
- **Asserting a unique answer.** There are usually many valid orders; check the property, not one expected list. Interviewers may give a different but valid order.
- **Not detecting cycles.** Returning a partial Kahn order (length `< V`) as complete is a silent bug. Always check `emitted == V`.
- **Only starting from one source.** Disconnected DAGs need you to iterate over all vertices.
- **DFS stack overflow.** On deep graphs, prefer iterative Kahn's. Mention this proactively.
- **Alien Dictionary prefix trap.** `["abc", "ab"]` is invalid input and must return `""`, separate from the cycle case.
- **Self-loops and duplicate edges.** A self-loop is a length-1 cycle; duplicate edges inflate in-degree counts.
- **Confusing levels with the linear order.** Parallel Courses / Minimum Semesters needs *level count*, not the flat order.

---

## What Interviewers Are Really Testing

A topological sort question is rarely about reciting Kahn's algorithm. Interviewers probe three deeper skills. First, **can you recognize the pattern in disguise?** Course Schedule, Alien Dictionary, build order, and recipe steps are all the same DAG-ordering problem wearing different clothes; spotting that under time pressure is the differentiator. Second, **do you handle the structural corners?** Edge direction, cycle detection (and reporting), disconnected components, and the non-uniqueness of the answer are exactly where weaker candidates write subtly wrong code. Third, **can you connect it to the bigger picture?** Topological order is the precondition for DAG dynamic programming — longest/critical path, path counting, negative-weight shortest path — and the engine inside build systems and schedulers. The strongest candidates also reason about production realities: how to parallelize while respecting dependencies, why the critical path bounds wall-clock time, how to detect a circular dependency and surface it to a user, and how to avoid a recursion-depth blow-up on a deep graph. A single topological-sort conversation is broad enough to demonstrate algorithmic recognition, careful edge-case handling, and systems judgment all at once.
