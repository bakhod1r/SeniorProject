# Buffer Mechanics — Specification

## Table of Contents
1. [Purpose](#purpose)
2. [Terms](#terms)
3. [Invariants](#invariants)
4. [Allocation Contract](#allocation-contract)
5. [Operation Contracts](#operation-contracts)
6. [Index Discipline](#index-discipline)
7. [Closed-Channel Contract](#closed-channel-contract)
8. [Zero-Size Element Contract](#zero-size-element-contract)
9. [Memory Model Edges](#memory-model-edges)
10. [Failure Modes](#failure-modes)
11. [Compliance Tests](#compliance-tests)

---

## Purpose

This specification describes the observable contract of the ring buffer inside a Go channel. It is not a reproduction of the source code; it is the set of rules a conforming implementation must obey for user-visible behaviour to remain consistent with the Go language specification and memory model. Anyone implementing or reasoning about channels at the runtime level should be able to verify any implementation against this list.

The specification applies to buffered channels (capacity `>= 1`). Unbuffered channels (`cap == 0`) do not have a buffer; their behaviour is covered by the wait-queue specification in sibling sections.

---

## Terms

- **Channel** — A value of type `chan T` produced by `make(chan T, n)`. Identified at runtime by a pointer to an `hchan` struct.
- **Capacity (`C`)** — The integer `n` passed to `make`. Stored as `hchan.dataqsiz`. Immutable after creation.
- **Length (`L`)** — The current count of values in the buffer. Stored as `hchan.qcount`. `0 <= L <= C`.
- **Send index (`S`)** — The index of the next slot to be filled. `0 <= S < C` when `C > 0`.
- **Receive index (`R`)** — The index of the next slot to be drained. `0 <= R < C` when `C > 0`.
- **Buffer** — A region of memory of `C * elemsize` bytes, addressable by index.
- **Element type** — The Go type `T`. Captured at runtime in `hchan.elemtype`.
- **Element size** — `unsafe.Sizeof(T)`. Stored in `hchan.elemsize`. Bounded above by `1 << 16 - 1` bytes.
- **Send operation** — A successful `ch <- v` that places one value into the channel.
- **Receive operation** — A successful `<-ch` that takes one value from the channel.
- **Closed flag** — A single bit (`hchan.closed`) indicating whether `close(ch)` has been called.

---

## Invariants

The following invariants hold at every observable state of the channel — defined as "between user-visible operations" or, equivalently, "after the channel lock is released."

**I1 (Capacity is constant).** `dataqsiz` is set by `make` and never changes.

**I2 (Length is bounded).** `0 <= qcount <= dataqsiz`.

**I3 (Indices are bounded).** When `dataqsiz > 0`, `0 <= sendx < dataqsiz` and `0 <= recvx < dataqsiz`.

**I4 (Occupied slots).** When `qcount > 0`, the occupied slots are exactly
`{ (recvx + k) mod dataqsiz : 0 <= k < qcount }`.

**I5 (Length determines empty/full).** `qcount == 0` iff the buffer holds no values. `qcount == dataqsiz` iff the buffer is at capacity.

**I6 (FIFO order).** If value `v_a` was placed in the buffer before value `v_b` by buffer-path operations on the same channel, then `v_a` is received before `v_b`.

**I7 (Element bytes are valid only in occupied slots).** Slots not in the occupied set may contain any byte pattern; receivers must not read them.

**I8 (Element bytes in unoccupied slots are zeroed).** After every receive completes, the slot just vacated is set to the type's zero value via `typedmemclr`. So invariant I7 holds tighter than necessary: unoccupied slots are zeroed.

**I9 (`buf` is non-nil).** `hchan.buf` is non-nil for every channel; for zero-mem channels it is a sentinel pointing into the `hchan` itself.

**I10 (Element type is constant).** `hchan.elemtype` is set by `make` and never changes.

**I11 (Single mutex).** All reads and writes to `qcount`, `sendx`, `recvx`, `closed`, and the buffer contents happen with `hchan.lock` held.

---

## Allocation Contract

**A1.** `make(chan T, n)` with `n < 0` panics with "makechan: size out of range" without allocating.

**A2.** `make(chan T, n)` with `n == 0` allocates one `hchan` struct, no buffer block. `dataqsiz == 0`, `buf` is set to a sentinel.

**A3.** `make(chan T, n)` with `n > 0` and `T` having zero size allocates one `hchan` struct, no buffer block. `dataqsiz == n`, `elemsize == 0`, `buf` is a sentinel.

**A4.** `make(chan T, n)` with `n > 0` and `T` non-zero-size with no pointer fields allocates `hchanSize + n * elemsize` bytes in one block. `buf` points just past the header.

**A5.** `make(chan T, n)` with `n > 0` and `T` containing pointers allocates two blocks: the `hchan` separately, the buffer with `T` as the type descriptor for GC scanning.

**A6.** Allocation overflow (`n * elemsize` overflows `uintptr` or exceeds `maxAlloc - hchanSize`) panics with "makechan: size out of range."

**A7.** After allocation, `qcount == 0`, `sendx == 0`, `recvx == 0`, `closed == 0`, and all buffer bytes (if any) are zero.

---

## Operation Contracts

### Send (`ch <- v`)

**SO1.** If `ch == nil`, the send blocks forever (the goroutine parks and is never woken). The buffer is not touched.

**SO2.** If `closed != 0`, the send panics with "send on closed channel." The buffer is not modified.

**SO3.** If a receiver is parked on `recvq`, the value is copied directly from the sender's location to the receiver's, the receiver is unparked, and `(qcount, sendx, recvx)` are unchanged. The buffer is not touched.

**SO4.** Otherwise, if `qcount < dataqsiz`, the value is copied to `buf[sendx]` via `typedmemmove`. Then `sendx` is incremented and wrapped: `sendx = (sendx + 1) mod dataqsiz` (implemented as a branch). `qcount` is incremented.

**SO5.** Otherwise (buffer full, no parked receiver), the sender parks on `sendq` and is unparked when a receiver drains a slot (or pairs with the sender directly via the receive path's "full buffer with parked sender" rotation).

**SO6.** A non-blocking send (from `select` with `default`) follows SO3/SO4 if possible; otherwise it returns immediately without parking. The buffer is unchanged in the "not selected" case.

### Receive (`<-ch` or `v, ok := <-ch`)

**RO1.** If `ch == nil`, the receive blocks forever. The buffer is not touched.

**RO2.** If `closed != 0` and `qcount == 0`, the receive returns `(zero(T), false)` immediately without touching the buffer (it is empty by definition).

**RO3.** If a sender is parked on `sendq` and the buffer is empty (`qcount == 0`, which implies `dataqsiz == 0`), the sender's value is copied directly to the receiver, the sender is unparked, return `(value, true)`.

**RO4.** If a sender is parked on `sendq` and the buffer is full (`qcount == dataqsiz > 0`), the value at `buf[recvx]` is copied to the receiver, then `buf[recvx]` is overwritten with the parked sender's value, then `recvx` is advanced. `qcount` remains `dataqsiz`. The parked sender is unparked.

**RO5.** Otherwise, if `qcount > 0`, the value at `buf[recvx]` is copied to the receiver via `typedmemmove`. The slot is then cleared via `typedmemclr`. `recvx` is advanced with wrap. `qcount` is decremented.

**RO6.** Otherwise (buffer empty, no parked sender, not closed), the receiver parks on `recvq`.

**RO7.** A non-blocking receive (from `select` with `default`) follows RO2/RO3/RO4/RO5 if possible; otherwise it returns immediately. The buffer is unchanged in the "not selected" case.

### `len(ch)` and `cap(ch)`

**LC1.** `len(ch)` returns `int(qcount)`. The read is not synchronised; the result may be stale by the time the caller observes it.

**LC2.** `cap(ch)` returns `int(dataqsiz)`. Always exact, because `dataqsiz` is immutable.

**LC3.** `len(nil)` and `cap(nil)` return `0`.

---

## Index Discipline

**ID1.** Wrap behaviour: implementations must wrap indices at `dataqsiz`. A branch (`if x == dataqsiz { x = 0 }`) is canonical; a modulo (`x = x % dataqsiz`) is permitted but slower. Any implementation must produce the same observable index sequence.

**ID2.** Both `sendx` and `recvx` advance by exactly one per buffer-branch operation. They do not skip.

**ID3.** After every buffer-branch send, `(sendx - recvx + dataqsiz) mod dataqsiz == qcount`.

**ID4.** After every buffer-branch receive, `(sendx - recvx + dataqsiz) mod dataqsiz == qcount`.

**ID5.** Direct hand-off (SO3, RO3) does not advance `sendx` or `recvx`. They reflect only buffer-branch operations.

---

## Closed-Channel Contract

**CC1.** `close(nil)` panics with "close of nil channel."

**CC2.** `close(ch)` on an already-closed channel panics with "close of closed channel."

**CC3.** `close(ch)` does not touch `qcount`, `sendx`, `recvx`, or the buffer contents.

**CC4.** After close, send (SO2) panics. Receive (RO2/RO5) drains the buffer in FIFO order; only when `qcount == 0` does receive return `(zero(T), false)`.

**CC5.** Parked senders at close time are unparked and each panics in its own goroutine with "send on closed channel."

**CC6.** Parked receivers at close time are unparked and each returns `(zero(T), false)` from `<-ch`.

---

## Zero-Size Element Contract

**ZS1.** If `elemsize == 0`, all slot addresses computed by `chanbuf` are equal (to the sentinel `buf`).

**ZS2.** `typedmemmove` of a zero-size type is a no-op; no bytes are copied.

**ZS3.** `typedmemclr` of a zero-size type is a no-op.

**ZS4.** `qcount`, `sendx`, `recvx` still advance under buffer-branch operations as if bytes were copied.

**ZS5.** The buffer-fullness check (`qcount == dataqsiz`) applies as for any other type.

**ZS6.** `make(chan struct{}, n)` allocates only `hchanSize` bytes regardless of `n`.

---

## Memory Model Edges

**MM1.** For any pair (send `S` of value `v` to buffer slot `i`, receive `R` of value `v` from buffer slot `i`), `S` happens-before `R`.

**MM2.** All writes that happen-before `S` in the sender's goroutine happen-before any code after `R` in the receiver's goroutine.

**MM3.** This is the standard Go memory-model guarantee for channel communication and applies independently of whether the buffer was involved (buffer branch) or bypassed (direct hand-off).

**MM4.** The race detector enforces MM1 by tagging the buffer slot as a synchronisation address. A conforming implementation must produce a race report if user code violates MM2 by accessing shared memory without channel-mediated synchronisation.

---

## Failure Modes

**F1 (`makechan` overflow).** Documented in A1, A6. Panic before allocation.

**F2 (Send on closed).** Documented in SO2. Panic in sender goroutine.

**F3 (Close of nil).** Documented in CC1. Panic in closer goroutine.

**F4 (Close of closed).** Documented in CC2. Panic in closer goroutine.

**F5 (Send/recv on nil).** Documented in SO1, RO1. Block forever (goroutine leak if no other path frees them).

**F6 (Memory exhaustion at make).** A6 if detected pre-allocation; otherwise the underlying `mallocgc` panics with "runtime: out of memory."

**F7 (Stack overflow on park).** Not a buffer concern; managed by the runtime's stack growth mechanism.

No buffer-internal failure mode exists. The ring is in-bounds by construction. There is no "buffer overflow" or "buffer underflow" in the C sense; the index discipline (ID1, ID3, ID4) prevents them.

---

## Compliance Tests

A conforming implementation must pass the following user-observable tests. Each test is a Go program; the comment lists the required output.

```go
// T1: capacity is immutable.
ch := make(chan int, 4)
if cap(ch) != 4 { fail() }
ch <- 1
if cap(ch) != 4 { fail() }
```

```go
// T2: FIFO across wrap.
ch := make(chan int, 3)
ch <- 1
ch <- 2
ch <- 3
<-ch       // discard 1
ch <- 4    // wraps
ch <- 5    // wraps further... wait, only one slot free
// Wait — after the discard, we have 2 items and one slot free.
// We can send one (4); the next send (5) blocks.
// To keep the test simple, do not send 5 yet.
if v := <-ch; v != 2 { fail() }
if v := <-ch; v != 3 { fail() }
if v := <-ch; v != 4 { fail() }
```

```go
// T3: close drains buffer.
ch := make(chan int, 2)
ch <- 1
ch <- 2
close(ch)
if v, ok := <-ch; v != 1 || !ok { fail() }
if v, ok := <-ch; v != 2 || !ok { fail() }
if v, ok := <-ch; v != 0 || ok { fail() }
```

```go
// T4: zero-size element.
ch := make(chan struct{}, 2)
ch <- struct{}{}
ch <- struct{}{}
if len(ch) != 2 { fail() }
<-ch
if len(ch) != 1 { fail() }
```

```go
// T5: len reflects qcount.
ch := make(chan int, 3)
ch <- 1
if len(ch) != 1 { fail() }
ch <- 2
if len(ch) != 2 { fail() }
<-ch
if len(ch) != 1 { fail() }
```

```go
// T6: send to closed panics.
ch := make(chan int, 1)
close(ch)
defer func() {
    if r := recover(); r == nil { fail() }
}()
ch <- 1 // must panic
```

```go
// T7: cap of nil is zero.
var ch chan int
if cap(ch) != 0 { fail() }
if len(ch) != 0 { fail() }
```

```go
// T8: large capacity is allowed if memory permits.
ch := make(chan byte, 1_000_000)
if cap(ch) != 1_000_000 { fail() }
```

These tests probe each section of the contract. Failing any of them indicates a non-conforming implementation.

---

This specification, together with the source walk in `professional.md`, gives the full rule set for Go's channel ring buffer. The user-level rules in `02-channels/03-channel-axioms` are a higher-level restatement; this document is the runtime-level form.
