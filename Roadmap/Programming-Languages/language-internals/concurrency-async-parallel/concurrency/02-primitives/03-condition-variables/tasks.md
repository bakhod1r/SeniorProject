# Condition Variables — Hands-On Tasks

> **Topic:** [Condition Variables](README.md)

---

## Introduction

Condition variables are the synchronization primitive you reach for when a thread must wait for a state change owned by another thread. Unlike a mutex (which protects state) or a semaphore (which counts permits), a condition variable lets a thread sleep efficiently until some predicate becomes true, and lets another thread wake one or all sleepers when it has changed that predicate.

The deceptively simple API hides several traps that this task set forces you to confront in code:

- Condition variables only work in cooperation with a mutex. The mutex protects the predicate. The condition variable lets you wait for it.
- You must check the predicate in a `while` loop, never an `if`, because of spurious wakeups and stolen notifications.
- `signal` (notify one) and `broadcast` (notify all) are not interchangeable. Picking the wrong one causes deadlocks or wasted wakeups.
- "Lost wakeups" occur when a signal is sent before the waiter has actually started waiting. The mutex discipline is what prevents this.
- Condition variables are building blocks. Barriers, latches, bounded buffers, futures, and semaphores can all be built on top of `mutex + condvar`.

The exercises are deliberately language-agnostic. Reference solutions are sketched in Go (`sync.Cond`), Java (`Object.wait/notify` and `Condition`), C/POSIX (`pthread_cond_t`), and pseudocode where useful. Pick whichever ecosystem you are studying. The behaviours are universal.

Work the tasks in order. Each section builds on the previous one, and the Capstones assume you have internalised the patterns from Core and Advanced. Do not skim. Type the code. Run the races. Watch the wakeups in a debugger.

---

## Table of Contents

- [Warm-Up](#warm-up)
  - [Task 1: Hello, signal](#task-1-hello-signal)
  - [Task 2: Predicate in a loop](#task-2-predicate-in-a-loop)
  - [Task 3: Spurious wakeup reproduction](#task-3-spurious-wakeup-reproduction)
  - [Task 4: Timed wait](#task-4-timed-wait)
  - [Task 5: Broadcast versus signal demonstration](#task-5-broadcast-versus-signal-demonstration)
  - [Task 6: Signal-before-wait race](#task-6-signal-before-wait-race)
  - [Task 7: Single-producer single-consumer slot](#task-7-single-producer-single-consumer-slot)
- [Core](#core)
  - [Task 8: Bounded buffer with two condition variables](#task-8-bounded-buffer-with-two-condition-variables)
  - [Task 9: Reader-writer lock from a condition variable](#task-9-reader-writer-lock-from-a-condition-variable)
  - [Task 10: One-shot barrier](#task-10-one-shot-barrier)
  - [Task 11: Reusable CountDownLatch](#task-11-reusable-countdownlatch)
  - [Task 12: CyclicBarrier with generation counters](#task-12-cyclicbarrier-with-generation-counters)
  - [Task 13: Lost-wakeup reproduction and fix](#task-13-lost-wakeup-reproduction-and-fix)
  - [Task 14: Multiple condition variables sharing one mutex](#task-14-multiple-condition-variables-sharing-one-mutex)
  - [Task 15: Bounded semaphore from condition variable](#task-15-bounded-semaphore-from-condition-variable)
  - [Task 16: Producer fairness audit](#task-16-producer-fairness-audit)
  - [Task 17: Thread-safe future](#task-17-thread-safe-future)
- [Advanced](#advanced)
  - [Task 18: Phaser-style workflow](#task-18-phaser-style-workflow)
  - [Task 19: Benchmark broadcast versus signal under contention](#task-19-benchmark-broadcast-versus-signal-under-contention)
  - [Task 20: Futex-backed condvar toy](#task-20-futex-backed-condvar-toy)
  - [Task 21: LockSupport.park and unpark in Java](#task-21-locksupportpark-and-unpark-in-java)
  - [Task 22: Analyse a lost wakeup in a real codebase](#task-22-analyse-a-lost-wakeup-in-a-real-codebase)
  - [Task 23: Priority-aware condvar wakeups](#task-23-priority-aware-condvar-wakeups)
  - [Task 24: Cancellation-safe condvar wait](#task-24-cancellation-safe-condvar-wait)
  - [Task 25: Wait-morphing scheduler experiment](#task-25-wait-morphing-scheduler-experiment)
- [Capstone](#capstone)
  - [Capstone 1: Priority job queue](#capstone-1-priority-job-queue)
  - [Capstone 2: Reusable countdown latch](#capstone-2-reusable-countdown-latch)
  - [Capstone 3: Parallel-stage workflow engine](#capstone-3-parallel-stage-workflow-engine)
  - [Capstone 4: Backpressure-aware ingest pipeline](#capstone-4-backpressure-aware-ingest-pipeline)
- [Sample Solutions](#sample-solutions)
- [Related Topics](#related-topics)

---

## Warm-Up

The Warm-Up section exists to put the mutex-plus-predicate-plus-loop pattern into your hands. Until that triad feels automatic, every condition variable program you write will eventually deadlock or drop wakeups. Resist the temptation to optimise here. Wait until the Core section to start exploring two condition variables, fairness, and ordering.

### Task 1: Hello, signal

**Problem.** Write a program with two threads. Thread A waits on a condition variable until a shared boolean `ready` becomes `true`. Thread B sleeps for one second, sets `ready = true` under the mutex, and signals the condition variable. Thread A then prints "go" and exits.

**Constraints.**

- Use exactly one mutex and one condition variable.
- The mutex must be held while reading and writing `ready`.
- Use `signal` (notify one), not `broadcast`.

**Hints.** In Go, prefer `sync.Cond` with `cond.L.Lock()` and `cond.Wait()`. In Java, prefer `ReentrantLock` and `Condition` over the legacy `Object.wait`. In C, pair `pthread_cond_wait(&cv, &mu)` with `pthread_cond_signal`.

**Self-check.**

- Does thread A always print "go", regardless of which thread is scheduled first?
- If you remove the mutex from the signaller, does the program still appear to work? (It might today and break tomorrow under load. See Task 6.)
- What happens if you call `Wait` without first holding the mutex?

### Task 2: Predicate in a loop

**Problem.** Take the program from Task 1 and replace the `if (!ready) wait();` pattern with the correct `while (!ready) wait();`. Then deliberately re-introduce the bug by switching back to `if`. Add a third thread that, after thread A wakes, briefly sets `ready = false` and signals again, simulating a stolen wakeup.

**Constraints.**

- Reproduce a scenario in which thread A proceeds with `ready == false` when using `if`.
- Confirm the bug disappears when using `while`.

**Hints.** To force the race, after thread B signals, have a thread C immediately re-acquire the mutex and reset `ready = false`. Insert a small `sleep` before the consumer checks the predicate.

**Self-check.**

- Why does `while` fix this, even though only one thread ever sets `ready = true`?
- How would a spurious wakeup, in the absence of thread C, also break the `if` variant?

### Task 3: Spurious wakeup reproduction

**Problem.** Demonstrate a spurious wakeup. On most platforms `pthread_cond_wait` is allowed to return without a corresponding `signal` call. Java's `Object.wait` documents the same behaviour. Build a stress harness with 32 waiters and one signaller that signals only once but counts how many waiters return from `wait` without consuming the single notification.

**Constraints.**

- Instrument every `wait` to record whether the predicate was true on wakeup.
- Run the harness for at least 60 seconds across multiple CPU cores.

**Hints.** On modern Linux glibc, spurious wakeups are rare but possible during signal delivery. If you cannot trigger one naturally, simulate by wrapping `Wait` in a helper that randomly returns early without modifying the predicate, to prove your loop handles it.

**Self-check.**

- What is the difference between a spurious wakeup and a stolen wakeup?
- Why does the POSIX standard explicitly allow spurious wakeups rather than mandate exact wakeup counts?

### Task 4: Timed wait

**Problem.** Implement a `WaitFor(timeout)` consumer that gives up if no signal arrives within a deadline. The producer signals on a 50/50 random schedule: half the time before the deadline, half the time after.

**Constraints.**

- Distinguish three return cases: predicate satisfied, timeout, spurious wakeup.
- Re-arm the wait correctly after a spurious wakeup, recomputing the remaining time.

**Hints.** In Go, use `cond.Wait()` combined with a `time.AfterFunc` that calls `cond.Broadcast` and sets a `timedOut` flag. In Java, `Condition.awaitNanos` returns the remaining nanoseconds, which simplifies the loop.

**Self-check.**

- After a spurious wakeup, do you wait the full timeout again or only the remainder?
- What return value tells the caller whether they timed out versus succeeded?

### Task 5: Broadcast versus signal demonstration

**Problem.** Create a producer that drops a batch of N items into a shared queue, then calls `signal` once. Have N consumers each waiting in a loop. Observe that exactly one consumer is woken and the others remain blocked even though items exist. Then replace the single `signal` with `broadcast`. Observe all N consumers wake.

**Constraints.**

- Print, from each consumer, the time it entered and exited `wait`.
- Do not call `signal` inside the consumer to chain-wake peers; the goal is to expose the difference, not to mask it.

**Hints.** When the producer pushes N items, you must either call `signal` N times or `broadcast` once. Calling `signal` once is the bug.

**Self-check.**

- When is `signal` strictly correct and `broadcast` wasteful?
- When is `broadcast` necessary, even when only one consumer can make progress?

### Task 6: Signal-before-wait race

**Problem.** Write the worst-case version of Task 1: thread B signals immediately without holding the mutex, and thread A starts waiting microseconds later. Confirm that the signal is lost and thread A waits forever. Then re-introduce the mutex on the signaller side and confirm the program completes.

**Constraints.**

- The race must reproduce in under one second of run time on your machine. Use a tight loop or a barrier to force the timing.

**Hints.** The mutex on the signaller side is not protecting the condition variable's internal state. It is preventing the predicate from being set between the waiter's predicate check and its actual `wait` call.

**Self-check.**

- Where, exactly, is the lost-wakeup window in the unsafe version?
- Why does holding the mutex while signalling not noticeably reduce throughput in most workloads?

### Task 7: Single-producer single-consumer slot

**Problem.** Implement a `Slot[T]` that holds either zero or one value. `Put(x)` blocks until the slot is empty, then stores `x`. `Get()` blocks until the slot is full, then removes and returns the value. Use two condition variables: `notFull` and `notEmpty`, sharing one mutex.

**Constraints.**

- Both `Put` and `Get` must check their predicate in a loop.
- Signal the correct condition variable after every state change.

**Hints.** This is a baby bounded buffer with capacity 1. Get the patterns right here; Task 8 generalises the same code.

**Self-check.**

- Why do you signal `notEmpty` from `Put` and `notFull` from `Get`?
- Is `signal` sufficient for both, or do you need `broadcast`?

---

## Core

Now the patterns escalate. You will build the canonical "condition variable" data structures — bounded buffer, RW lock, barriers, latches — from scratch. By the end of this section the textbook examples in Goetz, Herlihy-Shavit, and the POSIX manuals should read as obvious to you, because you have implemented them.

### Task 8: Bounded buffer with two condition variables

**Problem.** Implement `BoundedQueue[T]` with capacity N. `Enqueue(x)` blocks while the queue is full. `Dequeue()` blocks while the queue is empty. Use one mutex and two condition variables (`notFull`, `notEmpty`).

**Constraints.**

- Both operations check their predicate in a `while` loop.
- Use `signal` rather than `broadcast` whenever exactly one consumer can make progress.
- Provide a `Close()` method that wakes all blocked threads and causes subsequent calls to return an error.

**Hints.** Store items in a ring buffer. Track `count` rather than computing it from head and tail. After an `Enqueue`, signal `notEmpty`. After a `Dequeue`, signal `notFull`.

**Self-check.**

- Could you implement this with one condition variable and `broadcast`? What is the cost?
- How does `Close` ensure no thread is left waiting forever?

### Task 9: Reader-writer lock from a condition variable

**Problem.** Build a `RWMutex` whose internal state is `int readers, bool writerActive, int waitingWriters`. Implement `RLock`, `RUnlock`, `Lock`, `Unlock`. Use one mutex and one condition variable.

**Constraints.**

- Readers must wait if a writer holds the lock or is waiting (writer-preference variant).
- Writers must wait if any readers hold the lock or another writer holds it.
- On `Unlock`, choose between waking one writer or broadcasting to all readers.

**Hints.** Writer wakeups are always `signal`. Reader wakeups should be `broadcast` because many readers may proceed at once. The trickiest part is preventing reader starvation; track `waitingWriters` and have readers wait if it is non-zero.

**Self-check.**

- What is the wakeup signature on `Unlock` from a writer? From the last reader?
- Could you reasonably implement this with two condition variables (`canRead`, `canWrite`)? What changes?

### Task 10: One-shot barrier

**Problem.** Implement a one-shot barrier that blocks N threads until all N have arrived, then releases them all. The barrier is single-use.

**Constraints.**

- The Nth thread to call `Await()` must wake the other N-1 with `broadcast`.
- After release, the barrier object must not be reused; calling `Await` again should error or assert.

**Hints.** Track `arrived` count. When `arrived == N`, set a `released` flag and broadcast.

**Self-check.**

- Why `broadcast` and not `signal`?
- Why does the predicate need to be `released == true` rather than `arrived == N`?

### Task 11: Reusable CountDownLatch

**Problem.** Implement Java's `CountDownLatch` semantics with `Await()` and `CountDown()`. Initial count is N. `CountDown()` decrements; `Await()` blocks until count reaches zero. Then extend it to be reusable: a `Reset(newCount)` method that wakes existing waiters with an error and re-arms the latch.

**Constraints.**

- Once at zero, any future `Await` must return immediately.
- `Reset` must not silently invalidate currently waiting threads.

**Hints.** Use a generation counter, similar to CyclicBarrier (Task 12), so that waiters can detect a reset and bail out.

**Self-check.**

- What does the predicate look like on the `while` loop inside `Await`?
- Why is "reusable countdown latch" considered an anti-pattern by some? When is the rebuild-from-scratch pattern simpler?

### Task 12: CyclicBarrier with generation counters

**Problem.** Implement a barrier reusable across multiple phases. After N threads arrive, all are released and the barrier is rearmed for the next phase. Provide a `BarrierAction` callback that runs once per phase on the releasing thread before threads are released.

**Constraints.**

- Generations must be tracked explicitly to prevent a slow thread from one generation from being held back into the next.
- If a thread is interrupted while waiting, all threads must be broken out with an error to avoid deadlock.

**Hints.** Read Doug Lea's `CyclicBarrier` source code. The `Generation` inner class with a `broken` flag is the key insight.

**Self-check.**

- Why does the barrier action run on exactly one thread rather than all?
- What happens to threads waiting on generation G if a generation G+1 reset begins prematurely?

### Task 13: Lost-wakeup reproduction and fix

**Problem.** Construct a deliberately broken bounded queue in which the producer signals before acquiring the mutex. Demonstrate that under heavy load, consumers occasionally block forever even though items are present. Then fix it by moving the signal inside the critical section, and explain why this works.

**Constraints.**

- Run with at least 4 producers and 4 consumers for 30 seconds.
- Use a watchdog thread that fails the test if any consumer is blocked for more than 5 seconds with items available.

**Hints.** The race window is between the consumer's predicate check and its `wait` call. The producer can push an item and signal in that window, and the consumer will then call `wait` and block on a queue that already has an item.

**Self-check.**

- Does it matter whether the signal is sent immediately before or immediately after `unlock`? What is the trade-off?
- Many high-performance condvar implementations explicitly allow signal-after-unlock. What invariant do they preserve?

### Task 14: Multiple condition variables sharing one mutex

**Problem.** Re-implement the bounded buffer of Task 8 with three condition variables: `notFull`, `notEmpty`, and `drained` (for `Flush()` callers waiting until the queue is empty). All three share one mutex.

**Constraints.**

- After every state transition, signal exactly the condition variables that may have changed predicates.
- `Flush()` must not return early if items remain.

**Hints.** Adding more condition variables sharing a mutex is fine and often clearer than overloading one. The cost is being disciplined about which signal goes where.

**Self-check.**

- After `Dequeue`, which of the three condition variables might need a signal? Under what conditions?
- Why is it incorrect to put two of these condition variables under different mutexes?

### Task 15: Bounded semaphore from condition variable

**Problem.** Implement `Semaphore(N)` with `Acquire()` and `Release()` using only a mutex and a condition variable. Acquire blocks while count is zero; Release increments and signals.

**Constraints.**

- Provide a `TryAcquire()` non-blocking variant.
- Provide a `TryAcquireFor(d)` timed variant.

**Hints.** This is one of the simplest condvar exercises and is a great way to internalise the pattern.

**Self-check.**

- Does this implementation provide FIFO fairness? If not, can you modify it to do so without changing the data structure?
- How does this compare to the kernel-backed semaphores you may have used before?

### Task 16: Producer fairness audit

**Problem.** Take the bounded buffer of Task 8. Run with 8 producers and 1 consumer. Measure, per producer, how many enqueues each completes. Run for 60 seconds. Then introduce a fairness mechanism (FIFO queue of waiting producers) and re-measure.

**Constraints.**

- Plot or print a histogram of completions per producer.
- The fair variant should keep the standard deviation across producers within 5 percent of the mean.

**Hints.** Standard condition variables do not guarantee FIFO. To get fairness, maintain an explicit waiter queue of node objects, each with its own condition variable.

**Self-check.**

- Why does naive `signal` tend to wake the most-recently-blocked thread on some implementations?
- What is the performance cost of FIFO fairness?

### Task 17: Thread-safe future

**Problem.** Implement a `Future[T]` with `Set(value)`, `Get()` (blocking), and `GetWithTimeout(d)`. Multiple threads may call `Get` concurrently. `Set` may be called at most once; subsequent calls should error.

**Constraints.**

- After `Set`, all current and future `Get` callers must return the value without blocking.
- Use `broadcast` on `Set`, not `signal`.

**Hints.** Once-only set means the predicate transitions exactly once from false to true and never back. Many callers may be waiting; all must be released.

**Self-check.**

- Could you use `sync.Once` plus a channel instead of a condvar in Go? Compare ergonomics.
- What is the difference between a future and a promise in your language of choice?

---

## Advanced

The Advanced section is where you confront real implementation pressure: contention, fairness, deadline awareness, and kernel-level primitives. Reading the JDK and glibc sources is encouraged. Expect to spend several hours per task.

### Task 18: Phaser-style workflow

**Problem.** Implement Java's `Phaser` semantics, which generalises a CyclicBarrier with dynamic registration and deregistration. Threads may join or leave between phases, and phase advancement waits for all currently registered parties to arrive.

**Constraints.**

- Support `Register()`, `Arrive()`, `ArriveAndDeregister()`, `AwaitAdvance(phase)`.
- A registered party that never arrives must block the phase advance indefinitely (unless deregistered).

**Hints.** Track `registered` and `arrived` counts. Advance when `arrived == registered`, then broadcast and increment the phase counter.

**Self-check.**

- How does deregistering during a phase change the predicate semantics?
- Why is `Phaser` strictly more flexible than `CyclicBarrier`?

### Task 19: Benchmark broadcast versus signal under contention

**Problem.** Take the bounded buffer of Task 8. Build a benchmark that runs P producers and C consumers for 30 seconds and reports throughput. Vary (P, C) over the grid {(1,1), (1,8), (8,1), (8,8), (32,32)}. Compare two implementations: one that always calls `broadcast`, and one that calls `signal` precisely.

**Constraints.**

- Report not only throughput but also per-thread average wakeup latency.
- Include a "thundering herd" measurement: how often a wakeup occurs only to immediately re-wait.

**Hints.** On Linux you can read `/proc/self/sched` per thread. In Go, runtime tracing via `runtime/trace` shows goroutine wakeups precisely.

**Self-check.**

- At which (P, C) ratios does `broadcast` outperform `signal`? Why?
- What does the "thundering herd" metric tell you about the cost of unnecessary wakeups?

### Task 20: Futex-backed condvar toy

**Problem.** On Linux, implement a minimal `Cond` using only the `futex(2)` syscall and atomic integers. Provide `Wait(mu)`, `Signal`, `Broadcast`. Do not use glibc's `pthread_cond_t`.

**Constraints.**

- Use `FUTEX_WAIT` for sleeping and `FUTEX_WAKE` for waking.
- Handle the lost-wakeup race using a sequence counter: increment on every signal, snapshot on entry to `Wait`, and pass the snapshot to `FUTEX_WAIT`.

**Hints.** Read the glibc `nptl/pthread_cond_wait.c` source. The "g1/g2 group" design is the production-grade version of the same idea.

**Self-check.**

- Why is a sequence counter necessary even with the mutex held?
- What goes wrong if you naively call `FUTEX_WAKE` without first updating a state word?

### Task 21: LockSupport.park and unpark in Java

**Problem.** Java's `java.util.concurrent.locks.LockSupport` is a thin wrapper over thread-level park/unpark, which is itself the building block of `AbstractQueuedSynchronizer` and therefore of `ReentrantLock`, `Semaphore`, `CountDownLatch`, and many more. Implement a CountDownLatch using only `LockSupport.park` and `unpark`, without using `Condition` or `Object.wait`.

**Constraints.**

- Maintain an explicit FIFO queue of waiters.
- `unpark` calls must be idempotent (a second `unpark` should not "save up" for the next `park`).

**Hints.** Each waiter pushes its `Thread` reference onto a queue, then parks. The signaller pops one (or all) and calls `unpark(thread)`. Note that `park` may return spuriously, exactly like `wait`.

**Self-check.**

- What is the relationship between park/unpark and the underlying OS primitive (futex, kevent, WaitOnAddress)?
- Why is park/unpark a more flexible base than condition variables for building scheduler-aware synchronisers?

### Task 22: Analyse a lost wakeup in a real codebase

**Problem.** Find a real lost-wakeup or stolen-wakeup bug in an open source project's history. Good candidates: PostgreSQL `lwlock` patches, MySQL InnoDB buffer pool, Java JDK bug database, OpenSSL, Go runtime (`runtime/sema.go`). Write a short report that includes the original buggy code, the fix, and the precise race window.

**Constraints.**

- Cite the issue or commit. Quote no more than ten lines verbatim.
- Reconstruct the race in pseudocode showing thread interleaving.

**Hints.** Start with Java's bug database searching for "lost notify". Or look at Go runtime issues tagged `sync` historically.

**Self-check.**

- Does the fix change the predicate, the locking discipline, or the wakeup logic?
- Could the bug have been caught by a static analyser? Why or why not?

### Task 23: Priority-aware condvar wakeups

**Problem.** Build a condition variable variant in which waiters declare a priority on entry, and `signal` wakes the highest-priority waiter rather than an arbitrary one.

**Constraints.**

- Maintain a heap or skip list of waiting threads keyed on priority.
- Wake-up must be O(log n).

**Hints.** Each waiter inserts itself into a priority queue and parks itself (similar to Task 21). The signaller pops the head and unparks it.

**Self-check.**

- Under what conditions does priority-aware signalling lead to lower-priority starvation?
- How does this compare to real-time OS `pthread_cond_signal` semantics with priority inheritance?

### Task 24: Cancellation-safe condvar wait

**Problem.** Extend the bounded buffer of Task 8 to support per-call cancellation: each `Enqueue` and `Dequeue` takes a `Context` (Go) or `Cancellation Token` (.NET/Java equivalent). On cancellation, the waiter must wake promptly and return an error without leaving the queue in an inconsistent state.

**Constraints.**

- Cancellation latency must be under 10 milliseconds in the common case.
- Cancellation of one waiter must not affect other waiters.

**Hints.** In Go, run a small goroutine alongside `cond.Wait` that calls `cond.Broadcast` on context cancellation. In Java, `Condition.await` already throws `InterruptedException`.

**Self-check.**

- Why does cancellation require `broadcast` rather than `signal`?
- What state must you check on wakeup: predicate first, or cancellation first? Why?

### Task 25: Wait-morphing scheduler experiment

**Problem.** "Wait morphing" is a technique used in some condvar implementations where, instead of waking a thread from a futex, the kernel directly moves the waiter from the condvar's wait queue to the mutex's wait queue. This avoids a thundering herd when many waiters are released and immediately contend for the same mutex. Measure the impact by writing a stress test where 64 waiters are blocked on a condition variable, and a single producer calls `broadcast` once per second for a minute. Compare aggregate wakeup latency on a system with wait morphing (modern glibc on Linux) versus a system without.

**Constraints.**

- Use `perf sched` or `bpftrace` to count futex wakeups and immediate re-sleeps.
- Plot a histogram of "wait-to-runnable" latency for the 64 waiters.

**Hints.** Setting `GLIBC_TUNABLES=glibc.pthread.rseq=0` can disable some optimisations and exposes the contrast.

**Self-check.**

- How is wait morphing related to PI-futex and priority inheritance?
- Why is this an OS-level optimisation rather than a user-space library trick?

---

## Capstone

The capstones are integrative. Each combines several condition variables, multiple data structures, and external lifecycle concerns (shutdown, cancellation, timeouts). Plan to spend at least one full day per capstone. Capstones are not graded by tests alone; they require a written design note covering predicates, locking discipline, wake-up rules, and failure modes.

### Capstone 1: Priority job queue

**Problem.** Design and build a thread-safe job queue with the following semantics:

- Each job has a numeric priority (lower number = higher priority).
- `Submit(job)` adds the job. Never blocks.
- `Take()` blocks until a job is available and returns the highest-priority one.
- `TakeWithDeadline(d)` adds a deadline.
- `Shutdown()` causes all current and future `Take` calls to return `ErrShuttingDown`.
- The queue exposes `Size()` and `Stats()` (peak queue length, total jobs taken, average wait time).

**Constraints.**

- Use a min-heap for storage.
- Use exactly one mutex and one or two condition variables. Justify your choice.
- Avoid deadlock between `Submit` and `Shutdown`.
- Provide a benchmark that runs at least 1 million jobs through the queue.

**What "done" looks like.**

- All tests pass under `-race` (Go) or `-fsanitize=thread` (C/C++).
- A documented design note in the source explaining your predicate, your wake-up rule, and why `signal` versus `broadcast` was chosen.
- Throughput within 30 percent of a non-blocking channel of equivalent capacity.
- Graceful shutdown: every blocked `Take` returns within 100 ms.

### Capstone 2: Reusable countdown latch

**Problem.** Build a `ReusableLatch` that supports:

- `Reset(n)`: sets the count and rearms the latch.
- `CountDown()`: decrements toward zero.
- `Await()`: blocks until count reaches zero.
- `AwaitWithDeadline(d)`.
- Multiple cycles of reset / count-down / await without data races.

The key challenge is generation tracking. A thread that calls `Await` during generation G must not be released by a count-down in generation G+1, even if the implementation is sloppy about timing.

**Constraints.**

- Use a `generation` counter alongside the count.
- `Await` waits while `generation == myGeneration && count > 0`.
- `Reset` increments the generation and broadcasts.
- `Reset` while waiters from a previous generation are still blocked is allowed and must wake them with a defined error.

**What "done" looks like.**

- A fuzz test that interleaves `Reset`, `CountDown`, and `Await` randomly and checks for hangs, double-wakes, or stale releases.
- A formal predicate written in the code comments. Verify that every `wait` checks exactly this predicate.

### Capstone 3: Parallel-stage workflow engine

**Problem.** Build an engine that runs a directed acyclic graph of stages. Each stage may have multiple worker threads. A downstream stage starts only after all workers of all its upstream stages have finished. Within a single execution of the DAG, condition variables coordinate stage barriers.

**Constraints.**

- Each stage has a `CountDownLatch` for its workers and a `notify` link to downstream stages.
- The engine must support cancellation: cancelling the whole DAG releases all blocked workers within 100 ms.
- The engine must support per-stage timeouts.
- A failing worker must short-circuit the entire DAG.

**What "done" looks like.**

- A diagram of the DAG plus per-stage condvar layout in the design note.
- A test suite with at least 30 stages and varied fan-in / fan-out.
- A chaos test that injects random failures and verifies the engine always terminates.

### Capstone 4: Backpressure-aware ingest pipeline

**Problem.** Build an ingest pipeline with three stages: read, parse, write. Each stage is a worker pool. Stages communicate via bounded queues (from Task 8) with condition variables for not-full and not-empty. Backpressure propagates upstream: if writers slow down, parsers block, then readers block. The pipeline must drain cleanly on shutdown without losing in-flight records.

**Constraints.**

- Per-stage instrumentation: queue depth, average wait time, throughput.
- Graceful shutdown: close the head queue, drain through, terminate.
- Crash recovery: surface any worker panic as a pipeline error, drain remaining work, shut down.

**What "done" looks like.**

- A benchmark showing throughput scales near-linearly with stage parallelism up to 8 workers per stage.
- A shutdown test that verifies zero data loss.
- A design note explaining where condition variables are correct versus where you would prefer channels or queues in your language ecosystem.

---

## Sample Solutions

The sketches below illustrate the canonical patterns. They are not optimal production code; they are scaffolds you can complete and harden.

### Sample 1: Bounded queue in Go (Task 8)

```go
type BoundedQueue[T any] struct {
    mu       sync.Mutex
    notFull  *sync.Cond
    notEmpty *sync.Cond
    buf      []T
    head     int
    tail     int
    count    int
    closed   bool
}

func NewBoundedQueue[T any](capacity int) *BoundedQueue[T] {
    q := &BoundedQueue[T]{buf: make([]T, capacity)}
    q.notFull = sync.NewCond(&q.mu)
    q.notEmpty = sync.NewCond(&q.mu)
    return q
}

func (q *BoundedQueue[T]) Enqueue(x T) error {
    q.mu.Lock()
    defer q.mu.Unlock()
    for q.count == len(q.buf) && !q.closed {
        q.notFull.Wait()
    }
    if q.closed {
        return errClosed
    }
    q.buf[q.tail] = x
    q.tail = (q.tail + 1) % len(q.buf)
    q.count++
    q.notEmpty.Signal()
    return nil
}

func (q *BoundedQueue[T]) Dequeue() (T, error) {
    var zero T
    q.mu.Lock()
    defer q.mu.Unlock()
    for q.count == 0 && !q.closed {
        q.notEmpty.Wait()
    }
    if q.count == 0 {
        return zero, errClosed
    }
    x := q.buf[q.head]
    q.head = (q.head + 1) % len(q.buf)
    q.count--
    q.notFull.Signal()
    return x, nil
}

func (q *BoundedQueue[T]) Close() {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.closed = true
    q.notFull.Broadcast()
    q.notEmpty.Broadcast()
}
```

Note the `while` (in Go, `for`) loops around the predicates, the dual signals on state change, and `Broadcast` on `Close` to release every blocked caller.

### Sample 2: CyclicBarrier in pseudocode (Task 12)

```
class Generation {
    bool broken = false
}

class CyclicBarrier {
    Mutex mu
    Cond trip
    int parties
    int count
    Generation generation
    Action barrierAction

    Await():
        mu.lock()
        Generation g = generation
        if g.broken:
            mu.unlock()
            throw BrokenBarrierException
        count--
        if count == 0:
            // last arriver
            barrierAction()
            count = parties
            generation = new Generation()
            trip.broadcast()
            mu.unlock()
            return
        while not g.broken and g == generation:
            trip.wait()
        mu.unlock()
        if g.broken:
            throw BrokenBarrierException

    BreakBarrier():
        generation.broken = true
        count = parties
        generation = new Generation()
        trip.broadcast()
}
```

The `Generation` object is the gate that prevents a thread from one cycle accidentally proceeding into the next.

### Sample 3: Futex-backed condvar in C (Task 20)

```c
typedef struct {
    _Atomic uint32_t seq;
} cond_t;

void cond_wait(cond_t *c, pthread_mutex_t *m) {
    uint32_t old = atomic_load(&c->seq);
    pthread_mutex_unlock(m);
    syscall(SYS_futex, &c->seq, FUTEX_WAIT, old, NULL, NULL, 0);
    pthread_mutex_lock(m);
}

void cond_signal(cond_t *c) {
    atomic_fetch_add(&c->seq, 1);
    syscall(SYS_futex, &c->seq, FUTEX_WAKE, 1, NULL, NULL, 0);
}

void cond_broadcast(cond_t *c) {
    atomic_fetch_add(&c->seq, 1);
    syscall(SYS_futex, &c->seq, FUTEX_WAKE, INT_MAX, NULL, NULL, 0);
}
```

The sequence counter solves the lost-wakeup race: if a signal arrives between the snapshot and the `FUTEX_WAIT`, the kernel returns immediately because the value no longer matches.

### Sample 4: Reusable latch with generation (Capstone 2)

```python
class ReusableLatch:
    def __init__(self, n):
        self.lock = threading.Lock()
        self.cv = threading.Condition(self.lock)
        self.count = n
        self.generation = 0

    def count_down(self):
        with self.cv:
            if self.count == 0:
                return
            self.count -= 1
            if self.count == 0:
                self.cv.notify_all()

    def await_(self):
        with self.cv:
            gen = self.generation
            while self.count > 0 and self.generation == gen:
                self.cv.wait()
            if self.generation != gen:
                raise LatchResetError

    def reset(self, n):
        with self.cv:
            self.generation += 1
            self.count = n
            self.cv.notify_all()
```

Note how `await_` snapshots the generation and exits as soon as the predicate fails, distinguishing a normal release from a reset.

---

Condition variables reward careful thinking and punish hand-waving. If you have worked through every task above, you now own one of the few synchronisation primitives that consistently distinguishes practitioners who can design correct concurrent systems from those who only consume them. Carry the discipline forward: predicate-in-a-loop, signal-under-the-lock, broadcast-when-in-doubt-but-signal-when-you-can-prove-it.

---

## Related Topics

- [Mutexes and Spinlocks](../02-mutexes-spinlocks/README.md)
- [Semaphores](../04-semaphores/README.md)
- [Barriers and Latches](../05-barriers-latches/README.md)
- [Read-Write Locks](../06-rw-locks/README.md)
- [Monitors and Bounded Buffers](../07-monitors/README.md)
- [Lock-Free Queues](../../03-lock-free/01-queues/README.md)
- [Futex and Park/Unpark](../../04-kernel-primitives/01-futex/README.md)
