# Thread Pool — Practice Tasks

> Hands-on exercises for the **Thread Pool** pattern, easy → hard. Each task has a goal, requirements, hints, and a solution sketch. Work in [junior.md](junior.md)/[middle.md](middle.md) first; tasks 7–10 lean on [senior.md](senior.md)/[professional.md](professional.md).

## Table of Contents

1. [Task 1 — Build a fixed pool and prove reuse](#task-1--build-a-fixed-pool-and-prove-reuse)
2. [Task 2 — Submit and collect results with Future](#task-2--submit-and-collect-results-with-future)
3. [Task 3 — Refactor thread-per-request to a bounded pool](#task-3--refactor-thread-per-request-to-a-bounded-pool)
4. [Task 4 — Demonstrate the unbounded-queue trap](#task-4--demonstrate-the-unbounded-queue-trap)
5. [Task 5 — Implement all four rejection policies](#task-5--implement-all-four-rejection-policies)
6. [Task 6 — Build a Go worker pool with results](#task-6--build-a-go-worker-pool-with-results)
7. [Task 7 — Size an IO-bound pool with the Goetz formula](#task-7--size-an-io-bound-pool-with-the-goetz-formula)
8. [Task 8 — Reproduce and fix pool-induced deadlock](#task-8--reproduce-and-fix-pool-induced-deadlock)
9. [Task 9 — Bulkhead two dependencies](#task-9--bulkhead-two-dependencies)
10. [Task 10 — Migrate an IO pool to virtual threads](#task-10--migrate-an-io-pool-to-virtual-threads)
11. [How to Practice](#how-to-practice)

---

## Task 1 — Build a fixed pool and prove reuse

**Goal:** Show that a thread pool *reuses* threads rather than creating one per task.

**Requirements:**
- Submit 1,000 tasks to a 4-thread pool.
- Each task records `Thread.currentThread().getName()`.
- Assert that only 4 distinct thread names appear.

**Hints:** Collect names in a `ConcurrentHashMap.newKeySet()`. Shut down and `awaitTermination` before asserting.

<details><summary>Solution sketch</summary>

```java
ExecutorService pool = Executors.newFixedThreadPool(4);
Set<String> names = ConcurrentHashMap.newKeySet();
for (int i = 0; i < 1000; i++) pool.submit(() -> names.add(Thread.currentThread().getName()));
pool.shutdown(); pool.awaitTermination(10, TimeUnit.SECONDS);
assert names.size() == 4;   // exactly the 4 reused workers
```
The 1,000 tasks ran on only 4 threads — that's reuse, the cost-amortization half of the pattern.
</details>

---

## Task 2 — Submit and collect results with Future

**Goal:** Fan out N computations, fan in the results.

**Requirements:**
- Submit 50 `Callable<Integer>` tasks (return `i * i`).
- Collect results in submission order; handle `ExecutionException`.

**Hints:** Keep `Future`s in a `List`; loop and `get()`. Unwrap `e.getCause()` on failure.

<details><summary>Solution sketch</summary>

```java
List<Future<Integer>> fs = new ArrayList<>();
for (int i = 0; i < 50; i++) { final int n = i; fs.add(pool.submit(() -> n * n)); }
List<Integer> out = new ArrayList<>();
for (Future<Integer> f : fs)
    try { out.add(f.get()); }
    catch (ExecutionException e) { log.error("task failed", e.getCause()); }
```
Order is preserved because you iterate the `Future` list in submission order, not completion order.
</details>

---

## Task 3 — Refactor thread-per-request to a bounded pool

**Goal:** Cap concurrency on a server that currently spawns a thread per connection.

**Starting code:**
```java
while (true) {
    Socket conn = server.accept();
    new Thread(() -> handle(conn)).start();   // unbounded
}
```

**Requirements:**
- Replace with a bounded `ThreadPoolExecutor` (bounded queue, named threads, a rejection policy).
- Under a flood of 10,000 connections, prove the live thread count never exceeds `maximumPoolSize`.

**Hints:** Track `pool.getPoolSize()` / `getLargestPoolSize()`. Use `CallerRunsPolicy` to avoid dropping connections while throttling.

<details><summary>Solution sketch</summary>

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    16, 64, 60, TimeUnit.SECONDS, new ArrayBlockingQueue<>(256),
    named("conn"), new ThreadPoolExecutor.CallerRunsPolicy());
while (true) {
    Socket conn = server.accept();
    pool.execute(() -> { try (conn) { handle(conn); } catch (IOException e) { log.warn("", e); } });
}
// After the flood: assert pool.getLargestPoolSize() <= 64
```
`getLargestPoolSize()` is the high-water mark; it stays ≤ max regardless of load — the survival guarantee.
</details>

---

## Task 4 — Demonstrate the unbounded-queue trap

**Goal:** Prove that an unbounded queue makes `maximumPoolSize` meaningless.

**Requirements:**
- Create a `ThreadPoolExecutor` with `core=2`, `max=10`, **`LinkedBlockingQueue` (unbounded)**.
- Submit slow tasks faster than they complete; record `getLargestPoolSize()`.
- Show it stays at 2 even though max is 10, and the queue grows unboundedly.

**Hints:** Each task sleeps; submit thousands quickly. Watch `getQueue().size()` climb.

<details><summary>Solution sketch</summary>

The pool never creates worker #3 because the unbounded queue is never full, so growth step 3 (queue full → grow to max) never fires. `getLargestPoolSize()` == 2; `getQueue().size()` rises without limit. Swap to `new ArrayBlockingQueue<>(100)` and `getLargestPoolSize()` climbs toward 10 once the queue fills — proving the growth rule and the trap in one experiment.
</details>

---

## Task 5 — Implement all four rejection policies

**Goal:** Feel each saturation policy's behavior.

**Requirements:**
- Tiny pool (`core=max=1`, `ArrayBlockingQueue(1)`).
- Submit 5 tasks rapidly under each of `AbortPolicy`, `CallerRunsPolicy`, `DiscardPolicy`, `DiscardOldestPolicy`.
- Record which tasks run, which are dropped, and which throw.

**Hints:** Wrap submission in try/catch to observe `RejectedExecutionException` under `AbortPolicy`.

<details><summary>Solution sketch</summary>

- **Abort:** task 1 runs, task 2 queues, tasks 3–5 throw `RejectedExecutionException`.
- **CallerRuns:** rejected tasks run on the *submitting* thread (submission blocks while they run) — no loss, but the producer is throttled.
- **Discard:** rejected tasks vanish silently (no exception, no run).
- **DiscardOldest:** the queued task is evicted and replaced by the newcomer — newest-wins.

The lesson: the policy *is* your overload contract. Choose it consciously.
</details>

---

## Task 6 — Build a Go worker pool with results

**Goal:** Implement the pattern from primitives in Go.

**Requirements:**
- N worker goroutines drain a `jobs` channel.
- Results flow back on a `results` channel; collect all of them.
- Graceful shutdown: close `jobs`, wait for workers via `sync.WaitGroup`, then close `results`.

**Hints:** Use a buffered `jobs` channel as the bounded queue. Close `results` only after `wg.Wait()`.

<details><summary>Solution sketch</summary>

See the full implementation in [middle.md](middle.md) §5 (Go example). Key correctness points: (1) close `jobs` to signal "no more work" so `for range` exits; (2) a separate goroutine does `wg.Wait(); close(results)` so the result range terminates; (3) the buffer size on `jobs` is your bounded queue.
</details>

---

## Task 7 — Size an IO-bound pool with the Goetz formula

**Goal:** Compute a defensible pool size, then validate it.

**Requirements:**
- Given: 16 cores, target CPU utilization 0.9, tasks that wait 180 ms (network) and compute 20 ms.
- Compute `N = N_cores × U × (1 + W/C)`.
- Load-test at that size; watch queue depth and p99 latency; adjust.

**Hints:** `W/C = 180/20 = 9`.

<details><summary>Solution sketch</summary>

`N = 16 × 0.9 × (1 + 9) = 16 × 0.9 × 10 = 144` threads. Validate with a load test: if queue depth stays near zero and CPU sits near 90%, the size is right. If queue grows, either the downstream is the bottleneck (more threads won't help — they'll just queue inside the DB pool) or arrival rate exceeds capacity (Little's Law: `λ` too high for this `W`). 144 is also a hint that virtual threads would remove the sizing problem entirely.
</details>

---

## Task 8 — Reproduce and fix pool-induced deadlock

**Goal:** Make a pool deadlock itself, then fix it three ways.

**Requirements:**
- Pool of size 2. Submit 2 tasks; each submits an inner task to the *same* pool and calls `get()`.
- Observe the deadlock (no progress, both workers blocked).
- Fix with: (a) a separate inner pool, (b) `CompletableFuture.thenApplyAsync`, (c) restructuring to not block a worker.

**Hints:** A thread dump shows both workers parked in `FutureTask.get`.

<details><summary>Solution sketch</summary>

The two outer tasks occupy both workers and block on `get()`; the two inner tasks sit in the queue with no free worker → deadlock. Fixes: **(a)** route inner tasks to `innerPool` so an idle worker runs them; **(b)** `supplyAsync(step1, pool).thenApplyAsync(step2, pool)` never parks a worker on `get()`; **(c)** compute the inner work inline instead of submitting-and-waiting. See [senior.md](senior.md) §4 and §7.
</details>

---

## Task 9 — Bulkhead two dependencies

**Goal:** Prove that isolated pools contain a dependency failure.

**Requirements:**
- One service calls a fast `cache` and a slow `payment` dependency.
- Version A: shared pool of 8. Version B: separate `cachePool(8)` and `paymentPool(4)`.
- Inject a 5-second latency into `payment`; measure cache request latency under both versions.

**Hints:** Drive concurrent load at both dependencies; record cache p99.

<details><summary>Solution sketch</summary>

In Version A, payment's latency parks all 8 shared threads; cache p99 explodes (or times out) despite cache itself being instant — cascading failure. In Version B, payment saturates only its 4-thread compartment; cache requests keep their own 8 threads and stay fast. The bulkhead turned a service-wide outage into a payment-only degradation. Add a circuit breaker on `payment` to fail fast once its pool is clearly overwhelmed.
</details>

---

## Task 10 — Migrate an IO pool to virtual threads

**Goal:** Replace a large platform-thread IO pool with virtual threads, keeping the downstream cap.

**Requirements:**
- Start from a `ThreadPoolExecutor(144, 144, ...)` serving blocking HTTP calls (from Task 7).
- Replace with `Executors.newVirtualThreadPerTaskExecutor()`.
- Re-introduce the downstream concurrency cap with a `Semaphore` (the DB allows 20 connections).
- Verify at most 20 concurrent DB calls despite thousands of virtual threads.

**Hints:** `Semaphore(20)`; acquire/release around the DB call. Check for `synchronized` pinning with `-Djdk.tracePinnedThreads=full`.

<details><summary>Solution sketch</summary>

```java
ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();
Semaphore dbLimit = new Semaphore(20);
pool.submit(() -> {
    dbLimit.acquire();
    try { return queryDb(); } finally { dbLimit.release(); }
});
```
The virtual-thread executor removes the *thread* limit; the semaphore re-imposes the *resource* limit. If `tracePinnedThreads` reports pinning, replace `synchronized` blocks on the blocking path with `ReentrantLock`. See [senior.md](senior.md) §11 and [professional.md](professional.md) §4.
</details>

---

## How to Practice

- **Always measure, don't assume.** Print `getPoolSize`, `getLargestPoolSize`, `getQueue().size()`, `getCompletedTaskCount`, and rejection counts. The numbers teach the growth rule and the trap faster than reading does.
- **Reproduce failures on purpose.** Deliberately cause OOM (unbounded queue), deadlock (same-pool `get()`), and starvation (shared pool + slow dependency) in small programs. Engineers who've *seen* these recognize them instantly in production.
- **Tune against a load generator,** not a single run. The queue-lock cliff and tail-latency blowups only appear under concurrency.
- **Diff platform vs virtual threads** on the same IO workload at 10k concurrency to feel why Loom changes the calculus.
- **Write the assertions first** (max thread count, max concurrent downstream calls) so each task proves a property, not just "it ran."
