# Monitor Object — Interview Questions

> Graded interview questions for the **Monitor Object** concurrency pattern, from junior fundamentals to professional internals. Each comes with a model answer. See [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md).

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral--architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

**Q1. What is the Monitor Object pattern, in one sentence?**
An object whose synchronized methods run **one thread at a time** (mutual exclusion via a single lock), and which lets blocked threads **cooperatively wait** on conditions until another thread signals a state change. In Java: `synchronized` + `wait`/`notifyAll`.

**Q2. Why must you wait inside a `while` loop, never an `if`?**
Two reasons. **Spurious wakeups:** the JVM is permitted to return from `wait()` with no signal sent. **Stale conditions under Mesa semantics:** between being signaled and re-acquiring the lock, another thread may have already consumed the resource, so the condition you waited for may no longer hold. A `while` re-checks after every wakeup, so code proceeds only when the condition is actually true. An `if` acts on a possibly-false condition and corrupts state.

**Q3. What does `wait()` do, exactly?**
It **atomically** releases the object's monitor lock and puts the thread to sleep until it's signaled (or interrupted). The atomicity is essential — if releasing and sleeping were separate steps, a `notify()` could slip in between them and the thread would sleep through its own wakeup (a lost wakeup).

**Q4. Why does a read-only getter on shared mutable state still need `synchronized`?**
For **visibility** and **atomicity** under the Java Memory Model. Without acquiring the same lock, the reader has no happens-before edge to the writer and may observe a stale value indefinitely, or a torn `long`/`double`. Synchronizing the reader establishes the edge and guarantees a consistent, up-to-date read.

## Middle Questions

**Q5. When is `notify()` safe, and when must you use `notifyAll()`?**
`notify()` is safe only when all waiters are **uniform** (waiting for the same condition) and a single state change enables exactly one of them. With **mixed waiters** on one monitor (producers *and* consumers), `notify()` may wake the wrong kind of thread, which re-checks, fails its condition, and goes back to sleep — leaving the thread that *could* proceed still asleep. Use `notifyAll()` for mixed waiters, or split into multiple `Condition` objects so `signal()` reaches only the right queue.

**Q6. Compare `synchronized`+`wait`/`notify` with `ReentrantLock`+`Condition`.**
`synchronized` is concise, auto-releases on exception, and uses one implicit condition queue. `ReentrantLock` requires explicit `try/finally` but adds: **multiple `Condition`s** (so `signal()` targets specific waiters), **timed** (`tryLock`, `awaitNanos`) and **interruptible** acquisition, **fairness** policy, and (on Loom) it doesn't pin virtual threads. Prefer `ReentrantLock` + named conditions when you have distinct wait reasons or need timeouts.

**Q7. What is reentrancy and why does the Monitor pattern need it?**
Reentrancy lets a thread that already holds the lock acquire it again. Without it, a synchronized method calling another synchronized method on the same object would deadlock against itself. Both Java intrinsic locks and `ReentrantLock` are reentrant; the hold count increments on re-entry and the lock frees only when it returns to zero.

## Senior Questions

**Q8. Explain the happens-before guarantee a monitor provides.**
Unlocking a monitor M *happens-before* every subsequent lock of the same M. So all writes a thread makes while holding the lock are visible to the next thread that acquires it, and the compiler/CPU can't reorder across the lock boundary to break that. This is *why* an unsynchronized reader is a bug even when writers are synchronized — it has no happens-before edge and may see stale or torn state forever.

**Q9. A Monitor is your throughput bottleneck. Walk me up the migration ladder.**
(1) **Shrink the critical section** — move computation/I/O/allocation outside the lock. (2) **Split conditions** to kill `notifyAll` thundering herds. (3) **Lock striping** — partition into per-stripe Monitors (caution: cross-stripe atomicity is lost). (4) **Read/write separation** — `StampedLock` optimistic reads for read-mostly state. (5) **Lock-free / CAS** for proven hot paths. Don't skip rungs; most "too slow" cases are fixed at rung 1.

**Q10. What is nested monitor lockout and how do you prevent it?**
A thread holds lock A, enters a synchronized method on B, and calls `B.wait()`. `wait()` releases **only B** — the thread keeps A. Any thread needing A to ever produce B's condition is now blocked, and the waiter sleeps forever holding A → deadlock. Prevent it by never calling `wait()`/`await()` while holding more than one lock, not waiting while holding locks over code you don't control, and enforcing a documented global lock ordering.

## Professional Questions

**Q11. Why can a `synchronized` block hurt a virtual-thread (Loom) service, and what's the fix?**
A virtual thread blocked inside `synchronized` historically **pins** its carrier OS thread (it can't unmount while holding the native monitor frame), starving the carrier pool and defeating Loom's scalability. A virtual thread blocked on `ReentrantLock`/`Condition` unmounts cleanly. Fix: prefer `ReentrantLock` for hot-path Monitors. JDK 24 (JEP 491) removed most `synchronized` pinning, but explicit locks remain the safer default across mixed fleets.

**Q12. Why does `notifyAll()` on a deep wait set destroy tail latency?**
`notifyAll()` moves *all* waiters from the wait set to the entry list, then they **serialize through the single lock** one at a time — N unparks, N context switches, N re-checks where typically N−1 immediately re-sleep (thundering herd). At depth this spikes p99/p999. Fix: dedicated `Condition`s + `signal()` so only the single relevant waiter is unparked.

**Q13. Walk through what happens in the JVM when two threads contend on a `synchronized` method.**
First acquirer takes a **thin lock** via one CAS on the object header's mark word (~20 ns, no kernel). On contention the lock **inflates** into a heavyweight `ObjectMonitor` backed by an OS mutex/condvar (`futex` on Linux). The loser parks, joining the monitor's entry list; the holder's release unparks a successor. HotSpot adaptively **spins** briefly before parking, betting on a short critical section — which is why short sections stay cheap and never hit the kernel.

## Coding Tasks

**T1.** Implement a thread-safe bounded buffer with `put`/`take` using `synchronized` + `wait`/`notifyAll`. Justify every `while`.

**T2.** Reimplement it with `ReentrantLock` + two `Condition`s and replace `notifyAll` with targeted `signal`. Explain why `signal` is now safe.

**T3.** Add `poll(timeout, unit)` with correct deadline arithmetic using `awaitNanos`, returning `null` on timeout.

**T4.** Implement a `CountDownLatch` (`await`, `countDown`) as a Monitor Object from scratch.

**T5.** Implement a bounded `Semaphore` (`acquire`, `release`) with `ReentrantLock` + `Condition`; make `acquire` interruptible.

## Trick Questions

**TQ1. "If Java used Hoare semantics, could you use `if` instead of `while`?"**
Under pure Hoare ("signal-and-urgent-wait", signaled thread runs immediately with the condition still true) `if` *would* suffice for the stale-condition concern — but Java uses **Mesa** ("signal-and-continue"), and the JMM *also* permits **spurious wakeups**, so even then `while` is required. The honest answer: in Java, always `while`, regardless.

**TQ2. "Does `notifyAll()` release the lock?"**
No. `notify`/`notifyAll` only mark waiters as eligible to wake; the signaling thread keeps the lock and continues until it exits the synchronized block or calls `wait()` itself. Woken threads can't run until the signaler releases.

**TQ3. "A producer calls `notify()` before any consumer waits. Is the signal queued?"**
No — `notify`/`notifyAll` wake only threads *currently* in `wait()`; they aren't queued or remembered. This is the **lost-wakeup** hazard. It's defused by keeping state-change + signal under the same lock and re-checking with `while`: the consumer either already sees the new state (and never waits) or is waiting and gets woken.

**TQ4. "Two `synchronized` methods, one `static` and one instance — do they exclude each other?"**
No. `static synchronized` locks the `Class` object; instance `synchronized` locks `this`. Different monitors, no mutual exclusion between them.

## Behavioral / Architectural Questions

**BQ1. Tell me about a concurrency bug you debugged.**
Strong answers name the *class* of bug (lost wakeup, `if`-instead-of-`while`, missing reader synchronization, lock-ordering deadlock), how you *reproduced* it deterministically (latches to pin interleaving, stress test asserting an invariant), the root cause in happens-before terms, and the fix plus the regression test that now guards it.

**BQ2. How would you decide between a hand-rolled Monitor and `java.util.concurrent`?**
Default to `j.u.c` — `ArrayBlockingQueue`, `Semaphore`, `CountDownLatch` are audited Monitor implementations. Hand-roll only when no library type fits the required semantics. Frame it as risk: custom `wait`/`notify` code is a top source of production concurrency bugs.

**BQ3. A teammate proposes making a whole cache one big `synchronized` object. Push back.**
A coarse Monitor over a hot, read-mostly cache is a serialization ceiling (Amdahl) and convoys every request behind any slow holder (e.g. a GC pause under the lock). Propose `ConcurrentHashMap` / lock striping for partitionable access, or `StampedLock`/copy-on-write for read-mostly snapshots — keeping a Monitor only where a multi-field invariant genuinely requires it.

## Tips for Answering

- **Lead with the invariant, then the mechanism.** Say *what must stay true* (only one thread inside; condition holds on return) before reciting `wait`/`notify`.
- **Always volunteer `while`-not-`if`** when conditions come up — interviewers use it as a litmus test.
- **Reason in happens-before terms** for senior+ questions, not just "it's thread-safe."
- **Know the contrast with [Active Object](../01-active-object/interview.md):** Monitor runs in the *caller's* thread and serializes on the lock; Active Object runs in its *own* thread.
- **Quantify when you can:** "uncontended ~20 ns, contended ~µs with a kernel park" signals professional depth.
- **State trade-offs unprompted:** simplicity and a strong invariant vs a serialization bottleneck and thundering-herd risk.
