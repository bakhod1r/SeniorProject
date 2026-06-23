# Buffer Mechanics — Senior Level

## Table of Contents
1. [What This Level Covers](#what-this-level-covers)
2. [The Allocation Strategy In Depth](#the-allocation-strategy-in-depth)
3. [Cache Lines and the Hot Fields](#cache-lines-and-the-hot-fields)
4. [Why a Single Mutex Beats a Lock-Free Ring](#why-a-single-mutex-beats-a-lock-free-ring)
5. [GC Scanning of the Buffer](#gc-scanning-of-the-buffer)
6. [`typedmemmove` and the Write Barrier](#typedmemmove-and-the-write-barrier)
7. [Race Detector Edges Through the Ring](#race-detector-edges-through-the-ring)
8. [Large Buffers: Memory, TLB, Locality](#large-buffers-memory-tlb-locality)
9. [Power-of-Two: Myth and Reality](#power-of-two-myth-and-reality)
10. [Compiler Lowering and Inlining](#compiler-lowering-and-inlining)
11. [Performance Envelope](#performance-envelope)
12. [Buffer Mechanics in `select`](#buffer-mechanics-in-select)
13. [Buffer and Close Interactions](#buffer-and-close-interactions)
14. [Diagnostic Tools](#diagnostic-tools)
15. [Common Senior Pitfalls](#common-senior-pitfalls)
16. [Summary](#summary)

---

## What This Level Covers

The middle level explained *what* the ring buffer does and *how* the runtime touches it. The senior level explains *why* it is shaped the way it is, what the trade-offs are at the system level, and what observable consequences fall out of those design choices. We discuss allocation strategy, cache layout, mutex vs lockless, GC interaction, race-detector instrumentation, and the realistic performance envelope of the buffer path.

The reference Go version remains 1.22+; the structural choices have been stable across many releases. Where Go 1.21 or 1.23 introduced a relevant change, we note it.

---

## The Allocation Strategy In Depth

`makechan` has three allocation strategies, chosen at runtime based on element type:

```go
switch {
case mem == 0:
    c = (*hchan)(mallocgc(hchanSize, nil, true))
    c.buf = c.raceaddr()
case elem.ptrdata == 0:
    c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
    c.buf = add(unsafe.Pointer(c), hchanSize)
default:
    c = new(hchan)
    c.buf = mallocgc(mem, elem, true)
}
```

Three trade-offs to internalise:

**Case A — `mem == 0`.** `chan struct{}`, or any `make(chan T, 0)` (unbuffered). One block of `hchanSize` bytes. `c.buf` is set to a sentinel — `c.raceaddr()` returns the address of `c.buf` itself, used only as a stable address for the race detector's instrumentation map. No element bytes are ever read or written.

**Case B — no pointers in element.** One contiguous allocation of `hchanSize + N*elemsize` bytes. `c.buf` points just past the header. From the GC's perspective, the whole block is one allocation with no internal pointer fields (the header's pointers are either nil for `buf` — pointing back into the same block doesn't trigger a marking step — or are scanned by the type descriptor for `hchan` itself).

This case is the fast path for the most common channels: `chan int`, `chan int64`, `chan [16]byte`, `chan struct { x, y int }` (no pointers), `chan bool`, etc.

**Case C — element contains pointers.** Two allocations: `hchan` on its own, buffer on its own. The buffer's allocation passes `elem` as the type, so the GC scans the block as an `[N]T` array, finding pointers at the right offsets per slot. This is the price of GC accuracy. The cost is one extra `mallocgc` call at channel-creation time; the per-operation cost is unchanged.

There is no auto-promotion or shrinking. The choice is fixed at `make` time and stays for the channel's life.

---

## Cache Lines and the Hot Fields

`hchan` is around 96 bytes on a 64-bit machine (varies slightly by Go version). The fields used on every operation — `qcount`, `dataqsiz`, `buf`, `elemsize`, `sendx`, `recvx`, and the mutex itself — are clustered at the start of the struct. On x86-64 with 64-byte cache lines, those fields fit into the first one or two lines. The lock and the hot indices share cache lines, which is intentional: under contention, the cache line bounces between cores along with the mutex, and there is no benefit in spreading them out.

The buffer, by contrast, may span many cache lines for large `N`. Slot accesses are sequential (sender writes slot `sendx` then `sendx+1`; receiver reads slot `recvx` then `recvx+1`), so the CPU's hardware prefetcher does a good job once the ring is "warm." False sharing between `sendx`-side accesses and `recvx`-side accesses on the same cache line is the main downside; it happens when capacity is small enough that `sendx` and `recvx` operate on adjacent slots.

In practice, the channel lock serialises every send and receive on a given channel, so even on a multi-core machine, the buffer is touched by *one* core at a time. False sharing within the buffer is not a meaningful concern. What *does* matter is false sharing with other unrelated memory if you put the buffer next to other contended cache lines — but `hchan` is its own allocation, so this is rare in practice.

---

## Why a Single Mutex Beats a Lock-Free Ring

A natural senior question: "Could you make the channel faster with a lock-free MPMC ring?" The Go runtime authors considered this and chose otherwise. Why?

1. **The contended case is dominated by parking, not by the ring.** When a send finds the buffer full, the cost is dominated by `gopark` + `goready`, not by lock acquisition. A lockless ring would save microseconds out of a tens-of-microseconds path.

2. **The uncontended case is already fast.** The fast-path send through a buffered channel is ~30 nanoseconds. The lock acquire/release on an uncontested mutex is a couple of atomic operations; a lockless CAS-based ring would not be meaningfully faster.

3. **Lock-free MPMC rings are hard.** ABA, sequencing, and progress guarantees require complex code. The Go runtime values clarity in `chan.go` because it is one of the most-read files in the codebase.

4. **The mutex protects more than the buffer.** It also protects the wait queues, the `closed` flag, and the indices. Splitting these into separate lock-free structures would multiply complexity.

5. **Spin-then-park is already optimal for short critical sections.** Go's `mutex` is a futex-style lock that spins briefly before parking. For the buffer's micro-critical-section, this is excellent.

The senior takeaway: do not try to "improve" `hchan` with lock-free tricks. The choice is informed and intentional.

---

## GC Scanning of the Buffer

When the buffer holds pointer-containing elements (case C above), the GC must scan it as an array of `T`. The runtime tells the GC about this in two ways:

1. The buffer allocation passes `elem` (an `*_type`) as the type argument to `mallocgc`. The GC's mark phase walks the block as an `[N]T` and follows pointers.

2. The `hchan` struct contains a pointer field `buf`, which the GC follows from the `hchan` to the buffer block. So as long as the `hchan` is reachable, the buffer is reachable, and any pointers inside the buffer are kept alive.

What happens after a receive? The runtime calls `typedmemclr(c.elemtype, qp)` to zero the slot. The clear is type-aware: it writes the appropriate zero values for every pointer slot, including triggering write barriers if necessary (during the GC mark phase). The result is that the heap object that used to be referenced is no longer referenced from the buffer; if no other references exist, the next GC cycle collects it.

If the runtime *skipped* the clear, the receive would correctly pass the value to the receiver, but the slot would still hold a pointer to the heap object. The object would stay alive until that slot was overwritten by a new send. This is the "channel leak" effect — values in the buffer outlive their logical lifetime. The runtime avoids it.

Note that the same logic applies to *partial* clears: if `T` is `struct { a *X; b *Y }` and only `a` is a pointer, `typedmemclr` clears 16 bytes (the size of `T`) but the GC only cares about the pointer-shaped slots. The pointer map encodes which offsets within `T` are pointers.

---

## `typedmemmove` and the Write Barrier

`typedmemmove(t, dst, src)` is the runtime's generic copy. It branches based on the element's `ptrdata`:

- If `t.ptrdata == 0` (no pointers in `T`), it calls `memmove` directly. Fast path.
- If `t.ptrdata > 0`, it walks the pointer map and emits `writebarrierptr` for each pointer-sized slot. Slow path, but necessary.

The write barrier is the mechanism by which the GC tracks pointer writes during concurrent mark. When a goroutine writes a pointer `*p = q`, the barrier records `q` in the GC's work queue so the marker can scan it. Without this, the marker could finish before seeing the new pointer and incorrectly conclude `q` is unreachable.

For the buffer write in `chansend`, the runtime carefully:

1. Computes `qp := chanbuf(c, c.sendx)` — slot address in the buffer.
2. Optionally calls `racewriterange` to inform the race detector.
3. Calls `typedmemmove(c.elemtype, qp, ep)` — which internally emits write barriers if needed.

The barrier itself is conditional on the GC phase; in steady-state mutator phases, it is essentially free (a quick check of a global flag). During mark, it is a few instructions per pointer.

The senior insight: **the cost of a channel send scales with the number of pointers in `T`, not with the byte size of `T`.** A `chan [1024]byte` (1KB pure bytes) sends faster than a `chan struct{ ptrs [16]*int }` (128 bytes but 16 pointers) during a GC cycle, because the latter incurs 16 write barriers.

---

## Race Detector Edges Through the Ring

When the race detector (`-race`) is enabled, every channel send and receive emits happens-before edges. The runtime tracks these per-slot:

```go
if raceenabled {
    racenotify(c, c.sendx, nil)
}
typedmemmove(c.elemtype, qp, ep)
```

`racenotify` calls into the race detector's runtime to register that the current goroutine performed a "release" or "acquire" operation associated with slot `sendx`. Later, when a receiver reads that slot, the race detector creates the corresponding edge: the receiver's "acquire" synchronises with the sender's "release."

The Go memory model guarantees: "A send on a channel happens before the corresponding receive from that channel completes." The race detector enforces this guarantee by tracking the edge through the buffer slot. **Each slot is essentially a synchronisation object the race detector watches.**

This is one reason buffered channels are slower under `-race` than unbuffered ones: more slot-level instrumentation. But the absolute overhead is still small; the race detector is fast.

The implication for senior debugging: if you see a race report involving a buffered channel slot, you can trace it back to the *send* and *receive* on that slot via the goroutine IDs in the report. The race detector's perspective on the ring is "every slot is a one-shot synchronisation event used twice (once on send, once on recv)."

---

## Large Buffers: Memory, TLB, Locality

`make(chan int64, 1_000_000)` allocates 8 MB of buffer. This is legal, but worth thinking about:

- **Memory pressure.** 8 MB is held for the channel's lifetime. If the channel leaks, so does the 8 MB.
- **TLB pressure.** 8 MB spans 2048 4KB pages, more than the L1 TLB can cover. Random access into the buffer (which the ring's sequential pattern avoids) would thrash the TLB.
- **Cache footprint.** Even sequential access wipes the L1 cache (~32 KB) repeatedly. The CPU prefetcher mitigates this, but very large buffers do not benefit from cache.
- **First-touch cost.** On Linux, anonymous pages are demand-paged. The first access to each 4KB page triggers a minor page fault. A 1M-slot channel's first fill thus costs ~2000 page faults' worth of latency, spread across the first sends.
- **GC scan cost.** If `T` contains pointers, the GC walks the entire buffer on every cycle. 8 MB of pointers means scanning 1M pointer slots.

Very large buffers should be deliberate. If you reach for `make(chan T, 1_000_000)`, ask: do I actually need that capacity, or am I masking a back-pressure problem? Almost always the answer is the latter.

---

## Power-of-Two: Myth and Reality

Some C/C++ ring-buffer implementations require a power-of-two capacity so that `% N` can be replaced with `& (N-1)`. Go does *not* require this. The capacity is an arbitrary positive integer, and the wrap is implemented as a branch:

```go
c.sendx++
if c.sendx == c.dataqsiz { c.sendx = 0 }
```

Why is this fast enough? Because:

- A branch is one instruction; predicted "not taken" until the wrap occurs. The wrap occurs once per `N` operations.
- An unconditional `%` would be a 20–40 cycle division on most CPUs.
- An `& (N-1)` would only work for power-of-two N and would impose a constraint on user-chosen capacity.

The runtime authors chose user freedom and a branch over a power-of-two constraint and a bitwise AND. The performance difference is negligible: the branch is essentially free thanks to prediction.

Senior consequence: do not bother picking power-of-two capacities for performance. Pick the capacity that fits your workload. Powers of two have no advantage at the Go runtime level (they may have advantages at the application level if you do your own modular arithmetic, but that is your code, not the channel's).

---

## Compiler Lowering and Inlining

`make(chan T, N)`, `ch <- v`, `<-ch`, `close(ch)`, `len(ch)`, `cap(ch)` are all compiled into runtime calls:

| Syntax | Runtime call |
|---|---|
| `make(chan T, N)` | `runtime.makechan(t, N)` |
| `ch <- v` | `runtime.chansend1(ch, &v)` |
| `v := <-ch` | `runtime.chanrecv1(ch, &v)` |
| `v, ok := <-ch` | `runtime.chanrecv2(ch, &v)` |
| `close(ch)` | `runtime.closechan(ch)` |
| `len(ch)` | direct field read (`c.qcount`) — often inlined |
| `cap(ch)` | direct field read (`c.dataqsiz`) — often inlined |

`chansend1` and `chanrecv1` are thin wrappers that call `chansend(c, ep, true, getcallerpc())` and `chanrecv(c, ep, true)`. The `true` is the blocking flag.

For `select`, the compiler emits a single call to `runtime.selectgo` with a descriptor of the cases. Inside, `selectgo` essentially performs the same send/recv logic but examines all cases under one lock acquisition strategy.

`len` and `cap` are direct field reads — they can be inlined to a single load instruction. The cost is roughly one memory access; no lock, no atomic. This is why they are cheap for diagnostics, and why they are unsafe for control flow (no synchronisation).

The compiler does *not* inline `chansend` or `chanrecv` themselves; they are too complex and contain runtime-only code (mutex, parking). So every send and receive is a real function call.

---

## Performance Envelope

Rough numbers, measured on a modern x86-64 machine, single-threaded benchmarks:

| Operation | Approximate cost |
|---|---|
| Unbuffered send/recv (direct hand-off) | ~150 ns |
| Buffered send (buffer branch, no contention) | ~30 ns |
| Buffered send to a full buffer (parks) | ~1 µs+ (depends on goready latency) |
| `len(ch)` | ~1 ns (one memory read) |
| `cap(ch)` | ~1 ns |
| `make(chan int, 100)` | ~150 ns (one `mallocgc`) |
| `make(chan *Big, 100)` | ~250 ns (two `mallocgc`) |

These are *fast-path* numbers. Under contention from many goroutines on the same channel, the mutex starts to spin and park, and per-op latency rises into the microseconds. But for typical workloads with a producer and a few consumers, the buffer path is in the tens of nanoseconds.

A useful rule of thumb: **a buffered channel can do roughly 30–50 million operations per second per core, single-threaded, on the fast path.** This is enough for almost every application; if you find yourself near that limit, the bottleneck is probably elsewhere or you should consider lock-free queues for that specific high-throughput data path.

---

## Buffer Mechanics in `select`

`select` with cases on multiple channels still uses the same per-channel ring buffers, but the orchestration is in `selectgo`:

1. The compiler builds a `[]scase` array describing each case.
2. `selectgo` shuffles the cases (to avoid starvation) and then walks them looking for a case that can complete immediately.
3. For each `case ch <- v`, it tries the fast path: lock `ch`, check for a parked receiver or buffer room, do the operation, return.
4. If no case can complete and there is a `default`, it returns the `default` immediately.
5. Otherwise, it parks the goroutine on *all* affected channels' wait queues, with each `sudog` pointing back to the same goroutine.
6. When a case fires, the goroutine is woken; it then removes itself from the other channels' queues and returns the selected case.

The buffer path inside `selectgo`'s "try the cases" loop is *exactly* the same code as `chansend`/`chanrecv`. There is no special select-only buffer logic. The ring buffer does not know it is being accessed by `select`; it just sees a normal send or receive under the channel lock.

---

## Buffer and Close Interactions

`closechan` is straightforward but worth a careful read:

```go
func closechan(c *hchan) {
    if c == nil { panic("close of nil channel") }
    lock(&c.lock)
    if c.closed != 0 { unlock(&c.lock); panic("close of closed channel") }
    c.closed = 1
    // wake all parked receivers
    for sg := c.recvq.dequeueAll(); sg != nil; sg = c.recvq.dequeueAll() {
        // hand them the zero value
    }
    // wake all parked senders (they will panic)
    for sg := c.sendq.dequeueAll(); ... {
        // ...
    }
    unlock(&c.lock)
}
```

Closing does *not* touch the buffer. The values stored at `recvx`, `recvx+1`, ... `recvx+qcount-1` (modulo `dataqsiz`) remain. Subsequent receives drain them in FIFO order. When `qcount` reaches zero, the next receive hits the "closed and empty" case and returns the zero value with `ok=false`.

Note that any *senders* parked on `sendq` panic when woken, with the message "send on closed channel." This is one of the few times a runtime function intentionally panics in a goroutine other than the one that called it. The panic happens in the parked sender's stack frame, not in `closechan`'s.

The buffer's contents at the time of close are part of the channel's continuation contract: the channel may be closed, but a receiver still has the right to read those values.

---

## Diagnostic Tools

- **`pprof` allocation profile**: shows `runtime.makechan` calls. Useful for spotting "made a channel inside a loop" leaks.
- **`pprof` block profile** (`runtime.SetBlockProfileRate`): records goroutines blocked on channel operations. Excellent for spotting buffer-full back-pressure.
- **`pprof` mutex profile**: records contention on `hchan.lock`. If you see this for a specific channel, you have a hot channel.
- **`-race` detector**: tracks per-slot synchronisation. Slow but catches races between channel users and other memory.
- **`runtime/trace`**: shows scheduler events including channel-send and channel-recv unparking. Visualises the ebb and flow of buffer fill levels indirectly via park/unpark.
- **`runtime.Stack`** or `SIGQUIT`: dumps all goroutines, including ones blocked on channel operations. The stack trace shows the call site of the blocked send/recv.

For senior debugging of a "channel is slow" or "channel is leaking" problem, start with `pprof -block` and `pprof -mutex`. These reveal whether the buffer fast path is being missed (lots of blocking time) or whether the lock itself is contended.

---

## Common Senior Pitfalls

- **Treating buffer size as a tuning knob to add capacity until tests pass.** This masks design problems. Use the smallest size that meets your latency goals.
- **Pre-allocating huge buffers "for safety."** Capacity costs memory; large capacities discourage proper back-pressure.
- **Assuming `len(ch)` is fresh enough to base flow control on.** It is a snapshot; in concurrent code it is stale by the time you read it. Use `select` with `default`.
- **Storing large structs in `chan T`.** Every send copies `elemsize` bytes. Use `chan *T` if the value is big, but then be careful about ownership and lifetime.
- **Ignoring GC pressure from `chan *T`.** Pointer-containing buffers are scanned by the GC. For very hot channels, prefer non-pointer payloads.
- **Believing a power-of-two capacity is faster.** It is not, on Go's ring.
- **Using buffered channels to "broadcast."** They cannot. Use `close` on an unbuffered `chan struct{}` for broadcast.
- **Treating the ring as a thread-safe primitive you can use without a channel.** You can't — the ring is private to `hchan` and depends on the channel mutex for safety.

---

## Summary

The ring buffer is small, dense, and lock-protected. Its allocation strategy is chosen at `make` time based on whether the element type contains pointers, with the common cases falling into a single `mallocgc` call. Per-operation cost is dominated by `typedmemmove`, which respects the GC's pointer map and emits write barriers when needed. The race detector watches each slot as a synchronisation event.

The "lock-free ring would be faster" intuition does not survive measurement: the channel mutex's critical section is already tiny, and the cost of blocking goroutines on a full buffer dwarfs any lock-free win. The ring's branch-wrap is faster than a modulo and does not require a power-of-two capacity, so the user is free to pick whatever number fits the workload.

Close interacts with the buffer purely as a state change on the `closed` flag; the contents of the buffer survive close and are delivered in FIFO order until exhausted. The buffer is bypassed entirely whenever a receiver is parked at send time (or a sender is parked at receive time), preferring direct stack-to-stack copy over a buffered round trip.

At the senior level, your mental model of the ring is no longer "a circular array." It is "a lock-serialised, type-aware, GC-aware, race-detector-instrumented FIFO with a single contiguous allocation, chosen between three strategies based on element pointer-ness, optimised for the uncontended fast path."
