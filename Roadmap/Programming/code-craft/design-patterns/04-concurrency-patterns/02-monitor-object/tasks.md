# Monitor Object — Practice Tasks

> Ten graded, build-it-yourself tasks for the **Monitor Object** pattern. Each gives a goal, requirements, hints, and a solution sketch. Work in Java (intrinsic lock or `ReentrantLock` + `Condition`); add C++ where noted. See [junior](junior.md) · [middle](middle.md).

## Table of Contents

1. [Task 1 — Thread-Safe Counter](#task-1--thread-safe-counter)
2. [Task 2 — Bounded Buffer (intrinsic lock)](#task-2--bounded-buffer-intrinsic-lock)
3. [Task 3 — Bounded Buffer (two conditions)](#task-3--bounded-buffer-two-conditions)
4. [Task 4 — Timed `poll` / `offer`](#task-4--timed-poll--offer)
5. [Task 5 — CountDownLatch from scratch](#task-5--countdownlatch-from-scratch)
6. [Task 6 — Bounded Semaphore](#task-6--bounded-semaphore)
7. [Task 7 — Connection Pool](#task-7--connection-pool)
8. [Task 8 — Read/Write Gate (single writer)](#task-8--readwrite-gate-single-writer)
9. [Task 9 — One-Shot Future / Promise](#task-9--one-shot-future--promise)
10. [Task 10 — Reproduce and Fix Nested Monitor Lockout](#task-10--reproduce-and-fix-nested-monitor-lockout)
11. [How to Practice](#how-to-practice)

---

## Task 1 — Thread-Safe Counter

**Goal:** Build a counter safe for concurrent `increment`/`get` and prove visibility.

**Requirements:** `increment()`, `decrement()`, `get()`, all correct under N threads doing M increments each so the final value equals N×M.

**Hints:** Synchronize the **reader** too — not just the writer. Why? Visibility under the JMM.

<details><summary>Solution sketch</summary>

```java
public final class Counter {
    private long value;
    public synchronized void increment() { value++; }
    public synchronized void decrement() { value--; }
    public synchronized long get()       { return value; }
}
```
Test: 8 threads × 1,000,000 increments; assert `get() == 8_000_000`. Remove `synchronized` from `get()` and observe stale reads under contention. The lock gives both atomicity (`value++` is read-modify-write) and visibility.
</details>

## Task 2 — Bounded Buffer (intrinsic lock)

**Goal:** Implement the canonical Monitor example with `synchronized` + `wait`/`notifyAll`.

**Requirements:** `put(x)` blocks when full, `take()` blocks when empty; FIFO order; no busy-waiting.

**Hints:** `while (full) wait();` and `while (empty) wait();`. Use `notifyAll()` (single condition, mixed waiters). Null out slots on removal to avoid leaks.

<details><summary>Solution sketch</summary>

```java
public synchronized void put(T x) throws InterruptedException {
    while (count == items.length) wait();
    items[tail] = x; tail = (tail + 1) % items.length; count++;
    notifyAll();
}
public synchronized T take() throws InterruptedException {
    while (count == 0) wait();
    T x = (T) items[head]; items[head] = null;
    head = (head + 1) % items.length; count--;
    notifyAll();
    return x;
}
```
Verify with a stress test asserting `0 <= count <= capacity` always and items-in == items-out.
</details>

## Task 3 — Bounded Buffer (two conditions)

**Goal:** Refactor Task 2 to `ReentrantLock` + `notFull`/`notEmpty` and replace `notifyAll` with `signal`.

**Requirements:** `signal()` (not `signalAll()`); `lock()` outside `try`, `unlock()` in `finally`.

**Hints:** Producers `await` on `notFull` and `signal` `notEmpty`; consumers the mirror. Argue why `signal` is now safe (homogeneous waiters per condition).

<details><summary>Solution sketch</summary>

```java
public void put(T x) throws InterruptedException {
    lock.lock();
    try {
        while (count == items.length) notFull.await();
        // enqueue...
        notEmpty.signal();
    } finally { lock.unlock(); }
}
```
Safety argument: only producers wait on `notFull`, only consumers on `notEmpty`, so a single `signal` always wakes a thread that can proceed — no wrong-thread wakeup, no thundering herd.
</details>

## Task 4 — Timed `poll` / `offer`

**Goal:** Add deadline-aware variants that give up after a timeout.

**Requirements:** `poll(timeout, unit)` returns `null` on timeout; `offer(x, timeout, unit)` returns `false`. Deadline must survive spurious wakeups.

**Hints:** Use `awaitNanos`, which returns the **remaining** nanos; subtract across loop iterations.

<details><summary>Solution sketch</summary>

```java
public T poll(long timeout, TimeUnit unit) throws InterruptedException {
    long nanos = unit.toNanos(timeout);
    lock.lock();
    try {
        while (count == 0) {
            if (nanos <= 0L) return null;
            nanos = notEmpty.awaitNanos(nanos);   // remaining time
        }
        // dequeue...
        notFull.signal();
        return x;
    } finally { lock.unlock(); }
}
```
This is the [Balking](../11-balking/middle.md) pattern grafted onto the Monitor: don't wait forever, balk on deadline.
</details>

## Task 5 — CountDownLatch from scratch

**Goal:** Implement a one-shot latch: workers `await()` until `count` reaches zero.

**Requirements:** `await()` blocks until count == 0; `countDown()` decrements; once open, stays open (all future `await()` return immediately).

**Hints:** Single condition "count == 0". `countDown()` signals only when it hits zero. `await()` uses `while (count > 0) wait();`.

<details><summary>Solution sketch</summary>

```java
public final class Latch {
    private int count;
    public Latch(int n) { count = n; }
    public synchronized void await() throws InterruptedException {
        while (count > 0) wait();
    }
    public synchronized void countDown() {
        if (count > 0 && --count == 0) notifyAll();   // wake all waiters
    }
}
```
`notifyAll` is correct: all waiters become unblocked simultaneously when the gate opens.
</details>

## Task 6 — Bounded Semaphore

**Goal:** Implement a counting semaphore with N permits.

**Requirements:** `acquire()` blocks when no permits; `release()` returns one; never exceed max permits.

**Hints:** Condition "permits > 0". `release` signals one waiter. Make `acquire` interruptible.

<details><summary>Solution sketch</summary>

```java
public final class Sem {
    private final Lock lock = new ReentrantLock();
    private final Condition avail = lock.newCondition();
    private int permits;
    public Sem(int p) { permits = p; }
    public void acquire() throws InterruptedException {
        lock.lock();
        try { while (permits == 0) avail.await(); permits--; }
        finally { lock.unlock(); }
    }
    public void release() {
        lock.lock();
        try { permits++; avail.signal(); }
        finally { lock.unlock(); }
    }
}
```
Compare your version against `java.util.concurrent.Semaphore` and note what it adds (fairness, bulk acquire, `tryAcquire`).
</details>

## Task 7 — Connection Pool

**Goal:** A fixed-size pool that blocks borrowers when exhausted.

**Requirements:** `borrow(timeout)` returns a connection or times out; `release(conn)` returns it; never hand out the same connection twice.

**Hints:** Hold idle connections in a deque; condition "pool not empty". Combine with Task 4's timed wait. Always `release` in a `finally` at the call site.

<details><summary>Solution sketch</summary>

Maintain `Deque<Conn> idle` and `int leased`. `borrow`: `while (idle.isEmpty() && leased == max) notEmpty.await();` then pop or create. `release`: push back and `signal`. Guard against double-release with an identity set. Add a `close()` that drains and rejects further borrows (interrupt waiters).
</details>

## Task 8 — Read/Write Gate (single writer)

**Goal:** Allow many readers OR one writer, never both — a hand-rolled read/write lock as a Monitor.

**Requirements:** `readLock`/`readUnlock`, `writeLock`/`writeUnlock`. Writers wait for active readers to drain; readers wait while a writer holds or is queued (writer preference to avoid starvation).

**Hints:** Track `activeReaders`, `writerActive`, `waitingWriters`. Conditions: "can read", "can write". This is genuinely tricky — get starvation policy explicit.

<details><summary>Solution sketch</summary>

`readLock`: `while (writerActive || waitingWriters > 0) okToRead.await(); activeReaders++;`
`writeLock`: `waitingWriters++; while (activeReaders > 0 || writerActive) okToWrite.await(); waitingWriters--; writerActive = true;`
On unlock, signal the appropriate condition(s). Then compare against `ReentrantReadWriteLock` and explain why you'd almost always use the JDK's.
</details>

## Task 9 — One-Shot Future / Promise

**Goal:** A `set(value)` once, `get()` blocks until set.

**Requirements:** `get()` blocks until a value (or exception) is available; multiple getters all unblock; `set` is idempotent-or-throws.

**Hints:** Condition "isDone". Store either a value or a throwable. `notifyAll` on completion.

<details><summary>Solution sketch</summary>

```java
public synchronized V get() throws InterruptedException {
    while (!done) wait();
    if (error != null) throw new ExecutionException(error);
    return value;
}
public synchronized void complete(V v) {
    if (done) throw new IllegalStateException("already completed");
    value = v; done = true; notifyAll();
}
```
This is the Monitor core of `CompletableFuture`'s blocking `get()`.
</details>

## Task 10 — Reproduce and Fix Nested Monitor Lockout

**Goal:** Deliberately create a nested-monitor deadlock, observe it, then fix it.

**Requirements:** Two objects A and B; a thread holds A, enters B, and `wait()`s on B while still holding A; a second thread needs A to change B's condition. Show the hang (timeout test), then fix.

**Hints:** The fix is to *not wait while holding the outer lock* — restructure so the wait happens with only one lock held, or pass the needed data without nesting.

<details><summary>Solution sketch</summary>

Reproduce: `synchronized(a){ synchronized(b){ while(!ready) b.wait(); } }` while another thread needs `a` to set `ready`. The waiter releases only `b`, keeps `a`, and the setter blocks on `a` → deadlock; a JUnit timeout proves it. Fix: lift the wait out so only `b` is held during `b.wait()`, or merge into a single lock guarding both pieces of state. Add a lock-order assertion to prevent regression.
</details>

## How to Practice

1. **Write the stress test first.** For every task, a multi-threaded harness asserting the invariant (count bounds, conservation of items, no double-issue) is worth more than the implementation. Run it for millions of ops.
2. **Deliberately break it.** Change `while` to `if`, swap `signal` for the wrong condition, drop reader synchronization — watch the stress test catch it. Bugs you've *seen* fail you'll recognize in code review.
3. **Pin interleavings with latches.** Use `CountDownLatch`/`CyclicBarrier` to force the exact two-thread order that triggers lost-wakeup or nested-lockout, turning flaky bugs into deterministic tests.
4. **Build both versions.** Do each task once with `synchronized`+`wait`/`notifyAll` and once with `ReentrantLock`+`Condition`; feel where the explicit version's targeted `signal` wins.
5. **Then read the JDK.** After building Task 3, read `ArrayBlockingQueue`; after Task 5, read `CountDownLatch` (AQS). Your hand-rolled version makes the source legible.
6. **Add a timeout to every blocking test** — a hang *is* the failure signal for deadlock and lost-wakeup bugs.
