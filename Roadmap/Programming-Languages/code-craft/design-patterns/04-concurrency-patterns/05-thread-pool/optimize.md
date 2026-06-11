# Thread Pool — Optimization

> Ten before/after walkthroughs that make thread-pool code faster, safer, or more scalable. Each gives the problem, the fix, why it works, and the trade-off. Concepts: [middle.md](middle.md) → [professional.md](professional.md).

## Table of Contents

1. [Right-size for the workload](#1-right-size-for-the-workload)
2. [Bound the queue to expose overload](#2-bound-the-queue-to-expose-overload)
3. [Batch tiny tasks to amortize handoff](#3-batch-tiny-tasks-to-amortize-handoff)
4. [Switch to ForkJoinPool for divide-and-conquer](#4-switch-to-forkjoinpool-for-divide-and-conquer)
5. [Replace blocking `get()` with non-blocking composition](#5-replace-blocking-get-with-non-blocking-composition)
6. [Prestart core threads to kill cold-start latency](#6-prestart-core-threads-to-kill-cold-start-latency)
7. [Bulkhead to stop cross-workload starvation](#7-bulkhead-to-stop-cross-workload-starvation)
8. [Add backpressure instead of buffering](#8-add-backpressure-instead-of-buffering)
9. [Migrate blocking I/O to virtual threads](#9-migrate-blocking-io-to-virtual-threads)
10. [Eliminate queue-lock contention](#10-eliminate-queue-lock-contention)
11. [Optimization Tips](#optimization-tips)

---

## 1. Right-size for the workload

**Before:** `Executors.newFixedThreadPool(200)` for CPU-bound serialization on an 8-core box.
**Problem:** 200 runnable threads on 8 cores means constant context switching; throughput is *lower* than with 8, and latency jitters.
**After:** `new ThreadPoolExecutor(8, 8, ...)` (≈ `N_cores`) for the CPU work.
**Why:** CPU-bound throughput peaks at the core count; extra threads only add scheduler overhead and cache thrash.
**Trade-off:** Less headroom for the occasional blocking call mixed in — if any blocking sneaks in, split it to a separate IO-sized pool rather than oversizing the CPU pool.

---

## 2. Bound the queue to expose overload

**Before:** Unbounded `LinkedBlockingQueue`; under load the queue grows to millions of entries, latency climbs, eventually OOM.
**Problem:** The queue absorbs overload invisibly. The system *looks* healthy (low error rate) while tail latency explodes, then dies.
**After:** `new ArrayBlockingQueue<>(capacity)` sized from Little's Law, plus a rejection policy.
**Why:** A bounded queue makes overload *visible* (rejections, a measurable depth) instead of hiding it behind growing latency. You can alert on queue depth and rejection rate.
**Trade-off:** You now reject work under extreme load — which is correct (shed load deliberately) but requires the caller to handle rejection.

---

## 3. Batch tiny tasks to amortize handoff

**Before:** Submitting one task per element for a 10-million-element array; each task does microseconds of work.
**Problem:** Queue enqueue/dequeue + lock acquisition costs more than the task itself. You spend most time in `BlockingQueue.take`, not computing.
**After:** Submit chunks (e.g., 10,000 elements per task), so per-task work dwarfs handoff cost.
**Why:** Coarser granularity moves the time-in-handoff ratio from dominant to negligible; fewer queue operations, less lock contention.
**Trade-off:** Coarser chunks reduce load-balancing flexibility — a few oversized chunks can leave some workers idle at the tail. Tune chunk size against worker count.

---

## 4. Switch to ForkJoinPool for divide-and-conquer

**Before:** Recursive parallel work on a `ThreadPoolExecutor` with a shared queue; uneven subtasks leave some workers idle while others are swamped.
**Problem:** The shared queue is a single lock (scalability ceiling) and gives no load balancing for uneven subtrees.
**After:** `ForkJoinPool` with `RecursiveTask` and a sequential threshold.
**Why:** Per-worker deques are lock-free; idle workers **steal** from busy ones, keeping all cores saturated despite uneven work. `join()` help-steals instead of idling, dodging pool-induced deadlock.
**Trade-off:** Only helps for *divide-and-conquer CPU* work; blocking I/O inside FJ tasks starves the pool (wrap in `ManagedBlocker`). Pick a good sequential threshold — too small and fork overhead dominates.

---

## 5. Replace blocking `get()` with non-blocking composition

**Before:**
```java
Future<A> fa = pool.submit(this::stepA);
A a = fa.get();                       // worker/caller blocks
Future<B> fb = pool.submit(() -> stepB(a));
B b = fb.get();                       // blocks again
```
**Problem:** Each `get()` parks a thread; chained on the pool, this wastes workers and risks pool-induced deadlock.
**After:**
```java
CompletableFuture.supplyAsync(this::stepA, pool)
    .thenApplyAsync(this::stepB, pool)
    .thenAccept(this::consume);
```
**Why:** Stages chain via callbacks; no thread parks waiting for a result. Higher worker utilization and no same-pool deadlock.
**Trade-off:** Callback-style code is harder to read and debug than straight-line blocking code; exception handling moves into `exceptionally`/`handle`.

---

## 6. Prestart core threads to kill cold-start latency

**Before:** Pool created lazily; the first burst of requests each pays thread-creation cost, spiking p99 on cold deploys.
**Problem:** Core threads aren't created until tasks arrive, so the first N tasks each trigger a thread creation (syscall + stack alloc) on the critical path.
**After:** `pool.prestartAllCoreThreads();` at startup.
**Why:** Workers are warm and waiting before the first request; the cold-start latency spike disappears.
**Trade-off:** Slightly higher idle resource use at startup and you pay creation cost up front — negligible versus the latency win for latency-sensitive services.

---

## 7. Bulkhead to stop cross-workload starvation

**Before:** One shared pool of 50 serves cache (1 ms), search (20 ms), and a flaky payment API (up to 5 s).
**Problem:** When payment degrades, all 50 threads park on payment calls; cache and search starve and time out despite being healthy — cascading failure.
**After:** Separate `cachePool`, `searchPool`, `paymentPool`, each sized and bounded independently.
**Why:** A payment outage saturates only its compartment; unrelated workloads keep their own threads. The blast radius shrinks from system-wide to one feature.
**Trade-off:** Lower total utilization (each pool reserves idle threads) and more pools to tune. Worth it whenever a dependency can fail independently.

---

## 8. Add backpressure instead of buffering

**Before:** Large bounded queue + `AbortPolicy`; under spikes the producer hammers the pool, gets a flood of `RejectedExecutionException`, and either drops work or retries in a tight loop.
**Problem:** No feedback to the producer until rejection; the failure is abrupt and bursty.
**After:** `CallerRunsPolicy` (or a `Semaphore` gating submission).
**Why:** When saturated, the *submitting* thread runs the task itself, so it physically can't submit more until done — the producer auto-throttles to the pool's real rate. Smooth degradation instead of a rejection cliff.
**Trade-off:** The submitting thread's latency rises under load (it's doing work), and during shutdown caller-runs tasks are discarded. For request threads, this couples upstream latency to pool saturation — sometimes a semaphore-gated `Abort` with explicit shedding is cleaner.

---

## 9. Migrate blocking I/O to virtual threads

**Before:** `ThreadPoolExecutor(200, 200, ...)` for a thread-per-request server doing blocking HTTP/DB calls; can't push past ~200 concurrent without ~200 MB of stacks and heavy scheduling.
**Problem:** Platform threads are expensive (~1 MB stack each); the pool caps real concurrency far below what the I/O could sustain.
**After:** `Executors.newVirtualThreadPerTaskExecutor()` + a `Semaphore` on each downstream.
**Why:** Virtual threads unmount their carrier on blocking I/O, so one-per-task scales to tens of thousands of concurrent blocking operations with tiny memory cost. The semaphore re-imposes the downstream resource cap that pool size used to provide.
**Trade-off:** Java 21+ only; watch for `synchronized` **pinning** (replace with `ReentrantLock` on hot blocking paths) and remember virtual threads don't help CPU-bound work.

---

## 10. Eliminate queue-lock contention

**Before:** A single `ThreadPoolExecutor` with 64 workers and `ArrayBlockingQueue` under a very high submission rate; profiler shows hot time in `ReentrantLock` / `AbstractQueuedSynchronizer` on the queue.
**Problem:** Every submit and every take contends on one queue lock — the scalability ceiling. Throughput plateaus then declines as workers grow.
**After:** Either (a) `LinkedBlockingQueue` (separate put/take locks → producers and consumers don't contend) for higher submission throughput, or (b) move to per-worker deques (`ForkJoinPool`) where most operations are lock-free.
**Why:** Splitting or removing the single lock raises the contention ceiling; `ForkJoinPool`'s deques touch only the owner except on rare steals.
**Trade-off:** `LinkedBlockingQueue` allocates a node per task (GC pressure, worse cache locality) and must be bounded explicitly. `ForkJoinPool` changes the programming model (fork/join, not plain submit) and is best for CPU work.

---

## Optimization Tips

- **Measure before tuning.** Profile for time-in-`take`/`get`, watch `getActiveCount`, `getQueue().size()`, `getCompletedTaskCount`, and rejection counts. Optimize the bottleneck the data shows, not the one you guess.
- **Classify the workload first.** CPU-bound vs IO-bound dictates *everything* — size, queue, and whether virtual threads apply. Optimizing a pool without knowing this is guessing.
- **The downstream is often the real limit.** Adding pool threads in front of a 20-connection DB pool just moves the queue. Size to the tightest resource on the path.
- **Latency lives in the tail.** Optimize p99/p999, not the mean; a pool's pathology (queue wait, GC pause, lock contention) hides in the tail.
- **Backpressure beats buffering** for sustained overload; buffering only beats backpressure for short, absorbable bursts.
- **Reach for virtual threads** when the IO-bound size formula yields hundreds — but keep an explicit concurrency cap on every downstream.
- **Re-validate after every workload change.** Pool config is workload-specific; last quarter's optimal size is this quarter's incident.
