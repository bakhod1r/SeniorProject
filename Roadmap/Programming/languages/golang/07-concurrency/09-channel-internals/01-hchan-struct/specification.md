# The `hchan` Struct — Specification

[← Back to index](index.md)

## Table of Contents
1. [Purpose of This Page](#purpose-of-this-page)
2. [The User-Facing Contract](#the-user-facing-contract)
3. [`hchan` Invariants](#hchan-invariants)
4. [`makechan` Contract](#makechan-contract)
5. [`chansend` Contract](#chansend-contract)
6. [`chanrecv` Contract](#chanrecv-contract)
7. [`closechan` Contract](#closechan-contract)
8. [Wait Queue Contract](#wait-queue-contract)
9. [Lock Contract](#lock-contract)
10. [Memory Model Mapping](#memory-model-mapping)
11. [References](#references)

---

## Purpose of This Page

This page extracts the *formal contract* of `hchan` — the invariants every Go runtime must honor and the user-visible promises that follow from them. It is the answer to "what are the rules?" in a single document.

References are to the Go Language Specification (<https://go.dev/ref/spec>) and the Go Memory Model (<https://go.dev/ref/mem>), pinned to Go 1.22.

---

## The User-Facing Contract

From the Go spec, the relevant promises about channels:

1. **Channel creation**: `make(chan T, n)` allocates and initializes a channel. `n` must be `>= 0`. With `n == 0` or omitted, the channel is unbuffered.

2. **Send `ch <- v`**:
   - On a `nil` channel, blocks forever.
   - On a closed channel, panics.
   - On an unbuffered channel: blocks until a receiver is ready; then the value is transferred and both proceed.
   - On a buffered channel: if there is space, places the value and proceeds; if full, blocks until space is available.

3. **Receive `<-ch`**:
   - On a `nil` channel, blocks forever.
   - On a closed channel: if the buffer is non-empty, drains it; otherwise returns the zero value of `T`. With the two-value form `v, ok := <-ch`, `ok` is `false` once the buffer is drained on a closed channel.
   - On an open channel: receives from a waiting sender, or from the buffer, or blocks.

4. **Close `close(ch)`**:
   - On a `nil` channel, panics.
   - On an already-closed channel, panics.
   - Otherwise: sets the closed flag, wakes all parked senders (which then panic), wakes all parked receivers (which then receive zero).

5. **`len(ch)` and `cap(ch)`**:
   - `cap(ch)` is the buffer capacity (constant after creation).
   - `len(ch)` is the current count of buffered elements (a snapshot, not synchronised).

6. **`for v := range ch`**: equivalent to repeated `v, ok := <-ch; if !ok { break }`.

7. **`select`**: picks one ready case (random among ties) or, with `default`, returns immediately; without `default`, blocks until a case is ready.

`hchan` is the in-memory representation that realises this contract.

---

## `hchan` Invariants

The following invariants must hold whenever `c.lock` is *not* held. They are temporarily broken during the lock-protected critical sections of `chansend`, `chanrecv`, and `closechan`.

**Invariant 1 — At least one queue is empty**:

```
not (c.recvq.nonempty() and c.sendq.nonempty())
```

Exception: a single goroutine can have sudogs in both queues if it is in a `select` that simultaneously sends and receives on the same channel. Even then, the *total* across queues is bounded by the number of cases in that `select`.

**Invariant 2 — Buffer/queue coupling for buffered channels**:

```
c.qcount > 0          implies   c.recvq.empty()
c.qcount < c.dataqsiz implies   c.sendq.empty()
```

Reading the second: if the buffer has any free slot, no goroutine can be parked waiting to send (it would have used that slot).

**Invariant 3 — Index validity**:

```
0 <= c.sendx < max(c.dataqsiz, 1)
0 <= c.recvx < max(c.dataqsiz, 1)
```

For unbuffered channels both are always 0.

**Invariant 4 — Closed-ness is monotonic**:

```
c.closed transitions only 0 -> 1, never 1 -> 0.
```

**Invariant 5 — Type stability**:

```
c.elemtype and c.elemsize never change after makechan.
c.dataqsiz never changes after makechan.
c.buf never changes after makechan (the pointer value, not the contents).
```

**Invariant 6 — Sudog ownership**:

Every `sudog` in `c.recvq` or `c.sendq` has:
- `sg.c == c`
- `sg.g != nil` and `sg.g.atomicstatus == _Gwaiting` (or `_Grunnable` if a wake is in flight)
- `sg.elem != nil` for senders (points to source); for receivers, `sg.elem` may be `nil` if the user used `<-ch` without assignment

---

## `makechan` Contract

`makechan(t *chantype, size int) *hchan`:

**Preconditions**:
- `t.Elem.Size_ < 1 << 16`
- `t.Elem.Align_ <= maxAlign`
- `size >= 0`
- `size * t.Elem.Size_ + hchanSize` does not overflow `uintptr` and is `<= maxAlloc`

**Postconditions**:
- Returns a non-nil `*hchan` `c`.
- `c.dataqsiz == size`
- `c.elemsize == uint16(t.Elem.Size_)`
- `c.elemtype == t.Elem`
- `c.qcount == 0`, `c.sendx == 0`, `c.recvx == 0`, `c.closed == 0`
- `c.recvq` and `c.sendq` are empty
- `c.lock` is in the unlocked state
- If `size > 0` or element type has pointers, `c.buf` points to a buffer region; otherwise `c.buf` is a non-nil sentinel (the race address).

**Failure modes**:
- Any precondition violation calls `panic` with `plainError("makechan: size out of range")` or `throw` (fatal) for type errors.

---

## `chansend` Contract

`chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool`:

**Preconditions**:
- `c` may be `nil`.
- `ep` points to a value of the channel's element type (or `nil` only in narrow internal cases not used by user code).

**Behavior**:

Case `c == nil`:
- If `block`: park forever (`gopark` with `waitReasonChanSendNilChan`).
- If not `block`: return `false`.

Case `c.closed != 0` at lock acquire time:
- Release lock, panic `"send on closed channel"`.

Case waiter in `recvq`:
- Dequeue first waiter `sg`. Copy `*ep` to `*(sg.elem)`. Wake `sg.g`. Release lock. Return `true`.

Case buffer has room (`c.qcount < c.dataqsiz`):
- Copy `*ep` into `buf[sendx]`. Advance `sendx` mod `dataqsiz`. Increment `qcount`. Release lock. Return `true`.

Otherwise (buffer full, no receiver, `block == false`):
- Release lock. Return `false`.

Otherwise (must park):
- Acquire `sudog`, fill in. Enqueue in `sendq`. `gopark` (releasing lock via `chanparkcommit`).
- On wake: check `mysg.success`. If true, return `true`. If false, panic `"send on closed channel"`.

**Postcondition on success**: the value `*ep` has been transferred (either to a receiver, the buffer, or marked panicking after close).

---

## `chanrecv` Contract

`chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool)`:

**Preconditions**:
- `c` may be `nil`.
- `ep` may be `nil` (corresponds to `<-ch` without assignment).
- Otherwise `ep` points to a slot of the channel's element type.

**Behavior**:

Case `c == nil`:
- If `block`: park forever.
- If not `block`: return `(false, false)`.

Fast non-blocking check (no lock):
- If channel is empty and open, return `(false, false)`.
- If channel is empty and closed, perform the closed-and-empty actions (clear `*ep`, return `(true, false)`).

After lock acquire:
- If closed and `qcount == 0`: clear `*ep` if non-nil, release lock, return `(true, false)`.
- If a sender is waiting in `sendq`: dequeue, copy from sender's `elem` to `ep` (and for buffered channels also rotate the buffer; see `recv` helper). Wake sender. Release lock. Return `(true, true)`.
- If buffer has data: copy `buf[recvx]` to `*ep`, clear `buf[recvx]`, advance `recvx`, decrement `qcount`. Release lock. Return `(true, true)`.
- Else if not blocking: release lock, return `(false, false)`.
- Else: park on `recvq`. On wake, return `(true, mysg.success)`.

**Postcondition**:
- If `received == true`: `*ep` contains the received value.
- If `received == false`: `*ep` contains the zero value of the element type.
- `selected == true` iff a real operation completed (used by `select` machinery).

---

## `closechan` Contract

`closechan(c *hchan)`:

**Preconditions**:
- `c` must not be `nil` (otherwise: panic `"close of nil channel"`).
- `c.closed` must be `0` at entry (otherwise: panic `"close of closed channel"`).

**Behavior**:
- Acquire lock.
- Re-check `c.closed`. If `1`, release and panic.
- Set `c.closed = 1`.
- Drain `c.recvq`: for each `sg`, clear `*(sg.elem)`, set `sg.success = false`, accumulate `sg.g` into a local list.
- Drain `c.sendq`: for each `sg`, set `sg.success = false`, accumulate `sg.g`.
- Release lock.
- For each accumulated G, call `goready`.

**Postcondition**:
- `c.closed == 1`.
- `c.recvq` and `c.sendq` are empty.
- All previously-parked Gs are runnable. Senders will panic; receivers will see the zero value and `ok == false`.

---

## Wait Queue Contract

For `waitq` operations:

- `enqueue(sg)`: appends `sg` to the tail of the queue. `sg.next == nil`, `sg.prev` points to previous last (or `nil` if queue was empty). O(1).
- `dequeue()`: returns the head of the queue, skipping any `sudog`s whose `g.selectDone` has already been claimed. Returns `nil` if no live `sudog` is found. O(k) where k is the number of stale entries; amortised O(1).

Invariant: every `sudog` in any `waitq` has `sg.g` non-nil and `sg.c == owning channel`.

---

## Lock Contract

`c.lock` is a runtime spin-mutex:

- `lock(&c.lock)` and `unlock(&c.lock)` are paired.
- Locking is mandatory before reading/writing `qcount`, `sendx`, `recvx`, `recvq`, `sendq`, or modifying `buf` slots.
- Reading `dataqsiz`, `elemsize`, `elemtype`, `buf` (the pointer, not the contents) without the lock is permitted because these are immutable after `makechan`.
- Reading `qcount` without the lock is permitted only for `len(ch)`; the result is a snapshot.
- Reading `closed` without the lock is permitted (via atomic load) in fast paths only.
- The lock must not be held across any operation that may schedule another goroutine (e.g., `goready`).
- The lock's rank is `lockRankHchan`. Acquiring a higher-ranked lock while holding `c.lock` is forbidden.

---

## Memory Model Mapping

The Go Memory Model states:

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

`hchan` realizes this via:

- Both `chansend` and `chanrecv` acquire `c.lock`. The lock's acquire/release provides cross-CPU memory ordering.
- Race-detector annotations on `c.raceaddr()` (which is `&c.buf`) provide ThreadSanitizer with synchronization edges:
  - Send: `racereadpc(c.raceaddr(), ...)` plus `racenotify` on the buffer index.
  - Receive: `raceacquire(c.raceaddr())` plus `racenotify`.
  - Close: `racerelease(c.raceaddr())`.
- For unbuffered direct hand-off: `racesync(c, sg)` connects sender and receiver directly.

From the user's perspective, the result is that any write before `ch <- v` is visible after the matching `<-ch`, regardless of architecture. On weak-memory machines (arm64), the underlying `lock_*` implementation uses load-acquire/store-release for `mutex.key`.

The closed-channel observability is similarly ordered: a `close(ch)` synchronizes before every subsequent receive that observes the close.

For `cap(ch)` and `len(ch)`, the spec does not require synchronization with sends/receives. `len(ch)` is a snapshot. Code must not rely on `len(ch)` for synchronization.

---

## References

- Go Language Specification, "Channel types": <https://go.dev/ref/spec#Channel_types>
- Go Language Specification, "Send statements": <https://go.dev/ref/spec#Send_statements>
- Go Language Specification, "Receive operator": <https://go.dev/ref/spec#Receive_operator>
- Go Language Specification, "Close": <https://go.dev/ref/spec#Close>
- Go Memory Model, "Channel communication": <https://go.dev/ref/mem#chan>
- Source: `src/runtime/chan.go` and `src/runtime/select.go` (Go 1.22)
- Source: `src/runtime/runtime2.go` (definitions of `g`, `sudog`)
- Source: `src/runtime/proc.go` (`gopark`, `goready`)
- Source: `src/runtime/lock_futex.go` and `src/runtime/lock_sema.go` (mutex implementations)
- Source: `src/runtime/lockrank.go` (`lockRankHchan`)
- Proposal: Go 1.10 — `closechan` two-phase commit refactor
- Proposal: Go 1.14 — Async preemption (`g.parkingOnChan` flag)
