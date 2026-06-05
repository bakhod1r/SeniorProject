# Minimax and Alpha-Beta Pruning — Senior Level

> Minimax is a one-page algorithm; a *production game engine* is a system. The moment the tree is too large to search fully, every detail — transposition-table sizing and Zobrist hashing, search instability from bounds and TT cutoffs, quiescence to tame the horizon effect, time management under a clock, parallel search, and a disciplined testing regime — becomes a correctness or strength incident. This document treats those concerns in engineering terms.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Transposition Tables: Sizing and Zobrist Hashing](#2-transposition-tables-sizing-and-zobrist-hashing)
3. [Search Instability](#3-search-instability)
4. [Quiescence Search and the Horizon Effect](#4-quiescence-search-and-the-horizon-effect)
5. [Selective Search: Null-Move, LMR, Extensions](#5-selective-search-null-move-lmr-extensions)
6. [Time Management](#6-time-management)
7. [Parallel Search Overview](#7-parallel-search-overview)
8. [Code Examples](#8-code-examples)
9. [Testing and Observability](#9-testing-and-observability)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does alpha-beta prune" but "what does a real engine do when `b^d` is astronomically larger than the node budget, and what breaks when I push it?". A modern alpha-beta engine is the composition of a handful of subsystems that interact in subtle ways:

1. **A search core** — negamax + alpha-beta, almost always fail-soft, with a principal-variation (PV) search refinement (null-window searches for non-first moves).
2. **A transposition table** — a large, fixed-size hash table that memoizes positions, with a Zobrist key, a replacement policy, and bound flags. It both speeds the search and *changes* its results (instability).
3. **Selective search** — quiescence, null-move pruning, late-move reductions, and extensions that spend depth where it matters and skip where it does not.
4. **A time manager** — iterative deepening driven by a clock budget, with safety margins and "panic" handling.
5. **An evaluation function** — the only place game knowledge lives; everything else is generic.

The senior decisions are: how to size and hash the TT, how to keep the search *correct* despite all the pruning, how to test a thing whose output is a single move, and how to recognize the failure modes (instability, horizon effect, time losses, TT collisions) before they cost a game. We assume you already command negamax, alpha-beta, move ordering, and iterative deepening from [`middle.md`](./middle.md).

A useful mental model: the *search* is generic and game-agnostic (negamax + alpha-beta + TT + selective heuristics), while *all game knowledge* lives in two places — the move generator and the evaluation function. This separation is what lets the same search framework play chess, Othello, or a custom game by swapping only those two components. It also localizes correctness concerns: move-generation bugs are caught by perft, evaluation bugs by sanity positions and SPRT, and search bugs by the alpha-beta-vs-minimax and TT-on-vs-off invariants. When something goes wrong, knowing *which* subsystem owns the failure is half the debugging battle.

The remaining sections treat each subsystem in turn, with the recurring theme that nearly every "speed" feature (TT, null-move, LMR, quiescence) is also a potential *correctness* hazard, and the only reliable arbiter is empirical testing, not intuition.

---

## 2. Transposition Tables: Sizing and Zobrist Hashing

### 2.1 Zobrist hashing

A TT keyed by the full board would waste memory and time. **Zobrist hashing** computes a 64-bit key incrementally:

- Precompute a random 64-bit number `Z[piece][square]` for every (piece, square) combination, plus `Z_side` for side-to-move and keys for castling/en-passant state (chess) or whatever auxiliary state your game has.
- The key of a position is the XOR of the random numbers for every present feature.
- When you make a move, **update the key by XOR-ing out the moved-from features and XOR-ing in the moved-to features** — `O(1)` per move, not `O(board)`. XOR is its own inverse, so unmake reverses it exactly.

```
hash ^= Z[piece][from];   // remove piece from origin
hash ^= Z[piece][to];     // place piece at destination
hash ^= Z_side;           // flip side to move
```

The incremental update is what makes the TT affordable: the key rides along with make/unmake at no asymptotic cost.

**Worked Zobrist trace.** Suppose `Z[X][e4] = 0xA1`, `Z[X][e5] = 0xB2`, `Z_side = 0xFF` (toy 8-bit values). Starting from a position with key `K`, moving the X-piece from `e4` to `e5`:

```
K' = K ^ 0xA1 ^ 0xB2 ^ 0xFF      // remove from e4, add to e5, flip side
```

Unmaking applies the *same three XORs*: `K' ^ 0xA1 ^ 0xB2 ^ 0xFF = K` because `x ^ x = 0`. This self-inverse property is why no separate "undo key" is stored — the make and unmake share one code path with opposite intent but identical operations. Two move orders reaching the same final position accumulate the *same set* of XOR terms (XOR is commutative and associative), so they collide intentionally — which is precisely the transposition the TT exploits.

### 2.2 Sizing and indexing

The TT is a fixed array of `2^n` entries (a power of two so indexing is a mask, not a modulo). Index = `low n bits of hash`; store the remaining hash bits (or the full key) in the entry to detect collisions. Typical sizes: 64 MB–1 GB. Each entry packs:

```
TTEntry { key32_or_full, value, depth, flag (EXACT/LOWER/UPPER), best_move, age }
```

- **Two keys collide** at the same index constantly — that is expected; the stored key bits verify whether a probe is a true hit.
- **Distinct positions with the same full 64-bit Zobrist key** ("type-1" collisions) are rare but possible; they can return a wrong value. With 64-bit keys and a search of `10^9` nodes the probability is small but nonzero — engines accept it as a calculated risk and rely on the search's self-correction.

**Two-tier tables.** A common refinement stores *two* entries per index: a depth-preferred slot (keeps the deepest result seen) and an always-replace slot (keeps the most recent). A probe checks both. This captures the value of deep entries without the staleness problem of pure depth-preferred, at the cost of doubling the per-index footprint. It is a pragmatic compromise widely used in strong engines.

### 2.3 Replacement policy

The table fills; you must decide what to overwrite. Common scheme: **depth-preferred with aging** — keep entries from deeper searches and from the current search generation (`age`), evict shallow stale ones. A pure "always replace" policy is simple but loses valuable deep entries; a pure "depth-preferred" policy can clog with stale deep entries from previous moves, hence aging.

### 2.4 Using TT entries correctly

```
probe = TT[index(hash)]
if probe.key matches and probe.depth >= remaining_depth:
    if probe.flag == EXACT:                 return probe.value
    if probe.flag == LOWERBOUND: alpha = max(alpha, probe.value)
    if probe.flag == UPPERBOUND: beta  = min(beta,  probe.value)
    if alpha >= beta:                        return probe.value
# regardless of depth, use probe.best_move to order moves
```

The depth condition is essential: a value learned at shallow depth is *not* trustworthy for a deeper requirement. Returning a too-shallow value is a classic correctness bug that inflates strength tests and then loses real games.

### 2.5 Sizing arithmetic

A practical sizing decision. Each entry might pack into 16 bytes: 4-byte key remnant, 2-byte value, 1-byte depth, 1-byte flag, 4-byte move, 1-byte age, padding. A 256 MB table then holds `256·2^20 / 16 = 16 M` entries (`2^24`), indexed by the low 24 bits of the Zobrist key. Choose the table size to match the expected number of *distinct* positions in a search: too small and you thrash (constant eviction, low hit rate); too large and you waste RAM and hurt cache locality. A common heuristic is to size the TT so it holds a few seconds of nodes at the engine's search speed (e.g., a 1 M nodes/s engine searching 5 s touches ~5 M positions, so `2^23`–`2^24` entries is reasonable). The table is allocated *once* at startup, never per search — reallocating per move is a latency and GC regression (Failure Mode 10.7 of the matrix-exp analogy; here it is allocation churn).

---

## 3. Search Instability

**Definition.** *Search instability* is when re-searching the same position (different window, TT state, or move order) yields a *different* value or move than expected. It is intrinsic to alpha-beta engines, not always a bug.

Sources:

- **Bounds, not exact values.** A cutoff returns a *bound* (≥ or ≤). When that bound is stored in the TT and reused under a different window, it may not reproduce the exact value — and that is legal. Only the **root** PV value with a full window is guaranteed exact.
- **TT cutoffs across iterations.** An entry from a previous (shallower) iteration can short-circuit a node in a way that changes the move chosen, even though the final root value is still correct.
- **Null-window (PVS) re-searches.** PV search assumes the first move is best and searches the rest with a null window `(alpha, alpha+1)`; if one fails high it must be **re-searched** with the full window. A bug in the re-search logic produces wrong values that look like instability.

**Engineering stance:** distinguish *benign* instability (different but equally-valued moves, or bounds that do not affect the root decision) from *malignant* instability (the root value genuinely differs between a TT-on and TT-off search of the same depth). The litmus test: run the search with the **TT disabled** and **pruning disabled** (pure alpha-beta) and confirm the root value matches. If it does, your instability is benign; if it does not, you have a real bug in TT flag handling or PVS re-search.

### 3.1 A concrete instability scenario

Iteration 6 searches position `p` and stores `LOWERBOUND 50` in the TT (a beta cutoff). Iteration 7 revisits `p` with a window that the bound `50` tightens enough to cut immediately, so the engine never discovers that the *exact* value is actually `120`. The chosen move at `p` may differ from what a full re-search would pick — yet the root value remains correct because the bound `50` was still a valid lower bound and the root's decision did not hinge on the exact `p` value. This is **benign**: the search exploited a sound bound to save work, and the only "instability" is that an internal node reported a bound rather than an exact value. A *malignant* version would be storing `50` as EXACT (a flag bug) when it is only a bound, then returning `50` where `120` was needed — corrupting the root. The discipline that separates them is rigorous flag handling plus the TT-on-vs-off litmus test.

### 3.2 Reproducibility under instability

Because cutoffs return bounds and TT state carries across iterations, two runs that differ in TT size, thread count, or move-ordering tweaks can legitimately report different *moves* of equal value. For debugging you want determinism: fix the TT to single-threaded, disable non-deterministic heuristics, and seed any randomness. Then any value difference is a genuine bug, not benign instability. Production runs sacrifice this determinism for speed (Lazy SMP), keeping a deterministic mode behind a flag.

---

## 4. Quiescence Search and the Horizon Effect

### 4.1 The horizon effect

A fixed-depth search evaluates the position exactly at the cutoff. If a capture or other large swing is *one ply past the horizon*, the evaluation is wildly wrong: the engine sees a position where it is "up a queen" without seeing that the queen is recaptured next move. Worse, the engine can **push the bad news past the horizon** with delaying moves — sacrificing material to postpone an inevitable loss beyond where it can see.

### 4.2 Quiescence search

At a leaf (depth 0), instead of returning `eval()` directly, run a **quiescence search** that considers only "noisy" moves (captures, promotions, sometimes checks) until the position is *quiet*, then evaluates. The structure:

```
qsearch(alpha, beta):
    stand_pat = evaluate()          # the "do nothing" baseline
    if stand_pat >= beta: return beta            # already good enough
    alpha = max(alpha, stand_pat)
    for each capture/noisy move (ordered):
        make(move)
        v = -qsearch(-beta, -alpha)
        unmake(move)
        if v >= beta: return beta
        alpha = max(alpha, v)
    return alpha
```

The **stand-pat** value (the option to not capture) is what bounds the recursion: a player is never forced to make a bad capture, so if standing pat already beats `beta`, we cut. Quiescence keeps the leaf evaluation honest at the cost of a bounded extra search along forcing lines. Without it, any engine with material in its eval plays tactically blind.

**Why quiescence terminates.** Unlike the main search, quiescence has no explicit depth limit — so why does it not run forever? Because it considers only *captures* (and a few checks), and captures strictly reduce the number of pieces on the board, a quantity bounded below by zero. Each capture line therefore has bounded length (at most the piece count). The stand-pat option means a side never *must* capture, so a quiet position immediately returns its static eval. In practice engines add a hard quiescence depth cap (e.g., 8–16 plies) as a safety net against pathological check sequences, but the capture-only restriction is what makes the search finite in principle.

### 4.3 Delta pruning

In quiescence, if even capturing the most valuable piece cannot raise `stand_pat` above `alpha` by a margin, skip the capture (**delta pruning**). It trims hopeless quiescence nodes and is the quiescence analog of futility pruning.

### 4.4 A worked horizon-effect example

Position: at the depth limit, MAX has just played a move that *appears* to win a knight (`eval = +3`). A plain depth-limited search returns `+3` and MAX plays into the line. But one ply past the horizon, the opponent recaptures: the true value is `0` (even material). With quiescence, the leaf does *not* return `+3`; it searches the available capture (the recapture), plays it out to the quiet position, and returns the corrected `0`. The difference between `+3` (blind) and `0` (quiescence-corrected) is exactly the horizon error. Worse, without quiescence MAX might *prefer* a delaying sacrifice that pushes an inevitable loss just past depth `d`, "hiding" it — the engine literally fools itself. Quiescence (resolving captures) plus check extensions (resolving forcing checks) are the standard defenses; neither is optional in a tactical game.

---

## 5. Selective Search: Null-Move, LMR, Extensions

Beyond quiescence, strong engines reshape the search tree:

- **Null-move pruning.** Let the side to move "pass" (a null move) and search shallower; if the result still exceeds `beta`, the real position is almost certainly a cutoff, so prune. Hugely effective, but **unsound in zugzwang** positions (where passing would be good but is not allowed) — disable it in late endgames.
- **Late-move reductions (LMR).** Moves tried late in a well-ordered list are unlikely to be best; search them at reduced depth, and re-search at full depth only if they surprise you by failing high.
- **Extensions.** Spend *extra* depth on forcing lines (checks, single-reply positions, recaptures) so tactics are not truncated.
- **Futility / razoring.** Near the leaves, if the static eval is far below `alpha`, skip quiet moves that cannot plausibly recover.

Each is a heuristic trade of *soundness* for *depth*: they can occasionally prune a critical line, but the depth they buy wins far more often than it loses. They must be **tested empirically** (Section 9), never assumed correct from intuition.

**The depth-vs-soundness ledger.** It helps to view each selective technique as a position on a spectrum from "always sound, costs depth" to "unsound, buys depth":

| Technique | Soundness | Effect | Main risk |
|-----------|-----------|--------|-----------|
| Quiescence | sound (extends, never skips) | corrects horizon | runtime explosion if unbounded |
| Extensions | sound | more depth on forcing lines | search-tree blowup |
| Aspiration windows | sound (re-searches on fail) | tighter pruning | wasted re-search |
| Null-move | unsound (zugzwang) | big depth gain | endgame blunders |
| LMR | unsound | biggest depth gain | reduces critical late move |
| Futility/razoring | unsound | trims near leaves | skips a saving quiet move |

The sound techniques can be enabled with confidence; the unsound ones require guards (verification searches, never-reduce lists) and SPRT validation. The art of a strong engine is pushing the unsound techniques as far as the testing allows without crossing into net-negative territory.

### 5.1 Null-move pruning in detail

The null-move heuristic rests on the **null-move observation**: in most positions, having the right to move is an advantage, so if you could "pass" and *still* be winning (beat `beta`), then actually moving can only be better — a cutoff is overwhelmingly likely. Concretely:

```
if depth >= R+1 and not in_check and has_non_pawn_material:
    make_null_move()                       # pass the turn
    v = -negamax(depth - 1 - R, -beta, -beta + 1)   # reduced-depth null window
    unmake_null_move()
    if v >= beta:
        return beta                        # null-move cutoff
```

`R` (typically 2–3) is the reduction. The danger is **zugzwang**: in positions where every move worsens your situation (common in king-and-pawn endgames), passing would be *good* but is illegal — so the null-move observation is false, and the pruning blunders. Guards: require non-pawn material, and in suspicious endgames do a *verification search* (re-search at reduced depth without null-move) before trusting the cutoff.

### 5.2 Late-move reductions in detail

LMR exploits that, with good ordering, moves tried late are unlikely to be best. Search the first few moves at full depth; reduce the depth of later quiet moves by `r` plies; if a reduced search unexpectedly raises `alpha` (fails high), **re-search at full depth** to get the true value. The reduction `r` typically grows with move index and depth (more aggressive reductions deeper in the move list). LMR is the single biggest depth-multiplier in modern engines, but like null-move it is *unsound* — it can reduce a critical late move — so it lives or dies by SPRT testing.

---

## 6. Time Management

A real engine plays under a clock. Iterative deepening provides the anytime property; the time manager decides when to stop.

- **Budget per move.** A common base allocation is `remaining_time / expected_moves_left + increment`, with adjustments for game phase.
- **Soft and hard limits.** A *soft* limit decides whether to *start* another iteration (do not start depth `d+1` if it likely will not finish); a *hard* limit aborts mid-iteration if exceeded. Aborting mid-iteration must safely return the best move from the last *completed* iteration — never a half-searched root.
- **Stability bonus / panic.** If the best move has been stable across iterations, you can stop early; if the score suddenly drops ("we are losing"), spend extra time to find a rescue ("panic time").
- **Don't lose on time.** The cardinal sin. Always keep a safety margin for move overhead, GUI latency, and the abort check granularity (check the clock every `N` nodes, not every node).

The interaction with the TT matters: an aborted iteration still leaves useful entries for the next move's search, so partial work is not wasted.

### 6.1 A concrete time-budget calculation

Suppose you have 90 s left and estimate 30 moves remain, with a 1 s increment per move. A simple budget:

```
base = remaining / moves_left + increment = 90/30 + 1 = 4 s
soft_limit = 0.6 * base ≈ 2.4 s     # don't START a new iteration past here
hard_limit = 3.0 * base ≈ 12 s      # ABORT if exceeded (but cap to remaining - margin)
```

The soft limit is well below the base so you finish most iterations; the hard limit is generous because a single iteration occasionally balloons (a forced tactical line). Always clamp the hard limit to `remaining_time − safety_margin` (e.g., 100 ms for move overhead and GUI latency). If iteration `d` finished in `0.8 s` and the branching suggests iteration `d+1` will take `~0.8 · EBF ≈ 0.8·6 ≈ 5 s` but only `1.6 s` remains until the soft limit, *do not start it* — return the depth-`d` move. This "predict-next-iteration-cost" gate is what prevents starting iterations that cannot finish.

### 6.2 Panic and stability

Two refinements: if the best move *changed* on the last iteration or the score *dropped* sharply, the position is critical — spend up to the hard limit ("panic time") to find a rescue. Conversely, if the best move has been identical for several iterations and the score is stable, you may stop early and bank the time. These policies are tuned empirically; the invariant they must never violate is *returning a move before the hard limit*, since losing on time forfeits the game regardless of position.

---

## 7. Parallel Search Overview

Alpha-beta parallelizes poorly because pruning is inherently sequential — you need the first move's result to set the window that prunes the rest. Approaches:

- **Lazy SMP** (the modern pragmatic default). Run multiple search threads on the *same position*, sharing one transposition table, with slightly varied depths/move orders. Threads cross-pollinate via the shared TT; the main thread's PV is reported. Simple, scales decently, no explicit work splitting.
- **Young Brothers Wait (YBWC).** Search the first ("eldest") child fully to establish a bound, *then* search siblings in parallel. Respects alpha-beta's dependency but needs careful synchronization and work-stealing.
- **Root splitting.** Distribute root moves across workers. Easy but coarse; load imbalance is high because subtree sizes vary wildly.

Shared-TT concurrency needs care: entries are read/written by many threads. Engines often use **lockless** schemes (e.g., XOR the key with the data so a torn read fails verification) rather than locking every probe. The practical reality: parallel speedup is sublinear (the "parallel search overhead"), and Lazy SMP's gains come as much from TT diversity as from raw division of work.

### 7.1 The lockless XOR trick

A TT entry is two machine words: `key` and `data` (packed value/depth/flag/move). On write, store `key XOR data` instead of the raw `key`. On read, recover the verification key as `stored_key XOR data` and compare to the probe key. If another thread tore the write (wrote `key` but not `data`, or vice versa), the XOR recovery yields a mismatched key and the probe is rejected as a miss — never a *wrong* value. This converts a data race from a correctness bug into a harmless cache miss, avoiding the per-probe lock that would serialize the hottest path in the engine. It is the standard way to share a TT across Lazy SMP threads.

### 7.2 Why speedup is sublinear

With `T` threads you never get `T×` speedup. Reasons: (1) **search overhead** — threads explore nodes that a single sequential search, with its tighter bounds, would have pruned; (2) **synchronization** — TT contention and memory bandwidth saturate; (3) **the PV is sequential** — the principal variation must be established to set the windows that prune everything else, and that establishment cannot be parallelized away. Typical Lazy SMP gains are roughly `1.7×`–`2×` at 4 threads and diminishing beyond, with the *quality* of TT cross-pollination mattering as much as raw core count. A deterministic single-thread mode should always be kept for debugging, since Lazy SMP is inherently non-reproducible (thread timing decides which entries land first).

---

## 8. Code Examples

### 8.1 Go — Zobrist hashing for tic-tac-toe (incremental key)

```go
package main

import (
	"fmt"
	"math/rand"
)

// Z[cell][playerIndex]: playerIndex 0 = X, 1 = O.
var Z [9][2]uint64
var ZSide uint64

func initZobrist(seed int64) {
	r := rand.New(rand.NewSource(seed))
	for c := 0; c < 9; c++ {
		Z[c][0] = r.Uint64()
		Z[c][1] = r.Uint64()
	}
	ZSide = r.Uint64()
}

// playerIdx: 1->0 (X), -1->1 (O)
func playerIdx(p int) int {
	if p == 1 {
		return 0
	}
	return 1
}

// make a move and update the hash incrementally
func makeMove(b []int, hash *uint64, cell, player int) {
	b[cell] = player
	*hash ^= Z[cell][playerIdx(player)]
	*hash ^= ZSide
}

func unmakeMove(b []int, hash *uint64, cell, player int) {
	*hash ^= Z[cell][playerIdx(player)] // XOR is its own inverse
	*hash ^= ZSide
	b[cell] = 0
}

func main() {
	initZobrist(12345)
	b := make([]int, 9)
	var h uint64 = 0
	makeMove(b, &h, 4, 1)   // X center
	makeMove(b, &h, 0, -1)  // O corner
	fmt.Printf("hash after X@4, O@0: %x\n", h)
	unmakeMove(b, &h, 0, -1)
	unmakeMove(b, &h, 4, 1)
	fmt.Printf("hash after undo (should be 0): %x\n", h) // 0
}
```

### 8.2 Java — fixed-size transposition table with bound flags

```java
public class TransTable {
    static final int EXACT = 0, LOWER = 1, UPPER = 2;

    static final class Entry {
        long key;       // full Zobrist key for verification
        int value, depth, flag, bestMove;
        boolean valid;
    }

    final Entry[] table;
    final int mask;

    TransTable(int sizePow2) {           // e.g. 1 << 20 entries
        table = new Entry[sizePow2];
        for (int i = 0; i < sizePow2; i++) table[i] = new Entry();
        mask = sizePow2 - 1;
    }

    int index(long key) { return (int) (key & mask); }

    // returns null on miss; depth-preferred replacement on store
    Entry probe(long key) {
        Entry e = table[index(key)];
        return (e.valid && e.key == key) ? e : null;
    }

    void store(long key, int value, int depth, int flag, int bestMove) {
        Entry e = table[index(key)];
        if (!e.valid || depth >= e.depth || e.key == key) { // depth-preferred
            e.key = key; e.value = value; e.depth = depth;
            e.flag = flag; e.bestMove = bestMove; e.valid = true;
        }
    }

    // Use inside search: tighten the window or return early.
    int adjust(Entry e, int depth, int[] window) { // window = {alpha, beta}
        if (e.depth < depth) return Integer.MIN_VALUE; // too shallow, can't return
        if (e.flag == EXACT) return e.value;
        if (e.flag == LOWER) window[0] = Math.max(window[0], e.value);
        if (e.flag == UPPER) window[1] = Math.min(window[1], e.value);
        return (window[0] >= window[1]) ? e.value : Integer.MIN_VALUE;
    }

    public static void main(String[] args) {
        TransTable tt = new TransTable(1 << 16);
        tt.store(0xDEADBEEFL, 42, 5, EXACT, 4);
        Entry e = tt.probe(0xDEADBEEFL);
        System.out.println("probe value: " + (e == null ? "miss" : e.value)); // 42
    }
}
```

### 8.3 Python — quiescence search sketch over an abstract game

```python
import math

INF = math.inf


def quiescence(game, alpha, beta):
    """Extend search along noisy (capture) moves until the position is quiet."""
    stand_pat = game.evaluate()           # from side-to-move's perspective
    if stand_pat >= beta:
        return beta                       # fail-high: standing pat already wins
    if stand_pat > alpha:
        alpha = stand_pat                 # raise the floor

    for m in game.capture_moves():        # only noisy moves, ordered (MVV-LVA)
        # delta pruning: skip captures that cannot raise alpha enough
        if stand_pat + game.capture_gain(m) + DELTA_MARGIN < alpha:
            continue
        game.make(m)
        score = -quiescence(game, -beta, -alpha)
        game.unmake(m)
        if score >= beta:
            return beta
        if score > alpha:
            alpha = score
    return alpha


DELTA_MARGIN = 200  # centipawns, tuned per engine


def negamax_q(game, depth, alpha, beta):
    if game.terminal():
        return game.evaluate()
    if depth == 0:
        return quiescence(game, alpha, beta)   # quiescence at the horizon
    best = -INF
    for m in game.moves():
        game.make(m)
        v = -negamax_q(game, depth - 1, -beta, -alpha)
        game.unmake(m)
        best = max(best, v)
        alpha = max(alpha, v)
        if alpha >= beta:
            break
    return best
```

---

## 9. Testing and Observability

A search engine emits a single move; one wrong move looks like any other. Build verification in from day one.

| Check | Why |
|-------|-----|
| Alpha-beta value == plain minimax value (small game) | Proves pruning is lossless; the bedrock correctness test. |
| TT-on value == TT-off value at same depth | Catches TT flag/depth misuse (malignant instability). |
| Negamax value == separate-MAX/MIN value | Catches the bound-swap / sign bug. |
| Perft (node-count) test for move generation | Confirms legal-move generation is exact (counts at fixed depth must match known values). |
| Tic-tac-toe empty board == draw (0) | Cheap full-game oracle. |
| Win/loss scores prefer faster mates | Confirms depth is folded into terminal scores. |
| SPRT match between engine versions | Statistically sound way to confirm a change is a real strength gain, not noise. |

The single most valuable correctness test is **alpha-beta vs full minimax on a small game**: they must agree on the value for every position. The single most valuable *strength* test is an **SPRT** (Sequential Probability Ratio Test) self-play match — you do not "eyeball" whether null-move pruning helped; you play thousands of games and let the statistics decide, because individual heuristics often *look* right and *measure* wrong.

### 9.2 Why SPRT and not a fixed match

A fixed-length match (say 1000 games) either over- or under-spends games: if the change is obviously good or bad, you wasted games; if it is marginal, 1000 may be too few to reach significance. SPRT instead defines two hypotheses — `H0`: the change is worth `≤ elo0` (e.g., 0 Elo), `H1`: it is worth `≥ elo1` (e.g., +5 Elo) — and plays games until the likelihood ratio crosses an accept or reject boundary set by chosen error rates `(α, β)`. It stops as soon as the evidence is conclusive, using the *minimum* expected number of games. This is essential because most engine changes are worth only a few Elo, and distinguishing "+3 Elo" from "noise" requires tens of thousands of games — SPRT spends exactly as many as needed and no more.

### 9.3 Perft: validating move generation

Before any search is trustworthy, the move generator must be exact. **Perft(d)** counts the leaf nodes of a full-width (no pruning, no eval) search to depth `d` from a known position; the counts are tabulated for standard positions (e.g., chess start position perft(5) = 4,865,609). A mismatch pinpoints a move-generation bug (missing castling, en-passant, promotion, or a legality error) independent of the search and evaluation. Perft is the foundation: a search built on a buggy move generator produces confident, wrong moves.

### 9.1 Observability

Instrument the search: nodes searched, TT hit rate, beta-cutoff rate, **first-move cutoff rate** (the fraction of cutoffs caused by the *first* move — a direct measure of move-ordering quality; aim well above 90%), effective branching factor (`nodes(d)/nodes(d-1)`, which should approach `sqrt(b)` with good ordering), and average quiescence depth. These metrics localize regressions: a falling first-move-cutoff rate means ordering broke; a soaring quiescence depth means it is exploding.

---

## 10. Failure Modes

### 10.1 Returning a too-shallow TT value
Using a TT entry whose stored `depth` is less than the current requirement returns an under-searched value. Symptom: strength tests look great, real games lose. Mitigation: enforce `entry.depth >= remaining_depth` before any early return.

### 10.2 TT bound flag misuse
Treating a LOWERBOUND/UPPERBOUND entry as EXACT. Symptom: wrong root values, malignant instability. Mitigation: always branch on the flag; only EXACT returns directly, bounds only tighten the window.

### 10.3 Horizon effect
A fixed-depth search misvaluing a position because a swing is one ply past the cutoff, or the engine pushing loss past the horizon with delaying sacrifices. Mitigation: quiescence search on noisy moves; extensions on forcing lines.

### 10.4 Null-move in zugzwang
Null-move pruning assumes passing is never beneficial — false in zugzwang (common in pawn endgames). Symptom: blundered endgames. Mitigation: disable null-move when material is low / few pieces remain, and verify with a reduced-depth re-search.

### 10.5 PVS re-search bug
Forgetting to re-search a move that fails high against the null window. Symptom: the engine adopts an inferior move because the better one was searched with too narrow a window and rejected. Mitigation: on a null-window fail-high for a non-first move, re-search with the full `(alpha, beta)`.

### 10.6 Losing on time
Starting an iteration that cannot finish, or checking the clock too rarely. Mitigation: soft limit gates new iterations; hard limit aborts and returns the last completed move; check the clock every `N` nodes with a safety margin.

### 10.7 Non-symmetric evaluation in negamax
An eval that is not perfectly antisymmetric (`eval(p, side) != -eval(p, other_side)`) corrupts negamax. Symptom: the engine plays one color far better than the other. Mitigation: compute eval from one fixed perspective then negate by side-to-move; unit-test the antisymmetry.

### 10.8 TT non-determinism in parallel search
Lazy SMP makes the search non-deterministic (thread timing varies which entries land first). Symptom: irreproducible bugs. Mitigation: a single-threaded deterministic mode for debugging; lockless-but-verified TT writes (key-XOR-data) so torn reads are detected, not trusted.

### 10.9 Over-aggressive reductions/pruning
LMR or futility pruning tuned too aggressively can reduce or skip a critical move, costing the game in sharp positions while *improving* average benchmark scores. Symptom: the engine plays positionally fine but blunders in tactics. Mitigation: never reduce moves that give check, captures, or moves that escape check; re-search any reduced move that fails high; and validate every reduction-parameter change with SPRT, since intuition consistently mis-predicts these.

### 10.10 Evaluation-function sign or scale drift
If the evaluation's scale (centipawns) or sign convention is inconsistent across terms, the search optimizes a distorted objective. Symptom: the engine over- or under-values specific features systematically. Mitigation: a single fixed scale, antisymmetry unit tests (Section 10.7), and "eval sanity" positions with known correct signs (a clear material advantage must evaluate positive for the side ahead).

---

## 11. Summary

- A production engine is **negamax + alpha-beta** wrapped in a **transposition table**, **selective search** (quiescence, null-move, LMR, extensions), **iterative deepening**, and a **time manager** — each subsystem interacting with the others.
- **Zobrist hashing** gives an `O(1)` incremental position key (XOR in/out features per move); the TT is a power-of-two array with depth-preferred-plus-aging replacement and **bound flags** (EXACT/LOWER/UPPER) that must be honored, and a `depth >= requirement` guard before any early return.
- **Search instability** is intrinsic: cutoffs return *bounds*, and TT/PVS re-searches can change the chosen move while keeping the root value correct. Separate benign from malignant instability by comparing against a pruning-off, TT-off search.
- **Quiescence search** (with stand-pat and delta pruning) extends leaves along noisy moves to defeat the **horizon effect**; without it, any material-aware eval is tactically blind.
- **Selective search** trades soundness for depth (null-move — unsound in zugzwang; LMR; extensions; futility); each must be validated by **SPRT self-play**, never by intuition.
- **Time management** uses iterative deepening's anytime property with soft/hard limits and a safety margin; never lose on time, and always return the last *completed* iteration's move.
- **Parallel search** is hard because pruning is sequential; **Lazy SMP** with a shared (lockless-verified) TT is the pragmatic default, with sublinear speedup.
- **Test relentlessly:** alpha-beta == minimax on small games, TT-on == TT-off, negamax == MAX/MIN, perft for move generation, and SPRT for strength. Instrument first-move-cutoff rate and effective branching factor to localize regressions.

### Decision summary

- **Small, fully searchable game** → plain alpha-beta to the end; verify against minimax.
- **Large game, fixed eval** → negamax + alpha-beta + TT + iterative deepening + quiescence.
- **Tactical game with material eval** → quiescence is mandatory; add extensions on checks/recaptures.
- **Endgames / zugzwang risk** → disable null-move pruning when material is low.
- **Under a clock** → iterative deepening with soft/hard time limits and a safety margin.
- **Multi-core** → Lazy SMP with a shared, lockless-verified TT; keep a deterministic single-thread debug mode.
- **Validating a heuristic change** → SPRT self-play match, not eyeballing.
- **Sharing a TT across threads** → lockless key-XOR-data writes; keep a deterministic single-thread debug mode.
- **A search bug suspected** → bisect by subsystem: perft for move generation, alpha-beta-vs-minimax for the search core, eval-sanity positions for the evaluation, TT-on-vs-off for table handling.

### Mental checklist for a new engine

1. **Move generation first**, validated by perft — nothing downstream is trustworthy until this is exact.
2. **Plain negamax + alpha-beta**, validated against full minimax on small positions.
3. **Iterative deepening + a transposition table** with correct flags and a depth guard.
4. **Move ordering** (TT move, captures, killers, history) — the biggest single speedup.
5. **Quiescence search** before trusting any material-based evaluation.
6. **Time management** (soft/hard limits, never lose on time).
7. **Selective heuristics** (null-move, LMR, extensions), each gated by SPRT.
8. **Parallel search** (Lazy SMP) last, with a deterministic fallback.

Skipping or misordering these steps is the usual cause of an engine that is fast but wrong, or correct but weak.

References to study further: Knuth & Moore on alpha-beta analysis; the Chess Programming Wiki (transposition tables, Zobrist, quiescence, null-move, LMR, Lazy SMP, SPRT); Russell & Norvig on adversarial search; Marsland & Campbell on parallel game-tree search. Sibling topics: `14-nim`, `15-sprague-grundy`, `17-game-dp`, `26-games-on-graphs`.
