---
layout: default
title: Fan-In Fan-Out Within — Interview
parent: Fan-In Fan-Out Within
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/05-fan-in-fan-out-within/interview/
---

# Fan-In / Fan-Out Inside a Pipeline — Interview Questions

A graded set of interview questions and model answers, from junior to staff. Use these for practice, mock interviews, or as a reference for what depth is expected at each level.

---

## Junior

### Q1. What is fan-out in a Go pipeline?

**A.** Fan-out is the pattern where one input channel is read by multiple worker goroutines. Each item sent on the input channel is consumed by exactly one of the workers (whichever is free). It enables parallel processing of the input stream.

### Q2. What is fan-in?

**A.** Fan-in is the inverse pattern: many output channels (one per worker) are merged into a single channel. A small "merge" function uses one forwarder goroutine per input channel to read and forward values to a shared output, and a "closer" goroutine that waits for all forwarders to exit before closing the output.

### Q3. Write the canonical merge function for two channels.

**A.**

```go
func merge2(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for v := range a {
            out <- v
        }
    }()
    go func() {
        defer wg.Done()
        for v := range b {
            out <- v
        }
    }()
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

### Q4. Who closes the merged output channel?

**A.** The merge function — specifically, a dedicated "closer" goroutine that waits on the `WaitGroup` for all forwarders to exit, then calls `close(out)`. Workers never close the merged output; the producer never closes it either. Only the merge owns it.

### Q5. Why is the closer in its own goroutine?

**A.** Because `wg.Wait()` blocks until all forwarders finish, but the merge function needs to return the output channel to the caller *immediately* so the caller can start reading. The closer in its own goroutine lets the merge return synchronously while the closing happens asynchronously.

### Q6. Does fan-in preserve order?

**A.** No. By default, the order in which values arrive at the merge is determined by scheduling: whichever forwarder happens to deliver next wins. Order is lost. To preserve order, use sequence-number tagging and a reorder buffer.

### Q7. What happens if I forget to close a per-worker output channel?

**A.** The merge's forwarder goroutine loops forever in `for v := range c`. The `WaitGroup` never drains. The closer never runs. The merged output channel never closes. Callers reading via `for v := range merged` hang forever. Goroutines leak.

### Q8. What happens if I close the same channel twice?

**A.** Runtime panic. Only one goroutine should close any channel, exactly once.

---

## Middle

### Q9. How do you preserve input order in a fan-out pipeline?

**A.** Tag each input with a monotonically-increasing sequence number at the source. Workers preserve the tag in their output. A reorder stage downstream uses a map or min-heap keyed on sequence number; it emits the next-expected sequence as soon as it arrives, holding later sequences until predecessors arrive. This is "tag-and-reorder."

### Q10. What is `errgroup` and when do you use it?

**A.** `errgroup.Group` from `golang.org/x/sync/errgroup` is a wrapper over `sync.WaitGroup` that captures the first error returned by any goroutine and (when used with `errgroup.WithContext`) cancels a derived context on first error. Use it for fan-out where worker errors should propagate to the caller and where you want first-error-cancels-all semantics. `g.SetLimit(N)` provides bounded concurrency.

### Q11. What is backpressure and how does Go provide it?

**A.** Backpressure is the natural slowdown of upstream stages when a downstream stage is slow. Go's unbuffered channels provide it for free: a send blocks until a receiver is ready, so a slow consumer causes its upstream sender to block, which cascades to the original producer. Large channel buffers reduce this property by absorbing slowness without feedback; defaulting to unbuffered preserves it.

### Q12. How do you handle errors in a fan-out worker pool?

**A.** Three common patterns:

1. **Result[T] union:** Each output is a struct containing either a value or an error. Consumer inspects each.
2. **errgroup:** Workers return error. First error cancels the group.
3. **DLQ:** Failed items are sent to a separate channel; the main pipeline continues with successes.

Pick the pattern based on whether you want first-error-stops-all (errgroup), continue-on-error (Result[T] or DLQ), or fail-completely (errgroup with `g.Wait()` returning error).

### Q13. Why select on `<-ctx.Done()` inside every blocking channel send?

**A.** Without it, if the consumer dies or the context is cancelled, the sending goroutine blocks on `out <- v` forever — a goroutine leak. Selecting on Done lets the sender exit cleanly when cancellation arrives.

### Q14. What does `goleak.VerifyNone(t)` do and why use it?

**A.** `goleak.VerifyNone(t)` snapshots the set of running goroutines at the moment it is called and fails the test if any user goroutine remains. In a pipeline test, calling it at the end (typically via `defer`) catches goroutine leaks that would otherwise be invisible to the test logic. Essential for pipeline test reliability.

### Q15. How do you choose the fan-out factor for a worker pool?

**A.** Depends on whether the work is CPU-bound or I/O-bound:

- CPU-bound: `workers ≈ runtime.NumCPU()` (or slightly less to leave room for the merge and infrastructure).
- I/O-bound: much larger, e.g., 100-1000, limited by downstream rate or connection pool.

Always measure. Profile with `pprof`. Tune based on observed CPU and latency.

### Q16. What is the difference between fan-out and tee?

**A.** Fan-out splits the input *across* workers: each item goes to *one* worker. Tee duplicates the input *to* multiple outputs: each item goes to *every* output. Fan-out is for parallelism; tee is for broadcast.

---

## Senior

### Q17. When would you use `reflect.Select` instead of static `select`?

**A.** When the set of channels is not known at compile time and changes at runtime — e.g., a pub-sub broker where subscribers are added and removed, or a dynamic merge over a varying set of input streams. `reflect.Select` accepts a `[]reflect.SelectCase` slice that can be rebuilt each iteration.

The cost is 10-100x slower than static select. For static channel counts (even 32 or 64), prefer a cascaded merge of static selects.

### Q18. Design a fan-out pipeline that processes records in parallel but preserves output order.

**A.** Approach:

1. Source emits records, tagging each with a sequence number `(seq, data)`.
2. Worker pool of N workers, each reading from the same source channel. Each worker processes `(seq, data) -> (seq, result)`. Order is lost in the worker output.
3. Merge (canonical) into a single tagged stream.
4. Reorder stage: maintain a `pending map[int]Result` and a `next int`. On receiving `(seq, result)`, store in pending; while `pending[next]` exists, emit and advance `next`.

The reorder buffer's size is bounded by the maximum straggler distance.

### Q19. How do you implement a supervisor that restarts failed workers?

**A.**

```go
func supervise(ctx context.Context, fn func(ctx context.Context) error, maxAttempts int) error {
    for attempt := 0; ; attempt++ {
        err := func() (innerErr error) {
            defer func() {
                if r := recover(); r != nil {
                    innerErr = fmt.Errorf("panic: %v", r)
                }
            }()
            return fn(ctx)
        }()
        if err == nil || errors.Is(err, context.Canceled) {
            return err
        }
        if attempt >= maxAttempts {
            return fmt.Errorf("max attempts: %w", err)
        }
        select {
        case <-time.After(backoff(attempt)):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

Use within an `errgroup.Group` so multiple supervised workers run concurrently. Panic-safe via the deferred recover.

### Q20. What is bulkheading and how does it apply to pipelines?

**A.** Bulkheading is isolating failures so they do not cascade across the whole system. In a pipeline, this means each worker's failure does not stop other workers. Concretely:

- Workers recover panics locally.
- Per-item errors are logged or routed to DLQ; not propagated as group errors.
- One worker's failure does not cancel the `errgroup`.

The pipeline continues with reduced capacity rather than total failure. Critical errors (out-of-memory, ctx cancelled) still propagate.

### Q21. How do you detect and diagnose a goroutine leak in production?

**A.** Several signals and tools:

- **Symptom:** `runtime.NumGoroutine()` grows monotonically over time.
- **Capture:** `go tool pprof http://host:6060/debug/pprof/goroutine` produces a goroutine profile.
- **Analyze:** Look for goroutines all stuck on the same stack trace (e.g., all blocked on `<-someChannel`). That stack is the leak point.
- **Fix:** Trace back to find why the goroutine is stuck. Usually a channel never closes or a context never cancels. Add cancellation propagation.
- **Prevent:** `goleak.VerifyNone(t)` in pipeline tests catches leaks early.

### Q22. Explain the trade-off between buffered and unbuffered channels.

**A.** Unbuffered channels provide synchronous handoff: the sender blocks until a receiver is ready (or vice versa). Maximum backpressure. Minimum latency between send and receive.

Buffered channels allow up to `cap` items in transit without immediate receiver. Smooth scheduler jitter. Reduce sender blocking under bursty load.

The trade-off:

- Unbuffered: strict backpressure, slight latency for handoff handshake.
- Buffered: absorbs bursts, hides backpressure within the buffer window.

For most pipelines, unbuffered or small (1-2) buffer is right. Large buffers should be justified by measurement.

### Q23. Design a pub-sub broker in Go with dynamic subscribers.

**A.**

Sketch:

```go
type Broker[T any] struct {
    subs map[int]chan T
    mu   sync.RWMutex
    in   chan T
}

func (b *Broker[T]) Publish(v T) { b.in <- v }

func (b *Broker[T]) Subscribe() (int, <-chan T) {
    b.mu.Lock()
    id := len(b.subs)
    ch := make(chan T, 16)
    b.subs[id] = ch
    b.mu.Unlock()
    return id, ch
}

func (b *Broker[T]) dispatch(ctx context.Context) {
    for {
        select {
        case v := <-b.in:
            b.mu.RLock()
            for _, c := range b.subs {
                select {
                case c <- v:
                default: // slow subscriber: drop
                }
            }
            b.mu.RUnlock()
        case <-ctx.Done():
            return
        }
    }
}
```

Each subscriber gets a buffered channel. Drops on slow subscribers prevent the broker from stalling. Subscribe and Unsubscribe protected by RWMutex.

### Q24. How would you scale a fan-out pipeline that processes 100 million events per day?

**A.** Approximate: 100M/day = ~1200 events/sec. Modest. Steps:

1. **Source:** Whatever produces the events. Often the bottleneck (network ingress, source database).
2. **Decode/parse:** Fan-out across NumCPU workers; fan-in to single output.
3. **Shard by key** if downstream is per-key: hash key to one of N partitions; each partition has its own worker.
4. **Output:** Bounded fan-out to the downstream sink, with retry on transient errors.

For 1200 events/sec, almost any sensible design works. Profile to find the actual bottleneck. The methodology scales up: at 10K/sec, same shape, larger worker counts; at 1M/sec, add batching and tune buffers carefully.

---

## Staff / Principal

### Q25. Explain `selectgo`. What does the Go runtime do when a goroutine executes a `select` with N cases?

**A.** Walking `runtime/select.go`:

1. The compiler generates a `[]scase` (one per case) and an `order` array. The function `selectgo` takes these.
2. `selectgo` builds a poll order (Fisher-Yates shuffle for pseudo-random fairness) and a lock order (by channel address).
3. Locks all involved channels in lock order (preventing deadlock across goroutines).
4. **Pass 1:** Scan cases in poll order. If any case can proceed without blocking (a value is available to receive or space to send), execute that case and unlock.
5. If a `default` case exists and no case is ready, run default.
6. Otherwise, **Pass 2:** Add a `sudog` to each channel's wait queue (recvq or sendq). Park the goroutine via `gopark`.
7. When another goroutine performs the matching operation, the sleeping goroutine is woken. The runtime sets `gp.param` to indicate which case fired.
8. **Pass 3:** On wake, the goroutine iterates over all wait queues and removes its sudog from queues other than the firing one. Returns the chosen index.

Cost: O(N) per pass; for typical N=2-8, very fast (~150-450 ns). For larger N, scales linearly. `reflect.Select` adds significant overhead from allocation and reflection.

### Q26. Why is `reflect.Select` so much slower than static `select`?

**A.** Three reasons:

1. **Allocation per call:** `reflect.Select` builds a `[]runtimeSelect` slice on the heap each call. The compiler cannot prove it doesn't escape.
2. **Reflection overhead:** Channel values and received values are boxed into `reflect.Value`. The runtime must unbox to interact with the channel.
3. **No compile-time optimisation:** Static select can be inlined, branches predicted, cases laid out optimally. `reflect.Select` is opaque to the compiler.

For 8 cases, static is ~250-450 ns; `reflect.Select` is ~2-5 µs. About 10x slower. For higher case counts, the gap is larger.

### Q27. How does the GMP scheduler interact with channel-heavy code?

**A.** Each channel op may park or wake goroutines. Park (`gopark`) is fast (~200 ns). Wake (`goready`) is fast (~200-500 ns) but the woken goroutine doesn't run immediately — it goes on a P's runqueue and waits to be scheduled.

For high-rate fan-out:
- The producer's P gets the goroutine to wake. The woken G is on the same P initially.
- If the producer keeps sending, woken Gs queue on the producer's P. Other Ps see no new work unless work-stealing kicks in.
- Work-stealing: idle Ps look at other Ps' runqueues every few scheduling iterations.
- For balanced fan-out, the per-G work duration determines how spread out the work becomes.

Bottlenecks:
- If wake latency is significant compared to per-item work, the scheduler becomes the bottleneck.
- If channel lock contention is high, the scheduler waits.

Diagnosis: `runtime/trace` shows scheduler decisions visually.

### Q28. How do you tune a pipeline that has good throughput but bad tail latency?

**A.** Tail latency (p99, p9999) is typically dominated by:

1. **GC pauses.** Measure with `GODEBUG=gctrace=1`. Reduce by tuning `GOGC`, setting `GOMEMLIMIT`, using `sync.Pool` for allocations, pre-sizing data structures.
2. **Scheduler latency.** Long-running tight loops without preemption points cause goroutines to wait. Async preemption (Go 1.14+) helps, but check.
3. **Channel contention.** A hot channel with many senders. Shard the channel.
4. **Downstream slowness.** Add hedged requests, retries, timeouts.
5. **Memory allocator slow path.** Sometimes a hot allocator path stalls. Use `sync.Pool`.

Profile with `pprof` block profile and `trace`. Identify the worst-case path. Test fixes by running with realistic load and measuring p99/p9999.

### Q29. Describe a streaming aggregation pipeline. Cover stages, fan-out factors, failure modes, observability.

**A.** Example pipeline: aggregate events per user every minute, write summaries to a downstream service.

Stages:

1. **Source:** Kafka consumer per partition (e.g., 100 consumers).
2. **Decode:** Fan-out across NumCPU workers; JSON → typed event.
3. **Shard:** Hash user_id to one of 32 shards.
4. **Aggregator:** One goroutine per shard, local state map, periodic flush.
5. **Writer:** Bounded fan-out (e.g., 16) to the downstream, with retry and DLQ.

Failure modes:

- Bad event: drop with metric; do not stop pipeline.
- Kafka rebalance: consumer restart from committed offset; supervised.
- Downstream slow: backpressure flows back through writers → aggregators → shards → decoders → Kafka.
- Downstream unavailable: retries; permanent failure to DLQ.
- Worker panic: supervised restart with backoff.

Observability:

- Per-stage metrics: items in, items out, errors, latency.
- Kafka lag per partition.
- Aggregator state size (active users).
- Writer retry rate and DLQ count.
- Goroutine count, memory usage.

Alerts on: lag > threshold, DLQ rate > threshold, goroutine count growing, error rate > threshold.

### Q30. What is the cost model of fan-out / fan-in at the runtime level? Estimate the nanoseconds per item for a typical pipeline.

**A.** Cost stack-up:

- Producer send: ~100 ns (handoff to worker).
- Worker recv + work + send: work time + ~200 ns.
- Forwarder recv + send: ~200 ns.
- Consumer recv: ~100 ns.

Channel overhead per item: ~600 ns. Plus goroutine wake costs: ~600-1500 ns total. Plus the work itself.

For 1 ms work per item: overhead is 0.06%, negligible.
For 10 µs work: overhead is 6%, noticeable.
For 1 µs work: overhead is 60%, dominant. Need to batch.

At 1 M items/sec with 1 µs work: 1 sec/sec of work CPU + 600 ms/sec of channel CPU = 1.6 cores. With 8 cores available, sustainable but tight.

### Q31. Describe a real-world performance bug you debugged in a fan-out / fan-in pipeline.

**A.** (Personal experience or hypothetical.)

Example: A pipeline using `reflect.Select` over 32 channels at 100K items/sec. CPU profile showed 40% in `reflect.Select` and `runtime.mallocgc`. Each call allocated a fresh `[]runtimeSelect` slice.

Fix: Replaced with a hierarchical static merge — 4 groups of 8 channels each, with a final 4-way merge. Static select cost dropped 10x; allocations dropped to zero. CPU dropped from 80% to 30%. Throughput unchanged (downstream was the bottleneck), but headroom restored.

Lesson: profile before optimising; trust the data over intuition.

### Q32. How do you make a pipeline safe to restart after a crash?

**A.** Two ingredients:

1. **Idempotency:** Each operation can be safely retried without side effects. For DB writes, use UPSERT. For external API calls, use idempotency keys. For computations, the function is deterministic.

2. **Checkpointing:** Periodically persist progress. The pipeline reads its checkpoint on startup and resumes. Frequency trades safety (frequent checkpoints lose less work) against overhead (frequent checkpoints add latency).

Implementation: after each batch of items processed, write the highest key processed to a durable store. On restart, read the checkpoint and resume from `key > checkpoint`.

Combine with at-least-once semantics: it is OK for some items to be processed twice (due to crash between processing and checkpointing) because idempotency ensures the same result.

### Q33. What is the difference between `errgroup` and a manual `sync.WaitGroup` + error channel?

**A.** `errgroup` is essentially that pattern packaged. Specifically:

- `errgroup.Group` wraps a `sync.WaitGroup`.
- It captures the first error returned by any goroutine using `sync.Once`.
- `WithContext` creates a derived context cancelled on first error.
- `SetLimit(N)` provides a semaphore for bounded concurrency.

Manually:

```go
var wg sync.WaitGroup
var mu sync.Mutex
var firstErr error
ctx, cancel := context.WithCancel(parent)
for _, item := range items {
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := work(ctx, item); err != nil {
            mu.Lock()
            if firstErr == nil {
                firstErr = err
                cancel()
            }
            mu.Unlock()
        }
    }()
}
wg.Wait()
```

Equivalent semantics. `errgroup` is shorter, less error-prone, and standard.

### Q34. How would you implement priority merging in Go?

**A.** Two channels, high-priority and low-priority. Always prefer high.

```go
func priorityMerge[T any](ctx context.Context, high, low <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            // Try high first (non-blocking)
            select {
            case v, ok := <-high:
                if !ok {
                    // drain low
                    for v := range low {
                        select {
                        case out <- v:
                        case <-ctx.Done():
                            return
                        }
                    }
                    return
                }
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
                continue
            default:
            }
            // Block on either
            select {
            case v, ok := <-high:
                if !ok { ... }
                emit
            case v, ok := <-low:
                if !ok { ... }
                emit
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Starvation risk: if `high` is always ready, `low` is never serviced. Mitigation: quotas (every N high items, allow one low).

### Q35. When would you NOT use channels for inter-goroutine communication in a pipeline?

**A.** Cases:

- **Very high throughput (>10M ops/sec):** Channel overhead dominates. Use lock-free queues (SPSC for single-producer-single-consumer, MPSC for multi-producer).
- **Lock-free signalling:** `atomic.Pointer` for swap-based handoff.
- **One-shot signalling:** `sync.Once` plus a value field.
- **Shared mutable state:** `sync.Map` or `sync.RWMutex` for concurrent reads.
- **Bounded queue with explicit drop policy:** Manual ring buffer.

Channels are great for 95% of pipelines. The remaining 5% are extreme or specialized cases.

### Q36. How would you design observability for a pipeline that processes a billion events per day?

**A.** Required:

- **Per-stage metrics:** items in/out, errors, latency p50/p99, in-flight count.
- **Channel fill ratios:** buffer / cap per channel.
- **Goroutine count:** by stage label (via `pprof.SetGoroutineLabels`).
- **GC stats:** pause times, heap size, allocation rate (`runtime/metrics`).
- **Resource:** memory, CPU, file descriptors, network bandwidth.

Tools:

- Prometheus for metrics.
- Grafana for dashboards.
- Per-stage exemplars: trace for slow items.
- OpenTelemetry tracing for end-to-end view.

Alerts:

- Lag > threshold (e.g., 60s).
- Error rate > 1%.
- DLQ rate > N/sec.
- Goroutine count > 2x baseline.
- Memory > 80% of limit.

A staff engineer would also automate runbooks and capacity planning.

### Q37. Walk me through what happens, step by step, when one goroutine sends to a channel that another goroutine is waiting on with `select`.

**A.** Setup: G1 is on the recvq of channel `ch` (parked due to a select on `ch` and other channels). G2 is about to execute `ch <- v`.

1. G2 enters `chansend`.
2. G2 acquires `ch.lock`.
3. G2 checks `ch.recvq` and finds G1's sudog.
4. G2 dequeues G1's sudog.
5. G2 directly copies `v` to the destination memory specified by G1's sudog (G1's stack).
6. G2 marks G1 as runnable via `goready(G1)`. G1 is placed on a P's runqueue.
7. G2 releases `ch.lock`.
8. G2 returns from `chansend`.
9. G1 is eventually picked up by a scheduler iteration. G1 resumes.
10. G1's wake handler in `selectgo` notices it was woken on `ch`'s case (via `gp.param`). G1 iterates over other queues it was on and removes its sudog from each.
11. G1 returns from `selectgo` with the chosen case index.

Total cost: ~500-1500 ns depending on scheduling and cache state. G1's resume may incur cache misses for its stack data.

### Q38. What are the trade-offs between `reflect.Select`, cascaded static merge, and a single-channel SPMC queue, for a fan-in of 64 inputs?

**A.**

- **`reflect.Select`:** Easy to implement. ~5-50 µs per receive. Allocates per call. Works for any channel type.
- **Cascaded static merge:** 8 groups of 8, each with a static select; final 8-way merge. ~250-450 ns per receive. No allocation per item. Fixed at build time.
- **Single-channel SPMC queue:** All 64 producers write to one channel; the merge is the channel. Channel lock contention may be significant at high rate. ~100 ns per op uncontended; ~500 ns under contention. Locks all senders.

For high-throughput fan-in, cascaded static is usually fastest. SPMC has simpler topology but worse contention.

### Q39. Imagine you are designing a pipeline framework as a library. What APIs and contracts would you expose?

**A.** Core API:

```go
type Stage[I, O any] func(ctx context.Context, in <-chan I) <-chan O

// Compose stages
func Pipe2[A, B, C any](s1 Stage[A, B], s2 Stage[B, C]) Stage[A, C]
func Pipe3[A, B, C, D any](s1 Stage[A, B], s2 Stage[B, C], s3 Stage[C, D]) Stage[A, D]

// Built-in stages
func Map[I, O any](fn func(I) O) Stage[I, O]
func Filter[T any](pred func(T) bool) Stage[T, T]
func Pool[I, O any](workers int, fn func(I) O) Stage[I, O]
func Merge[T any](cs ...<-chan T) <-chan T
func Reorder[T any](sorted <-chan Tagged[T]) <-chan T

// Error handling
type Result[T any] struct { Value T; Err error }
```

Contracts:

- Every stage takes `context.Context` and respects cancellation.
- Every channel is closed exactly once by its owner.
- The pipeline ends when the source is exhausted or ctx is cancelled.
- No goroutine leaks (verified by `goleak`).

Plus:

- Metrics hooks per stage.
- Tracing hooks (OpenTelemetry).
- Default fan-out factor configurable per stage.
- Buffer sizes configurable per stage.

The library could provide a builder for ergonomic pipelines:

```go
pipeline := New[Row]().
    Map(parse).
    Pool(8, transform).
    Filter(isValid).
    Run(ctx, source)
```

Trade-offs: more abstraction adds learning curve; less leaves users assembling raw channels.

---

## Closing

These questions cover the breadth and depth expected. Junior level focuses on mechanics; middle adds production patterns; senior covers architecture; staff covers internals and design. A candidate strong at every level can lead pipeline architecture work confidently.

For mock interviews, simulate the level you are practicing. Time-box answers: 2 minutes for junior, 4 minutes for middle, 6 minutes for senior, 8-10 minutes for staff. Practice articulating not just the answer but the reasoning.

Good luck.
