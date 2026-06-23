# Nil Channels — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Go Language Specification — Channel Types](#go-language-specification--channel-types)
3. [Send Statements](#send-statements)
4. [Receive Operator](#receive-operator)
5. [`close` Built-in](#close-built-in)
6. [`select` Statement](#select-statement)
7. [`for` Statement with `range` Clause](#for-statement-with-range-clause)
8. [The Zero Value Rule](#the-zero-value-rule)
9. [Memory Model Considerations](#memory-model-considerations)
10. [Runtime Documentation](#runtime-documentation)
11. [Standard Library References](#standard-library-references)
12. [Summary](#summary)

---

## Introduction

This file catalogues the formal language and runtime guarantees regarding nil channels. Every claim is anchored to a normative source — primarily the Go Programming Language Specification at <https://go.dev/ref/spec>, plus the Go memory model at <https://go.dev/ref/mem>, and the runtime documentation.

The specification text is short on nil channels — much shorter than the practical impact would suggest. Most of what you need is inferred from two facts: (1) channels are reference types with a zero value of nil, and (2) operations on nil channels are defined by their behavioural rules in the runtime, not by special syntax in the spec.

---

## Go Language Specification — Channel Types

From the Go specification, *Channel types*:

> A channel provides a mechanism for concurrently executing functions to communicate by sending and receiving values of a specified element type. The value of an uninitialized channel is nil.

This single sentence is the authoritative source for nil channels. The two key points:

1. The value of an uninitialised channel is nil.
2. Channels are a mechanism; the behaviour of the mechanism on nil values is detailed in the operation-specific sections below.

The spec defines channel types via:

```
ChannelType = ( "chan" | "chan" "<-" | "<-" "chan" ) ElementType .
```

A channel type variable, before it is assigned via `make`, holds the zero value of the channel reference, i.e., nil.

Reference: <https://go.dev/ref/spec#Channel_types>.

---

## Send Statements

From the spec, *Send statements*:

> A send on a nil channel blocks forever.

The complete relevant text:

> A send statement sends a value on a channel. The channel expression's core type must be a channel, the channel direction must permit send operations, and the type of the value to be sent must be assignable to the channel's element type.
>
> Both the channel and the value expression are evaluated before communication begins. Communication blocks until the send can proceed. A send on an unbuffered channel can proceed if a receiver is ready. A send on a buffered channel can proceed if there is room in the buffer. A send on a closed channel proceeds by causing a run-time panic. A send on a nil channel blocks forever.

Key takeaway: "blocks forever" is normative. The runtime implementation (`chansend` with `gopark(nil, nil, ...)`) is the *how*; the spec guarantees the *what*.

Reference: <https://go.dev/ref/spec#Send_statements>.

---

## Receive Operator

From the spec, *Receive operator*:

> Receiving from a nil channel blocks forever.

Full context:

> For an operand `ch` of channel type, the value of the receive operation `<-ch` is the value received from the channel `ch`. The channel direction must permit receive operations, and the type of the receive operation is the element type of the channel. The expression blocks until a value is available. Receiving from a nil channel blocks forever. A receive operation on a closed channel can always proceed immediately, yielding the element type's zero value after any previously sent values have been received.

Note the explicit phrasing "blocks forever" — same wording as for sends. The symmetry is deliberate.

The two-value receive form `v, ok := <-ch` is documented in the same section:

> The expression `x, ok = <-ch` ... yields an additional untyped boolean result reporting whether the communication succeeded. The value of `ok` is `true` if the value received was delivered by a successful send operation to the channel, or `false` if it is a zero value generated because the channel is closed and empty.

For nil channels, the `ok` form blocks forever — same as the single-value form. There is no "nil-aware" two-value receive.

Reference: <https://go.dev/ref/spec#Receive_operator>.

---

## `close` Built-in

From the spec, *Close*:

> The built-in function close ... closes a channel, which must be either bidirectional or send-only. It should be executed only by the sender, never the receiver, and has the effect of shutting down the channel after the last sent value is received. After the last value has been received from a closed channel `c`, any receive from `c` will succeed without blocking, returning the zero value for the channel element. The expression `close(c)` panics if `c` is a receive-only channel.
>
> Sending to or closing a closed channel causes a run-time panic. Closing the nil channel also causes a run-time panic.

The final sentence is the normative basis for the `close(nil chan)` panic. The exact panic message is not specified — the runtime emits `"close of nil channel"`, but a future Go version could in principle change the message (the spec only requires the panic).

Reference: <https://go.dev/ref/spec#Close>.

---

## `select` Statement

From the spec, *Select statements*:

> Execution of a "select" statement proceeds in several steps:
>
> 1. For all the cases in the statement, the channel operands of receive operations and the channel and right-hand-side expressions of send statements are evaluated exactly once, in source order, upon entering the "select" statement. The result is a set of channels to receive from or send to, and the corresponding values to send. Any side effects in that evaluation will occur irrespective of which (if any) communication operation is selected to proceed. Expressions on the left-hand side of a `RecvStmt` with a short variable declaration or assignment are not yet evaluated.
> 2. If one or more of the communications can proceed, a single one that can proceed is chosen via a uniform pseudo-random selection. Otherwise, if there is a default case, that case is chosen. If there is no default case, the "select" statement blocks until at least one of the communications can proceed.
> 3. ...

The spec does not explicitly say "a case whose channel is nil never proceeds." That follows from the definitions in *Send statements* and *Receive operator*: a send on a nil channel blocks forever, so it cannot proceed; a receive on a nil channel blocks forever, so it cannot proceed. Therefore step 2's "can proceed" predicate evaluates to false for nil-channel cases.

If all cases have nil channels and there is no default, the select blocks forever (step 2: no case proceeds, no default, block).

If all cases have nil channels and there *is* a default, the default fires (step 2: no case proceeds, default exists, default chosen).

Reference: <https://go.dev/ref/spec#Select_statements>.

---

## `for` Statement with `range` Clause

From the spec, *For statements with range clause*:

> For channels, the iteration values produced are the successive values sent on the channel until the channel is closed. If the channel is nil, the range expression blocks forever.

This explicitly addresses nil. The `range` over a nil channel blocks on its first attempted receive — which, by the receive-operator rule, blocks forever.

Reference: <https://go.dev/ref/spec#For_statements>.

---

## The Zero Value Rule

From the spec, *The zero value*:

> When storage is allocated for a variable, either through a declaration or a call of `new`, or when a new value is created, either through a composite literal or a call of `make`, and no explicit initialization is provided, the variable or value is given a default value. Each element of such a variable or value is set to the zero value for its type: false for booleans, 0 for numeric types, "" for strings, and nil for pointers, functions, interfaces, slices, channels, and maps.

This is the source of nil-by-default channel variables. Notice the list: "pointers, functions, interfaces, slices, channels, and maps." Channels share the property with these other reference types.

A struct field of channel type is nil unless initialised:

```go
type Server struct {
    events chan Event // nil until Server is constructed via make or composite literal
}
```

Reference: <https://go.dev/ref/spec#The_zero_value>.

---

## Memory Model Considerations

The Go memory model (<https://go.dev/ref/mem>) defines happens-before relationships for synchronisation operations. Channel operations create such relationships:

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.
>
> The closing of a channel is synchronized before a receive that returns because the channel is closed.

Nil channel operations *never complete*. Therefore they create *no* happens-before relationships. A goroutine parked on a nil channel send or receive contributes nothing to the synchronisation graph.

This has a practical consequence: do not rely on a nil-channel operation to "publish" any state. A goroutine that does:

```go
sharedData = computeResult()
ch <- 1 // nil channel: blocks forever, never publishes
```

leaves `sharedData` in a state that may or may not be visible to other goroutines. The send did not complete, so no happens-before with any receiver. (In practice, no receiver exists for a nil channel; the example is malformed.)

### Race Detector and Nil

The race detector (`-race` flag) instruments memory accesses. A nil channel operation is not directly racy — the operation parks the goroutine cleanly. But access to the *variable holding the channel pointer* is racy if mutated by one goroutine and read by another without synchronisation.

```go
var ch chan int

go func() { ch = make(chan int) }() // write
go func() { <-ch }()                // read of ch's value
```

The race detector flags the read against the write. The underlying operation (receive on whatever value is read) is well-defined for both nil and non-nil; the race is on the variable.

---

## Runtime Documentation

The Go runtime documentation at <https://pkg.go.dev/runtime> does not document `chansend`/`chanrecv` (they are internal), but several pages reference nil-channel behaviour:

- The `runtime/pprof` package documentation describes the wait reasons surfaced in goroutine profiles. The strings `"chan send (nil chan)"` and `"chan receive (nil chan)"` are stable; production scrapers can rely on them.
- The `runtime/trace` package documents block events; nil-channel waits appear as block events with reason `forever`.
- The `runtime.Stack` function returns stacks formatted with wait reasons. Nil-channel waits are clearly marked.

### `runtime.NumGoroutine`

Goroutines parked on nil channels are counted by `runtime.NumGoroutine`. A monotonically increasing count over time, with corresponding `(nil chan)` markers in pprof, is a leak signal.

---

## Standard Library References

The standard library uses nil channels idiomatically in several places:

### `time.NewTicker` / `time.NewTimer`

The `time.Ticker.C` field is a `<-chan Time`. It is initialised by `NewTicker`. The pattern of niling a *local copy* of `ticker.C` to pause emission is documented in community blogs and used in `database/sql`, `net/http`, and other standard packages.

### `context.Context`

`Context.Done()` returns `<-chan struct{}`. From the documentation:

> Done may return nil if this context can never be canceled.

This is a deliberate use of nil-as-dormant. A `select` case `case <-ctx.Done()` where `Done()` returned nil simply never fires — exactly the behaviour you want for "this context is never cancelled."

Reference: <https://pkg.go.dev/context#Context>.

### `sync.Cond` (related)

Not directly nil-channel, but `Cond` interacts with channel-based wait patterns. Documentation does not specify nil behaviour because `Cond` does not expose its channel.

### Third-party: `golang.org/x/sync/errgroup`

`errgroup.Group.Wait` does not return a channel, but internally uses sync primitives. Not affected by nil-channel semantics.

---

## Summary

The Go specification's treatment of nil channels is minimal but normative:

| Operation | Spec rule |
|---|---|
| Send on nil channel | Blocks forever |
| Receive on nil channel | Blocks forever |
| Close of nil channel | Runtime panic |
| `range` over nil channel | Blocks forever |
| `select` case with nil channel | Cannot proceed |
| Zero value of channel type | nil |

All other behaviours are derived from these primitives plus the general rules of `select`, `range`, and the memory model.

Key references:

- <https://go.dev/ref/spec#Channel_types>
- <https://go.dev/ref/spec#Send_statements>
- <https://go.dev/ref/spec#Receive_operator>
- <https://go.dev/ref/spec#Close>
- <https://go.dev/ref/spec#Select_statements>
- <https://go.dev/ref/spec#For_statements>
- <https://go.dev/ref/spec#The_zero_value>
- <https://go.dev/ref/mem>

For the runtime implementation, see `runtime/chan.go`, `runtime/select.go`, and `runtime/runtime2.go` in the Go source tree. For pragmatic patterns, the prior level files in this subsection cover the idiomatic uses.

The combination of *spec-defined blocking* and *runtime-implemented parking* is what makes nil channels a precision tool in `select` and a footgun outside it. The spec gives you the rule; the runtime gives you the diagnostics; the patterns make the rule usable.
