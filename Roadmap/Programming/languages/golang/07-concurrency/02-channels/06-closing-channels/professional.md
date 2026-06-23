# Closing Channels — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `hchan` Structure and the `closed` Field](#the-hchan-structure-and-the-closed-field)
3. [`closechan` Step by Step](#closechan-step-by-step)
4. [Sudog Queues: Recvq and Sendq](#sudog-queues-recvq-and-sendq)
5. [Atomic Visibility of the Close](#atomic-visibility-of-the-close)
6. [Panic Paths in `chansend`, `chanrecv`, and `closechan`](#panic-paths-in-chansend-chanrecv-and-closechan)
7. [Interaction with the Scheduler](#interaction-with-the-scheduler)
8. [Cost Model](#cost-model)
9. [Race Detector and Close](#race-detector-and-close)
10. [Memory and GC](#memory-and-gc)
11. [Reading the Runtime Source](#reading-the-runtime-source)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

At professional level, "what does close do" has a precise answer in runtime source. This file walks through `runtime/chan.go` — the file that implements channels — and explains how `close` interacts with the scheduler, the memory model, and the race detector.

Code references are to Go 1.22 (representative of recent releases). The functions and structures evolve slowly; the broad shape has been stable since Go 1.0. Cross-references to the source are inline with file paths and (approximate) line numbers.

After this file you will:

- Read the `hchan` struct definition and identify the role of each field.
- Trace the execution of `close(ch)` through `closechan`.
- Understand the sudog drain: how receivers and senders are unblocked.
- Identify the precise points where panics occur and why.
- Reason about lock contention and atomic ordering during close.
- Read pprof block profiles for channel operations.

---

## The `hchan` Structure and the `closed` Field

The channel header (`runtime/chan.go`, around line 35):

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue (buffer)
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32         // 0 = open, 1 = closed
    elemtype *_type
    sendx    uint           // send index (circular buffer head)
    recvx    uint           // recv index (circular buffer tail)
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters
    lock     mutex          // protects all fields above (and itself)
}

type waitq struct {
    first *sudog
    last  *sudog
}
```

Field-by-field, relevant to close:

- **`closed`**: a `uint32` flag. `0` open, `1` closed. Once set to `1`, never reset. Accessed both under `lock` and via atomic loads (the fast path in `chansend`/`chanrecv`).
- **`recvq`**: linked list of goroutines parked in `<-ch`. When `close` runs, every element is woken with a "channel closed" outcome.
- **`sendq`**: linked list of goroutines parked in `ch <- v`. When `close` runs, every element is woken with a panic ("send on closed channel").
- **`buf`**: the buffered values, if any. Close does not free it; the consumer drains it through receives.
- **`lock`**: a runtime mutex (futex-backed on Linux). Held briefly during operations.

### sudog: the waiter representation

A `sudog` is the runtime's per-blocking-event "I'm waiting" record:

```go
type sudog struct {
    g *g                  // the goroutine
    next *sudog
    prev *sudog
    elem unsafe.Pointer   // points to the value being sent/received
    // ... a few more fields
}
```

When a goroutine blocks on `<-ch` or `ch <- v`, the runtime allocates a sudog, links it into `recvq` or `sendq`, parks the goroutine, and returns to the scheduler. The sudog is freed when the goroutine resumes.

---

## `closechan` Step by Step

The implementation (`runtime/chan.go`, around line 380, simplified):

```go
func closechan(c *hchan) {
    if c == nil {
        panic(plainError("close of nil channel"))
    }

    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("close of closed channel"))
    }

    if raceenabled {
        callerpc := getcallerpc()
        racewritepc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(closechan))
        racerelease(c.raceaddr())
    }

    c.closed = 1

    var glist gList

    // release all readers
    for {
        sg := c.recvq.dequeue()
        if sg == nil {
            break
        }
        if sg.elem != nil {
            typedmemclr(c.elemtype, sg.elem) // write zero value to receiver's destination
            sg.elem = nil
        }
        if sg.releasetime != 0 {
            sg.releasetime = cputicks()
        }
        gp := sg.g
        gp.param = unsafe.Pointer(sg) // tells the woken goroutine: "closed"
        sg.success = false
        if raceenabled {
            raceacquireg(gp, c.raceaddr())
        }
        glist.push(gp)
    }

    // release all writers (they will panic)
    for {
        sg := c.sendq.dequeue()
        if sg == nil {
            break
        }
        sg.elem = nil
        if sg.releasetime != 0 {
            sg.releasetime = cputicks()
        }
        gp := sg.g
        gp.param = unsafe.Pointer(sg)
        sg.success = false
        if raceenabled {
            raceacquireg(gp, c.raceaddr())
        }
        glist.push(gp)
    }
    unlock(&c.lock)

    // Ready all Gs now that we've dropped the channel lock.
    for !glist.empty() {
        gp := glist.pop()
        gp.schedlink = 0
        goready(gp, 3)
    }
}
```

Walk-through:

1. **Nil check**: `c == nil` panics with `"close of nil channel"`.
2. **Acquire channel lock**: mutual exclusion against all other operations on this channel.
3. **Already-closed check**: `c.closed != 0` panics with `"close of closed channel"`. This is why double-close panics — the runtime explicitly tests for it.
4. **Race-detector hook**: tells the race detector this is a release operation. We discuss this below.
5. **Set the flag**: `c.closed = 1`. This is the actual "close." Held under the lock; later observers via the slow path see it; the atomic store also gives lock-free readers visibility (see "Atomic Visibility" below).
6. **Drain `recvq`**: walk every parked receiver. For each:
   - Write the zero value into the receiver's destination (`typedmemclr`).
   - Set `gp.param` to the sudog (signals: "you were woken by close").
   - Set `sg.success = false` — the source of the `ok = false` value the receiver eventually sees.
   - Push onto a temporary `glist` (we wake them all after dropping the lock).
7. **Drain `sendq`**: walk every parked sender. For each:
   - Mark unsuccessful.
   - Push onto `glist`.
   - When this goroutine wakes, it sees `sg.success == false` and the channel is closed → it panics with `"send on closed channel"`.
8. **Release lock**: `unlock(&c.lock)`. Critical: we do not wake goroutines while holding the lock, to avoid contention.
9. **Ready all goroutines**: `goready(gp, 3)` puts each goroutine into the scheduler's runnable set. The scheduler picks them up.

### Why is the drain done under the lock?

So that no new sender or receiver can park between "set closed" and "drain." Without the lock, a new sender could park on `sendq` after `c.closed = 1` and never be drained.

### Why are gorountines readied outside the lock?

`goready` may need to take other locks (P or M locks). Holding the channel lock while taking those risks deadlock.

---

## Sudog Queues: Recvq and Sendq

A goroutine ends up on `recvq` when it executes `<-ch` and finds:

- The buffer is empty (or unbuffered).
- The channel is not closed.

It allocates a sudog, links it onto `recvq.last`, calls `gopark`, and yields.

Similarly, a goroutine ends up on `sendq` when:

- The buffer is full (or unbuffered with no waiting receiver).
- The channel is not closed.

### What `close` does to each queue

**`recvq` waiters** are *successfully* woken with the zero value. They receive nothing special at the call site — the receive returns `(zero, false)`. Their goroutines resume normal execution.

**`sendq` waiters** are woken to *panic*. When the sender resumes, it checks `sg.success`. If `false` and the channel is closed, the sender's `chansend` raises a runtime panic. The send call appears to return with a panic in flight.

This asymmetry — receivers succeed, senders panic — is the whole reason "close" is dangerous in multi-sender code: any sender mid-park during close panics on resumption.

### Queue ordering: FIFO

Both queues are FIFO. Receivers are woken in the order they parked; same for senders. There is no priority. The runtime does not reorder by goroutine "weight" or fairness — first-in, first-out.

The wake-up cost is O(N) in queue length, but each wake is constant-time. In practice, for a channel with thousands of receivers (e.g., a global `done` channel), the close call holds the lock for milliseconds at most.

---

## Atomic Visibility of the Close

`chansend` and `chanrecv` have a fast path that checks `c.closed` without taking the lock. This avoids lock contention for already-closed channels.

```go
// in chansend (simplified)
if !block && c.closed == 0 && full(c) {
    return false
}
```

The `c.closed == 0` check is a plain load. For correctness, the close must be visible across goroutines without explicit acquire/release per send.

The runtime relies on the fact that `closechan` performs the store of `c.closed = 1` *under the lock*, and any concurrent reader either:

- Takes the lock and sees `closed = 1`, or
- Misses the close on the fast path, then proceeds to acquire the lock and re-check.

A send-on-just-closed race goes: sender's fast path sees `closed == 0` (stale), proceeds, takes the lock, then `chansend`'s slow path re-checks `closed` and finds `1`, then panics. The order of operations matters: re-check after locking ensures correctness.

Modern Go uses `atomic.Load` for these reads (since Go 1.19 introduced more atomic awareness in chan.go), but the principle is the same: every "is it closed" check after the fast path is under the lock.

---

## Panic Paths in `chansend`, `chanrecv`, and `closechan`

### `chansend` panic

```go
// after acquiring the lock
if c.closed != 0 {
    unlock(&c.lock)
    panic(plainError("send on closed channel"))
}
```

When a sender takes the lock and finds the channel closed, it panics. This is reached:

- After a fast-path miss (sender thought channel was open).
- After a `sendq` wake-up by `closechan`.

### `closechan` panic

Already shown: nil-close and double-close both panic.

### `chanrecv` does *not* panic

Receivers cannot panic from close. The behaviour is "return zero with ok=false." This asymmetry is the entire reason receivers are "safer" than senders in close interactions.

### `recover` after a channel panic

A `defer recover()` in the same goroutine catches a "send on closed channel" panic. The goroutine continues from the next statement. The channel is unchanged: still closed, still panics on next send. The recovery is a band-aid.

```go
func safeSend(ch chan int, v int) (ok bool) {
    defer func() {
        if recover() != nil {
            ok = false
        }
    }()
    ch <- v
    return true
}
```

This works but does not solve the underlying race; it just hides the symptom. The channel state is shared, and another goroutine may send and panic next.

---

## Interaction with the Scheduler

`goready(gp, 3)` adds the goroutine to a run queue. The "3" is the traceback skip count for trace events. The scheduler picks the goroutine up based on:

- The local P's run queue (if space).
- Otherwise the global run queue.

A close that drains 100 receivers therefore enqueues 100 goroutines. The scheduler's load balancing distributes them across Ps. For 100 cores and 100 woken goroutines, parallel resumption is possible.

### Cost of waking many

`goready` itself is cheap (~100 ns per call). 100 wakes = ~10 µs. The bigger cost is the goroutines themselves running: each does a few memory loads, checks `sg.success`, returns from `<-ch`.

For broadcast on the order of thousands of receivers, plan ~100 µs of CPU on the closing goroutine. Not a hot-path operation, but acceptable for shutdown.

### Channel close as a preemption opportunity

After `closechan` returns, the closing goroutine continues. The newly-readied goroutines wait in run queues. If GOMAXPROCS > 1, they run on other Ms. If GOMAXPROCS = 1, they wait for the closing goroutine to yield (or be preempted async).

### `runtime/trace` view

In `go tool trace`, a close shows up as:

- A `chan close` event on the closing goroutine.
- A `chan recv` or `chan send` event on each woken goroutine.
- Goroutine state transitions: `_Gwaiting → _Grunnable → _Grunning`.

Use `runtime/trace.WithRegion` to label your shutdown phase; then in the trace UI you can see how long the close-and-resume took.

---

## Cost Model

Approximate costs on a modern CPU (Intel Xeon class, 2024):

| Operation | Cost |
|---|---|
| `close(ch)` with empty queues | ~50–100 ns |
| `close(ch)` with N receivers | ~50 ns + ~200 ns × N |
| Receive on a closed empty channel | ~30 ns |
| Send on closed (panic path) | ~200 ns + stack-trace gen + panic propagation |
| `recover` after channel panic | ~1 µs |
| Lock contention on hot channel | variable; up to tens of µs under contention |

These are wall-clock estimates. Close itself is rarely a hot path; "the cost of close" only matters when you close in a hot loop (which you should not).

### Pathological cases

- A channel with 100 000 receivers parked: close takes ~20 ms while holding the lock. During those 20 ms, no other operation on this channel proceeds. Usually fine; pathological if mid-hot-path.
- Close from a goroutine pinned via `LockOSThread`: the thread is occupied during the close. If the M cannot be borrowed by other goroutines (because it is locked), other Gs wait.

---

## Race Detector and Close

The race detector (`go test -race`) instruments `closechan` to emit a "release" event:

```go
racerelease(c.raceaddr())
```

Any subsequent receive that *observes the close* emits a matching "acquire":

```go
raceacquire(c.raceaddr())
```

This is the runtime's machinery for the memory model guarantee: writes before close happen-before reads after close.

Practical consequence: if you write data in goroutine A *before* closing a channel, then read data in goroutine B *after* observing the close, the race detector certifies this is race-free.

If you write data in A *after* closing the channel (because some second goroutine is still using it), the race detector reports a data race. The "close as synchronisation" pattern only works for writes that happen *before* the close in the closer's view.

### Inspecting close behaviour with `-race`

```go
var data []int
done := make(chan struct{})
go func() {
    data = []int{1, 2, 3}
    close(done)
}()
<-done
fmt.Println(data) // OK
```

No race.

```go
var data []int
done := make(chan struct{})
go func() {
    close(done)
    data = []int{1, 2, 3} // race
}()
<-done
fmt.Println(data) // reads racy data
```

Race detector reports this. The write happens *after* close; the close-acquire from `<-done` does not synchronise with it.

---

## Memory and GC

Closing does not free the channel. The channel is freed when no goroutine holds a reference to it (no `chan T` variable in scope, no field in a live struct).

Memory layout:

- `hchan` header: ~96 bytes.
- Buffer: `dataqsiz * elemsize` bytes.
- Sudogs: 64 bytes each, allocated per parked goroutine.

A closed channel with an empty queue is ~96 bytes plus header. Receivers can still pull zero values from it indefinitely; this does not allocate. A long-lived "always-closed done channel" is cheap.

### When does the GC reclaim a closed channel?

Standard GC rules: when no live pointer references the channel. The closed flag does not affect liveness.

### Sudog pooling

Sudogs are allocated from a per-P free list. When a goroutine parks, a sudog is taken from the pool; when the goroutine wakes (or is drained by close), the sudog is returned. Close performs many "return to pool" operations; these are constant time, ~50 ns each.

---

## Reading the Runtime Source

To study close in depth, the relevant files:

- `runtime/chan.go` — `hchan`, `makechan`, `chansend`, `chanrecv`, `closechan`. ~1000 lines. The whole file is essential reading for serious Go work.
- `runtime/select.go` — `selectgo`, the implementation of `select`. Heavily interacts with channel close.
- `runtime/race.go` — race detector hooks (CPU-conditional).
- `runtime/proc.go` — `goready`, `gopark`, scheduler operations.
- `runtime/runtime2.go` — `g`, `m`, `p`, `sudog` struct definitions.

Recommended path:

1. Read `hchan` struct.
2. Read `chansend` end-to-end, ignoring the race-detector branches.
3. Read `chanrecv` end-to-end.
4. Read `closechan`.
5. Read `selectgo` for the select interaction.
6. Read tests in `runtime/chan_test.go` to see what behaviours are explicitly verified.

The code is dense — lots of inline comments and conditionals for race, trace, and sync primitives. Print the key functions and annotate by hand the first time.

---

## Self-Assessment

- [ ] I can describe the `hchan` struct fields and which ones close modifies.
- [ ] I can trace `closechan` step by step from acquire-lock to ready-all.
- [ ] I can explain why receivers in `recvq` succeed and senders in `sendq` panic.
- [ ] I can articulate the role of the race detector hooks in `closechan` and how they implement the memory model.
- [ ] I can reason about the cost of close as a function of receiver and sender count.
- [ ] I have read at least `closechan` in the Go source code and could explain it line-by-line.
- [ ] I know that close holds the channel lock during drain, then unlocks before `goready`.
- [ ] I can describe what happens to a sudog from park to drain to wake.
- [ ] I can use `runtime/trace` to visualise a close-and-wake event.
- [ ] I know that the closed flag is one-way and never reset.

---

## Summary

`close` is a runtime function (`closechan`) that:

1. Panics if the channel is nil or already closed.
2. Acquires the channel lock.
3. Sets `closed = 1`.
4. Drains `recvq`, marking each receiver "channel closed" (zero value, ok=false).
5. Drains `sendq`, marking each sender for panic on resumption.
6. Releases the lock.
7. Wakes all drained goroutines via `goready`.

The "drain under the lock, wake outside the lock" pattern is what makes close safe under concurrency: no new waiters can join the queues mid-drain.

The race detector emits a `release` event at close and an `acquire` event at each receive that observes close. This implements the Go memory model's happens-before for close → receive.

Costs are dominated by queue length. Close on an unblocked channel is ~50 ns; close on a channel with N parked goroutines is ~200 ns per goroutine of drain. For real systems, close is not a hot path; the concern is correctness (panic-free, leak-free), not throughput.

The Go runtime treats channels as first-class synchronisation primitives. `closechan` is short — under 100 lines — and worth reading. Mastery here is mastery of a substantial portion of Go's concurrency machinery.
