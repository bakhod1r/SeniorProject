# Active Object — Hands-On Tasks

> Ten graded, runnable exercises. Build them in order; each adds one production
> concern. Reference material: [junior](junior.md) · [middle](middle.md) ·
> [senior](senior.md) · [professional](professional.md).

## Table of Contents

1. [Task 1: Minimal Active Object](#task-1-minimal-active-object)
2. [Task 2: Convert a `synchronized` class](#task-2-convert-a-synchronized-class)
3. [Task 3: Bounded queue + backpressure](#task-3-bounded-queue--backpressure)
4. [Task 4: Graceful shutdown with draining](#task-4-graceful-shutdown-with-draining)
5. [Task 5: Guard-based bounded buffer](#task-5-guard-based-bounded-buffer)
6. [Task 6: Compose two Active Objects (transfer)](#task-6-compose-two-active-objects-transfer)
7. [Task 7: Sharded Active Objects](#task-7-sharded-active-objects)
8. [Task 8: Batching scheduler](#task-8-batching-scheduler)
9. [Task 9: Supervised (self-restarting) Active Object](#task-9-supervised-self-restarting-active-object)
10. [Task 10: Active Object in Go](#task-10-active-object-in-go)
11. [How to Practice](#how-to-practice)

---

## Task 1: Minimal Active Object

**Goal.** Build the smallest correct Active Object and prove its single-thread
guarantee.

**Requirements.**
- A `CounterServant` with `inc()` and `get()` (no synchronization).
- A `Counter` proxy backed by a `SingleThreadExecutor`; methods return `Future`.
- From 50 threads, call `inc()` 20,000 times each; assert final value is exactly
  1,000,000.

**Hints.** The servant must have *no* `synchronized`/`Atomic*` — correctness comes
from the single thread. Name the thread; make it a daemon.

<details><summary>Solution sketch</summary>

```java
final class CounterServant { private long n; void inc(){ n++; } long get(){ return n; } }

final class Counter implements AutoCloseable {
    private final CounterServant s = new CounterServant();
    private final ExecutorService ao = Executors.newSingleThreadExecutor(
        r -> { var t = new Thread(r, "counter-ao"); t.setDaemon(true); return t; });
    Future<Void> inc(){ return ao.submit(() -> { s.inc(); return null; }); }
    Future<Long> get(){ return ao.submit(s::get); }
    public void close(){ ao.shutdown(); }
}

// test: 50 threads × 20000 incs, await all, then get() == 1_000_000
```
The assertion holds every run because the servant runs on one thread.
</details>

---

## Task 2: Convert a `synchronized` class

**Goal.** Refactor a lock-based class into an Active Object and observe the servant
shed all its locks.

**Requirements.**
- Start from a `synchronized Inventory` with `reserve(sku, qty)` and `restock`.
- Extract an `InventoryServant` (no `synchronized`), add a proxy + executor.
- Keep the public method signatures meaningful (return `Future`).

**Hints.** The diff should *delete* every `synchronized` keyword and add a proxy.
Verify behavior under concurrent reserves equals the locked version's.

<details><summary>Solution sketch</summary>

See [middle.md → Refactoring to Active Object](middle.md#refactoring-to-active-object)
for the full before/after. Key move: concurrency leaves the domain class and lives
only in the proxy + queue.
</details>

---

## Task 3: Bounded queue + backpressure

**Goal.** Replace the unbounded default queue and make overflow visible.

**Requirements.**
- Build the executor as a `ThreadPoolExecutor(1,1,...)` with an
  `ArrayBlockingQueue(capacity=1000)` and `AbortPolicy`.
- A producer floods 100,000 fast submissions; catch `RejectedExecutionException` and
  count rejections.
- Add a caller-side retry-with-backoff that eventually drains.

**Hints.** `newSingleThreadExecutor()` is unbounded — you can't just configure it;
build the `ThreadPoolExecutor` directly. Surface rejection as a failed future, not a
silent drop. **Do not** use `CallerRunsPolicy` (it would run servant code off-thread).

<details><summary>Solution sketch</summary>

```java
var ao = new ThreadPoolExecutor(1, 1, 0, MILLISECONDS,
    new ArrayBlockingQueue<>(1000), daemonFactory("ao"),
    new ThreadPoolExecutor.AbortPolicy());

<T> Future<T> submit(Callable<T> c){
    try { return ao.submit(c); }
    catch (RejectedExecutionException e){
        var f = new CompletableFuture<T>(); f.completeExceptionally(e); return f;
    }
}
```
Retry: on a rejected future, sleep `min(2^attempt*base, cap)` and resubmit.
</details>

---

## Task 4: Graceful shutdown with draining

**Goal.** Shut down without losing in-flight work or hanging callers.

**Requirements.**
- Implement `close()` that: stops accepting new work, waits up to 5s for queued work
  to finish, then `shutdownNow()` and cancels any leftover futures.
- Submit 1000 slow (1ms) tasks, then `close()`; assert all that were accepted before
  shutdown completed.
- Submit after `close()`; assert it's rejected (failed future), not silently lost.

**Hints.** `shutdown()` then `awaitTermination(5, SECONDS)`. Make `close()`
idempotent.

<details><summary>Solution sketch</summary>

```java
public void close() throws InterruptedException {
    ao.shutdown();
    if (!ao.awaitTermination(5, TimeUnit.SECONDS)) {
        List<Runnable> dropped = ao.shutdownNow();
        // cancel futures backing 'dropped' so blocked get()s don't hang
    }
}
```
Document the post-shutdown contract: submissions return a future completed with
`RejectedExecutionException`.
</details>

---

## Task 5: Guard-based bounded buffer

**Goal.** Hand-roll the scheduler so it honors guards (the part executors can't do).

**Requirements.**
- A bounded buffer Active Object: `put(x)` blocks (defers) when full, `take()`
  blocks (defers) when empty.
- Implement the scheduler loop yourself with a request queue + guard checks; do *not*
  use `wait`/`notify` inside the servant — guards live in the scheduler.
- Test with producers and consumers at different rates; assert no item lost/duplicated
  and capacity never exceeded.

**Hints.** Maintain pending-`put` and pending-`take` lists; after each state change,
re-evaluate which deferred requests became runnable. A `take` that arrives empty is
deferred until a `put` makes it runnable.

<details><summary>Solution sketch</summary>

The scheduler keeps `data`, `pendingPuts`, `pendingTakes`. On each turn: serve any
runnable deferred request (a `put` if `size < cap`, a `take` if `size > 0`), then
accept the next request, deferring it if its guard is false. See
[middle.md → Deep Dive: Method Requests, Guards & the Scheduler](middle.md#deep-dive-method-requests-guards--the-scheduler).
</details>

---

## Task 6: Compose two Active Objects (transfer)

**Goal.** Coordinate two Active Objects without any blocking `get()`.

**Requirements.**
- Two `Account` Active Objects. Implement
  `CompletableFuture<Boolean> transfer(from, to, cents)`.
- Withdraw from `from`; only if it succeeds, deposit to `to`. No `get()` anywhere in
  `transfer` (use `thenCompose`).
- Handle the failure path (insufficient funds → completed-exceptionally or `false`)
  and think about what happens if the deposit fails after the withdraw succeeded.

**Hints.** This exposes the cross-entity problem: without a global lock, a crash
between withdraw and deposit loses money. Note where you'd add a compensating action
(saga).

<details><summary>Solution sketch</summary>

```java
CompletableFuture<Boolean> transfer(Account from, Account to, long c){
    return cf(from.withdraw(c)).thenCompose(ok -> ok
        ? cf(to.deposit(c)).thenApply(v -> true)
        : CompletableFuture.completedFuture(false));
}
```
Discuss: the deposit failing after a successful withdraw needs a compensating
`from.deposit(c)` (saga). A single coordinator Active Object owning both would also
restore atomicity at the cost of parallelism.
</details>

---

## Task 7: Sharded Active Objects

**Goal.** Break the single-thread throughput ceiling for independent keys.

**Requirements.**
- `ShardedStore<K,V>` with N single-thread executors; route by
  `floorMod(key.hashCode(), N)`.
- Benchmark `put`/`get` across many keys with N=1 vs N=8; show throughput scales for
  disjoint keys.
- Verify that the same key always lands on the same shard (affinity).

**Hints.** Affinity is the correctness property — never let a key move shards while
in use. Hot-key skew (one key dominating) won't scale; note that limitation.

<details><summary>Solution sketch</summary>

See [senior.md → Sharding](senior.md#scaling-deep-dive-sharding-affinity--the-single-thread-ceiling).
Each shard is its own Active Object; disjoint keys run in parallel; a single hot key
still bottlenecks on one shard.
</details>

---

## Task 8: Batching scheduler

**Goal.** Amortize a fixed per-op cost with `drainTo` batching.

**Requirements.**
- A `LogWriter` Active Object where each write must be durable (simulate a 1ms
  `fsync`).
- Naive version: fsync per write. Batched version: `drainTo` up to 1024 requests,
  apply all, then a single fsync, then complete all their futures.
- Measure throughput of both; show the batched version is dramatically higher.

**Hints.** Block for the first request (`take`), then `drainTo` whatever else is
ready. Complete every future in the batch *after* the fsync.

<details><summary>Solution sketch</summary>

See [senior.md → Batching scheduler](senior.md#code-examples--advanced) and the
batching math in [professional.md](professional.md#performance-latency-throughput--batching-math).
Per-op cost becomes `fsync/B + per_item`, so large `B` ≈ eliminates the fsync cost.
</details>

---

## Task 9: Supervised (self-restarting) Active Object

**Goal.** Survive a poisoned request without freezing.

**Requirements.**
- A hand-rolled Active Object whose worker loop captures every exception into the
  request's future and never dies from request logic.
- Inject a request that throws; assert its future completes exceptionally *and* the
  Active Object keeps serving subsequent requests.
- Bonus: detect a dead worker (defense in depth) and restart it.

**Hints.** With raw `execute(Runnable)`, an uncaught exception kills the worker.
Wrap the body in try/catch → `completeExceptionally`. The loop should also catch
stray `Throwable` as a safety net.

<details><summary>Solution sketch</summary>

See [senior.md → Supervised Active Object](senior.md#code-examples--advanced). The
request body does `try { f.complete(op.apply(servant)); } catch (Throwable t) {
f.completeExceptionally(t); }`, so the worker loop never sees the exception.
</details>

---

## Task 10: Active Object in Go

**Goal.** Implement the pattern idiomatically with a goroutine + channels.

**Requirements.**
- An `Account` whose state lives in one goroutine; requests arrive on a *buffered*
  (bounded) channel; replies come on per-request reply channels (futures).
- Use `select` to multiplex deposit, query, and a `quit` channel for clean shutdown.
- Run 1000 concurrent deposits; assert the final balance is correct with no mutex.

**Hints.** The buffered channel is the bounded activation queue; the goroutine is
scheduler+servant; the reply channel is the future. "Share memory by communicating."

<details><summary>Solution sketch</summary>

See the Go examples in [junior.md](junior.md#the-same-idea-in-go) and the `select`
loop in [professional.md](professional.md#cross-language-comparison). A full
channel buffer provides backpressure: `a.deposits <- req` blocks when full.
</details>

---

## How to Practice

- **Build them in order.** Each task adds exactly one real concern (bounding,
  shutdown, guards, composition, sharding, batching, supervision). Don't skip to
  sharding before you've felt an unbounded queue OOM.
- **Always write the stress test.** The whole point is concurrency; a single-threaded
  "it works" proves nothing. Hammer from many threads and assert an invariant.
- **Await, never sleep.** Tests block on `future.get(timeout)`; `Thread.sleep` makes
  flaky tests.
- **Measure, don't assume.** For Tasks 3, 7, 8 use JMH (and read
  [professional.md → Microbenchmark Anatomy](professional.md#microbenchmark-anatomy)
  so you don't fall for the blocking-`get()`/unbounded-queue traps).
- **Test the servant alone.** Most logic bugs are caught by single-threaded servant
  tests with no Active Object at all — fast and deterministic.
- **Re-derive the failure modes.** After each task, ask: what happens under overload?
  on shutdown? if a request throws? if two callers race? If you can't answer, you
  haven't finished the task.
