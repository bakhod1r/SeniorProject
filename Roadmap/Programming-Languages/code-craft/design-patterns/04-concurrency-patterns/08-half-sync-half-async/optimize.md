# Half-Sync/Half-Async — Optimization

> Ten before/after optimizations for the Half-Sync/Half-Async boundary. Each: **before → problem → after → why → trade-off.** Back to [senior.md](senior.md) · [professional.md](professional.md).

---

## 1 — Bound the queue (correctness *and* latency)

**Before:** `new LinkedBlockingQueue<>()` (unbounded).

**Problem:** Overload → unbounded memory growth → OOM; and even short of OOM, a deep queue means multi-second wait times.

**After:** `new ArrayBlockingQueue<>(C)` where `C` is derived from a **latency budget**: `C ≈ budget × serviceRate × workers`.

**Why:** A bounded queue caps in-system latency and memory and forces an explicit overload policy.

**Trade-off:** A smaller queue rejects sooner under bursts. That's usually *better* than queueing requests that will time out — but tune `C` to your real burst shape, not to 10.

---

## 2 — Transfer buffer ownership instead of copying

**Before:** Copy kernel bytes into a fresh `byte[]` per request to enqueue.

**Problem:** A memcpy per request plus an allocation per request → GC pressure and bandwidth waste; at high QPS this dominates.

**After:** Enqueue a **reference-counted pooled buffer** (`ByteBuf.retain()` / `sk_buff`); the worker `release()`s it after use. The async layer stops touching it after handoff (ownership transfer).

**Why:** Removes the copy and the per-request allocation; the buffer is reused from a pool.

**Trade-off:** You now manage lifetimes manually — leak a `retain()` and you exhaust the pool; release twice and you corrupt it. Document the ownership rule strictly.

---

## 3 — Batch the handoff

**Before:** `offer` one item, worker `take`s one item — one lock acquisition and (potentially) one wakeup per request.

**Problem:** The per-item lock + wakeup overhead is paid in full for every tiny request.

**After:** Producer enqueues in small batches; consumer `drainTo(list, N)` per lock acquisition and processes the batch.

**Why:** Amortizes the queue lock and coalesces wakeups across N items — one unpark serves a whole batch.

**Trade-off:** Adds a little latency (an item may wait for its batch to fill or a flush timer). Cap batch size / add a max-delay flush so latency stays bounded.

---

## 4 — Shard the boundary per core

**Before:** One global `ArrayBlockingQueue` feeding N workers.

**Problem:** A single lock serializes all producers and consumers; adding workers stops increasing throughput (lock contention, head/tail cache-line bouncing).

**After:** `P` shards, each = one selector + one **SPSC** queue + one worker; connections affined by hash.

**Why:** Each shard is single-producer/single-consumer → no contention, can be lock-free, and gives **free per-connection ordering**.

**Trade-off:** Possible load imbalance if connections are skewed (one hot connection on one shard). Mitigate with consistent hashing or rebalancing.

---

## 5 — Keep workers hot (avoid park/unpark)

**Before:** Worker blocks in `queue.take()`; every item that arrives to an empty queue costs a futex wakeup (~µs).

**Problem:** Under bursty-but-frequent traffic, the park→unpark round-trip dominates the per-item cost.

**After:** Brief adaptive spin before parking — `Thread.onSpinWait()` for a bounded number of iterations, then fall back to blocking (Disruptor-style busy-spin/yield/block wait strategy).

**Why:** When the next item arrives within the spin window, the worker grabs it with no syscall.

**Trade-off:** Spinning burns a CPU core. Only worth it for latency-critical paths with spare cores; cap the spin and degrade to blocking when idle.

---

## 6 — Lock-free, cache-line-padded queue

**Before:** `ArrayBlockingQueue` (single lock; head/tail likely on the same cache line).

**Problem:** Lock contention at high rates; false sharing as producer and consumer ping-pong the head/tail cache line.

**After:** `LinkedTransferQueue`, an MPSC/SPSC ring, or an LMAX Disruptor; pad/`@Contended` the sequence counters.

**Why:** Removes the lock (CAS-based hand-off) and the false sharing → far higher throughput at high concurrency.

**Trade-off:** More complex; bounding and backpressure are trickier to get right; harder to debug. Reach for it only when profiling shows the queue is the bottleneck.

---

## 7 — TCP-level backpressure (don't read what you can't process)

**Before:** Always read on `OP_READ`; reject at the queue when full.

**Problem:** You spend CPU reading and copying bytes only to reject them; rejection also forces clients to retry.

**After:** When the queue passes a high-water mark, **disarm `OP_READ`**; re-arm at a low-water mark. Bytes stay in the socket buffer; the TCP window closes; the peer throttles itself.

**Why:** Backpressure reaches the *source* without creating, reading, or copying work you can't handle — the most efficient mechanism.

**Trade-off:** Requires per-connection state and careful re-arm (with `selector.wakeup()` if done off-thread). A slow consumer now slows the *sender*, which may be undesirable for fan-in from many peers (one slow shard backpressures everyone on it).

---

## 8 — Right-size the worker pool to the work profile

**Before:** A fixed `newFixedThreadPool(8)` regardless of workload.

**Problem:** For I/O-bound handlers (mostly parked on DB/network), 8 threads under-utilize CPU and let the queue back up; for CPU-bound handlers, far more than `cores` threads thrash via context switches.

**After:** Size by profile — CPU-bound ≈ `cores`; I/O-bound ≈ `cores × (1 + waitTime/computeTime)` — measured, not guessed.

**Why:** Matches concurrency to where time is actually spent, maximizing throughput without thrashing.

**Trade-off:** Too many threads → context-switch and memory overhead; too few → queue backs up and rejects. Re-measure when the handler changes. (Virtual threads / Loom sidestep the sizing for blocking I/O work.)

---

## 9 — Coalesce wakeups / use single-element signaling

**Before:** A hand-rolled boundary calls `condition.signalAll()` on every enqueue with many workers parked.

**Problem:** Thundering herd — every enqueue wakes all workers; all but one re-park immediately, wasting context switches.

**After:** Signal **one** waiter per item (`signal()` not `signalAll()`), or just use `java.util.concurrent`'s `BlockingQueue`, which already does correct single-element wakeup.

**Why:** One item → one wakeup. Removes the herd.

**Trade-off:** Effectively none if you use the JDK queue. The lesson: don't reinvent the boundary's signaling — the standard queues already coalesce correctly.

---

## 10 — Inline tiny tasks / migrate to Leader/Followers

**Before:** Every event, however trivial, crosses the queue to a worker.

**Problem:** For sub-microsecond tasks the handoff (enqueue + switch + wakeup + maybe copy, ~µs) costs more than the work — the pattern is a *net loss*.

**After:** Two options. (a) **Inline** trivial tasks in the async layer (process immediately) and only enqueue the substantial ones — a cheap "fast-path." (b) Migrate to **[Leader/Followers](../09-leader-followers/junior.md)**: a follower self-promotes and runs the handler **in the same thread**, deleting the queue, the cross-thread wakeup, and the copy.

**Why:** Removes the handoff tax where it dominates; for small, uniform tasks Leader/Followers wins p99 latency outright.

**Trade-off:** Inlining risks blocking the async thread if a "tiny" task isn't actually tiny — classify carefully. Leader/Followers gives up the queue's independent tuning, burst buffering, and central control point. Choose by measuring both in the same harness.

---

## Optimization Tips

- **Profile before optimizing.** The two questions: *Is the queue the bottleneck?* (lock contention, park/unpark in flame graphs) and *Does the handoff cost exceed the work?* (compare against an inline baseline). Optimize only what the profile indicts.
- **Attack the dominant term.** The handoff = lock + wakeup + switch + maybe copy. Kill the copy (Opt 2), the contention (Opt 4/6), and the wakeup (Opt 3/5) in that order of usual impact.
- **Backpressure beats buffering.** Opt 7 (don't read) is strictly better than Opt 1 (reject at queue) when you can do it — refusing to create work is cheaper than discarding it.
- **Bench honestly.** Open-loop (fixed arrival rate), HDR histograms, p99/p99.9 not means, both park and no-park regimes, CPU-pinned, allocation-free work items. See [professional.md](professional.md)'s microbenchmark anatomy.
- **Know when to stop.** Optimizing the queue far enough lands you next to Leader/Followers — at that point, deleting the queue (Opt 10) is often the real win.
