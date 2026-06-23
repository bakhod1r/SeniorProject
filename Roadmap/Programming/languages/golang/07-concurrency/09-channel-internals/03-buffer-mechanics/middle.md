# Buffer Mechanics — Middle Level

## Table of Contents
1. [Where We Pick Up](#where-we-pick-up)
2. [The Five Fields That Matter](#the-five-fields-that-matter)
3. [Slot Address Computation](#slot-address-computation)
4. [The Send Path, Buffer Branch](#the-send-path-buffer-branch)
5. [The Recv Path, Buffer Branch](#the-recv-path-buffer-branch)
6. [Index Wrap: Branch vs Modulo](#index-wrap-branch-vs-modulo)
7. [The "Empty" and "Full" Predicates](#the-empty-and-full-predicates)
8. [How `len` and `cap` Are Implemented](#how-len-and-cap-are-implemented)
9. [Direct Hand-off vs Buffer Path](#direct-hand-off-vs-buffer-path)
10. [Close and the Buffer](#close-and-the-buffer)
11. [Element Copy via `typedmemmove`](#element-copy-via-typedmemmove)
12. [Slot Clearing via `typedmemclr`](#slot-clearing-via-typedmemclr)
13. [Zero-Element-Size Channels](#zero-element-size-channels)
14. [Single-Allocation Buffer Layout](#single-allocation-buffer-layout)
15. [Practical Implications](#practical-implications)
16. [Worked Example: Trace a Sequence](#worked-example-trace-a-sequence)
17. [Self-Check](#self-check)
18. [Summary](#summary)

---

## Where We Pick Up

The junior file established the picture: a ring buffer with two indices `sendx`, `recvx`, a counter `qcount`, and a capacity `dataqsiz`. At the middle level we move from "the picture" to "the mechanism." We open the runtime, look at how a send and a receive actually touch the buffer, learn the address arithmetic, and understand why some operations skip the buffer entirely.

The reference Go version for this file is 1.22+. The structure of `hchan` and the logic of `chansend`/`chanrecv` have been very stable since Go 1.0; the names below are accurate against `src/runtime/chan.go`.

---

## The Five Fields That Matter

The buffer mechanics revolve around these `hchan` fields:

```go
type hchan struct {
    qcount   uint           // count of items in buffer
    dataqsiz uint           // capacity (slots, not bytes)
    buf      unsafe.Pointer // points to dataqsiz * elemsize bytes
    elemsize uint16         // size of one element in bytes
    sendx    uint           // next send index
    recvx    uint           // next recv index
    // ... lock, queues, closed, elemtype, etc.
}
```

Properties:

- `dataqsiz` and `elemsize` are set once by `makechan` and never change.
- `buf` is set once by `makechan` and never changes for the lifetime of the channel.
- `qcount`, `sendx`, `recvx` all start at zero and evolve under the lock.

The invariants the runtime maintains at every lock release:

- `0 <= qcount <= dataqsiz`
- `0 <= sendx < dataqsiz` (when `dataqsiz > 0`)
- `0 <= recvx < dataqsiz` (when `dataqsiz > 0`)
- `qcount == 0` iff the buffer is empty
- `qcount == dataqsiz` iff the buffer is full
- When `qcount > 0`, the occupied slots are `recvx`, `(recvx+1) mod N`, ..., `(recvx+qcount-1) mod N`

Once these invariants are second nature, the code reads itself.

---

## Slot Address Computation

Slot `i` of the buffer sits at `buf + i * elemsize`. The runtime exposes this as a tiny inline helper:

```go
func chanbuf(c *hchan, i uint) unsafe.Pointer {
    return add(c.buf, uintptr(i)*uintptr(c.elemsize))
}
```

`add` is the runtime's pointer-arithmetic helper that returns `unsafe.Pointer(uintptr(p) + x)`. It exists because Go forbids raw pointer arithmetic in normal code but the runtime needs it.

For an `elemsize` of zero (e.g. `chan struct{}`), `chanbuf` always returns `c.buf` regardless of `i`. The byte address is the same for every slot. This is harmless because nothing reads or writes those bytes — `typedmemmove` of a zero-size type is a no-op.

---

## The Send Path, Buffer Branch

Inside `chansend`, after checking for nil and closed and looking for a parked receiver, the runtime reaches the "fast async" branch:

```go
if c.qcount < c.dataqsiz {
    qp := chanbuf(c, c.sendx)
    if raceenabled {
        racenotify(c, c.sendx, nil)
    }
    typedmemmove(c.elemtype, qp, ep)
    c.sendx++
    if c.sendx == c.dataqsiz {
        c.sendx = 0
    }
    c.qcount++
    unlock(&c.lock)
    return true
}
```

Step by step:

1. `qp := chanbuf(c, c.sendx)` — compute the destination slot address.
2. `racenotify` records a happens-before edge for the race detector if it is enabled.
3. `typedmemmove(c.elemtype, qp, ep)` copies one `elemsize`-byte element from the sender's address `ep` into the slot, honoring the element type's pointer map so the GC remains accurate.
4. `c.sendx++` advances the write cursor.
5. `if c.sendx == c.dataqsiz { c.sendx = 0 }` wraps. This is the "ring" step.
6. `c.qcount++` reflects one more element stored.
7. `unlock` releases the channel lock; return `true` to the caller indicating the send completed without parking.

All of this happens with the channel lock held. Two senders cannot race on the same slot because the lock serialises them; the second one sees the first one's updated `sendx` and `qcount`.

---

## The Recv Path, Buffer Branch

The mirror image in `chanrecv`:

```go
if c.qcount > 0 {
    qp := chanbuf(c, c.recvx)
    if raceenabled {
        racenotify(c, c.recvx, nil)
    }
    if ep != nil {
        typedmemmove(c.elemtype, ep, qp)
    }
    typedmemclr(c.elemtype, qp)
    c.recvx++
    if c.recvx == c.dataqsiz {
        c.recvx = 0
    }
    c.qcount--
    unlock(&c.lock)
    return true, true
}
```

Step by step:

1. `qp := chanbuf(c, c.recvx)` — find the slot to drain.
2. `racenotify` for the race detector.
3. `typedmemmove(c.elemtype, ep, qp)` copies the slot into the receiver's destination. `ep == nil` happens when the receive does not consume the value (e.g. `<-ch` used as a statement that discards the value).
4. `typedmemclr(c.elemtype, qp)` zeroes the slot so any pointers no longer keep heap objects alive.
5. `c.recvx++` advances the read cursor.
6. Wrap, decrement, unlock, return.

The receive path is *two* copies plus a clear: copy slot to caller, then zero the slot. The clear is essential for GC correctness — without it, a slot that used to hold `*Big` would keep that `Big` alive even after it was logically removed from the channel.

---

## Index Wrap: Branch vs Modulo

The runtime uses

```go
c.sendx++
if c.sendx == c.dataqsiz { c.sendx = 0 }
```

instead of

```go
c.sendx = (c.sendx + 1) % c.dataqsiz
```

Why? Because integer modulo by a non-power-of-two divisor compiles to a division instruction on most architectures, which is slow. A conditional branch is faster, and the branch is highly predictable: it triggers once every `dataqsiz` operations. The runtime cares about every cycle on this hot path, so the branch wins.

Note that `dataqsiz` is *not* required to be a power of two. The branch-wrap works for any positive integer. The runtime makes no special case.

---

## The "Empty" and "Full" Predicates

```text
empty: c.qcount == 0
full:  c.qcount == c.dataqsiz
```

These two checks are how `chansend` decides whether to use the buffer branch (`qcount < dataqsiz`) and how `chanrecv` decides the same (`qcount > 0`). They are O(1), single comparisons, and do not touch the buffer at all. That is why the buffer branch is so fast: most of its time is spent on `typedmemmove`, not on bookkeeping.

A subtle point: the empty/full check is per-channel, under the channel lock. There is no global "buffer pool" concept. Each channel has its own ring with its own indices and counter.

---

## How `len` and `cap` Are Implemented

```go
// in runtime
func chanlen(c *hchan) int { return int(c.qcount) }
func chancap(c *hchan) int { return int(c.dataqsiz) }
```

Both are plain field reads. They are *not* atomic in the strict sense — the compiler inserts no memory barrier. But they take no lock either. The consequence: `len(ch)` is a snapshot that may already be stale by the time it returns. For diagnostics and rough metrics this is fine. For control flow it is unsafe; use `select` with `default` if you need an atomic test-and-act.

`cap(ch)` is always accurate because `dataqsiz` never changes after `make`.

---

## Direct Hand-off vs Buffer Path

A buffered channel does not always touch its buffer. The runtime first checks whether a receiver is parked:

```go
if sg := c.recvq.dequeue(); sg != nil {
    send(c, sg, ep, ...)
    unlock(&c.lock)
    return true
}
```

`send(c, sg, ep, ...)` copies the value directly from the sender's stack to the parked receiver's destination address and wakes the receiver. **The buffer is not touched.** This is the same fast path used by unbuffered channels, and it is preferred whenever both sides are ready.

The buffer branch fires only when the receiver queue is empty *and* the buffer has room. So the priority is:

1. Parked receiver? → direct hand-off, bypass buffer.
2. Else, buffer has room? → buffer branch.
3. Else → park sender on `sendq`.

For a *receiver*, the priority is symmetric:

1. Parked sender (and buffer is full)? → take buffer-head value, slot is refilled from parked sender, sender is woken. (See below for the "rotation" trick.)
2. Else, buffer has data? → buffer branch.
3. Else → park receiver on `recvq`.

The first case for receive is subtle and deserves its own paragraph. When the buffer is full and senders are queued, `chanrecv` does *not* directly hand the parked sender's value to the receiver. Instead, the receiver takes the value at `recvx` (which has been there longest), and the parked sender's value is *placed into the slot* the receiver just vacated. Then `recvx` advances; effectively the ring rotates by one slot, the receiver got the oldest value, and the queued sender's value is now at the back of the buffer. This preserves FIFO order.

---

## Close and the Buffer

`close(ch)` does not erase the buffer. It sets `c.closed = 1`, wakes all parked receivers (handing them the zero value), and wakes all parked senders (each of which then panics).

After close, the buffer is still drainable:

```go
ch := make(chan int, 3)
ch <- 1
ch <- 2
close(ch)
fmt.Println(<-ch) // 1
fmt.Println(<-ch) // 2
v, ok := <-ch
fmt.Println(v, ok) // 0 false
```

The receive path checks `closed && qcount == 0` *after* trying the buffer branch:

```go
if c.closed != 0 && c.qcount == 0 {
    // drained; return zero value with ok=false
    return true, false
}
```

So FIFO is preserved across close: every value the buffer held at the moment of close is delivered before any "ok=false" return.

---

## Element Copy via `typedmemmove`

`typedmemmove(t *_type, dst, src unsafe.Pointer)` copies `t.size` bytes from `src` to `dst`. For types containing no pointers, it is essentially `memmove`. For types containing pointers, it uses the type's `gcdata` (pointer map) to inform the write barrier: the GC needs to know about every pointer that was written.

Why not plain `memmove`? Because the garbage collector needs *write barriers* on pointer slots. A bare `memmove` of a struct containing a pointer would not trigger the barrier, and the GC could miss the new reference (or fail to clear an old one). `typedmemmove` walks the pointer map and emits the barriers correctly.

The size of one copy is `c.elemsize` bytes. For `chan int` on a 64-bit machine, that is 8 bytes. For `chan [1024]byte`, it is 1024 bytes. For `chan *Big`, it is 8 bytes (one pointer) plus one write barrier. **Channels that carry small values are much cheaper than channels that carry large values**, because the dominant cost on the buffer fast path is `typedmemmove`.

---

## Slot Clearing via `typedmemclr`

After a receive copies the slot out, the runtime zeroes the slot with `typedmemclr(t, p)`. This is the type-aware version of zeroing memory. Like `typedmemmove`, it cooperates with the GC: any pointer fields in the slot are properly cleared so the heap objects they referenced become eligible for collection.

If the runtime skipped this step, a slot that used to hold `*HugeStruct` would keep that struct alive in the channel's buffer until the slot was overwritten by a new send. With `typedmemclr`, the moment the receive completes, the reference is gone and the object can be collected.

For value types without pointers (e.g. `int`, `float64`, fixed-size primitive arrays), `typedmemclr` is essentially `memset(0)`. The runtime still calls it for uniformity; the cost is negligible.

---

## Zero-Element-Size Channels

When `elemsize == 0`:

- `dataqsiz * elemsize == 0` bytes of buffer.
- `chanbuf` returns a constant pointer for every index.
- `typedmemmove` of a zero-size type is a no-op.
- `typedmemclr` of a zero-size type is a no-op.
- `sendx`, `recvx`, `qcount` still advance as usual.

So `make(chan struct{}, 1000)` allocates *one* `hchan` and zero bytes of buffer. The runtime tracks "there is one (zero-bytes) value in the buffer" but copies nothing.

This is why `chan struct{}` is the canonical signalling channel: maximum lightweight, with the buffer's "shock absorber" effect intact.

A subtle bookkeeping case: when `dataqsiz == 0` *and* `elemsize == 0`, the channel is fully unbuffered with no element bytes — sometimes seen in done-channels. `hchan.buf` is set to a sentinel address that is never dereferenced.

---

## Single-Allocation Buffer Layout

`makechan` decides between two allocation strategies based on the element type and capacity:

```go
func makechan(t *chantype, size int) *hchan {
    elem := t.Elem
    // ...
    mem, overflow := math.MulUintptr(elem.size, uintptr(size))
    var c *hchan
    switch {
    case mem == 0:
        // chan struct{}, or unbuffered: allocate only hchan
        c = (*hchan)(mallocgc(hchanSize, nil, true))
        c.buf = c.raceaddr() // sentinel
    case elem.ptrdata == 0:
        // No pointers in element: allocate hchan + buffer as one block.
        c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
        c.buf = add(unsafe.Pointer(c), hchanSize)
    default:
        // Element contains pointers: allocate buffer separately so GC scans it as the right type.
        c = new(hchan)
        c.buf = mallocgc(mem, elem, true)
    }
    c.elemsize = uint16(elem.size)
    c.elemtype = elem
    c.dataqsiz = uint(size)
    // ...
    return c
}
```

Three cases:

1. **No buffer bytes** (`mem == 0`): unbuffered channel, or buffered channel of a zero-size element type. One allocation: just `hchanSize` bytes.
2. **Buffer has no pointers** (`elem.ptrdata == 0`): one allocation for header + buffer. `hchan.buf` points just past the header. The GC sees one block and does not scan the buffer for pointers (there are none).
3. **Buffer has pointers** (`elem.ptrdata != 0`): two allocations. The buffer is allocated with the element type so the GC scans it as an array of that type. The `hchan` is allocated separately. This is the most expensive case but it is required for GC accuracy.

The middle-level takeaway: most channels (carrying `int`, `int64`, small structs without pointers, or `struct{}`) use the **single-allocation** path. That is why creating channels is cheap.

---

## Practical Implications

- **One allocation per channel** for the common case. `make(chan int, 100)` is one `mallocgc` of `hchanSize + 800` bytes.
- **Buffer size affects allocation but not per-op cost.** A channel of capacity 1000 takes the same nanoseconds per send/recv as a channel of capacity 4 (when not parking).
- **Element pointers force a separate buffer allocation.** A `chan *Big` has a different allocation pattern than `chan int`. Profile if it matters.
- **Zero-size elements are essentially free per operation** because there is no byte copy.
- **`len`/`cap` are unlocked field reads.** Useful for diagnostics; unsafe for control flow.
- **The wrap is a branch, not a modulo.** A power-of-two capacity offers no speedup over an arbitrary capacity at the runtime level.

---

## Worked Example: Trace a Sequence

Setup: `ch := make(chan int, 3)`. We trace each operation, tracking `qcount`, `sendx`, `recvx`, and the slot contents `[s0, s1, s2]`. Initial state: `qcount=0`, `sendx=0`, `recvx=0`, `[ _, _, _ ]`.

1. `ch <- 10`
   - `qcount (0) < dataqsiz (3)`: buffer branch.
   - Write 10 into slot 0; advance `sendx` to 1; `qcount` becomes 1.
   - State: `qcount=1, sendx=1, recvx=0, [10, _, _]`.

2. `ch <- 20`
   - `qcount (1) < 3`: buffer branch.
   - Slot 1 = 20; `sendx=2`; `qcount=2`.
   - State: `qcount=2, sendx=2, recvx=0, [10, 20, _]`.

3. `ch <- 30`
   - Slot 2 = 30; `sendx` increments to 3, wraps to 0; `qcount=3`.
   - State: `qcount=3, sendx=0, recvx=0, [10, 20, 30]`.

4. `v := <-ch`
   - `qcount (3) > 0`: buffer branch.
   - Read slot 0 (10) into `v`; clear slot 0; `recvx=1`; `qcount=2`.
   - State: `v=10, qcount=2, sendx=0, recvx=1, [_, 20, 30]`.

5. `ch <- 40`
   - `qcount (2) < 3`: buffer branch.
   - Slot 0 = 40 (wrap-around!); `sendx=1`; `qcount=3`.
   - State: `qcount=3, sendx=1, recvx=1, [40, 20, 30]`.

6. `v := <-ch`
   - Read slot 1 (20); clear slot 1; `recvx=2`; `qcount=2`.
   - State: `v=20, qcount=2, sendx=1, recvx=2, [40, _, 30]`.

7. `v := <-ch`
   - Read slot 2 (30); clear slot 2; `recvx` wraps to 0; `qcount=1`.
   - State: `v=30, qcount=1, sendx=1, recvx=0, [40, _, _]`.

8. `v := <-ch`
   - Read slot 0 (40); clear slot 0; `recvx=1`; `qcount=0`.
   - State: `v=40, qcount=0, sendx=1, recvx=1, [_, _, _]`.

Order received: 10, 20, 30, 40 — strict FIFO. The slots got reused (slot 0 held both 10 and 40), but FIFO is preserved by the index discipline, not by which slot was used.

---

## Self-Check

- [ ] I can write the buffer branch of `chansend` from memory.
- [ ] I know that the runtime uses a branch-wrap, not a modulo.
- [ ] I can predict the contents of the buffer after a sequence of sends and receives.
- [ ] I understand why `typedmemmove` is used instead of `memmove`.
- [ ] I understand why `typedmemclr` is necessary on the receive path.
- [ ] I can recognise the three allocation cases in `makechan`.
- [ ] I know that `len`/`cap` are unlocked field reads.
- [ ] I know the priority order: direct hand-off, then buffer branch, then park.
- [ ] I know that `chan struct{}` allocates zero buffer bytes.

---

## Summary

At the middle level, the ring buffer ceases to be a picture and becomes code you can read in `runtime/chan.go`. The send and receive paths each have a "buffer branch" sandwiched between "look for a parked partner" and "park yourself." The branch is short, fast, and entirely sequential under the channel lock: compute the slot address, copy with `typedmemmove`, advance the index with a branch-wrap, bump the counter.

The allocation story is equally tidy: for the common case (no pointers in the element type, capacity > 0), the `hchan` header and the buffer share one allocation. For pointer-containing element types, the buffer is allocated separately so the GC can scan it as the right type. For zero-element-size cases, there is no buffer block at all.

Once you can trace a sequence of sends and receives through the buffer by hand — updating `qcount`, `sendx`, `recvx` after each operation — the senior file's discussion of cache, GC, and race-detector interactions will fit naturally into the same picture.
