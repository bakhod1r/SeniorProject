# Games on Graphs (Win / Lose / Draw) — Senior Level

> Retrograde analysis is `O(V + E)` and trivial on a textbook graph. The senior reality is that `V` is astronomical — a chess endgame with a handful of pieces has billions of positions — so every decision (state encoding, symmetry reduction, memory layout, BFS layering by distance, on-the-fly successor generation, disk-backed storage, verification) becomes a correctness or feasibility incident. This document treats building real **endgame tablebases** and large pursuit solvers in production terms.

## Table of Contents
1. [Introduction](#1-introduction)
2. [State-Space Explosion and Encoding](#2-state-space-explosion-and-encoding)
3. [Symmetry Reduction](#3-symmetry-reduction)
4. [Memory: The Real Bottleneck](#4-memory-the-real-bottleneck)
5. [BFS Layering by Distance-to-Mate](#5-bfs-layering-by-distance-to-mate)
6. [Endgame Tablebases in Practice](#6-endgame-tablebases-in-practice)
7. [Engineering the Successor / Predecessor Functions](#7-engineering-the-successor--predecessor-functions)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At senior level the question is no longer "how does retrograde analysis work" but "what system am I building, and what breaks when the position graph has billions of nodes?" Games-on-graphs in production shows up in three guises sharing one engine:

1. **Endgame tablebases** — chess (Nalimov, Syzygy), checkers (Chinook), Awari, Nine Men's Morris. The position graph is enormous; the answer (win/loss/draw, plus distance-to-mate or distance-to-zero) is computed once, stored, and queried at play time.
2. **Pursuit / safety games** — cop-and-robber, controller-synthesis, reachability games in formal verification. "From which initial states can the controller force the system into a safe set forever (or into a goal)?"
3. **Exhaustively solved games** — "is the starting position a win for the first player?" (Connect Four solved, checkers solved as a draw). The whole reachable graph is labeled.

All three reduce to: *enumerate positions, generate moves (forward) and un-moves (backward), run retrograde analysis with out-degree counters, store labels (and distances) compactly.* The senior decisions are: how to keep the state count tractable, how to fit the labels in memory or on disk, how to generate predecessors without materializing the whole edge set, and how to verify a result no human can check by hand.

---

## 2. State-Space Explosion and Encoding

### 2.1 The numbers are brutal

A position must encode the full game state *and whose turn it is*. The count multiplies fast:

| Game / endgame | Approx. positions |
|----------------|-------------------|
| King + Rook vs King (KRK) | ~28,000 (after symmetry) up to ~3.9M (naive) |
| 6-piece chess endgames | ~10^11 |
| 7-piece chess (Lomonosov / Syzygy) | ~5 · 10^14 |
| Checkers (fully solved, Chinook) | ~5 · 10^20 (solved by partitioning) |
| Nine Men's Morris (solved, draw) | ~10^10 |

`O(V + E)` is meaningless if `V` does not fit in RAM. The first job is to make `V` as small as possible and each position as cheap to store as possible.

### 2.2 Perfect-hash indexing

Real tablebases assign each legal position a dense integer index `0 ≤ idx < V` via a **perfect hashing / ranking** function (e.g. combinatorial ranking of piece placements). Two functions:

- `rank(position) → idx` — encode a board into its integer index.
- `unrank(idx) → position` — decode back. Used to iterate `idx = 0..V-1` and to generate successors/predecessors.

A good ranking is a **bijection onto exactly the legal positions** (no wasted slots for impossible boards), because a 10× density loss is a 10× memory blowup. Combinatorial number systems (rank a set of `k` occupied squares among `64`) are the standard tool.

```text
# combinatorial ranking of a sorted k-subset {c0<c1<...<c(k-1)} of {0..N-1}
rank = sum over i of C(c_i, i+1)         # bijection onto 0 .. C(N,k)-1
# unrank reverses it greedily, largest binomial first
```

This `rank`/`unrank` pair is the backbone of every tablebase: it lets you store labels in a flat array indexed `0..V-1` and iterate positions by a simple integer loop, with no hash map and no wasted slots for illegal boards.

### 2.3 Turn parity

Bake "side to move" into the index (typically the low bit or a separate half of the table). An edge always flips side-to-move; encoding it in the index keeps the graph a plain digraph and avoids a separate parity field.

---

## 3. Symmetry Reduction

The single highest-leverage optimization. Many positions are equivalent under board symmetries (rotations, reflections) or piece-type interchange (two identical rooks).

- **Geometric symmetry.** A chessboard has 8 symmetries (4 rotations × reflection). With no pawns, you can fold the position into a canonical orientation, cutting `V` by up to 8×. Pawns break vertical/diagonal symmetry (they move directionally), so only the left-right reflection (2×) survives.
- **Piece interchange.** Two identical pieces (two white knights) give a 2× redundancy; canonicalize by sorting their squares. `k` identical pieces give `k!`.
- **The canonical-form trap.** Successor/predecessor generation must map *back* into canonical form after each move, and the symmetry that canonicalizes a position may differ from its neighbor's. Getting the canonicalization consistent between `rank` and the move generators is the dominant correctness bug in tablebase construction. Always verify `rank(unrank(idx)) == idx` and `canon(canon(p)) == canon(p)` (idempotence).

Symmetry reduction is what turns "infeasible" into "fits on a laptop" for small endgames — but it must be applied *consistently* across indexing, forward moves, and backward un-moves.

### 3.1 Quantifying the savings

For a `KRK` (king + rook vs king) endgame: naive encoding is `64 × 64 × 64 × 2 ≈ 524{,}288` (three piece squares × side-to-move), but most are illegal (kings adjacent, pieces overlapping). After legality filtering and folding the 8-fold no-pawn symmetry, the canonical count drops to roughly `28{,}000` distinct positions — an ~18× reduction that makes the slice trivial to solve and store. The lesson scales: each independent symmetry multiplies the savings, and for the largest endgames symmetry is the difference between a table that fits on disk and one that does not exist.

### 3.2 The canonicalization contract

Three routines must agree on the *same* canonical form:

```
rank(canon(p))            # indexing
canon(apply_move(p, m))   # forward successor in canonical form
canon(apply_unmove(p, m)) # backward predecessor in canonical form
```

If `canon` for a position chooses a different symmetry than `canon` for its neighbor, an edge can "land" on the wrong index, silently losing or duplicating transitions. The single most effective guard is the idempotence test `canon(canon(p)) == canon(p)` plus `rank(unrank(i)) == i` for a random sample of `i`, run in CI before any multi-hour build.

---

## 4. Memory: The Real Bottleneck

### 4.1 Two bits per position (WDL) vs full distance (DTM/DTZ)

- **WDL (Win/Draw/Loss):** 2 bits per position (4 values: win, draw, loss, plus "broken"/illegal). For `7·10^14` positions that is still ~175 TB raw — compressed far smaller because WDL values are highly clustered.
- **DTM (Distance-to-Mate) / DTZ (Distance-to-Zero):** needs `log2(maxdist)` bits per position (8–16 bits). Much larger, but answers "how to win fastest" and resolves the 50-move rule.

Syzygy tablebases store WDL (small, used during search) and DTZ (larger, used near conversion) separately for exactly this reason.

### 4.2 Compression

Tablebases compress aggressively (RE-pair, LZMA-style, or domain-specific) because adjacent indices often share a value (spatial locality of outcomes). The query path must decompress a block on the fly, so the format is block-structured with an index. The out-degree counter array, needed only during *construction*, is discarded before storage.

### 4.3 The counter array dominates construction memory

During retrograde analysis you need, per position: the label (2 bits), and the **out-degree counter** (enough bits for the max branching, e.g. 8 bits). The counter array is often the largest construction-time structure. Techniques:

- **Recompute degree on demand** instead of storing it (trade CPU for memory) when successors are cheap to generate.
- **Pack counters** into the minimum bits for the game's max branching factor.
- **Streaming / external-memory retrograde** (Chinook used disk-based BFS): process the index range in chunks, keeping only the active frontier in RAM.

### 4.4 Layout

Store per-position fields in **structure-of-arrays** (separate `label[]`, `counter[]`) not array-of-structs, for cache efficiency during the linear seed scan and for independent compression of the label array.

---

## 5. BFS Layering by Distance-to-Mate

Retrograde analysis is naturally a layered BFS: terminals are layer 0, their forced predecessors layer 1, and so on. Processing strictly by layer gives **distance-to-mate (DTM)** as a byproduct and enables external-memory construction:

```
layer 0: all terminal LOSE positions (mate)
layer d (LOSE): positions all of whose moves go to WIN positions of layer < d  → DTM = 1 + max child DTM
layer d (WIN):  positions with a move to a LOSE position of layer d-1          → DTM = 1 + that child's DTM (the min, fast win)
```

The "fast win / slow loss" rule (covered in `middle.md`) makes DTM well-defined: the winner minimizes, the loser maximizes. Implemented as a frontier-based BFS, each layer is one pass over the previous frontier's predecessors — this is exactly how disk-based tablebase generators avoid random access: they sort the frontier by index and stream.

**50-move rule wrinkle (chess).** DTM ignores the 50-move draw rule; **DTZ** (distance to a zeroing move — capture or pawn move) is what engines actually need to claim a win under tournament rules. DTZ retrograde analysis resets the distance counter at zeroing moves, partitioning the graph into "material/pawn slices" solved in dependency order. This is a real-world reason the pure DTM model is insufficient for a deployed chess tablebase.

### 5.1 External-memory frontier BFS

When the position array exceeds RAM, the layered structure enables a disk-based construction:

```
for layer d = 0, 1, 2, ...:
    read frontier_d (positions settled at distance d), sorted by index
    for each v in frontier_d:
        for each predecessor u of v (generated on the fly):
            update u's label/counter, appending newly-settled u to frontier_{d+1}
    sort frontier_{d+1} by index; deduplicate; flush to disk
```

Because each layer is processed as a sorted stream, the algorithm performs **sequential** disk I/O (sort + merge) rather than random access — the key to feasibility at `10^12`+ positions. Chinook (checkers) used exactly this disk-based retrograde scheme. The trade is extra passes over disk for a tiny RAM footprint (just the current frontier plus sort buffers).

### 5.2 Why a plain FIFO suffices (no heap)

The fast-win / slow-loss distance settles vertices in non-decreasing distance, so a simple FIFO queue (or per-layer frontier file) yields correct distances with no priority queue. A WIN node's distance is `1 + min` over LOSE children, but the BFS guarantees the *first* LOSE child to reach it is the minimum-distance one, so no `log V` heap factor is ever needed — preserving strict `O(V + E)`.

---

## 6. Endgame Tablebases in Practice

### 6.1 The slicing strategy

You cannot solve all of chess at once, but endgames factor by **material**. A position with pieces `{KQ vs KR}` can only transition (via capture/promotion) to positions with *less or transformed* material — never *more*. So material signatures form a DAG of dependencies. Solve the simplest slices first (e.g. `KvK`, `KQvK`), then slices that can only convert into already-solved ones. Within a slice (fixed material), positions form a cyclic graph (pieces shuffle), so **retrograde analysis runs inside each slice**, seeding from the boundary (captures/promotions into already-solved slices) plus checkmates/stalemates.

### 6.2 Boundary seeding

The seed set for a slice is not just terminals; it includes every move that *exits* the slice into an already-solved slice. Such a move's value is looked up in the child slice's table and used to seed the current retrograde pass. This cross-slice seeding is where most integration bugs live (wrong sign, wrong side-to-move, off-by-one distance).

### 6.3 Historical landmarks

- **Chinook (checkers, Schaeffer et al., 2007):** proved checkers is a draw with perfect play, using endgame databases up to 10 pieces (~10^14 positions) plus forward search — a disk-based retrograde + alpha-beta hybrid.
- **Nalimov / Syzygy (chess):** Syzygy (Ronald de Man) is the modern standard: compact WDL + DTZ, symmetry-folded, used by Stockfish and Leela.
- **Nine Men's Morris (Gasser, 1996):** solved as a draw via retrograde analysis over ~10^10 positions.

The common thread: **slice the state space, solve slices in dependency order with retrograde analysis, store compactly.**

### 6.4 The dependency DAG of slices

Material signatures form a DAG: a slice can only convert (via capture/promotion) into slices with strictly less or transformed material, never more. A topological order of this DAG is the build order.

```
KvK  →  (seed: none winnable, all draw)
KQvK, KRvK  →  depend on KvK (captures into KvK)
KQvKR  →  depends on KQvK, KRvK, KvK
...
```

Within each slice you run retrograde analysis; *across* slices you only need the already-computed labels of downstream (simpler) slices to seed the boundary. This is precisely the SCC-condensation idea from `professional.md` (§5.2) applied at scale: the material DAG orders the seeding, retrograde analysis does the in-slice labeling. Parallelism falls out naturally — independent slices (no dependency edge between them) build on separate machines simultaneously.

### 6.5 Storage formats in the wild

- **Nalimov:** DTM tables, large, historically the standard, per-position distance-to-mate.
- **Syzygy:** two-table design — compact **WDL** (win/draw/loss, ~2 bits, used inside alpha-beta search to prune) plus **DTZ** (distance-to-zero, used only when converting near a capture/pawn push). The split exists because search needs the cheap WDL on most nodes and the expensive DTZ rarely.

The format choice is driven by the *query pattern*: a chess engine probes WDL millions of times per second deep in search, and DTZ only when it has already decided the position is won and needs a 50-move-safe winning plan.

---

## 7. Engineering the Successor / Predecessor Functions

Retrograde analysis needs **predecessors** (un-moves), which are subtler than successors:

- A **successor** asks "from this position, what legal moves exist?" — forward play.
- A **predecessor** asks "what positions could have moved *here*?" — un-move generation. For chess this means: which piece could have just moved to its current square, from where, possibly *un-capturing* a piece back onto the board.

Un-move generation is notoriously bug-prone: un-captures must reintroduce a captured piece (changing the material slice), un-promotions must demote, and you must not generate positions that are illegal (e.g., the side that just moved leaving its own king in check). A robust construction:

1. Generate predecessors structurally (un-move each piece type).
2. **Filter** to legal positions (the resulting board must be reachable: the *other* king not in check, etc.).
3. Map into canonical/symmetry-reduced form and `rank` to an index.

A standard correctness check: for every edge `u → v` produced by the *forward* generator on a sample of positions, confirm `u` appears among the *backward* generator's predecessors of `v`. This forward/backward consistency test catches the majority of un-move bugs before a multi-hour build.

---

## 8. Code Examples

### 8.1 Go — retrograde over an implicit graph (successors generated on the fly)

This shows the production shape: positions are dense integers, successors are generated by a function, predecessors by another. The out-degree is computed from the successor generator (recompute-on-demand to save memory).

```go
package main

import "fmt"

const (
	LOSE = 0
	WIN  = 1
	DRAW = 2
)

// succ(idx) lists forward moves; pred(idx) lists predecessors (un-moves).
type Game struct {
	N    int
	Succ func(int) []int
	Pred func(int) []int
	Term func(int) (bool, int) // (isTerminal, seedLabel)
}

func solve(g Game) (label, dist []int) {
	label = make([]int, g.N)
	dist = make([]int, g.N)
	deg := make([]int, g.N)
	known := make([]bool, g.N)
	for i := range label {
		label[i] = DRAW
		dist[i] = -1
		deg[i] = len(g.Succ(i)) // recompute-on-demand pattern
	}
	queue := []int{}
	for u := 0; u < g.N; u++ {
		if term, seed := g.Term(u); term {
			label[u], dist[u], known[u] = seed, 0, true
			queue = append(queue, u)
		}
	}
	for len(queue) > 0 {
		v := queue[0]
		queue = queue[1:]
		for _, u := range g.Pred(v) {
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
	// tiny explicit graph wrapped in the implicit interface
	moves := [][]int{{1, 2}, {3}, {1, 4}, {}, {2}}
	rev := make([][]int, 5)
	for u, vs := range moves {
		for _, v := range vs {
			rev[v] = append(rev[v], u)
		}
	}
	g := Game{
		N:    5,
		Succ: func(i int) []int { return moves[i] },
		Pred: func(i int) []int { return rev[i] },
		Term: func(i int) (bool, int) { return len(moves[i]) == 0, LOSE },
	}
	label, _ := solve(g)
	names := []string{"LOSE", "WIN", "DRAW"}
	for u := 0; u < 5; u++ {
		fmt.Printf("pos %d: %s\n", u, names[label[u]])
	}
}
```

### 8.2 Java — symmetry canonicalization sketch (KRK-style folding)

```java
public class Symmetry {
    // Fold a no-pawn position into a canonical orientation by trying all
    // 8 board symmetries and keeping the lexicographically smallest encoding.
    // pieces[] holds squares 0..63; we apply each symmetry and rank.
    static final int[][] SYM = buildSymmetries(); // 8 permutations of 0..63

    static long canonicalIndex(int[] pieces) {
        long best = Long.MAX_VALUE;
        for (int[] perm : SYM) {
            int[] mapped = new int[pieces.length];
            for (int i = 0; i < pieces.length; i++) mapped[i] = perm[pieces[i]];
            java.util.Arrays.sort(mapped);     // canonicalize identical pieces
            long idx = rank(mapped);
            if (idx < best) best = idx;
        }
        return best;
    }

    static long rank(int[] sortedSquares) {
        // combinatorial ranking of a k-subset of 64 squares (placeholder)
        long idx = 0;
        for (int i = 0; i < sortedSquares.length; i++)
            idx += choose(sortedSquares[i], i + 1);
        return idx;
    }

    static long choose(int n, int k) {
        if (k > n) return 0;
        long r = 1;
        for (int i = 0; i < k; i++) r = r * (n - i) / (i + 1);
        return r;
    }

    static int[][] buildSymmetries() {
        // identity only, as a runnable stand-in; real code has all 8.
        int[] id = new int[64];
        for (int i = 0; i < 64; i++) id[i] = i;
        return new int[][]{id};
    }

    public static void main(String[] args) {
        int[] pieces = {0, 7, 56}; // three squares
        System.out.println("canonical index = " + canonicalIndex(pieces));
    }
}
```

### 8.3 Python — layered (distance) construction and DTM extraction

```python
from collections import deque

LOSE, WIN, DRAW = 0, 1, 2


def solve_layered(n, succ, pred, terminals):
    """terminals: dict idx -> seed_label (LOSE for mate under normal play)."""
    label = [DRAW] * n
    dist = [-1] * n
    deg = [len(succ(u)) for u in range(n)]
    known = [False] * n
    q = deque()
    for u, seed in terminals.items():
        label[u], dist[u], known[u] = seed, 0, True
        q.append(u)

    while q:
        v = q.popleft()
        for u in pred(v):
            if known[u]:
                continue
            if label[v] == LOSE:                 # fast win
                label[u], dist[u], known[u] = WIN, dist[v] + 1, True
                q.append(u)
            else:
                deg[u] -= 1
                dist[u] = max(dist[u], dist[v] + 1)  # slow loss
                if deg[u] == 0:
                    label[u], known[u] = LOSE, True
                    q.append(u)
    return label, dist


def max_dtm(label, dist):
    """Longest forced mate distance — a headline tablebase statistic."""
    best = -1
    for u in range(len(label)):
        if label[u] in (WIN, LOSE):
            best = max(best, dist[u])
    return best


if __name__ == "__main__":
    moves = [[1, 2], [3], [1, 4], [], [2]]
    rev = [[] for _ in moves]
    for u, vs in enumerate(moves):
        for v in vs:
            rev[v].append(u)
    succ = lambda u: moves[u]
    pred = lambda u: rev[u]
    terms = {u: LOSE for u in range(len(moves)) if not moves[u]}
    label, dist = solve_layered(len(moves), succ, pred, terms)
    print("labels:", label)
    print("dist:  ", dist)
    print("max DTM:", max_dtm(label, dist))
```

---

## 9. Observability and Testing

A tablebase is opaque — billions of labels no human can verify directly. Build checks from day one.

| Check | Why |
|-------|-----|
| Small-slice brute force (minimax) | For KvK-size slices, an exponential minimax must agree label-for-label. |
| Forward/backward generator consistency | Every forward edge must appear as a backward edge of its target. Catches un-move bugs. |
| `rank(unrank(idx)) == idx` | The indexing bijection is correct and dense. |
| `canon(canon(p)) == canon(p)` | Symmetry canonicalization is idempotent. |
| Distance monotonicity | A WIN's DTM = 1 + (a LOSE child's DTM); a LOSE's DTM = 1 + max child DTM. Violations signal a layering bug. |
| Total count by label sums to V | No position lost or double-counted. |
| Known landmark agreement | Reproduce a published statistic (e.g. longest KRK mate = 16 moves, longest known 7-piece mate = 549 moves). |
| Symmetry invariance | Symmetric positions get identical labels and distances. |

The most valuable test is the **small-slice minimax oracle**: a from-scratch recursive minimax with memoization on a slice small enough to solve directly, compared entrywise against the retrograde result. It catches seed errors, un-move errors, and the fast-win/slow-loss distance convention all at once.

### 9.1 Property-test battery

```text
for random small game graph G (with cycles), random terminal labeling:
    retro = retrograde(G)
    naive = minimax_with_loop_detection(G)   # exhaustive, draws via cycle reachability
    assert retro == naive
    assert WIN nodes have a move to a LOSE node
    assert LOSE nodes have all moves to WIN nodes
    assert DRAW nodes have a move to a non-LOSE node and no move to a LOSE node
```

These three structural invariants (the converse of the labeling rules) are cheap to assert on the full output and catch corruption that aggregate counts miss.

### 9.2 Production guardrails

For a tablebase service: validate query inputs (legal position, in-slice), log the label+distance distribution per slice (anomalous spikes signal corruption), checksum each compressed block, and keep the small-slice oracle in CI so a refactor of the move generator cannot silently break a multi-day build.

---

## 10. Failure Modes

### 10.1 Naive DFS on a cyclic slice
Forward memoized DFS recurses forever (pieces shuffle) or mislabels draws. Mitigation: retrograde analysis is mandatory for any slice with repeatable positions.

### 10.2 Un-move generation bugs
Backward move generation that fails to un-capture, un-promote, or that produces illegal predecessors corrupts the entire slice. Mitigation: forward/backward consistency test on a sample before the full build.

### 10.3 Symmetry inconsistency
Canonicalizing the index one way but generating moves in a different orientation double-counts or loses positions. Mitigation: a single canonicalization routine used by indexing *and* move generation; idempotence test.

### 10.4 Wrong seed for the convention
Seeding stalemate as LOSE (it is a *draw* in chess, not a loss) or mate as WIN inverts results. Mitigation: encode terminal verdicts from the actual rules; chess stalemate = draw, checkmate = loss for the side to move.

### 10.5 Memory blowup from the counter array
Storing a full out-degree counter per position can exceed RAM. Mitigation: recompute degree on demand, pack counters tightly, or use external-memory (disk-streamed) retrograde.

### 10.6 Distance convention mistakes
Using min for LOSE distance or max for WIN distance gives wrong DTM. Mitigation: WIN = `1 + min(LOSE child)`, LOSE = `1 + max(child)`; verify against a known longest-mate landmark.

### 10.7 Ignoring the 50-move / repetition rule
Pure DTM says "win" but the rules force a draw by the 50-move rule. Mitigation: compute DTZ (distance-to-zero), resetting at captures/pawn moves, when deploying for real tournament play.

### 10.8 Cross-slice seeding errors
Looking up a converting move in the wrong child slice, with the wrong side-to-move, seeds garbage. Mitigation: explicit side-to-move flip on every cross-slice edge, plus a slice-boundary unit test.

---

## 11. Summary

- Retrograde analysis is `O(V + E)`, but the senior challenge is that `V` is astronomical: state encoding, symmetry reduction, and memory layout decide feasibility, not the asymptotic complexity.
- **Perfect-hash indexing** maps legal positions to dense integers; **symmetry reduction** (geometric + identical-piece) is the highest-leverage shrink, but must be applied consistently across indexing and move generation.
- **Memory is the bottleneck.** WDL needs ~2 bits/position; DTM/DTZ needs more. Compress for storage; the out-degree counter array dominates construction memory — recompute or pack it, or go external-memory.
- **BFS layering** by distance yields DTM for free under the fast-win/slow-loss convention; frontier-streaming enables disk-based construction for graphs that don't fit in RAM.
- **Endgame tablebases** slice the state space by material into a dependency DAG, solve each (cyclic) slice with retrograde analysis seeded from terminals plus converting moves into already-solved slices. Chinook (checkers), Syzygy/Nalimov (chess), and Nine Men's Morris are the landmarks.
- **Un-move (predecessor) generation** is the dominant bug source; verify forward/backward edge consistency before committing to a long build.
- **Testing** an opaque billion-entry table relies on a small-slice minimax oracle, structural invariants (the converse labeling rules), the indexing bijection, symmetry invariance, and reproducing published landmark statistics.
- Watch the convention seeds (stalemate = draw, not loss), the distance min/max asymmetry, and the 50-move rule (DTZ vs DTM) — these survive aggregate checks and only surface against ground truth.

### Landmark statistics to know

| Endgame / game | Headline fact |
|----------------|---------------|
| KRK (king+rook vs king) | always a win for the side with the rook; longest forced mate 16 moves |
| 7-piece chess (Lomonosov/Syzygy) | longest known forced mate ~549 moves — far beyond human intuition |
| Checkers (Chinook, 2007) | game-theoretic value is a **draw** with perfect play |
| Nine Men's Morris (1996) | **draw** with perfect play |
| Connect Four | first-player **win** (solved by Allis, 1988) |

These are excellent regression anchors: a tablebase build that fails to reproduce "KRK longest mate = 16" or "checkers = draw" has a bug in seeding, un-moves, or the distance convention.

### Decision summary

- **Provably acyclic slice / game** → memoized DFS or topological DP (no draws); Grundy for sums (topic 15).
- **Cyclic slice (positions repeat)** → retrograde analysis, mandatory.
- **Need fastest win / mate-in-k** → layered BFS, fast-win/slow-loss distance.
- **Tournament chess** → DTZ (50-move aware), not pure DTM.
- **State space exceeds RAM** → symmetry-fold + perfect-hash + external-memory frontier BFS, sliced by material.
- **Verification** → small-slice minimax oracle + forward/backward consistency + landmark reproduction.
- **Storage format** → WDL (2 bits, for search-time probing) + DTZ (for 50-move-safe conversion); compress for clustering locality.
- **Build order** → topological order of the material-signature DAG; independent slices parallelize across machines.
- **Convention seeds** → stalemate = draw, checkmate = loss; one wrong terminal verdict inverts an entire slice.

References to study further: Schaeffer et al. "Checkers Is Solved" (Science, 2007); Ronald de Man's Syzygy tablebase format; Nalimov tablebase generation; Gasser "Solving Nine Men's Morris" (1996); Thompson "Retrograde Analysis of Certain Endgames" (ICCA, 1986); and sibling topics `15` (Sprague-Grundy) and `11-graphs/01-representation`.
