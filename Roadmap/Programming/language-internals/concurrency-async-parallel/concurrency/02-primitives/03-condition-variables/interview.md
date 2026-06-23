# Condition Variables — Interview Questions

> **Topic:** [Condition Variables](README.md)

---

## Introduction

Condition variables are one of the most misunderstood synchronization primitives in concurrent programming. They are not standalone signaling mechanisms — they are predicate-coordination primitives that *must* be paired with a mutex and a state predicate. Candidates who treat them as "Java's `notify`" or "POSIX's `pthread_cond_signal`" without understanding the atomic release-and-wait contract, spurious wakeups, and the Mesa-style semantics tend to write code that deadlocks, misses wakeups, or wastes CPU spinning.

This interview guide drills the foundational mental model (why a mutex is mandatory, what spurious wakeup means, why predicates must be checked in a loop), language-specific APIs and footguns (pthread, `std::condition_variable`, Java monitors, Python `threading.Condition`, Go `sync.Cond`, Rust `Condvar`), trap questions that catch even senior engineers (lost wakeups, signal-without-state-change, broadcast cost), system-design scenarios (producer/consumer, barriers, latches), and a set of coding questions with sample solutions. The behavioral and "what I'd ask now" sections frame how to evaluate a candidate's depth without resorting to trivia.

Most production bugs around condvars come from three failure modes: (1) checking the predicate with `if` instead of `while`, (2) signaling without holding the mutex that protects the predicate, and (3) calling `signal` when `broadcast` is required (or vice versa). A good candidate will be able to explain each of those failure modes by reproduction, not by recitation.

---

## Table of Contents

1. [Conceptual / Foundational](#conceptual--foundational)
2. [Language-Specific](#language-specific)
3. [Tricky / Trap](#tricky--trap)
4. [System / Design Scenarios](#system--design-scenarios)
5. [Coding Questions](#coding-questions)
6. [Behavioral](#behavioral)
7. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
8. [Cheat Sheet](#cheat-sheet)
9. [Further Reading](#further-reading)
10. [Related Topics](#related-topics)

---

## Conceptual / Foundational

### Q: What is a condition variable, in one sentence?

A condition variable is a synchronization primitive that lets one or more threads block until some shared-state predicate becomes true, and lets another thread wake one or all of them when that predicate may have changed. It is not a lock. It is not a flag. It is a wait queue keyed on a logical condition, and it is always paired with a mutex that protects the shared state involved in that condition. The mutex serializes evaluation of the predicate; the condvar provides the efficient sleep/wakeup mechanism that avoids busy-waiting.

### Q: Why is a condition variable always paired with a mutex?

Because the predicate the waiter is testing is shared mutable state, and any read or write of that state must be serialized by a lock. Without the mutex, a thread could observe a stale value of the predicate, decide to wait, and then sleep — after the signaller has already updated the state and signalled. That is the classic lost-wakeup race. The mutex closes that race by making the "check predicate" and "enter wait queue" steps atomic with respect to "update predicate" and "signal" on the producer side.

### Q: Explain the atomic release-and-wait property.

When a thread calls `wait(mutex)` on a condvar, the runtime guarantees that three operations happen atomically as a unit relative to other waiters and signallers: (1) the mutex is released, (2) the thread is enqueued on the condvar's wait queue, (3) the thread is suspended. Without this atomicity, a signaller could interleave between "release lock" and "enqueue," causing a lost wakeup. When the thread is later woken, the call re-acquires the mutex before returning, so the waiter resumes holding the lock and can safely re-check the predicate.

### Q: What is a spurious wakeup, and why is it allowed?

A spurious wakeup is a wakeup of a waiter that occurs even though no thread called `signal` or `broadcast`. POSIX, Java, Windows, and most runtimes explicitly allow spurious wakeups because forbidding them would force the implementation to use expensive synchronization on every wakeup path (e.g., to disambiguate signal counts during thread migration, signal delivery, or kernel preemption). Because they are allowed, every waiter *must* re-check its predicate after waking. The mental shortcut is "wakeup is a hint, not a fact."

### Q: What is the difference between Mesa-style and Hoare-style condition variables?

Hoare semantics: when a signaller calls `signal`, the signalled waiter immediately runs (with the lock atomically transferred), and the signaller resumes only after the waiter blocks or releases the lock. Mesa semantics: `signal` only marks the waiter as runnable; the signaller continues holding the lock until it explicitly releases it, and the woken waiter must re-acquire the lock and re-check the predicate. Essentially every modern language (Java, C/C++, Python, Go, Rust) uses Mesa semantics. The practical consequence is that between `signal` and the waiter actually running, other threads can grab the lock and change state, so the predicate must always be re-checked in a loop.

### Q: What is the difference between `signal` (notify_one) and `broadcast` (notify_all)?

`signal` wakes one waiter chosen by the runtime (often FIFO but not guaranteed); `broadcast` wakes all waiters currently on the wait queue. Use `signal` when any single waiter can make progress with the same state change (e.g., one item added to a queue, one waiter dequeues it). Use `broadcast` when the state change may unblock multiple waiters with different predicates (e.g., a shutdown flag, a barrier release, a count drop that crosses many thresholds), or when waiters have different predicates that share one condvar.

### Q: State the predicate-in-a-loop rule and explain why it is non-negotiable.

The rule: always wait inside a `while (!predicate) cond.wait(mutex);` loop, never with `if`. Three reasons make this non-negotiable. (1) Spurious wakeups: the runtime may wake you with no state change. (2) Mesa semantics: between signal and your resumption, another waiter may have consumed the state change. (3) Broadcast races: when N waiters are broadcast-woken, all N race to acquire the lock; only the first sees the predicate true, the rest must go back to waiting. With `if`, you proceed past the wait with the predicate false — typically corrupting state or operating on an empty queue.

### Q: What is the monitor pattern, and how do condition variables fit?

A monitor is an object whose internal state is protected by a single mutex, with public methods that acquire the mutex on entry and release on exit. Inside the monitor, one or more condition variables coordinate waiting on logical predicates over that state. A producer adds work and signals a condvar; a consumer waits on a condvar inside the same monitor while the predicate "queue not empty" is false. Java's `synchronized`+`wait`/`notify`, Python's `threading.Condition`, and any class wrapping a mutex with `cond.wait`/`cond.signal` form a monitor.

### Q: What is a barrier, and is it built on condvars?

A barrier is a synchronization primitive where N threads each call `await()` and are released together only after all N have arrived. It is commonly implemented with a mutex, a counter, and a condvar: each arriving thread decrements the counter under the mutex; if it isn't the last, it waits on the condvar; the last thread resets state and broadcasts. Many languages ship a built-in barrier (`pthread_barrier_t`, `java.util.concurrent.CyclicBarrier`, Go's `sync.WaitGroup` for a one-shot variant), but understanding the condvar-based construction is a standard interview building block.

### Q: What is a phaser, and how does it differ from a barrier?

A phaser is a generalization of a cyclic barrier where the set of participants can change dynamically (parties register and deregister), and it supports multiple "phases" that synchronize independently. Java's `java.util.concurrent.Phaser` is the canonical example. Internally it still uses condvar-like waiting (Java uses `LockSupport.park`/`unpark` with a queue), but conceptually it offers richer control: bulk-registration, phase advancement triggers, and termination. A plain barrier is fixed-size and stateless across cycles.

### Q: Why can't I just use a `volatile` flag and busy-wait instead of a condvar?

You can, but at the cost of either burning a CPU core (pure spin) or suffering latency (sleep-and-poll). A condvar uses kernel or runtime support to put the thread into a sleep state where it consumes zero CPU until woken, and wakes within microseconds of signal. Spinning briefly before sleeping (adaptive spinning) is a real implementation choice inside many condvars and futex-based locks, but exposing only that choice to user code wastes power and starves other ready threads. Use the condvar.

### Q: What is a lost wakeup, and how is it prevented?

A lost wakeup happens when a signaller calls `signal` before the waiter has reached `wait`, so the wakeup hits an empty queue and is discarded; the waiter then sleeps forever. The prevention recipe: both producer and consumer hold the same mutex; the producer changes the predicate *under* the mutex, then signals (under or just after the mutex); the consumer checks the predicate *under* the mutex before calling `wait`. Because `wait` atomically releases the mutex and enqueues the waiter, there is no window for the signaller to "miss" the waiter.

### Q: Does signal need to be called while holding the mutex?

It is not strictly required by POSIX or by `std::condition_variable`, but it is the safe and idiomatic default. Signalling without the lock is a permitted optimization that avoids a context-switch ping-pong where the woken waiter immediately blocks on the still-held lock. However, signalling outside the lock is correct *only* when the predicate update itself happened under the lock and no other code path may further mutate the predicate before the waiter resumes. For most application code, signal under the lock and stop thinking about it.

### Q: What is the difference between a condvar and a semaphore?

A semaphore is a counter with `wait`/`post` operations; it has its own state (the counter) and does not require an external mutex. A condvar has no state of its own — its only state is the wait queue — and it requires an external mutex plus an external predicate. A semaphore is great for counting resources (e.g., "5 connection slots free"); a condvar is great for waiting on arbitrary predicates over richer state (e.g., "queue is non-empty AND not shut down").

### Q: When would you choose a condvar over a channel (Go) or a `BlockingQueue` (Java)?

When the coordination is on a predicate over richer state than a simple value handoff, when you need broadcast semantics, or when you're building a primitive that itself becomes a queue. Channels and blocking queues already encode "wait until item available" and are easier to reason about. Condvars are the lower-level building block: prefer the higher-level primitive unless you're implementing one or need broadcast/timeout semantics that the higher-level primitive doesn't expose.

---

## Language-Specific

### Q: How do `pthread_cond_t` and `std::condition_variable` map to each other?

Both implement Mesa-style condvars on top of futexes (Linux) or kernel events (Windows/macOS). `pthread_cond_wait(&cv, &mu)` corresponds to `cv.wait(lk)` in C++, where `lk` is a `std::unique_lock<std::mutex>`. `pthread_cond_signal` maps to `cv.notify_one`, `pthread_cond_broadcast` to `cv.notify_all`. C++ adds a predicate-overload `cv.wait(lk, pred)` that internally loops, removing the most common bug. C++17 also offers `std::condition_variable_any` which works with any Lockable, at slight cost.

### Q: Show the canonical C++ wait/signal pattern.

```cpp
#include <condition_variable>
#include <mutex>
#include <queue>

std::mutex mu;
std::condition_variable cv;
std::queue<int> q;
bool done = false;

// producer
{
    std::lock_guard<std::mutex> lk(mu);
    q.push(42);
    cv.notify_one();
}

// consumer
{
    std::unique_lock<std::mutex> lk(mu);
    cv.wait(lk, [] { return !q.empty() || done; });
    if (!q.empty()) {
        int x = q.front(); q.pop();
        // use x
    }
}
```

The `wait(lk, predicate)` overload re-checks the predicate inside a loop, eliminating spurious-wakeup bugs. Note `lock_guard` for the simple producer and `unique_lock` for the consumer (because `wait` needs a movable lock).

### Q: What is `Object.wait()` in Java, and what does it require?

Every Java `Object` has an intrinsic monitor and a single wait queue. `obj.wait()` must be called while holding `synchronized (obj)`; otherwise it throws `IllegalMonitorStateException`. It atomically releases the monitor and enqueues the thread; `obj.notify()` and `obj.notifyAll()` wake one or all waiters. The wait queue is per-object — meaning every condition shares one queue — which is why `ReentrantLock.newCondition()` was added in Java 5 for multiple condition queues per lock.

### Q: How does `ReentrantLock.newCondition()` differ from `Object.wait`?

`ReentrantLock` lets you create multiple `Condition` instances per lock, each with its own wait queue. This enables the classic two-condition bounded-buffer pattern (one condvar for "not full," one for "not empty") so producers don't wake consumers and vice versa, halving spurious traffic. It also offers `awaitUninterruptibly`, `awaitNanos`, `awaitUntil`, and fair lock variants. Code is verbose (`lock.lock()` + `try/finally`) but the granularity and feature set make it the default for serious Java concurrency code.

### Q: Show Python `threading.Condition` usage.

```python
import threading
from collections import deque

cv = threading.Condition()
q = deque()
done = False

def producer(x):
    with cv:
        q.append(x)
        cv.notify()

def consumer():
    with cv:
        cv.wait_for(lambda: q or done)
        if q:
            return q.popleft()
        return None
```

`threading.Condition` wraps a `Lock` (or `RLock` by default) and exposes `wait`, `wait_for(predicate)`, `notify`, and `notify_all`. The `wait_for` helper loops on a predicate, mirroring the C++ pattern. CPython's GIL means there's no parallel speedup, but the synchronization semantics are identical.

### Q: What is `sync.Cond` in Go, and why is it rare in idiomatic Go code?

`sync.Cond` is Go's condvar — `cond.Wait`, `cond.Signal`, `cond.Broadcast` — and requires holding the embedded `Locker` while calling `Wait`. It is rarely seen in idiomatic Go because channels and `select` cover most coordination cases more cleanly: a "wake one waiter" pattern becomes a buffered channel send; a "wait for state" pattern becomes a select on a channel that is closed when state changes. `sync.Cond` shines for broadcast (close-channel idiom doesn't allow re-use) and for predicates over rich shared state that doesn't fit a channel message.

### Q: Show a minimal Go `sync.Cond` example.

```go
var (
    mu  sync.Mutex
    cv  = sync.NewCond(&mu)
    ready bool
)

go func() {
    mu.Lock()
    for !ready {
        cv.Wait()
    }
    mu.Unlock()
    // proceed
}()

mu.Lock()
ready = true
cv.Broadcast()
mu.Unlock()
```

Note: `cv.Wait()` releases `mu` and re-acquires it on wake, identical to other languages. The `for !ready` loop is mandatory.

### Q: How does Rust's `std::sync::Condvar` work, and what is the `parking_lot` alternative?

`std::sync::Condvar` is paired with a `Mutex<T>`: you call `cv.wait(guard)` where `guard` is a `MutexGuard`. The call consumes the guard, blocks, and returns a fresh guard on wake. The closure-overload `cv.wait_while(guard, |state| !pred(state))` handles the loop. `parking_lot::Condvar` is a non-poisoning, smaller, faster drop-in with no `LockResult` wrapping and no PoisonError handling — preferred in performance-sensitive or no-std-ish code.

### Q: Show a Rust `Condvar` example with `wait_while`.

```rust
use std::sync::{Arc, Mutex, Condvar};
use std::thread;

let pair = Arc::new((Mutex::new(false), Condvar::new()));
let pair2 = Arc::clone(&pair);

thread::spawn(move || {
    let (lock, cvar) = &*pair2;
    let mut started = lock.lock().unwrap();
    *started = true;
    cvar.notify_one();
});

let (lock, cvar) = &*pair;
let mut started = lock.lock().unwrap();
started = cvar.wait_while(started, |s| !*s).unwrap();
// proceed: *started is true
```

`wait_while` loops on the predicate, transparently handling spurious wakeups. The `unwrap` is for poison errors from panicked threads — `parking_lot` removes that.

### Q: How does Java's `ArrayBlockingQueue` use condvars internally?

`ArrayBlockingQueue` uses a single `ReentrantLock` with two `Condition` instances: `notEmpty` (consumers wait here) and `notFull` (producers wait here). `put` checks `count == capacity` in a loop, calling `notFull.await()`; on success it stores and signals `notEmpty.signal()`. `take` mirrors that on the other side. Using two conditions avoids the broadcast-storm where every wakeup wakes both producers and consumers; only the relevant side is notified.

### Q: What's the difference between `pthread_cond_timedwait` and the C++ `wait_for`/`wait_until`?

`pthread_cond_timedwait` uses an absolute `timespec` deadline against `CLOCK_REALTIME` by default (settable via `pthread_condattr_setclock`), so a wall-clock jump can deceive the timeout. C++ `wait_until` uses any `std::chrono` clock — `steady_clock` is monotonic and immune to wall-clock jumps, which is the safer choice for "wait up to 5 seconds." `wait_for` is a thin wrapper over `wait_until(now + duration)`. Lesson: pick a monotonic clock for timeouts.

---

## Tricky / Trap

### Q: A junior writes `if (queue.empty()) cv.wait(lk); pop_front();`. What breaks?

Several things, depending on conditions. (1) A spurious wakeup wakes the consumer with the queue still empty — `pop_front()` then accesses an empty deque, classic UB or exception. (2) If multiple consumers are broadcast-woken, only one gets the item; the others proceed past `wait`, see an empty queue, and pop garbage. (3) Even with a single consumer, the producer could lose its signal if the consumer was preempted between `empty()` and `wait` — though the mutex usually closes this race, only the loop guarantees correctness. The fix is `while (queue.empty()) cv.wait(lk);` or `cv.wait(lk, [&]{ return !queue.empty(); });`.

### Q: "Just call `broadcast` everywhere — it can't be wrong." What's the cost?

Correctness: yes, `broadcast` is always at least as correct as `signal`. Performance: each broadcast wakes N waiters, all of whom contend on the same mutex on the way back. N-1 of them re-check the predicate, find it false (because the first waiter consumed the state change), and go back to sleep — a "thundering herd." With dozens to thousands of waiters this becomes a major perf cliff. Use `signal` when a single waiter can make progress; use two condvars (producer/consumer pattern) to scope `broadcast` to only the relevant side.

### Q: What happens if you call `wait` without holding the mutex?

Undefined behavior in POSIX (`pthread_cond_wait` requires the mutex be locked by the calling thread). In C++ `std::condition_variable::wait` requires the unique_lock to own the mutex; calling otherwise is UB. In Java, `Object.wait` throws `IllegalMonitorStateException` immediately. In Python, `Condition.wait` raises `RuntimeError`. In Go, `sync.Cond.Wait` panics if the lock isn't held. The lesson: the runtime can detect this in safe languages, but in C/C++ you can crash, hang, or corrupt the wait queue silently.

### Q: A waiter calls `wait(lk, 5s)` and returns. How do you tell whether it timed out or was signalled?

You re-check the predicate. The return value of `wait_for` (C++) is a `cv_status` (`no_timeout` vs `timeout`), but it tells you only what the runtime did, not what the application state is. A signalled waiter could have lost a race to another consumer (predicate still false on resume); a timed-out waiter could find the predicate true because the signal arrived in the same microsecond. Always: re-check the predicate. If predicate is true, proceed. If false and `wait_until(deadline)` returned `timeout` and `now >= deadline`, treat it as timeout.

### Q: Reproduce a lost wakeup.

```cpp
// Broken: producer signals before consumer enters wait.
bool ready = false;
std::mutex mu;
std::condition_variable cv;

std::thread producer([&]{
    // No lock taken — bug.
    ready = true;
    cv.notify_one();
});

std::thread consumer([&]{
    std::unique_lock<std::mutex> lk(mu);
    if (!ready) cv.wait(lk);  // may miss the signal — also using `if`
    // ...
});
```

If the producer races ahead and notifies before the consumer enters `wait`, the signal hits an empty queue and is dropped. Consumer sleeps forever. The fix: producer takes `mu`, sets `ready`, then signals; consumer checks `while (!ready) cv.wait(lk);` under `mu`.

### Q: A team signals the condvar without changing the predicate. What breaks?

Nothing breaks functionally — the waiter wakes, re-checks the predicate (it's still false), and goes back to sleep. But it's a CPU and context-switch waste, and it suggests the team has misunderstood the contract. Worse, in code reviews this pattern can lead to people removing the `while` loop ("the signal *means* the predicate changed, right?"), which then breaks under spurious wakeup or broadcast races. The rule: signal *only* after changing the predicate, and only check the predicate under the mutex.

### Q: Why is "double-checked locking" with a condvar a code smell?

The pattern `if (!ready) { lock; if (!ready) wait; unlock; }` looks like it avoids the lock-acquire cost on the fast path. But on POSIX-like memory models, an unsynchronized read of `ready` may see a stale value or a torn write. Worse, `wait` itself requires the lock, so you take it anyway. The only safe form is "always lock, then `while (!ready) wait`." Performance-driven double-checked patterns belong in lazy initialization with atomics, not in condvars.

### Q: A signaller holds the mutex, sets state, signals, then unlocks. Is signalling under the lock optimal?

It's a known micro-pessimization on some kernels: the woken waiter immediately tries to acquire the mutex still held by the signaller, blocks on it, then the signaller releases, then the waiter wakes again to grab the lock. Modern futex-based implementations (Linux `FUTEX_REQUEUE_PI` / `FUTEX_CMP_REQUEUE`) avoid this by moving the waiter from the condvar queue directly to the mutex queue without waking. So in practice the overhead is negligible. Prefer signalling under the lock for clarity; optimize only with measurements.

### Q: Two condvars share one mutex. Is that safe?

Yes — that's the standard producer/consumer pattern with separate `not_full` and `not_empty` condvars protecting a single bounded buffer's state. The mutex serializes access to the state; each condvar has its own wait queue. The trap is that you must signal the *correct* condvar after each state change: after consuming, signal `not_full`; after producing, signal `not_empty`. Cross-signal and waiters get stuck.

### Q: You broadcast to wake one specific waiter. What goes wrong?

All N waiters wake, race to acquire the lock, N-1 find the predicate false, go back to sleep. CPU and scheduler cost is O(N) per broadcast. If your predicate is "queue not empty," and you put one item then broadcast to 100 waiters, 99 of them wake, fail the check, and re-sleep. Use `signal` plus a single-condition design, or use multiple condvars with distinct predicates.

### Q: A test passes locally but flakes on CI. How might condvars be involved?

Several common patterns. (1) Missing `while` loop — local CPU never spuriously wakes but CI's contended box does. (2) Signal without holding the lock — works when load is light, races under load. (3) Using `if` plus single signal with multiple waiters — works when threads are deterministically scheduled, fails when scheduler interleaves differently. (4) Wall-clock-based timeout with NTP jump or VM pause — passes when clock is steady, times out spuriously when CI host drifts. Fix: rigorous predicate-in-loop, monotonic clock for timeouts.

### Q: You use `notify_one` and the waiter doesn't wake. Bug?

Most likely yes, but verify the predicate path first. Common causes: (a) you signalled before the waiter called `wait` (lost wakeup) — needs the lock+predicate protocol. (b) Another consumer raced in, took the lock, popped the item, and the signal you sent woke nobody else (or woke a stale waiter who then went back to sleep). (c) You called `notify_one` on the wrong condvar. (d) The waiter is actually waiting on a different mutex/condvar pair due to a copy bug. Trace with a logging assertion: log `(predicate, queue_size, waiter_count)` under the lock at signal time.

### Q: A consumer calls `wait` with a timeout of 0. Behavior?

`wait_for(0s)`: implementations typically still go through the release-and-block path, check the deadline, and return `timeout` immediately. Functionally equivalent to "release lock, re-acquire lock, return timeout." This is wasteful — if you wanted "try without blocking," use `try_lock` or a non-blocking queue. The trap is using `wait_for(0)` as a polling primitive in a tight loop, which generates massive scheduler overhead.

### Q: Why is mixing `notify_one` from outside the lock with `wait` plus predicate-check still safe?

Because the predicate is updated under the lock and the waiter checks the predicate under the lock inside the `while` loop. The unprotected `notify_one` can only be "spuriously early" relative to the new state, but the predicate is already true by then, so the waiter sees it and exits the loop. The window where this breaks is if the predicate update happens *outside* the lock — then the waiter might miss the new state and miss the signal. So: predicate update + signal-without-lock is correct iff the update is under the lock.

---

## System / Design Scenarios

### Q: Design a producer/consumer bounded buffer.

Use one mutex and two condvars: `not_full` and `not_empty`. State: a queue and capacity. Producer locks, while `size == capacity` waits on `not_full`, pushes, signals `not_empty`, unlocks. Consumer locks, while `size == 0` waits on `not_empty`, pops, signals `not_full`, unlocks. Two condvars instead of one halves wakeup traffic and avoids producers waking producers. For shutdown, add a `done` flag broadcast on both condvars so all waiters wake and re-check predicates.

### Q: Design a barrier for N parties using a condvar.

Hold a mutex, a count starting at N, a "generation" counter, and a condvar. On `await`, lock, decrement count; if count > 0, save current generation locally and `while (generation == saved) cv.wait()`; if count == 0, reset count to N, increment generation, broadcast. The generation counter handles reusability: late-leaving threads from cycle K can't be re-released by cycle K+1's broadcast. This pattern is roughly what `java.util.concurrent.CyclicBarrier` does internally.

### Q: Design a reusable CountDownLatch.

Hold a mutex, a counter, and a condvar. `countDown()`: lock, decrement; if counter hits 0, broadcast. `await()`: lock, while counter > 0, wait on condvar. Java's `CountDownLatch` is one-shot — once at zero, it never resets. A reusable variant adds a `reset(N)` method that lockfully sets count back to N and is safe only when no waiters are active (or explicit phasing as in `Phaser`). Document the semantics carefully; mistakes here cause silent data races.

### Q: Design a producer/consumer with multiple consumer classes.

Imagine "URGENT" and "NORMAL" job classes, each with its own queue, and consumers per class. One mutex, two queues, two condvars (`urgent_avail`, `normal_avail`). Urgent consumer waits on `urgent_avail`; normal consumer waits on `normal_avail`. The producer signals the appropriate condvar based on job class. Bonus: a "any consumer" mode where a wildcard consumer waits on either — implement by tagging both queues into one condvar (`any_avail`) and using `notify_all` plus predicates per consumer class.

### Q: Design a rate limiter with a condvar.

Token bucket: a counter `tokens`, a refill rate, a mutex, a condvar. Acquirer locks, while `tokens < 1` waits with a timeout equal to "time until next token." A background refill thread (or lazy refill on each acquire) adds tokens and signals. The condvar gives you efficient blocking; the predicate is `tokens >= 1`. For burstable limits, allow a max-bucket cap. For fairness, use a FIFO discipline by storing waiter timestamps. Compare with semaphore-based limiters which are simpler when there's no time-based refill.

### Q: Design a worker pool that drains gracefully on shutdown.

Mutex + queue + `work_avail` condvar + `shutdown` flag. Workers loop: lock, while `queue.empty() && !shutdown` wait; if `shutdown && queue.empty()` exit; else pop and process. `submit(job)`: lock, push, signal. `shutdown()`: lock, set flag, broadcast (waking all workers so each re-checks predicate). The `broadcast` is critical — `signal` would only wake one worker, and the others would still be blocked. The graceful-drain comes from the predicate prioritizing remaining queue items before honoring shutdown.

### Q: Design a barrier with optional barrier action (callback on release).

When the last party arrives, before broadcasting, invoke a registered callback under the mutex (or with mutex released, depending on contract — Java's `CyclicBarrier` runs the action in the calling thread before releasing). Caution: a long callback under the lock blocks every other party from re-acquiring. A safer pattern is to release the lock, run the callback, then re-acquire and broadcast — but that opens reordering windows. The conservative answer: run under the lock and document the callback budget.

### Q: How do you signal "shutdown" to a pool of consumers without missing any?

Set a `done` flag under the mutex, then broadcast. Every consumer's predicate must be `(queue_has_item || done)`; if `done`, the consumer exits. Crucial: never set `done` outside the lock, never use `signal` (must wake all of them), and never let consumers exit without re-acquiring the lock to drain remaining items if the semantics require it.

---

## Coding Questions

### Q: Implement a thread-safe bounded buffer with two condvars (C++).

```cpp
#include <condition_variable>
#include <mutex>
#include <queue>

template <typename T>
class BoundedBuffer {
public:
    explicit BoundedBuffer(size_t cap) : cap_(cap) {}

    void put(T x) {
        std::unique_lock<std::mutex> lk(mu_);
        not_full_.wait(lk, [&]{ return q_.size() < cap_ || closed_; });
        if (closed_) throw std::runtime_error("closed");
        q_.push(std::move(x));
        not_empty_.notify_one();
    }

    bool take(T& out) {
        std::unique_lock<std::mutex> lk(mu_);
        not_empty_.wait(lk, [&]{ return !q_.empty() || closed_; });
        if (q_.empty()) return false;  // closed and drained
        out = std::move(q_.front()); q_.pop();
        not_full_.notify_one();
        return true;
    }

    void close() {
        std::lock_guard<std::mutex> lk(mu_);
        closed_ = true;
        not_full_.notify_all();
        not_empty_.notify_all();
    }

private:
    size_t cap_;
    std::queue<T> q_;
    bool closed_ = false;
    std::mutex mu_;
    std::condition_variable not_full_, not_empty_;
};
```

Two condvars avoid waking the wrong side; `close` broadcasts both. The `take` returns false when closed+drained, so consumers can exit cleanly.

### Q: Implement a read-write mutex using one mutex and two condvars (C++).

```cpp
class RWMutex {
public:
    void lock_shared() {
        std::unique_lock<std::mutex> lk(mu_);
        read_ok_.wait(lk, [&]{ return writers_active_ == 0 && writers_waiting_ == 0; });
        ++readers_;
    }
    void unlock_shared() {
        std::lock_guard<std::mutex> lk(mu_);
        if (--readers_ == 0 && writers_waiting_ > 0) write_ok_.notify_one();
    }
    void lock() {
        std::unique_lock<std::mutex> lk(mu_);
        ++writers_waiting_;
        write_ok_.wait(lk, [&]{ return readers_ == 0 && writers_active_ == 0; });
        --writers_waiting_;
        writers_active_ = 1;
    }
    void unlock() {
        std::lock_guard<std::mutex> lk(mu_);
        writers_active_ = 0;
        if (writers_waiting_ > 0) write_ok_.notify_one();
        else read_ok_.notify_all();
    }
private:
    std::mutex mu_;
    std::condition_variable read_ok_, write_ok_;
    int readers_ = 0, writers_active_ = 0, writers_waiting_ = 0;
};
```

Writer preference avoids reader starvation of writers: new readers wait if any writer is queued. Unlock broadcasts to readers (multiple can proceed) but signals a single writer.

### Q: Implement a CyclicBarrier in Java using `ReentrantLock` + `Condition`.

```java
import java.util.concurrent.locks.*;

public class MyBarrier {
    private final int parties;
    private int count;
    private long generation = 0;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition trip = lock.newCondition();

    public MyBarrier(int parties) {
        this.parties = parties;
        this.count = parties;
    }

    public void await() throws InterruptedException {
        lock.lock();
        try {
            long g = generation;
            if (--count == 0) {
                generation++;
                count = parties;
                trip.signalAll();
                return;
            }
            while (g == generation) {
                trip.await();
            }
        } finally {
            lock.unlock();
        }
    }
}
```

The `generation` counter makes the barrier reusable: each cycle increments it, so waiters from cycle K can't be re-released by cycle K+1.

### Q: Implement a CountDownLatch in Python using `threading.Condition`.

```python
import threading

class CountDownLatch:
    def __init__(self, count):
        self._cv = threading.Condition()
        self._count = count

    def count_down(self):
        with self._cv:
            if self._count > 0:
                self._count -= 1
                if self._count == 0:
                    self._cv.notify_all()

    def await_(self, timeout=None):
        with self._cv:
            return self._cv.wait_for(lambda: self._count == 0, timeout=timeout)
```

`notify_all` because *all* waiting threads should proceed when the count hits zero. `wait_for` returns False on timeout, True on predicate-true. The lambda is the predicate; the loop handles spurious wakeups internally.

### Q: Implement a semaphore from a mutex and a condvar (C++).

```cpp
class Semaphore {
public:
    explicit Semaphore(int initial) : count_(initial) {}
    void acquire() {
        std::unique_lock<std::mutex> lk(mu_);
        cv_.wait(lk, [&]{ return count_ > 0; });
        --count_;
    }
    void release() {
        std::lock_guard<std::mutex> lk(mu_);
        ++count_;
        cv_.notify_one();
    }
private:
    int count_;
    std::mutex mu_;
    std::condition_variable cv_;
};
```

`notify_one` because each release allows exactly one acquirer to proceed. A `release(n)` variant would `notify_all` (or loop notifying one) to wake n waiters. This is a textbook example because it shows the cleanest condvar usage.

### Q: Implement a thread-safe blocking single-shot future with `wait_for`.

```cpp
template <typename T>
class Promise {
public:
    void set_value(T v) {
        std::lock_guard<std::mutex> lk(mu_);
        value_ = std::move(v);
        ready_ = true;
        cv_.notify_all();
    }
    template <typename Rep, typename Period>
    std::optional<T> get(std::chrono::duration<Rep, Period> timeout) {
        std::unique_lock<std::mutex> lk(mu_);
        if (!cv_.wait_for(lk, timeout, [&]{ return ready_; })) return std::nullopt;
        return value_;
    }
private:
    std::optional<T> value_;
    bool ready_ = false;
    std::mutex mu_;
    std::condition_variable cv_;
};
```

`notify_all` because multiple consumers may be blocked on `get`. The `wait_for(predicate)` overload returns false on timeout (predicate-still-false).

### Q: Implement a thread-safe "wait until count is in a range" using a condvar.

```cpp
class RangeWaiter {
public:
    void set(int x) {
        std::lock_guard<std::mutex> lk(mu_);
        value_ = x;
        cv_.notify_all();
    }
    void wait_in_range(int lo, int hi) {
        std::unique_lock<std::mutex> lk(mu_);
        cv_.wait(lk, [&]{ return value_ >= lo && value_ <= hi; });
    }
private:
    int value_ = 0;
    std::mutex mu_;
    std::condition_variable cv_;
};
```

Waiters have different predicates over the same condvar; `notify_all` is mandatory because each waiter must re-check its specific predicate. With many heterogeneous waiters this becomes a thundering-herd hazard — consider splitting into multiple condvars by predicate class.

---

## Behavioral

### Q: Tell me about a production bug you debugged that involved condition variables.

Strong answers describe a real incident: a deadlock or hang, reproduced under load; the candidate explains the protocol violation (e.g., `if` instead of `while`, signal without lock, missed shutdown broadcast); they show how they reproduced it (stress test, thread sanitizer, perf record); and they describe both the immediate fix and a structural change (e.g., moved to `ArrayBlockingQueue`, added test for shutdown drain). Watch for candidates who only describe symptoms.

### Q: How do you teach a junior engineer the predicate-in-loop rule?

Best answers connect rule to mechanism: "Even if the spec promised no spurious wakeups, Mesa semantics plus broadcast races still require the loop, so the loop is the only safe default and is free at runtime." Bonus for showing the broken-with-`if` repro under a debugger. Weak answers: "The spec says you have to."

### Q: When do you reach for a condvar versus a channel or blocking queue?

Strong answer: defaults to higher-level primitives (BlockingQueue, channels) because they're harder to misuse, reaches for condvars when broadcast is required, when the predicate is rich (range, multi-flag), or when implementing the higher-level primitive itself. Notes that team familiarity matters.

### Q: How do you review code that uses condvars?

Checklist-driven: predicate-in-`while`-loop; predicate update and signal both under the lock; broadcast vs signal justified; timeout uses monotonic clock; shutdown path broadcasts; tests cover spurious wakeup (or use a fake clock to force it). Bonus for proposing a refactor to a higher-level primitive when the use case is just queue-handoff.

### Q: Tell me about a time you chose the wrong primitive and had to refactor.

Strong answer: candidate describes an over-engineered condvar-based queue replaced by `BlockingQueue` or a channel; or, the opposite, a queue that needed broadcast semantics so they had to step down from a channel to a mutex+condvar. The point is not the direction of change but explicit reasoning about correctness and team familiarity.

### Q: How do you write tests for condvar-based code?

Best answers: deterministic tests using fake clocks (`std::chrono::steady_clock` mocked via injection) for timeouts; stress tests with many threads to surface races; thread-sanitizer (TSan) and helgrind passes in CI; tests for shutdown that verify all waiters wake; tests that artificially induce spurious wakeups by extra `notify_all` calls.

### Q: Describe a time you optimized condvar-heavy code.

Strong answer: identified a thundering-herd from `notify_all`; replaced with `notify_one` plus split condvars (producer/consumer pattern); measured before/after wakeup count and lock-contention CPU. Or: identified a signal-while-holding-lock pessimization on a hot path and verified the futex requeue optimization was already in play (so no change needed). Avoid premature optimization stories.

### Q: How do you onboard a teammate to condvar mental models?

Show them the lost-wakeup repro under a debugger; pair on writing a bounded buffer from scratch; walk through Mesa vs Hoare with a sequence diagram; assign a code review of a real piece of code using condvars. The goal is intuition, not API memorization.

---

## What I'd Ask a Candidate Now

### Q: Walk me through what happens, instruction by instruction, when one thread calls `cv.wait(mu)` and another calls `cv.notify_one()`. Where does atomicity live?

I want to hear: "wait" releases the mutex and enqueues the thread atomically; "notify" dequeues a waiter and marks it runnable; the waiter re-acquires the mutex before returning. The atomicity covers the release+enqueue window. This question separates candidates who memorize from candidates who understand.

### Q: Here's a 30-line broken producer/consumer. Find the bug.

Plant either a missing `while` loop or a missing-lock-during-signal. Strong candidates spot the bug within minutes and explain the failure mode with a concrete interleaving. Weak candidates flag style issues or guess.

### Q: Implement a bounded buffer in your favorite language. Now extend it to support graceful shutdown.

Tests: correctness of the predicate, broadcast on shutdown, draining semantics, no busy-wait. Bonus: candidate spontaneously uses two condvars.

### Q: Why are spurious wakeups allowed, and would you ever build a system that disallowed them?

I want a thoughtful answer about implementation cost (futex performance, thread migration) versus user-API simplicity. Hoare semantics theoretically disallow spurious wakeups but with worse performance. Real systems have not chosen that trade-off.

### Q: Sketch a CountDownLatch and then a CyclicBarrier. What's the structural difference?

Latch is one-shot, hits zero and stays; barrier is reusable, requires a generation counter to avoid re-releasing late waiters. Strong candidates volunteer the generation idea before being asked.

### Q: When would you replace a condvar with a channel? When would you go the other way?

Channel wins for simple value handoff and producer/consumer fan-out. Condvar wins for broadcast, rich predicates, and implementing the higher-level primitives. I want a clear taxonomy, not "it depends."

### Q: How would you test that your condvar-based code handles spurious wakeups correctly?

Inject extra `notify_all` calls in tests; run thread-sanitizer; review every `wait` for the `while`-loop. Strong answer mentions that good test design assumes spurious wakeups, not "I'd run the tests a lot and hope to catch it."

---

## Cheat Sheet

| Concept | Rule of thumb |
|---|---|
| When to use | Wait on a predicate over shared state; otherwise prefer channels/queues |
| Mutex pairing | Always paired with a mutex protecting the predicate |
| Wait loop | `while (!predicate) cv.wait(lk);` — never `if` |
| Spurious wakeup | Always possible; the loop handles it |
| Mesa semantics | Signalled waiter must re-check predicate; signaller keeps the lock |
| signal vs broadcast | `signal` when one waiter can make progress; `broadcast` when many or different predicates |
| Signal location | Under the lock for clarity; outside the lock can be safe but error-prone |
| Lost wakeup fix | Predicate update + signal both under the mutex |
| Timeouts | Use a monotonic clock (`steady_clock`); re-check predicate on return |
| Shutdown | Set a `done` flag under the lock, then `broadcast` |
| Two-condvar pattern | Producer/consumer: `not_full` + `not_empty` to avoid cross-wakes |
| Thundering herd | `notify_all` to N waiters wakes all; only one makes progress |
| C++ overload | `cv.wait(lk, predicate)` is the idiomatic form |
| Java idiom | `ReentrantLock.newCondition()` for multiple wait queues per lock |
| Python idiom | `cv.wait_for(predicate, timeout)` |
| Go idiom | `for !ready { cv.Wait() }`; rare — channels usually win |
| Rust idiom | `cv.wait_while(guard, |s| !pred(s))` |

| Primitive | Built from condvars? | When to use |
|---|---|---|
| Mutex | No (uses futex/parking directly) | Mutual exclusion |
| Semaphore | Can be | Counting resources |
| Barrier | Yes | N parties synchronize |
| Latch | Yes | One-shot countdown |
| Bounded buffer | Yes (2 condvars) | Producer/consumer |
| Channel | No (typically lock-free + park) | Value handoff, fan-out |
| RWMutex | Yes (2 condvars) | Readers + writers |

| Pitfall | Symptom | Fix |
|---|---|---|
| `if` instead of `while` | Pop from empty queue, crash | `while (!pred)` |
| Signal without lock | Lost wakeup race | Update predicate + signal under lock |
| `signal` to many waiters with one item | All but one re-sleep | Use single signal + single condvar OR two condvars |
| `broadcast` everywhere | Thundering herd | `signal` if one waiter suffices |
| Wall-clock timeout | NTP jump causes spurious timeout | Use monotonic clock |
| No shutdown broadcast | Worker hangs forever | `done` flag + `broadcast` |
| Predicate not under lock | Stale read, missed signal | Always check predicate under mutex |

---

## Further Reading

- [POSIX Threads Programming](https://hpc-tutorials.llnl.gov/posix/) — Lawrence Livermore Lab's pthreads guide
- *Programming with POSIX Threads* — David Butenhof (the canonical reference)
- C++ `<condition_variable>` reference — cppreference.com
- *Java Concurrency in Practice* — Goetz et al., chapter 14 on condition queues
- Python `threading` documentation — `Condition` section
- `sync.Cond` package documentation — pkg.go.dev
- Rust `std::sync::Condvar` documentation — doc.rust-lang.org
- *The Little Book of Semaphores* — Allen B. Downey (for comparison primitives)
- Doug Lea, *Concurrent Programming in Java* — the foundational AQS design
- Linux futex(2) man page — the underlying kernel primitive
- *Programming Models for SMP Machines* — Birrell, for Mesa vs Hoare history

---

## Related Topics

- [Mutexes and Locks](../02-mutexes-locks/README.md)
- [Semaphores](../04-semaphores/README.md)
- [Barriers and Latches](../05-barriers-latches/README.md)
- [Channels](../../03-channels/README.md)
- [Monitors and Synchronized Methods](../06-monitors/README.md)
- [Spurious Wakeups](../../07-pitfalls/spurious-wakeup.md)
- [Lost Wakeup Race](../../07-pitfalls/lost-wakeup.md)
- [Producer/Consumer Pattern](../../../08-patterns/producer-consumer.md)
- [Bounded Buffer Implementations](../../../08-patterns/bounded-buffer.md)
- [Memory Models and Happens-Before](../../../09-memory-models/README.md)
- [Futexes and Kernel Wait Queues](../../../10-os-primitives/futex.md)
