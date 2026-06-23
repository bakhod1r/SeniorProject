# Reactor — Optimization Walkthroughs

> Ten before/after optimizations for Reactor-based servers. Each shows the slow version, the problem, the faster version, why it's faster, and the trade-off. Measure before and after — never optimize on intuition alone (see [professional](professional.md) on microbenchmark traps).

## Table of Contents

1. [select/poll → epoll](#1-selectpoll--epoll)
2. [Eliminate the OP_WRITE Spin](#2-eliminate-the-op_write-spin)
3. [Level-Triggered → Edge-Triggered + Drain](#3-level-triggered--edge-triggered--drain)
4. [Single Reactor → Reactor-per-Core](#4-single-reactor--reactor-per-core)
5. [Per-Read Allocation → Pooled Buffers](#5-per-read-allocation--pooled-buffers)
6. [Heap Buffers → Direct Buffers (Zero-Copy)](#6-heap-buffers--direct-buffers-zero-copy)
7. [O(N) Timeout Scan → Timer Wheel](#7-on-timeout-scan--timer-wheel)
8. [Lock-Based Task Queue → Lock-Free MPSC](#8-lock-based-task-queue--lock-free-mpsc)
9. [Per-Op Syscalls → Batched I/O](#9-per-op-syscalls--batched-io)
10. [Blocking Offload Everywhere → Inline Fast Path](#10-blocking-offload-everywhere--inline-fast-path)
11. [Optimization Tips](#optimization-tips)

---

## 1. select/poll → epoll

**Before.** `select(maxfd, &set, ...)` scanning all fds each call.
**Problem.** O(N) in *total* connections per wait. At 50k connections with 200 active, you scan 50k entries every iteration; `select` also caps at `FD_SETSIZE` (1024).
**After.** `epoll` (Linux) / `kqueue` (BSD): kernel-resident interest list returning only the ready set.
**Why faster.** Cost becomes O(active), independent of registered count. This is *the* C10K fix.
**Trade-off.** Platform-specific; abstract behind an interface for portability (libevent/mio do this).

## 2. Eliminate the OP_WRITE Spin

**Before.** Channel registered with `OP_READ | OP_WRITE` permanently.
**Problem.** Sockets are nearly always writable, so `select()` returns instantly every loop — one core pinned at 100% with zero traffic.
**After.** Default to `OP_READ`; add `OP_WRITE` only on a partial write; clear it when the write queue drains.
**Why faster.** The loop sleeps in `select()` when there's nothing to do instead of spinning. CPU at idle drops from 100% to ~0%.
**Trade-off.** Slightly more interest-op bookkeeping; trivial compared to the win.

## 3. Level-Triggered → Edge-Triggered + Drain

**Before.** Level-triggered epoll; one `read()` per event.
**Problem.** LT re-notifies while data remains, so a high-traffic fd generates many `epoll_wait` returns — more syscalls.
**After.** Edge-triggered (`EPOLLET`) with a drain-to-`EAGAIN` loop per event.
**Why faster.** Fewer wakeups/syscalls per byte under load; you process all buffered data per notification.
**Trade-off.** You *must* drain fully or data hangs, and fds must be non-blocking. More error-prone — only adopt with the drain loop and tests in place.

## 4. Single Reactor → Reactor-per-Core

**Before.** One loop on one core; 63 cores idle on a 64-core box.
**Problem.** A single Reactor is a one-core throughput ceiling.
**After.** N loops, each with its own listen socket via `SO_REUSEPORT`; kernel hashes connections across them. Shared-nothing.
**Why faster.** Near-linear scaling; no cross-core locks, no thundering herd (one listener woken per connection), perfect cache affinity.
**Trade-off.** Load balance is by connection hash — long-lived skewed connections can imbalance cores; requires auditing for shared global state.

## 5. Per-Read Allocation → Pooled Buffers

**Before.** `ByteBuffer.allocate(4096)` on every read.
**Problem.** Allocation churn drives GC pressure; at high request rates GC pauses inflate p99 (and pauses stall the whole loop).
**After.** A buffer pool (Netty's `PooledByteBufAllocator` style): acquire on read, release after write.
**Why faster.** Fewer allocations → far less GC → lower, more stable tail latency.
**Trade-off.** Must release buffers correctly or leak; reference-counting bugs are subtle. Worth it only at high throughput.

## 6. Heap Buffers → Direct Buffers (Zero-Copy)

**Before.** Heap `ByteBuffer` for socket I/O.
**Problem.** The JDK copies heap buffers to a temporary direct buffer before every `read`/`write` syscall — an extra memcpy per op.
**After.** Direct (off-heap) `ByteBuffer`s, ideally pooled; and `FileChannel.transferTo()` / `sendfile`/`splice` for file→socket paths to skip user space entirely.
**Why faster.** Eliminates the user-space copy; `sendfile` keeps data in the kernel (true zero-copy) for static content.
**Trade-off.** Direct buffers are costly to allocate and not GC-managed promptly — pool them; small payloads may not justify the off-heap overhead.

## 7. O(N) Timeout Scan → Timer Wheel

**Before.** Each tick, scan every connection comparing `now - lastActivity`.
**Problem.** O(N) per sweep; at 100k connections the sweep itself stalls the loop.
**After.** A hashed timer wheel (Netty `HashedWheelTimer`): bucket timers by expiry slot; advance one slot per tick, firing only that bucket.
**Why faster.** O(1) amortized insert and expiry; you touch only the connections that actually time out this tick.
**Trade-off.** Coarser timer resolution (slot granularity) and slightly more complex bookkeeping; fine for connection idle timeouts.

## 8. Lock-Based Task Queue → Lock-Free MPSC

**Before.** Workers post results to the loop via a `synchronized` queue.
**Problem.** Lock contention between many workers and the single consumer (the loop); the loop can block acquiring the lock — a global stall under load.
**After.** A lock-free Multi-Producer-Single-Consumer queue (e.g. JCTools `MpscArrayQueue`, Netty's MPSC).
**Why faster.** No loop-thread blocking; producers don't serialize on a lock; better throughput and predictable loop latency.
**Trade-off.** Bounded variants can reject when full (handle backpressure); lock-free code is harder to reason about — use a vetted library.

## 9. Per-Op Syscalls → Batched I/O

**Before.** One `read`/`write`/`recvfrom` syscall per message.
**Problem.** At millions of ops/sec, syscall overhead (mode switch + cache pollution, hundreds of ns each) dominates CPU.
**After.** Batch: `recvmmsg`/`sendmmsg` for datagrams; **`io_uring`** to submit many operations and reap many completions per syscall.
**Why faster.** Amortizes syscall cost across many operations; `io_uring` can approach zero syscalls per op with polled rings.
**Trade-off.** `io_uring` is Linux 5.1+, has a steeper API and a completion (Proactor-like) model — a bigger architectural shift toward [Proactor](../04-proactor/junior.md).

## 10. Blocking Offload Everywhere → Inline Fast Path

**Before.** Every request dispatched to the worker pool "to be safe."
**Problem.** Cross-thread handoff costs a queue enqueue, a `wakeup()` syscall, a context switch, and cache misses — often more than the work itself for tiny requests. Latency and CPU both suffer.
**After.** Handle cheap, non-blocking requests *inline on the loop*; offload *only* genuinely slow/blocking work.
**Why faster.** Avoids handoff overhead for the common fast case; the loop stays hot and cache-warm.
**Trade-off.** You must be certain the inline path is non-blocking and bounded — a misjudged "fast" path that occasionally blocks reintroduces global stalls. Measure handler-time distributions before inlining.

## Optimization Tips

- **Measure with an open-loop, constant-arrival load generator** (`wrk2`) and report p50/p99/p99.9 — closed-loop tools hide overload via coordinated omission (see [professional](professional.md)).
- **Optimize the loop's tail, not its mean.** A Reactor's pathology is tail latency from head-of-line blocking; a better mean with a worse p99.9 is usually a regression.
- **Profile syscalls (`strace -c`, `perf stat`)** before reaching for `io_uring`/batching — only worth it if you're syscall-bound.
- **Idle CPU is your canary.** Optimize #2 first if idle CPU isn't ~0%; nothing else matters while a core spins.
- **Scale across cores (#4) before micro-optimizing one loop** — going from 1 to N cores usually dwarfs buffer pooling and timer wheels.
- **Don't offload reflexively (#10).** The handoff is not free; reserve it for work that genuinely can't run inline.
- **Re-measure after every change** and keep the change if and only if the target percentile improved on a representative workload.
