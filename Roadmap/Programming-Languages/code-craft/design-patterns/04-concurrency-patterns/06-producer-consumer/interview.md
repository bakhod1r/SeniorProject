# Producer–Consumer — Interview Questions

> Graded interview questions for the **Producer–Consumer** concurrency pattern — from "what is the buffer" to lock-free ring buffers and distributed flow control. See [Junior](junior.md) · [Middle](middle.md) · [Senior](senior.md) · [Professional](professional.md).

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral-architectural)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

**Q1. What problem does Producer–Consumer solve?**
It decouples threads that *create* work from threads that *process* it via a shared buffer, smoothing rate mismatches between the two sides and — when the buffer is bounded — providing backpressure so a fast producer can't bury a slow consumer.

**Q2. What are the two blocking conditions in a bounded buffer?**
"Buffer full" → producers block until a consumer removes an item. "Buffer empty" → consumers block until a producer adds one. Both must be handled; missing either causes corruption or a crash.

**Q3. Why must you wait inside a `while` loop, not an `if`?**
After waking from `wait()`, the condition may be false again — another thread could have taken the slot you were waiting for, or the JVM may have woken you spuriously. `while` re-checks the condition; `if` trusts a single check and races.

**Q4. In Java, what's the idiomatic way to implement this without hand-rolling locks?**
A `BlockingQueue` — `put()` blocks when full, `take()` blocks when empty. `ArrayBlockingQueue` is bounded; the library handles all the synchronization correctly.

---

## Middle Questions

**Q5. Bounded vs unbounded buffer — when and why?**
Bounded by default. A bounded buffer blocks the producer when full, giving backpressure and capping memory. An unbounded buffer never blocks but, under sustained overload, grows until OOM — it doesn't remove the overload problem, it relocates it into invisible memory growth that crashes the process with no warning.

**Q6. How do you shut down N consumers cleanly with poison pills?**
Enqueue **one poison pill per consumer** *after* all producers have finished. Each consumer that takes a pill exits. The classic bug is enqueuing a single pill for N consumers — the first one exits, the rest block forever.

**Q7. Why `notifyAll` instead of `notify` in the single-lock hand-rolled version?**
With one lock guarding two conditions (full/empty), `notify` wakes one arbitrary waiter, which may be the wrong kind (a producer waking a producer that still can't proceed). The threads that *could* proceed stay asleep → eventual deadlock. `notifyAll` wakes everyone; those that can't proceed re-check their `while` and sleep again. (Two separate `Condition`s let you use targeted `signal` instead.)

**Q8. How does Go do Producer–Consumer, and how is shutdown different?**
A buffered channel *is* the bounded buffer: `ch <- x` produces, `for range ch` consumes, send blocks when full. Shutdown is `close(ch)` — a single close terminates *all* consumers' range loops, so no per-consumer poison pill is needed. But closing a channel while producers still write panics, so close only after all producers finish.

---

## Senior Questions

**Q9. What is head-of-line blocking and how do you mitigate it?**
In a FIFO queue, one slow or failing item at the front blocks every item behind it even though they could be processed. A single repeatedly-failing "poison message" can stall an entire partition. Mitigations: per-key partitioning, priority queues, dead-letter queues for repeated failures, and bounded retry that moves the failing item aside.

**Q10. How does backpressure propagate across a multi-stage pipeline, and what breaks it?**
Each bounded stage blocks its upstream when full, so backpressure flows from the slowest stage back toward the source. It breaks if *any* link is unbounded — an unbounded queue or socket buffer absorbs the pressure and lets growth accumulate there. Backpressure must propagate all the way to the ingress; trace every link.

**Q11. How is a Thread Pool an instance of Producer–Consumer?**
Submitting a task makes you the producer, the pool's internal task queue is the buffer, and the worker threads are the consumers. A `ThreadPoolExecutor` with a bounded queue and a `CallerRunsPolicy` is producer–consumer with explicit backpressure — when the queue is full the submitting thread runs the task itself, slowing the producer.

---

## Professional Questions

**Q12. Why is the LMAX Disruptor faster than a `BlockingQueue`?**
No locks (coordination via a single `volatile` CAS cursor, no park/unpark syscalls), no per-item allocation (a pre-allocated ring of reused slots → zero GC), cache-friendly contiguous layout (vs scattered linked nodes), free batching when a consumer falls behind, and tunable wait strategies. Together: ~10⁷ ops/sec with a tight latency tail versus ~10⁶ for a blocking queue.

**Q13. What is false sharing and how does the Disruptor avoid it?**
When two independent, frequently-written fields share a 64-byte cache line, a write to one invalidates the other in every core's cache, forcing coherence traffic — cores ping-pong the line and throughput collapses. The Disruptor pads its sequence counters with dead bytes so each hot field owns its own cache line (`@Contended` does this in modern JDKs).

**Q14. What guarantees a consumer sees a fully constructed object the producer enqueued?**
A happens-before edge from the queue's internal synchronization: the producer's lock release (or `volatile` cursor write) happens-before the consumer's lock acquire (or cursor read), publishing every field written beforehand. The corollary: never mutate an item after handing it off — there's no happens-before edge for that write, so it's a data race, not just a stale read.

**Q15. `ArrayBlockingQueue` vs `LinkedBlockingQueue` — trade-offs?**
`ArrayBlockingQueue`: one lock (producers and consumers contend), pre-allocated array (zero per-item garbage, flat memory), always bounded. `LinkedBlockingQueue`: two locks (put/take split, higher mixed-load throughput), a node allocation per item (GC churn), optionally unbounded (default `MAX_VALUE` — a foot-gun). Choose array for predictable memory and tight tails, linked for throughput under balanced load.

---

## Coding Tasks

- **CT1.** Implement a bounded buffer with `synchronized`/`wait`/`notifyAll`. Then rewrite it with a `ReentrantLock` and two `Condition`s. Explain why the second can use `signal` instead of `signalAll`.
- **CT2.** Build a worker pool (1 producer, 4 consumers) over a `BlockingQueue` with correct poison-pill shutdown — prove no consumer hangs and no item is lost.
- **CT3.** In Go, write a fan-out/fan-in pipeline with a bounded channel and `context` cancellation; close the output channel exactly once after all workers finish.
- **CT4.** Add an `offer(x, timeout)` that returns `false` instead of blocking forever; demonstrate load-shedding behavior under overload.

---

## Trick Questions

**T1. "If I just use an unbounded queue I never have to worry about producers blocking, right?"**
Wrong — you've traded a visible producer stall for invisible unbounded memory growth that OOMs the process under sustained overload. Unbounded relocates the problem to the worst possible failure mode.

**T2. "I have multiple consumers, so items come out in submission order, right?"**
No. The queue is FIFO for *dequeue*, but parallel consumers finish processing in unpredictable order. For ordered processing you need a single consumer or per-key partitioning.

**T3. "`wait()` keeps the lock while parked so no one else can interfere."**
No — `wait()` atomically *releases* the lock and parks, re-acquiring before it returns. That release is exactly what lets a consumer make progress so the producer can later proceed.

**T4. "Spurious wakeups are theoretical; an `if` is fine in practice."**
They are real and permitted by the JVM, and even without them another thread can race in and invalidate the condition before you re-acquire the lock. Always `while`.

---

## Behavioral / Architectural Questions

**B1. Tell me about a time a queue caused a production incident.**
Strong answers name the failure mode (unbounded growth → OOM, or head-of-line blocking from a poison message), how you detected it (queue-depth metric, OOM alert), the immediate fix (bound the queue, dead-letter the poison message), and the systemic fix (monitoring + load test of the overload path).

**B2. You're designing async webhook delivery to slow third parties. Walk me through it.**
Bounded queue per destination (or partitioned), a consumer pool with bounded retry and exponential backoff, dead-letter for permanent failures, idempotent delivery (third party may have received a duplicate), queue-depth and lag metrics, and explicit overload behavior (block the producer vs shed). Mention isolation so one slow partner can't starve others.

**B3. When would you choose Kafka over an in-process `BlockingQueue`?**
When you need durability (survive restarts), multiple independent consumer groups, cross-process/machine scale, or replay. The cost is latency (ms vs µs) and operational burden (a cluster to run). Choose the leftmost option that meets durability and scale needs — don't reach for Kafka when an array queue suffices.

---

## Tips for Answering

- **Lead with intent, then mechanism.** "Decouple producers from consumers via a bounded buffer for rate-smoothing and backpressure" before any code.
- **Say "backpressure" early and correctly.** It's the concept interviewers are probing; many candidates miss it.
- **Always mention bounding.** Reaching for an unbounded queue unprompted is a red flag; explaining *why* bounded is a green one.
- **Get the two rules right cold:** `while`-not-`if` and `notifyAll`-vs-`signal`. They separate people who memorized the pattern from people who understand it.
- **Scale the answer to the level.** Junior: what and the two conditions. Senior: backpressure propagation, head-of-line blocking, partitioning. Professional: locks, cache lines, the memory model.
- **Connect to what they use:** "A thread pool is producer–consumer; Kafka is producer–consumer crossing the machine boundary." Showing the pattern is everywhere signals depth.
