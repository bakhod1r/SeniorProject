# N-Barrier — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "I have N goroutines. None of them may go past *this line* until *all* of them have reached it. How do I make a meeting point?"

Imagine four runners doing a relay practice. The coach says: "Run to the line, then *wait*. When all four of you are at the line, I'll blow the whistle and you all start the next lap together." That waiting-at-the-line, all-released-on-one-whistle behaviour is a **barrier**.

In Go you already know one synchronisation tool that *sounds* similar: `sync.WaitGroup`. But a WaitGroup is subtly different, and the difference is the whole point of this topic:

- With a **WaitGroup**, *one* goroutine (often `main`) calls `Wait()` and blocks until N *other* goroutines call `Done()`. The workers themselves do not wait for each other — they finish and move on. It is one-shot: once the counter hits zero, the WaitGroup has done its job.
- With a **barrier**, *every* participant calls `Wait()`. Each one arrives and blocks. The last arrival releases all of them at once. And a *reusable* barrier resets afterward so you can do it again next phase.

So the slogan is: **a WaitGroup is "I wait for you all to finish"; a barrier is "we all wait for each other, then go together."**

After this file you should be able to:

- Explain why a `sync.WaitGroup` is not a barrier.
- Recognise a phased problem ("everyone must finish step *k* before anyone starts step *k+1*").
- Build a minimal one-shot barrier with `sync.Mutex` + `sync.Cond`.
- Use a barrier in a tiny two-phase program.

You do *not* yet need the generation counter (the reusable/cyclic barrier), channel-based variants, or errgroup comparisons. Those are middle and senior.

---

## Prerequisites

- **Required:** Go 1.18+ (1.21+ recommended).
- **Required:** Start a goroutine with `go f()` and wait with `sync.WaitGroup`.
- **Required:** Lock and unlock a `sync.Mutex`.
- **Helpful:** Basic familiarity with `sync.Cond` — `Wait`, `Signal`, `Broadcast`. We re-explain it here.
- **Helpful:** Know what a closed channel does (`close(c)` wakes all receivers). The channel-based barrier in middle.md leans on it.

If you can write a program that spawns three goroutines and waits for them with a `WaitGroup`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Barrier** | A synchronisation point that N goroutines must all reach before *any* of them may proceed. |
| **Participant / party** | One of the N goroutines that arrives at the barrier. |
| **N (parties)** | The number of participants the barrier waits for before releasing. Fixed when the barrier is created. |
| **Arrive** | The act of a participant calling `Wait()` on the barrier and blocking. |
| **Trip / release** | The moment the Nth participant arrives, waking all parties at once. |
| **Phase** | One round of work between two barrier trips. Phase *k* ends and phase *k+1* begins at the barrier. |
| **One-shot barrier** | A barrier usable for exactly one trip (this file). |
| **Cyclic / reusable barrier** | A barrier that resets after each trip and can be used again (middle.md). |
| **`sync.Cond`** | A condition variable wrapping a mutex; `Wait` sleeps, `Broadcast` wakes all sleepers. The engine of most barriers. |
| **`sync.WaitGroup`** | A counter where one party waits for N others to signal `Done`. *Not* a barrier (one-shot, asymmetric). |

---

## Core Concepts

### Why a WaitGroup is not a barrier

A WaitGroup has an asymmetry: the goroutines that call `Add`/`Done` are *not* the goroutine that calls `Wait`. The workers never block on each other.

```go
var wg sync.WaitGroup
for i := 0; i < 3; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        work(id) // each worker runs and finishes; it does NOT wait for the others
    }(i)
}
wg.Wait() // only main waits
```

Here worker 0 may be completely done before worker 2 even starts. That is *fine* for "do N independent things, then continue." It is *wrong* for "all of you compute step 1, then all of you compute step 2," because nothing stops worker 0 from racing into step 2 while worker 2 is still on step 1.

A barrier fixes exactly that: every worker calls `Wait()` at the end of step 1, and they all proceed to step 2 together.

### The shape of a barrier

A barrier needs three things:

1. A **count** of how many parties have arrived so far.
2. A way for an arriving party to **block** until the count reaches N.
3. A way for the Nth party to **wake everyone** at once.

`sync.Cond` gives us 2 and 3 directly. A plain integer guarded by the Cond's mutex gives us 1.

```go
mu.Lock()
count++
if count == n {
    cond.Broadcast() // the last party wakes everyone
} else {
    for count < n {
        cond.Wait()  // earlier parties sleep
    }
}
mu.Unlock()
```

That is the entire idea of a one-shot barrier. Read it twice: the first N-1 arrivals fall into `cond.Wait()`; the Nth arrival calls `Broadcast()` and wakes them all.

### Why `cond.Wait()` must be in a `for` loop

`cond.Wait()` can return *spuriously* (woken without the predicate being true), and even when it returns correctly, by the time the goroutine re-acquires the lock the world may have changed. So you always re-check the predicate in a loop:

```go
for count < n {
    cond.Wait()
}
```

A bare `if count < n { cond.Wait() }` is a classic bug. Always use `for`.

### `sync.Cond` in one minute

```go
mu := &sync.Mutex{}
cond := sync.NewCond(mu)
```

- `cond.Wait()` — **must hold the lock**. It atomically unlocks, sleeps, and re-locks before returning. So you keep using shared state safely around it.
- `cond.Signal()` — wakes one waiter.
- `cond.Broadcast()` — wakes all waiters. A barrier uses `Broadcast`, because everyone must go.

---

## Real-World Analogies

- **Relay runners at a line.** Everyone runs to the line and waits; the whistle (the Nth arrival) sends them all off together.
- **A group hike with a "regroup" rule.** "Hike to the next marker, then wait for everyone before continuing." Nobody gets left behind, and nobody gets too far ahead.
- **A meeting that starts only when everyone is in the room.** The chair will not begin until the last attendee arrives.
- **A turnstile gate that opens when the Nth ticket is scanned.** Each person scans and waits; the gate opens for all once N have scanned.

The common thread: the *slowest* participant sets the pace, and everyone advances in lockstep.

---

## Mental Models

### "The turnstile that opens for everyone"

Each goroutine walks up to the turnstile and pushes (increments the count). The turnstile stays locked until the Nth push, then swings open and lets the whole crowd through at once.

### "WaitGroup = finish line; Barrier = checkpoint"

A finish line is where one observer counts everyone in and then the race is over. A checkpoint is where the racers themselves regroup before the next leg. WaitGroup is the finish line. Barrier is the checkpoint.

### "Phase walls"

Picture your program as rooms separated by walls. Each wall is a barrier. The wall does not open until every worker is pressed against it. When it opens, everyone moves into the next room together. No worker is ever two rooms ahead of another.

---

## Pros & Cons

### Pros
- **Lockstep correctness.** Guarantees no worker reads phase *k+1* data before all phase *k* writers finish.
- **Simple mental model.** "Everyone meets here."
- **Reusable** (the cyclic version) — one barrier object serves many phases.
- **Built from standard primitives** (`Mutex` + `Cond`); no external dependency.

### Cons
- **Bound to the slowest party.** The barrier is only as fast as the slowest arrival each phase. Stragglers stall everyone.
- **Deadlock if a party never arrives.** If one goroutine dies or takes a wrong branch and never calls `Wait()`, the others wait forever.
- **Wrong fit for one-shot work.** If you only need "wait for all to finish," a WaitGroup is simpler.
- **Fixed N.** A basic barrier assumes a known, fixed party count. Dynamic membership is harder.

---

## Use Cases

- **Iterative simulations.** Game-of-life, particle systems, numeric solvers: compute a tick, barrier, advance.
- **Parallel matrix steps.** All blocks compute, then a barrier, then the next pass.
- **MapReduce rounds.** Barrier between the map phase and the reduce phase.
- **Lockstep testing.** Hold N goroutines at a barrier so they all hit a critical section at once and expose a race.
- **Staged startup.** "All subsystems finish initialising, *then* all begin serving."

---

## Code Examples

### Example 1 — A minimal one-shot barrier

```go
package main

import (
    "fmt"
    "sync"
)

// Barrier waits for exactly n parties. One-shot: usable for a single trip.
type Barrier struct {
    mu    sync.Mutex
    cond  *sync.Cond
    n     int
    count int
}

func NewBarrier(n int) *Barrier {
    b := &Barrier{n: n}
    b.cond = sync.NewCond(&b.mu)
    return b
}

// Wait blocks until all n parties have called Wait.
func (b *Barrier) Wait() {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.count++
    if b.count == b.n {
        b.cond.Broadcast() // last party releases everyone
        return
    }
    for b.count < b.n {
        b.cond.Wait()
    }
}

func main() {
    const n = 4
    b := NewBarrier(n)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            fmt.Printf("worker %d: phase 1 done, waiting at barrier\n", id)
            b.Wait()
            fmt.Printf("worker %d: released, starting phase 2\n", id)
        }(i)
    }
    wg.Wait()
}
```

Every "phase 1 done" line prints *before* any "released" line. The barrier guarantees the lockstep. (The order *within* each group is non-deterministic — that is expected.)

### Example 2 — Two phases with the barrier

A barrier between two real computation steps. We sum a slice in phase 1, then use the shared total in phase 2.

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    const n = 3
    parts := [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}
    partial := make([]int, n)
    var total int

    b := NewBarrier(n)
    var wg sync.WaitGroup
    var mu sync.Mutex

    for i := 0; i < n; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()

            // Phase 1: compute a partial sum (each worker writes its own slot).
            s := 0
            for _, v := range parts[id] {
                s += v
            }
            partial[id] = s

            b.Wait() // <-- all partials are written before anyone reads total

            // Phase 2: exactly one worker folds the partials into total.
            if id == 0 {
                mu.Lock()
                for _, p := range partial {
                    total += p
                }
                mu.Unlock()
            }
        }(i)
    }
    wg.Wait()
    fmt.Println("total:", total) // 45
}
```

Without the barrier, worker 0 could read `partial` before workers 1 and 2 finished writing their slots, and the total would be wrong. The barrier makes "all writes happen-before the read" true.

### Example 3 — Why `if` instead of `for` is a bug

```go
// BROKEN — do not copy.
func (b *Barrier) Wait() {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.count++
    if b.count == b.n {
        b.cond.Broadcast()
        return
    }
    if b.count < b.n { // BUG: single if, not a loop
        b.cond.Wait()
    }
}
```

A spurious wakeup, or a wakeup from a later unrelated broadcast, lets a waiter slip past while `count < n`. Always re-check in a `for` loop. The fix is the `for b.count < b.n { b.cond.Wait() }` from Example 1.

---

## Coding Patterns

### Pattern: barrier as a struct, `Wait()` as the only public method

Keep the mutex, cond, and count private. Expose one method. Callers should never touch the internals.

```go
type Barrier struct {
    mu    sync.Mutex
    cond  *sync.Cond
    n     int
    count int
}
func (b *Barrier) Wait() { /* ... */ }
```

### Pattern: pair the barrier with a WaitGroup

The barrier coordinates *between phases*; the WaitGroup tells `main` when *all phases are done*. They are complementary, not competing.

```go
b := NewBarrier(n)
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    wg.Add(1)
    go worker(i, b, &wg)
}
wg.Wait() // outer: everything finished
```

### Pattern: one worker does the "merge", others just wait

After a barrier, often only one party needs to fold results (Example 2). Gate that work behind `if id == 0`. The other parties simply pass through.

---

## Clean Code

- Name the type `Barrier` and the method `Wait`. Match the mental model.
- Make N immutable after construction. A barrier whose N changes mid-flight is a different (harder) animal.
- Document loudly whether the barrier is one-shot or reusable. This file's barrier is **one-shot**: calling `Wait()` more than N times is undefined.
- Always `for`-loop around `cond.Wait()`. Add a comment if a junior reader might "simplify" it to an `if`.
- Keep phase boundaries obvious in the worker function: `// phase 1`, `b.Wait()`, `// phase 2`.

---

## Product Use / Feature

- **Batch image processing.** Phase 1: every worker decodes its shard of images. Barrier. Phase 2: every worker writes thumbnails, knowing all decoding finished.
- **Game tick.** Phase 1: compute every entity's next state. Barrier. Phase 2: swap to the new state and render. No entity sees a half-updated world.
- **ETL stage gate.** Phase 1: all extractors finish. Barrier. Phase 2: transformers run on a complete dataset.

Anywhere a feature says "do all of X, then all of Y," a barrier is the synchronisation behind it.

---

## Error Handling

The barrier itself never returns an error — `Wait()` either blocks or returns. But the *surrounding* code has real failure modes:

- **A party that errors before reaching the barrier** must still arrive, or the others deadlock. Use `defer b.Wait()` carefully, or count the failed party as "arrived" some other way (covered in middle.md with an `Abort` / context-aware barrier).
- **Panics.** If a worker panics before `b.Wait()`, the barrier never trips. At minimum, `recover` and arrive at the barrier, or cancel a shared context the others also watch.

A junior-safe rule: **every code path in a worker between two barriers must reach the next barrier exactly once.** If it can `return` early, you have a deadlock waiting to happen.

---

## Security Considerations

- **Denial of service via a stuck party.** If any participant can be made to hang before the barrier (e.g., it waits on untrusted input), an attacker can freeze the whole cohort. Put a timeout/context on work *before* the barrier, not on the barrier itself.
- **Resource pinning.** Workers blocked at a barrier hold whatever they acquired (memory, file handles). A stalled barrier multiplies that by N. Bound the work between barriers.
- Barriers carry no data, so there is no payload-injection surface — the security concerns are all about *liveness* (something hangs) rather than confidentiality.

---

## Performance Tips

- **The barrier costs one lock + one broadcast per trip.** That is cheap; the expensive thing is the *waiting*, which is dictated by your slowest worker. Balance the work per party.
- **Avoid tiny phases.** If each phase does 1 microsecond of work and then barriers, synchronisation overhead dominates. Make phases coarse.
- **Do not allocate inside `Wait()`.** This barrier does not; keep it that way.
- For very high party counts or very tight loops, a tree/dissemination barrier reduces contention (senior + optimize files). Not a junior concern.

---

## Best Practices

1. Use a barrier only for **multi-phase** lockstep work; otherwise use `WaitGroup`.
2. Always re-check the predicate in a `for` loop around `cond.Wait()`.
3. Fix N at construction; never mutate it during a trip.
4. Ensure every worker reaches the barrier on every path (no early `return` that skips it).
5. Be explicit about one-shot vs reusable. This barrier is one-shot.
6. Test with `-race` and with more goroutines than CPU cores.

---

## Edge Cases & Pitfalls

- **One party never arrives → deadlock.** The single most common barrier bug.
- **More than N parties call `Wait()` on a one-shot barrier.** The extra ones see `count > n`, the `for count < n` loop exits immediately, and they slip through *without waiting*. One-shot barriers assume exactly N callers.
- **Reusing a one-shot barrier for a second phase.** `count` is already at N; the next caller sees `count == n+1`, never blocks, and the lockstep is broken. You need the reusable version (middle.md).
- **`if` instead of `for`.** Spurious wakeups break correctness.
- **Calling `Wait()` without enough goroutines.** If only N-1 parties exist, they wait forever.

---

## Common Mistakes

- Treating `sync.WaitGroup` as a barrier — workers do not wait for each other.
- Reusing the one-shot barrier across phases (needs a generation counter).
- `if b.count < b.n { b.cond.Wait() }` instead of a `for` loop.
- Forgetting that an early `return` in a worker skips the barrier and deadlocks the rest.
- Sharing the same `partial` slot between workers (write your *own* index only, then barrier, then read).

---

## Common Misconceptions

- **"`WaitGroup.Wait()` makes the workers wait for each other."** No. Only the caller of `Wait()` blocks; the workers run independently.
- **"A barrier delivers a value."** No. It is pure synchronisation; no data crosses it.
- **"`cond.Signal()` is fine for a barrier."** No — `Signal` wakes one waiter. A barrier must wake *all* of them, so use `Broadcast`.
- **"I can resize the barrier mid-run."** Not with this simple version. Fixed N.

---

## Tricky Points

- The **last** arriving party calls `Broadcast()` and does *not* call `Wait()` — it returns immediately. Tracing this is key to understanding the code.
- `cond.Wait()` releases the lock while sleeping, so the Nth party *can* acquire the lock to increment the count even while the first N-1 sleep.
- A one-shot barrier and a reusable barrier look almost identical — the difference is the generation counter that lets the count safely reset. Watch for it in middle.md.
- The barrier provides a **happens-before** edge: everything a party did before `Wait()` is visible to every party after `Wait()` returns. This is what makes Example 2's `total` correct.

---

## Test

```go
package main

import (
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

func TestBarrierReleasesTogether(t *testing.T) {
    const n = 5
    b := NewBarrier(n)
    var reachedPhase2 int32
    var stillInPhase1 int32 = n

    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt32(&stillInPhase1, -1)
            b.Wait()
            // No one should reach here until stillInPhase1 == 0.
            if atomic.LoadInt32(&stillInPhase1) != 0 {
                t.Errorf("released before all arrived")
            }
            atomic.AddInt32(&reachedPhase2, 1)
        }()
    }

    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(2 * time.Second):
        t.Fatal("barrier deadlocked")
    }
    if reachedPhase2 != n {
        t.Fatalf("expected %d, got %d", n, reachedPhase2)
    }
}
```

Run with `go test -race`.

---

## Tricky Questions

**Q1.** What is the difference between `sync.WaitGroup` and a barrier?
> A WaitGroup lets one goroutine wait for N others to finish — asymmetric and one-shot. A barrier makes all N goroutines wait for *each other* and release together — symmetric, and (in the reusable form) repeatable.

**Q2.** Why `Broadcast` and not `Signal` in a barrier?
> Because all N-1 sleeping parties must wake. `Signal` wakes only one, leaving the rest blocked forever.

**Q3.** Why must `cond.Wait()` be in a `for` loop?
> Spurious wakeups and unrelated broadcasts can wake a waiter while the predicate is still false. The loop re-checks `count < n` and goes back to sleep if needed.

**Q4.** What happens if only N-1 of N parties ever call `Wait()`?
> The barrier never trips; all waiters block forever — a deadlock.

**Q5.** Can I reuse this one-shot barrier for a second phase?
> No. `count` stays at N, so the next caller never blocks. You need a generation counter (middle.md) to reset safely.

**Q6.** Does a barrier transfer data between goroutines?
> No data, but it transfers *visibility*: a happens-before edge so writes before `Wait()` are visible after it returns.

---

## Cheat Sheet

```go
// One-shot N-barrier
type Barrier struct {
    mu    sync.Mutex
    cond  *sync.Cond
    n     int
    count int
}
func NewBarrier(n int) *Barrier {
    b := &Barrier{n: n}
    b.cond = sync.NewCond(&b.mu)
    return b
}
func (b *Barrier) Wait() {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.count++
    if b.count == b.n {
        b.cond.Broadcast()
        return
    }
    for b.count < b.n {
        b.cond.Wait()
    }
}
```

| Need | Tool |
|------|------|
| Wait for N goroutines to *finish* | `sync.WaitGroup` |
| Make N goroutines meet, then go together (once) | one-shot barrier (this file) |
| Same, but repeated each phase | reusable barrier (middle.md) |
| Wake all sleepers | `cond.Broadcast()` |

---

## Self-Assessment Checklist

- [ ] I can explain why a WaitGroup is not a barrier.
- [ ] I can identify a phased problem that needs a barrier.
- [ ] I can build a one-shot barrier with `Mutex` + `Cond`.
- [ ] I know why `cond.Wait()` lives in a `for` loop.
- [ ] I know why the last party broadcasts and does not wait.
- [ ] I can explain the deadlock when a party never arrives.
- [ ] I understand the happens-before edge a barrier provides.

---

## Summary

A barrier is a meeting point: N goroutines arrive, block, and the Nth arrival releases them all at once. It differs from `sync.WaitGroup` because *every* party waits (symmetry) and — in the reusable form — the barrier repeats per phase. The minimal implementation is a count guarded by a `sync.Mutex`, with `sync.Cond.Wait()` to sleep and `Broadcast()` to release. Two rules keep you safe: re-check the predicate in a `for` loop, and make sure every party reaches the barrier on every path or the cohort deadlocks. This file's barrier is one-shot; the generation counter that makes it reusable is the next step.

---

## What You Can Build

- A two-phase parallel sum (compute partials, barrier, fold).
- A single tick of a parallel game-of-life (compute, barrier, swap).
- A lockstep test harness that holds N goroutines at the line to expose a race.
- A staged-startup helper: all subsystems init, barrier, all begin serving.

---

## Further Reading

- `sync` package documentation — `Cond`, `WaitGroup`, `Mutex`.
- The Go Memory Model (`go.dev/ref/mem`) — happens-before via `Cond` and `Mutex`.
- "The Little Book of Semaphores" — the barrier chapter (language-agnostic, excellent intuition).
- Wikipedia: "Barrier (computer science)" — the BSP context.

---

## Related Topics

- **`sync.WaitGroup`** — the one-shot, asymmetric cousin.
- **`sync.Cond`** — the condition variable that powers the barrier.
- **Broadcast pattern** — releasing all waiters at once *is* a broadcast.
- **Pipeline** — sequential stages; a barrier separates parallel phases instead.
- **errgroup** — single-phase parallel work with error collection (senior comparison).

---

## Diagrams & Visual Aids

### Arrive and release

```
   worker A --arrive--> [   ]
   worker B --arrive--> [ barrier (n=4) ]   count = 3 < 4 -> A,B,C sleep
   worker C --arrive--> [   ]
   worker D --arrive--> [ * ]               count = 4 -> Broadcast()
                                            |
              +-----------+-----------+-----+-----------+
              v           v           v                 v
           A go!       B go!       C go!             D go! (never slept)
```

### WaitGroup vs barrier

```
WaitGroup:                          Barrier:
  worker0 ---done---> .               worker0 --arrive--> |
  worker1 ------done-> .  main.Wait     worker1 --arrive--> | release together
  worker2 --done-----> .  unblocks      worker2 --arrive--> |
  (workers never wait for each other) (every worker waits for the others)
```
