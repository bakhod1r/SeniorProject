# Range Over Channels — Specification

> Formal language spec excerpts, runtime contract, and authoritative references for `for v := range ch`.

## Table of Contents

1. [Spec: For Statements with Range Clause](#spec-for-statements-with-range-clause)
2. [Spec: Channel Type](#spec-channel-type)
3. [Spec: Receive Operator](#spec-receive-operator)
4. [Spec: Close Function](#spec-close-function)
5. [Runtime Contract](#runtime-contract)
6. [Compile-Time Type Rules](#compile-time-type-rules)
7. [Memory Model Implications](#memory-model-implications)
8. [Interaction With Other Constructs](#interaction-with-other-constructs)
9. [Version History](#version-history)
10. [Authoritative References](#authoritative-references)

---

## Spec: For Statements with Range Clause

From the Go Programming Language Specification (<https://go.dev/ref/spec#For_range>):

> A "for" statement with a "range" clause iterates through all entries of an array, slice, string or map, or values received on a channel.

The grammar fragment relevant to channels:

```
RangeClause = [ ExpressionList "=" | IdentifierList ":=" ] "range" Expression .
```

When the expression has type `chan T` or `<-chan T`:

> For channels, the iteration values produced are the successive values sent on the channel until the channel is closed. If the channel is `nil`, the range expression blocks forever.

Two iteration values are produced per iteration only for slices, maps, strings, and arrays. **For channels, exactly one iteration value (the received value) is produced.** There is no second iteration value (no "index", no "ok") in `range` over a channel.

So the only legal forms are:

```go
for v := range ch { }   // one iteration value
for   range ch { }      // zero iteration values (ignored)
```

The form `for v, ok := range ch { }` is a compile error: range over a channel produces exactly one value.

### Semantics

The spec states (paraphrased and condensed):

1. The range expression is evaluated once before the loop begins.
2. On each iteration, a value is received from the channel.
3. The loop terminates when the channel is closed *and* no more values are pending.
4. If the channel is `nil`, the receive blocks indefinitely.

These three rules are the complete formal semantics of channel-`range`.

---

## Spec: Channel Type

From the spec (<https://go.dev/ref/spec#Channel_types>):

> A channel provides a mechanism for concurrently executing functions to communicate by sending and receiving values of a specified element type.

```
ChannelType = ( "chan" | "chan" "<-" | "<-" "chan" ) ElementType .
```

- `chan T` — bidirectional channel.
- `chan<- T` — send-only channel.
- `<-chan T` — receive-only channel.

A `range` clause can be applied to any of `chan T`, `<-chan T`. It cannot be applied to `chan<- T` because there is no receive operation available.

Channel values must be initialised with `make`:

```go
ch := make(chan int)        // unbuffered
ch := make(chan int, 100)   // buffered, capacity 100
```

An uninitialised channel is `nil` and ranging over it blocks forever (spec rule above).

---

## Spec: Receive Operator

From the spec (<https://go.dev/ref/spec#Receive_operator>):

> The expression blocks until a value is available. Receiving from a `nil` channel blocks forever. A receive operation on a closed channel can always proceed immediately, yielding the element type's zero value after any previously sent values have been received.

The two-value form:

> A receive expression used in an assignment statement or initialisation of the special form
>
> ```
> x, ok = <-ch
> x, ok := <-ch
> ```
>
> yields an additional untyped boolean result reporting whether the communication succeeded. The value of `ok` is `true` if the value received was delivered by a successful send operation, or `false` if it is a zero value generated because the channel is closed and empty.

This is the exact bool that `range` uses internally: `range` exits when `ok == false`.

### Receive on a closed channel

Spec guarantee:

- If the channel is closed *and* the buffer (if any) is empty, a receive returns immediately with the zero value of `T` and `ok = false`.
- If the channel is closed but the buffer still has values, those values are returned in FIFO order with `ok = true`, until the buffer is empty.

This is precisely why `range` "drains" the buffer before exiting: each in-flight value comes out with `ok = true`, then the next receive returns `ok = false`, and the loop exits.

---

## Spec: Close Function

From the spec (<https://go.dev/ref/spec#Close>):

> For a channel `c`, the built-in function `close(c)` records that no more values will be sent on the channel. It is an error if `c` is a receive-only channel. Sending to or closing a closed channel causes a run-time panic. Closing the nil channel also causes a run-time panic. After calling `close`, and after any previously sent values have been received, receive operations will return the zero value for the channel's type without blocking.

Key rules:

- `close` of a `nil` channel: panic.
- `close` of an already-closed channel: panic.
- Send on a closed channel: panic.
- Close on a receive-only channel: compile error.

A `range` consumer's safety depends entirely on the producer's close discipline. If the producer obeys these rules, `range` works perfectly. If it does not, the program crashes or hangs.

---

## Runtime Contract

The Go runtime implements `range` over channels via the following internal helpers (file: `runtime/chan.go`):

| Compiler emits | Runtime function | Returns |
|---|---|---|
| `v := <-ch` | `chanrecv1(ch, &v)` | (nothing) |
| `v, ok := <-ch` or `range ch` | `chanrecv2(ch, &v)` | `ok bool` |
| `ch <- v` | `chansend1(ch, &v)` | (nothing) |
| `close(ch)` | `closechan(ch)` | (nothing) |

The runtime contract:

- `chanrecv2` returns `ok = false` if and only if the channel is closed *and* its buffer is empty.
- A receive on a `nil` channel never returns (the goroutine blocks indefinitely on `gopark`).
- Receiving the zero value (e.g., `0` for `int`) when `ok = true` is legal — the producer may have sent a literal zero.
- Goroutines blocked in `chanrecv` are eligible for garbage collection only when the channel itself is unreachable. A "leaked" `range` consumer keeps its goroutine and its channel alive.

### Concurrency guarantees

`chanrecv` and `chansend` are atomic with respect to each other and to `close`. The runtime acquires the channel's internal mutex. After a successful receive, the value visible to the consumer is exactly the value the producer sent — no torn writes, no partial copies.

The Go memory model formalises this: see [Memory Model Implications](#memory-model-implications).

---

## Compile-Time Type Rules

The compiler checks:

- The expression after `range` must have type `chan T`, `<-chan T`, or `chan<- T` (the last is rejected). Other channel-shaped expressions, e.g., a pointer-to-channel, are rejected.
- The loop variable's type is `T` (the channel element type).
- Exactly one loop variable. `for v, ok := range ch` is a syntax error.

Direction-typed channels work the same:

```go
var ch <-chan int = src   // OK
for v := range ch { ... } // OK — receive-only is iterable
```

A `chan<- int` (send-only) cannot be ranged: the compiler rejects it.

### Type inference

In Go 1.18+ with generics, the element type is inferred from the channel:

```go
func consume[T any](ch <-chan T) {
    for v := range ch { // v has type T
        process(v)
    }
}
```

No explicit type annotation needed.

---

## Memory Model Implications

The Go memory model (<https://go.dev/ref/mem>) provides happens-before guarantees for channel operations:

> The kth receive on a channel with capacity C is synchronized before the (k+C)th send from that channel completes.

For `range`, this means:

- All writes performed by the sender *before* sending value `v` are visible to the receiver *after* the receive of `v` in the `range` loop body.
- A `close` synchronises with all subsequent receives: writes the closer made before `close(ch)` are visible to any consumer that observes `ok = false`.

This is why you can safely "send a struct" through a channel without additional synchronisation: the channel itself provides the memory barrier. The `range` consumer sees a fully-published value.

### Caveats

- Sharing pointers through a channel transfers nothing — both ends can still access the pointed-to data. You need explicit synchronisation or careful ownership discipline.
- Sending an interface value (which is a (type, data) pair) is atomic with respect to other channel operations but not with respect to unrelated reads/writes of the underlying data.

The memory model guarantees the *channel operation* is synchronised. What flows through the channel must be designed not to need further synchronisation, or you must add it.

---

## Interaction With Other Constructs

### Range and `break` / `continue` / `return`

- `break` exits the loop. The channel is *not* closed by the consumer. If the producer is still sending, it will block on its next send.
- `continue` skips to the next iteration. The next `chanrecv2` is invoked.
- `return` exits the enclosing function. Same caveat as `break`: producer is unaware.
- `goto` to a label outside the loop: same as `break` + that goto.

In all cases, the channel state is unchanged by the consumer's exit. Only the producer can close.

### Range and `defer`

A `defer` inside the loop body executes at the *function* return, not at each iteration. To run cleanup per iteration, write the cleanup inline or move the body into a function.

```go
for v := range ch {
    defer f(v)  // BUG: all defers run when the surrounding function returns
}
```

Fix:

```go
for v := range ch {
    func(v T) {
        defer f(v)
        process(v)
    }(v)
}
```

### Range and `select`

`range` and `select` are mutually exclusive in syntax — you cannot have a `select` *as* the loop condition. But you can have `select` *inside* the `range` body, or vice versa: a `for { select { case v, ok := <-ch: ... } }` loop is the manual equivalent of `range` plus additional cases.

### Range and `recover`

`recover` works normally inside a `range` body or in a `defer` of a goroutine that contains a `range`. A panic in the body causes the function to unwind; the channel is not closed by the consumer in any case.

---

## Version History

- **Go 1.0** — `range` over channels supported from the first release. Semantics unchanged since.
- **Go 1.4** — Compiler began using a single internal helper (`chanrecv2`) consistently for the two-value receive form, simplifying the lowering of `range`.
- **Go 1.18** — Generics arrive; `range` works over `chan T` for generic `T` without spec change.
- **Go 1.22** — `for ... range` loop variable semantics change: each iteration gets a fresh variable. For channel range, this matters only when the loop body captures `v` in a closure that lives past the iteration.
- **Go 1.23** — `range` extended to iterator functions (`iter.Seq[T]`, `iter.Seq2[K, V]`). Channel `range` semantics unchanged; the two coexist.

### The Go 1.22 loop variable change

Before Go 1.22:

```go
for v := range ch {
    go func() { use(v) }() // all goroutines share v
}
```

In Go 1.21 and earlier, all spawned goroutines might see the same `v` (the last one received). Go 1.22 makes each iteration's `v` a fresh variable, so each goroutine captures its own value.

This change does not affect the loop's own semantics — only closures escaping the loop body.

---

## Authoritative References

- The Go Programming Language Specification — *For statements*: <https://go.dev/ref/spec#For_statements>
- The Go Programming Language Specification — *Channel types*: <https://go.dev/ref/spec#Channel_types>
- The Go Programming Language Specification — *Receive operator*: <https://go.dev/ref/spec#Receive_operator>
- The Go Programming Language Specification — *Close function*: <https://go.dev/ref/spec#Close>
- The Go Memory Model: <https://go.dev/ref/mem>
- The Go Source — `runtime/chan.go`: <https://go.googlesource.com/go/+/refs/heads/master/src/runtime/chan.go>
- The Go Source — `cmd/compile/internal/walk/range.go`: <https://go.googlesource.com/go/+/refs/heads/master/src/cmd/compile/internal/walk/range.go>
- Effective Go — *Channels*: <https://go.dev/doc/effective_go#channels>
- Go 1.22 release notes — loop variable scoping: <https://go.dev/doc/go1.22#language>
- Go 1.23 release notes — range over function types: <https://go.dev/doc/go1.23#language>
- Go Blog — *Go Concurrency Patterns: Pipelines and cancellation*: <https://go.dev/blog/pipelines>
- Go Blog — *Range Over Func* (Go 1.23): <https://go.dev/blog/range-functions>

### Quick reference card

| Property | Value |
|---|---|
| Iteration values | 1 (the received value) |
| Loop variable type | element type of the channel |
| Exit condition | channel closed AND drained |
| Behaviour on `nil` channel | blocks forever |
| Behaviour on closed channel | drains buffer, then exits |
| Allowed channel direction | `chan T` or `<-chan T` (not `chan<- T`) |
| Memory model | each receive synchronises with the matching send |
| Compile target | call to `runtime.chanrecv2` |
| Spec section | <https://go.dev/ref/spec#For_range> |
