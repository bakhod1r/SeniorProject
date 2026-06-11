# Half-Sync/Half-Async — Tasks

> Hands-on tasks to internalize the Half-Sync/Half-Async pattern. Build the three layers, then stress the boundary. Back to [junior.md](junior.md) · [middle.md](middle.md).

## Table of Contents

1. [Task 1 — Minimal three-layer echo server](#task-1--minimal-three-layer-echo-server)
2. [Task 2 — Bound the queue and add a reject policy](#task-2--bound-the-queue-and-add-a-reject-policy)
3. [Task 3 — Backpressure metrics](#task-3--backpressure-metrics)
4. [Task 4 — Graceful drain on shutdown](#task-4--graceful-drain-on-shutdown)
5. [Task 5 — Per-connection ordering](#task-5--per-connection-ordering)
6. [Task 6 — TCP-level backpressure via OP_READ](#task-6--tcp-level-backpressure-via-op_read)
7. [Task 7 — Eliminate the cross-layer copy](#task-7--eliminate-the-cross-layer-copy)
8. [Task 8 — Shard the boundary per core](#task-8--shard-the-boundary-per-core)
9. [Task 9 — Half-Sync/Half-Reactive with a real Selector](#task-9--half-synchalf-reactive-with-a-real-selector)
10. [Task 10 — Migrate to Leader/Followers and compare](#task-10--migrate-to-leaderfollowers-and-compare)
11. [How to Practice](#how-to-practice)

---

## Task 1 — Minimal three-layer echo server

**Goal:** Build the smallest correct Half-Sync/Half-Async system: an async producer, a queue, and a pool of sync workers.

**Requirements:**
- One async thread that *generates* `Request` items (simulate I/O with a loop) and enqueues them.
- A `BlockingQueue` boundary.
- A fixed pool of worker threads that `take()` and "process" (sleep a few ms to mime blocking work) and print the result.

**Hints:** `Executors.newFixedThreadPool`, `queue.take()` in workers, `queue.offer()`/`put()` in the producer (you'll fix the choice in Task 2).

**Solution sketch:** Producer loop → `queue.put(new Request(id++))`; each worker `while(running){ Request r = queue.take(); process(r); }`. Confirm work spreads across all workers (print thread names).

## Task 2 — Bound the queue and add a reject policy

**Goal:** Make the boundary bounded and decide overload behavior.

**Requirements:**
- Replace any unbounded queue with `new ArrayBlockingQueue<>(capacity)`.
- Producer uses `offer()` (never `put()`); on `false`, invoke a `RejectPolicy`.
- Implement two policies: `LogAndDrop` and `CountReject`.

**Hints:** Make `RejectPolicy` a functional interface `void onReject(Request r)`. Drive the producer faster than the workers so rejections actually happen.

**Solution sketch:**
```java
if (!queue.offer(r)) rejectPolicy.onReject(r);
```
Verify: with a small queue and slow workers, reject count climbs steadily while memory stays flat — the whole point of bounding.

## Task 3 — Backpressure metrics

**Goal:** Make the boundary observable.

**Requirements:** Expose `queueDepth()`, `enqueuedCount()`, `rejectedCount()`. Sample depth every 100 ms and log it. Use `LongAdder` for counters.

**Hints:** `queue.size()` for depth (cheap, approximate). Don't use a plain `long`++ across threads — it's a race; use `LongAdder`.

**Solution sketch:** A scheduled task prints `depth=…, enq=…, rej=…`. Run a burst, then idle: watch depth spike then drain to 0. This is your live picture of the producer–consumer rate mismatch.

## Task 4 — Graceful drain on shutdown

**Goal:** Shut down without losing in-flight work.

**Requirements:**
- A `shutdown()` that (1) flips `accepting=false` so new submits reject, (2) enqueues one poison sentinel per worker, (3) `awaitTermination`.
- A test: enqueue N items, call `shutdown()`, assert **all N** were processed.

**Hints:** Use a sentinel `Request POISON`; a worker that takes `POISON` breaks its loop. `accepting` must be `volatile`.

**Solution sketch:** Order is everything — stop intake, then drain, then stop. If you kill workers first, the queue's remaining items are lost (that's the bug to avoid).

## Task 5 — Per-connection ordering

**Goal:** Guarantee per-connection order while keeping parallelism across connections.

**Requirements:** Each `Request` has a `connId`. Route all requests with the same `connId` to the same worker. Add a sequence number per connection and assert the worker sees them in order.

**Hints:** Give each worker its **own** queue; producer picks `workers[Math.floorMod(connId.hashCode(), N)]`. A single global queue + N workers cannot guarantee per-conn order.

**Solution sketch:** `perWorkerQueue[shard].offer(r)`. Each connection is now single-consumer → ordered. Cross-connection interleaving is fine. This is the same trick that later removes queue contention (Task 8).

## Task 6 — TCP-level backpressure via OP_READ

**Goal:** Push backpressure to the *peer* instead of rejecting.

**Requirements:** Using a real `Selector`, when the queue reaches a high-water mark, clear `OP_READ` on the channels; when it drains below a low-water mark, re-arm `OP_READ`.

**Hints:** `key.interestOps(key.interestOps() & ~SelectionKey.OP_READ)` to disarm; OR it back to re-arm. Use `wakeup()` if you change interest from another thread.

**Solution sketch:** With reads disarmed, bytes pile in the socket buffer, the TCP window closes, and the sender throttles itself — no work created, nothing to reject. This is the cleanest backpressure and the senior-level answer.

## Task 7 — Eliminate the cross-layer copy

**Goal:** Stop copying bytes at the handoff.

**Requirements:** Instead of copying the read `ByteBuffer` into a fresh `byte[]` to enqueue, enqueue a **pooled, reference-counted buffer** and have the worker `release()` it after processing.

**Hints:** Simulate a pool with a fixed set of reusable buffers + a ref count. The async layer "retains," the worker "releases." Never touch a buffer after enqueuing it (ownership transfer).

**Solution sketch:** Measure allocations before/after (`-verbose:gc` or a counter). The copy + per-request array allocation disappears; GC pressure drops. Document the ownership rule clearly — this is where use-after-free style bugs hide.

## Task 8 — Shard the boundary per core

**Goal:** Remove queue-lock contention.

**Requirements:** Create `P = availableProcessors()` shards, each with its own selector + queue + worker. Affine connections by hash. Benchmark throughput vs. the single-queue version under many producers.

**Hints:** Each shard is single-producer/single-consumer → you can use a cheaper/lock-free queue. Reuse the affinity from Task 5.

**Solution sketch:** Single global queue throughput plateaus as you add workers (lock contention); sharded version scales closer to linear. Plot throughput vs. worker count for both.

## Task 9 — Half-Sync/Half-Reactive with a real Selector

**Goal:** Make the async layer a genuine [Reactor](../03-reactor/junior.md).

**Requirements:** Accept real TCP connections; on `OP_READ`, do a non-blocking read, assemble a full request (handle partial reads!), enqueue it; workers parse and write a response.

**Hints:** Buffer per-connection bytes until a full message is present (length-prefix or delimiter) *before* enqueuing — enqueueing partial data is a classic bug. Attach a per-connection buffer to the `SelectionKey`.

**Solution sketch:** This is the production shape. Test with `nc`/a load tool. Verify partial reads are reassembled and that the selector thread never blocks on anything but `select()`.

## Task 10 — Migrate to Leader/Followers and compare

**Goal:** Feel why the handoff costs, by deleting it.

**Requirements:** Reimplement Task 9 as [Leader/Followers](../09-leader-followers/junior.md): a pool of threads take turns being the leader on the selector; on an event, the leader promotes a follower and **handles the event itself** (no queue). Benchmark p50/p99 latency vs. the Half-Sync/Half-Async version for small tasks and for large tasks.

**Hints:** Use a lock + condition for leadership handoff. The key difference: no enqueue, no separate worker wakeup, no copy.

**Solution sketch:** For **small/uniform** tasks, Leader/Followers wins latency (no handoff). For **large/variable** tasks or when you want independent I/O-vs-compute tuning and burst buffering, Half-Sync/Half-Async's queue earns its cost. Write up which you'd ship and why — that's the real deliverable.

## How to Practice

- **Build 1→5 in one sitting.** They form a complete, observable, shutdown-safe boundary — the core of the pattern.
- **Always flood it.** Every task is only convincing under load where producer rate > consumer rate. A system that never fills its queue hasn't tested the interesting part.
- **Watch the queue depth graph.** Depth is the live readout of the rate mismatch; learn to read spikes (bursts) vs. sustained high depth (overload).
- **Measure, don't assume.** Tasks 7, 8, 10 only teach if you benchmark before/after. Use a fixed-arrival-rate (open-loop) generator and report p99, not the mean.
- **Inject the boundary** behind an interface so you can run the whole pipeline single-threaded in tests (deterministic) and multi-threaded in load tests.
- **Keep an immutability/ownership rule written at the top of your work-item class.** Most boundary bugs are post-enqueue mutation or use-after-handoff.
