# Send/Receive Flow — Interview Questions

A bank of questions from "what does `<-ch` do" up to "trace the direct handoff in `runtime/chan.go`." Each comes with an expected answer.

## Table of Contents
1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Staff / Principal Level](#staff--principal-level)
5. [Quick-Fire Round](#quick-fire-round)
6. [System Design Adjacent](#system-design-adjacent)
7. [Code-Reading Round](#code-reading-round)

---

## Junior Level

### Q1. What does the Go compiler do when it sees `ch <- v`?

**Expected**: It lowers it to a call to `runtime.chansend1(ch, &v)`. The value `v` is stored in a stack temporary first, and its address is passed.

### Q2. What are the three possible outcomes when a goroutine calls `chansend`?

**Expected**:
1. Direct handoff — a receiver is already parked, the value is copied directly to it, the receiver is woken.
2. Buffer hop — the channel has a buffer with room, the value is copied into the buffer slot.
3. Park — no receiver, no buffer room, the sender allocates a sudog and goes to sleep on `sendq`.

Plus the panic case (closed channel) and the nil-channel case (blocks forever).

### Q3. What is the difference between `chanrecv1` and `chanrecv2`?

**Expected**: `chanrecv1` corresponds to `v := <-ch` and returns nothing. `chanrecv2` corresponds to `v, ok := <-ch` and returns a boolean indicating whether a real value was received (true) or the channel was closed and drained (false).

### Q4. What happens when you receive from a closed channel?

**Expected**: If the buffer has data, you get the next buffered value with `ok == true`. If the buffer is empty, you get the zero value of the element type immediately with `ok == false`. You never block.

### Q5. What happens when you send to a closed channel?

**Expected**: Panic with the message "send on closed channel". The goroutine dies unless `recover` is in place.

### Q6. What happens with a nil channel?

**Expected**: Both send and receive block forever. There is no panic. The runtime calls `gopark` with `traceBlockForever`.

### Q7. Why is the buffer-with-room path faster than direct handoff?

**Expected**: The buffer path does not involve the scheduler. It just locks, copies into the buffer slot, unlocks. Direct handoff also locks and copies, but additionally calls `goready` to wake the receiver, which involves a context switch.

### Q8. What is FIFO order in a buffered channel?

**Expected**: Values are dequeued in the same order they were enqueued. The runtime enforces this via the `recvx` (read index) and `sendx` (write index) of the ring buffer. Even when senders park (because the buffer is full), the runtime uses the "sender promotion" trick to keep FIFO order.

---

## Middle Level

### Q9. Walk through what happens when goroutine A does `ch <- 1` (unbuffered) and goroutine B does `v := <-ch`, with A parking first.

**Expected**:
1. A enters `chansend`, locks `c.lock`. `recvq` empty, no buffer, `block == true`.
2. A allocates a sudog (`mysg`), sets `mysg.elem = &1`, enqueues on `sendq`, calls `gopark(chanparkcommit, ...)`.
3. `chanparkcommit` releases `c.lock` atomically with the park. A is now `_Gwaiting`.
4. B enters `chanrecv`, locks `c.lock`.
5. B sees `c.closed == 0`, calls `c.sendq.dequeue()` → gets A's sudog.
6. B calls `recv(c, sg, ep, ...)`. Since `c.dataqsiz == 0`, `recvDirect` runs: `memmove` from `sg.elem` (A's stack) into `*ep` (B's destination).
7. `unlockf` releases `c.lock`. `sg.success = true`. `goready(A)`.
8. B returns `(true, true)`.
9. Scheduler picks up A. A wakes from `gopark`, releases sudog, returns from `chansend`.

### Q10. What does `gp.activeStackChans = true` mean?

**Expected**: It tells the runtime's stack mover that this goroutine has sudogs whose `elem` field points into the goroutine's stack. Before moving the stack, the mover must take all the channel locks the goroutine is parked on, then call `adjustsudogs` to update those pointers.

### Q11. Why does the runtime use a single mutex (`hchan.lock`) instead of separate locks for send and receive?

**Expected**: Several reasons:
- The single lock makes the state machine simpler: when you hold the lock, you have a consistent view of all channel state.
- Direct handoff requires inspecting both queues atomically; with separate locks, this would require a complex two-lock ordering.
- The buffer indices (`sendx`, `recvx`) are touched by both sides; sharing a lock avoids artificial ordering.
- For most workloads, the lock is uncontended; sharding it would not pay off.

### Q12. What is `KeepAlive(ep)` in `chansend` for?

**Expected**: After `gopark` returns, the runtime must ensure that the value the sender was sending (pointed to by `ep`) was not garbage-collected during the park. `KeepAlive` is a compiler intrinsic that prevents the compiler from determining `ep` is dead. Without it, the receiver might `memmove` from freed memory.

### Q13. What is the difference between `_Gwaiting` and `_Grunnable`?

**Expected**: `_Gwaiting` means "this goroutine is parked; do not schedule it until someone calls `goready`." `_Grunnable` means "this goroutine wants CPU; pick it from a runqueue." A `gopark` transitions `_Grunning → _Gwaiting`; a `goready` transitions `_Gwaiting → _Grunnable`.

### Q14. What does `runqput(p, gp, next)` do, and why is `next = true` for channel wakes?

**Expected**: It pushes `gp` onto the local P's runqueue. If `next == true`, it goes into the "next slot," which is checked first by the scheduler. For channel wakes, `next = true` is used to favour the just-readied goroutine over older runnable goroutines — this is what makes channel handoff feel low-latency.

### Q15. Is `ch <- v` an atomic operation from the user's perspective?

**Expected**: Yes, semantically. From the user's perspective, the send happens or it does not (the goroutine resumes or panics or blocks forever). Internally, it is not atomic — it involves a lock and a sequence of memory operations. But the lock provides the atomicity illusion.

---

## Senior Level

### Q16. Explain how the buffered-channel-with-queued-sender case works in `recv`.

**Expected**: When a receiver finds the channel's buffer full *and* a sender parked on `sendq`:
1. The receiver reads `buf[recvx]` into its own destination (this is the oldest buffered value, preserving FIFO).
2. The receiver writes the sender's value (`sg.elem`) into `buf[recvx]` (which is now empty).
3. `recvx` advances. The implementation also sets `sendx = recvx` because the buffer's "write head" effectively rotates by one slot.

The net effect: the sender's value enters the buffer in its proper FIFO position, and the next receive will pick it up.

### Q17. Why does `sendDirect` use `typeBitsBulkBarrier` instead of `typedmemmove`?

**Expected**: `typedmemmove` calls `bulkBarrierPreWrite`, which expects the destination to be in the heap. But for direct handoff, the destination is another goroutine's stack — not the heap. `typeBitsBulkBarrier` is the variant that emits write barriers based on the type's pointer layout without assuming the destination is heap memory. This ensures the GC sees the pointer writes correctly.

### Q18. What is the cost difference between direct handoff and park-and-wake, and why?

**Expected**: Direct handoff: ~75–100 ns. Park-and-wake: ~200+ ns. The difference comes from:
- Park-and-wake requires `gopark` + context switch + scheduler dispatch + `goready` + context switch back.
- Direct handoff requires only one `memmove`, one lock, and one `goready`.
- Each context switch costs ~30 ns on a modern CPU.

For a channel handoff that has both goroutines ready at the same time, direct handoff is the optimal path.

### Q19. How does the race detector validate channel-based synchronisation?

**Expected**: The race detector instruments `chansend` to emit a `release` event and `chanrecv` to emit an `acquire` event, anchored at `chanbuf(c, 0)` (the buffer base address, which is stable). When a send is followed by a receive on the same channel, the release-acquire pair establishes a happens-before edge. Any data written by the sender before the send is therefore visible to the receiver after the receive — no race.

### Q20. Suppose 1000 goroutines are blocked on `recvq` of a channel, and the channel is closed. What happens?

**Expected**: `closechan` acquires `c.lock`, sets `c.closed = 1`, then walks `c.recvq` and `c.sendq` to drain each waiting sudog:
- For each receiver: write zero to `sg.elem` (the receiver's destination), set `sg.success = false`, push onto a temporary `glist`.
- After unlock, `goready(gp)` for each waiter.

Cost: ~50 ns per drained waiter + ~25 ns per `goready`. For 1000 receivers, ~75 µs.

### Q21. What is the difference between `block == true` and `block == false` in `chansend`?

**Expected**:
- `block == true`: the normal `ch <- v` form. The runtime parks the goroutine if the send cannot complete immediately.
- `block == false`: the non-blocking form, used by `select` cases that should not wait. If the send cannot complete (buffer full or no receiver), the runtime returns `false` immediately without parking.

The fast-path probe at the top of `chansend` (`!block && c.closed == 0 && full(c)`) skips the lock entirely for `select` cases that obviously cannot proceed.

### Q22. Explain "the moment-in-time argument" for the lock-free fast path in `chansend`.

**Expected**: The fast path reads `c.closed` and `c.qcount` without atomics. The argument is:
- Observing `c.closed == 0` means the channel was open at *some moment*.
- Observing `c.qcount == c.dataqsiz` (full) means the channel was full at *some moment*.
- These observations can be reordered by the CPU/compiler, but their conjunction implies: at some moment, the channel was both open and full. Returning "cannot send" (false) is consistent with that moment.
- The function does not guarantee forward progress; it relies on the side effects of later lock-protected operations (in `chanrecv` and `closechan`) to update memory.

This avoids atomic operations on the hot path while still being memory-safe.

### Q23. Why can a parked goroutine's stack be moved (grown) without violating sudog invariants?

**Expected**: The stack mover (`copystack`) checks `gp.activeStackChans`. If true, it first acquires the channel locks of every channel the G is parked on (via `gp.waiting` chain). Then it copies the stack, updates each `sg.elem` to the new stack address via `adjustsudogs`, and releases the locks. This serialises stack movement with channel operations on the same G.

---

## Staff / Principal Level

### Q24. Design a custom channel implementation in user code that supports a "priority" mode — high-priority sends wake any receiver before low-priority sends. What would you change in the runtime's design?

**Expected**: Notes that would be evaluated:
- A priority channel would need two `sendq`s (or one priority-sorted queue) instead of a single FIFO. The lock-protected dequeue would pick the high-priority one first.
- The semantics break the language's FIFO guarantee. A custom channel would need to be an explicit type with its own `Send` and `Recv` methods, not the language's `<-`.
- Direct handoff still applies, but the choice of which sender to wake becomes priority-based, not FIFO.
- The runtime's `select` integration would not work for a custom channel; you would lose select.
- Cost: dequeue becomes O(log N) for a heap, or O(1) for two FIFOs.

### Q25. The runtime's channel lock is a "spin then sleep" futex on Linux. Trace what happens to a sender that contends on this lock.

**Expected**:
- The sender's `lock(&c.lock)` calls into `runtime/lock_futex.go`.
- Tries CAS to acquire; if fails, spins for a few iterations (~30 cycles each).
- If still contended, calls `futexsleep` (a `futex(2)` syscall with `FUTEX_WAIT`).
- The kernel parks the OS thread.
- When the lock holder calls `unlock`, it does CAS to release; if waiters are noted, calls `futexwakeup` (`FUTEX_WAKE`).
- The kernel wakes one parked thread, which retries the CAS.

For a hot channel with many waiters, this devolves into mostly futex calls; throughput drops. This is the throughput ceiling of ~20M ops/sec.

### Q26. Suppose you want to implement a "channel with bounded waiters" that panics if more than N goroutines are blocked at once. How would you build it in user code?

**Expected**:
- Wrap the channel in a struct with an atomic waiter counter.
- Before `<-ch`, atomically increment the counter; if it exceeds N, decrement and panic.
- The counter is updated outside the channel's own machinery; you can't reach into `recvq` from user code.
- For correctness under cancellation, also decrement when the receive returns (defer the decrement).
- Discuss the lack of atomicity: the counter and the actual park are not protected together. A burst of receivers could push the counter over N before any of them parks.

### Q27. Walk through the GC interaction with a parked sender. Where might the GC need to scan?

**Expected**:
- The sender's stack: the GC normally scans it when the G is parked. The runtime walks the G's stack and reports pointers.
- The sudog's `elem` field: this is a `unsafe.Pointer` to the value. The GC must follow it. For interior pointers into stacks, the runtime's stack scanner sees the value through the regular stack walk.
- The channel itself: the `hchan` and its buffer are scanned as part of the global heap walk.
- Key invariant: even though the sudog has a pointer into the sender's stack, the sender's stack is reachable from the G itself, so the GC reaches the value via the G's stack scan, not via the sudog. The sudog's elem is "redundant" for GC purposes.

### Q28. Why does Go's channel implementation not scale linearly with cores for high-contention workloads?

**Expected**:
- Single `hchan.lock` serialises all operations. Multi-core throughput on a single channel is capped at ~20M ops/sec.
- Lock-free MPMC queues exist (e.g., Vyukov's bounded MPMC) that scale linearly, but they sacrifice features (no close semantics, no select integration, no direct handoff that preserves stack-only allocation).
- The Go team's position: most programs don't bottleneck on a single channel. If you do, shard the work.

### Q29. Compare Go's channel send/receive to a `sync.Cond.Wait` / `Signal` pattern.

**Expected**:
- Channels combine signalling + value transfer + close semantics in one primitive.
- `Cond` is just signalling; you must manage the data buffer yourself.
- Channels have a built-in mutex; `Cond` requires you to pair it with a separate mutex.
- Channels integrate with `select`; `Cond` does not.
- Cost: similar per operation on the happy path. Channels' direct handoff is slightly faster than a `Cond` wake because there is no second mutex acquisition.

### Q30. If you had to redesign `chansend` for Go 2, what would you change?

**Expected** (open-ended, looking for thoughtful trade-offs):
- Make `closed` an atomic with explicit memory ordering on every check (already mostly done).
- Add a `try_send` API that returns `(bool, err)` instead of panicking. Less footgun.
- Optional: allow non-blocking close without panic for already-closed channels (return error).
- Optional: a runtime-supported "broadcast send" that sends one value to all current receivers atomically.
- Optional: a generic typed channel API that uses the type system to enforce ownership (one sender or many).
- Each of these has costs and breaks existing code; that is the discussion.

---

## Quick-Fire Round

| Question | Expected answer |
|---|---|
| Q: What function does `ch <- v` lower to? | A: `runtime.chansend1(ch, &v)` |
| Q: What function does `v := <-ch` lower to? | A: `runtime.chanrecv1(ch, &v)` |
| Q: What function does `v, ok := <-ch` lower to? | A: `runtime.chanrecv2(ch, &v)` |
| Q: What returns from a closed empty channel? | A: zero value, `ok=false` |
| Q: What happens to a sender parked on a channel that gets closed? | A: Wakes and panics ("send on closed channel") |
| Q: What is the latency of a hot direct handoff? | A: 40-100 ns |
| Q: What is the latency of park-and-wake? | A: 200+ ns |
| Q: Lock-free fast path in `chansend`? | A: `!block && c.closed == 0 && full(c) -> return false` |
| Q: What is `sg.success`? | A: Set by the waker; true = value transferred, false = closed |
| Q: What is `chanparkcommit`? | A: The unlockf callback for gopark that atomically releases the channel lock |

---

## System Design Adjacent

### Q31. You are designing a job queue with 1M jobs/sec throughput. Channel or queue library?

**Expected**: At 1M jobs/sec on a single channel, you are at ~5% of the channel's lock-bound throughput. Channel is fine. At 10M, you start to see contention. Consider sharding the channel into N=GOMAXPROCS partitions.

### Q32. You have a goroutine that sends to a channel that nobody reads from. What happens?

**Expected**: The sender parks on `sendq` and stays parked forever. The goroutine is a leak. Detect via:
- `runtime/pprof` goroutine profile.
- Periodic `runtime.NumGoroutine()` counter check.
- Manual review: every channel send should have a known receiver.

### Q33. You have a `select` with two cases on the same channel — one send, one receive. Is this legal?

**Expected**: Yes, legal. The runtime randomises case order, so either may fire. In practice, this is rare and usually a sign of confusion. If you actually want both, separate the channel into two channels.

---

## Code-Reading Round

### Q34. Read this snippet from `runtime/chan.go`:

```go
if sg := c.recvq.dequeue(); sg != nil {
    send(c, sg, ep, func() { unlock(&c.lock) }, 3)
    return true
}
```

Explain.

**Expected**:
- Dequeue the head of `recvq` (FIFO).
- If non-nil, a receiver was parked. Call `send(c, sg, ep, unlockf, skip)`:
  - `c` is the channel.
  - `sg` is the receiver's sudog.
  - `ep` is the sender's value pointer.
  - The unlockf closure releases the channel lock when called inside `send`.
  - `skip = 3` is the trace skip count.
- `send` does the direct handoff (`sendDirect`) and `goready`s the receiver.
- Returns `true` (the send succeeded).

### Q35. Read this snippet:

```go
if c.qcount > 0 {
    qp := chanbuf(c, c.recvx)
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

Explain.

**Expected**:
- This is `chanrecv`'s buffer-read path.
- `qcount > 0`: buffer has data.
- `chanbuf(c, c.recvx)`: pointer to `buf[recvx]`.
- `typedmemmove(elemtype, ep, qp)`: copy the buffered value into receiver's destination.
- `typedmemclr(elemtype, qp)`: zero the now-empty buffer slot so the GC won't see stale pointers.
- Advance `recvx` modulo `dataqsiz`.
- Decrement `qcount`.
- Unlock, return `(selected=true, received=true)`.

### Q36. Read this snippet:

```go
gp.parkingOnChan.Store(true)
gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceBlockChanSend, 2)
KeepAlive(ep)
```

Explain.

**Expected**:
- `parkingOnChan.Store(true)`: a flag for the stack shrinker. Tells it the G is about to park on a channel; do not move the stack in this brief window.
- `gopark(chanparkcommit, &c.lock, ...)`: park the goroutine. `chanparkcommit` is the callback that will release `c.lock` atomically with the park. `waitReasonChanSend` shows up in goroutine dumps as "chan send".
- `KeepAlive(ep)`: when we resume, ensure `ep` is still alive (compiler intrinsic). Necessary because the value at `*ep` was being read by the receiver while we slept.

---

These questions cover the spectrum from "I have read the docs" to "I have read the source and can reason about edge cases." Senior interviews typically focus on Q15-Q23; staff interviews on Q24-Q30.
