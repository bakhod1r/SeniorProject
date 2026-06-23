# Leader/Followers — Optimize

> Optimization walkthroughs for the Leader/Followers concurrency pattern. Each shows before → problem → after → why → trade-off. Foundations in [senior.md](senior.md) and [professional.md](professional.md).

## Table of Contents

1. [Opt 1 — Shrink the Promotion Critical Section](#opt-1--shrink-the-promotion-critical-section)
2. [Opt 2 — Shard the Handle Set](#opt-2--shard-the-handle-set)
3. [Opt 3 — Promote Per-Handle for Burst Parallelism](#opt-3--promote-per-handle-for-burst-parallelism)
4. [Opt 4 — Pin Threads to Cores (NUMA)](#opt-4--pin-threads-to-cores-numa)
5. [Opt 5 — Use `EPOLLONESHOT` for Free Suspend/Resume](#opt-5--use-epolloneshot-for-free-suspendresume)
6. [Opt 6 — Batch-Drain Selected Keys](#opt-6--batch-drain-selected-keys)
7. [Opt 7 — Offload Blocking Handlers](#opt-7--offload-blocking-handlers)
8. [Opt 8 — FIFO Token to Kill Convoys](#opt-8--fifo-token-to-kill-convoys)
9. [Opt 9 — Right-Size the Pool by Blocking Fraction](#opt-9--right-size-the-pool-by-blocking-fraction)
10. [Opt 10 — Avoid Allocation in the Hot Loop](#opt-10--avoid-allocation-in-the-hot-loop)
11. [Optimization Tips](#optimization-tips)

---

## Opt 1 — Shrink the Promotion Critical Section

**Before.** The lock is held across `select()` and the handler (as in find-bug Bug 6), or across allocation/logging.
**Problem.** Any work under the promotion lock serializes the whole pool — the lock becomes a global mutex, throughput collapses to single-thread.
**After.** Hold the lock for exactly two operations: flip `leaderPresent` and `signal()`. Everything else (`select`, dispatch, logging, allocation) runs outside it.
**Why.** The promotion lock's cache line is contended by all N threads; the shorter the hold, the less time others spin/block. Minimal critical section = maximal overlap.
**Trade-off.** None for correctness; you must be disciplined that no shared state is read outside the lock.

## Opt 2 — Shard the Handle Set

**Before.** One selector, one promotion lock, N threads. At high request rates, profiling shows CPU dominated by lock acquire + CV signal.
**Problem.** The single token's cache line bounces between all N cores (MESI), and the lock saturates — the hand-off cost you removed reappears as lock contention.
**After.** M selectors, M promotion locks, N/M threads each; connections hashed to shards and pinned.
**Why.** Each token is now contended by only N/M threads, cutting coherence traffic roughly M-fold. Throughput scales until per-shard contention reappears.
**Trade-off.** Cross-shard load imbalance (hot shard vs idle shard) and no work stealing. Choose M so threadsPerShard stays small (2–4) without starving idle shards.

## Opt 3 — Promote Per-Handle for Burst Parallelism

**Before.** On a burst, `select()` returns K ready handles; the leader promotes once, then dispatches all K *serially* on its own thread.
**Problem.** The K handlers run sequentially even though K threads are available — burst latency is K × handler time.
**After.** Promote, take one handle; the new leader's `select()` returns the remaining K-1 and it promotes again, taking one — so the burst fans out across threads.
**Why.** Each handle gets its own thread; burst latency drops toward 1 × handler time.
**Trade-off.** More promotion-lock churn per burst (K signals instead of 1). Worth it only when handlers are non-trivial and bursts are common; for tiny handlers, serial dispatch on a warm cache may still win.

## Opt 4 — Pin Threads to Cores (NUMA)

**Before.** Pool threads float across all cores/sockets; connections aren't affinitized to NUMA nodes.
**Problem.** Detect (kernel touches socket buffer on core A) and process (handler runs on core B, different socket) cross NUMA boundaries — cold caches and cross-socket coherence traffic erase Leader/Followers' cache advantage.
**After.** Per-shard pools pinned to a core/socket; connections registered on the selector owned by that socket's pool.
**Why.** Detect+process stay on one socket; the warm-cache benefit (the whole point of the pattern) is realized and compounded.
**Trade-off.** Reduced flexibility and worse balance if traffic is skewed across sockets; requires NUMA-aware connection placement.

## Opt 5 — Use `EPOLLONESHOT` for Free Suspend/Resume

**Before.** Userspace suspend/resume (`key.interestOps(0)` before promote, restore after) to prevent double-dispatch (find-bug Bug 10).
**Problem.** Extra selector mutations and lock juggling per event in userspace.
**After (C/epoll).** Register handles with `EPOLLONESHOT`: the kernel automatically disarms a handle after reporting it once, until you explicitly re-arm it post-handler.
**Why.** The kernel does suspend/resume atomically; the new leader can never re-detect a handle currently being processed. Less userspace bookkeeping, no race window.
**Trade-off.** A mandatory `epoll_ctl(MOD)` re-arm after each handler (a syscall). Java NIO lacks a direct equivalent — you emulate it with interest-ops; this optimization is C/epoll-specific.

## Opt 6 — Batch-Drain Selected Keys

**Before.** Loop: `select()` returns, take *one* key, promote, process, repeat — one `select()` syscall per event.
**Problem.** Under high event rates, one syscall per event dominates; syscall overhead throttles throughput.
**After.** Drain *all* ready keys from one `select()`, promote, then process the batch (or fan out per Opt 3). One syscall amortizes over K events.
**Why.** Syscall count drops from O(events) toward O(bursts); fewer kernel transitions, higher throughput.
**Trade-off.** Slightly higher per-event latency for the last key in a large batch, and tension with Opt 3 (per-handle promotion). Tune batch size against your latency SLO.

## Opt 7 — Offload Blocking Handlers

**Before.** A handler occasionally does a blocking DB/RPC call inline.
**Problem.** A blocked processor can't lead; a few concurrent slow handlers starve the leader role, and detection latency spikes — Leader/Followers' worst failure mode.
**After.** Detect the blocking step and hand *just that step* to a separate blocking-IO thread pool (or async client), returning the L/F thread to follow immediately.
**Why.** L/F threads stay short and uniform — the precondition for the pattern — while slow work runs elsewhere.
**Trade-off.** Reintroduces a hand-off for the blocking subset (the cost you avoided), and added complexity. If *most* handlers block, abandon L/F for [Half-Sync/Half-Async](../08-half-sync-half-async/junior.md) entirely.

## Opt 8 — FIFO Token to Kill Convoys

**Before.** A plain `Condition` + `signal()`; whichever thread re-contends fastest after processing keeps winning leadership.
**Problem.** Unfair leadership causes a convoy: the fast re-contender hogs the leader role, others starve, and tail latency for "unlucky" threads' connections spikes.
**After.** A FIFO follower queue (ACE's `ACE_Token` model): promote the *head* of the wait queue, not an arbitrary follower.
**Why.** Strict FIFO bounds the wait any follower experiences; leadership rotates fairly; tail latency tightens.
**Trade-off.** Slightly higher per-promotion overhead (queue management vs a single signal). Worth it for latency-fairness-sensitive workloads; overkill for uniform ones.

## Opt 9 — Right-Size the Pool by Blocking Fraction

**Before.** Pool size = CPU count (the reflex for CPU-bound pools).
**Problem.** If handlers spend a fraction `f` of their time blocked (even briefly), CPU-count threads leave cores idle during those blocks and can starve the leader role.
**After.** Size N ≈ cores / (1 − f). Measure `f` empirically (handler wall-time vs CPU-time).
**Why.** Provides enough threads that one is always free to lead even while others are momentarily blocked, without over-subscribing.
**Trade-off.** Over-sizing increases promotion-lock contention (more threads on the token) and memory; under-sizing risks leader starvation. It's a measured balance, not a formula to apply blindly.

## Opt 10 — Avoid Allocation in the Hot Loop

**Before.** Each iteration allocates a fresh `ArrayList<SelectionKey>` (or boxes, or builds log strings) per `select()`.
**Problem.** Hot-loop allocation creates GC pressure that introduces pauses — directly hitting the tail latency Leader/Followers is chosen to protect.
**After.** Reuse a per-thread scratch buffer for the drained keys; defer/skip log-string construction unless logging is enabled; avoid boxing.
**Why.** Zero steady-state allocation → no GC-induced jitter → stable p99.
**Trade-off.** Slightly more code (object reuse, thread-local buffers) and care to keep reused buffers thread-confined. Standard low-latency hygiene.

## Optimization Tips

- **Profile before optimizing.** Leader/Followers' justification *is* performance, so every change here must be validated against context-switch count, cache-misses, and p99 — not wall-clock alone (see professional.md's microbenchmark anatomy).
- **The promotion lock is the usual ceiling.** Opts 1, 2, and 8 all target it. Shrink the critical section first (free); shard when one token saturates; add FIFO only for fairness.
- **Warm cache is the whole point.** Opts 4 and 10 protect the cache-locality advantage; if you let detect and process drift to different cores or thrash GC, you've thrown away the reason to use the pattern.
- **Know when to stop.** If you find yourself adding Opt 7 (offloading) for *most* handlers, the workload is blocking — switch to [Half-Sync/Half-Async](../08-half-sync-half-async/junior.md). If you push sharding to one thread per shard, you've arrived at Thread-Pool-per-Reactor; that's a valid destination, not a failure.
- **Each optimization has an inverse trade.** Per-handle promotion (Opt 3) adds lock churn; batching (Opt 6) adds latency; sharding (Opt 2) adds imbalance. Optimize against your specific SLO, and measure both directions.
