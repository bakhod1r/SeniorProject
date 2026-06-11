# Proactor — Interview Questions

> Graded Q&A for the Proactor pattern, from fundamentals to architecture. See also [junior](junior.md), [middle](middle.md), [senior](senior.md), [professional](professional.md).

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

**Q1. What problem does the Proactor pattern solve?**
It decouples connection count from thread count for I/O-bound servers. Instead of a thread blocking per connection, you *initiate* asynchronous operations; the OS performs the I/O and notifies you on *completion*. A few threads can then service enormous numbers of connections.

**Q2. Name the participants of Proactor.**
Asynchronous Operation, Asynchronous Operation Processor (the OS kernel), Completion Handler (your callback), Completion Event Queue, Asynchronous Event Demultiplexer (`GetQueuedCompletionStatus` / io_uring CQ), and the Proactor (the dispatcher).

**Q3. What information does a completion event carry?**
The *result* of the operation: bytes transferred and an error/status code. That's the key difference from Reactor's readiness notification, which carries only "you may now act."

**Q4. In Proactor, who performs the actual read/write?**
The OS kernel, in the background. Your application thread only *initiates* and later *handles the completion*. (In Reactor, you do the read yourself after readiness.)

## 2. Middle Questions

**Q5. Explain the single most dangerous Proactor bug.**
Buffer (or object) lifetime ending before the async operation completes — a use-after-free, because the kernel is still writing into freed memory. Fix: tie the buffer to a per-connection object kept alive with `shared_from_this` (C++) and never allocate I/O buffers on a transient stack frame.

**Q6. What is a strand and why use one?**
A strand serializes execution of all handlers bound to it, guaranteeing no two run concurrently — so per-connection state needs no locks even on a multi-threaded Proactor pool. Crucially, a strand is a *serialization guarantee*, not a thread.

**Q7. `async_read` vs `async_read_some` — difference?**
`async_read_some` performs one OS read that may return *fewer* bytes than requested (partial). `async_read` loops internally until exactly N bytes are read or an error occurs. Use `async_read` for fixed-length framing.

## 3. Senior Questions

**Q8. Why can a Proactor that's *emulated over epoll* give you the API benefits but not the engine benefits?**
On epoll, the library waits for *readiness* and then performs the `read` itself on the reactor thread before invoking your "completion" handler. You get the completion-style API, but the data path is still synchronous user-space I/O — no kernel-async overlap, no syscall reduction. True engine benefits require IOCP or io_uring.

**Q9. How does per-core sharding remove the need for strands?**
If each connection is permanently assigned to one Proactor running on one pinned thread, all of that connection's handlers run on the same thread — effectively single-threaded — so its state needs neither strand nor lock. Cross-shard shared state still needs coordination.

**Q10. Describe the "blocking handler poison" and how it manifests.**
A single synchronous/blocking call inside a completion handler removes a worker thread from the small pool. At scale this produces *correlated* p99/p999 latency spikes across unrelated connections — one of the hardest incidents to diagnose. Mitigation: never block in handlers; offload blocking work to a separate pool.

## 4. Professional Questions

**Q11. How can io_uring achieve near-zero syscalls per operation?**
The submission and completion queues live in memory shared with the kernel. With SQPOLL mode, a kernel thread polls the submission queue, so user space submits work by writing an SQE and advancing the tail — no `io_uring_enter` syscall. Completions are read directly from the shared CQ. Registered buffers and fixed files further cut per-op kernel work.

**Q12. What memory-visibility guarantee lets a handler read the buffer without extra fences?**
The kernel's write into the buffer happens-before the completion is posted, and the framework's dispatch (enqueue on one thread, dequeue+invoke on another) provides the synchronizes-with edge. So the buffer read in the handler is safe. But *application* state shared across handlers on different threads still needs its own synchronization.

**Q13. Compare IOCP's thread model with the per-core io_uring model.**
IOCP shares one completion port; the kernel hands the next completion to whichever thread is idle (LIFO for cache warmth) and caps runnable threads via the concurrency value, with spares to absorb a blocking handler. Per-core io_uring shards connections to per-core rings/threads, maximizing cache locality and avoiding shared-queue contention, at the cost of the built-in blocking cushion.

## 5. Coding Tasks

**T1.** Write a Boost.Asio async echo session that correctly keeps its buffer and object alive across the read/write chain (expect `shared_from_this`).

**T2.** Convert a callback-based Asio read loop into a coroutine using `co_await ... use_awaitable`, and explain why the buffer-lifetime hazard largely disappears (the buffer is a coroutine-frame local kept alive across suspension).

**T3.** Implement a fixed-length framing reader using `async_read` (not `async_read_some`) that reads a 4-byte length then the body.

**T4.** Add a 30s idle timeout using `steady_timer` that calls `socket.cancel()`, and handle the resulting `operation_aborted` completions cleanly.

## 6. Trick Questions

**Q14. "`async_read` returned with no error — the data's in my buffer now, right?"**
No. It returned immediately because the operation hasn't executed yet; it was merely *accepted*. The data is valid only inside the completion handler.

**Q15. "Reactor and Proactor are basically the same since both use an event loop and callbacks."**
No. Reactor dispatches on *readiness* and you do the I/O; Proactor dispatches on *completion* and the OS already did the I/O. That changes who touches the buffer and when, the thread model, portability, and lifetime risk.

**Q16. "Can I reuse the buffer immediately after calling `async_read`?"**
No — the kernel still owns it until the completion fires. Reusing it is a data race / corruption bug.

## 7. Behavioral / Architectural Questions

**Q17. You're choosing an I/O model for a new service. Walk me through Reactor vs Proactor vs thread-per-connection.**
Establish the axes: connection count, platform, CPU-vs-I/O balance, team familiarity, debuggability needs. Thread-per-connection for low concurrency and simplicity; Reactor for Linux-epoll-first with control and debuggability; Proactor for Windows-IOCP or io_uring with huge connection counts. Note that coroutines over Proactor recover readability.

**Q18. A teammate's Proactor server crashes intermittently under load with no clear stack. How do you triage?**
Hypothesize buffer/object lifetime (use-after-free) first — intermittent, load-dependent, detached stacks are the signature. Audit that every async op's buffer is a member of a `shared_ptr`-held session and that handlers capture `self`. Run under ASan; check for `operation_aborted` mishandling and stack-allocated buffers. Then look for blocking handlers causing stalls vs. crashes.

## 8. Tips for Answering

- Lead every Reactor/Proactor answer with the **readiness vs. completion** distinction and **who performs the I/O** — interviewers are checking for exactly that.
- Always volunteer the **buffer-lifetime hazard**; it signals real experience.
- Distinguish **API vs. engine** (emulated-over-epoll) — a senior-level differentiator.
- Mention **coroutines** as the modern way to keep Proactor readable and lifetime-safe.
- Name concrete engines: **IOCP, io_uring, Boost.Asio, .NET async** — specificity beats hand-waving.
