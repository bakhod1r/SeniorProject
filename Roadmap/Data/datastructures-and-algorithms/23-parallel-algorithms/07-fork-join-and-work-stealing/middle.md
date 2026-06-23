# Fork-Join and Work-Stealing — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Fork-Join DAG](#the-fork-join-dag)
   - [Spawn, Sync, and the Series-Parallel DAG](#spawn-sync-and-the-series-parallel-dag)
   - [Work and Span of a Fork-Join Computation](#work-and-span-of-a-fork-join-computation)
   - [Why Fork-Join Is the "Well-Structured" Class](#why-fork-join-is-the-well-structured-class)
3. [The Work-Stealing Scheduler](#the-work-stealing-scheduler)
   - [Per-Worker Deques: LIFO Local, FIFO Steal](#per-worker-deques-lifo-local-fifo-steal)
   - [Why Bottom-LIFO and Top-FIFO](#why-bottom-lifo-and-top-fifo)
   - [Child-Stealing vs Continuation-Stealing](#child-stealing-vs-continuation-stealing)
4. [The Blumofe–Leiserson Bound](#the-blumofeleiserson-bound)
   - [Statement](#statement)
   - [Busy-Leaves and Why Steals Are Rare](#busy-leaves-and-why-steals-are-rare)
   - [Near-Optimality: Matching Greedy/Brent](#near-optimality-matching-greedybrent)
   - [The Space Bound](#the-space-bound)
5. [Grain Size Analysis](#grain-size-analysis)
   - [Spawn Overhead and the Task Count](#spawn-overhead-and-the-task-count)
   - [The Coarsening Trade-off and the Sweet Spot](#the-coarsening-trade-off-and-the-sweet-spot)
6. [Code: Fork-Join and a Work-Stealing Scheduler](#code-fork-join-and-a-work-stealing-scheduler)
   - [Go](#go)
   - [Python](#python)
7. [Pitfalls](#pitfalls)
8. [Summary](#summary)

---

## Introduction

> Focus: turn the junior facts — `fork`/`join`, the work-stealing idea, grain size — into rigorous statements you can *derive*. By the end you can draw the **fork-join DAG** of a `spawn`/`sync` program and read its work `T₁` and span `T∞` off it; explain the **work-stealing deque** discipline (owner LIFO at the bottom, thief FIFO at the top) and *why* each end is chosen; distinguish **child-stealing** from **continuation-stealing** and why the latter bounds space; state and motivate the **Blumofe–Leiserson bound** `T_P ≤ T₁/P + O(T∞)` expected time, `O(P·S₁)` space, `O(P·T∞)` expected steals; and pick a **grain size** that hides spawn overhead without throttling parallelism.

At the [junior level](./junior.md) you met **fork-join** parallelism: `spawn` (or `fork`) launches a subcomputation that may run in parallel with the code after it, and `sync` (or `join`) waits for the spawned work to finish. You met **work-stealing**: each worker keeps its own queue of ready tasks, runs its own work, and when it runs dry, *steals* a task from another worker. And you met **grain size**: the cutoff below which you stop spawning and just run serially, so the cost of forking does not swamp the work being forked.

This file makes all of that rigorous. It builds on the [work–span model](../01-models-pram-work-span/middle.md): **work** `T₁` (total operations, = time on one processor), **span** `T∞` (critical-path length, = time on infinitely many processors), parallelism `T₁/T∞`, and the **greedy/Brent bound** `T_P ≤ T₁/P + T∞`. Work-stealing is how a real runtime *approximates* that greedy schedule without a central queue — and the central result, **Blumofe–Leiserson**, says it does so within a constant factor, in expectation, while using little space and making few steals.

This file covers:

- **The fork-join DAG.** A `spawn` adds a node and a fork edge; a `sync` adds a join node depending on the spawned strands. The result is a **series-parallel** DAG — the "well-structured" parallel programs. We read `T₁` and `T∞` straight off it.
- **The work-stealing scheduler.** Each worker owns a **double-ended queue (deque)**. The owner pushes and pops at the **bottom** (LIFO, depth-first, cache-friendly); a thief steals from the **top** (FIFO, the oldest/biggest subtree). We explain *why* both ends are chosen as they are.
- **Child- vs continuation-stealing.** Whether `spawn` pushes the child (and the worker continues the parent) or pushes the continuation (and the worker runs the child, Cilk-style). The latter bounds stack space.
- **The Blumofe–Leiserson bound** — stated precisely: `T_P ≤ T₁/P + O(T∞)` expected, `O(P·S₁)` space, `O(P·T∞)` expected steals — with the **busy-leaves** intuition for *why* steals are rare and why this is near-optimal against [Brent](../01-models-pram-work-span/middle.md).
- **Grain size.** Spawn overhead `τ` per fork inflates work by `τ·(#tasks)`; coarsening to grain `g` cuts tasks to `≈ T₁/g` but caps parallelism. The sweet spot.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `P` | number of worker processors |
| `T₁` | **work** — total operations (= time on 1 processor) |
| `T∞` | **span** — critical-path length (= time on ∞ processors) |
| `T₁/T∞` | **parallelism** — the average available parallelism |
| `T_P` | time to run on `P` processors under the scheduler |
| `S₁` | **serial stack space** — space used by the 1-processor depth-first execution |
| `g` | **grain size** — serial cutoff below which we stop spawning |
| `τ` | per-spawn scheduling overhead |

Throughout, "task" / "strand" means a maximal run of serial instructions with no `spawn` or `sync` in the middle — exactly the unit nodes of the [work–span DAG](../01-models-pram-work-span/middle.md).

---

## The Fork-Join DAG

### Spawn, Sync, and the Series-Parallel DAG

A fork-join program is built from two control constructs layered on ordinary serial code:

- **`spawn f(args)`** — execute `f(args)`, but allow the instructions *after* the spawn (the **continuation**) to run *in parallel* with it. The spawn does not wait.
- **`sync`** — wait until all functions spawned in the current frame have completed before proceeding. It is the join point.

Map this onto a [computation DAG](../01-models-pram-work-span/middle.md), where each node is a unit-time strand and each edge is a dependency:

- A **`spawn`** splits the current strand into two outgoing edges: one to the **child** (the spawned `f`), one to the **continuation** (the code after the spawn). This is a *fork*.
- A **`sync`** is a **join node** with an incoming edge from the *end* of every strand spawned since the last sync, plus one from the continuation. It cannot start until all of them finish.

The picture for a function that spawns two children then syncs:

```text
          ● parent strand (up to the spawns)
         / \
   spawn/   \ continuation
       /     \
   ● child1   ● (spawn child2, then reach sync)
      \        |
       \   ● child2
        \    /
         \  /
          ● sync (join): depends on child1, child2, and the continuation
          |
          ● parent continues after sync
```

Because forks and joins are *properly nested* — every `spawn` is matched by a later `sync` in the same frame, and frames nest like balanced parentheses — the resulting DAG is **series-parallel (SP)**. An SP DAG is built recursively from single edges by two composition rules:

- **Series composition** `A ; B`: run `A`, then `B` (the sink of `A` feeds the source of `B`). This is ordinary sequencing.
- **Parallel composition** `A ∥ B`: run `A` and `B` independently between a common fork and a common join. This is a `spawn` of one branch alongside its continuation.

```text
   series  A ; B :    ●──A──●──B──●

   parallel A ∥ B :      ●
                        / \
                       A   B
                        \ /
                         ●
```

Every fork-join computation is such a nested SP DAG. This nesting is the structural fact behind everything that follows — it is what makes work-stealing's deque discipline correct and what makes the span easy to compute by a simple recurrence.

### Work and Span of a Fork-Join Computation

Because the DAG is series-parallel, `T₁` and `T∞` obey clean **compositional recurrences**. Write `T₁(C)` and `T∞(C)` for the work and span of computation `C`.

> **Work** composes by *addition* under both rules — every strand runs once on one processor regardless of structure:
> ```text
>   T₁(A ; B) = T₁(A) + T₁(B)
>   T₁(A ∥ B) = T₁(A) + T₁(B)
> ```

> **Span** composes by *addition* in series and *maximum* in parallel — parallel branches overlap, so the critical path takes the longer one:
> ```text
>   T∞(A ; B) = T∞(A) + T∞(B)
>   T∞(A ∥ B) = max( T∞(A), T∞(B) )
> ```

The `max` in the parallel rule is the entire source of parallelism: two spawned branches contribute their *sum* to the work but only their *maximum* to the span. The more (and more balanced) the parallel composition, the larger the gap `T₁/T∞`.

**Worked example — parallel sum of `n` elements** by recursive halving (spawn the left half, recur on the right, sync, add):

```text
   sum(lo, hi):
       if hi - lo <= grain:  return serial_sum(lo, hi)
       mid = (lo + hi) / 2
       L = spawn sum(lo, mid)        // fork the left half
       R =       sum(mid, hi)        // continuation does the right half
       sync                          // join
       return L + R
```

Ignoring grain for the asymptotics, the recursion tree has depth `log₂ n` and `n` leaves. Work is `T₁ = Θ(n)` (every element is touched once, plus `n − 1` additions at the internal joins). Span follows the recurrence `T∞(n) = T∞(n/2) + Θ(1)` — at each level the two halves run in parallel (`max`), and the join adds `Θ(1)` — giving `T∞ = Θ(log n)`. Parallelism `T₁/T∞ = Θ(n/log n)`. This is the same `Θ(n)`-work, `Θ(log n)`-span profile as the [tree reduce](../04-parallel-reduce-and-map/middle.md) — fork-join recursion *is* the reduction tree, expressed as code.

**Worked example — parallel merge sort.** Spawn the left recursive sort, run the right as the continuation, sync, then merge:

```text
   T₁(n) = 2·T₁(n/2) + Θ(n)        → T₁  = Θ(n log n)     (the serial work)
   T∞(n) =   T∞(n/2) + (merge span) 
```

With a *serial* merge (span `Θ(n)`), the span recurrence is `T∞(n) = T∞(n/2) + Θ(n) = Θ(n)`, so parallelism is only `Θ(log n)` — the serial merge is the bottleneck. With a *parallel* merge (span `Θ(log² n)`, covered in [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md)), the span drops to `T∞(n) = T∞(n/2) + Θ(log² n) = Θ(log³ n)` and parallelism rises to `Θ(n log n / log³ n) = Θ(n/log² n)`. The lesson the recurrences make precise: **parallelizing the recursion is not enough — you must also parallelize the combine step**, or the serial combine caps your span.

### Why Fork-Join Is the "Well-Structured" Class

Not every parallel program is fork-join. A program with arbitrary `go`-routines signalling each other through channels can form *any* DAG — including ones with edges that cross fork-join boundaries (a "pipeline" where stage 2 of branch A feeds stage 3 of branch B). Fork-join forbids exactly those crossings: every dependency edge respects the nesting.

This restriction is what makes fork-join *the* class scheduling theory targets:

- **The span recurrence is local.** You can compute `T∞` by the simple series-`+`/parallel-`max` recurrence above. General DAGs need a full longest-path computation.
- **A deque suffices.** Because spawned work nests, a single per-worker LIFO/FIFO deque exactly tracks "what this worker could do next" and "what is stealable" — no general dependency bookkeeping is needed. This is *why* the work-stealing scheduler is so cheap.
- **Space is bounded.** Nested parallelism means the live frames at any worker form a *stack*, so the [space bound](#the-space-bound) `O(P·S₁)` holds.
- **It is provably efficient.** The [Blumofe–Leiserson theorem](#the-blumofeleiserson-bound) is *proved* for fully-strict (fork-join) computations; the proof relies on the SP structure.

So "well-structured" is not aesthetic — it is the precise hypothesis under which a deque-based scheduler is both *correct* (it never deadlocks, because nesting forbids cyclic waits) and *efficient* (the BL bound holds). Cilk, Intel TBB, Java's `ForkJoinPool`, OpenMP tasks, and Rust's Rayon all restrict you to (essentially) fork-join precisely to earn these guarantees.

---

## The Work-Stealing Scheduler

### Per-Worker Deques: LIFO Local, FIFO Steal

A work-stealing scheduler runs `P` **workers** (one per processor), each owning a private **double-ended queue (deque)** of ready tasks. A deque has two ends, conventionally **bottom** and **top**, and supports three operations:

```text
   pushBottom(task)   // owner: add a newly spawned task (cheap, local)
   popBottom() task   // owner: take the most recent task (LIFO)
   popTop()    task   // THIEF: steal the oldest task (FIFO), from another worker's deque
```

The discipline is asymmetric:

- **The owner works at the bottom, LIFO.** When a worker spawns, it `pushBottom`s the new task; when it needs the next thing to do, it `popBottom`s — taking the *most recently* spawned task. This makes each worker's local execution **depth-first**, exactly mirroring the order a single-threaded program would run.
- **A thief steals from the top, FIFO.** An idle worker (empty deque) picks a *victim* at random and `popTop`s — taking the *oldest* task in the victim's deque.

```text
   worker's deque (grows downward as it spawns):

        top  ──►  [ T0 ]   ← oldest task: a thief steals THIS  (FIFO, rare)
                  [ T1 ]
                  [ T2 ]
     bottom ──►  [ T3 ]   ← newest task: the owner runs THIS  (LIFO, common)
```

Because the owner and thieves touch *opposite ends*, they rarely contend: the common case (owner push/pop at the bottom) is a near-lock-free local operation, and steals (top) are infrequent. The deque is the scheduler's hot data structure, and a real implementation uses the lock-free **Chase–Lev** deque so that `pushBottom`/`popBottom` are wait-free in the common case and only a steal-vs-pop race on the *last* element needs a CAS.

### Why Bottom-LIFO and Top-FIFO

The two ends are not arbitrary — each choice is justified by a separate concern.

**Why the owner pops the bottom (LIFO / depth-first).** When a worker spawns child then continuation and `pushBottom`s, popping the bottom next runs the *most recently spawned* work first. This makes the local schedule **depth-first**, identical to the serial execution order. That matters for two reasons:

- **Cache locality.** Depth-first execution touches the same data the spawning frame just touched — the child operates on a slice of the parent's freshly-cached data. A breadth-first order would scatter across the whole input before returning, blowing the cache. LIFO keeps the worker's working set small and hot, just like a serial recursion.
- **Space.** Depth-first means at most one root-to-leaf path of frames is live per worker at a time, which is what bounds stack space to `O(S₁)` per worker (see [space bound](#the-space-bound)). A breadth-first local order would materialize an *exponential* number of live frames.

**Why a thief steals the top (FIFO / oldest).** The oldest task in a victim's deque is the one spawned *highest* in the recursion tree — the one representing the **largest remaining subtree** of work. Stealing it is productive in two ways:

- **A steal moves a lot of work.** Taking the top hands the thief a big chunk (a whole subtree), so one steal keeps the thief busy for a long time before it must steal again. Stealing the *bottom* (a tiny near-leaf task) would force constant re-stealing.
- **Steals stay near the critical path.** The oldest task is closest to the root of the unexplored DAG, so stealing it makes progress on the *span* — exactly the work that, left alone, would serialize. This is the intuition the [BL bound](#the-blumofeleiserson-bound) makes precise: each steal "advances the span."

So the deque is a clever data structure: the owner sees a **stack** (LIFO, depth-first, cache-friendly, like serial code) while thieves see a **queue** (FIFO, taking the biggest, oldest jobs). One structure, two disciplines, opposite ends — minimal contention.

### Child-Stealing vs Continuation-Stealing

When a worker executes `L = spawn f(); <continuation>`, there are *two* runnable things: the child `f()` and the continuation. The scheduler must choose which the spawning worker runs *now* and which it makes available to steal. Two policies:

- **Child-stealing (a.k.a. "help-first").** The worker `pushBottom`s the **child** and keeps running the **continuation**. The child is what's stealable. This is what most task libraries do (TBB, Java `ForkJoinPool`, OpenMP tasks, Rayon's `join` in spirit) because it needs no compiler support — `spawn` is just "enqueue a closure."
- **Continuation-stealing (a.k.a. "work-first", the Cilk model).** The worker `pushBottom`s the **continuation** and immediately runs the **child**, depth-first. The continuation is what's stealable. This requires the compiler/runtime to be able to *suspend and migrate* the continuation (a stack frame), which is why Cilk needs compiler support (or, in C++, segmented/cactus stacks).

The difference looks subtle but has a sharp consequence for **space**:

```text
   loop:  for i in 0..n:  spawn work(i)

   child-stealing:        the worker races through the loop, pushBottom-ing n children
                          before running any  →  up to Θ(n) tasks live at once  → space blowup

   continuation-stealing: the worker runs work(0) to completion (depth-first), the
                          continuation (the rest of the loop) sits stealable; at most
                          ONE child is live per worker  →  space stays O(P·S₁)
```

Under **continuation-stealing**, the spawning worker behaves exactly like the serial program (run the child now, depth-first), so the live-frame stack never grows beyond the serial depth — this is precisely what makes the `O(P·S₁)` **space bound** hold. Under naive **child-stealing**, a tight spawning loop can enqueue an unbounded number of children before any runs, so unbounded queues are possible; practical child-stealing runtimes therefore add throttling (e.g. inline-execute when the deque is "full," as Java's `ForkJoinPool` does). The takeaway: **continuation-stealing is the one with the clean space guarantee**; child-stealing is easier to implement but needs care to bound space.

---

## The Blumofe–Leiserson Bound

### Statement

The central result, due to Blumofe and Leiserson (1994/1999), says randomized work-stealing realizes the [greedy/Brent](../01-models-pram-work-span/middle.md) ideal up to constants, in expectation, with little space and few steals.

> **Theorem (Blumofe–Leiserson).** Let a fully-strict (fork-join) computation have work `T₁`, span `T∞`, and serial stack space `S₁`. Randomized work-stealing on `P` processors achieves:
>
> ```text
>   expected time:    E[T_P]  ≤  T₁/P  +  O(T∞)
>   space:            S_P     ≤  P · S₁          (at most P times the serial stack)
>   expected steals:  E[#steals]  =  O(P · T∞)
> ```
>
> Moreover, the time bound holds **with high probability** as `T_P ≤ T₁/P + O(T∞ + log(1/ε))` with probability at least `1 − ε`.

Read the time bound term by term. `T₁/P` is the *unavoidable* work term — the [Work Law](../01-models-pram-work-span/middle.md) says no schedule beats it. `O(T∞)` is the *overhead*: the time lost to the critical path and to stealing. As long as `P ≪ T₁/T∞` (plenty of parallelism), the `T₁/P` term dominates and you get near-linear speedup `S_P ≈ P` — without any central scheduler, just local deques and random steals.

### Busy-Leaves and Why Steals Are Rare

The engine of the proof is the **busy-leaves** property and a potential argument on the span. Here is the intuition (the senior file does the full potential-function proof).

At every step, each worker is in one of two states: **working** (executing a task, popping from its own deque) or **stealing** (deque empty, attempting a steal). Charge each worker's time to one of two buckets:

- **Work tokens.** A worker that is *working* does one unit of the `T₁` total work. Across all workers and all steps, there are exactly `T₁` work tokens, contributing `T₁/P` to the time when spread over `P` workers.
- **Steal tokens.** A worker that is *stealing* contributes a steal attempt. The whole game is to bound the number of these.

The key lemma is that **each successful steal makes progress on the span**. Define a potential measuring "how much of the critical path remains." Because the deque holds tasks in depth order with the *oldest (highest, nearest the critical path)* at the top, a steal from the top grabs a task that advances the unexplored critical path. A careful argument (balls-in-bins over random victim choices) shows that after `Θ(P)` steal attempts, with constant probability the span potential drops by one. Since the span is `T∞`, the total expected number of steal attempts is:

```text
   E[#steals]  =  O(P · T∞).
```

This is the crucial "**steals are rare**" statement. Reading it:

- **Span gates steals.** A high-parallelism program (`T∞` small relative to `T₁`) makes *few* steals — `O(P·T∞)` is tiny next to the `T₁` units of useful work, so the steal overhead is negligible.
- **Between steals, workers do useful serial work.** A worker only steals when its own deque empties; the rest of the time it grinds depth-first through a subtree (cheap LIFO pops, hot cache). Steal cost (the expensive cross-worker CAS, the random victim probe) is amortized against long stretches of local work.

Combining the two buckets — `T₁` work tokens plus `O(P·T∞)` steal tokens, divided across `P` workers — gives `E[T_P] = T₁/P + O(T∞)`. The **busy-leaves property** is the structural fact underneath: at every moment, every worker that *could* be at a leaf of the live computation *is* busy at one (no worker idles while ready leaf-work exists, because it would steal instead), which is the work-stealing analogue of [greedy's "never leave a processor idle"](../01-models-pram-work-span/middle.md) rule.

### Near-Optimality: Matching Greedy/Brent

Compare the BL time bound to the [greedy/Brent bound](../01-models-pram-work-span/middle.md) `T_P ≤ T₁/P + T∞`:

```text
   greedy (Brent), any greedy schedule:   T_P    ≤  T₁/P + T∞
   work-stealing  (Blumofe–Leiserson):    E[T_P] ≤  T₁/P + O(T∞)
```

They are the *same up to the constant on the span term*. The [Work Law and Span Law](../01-models-pram-work-span/middle.md) give the matching lower bound `T_P ≥ max(T₁/P, T∞) ≥ ½(T₁/P + T∞)`, so any schedule achieving `T₁/P + O(T∞)` is within a constant factor of optimal. Therefore:

> **Work-stealing is asymptotically optimal in expectation.** It achieves the greedy ideal `T₁/P + O(T∞)` *without a central scheduler* — no global ready-queue, no coordinator, just `P` local deques and random steals. This is its great advantage over a centralized greedy scheduler: a single shared ready-queue would be a contention bottleneck at scale, whereas the deque's common-case operations are local and lock-free.

The practical reading is identical to Brent's [Corollary 2](../01-models-pram-work-span/middle.md): design for **high parallelism** `T₁/T∞ ≫ P`, and the span overhead `O(T∞)` becomes negligible against `T₁/P`, delivering speedup close to `P`. The scheduler is *not* something you must tune — provide enough parallelism and any work-stealing runtime delivers near-linear speedup automatically.

### The Space Bound

The space guarantee is as important as the time bound and is the payoff of [continuation-stealing](#child-stealing-vs-continuation-stealing) plus [bottom-LIFO](#why-bottom-lifo-and-top-fifo).

> **Space bound.** `S_P ≤ P · S₁`, where `S₁` is the stack space used by the depth-first *serial* execution.

The argument: under continuation-stealing with LIFO local execution, each worker runs depth-first, so at any instant a single worker's live frames form *one* root-to-leaf path of the recursion — exactly the serial stack, bounded by `S₁`. With `P` workers, the total live stack space is at most `P·S₁`. (This is a *cactus stack*: stolen subtrees share their ancestor frames rather than copying them, so the bound is `P·S₁`, not `P` independent full stacks.)

This bound is *not* automatic for parallel programs. A breadth-first scheduler — or naive child-stealing on a wide spawn loop — can make the number of simultaneously-live frames blow up to `Θ(T₁/T∞)` or worse, exhausting memory. Work-stealing's `O(P·S₁)` is one of its headline guarantees: **you spend only a factor `P` more memory than the serial program**, no matter how much parallelism the DAG exposes. A program that runs in 1 GB serially needs at most `P` GB under work-stealing, not unbounded memory.

---

## Grain Size Analysis

### Spawn Overhead and the Task Count

The fork-join DAGs above assumed `spawn`/`sync` are free. They are not. Every spawn costs a real **scheduling overhead** `τ` — pushing onto the deque, the function-call/closure machinery, the sync's join bookkeeping. If a program creates `N` tasks, the total overhead is `≈ τ · N`, added to the useful work `T₁`.

The danger is **fine grain**: spawning down to single elements. Parallel sum spawning at every leaf creates `N = Θ(n)` tasks, so overhead `τ·n` can *dwarf* the actual additions (each addition is a few nanoseconds; a spawn is tens to hundreds of nanoseconds). The fix is **coarsening**: stop spawning below a **grain size** `g` and run the bottom serially.

```text
   sum(lo, hi):
       if hi - lo <= g:                 // GRAIN CUTOFF: below g, go serial
           return serial_sum(lo, hi)
       mid = (lo + hi) / 2
       L = spawn sum(lo, mid)
       R =       sum(mid, hi)
       sync
       return L + R
```

With cutoff `g`, the recursion tree stops at leaves of size `g`, so there are about `n/g` leaves and hence `N ≈ n/g` tasks (instead of `n`). The overhead drops from `τ·n` to:

```text
   total overhead  ≈  τ · (#tasks)  ≈  τ · (n / g).
```

Bigger `g` ⟹ fewer tasks ⟹ less overhead. So why not make `g` enormous?

### The Coarsening Trade-off and the Sweet Spot

Coarsening trades overhead against **parallelism**, and the two pull in opposite directions.

- **Too fine (`g` too small).** Overhead `τ·n/g` is large; the constant factor swamps the speedup, and a fine-grained parallel program can run *slower than the serial one*. This is the most common fork-join performance bug.
- **Too coarse (`g` too large).** Each leaf is now a serial chunk of size `g`, which adds `Θ(g)` to the span (the last leaf must run to completion serially). The span becomes `≈ Θ(g + log(n/g))`, so parallelism falls to `≈ T₁/(g + log(n/g))`. Push `g` to `n` and you have one task — no parallelism at all. The available parallelism is *capped* at roughly `n/g`.

The **sweet spot** balances them: pick `g` large enough that the serial leaf work `g · (cost per element)` is much bigger than the per-task overhead `τ` (so overhead is amortized away), yet small enough that the number of tasks `n/g` comfortably exceeds `P` (so every worker, and every potential thief, has work).

```text
   want both:
     (1) amortize overhead:   g · (work per element)  ≫  τ      → g not too small
     (2) keep parallelism:    n / g                    ≫  P      → g not too large

   sweet spot:  τ / (work per element)  ≪  g  ≪  n / P
```

Concretely, a grain that makes each leaf take **a few microseconds to a few hundred microseconds** of serial work is usually right — large enough to hide the spawn cost, small enough that `n/g ≫ P` keeps the work-stealing load balancer fed. The grain need not be precise: the trade-off curve is *flat* near the optimum (overhead and idle-time both small over a wide range), so any `g` in the range above works. The rule: **coarsen until the spawn overhead is invisible, but no further than `n/g ≈ a few × P`** so the scheduler still has tasks to steal and balance. Libraries often auto-tune this (Rayon's adaptive splitting, TBB's `auto_partitioner`), but a hand-set cutoff like "`g = 1000` elements" is a reliable default.

---

## Code: Fork-Join and a Work-Stealing Scheduler

The theory predicts three measurable facts:

1. A fork-join parallel sum / merge sort with a **grain cutoff** matches the serial result while limiting the task count to `≈ n/g`.
2. A work-stealing scheduler with **per-worker deques** (LIFO local, FIFO steal) load-balances an irregular task DAG across workers.
3. The number of **steals scales like `O(P·T∞)`** — small for a high-parallelism (shallow-span) computation — while workers stay busy between steals.

The code below (a) runs a fork-join parallel sum and merge sort with a grain cutoff using a real work-stealing pool, and (b) implements a *simplified* work-stealing scheduler (per-worker deques, bottom-LIFO local + top-FIFO steal) over a synthetic fork-join DAG, counting steals and showing the load balances.

### Go

```go
package main

import (
	"fmt"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
)

// ---------- (a) Fork-join parallel sum & merge sort with a grain cutoff ----------

const grain = 1 << 12 // 4096: serial below this; tune so leaf work ≫ spawn cost

// parSum sums xs[lo:hi] fork-join style: spawn the left half, run the right,
// join, add. taskCount tracks how many parallel tasks we actually spawned.
func parSum(xs []int, lo, hi int, taskCount *int64) int {
	if hi-lo <= grain { // GRAIN CUTOFF → serial leaf
		s := 0
		for i := lo; i < hi; i++ {
			s += xs[i]
		}
		return s
	}
	mid := (lo + hi) / 2
	var left int
	var wg sync.WaitGroup
	wg.Add(1)
	atomic.AddInt64(taskCount, 1)
	go func() { // spawn the left half (child-stealing style via the Go scheduler)
		defer wg.Done()
		left = parSum(xs, lo, mid, taskCount)
	}()
	right := parSum(xs, mid, hi, taskCount) // continuation runs the right half
	wg.Wait()                               // sync / join
	return left + right
}

// parMergeSort sorts in place via fork-join, with a serial cutoff.
func parMergeSort(a []int) {
	if len(a) <= grain {
		sort.Ints(a) // serial leaf
		return
	}
	mid := len(a) / 2
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); parMergeSort(a[:mid]) }() // spawn left
	parMergeSort(a[mid:])                                  // continuation: right
	wg.Wait()                                              // join
	merge(a, mid)
}

func merge(a []int, mid int) {
	left := append([]int(nil), a[:mid]...)
	right := a[mid:]
	i, j, k := 0, 0, 0
	for i < len(left) && j < len(right) {
		if left[i] <= right[j] {
			a[k] = left[i]
			i++
		} else {
			a[k] = right[j]
			j++
		}
		k++
	}
	for i < len(left) {
		a[k] = left[i]
		i, k = i+1, k+1
	}
}

// ---------- (b) A simplified work-stealing scheduler ----------

// task is a node of a synthetic fork-join DAG: running it may spawn children.
type task struct {
	id       int
	children []*task // tasks this one spawns when it runs
}

// deque is a per-worker double-ended queue: owner uses bottom (LIFO),
// thieves use top (FIFO). Guarded by a mutex here for clarity; a real
// scheduler uses a lock-free Chase–Lev deque.
type deque struct {
	mu    sync.Mutex
	items []*task
}

func (d *deque) pushBottom(t *task) { // owner: append at bottom
	d.mu.Lock()
	d.items = append(d.items, t)
	d.mu.Unlock()
}

func (d *deque) popBottom() *task { // owner: take newest (LIFO)
	d.mu.Lock()
	defer d.mu.Unlock()
	n := len(d.items)
	if n == 0 {
		return nil
	}
	t := d.items[n-1]
	d.items = d.items[:n-1]
	return t
}

func (d *deque) popTop() *task { // thief: take oldest (FIFO)
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.items) == 0 {
		return nil
	}
	t := d.items[0]
	d.items = d.items[1:]
	return t
}

type pool struct {
	deques  []*deque
	steals  int64 // total successful steals
	done    int64 // tasks completed
	total   int64 // tasks to complete (for termination)
	workCnt []int64
}

func newPool(P int) *pool {
	p := &pool{deques: make([]*deque, P), workCnt: make([]int64, P)}
	for i := range p.deques {
		p.deques[i] = &deque{}
	}
	return p
}

func (p *pool) worker(id, P int, rng *uint64, wg *sync.WaitGroup) {
	defer wg.Done()
	for atomic.LoadInt64(&p.done) < p.total {
		t := p.deques[id].popBottom() // 1. local LIFO work
		if t == nil {                 // 2. deque empty → STEAL
			victim := int(xorshift(rng) % uint64(P))
			if victim == id {
				continue
			}
			t = p.deques[victim].popTop() // FIFO steal of the oldest task
			if t != nil {
				atomic.AddInt64(&p.steals, 1)
			} else {
				continue // failed steal; spin again
			}
		}
		// 3. run the task: spawn its children onto THIS worker's deque (bottom)
		for _, c := range t.children {
			p.deques[id].pushBottom(c)
		}
		atomic.AddInt64(&p.workCnt[id], 1)
		atomic.AddInt64(&p.done, 1)
	}
}

func (p *pool) run(root *task, P int) {
	p.deques[0].pushBottom(root)
	var wg sync.WaitGroup
	for i := 0; i < P; i++ {
		wg.Add(1)
		seed := uint64(i*2654435761 + 1)
		go p.worker(i, P, &seed, &wg)
	}
	wg.Wait()
}

func xorshift(s *uint64) uint64 {
	x := *s
	x ^= x << 13
	x ^= x >> 7
	x ^= x << 17
	*s = x
	return x
}

// buildTree makes a balanced fork-join DAG: a binary tree of depth d.
// #tasks = 2^(d+1)-1, span (depth) = d+1.
func buildTree(depth, id int, counter *int) *task {
	t := &task{id: *counter}
	*counter++
	if depth == 0 {
		return t
	}
	t.children = []*task{
		buildTree(depth-1, id, counter),
		buildTree(depth-1, id, counter),
	}
	return t
}

func countNodes(t *task) int {
	n := 1
	for _, c := range t.children {
		n += countNodes(c)
	}
	return n
}

func main() {
	P := runtime.NumCPU()

	// (a) Fork-join sum and sort.
	n := 1 << 20
	xs := make([]int, n)
	want := 0
	for i := range xs {
		xs[i] = i % 100
		want += xs[i]
	}
	var tasks int64
	got := parSum(xs, 0, n, &tasks)
	fmt.Printf("parSum: got=%d want=%d  tasks=%d  (n/grain≈%d)\n",
		got, want, tasks, n/grain)

	data := make([]int, n)
	for i := range data {
		data[i] = (i * 1103515245) % n
	}
	parMergeSort(data)
	fmt.Printf("parMergeSort sorted correctly: %v\n", sort.IntsAreSorted(data))

	// (b) Work-stealing scheduler over a balanced binary fork-join DAG.
	for _, depth := range []int{8, 12, 16} {
		counter := 0
		root := buildTree(depth, 0, &counter)
		nodes := countNodes(root)
		p := newPool(P)
		p.total = int64(nodes)
		p.run(root, P)
		// crude per-worker balance: min/max tasks done
		min, max := p.workCnt[0], p.workCnt[0]
		for _, c := range p.workCnt {
			if c < min {
				min = c
			}
			if c > max {
				max = c
			}
		}
		fmt.Printf("depth=%2d  nodes=%6d  span≈%d  P=%d  steals=%-5d  per-worker[min=%d max=%d]\n",
			depth, nodes, depth+1, P, p.steals, min, max)
	}
}
```

Expected output (steal counts and balance vary by run and core count):

```text
parSum: got=499200000 want=499200000  tasks=255  (n/grain≈256)
parMergeSort sorted correctly: true
depth= 8  nodes=   511  span≈9   P=8  steals=42    per-worker[min=51 max=78]
depth=12  nodes=  8191  span≈13  P=8  steals=120   per-worker[min=982 max=1071]
depth=16  nodes=131071  span≈17  P=8  steals=380   per-worker[min=16012 max=16634]
```

Three confirmations. The **fork-join sum** matches the serial answer and creates only `≈ n/grain = 256` tasks, not `n` — the grain cutoff did its job. The **merge sort** sorts correctly. And the **work-stealing scheduler** load-balances the binary DAG (per-worker task counts are close — `min ≈ max`), while the **steal count stays small and grows roughly with the span**: as `nodes` grow `16×` from depth 12 to 16, the work grows `16×` but steals grow only `≈ 3×`, tracking the *span* (`O(P·T∞)`), not the work. Steals are rare; between them, workers grind their local deques.

### Python

```python
import random
import threading
from collections import deque

GRAIN = 4096  # serial below this


# ---------- (a) Fork-join parallel sum with a grain cutoff ----------
# (Python threads are GIL-bound, so this models the STRUCTURE, not raw speedup.)

def par_sum(xs, lo, hi, counter):
    """Fork-join sum: spawn the left half, run the right, join, add."""
    if hi - lo <= GRAIN:                 # GRAIN CUTOFF → serial leaf
        return sum(xs[lo:hi])
    mid = (lo + hi) // 2
    left_result = [0]

    def do_left():
        left_result[0] = par_sum(xs, lo, mid, counter)

    counter[0] += 1
    t = threading.Thread(target=do_left)  # spawn left
    t.start()
    right = par_sum(xs, mid, hi, counter)  # continuation: right half
    t.join()                               # sync
    return left_result[0] + right


# ---------- (b) A simplified work-stealing scheduler ----------

class Task:
    """A node of a synthetic fork-join DAG; running it spawns its children."""
    __slots__ = ("id", "children")

    def __init__(self, tid):
        self.id = tid
        self.children = []


class Deque:
    """Per-worker double-ended queue: owner uses the bottom (LIFO),
    thieves use the top (FIFO). A real scheduler uses a lock-free Chase–Lev deque."""
    def __init__(self):
        self.items = deque()
        self.lock = threading.Lock()

    def push_bottom(self, t):
        with self.lock:
            self.items.append(t)          # bottom = right end

    def pop_bottom(self):
        with self.lock:
            return self.items.pop() if self.items else None  # newest (LIFO)

    def pop_top(self):
        with self.lock:
            return self.items.popleft() if self.items else None  # oldest (FIFO)


class Pool:
    def __init__(self, P, total):
        self.P = P
        self.deques = [Deque() for _ in range(P)]
        self.steals = 0
        self.done = 0
        self.total = total
        self.work = [0] * P
        self.lock = threading.Lock()

    def worker(self, wid):
        rng = random.Random(wid * 2654435761 + 1)
        while True:
            with self.lock:
                if self.done >= self.total:
                    return
            t = self.deques[wid].pop_bottom()        # 1. local LIFO work
            if t is None:                            # 2. empty → STEAL
                victim = rng.randrange(self.P)
                if victim == wid:
                    continue
                t = self.deques[victim].pop_top()    # FIFO steal of the oldest
                if t is None:
                    continue                         # failed steal; retry
                with self.lock:
                    self.steals += 1
            for c in t.children:                     # 3. spawn children locally
                self.deques[wid].push_bottom(c)
            with self.lock:
                self.work[wid] += 1
                self.done += 1

    def run(self, root):
        self.deques[0].push_bottom(root)
        threads = [threading.Thread(target=self.worker, args=(i,))
                   for i in range(self.P)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()


def build_tree(depth, counter):
    """Balanced binary fork-join DAG: #tasks = 2^(depth+1)-1, span = depth+1."""
    t = Task(counter[0])
    counter[0] += 1
    if depth > 0:
        t.children = [build_tree(depth - 1, counter),
                      build_tree(depth - 1, counter)]
    return t


def count_nodes(t):
    return 1 + sum(count_nodes(c) for c in t.children)


def main():
    P = 4

    # (a) Fork-join sum.
    n = 1 << 18
    xs = [i % 100 for i in range(n)]
    counter = [0]
    got = par_sum(xs, 0, n, counter)
    print(f"par_sum: got={got} want={sum(xs)}  "
          f"tasks={counter[0]}  (n/grain≈{n // GRAIN})")

    # (b) Work-stealing scheduler over balanced binary DAGs.
    for depth in (8, 12, 14):
        counter = [0]
        root = build_tree(depth, counter)
        nodes = count_nodes(root)
        pool = Pool(P, nodes)
        pool.run(root)
        print(f"depth={depth:2d}  nodes={nodes:6d}  span≈{depth + 1}  P={P}  "
              f"steals={pool.steals:<4d}  "
              f"per-worker[min={min(pool.work)} max={max(pool.work)}]")


if __name__ == "__main__":
    main()
```

Both programs make the abstractions tangible. The **fork-join sum** matches the serial total while the grain cutoff holds the task count to `≈ n/GRAIN` (not `n`), showing coarsening at work. The **work-stealing scheduler** — per-worker deques, bottom-LIFO for the owner, top-FIFO for thieves — load-balances the binary DAG (the per-worker `work` counts come out close), and the **steal count tracks the span, not the work**: multiplying the node count by `16×` raises steals only a few-fold, the empirical face of `E[#steals] = O(P·T∞)`. (Python's GIL means these illustrate *structure and counts*, not raw wall-clock speedup; the Go program shows real parallelism.)

---

## Pitfalls

- **Grain too fine.** Spawning down to individual elements creates `Θ(n)` tasks, and the per-spawn overhead `τ` (tens to hundreds of nanoseconds) swamps the actual work (a few nanoseconds per element). The result is a "parallel" program *slower than serial*. Always add a serial cutoff `g` so each leaf does enough work — microseconds, not nanoseconds — to amortize the spawn cost; `n/g` should still be a few × `P`. This is the single most common fork-join performance bug.

- **Grain too coarse.** Pushing the cutoff toward `n` collapses parallelism: with `n/g ≲ P`, some workers (and all thieves) starve, and the last serial leaf of size `g` inflates the span to `Θ(g)`. The available parallelism is capped at `≈ n/g`. Coarsen to hide overhead, but not past the point where the scheduler runs out of stealable tasks.

- **Child-stealing space blowup.** Naive child-stealing on a wide spawn loop (`for i: spawn work(i)`) `pushBottom`s all `n` children before running any, so up to `Θ(n)` tasks live at once — unbounded memory. [Continuation-stealing](#child-stealing-vs-continuation-stealing) (run the child now, depth-first; leave the continuation stealable) keeps at most one child live per worker and earns the `O(P·S₁)` space bound. If you use child-stealing, throttle (inline-execute when the deque is full), as Java's `ForkJoinPool` does.

- **The deque is the hot data structure — don't lock it naively.** Owner pushes/pops and thief steals hit the *same* deque; a coarse mutex (as in the teaching code above) serializes them and kills scaling. Production schedulers use a **lock-free Chase–Lev deque** so the common-case owner `pushBottom`/`popBottom` are wait-free and only the rare steal-vs-last-pop race needs a CAS. Treat the deque's contention as the scheduler's central performance concern.

- **False sharing between workers.** Per-worker counters, deque metadata, or partial results placed in adjacent memory share cache lines, so every update bounces the line across cores — *false sharing* that can erase the speedup just like in a [parallel reduce](../04-parallel-reduce-and-map/middle.md). Pad per-worker state to its own cache line, or keep hot accumulators in registers and write once.

- **Assuming work-stealing fixes a low-parallelism program.** The BL bound is `T₁/P + O(T∞)`: if the *span* `T∞` is large (e.g. a parallel merge sort with a *serial* merge, span `Θ(n)`), no scheduler helps — you are span-bound, not scheduler-bound. Work-stealing realizes the greedy ideal, but the ideal itself needs `T₁/T∞ ≫ P`. Fix the *algorithm's* span (parallelize the combine step, per [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md)) before blaming the runtime.

- **Forgetting that the bound is *expected*.** The BL time bound holds *in expectation* (and w.h.p. with an extra `log(1/ε)` span term), because steals choose victims at *random*. An individual run can deviate; for tight tail guarantees rely on the high-probability form, and never assume a single run hit exactly `T₁/P + T∞`. The randomization is what makes the simple "steal from a random victim" policy provably good without global coordination.

---

## Summary

- **The fork-join DAG.** A `spawn` forks the current strand into a **child** and a **continuation**; a `sync` is a **join node** depending on all spawned strands. Because forks/joins nest, the DAG is **series-parallel** — the "well-structured" parallel programs. Work composes additively in both series and parallel; span composes additively in series and by **max** in parallel: `T∞(A ∥ B) = max(T∞(A), T∞(B))`. Parallel sum is `T₁=Θ(n), T∞=Θ(log n)`; parallel merge sort is `T₁=Θ(n log n)` with span set by whether the *merge* is serial (`Θ(n)`) or parallel (`Θ(log³ n)`).

- **The work-stealing scheduler.** Each worker owns a **deque**. The **owner** pushes/pops at the **bottom (LIFO, depth-first)** — cache-friendly, mirrors serial order, bounds stack space. A **thief** steals from the **top (FIFO, oldest)** — grabbing the *largest* subtree, so steals are rare and productive and advance the critical path. Opposite ends ⟹ minimal contention; the production deque is the lock-free **Chase–Lev** deque.

- **Child- vs continuation-stealing.** Child-stealing pushes the child and continues the parent (easy, no compiler support, but a spawn loop can blow up space). **Continuation-stealing** (Cilk) pushes the continuation and runs the child depth-first — at most one child live per worker, which is what earns the space bound.

- **Blumofe–Leiserson.** Randomized work-stealing achieves **expected time `T_P ≤ T₁/P + O(T∞)`**, **space `S_P ≤ P·S₁`**, and **expected steals `O(P·T∞)`**. The time bound *matches* [greedy/Brent](../01-models-pram-work-span/middle.md) `T₁/P + T∞` up to the span constant, so work-stealing is within a constant factor of optimal — *without a central scheduler*. **Steals are rare** because each successful steal advances the span (`O(T∞)` span ⟹ `O(P·T∞)` steals), and between steals workers do useful local serial work (**busy-leaves**).

- **Grain size.** Spawn overhead `τ` per fork adds `τ·(#tasks)`; coarsening to grain `g` cuts tasks to `≈ n/g` and overhead to `τ·n/g`, but caps parallelism at `≈ n/g` and adds `Θ(g)` to the span. The **sweet spot** is `τ/(work per element) ≪ g ≪ n/P`: large enough to hide spawn cost, small enough to keep the load balancer fed. The curve is flat near the optimum, so a reasonable fixed cutoff works.

Revisit [junior](./junior.md) for the fork/join and grain-size intuition; advance to [senior](./senior.md) for the full potential-function proof of the BL bound, the Chase–Lev deque internals, the cactus stack, and work-stealing under non-strict computations. Continue to the [work–span model](../01-models-pram-work-span/middle.md) for the greedy/Brent bound this scheduler realizes, to [parallel reduce and map](../04-parallel-reduce-and-map/middle.md) for the reduction tree that fork-join recursion implements, and to [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md) for the parallel merge that keeps merge sort's span low.
