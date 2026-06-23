# Preventing Goroutine Leaks — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [What the Go Specification Says (and Doesn't)](#what-the-go-specification-says-and-doesnt)
3. [`context` Package Guarantees](#context-package-guarantees)
4. [Channel Close and Receive Semantics](#channel-close-and-receive-semantics)
5. [`sync.WaitGroup` Semantics](#syncwaitgroup-semantics)
6. [`select` Semantics](#select-semantics)
7. [`runtime` Package Hooks](#runtime-package-hooks)
8. [Standard Library Lifecycle Contracts](#standard-library-lifecycle-contracts)
9. [What Is Not Guaranteed](#what-is-not-guaranteed)
10. [Summary](#summary)

---

## Introduction

Leak prevention rests on a few primitives whose semantics are specified in the Go language spec, the `context` package documentation, and the `sync` package documentation. This file is the precise reference: what is guaranteed, what is implementation-defined, and what would be a portability mistake to rely on.

The patterns at junior, middle, and senior levels are built from these primitives. Knowing exactly what each one promises lets you reason about edge cases (e.g., "if I cancel the parent context, is my child's `Done` channel guaranteed to be closed when my next select runs?").

---

## What the Go Specification Says (and Doesn't)

The Go specification (https://go.dev/ref/spec) defines:

- The `go` statement (a function call started concurrently).
- Channels (send, receive, close, capacity).
- The `select` statement (random choice among ready communications).
- The `defer` mechanism.

It does **not** define:

- Goroutine lifecycle states (`_Grunnable`, etc.) — these are runtime implementation details.
- Cancellation. There is no language-level cancellation primitive; `context` is a standard library package.
- Garbage collection's interaction with goroutines.
- Scheduler fairness or starvation guarantees beyond "the runtime makes goroutines progress."

Leak prevention is therefore a *library* discipline, layered on top of the language. The spec gives you channels and `go`; the standard library gives you `context`, `sync`, and the patterns that turn the spec primitives into safe systems.

---

## `context` Package Guarantees

### Cancellation propagation

From `context` documentation:

- A `Context` returned by `WithCancel`, `WithDeadline`, or `WithTimeout` is cancelled when:
  - The corresponding `cancel` function is called, **or**
  - The parent context is cancelled, **or**
  - The deadline passes (for `WithDeadline` / `WithTimeout`).
- Once cancelled, `<-ctx.Done()` returns immediately (the channel is closed). `ctx.Err()` returns a non-nil error.

### Idempotency

`cancel()` may be called multiple times. After the first call, subsequent calls are no-ops.

### Memory release

Calling `cancel()` releases resources held by the context (a small struct plus the `Done` channel). If you do not call `cancel()`, the resources are released when the parent is cancelled or, eventually, when the context becomes unreachable to the GC. **However**, `WithCancel`, `WithDeadline`, and `WithTimeout` register a timer or a parent watcher; not calling `cancel()` keeps that registration alive longer than necessary. `go vet` warns about this.

### Done channel identity

`ctx.Done()` returns the same channel each time it is called on the same context. Reading it after cancellation is safe and returns the zero value immediately.

### Value lookup

`ctx.Value(key)` walks up the parent chain. It is O(depth). Don't put a value 50 levels deep and read it in a hot loop.

### Context is goroutine-safe

A `Context` may be used by multiple goroutines simultaneously. `cancel()` may be called from any goroutine.

---

## Channel Close and Receive Semantics

From the Go spec:

### Sending on a closed channel

Panics. The runtime emits "send on closed channel."

### Closing an already-closed channel

Panics. The runtime emits "close of closed channel."

### Closing a nil channel

Panics. The runtime emits "close of nil channel."

### Receiving on a closed channel

Succeeds immediately, returning the zero value and `ok == false`. Repeated receives continue to return zero, false.

### Receiving on a nil channel

Blocks forever. This is sometimes used intentionally to disable a select case:

```go
var done <-chan struct{}
if shouldWatch {
    done = ctx.Done()
}
select {
case <-done:
    // Only reachable when shouldWatch is true.
case msg := <-in:
    // ...
}
```

### Sending on a nil channel

Blocks forever. Same use case.

### Close before send

Receivers see all sent values, then `ok == false`. The channel acts as a finite stream.

### Capacity

`cap(ch)` returns the buffer capacity. `len(ch)` returns the number of elements currently in the buffer. Neither is goroutine-synchronisation-safe; they are observational.

---

## `sync.WaitGroup` Semantics

From the `sync` package documentation:

- `wg.Add(delta)` increments the counter by `delta` (may be negative).
- `wg.Done()` decrements the counter by 1 (equivalent to `wg.Add(-1)`).
- `wg.Wait()` blocks until the counter reaches 0.

### Rules

- `Add` calls with positive delta must happen before the corresponding `Wait`. Specifically, you must `Add` before launching the goroutine that will `Done`.
- If the counter goes negative, the program panics.
- `WaitGroup` may not be copied after first use.
- Reusing a `WaitGroup` after `Wait` returns is allowed, but the first `Add` after a `Wait` must not run concurrently with `Wait`.

### Common bug

```go
go func() {
    wg.Add(1)        // BUG: must be before go
    defer wg.Done()
    work()
}()
```

`wg.Wait()` in the caller might run before this goroutine's `Add`, see counter == 0, and return immediately. The caller proceeds, races with the goroutine's work, and leaves the WaitGroup with a `Done` that runs after `Wait` already returned. Always `wg.Add(1)` *before* the `go` statement.

---

## `select` Semantics

From the Go spec:

- All cases are evaluated for readiness simultaneously.
- If multiple cases are ready, one is chosen uniformly at random.
- If no case is ready and there is a `default`, the default executes.
- If no case is ready and there is no `default`, the select blocks until at least one case is ready.

### Implications for cancellation

If both `<-ctx.Done()` and `<-jobChan` are ready, the runtime picks one at random. You cannot rely on cancellation taking priority. If you need cancellation to win, check `ctx.Err()` at the top of each iteration:

```go
for {
    if err := ctx.Err(); err != nil {
        return err
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case j := <-jobs:
        handle(j)
    }
}
```

The `ctx.Err()` check at the top means: even if `select` picks `jobs` after `Done` was closed for a while, the next iteration will see `Err()` and return.

### `select{}`

An empty select blocks forever. Sometimes used in `main` for "run forever" daemons. Use with caution; you usually want a signal-aware approach via `signal.NotifyContext`.

---

## `runtime` Package Hooks

### `runtime.NumGoroutine`

Returns the number of currently existing goroutines, including the calling one. Useful for leak detection but not for hot-path decisions (it walks runtime internals).

### `runtime.Stack`

Writes all (or only the current) goroutine stacks into a buffer. Used by `goleak` to print stacks of leaked goroutines.

### `runtime.Gosched`

Yields the processor to allow other goroutines to run. Rarely needed in modern Go (the scheduler preempts). Don't use it as a cancellation mechanism.

### `runtime.Goexit`

Terminates the calling goroutine after running its deferreds. Distinct from `panic` (no stack unwinding past `recover`). Rare; mostly used by the testing package.

### `runtime.SetFinalizer`

Schedules a finalizer to run when the GC determines the object is unreachable. **Not** a substitute for explicit cleanup of goroutines. Finalisation order and timing are not guaranteed.

---

## Standard Library Lifecycle Contracts

### `net/http.Server`

- `ListenAndServe` returns `http.ErrServerClosed` after `Shutdown` is called; any other error is an actual server failure.
- `Shutdown(ctx)` returns after all active connections have closed gracefully or the context expires.
- If the context expires, in-flight requests are abandoned and `Shutdown` returns the context's error.
- After `Shutdown` returns, the server cannot be reused. Create a new one.

### `database/sql.DB`

- `DB.Close` waits for in-flight queries to complete (or for their contexts to be cancelled).
- Connections are released to the pool, the pool is closed.
- `Close` is safe to call multiple times.

### `os/signal.NotifyContext`

- Returns a context cancelled when one of the specified signals is received.
- The returned `stop` function unregisters the handler. Calling `stop` does *not* cancel the context; it only stops listening for further signals.

### `time.Ticker`

- `NewTicker(d)` returns a ticker whose `.C` receives the time at every `d` interval.
- `Stop()` stops the ticker. The channel `.C` is **not** closed; receivers will park forever if they wait for a value.
- A stopped ticker can be GC'd; resources are released.

### `time.Timer`

- `NewTimer(d)` returns a timer whose `.C` fires once after `d`.
- `Stop()` returns `true` if the timer was stopped before firing, `false` if it had already fired.
- `Reset(d)` reuses the timer. The standard pattern requires draining `.C` if `Stop` returned `false` and `.C` has not been read.

---

## What Is Not Guaranteed

### Goroutine ordering

If two goroutines both send on a channel, the order of arrival at the receiver is not guaranteed. Don't rely on it.

### Scheduler fairness

The runtime tries to make all goroutines progress, but it does not guarantee fairness in the strict sense. A goroutine spinning on `runtime.Gosched()` may be starved by busier goroutines on some systems.

### Goroutine ID

There is no public API to identify a goroutine. The runtime has internal IDs but does not expose them. Don't try to use them for keys, locks, or identity. Each goroutine should carry its identity in its context if needed.

### When `Done()` is observed

After `cancel()` returns, `<-ctx.Done()` is guaranteed to be ready *eventually*. The Go memory model gives you the happens-before relation, but there can be a small delay (typically nanoseconds) before another goroutine's `select` notices. For tests, do not race-test cancellation in tight timing.

### Default context propagation

Nothing in the spec says you must pass `context` down. The standard library expects it (every method that does I/O takes a context), but the language does not enforce it. Code that ignores context is legal Go; it is just poorly behaved.

---

## Summary

The Go specification provides the primitives: channels, `select`, `go`, `defer`. The standard library (`context`, `sync`, `runtime`, `net/http`, `time`) provides the contracts. Leak prevention is the discipline of using these contracts correctly:

- `context.Context` propagates cancellation. `cancel()` is idempotent.
- Channel close: sender's responsibility, exactly once. Receivers check `ok`.
- `select` picks randomly among ready cases. Cancellation may not win.
- `WaitGroup.Add` before `go`. Always.
- Tickers and Timers must be `Stop()`ped.
- Servers and DBs have documented `Shutdown` / `Close` contracts. Use them.
- The runtime does not promise to clean up goroutines; only your code can do that.

These guarantees are stable across Go versions and form the foundation for every pattern in this section.
