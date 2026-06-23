# Fork-Join and Work-Stealing — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Work-Stealing Scheduler](#the-work-stealing-scheduler)
3. [The Blumofe–Leiserson Bounds](#the-blumofeleiserson-bounds)
4. [Grain Size & Stealing Policy](#grain-size--stealing-policy)
5. [Gotcha / Trick Questions](#gotcha--trick-questions)
6. [Rapid-Fire Q&A](#rapid-fire-qa)
7. [Common Mistakes](#common-mistakes)
8. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is the fork-join model? *(Easy)*

**Answer**: Fork-join is a structured model for **divide-and-conquer parallelism** built on two primitives:

- **fork** (also `spawn`) — launch a subcomputation that *may* run in parallel with its continuation; it does not block the parent.
- **join** (also `sync`) — wait until all forked children have finished before proceeding past this point.

A function recursively **forks** its independent subproblems, then **joins** to combine their results. Parallel mergesort, quicksort, tree/array reductions, and `parallel_for` (recursively bisected) are all fork-join. The discipline is **fully nested** (well-structured): every spawned task joins back before its parent returns, so the parallelism forms a series-parallel structure rather than arbitrary threading. That nesting is exactly what makes the strong scheduling bounds possible.

### Q2: How does fork-join build a work-span DAG? *(Medium)*

**Answer**: Each `fork`/`join` carves the execution into a **directed acyclic graph** of unit-cost tasks (strands):

- A **fork** node has out-degree 2 — one edge to the spawned child, one to the continuation — creating two independent branches.
- A **join** node has in-degree 2 — both branches must complete before it executes — re-merging the branches.

The DAG is **series-parallel**: serial segments compose end-to-end, forked segments compose in parallel. From this DAG you read the two quantities that govern everything: **work `T₁`** = total nodes (serial running time) and **span `T∞`** = longest path root-to-sink (critical path). For a balanced divide-and-conquer of depth `log n`, span is typically `Θ(log n)` while work stays `Θ(n)`. See [../01-models-pram-work-span/interview.md](../01-models-pram-work-span/interview.md).

### Q3: What does fork-join give you that raw threads don't? *(Medium)*

**Answer**: **Composability and a scheduling guarantee.** Raw threads map computation 1:1 onto OS threads — expensive to create, hard to load-balance, and you must size the thread pool by hand. Fork-join lets you express parallelism **logically** (spawn millions of tiny tasks) and lets a **work-stealing runtime** map them onto a fixed set of worker threads (usually one per core). You write recursion; the runtime extracts parallelism, balances load automatically, and guarantees near-optimal time and bounded space (Q6–Q8). Nested fork-join calls compose: a parallel function can call another parallel function with no manual thread accounting.

---

## The Work-Stealing Scheduler

### Q4: How does a work-stealing scheduler work? *(Medium)*

**Answer**: One worker thread per core, each owning a **double-ended queue (deque)** of ready tasks:

1. When a worker **forks** a task, it **pushes** the new work onto the **bottom** of *its own* deque.
2. When a worker needs work, it **pops** from the **bottom** of its own deque — **LIFO**, most-recently-pushed first.
3. When a worker's deque is **empty**, it becomes a **thief**: it picks a random victim and **steals** from the **top** of the victim's deque — **FIFO**, oldest task first.

So the **owner** operates on the bottom (LIFO), thieves operate on the top (FIFO), and they touch opposite ends — which is what lets the hot path stay nearly lock-free (Q9). Randomized victim selection spreads steal load with no central coordinator. This decentralized scheme is what makes the scheduler scale.

### Q5: Why steal from the *top* (oldest), but run your own from the *bottom* (newest)? *(Hard)*

**Answer**: Two different goals at the two ends:

- **Owner runs newest (LIFO, bottom)** — in divide-and-conquer the most-recently-forked task is the *smallest, deepest* subproblem, and its data is **hot in cache**. Running it next mirrors the **serial depth-first execution order**, giving the same cache locality and stack behavior as the sequential program. LIFO keeps the working set small.
- **Thief takes oldest (FIFO, top)** — the oldest task on the deque sits **highest in the recursion tree**, so it is the **largest remaining subtree**. Stealing it transfers a big chunk of work in one expensive steal operation, amortizing the steal cost and making productive steals **rare**. It also tends to keep the victim's hot, deep tasks local.

The combination — local LIFO for locality, steal FIFO for big transfers — is precisely what yields both cache-friendliness *and* the `O(span)` steal bound. See [./middle.md](./middle.md).

---

## The Blumofe–Leiserson Bounds

### Q6: State the Blumofe–Leiserson result. *(Hard)*

**Answer**: For a fully-nested fork-join computation run by **randomized work-stealing** on `P` processors:

```
Time:   T_P = T₁/P + O(T∞)        (expected)
Steals: O(P · T∞)                 (expected total)
Space:  S_P ≤ P · S₁
```

where `T₁` is work, `T∞` is span, and `S₁` is the **serial stack space**. The time bound matches the greedy/Brent bound `T₁/P + T∞` asymptotically, so it delivers **linear speedup** whenever `P ≪ T₁/T∞` (the parallelism). The space bound says total stack usage is at most `P` times the *serial* stack — a tight, predictable footprint, not unbounded blow-up.

### Q7: Why is the work-stealing time bound near-optimal, and why are steals rare? *(Hard)*

**Answer**: The lower bounds are the **work law** `T_P ≥ T₁/P` and the **span law** `T_P ≥ T∞`. Work-stealing achieves `T₁/P + O(T∞)`, which is within a constant factor of `max(T₁/P, T∞)` — so no scheduler can do asymptotically better. Hence "near-optimal."

**Why steals are rare**: the proof charges every steal attempt against **progress along the critical path**. A potential-function argument shows that after `O(P)` steal attempts the remaining span drops by one with constant probability, so the *total* expected steals are `O(P · T∞)` — proportional to **span**, not to **work**. Since span is typically tiny (e.g. `log n`) compared to work, steals are vanishingly infrequent: almost every task is executed locally by its owner via cheap LIFO pops, and the expensive steal path fires only `O(P · T∞)` times. This is the whole reason work-stealing is fast in practice — the common case is the cheap case.

### Q8: Why is the space bound `O(P · S₁)`, and what does child-stealing risk? *(Hard)*

**Answer**: With **continuation stealing** (work-first), each of the `P` workers follows a single root-to-leaf path of the recursion at any moment — exactly like a serial execution — so each holds at most the serial stack depth `S₁`, giving total `S_P ≤ P · S₁`. The runtime executes the *spawned child* immediately and leaves the *continuation* stealable, which keeps every worker's live stack bounded by the serial one.

**Child stealing (help-first)** does the opposite: it enqueues the child and keeps running the continuation, so a worker can spawn many children before any join. The number of simultaneously-live tasks can balloon, and **space is no longer bounded by `P · S₁`** — it can grow with the *breadth* of the computation. This is the central child-vs-continuation trade-off: continuation stealing bounds space tightly (Cilk's choice), child stealing is simpler to bolt onto a runtime but loses the space guarantee. See [./middle.md](./middle.md).

---

## Grain Size & Stealing Policy

### Q9: Why must the deque be lock-free, and what is the hot-path cost? *(Hard)*

**Answer**: Because the deque is touched on **every fork and every task acquisition** — millions of times per second. A mutex on that path would serialize the scheduler and dominate runtime. The **Chase–Lev** deque solves this: the **owner's** `push`/`pop` on the bottom are just a load, a store, and (on the empty-race boundary) a single atomic compare-and-swap; the **thief's** `steal` from the top uses one CAS. Owner and thief operate on opposite ends, so they conflict only when the deque is nearly empty (one element) — the lone case needing a CAS to arbitrate. The result: the **common-case hot path is a few non-atomic memory ops** (often wait-free for the owner), and atomics fire only at the contended boundary or during a steal. That low constant factor is essential — without it the `O(span)` steal advantage would be eaten by per-task overhead.

### Q10: Why and how do you set a grain-size cutoff? *(Medium)*

**Answer**: Each `fork` has real overhead — deque push, potential steal, task bookkeeping. If you recurse down to single elements, that overhead **dwarfs the actual work**, and the parallel version runs slower than serial. The fix is a **grain-size cutoff**: below a threshold `G`, stop forking and run the subproblem **serially**.

```
solve(lo, hi):
    if hi - lo <= G:          # grain-size cutoff
        return serial_solve(lo, hi)
    mid = (lo + hi) / 2
    fork  solve(lo, mid)
    L =   solve(mid, hi)
    join
    return combine(...)
```

Pick `G` so each leaf task is large enough to **amortize spawn overhead** (often microseconds of work, e.g. thousands of elements) yet small enough to leave **enough tasks for load balancing** — you want many more tasks than cores so thieves always find work. Too-small `G` → overhead-bound; too-large `G` → coarse, idle cores. It's the parallel analogue of the two-level reduce's local-serial chunk. See [../04-parallel-reduce-and-map/interview.md](../04-parallel-reduce-and-map/interview.md).

### Q11: Name the major work-stealing runtimes. *(Easy)*

**Answer**: All implement continuation-or-child work-stealing over per-worker deques:

- **Cilk / Cilk Plus / OpenCilk** — the origin; `spawn`/`sync`, work-first continuation stealing, Chase–Lev deques.
- **Java `ForkJoinPool`** — `RecursiveTask`/`RecursiveAction`; backs parallel streams; child/help-first by default.
- **Rust `Rayon`** — `join`/`par_iter`; continuation-style work-stealing.
- **Intel TBB** — `task_group`, `parallel_for`; work-stealing task scheduler.
- **Go runtime scheduler** — M:N goroutine scheduler with **per-P run queues and work-stealing** (steals from the top of another P's queue; checks the global queue periodically).

---

## Gotcha / Trick Questions

### Q12: "Why must you never block on I/O inside a ForkJoinPool / Rayon task?" *(Hard)*

**Answer**: Because the pool has a **fixed number of worker threads** (typically one per core), and a blocking call **parks that whole worker**. While it sleeps on I/O it executes no tasks and steals nothing — you've removed a core from the scheduler. Block enough workers and the pool **starves or deadlocks**: tasks waiting on a `join` can't make progress because the workers that would run them are all blocked, and there may be no thread left to even pick up ready work. The bounds in Q6 assume workers are always either computing or stealing — blocking breaks that assumption.

**The rules**: keep fork-join tasks **CPU-bound and non-blocking**; do I/O on a **separate, larger thread pool** (or async runtime); if you genuinely must block inside one, use the runtime's escape hatch (Java `ManagedBlocker`, a dedicated blocking pool) so the scheduler can spin up a compensating thread. Mixing blocking I/O into a compute pool is the single most common production fork-join bug.

### Q13: "Is Go's scheduler work-stealing?" *(Medium)*

**Answer**: **Yes.** Go's runtime uses an **M:N scheduler**: `M` OS threads (machines) run `G` goroutines via `P` logical processors (`GOMAXPROCS` of them), each `P` holding a **local run queue**. When a `P`'s local queue empties, its thread becomes a thief and **steals from the top of another `P`'s run queue** (taking roughly half), and it periodically polls the **global run queue** and the network poller. So Go applies the same per-worker-deque, randomized-steal idea as Cilk/Rayon — but to **goroutines** rather than fork-join tasks, and notably its network I/O is non-blocking (the poller parks the goroutine, not the `P`), which is *why* Go sidesteps the Q12 starvation problem that bites compute-only pools.

### Q14: "Fork-join vs data-parallel — when do you reach for which?" *(Medium)*

**Answer**: Match the structure of the computation:

- **Fork-join (task parallelism)** — for **irregular, recursive, or nested** work where subproblem sizes are unknown or uneven: tree/graph traversal, divide-and-conquer sorts, branch-and-bound, recursive `parallel_for` over uneven ranges. Work-stealing **load-balances automatically**, which is exactly what irregular workloads need.
- **Data-parallel (map/reduce, SIMD, GPU)** — for **regular, flat** operations applying the same op across a large uniform array: element-wise transforms, dense linear algebra, reductions over arrays. Predictable, contiguous, vectorizable, and bandwidth-bound rather than scheduling-bound.

They compose: a data-parallel `map` is often *implemented* as a fork-join recursive bisection with a grain-size cutoff, so the two aren't rivals so much as different altitudes. Choose fork-join when load is **uneven and you need dynamic balancing**; choose flat data-parallel when load is **uniform and locality/vectorization dominate**. See [../04-parallel-reduce-and-map/interview.md](../04-parallel-reduce-and-map/interview.md).

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | fork / spawn does? | Launch a task that *may* run in parallel; doesn't block parent |
| 2 | join / sync does? | Wait for all forked children before continuing |
| 3 | Fork-join DAG shape? | Series-parallel; fork = out-degree 2, join = in-degree 2 |
| 4 | Owner pops from? | **Bottom**, LIFO (newest — cache-hot, serial order) |
| 5 | Thief steals from? | **Top**, FIFO (oldest — biggest subtree) |
| 6 | Why steal oldest? | Largest remaining subtree → steals are rare & productive |
| 7 | Why local LIFO? | Mirrors serial DFS order → cache-friendly, small working set |
| 8 | Deque algorithm? | **Chase–Lev** lock-free deque |
| 9 | Blumofe–Leiserson time? | `T_P = T₁/P + O(T∞)` expected |
| 10 | Expected total steals? | `O(P · T∞)` — proportional to **span** |
| 11 | Space bound? | `S_P ≤ P · S₁` (continuation stealing) |
| 12 | Why are steals rare? | `O(span)` of them; charged against critical-path progress |
| 13 | Continuation stealing bounds? | **Space** (`P · S₁`); a.k.a. work-first |
| 14 | Child stealing risks? | Unbounded live tasks → loses space bound |
| 15 | Grain-size cutoff for? | Amortize spawn overhead vs keep enough tasks |
| 16 | Never do what in a FJ task? | **Block on I/O** — starves the fixed pool |
| 17 | Is Go's scheduler work-stealing? | **Yes** — per-P run queues, steal from top |
| 18 | Runtimes? | Cilk, Java ForkJoinPool, Rayon, TBB, Go |
| 19 | Fork-join best for? | Irregular / recursive work needing load balancing |

---

## Common Mistakes

1. **Forking down to single elements.** Without a **grain-size cutoff**, spawn overhead dominates and parallel runs slower than serial. Stop recursing below threshold `G` and run serially.
2. **Blocking on I/O inside a compute pool.** It parks a worker, shrinks effective parallelism, and can deadlock at `join`. Keep fork-join tasks CPU-bound; do I/O elsewhere or use a managed-blocker escape hatch.
3. **Thinking steals are frequent.** They're `O(P · T∞)` — proportional to **span**, not work. Almost everything runs locally via cheap LIFO pops; the steal path is the rare case.
4. **Mixing up the deque ends.** Owner = bottom/LIFO/newest (locality); thief = top/FIFO/oldest (big transfer). They're opposite ends for a reason.
5. **Ignoring the child-vs-continuation distinction.** Continuation (work-first) stealing bounds space at `P · S₁`; child (help-first) stealing can blow space up with breadth.
6. **Assuming the deque needs a lock.** The whole point of Chase–Lev is a near-lock-free hot path; a mutex there would serialize the scheduler.
7. **Using fork-join for flat, uniform array ops.** Regular data-parallel work wants vectorized map/reduce, not task overhead; reserve fork-join for irregular, recursive load.

---

## Tips & Summary

- **Open with the two primitives and the DAG**: "fork spawns a maybe-parallel task, join waits for it; nested forks build a series-parallel work-span DAG with work `T₁` and span `T∞`." That frames every later answer.
- **Nail the deque mechanics**: owner pushes/pops the **bottom (LIFO, newest)** for cache locality and serial order; thieves steal the **top (FIFO, oldest)** because it's the biggest subtree, making steals rare and productive.
- **Quote the bounds precisely**: `T_P = T₁/P + O(T∞)` time, `O(P · T∞)` steals, `S_P ≤ P · S₁` space — and explain steals are rare *because* they're charged against span.
- **Know why it's near-optimal**: it meets `max(T₁/P, T∞)` within a constant, so linear speedup holds until `P ≈ T₁/T∞` — same regime as Brent.
- **Have grain size and the I/O gotcha ready**: cutoff to amortize spawn overhead; never block inside a fixed-thread pool or you starve it.
- **Place the runtimes**: Cilk (origin, continuation stealing), Java ForkJoinPool, Rust Rayon, Intel TBB, and Go's goroutine scheduler — all per-worker deques with randomized stealing. Fork-join for irregular/recursive work; flat data-parallel for uniform arrays.

**Related:** [Models, PRAM & Work–Span — Interview](../01-models-pram-work-span/interview.md) · [Parallel Reduce and Map — Interview](../04-parallel-reduce-and-map/interview.md) · [Fork-Join & Work-Stealing — Middle](./middle.md)
