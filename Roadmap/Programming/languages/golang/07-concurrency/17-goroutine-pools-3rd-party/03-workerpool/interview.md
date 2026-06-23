---
layout: default
title: Interview
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/interview/
---

# gammazero/workerpool — Interview Questions

35+ interview questions ranging from "did you read the README" to "can you debug a production incident". Each question includes a brief answer and a deeper "what the interviewer is testing" note.

---

## Junior Questions

### Q1: What is `gammazero/workerpool` and what problem does it solve?

**Answer:** It is a Go library providing a worker pool — a fixed-size group of goroutines that pull tasks from a shared queue. It solves "I have N tasks and want at most K running concurrently" without writing the pool manually.

**Tests:** Awareness of the library and the basic concept of bounded concurrency.

---

### Q2: How do you create a pool with 8 workers?

**Answer:**
```go
pool := workerpool.New(8)
```

**Tests:** Knowledge of the constructor.

---

### Q3: How do you submit a task to the pool?

**Answer:**
```go
pool.Submit(func() {
    doWork()
})
```

**Tests:** Knowledge of the most common method.

---

### Q4: What happens to the pool when `main` returns?

**Answer:** If `StopWait` (or `Stop`) was not called, the dispatcher goroutine continues running until the process exits. In a long-running service this is a goroutine leak. In a CLI tool the process exit reclaims everything.

**Tests:** Lifecycle awareness.

---

### Q5: What is the difference between `Submit` and `SubmitWait`?

**Answer:** `Submit` schedules the task and returns immediately. `SubmitWait` schedules and blocks the caller until the task has finished.

**Tests:** Basic API distinctions.

---

### Q6: What is the difference between `Stop` and `StopWait`?

**Answer:** `Stop` discards any tasks not yet started; running tasks finish. `StopWait` runs every queued task before exiting; running tasks also finish.

**Tests:** Shutdown semantics.

---

### Q7: Is the pool's queue bounded?

**Answer:** No. The internal waiting queue is unbounded by default. You must add a bound externally (e.g., a semaphore) if you accept untrusted input.

**Tests:** Awareness of a critical operational fact.

---

### Q8: What happens if you call `Submit` after `Stop`?

**Answer:** The submission is silently dropped. No panic, no error.

**Tests:** Edge case handling.

---

## Middle Questions

### Q9: Why does `SubmitWait` block?

**Answer:** Internally it wraps your task in a closure that closes a "done" channel after the task runs, then waits on that channel. The block is the `<-doneChan`.

**Tests:** Understanding of the implementation.

---

### Q10: How can `SubmitWait` deadlock?

**Answer:** If you call `SubmitWait` from inside a task that is currently occupying a worker slot, and there is no other free worker to run the inner task, the outer waits forever. Most commonly seen with small pools (`maxWorkers = 1`) or with recursive `SubmitWait`.

**Tests:** Concurrency awareness.

---

### Q11: What does `pool.Stopped()` tell you?

**Answer:** Whether `Stop` or `StopWait` has been called. It does NOT tell you whether shutdown has completed — only that it has been initiated.

**Tests:** Precise understanding of state.

---

### Q12: How would you safely shut down a producer goroutine that submits to a pool?

**Answer:**
```go
for {
    if pool.Stopped() {
        return
    }
    pool.Submit(produceOne())
}
```

Check `Stopped()` before each submission. The check has a race (the pool may stop between check and submit), but the worst case is a silently-dropped task — acceptable.

**Tests:** Practical lifecycle management.

---

### Q13: How would you collect errors from pool tasks?

**Answer:** Tasks are `func()` with no return. Use a closure to capture errors into a shared structure (mutex-protected slice, channel, or sync.Once for the first error).

```go
var mu sync.Mutex
var errs []error
for _, item := range items {
    item := item
    pool.Submit(func() {
        if err := process(item); err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
        }
    })
}
pool.StopWait()
```

**Tests:** Pragmatic patterns.

---

### Q14: What does the idle-worker reaper do, and why?

**Answer:** Workers that have not received a task for ~2 seconds are exited. This keeps the resident goroutine count low during quiet periods. The pool only holds workers it needs right now.

**Tests:** Operational understanding.

---

### Q15: How do you give a task a timeout?

**Answer:** The pool does not time tasks out for you. Use `context.WithTimeout` inside the task closure:

```go
pool.Submit(func() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    doWork(ctx) // must respect ctx.Done()
})
```

**Tests:** Production hygiene.

---

### Q16: How does the pool handle panics in tasks?

**Answer:** Modern versions wrap each task in `defer recover()` inside the worker. A panic does not kill the worker; the worker keeps processing subsequent tasks. The panic value is consumed by the library and not returned to the user. To get the panic value, wrap your task with your own `defer recover()`.

**Tests:** Reliability knowledge.

---

### Q17: How do you implement backpressure with `workerpool`?

**Answer:** The library does not provide backpressure on `Submit` (it never blocks indefinitely). Options:

1. Use `SubmitWait` to serialise submission (works but slow).
2. Use a counting semaphore in front of `Submit` that blocks the producer when too many tasks are in flight.
3. Drop tasks if `WaitingQueueSize` exceeds a threshold.

**Tests:** Knowledge of operational patterns.

---

### Q18: What is the typical signature you'd give to a context-aware pool wrapper?

**Answer:**
```go
func (p *Pool) Submit(ctx context.Context, f func(context.Context)) error
```

The wrapper threads the context into the task and returns an error if the pool is full or stopped.

**Tests:** Design instinct.

---

## Senior Questions

### Q19: Sketch the internal structure of `workerpool`.

**Answer:** Two channels (`taskQueue` for submitter→dispatcher, `workerQueue` for dispatcher→worker), one deque for the waiting queue, one dispatcher goroutine, up to `maxWorkers` worker goroutines. The dispatcher loops in a `select` that mediates between accepting new tasks and feeding workers.

**Tests:** Internals.

---

### Q20: Why does `workerpool` have two channels, not one?

**Answer:** Two channels let the dispatcher use a `select` to choose between accepting new submissions and feeding workers. With one channel, the dispatcher would not have that choice — it would just be reading. The two-channel design lets the dispatcher know immediately whether a worker is ready (via a non-blocking `select` send on `workerQueue`).

**Tests:** Design rationale.

---

### Q21: How does worker exit work at shutdown?

**Answer:** The dispatcher sends `nil` on `workerQueue` for each worker. Workers loop `for task != nil`; receiving nil breaks the loop and the worker goroutine returns.

**Tests:** Internals.

---

### Q22: How does `Pause` work?

**Answer:** It submits `maxWorkers` sentinel tasks that each block on `ctx.Done()`. Every worker slot is consumed by a sentinel. New submissions queue. When `ctx` is cancelled, the sentinels return, freeing the workers; the dispatcher resumes dispatching the queue.

**Tests:** Understanding of a clever design.

---

### Q23: Why is the waiting queue a deque, not a slice?

**Answer:** A slice's pop-front (`q = q[1:]`) does not free the head; it accumulates garbage. A deque (ring buffer) reuses memory and has cheap pop-front. A linked list would allocate per node — wasteful.

**Tests:** Data-structure judgement.

---

### Q24: How would you add priority to `workerpool`?

**Answer:** You cannot through the public API. Options:

1. Two pools — one high-priority (smaller `maxWorkers`), one low-priority.
2. Fork the library and replace the deque with a heap.
3. Write your own pool.

**Tests:** Awareness of limits.

---

### Q25: When would you migrate from `workerpool` to `ants`?

**Answer:** When you need runtime resize (`Tune`), configurable idle timeout, faster throughput, typed argument support, or fail-fast submission. If those features are not required, the simpler API of `workerpool` is preferable.

**Tests:** Library-comparison judgement.

---

### Q26: How would you implement a per-tenant fair pool with `workerpool`?

**Answer:** Common options:

1. Per-tenant `workerpool.WorkerPool` (good for few tenants).
2. A single shared pool with a per-tenant token bucket (good for many tenants).
3. Sharded pools by tenant hash (good for very many tenants).

**Tests:** System design.

---

### Q27: What happens to in-flight tasks when the process is killed (SIGKILL)?

**Answer:** They vanish. The goroutine runtime exits abruptly. Any partial state is lost. Tasks must be idempotent and the source of truth must be elsewhere (durable queue) for crash safety.

**Tests:** Crash handling.

---

### Q28: How would you test that `workerpool`'s `maxWorkers` cap is honoured?

**Answer:** Submit many tasks that each track in-flight and peak counts. Verify peak ≤ maxWorkers. Example in [senior file's TestPeakConcurrency].

**Tests:** Testing instinct.

---

### Q29: How would you debug a pool whose `StopWait` is hanging?

**Answer:**

1. Dump goroutines (`runtime.Stack(buf, true)` or `pprof goroutine`).
2. Find the workers; check what they are doing.
3. If stuck on network: missing timeout in task.
4. If stuck on a lock/channel: deadlock in user code.

**Tests:** Diagnostic skills.

---

## Professional Questions

### Q30: How do you size `maxWorkers` for a new pool?

**Answer:** For CPU-bound: `NumCPU()`. For I/O-bound: `latency * target_rps`. Always bounded by downstream capacity. Add ~20% headroom. Document the reasoning in a code comment.

**Tests:** Production judgement.

---

### Q31: List six metrics every production pool should emit.

**Answer:**
1. Submissions counter.
2. Completions counter (with result label: ok / panic / error).
3. Queue depth gauge.
4. Task duration histogram.
5. Queue dwell time histogram.
6. Dropped tasks counter.

**Tests:** Observability discipline.

---

### Q32: Describe a graceful shutdown story for a pool inside a Kubernetes pod.

**Answer:**
1. Kubernetes sends SIGTERM.
2. Service stops accepting new HTTP requests (`server.Shutdown`).
3. Service stops internal producers.
4. Service drains the pool with a deadline (e.g., 25 seconds).
5. If deadline exceeded, hard-stop the pool, log dropped count.
6. Exit cleanly within `terminationGracePeriodSeconds` (default 30s).

**Tests:** Operational maturity.

---

### Q33: How would you protect a pool from a noisy multi-tenant customer?

**Answer:** Per-tenant concurrency cap (token bucket or counting semaphore per tenant). Or per-tenant pool. Or sharded pools by tenant hash. The right answer depends on the tenant count.

**Tests:** Multi-tenant awareness.

---

### Q34: What would cause memory to grow indefinitely in a service using `workerpool`?

**Answer:**
1. Unbounded queue + producer outrunning consumer.
2. Forgotten pools (no `StopWait`, leaking).
3. Tasks capturing large state in closures.
4. Application code (cache, map) growing.

**Tests:** Memory-leak diagnostic.

---

### Q35: What metric would alert you to a slow downstream service?

**Answer:** Queue dwell time histogram, p99 task duration, or queue depth gauge. Each grows when the pool can't keep up. Combine with downstream latency for confirmation.

**Tests:** Cross-service awareness.

---

### Q36: What is the cost of `SubmitWait` over `Submit`?

**Answer:** Two extra allocations (a wrapper closure and a done channel) and the blocking wait. For tasks of meaningful duration, negligible. For sub-microsecond tasks, significant.

**Tests:** Performance instinct.

---

### Q37: How does `workerpool` compare to `errgroup.SetLimit`?

**Answer:** Both provide bounded concurrency. `errgroup.SetLimit` is part of the standard `errgroup` package, requires no external dependency, and handles error propagation. `workerpool` is a long-lived pool with an unbounded queue and supports submission from many goroutines (errgroup typically expects one parent goroutine spawning bounded sub-goroutines). For batch operations: prefer `errgroup`. For long-lived services with many submitters: prefer `workerpool`.

**Tests:** Library selection judgement.

---

### Q38: Describe a real incident where `workerpool` was involved.

**Answer:** (Open-ended) A typical answer: unbounded queue caused OOM during downstream slowdown; we added a semaphore in front of submit, plus per-task timeouts. Sample stories in the professional file.

**Tests:** Real experience.

---

### Q39: How would you verify your pool wrapper is production-ready?

**Answer:**
- Tests for normal flow, queue full, panic recovery, shutdown deadline.
- `-race` clean.
- Metrics emit correctly.
- Runbook exists.
- Load test passes.
- Code review by a senior engineer.

**Tests:** Production discipline.

---

### Q40: What's one thing you wish `workerpool` had?

**Answer:** (Subjective) Common answers: configurable idle timeout, per-task error returns, native context support, runtime resize. Each of these is a known limitation; each has a workaround.

**Tests:** Critical thinking.

---

## Tricky and Bonus Questions

### Q41: Two goroutines call `pool.StopWait()` simultaneously. What happens?

**Answer:** Both complete normally when shutdown finishes. The library protects with a mutex; only one actually triggers the shutdown machinery, but both block on the completion channel and return when it closes.

**Tests:** Race condition awareness.

---

### Q42: A task panics holding a mutex. What happens to the mutex?

**Answer:** It stays locked. The library's recover swallows the panic but does not unwind held locks. Always pair `mu.Lock()` with `defer mu.Unlock()`.

**Tests:** Concurrency pitfalls.

---

### Q43: How does `workerpool` interact with `runtime.LockOSThread`?

**Answer:** A task that calls `LockOSThread` pins the worker goroutine to an OS thread. Other workers are unaffected. The locked goroutine cannot be reaped until it returns from the task (and the lock-os-thread is released).

**Tests:** Runtime awareness.

---

### Q44: Why might `pool.WaitingQueueSize()` return a value that does not match what you submitted?

**Answer:** It's a snapshot of *queued, not-yet-started* tasks. Tasks running on workers are not counted. By the time you read it, the value may have changed.

**Tests:** Metric interpretation.

---

### Q45: Could `workerpool`'s dispatcher become a bottleneck?

**Answer:** Yes, at extreme submission rates (millions per second from many goroutines). The dispatcher is a single goroutine; all submissions funnel through it. Solution: shard pools.

**Tests:** Scaling awareness.

---

### Q46: What's the cost of `New` for a pool you immediately throw away?

**Answer:** ~1-2 microseconds (goroutine spawn + struct allocation). Plus the dispatcher goroutine itself, which is ~2-8 KB. If you create and throw away a pool per request at high RPS, you pay this cost every time.

**Tests:** Cost-awareness.

---

### Q47: Can you use `workerpool` in a library you publish?

**Answer:** Yes, but consider: your library's users now have `workerpool` as a transitive dependency. For small library code, prefer accepting a pool interface and letting the caller provide the implementation.

**Tests:** Library design.

---

### Q48: How does `workerpool` compare to a hand-rolled `chan func() + N goroutines`?

**Answer:** The hand-rolled version is ~12 lines and blocks the producer when workers are busy. `workerpool` is ~300 lines (more features) and never blocks (unbounded queue). The hand-rolled version keeps workers alive forever; `workerpool` reaps idle ones. For most production cases, `workerpool` wins on features and consistency.

**Tests:** Build-vs-buy judgement.

---

### Q49: What's a clean way to make `pool.Submit` return an error if the pool is overloaded?

**Answer:** Wrap with a semaphore and check capacity:

```go
func (p *MyPool) Submit(f func()) error {
    select {
    case p.sem <- struct{}{}:
        p.inner.Submit(func() {
            defer func() { <-p.sem }()
            f()
        })
        return nil
    default:
        return errors.New("pool full")
    }
}
```

**Tests:** Wrapper design.

---

### Q50: Final question — what does it mean to "use `workerpool` well"?

**Answer:** Pair `New` with `StopWait`. Size deliberately. Bound the queue. Give tasks contexts. Recover panics. Emit metrics. Document the reasoning. Test the failure paths. Revisit configuration as the service grows. The library is small; using it well is a discipline.

**Tests:** Synthesis. The candidate should demonstrate they have absorbed the operational wisdom around `workerpool`, not just the API.

---

## End of Interview Questions

These questions sample a range from basic to professional. In an actual interview:

- Juniors: questions 1-8.
- Mid-level: 9-18.
- Senior: 19-29.
- Staff/Principal: 30-40, plus a system design exercise using a pool.
- Bonus: 41-50 for any level.

A candidate who can credibly answer 30+ of these has working knowledge of `workerpool`. Past 40, they have professional fluency.

---

## Appendix: System Design Mini-Exercises

In addition to the Q&A above, here are several system-design exercises an interviewer might use.

### Exercise 1: Webhook delivery service

"Design a webhook delivery service that fans out events to customer URLs. Expected load: 1000 events/sec, ramping to 10000. Customers may have unreliable URLs. SLA: 99.9% delivery within 60 seconds."

Expected discussion points:

- Pool sizing (worker count, queue cap).
- Per-customer concurrency limits.
- Retry strategy with exponential backoff.
- Dead-letter queue for permanent failures.
- Observability (metrics, dashboards, alerts).
- Graceful shutdown.

A candidate should reach a design with `workerpool`-style pools plus per-tenant token buckets, with bounded retries and a dead-letter for failed deliveries.

### Exercise 2: Image processing pipeline

"Design a system that resizes user-uploaded images to 5 different sizes. Throughput: 100 images/sec average, 1000/sec peak. CPU-bound work."

Expected discussion:

- Pool size = NumCPU (CPU-bound).
- Memory management (image buffers are big).
- Backpressure (don't accept more than you can process).
- Storage (where do results go?).
- Failure handling (corrupted images, OOM).

A candidate should size the pool to cores, discuss `sync.Pool` for image buffers, and have a clear backpressure story.

### Exercise 3: Multi-tenant API rate limiter

"Build a rate limiter service that handles 50K requests/sec across 10,000 tenants. Each tenant has their own rate limit."

Expected discussion:

- Per-tenant token bucket.
- Pool sharding by tenant.
- Memory for tenant state.
- High availability.

A pool here is one piece of a larger architecture. The candidate should recognise that and discuss the surrounding pieces.

### Exercise 4: Background notification service

"Design a service that sends emails, SMSes, and push notifications to users. Each channel has different latency and rate limits."

Expected discussion:

- Separate pools per channel (different sizing).
- Retry per channel (different backoff).
- Per-user rate limits (don't spam).
- Compliance (unsubscribe, opt-out).
- Auditing.

The pool is a building block; the design is about the system.

### Exercise 5: Real-time analytics ingestion

"Ingest 1M events/sec, transform them, and write to a database. Database can handle 50K writes/sec."

Expected discussion:

- Batching (write N events per DB call).
- Sharding (multiple pools, multiple DB connections).
- Backpressure (drop or buffer if DB is slow).
- Cold-start behaviour.

A candidate should propose batching to make the 50K/sec → 1M events/sec match (e.g., batches of 20 events). Pool sizing serves the batch processing, not the per-event.

---

## Appendix: Interview Anti-Patterns

What NOT to do as an interviewer (or candidate).

### As interviewer: avoid trivia

"What is the exact value of the idle timeout in workerpool v1.1?" — Bad question. The answer doesn't reveal understanding.

Better: "How does idle timeout affect bursty workloads?"

### As interviewer: avoid library-specific gotchas

"Workerpool has a quirk where ..." — Pop quiz on quirks tests memorisation, not skill.

Better: "How would you handle X edge case using any pool library?"

### As candidate: don't fake knowledge

If you don't know an answer, say so. Engineers value honest "I don't know, but I would find out by..." over confident wrong answers.

### As candidate: connect to experience

"In a project I worked on, we used a pool to ..." Concrete experience is more impressive than abstract knowledge.

### As interviewer: hire for principles, not libraries

Someone who has never used `workerpool` but understands concurrency, bounded resources, and observability will outperform someone who knows the library by rote.

---

## Appendix: Hiring Recommendations

Based on these questions, calibrate level:

- Junior: answers questions 1-8 confidently. Can use the library for typical tasks.
- Mid: answers 9-18. Can build production code with the library, with code review.
- Senior: answers 19-29. Can design and review pool code; understands internals.
- Staff: answers 30-40. Operates pools in production; handles incidents.
- Principal: contributes to question set above. Defines pool standards across the org.

Mismatch (e.g., a candidate at "mid" level confidently answering staff questions) is a useful interview signal in either direction.

---

## Appendix: Coding Tasks During Interviews

Beyond Q&A, ask candidates to write:

### Task 1: Build a basic pool

Given 30 minutes, implement a worker pool from scratch (without using a library). Look for:

- Correct concurrency.
- Graceful shutdown.
- Test cases.

### Task 2: Wrap workerpool with metrics

Given `gammazero/workerpool`, write a wrapper that emits Prometheus metrics. Look for:

- Proper metric types.
- Panic recovery.
- Goroutine safety.

### Task 3: Debug a stuck pool

Given a goroutine dump from a stuck production pool, identify the issue. Look for:

- Reading dumps fluently.
- Identifying the root cause.
- Suggesting fixes.

### Task 4: Size a pool for a scenario

Given a workload description (RPS, latency, downstream limits), recommend `maxWorkers` and queue cap. Look for:

- Correct math.
- Awareness of headroom.
- Documentation of reasoning.

### Task 5: Code review

Given a PR with a `workerpool` usage, find the bugs. Look for:

- Captured loop variables.
- Missing StopWait.
- Unbounded queue under untrusted input.
- Missing panic recovery.

These coding tasks complement the Q&A and reveal practical skill.

---

## Appendix: Follow-Up Questions for Each Answer

A good interviewer probes. For each main question, follow up with:

- "Why?"
- "What's the alternative?"
- "What are the trade-offs?"
- "How would you measure that?"
- "What if the load doubled?"

These follow-ups distinguish memorised answers from understood ones.

---

## Appendix: Self-Interview

If you're preparing for an interview, ask yourself these questions out loud. Speaking the answer is different from thinking it.

Record yourself. Listen back. Notice the moments you hesitated. Those are the gaps to study.

---

## End

Use this file as a reference for interviews you give or take. The questions are not the point; the conversations they spark are.

Engineers who can answer most of these and connect them to real experience are professional-level. Engineers who can debate them with you are the ones you want to hire.

