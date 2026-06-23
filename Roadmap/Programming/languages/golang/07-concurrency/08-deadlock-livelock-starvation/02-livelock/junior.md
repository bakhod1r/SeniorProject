# Livelock — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is livelock? How is it different from deadlock? Why does my program burn CPU but do no work?"

A **livelock** is a concurrency bug where two or more goroutines are *not* blocked but still fail to make progress. They run, they take instructions, they consume CPU, they keep trying — and yet the system as a whole accomplishes nothing useful.

Compare with deadlock, which is the more famous cousin. A deadlocked goroutine is *waiting* on something that will never come. A livelocked goroutine is *running* and reacting to other goroutines that are also running and reacting — in a way that always cancels their progress.

The classic verbal definition:

> Deadlock: all goroutines are asleep, nothing happens.
>
> Livelock: all goroutines are awake, busy, and still nothing happens.

The pop-culture analogy is the **polite-people analogy**: two people walking toward each other in a narrow corridor, both step left to let the other pass, then both step right, then both step left again, repeating until one or both give up. They are moving. They are trying. But neither makes progress.

A livelocked Go program looks like this from the outside:

- CPU usage: high. Often 100% on one or more cores.
- Memory usage: stable.
- Logs: silent, or producing repeated "retry" / "conflict" / "try again" messages.
- `runtime.NumGoroutine`: stable, not growing.
- Throughput: zero, or oscillating around zero.
- `pprof` CPU profile: shows a tight loop or repeated CAS operations.

After this file you will:

- Define livelock precisely.
- Tell the difference between livelock, deadlock, and starvation.
- Recognise three classic Go shapes that cause livelock: retry-on-conflict, CAS-loop contention, and back-off-and-retry mutexes that re-collide.
- Detect livelock from CPU graphs and `pprof` output.
- Cure simple livelocks with random jitter and basic exponential back-off.

You do not need to know advanced randomised algorithms, distributed consensus, or formal proofs of liveness. Those come at the middle, senior, and professional levels. This file is about recognising the shape of the bug and not writing it in the first place.

---

## Prerequisites

- **Required:** Comfort with `go` keyword, goroutines, and `sync.WaitGroup`. Read `01-goroutines/01-overview/junior.md` first if these are new.
- **Required:** Familiarity with `sync.Mutex` and `sync.Mutex.TryLock` (Go 1.18+).
- **Required:** Basic understanding of `sync/atomic`, especially `CompareAndSwap`.
- **Helpful:** Some exposure to deadlock — at least the dining philosophers problem. Read `01-deadlock/junior.md` before this file.
- **Helpful:** Awareness of `time.Sleep` and `math/rand`. Those two together are most of the cure.

If you can build a small program that spawns 10 goroutines, locks a `sync.Mutex`, and prints something, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Livelock** | A state in which two or more goroutines are running and reacting to one another, yet the system makes no useful forward progress. |
| **Deadlock** | A state in which two or more goroutines are blocked forever, each waiting for a resource the other holds. No goroutine runs. |
| **Starvation** | A state in which some goroutines make progress but a specific goroutine is repeatedly denied resources and never advances. |
| **CAS (Compare-And-Swap)** | An atomic operation that updates a memory location only if its current value matches an expected value. Used in `sync/atomic`. |
| **CAS loop** | A pattern where a goroutine reads a value, computes a new one, and retries via CAS until it succeeds. Susceptible to livelock under heavy contention. |
| **Back-off** | A strategy where, after a failed attempt, a goroutine waits before retrying. *Linear* back-off waits a constant time; *exponential* back-off doubles the wait each time. |
| **Jitter** | Random noise added to a back-off interval so that goroutines that conflicted at time `t` do not all retry at time `t + back-off` together. |
| **Polite-people analogy** | Two people in a hallway who keep stepping out of each other's way and re-colliding. The canonical livelock metaphor. |
| **`TryLock`** | A non-blocking mutex acquisition. Returns `true` if the lock was acquired, `false` if not. Available on `sync.Mutex` since Go 1.18. |
| **Retry-on-conflict** | A pattern where a goroutine notices a conflict (failed CAS, busy lock, validation error) and immediately retries. The seed of most livelocks. |
| **Spin** | To loop, checking a condition repeatedly without yielding the CPU. Spinning that never resolves is a livelock symptom. |
| **Progress** | Useful work completed. Defined by the application, not the runtime. A CAS that succeeds may or may not be "progress" depending on what the program was trying to do. |
| **Liveness** | The property that *something good eventually happens*. The opposite of liveness failure is being permanently stuck. Deadlock and livelock are both liveness failures. |
| **Safety** | The property that *nothing bad ever happens*. Data races break safety; livelock does not. Livelock is purely a liveness problem. |

---

## Core Concepts

### Concept 1: Livelock is "stuck while running"

A deadlocked goroutine looks dead in `pprof`: it is parked on a channel or a mutex, consuming no CPU. A livelocked goroutine looks alive: it is running. It might even be hot in your CPU profile. The trick is to notice that it is running *but not progressing*.

The simplest mental test: "If I let this run for ten minutes, what useful thing will be in the database / on disk / in the response?" If the answer is "nothing," and yet CPU is hot, you have livelock.

### Concept 2: Livelock requires reaction

Deadlock requires waiting. Livelock requires reaction. Goroutine A does something. Goroutine B notices and does something in response. Goroutine A reacts to B's reaction. The cycle continues. Neither A nor B is wrong individually; the bug is the *pattern of mutual reaction*.

```
A: I'll go left.
B: A is going left, I'll go right.
A: Wait, B is going right, I'll go right too.
B: A went right, I'll go left.
A: B went left, I'll go left.
... forever ...
```

The fix is to break the symmetry, usually with randomness or priority.

### Concept 3: Retry loops are the most common Go shape

The Go ecosystem leans heavily on patterns like:

```go
for {
    if err := tryOnce(); err == nil {
        return
    }
}
```

If `tryOnce` fails because *another goroutine just did the same thing*, you have a recipe for livelock. The retry loop is correct only if the failure is *random* or *self-resolving*. If the failure is *caused by another retrier*, the loop will retry forever.

### Concept 4: CAS loops are a special case

A CAS loop in Go looks like:

```go
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, old+1) {
        return
    }
}
```

With two goroutines, this is fine: one wins each round, throughput is high. With one thousand goroutines all racing on the same counter, throughput collapses. Most goroutines fail CAS repeatedly. The aggregate work is high, the useful work is low. This is the canonical "CAS-loop livelock" — sometimes called *thundering herd on an atomic*.

### Concept 5: Mutex back-off-and-retry can livelock

A polite mutex acquisition with `TryLock`:

```go
for {
    if mu.TryLock() {
        defer mu.Unlock()
        doWork()
        return
    }
    time.Sleep(time.Millisecond)
}
```

Two goroutines doing this with the *same* sleep interval can re-collide every millisecond forever. Cure: add jitter — `time.Sleep(time.Duration(rand.Intn(1000)) * time.Microsecond)`.

### Concept 6: Livelock can be fixed by *less* coordination

Counter-intuitively, livelock often appears in code that is *trying too hard*. Two goroutines both backing off is more polite than one yielding. The asymmetric solution — one goroutine wins, the other waits — is usually safer than a fully symmetric "both back off" strategy.

This is why production systems use:

- **Priority**: one party is the leader, the other defers.
- **Randomness**: tiebreakers come from a coin flip, not from politeness.
- **Hashing**: deterministic priority based on a stable property (request ID, hash of input).

---

## Real-World Analogies

### The polite-people analogy

Two people approach each other in a narrow corridor. Both notice they will collide. Both politely step to one side. Both happen to step to the *same* side, so they are still on a collision course. Both notice, both step to the *other* side. Both step back to the original side. Both apologise. Neither passes.

This is the textbook livelock. It is famous because everyone has lived it. The cure in real life is the same as in concurrency: one person commits to a side and the other waits, or both wait a random amount of time before stepping again.

Map to Go:

| Real life | Go code |
|---|---|
| Person | Goroutine |
| Corridor | Shared resource (mutex, atomic) |
| Step left / step right | CAS attempt / lock attempt |
| "Apologise and try again" | `continue` in the retry loop |
| One commits, the other waits | Priority, lock ordering, ticket |
| Random pause then step | Jitter in back-off |

### Two trucks at a one-lane bridge

Two trucks meet head-on at a one-lane bridge. Both back up to let the other cross. Both pull forward again. Both back up. Both stall. The bridge stays empty.

The cure is a signal at one end (priority) or a coin flip (randomness). The bridge is the shared resource. The trucks are goroutines.

### Three musicians starting a song

Three musicians want to start a song together. One says "ready when you are." The next says "no, you go." The third says "after you." None starts. The cure is a count-in — one musician takes priority and counts "one, two, three."

A Go variant: three goroutines waiting for "the others to be ready" before they start. With a poorly designed coordination protocol, none ever decides to go first.

### The doorway dance

Two people meet at a doorway. Both gesture "after you." Both step forward, both step back, both step forward, both step back. They are not idle — they are actively gesturing. They are not blocked — they could walk if they chose. But the social protocol traps them.

This is exactly what a back-off-and-retry mutex looks like when both parties back off the same way.

### Restaurant kitchen at a service window

Two waiters approach the same service window from opposite sides. Both reach for the same plate. Both pull back. Both reach again. Both pull back. The plate sits cold. The diners wait.

Cure: a queue. The waiters take a ticket. The window serves in order. No more reach-and-pull-back. This maps to Go's **ticket lock** pattern, where each goroutine takes a numbered ticket and waits for its number to be called — exactly the cure for CAS-loop livelock at scale.

---

## Mental Models

### Model 1: "Liveness vs safety"

Concurrency bugs split into two families:

- **Safety bugs**: something bad happens. Data race, dirty read, out-of-order write.
- **Liveness bugs**: something good fails to happen. Deadlock, livelock, starvation.

Livelock is purely liveness. The program does no wrong; it merely does no right. Tools that detect safety bugs (Go's race detector, static analysis) generally do not detect livelock.

### Model 2: "Symmetry is the enemy"

Most livelocks come from *symmetric* code: two goroutines run the exact same retry loop with the exact same parameters. If their first attempts collide, their second attempts will too. Symmetry preserves the conflict.

The cures all break symmetry:

- **Random jitter** breaks symmetry by chance.
- **Priority** breaks symmetry by rule.
- **Hashing** breaks symmetry by data.
- **Ordering** breaks symmetry by convention.

### Model 3: "Useful work counter"

When debugging suspected livelock, install a counter for *useful work* — not for "attempts" or "iterations," but for outcomes. Items processed. Requests served. Commits made.

```go
var commits atomic.Int64
go func() {
    for range time.Tick(time.Second) {
        log.Println("commits/s:", commits.Swap(0))
    }
}()
```

If CPU is high but the counter prints zero, you have livelock. This is the most reliable detection tool a junior engineer has.

### Model 4: "Back-off is medicine, not magic"

Back-off does not solve livelock. Back-off *with jitter* does. Plain exponential back-off keeps the symmetry: two goroutines that collide at attempt 1 will still collide at attempt 2 (both waited the same doubled time).

The mantra:

> Exponential back-off without jitter is a livelock.
> Exponential back-off with jitter is a fix.

### Model 5: "Liveness has no compiler check"

The Go compiler will not warn you about livelock. The race detector will not catch it. `go vet` does not look for it. The only defences are:

1. Knowing the patterns and avoiding them.
2. Load-testing with realistic concurrency.
3. Monitoring throughput in production.

This is why livelock is a thinking topic more than a tooling topic.

---

## Pros & Cons

### "Pros" of livelock

Livelock has no pros — it is a bug. But its *symptoms* can be useful diagnostics:

- High CPU + no progress is a smoking gun. It is more visible than deadlock, which can hide as "the service is just quiet."
- Livelock is reproducible under load. You can usually trigger it deterministically by scaling concurrency.
- Tools that detect livelock often detect other contention problems too.

### Cons (why livelock matters)

- **No panic, no error.** The runtime sees nothing wrong.
- **No deadlock detector.** Go's "all goroutines are asleep" panic does not fire.
- **Hard to log.** The retrying goroutine is doing what it was designed to do.
- **Easy to ship.** Unit tests with one or two goroutines do not reproduce it.
- **Catastrophic in production.** A livelocked service consumes resources without serving traffic. Auto-scaling makes it worse.

---

## Use Cases

This section is unusual: there is no *use case for livelock*. Instead, here is where it tends to *appear*.

| Scenario | Why livelock can show up |
|---|---|
| Optimistic concurrency control (database, in-memory) | Two writers compute on the same row, both retry on version conflict, both keep re-conflicting. |
| Atomic counters under heavy contention | One thousand goroutines incrementing the same `atomic.Int64`. CAS success rate plummets. |
| Distributed leader election | Two candidates both demote themselves on seeing the other; both promote themselves on seeing nothing. |
| Snapshot/iterator consistency loops | A snapshot retries until it observes a consistent state; the system mutates faster than the snapshot can observe. |
| Compare-and-set retry libraries | Misconfigured retries that always conflict with peers. |
| Network back-off without jitter | Many clients all see the same outage, all retry on the same schedule, all collide again. |
| Polite mutex patterns | `TryLock` + uniform sleep, with multiple goroutines doing the same thing. |

---

## Code Examples

### Example 1: The simplest livelock

Two goroutines both try to acquire two mutexes politely. If either fails, they release and retry.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    var a, b sync.Mutex

    work := func(name string, first, second *sync.Mutex) {
        for i := 0; i < 5; i++ {
            for {
                first.Lock()
                if !second.TryLock() {
                    first.Unlock()
                    time.Sleep(10 * time.Millisecond) // same sleep, no jitter
                    continue
                }
                fmt.Println(name, "doing work")
                second.Unlock()
                first.Unlock()
                break
            }
        }
    }

    var wg sync.WaitGroup
    wg.Add(2)
    go func() { defer wg.Done(); work("A", &a, &b) }()
    go func() { defer wg.Done(); work("B", &b, &a) }()
    wg.Wait()
}
```

Under heavy contention, both goroutines repeatedly acquire one mutex, fail the second, release, and retry on the same schedule. They look busy but might make very slow progress. The cure: random jitter on the sleep.

### Example 2: CAS-loop livelock

A million CAS attempts on a single atomic counter from many goroutines.

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var counter atomic.Int64
    const goroutines = 1000
    const perGoroutine = 100

    var wg sync.WaitGroup
    for i := 0; i < goroutines; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < perGoroutine; j++ {
                for {
                    old := counter.Load()
                    if counter.CompareAndSwap(old, old+1) {
                        break
                    }
                    // CAS failed; retry. Under heavy contention,
                    // most CAS calls fail, wasting CPU.
                }
            }
        }()
    }
    wg.Wait()
    fmt.Println("final:", counter.Load())
}
```

This is not a livelock that hangs forever — eventually it finishes — but it is a livelock in the *practical* sense: most of the work is wasted retries. If you scale `goroutines` to 100000 and watch with `pprof`, you will see most time spent in the failed CAS path.

The cure for *this* exact problem is `atomic.AddInt64` (which uses a single atomic increment, not a CAS loop). The general lesson: when a CAS loop's body is "increment by 1," prefer the dedicated atomic op.

### Example 3: Back-off without jitter

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func tryAcquire() bool {
    // pretend this represents a contended resource.
    return false
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            backoff := 1 * time.Millisecond
            for attempt := 0; attempt < 5; attempt++ {
                if tryAcquire() {
                    fmt.Println(id, "got it")
                    return
                }
                time.Sleep(backoff)
                backoff *= 2 // exponential — but NO jitter
            }
            fmt.Println(id, "gave up")
        }(i)
    }
    wg.Wait()
}
```

All three goroutines wait the same `backoff` after the same failure. They retry in lockstep. Under heavy contention this becomes a herd: every goroutine waits the same time, returns at the same instant, and re-collides.

### Example 4: Back-off with jitter (the fix)

```go
package main

import (
    "fmt"
    "math/rand"
    "sync"
    "time"
)

func tryAcquire() bool { return false }

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            backoff := 1 * time.Millisecond
            for attempt := 0; attempt < 5; attempt++ {
                if tryAcquire() {
                    fmt.Println(id, "got it")
                    return
                }
                jitter := time.Duration(rand.Int63n(int64(backoff)))
                time.Sleep(backoff + jitter)
                backoff *= 2
            }
            fmt.Println(id, "gave up")
        }(i)
    }
    wg.Wait()
}
```

Now each goroutine waits a different amount, breaking the symmetry. Even if all three collide on attempt 0, they will not all collide on attempt 1.

### Example 5: The polite-people dance in Go

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

type Person struct {
    name string
    side atomic.Int32 // 0 = left, 1 = right
}

func dance(me, you *Person, done chan struct{}) {
    for {
        select {
        case <-done:
            return
        default:
        }
        // if we're on the same side as the other, switch.
        if me.side.Load() == you.side.Load() {
            me.side.Store(1 - me.side.Load())
        }
        time.Sleep(10 * time.Millisecond)
    }
}

func main() {
    a := &Person{name: "A"}
    b := &Person{name: "B"}
    done := make(chan struct{})
    go dance(a, b, done)
    go dance(b, a, done)
    time.Sleep(500 * time.Millisecond)
    close(done)
    fmt.Println("a side:", a.side.Load(), "b side:", b.side.Load())
}
```

Both keep flipping. They are not blocked. They are not making progress. The cure: only one flips at a time (priority), or each waits a random delay before flipping (jitter).

### Example 6: Detection — a useful-work counter

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

var (
    attempts atomic.Int64
    success  atomic.Int64
)

func work() {
    for {
        attempts.Add(1)
        // pretend we sometimes succeed but mostly conflict.
        if attempts.Load()%1000000 == 0 {
            success.Add(1)
        }
    }
}

func main() {
    go work()
    go work()
    go work()

    for range time.Tick(time.Second) {
        a := attempts.Swap(0)
        s := success.Swap(0)
        fmt.Printf("attempts/s=%d  success/s=%d  ratio=%.4f\n",
            a, s, float64(s)/float64(a))
    }
}
```

When the *ratio* of success to attempts approaches zero, you are in livelock territory. The numerator is what matters; the denominator is wasted work.

### Example 7: Fixing the polite-mutex example with priority

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var a, b sync.Mutex

    // Both goroutines acquire in the same fixed order: a, then b.
    // No livelock possible because the dance has no symmetric flip.
    work := func(name string) {
        for i := 0; i < 5; i++ {
            a.Lock()
            b.Lock()
            fmt.Println(name, "doing work")
            b.Unlock()
            a.Unlock()
        }
    }

    var wg sync.WaitGroup
    wg.Add(2)
    go func() { defer wg.Done(); work("A") }()
    go func() { defer wg.Done(); work("B") }()
    wg.Wait()
}
```

Same fixed lock order prevents both deadlock and livelock. This is the safe pattern: if you have multiple locks, *agree on an order* and stick to it.

### Example 8: When two locks must be acquired without ordering

Sometimes you cannot impose a global order (think: transferring money between two account objects identified at runtime). The standard cure:

```go
func transfer(from, to *Account, amount int) {
    // Always lock by deterministic property — say, account ID.
    if from.ID < to.ID {
        from.mu.Lock()
        to.mu.Lock()
    } else {
        to.mu.Lock()
        from.mu.Lock()
    }
    defer from.mu.Unlock()
    defer to.mu.Unlock()
    from.Balance -= amount
    to.Balance += amount
}
```

The IDs supply the deterministic ordering. No livelock, no deadlock, no symmetry.

---

## Coding Patterns

### Pattern 1: Exponential back-off with jitter

```go
func backoff(attempt int) time.Duration {
    base := time.Duration(1<<attempt) * time.Millisecond
    jitter := time.Duration(rand.Int63n(int64(base)))
    return base + jitter
}

for attempt := 0; attempt < maxAttempts; attempt++ {
    if err := tryOnce(); err == nil {
        return nil
    }
    time.Sleep(backoff(attempt))
}
return errors.New("gave up")
```

Pattern: each retry waits exponentially longer, plus a random additive jitter. This is the standard cure for retry-storm livelock.

### Pattern 2: TryLock with jitter

```go
for {
    if mu.TryLock() {
        defer mu.Unlock()
        return doWork()
    }
    time.Sleep(time.Duration(rand.Int63n(int64(time.Millisecond))))
}
```

If two goroutines both fall into this pattern, jitter on the sleep prevents them from re-colliding in lockstep.

### Pattern 3: Bounded retry with cancellation

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()

for attempt := 0; ; attempt++ {
    if err := tryOnce(); err == nil {
        return nil
    }
    select {
    case <-time.After(backoff(attempt)):
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Always pair retry loops with a bound — either a max attempt count or a deadline. A livelock under load with no deadline is effectively a permanent outage.

### Pattern 4: Single-attempt CAS with fallback

If a CAS loop livelocks under contention, sometimes the fix is to retry only a few times and then take a different path:

```go
for i := 0; i < 3; i++ {
    if counter.CompareAndSwap(old, new) {
        return
    }
    old = counter.Load()
    new = compute(old)
}
// fall back to a mutex
mu.Lock()
defer mu.Unlock()
counter.Store(compute(counter.Load()))
```

Hybrid lock-free / locked code. Used in Go's runtime in a few places.

### Pattern 5: Priority via a deterministic property

```go
// of two parties, the one with the smaller ID gives way.
if me.ID < other.ID {
    yield()
} else {
    proceed()
}
```

Asymmetry breaks the livelock.

---

## Clean Code

- **Always bound retries.** A loop with no maximum is one-line away from an infinite livelock.
- **Always jitter sleeps.** If two goroutines wait the same time on the same condition, they will collide again. Add a random component.
- **Prefer dedicated atomics over CAS loops** when the dedicated op exists. `atomic.AddInt64` is not just shorter than the CAS loop; it has different runtime properties (single hardware instruction on most CPUs, no retry).
- **Measure throughput, not iterations.** Counters and gauges should track *outcomes*, not *attempts*. A livelock will show 100% CPU on the iteration counter and 0% on the outcome counter.
- **Log on retry, not on attempt.** Logging "attempting…" every iteration drowns the signal. Log "retry after N attempts" once, at the end of the loop, with the attempt count.
- **Avoid symmetric protocols.** When you write code where two goroutines do the same thing in the same way, ask: "what breaks ties?" If the answer is "nothing," you have a livelock candidate.

---

## Product Use / Feature

| Product feature | Where livelock can hide |
|---|---|
| Real-time bidding (RTB) | Two bidders retry with same back-off, never settle. Cure: jitter, ticket. |
| Wallet transfers | Optimistic concurrency on balance. Two transfers retry forever. Cure: pessimistic lock by account ID, or priority. |
| Cache fill on miss | Multiple workers fetch same key. Cure: `singleflight` (already designed for this). |
| Distributed cron | Two replicas both try to be the leader, both demote, both promote. Cure: priority by hostname or randomized lease TTL. |
| Inventory reservation | Two carts contend for last unit, both retry. Cure: serialise per item via a queue. |
| Rate limiter retry | Clients hit a 429, retry on a fixed schedule, hammer the server again. Cure: server returns `Retry-After`, client jitters. |

---

## Error Handling

Livelock is not an error type. There is no `LivelockError` in Go. But a livelock-prone retry loop should always defend itself with:

1. **An attempt limit.** Loop terminates after N tries with an explicit error.

```go
const maxAttempts = 10
for attempt := 0; attempt < maxAttempts; attempt++ {
    if err := tryOnce(); err == nil {
        return nil
    }
}
return fmt.Errorf("exhausted %d attempts", maxAttempts)
```

2. **A deadline.** The loop honors `context.Context`.

```go
for {
    if err := tryOnce(); err == nil {
        return nil
    }
    select {
    case <-time.After(backoff(attempt)):
        attempt++
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

3. **A success/failure metric.** If the success rate falls below a threshold, alert.

```go
if successRate.Load() < 0.01 {
    log.Println("warning: success rate below 1%, possible livelock")
}
```

The pattern is: livelock-prone code must surface its own struggle as an *error*, not silently keep trying.

---

## Security Considerations

Livelock has a security dimension under one name: **denial-of-service amplification**.

If your retry loop is triggered by a remote actor — for example, a client retrying a failed login — an attacker can intentionally cause conflicts to make your service livelock on itself. Defences:

- Rate-limit *retries*, not just initial requests.
- Always cap the number of in-flight retries per connection.
- Server-side: refuse new work when CPU exceeds a threshold (load-shedding).
- Use `Retry-After` headers to control client back-off. Do not trust clients to back off on their own.

A second security angle: **timing attacks via retry**. If a CAS loop's success rate depends on a secret (e.g., a key derivation step), an attacker who can measure your CPU profile via cloud-vendor metrics can sometimes infer the secret. Most Go programs are not vulnerable to this, but cryptographic primitives must avoid retry loops over secret-dependent state.

---

## Performance Tips

- **Identify the symmetry.** When you suspect livelock, ask: "What two pieces of code do the same thing at the same time?" The cure usually means breaking that symmetry.
- **Replace CAS loops with locks under high contention.** Counterintuitive but real: a `sync.Mutex` is sometimes faster than a CAS loop with 1000 goroutines because the mutex parks the loser, freeing CPU.
- **Use `sync.Map` or sharded maps for write-heavy workloads.** A single `map` behind a mutex serialises every write. A sharded structure spreads contention across multiple atoms.
- **Use `sync/singleflight` for cache fill.** It coalesces duplicate work and prevents the thundering-herd flavour of livelock.
- **Profile under realistic load.** A 10-goroutine test will not show CAS-loop livelock. A 10000-goroutine load test will.
- **Watch CPU profile flame graphs.** A livelock loop dominates the flame graph; the wide bar at the bottom is the retry path.

---

## Best Practices

- **Always jitter exponential back-off.** "Exponential back-off and jitter" is one phrase in distributed systems for a reason. Do not write one without the other.
- **Cap retries.** Five, ten, or twenty — but never infinity.
- **Track *success rate*.** If a metric of "succeeded / attempted" falls, alert.
- **Prefer ordered lock acquisition.** If you take two locks, agree on a global order and never deviate. This kills both deadlock and the back-off-and-retry style of livelock.
- **Use existing libraries.** `github.com/cenkalti/backoff` is mature, well-tested, and supports jitter and context cancellation. Do not reinvent.
- **Document the retry policy.** A function that retries should say so in its comment, including the maximum attempts and back-off strategy.
- **Test under contention.** Spawn enough goroutines to overload your design and look for throughput collapse.

---

## Edge Cases & Pitfalls

### Pitfall 1: `runtime.Gosched()` is not a fix

A common mistake is to insert `runtime.Gosched()` in the middle of a livelock loop and call it a cure. It is not. `Gosched` yields the CPU to another goroutine, which may immediately re-enter the same livelock pattern. It can reduce CPU symptom temporarily, but does not break the underlying symmetry.

### Pitfall 2: `time.Sleep(0)` is not jitter

Sleeping for zero duration does nothing but yield once. It is not random. Two goroutines doing `time.Sleep(0)` will re-collide just as readily as without it.

### Pitfall 3: A "constant jitter" is not jitter

Adding `time.Sleep(time.Millisecond)` between attempts is not jitter — it is delay. If both goroutines delay by 1 ms, they collide 1 ms later. Jitter must be *random*.

### Pitfall 4: `math/rand` without a seed

`math/rand.Intn` in Go 1.19 and earlier is deterministic by default. Two goroutines using the global rand without seeding can produce the same sequence and re-collide. Go 1.20+ seeds the global rand at startup automatically, but for safety in older versions, call `rand.Seed(time.Now().UnixNano())` once at startup, or use `math/rand/v2` (Go 1.22+).

### Pitfall 5: Jitter that is too small

If `backoff` is 1 ms and `jitter` is 1 microsecond, the goroutines still collide within the millisecond bucket. Jitter should be a meaningful fraction of the back-off — at least 50%.

### Pitfall 6: "Random" but seeded the same way

```go
rand.Seed(42) // both goroutines seed the same
```

Both goroutines produce the same "random" sequence. Always seed with `time.Now().UnixNano()` or use `rand/v2`.

### Pitfall 7: `runtime.LockOSThread` and livelock

If a goroutine calls `runtime.LockOSThread`, it pins itself to an OS thread. A livelocked goroutine that has locked an OS thread can prevent that thread from running anything else, which exacerbates the symptom. Avoid `LockOSThread` unless you have a specific reason (cgo, signal handling, OpenGL).

### Pitfall 8: Livelock under `GOMAXPROCS=1`

With only one OS thread executing goroutines, two CAS-loop livelocks are *forced* to take turns. The throughput pattern is different from multi-core but the bug is still present. Do not test livelock only on multi-core machines.

### Pitfall 9: Livelock that "fixes itself" under load testing

A small load test may not reproduce livelock — only large ones do. If your test runs in 100 ms with 10 goroutines and "works," but your production has 10000 goroutines, the lab is not the field.

### Pitfall 10: Detect-and-restart as a "fix"

Some teams ship code that detects livelock and restarts the goroutine. This *masks* the bug, eats CPU during the restart cycle, and produces churn that propagates downstream. Treat detect-and-restart as a panic button, not a design.

---

## Common Mistakes

### Mistake 1: Treating livelock as deadlock

The instinct is to look for "locks held in different orders." Deadlock lives there. Livelock lives in *back-off, retry, and CAS* code. Look at the loop, not the lock.

### Mistake 2: Adding more retries

When a retry loop fails, the instinct is to retry more. This *amplifies* the livelock — more attempts, same symmetry, same collision. The fix is jitter, not more attempts.

### Mistake 3: Sleeping a constant time after a failure

```go
if err := tryOnce(); err != nil {
    time.Sleep(10 * time.Millisecond)
    continue
}
```

This is the polite-people dance in code form. Add jitter: `time.Sleep(time.Duration(rand.Int63n(10_000_000))) // 0–10 ms`.

### Mistake 4: Inserting `runtime.Gosched()` everywhere

The Go runtime is preemptive (since Go 1.14). You almost never need to call `Gosched`. Calling it in a livelock loop does not fix the loop; it just yields more.

### Mistake 5: Trusting the deadlock detector

`fatal error: all goroutines are asleep — deadlock!` only fires when *every* goroutine is parked. Livelocked goroutines are not parked. The detector says nothing.

### Mistake 6: CAS-incrementing a counter

```go
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, old+1) {
        break
    }
}
```

Use `counter.Add(1)` instead. The CAS loop on a hot counter is a performance bug at best and a livelock at worst.

### Mistake 7: Writing your own back-off without testing the fail path

A back-off implementation is hard to get right. Test it under load. Use a well-tested library.

### Mistake 8: Logging in every iteration

`log.Println("retrying...")` inside a livelock loop fills disks at hundreds of megabytes per second. Always log *summary* events: "gave up after N attempts," not "attempt 1, attempt 2, attempt 3."

---

## Common Misconceptions

### "Livelock is just a performance problem."

Livelock with zero throughput is a *correctness* problem. The system promised to make progress, and it does not. Production systems that livelock take outages.

### "Livelock and deadlock are the same."

They share a name component but the mechanics are opposite. Deadlock: all stopped, waiting. Livelock: all running, reacting. The cures are different (lock ordering for deadlock, randomness / priority for livelock).

### "Go's scheduler prevents livelock."

The scheduler is fair *in time-slice allocation*, not *in conflict resolution*. It will let your two goroutines politely step on each other forever, giving each a fair share of CPU.

### "If I use channels, I cannot livelock."

Channels reduce *some* livelock surface area (they replace busy retries with parked waiters). But you can absolutely write a livelock with channels — for example, two goroutines that send to each other's channel only when receiving, and never start the dance.

### "Atomics never livelock."

Atomics in *single ops* (Add, Store) do not livelock. Atomics in *CAS loops* under heavy contention very much do.

### "Once tests pass, livelock cannot happen in production."

Unit tests rarely run with realistic concurrency. A test with two goroutines on a four-core machine will not reproduce a livelock that needs 1000 goroutines on the same four cores.

---

## Tricky Points

### Point 1: Livelock can be intermittent

A livelock can flicker on and off as load varies. At 100 RPS the system is fine; at 1000 RPS it stalls; at 500 RPS it partially recovers. This makes it hard to debug.

### Point 2: Livelock under `GOMAXPROCS=1` is different

With one CPU, two CAS-loop livelocks alternate cleanly. With many CPUs, they collide in cache lines and slow each other down. Behaviour scales with parallelism in unobvious ways.

### Point 3: Jitter has its own pathology

Too much jitter and your latency variance explodes. Too little and the livelock persists. The right amount depends on the contention level — typically jitter equal to the back-off (so "1 to 2× back-off").

### Point 4: Some "livelock" is actually starvation

If one goroutine *does* make progress and another never does, you have starvation, not livelock. The cure for starvation (fairness, queue) is different from the cure for livelock (jitter, priority).

### Point 5: Optimistic concurrency assumes low contention

OCC (optimistic concurrency control — read, compute, CAS) is fast when conflicts are rare. Under heavy contention it degrades faster than pessimistic locking. The break-even is workload-dependent; benchmark.

### Point 6: Distributed livelock is harder

Two services that retry each other can livelock across the network. The same cures apply (jitter, priority) but the back-off magnitudes are seconds to minutes, not microseconds.

---

## Test

### Test 1: Reproduce a CAS-loop livelock

Write a program with 10 goroutines and 10000 incrementing a counter via CAS. Measure CPU per increment. Compare with `atomic.Add`. The CAS path should burn dramatically more CPU on the 10000-goroutine version.

### Test 2: Reproduce polite-mutex livelock

Two goroutines, each acquiring `a` then `b` and `b` then `a` respectively, with `TryLock` and a constant 1 ms sleep on failure. Observe that progress is intermittent. Then add jitter and observe smooth progress.

### Test 3: Verify a back-off library

Use `github.com/cenkalti/backoff/v4` with `WithMaxRetries(5)` and `WithRandomizationFactor(0.5)`. Spawn 100 goroutines that fail once and succeed. Verify they do not all retry in lockstep — measure the spread of retry timestamps.

### Test 4: Use `pprof` to confirm a livelock

Build a livelocked program. Run with `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=10`. Look at the flame graph — the CAS or `TryLock` call should dominate. This is the visual signature of livelock.

### Test 5: Add a success-rate gauge

Build a program where you can dial up contention. Plot success-per-second and attempts-per-second. Note where the ratio collapses — that is the livelock threshold for your workload.

---

## Tricky Questions

### Q1: How do you know it is livelock and not just slow code?

**A:** Look at the ratio of *useful work / iterations*. Slow code has high iteration cost but high useful work. Livelock has low iteration cost (each iteration is quick) but near-zero useful work. The CPU profile shows the same hot function in both cases; the application-level counter tells them apart.

### Q2: Is livelock a data race?

**A:** No. Livelock is a liveness bug. A data race is a safety bug. They are independent. You can have a livelocked program with no data races (all operations atomic) and a data-racy program with no livelock (all making progress, just with corrupt data).

### Q3: Does Go's race detector find livelock?

**A:** No. The race detector finds *races* — unsynchronised reads/writes to the same memory location. Livelock involves correctly-synchronised but non-progressing code.

### Q4: Why does adding more goroutines make CAS-loop livelock worse?

**A:** Because the probability that any given CAS attempt succeeds is roughly `1/N` for N goroutines all racing. With 1000 goroutines, 999 of every 1000 attempts fail. The retry cost dominates the useful work.

### Q5: How does exponential back-off help, and how does jitter help differently?

**A:** Exponential back-off spreads out *the time between retries* of a single goroutine. Jitter spreads out *the retries of different goroutines relative to each other*. Without jitter, exponential back-off can preserve the original symmetric collision pattern.

### Q6: When does `sync.Mutex` beat a CAS loop?

**A:** When contention is high and the critical section is short, the mutex parks the loser (no CPU spent) while the winner runs. A CAS loop has every loser actively retrying. Under 1000-goroutine contention, the mutex often wins on throughput.

### Q7: Can a single goroutine livelock?

**A:** Not in the classical sense. Livelock needs two parties reacting to each other. A single goroutine in an infinite loop is just an infinite loop. (Though some authors stretch the definition to include "an algorithm that retries forever against an external system" — but the external system is the second party.)

### Q8: Is `singleflight.Group` a livelock cure?

**A:** It is a cure for the specific livelock pattern of "many goroutines try to fill the same cache key." It coalesces duplicate concurrent calls into one. Outside that pattern, it is not a general livelock fix.

---

## Cheat Sheet

```
Definition
  Livelock = goroutines running but making no progress.
  Deadlock = goroutines blocked, none running.
  Starvation = some goroutines progress, one is denied.

Symptoms
  CPU high, throughput zero, no error, no panic.
  pprof CPU profile dominated by a retry loop.
  Application counter for "succeeded" is flat or near zero.

Common Go shapes
  Retry-on-conflict loops with no jitter.
  CAS loops under heavy contention (many goroutines, one atom).
  TryLock + constant sleep retry.
  Distributed leader election with symmetric demote/promote.

Cures
  Random jitter (the canonical cure).
  Priority (one side wins, other defers).
  Ordering (acquire locks in fixed order).
  Algorithm change (atomic.Add instead of CAS loop).
  Singleflight for cache fill.

Libraries
  github.com/cenkalti/backoff — exponential back-off + jitter.
  golang.org/x/sync/singleflight — request coalescing.
  golang.org/x/sync/errgroup — bounded retries with cancellation.

Detect
  CPU profile + application-level success counter.
  Plot attempts/s vs success/s; the ratio is the signal.

Don't
  Don't add retries to "fix" livelock — it amplifies.
  Don't use runtime.Gosched as a cure.
  Don't trust unit tests at low concurrency.
  Don't sleep a constant duration after failure — jitter.
```

---

## Self-Assessment Checklist

- [ ] I can define livelock without using the word "deadlock."
- [ ] I can describe the polite-people analogy and map it to Go code.
- [ ] I can identify a CAS-loop livelock from a code snippet.
- [ ] I can write exponential back-off with jitter from memory.
- [ ] I know when to prefer `atomic.Add` over a CAS loop.
- [ ] I know what `TryLock` is and why it can livelock.
- [ ] I know the difference between liveness and safety bugs.
- [ ] I can name one library that helps (`github.com/cenkalti/backoff`).
- [ ] I can detect livelock from a CPU profile + a success-rate counter.
- [ ] I know that `runtime.Gosched()` is not a cure.

---

## Summary

Livelock is the concurrency bug where goroutines run busily but accomplish nothing. The hallmark is high CPU with zero throughput. The cause is two or more goroutines reacting to each other in a symmetric, repeating pattern — most commonly retry-on-conflict, CAS loops under contention, or back-off-and-retry mutex schemes with no jitter.

The canonical analogy is two polite people in a hallway who keep stepping out of each other's way. The canonical cure is to break the symmetry — usually with random jitter on back-off, sometimes with priority based on a stable property like an ID, and sometimes by changing the algorithm (a single `atomic.Add` instead of a CAS loop).

Livelock evades Go's built-in detectors. The race detector does not find it; the "all goroutines asleep" panic does not fire. You catch it by monitoring throughput, not iterations, and by load-testing with realistic concurrency.

Junior-level mastery means recognising the shape and applying the standard cure. Middle and senior levels go deeper into specific shapes (CAS-loop livelock, distributed livelock) and bespoke cures.

---

## What You Can Build

After learning livelock basics, you can:

- A retry helper for HTTP requests that respects `Retry-After`, jitter, and a context deadline.
- A small library that wraps `TryLock` with jittered back-off.
- A throughput probe — a background goroutine that publishes "attempts/s vs success/s" to your metrics system.
- A safe wallet-transfer function that uses deterministic lock ordering by account ID.
- A bounded worker pool that does retries internally with `backoff` and `errgroup`.

---

## Further Reading

- *The Go Programming Language* by Donovan & Kernighan, chapter on concurrency.
- *Concurrency in Go* by Katherine Cox-Buday, chapters on livelock and starvation.
- Google SRE Book, chapter "Handling Overload" — discusses retry storms.
- AWS Architecture Blog: "Exponential Backoff And Jitter" (Marc Brooker, 2015) — the canonical post on why jitter matters.
- `github.com/cenkalti/backoff` — read the README and source.
- Go runtime source: `src/sync/mutex.go` — see how `sync.Mutex` itself avoids livelock with a starvation mode.

---

## Related Topics

- `08-deadlock-livelock-starvation/01-deadlock` — the cousin bug.
- `08-deadlock-livelock-starvation/03-starvation` — the third sibling.
- `03-sync-package/07-atomic` — CAS, atomic loops, and ABA.
- `03-sync-package/01-mutex` — `Mutex.TryLock` and the starvation mode.
- `02-channels` — channel-based coordination as a livelock-resistant alternative.
- `04-context` — using `context.Context` to bound retries.
- `05-patterns/02-worker-pool` — worker pools and their interaction with retry.

---

## Diagrams & Visual Aids

### The polite-people dance

```
time
 |
 0:  A goes left  | B goes left   --> same side, collision
 1:  A goes right | B goes right  --> still same side
 2:  A goes left  | B goes left
 3:  A goes right | B goes right
 ...forever...
```

Map to Go: replace "goes left/right" with "tries lock A, fails, retries on lock B."

### CAS-loop livelock under contention

```
goroutines: G1 G2 G3 G4 G5 ... G1000
                |
                v
            shared atomic counter

each round:  one wins, 999 retry
            -> 99.9% of work is wasted
```

### Detection by metrics

```
attempts/s  ============================================
            ^^^ high and steady

success/s   __    __  _
            ^^^ near-zero, occasional blips

ratio       0.001
```

The ratio is the signal.

### The jitter cure

```
without jitter:
  G1 retries at t=10ms   G2 retries at t=10ms   --> collide
  G1 retries at t=20ms   G2 retries at t=20ms   --> collide

with jitter:
  G1 retries at t=11.2ms  G2 retries at t=15.7ms --> miss each other
  G1 retries at t=23.9ms  G2 retries at t=28.4ms --> miss each other
```

Randomness breaks the synchronisation.

### State diagram

```
[RUNNING] --conflict--> [BACK-OFF] --timer--> [RETRY] --success--> [DONE]
                                       |
                                       v
                                   [RETRY] --conflict--> [BACK-OFF]
                                       (loop forever = livelock)
```

The livelocked program never reaches [DONE].
