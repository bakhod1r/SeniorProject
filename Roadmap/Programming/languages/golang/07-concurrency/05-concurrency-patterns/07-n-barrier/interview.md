# N-Barrier — Interview Q&A

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Staff Questions](#professional--staff-questions)
5. [Common Traps](#common-traps)
6. [How to Defend the Design](#how-to-defend-the-design)

---

## Junior Questions

### Q1. What is an N-barrier?
A synchronisation point that N goroutines must *all* reach before *any* of them may proceed. Each party arrives and blocks; the Nth arrival releases everyone at once.

### Q2. How is a barrier different from `sync.WaitGroup`?
A `WaitGroup` is asymmetric and one-shot: N goroutines call `Done()`, and a *different* goroutine calls `Wait()`. The workers never wait for each other. A barrier is symmetric: *every* party calls `Wait()` and they release together; a reusable barrier repeats this each phase. Slogan: WaitGroup is "I wait for you all to finish"; a barrier is "we all wait for each other, then go together."

### Q3. What primitive do you build a barrier from in Go?
`sync.Mutex` + `sync.Cond`. The mutex guards a `count`; `cond.Wait()` sleeps an arriving party; the Nth party calls `cond.Broadcast()` to wake everyone.

### Q4. Why `Broadcast` and not `Signal`?
`Signal` wakes a single waiter; a barrier must release *all* N-1 sleeping parties, so it needs `Broadcast`.

### Q5. Why must `cond.Wait()` be inside a `for` loop?
`cond.Wait()` can wake spuriously, and the predicate may have changed by the time it re-acquires the lock. The loop re-checks the predicate and goes back to sleep if it is still false. A bare `if` is a bug.

### Q6. What happens if only N-1 of N parties call `Wait()`?
The barrier never trips and all waiters block forever — a deadlock.

---

## Middle Questions

### Q7. Why can't you reuse the simple one-shot barrier for the next phase?
Its `count` is stuck at N. The next caller does `count++` to N+1, the `count == n` and `count < n` checks both fail, and it returns without waiting. Synchronisation is broken.

### Q8. What is the "fast goroutine races into the next phase" bug, and how do you fix it?
If the last party resets `count = 0` and broadcasts, a freed fast party can loop back to `Wait()` and increment `count` *before* a slow party (still in `cond.Wait()`) wakes and re-checks. The counts tangle. Fix: a **generation counter**. Waiters block until the *generation changes*, not until the count hits N; the last party increments the generation and resets the count atomically under the lock.

### Q9. Sketch a correct reusable barrier.
```go
func (c *Cyclic) Wait() {
    c.mu.Lock()
    defer c.mu.Unlock()
    gen := c.generation
    c.count++
    if c.count == c.n {
        c.generation++
        c.count = 0
        c.cond.Broadcast()
        return
    }
    for gen == c.generation {
        c.cond.Wait()
    }
}
```

### Q10. How would you build a barrier without `sync.Cond`?
Use close-to-broadcast: the Nth party `close()`s a shared `gate` channel (waking all `<-gate`) and installs a fresh gate for the next generation. Each waiter captures *its* generation's gate under the lock before blocking on it. The fresh-gate-per-generation plays the role of the generation counter.

### Q11. Why do iterative simulations often need *two* barriers per tick?
One after the compute phase (so every read of the current buffer finishes before the buffer swap) and one after the swap (so the swap is visible before the next tick's reads). A single barrier leaves a data race on the swap.

### Q12. How do you stop a barrier from deadlocking when a party errors?
Add an abort/cancel path. On error/panic/context-cancel, set a `broken` flag and `Broadcast()`; every waiter wakes, sees `broken`, and returns `ErrBroken`. Use `context.AfterFunc` to wire cancellation into a `Cond`-based wait.

---

## Senior Questions

### Q13. Is a long-lived barrier idiomatic Go? When would you avoid one entirely?
Often you should avoid it. The idiomatic phased pattern is to re-spawn goroutines per phase and join with `WaitGroup`/`errgroup` — the `g.Wait()` between phases *is* the barrier, and you get cancellation and error propagation for free. Use an explicit barrier only when workers must persist across phases because they hold expensive state (warm cache, pinned core, large preallocated buffer).

### Q14. Compare a barrier with `errgroup` for phased work.
`errgroup.WithContext` per phase gives first-error cancellation and context propagation out of the box, at the cost of re-spawning N goroutines each phase. A long-lived barrier preserves worker state across phases but you must build error/cancel handling yourself. Default to errgroup-per-phase; use a barrier only when spawn cost or lost state is shown (by benchmark) to matter.

### Q15. What memory-model guarantee must a barrier provide?
A per-generation happens-before edge: every write a party did before `Wait()` in generation *g* is visible to every party after `Wait()` returns for *g*. The `Mutex`/`Cond` barrier gets this because mutations happen under the lock and `cond.Wait()` re-locks before returning (unlock-happens-before-lock). A lock-free atomic barrier must reproduce this with acquire/release semantics or you get torn phase data on ARM.

### Q16. The centralised `Cond` barrier is slow at N=256. Why, and what do you do?
Every party contends on one mutex, and each trip wakes N-1 goroutines that all immediately re-contend to re-check the predicate — a thundering herd; cost grows super-linearly. For large N use a **tree (combining) barrier** or a **dissemination barrier**, which reduce per-trip contention to O(log N) by avoiding a single shared counter.

### Q17. What is a sense-reversing barrier and why use it?
A reusable barrier that uses a single boolean *sense* that flips each trip instead of a growing generation counter. Each party flips its local sense; the last party sets the global sense to match; waiters wait until `global == local`. It avoids per-trip allocation and any overflow concern. Trade-off: the caller must thread a per-goroutine local-sense variable.

### Q18. Where do barriers fail in practice?
Straggler domination (runs at the slowest party every phase), deadlock on an early `return` that skips `Wait()`, N mismatch between barrier size and goroutine count, hidden serialisation when phases are too short, and reentrancy (calling `Wait()` from a phase action).

---

## Professional / Staff Questions

### Q19. A junior submits a PR adding a custom barrier. What do you check?
Is it really phased work with long-lived stateful workers (else prefer errgroup-per-phase)? Generation/sense reset (not a bare `count=0`)? `for`-loop around `Wait()`? N fixed per trip and matching the goroutine count? A cancellation/abort path? Panic-to-abort safety? A watchdog that names stuck parties? Tests under `-race` with a timeout? A missing abort path is a blocking comment.

### Q20. How do you operate a barrier in production?
Instrument `trips_total`, a `wait_seconds` histogram, a `parties_arrived` gauge (alert when it stalls below N), and `aborts_total`. On a stuck barrier, dump goroutines (`runtime.Stack`) — you will see N-1 parked in `notifyListWait` and one elsewhere, naming the culprit. Shutdown must `Abort()`/cancel the context; a flag the parked party never reads will not free it.

### Q21. How does a barriered subsystem interact with the rest of the system?
It advances at its slowest party, so upstream needs backpressure (a bounded queue / Push-Pull) or you just move the OOM risk upstream. If parties come from a shared pool, a stuck barrier starves the pool — prefer dedicated goroutines. Thread the request context all the way into `Wait(ctx)`.

### Q22. How would you implement a barrier across processes?
Use a coordination service: ZooKeeper's double-barrier recipe (ephemeral znodes, enter when child count hits N), etcd leases + transactions, or a framework's stage boundary (Spark, K8s Job completions). Always pair with a lease/TTL so a dead node's slot is reclaimed — never wait forever for a node that may never return.

---

## Common Traps

- **"A WaitGroup is a barrier."** No — workers don't wait for each other; it's one-shot and asymmetric.
- **"Reset the count to 0 to reuse it."** Races; you need a generation counter or sense flag.
- **`if cond.Wait()` instead of `for`.** Spurious wakeups break it.
- **`Signal` instead of `Broadcast`.** Leaves N-2 parties asleep.
- **Early `return` before `Wait()`.** Strands the cohort.
- **One barrier where a buffer swap needs two.** Data race on the swap.
- **No cancellation.** First error → permanent deadlock.
- **"Just add `time.Sleep` polling."** Wastes CPU, adds latency jitter; use `Cond`/channel.

---

## How to Defend the Design

When an interviewer challenges your barrier choice, anchor on three points:

1. **Necessity.** "These workers hold a warm per-shard cache I do not want to rebuild each phase, so I keep them alive and synchronise with a barrier rather than re-spawning. If they were stateless I'd use errgroup-per-phase."
2. **Correctness.** "Reuse is safe because of the generation counter — waiters block on a generation change, so a fast looper can't satisfy a stale predicate. `Wait()` is in a `for` loop for spurious wakeups, and the barrier gives a per-generation happens-before edge, which is what makes the buffer swap safe."
3. **Resilience.** "Every wait is context-cancellable; a panic or error in any party calls `Abort()` so peers get `ErrBroken` instead of deadlocking; a watchdog names parties that haven't arrived. We alert when arrived-parties stalls below N."

If pressed on performance, add: "Centralised is fine to ~16 parties; I benchmarked, and beyond that I'd move to a dissemination barrier to kill the thundering-herd contention."
