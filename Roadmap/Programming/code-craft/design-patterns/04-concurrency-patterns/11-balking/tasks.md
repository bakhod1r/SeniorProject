# Balking — Tasks

> Hands-on exercises for the **Balking** pattern, ordered roughly easy → hard. Each task has a goal, requirements, hints, and a solution sketch. Build from [junior.md](junior.md) and [middle.md](middle.md).

## Table of Contents

1. [Task 1 — Idempotent `start()`](#task-1--idempotent-start)
2. [Task 2 — Lock-free one-shot `close()`](#task-2--lock-free-one-shot-close)
3. [Task 3 — Dirty-flag `save()`](#task-3--dirty-flag-save)
4. [Task 4 — Debounced flush](#task-4--debounced-flush)
5. [Task 5 — Prove exactly-once under contention](#task-5--prove-exactly-once-under-contention)
6. [Task 6 — Enum state machine balk](#task-6--enum-state-machine-balk)
7. [Task 7 — Single-flight](#task-7--single-flight)
8. [Task 8 — Idempotent consumer](#task-8--idempotent-consumer)
9. [Task 9 — Go `sync.Once` vs hand-rolled](#task-9--go-synconce-vs-hand-rolled)
10. [Task 10 — Signaled balk with metrics](#task-10--signaled-balk-with-metrics)
11. [How to Practice](#how-to-practice)

---

## Task 1 — Idempotent `start()`

**Goal.** Make `start()` safe to call from any thread any number of times.
**Requirements.** Return `true` only on the call that actually starts; `false` (balk) otherwise. Check-then-act must be atomic.
**Hints.** Wrap the guard and the flag write in one `synchronized` method.
**Solution sketch.**
```java
private boolean started = false;
public synchronized boolean start() {
    if (started) return false;   // balk
    started = true;
    init();
    return true;
}
```

## Task 2 — Lock-free one-shot `close()`

**Goal.** Run cleanup exactly once with no lock.
**Requirements.** N concurrent `close()` calls → cleanup runs once; idempotent thereafter.
**Hints.** `AtomicBoolean.compareAndSet(false, true)` — winner runs, losers balk.
**Solution sketch.**
```java
private final AtomicBoolean closed = new AtomicBoolean(false);
public void close() {
    if (!closed.compareAndSet(false, true)) return;  // balk
    cleanup();
}
```

## Task 3 — Dirty-flag `save()`

**Goal.** `save()` does nothing when nothing changed; writes safely when it did.
**Requirements.** Balk if `!changed`. Do **not** lose the edit if the write throws.
**Hints.** Reset `changed` only *after* a successful write, or restore it in `catch`.
**Solution sketch.**
```java
public synchronized void save() {
    if (!changed) return;            // balk
    doSave(content);                 // may throw
    changed = false;                 // reset only on success
}
```

## Task 4 — Debounced flush

**Goal.** `flush()` runs at most once per 100 ms.
**Requirements.** Thread-safe; balk if last flush was < 100 ms ago; return `boolean`.
**Hints.** Track `lastFlush = System.nanoTime()` under the lock; compare against the interval.
**Solution sketch.**
```java
public synchronized boolean flush() {
    long now = System.nanoTime();
    if (now - lastFlush < INTERVAL_NANOS) return false; // balk
    lastFlush = now; doFlush(); return true;
}
```
*Stretch:* schedule a trailing flush so the last burst event isn't permanently dropped.

## Task 5 — Prove exactly-once under contention

**Goal.** Write a test proving the body runs once across many threads.
**Requirements.** Launch ≥ 1000 threads (or an `ExecutorService`) all calling `start()`; assert the side-effect counter == 1 and exactly one call returned `true`.
**Hints.** Use a `CyclicBarrier` so all threads hit `start()` simultaneously; count side effects with `AtomicInteger`.
**Solution sketch.**
```java
var ran = new AtomicInteger();
var wins = new AtomicInteger();
var barrier = new CyclicBarrier(N);
// each thread: barrier.await(); if (obj.start()) wins.incrementAndGet();
// inside init(): ran.incrementAndGet();
assertEquals(1, ran.get());
assertEquals(1, wins.get());
```

## Task 6 — Enum state machine balk

**Goal.** A lifecycle with `STOPPED/RUNNING/CLOSED` where every transition balks appropriately.
**Requirements.** `start()` balks unless `STOPPED`; `stop()` balks unless `RUNNING`; `close()` balks if already `CLOSED`. No impossible states.
**Hints.** Single `enum state` field under `synchronized`, or `AtomicReference<State>` with `compareAndSet` per transition.
**Solution sketch.**
```java
if (!state.compareAndSet(State.STOPPED, State.RUNNING)) return false; // start balks
```

## Task 7 — Single-flight

**Goal.** Concurrent `get(key)` triggers one `loader` call; others balk on loading but await the result.
**Requirements.** Exactly one upstream load per key; all callers get the same value; entry removed after completion.
**Hints.** `ConcurrentHashMap.putIfAbsent(key, future)` is the atomic balk; losers `join()` the existing future.
**Solution sketch.** See `SingleFlight` in [senior.md](senior.md#code-examples--advanced).

## Task 8 — Idempotent consumer

**Goal.** Process each message ID once despite at-least-once redelivery.
**Requirements.** Balk on already-seen IDs; the check-and-act on the seen-set must be atomic.
**Hints.** `seen.add(id)` on a `ConcurrentHashMap.newKeySet()` returns `false` if present → balk. For multi-node, use a DB unique constraint or Redis `SETNX`.
**Solution sketch.**
```java
if (!seen.add(msg.id())) return;  // balk: duplicate
process(msg);
```

## Task 9 — Go `sync.Once` vs hand-rolled

**Goal.** Implement once-balk two ways in Go and compare.
**Requirements.** (a) `sync.Once.Do`; (b) `atomic.Bool.CompareAndSwap(false,true)`. Both must run the body once under concurrent calls.
**Hints.** `sync.Once` also *blocks* late callers until the first finishes; the atomic version balks immediately and does **not** wait for completion — note the semantic difference.
**Solution sketch.**
```go
// (b)
if !b.CompareAndSwap(false, true) { return } // balk, no wait
fn()
```

## Task 10 — Signaled balk with metrics

**Goal.** Convert a silent balk into an observable one.
**Requirements.** Return `boolean`; increment a counter metric on each balk; log at `WARN` only when the balk indicates a likely bug (e.g. double capture), `DEBUG` otherwise.
**Hints.** Separate "expected balk" (already running) from "suspicious balk" (already captured) and route them to different log levels.
**Solution sketch.**
```java
if (!captured.compareAndSet(false, true)) {
    metrics.counter("capture.balk").increment();
    log.warn("capture balked: key {} already processed", key);
    return false;
}
```

## How to Practice

- Do Tasks 1–4 first; they cement the guard-and-return shape and the dirty-flag ordering trap.
- Always write the concurrency proof (Task 5) — a balk that *looks* correct single-threaded is the classic source of the check-then-act bug.
- For each task, implement it once with `synchronized` and once with CAS, then articulate which you'd ship and why.
- Re-run multithreaded tests dozens of times (or use `jcstress`); races surface intermittently, not on the first run.
- After Task 10, audit a real codebase for `void` balks that should return a status — that's the highest-value real-world skill here.
