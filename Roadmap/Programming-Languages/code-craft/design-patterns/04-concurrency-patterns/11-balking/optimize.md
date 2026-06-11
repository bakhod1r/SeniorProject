# Balking — Optimize

> Ten before/after walkthroughs that make balking implementations *correct first, then fast*. Each shows the starting code, the problem, the improved version, why it's better, and the trade-off. Builds on [professional.md](professional.md).

## Table of Contents

1. [Opt 1 — Lock → CAS for a single flag](#opt-1--lock--cas-for-a-single-flag)
2. [Opt 2 — Lift the balk to a fast-path read](#opt-2--lift-the-balk-to-a-fast-path-read)
3. [Opt 3 — Shrink the critical section](#opt-3--shrink-the-critical-section)
4. [Opt 4 — `getAndSet` instead of compare-then-branch](#opt-4--getandset-instead-of-compare-then-branch)
5. [Opt 5 — Coalesce redundant flushes](#opt-5--coalesce-redundant-flushes)
6. [Opt 6 — Single-flight to collapse duplicate work](#opt-6--single-flight-to-collapse-duplicate-work)
7. [Opt 7 — Avoid false sharing on the flag](#opt-7--avoid-false-sharing-on-the-flag)
8. [Opt 8 — `sync.Once` instead of mutex-per-call](#opt-8--synconce-instead-of-mutex-per-call)
9. [Opt 9 — Move dedupe balk to the DB constraint](#opt-9--move-dedupe-balk-to-the-db-constraint)
10. [Opt 10 — Make the balk observable cheaply](#opt-10--make-the-balk-observable-cheaply)
11. [Optimization Tips](#optimization-tips)

---

## Opt 1 — Lock → CAS for a single flag

**Before**
```java
public synchronized void close() {
    if (closed) return;
    closed = true;
    cleanup();
}
```
**Problem.** Under heavy concurrent `close()` calls, losers park on the monitor (context-switch syscalls).
**After**
```java
private final AtomicBoolean closed = new AtomicBoolean(false);
public void close() {
    if (!closed.compareAndSet(false, true)) return;
    cleanup();
}
```
**Why better.** Losers fail a single CAS and return — no parking, no scheduler involvement. Steady-state calls become a free cached read.
**Trade-off.** CAS only guards one flag; multi-field state still needs a lock.

## Opt 2 — Lift the balk to a fast-path read

**Before**
```java
public boolean offer(Task t) {
    synchronized (this) {
        if (shuttingDown) return false;   // every call takes the lock
        return queue.offer(t);
    }
}
```
**Problem.** Even the common "not shutting down" path acquires the lock just to read a flag.
**After**
```java
private volatile boolean shuttingDown = false;
public boolean offer(Task t) {
    if (shuttingDown) return false;        // lock-free balk fast path
    return queue.offer(t);                 // queue is itself thread-safe
}
```
**Why better.** The balk check is a `volatile` read, off the lock. Only when the flag flips do you pay anything.
**Trade-off.** Acceptable only when a stale `false` for one extra call is harmless (a late task may slip in during shutdown) — bound it with a final drain.

## Opt 3 — Shrink the critical section

**Before**
```java
public synchronized boolean start() {
    if (started) return false;
    started = true;
    expensiveInit();    // long work holds the lock
    return true;
}
```
**Problem.** The lock is held during slow `expensiveInit()`, serializing unrelated callers and blocking other balks.
**After**
```java
public boolean start() {
    synchronized (this) {
        if (started) return false;   // claim under lock
        started = true;
    }
    expensiveInit();                 // run heavy work OUTSIDE the lock
    return true;
}
```
**Why better.** The lock is held only for the claim; concurrent callers balk instantly instead of queueing behind init.
**Trade-off.** Now `started==true` before init finishes — callers needing *completion* must await a latch (see Opt 10 / single-flight).

## Opt 4 — `getAndSet` instead of compare-then-branch

**Before**
```java
public void close() {
    if (closed.get()) return;            // read
    if (!closed.compareAndSet(false, true)) return; // re-read + CAS
    cleanup();
}
```
**Problem.** Redundant read before the CAS adds an extra memory op and a second race window.
**After**
```java
public void close() {
    if (closed.getAndSet(true)) return;  // one atomic swap; true => already closed
    cleanup();
}
```
**Why better.** A single atomic `XCHG` decides ownership: if the previous value was `true`, balk. Fewer instructions, no double-check.
**Trade-off.** `getAndSet(true)` always writes (dirties the cache line) even for losers; for a read-mostly steady state, a `volatile` read guard before it can avoid the write.

## Opt 5 — Coalesce redundant flushes

**Before**
```java
public synchronized void onChange() {
    flushToDisk();    // flush on EVERY change — I/O storm
}
```
**Problem.** A burst of N changes triggers N disk writes.
**After**
```java
public synchronized boolean flush() {
    long now = System.nanoTime();
    if (now - lastFlush < INTERVAL) return false;  // balk redundant flush
    lastFlush = now; flushToDisk(); return true;
}
// onChange() just marks dirty + ensures a trailing flush is scheduled.
```
**Why better.** A burst collapses into one I/O per window; throughput rises sharply.
**Trade-off.** Adds latency (data isn't durable until the next window) and needs a trailing flush so the last change isn't dropped.

## Opt 6 — Single-flight to collapse duplicate work

**Before**
```java
V get(K key) {
    V v = cache.get(key);
    if (v != null) return v;
    v = loadFromUpstream(key);   // 100 concurrent misses => 100 upstream calls
    cache.put(key, v);
    return v;
}
```
**Problem.** A cold key under load triggers a thundering herd of identical upstream loads.
**After**
```java
CompletableFuture<V> mine = new CompletableFuture<>();
CompletableFuture<V> existing = inFlight.putIfAbsent(key, mine);
if (existing != null) return existing.join();   // balk the load, await result
// winner loads once, completes mine, removes entry
```
**Why better.** One upstream call per key regardless of concurrency; losers balk on loading and share the winner's result.
**Trade-off.** Losers now *wait* (guarded suspension) — slightly higher per-caller latency for vastly less upstream load.

## Opt 7 — Avoid false sharing on the flag

**Before**
```java
class Service {
    AtomicBoolean closed = new AtomicBoolean();
    long hits, misses;       // hot counters next to the flag
}
```
**Problem.** Counters and the flag share a cache line; counter writes invalidate the flag's line, slowing the hot balk read.
**After**
```java
class Service {
    @jdk.internal.vm.annotation.Contended  // or manual padding
    AtomicBoolean closed = new AtomicBoolean();
    long hits, misses;
}
```
**Why better.** Isolating the flag's cache line removes invalidations from unrelated writes; the steady-state balk read stays cheap.
**Trade-off.** Wastes ~64 bytes per padded field; only worth it for genuinely hot flags. Requires `-XX:-RestrictContended` for the JDK annotation.

## Opt 8 — `sync.Once` instead of mutex-per-call

**Before (Go)**
```go
func (s *S) init() {
    s.mu.Lock(); defer s.mu.Unlock()
    if s.done { return }   // takes the lock on EVERY call forever
    s.done = true; s.setup()
}
```
**Problem.** Every call (even long after init) acquires the mutex just to check `done`.
**After (Go)**
```go
func (s *S) init() { s.once.Do(s.setup) }
```
**Why better.** `sync.Once` fast-path is a single atomic load of `done`; the mutex is touched only during the one-time setup. Steady-state balk is essentially free.
**Trade-off.** `sync.Once` callers *block* until the first setup completes — desirable here, but note it waits rather than balking immediately.

## Opt 9 — Move dedupe balk to the DB constraint

**Before**
```java
if (processed.contains(id)) return;   // in-memory set, single JVM only
processed.add(id);
handle(msg);
```
**Problem.** Across multiple instances the in-memory balk doesn't dedupe; duplicates get processed on other nodes.
**After**
```java
int rows = jdbc.update(
   "INSERT INTO processed(id) VALUES (?) ON CONFLICT DO NOTHING", id);
if (rows == 0) return;                // balk: another node/retry already did it
handle(msg);
```
**Why better.** The unique constraint makes the check-and-act atomic *across the whole cluster* — correct dedupe at scale.
**Trade-off.** Adds a DB round-trip per message; mitigate with a fast-path in-memory cache in front of the constraint.

## Opt 10 — Make the balk observable cheaply

**Before**
```java
if (!started.compareAndSet(false, true)) return;  // silent
```
**Problem.** A balk that shouldn't happen leaves no trace; debugging "why didn't it run?" is guesswork.
**After**
```java
if (!started.compareAndSet(false, true)) {
    balkCounter.increment();          // O(1) atomic metric
    return;
}
```
**Why better.** A single counter increment turns invisible no-ops into a dashboard signal at negligible cost; log at `WARN` only for invariant-violating balks.
**Trade-off.** A tiny atomic increment per balk; trivial unless the balk is on an extremely hot path, where you can sample.

## Optimization Tips

- **Correct before fast.** Never trade away atomicity for speed — a fast racy balk is just a fast bug.
- **Identify the regime.** Most balks are *read-mostly after the first transition*; optimize the steady-state read (cached `volatile`/atomic load), not the rare transition.
- **Prefer CAS to locks for single flags under contention**; keep locks for multi-field state.
- **Hold locks for the claim, not the work** (Opt 3) — but then handle "claimed but not finished" with a latch.
- **Coalesce and single-flight** are the big algorithmic wins — they remove *work*, which beats micro-optimizing the flag.
- **Measure with JMH/`-race`/`jcstress`**, not intuition; sweep thread counts because a balk's cost is fundamentally a contention question.
