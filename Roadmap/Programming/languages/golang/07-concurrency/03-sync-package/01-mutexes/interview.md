# Mutexes — Interview Questions

A graded set of questions used in real interviews. Answers are provided for each. Topics cover mutex semantics, RWMutex trade-offs, deadlocks, the copy-of-mutex bug, atomics vs mutexes, internal mode switching, and production-style debugging.

---

## Junior Level

### Q1. What is a `sync.Mutex` and when do you use it?

A mutex (mutual-exclusion lock) is a synchronisation primitive that ensures only one goroutine at a time can execute a given critical section. You use it when multiple goroutines may read or write the same shared variable and at least one of those operations is a write. Without it, the program has a data race.

### Q2. Show the standard pattern for using a mutex.

```go
var mu sync.Mutex
mu.Lock()
defer mu.Unlock()
// critical section
```

`defer mu.Unlock()` is placed immediately after `Lock()` so that the lock is released on every return path, including panics.

### Q3. Why is `counter++` not atomic in Go?

Because it compiles to three operations: load the value, add one, store the result. Two goroutines can interleave these instructions and the result of one increment is overwritten by the other. A single line of source code does not equal a single machine instruction.

### Q4. What does `go run -race` do?

It enables the race detector. The compiler instruments every memory access; at runtime, the detector watches for accesses to the same memory from different goroutines without happens-before ordering. When a race is detected, it prints a stack trace showing both accesses.

### Q5. What is the difference between `sync.Mutex` and `sync.RWMutex`?

`sync.Mutex` allows exactly one goroutine inside the critical section.
`sync.RWMutex` allows either one writer or many concurrent readers. Use it when reads dominate over writes — typically a 5:1 ratio or higher.

### Q6. Is the zero value of `sync.Mutex` valid?

Yes. `var mu sync.Mutex` is an unlocked mutex, ready to use. There is no `NewMutex()` constructor.

### Q7. What goes wrong if you copy a struct containing a mutex?

The copy has its own independent mutex. Locking it does not block goroutines using the original, so mutual exclusion fails silently. `go vet` catches most cases.

---

## Middle Level

### Q8. Why does Go reject reentrant locking?

Russ Cox's argument: reentrant mutexes pretend that "I have the lock, so the data is consistent" applies inside nested calls, but the outer caller may be in the middle of a multi-step update. Forcing non-reentrancy makes you factor out an `xxxLocked` helper, which forces clarity. There is also no built-in goroutine ID, so making the mutex reentrant would require runtime support that the Go team chose not to add.

### Q9. Show the deadlock that comes from lock-ordering inversion.

```go
// Goroutine A: locks a then b
a.mu.Lock()
b.mu.Lock()

// Goroutine B: locks b then a
b.mu.Lock()
a.mu.Lock()
```

If A holds `a.mu` and B holds `b.mu` simultaneously, A waits for `b.mu`, B waits for `a.mu` — deadlock. The cure is a global lock order, e.g., always order by struct ID.

### Q10. When is `RWMutex` slower than `Mutex`?

`RWMutex` has more bookkeeping per operation. If reads do not actually run concurrently (e.g., the critical section is so short the lock is barely contended), `RWMutex` is slower because each `RLock`/`RUnlock` costs more atomic ops. As a heuristic, only use `RWMutex` when reads outnumber writes by at least 5× and the read critical section is non-trivial.

### Q11. What is the copy-of-mutex bug and how do you prevent it?

A struct that contains a `sync.Mutex` should never be copied after first use. Copying produces a new mutex unrelated to the original. Common ways to copy: value receiver methods, returning by value, range-over-slice loop variable. Prevent it by:
- Using pointer receivers (`func (s *S) ...`) for any method on a struct with a mutex.
- Storing pointers in maps and slices: `map[K]*T`, `[]*T`.
- Running `go vet`, which has the `copylocks` check enabled by default.

### Q12. Why is `defer mu.Unlock()` better than calling `Unlock()` manually at the end of the function?

Three reasons:
1. Multiple return paths: any `return` inside the function still triggers the deferred unlock.
2. Panics: if the critical section panics, the deferred unlock still runs, leaving the mutex in a sane state for the panic recovery (or for the program to crash without dangling locks).
3. Refactoring safety: adding a new early return won't accidentally leave the lock held.

The cost is roughly a few nanoseconds, which is irrelevant in almost any code that needs a mutex at all.

### Q13. Can two goroutines call `Lock` at exactly the same instant? What happens?

They can attempt the underlying CAS at "the same instant," but the hardware serialises atomic operations: only one goroutine's CAS succeeds. The other(s) see the locked state, queue, and park. The runtime's semaphore wakes them in turn when the mutex is released.

### Q14. Why is locking around an HTTP call a bad idea?

Because the HTTP call can take seconds, during which every goroutine waiting on the lock is stuck. A request that should take 5ms can suddenly block for 30s because some other goroutine is holding the lock for an external API call. Snapshot what you need under the lock, release, then make the HTTP call.

---

## Senior Level

### Q15. Explain Go's mutex normal mode vs starvation mode.

Go's `sync.Mutex` has two modes:

- **Normal mode:** A goroutine arriving at `Lock` may "barge" past parked waiters and take the mutex if it's briefly free. This optimises for throughput because no context switch is needed.
- **Starvation mode:** Triggered when a waiter has been waiting > 1ms. The mutex switches to direct hand-off: when the holder calls `Unlock`, the front-of-queue waiter is granted the lock without competing. New arrivals queue. Mode drops back to normal once the queue drains.

Normal mode trades latency for throughput; starvation mode bounds latency at the cost of slightly less throughput.

### Q16. How would you detect mutex contention in a production service?

1. Enable mutex profiling: `runtime.SetMutexProfileFraction(100)` (1-in-100 sampling).
2. Expose `net/http/pprof`.
3. Collect a profile during high load: `curl http://service:6060/debug/pprof/mutex?seconds=30 > mu.prof`.
4. Analyse: `go tool pprof mu.prof` then `top` and `list <function>`.

The output ranks call sites by total contention delay. Top entries are your hot mutexes.

### Q17. Sharded locks: when, how, and at what cost?

Use sharded locks when a single mutex around a map or counter is the throughput bottleneck. Common shapes:

```go
const N = 64
var shards [N]struct {
    mu sync.RWMutex
    m  map[string]V
}
```

Hash the key to pick a shard, then lock just that shard. Costs:
- Memory: N independent maps.
- Iteration: must lock all shards, killing concurrency.
- Cross-shard transactions need ordered multi-shard locking.

Choose N as a power of two (16, 32, 64). Higher counts only help if cores actually parallelise that much.

### Q18. When would you replace `sync.Mutex` with `atomic`?

When the protected state is a single word (int64, pointer, etc.) and the operation is a simple read, write, increment, or pointer swap. `atomic.Int64.Add` is 5–10× faster than a mutex-protected `int64++` and has no contention overhead under load.

For multi-field updates or branching logic ("if x > 0 then y++"), atomics aren't enough; use a mutex or design with copy-on-write.

### Q19. Walk through a real deadlock you've debugged.

(Sample answer.) "A worker pool acquired a worker-level lock and then a job-level lock. A monitoring goroutine acquired the job-level lock first to compute progress, then needed a worker-level lock to read worker state. Under load, the worker held its lock waiting for the job lock, while the monitor held the job lock waiting for the worker lock. The fix was to remove the worker-level lock from the monitor's path entirely — it could read worker state via a snapshot built periodically by each worker."

The interviewer is looking for: identifying the cycle, knowing it's a lock ordering inversion, and fixing it by either reordering or removing one of the dependencies.

### Q20. What is the `Go Memory Model` guarantee for mutexes?

Per the Go Memory Model: writes performed before `mu.Unlock()` are observable to whatever runs after the next `mu.Lock()` returns. Symbolically:

> Call n of `mu.Unlock()` is synchronized before call (n+1) of `mu.Lock()` returning.

This is the release-acquire pair that makes mutex-protected state visible across goroutines without explicit memory barriers.

For RWMutex: a writer's `Unlock` is synchronized before subsequent readers' `RUnlock`s and the next writer's `Lock`. Readers under `RLock` see the state of the most recent writer.

---

## Professional / Staff Level

### Q21. What is inside `sync.Mutex.state`?

A 32-bit packed word:
- Bit 0: `mutexLocked` — the mutex is held.
- Bit 1: `mutexWoken` — a waiter has been signalled and is en route.
- Bit 2: `mutexStarving` — starvation mode active.
- Bits 3–31: number of waiting goroutines.

`Lock` is one CAS in the fast path; `Unlock` is one atomic Add. Slow paths handle queueing, spinning, and starvation hand-off.

### Q22. How does the runtime decide when to spin vs park a waiter?

`runtime_canSpin(iter)` returns true when:
- More than one P is available (so spinning doesn't starve the holder).
- Iteration count is below ~30.
- The holder isn't preempted (heuristic).

If spinning is permitted, the runtime busy-waits for a few cycles, then re-attempts the CAS. If not, it parks via `runtime_SemacquireMutex`, eventually invoking the OS-level futex (Linux), `__ulock_wait` (macOS), or `WaitOnAddress` (Windows).

### Q23. Why is `RWMutex` more complex than `Mutex` internally?

Because it has to maintain three states: number of readers, presence of a waiting writer, and (under a writer) the number of readers still draining. The implementation uses:
- A nested writer `Mutex`.
- A reader-counter `atomic.Int32` (negative when a writer is queued).
- A reader-wait counter for graceful drain.
- Two semaphores for parking readers vs writers.

A read-lock fast path is two atomic ops; a contended write-lock takes the writer mutex, decrements `readerCount` by `1<<30` to flip its sign, then waits for readers to drain.

### Q24. How would you implement a fair (FIFO) mutex in Go?

A semaphore-backed channel:

```go
type FairMutex struct{ ch chan struct{} }

func New() *FairMutex {
    return &FairMutex{ch: make(chan struct{}, 1)}
}

func (m *FairMutex) Lock()   { m.ch <- struct{}{} }
func (m *FairMutex) Unlock() { <-m.ch }
```

Goroutines blocking on `<-` are queued by the runtime in arrival order (Go channels are FIFO under the hood for unbuffered/blocking sends). This mutex is strictly fair, but slower than `sync.Mutex` because every operation pays channel overhead.

For production, prefer `sync.Mutex` and let the runtime's starvation heuristic bound worst-case latency.

### Q25. A production service shows p99 latency of 200ms while p50 is 5ms. The mutex profile shows a hot mutex. How do you diagnose?

Possible causes:
- **Long critical section** under the lock — list the function and look for I/O, JSON marshalling, or expensive computation.
- **Starvation** — check whether the long-tail goroutines are waiting > 1ms, which would push the lock into starvation mode and create context-switch overhead.
- **Contention from a backup task** — a metric flush or GC-trigger goroutine periodically takes the lock for a long burst.

Tools:
1. `go tool pprof -mutexprofile` to find the hot lock.
2. `go tool trace` to see individual goroutine blocked-on-mutex durations.
3. Add `time.Now()` instrumentation around the critical section to measure hold time distribution.

Fixes (in increasing radicality):
1. Shorten the critical section (move work outside).
2. Switch to RWMutex if reads dominate.
3. Shard the lock.
4. Replace with atomics / copy-on-write.
5. Move ownership of the state to a single goroutine + channel.

### Q26. Write a thread-safe counter that supports both per-second rate reads and total reads, with minimal locking.

```go
type Counter struct {
    total atomic.Int64
    rate  atomic.Int64
    last  atomic.Int64 // unix seconds
}

func (c *Counter) Inc() {
    c.total.Add(1)
    now := time.Now().Unix()
    last := c.last.Load()
    if now != last && c.last.CompareAndSwap(last, now) {
        c.rate.Store(1)
    } else {
        c.rate.Add(1)
    }
}

func (c *Counter) Total() int64 { return c.total.Load() }
func (c *Counter) Rate() int64  { return c.rate.Load() }
```

No mutex. Trade-off: the rate isn't a strict "events in the last 1 second" — it's events in the current calendar second. Acceptable for many monitoring use cases.

---

## Bonus Questions

### Q27. Can a goroutine `Unlock` a mutex it didn't lock?

Yes — Go's `Mutex` is not bound to the locking goroutine. Any goroutine may call `Unlock`. This is rarely the right design but the spec permits it. `defer` only works if the same goroutine locks and unlocks.

### Q28. What is the runtime cost of the race detector?

Roughly 2× memory and 5–10× slowdown. Acceptable in development and CI. Don't ship `-race` builds to production.

### Q29. Why does Go prefer "share by communicating" but still provide mutexes?

Channels are great for coordination across boundaries; mutexes are great for protecting a small piece of in-process state. Both have their place. The Go proverb is a guideline, not a prohibition. The standard library itself is full of mutexes.

### Q30. Is `sync.RWMutex` reentrant for readers? E.g., can the same goroutine call `RLock` twice?

No. Go's documentation explicitly says: "If a goroutine holds an RWMutex for reading and another goroutine might call Lock, no goroutine should expect to be able to acquire a read lock until the initial read lock is released." A nested RLock can deadlock if a writer is waiting between them.
