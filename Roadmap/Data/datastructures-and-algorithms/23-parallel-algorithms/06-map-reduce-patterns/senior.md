# MapReduce Patterns — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — the execution model (map → shuffle → reduce), combiners as map-side pre-aggregation, the canonical patterns (filtering, summarization, inverted index, joins), and the reduce-side vs map-side join distinction
- [Parallel Reduce and Map — Senior](../04-parallel-reduce-and-map/senior.md) — the monoid/semiring algebra of map-reduce, why combiners need a *commutative* monoid, and reduce-by-key / segmented reduce as one reduce over a richer monoid
- [Parallel Sorting and Merging — Senior](../03-parallel-sorting-and-merging/senior.md) — the shuffle *is* a distributed sort; sample/distribution sort, the one-all-to-all-round argument, and the communication-rounds cost measure

## Table of Contents

1. [What Senior-Level MapReduce Theory Is About](#what-senior-level-mapreduce-theory-is-about)
2. [MapReduce as a Computational Model: The MRC Model](#mapreduce-as-a-computational-model-the-mrc-model)
3. [The MPC Model: The Modern Generalization](#the-mpc-model-the-modern-generalization)
4. [Simulating PRAM in MapReduce/MPC](#simulating-pram-in-mapreducempc)
5. [Algorithm Design for Low Rounds: Filtering and Coresets](#algorithm-design-for-low-rounds-filtering-and-coresets)
6. [Round-Compression and the Connectivity Lower Bound](#round-compression-and-the-connectivity-lower-bound)
7. [The Iteration Problem and the Dataflow Response](#the-iteration-problem-and-the-dataflow-response)
8. [Communication and Shuffle Complexity](#communication-and-shuffle-complexity)
9. [Worked Piece: Filtering for Connectivity, and PageRank MapReduce vs Spark](#worked-piece-filtering-for-connectivity-and-pagerank-mapreduce-vs-spark)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What Senior-Level MapReduce Theory Is About

The middle level establishes MapReduce as an *engineering pattern*: a job is a `map` that emits key–value pairs, a *shuffle* that groups all values by key, and a `reduce` that folds each group; *combiners* pre-aggregate map output to shrink the shuffle; and the pattern catalogue (filtering, summarization, inverted index, the reduce-side and map-side joins) covers most data-processing tasks. That is the "here is the framework and how to express computations in it" level — the Dean–Ghemawat (2004) programming model and its idioms.

Senior-level theory makes a stronger claim: **MapReduce is not just a framework; it is a *model of parallel computation* with its own complexity measure, and that measure is the number of ROUNDS.** The defining senior question is not "how do I express this as map and reduce?" but "how *few* rounds of map-shuffle-reduce does this problem need, given that each machine has only sublinear memory?" Five threads run through this view:

1. **The resource that matters is round complexity, not work or span.** A round is one full map → shuffle → reduce cycle, and it is *expensive* because the shuffle is an all-to-all distributed sort across the network and ends in a synchronization barrier (every reducer waits for every mapper). The MRC model of Karloff, Suri, and Vassilvitskii (2010) makes this precise: machines with **sublinear memory** (`O(n^{1−ε})` per machine), a **sublinear number** of machines, and the goal of `O(polylog n)` — ideally `O(1)` — rounds.
2. **MPC generalizes MRC and connects to PRAM.** The Massively Parallel Computation (MPC) model abstracts MapReduce, Spark, Dryad, and Flink into one parameterized model (local memory `s`, total machines, round count). Its central structural fact is that MPC rounds correspond — under simulation — to PRAM *span*: an `O(T_∞)`-span PRAM algorithm becomes an `O(T_∞)`-round MPC algorithm, so the entire class `NC` collapses into `O(polylog)`-round MPC.
3. **Low-round algorithm design has its own toolkit.** Because rounds are the scarce resource, the art is to *shrink the problem until it fits one machine, then solve it locally* — the **filtering / coreset** technique. Connectivity, MST, and matching all admit `O(1)`- or `O(log n)`-round algorithms this way, and the celebrated `O(log log n)`-round connectivity results (and the conditional 1-vs-2-cycle lower bound) define the current frontier.
4. **MapReduce is terrible for iteration, and dataflow is the fix.** Classic MapReduce re-reads its input *from disk* every round, which is fatal for the *iterative* algorithms (PageRank, k-means, BFS, every graph algorithm) that dominate real workloads. The response — **Spark's RDDs** (Zaharia, 2012) keeping state in memory across rounds, **Pregel/BSP** (Malewicz, 2010) for think-like-a-vertex graph computation, **Flink** for streaming dataflow — changes the model by making *state across rounds* cheap.
5. **The shuffle is the bottleneck, and its cost is communication and load.** The shuffle is a distributed sort (see [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md)); its cost is the *total communication* (bytes crossing the network) and the *load* (max bytes any one reducer receives). Skew — one giant key — is the load killer, the distributed analogue of an unbalanced bucket.

The unifying senior stance: **MapReduce/MPC is a model whose cost is rounds, whose machines have sublinear memory, and whose central design discipline is to compress each problem into one machine's memory in as few rounds as possible — while the classic disk-reread model is so hostile to iteration that the entire dataflow generation (Spark, Pregel, Flink) exists to keep cross-round state in memory.** The sections below develop the MRC/MPC models, the PRAM simulation that ties them to `NC`, the filtering toolkit and the connectivity round bounds, the iteration problem and its dataflow answer, and the shuffle's communication cost.

---

## MapReduce as a Computational Model: The MRC Model

The middle level treats MapReduce as software. To reason about *what is and is not efficiently computable* in it, you need a formal model with a cost measure. Karloff, Suri, and Vassilvitskii gave the first widely adopted one in 2010: **MRC** (the "MapReduce Class").

> **The MRC model (Karloff–Suri–Vassilvitskii, 2010).** For an input of size `n`, an MRC algorithm runs in *rounds*. Each round is a map phase, a shuffle, and a reduce phase. The model imposes three substantive constraints, for a small fixed `ε > 0`:
> - **Sublinear memory per machine.** Each mapper/reducer uses `O(n^{1−ε})` memory — *strictly* sublinear, so no single machine can hold the whole input. (Equivalently: no reducer's key-group may exceed this size.)
> - **Sublinear number of machines.** There are `O(n^{1−ε})` machines, so total memory is `O(n^{2−2ε})` — superlinear (you may replicate data) but bounded.
> - **Polylogarithmic rounds.** An efficient algorithm uses `O(polylog n)` rounds; the most desirable algorithms use `O(1)` rounds. `MRC^i` is the class solvable in `O(log^i n)` rounds.
> Additionally each machine's per-round computation is polynomial in `n`, and total work/communication is near-linear.

The two memory constraints are the heart of the model and the reason it is *not* just PRAM. The sublinear-memory rule says **no machine sees the whole problem**, which is what makes distributed algorithm design hard and interesting: you must compute a global answer (connectivity, a sort, a join) from locally-held fragments. The `n^{1−ε}` choice is deliberate — it captures the real regime where input dwarfs any single node's RAM, the regime that motivated MapReduce in the first place.

**Why rounds are the cost.** The model declares *round count* the primary resource, and the justification is operational, not arbitrary:

- **A round ends in a barrier.** The reduce phase of round `k` cannot start until *every* mapper of round `k` has finished and its output is shuffled. This global synchronization means the round runs at the speed of its slowest machine (the *straggler*), and stragglers are endemic at scale.
- **The shuffle is an all-to-all sort over the network.** Between map and reduce, every key–value pair is routed to the machine owning its key — an all-to-all communication pattern that is a distributed sort (see [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md)). Network bandwidth, not CPU, is the binding constraint, and the shuffle saturates it once per round.
- **Classic MapReduce materializes between rounds.** Each round's output is written to (and the next round's input read from) a distributed file system — disk and replicated network I/O per round. A round therefore costs a full pass through disk-resident data, which is *orders of magnitude* more expensive than a step of in-memory computation.

So an `O(log n)`-round algorithm and an `O(log² n)`-round algorithm differ by a factor of `log n` *disk-and-network barriers* — a difference that dwarfs constant-factor improvements in per-round work. This is exactly analogous to the sorting file's lesson that on a distributed machine *communication rounds*, not comparison span, are the binding cost (see [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md)). **In MRC, rounds are to MapReduce what span is to PRAM: the resource you minimize, and the one the lower bounds are stated in.**

> **The two slogans of MRC design.** (1) *Sublinear memory forces locality:* you cannot just gather everything on one node — you must do real distributed work. (2) *Rounds are precious:* each one is a barrier plus a network sort plus (classically) a disk round-trip, so the entire game is to solve the problem in `O(1)` or `O(log n)` rounds. Every algorithmic technique below — filtering, coresets, round compression — is in service of slogan (2) under the constraint of slogan (1).

---

## The MPC Model: The Modern Generalization

MRC pinned down MapReduce specifically. The research community has since converged on a cleaner, more general abstraction — the **Massively Parallel Computation (MPC)** model — that covers MapReduce *and* its dataflow successors (Spark, Dryad, Flink, Hadoop) under one set of parameters. MPC is now the standard model for theoretical work on big-data algorithms.

> **The MPC model.** There are `m` machines, each with **local memory `s`** words. The input of size `N` is distributed across the machines (so `m · s ≥ N`, and typically `m · s = O(N)` or `Õ(N)` — total memory is near-linear). Computation proceeds in *synchronous rounds*. In each round, every machine performs unbounded local computation on its `s` words, then sends and receives messages, subject to the constraint that **the total data a machine sends or receives in a round is `O(s)`** (it cannot receive more than its memory). The cost measure is the **number of rounds `R`**; the goal is `R = O(polylog N)`, ideally `O(1)`.

The single knob that defines the *regime* is the relationship between local memory `s` and input size `N`:

| Regime | Local memory `s` | Character |
|---|---|---|
| **Strongly superlinear** | `s = N^{1+ε}` | each machine holds a superlinear slice; easiest, often `O(1)` rounds |
| **Near-linear** | `s = Θ(N)` or `Õ(N)` | the "linear-memory" MPC regime; many problems in `O(1)`–`O(log N)` rounds |
| **Strongly sublinear** | `s = N^{δ}`, `δ < 1` | the hardest and most studied regime; matches MRC's `n^{1−ε}`; where the deep lower bounds live |

The lower the memory, the harder the problem and the more rounds it tends to need — which is the whole tension of the field. Most modern results are stated as "problem `X` is solvable in `O(f(N))` MPC rounds with `s = N^δ` local memory," and the frontier is pushing `f` down toward `O(1)` or proving it cannot go below some `Ω(log_s N)` floor.

**Why MPC subsumes the dataflow systems.** Spark, Flink, and Pregel all share MPC's defining shape — synchronous rounds (Spark *stages*, Pregel *supersteps*), bounded per-machine memory, all-to-all communication between rounds — so an MPC round bound is a *system-agnostic* statement about how many synchronization barriers a problem fundamentally requires. The difference between MapReduce and Spark is *not* in the MPC round count of an algorithm; it is in the **per-round cost** (Spark keeps the round's state in memory, MapReduce spills to disk — §7). MPC abstracts away that constant and isolates the rounds, which is exactly the right move for lower bounds.

> **MPC rounds are the model-level statement of "how many barriers does this problem need?"** Two algorithms with the same MPC round count are equally good in the model; whether one runs `100×` faster is a *systems* question (in-memory vs disk, §7), not a *model* question. This separation — rounds for the theory, per-round cost for the engineering — is the central organizing idea of the senior view.

---

## Simulating PRAM in MapReduce/MPC

The bridge that connects MPC to the rest of parallel-algorithms theory — and the reason `NC` algorithms transfer to MapReduce — is a *simulation*: a PRAM algorithm can be run, round for round, on MPC. This is the structural theorem that lets you import decades of PRAM algorithm design into the big-data setting.

> **The PRAM-to-MPC simulation (Karloff–Suri–Vassilvitskii, 2010; Goodrich–Sitchinava–Zhang, 2011).** A CREW PRAM algorithm that uses `O(p)` processors, `O(n)` total memory, and runs in `T` parallel steps can be simulated in `O(T)` MPC/MapReduce rounds (with sublinear local memory `s = n^δ`), provided the PRAM uses polynomially-bounded memory. Each PRAM *step* becomes `O(1)` MapReduce rounds.

### How one PRAM step becomes O(1) rounds

A CREW PRAM step is: every processor reads up to a constant number of shared-memory cells, computes, and writes a constant number of cells (no concurrent writes — that is the CREW restriction). Encode the simulation with key–value pairs keyed by *memory address*:

```text
   Represent shared memory cell  a  as a key–value pair  (a, value(a)).
   Represent processor  i  reading cells  {r₁,…,r_c}  and writing  {w₁,…,w_c}.

   ROUND (one PRAM step → O(1) MapReduce rounds):
     1. Routing reads:   map emits, for each processor's read request, a key = address;
                         the reducer for that address sends back its current value.
                         (This is a distribution / sort by address — one shuffle.)
     2. Local compute:   each processor (now holding its read values) computes its writes.
     3. Routing writes:  map emits each write as (address, new value); the reducer for
                         each address installs the new value.   (Another shuffle.)
```

Each phase is a constant number of shuffles (sort-by-address), so each PRAM step costs `O(1)` MapReduce rounds. The CREW assumption matters: with *concurrent reads* allowed, an address may be read by many processors, which the shuffle handles by replicating that key's value to all requesters (a broadcast within the reduce), but *concurrent writes* would require a conflict-resolution rule (the CRCW models) and a combiner-monoid to merge them — doable, but the clean `O(1)`-rounds-per-step statement is for CREW. The sublinear-memory constraint is respected as long as no single address is read or written by more than `s` processors in one step (high fan-in/out keys are the skew problem of §8).

### The consequence: NC ⊆ polylog-round MPC

Chaining the per-step simulation over a whole algorithm gives the headline corollary:

```text
   PRAM step count  T  →  O(T) MapReduce/MPC rounds.
   So an algorithm with span  T_∞  becomes an  O(T_∞)-round MPC algorithm.

   In particular:  NC^i  (span O(log^i n))  ⊆  MRC^i / O(log^i n)-round MPC.
   The whole class  NC  (span O(polylog n))  ⊆  O(polylog n)-round MPC.
```

So **every `NC` algorithm — prefix sum, list ranking, connectivity, sorting, matrix operations — is automatically an `O(polylog n)`-round MapReduce algorithm.** This is why the parallel reduce of [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) (span `O(log n)`, in `NC¹`) gives an `O(log n)`-round distributed reduce, and why the parallel BFS of [`../05-parallel-graph-bfs/senior.md`](../05-parallel-graph-bfs/senior.md) (span `O(diameter · log n)`) ports to an `O(diameter · log n)`-round MPC BFS. **MPC round complexity is, up to the simulation's constant, the PRAM span of the best algorithm you can run.**

> **The rounds-vs-memory tradeoff this exposes.** The simulation is *generic* and therefore often *wasteful*: a black-box PRAM-to-MPC translation pays `O(T_∞)` rounds, but with *more local memory* you can frequently do *far better* than the span suggests — because a machine with `n^δ` memory can simulate a *whole subtree* of the PRAM computation locally in *one* round, collapsing `O(δ log n)` PRAM steps into a single MPC round. This is the **rounds-vs-memory tradeoff**: increasing local memory `s` from `polylog` toward `n^δ` lets you exponentially cut rounds (e.g. an `O(log n)`-round PRAM-style algorithm can become `O(log n / log s)` rounds by simulating `log s` levels per round). The art of §5 — filtering and coresets — is precisely about *exploiting* this: use the (sublinear but large) local memory to shrink the problem so aggressively that the round count drops below what the naïve PRAM simulation would give.

---

## Algorithm Design for Low Rounds: Filtering and Coresets

If the simulation gave the best round counts there would be no field. The reason MPC algorithm design is rich is that the *generic* `O(T_∞)`-round simulation is usually beatable, and the technique that beats it is **filtering** (also called *coreset* or *sample-and-prune*): use each machine's substantial local memory to *shrink the problem* until what remains fits on one machine, then finish locally — all in `O(1)` or `O(log_s n)` rounds.

> **The filtering / coreset paradigm (Lattanzi–Moseley–Suri–Vassilvitskii, 2011).** In each round, every machine discards or contracts the parts of its local data that *provably cannot affect the answer*, shrinking the global instance by a polynomial factor `n^δ` per round. After `O(1/δ) = O(1)` rounds (for constant `δ`) the *entire surviving instance fits in one machine's memory `s = n^{1−ε}`*, where it is solved sequentially in a single final round.

The structure is always the same three-beat:

1. **Shrink.** Use local memory to compute a *coreset* — a small summary that preserves the answer. For graph problems this is a sparse subgraph that retains the relevant structure; for clustering it is a weighted point sample that preserves clustering cost.
2. **Iterate or finish.** Either the coreset already fits one machine (finish locally) or it is still too big, in which case recurse — but because each round shrinks by `n^δ`, only `O(1/δ)` rounds are needed.
3. **Solve locally.** Once the instance fits in `s` memory, run *any* sequential algorithm; the round cost is one.

The canonical applications, all `O(1)` or `O(log n)` rounds:

- **Minimum spanning tree.** The key fact: an edge is *not* in the MST iff it is the heaviest edge on some cycle. Partition the edges across machines; each machine locally computes the MST (or a "lightest-edges" forest) of its share, discarding edges that are provably non-MST (heaviest-on-a-cycle within its share). This *filters out* a constant fraction of edges per round while never discarding a true MST edge. After `O(1)` rounds the surviving edges fit one machine, which finishes the MST. (Lattanzi et al.)
- **Connectivity / spanning forest.** Same idea with spanning forests: each machine contributes a spanning forest of its edge-subset; the union (far sparser than the original) is recursed on. Connectivity in `O(log n)` rounds via repeated contraction, or `O(log log n)` rounds with the round-compression machinery of §6.
- **Maximal / maximum matching.** Sample a sparse subgraph, find a matching in it (it fits one machine), use it to filter the remaining edges (remove edges incident to matched vertices), recurse. `O(1)`–`O(log log n)` rounds depending on memory and the approximation target.
- **k-means / k-median clustering.** Each machine computes a *weighted coreset* of its points — a small set of weighted representatives whose clustering cost approximates the original's. The union of coresets is itself a coreset (coresets *compose*), so one round of "local coreset, then merge" shrinks the data to one machine, which runs sequential k-means. This composability is exactly the *monoid* property of [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md): a coreset-merge is an associative combine, so coreset construction is a *reduce*.

> **The senior reframing of filtering.** Filtering is the MPC incarnation of the same blocked, two-level decomposition that runs through this whole section: *do as much as possible locally (where computation is free), emit a small summary, combine the summaries.* It works in `O(1)` rounds precisely when (a) the local summary is a polynomial factor smaller than the local input (so the instance shrinks fast) and (b) the summaries *compose correctly* — i.e. the summary is a coreset / the combine is associative. When both hold, sublinear local memory is *enough* memory: one machine's `n^{1−ε}` words can absorb the shrunken instance, and the round count is constant. This is why "the answer to a MapReduce problem is usually: shrink it to one machine in `O(1)` rounds, then solve sequentially" is the load-bearing design heuristic.

---

## Round-Compression and the Connectivity Lower Bound

The frontier of MPC theory is the race to compute **graph connectivity** in as few rounds as possible — connectivity is the canonical hard problem because its answer (which vertices are in the same component) can depend on a path of length up to `n`, so *information must propagate across the whole graph*, which seems to demand many rounds.

### The O(log log n) connectivity result and round compression

The naïve approach contracts the graph by a constant factor per round (Borůvka-style or pointer-jumping), giving `O(log n)` rounds. The breakthrough was beating this:

> **Connectivity in `O(log log n)` rounds.** In the MPC model with strongly sublinear local memory `s = n^δ`, graph connectivity can be solved in `O(log log n + log(n/s)·…)`-style round bounds — for low-diameter / dense graphs, `O(log log n)` rounds — via **round compression** (Andoni–Song–Stein–Wang–Zhong 2018; Behnezhad et al.; Assadi et al.). The technique simulates many "logical" rounds of a slow `O(log n)`-round algorithm inside a *single* MPC round, by having each machine locally explore a large enough neighborhood that it can advance the computation several contraction-levels at once.

**Round compression** is the deep idea: a slow algorithm makes a little progress per logical round, but a machine with `n^δ` local memory can hold a *large enough subgraph* to simulate `log` logical rounds of that progress *locally* in one MPC round — collapsing `O(log n)` logical rounds into `O(log log n)` physical rounds (each physical round doing `log` logical ones). This is the *rounds-vs-memory tradeoff* of §4 pushed to its limit: trade the (sublinear but large) local memory for an exponential reduction in rounds. The same machinery has driven `O(log log n)`-round results for maximal matching, maximal independent set, and approximate matching.

### The 1-vs-2-cycle conjecture: a conditional lower bound

Why does connectivity stall at `O(log log n)` rather than `O(1)`? Because of a conjectured lower bound that is the central open problem of the area:

> **The 1-vs-2-cycle (cycle-vs-two-cycles) conjecture.** Distinguishing a single Hamiltonian cycle on `n` vertices (one component) from two cycles of length `n/2` each (two components) requires `Ω(log n)` MPC rounds when local memory is strongly sublinear `s = n^δ`. Equivalently: connectivity cannot be solved in `o(log n)` rounds in the sublinear-memory regime.

The intuition is information-theoretic and mirrors the PRAM fan-in floor of [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md): in the 1-vs-2-cycle instances the *only* difference between "connected" and "disconnected" is the routing of two edges located anywhere on the cycle, so deciding it requires propagating information across the entire `n`-vertex cycle. With each machine seeing only `n^δ` of the structure and able to extend any vertex's "reach" by a bounded factor per round, reaching across `n` vertices needs `Ω(log_s n) = Ω(log n / log s) = Ω(log n)` rounds (for `s = n^δ`). This is *exactly* the knowledge-set doubling argument of the lower-bound sections of [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md) and [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md), transposed to MPC: information reach grows by a bounded factor per round, and connectivity needs global reach.

The conjecture is **unconditional for restricted algorithm classes** (proven for certain "component-stable" or oblivious algorithms by Ghaffari–Kuhn–Uitto 2019) but remains open in general — and much of MPC complexity is now stated *conditionally on it* (e.g. "this problem needs `Ω(log n)` rounds unless 1-vs-2-cycle is false," analogous to SETH-conditional bounds in sequential complexity). For dense / low-diameter graphs the `O(log log n)` upper bounds *beat* the conjectured `Ω(log n)` worst case precisely because those instances are *not* the hard 1-vs-2-cycle case — the conjecture is about the worst case, and structure lets you do better.

> **The frontier, in one line.** Connectivity (the canonical MPC-hard problem) sits between an `O(log log n)`-round upper bound (via round compression, exploiting local memory to simulate many logical rounds per physical round) and a conjectured `Ω(log n)`-round lower bound (the 1-vs-2-cycle conjecture, an information-reach argument). Closing this gap — and proving the conjecture — is the central open problem of MPC complexity, and it is the MapReduce analogue of "is `NC` proper?"

---

## The Iteration Problem and the Dataflow Response

Everything above analyzes *round count* in the model. The single most consequential *systems* fact about classic MapReduce — the one that spawned an entire generation of successor systems — is that its **per-round cost is catastrophic for iterative algorithms.** This is where the model (rounds) and the engineering (per-round cost) diverge, and the divergence reshaped big-data computing.

### Why classic MapReduce is hostile to iteration

The Dean–Ghemawat (2004) MapReduce materializes each round's output to a distributed file system (GFS/HDFS), replicated for fault tolerance, and reads the next round's input back from it. For a *single-pass* job (grep, sort, an inverted index) this is fine — one pass, one disk write. But the workloads that dominate real analytics are **iterative**: they run the *same* computation over the *same* data for many rounds until convergence.

- **PageRank** multiplies the rank vector by the (normalized) adjacency matrix `~50` times — `50` MapReduce jobs, each re-reading the *entire* (static) graph from disk and writing the rank vector back.
- **k-means** re-reads the points every iteration to reassign them to the nearest center, for `10`–`100` iterations.
- **Iterative graph algorithms** (connected components, shortest paths, label propagation) propagate along edges for up to `diameter` rounds, re-reading the graph each time.
- **Gradient-descent ML** sweeps the dataset per epoch for hundreds of epochs.

In every case the *graph/dataset is static across rounds*, yet classic MapReduce re-reads it from replicated disk *every round*, paying the full I/O cost of the whole input per iteration. For a `50`-iteration PageRank that is `50×` the disk traffic of a single pass — and disk/network I/O, not CPU, is the bottleneck. **The model says PageRank is `~50` rounds; the system makes each of those rounds re-read the entire graph from disk. The round count is fine; the per-round cost is the disaster.**

### The dataflow response: keep state in memory across rounds

The fix is to change *what persists between rounds*: keep the static data (and intermediate state) in **memory**, distributed across the cluster, so iteration `k+1` reuses iteration `k`'s in-memory state instead of re-reading disk. Three model-shifting systems embody this:

- **Spark (Zaharia et al., 2012) — RDDs and lineage.** The **Resilient Distributed Dataset** is a distributed, in-memory, *immutable* collection that can be *cached* across rounds. The static graph is loaded once and `cache()`d; each PageRank iteration is a transformation of the in-memory rank RDD against the cached graph RDD — no disk re-read. Fault tolerance is provided not by replicating data to disk but by **lineage**: an RDD records the *sequence of transformations* (the deterministic recipe) that built it, so a lost partition is *recomputed* from its parents rather than restored from a replica. Lineage is the key insight — it makes in-memory caching *and* fault tolerance compatible, which is what disk-materialization was buying. The result is `10–100×` speedups on iterative workloads, *with the same MPC round count* — the win is entirely in per-round cost (in-memory vs disk).
- **Pregel / BSP (Malewicz et al., 2010) — think like a vertex.** Pregel models graph computation as a **Bulk Synchronous Parallel** sequence of *supersteps*: in each superstep every vertex executes a user function, reads the messages sent to it last superstep, updates its state, and sends messages to its neighbors for next superstep; a global barrier separates supersteps; the computation halts when every vertex votes to halt. The graph (vertices, edges, vertex state) lives in *memory* across supersteps — never re-read from disk — so iteration is cheap. A BFS superstep is exactly the frontier-expansion of [`../05-parallel-graph-bfs/senior.md`](../05-parallel-graph-bfs/senior.md): each superstep advances the frontier one hop, and the superstep count equals the BFS round count there. Pregel *is* the MPC/BSP model made into a graph-programming API, and it is the natural home for the iterative graph algorithms classic MapReduce mangles. (Giraph, GraphX, and GraphLab are the open-source lineage.)
- **Flink — streaming dataflow.** Flink generalizes further to *pipelined* dataflow with native iteration operators and true streaming (records flow through operators without per-stage barriers where possible), targeting low-latency and unbounded streams. It keeps the dataflow-graph and operator state in memory and supports *delta iterations* that only re-process the changed part of the state each round.

> **What "keeping state in memory across rounds" changes about the model.** In the *MPC/MRC model* nothing changes — the round count of PageRank is the same `~50` whether you run it on Hadoop or Spark. What changes is the *per-round cost*, and it changes by orders of magnitude: a round goes from "re-read and re-write the entire input on replicated disk" to "transform in-memory state with lineage-based recovery." This is the precise sense in which Spark/Pregel/Flink are a *different model in practice but the same model in theory* — they leave the rounds alone and attack the constant, which for iterative workloads is the whole ballgame. The senior lesson: **MapReduce's round-complexity theory tells you how many barriers you need; the dataflow systems tell you how to make each barrier cheap by not touching disk — and for iteration, the second is what matters.** Spark's RDD caching, Pregel's in-memory vertex state, and Flink's stateful operators are three expressions of the same fix.

---

## Communication and Shuffle Complexity

Round count is the headline cost, but *within* a round the dominant resource is **communication** — the data moved by the shuffle — and the senior must reason about it as carefully as rounds. The shuffle is where MapReduce spends its bandwidth, and skew is where it fails.

### The shuffle is a distributed sort

Between map and reduce, every emitted `(key, value)` must travel to the machine responsible for `key`. This grouping-by-key is exactly a **distributed sort by key** (or a distribution/bucket sort — partition keys into per-reducer buckets), the very primitive of [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md). The connection is exact: the *partitioner* that maps keys to reducers is choosing *splitters* (sample sort's step 2), and a balanced shuffle is a balanced sample sort. So the shuffle inherits sample sort's machinery *and* its failure mode — a badly chosen partition gives a hot reducer, the distributed analogue of an overfull bucket.

### Two cost measures: total communication and load

The shuffle has two distinct cost measures, and good algorithms control both:

- **Total communication** — the *sum* of bytes crossing the network across all machines in the round. This is the aggregate bandwidth bill; combiners (map-side pre-aggregation, see [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md)) attack it by shrinking each mapper's output *before* it is shuffled. A combiner is a *partial reduce* on the map side; it works only because the reduce operator is a *commutative monoid* (the framework merges partial groups in nondeterministic network-arrival order), which is exactly the commutativity requirement spelled out in [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md).
- **Load** — the *maximum* bytes any single reducer receives (equivalently, the size of the largest key-group). Load, not total communication, sets the round's *wall-clock* time: the round runs at the speed of its fullest reducer (a straggler), and the sublinear-memory constraint *requires* the load to be `O(s) = O(n^{1−ε})` — a key-group larger than one machine's memory simply cannot be reduced. Load is the binding constraint, and **skew is its enemy**.

### Skew: the load killer

**Skew** is the situation where one key (or a few) carries a disproportionate share of the values — the distributed analogue of an unbalanced bucket in sample sort. A `GROUP BY country` over web logs where `90%` of traffic is one country sends `90%` of the values to one reducer; a join on a key with massive fan-out (the "celebrity" problem — joining users to a celebrity's millions of followers) does the same. The consequences and fixes:

- **Symptom.** One reducer's input exceeds its memory (`load > s`) → the job either OOMs or that single straggler dominates the wall-clock, and adding machines does not help (the hot key cannot be split across them naïvely).
- **Salting / key-splitting.** Append a random suffix `(key, r)` for `r ∈ {1..R}` to spread a hot key across `R` reducers, partial-reduce each shard, then a *second* round merges the `R` partials. This costs an extra round but restores balance — the explicit rounds-vs-load tradeoff.
- **Combiners shrink the hot key at the source.** For an associative-commutative reduce (sum, count), a combiner collapses each mapper's contribution to a hot key to *one* value before the shuffle, so the reducer receives `O(#mappers)` values per key instead of `O(n)` — often enough to defuse skew without an extra round.
- **Better partitioners.** Sample the key distribution and assign *splitters* so each reducer gets `≈ n/p` *values* (not `≈ n/p` *keys*) — exactly sample sort's oversampling load-balance guarantee (see [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md)), now applied to weighted keys.

> **The shuffle, summarized.** The shuffle is the round's all-to-all distributed sort; its *total communication* is the bandwidth bill (cut it with combiners — partial reduces that need a commutative monoid) and its *load* (max bytes per reducer) is the wall-clock-setting bottleneck (capped at `O(s)` by sublinear memory, killed by skew). Controlling load is the same problem as balancing buckets in sample sort, with the same tool (oversampled splitters) and the same failure mode (a hot key = an overfull bucket). This is why [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md) and [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) are prerequisites: the shuffle is a sort, and the reduce is a monoid fold whose combiner needs commutativity.

---

## Worked Piece: Filtering for Connectivity, and PageRank MapReduce vs Spark

Two end-to-end derivations tie the threads together: the *algorithmic* one (filtering shrinks connectivity to one machine in `O(1)` rounds) and the *systems* one (why PageRank is a disaster on MapReduce and a triumph on Spark — same rounds, opposite per-round cost).

### Part A — filtering computes connectivity / spanning forest in O(1) rounds

**The setup.** Input: a graph `G = (V, E)` with `n = |V|` vertices and `m = |E|` edges, `m` possibly as large as `n²`. Local memory `s = n^{1+c}` for a small `c > 0` (the *near-linear-in-vertices* regime — each machine can hold a forest on all `n` vertices, which has `< n` edges, but not all `m` edges). Goal: a spanning forest of `G` (which gives connected components) in `O(1)` rounds.

**The filtering algorithm (Lattanzi–Moseley–Suri–Vassilvitskii, 2011, "Filtering: a method for solving graph problems in MapReduce").**

```text
   PARAMETERS:  partition the m edges across machines so each holds ≤ s edges.
   INVARIANT:   a spanning FOREST of any edge-subset has ≤ n−1 edges and
                preserves connectivity of that subset (a non-forest edge is
                redundant — its endpoints are already connected).

   ROUND (repeat until E fits one machine):
     map:     edges are distributed across machines (≤ s each).
     reduce:  each machine computes a SPANNING FOREST of its local edge-subset
              (a sequential union-find), EMITTING ONLY the ≤ n−1 forest edges
              and DISCARDING the rest.
     ⟹ the surviving edge count shrinks from |E| to ≤ (#machines)·(n−1).
```

**Why it is correct.** Discarding a non-forest edge never changes connectivity: if edge `(u,v)` is *not* in the local spanning forest, then `u` and `v` are already connected by the forest edges that *were* kept, so removing `(u,v)` cannot disconnect anything globally. The union of the per-machine forests therefore preserves the connectivity of `G`. (This is the same "an edge outside the forest is redundant for connectivity" fact that makes Borůvka and Kruskal correct.)

**Why it is `O(1)` rounds.** Suppose `m = n^{1+c}` and each machine holds `s = n^{1+c'}` edges with `c' < c`, so there are `#machines = m/s = n^{c−c'}` machines. After one round the surviving edges number `≤ #machines · (n−1) ≈ n^{c−c'} · n = n^{1+c−c'}` — the exponent dropped by `c'`. Each round subtracts `c'` from the exponent of the surviving edge count, so after `⌈c/c'⌉ = O(1)` rounds the survivors number `≤ n` — a single forest that fits one machine, where a final sequential union-find finishes:

```text
   edges:  n^{1+c}  →  n^{1+c−c'}  →  n^{1+c−2c'}  →  …  →  n^{1+c−kc'}  ≤  n
           after k = ⌈c/c'⌉ = O(1) rounds, the surviving forest fits in s memory.
```

So connectivity is `O(1)` MPC rounds in the near-linear-memory regime — *not* the naïve `O(log n)` contraction rounds, and not the `O(log² n)` a generic PRAM simulation would give. The win comes entirely from **using local memory to shrink the instance** (each machine collapses its `s` edges to `≤ n` forest edges), the filtering paradigm of §5 made concrete. (For *strongly* sublinear `s = n^δ` the round count rises toward `O(log n)` / `O(log log n)` and the round-compression machinery of §6 enters — but the *technique* is the same: local shrink, then merge.)

### Part B — PageRank: MapReduce vs Spark, same rounds, opposite cost

**The computation.** PageRank iterates the rank update `r ← (1−d)/n · 𝟙 + d · Mᵀ r`, where `M` is the row-normalized adjacency matrix, for `~50` iterations until `r` converges. Each iteration is one sparse matrix–vector product `Mᵀ r` — a map-reduce: *map* each edge `(u→v)` to a contribution `r[u]/deg(u)` keyed by `v`, *reduce* (sum) the contributions per `v`. The *graph `M` is static across all `~50` iterations*; only `r` changes.

**On classic MapReduce.** Each iteration is a separate MapReduce job:

```text
   per iteration:
     map:    read the ENTIRE graph (edge list) from HDFS;  emit (v, r[u]/deg(u)) per edge.
     shuffle: group contributions by target vertex v.
     reduce: sum → new r[v];  WRITE r back to HDFS (replicated).
   total over 50 iterations:  50 × (read whole graph from disk + write r to replicated disk).
```

The fatal inefficiency: **the static graph is re-read from replicated disk on every one of the `~50` iterations**, and the rank vector is written back to replicated disk each time. For a graph that fits in cluster memory, this is `~50×` the I/O of necessity — and I/O is the bottleneck. The *round count is `~50`*, which is fine; the *per-round cost includes a full disk pass over the entire graph*, which is the disaster of §7.

**On Spark.** The graph is loaded once into an RDD and `cache()`d in distributed memory; only the rank RDD is recomputed each iteration:

```text
   load:  links = graph.cache()           # static graph: read disk ONCE, kept in memory
   loop 50×:
     contribs = links.join(ranks).flatMap(emit r[u]/deg(u) to each neighbor)
     ranks    = contribs.reduceByKey(_ + _).mapValues((1−d)/n + d·_)   # all in memory
   # no disk re-read of the graph; ranks lives in memory; lineage gives fault tolerance
```

The static `links` graph is read from disk *once* and stays in memory for all `50` iterations; each iteration is an in-memory `join` + `reduceByKey` (a map-reduce on cached RDDs). If a partition is lost, *lineage* recomputes it from the cached parents rather than reloading from a replica. Same `~50` MPC rounds; the per-round cost drops from "full disk pass over the graph" to "in-memory transform," giving the characteristic `10–100×` speedup on iterative graph workloads.

**Pregel framing.** Cast as Pregel, PageRank is `~50` *supersteps*: each vertex holds its rank in memory across supersteps, receives neighbor contributions as messages, sums them, updates its rank, and sends its new contribution to neighbors — the graph never leaves memory, and a superstep is exactly the per-iteration map-reduce above, expressed as think-like-a-vertex. The superstep is the BFS-frontier analogue of [`../05-parallel-graph-bfs/senior.md`](../05-parallel-graph-bfs/senior.md), here carrying numeric rank-mass instead of a visited flag.

> **The takeaway, mirroring Part A.** The *model* (rounds) is identical across MapReduce, Spark, and Pregel — PageRank is `~50` rounds everywhere. The *systems* difference is entirely in the per-round cost: classic MapReduce re-reads the static graph from disk every round (§7's iteration disaster), while Spark's cached RDDs and Pregel's in-memory vertex state pay the disk cost *once*. This is the exact dual of Part A's algorithmic lesson: Part A shows you cut *rounds* by shrinking the instance into memory (filtering); Part B shows you cut *per-round cost* by keeping state in memory (dataflow). Rounds and per-round cost are the two independent axes of MapReduce performance, and the senior optimizes both — the model's rounds with filtering/round-compression, the system's per-round cost with in-memory dataflow.

---

## Decision Framework

When you face a large-scale, distributed data-processing problem and must reason about it as MapReduce/MPC:

1. **Count the rounds first — that is the model's cost.** Each round is a barrier + an all-to-all shuffle (+ classically a disk pass). An `O(1)`-round algorithm beats an `O(log n)`-round one by a factor of *barriers*, which dwarfs per-round constant factors. State your algorithm's cost as its round count under sublinear local memory `s = n^δ` (MRC/MPC).
2. **Respect sublinear memory: no machine sees everything.** Every key-group (reducer load) and every local working set must fit in `s = O(n^{1−ε})`. If a key-group can exceed `s` (skew, hot key), you *must* split it (salting) or the reduce cannot run. This constraint is what makes the problem distributed-hard.
3. **To cut rounds, shrink to one machine: filter / coreset.** Use local memory to compute a small summary (spanning forest for connectivity/MST, weighted coreset for clustering, sparse subgraph for matching) that the answer survives; merge summaries (they must *compose* — an associative combine, a coreset). When the summary shrinks the instance by `n^δ` per round, you reach one-machine size in `O(1/δ) = O(1)` rounds, then solve sequentially. (Lattanzi et al.)
4. **Know the connectivity frontier.** Connectivity is `O(log n)` rounds naïvely, `O(log log n)` via round compression (simulate many logical rounds per physical round using local memory), and *conjecturally* `Ω(log n)` in the worst case (the 1-vs-2-cycle conjecture). Information must propagate across the graph; reach grows boundedly per round — the MPC fan-in floor.
5. **For iterative workloads, the round count is fine — fix the per-round cost.** PageRank, k-means, graph propagation, and ML training re-read static data every round. Classic MapReduce re-reads it *from disk* — a disaster. Use **Spark** (cache the static RDD in memory, lineage for fault tolerance) or **Pregel/BSP** (in-memory vertex state across supersteps, link [`../05-parallel-graph-bfs/senior.md`](../05-parallel-graph-bfs/senior.md)) or **Flink** (stateful streaming dataflow). Same rounds, `10–100×` faster per round.
6. **Treat the shuffle as a distributed sort, and control both communication and load.** Cut *total communication* with combiners (map-side partial reduces — they need a *commutative* monoid, see [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md)); cut *load* (max reducer input, the wall-clock-setting bottleneck) with oversampled splitters (sample sort's balance guarantee, see [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md)). Detect and defuse **skew** (hot keys) by salting/key-splitting at the cost of an extra round.
7. **Import `NC` algorithms via the PRAM simulation — but beat it with memory.** An `O(T_∞)`-span PRAM algorithm is an `O(T_∞)`-round MPC algorithm (so all of `NC` → `O(polylog)` rounds). But the generic simulation is wasteful: more local memory lets you simulate `log s` PRAM steps per round (rounds-vs-memory tradeoff), so design *for* the memory rather than black-box-translating.

---

## Research Pointers

- **Dean, J., & Ghemawat, S. (2004).** "MapReduce: Simplified Data Processing on Large Clusters." *OSDI.* The original programming model — map, shuffle, reduce, combiners — and the systems framing that defined the field.
- **Karloff, H., Suri, S., & Vassilvitskii, S. (2010).** "A Model of Computation for MapReduce." *SODA.* The **MRC model**: sublinear memory `O(n^{1−ε})`, sublinear machines, `O(polylog)` rounds; the PRAM-to-MapReduce simulation; the formal foundation for round complexity.
- **Goodrich, M. T., Sitchinava, N., & Zhang, Q. (2011).** "Sorting, Searching, and Simulation in the MapReduce Framework." The MapReduce/BSP simulation results and the `O(1)`-round sorting/prefix-sum building blocks.
- **Lattanzi, S., Moseley, B., Suri, S., & Vassilvitskii, S. (2011).** "Filtering: A Method for Solving Graph Problems in MapReduce." *SPAA.* The **filtering** paradigm — `O(1)`-round MST, connectivity, matching by shrinking the instance to one machine.
- **Beame, P., Koutris, P., & Suciu, D. (2013/2017).** "Communication Steps for Parallel Query Processing." The MPC model's communication/round lower bounds for joins and the rounds-vs-communication tradeoff.
- **Andoni, A., Nikolov, A., Onak, K., & Yaroslavtsev, G. (2014); Andoni, Song, Stein, Wang, Zhong (2018).** Parallel algorithms and **round compression** for graph problems — the `O(log log n)`-round connectivity line of work.
- **Ghaffari, M., Kuhn, F., & Uitto, J. (2019).** "Conditional Hardness Results for Massively Parallel Computation from Distributed Lower Bounds." The conditional **1-vs-2-cycle** lower bounds and the connectivity `Ω(log n)` conjecture for restricted MPC.
- **Malewicz, G., et al. (2010).** "Pregel: A System for Large-Scale Graph Processing." *SIGMOD.* The **think-like-a-vertex / BSP** model — supersteps, vertex state in memory, message passing — for iterative graph computation.
- **Zaharia, M., et al. (2012).** "Resilient Distributed Datasets: A Fault-Tolerant Abstraction for In-Memory Cluster Computing." *NSDI.* **Spark / RDDs** — in-memory caching across rounds and **lineage**-based fault tolerance; the iteration fix.
- **Valiant, L. G. (1990).** "A Bridging Model for Parallel Computation." *CACM.* The **BSP** model (supersteps, barriers, the `g`/`L` cost parameters) that Pregel and MPC inherit.
- **Carbone, P., et al. (2015).** "Apache Flink: Stream and Batch Processing in a Single Engine." The streaming-dataflow generalization with stateful operators and delta iterations.

---

## Key Takeaways

- **MapReduce is a *computational model* whose cost is round complexity.** The MRC model (Karloff–Suri–Vassilvitskii, 2010) fixes sublinear per-machine memory (`O(n^{1−ε})`), a sublinear number of machines, and `O(polylog n)` rounds. A round is one full map → shuffle → reduce, and it is expensive because the shuffle is an all-to-all distributed sort ending in a synchronization barrier (and, classically, a disk pass). **Rounds are to MapReduce what span is to PRAM.**
- **MPC generalizes MRC and connects to PRAM span.** The Massively Parallel Computation model parameterizes local memory `s` vs input `N` (superlinear / near-linear / strongly-sublinear regimes) and covers MapReduce, Spark, Pregel, and Flink. Its round count is the model-level "how many barriers does this need?" — independent of the per-round (in-memory vs disk) cost.
- **PRAM simulates into MapReduce, so `NC` → `O(polylog)` rounds.** A CREW PRAM step → `O(1)` MapReduce rounds (route reads, compute, route writes — each a sort-by-address shuffle), so span `T_∞` → `O(T_∞)` rounds and `NC^i ⊆ MRC^i`. The generic simulation is beatable: more local memory simulates `log s` PRAM steps per round — the **rounds-vs-memory tradeoff**.
- **Low-round design = filtering / coresets: shrink to one machine, then solve locally.** Use local memory to compute a composing summary (spanning forest, weighted coreset, sparse subgraph); each round shrinks the instance by `n^δ`, so `O(1/δ) = O(1)` rounds suffice for MST, connectivity, matching, and clustering (Lattanzi et al.). Coreset-merge is an associative combine — a *reduce* (see [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md)).
- **Connectivity defines the frontier.** `O(log log n)` rounds via **round compression** (simulate many logical rounds per physical round using local memory), conjecturally `Ω(log n)` in the worst case (the **1-vs-2-cycle conjecture** — information must reach across the whole graph, an MPC fan-in floor). Closing this gap is the central open problem.
- **Classic MapReduce is hostile to iteration; dataflow is the fix.** It re-reads static data *from disk* every round — fatal for PageRank, k-means, graph propagation, ML. **Spark** (RDDs cached in memory, **lineage** for fault tolerance; Zaharia 2012), **Pregel/BSP** (in-memory vertex state across supersteps; Malewicz 2010), and **Flink** (stateful streaming) keep cross-round state in memory: *same rounds, `10–100×` cheaper per round.*
- **The shuffle is a distributed sort; its costs are communication and load.** Total communication (the bandwidth bill — cut with *commutative-monoid* combiners) and load (max bytes per reducer — the wall-clock bottleneck, capped at `O(s)`, killed by *skew*). Balancing reducer load is sample sort's bucket-balancing problem with the same oversampled-splitter fix (see [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md)).

---

> **See also:** [`./middle.md`](./middle.md) for the execution model, combiners, the pattern catalogue, and joins · [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) for the monoid/semiring algebra of map-reduce and why combiners need a commutative monoid · [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md) for the shuffle-as-distributed-sort, sample sort, and the one-round / load-balance arguments · [`../05-parallel-graph-bfs/senior.md`](../05-parallel-graph-bfs/senior.md) for the Pregel/BSP superstep as frontier expansion and iterative graph computation
