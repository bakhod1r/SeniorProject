---
layout: default
title: Specification
parent: Cooperative vs Forced
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/specification/
---

# Cooperative vs Forced Cancellation — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [`context` Package Contract](#context-package-contract)
3. [Goroutine Termination Modes (Spec)](#goroutine-termination-modes-spec)
4. [Cancellation and the Memory Model](#cancellation-and-the-memory-model)
5. [Signal Handling Semantics](#signal-handling-semantics)
6. [`runtime` Package APIs Relevant to Cancellation](#runtime-package-apis-relevant-to-cancellation)
7. [Standard Library Cancellation Contracts](#standard-library-cancellation-contracts)
8. [Version History](#version-history)
9. [What Is Not Specified](#what-is-not-specified)
10. [References](#references)

---

## Introduction

This file collects the normative specifications relevant to cooperative vs forced cancellation in Go. Where Go does not have a single normative document for a behaviour, we cite the standard-library documentation and the implementation.

Normative sources:

- The Go Programming Language Specification (`https://go.dev/ref/spec`).
- The Go Memory Model (`https://go.dev/ref/mem`).
- The `context` package documentation (`https://pkg.go.dev/context`).
- The `runtime` and `os/signal` package documentation.
- The Go 1 compatibility promise (`https://go.dev/doc/go1compat`).

---

## `context` Package Contract

From `pkg.go.dev/context`:

> Package context defines the Context type, which carries deadlines, cancellation signals, and other request-scoped values across API boundaries and between processes.
>
> Programs that use Contexts should follow these rules to keep interfaces consistent across packages and enable static analysis tools to check context propagation:
>
> Do not store Contexts inside a struct type; instead, pass a Context explicitly to each function that needs it. The Context should be the first parameter, typically named ctx:
>
>     func DoSomething(ctx context.Context, arg Arg) error {
>         // ... use ctx ...
>     }
>
> Do not pass a nil Context, even if a function permits it. Pass context.TODO if you are unsure about which Context to use.

### Interface

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

Each method's contract:

- **`Deadline`** returns the time when work done on behalf of this context should be cancelled. Returns `ok==false` if no deadline is set.
- **`Done`** returns a channel that's closed when work done on behalf of this context should be cancelled. May return nil if this context can never be cancelled.
- **`Err`** returns nil if Done is not yet closed; non-nil otherwise. After Done is closed, returns one of `context.Canceled` or `context.DeadlineExceeded` (or a custom error from `WithCancelCause`).
- **`Value`** returns the value associated with the context for `key`, or nil if none.

### Constructors

```go
func Background() Context
func TODO() Context
func WithCancel(parent Context) (Context, CancelFunc)
func WithCancelCause(parent Context) (Context, CancelCauseFunc)        // Go 1.20+
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc)
func WithDeadlineCause(parent, d, cause) (Context, CancelFunc)         // Go 1.21+
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)
func WithTimeoutCause(parent, timeout, cause) (Context, CancelFunc)    // Go 1.21+
func WithValue(parent Context, key, val any) Context
func WithoutCancel(parent Context) Context                              // Go 1.21+
func AfterFunc(ctx Context, f func()) (stop func() bool)               // Go 1.21+
func Cause(c Context) error                                             // Go 1.20+
```

### Sentinel errors

```go
var Canceled = errors.New("context canceled")
var DeadlineExceeded error = deadlineExceededError{}
```

`DeadlineExceeded` satisfies `Timeout() bool` returning `true`. It is also detected by `errors.Is(err, os.ErrDeadlineExceeded)` in some standard library code.

### `cancel` semantics

> Cancellation removes the parent's reference to the child and may release associated resources, so it should be called as soon as the operations running in this Context complete.

The cancel function is idempotent: calling it multiple times after the first is a no-op. After cancel, `ctx.Done()` is closed, `ctx.Err()` returns the cancellation error, and any child contexts derived from `ctx` are also cancelled.

---

## Goroutine Termination Modes (Spec)

From `https://go.dev/ref/spec#Handling_panics`:

> If a panic occurs and is not recovered, the runtime terminates the program.

This is the *only* way a goroutine that is not finished can cause the entire program to die. There is no `goroutine.Kill` and the spec does not provide one.

A goroutine terminates when:

1. Its function returns normally.
2. An unrecovered panic propagates out (terminates the program).
3. `runtime.Goexit` is called.

### `runtime.Goexit`

> Goexit terminates the goroutine that calls it. No other goroutine is affected. Goexit runs all deferred calls before terminating the goroutine.

Note: `Goexit` is *self-cancellation*. You cannot call it on another goroutine. The runtime has no API for that.

### Main goroutine

> Program execution begins by initializing the main package and then invoking the function main. When that function invocation returns, the program exits. It does not wait for other (non-main) goroutines to complete.

Therefore: a "forced cancellation" of all goroutines occurs implicitly when `main` returns or when `os.Exit` is called.

---

## Cancellation and the Memory Model

From `https://go.dev/ref/mem`:

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

This is the formal guarantee that backs `context.Context` cancellation:

- `cancel()` closes the context's internal channel.
- Any goroutine that does `<-ctx.Done()` synchronizes-with `cancel()`.
- Therefore writes that happen-before `cancel()` are visible to the goroutine after it observes the closed channel.

```go
state = "shutting down"   // write
cancel()                  // closes channel; happens-before below
// in another goroutine:
<-ctx.Done()              // synchronizes-with cancel
log.Println(state)        // sees "shutting down"
```

Without this guarantee, cooperative cancellation would be unsafe. The Go Memory Model makes it sound.

---

## Signal Handling Semantics

From `https://pkg.go.dev/os/signal`:

> The signals SIGKILL and SIGSTOP may not be caught by a program, and therefore cannot be affected by this package.

So `SIGKILL` is always forced and uncatchable; this is the kernel-level force.

### `signal.Notify`

```go
func Notify(c chan<- os.Signal, sig ...os.Signal)
```

Registers `c` to receive notifications of the specified signals. The Go runtime catches the signal and forwards it to `c` (non-blockingly).

### `signal.NotifyContext`

```go
func NotifyContext(parent context.Context, signals ...os.Signal) (ctx context.Context, stop context.CancelFunc)
```

Returns a context that is cancelled when one of the named signals arrives. Standard pattern for shutdown:

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
defer stop()
```

### Async-preemption signal

The runtime uses `SIGURG` internally on Linux/macOS for async preemption (Go 1.14+). User code should not set up a handler for `SIGURG` that interferes.

> "We chose to use the SIGURG signal because we want to use a signal that is unlikely to be used for any other purpose in a Go program, and is unlikely to be received from the operating system."
>
> — Design Doc 24543, Non-cooperative goroutine preemption

---

## `runtime` Package APIs Relevant to Cancellation

### `runtime.Goexit`

> Goexit terminates the goroutine that calls it. No other goroutine is affected. Goexit runs all deferred calls before terminating the goroutine. Because Goexit is not a panic, any recover calls in those deferred functions will return nil.

Useful in tests or in a goroutine that wants to exit cleanly without panicking.

### `runtime.LockOSThread` / `UnlockOSThread`

> LockOSThread wires the calling goroutine to its current operating system thread. The calling goroutine will always execute in that thread, and no other goroutine will execute in it, until the calling goroutine has made as many calls to UnlockOSThread as to LockOSThread.

Required for thread-affine OS APIs (OpenGL, certain TLS-based libraries, signal-targeting).

> If the calling goroutine exits without unlocking the thread, the thread will be terminated.

A safety mechanism: a locked thread cannot outlive its sole G.

### `runtime.Gosched`

> Gosched yields the processor, allowing other goroutines to run.

Not cancellation; just a yield hint. Largely unnecessary post Go 1.14.

### `runtime.NumGoroutine`

> NumGoroutine returns the number of goroutines that currently exist.

Diagnostics for leak detection.

### `runtime.Stack`

> Stack formats a stack trace of the calling goroutine into buf and returns the number of bytes written to the buffer. If all is true, Stack formats stack traces of all other goroutines into buf after the trace for the current goroutine.

Useful for emergency debugging during shutdown.

---

## Standard Library Cancellation Contracts

### `net/http`

> Server.Shutdown gracefully shuts down the server without interrupting any active connections. Shutdown works by first closing all open listeners, then closing all idle connections, and then waiting indefinitely for connections to return to idle and then shut down. If the provided context expires before the shutdown is complete, Shutdown returns the context's error, otherwise it returns any error returned from closing the Server's underlying Listener(s).

> Request.Context returns the request's context. For incoming server requests, the context is canceled when the client's connection closes, the request is canceled (with HTTP/2), or when the ServeHTTP method returns.

### `database/sql`

> QueryContext executes a query that returns rows, typically a SELECT. The args are for any placeholder parameters in the query.

If a driver implements `driver.QueryerContext`, the driver receives the context. Cancellation requests the driver to abort the query. Specific semantics depend on the driver.

### `os/exec`

> CommandContext is like Command but includes a context.
>
> The provided context is used to interrupt the process (by calling cmd.Cancel or cmd.Process.Kill) if the context becomes done before the command completes on its own.

> Cancel is called if the context becomes done before the command completes on its own.

(Go 1.20+) `cmd.Cancel` is user-customisable; default is `cmd.Process.Kill`.

### `net`

> Dialer.DialContext connects to the address on the named network using the provided context. The provided Context must be non-nil. If the context expires before the connection is complete, an error is returned.

`net.Conn` itself does not take a context; deadlines are set via `SetDeadline`.

---

## Version History

| Go version | Cancellation-relevant change |
|---|---|
| 1.7 | `context` joins the standard library. |
| 1.14 | Asynchronous preemption via SIGURG. |
| 1.16 | `signal.NotifyContext` added. |
| 1.17 | `httptest.Server.Close` waits for in-flight requests. |
| 1.20 | `context.WithCancelCause`, `context.Cause`, `exec.Cmd.Cancel`, `Cmd.WaitDelay`. |
| 1.21 | `context.AfterFunc`, `context.WithoutCancel`, `context.WithDeadlineCause`, `context.WithTimeoutCause`. |
| 1.22 | `for` loop variable scope changed (helps closures over loop variables in cancellable workers). |
| 1.23 | `time.After` underlying timer GC-eligible sooner. |
| 1.24 | `testing/synctest` (experimental) — deterministic scheduler for tests, useful for cancellation tests. |

---

## What Is Not Specified

The following behaviours are *not* part of the Go 1 compatibility promise and may change:

- The exact mechanism of async preemption (currently signals on POSIX, suspend/resume on Windows).
- The internal layout of `context` types (the public API is stable, internals are not).
- The exact polling frequency of `sysmon` for preemption decisions.
- Whether and how the netpoller integrates with cancellation in future versions.
- The behaviour of `runtime.Goexit` in goroutines locked to OS threads in subtle edge cases.

The Go team has discussed but not implemented:

- A standard structured-concurrency helper in the standard library (separate from `errgroup`).
- `net.Conn.ReadContext` and similar context-aware syscall wrappers.
- A "kill goroutine" API. Not planned; explicitly rejected on multiple occasions.

---

## References

- **Go Specification** — Handling panics: <https://go.dev/ref/spec#Handling_panics>
- **Go Memory Model**: <https://go.dev/ref/mem>
- **`context` package**: <https://pkg.go.dev/context>
- **`os/signal` package**: <https://pkg.go.dev/os/signal>
- **`runtime` package**: <https://pkg.go.dev/runtime>
- **`net/http` Server.Shutdown**: <https://pkg.go.dev/net/http#Server.Shutdown>
- **`os/exec` CommandContext**: <https://pkg.go.dev/os/exec#CommandContext>
- **Design Doc 24543 — Non-cooperative goroutine preemption**: <https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md>
- **Design Doc — context.WithCancelCause**: <https://github.com/golang/proposal/blob/master/design/cancelation.md>
- **Sameer Ajmani — Go Concurrency Patterns: Context**: <https://go.dev/blog/context>
- **Russ Cox — Go and Cancellation**: discussion threads on the golang-dev list
- **Effective Go: Concurrency**: <https://go.dev/doc/effective_go#concurrency>
