# The 15-Puzzle and 8-Puzzle (IDA* / Heuristic Search) — Senior Level

> Manhattan distance solves easy 15-puzzles, but the hardest instances (optimal length 80) expand billions of nodes with it. The state of the art is **pattern database (PDB) heuristics** — precomputed exact distances for subsets of tiles, combined *additively* via disjoint partitions. The senior engineer's job is choosing the partition, building the PDBs within a memory budget, wiring them into IDA*, handling transpositions, and verifying optimality at scale.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Pattern Database Heuristics](#2-pattern-database-heuristics)
3. [Disjoint Additive PDBs](#3-disjoint-additive-pdbs)
4. [Building PDBs by Backward BFS](#4-building-pdbs-by-backward-bfs)
5. [Memory Engineering](#5-memory-engineering)
6. [IDA* vs A* Trade-offs at Scale](#6-ida-vs-a-trade-offs-at-scale)
7. [Transposition Handling](#7-transposition-handling)
8. [Code Examples](#8-code-examples)
9. [Testing and Observability](#9-testing-and-observability)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does IDA* work" but "what heuristic makes the hardest 15-puzzles solvable in milliseconds, and how do I build and ship it within a memory budget?". Manhattan distance, even with linear conflict, leaves a large gap to the true distance on hard boards, so IDA*'s effective branching factor stays high and the node count for an 80-move solution becomes astronomical.

The breakthrough is the **pattern database**: precompute, for a chosen subset of tiles, the *exact* minimum number of moves to put just those tiles in place (ignoring the others), store it in a table keyed by the tiles' positions, and look it up in `O(1)` during search. A single well-chosen PDB already dwarfs Manhattan; **disjoint additive PDBs** — partition the tiles into groups with non-overlapping move accounting and *sum* their database values — give an admissible heuristic strong enough to optimally solve every 15-puzzle quickly and to attack the 24-puzzle.

This document treats the production decisions: which partition, how to build the tables, how to fit them in RAM, how IDA* and A* trade off when a PDB is in play, and how to verify the result is genuinely optimal.

---

## 2. Pattern Database Heuristics

### 2.1 The core idea

Pick a subset `P` of the tiles (a *pattern*). Define a relaxed puzzle in which only the tiles in `P` (plus the blank) matter and the other tiles are indistinguishable "don't care" cells. The minimum number of moves to solve this relaxed puzzle from a given configuration is a **lower bound** on the moves to solve the full puzzle (you cannot solve the full puzzle without at least solving the sub-puzzle), so it is an **admissible heuristic**.

Crucially, the relaxed puzzle depends only on *where the pattern tiles are*, not on the other tiles. So we can enumerate all configurations of the pattern tiles, compute the exact distance for each by an exhaustive backward search **once**, and store them in a table. During IDA* we map the current board to its pattern configuration and read the distance in `O(1)`.

### 2.2 Why a PDB beats Manhattan

Manhattan is itself a (trivial) additive PDB where each "pattern" is a single tile — it sums per-tile distances *assuming the tiles never interfere*. A real PDB over a group of, say, 6 tiles captures their **interactions** (tiles blocking each other, needing detours, the blank's role), so its value is `≥` the sum of those tiles' Manhattan distances and often much larger. The bigger the pattern, the closer to the true distance — at the cost of an exponentially larger table.

### 2.3 Standard 15-puzzle partitions

| Partition | Groups | Table sizes | Strength |
|-----------|--------|-------------|----------|
| Manhattan (degenerate) | 15 singletons | trivial | weak |
| 7-8 split | tiles {1..7}, {8..15} | ~ 58M + 58M entries | strong, classic (Korf-Felner) |
| 5-5-5 split | three groups of 5 | smaller tables | weaker than 7-8 but cheaper |
| 6-6-3 | groups of 6,6,3 | medium | good balance |

The **7-8 additive PDB** (Korf & Felner) is the textbook strong heuristic for the 15-puzzle. For the 24-puzzle, 6-6-6-6 partitions are used.

### 2.4 A Concrete Heuristic-Value Comparison

To make the strength gap tangible, here is a typical comparison of heuristic values on a random hard 15-puzzle whose true optimal length is 56:

```
heuristic                       value   gap to optimum (56)
Hamming                         13      43
Manhattan                       42      14
Manhattan + linear conflict     46      10
7-8 additive PDB                52       4
7-8 PDB + reflection (max)      54       2
```

Each row's value is a valid lower bound (all admissible). The PDB closes most of the gap Manhattan leaves, and that small remaining gap is the difference between a search that expands billions of nodes and one that expands thousands — because node count scales like `b_eff^{gap}` in the unaccounted-for moves. This single table is the entire economic argument for pattern databases.

---

## 3. Disjoint Additive PDBs

### 3.1 The additivity condition

You may **sum** two PDB values only if their move accounts do not double-count. The standard construction: partition tiles into disjoint groups, and when computing each group's PDB, **count only moves of tiles in that group** (moving the blank or a tile outside the group costs 0 in that group's relaxed puzzle). Then a move of any single tile is charged to exactly one group, so the sum of group distances never exceeds the true total — the heuristic is admissible.

> **Additivity rule:** if each move in the real solution is counted in at most one group's database, then `h = Σ groupPDB` is admissible. Disjoint tile partitions with "count only own-group moves" satisfy this.

Contrast with **non-additive** (overlapping) PDBs, where the same move might be counted in two groups; those must be combined with `max`, not `+`, to stay admissible — and `max` is far weaker than `+`.

### 3.2 Why disjoint + sum is strong

`max(A, B)` can only be as large as the larger single database, but `A + B` can be much larger. By making the groups disjoint and charging each move once, we get to *add* — capturing interactions within each group while still summing across groups. This is the key insight that made optimal 15-puzzle solving routine.

### 3.3 Reflection and symmetry

A PDB is built for a specific tile group, but the puzzle has a diagonal symmetry: reflecting the board across the main diagonal maps tile positions and gives another valid lower bound from the *same* table (with tile relabeling). Taking the `max` of the heuristic and its reflected version costs one extra lookup and strengthens the bound for free. This is a standard, cheap booster on top of additive PDBs.

---

## 4. Building PDBs by Backward BFS

### 4.1 The construction

For each group, run a breadth-first search **backward from the goal** over the *abstract* state space where only the group's tiles (and the blank) have identity. Each abstract state's BFS depth is the exact minimum number of group-tile moves to reach it from the goal — which by symmetry equals the moves to solve it. Store depth in a table indexed by a perfect hash of the group tiles' positions.

```
buildPDB(group):
    start = abstract goal (group tiles in goal cells, others = don't care, blank in goal)
    dist[hash(start)] = 0
    queue = [start]
    while queue:
        s = dequeue
        for s' in abstractSuccessors(s):       # blank swaps with a cell
            cost = (movedTile in group) ? 1 : 0 # additive accounting
            if dist[hash(s')] unset or improved:
                dist[hash(s')] = dist[hash(s)] + cost
                enqueue s'
    return dist
```

Because moving a non-group tile costs 0, this is a **0/1-BFS** (use a deque: push 0-cost transitions to the front, 1-cost to the back) to get exact distances.

### 4.2 Indexing the table

Map the group's tile positions to a dense integer (a *ranking* of the partial permutation) so the table is a flat array. For a group of `m` tiles on a 16-cell board, there are `16 · 15 · … · (16−m+1)` placements; a lehmer-code / factorial-number-system rank gives a perfect minimal hash. The blank's position may or may not be part of the index depending on the variant (including it yields a slightly stronger but larger table).

### 4.3 Build cost

Building the 7-8 PDB is a one-time cost of enumerating tens of millions of abstract states per group — minutes of compute and produced once, then serialized to disk and memory-mapped at solver startup. Never rebuild per query.

### 4.4 Incremental PDB Lookup During Search

Recomputing the full additive heuristic at each node (re-ranking every group, doing every table lookup) is wasteful. As with incremental Manhattan, only the group containing the moved tile changes:

```
on move of tile t (in group P_i) from cell a to cell b:
    # only P_i's configuration changed; other groups are untouched
    old = aPDB[i][rank_i(before)]
    new = aPDB[i][rank_i(after)]
    h += new - old
    # the blank also moved; if the blank position is part of the index,
    # re-rank only P_i (still one group, not all)
```

Groups whose tiles did not move keep their cached value. This makes the per-node heuristic cost `O(group size)` rather than `O(N)`, a meaningful constant-factor win given the heuristic is evaluated at every one of millions of nodes. The incremental update must be validated against a full recompute in tests (Section 9), because a stale cached group value silently weakens the heuristic and inflates node counts.

### 4.5 Build-Time Pseudocode (Full Group)

```
buildAdditivePDB(group, goalBoard):
    table = array of size placements(|group|), filled with UNSET
    start = abstractGoal(group, goalBoard)   # group tiles home, rest don't-care
    table[rank(start)] = 0
    deque = [start]
    while deque not empty:
        s = deque.popFront()
        d = table[rank(s)]
        for s' in abstractSuccessors(s):     # blank swaps with a neighbor
            moved = tile that moved
            cost = 1 if moved in group else 0
            if table[rank(s')] == UNSET or d + cost < table[rank(s')]:
                table[rank(s')] = d + cost
                if cost == 0: deque.pushFront(s')   # 0/1-BFS ordering
                else:         deque.pushBack(s')
    return table
```

The 0/1-BFS deque ordering is essential: because non-group moves cost 0, a plain FIFO BFS would *not* yield correct shortest abstract distances; the front-push for 0-cost transitions preserves the monotone-distance invariant of BFS under mixed 0/1 weights.

---

## 5. Memory Engineering

### 5.1 Table sizes

The strength/size trade-off is the central PDB decision.

| Pattern size `m` | Placements (16 cells) | Bytes at 1 byte/entry |
|------------------|-----------------------|------------------------|
| 5 | 16·15·14·13·12 ≈ 524K | ~0.5 MB |
| 6 | ≈ 5.7M | ~5.7 MB |
| 7 | ≈ 57.6M | ~57 MB |
| 8 | ≈ 518M | ~518 MB |

Each entry needs only enough bits to store the max distance (≤ 80 < 128, so 1 byte; nibble-packing to 4 bits per entry halves it if max < 16, but 15-puzzle group distances exceed that). The 7-8 split is ~115 MB at one byte/entry — fits comfortably in RAM today; in 1997 it was a serious engineering feat.

### 5.2 Compression

PDBs compress well: nearby states have similar distances. Techniques include storing differences, lossy compression with a correction, or mapping multiple entries to one (taking the min, staying admissible). For embedded or memory-tight deployments these matter; for a server, the raw table is simplest.

### 5.3 Memory-mapping and sharing

Serialize the table once, `mmap` it read-only at startup, and share it across all solver threads and requests. It is immutable after construction, so no locking is needed. Rebuilding or reloading it per request is a classic latency and memory regression.

---

## 6. IDA* vs A* Trade-offs at Scale

### 6.1 Why IDA* is still preferred with PDBs

Even with a strong PDB, the 15-puzzle frontier in A* can hold tens of millions of nodes — more than the PDB itself. IDA* keeps `O(d)` memory regardless of heuristic strength. With a strong PDB the effective branching factor drops so far that IDA*'s re-exploration overhead is tiny, and the per-node cost is just a few table lookups. So PDB + IDA* is the canonical optimal solver.

### 6.2 When A* (or variants) win

- **Many queries on the same goal** where you can reuse the closed set — rare for puzzles.
- **Need the search tree / multiple solutions** — A*'s explicit structure helps.
- **Heuristic so strong the frontier is small** (e.g., near-perfect PDB on the 8-puzzle) — A* with a hash-based closed set avoids IDA*'s re-expansion.

Hybrid: **IDA* with a transposition table** (Section 7) or **MA*/SMA*** (memory-bounded A*) blend the two — use available memory to cache, fall back to re-search when full.

### 6.2b A Memory Budget Worked Example

Suppose a service has a 256 MB heuristic-memory budget. Options:

```
config              tables                     memory    strength
Manhattan only      none                       ~0        weak
Manhattan + LC      none                       ~0        medium
5-5-5 PDB           3 × ~0.5 MB                ~1.5 MB   strong
6-6-3 PDB           ~5.7 + ~5.7 + small MB     ~12 MB    stronger
7-8 PDB             ~57 + ~57 MB               ~115 MB   strongest (fits)
7-8 PDB + reflect   same tables, reused        ~115 MB   strongest + booster
```

The 7-8 PDB fits comfortably under 256 MB, so it is the right choice; reflection reuses the same tables (it relabels positions, not data), so the booster is free in memory. If the budget were 32 MB, the 6-6-3 split would be the strongest that fits. The decision is a direct strength-vs-budget lookup against this table.

### 6.3 The re-expansion overhead, quantified

IDA*'s total work is `Σ_i nodes(threshold_i)`. Because node counts grow geometrically with the threshold for a branching tree, the last iteration dominates and the overhead is a small constant factor. The pathological case is a *polynomially* growing tree (e.g., a nearly-linear graph), where re-expansion can be quadratic — not the case for the puzzle, whose tree branches.

---

## 7. Transposition Handling

### 7.1 The problem

IDA* has no closed set, so it re-visits states reached by different move orders (transpositions) and re-explores their subtrees. The reverse-move check kills 2-cycles; longer transpositions leak through.

### 7.2 A bounded transposition table

Add a fixed-size hash table mapping `state → (g, threshold-at-which-pruned)`. Before expanding a node, check whether the same state was already seen at this iteration with `g' ≤ g`; if so, this path is dominated and can be cut. Keep the table size bounded (LRU or simple overwrite) to preserve IDA*'s memory advantage — a few hundred MB cache, not the full frontier.

### 7.3 Caveats

The table must be reset or versioned per IDA* iteration (a `g` valid under one threshold may not dominate under another), and the dominance test must be sound (cutting only when truly dominated) to preserve optimality. Done correctly, it can cut node counts significantly on graphs with many transpositions; done carelessly it breaks optimality. For the 15-puzzle with strong PDBs the win is modest; for puzzles with denser transposition structure it is larger.

---

## 8. Code Examples

### 8.1 Go — additive PDB lookup wired into IDA* (heuristic interface)

```go
package main

import "fmt"

const SIDE = 4

// A PDB group: the tiles it tracks and a precomputed distance table.
type PDB struct {
	tiles map[int]bool   // tiles in this group
	table map[uint64]int // ranked positions -> exact group-move distance
}

// rank encodes the positions of this group's tiles into a key.
func (p *PDB) rank(board []int) uint64 {
	var key uint64
	for i, v := range board {
		if p.tiles[v] {
			key = key*16 + uint64(i) // positional encoding (simplified)
		}
	}
	return key
}

func (p *PDB) value(board []int) int {
	if d, ok := p.table[p.rank(board)]; ok {
		return d
	}
	return 0 // fallback; a real PDB is complete so this never triggers
}

// Additive heuristic: sum disjoint PDB groups. Each move counted once.
func heuristic(board []int, pdbs []*PDB) int {
	h := 0
	for _, p := range pdbs {
		h += p.value(board)
	}
	return h
}

// IDA* driver using the additive PDB heuristic (skeleton).
func idaStar(board []int, pdbs []*PDB) int {
	h := heuristic(board, pdbs)
	bound := h
	for {
		t := dfs(board, indexOf(board, 0), 0, h, bound, -1, pdbs)
		if t == -1 {
			return bound // solved at this bound (optimal length)
		}
		if t == 1<<30 {
			return -1
		}
		bound = t
	}
}

func dfs(b []int, blank, g, h, bound, prev int, pdbs []*PDB) int {
	f := g + h
	if f > bound {
		return f
	}
	if h == 0 {
		return -1
	}
	dr := []int{-1, 1, 0, 0}
	dc := []int{0, 0, -1, 1}
	r, c := blank/SIDE, blank%SIDE
	min := 1 << 30
	for d := 0; d < 4; d++ {
		nr, nc := r+dr[d], c+dc[d]
		if nr < 0 || nr >= SIDE || nc < 0 || nc >= SIDE {
			continue
		}
		ni := nr*SIDE + nc
		if ni == prev {
			continue
		}
		b[blank], b[ni] = b[ni], b[blank]
		nh := heuristic(b, pdbs) // a real impl updates incrementally
		t := dfs(b, ni, g+1, nh, bound, blank, pdbs)
		if t == -1 {
			return -1
		}
		if t < min {
			min = t
		}
		b[blank], b[ni] = b[ni], b[blank]
	}
	return min
}

func indexOf(b []int, v int) int {
	for i, x := range b {
		if x == v {
			return i
		}
	}
	return -1
}

func main() {
	// In production, load serialized PDB tables here.
	fmt.Println("PDB-backed IDA* skeleton")
}
```

### 8.2 Java — building a PDB by backward 0/1-BFS (group accounting)

```java
import java.util.*;

public class BuildPDB {
    static final int SIDE = 4;
    static final int[] DR = {-1, 1, 0, 0};
    static final int[] DC = {0, 0, -1, 1};

    // tiles in the group; non-group tile moves cost 0 (additive accounting).
    static Map<Long, Integer> build(Set<Integer> group, int[] goal) {
        Map<Long, Integer> dist = new HashMap<>();
        Deque<int[]> dq = new ArrayDeque<>();
        long key = rank(goal, group);
        dist.put(key, 0);
        dq.add(goal.clone());
        while (!dq.isEmpty()) {
            int[] s = dq.pollFirst();
            int blank = indexOf(s, 0);
            int base = dist.get(rank(s, group));
            int r = blank / SIDE, c = blank % SIDE;
            for (int d = 0; d < 4; d++) {
                int nr = r + DR[d], nc = c + DC[d];
                if (nr < 0 || nr >= SIDE || nc < 0 || nc >= SIDE) continue;
                int ni = nr * SIDE + nc;
                int[] ns = s.clone();
                int moved = ns[ni];
                ns[blank] = moved; ns[ni] = 0;
                int cost = group.contains(moved) ? 1 : 0;
                long nk = rank(ns, group);
                Integer cur = dist.get(nk);
                if (cur == null || base + cost < cur) {
                    dist.put(nk, base + cost);
                    if (cost == 0) dq.addFirst(ns); else dq.addLast(ns); // 0/1-BFS
                }
            }
        }
        return dist;
    }

    static long rank(int[] board, Set<Integer> group) {
        long key = 0;
        for (int i = 0; i < board.length; i++)
            if (group.contains(board[i])) key = key * 16 + i;
        return key;
    }

    static int indexOf(int[] b, int v) {
        for (int i = 0; i < b.length; i++) if (b[i] == v) return i;
        return -1;
    }

    public static void main(String[] args) {
        int[] goal = new int[16];
        for (int i = 0; i < 15; i++) goal[i] = i + 1;
        goal[15] = 0;
        Set<Integer> group = new HashSet<>(Arrays.asList(1, 2, 3, 4, 5, 6, 7));
        Map<Long, Integer> pdb = build(group, goal);
        System.out.println("PDB entries: " + pdb.size());
    }
}
```

### 8.3 Python — disjoint additive heuristic + reflection max

```python
SIDE = 4
GOAL = tuple(list(range(1, 16)) + [0])


def manhattan_group(board, group):
    """Lower bound for one tile group (a degenerate PDB = sum of Manhattan)."""
    d = 0
    for i, v in enumerate(board):
        if v in group:
            gr, gc = (v - 1) // SIDE, (v - 1) % SIDE
            d += abs(i // SIDE - gr) + abs(i % SIDE - gc)
    return d


def additive_heuristic(board, groups):
    """Sum disjoint groups; each tile counted once -> admissible."""
    return sum(manhattan_group(board, g) for g in groups)


def reflect(board):
    """Reflect across the main diagonal (positions and tile labels)."""
    out = [0] * 16
    for i, v in enumerate(board):
        r, c = i // SIDE, i % SIDE
        out[c * SIDE + r] = reflect_tile(v)
    return out


def reflect_tile(v):
    if v == 0:
        return 0
    r, c = (v - 1) // SIDE, (v - 1) % SIDE
    return c * SIDE + r + 1


def heuristic(board, groups):
    direct = additive_heuristic(board, groups)
    reflected = additive_heuristic(reflect(board), groups)
    return max(direct, reflected)  # reflection booster, still admissible


if __name__ == "__main__":
    groups = [frozenset(range(1, 8)), frozenset(range(8, 16))]  # 7-8 split shape
    board = list(GOAL)
    board[14], board[15] = board[15], board[14]
    print("h =", heuristic(board, groups))
```

---

## 9. Testing and Observability

A heuristic bug silently returns sub-optimal solutions that *look* valid. Build verification in.

| Check | Why |
|-------|-----|
| BFS optimal-length match on the 8-puzzle | Ground truth for hundreds of random solvable boards. |
| Admissibility assertion: `h(s) ≤ trueDist(s)` | On small boards where `trueDist` is computable, assert `h` never exceeds it. |
| `h(goal) == 0` | The heuristic must be exactly 0 at the goal. |
| Consistency check: `h(s) ≤ 1 + h(s')` for neighbors | Catches PDB indexing bugs; Manhattan and proper PDBs are consistent. |
| PDB completeness | Every reachable abstract pattern config has a table entry. |
| Solution replay validity | Apply the returned moves to the start; assert it reaches the goal. |
| Reflection consistency | `max(direct, reflected)` must still be ≤ true distance. |
| Cross-language determinism | Same board → same optimal length in Go/Java/Python. |

The single most valuable test is **BFS optimal-length parity on the 8-puzzle**: it catches inadmissible heuristics (which give too-short answers) and broken IDA* threshold logic (which gives too-long ones) at once.

### 9.1 Production guardrails

Log the optimal length and node count per solve; an anomalously high node count flags a weakened heuristic (e.g., a PDB failing to load and falling back to Manhattan). Validate the returned solution by replaying it before returning — a cheap `O(d)` check that guarantees correctness even if a heuristic regressed.

---

## 10. Failure Modes

### 10.1 Inadmissible additive PDB (double-counted moves)

If two groups both charge for the same tile's move, the sum can exceed the true distance and IDA* returns a *too-short* (invalid) "solution" or prunes the real one. Mitigation: enforce disjoint groups and "count only own-group moves"; verify admissibility against BFS truth on small boards.

### 10.2 PDB fails to load → silent weak fallback

If the serialized table is missing and the code falls back to Manhattan, the solver still works but explodes in node count on hard boards. Mitigation: assert the table loaded; log node counts and alert on regression.

### 10.3 Bad ranking / hash collisions

A buggy permutation rank maps two pattern configs to the same entry, corrupting distances. Mitigation: verify the rank is a bijection (round-trip rank↔unrank) and that the table size matches the placement count exactly.

### 10.4 Searching an unsolvable board

Without the parity gate, IDA* explores its entire reachable half forever. Mitigation: parity test first, always.

### 10.5 Transposition table breaking optimality

An unsound dominance cut (pruning a node that was *not* actually dominated) makes IDA* miss the optimal path. Mitigation: prune only on `g' ≤ g` same-state dominance, version the table per iteration, and test optimality against BFS.

### 10.6 Stack overflow on 80-move solutions

Deep recursion plus per-frame state can overflow. Mitigation: iterative stack or raised limit; keep per-frame data minimal (in-place make/undo).

### 10.7 Reflection mis-mapping

A wrong diagonal-reflection of tile labels or positions yields a non-admissible "reflected" heuristic that overestimates. Mitigation: unit-test that `reflect(reflect(b)) == b` and that the reflected heuristic equals the direct one on symmetric boards.

---

## 11. Summary

- Manhattan (even with linear conflict) leaves a large gap to true distance on hard 15-puzzles; **pattern databases** close it by precomputing exact distances for tile subsets and looking them up in `O(1)`.
- A PDB is admissible because solving the relaxed sub-puzzle is a lower bound on solving the full puzzle. **Disjoint additive PDBs** let you *sum* group distances (not just `max`) by charging each move to exactly one group — the additivity condition — yielding a far stronger heuristic.
- Build PDBs by **backward 0/1-BFS** over the abstract state space (group-tile moves cost 1, others 0), indexed by a perfect permutation rank, computed once and memory-mapped read-only.
- The 7-8 split (~115 MB) is the classic strong 15-puzzle heuristic; reflection across the diagonal gives a free `max` booster.
- **IDA* remains preferred** even with strong PDBs because its `O(d)` memory beats A*'s frontier; a bounded **transposition table** can recover some of A*'s cycle-cutting without giving up the memory win — if the dominance test stays sound.
- Verify relentlessly: BFS optimal-length parity on the 8-puzzle, `h(goal)=0`, admissibility and consistency assertions, PDB completeness, and solution replay.

### Decision summary

- **Easy/medium 15-puzzles** → IDA* + Manhattan + linear conflict.
- **Hard 15-puzzles (up to 80 moves)** → IDA* + 7-8 additive PDB + reflection.
- **24-puzzle** → IDA* + 6-6-6-6 additive PDBs.
- **Tight memory** → smaller partition (5-5-5) or compressed PDB.
- **Many transpositions** → IDA* + bounded transposition table (sound dominance only).
- **Need any solution fast, not optimal** → weighted/greedy heuristic search (gives up optimality).

References to study further: Korf (1985) IDA*; Culberson & Schaeffer (1998) pattern databases; Korf & Felner (2002) disjoint additive PDBs for the 15- and 24-puzzle; Felner, Korf & Hanan (2004) additive PDB theory; the linear-conflict heuristic (Hansson, Mayer, Yung); and memory-bounded A* (SMA*).
