---
layout: default
title: Cancellation Propagation — Specification
parent: Cancellation Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/02-cancellation-propagation/specification/
---

# Cancellation Propagation — Specification

## Scope

This file collects the formal contracts that govern cancellation propagation in Go pipelines. The contracts come from three places: the Go language specification, the `context` package documentation, and conventions enforced by linters and the broader Go ecosystem.

The specification is not arbitrary; every clause is observable in practice. Violations manifest as leaks, race conditions, or shutdown SLA violations.

---

## The `Context` interface

From `pkg/context/context.go`:

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

### `Deadline()`

- Returns the time at which the context will be cancelled.
- The second return value is `false` if no deadline is set.
- If a parent has a deadline, the child inherits it unless given a tighter one.
- Implementations should return the same value for all calls (a context's deadline does not change).

### `Done()`

- Returns a channel that is closed when the context is cancelled.
- The channel may be `nil` if the context can never be cancelled (e.g. `Background`, `TODO`).
- All calls to `Done()` on the same context return the same channel value.
- A closed `Done()` channel means: the context has been cancelled. The reason is given by `Err()`.

### `Err()`

- Returns `nil` if `Done()` is not yet closed.
- Returns `context.Canceled` if `Done()` is closed because `cancel()` was called.
- Returns `context.DeadlineExceeded` if `Done()` is closed because the deadline elapsed.
- After cancellation, returns a non-nil error.
- Subsequent calls return the same error.

### `Value(key)`

- Returns the value associated with `key`, or `nil` if no value is set.
- Looks up the value through the parent chain.
- Safe for concurrent use.
- Keys should be unexported types to avoid collisions.

---

## `CancelFunc` contract

```go
type CancelFunc func()
```

A `CancelFunc` returned by `WithCancel`, `WithTimeout`, etc.:

- Safe for concurrent use.
- Idempotent: calling it twice has the same effect as calling it once.
- Does not wait for cancellation to take effect; returns immediately.
- Should be called when the context is no longer needed (typically via `defer`).
- Forgetting to call it may leak resources (the timer in `WithTimeout`; the children-map entry in any cancellable context).

---

## `CancelCauseFunc` contract (Go 1.20+)

```go
type CancelCauseFunc func(cause error)
```

- Like `CancelFunc` but accepts a custom error reason.
- `nil` cause is allowed and means "no specific reason" (treated like `context.Canceled`).
- Calling with a non-nil cause records it; `context.Cause(ctx)` returns it.
- `ctx.Err()` still returns `context.Canceled` for compatibility.

---

## Inheritance

When a derived context is cancelled, only that context and its descendants are affected. Cancelling a context never affects its parent or siblings.

When a parent is cancelled, all descendants are cancelled. The cancellation cascades through the tree.

The cascade is synchronous in the implementation: `cancel()` on the parent invokes `cancel()` on each child before returning. By the time `cancel()` returns, every descendant's `Done()` channel is closed.

---

## Concurrency safety

All methods on `Context`, and the `CancelFunc` returned by `With*`, are safe for concurrent use by multiple goroutines.

A `Context` is immutable: once created, its parent, key/value, deadline, etc. cannot change. The only state change is cancellation, which is monotonic (once cancelled, always cancelled).

---

## Cancellation cause precedence

When multiple causes could fire:

- First cause to be recorded wins. Subsequent causes are discarded.
- `cancel(nil)` followed by `cancel(err)` records nothing (the first `nil` already cancelled).
- Parent cancel cause propagates to children that have not been cancelled with their own cause.

---

## Lifetime constraints

- `WithCancel`, `WithTimeout`, `WithDeadline` are paired with a cancel function. The function must eventually be called.
- `WithValue` does not return a cancel function; values are tied to the parent's lifetime.
- `WithoutCancel` returns a context with no Done channel; cancelling the parent does not affect it.

---

## Channel close semantics

For any channel `ch`:

- `close(ch)` closes the channel. Subsequent sends panic.
- After close, all pending and future receives return the zero value with `ok == false`.
- All goroutines blocked on receive are woken simultaneously.
- A `select` with a `<-ch` case (where ch is closed) is always ready on that case.
- A `nil` channel never receives, never sends; `select` cases on it are never ready.

These properties make channel close suitable for "broadcast cancellation" — what `Done()` is built on.

---

## `select` statement contract

From the Go spec:

- A `select` statement chooses which of a set of possible send or receive operations will proceed.
- If multiple cases can proceed, a single one is chosen via a uniform pseudo-random selection.
- If no case can proceed and there is no `default`, the statement blocks until one case can proceed.
- If `default` is present and no other case is ready, `default` runs.

For cancellation:

- `select { case <-ctx.Done(): case <-ch: }` returns when either condition becomes ready.
- Order of cases in source does not affect priority.
- Two ready cases are chosen at random.

---

## Memory model

From the Go memory model:

- A send on a channel happens before the corresponding receive completes.
- The closing of a channel happens before a receive that returns because the channel is closed.

For cancellation:

- Writes before `cancel()` are visible to a receiver after `<-ctx.Done()` completes.
- This is the synchronisation that makes cancellation a viable broadcast primitive.

---

## Context value semantics

`context.WithValue(parent, key, val)` returns a context whose `Value(key)` returns `val`, and which delegates other lookups to `parent`.

- Keys should be comparable.
- Keys should be unexported types (struct{} typed sentinels are idiomatic).
- Values should be small and request-scoped.
- Values should not include "implicit" parameters that belong in function arguments.

The trap: using `WithValue` for things that should be explicit parameters. Resists static analysis, makes calls hard to reason about, encourages tight coupling.

The right uses:

- Trace IDs that flow through arbitrary call chains.
- User identity / authentication info for request-scoped data.
- Logger handles that include request-specific tags.

The wrong uses:

- Configuration that does not change per call.
- Inputs to the function that the caller knows about.
- Cross-cutting concerns that should be parameters or struct fields.

---

## Pipeline conventions

Beyond the Go spec, the following conventions govern pipeline construction:

### Context first parameter

Every function whose work is cancellable takes `ctx context.Context` as its first parameter:

```go
func DoWork(ctx context.Context, args ...any) error
```

Enforced by `go vet` and many linters.

### Channel ownership

The goroutine that writes to a channel is the goroutine that closes it. Multiple writers without coordination is undefined behaviour for close.

### `defer close(out)`

The producing goroutine closes its output channel via `defer` to ensure close on any exit path.

### Cancellable block

Every block in a stage (receive from input, send to output, external call) is wrapped in a `select` with `<-ctx.Done()`:

```go
select {
case out <- v:
case <-ctx.Done():
    return
}
```

### Done check before work

Heavy work begins with a `ctx.Err()` check to avoid wasted effort:

```go
if err := ctx.Err(); err != nil {
    return err
}
expensiveWork(ctx)
```

### Drain on cancel

When cancellation is initiated by the consumer, the consumer drains the input channel to allow producers to exit:

```go
cancel()
for range ch {
}
```

---

## Error sentinel values

- `context.Canceled` — the cancel function was called.
- `context.DeadlineExceeded` — the deadline elapsed.

Both implement `error`. Both are returned by `Err()`.

For `errors.Is`:

- `errors.Is(err, context.Canceled)` matches `Canceled` only.
- `errors.Is(err, context.DeadlineExceeded)` matches `DeadlineExceeded` only.

`DeadlineExceeded` implements `net.Error` with `Timeout() == true`, allowing it to be distinguished from generic timeouts in some code.

---

## `signal.NotifyContext` contract

```go
func NotifyContext(parent context.Context, signals ...os.Signal) (ctx context.Context, stop context.CancelFunc)
```

- Returns a context that is cancelled when any of the listed signals is received.
- Also cancelled if the parent is cancelled.
- The `stop` function stops listening for signals and cancels the context.
- Must be paired with `defer stop()` to release the signal handler.

---

## `errgroup.Group` contract

From `golang.org/x/sync/errgroup`:

```go
type Group struct { /* unexported */ }

func WithContext(ctx context.Context) (*Group, context.Context)
func (g *Group) Go(f func() error)
func (g *Group) Wait() error
func (g *Group) SetLimit(n int) // Go 1.20+
func (g *Group) TryGo(f func() error) bool // Go 1.20+
```

- `WithContext` returns a derived context cancelled on the first error.
- `Go` spawns a goroutine. The first non-nil error returned by `f` is captured; cancel is called.
- `Wait` blocks until all goroutines return. Returns the first captured error.
- `SetLimit(n)` bounds concurrent goroutines. `Go` blocks until below the limit.
- `TryGo` is non-blocking; returns false if the limit is reached.

---

## Pipeline shutdown SLAs

A common convention: services must shut down within a configured deadline.

- Kubernetes: `terminationGracePeriodSeconds`, typically 30 seconds.
- systemd: `TimeoutStopSec`, typically 90 seconds.
- Custom: typically 10-30 seconds.

The service's shutdown handler must:

1. Stop accepting new work within milliseconds of receiving the signal.
2. Cancel in-flight work via the root context.
3. Drain ongoing work (with a sub-deadline).
4. Release resources.
5. Exit before the orchestrator's deadline.

If the deadline is exceeded, the orchestrator escalates (typically SIGKILL).

---

## Cancellation propagation paths

In a multi-stage pipeline, cancellation can flow in three directions:

- **Downstream**: from earlier stages to later stages. The natural direction when a producer finishes or errors.
- **Upstream**: from later stages back to earlier ones. Triggered when a consumer errors and signals via shared context.
- **Sideways**: between sibling stages. The `errgroup` model: one stage's error cancels its siblings via the shared `gctx`.

All three use the same underlying primitive: a shared `ctx.Done()` channel close. The direction is a matter of *who* called cancel.

The specification: all three paths must be supported in a production pipeline. A stage cannot assume cancellation comes from one direction only.

---

## Linter rules

Common linters and the cancellation-related checks they perform:

- `go vet`: `lostcancel` — calling `WithCancel` without storing the cancel function.
- `staticcheck`: `SA1012` — `nil` context, `SA1019` — deprecated functions.
- `revive`: `context-as-argument` — context should be the first parameter.
- `gocritic`: various cancellation-related warnings.

Configure your CI to run these.

---

## Cross-process cancellation contracts

### gRPC

- Client deadline is propagated in `grpc-timeout` metadata.
- Cancellation sends `RST_STREAM`; server's context cancels.
- Server-side context inherits the deadline (minus network delay).
- `Cause` is not standardised across the wire; only `Canceled` and `DeadlineExceeded` are conveyed.

### HTTP/1.1

- No native deadline header; per-hop timeouts are independent.
- Client cancellation closes the TCP connection.
- Server detects via the next `Read` returning EOF.
- Server's `r.Context()` cancels.

### HTTP/2

- Same as HTTP/1.1 plus explicit stream cancellation via `RST_STREAM`.
- More efficient than full TCP close.

### Message queues

- Cancellation is asymmetric: consumer can stop, producer cannot recall.
- Common pattern: per-message deadlines with consumer-side enforcement.

---

## Goroutine accounting

For a production service, the following invariants on goroutine count typically apply:

- **Baseline**: a small fixed number (e.g. 10-20) of "background" goroutines (GC, network poller, monitor).
- **Per-request**: roughly proportional to in-flight requests.
- **Per-pool**: fixed per pool size.
- **Total**: should be bounded as `baseline + max(in_flight) * per_request_count + sum(pool_sizes)`.

If the actual count exceeds this expected sum, there is a leak. Alert on goroutine count drift over time.

---

## The "every goroutine has an exit" rule

A formal restatement of the most important rule:

> For every `go` keyword in your codebase, the code reviewer must be able to answer the question: "When does this goroutine exit, and what triggers that exit?"

Acceptable answers:

- "It exits when its input channel closes" — and the close path is documented.
- "It exits when ctx cancels" — and ctx is wired to a known cancel source.
- "It runs for the program lifetime; the OS terminates it" — only for very few, well-known background tasks.

Unacceptable:

- "It usually exits eventually."
- "It depends on the input."
- "I'm not sure."

A goroutine without a clear exit is a latent leak.

---

## Stdlib changes by version

A summary of cancellation-related changes in recent Go versions:

- **Go 1.7**: `context` package introduced.
- **Go 1.14**: async preemption; cancellation polling becomes effective in tight loops.
- **Go 1.16**: `signal.NotifyContext` added.
- **Go 1.17**: `net/http.Server.Shutdown` cancellation cleanup.
- **Go 1.20**: `context.WithCancelCause`, `context.Cause`.
- **Go 1.21**: `context.AfterFunc`, `context.WithoutCancel`.
- **Go 1.22**: `for ... range` per-iteration loop variables (eliminates capture bugs).
- **Go 1.23**: minor refinements.

Keep your Go version current to benefit from the cleanest cancellation primitives.

---

## Cancellation under panic

Per the Go specification:

- A panic in a goroutine, if not recovered in that goroutine, terminates the whole program.
- `defer` statements run during panic propagation.
- `recover()` only catches a panic in the same goroutine's deferred call chain.

For cancellation:

- A goroutine's `defer cancel()` runs even during a panic.
- The cancel cascades; siblings see `<-ctx.Done()` and exit.
- If the panic propagates past `main`, the process terminates.

To survive panics in worker goroutines, each must have its own `recover`:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic: %v", r)
        }
    }()
    work(ctx)
}()
```

Pair with `cancel()` if the panic should trigger cancellation of siblings:

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v", r)
        cancel() // signal others
    }
}()
```

---

## Cancellation timing contracts

For pipelines, the following timing contracts are typically implicit and should be made explicit in design documents:

- **Cancellation observability latency**: time from `cancel()` to first goroutine observing it. Typically < 100 microseconds under normal load.
- **Cancellation completion latency**: time from `cancel()` to last goroutine exiting. Bounded by per-stage worst-case work plus drain time.
- **Drain completion latency**: time from initial cancel to all channels drained. Bounded by buffer size times consumer time per item.
- **Resource release latency**: time from last goroutine exit to all resources (DB connections, file handles, locks) released. Typically dominated by network I/O for DB cancellations.

For each contract, the production-grade target is well under the shutdown SLA.

---

## Drain protocols

Two drain protocols are commonly seen:

### Best-effort drain

```go
cancel()
go func() {
    for range out {
    }
}()
```

The drain happens in a goroutine; the caller does not wait. Producers can exit; in-flight values are silently discarded.

### Synchronous drain

```go
cancel()
for range out {
}
wg.Wait()
```

The caller drains until the producer closes the channel. Guarantees the producer has exited before returning.

Use synchronous drain when subsequent code depends on producers having exited (e.g. before releasing shared state). Use best-effort drain when you only need cancellation, not strict ordering.

---

## Producer/consumer contract

By convention:

- **Producer**: a goroutine that writes to a channel. It owns the channel's close.
- **Consumer**: a goroutine that reads from a channel. It does not close.
- **Owner**: the function that created the channel. Often the producer; sometimes the orchestrator.

When two goroutines both write to a channel:

- One designated closer waits for both (via `WaitGroup`) and closes.
- Or the channel is buffered with sufficient capacity to never block; close is unnecessary if downstream knows when to stop.
- Or the close protocol is more elaborate (e.g. an explicit "shutdown" message).

---

## Naming conventions

Cancel-related variable names:

- `ctx`: the context.
- `cancel`: the cancel function from `WithCancel`/`WithTimeout`.
- `done`: a manual done channel (`chan struct{}`).
- `cause`: the cancel cause from `WithCancelCause`.

These conventions are standard across the Go ecosystem. Tooling assumes them.

---

## Cancellation propagation invariants

The following invariants should hold for any correct pipeline:

- **Invariant 1**: For every spawned goroutine, there is a code path that causes it to exit when `ctx` cancels.
- **Invariant 2**: Every blocking channel operation is wrapped in a `select` with `<-ctx.Done()`.
- **Invariant 3**: Every output channel is closed by the producing goroutine, in a `defer`.
- **Invariant 4**: Every `WithCancel`/`WithTimeout`/`WithDeadline` is paired with a `defer cancel()` at the appropriate scope.
- **Invariant 5**: After `g.Wait()` returns, no goroutines spawned by `g.Go` are still running.

Code reviews should check these invariants explicitly. Tools (linters, leak detectors) catch some but not all.

---

## References

- The Go language specification: <https://go.dev/ref/spec>
- The `context` package documentation: <https://pkg.go.dev/context>
- The Go memory model: <https://go.dev/ref/mem>
- The `errgroup` package documentation: <https://pkg.go.dev/golang.org/x/sync/errgroup>
- The Go Blog — *Pipelines and cancellation*: <https://go.dev/blog/pipelines>

---

## Cancellation in tests

A test that uses cancellation should:

- Use `context.WithCancel` (or `WithTimeout`) at the start.
- Register `cancel` via `t.Cleanup(cancel)` to ensure release on any test exit.
- Avoid `context.Background()` directly — prefer derived contexts so tests do not interfere.
- Use `goleak` or similar to detect leaks.
- Use `-race` to detect data races on cancellation paths.

A test that spawns goroutines should:

- Use `errgroup` or `WaitGroup` to join.
- Defer the join so test failures (`t.Fatal`) still clean up.

```go
func TestExample(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    t.Cleanup(cancel)
    // ...
}
```

This pattern is so common that some test helpers package it:

```go
func setup(t *testing.T) context.Context {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    t.Cleanup(cancel)
    return ctx
}
```

---

## Cancellation contract in CSP-style pipelines

For pipelines composed as `f(ctx, g(ctx, h(ctx, source(ctx))))`:

- `source(ctx)` returns a channel.
- Each function takes `(ctx, in <-chan T)` and returns `(out <-chan U)`.
- Each function spawns one or more goroutines that close their output channel on exit.
- Cancellation is via shared `ctx`.

The function compositions are pipelines; the cancellation contract is what makes them safe.

---

## Summary

The cancellation propagation specification is small and stable. The interface, the conventions, and the runtime contracts are well-defined. Production code that follows the spec is correct; production code that violates the spec leaks or races.

The specification is not theoretical — every clause has been bug-fixed into existence over a decade of production Go. Treat it as the codified wisdom of the ecosystem.
