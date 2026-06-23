---
layout: default
title: Junior
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/junior/
---

# Error Propagation in Pipelines — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Why Pipeline Errors Are Special](#why-pipeline-errors-are-special)
8. [The First Error Pattern](#the-first-error-pattern)
9. [Introducing errgroup](#introducing-errgroup)
10. [Wrapping Errors with %w](#wrapping-errors-with-w)
11. [Pros and Cons](#pros-and-cons)
12. [Use Cases](#use-cases)
13. [Code Examples](#code-examples)
14. [Coding Patterns](#coding-patterns)
15. [Clean Code](#clean-code)
16. [Product Use](#product-use)
17. [Error Handling](#error-handling)
18. [Security Considerations](#security-considerations)
19. [Performance Tips](#performance-tips)
20. [Best Practices](#best-practices)
21. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
22. [Common Mistakes](#common-mistakes)
23. [Common Misconceptions](#common-misconceptions)
24. [Tricky Points](#tricky-points)
25. [Test](#test)
26. [Tricky Questions](#tricky-questions)
27. [Cheat Sheet](#cheat-sheet)
28. [Self-Assessment Checklist](#self-assessment-checklist)
29. [Summary](#summary)
30. [What You Can Build](#what-you-can-build)
31. [Further Reading](#further-reading)
32. [Related Topics](#related-topics)
33. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction
> Focus: "A stage in my pipeline failed. How do I make sure the caller learns about it, and how do I stop the other stages from working on something nobody will read?"

A **pipeline** in Go is a chain of stages, each running in its own goroutine, connected by channels. Data flows from the first stage to the last. Each stage reads from its input channel, does some work, and writes to its output channel.

The simplest pipeline is three stages:

```
generator  -->  worker  -->  collector
   ch1            ch2
```

The happy path is easy. The hard part is the unhappy path. Suppose `worker` fails on the third item. What should happen?

- The worker should stop pulling new items from `ch1`.
- The generator should stop producing new items (otherwise it blocks forever on a channel nobody reads).
- The collector should stop waiting on `ch2`.
- The error should travel back to whoever called the pipeline.
- All the goroutines should exit cleanly, with no leaks.

A single returned error from a single function is straightforward in Go. But in a pipeline, the error is born inside a goroutine that the caller has no direct reference to. The caller does not own its stack. There is no `try/catch` reaching across goroutines. You must propagate the error through channels, sync primitives, or a coordination type like `errgroup.Group` that wraps both.

This file teaches the foundation. By the end you will:

- Know why a goroutine returning an error is not the same as a function returning an error
- Understand the "first error wins" pattern and how `errgroup` implements it
- Use `context.Context` to cancel sibling stages when one fails
- Wrap errors with `fmt.Errorf("...: %w", err)` so the caller can identify them
- Avoid the four most common mistakes: ignored errors, leaked goroutines on error, double-close panics on channels, and lost cancellation

You do not need to know about `errors.Join`, multi-error aggregation, panic recovery, or compensating rollback yet. Those come at the middle and senior levels.

---

## Prerequisites

- **Required:** Go 1.20 or newer (1.21+ recommended). `errors.Join` exists since 1.20 but is covered at the middle level. `go version`.
- **Required:** Comfort with goroutines and channels at the level of `01-goroutines` and `02-channels`. You should be able to write a producer-consumer with a single goroutine and a buffered channel without thinking hard.
- **Required:** Familiarity with `context.Context` — at minimum `context.WithCancel`, `<-ctx.Done()`, and `ctx.Err()`.
- **Required:** You can read and write a function returning `error`.
- **Helpful:** Knowing what `defer close(ch)` does and why it is the standard pattern for telling consumers a producer is finished.

If you can write the following two functions without help, you are ready:

```go
func gen(ctx context.Context, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}

func consume(ch <-chan int) {
    for v := range ch {
        fmt.Println(v)
    }
}
```

---

## Glossary

| Term | Definition |
|------|-----------|
| **Pipeline** | A chain of stages connected by channels. Each stage is one or more goroutines. |
| **Stage** | A function that reads from input channels, does work, and writes to output channels. |
| **Error propagation** | The act of moving an error from where it was detected to where it can be handled. |
| **First-error-wins** | A policy where the first error from any stage cancels all the others; subsequent errors are ignored or logged. |
| **Aggregation** | The opposite of first-error-wins: collect every error and surface them together. |
| **Cancellation** | A signal — usually via `context.Context` — that downstream and sibling work should stop. |
| **`errgroup.Group`** | A type from `golang.org/x/sync/errgroup` that combines `sync.WaitGroup` with first-error capture and (optionally) context cancellation. |
| **Sentinel error** | A predeclared error value used as a marker, compared with `errors.Is`. Example: `io.EOF`. |
| **Wrapped error** | An error that contains another error, accessible via `errors.Unwrap`, `errors.Is`, or `errors.As`. Created with `fmt.Errorf("...: %w", err)`. |
| **Goroutine leak** | A goroutine that never exits because it is blocked on a channel send or receive after the caller has moved on. The most common pipeline bug. |
| **Drain** | The act of reading and discarding remaining values from a channel so that the producer can finish and exit. |
| **Compensating action** | An operation that undoes a previously successful step when a later step fails (e.g. delete the row that was just inserted). Covered at senior level. |
| **`context.Cancel`** | The function returned by `context.WithCancel` (and friends). Calling it marks the context as Done and unblocks every `<-ctx.Done()`. |
| **Fan-out** | A stage running with N parallel workers instead of one. Multiplies the error coordination problem. |

---

## Core Concepts

### 1. A goroutine has no return value

In sequential code, a function returns its error:

```go
func step1() error { ... }
func step2() error { ... }

if err := step1(); err != nil { return err }
if err := step2(); err != nil { return err }
```

In concurrent code, you start a goroutine like `go step1()`. The `go` statement does not give you back a value. Whatever `step1` returns is discarded by the runtime. If `step1` fails, you must arrange to *publish* the error somewhere the caller can see it.

There are three common publication channels:

1. A dedicated error channel: `errCh := make(chan error, 1)`.
2. A shared error variable protected by a mutex.
3. An `errgroup.Group`, which combines both above behind a clean API.

### 2. Errors must travel across a synchronisation boundary

If goroutine A writes to a variable and goroutine B reads it without synchronisation, the program has a data race. The race detector will flag it. So when you put an error somewhere, you must either:

- Use an atomic operation or mutex
- Use a channel send/receive (which synchronises by the Go memory model)
- Use a primitive like `sync.Once` or `errgroup.Group` that handles it for you

This is why the naive "just write to a global error variable" pattern is wrong even though it "works most of the time" in casual testing.

### 3. The first stage to fail should stop the others

In most pipelines, after the first failure further work is wasted. The classic pattern is:

- The failing stage records the error
- A cancellation signal is broadcast to siblings
- Siblings notice the signal and exit
- The caller receives the first error

This is what `errgroup.WithContext` automates.

### 4. Channel close is a separate concept from error

In Go, closing a channel means "no more values will be sent." It does not mean "an error occurred." A consumer ranging over a channel exits the loop on close. So the question "did the producer finish normally or with an error?" is answered by *also* checking an error variable — never by inspecting the channel alone.

A naive design that tries to encode error-versus-success into channel state — for instance, leaving a channel open on error and closing it on success — is fragile and confusing. Keep these two concerns separate.

### 5. The caller must `Wait()` before reading the error

You cannot read an error variable before the writing goroutine has set it. With `errgroup` you call `g.Wait()`, which blocks until every goroutine has returned and then gives you the first non-nil error. Reading `g` before `Wait` is meaningless.

---

## Real-World Analogies

**A factory assembly line.** Each station does one operation on the product moving along the belt. If station 3 detects a defect, it cannot just stop its own arm — the belt is still feeding it. Someone has to press the emergency stop, which signals stations 1, 2, 4, and 5 to halt too. The defect report (the error) is then carried back to the foreman.

**A relay race where one runner trips.** The next runner is already moving forward expecting the baton. The teammate behind sees the fall and shouts "stop!" so everyone clears the track. The coach (the caller) gets the report.

**A restaurant kitchen.** Appetiser, main, dessert stations work in parallel for one table. If the main is burned, there is no point plating the dessert. The expediter (the coordinator) calls "fire the table again from the top," cancelling outstanding work. The waiter (the caller) is told what went wrong.

**Three plumbers fixing a leaky house.** One discovers a cracked pipe upstream. The others should stop tightening downstream fittings — their work is useless until the cracked pipe is replaced. Without a foreman, they will keep working blindly. The foreman is the `context.Context`.

---

## Mental Models

### Model 1: Stages are independent processes connected by pipes

Think of a Go pipeline as a Unix pipeline: `cat file | grep foo | wc -l`. Each program is independent. If `grep` exits with an error, the kernel sends SIGPIPE to `cat` and closes the pipe to `wc`. In Go, the analogue of SIGPIPE is `context.Cancel`, and the analogue of pipe-close is `close(channel)`. Your job as the pipeline author is to wire up both signals correctly.

### Model 2: The pipeline is a state machine with two terminal states

`Running -> Done` and `Running -> Failed(err)`. Every goroutine in the pipeline must be designed to land in one of these states without leaking. Designing each stage to exit when its input closes *and* when `ctx.Done()` fires is the trick. Either condition is sufficient.

### Model 3: Errors flow up the call tree, data flows down the pipe

Data moves from generator to collector through channels. Errors move from any stage back up to the caller through a shared error-capture mechanism. These are two different flows and they should not share a channel.

### Model 4: `errgroup` is a `WaitGroup` with a brain

A `WaitGroup` knows "are we done?" An `errgroup.Group` knows "are we done, and if anyone failed, give me the first error." Internally it is a `WaitGroup` plus a `sync.Once`-protected error field plus (optionally) a derived `Context`.

---

## Why Pipeline Errors Are Special

In a single-threaded function, an error is local. The stack frame still exists, the variables are still alive, and you simply return. In a pipeline:

1. **The error is born in a sibling goroutine.** The parent has no stack to unwind. The error has to be moved.
2. **Other goroutines are still running.** Without explicit cancellation they will keep producing or consuming, wasting CPU, memory, network, and (in the worst case) issuing irreversible side effects like writing to a database.
3. **Some goroutines are blocked.** A stage waiting on `ch <- value` cannot just "be told" about the error — it has to be unblocked, which means either the receiver must drain the channel or the sender must `select` on `ctx.Done()`.
4. **Resources are held.** Open files, database connections, network sockets, allocated buffers — every running stage may be holding something that needs releasing.
5. **The caller may have already moved on.** If the caller's context is cancelled (timeout, parent cancellation), goroutines that don't check `ctx.Done()` will leak.

Each of these is solvable. The composite solution is what production-grade Go calls "structured concurrency": every spawned goroutine has a defined termination condition, every error has a route to the surface, and every blocking operation is `select`-ed against cancellation.

---

## The First Error Pattern

The most common policy for pipelines is **first error wins**. The first stage to fail:

1. Records its error.
2. Triggers cancellation.
3. Subsequent errors from other stages are discarded (or logged separately).

The caller receives exactly one error: the one that "started the failure cascade." This matches user expectations — when a CLI tool prints an error and exits, you want the *root cause*, not a list of secondary effects.

A bare-bones implementation:

```go
func run() error {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    errCh := make(chan error, 3) // buffered = number of stages, prevents blocking
    var wg sync.WaitGroup

    wg.Add(3)
    go func() { defer wg.Done(); errCh <- stage1(ctx) }()
    go func() { defer wg.Done(); errCh <- stage2(ctx) }()
    go func() { defer wg.Done(); errCh <- stage3(ctx) }()

    // Wait for all to finish, but cancel as soon as one fails.
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()

    var firstErr error
    for {
        select {
        case err := <-errCh:
            if err != nil && firstErr == nil {
                firstErr = err
                cancel()
            }
        case <-done:
            return firstErr
        }
    }
}
```

This works, but it has corner cases (buffer size, draining, the `for-select` racing with `done`). Nobody writes it from scratch. The community settled on `golang.org/x/sync/errgroup`, which gives you the same semantics in two lines.

---

## Introducing errgroup

`errgroup.Group` is the workhorse for first-error-wins pipelines.

```go
import "golang.org/x/sync/errgroup"

func run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)

    g.Go(func() error { return stage1(ctx) })
    g.Go(func() error { return stage2(ctx) })
    g.Go(func() error { return stage3(ctx) })

    return g.Wait()
}
```

What this does:

- `errgroup.WithContext(ctx)` returns a `*Group` and a derived context. The derived context is cancelled automatically the moment any `g.Go` function returns a non-nil error.
- `g.Go(fn)` spawns a goroutine that runs `fn`. Internally, the group does `wg.Add(1)` for you. The function's return value is captured atomically.
- `g.Wait()` blocks until every spawned goroutine has returned. It then returns the *first* non-nil error captured. If every goroutine returned `nil`, `Wait` returns `nil`.

The "first non-nil error" is captured with a `sync.Once`, so concurrent failures are safe. The cancellation happens the moment the first error is captured, before `Wait` returns — every other stage that respects the context can stop early.

A complete tiny pipeline:

```go
package main

import (
    "context"
    "fmt"
    "log"

    "golang.org/x/sync/errgroup"
)

func main() {
    if err := run(context.Background()); err != nil {
        log.Fatal(err)
    }
}

func run(parent context.Context) error {
    g, ctx := errgroup.WithContext(parent)

    nums := make(chan int)
    doubled := make(chan int)

    // Stage 1: generate
    g.Go(func() error {
        defer close(nums)
        for i := 0; i < 5; i++ {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case nums <- i:
            }
        }
        return nil
    })

    // Stage 2: transform
    g.Go(func() error {
        defer close(doubled)
        for n := range nums {
            if n == 3 {
                return fmt.Errorf("worker: refuse to process %d", n)
            }
            select {
            case <-ctx.Done():
                return ctx.Err()
            case doubled <- n * 2:
            }
        }
        return nil
    })

    // Stage 3: collect
    g.Go(func() error {
        for v := range doubled {
            fmt.Println(v)
        }
        return nil
    })

    return g.Wait()
}
```

Three things to notice:

1. **Every send is wrapped in `select`** with `<-ctx.Done()`. Without this, when the worker returns with an error, the generator would block forever trying to send into `nums`.
2. **`defer close(out)`** is the responsibility of each stage's *sender*. Even when failing, you must `close` so downstream `range` loops exit. (The `defer` runs whether the function returns normally or via error.)
3. **The collector returns `nil`** — its only job is to drain. If it returned an error, that error might overwrite the meaningful one from the worker, depending on ordering. (At the middle level we look at how to avoid this.)

If you run the program, you see `0 2 4` printed (some interleaving possible), then the program exits with the error `worker: refuse to process 3`. The generator stopped because the worker returned, `doubled` was closed by the worker, the collector finished naturally, and `Wait` returned the worker's error.

---

## Wrapping Errors with %w

When the worker returns `fmt.Errorf("worker: refuse to process %d", n)`, the caller sees one string and that is fine for a top-level message. But in a real system you often want to keep the *original* error around — perhaps a `sql.ErrNoRows` or a network timeout — while *adding context* that says where it came from.

This is what `%w` does in `fmt.Errorf`:

```go
err := db.QueryRow(...).Scan(&x)
if err != nil {
    return fmt.Errorf("worker: load user %d: %w", id, err)
}
```

The returned error formats as `"worker: load user 42: sql: no rows in result set"` when you print it. But it *also* satisfies `errors.Is(err, sql.ErrNoRows)`, because the wrapped error is preserved inside.

The caller code:

```go
if err := run(ctx); err != nil {
    if errors.Is(err, sql.ErrNoRows) {
        // expected case, handle gracefully
    } else {
        log.Println("unexpected error:", err)
    }
}
```

This is the foundation of *typed* error handling in Go. Without `%w`, every layer would erase the original error and the caller would have to do string matching, which is fragile.

Rules of thumb at the junior level:

- **Always wrap** errors crossing a stage boundary, so the chain says "stage X: stage Y: underlying detail."
- **Use one verb per wrap.** `fmt.Errorf("worker: %w", err)` adds one layer. Do not concatenate two `%w` verbs.
- **Lowercase, no trailing punctuation.** `fmt.Errorf("connect to db: %w", err)`, not `fmt.Errorf("Connect to DB.: %w", err)`. The standard library style is lowercase, colon-separated, no period.
- **Do not wrap if you also do not add information.** `fmt.Errorf("%w", err)` is pointless. Just return `err`.

A complete example combining `errgroup` with wrapping:

```go
func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(urls))

    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            r, err := fetchOne(ctx, u)
            if err != nil {
                return fmt.Errorf("fetch %s: %w", u, err)
            }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

If `fetchOne` for URL `https://example.com/users/42` returned `context.DeadlineExceeded`, the caller sees: `"fetch https://example.com/users/42: context deadline exceeded"` and `errors.Is(err, context.DeadlineExceeded)` returns true.

---

## Pros and Cons

### Pros of the first-error-wins / errgroup pattern

- **Simple mental model.** "Someone failed; everyone stops." Matches how callers think about CLIs and RPC handlers.
- **Cancellation is automatic.** No manual `cancel()` plumbing — the group does it.
- **Composable.** Groups can be nested. One stage of a parent group can run its own subgroup.
- **Production-tested.** `errgroup` has been in `golang.org/x/sync` since 2016 and is used in nearly every major Go service.
- **Fast.** Internally cheap: a `WaitGroup`, a `sync.Once`, and one cancel function pointer.
- **Race-free.** First-error capture uses `Once`. No mutex acquisition on every error.

### Cons

- **You lose secondary errors.** If two stages fail at the same time, only one bubbles up. The other is silently dropped (unless you capture it separately for logging).
- **Cancellation is cooperative.** A stage that does not check `<-ctx.Done()` will keep running after a sibling fails. The group still waits for it.
- **Resource cleanup is your job.** `errgroup` does not call `Close()` on anything. Each stage is responsible for its own `defer`.
- **No backpressure built in.** If your stages run at different speeds, channel buffering is still your concern.
- **No panic safety by default.** A panic in a `g.Go` function crashes the program. (At senior level we cover wrapping it.)

---

## Use Cases

- **ETL pipelines:** read rows, transform, write — first error fails the batch.
- **Parallel HTTP fetches:** fan out to N URLs, return on first failure or all succeed.
- **Build systems:** compile multiple files concurrently, surface the first compile error.
- **Image processing:** decode, resize, encode in a pipeline; bad image fails the request.
- **Streaming aggregation:** read messages, parse, batch, flush — any parse failure surfaces.
- **CLI tools:** parallelise file walks, return first error so the user sees a clear root cause.

When **not** to use first-error-wins:

- Batch jobs where you want to report *every* failed item (use aggregation, covered at senior level).
- Background workers that should keep processing on individual failures (handle errors per-item, not per-pipeline).
- User-facing forms where you want to show all validation errors at once.

---

## Code Examples

### Example 1: Two-stage pipeline with cancellation

```go
func sumSquares(ctx context.Context, nums []int) (int64, error) {
    g, ctx := errgroup.WithContext(ctx)
    in := make(chan int)
    squared := make(chan int64)

    g.Go(func() error {
        defer close(in)
        for _, n := range nums {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case in <- n:
            }
        }
        return nil
    })

    g.Go(func() error {
        defer close(squared)
        for n := range in {
            if n < 0 {
                return fmt.Errorf("negative input %d", n)
            }
            select {
            case <-ctx.Done():
                return ctx.Err()
            case squared <- int64(n) * int64(n):
            }
        }
        return nil
    })

    var total int64
    g.Go(func() error {
        for v := range squared {
            total += v
        }
        return nil
    })

    if err := g.Wait(); err != nil {
        return 0, err
    }
    return total, nil
}
```

The collector mutates `total` without a mutex — that is safe because every `g.Go` goroutine runs concurrently with the others, but `g.Wait()` provides a happens-before relationship: the writes to `total` are visible to the caller after `Wait` returns. (We will look closer at this in the memory-model section at the senior level.)

### Example 2: Fan-out fetch

```go
func fetchAll(ctx context.Context, urls []string) ([]string, error) {
    g, ctx := errgroup.WithContext(ctx)
    bodies := make([]string, len(urls))

    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
            if err != nil {
                return fmt.Errorf("build request %s: %w", u, err)
            }
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                return fmt.Errorf("fetch %s: %w", u, err)
            }
            defer resp.Body.Close()
            b, err := io.ReadAll(resp.Body)
            if err != nil {
                return fmt.Errorf("read %s: %w", u, err)
            }
            bodies[i] = string(b)
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return bodies, nil
}
```

When one fetch fails, the context is cancelled. All in-flight `http.Client.Do` calls observe the cancellation (via `http.NewRequestWithContext`) and abort, freeing TCP connections immediately. Without context propagation, slow URLs would keep loading after the first failure for as long as their server allows.

### Example 3: Wrapping in a multi-stage chain

```go
func processFile(ctx context.Context, path string) error {
    f, err := os.Open(path)
    if err != nil {
        return fmt.Errorf("open %s: %w", path, err)
    }
    defer f.Close()

    rows, err := parse(ctx, f)
    if err != nil {
        return fmt.Errorf("parse %s: %w", path, err)
    }

    if err := store(ctx, rows); err != nil {
        return fmt.Errorf("store %s: %w", path, err)
    }
    return nil
}
```

The final error chain for a corrupted file might read: `"parse /var/data/x.csv: line 42: unexpected EOF"`. The caller can `errors.Is(err, io.ErrUnexpectedEOF)` to handle it specifically while still showing the human-friendly message.

### Example 4: Sentinel error as a control signal

```go
var errNotFound = errors.New("not found")

func lookup(ctx context.Context, id int) (User, error) {
    u, err := db.Get(ctx, id)
    if errors.Is(err, sql.ErrNoRows) {
        return User{}, fmt.Errorf("lookup %d: %w", id, errNotFound)
    }
    if err != nil {
        return User{}, fmt.Errorf("lookup %d: %w", id, err)
    }
    return u, nil
}

func handler(w http.ResponseWriter, r *http.Request) {
    u, err := lookup(r.Context(), 42)
    switch {
    case errors.Is(err, errNotFound):
        http.NotFound(w, r)
    case err != nil:
        http.Error(w, "internal error", http.StatusInternalServerError)
    default:
        json.NewEncoder(w).Encode(u)
    }
}
```

The point: `errNotFound` is a package-level sentinel. Callers compare with `errors.Is`, not `==`, so wrapping does not break the comparison. We cover sentinels in depth at the middle level.

### Example 5: A pipeline returning partial results plus an error

For some tasks, partial results are valuable even on failure (e.g. "we fetched 4 of 5 URLs"). Done naively, this is brittle. The idiomatic shape is:

```go
func fetchAll(ctx context.Context, urls []string) ([]Body, error) {
    g, ctx := errgroup.WithContext(ctx)
    bodies := make([]Body, len(urls))

    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            b, err := fetch(ctx, u)
            if err != nil {
                return fmt.Errorf("fetch %s: %w", u, err)
            }
            bodies[i] = b
            return nil
        })
    }
    err := g.Wait()
    // bodies contains successful results in their positions; failed indices are zero values.
    return bodies, err
}
```

The caller checks `err`, but can still inspect `bodies` for what arrived before the cancellation. This is the simplest "best-effort" pattern; it works because `g.Wait()` ensures all writes to `bodies` happen-before the return.

---

## Coding Patterns

### Pattern: `g, ctx := errgroup.WithContext(parent)` is line one

Every error-aware pipeline starts with this. Forgetting `WithContext` means your group will not cancel siblings on error; you only get error capture. That is rarely what you want.

### Pattern: `defer close(out)` inside the sender goroutine

Every stage that owns an output channel must close it on its way out. The cleanest place is the very first `defer` of the goroutine body:

```go
g.Go(func() error {
    defer close(out)
    // ... do work, send to out, return error or nil ...
})
```

### Pattern: every send is `select { case <-ctx.Done(): ...; case out <- v: }`

This prevents blocking when downstream has already failed.

### Pattern: every receive uses `for v := range in`

The consumer terminates naturally when the sender closes. If the consumer also needs to check `ctx.Done()`, use `select`:

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case v, ok := <-in:
        if !ok { return nil }
        // handle v
    }
}
```

The `for-range` is simpler and works when the only reason to stop is a closed channel. The explicit `select` is needed when the consumer wants to stop even before the channel closes (e.g. it has work of its own that can fail).

### Pattern: capture loop variables explicitly when launching goroutines

Even on Go 1.22+ where per-iteration scoping is the default, an explicit `i, u := i, u` line makes the intent obvious and protects you on older Go versions.

### Pattern: wrap once per layer, not per error site

If you wrap inside `step1` and again inside its caller, the user sees a clean chain. If every site inside `step1` adds its own wrap, the chain is noisy. One wrap per logical boundary.

---

## Clean Code

A clean pipeline at the junior level has these properties:

1. **One function constructs and runs the pipeline end-to-end.** Stages are small functions or closures inside it.
2. **All channels are created in one place.** No channel is created by one stage and consumed by a completely separate one — that makes ownership unclear.
3. **`defer close(out)` is the first statement of every sender goroutine.** No exceptions.
4. **No `nil` error handling.** Either return `nil` cleanly or return an error. Never `panic` for control flow.
5. **No goroutine reads a shared variable without `g.Wait()` first.** Writes from `g.Go` functions are visible after `Wait`; before that, they are races.
6. **No `time.Sleep` for synchronisation.** Always use `<-ctx.Done()` or a channel.
7. **Errors are wrapped at every cross-stage boundary.** The final error tells the user *which stage*, *what input*, and *what underlying cause*.

A clean three-stage pipeline reads top-to-bottom like:

```go
func run(ctx context.Context, input <-chan Job) error {
    g, ctx := errgroup.WithContext(ctx)
    parsed := make(chan Parsed)
    enriched := make(chan Enriched)

    g.Go(func() error { defer close(parsed);   return parseStage(ctx, input, parsed) })
    g.Go(func() error { defer close(enriched); return enrichStage(ctx, parsed, enriched) })
    g.Go(func() error {                        return writeStage(ctx, enriched) })

    return g.Wait()
}
```

This is the shape to aim for. Three lines of `g.Go`, three named stage functions, one `Wait`. Anything more complicated should be questioned.

---

## Product Use

### Where errgroup pipelines appear in real products

- **API request handlers.** When one request triggers parallel sub-requests (load user, load orders, load preferences), `errgroup.WithContext(r.Context())` is the standard wrapper.
- **Batch import jobs.** Read CSV, validate, dedupe, insert — each row is a unit, the pipeline is one batch.
- **Search indexers.** Crawl, parse, tokenise, write to index.
- **Image and video transcoders.** Decode, transform, encode in parallel for each output format.
- **Webhook fan-out.** When delivering an event to N subscribers, an `errgroup` keeps things parallel while surfacing the first delivery failure.
- **Internal tooling.** Database migrations, log analyzers, deployment scripts.

### Product trade-off: fail fast vs degrade gracefully

A user-facing handler usually wants fail fast: surface the first error and let the user retry. A scheduled batch job often wants the opposite: log the failure, continue processing the rest, and produce a report. The product decision drives whether you use `errgroup` (fail fast) or per-item error handling with aggregation (degrade gracefully). The middle and senior files cover the second pattern.

### Observability hook

In production, before returning the error from `g.Wait()`, log it (or add a structured log via your logger). `errgroup` does not log anything itself.

```go
err := g.Wait()
if err != nil {
    logger.Error("pipeline failed", "err", err)
}
return err
```

This double-surface — log inside, return outside — is the standard production shape.

---

## Error Handling

The junior-level checklist:

1. Wrap with `%w` when crossing a stage boundary. Never bare-`return err` if more context would help.
2. Never `fmt.Errorf("error: %s", err.Error())`. That loses the chain.
3. Compare errors with `errors.Is` and `errors.As`, never with `==` (unless you really know it is a known sentinel and not wrapped).
4. If a stage returns `context.Canceled` because the parent cancelled, that *is* the error. Do not invent a "wrapper" error like `errors.New("cancelled")`.
5. Treat `nil` returns as success. Treat any non-nil as failure. There is no third state.
6. Return one error per stage. If a stage discovers two errors at once, wrap one and log the other, or move to middle-level aggregation.

A "context.Canceled vs real error" check is the most common subtlety:

```go
err := g.Wait()
switch {
case err == nil:
    // success
case errors.Is(err, context.Canceled):
    // parent cancelled us — usually not a failure of *our* pipeline
    return nil
case errors.Is(err, context.DeadlineExceeded):
    return fmt.Errorf("pipeline timed out: %w", err)
default:
    return fmt.Errorf("pipeline failed: %w", err)
}
```

---

## Security Considerations

Pipeline error propagation has a few subtle security angles:

- **Do not leak secrets in error messages.** If your stage handles a credential, `fmt.Errorf("auth with key %s: %w", apiKey, err)` will print the key. Use `fmt.Errorf("auth: %w", err)` instead.
- **Do not return raw error strings to untrusted users.** Internal errors may reveal database structure, file paths, internal hostnames. Map errors to a user-facing form at the HTTP boundary.
- **Resource exhaustion under failure.** If your error path leaks goroutines or open files, an attacker who triggers errors repeatedly can DoS your service. Audit your stages' cleanup paths.
- **Don't log full requests on every error.** Logs are often shipped to less-trusted systems. Strip PII before serialising.

These are not pipeline-specific, but they are easy to forget when your wrap looks innocent.

---

## Performance Tips

At the junior level, performance is about correctness first and avoiding obviously wasteful work second.

- **Buffer channels when appropriate.** A buffered channel with capacity 1 between two stages doubles potential parallelism if stages are uneven. Don't go overboard — over-buffering hides backpressure problems.
- **Cancel early.** Every stage that respects `ctx.Done()` saves the work it would have done. Don't write a stage that completes a long operation before checking cancellation.
- **Don't allocate errors on the hot path.** If you might call `fmt.Errorf` millions of times per second, prefer a pre-defined sentinel for the common case.
- **Close output channels promptly.** A delayed `close` keeps the downstream consumer blocked, delaying overall pipeline shutdown on failure.
- **Use `errgroup.SetLimit` if you have a huge fan-out.** Capping parallelism at, say, `runtime.NumCPU()*4` avoids resource thrash. (Covered in middle.)

At the architecture level, the biggest performance win on the error path is *fast cancellation*: when one stage fails, every sibling notices and exits within milliseconds. A pipeline that takes 30 seconds to "wind down" after a failure has cancellation bugs.

---

## Best Practices

1. **Always use `errgroup.WithContext`, never bare `errgroup.Group`** unless you have a specific reason. The context-bound version is what people expect.
2. **One sender per channel.** If you have multiple goroutines that want to send to the same channel, route them through a fan-in stage. This makes `close` unambiguous.
3. **Cancellation is everyone's job.** Every blocking operation (`send`, `recv`, `db.Query`, `http.Do`) should be cancellable via `ctx`.
4. **Stages are functions, not anonymous code.** A stage you can name and unit-test is a stage you can reason about. Inline goroutine bodies become unmaintainable past three stages.
5. **Log inside, return outside.** Log the error in the stage where you first know about it (with context), then return it. This gives you a trail in logs even if the caller silently handles the error.
6. **Never `recover()` and ignore.** If you must recover from a panic in a stage, convert it to an error and return it. Hiding panics is hiding bugs.
7. **`Wait` exactly once.** Calling `g.Wait()` a second time on a re-used group is a bug (the group is single-use).

---

## Edge Cases and Pitfalls

### Pitfall 1: Forgotten close, downstream blocks forever

```go
g.Go(func() error {
    for _, v := range items {
        out <- v
    }
    return nil // <-- forgot defer close(out)
})
```

The downstream `for v := range out` never returns. `g.Wait()` blocks forever.

### Pitfall 2: Send without `select`, blocks on cancelled context

```go
g.Go(func() error {
    defer close(out)
    for _, v := range items {
        out <- v   // <-- no select on ctx.Done()
    }
    return nil
})
```

If the downstream stage fails and stops reading, this goroutine blocks forever on `out <- v`. The group never closes.

### Pitfall 3: Buffered error channel with the wrong size

```go
errCh := make(chan error, 1)  // assumes only one stage produces error
g.Go(func() error { errCh <- stage1(); return nil })
g.Go(func() error { errCh <- stage2(); return nil })  // <-- blocks if first wrote already
```

This is one reason people use `errgroup` instead of rolling their own.

### Pitfall 4: Reading the error variable before Wait

```go
var firstErr error
g.Go(func() error { /* writes to firstErr */ return nil })
fmt.Println(firstErr)  // <-- race; goroutine may not have run yet
g.Wait()
```

Reading shared state before `Wait` is a race. Read after.

### Pitfall 5: Recovering a panic but not draining

```go
g.Go(func() error {
    defer func() { recover() }()
    panic("boom")
})
```

The goroutine returns `nil` and the panic is swallowed. The pipeline appears successful. This is worse than the panic itself. If you recover, convert to error and return it.

### Pitfall 6: Mixing errgroup with manual cancel

```go
g, ctx := errgroup.WithContext(parent)
ctx2, cancel := context.WithCancel(ctx)
defer cancel()
g.Go(func() error { return doWork(ctx2) })
```

Here `cancel` is called when `run` returns, *which is fine*, but it is easy to write code that calls `cancel` accidentally early. Trust `errgroup` to do the cancellation; don't layer your own.

### Pitfall 7: Returning `ctx.Err()` when you don't want to

When a sibling fails, every other stage receives `ctx.Err() == context.Canceled` and many implementations dutifully return it. But `errgroup.Wait` returns the *first* error, not necessarily the *root cause*. If your worker returned `context.Canceled` first (because it noticed cancellation before the real failure reached `Wait`), you may see `context.Canceled` instead of the meaningful error. The fix: structure stages so that cancellation-from-sibling returns `ctx.Err()` *only if* nothing else has been seen. In practice, since `errgroup` captures via `sync.Once` (first wins), this is usually self-correcting — but be aware that during shutdown your stage's "error" might be cancellation noise.

---

## Common Mistakes

1. **Naked `go func()` inside a function that returns an error.** The function returns before the goroutine, and the error is lost. Use `errgroup`.
2. **Returning before draining.** If a stage returns early without reading the rest of its input channel, the producer blocks forever.
3. **Returning `err.Error()` as `errors.New`** — `errors.New(err.Error())` is a destructive copy that loses the wrap chain.
4. **Using `==` to compare wrapped errors.** `err == io.EOF` fails if someone wrapped EOF. Use `errors.Is(err, io.EOF)`.
5. **Sharing an `errgroup` between requests.** Each request should have its own. Groups are single-use.
6. **Forgetting to handle `ctx.Done()` in `select`.** Every blocking primitive in a stage needs a cancellation branch.
7. **Wrapping `nil`.** `fmt.Errorf("foo: %w", nil)` creates an error whose `Unwrap` returns `nil`. The chain looks corrupt. Always check `if err != nil` first.

---

## Common Misconceptions

> "errgroup catches panics."

No. A panic in a `g.Go` function crashes the program. You must `recover` manually (see senior level).

> "`g.Wait` returns when context is cancelled."

No. `g.Wait` returns when every spawned goroutine has returned. If a goroutine ignores cancellation, `Wait` blocks. The context cancellation is just a signal; cooperation is required.

> "`errgroup.WithContext` cancels on any error, including `context.Canceled`."

Almost. It cancels on any non-nil error, but if the cancellation reason was a parent context, the group's context was already cancelled — the error captured is still the first one observed.

> "Wrapping makes errors bigger and slower."

`fmt.Errorf("...: %w", err)` allocates a small wrapper struct. The cost is microseconds at most. Worry about other things first.

> "Sentinel errors are bad style."

Far from it. They are the simplest way to express "this specific failure mode" and they compose with `errors.Is`. The advice "prefer error types over sentinels" applies to broad categories like `*os.PathError`, not to focused markers like `io.EOF`.

---

## Tricky Points

- **`errgroup.Group` zero value is usable**, but you do not get context cancellation. Always prefer `errgroup.WithContext`.
- **`g.Go` does not block on `Add` if there is no `Wait`** — but the spawned goroutine is still running. Lifetime is bound by `Wait`, not by `Go`.
- **Order of `defer close(out)` matters relative to the rest of the body.** Put it first so it runs last (defers stack LIFO).
- **`errgroup` v1 vs `errgroup.Group{}`.** Both work; `WithContext` is the production form.
- **The captured error is the *first goroutine's return value* that was non-nil.** Even if a later goroutine has a "better" error, you get the first.
- **`g.Wait` returns the same value if called repeatedly.** It is safe to read after `Wait`, but you usually only call it once.

---

## Test

```go
func TestRunFailsOnNegative(t *testing.T) {
    _, err := sumSquares(context.Background(), []int{1, 2, -1})
    if err == nil {
        t.Fatal("expected error, got nil")
    }
    if !strings.Contains(err.Error(), "negative") {
        t.Fatalf("wrong error: %v", err)
    }
}

func TestRunCancelsSiblings(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    g, gctx := errgroup.WithContext(ctx)
    var fastDone, slowDone bool

    g.Go(func() error {
        time.Sleep(10 * time.Millisecond)
        return errors.New("fast fail")
    })
    g.Go(func() error {
        defer func() { slowDone = true }()
        select {
        case <-gctx.Done():
            return gctx.Err()
        case <-time.After(time.Second):
            return nil
        }
    })
    err := g.Wait()
    if err == nil || !strings.Contains(err.Error(), "fast fail") {
        t.Fatalf("expected fast fail, got %v", err)
    }
    if !slowDone {
        t.Fatal("slow goroutine did not exit")
    }
    _ = fastDone
}
```

The second test verifies the core promise: when one stage fails, sibling stages exit promptly via `ctx.Done()`.

---

## Tricky Questions

**Q. If I call `g.Go` 100 times and then `g.Wait`, does it spawn 100 goroutines simultaneously?**

Yes, by default. Each `g.Go` immediately spawns a goroutine. The function does not return until `Wait` is called. If you want to cap parallelism, use `g.SetLimit(n)` (added in `errgroup` in 2022; covered at middle level).

**Q. Does `errgroup` panic if I call `g.Go` after `g.Wait`?**

No — `Go` still runs the function in a goroutine and the result is added, but the function call to `Wait` has already returned with its current state. Calling `Go` after `Wait` is a programming error, even if it does not panic. Use a fresh group.

**Q. What if my stage function is `func(ctx context.Context) error` and I want to pass it to `g.Go` (which expects `func() error`)?**

Wrap with a closure:

```go
g.Go(func() error { return myStage(ctx) })
```

This is the universal adapter.

**Q. If two stages fail with different errors at the exact same instant, which one wins?**

Whichever wrote to the internal `sync.Once` first. The order is unspecified; it depends on scheduler timing. If you care about both, use aggregation (senior level).

**Q. Can I nest errgroups?**

Yes. The outer group's context becomes the parent of the inner group's context. The inner group's cancellation does not affect the outer. The outer's cancellation cascades to the inner.

---

## Cheat Sheet

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(parent)

g.Go(func() error {
    defer close(out)
    for v := range in {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case out <- transform(v):
        }
    }
    return nil
})

if err := g.Wait(); err != nil {
    return fmt.Errorf("pipeline: %w", err)
}
```

Rules:

- `errgroup.WithContext`, not `errgroup.Group{}`.
- `defer close(out)` in the sender.
- `select` on every send.
- `for range` on every receive (unless you also need `ctx.Done()`).
- `%w` to wrap on the way out.
- `errors.Is` to identify on the way in.

---

## Self-Assessment Checklist

- [ ] I can explain why goroutine errors are different from sequential errors.
- [ ] I can write an `errgroup`-based pipeline of three stages without referring to docs.
- [ ] I always `defer close(out)` in sender goroutines.
- [ ] I always `select` on `ctx.Done()` for sends and recv loops.
- [ ] I wrap errors with `%w` when crossing stages.
- [ ] I use `errors.Is`/`errors.As` to identify errors, never bare `==`.
- [ ] I know what happens if I forget `WithContext`.
- [ ] I can name three real-world systems where this pattern fits.

---

## Building Up From Scratch: Five Iterations

The fastest way to internalise pipeline error propagation is to build the same pipeline five times, each time fixing one problem the previous iteration had. We'll process a slice of integers, double each one, and return the sum. If we encounter a negative input, the pipeline must fail.

### Iteration 1: Sequential baseline

```go
func sumDoubled(nums []int) (int, error) {
    total := 0
    for _, n := range nums {
        if n < 0 {
            return 0, fmt.Errorf("negative: %d", n)
        }
        total += n * 2
    }
    return total, nil
}
```

Trivially correct. No concurrency. The error returns up the stack like any other Go error. This is the reference behaviour we want from every concurrent version.

### Iteration 2: Naive goroutines (broken)

```go
func sumDoubled(nums []int) (int, error) {
    total := 0
    var mu sync.Mutex

    for _, n := range nums {
        n := n
        go func() {
            if n < 0 {
                fmt.Println("error: negative", n)
                return
            }
            mu.Lock()
            total += n * 2
            mu.Unlock()
        }()
    }
    // The main goroutine returns immediately; total is unfinished.
    return total, nil
}
```

Problems:

- Returns before goroutines complete. `total` is whatever it was when `main` got there.
- The error is *printed*, not returned. The caller has no way to know it happened.
- No cancellation — even if we knew about the error, the other goroutines keep running.
- No coordination at all.

### Iteration 3: WaitGroup + error variable (still broken)

```go
func sumDoubled(nums []int) (int, error) {
    total := 0
    var mu sync.Mutex
    var firstErr error
    var wg sync.WaitGroup

    for _, n := range nums {
        n := n
        wg.Add(1)
        go func() {
            defer wg.Done()
            if n < 0 {
                mu.Lock()
                if firstErr == nil {
                    firstErr = fmt.Errorf("negative: %d", n)
                }
                mu.Unlock()
                return
            }
            mu.Lock()
            total += n * 2
            mu.Unlock()
        }()
    }
    wg.Wait()
    return total, firstErr
}
```

Better. We wait for all goroutines, capture the first error, return both. But:

- All goroutines run to completion even after a failure. With heavy work, this is wasteful.
- No context propagation — if the caller cancels, we don't know.
- The "first error" check is locked behind a mutex; using `sync.Once` is cleaner.

### Iteration 4: errgroup, fail fast

```go
func sumDoubled(ctx context.Context, nums []int) (int, error) {
    g, _ := errgroup.WithContext(ctx)
    total := 0
    var mu sync.Mutex

    for _, n := range nums {
        n := n
        g.Go(func() error {
            if n < 0 {
                return fmt.Errorf("negative: %d", n)
            }
            mu.Lock()
            total += n * 2
            mu.Unlock()
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return 0, err
    }
    return total, nil
}
```

Much better. First-error wins, captured via `sync.Once` inside errgroup. Context cancellation triggers on first failure (though our goroutines don't check it — improvement coming). Returning 0 on error matches the sequential baseline.

But notice we discarded the derived `ctx` — the goroutines don't honor cancellation. In this trivial example each goroutine is so short it doesn't matter, but the habit is dangerous.

### Iteration 5: Production-grade

```go
func sumDoubled(ctx context.Context, nums []int) (int, error) {
    g, ctx := errgroup.WithContext(ctx)
    total := 0
    var mu sync.Mutex

    for _, n := range nums {
        n := n
        g.Go(func() error {
            select {
            case <-ctx.Done():
                return ctx.Err()
            default:
            }
            if n < 0 {
                return fmt.Errorf("negative: %d", n)
            }
            // Simulate work the cancellation could shortcut:
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(10 * time.Millisecond):
            }
            mu.Lock()
            total += n * 2
            mu.Unlock()
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return 0, err
    }
    return total, nil
}
```

Now:

- `g.Wait()` returns the first error.
- `errgroup.WithContext` cancels the derived `ctx` on first failure.
- Each goroutine checks `<-ctx.Done()` at meaningful points and bails out early.
- The mutex protects `total`; the writes happen-before `g.Wait` returns.
- Context cancellation from the caller propagates naturally.

This is the iterated form you want in production. Notice how short each version actually is — the patterns themselves are not long. The discipline is what's hard.

---

## Walking Backwards: Reading Existing Pipeline Code

Sometimes you join a team and inherit a pipeline. Here's a checklist to read it quickly:

1. **Find `g.Wait()`.** This is the join point. Everything between the group's creation and `Wait()` is the body.
2. **Count `g.Go` calls.** This is the stage count. If there's a `g.Go` inside a loop, that's a fan-out.
3. **For each channel, find who closes it.** There should be exactly one sender that runs `defer close(out)`.
4. **For each send, check for `select` on `ctx.Done()`.** If absent, the stage can block on cancellation.
5. **For each `db.Query`, `http.Do`, etc., check that `ctx` is passed.** Without it, the operation cannot be cancelled.
6. **Check the error path.** Are errors wrapped with `%w`? Are sentinel errors defined at package level?
7. **Identify the resources.** Open files, connections, locks. Are they `defer`-released?
8. **Look at the caller.** Does it `errors.Is` against specific failures? If yes, those must be wrapped, not swallowed.

This eight-point audit, done in two minutes, tells you whether the pipeline is "production safe" or "works on a sunny day."

---

## Worked Example 1: A Complete CSV Importer

Let us build a realistic pipeline end-to-end so every concept above is grounded in code you can compile.

The task: read a CSV of users, parse each row into a `User` struct, validate it, then insert into a database. Failure of any row fails the whole import (junior-level policy — at senior we revisit). Cancellation from the caller (timeout, Ctrl-C) stops the import cleanly.

```go
package importer

import (
    "context"
    "encoding/csv"
    "errors"
    "fmt"
    "io"
    "strconv"

    "golang.org/x/sync/errgroup"
)

type User struct {
    ID    int64
    Email string
    Age   int
}

var (
    ErrBadRow       = errors.New("bad row")
    ErrUnderage     = errors.New("underage user")
    ErrDuplicateID  = errors.New("duplicate id")
)

type DB interface {
    Insert(ctx context.Context, u User) error
}

func Import(ctx context.Context, r io.Reader, db DB) (int, error) {
    g, ctx := errgroup.WithContext(ctx)

    rawRows := make(chan []string, 16)
    users   := make(chan User,    16)

    // Stage 1: read CSV rows
    g.Go(func() error {
        defer close(rawRows)
        cr := csv.NewReader(r)
        for {
            row, err := cr.Read()
            if errors.Is(err, io.EOF) {
                return nil
            }
            if err != nil {
                return fmt.Errorf("csv read: %w", err)
            }
            select {
            case <-ctx.Done():
                return ctx.Err()
            case rawRows <- row:
            }
        }
    })

    // Stage 2: parse + validate
    g.Go(func() error {
        defer close(users)
        for row := range rawRows {
            u, err := parseRow(row)
            if err != nil {
                return fmt.Errorf("parse row %v: %w", row, err)
            }
            if err := validate(u); err != nil {
                return fmt.Errorf("validate %d: %w", u.ID, err)
            }
            select {
            case <-ctx.Done():
                return ctx.Err()
            case users <- u:
            }
        }
        return nil
    })

    // Stage 3: insert
    var inserted int
    g.Go(func() error {
        for u := range users {
            if err := db.Insert(ctx, u); err != nil {
                return fmt.Errorf("insert %d: %w", u.ID, err)
            }
            inserted++
        }
        return nil
    })

    if err := g.Wait(); err != nil {
        return inserted, err
    }
    return inserted, nil
}

func parseRow(row []string) (User, error) {
    if len(row) != 3 {
        return User{}, fmt.Errorf("%w: expected 3 columns, got %d", ErrBadRow, len(row))
    }
    id, err := strconv.ParseInt(row[0], 10, 64)
    if err != nil {
        return User{}, fmt.Errorf("%w: id: %v", ErrBadRow, err)
    }
    age, err := strconv.Atoi(row[2])
    if err != nil {
        return User{}, fmt.Errorf("%w: age: %v", ErrBadRow, err)
    }
    return User{ID: id, Email: row[1], Age: age}, nil
}

func validate(u User) error {
    if u.Age < 13 {
        return ErrUnderage
    }
    return nil
}
```

Trace through what happens for a few scenarios:

1. **Healthy import of 100 rows.** Each row flows through the three stages. When `csv.Read` returns `io.EOF`, the reader returns nil. `close(rawRows)` is deferred, so it runs. The parser sees the close, exits its `for range`, returns nil, `close(users)` runs. The inserter sees that and exits. `g.Wait()` returns nil. `Import` returns `(100, nil)`.

2. **Bad CSV row at index 42.** The parser returns `fmt.Errorf("parse row %v: %w", row, ErrBadRow)`. The errgroup captures the error and cancels the context. The reader, on its next iteration, hits `ctx.Done()` and returns. The inserter notices its input channel closing (when the parser exits) and finishes whatever rows it had queued, then exits. The whole pipeline shuts down within milliseconds. `Import` returns `(inserted_so_far, err)` and the caller can use `errors.Is(err, ErrBadRow)` to identify the cause.

3. **Caller cancels with `ctx.Cancel()`.** Every `<-ctx.Done()` fires. Every stage returns `ctx.Err()` (which is `context.Canceled`). `g.Wait` returns `context.Canceled`. The caller sees `errors.Is(err, context.Canceled)` and treats it as user-initiated, not a bug.

4. **DB insert fails.** The inserter returns the error. The group cancels. The parser, mid-`select`, exits. The reader exits. `Import` returns with the insert error. The number of rows actually inserted depends on timing, which is why returning `inserted` alongside the error is useful — the caller knows the partial state.

This example demonstrates everything covered: errgroup, wrap with `%w`, sentinel errors (`ErrBadRow`, `ErrUnderage`), `defer close`, `select` on send, partial result reporting, and context propagation to the DB.

---

## Worked Example 2: Parallel HTTP Health Checks

Different shape — fan-out where each worker is independent.

```go
package healthcheck

import (
    "context"
    "errors"
    "fmt"
    "io"
    "net/http"
    "time"

    "golang.org/x/sync/errgroup"
)

type Result struct {
    URL    string
    Status int
    OK     bool
    Err    error
}

func CheckAll(ctx context.Context, urls []string) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(urls))

    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            r, err := checkOne(ctx, u)
            results[i] = Result{URL: u, Status: r, OK: err == nil, Err: err}
            // Note: we do NOT return err here.
            // We want every URL checked, not first-error-wins.
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return results, err
    }
    return results, nil
}

func checkOne(ctx context.Context, url string) (int, error) {
    cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()

    req, err := http.NewRequestWithContext(cctx, "GET", url, nil)
    if err != nil {
        return 0, fmt.Errorf("build request: %w", err)
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return 0, fmt.Errorf("do: %w", err)
    }
    defer resp.Body.Close()
    _, _ = io.Copy(io.Discard, resp.Body)
    if resp.StatusCode >= 500 {
        return resp.StatusCode, fmt.Errorf("server error: %d", resp.StatusCode)
    }
    return resp.StatusCode, nil
}

var ErrAtLeastOneFailed = errors.New("at least one check failed")

func CheckAllStrict(ctx context.Context, urls []string) ([]Result, error) {
    results, _ := CheckAll(ctx, urls)
    for _, r := range results {
        if !r.OK {
            return results, fmt.Errorf("%w: %s", ErrAtLeastOneFailed, r.URL)
        }
    }
    return results, nil
}
```

This example shows a subtle but important variant: when *every* item must be checked even if some fail, the goroutine returns `nil` and records the result in the slice. The errgroup's first-error semantics are sidestepped on purpose — we use it purely for parallelism and structured waiting.

Then `CheckAllStrict` layers a "first failure is the overall failure" decision on top of the full results. This decoupling — running everyone, deciding afterwards — is a clean pattern when you want both behaviours from one underlying check.

---

## Worked Example 3: Cancellation on First Result

A different policy: the caller wants the first *successful* result among N. Any subsequent results are ignored. Failures from individual sources are tolerated up to a point.

```go
package firstresult

import (
    "context"
    "errors"
    "fmt"
    "sync"

    "golang.org/x/sync/errgroup"
)

var ErrAllFailed = errors.New("all sources failed")

type Source interface {
    Fetch(ctx context.Context) (string, error)
}

func FirstOf(ctx context.Context, sources []Source) (string, error) {
    g, ctx := errgroup.WithContext(ctx)
    cctx, cancel := context.WithCancel(ctx)
    defer cancel()

    var (
        winner    string
        winnerSet sync.Once
        errs      []error
        errsMu    sync.Mutex
    )

    for _, s := range sources {
        s := s
        g.Go(func() error {
            v, err := s.Fetch(cctx)
            if err != nil {
                errsMu.Lock()
                errs = append(errs, err)
                errsMu.Unlock()
                return nil
            }
            winnerSet.Do(func() {
                winner = v
                cancel() // tell others to stop
            })
            return nil
        })
    }
    _ = g.Wait()
    if winner == "" {
        // No source succeeded.
        return "", fmt.Errorf("%w: %d errors", ErrAllFailed, len(errs))
    }
    return winner, nil
}
```

Notice this example uses `errgroup` *not* for its first-error semantics but purely for structured parallelism. The decision of "what is an error vs a success" is encoded in the goroutine body itself. This is a legitimate pattern; `errgroup` is flexible.

At the middle level we cover this with `errors.Join` so we can return all the individual failures instead of just a count.

---

## A Closer Look at Wrapping

`%w` is more nuanced than it looks. Some edge cases:

**Multiple `%w` in one format string.** Since Go 1.20, this is legal and creates a multi-wrapped error:

```go
err := fmt.Errorf("step %d: %w and %w", n, err1, err2)
```

`errors.Is(err, err1)` and `errors.Is(err, err2)` both return true. Behind the scenes the wrapper implements `Unwrap() []error`. We will use this at the senior level when aggregating; for now, prefer single `%w` per `Errorf`.

**`%w` with nil.** `fmt.Errorf("foo: %w", nil)` produces an error that prints as `"foo: %!w(<nil>)"` and `errors.Unwrap` returns `nil`. Always guard with `if err != nil`.

**`%w` vs `%v`.**

```go
fmt.Errorf("...: %v", err) // string formatting, no chain
fmt.Errorf("...: %w", err) // wrap, preserves chain
```

`%v` is sometimes *intentional* — when the underlying error is implementation detail you do not want callers to depend on. But the default at junior level should be `%w`.

**Wrapping a wrapped error.** Each layer is its own struct. `errors.Is` walks the chain calling `Unwrap` until it finds a match or nil. The depth is essentially unlimited.

**Custom error types.** A user-defined error type can implement `Unwrap()` to participate in the chain:

```go
type PipelineError struct {
    Stage string
    Inner error
}

func (e *PipelineError) Error() string { return e.Stage + ": " + e.Inner.Error() }
func (e *PipelineError) Unwrap() error { return e.Inner }
```

Now `errors.As(err, &pe)` can extract `*PipelineError` from any depth. Useful when callers want to know *which* stage failed without parsing strings.

---

## Lifecycle: When Does Each Goroutine Exit?

Tracing the exact lifetime of every stage is a junior-level exercise that pays off enormously. Take the three-stage example and answer:

For the **reader** (producer):

- Exits normally when input exhausted, `defer close(rawRows)` runs.
- Exits early when `<-ctx.Done()` fires (sibling failed), returns `ctx.Err()`, `defer close(rawRows)` runs.
- Cannot block forever because every send is `select`-ed with `ctx.Done()`.

For the **parser** (middle):

- Exits normally when `rawRows` is closed and drained, `defer close(users)` runs.
- Exits early when its own validation fails, returns the error, `defer close(users)` runs.
- Exits early when `<-ctx.Done()` fires on a send, returns `ctx.Err()`, `defer close(users)` runs.
- Cannot block forever: receives from `rawRows` (closed eventually), sends to `users` (selected with ctx).

For the **inserter** (consumer):

- Exits normally when `users` is closed and drained.
- Exits early when an insert fails.
- Exits early when `<-ctx.Done()` fires *inside* `db.Insert` (which is `ctx`-aware) — manifests as the insert returning `context.Canceled`.

The pattern: every stage has at most three exit paths — normal, ctx-cancelled, internal error — and every path runs `defer close(out)` so the next stage downstream can terminate. This is the discipline of structured concurrency. Once internalised, you stop having mysterious "the program hangs on shutdown" bugs.

---

## Anatomy of an errgroup.Group

To make `errgroup` less magical, here is a simplified implementation:

```go
package mini_errgroup

import (
    "context"
    "sync"
)

type Group struct {
    cancel func()
    wg     sync.WaitGroup
    errOnce sync.Once
    err    error
}

func WithContext(parent context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancel(parent)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Go(f func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel()
                }
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel()
    }
    return g.err
}
```

The real implementation has additional features: `SetLimit` (parallelism cap) and `TryGo` (non-blocking spawn) added in 2022. But the core is what you see above. About thirty lines. Worth re-reading to demystify it.

---

## The "Just One Error Channel" Anti-Pattern

A common junior implementation looks like this:

```go
errCh := make(chan error)
go func() { errCh <- stage1() }()
go func() { errCh <- stage2() }()
go func() { errCh <- stage3() }()

var firstErr error
for i := 0; i < 3; i++ {
    if err := <-errCh; err != nil && firstErr == nil {
        firstErr = err
    }
}
return firstErr
```

Several flaws:

1. **No cancellation.** Stages keep running after the first error.
2. **No buffering.** Unbuffered channel — if the caller stops reading early, sends block forever.
3. **Goroutine count must match read count.** If you spawn 3 and read 3, fine; off-by-one and you leak or deadlock.
4. **No type for "I am the coordinator."** The whole loop is ad hoc.

`errgroup` exists precisely because everyone reinvented this and got it wrong. Use the library.

---

## When errgroup Is Not Enough

Sometimes you want behaviour `errgroup` does not give you:

- **All errors aggregated** — covered at senior level with `errors.Join`.
- **Different policies per stage** — e.g. "one warning is OK, two is fatal." Build on top of `errgroup` with custom logic.
- **Cancellable individual stages** — covered at middle level with nested contexts.
- **Per-item retries within a stage** — orthogonal; the retry is inside `g.Go`'s function.
- **Backpressure with multiple producers** — needs a fan-in stage.
- **Panic recovery** — covered at senior level.

The mental model is: `errgroup` is the right starting point. When the requirements outgrow it, layer additional structure on top, don't replace it.

---

## Comparing errgroup to Alternatives

| Tool | What it does | Use when |
|------|--------------|----------|
| `sync.WaitGroup` | Wait for N goroutines | You don't need error capture or cancellation |
| `errgroup.Group` | WaitGroup + first error + ctx cancel | Default for error-aware pipelines |
| `golang.org/x/sync/semaphore` | Bound parallelism | Cap concurrent workers without an errgroup |
| `golang.org/x/sync/singleflight` | Deduplicate concurrent calls | Coalesce identical work |
| Manual channels | Anything | When you have a very specific topology that no library fits |

The right answer 90% of the time is `errgroup`. Reach for alternatives only when you can articulate *what* errgroup is missing.

---

## A Comprehensive Step-By-Step Walkthrough

Let us walk through *every* line of a four-stage pipeline once, slowly. The task: read URLs, fetch bodies, parse JSON, write records to a database.

```go
package pipeline

import (
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"

    "golang.org/x/sync/errgroup"
)

type Record struct {
    ID   string `json:"id"`
    Name string `json:"name"`
}

type Storer interface {
    Store(ctx context.Context, r Record) error
}

func Run(ctx context.Context, urls []string, store Storer) error {
    g, ctx := errgroup.WithContext(ctx)

    urlsCh := make(chan string, 4)
    bodies := make(chan []byte, 4)
    records := make(chan Record, 4)

    g.Go(func() error {
        defer close(urlsCh)
        for _, u := range urls {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case urlsCh <- u:
            }
        }
        return nil
    })

    g.Go(func() error {
        defer close(bodies)
        for u := range urlsCh {
            b, err := fetch(ctx, u)
            if err != nil {
                return fmt.Errorf("fetch %s: %w", u, err)
            }
            select {
            case <-ctx.Done():
                return ctx.Err()
            case bodies <- b:
            }
        }
        return nil
    })

    g.Go(func() error {
        defer close(records)
        for b := range bodies {
            var r Record
            if err := json.Unmarshal(b, &r); err != nil {
                return fmt.Errorf("parse: %w", err)
            }
            select {
            case <-ctx.Done():
                return ctx.Err()
            case records <- r:
            }
        }
        return nil
    })

    g.Go(func() error {
        for r := range records {
            if err := store.Store(ctx, r); err != nil {
                return fmt.Errorf("store %s: %w", r.ID, err)
            }
        }
        return nil
    })

    return g.Wait()
}

func fetch(ctx context.Context, url string) ([]byte, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, fmt.Errorf("build: %w", err)
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("do: %w", err)
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

Walkthrough:

1. `g, ctx := errgroup.WithContext(ctx)` shadows `ctx` with a derived context that the group will cancel on first error. Every stage uses this `ctx`.
2. Three buffered channels (capacity 4) provide elasticity between stages, allowing brief stalls without immediate blocking.
3. Stage 1 (urls): pushes URLs into `urlsCh`. The `select` with `ctx.Done()` is critical: if the parse stage fails downstream, the URLs producer must not block.
4. Stage 2 (fetch): for each URL, does an HTTP GET using the group context. If `fetch` returns an error, the stage returns wrapped error, errgroup cancels, every other stage observes cancellation.
5. Stage 3 (parse): JSON unmarshal each body. Parse errors are wrapped.
6. Stage 4 (store): consumes records. The only sink. Returns nil normally, or a wrapped error.
7. `g.Wait()` waits for all four to exit. The first non-nil error is returned.

What happens if the third URL has a malformed JSON body?

- Stage 3 returns `fmt.Errorf("parse: %w", &json.SyntaxError{...})`.
- errgroup captures this as the first error and calls `cancel()` on the group's context.
- Stage 2 (fetch), mid-`http.Do` on some URL, observes ctx cancel, the HTTP request aborts, `Do` returns `context.Canceled`. Stage 2 wraps and returns it. errgroup ignores this (already has its first error).
- Stage 1 (urls producer), mid-`select`, hits `<-ctx.Done()`, returns `ctx.Err()`. errgroup ignores.
- Stage 4 (store), in its `for range records`, sees the channel close (because stage 3 deferred `close(records)`), exits its loop, returns nil. errgroup ignores.
- `g.Wait()` returns the parse error.
- The caller sees `"parse: invalid character ..."` and `errors.As(err, new(*json.SyntaxError))` works.

This is what "first error wins, siblings cancelled, all goroutines exit cleanly" looks like in practice.

---

## Pipeline Topologies and Error Coordination

Pipelines come in a few common shapes; each has its own error story.

**Linear (chain).** Most examples above. One sender per channel. Closes cascade naturally. Standard.

**Fan-out (one to many).** A single producer feeds N workers. The workers each consume independently and write to a shared sink. Closing the sink is tricky — only the *last* worker should do it. Pattern: use a `WaitGroup` (or another errgroup) inside the fan-out stage to know when all workers finished, then close the sink from that coordinator.

**Fan-in (many to one).** N producers feed a single consumer. Each producer owns its output channel; a coordinator reads from all of them. Use `select` with N cases, or copy values into a shared channel with one worker per producer.

**Diamond.** Producer -> two parallel branches -> single consumer. Each branch is its own pipeline, joined at the end.

At junior level the linear chain is enough. We cover fan-out and fan-in in `03-fan-out-within-pipeline` and `05-fan-in-fan-out-within`.

---

## Step-by-Step Debugging When Your Pipeline Hangs

The single most common bug at junior level is "the program never exits." Here is a diagnostic procedure.

### Step 1: Add a deadline

Run the program with a context that times out after a reasonable bound:

```go
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
err := pipeline.Run(ctx, ...)
```

If the timeout fires and `err` is `context.DeadlineExceeded`, you know something is blocked. If it never fires, the *outer* code is wrong; revisit.

### Step 2: Dump goroutines on stuck

Add a SIGQUIT handler (or use `runtime.Stack` manually) to print all goroutines:

```go
go func() {
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGQUIT)
    <-sig
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    fmt.Fprintln(os.Stderr, string(buf[:n]))
    os.Exit(1)
}()
```

Send `kill -QUIT $PID` and read the dump. Goroutines blocked on `chan send` or `chan receive` will be obvious — they are your leaks.

### Step 3: Look for unclosed channels

If a goroutine is blocked on `chan receive` and no producer is alive, find who *should* have called `close`. The fix is usually `defer close(out)` in the right place.

### Step 4: Look for unselected sends

A goroutine blocked on `chan send` to a channel nobody is reading is waiting for a `select { case <-ctx.Done() ... }` branch that doesn't exist. Add one.

### Step 5: Check `g.Wait` was actually called

Running `g.Go` without `g.Wait` leaks goroutines deliberately. The function returns; the goroutines run forever in the background.

### Step 6: Check for accidental nested groups

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error {
    g, _ := errgroup.WithContext(ctx) // <-- shadows outer g
    g.Go(...)
    return g.Wait()
})
return g.Wait()
```

The inner shadowed `g` is its own group, which is fine, but easy to get wrong. Use different variable names for inner groups (`inner, ctx := errgroup.WithContext(ctx)`).

---

## Six Bugs You Will Write And Their Fixes

These are the bugs every junior writes at least once. Memorise them.

### Bug A: Forgot to close

```go
g.Go(func() error {
    for _, v := range items { out <- v }
    return nil
})
```

Fix: `defer close(out)` at the top.

### Bug B: Forgot to select on send

```go
g.Go(func() error {
    defer close(out)
    for _, v := range items { out <- v } // can block forever
    return nil
})
```

Fix: wrap the send in `select { case <-ctx.Done(): return ctx.Err(); case out <- v: }`.

### Bug C: Returning the wrong error

```go
g.Go(func() error {
    err := doStuff()
    if err != nil { return errors.New("failed") } // loses the cause
    return nil
})
```

Fix: `return fmt.Errorf("doStuff: %w", err)`.

### Bug D: Calling `Wait` before all `Go`

```go
go func() { g.Wait(); ... }() // started before all Go's queued
g.Go(stage1)
g.Go(stage2)
```

`Wait` may return after seeing zero goroutines. Always finish queuing before calling `Wait`.

### Bug E: Sharing a result variable without a sync mechanism

```go
var result string
g.Go(func() error { result = compute(); return nil })
g.Go(func() error { result += compute2(); return nil })
return g.Wait()
```

Two goroutines write to `result` concurrently → race. Either lock around the writes or have each goroutine write to its own slot (e.g. a slice element) and aggregate after `Wait`.

### Bug F: Treating `ctx.Err()` as a "real" failure

```go
err := g.Wait()
if err != nil {
    metrics.RecordFailure() // increments even on context.Canceled
    return err
}
```

When parent cancellation triggers shutdown, every stage may return `ctx.Err()`. Avoid recording these as failures:

```go
err := g.Wait()
if err != nil && !errors.Is(err, context.Canceled) {
    metrics.RecordFailure()
}
return err
```

---

## Practising With Toy Programs

The exercises in `tasks.md` are the formal practice. Beyond those, here are three small toy programs to write from memory:

1. **`countLines`**: given a list of file paths, count lines in each in parallel, return total and first error. Each stage uses `errgroup` with one goroutine per file.
2. **`mirrorFiles`**: given pairs of (src, dst), copy each file in parallel, abort on first error. Use `errgroup`, wrap each path in the error.
3. **`portScan`**: given a host and a list of ports, dial each in parallel with a 1-second timeout, return the set of open ports. First *successful* port wins (different policy — use the "first result" pattern from Worked Example 3).

Each of these is twenty to fifty lines. Writing them from scratch (no copy-pasting) is the single best way to make the patterns automatic.

---

## A Tabletop Walkthrough of First-Error Capture

Imagine three goroutines all returning an error at almost the same time:

- `g.Go(s1)` returns `err1` at time t=10.
- `g.Go(s2)` returns `err2` at time t=10 (same microsecond).
- `g.Go(s3)` returns `err3` at time t=11.

Inside `errgroup.Go`, when a goroutine returns a non-nil error it calls:

```go
g.errOnce.Do(func() {
    g.err = err
    g.cancel()
})
```

`sync.Once.Do` ensures the body runs at most once. The first goroutine to reach `Do` wins; the others' calls are no-ops. So if s1 wins the race, `g.err == err1` and `s2, s3` errors are dropped.

The kernel of `sync.Once.Do` is a `sync/atomic.Uint32` check plus a mutex; it is fast even under contention.

After `errOnce.Do` returns, the goroutine still calls `wg.Done()`. `g.Wait()` waits for *all* `wg.Done`s, so even though s1's error is already captured at t=10, `Wait` blocks until s3 finishes at t=11. The error returned by `Wait` is `err1`.

This is the rationale behind "cooperative cancellation": even after capturing the first error, we still wait for everyone to land. If anyone takes hours to land because they don't respect cancellation, your shutdown takes hours. The fix is *not* on the errgroup side — it's writing stages that actually honour `<-ctx.Done()`.

---

## Glossary of Failure Modes

Knowing the vocabulary helps you talk about pipelines:

- **Hang**: a goroutine blocked forever on a channel operation or lock.
- **Leak**: a goroutine that should have exited but didn't.
- **Deadlock**: two or more goroutines each waiting for the other.
- **Livelock**: goroutines actively running but making no progress (rare in Go).
- **Spurious wakeup**: a goroutine unblocking from a channel read with a stale value. Not normally possible in Go — channels do not have spurious wakeups, unlike some POSIX condition variables.
- **Race**: two goroutines accessing the same memory without synchronisation, at least one writing.
- **Cancellation race**: a stage reading `<-ctx.Done()` *and* its data channel concurrently; either may fire first. Usually benign if both branches exit cleanly.
- **Double close**: calling `close` twice on a channel. Panics. Symptom: program crashes with `close of closed channel`. Fix: only one goroutine ever calls `close`.
- **Send on closed channel**: panics. Symptom: `send on closed channel`. Fix: never close a channel before all senders are guaranteed done.
- **Nil channel send/receive**: blocks forever. Sometimes used intentionally to "turn off" a `select` case.

These terms recur in every concurrent Go review. Use them precisely.

---

## Quick Reference: The Twenty-Line Skeleton

Memorise this skeleton. Variants of it cover 90% of error-aware pipelines.

```go
func Pipeline(ctx context.Context, in []Input) ([]Output, error) {
    g, ctx := errgroup.WithContext(ctx)
    stage1Out := make(chan A, capacity)
    stage2Out := make(chan B, capacity)

    g.Go(func() error {
        defer close(stage1Out)
        for _, v := range in {
            select {
            case <-ctx.Done(): return ctx.Err()
            case stage1Out <- transform(v):
            }
        }
        return nil
    })

    g.Go(func() error {
        defer close(stage2Out)
        for a := range stage1Out {
            b, err := step(ctx, a)
            if err != nil { return fmt.Errorf("step: %w", err) }
            select {
            case <-ctx.Done(): return ctx.Err()
            case stage2Out <- b:
            }
        }
        return nil
    })

    var out []Output
    g.Go(func() error {
        for b := range stage2Out {
            out = append(out, finalize(b))
        }
        return nil
    })

    if err := g.Wait(); err != nil { return nil, err }
    return out, nil
}
```

Every error-aware pipeline I have written at scale started life as this twenty-line skeleton, then specialised.

---

## Deep Dive: Understanding errors.Is and errors.As

These two functions are the workhorses of typed error handling. They differ in important ways.

### `errors.Is(err, target) bool`

Walks the wrap chain looking for an error equal (by `==`) to `target`. Used with **sentinel errors** — package-level variables of type `error` created with `errors.New`.

```go
var ErrNotFound = errors.New("not found")

func lookup(id int) error {
    return fmt.Errorf("lookup %d: %w", id, ErrNotFound)
}

err := lookup(42)
if errors.Is(err, ErrNotFound) {
    // matched, even through one level of wrapping
}
```

`errors.Is` also honours an `Is(target error) bool` method on custom error types, allowing semantic equality. The standard library uses this for `context.DeadlineExceeded` and friends.

### `errors.As(err, &target) bool`

Walks the wrap chain looking for an error *assignable* to the type pointed at by `target`. Used with **error types** — structs that carry data:

```go
type NotFoundError struct {
    Resource string
    ID       int
}
func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %d not found", e.Resource, e.ID)
}

func lookup(id int) error {
    return fmt.Errorf("db: %w", &NotFoundError{Resource: "user", ID: id})
}

var nfe *NotFoundError
if errors.As(err, &nfe) {
    fmt.Println(nfe.Resource, nfe.ID)
}
```

The second argument must be a *pointer to a variable of the desired type*. Forgetting the ampersand is a common mistake. The function panics if the target is not a pointer to an error-implementing type.

### When to use which

- **Sentinels (`errors.Is`)**: for known, atomic failure conditions like "not found," "EOF," "already exists." When you do not need data, just a name.
- **Types (`errors.As`)**: when you need information about the failure — the resource ID, the underlying status code, the validation field name.

You can mix them. A custom type can have an `Is` method that matches a sentinel:

```go
func (e *NotFoundError) Is(target error) bool { return target == ErrNotFound }
```

Now `errors.Is(err, ErrNotFound)` matches *any* `*NotFoundError`, regardless of which resource — useful for broad error handling that doesn't care about the specifics.

---

## Anti-Pattern Catalogue

These are patterns you will see in code and should refactor away.

### Anti-pattern 1: The "error log and continue"

```go
g.Go(func() error {
    err := work()
    if err != nil {
        log.Println("work failed:", err)
        return nil // <-- swallow!
    }
    return nil
})
```

The pipeline reports success but the work did not actually complete. The caller has no chance to react. Either return the error or document that this stage explicitly tolerates errors (and explain why).

### Anti-pattern 2: The "magic boolean"

```go
g.Go(func() error {
    if criticalErrorHappened {
        someGlobalErrorFlag = true
        return nil
    }
    return nil
})
```

The error has been turned into a boolean that the caller may or may not check. Return errors, don't set flags.

### Anti-pattern 3: The "fmt.Errorf with %s"

```go
return fmt.Errorf("step1: %s", err)
```

This formats `err` as a string and discards the wrap chain. Use `%w` instead — `fmt.Errorf("step1: %w", err)`.

### Anti-pattern 4: The "panic on error"

```go
g.Go(func() error {
    err := work()
    if err != nil { panic(err) }
    return nil
})
```

A panic in a `g.Go` goroutine crashes the entire program. The pipeline's structured error handling is bypassed. Always return errors; reserve panics for "programmer error" (nil pointer, impossible state).

### Anti-pattern 5: The "global cancel"

```go
var globalCancel context.CancelFunc

func runStage() {
    g, ctx := errgroup.WithContext(context.Background())
    _, globalCancel = context.WithCancel(ctx)
    ...
}

func somewhereElse() {
    globalCancel() // any time, any goroutine
}
```

Cancellation is now an action-at-a-distance side effect. Pass `context.Context` through function signatures; don't smuggle cancel functions in package-level variables.

### Anti-pattern 6: "I'll handle it at the top"

```go
g.Go(func() error {
    work() // ignores err
    return nil
})
g.Go(func() error {
    work2() // ignores err
    return nil
})
```

If your stages never return errors, the pipeline cannot fail. That is almost certainly wrong. Each stage should return its own error or explicitly comment why it cannot.

---

## Glossary, Continued

A few more terms specific to this topic:

- **Error chain**: the linked list of errors accessible via repeated `Unwrap`.
- **Root cause**: the deepest error in the chain.
- **Surface error**: the outermost wrapper, the one returned to the caller.
- **Sentinel**: a package-level `error` value used as a marker.
- **Typed error**: a struct implementing `Error() string` and carrying data.
- **Opaque error**: an error returned from another package whose type you do not know — only `Error()` is reliable.
- **Multi-error**: an error that wraps multiple errors (Go 1.20+, via `errors.Join`).
- **Cancellation error**: `context.Canceled` or `context.DeadlineExceeded`, returned by `ctx.Err()`.
- **Structured concurrency**: the principle that every spawned goroutine has a defined parent and a defined exit point. `errgroup` is one implementation.

---

## A Note on Style

When wrapping, the Go community prefers consistency:

```go
fmt.Errorf("verb-phrase %s: %w", target, err)
```

- Lowercase verb.
- A space after the colon.
- The `%w` at the end.
- No trailing period.
- Single tense.

Examples:

- `fmt.Errorf("open %s: %w", path, err)`
- `fmt.Errorf("decode response: %w", err)`
- `fmt.Errorf("validate %s: %w", field, err)`

Avoid:

- `fmt.Errorf("Opening %s failed: %w", path, err)` — capital + verbose
- `fmt.Errorf("opened: %w.", err)` — trailing period
- `fmt.Errorf("ERROR opening: %w", err)` — repetitive

The chain accumulates, so each layer should add *new* information, not repeat what the inner layer already says.

---

## Practical Exercises Worked

### Exercise: Compose two pipelines

Sometimes a pipeline's *output* feeds another pipeline's *input*. The natural way:

```go
func twoPhase(ctx context.Context, in []Source) ([]Final, error) {
    g, ctx := errgroup.WithContext(ctx)

    intermediate := make(chan Mid, 16)

    g.Go(func() error {
        defer close(intermediate)
        return phase1(ctx, in, intermediate)
    })

    var finals []Final
    g.Go(func() error {
        for m := range intermediate {
            f, err := phase2(ctx, m)
            if err != nil { return fmt.Errorf("phase2: %w", err) }
            finals = append(finals, f)
        }
        return nil
    })

    if err := g.Wait(); err != nil { return nil, err }
    return finals, nil
}
```

The interaction between phases is "phase1 writes to intermediate, phase2 reads from it." Both are governed by the same group. A failure in either phase cancels the other.

### Exercise: Pipeline with a sentinel-skipping stage

Suppose your validation stage knows that some "errors" (like `ErrSkip`) just mean "skip this row, don't fail the pipeline":

```go
var ErrSkip = errors.New("skip")

g.Go(func() error {
    defer close(out)
    for v := range in {
        result, err := validate(v)
        if errors.Is(err, ErrSkip) {
            continue // explicit no-op
        }
        if err != nil {
            return fmt.Errorf("validate: %w", err)
        }
        select {
        case <-ctx.Done(): return ctx.Err()
        case out <- result:
        }
    }
    return nil
})
```

This is the controlled use of sentinels: they encode known, expected control flow without escalating to pipeline failure. Document them at the package level so consumers know.

### Exercise: Detecting which stage failed

Even with wrapping, sometimes you want a programmatic check for "which stage." Use a typed error:

```go
type StageError struct {
    Stage string
    Err   error
}
func (e *StageError) Error() string { return e.Stage + ": " + e.Err.Error() }
func (e *StageError) Unwrap() error { return e.Err }
```

Each stage wraps in `&StageError{Stage: "parse", Err: err}`. The caller does:

```go
var se *StageError
if errors.As(err, &se) {
    metrics.RecordStageFailure(se.Stage)
}
```

This is the typed-error pattern composed with the wrap-and-chain pattern. Both can coexist.

---

## Wrapping Up Junior Level

After working through this document, you should be able to look at a Go pipeline and:

- Spot whether it uses errgroup and whether `WithContext` is used.
- Identify each channel's sender and verify there is a `defer close(out)`.
- Spot send/receive operations missing a `ctx.Done()` guard.
- Recognise `%w` versus `%v` and understand when each is correct.
- Read a wrapped error chain and identify the root cause.
- Predict how the pipeline behaves on cancellation, on a single stage failure, and on a sibling-cancellation race.
- Write a three-stage pipeline from a blank file in five minutes.

What's still ahead at the middle level:

- Sentinel errors as a deliberate design choice.
- `SetLimit` for capping fan-out.
- Draining patterns for early-exit consumers.
- Per-item retry inside a stage.
- The subtle interaction between `errgroup` and parent context cancellation.

And at the senior level:

- Aggregating all errors with `errors.Join`.
- Rolling back successful upstream stages on downstream failure (compensating actions).
- Panic recovery inside stages.
- Memory model details and lock-free coordination.

Stop here, work through `tasks.md` and `find-bug.md`, and only proceed when the patterns feel automatic. Concurrency is one of those topics where conceptual knowledge without finger-memory is fragile under deadline pressure.

---

## Idiomatic Error Messages

A well-formed error chain reads like a sentence. Each stage adds context like a co-author. Compare these two error strings:

Bad:

```
error
```

Slightly better:

```
parse error
```

Idiomatic:

```
process file /var/data/x.csv: parse row 42: bad row: id: strconv.ParseInt: parsing "abc": invalid syntax
```

Each colon-separated chunk is one wrap. The deepest cause is at the end. Tools like `errors.Is` and `errors.As` can pick it apart programmatically; humans can read it linearly. Aim for this shape.

Rules:

- Lowercase, no trailing punctuation.
- Colon-space between layers: `: `.
- The deepest layer (innermost error) is on the right.
- Identifier or input value goes after the verb: `parse row 42`, not `parse row: 42`.
- Don't repeat words: not `parse error: parse failed`, just `parse: invalid syntax`.

---

## Twenty Frequently Asked Questions

**Q1. Why do I need `errgroup` if I already have `sync.WaitGroup`?**

`WaitGroup` does not capture errors. You can layer your own error variable on top with a mutex, but you also need cancellation when one fails. `errgroup` bundles wait + error + cancel in a single primitive.

**Q2. Does `errgroup.WithContext` require Go 1.20+?**

No. The package has been stable since 2016. The only Go-version-dependent feature is `g.SetLimit`, added around Go 1.18 era in `golang.org/x/sync`.

**Q3. Can I reuse an `errgroup.Group` after `Wait`?**

Don't. Groups are single-use. Create a new one for each batch.

**Q4. Why does `g.Wait` return the *first* error and not the *last*?**

Because in production you usually want the *root cause*. The first failure is usually the cause; subsequent failures are often consequences (cancellation, broken pipes). Aggregation is a separate concern (senior level).

**Q5. What if my stage returns an `error` that wraps another `error` that wraps yet another?**

Wrap depth is unlimited. `errors.Is` and `errors.As` walk the chain. Performance is O(depth) which in practice is two or three.

**Q6. Is `errgroup.Group{}` (zero value) safe to use?**

Yes — but you don't get context cancellation. Prefer `errgroup.WithContext`.

**Q7. Should I close the result channel?**

The sender (the goroutine that writes to it) closes. Always. `defer close(out)` is the canonical placement.

**Q8. Can I have two senders to the same channel?**

You can, but then *neither* can safely close it. You need a coordinator that closes it once both senders have signalled completion. Easiest to refactor to one sender via a fan-in stage.

**Q9. What happens if my stage panics?**

The panic propagates out of `g.Go`'s goroutine and crashes the whole program. To convert to error, wrap the body in `defer func() { if r := recover(); r != nil { err = fmt.Errorf("panic: %v", r) } }()`. We cover this in detail at senior level.

**Q10. Why is `context.Canceled` returned by `g.Wait` even when nothing "failed" from my point of view?**

If the parent context was cancelled (user pressed Ctrl-C, timeout fired, etc.), every stage gets `ctx.Err() == context.Canceled` and returns it. `g.Wait` returns this. The caller should distinguish parent-cancellation from internal failure:

```go
err := g.Wait()
if errors.Is(err, context.Canceled) {
    return nil // user-initiated
}
```

**Q11. Can I cancel just one stage without cancelling siblings?**

Not via `errgroup`. The group's context is shared. For per-stage cancellation, derive a child context inside the stage.

**Q12. Do I need to drain a channel after returning?**

If you closed it: yes, after returning. The downstream `for range` will drain naturally and exit. If you did not close it (because you returned early without reaching the close), the downstream may block. This is why `defer close(out)` is so important — it runs on every exit path.

**Q13. How big should the buffer on my channels be?**

For correctness, zero (unbuffered) works. For throughput, you want a small buffer (1-16) that absorbs jitter between stages. Past that, more buffer is rarely better and can hide backpressure problems.

**Q14. Why is my pipeline slow even though it's "parallel"?**

Common causes: stages of wildly different speeds, the slowest one is the bottleneck (Amdahl's law); contention on shared state (mutex, atomic counters); too few buffer slots forcing lockstep behavior; or no actual parallelism because all stages do the same thing on the same CPU. Profile before optimising.

**Q15. What if I want to bound the parallelism of a fan-out?**

Use `g.SetLimit(n)` on the group. This makes `g.Go` block (or `g.TryGo` return false) when n goroutines are already running.

**Q16. Should I use `errgroup` for non-concurrent code that "happens" to use multiple steps?**

No. If your code is sequential, just `return err` from each step. errgroup is for actual goroutines running in parallel.

**Q17. Can `errgroup` deadlock?**

Yes — if any spawned goroutine never returns and never honors cancellation. The most common cause is a missing `<-ctx.Done()` branch in a `select`. The fix is on the goroutine's side.

**Q18. Do I need to pass the derived ctx to `db.Query`, `http.Do`, etc.?**

Yes. Otherwise those operations cannot be cancelled when a sibling fails. Always.

**Q19. What about goroutines I spawn *inside* a `g.Go` function?**

They are not tracked by the outer group. If you spawn them, you must manage them. Pattern: spawn a nested `errgroup` inside.

**Q20. Is there a "structured concurrency" library beyond errgroup?**

For Go, errgroup is the de facto standard. Some experimental libraries (e.g. `sourcegraph/conc`) add more primitives like pools and streams. For pipelines as described here, errgroup plus channels is enough.

---

## Long-Form Example: A Production-Grade Webhook Fan-Out

Putting everything together. A service receives an event and must deliver it to N subscriber URLs via HTTP POST. The delivery must:

- Run in parallel for throughput.
- Time out per subscriber.
- Cancel all remaining subscribers if the parent context is cancelled.
- Report the first failure to the caller.
- Wrap errors with the subscriber URL so the caller can see which one failed.
- Honor a per-subscriber retry budget (kept simple: one retry).

```go
package webhook

import (
    "bytes"
    "context"
    "errors"
    "fmt"
    "io"
    "net/http"
    "time"

    "golang.org/x/sync/errgroup"
)

var ErrSubscriberFailed = errors.New("subscriber failed")

type Event struct{ Payload []byte }

type Subscriber struct {
    URL     string
    Timeout time.Duration
}

func Deliver(ctx context.Context, ev Event, subs []Subscriber) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(32) // cap concurrency

    for _, s := range subs {
        s := s
        g.Go(func() error {
            if err := deliverOne(ctx, ev, s, 2); err != nil {
                return fmt.Errorf("%w: %s: %w", ErrSubscriberFailed, s.URL, err)
            }
            return nil
        })
    }
    return g.Wait()
}

func deliverOne(ctx context.Context, ev Event, s Subscriber, attempts int) error {
    var lastErr error
    for i := 0; i < attempts; i++ {
        cctx, cancel := context.WithTimeout(ctx, s.Timeout)
        err := postOnce(cctx, ev, s.URL)
        cancel()
        if err == nil {
            return nil
        }
        if errors.Is(err, context.Canceled) {
            return err // parent cancellation, abort retries
        }
        lastErr = err
        // simple backoff
        select {
        case <-ctx.Done(): return ctx.Err()
        case <-time.After(time.Duration(i+1) * 100 * time.Millisecond):
        }
    }
    return fmt.Errorf("after %d attempts: %w", attempts, lastErr)
}

func postOnce(ctx context.Context, ev Event, url string) error {
    req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(ev.Payload))
    if err != nil {
        return fmt.Errorf("build request: %w", err)
    }
    req.Header.Set("Content-Type", "application/json")
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return fmt.Errorf("do: %w", err)
    }
    defer resp.Body.Close()
    _, _ = io.Copy(io.Discard, resp.Body)
    if resp.StatusCode >= 500 {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    return nil
}
```

Notice several patterns at once:

- `errgroup.WithContext` for first-error coordination.
- `g.SetLimit(32)` to cap parallelism even with thousands of subscribers.
- A multi-`%w` error using Go 1.20+ syntax: `fmt.Errorf("%w: %s: %w", ErrSubscriberFailed, s.URL, err)`. The caller can `errors.Is(err, ErrSubscriberFailed)` to identify the category, and also walk to the deeper cause.
- Per-subscriber timeout via nested context.
- Retry with backoff inside the goroutine, but stopping cleanly on parent cancellation.

This is what "production-grade" looks like for a relatively simple fan-out. Every error path is intentional. Every blocking operation is cancellable.

---

## Summary

A pipeline error is a regular Go error that has to travel across goroutine boundaries. The cheap, idiomatic way to do this is `golang.org/x/sync/errgroup`: it gives you a `WaitGroup`, a first-error capture via `sync.Once`, and an auto-cancelled `Context` in a five-line API. Combined with `fmt.Errorf("...: %w", err)` for wrapping and `errors.Is`/`errors.As` for identification, you get pipelines that fail fast, clean up cleanly, and surface meaningful errors to callers.

The four habits that prevent every common bug:

1. `defer close(out)` in every sender.
2. `select` on `ctx.Done()` for every blocking operation.
3. Wrap with `%w` at every cross-stage boundary.
4. Read shared state only after `g.Wait()` returns.

At the middle level we expand to sentinel errors, fan-out, draining, and goroutine-lifetime management. At the senior level we cover aggregation, rollback, compensating actions, and panic recovery. At the professional level, distributed systems concerns — observability, idempotency, and the cost models of structured concurrency.

---

## What You Can Build

After this file you can build:

- A parallel URL fetcher that fails on first error and surfaces the failed URL.
- A two-stage CSV importer (read → insert) with cancellation.
- A worker that processes a queue and stops on first poison message.
- A `make`-like build runner that compiles N files in parallel and shows the first failure.
- A scraper that crawls N pages and returns either all bodies or the first error.

---

## Further Reading

- The Go Blog: *Pipelines and cancellation* — `https://go.dev/blog/pipelines`
- `pkg.go.dev/golang.org/x/sync/errgroup` — official docs.
- The Go Blog: *Working with Errors in Go 1.13* — `https://go.dev/blog/go1.13-errors` (covers `%w`, `errors.Is`, `errors.As`).
- *Concurrency in Go* by Katherine Cox-Buday, chapter 4: "Concurrency Patterns in Go."
- Russ Cox: *Error Values and Wrapping in Go 1.13* (golang.org design doc).

---

## Related Topics

- `02-channels/05-context-cancellation` — `context.Context` mechanics.
- `04-sync-primitives/03-once` — `sync.Once` (the primitive `errgroup` uses internally).
- `03-select/04-cancellation-pattern` — how `select` and context fit together.
- `19-pipeline-production-patterns/02-cancellation-propagation` — next door, deeper on cancellation.
- `19-pipeline-production-patterns/03-fan-out-within-pipeline` — error coordination for many parallel workers per stage.
- `15-concurrency-anti-patterns` — what *not* to do.

---

## Diagrams and Visual Aids

```
              (caller)
                 |
        g, ctx = errgroup.WithContext
                 |
   +-------------+-------------+
   |             |             |
g.Go(s1)      g.Go(s2)      g.Go(s3)
   |             |             |
 ch1 ---->    ch2 ---->     (sink)
   |             |
   |   <- ctx.Done() ->     <- ctx.Done()
   |
 first non-nil error captured (sync.Once)
   |
 ctx cancelled => s1, s2, s3 observe
   |
 g.Wait() returns the first error
```

Plain-text state diagram:

```
   Running --(stage returns nil)--> Running
   Running --(stage returns err)--> Failed[err captured, ctx cancelled]
   Failed  --(all stages exited)--> Done(err)
   Running --(all stages exited)--> Done(nil)
```

A single-line memory model fact: the writes in any `g.Go` function happen-before the return of `g.Wait`. So after `Wait` returns, you can safely read whatever the goroutines wrote.

That is enough to write your first error-aware pipeline. Type one in and break it deliberately — that is the fastest way to internalise the patterns.

---

## Appendix: The Errors Package Cheat Sheet

A condensed reference for the `errors` package and `fmt.Errorf`.

| Operation | API |
|-----------|-----|
| Create a sentinel | `var ErrFoo = errors.New("foo")` |
| Wrap with context | `fmt.Errorf("context: %w", err)` |
| Wrap two errors (1.20+) | `fmt.Errorf("ctx: %w and %w", e1, e2)` |
| Check sentinel | `errors.Is(err, ErrFoo)` |
| Extract typed error | `errors.As(err, &target)` |
| Unwrap one layer | `errors.Unwrap(err)` |
| Join multiple errors (1.20+) | `errors.Join(e1, e2)` |
| Compare two errors directly | `errors.Is(err, sentinel)` (never `==`) |

Patterns to memorise:

- "wrap on the way up": every layer adds context with `%w`.
- "match on the way down": callers use `errors.Is` / `errors.As`.
- "sentinel for atomic conditions": `ErrNotFound`, `io.EOF`.
- "type for rich data": `*os.PathError`, `*json.SyntaxError`.

---

## Appendix: A Self-Test

Without looking at the document, answer these. If unsure, re-read the relevant section.

1. Define a goroutine leak.
2. Why is `errgroup.WithContext` preferable to `errgroup.Group{}`?
3. What does `defer close(out)` in a sender goroutine guarantee?
4. What's the difference between `%w` and `%v` in `fmt.Errorf`?
5. Name three reasons a stage might exit.
6. What happens if a `g.Go` function panics?
7. Why must blocking operations use `select` with `<-ctx.Done()`?
8. Distinguish first-error-wins from aggregation. When is each appropriate?
9. What does `errors.Is(err, context.Canceled)` tell you about the failure source?
10. What is the relationship between `g.Wait` and the memory model?

Answers (paraphrased): (1) a goroutine that should have exited but didn't. (2) you want automatic cancellation on first error. (3) the channel will be closed on every exit path of the goroutine. (4) `%w` preserves the error chain; `%v` formats as string. (5) input exhausted, internal error, ctx cancelled. (6) the program crashes unless recovered. (7) otherwise they cannot be unblocked on sibling failure. (8) first-error: user-facing operations; aggregation: batch jobs. (9) parent or sibling cancelled the context. (10) writes inside `g.Go` funcs happen-before the return of `g.Wait`.

If you got 8+ correct, you are ready for `middle.md`. Less than that, re-read the sections you missed.

---

## Appendix: A Decision Tree

Use this when you encounter a new pipeline problem:

```
Q: Does the work need to run concurrently?
  No  -> just write sequential code with returned errors
  Yes -> continue

Q: Does the caller need to know about errors?
  No  -> log inside the goroutine, no errgroup needed
  Yes -> continue

Q: Should one failure stop the rest?
  Yes -> errgroup.WithContext (this file)
  No  -> errgroup without WithContext, or independent goroutines, recording results per-item

Q: Do you want one error or all of them?
  One -> use errgroup default (sync.Once captures first)
  All -> aggregate manually now, errors.Join at senior level

Q: Are stages independent (fan-out) or chained (pipeline)?
  Fan-out -> one g.Go per item, possibly with SetLimit
  Chained -> one g.Go per stage, channels between
```

This tree covers ~95% of decisions for junior-level pipeline design. The remaining 5% are special cases covered at middle and senior.

---

## Appendix: Side-by-Side Stage Comparisons

A small table showing the same logical stage in three forms.

| Concern | Sequential | Bad concurrent | Good concurrent |
|---------|-----------|----------------|-----------------|
| Error returns | `return err` | log + continue | wrap with `%w`, return |
| Cancellation | `if ctx.Err() != nil` | none | `select` on `<-ctx.Done()` |
| Resource cleanup | `defer f.Close()` | sometimes forgotten | always `defer`, including `close(out)` |
| Coordination | none needed | shared variable, mutex | errgroup or channel |
| Caller waits | naturally on return | hopes for the best | `g.Wait()` |

The columns differ mostly in *discipline*, not API surface. The concurrent version is rarely more than 30% longer than the sequential version when written cleanly.

---

## Appendix: Reading List for Going Deeper

Pick three for the next week:

- The Go Blog, "Pipelines and cancellation" (Pike).
- Sameer Ajmani, "Go Concurrency Patterns: Context" (Google I/O 2014 talk).
- *Concurrency in Go* by Katherine Cox-Buday, especially chapters 4 and 5.
- Russ Cox, "Error values in Go 1.13."
- The source of `golang.org/x/sync/errgroup` (about 100 lines, very readable).
- Bryan Mills' talk "Rethinking Classical Concurrency Patterns" — discusses errgroup pitfalls.

For the source, browse `https://cs.opensource.google/go/x/sync/+/master:errgroup/errgroup.go` (or in your `GOPATH`). Reading the actual implementation is the best demystifier.

---

## Closing Thoughts

Pipeline error propagation is the simplest non-trivial concurrent pattern in Go. It is the gateway to thinking about distributed systems, structured concurrency, and disciplined goroutine management. The handful of habits — `errgroup.WithContext`, `defer close`, `select` on every blocking op, `%w` wrapping — produce code that survives production at scale. The cost of skipping them is hours of mysterious hangs and lost data.

Build the muscle memory now, at the junior level, with toy programs. By the time you reach middle and senior content, the patterns will feel like natural extensions rather than new material.

---

## Bonus: One-Page Mental Picture

Imagine a pipeline as a string of beads:

```
[gen] -- ch1 --> [stage A] -- ch2 --> [stage B] -- ch3 --> [sink]
```

Each bead is a goroutine. Each string is a channel. Above the string runs another, invisible wire: the **context**. The context can be cut at any point by `cancel()`. When cut, every bead must let go of its string and quietly fall away.

The bead that detects a problem (a broken value, a network error) stops working *and* sends an error report up to the puppeteer (the `errgroup`). The puppeteer cuts the context wire. Every other bead notices and releases. The puppeteer hands the *first* report up to the user.

If you can picture this, you have the model. Channels move data. Context moves "stop now." Errgroup is the puppeteer.

The mistakes — leaked goroutines, deadlocks, lost errors — happen when one bead doesn't watch the context wire, or one string is never cut, or two beads try to share the same string and step on each other.

Concurrency is choreography. Most of the time, the choreography is "everyone stop when one falls." `errgroup.WithContext` is the choreographer.

That image — beads on strings under a cuttable wire — is the picture to carry into the middle level.
