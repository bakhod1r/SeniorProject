# The `hchan` Struct — Interview Questions

[← Back to index](index.md)

## How to Use This Page

Questions are grouped by difficulty: junior, middle, senior, staff. Each has a "what the interviewer is checking" note plus a model answer outline. Use it to self-assess or as a practice set.

---

## Junior Level

### Q1. What does `make(chan int, 3)` return at the machine level?

*What is being tested*: do you know a channel is a pointer?

**Outline**: It returns a `chan int` value, which is internally a `*hchan` (a pointer to a heap-allocated `hchan` struct). The struct contains the buffer (3 slots), wait queues, indices, and a runtime mutex. The variable holding `ch` is 8 bytes on amd64 — just a pointer.

### Q2. Where is the buffer of a channel stored?

**Outline**: On the heap, contiguous with the `hchan` header in the typical case (`mallocgc(hchanSize+mem, ...)` in `runtime.makechan`). For element types containing pointers, the buffer is a separate heap allocation so the GC can scan it properly.

### Q3. What is the type of `lock` field in `hchan`?

*Catch*: candidates often say `sync.Mutex`.

**Outline**: It is `runtime.mutex` — the runtime-internal spin-mutex, **not** `sync.Mutex`. `sync.Mutex` is implemented on top of runtime primitives; using it inside `hchan` would create a layering loop.

### Q4. What is the difference between `len(ch)` and `cap(ch)`?

**Outline**: `cap(ch)` is the buffer capacity, a constant after `make`. `len(ch)` is the current count of buffered elements (`c.qcount`), a snapshot — not synchronised with concurrent sends/receives.

### Q5. What does the compiler translate `ch <- v` into?

**Outline**: A call to `runtime.chansend1(ch, &v)`. The compiler takes the address of `v` (so its location is heap- or stack-resident) and the runtime function copies the value via `typedmemmove`. `chansend1` is a one-line wrapper around `chansend(c, ep, block=true, callerpc)`.

### Q6. Can a channel be `nil`? What happens if you send to a nil channel?

**Outline**: Yes — `var ch chan int` makes `ch == nil` (a nil `*hchan` pointer). Sending or receiving on a nil channel blocks forever (`gopark` with `waitReasonChanSendNilChan`/`...NilChan`). Closing a nil channel panics.

### Q7. After `close(ch)`, what does `<-ch` return?

**Outline**: It drains any remaining buffered values, returning them with `ok == true`. Once the buffer is empty, it returns the zero value of the element type with `ok == false`, never blocking.

---

## Middle Level

### Q8. Walk me through the three paths inside `chansend`.

**Outline**:
1. **Hand-off**: if `c.recvq.dequeue()` returns a sudog, the sender's value is copied directly to that receiver's destination via `sendDirect`, and the receiver is woken. No buffer slot is touched.
2. **Buffer write**: if `c.qcount < c.dataqsiz`, the value is copied into `buf[sendx]`, `sendx` is advanced modulo `dataqsiz`, `qcount` is incremented.
3. **Park**: acquire a `sudog`, append to `c.sendq`, call `gopark`. On wake, check `mysg.success`; panic if the channel was closed.

The lock is held across path selection; for path 1 and 3, special care is taken to release the lock before changing another goroutine's status.

### Q9. Why must the lock be released before calling `goready`?

**Outline**: Because `goready` may transitively need to acquire higher-ranked locks (scheduler, stack-shrink). The comment in `runtime/chan.go` makes this explicit: "Do not change another G's status while holding this lock (in particular, do not ready a G), as this can deadlock with stack shrinking." `closechan` enforces this by accumulating Gs into a local list and waking them after `unlock`.

### Q10. How is the circular buffer indexed?

**Outline**: Two `uint` indices, `sendx` and `recvx`, both in `[0, dataqsiz)`. After each operation: `idx++; if idx == dataqsiz { idx = 0 }`. The slot address is `c.buf + idx * c.elemsize`. `qcount` tracks the number of valid elements; `sendx == recvx` is ambiguous (empty or full) — `qcount` resolves it.

### Q11. Why does `chanrecv` clear the buffer slot after reading?

**Outline**: To avoid keeping the old element alive for the GC. After `typedmemmove(elemtype, ep, qp)` copies the value out, `typedmemclr(elemtype, qp)` zeroes the slot. For pointer-containing types, leaving the pointer in the buffer would prevent GC of the pointee. For pointer-free types the clear is cheap and harmless.

### Q12. What is a `sudog` and where is it stored?

**Outline**: A `sudog` ("scheduling user-data G") is a runtime struct that represents a parked goroutine waiting on a channel or other primitive. It holds `g *g` (the goroutine), `elem unsafe.Pointer` (source/destination of the data), `c *hchan` (the channel), and linked-list pointers. Sudogs are pooled per-P (`p.sudogcache`) to avoid allocation on the hot path.

### Q13. What happens on close when there are parked senders and parked receivers?

**Outline**: Impossible by Invariant 1 — at most one of the queues is non-empty (modulo a select edge case on the same channel). Practically, if both are non-empty due to select cases, `closechan` drains both: senders are marked `success=false` (they panic on wake), receivers are marked `success=false` and have their destination cleared (they receive the zero value).

### Q14. Why is `closed` a `uint32` instead of `bool`?

**Outline**: Atomicity. Fast paths read `c.closed` without the lock via `atomic.Load(&c.closed)`. `bool` has implementation-defined size (typically 1 byte) and may not be aligned for atomic word operations. `uint32` is portable, aligned, and supports CAS / atomic load on every Go-supported platform.

---

## Senior Level

### Q15. Why is there a per-P `sudog` cache?

**Outline**: Channel parks happen on the hot path. Allocating a `sudog` from the heap for each park would dominate the cost. The per-P cache (`p.sudogcache`, ~128 entries) makes acquisition a slice pop. When local cache is empty, the runtime pulls from `sched.sudogcache` (centralised, behind `sudoglock`); when local is full, it spills. Resulting steady-state: zero allocations on channel park.

### Q16. Explain the `selectDone` race in `waitq.dequeue`.

**Outline**: A `sudog` from a `select` statement may be in multiple wait queues simultaneously (one per case channel). When another channel "wins" by waking the goroutine, it sets `g.selectDone` via CAS from 0 to 1. The other queues still contain "stale" `sudog`s pointing at this same `g`. `dequeue` checks `sg.isSelect`; if true, it tries the CAS itself — if it loses, the sudog is skipped and `dequeue` retries with the next entry.

### Q17. How does `hchan` interact with stack shrinking?

**Outline**: A `sudog`'s `elem` field points into the parked goroutine's stack (sender source, receiver destination). If the goroutine's stack is moved (grown or shrunk), those pointers must be updated. Stack scanning walks `g.waiting` and adjusts each sudog's `elem`. To avoid races, the channel lock cannot be held during a stack adjustment of the parked G, which is why `goready` must not be called inside the lock — `goready` may trigger scheduling, which may scan a stack.

### Q18. What's the memory model guarantee for buffered vs unbuffered channels?

**Outline**: From the Go Memory Model: a send on a channel is synchronized before the corresponding receive completes. For unbuffered: the synchronization is the rendezvous itself. For buffered: the *k*-th send is synchronized before the *k*-th receive (FIFO ordering). The `hchan` implementation realizes this via `c.lock`'s acquire/release pair and race-detector annotations on `c.raceaddr()` (which returns `&c.buf`).

### Q19. Why does the `hchan` allocation strategy split for pointer-containing element types?

**Outline**: For pointer-free elements, header and buffer share one heap object — fewer allocations, better cache locality. For pointer-containing elements, the buffer must be a separate object so the GC can identify it by type (via `elemtype`) and scan its contents. Mixing them in one object would force the GC to treat the whole thing as a typed object, which is harder to set up and would force unnecessary scanning of the header fields.

### Q20. How does `select` lock multiple channels safely?

**Outline**: In `runtime/select.go`, `selectgo` sorts the involved channels by pointer address and locks them in that order, deduplicating channels that appear in multiple cases. After locking, it polls each case for readiness; if any is ready, it executes that case under the lock and unlocks. If none is ready, it enqueues a `sudog` on each case's channel and parks via `gopark`, releasing all locks via the `selunlock` helper. On wake, it identifies which case won and removes the loser sudogs from their queues.

### Q21. What is `c.raceaddr()` and why does it use `&c.buf`?

**Outline**: `raceaddr` returns a stable address used by ThreadSanitizer as the synchronization variable for the channel. `&c.buf` is chosen because `buf` is immutable after `makechan`; using `qcount` or `dataqsiz` would risk reordering issues (`qcount` is mutated, `dataqsiz` is OK but conceptually unsuitable). Send issues a `racereadpc(c.raceaddr(), ...)`; receive issues `raceacquire`; close issues `racerelease` — these annotations let TSan build the happens-before graph across channel ops.

### Q22. Why does `hchan` straddle two cache lines, and what's the consequence?

**Outline**: On amd64, `hchanSize` is roughly 96 bytes, exceeding a 64-byte cache line. Producer-only fields (`sendx`, parts of `sendq`) and consumer-only fields (`recvx`, parts of `recvq`) end up sharing cache lines, causing cache-line bouncing between cores in a producer/consumer pattern. The runtime does not pad to mitigate this because the typical channel sees moderate traffic where padding's memory cost outweighs the cache benefit. Highly contended hot channels can be a bottleneck for this reason; sharding or per-goroutine queues are common workarounds.

---

## Staff Level

### Q23. Design a lock-free version of `hchan` for the unbuffered case. Why didn't Go do this?

**Outline**: A lock-free unbuffered channel would use CAS on a single "slot" word that holds either a sender's pointer or a receiver's pointer, with a state field indicating which. The "winner" of the CAS completes the transfer; the loser parks.

Reasons Go's choice is reasonable:
- Lock-free designs are tricky to get right (ABA problem, ordering on weak memory models).
- The current spin-mutex has very short critical sections; the lock-free win would be marginal under typical contention.
- Buffered, unbuffered, and `select` would all need separate lock-free machineries — code complexity explodes.
- Park/unpark via `gopark`/`goready` are not lock-free anyway — they touch scheduler state.

A consistent, locked design wins on maintainability and predictability.

### Q24. How would you detect "this hot channel is causing CPU burn from spinning on `c.lock`"?

**Outline**: Tools:
- `pprof` mutex profile (`runtime.SetMutexProfileFraction(N)` + `go tool pprof http://.../debug/pprof/mutex`): shows time spent waiting for runtime mutexes.
- `perf` on Linux: look for `runtime.lock2` and `runtime.futexsleep` samples — high counts indicate contention.
- `GODEBUG=schedtrace=1000`: high `idleprocs` despite work suggests goroutines parking.
- Tracing (`runtime/trace`): the channel-blocking events show parked-time distributions.

Mitigations: shard channels, batch operations, use a bounded ring buffer outside the runtime, or replace with a `sync.Pool`-style design for "pass tokens" use cases.

### Q25. The Go runtime once had a bug where `closechan` would call `goready` under the lock. What would be the failure mode?

**Outline**: `goready` may trigger scheduling, which may trigger stack-scanning of the woken G. Stack scanning needs to update `sg.elem` pointers, which requires walking `g.waiting`. If the channel's `c.lock` is held by the closer, and the stack scanner needs to acquire the same lock (to verify the sudog state), we have a deadlock — the closer waits for the woken G's stack scan, which waits for `c.lock`.

This is why `closechan` (Go 1.10+) accumulates Gs into a local list and calls `goready` after `unlock`. The lock-rank checker enforces the invariant at build time when enabled.

### Q26. Why is `chansend` careful to call `KeepAlive(ep)` after `gopark`?

**Outline**: When a sender parks, `mysg.elem = ep` records the source address. The compiler might otherwise observe that `ep` is no longer used by Go code after `gopark` and let any backing heap object be GC'd. The receiver, when it runs, would copy from a freed object — silent corruption.

`KeepAlive(ep)` after `gopark` is a no-op at runtime but tells the compiler "treat `ep` as live until at least here". This is a subtle interaction between escape analysis, GC, and runtime parking.

### Q27. Two engineers argue: one says channels are slow because of the mutex; the other says they are fast because of direct hand-off. Who is right?

**Outline**: Both. For uncontended hot paths (no parking, the direct hand-off case), channels are fast: one runtime function call, one mutex acquire/release, one `memmove`, one `goready`. Single-digit microseconds.

For contended hot paths (many goroutines trying to send to the same channel, no receiver fast enough), the spin-mutex contention dominates and per-op cost can rise sharply.

The "right answer" in an interview: it depends on the workload. Uncontended channel ops are competitive with the fastest user-space queues. Highly contended channels are bottlenecks and should be sharded or replaced. Use measurement, not folklore.

### Q28. If you had to extend `hchan` with a "peek" operation (read without consuming), how would you implement it?

**Outline**: Add a new runtime function `chanpeek(c, ep)`:
- Acquire `c.lock`.
- If `c.qcount > 0`: `typedmemmove(c.elemtype, ep, chanbuf(c, c.recvx))`. Do *not* clear, do *not* advance `recvx`, do *not* decrement `qcount`. Release lock. Return `true`.
- If `c.closed != 0`: return zero value, `(true, false)`-style.
- Otherwise: return `false`.

The complications:
- Race detector: peek is a "read" of the buffer slot; needs annotation but no happens-before edge to the original sender.
- Memory model: peek does not constitute a "receive" — does it synchronize-before later operations? Probably not, which makes it surprisingly hard to use correctly.
- Why Go does not have it: peek encourages misuse. Most use cases that ask for peek are better served by a single producer + atomic snapshot, or by changing protocol.

The exercise is useful for showing that `hchan` is straightforward to extend, but the *language* would suffer from adding peek.

### Q29. What is the worst-case allocation behavior of a busy buffered channel?

**Outline**: Steady state, the only allocation is the `hchan` itself (one-time, at `make`). Sudogs come from the per-P cache, so park/unpark is allocation-free. The buffer is part of the `hchan` allocation.

Pathological cases:
- Many goroutines parked simultaneously: each consumes a sudog. Cache spills to central; central allocates new sudogs if all pools are empty. Worst case: O(parked goroutines) sudog allocations on first burst.
- Channel of large element type: every send is a `typedmemmove` of the element size. The buffer allocation is `size * elemsize` bytes.
- Recreating channels in a loop: each `make(chan T, N)` is a heap allocation. Reuse channels when possible.

---

## Closing Notes for Candidates

When asked any of these questions, ground your answer in the source if you can. Citing `runtime/chan.go` and the names `chansend`, `chanrecv`, `closechan`, `makechan`, `waitq`, `sudog` signals deep familiarity. A confident answer that says "I don't remember the exact line, but the pattern is..." is much better than confident wrong specifics.

For staff-level questions, focus on trade-offs and design reasoning. The interviewer rarely wants you to redesign the runtime — they want to see that you understand *why* the current design is the way it is.
