# Send/Receive Flow — Specification Level

## Table of Contents
1. [Introduction](#introduction)
2. [Language Specification](#language-specification)
3. [Compiler Contract](#compiler-contract)
4. [Runtime Contract](#runtime-contract)
5. [Memory Model Guarantees](#memory-model-guarantees)
6. [Invariants of `chansend`](#invariants-of-chansend)
7. [Invariants of `chanrecv`](#invariants-of-chanrecv)
8. [Direct Handoff Invariants](#direct-handoff-invariants)
9. [Closed-Channel Semantics](#closed-channel-semantics)
10. [Select Interaction](#select-interaction)
11. [Cross-References](#cross-references)
12. [Summary](#summary)

---

## Introduction

This file catalogues the formal contracts that govern the send/receive flow: what the Go language specification promises, what the compiler must lower to, what the runtime must implement, and what guarantees the memory model provides. Everything else in this subsection is implementation; this file is the contract.

References:

- Go Language Specification (golang.org/ref/spec) — sections on channel types, send statements, receive operations.
- The Go Memory Model (golang.org/ref/mem) — channel synchronisation.
- `runtime/chan.go` documentation comments — implementation contract.

---

## Language Specification

### Channel types

> A channel provides a mechanism for concurrently executing functions to communicate by sending and receiving values of a specified element type.
>
> The value of an uninitialized channel is nil.

```
ChannelType = ( "chan" | "chan" "<-" | "<-" "chan" ) ElementType .
```

### Send statement

> A send statement sends a value on a channel. The channel expression's core type must be a channel, the channel direction must permit send operations, and the type of the value to be sent must be assignable to the channel's element type.
>
> Both the channel and the value expression are evaluated before communication begins. Communication blocks until the send can proceed. A send on an unbuffered channel can proceed if a receiver is ready. A send on a buffered channel can proceed if there is room in the buffer. A send on a closed channel proceeds by causing a run-time panic. A send on a nil channel blocks forever.

```
SendStmt = Channel "<-" Expression .
Channel  = Expression .
```

### Receive operator

> For an operand `ch` of channel type, the value of the receive operation `<-ch` is the value received from the channel `ch`. The channel direction must permit receive operations, and the type of the receive operation is the element type of the channel. The expression blocks until a value is available. Receiving from a nil channel blocks forever. A receive operation on a closed channel can always proceed immediately, yielding the element type's zero value after any previously sent values have been received.
>
> A receive expression used in an assignment or initialization of the special form
>
> `x, ok = <-ch`
> `x, ok := <-ch`
> `var x, ok = <-ch`
> `var x, ok T = <-ch`
>
> yields an additional untyped boolean result reporting whether the communication succeeded. The value of `ok` is `true` if the value received was delivered by a successful send operation to the channel, or `false` if it is a zero value generated because the channel is closed and empty.

### Implications for the flow

These spec excerpts pin down:

- Blocking semantics: an unbuffered send blocks until a receiver, a buffered send blocks until buffer has room, a receive blocks until value available.
- Panic on send-to-closed.
- Zero + `ok=false` on receive-from-closed-empty.
- Nil channel blocks forever.

---

## Compiler Contract

The compiler, when encountering a channel expression, must lower it to one of these runtime calls:

| Source | Lowered to | Notes |
|---|---|---|
| `ch <- v` | `runtime.chansend1(ch, &v)` | `v` evaluated to a stack temp first; the address is passed |
| `v := <-ch` | `runtime.chanrecv1(ch, &v)` | `v` must be an addressable destination |
| `v, ok := <-ch` | `ok := runtime.chanrecv2(ch, &v)` | Two-result form |
| `close(ch)` | `runtime.closechan(ch)` | (handled in its own subsection) |
| `select { case ... }` | `runtime.selectgo(...)` | Multi-channel form |

Additional compiler contracts:

- The address passed to the runtime must be valid for the duration of the call. The compiler must keep the value alive (escape analysis must keep the temp live).
- For struct-valued sends, the temp may be on the stack or the heap depending on escape analysis. The pointer is what matters.
- The compiler must emit `KeepAlive`-equivalent semantics where needed (the runtime itself uses `KeepAlive` internally).

### `//go:nosplit` requirement

`chansend1`, `chanrecv1`, and `chanrecv2` are marked `//go:nosplit`. This means:

- The compiler must not insert a stack-growth check at function entry.
- These functions must do minimal work (no allocations that could grow the stack) until they call the worker.

This is a contract between the language and the runtime: the wrappers are part of the runtime, not user code.

---

## Runtime Contract

The runtime functions `chansend`, `chanrecv`, `send`, `recv`, `closechan` must satisfy:

### `chansend(c, ep, block, callerpc) bool`

Postconditions when returning `true`:

- The value pointed to by `ep` has been transferred to either:
  - The channel's buffer (and `c.qcount` increased), or
  - A receiver's destination (and that receiver has been `goready`d).
- The channel lock is not held.

Postconditions when returning `false`:

- No value transfer occurred.
- `block == false` (the caller is a non-blocking case from `select`).
- The channel lock is not held.

Panic conditions:

- `c.closed != 0` at the moment of the closed check (either inline or after wake from park).
- Never panics if `c == nil`; instead blocks forever.

### `chanrecv(c, ep, block) (selected, received bool)`

Postconditions when returning `(true, true)`:

- A value was transferred from either a sender's `sudog.elem` or `buf[recvx]` into `*ep` (if `ep != nil`).
- If from buffer: `c.qcount` decremented; if from sender: sender `goready`d.
- The channel lock is not held.

Postconditions when returning `(true, false)`:

- The channel is closed and the buffer is empty.
- `*ep` has been cleared to the zero value (`typedmemclr`), if `ep != nil`.
- The channel lock is not held.

Postconditions when returning `(false, false)`:

- No value transfer occurred.
- `block == false`.
- The channel lock is not held.

### `send(c, sg, ep, unlockf, skip)`

Preconditions:

- `c` is locked.
- `sg` has been dequeued from `c.recvq`.
- `ep` is non-nil and points to a valid value of `c.elemtype`.

Postconditions:

- Value at `*ep` has been copied to `*sg.elem`.
- `sg.elem = nil`.
- `sg.success = true`.
- `unlockf` has been called (channel lock released).
- `sg.g` has been `goready`d.

### `recv(c, sg, ep, unlockf, skip)`

Preconditions:

- `c` is locked.
- `sg` has been dequeued from `c.sendq`.

Postconditions:

- For unbuffered (`c.dataqsiz == 0`): value at `*sg.elem` copied to `*ep`.
- For buffered: `*ep = buf[recvx]`; `buf[recvx] = *sg.elem`; indices advanced.
- `sg.elem = nil`, `sg.success = true`.
- `unlockf` called, `sg.g` readied.

---

## Memory Model Guarantees

From the Go Memory Model:

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

Formally, in `runtime/chan.go`:

- The send completes its `typedmemmove` (into buffer or into receiver) under `c.lock`.
- The receive does its read of the value under `c.lock` (buffered case) or after `goready` (handoff case).
- Lock acquire-release semantics ensure all writes by sender before unlock are visible to receiver after lock.

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

- `closechan` sets `c.closed = 1` under `c.lock`.
- `chanrecv` reads `c.closed` under `c.lock` (or with `atomic.Load` on the fast path).

> A receive from an unbuffered channel is synchronized before the completion of the corresponding send on that channel.

- This is the *reverse* direction from buffered.
- For unbuffered direct handoff, the sender and receiver synchronize via the same `c.lock` and the wake event.

> The k-th receive on a channel with capacity C is synchronized before the completion of the (k+C)-th send from that channel.

- This is the "buffer of C" rule. The buffer slots act as the synchronization medium.

### What is NOT guaranteed

- Order across multiple channels. If goroutine A sends on `ch1` then on `ch2`, a receiver on `ch2` is not guaranteed to see the send on `ch1` happened first (unless other synchronization is present).
- The exact time at which the receiver runs after the wake. The scheduler may delay.

---

## Invariants of `chansend`

The runtime maintains the following invariants in `chansend`:

1. **Lock invariant**: every read or write to `hchan` fields (except the fast-path `c.closed == 0 && full(c)` lock-free probe) is done under `c.lock`.

2. **Closed monotonicity**: once `c.closed = 1`, it never reverts to 0. Therefore observing `c.closed == 0` and later `c.closed == 1` is consistent with a single close event in between.

3. **Queue exclusivity**: at most one of `c.recvq` and `c.sendq` is non-empty at any time when the lock is held. (Both could be non-empty momentarily between two lock acquisitions, but the invariant is restored on the next chansend or chanrecv.)

4. **Buffer-full implies sendq-could-be-non-empty**: if `c.qcount == c.dataqsiz` and `c.dataqsiz > 0`, the next send will park onto `c.sendq` (unless preempted by a receiver running first).

5. **Sudog elem stability**: while a sudog is on `c.recvq` or `c.sendq`, `sg.elem` points to a valid memory location (either a stack frame or a heap value), and that memory does not move except via `adjustsudogs` under the appropriate locks.

6. **success-flag semantics**: when a parked sender is woken, `sg.success == true` means the value was transferred; `sg.success == false` means the channel was closed and the sender must panic.

---

## Invariants of `chanrecv`

1. **Same lock invariant** as `chansend`.

2. **Closed-empty short-circuit**: when `c.closed != 0 && c.qcount == 0`, `chanrecv` must return `(true, false)` without parking, after writing the zero value to `*ep`.

3. **Drain-before-zero**: when `c.closed != 0 && c.qcount > 0`, `chanrecv` must drain the buffer normally. Subsequent receives drain remaining buffered values. Only when `qcount == 0` is the zero-value path taken.

4. **Sender promotion** for buffered: when receiving from a buffered channel with a parked sender, the receiver must:
   - Read `buf[recvx]` into the receiver's destination.
   - Write the sender's value into `buf[recvx]`.
   - Advance `recvx` (and conceptually `sendx` since the buffer rotated).

5. **Receiver promotion invariant**: a receiver can only find a sender on `c.sendq` if the buffer was full (or the channel is unbuffered). If `qcount < dataqsiz`, no sender would have parked.

6. **success-flag semantics**: when a parked receiver is woken, `sg.success == true` means a real value was received (`received == true`); `sg.success == false` means the channel was closed (`received == false`).

---

## Direct Handoff Invariants

The "direct handoff" is the runtime's name for the path where a value moves directly between two goroutines' stacks without going through the buffer.

Invariants:

1. **Locked invariant**: the handoff (`sendDirect`/`recvDirect`) is done with `c.lock` held.

2. **Stack stability**: the source and destination stacks do not move during the `memmove`. This is guaranteed because:
   - Both goroutines are in the runtime (one running, one parked).
   - Stack movement requires acquiring `c.lock` first (via `adjustsudogs`'s precondition).
   - Therefore stack movement is blocked while we hold the lock.

3. **GC write barrier invariant**: `typeBitsBulkBarrier` is called before `memmove` to inform the GC of pointer writes in the destination. The barrier handles the unusual case of writing into another goroutine's stack.

4. **Single-step transfer**: there is exactly one `memmove` per handoff. The buffer is never touched for direct handoff on unbuffered channels.

5. **Wake-after-unlock**: `goready(sg.g)` is called *after* `unlockf()`. This avoids holding `c.lock` across a scheduler operation that may take other locks (deadlock prevention).

---

## Closed-Channel Semantics

Formally:

| State | Send | Recv (no ok) | Recv (with ok) |
|---|---|---|---|
| Open, value available | succeeds | succeeds with value | succeeds with `(value, true)` |
| Open, no value | blocks | blocks | blocks |
| Closed, buffer non-empty | panic | succeeds with value | succeeds with `(value, true)` |
| Closed, buffer empty | panic | returns zero | returns `(zero, false)` |
| Nil channel | blocks forever | blocks forever | blocks forever |

The implementation in `chansend`:

```go
if c.closed != 0 {
    unlock(&c.lock)
    panic(plainError("send on closed channel"))
}
```

The implementation in `chanrecv`:

```go
if c.closed != 0 {
    if c.qcount == 0 {
        unlock(&c.lock)
        if ep != nil {
            typedmemclr(c.elemtype, ep)
        }
        return true, false
    }
    // fall through to normal receive
}
```

A subtle invariant: a sender that parks on `sendq`, then is woken by `closechan`, panics. The `closechan` code:

```go
sg := c.sendq.dequeue()
sg.success = false  // signals "closed"
goready(sg.g)
```

The sender wakes and checks:

```go
closed := !mysg.success
if closed {
    panic(plainError("send on closed channel"))
}
```

This is why "close while senders are parked" is unsafe — the senders panic on resumption.

---

## Select Interaction

A `select` statement compiles to `runtime.selectgo`, which manages an array of `scase` records. Each case can be a send or receive on a channel.

`selectgo`'s contract:

1. **Random ordering**: cases are evaluated in a random order (not source order) to provide fairness.
2. **Two-phase execution**:
   - Phase 1: try every case non-blocking. If any succeeds, return that case index.
   - Phase 2: if no case succeeded and no default, register on every case's channel queue (via per-case sudogs), `gopark`. When woken, find which case fired, unregister from the rest.
3. **Atomicity**: the select either fires exactly one case or hits default. Two cases never fire from a single select.
4. **Send/Recv composability**: a `case` send goes through `chansend(c, ep, false)`; a `case` receive goes through `chanrecv(c, ep, false)`. The shared `send`/`recv` helpers handle the parking-side logic identically.

For our purposes, every send and receive that happens through `select` goes through the same send/receive flow described in this subsection. The difference is the non-blocking probe (`block == false`) and the multi-channel parking.

---

## Cross-References

- Channel data structure: see `09-channel-internals/01-hchan-struct`.
- Buffer mechanics: see `09-channel-internals/03-buffer-mechanics`.
- Closing channels: see `02-channels/06-closing-channels`.
- Select statement: see `04-select` (in the same `07-concurrency` chapter).
- Memory model: see `07-concurrency/08-memory-model`.
- Scheduler (gopark/goready, runqueues): see `01-goroutines/03-scheduler-model`.
- Race detector: see `07-tooling/04-race-detector`.

---

## Summary

The send/receive flow is the cooperation between three layers:

1. **Language spec**: defines blocking semantics, panic conditions, closed-channel behaviour, and the comma-ok form.
2. **Compiler**: lowers `ch <- v`, `<-ch`, `v, ok := <-ch` to runtime calls `chansend1`, `chanrecv1`, `chanrecv2`. Marks them `//go:nosplit`. Materialises values to stack temps and passes pointers.
3. **Runtime**: implements `chansend` and `chanrecv` as locked state machines with three paths (direct handoff, buffer, park). Implements `send` and `recv` helpers for the cross-stack handoff. Provides `gopark` / `goready` for blocking.

Memory model: sends synchronize-before receives (for buffered, via lock; for unbuffered, via lock + wake). Close synchronize-before observation of close.

Invariants are dense: lock around every field access, closed flag monotonicity, sudog stability while parked, GC write barriers for cross-stack writes, deferred wake (after unlock).

Together, these contracts make `ch <- v` a single line of Go that hides about a hundred lines of runtime cooperation — and that cooperation must hold its invariants under every concurrency interleaving the scheduler can produce.
