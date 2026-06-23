# When to Use Concurrency — Interview Questions

> Questions from junior to staff. Each has a model answer, common wrong answers, and follow-ups. The questions emphasise decision-making, not syntax.

---

## Junior

### Q1. When should you add concurrency to a Go program?

**Model answer.** Three primary cases:

1. **I/O-bound work.** The program waits on network, disk, or subprocess. Goroutines hide the wait.
2. **CPU-bound work on multi-core.** The work can be split; goroutines run in parallel.
3. **Naturally concurrent domains.** Many independent agents (chat connections, sensors). Goroutines model each.

Otherwise, sequential code is simpler and usually faster.

**Follow-up.** *Give an example where adding goroutines slows things down.* — A `for` loop over 1000 integers with `go` for each iteration. Goroutine overhead exceeds the work.

---

### Q2. Why is sequential code often a better default?

**Model answer.** Simpler to read, write, test, debug. Concurrency introduces races, leaks, ordering bugs. Synchronisation has overhead. Without measurement-driven need, sequential code wins on every front except parallel-amenable workloads.

---

### Q3. Your code processes 10 URLs sequentially in 5 seconds (500 ms each). How can you make it faster?

**Model answer.** Fan out: one goroutine per URL. Total time approaches max latency (~500 ms) plus a small overhead. Use `sync.WaitGroup` or `errgroup`.

```go
g, ctx := errgroup.WithContext(ctx)
for _, u := range urls {
    u := u
    g.Go(func() error { return fetch(ctx, u) })
}
g.Wait()
```

10x speedup roughly.

**Follow-up.** *Should you fan out to 1000 URLs all at once?* — No. Bound concurrency to prevent exhausting resources. Use `errgroup.SetLimit` or a semaphore.

---

### Q4. You have a CPU-intensive function. Does running it in a goroutine make it faster?

**Model answer.** Not by itself. A goroutine on its own runs on one P (one core). For parallel speedup, split the work and spawn `runtime.NumCPU()` goroutines.

```go
workers := runtime.NumCPU()
chunk := len(data) / workers
// ... spawn workers ...
```

Speedup approaches `NumCPU` if the work is parallelisable.

---

## Middle

### Q5. State Amdahl's law and apply it.

**Model answer.** `S(n) = 1 / ((1-p) + p/n)`. p is parallel fraction, n is cores.

Example: 90% parallel, 8 cores: `1 / (0.1 + 0.9/8) ≈ 4.7x`. Not 8x.

Implication: serial fraction caps speedup. Find and shrink the serial part before chasing more cores.

---

### Q6. How do you decide the size of a worker pool?

**Model answer.** Depends on workload:

- **CPU-bound:** `runtime.NumCPU()`. More just thrashes scheduler.
- **I/O-bound:** bounded by downstream capacity (DB pool, API rate limit).
- **Memory-bandwidth-bound:** 2–4. More compete for bandwidth.
- **Mixed:** roughly `NumCPU × (1 + waitTime/computeTime)`.

Profile to confirm.

---

### Q7. Your colleague wants to make every method in your service concurrent for "scalability." Critique.

**Model answer.** Several concerns:

1. Most methods are not bottlenecks. Profile first.
2. Concurrency adds complexity (testing, debugging) without measured benefit.
3. Hidden concurrency violates the principle of least surprise: callers do not expect spawned goroutines.
4. Lifetimes become harder to manage. Cancellation, errors, resources.

Better approach: identify hotspots; add concurrency surgically there. Document the API's concurrency behaviour.

---

### Q8. When does adding concurrency *hurt* performance?

**Model answer.** Common cases:

1. **Trivial work per goroutine.** Overhead exceeds work.
2. **Shared mutex bottleneck.** All goroutines serialise on the lock.
3. **Single downstream resource.** All goroutines compete for one DB connection.
4. **CPU-bound on a single core.** No parallelism possible.
5. **GC pressure.** Concurrent allocation causes more pauses.
6. **Memory bandwidth.** Many cores compete for the same RAM channel.
7. **False sharing.** Goroutines on different cores write to the same cache line.

Diagnose with `pprof -mutex`, `-block`, and `-cpu`.

---

### Q9. What does Little's law tell you about service capacity?

**Model answer.** `L = λ × W`. L is in-flight requests, λ is arrival rate, W is average latency.

For 1000 req/sec at 100 ms latency: L = 100 in-flight. To handle these, you need ~100 concurrent slots (goroutines, DB connections, etc.).

Useful for sizing pools, queues, and capacity-planning estimates.

---

### Q10. A pipeline with stages of unequal throughput. What happens?

**Model answer.** The slowest stage is the bottleneck. Faster stages wait. Throughput equals the slowest stage's capacity.

Parallelise the bottleneck stage; throughput rises. Eventually a different stage becomes the bottleneck. Iterate.

If the bottleneck is a downstream resource (DB, external API), you cannot parallelise it from your side; accept the ceiling.

---

## Senior

### Q11. Design the concurrency model for a high-traffic recommendation API.

**Model answer.** Layered:

1. **Per-request goroutine** (framework). One per incoming request.
2. **Auth + profile cache** (atomic read). Lock-free fast path; cache miss falls to backend.
3. **Parallel sub-operations**: load activity, fetch recommendations from N backends, in parallel via `errgroup.WithContext`.
4. **Quorum or hedged backends.** Tail-tolerant: accept K of N responses, or hedge after a delay.
5. **Per-tenant rate limiting** if multi-tenant.
6. **Background cache refresh.** A separate goroutine updates the cache periodically.
7. **Observability**: per-stage tracing, goroutine count, downstream latency histograms.

The pattern is fan-out at the request level with internal parallel calls, plus a background process to keep caches warm.

---

### Q12. What is the cost-benefit calculation for adding hedged requests?

**Model answer.** Benefit: reduces tail latency (p99, p99.9) by avoiding waiting for the slowest single response.

Cost: 1.5x–2x request volume (sometimes the hedge fires and only one response is needed; sometimes both fire).

Worth it when:

- The downstream's p99 is much higher than p50.
- Capacity of the downstream is not a constraint (so doubling load is OK).
- Tail latency matters to the business (interactive, latency-sensitive).

Not worth it when:

- The downstream is at capacity (you would just amplify load).
- Tail latency does not directly affect business outcomes.
- The downstream cannot tolerate duplicate requests (e.g., side-effecting).

---

### Q13. How do you decide between a goroutine-per-request model and a fixed worker pool?

**Model answer.** Goroutine-per-request: simpler, lets the runtime balance. Good for HTTP servers, gRPC, WebSocket.

Worker pool: bounded concurrency. Good for:

- A shared resource that cannot tolerate unbounded concurrency (DB pool, API limit).
- A workload where memory pressure matters (each goroutine has a stack; many in-flight goroutines = much memory).
- A workload with bursty arrivals and you want to smooth load.

In practice: per-request at the boundary, worker pool for downstream-bound sub-operations. Hybrid.

---

### Q14. A team plans to migrate from synchronous to asynchronous APIs to "improve throughput." Critique.

**Model answer.** Concerns:

1. **Synchronous vs asynchronous is an API design choice, not a performance optimisation.** Throughput is rarely gated by the sync-vs-async distinction; it is gated by total work per unit time.
2. **Asynchronous APIs require state.** Callbacks, callbacks, or polling. More code, more complexity.
3. **Backpressure is harder.** Synchronous APIs naturally backpressure (the caller waits). Async needs explicit queueing.
4. **Debugging is harder.** Tracing async flows is more difficult than sync.

Better questions:

- Is the current latency unacceptable? (Then optimise the sync path.)
- Is there decoupling value? (Pub-sub or queue-based async makes sense for decoupled producers and consumers.)
- What about the user experience? (Async often degrades it.)

---

### Q15. How would you migrate a worker pool to per-request goroutines?

**Model answer.** Sequence:

1. **Profile.** Confirm the worker pool is not bottlenecked.
2. **Build the new path.** Behind a feature flag. Both run.
3. **Benchmark and stress.** Compare metrics.
4. **Roll out gradually.** Per-region or per-user-percentage.
5. **Monitor.** Goroutine count, memory, latency, error rates.
6. **Roll back if regression.**
7. **Remove old code** after stable.

Concerns: per-request goroutines may consume more memory at high load. Verify capacity headroom.

---

### Q16. How do you handle partial failure in a fan-out?

**Model answer.** Three policies, chosen explicitly:

- **All-or-nothing.** Any failure fails the request. Use `errgroup.WithContext`; first error cancels siblings.
- **Best-effort.** Successes proceed; failures logged. Useful for non-critical aggregation.
- **Quorum.** Succeed if K of N succeed. Useful for redundancy.

The choice depends on product needs. Document and test the failure paths.

---

## Staff

### Q17. Walk through how you would diagnose a sudden latency spike in production.

**Model answer.** Step by step:

1. **Check dashboards.** Goroutine count, GC pause, queue depths, CPU, memory.
2. **Check downstream.** Is a downstream slow? Latency histograms.
3. **Profile.** `pprof goroutine`, `pprof cpu`, `pprof block`.
4. **Trace.** A trace of a slow request. Where does it spend time?
5. **Logs.** Slow-query logs from DB, slow-request logs from your service.
6. **Look for known patterns.** GC pressure, lock contention, downstream timeouts.
7. **If concurrency-related.** Goroutine leak? Pool exhaustion? Cancel storms?
8. **Mitigate.** Scale up, restart, roll back recent deploys.
9. **Root-cause and document.** Post-mortem with action items.

The investigation is fast if the dashboards and tracing are in place. Without them, you guess.

---

### Q18. Critique the assertion: "Concurrency makes Go fast."

**Model answer.** Misleading. Concurrency *can* make Go programs achieve high throughput and low latency *for workloads where parallelism or latency-hiding applies*. It is not an inherent speed-up.

What actually makes Go programs fast:

- The compiler produces efficient native code.
- The garbage collector has low pause times.
- The standard library is well-optimised.
- The runtime's scheduler is efficient.

Concurrency is one tool; not the whole story. A purely sequential Go program is fast.

---

### Q19. What's the relationship between concurrency and observability?

**Model answer.** Concurrent systems hide their behaviour. Without observability:

- You cannot tell which goroutine is slow.
- You cannot tell why a request is queued.
- You cannot identify a leak until OOM.

Required signals for concurrent code:

- **Goroutine count.** Constant baseline; alert on growth.
- **Per-stage queue depth.** Where is work piling up?
- **Per-request tracing.** What did each goroutine do?
- **Mutex / block profile.** Where is contention?
- **Per-tenant metrics.** Who is the noisy neighbour?

Observability is the senior tax of concurrent design. Without it, you operate blind.

---

### Q20. Design the concurrency strategy for a real-time multiplayer game server.

**Model answer.** Layered:

1. **Per-connection goroutine.** Reads incoming messages, parks on netpoll between.
2. **Per-room goroutine.** Each room has one goroutine processing events sequentially (state machine for the room).
3. **Tick goroutine.** A background goroutine running the game's update loop at fixed rate (60 Hz).
4. **Persistence goroutine.** Periodically writes room state to durable storage.
5. **Matchmaking goroutine.** Combines players into rooms.

Why per-room goroutine: each room is its own state machine; events arrive at unknown rates. One goroutine per room means no locks needed within the room; events are serialised naturally.

Communication: connection goroutines forward events to their room's goroutine via a channel.

Scalability: many rooms, each with one goroutine, easily handled by the scheduler. Memory: room state + per-connection goroutines.

Backpressure: each room's input channel is bounded; if a connection is too noisy, drop events at the boundary.

---

### Q21. How do you sell "don't add concurrency" to a junior who wants to use goroutines for everything?

**Model answer.** Empathetic and concrete:

- Acknowledge that goroutines are powerful and they want to use them.
- Show, with a benchmark, that a sequential version of their code is faster than the concurrent version.
- Explain the cost: each goroutine is fast to start but the synchronisation adds up.
- Establish the team norm: "concurrency is opt-in, justify each `go`."
- Point at concrete patterns where concurrency *does* help (parallel I/O, fan-out, worker pools).
- Pair-program a refactor: simplify their concurrent code into the right shape.

Education over rules. The junior will internalise the principle and improve over time.

---

### Q22. What single piece of advice would you give about concurrency?

**Model answer.** "Measure before adding concurrency, and measure after. If you cannot say which workload your concurrency targets and quantify the gain, do not add it. Sequential code is the default; concurrency is an optimisation."

A close second: "Bound everything. Unbounded goroutines and unbounded buffers are bugs waiting to OOM."

---

### Q23. How do you future-proof a concurrent design against future hardware?

**Model answer.** Several principles:

1. **Don't hardcode `NumCPU`.** Use `runtime.NumCPU()` or `GOMAXPROCS(0)`.
2. **Tune pool sizes via configuration.** Read from env vars or config files.
3. **Bound by abstract limits.** "Max concurrent DB queries" rather than "max goroutines."
4. **Avoid pinning to specific cores** unless absolutely necessary.
5. **Monitor.** Future hardware will have different characteristics; metrics let you adapt.

Hardware changes (more cores, faster/slower IPC, NUMA). Code that adapts via configuration survives.

---

### Q24. Describe the worst concurrency bug you have seen.

**Model answer.** (Personalise.) One archetype: a goroutine leak triggered only by a specific failure mode of a downstream service. Under normal load, no problem. When the downstream returned an unexpected error code, the goroutine waited on a channel that was never written. Each error leaked a goroutine. Hundreds of thousands accumulated over a week. Memory rose; the service eventually OOM'd.

Root cause: missing `select` with `ctx.Done()` in the goroutine's wait loop. Lesson: every blocking operation in a goroutine should have a cancellation path.

---

### Q25. When would you intentionally over-provision concurrency?

**Model answer.** Several cases:

1. **Bursty workloads.** Spike capacity to handle short surges.
2. **Latency-sensitive systems.** Excess capacity keeps queue depth low.
3. **Failure tolerance.** Headroom absorbs unexpected slow downstreams.
4. **Predictability.** Less likely to hit queueing edges.

The cost: more CPU and memory. The benefit: smoother behaviour under stress.

For high-availability systems, ~30–50% headroom is typical. For best-effort systems, you may run hotter and shed load when over-utilised.

---

## Closing

Concurrency interviews at senior+ levels are conversations about judgement. The questions probe: do you reach for concurrency reflexively, or do you measure? Do you understand the trade-offs? Have you operated concurrent systems in production?

The best preparation is experience: run real services, observe their behaviour, debug their issues, and reflect. The interview answers come from that experience.
