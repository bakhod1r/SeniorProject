# Channel Runtime Behaviour — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Language Spec: Channel Operations](#language-spec-channel-operations)
3. [Memory Model: Channel Synchronisation](#memory-model-channel-synchronisation)
4. [Runtime Source Comments as Spec](#runtime-source-comments-as-spec)
5. [Invariants Maintained by the Runtime](#invariants-maintained-by-the-runtime)
6. [Failure-Mode Guarantees](#failure-mode-guarantees)
7. [References](#references)

---

## Introduction

This page distinguishes what is mandated by the Go language spec (compatibility-stable across versions) from what is implementation behaviour (subject to change across releases but documented in the runtime source). Both matter, but for different reasons: spec items are what user code may rely on portably; implementation items inform debugging and performance reasoning.

---

## Language Spec: Channel Operations

The relevant section is "Channel types" and "Send statements" / "Receive operator" / "Close" / "Select statements" in <https://go.dev/ref/spec>.

### Channel types

> The channel type denotes a channel through which to send and receive values of the specified element type. The value of an uninitialized channel is `nil`.
> ChannelType = ( "chan" | "chan" "<-" | "<-" "chan" ) ElementType.

Implementation: `make(chan T, n)` calls `runtime.makechan(elemType, n)`, allocating an `hchan` plus the buffer slots.

### Send statements

> The send operation `c <- v` sends the value `v` on the channel `c`. The channel direction must permit send operations, and the type of the value must be assignable to the channel's element type. The channel and the value expression are evaluated as usual.

Crucial spec clauses:

> A send on an unbuffered channel can proceed if a receiver is ready. A send on a buffered channel can proceed if there is room in the buffer. A send on a closed channel proceeds by causing a run-time panic. A send on a nil channel blocks forever.

This maps directly to `chansend` branches:

- "Unbuffered + receiver ready" → direct hand-off path.
- "Buffered with room" → buffer-copy path.
- "Closed" → panic path.
- "Nil" → `gopark` forever.

### Receive operator

> An operation receives a value of type ElementType from a channel. The expression's type is the element type of the channel. The expression blocks until a value is available.

And:

> A receive from a nil channel blocks forever.
> A receive from a channel that has been closed and from which all sent values have been received returns immediately, yielding the zero value of the channel's element type.

Two-value form:

> The expression `x, ok := <-ch` yields an additional untyped boolean result reporting whether the communication succeeded. The value of `ok` is `true` if the value was produced by a successful send operation, or `false` if it is a zero value generated because the channel is closed and empty.

Implementation: `chanrecv` returns `(true, ok)` where `ok = mysg.success` after `gopark` returns, or `ok = (!c.closed || qcount > 0)` after the synchronous fast path.

### Close

> A built-in function `close(c)` records that no more values will be sent on the channel `c`. It is an error if `c` is a receive-only channel. Closing a nil channel or closing a closed channel causes a run-time panic. Sending to or closing a closed channel causes a run-time panic.

> The closing of a channel does not block; closing returns immediately.

> After calling close, and after any previously sent values have been received, receive operations will return the zero value for the channel's type without blocking.

Implementation: `closechan` panics on `nil` or already-closed, sets `c.closed = 1`, wakes parked goroutines.

### Select statements

> A "select" statement chooses which of a set of possible send or receive operations will proceed. It looks similar to a "switch" statement but with the cases all referring to communication operations.

> For all the cases in the statement, the channel operands of receive operations and the channel and right-hand-side expressions of send statements are evaluated exactly once, in source order, upon entering the "select" statement.

> If one or more of the communications can proceed, a single one that can proceed is chosen via a uniform pseudo-random selection. Otherwise, if there is a default case, that case is chosen. If there is no default case, the "select" statement blocks until at least one of the communications can proceed.

Implementation: `selectgo` does the Fisher-Yates shuffle of `pollorder` to implement "uniform pseudo-random selection."

> Since communication on nil channels can never proceed, a select with only nil channels and no default case blocks forever.

Implementation: a select where all cases have `cas.c == nil` and no default falls through to `gopark` with no path to wake-up.

### Type guarantees

> A channel may be constrained only to send or only to receive by assignment or explicit conversion. The conversions `chan T -> chan<- T` and `chan T -> <-chan T` are allowed.

These are compile-time only; the underlying `hchan` is identical. Implementation: the runtime functions take `*hchan` regardless of declared direction.

---

## Memory Model: Channel Synchronisation

From <https://go.dev/ref/mem>:

### Send-receive happens-before

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

Formally, write `send_k(c, v)` for the kth send on channel c and `recv_k(c)` for the kth receive. The model says:

```
send_k(c, v) happens-before completion of recv_k(c)
```

Translation: any memory write that happens-before `send_k` is observed by code running after `recv_k`.

### Buffered channel ordering

> The kth receive on a channel with capacity C is synchronized before the completion of the (k+C)th send from that channel.

For `C = 0` (unbuffered), this collapses to: `recv_k` happens-before `send_k` completion — i.e., the receive must be ready before the send returns.

For `C > 0`, the kth receive happens-before the (k+C)th send. This is the back-pressure ordering: a fast sender filling a buffer cannot get ahead of a slow receiver by more than C slots.

### Close ordering

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

Closes are observable to receivers. Specifically, the `close(c)` call happens-before any `recv` from `c` that returns `(zero, false)`.

### Implementation backing

All three happens-before edges are realised through `c.lock`:

- Send and receive both acquire/release `c.lock`. Mutex semantics give happens-before across acquire/release.
- Close holds `c.lock` while setting `closed = 1`. The next acquire of `c.lock` (in a receiver) observes the flag.
- For direct hand-off and parked-then-woken paths, the wake-up via `goready` involves an atomic CAS on `gp.atomicstatus`, which is a release/acquire pair.

---

## Runtime Source Comments as Spec

`runtime/chan.go` opens with comments describing invariants. Paraphrased:

> Invariant: at most one of `c.recvq` and `c.sendq` is non-empty at any time. If a buffered channel has both senders waiting and receivers waiting, it implies the buffer is somehow neither full nor empty — but receivers waiting means the buffer is empty, and senders waiting means it is full. Contradiction.

This is the key data-structure invariant. The code relies on it for correctness in `chansend` (we know that finding a `recvq` waiter means there is no buffered data competing with us — even though, technically, in the closed case, that invariant could be temporarily violated; but `closechan` drains both queues atomically so any post-close `chansend` returns via panic before checking queues).

> Invariant: `qcount` and `dataqsiz` define the ring buffer state. `recvx` is the next read index, `sendx` is the next write index. They satisfy `(sendx - recvx + dataqsiz) mod dataqsiz == qcount`.

This is the standard ring-buffer invariant. The runtime maintains it by always advancing `recvx` on drain and `sendx` on enqueue.

> Invariant: a sudog on `recvq` has `sg.elem` pointing into the parked goroutine's stack, where the received value will be written. A sudog on `sendq` has `sg.elem` pointing into the parked goroutine's stack, where the value to send is stored.

This is the contract for cross-stack writes. It is why `activeStackChans` is necessary.

> Invariant: while a goroutine has `activeStackChans = true`, its stack must not be relocated without adjusting its sudogs.

Enforced by `copystack` calling `adjustSudogs` when `activeStackChans` is set.

---

## Invariants Maintained by the Runtime

These are not in the language spec — they are implementation details — but they are required for the spec to hold:

1. **Closed flag is monotonic.** `c.closed` only transitions 0 → 1, never back. `closechan` is the sole writer (under `c.lock`).

2. **Wait queues are FIFO.** `enqueue` appends to the tail; `dequeue` removes from the head. Goroutines are served in the order they parked, modulo select cleanup races.

3. **No torn reads.** All access to `qcount`, `recvx`, `sendx`, `recvq`, `sendq` is under `c.lock`. Non-locked reads (in the non-blocking fast path) are accepted as racy with benign results.

4. **`sudog.success` reflects how the wake happened.** `true` if a counterparty (sender or receiver) woke us; `false` if `closechan` woke us. Set by the waker under `c.lock`.

5. **`sudog.elem` is cleared after the value is transferred.** Both `send` and `recv` helpers clear `sg.elem = nil` after the cross-stack copy. The next `acquireSudog` asserts `elem == nil`.

6. **`c.lock` is held for the entire decision/action.** Lock is taken once per top-level call; never released and re-acquired within `chansend`/`chanrecv`. Exception: in select-park, the unlock is via `selparkcommit` which is part of `gopark`'s commit callback.

7. **Element type is immutable.** `c.elemtype` is set in `makechan` and never changes. The runtime uses it for `typedmemmove` and `typedmemclr`.

---

## Failure-Mode Guarantees

### Panic semantics

| Op | Channel state | Result |
|---|---|---|
| send | closed | panic "send on closed channel" |
| close | nil | panic "close of nil channel" |
| close | already closed | panic "close of closed channel" |
| receive | closed and empty | return zero, ok=false (no panic) |
| receive | closed, buffered | drain buffer, then zero+ok=false |

All panics are at the calling goroutine, not at the goroutine that closed. The runtime issues a `panic` (not `throw`), so user code can `recover` if it must.

For parked senders that wake due to close: the panic fires *from the sender's gopark return*. The stack trace points at the original `ch <- v` call site, not at `close`. This is correct: from the sender's perspective, the send is what failed.

### Deadlock detection

The runtime's deadlock detector (in `proc.go`'s `checkdead`) fires when all goroutines are asleep. For a single-goroutine deadlock on a nil channel, the runtime prints:

```
fatal error: all goroutines are asleep - deadlock!
```

This is *not* via the channel spec — it is a debugging aid. Production servers with at least one runnable goroutine (e.g., an HTTP listener) never trigger this even if some goroutines deadlock.

### Memory ordering of panic

A panic in `chansend` after acquiring then releasing the lock means: the panicking goroutine's previous writes have synchronised through the lock release, even though the send did not complete. The next acquire of `c.lock` (by any goroutine) sees a consistent state.

---

## References

### Spec documents

- Go Language Spec, "Channel types": <https://go.dev/ref/spec#Channel_types>
- Go Language Spec, "Send statements": <https://go.dev/ref/spec#Send_statements>
- Go Language Spec, "Receive operator": <https://go.dev/ref/spec#Receive_operator>
- Go Language Spec, "Close": <https://go.dev/ref/spec#Close>
- Go Language Spec, "Select statements": <https://go.dev/ref/spec#Select_statements>
- Go Memory Model: <https://go.dev/ref/mem>

### Runtime source (Go 1.22)

- `src/runtime/chan.go` — channel operations.
- `src/runtime/select.go` — select implementation.
- `src/runtime/runtime2.go` — `hchan`, `sudog`, `waitq` definitions.
- `src/runtime/proc.go` — `gopark`, `goready`, `acquireSudog`.
- `src/runtime/lock_futex.go` — runtime mutex (Linux).
- `src/runtime/stack.go` — `copystack`, `adjustSudogs`.

### Design proposals

- Russ Cox's CSP-inspired channel design (Plan 9 history) — informs the API.
- The "select fairness" RFE: <https://github.com/golang/go/issues/21806>.
- "Why doesn't Go support reentrant locks?" applies analogously to channel double-close: <https://github.com/golang/go/issues/4373>.

### HACKING.md

`src/runtime/HACKING.md` documents scheduler invariants, GC interactions, and the cross-stack write protocol. Required reading for anyone modifying the channel runtime.

### Articles

- "Go channels," Vincent Blanchon: <https://medium.com/a-journey-with-go>
- "Concurrency in Go," Katherine Cox-Buday — Chapter 3 covers channel semantics; Appendix covers runtime considerations.
- Russ Cox, "Bell Labs and CSP Threads": <https://swtch.com/~rsc/thread/> — historical context for channels in Go.
- The Go Blog, "Share Memory By Communicating": <https://go.dev/blog/codelab-share>.
