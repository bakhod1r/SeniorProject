---
layout: default
title: Specification
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/specification/
---

# Error Propagation in Pipelines — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The `errors` Package](#the-errors-package)
3. [`fmt.Errorf` and `%w`](#fmterrorf-and-w)
4. [`errgroup.Group` API](#errgroupgroup-api)
5. [`context.Context` Behavior](#contextcontext-behavior)
6. [`sync.Once` Semantics](#synconce-semantics)
7. [The Go Memory Model](#the-go-memory-model)
8. [Channel Close Semantics](#channel-close-semantics)
9. [Panics and Recover](#panics-and-recover)
10. [References](#references)

---

## Introduction

This file collects the *normative* specification text and stable API surface for the constructs used in error propagation:

- `errors` package (Go standard library).
- `fmt.Errorf` with `%w` verb.
- `golang.org/x/sync/errgroup`.
- `context.Context` and friends.
- `sync.Once`.
- Channel semantics relevant to pipelines.
- Panic and recover semantics.

Where the Go specification is normative, we quote it. Where the API is documented in package docs, we summarize.

---

## The `errors` Package

From `pkg.go.dev/errors`:

> Package errors implements functions to manipulate errors.

### `errors.New`

```go
func New(text string) error
```

> New returns an error that formats as the given text. Each call to New returns a distinct error value even if the text is identical.

Important: two `errors.New("x")` are not `==`. This is why sentinels are stored as package-level variables.

### `errors.Is`

```go
func Is(err, target error) bool
```

> Is reports whether any error in err's tree matches target.
>
> The tree consists of err itself, followed by the errors obtained by repeatedly calling Unwrap. When err wraps multiple errors, Is examines err followed by a depth-first traversal of its children.
>
> An error is considered to match a target if it is equal to that target or if it implements a method Is(error) bool such that Is(target) returns true.

`errors.Is(nil, target)` returns `target == nil`.

### `errors.As`

```go
func As(err error, target any) bool
```

> As finds the first error in err's tree that matches target, and if one is found, sets target to that error value and returns true. Otherwise, it returns false.
>
> An error matches target if the error's concrete type is assignable to the type pointed to by target.
>
> As panics if target is not a non-nil pointer to either a type that implements error, or to any interface type.

Common bug: forgetting `&` when passing target.

### `errors.Unwrap`

```go
func Unwrap(err error) error
```

> Unwrap returns the result of calling the Unwrap method on err, if err's type contains an Unwrap method returning error. Otherwise, Unwrap returns nil.
>
> Unwrap returns nil if the Unwrap method returns []error.

For multi-wrap, use `errors.Is`/`errors.As` (which handle both forms) or walk manually via the `Unwrap() []error` interface.

### `errors.Join` (Go 1.20+)

```go
func Join(errs ...error) error
```

> Join returns an error that wraps the given errors. Any nil error values are discarded. Join returns nil if every value in errs is nil.
>
> The error formats as the concatenation of the strings obtained by calling the Error method of each element of errs, with a newline between each string.
>
> A non-nil error returned by Join implements the Unwrap() []error method.

### Interfaces

The standard `error` interface:

```go
type error interface {
    Error() string
}
```

Optional interfaces for participation in the chain:

```go
type Unwrapper interface {
    Unwrap() error      // single-wrap
    Unwrap() []error    // multi-wrap (1.20+)
}

type IsChecker interface {
    Is(target error) bool
}

type AsChecker interface {
    As(target any) bool
}
```

Custom error types may implement these to participate in `errors.Is` / `errors.As` semantics.

---

## `fmt.Errorf` and `%w`

From `pkg.go.dev/fmt`:

> If the format specifier includes a %w verb with an error operand, the returned error will implement an Unwrap method returning the operand.
>
> If there is more than one %w verb, the returned error implements an Unwrap method returning a []error containing all the %w operands in the order they appear in the arguments.
>
> It is invalid to supply the %w verb with an operand that does not implement the error interface. The %w verb is otherwise a synonym for %v.

Examples:

```go
err := fmt.Errorf("ctx: %w", innerErr)
err := fmt.Errorf("ctx: %w and %w", e1, e2) // multi-wrap, 1.20+
```

`fmt.Errorf("%w", nil)` produces an error whose `Unwrap()` returns `nil`. Avoid this.

---

## `errgroup.Group` API

From `pkg.go.dev/golang.org/x/sync/errgroup`:

> Package errgroup provides synchronization, error propagation, and Context cancelation for groups of goroutines working on subtasks of a common task.

### `WithContext`

```go
func WithContext(ctx context.Context) (*Group, context.Context)
```

> WithContext returns a new Group and an associated Context derived from ctx.
>
> The derived Context is canceled the first time a function passed to Go returns a non-nil error or the first time Wait returns, whichever occurs first.

The cancellation passes the error as the cause (since Go 1.20).

### `Group.Go`

```go
func (g *Group) Go(f func() error)
```

> Go calls the given function in a new goroutine.
>
> It blocks until the new goroutine can be added without the number of active goroutines in the group exceeding the configured limit.
>
> The first call to return a non-nil error cancels the group's context, if the group was created by calling WithContext. The error will be returned by Wait.

### `Group.TryGo`

```go
func (g *Group) TryGo(f func() error) bool
```

> TryGo calls the given function in a new goroutine only if the number of active goroutines in the group is currently below the configured limit.
>
> The return value reports whether the goroutine was started.

### `Group.Wait`

```go
func (g *Group) Wait() error
```

> Wait blocks until all function calls from the Go method have returned, then returns the first non-nil error (if any) from them.

### `Group.SetLimit`

```go
func (g *Group) SetLimit(n int)
```

> SetLimit limits the number of active goroutines in this group to at most n. A negative value indicates no limit.
>
> Any subsequent call to the Go method will block until it can add an active goroutine without exceeding the configured limit.
>
> The limit must not be modified while any goroutines in the group are active.

Modifying the limit while goroutines are active panics.

### Zero value

The zero value of `Group{}` is usable. Without `WithContext`, there's no associated context to cancel.

### Single-use

A `Group` is single-use. Reuse after `Wait` is undefined.

---

## `context.Context` Behavior

From `pkg.go.dev/context`:

> Package context defines the Context type, which carries deadlines, cancellation signals, and other request-scoped values across API boundaries and between processes.

### `Context` interface

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

### `context.Canceled`

```go
var Canceled = errors.New("context canceled")
```

Returned by `Err()` when the context was canceled.

### `context.DeadlineExceeded`

```go
var DeadlineExceeded error = deadlineExceededError{}
```

Returned by `Err()` when the context's deadline passed.

### `WithCancel`

```go
func WithCancel(parent Context) (ctx Context, cancel CancelFunc)
```

> WithCancel returns a copy of parent with a new Done channel. The returned context's Done channel is closed when the returned cancel function is called or when the parent context's Done channel is closed, whichever happens first.

### `WithCancelCause` (Go 1.20+)

```go
func WithCancelCause(parent Context) (ctx Context, cancel CancelCauseFunc)
```

> WithCancelCause behaves like WithCancel but returns a CancelCauseFunc instead of a CancelFunc. Calling cancel with a non-nil error ("the cause") records that error in ctx; it can then be retrieved by calling Cause(ctx).

### `WithTimeout`

```go
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)
```

> WithTimeout returns WithDeadline(parent, time.Now().Add(timeout)).

### Cancellation propagation

> Canceling this context releases resources associated with it, so code should call cancel as soon as the operations running in this Context complete.

The standard pattern:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

### Cause retrieval

```go
func Cause(c Context) error
```

> Cause returns a non-nil error explaining why c was canceled. The first cancellation of c or one of its parents sets the cause.

---

## `sync.Once` Semantics

From `pkg.go.dev/sync`:

> Once is an object that will perform exactly one action.

```go
type Once struct {
    // contains filtered or unexported fields
}

func (o *Once) Do(f func())
```

> Do calls the function f if and only if Do is being called for the first time for this instance of Once. In other words, given
>
> ```go
> var once Once
> ```
>
> if once.Do(f) is called multiple times, only the first call will invoke f, even if f has a different value in each invocation. A new instance of Once is required for each function to execute.

### Memory model

> [Do] guarantees the completion of the function f before Do returns, even if f is called from multiple goroutines.

This is the key property used by `errgroup` to safely capture the first error.

---

## The Go Memory Model

From `go.dev/ref/mem`:

### Happens-before

> Within a single goroutine, the happens-before order is the order expressed by the program.

For cross-goroutine, specific synchronization events establish happens-before:

> The k'th call to c.Send() on a channel with capacity C is synchronized before the completion of the (k+C)'th receive from that channel.

For unbuffered channels (C=0):

> The send on a channel is synchronized before the completion of the corresponding receive from that channel.

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

### sync.WaitGroup

> If sync.WaitGroup.Wait is called concurrently with sync.WaitGroup.Done, the call to Done that decrements the counter to zero is synchronized before the return of Wait.

This is the foundation of `g.Wait()` providing happens-before for `g.Go` writes.

### sync.Mutex

> For any sync.Mutex or sync.RWMutex variable l and n < m, call n of l.Unlock() is synchronized before call m of l.Lock() returns.

### Atomic operations

> The APIs in the sync/atomic package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B.

---

## Channel Close Semantics

From the Go spec, `go.dev/ref/spec#Close`:

> The close built-in function closes a channel, which must be either bidirectional or send-only. It should be executed only by the sender, never the receiver, and has the effect of shutting down the channel after the last sent value is received.
>
> After the last value has been received from a closed channel c, any receive from c will succeed without blocking, returning the zero value for the channel element. The form
>
> ```go
> x, ok := <-c
> ```
>
> will also set ok to false for a closed channel.

### Sending on a closed channel

From the spec:

> Sending to or closing a closed channel causes a run-time panic.

### Receiving from a nil channel

> Receiving from a nil channel blocks forever.

Sometimes used intentionally to "disable" a select case.

### `for range` on a channel

> For a channel c, the iteration values produced are the successive values sent on the channel until the channel is closed. If the channel is nil, the range expression blocks forever.

---

## Panics and Recover

From `go.dev/ref/spec#Handling_panics`:

> The built-in function panic stops normal execution of the current goroutine. When a function F calls panic, normal execution of F stops immediately. Any functions whose execution was deferred by F's invocation run as usual, and then F returns to its caller. To the caller G, the invocation of F then behaves like a call to panic, terminating G's execution and running any deferred functions. This continues until all functions in the executing goroutine have returned, at which point the program terminates.

> The recover function allows a program to manage behavior of a panicking goroutine. Suppose a function G defers a function D that calls recover and a panic occurs in a function on the same goroutine in which G is executing. When the running of deferred functions reaches D, the return value of D's call to recover will be the value passed to the call of panic. If D returns normally, without starting a new panic, the panicking sequence stops.

Key points:

- `recover()` only works inside a `defer`.
- `recover()` returns nil if no panic.
- `recover()` only catches panics in the *same goroutine*.

### Goroutine panic

> If any goroutine panics, the program terminates with the error.

This is why panic recovery in `g.Go` functions is essential — without it, one stage's panic crashes the whole program.

---

## References

- Go Language Specification: `https://go.dev/ref/spec`
- Go Memory Model: `https://go.dev/ref/mem`
- `errors` package: `https://pkg.go.dev/errors`
- `fmt` package: `https://pkg.go.dev/fmt`
- `context` package: `https://pkg.go.dev/context`
- `sync` package: `https://pkg.go.dev/sync`
- `sync/atomic` package: `https://pkg.go.dev/sync/atomic`
- `golang.org/x/sync/errgroup`: `https://pkg.go.dev/golang.org/x/sync/errgroup`
- `golang.org/x/sync/semaphore`: `https://pkg.go.dev/golang.org/x/sync/semaphore`
- The Go Blog, "Pipelines and cancellation": `https://go.dev/blog/pipelines`
- The Go Blog, "Working with Errors in Go 1.13": `https://go.dev/blog/go1.13-errors`

---

## API Stability

Standard library APIs (`errors`, `fmt`, `context`, `sync`, `sync/atomic`) follow Go 1's compatibility guarantee — they will not break in the Go 1.x series.

`golang.org/x/sync/errgroup` is in the `x` repos. Conventionally considered stable but not subject to the same formal guarantees. In practice, the API has been stable for years.

Pipeline error patterns built on these APIs are durable. Code written today will continue to work for the foreseeable future.

---

## Version-Specific Features

| Feature | Introduced |
|---------|-----------|
| `errors.Is`, `errors.As`, `errors.Unwrap` | Go 1.13 |
| `fmt.Errorf` with `%w` | Go 1.13 |
| `errors.Join` and multi-`%w` | Go 1.20 |
| `context.WithCancelCause` | Go 1.20 |
| `context.AfterFunc` | Go 1.21 |
| `errgroup.SetLimit` | added 2022 in x/sync |
| `errgroup.TryGo` | added 2022 in x/sync |

For modern Go (1.21+), assume all of these are available.

---

This is the formal specification of the surface area covered by the level files. Refer back here for normative answers about APIs and behavior.

---

## Compatibility Notes

### Pre-Go 1.13

Before Go 1.13, error wrapping required external libraries like `pkg/errors`. The wrapping verbs (`%w`) and chain-walking functions (`errors.Is`, `errors.As`, `errors.Unwrap`) did not exist in the standard library.

Code targeting older Go should not use `%w` or `errors.Is`. Either upgrade Go or use `pkg/errors`.

### Pre-Go 1.20

Before Go 1.20:

- `errors.Join` did not exist; use a custom multi-error type or `pkg/multierror`.
- Multi-`%w` was an error; only single-`%w` was allowed.
- `context.WithCancelCause` did not exist; `cancel()` had no associated reason.

### Pre-Go 1.21

Before Go 1.21:

- `context.AfterFunc` did not exist; manual goroutine setup required.

### `errgroup` versions

`errgroup` evolved over time:

- Initial version (2016): just `Group`, `Go`, `Wait`, `WithContext`.
- `SetLimit` and `TryGo` added 2022.
- `WithContext` switched to using `WithCancelCause` after Go 1.20 became broadly available.

For most code, use the latest `golang.org/x/sync/errgroup`. The API is stable.

---

## Common Patterns and Their Spec Implications

### Patterned read: "wrap then return"

```go
if err := step(); err != nil {
    return fmt.Errorf("doing X: %w", err)
}
```

Spec implications:
- `fmt.Errorf` with `%w` creates a wrapper implementing `Unwrap() error`.
- The wrapper's `Error()` returns "doing X: " + the inner's `Error()`.
- `errors.Is(err, sentinel)` walks through the wrapper.

### Patterned read: "match then handle"

```go
err := doWork()
switch {
case errors.Is(err, ErrNotFound):
    // ...
case errors.Is(err, context.Canceled):
    // ...
case err != nil:
    // ...
}
```

Spec implications:
- `errors.Is(err, target)` walks the chain calling `Unwrap` until match or end.
- `errors.Is(nil, nil)` returns true; otherwise nil mismatch.

### Patterned read: "extract typed"

```go
var pe *PathError
if errors.As(err, &pe) {
    fmt.Println(pe.Path)
}
```

Spec implications:
- `errors.As(err, &target)` requires target to be a pointer.
- Walks the chain looking for an error of the target's pointed type (or an `As(target)` method).
- Sets `*target` on success.

### Patterned read: "join multiple"

```go
return errors.Join(e1, e2, e3)
```

Spec implications (1.20+):
- nil values discarded.
- Returns nil if all nil.
- Returned error implements `Unwrap() []error`.
- `errors.Is`/`errors.As` walk all branches.

---

## Detailed Walkthrough: Memory Model in errgroup

The Go memory model gives precise guarantees. Tracing them through errgroup:

### Setup

```go
var x int
g, ctx := errgroup.WithContext(parent)
```

`x` is in `parent`'s scope. `g` and `ctx` are created. No goroutines started.

### Go call

```go
g.Go(func() error {
    x = 42
    return nil
})
```

`Go` calls `g.wg.Add(1)`, then `go func() { ... }()`. The `Add` and the start of the goroutine happen-before the goroutine's body.

### Body executes

Inside the goroutine: `x = 42`. This is a write to `x` from a new goroutine.

The goroutine's `defer g.done()` runs at end. `done()` calls `g.wg.Done()` and (optionally) `<-g.sem`.

### Wait

```go
err := g.Wait()
fmt.Println(x)
```

`Wait` calls `g.wg.Wait()`. By the memory model, every `Done` happens-before `Wait`'s return. So `x = 42` is visible after `Wait` returns. Reading `x` is safe.

### Concurrent reads

```go
go func() { fmt.Println(x) }() // before Wait
g.Wait()
```

This is a race: the second goroutine reads `x` without synchronization with the writing goroutine. The race detector catches it.

### Multiple writers

```go
g.Go(func() error { x = 1; return nil })
g.Go(func() error { x = 2; return nil })
g.Wait()
fmt.Println(x) // value indeterminate
```

Both writes race with each other. No synchronization between them. `g.Wait` makes the final value visible, but which value (1 or 2) is undefined.

Use `atomic` or `sync.Mutex` to coordinate:

```go
var x atomic.Int64
g.Go(func() error { x.Store(1); return nil })
g.Go(func() error { x.Store(2); return nil })
g.Wait()
fmt.Println(x.Load()) // value still indeterminate, but no race
```

---

## Detailed Walkthrough: First-Error Capture in errgroup

The `sync.Once` semantics ensure exactly one error is captured.

```go
type Group struct {
    errOnce sync.Once
    err     error
    cancel  func(error)
}

func (g *Group) Go(f func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil { g.cancel(g.err) }
            })
        }
    }()
}
```

Suppose two goroutines fail nearly simultaneously:

- Goroutine A returns `errA` at time t1.
- Goroutine B returns `errB` at time t2.
- Both call `g.errOnce.Do(...)`.

`sync.Once.Do` ensures only one of these executes its function body. The winner sets `g.err` and calls `g.cancel`. The loser's call returns without effect.

By the memory model: the body of `Once.Do` happens-before the return of *any* call to `Do`. So if `Wait` is called after either goroutine's `wg.Done`, the writes to `g.err` are visible.

`g.Wait` calls `g.wg.Wait()` then reads `g.err`. Since `Done` happens-before `Wait`'s return, and the `Once.Do` body happens-before its return (which is before `Done`), the read of `g.err` is safe.

---

## Detailed Walkthrough: Cancellation Propagation

When `errgroup` cancels its context, the cancellation propagates to all child contexts.

```go
parent := context.Background()
g, ctx := errgroup.WithContext(parent)

// ctx is a derived context, cancel function held by g.
// When g cancels (via Go's first-error or Wait's return), ctx.Done() closes.

g.Go(func() error {
    deeperCtx, deeperCancel := context.WithCancel(ctx)
    defer deeperCancel()

    // deeperCtx is derived from ctx.
    // When ctx is cancelled, deeperCtx.Done() also closes.

    select {
    case <-deeperCtx.Done():
        return deeperCtx.Err()
    }
})
```

Cancellation flows: when `g.cancel(err)` is called, `ctx.Done()` closes. `deeperCtx`, derived from `ctx`, also has its `Done()` close. Any `select` on `deeperCtx.Done()` fires.

`deeperCtx.Err()` returns `context.Canceled` (the cause is preserved via `context.Cause`, but the public `Err()` interface remains for backward compatibility).

---

## Detailed Walkthrough: Channel Close on Error

A pipeline stage's `defer close(out)` runs regardless of how the stage exits.

```go
g.Go(func() error {
    defer close(out)
    for v := range in {
        if err := process(v); err != nil {
            return err
        }
        out <- v
    }
    return nil
})
```

Exit paths:
1. `in` is closed and drained: loop exits, `return nil`, `defer close(out)` runs.
2. `process(v)` returns error: `return err`, `defer close(out)` runs.
3. Panic: `defer close(out)` runs as part of panic unwinding.

In every case, `close(out)` runs. Downstream consumers' `for v := range out` will exit.

If `out` were sent to inside another `defer` or `if` branch, you might miss closure on some paths. `defer close(out)` at the top is the safest placement.

---

## Detailed Walkthrough: Select on Context Done

The pattern `select { case <-ctx.Done(): ...; case out <- v: }` is a non-blocking-ish send.

The select fires whichever case is ready first:
- If `ctx.Done()` is closed (cancelled), that case is always ready; it fires.
- If `out`'s receiver is ready (or buffer has room), that case is ready; it fires.

If both are ready simultaneously, Go's select picks one pseudorandomly (per the spec). This is benign for correctness: either we send the value or we exit. Both are valid outcomes.

If neither is ready, select blocks until one becomes ready. The blocking is interrupted as soon as the context is cancelled.

This is why context-aware sends are essential for clean cancellation.

---

## Closing Note on the Spec

The Go specification (`go.dev/ref/spec`) is the normative source for language behavior. The package documentation (`pkg.go.dev`) is the normative source for library APIs. Where these two conflict (rare), the language spec wins.

When in doubt about behavior, read the spec. Read the source. Test the assumption with a small program. Don't guess.

The error-propagation patterns built on these specs are stable and durable. They will work in five years just as they do today.

This concludes the specification reference.
