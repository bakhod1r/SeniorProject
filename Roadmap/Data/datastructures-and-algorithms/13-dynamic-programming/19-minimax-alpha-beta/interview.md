# Minimax and Alpha-Beta Pruning — Interview Preparation

Adversarial search is a favourite interview topic because it rewards a small set of crisp insights — *"minimax = MAX maximizes, MIN minimizes, recursing down the game tree"*, *"alpha-beta prunes branches that cannot change the result, losslessly"*, *"good move ordering gives `O(b^(d/2))`"* — and then tests whether you can (a) implement it cleanly with backtracking, (b) add alpha-beta without changing the value, (c) recognize when a game has closed-form structure (Nim) versus needing a tree search, and (d) avoid the classic traps (forgetting to undo a move, swapping MAX/MIN, mishandling the negamax bound swap). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Value under perfect play | minimax | `O(b^d)` |
| Same value, faster | alpha-beta (cut when `alpha >= beta`) | `O(b^(d/2))` best, `O(b^d)` worst |
| One branch instead of MAX/MIN | negamax (`-search(child, -beta, -alpha)`) | same |
| Stop before game end | depth limit + `eval()` | `O(b^depth)` |
| Skip duplicate positions | transposition table (hash → value/bound/depth) | game-dependent reduction |
| Unknown time budget | iterative deepening (depth 1,2,3,…) | anytime |
| Avoid horizon effect | quiescence search (extend captures) | bounded extra |
| Take-away game (Nim) | Sprague-Grundy / XOR | `O(1)`–`O(n)`, no tree |

Core algorithm (negamax + alpha-beta):

```text
negamax(node, depth, alpha, beta):     # value from side-to-move's view
    if terminal(node) or depth == 0:
        return eval(node)               # eval is side-to-move relative
    best = -INF
    for move in ordered_moves(node):
        make(move)
        v = -negamax(child, depth-1, -beta, -alpha)   # negate value AND swap bounds
        unmake(move)
        best = max(best, v)
        alpha = max(alpha, v)
        if alpha >= beta: break         # cutoff
    return best
```

Key facts:
- **Alpha** = best MAX is already guaranteed; **beta** = best MIN is already guaranteed. Cut when they cross.
- Alpha-beta returns the **exact same** value as minimax — never an approximation.
- **Move ordering** decides pruning: best move first → `O(b^(d/2))`.
- Tic-tac-toe empty board value is **0** (perfect play draws).
- Fold depth into win/loss scores so the engine prefers **faster wins, slower losses**.

---

## Junior Questions (12 Q&A)

### J1. What is the minimax value of a position?
The score you can force from that position assuming both players play optimally. MAX (you) picks moves to maximize the score; MIN (opponent) picks moves to minimize it. The value bubbles up from the leaves of the game tree.

### J2. What does "zero-sum" mean and why does it matter?
One player's gain equals the other's loss, so a single number describes the contested outcome. It is what lets minimax use one value per node: whatever MAX wants to maximize, MIN equally wants to minimize.

### J3. What is the game tree?
A tree of all reachable positions: the root is the current position, edges are legal moves, children are resulting positions, and leaves are finished games (or depth-limited cutoffs). Layers alternate MAX-to-move and MIN-to-move.

### J4. Why is plain minimax `O(b^d)`?
`b` is the branching factor (moves per position), `d` the depth (plies). Each node spawns up to `b` children, `d` levels deep, so up to `b^d` leaves. It is exponential in depth.

### J5. What is an evaluation function and when do you need it?
A heuristic that estimates a position's value when you stop searching before the game ends (e.g., material count in chess). You need it for large games where reaching terminal leaves is infeasible; you call it at the depth limit.

### J6. What is alpha-beta pruning in one sentence?
It tracks the best each player is already guaranteed (`alpha` for MAX, `beta` for MIN) and skips any branch that cannot change the final value — returning the identical minimax value, just faster.

### J7. Does alpha-beta change the answer?
No. It returns exactly the same minimax value as the full search. It only avoids exploring nodes whose values provably cannot affect the result. If your alpha-beta disagrees with plain minimax, you have a bug.

### J8. What is the backtracking pattern in minimax?
Make a move (mutate the board), recurse, then undo the move (restore the board). This explores moves cheaply on one shared board instead of copying it at every node. Forgetting the undo corrupts the search.

### J9. What is the minimax value of an empty tic-tac-toe board?
`0` — a draw. With perfect play by both sides, tic-tac-toe always draws. Expecting the first player to win is a common misconception.

### J10. Why must you check "winner" before "board full"?
A board can be full *and* have a winner (the last move completed a line). Checking "full" first would misreport that win as a draw. Always test the win condition first.

### J11. What does the depth limit trade off?
Search speed vs accuracy. A shallower limit is faster but may miss consequences just beyond the horizon; a deeper limit is more accurate but exponentially slower. The evaluation function fills in for the unseen future.

### J12 (analysis). With branching factor `b` and depth `d`, how much can good move ordering help alpha-beta?
In the best case it reduces leaves examined from `b^d` to about `b^(d/2)` — the square root. That effectively *doubles* the depth you can search in the same time. Ordering is the single most important practical factor.

---

## Middle Questions (12 Q&A)

### M1. Walk through why an alpha-beta cutoff is safe.
At a MAX node, once a child's value reaches `beta`, MIN higher up already has a way to hold the score to `beta` (that is what set `beta`), so MIN will never enter this subtree. The remaining children can only raise MAX's value further above `beta`, which MIN will avoid — so they are irrelevant and we cut.

### M2. What is negamax and why use it?
Negamax exploits `min(a,b) = -max(-a,-b)` to write a single maximizing branch instead of mirrored MAX/MIN branches. You negate the child's value and swap the bounds: `-negamax(child, -beta, -alpha)`. Half the code, far fewer sign bugs. The eval must be from the side-to-move's perspective.

### M3. What exactly do you pass to the child in negamax?
`-negamax(child, depth-1, -beta, -alpha)`. Both the value is negated *and* the bounds are swapped and negated. Forgetting the bound swap is the classic negamax bug.

### M4. How does move ordering interact with alpha-beta?
Pruning only happens when bounds tighten, and bounds tighten fastest when the best move is tried first. Perfect ordering → `O(b^(d/2))`; random → ~`O(b^(3d/4))`; worst → `O(b^d)`. So you order moves with heuristics (TT best move, captures, killers, history) before knowing their true values.

### M5. What is a transposition table and what does it store?
A hash map from position to `{value, depth, flag, best_move}`, where flag is EXACT / LOWERBOUND / UPPERBOUND. It memoizes positions reachable by different move orders so you do not re-search them. The flag tells you whether the stored value is exact or just a bound.

### M6. Why are there bound flags (LOWER/UPPER) and not just exact values?
Because alpha-beta cutoffs return *bounds*, not exact values. A beta cutoff proves "value ≥ X" (LOWERBOUND); failing to raise alpha proves "value ≤ X" (UPPERBOUND). You can only return early on EXACT; bounds are used to tighten alpha/beta.

### M7. What is iterative deepening and why is it not wasteful?
Search depth 1, then 2, then 3, … until time runs out. Because the tree grows exponentially, the shallow searches are a small fraction of the deep one (geometric series). Crucially, each iteration fills the TT with best moves that order the next iteration, so the deep search prunes far better.

### M8. How do you make the engine prefer faster wins?
Fold depth into terminal scores: a win at shallow depth scores higher than a win at deep depth (e.g., return `+(BIG - plies)`), and a loss deep scores higher than a loss soon. Otherwise the engine sees all wins as equal and may dawdle.

### M9. What is the horizon effect?
A fixed-depth search misvalues a position when a big swing is one ply past the cutoff (e.g., it thinks it is up material without seeing the recapture). The engine can even push bad news past the horizon with delaying moves. Quiescence search fixes it.

### M10. What is quiescence search?
At a leaf, instead of evaluating immediately, keep searching only "noisy" moves (captures, checks) until the position is quiet, then evaluate. The "stand-pat" value (option to not capture) bounds the recursion. It keeps the leaf evaluation honest in tactical positions.

### M11. When does a game NOT need a tree search?
When it has closed-form structure. Nim and other impartial take-away games are solved by Sprague-Grundy theory (XOR of pile Grundy values) in `O(1)`–`O(n)` — no minimax tree needed. Recognizing this (siblings `14-nim`, `15-sprague-grundy`) avoids an unnecessary exponential search.

### M12 (analysis). Why is alpha-beta's worst case still `O(b^d)`?
If moves are ordered worst-first, no cutoff ever fires — every child is examined at every node, exactly like plain minimax. Pruning is a best/average-case improvement that depends on ordering; the worst case is unchanged.

---

## Senior Questions (10 Q&A)

### S1. How do you key a transposition table efficiently?
Zobrist hashing: precompute random 64-bit numbers per (piece, square) and for side-to-move; the position key is their XOR. Update it incrementally with make/unmake (XOR out the old, XOR in the new) in `O(1)`. Index a power-of-two table by the low bits; store the full key (or extra bits) to detect collisions.

### S2. What is search instability and is it a bug?
Re-searching a position (different window, TT state, or order) can return a different value or move. It is often *benign*: cutoffs return bounds, and TT/PVS re-searches can change the chosen move while the root value stays correct. It is *malignant* only if the root value at the same depth differs with TT on vs off — that signals a real flag/depth-handling bug.

### S3. When is null-move pruning unsound?
In zugzwang positions (common in pawn endgames), where being forced to move is itself a disadvantage — so the assumption "passing is never beneficial" fails. Disable null-move when material is low and verify with a reduced-depth re-search.

### S4. How do you manage time under a clock?
Iterative deepening gives the anytime property. Use a soft limit to decide whether to *start* another iteration (skip if it likely will not finish) and a hard limit to *abort* mid-iteration, always returning the last completed iteration's move. Keep a safety margin and check the clock every N nodes, never lose on time.

### S5. Why is alpha-beta hard to parallelize?
Pruning is inherently sequential — you need the first move's result to set the window that prunes the rest. Lazy SMP is the pragmatic default: run threads on the same position sharing one TT with varied orderings; they cross-pollinate via the TT. Speedup is sublinear because of search overhead.

### S6. How do you test a search engine whose output is one move?
Compare alpha-beta value against plain minimax on small games (must match — lossless pruning). Compare TT-on vs TT-off at the same depth. Compare negamax vs separate MAX/MIN. Use perft (node counts) to validate move generation. For *strength* changes, run an SPRT self-play match — never eyeball whether a heuristic helped.

### S7. What is the effective branching factor and what should it be?
`EBF = nodes(d) / nodes(d-1)`. With good ordering it approaches `√b` (the `O(b^(d/2))` ideal); near `b` means ordering is poor. It is a key observability metric: a rising EBF signals an ordering regression.

### S8. PV search (PVS) — what is the idea and the pitfall?
Assume the first move is best: search it with a full window, then search the rest with a null window `(alpha, alpha+1)` to cheaply prove they are worse. If a null-window search fails high, you must **re-search** that move with the full window. Forgetting the re-search is a common bug that makes the engine reject a genuinely better move.

### S9. How does the search space differ between the game tree and the game graph?
Many move orders reach the same position (transpositions), so the real space is a DAG (the game graph), often vastly smaller than the tree. The TT exploits exactly this gap by memoizing positions; it reduces searched nodes from tree size toward DAG size — a game-dependent win not captured by `b^d`.

### S10 (analysis). Why can deeper search sometimes hurt (game-tree pathology)?
On artificial games with independent random leaf values, errors compound through the min/max operators so deeper minimax can play *worse*. Real games avoid this because positions are correlated (good stays good), so deeper helps. The takeaway: "deeper is better" is an empirical property of real evaluation functions, not a theorem about minimax.

---

## Professional Questions (8 Q&A)

### P1. Sketch the proof that alpha-beta returns the exact minimax value.
Induction on subtree height. Leaves return their utility. At a MAX node with `alpha < V(v) < beta`: show no cutoff can fire (a cutoff would require a child value `≥ beta`, implying `V(v) ≥ beta`, contradicting the hypothesis), so all children are examined; the child attaining `V(v)` is searched with an open window and returns exactly `V(v)` by the inductive hypothesis. MIN is symmetric. At the root with `(-∞, +∞)` the hypothesis holds trivially, so the root value is exact.

### P2. Derive the `O(b^(d/2))` best-case bound.
Classify nodes as Type-1 (PV, examine all children), Type-2 (CUT, first child suffices), Type-3 (ALL, examine all). The recurrences `L1(h)=L1(h-1)+(b-1)L2(h-1)`, `L2(h)=L3(h-1)`, `L3(h)=b·L2(h-1)` give `L2(h)=b^(h/2)` (grows by `b` every *two* levels), yielding `b^⌈d/2⌉ + b^⌊d/2⌋ - 1` total leaves — effective branching factor `√b`.

### P3. Is alpha-beta optimal?
Among directional algorithms (left-to-right, no cross-subtree memoization), yes: it examines the minimal **proof tree**, whose leaf count is exactly the Knuth-Moore `b^⌈d/2⌉ + b^⌊d/2⌋ - 1`. Any algorithm examining fewer leaves leaves a proof-tree leaf unevaluated, which an adversary can set to flip the value.

### P4. Prove negamax computes the same value as MAX/MIN minimax.
Define side-relative value `N(v) = V(v)` at MAX nodes, `-V(v)` at MIN nodes. For a MAX node, `N(v)=max_c V(c)=max_c(-N(c))` since children are MIN with `N(c)=-V(c)`. For a MIN node, `N(v)=-min_c V(c)=max_c(-V(c))=max_c(-N(c))` since children are MAX with `N(c)=V(c)`. Both give `N(v)=max_c(-N(c))`, the negamax recurrence. The window maps `(α,β)→(-β,-α)`.

### P5. Why is storing a *bound* in the TT sound?
A cutoff does not establish `V(v)`; it certifies a bound (`V(v) ≥ beta` for a beta cutoff). That bound is exactly enough for the parent's decision (the parent already has a better alternative). Storing it with a LOWER/UPPER flag and using it only to tighten `alpha`/`beta` (never as exact) preserves correctness, with a depth guard so a shallow bound is not reused for a deeper requirement.

### P6. What complexity class is deciding a general game's value?
For generalized board games on `n×n` boards it is PSPACE-complete or EXPTIME-complete depending on the rules. Alpha-beta does not change this — it improves the constant in the exponent (`d/2` vs `d`), decisive in practice but not asymptotically.

### P7. How do transposition tables change the theoretical search space?
They turn the search tree into the game DAG by merging identical positions. The value recurrence is unchanged (merged nodes have identical subtrees). The searched node count drops from tree size toward DAG size — game-dependent and not expressible as `b^d`. Iterative deepening's TT-seeded ordering additionally pushes the effective branching factor toward `√b`.

### P8 (analysis). Why does a depth limit forfeit optimality, and what restores partial trust?
With a heuristic `eval` at the frontier, `V_d(r) = V(r)` only if `eval` equals the true value there — generally false, so the selected move may be suboptimal. Quiescence search restores partial trust by extending forcing lines until `eval` is applied only to quiet positions, provably reducing the tactical (capture-sequence) class of misvaluations even though no theorem eliminates all error.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you sped up an exponential search.
Look for a concrete story: a tree/game search where the naive `O(b^d)` dominated, the insight to add alpha-beta and *move ordering* (or a transposition table), and the measured speedup (e.g., reaching depth 8 instead of 4). Strong answers cite verifying the value was unchanged against the slow version, and instrumenting the effective branching factor / first-move-cutoff rate.

### B2. A teammate's alpha-beta returns a different value than the old minimax. How do you handle it?
Calmly state that alpha-beta is provably lossless, so a value difference is a bug, not a feature. Help them diff against plain minimax on tiny positions, then check the usual suspects: a swapped MAX/MIN, a missing negamax bound swap, or a TT entry used as exact when it is only a bound. Frame it as a debugging session with a known-correct oracle.

### B3. Design an AI opponent for a turn-based mobile game.
Discuss difficulty tuning (depth limit and eval quality as knobs), iterative deepening with a time budget so it responds within a frame, a transposition table sized to the device's memory, and quiescence if the game is tactical. Mention that for weak difficulty you may intentionally pick a sub-optimal move, and that you verify correctness against a full search on small boards.

### B4. How would you explain alpha-beta to a junior?
Use the interview analogy: once a candidate answers worse than someone you already accepted, you stop interviewing them — no later answer changes your decision. That is a cutoff. Then stress the two invariants: it returns the *same* value as full search, and its speed depends on trying the best move first. Lead with the pitfalls (undo your move, keep MAX/MIN straight).

### B5. Your game AI occasionally loses on time. How do you investigate?
Confirm iterative deepening uses a *soft* limit to gate new iterations and a *hard* limit to abort, always returning the last completed move. Check the clock-poll granularity (every N nodes, not every node) and the safety margin for move overhead. Profile whether a single iteration blows the budget (eval too slow, or an extension exploding), and add a panic-time policy for sudden score drops.

---

## Coding Challenges

### Challenge 1: Tic-Tac-Toe Optimal Move (Minimax)

**Problem.** Given a tic-tac-toe board (length-9 array, `1` = X/MAX, `-1` = O/MIN, `0` = empty) and whose turn it is, return the index of an optimal move and the resulting minimax value (from X's perspective). Search to the end of the game.

**Example.**
```text
board = [1,0,0, 0,-1,0, 0,0,0], player = 1  ->  some optimal X move, value 0 (draw)
empty board, player = 1                      ->  value 0 (perfect play draws)
```

**Constraints.** Standard `3×3` board; full search (tree ≤ 9!).

**Optimal.** Minimax with backtracking, plus depth folded in to prefer faster wins.

**Go.**
```go
package main

import "fmt"

var lines = [8][3]int{{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}}

func winner(b []int) int {
	for _, l := range lines {
		if b[l[0]] != 0 && b[l[0]] == b[l[1]] && b[l[1]] == b[l[2]] {
			return b[l[0]]
		}
	}
	return 0
}

func full(b []int) bool {
	for _, c := range b {
		if c == 0 {
			return false
		}
	}
	return true
}

// returns value from X's perspective; depth folded in to prefer fast wins.
func minimax(b []int, player, depth int) int {
	if w := winner(b); w != 0 {
		return w * (10 - depth) // faster win = larger magnitude
	}
	if full(b) {
		return 0
	}
	if player == 1 { // MAX
		best := -1000
		for i := 0; i < 9; i++ {
			if b[i] == 0 {
				b[i] = 1
				if v := minimax(b, -1, depth+1); v > best {
					best = v
				}
				b[i] = 0
			}
		}
		return best
	}
	best := 1000
	for i := 0; i < 9; i++ {
		if b[i] == 0 {
			b[i] = -1
			if v := minimax(b, 1, depth+1); v < best {
				best = v
			}
			b[i] = 0
		}
	}
	return best
}

func bestMove(b []int, player int) (int, int) {
	bestI, bestV := -1, -1000*player
	for i := 0; i < 9; i++ {
		if b[i] == 0 {
			b[i] = player
			v := minimax(b, -player, 1)
			b[i] = 0
			if (player == 1 && v > bestV) || (player == -1 && v < bestV) {
				bestV, bestI = v, i
			}
		}
	}
	return bestI, bestV
}

func main() {
	empty := make([]int, 9)
	i, v := bestMove(empty, 1)
	fmt.Printf("best move = %d, value = %d\n", i, v) // value 0
}
```

**Java.**
```java
public class TttBestMove {
    static final int[][] LINES = {{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}};

    static int winner(int[] b) {
        for (int[] l : LINES)
            if (b[l[0]] != 0 && b[l[0]] == b[l[1]] && b[l[1]] == b[l[2]]) return b[l[0]];
        return 0;
    }

    static boolean full(int[] b) {
        for (int c : b) if (c == 0) return false;
        return true;
    }

    static int minimax(int[] b, int player, int depth) {
        int w = winner(b);
        if (w != 0) return w * (10 - depth);
        if (full(b)) return 0;
        if (player == 1) {
            int best = -1000;
            for (int i = 0; i < 9; i++)
                if (b[i] == 0) { b[i] = 1; best = Math.max(best, minimax(b, -1, depth + 1)); b[i] = 0; }
            return best;
        } else {
            int best = 1000;
            for (int i = 0; i < 9; i++)
                if (b[i] == 0) { b[i] = -1; best = Math.min(best, minimax(b, 1, depth + 1)); b[i] = 0; }
            return best;
        }
    }

    static int[] bestMove(int[] b, int player) {
        int bestI = -1, bestV = -1000 * player;
        for (int i = 0; i < 9; i++) {
            if (b[i] == 0) {
                b[i] = player;
                int v = minimax(b, -player, 1);
                b[i] = 0;
                if ((player == 1 && v > bestV) || (player == -1 && v < bestV)) { bestV = v; bestI = i; }
            }
        }
        return new int[]{bestI, bestV};
    }

    public static void main(String[] args) {
        int[] r = bestMove(new int[9], 1);
        System.out.println("best move = " + r[0] + ", value = " + r[1]); // value 0
    }
}
```

**Python.**
```python
LINES = [(0,1,2),(3,4,5),(6,7,8),(0,3,6),(1,4,7),(2,5,8),(0,4,8),(2,4,6)]


def winner(b):
    for a, c, d in LINES:
        if b[a] != 0 and b[a] == b[c] == b[d]:
            return b[a]
    return 0


def minimax(b, player, depth):
    w = winner(b)
    if w != 0:
        return w * (10 - depth)        # faster win = larger magnitude
    if all(c != 0 for c in b):
        return 0
    if player == 1:                    # MAX
        best = -1000
        for i in range(9):
            if b[i] == 0:
                b[i] = 1
                best = max(best, minimax(b, -1, depth + 1))
                b[i] = 0
        return best
    best = 1000
    for i in range(9):
        if b[i] == 0:
            b[i] = -1
            best = min(best, minimax(b, 1, depth + 1))
            b[i] = 0
    return best


def best_move(b, player):
    best_i, best_v = -1, -1000 * player
    for i in range(9):
        if b[i] == 0:
            b[i] = player
            v = minimax(b, -player, 1)
            b[i] = 0
            if (player == 1 and v > best_v) or (player == -1 and v < best_v):
                best_v, best_i = v, i
    return best_i, best_v


if __name__ == "__main__":
    print(best_move([0]*9, 1))  # (some move, 0)
```

---

### Challenge 2: Tic-Tac-Toe with Alpha-Beta (same value, fewer nodes)

**Problem.** Add alpha-beta pruning to the tic-tac-toe minimax and count the number of nodes visited, to demonstrate the speedup. The returned value must be identical to plain minimax.

**Optimal.** Alpha-beta with a node counter; verify the value matches Challenge 1.

**Go.**
```go
package main

import "fmt"

var lines2 = [8][3]int{{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}}
var nodes int

func win2(b []int) int {
	for _, l := range lines2 {
		if b[l[0]] != 0 && b[l[0]] == b[l[1]] && b[l[1]] == b[l[2]] {
			return b[l[0]]
		}
	}
	return 0
}

func ab(b []int, player, depth, alpha, beta int) int {
	nodes++
	if w := win2(b); w != 0 {
		return w * (10 - depth)
	}
	fullB := true
	for _, c := range b {
		if c == 0 {
			fullB = false
		}
	}
	if fullB {
		return 0
	}
	if player == 1 { // MAX
		best := -1000
		for i := 0; i < 9; i++ {
			if b[i] == 0 {
				b[i] = 1
				v := ab(b, -1, depth+1, alpha, beta)
				b[i] = 0
				if v > best {
					best = v
				}
				if best > alpha {
					alpha = best
				}
				if alpha >= beta {
					break // beta cutoff
				}
			}
		}
		return best
	}
	best := 1000
	for i := 0; i < 9; i++ {
		if b[i] == 0 {
			b[i] = -1
			v := ab(b, 1, depth+1, alpha, beta)
			b[i] = 0
			if v < best {
				best = v
			}
			if best < beta {
				beta = best
			}
			if beta <= alpha {
				break // alpha cutoff
			}
		}
	}
	return best
}

func main() {
	empty := make([]int, 9)
	nodes = 0
	v := ab(empty, 1, 0, -1000, 1000)
	fmt.Printf("value = %d, nodes visited = %d\n", v, nodes) // value 0, far fewer than ~549946
}
```

**Java.**
```java
public class TttAlphaBeta {
    static final int[][] LINES = {{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}};
    static long nodes = 0;

    static int winner(int[] b) {
        for (int[] l : LINES)
            if (b[l[0]] != 0 && b[l[0]] == b[l[1]] && b[l[1]] == b[l[2]]) return b[l[0]];
        return 0;
    }

    static int ab(int[] b, int player, int depth, int alpha, int beta) {
        nodes++;
        int w = winner(b);
        if (w != 0) return w * (10 - depth);
        boolean full = true;
        for (int c : b) if (c == 0) full = false;
        if (full) return 0;
        if (player == 1) {
            int best = -1000;
            for (int i = 0; i < 9; i++) {
                if (b[i] == 0) {
                    b[i] = 1;
                    best = Math.max(best, ab(b, -1, depth + 1, alpha, beta));
                    b[i] = 0;
                    alpha = Math.max(alpha, best);
                    if (alpha >= beta) break;
                }
            }
            return best;
        } else {
            int best = 1000;
            for (int i = 0; i < 9; i++) {
                if (b[i] == 0) {
                    b[i] = -1;
                    best = Math.min(best, ab(b, 1, depth + 1, alpha, beta));
                    b[i] = 0;
                    beta = Math.min(beta, best);
                    if (beta <= alpha) break;
                }
            }
            return best;
        }
    }

    public static void main(String[] args) {
        nodes = 0;
        int v = ab(new int[9], 1, 0, -1000, 1000);
        System.out.println("value = " + v + ", nodes visited = " + nodes); // value 0
    }
}
```

**Python.**
```python
LINES = [(0,1,2),(3,4,5),(6,7,8),(0,3,6),(1,4,7),(2,5,8),(0,4,8),(2,4,6)]
nodes = 0


def winner(b):
    for a, c, d in LINES:
        if b[a] != 0 and b[a] == b[c] == b[d]:
            return b[a]
    return 0


def ab(b, player, depth, alpha, beta):
    global nodes
    nodes += 1
    w = winner(b)
    if w != 0:
        return w * (10 - depth)
    if all(c != 0 for c in b):
        return 0
    if player == 1:                       # MAX
        best = -1000
        for i in range(9):
            if b[i] == 0:
                b[i] = 1
                best = max(best, ab(b, -1, depth + 1, alpha, beta))
                b[i] = 0
                alpha = max(alpha, best)
                if alpha >= beta:
                    break                 # beta cutoff
        return best
    best = 1000
    for i in range(9):
        if b[i] == 0:
            b[i] = -1
            best = min(best, ab(b, 1, depth + 1, alpha, beta))
            b[i] = 0
            beta = min(beta, best)
            if beta <= alpha:
                break                     # alpha cutoff
    return best


if __name__ == "__main__":
    v = ab([0]*9, 1, 0, -1000, 1000)
    print(f"value = {v}, nodes visited = {nodes}")  # value 0, far fewer nodes than full minimax
```

---

### Challenge 3: Nim — Optimal Play (Stone Game)

**Problem.** Classic Nim: several piles of stones; players alternate removing any positive number of stones from a single pile; the player who takes the last stone **wins**. Given the pile sizes, decide whether the player to move wins under optimal play, and (via minimax for verification) confirm the result on small inputs.

**Key insight.** Nim has a closed form: the position is a **loss for the player to move iff the XOR of all pile sizes is 0** (Sprague-Grundy theory, siblings `14-nim`/`15-sprague-grundy`). We show both the `O(n)` XOR solution and a minimax solver that must agree on small inputs.

**Example.**
```text
piles = [3,4,5]  -> XOR = 3^4^5 = 2 != 0 -> current player WINS
piles = [1,2,3]  -> XOR = 1^2^3 = 0       -> current player LOSES
```

**Go.**
```go
package main

import "fmt"

// O(n) closed form: current player wins iff XOR != 0.
func nimWinsFast(piles []int) bool {
	x := 0
	for _, p := range piles {
		x ^= p
	}
	return x != 0
}

// Minimax verifier (exponential; small inputs only). Returns true if player to move wins.
func nimWinsMinimax(piles []int) bool {
	allZero := true
	for _, p := range piles {
		if p > 0 {
			allZero = false
		}
	}
	if allZero {
		return false // no stones to take -> previous player took last -> we lose
	}
	for i := range piles {
		for take := 1; take <= piles[i]; take++ {
			piles[i] -= take
			lose := nimWinsMinimax(piles) // opponent's result
			piles[i] += take
			if !lose {
				return true // a move that makes opponent lose
			}
		}
	}
	return false
}

func main() {
	fmt.Println(nimWinsFast([]int{3, 4, 5}))    // true
	fmt.Println(nimWinsFast([]int{1, 2, 3}))    // false
	fmt.Println(nimWinsMinimax([]int{3, 4, 5})) // true (agrees)
	fmt.Println(nimWinsMinimax([]int{1, 2, 3})) // false (agrees)
}
```

**Java.**
```java
public class NimGame {
    static boolean nimWinsFast(int[] piles) {
        int x = 0;
        for (int p : piles) x ^= p;
        return x != 0;
    }

    static boolean nimWinsMinimax(int[] piles) {
        boolean allZero = true;
        for (int p : piles) if (p > 0) allZero = false;
        if (allZero) return false;
        for (int i = 0; i < piles.length; i++) {
            for (int take = 1; take <= piles[i]; take++) {
                piles[i] -= take;
                boolean opp = nimWinsMinimax(piles);
                piles[i] += take;
                if (!opp) return true;
            }
        }
        return false;
    }

    public static void main(String[] args) {
        System.out.println(nimWinsFast(new int[]{3, 4, 5}));    // true
        System.out.println(nimWinsFast(new int[]{1, 2, 3}));    // false
        System.out.println(nimWinsMinimax(new int[]{3, 4, 5})); // true
        System.out.println(nimWinsMinimax(new int[]{1, 2, 3})); // false
    }
}
```

**Python.**
```python
from functools import reduce
from operator import xor


def nim_wins_fast(piles):
    """O(n): current player wins iff XOR of pile sizes != 0."""
    return reduce(xor, piles, 0) != 0


def nim_wins_minimax(piles):
    """Exponential verifier; returns True if the player to move wins."""
    if all(p == 0 for p in piles):
        return False                      # no move -> we lose (opponent took last)
    for i in range(len(piles)):
        for take in range(1, piles[i] + 1):
            piles[i] -= take
            opp = nim_wins_minimax(piles)
            piles[i] += take
            if not opp:                   # opponent loses after our move
                return True
    return False


if __name__ == "__main__":
    print(nim_wins_fast([3, 4, 5]))     # True
    print(nim_wins_fast([1, 2, 3]))     # False
    print(nim_wins_minimax([3, 4, 5]))  # True (agrees with closed form)
    print(nim_wins_minimax([1, 2, 3]))  # False (agrees)
```

---

### Challenge 4: Generic Negamax with Alpha-Beta (Stone-Subtraction Game)

**Problem.** A subtraction game: a single pile of `n` stones; on each turn a player removes `1`, `2`, or `3` stones; the player who takes the last stone **wins**. Implement a generic negamax-with-alpha-beta that returns `+1` if the player to move wins, `-1` if they lose. Verify against the closed form (lose iff `n % 4 == 0`).

**Go.**
```go
package main

import "fmt"

// negamax: value from the perspective of the player to move at pile size n.
// +1 = win, -1 = loss. Memoized to keep it fast.
var memo = map[int]int{}

func negamax(n, alpha, beta int) int {
	if n == 0 {
		return -1 // no stones: the player to move just lost (opponent took last)
	}
	if v, ok := memo[n]; ok {
		return v
	}
	best := -2
	for take := 1; take <= 3 && take <= n; take++ {
		v := -negamax(n-take, -beta, -alpha) // negate value, swap bounds
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
	if best > 0 {
		best = 1
	} else {
		best = -1
	}
	memo[n] = best
	return best
}

func main() {
	for n := 0; n <= 8; n++ {
		got := negamax(n, -2, 2)
		closed := -1
		if n%4 != 0 {
			closed = 1
		}
		fmt.Printf("n=%d negamax=%d closed=%d match=%v\n", n, got, closed, got == closed)
	}
}
```

**Java.**
```java
import java.util.*;

public class SubtractionGame {
    static final Map<Integer, Integer> memo = new HashMap<>();

    // value from side-to-move's perspective: +1 win, -1 loss
    static int negamax(int n, int alpha, int beta) {
        if (n == 0) return -1;
        Integer cached = memo.get(n);
        if (cached != null) return cached;
        int best = -2;
        for (int take = 1; take <= 3 && take <= n; take++) {
            int v = -negamax(n - take, -beta, -alpha);
            best = Math.max(best, v);
            alpha = Math.max(alpha, v);
            if (alpha >= beta) break;
        }
        best = best > 0 ? 1 : -1;
        memo.put(n, best);
        return best;
    }

    public static void main(String[] args) {
        for (int n = 0; n <= 8; n++) {
            int got = negamax(n, -2, 2);
            int closed = (n % 4 != 0) ? 1 : -1;
            System.out.printf("n=%d negamax=%d closed=%d match=%b%n", n, got, closed, got == closed);
        }
    }
}
```

**Python.**
```python
from functools import lru_cache


@lru_cache(maxsize=None)
def negamax(n, alpha, beta):
    """Value from side-to-move's view: +1 win, -1 loss. Subtraction game (take 1..3)."""
    if n == 0:
        return -1                          # no move -> player to move lost
    best = -2
    for take in range(1, min(3, n) + 1):
        v = -negamax(n - take, -beta, -alpha)   # negate value, swap bounds
        best = max(best, v)
        alpha = max(alpha, v)
        if alpha >= beta:
            break
    return 1 if best > 0 else -1


if __name__ == "__main__":
    for n in range(9):
        got = negamax(n, -2, 2)
        closed = 1 if n % 4 != 0 else -1
        print(f"n={n} negamax={got} closed={closed} match={got == closed}")
```

---

## Final Tips

- Lead with the one-liner: *"Minimax = MAX maximizes, MIN minimizes down the game tree; alpha-beta prunes branches that cannot change the result, losslessly, in `O(b^(d/2))` with good move ordering."*
- Immediately flag the invariants: **alpha-beta returns the same value as minimax**, and **move ordering decides the speedup**.
- Reach for **negamax** to halve the code — and remember the bound swap `(-beta, -alpha)`.
- For take-away games, recognize the **Sprague-Grundy / XOR** structure (siblings `14-nim`, `15-sprague-grundy`) — no tree needed.
- Mention **transposition tables**, **iterative deepening**, and **quiescence** as the production layers, and always offer to verify alpha-beta against full minimax on small inputs.
