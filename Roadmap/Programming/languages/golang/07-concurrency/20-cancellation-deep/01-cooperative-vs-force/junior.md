---
layout: default
title: Junior
parent: Cooperative vs Forced
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/junior/
---

# Cooperative vs Forced Cancellation — Junior Level

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
> Focus: "Why can't I just kill a goroutine? How do I stop one without breaking things?"

In many languages you can interrupt a worker. Java has `Thread.interrupt`, Python has `KeyboardInterrupt` and an old `_async_raise`, .NET has `Thread.Abort` (deprecated but historically real), POSIX has `pthread_cancel`. Each of these treats a running thread as *a thing the system can shake* — push it from outside, and it should wind down.

Go deliberately does not offer this. The word "cancel" in Go almost always means: **the goroutine itself politely checks for a signal, sees that the work is no longer needed, and returns**. The runtime never reaches in and forces a goroutine to stop. There is no `Goroutine.Kill`, no `runtime.Stop(g)`, no signal aimed at one specific G. This is called **cooperative cancellation**.

This file walks you through:

- What "cooperative" means concretely
- The `context.Context` API — how to create one, how to listen on it, how to release it
- Why `go func() { ... }()` with no cancel signal is a leak waiting to happen
- The simplest patterns: `ctx.Done()`, `select`, `ctx.Err()`
- The boundary where cooperative breaks down: blocking system calls, CGO, infinite loops without checks
- Why "forced cancellation" in Go always means *the process exits*, not *the goroutine exits*

After this file you will be able to: write a goroutine that stops when asked, propagate a cancellation from a parent to a child, recognise when a goroutine cannot be cancelled, and know when to reach for the harsher tools described in middle.md and senior.md.

You do not need to know about `runtime.LockOSThread`, signals, or CGO yet. Those come later. Here we focus on the everyday case: a worker, a context, and a clean exit.

---

## Prerequisites

- **Required:** You can spawn a goroutine and wait for it with `sync.WaitGroup`. (See the goroutines section.)
- **Required:** You have used `chan` at least once — send, receive, close. Even minimal exposure is enough.
- **Required:** Go 1.7 or newer, since `context` joined the standard library in 1.7. Practically: Go 1.21+ for the examples to compile with `context.AfterFunc` and `context.WithTimeoutCause`.
- **Helpful:** You have seen `select { case <-ch: ... }` syntax at least once.
- **Helpful:** You can read a stack trace and understand what "goroutine 17 [chan receive]" means.

If you have written one HTTP handler in Go and read about `r.Context()`, you have the background needed.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Cooperative cancellation** | A cancellation model where the goroutine doing the work voluntarily checks a signal and returns. The runtime does not interrupt it. |
| **Forced cancellation** | A model where an external agent kills a thread/process without its consent. Go does not offer this for individual goroutines. |
| **`context.Context`** | The standard interface used to carry deadlines, cancellation signals, and request-scoped values across API boundaries. |
| **`ctx.Done()`** | Returns a `<-chan struct{}` that is closed when the context is cancelled or its deadline expires. |
| **`ctx.Err()`** | Returns `nil` if the context is still live, `context.Canceled` if cancelled, or `context.DeadlineExceeded` if the deadline passed. |
| **`cancel()` function** | The function returned by `context.WithCancel`, `WithTimeout`, `WithDeadline`. Calling it cancels the context and all its children. |
| **Goroutine leak** | A goroutine that never exits because no signal ever reaches it. Cooperative cancellation requires that the signal can both *arrive* and *be observed*. |
| **`select` polling** | A pattern where a goroutine periodically checks `<-ctx.Done()` alongside its actual work. The check happens at safe points decided by the author. |
| **Preemption** | The runtime interrupting a goroutine to give the CPU to another. Preemption is *not* cancellation — the goroutine resumes later, it does not stop. |
| **`runtime.LockOSThread`** | Pins a goroutine to a specific OS thread. Mentioned here for context; details in senior.md. |
| **CGO** | The mechanism for calling C from Go. Once a C function is running, the Go runtime cannot interrupt it. |
| **Signal (POSIX)** | An OS-level asynchronous interrupt (`SIGINT`, `SIGTERM`, `SIGKILL`). Signals reach the *process*, not a goroutine. |

---

## Core Concepts

### A goroutine has no external "stop" lever

If you write:

```go
go work()
```

…and want to stop `work` from elsewhere, **there is no API for that**. You cannot `g.Stop()`, you cannot pass the goroutine to anyone, you cannot ask the runtime to halt it. The only way to stop it is to give `work` itself a way to *notice* that it should stop, and trust it to act.

This is the single most important concept in Go cancellation. Almost every cancellation bug is a violation of it: code that assumes some outer force will stop a goroutine, when in fact no such force exists.

### The signal is always inside the goroutine's code

Cooperative cancellation puts the responsibility in the worker. The worker says, roughly:

> "I will do one chunk of work. Then I will check: am I still wanted? If not, I will clean up and return. If yes, I will do another chunk."

The chunk size matters. If the chunk is "decode 4 GB of video," the goroutine is uncancellable for the duration of that chunk. If the chunk is "process one frame," cancellation latency is one frame.

### `context.Context` is the standard signal carrier

The standard library, the runtime, the HTTP server, the database drivers — all use one type to carry "should I keep going?" across function boundaries: `context.Context`.

A minimal cancellable goroutine:

```go
func worker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            doOneChunk()
        }
    }
}
```

The caller controls the context:

```go
ctx, cancel := context.WithCancel(context.Background())
go worker(ctx)
// ...later...
cancel() // worker observes <-ctx.Done() and returns
```

`cancel()` does not reach into `worker`. It simply closes the channel returned by `ctx.Done()`. The worker, on its next `select`, sees the closed channel and chooses that branch.

### `Done()` is just a channel; `Err()` tells you why

`ctx.Done()` returns `<-chan struct{}`. When the context is alive, the channel is open and a receive blocks. When the context is cancelled, the channel is closed, and a receive returns immediately. `ctx.Err()` then tells you the reason: `context.Canceled` if a manual `cancel()` happened, `context.DeadlineExceeded` if a `WithTimeout` or `WithDeadline` expired.

### Calling `cancel()` is required, not optional

Every `context.WithCancel` / `WithTimeout` / `WithDeadline` returns a `cancel` function. **You must call it**, even if the context expires naturally:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel() // always
```

If you forget, the parent context retains a reference to the child, and the child's resources (a timer, a channel) live until the parent is cancelled. The `go vet` tool flags this with `lostcancel`.

### Forced cancellation in Go always means "the process exits"

When people say "force-cancel," in Go they usually mean one of:

1. `os.Exit(1)` — the process dies. All goroutines stop because the process stops.
2. `panic(...)` without recovery — the runtime kills the process.
3. The kernel sends `SIGKILL` to the process.
4. The hardware loses power.

None of these "cancel a goroutine." They cancel the *entire program*. There is no in-between for individual goroutines.

### Preemption is not cancellation

In Go 1.14+, the runtime can preempt a goroutine stuck in a tight loop (via async-preemption signals). But preemption is *the scheduler taking the CPU temporarily*. The goroutine still exists, still holds its resources, and will resume the moment the scheduler picks it again. Preemption gives fairness, not cancellation.

---

## Real-World Analogies

### Cooperative cancellation is the snooze button

You set an alarm. The alarm rings. You can hit snooze. The alarm cannot reach into your bedroom and physically lift you out of bed. It can only keep ringing and trust that you will eventually respond. Go's cancellation is the same: the signal rings, the goroutine must choose to act on it.

### Forced cancellation is the building's fire alarm

When the fire alarm goes off, you stop everything. You do not finish your sentence. You do not save the file. Forced cancellation in Go is the equivalent: `os.Exit` is the fire alarm, and it stops everyone in the building (the process) at once, not one room (one goroutine).

### Context is the cinema usher with a flashlight

Imagine 1000 goroutines as moviegoers in a theatre. An usher walks down the aisle and shines a flashlight to signal "show is canceled." Each viewer must notice the light and leave. The usher does not pick anyone up.

### CGO is a phone call that you can't hang up from outside

When a goroutine enters C code, it has dialed a number that only it can hang up. The Go runtime can call its own desk to say "please return," but the C function is on the line and not listening. Until the C call returns, no cancellation reaches that goroutine.

---

## Mental Models

### Model 1: "Signals fan out, work fans in"

A `context.Context` is shaped like a tree. The parent sends `Done` downward; children inherit it. When the parent cancels, every descendant's `Done` channel closes too. You build the tree by composing `WithCancel`, `WithTimeout`, etc.

```
ctxRoot
 ├── ctxDB        (WithTimeout 5s)
 │    └── ctxQuery (WithTimeout 1s)
 └── ctxHTTP     (WithCancel)
      └── ctxRetry (WithTimeout 500ms)
```

Cancelling `ctxRoot` cancels everything below. Cancelling `ctxDB` only cancels `ctxQuery`. The tree is the cancellation domain.

### Model 2: "Cancellation latency = max chunk time"

If your goroutine checks `<-ctx.Done()` every 10 ms, the worst-case latency from `cancel()` to "goroutine has returned" is ~10 ms. If you only check once per second, latency is up to a second. The chunk size you choose *is* the cancellation latency you accept.

### Model 3: "Every `cancel` deserves a `defer`"

A non-deferred `cancel` is a maintenance bug. Future code paths will return early, panic, or branch — and the cancel will be skipped. The pattern is:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

If the deadline expires first, `cancel` is harmless. If you exit early, it cleans up. Always.

### Model 4: "You cannot stop what cannot listen"

A goroutine that calls `time.Sleep(time.Hour)` is unstoppable for an hour. A goroutine reading from an unclosed channel is stuck forever. A goroutine in `recv()` on an OS socket with no deadline is hostage to the kernel. Cooperative cancellation requires both the *signal* and the *opportunity to observe it*. When the opportunity is absent, neither cooperation nor force from inside Go can save you.

---

## Pros & Cons

### Pros of cooperative cancellation

- **Predictable cleanup.** The goroutine knows when it is being cancelled and can release locks, close files, flush buffers in a normal control flow.
- **No "stop at any instruction" hazards.** Forced cancellation (as in `pthread_cancel` or Java's old `Thread.stop`) can interrupt at any machine instruction, including in the middle of acquiring a lock. Cooperative cancellation can only happen at points the worker chose.
- **Composable.** `context.Context` propagates through layers without each layer needing to know how cancellation happens upstream.
- **No runtime kernel-level surgery.** No need for signals targeted at threads, no need to track every thread's state. The runtime stays simple.
- **Same model for timeouts and explicit cancel.** A timeout is just a deferred `cancel()`. The worker treats both the same way.

### Cons of cooperative cancellation

- **Easy to leak.** A goroutine that does not check `ctx.Done()` will never exit, even if the entire program "thinks" it has shut down.
- **Cancellation latency is unbounded by the language.** It is bounded only by *your* code's polling frequency.
- **Blocking syscalls and CGO are escape hatches with no clean cancel.** A `read()` on a socket is at the mercy of OS-level deadlines or descriptor closing.
- **Discipline-heavy.** Every function in the call chain must accept and respect `ctx`. One layer that forgets breaks the chain.
- **Cancellation is racy with completion.** The goroutine may have just finished the work when `cancel()` arrives — both branches can happen.

---

## Use Cases

| Scenario | Cooperative model fits because… |
|---|---|
| HTTP request handler | The client disconnects → server cancels `r.Context()` → handler bails out at the next checkpoint. |
| Background pipeline stage | Each stage checks `ctx.Done()` between items. |
| Periodic ticker | A `for { select { <-ticker.C; <-ctx.Done() } }` exits cleanly. |
| Database query with deadline | Driver respects `ctx`; sends `query cancel` to the server if the deadline trips. |
| Goroutine pool worker | Workers loop on `<-jobs` and `<-ctx.Done()`; new jobs stop arriving and the worker returns. |
| Long-running computation | Split into chunks; check `ctx` between chunks. |

| Scenario | Cooperative is not enough — escalate to forced (process-level) |
|---|---|
| Hung CGO call | Only the process exit can free the goroutine. Bound by killing the program. |
| Buggy infinite loop in third-party code without `ctx` | No way in cooperative mode; restart the process. |
| Blocking syscall with no deadline | Set a deadline on the file descriptor, or accept that exit is the only stop. |
| Final shutdown after `SIGTERM` exceeds grace period | `os.Exit(1)` after a timeout. |

---

## Code Examples

### Example 1: A worker that respects context

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func worker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            fmt.Println("worker stopping:", ctx.Err())
            return
        default:
            // do one small unit of work
            time.Sleep(50 * time.Millisecond)
            fmt.Println("tick")
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
    defer cancel()
    worker(ctx)
}
```

Output: a few "tick" lines, then `worker stopping: context deadline exceeded`. The goroutine does not need any kill command; the deadline fires, `Done()` closes, and the loop chooses that branch.

### Example 2: Manual cancel from another goroutine

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())

    go func() {
        for {
            select {
            case <-ctx.Done():
                fmt.Println("done")
                return
            default:
                fmt.Println("working")
                time.Sleep(100 * time.Millisecond)
            }
        }
    }()

    time.Sleep(350 * time.Millisecond)
    cancel()
    time.Sleep(50 * time.Millisecond)
}
```

The main goroutine calls `cancel()`. The worker observes the closed `Done` channel on its next iteration and returns.

### Example 3: A goroutine that ignores its context — a leak

```go
func bad(ctx context.Context) {
    for {
        time.Sleep(time.Second) // never checks ctx
    }
}
```

`ctx` is accepted but never observed. Calling `cancel()` does nothing the goroutine cares about. The goroutine leaks for the lifetime of the program. This is the most common cancellation bug in Go.

### Example 4: Channel-based stop signal (pre-context idiom)

```go
type Worker struct {
    stop chan struct{}
}

func (w *Worker) Run() {
    for {
        select {
        case <-w.stop:
            return
        default:
            do()
        }
    }
}

func (w *Worker) Stop() { close(w.stop) }
```

Functionally identical to context for a single worker. Use `context.Context` when you want hierarchical cancellation or interop with the standard library.

### Example 5: `select` between work and cancellation

```go
func produce(ctx context.Context, out chan<- int) {
    for i := 0; ; i++ {
        select {
        case <-ctx.Done():
            return
        case out <- i:
        }
    }
}
```

The producer blocks until *either* a downstream consumer is ready *or* the context is cancelled. This is the cleanest cancellable producer pattern.

### Example 6: A goroutine that is stuck in a blocking syscall

```go
func readForever(conn net.Conn) {
    buf := make([]byte, 1024)
    for {
        n, err := conn.Read(buf) // blocking
        if err != nil {
            return
        }
        process(buf[:n])
    }
}
```

This goroutine cannot be cancelled by any context. If `conn.Read` blocks forever, the goroutine blocks forever. The fix is to set a read deadline (`conn.SetReadDeadline`) so the syscall returns with a timeout error, *or* to close `conn` from another goroutine, which causes the in-flight `Read` to return with an error.

### Example 7: Closing the resource to break a blocked goroutine

```go
go func() {
    <-ctx.Done()
    conn.Close() // unblocks any in-flight Read/Write
}()

readForever(conn)
```

The idiomatic pattern for "I cannot cancel the syscall, but I can close the descriptor it is using." Many standard library types (`net.Conn`, `os.File`, `*sql.DB`) support this.

### Example 8: Returning early on cancellation in CPU-bound work

```go
func sumSquares(ctx context.Context, items []int) (int, error) {
    var sum int
    for i, v := range items {
        if i%1024 == 0 {
            select {
            case <-ctx.Done():
                return 0, ctx.Err()
            default:
            }
        }
        sum += v * v
    }
    return sum, nil
}
```

The check happens every 1024 iterations. Cheap to poll, low cancellation latency, good cache behaviour.

### Example 9: Don't forget `defer cancel()`

```go
func fetch(parent context.Context, url string) ([]byte, error) {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()
    return httpGet(ctx, url)
}
```

If `fetch` returns at line 4, `defer cancel()` releases the timer. If `httpGet` returns normally, `cancel()` is still called, also harmlessly. The deferred call is always right.

### Example 10: A worker pool that drains on cancel

```go
func pool(ctx context.Context, jobs <-chan Job, n int) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-jobs:
                    if !ok {
                        return
                    }
                    j.Do()
                }
            }
        }()
    }
    wg.Wait()
}
```

Workers stop on *either* context cancel *or* `jobs` channel close. Both are forms of cooperative stop; neither is forced.

### Example 11: Cancellable `time.Sleep` replacement

```go
package main

import (
    "context"
    "time"
)

func sleepCtx(ctx context.Context, d time.Duration) error {
    timer := time.NewTimer(d)
    defer timer.Stop()
    select {
    case <-timer.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

`time.Sleep` is not cancellable. This helper accepts a context and returns early on cancel. Note the `defer timer.Stop()` — without it, the timer goroutine holds a reference until the deadline fires, even after cancellation.

### Example 12: Propagating cancellation through nested calls

```go
package main

import (
    "context"
    "database/sql"
    "net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    user, err := loadUser(ctx, r.URL.Query().Get("id"))
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    _ = user
}

func loadUser(ctx context.Context, id string) (*User, error) {
    return queryDB(ctx, "SELECT * FROM users WHERE id = ?", id)
}

func queryDB(ctx context.Context, query string, args ...any) (*User, error) {
    row := db.QueryRowContext(ctx, query, args...)
    var u User
    if err := row.Scan(&u.ID, &u.Name); err != nil {
        return nil, err
    }
    return &u, nil
}
```

`r.Context()` is wired all the way down to the database driver. If the HTTP client disconnects, `r.Context()` cancels, `queryDB` aborts its in-flight query, and no work continues for a request no one is listening to.

### Example 13: Two contexts merged with `errgroup`

```go
package main

import (
    "context"
    "fmt"
    "golang.org/x/sync/errgroup"
)

func runAll(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        return doA(gctx)
    })
    g.Go(func() error {
        return doB(gctx)
    })
    return g.Wait()
}
```

`errgroup.WithContext` returns a context that is cancelled when *any* worker returns an error. This is cooperative cancellation extended to groups: one failure cancels the others.

### Example 14: Cancellation in a long-running computation

```go
package main

import (
    "context"
    "errors"
)

func sumChunk(ctx context.Context, data []int) (int, error) {
    const checkEvery = 4096
    var sum int
    for i, v := range data {
        if i%checkEvery == 0 {
            if err := ctx.Err(); err != nil {
                return 0, err
            }
        }
        sum += v
    }
    if err := ctx.Err(); err != nil {
        return 0, err
    }
    return sum, nil
}

var ErrCancelled = errors.New("cancelled")
```

Checking `ctx.Err()` is even cheaper than the `select { default }` pattern, because there is no channel read. Use it when polling frequency is the dominant cost.

### Example 15: Forced stop of the whole program

```go
package main

import (
    "fmt"
    "os"
    "time"
)

func main() {
    go func() {
        for {
            fmt.Println("worker tick")
            time.Sleep(100 * time.Millisecond)
        }
    }()
    time.Sleep(350 * time.Millisecond)
    os.Exit(0) // forced stop: process dies, all goroutines vanish
}
```

This is "forced cancellation" in Go: the only way to stop a goroutine that has no cooperation point is to stop the *entire* process. The worker goroutine here never returns from `time.Sleep`; it is killed when the process exits.

---

## Coding Patterns

### Pattern 1: Accept a context, return on `ctx.Err()`

Every function that can block, loop, or call a network/disk should accept a `context.Context` as its first argument. The convention is:

```go
func DoX(ctx context.Context, arg T) (result, error)
```

The returned `error` should be `ctx.Err()` when cancellation is the reason for early return. Callers can then check `errors.Is(err, context.Canceled)`.

### Pattern 2: Check at safe points, not on every instruction

A cooperative check has cost. Checking inside a tight inner loop adds branch predictions and a chan-read each iteration. The pattern:

```go
for chunk := range chunks {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    processChunk(chunk)
}
```

Check between chunks, not between bytes.

### Pattern 3: One context per "request" or "operation"

A context represents the lifetime of a user-visible operation: an HTTP request, a batch job, a subscription. Do not create a fresh context inside a function for unrelated reasons. Pass the parent down and derive children with `WithCancel` / `WithTimeout`.

### Pattern 4: The "close the resource" escape

When the work is blocked on something Go cannot interrupt (a syscall, a CGO call), don't try to cancel the *goroutine*. Cancel the *resource*:

```go
go func() {
    <-ctx.Done()
    conn.Close()
}()
```

The blocked `Read` returns an error; the worker observes it and exits.

### Pattern 5: Always pair `WithTimeout` with `defer cancel`

```go
ctx, cancel := context.WithTimeout(parent, 2*time.Second)
defer cancel()
```

This is rote, but rote is good. The `lostcancel` analyzer in `go vet` exists because this is the most-common subtle bug.

### Pattern 6: Cancellation as "stop signal" plus "drain signal"

A worker may need to know two things: "stop accepting new work" and "stop processing the queue you already have." Split them:

```go
type Worker struct {
    ctx    context.Context // stops everything immediately
    drain  chan struct{}   // stops accepting; finish in-flight items
    queue  chan Item
}

func (w *Worker) Run() {
    for {
        select {
        case <-w.ctx.Done():
            return
        case <-w.drain:
            // drain remaining items, then return
            for it := range w.queue {
                w.process(it)
            }
            return
        case it := <-w.queue:
            w.process(it)
        }
    }
}
```

Use `drain` for "graceful shutdown" — let in-flight requests finish. Use `ctx` for "stop now" — for example, when grace period has expired.

### Pattern 7: Two-stage shutdown with deadline

```go
func gracefulShutdown(srv *http.Server) error {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    return srv.Shutdown(ctx) // sends "stop accepting", waits up to 30s for in-flight
}
```

The first stage is *cooperative*: tell the server to stop and wait. The 30-second timeout is the second stage: if cooperation does not finish in time, `Shutdown` returns an error and the caller can choose to escalate (e.g. `os.Exit`).

### Pattern 8: Cancellation-aware blocking send

A pattern often needed: "send to a channel, but bail out if the context is cancelled."

```go
func sendCtx[T any](ctx context.Context, ch chan<- T, value T) error {
    select {
    case ch <- value:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Without this, a sender on a full channel blocks forever even after cancellation. Generic syntax requires Go 1.18+.

### Pattern 9: Cancellation-aware blocking receive

```go
func recvCtx[T any](ctx context.Context, ch <-chan T) (T, error) {
    var zero T
    select {
    case v, ok := <-ch:
        if !ok {
            return zero, errClosed
        }
        return v, nil
    case <-ctx.Done():
        return zero, ctx.Err()
    }
}
```

Same idea, mirrored.

---

## Clean Code

- **Make the context flow visible.** The first parameter of every function that may block is `ctx context.Context`. No hidden globals. No package-level cancel channels.
- **Name your `cancel`.** When a function returns a cancel function, give it a descriptive name in the caller: `_, cancelQuery := ...` rather than `_, cancel := ...` when there are multiple.
- **Return `ctx.Err()` directly when cancellation is the cause.** Do not wrap with a custom message that hides the underlying `context.Canceled`. Callers may want to distinguish.
- **Never store a `context.Context` in a struct field for a long-lived object.** It is a request-scoped value. Pass it explicitly.
- **Avoid `context.Background()` deep inside a call.** That throws away the cancellation chain. The right place for `Background` is the top of a long-running daemon or a test.

---

## Product Use / Feature

| Feature | How cooperative cancel powers it |
|---|---|
| HTTP client disconnects mid-request | Server cancels `r.Context()`; handler stops processing and avoids charging compute to a request that no one will read. |
| Search-as-you-type | Each keystroke cancels the previous query's context; the database driver propagates the cancel to the DB. |
| Background job with a 10-second SLA | Wrap the job in `WithTimeout`; the worker checks and exits if it cannot finish in time. |
| Graceful shutdown on `SIGTERM` | Signal handler cancels the root context; every worker observes and exits within their polling latency. |
| API gateway timeout | Upstream timeout cancels the request context; downstream calls inherit the timeout and bail out early. |

---

## Error Handling

### `ctx.Err()` semantics

- Returns `nil` until cancellation.
- Returns `context.Canceled` if `cancel()` was called.
- Returns `context.DeadlineExceeded` if a `WithDeadline` / `WithTimeout` deadline fired.

Use `errors.Is(err, context.Canceled)` or `errors.Is(err, context.DeadlineExceeded)` to distinguish. Both implement the standard error interface.

### Errors from cancelled syscalls

When you close a `net.Conn` to unblock a `Read`, the error returned is *not* `context.Canceled`. It is something like `use of closed network connection`. Inspect with `errors.Is(err, net.ErrClosed)` or check `errno`. Translate at your service boundary if you want to surface "the user cancelled."

### Don't swallow cancellation as success

```go
if err := doWork(ctx); err != nil {
    if errors.Is(err, context.Canceled) {
        return nil // BUG: hides the fact that work was incomplete
    }
    return err
}
```

Cancellation is *not* success. The work didn't finish. Propagate it.

### Distinguish "cancelled by caller" from "deadline exceeded"

```go
err := doWork(ctx)
switch {
case errors.Is(err, context.Canceled):
    // caller explicitly cancelled; usually fine, may be the user closed a tab
    log.Info("operation cancelled")
case errors.Is(err, context.DeadlineExceeded):
    // hit a time budget; often actionable — slow downstream, undersized timeout
    log.Warn("operation timed out")
case err != nil:
    log.Error("operation failed", "err", err)
}
```

The two errors mean different things to your operators. Treat them separately when it matters.

### Cleanup must run even on cancellation

```go
func work(ctx context.Context) error {
    f, err := os.Create("output")
    if err != nil {
        return err
    }
    defer f.Close()

    for chunk := range chunks {
        select {
        case <-ctx.Done():
            return ctx.Err() // f.Close runs because of defer
        default:
        }
        if _, err := f.Write(chunk); err != nil {
            return err
        }
    }
    return nil
}
```

The `defer f.Close()` runs no matter how the function returns. Cancellation paths must use `defer`, not manual cleanup at every exit.

### `context.Cause` for richer error tracking (Go 1.20+)

```go
ctx, cancel := context.WithCancelCause(parent)
// ...
cancel(errors.New("user closed the tab"))

// in the worker:
if ctx.Err() != nil {
    return context.Cause(ctx) // returns the specific cause, not generic Canceled
}
```

`context.Cause` returns the error passed to `cancel(err)`. Use this to convey *why* a context was cancelled to downstream code.

---

## Security Considerations

- **Resource leaks become security issues.** A leaked goroutine pinning a file handle or socket can be a vector for DoS over time. Cooperative cancellation is your hygiene; forget it and you have a slow leak.
- **Context values are not security boundaries.** `context.WithValue` is for request-scoped data, not for authentication tokens. A child context can read any value; it is not isolated.
- **Cancellation should not skip cleanup.** When `<-ctx.Done()` fires, your deferred unlocks and resource releases must still run. `defer` makes this automatic; raw `return` from a non-deferred cleanup path is a hole.
- **DoS via uncancellable work.** If your service accepts a request and runs a 10-minute computation that ignores the context, an attacker can fire requests and tie up your workers indefinitely. Always make compute paths cooperatively cancellable.
- **Timeouts as defense.** Wrap every external call in `context.WithTimeout`. A misbehaving dependency that hangs forever is a denial-of-service waiting to happen.
- **Side effects on cancellation.** If a goroutine writes to a database and is cancelled mid-write, the database may have committed partial state. Use transactions and treat cancellation paths as "rollback" paths explicitly.

---

## Performance Tips

- A `select { case <-ctx.Done(): default: }` is roughly 5–20 nanoseconds. Cheap, but not zero. Don't add it to the innermost loop of a hot path; check between chunks.
- `context.Background()` is a singleton; reusing it is free.
- `context.WithCancel(parent)` allocates: a struct, a channel, and registers a cancellation hook on the parent. A few hundred nanoseconds and a small allocation.
- Forgetting `cancel()` keeps the timer alive and the context tree growing. Memory leak.
- `ctx.Err()` is a cheap atomic read on the modern implementation. Use it instead of `<-ctx.Done()` when you only want to *check*, not *wait*.
- Deep context trees (10+ levels) make every `Done()` involve a chain of receives. In typical apps the tree is shallow; in libraries, watch for accidental nesting.
- `context.AfterFunc(ctx, f)` (Go 1.21+) is cheaper than spawning a goroutine to wait on `<-ctx.Done()`. Use it when the cleanup is small.

---

## Best Practices

1. **Accept `ctx` as the first parameter** of any function that can block or loop.
2. **Always `defer cancel()`** after `WithCancel` / `WithTimeout` / `WithDeadline`.
3. **Check `ctx.Done()`** at well-defined safe points, not at every instruction and not never.
4. **Close resources** to unblock goroutines stuck in syscalls.
5. **Return `ctx.Err()`** from any function that exits due to cancellation.
6. **Don't store contexts in structs**; pass them as parameters.
7. **Don't pass `nil` as a context**; use `context.TODO()` if you don't yet have one.

---

## Edge Cases & Pitfalls

### `ctx.Done()` may return `nil`

For `context.Background()` and `context.TODO()`, `Done()` returns `nil`. A receive on a nil channel blocks forever. In a `select`, this just means that branch is never taken — fine. Don't write `if d := ctx.Done(); d != nil { ... <-d ... }`; just put `<-ctx.Done()` in a `select` and let the language handle it.

### Cancellation race with completion

If `cancel()` and the work finishing happen at nearly the same time, *both* may appear true. Your code might run the success path and then see `ctx.Err() != nil` on the next check. Handle this gracefully — either path is valid.

### `cancel()` is idempotent

Calling `cancel()` twice is safe. So is calling it after the context already expired. The internal channel is closed once and stays closed.

### `WithTimeout(parent, -1)` is already cancelled

A negative or zero timeout produces a context that is cancelled the moment it is created. `<-ctx.Done()` returns immediately. Useful for testing the cancellation path; surprising if you didn't mean it.

### Goroutines spawned without context

If you have `go someWork()` (no `ctx`), there is no signal to send. Either refactor to `go someWork(ctx)` or live with the goroutine running to completion.

### `select` with only the default branch is not a check

```go
select {
default:
}
```

This does nothing and is not a cancellation check. The correct form is `select { case <-ctx.Done(): return; default: }`.

### Multiple cancels on the same context

`cancel()` is idempotent, but if you have two goroutines both calling `cancel()` racing, the first one wins. The context is cancelled exactly once; the second call is a no-op. Both observers see the same `Done` closure.

### Cancellation does not interrupt locked critical sections

```go
mu.Lock()
defer mu.Unlock()
// cancel arrives here — but we are holding the lock
heavyWork() // runs to completion; cancellation ignored within
```

Cancellation polling must be added inside `heavyWork`, not at the lock boundary. Holding a lock and observing `<-ctx.Done()` requires explicit code inside the critical section.

---

## Common Mistakes

### Mistake 1: Accepting `ctx` but not checking it

```go
func work(ctx context.Context) {
    for i := 0; i < 1_000_000_000; i++ {
        compute(i)
    }
}
```

Caller passes `ctx`; worker never reads it. A common cargo-culted signature.

### Mistake 2: Forgetting `defer cancel()`

```go
ctx, _ := context.WithTimeout(parent, 5*time.Second) // BUG: _ discards cancel
```

`go vet` warns. The timer leaks; on a busy server, this is a slow memory leak.

### Mistake 3: Wrapping `ctx.Err()` and losing the type

```go
return fmt.Errorf("work failed: %v", ctx.Err()) // loses Is/As
```

Use `%w` to wrap and preserve error identity:

```go
return fmt.Errorf("work failed: %w", ctx.Err())
```

### Mistake 4: Treating context cancellation as a panic

Some teams `panic(ctx.Err())` to "stop everything." This kills the process. Use return values; let callers decide.

### Mistake 5: Spawning a goroutine without considering how it exits

```go
go process(item) // when does this stop?
```

Every `go` statement should have an answer to "what causes this goroutine to return?" If you cannot answer, you have a leak in waiting.

### Mistake 6: Storing context in a struct

```go
type Server struct {
    ctx context.Context // BUG
}
```

`context.Context` is for the lifetime of a *call*, not a server. The standard library docs explicitly say so. Pass `ctx` as a parameter; if you need a long-lived cancellation handle on a struct, store the `cancel` function, not the context.

### Mistake 7: Creating a new context that discards cancellation

```go
func badWrapper(parent context.Context, work func(context.Context)) {
    bg := context.Background() // throws away parent cancellation!
    work(bg)
}
```

Always derive from the parent. The right pattern is `ctx, cancel := context.WithCancel(parent)` or just pass `parent` directly.

### Mistake 8: `cancel()` as the only return path

```go
func bad() {
    ctx, cancel := context.WithCancel(context.Background())
    cancel()
    work(ctx) // work sees an already-cancelled context immediately
}
```

`cancel()` before passing means the worker sees `Done` on its first check. Useful only when you specifically want to test the cancellation path.

---

## Common Misconceptions

- **"Calling `cancel()` kills the goroutine."** No — it closes a channel. The goroutine must read that channel and return on its own.
- **"`time.Sleep` respects context."** No — `time.Sleep` does not. Use `time.NewTimer` + `select` with `<-ctx.Done()`, or `time.After`, both gated by `select`.
- **"Async preemption (Go 1.14+) cancels goroutines."** No — it preempts them. They resume later.
- **"Context with a value can do anything."** `context.WithValue` is for request-scoped data, not for arbitrary mutable state. Use sparingly.
- **"Once `ctx.Done()` fires, the goroutine has stopped."** No — `Done` firing means *the request has been made*. The goroutine may take any amount of time to notice and act.

---

## Tricky Points

- The zero value of `context.Context` is unusable. `var ctx context.Context` then `ctx.Done()` panics. Always start from `context.Background()` or `context.TODO()`.
- `ctx.Err()` only becomes non-nil after the context is cancelled. If you check it before, you get `nil`.
- A *child* context can outlive its parent only if the parent never cancels; once the parent cancels, the child cancels too.
- `context.AfterFunc(ctx, f)` (Go 1.21+) registers `f` to run when `ctx` is cancelled — useful for cleanup without spawning a goroutine.
- A goroutine started before context cancel and reading `<-ctx.Done()` may never run if the goroutine is starved. The runtime *will* schedule it, but possibly later than you expect. Cancellation latency is bounded by scheduling, not by physics.
- `context.WithCancel(ctx).Done()` returns a *new* channel — not the parent's. The parent's channel remains the same. Don't compare channel identities to test relationships.
- Calling `cancel()` from inside the goroutine being cancelled is legal and common: a worker that decides "I've reached my limit" can call its own context's cancel.
- Closing a channel that you also use for cancellation works in Go, but the convention is to use `context` for cancellation and use plain channels for data. Mixing makes intent unclear.

---

## Test

```go
func TestWorkerStopsOnCancel(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})

    go func() {
        defer close(done)
        for {
            select {
            case <-ctx.Done():
                return
            default:
            }
        }
    }()

    cancel()

    select {
    case <-done:
        // ok
    case <-time.After(time.Second):
        t.Fatal("worker did not exit on cancel")
    }
}
```

This test checks both the *signal* (cancel) and the *observation* (the goroutine exits within a bounded time).

---

## Tricky Questions

1. **You call `cancel()`. The goroutine is in the middle of a 10-second `time.Sleep`. When does it exit?** After the sleep finishes. `time.Sleep` does not observe context. Use `time.NewTimer` + `select`.
2. **You pass `context.Background()` to a long-running goroutine. How do you cancel it?** You can't. `Background` never fires `Done`. You must derive a cancellable child first.
3. **A function returns `(result, cancel)`. The caller never calls `cancel`. What leaks?** The internal timer/channel of the context; the parent retains a reference until cancelled itself.
4. **Why can't Go offer `goroutine.Kill()`?** Because the goroutine may be in the middle of: holding a mutex, inside a syscall, inside CGO, mid-`defer`. Killing at any of these points is unsafe. Cooperative cancellation is the language's answer.
5. **A goroutine is blocked on a `chan struct{}` that nobody sends to and you call `cancel()` on a context the goroutine never observes. What happens?** The goroutine leaks. Cancellation is a *signal*, not a force; if the worker never checks, it never stops.
6. **Two contexts: one with `WithTimeout(5s)`, the parent cancelled at 2s. When does the child fire `Done`?** At 2 seconds (when the parent cancels). The child cancels whenever the *first* of {parent cancels, deadline elapsed, explicit cancel} happens.
7. **Why does `defer cancel()` matter even when `WithTimeout` is going to fire anyway?** Because the timer is created at `WithTimeout` and only released by either expiry or `cancel()`. If your function returns at the 100ms mark and the timeout is 30s, you hold the timer for the full 30 seconds without `defer cancel()`.

---

## Cheat Sheet

```
context.Background()              // root, never cancels
context.TODO()                    // placeholder for unknown context
context.WithCancel(parent)        // (child, cancel)
context.WithTimeout(parent, d)    // (child, cancel), auto-cancels after d
context.WithDeadline(parent, t)   // (child, cancel), auto-cancels at t
context.WithValue(parent, k, v)   // child with key/value

<-ctx.Done()                      // blocks until cancellation
ctx.Err()                         // nil | Canceled | DeadlineExceeded
ctx.Deadline()                    // (time, ok)

// Idiom: always defer cancel
ctx, cancel := context.WithTimeout(parent, 2*time.Second)
defer cancel()
```

---

## Self-Assessment Checklist

- [ ] I can explain "cooperative cancellation" in one sentence.
- [ ] I can write a goroutine that exits on `<-ctx.Done()`.
- [ ] I always `defer cancel()` after `WithTimeout` / `WithCancel`.
- [ ] I know that `time.Sleep` does not observe context.
- [ ] I can describe a case where cancellation cannot reach a goroutine (blocking syscall, CGO).
- [ ] I never pass `nil` as a context.

---

## Summary

Go's cancellation model is **cooperative**: a goroutine stops itself when it sees a signal, and there is no API to force one to stop from outside. The signal is carried by `context.Context`, observed via `<-ctx.Done()`, and reported via `ctx.Err()`. The goroutine author is responsible for placing checks at safe points; the chunk size between checks is the cancellation latency. Forced cancellation in Go always means *the process exits* — there is no per-goroutine kill. Some operations (blocking syscalls, CGO) sit outside cooperative range and must be unblocked by closing the underlying resource. Master the basics here; the middle and senior files explore patterns, escape hatches, and the runtime details that make this design work.

---

## What You Can Build

- A graceful HTTP server that drains in-flight requests on `SIGTERM`.
- A search backend that cancels stale queries when a new one arrives.
- A scheduler that wakes up every minute, runs a job, and exits cleanly on shutdown.
- A pipeline of stages that all stop together when any stage errors.

---

## Further Reading

- *Go Blog: Concurrency Patterns: Context* — <https://go.dev/blog/context>
- *Go documentation: package context* — <https://pkg.go.dev/context>
- *Effective Go: Concurrency* — <https://go.dev/doc/effective_go#concurrency>
- *Sameer Ajmani: Pipelines and cancellation* — <https://go.dev/blog/pipelines>

---

## Related Topics

- Channels (sibling section): the underlying mechanism for `Done()`
- `select` statement: the dispatcher of cancellation
- Goroutine leaks: the failure mode of forgetting to cancel
- `errgroup` and structured concurrency: cancellation across groups of workers

---

## Diagrams & Visual Aids

```
parent ctx          child ctx          grandchild ctx
   |                    |                     |
   |--WithCancel------->|                     |
   |                    |--WithTimeout------->|
   |                    |                     |
   | cancel()           | (still alive)       | (still alive)
   |---X--------------->|---X---------------->|
   |   Done() closes    | Done() closes       | Done() closes
   v                    v                     v
```

```
goroutine work
   |
   |--chunk 1--+
   |          | <-- safe point: select { <-ctx.Done(): return; default: }
   |--chunk 2--+
   |          | <-- safe point
   |--chunk 3--+
   |          | <-- cancel arrives here; goroutine returns
   v
```
