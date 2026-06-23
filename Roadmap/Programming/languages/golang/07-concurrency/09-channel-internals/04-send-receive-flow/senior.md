# Send/Receive Flow — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Direct Handoff in Depth](#direct-handoff-in-depth)
3. [The Buffered-with-Queued-Sender Trick](#the-buffered-with-queued-sender-trick)
4. [`sudog.elem` Lifetime](#sudogelem-lifetime)
5. [Stack Pinning During Park](#stack-pinning-during-park)
6. [Race Detector Hooks](#race-detector-hooks)
7. [Trace Events and `runtime/trace`](#trace-events-and-runtimetrace)
8. [`gopark` Reason Codes](#gopark-reason-codes)
9. [Goroutine State Transitions](#goroutine-state-transitions)
10. [Lock Contention and the Single-Mutex Bottleneck](#lock-contention-and-the-single-mutex-bottleneck)
11. [Select Integration](#select-integration)
12. [Why Direct Handoff Is Not Always Possible](#why-direct-handoff-is-not-always-possible)
13. [`KeepAlive` and the Garbage Collector](#keepalive-and-the-garbage-collector)
14. [Cost Breakdown on Real Hardware](#cost-breakdown-on-real-hardware)
15. [Summary](#summary)

---

## Introduction

The senior level focuses on the parts of the send/receive flow that are easy to miss on first read: how stack pinning works while a goroutine sleeps with a `sudog` pointing into its stack, why the runtime can do a `memmove` between two goroutines' stacks without copying through an intermediate buffer, what the race detector sees, and where the single channel mutex starts to matter for throughput.

This level still uses simplified pseudocode from `runtime/chan.go`. The professional level reads the actual source.

---

## Direct Handoff in Depth

Direct handoff is the runtime's design choice that lets two goroutines exchange a value through a channel without ever putting it in the buffer. It is implemented by `send` (for sender finding a parked receiver) and `recv` (for receiver finding a parked sender):

```go
func send(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
    // raceenabled: emit synchronisation events.
    if sg.elem != nil {
        sendDirect(c.elemtype, sg, ep)
        sg.elem = nil
    }
    gp := sg.g
    unlockf()
    gp.param = unsafe.Pointer(sg)
    sg.success = true
    if sg.releasetime != 0 {
        sg.releasetime = cputicks()
    }
    goready(gp, skip+1)
}

func sendDirect(t *_type, sg *sudog, src unsafe.Pointer) {
    // src is on the sender's stack.
    // sg.elem is on the receiver's stack (because the receiver parked while
    //   waiting to receive into &v on its stack).
    // This memmove crosses goroutine stack boundaries — only safe because:
    //   1. The receiver is parked (its stack is stable).
    //   2. We're under the channel lock, so no GC or stack move can happen
    //      to the receiver while we copy.
    dst := sg.elem
    typeBitsBulkBarrier(t, uintptr(dst), uintptr(src), t.Size_)
    memmove(dst, src, t.Size_)
}
```

What is unusual about this `memmove`:

- It writes into another goroutine's stack frame.
- The other goroutine is parked but its stack pointer is still valid.
- Write barriers (`typeBitsBulkBarrier`) ensure GC sees the pointer write.
- This is the *only* place in the Go runtime where one goroutine writes directly into another's stack on a regular hot path.

### Why this is safe

Three invariants:

1. **The receiver is parked** with `_Gwaiting` state. The scheduler will not schedule it; the M cannot run it.
2. **Stack movement (grow/shrink) cannot happen** while the channel lock is held. The runtime checks for `activeStackChans` when contemplating a stack move, and the receiver's `chanparkcommit` set this flag.
3. **The lock serializes everything**. No concurrent `chansend` can race, because they would have to take the same lock.

The receiver's stack is, for the duration of the handoff, a stable mapping. The runtime can use it as a memcpy destination.

### Why not buffer-then-wake?

An alternative design: sender writes to a buffer slot, wakes the receiver, receiver reads from the buffer. This was rejected because:

- It requires two memcpys (sender→buffer, buffer→receiver) instead of one.
- It requires two lock acquisitions (one by sender, one by receiver).
- It doubles the contention on `hchan.lock`.
- For unbuffered channels, there is no buffer to use in the first place.

Direct handoff is the clear win when both goroutines are ready: one memcpy, one lock acquisition, two `goready`s (only the parked goroutine needs `goready`; the running one continues).

---

## The Buffered-with-Queued-Sender Trick

The most subtle code in `runtime/chan.go` is `recv` for a buffered channel:

```go
func recv(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
    if c.dataqsiz == 0 {
        // Unbuffered.
        if ep != nil {
            recvDirect(c.elemtype, sg, ep)
        }
    } else {
        // Buffered AND a sender was parked.
        qp := chanbuf(c, c.recvx)
        // 1. Copy buf[recvx] into receiver's destination.
        if ep != nil {
            typedmemmove(c.elemtype, ep, qp)
        }
        // 2. Copy sender's value into buf[recvx] (which is now free).
        typedmemmove(c.elemtype, qp, sg.elem)
        // 3. Advance both indices.
        c.recvx++
        if c.recvx == c.dataqsiz {
            c.recvx = 0
        }
        c.sendx = c.recvx
    }
    sg.elem = nil
    gp := sg.g
    unlockf()
    gp.param = unsafe.Pointer(sg)
    sg.success = true
    goready(gp, skip+1)
}
```

What just happened? Read carefully. The buffered channel was *full*, that's why the sender parked. The receiver arrived. The receiver:

1. Takes the *oldest* buffered value (`buf[recvx]`).
2. Puts the sender's value into the freed slot.
3. Sets `sendx = recvx` (because the new last-written slot is the slot the receiver just emptied).
4. Increments `recvx` past the slot.

Effect: the sender's value enters the buffer in FIFO order (as if the sender had just sent without parking), and the receiver gets the next FIFO value.

Why this matters: without this trick, a sender that parks and is later woken would have to either:

- Send its value *out of order* (into the slot after `sendx`), violating FIFO.
- Wait for the buffer to drain before depositing, doubling latency.

The "promote sender into buffer" maneuver keeps the abstraction "channel is a FIFO queue" intact even when senders park.

`sendx = recvx` after the operation: this is because the buffer has wrapped one position. The new `sendx` is at the slot the receiver just emptied (which is now the head of the queue from the senders' perspective).

---

## `sudog.elem` Lifetime

`sudog.elem` is a pointer to the value being sent or received. Its lifetime is delicate:

- For a parked sender: `sg.elem` points to the *sender's stack frame* (where the value lives).
- For a parked receiver: `sg.elem` points to the *receiver's stack frame* (where the value will go).

These pointers are valid only as long as the goroutine remains parked *and* its stack does not move.

The runtime ensures this via two mechanisms:

1. `gp.activeStackChans = true` (set in `chanparkcommit`): tells the stack mover "this goroutine has pointers into its stack from sudogs; you must coordinate with the channel lock before moving the stack."
2. The channel lock: held during any operation that touches `sg.elem`.

When the goroutine is woken, `sg.elem` is cleared (`sg.elem = nil`) to prevent dangling references in the recycled sudog.

### Stack growth while parked

If a sender's goroutine has its stack grown while it is parked on `sendq`, the runtime must update `sg.elem` to point to the new stack location. This is handled in `runtime/stack.go`'s `adjustsudogs`:

```go
func adjustsudogs(gp *g, adjinfo *adjustinfo) {
    var sg *sudog
    for sg = gp.waiting; sg != nil; sg = sg.waitlink {
        adjustpointer(adjinfo, unsafe.Pointer(&sg.elem))
    }
}
```

This walks the goroutine's `waiting` list (chain of sudogs for this G) and updates each `sg.elem` to the new stack address.

But stack moves while parked are blocked unless the channel locks are taken first. The runtime serialises: lock all channels in `gp.waiting`, move the stack, update sudogs, release locks. This is `gp.activeStackChans` in action.

---

## Stack Pinning During Park

A parked goroutine's stack is not pinned in memory (the Go runtime can still move it for growth), but it is "pinned in coordination" — moving requires holding all the channel locks the goroutine is sleeping on.

For most parks, the goroutine is on exactly one channel. So the runtime locks that one channel, copies the stack, updates `sg.elem`, unlocks. This is a relatively expensive operation (orders of µs), but it is rare — most goroutines never need stack growth during a park.

For a goroutine parked in `select` (`isSelect == true`), it may be on multiple channels' waitqueues. The runtime locks them all in deterministic order to avoid deadlock.

---

## Race Detector Hooks

Build with `-race` and `chansend`/`chanrecv` execute extra code:

```go
// chansend
if raceenabled {
    racereadpc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(chansend))
}

// On direct handoff:
if raceenabled {
    if c.dataqsiz == 0 {
        racesync(c, sg)
    } else {
        // ...
    }
}

func racesync(c *hchan, sg *sudog) {
    racerelease(chanbuf(c, 0))
    raceacquireg(sg.g, chanbuf(c, 0))
    racereleaseg(sg.g, chanbuf(c, 0))
    raceacquire(chanbuf(c, 0))
}
```

The race detector tracks happens-before relationships. For a channel:

- A send is a `release` event.
- A receive is an `acquire` event.

The synchronisation address used is `chanbuf(c, 0)` (the buffer start, which is stable for the channel's lifetime). The race detector internally uses this as a "vector clock anchor."

Practical implication: any write the sender does before `ch <- v` becomes visible to the receiver after `<-ch`. The race detector emits a clean "no race" report for code patterns like:

```go
var data []int
done := make(chan struct{})
go func() {
    data = []int{1, 2, 3}
    done <- struct{}{}
}()
<-done
fmt.Println(data)
```

The send-release synchronises with the receive-acquire, so `data` is safely visible.

If you write `data` *after* the send, the race detector reports a race because the synchronisation went the wrong way.

---

## Trace Events and `runtime/trace`

When `runtime/trace.Start` is active, `chansend` and `chanrecv` emit events:

- `traceBlockChanSend`: emitted when a sender parks.
- `traceBlockChanRecv`: emitted when a receiver parks.
- `traceEvGoUnblock`: emitted when a goroutine is woken (from any cause, including channel).

In `go tool trace`, these appear as:

- Vertical bars showing goroutine state.
- Arrows from waker to wakee for channel ops.
- Per-goroutine block-time breakdowns.

The trace events are emitted *inside* the channel lock for the parking goroutine, and inside the waker for the wake event. Trace cost is ~50–100 ns per event when enabled; ~0 when disabled.

### `traceskip`

`traceskip` (the integer argument to `gopark`) tells the trace machinery how many frames to skip when capturing a stack trace for this block. For a channel send park, `traceskip = 2` (skip `gopark` and the inner function that called it), so the trace shows the user code that did `ch <- v`.

---

## `gopark` Reason Codes

`gopark` accepts a `waitReason` that names why the goroutine is parking. For channels:

- `waitReasonChanSend` ("chan send")
- `waitReasonChanReceive` ("chan receive")
- `waitReasonChanSendNilChan` ("chan send (nil chan)")
- `waitReasonChanReceiveNilChan` ("chan receive (nil chan)")
- `waitReasonSelect` ("select")
- `waitReasonSelectNoCases` ("select (no cases)")

These show up in goroutine dumps (`SIGQUIT`, `runtime.Stack`, `pprof goroutine`):

```
goroutine 5 [chan receive]:
main.consumer(...)
    /tmp/main.go:14
```

The "chan receive" label tells you the goroutine is parked on a `chanrecv`. The line number points to your `<-ch`.

---

## Goroutine State Transitions

State machine for a goroutine in a channel operation:

```
_Grunnable  (in some runqueue)
    |
    v  (scheduler picks)
_Grunning   (executing chansend/chanrecv)
    |
    v  (gopark)
_Gwaiting   (parked on sendq or recvq, gp.waitreason = "chan send/receive")
    |
    v  (peer's chansend/chanrecv calls goready)
_Grunnable  (added back to a runqueue)
    |
    v  (scheduler picks)
_Grunning   (resumes after gopark)
```

The transition `_Grunning → _Gwaiting` is done by `park_m` via `casgstatus`. The transition back is in `ready`.

If the goroutine is on a `select`, the same transitions apply but `gp.waiting` is a chain of multiple sudogs (one per case). The wake message arrives on whichever channel fired first; the others must be detached.

---

## Lock Contention and the Single-Mutex Bottleneck

`hchan.lock` is a *single* mutex protecting *all* operations on the channel. This means:

- N concurrent senders + M concurrent receivers all serialize on this lock.
- Throughput is bounded by `1 / (lock_acquire + work + unlock)`.
- For a simple buffered channel, work is ~50 ns, so the lock can sustain ~20M ops/sec.

For high-throughput applications, this becomes a bottleneck. Mitigations:

- **Larger buffer**: reduces the frequency of park/wake (which is the slow path), so a higher proportion of operations hit the cheap buffer path. Each individual op is the same speed, but you avoid the scheduler.
- **Multiple channels** (sharding): distribute traffic across N channels with N independent locks. Throughput scales linearly.
- **Avoid channels for purely shared state**: use `sync.RWMutex` or atomics if no signalling is needed.
- **Worker pool with task batching**: send batches of jobs, not individual jobs. Amortises the lock cost.

### Lock contention is observable

`go tool pprof -block` shows where goroutines spend time blocked. A hot channel shows up as a contention hotspot. The block profile reports the `chansend`/`chanrecv` call site.

### Why no lock-free channels in stdlib?

Multiple research efforts have built lock-free MPMC queues that outperform Go's channels on specific workloads. None has been adopted into stdlib because:

- The semantics (FIFO, closeable, select integration, direct handoff) are hard to maintain without the central lock.
- Most Go programs are not bottlenecked on channel throughput.
- The runtime team values predictable performance over peak performance.

Third-party libraries (e.g., `chrislusf/glow/queue`, `Workiva/go-datastructures/queue`) provide alternatives.

---

## Select Integration

A `select` statement compiles to `runtime.selectgo`, which is essentially a generalisation of `chansend`/`chanrecv` over multiple channels.

```go
select {
case v := <-ch1:
    ...
case ch2 <- x:
    ...
default:
    ...
}
```

becomes (roughly):

```go
cases := [2]scase{
    {c: ch1, kind: caseRecv, elem: &v},
    {c: ch2, kind: caseSend, elem: &x},
}
i, recvOK := selectgo(&cases[0], &order[0], &order[2], 2, hasDefault)
```

`selectgo`:

1. Shuffles case order randomly (the famous "select randomness").
2. Phase 1: tries each case non-blocking (`block = false`). If any succeeds, done.
3. If none and no default: phase 2 — lock all channels in order, try again, if still none, allocate one sudog per case, enqueue on every channel's queue, gopark.
4. When woken (by any channel firing), figure out which case fired, dequeue from the other channels' queues, return.

The integration with `chansend`/`chanrecv` is the shared `send`/`recv` helpers. They handle a sudog whether it came from a single-channel park or a select-array park.

For our purposes: every send and receive that happens through a `select` goes through the same `send`/`recv` paths. The only difference is the parking logic.

---

## Why Direct Handoff Is Not Always Possible

Direct handoff requires a peer already parked on the appropriate queue. It does *not* fire when:

- Both goroutines arrive simultaneously: one will lock the channel first, see no peer, take the buffer or park path. The other will then find this goroutine on the queue and do a direct handoff *on its next operation*.
- The channel is buffered and has data: senders cannot find parked receivers because receivers would have taken the buffered data and returned. So buffered-with-data channels never do "sender→receiver direct" — only "receiver→sender direct" via the buffer-promotion trick.
- The buffer is empty and a receiver is parked: the next sender does a direct handoff. ✓
- The buffer is full and a sender is parked: the next receiver does the buffer-promotion handoff. ✓

The invariant: at most one of `recvq` and `sendq` is non-empty. The runtime enforces this by always doing direct handoff when possible — if both queues could have entries, the runtime would do the handoff and drain one.

---

## `KeepAlive` and the Garbage Collector

In `chansend`:

```go
gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceBlockChanSend, 2)

// woken
KeepAlive(ep)
```

`KeepAlive(ep)` is a compiler intrinsic that ensures `ep` (the pointer to the value being sent) is not garbage collected before this point. Without it:

- The sender's stack frame might be deallocated by the GC if the compiler decided `ep` was no longer used.
- The receiver, doing the handoff, would read from invalid memory.

This is unusual: normally Go's escape analysis figures out lifetimes. But because the value is referenced indirectly through `sg.elem` (which the GC can't follow back to `ep`'s stack location), `KeepAlive` is needed as a hint.

---

## Cost Breakdown on Real Hardware

Numbers on a 3.4 GHz Intel Skylake (single thread, hot cache):

| Operation | ns | cycles |
|---|---|---|
| Function call overhead | 1 | 3 |
| `lock(&c.lock)` uncontended | 5 | 17 |
| `unlock(&c.lock)` | 5 | 17 |
| `typedmemmove` of 8 bytes | 2 | 7 |
| `typedmemmove` of 64 bytes | 5 | 17 |
| `acquireSudog` (cache hit) | 8 | 27 |
| `releaseSudog` (cache hit) | 6 | 20 |
| `goready` (no `wakep`) | 25 | 85 |
| `wakep` (start new M) | 5000+ | 17000+ |
| `gopark` + park_m + schedule | 80 | 270 |
| Context switch to another G | 30 | 100 |

Putting these together:

**Buffer hop** (send into empty buffer slot):
```
lock         5
mem ops      5
unlock       5
total       ~20-30 ns
```

**Direct handoff** (sender finds parked receiver):
```
lock                  5
recvq.dequeue         2
sendDirect (memmove)  5
unlock                5
goready              25
context switch       30
total                ~75-100 ns (sender side)
```

The receiver, when scheduled, just does cleanup:
```
KeepAlive
releaseSudog (cache hit) 6
total: ~10 ns
```

**Park-and-wake** (no peer, no buffer room):
```
lock                  5
acquireSudog          8
sendq.enqueue         2
gopark + park_m      80
... wait ...
peer's chansend's lock + recv + goready  ~80 ns
context switch back  30
KeepAlive + releaseSudog                10
total: ~200-220 ns + scheduling latency
```

The dominant cost in the slow path is `gopark + park_m + context switch`, not the lock or the memmove.

---

## Summary

The senior view of send/receive: direct handoff is a memmove across two goroutines' stacks, protected by `hchan.lock` and `gp.activeStackChans`. The buffered-with-queued-sender path uses a clever "promote sender into buffer" maneuver to preserve FIFO. `sudog.elem` is the address of the value, valid only while the goroutine is parked and the channel is locked. Stack moves coordinate with channel locks to keep `sudog.elem` valid.

The race detector treats every send as a release event and every receive as an acquire, anchored at `chanbuf(c, 0)`. `runtime/trace` emits block/unblock events. `gopark` reason codes show up in goroutine dumps.

The single `hchan.lock` is the throughput ceiling: ~20M ops/sec for simple buffered ops. Beyond this, shard your channels.

Direct handoff: ~75–100 ns. Park-and-wake: ~200+ ns. Buffer hop: ~20–30 ns. All comparable to `sync.Mutex` round-trips.

The professional level walks through the actual `runtime/chan.go` source.
