---
layout: default
title: Interview
parent: tunny
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/02-tunny/interview/
---

# tunny — Interview Q&A

This file contains 35+ interview-style questions about tunny, ordered roughly from junior to staff level. Use them to test your understanding or as practice for technical interviews.

For each, the answer is given immediately after the question. Read the question, think for 30-60 seconds, then read the answer.

---

## Section 1 — API Basics

### Q1. What does `tunny.NewFunc(4, f)` return?

**A.** A `*tunny.Pool` value. The pool holds 4 worker goroutines, each running the function `f`. The pool is ready to use immediately.

### Q2. What does `pool.Process(payload)` return?

**A.** An `interface{}` (alias `any`). The value is whatever the worker's `Process` method (or the function passed to `NewFunc`) returned. The caller must type-assert it.

### Q3. Is `pool.Process` blocking or non-blocking?

**A.** Blocking. The call returns only when a worker has finished processing the payload. If no workers are free, the caller waits.

### Q4. How do you shut down a tunny pool?

**A.** Call `pool.Close()`. This stops all workers, invokes `Terminate` on each, and prevents further calls.

### Q5. What happens if you call `Process` after `Close`?

**A.** It panics (with a message related to `ErrPoolNotRunning` or "send on closed channel" depending on timing). Always coordinate so no `Process` calls are in flight when `Close` runs.

### Q6. What happens if you call `Close` twice?

**A.** The second call panics with "close of closed channel". To make it idempotent, wrap with `sync.Once`.

### Q7. What is the default size for a CPU-bound workload?

**A.** `runtime.NumCPU()`. This matches the parallelism budget of the machine for CPU-bound work. Larger sizes rarely help; smaller may underutilise.

---

## Section 2 — Worker Interface

### Q8. What four methods does the `Worker` interface require?

**A.** `Process(any) any`, `BlockUntilReady()`, `Interrupt()`, `Terminate()`.

### Q9. When is `BlockUntilReady` called?

**A.** Before every `Process` call, on each iteration of the worker's loop. The worker can block here to apply backpressure (e.g. wait for a rate limit token).

### Q10. When is `Interrupt` called?

**A.** When a `ProcessTimed` deadline elapses or a `ProcessCtx` context is cancelled while the worker is mid-`Process`. It is called from the caller's goroutine, not the worker's.

### Q11. When is `Terminate` called?

**A.** Exactly once when the worker's goroutine is about to exit. This happens during `Close` or when `SetSize` shrinks the pool. The worker's `Process` (if running) finishes first.

### Q12. Why use the `Worker` interface instead of just `NewFunc`?

**A.** Per-worker state. With `NewFunc`, the function is stateless (cannot hold buffers, connections, or other resources between calls). The `Worker` interface lets each worker own private state via struct fields.

### Q13. Can the methods of one `Worker` instance be called concurrently?

**A.** `Process` and `Interrupt` can run concurrently (different goroutines). `Process` and `BlockUntilReady` do not run concurrently (same goroutine, sequential). `Terminate` runs after the last `Process` finishes. So you must synchronise any state shared between `Process` and `Interrupt`.

---

## Section 3 — Timeouts and Contexts

### Q14. What is the difference between `Process` and `ProcessCtx`?

**A.** `Process` is synchronous with no cancellation. `ProcessCtx` accepts a `context.Context` and returns early if the context fires, returning `(nil, ctx.Err())`. `ProcessCtx` also calls `Interrupt` on the worker.

### Q15. What does `ProcessTimed` return on timeout?

**A.** `(nil, tunny.ErrJobTimedOut)`. The pool also calls `Interrupt` on the worker if a worker was already assigned.

### Q16. Does `ProcessTimed` count time-in-queue toward the timeout?

**A.** Yes. The timer covers all phases: waiting for a worker, sending the payload, and receiving the result. The total elapsed time is bounded by the timeout.

### Q17. If `Interrupt` is a no-op, does `ProcessTimed` still work?

**A.** Yes from the caller's perspective — the timeout fires and `ErrJobTimedOut` is returned. But the worker keeps running until `Process` finishes naturally, wasting capacity. Always implement `Interrupt` for cancellable workers.

### Q18. Which is preferred in modern Go, `ProcessTimed` or `ProcessCtx`?

**A.** `ProcessCtx`. It accepts a full `context.Context`, which carries deadlines, manual cancellations, and trace/log values. It is the more general API.

---

## Section 4 — Internals

### Q19. How does the dispatcher decide which worker handles a `Process` call?

**A.** It doesn't — there is no central dispatcher. Each worker offers itself by sending on a shared `reqChan`. The caller's `<-reqChan` receive is matched pseudo-randomly by the runtime with one of the pending sends. The "first ready worker" wins.

### Q20. Why is the `reqChan` unbuffered?

**A.** To force rendezvous semantics. A worker offering itself and a caller requesting must meet in time; otherwise the buffer would grow unboundedly with unfulfilled offers.

### Q21. How many channels are involved in one `Process` call?

**A.** Three: the shared `reqChan` (worker→caller handoff), the per-worker `jobChan` (caller→worker payload), the per-worker `retChan` (worker→caller result).

### Q22. Does tunny recover panics in `Process`?

**A.** No. A panic in `Process` propagates up the worker goroutine, runs deferreds (`Terminate`), then crashes the process. Always recover yourself if you cannot trust the work.

### Q23. What is the size of tunny's source code?

**A.** Approximately 400 lines of Go, no external dependencies. Small enough to read end-to-end.

---

## Section 5 — Production Operations

### Q24. What metric is the primary indicator of pool saturation?

**A.** `QueueLength`. If sustained above the pool size, callers are waiting. If `QueueLength > pool_size * 5` for an extended period, the pool is over-saturated.

### Q25. How do you implement graceful shutdown?

**A.** Three phases:
1. Stop accepting new traffic (close HTTP server).
2. Drain in-flight pool work (wait for `QueueLength == 0`).
3. Close the pool.

Bound the whole process with a context deadline.

### Q26. Why might you want multiple pools in one service?

**A.** Different workloads have different shapes — CPU vs memory bound, fast vs slow, sensitive vs background. Separate pools allow independent sizing and metrics. Head-of-line blocking between workload kinds is avoided.

### Q27. How do you size a pool for a downstream-rate-limited service?

**A.** Pool size = downstream concurrency limit. Any more workers will just sit in `BlockUntilReady` waiting for the limiter.

### Q28. What is the role of `automaxprocs` in tunny deployments?

**A.** `automaxprocs` sets Go's `GOMAXPROCS` to the container's CPU quota (not the host's CPU count). Without it, `runtime.NumCPU()` returns the host CPU count, and `NumCPU`-sized pools end up wildly over-provisioned.

---

## Section 6 — Design Decisions

### Q29. Why does `Process` not return an error?

**A.** Design choice. The simple case (no cancellation) should have a simple signature. Errors are encoded in the result (e.g. a struct with an `Err` field). `ProcessTimed`/`ProcessCtx` add error returns for cancellation specifically.

### Q30. Why does tunny not use generics?

**A.** Tunny predates Go generics (Go 1.18). The API has not been updated for backward compatibility. Wrap with your own typed adapter — it is the recommended pattern.

### Q31. Why is the pool size fixed at construction (mostly)?

**A.** Simplicity. Dynamic pool sizing introduces complexity (worker creation/destruction policies, sizing decisions). `SetSize` is available for the rare case you need it. Most workloads benefit from a fixed size.

### Q32. Why does tunny have an interface for `Worker` rather than just a function?

**A.** To support per-worker state and lifecycle hooks. A function cannot have lifecycle (no `Terminate`); a function cannot be cancelled (no `Interrupt`); a function cannot easily hold state. The interface gives all three.

---

## Section 7 — Comparisons

### Q33. How does tunny compare to `ants`?

**A.** Both are Go pool libraries. Tunny is synchronous (`Process` returns a result, caller waits). Ants is closure-on-submit (`Submit(f)` returns immediately). Tunny is fixed-size; ants is dynamic. Tunny has the `Worker` interface; ants takes closures. Tunny suits stateful CPU-bound work; ants suits fan-out.

### Q34. When would you prefer `workerpool` over tunny?

**A.** When you want simple submit-and-forget semantics, no return values, no per-worker state. `workerpool` is simpler than tunny for these cases.

### Q35. Is tunny faster than a hand-rolled channel pool?

**A.** No. Tunny is essentially a hand-rolled channel pool packaged as a library. Its value is correctness in edge cases (cancellation, lifecycle, panics) and the small surface area, not raw speed.

---

## Section 8 — Tricky Cases

### Q36. A worker calls `pool.Process(x)` on the same pool. What happens?

**A.** It may deadlock. If all other workers are also calling back into the pool, no worker is available to serve. The library does not detect this. Best practice: do not call back into the same pool from within a worker.

### Q37. You have a pool of 8 workers. Three workers are stuck in long `BlockUntilReady`. Effective pool size?

**A.** Five. The three stuck workers are not offering themselves on `reqChan`. The pool's effective dispatchable concurrency is the number of workers currently past `BlockUntilReady` and in the select.

### Q38. A panic in `Interrupt` — what happens?

**A.** `Interrupt` runs in the caller's goroutine. A panic there propagates up the caller's call stack. If `ProcessTimed`/`ProcessCtx` was deferred via `recover`, it is caught; otherwise the caller's goroutine dies. The worker is unaffected (still running its `Process`).

### Q39. You call `pool.SetSize(0)`. What happens?

**A.** All workers are stopped. The pool is open but has no workers. Calls to `Process` block forever (no one to serve them). You can `SetSize(n)` to bring it back.

### Q40. You have many small pools. Goroutine count is huge. Anything wrong?

**A.** Probably yes. Each pool of size N adds N goroutines. Hundreds of small pools means thousands of goroutines, most idle. Better to consolidate into a few larger pools or use a different library (e.g. ants with dynamic resizing).

---

## Section 9 — Code Reading

### Q41. Given:

```go
pool := tunny.NewFunc(4, func(p any) any {
    return p
})
defer pool.Close()
result := pool.Process(42)
```

What is `result`?

**A.** `42` (as an `interface{}`). The worker function returns its input unchanged.

### Q42. Given:

```go
pool := tunny.NewFunc(1, func(p any) any {
    time.Sleep(time.Second)
    return nil
})

ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
defer cancel()

_, err := pool.ProcessCtx(ctx, "x")
fmt.Println(err)
```

What is printed?

**A.** `context deadline exceeded`. The worker is sleeping for 1 second; the 100 ms timeout fires first. The pool returns `(nil, ctx.Err())` where `ctx.Err()` is `context.DeadlineExceeded`.

### Q43. Given:

```go
pool := tunny.NewFunc(2, func(p any) any {
    return p.(int) * 2
})
defer pool.Close()

results := make([]int, 5)
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        results[i] = pool.Process(i).(int)
    }()
}
wg.Wait()
fmt.Println(results)
```

What does this print?

**A.** `[0 2 4 6 8]`. Five concurrent goroutines call `Process`, but only two run at a time. Each writes to its own slot in `results`. Order is preserved because indices are fixed.

---

## Section 10 — Senior-Level Open-Ended

### Q44. How would you implement a priority pool on top of tunny?

**A.** Two (or more) tunny pools — one per priority. Route at submission based on the priority of the request. Each pool sized independently. Provides SLA isolation between priorities at the cost of capacity not being shared.

For richer priorities (5+ levels, aging, fairness), you would build a custom dispatcher in front of one tunny pool, or roll your own pool entirely.

### Q45. How would you add metrics to tunny without modifying the library?

**A.** Wrap your `Worker` with an outer type that delegates to the inner one, instrumenting around each method. The outer `Process` records duration; `BlockUntilReady` records wait time; `Interrupt` increments a counter; `Terminate` decrements a worker count.

```go
type observed struct {
    inner tunny.Worker
    name  string
}

func (w *observed) Process(p any) any {
    start := time.Now()
    defer recordDuration(w.name, time.Since(start))
    return w.inner.Process(p)
}
```

And so on for the other methods. The pool's factory wraps every `Worker` instance.

### Q46. A service's `ProcessCtx` timeout is 5 seconds. Some workers are timing out frequently. What metrics would you look at?

**A.** First: per-call duration histogram. If p99 is approaching 5 seconds, the work itself is slow.

Second: queue length. If callers spend most of the time in queue (queue > pool_size sustained), the issue is capacity, not slowness.

Third: per-payload-kind metrics. Maybe a specific payload type is consistently slow.

Fourth: downstream latency. If your worker calls a downstream, the downstream may be slow.

Mitigations depend on the diagnosis: scale up if capacity, optimize work if slowness, split pools if specific kinds slow.

### Q47. How does graceful shutdown interact with HTTP server shutdown?

**A.** Three phases:

1. `http.Server.Shutdown` — stops accepting new connections, allows in-flight ones to finish.
2. Drain — wait for `pool.QueueLength == 0`. In-flight `Process` calls finish naturally.
3. `pool.Close()` — releases all workers.

Bound by a shutdown context. Kubernetes `terminationGracePeriodSeconds` must accommodate the worst-case drain.

### Q48. Your service deploys 3 times a day. Each deploy causes a 1-minute drop in throughput. Why?

**A.** Likely workers cold-start each replacement pod. If your factory is slow (loads a model, opens connections), the new pods take time to be productive. Rolling deploys with a careful surge configuration and readiness gating reduce this. Also: warm the pool before declaring readiness.

### Q49. How would you handle a noisy tenant in a multi-tenant tunny service?

**A.** Three options:

- **Bulkhead.** Per-tenant pools. Noisy tenant's pool is saturated alone; others unaffected.
- **Throttle.** Rate-limit per tenant before submission. Caller blocks instead of pool.
- **Admission control.** Reject new requests from tenant when their share of queue exceeds threshold.

Pick based on SLA needs and operational complexity.

### Q50. You have a pool of 16 workers. Latency p50 is fine but p99 is way too high. What is going on?

**A.** Tail latency issues. Possibilities:

- Workers occasionally do something slow (GC pause, downstream timeout, lock contention).
- Hot worker syndrome: one worker has more state than others, runs slower.
- Pool size too small: queue depth occasionally spikes, p99 reflects queue wait.

Diagnostics: per-worker latency metrics, GC pause times, downstream call times. Mitigations: hedging, larger pool, splitting workloads.

---

## Final notes

These 50 questions span the API, internals, design, and production operations. Mastering all of them indicates senior-level fluency with tunny.

For more practice, work through [tasks.md](tasks.md) and [find-bug.md](find-bug.md).

---

## Bonus Questions

### Q51. What is the relationship between `runtime.NumGoroutine()` and a tunny pool of size 8?

**A.** The pool contributes 8 goroutines to the total (one per worker). Plus the main goroutine, plus any caller goroutines, plus runtime internal goroutines. After `Close`, the 8 worker goroutines exit, and `NumGoroutine` drops by 8.

This is useful for detecting leaked pools: if you create pools in a loop without closing them, goroutine count climbs by 8 per leak.

### Q52. Can you observe which worker handled a given call from outside tunny?

**A.** Not directly. Tunny does not expose worker identity. If you need this, assign IDs in your worker's factory:

```go
var nextID atomic.Int64
factory := func() tunny.Worker {
    return &myWorker{id: int(nextID.Add(1))}
}
```

Then have `Process` log or record `w.id`.

### Q53. What is the difference between `Process` blocking on full and a regular channel send?

**A.** They are the same thing under the hood. `Process` ultimately reads from the pool's `reqChan` — if no worker has written there, the read blocks. The mechanism is a channel send/receive rendezvous; tunny wraps it in the `Process` API.

### Q54. Could you build the same semantics as tunny using only the standard library?

**A.** Yes. Tunny is a wrapper around channels and goroutines, all of which are in the standard library. Building it would take a few hundred lines of Go. The reason to use the library is correctness in edge cases (cancellation, lifecycle, panics) and brevity at the call site.

### Q55. When would using `tunny.NewCallback` make more sense than `tunny.NewFunc`?

**A.** Rarely. `NewCallback` is for cases where each call has a different shape of work, encoded as a closure. If you have many different tasks all wrapped as `func()`, `NewCallback` saves you from defining a payload type. But you lose the typed return value, and closure allocation per call has overhead. For most real workloads, `NewFunc` (typed payload, typed result) is better.

---

## Bonus Section — Design Discussion Prompts

For practice with open-ended design questions.

### D1. Design a system that processes 1 billion images per day with strict per-image latency SLOs.

Discuss: replica count, pool sizing per replica, per-region distribution, observability, capacity planning, surge handling, cost optimization.

### D2. A request reaches your service and starts a tunny `ProcessCtx`. The downstream service this worker calls is suddenly very slow. Trace the propagation of slowness through your system.

Discuss: how slowness reaches the worker, how queue length grows, how callers (downstream of the worker) see latency, how backpressure propagates upstream.

### D3. Your tunny-based service experiences a 2x traffic spike. Walk through what happens minute by minute.

Discuss: queue length grows, p99 latency rises, eventually 503s start. How long before user impact? What mitigations are available?

### D4. A new feature requires processing 10x larger payloads. Walk through the impact on a tunny-based service.

Discuss: per-call memory grows, GC pressure rises, p99 latency may shift, capacity recalculation, potential need to resize pools or scale replicas.

### D5. Compare a tunny-based service to a serverless equivalent.

Discuss: cold start, cost, latency, observability, debugging. When does each shine?

---

## Bonus Section — Code Critique

Look at this code and identify issues:

### Code 1

```go
func handler(w http.ResponseWriter, r *http.Request) {
    pool := tunny.NewFunc(4, func(p any) any {
        return work(p)
    })
    defer pool.Close()

    body, _ := io.ReadAll(r.Body)
    result := pool.Process(body)
    fmt.Fprint(w, result)
}
```

Issues:
- Pool created per request. Goroutine leak.
- Body read without size limit.
- No error handling for `ProcessCtx`-style cancellation.
- Result type-asserted implicitly via `Fprint`; bugs would surface as wrong output.

### Code 2

```go
pool := tunny.NewFunc(1000, work)
defer pool.Close()
```

Issues:
- Pool size 1000 — almost certainly wrong for CPU-bound work.
- If work is IO-bound, tunny is probably the wrong tool.

### Code 3

```go
pool := tunny.NewFunc(runtime.NumCPU(), work)
go func() {
    for {
        pool.Process(nextItem())
    }
}()
// no defer Close
```

Issues:
- No `pool.Close()` — leaks goroutines.
- Loop has no exit condition — runs forever.

### Code 4

```go
pool := tunny.New(4, func() tunny.Worker {
    return &myWorker{buf: sharedBuf}
})
```

Issues:
- Workers share `sharedBuf`. Race condition on every Process.

These critiques are typical in code review. Practice spotting them.

---

## Bonus Section — Tactical Quick-Fire

Short Q&A for quick recall.

### F1. What package is `tunny` in?

`github.com/Jeffail/tunny`

### F2. What is the minimum pool size?

1

### F3. Does `Process` return an error?

No

### F4. Does `ProcessCtx` return an error?

Yes, two return values

### F5. What does `Close` return?

Nothing (void)

### F6. What is the type of `QueueLength`?

`int64`

### F7. Can you call `SetSize(0)`?

Yes; the pool keeps no workers but stays open.

### F8. Are worker goroutines reused?

Yes, for the lifetime of the pool.

### F9. Is the worker function called per Process?

Yes — `Process` is called once per submission.

### F10. Are panics in workers caught?

No, recover yourself.

---

## Bonus Section — Behavioral Questions

For staff-level interviews.

### B1. Tell me about a time you debugged a goroutine leak.

Sample answer: at $previous_company, we noticed memory growth in our image service. pprof showed thousands of goroutines parked in `tunny.workerWrapper.run`. Investigation revealed we were creating pools inside a hot path. We fixed by hoisting pool creation to startup. Memory stabilised. Lessons: always inspect goroutine count alongside heap; pools should be long-lived.

### B2. Describe a time you made an operational mistake.

Sample answer: I sized a tunny pool to `runtime.NumCPU()` without realizing the container had a CPU limit of 1. Result: in production, the pool had 32 workers competing for 1 CPU. Latency was awful. I added `automaxprocs` and the pool sized correctly. Lesson: always test in an environment that matches production resource constraints.

### B3. How do you decide when to introduce a new pool vs use an existing one?

Sample answer: I introduce a new pool when (a) the work is fundamentally different in cost from existing pools (e.g. 10x slower or 10x memory), (b) SLA isolation between workloads is required, or (c) the existing pool's metrics would be muddied by adding the new workload.

---

## Bonus Section — Diagrams to Reason About

In an interview, you might be asked to draw or explain a diagram.

### Diagram task 1 — draw the data flow for one Process call

Show: caller goroutine, pool, worker goroutine, channels involved.

### Diagram task 2 — draw what happens when ProcessTimed fires

Show: caller, timer goroutine, worker, the Interrupt path.

### Diagram task 3 — draw a graceful shutdown

Show: HTTP server, pool, callers, timeline of events.

Practice these by hand. Whiteboarding skills matter.

---

## Final Tips for Tunny Interview Prep

1. Read the library source. Hold it in your head.
2. Practice the diagrams.
3. Have a story or two from real (or imagined) production experience.
4. Know the comparisons with `ants` and `workerpool`.
5. Know your sizing math.

Confidence comes from having actually used tunny. If you have not, build a small project this week.

---

## Appendix — Quick-Reference Answer Card

For last-minute review before an interview:

- **What is tunny?** A small Go library that provides a fixed-size pool of long-lived worker goroutines. Synchronous Process call, blocking caller. First-class support for stateful workers and per-call cancellation.
- **What sizes the pool?** `runtime.NumCPU()` for CPU-bound, otherwise the binding constraint (downstream limit, memory budget).
- **What is the Worker interface?** Four methods: Process, BlockUntilReady, Interrupt, Terminate.
- **What is the alternative?** ants for fan-out, workerpool for simple submit-and-forget, hand-rolled channel pools for very specific needs.
- **What is the killer feature?** Per-worker state with lifecycle hooks. Plus synchronous semantics that propagate backpressure naturally.

Memorise this card. It is the elevator-pitch summary.

End of interview practice. Good luck.

---

After the interview, regardless of outcome, write a short note about which questions surprised you. Use that note to direct further study. Most learning happens after an interview, not during.
