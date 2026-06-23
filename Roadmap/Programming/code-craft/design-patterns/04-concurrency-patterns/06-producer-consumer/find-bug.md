# Producer–Consumer — Find the Bug

> Concurrency bugs hide in plain sight. Each snippet below *looks* reasonable and is *broken*. Find the bug before reading the analysis. These are the exact mistakes that ship to production and page you at 3 a.m. See [Junior](junior.md) · [Middle](middle.md) · [Senior](senior.md) · [Professional](professional.md).

---

## Table of Contents

1. [Bug 1 — `if` Instead of `while`](#bug-1)
2. [Bug 2 — `notify` With Mixed Waiters](#bug-2)
3. [Bug 3 — Missing the "Full" Condition](#bug-3)
4. [Bug 4 — Work Done Inside the Lock](#bug-4)
5. [Bug 5 — Single Poison Pill for N Consumers](#bug-5)
6. [Bug 6 — Closing a Channel From Multiple Producers](#bug-6)
7. [Bug 7 — Mutating an Item After Handoff](#bug-7)
8. [Bug 8 — Unbounded Queue in a Thread Pool](#bug-8)
9. [Bug 9 — Swallowed `InterruptedException`](#bug-9)
10. [Bug 10 — Poison Pill Enqueued Before Work Drains](#bug-10)
11. [Bug 11 — Checking `size()` Then Acting (TOCTOU)](#bug-11)
12. [Bug 12 — Producer Closes Channel While Consumers Still Send Back](#bug-12)
13. [Practice Tips](#practice-tips)

---

## Bug 1 — `if` Instead of `while`

```java
public synchronized T take() throws InterruptedException {
    if (count == 0) {          // BUG
        wait();
    }
    count--;
    return dequeue();
}
```

**What's wrong:** Uses `if` to guard the wait condition.
**Root cause:** After `wait()` returns, `count` may be `0` again — a spurious wakeup, or another consumer raced in and took the only item between the `notifyAll` and this thread re-acquiring the lock. The `if` doesn't re-check, so `count` goes negative and `dequeue()` reads an empty buffer (returns garbage / throws).
**Fix:** `while (count == 0) wait();` — always re-test the condition after waking.

---

## Bug 2 — `notify` With Mixed Waiters

```java
public synchronized void put(T x) throws InterruptedException {
    while (count == cap) wait();
    enqueue(x); count++;
    notify();                  // BUG
}
public synchronized T take() throws InterruptedException {
    while (count == 0) wait();
    T x = dequeue(); count--;
    notify();                  // BUG
    return x;
}
```

**What's wrong:** `notify` wakes one *arbitrary* waiter when producers and consumers wait on the same monitor.
**Root cause:** A consumer finishes and `notify` happens to wake another *consumer* (buffer now empty, it can't proceed and re-waits). The producers that could proceed were never woken. Repeat, and every thread ends up parked → deadlock with a non-empty, non-full buffer.
**Fix:** Use `notifyAll()`; or, better, switch to a `ReentrantLock` with separate `notFull`/`notEmpty` conditions and targeted `signal`.

---

## Bug 3 — Missing the "Full" Condition

```java
public synchronized void put(T x) {     // BUG: no full-check, no wait
    items[tail] = x;
    tail = (tail + 1) % items.length;
    count++;                            // can exceed capacity
}
```

**What's wrong:** The producer never checks whether the buffer is full.
**Root cause:** A fast producer overruns a slow consumer, overwriting unconsumed slots and corrupting `count` (it climbs past `cap`). Data is silently lost. A bounded buffer has *two* conditions; this handles neither full-blocking.
**Fix:** `while (count == items.length) wait();` at the top of `put`, and `notifyAll()`/`signal` consumers after enqueue.

---

## Bug 4 — Work Done Inside the Lock

```java
public T takeAndProcess() throws InterruptedException {
    lock.lock();
    try {
        while (count == 0) notEmpty.await();
        T x = dequeue(); count--;
        notFull.signal();
        return process(x);     // BUG: heavy work while holding the lock
    } finally { lock.unlock(); }
}
```

**What's wrong:** `process(x)` (potentially slow I/O) runs inside the critical section.
**Root cause:** The lock serializes every consumer — only one can process at a time, no matter how many cores. Throughput collapses to single-threaded, and producers block longer on `notFull` because the lock is held during processing.
**Fix:** Take the item under the lock, *release the lock*, then process outside it: `T x = take(); ... process(x);`.

---

## Bug 5 — Single Poison Pill for N Consumers

```java
// 4 consumers running, each: while ((x = q.take()) != POISON) process(x);
q.put(POISON);   // BUG: one pill, four consumers
```

**What's wrong:** One poison pill for four consumers.
**Root cause:** The first consumer takes the pill and exits. The other three block forever on `take()` of an empty queue — the program never terminates (hung threads, a JVM that won't shut down).
**Fix:** Enqueue one pill per consumer: `for (int i = 0; i < N; i++) q.put(POISON);`. (In Go, `close(ch)` solves this for all consumers at once.)

---

## Bug 6 — Closing a Channel From Multiple Producers

```go
for i := 0; i < 3; i++ {
    go func() {
        for _, x := range chunk() { ch <- x }
        close(ch)   // BUG: every producer closes
    }()
}
```

**What's wrong:** Each of three producer goroutines calls `close(ch)`.
**Root cause:** Closing an already-closed channel panics; sending on a closed channel panics. The first goroutine to finish closes `ch`, and the others either close again or send into the closed channel → runtime panic.
**Fix:** Producers never close. A coordinator closes once after all finish: `var wg sync.WaitGroup; ...; go func(){ wg.Wait(); close(ch) }()`.

---

## Bug 7 — Mutating an Item After Handoff

```java
Order o = new Order();
o.setItems(items);
queue.put(o);
o.setStatus(SHIPPED);   // BUG: mutating after handoff
```

**What's wrong:** The producer mutates `o` after putting it on the queue.
**Root cause:** A consumer may already be reading `o` on another thread. The post-`put` write has *no happens-before edge* to the consumer's read (the queue published the state *as of* `put`). This is a data race — undefined behavior, not just a stale field. The consumer may see `SHIPPED`, the old status, or torn state.
**Fix:** Make `Order` immutable, or set all fields *before* `put` and never touch it again. Transfer ownership and forget.

---

## Bug 8 — Unbounded Queue in a Thread Pool

```java
ExecutorService pool = new ThreadPoolExecutor(
    4, 4, 0L, TimeUnit.MILLISECONDS,
    new LinkedBlockingQueue<>());   // BUG: unbounded queue
```

**What's wrong:** A `LinkedBlockingQueue` with no capacity argument is effectively unbounded (`Integer.MAX_VALUE`).
**Root cause:** Under sustained overload, submitted tasks pile up in the queue with no backpressure. The pool never rejects, the producer never slows, and the queue grows until OOM — with no warning, often after months of fine behavior. (`Executors.newFixedThreadPool` has this exact bug built in.)
**Fix:** Bound the queue (`new ArrayBlockingQueue<>(1000)`) and set a `RejectedExecutionHandler` — `CallerRunsPolicy` gives natural backpressure by running the task on the submitting thread.

---

## Bug 9 — Swallowed `InterruptedException`

```java
while (running) {
    try {
        Task t = queue.take();
        process(t);
    } catch (InterruptedException e) {
        // BUG: ignored
    }
}
```

**What's wrong:** The `InterruptedException` is caught and discarded; the interrupt flag is cleared and not restored.
**Root cause:** Shutdown via `Thread.interrupt()` no longer works — `take()` throws, the exception is swallowed, the loop spins right back to `take()`, and the consumer never stops. The interrupt signal is lost.
**Fix:** Restore the flag and break: `catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }`.

---

## Bug 10 — Poison Pill Enqueued Before Work Drains

```java
producer.start();
for (int i = 0; i < N; i++) q.put(POISON);  // BUG: pills before producer finishes
producer.join();
```

**What's wrong:** Pills are enqueued while the producer is still adding real work.
**Root cause:** A consumer may dequeue a pill while real items remain *behind it* in the queue, exit early, and leave that work unprocessed. With multiple consumers, you lose an unpredictable amount of data.
**Fix:** Drain first: `producer.join();` (or signal producers done) *before* enqueuing the pills, so pills sit strictly after all real work.

---

## Bug 11 — Checking `size()` Then Acting (TOCTOU)

```java
if (queue.size() < capacity) {   // BUG: check-then-act race
    queue.add(item);             // may throw IllegalStateException (queue full)
}
```

**What's wrong:** Reads `size()`, then acts on the stale result.
**Root cause:** Between the `size()` check and the `add`, another producer fills the last slot. The "non-blocking add" (`add`) then throws `IllegalStateException` on a full bounded queue. The state read is invalid the instant the lock is released. Time-of-check to time-of-use.
**Fix:** Use the atomic primitive that does check-and-act under one lock: `queue.offer(item)` (returns `false` if full) or `queue.put(item)` (blocks). Never gate a mutation on a separate `size()` read.

---

## Bug 12 — Producer Closes Channel While Consumers Still Send Back

```go
results := make(chan int)
go func() {
    for j := range jobs { results <- f(j) }
}()
// ... only ONE of several workers; whoever finishes:
close(results)   // BUG: closed while other workers still send
```

**What's wrong:** `results` is closed by one path while other worker goroutines are still sending to it.
**Root cause:** A send on a closed channel panics. The first worker to finish closes `results`; any worker still calling `results <- ...` panics. Same family as Bug 6 but on the *output* channel.
**Fix:** `var wg sync.WaitGroup` over all workers; close once in a dedicated goroutine: `go func(){ wg.Wait(); close(results) }()`. The fan-in collector ranges over `results` and exits cleanly on close.

---

## Practice Tips

- **Scan for `if` around `wait()`/`await()` first** — it's the most common and most subtle bug (Bug 1). Make `while` a reflex.
- **Check the shutdown path, not just the happy path.** Bugs 5, 6, 9, 10, 12 all live in shutdown — the code people write last and test least.
- **Ask "what happens between the check and the act?"** TOCTOU (Bug 11) and lost wakeups come from trusting a value after the lock was released.
- **Hunt for work inside the lock** (Bug 4). If anything slow (I/O, processing) runs under `lock`/`synchronized`, throughput is dead.
- **Treat every unbounded queue as a bug until proven otherwise** (Bug 8). Grep your codebase for `LinkedBlockingQueue` with no capacity and `newFixedThreadPool`.
- **In Go, every `close` is suspect.** Verify it runs exactly once, only after all senders are done (Bugs 6, 12). Run `go test -race` always.
- **Verify immutability of enqueued items** (Bug 7). A producer touching an item after `put` is a data race even if it "seems to work."
- **Reproduce, don't reason.** These bugs are non-deterministic; a stress test with millions of items and a global timeout surfaces them where a single run won't.
