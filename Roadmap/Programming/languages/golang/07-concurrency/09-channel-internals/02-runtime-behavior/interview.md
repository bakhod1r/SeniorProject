# Channel Runtime Behaviour — Interview Questions

## Junior

### Q1. What happens when you send to a closed channel?

**A.** A runtime panic with message `send on closed channel`. The send never delivers a value. Internally, `chansend` acquires `c.lock`, checks `c.closed != 0`, unlocks, and panics.

### Q2. What does `v, ok := <-ch` return when `ch` is closed?

**A.** `v` is the zero value of the channel's element type; `ok` is `false`. The receive does not block. Internally, `chanrecv` sees `c.closed != 0 && c.qcount == 0` and returns `(true, false)` after clearing `ep` to zero.

### Q3. What does `<-nil` do?

**A.** Blocks forever. `chanrecv` enters the `c == nil && block` branch and calls `gopark` with no commit function, so the goroutine sleeps with no chance of wake-up. The runtime's deadlock detector will eventually crash the program if all goroutines are similarly parked.

### Q4. What is direct hand-off?

**A.** When a sender finds a receiver already parked on `c.recvq`, the runtime copies the value directly from the sender's stack into the receiver's stack frame, skipping the channel buffer. The receiver is then woken with the value already in place. This saves one buffer copy and one lock-unlock pair vs the parked-sender path.

### Q5. Does `close(ch)` block until all buffered data is drained?

**A.** No. `closechan` returns immediately. It sets `c.closed = 1` and wakes all parked goroutines, but does not wait for buffered values to be consumed. Receivers can still drain the buffer after close.

---

## Middle

### Q6. Walk through what `chansend` does, step by step.

**A.**
1. If `c == nil` and blocking, park forever.
2. If non-blocking and channel is open but full, return false (no lock taken).
3. Acquire `c.lock`.
4. If `c.closed != 0`, unlock and panic.
5. If `c.recvq` has a parked receiver, dequeue it and perform direct hand-off: copy from sender's `ep` into receiver's `sg.elem`, mark `sg.success = true`, call `goready(receiver)`, unlock, return.
6. Else if `c.qcount < c.dataqsiz`, copy `ep` into `c.buf[c.sendx]`, advance `sendx` (mod cap), increment `qcount`, unlock, return.
7. Else if non-blocking, unlock and return false.
8. Else allocate a `sudog`, link it onto `c.sendq`, set `gp.waiting = sudog`, call `gopark` with `chanparkcommit` which unlocks the channel as part of parking.
9. On wake, check `sg.success`. If false, panic (channel was closed while parked). Otherwise the receiver has already taken our value; release the sudog and return.

### Q7. Why does `select` shuffle its cases?

**A.** The Go spec requires "uniform pseudo-random selection" among ready cases. The runtime shuffles `pollorder` (a permutation of case indices) with Fisher-Yates so each ready case has equal probability of being picked. Without shuffling, a select on multiple always-ready channels would always pick the first case in source order, starving the others.

### Q8. How does `select` avoid deadlocking against another `select`?

**A.** `selectgo` sorts the cases' channels by address (`uintptr`) into `lockorder`. All select statements in the program use the same address-based order, so they acquire shared locks in the same global sequence. Two selects on overlapping channel sets cannot form a deadlock cycle because both agree on min(addr) first.

### Q9. What is a `sudog`?

**A.** A "pseudo-G" — a small struct (~88 bytes) representing a goroutine parked on a synchronisation primitive (channel, mutex, condvar). It holds a pointer to the goroutine, the address of its data element (`elem`), a back-pointer to the channel, and bookkeeping fields. Sudogs are allocated from a per-P cache (`pp.sudogcache`) backed by a central free list, so most channel ops that park do not allocate from the heap.

### Q10. What does `gopark` do?

**A.** Transitions the current goroutine's status from `_Grunning` to `_Gwaiting`. Switches to the M's `g0` system stack via `mcall`. Runs the commit callback (e.g., `chanparkcommit` releases `c.lock`). Then `schedule()` finds a new goroutine to run. The parked goroutine stays in `_Gwaiting` until some waker calls `goready` on it.

### Q11. What guarantees do you get from the Go Memory Model when using a channel?

**A.** A send is synchronised before the completion of the corresponding receive. Any memory writes done before a send are visible to code that runs after the receive of that value. For buffered channels, the kth receive is synchronised before the (k + capacity)th send. Closing a channel is synchronised before any receive that returns due to closure.

---

## Senior

### Q12. Explain the full-buffer rotation case in `chanrecv`.

**A.** When `chanrecv` runs on a buffered channel whose buffer is full *and* whose `sendq` has a parked sender, the runtime does buffer rotation in the `recv` helper:

1. Copy `c.buf[recvx]` into the receiver's `ep` (the receiver gets the value at the head).
2. Copy the parked sender's `sg.elem` into the now-empty slot `c.buf[recvx]`.
3. Advance `recvx` (mod cap).
4. Set `sendx = recvx` (since the slot just written is now logically the tail of the full buffer).
5. Wake the parked sender.

Net effect: the receiver got the head value, the sender's value was admitted, the buffer remains full. Without this rotation, the runtime would have to drain a slot (qcount--) then re-add (qcount++) — same outcome, more work. The rotation is the optimised path.

### Q13. How does `chanparkcommit` work?

**A.** When `chansend` or `chanrecv` calls `gopark(chanparkcommit, &c.lock, ...)`, the runtime:

1. Casts goroutine status to `_Gwaiting`.
2. Switches to `g0` and calls `chanparkcommit(gp, &c.lock)`.
3. `chanparkcommit` sets `gp.activeStackChans = true`, clears `gp.parkingOnChan`, and calls `unlock(&c.lock)`.
4. Returns true to gopark, which then calls `schedule()`.

The key is the timing: the channel lock is released *after* the goroutine has fully parked (status set, sudog visible on the queue). This ensures no waker can find a half-parked sudog whose goroutine is still `_Grunning`.

### Q14. Why does the runtime set `gp.activeStackChans` before unlocking the channel?

**A.** Because Go can copy a goroutine's stack while it is parked (e.g., to shrink it). If a sudog references a location in the parked goroutine's stack (`sg.elem`), and the stack is moved, the sudog's pointer becomes stale. `gp.activeStackChans` signals to `copystack` that it must walk `gp.waiting` and adjust each sudog's `elem` to the new stack location. Without this flag, the GC could move the stack while a sender is mid-write, corrupting memory.

### Q15. Why doesn't `close` directly wake the parked goroutines while holding `c.lock`?

**A.** Waking a goroutine via `goready` puts it on a run queue and may invoke `wakep`, which can do non-trivial work (start an M, signal an idle P). Doing this under the channel lock would delay other channel operations.

The `closechan` implementation drains both wait queues into a local `gList` while holding the lock — only the dequeue work happens under the lock. Then it unlocks and iterates the gList calling `goready` on each goroutine. The wake-up overhead happens outside the critical section.

### Q16. What is the cost of an unbuffered channel send-receive pair when both goroutines are ready?

**A.** Roughly 100–200 ns on x86_64 for the rendezvous, comprising:

- Lock `c.lock`: ~3 ns (uncontended CAS).
- Find receiver in `recvq`: ~5 ns.
- `typedmemmove` cross-stack: ~10–30 ns depending on element size.
- `goready(receiver)`: ~30–50 ns (run-queue insertion).
- Unlock: ~3 ns.
- Plus the receiver wakes up: scheduler picks it up (~30 ns local-runq case, ~100 ns cross-P case).

Compared to a mutex Lock/Unlock pair (~25 ns uncontended), an unbuffered channel rendezvous is roughly 4–8x the cost. The trade-off is semantic clarity.

### Q17. What is the cost of a channel send that parks?

**A.** Several microseconds:

- The op itself: ~100 ns to lock, queue, prepare sudog.
- `gopark`: ~50–100 ns to set status, run commit, call schedule.
- The M switches goroutines: ~50–200 ns to dequeue another G and dispatch.
- Later, the receiver wakes the sender: `goready` adds it to a run queue.
- The scheduler picks the woken sender: more latency depending on P state.

End-to-end: 1–3 μs in low-contention scenarios; tens of μs under load. This is 100x the no-park case.

### Q18. How does `selectgo` clean up after a wake-up?

**A.** A `select` with K cases parks the goroutine on K channels (one sudog per case, all linked through `gp.waiting`). When one channel wakes the goroutine:

1. Acquire all channel locks (in `lockorder`) again.
2. Walk `gp.waiting`. For each sudog:
   - If this sudog matches the one that fired (set by the waker via `gp.param`), record its case index.
   - Else, dequeue this sudog from its channel's wait queue via `dequeueSudoG` (O(1) because the waitq is doubly linked).
   - Release the sudog to the per-P cache.
3. Release all channel locks.
4. Return the winning case index.

Without this cleanup, "orphan" sudogs would remain on other channels' queues, eventually causing the wrong goroutine to be woken when those channels saw activity.

---

## Staff / Architect

### Q19. Walk through what makes channel-based fan-out scale poorly to thousands of receivers.

**A.** Several factors compound:

1. `close(ch)` to broadcast wakes every receiver. Each wake is a `goready` call. For N receivers, that is N goroutine state transitions, N run-queue inserts, and N scheduler decisions. The closer is responsible for all of this — and it happens before `close` returns.

2. `c.lock` is a single point of contention. Even if you don't use close, every send and every receive contends on the same lock. Throughput is bounded by lock cycles per second (~10M).

3. Wake-up cache effects: the wakees are likely on different Ms/Ps from the waker. Each wake requires inter-core cache traffic.

To scale fan-out: use sharded channels (route by hash), use `sync.Cond` with `Broadcast` (similar wake-up cost but slightly different semantics), or use a closed-channel "done" signal where the fan-out is logically one wakeup per goroutine (not one-to-many).

### Q20. Could the Go runtime use a lock-free channel implementation? Why doesn't it?

**A.** Lock-free channels exist (e.g., Disruptor-style ring buffers), but:

- They are much more complex to implement correctly, especially with the close semantics Go requires.
- The Go memory model demands strict happens-before; lock-free implementations must use explicit memory barriers, which on weakly-ordered architectures (ARM) can be more expensive than a contended lock.
- The runtime mutex is already very fast for the short critical sections channels use (sub-microsecond uncontended). The cost saving would be small in absolute terms.
- Existing user code is built around the current behaviour. Subtle changes to ordering could break programs.

The Go team has rejected lock-free channel proposals citing complexity vs. minimal benefit. The current implementation is considered a good engineering trade-off.

### Q21. How would you design a benchmark that distinguishes direct hand-off from buffered fast path?

**A.**

```go
func BenchmarkUnbufferedHandoff(b *testing.B) {
    ch := make(chan int)
    go func() {
        for i := 0; i < b.N; i++ {
            ch <- i
        }
    }()
    for i := 0; i < b.N; i++ {
        <-ch
    }
}

func BenchmarkBufferedFastPath(b *testing.B) {
    ch := make(chan int, 1024)
    go func() {
        for i := 0; i < b.N; i++ {
            ch <- i
        }
    }()
    for i := 0; i < b.N; i++ {
        <-ch
    }
}
```

Run with `-benchmem -cpu=2`. The first should show ~200 ns/op (direct hand-off with one rendezvous per op). The second should show 50–80 ns/op (buffer fast path, no parking).

Pin to GOMAXPROCS=2 to avoid the producer and consumer landing on the same P (which would serialise them and miss the hand-off case).

### Q22. What is the worst case for `selectgo` complexity, and is it ever a practical concern?

**A.** `selectgo` complexity:

- Shuffle: O(k)
- Sort: O(k log k)
- Lock acquisition: O(k)
- Poll pass: O(k)
- If park: enqueue O(k) sudogs.
- On wake: dequeue O(k - 1) sudogs from non-firing channels.

Total: O(k log k) worst case per select execution. For k = 10, ~30 ns of sort overhead — negligible. For k = 100, ~700 ns. For k = 1000 (a select with a thousand cases), ~10 μs.

In practice, selects with > 16 cases are rare. The Go team has not seen need to optimise. If you have a select with hundreds of cases, redesign — channel-per-thing is the wrong abstraction at that scale.

### Q23. Explain how the runtime guarantees that the `close()` of a channel is visible to a receiver that started before `close` was called.

**A.** Both `close` and `recv` acquire and release `c.lock`. Mutex acquire-release pairs establish happens-before in the Go memory model. Specifically:

- Goroutine A: `close(ch)` calls `lock(&c.lock)`, sets `c.closed = 1`, drains queues, calls `unlock(&c.lock)`.
- Goroutine B: `<-ch` calls `lock(&c.lock)` (after A's unlock), reads `c.closed`, sees 1, returns zero.

The unlock-then-acquire ordering guarantees B observes A's write to `closed`.

For the parked-receiver case: B parked on `recvq` before close. `closechan` drains `recvq` (under lock), wakes B via `goready`. B's wake-up path involves a status CAS (`_Gwaiting` → `_Grunnable`), which is a memory barrier. B then runs, observing all of A's prior writes.

For non-blocking receivers: the fast path uses `atomic.Load(&c.closed)`, which is itself a memory-acquire operation in Go's atomic semantics — sufficient for visibility.

### Q24. If you had to add a method `func (c *hchan) Drain() int` that empties the buffer without waking parked senders, how would you implement it safely?

**A.** The signature is a no-op on the queue logic but careful with the lock:

```go
// pseudo-code; would live in runtime/chan.go
func (c *hchan) Drain() int {
    lock(&c.lock)
    n := int(c.qcount)
    if c.dataqsiz > 0 {
        // Walk recvx to sendx, clear each slot.
        for i := uint(0); i < c.qcount; i++ {
            idx := (c.recvx + i) % c.dataqsiz
            typedmemclr(c.elemtype, chanbuf(c, idx))
        }
        c.recvx = c.sendx
        c.qcount = 0
    }
    // Do NOT touch sendq — that would change semantics.
    unlock(&c.lock)
    return n
}
```

Subtleties:

- Must clear each slot to release any references the GC was holding (if elem has pointers).
- Must advance `recvx` to `sendx` so the buffer's "empty" invariant (`qcount == 0` and `recvx == sendx`) holds.
- Cannot touch `sendq` — parked senders should remain parked; their values will go to the next receiver.

After `Drain`, parked senders are still on `sendq`. The first subsequent receive will satisfy them via the direct hand-off / buffer-rotation path.

This method does not exist in Go because it would be a sharp tool prone to misuse. The exercise tests whether you understand the invariants.

### Q25. What happens if a goroutine panics while parked on a channel?

**A.** It cannot. A parked goroutine is in `_Gwaiting`. It executes no code. Panic happens only on the active goroutine.

If a goroutine *unparks* and *then* panics (e.g., wake from `chansend` because the channel was closed → panic "send on closed channel"), the panic runs as if the channel op had originally panicked at that source location. The stack trace points at the `ch <- v` line, with a deferred panic on top. Recoverable via `defer recover` in the sending goroutine.

If the panic is unrecoverable (no defer with recover), the goroutine terminates and the runtime checks if it was the main goroutine — if so, program exits.

### Q26. Two senders simultaneously call `close(ch)` on the same channel. What happens?

**A.** Both call `lock(&c.lock)`. One acquires the lock, sees `c.closed == 0`, sets it to 1, drains the queues, unlocks. The other now acquires the lock, sees `c.closed != 0`, unlocks, and panics with "close of closed channel."

The second panic terminates the second goroutine. The channel is correctly closed (first close did the work). Mitigation: use `sync.Once` for idempotent close, or have only one goroutine responsible for closing.

### Q27. Explain why direct hand-off is required for correctness, not just performance.

**A.** It is technically performance, not correctness — a non-hand-off implementation would still satisfy the spec. But here's the alternative:

1. Sender locks, sees receiver parked.
2. Sender writes its value into the buffer (assume capacity 1; for unbuffered we'd need a special slot).
3. Sender wakes receiver and unlocks.
4. Receiver wakes, locks, reads from buffer, unlocks.

That works for buffered channels (use the buffer slot). For *unbuffered* channels, there is no buffer — so we'd need to either:

- Add a special "rendezvous slot" to `hchan` (costs 1 element-size per channel).
- Copy through the sudog's elem field, requiring an extra copy.

The direct-hand-off implementation avoids both: the sender writes directly into the receiver's stack location, no intermediate storage. This is also faster — single copy instead of two.

So: direct hand-off is performance, but it is also a key design choice that lets `hchan` not have a "rendezvous slot" field. For unbuffered channels, the buffer pointer can be nil and `dataqsiz = 0`.

### Q28. Compare channel-based message passing to a `sync.Cond` with explicit data sharing.

**A.**

| Aspect | Channel | sync.Cond + Mutex |
|---|---|---|
| Setup | `make(chan T, n)` | `&sync.Cond{L: &mu}` + shared state |
| Send/wait | `ch <- v` (single call) | `mu.Lock(); state = ...; cond.Signal(); mu.Unlock()` |
| Recv/notify | `<-ch` (single call) | `mu.Lock(); for !condition { cond.Wait() }; ...; mu.Unlock()` |
| Memory model | Happens-before via channel op | Happens-before via mutex |
| Common cost (uncontended) | ~50 ns | ~30 ns |
| Hand-off | Direct (sender → receiver stack) | None (sender writes to shared field; receiver reads after acquiring mutex) |
| Broadcast | `close(ch)` wakes all receivers | `cond.Broadcast()` |

Channels are conceptually simpler but slightly slower. `sync.Cond` is more general (the wakeup predicate is arbitrary). For one-shot signalling or rate-limited queues, channels win on clarity. For complex multi-predicate waits or when you need to hold extra state, `sync.Cond` is sometimes better.

In practice, idiomatic Go avoids `sync.Cond` — it is one of the rarest primitives in the `sync` package — and prefers channels.
