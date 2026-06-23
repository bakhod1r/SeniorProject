---
layout: default
title: Sequential Consistency — Junior
parent: Sequential Consistency
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/03-sequential-consistency/junior/
---

# Sequential Consistency — Junior Level

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
> Focus: "What does it mean for memory operations to be 'sequentially consistent'? Why does the Go documentation say my atomic operations 'happen in some total order'? Why does this matter when I only ever read and write integers?"

When you start writing concurrent Go programs, you discover an uncomfortable truth: two goroutines reading and writing the same variable without synchronisation produce results that no human would predict. You wrote `x = 1` and then `y = 2`, but another goroutine sees `y == 2` while `x == 0`. The compiler reordered them. Or the CPU reordered them. Or the store buffer is hiding `x = 1` from the other core. Suddenly the simple sequence of statements you wrote is not the sequence the program actually executes.

**Sequential consistency** is the strongest, simplest answer to this confusion. A system is sequentially consistent when every memory operation appears to happen one at a time, in some global order, and that order respects the order in which each goroutine wrote its statements. There is no reordering. There are no surprises. What you wrote is what runs.

The catch — and the entire reason this page exists — is that sequential consistency is only *automatic* in Go when your program is **data-race-free**. The Go memory model promises: "if you have no data races, you may reason as if your program runs under sequential consistency." This is the **SC-DRF guarantee** (Sequential Consistency for Data-Race-Free programs), introduced into Go's formal memory model in version 1.19 (August 2022).

After reading this file you will:

- Know what sequential consistency means in plain English and through one canonical litmus test
- Understand the difference between *program order* (what you wrote) and *execution order* (what runs)
- Know what a *data race* is, and why Go's SC promise only applies if you avoid them
- Have used `sync/atomic` to write code that is sequentially consistent without locks
- Recognise the simplest reorderings that break naive concurrent code
- Understand the three layers that can reorder: compiler, CPU, and store buffer
- Know that Go made a deliberate language-design choice in 1.19 to give `sync/atomic` SC semantics — stronger than C/C++

You do not need to know about acquire-release semantics, fences, hardware-specific TSO/PSO/RMO models, or formal happens-before lattices. Those come at middle, senior, and professional levels. This file is about the moment you realise "the order I wrote is not always the order that happens" and the comforting fact that Go gives you a way to *force* the order back.

---

## Prerequisites

- **Required:** Comfort with goroutines — you should have written code with at least one `go func()` and a `sync.WaitGroup`.
- **Required:** Awareness of what a *shared variable* is — a package-level variable, a struct field reachable from two goroutines, or a slice/map captured by closure.
- **Required:** Some exposure to `sync.Mutex.Lock` / `Unlock`. You need not have used `sync/atomic` yet.
- **Helpful:** A vague intuition that modern CPUs are not "one instruction at a time" machines but have pipelines, caches, and store buffers.
- **Helpful:** Some exposure to the term *race condition* or having seen `go run -race` output. Not required.

If you can write a goroutine, share a variable between two goroutines, and have at least once been bitten by "the answer is 99 instead of 100", you are exactly the target audience.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Sequential consistency (SC)** | The model in which all memory operations appear to execute in one global total order that is consistent with the program order of every individual goroutine. Coined by Leslie Lamport in 1979. |
| **Program order** | The order in which a single goroutine's statements appear in source code. Always preserved within one goroutine for observable behaviour. |
| **Execution order** | The order in which memory operations actually take effect at the hardware/runtime level. May differ from program order across goroutines. |
| **Data race** | Two goroutines access the same memory location, at least one access is a write, and neither access is ordered by synchronisation. Programs with data races have undefined behaviour in Go. |
| **SC-DRF** | "Sequential Consistency for Data-Race-Free programs." The guarantee that programs without data races behave as if executed under SC. Go 1.19+ commits to this. |
| **Atomic operation** | A memory access that is indivisible: it cannot be observed half-completed. Provided in Go by the `sync/atomic` package and (transitively) by `sync.Mutex` etc. |
| **`sync/atomic`** | Go's standard library package providing atomic loads, stores, swaps, compare-and-swap, and arithmetic on integer-sized values. As of Go 1.19, these have sequentially-consistent semantics. |
| **Memory model** | The contract between the language/runtime and the programmer specifying which executions of a multi-threaded program are legal. Go's is documented at `https://go.dev/ref/mem`. |
| **Happens-before** | A partial order on memory operations. If event A happens-before event B, then B may observe A's effects. SC is the case where happens-before is total. |
| **Litmus test** | A tiny two-thread program designed to reveal whether a given memory model permits a specific outcome. The store-buffer test is the canonical SC litmus test. |
| **Store buffer** | A hardware queue inside a CPU core where pending writes wait before reaching the cache. Causes a writer's *own* stores to lag behind from another core's perspective. |
| **Reordering** | Any rearrangement of memory operations relative to program order — done by the compiler, the CPU, or the cache. |
| **Fence (memory barrier)** | A hardware instruction that prevents memory operations from being reordered across it. SC is enforced by emitting fences. |
| **Read-modify-write (RMW)** | An operation like compare-and-swap or atomic-add that reads a value, modifies it, and writes back, all indivisibly. |

---

## Core Concepts

### 1. "What you wrote is what runs" — almost

Suppose you write:

```go
var x, y int

func writer() {
    x = 1
    y = 1
}

func reader() {
    fmt.Println(y, x)
}
```

If you start `writer()` and `reader()` as goroutines, you might expect `reader` to print one of:

- `0 0` — reader ran before writer touched anything
- `1 1` — reader ran after writer finished
- `0 1` — reader saw `x=1` but not yet `y=1`
- `1 0` — reader saw `y=1` but not yet `x=1`

The first three feel reasonable. The fourth feels *wrong*: how can `y` be `1` when `x` is still `0`? `writer` wrote `x` before `y`. Yet on real hardware, with no synchronisation, **all four outcomes are possible**. The compiler may reorder. The CPU may reorder. The cache may deliver writes out of order to another core.

Sequential consistency is the model that *forbids* the fourth outcome. Under SC, if `y == 1` was observed, `x == 1` must already have been observed (or be observable). Real CPUs do not provide SC for free — they need fences to guarantee it. The compiler emits those fences when you use synchronisation primitives like `sync.Mutex` or `sync/atomic`.

### 2. The contract: SC-DRF

Go's contract, from the official memory model (paraphrased):

> If your program is free of data races, every execution behaves as if it were run under sequential consistency.

This is **SC-DRF** — Sequential Consistency for Data-Race-Free programs. Note the *if*. The promise does not apply to programs with races. A racy program has *undefined behaviour* — it may produce any output, including impossible ones, and the compiler is free to assume races don't happen during optimisation.

The contract is symmetric: you owe Go race-freedom; Go owes you SC.

How do you achieve race-freedom?
- Use `sync.Mutex` / `sync.RWMutex` for shared mutable state.
- Use channels to communicate ownership.
- Use `sync/atomic` for primitive shared values.
- Use `sync.Once` for one-shot initialisation.
- Confine state to one goroutine.

Each of these establishes *happens-before* edges that order accesses across goroutines, and with no races, the overall execution looks SC.

### 3. The three layers of reordering

There are three places where the program order you wrote can be violated:

1. **Compiler**. The Go compiler may reorder independent statements during optimisation. Without synchronisation, it has no obligation to preserve cross-goroutine ordering.
2. **CPU pipeline**. Modern out-of-order CPUs schedule instructions based on dependencies, not source order. They may execute later instructions while earlier ones wait on memory.
3. **Cache & store buffer**. Each CPU core has a store buffer that holds pending writes. Writes from your core may reach other cores in a different order than they entered the buffer.

A sequentially-consistent operation must defeat *all three* layers. That is why fences are emitted, why atomics are slow on weakly-ordered architectures like ARM, and why SC is a meaningful guarantee.

### 4. The simplest fix: a mutex

The first tool every Go programmer reaches for is `sync.Mutex`. It is enough:

```go
var (
    mu sync.Mutex
    x, y int
)

func writer() {
    mu.Lock()
    x = 1
    y = 1
    mu.Unlock()
}

func reader() {
    mu.Lock()
    fmt.Println(y, x)
    mu.Unlock()
}
```

Now the four possible outputs are `0 0` or `1 1`. The mutex creates a *critical section* and ensures the entire writer block happens-before any reader block that runs after it. The "`1 0`" outcome is impossible.

### 5. The atomic alternative

When you need only one or two shared values and want to avoid the cost (and the contention) of a mutex, `sync/atomic` is the tool. As of Go 1.19, every `sync/atomic` operation has SC semantics:

```go
import "sync/atomic"

var ready atomic.Bool
var data int

func writer() {
    data = 42
    ready.Store(true)
}

func reader() {
    for !ready.Load() {
        runtime.Gosched()
    }
    fmt.Println(data)
}
```

Because `ready.Store(true)` and `ready.Load()` are SC atomics, the writer's prior store to `data` is guaranteed to be observable by the reader once it sees `ready == true`. The reader will print `42`, never `0`. This is the *publication pattern* — and it relies on the SC guarantee for correctness.

Critically: `data` is a plain `int`, not an atomic. That is allowed because the SC atomics on `ready` create the happens-before edge that "publishes" `data`. Without SC atomics, this code would race, and Go's race detector would flag it.

### 6. Atomics give SC, but plain reads/writes do not

This is the most important rule to learn at the junior level:

- A **plain read** of a shared variable from one goroutine and a **plain write** from another, with no synchronisation between them, is a **race**.
- Even if your code "seems to work", it is undefined behaviour.
- Using `sync/atomic` for *both* the read and the write removes the race and gives you SC.
- Using a mutex around both accesses removes the race and gives you SC.

You can never mix: an atomic store on one side and a plain load on the other is still a race.

---

## Real-World Analogies

### The whiteboard meeting

Imagine ten engineers, each with their own private notebook, working in a shared room with a single whiteboard. Sequential consistency is the rule "you may only write or read on the whiteboard, one person at a time, and everyone in the room sees the same whiteboard." If Alice writes "X = 5" and then "Y = 3", and Bob looks up, Bob sees either nothing, just X = 5, or both X = 5 and Y = 3 — never Y = 3 alone.

A non-SC system is one where each engineer has their own *cached copy* of the whiteboard, and a slow courier carries updates between them. From Alice's perspective the updates went in order, but Bob's courier might deliver the Y update before the X update.

Mutexes and SC atomics are the rule: "before you read the whiteboard, dispatch all pending couriers and wait for them to finish." That round-trip cost is the *memory fence*.

### The bank ledger

A bank with one master ledger is sequentially consistent. Every transaction is recorded in a single ordered log, and every teller queries the same log. The order in the log is consistent with the order each teller submitted transactions.

A weakly-consistent bank is one with branch offices that batch transactions overnight. Locally each branch is ordered, but globally a transaction at branch A and a query at branch B may see "impossible" orderings until the batches sync. To get SC you would require every query to wait for all branches to flush — the equivalent of a global fence.

### The flight booking system

When you book a flight on a globally-distributed system, you want SC: if your friend booked seat 14A and the system told them "confirmed", then when you ask "is 14A taken?" the system must say yes. A non-SC system might let your query reach a replica that has not yet seen the booking.

The cost of SC in a distributed system is a network round-trip (consensus). The cost of SC on a CPU is a memory fence (tens of nanoseconds). Different scales, same idea.

---

## Mental Models

### Model 1: The single timeline

Imagine all memory operations from all goroutines collapsed onto **one timeline** by some external referee. The referee may pick any interleaving — but once chosen, every goroutine sees the same timeline. Each goroutine's own operations appear on the timeline in the order it issued them. That is SC.

This model is useful when reasoning about *what could happen*. You enumerate possible interleavings, and SC promises every one is consistent with program order per-goroutine. No "impossible" output.

### Model 2: The shared blackboard

There is one global "memory" (the blackboard). Every operation either writes a value to a slot or reads the current value from a slot. Reads and writes happen instantaneously and atomically. There is no buffering, no caching. SC is just this naive model.

This model is unrealistic for real hardware but is exactly what the Go memory model lets you *pretend* is true — as long as you stay race-free.

### Model 3: Atomics as "publication points"

Every SC atomic store is a *publication*: it says "everything I wrote before this is now visible to anyone who sees this atomic value." Every SC atomic load is a *subscription*: "everything that was published before this load is now visible to me."

The pattern is: write your data, then *publish* with an atomic store; subscribe with an atomic load, then read your data. The atomic itself is just a flag — its real job is creating the happens-before edge.

### Model 4: Reordering as gravity

Imagine compiler and CPU optimisations as a kind of *gravity* pulling instructions out of their original order — toward whatever execution order is fastest. A fence is a *peg* in the ground that prevents instructions from sliding past it. SC atomics insert pegs on both sides; mutexes insert pegs at Lock and Unlock.

Without pegs, your code reorders. With pegs, it stays put.

---

## Pros & Cons

### Pros of relying on SC

- **Simplest possible reasoning**: program order = execution order. You can read your code linearly.
- **Composable**: SC atomics combine cleanly with mutexes and channels. No subtle interaction bugs.
- **Defensive**: even if you over-synchronise, the worst that happens is slight slowdown, not corruption.
- **Tool-friendly**: Go's race detector (`go run -race`) checks the SC-DRF precondition automatically.
- **Portable**: the same Go binary delivers SC on x86 (strongly ordered), ARM (weakly ordered), and RISC-V (weakly ordered) by emitting different fences.
- **Matches developer intuition**: most newcomers assume SC by default. Go meets them where they are.

### Cons (cost & caveats)

- **Performance overhead**: SC atomics require full fences on weakly-ordered hardware, which can be 10–50 ns vs <1 ns for plain loads.
- **Hides hardware reality**: developers can write SC code without understanding when it costs more. On hot paths, mistakes compound.
- **Some lock-free algorithms need weaker orderings** (acquire-release, relaxed) for performance. Go does not expose these directly — you get SC or nothing in `sync/atomic`.
- **Cannot fix racy code**: SC is conditional on race-freedom. A racy program is still undefined.
- **No fine-grained control**: where C++ lets you pick `memory_order_relaxed` for a hot counter, Go does not. This is a deliberate trade-off (simpler model) but costs in rare optimisation cases.

---

## Use Cases

### When SC reasoning saves you

- **Publication patterns**: writer prepares some data, then sets a "ready" flag. Reader spins on flag, then reads data. SC atomics on the flag make this safe.
- **Configuration reloads**: writer atomically swaps a `*Config` pointer; readers atomically load it. Each reader sees a consistent, fully-populated config.
- **One-shot initialisation**: `sync.Once.Do` builds on SC primitives. The first caller's setup is fully visible to all subsequent callers.
- **Stop signals**: a goroutine spinning on `atomic.Bool` for a shutdown flag. When the controller sets it, the worker sees the change *and* sees any state written before it.
- **Counters with read-back**: increment with `atomic.Int64.Add`, read with `Load`. The read sees a consistent total that ordered all prior increments.
- **Lock-free single-producer / single-consumer queues**: indices into a ring buffer can be SC atomics, with the buffer slots themselves protected by the happens-before from the atomic.

### When SC is overkill (but you should still use it as a junior)

- A counter that you write but never read in a way that depends on ordering with other data.
- A statistic where lost updates and stale reads are acceptable.
- A debug log that need not be ordered with program state.

In these cases, C/C++ would let you use `memory_order_relaxed`. Go does not — it gives you SC. For a junior, this is fine: take the SC and move on. The senior page discusses when you might wish for weaker orderings.

---

## Code Examples

### Example 1: The store-buffer litmus test

This is the canonical demonstration that hardware is *not* SC by default.

```go
package main

import (
    "fmt"
    "sync"
)

var (
    x, y     int
    r1, r2   int
)

func main() {
    for i := 0; i < 100000; i++ {
        x, y, r1, r2 = 0, 0, 0, 0
        var wg sync.WaitGroup
        wg.Add(2)
        go func() {
            defer wg.Done()
            x = 1
            r1 = y
        }()
        go func() {
            defer wg.Done()
            y = 1
            r2 = x
        }()
        wg.Wait()
        if r1 == 0 && r2 == 0 {
            fmt.Printf("iter %d: r1=0, r2=0 — non-SC outcome\n", i)
            return
        }
    }
    fmt.Println("no non-SC outcome observed (but program has data races!)")
}
```

This program **has data races** — plain reads and writes from two goroutines. The race detector will flag it. On many machines you will observe `r1 == 0 && r2 == 0`, which is impossible under SC: if both reads saw zero, both writes must have happened "after" both reads, but then the program order within each goroutine is violated.

**The lesson is not that you should write this code.** The lesson is that hardware is happy to violate SC unless you tell it not to. Run with `go run -race` to confirm Go knows this is broken.

### Example 2: Fixing it with SC atomics

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    for i := 0; i < 100000; i++ {
        var x, y atomic.Int32
        var r1, r2 int32
        var wg sync.WaitGroup
        wg.Add(2)
        go func() {
            defer wg.Done()
            x.Store(1)
            r1 = y.Load()
        }()
        go func() {
            defer wg.Done()
            y.Store(1)
            r2 = x.Load()
        }()
        wg.Wait()
        if r1 == 0 && r2 == 0 {
            fmt.Printf("iter %d: r1=0, r2=0 — should NEVER happen under SC\n", i)
            return
        }
    }
    fmt.Println("no SC violation observed — as expected")
}
```

With `sync/atomic`, the `r1 == 0 && r2 == 0` outcome is forbidden by Go 1.19+'s SC guarantee. The fences emitted by atomic ops prevent the CPU from reordering each goroutine's store past its load.

### Example 3: Publication of a struct

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

type Config struct {
    URL     string
    Timeout time.Duration
}

var cfg atomic.Pointer[Config]

func loadInitial() {
    c := &Config{URL: "https://example.com", Timeout: 5 * time.Second}
    cfg.Store(c)
}

func handler(name string) {
    c := cfg.Load()
    if c == nil {
        fmt.Println(name, ": no config yet")
        return
    }
    fmt.Println(name, ":", c.URL, c.Timeout)
}

func main() {
    go loadInitial()
    time.Sleep(10 * time.Millisecond)
    handler("worker-1")
    handler("worker-2")
}
```

`atomic.Pointer[Config]` is added to `sync/atomic` since Go 1.19. The `Store` makes the entire `*Config` and all its fields visible to anyone who later `Load`s it. No mutex needed because we never *mutate* a published config — we swap the whole pointer.

### Example 4: Stop flag

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    var stop atomic.Bool
    var counter int64
    var wg sync.WaitGroup

    wg.Add(1)
    go func() {
        defer wg.Done()
        for !stop.Load() {
            counter++
        }
        fmt.Println("worker exiting; counter =", counter)
    }()

    time.Sleep(100 * time.Millisecond)
    stop.Store(true)
    wg.Wait()
}
```

The worker's `counter++` is safe because *only the worker writes it*. The worker reads `stop` via SC atomic — the writer's `stop.Store(true)` is guaranteed visible promptly. The worker then writes `counter` and prints it after the goroutine ends and `wg.Wait()` returns, so main sees the final value (the wait itself provides a happens-before edge).

### Example 5: Counter with Read

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var counter atomic.Int64
    var wg sync.WaitGroup

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("final:", counter.Load())
}
```

Each `Add` is an SC atomic RMW. The total order across all 1000 increments is well-defined, every increment is visible to every later `Load`, and the final value is always 1000.

### Example 6: One-shot initialisation with atomics

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Service struct {
    Name string
}

var (
    svc     atomic.Pointer[Service]
    initMu  sync.Mutex
)

func get() *Service {
    if s := svc.Load(); s != nil {
        return s
    }
    initMu.Lock()
    defer initMu.Unlock()
    if s := svc.Load(); s != nil {
        return s
    }
    s := &Service{Name: "default"}
    svc.Store(s)
    return s
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(get().Name)
        }()
    }
    wg.Wait()
}
```

The double-checked locking pattern works correctly only with SC atomics. The fast path (first `Load`) avoids the mutex, the slow path takes the mutex and re-checks. The SC guarantee ensures that any reader who sees a non-nil pointer also sees the fully-constructed `*Service`.

### Example 7: Spinning until a value changes

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

func main() {
    var value atomic.Int32
    done := make(chan struct{})

    go func() {
        for {
            v := value.Load()
            if v == 42 {
                close(done)
                return
            }
            time.Sleep(time.Microsecond)
        }
    }()

    time.Sleep(10 * time.Millisecond)
    value.Store(42)
    <-done
    fmt.Println("observed 42")
}
```

The writer stores `42`. The reader sees it. SC ensures the writer's store is eventually visible, and `Load` is the explicit subscription that makes the value cross goroutines safely.

### Example 8: Two-flag handshake

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var a, b atomic.Bool
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        a.Store(true)
        for !b.Load() {
        }
        fmt.Println("goroutine 1 done")
    }()

    go func() {
        defer wg.Done()
        b.Store(true)
        for !a.Load() {
        }
        fmt.Println("goroutine 2 done")
    }()

    wg.Wait()
}
```

Both goroutines store their flag, then spin until they see the other. Under SC this is guaranteed to terminate, because each store is globally observable by the other goroutine. Without SC, on a weakly-ordered system, this could deadlock if stores remained trapped in store buffers indefinitely.

### Example 9: Compare-and-swap as a building block

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var v atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                old := v.Load()
                if v.CompareAndSwap(old, old+1) {
                    return
                }
            }
        }()
    }
    wg.Wait()
    fmt.Println("final:", v.Load())
}
```

CAS is the foundation of lock-free programming. The SC semantics guarantee that every successful CAS is totally ordered with every other RMW on `v` — no two goroutines can both see `old` and both succeed.

### Example 10: When SC saves a subtle bug

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type State struct {
    Step int
    Msg  string
}

var (
    cur atomic.Pointer[State]
)

func publish(s int, m string) {
    cur.Store(&State{Step: s, Msg: m})
}

func observe(name string) {
    if s := cur.Load(); s != nil {
        fmt.Println(name, "saw step", s.Step, ":", s.Msg)
    }
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            publish(i, fmt.Sprintf("hello-%d", i))
        }()
    }
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            observe(fmt.Sprintf("obs-%d", i))
        }(i)
    }
    wg.Wait()
}
```

Every observer that sees a non-nil pointer sees a *fully constructed* `State` with both `Step` and `Msg` populated, never a half-built one. That guarantee comes directly from SC: the writer's allocations and field assignments happen-before its `Store`, and the reader's `Load` sees everything that happens-before the matching store.

---

## Coding Patterns

### Pattern: publish-once

```go
var ptr atomic.Pointer[T]

func init() {
    ptr.Store(buildT())
}
```

A value is published once and never modified. Readers `Load` freely. Safe under SC; no mutex needed.

### Pattern: stop-flag

```go
var stop atomic.Bool

// worker
for !stop.Load() { /* work */ }

// controller
stop.Store(true)
```

Simple cooperative shutdown. The worker sees the flag promptly thanks to SC.

### Pattern: ready-then-data

```go
var ready atomic.Bool
var data Result // plain

// producer
data = compute()
ready.Store(true)

// consumer
for !ready.Load() {}
use(data)
```

The SC store creates the happens-before edge. The consumer sees the fully-written `data` once it sees `ready == true`. Note: only safe if `data` is written exactly once.

### Pattern: atomic counter

```go
var n atomic.Int64

func inc()      { n.Add(1) }
func count() int64 { return n.Load() }
```

Safe under SC. The order of all increments is well-defined, and any `Load` reflects a total order consistent with all increments.

### Pattern: double-checked init

```go
var v atomic.Pointer[T]
var mu sync.Mutex

func get() *T {
    if x := v.Load(); x != nil {
        return x
    }
    mu.Lock()
    defer mu.Unlock()
    if x := v.Load(); x != nil {
        return x
    }
    x := build()
    v.Store(x)
    return x
}
```

The famous "broken" pattern from C/Java pre-2004. In Go, with SC atomics, it works correctly.

---

## Clean Code

- Use `atomic.Bool`, `atomic.Int32`, `atomic.Int64`, `atomic.Uint32`, `atomic.Uint64`, `atomic.Uintptr`, `atomic.Pointer[T]` (introduced 1.19) — not the legacy `atomic.LoadInt32`-style free functions, which are still supported but harder to read.
- Name flag variables for the *condition* they represent: `stopRequested`, `ready`, `initialized` — not `flag1`.
- Group atomics next to the data they protect, with a comment explaining the publication contract.
- Avoid mixing atomic and non-atomic access to the same variable. Pick one and stick with it.
- Keep critical regions short. Even though SC is "free" with atomics, every fence has hardware cost.

```go
// good
type Server struct {
    // stopped is set to true by Stop; checked by the run loop. SC atomic
    // because run-loop and Stop run on different goroutines.
    stopped atomic.Bool

    // requests is updated only on the run loop, read for metrics by Stats.
    requests atomic.Int64
}

// bad
type Server struct {
    stopped bool          // race: written by Stop, read by run loop
    requests int64        // race: incremented on hot path, read by stats
}
```

---

## Product Use / Feature

Sequential consistency is the foundation of most "publication" patterns in production Go services:

- **Configuration hot-reload**: a goroutine watches a file or etcd; on change, builds a new `*Config` and atomically stores it. Every request handler loads the current config atomically. SC guarantees no handler sees a half-built config.
- **Routing table updates**: in a reverse proxy, the routing rules are swapped via `atomic.Pointer[Routes]`. SC ensures every in-flight request sees a coherent table.
- **Feature flags**: a single atomic boolean toggled by an admin endpoint. SC makes the change visible to every goroutine within nanoseconds.
- **Rate-limiter token buckets**: counters incremented and read atomically. SC ensures fairness across goroutines.
- **Service registries**: an `atomic.Pointer[ServiceSet]` swapped on registry refresh. SC guarantees readers see a fully-populated set.

In all these cases, SC is the model the developer reasons in. Without it, the patterns are dangerous; with it, they are routine.

---

## Error Handling

SC concerns *correctness of memory*, not errors. But race-condition bugs masquerading as logic errors are extremely common. Defensive practices:

- Run `go test -race` in CI. The race detector finds violations of the SC-DRF precondition.
- Never silently catch panics in goroutines that might indicate a race. Let them surface during test.
- If you observe an "impossible" value, your first hypothesis should be a data race, not "the CPU is broken."
- When publishing pointers, set fields *before* storing. If you set fields after storing, readers may observe partial state.

```go
// CORRECT
s := &State{A: 1, B: 2}
cur.Store(s)

// WRONG — readers may observe s with B == 0
s := &State{A: 1}
cur.Store(s)
s.B = 2
```

The second form *races* on `s.B`, since multiple goroutines may now access it without synchronisation.

---

## Security Considerations

- **Timing side channels**: SC atomics on x86 are roughly the same speed as plain loads, but on ARM they are notably slower. Code paths that take SC atomics may leak information through timing.
- **Speculative execution**: SC enforces architectural ordering, not micro-architectural ordering. Spectre-style attacks can still observe transient state. SC is not a defence against side-channel leakage.
- **Cryptographic invariants**: constant-time crypto code uses atomics carefully. SC ensures correctness, but constant-time guarantees require additional care (e.g., not branching on secrets).
- **Audit logs**: ordering of log entries across goroutines may matter for forensics. Use SC atomics or channels to provide a defensible order.

For a junior, the takeaway: SC is a memory-model property, not a security property. Don't over-claim what it gives you.

---

## Performance Tips

- **SC atomics are not free**. On x86, an SC store ≈ `xchg` (≈10 ns full fence). On ARM64, an SC store ≈ `stlr` (≈10–30 ns). Plain loads/stores ≈ 0.3–1 ns.
- **Read-heavy code**: SC `Load` is cheap on x86 (just a regular load, since x86 is "almost SC" — it provides TSO). On ARM/RISC-V, it requires a `ldar` or fence.
- **Don't atomic-ify everything**. If a variable is written once at startup and read many times, you may publish it once with SC and then read directly (provided you respect the happens-before edge of program startup).
- **Avoid pointless RMWs**. `atomic.Add(x, 1)` is much more expensive than `Store(Load() + 1)` — but the latter is racy. Decide which you need.
- **Batch updates**: rather than incrementing a shared counter per event, accumulate in a per-goroutine local and flush periodically.
- **False sharing**: two atomics on the same cache line bounce between cores. Pad with `_ [64]byte` between them if they are written by different goroutines.

---

## Best Practices

- Use the new typed API: `atomic.Bool`, `atomic.Int32`, `atomic.Pointer[T]`. Prefer it over loose `atomic.LoadInt32` calls.
- Match every atomic write with an atomic read. Never mix.
- Treat atomics as "publication points" — write the data, then publish.
- Run the race detector on every PR.
- Document the publication contract: "this flag is set by goroutine X and read by goroutines Y, Z. SC publication of state s1, s2."
- Reach for `sync.Mutex` first; reach for `sync/atomic` when the mutex shows up in your profile.
- Avoid spinning on atomics in production. Use channels for inter-goroutine signalling unless you have a measured reason not to.

---

## Edge Cases & Pitfalls

### Pitfall: capturing a plain var by closure

```go
var ready bool
go func() {
    for !ready {
        // spin
    }
    fmt.Println("done")
}()
ready = true
```

This is a data race. The compiler may hoist `!ready` out of the loop ("ready never changes in this loop, so let me just check once and loop forever"). Result: hangs forever. Fix with `atomic.Bool`.

### Pitfall: assuming atomic on small types

`int`, `int8`, even `byte` reads and writes are *not* automatically atomic in Go. On most platforms 64-bit aligned word writes happen to be atomic at the hardware level, but Go's memory model does *not* promise this. Always use `sync/atomic` or `sync.Mutex`.

### Pitfall: misaligned 64-bit atomics on 32-bit platforms

Before Go 1.19, `atomic.AddInt64` on 32-bit ARM required 8-byte alignment. The new typed API (`atomic.Int64`) handles this automatically. Use the typed API.

### Pitfall: thinking SC orders things in real-time

SC does not say "writes are observed immediately." It says "writes appear in *some* global order consistent with program order." A store may take microseconds to propagate to another core. If you need fast-as-possible signalling, channels with select are usually better than polling atomics.

### Pitfall: nil pointer atomics

`atomic.Pointer[T]` defaults to nil. Readers must check. A common bug is forgetting to handle the "not yet stored" case.

### Pitfall: atomic on a struct field that escapes

```go
type S struct { v atomic.Int64 }
func f() S { var s S; s.v.Store(1); return s }
```

Returning by value copies the atomic, which is wrong: the copy is a fresh atomic, unrelated to the original. Pass `*S` or store the atomic inside a heap-allocated value.

---

## Common Mistakes

1. **Plain bool flag**: `for !done { ... }` with `done` set by another goroutine. Always racy.
2. **Mixing atomic and plain access**: storing with `Store` but reading with plain `=`. Race.
3. **Reading the atomic, then a plain field**: works only if the plain field is *also* protected by happens-before from the atomic. Usually the field must be set before the atomic store and never modified afterwards.
4. **Forgetting to align in 32-bit code (pre-1.19 APIs)**: causes panics.
5. **Spinning on an atomic forever**: leaks the goroutine if the producer never updates. Use timeouts or contexts.
6. **Treating `atomic.Bool` as a sync primitive**: it does not block. Use channels for handshakes.
7. **Sharing an atomic by value**: copies break the contract. Use pointers.
8. **Atomic on a struct that itself is large**: only word-sized values are atomic; the struct fields are not.
9. **Assuming SC means real-time visibility**: SC permits any delay; it just constrains *order*.
10. **Atomic types in slices**: `[]atomic.Int64` is fine, but each element is independent; SC does not order across elements automatically.

---

## Common Misconceptions

- **"SC means writes happen instantly."** No. SC means writes appear in a consistent global order, not that they propagate at zero latency.
- **"Atomic operations are always fast."** They are slower than plain ops, by 10–100×, especially on weakly-ordered hardware.
- **"x86 is sequentially consistent."** x86 is TSO (Total Store Order), which is *almost* SC but permits store-load reordering. SC needs an extra fence.
- **"SC is the default in C++."** It is not. C++ defaults to `memory_order_seq_cst` only when you explicitly use `std::atomic` without an order argument. Plain `int` is undefined under races.
- **"Mutexes are slower than atomics."** Often true under low contention; often false under high contention. Measure.
- **"Go atomics give acquire-release semantics."** They give SC, which is *strictly stronger*. You cannot opt down.
- **"SC is too slow for production."** SC atomics power Go's runtime, scheduler, garbage collector, and stdlib. They are production-grade.
- **"If my code passes -race, it is SC."** Race-free *plus* using synchronisation correctly is SC. The race detector verifies the first; reading carefully verifies the second.
- **"`sync.Mutex` is not SC."** It is. Lock and Unlock have SC ordering with respect to all other synchronising operations.
- **"Pointer atomics atomically copy the pointed-to data."** No. They atomically swap the pointer. The data must be immutable after publication.

---

## Tricky Points

- The **store-load reorder** is the trickiest. On x86 (TSO), every other reordering is forbidden by hardware, but store-load is not. SC atomics emit `xchg` or `mfence` to forbid it.
- A **plain load that is racing** is still UB even if you "know" the writer is done. You need synchronisation to establish that fact.
- `sync/atomic.LoadPointer` returns `unsafe.Pointer`. Prefer `atomic.Pointer[T]`.
- Using `atomic.Pointer[T]` with mutable `*T` is dangerous: you must treat `*T` as immutable after publication. Otherwise concurrent mutations race.
- The race detector may miss races that happen only on weak hardware. Run on ARM in CI too.
- `runtime.Gosched()` is *not* a memory barrier. It yields the CPU but does not synchronise memory. Atomics still required.
- `time.Sleep` is *not* a memory barrier. Even a long sleep can leave a write trapped.
- `fmt.Println` from another goroutine *is* a synchronisation point (because it uses a mutex internally), but relying on this is fragile.

---

## Test

```go
package sequential_test

import (
    "sync"
    "sync/atomic"
    "testing"
)

func TestPublishVisible(t *testing.T) {
    var p atomic.Pointer[int]
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        v := 42
        p.Store(&v)
    }()
    wg.Wait()
    if got := p.Load(); got == nil || *got != 42 {
        t.Fatalf("expected 42, got %v", got)
    }
}

func TestCounterFinal(t *testing.T) {
    var n atomic.Int64
    var wg sync.WaitGroup
    const N = 1000
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            n.Add(1)
        }()
    }
    wg.Wait()
    if got := n.Load(); got != N {
        t.Fatalf("expected %d, got %d", N, got)
    }
}

func TestStopFlag(t *testing.T) {
    var stop atomic.Bool
    var observed atomic.Bool
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for !stop.Load() {
        }
        observed.Store(true)
    }()
    stop.Store(true)
    wg.Wait()
    if !observed.Load() {
        t.Fatal("observed never became true")
    }
}
```

Run with `go test -race ./...` and verify no race detector output.

---

## Tricky Questions

**Q: Why does `for !done {}` with a plain `done bool` sometimes hang forever?**
A: The compiler hoists the read out of the loop because no synchronisation tells it the value can change. Use `atomic.Bool`.

**Q: Is `go run -race` enough to prove my code is SC?**
A: It proves your code has no detected data races on the runs you tested. SC then follows by SC-DRF. But the race detector is not exhaustive: it may miss races that occur only under specific schedules.

**Q: Is `sync.Mutex.Lock` sequentially consistent?**
A: Yes. Lock and Unlock are full SC synchronising operations.

**Q: Can I use `atomic.AddInt64` to count things if I never read the counter?**
A: Yes, but it is unnecessarily expensive. If you truly never read it (during the lifetime of the program), why count? If you read at the end (e.g., after `wg.Wait`), the wait itself establishes happens-before, so a plain read after the wait is fine.

**Q: Does Go's GC introduce SC-like ordering?**
A: GC mark/sweep cycles emit fences. But you should not rely on GC for SC; use explicit synchronisation.

**Q: Why does `atomic.Pointer[T]` exist when we have `atomic.LoadPointer`?**
A: Type safety and ergonomics. The generic version forbids accidentally storing a wrong-typed pointer. Use it in new code.

**Q: Does SC apply to channel sends and receives?**
A: Channel operations create happens-before edges per the Go memory model. The combined effect of channels and atomics gives SC for race-free programs.

**Q: Is calling `runtime.GC()` an SC synchronisation point?**
A: It blocks until GC completes, which involves many fences. But the memory model does not formally promise SC ordering around it. Don't use it as a synchronisation primitive.

**Q: What about `time.Sleep`?**
A: Not a synchronisation operation. Sleeping does not flush writes. The goroutine resumes with the same memory state.

**Q: Does `unsafe.Pointer` arithmetic break SC?**
A: It can break the race detector's ability to detect races. SC still applies to operations the runtime can see. Pointer tricks may produce undefined behaviour.

---

## Cheat Sheet

```
SC = "what you wrote happens, in some global order"

Go 1.19+ promise:
  race-free program ⇒ behaves as if executed under SC

Tools:
  sync.Mutex     — heavyweight, blocking
  sync.RWMutex   — multiple readers, one writer
  channels       — communicate by message
  sync/atomic    — single-word lock-free, SC semantics
  sync.Once      — one-shot init, SC visible

Atomic primitives (typed, Go 1.19+):
  atomic.Bool      Load/Store/Swap/CompareAndSwap
  atomic.Int32     +Add
  atomic.Int64     +Add (auto-aligned)
  atomic.Uint32    +Add
  atomic.Uint64    +Add
  atomic.Uintptr   +Add
  atomic.Pointer[T] Load/Store/Swap/CompareAndSwap

Rules:
  - Never mix atomic and plain access to the same var
  - Publish data before the atomic store
  - Treat published data as immutable
  - Run `go test -race`

Costs (rough):
  plain load/store:     ~1 ns
  SC atomic load (x86): ~1 ns (just a load)
  SC atomic store (x86): ~10 ns (xchg-like fence)
  SC atomic on ARM:     ~10–30 ns
```

---

## Self-Assessment Checklist

- [ ] I can define sequential consistency in one sentence
- [ ] I know what "SC-DRF" stands for and what its precondition is
- [ ] I can name the three layers that may reorder memory operations
- [ ] I can write the store-buffer litmus test from memory
- [ ] I know which Go version (1.19) gave SC semantics to `sync/atomic`
- [ ] I can use `atomic.Bool` as a stop flag correctly
- [ ] I can use `atomic.Pointer[T]` to publish a struct
- [ ] I understand the publication pattern (write data, then SC store)
- [ ] I know that `for !done {}` on a plain bool is broken
- [ ] I have run `go test -race` and understood its output
- [ ] I know the difference between SC and "real-time visibility"
- [ ] I know that mixing atomic and plain access to the same variable is a race
- [ ] I can choose between `sync.Mutex` and `sync/atomic` for a given problem

If you can tick all the boxes, you are ready for the middle page, where we look at the memory model formally and compare Go's SC commitment with C/C++ acquire-release and relaxed modes.

---

## Summary

- Sequential consistency means memory operations appear to happen one at a time in some global order that respects each goroutine's program order.
- Go 1.19+ commits to **SC-DRF**: race-free programs behave as if executed under SC.
- This means three layers — compiler, CPU pipeline, store buffer — are forbidden from reordering when you use Go's synchronisation primitives.
- `sync/atomic` (typed API, Go 1.19+) provides SC atomics for `Bool`, `Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr`, `Pointer[T]`.
- The publication pattern (write data, then SC-store an atomic; SC-load the atomic, then read data) is the bread-and-butter use case.
- Mutexes are also SC. Channels create happens-before edges that combine with atomics to give global SC for race-free code.
- The race detector (`go run -race`) verifies the SC-DRF precondition for the executions it observes.
- SC costs nanoseconds on x86 (which is "almost SC" already via TSO) and tens of nanoseconds on ARM/RISC-V.
- For a junior, the rules are simple: use synchronisation, run -race, reason as if SC, and you cannot go wrong.

---

## What You Can Build

- A safe configuration hot-reloader using `atomic.Pointer[*Config]`.
- A graceful shutdown signaller with `atomic.Bool`.
- A lock-free counter for metrics.
- A double-checked initialisation singleton.
- A simple ring buffer with SC indices (single-producer/single-consumer).
- A feature flag system toggled at runtime.
- A request-counter rate limiter.

---

## Further Reading

- Go memory model: `https://go.dev/ref/mem`
- The Go Blog: "Updating the Go memory model" (Russ Cox, 2021)
- Leslie Lamport, "How to Make a Multiprocessor Computer That Correctly Executes Multiprocess Programs" (1979)
- Sarita Adve & Hans-J. Boehm, "Memory Models: A Case for Rethinking Parallel Languages and Hardware" (2010)
- Russ Cox blog series: "Hardware Memory Models", "Programming Language Memory Models", "Updating the Go Memory Model"

---

## Related Topics

- 22-memory-ordering-barriers/01-overview — orientation to memory ordering
- 22-memory-ordering-barriers/02-memory-fences — what fences are and how they work
- 22-memory-ordering-barriers/04-happens-before — the partial-order relation underlying SC
- 13-sync-atomic — the `sync/atomic` package itself
- 19-data-races — what races are and why they break SC
- 20-race-detector — using `-race` in development

---

## Diagrams & Visual Aids

### Store-buffer litmus

```
Goroutine A          Goroutine B
  x = 1                y = 1
  r1 = y               r2 = x

Under SC: forbidden to have r1 == 0 && r2 == 0
Under TSO (raw x86): r1 == 0 && r2 == 0 IS possible
```

### Publication pattern

```
Writer:                Reader:
  data = value           for !ready.Load() {}
  ready.Store(true)      use(data)

          happens-before
data = value ──────────────► use(data) is safe
```

### Three reordering layers

```
   Source code: a = 1; b = 2
        │
        ▼
   Compiler may reorder: b = 2; a = 1
        │
        ▼
   CPU pipeline may reorder loads/stores
        │
        ▼
   Store buffer may delay writes to memory
        │
        ▼
   What other goroutines observe

A fence at each layer enforces SC.
```

### SC vs TSO vs RMO

```
Reordering type      SC      TSO (x86)   RMO (ARM)
load-load            no      no          yes
load-store           no      no          yes
store-store          no      no          yes
store-load           no      yes         yes
```

Go's SC atomics emit whatever fences are needed at each level to defeat all reordering visible to portable programs.

---

## Extended Examples: Walking Through SC Step by Step

The shortest path to grasping SC is to step through a few small programs by hand and ask, for each output, "is this consistent with SC?" Below are ten more worked examples that build intuition from concrete cases.

### Walk-through 1: The simplest two-goroutine handshake

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

var (
    a atomic.Int32
    b atomic.Int32
)

func main() {
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        a.Store(1)
        fmt.Println("g1 saw b =", b.Load())
    }()

    go func() {
        defer wg.Done()
        b.Store(1)
        fmt.Println("g2 saw a =", a.Load())
    }()

    wg.Wait()
}
```

There are exactly four possible *outputs* under SC, ignoring which goroutine prints first:

1. g1 saw b = 0 and g2 saw a = 0 — impossible, because that would require both reads to precede both writes globally, but each goroutine wrote before reading.
2. g1 saw b = 0 and g2 saw a = 1 — possible: g1 ran fully before g2's write.
3. g1 saw b = 1 and g2 saw a = 0 — possible: symmetric.
4. g1 saw b = 1 and g2 saw a = 1 — possible: both writes happened before both reads.

Outcome 1 is the smoking gun. Under a non-SC model (raw x86 TSO), it can happen because each goroutine's store sits in its store buffer while its load completes against memory. SC closes that hole.

### Walk-through 2: Confidence-building counter

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var counter atomic.Int64
    const goroutines = 16
    const incs = 10000

    var wg sync.WaitGroup
    for i := 0; i < goroutines; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < incs; j++ {
                counter.Add(1)
            }
        }()
    }
    wg.Wait()

    expected := int64(goroutines * incs)
    if counter.Load() != expected {
        fmt.Printf("BROKEN: got %d, want %d\n", counter.Load(), expected)
    } else {
        fmt.Println("OK: counter =", counter.Load())
    }
}
```

Each `Add(1)` is an SC read-modify-write. Under SC, all RMWs on `counter` are totally ordered. No update is lost. The final value is always `goroutines * incs`. Run it ten thousand times; it never fails.

Compare to a plain `counter++` (with `counter` as a plain `int64`): you would lose increments and get wildly different totals each run. The race detector would scream.

### Walk-through 3: Slot-by-slot publication

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Slot struct {
    ID    int
    Value string
}

var slots [4]atomic.Pointer[Slot]

func writer(i int) {
    s := &Slot{ID: i, Value: fmt.Sprintf("slot-%d", i)}
    slots[i].Store(s)
}

func reader() {
    for i := 0; i < 4; i++ {
        if s := slots[i].Load(); s != nil {
            fmt.Printf("slot %d: id=%d value=%s\n", i, s.ID, s.Value)
        } else {
            fmt.Printf("slot %d: empty\n", i)
        }
    }
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            writer(i)
        }()
    }
    wg.Wait()
    reader()
}
```

Each slot is independently published. `reader` runs after `wg.Wait()`, so SC + the wait guarantee that all four `Store`s are visible. Every printed slot has a fully-formed `Slot{ID, Value}` — never `ID=0 Value=""` mixed with a `non-nil` pointer.

### Walk-through 4: The "I know it's SC but I still want to test" test

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    const iters = 1_000_000
    var unexpected int

    for k := 0; k < iters; k++ {
        var x, y atomic.Int32
        var r1, r2 int32
        var wg sync.WaitGroup
        wg.Add(2)
        go func() {
            defer wg.Done()
            x.Store(1)
            r1 = y.Load()
        }()
        go func() {
            defer wg.Done()
            y.Store(1)
            r2 = x.Load()
        }()
        wg.Wait()
        if r1 == 0 && r2 == 0 {
            unexpected++
        }
    }
    if unexpected != 0 {
        fmt.Println("SC VIOLATION COUNT:", unexpected)
    } else {
        fmt.Println("No SC violations across", iters, "iterations")
    }
}
```

This empirical test never observes the forbidden outcome. Run it on x86, ARM, RISC-V — the result is identical. If you saw a violation, either you have miscoded or you have found a Go compiler bug worth reporting.

### Walk-through 5: Replacing a mutex with atomics

Before:

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    c.m[k] = v
    c.mu.Unlock()
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}
```

After (copy-on-write):

```go
type Cache struct {
    m atomic.Pointer[map[string]string]
}

func New() *Cache {
    var c Cache
    empty := map[string]string{}
    c.m.Store(&empty)
    return &c
}

func (c *Cache) Set(k, v string) {
    for {
        old := c.m.Load()
        cp := make(map[string]string, len(*old)+1)
        for kk, vv := range *old {
            cp[kk] = vv
        }
        cp[k] = v
        if c.m.CompareAndSwap(old, &cp) {
            return
        }
    }
}

func (c *Cache) Get(k string) string {
    return (*c.m.Load())[k]
}
```

Reads are now lock-free. Writes do more work — they copy the whole map. This is worth it when reads vastly outnumber writes (the typical configuration-cache case). SC ensures that every reader sees either the old map or the new map, never a partially-updated one.

### Walk-through 6: The classic broken singleton

```go
// BROKEN — for educational purposes
package main

import "sync"

type Singleton struct{ Name string }

var (
    instance *Singleton
    mu       sync.Mutex
)

func Get() *Singleton {
    if instance == nil { // racy read
        mu.Lock()
        if instance == nil {
            instance = &Singleton{Name: "the-one"}
        }
        mu.Unlock()
    }
    return instance
}
```

The first `if instance == nil` reads a shared variable without holding the mutex. That is a data race with the `instance = ...` write inside the critical section. SC-DRF therefore does *not* apply — the program is undefined.

Fix with atomic publication:

```go
package main

import (
    "sync"
    "sync/atomic"
)

type Singleton struct{ Name string }

var (
    instance atomic.Pointer[Singleton]
    mu       sync.Mutex
)

func Get() *Singleton {
    if v := instance.Load(); v != nil {
        return v
    }
    mu.Lock()
    defer mu.Unlock()
    if v := instance.Load(); v != nil {
        return v
    }
    v := &Singleton{Name: "the-one"}
    instance.Store(v)
    return v
}
```

Now both reads of `instance` are atomic, the write is atomic, and SC-DRF makes the construction visible to readers who see a non-nil pointer.

### Walk-through 7: Sharing a slice header safely

A common temptation is to publish a slice via atomics:

```go
var data atomic.Pointer[[]int] // pointer to a slice header
```

This works *if* the underlying array is never mutated after publication. The publication contract: build the slice in full (`append`, etc.), then `Store(&s)`. Readers `Load()` and read the elements freely. The SC happens-before ensures the underlying array's writes are visible.

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

var data atomic.Pointer[[]int]

func publish() {
    s := make([]int, 0, 8)
    for i := 0; i < 8; i++ {
        s = append(s, i*i)
    }
    data.Store(&s)
}

func main() {
    publish()
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            if s := data.Load(); s != nil {
                fmt.Println(*s)
            }
        }()
    }
    wg.Wait()
}
```

If you mutate `(*data.Load())[0] = 999` from one goroutine while others read, you race on the array. The atomic only protects the *pointer*, not its target.

### Walk-through 8: Fan-out, fan-in with SC counters

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Stats struct {
    Successes atomic.Int64
    Failures  atomic.Int64
    Total     atomic.Int64
}

func worker(s *Stats, ok bool) {
    s.Total.Add(1)
    if ok {
        s.Successes.Add(1)
    } else {
        s.Failures.Add(1)
    }
}

func main() {
    var s Stats
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            worker(&s, i%3 != 0)
        }()
    }
    wg.Wait()

    fmt.Printf("total=%d ok=%d fail=%d\n",
        s.Total.Load(), s.Successes.Load(), s.Failures.Load())
}
```

Each counter is independently SC. The reads after `Wait()` are race-free because `Wait()` synchronises with each `Done()`. There is no cross-counter invariant the SC model guarantees — for that, you would need a mutex around the trio.

### Walk-through 9: The "ABA" warning

```go
var v atomic.Int64

func tryUpdate() bool {
    old := v.Load()
    // ...some computation...
    return v.CompareAndSwap(old, old+1)
}
```

CAS is SC, but it does not prevent the *ABA* problem: the value might have been A, then B, then A again between your `Load` and your `CompareAndSwap`. SC orders operations; it does not detect intermediate changes. For ABA-prone structures (lock-free queues, stacks), use a version counter or hazard pointers.

This is a senior-level concern, but worth mentioning so juniors don't conflate "SC" with "no ABA."

### Walk-through 10: A common publication mistake fixed

```go
// BROKEN
type Item struct{ Name string }

var current atomic.Pointer[Item]

func setName(s string) {
    if i := current.Load(); i != nil {
        i.Name = s // RACE: mutates published data
    }
}
```

After publication, `*Item` must be immutable. Fix:

```go
// CORRECT
func setName(s string) {
    n := &Item{Name: s}
    current.Store(n)
}
```

Now every reader sees a fully-constructed `*Item` with a stable `Name`.

---

## Deeper Look: What Goes Wrong Without SC

To appreciate SC, look at a small set of bugs that occur *only* when SC is violated.

### Bug class A: stale-read after publish

```go
var ready bool
var data int

go func() {
    data = 42
    ready = true
}()

for !ready {
}
fmt.Println(data) // could print 0
```

Without SC, the writer's `data = 42` might propagate to the reader *after* `ready = true`. The reader exits the loop and prints `0`. This bug is more visible on ARM than on x86, but it is undefined on both because of the race.

### Bug class B: hoist-out-of-loop

```go
var ready bool

go func() {
    for !ready {
    }
    fmt.Println("done")
}()

time.Sleep(time.Millisecond)
ready = true
```

The compiler sees `ready` as a plain variable. It may optimise the loop body to `if !ready { for {} }`. The goroutine hangs forever. SC requires synchronisation on `ready` for the compiler to know it can change concurrently — use `atomic.Bool`.

### Bug class C: word tearing

On 32-bit platforms, writing a 64-bit value might not be atomic at the hardware level. A reader could observe half the old value and half the new. `atomic.Int64` is guaranteed indivisible even on 32-bit.

```go
var n atomic.Int64
n.Store(0x1234567890ABCDEF) // atomic, no tearing
v := n.Load()
```

### Bug class D: write-write reorder

```go
var a, b int

go func() {
    a = 1
    b = 2
}()

go func() {
    if b == 2 && a == 0 {
        // could happen under reorder
    }
}()
```

The compiler may reorder `a = 1` and `b = 2` (they are independent). The second goroutine could observe `b = 2 && a = 0`. SC forbids this. Use `atomic.Int32` for both, or a mutex.

### Bug class E: silent failure

```go
var done bool
var result []byte

go func() {
    result = compute()
    done = true
}()

for !done {
}
process(result) // result may be nil!
```

The reader sees `done = true` but the writer's `result = compute()` may not yet be visible. `process(nil)` panics later, and the developer blames `compute`, not the memory model.

Each of these bugs is *eliminated* by using SC primitives correctly.

---

## Extended Coding Patterns

### Pattern: SC-publication of a configuration tree

```go
type DB struct{ DSN string }
type API struct{ Token string }
type Config struct {
    DB  DB
    API API
}

var cfg atomic.Pointer[Config]

func reload(c *Config) {
    cfg.Store(c)
}

func handler() {
    c := cfg.Load()
    if c == nil {
        return
    }
    use(c.DB.DSN, c.API.Token)
}
```

The entire deeply-nested config is published atomically. No partial structure is observable.

### Pattern: SC-counter with periodic snapshot

```go
type Metric struct {
    counter atomic.Int64
}

func (m *Metric) Inc()         { m.counter.Add(1) }
func (m *Metric) Snapshot() int64 { return m.counter.Load() }
func (m *Metric) Reset() int64  { return m.counter.Swap(0) }
```

`Swap` atomically reads the old value and stores zero. The reset is SC: any concurrent `Inc` is ordered before or after the `Swap`, never split across it.

### Pattern: SC-debounced flag

```go
type Latch struct{ done atomic.Bool }

func (l *Latch) Signal() { l.done.Store(true) }
func (l *Latch) Wait() {
    for !l.done.Load() {
        runtime.Gosched()
    }
}
```

A simple busy-wait latch. Use channels in production for blocking; use this in low-level code where avoiding a channel is justified.

### Pattern: SC-driven epoch counter

```go
type Epoch struct{ n atomic.Int64 }

func (e *Epoch) Bump() int64    { return e.n.Add(1) }
func (e *Epoch) Current() int64 { return e.n.Load() }
```

Each `Bump` returns the new value, totally ordered with every other Bump. Useful for cache invalidation versioning.

### Pattern: SC ring-index for SPSC queue

```go
type SPSC[T any] struct {
    buf  []T
    head atomic.Int64 // producer-only writes
    tail atomic.Int64 // consumer-only writes
}

func (q *SPSC[T]) Push(v T) bool {
    h := q.head.Load()
    t := q.tail.Load()
    if h-t == int64(len(q.buf)) {
        return false
    }
    q.buf[h%int64(len(q.buf))] = v
    q.head.Store(h + 1)
    return true
}

func (q *SPSC[T]) Pop() (T, bool) {
    var zero T
    h := q.head.Load()
    t := q.tail.Load()
    if h == t {
        return zero, false
    }
    v := q.buf[t%int64(len(q.buf))]
    q.tail.Store(t + 1)
    return v, true
}
```

Single-producer/single-consumer ring. The SC stores publish slot writes; SC loads see them. Avoid this in real code unless you have measured contention — channels are usually faster end-to-end.

---

## Even More Mental Models

### Model 5: The serialised database transaction log

Think of memory as a database. Every read/write is a transaction. SC is the *serialisable* isolation level: every concurrent execution is equivalent to some serial execution. The total order is the transaction log.

### Model 6: The single-server pretend

Imagine that *all* memory operations from *all* goroutines are RPCs to a single hypothetical server. The server processes them one at a time. Your code "sees" memory through this server. SC is exactly this. Real implementations approximate it efficiently with caches and fences.

### Model 7: The contract negotiation

Without SC, every shared-memory access requires reading the manual to decide if a reorder is permitted. With SC, the contract is one line: "everything happens in some order consistent with what each goroutine wrote." You stop reading the manual and start writing code.

---

## More Pros & Cons

### When SC really helps (concrete scenarios)

- **Onboarding new engineers**: SC matches intuition; weaker models do not.
- **Code review**: reviewers don't need to verify fence placement.
- **Tooling**: race detector + SC-DRF gives precise semantics.
- **Debugging**: state observable in a debugger is consistent with SC; you don't have to "imagine" a weaker model.

### When SC is a small tax

- High-frequency counters in hot loops.
- Cache hierarchies where false sharing is dominated by the fence overhead.
- Single-thread code that accidentally uses atomics for type reasons.

For a junior, never trade away SC. The tiny perf gain is not worth the correctness risk.

---

## Beyond Atomics: Other SC-Providing Primitives

### `sync.Once.Do`

```go
var once sync.Once
var x int

once.Do(func() { x = 42 })
// after Do returns, x = 42 is visible to all callers
```

`Do` provides SC: the function runs at most once, and its writes are observable to every caller after the first.

### Channels

```go
ch := make(chan int, 1)
go func() {
    data = 42
    ch <- 1
}()
<-ch
fmt.Println(data) // safe: receive happens-after send
```

A channel send/receive pair establishes happens-before. Combined with atomics and mutexes, this gives full SC for race-free programs.

### `sync.WaitGroup`

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    data = 42
}()
wg.Wait()
fmt.Println(data) // safe
```

`Wait` synchronises with `Done`. Reads after `Wait` see writes before `Done`.

### `context.Context` cancellation

A canceled context's `Done()` channel is closed, which is a synchronising send. Goroutines selecting on it see the cancellation, ordered with prior writes.

### `time.AfterFunc`

The function fires from a separate goroutine; the call to `Stop` synchronises with the function's start. Useful as an SC-ordered timer.

---

## Performance Tips, In Depth

- **Read-mostly state**: prefer `atomic.Pointer[T]` over `sync.RWMutex`. Reads are zero-cost on x86 and one fence on ARM, vs the mutex's atomic operations + queue management.
- **Hot increments**: if you must, prefer `atomic.Int64.Add` over `mu.Lock; counter++; mu.Unlock`. But also consider per-goroutine counters that periodically flush.
- **Cache-line alignment**: heavy atomics on adjacent fields share a cache line and bounce. Add `_ [64]byte` padding.
- **`Load` vs `Swap`**: `Swap` is RMW (full fence). `Load` is cheaper on x86. Pick the lightest operation that does the job.
- **`CompareAndSwap` loops**: each iteration costs a fence. Limit retries; back off on contention.
- **`StorePointer` cost**: about the same as `StoreInt64`. The fence dominates the cost.
- **Don't pre-optimise**: write SC code first, measure, then optimise.

---

## More Best Practices

- Document publication contracts in code comments.
- Encapsulate atomics behind methods. Don't expose them across packages.
- Group related atomics in a struct so cache-line layout is explicit.
- Use the typed API (`atomic.Bool`, etc.), not the legacy free functions.
- Treat `atomic.Pointer[T]` data as immutable post-publication.
- Test under `-race`. CI must fail on race output.

---

## More Edge Cases

- **`unsafe.Pointer` casts**: bypass type safety. The atomic still works, but you must reason about the layout manually.
- **Interface values**: an interface is two words (type, data). `atomic.Pointer[any]` is *not* a single-word atomic; it stores a pointer to an interface, not the interface itself.
- **Closures capturing atomics**: capture by value copies the atomic, which breaks the contract. Always capture by pointer.
- **Atomics inside maps**: `map[string]*atomic.Int64` works; `map[string]atomic.Int64` does not — map values are copied on assignment.
- **Atomics on stack**: fine, but escape analysis often moves them to heap, and you should let it.

---

## More Common Mistakes

11. Using `atomic.LoadInt64(&x)` where `x` is a plain `int64`. Compiles but is a race with any non-atomic writer of `x`.
12. `defer atomic.StoreBool(&done, true)` — `done` is plain, not atomic. Use `atomic.Bool` and `done.Store(true)`.
13. Inspecting an `atomic.Pointer` field with `==` against another `atomic.Pointer` field. Compare the *values* via `Load`.
14. Using `atomic.Value` (untyped, deprecated for most uses) where `atomic.Pointer[T]` would be clearer.
15. Calling `Store` on a method receiver that is a value (not a pointer). The store updates a copy.

---

## More Common Misconceptions

- **"SC == linearisability."** They are related. SC is per-process program-order preserving; linearisability adds real-time ordering. Go gives SC, not linearisability.
- **"Atomic loads always block."** No — they are non-blocking. They may stall on cache misses, but they never queue or sleep.
- **"All operations on `int` are atomic by accident."** Word-aligned word-sized loads/stores are atomic at the hardware level on most platforms, but Go's *memory model* does not promise this. Use `sync/atomic`.
- **"Volatile in C is the same as atomic in Go."** No. `volatile` in C forbids compiler reordering but says nothing about memory model ordering across threads. C's `_Atomic` (or `std::atomic` in C++) is the closer analogue.

---

## More Tricky Points

- The Go runtime itself relies on SC atomics for its scheduler. Disabling SC at the runtime level would break Go.
- `runtime.SetFinalizer` runs the finalizer on a separate goroutine. Its execution is ordered after the GC sees the object as unreachable. SC + GC create a hidden synchronisation point.
- `os/signal` handlers run on a dedicated goroutine. Their writes to shared state need SC just like any other goroutine.
- `sync.Map` provides amortised lock-free reads using SC atomics internally. Its API is type-erased; prefer typed sharded maps for clarity.
- `sync.Cond` does not provide SC by itself; it provides what its associated mutex provides.

---

## More Test Scaffolding

```go
package sequential_test

import (
    "sync"
    "sync/atomic"
    "testing"
)

func TestPublicationOrder(t *testing.T) {
    type Box struct{ N int }
    var p atomic.Pointer[Box]

    var wg sync.WaitGroup
    for i := 1; i <= 100; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            p.Store(&Box{N: i})
        }()
    }
    wg.Wait()
    if b := p.Load(); b == nil || b.N < 1 || b.N > 100 {
        t.Fatalf("expected 1..100, got %v", b)
    }
}

func TestStopVisible(t *testing.T) {
    var stop atomic.Bool
    var seen atomic.Bool
    go func() {
        for !stop.Load() {
        }
        seen.Store(true)
    }()
    stop.Store(true)
    for !seen.Load() {
    }
}

func TestRMWConsistency(t *testing.T) {
    var v atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                old := v.Load()
                if v.CompareAndSwap(old, old+1) {
                    return
                }
            }
        }()
    }
    wg.Wait()
    if v.Load() != 100 {
        t.Fatalf("expected 100, got %d", v.Load())
    }
}
```

---

## More Tricky Questions

**Q: Why does `sync.Once.Do(f)` provide SC?**
A: It uses an atomic flag internally. The first caller atomically claims the right to run `f`; subsequent callers see the flag and skip. SC ensures `f`'s writes are visible to every caller after `Do` returns.

**Q: Can I unlock a mutex from a different goroutine than the one that locked it?**
A: Technically yes (Go does not enforce ownership), but it is fragile. The unlock's SC ordering is with respect to the next lock, regardless of which goroutine.

**Q: Is `close(ch)` an SC operation?**
A: Yes. A close is a send-like synchronisation; receives observing the closed state are happens-after.

**Q: Does the Go scheduler reorder atomics across goroutines?**
A: The scheduler picks which goroutine runs when. It does not reorder operations *within* a goroutine. Atomics enforce ordering across goroutines regardless.

**Q: If I have one writer and one reader on the same `atomic.Int64`, do I need SC?**
A: SC is what you get. It is strictly correct. You cannot opt for weaker in Go.

**Q: What is the cost of `atomic.Bool.Store(true)` on x86?**
A: Approximately one `xchg` instruction, roughly 10 ns including the fence effect.

**Q: Why doesn't Go expose `memory_order_relaxed`?**
A: To keep the model simple and to prevent misuse. The Go team weighed the cost (some hot paths slightly slower) against the benefit (a smaller surface for bugs) and chose the simpler model.

**Q: Does SC guarantee a particular schedule?**
A: No. SC constrains the *set of legal executions*, not which one occurs.

**Q: Are pointer comparisons SC?**
A: Plain `p1 == p2` reads two pointers. If either is shared and racing, you have a race. Use `Load` for atomic reads.

---

## Larger Cheat Sheet

```
DECLARE                       USE
var f atomic.Bool             f.Load(), f.Store(true), f.Swap(b), f.CompareAndSwap(o,n)
var n atomic.Int64            n.Load(), n.Store(v), n.Add(d), n.Swap(v), n.CompareAndSwap(o,n)
var u atomic.Uint64           same as Int64 but unsigned
var p atomic.Pointer[T]       p.Load() returns *T; p.Store(*T); p.Swap; p.CompareAndSwap

WHEN TO REACH FOR EACH
sync.Mutex / RWMutex          shared mutable state, multi-line critical sections
channel                       message passing, signalling, ownership transfer
sync/atomic                   single-word state, flags, counters, pointer publication
sync.Once                     one-shot init
sync.WaitGroup                wait for N goroutines

GOLDEN RULES (race-free implies SC):
  1. Don't mix atomic and plain access to a variable
  2. Don't mutate published data
  3. Always run `go test -race`
  4. Don't spin-loop forever; back off or block

CAUTIOUS RULES:
  - Channels for blocking signals
  - Atomics for fast flags
  - Mutex when in doubt
```

---

## Extended Self-Assessment Checklist

- [ ] I can explain SC-DRF to a colleague in under one minute
- [ ] I have written a publication pattern with `atomic.Pointer[T]`
- [ ] I have observed a non-SC outcome under `-race` and understood why
- [ ] I know that 32-bit platforms historically needed alignment for 64-bit atomics
- [ ] I have replaced an `RWMutex` with copy-on-write atomic publication for a read-mostly map
- [ ] I know the names of the four reorderings (LL, LS, SS, SL) and which ones x86 permits
- [ ] I have used `sync.Once` and recognised its SC publication property
- [ ] I have used `WaitGroup.Wait` as a synchronisation point
- [ ] I avoid `time.Sleep` as a synchronisation primitive

---

## Wider Summary

Sequential consistency is the property that the program behaves as if there is one global timeline of memory operations, and each goroutine's portion of that timeline matches the order it wrote. Go 1.19+ delivers SC for race-free programs, with `sync/atomic` operations providing SC semantics across all supported architectures.

For a junior, the practical implications:

- Use `sync/atomic` (typed API) for flags, counters, and pointer publication.
- Use `sync.Mutex` for multi-step critical regions.
- Use channels for messaging.
- Run `go test -race` regularly.
- Treat published pointer targets as immutable.
- Don't mix atomic and plain access.

Once these habits are in place, SC is something you mostly stop thinking about — it just *works*. The next page goes a level deeper: comparing Go's SC commitment with C/C++'s opt-in `memory_order_seq_cst`, examining acquire-release semantics, and looking at where SC actually costs you in real workloads.

---

## More on What You Can Build

- **Lock-free metric aggregator** for a high-throughput service.
- **Atomic feature-flag manager** with sub-microsecond toggle.
- **Copy-on-write configuration store** for a reverse proxy.
- **Generation counter** for cache invalidation.
- **Single-producer/single-consumer pipeline stage**.
- **Latch-style one-shot barrier**.
- **Stop-the-world publication of routing tables**.
- **Atomic snapshot of a sharded counter array**.

---

## Extra Further Reading

- The original Lamport 1979 paper is short and readable: "How to Make a Multiprocessor Computer That Correctly Executes Multiprocess Programs."
- Russ Cox's blog "Hardware Memory Models" (2021) is the best informal introduction to TSO/SC/relaxed.
- The C/C++ standards on `memory_order_seq_cst` are illuminating for the contrast.
- Java's `volatile` (JSR-133) is a sibling design.

---

## Wider Related Topics

- 22-memory-ordering-barriers/01-overview, 02-memory-fences, 04-happens-before
- 13-sync-atomic — the package itself
- 14-channels — the alternative to atomics for inter-goroutine communication
- 19-data-races, 20-race-detector — the SC-DRF precondition
- 11-mutex, 12-rwmutex — heavier-weight synchronisation

---

## More Diagrams

### Publication timeline

```
Time ──────────────────────────────────────────────────►

Writer:    data=42 ──── ready.Store(true)
                          │
                          │ happens-before
                          ▼
Reader:                ready.Load()==true ──── use(data)
```

### What a fence does

```
Without fence:
  store x = 1   │ may reorder
  store y = 1   │
  load  z       │

With SC fence between stores:
  store x = 1
  ─── FENCE ───
  store y = 1   ← cannot move above the fence

With SC fence around all stores:
  ─── FENCE ───
  store x = 1
  ─── FENCE ───
  store y = 1
  ─── FENCE ───
```

### Race vs SC behaviour

```
RACY CODE                       SC-DRF CODE (with atomics)
─────────                       ─────────
g1: data = 42                   g1: data = 42
    ready = true                    ready.Store(true)
g2: if ready { use(data) }      g2: if ready.Load() { use(data) }

undefined (compiler/HW free)    use(data) sees 42
```

---

## Appendix A: Step-by-Step Disassembly of an Atomic Store

To make SC concrete, consider what `atomic.Bool.Store(true)` actually emits at the machine level.

On x86-64, Go's compiler emits something like:

```
MOVB $1, AX
XCHGB AX, runtime.flag(SB)
```

`XCHG` with a memory operand has an implicit `LOCK` prefix on x86, which acts as a full memory barrier. The fence prevents store-load reordering (the only reorder x86 allows). After the XCHG, the store is visible to all other cores.

On ARM64, Go emits:

```
MOVW $1, R0
STLRB R0, [runtime.flag]
```

`STLR` is a store-release with sequentially-consistent semantics in ARMv8.3+. The instruction prevents any prior load/store from being reordered past it and prevents any subsequent load from being reordered before it (release semantics), and with paired LDAR forms a full SC ordering.

On RISC-V, Go uses an `amoswap.w` with `aqrl` (acquire and release) flags, providing SC.

The exact instructions vary by architecture and Go version, but the contract — SC — is constant across platforms.

---

## Appendix B: Why `atomic.Value` Is Less Useful in 1.19+

Before Go 1.19, `sync/atomic` offered only untyped operations (`LoadInt32`, etc.) and `sync/atomic.Value` for arbitrary `interface{}` storage. `Value` is awkward:

- Stored values must all be the same concrete type.
- Type assertions are needed on every Load.
- It allocates because of interface boxing.

With Go 1.19's typed `atomic.Pointer[T]`, you get type safety, no allocation, and equally strong (SC) guarantees:

```go
// old, awkward
var v atomic.Value
v.Store(&Config{...})
c := v.Load().(*Config)

// new, clean
var p atomic.Pointer[Config]
p.Store(&Config{...})
c := p.Load()
```

For new code, prefer `atomic.Pointer[T]`. Keep `atomic.Value` in mind only for legacy code or genuinely heterogeneous types (rare).

---

## Appendix C: SC vs Mutex — A Decision Table

| Scenario | Mutex | Atomic |
|----------|-------|--------|
| Multi-step critical section | yes | no |
| Single counter | overkill | yes |
| Single boolean flag | overkill | yes |
| Pointer publication | possible but awkward | yes (Pointer[T]) |
| Map access | yes (RWMutex) | only via COW |
| Long-running operation | yes | no — blocks scheduler? |
| One-shot init | sync.Once (uses atomics) | DCLP with atomics |
| Shutdown signal | yes | yes (cleaner with atomic.Bool) |
| Configurable config reload | possible | yes (atomic.Pointer) |

When in doubt, use a mutex. It is safer, easier to reason about, and only slightly more expensive in the common case.

---

## Appendix D: SC in Standard Library Patterns

Look at how the standard library uses SC primitives. A few examples worth studying:

- `net/http.Server.Shutdown`: uses an atomic flag + mutex for the listener set.
- `context.cancelCtx.cancel`: uses atomic on its done channel and mutex on children list.
- `runtime/proc.go`: scheduler uses atomic word ops throughout.
- `sync.Once`: SC atomic on its `done` field plus a mutex for the slow path.
- `sync.Pool`: SC atomics on its sharded local pools.

Reading the standard library's use of atomics is the best continuing education.

---

## Appendix E: Common Beginner Code, Annotated

```go
// BAD
var ready bool
go func() {
    setup()
    ready = true // race: ready is plain
}()
for !ready {
}
use()
```

```go
// GOOD
var ready atomic.Bool
go func() {
    setup()
    ready.Store(true) // SC publication
}()
for !ready.Load() {
}
use()
```

```go
// BAD
var count int
go inc(&count)
go inc(&count)
// final count unknown
```

```go
// GOOD
var count atomic.Int64
go func() { count.Add(1) }()
go func() { count.Add(1) }()
// final count is 2
```

```go
// BAD
type Cache struct {
    data *Data // updated by reload; read by handlers
}
```

```go
// GOOD
type Cache struct {
    data atomic.Pointer[Data]
}
```

---

## Appendix F: The Mental Model in Code

A small exercise: re-implement a "barrier" using only SC atomics.

```go
package main

import (
    "runtime"
    "sync"
    "sync/atomic"
)

type Barrier struct {
    n       int64
    waiting atomic.Int64
    epoch   atomic.Int64
}

func New(n int64) *Barrier {
    return &Barrier{n: n}
}

func (b *Barrier) Wait() {
    e := b.epoch.Load()
    if b.waiting.Add(1) == b.n {
        b.waiting.Store(0)
        b.epoch.Add(1)
        return
    }
    for b.epoch.Load() == e {
        runtime.Gosched()
    }
}

func main() {
    b := New(4)
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            b.Wait()
        }()
    }
    wg.Wait()
}
```

This is *educational only* — Go has better tools (`sync.WaitGroup`, channels) for this job. But it illustrates that SC atomics are powerful enough to build higher-level primitives from scratch.

---

## Appendix G: A FAQ from Real Codebases

**"My counter is off by a few — is the SC promise wrong?"**
No. Either you have a race somewhere (use `-race`) or you are reading the counter mid-update from another goroutine. SC guarantees order, not real-time accuracy.

**"I see different output on x86 and ARM."**
Almost certainly a race. SC eliminates this — if SC-DRF holds, both platforms produce the same set of legal executions.

**"My code 'works in dev but fails in prod.'"**
Different schedules expose different interleavings. Test under `-race` and stress-test with `-cpu=1,2,4,8`.

**"Should I worry about SC at all if I never use sync/atomic?"**
You still get SC from mutexes, channels, and WaitGroups. The Go memory model gives SC-DRF regardless of which primitive you use, as long as you use *some* synchronisation.

**"Is `atomic.Bool{}` zero-initialised to false?"**
Yes. Go's zero values apply.

**"Can I copy an `atomic.Int64`?"**
No. The `noCopy` static check warns; runtime behaviour is undefined.

**"What if my hardware is exotic?"**
The Go compiler emits architecture-specific fences. Supported architectures (x86, ARM, ARM64, RISC-V, MIPS, PowerPC, s390x, wasm) all give SC via `sync/atomic`.

---

## Appendix H: The Full Picture

```
       ┌────────────────────────────────────────────┐
       │           Your Go program                  │
       │  (uses sync.Mutex, channels, sync/atomic)  │
       └──────────────────────┬─────────────────────┘
                              │
                ┌─────────────▼──────────────┐
                │     Go memory model        │
                │   SC-DRF for race-free     │
                └─────────────┬──────────────┘
                              │
                  ┌───────────▼────────────┐
                  │  Compiler: emits       │
                  │  fences as needed      │
                  └───────────┬────────────┘
                              │
                ┌─────────────▼─────────────┐
                │   Architecture            │
                │   x86 / ARM / RISC-V      │
                └───────────────────────────┘
```

Your code → memory model → compiler → hardware. SC is the *contract* between the first two layers. The lower layers cooperate to make it true.

---

## Appendix I: A Glossary Extension

| Term | Definition |
|------|-----------|
| **Linearisability** | Stronger than SC: every operation appears to take effect at some instant between its invocation and response, and that order is consistent with real-time. SC requires only program-order consistency. |
| **Causal consistency** | Weaker than SC: only causally-related operations are ordered. SC orders *all* operations. |
| **Eventual consistency** | Even weaker: reads converge to the most-recent write *eventually*, with no order guarantees in the meantime. Useful in distributed systems, not in shared-memory programming. |
| **Release / Acquire** | Pair: a release-store on a flag makes prior writes visible to any acquire-load that observes the flag. SC implies release+acquire on all atomics. |
| **TSO (Total Store Order)** | x86's hardware model: all reorderings forbidden *except* store-load. Almost SC. |
| **PSO (Partial Store Order)** | Older SPARC model permitting store-store reorder too. |
| **RMO (Relaxed Memory Order)** | ARM/RISC-V model permitting all four reorderings absent fences. |
| **Memory barrier (fence)** | An instruction that prevents reorderings of a specified kind across it. Examples: `mfence` (x86 full), `dmb ish` (ARM full), `fence rw,rw` (RISC-V full). |
| **Speculative execution** | A CPU optimisation where instructions are executed before they are committed. Speculation can re-order architectural state. SC constrains *committed* state, not speculation. |
| **Cache coherence** | The hardware guarantee that all cores eventually agree on each memory location's value. Coherence ≠ consistency. |

---

## Appendix J: Practice Problems

1. Write a program with two goroutines, each storing to a different `atomic.Int32` and reading the other. Show that, across one million iterations, `r1 == 0 && r2 == 0` never occurs.
2. Re-write the program with plain `int32` (no atomic) and observe — under `go run -race` — that the program is racy.
3. Implement a stop flag with `atomic.Bool` and a worker that exits within 100 µs of the flag being set. Measure the latency.
4. Implement a copy-on-write `*Config` publication pattern. Verify that no reader sees a partial config across 10 000 reloads.
5. Write a single-producer/single-consumer ring buffer using only SC atomics. Compare throughput against a buffered channel.
6. Use `atomic.Pointer[T]` to implement a generation counter. Bump the generation; verify every reader either sees the old or the new, never something in between.
7. Implement a lock-free counter and stress-test it from 64 goroutines. Verify the final value.
8. Replace one `sync.RWMutex`-protected read-mostly map in your codebase with copy-on-write. Measure read latency before and after.
9. Use `atomic.Bool` as a one-shot latch: set once, observable forever. Verify that 100 waiters all proceed.
10. Implement `Once` using `atomic.Int32` and a mutex. Verify the function runs exactly once.

---

## Final Words

The most important takeaway for a junior: *you do not need to memorise the rules of SC*. You need to memorise the *primitives that give it to you* — `sync.Mutex`, `sync/atomic`, channels, `WaitGroup`, `Once` — and the discipline that earns it: race-freedom.

Run the race detector. Use the typed atomic API. Treat published data as immutable. Read the standard library's use of atomics. Build a few of the patterns above. Then move on to the middle page, which will look at the same material with a different lens: how does Go's SC commitment compare with C/C++'s opt-in seq-cst, and where does it cost us?

---

## Appendix K: A Long Tour of Worked Concurrent Snippets

The following snippets are deliberately small but each illustrates a single SC concept. Read each, predict the output, then run it. The act of predicting reinforces the model.

### Snippet 1: stop signalling

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    var stop atomic.Bool
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for !stop.Load() {
            time.Sleep(time.Millisecond)
        }
        fmt.Println("stopped")
    }()
    time.Sleep(20 * time.Millisecond)
    stop.Store(true)
    wg.Wait()
}
```

Expected: `stopped` within roughly 20 ms.

### Snippet 2: a tiny generation counter

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var gen atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            gen.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("final generation:", gen.Load())
}
```

Expected: `final generation: 100`.

### Snippet 3: a single-shot publication

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Config struct{ N int }

func main() {
    var cfg atomic.Pointer[Config]
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        cfg.Store(&Config{N: 42})
    }()
    wg.Wait()
    if c := cfg.Load(); c != nil {
        fmt.Println("N =", c.N)
    }
}
```

Expected: `N = 42`.

### Snippet 4: writer-reader handshake

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var ready atomic.Bool
    var data int
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        data = 7
        ready.Store(true)
    }()

    go func() {
        defer wg.Done()
        for !ready.Load() {
        }
        fmt.Println("data =", data)
    }()

    wg.Wait()
}
```

Expected: `data = 7`.

### Snippet 5: copy-on-write list

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

var list atomic.Pointer[[]int]

func append1(x int) {
    for {
        old := list.Load()
        var oldS []int
        if old != nil {
            oldS = *old
        }
        ns := make([]int, len(oldS)+1)
        copy(ns, oldS)
        ns[len(oldS)] = x
        if list.CompareAndSwap(old, &ns) {
            return
        }
    }
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            append1(i)
        }()
    }
    wg.Wait()
    fmt.Println(*list.Load())
}
```

Expected: all ten values present, order unspecified.

### Snippet 6: latch as one-bit barrier

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Latch struct{ done atomic.Bool }

func (l *Latch) Signal() { l.done.Store(true) }
func (l *Latch) Wait() {
    for !l.done.Load() {
    }
}

func main() {
    var l Latch
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            l.Wait()
            fmt.Println("waiter", i, "released")
        }()
    }
    l.Signal()
    wg.Wait()
}
```

Expected: all five waiters print.

### Snippet 7: SC across map of atomics

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var m sync.Map
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            v, _ := m.LoadOrStore(i, &atomic.Int64{})
            v.(*atomic.Int64).Add(1)
        }()
    }
    wg.Wait()

    m.Range(func(k, v any) bool {
        fmt.Println(k, "=", v.(*atomic.Int64).Load())
        return true
    })
}
```

Expected: each key once, value 1.

### Snippet 8: bounded retry CAS

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var v atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for retries := 0; retries < 1000; retries++ {
                old := v.Load()
                if v.CompareAndSwap(old, old+1) {
                    return
                }
            }
        }()
    }
    wg.Wait()
    fmt.Println(v.Load())
}
```

Expected: 100. CAS retries are bounded by contention; in practice each iteration succeeds quickly.

### Snippet 9: epoch-based wait

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
)

type Epoch struct{ n atomic.Int64 }

func (e *Epoch) Wait(target int64) {
    for e.n.Load() < target {
        runtime.Gosched()
    }
}

func main() {
    var e Epoch
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        e.Wait(5)
        fmt.Println("released")
    }()
    for i := 0; i < 5; i++ {
        e.n.Add(1)
    }
    wg.Wait()
}
```

Expected: `released`.

### Snippet 10: publish-and-immutable

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type State struct {
    Generation int
    Data       []byte
}

var current atomic.Pointer[State]

func update(g int) {
    n := &State{Generation: g, Data: make([]byte, g)}
    for i := range n.Data {
        n.Data[i] = byte(i)
    }
    current.Store(n)
}

func observe() {
    if s := current.Load(); s != nil {
        fmt.Printf("gen=%d len=%d\n", s.Generation, len(s.Data))
    }
}

func main() {
    var wg sync.WaitGroup
    for i := 1; i <= 5; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            update(i)
        }()
    }
    wg.Wait()
    observe()
}
```

Expected: one `gen=X len=X` line, where X is whichever update was last per the SC order.

Each snippet is a tiny SC pattern. Together they cover the full surface a junior Go developer needs.

---

## Appendix L: The Rule Book (One Page)

1. Use `sync/atomic` typed API for shared scalars and pointers.
2. Use `sync.Mutex` for multi-line critical sections.
3. Use channels for communication and synchronisation between goroutines.
4. Treat data behind a published `atomic.Pointer` as immutable.
5. Never mix atomic and plain access to the same variable.
6. Run `go test -race` regularly.
7. Document the publication contract.
8. Pad to cache lines if you measure false sharing.
9. Don't pre-optimise — SC is fast enough for almost all code.
10. When in doubt, use a mutex.

These ten rules cover 99% of junior-level concurrent Go. The middle, senior, and professional pages refine the rest.



