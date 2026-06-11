# Leader/Followers — Interview Questions

> Graded interview questions for the Leader/Followers concurrency pattern. See [junior.md](junior.md) for the foundations.

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

**Q1. In one sentence, what is Leader/Followers?**
A pool of threads takes turns being the single I/O waiter on a shared handle set; the leader detects an event, promotes a follower to take over watching, then processes the event itself — no queue, no dispatcher.

**Q2. How many threads are blocked on the handle set at once?**
Exactly one — the leader. All other threads are followers asleep on a condition variable, or processing.

**Q3. What are the three states a thread can be in?**
Leader (in `select`), Processing (running a handler), Follower (waiting on the condition variable). It cycles Leader → Processing → Follower → Leader.

**Q4. Why does the leader promote *before* processing?**
So the pool keeps detecting events while the ex-leader works. If it processed first, no thread would be watching the sockets for the whole handler duration — the pool would go blind.

## 2. Middle Questions

**Q5. Why `signal()` one follower instead of `signalAll()`?**
You only need one new leader. `signalAll()` wakes every follower; all but one find leadership already taken and go back to sleep — the thundering herd, with wasted context switches. `signal()` wakes exactly one.

**Q6. What does Leader/Followers remove compared to Half-Sync/Half-Async, and at what cost?**
It removes the producer-consumer queue and the dispatcher-to-worker context switch — the same thread detects and processes. Cost: weak thread affinity (handlers run on whoever was leader), more implementation complexity, and a promotion lock that can become a bottleneck. See [Half-Sync/Half-Async](../08-half-sync-half-async/junior.md).

**Q7. What happens if all N threads are processing at once?**
There is no leader, so incoming events go undetected until a processing thread finishes and re-leads. Detection pauses. Size the pool so this is rare, and never use blocking handlers.

**Q8. Why is a `while` loop (not `if`) required around `await()`?**
Condition variables permit spurious wakeups; a thread may wake without being signalled. The `while (leaderPresent)` re-check ensures it only proceeds when leadership is actually free.

## 3. Senior Questions

**Q9. Leader/Followers converts which classic concurrency problem into which other one?**
It converts a *producer-consumer* problem (events queued from I/O to workers) into a *mutual-exclusion* problem (one lock guarding the right to wait on the handle set). Whether that's a win depends on which primitive is cheaper for your workload.

**Q10. The promotion lock is saturating at high request rates. What do you do?**
Shard the handle set: run M independent pools, each with its own selector and promotion lock, connections hashed to shards. This caps any one lock's contention at N/M threads. In the limit (one thread per shard) it becomes Thread-Pool-per-Reactor with no promotion lock at all.

**Q11. How is the thundering herd avoided, precisely?**
Followers block on a condition variable, not on the OS handle set. Only the leader is ever in `select()`. One event triggers one `signal()`, waking exactly one new leader. Multiple threads never wake for one event.

## 4. Professional Questions

**Q12. Why does removing the dispatcher hand-off actually win, at the hardware level?**
The hand-off is a thread-to-thread context switch: 1–5 µs direct cost plus the indirect cost of the incoming thread running cold (L1/L2/TLB misses reloading the working set). For a sub-microsecond handler that indirect cost can exceed the handler itself. Leader/Followers processes on the same thread whose caches are already warm with the connection's data — zero context switch, warm cache. The price is one contended cache line (the promotion token bouncing between cores via MESI). For short handlers and moderate pool sizes, the token is cheaper than the switch.

**Q13. How does ACE's `ACE_TP_Reactor` prevent two threads dispatching the same connection while still allowing parallel dispatch of different connections?**
It *suspends* a handle before promoting and *resumes* it after the handler returns. The suspended handle is excluded from the next leader's demultiplex, so it can't be double-dispatched; other handles remain active and can be dispatched in parallel. The Java analogue is removing the `SelectionKey` from `selectedKeys()`.

## 5. Coding Tasks

**T1.** Implement a minimal Leader/Followers pool over a Java `Selector` with a `ReentrantLock` + `Condition`. Must promote before processing and signal exactly one follower. *(Expect the four-step loop: become leader → select → promote → process.)*

**T2.** Add clean shutdown: a flag plus `signalAll()` to wake everyone and `selector.wakeup()` to unblock the leader. *(Tests whether the candidate knows the one legitimate use of `signalAll`.)*

**T3.** Given a queue-based thread pool, refactor it to Leader/Followers and explain what synchronization points you deleted. *(Should name: queue lock, dispatcher context switch.)*

## 6. Trick Questions

**Q14. "If there's no dispatcher, who routes events to handlers?"**
There is no router. The OS demultiplexer reports the ready handle; the handler was bound to it at registration time. The "routing" decision was made earlier; at runtime it's just an attachment lookup.

**Q15. "Can two requests be processed in parallel under Leader/Followers?"**
Yes. While the ex-leader processes request A, the newly promoted leader can detect and start processing request B on its own thread. Parallelism comes from promote-then-process, not from a queue.

**Q16. "Is request ordering preserved?"**
No. Requests run on whichever thread happened to be leader, with no global order guarantee. If you need ordering, Leader/Followers is the wrong pattern.

**Q17. "Followers are worker threads waiting for work, right?"**
No — a follower is waiting for the *right to wait on I/O* (the leadership token), not for a unit of work. The distinction is the core of the pattern.

## 7. Behavioral / Architectural Questions

**Q18. Walk me through deciding between Leader/Followers and Half-Sync/Half-Async for a new gateway.**
Strong answer: start from handler characteristics. Short, uniform, non-blocking handlers + high throughput + no ordering needs + a profiled hand-off bottleneck → Leader/Followers. Blocking/variable handlers, or need for independent scaling of I/O and workers, or ordering → Half-Sync/Half-Async. Mention you'd benchmark context-switch count, not assume.

**Q19. You shipped Leader/Followers and tail latency got worse. Diagnose.**
Likely a slow/blocking handler parking threads (leader starvation), or promotion-lock saturation. Check: are LEADER+PROCESSING == N often (starvation)? Is CPU dominated by lock/CV ops (token saturation)? Fixes: offload blocking work, or shard the handle set.

## 8. Tips for Answering

- **Lead with the invariant:** "exactly one leader; promote before process." It signals you understand the pattern, not just the name.
- **Always connect to the *why*:** the pattern exists to delete a context switch. If you can quantify (warm cache, 1–5 µs switch), you're at senior+.
- **Name the failure modes** unprompted: blocking handlers starve the leader; the promotion lock saturates; no ordering. Interviewers reward knowing when *not* to use it.
- **Contrast cleanly** with [Half-Sync/Half-Async](../08-half-sync-half-async/junior.md) (queue/hand-off) and [Thread Pool](../05-thread-pool/junior.md) (decoupled workers). The whole topic is comparative.
