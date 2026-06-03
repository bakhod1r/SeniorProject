# Games on Graphs (Win / Lose / Draw) — Interview Preparation

Games on graphs is a high-signal interview topic because it rewards one crisp insight — *"label positions WIN/LOSE/DRAW; a position is LOSE if all moves go to WIN, WIN if some move goes to LOSE, and the rest are DRAW"* — and then tests whether you can (a) recognize when the game graph is acyclic (simple memo) versus cyclic (needs retrograde analysis), (b) implement retrograde analysis with reverse edges and out-degree counters, (c) extend it to distance-to-win (mate-in-k), and (d) avoid the classic trap of running a forward DFS that loops forever on cycles. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Who wins this acyclic game position? | memoized DFS (WIN iff some child LOSE) | `O(V + E)` |
| Who wins, graph may have cycles (draws)? | retrograde analysis (backward BFS) | `O(V + E)` |
| Fastest forced win / longest delay (mate-in-k) | layered retrograde BFS (fast-win/slow-loss) | `O(V + E)` |
| Who wins a **sum** of independent acyclic games? | Sprague-Grundy (XOR of Grundy numbers, topic 15) | `O(V + E)` |
| Pursuit / cop-and-robber capture set | retrograde on product graph `(cop, robber, turn)` | `O(V + E)` |
| **Count simple paths / longest simple path** | unrelated; NP-hard / #P-hard | — |

The labeling rules (memorize cold):

```text
terminal (no moves)         => LOSE   (stuck ⇒ you lose, normal play)
some move to a LOSE child   => WIN    (push opponent into losing seat)
all moves to WIN children   => LOSE   (everything you try, opponent wins)
otherwise (cycle-trapped)   => DRAW   (never reached by backward wave)
```

Core algorithm:

```text
retrograde(moves):
    build rev[], deg[] (deg[u] = out-degree)
    queue = terminals; label them LOSE
    while queue:
        v = pop
        for u in rev[v]:
            if u known: continue
            if label[v]==LOSE: label[u]=WIN; push u
            else: deg[u]--; if deg[u]==0: label[u]=LOSE; push u
    every unlabeled u => DRAW          # O(V + E)
```

Key facts:
- A label is from the viewpoint of **the player to move** at that position.
- **WIN needs one** LOSE child; **LOSE needs all** WIN children — that asymmetry is the out-degree counter.
- **DRAW = never reached** by the backward wave (can dodge onto a cycle forever).
- Misère play (last to move loses): **flip the terminal seed to WIN**.
- Acyclic ⇒ no draws; cyclic ⇒ draws possible.

---

## Junior Questions (12 Q&A)

### J1. What does it mean for a position to be WIN, LOSE, or DRAW?
The label is from the viewpoint of the player about to move. **WIN**: that player can force a win. **LOSE**: the opponent can force the win no matter what. **DRAW**: with best play neither side can force a win and the game can go on forever (or ties by rule).

### J2. What is a terminal position and what is its label?
A position with no legal moves. Under normal play ("can't move ⇒ you lose"), a terminal is **LOSE** for the player to move. It is the seed of the whole computation.

### J3. State the labeling rule for WIN.
A position is **WIN** if it has *at least one* move to a **LOSE** position — you move there and hand your opponent a losing position.

### J4. State the labeling rule for LOSE.
A position is **LOSE** if *every* move leads to a **WIN** position — whatever you play, the opponent then wins. (A terminal is the special case of this with zero moves.)

### J5. When is a position a DRAW?
When it is neither WIN nor LOSE: it has no move to a LOSE child (so it can't force a win), but not all its moves go to WIN (so it isn't forced to lose). It can keep dodging onto a cycle forever.

### J6. Why doesn't a simple recursive DFS work on a cyclic game graph?
If positions can repeat (a cycle), the DFS recurses into a position that is still being computed, causing infinite recursion. It also has no clean way to express DRAW (the "loop forever" outcome). Cycles require retrograde analysis.

### J7. What is retrograde analysis in one sentence?
Solve **backward** from terminals: seed terminals as LOSE, then propagate outcomes along **reverse** edges using out-degree counters, and whatever is never reached is a DRAW.

### J8. What is the out-degree counter for?
It captures the asymmetry. A LOSE child instantly makes a predecessor WIN. A WIN child only decrements the predecessor's counter; the predecessor becomes LOSE only when the counter reaches 0 (all its moves led to WIN).

### J9. What is the time complexity of retrograde analysis?
`O(V + E)` — each position is settled and enqueued once, each (reverse) edge is traversed once. Linear in the size of the position graph.

### J10. Can the acyclic case have draws?
No. In a DAG every play strictly progresses to a terminal, so every position is WIN or LOSE. Draws appear only when cycles let a player avoid terminals forever.

### J11. What changes for the misère convention (last to move loses)?
Seed terminals as **WIN** instead of LOSE. The propagation rules are unchanged; the flipped seed inverts the whole answer correctly.

### J12 (analysis). Why must "whose turn it is" be part of the position?
Because the same board with different players to move can have different outcomes. Baking the turn into the position makes the game a plain directed graph and each label unambiguous.

---

## Middle Questions (12 Q&A)

### M1. Walk through retrograde analysis on a tiny graph.
Seed every out-degree-0 node as LOSE and enqueue it. Pop a node `v`: for each predecessor `u`, if `v` is LOSE then `u` is WIN (it has a winning move); if `v` is WIN, decrement `deg[u]`, and if it hits 0 then `u` is LOSE. When the queue empties, all unlabeled nodes are DRAW.

### M2. Why is the result independent of processing order?
Because the labeling is the unique least fixpoint of monotone rules. A node is decided only when *forced* by already-decided nodes, so any valid order of forced decisions reaches the same final labels.

### M3. How do you compute the number of moves to force a win?
Track `dist`. Terminal LOSE has `dist = 0`. A WIN node gets `dist = 1 + (LOSE child's dist)`, and BFS order makes that the *minimum* (fast win). A LOSE node gets `dist = 1 + max(child dist)` (slow loss), finalized when its counter hits 0.

### M4. Why min for WIN distance but max for LOSE distance?
"Fast win, slow loss." The winner wants to mate as fast as possible (min over winning moves); the loser, being forced through some move, wants to delay defeat as long as possible (max over all moves).

### M5. Contrast retrograde analysis with naive DFS memoization.
DFS memo is fine on a DAG (`O(V+E)`, no draws) but loops or mislabels on cycles. Retrograde analysis works backward from terminals, handles cycles, produces DRAW as a first-class label, and is also `O(V+E)`.

### M6. Why is a "DFS with in-progress guard returns DRAW" approach wrong?
Whether a cycle node is a draw is a *global* property of the fixpoint, not a local "I've seen this node again" flag. A cycle node can still be WIN (if it has a move to LOSE) or LOSE. Only the backward propagation gets it right.

### M7. How does this relate to Sprague-Grundy theory (topic 15)?
WIN/LOSE is the 2-valued shadow of the Grundy number: `g(u)=0 ⟺ LOSE`, `g(u)>0 ⟺ WIN`. Grundy carries more info (it solves *sums* of games via XOR) but requires acyclicity. For a single cyclic game, retrograde analysis is the tool; Grundy doesn't apply.

### M8. When is DAG game DP preferable?
When you can prove the position graph is acyclic (e.g., a monotone potential strictly decreases each move — piles only shrink). Then a memoized DFS or reverse-topological DP is simpler, has no draws, and is equally `O(V+E)`.

### M9. How do you handle multiple terminal types (some WIN, some LOSE)?
Seed each terminal with its given verdict and enqueue all of them. The algorithm handles a heterogeneous seed set without modification.

### M10. How would you model a pursuit (cop-and-robber) game?
Position = `(cop_position, robber_position, whose_turn)`. Capture (cop on robber) is a terminal. Run retrograde analysis on this product graph; the WIN set tells you which start configurations the cop can force a capture from, and `dist` gives the capture time.

### M11. What's the role of reverse edges, concretely?
To propagate a settled outcome to the positions that can *reach* it. When `v` is settled, we must update everyone with a move into `v` — that's exactly `rev[v]`. Without reverse edges you'd have to rescan forward, which is what makes the backward pass efficient.

### M12 (analysis). Why is the algorithm `O(V+E)` and not more?
Each node is enqueued at most once (settled-once + skip check). Each reverse edge is traversed once, when its head is popped. Counter decrements sum to `O(E)`. So total work is linear.

---

## Senior Questions (10 Q&A)

### S1. Your game has 10^14 positions. How do you even start?
You cannot store the explicit graph. Use a **perfect-hash index** (`rank`/`unrank`) mapping legal positions to dense integers, generate successors and predecessors **on the fly** with move/un-move functions, and apply **symmetry reduction** to shrink `V`. Run retrograde analysis over the implicit graph, possibly external-memory (disk-streamed frontier BFS).

### S2. What is the hardest part of building an endgame tablebase?
**Predecessor (un-move) generation.** Un-moves must un-capture (reintroduce a piece, changing the material slice), un-promote, and only produce legal positions. It is far buggier than forward move generation. Verify with a forward/backward edge-consistency test before a long build.

### S3. How do you reduce a huge state space before solving?
**Symmetry reduction**: fold board rotations/reflections (up to 8× for no-pawn chess, 2× with pawns) and canonicalize identical pieces (sort their squares). The canonicalization must be used identically by indexing and move generation, or you double-count or lose positions.

### S4. WDL vs DTM vs DTZ — what's the difference and why care?
**WDL** (win/draw/loss) is 2 bits/position, used during search. **DTM** (distance-to-mate) needs more bits and gives the fastest forced mate. **DTZ** (distance-to-zeroing-move) resets at captures/pawn moves and is what handles the chess **50-move rule** — DTM can say "win" where the 50-move rule forces a draw.

### S5. How does material slicing make chess endgames tractable?
Material can only decrease or transform via captures/promotions, so material signatures form a dependency DAG. Solve simplest slices first; within a slice (fixed material) positions form a cyclic graph solved by retrograde analysis, seeded from terminals **plus** converting moves into already-solved slices.

### S6. The out-degree counter array won't fit in memory. Options?
Recompute degree on demand from the successor generator (trade CPU for memory), pack counters into the minimum bits for the max branching factor, or use external-memory retrograde (sort the frontier by index and stream from disk, as Chinook did for checkers).

### S7. How do you verify a tablebase no human can check?
A **small-slice minimax oracle** (exhaustive recursion on a slice small enough to solve directly), forward/backward edge-consistency, `rank(unrank(idx))==idx`, symmetry invariance, distance monotonicity, and reproducing published landmark statistics (e.g., longest KRK mate = 16 moves).

### S8. What seed mistakes are common and costly?
Treating **stalemate as a loss** (it's a draw in chess) or **mate as a win** (it's a loss for the side to move). One wrong terminal verdict inverts an entire slice. Encode terminal labels directly from the actual rules.

### S9. How do you parallelize / scale retrograde analysis?
The frontier BFS layers are sequential (layer `d` depends on `d-1`), but within a layer, predecessor processing is parallelizable across the frontier. Material slices are independent once their dependencies are solved, so different slices run on different machines. External-memory sorting handles graphs exceeding RAM.

### S10 (analysis). Why is a single per-position label sufficient — no history needed?
Because reachability/safety games are **positionally (memorylessly) determined**: optimal play depends only on the current position, not on how you reached it. This is the easy base case of parity-game determinacy and is exactly what justifies storing one WIN/LOSE/DRAW label per position.

---

## Professional Questions (8 Q&A)

### P1. Prove retrograde analysis computes the correct labels even with cycles.
The labeling is the **least fixpoint** of monotone rules (Knaster-Tarski). Retrograde analysis decides a node only when forced by already-decided nodes (a LOSE child ⇒ WIN; counter 0 ⇒ LOSE), so it computes exactly that least fixpoint. By induction on distance-to-terminal, decided labels equal the optimal-play value; undecided nodes can maintain an infinite play (a non-LOSE successor always exists) and cannot force a win, so they are genuine DRAWs.

### P2. Why does forward DFS fail and backward BFS succeed, in fixpoint terms?
Forward DFS assumes well-founded recursion, which holds only on a DAG. The labeling is a least fixpoint that, on cyclic graphs, is *strictly partial* — the undecided gap is the DRAW set. Backward propagation iterates the monotone operator from the empty assignment, adding nodes only when forced, which is precisely how you compute a least fixpoint.

### P3. What is the attractor-set formulation?
The WIN set is the **attractor** of the target terminals: the least set closed under "the mover can step into it" (∃ successor inside) and "all moves stay inside" (∀ successors inside). The DRAW set is the complement — the **safety region** from which the opponent keeps the play out of the target forever. This is the standard language of reachability/safety games in verification.

### P4. How do parity games generalize this?
Parity games decide infinite plays by the parity of the highest priority seen infinitely often. Our WIN/LOSE/DRAW setting is the 1–2 priority (reachability/safety) base case, solvable in `O(V+E)` by attractor. General parity games are in `NP ∩ co-NP` and solvable in quasi-polynomial time (Calude et al. 2017); positional determinacy (Emerson-Jutla) is the deep theorem underpinning the whole hierarchy.

### P5. Why does Sprague-Grundy require acyclicity, but retrograde analysis doesn't?
Grundy's `g(u) = mex{g(v)}` recursion is well-founded only on a DAG; on cycles it has no convergent least value, and the XOR composition rule for sums relies on finite Nim-values that loopy games lack. Retrograde analysis solves a *single* cyclic game's outcome (a least fixpoint), but unlike Grundy it does not compose across sums.

### P6. Justify the fast-win / slow-loss distance convention formally.
It is minimax depth. A WIN node picks one move and wants the soonest terminal: `dist = 1 + min` over LOSE successors. A LOSE node is forced through whichever move and wants the latest terminal: `dist = 1 + max` over successors. BFS settles nodes in non-decreasing distance, so the first LOSE successor to reach a node realizes the min automatically.

### P7. Give the complexity and prove optimality.
`O(V + E)` time and space: each node enqueued once, each reverse edge traversed once, counter decrements amortize to `O(E)`. It is optimal because any algorithm must inspect every position and move at least once (an unseen edge could flip an outcome), giving an `Ω(V+E)` lower bound.

### P8 (analysis). When is the DRAW set empty, and why?
When the graph is acyclic. With no cycles, the least fixpoint decides every vertex (the well-founded recursion bottoms out at terminals), so there is no undecided gap and `D = ∅`. This is the formal reason DAG games never draw.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you debugged a non-terminating recursion.
Look for: recognizing that the recursion had a cycle (state repetition), understanding that the problem was fundamentally a least-fixpoint computation, and switching from forward recursion to a backward/worklist algorithm. Strong answers mention the correctness check against a brute-force oracle on a small acyclic instance.

### B2. A teammate's game solver loops forever on some inputs. How do you help?
Diagnose calmly: their inputs have cycles (positions repeat), and their forward memoized DFS assumes the game always ends. Explain the WIN-needs-one / LOSE-needs-all asymmetry and the DRAW outcome, then pair on converting to retrograde analysis (reverse edges + out-degree counters). Frame it as a structural mismatch, not a coding slip.

### B3. Design a service that answers "is this endgame position winning?" for chess.
This is an endgame tablebase: perfect-hash index legal positions, symmetry-fold, slice by material, solve each slice with retrograde analysis seeded from mates/stalemates and converting moves, store WDL (compact, for search) and DTZ (for the 50-move rule). Discuss memory, compression, and verifying against published landmarks.

### B4. Explain win/lose/draw labeling to a junior engineer.
Use the maze-from-the-exit analogy: flood backward from the "you lose" terminals. A position is winning if *one* move reaches a losing-for-the-opponent spot; losing if *every* move hands the opponent a win; and a draw if you can dodge forever. Emphasize the two gotchas first: cycles need backward propagation, and the WIN/LOSE asymmetry needs a counter.

### B5. Your tablebase build crashed after 6 hours with wrong results. How do you investigate?
Suspect the un-move (predecessor) generator first — it's the buggiest part. Run the forward/backward edge-consistency test on a sample, check the indexing bijection (`rank(unrank)==idx`), verify symmetry idempotence, and re-run the small-slice minimax oracle. Add these as CI gates so a 6-hour build never starts on a broken generator again.

---

## Coding Challenges

### Challenge 1: Label Win/Lose on an Acyclic Move Graph

**Problem.** Given a **DAG** of game positions as adjacency lists `moves`, label each position WIN or LOSE (no draws). A position is WIN iff some move leads to a LOSE position; a terminal is LOSE. Return the labels.

**Example.**
```text
moves = [[1,2],[3],[3],[]]   # 0->1,0->2; 1->3; 2->3; 3 terminal
3 LOSE; 1 WIN (1->3 LOSE); 2 WIN; 0 LOSE (0->1 WIN, 0->2 WIN)  => [LOSE,WIN,WIN,LOSE]
```

**Constraints.** `1 ≤ V ≤ 10^6`, graph is acyclic.

**Approach.** Memoized DFS (or reverse-topological DP), `O(V + E)`.

**Go.**
```go
package main

import "fmt"

const (
	LOSE = 0
	WIN  = 1
)

func labelDAG(moves [][]int) []int {
	n := len(moves)
	label := make([]int, n)
	seen := make([]bool, n)
	var dfs func(u int) int
	dfs = func(u int) int {
		if seen[u] {
			return label[u]
		}
		seen[u] = true
		label[u] = LOSE // default: terminal or all-WIN children
		for _, v := range moves[u] {
			if dfs(v) == LOSE {
				label[u] = WIN
				break
			}
		}
		return label[u]
	}
	for u := 0; u < n; u++ {
		dfs(u)
	}
	return label
}

func main() {
	moves := [][]int{{1, 2}, {3}, {3}, {}}
	label := labelDAG(moves)
	names := []string{"LOSE", "WIN"}
	for u, l := range label {
		fmt.Printf("%d: %s\n", u, names[l])
	}
}
```

**Java.**
```java
import java.util.*;

public class LabelDAG {
    static final int LOSE = 0, WIN = 1;
    static int[] label;
    static boolean[] seen;
    static List<List<Integer>> moves;

    static int dfs(int u) {
        if (seen[u]) return label[u];
        seen[u] = true;
        label[u] = LOSE;
        for (int v : moves.get(u)) {
            if (dfs(v) == LOSE) { label[u] = WIN; break; }
        }
        return label[u];
    }

    public static void main(String[] args) {
        moves = Arrays.asList(
            Arrays.asList(1, 2), Arrays.asList(3),
            Arrays.asList(3), Arrays.asList());
        int n = moves.size();
        label = new int[n];
        seen = new boolean[n];
        for (int u = 0; u < n; u++) dfs(u);
        String[] names = {"LOSE", "WIN"};
        for (int u = 0; u < n; u++)
            System.out.println(u + ": " + names[label[u]]);
    }
}
```

**Python.**
```python
import sys
from functools import lru_cache

sys.setrecursionlimit(2_000_000)
LOSE, WIN = 0, 1


def label_dag(moves):
    @lru_cache(maxsize=None)
    def win(u):
        return any(win(v) == LOSE for v in moves[u])  # WIN iff some child LOSE
    return [WIN if win(u) else LOSE for u in range(len(moves))]


if __name__ == "__main__":
    moves = (( 1, 2), (3,), (3,), ())  # tuples so lru_cache key is hashable
    names = ["LOSE", "WIN"]
    for u, l in enumerate(label_dag(moves)):
        print(f"{u}: {names[l]}")
```

---

### Challenge 2: Game With Draws and Cycles (Retrograde Analysis)

**Problem.** Given a game graph that **may contain cycles**, label each position WIN, LOSE, or DRAW. Terminals are LOSE (normal play).

**Example.**
```text
moves = [[1,2],[3],[1,4],[],[2]]
=> 0 DRAW, 1 WIN, 2 DRAW, 3 LOSE, 4 DRAW
```

**Constraints.** `1 ≤ V ≤ 10^6`, cycles allowed.

**Approach.** Retrograde analysis (backward BFS + out-degree counters), `O(V + E)`.

**Go.**
```go
package main

import "fmt"

const (
	LOSE = 0
	WIN  = 1
	DRAW = 2
)

func retrograde(n int, moves [][]int) []int {
	rev := make([][]int, n)
	deg := make([]int, n)
	for u := 0; u < n; u++ {
		deg[u] = len(moves[u])
		for _, v := range moves[u] {
			rev[v] = append(rev[v], u)
		}
	}
	label := make([]int, n)
	known := make([]bool, n)
	for i := range label {
		label[i] = DRAW
	}
	queue := []int{}
	for u := 0; u < n; u++ {
		if deg[u] == 0 {
			label[u], known[u] = LOSE, true
			queue = append(queue, u)
		}
	}
	for len(queue) > 0 {
		v := queue[0]
		queue = queue[1:]
		for _, u := range rev[v] {
			if known[u] {
				continue
			}
			if label[v] == LOSE {
				label[u], known[u] = WIN, true
				queue = append(queue, u)
			} else {
				deg[u]--
				if deg[u] == 0 {
					label[u], known[u] = LOSE, true
					queue = append(queue, u)
				}
			}
		}
	}
	return label
}

func main() {
	moves := [][]int{{1, 2}, {3}, {1, 4}, {}, {2}}
	names := []string{"LOSE", "WIN", "DRAW"}
	for u, l := range retrograde(5, moves) {
		fmt.Printf("%d: %s\n", u, names[l])
	}
}
```

**Java.**
```java
import java.util.*;

public class Retrograde {
    static final int LOSE = 0, WIN = 1, DRAW = 2;

    static int[] solve(int n, List<List<Integer>> moves) {
        List<List<Integer>> rev = new ArrayList<>();
        for (int i = 0; i < n; i++) rev.add(new ArrayList<>());
        int[] deg = new int[n];
        for (int u = 0; u < n; u++) {
            deg[u] = moves.get(u).size();
            for (int v : moves.get(u)) rev.get(v).add(u);
        }
        int[] label = new int[n];
        Arrays.fill(label, DRAW);
        boolean[] known = new boolean[n];
        ArrayDeque<Integer> q = new ArrayDeque<>();
        for (int u = 0; u < n; u++)
            if (deg[u] == 0) { label[u] = LOSE; known[u] = true; q.add(u); }
        while (!q.isEmpty()) {
            int v = q.poll();
            for (int u : rev.get(v)) {
                if (known[u]) continue;
                if (label[v] == LOSE) {
                    label[u] = WIN; known[u] = true; q.add(u);
                } else if (--deg[u] == 0) {
                    label[u] = LOSE; known[u] = true; q.add(u);
                }
            }
        }
        return label;
    }

    public static void main(String[] args) {
        List<List<Integer>> moves = Arrays.asList(
            Arrays.asList(1, 2), Arrays.asList(3),
            Arrays.asList(1, 4), Arrays.asList(), Arrays.asList(2));
        String[] names = {"LOSE", "WIN", "DRAW"};
        int[] label = solve(5, moves);
        for (int u = 0; u < 5; u++)
            System.out.println(u + ": " + names[label[u]]);
    }
}
```

**Python.**
```python
from collections import deque

LOSE, WIN, DRAW = 0, 1, 2


def retrograde(n, moves):
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


if __name__ == "__main__":
    moves = [[1, 2], [3], [1, 4], [], [2]]
    names = ["LOSE", "WIN", "DRAW"]
    for u, l in enumerate(retrograde(5, moves)):
        print(f"{u}: {names[l]}")
```

---

### Challenge 3: Minimum Moves to Force a Win

**Problem.** Same game graph (cycles allowed). For every WIN position, report the minimum number of plies to force a win (fast-win); for every LOSE position, the maximum number of plies the loser can delay (slow-loss). DRAW positions report `-1`.

**Example.**
```text
moves = [[1],[2],[]]   # 0->1->2; 2 terminal
2 LOSE dist 0; 1 WIN dist 1; 0 LOSE dist 2
```

**Approach.** Layered retrograde BFS: WIN dist = `1 + min(LOSE child)` (BFS gives min for free); LOSE dist = `1 + max(child)` finalized at counter 0.

**Go.**
```go
package main

import "fmt"

const (
	LOSE = 0
	WIN  = 1
	DRAW = 2
)

func solve(n int, moves [][]int) ([]int, []int) {
	rev := make([][]int, n)
	deg := make([]int, n)
	for u := 0; u < n; u++ {
		deg[u] = len(moves[u])
		for _, v := range moves[u] {
			rev[v] = append(rev[v], u)
		}
	}
	label := make([]int, n)
	dist := make([]int, n)
	known := make([]bool, n)
	for i := range label {
		label[i], dist[i] = DRAW, -1
	}
	queue := []int{}
	for u := 0; u < n; u++ {
		if deg[u] == 0 {
			label[u], dist[u], known[u] = LOSE, 0, true
			queue = append(queue, u)
		}
	}
	for len(queue) > 0 {
		v := queue[0]
		queue = queue[1:]
		for _, u := range rev[v] {
			if known[u] {
				continue
			}
			if label[v] == LOSE {
				label[u], dist[u], known[u] = WIN, dist[v]+1, true
				queue = append(queue, u)
			} else {
				deg[u]--
				if dist[v]+1 > dist[u] {
					dist[u] = dist[v] + 1
				}
				if deg[u] == 0 {
					label[u], known[u] = LOSE, true
					queue = append(queue, u)
				}
			}
		}
	}
	return label, dist
}

func main() {
	moves := [][]int{{1}, {2}, {}}
	label, dist := solve(3, moves)
	names := []string{"LOSE", "WIN", "DRAW"}
	for u := 0; u < 3; u++ {
		fmt.Printf("%d: %-4s dist=%d\n", u, names[label[u]], dist[u])
	}
}
```

**Java.**
```java
import java.util.*;

public class MinMovesToWin {
    static final int LOSE = 0, WIN = 1, DRAW = 2;

    static int[][] solve(int n, List<List<Integer>> moves) {
        List<List<Integer>> rev = new ArrayList<>();
        for (int i = 0; i < n; i++) rev.add(new ArrayList<>());
        int[] deg = new int[n];
        for (int u = 0; u < n; u++) {
            deg[u] = moves.get(u).size();
            for (int v : moves.get(u)) rev.get(v).add(u);
        }
        int[] label = new int[n], dist = new int[n];
        Arrays.fill(label, DRAW);
        Arrays.fill(dist, -1);
        boolean[] known = new boolean[n];
        ArrayDeque<Integer> q = new ArrayDeque<>();
        for (int u = 0; u < n; u++)
            if (deg[u] == 0) { label[u] = LOSE; dist[u] = 0; known[u] = true; q.add(u); }
        while (!q.isEmpty()) {
            int v = q.poll();
            for (int u : rev.get(v)) {
                if (known[u]) continue;
                if (label[v] == LOSE) {
                    label[u] = WIN; dist[u] = dist[v] + 1; known[u] = true; q.add(u);
                } else {
                    deg[u]--;
                    dist[u] = Math.max(dist[u], dist[v] + 1);
                    if (deg[u] == 0) { label[u] = LOSE; known[u] = true; q.add(u); }
                }
            }
        }
        return new int[][]{label, dist};
    }

    public static void main(String[] args) {
        List<List<Integer>> moves = Arrays.asList(
            Arrays.asList(1), Arrays.asList(2), Arrays.asList());
        int[][] r = solve(3, moves);
        String[] names = {"LOSE", "WIN", "DRAW"};
        for (int u = 0; u < 3; u++)
            System.out.printf("%d: %-4s dist=%d%n", u, names[r[0][u]], r[1][u]);
    }
}
```

**Python.**
```python
from collections import deque

LOSE, WIN, DRAW = 0, 1, 2


def solve(n, moves):
    rev = [[] for _ in range(n)]
    deg = [len(moves[u]) for u in range(n)]
    for u in range(n):
        for v in moves[u]:
            rev[v].append(u)
    label = [DRAW] * n
    dist = [-1] * n
    known = [False] * n
    q = deque()
    for u in range(n):
        if deg[u] == 0:
            label[u], dist[u], known[u] = LOSE, 0, True
            q.append(u)
    while q:
        v = q.popleft()
        for u in rev[v]:
            if known[u]:
                continue
            if label[v] == LOSE:
                label[u], dist[u], known[u] = WIN, dist[v] + 1, True
                q.append(u)
            else:
                deg[u] -= 1
                dist[u] = max(dist[u], dist[v] + 1)
                if deg[u] == 0:
                    label[u], known[u] = LOSE, True
                    q.append(u)
    return label, dist


if __name__ == "__main__":
    moves = [[1], [2], []]
    label, dist = solve(3, moves)
    names = ["LOSE", "WIN", "DRAW"]
    for u in range(3):
        print(f"{u}: {names[label[u]]:<4} dist={dist[u]}")
```

---

### Challenge 4: Pursuit (Token) Game — Can the Cop Catch the Robber?

**Problem.** On an undirected graph, a cop and a robber occupy vertices and move alternately along edges (a player may also stay put). The cop catches the robber by landing on the same vertex. Starting with the cop to move, determine for each `(cop, robber)` start whether the cop can force a capture (WIN for the cop). Model the position as `(cop, robber, turn)` and run retrograde analysis; capture positions are terminal WIN-for-cop.

We build the product graph and label from the **cop's** perspective: a position where it is the cop's turn is WIN if the cop can move to a capture or to a robber-turn position that is WIN; a robber-turn position is WIN (for the cop) only if *all* robber moves lead to cop-WIN. Capture = WIN seed; positions where the robber evades forever are DRAW (robber escapes).

**Go.**
```go
package main

import "fmt"

// Labels from the cop's perspective. WIN = cop captures, DRAW = robber escapes.
const (
	ESCAPE  = 2 // DRAW for cop = robber escapes
	CAPTURE = 1 // WIN for cop
	UNSURE  = 0
)

func solvePursuit(n int, adj [][]int) map[[3]int]int {
	// state = (cop, robber, turn); turn 0 = cop to move, 1 = robber to move
	type S = [3]int
	idx := func(c, r, t int) S { return S{c, r, t} }

	succ := func(s S) []S {
		c, r, t := s[0], s[1], s[2]
		var out []S
		if t == 0 { // cop moves (or stays)
			for _, nc := range append([]int{c}, adj[c]...) {
				out = append(out, idx(nc, r, 1))
			}
		} else { // robber moves (or stays)
			for _, nr := range append([]int{r}, adj[r]...) {
				out = append(out, idx(c, nr, 0))
			}
		}
		return out
	}

	// Capture means cop and robber share a vertex *after* a cop move,
	// i.e. a cop-turn-to-robber-turn state with c == r is a CAPTURE seed.
	// We seed all states with c == r as CAPTURE (cop has won).
	label := map[S]int{}
	deg := map[S]int{}
	rev := map[S][]S{}
	var states []S
	for c := 0; c < n; c++ {
		for r := 0; r < n; r++ {
			for t := 0; t < 2; t++ {
				states = append(states, idx(c, r, t))
			}
		}
	}
	for _, s := range states {
		ss := succ(s)
		deg[s] = len(ss)
		for _, w := range ss {
			rev[w] = append(rev[w], s)
		}
		label[s] = UNSURE
	}

	queue := []S{}
	for _, s := range states {
		if s[0] == s[1] { // same vertex => captured
			label[s] = CAPTURE
			queue = append(queue, s)
		}
	}

	for len(queue) > 0 {
		v := queue[0]
		queue = queue[1:]
		for _, u := range rev[v] {
			if label[u] != UNSURE {
				continue
			}
			copTurn := (u[2] == 0)
			if copTurn {
				// cop wins if SOME move leads to CAPTURE
				if label[v] == CAPTURE {
					label[u] = CAPTURE
					queue = append(queue, u)
				}
			} else {
				// robber turn: cop wins only if ALL robber moves lead to CAPTURE
				if label[v] == CAPTURE {
					deg[u]--
					if deg[u] == 0 {
						label[u] = CAPTURE
						queue = append(queue, u)
					}
				}
			}
		}
	}

	out := map[[3]int]int{}
	for _, s := range states {
		if label[s] == CAPTURE {
			out[s] = CAPTURE
		} else {
			out[s] = ESCAPE
		}
	}
	return out
}

func main() {
	// path graph 0-1-2 ; cop should catch robber on this small graph
	adj := [][]int{{1}, {0, 2}, {1}}
	res := solvePursuit(3, adj)
	// cop at 0, robber at 2, cop to move
	fmt.Println("cop=0 robber=2 copToMove capture?", res[[3]int{0, 2, 0}] == 1)
}
```

**Java.**
```java
import java.util.*;

public class Pursuit {
    static final int UNSURE = 0, CAPTURE = 1, ESCAPE = 2;

    // encode (cop, robber, turn) as a single int: (cop*n + robber)*2 + turn
    static int enc(int c, int r, int t, int n) { return (c * n + r) * 2 + t; }

    static int[] solve(int n, List<List<Integer>> adj) {
        int total = n * n * 2;
        List<List<Integer>> rev = new ArrayList<>();
        for (int i = 0; i < total; i++) rev.add(new ArrayList<>());
        int[] deg = new int[total];
        int[] label = new int[total];

        for (int c = 0; c < n; c++)
            for (int r = 0; r < n; r++)
                for (int t = 0; t < 2; t++) {
                    int s = enc(c, r, t, n);
                    List<Integer> succ = new ArrayList<>();
                    if (t == 0) {           // cop moves or stays
                        succ.add(enc(c, r, 1, n));
                        for (int nc : adj.get(c)) succ.add(enc(nc, r, 1, n));
                    } else {                // robber moves or stays
                        succ.add(enc(c, r, 0, n));
                        for (int nr : adj.get(r)) succ.add(enc(c, nr, 0, n));
                    }
                    deg[s] = succ.size();
                    for (int w : succ) rev.get(w).add(s);
                }

        ArrayDeque<Integer> q = new ArrayDeque<>();
        for (int c = 0; c < n; c++)
            for (int t = 0; t < 2; t++) {
                int s = enc(c, c, t, n);   // same vertex => captured
                label[s] = CAPTURE;
                q.add(s);
            }

        while (!q.isEmpty()) {
            int v = q.poll();
            for (int u : rev.get(v)) {
                if (label[u] != UNSURE) continue;
                boolean copTurn = (u % 2 == 0);
                if (copTurn) {
                    if (label[v] == CAPTURE) { label[u] = CAPTURE; q.add(u); }
                } else {
                    if (label[v] == CAPTURE && --deg[u] == 0) {
                        label[u] = CAPTURE; q.add(u);
                    }
                }
            }
        }
        for (int s = 0; s < total; s++)
            if (label[s] != CAPTURE) label[s] = ESCAPE;
        return label;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = Arrays.asList(
            Arrays.asList(1), Arrays.asList(0, 2), Arrays.asList(1));
        int[] label = solve(3, adj);
        int s = (0 * 3 + 2) * 2 + 0; // cop=0 robber=2 cop to move
        System.out.println("capture? " + (label[s] == CAPTURE));
    }
}
```

**Python.**
```python
from collections import deque

UNSURE, CAPTURE, ESCAPE = 0, 1, 2


def solve_pursuit(n, adj):
    def enc(c, r, t):
        return (c * n + r) * 2 + t

    total = n * n * 2
    rev = [[] for _ in range(total)]
    deg = [0] * total
    label = [UNSURE] * total

    for c in range(n):
        for r in range(n):
            for t in range(2):
                s = enc(c, r, t)
                if t == 0:                       # cop moves or stays
                    succ = [enc(c, r, 1)] + [enc(nc, r, 1) for nc in adj[c]]
                else:                            # robber moves or stays
                    succ = [enc(c, r, 0)] + [enc(c, nr, 0) for nr in adj[r]]
                deg[s] = len(succ)
                for w in succ:
                    rev[w].append(s)

    q = deque()
    for c in range(n):
        for t in range(2):
            s = enc(c, c, t)                     # same vertex => captured
            label[s] = CAPTURE
            q.append(s)

    while q:
        v = q.popleft()
        for u in rev[v]:
            if label[u] != UNSURE:
                continue
            cop_turn = (u % 2 == 0)
            if cop_turn:
                if label[v] == CAPTURE:
                    label[u] = CAPTURE
                    q.append(u)
            else:
                if label[v] == CAPTURE:
                    deg[u] -= 1
                    if deg[u] == 0:
                        label[u] = CAPTURE
                        q.append(u)

    for s in range(total):
        if label[s] != CAPTURE:
            label[s] = ESCAPE
    return label, enc


if __name__ == "__main__":
    adj = [[1], [0, 2], [1]]
    label, enc = solve_pursuit(3, adj)
    s = enc(0, 2, 0)  # cop=0 robber=2 cop to move
    print("capture?", label[s] == CAPTURE)
```

---

## Final Tips

- Lead with the one-liner: *"Label positions WIN/LOSE/DRAW; LOSE if all moves go to WIN, WIN if some move goes to LOSE, the rest DRAW — compute it backward from terminals in `O(V+E)`."*
- Immediately distinguish **acyclic** (memoized DFS, no draws) from **cyclic** (retrograde analysis, draws possible).
- Explain the **out-degree counter** as the encoding of "WIN needs one good child, LOSE needs all bad children."
- For "how fast / how slow", mention the **fast-win / slow-loss** distance convention (min for WIN, `1 + max` for LOSE).
- If asked about *sums* of games, pivot to **Sprague-Grundy** (topic 15) and note it requires acyclicity.
- Always offer to verify against a brute-force minimax oracle on small instances and against the acyclic DFS on DAGs.
