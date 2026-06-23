# Fork-Join and Work-Stealing — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — the fork–join dag, the per-processor work-stealing **deque** (own end vs thief end), the LIFO-own / FIFO-steal discipline, the headline Blumofe–Leiserson bound `E[T_P] ≤ T₁/P + O(T∞)`, and **grain size** / granularity control
- [Models of Parallel Computation: PRAM and Work–Span — Senior](../01-models-pram-work-span/senior.md) — `T₁` (work), `T∞` (span), Brent's `T_P ≤ T₁/P + T∞`, parallelism `T₁/T∞`, and the idealized *greedy* schedule that work-stealing realizes in a decentralized way
- [Parallel Reduce and Map — Senior](../04-parallel-reduce-and-map/senior.md) — the canonical fork–join recursion (balanced divide-and-conquer) whose `O(n)`-work / `O(log n)`-span profile work-stealing schedules to `O(n/P + log n)`

## Table of Contents

1. [What Senior-Level Work-Stealing Theory Is About](#what-senior-level-work-stealing-theory-is-about)
2. [The Blumofe–Leiserson Analysis: Three Guarantees](#the-blumofeleiserson-analysis-three-guarantees)
3. [The Potential-Function Proof of the Steal Bound](#the-potential-function-proof-of-the-steal-bound)
4. [The Space Bound: Busy-Leaves and Why Continuation-Stealing Matters](#the-space-bound-busy-leaves-and-why-continuation-stealing-matters)
5. [Child-First (Work-First) vs Help-First](#child-first-work-first-vs-help-first)
6. [The Chase–Lev Lock-Free Deque](#the-chaselev-lock-free-deque)
7. [Relation to the Work–Span Model: Decentralized Greedy Scheduling](#relation-to-the-workspan-model-decentralized-greedy-scheduling)
8. [Extensions: Feedback, Contention, Locality, Steal-Half](#extensions-feedback-contention-locality-steal-half)
9. [Worked Piece: The Chase–Lev Protocol, Line by Line](#worked-piece-the-chaselev-protocol-line-by-line)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Work-Stealing Theory Is About

The middle level establishes the *mechanism*: a fork–join program is a dag, each worker owns a deque of ready frames, the owner pushes and pops at the **bottom** (its private end, used like a call stack), and an idle thief steals from the **top** (the oldest, nearest-the-root end) of a random victim's deque. The slogan results are the time bound `E[T_P] ≤ T₁/P + O(T∞)` and the rule of thumb "make tasks coarse enough that the per-spawn overhead is amortized." That is the "here is the data structure and the discipline" level.

Senior-level theory makes three sharper claims, and they are the ones that justify *why* work-stealing is the scheduler underneath Cilk, Intel TBB, Java's `ForkJoinPool`, Rust's Rayon, and the Go runtime:

1. **The bound is a theorem with a proof you should understand, not a slogan.** Blumofe and Leiserson (1999) prove *three* simultaneous guarantees — time `E[T_P] ≤ T₁/P + O(T∞)`, **space** `S_P ≤ P·S₁`, and **steals** `O(P·T∞)` expected — and the engine of all three is a single **potential-function** argument over the unexecuted dag. Knowing the argument's shape tells you exactly *which structural property of the program* (its span `T∞`, its serial stack depth `S₁`) controls each cost, and therefore what to optimize.
2. **The space bound is not free — it is bought by a scheduling *policy* choice.** The `P·S₁` space guarantee holds for **continuation-stealing** (a.k.a. work-first / child-first execution, the Cilk discipline) and the **busy-leaves** property it maintains. Naïve **child-stealing** (help-first) can blow the space up unboundedly because it lets a single worker spawn an arbitrary number of *live* children before any executes. The policy is the difference between a provable space bound and a heap explosion.
3. **The bound only holds *in practice* if the deque is lock-free.** The Arora–Blumofe–Plaxton (1998) *non-blocking* work-stealing analysis and the Chase–Lev (2005) deque exist because a lock-based deque reintroduces the very contention the theory assumes away — a thief blocking on a victim's lock can serialize steals and destroy the `O(P·T∞)` bound. The Chase–Lev deque, and its later memory-model formalization (Lê–Pop–Cohen–Nardelli, 2013), is what makes the constant in `O(T∞)` small enough to matter on a real machine.

The unifying senior stance: **work-stealing is the constructive, decentralized, randomized realization of the work–span greedy-scheduling bound — the potential-function proof shows it pays only a constant factor on the span term, continuation-stealing is what keeps the space bounded, and the lock-free deque is what keeps the constants real.** Each section below develops one of these and ties it back to the work–span theory of [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md).

---

## The Blumofe–Leiserson Analysis: Three Guarantees

The 1999 paper analyzes a **fully strict** (fork–join) multithreaded computation — every join edge goes from a child back to its *parent*, so the dag is series-parallel — scheduled by the randomized work-stealing algorithm. The three theorems are best stated together because the same potential argument produces all of them.

> **Theorem (Blumofe–Leiserson, 1999).** For a fully strict computation with work `T₁` and span (critical-path length) `T∞`, executed by randomized work-stealing on `P` processors:
> - **Time.** `E[T_P] ≤ T₁/P + O(T∞)`, and with high probability `T_P = T₁/P + O(T∞ + log(1/ε))`.
> - **Space.** `S_P ≤ P·S₁`, where `S₁` is the stack space of the *serial* (depth-first, one-processor) execution.
> - **Steals (and communication).** The expected number of steal *attempts* is `O(P·T∞)`, and in the extended model the total communication is `O(P·T∞·(1 + n_d)·S_max)` where `n_d` bounds joins and `S_max` the largest frame.

Read each guarantee for what it tells the engineer:

- **Time `T₁/P + O(T∞)`.** This is Brent's idealized greedy bound (`T₁/P + T∞`) with a constant on the span term — but achieved *online, without a central scheduler*. The `T₁/P` term is the unavoidable work, perfectly divided among `P` cores; the `O(T∞)` term is the price of decentralization and is small whenever the program has ample parallelism `T₁/T∞ ≫ P`. **Linear speedup holds as long as `P = O(T₁/T∞)`** — past the program's parallelism, the span term dominates and extra cores idle.
- **Space `P·S₁`.** Each of the `P` workers runs, at any instant, a depth-first execution of *some* subtree, so its live stack is no deeper than the serial stack `S₁`. The total is therefore at most `P·S₁` — a *linear-in-P* blow-up over the serial program, never the exponential blow-up an undisciplined fork–join scheduler can suffer. This is the **busy-leaves** guarantee (§4), and it is the strongest practical reason to prefer continuation-stealing.
- **Steals `O(P·T∞)`.** Steals are the *only* source of overhead beyond the work itself: each steal attempt costs a random victim selection, a CAS on the victim's deque, and (on success) a cache-cold task migration. Bounding attempts by `O(P·T∞)` says that on a high-parallelism program steals are *rare* (the `T₁/P` work term dwarfs the `O(T∞)` idle term), which is exactly why work-stealing has near-zero overhead in the common no-steal case and degrades gracefully — not catastrophically — only when parallelism runs out.

The three are not independent claims bolted together; they fall out of one accounting, developed next.

---

## The Potential-Function Proof of the Steal Bound

The heart of the analysis is a **potential function** on the *unexecuted* portion of the dag. The goal is to show that a round of `P` steal attempts reduces the potential by a constant factor *in expectation*, so after `O(T∞)` such rounds the potential is exhausted — yielding both the `O(P·T∞)` steal count and the `O(T∞)` idle-time term. The full proof is delicate; the *structure* below is what a senior should be able to reconstruct.

### The setup: weight by distance-to-completion

At any step of the execution, a node of the dag is **ready** if all its dag-predecessors have executed but it has not. Assign each ready node `u` a **weight**

```text
   w(u) = T∞ − depth(u),
```

where `depth(u)` is the length of the longest path from the root to `u` already executed — equivalently, `w(u)` measures how far `u` still is from the critical-path frontier (larger weight = nearer the root, more "potential energy" to release). Now define the **potential** of node `u` to be *exponential* in its weight,

```text
   φ(u) = 3^{2·w(u) − 1}   if u is "assigned" to a processor's deque but not executing,
   φ(u) = 3^{2·w(u)}       if u is currently executing on some processor,
```

and the total potential `Φ` as the sum of `φ(u)` over all ready nodes. The exponential base (here `3`) is the technical device that makes "the topmost node carries a constant fraction of the deque's potential" true — the node nearest the root in any deque dominates the geometric sum below it.

### The key structural lemma: the top of the deque holds most of the potential

Because depths *increase* down a deque (the bottom holds the most-recently-spawned, deepest frames; the top holds the oldest, shallowest, nearest-the-root frame), and because `φ` is exponential in `−depth`, the **top node of any deque carries a constant fraction (≥ a fixed constant times) of that deque's entire potential.** This is the linchpin: a thief that successfully steals the *top* of a deque removes a constant fraction of that deque's potential in one shot. (This is also *why* thieves steal from the top — the oldest frame is both the largest unexecuted subtree *and* the one nearest the critical path, so stealing it makes the most progress toward consuming the span.)

### The balls-in-bins / steal-attempt argument

Now consider a **round** of `P` steal attempts (a phase in which every idle processor makes one random steal attempt). Each non-empty deque is a "bin"; each steal attempt is a "ball" thrown uniformly at a random processor. A standard balls-into-bins fact: if there are at least `P` balls thrown at `P` bins uniformly, then with constant probability each *particular* non-empty bin receives at least one ball. So in expectation, a constant fraction of the non-empty deques are hit by *some* thief during the round, and each hit removes a constant fraction (by the lemma) of that deque's potential.

Combining: **each round of `P` steal attempts reduces the total potential `Φ` by at least a constant factor in expectation.** Since the initial potential is `Φ₀ = 3^{2T∞ − 1}` and the potential is a positive integer that must reach `0`, the number of rounds is `O(log_{base} Φ₀) = O(T∞)`. Each round is `P` steal attempts, so:

```text
   expected total steal attempts  =  O(P · T∞).
```

### From steals to the time bound

The time bound follows by a token/accounting argument. Charge every processor-step to one of two buckets:

- **Work tokens.** A processor is executing a dag node. Summed over all processors and all steps, these total exactly `T₁` (every node is executed once), contributing `T₁/P` to the wall-clock time when divided among `P` processors.
- **Steal (idle) tokens.** A processor is attempting a steal. By the potential argument these total `O(P·T∞)` in expectation, contributing `O(T∞)` when divided among `P` processors.

Every processor-step is one or the other, so

```text
   E[T_P]  ≤  (T₁ + O(P·T∞)) / P  =  T₁/P + O(T∞).
```

The high-probability version replaces "constant factor in expectation per round" with a Chernoff/tail bound over `Θ(T∞ + log(1/ε))` rounds, giving `T_P = T₁/P + O(T∞ + log(1/ε))` with probability `≥ 1 − ε`. The Arora–Blumofe–Plaxton (1998) refinement re-derives the same `O(P·T∞)` steal bound for the **non-blocking** deque (where steals never block the owner), which is the version that actually matches a Chase–Lev implementation.

> **Why the exponential potential?** A *linear* weight would let a deep deque hide its progress: many small contributions, no single dominant node. The exponential base forces the top node to dominate, so a single successful steal demonstrably consumes a constant fraction — the property the balls-in-bins round needs. The base (3) and the `2w−1` / `2w` split are tuned so that *both* executing a node *and* stealing it provably decrease `Φ`; the exact constants are bookkeeping, but the *exponential-in-depth* shape is the load-bearing idea.

---

## The Space Bound: Busy-Leaves and Why Continuation-Stealing Matters

The `S_P ≤ P·S₁` space guarantee is the one most often misquoted as automatic. It is *not*; it is a consequence of the **busy-leaves property**, which in turn depends on the **continuation-stealing** execution order. Getting this wrong turns a linear space bound into an unbounded one.

### The busy-leaves invariant

Model the live computation as an **activation tree** whose leaves are the currently-executing frames. The **busy-leaves property** states:

> At every step, every *leaf* of the activation tree (every "live" frame with no live children) has a processor working on it.

If this holds, then the number of leaves is at most `P` (one per processor), and — because each path from root to leaf is a chain of nested frames no deeper than the serial recursion depth — the total live stack space is at most `P · S₁`. The serial execution `S₁` bounds each branch; `P` busy leaves bound the number of branches. That is the whole space argument.

### Continuation-stealing maintains busy-leaves; child-stealing does not

The two scheduling policies differ in *what a worker does at a `spawn`* and *what a thief takes*:

- **Continuation-stealing (work-first / child-first, the Cilk discipline).** At `spawn child`, the worker **immediately executes the child** (depth-first, exactly as the serial program would) and leaves the *continuation* (the parent's "what to do after the spawn") on its deque for a thief to steal. The worker is therefore always at a *leaf* of the activation tree, doing real work — busy-leaves holds by construction. A steal grabs a continuation, i.e. an unexecuted *sibling subtree* near the root.
- **Child-stealing (help-first).** At `spawn child`, the worker **pushes the child** onto its deque and *continues running the parent*, possibly spawning many more children before any child runs. Now a single worker can create an unbounded number of *live, unexecuted* children before executing any — the activation tree has many non-busy leaves, and the live frames pile up. Space is no longer bounded by `P·S₁`; a loop that spawns `n` tasks materializes `O(n)` live frames at once.

The consequence is sharp: **continuation-stealing gives the provable `P·S₁` bound because the busy worker always descends to a leaf first (serial order on the no-steal path), so only continuations — bounded by the steal count — ever wait.** Child-stealing trades that space guarantee for a different steal/locality profile (see §5). Cilk, and the original Blumofe–Leiserson space theorem, are continuation-stealing precisely to keep the `P·S₁` guarantee.

> **The space bound *is* the busy-leaves bound.** `S_P ≤ P·S₁` is not a separate fact from the scheduling discipline — it is the busy-leaves invariant counted. Break busy-leaves (by switching to undisciplined child-stealing without a throttle) and you break the space bound. Production help-first schedulers (e.g. Java's `ForkJoinPool` in some modes) reintroduce a bound by *throttling* — capping the number of queued tasks or by having the parent also help drain — but that is a deliberate engineering patch over the fact that help-first does not get the space bound for free.

---

## Child-First (Work-First) vs Help-First

The policy choice from §4 deserves its own treatment because it is the central tuning knob of a work-stealing runtime, and the right answer depends on the **work-first principle**.

### The work-first principle (Frigo–Leiserson–Randall, Cilk-5, 1998)

> **The work-first principle.** *Minimize the scheduling overhead borne on the critical path of the **work** (the common, no-steal execution), at the expense of a larger overhead on the **steal** path (the rare case).*

The justification is the time bound itself. `E[T_P] ≤ T₁/P + O(T∞)`: overhead added to the **work** term `T₁` is multiplied across *every* spawn and is paid `P`-fold; overhead added to the **steal** term `T∞` is paid only `O(P·T∞)` times total — rare on a high-parallelism program. So a runtime should make the *spawn* path (executed `T₁` times) as cheap as possible and shove complexity onto the *steal* path (executed `O(P·T∞)` times). Cilk-5's famous realization is the **two-clone strategy**: compile each spawning function into a *fast clone* (the no-steal path, an almost-ordinary function call with a few extra stores) and a *slow clone* (invoked only when the continuation is stolen and must be resumed in a different worker), so the common case runs at near-serial speed.

### How the policies map onto the principle

- **Child-first / continuation-stealing** *is* the work-first realization: the worker dives into the child like a serial call (cheap, no heap allocation for the child frame in the no-steal case), and only the continuation — which a thief takes rarely — needs the expensive cross-worker machinery. This is why Cilk, TBB, and Rayon default to it: cheapest common path *and* the `P·S₁` space bound.
- **Help-first / child-stealing** front-loads work onto the deque. It can be better when the spawned children are *long-running and few* (you want them visible for stealing immediately rather than after the parent finishes its own descent) or in systems where a worker should not commit to deep recursion before exposing parallelism — e.g. some I/O-bound or async runtimes, and Java's `ForkJoinPool`, which is help-first by default and relies on `join`-time helping plus queue limits to stay bounded.

The trade, in one line: **child-first optimizes the no-steal path and bounds space (the work-first choice); help-first exposes parallelism eagerly but must throttle to bound space and pays more on the common path.** For the divide-and-conquer recursions of [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) — deep, balanced, ample parallelism — child-first is almost always correct.

---

## The Chase–Lev Lock-Free Deque

The theory assumes a deque on which the owner's push/pop and a thief's steal can proceed *concurrently without locks*. If steals took a lock on the victim's deque, a popular victim would serialize its thieves and the owner could block behind a thief — reintroducing the contention the `O(P·T∞)` bound assumes away. The **Chase–Lev deque** (2005) is the array-based, lock-free design that the modern runtimes (TBB, Rayon's crossbeam-deque, Go's run-queue, many JVM implementations) descend from.

### The structure

A growable circular array `buffer` plus two indices:

- `bottom` — the **owner's** end. Only the owner reads/writes it; `push` and `pop` happen here. Used LIFO, like a call stack.
- `top` — the **thieves'** end. Multiple thieves contend here; the winner advances `top` with a **CAS**. Used FIFO (oldest task stolen first).

The invariant is `top ≤ bottom`; the number of elements is `bottom − top`. The owner operates on `bottom` with (mostly) plain loads/stores; thieves and the owner coordinate *only* through the single `top` CAS, which is the entire synchronization budget on the steal path.

### The three operations and where the races live

- **`push` (owner, bottom).** Store the element at `buffer[bottom]`, then publish by incrementing `bottom`. The store-then-publish order (with a release fence) ensures a thief that observes the new `bottom` also observes the element. May trigger a **resize** if the array is full.
- **`steal` (thief, top).** Read `top`, read `bottom`; if `top ≥ bottom` the deque is empty, abort. Otherwise read `buffer[top]`, then attempt `CAS(top, top, top+1)`. If the CAS succeeds, the thief won the element; if it fails, another thief (or the owner, on the last element) raced and the steal retries or aborts. The read of the element happens *before* the CAS, so a successful CAS certifies the read was valid.
- **`pop` (owner, bottom).** Decrement `bottom`, then read `top`. The subtle case is the **last element**: when `bottom − top` falls to exactly one, the owner's `pop` and a thief's `steal` both want that single element. The owner resolves it by *also* doing a `CAS(top, ...)` — competing with thieves on `top` for the last item. If the owner wins the CAS it keeps the element; if it loses, the element went to a thief and `pop` returns empty. After the contested case, the owner resets `bottom = top` to restore the empty invariant.

### ABA-freedom and the resize

The design is **ABA-free** by construction on `top`: `top` is *monotonically increasing* (it only ever advances via CAS, never decreases on the steal path), so the classic ABA hazard — a value cycling back to a previous bit-pattern between a thief's read and its CAS — cannot fool the CAS, because `top` never returns to an old value. (Many lock-free stacks need tagged pointers or hazard pointers to dodge ABA; the Chase–Lev deque sidesteps it with the monotone counter.) The **resize** is the one genuinely tricky write: when `push` finds the array full it allocates a larger buffer, copies the live `[top, bottom)` range, and atomically swaps the buffer pointer. Old buffers cannot be freed immediately because an in-flight thief may still be reading the old array; real implementations defer reclamation (epoch-based reclamation, hazard pointers, or — as in the original — simply never shrinking and leaking the old arrays, acceptable because resizes are rare).

### The memory-model subtleties (Lê–Pop–Cohen–Nardelli, 2013)

The original 2005 paper was written for sequential consistency. On a weak memory model (ARM, POWER, and the C/C++11 model), the bare loads and stores are *insufficient* — without fences, a thief can observe a stale `bottom`, or the owner's element store can be reordered after the `bottom` publish, breaking correctness. **Lê, Pop, Cohen, and Nardelli (2013)** gave the rigorous C11-atomics formalization and the *minimal* fence placement:

- The element store in `push` is **release**, paired with an **acquire** load of the element in `steal`, so a thief that sees the published `bottom` also sees the element.
- `pop` needs a **full (sequentially consistent) fence** between writing `bottom` and reading `top`, because the owner's decrement of `bottom` and a thief's advance of `top` must not be reordered — this is the one place a `seq_cst` fence is genuinely required, and it is on the owner's *pop*, not the hot push.
- The `top` CAS is **seq_cst** (or acquire-release with the fence) so all thieves and the owner agree on a total order of `top` advances.

The headline from the formalization: **the only expensive memory barrier on the common path is the `seq_cst` fence in `pop`'s last-element case; `push` and `steal` need only release/acquire.** This keeps the no-steal path — overwhelmingly `push`/`pop` pairs — nearly as cheap as serial stack manipulation, honoring the work-first principle at the hardware level.

> **Why lock-free is load-bearing for the bound.** With a lock per deque, a thief blocks behind whoever holds it, and a contended victim serializes its thieves — turning `O(P·T∞)` *independent* steal attempts into a queue. The non-blocking design (Arora–Blumofe–Plaxton; Chase–Lev) guarantees that the *owner never blocks* (its push/pop are wait-free in the common case) and that steal attempts only ever *fail-and-retry*, never *block* — which is precisely the model the `O(P·T∞)` analysis assumes. The lock-free deque is not an optimization on top of the theory; it is what makes the theory's contention model true.

---

## Relation to the Work–Span Model: Decentralized Greedy Scheduling

Work-stealing is best understood as the *constructive answer* to a question the work–span model poses abstractly. The model (see [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md)) says: a fork–join dag has work `T₁` and span `T∞`, and Brent's theorem promises *some* schedule achieves `T_P ≤ T₁/P + T∞`. Brent's schedule is a **greedy** one — at every step, if `≥ P` nodes are ready, execute any `P` of them; otherwise execute all ready nodes — and it is *clairvoyant* and *centralized*: it presumes a god's-eye view of the whole ready set at every step.

> **The greedy-scheduling theorem.** Any greedy schedule of a dag with work `T₁` and span `T∞` on `P` processors finishes in `T_P ≤ T₁/P + T∞`. (Graham 1966 / Brent 1974.) The proof partitions steps into *complete* steps — `≥ P` ready nodes, all `P` processors busy, at most `T₁/P` of these — and *incomplete* steps — `< P` ready nodes, each of which advances the critical path, so at most `T∞` of these.

Work-stealing reproduces this bound **without the centralization or clairvoyance**:

| Property | Centralized greedy (Brent) | Randomized work-stealing |
|---|---|---|
| Ready set | global, maintained centrally | sharded across `P` per-worker deques |
| Decision | clairvoyant, picks `P` ready nodes | local: run your own deque; if empty, steal a *random* victim's top |
| Coordination | global synchronization each step | only per-deque CAS on the contended `top` |
| Contention | the central ready-queue is a bottleneck | randomized victims spread the load; `O(P·T∞)` attempts total |
| Bound | `T₁/P + T∞` (exact) | `T₁/P + O(T∞)` (expected; constant on span) |
| Space | unconstrained | `P·S₁` via busy-leaves |

The correspondence is exact in spirit: a **complete step** of greedy maps to a step where most workers are doing *work tokens* (their deques are non-empty); an **incomplete step** maps to a *steal round* where idle workers are consuming the critical path. The potential argument of §3 is exactly the randomized, decentralized re-proof of greedy's "incomplete steps ≤ T∞" — the `O(T∞)` steal rounds *are* the incomplete steps, now counted probabilistically because no central scheduler hands out the ready nodes.

The senior payoff: **the work–span pair `(T₁, T∞)` you compute at design time is not an idealization that a real scheduler approximates loosely — work-stealing delivers it to within a constant on the span term, decentralized, with bounded space and low contention.** This is why you analyze a parallel algorithm in work–span and then *trust* a Cilk/TBB/Rayon/Go implementation to realize it: the abstraction is operationally honest because of this theorem.

---

## Extensions: Feedback, Contention, Locality, Steal-Half

The 1999 analysis assumes a fixed `P`, unit-cost steals, and a flat memory. Each assumption has a research line that relaxes it; a senior should know which extension addresses which real-machine pressure.

### Parallelism feedback / adaptive scheduling

The basic scheduler assumes a *dedicated* `P`. In a shared machine where the OS reallocates processors, you want a job to *request* processors matched to its current parallelism and *yield* them when parallelism is scarce, so cores are not wasted spinning on steals. **Adaptive work-stealing with parallelism feedback** (Agrawal, He, Leiserson, and others) has the job estimate its instantaneous parallelism (e.g. from recent steal-success rates) and adjust its processor request each scheduling quantum, achieving near-optimal *time* and near-optimal *processor utilization* (waste bounded relative to `T₁`) simultaneously. The steal rate is the signal: high steal-failure rate means little parallelism, so give cores back.

### Bounds under contention

The clean `O(P·T∞)` assumes steal attempts are independent and cheap. On real hardware, many thieves hammering a few popular victims create **contention** on the `top` cache line. Refined analyses bound the *contention delay* and motivate engineering mitigations: **randomized victim selection** (the default — spreads thieves uniformly), **exponential backoff** on repeated steal failure, and **occupancy/sleep** so that idle workers in a low-parallelism phase stop spinning (and stop generating contention) and park until woken. The contention-aware bounds confirm that randomization plus backoff keeps the effective steal cost within a constant factor of the idealized model.

### Locality-aware and NUMA work-stealing

Plain random stealing is **locality-oblivious**: a stolen task arrives cache-cold, and on a NUMA machine a steal can drag a task across a socket boundary, paying remote-memory latency. Extensions add a locality bias:

- **Hierarchical / NUMA-aware stealing** steals preferentially from *nearby* victims (same socket / same last-level cache) and only crosses NUMA boundaries as a last resort, so most steals stay cache-warm.
- **Locality-guided / data-aware work-stealing** (Acar, Blelloch, Blumofe, 2000, and successors) pins or biases tasks toward the worker that holds their data, bounding the *extra* cache misses charged to steals — the parallel cache complexity `Q_P ≤ Q₁ + O(P·(M/B)·T∞)` of the cache-oblivious analysis (see [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md)) is exactly the statement that each steal can cold-start one cache, so *fewer/closer steals = fewer misses*.

### Steal-half and other steal policies

The default steals *one* task. **Steal-half** takes *half* the victim's deque in one operation. The trade: stealing half reduces the *number* of steals (fewer round-trips, fewer CAS operations) and reseeds an idle worker with enough work to stay busy longer — valuable when parallelism comes in bursts — but it complicates the deque (you can no longer treat the top as a single CAS-advance) and can hurt locality by scattering a victim's contiguous subtree. Steal-half and **steal-k** are used in some runtimes for irregular, bursty workloads; the canonical single-steal is preferred when the potential-bound's clean `O(P·T∞)` and the simple Chase–Lev `top` CAS are wanted.

> **The unifying view of the extensions.** Each relaxes one idealization of the 1999 model — fixed `P` (→ feedback), free steals (→ contention bounds + backoff), flat memory (→ NUMA/locality stealing), one-at-a-time (→ steal-half) — *without* abandoning the core: a per-worker lock-free deque, randomized victims, continuation-stealing for space. The constant in `O(T∞)` and the constant in `P·S₁` are what these refinements tighten; the asymptotic guarantees of §2 survive them.

---

## Worked Piece: The Chase–Lev Protocol, Line by Line

We make the deque concrete — the operation set, the races, the fences, and the last-element resolution — because the protocol *is* the bridge from the potential-function theory to a real runtime. (Pseudocode in C11-atomics style; `relaxed`/`acquire`/`release`/`seq_cst` mark the memory orders the Lê et al. formalization requires.)

### State

```text
   struct Deque {
       atomic<int64>   top;      // thieves' end; only ever increases
       atomic<int64>   bottom;   // owner's end
       atomic<Array*>  array;    // growable circular buffer of atomic<Task*>
   }
   // invariant:  top ≤ bottom ;  size = bottom − top
```

### `push` — owner only, bottom end

```text
   push(d, task):
       b = d.bottom.load(relaxed)            // owner-private; no contention
       t = d.top.load(acquire)
       a = d.array.load(relaxed)
       if b − t  >  a.capacity − 1:          // full → grow
           a = grow(d, a, b, t)              // copy live [t,b) into a bigger buffer, publish
       a.put(b, task, relaxed)               // store the element
       atomic_thread_fence(release)          // publish element BEFORE bottom
       d.bottom.store(b + 1, relaxed)        // a thief seeing b+1 now also sees the element
```

The **release fence** is the whole correctness argument for `push`: it orders the element store before the `bottom` publish, so the acquire-load of the element in `steal` cannot see a stale slot. This is the only synchronization `push` pays — otherwise it is a plain array store and an integer increment, i.e. essentially a serial stack push (the work-first principle, honored).

### `steal` — any thief, top end

```text
   steal(d):
       t = d.top.load(acquire)
       atomic_thread_fence(seq_cst)          // order top-load before bottom-load
       b = d.bottom.load(acquire)
       if t  ≥  b:  return EMPTY              // deque empty (or lost the race)
       a = d.array.load(consume)
       task = a.get(t, acquire)              // read element BEFORE claiming it
       if not d.top.compare_exchange(t, t+1, seq_cst, relaxed):
           return ABORT                      // another thief/owner won; caller retries
       return task                           // CAS success ⟹ our read of task is valid
```

The thief reads the element *before* the CAS and only keeps it if the CAS on `top` succeeds. Because `top` is **monotone**, a stale `t` simply makes the CAS fail (no ABA: `top` never returns to an old value), and the thief retries with a fresh `top`. Multiple thieves on the same victim all race the same CAS; exactly one wins, the rest `ABORT` — *fail-and-retry, never block*, which is the property the `O(P·T∞)` analysis needs.

### `pop` — owner only, but contends on the last element

```text
   pop(d):
       b = d.bottom.load(relaxed) − 1
       a = d.array.load(relaxed)
       d.bottom.store(b, relaxed)            // tentatively claim
       atomic_thread_fence(seq_cst)          // ← the one mandatory full fence
       t = d.top.load(relaxed)
       if t  >  b:                           // deque was empty
           d.bottom.store(b + 1, relaxed)    // restore
           return EMPTY
       task = a.get(b, relaxed)
       if t  <  b:  return task              // ≥ 2 elements: no thief can contend, done
       // t == b : exactly ONE element — race a thief for it
       if not d.top.compare_exchange(t, t+1, seq_cst, relaxed):
           task = EMPTY                       // a thief took the last one
       d.bottom.store(b + 1, relaxed)        // reset to empty (top advanced either way)
       return task
```

The three cases of `pop` are the crux:

1. **`t < b` (≥ 2 elements).** No thief can possibly want the *bottom* element (thieves only take `top`), so the owner pops with a plain load — the fast, contention-free common case.
2. **`t > b` (empty).** A thief already took everything; restore `bottom` and report empty.
3. **`t == b` (exactly one element).** Owner and a thief both target the single item. The owner enters the **same `top` CAS the thieves use** — whoever wins the CAS gets the element. This is why `pop` needs the full `seq_cst` fence: the owner's `bottom` decrement and the thieves' `top` advance must be globally ordered, or both could believe they won. After the contest, `bottom` is reset so `top == bottom` (empty) holds again.

### Why this realizes the theory

Trace it against §2–§3. The **no-steal common path** is `push`/`pop` with `t < b`: plain array stores, one release fence on push, one seq_cst fence on pop — near-serial cost, so the `T₁/P` work term is paid at almost serial efficiency (work-first principle). The **steal path** is the contended `top` CAS: lock-free, fail-and-retry, randomized victim — so steal attempts are the independent, non-blocking events the potential argument counts as `O(P·T∞)`. The **monotone `top`** gives ABA-freedom without tags or hazard pointers. The **owner-private `bottom`** is why busy-leaves and the `P·S₁` space bound hold under continuation-stealing: the owner runs its deque depth-first like a serial stack, exposing only continuations (the top) to thieves. Every piece of the protocol is there to make one of the three guarantees true *on real hardware* — which is the entire reason the Chase–Lev deque, not a simpler locked queue, is what production runtimes ship.

---

## Decision Framework

When you design or tune a fork–join / work-stealing workload:

1. **Confirm the program is high-parallelism.** Compute (or estimate) `T₁` and `T∞`; the speedup ceiling is the parallelism `T₁/T∞`. Work-stealing gives near-linear speedup only while `P = O(T₁/T∞)`. If parallelism is `O(1)`, no scheduler helps — restructure the algorithm (see [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md)).
2. **Use continuation-stealing (child-first) for deep divide-and-conquer.** It gives the `P·S₁` space bound via busy-leaves *and* the cheapest no-steal path (work-first principle). Reserve help-first for few-but-long tasks or async/I/O runtimes, and *throttle the queue* if you do, or space can blow up.
3. **Make the no-steal path cheap; tolerate an expensive steal path.** This is the work-first principle. Coarsen grain size so per-spawn overhead is amortized over real work (target tasks ≫ steal cost), and let the runtime's two-clone / fast-path machinery carry the common case.
4. **Trust the lock-free deque; do not hand-roll a locked one.** A locked deque serializes thieves and can block the owner, breaking the `O(P·T∞)` contention model. Use the runtime's Chase–Lev-derived deque; if you implement one, get the fences right (release on `push`'s store, seq_cst on `pop`'s last-element case, acquire on `steal`'s element read) per Lê et al.
5. **Add locality bias only when steals are cache-cold and measured to hurt.** On NUMA or cache-bound workloads, prefer near-victim / hierarchical stealing so most steals stay warm; the parallel cache bound charges extra misses to steals, so fewer/closer steals = fewer misses. Don't pre-optimize this for compute-bound, cache-friendly recursions.
6. **Pick the steal granularity for the workload shape.** Single-steal is the clean default (matches the `O(P·T∞)` bound and the simple `top` CAS). Consider steal-half only for bursty/irregular parallelism where reseeding an idle worker with more work reduces steal round-trips.
7. **For a shared machine, use a feedback/adaptive scheduler.** If `P` is not dedicated, request and yield processors based on the steal-success rate so idle cores are returned instead of spinning — near-optimal time *and* utilization simultaneously.

---

## Research Pointers

- **Graham, R. L. (1966).** "Bounds for certain multiprocessing anomalies." The greedy-scheduling `T₁/P + T∞` bound (list scheduling) that work-stealing realizes.
- **Brent, R. P. (1974).** "The parallel evaluation of general arithmetic expressions." The scheduling principle `T_P ≤ T₁/P + T∞` in the work–span form.
- **Blumofe, R. D., & Leiserson, C. E. (1999).** "Scheduling Multithreaded Computations by Work Stealing." *JACM.* The three guarantees (time `T₁/P + O(T∞)`, space `P·S₁`, steals `O(P·T∞)`), the potential-function proof, and busy-leaves. The foundational paper.
- **Frigo, M., Leiserson, C. E., & Randall, K. H. (1998).** "The Implementation of the Cilk-5 Multithreaded Language." *PLDI.* The **work-first principle** and the two-clone (fast/slow) continuation-stealing implementation.
- **Arora, N. S., Blumofe, R. D., & Plaxton, C. G. (1998/2001).** "Thread Scheduling for Multiprogrammed Multiprocessors." *SPAA / TOCS.* The **non-blocking** work-stealing deque and its `O(P·T∞)` analysis under multiprogramming.
- **Chase, D., & Lev, Y. (2005).** "Dynamic Circular Work-Stealing Deque." *SPAA.* The array-based, growable, lock-free deque with the monotone-`top` CAS — the basis of modern implementations.
- **Lê, N. M., Pop, A., Cohen, A., & Zappa Nardelli, F. (2013).** "Correct and Efficient Work-Stealing for Weak Memory Models." *PPoPP.* The rigorous C11-atomics formalization of Chase–Lev and the minimal fence placement (release on push, seq_cst fence in pop).
- **Acar, U. A., Blelloch, G. E., & Blumofe, R. D. (2000).** "The Data Locality of Work Stealing." *SPAA.* Bounds the extra cache misses charged to steals; foundation of locality-aware stealing.
- **Agrawal, K., He, Y., Hsu, W. J., & Leiserson, C. E. (2006–2008).** "Adaptive Work-Stealing with Parallelism Feedback." Near-optimal time *and* processor utilization on a shared machine via steal-rate feedback.
- **Leiserson, C. E. (2009).** "The Cilk++ Concurrency Platform." A modern restatement of the work-stealing guarantees and the reducer/hyperobject machinery built atop them.

---

## Key Takeaways

- **Blumofe–Leiserson (1999) gives three simultaneous guarantees from one potential argument:** time `E[T_P] ≤ T₁/P + O(T∞)`, space `S_P ≤ P·S₁`, and `O(P·T∞)` expected steal attempts. Linear speedup holds while `P = O(T₁/T∞)`; the `O(T∞)` term is the price of decentralization.
- **The proof is a potential function exponential in distance-to-completion.** Each ready node gets potential `≈ 3^{2(T∞ − depth)}`; the top of every deque carries a constant fraction of that deque's potential, so a balls-in-bins round of `P` steal attempts cuts total potential by a constant factor in expectation. `O(T∞)` rounds exhaust it ⟹ `O(P·T∞)` steals ⟹ `O(T∞)` idle time ⟹ the time bound.
- **The `P·S₁` space bound is the busy-leaves invariant, and it requires continuation-stealing.** Every live activation-tree leaf has a busy processor, so `≤ P` leaves × serial depth `S₁`. **Continuation-stealing (child-first, Cilk)** maintains this — the worker runs the child depth-first and exposes only continuations to thieves. Naïve **child-stealing (help-first)** breaks busy-leaves and can blow space up unless throttled.
- **The work-first principle (Frigo–Leiserson–Randall) is the design law:** minimize overhead on the common no-steal path (paid `T₁` times, `P`-fold) at the expense of the rare steal path (paid `O(P·T∞)` times). Cilk's two-clone (fast/slow) compilation is its realization; child-first is its scheduling choice.
- **The Chase–Lev deque (2005) makes the bound real.** Array-based, growable, lock-free; owner pushes/pops `bottom`, thieves CAS `top`. **ABA-free** because `top` is monotone; the **last-element race** is resolved by the owner joining the `top` CAS. The deque must be lock-free or contention destroys the `O(P·T∞)` model.
- **The memory model matters (Lê–Pop–Cohen–Nardelli, 2013):** release fence on `push`'s store, acquire on `steal`'s element read, and a single mandatory `seq_cst` fence in `pop`'s last-element case — the only expensive barrier, and it is off the hot `push` path.
- **Work-stealing is the decentralized, randomized realization of greedy scheduling.** It reproduces Brent's `T₁/P + T∞` without a central clairvoyant scheduler: per-worker sharded deques, random victims, only a `top` CAS for coordination — so the work–span pair `(T₁, T∞)` you design with is delivered to within a constant on the span term. See [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md).
- **The extensions tighten constants, not asymptotics:** parallelism feedback (shared `P`), contention bounds + backoff (real steal cost), NUMA/locality-aware stealing (cache-cold steals), and steal-half (bursty work) each relax one idealization while keeping the per-worker lock-free deque, random victims, and continuation-stealing core.

---

> **See also:** [`./middle.md`](./middle.md) for the fork–join dag, the deque mechanics, the headline bound, and grain size · [`./professional.md`](./professional.md) for the production implementation — Cilk/TBB/Rayon/`ForkJoinPool`/Go internals, granularity tuning, and reducers/hyperobjects · [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md) for work–span, Brent's theorem, and the greedy-scheduling bound work-stealing realizes · [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) for the canonical balanced fork–join recursion this scheduler runs at `O(n/P + log n)`
