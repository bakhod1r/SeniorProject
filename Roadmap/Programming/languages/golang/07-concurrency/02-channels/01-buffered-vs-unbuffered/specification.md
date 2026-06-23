# Buffered vs Unbuffered Channels — Specification

> Excerpts and paraphrases from the **Go Programming Language Specification** (latest, currently aligned with Go 1.22+) covering channel types, send statements, receive expressions, the `close` built-in, and the memory model. Where the spec is concise, this page expands with notes useful for reading runtime source.

---

## Channel types

> **ChannelType** = ( `"chan"` \| `"chan" "<-"` \| `"<-" "chan"` ) ElementType .

A channel type denotes a typed conduit for communication of values between goroutines. The *element type* is the type of values that may be sent and received. A channel may be:

- **Bidirectional** (`chan T`): both send and receive are permitted.
- **Send-only** (`chan<- T`): only `ch <- v` is permitted.
- **Receive-only** (`<-chan T`): only `<-ch` is permitted.

The arrow `<-` in `chan<-` and `<-chan` is part of the type and binds to the leftmost `chan` keyword for which it is unambiguous; for clarity, parenthesise nested types: `chan (<-chan T)`.

A bidirectional channel value is assignable to both directional channel types of the same element type; the reverse is not true.

### Examples (from the spec, verbatim style)

```go
chan T         // bidirectional
chan<- float64 // send-only
<-chan int     // receive-only
```

A nil channel value has type `chan T` for some `T` and the value `nil`. All channel operations on a nil channel block forever.

---

## Channel value creation: `make`

> The built-in function `make` takes a type `T`, optionally followed by a type-specific list of expressions. It returns a value of type `T` (not `*T`).

For channels:

> `make(chan T)`              — creates an unbuffered channel of element type `T`.
> `make(chan T, n)`           — creates a buffered channel with capacity `n`. `n` must be a non-negative integer constant or value; if `n == 0` the channel is unbuffered.

The capacity is fixed at creation. The expression `cap(ch)` returns it. The expression `len(ch)` returns the number of elements currently buffered (always `0` for unbuffered channels at rest).

`make` itself does not block. The returned value is comparable; a zero-value channel variable equals `nil`.

---

## Send statements

> **SendStmt** = Channel `"<-"` Expression .
> Channel = Expression .

A send statement evaluates `Channel` and `Expression`. Both must evaluate to typed values; the channel's element type must be assignable to the value being sent. The communication blocks until the send can proceed.

For *unbuffered* channels, the send completes when a receiver is ready; the value is transferred.

For *buffered* channels with at most `cap(ch) - 1` elements buffered, the send copies the value into the channel buffer and proceeds without blocking.

For *buffered* channels with `cap(ch)` elements buffered, the send blocks until an element is removed.

Sending on a nil channel blocks forever. Sending on a closed channel **panics** with the message *"send on closed channel."*

Send statements are statements, not expressions: their result cannot be used.

---

## Receive expressions

> **Receive Expression** = `"<-"` Channel .

The expression `<-ch` is valid for any channel `ch` of channel type that allows receiving (i.e., not `chan<- T`). Its type is the element type. Evaluation:

- Blocks until a value is available.
- Returns the value taken from the channel.

The two-value form:

> `x, ok := <-ch`

returns the received value and a boolean. `ok` is `true` if the value was produced by a send (via the buffer or a hand-off), and `false` if the channel is closed and empty. In the latter case, the returned value is the zero value of the element type.

Receiving from a nil channel blocks forever.

A receive on a closed channel never panics.

---

## The `close` built-in

> The built-in function `close(c chan<- T)` records that no more values will be sent on the channel.

Constraints:

- `c` must be a chan or send-only chan; receive-only is a compile error.
- `c` must not be `nil`; closing nil panics with *"close of nil channel."*
- `c` must not have been closed already; closing twice panics with *"close of closed channel."*

After close:

- Receivers continue to receive any buffered values.
- Once buffered values are drained, further receives return the zero value with `ok == false`.
- Sends panic.
- `len(c)` reports the count of remaining buffered values (drains as receivers consume).
- `cap(c)` is unchanged.

---

## The memory model — channel rules

The Go memory model defines, for channels, two synchronisation arcs:

1. **A send on a channel is synchronised before the completion of the corresponding receive.**

2. **The closing of a channel is synchronised before a receive that returns because the channel is closed.**

A "corresponding" send and receive are paired by FIFO order on a buffered channel, and by simultaneous rendezvous on an unbuffered channel.

Both arcs imply that all writes that happen-before the send (or the close) happen-before any read after the receive that pairs with it.

Consequences:

- An unbuffered send blocks until receiver picks the value up; the synchronisation is two-sided rendezvous.
- A buffered send returns when the value is enqueued; the synchronisation is *between this send and the matching receive*, not all later receives.
- Closing a channel is observable to all receivers as the channel becoming "drained, with `ok == false`."

The spec also notes that a `for ... range` over a channel terminates when the channel is closed and drained, and that the index variable is reused; no extra synchronisation guarantees are introduced beyond those of the receive operations themselves.

---

## `len` and `cap` on channels

> `len(s)` and `cap(s)` are defined for channel `s` of any channel type:
>
> - `len(s)`: number of elements queued in channel buffer.
> - `cap(s)`: channel buffer capacity, in units of elements.

For unbuffered channels both are zero. The values are *snapshots* and are subject to change immediately after the call returns; do not rely on them for synchronisation.

---

## Channel direction conversion

> A value `v` of type `chan T` may be implicitly converted to `chan<- T` or `<-chan T`. The reverse direction is not permitted.

The compiler enforces this at every send/receive site:

```go
func produce(out chan<- int) {
    out <- 1     // ok
    <-out        // compile error: out is send-only
}
```

This is the spec hook that lets functions advertise read-only or write-only access to a channel without dynamic checks.

---

## Behaviour summary table (from the spec, paraphrased)

| Operation | Channel state | Result |
|-----------|---------------|--------|
| Send | open, unbuffered, receiver ready | value transfers, both proceed |
| Send | open, unbuffered, no receiver | block |
| Send | open, buffered, room | enqueue, proceed |
| Send | open, buffered, full | block |
| Send | closed | panic *"send on closed channel"* |
| Send | nil | block forever |
| Recv | open, unbuffered, sender ready | value transfers, both proceed |
| Recv | open, unbuffered, no sender | block |
| Recv | open, buffered, has data | dequeue, proceed |
| Recv | open, buffered, empty | block |
| Recv | closed, has buffered data | dequeue, proceed |
| Recv | closed, empty | return zero, `ok == false` |
| Recv | nil | block forever |
| Close | open | wake all waiters; subsequent sends panic |
| Close | closed | panic *"close of closed channel"* |
| Close | nil | panic *"close of nil channel"* |

---

## Notes for implementers and reviewers

- A channel's buffer is *strictly* a FIFO queue. Reordering is not permitted.
- The spec does not mandate a particular implementation (a ring buffer, a linked list, a hand-off optimisation), only that observable behaviour matches the rules above.
- The `gc` toolchain's runtime uses a ring buffer plus parked-goroutine queues; alternative implementations have used different layouts but produce identical observable behaviour.
- The spec says nothing about scheduling fairness among multiple receivers waiting on the same channel. The reference runtime uses FIFO queues, which gives a strong "first parked, first served" property; programs should not depend on this for correctness.
- The spec says nothing about how `close` interacts with `select`; that is defined in the `select` rules, which appear in a separate section of the spec.

---

## Worked example: matching the spec to runtime behaviour

The following is the *spec-level* explanation of why this code works:

```go
ch := make(chan int)
go func() {
    ch <- 42
}()
v := <-ch
```

By the send/receive semantics: the send blocks until a receiver is ready; the receiver blocks until a sender is ready. Both goroutines reach their respective channel ops; one transfer happens; both unblock.

By the memory model: the send is synchronised-before the matching receive, so any write the goroutine did before sending (none in this trivial example) is visible to `main` after the receive.

By `len`/`cap`: `cap(ch) == 0`; `len(ch) == 0` always. The value never sits in a buffer.

By close: nothing in this example. If we had written `close(ch)` after the send, a subsequent `<-ch` would return `0, false`.

This is the entire channel-related section of the spec for a textbook example. Real-world correctness arguments compose these few rules, recursively, across many channel operations.
