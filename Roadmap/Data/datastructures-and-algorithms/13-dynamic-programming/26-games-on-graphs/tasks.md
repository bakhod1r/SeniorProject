# Games on Graphs (Win / Lose / Draw) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the win/lose/draw labeling logic and validate against the evaluation criteria.
> **Always test against a brute-force minimax oracle on small inputs, and against the acyclic memoized-DFS solver on DAG inputs, before trusting the retrograde-analysis result on cyclic graphs.**

---

## Beginner Tasks (5)

### Task 1 — Acyclic win/lose labeling (memoized DFS)

**Problem.** Given a **DAG** of game positions as adjacency lists `moves`, label each position WIN (`1`) or LOSE (`0`). A terminal (no moves) is LOSE; a position is WIN iff some move leads to a LOSE position. There are no draws in a DAG.

**Input / Output spec.**
- Read `n`, then for each `u` read its move count followed by that many targets.
- Print `label[0..n-1]` space-separated (`0`/`1`).

**Constraints.** `1 ≤ n ≤ 10^5`, the graph is acyclic.

**Hint.** Memoize: `win(u) = any(not win(v) for v in moves[u])`. Use iterative DFS or raise the recursion limit for large `n`.

**Starter — Go.**
```go
package main

import "fmt"

func labelDAG(moves [][]int) []int {
	// TODO: memoized DFS; label[u]=1 if some child is LOSE(0)
	return make([]int, len(moves))
}

func main() {
	var n int
	fmt.Scan(&n)
	moves := make([][]int, n)
	for u := 0; u < n; u++ {
		var k int
		fmt.Scan(&k)
		moves[u] = make([]int, k)
		for i := 0; i < k; i++ {
			fmt.Scan(&moves[u][i])
		}
	}
	label := labelDAG(moves)
	for i, l := range label {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(l)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int[] labelDAG(List<List<Integer>> moves) {
        // TODO: memoized DFS
        return new int[moves.size()];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        List<List<Integer>> moves = new ArrayList<>();
        for (int u = 0; u < n; u++) {
            int k = sc.nextInt();
            List<Integer> ms = new ArrayList<>();
            for (int i = 0; i < k; i++) ms.add(sc.nextInt());
            moves.add(ms);
        }
        int[] label = labelDAG(moves);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(' ');
            sb.append(label[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys

sys.setrecursionlimit(1_000_000)


def label_dag(moves):
    # TODO: memoized DFS; WIN iff some child LOSE
    return [0] * len(moves)


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    moves = []
    for _ in range(n):
        k = int(next(data))
        moves.append([int(next(data)) for _ in range(k)])
    print(" ".join(map(str, label_dag(moves))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Terminals labeled LOSE; WIN iff some child is LOSE.
- Matches a brute-force minimax on small DAGs.
- `O(n + edges)`.

---

### Task 2 — Terminal detection and seeding

**Problem.** Given a game graph, output the list of terminal positions (out-degree 0) in increasing order, and the seed label each should get under (a) normal play and (b) misère play.

**Input / Output spec.**
- Read `n` and the move lists.
- Print the terminal indices, then "normal: LOSE", "misere: WIN".

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** A terminal is any `u` with `len(moves[u]) == 0`. Normal play seeds terminals LOSE; misère seeds them WIN. Everything else in retrograde analysis is identical.

**Evaluation criteria.**
- Correctly lists all out-degree-0 nodes.
- States the normal vs misère seed difference.

---

### Task 3 — Reverse graph and out-degree counters

**Problem.** Given a game graph, build and print: (a) the reverse adjacency `rev[v]` for each `v`, and (b) the out-degree `deg[u]` for each `u`. These are the two structures retrograde analysis needs.

**Input / Output spec.**
- Read `n` and the move lists.
- Print `deg[0..n-1]`, then each `rev[v]` (sorted) on its own line.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** One pass over all edges: for each edge `u → v`, append `u` to `rev[v]` and set `deg[u] = len(moves[u])`. Do not scan twice.

**Worked check.** For `moves = [[1,2],[3],[1,4],[],[2]]`: `deg = [2,1,2,0,1]`, `rev[1] = [0,2]`, `rev[2] = [0,4]`, `rev[3] = [1]`, `rev[4] = [2]`, `rev[0] = []`.

**Evaluation criteria.**
- `deg` matches out-degrees exactly.
- `rev` contains every edge reversed, no duplicates, no omissions.
- Built in a single edge pass.

---

### Task 4 — Retrograde analysis (win/lose/draw) on a cyclic graph

**Problem.** Given a game graph that **may contain cycles**, label each position WIN (`1`), LOSE (`0`), or DRAW (`2`). Terminals are LOSE (normal play). Use retrograde analysis.

**Input / Output spec.**
- Read `n` and the move lists.
- Print `label[0..n-1]` space-separated.

**Constraints.** `1 ≤ n ≤ 10^6`, cycles allowed.

**Hint.** Backward BFS: seed terminals LOSE; on popping a LOSE node, mark unknown predecessors WIN; on popping a WIN node, decrement predecessors' `deg`, and mark LOSE when `deg` hits 0. Leftovers are DRAW. Skip already-known predecessors.

**Reference oracle (Python) — minimax with cycle detection, use to validate.**
```python
def brute_minimax(moves):
    LOSE, WIN, DRAW = 0, 1, 2
    n = len(moves)
    label = [None] * n

    def solve(u, stack):
        if label[u] is not None:
            return label[u]
        if u in stack:
            return DRAW  # on the current path: provisional draw (cycle)
        if not moves[u]:
            label[u] = LOSE
            return LOSE
        stack = stack | {u}
        results = [solve(v, stack) for v in moves[u]]
        if any(r == LOSE for r in results):
            res = WIN
        elif all(r == WIN for r in results):
            res = LOSE
        else:
            res = DRAW
        # note: provisional; for robust validation use the explicit-fixpoint
        # oracle from the test suite. This works for small acyclic + simple cyclic cases.
        label[u] = res
        return res

    return [solve(u, frozenset()) for u in range(n)]
```

**Evaluation criteria.**
- Terminals LOSE; WIN iff a LOSE child; LOSE iff all WIN children; else DRAW.
- Matches hand-computed labels on the 5-node example: `[2,1,2,0,1]`.
- `O(n + edges)`, no infinite loops on cycles.

---

### Task 5 — Misère variant

**Problem.** Solve Task 4 but under the **misère** convention: the player who *cannot move* **wins** (terminals are WIN). Output WIN/LOSE/DRAW labels.

**Input / Output spec.** Same as Task 4.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** Flip exactly one thing: seed terminals as **WIN** instead of LOSE. The propagation rules (one LOSE child ⇒ WIN; all WIN children ⇒ LOSE) are unchanged. Confirm by flipping the seed and re-running your Task 4 solver.

**Evaluation criteria.**
- Only the terminal seed changes versus Task 4.
- On a single terminal node, the answer is WIN (misère) vs LOSE (normal).
- Matches a misère brute-force minimax on small inputs.

---

## Intermediate Tasks (5)

### Task 6 — Minimum moves to force a win (fast-win / slow-loss)

**Problem.** For a cyclic game graph, output for each position its label and the optimal distance-to-terminal: WIN nodes report the *minimum* plies to force a win; LOSE nodes report the *maximum* plies the loser can delay; DRAW nodes report `-1`.

**Input / Output spec.**
- Read `n` and the move lists.
- Print `label[u] dist[u]` per line.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** Terminal LOSE has `dist = 0`. WIN: `dist = 1 + dist(LOSE child)` — BFS order gives the min automatically. LOSE: `dist = 1 + max(child dist)`, updated as children resolve and finalized when `deg` hits 0.

**Reference oracle (Python).**
```python
def brute_dist(moves, label):
    # label from a correct solver; recompute distance the slow way on small graphs
    LOSE, WIN = 0, 1
    n = len(moves)
    dist = [-1] * n
    # repeated relaxation (Bellman-Ford style) until stable
    for _ in range(n + 1):
        for u in range(n):
            if label[u] == LOSE:
                if not moves[u]:
                    dist[u] = 0
                else:
                    ds = [dist[v] for v in moves[u] if dist[v] >= 0]
                    if len(ds) == len(moves[u]):
                        dist[u] = 1 + max(ds)
            elif label[u] == WIN:
                ds = [dist[v] for v in moves[u] if label[v] == LOSE and dist[v] >= 0]
                if ds:
                    dist[u] = 1 + min(ds)
    return dist
```

**Evaluation criteria.**
- WIN uses min over LOSE children, LOSE uses `1 + max` over all children.
- DRAW distance is `-1`.
- Matches `brute_dist` for small graphs; e.g. `moves=[[1],[2],[]]` ⇒ dist `[2,1,0]`.

---

### Task 7 — Multiple terminal verdicts

**Problem.** Some terminals are explicitly WIN (you reached a goal), others explicitly LOSE (you got trapped). Given the move lists and a map `seed[u] ∈ {WIN, LOSE}` for each terminal, label all positions WIN/LOSE/DRAW.

**Input / Output spec.**
- Read `n`, the move lists, then `m` and `m` pairs `u seed` for terminals.
- Print all labels.

**Constraints.** `1 ≤ n ≤ 10^6`; every out-degree-0 node appears in the seed map.

**Hint.** Seed the queue with all given terminals and their verdicts; run the unchanged propagation. The algorithm handles a heterogeneous seed set directly.

**Evaluation criteria.**
- Both WIN-terminals and LOSE-terminals are seeded correctly.
- A position with a move to a WIN-terminal of the opponent... (careful: a move into a LOSE-for-the-mover-at-child node makes the parent WIN — verify the perspective).
- Matches brute-force minimax with mixed terminal verdicts.

---

### Task 8 — Subtraction game (acyclic) solver

**Problem.** A pile has `N` stones. On a turn a player removes `s` stones for some `s` in a given set `S`. The player who cannot move loses. For each pile size `0..N`, output WIN/LOSE. Model pile size as a position; moves go to smaller piles (acyclic).

**Input / Output spec.**
- Read `N`, then `|S|` and the elements of `S`.
- Print `label[0..N]`.

**Constraints.** `1 ≤ N ≤ 10^6`, `1 ≤ s ≤ N`.

**Hint.** This is a DAG (pile only shrinks), so no draws. `win(p) = any(not win(p - s) for s in S if p - s >= 0)`. A bottom-up DP over `p = 0..N` is `O(N·|S|)`. Optionally compute Grundy numbers (topic 15) and check `LOSE ⟺ g(p)=0`.

**Evaluation criteria.**
- `label[0] = LOSE` (empty pile, can't move).
- Matches the standard subtraction-game pattern (e.g. `S={1,2}` gives LOSE exactly when `p % 3 == 0`).
- No draws (acyclic).

---

### Task 9 — Detect cycles to decide which algorithm to use

**Problem.** Given a game graph, decide whether it is acyclic. If acyclic, solve with memoized DFS (no draws); if it has a cycle, solve with retrograde analysis (draws possible). Output the chosen method and the labels.

**Input / Output spec.**
- Read `n` and the move lists.
- Print `ACYCLIC` or `CYCLIC`, then the labels.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** Detect a cycle with a DFS three-color marking (white/gray/black) or by checking whether a topological sort consumes all `n` nodes (Kahn's algorithm). Then dispatch. Both solvers must agree on any acyclic input.

**Evaluation criteria.**
- Correct cycle detection.
- Acyclic path uses DFS and produces no DRAW labels.
- Cyclic path uses retrograde analysis; both agree on acyclic inputs.

---

### Task 10 — Token game on a line (pursuit-lite)

**Problem.** Two tokens sit on a line of `L` cells. Player A controls token `a`, player B token `b`; they alternate, each moving their token left or right by 1 (or staying). A wins if `a == b` after A's move (capture). Determine, for the start `(a0, b0, A to move)`, whether A can force a capture, and in how many moves.

**Input / Output spec.**
- Read `L`, `a0`, `b0`.
- Print `CAPTURE k` (k = moves) or `ESCAPE`.

**Constraints.** `1 ≤ L ≤ 200`.

**Hint.** Position = `(a, b, turn)`, so `2·L²` states. Capture states (`a == b`) seed as WIN-for-A. On A's turn use the "some move wins" rule; on B's turn use the "all moves win for A" rule. Run retrograde analysis with distance.

**Evaluation criteria.**
- Correct CAPTURE/ESCAPE verdict and capture distance.
- Matches a brute-force minimax on small `L`.
- State encoding `(a, b, turn)` is a clean bijection to integers.

---

## Advanced Tasks (5)

### Task 11 — Implicit-graph retrograde (successors generated on the fly)

**Problem.** Solve a game given only `n`, a `succ(idx)` function, a `pred(idx)` function, and a `terminal(idx)` predicate (no explicit adjacency lists). Label all positions WIN/LOSE/DRAW. This is the shape real solvers use for huge state spaces.

**Constraints.** `1 ≤ n ≤ 10^7`; `succ`/`pred` run in `O(branching)`.

**Hint.** Compute `deg[u] = len(succ(u))` (recompute-on-demand to save memory if needed). Seed terminals, propagate via `pred`. Verify `pred`/`succ` consistency on a sample: every `v` in `succ(u)` must have `u` in `pred(v)`.

**Evaluation criteria.**
- Works without materializing the full edge set.
- Forward/backward consistency test passes on a random sample.
- Matches an explicit-graph solver on a small instance wired through the same interface.

---

### Task 12 — Longest forced mate (max distance-to-mate)

**Problem.** Over a solved game graph, find the position with the **longest** forced win (the maximum WIN distance), and the longest forced loss. Report both positions and their distances. This is the headline statistic of an endgame tablebase.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** Run the distance-aware retrograde analysis (Task 6), then scan for `max(dist[u])` among WIN nodes and among LOSE nodes. The fast-win/slow-loss convention makes these well-defined.

**Evaluation criteria.**
- Distances computed with WIN = `1 + min`, LOSE = `1 + max`.
- Correctly identifies the deepest mate.
- Matches brute-force on small graphs; on a line-pursuit instance, the deepest capture matches the manual worst case.

---

### Task 13 — Self-loops and stay-put moves

**Problem.** Solve a game where some positions have a self-loop (a "pass" / stay-put move `u → u`). Label WIN/LOSE/DRAW correctly. A self-loop is a length-1 cycle and can force DRAW if it's the only non-losing option.

**Constraints.** `1 ≤ n ≤ 10^6`; self-loops allowed.

**Hint.** Count self-loops in `deg[u]` and add them to `rev[u]` like any edge. A position whose only move is a self-loop (and that self-loop doesn't lead to a LOSE child — it leads to itself) is a DRAW. Verify your code does not special-case `u == v` incorrectly.

**Worked check.** A single node with only a self-loop is a DRAW (can pass forever, never forced to lose, never reaches a win).

**Evaluation criteria.**
- Self-loops counted in out-degree and reverse edges.
- A node with only a self-loop is DRAW.
- Matches brute-force minimax with pass moves on small graphs.

---

### Task 14 — Cop-and-robber capture set on a graph

**Problem.** On an undirected graph, a cop and a robber move alternately along edges (staying allowed). Determine the full set of `(cop, robber)` start positions (cop to move) from which the cop can force a capture, and the capture distance for each. Output the count of cop-win starts.

**Constraints.** `1 ≤ V ≤ 300`; `2·V²` states.

**Hint.** State = `(cop, robber, turn)`. Capture (`cop == robber`) seeds as WIN-for-cop. Cop-turn states use "some move captures"; robber-turn states use "all robber moves lead to capture." Run distance-aware retrograde. (Theory note: a graph is "cop-win" iff it is dismantlable, but you don't need that — the labeling decides it directly.)

**Evaluation criteria.**
- Correct cop-win set and capture distances.
- On a tree (always cop-win), every start is CAPTURE.
- On a cycle of length ≥ 4 with one cop, some robber starts ESCAPE (DRAW) — verify.

---

### Task 15 — Classify the right tool

**Problem.** Given a problem description with parameters `(graph_type, has_cycles, is_sum_of_games, query)`, return one of: `MEMO_DFS` (acyclic single game), `RETROGRADE` (cyclic single game), `GRUNDY` (acyclic sum of games), or `INTRACTABLE` (e.g. counting/longest *simple* paths). Justify each.

**Constraints / cases to handle.**
- Acyclic single game, who-wins → `MEMO_DFS`.
- Cyclic single game (positions repeat) → `RETROGRADE`.
- Sum of independent acyclic games → `GRUNDY` (XOR Grundy numbers, topic 15).
- Longest *simple* path / count simple paths → `INTRACTABLE` (NP-hard / #P-hard).

**Hint.** Encode the decision rules from `middle.md` and `professional.md`. The trap is mistaking a sum-of-games question for a single-game one (Grundy needed) or assuming a cyclic game can use plain DFS (it can't).

**Evaluation criteria.**
- Correctly classifies all four canonical cases.
- `GRUNDY` branch cites that it requires acyclicity and composes via XOR.
- `INTRACTABLE` branch cites NP-hardness/#P-hardness of simple-path problems (unrelated to win/lose labeling).

---

## Benchmark Task

### Task B — Forward DFS vs Retrograde Analysis on cyclic graphs

**Problem.** Empirically demonstrate that naive forward memoized DFS fails on cyclic game graphs while retrograde analysis succeeds, and measure retrograde analysis throughput as the graph scales.

- **(a) Forward DFS:** memoized `win(u)` recursion. On a cyclic graph it stack-overflows or loops (guard it and observe wrong labels).
- **(b) Retrograde analysis:** backward BFS, `O(V + E)`.
- **(c) Scaling:** generate random functional/sparse digraphs (fixed seed) for `V ∈ {10^3, 10^4, 10^5, 10^6}` and time retrograde analysis.

**Starter — Python.**
```python
import random
import time
import sys
from collections import deque

sys.setrecursionlimit(1_000_000)
LOSE, WIN, DRAW = 0, 1, 2


def gen_graph(v, seed, max_out=3):
    r = random.Random(seed)
    moves = []
    for u in range(v):
        k = r.randint(0, max_out)            # may be 0 (terminal) or create cycles
        moves.append([r.randint(0, v - 1) for _ in range(k)])
    return moves


def retrograde(moves):
    n = len(moves)
    rev = [[] for _ in range(n)]
    deg = [len(moves[u]) for u in range(n)]
    for u in range(n):
        for v in moves[u]:
            rev[v].append(u)
    label = [DRAW] * n
    known = [False] * n
    q = deque(u for u in range(n) if deg[u] == 0)
    for u in q:
        label[u], known[u] = LOSE, True
    while q:
        v = q.popleft()
        for u in rev[v]:
            if known[u]:
                continue
            if label[v] == LOSE:
                label[u], known[u] = WIN, True
                q.append(u)
            else:
                deg[u] -= 1
                if deg[u] == 0:
                    label[u], known[u] = LOSE, True
                    q.append(u)
    return label


def bench(v, seed):
    moves = gen_graph(v, seed)
    start = time.perf_counter()
    retrograde(moves)
    return (time.perf_counter() - start) * 1000.0


def main():
    print("V           retrograde_ms")
    for v in [1_000, 10_000, 100_000, 1_000_000]:
        ms = sum(bench(v, 42 + i) for i in range(3)) / 3.0
        print(f"{v:<12d} {ms:.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same graph across Go, Java, and Python.
- Forward DFS demonstrably fails (loops/overflow) on a graph with cycles; retrograde analysis returns correct labels.
- Retrograde analysis time scales roughly linearly with `V + E`.
- Report includes the mean across at least 3 runs and excludes graph-generation time.
- Writeup: a short note explaining *why* DFS fails (no well-founded recursion on cycles, no DRAW representation) and why retrograde analysis is `O(V + E)`.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Run a minimax oracle on small `V`, and the acyclic memoized DFS on DAG inputs; diff label-for-label, then trust the retrograde solver on large/cyclic graphs.
- **Pick the algorithm by acyclicity.** Provable DAG ⇒ memoized DFS (no draws). Possibly cyclic ⇒ retrograde analysis (draws possible). Sum of acyclic games ⇒ Sprague-Grundy (topic 15).
- **Get the labeling asymmetry right.** WIN needs *one* LOSE child; LOSE needs *all* WIN children. That asymmetry is exactly the out-degree counter.
- **Get the terminal seed right.** Normal play: terminals LOSE. Misère: terminals WIN. Mixed verdicts: seed each terminal individually. One wrong seed inverts the answer.
- **Leave draws implicit.** Initialize labels to DRAW and only overwrite on resolution; the leftovers are the draws — no cycle detection needed.
- **Distance convention.** WIN = `1 + min` over LOSE children (BFS gives min for free); LOSE = `1 + max` over all children, finalized when the counter hits 0; DRAW = `-1`.
- **Use integer-indexed arrays, not hash maps,** for per-position fields; encode `(state, turn)` as a dense integer for speed and memory.
- **Never use win/lose labeling for simple-path problems.** Counting/longest simple paths is NP-hard / #P-hard and unrelated to this technique.

Each task must be implemented and tested in **Go, Java, and Python**, with identical labels across all three on the same seeded inputs.
