---
layout: default
title: Cleanup Ordering — Middle
parent: Cleanup Ordering
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/middle/
---

# Cleanup Ordering — Middle Level

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
> Focus: "How do errors flow out of deferred cleanups? How do I clean up *after* a context is cancelled? How does `context.AfterFunc` fit into all of this?"

The junior level treated `defer` as a single tool: register a cleanup, let it run at exit, get on with life. That treatment works for nine out of ten functions in a typical Go program. The other one — usually the one that owns a network connection, a database transaction, an outbound HTTP body, a long-running goroutine, or a piece of state that must survive its caller — needs a deeper toolkit.

This file extends what the junior file established. We will look at:

- **Errors from deferred `Close`.** When are they fatal? When are they noise? How do you propagate them without masking the real failure?
- **Cleanup that must outlive context cancellation.** Some resources cannot be released until *after* the workload has gracefully stopped. How do you separate the cancel signal from the actual cleanup?
- **`context.AfterFunc`**, the Go 1.21 primitive that runs a callback in a new goroutine when a context is cancelled. Its semantics, its `stop` function, and its place in the cleanup story.
- **Multi-resource hierarchies.** A real service has dozens of cleanups across many packages. How do you compose them without leaking, without dropping errors, and without double-closing anything?
- **Cleanup that crosses goroutine boundaries.** A spawned goroutine's defers run when *it* exits, not when the parent exits. How do you make sure the parent waits long enough — and how does `AfterFunc` change the picture?
- **Panic recovery during cleanup.** What happens when the close itself panics? When the recover swallows a real error? When recovery is the wrong default?

By the end you will design cleanup with the same care you give to error handling: deliberately, in the right order, with errors observable to whoever needs to act on them.

This file assumes you read `junior.md` first. The LIFO defer rule, the argument-capture rule, the `os.Exit`-skips-defers rule — all of it should already feel obvious.

---

## Prerequisites

- **Required:** Comfort with the junior content of this sub-topic.
- **Required:** Working understanding of `context.Context`, `context.WithCancel`, `context.WithTimeout`, and the `Done()` channel.
- **Required:** Familiarity with `errors.Is`, `errors.As`, `errors.Join`, `fmt.Errorf` with `%w`, and Go's wrapped-error model.
- **Required:** Working understanding of `sync.WaitGroup`, `sync.Mutex`, `sync.Once`, and channels for signalling.
- **Helpful:** Some exposure to `database/sql.Tx.Commit`/`Rollback`, `http.Response.Body.Close`, and `bufio.Writer.Flush` patterns from real code.
- **Helpful:** Experience reading the standard library, particularly `net/http`'s `Server.Shutdown` and `database/sql`'s `DB.Close`.

If `defer f.Close()` is muscle memory and you have ever debugged a goroutine leak that turned out to be a missing `cancel`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`context.AfterFunc`** | Go 1.21 function: `stop := context.AfterFunc(ctx, fn)`. Schedules `fn` to run in its own goroutine after `ctx` is done. Returns a `stop` function that deregisters the callback. |
| **`stop` function** | The function returned by `AfterFunc`. Calling it before the context is done deregisters the callback (it will not run). Calling it after the callback has *started* is a no-op — it does not interrupt or wait. |
| **Cause** | Go 1.20+: `context.Cause(ctx)` returns the value passed to `context.WithCancelCause`'s `cancel(err)`, or `ctx.Err()` if no cause was supplied. Useful for distinguishing "cancel because of an error" from "cancel because of timeout." |
| **Cleanup-after-cancel** | The pattern of running cleanup *after* a context is cancelled, in a context-independent goroutine. Often implemented with `AfterFunc` or with a dedicated shutdown channel. |
| **Idempotent close** | A `Close` method that is safe to call more than once. Most std-lib closers are idempotent in the sense that subsequent calls return an error but do not crash. Some custom closers are not — these need `sync.Once`. |
| **Drain** | The act of consuming all remaining values from a channel, a response body, or a pipeline before closing. Crucial for resources that hold buffers. |
| **Cancel-then-drain** | A two-step cleanup: first cancel the context to stop new work, then drain the in-flight work, then close the resources. The most common shutdown pattern in production Go. |
| **Resource hierarchy** | A directed acyclic graph of resources where each has a release order constraint imposed by its dependencies on others. |
| **`errgroup.Group`** | The `golang.org/x/sync/errgroup` package. Like `sync.WaitGroup` but propagates the first non-nil error from any of its goroutines and cancels their shared context. |
| **`sync.OnceFunc` / `sync.OnceValue`** | Go 1.21 wrappers around `sync.Once` that produce a function callable many times but running its body exactly once. Useful for idempotent close. |

---

## Core Concepts

### Concept 1: Errors from `Close` are real

The junior file mentioned this. At the middle level, we make it a principle: *for any writer or any transaction-like resource, the error from `Close` is part of the function's contract.*

```go
func writeOut(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    _, err = f.Write(data)
    return err
}
```

Three rules:

1. Use a named return value (`err error`) so the defer can see and modify it.
2. The deferred closure attempts the close and *only* overwrites `err` if `err` is currently nil. This way, the *first* error wins — a real write failure is not masked by a cosmetic close failure.
3. The closure does its own `cerr` local to avoid shadowing.

For readers, the close error is usually noise (read-close almost never fails in a way that matters). For writers, ignoring the close error is a real bug — kernel buffers may not have flushed, network filesystems may report problems on close, and the data you thought you wrote may not exist.

### Concept 2: `defer cancel()` is a release, not a cleanup

When a context is cancelled, two things happen:

1. `ctx.Done()` closes — observers wake up.
2. Any descendant contexts are also marked done.

But cancellation does *not* close your file, end your transaction, drain your channels, or stop your goroutines. Those are *your* responsibility.

The `defer cancel()` at the top of every function that calls `context.With*` exists to *release* the context's internal book-keeping — primarily, the timer (for timeouts) and the goroutine that watches the parent for propagation. Skipping it leaks both.

The `cancel` is *also* what makes cancellation actually cancel. If your function returns successfully but never calls `cancel`, descendant contexts have no idea you have finished. They might keep running. `defer cancel()` handles both the signalling and the release in one line.

### Concept 3: Cleanup that must outlive the function

Consider a request handler that starts a background job and returns immediately:

```go
func (s *Server) HandleStart(w http.ResponseWriter, r *http.Request) {
    job, err := s.startJob(r.Context())
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    w.Write([]byte(job.ID))
}
```

The handler's `defer`s fire when the handler returns. The job, however, may run for minutes. Its cleanup *cannot* be in the handler — it must be in the job goroutine itself, or wired up via `AfterFunc` on a context that outlives the handler.

This is the cleanup-after-cancel pattern. The handler kicks off the work; the work owns its own cleanup; a long-lived context governs both.

### Concept 4: `context.AfterFunc` decouples cleanup from the registering goroutine

Go 1.21 introduced `context.AfterFunc(ctx, fn) (stop func() bool)`. The semantics:

- `fn` runs in its own goroutine the moment `ctx` is done.
- If `ctx` is already done when `AfterFunc` is called, `fn` is scheduled immediately.
- The returned `stop` deregisters `fn`. Calling `stop` before `fn` has started returns true; calling it after `fn` has started returns false. `stop` never waits.
- `fn` runs at most once.

The key is that `fn` runs in a *fresh* goroutine. It is not bound to the goroutine that called `AfterFunc`. This is the right tool for cleanup that must:

- Survive the registering function's return
- Survive arbitrary panics in the registering goroutine
- React promptly to cancellation without polling

But it also opens questions:

- The fresh goroutine might run *concurrently* with the registering goroutine's remaining work. Synchronisation is your job.
- `stop` returning `false` does not guarantee `fn` has *finished* — only that it has started. If you need to wait for it, signal explicitly.
- `fn` runs even if cancellation happened via timeout or parent propagation, not just via your own `cancel()`.

### Concept 5: Cancel-then-drain-then-close

The single most common shutdown pattern in production Go is:

1. **Cancel.** Send the signal that says "no more work."
2. **Drain.** Consume any remaining buffered work; let in-flight tasks finish.
3. **Close.** Release the resources.

In code:

```go
func (s *Service) Shutdown(ctx context.Context) error {
    s.cancel()              // step 1
    if err := s.workers.Wait(); err != nil { // step 2
        return err
    }
    return s.db.Close()      // step 3
}
```

Each step depends on the previous. If you close the DB before workers finish, workers panic on a closed connection. If you cancel without waiting, the workers run on a phantom context. If you skip cancel, the workers never know to stop and `Wait` hangs forever.

LIFO defers naturally match this when you write a single function:

```go
func main() {
    db := openDB()
    defer db.Close()                // step 3 (registered first → pops last)

    workers := startWorkers(db)
    defer workers.Wait()            // step 2 (registered second → pops second-to-last)

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()                  // step 1 (registered third → pops first)

    run(ctx, workers)
}
```

The LIFO order — `cancel` first, then `Wait`, then `Close` — is exactly cancel-then-drain-then-close.

### Concept 6: A goroutine's own defers vs the parent's defers

When `parent` spawns `child`, the child's defers run when `child` returns. The parent's defers run when `parent` returns. They are independent.

This means:

- A defer in `parent` cannot clean up a resource owned by `child`.
- A defer in `child` cannot wait for `parent` to do anything.
- If `parent` returns before `child` exits, *child is still running*. Its defers will fire eventually — when `child` finally returns — but the parent's view of the world has moved on.

For graceful shutdown across goroutines, you need explicit coordination: `WaitGroup`, `errgroup.Group`, channels, or `AfterFunc`. The defer mechanism alone cannot bridge goroutines.

### Concept 7: Idempotent cleanup is the default

Most cleanup functions in the standard library are idempotent: calling them a second time returns an error but does not crash. `os.File.Close`, `http.Response.Body.Close`, `database/sql.Tx.Rollback`, `context.CancelFunc` — all safe to call multiple times.

Custom cleanups are often *not* idempotent. A naive `chan struct{}` close panics on second close. A naive map of resources errs if you remove a missing key. You can make any cleanup idempotent with `sync.Once`:

```go
var once sync.Once
closeOnce := func() error {
    var err error
    once.Do(func() { err = real.Close() })
    return err
}
```

Or with Go 1.21's `sync.OnceFunc`:

```go
closeOnce := sync.OnceFunc(func() { real.Close() })
```

If you build a library, prefer to make your `Close` idempotent. Callers will accidentally close twice. Make their lives easy.

---

## Real-World Analogies

### Closing a restaurant for the night

The kitchen has a routine:

1. Stop taking new orders (cancel).
2. Cook the in-flight orders (drain).
3. Wash the dishes, lock the doors, set the alarm (close).

If you skip step 1, you keep getting orders. If you skip step 2, you have half-cooked food in the oven when you turn it off. If you skip step 3, the rats win. Each step depends on the previous having finished.

### Closing a hotel for renovation

Hotels usually close in phases: stop bookings months ahead, ask remaining guests to leave by a date, then begin renovation. The phases are exactly cancel-then-drain-then-close, scaled out over weeks. Software shutdown is a faster version of the same dance.

### A scientific experiment shutdown

When a particle collider goes offline, you do not cut the power. You first stop accelerating new particles (cancel), let the beam decay (drain), then power down magnets and cool systems in a specific order (close). Skipping the order can damage equipment irreversibly. Software does not damage hardware, but a service that closes its TCP listener before draining in-flight connections delivers truncated responses — the software equivalent of a half-cooked dish.

---

## Mental Models

### Model 1: The cleanup pyramid

```
                       ┌─────────────┐
                       │   Cancel    │   step 1: send the signal
                       └──────┬──────┘
                              │
                       ┌──────▼──────┐
                       │    Drain    │   step 2: wait for in-flight
                       └──────┬──────┘
                              │
                       ┌──────▼──────┐
                       │    Close    │   step 3: release resources
                       └─────────────┘
```

Each layer of the pyramid depends on the previous. Reverse the order and the pyramid collapses.

### Model 2: Two clocks — work-time and cleanup-time

Imagine your program runs two clocks. Work-time advances while you do useful things. Cleanup-time advances during shutdown. The two never overlap: cleanup-time begins exactly when work-time ends. `cancel()` is the bell that announces the transition.

For `AfterFunc` callbacks, the bell rings in one goroutine and the callback starts in another — both during cleanup-time. They may run *in parallel*. If they touch shared state, you need locks or channels.

### Model 3: A graph of dependencies

Every resource has a release-after-edge to the resources it depends on:

```
  HTTP server  --depends on-->  worker pool
  worker pool  --depends on-->  database pool
  database pool --depends on-->  network connection
```

Release order is a topological sort: HTTP first, then workers, then DB, then network. LIFO defers in a single function with the right acquisition order encode this implicitly. For larger systems, explicit cleanup managers — sometimes built on `AfterFunc` — encode it explicitly.

### Model 4: AfterFunc as a "react on cancel" hook

Think of `AfterFunc` as a callback wire from the context to a goroutine. The context fires; the wire goes hot; the callback runs once.

```
ctx.Done() closes ───────► AfterFunc fires fn() in a new goroutine
```

The wire can be cut early (call `stop`). The wire fires once and only once. The callback runs concurrently with everything else.

---

## Pros & Cons

### Pros of cleanup-after-cancel via `AfterFunc`

- **Decouples cleanup from caller.** The function that registers the callback may return; the callback still fires.
- **Reacts immediately to cancellation.** No polling, no timer.
- **One-shot.** Even with thousands of registrations, each fires at most once.
- **Stop is cheap.** Calling `stop()` early deregisters cleanly.

### Cons / costs of `AfterFunc`

- **Runs in a new goroutine.** Synchronisation with other goroutines is your job.
- **No back-pressure.** If 10,000 contexts are cancelled at once, 10,000 callbacks start at once. Bursty.
- **`stop` does not wait.** If you need to know the callback finished, you have to signal explicitly.
- **Hides control flow.** Reading a function with five `AfterFunc` calls is harder than reading one with five `defer`s. Use carefully.
- **Memory cost.** Each registration keeps `fn` alive on the context's internal list until the context is done or `stop` is called. Long-lived contexts with many registrations can accumulate.

### Pros of deferred close with error propagation

- **Centralised.** One defer at the top of the function covers all exit paths.
- **Errors visible.** With named returns and the close-overwrites-only-if-nil pattern, the caller sees both the work error (priority) and the close error (fallback).
- **Robust.** Works correctly with panics; no need to remember `Close` in every error branch.

### Cons

- **Verbose.** The four-line closure is a lot for one resource. Tooling helpers (or `errgroup`) can compress it.
- **Easy to get the order wrong.** A nested function with deferred close inside a deferred function inside a deferred function is hard to read; ordering bugs sneak in.

---

## Use Cases

### `AfterFunc` is the right tool for:

- **Cancelling a database query that does not respect context.** Some drivers ignore the context; `AfterFunc(ctx, func(){ tx.Rollback() })` forces a rollback on cancel.
- **Cleanup of a goroutine that does not poll the context.** Hardware drivers, third-party libraries, etc.
- **Logging or metrics on cancellation.** `AfterFunc(ctx, func(){ metrics.Inc("cancelled") })`.
- **Cascading cancels to non-context-aware code.** `AfterFunc(ctx, func(){ close(stop) })`.
- **Releasing a resource that outlives the function that acquired it.** A long-lived cache entry, for instance.

### `AfterFunc` is *not* the right tool for:

- **Cleanup that should run on every function exit (success or failure).** Use `defer`.
- **Cleanup that needs to read or modify a named return.** Use `defer`.
- **Cleanup that must complete before the function returns.** Use `defer`, optionally with an explicit `Wait`.

### Defer with named return is the right tool for:

- **Closing a file you wrote.** Errors from `Close` need propagation.
- **Wrapping errors with context.** `defer func() { err = fmt.Errorf("processOrder: %w", err) }()`.
- **Tracing.** `defer trace.End()` patterns.

### Defer is *not* the right tool for:

- **Cleanup that must run after the function but on a separate goroutine.** Use `AfterFunc` or a shutdown channel.
- **Cleanup that depends on values produced after the function returns.** It cannot see them.

---

## Code Examples

All examples compile with Go 1.21+.

### Example 1: Close error propagation, classic pattern

```go
package main

import (
    "fmt"
    "io"
    "os"
)

func writeTo(path string, src io.Reader) (err error) {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    _, err = io.Copy(f, src)
    return err
}

func main() {
    src, _ := os.Open("/etc/hostname")
    defer src.Close()
    if err := writeTo("/tmp/out.txt", src); err != nil {
        fmt.Println("error:", err)
    } else {
        fmt.Println("ok")
    }
}
```

The deferred closure attempts the close. If `io.Copy` succeeded (so `err == nil`), and `Close` failed, the close error is reported. If both failed, only `io.Copy`'s error is reported — the user gets the *first* failure.

### Example 2: Close error with `errors.Join` for both-errors visibility

```go
package main

import (
    "errors"
    "fmt"
    "io"
    "os"
)

func writeBoth(path string, src io.Reader) (err error) {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil {
            err = errors.Join(err, cerr)
        }
    }()
    _, err = io.Copy(f, src)
    return err
}

func main() {
    src, _ := os.Open("/etc/hostname")
    defer src.Close()
    err := writeBoth("/tmp/out2.txt", src)
    fmt.Println("err:", err)
}
```

`errors.Join` is the right tool when you want the caller to see *all* the failures. It returns nil if all inputs are nil, a single error if only one is non-nil, and a joined multi-error otherwise. Callers can use `errors.Is`/`errors.As` to inspect either.

### Example 3: `context.AfterFunc` for cancel-driven cleanup

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    stop := context.AfterFunc(ctx, func() {
        fmt.Println("cleanup running")
    })
    defer stop()

    fmt.Println("doing work")
    time.Sleep(50 * time.Millisecond)
    cancel()
    time.Sleep(50 * time.Millisecond)
}
```

Output:

```
doing work
cleanup running
```

The callback ran in a fresh goroutine after `cancel`. The deferred `stop()` at the end is a no-op (the callback already started), but it is good practice: it makes the function safe even when the path through it does not call `cancel`.

### Example 4: `stop()` deregisters before fire

```go
package main

import (
    "context"
    "fmt"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())

    stop := context.AfterFunc(ctx, func() {
        fmt.Println("this should NOT run")
    })

    fmt.Println("stop returns:", stop()) // true: callback was not yet scheduled
    cancel()
    // The callback does not run because we deregistered it.
    fmt.Println("done")
}
```

Output:

```
stop returns: true
done
```

`stop` returned `true`, meaning the callback was deregistered before it could fire.

### Example 5: AfterFunc + WaitGroup for "wait for callback to finish"

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    var wg sync.WaitGroup
    wg.Add(1)
    stop := context.AfterFunc(ctx, func() {
        defer wg.Done()
        fmt.Println("starting cleanup")
        time.Sleep(50 * time.Millisecond)
        fmt.Println("cleanup done")
    })
    defer stop()

    cancel()
    wg.Wait()
    fmt.Println("main exits")
}
```

`AfterFunc` itself does not let you wait for the callback. The `WaitGroup` does. If `cancel()` was called, the callback runs and decrements the group. If we never called `cancel()`, we would need to handle the case where the callback never fires — for instance by calling `wg.Done()` ourselves after `stop()` returns true. This is a real edge case; see the patterns section.

### Example 6: `errgroup.Group` with proper cleanup ordering

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

func work(ctx context.Context, name string, d time.Duration) error {
    select {
    case <-time.After(d):
        return nil
    case <-ctx.Done():
        return fmt.Errorf("%s: %w", name, ctx.Err())
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return work(ctx, "a", 50*time.Millisecond) })
    g.Go(func() error { return work(ctx, "b", 200*time.Millisecond) })

    if err := g.Wait(); err != nil {
        if errors.Is(err, context.DeadlineExceeded) {
            fmt.Println("at least one worker timed out:", err)
        } else {
            fmt.Println("error:", err)
        }
    }
}
```

`errgroup.WithContext` returns a derived context that is cancelled the first time any goroutine returns a non-nil error. `g.Wait()` returns that first error after all goroutines have exited. The defer `cancel()` is still needed for the case where neither error nor timeout fires.

### Example 7: Cancel-then-drain pattern

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Worker struct {
    in   chan string
    quit context.CancelFunc
    ctx  context.Context
    wg   sync.WaitGroup
}

func NewWorker() *Worker {
    ctx, cancel := context.WithCancel(context.Background())
    w := &Worker{
        in:   make(chan string, 10),
        ctx:  ctx,
        quit: cancel,
    }
    w.wg.Add(1)
    go w.loop()
    return w
}

func (w *Worker) loop() {
    defer w.wg.Done()
    for {
        select {
        case <-w.ctx.Done():
            // drain remaining items
            for {
                select {
                case s := <-w.in:
                    fmt.Println("drained:", s)
                default:
                    return
                }
            }
        case s := <-w.in:
            fmt.Println("processed:", s)
        }
    }
}

func (w *Worker) Submit(s string) { w.in <- s }
func (w *Worker) Shutdown()       { w.quit(); w.wg.Wait() }

func main() {
    w := NewWorker()
    for i := 0; i < 5; i++ {
        w.Submit(fmt.Sprintf("item-%d", i))
    }
    time.Sleep(10 * time.Millisecond)
    w.Shutdown()
    fmt.Println("done")
}
```

The worker's loop has two modes: normal (process incoming) and draining (on cancel, consume remaining buffered items and exit). The `Shutdown` cancels the context, then waits. The buffered items are flushed before exit.

### Example 8: `AfterFunc` to forcibly cancel a slow query

```go
package main

import (
    "context"
    "fmt"
    "time"
)

// imagine this is a third-party library that does not respect context
type slowQuery struct {
    done chan struct{}
}

func (q *slowQuery) Cancel() {
    select {
    case <-q.done:
    default:
        close(q.done)
    }
}

func (q *slowQuery) Run() {
    select {
    case <-q.done:
        fmt.Println("query: cancelled externally")
    case <-time.After(time.Second):
        fmt.Println("query: completed")
    }
}

func runWithDeadline(ctx context.Context) {
    q := &slowQuery{done: make(chan struct{})}
    stop := context.AfterFunc(ctx, q.Cancel)
    defer stop()

    q.Run()
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()
    runWithDeadline(ctx)
}
```

Even though `slowQuery.Run` does not check `ctx`, the `AfterFunc` calls `q.Cancel` on timeout, unblocking the query.

### Example 9: Defer with `context.WithCancelCause`

```go
package main

import (
    "context"
    "errors"
    "fmt"
)

var errBadRequest = errors.New("bad request")

func main() {
    ctx, cancel := context.WithCancelCause(context.Background())
    defer cancel(nil) // nil cause if we cancel without an error

    go func() {
        // ... validate ...
        cancel(errBadRequest)
    }()

    <-ctx.Done()
    if errors.Is(context.Cause(ctx), errBadRequest) {
        fmt.Println("aborted because of:", context.Cause(ctx))
    }
}
```

`context.Cause(ctx)` returns the specific error passed to `cancel`. `ctx.Err()` still returns `context.Canceled` — the cause is separate metadata. Useful for propagating reasons through cleanup paths.

### Example 10: Cleanup that depends on Cause

```go
package main

import (
    "context"
    "errors"
    "fmt"
)

var errFatal = errors.New("fatal")

func cleanupBasedOnCause(ctx context.Context) {
    stop := context.AfterFunc(ctx, func() {
        cause := context.Cause(ctx)
        if errors.Is(cause, errFatal) {
            fmt.Println("PANIC RECOVERY: writing crash dump")
        } else {
            fmt.Println("normal shutdown")
        }
    })
    defer stop()

    // simulate a fatal cause
    if cancel, ok := ctx.Value("cancel").(context.CancelCauseFunc); ok {
        cancel(errFatal)
    }
}

func main() {
    ctx, cancel := context.WithCancelCause(context.Background())
    ctx = context.WithValue(ctx, "cancel", cancel)
    cleanupBasedOnCause(ctx)
}
```

A bit contrived, but the principle is real: cleanup can branch on the cause, performing different actions for crash vs graceful exit.

### Example 11: Multi-resource cleanup with explicit ordering

```go
package main

import (
    "errors"
    "fmt"
)

type res struct {
    name string
    err  error
}

func (r *res) Close() error {
    if r.err != nil {
        return fmt.Errorf("%s: %w", r.name, r.err)
    }
    fmt.Println("closed", r.name)
    return nil
}

func use() (err error) {
    a := &res{name: "a"}
    defer func() { err = errors.Join(err, a.Close()) }()
    b := &res{name: "b", err: errors.New("boom")}
    defer func() { err = errors.Join(err, b.Close()) }()
    c := &res{name: "c"}
    defer func() { err = errors.Join(err, c.Close()) }()
    return nil
}

func main() {
    fmt.Println(use())
}
```

Output (approximate):

```
closed c
closed a
b: boom
```

LIFO order: c first, b second, a third. `errors.Join` collects each non-nil error. The caller sees one combined error containing `b`'s failure.

### Example 12: HTTP server shutdown with deadline

```go
package main

import (
    "context"
    "fmt"
    "net/http"
    "time"
)

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(50 * time.Millisecond)
        fmt.Fprintln(w, "hello")
    })

    srv := &http.Server{Addr: ":0", Handler: mux}
    go func() { _ = srv.ListenAndServe() }()

    time.Sleep(20 * time.Millisecond)

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        fmt.Println("shutdown:", err)
    } else {
        fmt.Println("clean shutdown")
    }
}
```

`Server.Shutdown` does the cancel-then-drain dance internally: stops accepting new connections, then waits up to the deadline for in-flight handlers, then returns. The deadline context governs the maximum wait. Without it, a hung handler would hang the shutdown.

### Example 13: Layered defer with named returns

```go
package main

import (
    "errors"
    "fmt"
)

type fakeTx struct {
    committed bool
}

func (t *fakeTx) Commit() error {
    if !t.committed {
        t.committed = true
        return nil
    }
    return errors.New("already committed")
}

func (t *fakeTx) Rollback() error {
    if t.committed {
        return nil
    }
    t.committed = true
    return nil
}

func process() (err error) {
    tx := &fakeTx{}
    defer func() {
        if err != nil {
            if rerr := tx.Rollback(); rerr != nil {
                err = errors.Join(err, rerr)
            }
        }
    }()
    // ... do work ...
    return tx.Commit()
}

func main() {
    fmt.Println(process())
}
```

The deferred function only rolls back if the work returned an error. This is the canonical Go transaction pattern, with proper error joining.

### Example 14: A guard for "ensure cleanup runs exactly once"

```go
package main

import (
    "fmt"
    "sync"
)

type Guard struct {
    once sync.Once
    fn   func()
}

func (g *Guard) Trigger() { g.once.Do(g.fn) }

func main() {
    g := &Guard{fn: func() { fmt.Println("cleanup") }}
    g.Trigger()
    g.Trigger() // no-op
    g.Trigger() // no-op
}
```

The `sync.Once` ensures `fn` runs exactly once regardless of how many callers ask. Useful when cleanup is shared between a defer and an explicit shutdown path.

### Example 15: Combining `AfterFunc` and a manual close

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Service struct {
    cancel context.CancelFunc
    stop   func() bool
    closed sync.Once
}

func NewService(ctx context.Context) *Service {
    cctx, cancel := context.WithCancel(ctx)
    s := &Service{cancel: cancel}
    s.stop = context.AfterFunc(cctx, s.onCancel)
    return s
}

func (s *Service) onCancel() {
    fmt.Println("service: cancelled, releasing resources")
}

func (s *Service) Close() {
    s.closed.Do(func() {
        s.cancel()
        s.stop()
        fmt.Println("service: closed")
    })
}

func main() {
    s := NewService(context.Background())
    time.Sleep(10 * time.Millisecond)
    s.Close()
    s.Close() // safe, no-op
    time.Sleep(10 * time.Millisecond)
}
```

The `Close` method is idempotent thanks to `sync.Once`. It cancels the internal context (triggering `onCancel` via `AfterFunc`), then calls `stop()` (a no-op if the callback has already started), then logs. Repeated calls do nothing.

### Example 16: A pipeline with proper drain on cancel

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func produce(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}

func consume(ctx context.Context, in <-chan int) {
    for {
        select {
        case <-ctx.Done():
            // drain remaining values
            for range in {
            }
            return
        case v, ok := <-in:
            if !ok {
                return
            }
            fmt.Println("got", v)
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
    defer cancel()

    out := produce(ctx)
    consume(ctx, out)
    fmt.Println("clean exit")
}
```

The consumer drains `in` after the context cancels. Without this drain, the producer might be blocked trying to send into `out` even after the consumer has stopped. Drain-on-cancel keeps the producer's `select` unblocked so it can notice cancellation and exit.

---

## Coding Patterns

### Pattern 1: Close-with-named-return

```go
func write() (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    // ... write ...
    return nil
}
```

The single most reusable pattern in the chapter. Memorise it.

### Pattern 2: Close-or-join

```go
defer func() { err = errors.Join(err, closer.Close()) }()
```

When you want *both* errors visible to the caller.

### Pattern 3: AfterFunc + stop

```go
stop := context.AfterFunc(ctx, cleanup)
defer stop()
```

Always pair `AfterFunc` with `defer stop()`. The `stop` is cheap, and it makes the function safe whether or not cancellation actually happens.

### Pattern 4: Cancel-then-Wait

```go
defer wg.Wait()
defer cancel()
```

Two defers, LIFO order: cancel fires first (sends the signal), then `Wait` fires (waits for goroutines). This is exactly what shutdown should do.

### Pattern 5: Idempotent close with `sync.Once`

```go
type Service struct {
    closed sync.Once
}
func (s *Service) Close() error {
    var err error
    s.closed.Do(func() { err = s.realClose() })
    return err
}
```

Callers can `defer s.Close()` and call `s.Close()` explicitly without fearing double-close.

### Pattern 6: Roll-back-on-error transaction

```go
defer func() {
    if err != nil {
        if rerr := tx.Rollback(); rerr != nil {
            err = errors.Join(err, rerr)
        }
    }
}()
return tx.Commit()
```

If the body's work succeeded, `Commit` runs and returns nil; defer sees `err == nil` and does nothing. If anything failed, `err != nil` and rollback fires.

### Pattern 7: Drain-on-cancel inside a select

```go
for {
    select {
    case <-ctx.Done():
        for range in { } // drain
        return
    case v := <-in:
        process(v)
    }
}
```

The drain loop unblocks the producer so it can also notice the cancel.

### Pattern 8: `errgroup` with shared context

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return worker(ctx) })
g.Go(func() error { return worker(ctx) })
return g.Wait()
```

The shared `ctx` is cancelled on the first error. All workers see the cancel and exit. `Wait` returns the first error.

### Pattern 9: A trace-end defer that includes errors

```go
defer func(start time.Time) {
    log.Printf("%s elapsed=%s err=%v", name, time.Since(start), err)
}(time.Now())
```

The named return `err` is captured by the closure (not the argument). The start time is captured by argument (evaluated at defer).

### Pattern 10: Conditional cleanup via flag

```go
canceled := false
defer func() {
    if !canceled {
        cleanup()
    }
}()
// ... later ...
explicitCleanup()
canceled = true
```

If you take the explicit path, the defer is a no-op; if you do not, the defer covers you.

---

## Clean Code

### 1. Name your returns when defers participate

If the deferred closure reads or writes the error, name it. The signature `(err error)` is a clear signal to readers.

### 2. Keep deferred closures short

A deferred closure should do one thing: close a resource, modify an error, log a metric. Multi-line logic in a defer is hard to read and even harder to test. Extract a helper.

### 3. Avoid `defer` for "release-then-reacquire" patterns

If you need to release a lock or close a file midway through a function, do it explicitly. A defer is a promise of "release on exit" — promising "release somewhere mid-function" via defer is fighting the tool.

### 4. Document the cleanup contract

For exported types with `Close`/`Stop`/`Cancel` methods, document:
- Is it idempotent?
- Does it block until cleanup completes?
- Does it return an error, and what kinds?
- Is it safe to call from multiple goroutines?

### 5. Prefer `errors.Join` over silent drops

When multiple errors might surface from cleanup, joining them is almost always better than picking one.

### 6. Use `context.AfterFunc` sparingly

`AfterFunc` is powerful but invisible — readers do not see the callback at the call site. Reach for it when defer cannot do the job; do not use it as a general-purpose cleanup primitive.

---

## Product Use / Feature

### Real product features that demand careful cleanup ordering

- **Graceful HTTP shutdown.** `net/http`'s `Server.Shutdown` is the canonical example. It stops accepting new connections, then waits for in-flight handlers to finish, with a deadline. Order: cancel listener → drain handlers → close transport.
- **Distributed tracing flush.** `opentelemetry-go` and `go.opencensus.io` both require an explicit shutdown of the exporter. If you defer it *after* your application's main work, LIFO unwinding gives you the right order: app work finishes, then exporter shuts down (flushing any pending spans).
- **Worker pool drain.** `golang.org/x/sync/errgroup` is the standard tool. Combined with a cancellable context, it gives you cancel-then-drain in a few lines.
- **Database transaction rollback on error.** `database/sql`'s `Tx.Rollback` is safe to call after `Commit` (returns `sql.ErrTxDone`). The deferred-rollback-then-commit pattern is in every production Go service.
- **File flush on close.** `bufio.Writer` over `os.File` requires `Flush` before `Close`. If you only `defer f.Close()`, you lose the buffered bytes. The right pattern is `defer w.Flush(); defer f.Close()` — both deferred, LIFO unwinding gives `Flush` first.
- **gRPC client/server lifecycle.** `grpc.Server.GracefulStop` is similar to HTTP. Clients require `Conn.Close` after all streams are done.
- **Kafka/RabbitMQ producer shutdown.** Both libraries require explicit close to flush pending messages. Forgetting it = lost messages.

In each case, the order is the same: cancel → drain → close. The Go tools (defer, AfterFunc, errgroup) compose to make this easy.

---

## Error Handling

### The four error-handling situations in cleanup

1. **Cleanup succeeds, work succeeded.** Return nil. Easy.
2. **Cleanup succeeds, work failed.** Return the work error. Easy.
3. **Cleanup fails, work succeeded.** Return the cleanup error. The "only overwrite if nil" pattern handles this.
4. **Cleanup fails, work failed.** Return one (work's) or join both. `errors.Join` for joining; the "only if nil" pattern for the work-wins choice.

### Wrapping errors with context

```go
defer func() {
    if err != nil {
        err = fmt.Errorf("processOrder(%d): %w", orderID, err)
    }
}()
```

Wraps every non-nil exit with the function's context. The caller's stack trace becomes self-explanatory.

### Panic during cleanup

If a deferred function panics, the runtime keeps unwinding subsequent defers. The original panic value (if any) is replaced. If you want to be robust:

```go
defer func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("cleanup panic: %v", r)
        }
    }()
    cleanup()
}()
```

The inner recover catches a panic inside `cleanup` without disturbing the outer flow. Use sparingly — silently swallowed panics are hard to debug.

### `recover` in long-running goroutines

A worker goroutine that lives for the lifetime of the program should *always* have a top-level `defer recover`:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
        }
    }()
    workerLoop()
}()
```

Otherwise a single panic kills the whole process. The recover lets you log and restart the worker if needed.

### Error joins and `errors.Is`

`errors.Join(a, b)` returns an error whose `Is(x)` returns true iff `errors.Is(a, x) || errors.Is(b, x)`. So:

```go
err := errors.Join(io.EOF, os.ErrNotExist)
errors.Is(err, io.EOF)        // true
errors.Is(err, os.ErrNotExist) // true
```

Useful when cleanup can fail with multiple distinct kinds of error and callers want to react to any of them.

---

## Security Considerations

### Cleanup as a security control

- **Secret data in memory.** If you keep secrets in a `[]byte`, defer-clear them: `defer zero(secret)`. Without it, the data lingers until GC, potentially observable to debuggers or core dumps.
- **TLS sessions.** Always defer-close TLS connections. Skipping the close-notify alert lets a network attacker pretend the connection ended normally when it was actually cut.
- **File permissions.** Set restrictive permissions *before* writing sensitive data, not in a deferred call. Otherwise the data exists with default perms for a window.
- **Audit logging.** If you log every cancellation, use `AfterFunc(ctx, audit)` — it fires the moment cancel happens, not when your function returns. For investigations, the timing of cancellation matters.
- **Cleanup-on-panic.** A panic during a critical section that holds a credential must release the credential. `defer` makes this automatic.

### Cleanup as a denial-of-service surface

- **Cleanup that blocks.** If your `Close` does I/O, an attacker who induces many concurrent closes can exhaust threads or memory. Use deadlines on `Close` when possible.
- **AfterFunc storms.** Cancelling 100,000 contexts at once spawns 100,000 goroutines. If those callbacks each do real work, the system can fall over. Rate-limit, or use a worker pool to drain the callback work.
- **Hung close on shutdown.** If your service waits on `db.Close()` and the DB is gone, you may never shut down. Always use a deadline on shutdown contexts.

---

## Performance Tips

- **Open-coded defers** are the default for functions with eight or fewer defers and no loops. Cost: a few extra instructions.
- **Heap defers** (in loops or beyond eight) allocate ~~ 64 bytes per defer record. Per-call cost: a few ns.
- **`AfterFunc` registration cost** is small — a struct allocation and an atomic op on the context's callback list. Per registration: tens of ns.
- **`AfterFunc` callback cost** is one goroutine creation + the callback body. If you register and cancel thousands per second, profile.
- **`errors.Join` allocation.** `errors.Join` allocates if it has more than one non-nil input. Usually negligible.
- **Repeated `Close` calls** are usually cheap. `sync.Once` adds one atomic compare-and-swap per call.

Premature optimisation of cleanup is almost always wrong. Get the correctness first. Profile second.

---

## Best Practices

- Always pair `context.With*` with `defer cancel()`.
- Always pair `context.AfterFunc` with `defer stop()`.
- Always use named returns when defers participate in error reporting.
- For writers, never silently drop the close error.
- For long-lived goroutines, always wrap the body with `defer recover()`.
- Idempotency: make your own `Close`s safe to call twice.
- Use `errors.Join` to surface multiple cleanup failures.
- Use `errgroup.Group` for "wait for many goroutines, first error wins."
- For graceful shutdown, always cancel → drain → close in that order.
- Document `Close`/`Stop`/`Shutdown` semantics in your exported APIs.

---

## Edge Cases & Pitfalls

### `AfterFunc` callback runs in parallel with the function that registered it

```go
func dangerous(ctx context.Context) {
    var n int
    context.AfterFunc(ctx, func() { n++ }) // race: callback may write n
    // ... function reads or writes n ...
}
```

No synchronisation = data race. Use a mutex or channel.

### `stop` returning `false` does not mean "callback finished"

It only means "the callback has already started (or finished)." If you need to wait for completion, use a `WaitGroup` or a channel.

### `AfterFunc` on a context that is already done

The callback is scheduled immediately. If you call `AfterFunc(ctx, fn)` and `ctx.Err() != nil` already, `fn` is queued for the next runtime cycle. Do not assume it has fired before your next line of code.

### `stop` *plus* defer can deadlock if `stop` waits on the callback

`context.AfterFunc.stop` does *not* wait, so no deadlock there. But if you write a custom `stop` that joins the callback's `WaitGroup`, and the callback is waiting on something the registering goroutine still holds, you deadlock. Keep callbacks short and self-contained.

### `errgroup.WithContext` cancels on first error

If you have non-trivial cleanup in your goroutines, the cancel may interrupt them mid-cleanup. Either make cleanup uncancellable (use a fresh `context.Background()` for cleanup), or accept that early-exit may abandon some cleanup.

### Named returns and `return` with explicit values

```go
func f() (n int) {
    defer func() { n++ }()
    return 5
}
```

Returns 6. `return 5` assigns 5 to `n`, defer increments to 6, function returns 6. This surprises people every day.

### `errors.Join(nil)` returns `nil`

```go
err := errors.Join(nil)
fmt.Println(err == nil) // true
```

Convenient: you can `errors.Join(err, cleanupErr)` unconditionally and still get nil if both are nil.

### A close inside a goroutine spawned by the function

```go
func spawn() {
    f, _ := os.Open(path)
    go func() {
        defer f.Close() // closes inside the goroutine
        // ... use f ...
    }()
    // returns immediately; the file is still open
}
```

The defer fires when the goroutine exits, not when `spawn` returns. Make sure the goroutine actually does exit — otherwise the file leaks.

---

## Common Mistakes

### Mistake 1: Defer-close a writer without checking the error

```go
// BUG: lost data if Close fails
func write(path string, data []byte) error {
    f, _ := os.Create(path)
    defer f.Close()
    _, err := f.Write(data)
    return err
}
```

Use the named-return pattern.

### Mistake 2: Forget `defer stop()` after `AfterFunc`

```go
// BUG: callback may still be alive after we expect it to be gone
ctx, cancel := context.WithCancel(parent)
defer cancel()
context.AfterFunc(ctx, cleanup) // returned stop is dropped
```

Always store and defer `stop`.

### Mistake 3: Cancel without draining

```go
// BUG: producer leaks
ctx, cancel := context.WithCancel(...)
defer cancel()
out := produce(ctx)
// consume nothing — producer blocks trying to send
```

Either drain `out` before returning, or make the producer non-blocking on send.

### Mistake 4: Close inside an `errgroup` goroutine without synchronising

```go
g.Go(func() error {
    defer s.Close() // s.Close may race with the other goroutines
    return s.Run(ctx)
})
```

If `s` is shared, the close must come from the *single* path that owns it — usually after `g.Wait()`.

### Mistake 5: Recover in a defer that does cleanup

```go
defer func() {
    if r := recover(); r != nil {
        log.Println("recovered:", r)
    }
    f.Close()
}()
```

If `f.Close` itself panics, the recovery is gone (we already used it). Either keep recovery and cleanup separate, or nest the recovery inside the close defer.

### Mistake 6: Assuming the AfterFunc callback ran before the next line

```go
context.AfterFunc(ctx, func() { fmt.Println("cleanup") })
cancel()
fmt.Println("after cancel") // may print BEFORE the cleanup
```

Goroutines do not synchronise unless you make them. The callback may run before or after the next line.

### Mistake 7: Defer in a loop, with `AfterFunc`

```go
for _, ctx := range ctxs {
    defer context.AfterFunc(ctx, cleanup)() // BUG: stop never called appropriately
}
```

`AfterFunc` returns a `stop func()`; calling it immediately with `()` deregisters before any chance to fire. Even ignoring that bug, all the `stop` calls run at function exit, not at iteration exit. Use a helper per iteration.

---

## Common Misconceptions

> "defer always runs."

Not on `os.Exit`. Not if the OS kills the process. Not if a child goroutine panics with no recover before the parent has set up a wait. Always = "if the function exits via return, panic, or `runtime.Goexit`."

> "AfterFunc is just defer with a callback."

No. `defer` runs when the function exits. `AfterFunc` runs when the context is cancelled. These are different events. They sometimes coincide, but they are not the same.

> "errors.Join makes my code less safe to read."

Done thoughtfully, it does the opposite: a single returned error contains all failures. Pair it with `errors.Is` checks for specific kinds.

> "If I use errgroup, I do not need defers."

Wrong. Each goroutine still needs its own resource cleanup. `errgroup` handles wait and error propagation; resource cleanup is yours.

> "cancel and Close are the same thing."

No. `cancel` is a signal; `Close` is a release. The signal tells your goroutines to stop. The release frees the resource. They are usually called in sequence (cancel first, close after wait).

---

## Tricky Points

- **AfterFunc on a context with a CauseFunc parent**: `context.Cause(ctx)` resolves the cause through the parent chain. If your callback wants to know *why* it was cancelled, look up the cause.
- **Nested AfterFuncs**: a callback registered on `ctx` can itself register an `AfterFunc` on `subCtx`. Both fire on their respective cancels. No automatic ordering between them.
- **Defer in `t.Cleanup`**: `testing.T.Cleanup(fn)` is the Go test framework's analogue of defer. It runs after the test function returns, in LIFO order. Useful for `t.TempDir()`-style helpers that own resources.
- **`runtime.SetFinalizer`** is *not* a substitute for defer or Close. Finalizers run at unpredictable times during GC. Use them as a last resort to catch missing closes in development, not as a real cleanup mechanism.
- **`context.AfterFunc` does not chain**: registering an `AfterFunc` on `ctx` does not also register it on `ctx`'s children. Each registration targets one context.

---

## Test

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    stop := context.AfterFunc(ctx, func() {
        fmt.Println("after")
    })

    fmt.Println("before cancel, stop=", stop())
    cancel()
    time.Sleep(10 * time.Millisecond)
    fmt.Println("done")
}
```

Predict the output. Answer:

```
before cancel, stop= true
done
```

Why? Because we called `stop` *before* cancel. `stop` returned true (deregistered). `cancel` fired with no callback attached. The "after" never printed.

Another test:

```go
ctx, cancel := context.WithCancel(context.Background())
context.AfterFunc(ctx, func() { fmt.Println("a") })
context.AfterFunc(ctx, func() { fmt.Println("b") })
cancel()
time.Sleep(10 * time.Millisecond)
```

What is the output? Both `a` and `b`, but in unspecified order. The two callbacks run in their own goroutines; scheduling is not deterministic.

---

## Tricky Questions

**Q1.** What is wrong with this code?

```go
f, _ := os.Create(path)
defer f.Close()
fmt.Fprintln(f, "critical data")
```

**A.** The close error is dropped. If disk is full, the bytes may not be written, but the function returns nil. Use the named-return pattern.

**Q2.** Order of these prints?

```go
ctx, cancel := context.WithCancel(context.Background())
stop := context.AfterFunc(ctx, func() { fmt.Println("a") })
defer stop()
defer cancel()
fmt.Println("body")
```

**A.** `body`, then on return: `cancel` fires (popped first), triggering the AfterFunc callback in a new goroutine. Then `stop` fires (no-op, callback already started). The order between "callback prints `a`" and "the main function actually returns to the caller" is racy — the callback may not have printed before main exits. In a real test, you would use a `WaitGroup` or sleep to make the timing reliable.

**Q3.** Why is `defer cancel()` typically registered *after* `defer wg.Wait()`?

**A.** Because LIFO. `wg.Wait()` registered first → pops last. `cancel()` registered after → pops first. So at function exit, `cancel` fires (signals goroutines), then `Wait` fires (waits for them to finish). Reverse the order and you wait for goroutines without telling them to stop — they may never finish.

**Q4.** Is this code correct?

```go
func f() error {
    ctx, cancel := context.WithCancel(context.Background())
    stop := context.AfterFunc(ctx, cleanup)
    defer cancel()
    defer stop()
    return doWork(ctx)
}
```

**A.** Order at exit: `stop` first (popped first), then `cancel` (popped second). So `stop` deregisters the callback *before* `cancel` fires. The callback never runs. If you intended the callback to run on cancel, swap the defers: register `defer cancel()` *after* (so it pops first), and `defer stop()` *before* (so it pops second). Common confusion.

**Q5.** How do you wait for an AfterFunc callback to finish?

**A.** AfterFunc does not provide a built-in wait. You wrap the callback with a `WaitGroup` or signal-channel:

```go
done := make(chan struct{})
stop := context.AfterFunc(ctx, func() {
    defer close(done)
    cleanup()
})
defer stop()
// ... later ...
cancel()
<-done
```

Note that if `stop()` deregisters the callback before it runs, `done` is never closed. Guard with `if !stop() { <-done }`.

---

## Cheat Sheet

```
ERRORS FROM CLOSE
  defer func() {
      if cerr := f.Close(); cerr != nil && err == nil { err = cerr }
  }()
  -- or for both errors --
  defer func() { err = errors.Join(err, f.Close()) }()

CONTEXT.AFTERFUNC
  stop := context.AfterFunc(ctx, fn)
  defer stop()
  fn runs in a new goroutine on cancel, exactly once
  stop deregisters if called before fn starts

CANCEL-DRAIN-CLOSE
  defer db.Close()        // step 3
  defer workers.Wait()    // step 2
  defer cancel()          // step 1
  -- LIFO: cancel → wait → close --

IDEMPOTENT CLOSE
  closed.Do(func() { realClose() })  // sync.Once

ERRGROUP
  g, ctx := errgroup.WithContext(parent)
  g.Go(func() error { return worker(ctx) })
  return g.Wait()

CAUSE
  context.WithCancelCause + cancel(err)
  context.Cause(ctx) for the reason
```

---

## Self-Assessment Checklist

- [ ] I write `defer func() { err = errors.Join(err, f.Close()) }()` (or the named-return variant) for every writer I close.
- [ ] I pair every `context.With*` with `defer cancel()`.
- [ ] I pair every `context.AfterFunc` with `defer stop()`.
- [ ] I order shutdown defers so `cancel` pops first, `Wait` pops next, `Close` pops last.
- [ ] I make my custom `Close` methods idempotent using `sync.Once`.
- [ ] I never assume an `AfterFunc` callback ran before the next line of code.
- [ ] I drain channels on cancel to unblock producers.
- [ ] I use `errgroup.Group` for goroutine teams that share a context.
- [ ] I document `Close`/`Stop` semantics in exported APIs.
- [ ] I do not use `runtime.SetFinalizer` as a real cleanup mechanism.

---

## Summary

Cleanup ordering at the middle level is no longer about a single `defer f.Close()`. It is about systems: the order in which you cancel signals, drain in-flight work, and close resources; the way errors from cleanup propagate through your function's contract; the way Go 1.21's `context.AfterFunc` lets you separate "cancel happened" from "function returned." These tools compose. A well-written Go service has dozens of cleanup layers, each one obvious and small, each one in the right order, no one of them carrying the whole weight.

The senior file goes further: explicit resource hierarchies that span packages, shutdown choreography for distributed teams of goroutines, and the deep interaction between `AfterFunc`, the runtime, and `context.Cause`.

---

## What You Can Build

- A small HTTP server with graceful shutdown that drains in-flight requests
- A worker pool with cancel-then-drain semantics
- A database wrapper whose `Close` is idempotent and propagates the underlying close error
- A trace probe that logs both timing and the returned error
- A `Service` type that combines `AfterFunc` for "react to cancel" with a manual `Close` for "release everything now"

---

## Further Reading

- The Go 1.21 release notes (`context.AfterFunc`, `errors.Join`, `sync.OnceFunc`)
- The `golang.org/x/sync/errgroup` documentation
- `net/http.Server.Shutdown` source
- `database/sql.DB.Close` source
- The Go blog, "Working with Errors in Go 1.13" (introduces `%w` and `errors.Is/As`)
- The Go blog, "Go Concurrency Patterns: Pipelines and Cancellation"

---

## Related Topics

- `01-cooperative-vs-force` — how cancellation reaches the goroutines that run defers
- `02-partial-cancellation` — partial cancellation and the cleanup that survives
- The Errors-and-Panics track on Go panics and `recover`
- `database/sql` track on transaction lifecycle

---

## Diagrams & Visual Aids

### Cancel-drain-close in time

```
   t=0     t=cancel    t=drain    t=close
   ──┬─────────┬──────────┬──────────┬─────────►
     │ working │ cancelled│ in-flight│ exit
     │         │ ; new    │ tasks    │
     │         │ rejected │ finish   │
```

### AfterFunc lifecycle

```
   context.WithCancel ───► ctx
   context.AfterFunc(ctx, fn) ─► registered, stop returned
   ...
   case A: cancel() ──► fn runs in new goroutine, stop() returns false
   case B: stop()  ──► fn deregistered, stop() returns true
```

### Defer order at shutdown

```
   defer Close            <- popped LAST
   defer Wait             <- popped 2nd
   defer cancel           <- popped FIRST

   Order of execution: cancel → Wait → Close
   = cancel-drain-close
```

### Errors flow through a deferred close

```
   work succeeds, close succeeds:   err = nil
   work fails,    close succeeds:   err = work-err
   work succeeds, close fails:      err = close-err   (overwrite-if-nil)
   work fails,    close fails:      err = work-err    (do not mask)

   or with errors.Join:
   work succeeds, close succeeds:   err = nil
   work fails,    close succeeds:   err = work-err
   work succeeds, close fails:      err = close-err
   work fails,    close fails:      err = join(work, close)
```

### A composite cleanup graph

```
        ┌─────────────────────────────────────┐
        │              Service                │
        │  ┌─────────┐  ┌────────────┐        │
        │  │ HTTP    │  │ DB pool    │        │
        │  └────┬────┘  └──────┬─────┘        │
        │       │              │              │
        │       ▼              ▼              │
        │  ┌─────────────────────────────┐    │
        │  │ shared logger / metrics     │    │
        │  └─────────────────────────────┘    │
        └─────────────────────────────────────┘
        Release order (release the most dependent first):
          1. HTTP (depends on DB and logger)
          2. DB pool (depends on logger)
          3. logger/metrics (depends on nothing)
```

The release order is a topological sort of the dependency graph. LIFO defers encode the reverse-of-acquisition order, which matches the topological release order when acquisition matches the inverse of dependency. In tangled graphs, do not rely on defer alone — use an explicit cleanup manager.

### A small AfterFunc state machine

```
   registered ─[cancel]──► running ─[done]──► fired
       │
       └────[stop]──► deregistered (never runs)
```

Three states. Two transitions. Once fired, always fired; once deregistered, never fires.

---

## Closing Notes

This file built on the junior file's defer mechanics and added: error propagation through cleanup, `context.AfterFunc` semantics, the cancel-drain-close pattern, the design of idempotent close methods, and the practical interaction between defers, goroutines, and contexts. The senior file takes the next step: cross-package cleanup choreography, panic-during-cleanup safety, and large-scale shutdown design.

If you can read a function and tell me, line by line, which defers will fire in which order, with which errors, and whether any AfterFuncs are still alive — you have mastered the middle level. The senior level is about scale: not one function, but a hundred.

---

## Deep Dive: Patterns from Production Code

The patterns and examples above are correct but compact. This deeper section walks through concrete production-shaped scenarios: a real HTTP service with database, cache, tracer, metrics; a batch worker pipeline; and a stream processor. Each scenario shows where cleanup ordering bites, how to design for it, and what the standard tools (`defer`, `AfterFunc`, `errgroup`) look like when assembled.

### Scenario 1: HTTP service with a typical stack

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

type stack struct {
    db     io.Closer       // pretend: a *sql.DB
    cache  io.Closer       // pretend: a redis client
    tracer io.Closer       // pretend: a tracer with Shutdown
    metrics io.Closer      // pretend: a metrics exporter
    server *http.Server
}

func openStack() (*stack, error) {
    s := &stack{}
    // ... open each component, returning on first error ...
    return s, nil
}

func (s *stack) Shutdown(ctx context.Context) error {
    var errs []error
    if err := s.server.Shutdown(ctx); err != nil {
        errs = append(errs, fmt.Errorf("http: %w", err))
    }
    if err := s.cache.Close(); err != nil {
        errs = append(errs, fmt.Errorf("cache: %w", err))
    }
    if err := s.db.Close(); err != nil {
        errs = append(errs, fmt.Errorf("db: %w", err))
    }
    if err := s.tracer.Close(); err != nil {
        errs = append(errs, fmt.Errorf("tracer: %w", err))
    }
    if err := s.metrics.Close(); err != nil {
        errs = append(errs, fmt.Errorf("metrics: %w", err))
    }
    return errors.Join(errs...)
}

func main() {
    // signal handling
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    s, err := openStack()
    if err != nil { fmt.Println(err); os.Exit(1) }

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := s.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            fmt.Println("listen:", err)
        }
    }()

    <-ctx.Done()
    fmt.Println("shutdown signal received")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := s.Shutdown(shutdownCtx); err != nil {
        fmt.Println("shutdown errors:", err)
    }
    wg.Wait()
    fmt.Println("done")
}
```

A real production service has roughly this shape. Note:

- The signal context `ctx` is the *top-level* trigger. When the user sends SIGINT or SIGTERM, `ctx.Done()` closes.
- The HTTP server runs in its own goroutine. Its `ListenAndServe` blocks until `Shutdown` is called.
- Shutdown uses a *separate* context with its own timeout. This is critical: the original `ctx` is already cancelled (that's why we are shutting down). Using it as the shutdown context would tell `Server.Shutdown` to abort immediately.
- The `Shutdown` method on the stack releases components in dependency order: HTTP first (so no new requests), then cache and DB (in-flight requests are done), then tracer and metrics (they may have buffered the last requests' data).

A subtler question: should we close *tracer* and *metrics* before or after DB? The tracer often *exports* spans by making HTTP/gRPC calls to a backend. If you close it after DB, no problem. If you close it *before* DB, any spans for the DB close itself are lost. We chose "after" — `db` then `tracer` — so the last DB close call still emits its span.

### Scenario 2: Batch worker pipeline

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"

    "golang.org/x/sync/errgroup"
)

type Job struct {
    ID   int
    Data string
}

type Pipeline struct {
    in  chan Job
    out chan string
}

func NewPipeline(buf int) *Pipeline {
    return &Pipeline{
        in:  make(chan Job, buf),
        out: make(chan string, buf),
    }
}

func (p *Pipeline) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)

    // stage 1: validate
    validated := make(chan Job, cap(p.in))
    g.Go(func() error {
        defer close(validated)
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case j, ok := <-p.in:
                if !ok {
                    return nil
                }
                if j.Data == "" {
                    return fmt.Errorf("job %d: empty data", j.ID)
                }
                select {
                case validated <- j:
                case <-ctx.Done():
                    return ctx.Err()
                }
            }
        }
    })

    // stage 2: process
    processed := make(chan string, cap(p.in))
    var stage2 sync.WaitGroup
    for i := 0; i < 4; i++ {
        stage2.Add(1)
        g.Go(func() error {
            defer stage2.Done()
            for j := range validated {
                result := fmt.Sprintf("processed-%d-%s", j.ID, j.Data)
                select {
                case processed <- result:
                case <-ctx.Done():
                    return ctx.Err()
                }
            }
            return nil
        })
    }
    g.Go(func() error {
        stage2.Wait()
        close(processed)
        return nil
    })

    // stage 3: output
    g.Go(func() error {
        defer close(p.out)
        for r := range processed {
            select {
            case p.out <- r:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
        return nil
    })

    return g.Wait()
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()

    p := NewPipeline(10)
    go func() {
        defer close(p.in)
        for i := 0; i < 5; i++ {
            p.in <- Job{ID: i, Data: fmt.Sprintf("d%d", i)}
        }
    }()
    go func() {
        for r := range p.out {
            fmt.Println(r)
        }
    }()

    if err := p.Run(ctx); err != nil {
        if errors.Is(err, context.DeadlineExceeded) {
            fmt.Println("timeout")
        } else {
            fmt.Println("error:", err)
        }
    }
    time.Sleep(50 * time.Millisecond)
}
```

This is a three-stage pipeline. Each stage:

- Reads from its input channel
- Writes to its output channel
- Closes its output channel when its input is exhausted (so the next stage exits cleanly)

The cleanup story:

- The first stage's goroutine `defer close(validated)`. When it exits (normally or on cancel), the channel closes. Stage 2's `for ... range validated` terminates.
- Stage 2 has multiple workers; they share `validated` (each consumes from it). When all are done (sync.WaitGroup), a coordinator goroutine closes `processed`. Stage 3's `for ... range processed` terminates.
- Stage 3 `defer close(p.out)`. The downstream consumer's `for r := range p.out` terminates.
- All goroutines are governed by the shared `ctx` from `errgroup.WithContext`. The first non-nil error cancels everything; `g.Wait()` returns it.

The order of closure cascades top-down through the pipeline. No defer is wrong; no AfterFunc is needed. The pattern is canonical.

### Scenario 3: Stream processor with AfterFunc

Suppose you have a long-running connection to a third-party service. You consume messages, process them, ack them. The third-party library does not respect `context.Context`. You need `AfterFunc` to force-disconnect on cancel.

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type ThirdPartyConn struct {
    mu     sync.Mutex
    closed bool
    msgs   chan string
}

func Dial() *ThirdPartyConn {
    c := &ThirdPartyConn{msgs: make(chan string, 10)}
    go func() {
        for i := 0; ; i++ {
            c.mu.Lock()
            done := c.closed
            c.mu.Unlock()
            if done {
                close(c.msgs)
                return
            }
            time.Sleep(20 * time.Millisecond)
            select {
            case c.msgs <- fmt.Sprintf("msg-%d", i):
            default:
            }
        }
    }()
    return c
}

func (c *ThirdPartyConn) Close() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.closed = true
}

func (c *ThirdPartyConn) Next() (string, bool) {
    m, ok := <-c.msgs
    return m, ok
}

func consume(ctx context.Context) {
    conn := Dial()

    stop := context.AfterFunc(ctx, func() {
        fmt.Println("forcing disconnect")
        conn.Close()
    })
    defer stop()
    defer conn.Close() // also close on normal exit

    for {
        m, ok := conn.Next()
        if !ok {
            fmt.Println("conn closed")
            return
        }
        fmt.Println("got:", m)
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    consume(ctx)
}
```

The third-party connection ignores context, but `AfterFunc` calls `conn.Close` on cancel. The internal `Next()` then sees the channel close and returns `ok=false`. The loop exits.

Note the two cleanups for `conn`:

- `defer conn.Close()` — on normal function exit
- `context.AfterFunc(ctx, conn.Close)` — on context cancel

Both call `Close`, which is idempotent (the mutex guard makes it safe). The first one to win does the real work; the other is a no-op.

### Scenario 4: A "shutdown hook" registry

For a complex service with many components, you can build a small registry of shutdown hooks. This is a manual version of `context.AfterFunc` for the case where you want them to run in LIFO order at process exit, regardless of context:

```go
package main

import (
    "errors"
    "fmt"
    "sync"
)

type Shutdown struct {
    mu  sync.Mutex
    fns []func() error
}

func (s *Shutdown) Add(name string, fn func() error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.fns = append(s.fns, func() error {
        if err := fn(); err != nil {
            return fmt.Errorf("%s: %w", name, err)
        }
        return nil
    })
}

func (s *Shutdown) Run() error {
    s.mu.Lock()
    fns := s.fns
    s.fns = nil
    s.mu.Unlock()

    var errs []error
    for i := len(fns) - 1; i >= 0; i-- {
        if err := fns[i](); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}

func main() {
    var sd Shutdown
    sd.Add("db", func() error { fmt.Println("close db"); return nil })
    sd.Add("cache", func() error { fmt.Println("close cache"); return nil })
    sd.Add("server", func() error { fmt.Println("stop server"); return nil })

    fmt.Println("running")
    if err := sd.Run(); err != nil {
        fmt.Println("shutdown errors:", err)
    }
}
```

Output:

```
running
stop server
close cache
close db
```

LIFO unwinding by hand. Components register; shutdown runs them in reverse registration order; errors are joined.

This pattern shows up in many Go services and is a useful complement to `defer` when components are registered from many places.

### Scenario 5: Coordinated multi-resource transactional cleanup

Imagine an operation that:

1. Acquires a lock on a remote service (HTTP-based mutex)
2. Opens a database transaction
3. Writes a file
4. Sends a network message

On *any* failure, all four must be undone in reverse:

1. Cancel the network message (if it was queued but not delivered)
2. Delete the file
3. Roll back the transaction
4. Release the remote lock

In Go, you would compose this with deferred closures that conditionally undo:

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "os"
)

type RemoteLock struct{ name string }

func (r *RemoteLock) Acquire(ctx context.Context) error { fmt.Println("acq", r.name); return nil }
func (r *RemoteLock) Release(ctx context.Context) error { fmt.Println("rel", r.name); return nil }

type Tx struct{ committed bool }

func (t *Tx) Commit() error   { t.committed = true; fmt.Println("commit"); return nil }
func (t *Tx) Rollback() error { if t.committed { return nil }; fmt.Println("rollback"); return nil }

func atomicOp(ctx context.Context) (err error) {
    lock := &RemoteLock{name: "user-42"}
    if err := lock.Acquire(ctx); err != nil { return err }
    defer func() {
        if rerr := lock.Release(ctx); rerr != nil {
            err = errors.Join(err, rerr)
        }
    }()

    tx := &Tx{}
    defer func() {
        if err != nil {
            if rerr := tx.Rollback(); rerr != nil {
                err = errors.Join(err, rerr)
            }
        }
    }()

    file := "/tmp/atomic.txt"
    if werr := os.WriteFile(file, []byte("data"), 0600); werr != nil {
        return werr
    }
    defer func() {
        if err != nil {
            if rerr := os.Remove(file); rerr != nil {
                err = errors.Join(err, rerr)
            }
        }
    }()

    // ... send network message (simulated failure) ...
    return errors.New("network failure")
}

func main() {
    ctx := context.Background()
    fmt.Println(atomicOp(ctx))
}
```

Output:

```
acq user-42
rollback
rel user-42
err network failure
```

Order of defers (LIFO):
1. The file-remove defer (registered third, popped first) — runs because `err != nil`, removes the file.
2. The rollback defer (registered second, popped second) — runs because `err != nil`, rolls back.
3. The release defer (registered first, popped third) — always runs, releases the lock.

If the operation had succeeded, the `Commit` would have set `tx.committed = true` and the rollback would no-op. The file would persist. The lock would still release.

This is a manual saga. Each step is undone if the work fails. Defer's LIFO ordering matches the natural "undo in reverse" of saga compensations.

### Scenario 6: Cleanup that depends on partial completion

Sometimes only *some* of the steps succeeded, and cleanup needs to know which ones. Track completion with flags:

```go
package main

import "fmt"

type op struct {
    stepA, stepB, stepC bool
}

func run() (err error) {
    var o op
    defer func() {
        if !o.stepA && !o.stepB && !o.stepC {
            return
        }
        // unwind in reverse
        if o.stepC {
            fmt.Println("undo C")
        }
        if o.stepB {
            fmt.Println("undo B")
        }
        if o.stepA {
            fmt.Println("undo A")
        }
    }()

    fmt.Println("do A")
    o.stepA = true
    fmt.Println("do B")
    o.stepB = true
    fmt.Println("do C fails!")
    return fmt.Errorf("C failed")
}

func main() {
    fmt.Println(run())
}
```

Output:

```
do A
do B
do C fails!
undo B
undo A
C failed
```

A single defer with conditional unwinds based on completion flags. Equivalent to three separate defers, but more compact if the cleanup logic is small. Choose whichever you find clearer.

### Scenario 7: `t.Cleanup` in tests

The `testing` package has its own LIFO cleanup mechanism:

```go
package main_test

import (
    "fmt"
    "testing"
)

func TestCleanupOrder(t *testing.T) {
    t.Cleanup(func() { fmt.Println("A") })
    t.Cleanup(func() { fmt.Println("B") })
    t.Cleanup(func() { fmt.Println("C") })
    fmt.Println("test body")
}
```

Output:

```
test body
C
B
A
```

Same LIFO order as `defer`, but `t.Cleanup` survives across helper functions (where a defer would not — the defer fires when the helper returns). Use `t.Cleanup` in test helpers that create temporary resources; use `defer` inside the test itself.

### Scenario 8: Cleanup and the `slog` package

Go 1.21 introduced structured logging via `slog`. A common pattern is to log cleanup outcomes with the right level:

```go
package main

import (
    "errors"
    "io"
    "log/slog"
    "os"
)

func work(out io.WriteCloser) (err error) {
    defer func() {
        if cerr := out.Close(); cerr != nil {
            slog.Error("close failed", "err", cerr)
            err = errors.Join(err, cerr)
        }
    }()
    _, err = out.Write([]byte("data"))
    return err
}

func main() {
    f, _ := os.Create("/tmp/slog.txt")
    if err := work(f); err != nil {
        slog.Error("work failed", "err", err)
    }
}
```

The deferred close logs and joins. Structured logging gives ops a clear trail of what failed during shutdown.

### Scenario 9: A long-running goroutine that re-registers AfterFunc on context change

Real services sometimes re-derive contexts during their lifetime — for example, a connection pool that uses one context for connect-time cleanup and another for query-time cleanup. Each derived context can have its own AfterFunc:

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func session(parent context.Context) {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel()
    stop := context.AfterFunc(ctx, func() {
        fmt.Println("session timed out or cancelled")
    })
    defer stop()

    // ... session work ...
    fmt.Println("session active")
    time.Sleep(50 * time.Millisecond)
}

func main() {
    parent, cancel := context.WithCancel(context.Background())
    defer cancel()
    for i := 0; i < 3; i++ {
        session(parent)
    }
}
```

Each call to `session` creates its own context, its own `AfterFunc`, its own `stop`. The cleanup is per-session, not global. Easy to reason about because each session is independent.

### Scenario 10: Detecting forgotten close in production

`go vet`'s `lostcancel` analyser catches forgotten `cancel`, but not forgotten `Close`. Some teams add a finalizer in *test* builds to catch missing closes:

```go
type Resource struct {
    closed bool
}

func NewResource() *Resource {
    r := &Resource{}
    // in test builds:
    runtime.SetFinalizer(r, func(r *Resource) {
        if !r.closed {
            panic("Resource was not closed")
        }
    })
    return r
}

func (r *Resource) Close() {
    r.closed = true
    runtime.SetFinalizer(r, nil) // disable the finalizer
}
```

In production, you would skip the finalizer (it has a measurable cost and can mask real bugs). In tests, the finalizer flags any code path that forgets to close. This is *not* a substitute for proper deferred close — it is a debugging aid.

---

## Patterns We Have Not Covered Yet

There are a few more patterns worth knowing at the middle level. Each is short.

### Pattern: Cleanup via channel-of-cleanups

```go
cleanups := make(chan func(), 16)
go func() {
    for fn := range cleanups {
        fn()
    }
}()

// in many places:
cleanups <- func() { res.Close() }

// at shutdown:
close(cleanups)
// wait for processor to drain (use a sync.WaitGroup)
```

A simple way to centralise cleanups when defers do not compose well. The processor goroutine runs them in *insertion* order (FIFO). If you need LIFO, use a slice and pop from the end.

### Pattern: Wrap a non-cancellable call in `AfterFunc`

```go
func cancellable(ctx context.Context, fn func()) {
    done := make(chan struct{})
    stop := context.AfterFunc(ctx, func() {
        // force-cancel by closing a flag
        // (here, just print)
        fmt.Println("cancel requested")
    })
    defer stop()

    go func() {
        defer close(done)
        fn()
    }()

    select {
    case <-done:
    case <-ctx.Done():
        // wait for fn to notice the cancel
        <-done
    }
}
```

The `AfterFunc` is the cancellation handler. The `done` channel is the synchronisation. Combining them lets you build a cancellable wrapper around any blocking function.

### Pattern: Defer-and-AfterFunc together

```go
func handler(ctx context.Context) {
    defer cleanup1()
    stop := context.AfterFunc(ctx, cleanup2)
    defer stop()
    defer cleanup3()
    // ...
}
```

Three cleanups: two run on function exit (`cleanup1`, `cleanup3`), one runs on cancel (`cleanup2`). Order at function exit (LIFO): `stop` first (deregisters `cleanup2` if not yet fired), then `cleanup3`, then `cleanup1`.

If cancel fires *before* function exit: `cleanup2` runs in a new goroutine; the function continues; on exit, the defers run as usual. `stop()` is a no-op (callback already started). `cleanup2` and `cleanup1`/`cleanup3` may run concurrently — be careful with shared state.

### Pattern: Group multiple AfterFuncs with one stop

`AfterFunc` returns one `stop` per registration. If you want a single stop for many callbacks, register one callback that fans out:

```go
stop := context.AfterFunc(ctx, func() {
    cleanup1()
    cleanup2()
    cleanup3()
})
defer stop()
```

The order of `cleanup1`/`cleanup2`/`cleanup3` is whatever you write inside the callback. Simple but limited (you cannot deregister just one).

---

## Even More Edge Cases

### Edge case: AfterFunc on a context.Background()

`context.Background()` is never cancelled. Calling `AfterFunc(context.Background(), fn)` registers `fn` permanently — it never fires. The `stop` function still works to deregister.

```go
stop := context.AfterFunc(context.Background(), func() {
    fmt.Println("never runs unless stop is forgotten and... actually still never runs")
})
defer stop() // good practice anyway
```

There is no scenario where this is useful, but it does not crash.

### Edge case: Closing a channel in a deferred function

```go
func work(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}
```

`defer close(out)` ensures consumers of `out` see end-of-stream when the goroutine exits — including on panic. This is the canonical "producer closes" rule and `defer` is exactly the tool.

### Edge case: Defer in `select` cases

```go
select {
case <-ctx.Done():
    return
case x := <-ch:
    defer cleanup(x)
    process(x)
}
```

The defer is *inside* the case body. It registers when execution reaches that case; it fires when the surrounding function exits. There is no scope inside a `select` arm for deferred calls — they belong to the function.

### Edge case: Defer inside a `for ... range` over a channel

```go
for v := range ch {
    defer cleanup(v) // BUG: each iteration adds a defer
}
```

Same as the file-loop bug. All cleanups stack up until the function returns. Extract a helper or call cleanup explicitly.

### Edge case: AfterFunc that re-cancels its parent

```go
ctx, cancel := context.WithCancel(parent)
stop := context.AfterFunc(ctx, func() {
    cancel() // re-cancelling: already cancelled, no-op
})
```

`cancel` is idempotent. Calling it from inside an AfterFunc is wasteful but harmless. The point is to remind: feel free to call `cancel` from cleanup paths; it will not double-cancel.

### Edge case: AfterFunc on an errgroup-derived context

```go
g, ctx := errgroup.WithContext(parent)
stop := context.AfterFunc(ctx, func() {
    fmt.Println("a worker failed or ctx cancelled")
})
defer stop()
```

The errgroup's derived `ctx` is cancelled on the *first* error. The AfterFunc fires on that cancel. Useful for "log on first failure" hooks.

### Edge case: AfterFunc on a context that becomes a child later

`AfterFunc` registers against the *current* context. If you derive a child after registering, the AfterFunc still belongs to the parent. Re-register on the child if needed.

---

## More Tricky Questions

**Q6.** Predict the output:

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    var n int
    stop := context.AfterFunc(ctx, func() { n = 1 })
    defer stop()
    cancel()
    fmt.Println(n)
}
```

**A.** Output is most likely `0`. The callback runs in a separate goroutine, possibly *after* `fmt.Println(n)`. There is no synchronisation. To be sure the callback wrote `n` before printing, use a `WaitGroup` or sleep.

**Q7.** What does this print?

```go
func main() {
    a, _ := os.Create("/tmp/a")
    b, _ := os.Create("/tmp/b")
    defer fmt.Println("close a:", a.Close())
    defer fmt.Println("close b:", b.Close())
}
```

**A.** First `close b: <nil>`, then `close a: <nil>` (assuming both succeed). LIFO. The arguments to `Println` are `a.Close()` (evaluated at the defer line) — meaning `a.Close()` is called *at the defer line*, not at function exit! This is a bug. The file is closed too early. Verify by trying to write to it after the defer line — you get an error.

Correct pattern:

```go
defer func() { fmt.Println("close a:", a.Close()) }()
```

**Q8.** Two `AfterFunc`s on the same context with a shared resource:

```go
var n int
context.AfterFunc(ctx, func() { n++ })
context.AfterFunc(ctx, func() { n++ })
cancel()
```

After both fire, is `n == 2`?

**A.** Eventually yes, but with a data race. The two increments race because each runs in its own goroutine. Use atomic or a mutex.

**Q9.** Why do many shutdown handlers use a fresh context, not the cancelled one?

**A.** Because the cancelled context tells `Server.Shutdown` (and similar APIs) "stop immediately." A fresh context with its own timeout gives in-flight handlers a chance to finish gracefully. Pattern: SIGTERM cancels the *main* context; shutdown then derives a *separate* context for the graceful-stop window.

**Q10.** Can `defer` outlive a goroutine?

**A.** No. Defers run when the *registering* goroutine exits. There is no way for a goroutine's defer to fire after the goroutine has terminated. If you need that, use `AfterFunc` on a context, or use a separate cleanup goroutine.

---

## Yet More Best Practices

- **Document the order**. If your `Shutdown` method runs ten cleanups in a specific order, the order should appear in the method's doc comment.
- **Test shutdown paths.** Most teams test the happy path and forget that `Shutdown` has its own bugs. Write a test that creates a `Service`, runs it briefly, calls `Shutdown`, and asserts no goroutines leak (`runtime.NumGoroutine` before/after).
- **Use deadlines, not timeouts, for shutdown.** A deadline is absolute; a timeout might be reset by a wrapping context. For shutdown windows, absolute is what you want.
- **Centralise idempotency.** If you have many `Close`-like methods, build a single `Once`-wrapped helper rather than scattering `sync.Once` everywhere.
- **Prefer `errgroup` over manual `WaitGroup` + error channels.** It captures the first error, propagates cancel, and gives you a clean `Wait` signature.
- **Be paranoid about cleanup that does I/O.** Network calls during shutdown can hang; always have a deadline.
- **Test under chaos.** Use `chaosmonkey`-style failure injection in tests: kill a connection mid-shutdown, simulate disk full, abort signal handlers. Cleanup bugs hide in these corners.

---

## Closing Story

Cleanup ordering in Go is not a single rule. It is a hierarchy of mechanisms:

- The defer stack handles function-scope cleanup with LIFO ordering.
- Named returns let cleanup observe and modify the function's outcome.
- `context.AfterFunc` decouples cleanup from the registering goroutine.
- `errgroup` propagates the first error and cancels its team.
- Manual shutdown registries let components register cleanups across packages.
- `t.Cleanup` lets test helpers manage resources without the helper's caller knowing.

A senior Go engineer reaches for the right one. A middle-level one knows what each does and when to pick which. By the end of this file, you should be in the second category — and feel ready to step up.

Move on to `senior.md` for the architecture-level view: resource hierarchies across packages, panic-safe cleanup, choreographed shutdown of large services, and the design discipline that keeps a 100k-line Go codebase from leaking.

---

## Appendix A: Comparison of Cleanup Mechanisms

| Mechanism | Scope | Triggers on | Ordering | Concurrency | Best for |
|-----------|-------|------------|----------|-------------|----------|
| `defer` | Function | return, panic, Goexit | LIFO | Same goroutine | Per-function resource release |
| `t.Cleanup` | Test (transitive) | Test end | LIFO | Test goroutine | Test helpers, temp resources |
| `context.AfterFunc` | Context | Context cancel | Unspecified between siblings | New goroutine | React to cancel, force-close |
| `errgroup.Wait` | Group of goroutines | All goroutines exit | n/a | Caller blocks | Waiting for goroutine teams |
| `sync.WaitGroup` | Manual | `Done` calls | n/a | Caller blocks | Counting goroutine completion |
| `sync.Once` | First call | First Trigger | n/a | Thread-safe | Idempotent close |
| Manual shutdown registry | Process / service | Explicit `Run` | LIFO (or custom) | Caller-controlled | Cross-package cleanup |
| `runtime.SetFinalizer` | Object lifetime | GC | Unspecified | GC goroutine | Debug aid only |

The table reads as a decision tree:

- *Need cleanup on every function exit?* → `defer`
- *Need cleanup that survives the function?* → `AfterFunc` or a goroutine with its own defer
- *Need to wait for many goroutines?* → `errgroup` (recommended) or `WaitGroup`
- *Need a single-shot close that may be called twice?* → wrap in `sync.Once`
- *Building a test helper?* → `t.Cleanup`
- *Last-resort debugging?* → finalizer

Mix mechanisms freely. A typical Go service uses four or five of them simultaneously.

---

## Appendix B: A Step-by-Step Shutdown Recipe

For a service with N components, here is a recipe that scales:

1. **Identify the dependency order.** Draw a graph. Component A depends on B if A cannot operate without B. Release order is reverse of dependency: most-dependent first.

2. **Group components by lifecycle.** Some are "permanent" (logger, metrics); others are "request-scoped" (DB connection per request); others are "stateful" (worker pools, caches).

3. **Choose the trigger.** Usually a signal (`SIGTERM`) cancels a root context.

4. **Derive a shutdown context.** Fresh context with a deadline (10s, 30s, depending on SLO). Do not reuse the cancelled root context.

5. **Cancel-then-drain.** Cancel new work admission. Wait for in-flight work to finish.

6. **Close components in dependency order.** Most-dependent first. Use `errors.Join` to accumulate failures.

7. **Wait for all goroutines.** `wg.Wait()` or `g.Wait()` at the bottom of main.

8. **Log the outcome.** Successful shutdown? Errors? With which deadline? Ops teams need this trail.

9. **Test the recipe.** A unit or integration test that starts and stops the service in a loop. Assert no leaked goroutines after each iteration.

10. **Document it.** A README or doc comment that lists the order and explains why.

This recipe maps directly onto Go's tools:

| Step | Tool |
|------|------|
| 1 — Identify | Diagram / comment |
| 2 — Group | Type hierarchy |
| 3 — Trigger | `signal.NotifyContext` |
| 4 — Derive | `context.WithTimeout` |
| 5 — Cancel-drain | `cancel()`, `wg.Wait()` |
| 6 — Close | Sequential `Close` + `errors.Join` |
| 7 — Wait | `wg.Wait()` / `g.Wait()` |
| 8 — Log | `slog.Info`/`slog.Error` |
| 9 — Test | `runtime.NumGoroutine` assertions |
| 10 — Document | Doc comments |

Build the recipe once for your service. Apply it the same way for every component. Cleanup ordering becomes a discipline, not a per-bug fire drill.

---

## Appendix C: A Quick Reference of `context.AfterFunc` Subtleties

```
context.AfterFunc(ctx, fn) (stop func() bool)

INVARIANTS
  fn runs at most once
  fn runs in its own new goroutine
  if ctx is already done when AfterFunc is called, fn is scheduled immediately
  stop() returns true if fn was deregistered before starting
  stop() returns false if fn has already started (whether or not finished)
  stop() never blocks
  stop() never waits for fn to finish

YOU OWN
  synchronisation between fn and your other code
  detecting fn completion (use a WaitGroup or done channel)
  ensuring fn is idempotent if it might run concurrently with other cleanup
  fn-internal panic recovery (fn runs in its own goroutine; an unrecovered panic kills the program)

DO
  defer stop()                   for clean deregistration on early exit
  wrap fn with recover()          if fn does anything that might panic
  signal completion explicitly    if you need to wait

DON'T
  assume fn ran by the time the next line executes
  assume stop() means fn is gone
  share state between fn and the registering goroutine without a lock
```

---

## Appendix D: Cleanup-Related Vet / Staticcheck Checks

- `lostcancel` (go vet): warns if a `cancel` from `context.With*` is not used.
- `SA5008` (staticcheck): invalid struct tag (not directly cleanup, but appears next to defer issues).
- `SA9001` (staticcheck): defers in `for ... range` over channels can cause early close.
- `S1023` (staticcheck): redundant `return` statement; sometimes flags defer ordering issues.
- `errcheck`: catches unchecked errors from `Close`, `Stop`, `Shutdown`, etc.

Run these in CI. They catch a surprising fraction of cleanup-ordering bugs.

---

## Appendix E: Quick Reference for `errors.Join` Behaviour

```
errors.Join(nil)              → nil
errors.Join(nil, nil)         → nil
errors.Join(e1)               → e1 (not a wrapped multi-error; identity)
errors.Join(e1, nil)          → e1
errors.Join(e1, e2)           → multi-error wrapping both
errors.Is(joined, target)     → true if any element matches target
errors.As(joined, &t)         → true if any element matches t's type
joined.Error()                → strings.Join of each element's Error(), separated by newlines
```

`errors.Join` is the right default for combining cleanup errors. It is allocation-light (one struct allocation when there are 2+ non-nil errors) and fully integrated with `errors.Is`/`errors.As`.

---

The full middle-level content ends here. Take a deep breath. The senior file is denser still — but you have the conceptual tools to read it without strain.
