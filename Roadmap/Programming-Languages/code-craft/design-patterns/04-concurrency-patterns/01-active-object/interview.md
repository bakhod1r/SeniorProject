# Active Object — Interview Questions

> Graded Q&A with model answers. For the full treatment see the level files:
> [junior](junior.md) · [middle](middle.md) · [senior](senior.md) ·
> [professional](professional.md).

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral--architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### Q1. What does the Active Object pattern decouple, and why is that useful?

**Model answer.** It decouples method *invocation* from method *execution*. The
caller invokes a method on a proxy; the call is reified as a Method Request and
enqueued; a separate thread owned by the object executes it later. This makes
invocation asynchronous (callers don't block waiting for the work) and lets the
object's state be touched by exactly one thread, so it needs no locks.

### Q2. Name the six participants and one sentence each.

**Model answer.**
- **Proxy** — caller-side API; reifies the call, enqueues it, returns a Future.
- **Method Request** — the reified call (operation + arguments, often + guard + future).
- **Activation Queue** — thread-safe FIFO holding pending requests.
- **Scheduler** — loop in the object's own thread; dequeues and dispatches requests.
- **Servant** — plain single-threaded object with the real state and behavior.
- **Future** — placeholder returned at enqueue time, filled with the result later.

### Q3. Why does the servant need no locks?

**Model answer.** Because only one thread — the scheduler thread — ever invokes it.
With no concurrent access there is no data race, so no synchronization is needed.
The only cross-thread coordination happens at the activation queue.

### Q4. How is Active Object different from Monitor Object?

**Model answer.** Monitor Object runs the method in the *caller's* thread under a
*lock*; callers contend and block on the lock. Active Object runs the method in the
object's *own* thread via a *queue*; callers enqueue and continue without blocking
on each other, and get a Future. Same goal (safe shared state), opposite mechanism.

---

## Middle Questions

### Q5. What is the single most dangerous default in an Active Object, and how do you fix it?

**Model answer.** An **unbounded activation queue**. If producers outrun the single
consumer, the queue grows until the JVM runs out of memory. Fix: use a **bounded**
queue (e.g. `ArrayBlockingQueue`) and choose an explicit overflow policy — block the
producer, reject (so it can retry/shed), or drop. Note `Executors.newSingleThread
Executor()` uses an *unbounded* `LinkedBlockingQueue` by default, so you must build
a `ThreadPoolExecutor` with a bounded queue yourself.

### Q6. What is a guard / synchronization constraint, and what does it let the scheduler do?

**Model answer.** A guard is a precondition on a Method Request — e.g. "buffer not
full" for a `put`. The scheduler checks each request's guard and only runs it when
the guard is true; otherwise it *defers* the request until the state changes. This
lets Active Object express conditional synchronization (the job `wait`/`notify` does
in a Monitor) without exposing locks to the servant.

### Q7. Why is `CallerRunsPolicy` wrong for an Active Object?

**Model answer.** On overflow, `CallerRunsPolicy` runs the rejected task on the
*caller's* thread. That executes servant code off the single AO thread, reintroducing
concurrent access to servant state — a data race. For backpressure use a blocking
`put` on a bounded queue (block the producer) or `AbortPolicy` (reject and surface).

### Q8. How should exceptions thrown inside a Method Request be handled?

**Model answer.** They must be captured into the request's Future, not lost and not
allowed to kill the scheduler thread. With `submit(Callable)` the executor does this
automatically — `future.get()` rethrows as `ExecutionException`. With raw
`execute(Runnable)`, an uncaught exception can terminate the worker thread, silently
freezing the Active Object, so you must catch-and-`completeExceptionally` yourself.

---

## Senior Questions

### Q9. One Active Object is the bottleneck — one core is pinned, others idle. How do you scale it?

**Model answer.** A single Active Object can't be parallelized internally (one
thread). Two levers: **(1) Shard by key** — N Active Objects, each owning a disjoint
key range, with stable key→shard affinity so each key is touched by one thread;
disjoint keys now run in parallel. **(2) Batch on the consumer** — `drainTo` many
requests and amortize fixed per-op costs (one fsync/flush per batch). The catch with
sharding: operations that previously spanned keys under one thread now need a saga or
coordinator, because you gave up the global serialization.

### Q10. Explain the happens-before guarantees that make the lock-free servant correct.

**Model answer.** Two JMM edges from the `j.u.c` spec: (1) actions before a `submit`
happen-before the task's execution (so the AO thread sees the caller's setup); (2)
the task's actions happen-before a `Future.get()` that retrieves its result (so the
caller sees the servant's writes). Within the AO thread, all requests run in program
order on one thread, so servant reads/writes are sequentially consistent. These edges
come from the queue's internal lock (release on enqueue / acquire on dequeue) and the
future's completion. A read of servant state that bypasses the future has *no* edge —
it's a data race.

### Q11. What's "head-of-line blocking" here, and how do you mitigate it?

**Model answer.** Because there's one consumer with no preemption, a single slow
request (e.g. a blocking I/O call) stalls every request behind it, spiking p99
latency. Mitigations: keep servant methods short and non-blocking; never do blocking
I/O on a latency-sensitive AO thread — offload it to a separate pool/AO; or split the
work so the slow part doesn't sit on the critical queue.

---

## Professional Questions

### Q12. Internally, what plays the role of "Method Request + Future" in Java's executor, and how does shutdown affect pending requests?

**Model answer.** `FutureTask` fuses both: it wraps the callable (the Method Request)
and holds the result state machine (`NEW → COMPLETING → NORMAL/EXCEPTIONAL`) that is
the Future. `submit` creates it and enqueues it; the worker runs it and `set`s the
result, unparking blocked `get()`s. On `shutdown()`, already-queued tasks complete
and their futures resolve, new submissions are rejected. On `shutdownNow()`, queued
tasks are drained out and never run — their futures never complete, so callers
blocked in `get()` hang unless you cancel them. Always drain (`shutdown` +
`awaitTermination`) before force-stopping.

### Q13. Why does `AtomicLong` beat an Active Object in a counter microbenchmark, and what does that tell you?

**Model answer.** A counter increment is nanoseconds; Active Object adds
enqueue + park/unpark + context-switch overhead (~1–5 µs) per op — orders of
magnitude more. It tells you the *use case* is wrong, not the pattern. Active Object
is a latency-and-correctness tool for *stateful, write-heavy, many-caller* objects,
not a throughput tool for trivial ops. A fair benchmark also avoids three traps:
blocking `get()` (measures latency, not throughput), unbounded queue (measures
enqueue rate, not work done), and missing warmup/`Blackhole` (JIT deletes the work).

---

## Coding Tasks

### CT1. Convert a `synchronized` counter to an Active Object (no locks on state).

```java
final class CounterServant { private long n; void inc(){ n++; } long get(){ return n; } }

final class Counter implements AutoCloseable {
    private final CounterServant s = new CounterServant();
    private final ExecutorService ao = Executors.newSingleThreadExecutor(
        r -> { var t = new Thread(r, "counter-ao"); t.setDaemon(true); return t; });
    Future<Void> inc()  { return ao.submit(() -> { s.inc(); return null; }); }
    Future<Long> get()  { return ao.submit(s::get); }
    public void close()  { ao.shutdown(); }
}
```
Talk through: servant has no `synchronized`; correctness comes from single-thread
execution; for production, replace the default unbounded queue with a bounded one.

### CT2. Implement a bounded, backpressured submit that surfaces overflow.

```java
<T> Future<T> submit(Callable<T> task) {
    try { return scheduler.submit(task); }              // scheduler has a bounded queue
    catch (RejectedExecutionException full) {
        var f = new CompletableFuture<T>();
        f.completeExceptionally(full);                  // backpressure, visible
        return f;
    }
}
```

---

## Trick Questions

### TQ1. "Active Object means callers never block. True or false?"

**Answer.** False as stated. Callers never block *on each other* (no lock
contention). But a caller *does* block if it chooses to call `future.get()` before
the result is ready, or if the queue is bounded and full (a blocking `put`). The
asynchrony is in invocation, not an absolute guarantee of non-blocking.

### TQ2. "Can the Active Object thread call `future.get()` on a future it itself will complete?"

**Answer.** No — that's a self-deadlock. The thread that must run the request to
complete the future is the same thread blocking on it; it can never make progress.
Servant code must never block on its own Active Object's futures (also forbids
reentrant `submit().get()` from inside a request).

### TQ3. "Two threads call `deposit` 'simultaneously.' Could they corrupt the balance?"

**Answer.** No. They enqueue concurrently (the queue is thread-safe), but the single
scheduler thread runs the two deposits strictly one at a time. There's no
interleaving inside the servant, so no lost update — unlike an unsynchronized
`synchronized`-free Monitor.

---

## Behavioral / Architectural Questions

### BQ1. Describe a time you chose Active Object over a lock. What drove it?

**Model answer shape.** Name the symptom (lock contention / convoy on a hot stateful
component, or a non-thread-safe resource accessed from many threads), the decision
(serialize on one thread, callers submit-and-continue), and the result (servant
became lock-free and simpler; p99 improved as cache-line ping-pong vanished; you
added a bounded queue + backpressure). Mention the trade-off you accepted: a
single-thread throughput ceiling, mitigated by sharding if needed.

### BQ2. When would you *reject* Active Object in a design review?

**Model answer shape.** Read-heavy or embarrassingly parallel work (serializing
reads is a regression — prefer immutable snapshots or `ConcurrentHashMap`);
nanosecond-latency ops (queue overhead dominates — use `Atomic*`); or when every
call is immediately `.get()`-ed (you pay for asynchrony you never use — a Monitor is
simpler). Also flag missing backpressure (unbounded queue) and blocking I/O on the
AO thread (head-of-line blocking) as blockers.

---

## Tips for Answering

- **Lead with the one-liner** ("decouples invocation from execution") then expand.
- **Always pair it with Monitor Object** — interviewers love the contrast: caller's
  thread + lock vs own thread + queue.
- **Volunteer the failure modes** (unbounded queue → OOM, head-of-line blocking,
  `get()` on the AO thread). Naming them unprompted signals seniority.
- **Be precise about "non-blocking."** Callers don't block *on each other*; they can
  still block on `get()` or a full bounded queue.
- **For scaling, say "shard, don't scale up,"** and immediately note the cross-shard
  invariant cost (saga/coordinator).
- **For correctness, cite happens-before** (submit→execute, execute→get) rather than
  hand-waving "the thread is safe."
