# Semaphore — Interview Questions

> **Topic:** [Semaphore](README.md)

---

## Introduction

Semaphores are one of the oldest, most misunderstood concurrency primitives. They look simple — a counter with `acquire` and `release` — but the moment you start using them in production you discover a long list of subtle failure modes: ownership confusion, permit leaks, unfair queueing, broken cancellation, thundering herds, accidental deadlocks. A senior engineer is expected to know not just the API of `Semaphore` in their language of choice, but also where this primitive came from, why it behaves the way it does, and when a different primitive (mutex, channel, condition variable, rate limiter) would be a better fit.

This document collects interview-style questions that probe that depth. Sections progress from foundational concepts (Dijkstra's P/V notation, binary vs counting, the ownership distinction with mutexes) into language-specific APIs (POSIX, Java, Python, Go, Rust), then move to traps that catch engineers at staff level, design scenarios (connection pools, bulkheads, rate limiters, multi-tenant governance), runnable coding problems, and finally behavioral and reflective questions. The goal is not to memorise answers but to recognise the underlying invariants so you can derive a correct solution under interview pressure or in a real outage.

If you can comfortably answer every question here, you can build, review, and debug semaphore-based code in any modern stack.

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

### Q: What is a semaphore, in one sentence?

A semaphore is a non-negative integer counter with two atomic operations — `acquire` (decrement, blocking when zero) and `release` (increment, waking a waiter) — used to control how many threads or tasks may simultaneously hold a shared resource or proceed past a synchronisation point. Conceptually it tracks "available permits": a thread can pass only when at least one permit exists. The counter and any associated wait queue are protected by the implementation so concurrent `acquire`/`release` calls are safe. It is one of the most general low-level primitives — almost every other coordination structure can be expressed in terms of semaphores.

### Q: Where did semaphores come from, and why are the operations named P and V?

Edsger Dijkstra introduced the semaphore around 1962-1965 as part of the THE operating system, formalising it in "Cooperating Sequential Processes". The acquire operation is called `P` (from Dutch *proberen*, "to test", or *passeren*, "to pass") and release is `V` (*verhogen*, "to increase"). Dijkstra needed a primitive that any user-space process could use to block waiting for a condition without busy-waiting and without exposing kernel scheduling details. Although the names are archaic, you still see `P()`/`V()` in OS textbooks, in some legacy POSIX manpages, and occasionally in academic papers.

### Q: What is the difference between a binary semaphore and a counting semaphore?

A binary semaphore has a maximum value of 1 — it is either available (1) or taken (0). A counting semaphore allows the counter to go up to some `N`, modelling `N` interchangeable resources. The binary form looks like a mutex from the outside, but as we will see below it is *not* a mutex because it has no notion of an owning thread. Counting semaphores are the natural choice for bounded resource pools — database connections, file handles, parallel HTTP requests. Some implementations (POSIX `sem_t`) make no distinction; some (Java) only ship a counting one; some (older POSIX `pthread_mutex_t`) explicitly distinguish.

### Q: What is the difference between a mutex and a binary semaphore? (The classic interview question.)

Both can mediate exclusive access, but a mutex has *ownership* — only the thread that locked it may unlock it — while a semaphore is *ownerless* — any thread may release a permit, including one that never acquired. This single difference cascades into several practical consequences: a mutex can support priority inheritance to avoid priority inversion, a mutex can be recursive, a mutex's release is meaningless from a non-owner (so accidental double-release is detected), and a mutex can be tied to a condition variable for "wait until predicate". A binary semaphore can be used for cross-thread signalling (thread A waits, thread B releases), which a mutex cannot do correctly. If you only need mutual exclusion, use a mutex; if you need signalling or a counter, use a semaphore.

### Q: What is a "permit" and why does the terminology matter?

A permit is the abstract unit a semaphore hands out — one permit per call to `acquire`, one permit returned per call to `release`. Permits are typically interchangeable (unweighted), but some APIs (Java's `Semaphore.acquire(int)`, Go's `x/sync/semaphore`) let you take multiple permits in one call (weighted). The terminology is deliberate — it discourages treating a semaphore as a "lock" because permits are not bound to a thread the way a lock is bound to its owner. Saying "I hold three permits" is correct; saying "I locked the semaphore three times" hides the fact that *any* thread may release those permits.

### Q: How would you sketch the classic producer/consumer pattern with a bounded buffer using semaphores?

You need three primitives: a mutex `m` protecting the buffer, an `empty` semaphore initialised to `N` (the capacity), and a `full` semaphore initialised to 0. A producer does `empty.acquire(); m.lock(); buffer.push(x); m.unlock(); full.release();`. A consumer does `full.acquire(); m.lock(); x = buffer.pop(); m.unlock(); empty.release();`. The two semaphores count "available slots" and "available items"; the mutex guards the buffer's internal structure. The ordering matters — you must acquire the counting semaphore *before* the mutex, otherwise a full buffer with the mutex held will deadlock.

### Q: What is fairness in a semaphore, and why does it matter?

A fair semaphore wakes waiters in FIFO order, guaranteeing no waiter is starved; an unfair semaphore is allowed to grant a newly released permit to whichever thread runs next, which is usually the one that just called `acquire`. Unfair semaphores have higher throughput because they avoid context-switch ping-pong (the thread that just released often immediately re-acquires while the cache is hot), but they risk starvation under contention. Java's `Semaphore(permits, true)` selects fairness; POSIX semaphores are typically unfair; `tokio::sync::Semaphore` is FIFO-fair by design. Choose fair for SLO-sensitive systems (rate limiters, per-tenant quotas) and unfair for raw throughput.

### Q: What are weighted permits and when are they useful?

A weighted semaphore lets a single call request `k` permits at once (and release `k`). Use it when work items have heterogeneous "cost" — for example, throttling memory usage where small jobs need 1 unit and big jobs need 100, or rate-limiting bytes rather than requests. Go's `golang.org/x/sync/semaphore.Acquire(ctx, n)` is the canonical example. The risk with weighted permits is that a large request may starve waiting forever because no single release frees enough permits; well-designed implementations grant atomically (the requester wakes only when the *total* available permits is sufficient), which avoids dropping into a state where one big request blocks many small ones.

### Q: Can you cause a deadlock with semaphores alone, with no other locks?

Yes. The simplest case is `sem1.acquire(); sem2.acquire();` in thread A and the reverse order in thread B — classic AB-BA deadlock, no different from mutexes. A subtler case is the "missing release" deadlock: a worker takes a permit, throws an exception on the happy path, and never reaches the `release` call, slowly draining the pool until everything blocks. A third case is "self-deadlock" with weighted permits: requesting `N+1` permits from a semaphore of size `N` will block forever. The fix in all cases is the usual suite — consistent acquire order, RAII/`try-finally` around release, and bounding requests by the semaphore size.

### Q: What goes wrong if a thread releases more permits than it acquired?

The counter drifts upward beyond its intended limit, silently allowing too many concurrent holders. If your semaphore is sizing a thread pool or DB connection pool, this manifests as overload — suddenly the DB has 50 connections instead of the configured 20 and starts rejecting. Worse, the bug is invisible from outside: the semaphore never errors, the counter just grows. POSIX `sem_post` will eventually return `EOVERFLOW` if you push past `SEM_VALUE_MAX` but few people check. Java's `Semaphore` quietly accepts extra `release()` calls. Defensive design: never call `release` outside of a `try-finally` paired with the acquiring code, or wrap acquisition in an RAII guard.

### Q: How does a semaphore interact with thread cancellation or interruption?

If a thread is blocked in `acquire` and gets cancelled/interrupted, the semaphore must remove it from its wait queue without granting a permit (otherwise that permit is lost). Most modern implementations handle this correctly: Java throws `InterruptedException` from `acquire()`, `tokio::sync::Semaphore` returns an error when the future is dropped, Python's `asyncio.Semaphore` correctly handles `CancelledError`. POSIX `sem_wait` is a cancellation point under pthreads. A correct pattern is: always pair `acquire` with cleanup in `finally`, and prefer `acquireUninterruptibly` only when you truly cannot recover from interruption mid-acquire.

### Q: How is a semaphore typically implemented under the hood?

Modern implementations combine an atomic counter for the fast path with a kernel- or runtime-level wait queue for the slow path. On Linux, this is usually a futex: `acquire` first does an atomic decrement on an integer; if the value was positive, it returns immediately (no syscall); if it dropped to zero or below, it parks on the futex. `release` increments and wakes one waiter via `futex(FUTEX_WAKE, 1)`. User-space runtimes (Go, Tokio) implement an equivalent in their scheduler. The fast path is essentially a single `CAS`, which is why semaphores are usually cheap when uncontended and only get expensive under contention.

### Q: Are semaphore operations a memory barrier?

Yes — `acquire` is an acquire barrier and `release` is a release barrier in the C++/Java memory-model sense. That is, anything a thread wrote before calling `release` is visible to a thread that subsequently completes a paired `acquire`. This is why semaphores work for signalling: when producer calls `release` after writing to a buffer, the consumer's `acquire` synchronises-with that release and the buffer write is observed. Without this barrier guarantee semaphores would be unusable for cross-thread data hand-off.

### Q: When should you reach for a semaphore vs a channel?

Channels carry values; semaphores carry only counts. If you need to transfer ownership of a payload from producer to consumer, channels are clearer. If you only need to gate concurrency ("at most N in flight"), semaphores are more direct and avoid the channel's per-element queueing overhead. In Go specifically, a buffered channel of empty structs is a common semaphore idiom (`sem := make(chan struct{}, N)`); for very large N or weighted permits, `golang.org/x/sync/semaphore` is preferable.

### Q: When is a semaphore the wrong primitive entirely?

Three common cases. (1) You really want a *lock* with ownership — use a mutex so accidental release is caught, recursion works, and priority inheritance is possible. (2) You really want a *signal* with state — a condition variable + mutex or an `Event` is clearer. (3) You really want a *rate limiter* with time-based budget — a token bucket is the right abstraction, although semaphores can be a building block. A semaphore expresses "at most N concurrent", which is *concurrency limiting*, not *rate limiting* (per unit time).

### Q: How does a semaphore compare to a `WaitGroup` or `CountDownLatch`?

A `WaitGroup` or `CountDownLatch` is one-shot and direction-specific — `N` parties signal completion and one or more waiters block until the count reaches zero. You can simulate this with a semaphore initialised to 0 plus an `acquire(N)` on the waiter side, but the intent is muddier. Prefer the purpose-built primitive: it expresses the "wait for N completions" intent and is harder to misuse (no accidental over-release, no risk of a worker re-signalling). Use a semaphore when you need *reuse* (resource pooling) or *bidirectional* signalling (producer/consumer with bounded buffer).

### Q: Could you reason about a semaphore using invariants?

Yes — that is how you prove correctness. Two invariants typically hold: (1) `permits + holders == initial_permits` at all times if no over-release; (2) `permits >= 0` always. A correct `acquire` decrements `permits` and increments `holders`; a correct `release` does the reverse. Any code path that violates these — a `release` without a paired `acquire`, a `holder` that exits without releasing — breaks the invariant. Whenever you write or review semaphore code, mentally annotate where these invariants hold and where they are temporarily broken (between `acquire` and `release`).

---

## Language-Specific

### POSIX (`sem_t`)

#### Q: Walk through the POSIX semaphore API.

`sem_init(&s, pshared, value)` creates an in-process (pshared=0) or shared-memory (pshared=1) semaphore initialised to `value`. `sem_wait(&s)` blocks until the counter is positive, then decrements (the `P` operation). `sem_post(&s)` increments and wakes one waiter (the `V` operation). `sem_trywait` is non-blocking; `sem_timedwait` blocks with a deadline. `sem_getvalue` returns the current count (rarely useful — racy). `sem_destroy` releases the semaphore. Named semaphores (`sem_open`, `sem_close`, `sem_unlink`) are filesystem-visible and shareable across processes.

#### Q: What is the difference between named and unnamed POSIX semaphores?

Unnamed semaphores live in memory you allocate (process-local or in shared memory mapped via `mmap`/`shm_open`). Named semaphores live in the kernel namespace and are referenced by a string path like `/mysem`, opened with `sem_open`. Named semaphores survive the process that created them (until `sem_unlink`), making them useful for inter-process coordination without setting up shared memory. They are slightly more expensive because each operation goes through the kernel-visible name.

#### Q: What does `sem_post` from a signal handler require?

`sem_post` is one of the few synchronisation primitives explicitly async-signal-safe per POSIX, so it is the recommended way to wake a thread from inside a signal handler (for example a `SIGINT` handler signalling a shutdown thread). Almost nothing else is — you cannot call `pthread_mutex_lock` or `pthread_cond_signal` from a signal handler safely. This makes POSIX semaphores the canonical async-signal-safe wake mechanism in C.

#### Q: Why does `sem_wait` need to be wrapped in a loop on `EINTR`?

`sem_wait` returns `-1` with `errno == EINTR` if the thread receives a signal while blocked. Unless you mean to abandon the wait, you must retry: `while (sem_wait(&s) == -1 && errno == EINTR) {}`. Forgetting this is a common bug in long-lived servers that catch signals. `sem_timedwait` has the same property.

### Java (`java.util.concurrent.Semaphore`)

#### Q: How does Java's `Semaphore` differ from POSIX?

Java's `Semaphore` is a counting semaphore by default with a configurable fairness flag: `new Semaphore(permits, true)` makes it FIFO. It supports interruption (`acquire()` throws `InterruptedException`), uninterruptible mode (`acquireUninterruptibly`), bulk operations (`acquire(int permits)`, `release(int permits)`), and inspection (`availablePermits()`, `getQueueLength()`, `drainPermits()`). It is built on `AbstractQueuedSynchronizer` (AQS), the same framework backing `ReentrantLock`. Crucially Java semaphores have *no thread affinity* — release from any thread is valid.

#### Q: When would you use the fair constructor `Semaphore(permits, true)`?

When you need bounded waiting guarantees — for example, a per-tenant concurrency cap in a multi-tenant service, where you do not want a noisy tenant to starve a quieter one. Fair mode hands permits in FIFO order, which prevents the "newcomer steals from queued waiter" pattern of the unfair default. The cost is reduced throughput because every release forces a hand-off rather than letting the releasing thread re-acquire from the hot cache.

#### Q: What does `drainPermits()` do and when is it useful?

`drainPermits()` atomically removes and returns all currently available permits. It is useful for emergency shutdown ("stop letting anyone in") and for resizing pools downward (drain then re-release the new lower count). It does not affect threads already past `acquire`, only new arrivals.

#### Q: Can a Java `Semaphore` be used as a `CountDownLatch`?

Yes, although a `CountDownLatch` is clearer. Initialise `new Semaphore(0)`, have `N` workers each call `release()` when done, and have the waiter call `acquire(N)` to block until all `N` have completed. This works because Java semaphores accept multi-permit acquires. A `CountDownLatch` is preferred for readability and because it is single-use by design.

### Python (`threading.Semaphore` and `asyncio.Semaphore`)

#### Q: How is `threading.Semaphore` typically used in Python?

`from threading import Semaphore; s = Semaphore(N)` then `with s: ... critical section ...`. The context manager calls `acquire` on entry and `release` on exit, even on exception, which is the recommended pattern. `Semaphore` also exposes `acquire(blocking=True, timeout=None)` and `release()`. There is also `BoundedSemaphore` which raises `ValueError` if `release` would push the counter above its initial value — useful for catching over-release bugs that plain `Semaphore` silently allows.

#### Q: What is the asyncio equivalent and how does it differ?

`asyncio.Semaphore(N)` is the coroutine equivalent: `async with sem: ...` or `await sem.acquire(); ...; sem.release()`. The key difference is that it is *not* thread-safe — it must be used from a single event loop. It cooperates with `asyncio.CancelledError`: cancelling a task blocked in `acquire` cleanly removes it from the wait queue. Common use is `asyncio.Semaphore(10)` to cap concurrent HTTP requests inside `asyncio.gather`.

#### Q: Why does `BoundedSemaphore` exist?

Plain `Semaphore` lets `release` push the counter arbitrarily high; if you intended `N` resources, a stray `release` will let `N+1` callers proceed. `BoundedSemaphore` raises `ValueError` if `release` would exceed the original count, surfacing the bug immediately. Most production code that uses a semaphore as a resource gate should prefer `BoundedSemaphore`.

#### Q: How do you pattern a connection-limited asyncio HTTP client?

```python
import asyncio, aiohttp

async def fetch(sem, session, url):
    async with sem:
        async with session.get(url) as r:
            return await r.text()

async def main(urls):
    sem = asyncio.Semaphore(10)
    async with aiohttp.ClientSession() as s:
        return await asyncio.gather(*(fetch(sem, s, u) for u in urls))
```

The semaphore caps concurrent in-flight requests at 10 even if you pass 10,000 URLs to `gather`.

### Go (channel-as-semaphore and `x/sync/semaphore`)

#### Q: How do you implement a semaphore as a channel in Go?

A buffered channel of empty structs of capacity `N` works as a counting semaphore: `sem := make(chan struct{}, N); sem <- struct{}{}` is acquire (blocks when buffer is full), `<-sem` is release. This is idiomatic for small `N` and integrates with `select` and `context.Done()` for cancellation. For `N` of a few thousand or weighted permits, prefer `golang.org/x/sync/semaphore`.

#### Q: What does `golang.org/x/sync/semaphore` add over a channel?

It supports weighted permits — `s.Acquire(ctx, n)` takes `n` at a time — and integrates with `context.Context` for cancellation/deadline. It is the right choice when work items have heterogeneous cost (memory bytes, CPU cores) or when `N` is large enough that a channel buffer becomes wasteful.

#### Q: Show acquire-with-context cancellation.

```go
sem := semaphore.NewWeighted(10)
ctx, cancel := context.WithTimeout(ctx, time.Second)
defer cancel()
if err := sem.Acquire(ctx, 1); err != nil { return err }
defer sem.Release(1)
```

If the context is cancelled before a permit is available, `Acquire` returns the context's error and no permit is held — no cleanup needed.

#### Q: What is the bug in `sem <- struct{}{}` for acquire if you want to respect context cancellation?

A bare send blocks until a slot is free, ignoring context cancellation. The fix is `select { case sem <- struct{}{}: case <-ctx.Done(): return ctx.Err() }`. This is one of the reasons `x/sync/semaphore` exists — to avoid sprinkling that boilerplate.

### Rust (`tokio::sync::Semaphore`)

#### Q: What is the shape of `tokio::sync::Semaphore`?

`Semaphore::new(N)` creates a semaphore with `N` permits. `sem.acquire().await` returns a `SemaphorePermit` (a RAII guard); dropping the guard releases the permit. `acquire_many(n).await` takes `n` permits; `try_acquire` is non-blocking. The RAII pattern means you cannot accidentally forget to release — it happens automatically when the permit goes out of scope.

#### Q: What does `acquire_owned` give you over `acquire`?

`acquire` returns a `SemaphorePermit<'_>` borrowed from the semaphore, useful for short-lived holders within one function. `acquire_owned` (on `Arc<Semaphore>`) returns an `OwnedSemaphorePermit` with no lifetime tied to the semaphore — you can move it into a spawned task or store it in a struct. The trade-off is the `Arc` overhead.

#### Q: Is `tokio::sync::Semaphore` fair?

Yes — it is FIFO. Permits are granted to waiters in the order they called `acquire`, which makes it suitable for per-tenant fairness. Unlike Java's optional fair mode, fairness is not a constructor parameter.

#### Q: How do you close a `tokio` semaphore for shutdown?

`sem.close()` wakes all pending `acquire` calls with `AcquireError`, signalling the resource is no longer available. New `acquire` calls return the same error. This is the idiomatic way to drain a connection pool or worker pool on shutdown without relying on cancellation tokens.

#### Q: Show idiomatic Rust acquire-and-spawn pattern.

```rust
use std::sync::Arc;
use tokio::sync::Semaphore;

async fn fan_out(items: Vec<Item>, max_concurrent: usize) {
    let sem = Arc::new(Semaphore::new(max_concurrent));
    let mut handles = vec![];
    for item in items {
        let permit = sem.clone().acquire_owned().await.unwrap();
        handles.push(tokio::spawn(async move {
            let _permit = permit; // moved in; dropped at end of task
            process(item).await
        }));
    }
    for h in handles { let _ = h.await; }
}
```

`acquire_owned` returns a permit that owns its slot; moving it into the spawned task ties release to task completion. No explicit release needed — the drop guard handles it.

---

## Tricky / Trap

### Q: "I can use a binary semaphore as a mutex, right?" — what breaks?

The naive answer is "yes, both give mutual exclusion". The traps: (1) any thread can call `release`, so a buggy thread that did not acquire can unlock the resource for a thread that thought it was protected; (2) there is no priority inheritance, so a low-priority holder can be preempted by a medium-priority thread, blocking a high-priority waiter indefinitely (priority inversion — the Mars Pathfinder bug); (3) you cannot make it recursive, so the holder calling a function that re-acquires deadlocks; (4) deadlock detection tools that rely on owner-thread metadata cannot see your semaphore. Use a mutex unless you specifically need the no-owner property.

### Q: A worker takes a permit and throws — what happens to the permit?

If `release` is not in a `finally`/`defer`/RAII drop, the permit is *leaked*: the counter never recovers. Over many failures the pool drains to zero and the whole system blocks. The fix is to make release inseparable from the scope of the holder: Python `with sem:`, Java `try { sem.acquire(); ... } finally { sem.release(); }`, Go `defer sem.Release(1)`, Rust drop guards. In code review, always flag any `acquire` whose paired `release` is not lexically and structurally guaranteed.

### Q: You write `sem.release(); sem.release();` "to be safe" at shutdown — what happens?

You have just permanently raised the permit ceiling above the pool size. Future code will see more concurrent holders than the configured `N`. If the semaphore guards a DB pool of 20 connections, you may now have 22 concurrent users, leading to mysterious connection-pool-exhaustion errors elsewhere or DB-side rejection. `BoundedSemaphore` (Python) or careful invariants (everyone-releases-exactly-once) are the cure.

### Q: A request times out while waiting in `acquire`. Will it correctly leave the wait queue, or leak a slot?

It depends on the implementation. Modern Java, Tokio, Python asyncio, and Go (`x/sync/semaphore` with ctx) all handle cancellation/timeout cleanly — the waiter is removed from the queue and no permit is consumed. POSIX `sem_timedwait` returns `ETIMEDOUT` and the waiter is removed. The footgun is rolling your own semaphore with a channel and forgetting the `select case <-ctx.Done()` branch — then a cancelled goroutine never removes itself, and worse, if a `release` happens just as you cancel, the channel slot is consumed by a goroutine that no longer cares.

### Q: You call `sem.acquire(int)` for 10 permits but you only have 5. Will another waiter sneak in?

This depends on whether the implementation is *atomic-or-wait* (Java's `acquire(int)`, Go's `Weighted.Acquire`) or implemented as a loop of single acquires. The atomic versions never partially acquire: the requester either gets all 10 at once or waits for all 10 at once. A naive loop implementation can deadlock: thread A takes 5, waits for 5 more; thread B takes 5 of the next 10 released; neither completes. Always use the atomic multi-permit API.

### Q: A `release` wakes one waiter — what about thundering herd if you release `N` at once?

If you call `release(N)` and N waiters are queued, the implementation typically wakes them all (or as many as can be satisfied), and they all race to run. Under heavy contention this is a thundering herd — the scheduler is overloaded by N simultaneous wakeups, the lock structures are contended, and only one or a few make real progress at a time. Mitigations: prefer releasing one at a time in a smooth stream, or stagger release with jitter, or use a different primitive entirely (token bucket for rate limiting).

### Q: You implement a connection pool with a semaphore around a `Vec<Connection>` and a mutex. Where is the bug?

A common bug: the semaphore says "you may have a connection", but the actual `Vec` is empty because a previous holder forgot to push the connection back. Now the holder of the permit blocks forever trying to pop from an empty vec, while the semaphore happily hands out the remaining permits to others who also block. The semaphore counter and the pool's actual contents must be kept in lock-step — the cleanest fix is RAII: `Connection`'s `Drop` impl returns it to the pool *and* releases the semaphore as one inseparable action.

### Q: Using a semaphore for "wait for thread to finish" — what is subtle?

You initialise `sem = Semaphore(0)`, the worker calls `release()` when done, the parent calls `acquire()` to wait. This works, but: (1) if you intend to wait for `N` workers you must `acquire(N)` not loop `N` times (the loop has the same end result but is slower); (2) you must ensure the worker's *write* to any shared result is `happens-before` its `release`, otherwise the parent reads stale data — relying on the implicit acquire/release ordering of the semaphore handles this if you do not introduce other memory tricks; (3) a `CountDownLatch` or `WaitGroup` is more idiomatic and self-documenting.

### Q: `sem_post` from a signal handler — what if the signal interrupts the same thread's `sem_wait`?

This is the textbook trap. POSIX semaphores are async-signal-safe for `sem_post`, but `sem_wait` is a cancellation point and may return `EINTR` when a signal handler fires. If the signal handler itself calls `sem_post`, the same thread's `sem_wait` may return with `EINTR` *before* observing the post. Re-loop on `EINTR` to retry, or use `sigwait`/`signalfd` to handle signals on a dedicated thread instead.

### Q: You set `Semaphore(10)` but average utilisation is 9.5 and tail latency spikes. What is wrong?

The semaphore is operating near saturation. Little's Law says `L = λW` — if your service averages 9.5 concurrent and your target tail latency is `W_tail`, your *arrival rate* multiplied by `W_tail` must stay below 10. As utilisation approaches the cap, queue length and wait time grow super-linearly (M/M/1 result). The fix is *not* "raise the limit to 20" without understanding downstream capacity — it may be the right move, but only after confirming the dependency can handle 2x. Often the correct move is to add backpressure: reject (or shed) when the wait queue gets long instead of letting it build.

### Q: Releasing on `release` runs on the releaser's stack — what about reentrancy?

Some implementations directly invoke the next waiter's continuation on the releaser's thread (synchronous handoff), others enqueue and let the scheduler dispatch (asynchronous handoff). With synchronous handoff, the release call may not return until the waiter does its work, which can cause surprising priority inversions and stack growth. Most production semaphores use asynchronous handoff for this reason. If you implement your own, prefer the latter.

### Q: A test uses `Semaphore(1)` as a "barrier" and works locally but flakes in CI. Why?

A semaphore is not a barrier — a barrier waits for `N` parties to all arrive before any proceeds, while a semaphore lets the first arrival pass immediately. Using `Semaphore(1)` as a "one-time signal" works only because in your local timing the producer happens to release before the consumer arrives, so the consumer sees the permit. Under CI's slower or differently-scheduled execution, the consumer may run first and block, then the producer's release wakes it — same outcome. But if you expected *both* threads to be ready at a specific point, you needed a `CyclicBarrier`/`Barrier` or two semaphores, not one. Test flakes here usually mean a missing third synchronisation point.

### Q: You see "permits available: -3" in your monitoring dashboard — is that even legal?

It depends on the implementation. Some semaphores expose the queue length as a negative available count (a hack: `available = total - in_use - waiting`), others clamp at 0. POSIX `sem_getvalue` is implementation-defined and on Linux returns 0 when waiters are queued, on other platforms returns negative-count-of-waiters. Do not rely on the sign — track `acquired` and `waiting` as separate metrics if you need to monitor either.

### Q: Acquiring a permit then sleeping holding it for a long time — what is the failure mode?

You have effectively reduced the pool size from `N` to `N-1` for the duration of the sleep. If sleeps happen on the critical path (long downstream call, GC pause, large compute), you can starve other callers. The systemic fix is to bound the *time* a permit is held (timeout the work) and emit metrics for "permit hold time" so long-tail outliers are visible. A separate fix is to use weighted permits where slow work takes more permits, so the system naturally throttles itself.

### Q: A code path acquires a semaphore, then on a rare branch acquires a *second* semaphore. What review concern do you raise?

Multi-semaphore acquisition is the seedbed for AB-BA deadlock. The reviewer should ask: does *any* other code path acquire these two semaphores in the opposite order? If yes, you have a deadlock waiting to happen. The fix is to enforce a global lock order (always acquire A before B), or to redesign so a single semaphore protects the combined resource, or to use `tryAcquire` with rollback. Static analysers can sometimes catch the violation; lock-order code review is one of the highest-leverage activities in concurrent code.

### Q: A long-running test starts failing after migrating from `Semaphore` to `BoundedSemaphore` in Python. What is the most likely cause?

`BoundedSemaphore` enforces that you cannot `release` more times than you have permits — it raises `ValueError`. If the test was masking a double-release bug under plain `Semaphore`, migrating reveals it. The fix is to find the bug, not revert the change. The lesson: prefer `BoundedSemaphore` *from the start* so this class of bug surfaces in development rather than as silent over-provisioning in production.

### Q: A semaphore stress test hangs only under `-race`. What is your hypothesis?

The race detector reorders/delays memory operations to expose races. If the test hangs only under `-race`, there is likely a synchronisation gap somewhere outside the semaphore — for example, a producer that signals "done" via a non-volatile flag while the consumer waits on the semaphore. Without `-race` the timing happens to work; with `-race` the consumer waits forever because the flag write is not visible. The investigation is: which memory operation is unprotected? The semaphore itself is rarely at fault here.

---

## System / Design Scenarios

### Q: Design a database connection pool with a semaphore.

A counting semaphore initialised to `N` (max connections) gates `borrow`. On `borrow`: `acquire` a permit, then either pop a connection from a free list or open a new one. On `return`: push back to the free list, `release` the permit. The semaphore should be *fair* if tenants expect predictable wait, *unfair* if pure throughput. Health-check returning connections (discard if broken — then `release` but *do not* push to the free list, the next borrower will open a new one). Add metrics for borrowed/free/waiting counts. Wrap the borrowed connection in a RAII guard so accidental drops still return the permit. Surface the pool's wait time as a gauge so capacity planning is data-driven.

### Q: Use a semaphore to build a worker bulkhead for an external service.

A bulkhead isolates failure: each downstream service has its own semaphore capping concurrent in-flight calls (say 20 for the search service, 5 for the payment service). When the payment service slows down, only those 5 slots block — other dependencies remain free. This prevents a single slow downstream from exhausting your global thread pool. Pair the semaphore with a timeout: callers waiting > T abandon and return a fallback. Pair with a circuit breaker: when failure rate spikes, the breaker trips and `acquire` short-circuits to error. Bulkheads, circuit breakers, and timeouts together form the resilience triad.

### Q: Design an in-process rate limiter using a semaphore as a building block.

Pure semaphore gives concurrency limiting, not rate limiting. For rate limiting (X requests per second), combine: a semaphore of capacity X (or token bucket of size X), and a background task that periodically `release`s permits at the desired rate. On request, `acquire` a permit; do *not* release after the work — the releaser is the timer. Result: at most X requests start per period. This is the "leaky bucket" / "fixed window" pattern. For smoother behaviour, prefer a true token bucket implementation; the semaphore-with-timer is fine for simple cases.

### Q: How would you cap concurrent batch jobs per tenant in a multi-tenant system?

Per-tenant semaphores, sized by the tenant's tier (free: 2, pro: 10, enterprise: 100). Stored in a concurrent map keyed by tenant ID, lazily created. Use *fair* semaphores so a single tenant cannot monopolise its own slot at the expense of its other concurrent users. Add a global semaphore as a safety cap (you do not want 1000 enterprise tenants each at 100 concurrent jobs — your infra cannot take 100,000 parallel jobs). The combination of per-tenant + global is the standard governance pattern.

### Q: You have a parallel scraper that should hit at most 5 requests *per host* concurrently. Design.

A `Map<Host, Semaphore>` where each semaphore is sized 5. Lazily insert. For each URL: look up (or create) the semaphore for that host, acquire, do the request, release. This naturally throttles per-host without limiting overall parallelism. Be careful with hot-key issues — if all your URLs are on one host, you have a single contention point; add jitter on retry and consider per-host queueing rather than a single semaphore for very heavy hosts. Also, schedule cleanup: hosts not accessed for an hour can have their semaphore evicted to bound memory.

### Q: Design resource governance for a shared GPU cluster.

Each GPU is a "resource". Use a counting semaphore per node sized to the number of GPUs on that node, plus a *weighted* semaphore per node sized to the total VRAM (in MB or GB). A job requests `(N_gpus, total_vram)`; both must be acquired atomically (or the second acquire releases the first on failure). The weighted permit prevents tiny jobs from fragmenting VRAM. Pair with a fair queue so big jobs cannot starve. Tie permit lifetime to the job's wall clock — kill jobs that exceed their lease.

### Q: A microservice receives a flood of work. How do you protect downstream without dropping requests outright?

Add a semaphore at the boundary sized to the downstream's safe concurrent capacity. When the semaphore is saturated, new requests wait up to a small timeout, then return 503 Retry-After. This shifts the queue from the slow downstream (which would time out and cascade-fail) into your service (fast in-memory queue), giving the downstream a smooth load. Pair with explicit metrics on wait time and queue depth so you can decide when to scale up. The pattern is "load shed at the edge, queue briefly internally, never overwhelm the dependency".

### Q: Designing a thread-pool executor — should the queue be unbounded?

Unbounded queues turn pool saturation into runaway memory growth and latency, often manifesting as OOMs hours after the real overload. Bounded queue + a semaphore counting "outstanding submissions" forces backpressure into the submitter. Combine: queue of size `K`, semaphore of size `K + pool_size`. Submitter `acquire`s; worker `release`s on completion. Reject (or sync-execute, or 503) when `tryAcquire` fails. The semaphore is what makes the failure visible — without it the queue silently swallows work until OOM.

### Q: Distributed semaphore — design considerations.

A semaphore inside a single process is cheap (atomic + futex). Across a fleet you need a coordination layer: Redis with Lua scripts, ZooKeeper, etcd. The trade-offs are real: every acquire is now a network round-trip (typically 1-5ms), failure of the coordinator paralyses everyone, and you must handle crashed holders (TTL on the permit). Common implementations use Redis with a `INCR`+`EXPIRE` pattern, or Redlock-style algorithms for stronger guarantees. Often the right answer is "do not" — push the limiting to a single sidecar or to the downstream itself, rather than asking N services to coordinate per request.

### Q: When designing a multi-tenant API gateway, where do you place the semaphore?

Three layers, each protecting against a different failure: (1) *global* semaphore at the gateway protects against fleet-wide overload; (2) *per-tenant* semaphore enforces fair sharing; (3) *per-downstream* semaphore (bulkhead) isolates dependency failures. All three together: a tenant cannot starve another, a downstream cannot bring down the gateway, and the gateway cannot stampede an underlying service. Each semaphore should be sized from a different constraint — global from gateway capacity, per-tenant from tier SLA, per-downstream from dependency SLO.

---

## Coding Questions

### Q: Bounded buffer with two semaphores and a mutex (classic producer/consumer).

```python
import threading

class BoundedBuffer:
    def __init__(self, capacity):
        self.buf = []
        self.cap = capacity
        self.mutex = threading.Lock()
        self.empty = threading.Semaphore(capacity)  # slots available
        self.full = threading.Semaphore(0)          # items available

    def put(self, item):
        self.empty.acquire()
        with self.mutex:
            self.buf.append(item)
        self.full.release()

    def get(self):
        self.full.acquire()
        with self.mutex:
            item = self.buf.pop(0)
        self.empty.release()
        return item
```

Acquire the counting semaphore *before* the mutex; releasing the other counting semaphore happens *after* mutex release. This avoids holding the mutex while blocked on the wrong-direction semaphore.

### Q: Bounded-concurrency async URL fetcher with a semaphore.

```python
import asyncio, aiohttp

async def fetch(sem, session, url):
    async with sem:
        async with session.get(url) as r:
            return url, await r.text()

async def fetch_all(urls, max_concurrent=10):
    sem = asyncio.Semaphore(max_concurrent)
    async with aiohttp.ClientSession() as session:
        return await asyncio.gather(*(fetch(sem, session, u) for u in urls))
```

The semaphore caps concurrent in-flight requests regardless of how many URLs are passed. `async with` guarantees release on exception, including `CancelledError`.

### Q: "Only the first 5 readers run in parallel; the rest queue" — sketch a solution.

```go
func parallelFirstK(items []Item, k int, work func(Item) error) error {
    sem := make(chan struct{}, k)
    var wg sync.WaitGroup
    errs := make(chan error, len(items))
    for _, it := range items {
        wg.Add(1)
        sem <- struct{}{}  // acquire; blocks when k in flight
        go func(it Item) {
            defer wg.Done()
            defer func() { <-sem }()  // release
            if err := work(it); err != nil { errs <- err }
        }(it)
    }
    wg.Wait()
    close(errs)
    for err := range errs { if err != nil { return err } }
    return nil
}
```

`sem` is a buffered channel of capacity `k`. The `sem <- struct{}{}` in the main loop blocks when `k` work goroutines are running, naturally queueing. Cancellation via `context` should be added in production.

### Q: Generic resource pool with weighted permits in Go.

```go
import (
    "context"
    "golang.org/x/sync/semaphore"
)

type Pool struct {
    sem *semaphore.Weighted
}

func New(totalUnits int64) *Pool {
    return &Pool{sem: semaphore.NewWeighted(totalUnits)}
}

func (p *Pool) Do(ctx context.Context, cost int64, work func() error) error {
    if err := p.sem.Acquire(ctx, cost); err != nil { return err }
    defer p.sem.Release(cost)
    return work()
}
```

Acquire atomically blocks until `cost` units are available. Context cancellation is honoured. `defer Release` guarantees no permit leak even on panic.

### Q: Implement a simple rate limiter using `Semaphore` + a refill goroutine.

```go
type RateLimiter struct{ sem chan struct{} }

func New(rate int, per time.Duration) *RateLimiter {
    rl := &RateLimiter{sem: make(chan struct{}, rate)}
    for i := 0; i < rate; i++ { rl.sem <- struct{}{} }
    go func() {
        ticker := time.NewTicker(per / time.Duration(rate))
        defer ticker.Stop()
        for range ticker.C {
            select { case rl.sem <- struct{}{}: default: }
        }
    }()
    return rl
}

func (rl *RateLimiter) Wait(ctx context.Context) error {
    select {
    case <-rl.sem: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}
```

Channel of capacity `rate` pre-filled. The refill goroutine adds one token every `per/rate` interval (smooth refill). `Wait` consumes a token, blocking if empty. Note: this is the bucket *consumer*; for true production use, `golang.org/x/time/rate` is more correct.

### Q: Implement a one-shot wait that any number of waiters can join (manual reset event using semaphores).

```python
class Event:
    def __init__(self):
        self._lock = threading.Lock()
        self._sem = threading.Semaphore(0)
        self._waiters = 0
        self._set = False

    def wait(self):
        with self._lock:
            if self._set: return
            self._waiters += 1
        self._sem.acquire()

    def set(self):
        with self._lock:
            if self._set: return
            self._set = True
            for _ in range(self._waiters):
                self._sem.release()
            self._waiters = 0
```

Each waiter takes one permit; `set` releases enough permits to wake them all. The `_set` flag handles the "set before any waiter arrived" race. `threading.Event` is the standard library version — only roll your own when you need an unusual variant.

### Q: Implement `acquire_with_timeout` returning a bool (Python).

```python
import threading

def acquire_with_timeout(sem: threading.Semaphore, timeout: float) -> bool:
    return sem.acquire(blocking=True, timeout=timeout)
```

Trivial in Python — `threading.Semaphore.acquire` already supports it. The point of the question is whether the candidate knows the parameter exists, what it returns (True on success, False on timeout), and that the permit is *not* held on timeout (no cleanup needed). Many candidates incorrectly assume a partial acquisition needs releasing.

### Q: Build a "dining philosophers" solution that avoids deadlock using a semaphore.

```python
import threading

N = 5
forks = [threading.Lock() for _ in range(N)]
# Cap concurrent diners at N-1 to break the cycle:
waiter = threading.Semaphore(N - 1)

def philosopher(i):
    while True:
        think()
        waiter.acquire()
        forks[i].acquire()
        forks[(i + 1) % N].acquire()
        eat()
        forks[(i + 1) % N].release()
        forks[i].release()
        waiter.release()
```

The single counting semaphore `waiter` ensures at most `N-1` philosophers are simultaneously trying to pick up forks, breaking the circular-wait condition. Without it, all `N` philosophers can each pick up their left fork and deadlock waiting on the right.

### Q: Implement a "wait for N threads" barrier using two semaphores.

```python
import threading

class Barrier:
    def __init__(self, n):
        self.n = n
        self.count = 0
        self.mutex = threading.Lock()
        self.turnstile1 = threading.Semaphore(0)
        self.turnstile2 = threading.Semaphore(0)

    def wait(self):
        with self.mutex:
            self.count += 1
            if self.count == self.n:
                for _ in range(self.n): self.turnstile1.release()
        self.turnstile1.acquire()
        with self.mutex:
            self.count -= 1
            if self.count == 0:
                for _ in range(self.n): self.turnstile2.release()
        self.turnstile2.acquire()
```

Two-stage barrier (reusable). First turnstile holds until all `n` arrived, second turnstile holds until all `n` passed through — preventing one fast thread from racing into the next round before others have exited. Classic Andrews algorithm.

### Q: Code review: spot the bug.

```python
sem = threading.BoundedSemaphore(5)

def worker(item):
    sem.acquire()
    try:
        do_work(item)
    except Exception as e:
        log.error(e)
        return                 # <-- bug
    sem.release()
```

Two bugs: (1) the `return` in the exception path skips `sem.release` — permit leak; (2) even on the happy path, an exception after `do_work` (e.g. from logging) bypasses release. Fix: `try/finally` around `do_work` with `sem.release()` in the `finally`, or use `with sem:`. The `BoundedSemaphore` will mask one kind of bug (double-release) but not this kind (no-release).

---

## Behavioral

### Q: Tell me about a time you used a semaphore in production and what trade-offs you considered.

Look for the candidate to articulate: the problem (concurrency cap, resource pool, rate limit), the alternatives considered (mutex, channel, condition variable, framework-provided limiter), why semaphore won, what size they picked and how (capacity planning, downstream limits, load test data), what observability they added (wait time, queue depth, hold time), and what failure modes they actively designed against (permit leak, timeout handling, shutdown drain). Weak answers describe code; strong answers describe a decision.

### Q: Describe a concurrency bug you debugged where the semaphore was involved.

Strong answers show systematic debugging: collecting evidence (logs, thread dumps, metrics), forming hypotheses (permit leak vs deadlock vs overload), testing each, and arriving at a root cause. Bonus points for identifying that "the semaphore worked correctly, but the surrounding code violated its contract" — a sign of mature thinking. Weak answers blame the primitive.

### Q: How did you decide whether to use a mutex or a semaphore?

You are listening for the ownership distinction: did the candidate need mutual exclusion (mutex) or signalling/counting (semaphore)? Did they consider priority inversion, recursion, owner-thread tooling? Strong candidates may mention that they prefer mutex when in doubt because it is harder to misuse.

### Q: Walk me through how you communicated a concurrency-limit change to your team.

Concurrency changes in production are risky — bumping a `Semaphore(10)` to `Semaphore(100)` may overload a downstream. Good answers describe: load testing, staged rollout (feature flag, percentage rollout), communication to the downstream owner, monitoring during the change, and a clear rollback plan. The skill is not the technical choice but how to land it safely.

### Q: Tell me about a time you wrote a load test that exercised a semaphore-protected resource.

Listen for: realistic workload generation, varying concurrency, measuring p50/p95/p99 latency *and* queue wait time, finding the saturation point, comparing to Little's Law predictions. Weak answers measure only throughput; strong answers report saturation behaviour and tail dynamics.

### Q: When have you removed a semaphore from production code, and why?

Sometimes the right answer is "no semaphore" — the downstream already enforces a limit, or a token bucket is more appropriate, or the work is fast enough that the cap is never reached and only adds overhead and a contention point. Strong candidates have removed unnecessary complexity, not just added it.

### Q: How do you onboard a junior to concurrency primitives, including semaphores?

Look for: starting with conceptual model (counter + wait queue), running them through one of the classic examples (producer/consumer, dining philosophers), surfacing the ownership vs no-ownership distinction with mutexes, code-reviewing their first usage carefully, and pairing on a real production incident if possible. Strong candidates do not just hand over a textbook.

### Q: When you read open-source code, what semaphore usage have you found most instructive (positive or negative)?

This probes whether the candidate reads code for learning. Possible answers: Go's `x/sync/semaphore` source as a model of weighted-permit fairness; Java's `Semaphore` built on `AbstractQueuedSynchronizer`; Tokio's notify-based implementation; or war stories about a semaphore misused in a project they joined.

---

## What I'd Ask a Candidate Now

### Q: What is the most surprising semaphore behaviour you have run into?

I want to hear a concrete story — not a textbook trap. The candidate's choice of "surprise" tells me where their depth is: someone who picks "release-from-wrong-thread" has read about ownership; someone who picks "thundering herd on release(N)" has run a real load test; someone who picks "permit leak under cancellation" has debugged a real outage. There is no wrong answer, just signal about experience.

### Q: Walk me through how you would size a connection-pool semaphore for a service you do not yet have load data for.

I want to see structured thinking: start from downstream capacity (DB max connections / N_replicas / N_services), divide by some safety margin, sanity-check against expected RPS and per-request latency (Little's Law), plan to add monitoring on wait time, and commit to revising once data arrives. A candidate who answers "100, that's what I always use" is a yellow flag.

### Q: When would you actively *avoid* a semaphore and use something else instead?

Looking for: "if I need ownership, mutex; if I need rate, token bucket; if I need backpressure-aware async, channel; if I need cross-process coordination across machines, distributed lock or external rate limiter". The candidate should treat semaphores as one tool of many, not as a hammer.

### Q: How do you make a permit's lifetime visible in your monitoring?

Strong candidates describe: a metric for "permits in use" (gauge), "wait time before acquire" (histogram), "hold time" (histogram), "acquisition failures or timeouts" (counter). They link these to alerting: alert if hold p99 > X, alert if wait p99 > Y, alert if pool utilisation > 90% sustained.

### Q: Describe a code review comment you would leave on PR using `Semaphore(20).acquire()` without a paired `release` in a `finally`.

I want to see them flag the leak risk, suggest the RAII or `try/finally` pattern, and frame it constructively. Bonus if they note that languages with drop-guard semantics (Rust, C++) make this category of bug structurally impossible.

### Q: You inherit a service with `Semaphore(500)` everywhere. What do you do?

Listen for the order of operations: first add observability (what is utilisation? wait time?), then load-test to discover real saturation, *then* consider tuning. A candidate who jumps to "lower it to 50" without data is the kind who breaks production. A candidate who immediately raises it is the kind who causes downstream outages.

### Q: Explain semaphores to a non-engineer in 60 seconds.

Tests communication skill. A clean answer: "Imagine a parking garage with N spots and a sign at the entrance counting how many are free. Cars enter only when the count is positive — they decrement it. When a car leaves it increments the sign. If the sign hits zero, new cars wait at the entrance until someone leaves. That's a semaphore — a counter for how many concurrent users a shared resource has room for."

---

## Cheat Sheet

| Concept | One-liner |
|---|---|
| Semaphore | Counter + wait queue, atomic `acquire`/`release`. |
| Binary semaphore | Capacity 1; mutex-like but no ownership. |
| Counting semaphore | Capacity N; gates N concurrent holders. |
| Weighted | Acquire `k` permits in one atomic call. |
| Fair | FIFO waiters — bounded wait, lower throughput. |
| Unfair | Newcomer may steal — higher throughput, possible starvation. |
| Mutex vs semaphore | Mutex has owner + recursion + priority inheritance; semaphore does not. |
| Signal vs lock | Mutex for exclusion; semaphore for both exclusion and cross-thread signalling. |
| Permit leak | Missing `release` on exception path; fix with `try/finally`, RAII, `with`. |
| Over-release | Counter drifts above N; use `BoundedSemaphore` or strict invariants. |
| Cancellation | Implementation must remove cancelled waiter without consuming a permit. |
| Thundering herd | `release(N)` wakes N waiters at once; prefer smooth release. |
| Concurrency limit vs rate limit | Semaphore = concurrency; token bucket = rate. |
| Connection pool | Counting semaphore around free list of connections. |
| Bulkhead | Per-dependency semaphore isolates failures. |

| API | Acquire | Release | Fair? | Cancel-aware? |
|---|---|---|---|---|
| POSIX `sem_t` | `sem_wait` | `sem_post` | Implementation-defined | `EINTR` loop |
| Java `Semaphore` | `acquire()` | `release()` | Optional (`true`) | `InterruptedException` |
| Python `threading.Semaphore` | `acquire(timeout=)` | `release()` | No | Timeout returns False |
| Python `asyncio.Semaphore` | `await acquire()` | `release()` | FIFO | `CancelledError` |
| Go channel-as-sem | `ch <- struct{}{}` | `<-ch` | FIFO | Via `select`/`ctx.Done` |
| Go `x/sync/semaphore` | `Acquire(ctx, n)` | `Release(n)` | FIFO | Context-aware |
| Rust `tokio::Semaphore` | `acquire().await` | Drop guard | FIFO | Drop future |

## Further Reading

- Dijkstra, E. W. — "Cooperating Sequential Processes" (1965). The original semaphore paper.
- Andrews, G. — *Concurrent Programming: Principles and Practice*. Deep coverage of P/V and classic problems.
- Herlihy & Shavit — *The Art of Multiprocessor Programming*. Modern treatment with memory-model context.
- Goetz et al. — *Java Concurrency in Practice*. Chapters on `Semaphore` and bounded resource pools.
- Tokio docs — `tokio::sync::Semaphore` source and design notes.
- Russ Cox — "Go's Memory Model" and the `x/sync/semaphore` source for weighted-permit fairness.
- POSIX `sem_overview(7)`, `sem_wait(3)`, `sem_post(3)` man pages.
- "Little's Law" — for sizing pools based on arrival rate and service time.

## Related Topics

- [Mutex](../01-mutex/README.md) — exclusive access with owner thread.
- [Condition Variable](../03-condition-variable/README.md) — wait-for-predicate primitive.
- [Channel](../../05-channels-csp/README.md) — value-passing concurrency.
- [Rate Limiting & Throttling](../../../../../../system-design/rate-limiting/README.md) — when concurrency limiting is not enough.
- [Bulkhead Pattern](../../../../../../system-design/resilience/bulkhead/README.md) — isolating failure with semaphores.
- [Circuit Breaker](../../../../../../system-design/resilience/circuit-breaker/README.md) — complementary resilience pattern.
- [Connection Pooling](../../../../../../system-design/databases/connection-pooling/README.md) — the canonical semaphore application.
- [Memory Models & Happens-Before](../../../memory-models/README.md) — why semaphores are also memory barriers.
