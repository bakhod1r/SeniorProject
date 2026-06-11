# Thread Pool — Interview Questions

> Graded Q&A for the **Thread Pool** concurrency pattern. Builds on [junior.md](junior.md) → [professional.md](professional.md). Model answers included; read the question, answer aloud, then check.

## Table of Contents

1. [Junior Questions](#1-junior-questions)
2. [Middle Questions](#2-middle-questions)
3. [Senior Questions](#3-senior-questions)
4. [Professional Questions](#4-professional-questions)
5. [Coding Tasks](#5-coding-tasks)
6. [Trick Questions](#6-trick-questions)
7. [Behavioral / Architectural Questions](#7-behavioral--architectural-questions)
8. [Tips for Answering](#8-tips-for-answering)

---

## 1. Junior Questions

**Q1. What is a thread pool and what two problems does it solve?**
A bounded set of reusable worker threads that pull tasks from a shared queue. It (1) **amortizes thread-creation cost** by reusing warm threads, and (2) — more importantly — **caps concurrency** so load can't spawn unlimited threads and crash the machine. Under overload the second property is what matters: it trades latency (work queues) for survival.

**Q2. Name the five participants in the pattern.**
Task (`Runnable`/`Callable`), work queue (usually a `BlockingQueue`), worker threads, pool manager (`ExecutorService`), and the saturation/rejection policy.

**Q3. What's the difference between `submit` and `execute`?**
`execute(Runnable)` returns `void`; an exception goes to the thread's uncaught-exception handler and is easily lost. `submit(...)` returns a `Future` and *captures* any exception inside it, re-thrown (wrapped in `ExecutionException`) when you call `get()`. If you submit and never call `get()`, the exception is silently swallowed.

**Q4. Why is `Executors.newFixedThreadPool` risky in production?**
It uses an **unbounded** `LinkedBlockingQueue`. Under sustained overload the queue grows until the heap is exhausted (`OutOfMemoryError`). Because the queue is never full, the pool also never grows past core size — so any `maximumPoolSize` is moot. Build a `ThreadPoolExecutor` with a bounded queue instead.

---

## 2. Middle Questions

**Q5. How do you size a thread pool? (graded: junior says "trial and error"; strong answer below)**
Depends on the workload. **CPU-bound:** ≈ number of cores (`N_cores`, sometimes +1) — more threads just add context-switch overhead. **IO-bound:** use Brian Goetz's formula `N = N_cores × U_cpu × (1 + W/C)` where `W` is wait time and `C` is compute time per task; high wait/compute ratios justify many threads. Sanity-check capacity with Little's Law `L = λ × W` to find the minimum busy workers to keep up. Then load-test and tune to observed queue depth and latency.

**Q6. Walk through `ThreadPoolExecutor`'s growth rule.**
(1) If workers < core, create a worker. (2) If core is full but the queue isn't, **enqueue** — the counterintuitive step. (3) If the queue is full and workers < max, create a worker up to max. (4) If the queue is full *and* at max, invoke the rejection policy. The surprise: the queue fills *before* the pool grows past core, so with a huge queue you rarely reach max size.

**Q7. Compare the three standard queue types.**
`SynchronousQueue` — zero capacity, direct hand-off; forces immediate thread growth or rejection (used by `newCachedThreadPool`). `ArrayBlockingQueue(n)` — bounded; the production default, with an explicit overload point. `LinkedBlockingQueue` — unbounded by default; the classic OOM trap that makes `maximumPoolSize` a lie.

**Q8. What does `CallerRunsPolicy` do and why is it useful?**
When the pool is saturated, the task runs on the *submitting* thread instead of being rejected. The submitter is now busy and can't submit more work — automatic **backpressure** that throttles the producer to the pool's actual capacity. Caveat: during shutdown the task is discarded, not run.

---

## 3. Senior Questions

**Q9. Explain pool-induced deadlock and how to avoid it.**
A task running on the pool submits a subtask to the *same* pool and blocks on `Future.get()`. With a bounded pool, if all workers are blocked waiting for subtasks that have no free worker to run, the pool deadlocks at 100% busy / 0% progress. Avoid by: using a *separate* pool for dependent inner work; using non-blocking composition (`CompletableFuture.thenCompose`) so no worker parks; or never calling `get()` from a pool thread on the same pool. `ForkJoinPool` sidesteps this because `join()` help-steals instead of blocking idle.

**Q10. What's the bulkhead pattern and what failure does it prevent?**
Give each subsystem/dependency its own pool. It prevents **cascading failure via shared-pool exhaustion**: if a shared pool serves both a fast cache and a slow flaky API, the API's latency parks every thread, starving cache requests that would have returned in 1 ms. Separate pools confine the saturation to the failing dependency. Cost: lower total utilization (idle reserves) and more tuning surface. Pair with circuit breakers and timeouts.

**Q11. When is a thread pool the *wrong* tool?**
For massively concurrent *blocking* I/O on the JVM: the Goetz formula yields thousands of threads, and platform threads cost ~1 MB of stack each — you can't reach the needed concurrency. Use virtual threads (Loom) instead. Also wrong for a single indivisible task (no parallelism), and for divide-and-conquer where `ForkJoinPool`'s work-stealing balances uneven subtasks better.

---

## 4. Professional Questions

**Q12. How does virtual-thread migration change pool design?**
Virtual threads make threads cheap (unmount their carrier on blocking I/O), dissolving the *sizing* problem for blocking workloads — one virtual thread per task, no pool tuning. But they remove the *thread* limit, not the *resource* limit: you still must cap concurrency on downstreams with an explicit `Semaphore` or rate limiter. CPU-bound work still needs a bounded platform pool. Watch for **pinning**: a virtual thread inside a `synchronized` block can't unmount and holds its carrier — replace with `ReentrantLock` on hot blocking paths.

**Q13. Why does `ForkJoinPool` scale better than `ThreadPoolExecutor` for parallel compute?**
`ThreadPoolExecutor` funnels every submit/take through one shared queue lock — the scalability ceiling. `ForkJoinPool` gives each worker its own lock-free deque: owners push/pop their own bottom (LIFO, cache-warm), idle workers steal from a victim's top (FIFO). Contention occurs only on steals, which are rare with balanced work. Plus `join()` help-steals other tasks instead of idling.

**Q14. What memory-visibility guarantees does an executor give you?**
`submit(task)` *happens-before* the worker runs it (writes before submit are visible in the task); task completion *happens-before* `Future.get()` returns (results and side effects visible to the caller). So passing a mutable object into `submit` and reading it out of `get()` needs no extra synchronization — the queue handoff and `FutureTask`'s volatile-published result already fence it.

---

## 5. Coding Tasks

**T1.** Implement a fixed-size worker pool in Go using channels (no library), supporting result collection and graceful shutdown. *(See the worker-pool example in [middle.md](middle.md).)*

**T2.** Given a `new Thread(...)`-per-request loop, refactor to a bounded `ThreadPoolExecutor` and demonstrate the thread count stays capped under a flood. *(See [tasks.md](tasks.md) #3.)*

**T3.** Write a parallel sum over a large array using `ForkJoinPool`/`RecursiveTask` with a sequential threshold. Explain why the threshold matters. *(Below the threshold, fork overhead exceeds the work saved.)*

**T4.** Implement a bounded-concurrency downstream caller using virtual threads + a `Semaphore`, proving at most K concurrent calls. *(See [senior.md](senior.md) §11.)*

---

## 6. Trick Questions

**TQ1. "`maximumPoolSize` is 50 but the pool never exceeds 5 threads under heavy load. Why?"**
The queue is unbounded (or very large). Per the growth rule, the pool only creates threads beyond core size when the queue is *full*; an unbounded queue is never full, so it stays at `corePoolSize`. `maximumPoolSize` is dead config.

**TQ2. "Does a bigger pool always increase throughput?"**
No. For CPU-bound work, past `N_cores` you add context-switching overhead; throughput plateaus then declines. For IO-bound work it helps up to the point the downstream resource (DB connections) becomes the bottleneck — then extra threads just queue elsewhere.

**TQ3. "Should you pool virtual threads for reuse?"**
No — virtual threads are cheap to create and not meant to be pooled. Use `newVirtualThreadPerTaskExecutor()` (one per task). Pool only when you specifically need to *bound concurrency*, and even then prefer a semaphore over a thread pool.

**TQ4. "A `parallelStream()` in one part of the app slowed down an unrelated `parallelStream()` elsewhere. How?"**
Both use the shared `ForkJoinPool.commonPool()`. A blocking or long task in one starves the common pool, degrading every parallel stream in the JVM. Give CPU-heavy/blocking parallel work its own `ForkJoinPool`.

---

## 7. Behavioral / Architectural Questions

**B1. "Describe a production incident caused by a thread pool."**
Strong answer names a *specific* failure mode: unbounded-queue OOM, shared-pool exhaustion cascading across features, or pool-induced deadlock under a rare call pattern. Explain detection (queue-depth/rejection metrics, thread dump showing all workers blocked on the same `get()`), the fix (bound the queue / bulkhead / separate inner pool), and the guardrail added (metrics + alert on queue depth and rejection rate).

**B2. "How would you design the thread-pool topology for a request-serving service calling three dependencies?"**
A bounded front-door request pool, plus one isolated pool per dependency (bulkheads), each sized from its dependency's capacity (e.g., the DB connection-pool size). Identify the tightest resource on each path as the real limit. Add circuit breakers + timeouts + fallbacks per dependency, and expose active-count/queue-depth/rejection metrics. Justify the efficiency-vs-isolation trade explicitly.

**B3. "How do you make pool-using code testable?"**
Inject the `Executor` as a dependency; in tests inject a same-thread executor (`Runnable::run`) for deterministic execution. Test saturation explicitly with a tiny pool + `AbortPolicy`. Verify shutdown with bounded `awaitTermination` and a thread-count check.

---

## 8. Tips for Answering

- **Lead with intent, then mechanics.** "It caps concurrency to protect the machine" before reciting constructor arguments.
- **Always mention the unbounded-queue trap** when `newFixedThreadPool` comes up — interviewers are listening for it.
- **Show you size with a formula**, not vibes: cite `N_cores` for CPU, `N_cores × U × (1 + W/C)` for IO, Little's Law as the sanity check.
- **Name the failure modes precisely:** unbounded-queue OOM, pool-induced deadlock, shared-pool exhaustion. Vague "it can be slow" answers read as junior.
- **Reach for virtual threads** when asked about high-concurrency blocking I/O — but immediately add "still bound the downstream with a semaphore."
- **Draw the growth rule** if allowed; explaining "the queue fills before the pool grows" demonstrates real understanding.
