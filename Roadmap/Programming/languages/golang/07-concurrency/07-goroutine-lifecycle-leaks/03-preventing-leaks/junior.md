# Preventing Goroutine Leaks — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Five Leak Patterns and Their Canonical Fixes](#the-five-leak-patterns-and-their-canonical-fixes)
6. [The Owner Rule](#the-owner-rule)
7. [Every Goroutine Has an Exit Story](#every-goroutine-has-an-exit-story)
8. [Context Propagation Basics](#context-propagation-basics)
9. [Real-World Analogies](#real-world-analogies)
10. [Mental Models](#mental-models)
11. [Pros & Cons](#pros-cons)
12. [Use Cases](#use-cases)
13. [Code Examples](#code-examples)
14. [Coding Patterns](#coding-patterns)
15. [Clean Code](#clean-code)
16. [Error Handling](#error-handling)
17. [Performance Tips](#performance-tips)
18. [Best Practices](#best-practices)
19. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
20. [Common Mistakes](#common-mistakes)
21. [Common Misconceptions](#common-misconceptions)
22. [Tricky Points](#tricky-points)
23. [Test](#test)
24. [Tricky Questions](#tricky-questions)
25. [Cheat Sheet](#cheat-sheet)
26. [Self-Assessment Checklist](#self-assessment-checklist)
27. [Summary](#summary)
28. [What You Can Build](#what-you-can-build)
29. [Further Reading](#further-reading)
30. [Related Topics](#related-topics)
31. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction

> Focus: "How do I write goroutines that always finish? Which patterns leak, and what is the canonical fix for each?"

A goroutine leak is the failure to give a goroutine a way out. The goroutine started, did some work, and then got stuck — usually parked on a channel operation that no one will ever satisfy — and now it sits in memory forever, holding whatever it was holding when it stopped. The previous section, [02-detecting-leaks](../02-detecting-leaks/), taught you to see leaks in `pprof` and `runtime.NumGoroutine`. This one is about not creating them in the first place.

Preventing leaks is mostly mechanical. There are roughly five shapes the bug takes, and each one has a canonical fix that takes one or two lines of code. The hard part is not knowing the fix — it is making sure that *every* goroutine in the codebase has been given the treatment. That requires a small set of habits:

1. Before you write `go f()`, decide who **owns** the goroutine and how it will stop.
2. Pass `context.Context` to every long-running goroutine.
3. Buffer channels by exactly the amount needed for senders to escape.
4. Close channels exactly once, from the sender side, and never from a receiver.
5. Pair every `time.Ticker` or `time.Timer` with a `Stop` in `defer`.

After reading this file you will:

- Recognise the five canonical leak shapes at a glance
- Know the one-line fix for each
- Apply the owner rule to decide who stops what
- Wire `context.Context` through any chain of goroutines
- Write a goroutine whose exit is articulated in its first ten lines, not in a comment

You do not need to know `errgroup`, the Start/Stop struct, library design rules, or goleak yet. Those come at the middle and senior levels. This file is about the moment between thinking "I need a goroutine" and writing `go f()`.

---

## Prerequisites

- **Required:** Read [01-goroutines/01-overview/junior.md](../../01-goroutines/01-overview/junior.md). You know what `go f()` does.
- **Required:** Read [01-lifecycle](../01-lifecycle/) and [02-detecting-leaks](../02-detecting-leaks/). You can recognise a leak in `pprof`.
- **Required:** Comfort with `chan T`, `select`, `close`, and `for range chan`.
- **Required:** Familiarity with `context.Context`, in particular `context.WithCancel` and `<-ctx.Done()`.
- **Helpful:** Some experience with `sync.WaitGroup` and `time.Ticker`.

If you can write a producer-consumer pair with channels and you have ever called `cancel()` to stop a HTTP request, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Goroutine leak** | A goroutine that has started but has no path back to exit. It sits in `_Gwaiting` or a stuck loop forever, holding its stack and any references on it. |
| **Owner** | The single goroutine (or struct) responsible for telling another goroutine to stop. Every goroutine has exactly one owner. |
| **Exit story** | The named, written-down answer to "how does this goroutine know to stop, and what does it do when it sees the signal?" |
| **Cancellation signal** | A value or close of a channel that tells a goroutine to begin its shutdown. Typically `<-ctx.Done()`. |
| **Unbuffered channel** | `make(chan T)`. A send blocks until a receive matches it. |
| **Buffered channel** | `make(chan T, n)`. A send blocks only when the buffer is full. |
| **`context.Context`** | The standard library's cancellation, deadline, and value propagation type. Threaded through every long-running goroutine. |
| **`select` with `default`** | A non-blocking poll. Useful, but a `for { select { default: } }` loop without a cancellation case is a busy-wait that leaks CPU and stack space. |
| **Ticker** | A `time.Ticker` produces events on a channel at a fixed rate. Must be stopped with `Stop()` or the goroutine driving it leaks. |
| **Graceful shutdown** | The procedure for stopping a service: signal all goroutines to wind down, wait for them to finish, then exit. |
| **goleak** | A test helper (`go.uber.org/goleak`) that fails a test if goroutines remain alive at the end. The CI gatekeeper for preventing leaks. |
| **`errgroup`** | `golang.org/x/sync/errgroup`. A `WaitGroup` that also collects the first error and cancels a derived context. Covered at middle level. |

---

## Core Concepts

### A leak is the absence of a stop signal

Every goroutine that runs forever in a bug is, mechanically, blocked on an operation that no one will complete. Five operations cover almost every case:

1. Sending on a channel no one is reading.
2. Receiving on a channel no one is sending to and no one will close.
3. Looping with `for { ... }` and no exit condition.
4. Holding a mutex that another goroutine is waiting on, while that other goroutine is also leaked.
5. Waiting on a `time.Ticker` that no one stopped.

Each of these has a fix. The fix is always *to introduce a signal that releases the block*. That signal is almost always `<-ctx.Done()` or the close of a side channel.

### The owner rule

A goroutine has exactly one owner. The owner is the goroutine (or the struct holding the goroutine's reference) that:

- Decided to start the goroutine.
- Holds the means to signal it to stop (a `cancel` function, a `done` channel, or a `Stop()` method).
- Knows when the goroutine has actually finished (a `WaitGroup`, an `errgroup.Wait`, or a "stopped" channel close).

If a goroutine has no clear owner, it is going to leak. If it has two owners that both think they are responsible for stopping it, you will get double-close panics or the kind of race where one owner cancels and the other forgets. Single owner, full responsibility — that is the rule.

### Articulate the exit story before you write `go`

A useful discipline: before typing `go f()`, write the answer to four questions as comments. If you cannot answer them, do not start the goroutine yet.

```go
// Owner: HTTPServer.cleanupLoop (held in server.cleanupWG).
// Stop signal: ctx.Done() from server.shutdownCtx.
// On stop: drain pending sessions, then return.
// Termination signalled by: cleanupWG.Done() in defer.
go s.cleanupLoop(ctx)
```

This is not bureaucracy. It is the difference between code that works and code that leaks in production six months later when someone refactors the caller.

### Context propagation: the rule of inheritance

Every long-running goroutine takes `ctx context.Context` as its first parameter. The goroutine *propagates* the context — it does not create one out of thin air. If you find yourself writing `context.Background()` deep inside a function, you have broken the chain.

```go
// Right
func (s *Server) startLoop(ctx context.Context) {
    go s.loop(ctx)
}

// Wrong: severs the cancellation chain
func (s *Server) startLoop() {
    go s.loop(context.Background())
}
```

The exception is the root: `main` is allowed to mint a `context.Background()`, and a long-lived background service is allowed to mint one for itself. Everywhere else, you inherit.

---

## The Five Leak Patterns and Their Canonical Fixes

These are the five leak shapes you will see again and again. Memorise the fix for each. Roughly 90% of goroutine leaks in real codebases are one of these five.

### Pattern 1 — Sender blocked on an unbuffered channel

```go
// Leaky
func first(urls []string) string {
    ch := make(chan string)
    for _, u := range urls {
        go func(u string) {
            ch <- fetch(u) // leaks if main goroutine takes only one value
        }(u)
    }
    return <-ch
}
```

After the first value arrives, `main` returns. The other goroutines are still alive, blocked on `ch <- fetch(u)` because no one will ever read the rest. They leak forever.

**Fix:** buffer the channel by the number of senders. Then every sender can deposit its value and exit, even if no one reads it.

```go
// Fixed
func first(urls []string) string {
    ch := make(chan string, len(urls))
    for _, u := range urls {
        go func(u string) {
            ch <- fetch(u) // never blocks: buffer fits everyone
        }(u)
    }
    return <-ch
}
```

The buffer size is not arbitrary. It is exactly the number of values that could be sent without being received. For a "first to finish" pattern, that equals the number of senders.

### Pattern 2 — Receiver blocked on a channel no one closes

```go
// Leaky
func work(in <-chan Job) {
    go func() {
        for j := range in { // blocks forever if no one closes in
            process(j)
        }
    }()
}
```

The receiver is parked on the channel until someone either sends or closes. If the producer is itself dead (panicked, returned without closing, or was never wired up correctly), the receiver leaks.

**Fix:** add a cancellation case. The goroutine watches the context too, not only the channel.

```go
// Fixed
func work(ctx context.Context, in <-chan Job) {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case j, ok := <-in:
                if !ok {
                    return
                }
                process(j)
            }
        }
    }()
}
```

Two stop signals now: the channel close (cooperative producer) and the context cancellation (the owner pulled the plug). Either one exits the loop.

### Pattern 3 — Infinite `for { select { default: ... } }` loop

```go
// Leaky
go func() {
    for {
        select {
        case msg := <-in:
            handle(msg)
        default:
            // busy-wait
        }
    }
}()
```

A `select` with a `default` case becomes a non-blocking poll. With no cancellation case, the loop spins forever. Two problems: it leaks, and it burns a whole CPU core.

**Fix:** add a `<-ctx.Done()` case, and consider whether you really need the `default` at all.

```go
// Fixed
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        case msg := <-in:
            handle(msg)
        }
    }
}()
```

If you genuinely need a non-blocking poll (rare), pair it with a `time.Sleep` or a `time.Ticker` and a context case. Never spin-loop in production code.

### Pattern 4 — Goroutine holding a mutex that someone else waits on

```go
// Leaky
var mu sync.Mutex

func A() {
    mu.Lock()
    callB() // may block forever
    mu.Unlock()
}

func B() {
    mu.Lock() // blocks because A holds the lock
    defer mu.Unlock()
    // ...
}
```

If `callB()` waits on a channel that only `B` can satisfy, you have a deadlock through the mutex. Both goroutines leak. The mutex is not the bug; the bug is that `A` does I/O while holding the lock.

**Fix:** never hold a mutex across operations that might block. Release the lock, do the blocking work, re-acquire if needed.

```go
// Fixed
func A() {
    mu.Lock()
    snapshot := state
    mu.Unlock()

    result := slowWork(snapshot)

    mu.Lock()
    state = result
    mu.Unlock()
}
```

The principle: **a mutex protects state, not work**. The critical section should be short, deterministic, and never block on I/O, channels, or other goroutines.

### Pattern 5 — Background ticker not stopped

```go
// Leaky
func startHeartbeat() {
    go func() {
        t := time.NewTicker(time.Second)
        for {
            select {
            case <-t.C:
                ping()
            }
        }
    }()
}
```

The ticker keeps firing, the goroutine keeps looping, and even if the goroutine somehow exited, the ticker's runtime resources stay parked. Two leaks: the goroutine and the ticker.

**Fix:** `defer t.Stop()`, and add a context case to break the loop.

```go
// Fixed
func startHeartbeat(ctx context.Context) {
    go func() {
        t := time.NewTicker(time.Second)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                ping()
            }
        }
    }()
}
```

`time.NewTimer` follows the same rule: `defer t.Stop()` even if you only intend to read it once. `Stop()` is idempotent and cheap.

---

## The Owner Rule

### One goroutine, one owner

If you spawn a goroutine, you own it. You hold its `cancel` function or its `Stop` method. You wait for it to finish before you yourself return. No one else has the right to cancel it without going through you.

```go
type Worker struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func StartWorker(parent context.Context) *Worker {
    ctx, cancel := context.WithCancel(parent)
    w := &Worker{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(w.done)
        w.loop(ctx)
    }()
    return w
}

func (w *Worker) Stop() {
    w.cancel()
    <-w.done
}
```

The owner is whoever holds the `*Worker`. They alone call `Stop()`. The goroutine inside `loop` exits when its context is cancelled, and `done` closes to signal "I am out."

### Why two owners is worse than zero owners

If two parts of the code each think they own a goroutine, several bugs become possible:

- Double-cancel: not directly harmful (cancel is idempotent), but it hides ownership confusion.
- Double-close on `done`: panics.
- "I already stopped it" / "no you didn't" — neither owner actually waits, and the goroutine slips through shutdown.

Drawing a single line from the goroutine to its owner removes all of these.

### Ownership trees

In a real service, goroutines form a tree. `main` owns the HTTP server, which owns each request handler, which owns its fan-out workers. Cancellation flows down the tree (parent cancels child); completion flows up the tree (child closes its done, parent waits).

A leaf goroutine has one owner. An interior goroutine (one that itself owns children) is responsible for stopping its children before signalling its own completion. Get this right and shutdown is automatic; get it wrong and shutdown hangs.

---

## Every Goroutine Has an Exit Story

The exit story is four sentences. Write them as comments above every `go` statement in code you intend to keep:

```go
// Owner: this function, returns only after the goroutine has stopped.
// Stop: cancel() invoked in defer.
// On stop: returns ctx.Err() from the select.
// Done: wg.Done() in defer, parent calls wg.Wait().
ctx, cancel := context.WithCancel(parent)
defer cancel()
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    run(ctx)
}()
defer wg.Wait()
```

If any of the four sentences is empty, the goroutine is at risk. The comment is for the reader (and for yourself in six months); the code below it is what actually prevents the leak.

### Anti-pattern: fire-and-forget

```go
// Anti-pattern
go func() {
    for {
        time.Sleep(time.Minute)
        flushMetrics()
    }
}()
```

No owner. No cancellation. No way to know if it crashed. If `flushMetrics` panics, the recovery (if any) is silent. This goroutine will leak across the entire lifetime of the process, and on shutdown it will simply be killed mid-write, possibly corrupting state.

The fix is the same as Pattern 5: an owning struct, a context, a defer'd ticker stop, and a `done` channel for the owner to wait on.

---

## Context Propagation Basics

`context.Context` is the standard way to propagate cancellation. Three rules cover most cases:

### Rule A: every long-running goroutine takes `ctx` as the first parameter

```go
func (s *Server) cleanupLoop(ctx context.Context) {
    // ...
}

go s.cleanupLoop(ctx)
```

By convention, `ctx` is the first parameter and is named `ctx`. This is in the standard library's style guide.

### Rule B: never store a context in a struct field for later use

```go
// Wrong
type Bad struct {
    ctx context.Context
}

func (b *Bad) Do() {
    work(b.ctx) // which context is this? the one stored at construction.
}
```

The stored context becomes stale relative to whoever calls `Do`. Pass `ctx` explicitly on every call instead. The exception is a struct that *owns a goroutine* — that struct may hold the `cancelFunc` for its own goroutine's context, because the lifetime of the context matches the lifetime of the struct.

### Rule C: cancel functions must be called

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
```

`go vet` will warn you if you forget. Even when the parent context is already cancelled and the child would be cancelled automatically, calling `cancel()` immediately releases the child's resources. Make it a reflex.

---

## Real-World Analogies

### A leash on every dog

You own a dog (goroutine). You hold the leash. When you leave the park, you tug the leash and the dog comes with you. A dog without a leash is a dog you can't call back — and that is exactly a leaked goroutine. The leash is `context.Context`.

### A guest list at a club

Every guest (goroutine) entered through the door (the `go` statement). The bouncer (owner) knows who's inside. At closing time, the bouncer announces "last call" (`cancel()`), and waits until everyone has filed out (`wg.Wait()`). No bouncer, no closing.

### A library checkout

When you borrow a book (start a goroutine), the librarian writes your name down (owner registers it). When the library closes (shutdown), the librarian goes through the list and calls every borrower. A book without a borrower's name is a book that will never come back.

### A tap that you forgot to turn off

The ticker is a dripping tap. Every second, a drop. If you never turn the tap off (`Stop()`), the tap drips forever, and the goroutine listening to the drips is forever waiting for the next one.

---

## Mental Models

### "Every goroutine has a death plan"

Before `go f()`, you must know: how does `f` decide to return? If the answer is "when its work is done and it returns naturally," fine. If the answer is "when somebody tells it to stop," then *somebody* must be a specific entity with a name. Naming that entity is half the work.

### "Channels are tightropes between two specific goroutines"

A channel connects a sender to a receiver. If one end falls off (the goroutine exits or panics) the other end is left holding empty rope. The fix is always to add a way for the surviving end to know: the close, the context, the deadline.

### "Cancellation is the inverse of `go`"

`go` starts a goroutine. `cancel` stops it. They come in pairs in the same scope. If you see `go` without a corresponding `cancel` mechanism, you have an unfinished thought.

### "Mutexes don't fix leaks; they cause them"

A mutex held across a channel operation is the single most common leak gateway in production code. Mutexes protect *short* critical sections of *non-blocking* work. The moment you hold a mutex through anything that might wait, you are one step away from a deadlock.

---

## Pros & Cons

### Pros of disciplined prevention

- Leaks become a non-event. Production memory is flat. SREs forget what a goroutine alarm looks like.
- Shutdowns are fast and clean. The service exits when asked, every time.
- Tests with goleak prove invariants per-test, catching regressions before merge.
- Refactoring is safer: the contract (owner, signal, exit) is in the code, not in someone's head.

### Cons

- Verbosity. Each goroutine carries a context, a cancel, a wait. For a one-line fan-out, this feels heavy.
- A small mental overhead on every `go` statement: "who owns this?"
- `goleak` in CI can flag false positives from third-party libraries that leak their own goroutines; you must allowlist them.

### The trade-off

You pay a few lines of boilerplate and a few minutes of design thought per goroutine. In exchange, you never spend a weekend debugging a slow memory climb in production. The trade is overwhelmingly worth it.

---

## Use Cases

### When prevention is critical

- Long-running services (HTTP servers, queue workers, daemons).
- Libraries that start goroutines on behalf of users.
- Anything in the request path (a leak per request kills you in days).
- Programs that run under containers with memory limits.

### When you can be a bit looser

- Short-lived CLI tools that exit in seconds. The OS reclaims everything on exit.
- One-off scripts. Still, get into the habit; the cost is small.
- Test code. Use goleak even here — it catches your bugs early.

---

## Code Examples

### Example 1: a leak-free fan-out

```go
package main

import (
    "context"
    "fmt"

    "golang.org/x/sync/errgroup"
)

func fetchAll(ctx context.Context, urls []string) ([]string, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]string, len(urls))
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            body, err := fetch(ctx, u)
            if err != nil {
                return err
            }
            results[i] = body
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

No buffered channels, no hand-rolled `WaitGroup`. `errgroup` enforces: all goroutines complete (or fail), the context is cancelled on the first failure, and `Wait` returns the first error. Zero risk of leak as long as `fetch` itself respects `ctx`.

### Example 2: a long-running loop

```go
package main

import (
    "context"
    "log"
    "time"
)

type Heartbeat struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func StartHeartbeat(parent context.Context, interval time.Duration) *Heartbeat {
    ctx, cancel := context.WithCancel(parent)
    h := &Heartbeat{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(h.done)
        t := time.NewTicker(interval)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                if err := ping(ctx); err != nil {
                    log.Printf("heartbeat: %v", err)
                }
            }
        }
    }()
    return h
}

func (h *Heartbeat) Stop() {
    h.cancel()
    <-h.done
}

func ping(ctx context.Context) error { return nil }
```

The pattern: a struct holds the cancel function and a done channel; the goroutine watches the context and stops the ticker on exit; the caller calls `Stop` which both cancels and waits.

### Example 3: a worker pool

```go
func ProcessJobs(ctx context.Context, jobs <-chan Job, workers int) error {
    g, ctx := errgroup.WithContext(ctx)
    for i := 0; i < workers; i++ {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case j, ok := <-jobs:
                    if !ok {
                        return nil
                    }
                    if err := handle(ctx, j); err != nil {
                        return err
                    }
                }
            }
        })
    }
    return g.Wait()
}
```

Each worker has the same exit story: cancellation case first, then a receive from the job channel with the `ok` check. The owner is `ProcessJobs`; the owner closes the `jobs` channel (or its upstream producer does, in coordination).

### Example 4: HTTP server with graceful shutdown

```go
func runServer(ctx context.Context) error {
    srv := &http.Server{Addr: ":8080", Handler: mux}

    serverErrors := make(chan error, 1)
    go func() {
        serverErrors <- srv.ListenAndServe()
    }()

    select {
    case err := <-serverErrors:
        return err
    case <-ctx.Done():
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
        defer cancel()
        return srv.Shutdown(shutdownCtx)
    }
}
```

The serving goroutine has a buffered channel so it can send its error and exit even if no one reads. Shutdown is gracefully bounded by a timeout.

### Example 5: ticker-driven cache eviction

```go
type Cache struct {
    mu     sync.Mutex
    data   map[string]entry
    cancel context.CancelFunc
    done   chan struct{}
}

func NewCache(parent context.Context) *Cache {
    ctx, cancel := context.WithCancel(parent)
    c := &Cache{data: make(map[string]entry), cancel: cancel, done: make(chan struct{})}
    go c.evictLoop(ctx)
    return c
}

func (c *Cache) evictLoop(ctx context.Context) {
    defer close(c.done)
    t := time.NewTicker(30 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            c.evictExpired()
        }
    }
}

func (c *Cache) Close() {
    c.cancel()
    <-c.done
}
```

The struct *owns* its goroutine. The owner of the `*Cache` (whoever called `NewCache`) is responsible for calling `Close`. If the owner forgets, goleak in tests will catch it.

---

## Coding Patterns

### Pattern: the owning struct

```go
type Service struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func (s *Service) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    s.cancel = cancel
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        s.run(ctx)
    }()
}

func (s *Service) Stop() {
    s.cancel()
    s.wg.Wait()
}
```

Reusable shape. `Start` spawns; `Stop` cancels and waits. Multiple goroutines? Same `wg` and same `ctx`.

### Pattern: the timeout-bounded shutdown

```go
func (s *Service) Stop(timeout time.Duration) error {
    s.cancel()
    done := make(chan struct{})
    go func() {
        s.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-time.After(timeout):
        return errors.New("shutdown timed out")
    }
}
```

If the goroutine doesn't exit within `timeout`, you log the leak and continue. The leaked goroutine is now a known incident, not a silent rot.

### Pattern: drain on shutdown

```go
func (w *Worker) Stop() {
    close(w.in)   // tell producers to stop
    w.cancel()    // tell consumer to stop receiving
    w.wg.Wait()   // wait for everything
}
```

For a queue-style worker, draining the input channel and cancelling the context are both needed: the close handles the "natural exit" path, the cancel handles the "force exit immediately" path.

---

## Clean Code

- Pass `ctx` first. Always first. Named `ctx`. No exceptions.
- One `cancel()` per `WithCancel`. Always `defer cancel()` unless you have a *very* specific reason not to.
- One `go f()` per goroutine. No `go go f()`, no nested launches without a tracking mechanism.
- A goroutine in a struct lives and dies with the struct. The struct exposes `Start`/`Stop` or only `Stop` (if `Start` is implicit in construction).
- Channel close is the sender's responsibility, exactly once.
- Use `errgroup` for fan-out. Use `WaitGroup` only when you need finer control.

---

## Error Handling

A leaked goroutine often dies silently because its error has nowhere to go. Fix that:

```go
go func() {
    if err := work(ctx); err != nil {
        log.Printf("work: %v", err)
    }
}()
```

Better, surface it:

```go
g.Go(func() error { return work(ctx) })
```

Best, structure it: send errors to a channel, an `errgroup`, or a supervisor. If a goroutine fails, the owner should know.

`recover()` in a worker goroutine protects the process from a single panic; it does *not* fix a leak. After recover, the goroutine still has to be told to stop and to clean up, and the owner has to be told it died.

---

## Performance Tips

- Cancellation is cheap. A `<-ctx.Done()` case in a select adds nanoseconds. Don't optimise it away.
- `time.Ticker.Stop()` releases internal runtime state. Skipping it costs memory, not just goroutines.
- Don't spawn a goroutine per call if the call is short. Use a pool.
- For very high-frequency loops, `select` with two cases is fast; with five-plus cases, performance starts to suffer. Group your channels.

---

## Best Practices

1. Pass `ctx context.Context` as the first argument to every long-running goroutine.
2. Buffer outbound channels by exactly the number of values that might be sent without a receiver.
3. Close channels from the sender side, exactly once.
4. `defer ticker.Stop()` and `defer timer.Stop()` on the same line you create them.
5. Use `errgroup.WithContext` for fan-out; never roll your own.
6. Every struct that spawns a goroutine in its constructor must provide a `Close` or `Stop` method.
7. Run goleak in tests. Add it the day you start the project.
8. Document the exit story in a comment above every `go` statement that is not trivially scoped.
9. Never hold a mutex across a channel operation or any I/O.
10. Treat fire-and-forget goroutines as bugs unless explicitly documented and justified.

---

## Edge Cases & Pitfalls

### `context.WithTimeout` without `defer cancel`

```go
ctx, _ := context.WithTimeout(parent, time.Second) // missing cancel
```

The context's resources are released when the timeout fires, but until then, a goroutine inside the runtime is watching it. `go vet` warns. Always assign `cancel` and `defer cancel()`.

### Cancelling a context twice

It is fine. `cancel()` is idempotent. But if you find yourself cancelling twice, it's a sign of ownership confusion. Trace who owns it.

### Channel closes while another goroutine sends

Panic on the sender side: "send on closed channel." The rule of "close from the sender" prevents this. If you have multiple senders, you need a coordinator that closes once after all senders are done; the easy way is `errgroup` + a single close after `g.Wait()`.

### Receiver doesn't notice a close in a `select` with two channels

```go
select {
case j, ok := <-jobs:
    if !ok {
        return // important
    }
case <-ctx.Done():
    return
}
```

Always check `ok` on a receive. A receive on a closed channel returns the zero value forever, looking like a normal job.

### Calling `Stop()` before `Start()`

```go
s := &Service{}
s.Stop() // panic: s.cancel is nil
```

Either always call `Start` first, or make `Stop` no-op when `cancel` is nil. Pick one and stick with it.

---

## Common Mistakes

### Mistake 1 — Spawning a goroutine inside a tight loop

```go
for _, x := range items {
    go process(x) // 10 million items, 10 million goroutines
}
```

Bound concurrency with `errgroup.SetLimit` or a worker pool.

### Mistake 2 — Closing a channel from the receiver side

```go
go func() {
    for x := range ch {
        if done(x) {
            close(ch) // panic on next send
            return
        }
    }
}()
```

Receivers don't close. They use the context, the `ok` check, or a side channel to signal "I am done."

### Mistake 3 — `context.Background()` in production code

```go
go work(context.Background()) // no way to cancel
```

Inherit from the caller. The only place `Background` belongs is `main` and the entry to a long-lived service.

### Mistake 4 — Using `time.After` in a long-running select

```go
for {
    select {
    case <-time.After(time.Second): // allocates a new timer each iteration
        tick()
    case <-ctx.Done():
        return
    }
}
```

Use `time.NewTicker` (or a single reused `time.Timer`) instead. `time.After` allocates on every call and the underlying timer is not garbage-collected until it fires.

### Mistake 5 — Forgetting the `cancel` for `WithTimeout`

Covered above. Make `defer cancel()` muscle memory.

### Mistake 6 — Not waiting for goroutines on shutdown

```go
func (s *Server) Shutdown() {
    s.cancel() // signals, but doesn't wait
}
```

You cancelled, but did the goroutines finish? They might still be writing to a file, a socket, or shared state. Wait.

---

## Common Misconceptions

### "If I don't reference the goroutine, the GC will clean it up"

False. A live goroutine is rooted by the runtime. It will not be garbage collected. Everything it references is also kept alive. The only way to free it is to let it return.

### "`ctx.Done()` automatically stops my goroutine"

False. `<-ctx.Done()` is a channel that *unblocks*; the goroutine still has to receive on it and act. If your goroutine is parked on a different channel and never selects on `ctx.Done()`, it does not stop.

### "Buffered channels solve all blocking"

False. A buffered channel only helps the sender escape *up to the buffer size*. Beyond that, the sender blocks again. The fix in Pattern 1 works because the buffer matches the sender count exactly.

### "`go func()` is free"

False. It costs a stack (initially ~2 KB), runtime bookkeeping, and scheduler time. Cheap, yes. Free, no. Spawning one per byte of input wastes both memory and time.

---

## Tricky Points

### Pattern 1's fix only works if every sender exits

```go
ch := make(chan string, len(urls))
for _, u := range urls {
    go func(u string) {
        body, err := fetch(u)
        if err != nil {
            return // CAREFUL: skipping the send is fine here because we only need one value
        }
        ch <- body
    }(u)
}
```

If you change the consumer to *count* values rather than take one, skipping the send breaks the count. Decide whether you need exactly N or "at least one" up front.

### `select` evaluates all cases atomically

If `ctx.Done()` is closed *and* a value is ready on the job channel, `select` picks one at random. Don't assume cancellation takes priority. If you need cancellation-first behaviour, check `ctx.Err()` at the top of each iteration.

### `defer cancel()` does not stop the goroutine inside

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
go work(ctx) // BUG: outer function returns, goroutine still running
```

The defer cancels the context, which signals the goroutine to stop, but you have not *waited* for it. The function returns; the goroutine winds down concurrently. If you want to wait, add a `WaitGroup`.

### Multiple selects, one context

If you have three goroutines that all watch the same `ctx`, one `cancel()` signals all three. This is exactly the behaviour you want — and exactly why you should not hand each goroutine its own private context unless they have distinct lifetimes.

---

## Test

```go
package leakproof_test

import (
    "context"
    "testing"
    "time"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}

func TestHeartbeatStops(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    h := StartHeartbeat(ctx, 10*time.Millisecond)
    time.Sleep(50 * time.Millisecond)
    h.Stop()
    // goleak.VerifyTestMain catches anything still running.
}

func TestStopBeforeWork(t *testing.T) {
    ctx := context.Background()
    h := StartHeartbeat(ctx, time.Hour)
    h.Stop() // should return immediately
}
```

`VerifyTestMain` runs at the end of all tests; if any goroutine outside the standard library remained, the suite fails with a goroutine dump.

---

## Tricky Questions

1. **Q.** A buffered channel with capacity 1 has a sender and no receiver. Is the sender blocked? **A.** No, the first send succeeds. The second send (if any) blocks.
2. **Q.** Why is `close()` the sender's job? **A.** Receivers can't safely close: closing while another sender is mid-send panics. Senders coordinate among themselves.
3. **Q.** Does `cancel()` block? **A.** No, it returns immediately. It only sets a flag and closes a channel.
4. **Q.** What happens if you `cancel()` a context whose parent is already cancelled? **A.** Nothing harmful. The child is already done; cancel is a no-op.
5. **Q.** Is `<-ctx.Done()` re-readable? **A.** Yes, because `Done()` is a closed channel after cancellation. Reading a closed channel always returns the zero value immediately.
6. **Q.** Why can a goroutine that holds a mutex cause a leak? **A.** Another goroutine waiting on `Lock()` is blocked forever if the holder also blocks (e.g., on a channel that depends on the waiter). Both are leaked.
7. **Q.** Does `time.After(time.Second)` leak? **A.** Not after the timer fires. Before it fires, the underlying `*Timer` is alive and the runtime tracks it. Reuse a single `Timer` for hot loops.

---

## Cheat Sheet

```
| Symptom                                  | Fix |
|------------------------------------------|-----|
| Sender blocked on unbuffered chan        | make(chan T, N) where N = sender count |
| Receiver blocked on chan never closed    | add <-ctx.Done() case in select |
| for { select { default: ... } } loop     | add <-ctx.Done() case; remove default |
| Mutex held across channel op             | release mutex first; do I/O outside critical section |
| Ticker not stopped                       | defer ticker.Stop() right after NewTicker |
| Forgot to wait on shutdown               | sync.WaitGroup or errgroup, then Wait() |
| No way to stop a fire-and-forget         | own it in a struct with cancel + done channel |
| ctx stored in a struct field             | pass ctx per call instead |
| Cancellation forgotten on WithTimeout    | defer cancel() always |
```

---

## Self-Assessment Checklist

- [ ] You can name all five leak patterns and write the canonical fix for each from memory.
- [ ] You can write the owning-struct pattern (`cancel` + `done` channel) without looking it up.
- [ ] Every `go f()` statement in code you write today has an owner, a stop signal, and a wait.
- [ ] You instinctively reach for `errgroup.WithContext` instead of hand-rolling a `WaitGroup` + error channel.
- [ ] You pair every `time.NewTicker` with `defer t.Stop()`.
- [ ] You can spot a context that has been severed (`context.Background()` deep in a call chain).
- [ ] You know that `cancel()` signals but does not wait.
- [ ] You have run `go test -run X` on a test file and seen goleak fail when you intentionally leak.

---

## Summary

Goroutine leaks are not exotic bugs. They are five repeating shapes with five canonical fixes, all of which boil down to: **give every goroutine a way out, and name the goroutine that pulls the trigger.**

- Buffer the channel exactly to the number of senders, so they always have room to deposit and exit.
- Add `<-ctx.Done()` to every long-running receive, so a stuck producer can't trap the receiver.
- Never write an infinite `for` loop without a cancellation case.
- Keep mutex critical sections short and non-blocking.
- `defer ticker.Stop()` always.

Above all: every goroutine has exactly one owner, that owner holds the cancel and the wait, and every `go f()` in your code carries — in comment or in obvious pattern — its exit story. Once these habits are reflexive, leaks stop happening.

---

## What You Can Build

- A heartbeat service that pings a peer on an interval, with clean shutdown.
- A worker pool that processes a queue with per-worker cancellation.
- A graceful HTTP server with a shutdown timeout and zero residual goroutines.
- A test harness that asserts no goroutines leak across a suite.
- A library that exposes only `Start`/`Stop` and never leaks resources to the caller.

---

## Further Reading

- *The Go Programming Language* (Donovan & Kernighan), chapters 8–9.
- Go blog: [Context](https://go.dev/blog/context), [Pipelines and Cancellation](https://go.dev/blog/pipelines).
- `golang.org/x/sync/errgroup` documentation.
- `go.uber.org/goleak` documentation.
- Dave Cheney, "Never start a goroutine without knowing how it will stop."

---

## Related Topics

- [01-goroutines/05-best-practices](../../01-goroutines/05-best-practices/) — the rules these patterns implement
- [01-goroutines/06-common-pitfalls](../../01-goroutines/06-common-pitfalls/) — the bug families this section prevents
- [02-detecting-leaks](../02-detecting-leaks/) — finding the leaks that slipped through
- [04-pprof-tools](../04-pprof-tools/) — diagnostic tools for a leaked process
- [02-channels](../../02-channels/) — channel semantics underlying the fixes
- [04-context](../../04-context/) — full coverage of the cancellation type

---

## Diagrams & Visual Aids

### The exit story diagram

```
+----------------------+
| go f(ctx)            |
+----------+-----------+
           |
           v
+----------+-----------+
| Owner holds:         |
|  - cancel func       |
|  - done channel/wg   |
+----------+-----------+
           |
           v
+----------+-----------+      cancel()       +----------------+
| goroutine running    | <----------------- | Owner triggers  |
| selects on ctx.Done()|                     | shutdown        |
+----------+-----------+                     +-------+--------+
           |                                          |
           | close(done) or wg.Done()                 |
           v                                          v
+----------+-----------+                     +-------+--------+
| goroutine exits      | -----------------> | Owner returns   |
+----------------------+    Wait() returns  +----------------+
```

### Pattern 1: buffer the channel

```
Before:
  sender ---chan(0)--- X (no receiver)   --> sender blocks forever

After:
  sender ---chan(N)--- buffer ---chan--- X --> sender deposits, exits
```

### Pattern 2 & 3: add the cancel case

```
Before:
  for { select { case j := <-in: ... } }   --> stuck if in never receives

After:
  for {
      select {
      case <-ctx.Done(): return            <-- escape hatch
      case j := <-in: ...
      }
  }
```

### The ownership tree

```
main
  |
  +-- Server (owner)
  |     +-- request handler 1 (owned by Server)
  |     |     +-- fan-out worker A
  |     |     +-- fan-out worker B
  |     +-- request handler 2
  |
  +-- MetricsFlusher (owner)
        +-- ticker loop
```

Cancellation flows downward (parent cancels), completion flows upward (child closes done, parent waits).
