# Buffer Mechanics — Interview Questions

This file collects interview questions and reference answers, graded by level. Use them as preparation for runtime-internals discussions during senior, staff, or principal interviews.

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Staff / Principal Questions](#staff--principal-questions)
5. [Whiteboard / Code Questions](#whiteboard--code-questions)
6. [Behavioural Around Buffer Choices](#behavioural-around-buffer-choices)

---

## Junior Questions

**Q1. What is a buffered channel?**
A channel made with `make(chan T, n)` where `n > 0`. It can hold up to `n` values without a receiver.

**Q2. What happens when you send to a buffered channel that has room?**
The value is placed in the channel's internal buffer and the sender continues without blocking.

**Q3. What happens when you send to a full buffered channel?**
The sender blocks (parks) until a receiver makes room, or until a `select` with `default` lets the sender skip the send.

**Q4. What does `len(ch)` return?**
The number of values currently in the buffer. For an unbuffered channel, this is always 0.

**Q5. What does `cap(ch)` return?**
The capacity passed to `make`. For an unbuffered channel, it returns 0.

**Q6. Can you change a channel's capacity after creation?**
No. Capacity is fixed at `make` time.

**Q7. What is `chan struct{}` used for?**
Pure signalling. The empty struct carries no data; the only meaningful events are "a value was sent" or "the channel was closed." Common in done-channels and semaphores.

**Q8. After `close(ch)`, can you still receive?**
Yes. Remaining buffered values come out in order. Once empty, receives return the zero value with `ok=false`.

**Q9. After `close(ch)`, can you still send?**
No. Sending on a closed channel panics with "send on closed channel."

**Q10. Why is FIFO order guaranteed?**
The internal ring buffer tracks the order using `sendx` and `recvx` indices. Each send writes at `sendx` and each receive reads at `recvx`, both advancing by one. Values come out in the order they went in.

---

## Middle Questions

**Q11. What is the internal data structure of a buffered channel?**
A ring buffer (circular buffer) of fixed size, with two indices (`sendx`, `recvx`) and a counter (`qcount`). All inside the runtime struct `hchan`.

**Q12. Why a ring buffer and not a linked list?**
A ring buffer is one contiguous allocation, cache-friendly, and bounded by construction. A linked list would allocate per send, fragment memory, and increase GC pressure.

**Q13. What happens to `sendx` when it reaches the end of the buffer?**
It wraps to 0. The runtime implements this as `if sendx == dataqsiz { sendx = 0 }` rather than `sendx %= dataqsiz`, because a predictable branch is cheaper than a division.

**Q14. How does the runtime know the buffer is full?**
`qcount == dataqsiz`. A single integer comparison.

**Q15. What does direct hand-off mean?**
When a sender and a receiver are both ready (the receiver is already parked), the runtime copies the value directly from the sender's stack to the receiver's destination without touching the buffer. This saves one copy.

**Q16. Why does buffered send check for a parked receiver first, before checking buffer space?**
Direct hand-off is cheaper (one copy vs. two: into buffer then later out). The runtime always prefers it when possible.

**Q17. What does `typedmemmove` do?**
Copies one element from a source pointer to a destination, honoring the element type's pointer map so the garbage collector remains correct. For pointer-free types it is essentially `memmove`; for pointer-containing types it emits write barriers.

**Q18. Why does the receive path call `typedmemclr` on the slot?**
To zero the slot so any pointers it contained no longer keep heap objects alive. Without this, the buffer would retain references to logically-removed values.

**Q19. Where is the buffer allocated in memory?**
For pointer-free element types, in the same block as the `hchan` header (one `mallocgc` call). For pointer-containing element types, the buffer is a separate allocation so the GC can scan it as the right type. For zero-size element types, no buffer block is allocated.

**Q20. What is the cost of `len(ch)` in a hot path?**
One memory read of `c.qcount`. No lock. But the value can be stale by the time the caller observes it. For control flow, use `select` with `default` instead.

---

## Senior Questions

**Q21. Why does the Go runtime use one mutex for the channel rather than a lock-free ring?**
The contended case is dominated by goroutine parking, not by lock acquisition. The uncontended case is already ~30 ns. A lock-free MPMC ring would add complexity for negligible benefit. Additionally, the mutex protects the wait queues and `closed` flag, not just the ring; splitting these would multiply complexity.

**Q22. Does the runtime require power-of-two buffer capacities?**
No. The wrap is a branch, not a bitwise AND, so any positive integer capacity works.

**Q23. What happens to the buffer during garbage collection?**
For pointer-containing element types, the GC scans the buffer as `[N]T` and follows pointers in occupied slots. Unoccupied slots are zeroed (by `typedmemclr` on receive), so they hold no references. The `hchan.buf` field is itself a GC-tracked pointer keeping the buffer block alive.

**Q24. Walk through `chansend` and identify exactly where the buffer is touched.**
1. Nil-check, closed-check.
2. Check `recvq` for a parked receiver; if present, direct hand-off — buffer not touched.
3. If `qcount < dataqsiz`, compute `qp := chanbuf(c, c.sendx)`, copy value with `typedmemmove`, advance `sendx` with branch-wrap, increment `qcount`.
4. Otherwise, park sender on `sendq` — buffer not touched.

**Q25. Why is `elemsize` a `uint16`?**
To keep `hchan` compact and to enforce that element types larger than 65535 bytes are rejected at `makechan` time. Such types are pathological for channel use.

**Q26. Two senders try to send to the same buffered channel simultaneously. What happens?**
Both attempt to acquire `hchan.lock`. One wins, performs its send (buffer branch or direct hand-off), and releases. The other then acquires and performs its operation. Order is determined by lock acquisition, not by the original send order in the source.

**Q27. The buffer is full and a sender is parked. A receiver arrives. Walk through what happens.**
1. Receiver acquires the lock.
2. Sees `sendq` has a waiting sender.
3. Reads the oldest value at `buf[recvx]` into its destination.
4. Copies the parked sender's value into `buf[recvx]`.
5. Advances `recvx` with wrap.
6. `qcount` stays at `dataqsiz`.
7. Wakes the parked sender.
8. Releases the lock.
This preserves FIFO order: the value the receiver got is the oldest one, and the parked sender's value is now at the back of the queue.

**Q28. What is the performance envelope of a buffered channel?**
Roughly 30–50 nanoseconds per send/recv on the fast path, single-core, single-threaded. That is 30–50 million ops/sec. Under contention from many goroutines, latency rises into microseconds and throughput drops accordingly. Cost scales with element size (via `typedmemmove`) and pointer count (via write barriers during GC).

**Q29. Why does `len(ch)` not take the channel lock?**
Performance: `len` is meant to be cheap. The trade-off is that the result is not synchronised. Users who need precise consistency must use `select` with `default` instead.

**Q30. Why is `hchan.buf` set to a sentinel for zero-mem channels rather than nil?**
Uniformity. The race detector uses `hchan.buf`'s address as a stable anchor for synchronisation events. A nil pointer would require special-casing throughout. The sentinel address is never dereferenced as bytes; it is only used as an identity.

---

## Staff / Principal Questions

**Q31. The runtime allocates the buffer separately from the `hchan` when the element contains pointers. Why?**
Because the GC scans allocations based on the type passed to `mallocgc`. The `hchan` header has its own type descriptor; the buffer needs to be scanned as `[N]T`. A single allocation could not carry two different type descriptors, so the runtime allocates two blocks.

**Q32. Could the runtime use a hybrid: allocate one block but tell the GC about both regions?**
The GC's scanning model is "one allocation = one type." Changing this would require non-trivial changes to the GC marker. The current two-allocation approach is correct and simple.

**Q33. When a buffered channel is closed while values remain, those values are still delivered to receivers. What if there are also parked receivers?**
The runtime delivers the buffered values to user-level receivers via the normal recv path (those calling `<-ch` after close). The parked receivers (already waiting) are woken up by `closechan`'s loop and each receives the zero value with `ok=false`. So if the buffer holds `n` values and there are `m` parked receivers, the first `n` `<-ch` calls after close drain the buffer (in FIFO), and the parked receivers (which are gone by then) already returned with the zero value. The implementation order in `closechan` is: drain parked receivers first (handing them the zero), then user code drains the buffer.

Actually that is not quite right — let me restate. In current Go, `closechan` does *not* drain the buffer to parked receivers; it gives parked receivers the zero value. The buffer is preserved for any future receives.

**Q34. The race detector tracks synchronisation events on buffer slots. What is the address of a slot from the race detector's perspective?**
The race address of slot `i` is derived from `c` and `i`. The runtime helper `racenotify(c, i, nil)` knows how to compute it. Conceptually it is `unsafe.Add(c.raceaddr(), uintptr(i) * uintptr(c.elemsize))` plus a synchronisation tag.

**Q35. If you wanted to implement a buffered channel with a different element type per send, how would the design change?**
You couldn't, in a sane way. The buffer is laid out as `[N]T`; without a fixed `T`, the slot size and pointer layout are undefined, and the GC could not scan the buffer correctly. Every Go channel has a fixed element type at `make` time and forever.

**Q36. Compare Go's channel ring to `sync.Pool`'s thread-local rings.**
`sync.Pool` uses per-P (per-processor) rings to avoid lock contention; it is LIFO, lock-free for the local P, and uses stealing across Ps. Go's channel is a single ring guarded by a single mutex, FIFO, and supports parking. They solve different problems: Pool is a cache to avoid allocation; channel is a synchronisation primitive.

**Q37. What is the worst case throughput for a buffered channel?**
With heavy contention (many goroutines all sending/receiving on the same channel), `hchan.lock` becomes the bottleneck. The throughput degrades to roughly 1/(lock acquire time + critical section). On modern x86, that is hundreds of nanoseconds, dropping per-op throughput into the millions/sec range. Profiling tools (`pprof -mutex`, `pprof -block`) reveal whether your application is in this regime.

**Q38. The buffer is bypassed when both sender and receiver are ready. What if there are many parked receivers and many parked senders?**
That state is unreachable. If receivers are parked, the buffer is empty (otherwise they would have read from it). If senders are parked, the buffer is full. You cannot have both unless the channel is in a degenerate state, which the runtime invariants forbid.

**Q39. How would you instrument a buffered channel for production observability?**
- Periodically sample `len(ch)` and report as a histogram metric.
- Wrap channel operations with timing for percentile latencies (p50, p99) of send/recv.
- Use the `runtime/trace` facility for offline analysis of park/unpark events.
- Define an SLO around "max queue depth" and alert when `len(ch)/cap(ch) > 0.8` for sustained periods.

**Q40. If the buffer capacity is chosen at config time, what bounds would you enforce?**
- Lower bound: 1 (or 0 for unbuffered if that is the design).
- Upper bound: a value that, multiplied by `elemsize`, fits comfortably in available memory. Typically 1024–65536 for most apps; rarely larger.
- Reject negative, zero, and absurdly large values at config load time.
- Log the chosen capacity at startup so operators see it.

---

## Whiteboard / Code Questions

**WQ1. Implement a function that drains a buffered channel non-blockingly and returns the values.**

```go
func DrainNonBlocking[T any](ch <-chan T) []T {
    var out []T
    for {
        select {
        case v, ok := <-ch:
            if !ok {
                return out
            }
            out = append(out, v)
        default:
            return out
        }
    }
}
```

**WQ2. Write a semaphore type using a buffered channel.**

```go
type Sem struct {
    ch chan struct{}
}
func NewSem(n int) *Sem { return &Sem{ch: make(chan struct{}, n)} }
func (s *Sem) Acquire() { s.ch <- struct{}{} }
func (s *Sem) Release() { <-s.ch }
func (s *Sem) TryAcquire() bool {
    select {
    case s.ch <- struct{}{}:
        return true
    default:
        return false
    }
}
```

**WQ3. Predict the output of this code.**

```go
ch := make(chan int, 3)
for i := 0; i < 5; i++ {
    select {
    case ch <- i:
    default:
        fmt.Println("dropped", i)
    }
}
close(ch)
for v := range ch {
    fmt.Println("got", v)
}
```

Answer: The first three sends (i = 0, 1, 2) succeed and fill the buffer. The fourth and fifth (i = 3, 4) hit `default` and print "dropped 3" and "dropped 4." Then the loop prints "got 0", "got 1", "got 2" in order.

**WQ4. Why does this code deadlock?**

```go
ch := make(chan int)
ch <- 1
fmt.Println(<-ch)
```

Answer: `make(chan int)` is unbuffered (`cap == 0`). `ch <- 1` blocks waiting for a receiver, but the receiver is on the next line in the same goroutine. The main goroutine cannot reach the receive. Deadlock.

**WQ5. Modify the above to work.**

```go
ch := make(chan int, 1)
ch <- 1
fmt.Println(<-ch)
```

The capacity-1 buffer absorbs the send; the receive then drains it.

**WQ6. Implement a "latest value wins" channel that always replaces the old value.**

```go
type Latest[T any] struct {
    ch chan T
}
func New[T any]() *Latest[T] { return &Latest[T]{ch: make(chan T, 1)} }
func (l *Latest[T]) Set(v T) {
    for {
        select {
        case l.ch <- v:
            return
        default:
            select {
            case <-l.ch:
            default:
            }
        }
    }
}
func (l *Latest[T]) Get() T { return <-l.ch }
```

(The implementation uses a loop because the drain-and-set is not atomic; a mutex variant is cleaner for production.)

---

## Behavioural Around Buffer Choices

**B1. Tell me about a time you misused a channel buffer.**
Expected answer: a self-aware story about using a large buffer to "fix" a deadlock that was actually a coordination bug, followed by discovering the bug later when load increased.

**B2. How do you decide buffer size for a new channel?**
Expected answer: Start small (1 or N where N is the number of consumers). Profile under realistic load. Increase only if benchmarks show queue full as the limiter and back-pressure is acceptable. Never pick a "round number" without justification.

**B3. A junior on your team adds `make(chan Job, 100000)` to their PR. What is your code-review comment?**
Expected answer: Ask what the 100000 represents. If it is "to be safe," push back: that is back-pressure suppression and can hide memory leaks. If it is justified by a measured throughput requirement, ask for that justification in a comment.

**B4. You suspect a channel is leaking memory. How do you confirm?**
Expected answer: Take a heap profile (`pprof -alloc_objects`); look for entries pointing at `runtime.makechan` or `runtime.chanbuf`. Take a goroutine dump; look for goroutines blocked on `chan send` or `chan receive` that have lived too long. Trace the channel's lifetime in code.

**B5. The team is debating whether to use a channel or a mutex-protected slice for a producer-consumer queue. How do you decide?**
Expected answer: Channel is idiomatic, supports `select` and `close`, integrates with the memory model, and has a fast runtime. A mutex-protected slice can be faster in some pure-throughput micro-benchmarks (no parking overhead) but lacks the coordination semantics. Default to channel unless profiling proves otherwise.

---

These questions cover the buffer mechanics from "what is `len(ch)`" up to "explain the GC implications of choosing `chan *T` vs `chan T`." Mastery means you can answer at every level and discuss trade-offs without rote citation.
