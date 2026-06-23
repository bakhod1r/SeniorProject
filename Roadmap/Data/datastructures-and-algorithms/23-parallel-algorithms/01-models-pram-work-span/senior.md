# Models of Parallel Computation: PRAM and Work–Span — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — the PRAM hierarchy (EREW ⊆ CREW ⊆ CRCW), the work–span model (`T₁`, `T∞`), Brent's theorem, the parallelism `T₁/T∞`, and Amdahl's / Gustafson's laws
- [Complexity Classes P and NP — Senior](../../06-algorithmic-complexity/06-complexity-classes-p-np/senior.md) — `P`, log-space and polynomial-time reductions, and completeness as the tool that locates a problem's intrinsic difficulty
- [Parallel Prefix Sum (Scan) — Senior](../02-parallel-prefix-sum-scan/senior.md) — the canonical `O(n)`-work, `O(log n)`-span primitive used throughout as the running example of "efficiently parallelizable"

## Table of Contents

1. [What Senior-Level Parallel-Model Theory Is About](#what-senior-level-parallel-model-theory-is-about)
2. [The Class NC: Polylog Span Is "Efficiently Parallelizable"](#the-class-nc-polylog-span-is-efficiently-parallelizable)
3. [The NC Hierarchy, AC^k, and Where the Boundaries Sit](#the-nc-hierarchy-ack-and-where-the-boundaries-sit)
4. [P-Completeness and Inherently Sequential Problems](#p-completeness-and-inherently-sequential-problems)
5. [PRAM Lower Bounds: Why Span Cannot Always Shrink](#pram-lower-bounds-why-span-cannot-always-shrink)
6. [Scheduling Theory: The Work-Stealing Time Bound](#scheduling-theory-the-work-stealing-time-bound)
7. [More Realistic Models: BSP, LogP, MPC, Cache-Oblivious](#more-realistic-models-bsp-logp-mpc-cache-oblivious)
8. [Worked Piece: Prefix Sum Is in NC¹, and Brent Schedules It](#worked-piece-prefix-sum-is-in-nc-and-brent-schedules-it)
9. [Decision Framework](#decision-framework)
10. [Research Pointers](#research-pointers)
11. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Parallel-Model Theory Is About

The middle level establishes the *vocabulary*. The PRAM gives a synchronous shared-memory machine with a hierarchy of write-conflict rules (EREW, CREW, CRCW). The work–span model abstracts away the processor count: `T₁` is total work, `T∞` is the critical-path length (span), and a real `P`-processor run is bracketed by `max(T₁/P, T∞) ≤ T_P ≤ T₁/P + T∞` (Brent, 1974). Parallelism is `T₁/T∞`. Amdahl bounds speedup by the serial fraction. That is the "here are the levers" level.

Senior-level theory asks the next three questions, and they are the ones that actually decide whether parallelism will help you:

1. **Which problems are *inherently* parallel, and which are *inherently* sequential?** The work–span model lets you describe an algorithm's parallelism, but it says nothing about whether a *better* algorithm exists. The class `NC` formalizes "admits a polylog-span, polynomial-work solution." `P`-completeness formalizes its conjectured opposite: a problem so sequential that a fast parallel algorithm for it would collapse `NC` into `P`. This is the parallel analogue of `NP`-completeness, and for a practitioner it is the more immediately useful classification — it tells you *before you start* whether to expect a good speedup.
2. **What forces span to stay large?** Brent and the work–span model give *upper* bounds. The matching question — *why can't span be smaller?* — is answered by PRAM lower bounds (Cook–Dwork–Reischuk; Beame–Håstad). These are real theorems that separate the PRAM variants from each other and pin down an `Ω(log n)` floor for problems as simple as OR and PARITY on the weaker machines.
3. **How does the model survive contact with a real machine?** The PRAM charges nothing for communication and assumes lockstep synchrony — both false. The senior obligation is to know the refinements (BSP, LogP, MPC, cache-oblivious parallelism) that re-introduce the costs the PRAM hides, *and* to know which idealized result still transfers. The bridge from theory to Cilk, TBB, and Go is the Blumofe–Leiserson work-stealing bound, which turns a work–span pair into a concrete, provable wall-clock guarantee.

The unifying senior stance: **the work–span model is the design language, `NC`/`P`-completeness is the feasibility classifier, the PRAM lower bounds are the floor, and BSP/LogP/MPC are the corrections you apply when communication is not free.** Each section below develops one of these and links it to the others.

---

## The Class NC: Polylog Span Is "Efficiently Parallelizable"

The defining intuition of the field: a problem is "well-parallelizable" not when it merely *can* run on many processors, but when throwing processors at it drives the running time down to *polylogarithmic*. A linear-span algorithm on `n` processors finishes in `Θ(n)` time — no asymptotic win over the sequential machine. A problem worth parallelizing is one whose span is `O(log^k n)` for a fixed `k`, so that with a polynomial number of processors the wall-clock time is exponentially smaller than the input size. That is exactly what `NC` captures.

> **Definition (NC — "Nick's Class," after Nick Pippenger).** A problem is in `NC` if it can be solved on a PRAM in `O(log^k n)` time (span) using `O(n^c)` processors, for some constants `k, c`. Equivalently — and this is the form that ties it to circuits — `NC` is the class of problems decided by a family of Boolean circuits of polynomial size and *polylogarithmic depth*, with bounded fan-in gates.

Two readings, one class:

- **PRAM reading.** Span is `polylog`; processor count (hence total work) is polynomial. Time `T_P = polylog(n)` with `P = poly(n)`.
- **Circuit reading.** Depth is `polylog` (depth = span); size is `poly` (size ≈ total work). The fan-in-2 AND/OR/NOT circuit is the canonical uniform parallel machine, and depth is the natural notion of parallel time.

The two readings coincide because a polylog-depth, poly-size circuit can be simulated by a polylog-span, poly-work PRAM and vice versa (with the usual uniformity caveats — the circuit family must be describable by a log-space machine, so the model is not "cheating" by hard-coding answers into the circuits). Throughout, treat **depth ≡ span** and **size ≈ work**; the correspondence is what makes the circuit lower bounds in the next sections speak directly to PRAM span.

### NC sits inside P

> **`NC ⊆ P`.** Any `NC` algorithm uses `polylog` span and `poly` processors, so its total work `T₁ ≤ span × processors = polylog(n) · poly(n) = poly(n)`. A single sequential processor can replay that work in polynomial time. Hence everything efficiently parallelizable is also efficiently *sequentially* solvable.

The containment is the easy direction and it is never in doubt. The deep question is the converse.

> **The open `NC =? P` question.** Is every polynomial-time-solvable problem also polylog-span solvable? Nobody knows. It is widely conjectured that `NC ⊊ P` — i.e., **some** problems are intrinsically sequential and admit no dramatic parallel speedup no matter how clever you are. `NC = P` would mean every sequential polynomial-time computation could be "flattened" to polylog depth, which seems as implausible as `P = NP`, but like `P` vs `NP` it remains unresolved. This is the structural backdrop for `P`-completeness: a `P`-complete problem is in `NC` *if and only if* `NC = P`.

The parallel between the two great open questions is exact and worth holding in mind: `P` vs `NP` asks "is verifying as hard as solving?"; `NC` vs `P` asks "is solving-sequentially as hard as solving-in-parallel?" See [`../../06-algorithmic-complexity/06-complexity-classes-p-np/senior.md`](../../06-algorithmic-complexity/06-complexity-classes-p-np/senior.md) for the completeness machinery that both questions reuse.

---

## The NC Hierarchy, AC^k, and Where the Boundaries Sit

`NC` is stratified by the exponent on the logarithm in the depth bound.

> **Definition (`NC^k`).** Problems decided by uniform Boolean circuits of polynomial size, depth `O(log^k n)`, and **bounded** fan-in (gates take ≤ 2 inputs). Then
> ```text
>    NC¹ ⊆ NC² ⊆ NC³ ⊆ … ⊆ NC = ⋃_k NC^k.
> ```

The inclusions are immediate (more depth is never a handicap). Whether any of them is *strict* is open — the entire `NC` hierarchy could in principle collapse, just as `NC` could collapse into `P`. What *is* known is where familiar problems land:

- **`NC¹`** — Boolean formula evaluation, integer addition, the parity of `n` bits, prefix sums of an associative operator (the Ladner–Fischer / Brent–Kung construction; see the worked piece), sorting networks of `O(log n)` depth (AKS, with a notoriously large constant). `NC¹` is the home of the "balanced binary tree of associative combines" pattern.
- **`NC²`** — problems needing roughly `log² n` depth: matrix powering and hence transitive closure, all-pairs shortest paths via repeated squaring, determinant and matrix inverse over a field, solving linear systems, and (a landmark result) **directed graph reachability is in `NC²`** through matrix-based methods, even though *depth-first* search is not known to be parallel at all (see `P`-completeness below).

A second axis allows **unbounded fan-in** gates, giving the `AC` hierarchy.

> **Definition (`AC^k`).** Like `NC^k` but AND/OR gates may take **any** number of inputs in unit depth. `AC⁰` is constant-depth, poly-size, unbounded-fan-in circuits.

A single unbounded-fan-in OR can combine `n` inputs in depth 1, where a bounded-fan-in circuit needs a depth-`log n` tree. That one-level saving is exactly a logarithmic factor of depth, which gives the interleaving:

```text
   NC^k ⊆ AC^k ⊆ NC^{k+1}      for every k ≥ 0,
```

and therefore `⋃_k AC^k = ⋃_k NC^k = NC`. The two hierarchies define the *same* class `NC` but stratify it differently. The `AC⁰` vs `NC¹` gap is where the first real separation lives: **PARITY ∉ AC⁰** (Furst–Saxe–Sipser; Ajtai; sharpened by Håstad's switching lemma) — no constant-depth unbounded-fan-in poly-size circuit computes the parity of `n` bits, while parity is trivially in `NC¹`. This is one of the few *unconditional* circuit lower bounds we possess, and it is the formal reason "XOR of `n` bits" cannot be done in `O(1)` span even with unbounded-fan-in OR/AND — a fact whose PRAM shadow we meet next.

---

## P-Completeness and Inherently Sequential Problems

`NP`-completeness identifies the hardest problems *in* `NP`; `P`-completeness identifies the hardest problems *in* `P` with respect to **parallelizability**. The reduction must be weak enough that it cannot itself smuggle in the hardness, so we change the reduction notion.

> **Definition (`P`-complete).** A problem `A` is `P`-complete if (i) `A ∈ P`, and (ii) every problem in `P` reduces to `A` under a **log-space** (equivalently, `NC`) reduction. The reduction must be computable with `O(log n)` workspace — far weaker than the polynomial-time reductions used for `NP`-completeness — precisely so that the reduction lives *inside* `NC` and cannot do the hard work for free.

The payoff theorem mirrors the `NP`-completeness payoff exactly:

> **If any `P`-complete problem is in `NC`, then `NC = P`.** A log-space reduction is itself an `NC` computation; composing it with a hypothetical `NC` algorithm for the `P`-complete target gives an `NC` algorithm for *every* problem in `P`. Contrapositive — the one you actually use: **if `NC ≠ P` (the conjecture), no `P`-complete problem has a polylog-span algorithm.**

### The canonical P-complete problems

- **Circuit Value Problem (CVP)** — given a Boolean circuit and its inputs, compute the output. This is the `P`-complete problem (Ladner, 1975), the analogue of SAT for `P`. It is "obviously sequential": gate `g`'s value can depend on a chain of `Ω(depth)` predecessors, and evaluating a circuit *is the most general polynomial computation*, so nothing more general can be parallel if this one is not. Even restricted variants (monotone CVP, planar CVP) stay `P`-complete.
- **Linear Programming** — solving an LP to optimality is `P`-complete. (Approximate or fixed-dimension LP can be easier, but exact LP in general dimension is conjectured inherently sequential.)
- **Lexicographically-first Depth-First Search** — computing the DFS order that always takes the lowest-numbered unvisited neighbor is `P`-complete (Reif). This is the sharpest practical warning in the catalogue: **reachability is in `NC²`, but lexicographic DFS is `P`-complete.** "Visit the graph" parallelizes; "visit it in *this specific order*" does not. The order is the sequential bottleneck, not the traversal.
- **Maximum Flow / value of a max flow** — `P`-complete (Goldschlager–Shaw–Staples). Many flow and matching *decision* questions resist `NC`, even though some are in randomized `NC`.

### What this means at the keyboard

When a problem is `P`-complete, the senior conclusion is operational, not philosophical: **do not invest in finding a low-span algorithm; there almost certainly isn't one.** The realistic plays are (a) parallelize a *different but adequate* formulation (push–relabel max-flow exposes more parallelism in practice than the worst case suggests; reachability instead of DFS-order when the order is incidental), (b) accept linear span and parallelize only the inner per-step work, or (c) approximate, since many `P`-complete problems have `NC` approximation schemes. `P`-completeness is the parallel-world counterpart of the advice that `NP`-hardness gives the sequential world: stop hunting for the algorithm that the complexity class says is unlikely to exist.

---

## PRAM Lower Bounds: Why Span Cannot Always Shrink

Brent's theorem and the work–span model produce *upper* bounds on span. The complementary theory proves that certain spans are *forced*, and in doing so it **separates the PRAM variants** — showing the write-conflict rules are not cosmetic.

### The EREW/CREW Ω(log n) floor

> **Theorem (Cook–Dwork–Reischuk, 1986).** On a CREW PRAM (hence also EREW), computing the OR of `n` bits — or any Boolean function that *depends on all `n` inputs*, such as parity or the AND — requires `Ω(log n)` steps, **regardless of the number of processors**.

The argument is an information-flow / sensitivity argument and it is worth internalizing because it explains *why throwing processors at the problem cannot help*. Define a function's **sensitivity** at an input as the number of single-bit flips that change the output. On a CREW machine in one step, a processor reads at most one cell and writes at most one cell; the set of input bits that can possibly have influenced the value stored in any given cell — its "knowledge set" — can at most **double** per step, because a write to a cell can only fuse the knowledge already present in two cells (the writer's state and the target). Functions like OR have inputs of sensitivity `n` (at the all-zeros input, flipping any single bit flips the output). To produce an answer sensitive to all `n` bits, some cell's knowledge set must reach size `n`; starting from singletons and at most doubling each step, that needs `Ω(log n)` steps. Processor count is irrelevant — it does not change the doubling rate. This is the lower bound that *matches* the `O(log n)` span of every balanced-tree associative reduction, certifying those algorithms as span-optimal on EREW/CREW.

### CRCW breaks the floor for OR — but not for PARITY

The Common/Arbitrary CRCW model lets many processors write the same cell simultaneously (under a conflict rule), and this single relaxation collapses the OR bound:

> **OR in `O(1)` on CRCW.** Give each input bit a processor. Initialize a result cell to 0. Every processor whose bit is 1 writes 1 to the result cell; concurrent writes are allowed and (Common rule) all agree on the value 1. After one step the cell holds the OR. Constant span, `n` processors.

So CRCW is *strictly* more powerful than CREW for OR: `O(1)` vs `Θ(log n)`. This is a genuine, unconditional separation of the PRAM hierarchy. The natural follow-up — does CRCW also flatten *parity*? — has a famously delicate answer:

> **Theorem (Beame–Håstad, 1989).** Computing PARITY on a CRCW PRAM with **polynomially many** processors requires `Ω(log n / log log n)` steps, and this is tight.

PARITY is the canonical "fragile" function: changing any single bit always flips the answer, so the cheap concurrent-write trick that works for OR (where a single 1 suffices) gains nothing — you cannot detect "an odd number of ones" by anyone shouting. The `log n / log log n` floor is the CRCW shadow of the unconditional circuit result `PARITY ∉ AC⁰` from the previous section: `AC⁰` is exactly constant-depth unbounded-fan-in circuits, and a `t`-step poly-processor CRCW PRAM corresponds to depth-`O(t)` unbounded-fan-in circuits, so a constant-step CRCW parity algorithm would put PARITY in `AC⁰` — which Håstad's switching lemma forbids. The PRAM lower bound and the circuit lower bound are *the same theorem* viewed through the two readings of `NC` from earlier.

The takeaway is a clean separation ladder for the function OR-vs-PARITY:

```text
   OR:      CRCW O(1)          CREW/EREW  Θ(log n)
   PARITY:  CRCW Θ(log n/log log n)        CREW/EREW Θ(log n)
```

The model you assume is not a detail; it changes the achievable span by an unbounded factor.

---

## Scheduling Theory: The Work-Stealing Time Bound

Everything above is about *whether* low span exists. The remaining question is whether a real runtime can actually *realize* the `T₁/P + T∞` Brent bound on `P` physical cores without a clairvoyant central scheduler. The answer — and the theoretical foundation of Cilk, Intel TBB, and Go's goroutine scheduler — is **randomized work-stealing**.

> **Theorem (Blumofe–Leiserson, 1999).** A fully-strict (fork–join) computation with work `T₁` and span `T∞`, run by the randomized work-stealing scheduler on `P` processors, completes in expected time
> ```text
>    E[T_P] ≤ T₁/P + O(T∞),
> ```
> using at most `P · S₁` space (where `S₁` is the serial stack space) and incurring `O(P · T∞)` expected *steal attempts* (and the same order of communication / cache-miss overhead in the extended model).

This is the result that makes the work–span model *operationally honest*: it says the abstract `T₁/T∞` parallelism you computed at design time is what a real, decentralized scheduler delivers, to within a constant factor on the span term, with no global coordination.

### The intuition behind the bound

Each processor keeps its own deque of ready tasks. It works at the *bottom* of its own deque (LIFO, exactly like a sequential call stack — this is what bounds space to `P · S₁`). When a processor's deque empties, it becomes a **thief**: it picks a victim processor uniformly at random and tries to steal the *top* (oldest, nearest-the-root) task from the victim's deque.

The accounting splits every processor-step into two buckets:

- **Work steps.** A processor is executing a task. Summed over all processors and all time, these total exactly `T₁`, so they contribute `T₁/P` to the time when amortized over `P` processors. This term is unavoidable and optimal.
- **Steal (idle) steps.** A processor is attempting to steal. The crux is a *potential argument*: each task near the root of the not-yet-executed dag carries potential, every steal attempt has a constant probability of grabbing a task that advances the critical path, so after `O(T∞)` *successful* steals the entire critical path is consumed. A balls-in-bins / delay-sequence argument shows the *attempts* total `O(P · T∞)` in expectation. Divided by `P`, idle time contributes `O(T∞)`.

Add them: `E[T_P] ≤ T₁/P + O(T∞)`. The `O(P · T∞)` steal count is also the communication bound — it tells you that on a high-parallelism program (`T∞` small relative to `T₁/P`) steals are *rare*, which is why work-stealing has near-zero overhead in the common case and degrades gracefully only when parallelism is genuinely scarce.

### Why this is the bridge to real systems

The Brent bound `T_P ≤ T₁/P + T∞` was a statement about an *idealized greedy* schedule that a god's-eye scheduler could produce. Blumofe–Leiserson upgrades it to a *distributed, randomized, online* schedule that any runtime can implement with a per-core deque and a random-number generator — and proves it pays only a constant factor on the span term. This is precisely why a Cilk `spawn`/`sync` program, or a Go program structured as fork–join, gets near-linear speedup *automatically* up to its inherent parallelism `T₁/T∞`, and why exceeding that parallelism (more cores than the program's `T₁/T∞`) yields no further gain — the `O(T∞)` term dominates. The full mechanics of deques, the LIFO-own / FIFO-steal discipline, and granularity control are developed in [`../07-fork-join-and-work-stealing/senior.md`](../07-fork-join-and-work-stealing/senior.md).

---

## More Realistic Models: BSP, LogP, MPC, Cache-Oblivious

The PRAM's two fictions are **free communication** and **unit-cost lockstep synchrony**. Every model below re-prices one or both. The senior skill is knowing which one matches your machine — and which PRAM result still survives the correction.

### BSP — Bulk-Synchronous Parallel (Valiant, 1990)

BSP structures a computation as a sequence of **supersteps**. Within a superstep each processor computes on local data and posts messages; at the superstep boundary a **barrier** synchronizes everyone and delivers all messages. The model is parameterized by `(p, g, L)` and a per-superstep `(w, h)`:

- `p` — number of processors,
- `w` — the max local computation in the superstep,
- `h` — the *h-relation*: the max number of messages any processor sends or receives in the superstep,
- `g` — communication throughput cost (time per word of an `h`-relation, i.e., network bandwidth gap),
- `L` — the barrier latency (cost of one synchronization).

A superstep costs `w + g·h + L`; a program's cost is the sum over supersteps. What BSP *captures* that the PRAM hides: it charges for the volume of communication (`g·h`) and for synchronization (`L`), so it rewards algorithms that **coarsen** — do more local work per superstep to amortize the barrier. BSP is the model behind Pregel-style graph processing and much of the HPC literature, precisely because the barrier-and-exchange rhythm matches real distributed-memory machines.

### LogP (Culler, Karp, Patterson, Sahay, Schauser, Santos, Subramonian, von Eicken, 1993)

LogP refuses BSP's barrier abstraction and models *asynchronous point-to-point* messaging with four parameters:

- **L** — latency: upper bound on time for a small message to traverse the network,
- **o** — overhead: time a processor is busy sending/receiving a message (and thus cannot compute),
- **g** — gap: minimum interval between consecutive message transmissions at a processor (the inverse of per-processor bandwidth),
- **P** — number of processors.

The distinction from BSP is philosophical: LogP exposes the *overhead* `o` (the CPU cost of communication, not just network time) and the per-message *gap* `g`, encouraging algorithms that overlap computation with communication and avoid bursty sends. BSP says "compute, exchange, barrier, repeat"; LogP says "there is no barrier — model the wire and the NIC directly." LogP is the better predictor when synchronization is *not* bulk and messages are fine-grained.

### MPC — Massively Parallel Computation (the modern MapReduce theory)

MPC is the theoretical distillation of MapReduce / Spark / dataflow systems. There are `M` machines each with `S` words of **local memory**, and `M·S = Õ(n)` (total memory roughly linear in the input, so no machine holds everything). Computation proceeds in **rounds**: in each round every machine computes locally on its `S` words, then sends/receives messages bounded by `S`, then the next round begins. The defining cost measure is the **number of rounds** as a function of the memory-per-machine `S` (typically `S = n^δ` for some `0 < δ < 1`).

The whole field is the **rounds-vs-memory tradeoff**: with more local memory `S`, problems collapse into fewer rounds; the central goal is `O(1)` or `O(log_S n)` rounds. MPC is genuinely different from the PRAM — its bottleneck is *synchronization rounds across a network*, each one expensive, so an `O(log n)`-span PRAM algorithm that would be excellent on shared memory can be a *disaster* in MPC if each parallel step becomes a round. Recovering `O(1)`-round algorithms (e.g., for connectivity, sorting) is the active research frontier, and the conjectured lower bounds here (the "1-vs-2-cycle conjecture") play the role that `P`-completeness plays for the PRAM.

### Cache-oblivious parallelism

A fourth axis is orthogonal to all of the above: the **memory hierarchy**. The cache-oblivious model (Frigo–Leiserson–Prokop) analyzes an algorithm in the ideal-cache `(M, B)` model — cache size `M`, block size `B` — *without the algorithm knowing `M` or `B`*. Combined with work–span, this yields a **two-measure** analysis: the parallel cache complexity bounds total cache misses across all processors while work–span bounds time. The headline result is that a work-stealing scheduler turns a sequential cache-miss bound `Q₁` into a parallel one of roughly `Q_P ≤ Q₁ + O(P · (M/B) · T∞)` — the extra misses are charged to *steals*, each of which can cold-start a cache. This is the model you reach for when locality, not communication volume, is the bottleneck; it composes with work-stealing rather than competing with it.

### How they compare

| Model | What it charges for | What it still idealizes | Best fit |
|---|---|---|---|
| **PRAM** | nothing but steps | communication, synchrony, locality | algorithm design, span/work lower bounds |
| **BSP `(p,g,L)`** | comm volume `g·h` + barrier `L` | per-message overhead; assumes bulk sync | distributed-memory HPC, Pregel graphs |
| **LogP** | latency `L`, overhead `o`, gap `g` | barriers (none); locality | fine-grained async message passing |
| **MPC `(M,S)`** | number of rounds vs local memory `S` | intra-round cost; assumes Õ(n) total memory | MapReduce / Spark, big-data systems |
| **Cache-oblivious `(M,B)` + work–span** | cache misses *and* time, no tuning | network communication | locality-bound shared-memory algorithms |

No single model is "correct." The PRAM is where you *design and prove*; you then port the design to whichever of BSP/LogP/MPC/cache-oblivious re-prices the cost that actually dominates on your target machine.

---

## Worked Piece: Prefix Sum Is in NC¹, and Brent Schedules It

We close by tying three threads together on the canonical primitive: prefix sum (scan) is in `NC¹`, the standard algorithm meets the EREW `Ω(log n)` lower bound exactly, and Brent's theorem schedules it efficiently — the same algorithm that work-stealing then runs in practice.

**The problem.** Given `x₀, x₁, …, x_{n-1}` and an associative operator `⊕`, compute all prefixes `yᵢ = x₀ ⊕ x₁ ⊕ … ⊕ xᵢ`.

**Membership in `NC¹`.** The Brent–Kung / Ladner–Fischer construction computes all prefixes with a circuit of depth `O(log n)` and size `O(n)`:

- **Up-sweep (reduce).** Build a balanced binary tree over the inputs; each internal node holds the `⊕` of its subtree. The tree has depth `⌈log₂ n⌉`, and each level is a set of *independent* combines — perfectly parallel. Total combines: `n − 1`.
- **Down-sweep (distribute).** Walk the tree top-down, pushing the "sum of everything to my left" into each node, again one independent operation per node per level.

Depth is `2⌈log₂ n⌉ = O(log n)`, gates have fan-in 2, size is `O(n)` — so prefix sum sits squarely in `NC¹`. In work–span terms: `T₁ = O(n)`, `T∞ = O(log n)`, parallelism `T₁/T∞ = O(n/log n)`.

**The lower bound is matched.** Prefix sum's last output `y_{n-1}` is the `⊕` of *all* `n` inputs — it depends on every input, exactly the all-sensitive condition of the Cook–Dwork–Reischuk theorem. On an EREW/CREW PRAM that forces `Ω(log n)` span. The `O(log n)`-depth tree is therefore **span-optimal**, not merely good — there is no cleverer EREW algorithm. (This is the senior reason scan is *the* building block: it is the cheapest non-trivial dependency the model allows.)

**Brent schedules it.** The work–span algorithm has `T₁ = O(n)`, `T∞ = O(log n)`. Brent's theorem gives, for any `P`:

```text
   T_P ≤ T₁/P + T∞ = O(n/P + log n).
```

Read the two regimes:

- **`P ≤ n/log n`** (processors below the parallelism): the `n/P` term dominates, giving `T_P = Θ(n/P)` — **linear, perfect speedup**. With `P = n/log n` processors you hit `T_P = O(log n)` using *optimal* `O(n)` total work. This is the "work-efficient" sweet spot.
- **`P > n/log n`** (more processors than parallelism): the `log n` span term dominates; extra processors sit idle. Throwing `n` processors at it still yields only `O(log n)` time — you have saturated the parallelism `T₁/T∞`.

**And work-stealing realizes it.** Express the up-sweep and down-sweep as fork–join recursion and the Blumofe–Leiserson bound gives `E[T_P] ≤ T₁/P + O(T∞) = O(n/P + log n)` on a *real* `P`-core machine with a decentralized scheduler — the same asymptotics as Brent, now achieved without a clairvoyant scheduler and with `O(P·log n)` expected steals. The chain is complete: `NC¹` says prefix sum is efficiently parallelizable, the PRAM lower bound says `O(log n)` span is the best possible, Brent says the work–span pair schedules to `O(n/P + log n)`, and work-stealing delivers that bound in production. The full algorithm, work-efficiency analysis, and applications appear in [`../02-parallel-prefix-sum-scan/senior.md`](../02-parallel-prefix-sum-scan/senior.md).

---

## Decision Framework

When you confront a new problem and want to know *whether and how* to parallelize it:

1. **Classify feasibility first.** Is the problem (or a close variant) known to be in `NC`, or is it `P`-complete? If `P`-complete (CVP, exact LP, lexicographic DFS, max-flow value), stop expecting polylog span — reformulate, approximate, or parallelize only inner work. If in `NC`, a low-span algorithm exists; go find it.
2. **Design in work–span.** Express the algorithm as a fork–join dag; compute `T₁` (work) and `T∞` (span). Insist on **work-efficiency** (`T₁` within a constant of the best sequential algorithm) — a low-span but work-*inflated* algorithm loses on real `P`.
3. **Check the span against the lower bound.** If the output depends on all `n` inputs, `Ω(log n)` span is forced on EREW/CREW — don't chase `O(1)`. Reserve constant-span ambitions for OR-like (one-witness) problems on CRCW.
4. **Compute parallelism `T₁/T∞`.** This is the number of processors past which speedup stops (Brent / work-stealing). If it is `O(n/log n)` you scale to nearly any core count; if it is `O(1)` the problem is essentially serial regardless of `NC` status.
5. **Re-price for the real machine.** Shared-memory multicore → trust work–span + work-stealing, add cache-oblivious analysis if locality-bound. Distributed memory → BSP (coarsen to amortize the barrier `L`) or LogP (overlap compute and comm). Big-data cluster → MPC (minimize *rounds* given memory-per-machine `S`).
6. **Implement on a work-stealing runtime.** Cilk, TBB, or Go fork–join give the `T₁/P + O(T∞)` guarantee for free; tune granularity so per-task work dwarfs steal overhead.

---

## Research Pointers

- **Brent, R. P. (1974).** "The parallel evaluation of general arithmetic expressions." The scheduling principle `T_P ≤ T₁/P + T∞`.
- **Ladner, R. E. (1975).** "The circuit value problem is log space complete for P." The founding `P`-completeness result.
- **Cook, S., Dwork, C., Reischuk, R. (1986).** "Upper and lower time bounds for parallel random access machines without simultaneous writes." The `Ω(log n)` CREW lower bound.
- **Beame, P., Håstad, J. (1989).** "Optimal bounds for decision problems on the CRCW PRAM." The `Θ(log n / log log n)` parity bound.
- **Valiant, L. G. (1990).** "A bridging model for parallel computation." BSP and the `(p, g, L)` cost model.
- **Culler, D., Karp, R., Patterson, D., Sahay, A., Schauser, K. E., Santos, E., Subramonian, R., von Eicken, T. (1993).** "LogP: Towards a realistic model of parallel computation."
- **Blumofe, R. D., Leiserson, C. E. (1999).** "Scheduling multithreaded computations by work stealing." The `T₁/P + O(T∞)` distributed-scheduler theorem; foundation of Cilk.
- **Frigo, M., Leiserson, C. E., Prokop, H., Ramachandran, S. (1999).** "Cache-oblivious algorithms." The `(M, B)` ideal-cache model that composes with work–span.
- **Karloff, H., Suri, S., Vassilvitskii, S. (2010).** "A model of computation for MapReduce." The MPC rounds-vs-memory framework.
- **Greenlaw, R., Hoover, H. J., Ruzzo, W. L. (1995).** *Limits to Parallel Computation: P-Completeness Theory.* The standard reference catalogue.
- **JáJá, J. (1992).** *An Introduction to Parallel Algorithms.* PRAM algorithms, `NC`, and work–span in one text.

---

## Key Takeaways

- **`NC` = polylog span + poly work = "efficiently parallelizable."** Equivalently, polylog-depth poly-size circuits (depth ≡ span, size ≈ work). `NC ⊆ P` is easy; `NC =? P` is open and conjectured strict — some problems are intrinsically sequential.
- **The `NC` hierarchy and `AC^k` interleave:** `NC^k ⊆ AC^k ⊆ NC^{k+1}`, so unbounded fan-in saves at most one log of depth; prefix sum and parity are in `NC¹`, reachability and matrix inverse in `NC²`. The unconditional `PARITY ∉ AC⁰` is the first real separation.
- **`P`-completeness is the parallel analogue of `NP`-completeness.** Via *log-space* reductions: CVP, exact LP, lexicographic DFS, max-flow value. If any is in `NC` then `NC = P`. Practitioner's rule: a `P`-complete problem will not parallelize well — reformulate, approximate, or parallelize only inner work. (Reachability is `NC²`; lexicographic DFS is `P`-complete — the *order* is the bottleneck.)
- **PRAM lower bounds force span and separate the variants.** OR/parity need `Ω(log n)` on EREW/CREW (Cook–Dwork–Reischuk, via the knowledge-set-doubling argument). CRCW does OR in `O(1)` but still needs `Ω(log n / log log n)` for parity (Beame–Håstad) — the PRAM shadow of `PARITY ∉ AC⁰`.
- **Work-stealing makes the model honest.** Blumofe–Leiserson: a fork–join computation runs in `E[T_P] ≤ T₁/P + O(T∞)` with `O(P·S₁)` space and `O(P·T∞)` expected steals. This is why Cilk/TBB/Go deliver the Brent bound with a decentralized scheduler.
- **PRAM ignores communication; correct for it.** BSP charges comm volume `g·h` + barrier `L`; LogP charges latency/overhead/gap; MPC charges *rounds* against local memory `S`; cache-oblivious analysis charges misses in the `(M, B)` model alongside work–span. Design in PRAM, deploy in whichever model prices your real bottleneck.
