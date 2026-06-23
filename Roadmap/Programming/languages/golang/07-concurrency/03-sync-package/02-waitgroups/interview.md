---
layout: default
title: WaitGroups — Interview
parent: WaitGroups
grand_parent: sync Package
nav_order: 6
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/interview/
---

# WaitGroups — Interview

← Back to WaitGroups

A graduated set of WaitGroup interview questions, junior to staff. Each comes with a model answer and follow-ups.

---

## Junior

### Q1. What is `sync.WaitGroup` for?

**Answer.** A WaitGroup blocks the caller of `Wait` until a fixed number of `Done` calls have been made. It is used to wait for a known set of goroutines to finish.

### Q2. Name the three methods.

**Answer.** `Add(n int)`, `Done()`, `Wait()`. `Done` is `Add(-1)`.

### Q3. Why pass a pointer to a WaitGroup?

**Answer.** A `sync.WaitGroup` contains a counter. Passing by value copies the counter; the original is never decremented and `Wait` hangs forever. `go vet` warns about this.

### Q4. Why is `defer wg.Done()` the first line of a worker goroutine?

**Answer.** `defer` guarantees `Done` runs even on early return or panic. Forgetting it means a missing decrement and a hung `Wait`.

### Q5. What's wrong with this code?

```go
for i := 0; i < 5; i++ {
    go func(i int) {
        wg.Add(1)
        defer wg.Done()
        work(i)
    }(i)
}
wg.Wait()
```

**Answer.** `Add` is inside the goroutine. By the time `Wait` runs in the parent, none of the goroutines may have started, so the counter is zero and `Wait` returns prematurely. `Add` must run in the parent before `go`.

### Q6. What happens if `Done` is called more times than `Add`?

**Answer.** The counter goes negative and the runtime panics with `sync: negative WaitGroup counter`.

### Q7. What happens if `Done` is called fewer times than `Add`?

**Answer.** `Wait` blocks forever. If every other goroutine is also blocked, the runtime detects "all goroutines are asleep" and crashes; otherwise the program just hangs.

### Q8. Can you call `Wait` multiple times?

**Answer.** Yes. Multiple goroutines may call `Wait`; all are released atomically when the counter reaches zero. After `Wait` returns and the counter is zero, the WaitGroup may be reused.

---

## Middle

### Q9. Why is `Add(positive)` racing with `Wait` undefined?

**Answer.** `Wait` reads the counter; if it sees zero, it returns. If `Add(1)` is concurrent with `Wait`, the read may legally observe the pre-Add value, so `Wait` returns before the goroutine has been registered. This is a fundamental property of all counter-based barriers; the fix is to register before launching, in the parent goroutine.

### Q10. What does `go vet` warn about for WaitGroup?

**Answer.** Pass-by-value of any type containing a `noCopy` field — including `sync.WaitGroup`, `sync.Mutex`, `sync.Cond`. The warning text is "passes lock by value: sync.WaitGroup contains sync.noCopy".

### Q11. How do you collect errors from goroutines coordinated by a WaitGroup?

**Answer.** Three options. Easiest: a buffered error channel sized to the worker count. Closed *after* `Wait` returns. Or pre-allocate a per-goroutine error slot and read after `Wait`. Or use `golang.org/x/sync/errgroup`, which is the modern idiomatic answer.

### Q12. Compare WaitGroup vs `done := make(chan struct{})`.

**Answer.** A done-channel signals one event. A WaitGroup counts N events. For a single goroutine, either works; the channel is more flexible (can `select` with timeout). For N goroutines, WaitGroup is the better fit. For pipelines, channels naturally express completion via close.

### Q13. How would you add a timeout to `wg.Wait()`?

**Answer.** Spawn a wrapper goroutine that calls `wg.Wait()` then closes a `done` channel; `select` on `done` and `time.After`. Caveat: if the timeout fires, the wrapper goroutine leaks until the WaitGroup actually drains. The proper fix is to pass a `context.Context` to the workers so they exit on cancellation.

### Q14. Can the same WaitGroup be reused for multiple rounds of fan-out?

**Answer.** Yes, if there is no overlap. After `Wait` returns and the counter is zero, you may call `Add` again. Reuse fails if a new `Add(positive)` happens-concurrently with the previous `Wait`'s release path — that races and may panic.

### Q15. Why is `wg.Add(len(items))` once preferred to `Add(1)` per iteration?

**Answer.** A single atomic op vs N atomic ops. Negligible in real programs, but cleaner.

---

## Senior

### Q16. State the WaitGroup memory-model guarantees.

**Answer.** Every `wg.Done()` call synchronises-before the return of any `wg.Wait()` call it unblocks. This means writes made by a goroutine before its `Done` are visible to anyone after `Wait`. It is what makes the "fill a slice in goroutines, read it after Wait" pattern correct without additional synchronisation.

### Q17. Walk through the internals of `errgroup.Group`. How does it use WaitGroup?

**Answer.** `errgroup.Group` wraps a `sync.WaitGroup` and a `sync.Once`. `Go(f)` calls `wg.Add(1)` *before* the inner `go` keyword, runs `f` in a goroutine, captures the first non-nil error via `errOnce.Do`, and (if a context was provided) cancels it. `Wait` calls `wg.Wait()` then returns the captured error.

### Q18. When would you choose `errgroup` over `WaitGroup`? When the reverse?

**Answer.** Prefer `errgroup` when goroutines can fail and you want fail-fast semantics with cancellation. Prefer plain `WaitGroup` for side-effect-only goroutines, when you can't take an `x/sync` dependency, or when you want to keep running other tasks even if one fails (collect all errors instead of first).

### Q19. Describe the canonical pipeline pattern.

**Answer.** Each stage is a function that reads from an input channel, transforms, and writes to an output channel. Stages with multiple workers use a WaitGroup to count workers; a "closer" goroutine waits on the WaitGroup and closes the output channel when all workers exit. Downstream stages range over the output channel and stop naturally when it closes.

### Q20. What's the bug here?

```go
type Pool struct{ wg sync.WaitGroup }
func (p Pool) Run(f func()) {
    p.wg.Add(1)
    go func() { defer p.wg.Done(); f() }()
}
func (p Pool) Wait() { p.wg.Wait() }
```

**Answer.** Value receivers. Each method gets a copy of the Pool, so each call modifies a different WaitGroup. `Run` and `Wait` see different counters. Fix: use `*Pool` receivers.

### Q21. What does the panic "sync: WaitGroup is reused before previous Wait has returned" indicate?

**Answer.** A new `Add(positive)` was called while a previous `Wait` was still in its release path (not yet returned). The internal state would be inconsistent, so the runtime detects and panics. Symptom of unsafe reuse without round boundaries.

### Q22. Should you embed `sync.WaitGroup` in your public types?

**Answer.** Almost never. Embedding promotes `Add`, `Done`, `Wait` onto your type, exposing implementation details and inviting misuse. Hide the WaitGroup behind methods (`Start`, `Stop`, `Wait`).

### Q23. How does the race detector catch `Add`-after-`Wait`?

**Answer.** Each `Add(positive)` calls `race.ReleaseMerge`, recording a happens-before edge. `Wait` calls `race.Acquire` on return. If `Add` runs concurrently with the `Wait` it should be ordered with, the detector sees an unordered access and reports it. This is much more useful than the runtime panic, which only fires for specific narrow cases.

---

## Staff

### Q24. The internal `state` field packs counter and waiter count into one 64-bit word. Why not two separate fields?

**Answer.** Packing allows the "decrement counter and check waiters" sequence in `Done` to be a single atomic operation. With separate fields you'd need either a mutex, a CAS loop on each, or a memory barrier sequence — all more expensive than a single 64-bit atomic add.

### Q25. Trace the `state` value through the lifecycle: `Add(2)`, `Done`, `Wait`, `Done`, returns.

**Answer.**

| Step       | Counter (high 32) | Waiters (low 32) | state                |
|------------|-------------------|------------------|----------------------|
| init       | 0                 | 0                | 0x00000000_00000000  |
| `Add(2)`   | 2                 | 0                | 0x00000002_00000000  |
| `Done`     | 1                 | 0                | 0x00000001_00000000  |
| `Wait`     | 1                 | 1                | 0x00000001_00000001  |
| `Done`     | 0                 | 1                | 0x00000000_00000001  |
|            | (sees v==0, w>0; resets state to 0, releases sema) |    | 0x00000000_00000000  |
| return     | 0                 | 0                | 0x00000000_00000000  |

### Q26. Why does `runtime_Semacquire` not burn an OS thread when a goroutine parks?

**Answer.** Go's runtime is goroutine-aware. When a goroutine parks on a semaphore, the runtime suspends *the goroutine* (G), not the OS thread (M) that was running it. The thread is freed to run other goroutines. The parked goroutine is recorded in a per-semaphore wait queue indexed by the address of the semaphore word.

### Q27. Compare `sync.WaitGroup` to C++ `std::latch` and Java `CountDownLatch`.

**Answer.** All three are counting barriers with similar API: a counter, a "decrement" operation, and a "wait" operation. Differences:

- `std::latch` is one-shot; once at zero it stays at zero. `WaitGroup` allows reuse.
- `CountDownLatch` is one-shot too; for reusable barriers Java offers `CyclicBarrier` or `Phaser`.
- `WaitGroup`'s `Wait` provides release-acquire semantics; the same is true of `std::latch::wait` and `CountDownLatch.await`.
- `WaitGroup` has no timeout; `CountDownLatch.await(timeout)` does. The Go convention is to plumb `context.Context`.

### Q28. Describe a real-world bug caused by reusing a WaitGroup wrong.

**Answer.** Common scenario: a long-running daemon spawns workers in batches. Round 1's `Wait` is still running its release path when round 2 issues an `Add`. Under load this manifests as occasional `panic: sync: WaitGroup is reused before previous Wait has returned`. Fix: introduce a strict round-end barrier (channel signal, mutex, or simply a fresh WaitGroup per round).

### Q29. How would you design a "drain and shutdown" sequence for a server using WaitGroup?

**Answer.**

```go
func (s *Server) Shutdown(ctx context.Context) error {
    close(s.stop)              // signal workers
    done := make(chan struct{})
    go func() { s.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()       // grace period exceeded
    }
}
```

The pattern: signal workers, wait with a grace timeout, return on either path. The wrapper goroutine that closes `done` is the standard "WaitGroup-to-channel" bridge.

### Q30. When would you reach for `golang.org/x/sync/semaphore.Weighted` instead of WaitGroup or errgroup?

**Answer.** When you need to bound concurrency with non-uniform "weights" — for example, large jobs cost 4 units and small jobs cost 1, and the total budget is N. Plain bounded errgroup (`SetLimit`) only counts goroutines, treating each as cost 1.

### Q31. Could you implement WaitGroup in user code without using `sync` primitives?

**Answer.** Conceptually, yes — using `atomic.Int64` for the counter and a `chan struct{}` for the wake-up. But you'd reinvent everything `runtime_Semacquire` does, and you wouldn't get the race detector hooks. The exercise is instructive but the result is strictly worse than the standard library.

```go
type MyWG struct {
    n    atomic.Int64
    done chan struct{}
}
func (w *MyWG) Add(d int)   { w.n.Add(int64(d)) }
func (w *MyWG) Done()       { if w.n.Add(-1) == 0 { close(w.done) } }
func (w *MyWG) Wait()       { <-w.done }
```

This toy version has bugs: it can only be used once, and `Add(positive)` from zero races with `Wait` (worse than `sync.WaitGroup` because there's no panic to catch you). Stick with the standard library.

---

## Curveball questions

### Q32. Is `sync.WaitGroup{}` (no Add ever) and an immediate `Wait` legal?

**Answer.** Yes. The counter is zero, `Wait` returns immediately. This is occasionally useful as a placeholder.

### Q33. After `Add(1)` and `Done()`, is the WaitGroup in the same state as a freshly declared one?

**Answer.** Functionally yes, but the spec considers it "after first use". Strictly, copies after first use are forbidden, so even if the counter is zero you should not, e.g., `*newWG = *oldWG`.

### Q34. What if you `Add(0)`?

**Answer.** No-op. The counter doesn't change. No panic. Useful as a synchronisation point for the race detector, but rarely needed.

### Q35. Why does the API not expose the current counter?

**Answer.** Exposing it would invite race conditions: any read of the counter would be stale by the time the caller used it. The Go team chose the minimal API that prevents misuse. If you need to count outstanding goroutines for observability, maintain your own `atomic.Int64` alongside the WaitGroup.

---

## Self-evaluation

If you can answer Q1–Q15 cleanly, you have a solid junior-to-middle understanding. Q16–Q23 are typical senior screen material. Q24–Q31 are staff-level. Q32–Q35 are curveballs that good interviewers throw to test depth without trick questions.

Pair this with [find-bug.md](find-bug.md) for hands-on debugging practice, and [tasks.md](tasks.md) for coding exercises.
