---
layout: default
title: Channels vs Mutexes — Junior
parent: Channels vs Mutexes
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/junior/
---

# Channels vs Mutexes — Junior

[← Back](../)

## Table of contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The proverb in plain English](#the-proverb-in-plain-english)
5. [What problem are we solving](#what-problem-are-we-solving)
6. [A data race, demonstrated](#a-data-race-demonstrated)
7. [Fixing the race with sync.Mutex](#fixing-the-race-with-syncmutex)
8. [Fixing the same race with a channel](#fixing-the-same-race-with-a-channel)
9. [Ownership transfer vs shared access](#ownership-transfer-vs-shared-access)
10. [When a channel feels right](#when-a-channel-feels-right)
11. [When a mutex feels right](#when-a-mutex-feels-right)
12. [Five small runnable examples](#five-small-runnable-examples)
13. [The race detector — your first tool](#the-race-detector--your-first-tool)
14. [Three rules of thumb](#three-rules-of-thumb)
15. [Common mistakes at this level](#common-mistakes-at-this-level)
16. [Misconceptions to unlearn](#misconceptions-to-unlearn)
17. [Mental models](#mental-models)
18. [Tricky points](#tricky-points)
19. [Cheat sheet](#cheat-sheet)
20. [Self-assessment checklist](#self-assessment-checklist)
21. [Summary](#summary)
22. [Further reading](#further-reading)

---

## Introduction
You have written a Go program that spawns goroutines and now two of them touch the same variable. The compiler doesn't warn you. The program prints the right answer most of the time. Then, once every thousand runs, it prints garbage — or crashes with `fatal error: concurrent map writes`. Welcome to data races.

Go gives you two main tools to coordinate goroutines: **channels** (`chan T`) and **mutexes** (`sync.Mutex`). Both can fix a race. Both can be misused. Beginners often hear the famous Go proverb — "do not communicate by sharing memory; share memory by communicating" — and conclude that channels are right and mutexes are wrong. That is not what the proverb means, and it's not how production Go is written.

This file teaches you the two primitives from first principles. By the end you will:
1. Recognise a data race by sight and produce one to feel the bug.
2. Fix it with `sync.Mutex` in a few lines.
3. Fix the same problem with a channel and feel the trade-off.
4. Know which to reach for in three categories of problem (counter, pipeline, signal).
5. Run the race detector and read its output.

---

## Prerequisites
You should already know:
- Declaring goroutines with `go funcName()`.
- Closing a `func main()` and the fact that goroutines die with the program.
- Reading and writing struct fields and map entries.
- Basic `sync.WaitGroup` for "wait for everyone to finish".
- `go run main.go` and `go test`.

You do *not* need to know:
- `select` (touched briefly, mastered in `middle.md`).
- `sync.Cond`, `sync.Once`, `sync.Pool` (not in this file).
- The Go memory model formal text (covered in `specification.md`).

---

## Glossary
- **Goroutine.** A lightweight thread managed by the Go runtime, started with `go fn()`.
- **Data race.** Two goroutines accessing the same memory location without synchronisation, at least one writing. Undefined behaviour.
- **Race condition.** A logic bug where the program's correctness depends on the order in which goroutines run. A data race is one kind of race condition; you can have race conditions without data races (e.g. two correctly-locked goroutines drawing the wrong conclusion about ordering).
- **Critical section.** Code that must run with exclusive access to some shared state. The classic "between Lock and Unlock" region.
- **Channel.** A typed FIFO queue with built-in synchronisation. `chan T` for bidirectional, `chan<- T` send-only, `<-chan T` receive-only.
- **Unbuffered channel.** Capacity 0. Sender waits until a receiver is ready; receiver waits until a sender is ready. The send and receive happen at the same instant.
- **Buffered channel.** Capacity > 0. Sender can queue values up to the capacity before blocking.
- **Mutex.** Mutual-exclusion lock. `sync.Mutex.Lock()` blocks until the mutex is free; `Unlock()` releases it.
- **Ownership (informal).** A value has an owner if exactly one goroutine has the right to read and write it at any moment. Ownership can transfer (via channel) but never be co-held without synchronisation.

---

## The proverb in plain English
"Do not communicate by sharing memory; share memory by communicating."

It means: when two goroutines need to cooperate, the cleaner default is to *pass the data from one to the other through a channel*, rather than letting both poke at the same in-place memory under a lock. The shared memory is still memory — but it's accessed through a synchronisation primitive that *also* communicates intent: "here is a value for you".

The proverb is a preference, not a rule. The Go standard library uses `sync.Mutex` everywhere. The Go runtime uses `sync.Mutex` everywhere — including inside the implementation of channels. You will use both.

---

## What problem are we solving
Two goroutines write to a shared counter:

```go
var n int

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            n++
        }()
    }
    wg.Wait()
    fmt.Println(n)
}
```

You might expect `1000`. You'll get something between `~700` and `1000`, varying run to run. Why? Because `n++` is not one machine instruction — it's three: load `n` into a register, add 1, store back. Two goroutines can load `n=42`, both compute `43`, both store `43`. One increment lost.

This is a data race. Go's specification says behaviour is undefined when one happens. In practice you'll see wrong counts; in theory the compiler is free to do worse (it isn't required to make races merely "produce the wrong number" — it's allowed to crash, hang, or corrupt unrelated state).

---

## A data race, demonstrated
Save the program above as `race_demo.go` and run it with the race detector:

```bash
go run -race race_demo.go
```

You will see a report like this (abbreviated):

```
WARNING: DATA RACE
Write at 0x00c00001a000 by goroutine 7:
  main.main.func1()
      /path/race_demo.go:11 +0x30

Previous write at 0x00c00001a000 by goroutine 6:
  main.main.func1()
      /path/race_demo.go:11 +0x30

Goroutine 7 (running) created at:
  main.main()
      /path/race_demo.go:9 +0x90
```

The race detector instruments every memory access at run time and pairs it with happens-before edges from channel ops and lock ops. If two accesses are unordered and at least one is a write, it tells you exactly where.

**Always run your tests with `-race` during development.** It catches bugs you cannot reproduce manually.

---

## Fixing the race with sync.Mutex

```go
var (
    mu sync.Mutex
    n  int
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            n++
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println(n)
}
```

Output: `1000`, every time. The `mu.Lock()` blocks all but one goroutine inside the critical section. The `n++` is now atomic from the perspective of every other goroutine — no one else can interleave.

Pattern points:
- Declare the mutex *next to* the data it protects. Don't put `mu` in `main` and `n` in another file — group them in the same struct or block, so the relationship is visible.
- Always `Unlock` what you `Lock`. The idiomatic pattern is `mu.Lock(); defer mu.Unlock()` at the top of the function or block.
- The zero value of `sync.Mutex` is "unlocked". You never need `mu := sync.Mutex{}`.
- A locked mutex is *not* tied to a goroutine. Goroutine A can `Lock` and goroutine B can `Unlock`. Don't do this casually, but the spec allows it.

The same pattern wrapped in a type:

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func (c *Counter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

Important: the methods take `*Counter`, not `Counter`. A copied `Counter` has a copied (and useless) mutex. `go vet` will warn you (`copylocks`) — listen to it.

---

## Fixing the same race with a channel

```go
func main() {
    inc := make(chan int)       // increments come in here
    done := make(chan int)      // final value comes back here

    go func() {
        n := 0
        for delta := range inc {
            n += delta
        }
        done <- n
    }()

    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            inc <- 1
        }()
    }
    wg.Wait()
    close(inc)
    fmt.Println(<-done)
}
```

Same output, `1000`, every time — but a completely different structure. The counter is owned by one goroutine. Everyone else *talks* to that goroutine through `inc`. When all senders are done, we close `inc`; the owner's `range` exits; the owner sends the final value on `done`.

Compare:

| Mutex version | Channel version |
|---|---|
| Counter sits in shared memory | Counter sits inside one goroutine |
| Every caller `Lock`s and `Unlock`s | Every caller sends on a channel |
| One critical section | One owner goroutine |
| Race possible if someone forgets to `Lock` | Race impossible — nobody else reads `n` |

Two observations a beginner often misses:

1. The channel version is **longer** (10+ extra lines) and slower (each send/receive crosses the scheduler). For a counter, the mutex is the better choice.
2. The channel version is *self-documenting*: there is exactly one place the counter is mutated. New code added to the program cannot accidentally touch `n` because there is no `n` to touch — it lives in the closure of one goroutine.

For a simple counter we ship the mutex. The channel was an exercise to see the shape. Now we'll see problems where the channel is the better default.

---

## Ownership transfer vs shared access
The core distinction: **does the data move from one goroutine to another, or do many goroutines work on the same in-place data?**

If the answer is "one goroutine produced a value, hands it off, never touches it again" — that's *ownership transfer*. The natural primitive is a channel: send the value, the receiver now owns it.

If the answer is "many goroutines need to read/update this single piece of state in place" — that's *shared access*. The natural primitive is a mutex (or atomic, or `RWMutex`): all goroutines see the same memory, the mutex serialises who touches it.

Examples of ownership transfer:
- A goroutine reads a file line by line and sends each line to another goroutine that parses it.
- A worker takes a job from a queue, processes it, sends the result back.
- A subscription generator produces events from an external feed.

Examples of shared access:
- A counter incremented by many handlers.
- A cache mapping `url → cached response` consulted by every request.
- A configuration struct read on every request and updated occasionally.

Most real programs have both.

---

## When a channel feels right
You'll know it's a channel when:
- The data flows in one direction (producer → consumer).
- The sender doesn't care about the value after sending.
- You want a built-in way to *signal* completion (close the channel).
- You want cancellation via `select` (introduced properly in `middle.md`).
- The number of producers and consumers is small and stable.

Examples:
- **Pipeline.** Stage A produces, Stage B consumes A's output and produces for Stage C.
- **Worker pool.** N workers `range` over a `jobs` channel; one goroutine sends jobs.
- **Signal of "done".** `done := make(chan struct{}); close(done)` — every receiver sees the close.

```go
jobs := make(chan Job, 64)
results := make(chan Result, 64)

for i := 0; i < 8; i++ {
    go func() {
        for j := range jobs {
            results <- process(j)
        }
    }()
}

go func() {
    for _, j := range allJobs {
        jobs <- j
    }
    close(jobs)
}()

for r := range results {
    fmt.Println(r)
}
```

(This example needs more glue to know when to close `results` — covered in `middle.md`.)

---

## When a mutex feels right
You'll know it's a mutex when:
- The data is *shared in place* (a map, a struct field, a slice).
- Many goroutines read it; some write it.
- The critical section is small (a map lookup, an increment, a few assignments).
- You don't need to *signal* anything — just protect against concurrent access.

Examples:
- **Counter.** Many goroutines increment one counter.
- **Cache.** Many goroutines look up and add entries in a `map[string][]byte`.
- **Connection list.** A server holds `map[connID]*Conn`; handlers add and remove entries.

```go
type ConnTable struct {
    mu    sync.Mutex
    conns map[string]*Conn
}

func (t *ConnTable) Add(id string, c *Conn) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.conns[id] = c
}

func (t *ConnTable) Remove(id string) {
    t.mu.Lock()
    defer t.mu.Unlock()
    delete(t.conns, id)
}

func (t *ConnTable) Get(id string) (*Conn, bool) {
    t.mu.Lock()
    defer t.mu.Unlock()
    c, ok := t.conns[id]
    return c, ok
}
```

Notice we did *not* return the `*Conn` and let the caller modify the table — we keep operations inside the type. This is the basic shape of a thread-safe wrapper.

---

## Five small runnable examples
Each example is under 50 lines, runnable as a single file, and shows one decision.

### Example 1 — Counter, the mutex way

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock(); defer c.mu.Unlock()
    c.n++
}
func (c *Counter) Value() int {
    c.mu.Lock(); defer c.mu.Unlock()
    return c.n
}

func main() {
    c := &Counter{}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); c.Inc() }()
    }
    wg.Wait()
    fmt.Println(c.Value())
}
```

Run with `go run -race main.go`. No race. Output: `100`.

### Example 2 — Producer/consumer, the channel way

```go
package main

import "fmt"

func main() {
    nums := make(chan int)

    go func() {
        for i := 1; i <= 5; i++ {
            nums <- i * i
        }
        close(nums)
    }()

    for v := range nums {
        fmt.Println(v)
    }
}
```

The sender closes when it's done. The receiver's `range` exits when the channel is closed. Output: `1 4 9 16 25`.

### Example 3 — Signal "done" by closing a channel

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func worker(id int, done <-chan struct{}, wg *sync.WaitGroup) {
    defer wg.Done()
    for {
        select {
        case <-done:
            fmt.Println("worker", id, "stopping")
            return
        default:
            // do work
            time.Sleep(10 * time.Millisecond)
        }
    }
}

func main() {
    done := make(chan struct{})
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go worker(i, done, &wg)
    }

    time.Sleep(50 * time.Millisecond)
    close(done)          // tell everyone to stop
    wg.Wait()
}
```

Closing a channel is the canonical "fan-out signal": every receiver sees the close.

### Example 4 — Mutex around a map

```go
package main

import (
    "fmt"
    "sync"
)

type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func NewCache() *Cache { return &Cache{m: map[string]string{}} }

func (c *Cache) Set(k, v string) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.m[k] = v
}
func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock(); defer c.mu.Unlock()
    v, ok := c.m[k]
    return v, ok
}

func main() {
    c := NewCache()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            c.Set(fmt.Sprintf("k%d", i), "v")
        }(i)
    }
    wg.Wait()
    v, ok := c.Get("k42")
    fmt.Println(v, ok)
}
```

This is the simplest concurrent-safe map. We'll see better variants (sharded, `sync.Map`, `sync.RWMutex`) in `middle.md` and `optimize.md`.

### Example 5 — Worker pool

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int)
    results := make(chan int)

    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- j * j
            }
        }()
    }

    go func() {
        for i := 1; i <= 10; i++ {
            jobs <- i
        }
        close(jobs)
    }()

    go func() {
        wg.Wait()
        close(results)
    }()

    for r := range results {
        fmt.Println(r)
    }
}
```

Note the closing protocol: producer closes `jobs`; workers exit; a small goroutine `wg.Wait()`s and closes `results`. This is the canonical Go worker pool shape — practise it until it's automatic.

---

## The race detector — your first tool
Run every Go program at least once under `-race` during development:

```bash
go run -race main.go
go test -race ./...
go build -race ./...
```

The race detector:
- Adds ~5–10x CPU overhead and ~10x memory overhead. Not for production.
- Reports actual races observed at run time. It does *not* find races that didn't execute.
- Costs nothing to enable in tests — `make test` should always use `-race`.

Read every race report end to end. The "Write at" and "Previous write at" addresses tell you the variable; the goroutine creation backtraces tell you who's racing. The fix is almost always to add a mutex or move the data behind a channel.

---

## Three rules of thumb
1. **Default to a mutex around shared in-place state.** It's small, fast, well-understood. Reach for it first; refactor to a channel only if the shape clearly fits.
2. **Default to a channel for handoff and signalling.** Worker pools, pipelines, cancellation — channels first.
3. **Always run `-race` in tests.** This is non-negotiable. Race bugs are the worst class of bug Go can produce; the detector turns them from "happens in production" into "compiler errors".

---

## Common mistakes at this level
1. **Copying a struct that contains a mutex.** `go vet` catches most cases; pay attention to it.
2. **Forgetting to `Unlock`.** Always `defer mu.Unlock()` immediately after `mu.Lock()`.
3. **Locking the wrong mutex.** A `Counter` value with an embedded `Mutex` and methods taking `(c Counter)` — each call locks its own copy, the underlying state stays unprotected.
4. **Returning data from under the lock.** Returning a pointer to a struct field, then mutating it without the lock, is a race.
5. **Not closing a channel.** A `range` over an unclosed channel hangs forever. The owner of the send side closes.
6. **Closing a channel from the receive side.** This is backwards. The receiver does not own the close.
7. **Sending on a closed channel.** Panic. The owner of the close is also the last sender.
8. **Reading a map without protection.** Go's runtime *detects* concurrent map writes specifically and crashes the process with `fatal error: concurrent map writes`. Don't rely on it — wrap maps in a mutex (or use `sync.Map`).
9. **Using a channel for everything.** Reflexively wrapping `int` in `chan int` to "be Go-idiomatic" produces slow, allocation-heavy code. Match the primitive to the shape.
10. **Skipping the race detector in CI.** A bug a developer cannot reproduce locally will eventually corrupt production data. Always `go test -race`.

---

## Misconceptions to unlearn
- "Channels are always faster." No. For a counter, a mutex is 10x faster than a channel and an atomic is 50x faster.
- "Mutexes are bad style." No. The Go stdlib and the Go runtime use mutexes extensively.
- "Closing a channel is a way to tell senders to stop." No. Senders are not notified of close — they will *panic* on the next send. Use a separate `done` channel or `context.Context`.
- "Buffered channels prevent deadlocks." No. They postpone them. If consumers stop, the buffer fills, and senders block.
- "The race detector finds all races." No. It finds races that *happened* during the run. Coverage matters.
- "`sync.Mutex` is OK, but `sync.RWMutex` is always better for read-mostly code." No. `RWMutex` has more bookkeeping; for short critical sections (a counter, a map lookup of a small key) plain `Mutex` is faster.

---

## Mental models
**Picture a mutex as a baton.** Only one goroutine can hold the baton at a time. The data the baton "covers" is on a table, in plain sight. Everyone walks up to the table; only the baton-holder may touch the data.

**Picture a channel as a conveyor belt.** A goroutine places a package on the belt. Another goroutine, somewhere down the line, picks the package off the belt. Once on the belt, the sender forgets about the package; once off the belt, the receiver owns it. No two goroutines ever hold the same package at the same time.

**Picture an atomic as a vending machine.** The hardware itself enforces "only one user at a time" — the operation is one instruction that the CPU guarantees is undividable. No explicit lock, no explicit channel; the CPU does the bookkeeping.

These three pictures cover most everyday Go concurrency.

---

## Tricky points
- A `nil` channel **blocks forever** on send and receive. That's not a bug — it's used to "disable" cases in a `select`. We'll lean on this in `middle.md`.
- A `closed` channel **returns the zero value** on receive, immediately, forever, alongside `ok == false`. You can use this as a one-shot signal.
- `sync.Mutex` has **no `TryLock` by default** before Go 1.18. From 1.18 there is `TryLock`, but it's documented as "specialized" — if you find yourself using it casually, you probably want a different primitive.
- `defer mu.Unlock()` runs at function return — *not* at end of scope. If you `Lock` inside a loop, `defer Unlock()` does not release until the function returns. Either `Unlock` explicitly or extract the loop body into a function.

---

## Cheat sheet

| Problem | First reach | Reason |
|---|---|---|
| Counter incremented from many goroutines | `sync.Mutex` (or `sync/atomic` later) | Shared in-place state |
| Map with concurrent reads + writes | `sync.Mutex` around the map | Shared in-place state |
| Producer / consumer pipeline | `chan T` | Handoff |
| Worker pool consuming jobs | `chan Job` + `sync.WaitGroup` | Handoff + completion |
| Fan-out "stop" signal | `close(done)` on a `chan struct{}` | Broadcast signal |
| Wait for several goroutines to finish | `sync.WaitGroup` | Counted completion |

---

## Self-assessment checklist
- [ ] I can describe a data race in one sentence and produce one in code.
- [ ] I can run my tests with `-race` and read a race report.
- [ ] I can fix a counter race with `sync.Mutex` in five lines.
- [ ] I can fix the same race with a channel and explain the trade-off.
- [ ] I can articulate when to reach for a mutex vs a channel.
- [ ] I close channels from the sender side, never from the receiver.
- [ ] I know the zero value of `sync.Mutex` is "unlocked".
- [ ] I do not copy structs that contain a mutex.
- [ ] I do not send on a closed channel.
- [ ] I always `defer mu.Unlock()` immediately after `mu.Lock()`.

---

## Summary
Channels and mutexes solve the same broad problem — coordinating goroutines — but with different shapes. Mutexes guard *shared in-place state*; channels carry *values from one goroutine to another*. The Go proverb tilts the default toward channels for newcomers because the alternative (every problem is a `sync.Mutex` nail) leads to worse code on average. But the proverb is a tilt, not a ban. The Go standard library is full of mutexes for good reason.

At this stage, the priorities are:
1. Stop writing data races. Use the race detector relentlessly.
2. Default to mutexes for in-place state and channels for handoff.
3. Run lots of small examples and feel the difference.

In `middle.md` we'll meet the patterns that combine them — pipelines, worker pools, semaphores, reply channels, `RWMutex`, `sync.Map` — and start measuring performance.

---

## Further reading
- Go memory model: https://go.dev/ref/mem
- Effective Go — Concurrency: https://go.dev/doc/effective_go#concurrency
- The Go Blog — "Share memory by communicating": https://go.dev/blog/codelab-share
- The Go Blog — "Go Concurrency Patterns": https://go.dev/blog/pipelines
- `src/sync/mutex.go` (open it in your editor — it's short and readable)

---

[← Back](../)
