# Deadlock in Go — Junior Level

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
> Focus: "What is a deadlock? Why did Go just kill my program with `fatal error: all goroutines are asleep`? How do I keep this from happening again?"

A **deadlock** is the moment a program freezes because every actor in it is waiting for someone else to act first, and no one ever will. Two goroutines, each holding one half of what the other needs, will sit there until the operating system kills the process. A goroutine waiting to read from a channel that nobody will ever send to will sit there forever. The CPU is idle. The memory is allocated. Nothing moves.

In Go, deadlock is so common a beginner trap that the runtime itself contains a detector. The first time you write `<-ch` with no producer in sight, the Go runtime notices that every goroutine in your program is parked, decides nothing can ever happen, and aborts the program with a famous error message:

```
fatal error: all goroutines are asleep - deadlock!
```

That detector is one of Go's friendliest features — and one of its most narrow. It only fires when **every** goroutine in the program is blocked. If a hundred goroutines are happily serving HTTP and three are deadlocked on a pair of mutexes, the runtime sees activity and stays silent. The web server slowly accumulates hung requests until file descriptors run out.

After reading this file you will:

- Define deadlock precisely and distinguish it from livelock, starvation, and ordinary slowness.
- Know the four **Coffman conditions** by name and recognise them in code.
- Trigger Go's whole-program deadlock detector and read its stack dump.
- Recognise the three most common Go deadlock shapes: unmatched channel operations, mutex lock-order inversion, and `WaitGroup` misuse.
- Apply five simple disciplines that prevent most deadlocks before they happen.
- Write tests with timeouts so a deadlock fails the test instead of hanging it.

You do not need to know about formal verification, lock-ordering proofs, or the internals of `runtime.gopark` yet. Those come at the middle, senior, and professional levels. This file is about the moment your program freezes and you have to figure out why.

---

## Prerequisites

- **Required:** Comfort starting goroutines with the `go` keyword. See [01-goroutines/01-overview](../../01-goroutines/01-overview/).
- **Required:** Basic channel send and receive, including blocking semantics. See [02-channels/01-fundamentals](../../02-channels/01-fundamentals/).
- **Required:** `sync.Mutex.Lock` and `Unlock`, and the idea that one goroutine "owns" a lock at a time. See [03-sync-package/01-mutex](../../03-sync-package/01-mutex/).
- **Helpful:** `sync.WaitGroup` (`Add`, `Done`, `Wait`). See [03-sync-package/03-waitgroup](../../03-sync-package/03-waitgroup/).
- **Helpful:** `context.Context` with cancellation. See [04-context-package](../../04-context-package/).
- **Helpful:** Any other language with threads and locks — Java `synchronized`, C `pthread_mutex`, Python `threading.Lock`. Not required.

If you can write a program that spawns two goroutines, hands them a shared `sync.Mutex`, and runs without crashing, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Deadlock** | A state in which a set of goroutines are all blocked, each waiting for an event that only another member of the set can produce. No one in the set can ever make progress. |
| **Livelock** | A state in which goroutines are not blocked but keep changing state in response to each other so that no useful work is done. Distinct from deadlock; covered in [02-livelock](../02-livelock/). |
| **Starvation** | A state in which a goroutine is technically eligible to run but never gets to. Covered in [03-starvation](../03-starvation/). |
| **Coffman conditions** | Four conditions, all of which must hold for deadlock to be possible: **mutual exclusion**, **hold-and-wait**, **no preemption**, **circular wait**. Named after E. G. Coffman's 1971 paper on the topic. |
| **Mutual exclusion** | A resource can be held by only one goroutine at a time. A `sync.Mutex` is the canonical example. |
| **Hold-and-wait** | A goroutine holds at least one resource while waiting to acquire another. |
| **No preemption** | A held resource cannot be forcibly taken away. The runtime cannot reach in and `Unlock` a mutex on behalf of a hung goroutine. |
| **Circular wait** | A cycle exists in the "who is waiting for whom" graph: A waits for B, B waits for C, C waits for A. |
| **Whole-program deadlock** | A deadlock in which *every* goroutine in the program is blocked. Detected by the Go runtime. |
| **Partial deadlock** | A deadlock confined to a subset of goroutines while others continue to run. Not detected by the runtime. |
| **Stack dump** | The traceback Go prints when the runtime aborts. Each goroutine appears with its state in brackets, like `[chan receive]` or `[semacquire]`. |
| **`fatal error: all goroutines are asleep - deadlock!`** | The exact message the Go runtime prints for whole-program deadlock. |
| **`goleak`** | Uber's test helper that asserts no goroutines outlive the test. Useful for catching deadlocks that survive a test but leak goroutines. |
| **Lock order / lock ranking** | A documented, globally consistent order in which locks must be acquired. The strongest deadlock-prevention discipline. |

---

## Core Concepts

### A deadlock is a cycle, not a slow operation

A program that has not made progress for ten seconds may be slow, blocked on a network call, garbage-collecting, or deadlocked. The first three eventually finish. A deadlock never does. The defining characteristic is not "stopped for a while" but "stopped *forever* because the graph of waits contains a cycle."

If you suspect deadlock, the first question to ask is: **what is each stuck goroutine waiting for, and is the thing it is waiting for going to happen?** If the answer is "yes, eventually," it is not a deadlock — it is a slow operation. If the answer is "no, that event can only happen if another stuck goroutine moves first," you have your deadlock.

### The Coffman conditions — all four must hold

In 1971, E. G. Coffman published four conditions that together are necessary and sufficient for deadlock in a system with shared resources. If you break any one of them, deadlock becomes impossible.

1. **Mutual exclusion.** Resources are not shareable. A `sync.Mutex` can be held by exactly one goroutine. A buffered channel slot can be filled by exactly one sender. If a resource is fundamentally shareable (like an `sync.RWMutex` in read mode by many readers), it does not contribute to deadlock — unless the write side joins the cycle.
2. **Hold-and-wait.** A goroutine that already holds resource A asks for resource B while still holding A. If goroutines released everything before asking for more, deadlock could not form.
3. **No preemption.** A held resource cannot be revoked. The runtime does not unlock another goroutine's mutex. A goroutine receiving from a channel cannot be told "your turn is over, the value goes somewhere else."
4. **Circular wait.** There exists a chain of goroutines G1 → G2 → ... → Gn → G1 such that each Gi is waiting for a resource held by G(i+1). The cycle is what closes the trap.

Removing any one of these prevents deadlock. The two practical attack surfaces are **hold-and-wait** (use trylock, release-before-acquire, or single-step transactions) and **circular wait** (enforce a global lock order). The other two are usually fixed by the design of the underlying primitive.

### Go's whole-program deadlock detection

When every goroutine in your program is parked — every goroutine is in a state like `[chan receive]`, `[chan send]`, `[semacquire]`, `[select]`, or `[sync.WaitGroup.Wait]` — the runtime knows nothing can ever wake any of them. It aborts the program with a stack dump and the message `fatal error: all goroutines are asleep - deadlock!`.

The detector is implemented in `runtime/proc.go` inside the function `checkdead`. After every parking operation, the scheduler counts non-parked goroutines. If the count drops to zero — meaning even the main goroutine is parked — `checkdead` panics.

What the detector catches:

- A program with one goroutine doing `<-ch` on an unbuffered channel that no one ever sends to.
- A program where the main goroutine calls `wg.Wait()` but the spawned goroutine that should call `wg.Done()` has exited without doing so (and no other goroutine is running).
- A program in which two goroutines each hold one mutex and are blocked acquiring the other, provided no third goroutine is doing anything.

What the detector does **not** catch:

- A program with a live `time.Sleep`. A sleeping goroutine is not considered parked for deadlock purposes — it has a timer that will wake it. So `time.Sleep(time.Hour)` masks all whole-program deadlocks for an hour.
- A program with a runtime-internal goroutine doing work — the GC, the finalizer, the trace reader. These count as "alive."
- A program with an open file or network listener — the netpoller goroutine counts as alive.
- A program with a deadlock in 2 goroutines while 50 others happily serve traffic. The detector does not analyse subsets.

That last point is critical. In production, the detector almost never fires, because production servers always have some live work. Partial deadlocks have to be diagnosed with `pprof goroutine` and stack traces, not with the built-in detector.

### Why "all asleep" and not "subset asleep"

Detecting partial deadlock — finding a cycle in the wait graph of running goroutines — is expensive. The runtime would have to maintain an "who is waiting for whom" graph for every channel, mutex, condvar, and select operation, and run a cycle-detection algorithm on every park. That cost would be paid by every Go program forever, even ones that have no deadlocks. The Go team's decision was to ship a cheap detector that catches the most embarrassing case (the whole program freezes) and leave partial-deadlock detection to external tools.

The cheap detector works because "every goroutine parked" is a single counter, not a graph. Each time a goroutine parks, decrement. Each time one unparks, increment. If the counter hits zero and the program has not exited, deadlock. It costs almost nothing.

### Channel deadlocks: send to nobody, receive from nobody

Channels are the most common Go-specific deadlock source. Three patterns dominate.

**Pattern 1: unbuffered send with no receiver.**

```go
ch := make(chan int)
ch <- 1 // blocks forever
```

An unbuffered channel send blocks until a receiver is ready. With one goroutine and no receiver, the send blocks forever. The detector fires.

**Pattern 2: receive from a channel that no one will send to.**

```go
ch := make(chan int)
<-ch // blocks forever
```

Symmetric to pattern 1. No sender will appear. The detector fires.

**Pattern 3: `for range` over a channel that is never closed.**

```go
ch := make(chan int)
go func() {
    for i := 0; i < 10; i++ {
        ch <- i
    }
    // forgot to close(ch)
}()
for v := range ch {
    fmt.Println(v)
}
```

The producer sends ten values and exits. The consumer prints them and then blocks waiting for the eleventh, which will never arrive. The detector fires after the producer goroutine exits, because at that moment only the main goroutine remains and it is parked on `<-ch`.

### Mutex deadlocks: lock order inversion

When two goroutines need two mutexes, the order in which they acquire matters absolutely.

```go
var muA, muB sync.Mutex

// Goroutine 1
muA.Lock()
muB.Lock()
// ... work ...
muB.Unlock()
muA.Unlock()

// Goroutine 2
muB.Lock()
muA.Lock()
// ... work ...
muA.Unlock()
muB.Unlock()
```

The first goroutine grabs A and asks for B. The second grabs B and asks for A. Each holds what the other needs. Cycle: G1 → A → G1 waits → G2 → B → G2 waits → G1. Both stuck.

The fix is **lock ordering**: pick one canonical order (always A before B) and enforce it everywhere. Then circular wait cannot form. We cover this in detail at senior level.

### `WaitGroup` deadlocks: Add-after-Wait, Wait-without-Done

`sync.WaitGroup` has two classic deadlock shapes.

**Wait without Done.** You call `wg.Add(1)` and `wg.Wait()` but the spawned goroutine exits without calling `wg.Done()`. The counter never hits zero.

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    // forgot wg.Done()
}()
wg.Wait() // forever
```

The detector catches this if no other goroutines are alive.

**Add after Wait.** You call `wg.Wait()`, then in another goroutine call `wg.Add(1)`. The documentation explicitly forbids this:

> Note that calls with a positive delta that occur when the counter is zero must happen before a Wait.

If `Wait` has already returned because the counter was zero, a subsequent `Add(1)` is harmless. But if `Wait` is currently blocked and you call `Add(1)` from another goroutine, you race with the wake-up logic and can hang `Wait` even after `Done` brings the counter back to zero. This is a real bug in code that adds work dynamically inside a worker.

### Context misuse: ctx without cancel chain

`context.Context` itself does not cause deadlock. But code that uses contexts incorrectly can.

```go
func work(ctx context.Context, ch <-chan Task) {
    for task := range ch {
        process(task)
    }
}
```

The function takes a context but never checks it. If the channel is never closed and the caller cancels the context expecting `work` to return, `work` keeps blocking on the receive. The caller is blocked on `work` to return. Deadlock — even though the cancel signal arrived.

The fix is to select on the context's `Done` channel alongside the work channel.

```go
func work(ctx context.Context, ch <-chan Task) {
    for {
        select {
        case <-ctx.Done():
            return
        case task, ok := <-ch:
            if !ok {
                return
            }
            process(task)
        }
    }
}
```

This is not a deadlock in the formal Coffman sense — there is no resource cycle — but the effect on the user is identical: the program hangs and never finishes.

### Tools the runtime gives you for free

When you suspect a deadlock, the runtime offers three immediate tools:

1. **The whole-program detector.** Free, automatic, only fires on full deadlock.
2. **`SIGQUIT` / `kill -3` stack dump.** Send `SIGQUIT` to a running Go program and the runtime prints a stack trace of every goroutine to stderr, then exits. On most shells, `Ctrl+\` sends `SIGQUIT`.
3. **`runtime.Stack`.** Programmatic version of the above. Call `runtime.Stack(buf, true)` to write all goroutine stacks into `buf` without exiting.

On top of these, the standard `net/http/pprof` package exposes `/debug/pprof/goroutine?debug=2`, which gives the same information for a running server. That is the production deadlock-hunting workflow.

---

## Real-World Analogies

### The dining philosophers

Five philosophers sit at a round table. Each has a plate. Between each pair of neighbours lies one chopstick — five plates, five chopsticks. To eat, a philosopher needs both their left and right chopstick. Each picks up the left chopstick, then reaches for the right. If all five do this simultaneously, every philosopher holds one chopstick and waits for the next one over. Cycle. Deadlock. No one eats.

The fix Dijkstra proposed: number the chopsticks 1 to 5. Each philosopher picks up the *lower-numbered* chopstick first. Now the philosopher between chopsticks 5 and 1 will pick up 1 before reaching for 5, breaking the cycle. This is lock ordering, in 1965 form.

### The intersection without traffic lights

Four cars arrive at a four-way intersection simultaneously, each from a different direction. Each driver yields to the car on the right. Each is waiting for the car on the right to move. No car moves. Cycle. Deadlock — except real drivers eventually honk and someone gives up, which is why intersections in practice livelock rather than deadlock.

The fix is a traffic light: a global ordering forced from outside. Sound familiar? That is what a lock ordering is.

### The hostage swap

Two parties agree to exchange — money for documents. Each refuses to hand over their item until they receive the other's. Each holds, each waits, neither moves. The bank fixes this with an escrow: a third party that holds both items and releases them simultaneously. In Go, the equivalent is a `sync.RWMutex` upgrade pattern done wrong, or two goroutines each waiting for the other to send on a channel.

### The query-the-database-while-holding-the-mutex bug

A real production deadlock: a goroutine holds an in-memory cache mutex and calls the database. The database connection pool is exhausted. The goroutine waits for a connection. The other goroutine holding the only free connection wants to update the cache and is blocked on the cache mutex. Two resources, one cycle, hung forever — until file descriptors run out and the process dies for the wrong reason.

The lesson: **never call out to a slow or blocking subsystem while holding a lock**. Holding a lock during I/O is the most common production deadlock pattern.

---

## Mental Models

### Model 1: The wait graph

Draw a directed graph. Each goroutine is a node. Each held resource is a label on the node. Each "is waiting for resource X" is an outgoing edge from the goroutine to the goroutine that holds X. If the graph contains a cycle, you have deadlock. If it does not, you do not.

Most of the time you do not draw this graph on paper. You draw it in your head while reading stack traces. The skill is learning to read `goroutine 7 [chan receive]` and instantly think: "node 7, waiting for whoever last did a send on that channel, who is that?"

### Model 2: The four-leaf clover

The Coffman conditions form a four-leaf clover. Tear off any one leaf and deadlock is impossible. The leaves you can practically tear off in Go:

- **Hold-and-wait:** use `sync.Mutex.TryLock` (Go 1.18+) and back off if the second lock is busy.
- **Circular wait:** enforce a global lock order.
- **Mutual exclusion:** sometimes — use channels with capacity, or `sync/atomic`, instead of a mutex.
- **No preemption:** rarely — use context cancellation and timeouts to give up after a deadline.

If you cannot remember "Coffman conditions" by name, remember the clover.

### Model 3: "Every wait must have a wake-up promise"

Every blocking operation in Go is a promise that someone, somewhere, will eventually wake the waiter. A `<-ch` is a promise that some other goroutine will eventually send (or close). A `mu.Lock()` is a promise that whoever holds the lock will eventually `Unlock`. A `wg.Wait()` is a promise that the counter will eventually hit zero. A deadlock is a broken promise. Track every promise as you read the code; if you cannot point to the goroutine that will keep it, you have a bug.

### Model 4: "The runtime is your dumb detector, not your friend"

Go's runtime deadlock detector is a 100-line check that fires when the goroutine count of non-parked goroutines hits zero. It is not analysing your wait graph. It is not telling you "you have a deadlock between mutexes A and B." It is saying "everyone is asleep, including me." In production it almost never fires because production programs almost always have some live goroutine. Treat the detector as a development-time net, not a production tool.

### Model 5: "Holding a lock is a debt you owe to other goroutines"

Every microsecond you hold a lock is a microsecond you may have caused another goroutine to wait. While holding a lock:

- Do not call slow code.
- Do not call external services.
- Do not call code you do not own.
- Do not acquire other locks if a global order does not exist.

The locked region should be the shortest possible window: read the shared state, decide, mutate, release. Anything else belongs outside the lock.

---

## Pros & Cons

This section is unusual: "deadlock" is not a feature, so the pros-and-cons are about **the tradeoffs of Go's design choices around deadlock**.

### Pros (of Go's approach)

- **Whole-program detector is cheap and saves beginners.** The first time you write a program that hangs, Go tells you. Most languages just hang silently.
- **Stack dumps are first-class.** `SIGQUIT` and `pprof goroutine` give you a complete view of every blocked goroutine, with file:line numbers and parked state, with no setup.
- **Channels make the wait graph visible in source.** A `ch <- v` is a documented promise. Compare to shared-memory languages where wakeups are buried in condition variables.
- **`go vet` catches some lock-copy and `sync.WaitGroup` misuses** without running the program.
- **`context.Context` propagates cancellation explicitly.** A correctly written `select` on `ctx.Done` turns most "stuck waiting forever" bugs into "stuck for at most one context timeout."

### Cons (of Go's approach)

- **No partial-deadlock detector.** Production deadlocks involving a subset of goroutines are invisible to the runtime.
- **No lock-order enforcement.** Unlike Java's `ThreadMXBean.findDeadlockedThreads` or C++ libraries that warn on inverted lock order, Go's `sync.Mutex` is silent. You enforce ordering by discipline.
- **The detector has blind spots.** A live `time.Sleep`, `runtime.Gosched` loop, or netpoller goroutine prevents the detector from firing even if the rest of the program is deadlocked.
- **No goroutine identity.** You cannot point at "goroutine 17" and say "kill it" or "give it back its lock." There is no preemption escape hatch.
- **Mutex misuse is easy.** Forgetting `defer mu.Unlock()` or putting `Unlock` inside a conditional branch creates leaks that the type system does not catch.

---

## Use Cases

There is no "when to use a deadlock." There is "when to actively prevent deadlock," and that answer is **always**, in concurrent code. The practical breakdown:

| Scenario | Deadlock prevention to apply |
|---|---|
| Two or more mutexes touched by the same goroutine | Document and enforce a global lock order. |
| One mutex, but the locked region calls out to other code | Never hold the lock across function boundaries you do not control. |
| Channel receive in a goroutine that must terminate on cancellation | `select` on `ctx.Done` alongside the channel. |
| Producer-consumer over a channel | The producer always closes; the consumer always uses `for range`. |
| `WaitGroup`-based fan-in | `Add` before `go`, `Done` in `defer`, `Wait` only after all `Add`s. |
| Goroutine pool with bounded queue | The submit path must either block with a deadline or return an error. |
| Test that exercises concurrent code | Use `goleak.VerifyNone(t)` or wrap the test body in a timeout. |

---

## Code Examples

### Example 1: The shortest possible deadlock

```go
package main

func main() {
    ch := make(chan int)
    <-ch
}
```

Run it. The runtime aborts:

```
fatal error: all goroutines are asleep - deadlock!

goroutine 1 [chan receive]:
main.main()
        /tmp/dl.go:5 +0x28
```

The main goroutine is parked on `<-ch`. No one will ever send. The runtime detects the deadlock and exits.

### Example 2: Unbuffered send with no receiver

```go
package main

func main() {
    ch := make(chan int)
    ch <- 1
}
```

Same outcome. The unbuffered send blocks because no receiver is ready, and no other goroutine will ever appear.

### Example 3: Buffered send that fills the buffer

```go
package main

func main() {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2
    ch <- 3 // buffer full, blocks
}
```

The first two sends succeed (buffer has capacity 2). The third blocks waiting for room. No one will read. Deadlock.

### Example 4: `for range` over an unclosed channel

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 3; i++ {
            ch <- i
        }
        // forgot close(ch)
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

Output: `0`, `1`, `2`, then `fatal error: all goroutines are asleep - deadlock!`. The producer exits, only the main goroutine remains, and it is parked on `<-ch`. Fix: `defer close(ch)` inside the goroutine.

### Example 5: `WaitGroup` without `Done`

```go
package main

import "sync"

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        // forgot wg.Done()
    }()
    wg.Wait()
}
```

The goroutine exits without decrementing. The main goroutine waits forever. Deadlock detected.

### Example 6: The classic mutex inversion

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

var muA, muB sync.Mutex

func ab() {
    muA.Lock()
    time.Sleep(10 * time.Millisecond)
    muB.Lock()
    fmt.Println("ab")
    muB.Unlock()
    muA.Unlock()
}

func ba() {
    muB.Lock()
    time.Sleep(10 * time.Millisecond)
    muA.Lock()
    fmt.Println("ba")
    muA.Unlock()
    muB.Unlock()
}

func main() {
    go ab()
    go ba()
    time.Sleep(time.Second)
    fmt.Println("done")
}
```

The `time.Sleep(time.Second)` in `main` keeps the runtime detector from firing — the main goroutine is sleeping, not parked. So the program prints `done` and exits, **leaving two deadlocked goroutines silently leaked**. If you remove the sleep at the end and add `select{}` instead, the runtime *will* detect the deadlock once the main goroutine parks.

```go
func main() {
    go ab()
    go ba()
    select {} // park main forever
}
```

Now you get:

```
fatal error: all goroutines are asleep - deadlock!
```

with stack traces showing both goroutines blocked on `sync.(*Mutex).Lock`.

### Example 7: Fixed lock order

```go
// Always acquire muA before muB.
func ab() {
    muA.Lock()
    muB.Lock()
    defer muA.Unlock()
    defer muB.Unlock()
    // work
}

func ba() {
    muA.Lock()  // same order, even though the function name suggests otherwise
    muB.Lock()
    defer muA.Unlock()
    defer muB.Unlock()
    // work
}
```

Both goroutines acquire in the same order. Circular wait cannot form. No deadlock.

### Example 8: Send-receive pair on an unbuffered channel

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        ch <- 42
    }()
    fmt.Println(<-ch)
}
```

This works. The send blocks until the main goroutine receives; both unblock at the rendezvous. No deadlock. Note the order is reversed from Example 2 — here a sender exists.

### Example 9: Self-deadlock with a non-recursive mutex

```go
package main

import "sync"

var mu sync.Mutex

func outer() {
    mu.Lock()
    inner()
    mu.Unlock()
}

func inner() {
    mu.Lock()   // already held by us, but Go's mutex is not reentrant
    defer mu.Unlock()
    // ...
}

func main() {
    outer()
}
```

`sync.Mutex` is not reentrant. The same goroutine calling `Lock` twice blocks forever. Output: `fatal error: all goroutines are asleep - deadlock!`. The fix is to not call locked code from inside the locked region, or split into a public locked wrapper and a private unlocked implementation.

### Example 10: Detecting the deadlock with a test timeout

```go
package main

import (
    "sync"
    "testing"
    "time"
)

func TestNoDeadlock(t *testing.T) {
    done := make(chan struct{})
    go func() {
        var wg sync.WaitGroup
        wg.Add(1)
        // forgot wg.Done()
        wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        // ok
    case <-time.After(time.Second):
        t.Fatal("test deadlocked")
    }
}
```

The deadlocked goroutine inside the test is not detected by the runtime — the test harness is still alive. The explicit timeout turns the hang into a test failure with a useful message.

---

## Coding Patterns

### Pattern: `defer` every `Unlock` immediately after `Lock`

```go
mu.Lock()
defer mu.Unlock()
// work
```

This guarantees the lock is released no matter how the function exits — return, panic, or unhandled branch. The number-one cause of mutex deadlocks in beginner code is "I returned early and forgot to unlock." `defer` eliminates that class of bug.

### Pattern: `defer wg.Done()` first inside the goroutine

```go
go func() {
    defer wg.Done()
    // work
}()
```

If the goroutine panics, `Done` still runs. The `WaitGroup` counter still reaches zero. The waiter still wakes. Without `defer`, a panic propagates without decrementing and the waiter hangs forever.

### Pattern: `select` with `ctx.Done` on every blocking operation

```go
select {
case v := <-ch:
    handle(v)
case <-ctx.Done():
    return ctx.Err()
}
```

Every blocking receive becomes interruptible by context cancellation. A deadlock-by-forgotten-sender becomes a context-deadline error that you can observe and recover from.

### Pattern: producer always closes

```go
go func() {
    defer close(ch)
    for _, x := range work {
        ch <- x
    }
}()
for v := range ch {
    // consume
}
```

The convention `producer closes, consumer ranges` makes "infinite consumer wait" impossible by construction.

### Pattern: TryLock for optional acquisition

```go
if mu.TryLock() {
    defer mu.Unlock()
    // got it, do work
} else {
    // fall back: skip, retry later, or report contention
}
```

`sync.Mutex.TryLock` (Go 1.18+) breaks the hold-and-wait condition: you ask politely and step away if the lock is busy, never blocking. Use sparingly — `TryLock` is documented as a tool for "rare use cases," not a default pattern.

---

## Clean Code

- Document every shared mutex with a comment that says **what it protects**. `// guarded by mu` next to the relevant fields.
- Document the **lock order** in package documentation when more than one mutex exists. The order is part of the API contract.
- Keep the locked region **shorter than the function**. If your `mu.Lock()` is at the top and `mu.Unlock()` is at the bottom and the function is 200 lines, the lock is too coarse.
- Prefer **one mutex per data structure** over many fine-grained mutexes. Fine-grained locking buys parallelism but doubles the deadlock surface.
- Name mutexes after **what they protect**, not how they work. `cacheLock` is better than `mu`. `connPoolMu` is better than `m2`.

---

## Product Use / Feature

Deadlock prevention is not a feature users see directly. They see its absence: a server that responds, a CLI that finishes, a UI that does not freeze. The user-visible symptoms of an unprevented deadlock:

- **Hung HTTP requests.** The connection stays open, the timeout fires on the client side, the server's `Accept` loop still works but file descriptors slowly leak.
- **Stuck CLI.** The terminal cursor blinks. `Ctrl+C` works only if a signal handler is installed; otherwise you need `Ctrl+\` (SIGQUIT) to dump the stack.
- **Frozen UI.** Most desktop Go UIs (Fyne, Gio) run their main loop on a goroutine. A deadlock with the UI goroutine looks like a frozen window.
- **Failing health checks.** Liveness probes (Kubernetes `livenessProbe`) catch deadlocks indirectly: the probe handler is itself blocked, the probe fails, the pod is restarted. This is a load-bearing safety net for partial deadlocks the runtime detector misses.

---

## Error Handling

A deadlock is not an error you can `return err` from — by the time you would return, you are stuck. The error-handling discipline around deadlock is about turning a hang into something you can observe.

- **Always use timeouts on external calls.** `context.WithTimeout` on every HTTP, DB, and RPC call. Without one, a deadlocked downstream becomes a deadlock in your program.
- **Always select on `ctx.Done`.** Any blocking operation inside a function that takes a `context.Context` must be a `select` over the operation and `ctx.Done`.
- **Bound queue capacities.** An unbounded channel never deadlocks on send — but the price is unbounded memory. A bounded channel deadlocks on send if the consumer is stuck; you would rather observe that than run out of memory.
- **Liveness probes.** The `livenessProbe` Kubernetes hook should hit an endpoint that itself does meaningful work (e.g., reads a counter that worker goroutines increment). A static endpoint that always returns 200 misses deadlocks.

---

## Security Considerations

Deadlock is mostly a reliability issue, but it has a security side: **denial of service via crafted input that triggers a deadlock**.

- A server that takes a mutex on user input and calls back into another locked path can be crashed by a request crafted to exercise that path.
- A program that does `<-ch` on a channel fed by user-controlled work can be hung indefinitely by a user who never sends.
- A rate limiter that uses a `sync.Mutex` and reaches out to a network store can be deadlocked by a slow store, taking down the rate limiter and, with it, the whole service.

Mitigations: always use timeouts; never hold a lock across a call to user-controlled or external code; bound every wait with `ctx.WithTimeout`.

---

## Performance Tips

- Removing a deadlock is a **correctness** fix, not a performance fix. The system was at zero throughput; any positive number is an infinite improvement.
- But **lock contention** that looks like deadlock often is not. A program that "feels" deadlocked may be spending 99% of its time waiting on a hot lock with one goroutine doing the work. Use `pprof` to distinguish.
- **Coarse locks** are deadlock-safe but slow. **Fine-grained locks** are fast but deadlock-prone. A common production tuning step is to *split* a hot lock into N locks (one per shard), which doubles the deadlock surface — so do this only with a documented order.
- Replace mutex with **`atomic`** for counters and flags. `atomic.AddInt64` cannot deadlock; `mu.Lock(); count++; mu.Unlock()` can.

---

## Best Practices

1. **Lock for the shortest possible window.** Read, decide, mutate, release.
2. **Defer Unlock immediately after Lock.** No exceptions.
3. **Never call code you do not own while holding a lock.** Especially not network, DB, or callback code.
4. **One mutex per data structure.** Avoid sharing one giant mutex across modules.
5. **Document lock order.** If your package has more than one mutex, write the order in the package doc.
6. **Use channels for communication, not for protection.** Don't use a channel as a substitute for `sync.Mutex` unless the communication shape fits.
7. **Always have a `select` with `ctx.Done`.** Any blocking operation in a context-aware function.
8. **Bound channel capacities.** Unbounded queues hide deadlocks until they become OOM.
9. **Always `wg.Done` in a `defer`.** Panic-safe and reorder-safe.
10. **Test with timeouts.** Wrap concurrent test bodies in `select` with `time.After`, or use `goleak`.

---

## Edge Cases & Pitfalls

- **Reading from a nil channel blocks forever.** A `select` with a `nil` channel case is silently ignored. If *all* cases are nil channels, the `select` blocks forever and the program deadlocks. Useful for the "disable this case" idiom — dangerous if accidental.
- **Sending on a closed channel panics.** Not a deadlock, but easy to confuse: the program crashes with "send on closed channel," which the runtime detector does not report as deadlock.
- **`select` with no `default` and all cases blocked is deadlock.** With a `default`, it is busy-loop. Both are bad; the right shape is `default` for "non-blocking try" or no `default` for "wait for one of these."
- **`sync.RWMutex.RLock` is not deadlock-free.** Two readers, then a writer requesting `Lock`, then another reader requesting `RLock` — depending on implementation, the second reader can be blocked behind the writer to prevent writer starvation, and if the first readers depend on it, deadlock.
- **`WaitGroup.Add(n)` after some goroutines have started is racy.** Always `Add` before `go`.
- **A goroutine running `runtime.Gosched()` in an infinite loop is not parked.** It prevents whole-program deadlock detection even if everything else is stuck.

---

## Common Mistakes

1. **Forgetting `close(ch)` after the producer is done.** Consumer's `for range` blocks on the next receive forever.
2. **`mu.Lock()` without `defer mu.Unlock()`.** Early returns or panics leak the lock.
3. **`wg.Add(1)` inside the goroutine instead of before the `go` statement.** Race condition with `wg.Wait`.
4. **Calling out to another package while holding a lock.** That package may try to acquire your lock or one of its own, leading to inversion.
5. **`for { select { ... } }` with no exit case.** Goroutine never terminates, holds resources forever.
6. **Recursive lock acquisition.** Go's `sync.Mutex` is not reentrant — same goroutine relocking blocks.
7. **Using `time.Sleep` to "coordinate" goroutines.** Hides real deadlocks behind sleep timers and masks runtime detection.
8. **Trusting the runtime detector for production.** It only fires on whole-program deadlock; partial deadlocks slip through.
9. **Sending on a channel from inside the receiver's code path.** Especially common in callback-based APIs.
10. **Acquiring two locks "naturally" in opposite orders in two functions.** The lock-inversion classic.

---

## Common Misconceptions

- **"Go has deadlock detection, so deadlocks can't happen in Go."** False. The detector only catches whole-program deadlock. Partial deadlocks in production are common.
- **"Channels prevent deadlock automatically."** False. A channel is a synchronization primitive; misuse it and you deadlock just like with a mutex.
- **"Buffered channels never deadlock on send."** False. They block once the buffer fills.
- **"Read-write locks can't deadlock."** False. `RWMutex` has its own lock-inversion cases, especially around upgrade (which Go does not provide directly, so users implement it badly).
- **"If `go vet` is quiet, I have no deadlocks."** False. `go vet` catches a few specific patterns (copying a `sync.Mutex`, calling `Lock` on a value receiver) but does not analyse lock order.
- **"Adding `time.Sleep` fixes my deadlock."** False. It hides the symptom and prevents the runtime from detecting it.
- **"Recursive functions on a mutex are fine because Go is smart."** False. `sync.Mutex` is not reentrant.

---

## Tricky Points

- The runtime detector considers a goroutine that is in a `time.Sleep` or `runtime.Gosched` loop as **alive**. So a single misplaced sleep can mask whole-program deadlock for the duration of the sleep.
- A goroutine blocked on **network I/O** is considered alive via the netpoller. So a deadlock that includes a goroutine doing `net.Conn.Read` will not trigger the detector even if every other goroutine is parked.
- A goroutine blocked on `cgo` is considered alive — the runtime cannot inspect C code. C calls can mask Go-level deadlocks.
- `panic` inside a deferred `mu.Unlock()` propagates after the unlock; `panic` *before* the deferred unlock still unlocks because `defer` runs during panic unwind. So `defer mu.Unlock()` is panic-safe.
- `sync.Once.Do(f)` can deadlock if `f` itself calls `Do` on the same `Once`. Same-goroutine recursion is enough.

---

## Test

Test your understanding by predicting the behavior of each snippet *before* running:

1. `ch := make(chan int); ch <- 1` — what happens?
2. `ch := make(chan int, 1); ch <- 1; <-ch` — deadlock or not?
3. `var wg sync.WaitGroup; wg.Add(1); wg.Wait()` — deadlock or not?
4. `var mu sync.Mutex; mu.Lock(); mu.Lock()` — deadlock or not?
5. `select {}` — deadlock or not?
6. `select { case <-time.After(time.Second): }` — deadlock or not?

Answers: (1) deadlock, no receiver. (2) no deadlock, capacity-1 buffer absorbs the send. (3) deadlock, counter never decremented. (4) deadlock, non-reentrant. (5) deadlock, no case can ever fire. (6) no deadlock, the timer wakes the goroutine.

---

## Tricky Questions

**Q1.** Why does `select {}` cause a runtime-detected deadlock, but `time.Sleep(time.Hour)` does not?

**A.** `select {}` parks the goroutine forever with no wake-up source. The runtime's `checkdead` sees no live goroutine. `time.Sleep` parks the goroutine but registers a timer; the timer is itself a wake-up source, so the goroutine is considered alive.

**Q2.** A program has 10 goroutines. Two are deadlocked on a mutex pair. The other 8 are happily serving requests. Will the runtime detect the deadlock?

**A.** No. The runtime only fires when *every* goroutine is parked. The 8 live goroutines mask the deadlock. You need `pprof goroutine` or `kill -3` to see it.

**Q3.** Why is `defer mu.Unlock()` panic-safe?

**A.** `defer`-ed calls run during panic unwind. Even if the locked code panics, the deferred `Unlock` executes before the panic propagates further up the stack.

**Q4.** What does `fatal error: all goroutines are asleep - deadlock!` mean exactly?

**A.** The runtime's `checkdead` function ran after a park and found that the number of non-parked goroutines is zero. It concludes no progress is possible and aborts the program with a stack dump.

**Q5.** A goroutine is in state `[chan receive]`. Is it deadlocked?

**A.** Not necessarily. It is *blocked*, not deadlocked. Whether it is deadlocked depends on whether any goroutine will ever send on that channel. If yes, it is just waiting. If no, it is deadlocked.

**Q6.** Two goroutines use mutexes A and B in the same order (A then B). Can they still deadlock?

**A.** Not on those two mutexes by lock inversion. But they can still deadlock through *other* resources — channels, condition variables, or another lock in the chain. Lock ordering only solves the cycle among the locks under ordering.

---

## Cheat Sheet

```
Deadlock: every goroutine in a cycle is waiting for someone in the cycle.

Coffman conditions (all four required):
  1. Mutual exclusion
  2. Hold-and-wait
  3. No preemption
  4. Circular wait

Break ANY one to prevent deadlock.

Go runtime detection:
  fires when ALL goroutines are parked
  prints "fatal error: all goroutines are asleep - deadlock!"
  misses partial deadlocks
  masked by time.Sleep, network I/O, cgo, runtime goroutines

Common Go deadlock shapes:
  - channel send/receive with no counterpart
  - for range over unclosed channel
  - WaitGroup.Wait with missing Done
  - mutex inversion (acquire A then B vs B then A)
  - locking the same non-reentrant mutex twice
  - blocking call while holding a lock

Prevention discipline:
  - defer Unlock immediately after Lock
  - defer wg.Done() first in goroutine body
  - producer always close(ch); consumer for range
  - select on ctx.Done in every blocking op
  - one lock order, documented in package doc
  - never hold a lock across an external call

Diagnosis tools:
  - runtime detector (free, narrow)
  - kill -3 / SIGQUIT (stack dump)
  - net/http/pprof goroutine?debug=2
  - goleak in tests
  - go vet (catches some misuse)
```

---

## Self-Assessment Checklist

- [ ] I can define deadlock precisely and distinguish it from slowness, livelock, and starvation.
- [ ] I can name the four Coffman conditions and recognise them in a code review.
- [ ] I can predict whether `<-ch` will deadlock by looking at the surrounding code.
- [ ] I know why `select {}` triggers the runtime detector and `time.Sleep` does not.
- [ ] I can read `goroutine 7 [chan receive]` from a stack dump and identify the resource.
- [ ] I never write `mu.Lock()` without `defer mu.Unlock()` on the very next line.
- [ ] I always `defer wg.Done()` first inside goroutine bodies.
- [ ] I use `select { case <-ctx.Done(): ... }` on every blocking operation in context-aware code.
- [ ] I can rewrite an inverted-lock program into a single canonical order.
- [ ] I can wrap a concurrent test in a timeout that fails on hang.

---

## Summary

A deadlock is the state where a set of goroutines have entered a wait cycle: each holds something another needs and asks for something held by another. The four Coffman conditions — mutual exclusion, hold-and-wait, no preemption, circular wait — must all hold for any deadlock to exist, and breaking any one prevents it.

Go's runtime contains a cheap, narrow deadlock detector that aborts the program with `fatal error: all goroutines are asleep - deadlock!` when every goroutine is parked. It is invaluable during development but misses partial deadlocks where some goroutines are still alive. Production deadlocks require `pprof goroutine`, `SIGQUIT` stack dumps, and timeouts to surface.

The Go-specific deadlock shapes you will encounter most: unmatched channel sends and receives, `for range` over an unclosed channel, `WaitGroup.Wait` with a missing `Done`, mutex lock-order inversion, and locking the same non-reentrant `sync.Mutex` twice in the same goroutine. Each has a standard fix: producer-closes, `defer wg.Done`, lock ordering, and not recursing into locked code.

The disciplines that prevent most deadlocks before they happen: hold locks for the shortest possible window, never call external code while holding a lock, defer every unlock and every `Done`, select on `ctx.Done` in every blocking operation, document a single global lock order, and test with timeouts.

---

## What You Can Build

- A **deadlock zoo** — a Go package with one function per classic deadlock shape, plus a test for each that demonstrates `fatal error: all goroutines are asleep`.
- A **deadlock playground** — a command-line tool that takes a flag (`--shape=channel|mutex|wg`) and runs the matching deadlock for educational purposes.
- A **lock-order checker** — a script that scans your codebase for `mu.Lock()` calls and reports any path that acquires two locks in inconsistent order. (We extend this at senior level into a proper static-analysis tool.)
- A **test helper** — a small package that wraps `testing.T` with a `RunWithTimeout` helper that fails any test that runs longer than N seconds.
- A **liveness handler** — an HTTP `/healthz/live` handler that reads a heartbeat counter updated by all worker goroutines and fails if any worker has not ticked in N seconds. This catches partial deadlocks in production.

---

## Further Reading

- E. G. Coffman, M. Elphick, A. Shoshani, "System Deadlocks." *Computing Surveys*, June 1971. The original paper.
- "Go Memory Model." https://go.dev/ref/mem — The official document; section on synchronization explains what the runtime guarantees.
- Russ Cox, "Bell Labs and CSP Threads." https://swtch.com/~rsc/thread/ — Background on channels and CSP, which influence how Go thinks about wait cycles.
- "Effective Go: Concurrency." https://go.dev/doc/effective_go#concurrency — Idiomatic Go concurrency patterns.
- Dmitry Vyukov, "Sync Internals." Various conference talks — covers the underlying parking primitives.
- Uber Engineering, "Profiling Go Applications in Production with `goleak`." https://github.com/uber-go/goleak — Test-time goroutine leak detection.

---

## Related Topics

- [02-livelock](../02-livelock/) — Goroutines making progress in name only.
- [03-starvation](../03-starvation/) — Goroutines waiting forever despite the system as a whole making progress.
- [03-sync-package/01-mutex](../../03-sync-package/01-mutex/) — The primitive most often involved in deadlock.
- [03-sync-package/03-waitgroup](../../03-sync-package/03-waitgroup/) — Common `Wait`/`Done` deadlocks.
- [04-context-package](../../04-context-package/) — Cancellation propagation as a deadlock prevention tool.
- [07-goroutine-lifecycle-leaks](../../07-goroutine-lifecycle-leaks/) — Leaks are deadlocks observed indirectly.
- [13-testing-concurrent-code](../../13-testing-concurrent-code/) — Test harnesses for deadlock detection.

---

## Diagrams & Visual Aids

### The four Coffman conditions

```
+--------------------+      +--------------------+
| 1. Mutual          |      | 2. Hold-and-wait   |
|    exclusion       |      |    G holds A, asks |
|    one holder      |      |    for B           |
+--------------------+      +--------------------+
+--------------------+      +--------------------+
| 3. No preemption   |      | 4. Circular wait   |
|    cannot revoke   |      |    G1 -> G2 -> ... |
|    held resource   |      |    -> Gn -> G1     |
+--------------------+      +--------------------+

All four must hold for a deadlock to exist.
Break any one to prevent.
```

### Lock-inversion deadlock

```
Time -->

Goroutine 1:  Lock(A) ............ wait for B forever
                  \                    ^
                   \                  /
                    >--- cycle ------<
                   /                  \
                  v                    \
Goroutine 2:  Lock(B) ............ wait for A forever
```

### Runtime detector flow

```
goroutine parks
      |
      v
checkdead() called
      |
      v
non-parked count == 0?
      |
      +-- no  --> continue
      |
      +-- yes --> fatal error: all goroutines are asleep
                  print stack of every goroutine
                  exit
```

### What the detector misses

```
   [8 alive serving HTTP] <-- detector sees: not zero, OK

   [Goroutine A holds mu1, waits mu2]  +
                                       |  partial deadlock,
   [Goroutine B holds mu2, waits mu1]  +  invisible to runtime
```
