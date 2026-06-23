# Reactor — Interview Questions

> Graded Q&A for the [Reactor](junior.md) concurrency pattern — from "what is it" to "how would you scale and debug it." Model answers included; read them as *what a strong answer covers*, not a script to memorize.

## Table of Contents

1. [Junior Questions](#1-junior-questions)
2. [Middle Questions](#2-middle-questions)
3. [Senior Questions](#3-senior-questions)
4. [Professional Questions](#4-professional-questions)
5. [Coding Tasks](#5-coding-tasks)
6. [Trick Questions](#6-trick-questions)
7. [Behavioral / Architectural Questions](#7-behavioral--architectural-questions)
8. [Tips for Answering](#8-tips-for-answering)

---

## 1. Junior Questions

**Q1. What problem does the Reactor pattern solve?**
Serving many concurrent I/O sources (sockets) without one thread per source. A single-threaded event loop asks the OS which handles are ready, then synchronously dispatches each ready event to its registered handler. It decouples connection count from thread count, giving high concurrency with tiny memory.

**Q2. Name the five participants.**
Handle (an fd/socket), Synchronous Event Demultiplexer (`select`/`epoll_wait`), Reactor / Initiation Dispatcher (register/remove + event loop), Event Handler interface (`handle_event`, `get_handle`), and Concrete Event Handlers (your service logic).

**Q3. Why must handlers be non-blocking?**
They all run on the single loop thread, one at a time. A blocking handler stalls *every* other connection until it returns — the failure is global, not per-connection.

**Q4. Reactor vs Proactor in one sentence?**
Reactor is **readiness-based** ("the socket is readable — *you* do the read"); [Proactor](../04-proactor/junior.md) is **completion-based** ("the read is done — here's the data"), with the OS performing the I/O asynchronously.

## 2. Middle Questions

**Q5. Why does leaving `OP_WRITE` registered with nothing to send pin a CPU at 100%?**
A connected socket is almost always writable, so the demultiplexer returns immediately every loop iteration with that key "ready," spinning. Register `OP_WRITE` only when you have a pending partial write; clear it once the write queue drains.

**Q6. TCP gave you half a message. How do you handle it?**
Buffer received bytes per connection and only act on a *complete* protocol unit (line, length-prefixed frame, full HTTP request). Keep the partial tail (`compact()`) until more bytes arrive. Symmetrically, a `write()` may flush only part — queue the remainder and finish on the next `OP_WRITE`.

**Q7. A handler needs a 50 ms database call. What do you do?**
Never run it on the loop. Submit it to a [Thread Pool](../05-thread-pool/junior.md); the worker computes off-loop and posts the result back via a thread-safe queue plus `selector.wakeup()`. Only the loop thread then writes to the channel. That's the [Half-Sync/Half-Async](../08-half-sync-half-async/junior.md) structure.

## 3. Senior Questions

**Q8. A single Reactor uses one core. How do you use all 64?**
Three options: (a) main/sub-reactor — one acceptor hands connections to N sub-reactors on separate threads; (b) reactor-per-core with `SO_REUSEPORT` so the kernel hashes connections across per-core listen sockets (shared-nothing, no handoff, no thundering herd); (c) [Leader/Followers](../09-leader-followers/junior.md) — a thread pool shares one demultiplexer with leader promotion. Choose by whether connections must migrate between loops (favor main/sub) or you want maximal cache affinity (favor reactor-per-core).

**Q9. Why is a single-Reactor system lock-free, and how do you keep that property when scaling?**
A channel is owned by exactly one thread for its lifetime, so per-connection state needs no locks. To preserve it: never let a second thread touch a channel; all cross-loop communication goes through a thread-safe queue *drained by the owning loop*, and only that loop mutates selector/channel state.

**Q10. What inflates p99 latency in a Reactor and how do you bound it?**
Head-of-line blocking: one slow handler delays every other ready event on that loop. Bound per-handler work, cap per-connection work per iteration (fairness), use an `ioRatio` to time-slice I/O vs tasks, offload anything CPU-heavy, and monitor per-iteration loop latency so accidental blocking is caught.

## 4. Professional Questions

**Q11. Why did C10K need epoll instead of select/poll?**
`select`/`poll` are O(N) in *total* registered fds per call — at 10k connections with few active, you still scan 10k entries every wait. `epoll` keeps a kernel-resident interest list and returns only the ready set (O(ready)), so cost scales with *activity*, not connection count.

**Q12. Explain edge-triggered vs level-triggered epoll and a bug each invites.**
Level-triggered reports readiness while the condition holds — forgiving, but if you keep `OP_WRITE` armed it spins. Edge-triggered reports only the not-ready→ready transition — fewer syscalls, but if you don't drain to `EAGAIN` the residual bytes go unnoticed until the next edge, hanging the request. ET also requires non-blocking fds and (with shared epoll) `EPOLLONESHOT` to avoid two threads handling one fd.

**Q13. Memory model: a worker posts a result back to the loop. What makes it visible?**
The handoff must go through a structure that establishes happens-before — e.g. a `j.u.c` concurrent queue: writes before `offer()` are visible after `poll()`. A bare field write plus `wakeup()` is not sufficient; `wakeup()` doesn't specify ordering for arbitrary memory.

## 5. Coding Tasks

- **T1.** Write a single-threaded NIO echo server (`Selector` + `OP_ACCEPT`/`OP_READ`), correctly calling `it.remove()`.
- **T2.** Extend it with a per-connection write queue and correct `OP_WRITE` toggling under a slow reader.
- **T3.** Implement length-prefixed (4-byte BE) framing that survives 1-byte-at-a-time delivery.
- **T4.** Add an offload path: a 10 ms task runs on a thread pool and its result is written back via the loop using `wakeup()`.
- **T5.** Add per-connection idle timeout using a single scheduled sweep (bonus: a timer wheel).

## 6. Trick Questions

**Q14. Your non-blocking `read()` returned 0. Is the connection closed?**
No. On a non-blocking socket, 0 (or `EAGAIN`) means "would block, nothing now." **-1** (Java) / `read() == 0` after a real readable event in C semantics means peer closed — know your API: in Java NIO, `read()` returning `-1` means EOF; `0` means no data available.

**Q15. "Reactor is single-threaded, so it can't have race conditions." True?**
False. No *data* races on per-connection state, yes — but logical races across connections sharing mutable global state still exist, and the moment you offload to workers you have real concurrency to synchronize.

**Q16. Node.js is "non-blocking," yet `crypto.pbkdf2Sync` on the main thread tanks the whole server. Why?**
Node is a Reactor; synchronous CPU work runs *on the loop thread*. "Non-blocking" refers to I/O, not CPU. The sync hash blocks the single loop, stalling every connection. Use the async variant (libuv's thread pool) or a worker thread.

## 7. Behavioral / Architectural Questions

**Q17. When would you *not* choose a Reactor?**
CPU-bound services (need parallelism, not an event loop), heavy reliance on blocking APIs with no async client, low connection counts where thread-per-request is simpler, or teams without non-blocking discipline (one stray blocking call is a global outage). Mention virtual threads (Loom) as the modern alternative that keeps blocking-style code while the runtime provides the Reactor.

**Q18. Walk me through debugging a Reactor pinned at 100% CPU with zero traffic.**
Hypotheses in order: (1) `OP_WRITE` left armed with empty queue — check interest ops; (2) the JDK `Selector` empty-select spin bug — count zero-ready iterations, rebuild selector (Netty does this); (3) a tight retry on `EAGAIN`. Confirm with `perf top`/`strace -c` showing `epoll_wait` returning instantly with no work. Fix the interest management or selector.

## 8. Tips for Answering

- **Lead with the readiness-vs-completion distinction** — it instantly signals you understand Reactor vs Proactor.
- **Always volunteer the failure mode**: "handlers must be non-blocking because the failure is *global*." Interviewers want to hear you've felt the pain.
- **Name real systems** (Redis single loop, nginx reactor-per-worker, Netty boss/worker, libuv thread pool) — concreteness beats theory.
- **For scaling questions, structure the answer as a small decision tree** (handoff needed? cache affinity? blocking deps?) rather than listing topologies.
- **Distinguish concurrency from parallelism** explicitly; conflating them is the most common junior tell.
- **When unsure, reason from the single-thread invariant** — most Reactor answers fall out of "one thread owns the loop; it must never block; cross-thread state needs publication."
