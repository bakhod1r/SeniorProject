# Monitor Object — Find the Bug

> Twelve buggy Monitor Object snippets. For each: the code, what's wrong, the root cause, and the fix. These are the bugs that pass code review, pass light testing, and corrupt data in production. See [junior](junior.md) · [middle](middle.md).

## Table of Contents

1. [Bug 1 — `if` instead of `while`](#bug-1--if-instead-of-while)
2. [Bug 2 — `notify()` with mixed waiters](#bug-2--notify-with-mixed-waiters)
3. [Bug 3 — Unsynchronized reader](#bug-3--unsynchronized-reader)
4. [Bug 4 — Lost wakeup (signal before wait)](#bug-4--lost-wakeup-signal-before-wait)
5. [Bug 5 — `wait()` outside `synchronized`](#bug-5--wait-outside-synchronized)
6. [Bug 6 — Unlock not in `finally`](#bug-6--unlock-not-in-finally)
7. [Bug 7 — Swallowed `InterruptedException`](#bug-7--swallowed-interruptedexception)
8. [Bug 8 — `await` on the wrong condition](#bug-8--await-on-the-wrong-condition)
9. [Bug 9 — Locking on a mutable / shared field](#bug-9--locking-on-a-mutable--shared-field)
10. [Bug 10 — Check-then-act across two calls](#bug-10--check-then-act-across-two-calls)
11. [Bug 11 — Nested monitor lockout](#bug-11--nested-monitor-lockout)
12. [Bug 12 — Broken timeout arithmetic](#bug-12--broken-timeout-arithmetic)
13. [Practice Tips](#practice-tips)

---

## Bug 1 — `if` instead of `while`

```java
public synchronized T take() throws InterruptedException {
    if (count == 0) wait();          // BUG
    T x = (T) items[head];
    items[head] = null;
    head = (head + 1) % items.length; count--;
    notifyAll();
    return x;
}
```

**What's wrong:** Uses `if` to guard the wait.
**Root cause:** Java has **Mesa semantics** (the signaled thread doesn't run immediately and the condition may be stale by the time it re-acquires the lock) and the JVM permits **spurious wakeups**. After `wait()` returns, `count` may still be 0 — but the code proceeds anyway, reading a null/garbage slot and decrementing `count` below zero.
**Fix:** `while (count == 0) wait();` — re-check the condition after every wakeup.

## Bug 2 — `notify()` with mixed waiters

```java
public synchronized void put(T x) throws InterruptedException {
    while (count == items.length) wait();
    items[tail] = x; tail = (tail + 1) % items.length; count++;
    notify();                        // BUG: one condition, mixed waiters
}
```

**What's wrong:** `notify()` on a single monitor where **both** producers and consumers wait.
**Root cause:** `notify()` wakes *one arbitrary* waiter. After a `put`, it may wake another **producer** (who's waiting on "not full"), which re-checks, finds nothing actionable for it, and sleeps again — without waking the **consumer** that could now take the item. With enough threads the system stalls.
**Fix:** Use `notifyAll()`, or move to `ReentrantLock` with separate `notFull`/`notEmpty` conditions and `signal()` the right one.

## Bug 3 — Unsynchronized reader

```java
private boolean ready = false;
public synchronized void setReady() { ready = true; }
public boolean isReady() { return ready; }    // BUG: not synchronized
```

**What's wrong:** Writer synchronized, reader not.
**Root cause:** No **happens-before** edge between the unsynchronized reader and the synchronized writer under the JMM. The reader may observe `ready == false` **indefinitely** (the write can sit in a store buffer / register), not just briefly. This is a visibility bug, not a timing window.
**Fix:** Synchronize `isReady()` on the same monitor, or make `ready` `volatile` (sufficient here because it's a single independent flag).

## Bug 4 — Lost wakeup (signal before wait)

```java
// Producer thread
buffer.add(x);
synchronized (lock) { lock.notify(); }    // notify...
// ...meanwhile Consumer, slightly later:
synchronized (lock) {
    if (buffer.isEmpty()) lock.wait();    // ...waits AFTER the notify is gone
}
```

**What's wrong:** State change and the `notify` are not coordinated with the wait under the same critical section, and the wait isn't a `while`.
**Root cause:** `notify` only wakes threads *currently* waiting. If the producer signals before the consumer reaches `wait()`, the signal is **lost** and the consumer sleeps forever (even though the buffer is non-empty).
**Fix:** Do the state mutation **and** `notify` under the same lock the consumer waits on, and re-check with `while`:
```java
synchronized (lock) { buffer.add(x); lock.notifyAll(); }
synchronized (lock) { while (buffer.isEmpty()) lock.wait(); /* consume */ }
```
Now the consumer either already sees the non-empty buffer or is reliably woken.

## Bug 5 — `wait()` outside `synchronized`

```java
public void awaitReady() throws InterruptedException {
    while (!ready) {
        wait();                      // BUG: not holding the monitor
    }
}
```

**What's wrong:** Calls `wait()` without holding the object's monitor.
**Root cause:** `wait`/`notify`/`notifyAll` require the calling thread to **own** the monitor; otherwise they throw `IllegalMonitorStateException` at runtime.
**Fix:** Make the method `synchronized` (or wrap in `synchronized(this){...}`). Same rule applies to `Condition.await/signal` and the backing `Lock`.

## Bug 6 — Unlock not in `finally`

```java
public void put(T x) throws InterruptedException {
    lock.lock();
    while (count == items.length) notFull.await();
    enqueue(x);                      // if this throws...
    notEmpty.signal();
    lock.unlock();                   // BUG: never reached on exception
}
```

**What's wrong:** `unlock()` is after code that can throw; an exception leaks the lock.
**Root cause:** Unlike `synchronized` (which auto-releases on exception), `ReentrantLock` requires explicit release. A thrown exception in `enqueue` skips `unlock()`, and the lock is held forever → every other thread deadlocks.
**Fix:**
```java
lock.lock();
try {
    while (count == items.length) notFull.await();
    enqueue(x); notEmpty.signal();
} finally { lock.unlock(); }
```

## Bug 7 — Swallowed `InterruptedException`

```java
public T take() {
    synchronized (this) {
        while (count == 0) {
            try { wait(); }
            catch (InterruptedException e) { /* ignore */ }   // BUG
        }
        // dequeue...
    }
}
```

**What's wrong:** The interrupt is swallowed and the flag is dropped.
**Root cause:** `wait()` **clears** the interrupt status when it throws. Swallowing it means the thread can never be cancelled — it loops forever and the service can't shut down. Cooperative cancellation is broken.
**Fix:** Propagate `InterruptedException`, or restore the flag and break out:
```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();   // re-assert
    throw new CancellationException();    // or return to a safe state
}
```

## Bug 8 — `await` on the wrong condition

```java
public void put(T x) throws InterruptedException {
    lock.lock();
    try {
        while (count == items.length) notEmpty.await();   // BUG: should be notFull
        enqueue(x); notEmpty.signal();
    } finally { lock.unlock(); }
}
```

**What's wrong:** Producer waits on `notEmpty` (the consumer's condition).
**Root cause:** A full buffer makes the producer wait, but it parks on `notEmpty`, which is only ever signaled by... producers. No consumer signals `notEmpty` after a `take` in the intended design, so the producer waits for a signal that targets the wrong queue → it may never wake, or wakes only by luck of `signalAll`. Condition/state mismatch.
**Fix:** Producer waits on `notFull` and signals `notEmpty`; consumer mirrors. Match each condition to the state it represents.

## Bug 9 — Locking on a mutable / shared field

```java
private Object lock = new Object();
public void reconfigure() {
    lock = new Object();             // BUG: replaces the lock object
}
public void op() {
    synchronized (lock) { /* ... */ }   // different threads may lock different objects
}
```

**What's wrong:** The lock reference is non-`final` and gets reassigned.
**Root cause:** Two threads can synchronize on **different** lock objects (one before, one after `reconfigure`), so mutual exclusion silently evaporates — they both enter the critical section. Also a visibility hazard on the `lock` field itself.
**Fix:** `private final Object lock = new Object();` — the lock must be immutable and final. Never lock on a field that can be reassigned (or on boxed/interned values like `Integer`/`String` that may be shared).

## Bug 10 — Check-then-act across two calls

```java
if (!queue.isFull()) {               // call 1: not full
    queue.put(x);                    // call 2: ...but now it IS full → blocks/overflows
}
```

**What's wrong:** Two individually-synchronized calls compose a non-atomic check-then-act.
**Root cause:** Each method is atomic, but the **gap between them** isn't locked. Another producer can fill the queue between `isFull()` and `put()`, breaking the caller's assumption. The Monitor guarantees per-method atomicity, not multi-method atomicity.
**Fix:** Provide a single atomic method that does the check and act under one lock (e.g. `offer(x)` returning a boolean), instead of composing two calls. Don't expose primitives that invite check-then-act.

## Bug 11 — Nested monitor lockout

```java
synchronized (outer) {
    synchronized (inner) {
        while (!ready) inner.wait();   // BUG: releases inner, KEEPS outer
    }
}
// another thread needs `outer` to set ready:
synchronized (outer) { ready = true; inner.notifyAll(); }   // can't get outer → deadlock
```

**What's wrong:** Waiting on `inner` while holding `outer`.
**Root cause:** `inner.wait()` releases **only** `inner`; the thread keeps `outer`. The thread that must set `ready` needs `outer` first and blocks forever. Classic nested monitor lockout.
**Fix:** Don't wait while holding more than one lock. Restructure so the wait happens with only `inner` held, or guard `ready` and the wait with a **single** lock. Establish and document a global lock order.

## Bug 12 — Broken timeout arithmetic

```java
public T poll(long timeoutNanos) throws InterruptedException {
    lock.lock();
    try {
        while (count == 0) {
            notEmpty.awaitNanos(timeoutNanos);   // BUG: ignores return, resets each loop
        }
        // dequeue...
    } finally { lock.unlock(); }
}
```

**What's wrong:** Discards `awaitNanos`'s return value and re-waits the *full* timeout on every spurious wakeup.
**Root cause:** `awaitNanos` returns the **remaining** time. Ignoring it means each spurious wakeup restarts the full timeout, so the method can block far longer than requested — effectively unbounded under repeated wakeups. There's also no `return null` on expiry, so it never actually times out.
**Fix:**
```java
long nanos = timeoutNanos;
while (count == 0) {
    if (nanos <= 0L) return null;
    nanos = notEmpty.awaitNanos(nanos);   // carry remaining time across iterations
}
```

## Practice Tips

1. **Build a "bug zoo."** Keep one runnable file per bug above with a stress/timeout test that *catches* it. Re-run after any synchronization change.
2. **The five-second checklist** for any Monitor code review: (a) `while` not `if`? (b) `notifyAll` or correct `signal`? (c) readers synchronized too? (d) `unlock` in `finally`? (e) interrupt propagated or restored? Most production bugs are one of these five.
3. **Hunt the visibility bugs first.** Bug 3 (unsynchronized reader) is the most likely to pass all your tests and still be wrong — it's a happens-before defect, not a timing window. Search for shared mutable fields read without the lock.
4. **Force the rare interleaving.** Use `CountDownLatch`/`CyclicBarrier` to deterministically reproduce lost-wakeup (Bug 4) and nested lockout (Bug 11) instead of hoping a stress test trips them.
5. **Timeout every blocking test.** A hang is the signal for Bugs 4, 6, 8, 11, and 12 — wrap blocking calls in a JUnit timeout so a deadlock fails loudly instead of stalling CI.
6. **Prefer `j.u.c`.** Most of these bugs vanish when you use `ArrayBlockingQueue` instead of hand-rolling — the audited implementation already got them right.
