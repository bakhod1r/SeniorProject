# Push-Pull — Interview Q&A

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Staff Questions](#professional--staff-questions)
5. [Common Traps](#common-traps)
6. [How to Defend the Design](#how-to-defend-the-design)

---

## Junior Questions

### Q1. What is the push-pull pattern in Go?
A producer **pushes** items onto a channel (`ch <- v`) and a consumer **pulls** them off (`v := <-ch`), running at potentially different rates. The channel coordinates them.

### Q2. What is backpressure?
The automatic blocking of the producer when the channel buffer is full. It throttles a fast producer to the slow consumer's pace and bounds memory. Go gives it to you for free via buffered/unbuffered channels.

### Q3. Why is a blocked producer a *good* thing, not a bug?
Because the alternative — accepting every push into an unbounded queue — grows memory until the process is OOM-killed. Blocking turns overload into a controlled slowdown instead of a crash.

### Q4. Who closes the channel?
The sender (producer). Sending on a closed channel panics, so only the sending side may safely close. The consumer just `range`s until close; it never closes.

### Q5. What is the difference between a buffered and an unbuffered channel here?
An unbuffered channel (cap 0) is a rendezvous: the send completes only when a receive is happening — the tightest backpressure. A buffered channel (cap N) gives the producer N items of slack before it blocks.

### Q6. What happens to `for v := range ch` when the channel is closed?
It drains any buffered values, then the loop ends. After close and drain, receives return `(zero, false)`.

---

## Middle Questions

### Q7. How do you fan out work to multiple consumers?
Have N goroutines all `range` over the same channel. Each item is pulled by exactly one worker — fan-out, not broadcast. The runtime distributes work to whichever worker is free, giving automatic load balancing.

### Q8. When fanning out, why must you close the *results* channel from a separate goroutine?
Because multiple workers send to `results`; the close must happen after the *last* send. Closing it from inside a worker would race with other workers' sends (panic). Idiom: `go func() { wg.Wait(); close(results) }()`.

### Q9. Bounded vs unbounded queue — which and why?
Bounded (a buffered channel). An unbounded queue never blocks the producer, so under overload it grows until OOM. Bounded gives backpressure: a slowdown, not a crash. Use unbounded only with a hard guarantee on total volume.

### Q10. How do you stop a producer that is blocked on a full channel?
Wrap the send in a `select` with `ctx.Done()`:
```go
select {
case out <- v:
case <-ctx.Done():
    return
}
```
Without that, a cancelled-but-blocked producer never notices the cancellation and leaks.

### Q11. What is the difference between drain and abort on shutdown?
Drain: stop the source, close the channel, `wg.Wait()` — process everything buffered, lose nothing. Abort: cancel the context, workers exit immediately — drop in-flight work. Choose deliberately; mixing them silently loses data.

### Q12. Why is putting `ctx.Done()` in a worker loop dangerous if you want drain semantics?
On cancel, workers exit with items still buffered — silent data loss. For drain, omit `ctx` from the worker loop and rely on the producer closing the channel.

---

## Senior Questions

### Q13. Where does backpressure "stop working"?
At any link that cannot block — an inbound network connection you do not control, a real-time sensor, a fire-and-forget emitter. Backpressure is a property of the *whole path*; it must terminate at a blockable or droppable boundary. If it propagates into an unblockable source, you get either an unbounded queue (OOM) or a stalled accept loop.

### Q14. How do you size a channel buffer?
Little's Law: `L = λ × W` (items in system = arrival rate × processing time), plus headroom for known bursts. A bigger buffer buys burst tolerance and adds latency under load; it never increases steady-state throughput, which is set by the consumer's service rate.

### Q15. The producer must never block, but you can't use an unbounded queue. What do you do?
Use a bounded channel with an explicit overflow policy: drop-newest, drop-oldest, sample/coalesce, spill-to-disk, or reject — and emit a metric when it fires so overload is visible. The choice depends on whether old or new items matter more.

### Q16. How do you do backpressure when you can't block the producer (across a network)?
Credit-based flow control: the consumer advertises a credit window (N items it can accept); the producer sends up to N un-acked, then waits for acks to return credits. This is what HTTP/2, gRPC, AMQP prefetch, and reactive-streams `request(n)` all do.

### Q17. Why must you not mutate an item after pushing it?
A channel send happens-before the receive, transferring ownership to the consumer. Mutating it afterward is a data race with no happens-before edge. Freeze pointed-to data before pushing; allocate a fresh slice for each batch.

### Q18. Where does push-pull fail?
Unblockable sources, backpressure reaching the accept loop (retry storms), head-of-line blocking on a shared channel, unbounded fan-in, pipeline cycles that deadlock when buffers fill, and goroutine leaks when a producer is blocked on a channel whose consumer exited.

---

## Professional / Staff Questions

### Q19. A PR adds a channel + goroutine between two functions. When do you push back?
When the work is a synchronous request/response or the two stages run at the same rate with no bursts — a plain function call is simpler and cheaper. Channels cost goroutines, scheduling, and shutdown complexity; justify them with rate decoupling or parallelism.

### Q20. When do you move from in-process channels to a broker?
When you need durability (survive a crash), horizontal scale (consumers on other machines), or decoupled deployment. Not before — in-process channels are faster and simpler. The broker buys reliability and scale at the cost of latency and operational complexity.

### Q21. Map Go push-pull onto ZeroMQ and NATS.
ZeroMQ PUSH/PULL: PUSH round-robins to PULL peers (fair queuing) with a high-water-mark as the bounded buffer — load distribution and backpressure but no durability. NATS queue groups: each message goes to exactly one subscriber in the group (load-balanced); JetStream adds acks and redelivery for at-least-once. Both are the networked version of N goroutines ranging one channel.

### Q22. How do you keep backpressure from causing a retry storm?
Terminate it at the request boundary: when the pipeline is saturated, return 503 (with `Retry-After`) immediately rather than holding the connection. Use a bounded admission semaphore so a slow downstream cannot stall the HTTP accept loop and trigger client timeouts and retries.

### Q23. How do you operate a push-pull pipeline in production?
Metrics: queue depth (gauge), depth/capacity saturation, enqueue-blocked time, `dropped_total`/`rejected_total` (alert on these), and per-item process latency. Queue depth is also a good autoscaling signal. Shutdown: stop admitting, drain within the budget, then exit.

---

## Common Traps

- **"Backpressure is a problem to remove."** It is the safety mechanism; removing it (unbounded queue) trades a slowdown for a crash.
- **"Bigger buffers are faster."** They buy burst tolerance and add latency; they do not raise steady-state throughput.
- **"The consumer closes the channel when done."** No — the sender closes.
- **Closing the fan-in channel from a worker.** Races with other senders; close once after `wg.Wait()`.
- **`wg.Wait()` before `close(ch)`.** Deadlock — workers range an open channel forever.
- **`ctx.Done()` in the worker loop with drain intent.** Silent data loss.
- **Blocking send with no `select`/`ctx`.** Leaks a cancelled producer.
- **Mutating a pushed item.** Data race; ownership transferred on send.

---

## How to Defend the Design

When challenged, anchor on three points:

1. **Why a channel at all.** "These two stages run at different, burst-y rates, and I want the slow stage to govern the pace with bounded memory. A bounded channel gives me backpressure for free; a plain function call wouldn't decouple the rates, and an unbounded queue would risk OOM."
2. **Bounding and overflow.** "Every buffer is bounded; I sized it with Little's Law plus burst headroom. On overload I [block / drop-oldest / reject with 503] and emit a metric, so overload is visible rather than hidden in a deep queue or a growing slice."
3. **Lifecycle.** "Every blocking push/pull selects on `ctx.Done()`, so cancellation propagates and nothing leaks. Shutdown is explicitly *drain* — I close the input and `wg.Wait()` within the budget — so buffered work isn't lost. For must-not-lose work I'd add acking/redelivery via a broker, because the channel alone can't survive a crash."

If pushed on scale: "In-process is right today; if we need durability or multi-node consumers, this maps cleanly onto NATS queue groups with JetStream or a broker work queue — same bound/distribute/backpressure/ack/shutdown reasoning, just across the network."
