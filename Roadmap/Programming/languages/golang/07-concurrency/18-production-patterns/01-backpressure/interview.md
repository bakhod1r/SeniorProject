---
layout: default
title: Interview
parent: Backpressure
grand_parent: Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/01-backpressure/interview/
---

# Backpressure — Interview Questions and Answers

This page collects 30+ interview questions on backpressure across junior, middle, and senior/staff levels. Each answer is concise; deeper context is in the level pages.

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Staff / Principal Questions](#staff--principal-questions)
5. [Behavioural / Design Questions](#behavioural--design-questions)

---

## Junior Questions

### Q1. What is backpressure in your own words?

**A.** A signal from a slow consumer back to a fast producer saying "stop sending so fast." In Go, the simplest mechanism is a bounded channel: when the buffer is full, the producer blocks on `ch <- x` until a slot frees.

### Q2. What is wrong with `make(chan T, 1_000_000)`?

**A.** It is "unbounded in disguise." A million-slot buffer can use gigabytes of memory under load and hide overload until the OS kills the process. Buffer sizes should be small (often 2–4× the worker count) and the policy for "buffer full" should be deliberate.

### Q3. What does `select { case ch <- x: default: }` do?

**A.** It tries to send `x` on `ch`. If the send can proceed immediately, the case runs. If not, `default` runs. There is no waiting — `default` is taken instantly when no other case is ready.

### Q4. How do you send to a channel with a deadline?

**A.**
```go
select {
case ch <- x:
case <-ctx.Done():
    return ctx.Err()
}
```
The send proceeds if a slot is available; otherwise the context's deadline ends the wait.

### Q5. Three reasonable responses to a full queue?

**A.** Block (wait), drop (throw work away), or reject (return an error to the caller). The right choice depends on the situation.

### Q6. What happens if you send to a `nil` channel?

**A.** The send blocks forever. Useful in `select` for disabling a case.

### Q7. What happens if you send to a closed channel?

**A.** A run-time panic.

### Q8. How do you receive from a possibly-closed channel?

**A.**
```go
x, ok := <-ch
if !ok {
    // channel was closed and drained
}
```

### Q9. What's the difference between `len(ch)` and `cap(ch)`?

**A.** `len(ch)` is the current number of buffered items; `cap(ch)` is the maximum buffer size. Both are snapshots — values may change immediately.

### Q10. Should I close a channel from a producer or a consumer?

**A.** Always from the sole sender. Multiple producers must coordinate (often via a `sync.WaitGroup`) so close happens after all sends complete.

---

## Middle Questions

### Q11. When would you choose a semaphore over a bounded channel?

**A.** When you want to limit *concurrent work* without queueing. A semaphore (`chan struct{}` or `golang.org/x/sync/semaphore`) gates execution without buffering data. Use it for resource limits (DB connections, CPU slots). Use a channel for actual queues.

### Q12. Why use a weighted semaphore?

**A.** When work items have different "cost." A weighted semaphore lets 8 small jobs (weight 1 each) or 1 large job (weight 8) share the same budget. Models real resources like memory or expected duration.

### Q13. How would you propagate backpressure across a pipeline?

**A.** Bound the output of every stage. When stage N is slow, its output channel fills, causing stage N-1 to block on its send, and so on back to the source. Use `select` with `<-ctx.Done()` to handle cancellation.

### Q14. What is the drop-oldest pattern?

**A.** When a buffer is full, drop the *oldest* item instead of the newest. Useful for telemetry where freshness matters more than completeness.

```go
select {
case ch <- x:
default:
    <-ch
    ch <- x
}
```

### Q15. Why use watermarks / hysteresis on a shed threshold?

**A.** Without two thresholds (high to start shedding, low to stop), the system thrashes when queue depth oscillates near the threshold. Hysteresis (high > low) provides stability.

### Q16. What is a per-tenant queue?

**A.** A separate queue per customer or other key. Prevents one noisy tenant from filling the queue and starving other tenants. Each queue is sized small; tenants compete only within their own queue.

### Q17. What metrics should a backpressure-aware service expose?

**A.** At minimum: queue depth, queue capacity, in-flight count, submit/drop/reject counters, submit-wait histogram, processing duration histogram.

### Q18. How do you gracefully shut down a worker pool?

**A.** Stop accepting new submits (set a closed flag), close the work channel, wait for workers to finish draining (with a context timeout to bound the wait).

### Q19. What is a circuit breaker and how does it relate to backpressure?

**A.** A circuit breaker stops calling a failing downstream after a threshold of failures. Backpressure pushes back on *inbound* requests; circuit breaker pushes back on *outbound* failures. Both prevent cascading overload.

### Q20. How would you implement non-blocking try-with-short-wait send?

**A.**
```go
ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
defer cancel()
select {
case ch <- x:
case <-ctx.Done():
}
```

A short timeout absorbs jitter without long blocks.

---

## Senior Questions

### Q21. Explain AIMD (Additive Increase, Multiplicative Decrease).

**A.** A concurrency-limit adaptation algorithm. Grow the limit by 1 every N successes; halve on each failure. Produces a sawtooth limit that probes the system's real capacity. Originally from TCP congestion control.

### Q22. How is Vegas different from AIMD?

**A.** Vegas adapts based on *latency*, not failure. It detects increasing queueing (RTT growth) and backs off before failures occur. More responsive; more sensitive to RTT noise.

### Q23. State Little's law and one practical use.

**A.** `L = λ × W`. Mean items in system = arrival rate × mean wait time. Use: given target throughput λ and acceptable wait W, the necessary concurrency L = λ × W. Conversely, given L (a hard limit), and observed λ, the wait W = L/λ is forced.

### Q24. What is Kingman's formula's takeaway?

**A.** Wait time = ρ/(1-ρ) × variability term. High utilisation amplifies variability. A service at ρ=0.9 with high variance has dramatically more queueing than the same service at ρ=0.7. Practical implication: do not target high utilisation.

### Q25. What is "tail at scale" and how do you mitigate it?

**A.** In fan-out systems with N sub-calls, the tail latency of the slowest sub-call dominates. Mitigations: hedged requests (send duplicates after the median), tied requests (sent to multiple replicas simultaneously with cancellation), micro-partitioning, selective replication, and probation of slow replicas.

### Q26. What is the role of `Retry-After`?

**A.** An HTTP header (and gRPC trailer) indicating how long the client should wait before retrying. Sent with 503 / 429 responses. Lets clients back off intelligently rather than slamming the server immediately.

### Q27. How does HTTP/2 flow control help with backpressure?

**A.** Each HTTP/2 stream has a flow-control window in bytes. The receiver advertises window size; the sender cannot exceed it. A slow receiver does not ACK; the sender's send blocks. This is transport-level backpressure.

### Q28. What is the difference between rate limiting and concurrency limiting?

**A.** Rate limiting caps requests per second (λ). Concurrency limiting caps simultaneous in-flight requests (L). They are related (Little's law) but address different concerns: bursts vs sustained overload. A service usually has both.

### Q29. What is "coordinated omission" in latency measurement?

**A.** A measurement bug where slow responses delay subsequent requests, hiding true latency outliers. A correct load generator sends requests at a fixed rate regardless of response time. Tools: wrk2, ycsb, hdrhistogram.

### Q30. How would you design a multi-tenant service to prevent one noisy customer from impacting others?

**A.** Per-tenant rate limit (token bucket); per-tenant or per-tier admission control; shared worker pool with priority or weighted fair queueing; per-tenant metrics; per-tenant quotas; cell-based architecture for blast-radius isolation.

---

## Staff / Principal Questions

### Q31. Walk me through designing backpressure for a stream-processing pipeline ingesting 100K events/sec.

**A.** Sources push to a partitioned Kafka topic (sized for retention). Stream workers consume per-partition; concurrency limited by partition count. Each worker has a bounded output buffer and applies backpressure to its Kafka commit. Lag is monitored; alerts fire on sustained growth. Adaptive concurrency limits per worker handle downstream variability. Idempotent processing supports replay.

### Q32. Tell me about a backpressure-related production incident you witnessed or led on.

**A.** *(This is a behavioural question; honesty and specificity matter. Describe symptoms, diagnosis, fix, and what was learned. Avoid abstracts; tell a story.)*

### Q33. How would you build a global rate limit across 100 service instances?

**A.** Approximate global: each instance has a local budget chunk, refilled periodically from a central rate-limit service. Hot path is local (fast); central provides eventual consistency on aggregate. For exact, use Envoy's global rate-limit service or a Lua-based Redis script per request — acceptable when latency overhead is tolerable.

### Q34. When would you choose cell-based architecture over a flat fleet?

**A.** When blast radius matters more than efficiency. Cells provide isolation: a failure in one cell does not affect others. Costs: more total resources, more operational complexity. Used at large scale (AWS, large SaaS) where customer impact is catastrophic.

### Q35. What is adaptive LIFO, and when would you use it?

**A.** Under overload, switch from FIFO to LIFO ordering. Older requests have likely timed out client-side; serving them wastes work. Newer requests are more likely to still be wanted. Facebook/Meta uses this. Trigger when avg wait exceeds typical client timeout.

### Q36. Design an SLO and error-budget policy that includes backpressure-driven rejections.

**A.** SLO: 99.9% availability over 28 days = 40 min unavailability. Define "unavailable" to include 503/429 responses caused by overload. Track burn rate over 1h, 6h, 24h windows. Alert at 2% budget in 1h (fast burn) or 10% in 6h (slow burn). Adjust admission thresholds, rollout pace, and capacity based on remaining budget.

### Q37. How do you decide between buffering more and adding more workers?

**A.** Buffering absorbs short jitter; adding workers raises throughput. Use Little's law: if avg in-flight = λ × W exceeds worker count, you are saturated — add workers. If queue is volatile (spiky) but average is fine, add buffer. If both are full long-term, you have a capacity problem; neither knob helps without more resources.

### Q38. How do you measure the capacity of a Go service that you cannot easily load-test in staging?

**A.** Combine observation and analysis: track utilisation, latency p99, queue depth, and error rate during real traffic; project to expected peak using growth assumptions; cross-check with M/M/c math; observe behaviour during routine traffic surges; correlate cause and effect. Then add headroom (commonly 30–50%) for unknowns.

### Q39. How does Go's garbage collector interact with backpressure decisions?

**A.** Large in-flight queues mean large heap means longer GC pauses means more queueing during pauses. A virtuous cycle of small bounded buffers, low memory footprint, and short GC pauses keeps tail latency predictable. `GOMEMLIMIT` provides a hard memory ceiling that interacts with admission control.

### Q40. Walk me through how a single misconfiguration in backpressure can cascade.

**A.** Imagine the queue size is 1M instead of 1K. Under modest overload, queue fills to 1M — memory spikes, GC pauses lengthen, worker throughput drops, queue keeps filling, latency p99 explodes, downstream services see the increased latency and slow themselves, propagation continues. The misconfiguration becomes a fleet-wide incident. Fix: small buffers, observable depth, hard limits on memory.

---

## Behavioural / Design Questions

### Q41. A new service is being launched. What backpressure-related questions do you ask the team?

**A.**
- What's the expected RPS (mean, p95, peak)?
- What's the per-request work (CPU, memory, downstream calls)?
- What's the latency SLO?
- What's the action on overload — block, drop, or reject?
- What's the upstream client's retry policy?
- How is queue depth observed and alerted?
- What's the shutdown / drain story?
- What's the rollback plan for a misconfigured admission limit?

### Q42. How do you teach backpressure to a new junior engineer?

**A.** Start with the failing example: an unbounded slice queue that OOMs under load. Then show the one-line fix: `chan T, N` with blocking send. Explain block/drop/reject and have them implement each. Get them to write a test that proves the bounded channel blocks. Move to semaphores, then context propagation. Show real metrics from production. Only then introduce adaptive concurrency. The lesson sticks when they have first seen failure.

### Q43. How would you justify the engineering cost of adding backpressure to a legacy service that "works fine"?

**A.** "Works fine" usually means "has not yet been overloaded." When the eventual overload arrives — Black Friday, viral campaign, a deployment glitch — the cost of fixing it under pressure is far higher than the cost of adding it in advance. Quantify: estimated incident cost × probability of overload over the next year vs the engineering cost. Plus: tail latency improvements visible to users even at normal load.

---

## Closing

Backpressure questions reveal whether a candidate can think across layers. A junior knows channels; a middle knows pipelines and semaphores; a senior knows adaptation; a staff engineer knows the whole platform. Look for the gradient.

Good answers are concrete: "I built X, it had problem Y, the fix was Z, and here is what we learned." Generic answers ("yeah, use a channel") are warning signs.

---

## Additional Junior Questions

### Q44. What is the difference between a buffered channel and an unbuffered one?

**A.** An unbuffered channel (`make(chan T)` or `make(chan T, 0)`) requires sender and receiver to be ready simultaneously — a rendezvous. A buffered channel can hold up to its capacity without a paired receiver. Both block when overloaded; the buffered one tolerates short jitter.

### Q45. How do you make a channel that signals "done" without carrying data?

**A.** `chan struct{}`. The `struct{}` type has zero size. Close the channel to broadcast "done"; receive from it to wait.

### Q46. Why is `chan struct{}` preferred for signals over `chan bool`?

**A.** `struct{}` is zero bytes; `bool` is one byte (with alignment). For high-fan-out signals, `struct{}` reduces memory. Also, the type explicitly communicates "this carries no data, only timing."

### Q47. If a goroutine is blocked on a send to a channel that no one reads, how do you detect it?

**A.** A goroutine dump (SIGQUIT, `runtime.Stack`, or `pprof`). Look for goroutines in `chan send` state. Many such goroutines pointing to the same channel is a leak.

### Q48. What is the typical recommended starting buffer size for a worker pool channel?

**A.** Two to four times the number of workers. Absorbs short jitter without much memory cost. Tune based on observed `len(ch)` percentiles.

### Q49. Show how to bound concurrency to N using a channel.

**A.**
```go
sem := make(chan struct{}, N)
sem <- struct{}{}      // acquire
// work
<-sem                  // release
```

Idiomatic to combine with `defer`:
```go
sem <- struct{}{}
defer func() { <-sem }()
```

### Q50. What happens to a goroutine that is parked on a full channel for hours?

**A.** It sits there, consuming a goroutine slot and memory for its stack. No CPU. The runtime will not garbage-collect it because it is still referenced by the channel. This is a goroutine leak; it must be unblocked or terminated via context cancellation.

---

## Additional Middle Questions

### Q51. Compare blocking send, non-blocking send, and send-with-timeout. When is each appropriate?

**A.**
- **Blocking** (`ch <- x`): when the producer is internal and has nothing else to do. Pipelines.
- **Non-blocking** (`select default`): when losing the item is acceptable. Telemetry, logs.
- **Send-with-timeout** (`select ctx.Done()`): when the producer represents an external caller with a deadline. HTTP handlers, RPCs.

### Q52. What is the `singleflight` package and when do you use it?

**A.** `golang.org/x/sync/singleflight.Group` coalesces duplicate concurrent calls to the same function (by key). The first caller runs the function; subsequent callers wait and share the result. Used for cache misses to prevent thundering herds.

### Q53. How does `errgroup` interact with backpressure?

**A.** `golang.org/x/sync/errgroup.Group.Go` runs goroutines with shared cancellation: if any returns an error, all others' contexts are cancelled. Combines well with bounded concurrency: pre-acquire semaphore weights, then `Go` the work.

### Q54. How would you implement a fan-out with bounded concurrency?

**A.**
```go
g, ctx := errgroup.WithContext(ctx)
sem := semaphore.NewWeighted(int64(maxConcurrent))
for _, item := range items {
    item := item
    if err := sem.Acquire(ctx, 1); err != nil { break }
    g.Go(func() error {
        defer sem.Release(1)
        return process(ctx, item)
    })
}
return g.Wait()
```

### Q55. What should the `Submit` method of a worker pool return?

**A.** Either `error` (for context-aware versions) or `bool` (for try-versions). The error should be a sentinel (`ErrBusy`, `ErrPoolClosed`) so callers can distinguish overload from other failures.

### Q56. Why is naive `for { go process(<-ch) }` problematic?

**A.** Unbounded goroutine spawning. If processing is slower than incoming, goroutines accumulate. Use a worker pool with a fixed number of workers reading from the channel.

### Q57. How do you handle a downstream call from inside a worker?

**A.** Pass the context through, set a timeout proportional to the worker's budget, handle 503/timeout as a recoverable failure, increment metrics, and consider a circuit breaker for repeated failures.

### Q58. What's the relationship between `runtime.NumCPU()` and pool sizing?

**A.** For CPU-bound work, `NumCPU` is the natural concurrency limit. For I/O-bound, you can go much higher (often 10–100×). Mixed workloads need separate pools or weighted semaphores.

### Q59. How do you ensure a `Close` method completes within a deadline?

**A.**
```go
func (p *Pool) Close(ctx context.Context) error {
    close(p.jobs)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done: return nil
    case <-ctx.Done():
        p.cancelWorkers() // tell workers to abort
        <-done            // wait for them to actually exit
        return ctx.Err()
    }
}
```

### Q60. What metric tells you the pool is saturated?

**A.** `in_flight == limit` for a sustained period. Queue depth growing is also a sign, but it can spike briefly during normal operation. Sustained saturation is the indicator.

---

## Additional Senior Questions

### Q61. Walk through how a token bucket is implemented and what its parameters mean.

**A.** A bucket holds up to `cap` tokens. Tokens refill at rate `r` per second. Each request consumes one token; if none, the request is denied (or waits). `cap` controls burst size; `r` controls long-run rate.

Implementation:
```go
type Bucket struct {
    tokens   float64
    cap      float64
    rate     float64
    last     time.Time
    mu       sync.Mutex
}
func (b *Bucket) Allow() bool {
    b.mu.Lock(); defer b.mu.Unlock()
    now := time.Now()
    b.tokens = min(b.cap, b.tokens + now.Sub(b.last).Seconds() * b.rate)
    b.last = now
    if b.tokens >= 1 { b.tokens--; return true }
    return false
}
```

### Q62. What is the leaky bucket algorithm and how is it different from token bucket?

**A.** Tokens leak from a bucket at a constant rate; requests fill the bucket. Excess overflow is dropped. The output is a constant-rate stream. Token bucket allows bursts up to `cap`; leaky bucket does not.

Use token bucket when bursts are acceptable. Use leaky bucket when you must protect a downstream from any burst.

### Q63. How do you reduce service-time variability (Cs in Kingman's formula)?

**A.** Reject requests that are too large (or charge by size). Separate fast and slow work into per-class queues. Pre-compute slow paths. Memoise frequent results. Smooth bursts via leaky-bucket admission.

### Q64. What is "head-of-line blocking" and how does it relate to backpressure?

**A.** One slow item in a FIFO queue stalls everything behind it. Mitigations: per-key queues, priority queues, smaller per-item budgets, segregating slow and fast paths.

### Q65. How do you handle backpressure for long-lived connections (WebSocket, SSE)?

**A.** Per-connection outbound buffer of bounded size. When full, drop messages or disconnect the slow client. Per-server limit on total connections. Optional: prioritise by message type so critical events still get through.

### Q66. Explain how Kafka consumer lag is a backpressure signal.

**A.** The producer writes to a partition; consumer reads at its own pace. Lag (offset gap) is the queue depth measured remotely. Sustained lag growth signals consumer cannot keep up — capacity problem. Brief lag spikes are normal jitter.

### Q67. What is "exactly-once" semantics in Kafka and how does it interact with backpressure?

**A.** Producer transactions group produce + offset commit atomically; consumer reads with `read_committed` isolation. A slow consumer holding transactions open delays writes for others. Backpressure must prevent this from holding the broker.

### Q68. Compare HTTP/2 flow control with gRPC's `ResourceExhausted`.

**A.** HTTP/2 flow control is *transport-level* and *byte-based*: the receiver's window dictates how much data the sender may transmit. `ResourceExhausted` is *application-level* and *request-based*: the server says "I cannot accept this request now." Both signal backpressure; both should be honoured.

### Q69. How would you test that your backpressure correctly returns 503 under load?

**A.** A load test (`wrk2`, `vegeta`, `k6`) at a configurable RPS. Push past the admission limit. Verify: (a) error responses are 503 (not 500 or timeouts), (b) latency stays bounded, (c) successful responses are not interrupted, (d) drop/reject counters increment. Repeat at multiple multiples of capacity.

### Q70. How do you avoid retry storms after an outage?

**A.** Client-side: exponential backoff with jitter; cap total retries; honor `Retry-After`. Server-side: rate limit on retry-marked requests; circuit breaker. Both: track and alert on retry rate.

---

## Additional Staff/Principal Questions

### Q71. Walk me through the design of an adaptive concurrency library.

**A.** Listener pattern: `Acquire()` returns a Listener with `OnSuccess/OnDropped/OnIgnore`. Algorithm interface accepts observations (RTT, success/failure) and returns a new limit. Default: Gradient2 (measures latency gradient over time). Pluggable: AIMD, Vegas. HTTP middleware integrates via `Acquire` at start, `OnSuccess` / `OnDropped` based on response status. Test by simulating workloads and verifying limit adaptation.

### Q72. How would you build a cell-based architecture from scratch?

**A.** Define cell boundary: each cell has its own LB, app, cache, DB. Choose sharding key: usually customer ID. Provision cell capacity for 1/N of total + 30% headroom. Per-cell deployment automation. Inter-cell observability (correlate metrics by cell). Failure isolation testing: deliberately kill a cell, verify others continue. Cross-cell coordination: minimal; preferably none.

### Q73. Design backpressure for a service called from 50 different clients with different latency requirements.

**A.** Per-client class tagging (latency-sensitive, batch). Per-class admission controls. Per-class concurrency limits. Per-class metrics. Optionally per-client quotas. Strict isolation: a batch client's overload does not affect latency-sensitive clients.

### Q74. How does Service Mesh (Envoy/Istio) help with backpressure?

**A.** Envoy applies admission, rate limiting, circuit breaking at the network layer without application changes. Configuration via YAML. Pros: consistent across services; ops can change without redeploy; integrates with mesh-wide policies. Cons: hides the policy in YAML; less expressive than application-level.

### Q75. How would you measure the "real" capacity of a service in production without breaking it?

**A.** Shadow traffic: replay production traffic to a test instance at increasing rate. Canary: route 1% of production traffic to the test instance for a few minutes; observe behaviour. Synthetic load: generate realistic but non-customer-impacting requests. Combine with adaptive concurrency in production: the AIMD limit converges to real capacity over time.

### Q76. How do you migrate a service with no backpressure to a backpressure-aware design without an outage?

**A.** Phase 1: add metrics on queue depth and goroutine count. Observe for two weeks. Phase 2: add admission control with very high limit (rarely engages). Observe. Phase 3: ratchet down limit weekly until 503s appear at expected peak. Phase 4: add drain, observability, alerts. Phase 5: add adaptive concurrency on top of static limit. Total: 6–10 weeks.

### Q77. Describe an SLO-driven admission limit.

**A.** Measure p99 latency continuously. If p99 exceeds SLO, decrease admission limit by 10%. If p99 is well under SLO (< 50% of target), increase by 1. Aim for "the largest limit that keeps p99 just under SLO." More directly tied to user experience than AIMD or Vegas.

### Q78. What is the "thundering herd" problem and how do you prevent it?

**A.** Many concurrent requests for the same expensive resource (cache miss, DB query) all start at once. Each calculates the same thing. Resource exhausts.

Solutions: singleflight (one calculation, others wait), pre-warming caches, jittered TTLs (avoid synchronised expirations), request coalescing at the API layer.

### Q79. When would you choose to drop oldest vs drop newest?

**A.** Drop oldest when freshness matters (live data, telemetry, sensor readings). Drop newest when old data is more reliable or already-committed (financial transactions, audit logs).

### Q80. What is "queue theory"-driven sizing in your own words?

**A.** Given expected arrival rate λ and per-server service rate μ, M/M/c gives the wait-time distribution. Aim for utilisation ρ ≤ 0.7 for latency-sensitive systems. Buffer size = (latency budget × throughput) / 2. Worker count = λ / (0.7 × μ). Always add 30% headroom for variability.

---

## Additional Behavioural/Design Questions

### Q81. A junior engineer's PR adds `make(chan T, 1_000_000)` to a service. How do you respond?

**A.** Ask: "What is this 1M number based on?" Discuss the underlying problem (overflow under load, OOM disguised as 'enough'). Suggest smaller buffer + explicit policy. Ensure they understand *why*, not just *what*. Approve the redesigned PR.

### Q82. How would you handle a postmortem where the root cause is "we did not have backpressure"?

**A.** Treat as a learning opportunity, not blame. Document precisely what failed and what would have prevented it. Add a test that simulates the overload. Update the team's design checklist. Run a similar drill on adjacent services. Share the learnings widely.

### Q83. Tell me about a time you had to defend a backpressure design that someone else found counterintuitive.

**A.** *(Behavioural; tell a real story.)* Common themes: defending small buffer sizes against "won't we run out of room?", defending blocking sends against "this seems slow," defending 503 responses against "users hate errors." Focus on the data and consequences.

### Q84. How do you balance "build it right" vs "ship it fast" for backpressure?

**A.** Backpressure is foundational, not optional, but does not need to be fully adaptive on day one. Minimum viable: static admission limit + bounded queue + 503 path + metric. Ship that. Adaptive concurrency, hedged requests, cell architecture can come later. The cost of *no* backpressure outweighs the cost of *simple* backpressure.

### Q85. What questions would you ask a vendor about their service's overload behaviour?

**A.** What is the documented capacity? What status code is returned under overload (503, 429, other)? Is there a `Retry-After` header? What are the rate limit quotas (per second, per minute, per day)? Are there per-customer quotas? How is overload signalled in their API responses? What is the recommended client retry policy?

### Q86. Design a debug endpoint that helps operators understand the current backpressure state.

**A.**
```
GET /debug/backpressure
{
  "pool": {
    "queue_depth": 14, "queue_capacity": 32,
    "in_flight": 8, "limit": 16,
    "submitted_total": 12345, "rejected_total": 67, "dropped_total": 0,
    "limit_algorithm": "AIMD", "limit_trend": "growing",
    "shedding": false, "shed_threshold": 26
  },
  "outbound": {
    "circuit_state": "closed",
    "rate_limit_remaining": 920,
    "downstream_p99_ms": 45
  }
}
```

Operators see at a glance: how full, how saturated, how the limiter is adapting, whether downstream is healthy.

---

## Wrap-Up Tips for Candidates

If you are interviewing for a Go backend role at a serious company, you will be asked about backpressure. Be ready to:

1. Recognise an unbounded queue in code at a glance.
2. Write a worker pool with three submit modes in 10 minutes.
3. Explain `select` with `default` and `<-ctx.Done()` clearly.
4. Discuss AIMD or Vegas with at least basic understanding.
5. Reason about Little's law on capacity questions.
6. Tell a real story about a production overload (if you have one).

If you are interviewing for staff/principal, expect deeper:

7. Multi-tier rate limit design.
8. Cell-based architecture tradeoffs.
9. Adaptive concurrency library design.
10. Cross-service backpressure protocols.

The technical depth grows; the discipline stays constant. Stay clear, concrete, and honest about what you've actually done versus what you've read about.

---

## A Note on Live Coding

Some interviews ask you to live-code a backpressure mechanism. The most common request: "build a worker pool with bounded concurrency and graceful shutdown." A clean solution:

```go
type Pool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func NewPool(workers, buffer int) *Pool {
    p := &Pool{jobs: make(chan func(), buffer)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                j()
            }
        }()
    }
    return p
}

func (p *Pool) Submit(f func()) { p.jobs <- f }

func (p *Pool) Close() {
    close(p.jobs)
    p.wg.Wait()
}
```

20 lines. Add `TrySubmit` and `SubmitCtx` if asked; explain the policy choices as you go. Bonus points for mentioning metrics and shutdown timeout. Major bonus for writing a test that proves the buffer blocks.

A common follow-up: "now make the concurrency limit adapt to observed latency." Sketch AIMD (or admit you'd reach for the concurrency-limits library in real code). Honesty wins.

---

## Closing

Backpressure interviews are not trick questions. They are pattern recognition: have you seen the bugs, have you debugged the failures, have you designed the fixes? The answers come from work, not from books. Build something, fail at it, fix it; you will then interview well on this topic.

