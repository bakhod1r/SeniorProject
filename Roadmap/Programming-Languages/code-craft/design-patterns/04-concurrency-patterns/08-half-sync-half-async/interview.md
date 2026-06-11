# Half-Sync/Half-Async — Interview Questions

> Graded Q&A for the Half-Sync/Half-Async pattern. Back to [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md).

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral/Architectural Questions](#behavioralarchitectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

**Q1. What problem does Half-Sync/Half-Async solve, in one sentence?**
It lets you keep latency-sensitive I/O **asynchronous and non-blocking** (fast) while writing application logic as **simple blocking code** (easy), by separating them into layers connected by a queue — *simplifying programming without unduly reducing performance.*

**Q2. Name the three layers and the one rule each obeys.**
- **Asynchronous layer** — handles low-level I/O events; **must never block** on application work.
- **Queueing layer** — a bounded buffer mediating the handoff; the producer–consumer boundary.
- **Synchronous layer** — runs application logic in its own threads; **may block freely**.

**Q3. Where is application logic allowed to block, and why is that fine?**
Only in the **synchronous layer**. It's fine because each worker thread handles **one request at a time**, so one thread blocking on a DB call doesn't stop the others — unlike the single async thread, where blocking would freeze all I/O.

**Q4. On the producer (async) side, why `offer()` and not `put()`?**
`put()` **blocks** when the queue is full, which would stall the single async thread and freeze all I/O. `offer()` returns `false` instead, letting the async layer apply backpressure (reject/close) and keep reacting.

## Middle Questions

**Q5. Why must the boundary queue be bounded? What's the failure mode otherwise?**
An unbounded queue under sustained overload grows without limit until the process **runs out of memory and crashes**. Bounding it forces an explicit overload decision (the reject policy) instead of deferring failure into an OOM. It's the #1 production incident from this pattern.

**Q6. When does this pattern become a *net loss*?**
When per-task sync work is **tiny** (sub-microsecond). The handoff — enqueue + context switch + wakeup + maybe a memory copy (~µs) — then exceeds the useful work. For a 50 µs task a 3 µs handoff is ~6% ("not unduly"); for a 1 µs task it's 300%. Inline the work or use [Leader/Followers](../09-leader-followers/junior.md).

**Q7. How do you preserve per-connection ordering with multiple workers?**
Multiple workers reorder requests. Affine each connection (hash its id) to **one** worker / sub-queue, so all of that connection's requests are processed by a single consumer in order — cross-connection order can still interleave.

**Q8. What is the Half-Sync/Half-Reactive variant?**
The common specialization where the **asynchronous layer is a [Reactor](../03-reactor/junior.md)** — a `Selector` loop that demuxes I/O readiness, does a non-blocking read, and enqueues. The name just makes the async layer's identity explicit; the rest of the pattern is unchanged.

## Senior Questions

**Q9. How do you size the boundary queue?**
From a **latency budget**, via Little's Law (`L = λW`). Worst-case wait ≈ `capacity / (serviceRate × workers)`. Pick capacity so a full queue still meets the budget. Oversized queues just convert overload into latency the client times out on anyway. The queue is a **burst shock-absorber**, not a fix for sustained overload.

**Q10. Describe the *best* backpressure mechanism for a network server.**
Don't even read the work you can't process: when the queue nears its high-water mark, **disarm `OP_READ`** so bytes stay in the socket buffer, the TCP receive window closes, and the **peer slows down**. This pushes backpressure all the way to the source without allocating or copying anything. Re-arm at a low-water mark. Rejecting at the queue (503/close) is the next-best, honest option.

**Q11. When does the queue itself become the bottleneck, and what do you do?**
At very high request rates a single lock-based queue serializes everyone — adding workers stops increasing throughput (time goes into the queue lock / park-unpark). Fixes: **shard the boundary per core** (SPSC queues, no contention, free per-conn ordering), go **lock-free** (Disruptor/`LinkedTransferQueue`), or migrate to [Leader/Followers](../09-leader-followers/junior.md) to delete the handoff.

## Professional Questions

**Q12. Explain the memory-visibility guarantee at the handoff and its consequence.**
A `BlockingQueue` `put`/`take` establishes **happens-before**: everything the producer wrote before enqueuing is visible to the consumer after dequeuing — for the object's reachable state **at enqueue time**. Consequence: **make work items immutable or transfer exclusive ownership**; any post-enqueue mutation is a data race with no happens-before edge. In the kernel the same role is played by explicit memory barriers (`smp_wmb`/`smp_rmb`).

**Q13. Give two real systems that are Half-Sync/Half-Async and map their layers.**
- **OS kernel:** interrupt **top-half** (async, IRQ-disabled, no sleep, schedules deferred work) → **softirq/workqueue** (boundary) → **`ksoftirqd`/workqueue kthread** (sync, may sleep, runs the network stack).
- **Android:** main **`Looper`** (async, must never block) → **`MessageQueue`** (boundary, eventfd-woken) → **`HandlerThread`/Executor** (sync, blocking I/O/decode), result posted back to the main `Looper`.

**Q14. How do production systems reduce the per-handoff cost?**
Transfer **buffer ownership** instead of copying (pooled `ByteBuf`/`sk_buff` — kills memcpy + GC); keep workers **hot** with brief busy-spin to avoid the park/unpark futex round-trip; **batch** enqueue/dequeue to amortize the lock and coalesce wakeups; **shard** per core to remove lock contention; use **lock-free, cache-line-padded** queues to remove false sharing. Pushed far enough, the cost approaches Leader/Followers — at which point dropping the queue is worth considering.

## Coding Tasks

**Q15. Sketch the async producer and sync consumer with correct queue calls.**
```java
// ASYNC: never blocks. offer + reject path.
void onReadable(Request r) {
    if (!queue.offer(r)) reject(r);     // 503 / close — backpressure
}
// SYNC: blocks freely.
void workerLoop() {
    while (running) {
        Request r = queue.take();       // blocking OK here
        try { handle(r); } catch (Exception e) { log(e); } // never die silently
    }
}
```
Talking points: bounded queue, `offer` vs `put`, worker survives exceptions, immutable `Request`.

**Q16. Add graceful drain to a worker pool.**
Set an `accepting=false` flag so the async layer rejects new work; enqueue one **poison sentinel per worker**; `shutdown()` + `awaitTermination`. Assert that all already-queued items are processed (no loss). The order matters: stop intake → drain → stop workers.

## Trick Questions

**Q17. "The async layer never blocks — true?"**
Mostly true but sharpen it: it blocks **only in `select()`/`epoll_wait`/`nativePollOnce`**, waiting for events — never on **application work** (no DB, no parse, no full queue). That single sanctioned blocking point is not the same as blocking on work.

**Q18. "Just make the queue huge so it never rejects — good idea?"**
No. A huge queue doesn't add capacity; it adds **latency**. Under overload it fills with requests that sit for seconds and time out anyway, while consuming memory. Size to a latency budget and **shed early**.

**Q19. "Is Half-Sync/Half-Async faster than a pure Reactor?"**
No — it's usually slightly *slower* (extra handoff). Its value is **simpler application code** at a bounded performance cost. If raw speed with non-blocking logic is the goal, a pure Reactor or Leader/Followers wins.

## Behavioral/Architectural Questions

**Q20. Half-Sync/Half-Async vs. Leader/Followers — when would you choose each?**
Both give simple blocking handlers + efficient I/O. Choose **Half-Sync/Half-Async** when work is substantial, you want **independent tuning** of I/O vs. compute, an explicit buffer for bursts, and a natural control point for admission/priority/metrics. Choose **[Leader/Followers](../09-leader-followers/junior.md)** when latency is critical and tasks are small/uniform — it **deletes the queue and hand-off** (a follower self-promotes and runs the handler in the same thread), saving a context switch, a wakeup, and a copy per request.

**Q21. Walk me through migrating a thread-per-connection server to this pattern.**
Introduce a Reactor for accept/read; introduce a **bounded queue**; move the existing handler **almost unchanged** into worker threads draining the queue (the logic stays blocking — that's the win); add a **reject policy** on the `offer` false branch; add **drain-on-shutdown**. Measure connection scalability before/after.

## Tips for Answering

- **Lead with the three layers and their one rule each.** It frames every follow-up.
- **Always say "bounded queue"** — unprompted. Interviewers are listening for it.
- **Quantify "unduly."** Tie the handoff cost (~µs) to task size to show you know *when* the pattern pays.
- **Name the boundary as the control point** — backpressure, ordering, shutdown, metrics all live there.
- **Reach for `OP_READ` disarming** when asked about backpressure; it separates seniors from juniors.
- **Compare to Leader/Followers** whenever latency comes up — knowing the sibling pattern signals depth.
- **Cite a real system** (kernel top/bottom-half, Android Looper, Netty boss/worker, Go netpoller+goroutines) — it grounds the abstraction.
