---
layout: default
title: Interview
parent: Fan-Out Within Pipeline
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/03-fan-out-within-pipeline/interview/
---

# Fan-Out Within a Pipeline Stage — Interview Questions

Questions are grouped by level. Each has a model answer.

## Junior

### Q1. What does "fan-out within a pipeline stage" mean?
Replacing a single goroutine in a pipeline stage with N goroutines that share the same input channel and write to the same output channel. The purpose is to parallelise that slow stage so the whole pipeline runs faster.

### Q2. Why is closing the output channel the closer's job, not a worker's?
If a worker calls `close(out)` while other workers are still alive, those workers' next send will panic with `send on closed channel`. The output channel must be closed exactly once, by a single dedicated goroutine, after all workers have exited.

### Q3. Does fan-out preserve input order?
No. The first worker free picks the next input. Whichever worker finishes first writes first. The order in `out` is therefore not the order in `in`.

### Q4. Write the canonical unordered fan-out template.
```go
func fanOut[T, U any](in <-chan T, n int, work func(T) U) <-chan U {
    out := make(chan U)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- work(v)
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

### Q5. What happens if the consumer stops reading the output channel?
Workers block on `out <- ...`. None of them call `wg.Done()`. The closer's `wg.Wait()` blocks forever. All workers and the closer leak as goroutines.

### Q6. Why must `wg.Add(1)` be before `go func()`?
Otherwise the closer's `wg.Wait()` could run before any worker has called `Add`. With zero counter and no add yet, `Wait` returns immediately, the closer closes `out`, and the workers panic on their first send.

### Q7. Does fan-out improve latency or throughput?
Throughput. A single item still takes the same time. Throughput improves up to the bottleneck saturation point.

### Q8. How should errors from workers be reported?
Carry the error in the result struct: `Result{ Job, Out, Err }`. The consumer decides what to do with errors. Avoid separate error channels at this level.

### Q9. What is the producer-closes-its-output rule?
The goroutine that writes to a channel is responsible for closing it. In fan-out: the producer closes `in`, the closer (which is the producer of `out`) closes `out`. Workers — which are consumers of `in` and producers of `out` — never call `close` on `in`.

### Q10. How would you pick N for a CPU-bound stage?
Start with `runtime.NumCPU()`. Measure. Beyond NumCPU you usually do not gain throughput; scheduling overhead may even cost throughput.

## Middle

### Q11. How do you preserve order with fan-out?
Two practical methods. (1) Sequence numbers plus a reorder buffer at the output: each input is tagged with a monotonic `Seq`; the buffer emits results in `Seq` order. (2) Per-worker queues with round-robin dispatch and a deterministic merger. Sequence-number reorder is more flexible; per-worker queues have head-of-line blocking but are simpler.

### Q12. How do you cancel a fan-out cleanly?
Pass a `context.Context` to the stage. In the worker, wrap every blocking operation (receive from `in`, send to `out`) in a `select` that includes `<-ctx.Done()`. On cancel, workers exit, the WaitGroup drops to zero, the closer closes `out`.

### Q13. When would you use `errgroup.WithContext` and `errgroup.SetLimit`?
For fail-fast fan-out over a known list of items. `SetLimit(n)` bounds concurrency; `WithContext` ensures the first non-nil error cancels the context shared by all workers. Suitable for static lists; less suitable for streaming inputs.

### Q14. Why is `errgroup` less natural for streaming inputs from a channel?
Because the dispatch loop would itself block on `g.Go` when the limit is reached, and that same goroutine usually also reads the input channel. Channel-based fan-out separates dispatch and concurrency limiting more naturally.

### Q15. How do you bound the memory used by a reorder buffer?
Bound the in-flight item count by buffering `in` to at most N items. Then the reorder buffer holds at most N items waiting. Alternatively, use a windowed reorder that skips items more than W positions behind.

### Q16. What is a "continue-on-error" vs "fail-fast" pipeline?
Continue-on-error: each worker reports its error in the result struct; the pipeline keeps running. Fail-fast: on the first error, cancel the context and stop all workers. Different stages of the same pipeline often use different policies.

### Q17. Why may a `select` "miss" cancellation by one item?
Both `<-ctx.Done()` and `<-in` may be ready at the same `select`. Go's select chooses uniformly at random among ready cases. The worker may process one more item before observing cancellation. That is acceptable behaviour for cooperative cancellation.

### Q18. Describe an ordered fan-out pipeline shape using sequence numbers.
`producer → tag(seq) → work(N, unordered) → reorder → consumer`. Each stage is a separate function returning `<-chan T`. The producer attaches `Seq` via `tag`; workers process `Tagged[T]` items in parallel; `reorder` holds completed items in a map keyed by `Seq` and emits in monotonic order.

### Q19. What is the difference between the unordered fan-out template and per-worker queues?
Unordered: one shared input channel; workers compete for items; order is lost; utilisation is high. Per-worker queues: a dispatcher assigns items to specific worker queues; each worker drains its own queue; order can be preserved per queue; a slow item blocks its queue.

### Q20. How would you detect a fan-out leak in production?
Track `runtime.NumGoroutine()` as a metric. Sudden or sustained growth without corresponding work signals a leak. SIGQUIT dumps goroutines; clusters of workers stuck on the same operation reveal the leak's cause.

## Senior

### Q21. How do you allocate concurrency budgets across multiple fan-out stages in one pipeline?
Identify the bottleneck of each stage. Allocate widths so that no stage is the artificial bottleneck for downstream stages. Express as configuration. Use semaphores for hard caps tied to external limits (DB connections, API rate limits). Track utilisation per stage; tune iteratively.

### Q22. What is the hot-key problem in per-key fan-out and how do you mitigate it?
A single key with much higher activity than others hashes to one worker and saturates it while peer workers idle. Mitigations: sub-shard hot keys (`user-42-shard-0`, `user-42-shard-1`); load-aware dispatch (re-route hot keys); accept the imbalance if small.

### Q23. Why does adding more workers sometimes hurt p99 latency?
Three reasons: shared resource contention (DB pool, mutex, GC), variability amplification (slowest of N grows with N), and GC pressure from increased allocation rate. Past the bottleneck's saturation point, more workers add queueing latency rather than parallelism.

### Q24. Describe hedged fan-out and its trade-offs.
For each item, dispatch to two workers (or after a delay, dispatch a second worker for the in-flight item). The first to complete wins; the loser is cancelled. Reduces tail latency dramatically. Costs roughly double resource usage on average; less in practice if cancellation is timely.

### Q25. What are bulkheads in the context of fan-out?
Isolation boundaries that prevent one failure or one heavy tenant from affecting others. Implementations: per-tenant worker pools, per-tenant semaphores, per-tenant quotas. Bulkheads cost memory and complexity; required for multi-tenant pipelines with strict SLAs.

### Q26. How do you decide between in-process fan-out and cross-host fan-out?
In-process scales to roughly the throughput of one machine (often 100k items/s, depending on work). Beyond that, fan-out across processes via a queue (Kafka, NATS, RabbitMQ). The queue's partitions provide cluster-wide parallelism; each consumer process internally fans out to its own workers.

### Q27. How does Little's law inform fan-out sizing?
N ≈ arrival_rate × mean_per_item_latency / target_utilisation. For 1000 items/s arrival and 50 ms per-item latency, with 70% target utilisation, you need ~71 workers. Use as a starting point; refine empirically.

### Q28. What is a cancellation domain and why care?
A scope of code that should be cancelled together. Distinct domains use distinct contexts. Examples: request-scoped, batch-scoped, job-scoped, process-scoped. Mixing them causes cancellations to propagate further than intended (request cancellation killing a background job, for instance).

### Q29. How would you detect and fix channel contention in fan-out at high QPS?
Profile with pprof; if `runtime.chansend`/`chanrecv` dominate, channels are contended. Fixes: batch items per send (100x fewer sends), shard the channel into 2-4 sub-channels, or move to per-worker queues with work-stealing.

### Q30. What is the relationship between fan-out and circuit breakers?
A circuit breaker protects downstream dependencies. In fan-out, workers consult a per-downstream breaker before each call. When open, the breaker short-circuits with an error; the error flows through the pipeline as a normal result. Combined, fan-out gives parallelism and the breaker prevents cascading failure.

## Staff/Principal

### Q31. Design a multi-tenant pipeline with fairness and isolation guarantees.
Per-tenant bulkheads via worker pools. Within each pool, fan-out with adaptive concurrency. Cross-tenant queue with weighted scheduling to enforce fairness. Per-tenant quotas exposed in metrics. Hot-tenant detection that auto-sub-shards. Per-tenant cancellation domains so one tenant's failure does not propagate.

### Q32. Walk through a debugging session for a pipeline whose p99 has regressed 30% after a deploy.
Compare per-stage p99 histograms pre- and post-deploy. Identify the stage where the regression is concentrated. Compare CPU/memory profiles for that stage. Check downstream metrics for the same period — sometimes regression is downstream, propagated upstream. Run with `runtime/trace` to find scheduler-level changes (GC pauses, contention). Roll back if necessary; reproduce in staging.

### Q33. How would you implement adaptive concurrency control for fan-out?
AIMD on observed latency: increase N by 1 on each success below target latency; halve N on each failure or sustained over-target latency. Bound between minN and maxN. Or gradient-based: track minimum observed latency (rttNoLoad); adjust limit by (rttNoLoad / current_rtt)^2. Both are 50-100 lines of code; library implementations exist.

### Q34. What architectural patterns avoid GC pressure in high-throughput fan-out?
Reuse via `sync.Pool` for short-lived objects. Pre-allocate per-worker buffers. Avoid per-item allocations in the hot path (string concatenation, JSON marshalling, slice growth). Profile with `-alloc_objects`. Consider experimental arenas (Go 1.20+) for very allocation-heavy workers. Tune GOGC if the trade-off matters.

### Q35. How do you ensure correctness of an ordered fan-out under adversarial inputs?
Test with: out-of-order producer (sequence numbers arrive non-monotonic), gaps in sequence (some numbers missing — should the reorder skip or stall?), exact-duplicate sequence numbers, very large in-flight buffer, cancellation mid-reorder. Specify the contract in the doc comment, write tests for each case, run with `-race` and `goleak`.

### Q36. Design observability for a 10-stage pipeline running across 50 hosts.
Per-stage per-host metrics: items_in, items_out, errors, in-flight, queue_depth, p50/p95/p99 latency. Aggregate across hosts per-stage. Distributed traces with per-item trace IDs, OpenTelemetry. Log correlation IDs. Goroutine count per host. Custom dashboards for end-to-end latency, lag, error rate. Alerts on p99 regression, queue depth at limit, error rate >1%, goroutine growth.

### Q37. When is the channel-based fan-out the wrong pattern?
For very-high-throughput single-machine workloads (millions of items/s with microsecond work) where channel contention dominates. For workloads with global state that cannot be partitioned. For workloads where ordering is global and items cannot be tagged. For workloads where in-flight retries and durability matter — those usually need a real queue, not channels.

### Q38. Compare goroutine-based fan-out to OS-thread-based parallelism (e.g., Java executor).
Goroutines are cheaper (smaller stack, faster switch), more numerous (millions vs thousands), and integrated with Go's net poller for I/O multiplexing. OS threads have stronger isolation (separate memory protections in some models), better debugger integration, and predictable preemption. For most pipeline workloads in Go, goroutines win on every axis.

### Q39. How would you implement work-stealing fan-out in Go?
Each worker has its own input channel (local queue). Dispatcher puts items round-robin or by affinity. When a worker's queue is empty and it has no work, it steals from another worker's queue (with non-blocking `select default`). Implementation is subtle: lock-free local queues, half-stealing, fair distribution. The Go runtime's own scheduler uses this; for application-level pipelines, the much simpler shared-channel pattern is usually fast enough.

### Q40. How does Go's net poller change the math for fan-out width on I/O-bound workloads?
Goroutines parked on network I/O do not consume an OS thread; the runtime's `netpoll` integration lets one OS thread serve thousands of waiting goroutines. So I/O-bound fan-out can use far more workers than CPU cores — limited by socket count, remote rate limit, or memory, not by GOMAXPROCS.

### Q41. What is the most common production failure of a hand-written fan-out and how do you defend against it?
Goroutine leak: a worker that does not exit when the consumer abandons or the context is cancelled. Defences: thread `context.Context` through every stage, wrap every blocking op in a `select` with `ctx.Done()`, monitor `runtime.NumGoroutine()`, run `goleak` in tests, document the lifecycle contract per stage.

### Q42. How do you reconcile fan-out's throughput goal with exactly-once processing semantics?
Channels alone do not provide exactly-once. To achieve it, externalise: source from a durable queue with offset commit only after successful processing; idempotent downstream operations; transactional outboxes. The fan-out is parallel; the queue's offset commit makes processing exactly-once at the message-broker boundary. Within the fan-out, each item is delivered to exactly one worker, but worker crashes require redelivery from the queue.
