# Fork-Join and Work-Stealing — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [The Runtimes, Mapped to the Theory](#the-runtimes-mapped-to-the-theory)
   - [Cilk / OpenCilk — the Original](#cilk--opencilk--the-original)
   - [Intel TBB](#intel-tbb)
   - [Java `ForkJoinPool`](#java-forkjoinpool)
   - [Rust Rayon](#rust-rayon)
   - [.NET TPL](#net-tpl)
   - [The Go Scheduler IS Work-Stealing](#the-go-scheduler-is-work-stealing)
   - [OpenMP Tasks](#openmp-tasks)
3. [Grain-Size / Cutoff Tuning in Practice](#grain-size--cutoff-tuning-in-practice)
4. [When Fork-Join Wins vs Data-Parallel](#when-fork-join-wins-vs-data-parallel)
5. [Engineering Pitfalls](#engineering-pitfalls)
6. [Observability: Measuring Work, Span, and Steals](#observability-measuring-work-span-and-steals)
7. [Worked End-to-End: Tuned Parallel Sort](#worked-end-to-end-tuned-parallel-sort)
8. [Decision Framework](#decision-framework)
9. [Research and System Pointers](#research-and-system-pointers)
10. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) closes the theory: a fork-join computation is a series-parallel DAG, the randomized work-stealing scheduler delivers `E[T_P] ≤ T₁/P + O(T∞)` with `O(P·T∞)` expected steals and `O(P·S₁)` space (Blumofe–Leiserson), the work-first principle says keep the common case — running your own spawned work — cheap and push the rare case — a steal — onto the thief, and the THE deque protocol makes the owner's push/pop lock-free against concurrent steals. That theory is correct and it is the right mental model for everything below.

This tier answers a different question: **when you reach for OpenCilk, Intel TBB, Java's `ForkJoinPool`, Rust Rayon, .NET's TPL, Go goroutines, or OpenMP tasks, how does each one realize that theory, what is the one knob you actually tune (grain size), when is fork-join the right tool at all versus a flat data-parallel loop, and what are the production traps that turn the `T₁/P + O(T∞)` promise into a starved pool or a slowdown?** The honest thesis has four parts. First, every mainstream runtime in this file is the *same* Blumofe–Leiserson scheduler wearing different syntax — per-worker deques, steal-from-a-random-victim, LIFO-own / FIFO-steal — and the Go runtime's `M:N` goroutine scheduler *is* a work-stealing scheduler even though Go markets it as concurrency. Second, the single highest-leverage decision is the **grain-size cutoff**: stop recursing and run a serial base case once subproblems are small, because a spawn costs real cycles and a one-element base case drowns the work in scheduling overhead. Third, fork-join earns its keep on **irregular, recursive, unbalanced** workloads where load is unpredictable — the stealer self-balances — and loses to a flat `parallel_for` / SIMD / GPU on **regular** loops. Fourth, the way you wreck a fork-join system in production is almost always the same: you **block** inside a pool worker.

This file works through that gap: each runtime mapped to the spawn/sync DAG, grain-size tuning with the overhead-vs-parallelism math, the fork-join-vs-data-parallel decision, the pitfalls (blocking, false sharing in the deque, oversubscription, thread-local state surviving a steal, exception/cancellation across a join), how to *measure* work/span/steals, and a runnable tuned parallel sort that exhibits the too-fine / too-coarse / sweet-spot curve and the blocking-in-pool trap.

---

## The Runtimes, Mapped to the Theory

Every framework below implements the same contract: `spawn` creates a DAG vertex that *may* run in parallel; `sync`/`join` is the edge that forces it to complete first; a fixed pool of workers, each owning a deque, runs the DAG and steals when idle. What differs is the syntax, the steal discipline's exact tuning, and the surrounding ergonomics (structured `sync`, error propagation, cancellation).

| Runtime | `spawn` | `sync` / join | Scheduler |
|---|---|---|---|
| **Cilk / OpenCilk** | `cilk_spawn` | `cilk_sync` | the reference randomized work-stealing scheduler (work-first, THE deque) |
| **Intel TBB** | `task_group::run`, `parallel_invoke` | `task_group::wait` | work-stealing task arena |
| **Java** | `ForkJoinTask::fork` / `RecursiveTask` | `join()` | Doug Lea's `ForkJoinPool` (backs `parallelStream`, `CompletableFuture`) |
| **Rust Rayon** | `rayon::join(a, b)`, `scope.spawn` | implicit at `join` return | global work-stealing pool (Crossbeam deques) |
| **.NET TPL** | `Task.Run`, `Parallel.Invoke` | `Task.Wait` / `await` | work-stealing pool with per-thread local queues |
| **Go** | `go f()` | `sync.WaitGroup` / `errgroup` | `M:N` goroutine scheduler, per-`P` run queues + stealing |
| **OpenMP** | `#pragma omp task` | `#pragma omp taskwait` / `taskgroup` | work-stealing task pool |

### Cilk / OpenCilk — the Original

Cilk is where all of this comes from, and reading it first makes every other runtime legible. The surface is two keywords: `cilk_spawn f(x)` says "the continuation may run in parallel with `f(x)`," and `cilk_sync` waits for all spawns in the current frame. `cilk_for` is sugar that recursively halves a range with `cilk_spawn` down to a grain size — *not* a flat parallel loop, but a balanced spawn tree, which is the point.

```c
int fib(int n) {
    if (n < 2) return n;
    int a = cilk_spawn fib(n - 1);   // spawn: may run in parallel
    int b =            fib(n - 2);   // continuation runs the other branch
    cilk_sync;                       // join before combining
    return a + b;
}
```

The two ideas worth carrying out of Cilk are the **work-first principle** — the compiler and runtime make the no-steal path (you run your own spawn) nearly as cheap as an ordinary call, pushing all the bookkeeping onto the rare steal — and **Cilkscale** (formerly Cilkview), which instruments a single run to report the actual work `T₁`, span `T∞`, and parallelism `T₁/T∞`, then predicts the speedup curve before you ever touch a big machine. OpenCilk (the LLVM-based successor) keeps both and adds a race detector (Cilksan) and the scalability analyzer as first-class tools. Every other runtime in this section is, mechanically, "Cilk's scheduler exposed through a library instead of a compiler."

### Intel TBB

TBB (oneTBB) brings work-stealing to plain C++ with no compiler support — it is a template library over a task arena. The fork-join surface is `task_group` and `parallel_invoke`:

```cpp
tbb::task_group g;
g.run([&]{ left  = solve(lo, mid); });   // spawn
       right = solve(mid, hi);           // continuation
g.wait();                                // sync
```

But TBB's signature contribution is its **partitioners**, which automate grain-size selection. `tbb::parallel_for` / `parallel_reduce` take a `blocked_range` and a partitioner: `simple_partitioner` splits down to an explicit `grainsize`; `auto_partitioner` (the default) starts coarse and lets *stealing demand* drive further splitting — it splits a range only when there is an idle worker to take half, so a balanced load barely splits and an imbalanced one splits exactly where work is needed; `affinity_partitioner` additionally biases re-runs back to the worker that held the data, for cache reuse. This is the practical answer to "how do I pick the grain?": for `parallel_for`/`reduce`, you usually *don't* — `auto_partitioner` makes the steal-driven split the default. You still set `grainsize` when you know the per-element cost and want to cap the recursion. The arena and the `task_scheduler` underneath are the Blumofe–Leiserson scheduler; the partitioner is just the policy for *when to stop subdividing*.

### Java `ForkJoinPool`

`ForkJoinPool` (Doug Lea, JSR 166, `java.util.concurrent`) is the work-stealing pool that backs a huge amount of the JVM's parallelism: `parallelStream()`, `CompletableFuture`'s default executor, and `Arrays.parallelSort` all run on the **common pool** (`ForkJoinPool.commonPool()`, sized to `Runtime.availableProcessors() − 1` by default). You write divide-and-conquer by subclassing `RecursiveTask<V>` (returns a value) or `RecursiveAction` (void) and overriding `compute()`:

```java
class SumTask extends RecursiveTask<Long> {
    final long[] a; final int lo, hi;
    static final int CUTOFF = 1 << 13;            // grain size: tune this
    SumTask(long[] a, int lo, int hi){ this.a=a; this.lo=lo; this.hi=hi; }
    protected Long compute() {
        if (hi - lo <= CUTOFF) {                  // serial base case
            long s = 0; for (int i = lo; i < hi; i++) s += a[i]; return s;
        }
        int mid = (lo + hi) >>> 1;
        SumTask left = new SumTask(a, lo, mid);
        left.fork();                              // spawn: push to MY deque
        long right = new SumTask(a, mid, hi).compute(); // run continuation directly
        return left.join() + right;               // sync: join (may help-steal)
    }
}
long total = ForkJoinPool.commonPool().invoke(new SumTask(a, 0, a.length));
```

The idiomatic shape is **`fork()` the first half, recurse directly on the second, then `join()`** — forking *both* halves and joining both is a common anti-pattern that wastes a push/pop, because the current worker can just run one branch itself (work-first). A subtle, important behavior: `join()` is not a blocking wait — a worker that joins an unfinished task **helps**, either running that task if it is still on a deque or stealing other work, so the worker stays busy instead of parking. This is also why you must never do blocking I/O on a `ForkJoinPool` worker (see [Pitfalls](#engineering-pitfalls)): a parked worker is a lost core, and the common pool is shared process-wide. For genuinely blocking work, wrap it in a `ManagedBlocker` (which tells the pool to spin up a compensation thread) or — better — use a *separate* dedicated executor.

### Rust Rayon

Rayon is the cleanest expression of fork-join in a systems language, and it makes the spawn/sync DAG type-safe. The primitive is `rayon::join(a, b)`, which runs two closures *potentially* in parallel and returns when both finish — the second is pushed to the deque and stolen only if a worker is idle, so on one core it is just two calls:

```rust
fn sum(slice: &[i64]) -> i64 {
    const CUTOFF: usize = 8 * 1024;          // grain size
    if slice.len() <= CUTOFF {
        return slice.iter().sum();           // serial base case
    }
    let mid = slice.len() / 2;
    let (l, r) = slice.split_at(mid);
    let (a, b) = rayon::join(|| sum(l), || sum(r));  // spawn + sync, fused
    a + b
}
```

Above that sits `par_iter()`: `v.par_iter().map(f).sum()` builds the same balanced reduce tree for you over the **global pool** (one process-wide pool, sized to logical CPUs, configurable via `ThreadPoolBuilder`). Rayon's grain knob is `with_min_len(n)` on a parallel iterator, which forbids splitting a chunk below `n` elements — the direct lever for "stop making tasks this small." Rayon also adapts splitting to stealing demand much like TBB's `auto_partitioner`, so for balanced work the defaults are usually right and `with_min_len` is the fix for too-fine tasks on cheap per-element work. Rust's ownership system is doing real work here: `join` and `par_iter` are safe precisely because the borrow checker proves the two halves don't alias mutably.

### .NET TPL

The Task Parallel Library exposes fork-join through `Task` and `Parallel`. `Task.Run` queues work; `Parallel.Invoke(a, b, c)` runs several actions and joins; `Parallel.For` / `Parallel.ForEach` are the data-parallel loops; PLINQ (`AsParallel()`) is the query layer. Underneath, the .NET thread pool uses **per-thread local queues** plus a global queue: a task created by a running pool thread goes onto that thread's *local* queue (LIFO, for cache locality), and idle threads **steal** from the tail of other threads' local queues — textbook work-stealing. Tasks created from outside a pool thread go to the global queue. The locality story mirrors Cilk's: run your own freshly-created work first (hot in cache), let thieves take the older work. Grain control comes via `ParallelOptions.MaxDegreeOfParallelism` and, for `Parallel.For`, range partitioners (`Partitioner.Create` with chunking) so you don't dispatch one task per iteration.

### The Go Scheduler IS Work-Stealing

The point that surprises people: **Go's runtime scheduler is a work-stealing scheduler**, the same family as Cilk's, even though Go presents goroutines as a concurrency feature rather than a fork-join framework. The model is `M:N` — `N` goroutines (cheap, stackful, ~few KB) multiplexed onto `M` OS threads — coordinated through `P`s (logical processors, count = `GOMAXPROCS`):

- Each `P` has a **local run queue** of runnable goroutines (a bounded ring, ~256). `go f()` pushes onto the current `P`'s local queue — cheap, no global lock.
- When a `P`'s local queue empties, its `M` **steals**: it picks a random victim `P` and takes *half* of that `P`'s run queue (steal-half, amortizing the steal cost), and also periodically checks the **global run queue** (the overflow / fairness queue) and the network poller.
- **Handoff**: when a goroutine makes a *blocking syscall*, the runtime detaches the `M` from its `P` and hands the `P` (with its remaining queue) to another `M`, so the other goroutines keep running on a core while the blocked one waits in the kernel. This is the mechanism that lets Go block freely *at the goroutine level* without starving the scheduler — the opposite of the `ForkJoinPool` trap, and the reason Go fork-join code can do I/O where Java pool code cannot.

For CPU-bound divide-and-conquer you write the fork-join DAG by hand: `go` the spawned branch, run the continuation, fan in with a `sync.WaitGroup`; when a branch can error, `golang.org/x/sync/errgroup` adds first-error propagation and context cancellation. The work–span analysis is identical to Cilk's; what differs is that there is no structured `cilk_sync` (you manage the join) and goroutines are stackful (steal-half of full goroutines, not a continuation deque). The Dmitry Vyukov scheduler design doc is the canonical reference for the per-`P` queues, steal-half, and handoff.

### OpenMP Tasks

OpenMP started as flat data-parallel (`#pragma omp parallel for`) but added **tasks** (OpenMP 3.0+) precisely to express irregular, recursive parallelism. `#pragma omp task` spawns a deferred unit onto the team's work-stealing pool; `#pragma omp taskwait` waits for the current task's children; `taskgroup` waits for a whole subtree. `taskloop` tiles a loop into tasks with an explicit `grainsize(G)` or `num_tasks(N)` clause — the OpenMP grain knob. The `if`-clause on a task is a built-in cutoff: `#pragma omp task if(n > CUTOFF)` runs the task inline (no deferral, no overhead) below the threshold, which is the standard way to coarsen OpenMP recursion. Tasks are how you do tree/graph/divide-and-conquer in OpenMP where the loop pragmas don't fit.

---

## Grain-Size / Cutoff Tuning in Practice

This is the **#1 knob**, and getting it right is worth more than any other single move. The theory said a spawn is a DAG vertex; in practice a `spawn`/`sync` pair costs real cycles — a deque push and pop, a frame/closure allocation, and exposure to the steal protocol — typically **tens to low-hundreds of cycles**. If your base case is one element, you pay that per element and the scheduling overhead swamps the actual work: a parallel sum that spawns down to a single number runs **10–100× slower** than the serial loop, all overhead and no parallelism gained.

The fix is a **cutoff**: stop recursing and run a serial base case once a subproblem is below a threshold `G`.

```text
solve(lo, hi):
    if hi - lo <= G:                    # GRAIN-SIZE CUTOFF
        return serial_solve(lo, hi)     # tight, vectorizable, zero spawn overhead
    mid = (lo + hi) / 2
    L = spawn solve(lo, mid)
    R =       solve(mid, hi)            # run continuation directly (work-first)
    sync
    return combine(L, R)
```

The tension is exact and it is the whole tuning problem:

- **Too fine** (`G` too small). You generate `O(n/G)` tasks; spawn overhead is `O(n/G) × cost_spawn`, which grows as `G` shrinks. At `G = 1` the overhead dominates and you get a slowdown. Span barely improves — it only drops logarithmically with finer grain — so you pay linear overhead for nothing.
- **Too coarse** (`G` too large). You generate `< P` tasks, so some cores have nothing to steal — **underutilization**. Worse, with few coarse tasks the work-stealer can't fix load imbalance: one heavy task and the rest idle.
- **Sweet spot.** Choose `G` so the serial base case runs for roughly **1–10 μs** of work. That makes spawn overhead a sub-1% tax (hundreds of cycles amortized over thousands of cycles of real work) while still producing thousands of tasks — far more than `P` — so the stealer has ample work to balance. The rule of thumb: enough tasks to keep every core fed and to absorb imbalance (`≫ P`, often `8–100× P`), each large enough that overhead is negligible.

How the runtimes expose it: Java/Rust/Cilk via an explicit `CUTOFF` constant in the recursion; Rayon via `with_min_len`; TBB via `simple_partitioner` `grainsize` (or let `auto_partitioner` derive it from steal demand); OpenMP via `taskloop grainsize` or `task if(...)`; .NET via range partitioner chunk size. The practitioner discipline: **sweep `G` across a few orders of magnitude and plot the speedup** — it is a broad plateau between the too-fine slowdown and the too-coarse underutilization, and you want to land anywhere on that plateau, not at a precise optimum. When a fork-join algorithm underperforms, coarsen the grain *first*, before any other tuning.

---

## When Fork-Join Wins vs Data-Parallel

Fork-join and flat data-parallel are not interchangeable, and choosing wrong leaves performance on the table. The dividing line is **whether the load is predictable**.

**Fork-join (work-stealing) wins on irregular, recursive, unbalanced work** — where you cannot statically partition the work evenly because you don't know in advance how much each piece costs:

- **Divide-and-conquer algorithms**: quicksort/mergesort (partition sizes vary), FFT, matrix algorithms with recursive blocking, Strassen.
- **Tree and graph walks**: recursing over a tree of unknown, lopsided shape; parallel DFS; traversing a quadtree/octree/BVH where subtrees have wildly different node counts.
- **Branch-and-bound and search**: backtracking, game-tree search, constraint solving — branches prune unpredictably, so some explode and some die instantly.
- **Nested parallelism**: the standout strength. Work-stealing **composes** — you can spawn parallel work *inside* a task that is itself a spawned branch, arbitrarily deep, and the single shared pool load-balances across all levels with no nested-pool blowup. A `parallel_for` whose body calls a function that itself does a `parallel_reduce` Just Works under Rayon/TBB/ForkJoinPool, because there's one pool and one deque set, not a pool-per-level.

The common thread: when load is unpredictable, **a static split idles cores** (the unlucky core got the heavy half), but work-stealing **self-balances** — idle cores steal from busy ones at runtime, automatically, with the imbalance bounded by the span term. You over-decompose into more tasks than cores and let the stealer sort it out.

**Flat data-parallel wins on regular, balanced, dense loops** — uniform work per element, known up front:

- A `parallel_for` over an array where every iteration costs the same: `saxpy`, elementwise `map`, dense reductions ([`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md)).
- SIMD-friendly kernels: a flat loop the compiler can vectorize, ideally with no spawn tree at all between the loop and the vector unit.
- GPU-shaped work: thousands of uniform, coalesced, divergence-free lanes (dense linear algebra, convolutions) — see the SIMT discussion in [`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md).

For regular work the static split is *already* balanced, so work-stealing's dynamic load-balancing buys nothing and its per-task overhead is pure cost; a flat `parallel_for` with a sensible chunk size (or SIMD, or the GPU) is simpler and faster. Note the libraries blur the line deliberately: TBB's `parallel_for` and Rayon's `par_iter` are *built on* the work-stealing scheduler but specialized for the regular case (steal-driven splitting that barely splits when balanced) — so in practice you reach for `parallel_for`/`par_iter` for loops and the explicit `spawn`/`join`/`RecursiveTask` form for recursion and trees.

---

## Engineering Pitfalls

The `T₁/P + O(T∞)` promise is real, but a handful of production mistakes void it — and the first one is by far the most common and the most damaging.

**Never block inside a fork-join pool worker.** This is the cardinal sin. A `ForkJoinPool` (or Rayon, or TBB) has exactly `P` worker threads. If a worker does blocking I/O — a synchronous HTTP call, a JDBC query, `Thread.sleep`, a blocking queue `take()`, a lock held by off-pool code — that core is *gone* for the duration: it isn't computing and it isn't stealing. Block enough workers and the whole pool deadlocks or stalls, and because Java's **common pool is shared process-wide** (parallel streams, `CompletableFuture`, library code all use it), one blocking parallel stream can starve unrelated code. The rules: (1) keep pool workers CPU-bound; (2) for unavoidable blocking inside a `ForkJoinPool`, wrap it in a `ManagedBlocker` so the pool spawns a *compensation* thread to keep parallelism up; (3) better, run blocking work on a **separate, dedicated executor** (a cached or bounded thread pool sized for I/O concurrency), never the compute pool. Go is the exception by design — its handoff mechanism detaches the `M` on a blocking syscall and keeps the `P`'s other goroutines running — which is exactly why Go fork-join code can do I/O where the JVM/Rayon/TBB equivalents cannot.

**False sharing in the scheduler and in your accumulators.** Work-stealing deques are touched by the owner (push/pop one end) and thieves (steal the other end); a naive deque whose head and tail indices share a cache line ping-pongs that line between owner and thieves on every operation — production schedulers pad these to separate cache lines, and so must any per-worker counter you add (steal counts, per-task stats). The same false-sharing trap hits *your* fork-join code when per-task partial results land in adjacent array slots; keep each task's result in a local and write once, or pad — the cache-aware layout discipline in [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md).

**Oversubscription and nested global pools.** Sizing a pool larger than core count, or — the subtler version — running a parallel library *inside* a parallel task using a *different* framework's pool (e.g., a TBB `parallel_for` inside a `ForkJoinPool` task, each sized to `P`), gives you `P²` threads thrashing the scheduler and caches. The fix is one pool, sized to cores, shared across all nesting levels — which is exactly why work-stealing *composes* and why you should not spin up a fresh pool per recursion level. Within one framework, nested parallelism is free; across frameworks, you double-book the cores.

**Global-pool contention.** On the JVM, everything defaulting to the single common pool means a long-running parallel stream and a `CompletableFuture` chain contend for the same workers. For latency-sensitive or blocking work, create and pass an explicit `ForkJoinPool` / executor rather than riding the common pool.

**Thread-local state and steals.** A task may be **suspended at a `join` and resumed on a different worker thread** after the joined subtree was stolen and completed elsewhere — work-stealing offers no thread affinity across a join. So anything keyed to the worker thread is unsafe across spawn/join boundaries: a `ThreadLocal` read after a join may see a *different* worker's value; holding a lock across a spawn can deadlock if the continuation resumes on another worker; thread-affinity assumptions (e.g., "this code always runs on the thread that started the request") break. Keep per-task state in the task object, not in thread-locals, across any `spawn`/`sync`.

**Exception and cancellation propagation across join.** When a spawned branch throws, the exception surfaces at the `join`, not at the spawn site — and you must decide what happens to the *sibling* branch already running. `ForkJoinPool` records the exception and rethrows it (wrapped) at `join()`; sibling tasks are *not* auto-cancelled unless you call `cancel()`. Rayon propagates a panic from a `join` closure by resuming it in the caller after the other closure finishes — but a panic in one half does not stop the other half already in flight. Go's `errgroup` is the most explicit: the first error cancels a shared `context`, and well-behaved siblings observing that context stop early. The principle: design for "one branch failed while its sibling is mid-flight" — propagate via a shared cancellation token/context, and don't assume a throw unwinds the parallel siblings for you.

---

## Observability: Measuring Work, Span, and Steals

You cannot tune what you don't measure, and fork-join has a small set of high-value metrics.

**Work and span (`T₁`, `T∞`).** These are machine-independent properties of your DAG, and **Cilkscale** (OpenCilk; formerly Cilkview) computes them from a single instrumented run — actual work `T₁`, actual span `T∞`, and parallelism `T₁/T∞`. From those two numbers and Brent's bound it predicts the speedup curve: you saturate near `min(P, T₁/T∞)`. If Cilkscale reports parallelism 40 and you deploy on 64 cores, it has told you in advance that cores 41–64 sit idle on the span — go expose more parallelism (finer grain, restructure to shorten the critical path) before buying hardware. This is the single most useful measurement for a fork-join program.

**Steal counts.** Most runtimes can report successful/failed steal counts (Cilkscale, TBB's `task_scheduler` instrumentation, Go's `runtime/trace` and scheduler tracing via `GODEBUG=schedtrace=1000`, ForkJoinPool's `getStealCount()`). Theory says expected steals are `O(P·T∞)`, so a steal count *much* higher than that signals a problem: too-fine grain (every tiny task gets stolen — coarsen `G`), or pathological imbalance. A steal count *near zero* on a multi-core run means almost nothing parallelized — your grain is too coarse or the work isn't actually being spread. Steals are the scheduler's heartbeat; reading them tells you whether the stealer is balancing or thrashing.

**Pool utilization and the serial bottleneck.** Watch worker activity: a `ForkJoinPool` with `getActiveThreadCount()` stuck low, or a Go `schedtrace` showing idle `P`s, means cores are starved — usually too-coarse grain or a serial section. Find the serial bottleneck the same way as in [`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md): measure strong scaling, invert Amdahl to back out the serial fraction `f`, and profile that region (a flame graph from `perf`, VTune, async-profiler, or Go `pprof`). A worker parked in a blocking call (the cardinal-sin pitfall) shows up immediately as a thread blocked off-CPU in the profile — a fork-join worker should essentially never be off-CPU waiting on I/O.

**Profiling task granularity.** When unsure of grain, measure leaf-task duration directly (timestamp the base case in a sampled subset) and compare to the spawn cost; aim for the 1–10 μs leaf. The grain sweep in the worked example below is the cheap, decisive version of this — it *is* the measurement.

---

## Worked End-to-End: Tuned Parallel Sort

Here is a self-contained Go program: a fork-join **parallel merge sort** with a grain-size cutoff. It sweeps the cutoff to show the **too-fine** (overhead), **too-coarse** (underutilized), and **sweet-spot** regimes, reports speedup against a serial baseline, and — at the end — demonstrates the **blocking-in-pool** trap with a deliberately blocking comparator so you can see a starved-pool slowdown.

```go
package main

import (
	"fmt"
	"runtime"
	"sort"
	"sync"
	"time"
)

// parMergeSort sorts a[] into out[] by fork-join recursion with a grain cutoff.
// Below `grain`, it runs a tight SERIAL sort (no goroutine overhead).
func parMergeSort(a []int, grain int) []int {
	n := len(a)
	if n <= grain { // GRAIN-SIZE CUTOFF: serial base case
		b := make([]int, n)
		copy(b, a)
		sort.Ints(b)
		return b
	}
	mid := n / 2
	var left []int
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { // spawn: sort the left half, may run in parallel
		defer wg.Done()
		left = parMergeSort(a[:mid], grain)
	}()
	right := parMergeSort(a[mid:], grain) // continuation: right half (work-first)
	wg.Wait()                             // sync: join before merging
	return merge(left, right)             // combine
}

func merge(x, y []int) []int {
	out := make([]int, 0, len(x)+len(y))
	i, j := 0, 0
	for i < len(x) && j < len(y) {
		if x[i] <= y[j] {
			out = append(out, x[i]); i++
		} else {
			out = append(out, y[j]); j++
		}
	}
	return append(append(out, x[i:]...), y[j:]...)
}

func serialSort(a []int) []int {
	b := make([]int, len(a)); copy(b, a); sort.Ints(b); return b
}

func timeIt(f func()) time.Duration { t := time.Now(); f(); return time.Since(t) }

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	const n = 1 << 22 // ~4M ints
	data := make([]int, n)
	for i := range data {
		data[i] = (i*2654435761 + 12345) & 0x7fffffff // cheap pseudo-shuffle
	}

	base := timeIt(func() { _ = serialSort(data) })
	fmt.Printf("serial T1 = %v\n\n== Grain-size sweep (all cores) ==\n", base)

	// (1) GRAIN SWEEP: too-fine (overhead) -> sweet spot -> too-coarse (idle cores).
	for _, g := range []int{1 << 4, 1 << 8, 1 << 12, 1 << 16, 1 << 20, n} {
		d := timeIt(func() { _ = parMergeSort(data, g) })
		note := ""
		switch {
		case g <= 1<<8:
			note = "too fine: spawn overhead dominates"
		case g >= 1<<20:
			note = "too coarse: < P tasks, cores idle"
		default:
			note = "sweet spot: many tasks, low overhead"
		}
		fmt.Printf("  grain=%8d  time=%-12v  speedup=%.2fx  (%s)\n",
			g, d, float64(base)/float64(d), note)
	}

	// (2) BLOCKING-IN-POOL TRAP: a base case that blocks (here: a sleep standing in
	// for synchronous I/O) starves the scheduler — speedup collapses even at a good grain.
	fmt.Println("\n== Blocking base case (the trap) ==")
	const goodGrain = 1 << 14
	dBlock := timeIt(func() { _ = parMergeSortBlocking(data, goodGrain) })
	fmt.Printf("  blocking leaf  time=%-12v  speedup=%.2fx  (each leaf blocks -> workers parked)\n",
		dBlock, float64(base)/float64(dBlock))
}

// Same as parMergeSort but each leaf BLOCKS (simulating sync I/O inside a task).
func parMergeSortBlocking(a []int, grain int) []int {
	if len(a) <= grain {
		time.Sleep(50 * time.Microsecond) // <-- THE TRAP: blocking inside a pool task
		return serialSort(a)
	}
	mid := len(a) / 2
	var left []int
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); left = parMergeSortBlocking(a[:mid], grain) }()
	right := parMergeSortBlocking(a[mid:], grain)
	wg.Wait()
	return merge(left, right)
}
```

**What the run shows (numbers are machine-specific, the shape is not):**

1. **Too fine → overhead.** `grain ≤ 256` spawns a goroutine for almost every tiny slice; scheduling and merge-allocation overhead dominate the trivial sort work, and speedup is *below 1×* — the parallel version is slower than serial. This is the grain knob's left cliff.
2. **Too coarse → idle cores.** `grain = n` (or `2^20`) produces only a handful of tasks — fewer than cores — so most of the machine sits idle and speedup is far below the core count. This is the right cliff: the stealer has nothing to balance.
3. **Sweet spot → real speedup.** Between roughly `2^12` and `2^16` elements per leaf, each base case is a few microseconds of work, spawn overhead is a sub-percent tax, and there are thousands of tasks for the scheduler to spread — speedup climbs toward the useful multiple of cores (capped, as always for a memory-touching merge, below `P` by bandwidth and the merge's serial combine). The curve is a **broad plateau**: you aim to land on it, not at a knife-edge optimum.
4. **The blocking trap.** With the *same* good grain but a leaf that blocks (here a `Sleep` standing in for synchronous I/O), speedup collapses: each goroutine parks instead of computing. In a fixed-worker pool like `ForkJoinPool` this would *starve* the pool outright; Go's handoff softens it (it spins up threads), but the lesson stands — **a blocking base case defeats the scheduler**. In production, do the blocking work off the compute pool, or use a `ManagedBlocker`-equivalent.

In production you would call `sort.Slice` / `Arrays.parallelSort` / `rayon`'s `par_sort` / `tbb::parallel_sort` — all of which *are* this tuned fork-join sort with the cutoff baked in. The exercise exposes the mechanism: the grain plateau and the blocking trap the library handles (or warns about) for you.

---

## Decision Framework

| Situation | Reach for | Why |
|---|---|---|
| Recursive / divide-and-conquer (sort, FFT, tree/graph walk) | **Fork-join: `cilk_spawn`/`RecursiveTask`/`rayon::join`/`task_group`** | work-stealing self-balances the unpredictable load |
| Branch-and-bound, backtracking, search | **Fork-join with a cutoff** | branches prune unevenly; the stealer fills idle cores |
| Regular, uniform-cost loop over an array | **Data-parallel `parallel_for`/`par_iter`/SIMD/GPU** | static split is already balanced; spawn tree is pure overhead |
| Nested parallelism (parallel inside parallel) | **Fork-join, one shared pool** | work-stealing composes; never a pool-per-level |
| Parallel algorithm runs *slower* than serial | **Coarsen the grain size first** | too-fine tasks make spawn overhead dominate — the #1 cause |
| Speedup far below core count | **Coarsen check + steal/utilization metrics** | too-coarse grain (`< P` tasks) idles cores; measure steals |
| Picking the cutoff | **Target ~1–10 μs per leaf; sweep and plot** | sub-1% overhead, `≫ P` tasks; land on the plateau |
| C/C++ fork-join | **OpenCilk / TBB `task_group` / OpenMP `task`** | reference work-stealing; TBB `auto_partitioner` auto-grains loops |
| Java fork-join | **`RecursiveTask`/`RecursiveAction` on a pool** | `fork()` one half, recurse the other, `join()`; mind the common pool |
| Rust fork-join | **`rayon::join` / `par_iter` (`with_min_len`)** | safe by ownership; `with_min_len` is the grain knob |
| Go CPU-bound divide-and-conquer | **`go` + `WaitGroup` / `errgroup`** | the `M:N` scheduler *is* work-stealing; `errgroup` adds error+cancel |
| Blocking / I/O work | **A SEPARATE executor, never the compute pool** | blocking a pool worker starves it (except Go's handoff) |
| Must block inside a `ForkJoinPool` | **`ManagedBlocker`** | pool spawns a compensation thread to keep parallelism up |
| Predict speedup before a big run | **Cilkscale: `T₁`, `T∞` → `T₁/T∞`** | parallelism number tells you the saturation point in advance |
| Diagnosing a stalled pool | **Steal counts + utilization + flame graph** | low utilization / off-CPU workers = starvation or a serial wall |

Four rules of thumb:

1. **Use fork-join for irregular/recursive work, data-parallel for regular loops.** Work-stealing's dynamic balancing is the whole value — spend it where load is unpredictable; on a uniform loop it is pure overhead, so reach for `parallel_for`/SIMD/GPU instead.
2. **Tune the grain size before anything else.** A serial cutoff that runs the base case below a threshold is the highest-leverage knob; target ~1–10 μs of work per leaf, and sweep to land on the plateau between the too-fine slowdown and the too-coarse underutilization.
3. **Never block a pool worker.** Keep workers CPU-bound; push blocking I/O to a dedicated executor (or a `ManagedBlocker`). The one exception is Go, whose handoff detaches the thread on a blocking syscall.
4. **Measure work, span, and steals.** Cilkscale's `T₁/T∞` predicts your ceiling; steal counts and pool utilization tell you whether the stealer is balancing, thrashing (grain too fine), or starved (grain too coarse or a worker blocked).

---

## Research and System Pointers

- **Blumofe, R. D., & Leiserson, C. E. (1999). "Scheduling Multithreaded Computations by Work Stealing."** *JACM* 46(5). The `E[T_P] ≤ T₁/P + O(T∞)` bound, the `O(P·T∞)` steal count, and the `O(P·S₁)` space bound — the theorem every runtime in this file implements.
- **Frigo, M., Leiserson, C. E., & Randall, K. H. (1998). "The Implementation of the Cilk-5 Multithreaded Language."** *PLDI.* The work-first principle and the THE deque protocol — the runtime design TBB, Rayon, `ForkJoinPool`, and the rest descend from.
- **He, Y., Leiserson, C. E., & Leiserson, W. M. (2010). "The Cilkview Scalability Analyzer."** *SPAA.* Measuring `T₁` and `T∞` from one run to predict the speedup curve — now OpenCilk's Cilkscale, the observability backbone of this file.
- **Lea, D. (2000). "A Java Fork/Join Framework."** *ACM Java Grande.* The design of `ForkJoinPool` — work-stealing deques, the `join`-helps-steal mechanism, and the common pool that backs parallel streams and `CompletableFuture`.
- **The Go scheduler design (Dmitry Vyukov, "Scalable Go Scheduler Design Doc," 2012; Robert Griesemer et al.).** Per-`P` local run queues, steal-half from a random victim, the global queue, and the `M`/`P` handoff on blocking syscalls — the work-stealing core of the Go runtime.
- **Intel oneTBB documentation (Robison, Voss, Kim).** `task_group`, `parallel_for`/`parallel_reduce`, and the partitioners (`simple`/`auto`/`affinity`) — the practical grain-size automation, plus the task arena (the Blumofe–Leiserson scheduler in a library).
- **The Rayon documentation (Niko Matsakis, Josh Stone).** `join`, `par_iter`, `with_min_len`, and the global pool — fork-join made memory-safe by Rust's ownership model.
- **OpenMP 4.5+ specification, tasking chapter.** `task`, `taskwait`, `taskgroup`, `taskloop grainsize`, and the `if`-clause cutoff — irregular/recursive parallelism in OpenMP.
- **.NET Task Parallel Library documentation (Stephen Toub et al.).** `Task`, `Parallel.Invoke`/`For`, PLINQ, and the per-thread-local-queue work-stealing thread pool.

---

## Key Takeaways

1. **Every runtime here is one work-stealing scheduler in different clothes.** Cilk/OpenCilk (the reference), TBB, Java's `ForkJoinPool` (behind `parallelStream`/`CompletableFuture`), Rust Rayon, .NET TPL, and — crucially — the **Go `M:N` goroutine scheduler** all realize Blumofe–Leiserson: per-worker deques, LIFO-own/FIFO-steal (steal-half in Go), `E[T_P] ≤ T₁/P + O(T∞)`. You write `spawn`/`sync`; the runtime maps the DAG.
2. **Grain size is the knob that matters most.** A serial base-case cutoff turns a 0.1× slowdown (too fine: spawn overhead dominates) or an idle machine (too coarse: `< P` tasks) into real speedup. Target ~1–10 μs of work per leaf — sub-1% overhead, `≫ P` tasks — and sweep to land on the broad plateau. Knobs: explicit `CUTOFF`, Rayon `with_min_len`, TBB `auto_partitioner`/`grainsize`, OpenMP `taskloop grainsize` / `task if`.
3. **Fork-join wins on irregular/recursive/unbalanced work; data-parallel wins on regular loops.** Divide-and-conquer, tree/graph walks, branch-and-bound, and nested parallelism need the stealer's dynamic self-balancing; uniform dense loops want `parallel_for`/SIMD/GPU, where work-stealing is pure overhead. Nested parallelism composing under one shared pool is fork-join's standout strength.
4. **The cardinal pitfall is blocking a pool worker.** A blocked worker is a lost core; in a shared pool (Java's common pool) it starves unrelated code. Push blocking I/O to a separate executor or use a `ManagedBlocker`; Go's handoff is the lone exception. Also: pad the deque/accumulators against false sharing, don't oversubscribe or nest mismatched pools, never trust a `ThreadLocal` across a join (a task may resume on another worker), and propagate failure across siblings via a shared cancellation token (`errgroup`/context), not by assuming a throw unwinds them.
5. **Measure work, span, and steals.** Cilkscale computes `T₁`, `T∞`, `T₁/T∞` from one run and predicts your saturation point; steal counts and pool utilization reveal thrashing (grain too fine), starvation (too coarse or a blocked worker), and the serial bottleneck — find it by inverting Amdahl and profiling, exactly as in [`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md).
6. **In production you call the tuned version.** `Arrays.parallelSort`, `rayon`'s `par_sort`, `tbb::parallel_sort`, parallel streams, and `par_iter().reduce()` are all this fork-join pattern with the cutoff and the false-sharing-safe combine baked in. Reach for the explicit `spawn`/`join`/`RecursiveTask` form when you have genuine recursion or a tree the library iterators don't fit.

---

> **See also:** [`./senior.md`](./senior.md) for the theory this tier implements — the series-parallel DAG, the Blumofe–Leiserson work-stealing theorem, the work-first principle, and the THE deque protocol · [`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md) for work–span as the framework-independent design contract, the scaling curves, and finding the serial bottleneck · [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md) for the reduce/map primitives whose balanced trees these schedulers run, and the false-sharing-safe two-level reduce · [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md) for the cache-line padding that protects the deque and per-task accumulators from false sharing
