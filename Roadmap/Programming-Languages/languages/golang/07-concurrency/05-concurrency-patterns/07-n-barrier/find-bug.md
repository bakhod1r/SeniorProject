# N-Barrier — Find the Bug

Each section presents a broken barrier, asks you to find the bug *before* reading the analysis, then explains the failure mode and the fix. Run the broken versions with `go run -race` and `GOMAXPROCS=8` to reproduce.

## Table of Contents
1. [Bug 1: WaitGroup Used as a Barrier](#bug-1-waitgroup-used-as-a-barrier)
2. [Bug 2: Bare `if` Around `cond.Wait()`](#bug-2-bare-if-around-condwait)
3. [Bug 3: `Signal` Instead of `Broadcast`](#bug-3-signal-instead-of-broadcast)
4. [Bug 4: Reset Count Without a Generation](#bug-4-reset-count-without-a-generation)
5. [Bug 5: Early Return Skips the Barrier](#bug-5-early-return-skips-the-barrier)
6. [Bug 6: N Mismatch](#bug-6-n-mismatch)
7. [Bug 7: Channel Barrier Captures the Wrong Gate](#bug-7-channel-barrier-captures-the-wrong-gate)
8. [Bug 8: Single Barrier on a Buffer Swap](#bug-8-single-barrier-on-a-buffer-swap)
9. [Bug 9: `cond.Wait()` Without Holding the Lock](#bug-9-condwait-without-holding-the-lock)
10. [Bug 10: No Cancellation — Deadlock on Error](#bug-10-no-cancellation--deadlock-on-error)
11. [Bug 11: Phase Action Re-Enters the Barrier](#bug-11-phase-action-re-enters-the-barrier)
12. [Bug 12: Reading Shared State Without the Barrier's Edge](#bug-12-reading-shared-state-without-the-barriers-edge)

---

## Bug 1: WaitGroup Used as a Barrier

### Broken code
```go
func runPhases(n int) {
    for phase := 0; phase < 3; phase++ {
        var wg sync.WaitGroup
        for i := 0; i < n; i++ {
            wg.Add(1)
            go func(id int) {
                defer wg.Done()
                compute(id, phase)   // phase 1 work
                refine(id, phase)    // BUG: assumes all compute() finished
            }(i)
        }
        wg.Wait()
    }
}
```
**What goes wrong?** Pause and think.

### Failure mode
`refine` for worker 0 may run while worker 2 is still inside `compute`. The `WaitGroup` only tells *the loop* when all workers finish *both* steps; it does not synchronise the workers *between* `compute` and `refine`. If `refine` reads data that other workers' `compute` writes, it reads a half-written phase.

### Fix
Put a real barrier between the two steps:
```go
b := NewCyclic(n)
go func(id int) {
    defer wg.Done()
    compute(id, phase)
    b.Wait()        // all compute() done before any refine()
    refine(id, phase)
}(i)
```
A WaitGroup synchronises "all done"; only a barrier synchronises "all reached *here*."

---

## Bug 2: Bare `if` Around `cond.Wait()`

### Broken code
```go
func (b *Barrier) Wait() {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.count++
    if b.count == b.n {
        b.cond.Broadcast()
        return
    }
    if b.count < b.n { // BUG: if, not for
        b.cond.Wait()
    }
}
```
**What goes wrong?**

### Failure mode
`cond.Wait()` can return spuriously, or be woken by an unrelated broadcast. With a bare `if`, a waiter that wakes early does not re-check `count < n` — it falls through and "proceeds" while parties are still missing. The barrier releases too early, non-deterministically.

### Fix
```go
for b.count < b.n {
    b.cond.Wait()
}
```
Always re-check the predicate in a loop. This is the single most repeated `sync.Cond` rule.

---

## Bug 3: `Signal` Instead of `Broadcast`

### Broken code
```go
func (b *Barrier) Wait() {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.count++
    if b.count == b.n {
        b.cond.Signal() // BUG
        return
    }
    for b.count < b.n {
        b.cond.Wait()
    }
}
```
**What goes wrong?**

### Failure mode
`Signal()` wakes exactly *one* waiter. The other N-2 sleeping parties stay parked forever. With N=4, the Nth party returns, one waiter wakes, and two are stuck — a deadlock that looks like "most workers finished."

### Fix
Use `Broadcast()` — a barrier must wake *all* waiters:
```go
b.cond.Broadcast()
```
`Signal` is for "wake one worker to handle one item"; barriers are never that.

---

## Bug 4: Reset Count Without a Generation

### Broken code
```go
func (b *Barrier) Wait() {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.count++
    if b.count == b.n {
        b.cond.Broadcast()
        b.count = 0 // BUG: reset with no generation guard
        return
    }
    for b.count < b.n {
        b.cond.Wait()
    }
}
```
**What goes wrong?**

### Failure mode
The "fast goroutine races into the next phase" bug. A just-released fast party loops back into `Wait()`, does `count++` (now 1) *before* a slow party still inside `cond.Wait()` wakes and re-checks `count < n`. The slow party now sees `count == 1 < n`, keeps sleeping, and the new phase's count is corrupted. Across many phases this deadlocks or releases the wrong set of parties. Hard to reproduce, worse under high `GOMAXPROCS`.

### Fix
Use a generation counter; wait on the generation changing, not the count:
```go
gen := b.generation
b.count++
if b.count == b.n {
    b.generation++
    b.count = 0
    b.cond.Broadcast()
    return
}
for gen == b.generation {
    b.cond.Wait()
}
```

---

## Bug 5: Early Return Skips the Barrier

### Broken code
```go
func worker(id int, b *Barrier, data []Item) error {
    for _, it := range data {
        if !valid(it) {
            return errInvalid // BUG: returns before b.Wait()
        }
        process(it)
    }
    b.Wait()
    finalize(id)
    return nil
}
```
**What goes wrong?**

### Failure mode
If worker 3 hits an invalid item and returns, it never calls `b.Wait()`. The other N-1 workers reach the barrier and block forever waiting for the party that left. The whole cohort deadlocks. In tests with always-valid data it passes; the first bad record in production freezes the pipeline.

### Fix
Either ensure every path reaches the barrier, or use an abortable barrier:
```go
func worker(ctx context.Context, id int, b *Safe, data []Item) error {
    for _, it := range data {
        if !valid(it) {
            b.Abort()       // release peers instead of stranding them
            return errInvalid
        }
        process(it)
    }
    if err := b.Wait(ctx); err != nil {
        return err
    }
    finalize(id)
    return nil
}
```

---

## Bug 6: N Mismatch

### Broken code
```go
func main() {
    const workers = 4
    b := NewBarrier(workers + 1) // BUG: barrier expects 5, only 4 arrive
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func(id int) { defer wg.Done(); b.Wait() }(i)
    }
    wg.Wait()
}
```
**What goes wrong?**

### Failure mode
The barrier waits for 5 arrivals; only 4 goroutines exist. The 4th arrival sees `count == 4 < 5` and sleeps. No 5th party ever comes. `wg.Wait()` never returns — deadlock. (The runtime may report "all goroutines are asleep - deadlock!")

### Fix
Derive N from the actual party count, in one place:
```go
const workers = 4
b := NewBarrier(workers)
```
Better: pass `workers` to both the loop and the barrier from a single variable so they cannot drift.

---

## Bug 7: Channel Barrier Captures the Wrong Gate

### Broken code
```go
func (b *ChanBarrier) Wait() {
    b.mu.Lock()
    b.count++
    if b.count == b.n {
        close(b.gate)
        b.gate = make(chan struct{})
        b.count = 0
        b.mu.Unlock()
        return
    }
    b.mu.Unlock()
    <-b.gate // BUG: reads b.gate AFTER unlocking, may be the NEW gate
}
```
**What goes wrong?**

### Failure mode
After unlocking, a waiter reads `b.gate` fresh. If the Nth party has already closed the old gate and installed a new one in the meantime, this waiter blocks on the *new* (still-open) gate and misses its release — it waits a full extra generation, or forever if the cohort shrinks. A torn read between "which generation am I in" and "which gate do I wait on."

### Fix
Capture the gate *while holding the lock*, then block on the captured value:
```go
gate := b.gate
b.mu.Unlock()
<-gate
```

---

## Bug 8: Single Barrier on a Buffer Swap

### Broken code
```go
for t := 0; t < ticks; t++ {
    computeBand(id, cur, next) // reads cur, writes next
    b.Wait()
    if id == 0 {
        cur, next = next, cur  // swap
    }
    // BUG: no second barrier; next tick's computeBand starts immediately
}
```
**What goes wrong?**

### Failure mode
After the single barrier, worker 1 may start the next tick's `computeBand` (reading `cur`) *before* worker 0 has finished the swap. Workers read inconsistent buffers — a data race and wrong simulation output. `go test -race` flags concurrent read/write of the shared buffers.

### Fix
A second barrier after the swap:
```go
b.Wait()
if id == 0 { cur, next = next, cur }
b.Wait() // swap is visible before any next-tick read
```

---

## Bug 9: `cond.Wait()` Without Holding the Lock

### Broken code
```go
func (b *Barrier) Wait() {
    b.mu.Lock()
    b.count++
    last := b.count == b.n
    b.mu.Unlock()        // BUG: unlock before Wait
    if last {
        b.cond.Broadcast()
        return
    }
    b.cond.Wait()        // panic: must hold the lock
}
```
**What goes wrong?**

### Failure mode
`sync.Cond.Wait()` requires the caller to hold the cond's lock; it panics with "sync: unlock of unlocked mutex" / unspecified behaviour otherwise. Even if it didn't panic, there is a lost-wakeup race: between `Unlock()` and `Wait()`, the Nth party could broadcast, and this waiter would then sleep forever having missed it.

### Fix
Hold the lock across the whole critical section, including `Wait()`:
```go
b.mu.Lock()
defer b.mu.Unlock()
b.count++
if b.count == b.n {
    b.cond.Broadcast()
    return
}
for b.count < b.n {
    b.cond.Wait() // releases & re-acquires the lock atomically
}
```

---

## Bug 10: No Cancellation — Deadlock on Error

### Broken code
```go
func phase(ctx context.Context, b *Barrier, fn func() error) error {
    if err := fn(); err != nil {
        return err // BUG: peers still waiting at b.Wait()
    }
    b.Wait()
    return nil
}
```
**What goes wrong?**

### Failure mode
A party whose `fn()` errors returns without arriving. Peers block at `b.Wait()` forever. There is also no way for an external `ctx` cancellation to release parked parties — a cancelled job leaves goroutines (and whatever they hold) stranded.

### Fix
Use an abortable, context-aware barrier:
```go
func phase(ctx context.Context, b *Safe, fn func() error) error {
    if err := fn(); err != nil {
        b.Abort()
        return err
    }
    return b.Wait(ctx) // returns ErrBroken on abort or ctx cancel
}
```

---

## Bug 11: Phase Action Re-Enters the Barrier

### Broken code
```go
b := NewActionBarrier(n, func() {
    log.Println("phase complete")
    b.Wait() // BUG: re-enters Wait() while the last party holds the lock
})
```
**What goes wrong?**

### Failure mode
The phase action runs inside the last party's `Wait()` *while holding the mutex*. Calling `b.Wait()` again tries to re-lock the same (non-reentrant) `sync.Mutex` — instant self-deadlock. Any blocking call in the action (a channel send, a network call, a lock) similarly stalls every party, since none can be released until the action returns.

### Fix
Keep the phase action short, non-blocking, and never re-entrant:
```go
b := NewActionBarrier(n, func() {
    world.Swap() // fast, non-blocking, no Wait()/lock
})
```
Do work that must block *outside* the barrier (after `Wait()` returns), gated to one party.

---

## Bug 12: Reading Shared State Without the Barrier's Edge

### Broken code
```go
var ready bool // plain bool, no synchronisation

// last party
func setup(b *Barrier) {
    ready = true // BUG: written outside the lock that establishes the edge
    b.Wait()
}

// other parties
func use(b *Barrier) {
    b.Wait()
    if ready { /* ... */ } // may not observe the write on ARM
}
```
**What goes wrong?**

### Failure mode
The write to `ready` happens *before* `b.Wait()`, but `ready` is a plain variable touched outside any shared lock. While the barrier provides a happens-before edge *for memory ordered through its own mutex*, a naive reading might assume *all* prior writes are visible. They are — the barrier's unlock/lock chain does order the write before the post-barrier read — *but only if the write truly happens-before the arriving party's `Wait()` call and the data is not concurrently mutated*. The real bug here is `ready` being written by one party while another party might still be mutating related state, with no agreement on who owns it. On weak memory models this surfaces as a torn/stale read; under `-race` it is reported as a data race if any concurrent write exists.

### Fix
Make ownership explicit: write the shared state under the same lock the barrier uses (e.g., in a phase action) or before the writer's `Wait()` with no concurrent writers, and read it only after `Wait()` returns:
```go
b := NewActionBarrier(n, func() { ready = true }) // single writer, under the lock
// ...
b.Wait()
if ready { /* guaranteed visible */ }
```
The lesson: a barrier orders memory through *its* lock; structure the writes so the only writer is the last party (phase action) or each party writes only its own private slot before arriving.
