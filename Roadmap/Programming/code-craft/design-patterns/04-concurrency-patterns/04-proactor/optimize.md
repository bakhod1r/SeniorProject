# Proactor — Optimize

> Ten before/after optimization walkthroughs for Proactor-based I/O, from syscall batching to NUMA-local buffers. Each shows the problem, the change, why it helps, and the trade-off. Stack: C++/Boost.Asio, io_uring, Win32 IOCP. See [senior](senior.md) and [professional](professional.md).

## Table of Contents

1. [Opt 1 — Pool handler allocations](#opt-1--pool-handler-allocations)
2. [Opt 2 — Batch completion dequeue](#opt-2--batch-completion-dequeue)
3. [Opt 3 — io_uring SQPOLL (zero-syscall)](#opt-3--io_uring-sqpoll-zero-syscall)
4. [Opt 4 — Registered buffers / fixed files](#opt-4--registered-buffers--fixed-files)
5. [Opt 5 — async_read instead of looped reads](#opt-5--async_read-instead-of-looped-reads)
6. [Opt 6 — Per-core sharding over strands](#opt-6--per-core-sharding-over-strands)
7. [Opt 7 — Scatter/gather writes](#opt-7--scattergather-writes)
8. [Opt 8 — NUMA-local buffers](#opt-8--numa-local-buffers)
9. [Opt 9 — Right-size the thread pool](#opt-9--right-size-the-thread-pool)
10. [Opt 10 — Offload blocking work](#opt-10--offload-blocking-work)
11. [Optimization Tips](#optimization-tips)

---

## Opt 1 — Pool handler allocations

**Before:** Every `async_*` call heap-allocates its completion-handler closure via global `new`; at 1M ops/s this is millions of `malloc`/`free` and allocator-lock contention.
**After:** Use Asio's handler-allocation hooks (custom allocator / `asio::recycling_allocator`) so each connection reuses a small fixed block for its (single outstanding) handler.
**Why:** The handler is short-lived and one-at-a-time per op; a per-connection slab eliminates global-allocator traffic and improves cache locality.
**Trade-off:** More code and a per-connection memory reservation; only worth it on the hot path.

## Opt 2 — Batch completion dequeue

**Before:** `GetQueuedCompletionStatus` (one completion per syscall) or `io_uring` peeking one CQE at a time.
**After:** `GetQueuedCompletionStatusEx` / drain the whole CQ ring per wakeup, processing N completions per syscall.
**Why:** Amortizes the demultiplex syscall and wakeup cost across many completions — the dominant win at high QPS.
**Trade-off:** A few microseconds of added latency if you wait to accumulate a batch; tune batch size to your latency SLO.

## Opt 3 — io_uring SQPOLL (zero-syscall)

**Before:** Each submission costs an `io_uring_enter` syscall.
**After:** Enable **SQPOLL**; a kernel thread polls the submission queue, so user space submits by writing an SQE and advancing the tail — no syscall in steady state.
**Why:** At high submission rates, syscall entry/exit dominates; removing it lifts throughput substantially.
**Trade-off:** A dedicated kernel poller thread burns a core; only pays off under sustained high load. Requires correct memory barriers on the SQ tail.

## Opt 4 — Registered buffers / fixed files

**Before:** Every io_uring op pins the user buffer's pages and resolves the fd on each submission.
**After:** Pre-register buffers (`IORING_REGISTER_BUFFERS`) and files (fixed-file table); ops reference them by index.
**Why:** Removes per-op page-pinning and fd lookup from the kernel hot path.
**Trade-off:** Up-front registration and a fixed pool of buffers/fds; less flexible, more setup.

## Opt 5 — async_read instead of looped reads

**Before:** Manual loop of `async_read_some` calls to assemble a fixed-length message, each a separate completion round-trip.
**After:** A single `async_read(sock, buffer(N))` that the library loops internally until N bytes.
**Why:** Fewer completion dispatches and handler invocations for the common framed-message case; also removes a class of partial-read bugs.
**Trade-off:** Less control over incremental progress; not suitable when you want to act on partial data as it arrives.

## Opt 6 — Per-core sharding over strands

**Before:** Multi-threaded `io_context` with strands serializing each connection's handlers — strands still hop threads and touch a serialization queue.
**After:** One `io_context` + pinned thread per core; each connection assigned to one shard, so its handlers run on a single thread — no strand needed.
**Why:** Eliminates strand bookkeeping and cross-thread cacheline bouncing on per-connection state; near-linear core scaling.
**Trade-off:** Cross-shard work (broadcast, shared caches) now needs explicit coordination; load imbalance if sharding is uneven.

## Opt 7 — Scatter/gather writes

**Before:** Header and body written as two separate `async_write` calls (two ops, two completions).
**After:** A single gather write over a buffer sequence `{header, body}` (`async_write` with a buffer sequence / `WSASend` multi-buffer / io_uring `IORING_OP_WRITEV`).
**Why:** One kernel op coalesces both regions, halving syscalls and completions and avoiding a copy to concatenate.
**Trade-off:** You must keep *all* buffers in the sequence alive until completion; slightly more bookkeeping.

## Opt 8 — NUMA-local buffers

**Before:** Buffers allocated from a global heap; a completion draining on core 12 touches memory homed on a remote NUMA node.
**After:** Allocate each per-core Proactor's buffers from its local NUMA node and pin its threads to that node's cores.
**Why:** Every completion touches the buffer; remote-node access adds tens of nanoseconds per touch, a silent throughput cap at scale.
**Trade-off:** NUMA-aware allocation complexity; benefits only on multi-socket machines.

## Opt 9 — Right-size the thread pool

**Before:** `io.run()` from 4× core count "to be safe," assuming more threads = more throughput.
**After:** Threads ≈ core count (IOCP: set the concurrency value to cores, keep a few spares).
**Why:** Proactor worker threads rarely block, so oversubscription only adds context switches and cache pollution without parallelism gains.
**Trade-off:** Fewer spares to absorb an accidentally-blocking handler — pairs with Opt 10 (offload blocking work).

## Opt 10 — Offload blocking work

**Before:** A handler calls a synchronous DB/crypto/file API, blocking a Proactor worker and causing correlated p99 spikes across all its connections.
**After:** `post` the blocking call to a *separate* dedicated thread pool; resume the connection via a completion/`post` back to its executor when done.
**Why:** Keeps Proactor workers non-blocking so they stay available for I/O completions; isolates blocking latency to the offload pool.
**Trade-off:** Extra context switches and a second pool to size/monitor; only offload genuinely blocking work, not cheap CPU.

## Optimization Tips

- **Measure before optimizing.** Profile with p50/p99/p999 latency *and* ops/s; count syscalls (`strace -c`, ETW) to verify Opt 2/3/4 actually reduced them.
- **Order of impact at high QPS:** syscall reduction (Opt 2/3) > allocation pooling (Opt 1) > sharding/NUMA (Opt 6/8) > the rest. Tackle in that order.
- **Never trade away correctness for speed** — scatter/gather and per-core sharding both add lifetime/coordination requirements; keep sanitizers in the loop.
- **The biggest single win is usually negative work:** removing blocking from handlers (Opt 10) and removing syscalls (Opt 3) beat any micro-tuning.
- **Validate the engine, not just the API.** If you're on epoll-emulated Asio, Opt 3/4 don't apply — confirm you're actually on IOCP or io_uring before chasing kernel-async optimizations.
