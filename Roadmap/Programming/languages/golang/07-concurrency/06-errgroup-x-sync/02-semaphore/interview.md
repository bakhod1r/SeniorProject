# x/sync semaphore — Interview Questions

## Table of Contents
1. [Introduction](#introduction)
2. [Warm-Up Questions](#warm-up-questions)
3. [Core Behaviour Questions](#core-behaviour-questions)
4. [Comparison Questions](#comparison-questions)
5. [Design Trade-Off Questions](#design-trade-off-questions)
6. [Internals Questions](#internals-questions)
7. [Bug-Spot Questions](#bug-spot-questions)
8. [Open-Ended System Design](#open-ended-system-design)
9. [Tips for Candidates](#tips-for-candidates)

---

## Introduction

`golang.org/x/sync/semaphore` shows up in concurrency interviews because it touches everything: goroutines, channels, context, fairness, the memory model. Below are questions in increasing difficulty with model answers.

The goal is not to memorise — it is to be able to derive any answer from "semaphore = counter + FIFO queue of waiters parked on per-waiter channels."

---

## Warm-Up Questions

### Q1. What does `semaphore.NewWeighted(8)` create?

**A.** A weighted counting semaphore with capacity 8. `Acquire` calls may take any positive weight; the sum of currently-acquired weights cannot exceed 8.

### Q2. What three methods does `*semaphore.Weighted` expose?

**A.** `Acquire(ctx, n) error`, `TryAcquire(n) bool`, `Release(n)`.

### Q3. Why does `Acquire` take a `context.Context`?

**A.** Because an acquire may block indefinitely if capacity is exhausted. The `ctx` is the caller's way to give up. When `ctx` cancels, `Acquire` returns `ctx.Err()` and the caller does not hold a slot.

### Q4. What happens if I forget to call `Release`?

**A.** The slot is leaked permanently. After enough leaks the semaphore is saturated and all subsequent `Acquire` calls block until ctx cancels.

### Q5. What happens if I call `Release(n)` more than I acquired?

**A.** Panic with `"semaphore: released more than held"`.

### Q6. What is the difference between a counting semaphore and a binary semaphore?

**A.** Counting semaphore has capacity > 1 (multiple holders). Binary semaphore has capacity 1. A binary semaphore is functionally similar to a mutex, but any goroutine can release a binary semaphore, whereas a mutex must be released by the goroutine that locked it.

### Q7. Is `semaphore.Weighted` part of the Go standard library?

**A.** No. It is in `golang.org/x/sync/semaphore`, a Go-team-maintained module outside the standard library. Install with `go get golang.org/x/sync`.

---

## Core Behaviour Questions

### Q8. What does `TryAcquire(n)` return when capacity is free but waiters are queued?

**A.** `false`. `TryAcquire` respects FIFO; it does not jump the queue. This is intentional — otherwise a hot loop calling `TryAcquire` could starve parked waiters.

### Q9. What happens if I call `Acquire(ctx, n)` with `n > capacity`?

**A.** It blocks forever, or until `ctx` cancels, whichever comes first. The semaphore does not error on impossible requests. Validate weights against capacity before calling.

### Q10. Does `Acquire` return immediately if `ctx` is already cancelled?

**A.** Yes. The implementation checks `ctx.Done()` before taking a slot, so a pre-cancelled context returns `ctx.Err()` without modifying state.

### Q11. Is the order in which waiters are woken FIFO?

**A.** Yes, strictly FIFO. Documented and implemented via `container/list`.

### Q12. Can a heavy waiter at the head of the queue block lighter waiters behind it?

**A.** Yes — this is head-of-line blocking. If the head wants 10 and only 5 is free, no further waiters are woken even if those behind would fit. This is a deliberate fairness trade-off.

### Q13. Does `Acquire` synchronise-with `Release`?

**A.** Yes. A successful `Acquire(ctx, n)` happens-after the `Release(n)` (or chain of Releases) that made capacity available. This is the same edge channel send/receive provides; the implementation realises it via a channel close.

### Q14. Can I call `Release` from a goroutine different from the one that called `Acquire`?

**A.** Yes. Unlike a `sync.Mutex`, the semaphore does not bind acquire and release to a single goroutine.

### Q15. What does `Acquire(ctx, 0)` do?

**A.** Returns `nil` immediately. No slot is taken, no `Release` is needed.

---

## Comparison Questions

### Q16. When should I use a buffered channel as a semaphore instead of `semaphore.Weighted`?

**A.** When:
- Weights are all 1 (no need for variable cost).
- You need to use the acquire inside a `select`.
- You want to avoid adding `golang.org/x/sync` as a dependency.

A buffered channel of capacity N is simpler and standard-library-only.

### Q17. When should I use `semaphore.Weighted` instead of a buffered channel?

**A.** When:
- Weights vary across acquisitions (memory budgets, GPU memory, variable-cost jobs).
- You want context-aware acquisition without writing a `select` block.
- You want a documented FIFO ordering guarantee.

### Q18. How does `semaphore.Weighted` compare to `errgroup.SetLimit`?

**A.** `errgroup.SetLimit(n)` (since Go 1.20) gives `errgroup` bounded concurrency for the weight = 1 case. It is simpler than pairing `errgroup` with a separate semaphore. Use `errgroup.SetLimit` for weight = 1 fan-out; reach for `semaphore.Weighted` when weights vary or the semaphore is shared across multiple errgroups.

### Q19. How does `semaphore.Weighted` compare to a POSIX `sem_t`?

**A.** Both are counting semaphores. Differences:
- `sem_t` is OS-managed (kernel-backed via futex on Linux); `semaphore.Weighted` is pure user-space Go.
- `sem_t` is unweighted (capacity is integer count); `semaphore.Weighted` supports weighted acquisitions.
- `sem_t` can be cross-process (named); `semaphore.Weighted` is in-process only.
- `sem_t` uses `sem_timedwait` for timeout; `semaphore.Weighted` uses `context.Context`.

### Q20. Could I implement `semaphore.Weighted` with a buffered channel?

**A.** Only for weight = 1. For weighted, you would need to send N tokens for an acquire of weight N — but that operation is not atomic, so two concurrent weighted acquires can interleave and produce incorrect results. The `list.List`-based design is necessary for the weighted case.

---

## Design Trade-Off Questions

### Q21. Why is the FIFO policy fixed in `semaphore.Weighted` instead of pluggable?

**A.** Pluggability adds complexity for little payoff. FIFO has the strongest fairness guarantee (no starvation given continued releases). The vast majority of production use cases want FIFO. The minority that want LIFO, best-fit, or priority-aware ordering implement their own semaphore — which is short, ~100 lines.

### Q22. The semaphore has no `Used()` or `Waiting()` getter. Why?

**A.** Exposing such state invites TOCTOU bugs: caller reads `Used()`, decides to acquire, but state changed between read and acquire. The package authors chose to keep state private. Observability is the caller's job — wrap with metrics.

### Q23. Why does `Acquire` allocate a fresh channel per parked waiter instead of pooling them?

**A.** Simplicity. Allocating a small `chan struct{}` and `*list.Element` per parked acquire is acceptable for the slow path. Pooling would complicate the wake/cancel races. Production benchmarks have not shown allocation to be a bottleneck.

### Q24. How would you change the implementation to provide a `Capacity()` getter?

**A.** Trivial: `func (s *Weighted) Capacity() int64 { return s.size }`. `size` is set once and read-only after construction, so no synchronisation is needed.

### Q25. Could `semaphore.Weighted` be lock-free?

**A.** The fast path could be made lock-free with atomic CAS on `cur`, but the slow path needs the waiter list, which is a non-trivial concurrent data structure to make lock-free. Practically, the mutex is fast enough — the slow path is dominated by goroutine wake latency, not mutex contention.

---

## Internals Questions

### Q26. Describe the internal data structures of `semaphore.Weighted`.

**A.** A `sync.Mutex`, an `int64 size` (capacity), an `int64 cur` (currently used), and a `container/list.List` of `waiter` structs. Each `waiter` holds the requested weight `n` and a `chan struct{} ready` that is closed when the waiter is granted.

### Q27. How does `Release` wake a parked waiter?

**A.** Under the lock, it decrements `cur`, then walks the front of the waiter list. While the head waiter fits, it removes the head, increments `cur` by the head's weight, and closes the head's `ready` channel. The closed channel unblocks the parked goroutine.

### Q28. What happens if a parked waiter's `ctx` cancels at the exact moment `Release` is closing its `ready`?

**A.** The cancelled-Acquire's outer `select` may pick `<-done` first. The cleanup path then re-checks `ready` under the lock; if `ready` is already closed, the grant happened, so the slot is released back via `cur -= n` and `notifyWaiters`. This avoids losing a slot to a cancellation race.

### Q29. Where in the implementation is FIFO enforced?

**A.** In two places:
1. **`Acquire` fast path** requires `s.waiters.Len() == 0`. A fresh acquire cannot bypass parked waiters.
2. **`notifyWaiters`** stops at the head if the head does not fit, rather than scanning past for a fitting waiter.

### Q30. What is the worst-case time complexity of `Release`?

**A.** O(k) where k is the number of waiters woken. Each wake is O(1) (list removal + channel close). Total work is proportional to the number of waiters that fit; in the steady state this is small.

---

## Bug-Spot Questions

### Q31. Find the bug:

```go
sem := semaphore.NewWeighted(10)
sem.Acquire(ctx, 5)
sem.Acquire(ctx, 7)
sem.Release(5)
sem.Release(7)
```

**A.** Probable bug: the second `Acquire(ctx, 7)` parks because only 5 is free. If the caller expected both acquires to succeed sequentially (single goroutine), it will deadlock — no other goroutine is releasing. Also, the `Acquire` errors are not checked.

### Q32. Find the bug:

```go
sem := semaphore.NewWeighted(8)
for _, x := range items {
    go func(x Item) {
        sem.Acquire(ctx, 1)
        defer sem.Release(1)
        process(x)
    }(x)
}
```

**A.** Two bugs:
1. `Acquire` is called *inside* the spawned goroutine, so all goroutines are spawned immediately. The semaphore limits *concurrent processing* but does not limit *concurrent goroutine count*. With 1M items, this spawns 1M goroutines.
2. `Acquire` error is not checked.

Fix: call `Acquire` in the producer loop before `go func()`.

### Q33. Find the bug:

```go
sem := semaphore.NewWeighted(10)
err := sem.Acquire(ctx, 1)
defer sem.Release(1)
if err != nil { return err }
```

**A.** `defer sem.Release(1)` is placed *before* the error check. On a failed `Acquire`, no slot was taken, but `Release` will still run on function exit, panicking with `"semaphore: released more than held"`.

Fix: defer release only after confirming success.

### Q34. Find the bug:

```go
sem := semaphore.NewWeighted(100)
cost := userInput.Cost // attacker-controlled
sem.Acquire(ctx, cost)
defer sem.Release(cost)
work()
```

**A.** No validation of `cost`. An attacker can pass `cost > 100`, causing `Acquire` to block forever (or until ctx cancels — if no deadline, until the process dies). Validate `cost` against capacity.

### Q35. Find the bug:

```go
sem.Acquire(ctx, computeCost(item))
defer sem.Release(computeCost(item))
work()
```

**A.** `computeCost` is called twice and may return different values (non-deterministic, or `item` mutated). The acquire weight and release weight may differ — leaking or panicking.

Fix: capture once.
```go
cost := computeCost(item)
sem.Acquire(ctx, cost)
defer sem.Release(cost)
```

---

## Open-Ended System Design

### Q36. Design a service that downloads images in parallel with both a count limit (max 32 in flight) and a memory limit (max 512 MiB used).

**A.** Two semaphores:

```go
type Downloader struct {
    cnt *semaphore.Weighted // 32
    mem *semaphore.Weighted // 512 MiB
}

func (d *Downloader) Get(ctx context.Context, url string) error {
    size, err := head(ctx, url) // get Content-Length
    if err != nil { return err }
    if size > 512<<20 {
        return errors.New("oversize")
    }

    if err := d.mem.Acquire(ctx, size); err != nil { return err }
    defer d.mem.Release(size)

    if err := d.cnt.Acquire(ctx, 1); err != nil { return err }
    defer d.cnt.Release(1)

    return download(ctx, url, size)
}
```

Order matters: memory first, then count. Acquiring count first risks holding a count slot while waiting for memory, wasting concurrency.

### Q37. The downloader is hitting p99 latency spikes. What would you measure?

**A.** Wrap `Acquire` in a metric:

```go
start := time.Now()
err := sem.Acquire(ctx, n)
acquireWaitHistogram.Observe(time.Since(start).Seconds())
```

Emit per-semaphore. Compare wait time on memory vs count semaphore. Whichever has higher waits is the bottleneck. Increase its capacity (after verifying the underlying resource — RAM, sockets — can sustain it).

### Q38. You need to support 10x the throughput. The current capacity is 32. Should you just set it to 320?

**A.** Probably not. Apply Little's Law: `concurrency = throughput * latency`. If latency stays the same and throughput is 10x, concurrency must be 10x — but only if the downstream service can sustain 10x load. If it cannot, increasing the semaphore moves the bottleneck downstream and may make things worse.

Measure first. Maybe the latency drops as you scale up (less queueing); maybe it rises. The semaphore capacity should be set to the largest concurrency the downstream sustainably handles at acceptable latency.

### Q39. Design a per-tenant rate limit on top of a global concurrency limit.

**A.** Two layers:

```go
type Limiter struct {
    global   *semaphore.Weighted          // overall cap
    perUser  sync.Map                     // userID -> *semaphore.Weighted
    userCap  int64
}

func (l *Limiter) Acquire(ctx context.Context, user string) error {
    if err := l.global.Acquire(ctx, 1); err != nil { return err }
    u := l.userSem(user)
    if err := u.Acquire(ctx, 1); err != nil {
        l.global.Release(1)
        return err
    }
    return nil
}

func (l *Limiter) Release(user string) {
    l.userSem(user).Release(1)
    l.global.Release(1)
}
```

Cleaning up idle per-user semaphores is a separate concern: a periodic sweep that removes user semaphores whose `Used()` (you would need to track this manually) is 0 for some time.

### Q40. You inherited a service with `semaphore.NewWeighted(1)` used as a mutex. Should you change it?

**A.** Probably yes, to `sync.Mutex`. The semaphore-as-mutex pattern is awkward:
- It is slower (mutex + list overhead vs simple mutex).
- It requires a `ctx` parameter, which adds noise.
- It allows the wrong goroutine to release, which is sometimes a bug.

The one reason to keep a capacity-1 semaphore: when you specifically need *context-aware lock acquisition* (e.g., "wait at most 100 ms for this lock"). Standard `sync.Mutex` does not support that. If that is the requirement, a capacity-1 semaphore is the right tool.

---

## Tips for Candidates

1. **Always show the cleanup.** Every `Acquire` example must include `defer Release`. Interviewers watch for this.
2. **Mention FIFO unprompted.** If you say "the semaphore parks the waiter," add "in FIFO order." It demonstrates depth.
3. **Distinguish weight = 1 from weighted.** Many candidates use `semaphore.Weighted` like a buffered channel. Show you understand when weighted is the killer feature.
4. **Discuss context.** Acquire returns `ctx.Err()`; do not invent other errors. Discuss the cancellation race if asked.
5. **Compare to alternatives.** Buffered channel, `errgroup.SetLimit`, `sync.Mutex`. Show you can choose the right tool, not just default to one.
6. **Mention observability.** Wrap acquire in metrics; the package itself exposes none.
7. **Read the source.** The implementation is ~100 lines. Interviewers will reward "I have read the source" with deeper follow-up questions you can handle.
