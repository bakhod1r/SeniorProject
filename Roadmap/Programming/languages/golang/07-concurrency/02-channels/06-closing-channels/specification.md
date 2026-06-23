# Closing Channels — Specification & References

## Table of Contents
1. [Introduction](#introduction)
2. [The `close` Built-In](#the-close-built-in)
3. [Send on Closed: Spec Excerpt](#send-on-closed-spec-excerpt)
4. [Receive from Closed: Spec Excerpt](#receive-from-closed-spec-excerpt)
5. [`for range` Termination: Spec Excerpt](#for-range-termination-spec-excerpt)
6. [Channel Direction and Close: Spec Excerpt](#channel-direction-and-close-spec-excerpt)
7. [Go Memory Model: Close](#go-memory-model-close)
8. [Runtime Source References](#runtime-source-references)
9. [Standard Library Cross-References](#standard-library-cross-references)
10. [Historical Notes and Proposals](#historical-notes-and-proposals)
11. [Compiler and Tooling Diagnostics](#compiler-and-tooling-diagnostics)
12. [External References](#external-references)
13. [Summary](#summary)

---

## Introduction

This file is the formal-reference companion. Where the other files explain "how to use close," this file cites the authoritative texts: the Go Programming Language Specification, the Go Memory Model, the runtime source, and the FAQ. Use it as a quick lookup or as a citation source in code reviews and discussions.

Spec URLs are stable; line numbers in source code drift between releases. The references below are to Go 1.22 unless otherwise noted.

---

## The `close` Built-In

From the Go specification (<https://go.dev/ref/spec#Close>):

> The built-in function `close` records the fact that no more values will be sent on a channel. It is an error if `ch` is a receive-only channel. Sending to or closing a closed channel causes a run-time panic. Closing the nil channel also causes a run-time panic. After calling `close`, and after any previously sent values have been received, receive operations will return the zero value for the channel's type without blocking. The multi-valued receive operation returns a received value along with an indication of whether the channel is closed.

### Function signature

```go
func close(c chan<- Type)
```

The argument type must be a channel that supports send (`chan T` or `chan<- T`). A receive-only channel cannot be closed:

```go
var ch <-chan int
close(ch) // invalid operation: cannot close receive-only channel
```

### Key contractual statements (verbatim from spec)

- "no more values will be sent" — close is a one-way signal.
- "It is an error if `ch` is a receive-only channel" — compile-time error.
- "Sending to or closing a closed channel causes a run-time panic" — both operations panic.
- "Closing the nil channel also causes a run-time panic" — nil-close panic.
- "After calling `close`, and after any previously sent values have been received, receive operations will return the zero value for the channel's type without blocking" — drained-closed semantics.
- "The multi-valued receive operation returns a received value along with an indication of whether the channel is closed" — comma-ok form.

---

## Send on Closed: Spec Excerpt

From the spec section *Send statements* (<https://go.dev/ref/spec#Send_statements>):

> A send on a closed channel proceeds by causing a run-time panic.

The panic is unconditional. There is no error return; there is no "would send if not closed" non-blocking variant of send. The construct `ch <- v` either succeeds, blocks, or panics.

### Send on closed in `select`

A send case in a `select` statement on a closed channel will be selected and then will panic. This means a `select` with a send case on a closed channel is *not* a safe way to test for closure.

```go
select {
case ch <- v: // selected if channel is closed → panic
default:
}
```

This is rarely what is intended. If you need "send if open, otherwise skip," structure differently — e.g., observe a done channel:

```go
select {
case <-done:
    return
case ch <- v:
}
```

---

## Receive from Closed: Spec Excerpt

From *Receive operator* (<https://go.dev/ref/spec#Receive_operator>):

> The operation blocks until a value is available. Receiving from a nil channel blocks forever. A receive operation on a closed channel can always proceed immediately, yielding the element type's zero value after any previously sent values have been received.

> The expression `x, ok := <-ch` yields an additional untyped boolean result reporting whether the communication succeeded. The value of `ok` is `true` if the value received was delivered by a successful send operation to the channel, or `false` if it is a zero value generated because the channel is closed and empty.

### Implications

- `<-ch` (single-value form) on a closed empty channel returns the zero value of the element type. No way to distinguish from a sent zero value.
- `<-ch` (two-value form, comma-ok) on a closed empty channel returns `(zero, false)`. The `false` is the "channel is closed and empty" signal.
- A buffered closed channel with values: receives drain the values normally; only after the buffer is empty does the receive return `(zero, false)`.

### Receive in `select`

A receive case on a closed channel is always selectable. This is the basis for the closed-channel-as-broadcast pattern.

```go
select {
case <-done:
    // selected immediately if done is closed
case msg := <-work:
    process(msg)
}
```

If `done` is closed, the first case always fires. If you want priority, structure the order or use nested `select`s.

---

## `for range` Termination: Spec Excerpt

From *For statements with range clause* (<https://go.dev/ref/spec#For_range>):

> For channels, the iteration values produced are the successive values sent on the channel until the channel is closed. If the channel is `nil`, the range expression blocks forever.

### Semantics

```go
for v := range ch {
    process(v)
}
```

The loop:

1. Receives from `ch` (equivalent to `v, ok := <-ch`).
2. If `ok`, executes the body with the received `v`.
3. If `!ok`, terminates the loop.

The loop body is executed once per *sent* value, including any values still in the buffer at close time. After the buffer drains and the channel reports closed, the loop exits.

### Range on nil channel

Blocks forever. The channel must be `make`-d before being ranged.

### Range on already-closed empty channel

```go
ch := make(chan int)
close(ch)
for v := range ch {
    // never enters
}
```

The body runs zero times. The loop exits immediately.

---

## Channel Direction and Close: Spec Excerpt

From *Channel types* (<https://go.dev/ref/spec#Channel_types>):

> A channel may be constrained only to send or only to receive by assignment or explicit conversion. The optional `<-` operator specifies the channel direction, send or receive. If no direction is given, the channel is bidirectional. A channel may be constrained only to send or only to receive by assignment or explicit conversion.

```go
chan T       // bidirectional
chan<- T     // send-only
<-chan T     // receive-only
```

Close is permitted on `chan T` and `chan<- T`. Close is **not** permitted on `<-chan T`:

```go
func consume(ch <-chan int) {
    close(ch) // compile error: invalid operation: cannot close receive-only channel
}
```

This is a static check by the compiler. The error message:

```
./main.go:N: invalid operation: cannot close receive-only channel ch (variable of type <-chan int)
```

### Conversion direction

```go
var bidi chan int = make(chan int)
var recvOnly <-chan int = bidi // implicit conversion
var sendOnly chan<- int = bidi // implicit conversion
```

Conversions narrow direction. The compiler will not let you convert from `<-chan T` back to `chan T` (you cannot regain the close permission).

---

## Go Memory Model: Close

From the Go Memory Model (<https://go.dev/ref/mem#Channel_communication>):

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

### Practical implication

If goroutine A performs writes and then closes a channel, and goroutine B observes the close via a receive, A's writes happen before B's reads. This makes close a release/acquire synchronisation point.

```go
var data T
done := make(chan struct{})

// goroutine A
data = computeT()
close(done)

// goroutine B
<-done
useT(data) // safe; data is fully visible
```

### Compared to send/receive

The Memory Model also says:

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

For close, the "corresponding receive" is *every* receive that returns because of close — not just one. This is the formal justification for "close as broadcast synchronisation."

### Limits

The model does not guarantee any ordering with respect to:

- Other channels (not synchronised by this close).
- Other shared variables not preceding the close in program order.
- Sends or closes that happen *after* this close (which would themselves panic).

---

## Runtime Source References

For Go 1.22 (paths relative to the Go source tree):

| File | Function | Purpose |
|---|---|---|
| `runtime/chan.go` | `closechan` | Implementation of `close`. |
| `runtime/chan.go` | `chansend` | Send implementation; contains the "send on closed" panic. |
| `runtime/chan.go` | `chanrecv` | Receive implementation; handles "receive from closed" zero-value return. |
| `runtime/chan.go` | `makechan` | Channel creation. |
| `runtime/chan.go` | `full`, `empty` | Buffer state queries. |
| `runtime/select.go` | `selectgo` | `select` implementation; honours closed cases. |
| `runtime/runtime2.go` | `hchan`, `sudog`, `waitq` | Type definitions. |
| `runtime/race.go` | `racerelease`, `raceacquire` | Race detector hooks called from chan code. |

### Reading order

For a deep dive: `runtime2.go` (types) → `chan.go` (operations) → `select.go` (multiplexing) → `race.go` (synchronisation events).

---

## Standard Library Cross-References

Standard library packages that use channel close as a fundamental mechanism:

### `context`

- `context.Context.Done() <-chan struct{}` — returns a channel that is closed on cancellation. The internal mechanism is `close(c.done)` in `cancelCtx.cancel`.
- Source: `src/context/context.go`.

### `time`

- `time.After(d time.Duration) <-chan time.Time` — returns a channel that *sends* a value after `d`, not closed. The timer goroutine sends; no close.
- `time.Tick(d time.Duration) <-chan time.Time` — never closed. Returns a leaked timer if discarded.

### `net/http`

- `http.Request.Context().Done()` — closed when the client cancels.
- `http.Server.Shutdown(ctx)` — gracefully closes listener and in-flight handlers; uses close internally.

### `sync`

- `sync.Cond` — uses goroutine parking, not channels.
- `sync.WaitGroup` — uses atomic counters; once counter hits zero, all `Wait()` callers wake. Internally implemented with channels in some versions.

### `os/signal`

- `signal.Notify(c chan os.Signal, sig ...os.Signal)` — sends signals on `c`. Never closes it; the caller must.
- `signal.NotifyContext(ctx, sig...)` — returns a `Context` that is *cancelled* (and `Done()` closed) on signal.

### `golang.org/x/sync/errgroup`

- `errgroup.Group.Wait()` — closes an internal done channel when all goroutines finish or one errors.

---

## Historical Notes and Proposals

### `close` was always a built-in

`close` has been part of Go since the public release (2009). The semantics of "panic on close-of-closed" and "panic on send-on-closed" have been stable since then.

### Considered: `close` returning a boolean

There has been discussion in the community about making `close` return `bool` (true if it was the closer, false if already closed) — analogous to `sync.Once`. The proposal was rejected: the language prefers panics for logic errors, and `sync.Once` exists for the idempotent case.

### Considered: `closed(ch) bool`

A `closed(ch)` query function has been proposed multiple times and rejected. Reason: any "is it closed" check is racy. Between the check and the next send, another goroutine could close. The right pattern is to coordinate, not to query.

You can detect a closed channel via the comma-ok receive (`_, ok := <-ch`), but that consumes a value. There is no non-destructive "is closed" test by design.

### Go 1.5 and the close-panic-detection improvements

Early Go versions had less detailed panic messages. Since Go 1.5, the panic strings are stable: `"send on closed channel"`, `"close of closed channel"`, `"close of nil channel"`. Tooling can match on these for error categorisation.

### Go 1.22 loop variable semantics

Affects close patterns indirectly: closures spawned inside `for range` loops capture fresh variables. This makes some "spawn goroutine per item, close shared channel" patterns safer than before. The change is documented at <https://go.dev/ref/spec#For_statements>.

---

## Compiler and Tooling Diagnostics

### Compiler errors

```
invalid operation: cannot close receive-only channel ch (variable of type <-chan T)
```

Static error. The fix: take a `chan T` or `chan<- T`, or accept that you cannot close it.

### Runtime panics (cannot be caught by compiler)

```
panic: send on closed channel
panic: close of closed channel
panic: close of nil channel
```

Each is detectable in panic recovery (`recover() == "..."` matches the string).

### `go vet`

`go vet` includes some channel-related checks but does not analyse close-correctness. For close issues, run `go test -race` to detect races and use `staticcheck` for higher-level analysis.

### `staticcheck`

Relevant checks:

- **SA4022** — *Comparing the address of a variable with nil*. (Channel-adjacent.)
- **SA1015** — *Using `time.Tick` in a way that will leak*.
- **SA9006** — *Don't use `time.Sleep` to synchronise channel operations*.
- **SA1030** — Various close issues are caught by general data-flow analysis but not as a specific check.

There is no built-in static checker for "this channel may be closed twice." Architecture review is the real tool.

### Race detector

`go test -race` catches data races where close and access (send, receive, or close again) are not synchronised. Run in CI.

---

## External References

### Authoritative

- Go specification — *Close*: <https://go.dev/ref/spec#Close>
- Go specification — *Send statements*: <https://go.dev/ref/spec#Send_statements>
- Go specification — *Receive operator*: <https://go.dev/ref/spec#Receive_operator>
- Go specification — *For range*: <https://go.dev/ref/spec#For_range>
- Go specification — *Channel types*: <https://go.dev/ref/spec#Channel_types>
- Go Memory Model: <https://go.dev/ref/mem>
- Go FAQ — *Why does my Go program use so much memory? / channel closure*: <https://go.dev/doc/faq>

### Source code

- `runtime/chan.go` in the Go source repository: <https://github.com/golang/go/blob/master/src/runtime/chan.go>
- `context/context.go`: <https://github.com/golang/go/blob/master/src/context/context.go>

### Blog posts and talks

- *Go Concurrency Patterns: Pipelines and cancellation*: <https://go.dev/blog/pipelines>
- *Share Memory By Communicating*: <https://go.dev/blog/codelab-share>
- Dave Cheney — *Channel axioms*: <https://dave.cheney.net/2014/03/19/channel-axioms>
- Rob Pike — *Go Concurrency Patterns* (Google I/O 2012): <https://www.youtube.com/watch?v=f6kdp27TYZs>

### Books

- *The Go Programming Language* (Donovan & Kernighan), Chapter 8 — "Goroutines and Channels"
- *Concurrency in Go* (Katherine Cox-Buday), Chapter 4 — "Concurrency Patterns in Go"

---

## Summary

The specification's contract for `close`:

1. `close(ch)` records "no more values will be sent."
2. Receive on closed-drained returns zero value (or `(zero, false)` with comma-ok).
3. Send on closed panics with `"send on closed channel"`.
4. Close of closed panics with `"close of closed channel"`.
5. Close of nil panics with `"close of nil channel"`.
6. Close of receive-only is a compile error.
7. `for range` over a channel terminates when the channel is closed and drained.

The memory model adds the happens-before guarantee: writes before close are visible to receivers that observe the close.

These rules are stable since Go 1.0 and unlikely to change. They underpin idiomatic patterns: generator, broadcast, pipeline, cancellation. Higher-level abstractions — `context.Context`, `errgroup`, `http.Server.Shutdown` — are all built on these primitives.

The next sub-file (`interview.md`) tests this material with progressively harder questions.
