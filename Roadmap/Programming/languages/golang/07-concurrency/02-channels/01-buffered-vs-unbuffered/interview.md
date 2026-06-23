# Buffered vs Unbuffered Channels — Interview Questions

> Each question lists the *level* it is typically asked at, then a strong answer, plus follow-ups an interviewer is likely to drill into.

---

## Junior

### Q1. What is the difference between `make(chan T)` and `make(chan T, N)`?
**A.** The first creates an *unbuffered* channel; every send blocks until a receiver is ready, every receive blocks until a sender is ready. The second creates a *buffered* channel of capacity `N`; sends only block when the buffer is full, receives only block when the buffer is empty.

**Follow-up:** What is `cap(ch)` for the unbuffered case? *Zero, not one.*

### Q2. What happens if you send on a closed channel?
**A.** The runtime panics with the message *"send on closed channel."* The fix is structural: only the producer of the channel should close it, and that producer should be the only sender.

### Q3. What does `v, ok := <-ch` give you?
**A.** `v` is the value (or the type's zero value if the channel is closed and drained) and `ok` is a boolean: `true` if a real value was received, `false` if the channel is closed and empty. Receivers use this to detect the "no more data" condition without panicking.

### Q4. What does a `range` loop over a channel do?
**A.** It receives values until the channel is closed and drained, then exits. If the channel is never closed, the loop blocks forever once the producer stops.

### Q5. What is `chan struct{}` good for?
**A.** A pure signal. The element type is zero bytes, so the value carries no payload — it just marks "the event happened." It is the idiomatic choice for done/cancel/started signals.

### Q6. Why does receiving from a `nil` channel block forever?
**A.** The runtime treats nil channels as having no buffer, no senders, and no receivers; any operation on them parks the goroutine indefinitely. This is intentional: it lets you "disable" a case in a `select` by setting the variable to nil.

### Q7. What is the difference between `len(ch)` and `cap(ch)`?
**A.** `cap` is the buffer size set at `make` time and never changes. `len` is the current count of buffered values; for an unbuffered channel both are zero.

---

## Middle

### Q8. When would you choose a buffered channel over an unbuffered one?
**A.** When you have a measured short burst that the consumer can drain *on average*, and you want the producer to make progress during that burst without blocking. Examples: small fan-in pipelines, semaphore-style concurrency limits, fixed-size work queues.

If your reason is "to avoid a deadlock," the deadlock is the bug — bumping capacity hides it instead of fixing it.

### Q9. Who should close a channel?
**A.** The producer. The receiver should never close, because the next send would panic. With multiple producers, neither closes — instead, a coordinator goroutine waits for all producers (`WaitGroup`) and then closes the channel.

### Q10. How would you implement a semaphore in Go?
**A.** A buffered channel of `struct{}` tokens:

```go
sem := make(chan struct{}, 5)
sem <- struct{}{}  // acquire
defer func() { <-sem }() // release
```

The buffer capacity is the maximum concurrency. Acquiring blocks when the cap is reached.

### Q11. What is "fan-in" and how would you implement it?
**A.** Fan-in is merging values from multiple channels into one. The simplest version uses a goroutine per input channel, each ranging over its input and forwarding to a shared output. The output channel is closed by a coordinator that waits for every forwarder to exit. With `select` you can do it in one goroutine, which we cover in the select chapter.

### Q12. Explain the producer-owner pattern.
**A.** The function that creates the channel returns it as `<-chan T` so callers cannot close it. Inside, a single goroutine is the only sender and the only closer. This pattern eliminates the most common closing-related panics and fits naturally into pipelines: `source() -> stage1() -> stage2() -> sink()`.

### Q13. Can you receive from and send to the same channel in the same goroutine?
**A.** Yes for buffered channels with sufficient capacity, but it is rarely useful and almost always a sign of confusion. For unbuffered channels it deadlocks immediately because there is no other goroutine to provide the partner.

---

## Senior

### Q14. What synchronisation guarantees does a channel send give you?
**A.** Two: a send happens-before the matching receive returns, and any write the sender did before the send is visible to the receiver after the corresponding receive. For unbuffered channels the synchronisation is the rendezvous itself; for buffered channels, the synchronisation is between the send and the *matching* receive, not all later receives.

### Q15. What does the Go memory model say about closing a channel?
**A.** The close happens-before any receive that returns because the channel is closed (i.e., returns the zero value with `ok == false`). All sends that happened before the close also happen-before that receive. This makes `close` a clean broadcast event: every receiver wakes up with the right ordering relative to writes the producer did before closing.

### Q16. When is using a channel the *wrong* answer?
**A.** When the dominant operation is counting (`atomic`), guarding a small piece of shared state (`sync.RWMutex`), or "do this one-time thing exactly once" (`sync.Once`). Channels are about transferring control or values; for those other patterns they add cost without benefit.

### Q17. How would you size a buffered channel for a production pipeline?
**A.** I would measure the producer-consumer rate gap and the scheduling jitter, pick a capacity that absorbs the typical burst, and document the rationale (often as a named constant). I would *not* pick a number "to be safe." If the consumer cannot keep up with the producer on average, no buffer fixes it; the system needs throttling, dropping, or external queueing.

### Q18. How do you prevent goroutine leaks through channels?
**A.** Three rules. (1) Every goroutine has an exit channel or context — never just blocks on one channel. (2) The function that spawned a goroutine waits for it (typically via a `WaitGroup`). (3) Sends inside long-running loops use `select` with a cancellation case so a half-shut-down system does not strand the producer.

### Q19. What is the cost of `close(ch)` when many goroutines are listening?
**A.** O(N) where N is the number of parked receivers — the runtime walks the receive queue and unparks each one. For a normal program this is microseconds total; for a broadcast cancellation to thousands of listeners it is still small. The bigger concern with broadcast close is making sure exactly one closer exists.

### Q20. Why does the runtime have direct hand-off for unbuffered channels?
**A.** When a receiver is already parked, the sender copies the value directly from its stack into the receiver's destination, skipping the buffer entirely. This saves one memmove and avoids touching the ring buffer. It is also why unbuffered channels carry no per-message memory cost — the value never sits in the channel.

### Q21. Describe a time-decoupled signalling pattern using capacity 1.
**A.** A capacity-1 channel lets the producer enqueue a value before any consumer is ready. The consumer drains the value at its own pace. It is useful when the producer fires-and-forgets and we still want the consumer to eventually see exactly one value. Sends past the first will block, which often is what you want — "if you have not picked up the previous one yet, the producer waits."

---

## Staff / Architectural

### Q22. Walk me through the runtime structure of a buffered channel.
**A.** The runtime allocates an `hchan` struct: a mutex; a ring buffer pointer plus capacity, length, send/receive indices; FIFO queues of parked senders and receivers (`sudog` records); and a closed flag. Every operation acquires the mutex. Send tries direct hand-off (parked receiver), then buffer write (if room), then park. Receive does the inverse. Close walks both queues and unparks everyone — senders wake to panic, receivers wake to either consume buffered values or get the zero-`!ok` form.

### Q23. How would you architect a system where 10 producers and 5 consumers share a queue, with graceful shutdown?
**A.** A buffered channel for jobs, a `done` channel (or context) for shutdown, a single coordinator goroutine that waits on `WaitGroup` of producers and then closes the jobs channel. Consumers `range` over jobs and exit naturally. Producers `select` on `ctx.Done()` and the send so they can bail out promptly. This combines structure (channel ownership), lifecycle (waitgroup + cancel), and backpressure (bounded buffer).

### Q24. When would you reach for something other than a Go channel for inter-goroutine communication?
**A.** Several cases. (1) Very high contention on a single value — atomic or per-CPU storage. (2) Need a priority queue — `container/heap` plus a mutex. (3) Cross-process communication — a message queue or a network protocol. (4) Persistent or replayable streams — a real broker (NATS, Kafka). Channels are best for in-process, one-process-lifetime communication.

### Q25. Critique this code:
```go
done := make(chan int)
go func() {
    defer close(done)
    for i := 0; i < 10; i++ {
        done <- i
    }
}()

for {
    select {
    case v, ok := <-done:
        if !ok { return }
        process(v)
    case <-time.After(time.Second):
        log.Println("timeout")
        return
    }
}
```

**A.** Several issues. (1) `done` is the wrong name — it carries values, it is not a done signal. (2) The single-channel `select` can be replaced with a plain `range` if there is no need for a timeout, or kept with `select` if there is. (3) `time.After` inside a tight loop allocates a new timer per iteration; for high-rate channels use `time.NewTimer` and reset. (4) "If timeout, return" silently abandons the producer goroutine — leak. The fix is to also close a stop channel that the producer respects via its own `select`.

### Q26. Walk me through how you would debug a deadlock that sometimes happens in production.
**A.** Capture goroutine stacks on the next occurrence — `kill -SIGQUIT` if you are inside a process, or a periodic `runtime.Stack` dumped under load if you cannot signal. Look for goroutines parked in `chan send` or `chan receive`. For each, identify the channel by source location and ask: who is supposed to be on the other side, and what condition would block them? Often a chain of three or four goroutines parked on each other reveals a circular dependency. Fix structurally — usually by introducing a context-aware send or eliminating the blocking-on-self path.

### Q27. Explain how channels and `context.Context` complement each other.
**A.** `Context` is a cancellation broadcast plus deadline plus value bag. The `<-ctx.Done()` is itself a channel receive, so context plays naturally with `select`. Channels carry data; context carries lifecycle. A channel-using function that does not accept a context cannot be cancelled cleanly; a function that takes only a context but no result channel cannot return values. They are layered: channels for values, context for cancel/deadline, both interoperating in `select` statements.

### Q28. How would you design a cache that fans out to many readers but updates rarely?
**A.** Not with channels for the read path. A `sync.RWMutex` plus a value field is faster, lower-latency, and clearer. For invalidation broadcasts to background recomputers, a closed-channel signal works. The lesson: pick channels for transfer-of-control, mutex/atomic for shared state.

---

## Lightning round

| Q | A |
|---|---|
| `make(chan int, 0)` vs `make(chan int)`? | Identical. Both unbuffered. |
| `cap(nil channel)`? | `0`. |
| `len(nil channel)`? | `0`. |
| `close(nil channel)`? | Panic. |
| `<-nil`? | Blocks forever. |
| `nil <- 1`? | Blocks forever. |
| `close(closed)`? | Panic. |
| `closed <- 1`? | Panic. |
| `<-closed` (drained)? | Zero value, `ok == false`. |
| `range` over closed-and-drained? | Loop ends. |
| Direction-restricted parameter type? | `chan<- T` send-only, `<-chan T` receive-only. |
| Cheapest broadcast cancel? | `close(stopCh)` of a `chan struct{}`. |
| Best practice on closing? | Sender owns; one closer; never from receiver side. |
| Capacity = 1 use case? | One-shot result, time-decoupled signalling. |
