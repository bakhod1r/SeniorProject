# Minimax and Alpha-Beta Pruning — Middle Level

> **Focus:** the mechanics of alpha-beta that make it fast in practice — bound propagation and cutoffs, the negamax reformulation that halves the code, why move ordering decides everything, transposition tables that memoize positions, and iterative deepening that ties it all together.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Negamax and Alpha-Beta](#negamax-and-alpha-beta)
6. [Transposition Tables and Iterative Deepening](#transposition-tables-and-iterative-deepening)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was: *MAX maximizes, MIN minimizes, alpha-beta prunes branches that cannot matter.* At middle level you start asking the engineering questions that decide whether your search is correct *and* fast:

- How exactly do `alpha` and `beta` propagate, and why is a cutoff provably safe?
- Why does writing two near-identical MAX and MIN branches invite bugs, and how does **negamax** collapse them into one?
- Move ordering can change alpha-beta from `O(b^d)` to `O(b^(d/2))`. How do you order moves *before* you know which is best?
- Many positions are reachable by different move sequences (**transpositions**). How do you avoid re-searching them with a **transposition table**?
- You do not know the right depth in advance. How does **iterative deepening** search depth 1, 2, 3, … and reuse the results?

These five questions separate "I can write minimax" from "I can build a search that competes."

---

## Deeper Concepts

### The alpha-beta window, restated

Carry two bounds down the recursion. They describe the *useful range* of values the current node can return:

- `alpha` — the value MAX is already **guaranteed** somewhere above. MAX will never accept less.
- `beta` — the value MIN is already **guaranteed** somewhere above. MIN will never allow more.

The pair `(alpha, beta)` is the **search window**. A node only needs to report a value inside this window; anything outside is irrelevant because a better alternative already exists higher up.

```
At a MAX node:
    for each child:
        v = search(child, alpha, beta)
        if v > best:  best = v
        alpha = max(alpha, best)
        if alpha >= beta:           # beta cutoff
            break                   # MIN above won't allow MAX to reach this; stop
    return best
```

A **beta cutoff** at a MAX node means: "I (MAX) found a child worth at least `beta`. But MIN, higher up, can already hold the value to `beta` by going elsewhere. So MIN will never enter this subtree, and searching my remaining children is wasted." Symmetrically, an **alpha cutoff** at a MIN node means MAX above already has something at least as good, so MIN's subtree is moot.

### Why the cutoff is safe (intuition)

When `alpha >= beta`, the windows have crossed. The pruned children could only push the value *further* outside the window (a MAX node's later children can only raise the value above `beta`; a MIN node's only lower it below `alpha`). Either way the parent has already committed to a choice that makes those values irrelevant. The value returned is either exact (within the window) or a *bound* (a value outside the window that is good enough to prove the node will not be chosen). [`professional.md`](./professional.md) turns this into a formal proof that the root value is identical to plain minimax.

### Fail-hard vs fail-soft

Two conventions for what to return on a cutoff:

- **Fail-hard:** clamp the returned value to the window `[alpha, beta]`. Simpler; the classic textbook form.
- **Fail-soft:** return the actual best value found even if it lies outside the window. Gives tighter bounds to the caller, which helps transposition tables and aspiration windows.

Both yield the same root value with a full window. Fail-soft is preferred in strong engines because the extra information improves later pruning.

### Encoding "win faster, lose slower"

If a win is `+1` regardless of how many moves it takes, the engine may dawdle. Fold depth into the score so quicker wins score higher:

```
score = (+1) * (DEPTH_BONUS - plies_used)   for a win
score = (-1) * (DEPTH_BONUS - plies_used)   for a loss
```

or, more simply, return `+ (remaining_depth)` for a win and `- (remaining_depth)` for a loss. Now MAX prefers the fastest win and the slowest loss, which both looks better and helps the opponent make mistakes.

---

## Comparison with Alternatives

### Plain minimax vs alpha-beta vs ordered alpha-beta

| Approach | Leaves examined | When |
|----------|-----------------|------|
| Plain minimax | `b^d` (all) | teaching, tiny trees |
| Alpha-beta, worst ordering | `b^d` | adversarial/worst-case input |
| Alpha-beta, random ordering | ~`b^(3d/4)` | no ordering heuristic |
| Alpha-beta, **perfect ordering** | `b^(d/2)` (`≈ 2·b^(d/2) − 1`) | best move tried first everywhere |

Doubling reachable depth for the same node budget is why move ordering dominates every other micro-optimization. A depth-8 search becomes a depth-16 search.

### Alpha-beta vs other game-search ideas

| Need | Tool | Why |
|------|------|-----|
| Exact value, perfect-info, zero-sum | alpha-beta | optimal, prunes losslessly |
| Same, but huge branching with no good eval (Go) | Monte Carlo Tree Search (MCTS) | samples instead of full search; better when eval is weak |
| Chance nodes (dice) | expectiminimax | adds expectation layers; pruning is limited |
| Re-searchable positions | + transposition table | memoize to skip duplicate subtrees |
| Unknown time budget | + iterative deepening | search depth 1,2,3,… and stop when time runs out |

Alpha-beta is the right default for deterministic, perfect-information, zero-sum games with a usable evaluation function. MCTS wins when the branching factor is enormous and a reliable heuristic is unavailable.

### Tic-tac-toe vs a Nim-style game

Tic-tac-toe needs a full tree search because the win condition is positional. A take-away game like Nim has a closed-form theory (`14-nim`, `15-sprague-grundy`): the value follows from XOR of pile sizes, so you never search a tree at all. Minimax *also* solves Nim correctly — it just does more work than the formula. Recognizing when a game has algebraic structure (Sprague-Grundy) saves you from searching entirely.

---

## Advanced Patterns

### Pattern: Move ordering heuristics

You must order moves *before* knowing their true values. Common cheap heuristics, in rough priority:

1. **Transposition-table best move** — if you searched this position before (even at a shallower depth), try the move that was best then *first*.
2. **Captures / high-impact moves first** (MVV-LVA in chess: capture the most valuable piece with the least valuable attacker).
3. **Killer moves** — moves that caused a cutoff at the same depth in a sibling node.
4. **History heuristic** — moves that have historically caused cutoffs, scored cumulatively.
5. **Static positional bias** — center > corner > edge in tic-tac-toe; promotions, checks, etc. elsewhere.

The goal is simply to put a likely-best move first so the window tightens immediately.

### Pattern: Iterative deepening (search depth 1, then 2, then 3, …)

Counterintuitively, searching depths `1, 2, …, D` in sequence is *cheaper than it sounds* and *better than going straight to D*, because:

- The tree grows exponentially, so the cost of all shallower searches is a small fraction of the depth-`D` search (geometric series).
- Each shallow search fills the **transposition table** and the **best-move** info that orders the next, deeper search — making the deep search prune far better.
- It gives **anytime** behavior: stop whenever time runs out and return the best move from the deepest completed iteration.

### Pattern: Aspiration windows

Instead of starting each iteration with `(-∞, +∞)`, start with a narrow window around the previous iteration's value: `(v - δ, v + δ)`. If the true value falls inside, the narrow window prunes more aggressively. If it falls outside (a "fail"), re-search with a wider window. A small gamble that usually pays off.

---

## Negamax and Alpha-Beta

The MAX and MIN branches are mirror images. **Negamax** exploits the identity

```
min(a, b) = -max(-a, -b)
```

so you can write a *single* branch that always maximizes, by negating the child's returned value and swapping/negating the bounds. The evaluation function must return the score **from the perspective of the side to move** (not always MAX). Then:

```
negamax(p, depth, alpha, beta):
    if terminal(p) or depth == 0:
        return value_for_side_to_move(p)
    best = -inf
    for child of p (ordered):
        v = -negamax(child, depth-1, -beta, -alpha)   # negate value AND swap bounds
        best = max(best, v)
        alpha = max(alpha, v)
        if alpha >= beta: break
    return best
```

The bound swap `(-beta, -alpha)` is the crucial detail: the child sees the negated, mirrored window. This single-branch form has *half the code*, no MAX/MIN duplication to keep in sync, and is the version essentially every production engine uses. The price: your evaluation must be **symmetric** — `eval(p)` from one side equals `-eval(p)` from the other.

---

## Transposition Tables and Iterative Deepening

### Transpositions

Different move orders often reach the **same position**. In chess, `1.e4 e5 2.Nf3` and `1.Nf3 e5 2.e4` reach an identical board. Re-searching that subtree from scratch is pure waste. A **transposition table (TT)** is a hash map from a position to what you learned about it:

```
TTEntry = { value, depth, flag, best_move }
  flag ∈ { EXACT, LOWERBOUND, UPPERBOUND }
```

- **EXACT** — the value is the true minimax value (the search returned inside the window).
- **LOWERBOUND** — a beta cutoff happened; the true value is *at least* this (fail-high).
- **UPPERBOUND** — no move improved alpha; the true value is *at most* this (fail-low).

Before searching a node, probe the TT. If you have an entry at sufficient `depth`, you may return immediately (EXACT), or tighten `alpha`/`beta` (bounds), possibly triggering a cutoff. Always use the stored `best_move` to order moves even when you cannot cut. The position is keyed by a hash (Zobrist hashing — see [`senior.md`](./senior.md)).

### Iterative deepening + TT: the standard loop

```
for d in 1, 2, 3, ... until time runs out:
    value = alphabeta(root, d, -inf, +inf)   # TT carries best moves between iterations
    record best move from this completed depth
return best move from deepest completed depth
```

The TT makes each iteration order moves using the previous iteration's discoveries, so the *deeper* search prunes dramatically better — the reason iterative deepening with a TT is faster than a single direct deep search, despite "redoing" work.

### Quiescence search (overview)

A fixed depth limit can cut off in the middle of a tactical exchange, badly misevaluating (the **horizon effect**). **Quiescence search** extends the search at leaves along "noisy" moves only (captures, checks) until the position is "quiet", then applies the evaluation. It keeps the eval honest without exploding the full-width depth. Covered in depth in [`senior.md`](./senior.md).

---

## Code Examples

### Negamax with alpha-beta (the production-shaped core)

A generic negamax over an abstract game interface. Replace `terminal`, `evaluate`, `moves`, `make`, `unmake` for your game.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

const INF = math.MaxInt32

// Game is the abstract interface negamax needs.
type Game interface {
	Terminal() bool
	Evaluate() int // from the side-to-move's perspective
	Moves() []int
	Make(move int)
	Unmake(move int)
}

// negamax returns the value from the side-to-move's perspective.
func negamax(g Game, depth, alpha, beta int) int {
	if g.Terminal() || depth == 0 {
		return g.Evaluate()
	}
	best := -INF
	for _, m := range g.Moves() { // assume Moves() is already ordered
		g.Make(m)
		v := -negamax(g, depth-1, -beta, -alpha) // negate value, swap bounds
		g.Unmake(m)
		if v > best {
			best = v
		}
		if v > alpha {
			alpha = v
		}
		if alpha >= beta {
			break // cutoff
		}
	}
	return best
}

func main() {
	fmt.Println("negamax core compiled; plug in a Game implementation")
}
```

#### Java

```java
public class Negamax {
    static final int INF = Integer.MAX_VALUE / 2;

    interface Game {
        boolean terminal();
        int evaluate();      // from side-to-move's perspective
        int[] moves();       // assumed ordered
        void make(int move);
        void unmake(int move);
    }

    static int negamax(Game g, int depth, int alpha, int beta) {
        if (g.terminal() || depth == 0) return g.evaluate();
        int best = -INF;
        for (int m : g.moves()) {
            g.make(m);
            int v = -negamax(g, depth - 1, -beta, -alpha);
            g.unmake(m);
            if (v > best) best = v;
            if (v > alpha) alpha = v;
            if (alpha >= beta) break; // cutoff
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println("negamax core compiled; plug in a Game implementation");
    }
}
```

#### Python

```python
import math

INF = math.inf


def negamax(game, depth, alpha, beta):
    """Return value from the side-to-move's perspective.
    `game` must offer: terminal(), evaluate(), moves(), make(m), unmake(m)."""
    if game.terminal() or depth == 0:
        return game.evaluate()
    best = -INF
    for m in game.moves():            # assumed ordered
        game.make(m)
        v = -negamax(game, depth - 1, -beta, -alpha)  # negate value, swap bounds
        game.unmake(m)
        if v > best:
            best = v
        if v > alpha:
            alpha = v
        if alpha >= beta:
            break                     # cutoff
    return best
```

### Tic-tac-toe with a transposition table

A concrete negamax for tic-tac-toe, memoizing by a packed board key. Value is from the side-to-move's view, with depth folded in to prefer faster wins.

#### Python

```python
LINES = [(0,1,2),(3,4,5),(6,7,8),(0,3,6),(1,4,7),(2,5,8),(0,4,8),(2,4,6)]


def winner(b):
    for a, c, d in LINES:
        if b[a] != 0 and b[a] == b[c] == b[d]:
            return b[a]
    return 0


def key(b, player):
    # pack 9 cells (-1,0,1 -> 0,1,2) plus side-to-move into one int
    k = 0
    for c in b:
        k = k * 3 + (c + 1)
    return k * 2 + (1 if player == 1 else 0)


TT = {}


def negamax_ttt(b, player, depth, alpha, beta):
    w = winner(b)
    if w != 0:
        # side that just moved won -> bad for side to move now
        return -(10 - depth)           # faster wins score higher
    if all(c != 0 for c in b):
        return 0                        # draw

    kk = key(b, player)
    hit = TT.get(kk)
    if hit is not None and hit[1] >= depth:
        # stored value is exact for this fully-searched terminal-bounded game
        return hit[0]

    best = -math.inf
    for i in range(9):
        if b[i] == 0:
            b[i] = player
            v = -negamax_ttt(b, -player, depth + 1, -beta, -alpha)
            b[i] = 0
            if v > best:
                best = v
            if v > alpha:
                alpha = v
            if alpha >= beta:
                break
    TT[kk] = (best, depth)
    return best


if __name__ == "__main__":
    import math
    TT.clear()
    print("empty board value:", negamax_ttt([0]*9, 1, 0, -math.inf, math.inf))  # 0
```

#### Go

```go
package main

import "fmt"

var ttLines = [8][3]int{{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}}

func winnerTT(b []int) int {
	for _, l := range ttLines {
		if b[l[0]] != 0 && b[l[0]] == b[l[1]] && b[l[1]] == b[l[2]] {
			return b[l[0]]
		}
	}
	return 0
}

func keyTT(b []int, player int) int {
	k := 0
	for _, c := range b {
		k = k*3 + (c + 1)
	}
	bit := 0
	if player == 1 {
		bit = 1
	}
	return k*2 + bit
}

var tt = map[int][2]int{} // key -> {value, depth}

func negamaxTT(b []int, player, depth, alpha, beta int) int {
	if w := winnerTT(b); w != 0 {
		return -(10 - depth)
	}
	full := true
	for _, c := range b {
		if c == 0 {
			full = false
			break
		}
	}
	if full {
		return 0
	}
	kk := keyTT(b, player)
	if e, ok := tt[kk]; ok && e[1] >= depth {
		return e[0]
	}
	best := -1 << 30
	for i := 0; i < 9; i++ {
		if b[i] == 0 {
			b[i] = player
			v := -negamaxTT(b, -player, depth+1, -beta, -alpha)
			b[i] = 0
			if v > best {
				best = v
			}
			if v > alpha {
				alpha = v
			}
			if alpha >= beta {
				break
			}
		}
	}
	tt[kk] = [2]int{best, depth}
	return best
}

func main() {
	empty := make([]int, 9)
	fmt.Println("empty board value:", negamaxTT(empty, 1, 0, -1<<30, 1<<30)) // 0
}
```

#### Java

```java
import java.util.*;

public class TttNegamax {
    static final int[][] LINES = {{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}};
    static final Map<Integer, int[]> TT = new HashMap<>(); // key -> {value, depth}

    static int winner(int[] b) {
        for (int[] l : LINES)
            if (b[l[0]] != 0 && b[l[0]] == b[l[1]] && b[l[1]] == b[l[2]]) return b[l[0]];
        return 0;
    }

    static int key(int[] b, int player) {
        int k = 0;
        for (int c : b) k = k * 3 + (c + 1);
        return k * 2 + (player == 1 ? 1 : 0);
    }

    static int negamax(int[] b, int player, int depth, int alpha, int beta) {
        if (winner(b) != 0) return -(10 - depth);
        boolean full = true;
        for (int c : b) if (c == 0) { full = false; break; }
        if (full) return 0;
        int kk = key(b, player);
        int[] e = TT.get(kk);
        if (e != null && e[1] >= depth) return e[0];
        int best = Integer.MIN_VALUE / 2;
        for (int i = 0; i < 9; i++) {
            if (b[i] == 0) {
                b[i] = player;
                int v = -negamax(b, -player, depth + 1, -beta, -alpha);
                b[i] = 0;
                best = Math.max(best, v);
                alpha = Math.max(alpha, v);
                if (alpha >= beta) break;
            }
        }
        TT.put(kk, new int[]{best, depth});
        return best;
    }

    public static void main(String[] args) {
        System.out.println("empty board value: " +
            negamax(new int[9], 1, 0, Integer.MIN_VALUE / 2, Integer.MAX_VALUE / 2)); // 0
    }
}
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Negamax bound swap omitted | Passing `(alpha, beta)` instead of `(-beta, -alpha)` to the child. | Always negate *and* swap: `-negamax(child, d-1, -beta, -alpha)`. |
| Eval not symmetric | Evaluation returns MAX's view always, not side-to-move's. | In negamax, eval must be from the *side to move*; negate for the opponent. |
| TT returns wrong value | Stored a bound but used it as exact, ignoring the flag. | Honor the EXACT/LOWERBOUND/UPPERBOUND flag; only return early when valid. |
| TT collision corrupts result | Two positions share a hash key. | Store enough of the key (or a verification field) to detect collisions. |
| Iterative deepening discards work | Clearing the TT between iterations. | Keep the TT across iterations; that is the whole point. |
| Cutoff with wrong comparison | Using `>` where `>=` is needed (or vice versa). | `alpha >= beta` is the standard cutoff; be consistent. |
| Depth not folded into score | Engine delays a forced win indefinitely. | Encode plies into win/loss scores so faster wins rank higher. |

---

## Performance Analysis

| Depth `d` (b ≈ 8) | Plain minimax `b^d` | Alpha-beta best `b^(d/2)` | Speedup |
|-------------------|---------------------|---------------------------|---------|
| 4 | 4 096 | 64 | ~64× |
| 6 | 262 144 | 512 | ~512× |
| 8 | 16.7 M | 4 096 | ~4 000× |
| 10 | 1.07 G | 32 768 | ~32 000× |
| 12 | 68.7 G | 262 144 | ~260 000× |

The `b^(d/2)` best case is the practical ceiling, reached only with near-perfect move ordering. Real engines land between `b^(d/2)` and `b^(3d/4)`; the closer to `b^(d/2)`, the deeper they search in the same time. Transposition tables add a further (game-dependent) factor by collapsing duplicate subtrees, and iterative deepening's TT-seeded ordering is what pushes ordering quality toward the perfect-ordering ideal.

```text
Rule of thumb: each extra ply costs roughly a factor of b^(1/2) (≈ sqrt(b)) with
good ordering, versus a factor of b without pruning. Halving the exponent is the
difference between "sees 4 moves ahead" and "sees 8 moves ahead".
```

The dominant runtime cost is the evaluation function (called at every leaf) plus move generation. Optimizing those constant factors matters as much as the asymptotics once ordering is good.

---

## Best Practices

- **Use negamax**, not separate MAX/MIN branches — half the code, far fewer sign bugs. Make your eval symmetric.
- **Invest in move ordering first.** TT best-move, then captures/killers/history. It dominates every other speedup.
- **Always keep a transposition table across iterations** of iterative deepening; never clear it between depths.
- **Honor TT entry flags** (EXACT/LOWERBOUND/UPPERBOUND) and store the `best_move` for ordering.
- **Fold depth into win/loss scores** so the engine prefers quick wins and slow losses.
- **Verify against full minimax** on small games (tic-tac-toe): alpha-beta, negamax, and minimax must all return the same value.
- **Add quiescence search** before trusting a fixed-depth evaluation in tactical games (see [`senior.md`](./senior.md)).

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The `(alpha, beta)` window propagating down and tightening as values return.
> - Beta cutoffs at MAX nodes and alpha cutoffs at MIN nodes, with the pruned siblings greyed out.
> - A running count of leaves examined vs leaves saved, illustrating the `b^(d/2)` effect of good ordering.

---

## Summary

Alpha-beta is minimax plus a search window `(alpha, beta)` that records what each player is already guaranteed; whenever the window crosses (`alpha >= beta`) the remaining siblings cannot change the decision and are pruned — losslessly. **Negamax** collapses the mirror-image MAX/MIN branches into a single maximizing branch by negating the child value and swapping the bounds to `(-beta, -alpha)`, requiring a side-to-move-relative evaluation. The benefit of pruning hinges entirely on **move ordering**: perfect ordering reaches the `O(b^(d/2))` best case, effectively doubling search depth. **Transposition tables** memoize positions reachable by multiple move orders, returning stored exact values or tightening bounds; **iterative deepening** searches depth 1, 2, 3, … and uses each iteration's TT best-moves to order the next, deeper, better-pruned search, while giving anytime behavior. **Quiescence search** patches the horizon effect by extending tactical lines past the fixed depth. Master negamax + ordering + TT + iterative deepening and you have the skeleton of a real game engine.
