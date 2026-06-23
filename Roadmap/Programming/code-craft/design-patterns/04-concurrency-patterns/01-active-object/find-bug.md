# Active Object — Find the Bug

> Twelve buggy concurrent snippets. Read the code, predict the failure, then check
> the diagnosis. Each is a real mistake people ship. Levels:
> [junior](junior.md) · [middle](middle.md) · [senior](senior.md) ·
> [professional](professional.md).

## Table of Contents

1. [Bug 1: Unbounded activation queue](#bug-1-unbounded-activation-queue)
2. [Bug 2: Blocking `get()` on the Active Object thread](#bug-2-blocking-get-on-the-active-object-thread)
3. [Bug 3: Servant reference escapes](#bug-3-servant-reference-escapes)
4. [Bug 4: `CallerRunsPolicy` on an Active Object](#bug-4-callerrunspolicy-on-an-active-object)
5. [Bug 5: Exception kills the worker thread](#bug-5-exception-kills-the-worker-thread)
6. [Bug 6: `shutdownNow()` orphans pending futures](#bug-6-shutdownnow-orphans-pending-futures)
7. [Bug 7: Reading servant state without the future](#bug-7-reading-servant-state-without-the-future)
8. [Bug 8: Returning the live internal collection](#bug-8-returning-the-live-internal-collection)
9. [Bug 9: Multiple worker threads on one servant](#bug-9-multiple-worker-threads-on-one-servant)
10. [Bug 10: Blocking I/O on the Active Object thread](#bug-10-blocking-io-on-the-active-object-thread)
11. [Bug 11: Reentrant self-call deadlock](#bug-11-reentrant-self-call-deadlock)
12. [Bug 12: Sharding without affinity](#bug-12-sharding-without-affinity)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Unbounded activation queue

```java
public final class EventSink {
    private final ExecutorService ao = Executors.newSingleThreadExecutor();
    private final SinkServant servant = new SinkServant();

    public void accept(Event e) {
        ao.submit(() -> servant.handle(e));   // fire-and-forget
    }
}
// Producers emit 200k events/s; the servant handles ~50k/s.
```

**What's wrong.** `newSingleThreadExecutor()` uses an **unbounded**
`LinkedBlockingQueue`. Producers outrun the single consumer 4:1, so the queue grows
forever until `OutOfMemoryError`.

**Root cause.** No backpressure. The queue silently absorbs the rate mismatch.

**Fix.** Bound the queue and choose an overflow policy.

```java
private final ThreadPoolExecutor ao = new ThreadPoolExecutor(
    1, 1, 0, MILLISECONDS,
    new ArrayBlockingQueue<>(10_000),                 // bounded
    new ThreadPoolExecutor.AbortPolicy());            // reject + surface, then shed
```

---

## Bug 2: Blocking `get()` on the Active Object thread

```java
public Future<Long> balanceThenLog() {
    return ao.submit(() -> {
        long b = servant.balance();
        ao.submit(() -> servant.log(b)).get();        // <-- inside the AO thread!
        return b;
    });
}
```

**What's wrong.** The submitted task runs on the single AO thread and then calls
`.get()` on a *second* task submitted to the *same* executor. That second task can
only run after the first finishes — but the first is blocked waiting for it. **Self-
deadlock**, forever.

**Root cause.** A single-threaded executor cannot run a nested task while the only
thread is blocked on that task's future.

**Fix.** Don't block on your own Active Object from inside it. Do the work inline (you
already own the thread), or chain with a non-blocking future.

```java
return ao.submit(() -> {
    long b = servant.balance();
    servant.log(b);                                   // already on the AO thread
    return b;
});
```

---

## Bug 3: Servant reference escapes

```java
public final class Account {
    private final AccountServant servant = new AccountServant();
    private final ExecutorService ao = Executors.newSingleThreadExecutor();

    public AccountServant raw() { return servant; }   // <-- leaks the servant
    public Future<Void> deposit(long c){ return ao.submit(() -> { servant.deposit(c); return null; }); }
}
// Elsewhere: account.raw().deposit(50);  // runs on a foreign thread!
```

**What's wrong.** Handing out the servant lets callers invoke it directly from their
own threads, concurrent with the AO thread. The single-thread guarantee is broken →
data race on the balance.

**Root cause.** Encapsulation breach: the servant must be reachable only through the
proxy.

**Fix.** Make the servant `private`, expose nothing that returns it, and route every
operation through `ao.submit`.

---

## Bug 4: `CallerRunsPolicy` on an Active Object

```java
private final ThreadPoolExecutor ao = new ThreadPoolExecutor(
    1, 1, 0, MILLISECONDS, new ArrayBlockingQueue<>(100),
    new ThreadPoolExecutor.CallerRunsPolicy());        // <-- wrong for AO
```

**What's wrong.** On overflow, `CallerRunsPolicy` runs the rejected task on the
**caller's** thread. That executes servant code off the single AO thread,
concurrent with the AO thread — a data race on servant state.

**Root cause.** `CallerRunsPolicy` is a backpressure trick for *stateless* pools. For
a state-owning Active Object it violates the single-thread invariant.

**Fix.** Use a blocking `put` on a bounded queue (block the producer) or
`AbortPolicy` (reject and surface). Never run servant work on a foreign thread.

---

## Bug 5: Exception kills the worker thread

```java
public void process(Job j) {
    ao.execute(() -> servant.process(j));              // execute(Runnable), no future
}
// servant.process throws on a malformed job.
```

**What's wrong.** With raw `execute(Runnable)`, an uncaught exception propagates out
of `run()` and **terminates the worker thread**. The thread pool may or may not
replace it; with a hand-rolled single thread it's gone — the Active Object silently
stops processing everything.

**Root cause.** No exception capture; the failure escapes the request boundary.

**Fix.** Use `submit(Callable)` (the executor captures the exception into the future),
or catch inside the request and complete a future exceptionally.

```java
public Future<Void> process(Job j) {
    return ao.submit(() -> { servant.process(j); return null; }); // exception → future
}
```

---

## Bug 6: `shutdownNow()` orphans pending futures

```java
public void close() {
    ao.shutdownNow();                                  // drops queued tasks
}
// Callers elsewhere are blocked in deposit(c).get();
```

**What's wrong.** `shutdownNow()` drains queued-but-unstarted tasks and never runs
them. Their futures never complete, so every caller blocked in `get()` hangs forever
(no result, no exception).

**Root cause.** Force-stop without resolving in-flight futures.

**Fix.** Drain first, then force-stop, and cancel anything left.

```java
public void close() throws InterruptedException {
    ao.shutdown();
    if (!ao.awaitTermination(5, TimeUnit.SECONDS)) {
        ao.shutdownNow();
        // cancel/complete-exceptionally the futures of dropped tasks so get() returns
    }
}
```

---

## Bug 7: Reading servant state without the future

```java
public final class Account {
    final AccountServant servant = new AccountServant();   // package-visible
    public Future<Void> deposit(long c){ return ao.submit(() -> { servant.deposit(c); return null; }); }
}
// Monitoring thread, every second:
long b = account.servant.balanceCents;                 // <-- direct field read
```

**What's wrong.** The monitoring thread reads a servant field directly while the AO
thread writes it. No happens-before edge exists (the read bypasses the future), so
it's a **data race** — torn/stale values, even on a `long` (non-atomic on some
platforms without `volatile`).

**Root cause.** Bypassing the only safe channel (submit → future) for reading state.

**Fix.** Read through the Active Object: `account.balance().get()`. The future
establishes the visibility edge.

---

## Bug 8: Returning the live internal collection

```java
final class StoreServant {
    private final Map<String,Integer> data = new HashMap<>();
    Map<String,Integer> snapshot() { return data; }    // <-- live map, not a copy
}
public Future<Map<String,Integer>> snapshot(){ return ao.submit(servant::snapshot); }
```

**What's wrong.** The future hands the caller the servant's *live* `HashMap`. The
caller now iterates/reads it on its own thread while the AO thread keeps mutating it →
`ConcurrentModificationException` or corrupted reads. The visibility fence from the
future only covered the *reference*, not subsequent mutations.

**Root cause.** Publishing mutable internal state across the thread boundary.

**Fix.** Return an immutable copy made *on the AO thread*.

```java
Map<String,Integer> snapshot(){ return Map.copyOf(data); } // copy on AO thread
```

---

## Bug 9: Multiple worker threads on one servant

```java
private final ExecutorService ao = Executors.newFixedThreadPool(4);  // <-- 4 threads
private final AccountServant servant = new AccountServant();
public Future<Void> deposit(long c){ return ao.submit(() -> { servant.deposit(c); return null; }); }
```

**What's wrong.** Four worker threads now invoke the *same* unsynchronized servant
concurrently. The whole premise — one thread touches the state — is gone. Lost
updates on the balance.

**Root cause.** Using a multi-thread pool where the pattern requires exactly one
worker.

**Fix.** Use `newSingleThreadExecutor()` (or a `ThreadPoolExecutor` with core=max=1).
If you need parallelism, **shard**: many single-thread Active Objects over disjoint
keys, not many threads over one servant.

---

## Bug 10: Blocking I/O on the Active Object thread

```java
public Future<Response> handle(Request r) {
    return ao.submit(() -> {
        servant.update(r);
        return httpClient.get(r.url());                // blocking network call, ~500ms
    });
}
```

**What's wrong.** The blocking HTTP call runs on the single AO thread, so for those
~500 ms *every other queued request is stalled* — head-of-line blocking. Throughput
collapses and p99 latency explodes under any concurrency.

**Root cause.** Long blocking operation on the one serialization thread.

**Fix.** Do only the state mutation on the AO thread; offload the I/O to a separate
pool / async client, and stitch results with a non-blocking future.

```java
public CompletableFuture<Response> handle(Request r) {
    return toCF(ao.submit(() -> { servant.update(r); return r.url(); }))
        .thenCompose(url -> httpClient.getAsync(url));  // I/O off the AO thread
}
```

---

## Bug 11: Reentrant self-call deadlock

```java
final class OrderServant {
    private final Orders proxy;                        // back-reference to its own proxy
    void place(Order o) {
        validate(o);
        proxy.notifyShipping(o).get();                 // <-- submits to same AO, blocks
    }
}
```

**What's wrong.** `place` runs on the AO thread, then submits `notifyShipping` to the
*same* Active Object and blocks on its future. The second request can't run until the
first returns — but the first is blocked on it. Deadlock (same shape as Bug 2, via a
back-reference).

**Root cause.** A servant method synchronously re-enters its own Active Object.

**Fix.** Don't give the servant a blocking back-reference. Do the follow-up inline on
the AO thread, or chain asynchronously without `get()`, or post to a *different*
Active Object.

---

## Bug 12: Sharding without affinity

```java
public Future<V> get(K key) {
    int s = ThreadLocalRandom.current().nextInt(shards.length);   // <-- random shard!
    return shards[s].submit(() -> servants[s].get(key));
}
```

**What's wrong.** Choosing the shard *randomly* means the same key is read/written by
different single-thread servants on different threads. Each servant has its own copy
of state (or sees only its own writes), so reads miss writes and concurrent servants
race on shared structures. Sharding's correctness depends on **stable affinity**:
key → always the same shard.

**Root cause.** No deterministic key→shard mapping; the single-writer-per-key
invariant is broken.

**Fix.** Map deterministically: `int s = Math.floorMod(key.hashCode(), shards.length);`
so each key is owned by exactly one shard forever (until a controlled resharding that
drains and migrates).

---

## Practice Tips

- **For every snippet, ask the four questions:** What happens under *overload*? On
  *shutdown*? If a request *throws*? If two callers *race*? Most bugs here fail one of
  those.
- **Find the thread boundary.** Mark which code runs on the caller thread vs the AO
  thread. Bugs cluster where state or references cross that line outside the queue/
  future channel (Bugs 3, 7, 8, 9, 12).
- **Watch for self-waits.** Any `get()` reachable from the AO thread on its own
  executor is a deadlock candidate (Bugs 2, 11).
- **Default-queue is a smell.** Seeing `newSingleThreadExecutor()` with fire-and-forget
  submits should immediately prompt "where's the bound?" (Bug 1).
- **`execute` vs `submit`.** Raw `execute(Runnable)` lets exceptions escape and kill
  the worker (Bug 5); prefer `submit` so failures land in futures.
- **Reproduce, then fix.** Write the stress test that triggers the bug *before*
  applying the fix, so you can prove the fix works.
