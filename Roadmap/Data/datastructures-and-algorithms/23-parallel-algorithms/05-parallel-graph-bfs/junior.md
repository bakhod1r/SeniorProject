# Parallel Graph BFS — Junior Level

> **Audience:** You know work and span (the two-number cost model from the first topic in this section), you've seen the reduction tree, and you've met the [parallel scan](../02-parallel-prefix-sum-scan/junior.md) that filters and packs an array in `Θ(log n)` span. You also know ordinary breadth-first search — the queue-based level-by-level walk of a graph. Now you'll see how to do that *same* traversal with many processors at once, by expanding a whole **level** (a "frontier") in parallel instead of one vertex at a time.
> **Read time:** ~40 minutes. **Focus:** "Sequential BFS pulls one vertex off a queue at a time — so how do I make it parallel? The answer is to stop thinking 'one vertex' and start thinking 'one whole ring (frontier) at a time' — and the cost story is entirely about how *deep* the graph is."

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Sequential BFS: One Vertex at a Time](#sequential-bfs-one-vertex-at-a-time)
5. [The Frontier Picture: Expand a Whole Ring at Once](#the-frontier-picture-expand-a-whole-ring-at-once)
6. [Level-Synchronous BFS, Round by Round](#level-synchronous-bfs-round-by-round)
7. [A Worked Example, Traced Level by Level](#a-worked-example-traced-level-by-level)
8. [Counting Work and Span](#counting-work-and-span)
9. [Why Diameter Is the Whole Story](#why-diameter-is-the-whole-story)
10. [The Duplicate-Neighbor Problem and the Visited-Claim Fix](#the-duplicate-neighbor-problem-and-the-visited-claim-fix)
11. [Building the Next Frontier with a Scan](#building-the-next-frontier-with-a-scan)
12. [Code: Level-Synchronous BFS](#code-level-synchronous-bfs)
13. [Code: Simulating the Parallel Neighbor Expansion](#code-simulating-the-parallel-neighbor-expansion)
14. [Common Misconceptions](#common-misconceptions)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

You already know **breadth-first search**. Drop a marker on a starting vertex, then explore the graph in rings of increasing distance: first all the immediate neighbors (distance 1), then *their* unvisited neighbors (distance 2), and so on, until you've reached everything reachable. The classic way to code this uses a **queue**: push the source, then repeatedly pop one vertex, look at its neighbors, and push any you haven't seen. That queue ordering is what guarantees you visit vertices in distance order — closest first. If you need a refresher, sequential BFS lives at [Graphs → BFS](../../11-graphs/02-bfs/junior.md).

Here's the tension. That queue processes **one vertex at a time**. Pop, scan its neighbors, push, pop the next, scan, push… It's a strictly serial loop — each pop waits for the previous one to finish. If you had a thousand processors, the plain queue-BFS couldn't use them: there's nothing for processor 2 to do while processor 1 holds the queue. So how do we parallelize a traversal whose entire structure is "process the queue in order"?

The answer is a shift in *what unit you process*. Sequential BFS thinks one vertex at a time. **Parallel BFS thinks one whole level at a time.** Picture the rings again: all the vertices at distance `k` from the source form a set called the **frontier** (sometimes the "wavefront"). The crucial observation is that *every vertex in the current frontier can expand at the same instant* — vertex A looking at its neighbors doesn't need to wait for vertex B to look at *its* neighbors. They're independent. So instead of popping one vertex, we take the *entire* current frontier and, **in parallel**, have every frontier vertex inspect its neighbors. Any neighbor we haven't visited yet joins the **next** frontier (and gets distance `k+1`). Then we repeat with that next frontier. Each round advances the search by exactly one BFS level.

This is **level-synchronous** (or **frontier-based**) BFS, and it's the standard way real systems do parallel breadth-first search. The "synchronous" part is important and it's also the catch: you must *finish* expanding level `k` before you can start level `k+1`, because you don't know which vertices are at distance `k+1` until you've seen the whole level `k` frontier. So the **levels are inherently sequential** — but **each level's work is parallel.** That single sentence is the entire cost story, and it leads to a beautiful, simple conclusion: parallel BFS does the same `Θ(V + E)` total **work** as sequential BFS, but its **span** is about `Θ(D · log n)`, where `D` is the graph's **diameter** — the number of levels. Shallow graphs (small diameter, like a social network where everyone is six hops apart) parallelize wonderfully; long, path-like graphs (huge diameter) barely parallelize at all.

There are two genuinely tricky bits, and we'll meet both. First, two different frontier vertices might *simultaneously* discover the same unvisited neighbor — and if both claim it, that neighbor lands in the next frontier *twice*. We fix that with an **atomic visited-claim**: exactly one discoverer wins. Second, gathering all the newly-discovered vertices into a packed next-frontier array, in parallel, is precisely the [stream-compaction / scan](../02-parallel-prefix-sum-scan/junior.md) trick you already know — flags, scan, scatter.

This file builds the whole picture from the queue you already know. We'll contrast the one-vertex queue against the whole-frontier ring; spell out the level-synchronous loop; trace a small graph level by level, drawing the frontier sets as they grow and shrink; count work `Θ(V + E)` and span `Θ(D · log n)` with the "levels sequential, each level parallel" insight; explain why diameter is everything; solve the duplicate-neighbor problem with an atomic claim; and connect the next-frontier build to scan. You'll get runnable code: a level-synchronous BFS that processes each frontier as a unit (and can simulate the parallel neighbor expansion), tracking distances and showing the frontier breathe.

---

## Prerequisites

- **Required:** The **work–span model** — what work `T₁` (total operations, time on one processor) and span `T∞` (longest dependency chain, time on infinitely many processors) mean, and that **parallelism = work / span**. It's all set up in [Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md). We use it on every page.
- **Required:** **Sequential BFS** — the queue-based, level-by-level graph traversal, and the idea that BFS computes shortest distances in an *unweighted* graph. See [Graphs → BFS](../../11-graphs/02-bfs/junior.md).
- **Required:** **Parallel scan / stream compaction** — flags → exclusive scan → scatter, the `Θ(log n)`-span way to filter and pack an array in parallel. We reuse it to build the next frontier. See [Parallel Prefix Sum (Scan)](../02-parallel-prefix-sum-scan/junior.md).
- **Helpful:** **Map** as the embarrassingly-parallel "do the same thing to every element" primitive — expanding a frontier *is* a map over frontier vertices. See [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md).
- **Helpful:** A vague sense of an **atomic operation** (like compare-and-swap) — one indivisible read-modify-write that two threads can't both "win." We explain exactly the bit we need where we need it.
- **Helpful:** Graph basics — vertices `V`, edges `E`, adjacency lists, and that BFS touches each vertex and edge once. Big-O comfort with `Θ(V + E)`, `Θ(log n)`, `Θ(D)`.

No calculus, no probability, no specific hardware. Every cost is counted by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **BFS (breadth-first search)** | Traverse a graph in order of distance from a source: all distance-1 vertices, then all distance-2, and so on. |
| **Frontier (wavefront)** | The set of vertices at the *current* BFS distance `k` from the source — the ring we're about to expand. |
| **Next frontier** | The set of newly discovered (previously unvisited) vertices at distance `k+1`, formed by expanding the current frontier. |
| **Level-synchronous BFS** | Parallel BFS that processes one whole level (frontier) per round: expand all frontier vertices in parallel, build the next frontier, repeat. |
| **Level / round** | One iteration: expanding the distance-`k` frontier to produce the distance-`k+1` frontier. The number of rounds equals the number of BFS levels. |
| **Distance / `dist[v]`** | The BFS distance from the source to `v` (number of edges on the shortest path). `dist[source] = 0`. |
| **Visited** | A vertex that has already been discovered and assigned a distance, so it must not be added to a frontier again. |
| **Visited-claim (atomic)** | An indivisible "test-and-set": the *first* discoverer of a vertex marks it visited; everyone else sees it's taken. Prevents duplicates. |
| **Diameter `D`** | The largest shortest-path distance between any two vertices — the number of BFS levels in the worst case. The span depends on it. |
| **Work `T₁` / Span `T∞`** | (From the first topic.) Work = total operations; span = longest dependency chain. Parallelism = `T₁/T∞`. |
| **Stream compaction / scan** | Filter-and-pack an array in parallel via flags → exclusive scan → scatter; how the next frontier is built. |

---

## Sequential BFS: One Vertex at a Time

Let's start from what you already know, so the parallel version is a clean *contrast*. Here is ordinary queue-based BFS, computing the distance from a `source` to every reachable vertex:

```
sequential BFS(source):
  dist[source] = 0
  visited[source] = true
  queue = [source]
  while queue is not empty:
      v = queue.pop_front()           ← ONE vertex, popped in order
      for each neighbor u of v:
          if not visited[u]:
              visited[u] = true
              dist[u]   = dist[v] + 1
              queue.push_back(u)
```

The queue is the engine. Because we always pop from the front and push to the back (FIFO), vertices come out in distance order: the source first, then all its neighbors, then all *their* new neighbors, and so on. That ordering is *why* BFS computes correct shortest distances — `dist[u] = dist[v] + 1` is right precisely because `v` was popped before any distance-`(k+2)` vertex.

Now look at the shape of the loop with parallel eyes. **Every iteration pops exactly one vertex and works on it.** The next `pop_front` can't happen until this iteration finishes pushing. The whole computation is a single serial chain of pops — work `Θ(V + E)` (we touch every vertex once and every edge once), but the dependency structure is "pop, then pop, then pop," a chain as long as `V`. In work–span terms that's **span `Θ(V)`, parallelism `Θ(1)`** — a thousand processors are useless, because there's one queue and one vertex in flight at a time.

```
  the sequential queue is a CHAIN of pops (span ≈ V):

   pop s → pop n1 → pop n2 → pop n3 → ... → pop (last vertex)
   (each pop waits for the previous one; one vertex processed at a time)
```

But here's the thing the queue *hides*: the vertices it pops in a row that are all at the *same distance* don't actually depend on each other. When the queue holds `[n1, n2, n3]` and all three are at distance 1, popping `n1` and looking at its neighbors has **nothing to do with** popping `n2` and looking at *its* neighbors. The queue *serializes* them only because a FIFO queue is a one-at-a-time data structure — not because the work demands it. That hidden independence is exactly the parallelism we're going to harvest. The fix is to stop using "one vertex" as the unit and use "one whole distance-level" as the unit instead.

> **The mental model to drop:** "BFS = pop vertices off a queue one by one." That framing *manufactures* a serial chain. **The mental model to adopt:** "BFS = expand rings of increasing distance, and a whole ring expands at once." The queue was never essential — it was just a convenient way to enforce distance order on one processor. With many processors, we enforce distance order by *levels* instead.

---

## The Frontier Picture: Expand a Whole Ring at Once

Replace the queue with a **frontier**: the *set* of all vertices at the current distance `k`. Forget order *within* the set — the only thing that matters is that we finish the whole distance-`k` set before touching distance `k+1`. Here's the picture. The source is the center; each ring is a frontier:

```
       distance 0        distance 1            distance 2
        (source)        (the frontier          (the next frontier
                         we expand now)         we're building)

           ●  ──────────►  ● ● ●  ──────────►  ● ● ● ● ●
         source            ↑                       ↑
                    expand ALL of these         everything newly
                    AT THE SAME TIME            discovered lands here
```

A **round** of parallel BFS takes the current frontier and, **in parallel over every vertex in it**, looks at that vertex's neighbors. Any neighbor that hasn't been visited yet is *discovered*: we mark it visited, set its distance to `k+1`, and drop it into the **next frontier**. When every frontier vertex has finished expanding, the next frontier *becomes* the current frontier, `k` ticks up by one, and we go again. We stop when a round produces an **empty** next frontier — there's nothing left to discover.

```
  one ROUND of level-synchronous BFS:

   current frontier (distance k):   [ v1   v2   v3   v4 ]
                                       │    │    │    │
   expand ALL in parallel  ─────────►  look at each one's neighbors AT ONCE
                                       │    │    │    │
                                       ▼    ▼    ▼    ▼
   newly discovered (distance k+1):  collect the unvisited neighbors
                                       │
                                       ▼
   next frontier (distance k+1):    [ u1   u2   u3   u4   u5 ]   ← becomes "current" next round
```

Compare the two units side by side. The queue pops `[v1, v2, v3, v4]` one at a time — four serial steps. The frontier expands `{v1, v2, v3, v4}` *all at once* — one parallel step. Same vertices, same neighbor-lookups, same total work. The only difference is **when** they happen relative to each other: serially in the queue, simultaneously in the frontier. This is the *exact same move* you saw turn a left-to-right fold into a reduction tree — independent work that the naive algorithm serialized, freed to run in parallel. Here, the independence is "all vertices at the same distance expand independently," and the frontier is the data structure that lets us exploit it.

> **The key reframing:** a **frontier is just "the queue's contents at one distance, treated as a set you expand all at once."** Sequential BFS drains that set one pop at a time; parallel BFS expands the whole set in one parallel step. The vertices in a frontier never depended on each other — the queue only made it *look* that way. Expanding the frontier as a unit is what unlocks the parallelism.

---

## Level-Synchronous BFS, Round by Round

Let's write the level-synchronous algorithm precisely. We keep an array `dist[]` (distance from the source, `−1` for "not yet reached"), a `frontier` (the current distance-`k` set), and we build a `next_frontier` each round.

```
level-synchronous BFS(source):
  dist[*]   = -1                       ← -1 means "unvisited"
  dist[source] = 0
  frontier  = [ source ]               ← level 0 is just the source
  k = 0
  while frontier is not empty:
      next_frontier = [ ]
      ── EXPAND, in parallel over every v in frontier: ──
      for each v in frontier:                     (PARALLEL across v)
          for each neighbor u of v:               (PARALLEL across u, too)
              if claim(u):                         ← atomic: first discoverer wins
                  dist[u] = k + 1
                  add u to next_frontier            (collected via a scan)
      ── end parallel region ──
      frontier = next_frontier
      k = k + 1
  return dist
```

Read the structure carefully — there are **two nested levels of parallelism** and **one strict serialization**:

- **Parallel across the frontier.** Every vertex `v` in the current frontier is expanded at the same time. This is a **map** over the frontier (see [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md)): do the same independent thing — "scan my neighbors" — to each frontier vertex.
- **Parallel across each vertex's neighbors.** Even a single high-degree vertex (a hub with a million neighbors) can have its neighbor-list scanned in parallel. So the work inside one round is "for all frontier vertices, for all their neighbors, in parallel."
- **Serial across levels.** The `while` loop's iterations are **not** parallel. You cannot start the level-`k+1` expansion until level `k` is fully done, because *which* vertices are at distance `k+1` is only known once you've seen every distance-`k` vertex's neighbors. **This is the one unavoidable sequential chain in BFS**, and it has length `D` (the number of levels). Everything else parallelizes.

The two starred lines hide the two tricky bits we'll unpack soon. `claim(u)` is the **atomic visited-claim** — it returns `true` for exactly one discoverer of `u`, so a vertex enters the next frontier exactly once even if several frontier vertices point at it. And "add `u` to `next_frontier`" can't be a naive append from many threads (they'd collide on the array's end); it's done with a **scan-based compaction** so every newly-discovered vertex gets a distinct slot. Hold those thoughts; first let's *see* the algorithm run.

```
  the shape of level-synchronous BFS:

   level 0:  [source]              ─ expand (parallel) ─►  level 1 frontier
   level 1:  [...]                 ─ expand (parallel) ─►  level 2 frontier
   level 2:  [...]                 ─ expand (parallel) ─►  level 3 frontier
   ...                                                     ...
   level D:  [last ring]           ─ expand (parallel) ─►  EMPTY → stop

   ↑ D rounds, each round STRICTLY after the previous (serial)
     but each round's expansion is fully PARALLEL inside.
```

---

## A Worked Example, Traced Level by Level

Let's trace the algorithm on a concrete graph so the frontiers become real. Here's an undirected graph with 8 vertices, labeled `0`–`7`. We'll BFS from `source = 0`.

```
  the graph (undirected; each line is an edge):

        0 ── 1        adjacency lists:
        │    │          0: [1, 2]
        2 ── 3          1: [0, 3]
        │    │          2: [0, 3, 4]
        4    5          3: [1, 2, 5]
        │    │          4: [2, 6]
        6 ── 7          5: [3, 7]
                        6: [4, 7]
                        7: [5, 6]
```

Start: `dist[0] = 0`, everything else `−1`. The level-0 frontier is just `{0}`.

**Round 0 — expand frontier `{0}` (distance 0 → 1).** Vertex 0's neighbors are `1` and `2`. Both are unvisited, so both are discovered, get `dist = 1`, and join the next frontier:

```
  frontier {0}:  expand 0 → neighbors 1, 2  (both unvisited → claim both)
     dist[1] = 1,  dist[2] = 1
  next frontier = {1, 2}

  dist so far:  0:0  1:1  2:1  3:-  4:-  5:-  6:-  7:-
```

**Round 1 — expand frontier `{1, 2}` (distance 1 → 2), in parallel.** Vertex 1's neighbors: `0` (visited, skip), `3` (new!). Vertex 2's neighbors: `0` (visited), `3` (new!), `4` (new!). Notice **both 1 and 2 point at vertex 3** — this is the duplicate-neighbor situation we'll fix; for now, the atomic claim ensures 3 enters the next frontier *once*:

```
  frontier {1, 2}:  expand BOTH in parallel
     vertex 1 → 0 (visited), 3 (CLAIM 3)
     vertex 2 → 0 (visited), 3 (already claimed by 1 — skip), 4 (CLAIM 4)
     dist[3] = 2,  dist[4] = 2
  next frontier = {3, 4}      ← 3 appears ONCE, not twice

  dist so far:  0:0  1:1  2:1  3:2  4:2  5:-  6:-  7:-
```

**Round 2 — expand frontier `{3, 4}` (distance 2 → 3), in parallel.** Vertex 3's neighbors: `1` (visited), `2` (visited), `5` (new!). Vertex 4's neighbors: `2` (visited), `6` (new!):

```
  frontier {3, 4}:  expand BOTH in parallel
     vertex 3 → 1 (visited), 2 (visited), 5 (CLAIM 5)
     vertex 4 → 2 (visited), 6 (CLAIM 6)
     dist[5] = 3,  dist[6] = 3
  next frontier = {5, 6}

  dist so far:  0:0  1:1  2:1  3:2  4:2  5:3  6:3  7:-
```

**Round 3 — expand frontier `{5, 6}` (distance 3 → 4), in parallel.** Vertex 5's neighbors: `3` (visited), `7` (new!). Vertex 6's neighbors: `4` (visited), `7` (new!). Again **both 5 and 6 point at vertex 7** — the claim makes it appear once:

```
  frontier {5, 6}:  expand BOTH in parallel
     vertex 5 → 3 (visited), 7 (CLAIM 7)
     vertex 6 → 4 (visited), 7 (already claimed by 5 — skip)
     dist[7] = 4
  next frontier = {7}

  dist so far:  0:0  1:1  2:1  3:2  4:2  5:3  6:3  7:4
```

**Round 4 — expand frontier `{7}` (distance 4 → 5).** Vertex 7's neighbors: `5` (visited), `6` (visited). Nothing new is discovered:

```
  frontier {7}:  expand 7 → 5 (visited), 6 (visited)
  next frontier = {}      ← EMPTY → stop
```

The next frontier is empty, so BFS halts. Stack the whole run to see the frontiers breathe — growing, then shrinking:

```
  LEVEL 0:  { 0 }            size 1      ← source
  LEVEL 1:  { 1, 2 }         size 2      ← grew
  LEVEL 2:  { 3, 4 }         size 2
  LEVEL 3:  { 5, 6 }         size 2
  LEVEL 4:  { 7 }            size 1      ← shrank
  LEVEL 5:  { }              size 0      ← empty, done

  final distances:  0→0  1→1  2→1  3→2  4→2  5→3  6→3  7→4
```

Five rounds (the empty one closes it out), and we visited all 8 vertices. The number of rounds is the number of levels — **5 here** — and the deepest distance is **4**, the graph's diameter from vertex 0. Notice every round's expansion was *parallel inside* (both frontier vertices expanded at once), but the rounds themselves were *strictly ordered*: we could not know level 2 until level 1 was done. That is the entire cost story, which we now make precise.

---

## Counting Work and Span

Put the two numbers on level-synchronous BFS.

- **Work `T₁ = Θ(V + E)`.** Count what gets touched across the *whole* run. Each vertex enters a frontier **exactly once** — the moment it's discovered (the visited-claim guarantees "exactly once"). So summed over all rounds, every vertex is expanded once: that's `Θ(V)` vertex-work. And expanding a vertex means scanning its neighbor list, i.e. looking at each of its incident edges once; summed over all vertices, that's every edge looked at once (or twice, in an undirected graph): `Θ(E)` edge-work. Total **`Θ(V + E)`** — *exactly the same work as sequential BFS.* Parallel BFS does not do extra work; it just rearranges *when* the work happens. (This is the "work-efficient" property: same total work as the best serial algorithm.)

- **Span `T∞ = Θ(D · log n)`.** The span is the longest dependency chain. The rounds form a chain of length `D` (the number of levels / the diameter) — round `k+1` *must* wait for round `k`. So the span is `D` rounds multiplied by the span *of one round*. What's the span of a single round? Inside a round, expanding the whole frontier is a parallel map over frontier vertices and their neighbors — that part is shallow (essentially `Θ(1)` if you have enough processors). But **building the next frontier** — compacting all the newly-discovered vertices into a packed array — uses a [parallel scan](../02-parallel-prefix-sum-scan/junior.md), which has span `Θ(log n)`. So one round costs `Θ(log n)` span, and `D` rounds in a chain give **span `Θ(D · log n)`.**

- **Parallelism `T₁/T∞ = Θ((V + E) / (D · log n))`.** How big this is depends *entirely* on `D`. For a shallow graph where `D` is small — say a social network where `D ≈ 6` — the denominator is tiny and the parallelism is enormous (millions of edges over a handful of rounds). For a path-like graph where `D ≈ V` — a long chain of vertices — the parallelism collapses toward `Θ(1)`, because there are `V` levels with one vertex each and nothing to expand in parallel.

```
                       Work T₁     Span T∞        Parallelism
  sequential BFS       Θ(V + E)    Θ(V)           Θ(1)            ← one vertex at a time
  level-sync BFS       Θ(V + E)    Θ(D · log n)   Θ((V+E)/(D log n))

  SAME work. The whole difference is span:  V  vs  D·log n.
```

The pattern should feel familiar: it's the same shape as the reduction tree vs. the serial fold, and the sequential scan vs. Hillis–Steele. The *work* is identical to the best sequential algorithm; the *span* is what we drove down. And the lever for the span is `D` — the depth of the graph. Let's understand why `D` is the whole story.

> **The headline insight, in one line:** **the levels of BFS are inherently sequential (a chain of length `D`), but each level's expansion is fully parallel.** So span `≈ D × (cost of one level) = D · log n`, while the work stays `Θ(V + E)`. Parallel BFS converts "process `V` vertices in series" into "process `D` levels in series, each level in parallel."

---

## Why Diameter Is the Whole Story

Since the span is `Θ(D · log n)` and the work is fixed at `Θ(V + E)`, the *only* knob that decides how well parallel BFS performs is the **diameter** `D` — the number of levels, i.e. the largest shortest-path distance from the source. Let's build intuition with two extreme graphs.

**Extreme 1: the shallow graph (small `D`) — parallel BFS shines.** Imagine a social network with a billion people, where any two are connected within about six hops ("six degrees of separation"). Here `D ≈ 6`, but the frontiers are *gigantic* — after a couple of hops, a single frontier might hold hundreds of millions of vertices. Sequential BFS would pop those hundreds of millions one at a time; parallel BFS expands each whole frontier in one parallel step. Span ≈ `6 · log n` — a constant number of rounds, each cheap. The parallelism is `(V + E) / (6 · log n)`, which for a graph this size is in the *millions*. **This is the dream case**, and it's exactly why parallel BFS powers web crawling, social-graph distance queries, and the [Graph500 benchmark](https://graph500.org/) (which measures BFS throughput on huge, shallow graphs).

```
  SHALLOW graph (D small) — frontiers are HUGE, rounds are FEW:

   level 0:  ●                          (source)
   level 1:  ●●●●●●●●●●                  (10 vertices — already wide)
   level 2:  ●●●●●●●●●●●●●●●●●●●●...      (millions — one parallel step!)
   level 3:  ●●●●●●●●●●●●●●●●●●●●...      (most of the rest)
            └─ only ~6 levels total → span ≈ 6·log n → MASSIVE parallelism
```

**Extreme 2: the path graph (large `D`) — parallel BFS barely helps.** Now imagine a straight line: `0 — 1 — 2 — 3 — … — (V−1)`. From vertex 0, vertex `i` is at distance `i`, so the diameter is `D = V − 1`. Every frontier holds *exactly one* vertex (level `k` is just `{k}`). There's nothing to expand in parallel — each round expands a single vertex and discovers a single new one. Span ≈ `V · log n` (actually *worse* than sequential's `Θ(V)`, because of the per-round scan overhead!), and parallelism collapses to `Θ(1)`. **Parallel BFS is a bad fit for long, skinny graphs** — there simply isn't level-parallelism to harvest.

```
  PATH graph (D ≈ V) — frontiers are TINY (size 1), rounds are MANY:

   level 0: {0}  level 1: {1}  level 2: {2}  ...  level V-1: {V-1}
   └─ V levels, each with ONE vertex → span ≈ V·log n → NO parallelism

   (each round has nothing to parallelize — you're back to one-at-a-time)
```

So the rule of thumb is blunt and worth memorizing:

> **Parallel BFS is good exactly when the graph is *shallow and wide* — small diameter, fat frontiers.** Social networks, web graphs, small-world networks: `D` is tiny (often `O(log V)` or a small constant), frontiers are enormous, and you get huge parallelism. **It's poor when the graph is *deep and skinny* — large diameter, thin frontiers.** Long paths, grids traversed corner-to-corner, chains: `D` approaches `V`, frontiers are tiny, and there's almost nothing to parallelize. Before reaching for parallel BFS, ask: *how many levels deep is this graph?* That number is your span.

(Most "interesting" real-world networks are shallow — that's the famous *small-world* property — which is precisely why parallel BFS is such a workhorse in practice.)

---

## The Duplicate-Neighbor Problem and the Visited-Claim Fix

Now the first tricky bit, which you saw twice in the worked example (vertices 1 and 2 both pointing at 3; vertices 5 and 6 both pointing at 7). When a whole frontier expands **in parallel**, two different frontier vertices can discover the **same** unvisited neighbor *at the same instant*. If we're not careful, both of them will think "this neighbor is new!", both will set its distance, and both will add it to the next frontier — so it ends up in the next frontier **twice** (or more).

Why is a duplicate bad? Two reasons. First, *correctness of the work bound*: if vertices appear in frontiers multiple times, we expand them multiple times, and the `Θ(V + E)` work guarantee breaks — in the worst case the work could blow up. Second, *wasted effort and confusion*: the same vertex gets re-expanded redundantly, and depending on the data structures you might even corrupt the distance array. The whole "each vertex enters a frontier exactly once" promise — which is what makes BFS efficient — is at risk.

Here's the race, concretely. Imagine the naive (broken) discovery check, run by two threads expanding vertices 1 and 2, both looking at neighbor 3:

```
  THE RACE (naive check — BROKEN under parallelism):

   thread A (expanding 1)        thread B (expanding 2)
   ─────────────────────         ─────────────────────
   reads visited[3] → false      reads visited[3] → false   ← BOTH see "unvisited"!
   writes visited[3] = true      writes visited[3] = true
   adds 3 to next frontier       adds 3 to next frontier    ← 3 added TWICE
```

Both threads read `visited[3]` as `false` *before* either writes `true`, so both proceed as if they're the unique discoverer. This is a classic **data race**, and the standard fix is an **atomic visited-claim**: a single, indivisible "test-and-set" operation that reads-and-writes in one uninterruptible step. The hardware (or your language's atomics) guarantees that when many threads try to claim `3` at once, **exactly one wins** and gets `true`; everyone else gets `false`.

```
  THE FIX — atomic claim (e.g. compare-and-swap on visited[3]):

   claim(u):  atomically do { if visited[u] is false → set it true, return true
                              else                  → return false }

   thread A (expanding 1)        thread B (expanding 2)
   ─────────────────────         ─────────────────────
   claim(3) → TRUE  (won!)       claim(3) → FALSE (lost)
   dist[3] = k+1                 (does nothing for 3)
   adds 3 to next frontier       (does NOT add 3)        ← 3 added EXACTLY ONCE
```

The `claim` is atomic, so the two threads' read-modify-writes are *serialized at the hardware level* — one of them genuinely happens first, sets the flag, and wins; the other sees the flag already set and bows out. In practice this is a single **compare-and-swap (CAS)** or **atomic test-and-set** instruction, which is fast (no lock, no blocking). With it, every vertex is claimed by exactly one discoverer, enters the next frontier exactly once, and the `Θ(V + E)` work bound holds.

A subtle but reassuring point: it **doesn't matter which** of the racing threads wins the claim, because in BFS every discoverer would have assigned the *same* distance (`k+1`). Vertex 3 is at distance 2 whether vertex 1 or vertex 2 discovers it. So the race is benign in *value* — both answers are identical — and the atomic claim is only there to prevent the *duplicate*, not to pick a "correct" winner. (Contrast this with weighted shortest paths, where which edge relaxes a vertex *does* matter — that's why BFS's unweighted simplicity is so pleasant.)

> **The takeaway:** parallel frontier expansion creates a **discovery race** — multiple frontier vertices can find the same unvisited neighbor simultaneously. The fix is an **atomic visited-claim** (a CAS / test-and-set): the *first* discoverer wins and adds the vertex to the next frontier; everyone else sees "already claimed" and skips it. This guarantees each vertex enters a frontier **exactly once**, preserving the `Θ(V + E)` work bound. The winner doesn't matter — every discoverer would assign the same distance `k+1` — so the claim only prevents duplicates, it doesn't decide anything.

---

## Building the Next Frontier with a Scan

The second tricky bit: once every frontier vertex has expanded and claimed its new neighbors, we need those newly-discovered vertices collected into a single **packed array** — the next frontier — so the next round can iterate over it. The obvious idea, "each thread appends its discovered vertices to a shared `next_frontier` array," is exactly the trap we learned about in [stream compaction](../02-parallel-prefix-sum-scan/junior.md): a shared append needs a shared counter (the array's current length), and all the threads fight over that one counter, serializing them and possibly racing on it. We'd reintroduce the serial bottleneck we worked so hard to remove.

The fix is the **scan-based compaction** you already know — flags → exclusive scan → scatter. Each thread, when it successfully claims a new vertex, records it; then a scan computes a *distinct* output slot for every discovered vertex, and they're all scattered into the packed next frontier in parallel, with no collisions. Concretely, one clean way to do it: give each frontier vertex `v` a count of how many *new* vertices it discovered, exclusive-scan those counts to get each `v` a starting offset into the next frontier, and have `v` write its discoveries starting at that offset.

```
  building the next frontier with a scan (no shared counter):

  frontier:           [ v1   v2   v3   v4 ]
  # new discovered:   [  2    0    3    1 ]        ← each v counts its claims
  exclusive scan:     [  0    2    2    5 ]        ← each v's START offset (the scan!)
  total = 6  ───────────────────────────────────► next frontier has size 6

  scatter (parallel): v1 writes its 2 at slots 0,1
                      v3 writes its 3 at slots 2,3,4
                      v4 writes its 1 at slot   5
  next frontier:      [  ·    ·    ·    ·    ·    · ]   ← all written at once, distinct slots
```

This is *precisely* the parallel-filter pattern from the scan topic: the exclusive scan converts "where do my discoveries go?" — a question whose answer depends on everyone before me — into a concrete, collision-free offset, computed for everyone at once in `Θ(log n)` span. That `Θ(log n)` is exactly the per-round span term in our `Θ(D · log n)` total. So the two "tricky parts" of parallel BFS resolve into two tools you already have:

- **Duplicate neighbors** → an **atomic claim** (so each vertex is discovered once).
- **Packing the next frontier in parallel** → a **scan / stream compaction** (so discoveries get distinct slots without a shared counter).

> **The connection to remember:** building the next frontier is *the same problem* as parallel filter — gather the survivors (here, the newly-discovered vertices) into a packed array, in parallel, without a shared counter. The answer is the same: **flags → exclusive scan → scatter.** The scan hands each discovery a distinct slot, costs `Θ(log n)` span, and that single `log n` is the per-level cost that multiplies by the `D` levels to give parallel BFS its `Θ(D · log n)` span.

---

## Code: Level-Synchronous BFS

Let's make it runnable. The core algorithm processes the graph **one frontier at a time**, tracking distances and printing each frontier so you can watch it breathe. We expand the whole current frontier, collect every newly-discovered vertex into the next frontier, then swap. This is the genuine level-synchronous structure; even though the inner loops are written sequentially here (so it runs anywhere), the **frontier-as-a-unit** shape is exactly what a parallel implementation expands in parallel.

### Go: level-synchronous BFS, printing each frontier

```go
package main

import "fmt"

// bfsLevels runs level-synchronous BFS from `source` over an adjacency-list
// graph. It processes ONE WHOLE FRONTIER per round (the unit a parallel BFS
// expands in parallel), returns the distance array, and prints each frontier.
// Work Θ(V + E); the round loop is the Θ(D)-length serial chain.
func bfsLevels(adj [][]int, source int) []int {
	n := len(adj)
	dist := make([]int, n)
	for i := range dist {
		dist[i] = -1 // -1 == unvisited
	}
	dist[source] = 0

	frontier := []int{source} // level 0
	level := 0
	for len(frontier) > 0 {
		fmt.Printf("level %d frontier: %v\n", level, frontier)

		var next []int // the next frontier we build this round
		// Expand the WHOLE frontier. In a parallel BFS this loop runs across
		// all frontier vertices (and their neighbors) at once.
		for _, v := range frontier {
			for _, u := range adj[v] {
				if dist[u] == -1 { // unvisited → discover it (the "claim")
					dist[u] = dist[v] + 1
					next = append(next, u) // joins the next frontier
				}
			}
		}
		frontier = next // the next frontier becomes current
		level++
	}
	return dist
}

func main() {
	// The worked-example graph (undirected), as adjacency lists:
	adj := [][]int{
		{1, 2},    // 0
		{0, 3},    // 1
		{0, 3, 4}, // 2
		{1, 2, 5}, // 3
		{2, 6},    // 4
		{3, 7},    // 5
		{4, 7},    // 6
		{5, 6},    // 7
	}
	dist := bfsLevels(adj, 0)
	fmt.Println("distances:", dist) // [0 1 1 2 2 3 3 4]
}
```

### Python: level-synchronous BFS, printing each frontier

```python
def bfs_levels(adj, source):
    """
    Level-synchronous BFS from `source`. Processes one whole FRONTIER per round
    (the unit a parallel BFS expands in parallel), returning the distance list.
    Work Θ(V + E); the round loop is the Θ(D)-length serial chain.
    """
    n = len(adj)
    dist = [-1] * n          # -1 == unvisited
    dist[source] = 0

    frontier = [source]      # level 0
    level = 0
    while frontier:
        print(f"level {level} frontier: {frontier}")

        nxt = []             # the next frontier we build this round
        # Expand the WHOLE frontier. A parallel BFS runs this across all
        # frontier vertices (and their neighbors) at once.
        for v in frontier:
            for u in adj[v]:
                if dist[u] == -1:          # unvisited → discover it (the "claim")
                    dist[u] = dist[v] + 1
                    nxt.append(u)          # joins the next frontier
        frontier = nxt                     # next frontier becomes current
        level += 1
    return dist


if __name__ == "__main__":
    # The worked-example graph (undirected), as adjacency lists:
    adj = [
        [1, 2],     # 0
        [0, 3],     # 1
        [0, 3, 4],  # 2
        [1, 2, 5],  # 3
        [2, 6],     # 4
        [3, 7],     # 5
        [4, 7],     # 6
        [5, 6],     # 7
    ]
    dist = bfs_levels(adj, 0)
    print("distances:", dist)  # [0, 1, 1, 2, 2, 3, 3, 4]
```

Running either prints the frontiers exactly as we traced them by hand, then the distances:

```
level 0 frontier: [0]
level 1 frontier: [1, 2]
level 2 frontier: [3, 4]
level 3 frontier: [5, 6]
level 4 frontier: [7]
distances: [0, 1, 1, 2, 2, 3, 3, 4]
```

**What it does and why it's the right shape:** the outer `while` loop is the **serial level chain** — its iteration count is the number of BFS levels (5 here), which equals the diameter from the source plus the closing check. The inner double loop is the **per-level expansion**, which a parallel implementation runs across all frontier vertices and their neighbors *at once* (work `Θ(V + E)` summed over all rounds, because each vertex is discovered once and each edge inspected once). The single `dist[u] == -1` check is the discovery test — and in the *sequential* code above it's perfectly safe, because only one thread runs. The next section shows what changes when many threads run that check simultaneously.

---

## Code: Simulating the Parallel Neighbor Expansion

To make the parallelism (and its hazard) concrete, let's expand the frontier across **real worker threads** and watch the duplicate-neighbor problem appear — then fix it with an atomic claim. We process each frontier with a pool of workers, each taking a slice of the frontier and expanding those vertices' neighbors. This mirrors how a parallel BFS divides a frontier across processors.

### Go: parallel frontier expansion with an atomic visited-claim

```go
package main

import (
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
)

// bfsParallelFrontier expands each frontier across multiple goroutines.
// The visited-CLAIM is an atomic CompareAndSwap: exactly one goroutine wins
// the right to discover each vertex, so it enters the next frontier ONCE even
// when several frontier vertices point at it (the duplicate-neighbor case).
func bfsParallelFrontier(adj [][]int, source, workers int) []int {
	n := len(adj)
	dist := make([]int, n)
	visited := make([]int32, n) // 0 = unclaimed, 1 = claimed (atomic)
	for i := range dist {
		dist[i] = -1
	}
	dist[source] = 0
	atomic.StoreInt32(&visited[source], 1)

	frontier := []int{source}
	level := 0
	for len(frontier) > 0 {
		fmt.Printf("level %d frontier: %v\n", level, frontier)

		// Each worker collects its OWN discoveries (its own slice — no shared
		// append, no shared counter). We merge the per-worker lists afterward.
		parts := make([][]int, workers)
		var wg sync.WaitGroup
		chunk := (len(frontier) + workers - 1) / workers
		for w := 0; w < workers; w++ {
			lo := w * chunk
			hi := lo + chunk
			if hi > len(frontier) {
				hi = len(frontier)
			}
			if lo >= hi {
				continue
			}
			wg.Add(1)
			go func(w, lo, hi int) {
				defer wg.Done()
				var local []int
				for _, v := range frontier[lo:hi] {
					for _, u := range adj[v] {
						// ATOMIC CLAIM: first to flip 0→1 wins and discovers u.
						if atomic.CompareAndSwapInt32(&visited[u], 0, 1) {
							dist[u] = dist[v] + 1 // safe: only the winner writes
							local = append(local, u)
						}
					}
				}
				parts[w] = local // own slot — no write conflict
			}(w, lo, hi)
		}
		wg.Wait()

		// Merge the per-worker discovery lists into the next frontier.
		// (A real parallel BFS does this merge with a scan-based compaction;
		// here a simple concatenation makes the result easy to read.)
		var next []int
		for _, p := range parts {
			next = append(next, p...)
		}
		sort.Ints(next) // sort only so the printed frontier is deterministic
		frontier = next
		level++
	}
	return dist
}

func main() {
	adj := [][]int{
		{1, 2}, {0, 3}, {0, 3, 4}, {1, 2, 5}, {2, 6}, {3, 7}, {4, 7}, {5, 6},
	}
	dist := bfsParallelFrontier(adj, 0, 4)
	fmt.Println("distances:", dist) // [0 1 1 2 2 3 3 4]
}
```

### Python: the race, demonstrated, then the lock-protected claim

Python's threads don't run pure Python in true parallel (the GIL), but we can still *demonstrate the hazard* by showing what a naive shared append does versus a claim that guards each vertex. The point is the **structure**: each worker claims before adding, so duplicates can't slip in.

```python
import threading

def bfs_parallel_frontier(adj, source, workers=4):
    """
    Expand each frontier across worker threads. A LOCK-PROTECTED CLAIM plays the
    role of the atomic compare-and-swap: the first thread to find a vertex
    unvisited marks it and discovers it; everyone else sees it's taken. This
    guarantees each vertex enters the next frontier exactly once.
    """
    n = len(adj)
    dist = [-1] * n
    visited = [False] * n
    dist[source] = 0
    visited[source] = True
    lock = threading.Lock()

    frontier = [source]
    level = 0
    while frontier:
        print(f"level {level} frontier: {sorted(frontier)}")
        parts = [[] for _ in range(workers)]

        def expand(w, lo, hi):
            local = []
            for v in frontier[lo:hi]:
                for u in adj[v]:
                    # CLAIM: the lock makes "test visited[u] then set it" atomic,
                    # so exactly one thread discovers u (no duplicates).
                    with lock:
                        if not visited[u]:
                            visited[u] = True
                            dist[u] = dist[v] + 1
                            claimed = True
                        else:
                            claimed = False
                    if claimed:
                        local.append(u)
            parts[w] = local

        chunk = (len(frontier) + workers - 1) // workers
        threads = []
        for w in range(workers):
            lo, hi = w * chunk, min((w + 1) * chunk, len(frontier))
            if lo < hi:
                t = threading.Thread(target=expand, args=(w, lo, hi))
                t.start()
                threads.append(t)
        for t in threads:
            t.join()

        # Merge per-thread discoveries (a real BFS uses a scan-based compaction).
        frontier = [u for part in parts for u in part]
        level += 1
    return dist


if __name__ == "__main__":
    adj = [
        [1, 2], [0, 3], [0, 3, 4], [1, 2, 5], [2, 6], [3, 7], [4, 7], [5, 6],
    ]
    dist = bfs_parallel_frontier(adj, 0)
    print("distances:", dist)  # [0, 1, 1, 2, 2, 3, 3, 4]
```

> **The crucial detail — claim before you add, and write to your own slot.** Two safety rules make parallel frontier expansion correct. First, the **atomic claim** (`CompareAndSwap` in Go, the `lock`-guarded test-and-set in Python) ensures exactly one worker discovers each vertex, so it enters the next frontier once even when several frontier vertices point at it — the duplicate-neighbor fix. Second, each worker collects discoveries into its **own** list (`parts[w]`), never a shared array — so there's no contended counter, exactly the partials pattern from parallel reduce. The final merge of those per-worker lists is, in a production BFS, a **scan-based compaction** ([stream compaction](../02-parallel-prefix-sum-scan/junior.md)) that packs them in `Θ(log n)` span; here we concatenate for clarity. Both rules together are what keep the round truly parallel while producing a correct, duplicate-free next frontier.

---

## Common Misconceptions

- **"BFS is inherently sequential because it needs a queue."** This is the headline misconception. The queue is *one* way to enforce distance order — convenient on a single processor, but it manufactures a serial chain of pops. The vertices at the *same* distance never depended on each other; the queue only made it look that way. Replace "process the queue in order" with "expand each whole distance-level at once" and BFS parallelizes to span `Θ(D · log n)`.

- **"Parallel BFS does more work than sequential BFS."** No — it does *exactly* the same `Θ(V + E)` work: every vertex discovered once, every edge inspected once. The atomic claim is what guarantees "once." Parallel BFS rearranges *when* the work happens (levels in series, each level in parallel); it doesn't add work. It's **work-efficient**.

- **"Parallel BFS is always faster."** Only when the graph is *shallow* (small diameter). The span is `Θ(D · log n)`, so a deep, path-like graph (`D ≈ V`) gets essentially no parallelism — and the per-round scan overhead can make it *slower* than the plain sequential loop. Parallel BFS wins on wide, shallow graphs (social networks, web graphs), not on long chains.

- **"Within a level, the order I expand frontier vertices matters."** It doesn't. All frontier vertices are at the same distance `k`, and every neighbor they discover gets distance `k+1` regardless of *who* discovers it. That order-independence is exactly what lets the level expand in parallel. (Order *between* levels is what matters, and that's preserved by finishing each level before the next.)

- **"The duplicate-neighbor race means parallel BFS gives wrong answers."** The race is *benign in value* — every discoverer of a vertex would assign it the same distance — so the distances are always correct. The race only threatens *duplicates* in the next frontier (which break the work bound), and the atomic claim eliminates those. You get correct distances *and* the right work bound.

- **"Building the next frontier just means appending to a shared list."** That's the trap. A shared append needs a shared length counter that all threads contend on, serializing them. The right way is a **scan-based compaction** (flags → exclusive scan → scatter), which hands each discovery a distinct slot with no shared counter — the same trick as parallel filter.

---

## Common Mistakes

- **Checking-then-setting `visited` without atomicity.** The classic bug: `if not visited[u]: visited[u] = true`. Under parallelism two threads both read `false` before either writes `true`, both "discover" `u`, and it lands in the next frontier twice. Use an **atomic test-and-set / compare-and-swap** so exactly one thread wins the claim.

- **Appending discoveries to one shared frontier array.** All workers fighting over the array's end (and its length counter) serializes them and may race. Have each worker collect into its **own** list, then merge with a scan-based compaction. Never a single shared `append`.

- **Starting level `k+1` before level `k` is finished.** The levels *must* be a serial chain — you don't know which vertices are at distance `k+1` until every distance-`k` vertex has expanded. Skipping the barrier between levels visits vertices out of distance order and corrupts the distances. The `while` loop's iterations are deliberately *not* parallel.

- **Forgetting to mark the source visited before the loop.** If `visited[source]` (or `dist[source]`) isn't set at the start, the source can be rediscovered by one of its neighbors and re-added to a frontier, inflating work and possibly mis-distancing. Seed `dist[source] = 0` and claim the source up front.

- **Using parallel BFS on a deep, skinny graph.** On a long path or a corner-to-corner grid traversal, `D ≈ V`, frontiers are size 1, and there's nothing to parallelize — the per-round scan overhead makes it *slower* than sequential. Check the diameter first; parallel BFS is for shallow, wide graphs.

- **Confusing the simulation's serial loops with the algorithm's cost.** The code expands a frontier with a `for` loop for portability, but the *algorithm* expands the whole frontier at once. The cost to read off is the **span** — `Θ(D · log n)`, i.e. the number of levels times the per-level scan — not the simulation's loop count. Judge it by the levels (the serial chain) and the per-level scan, not the `for`.

---

## Cheat Sheet

```
SEQUENTIAL BFS — one vertex at a time (a queue)
  pop v; for each neighbor u: if unvisited, dist[u]=dist[v]+1, push u
  Work Θ(V+E)   Span Θ(V)   Parallelism Θ(1)   ← a CHAIN of pops, no parallelism

PARALLEL = LEVEL-SYNCHRONOUS (FRONTIER-BASED) BFS — one whole LEVEL at a time
  frontier = { source };  k = 0
  while frontier not empty:
     expand ALL frontier vertices IN PARALLEL:
        for each v, for each neighbor u:  if claim(u): dist[u]=k+1; add u to next
     frontier = next;  k++
  each round advances ONE BFS level.

THE COST  (the whole story in two numbers)
  Work  Θ(V + E)        ← SAME as sequential: each vertex discovered once, each edge once
  Span  Θ(D · log n)    ← D levels (serial chain) × Θ(log n) per-level scan
  Parallelism Θ((V+E)/(D·log n))   ← depends ENTIRELY on the diameter D

THE KEY INSIGHT
  Levels are SEQUENTIAL (must finish level k before k+1) → chain of length D.
  Each level's expansion is PARALLEL (all frontier vertices independent).
  → span = D × (one level) = D·log n.

DIAMETER IS EVERYTHING
  SHALLOW + WIDE  (D small, fat frontiers): social/web graphs → HUGE parallelism  ✓
  DEEP + SKINNY   (D ≈ V, frontiers size 1): paths/chains → NO parallelism, slower ✗

TWO TRICKY PARTS (and their fixes)
  1. DUPLICATE NEIGHBOR: two frontier vertices discover the same u at once.
       FIX → ATOMIC CLAIM (compare-and-swap / test-and-set): first discoverer wins,
             u enters the next frontier EXACTLY ONCE. (Winner doesn't matter: same dist.)
  2. BUILD NEXT FRONTIER in parallel without a shared counter:
       FIX → SCAN / STREAM COMPACTION (flags → exclusive scan → scatter), Θ(log n) span.

WHY IT MATTERS
  Unweighted shortest paths, connected components, web crawl, social-distance,
  the Graph500 benchmark. The workhorse parallel graph traversal.
```

---

## Summary

**Parallel BFS** is ordinary breadth-first search reorganized so that many processors can work at once — by changing the *unit of processing* from "one vertex" to "one whole level."

- **Sequential BFS** pops vertices off a **queue** one at a time. That's a serial chain of pops — work `Θ(V + E)`, span `Θ(V)`, parallelism `Θ(1)`. The queue enforces distance order on one processor, but it *manufactures* a chain: the vertices at the same distance never depended on each other.

- **Level-synchronous (frontier-based) BFS** processes a whole **frontier** — the set of vertices at the current distance `k` — per round. Each round, **in parallel**, every frontier vertex inspects its neighbors; each unvisited neighbor is discovered, assigned distance `k+1`, and added to the **next frontier**. Repeat until the next frontier is empty. Each round advances exactly one BFS level. We traced an 8-vertex graph and watched the frontiers breathe: `{0} → {1,2} → {3,4} → {5,6} → {7} → {}`.

- **The cost.** **Work `Θ(V + E)`** — identical to sequential BFS, because each vertex is discovered once and each edge inspected once (the atomic claim guarantees "once"). **Span `Θ(D · log n)`** — the `D` levels form a serial chain (you must finish level `k` before level `k+1`), and each level costs `Θ(log n)` for the scan that builds the next frontier. The one-line insight: **levels are inherently sequential, each level is fully parallel.**

- **Diameter `D` is the whole story.** Parallelism is `Θ((V + E) / (D · log n))`, so it depends entirely on how *deep* the graph is. **Shallow, wide graphs** (small `D`, fat frontiers — social networks, web graphs) parallelize beautifully; **deep, skinny graphs** (`D ≈ V`, thin frontiers — long paths) barely parallelize at all and can even be slower than sequential. Ask "how many levels deep is this graph?" before reaching for parallel BFS.

- **Two tricky parts, two familiar tools.** First, two frontier vertices can discover the same neighbor at once — fixed with an **atomic visited-claim** (compare-and-swap / test-and-set) so each vertex enters a frontier exactly once (the winner doesn't matter; every discoverer assigns the same distance). Second, packing the newly-discovered vertices into the next frontier in parallel is exactly **stream compaction** — flags → exclusive scan → scatter — which gives each discovery a distinct slot in `Θ(log n)` span, with no shared counter.

The big idea to carry forward: **parallel BFS converts "process `V` vertices in series" into "process `D` levels in series, each level in parallel."** The work is unchanged at `Θ(V + E)`; the span drops from `V` to `D · log n`; and whether that's a win is decided by the graph's diameter. BFS underlies unweighted shortest paths, connected components, web crawling, social-network distance, and the Graph500 benchmark — which is why level-synchronous BFS is *the* workhorse of parallel graph traversal.

**Next steps:** [the middle-level treatment](./middle.md) digs into the **direction-optimizing (top-down vs. bottom-up) BFS** trick that makes huge frontiers cheap, load-balancing skewed-degree frontiers, the CSR graph layout, and how real systems (and the Graph500 benchmark) implement all of this. Then [Parallel Prefix Sum (Scan)](../02-parallel-prefix-sum-scan/junior.md) is the compaction primitive that builds each frontier; [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md) is the map that expands one; sequential [Graphs → BFS](../../11-graphs/02-bfs/junior.md) is the baseline we parallelized; and the whole framework rests on the [work–span model](../01-models-pram-work-span/junior.md) from the first topic.

---

## Further Reading

- **Charles Leiserson & Tao Schardl, "A Work-Efficient Parallel Breadth-First Search Algorithm" (SPAA 2010)** — the clean, modern treatment of level-synchronous BFS with a work-efficient frontier and the `Θ(V + E)` work / `Θ(D · log n)`-style span analysis used in this file.
- **Scott Beamer, Krste Asanović & David Patterson, "Direction-Optimizing Breadth-First Search" (SC 2012)** — the top-down/bottom-up trick that makes the giant frontiers of shallow graphs cheap; the natural next read after this file (and the heart of the middle level).
- **The Graph500 Benchmark (graph500.org)** — the standard benchmark for parallel BFS throughput on large, shallow Kronecker graphs; reading its specification makes "why shallow graphs" concrete.
- **Cormen, Leiserson, Rivest & Stein, *Introduction to Algorithms* (CLRS), "Breadth-First Search" and "Multithreaded Algorithms"** — sequential BFS and the work–span analysis of parallel loops, in the framework used throughout this section.
- **Guy Blelloch, *Prefix Sums and Their Applications* (CMU, 1990)** — the scan/compaction primitive that builds each frontier, and why it's `Θ(log n)` span.
- **[Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md)** — the work/span model the cost analysis rests on.
- **[Parallel Prefix Sum (Scan)](../02-parallel-prefix-sum-scan/junior.md)** — flags → scan → scatter, the stream-compaction that packs each next frontier in `Θ(log n)` span.
- **[Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md)** — the map primitive that expands a frontier (do the same thing to every frontier vertex).
- **[Graphs → BFS](../../11-graphs/02-bfs/junior.md)** — the sequential queue-based BFS this topic parallelizes.
- **[Parallel Graph BFS — Middle](./middle.md)** — direction-optimizing BFS, load balancing, the CSR layout, and real-system implementation in depth.
