# Balking — Find the Bug

> Buggy balking snippets. Read the code, find the defect, then check the diagnosis. Most bugs here are variations of one theme: a non-atomic check-then-act, or a silent no-op masking a real problem. Foundations in [junior.md](junior.md).

## Table of Contents

1. [Bug 1 — Non-atomic check-then-act](#bug-1--non-atomic-check-then-act)
2. [Bug 2 — `volatile` is not atomicity](#bug-2--volatile-is-not-atomicity)
3. [Bug 3 — Dirty flag reset before write](#bug-3--dirty-flag-reset-before-write)
4. [Bug 4 — Plain field visibility](#bug-4--plain-field-visibility)
5. [Bug 5 — Cleanup in the CAS loser branch](#bug-5--cleanup-in-the-cas-loser-branch)
6. [Bug 6 — Balking where you must wait](#bug-6--balking-where-you-must-wait)
7. [Bug 7 — Silent balk hides a bug](#bug-7--silent-balk-hides-a-bug)
8. [Bug 8 — Lock object reassigned](#bug-8--lock-object-reassigned)
9. [Bug 9 — Double-checked balk without `volatile`](#bug-9--double-checked-balk-without-volatile)
10. [Bug 10 — CAS loop instead of single CAS](#bug-10--cas-loop-instead-of-single-cas)
11. [Bug 11 — Go data race on a bool flag](#bug-11--go-data-race-on-a-bool-flag)
12. [Bug 12 — Treating balk `false` as failure](#bug-12--treating-balk-false-as-failure)
13. [Practice Tips](#practice-tips)

---

## Bug 1 — Non-atomic check-then-act

```java
private boolean started = false;
public boolean start() {          // NOT synchronized
    if (started) return false;
    started = true;
    init();
    return true;
}
```
**What's wrong.** Two threads can both read `started == false` before either writes `true`; both run `init()`.
**Root cause.** The classic check-then-act race — the check and the flag write are not atomic.
**Fix.** Make the method `synchronized`, or use `if (!startedAtomic.compareAndSet(false, true)) return false;`.

## Bug 2 — `volatile` is not atomicity

```java
private volatile boolean closed = false;
public void close() {
    if (closed) return;
    closed = true;     // still two separate operations
    cleanup();
}
```
**What's wrong.** `volatile` fixes visibility but not the race: two threads can both read `false`, both run `cleanup()`.
**Root cause.** Confusing visibility (`volatile`) with atomic read-modify-write.
**Fix.** `AtomicBoolean closed; if (!closed.compareAndSet(false, true)) return;`.

## Bug 3 — Dirty flag reset before write

```java
public synchronized void save() {
    if (!changed) return;
    changed = false;          // reset FIRST
    writeToDisk(content);     // throws IOException sometimes
}
```
**What's wrong.** If `writeToDisk` throws, the edit is lost *and* `changed` is already `false`, so a later `save()` balks and never persists it.
**Root cause.** Resetting the dirty flag before the side effect succeeds.
**Fix.** Reset after a successful write, or restore in a `catch`:
```java
writeToDisk(content);
changed = false;             // only on success
```

## Bug 4 — Plain field visibility

```java
private boolean ready = false;            // plain field
public void markReady() { ready = true; } // writer thread
public boolean tryUse() {                 // reader thread
    if (!ready) return false;             // may NEVER see the write
    use(); return true;
}
```
**What's wrong.** With no `volatile`/lock there's no happens-before edge; the reader may spin forever seeing `false`, or see `ready==true` before `use()`'s prerequisites are published.
**Root cause.** Cross-thread read of a plain field — no visibility guarantee.
**Fix.** `volatile boolean ready` (if a stale balk is acceptable) or `AtomicBoolean`.

## Bug 5 — Cleanup in the CAS loser branch

```java
public void close() {
    if (closed.compareAndSet(false, true)) {
        // winner does nothing here?!
    } else {
        releaseResources();   // WRONG: loser runs cleanup
    }
}
```
**What's wrong.** The branches are inverted — every loser frees the resource, the winner does nothing, and the resource is freed many times (or never by the right owner).
**Root cause.** Misreading `compareAndSet`'s return: `true` = "I won, I do the work."
**Fix.** `if (!closed.compareAndSet(false, true)) return; releaseResources();`.

## Bug 6 — Balking where you must wait

```java
public Item take() {
    if (queue.isEmpty()) return null;   // balk
    return queue.poll();
}
// consumer:
Item i = take();
process(i);                              // NPE when it balked
```
**What's wrong.** A consumer needs an item; balking returns `null` forever even though a producer will soon add one. The consumer NPEs or busy-loops.
**Root cause.** Using Balking where Guarded Suspension is required — "later" is the correct answer.
**Fix.** Block: `while (queue.isEmpty()) wait();` (or use a `BlockingQueue.take()`).

## Bug 7 — Silent balk hides a bug

```java
public void capturePayment(String key) {
    if (captured.contains(key)) return;  // silent balk
    captured.add(key);
    gateway.charge(key);
}
```
**What's wrong.** A genuine double-submit (a real bug upstream) is silently swallowed; nobody ever learns money capture was attempted twice. Also, `contains` + `add` is itself non-atomic (see Bug 11's theme).
**Root cause.** Swallowing an invariant-violating balk with no signal.
**Fix.** Make the dedupe atomic *and* observable:
```java
if (!captured.add(key)) {          // atomic on a concurrent set
    metrics.counter("capture.double_submit").increment();
    log.warn("capture balked: {} already processed", key);
    return;
}
```

## Bug 8 — Lock object reassigned

```java
private Object lock = new Object();
public void start() {
    synchronized (lock) {
        if (started) return;
        lock = new Object();   // reassigning the lock mid-method
        started = true; init();
    }
}
```
**What's wrong.** Reassigning the lock means different threads may synchronize on *different* objects, destroying mutual exclusion — the balk races again.
**Root cause.** Mutable lock reference.
**Fix.** `private final Object lock = new Object();` — never reassign a lock.

## Bug 9 — Double-checked balk without `volatile`

```java
private boolean done = false;          // not volatile
public void runOnce(Runnable r) {
    if (done) return;                  // fast path
    synchronized (this) {
        if (done) return;
        r.run();
        done = true;
    }
}
```
**What's wrong.** The fast-path read of `done` is outside the lock and `done` isn't `volatile`, so a thread may read a stale `false` indefinitely, or (worse) see `done==true` before `r.run()`'s writes are visible.
**Root cause.** Double-checked locking with a non-`volatile` flag — see [Double-Checked Locking](../10-double-checked-locking/junior.md).
**Fix.** Make `done` `volatile`, or just use `sync.Once`/`AtomicBoolean`.

## Bug 10 — CAS loop instead of single CAS

```java
public void close() {
    while (!closed.compareAndSet(false, true)) {
        // spin
    }
    cleanup();   // EVERY caller eventually runs this
}
```
**What's wrong.** A retry loop makes *every* thread eventually succeed the CAS (after the flag flips back?—it never does, so losers spin forever **and** if it ever could reset, all would run cleanup). For a once-only flag the loop is simply wrong: losers should balk, not retry.
**Root cause.** Using a CAS *update loop* idiom where a single-shot balk is needed.
**Fix.** `if (!closed.compareAndSet(false, true)) return; cleanup();` — one CAS, no loop.

## Bug 11 — Go data race on a bool flag

```go
type S struct{ started bool }
func (s *S) Start() {
    if s.started { return }   // racy read
    s.started = true          // racy write
    s.init()
}
```
**What's wrong.** Plain `bool` accessed from multiple goroutines is a data race (`go test -race` flags it) and check-then-act isn't atomic.
**Root cause.** No synchronization on shared mutable state.
**Fix.** Use `sync.Once` or `atomic.Bool.CompareAndSwap`:
```go
if !s.started.CompareAndSwap(false, true) { return }
s.init()
```

## Bug 12 — Treating balk `false` as failure

```java
if (!engine.start()) {
    throw new IllegalStateException("could not start engine");
}
```
**What's wrong.** `start()` returns `false` when it *balks* (already running) — a normal idempotent outcome, not an error. This throws on a perfectly healthy second call.
**Root cause.** Conflating "balked" with "failed."
**Fix.** Treat `false` as "already running" — log at `DEBUG` or ignore; only throw on actual exceptions.

## Practice Tips

- For every balk, ask two questions: *Is check-then-act atomic?* and *Does a silent no-op hide a real bug?* Most defects here fail one of those.
- Memorize the distinction: `volatile` = visibility, `compareAndSet` = atomicity. Bugs 2, 4, 9, 11 all stem from conflating them.
- When you see `compareAndSet`, verify the *winner* (`true`) does the work and the loser balks — Bug 5 is a frequent inversion.
- Run Go tests with `-race` and Java once-only code under `jcstress`; these races almost never reproduce on a single casual run.
- Watch the dirty-flag ordering (Bug 3): the reset must follow the successful side effect, never precede it.
