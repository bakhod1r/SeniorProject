# Pipeline — Interview Questions

> Practice questions ranging from junior to staff level. Each has a model answer, common wrong answers, and follow-up probes. The pipeline pattern shows up in interviews because it forces the candidate to reason about goroutine ownership, channel close protocol, cancellation, and backpressure in one tight skeleton.

---

## Junior

### Q1. What is a pipeline in Go?

**Model answer.** A pipeline is a sequence of *stages* connected by channels. Each stage is a goroutine (or several) that reads values from an input channel, transforms them, and writes them to an output channel. The output of one stage is the input of the next. Stages run concurrently, so while stage 2 is processing item N-1, stage 1 is already producing item N.

A canonical three-stage shape: producer → transform → sink. Each function takes `<-chan In` and returns `<-chan Out`.

**Common wrong answers.**
- "A pipeline is a struct that holds channels." — A pipeline is a *protocol* between functions, not a single object.
- "A pipeline must always be linear." — Mostly true, but stages can fan out internally and rejoin.
- "Pipelines need a framework." — Plain Go channels and goroutines are enough.

**Follow-up.** *Can a pipeline have cycles?* — Almost never. A cycle is a deadlock waiting to happen and a hint that the design is wrong.

---

### Q2. Why does each stage own its output channel?

**Model answer.** The producer of a channel is the only writer, and the only writer must be the one to close it. If a stage created its own input channel, it could not safely close the upstream's output. By making each stage create and close its own output channel, you preserve the invariant: *one writer per channel*. That invariant is what makes `range` and `close` work as a clean shutdown protocol.

**Common wrong answers.**
- "The consumer should close the channel because it knows when it's done." — That violates the rule "only the sender closes." A consumer closing its input causes a panic in the producer.
- "It doesn't matter who closes; close is just a flag." — It does matter. Closing twice panics. Closing while another goroutine sends panics.

**Follow-up.** *What if two stages both write to one channel?* — Then close is no longer safe to call from either. You need an extra coordinator (e.g. a `sync.WaitGroup` plus one closer goroutine), which is exactly the fan-in pattern.

---

### Q3. What is the canonical stage signature?

**Model answer.**

```go
func stage(in <-chan In) <-chan Out
```

A function that takes a receive-only input channel and returns a receive-only output channel. Internally it spawns one goroutine, defers close on the output, and ranges over the input.

In modern Go, ctx is added:

```go
func stage(ctx context.Context, in <-chan In) <-chan Out
```

**Follow-up.** *Why return `<-chan Out` and not `chan Out`?* — Because nobody outside the stage should send to it. Returning a directional channel makes that explicit at the type level.

---

### Q4. How do channels propagate "end of data" through a pipeline?

**Model answer.** A closed channel still allows reads (returning the zero value and `ok=false`), so when a stage's input channel is closed, its `range` loop exits naturally. The stage then returns from its goroutine; its `defer close(out)` fires, closing its output. The next stage sees the closed input and the cascade continues until the sink.

You never need a sentinel value or "EOF" marker. The closed channel *is* the EOF.

**Follow-up.** *What goes wrong if a stage forgets to close its output?* — The downstream stage's `range` blocks forever; its goroutine leaks; the pipeline never terminates.

---

### Q5. What is backpressure and how does it arise in a pipeline?

**Model answer.** Backpressure is the natural slow-down felt by an upstream stage when a downstream stage cannot keep up. Channel sends block when the channel is full and no receiver is ready, so a slow consumer causes its input channel to fill, which causes the upstream `out <- v` to block, which causes that stage to stop reading its own input, and so on up the chain. The whole pipeline pauses until the bottleneck makes progress.

This is the property that makes Go pipelines safe under load. There is no work queue silently growing in memory.

**Follow-up.** *What breaks backpressure?* — Unbounded buffers (e.g. a slice as a queue), oversized channel buffers, or any stage that drops values silently to keep up.

---

## Middle

### Q6. How do you cancel a pipeline mid-flight?

**Model answer.** Pass `context.Context` as the first parameter of every stage and use the *two-select sandwich* on every channel operation:

```go
for {
    select {
    case <-ctx.Done():
        return
    case v, ok := <-in:
        if !ok { return }
        select {
        case <-ctx.Done():
            return
        case out <- f(v):
        }
    }
}
```

When ctx is cancelled, every stage returns from its select; its goroutine ends; its output closes; the next stage's range exits; the cascade unwinds the whole pipeline.

**Common wrong answers.**
- "Just close the input channel." — That works for graceful EOF, not for cancellation. With ctx you can also abort while items are still in flight.
- "Wrap each stage in a `select { default: }`." — That's a busy-wait, not cancellation.

**Follow-up.** *Why two selects, not one?* — The first guards the receive (so a slow producer doesn't block cancellation); the second guards the send (so a slow consumer doesn't block cancellation). One select would only cover half the cases.

---

### Q7. How do errors flow through a pipeline?

**Model answer.** Three idioms:

1. **Result struct.** Each stage emits `Result[T]{Val T; Err error}`. Stages forward errors without processing. Simple, but couples error handling to data.
2. **Parallel error channel.** Each stage returns `(<-chan Out, <-chan error)`. The orchestrator multiplexes. More flexible, more boilerplate.
3. **errgroup.** Each stage's goroutine is a member of an `errgroup.Group`. The first error cancels ctx and unwinds every stage. The cleanest for pipelines that should abort on first error.

Choosing between them depends on whether errors are fatal (idiom 3) or per-item (idiom 1).

**Follow-up.** *What happens if a stage panics?* — Its goroutine dies, output never closes, downstream hangs. Wrap the goroutine body in `defer recover()` and convert to an error, or accept that the process will crash.

---

### Q8. Why must `defer close(out)` be the *first* defer?

**Model answer.** Defers run LIFO (last in, first out). The first defer runs *last*, after all cleanup. We want the channel close to be the very last action of the goroutine, so any deferred work (releasing a sync.Mutex, flushing a buffer) happens *before* downstream sees the close. Putting `defer close(out)` first guarantees that ordering.

**Follow-up.** *What if I put it last?* — Then close runs first, downstream may see EOF before some other deferred cleanup (e.g. a final flush) has happened. Subtle correctness bug.

---

### Q9. What is the difference between a pipeline and a fan-out?

**Model answer.** A pipeline is a *sequence* of stages. Each stage runs in one (or a few) goroutines in series with the others. Fan-out is *parallelism within one stage*: N workers all reading from the same input channel.

The two compose: a pipeline can have a stage that internally fans out to N workers and then fans in their outputs back into a single channel. That is the most common production shape because most pipelines have one slow stage that benefits from parallelism while the rest stay sequential.

**Follow-up.** *When do I need fan-out inside a pipeline?* — When one stage is the measured bottleneck and its work can be parallelised (CPU-bound transforms, IO-bound RPCs). Don't fan out by default; profile first.

---

### Q10. What is the `done`-channel pattern and when do I see it?

**Model answer.** Before `context.Context` (Go 1.7), pipelines used a `done <-chan struct{}` parameter. The orchestrator closed `done` to broadcast cancellation; each stage's select watched it.

```go
func stage(done <-chan struct{}, in <-chan In) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case <-done: return
            case out <- f(v):
            }
        }
    }()
    return out
}
```

Closing a channel is a broadcast: every receiver sees the close. Modern code uses ctx, but you still see done channels in older codebases and minimalist libraries that don't want to depend on `context`.

**Follow-up.** *Is ctx strictly better?* — Yes for most code: ctx adds deadlines, value passing, and tree structure. The done channel is a 90% subset.

---

### Q11. Why is each stage a separate goroutine instead of an inline call?

**Model answer.** A goroutine per stage gives concurrency: while stage 1 produces item N, stage 2 transforms item N-1, and stage 3 writes item N-2. An inline call would force serial execution: produce item N, transform item N, write item N, then produce item N+1.

Concurrent stages also exploit the natural parallelism of independent work — IO-bound and CPU-bound stages overlap. On a multi-core machine the runtime schedules them on different OS threads.

**Follow-up.** *What if my stages are all CPU-bound and trivial?* — Then channel overhead dominates. Fuse trivial stages into one (covered in optimize.md).

---

## Senior

### Q12. How do you choose buffer sizes between stages?

**Model answer.** Default to unbuffered. Add a buffer only after profiling shows backpressure churn or measurable jitter. A useful starting point is `buffer ≈ 2 * (P99 / median)` — if a stage's worst case is 10x its median, a buffer of ~20 absorbs that.

| Buffer | Effect | When |
|--------|--------|------|
| 0 | Strict backpressure | Default |
| 1-8 | Smooths jitter | Bursty per-item cost |
| 16-64 | Hides moderate slowdowns | IO-bound with batched downstream |
| 100+ | Hides bottleneck; memory risk | Rarely correct |
| Unbounded | OOM under load | Never |

Document the buffer in code: `make(chan T, 16) // tuned for parse stage P99=4ms`.

**Follow-up.** *Why not just use a large buffer always?* — It hides backpressure problems and grows memory unboundedly under sustained load. Large buffers turn a steady-state OOM into a Friday-evening incident.

---

### Q13. How does a pipeline shutdown cleanly under load?

**Model answer.** Two shutdown modes:

1. **Graceful EOF.** Producer closes its output, the close cascades through every stage, the sink drains naturally. No items are lost.
2. **Abort via ctx.** Caller cancels ctx. Every stage returns from its two-select sandwich; in-flight items are dropped. Useful for SIGTERM-style shutdown.

In production you usually combine: a SIGTERM handler cancels a "drain ctx" with a deadline (e.g. 30s). Stages stop accepting new items but keep draining for the remaining time. After the deadline, a hard ctx cancellation aborts any straggler.

**Follow-up.** *Why not just close the input channel on SIGTERM?* — That doesn't free a stage stuck in a downstream-blocking send. Only ctx (via the two-select sandwich) can unblock that.

---

### Q14. How do you compare a Go pipeline to Reactive Streams or Akka Streams?

**Model answer.** Go pipelines and Reactive Streams (RxJava, Akka Streams, Project Reactor) solve the same problem — composable async stages with backpressure — with very different mechanics:

| Aspect | Go pipeline | Reactive Streams |
|--------|-------------|------------------|
| Backpressure | Implicit via channel block | Explicit via `request(n)` demand |
| Composition | Function composition + `<-chan T` | Operator chains (`.map`, `.filter`) |
| Cancellation | `context.Context` | `Subscription.cancel()` |
| Threading | Goroutines + scheduler | Thread pools, schedulers |
| Type safety | Generic `<-chan T` | Generic `Publisher<T>` |
| Error propagation | Result types or errgroup | `onError` channel in the protocol |

Go's approach is simpler and "small library or none." Reactive Streams give finer control over demand (pull-based) at the cost of operator complexity.

**Follow-up.** *Which is "better"?* — Different ergonomics. Go pipelines fit naturally with goroutines and channels; Reactive Streams fit naturally with JVM-style async APIs. Mixing styles in one codebase rarely pays.

---

### Q15. How do you design a stage that fans out internally?

**Model answer.** Wrap N worker goroutines around the stage's transform, all reading from the same input channel, all writing to per-worker output channels (or one shared one). Then fan-in to a single output. The shape:

```go
func parallelEnrich(ctx context.Context, in <-chan Parsed, n int) <-chan Enriched {
    workers := make([]<-chan Enriched, n)
    for i := 0; i < n; i++ {
        workers[i] = enrich(ctx, in) // each worker reads same in
    }
    return Merge(ctx, workers...)
}
```

The downstream is unchanged because the stage still presents `<-chan Enriched`. Internally the stage owns N goroutines plus a fan-in goroutine.

**Follow-up.** *Does ordering survive?* — No. Fan-in interleaves arbitrarily. If order matters, tag each item with a sequence number and reorder at the sink.

---

### Q16. When should a stage be bounded vs unbounded?

**Model answer.** Always bounded. An "unbounded stage" usually means a stage that buffers values into a slice or map without limit — and that breaks the single guarantee that makes Go pipelines safe: backpressure. Under sustained load the unbounded buffer grows until OOM.

The legitimate use of large buffers is short-lived bursts: e.g. a periodic batch flush stage with a buffer of 1000 that drains every second. Even there, you cap the buffer and drop or block when full — never grow without limit.

**Follow-up.** *What if the producer is much faster than the consumer?* — Either the consumer needs more parallelism (fan-out), or the producer needs throttling (rate limiter), or some values can be dropped (sampling stage). Never paper over with an unbounded buffer.

---

### Q17. Explain backpressure in the two-select sandwich.

**Model answer.** Backpressure works because the *send* select also watches ctx but does not have a default. When the downstream channel is full, the `case out <- v:` blocks. The goroutine sits in the select. It is not consuming from `in`. So the upstream's send blocks. So the upstream stops reading its own input. The block propagates up the chain.

When the downstream finally drains, the `case out <- v:` succeeds, the goroutine loops back to the receive select, picks up the next item, and the chain restarts. The pipeline ran exactly as fast as the slowest stage. No values were lost, no buffer grew unboundedly.

If you replaced the second select with `out <- v` plus a `select { case <-ctx.Done(): default: }`, you'd get a busy-wait. The two-select sandwich is the only correct shape.

**Follow-up.** *What if I want lossy pipelines?* — Add a `default:` to the send select and increment a "dropped" counter. Now the send is non-blocking and you trade losslessness for never-blocking.

---

### Q18. What are the memory implications of a long pipeline?

**Model answer.** Three sources of memory usage in a pipeline:

1. **Goroutine stacks.** Each stage's goroutine has a stack (~8 KB initial, can grow to MB). Long pipelines or wide fan-outs can have thousands of goroutines.
2. **In-flight values.** Each channel buffer holds up to its capacity in items. A 10-stage pipeline with buffer=100 each holds 1000 items in memory.
3. **GC pressure.** Each channel send is a heap-eligible value (if escapes). A trivial 5-stage pipeline allocates per-item; under high throughput this dominates.

A 20-stage pipeline with buffer=1000 each, processing 1 KB items, holds 20 MB in flight per parallel pass. Multiply by fan-out width.

Mitigation: short pipelines, small buffers, sync.Pool for hot per-item allocations, reuse of struct values where the type is large.

**Follow-up.** *How do I measure?* — `pprof` heap profile, `runtime.NumGoroutine()`, `len(ch)` gauges per channel.

---

### Q19. What causes a deadlock in a pipeline?

**Model answer.** Common causes:

- **Stage forgets to close output.** Downstream's `range` blocks forever.
- **Cycle.** Output of stage 3 plumbed back into stage 1.
- **Two stages writing to one channel without coordination.** Close becomes unsafe; the orchestrator can't decide when to close.
- **Consumer stops reading early without cancellation.** Producer blocks on `out <- v` forever.
- **Unbuffered channel with single reader and single writer, both waiting on the other.** Classic.
- **`select` with no `default` and all cases blocked permanently.**

Diagnose with `runtime.Stack()` or `panic(debug.SetTraceback("all"))`. Each goroutine's stack tells you which channel op it is blocked on.

**Follow-up.** *Why doesn't `go run` deadlock-detect for me?* — The runtime's deadlock detector only fires when *all* goroutines are blocked. A leaking pipeline has live goroutines (e.g. a timer), so it doesn't trip.

---

## Staff

### Q20. Design a generic pipeline library. What primitives go in?

**Model answer.** Minimum viable API:

```go
type Stage[In, Out any] func(ctx context.Context, in <-chan In) <-chan Out

func Map[In, Out any](f func(In) Out) Stage[In, Out]
func Filter[T any](pred func(T) bool) Stage[T, T]
func Take[T any](n int) Stage[T, T]
func Batch[T any](size int, timeout time.Duration) Stage[T, []T]
func FanOut[In, Out any](n int, s Stage[In, Out]) Stage[In, Out]
func From[T any](values ...T) <-chan T
func Drain[T any](in <-chan T) []T
```

Constraints:
- All stages take ctx and use the two-select sandwich.
- All stages return `<-chan T`, never `chan T`.
- `Map` is a free function (Go method type-param limitation).
- Errors are *not* in the type signature; users compose with `errgroup` for fatal errors and `Result[T]` for per-item errors.
- Buffers are exposed via `WithBuffer(n)` options.

What *not* to add: built-in error channels (couples concern), parallel-aware operators that auto-fan-out (hides cost), reactive demand semantics (Go's blocking sends already provide it).

**Follow-up.** *Why isn't `errgroup` baked into Stage?* — Because some pipelines must continue past errors. Forcing first-error semantics into the core type narrows the library.

---

### Q21. Should generics be used in hot-path pipelines?

**Model answer.** Generics in Go 1.18+ are implemented via *gcshape stenciling* — one compiled instantiation per "shape" (size and pointerness) of the type parameter. Hot-path performance is usually identical to hand-written code, but with two caveats:

1. **Interface-shaped generics** (e.g. `T any` used through an interface method) compile to itab-style dispatch, which can be slower than concrete code.
2. **Inlining boundaries** sometimes change with generics. A trivial `Map[int, int](square)` may not inline as well as a hand-written `square(<-chan int) <-chan int`.

For a microbenchmark difference (say 10-30 ns per item) this rarely matters. For a 1-billion-events pipeline it can. Profile both and pick what wins.

**Follow-up.** *Best practice?* — Write the pipeline in generics, keep the option to specialize the bottleneck stage with a concrete type if profiling shows it.

---

### Q22. What is the right way to handle a panic in a stage?

**Model answer.** Two choices, based on operational policy:

1. **Crash the process.** Panics are bugs. Let the goroutine die, the runtime detects "all goroutines asleep — deadlock," and the process crashes. Restart from the supervisor. This is the simplest and surfaces the bug fastest.

2. **Recover and convert to error.** Wrap the goroutine body in `defer func() { if r := recover(); r != nil { errCh <- fmt.Errorf("panic: %v", r) } }()`. The pipeline shuts down via the error path; other stages drain cleanly.

Pick (1) for batch jobs and short-lived pipelines. Pick (2) for long-running streaming systems where a panic in one item shouldn't kill the whole process.

Critical detail for (2): always `close(out)` *after* recover (defer runs in LIFO; put `close(out)` defer first, recover defer second). Otherwise downstream hangs.

**Follow-up.** *Does panic in a goroutine propagate to the caller?* — No. Goroutines have separate stacks. An unrecovered panic in a stage's goroutine kills the whole process; it does not reach the function that started the stage.

---

### Q23. Compare bounded and unbounded pipelines for streaming aggregation.

**Model answer.** A streaming aggregation pipeline reads events forever and emits aggregates on a window (time- or count-based).

**Bounded version.** Every channel has a small buffer; the aggregation stage emits when the window fires. Backpressure flows up: if the emit destination (e.g. Kafka writer) slows, the source stops reading. The bounded design tolerates 10x source-rate spikes without OOM but may drop or pause the source.

**Unbounded version.** Aggregation buffers are slices/maps that grow until window fires. No backpressure between source and aggregator. Under a slow downstream, memory grows linearly with the lag. Under sustained load, OOM.

The bounded version is correct for production; the unbounded version is acceptable only for short-lived jobs with well-bounded input. The instinct should be: "bounded by default, with explicit overflow policy when crossing a bound" (drop, sample, alert, or block).

**Follow-up.** *What's the overflow policy if you can't drop?* — Block (apply backpressure to the source) or persist to disk. Never grow unbounded in memory.

---

### Q24. Suppose a customer reports the pipeline "stops processing after 10 minutes." How would you debug?

**Model answer.** Hypotheses, in order of likelihood:

1. **A stage is stuck.** Take a goroutine dump (`runtime.Stack`, SIGQUIT, or `/debug/pprof/goroutine?debug=2`). Look for goroutines blocked on channel ops. The blocked stack tells you the deadlock site.
2. **Ctx leaked but stages still running.** Check for stages that don't observe ctx. The two-select sandwich may have been simplified into a single select, which doesn't unblock the send.
3. **A panic killed one stage's goroutine.** Look for "panic" or "goroutine N panicked" in stderr. Output channel was never closed; downstream hangs.
4. **External dependency hang.** Stage doing an RPC without a deadline. Stuck stage holds upstream backpressure; whole pipeline freezes.
5. **Memory pressure / GC pauses.** `pprof heap`, `gctrace=1`. A large buffer is filling under load.

Diagnostic toolkit: goroutine dump, channel-length gauges, per-stage `processed/sec` metric, ctx deadline propagation audit.

**Follow-up.** *What single instrument would have caught this in production?* — A "stage idle time" metric. If any stage's idle time goes to 100% but its predecessor's queue is non-empty, that stage is stuck.

---

### Q25. Why would you not use a pipeline?

**Model answer.** Anti-cases:

- **Single-item processing with no concurrency benefit.** A function call is simpler.
- **Stages that share mutable state extensively.** Channels make that awkward; a `sync.Mutex`-guarded pipeline of function calls may be cleaner.
- **Strict ordering across heterogeneous stages with internal parallelism.** Fan-out breaks order; reordering is expensive.
- **Tiny per-item work (sub-microsecond).** Channel overhead (50-150 ns per send/recv) dominates. Batch the work or fuse stages.
- **Synchronous request/response with low latency requirement.** Pipelines optimize throughput; a direct call optimizes latency.

The default for data-flow problems is a pipeline. The default for one-shot computations is plain function composition.

**Follow-up.** *When does the "tiny per-item work" rule kick in?* — Roughly when per-item transform cost is less than 1 µs. Below that, channel overhead is the dominant cost. Fuse adjacent stages into one transform.

---

### Q26. How does a pipeline interact with backpressure-sensitive external systems?

**Model answer.** Two boundaries to consider:

1. **Source.** If the source is something with its own backpressure protocol (Kafka consumer, a paginated HTTP API, a streaming RPC), the source stage should *pull* from it on demand, not push everything into the pipeline. A blocking send on the next channel naturally gates the source's `Poll()` call.

2. **Sink.** If the sink is bursty or rate-limited (HTTP POST to an analytics service, batch DB insert), the sink stage should batch and buffer up to a cap, then flush. The cap creates explicit backpressure on the rest of the pipeline.

A common bug: dumping the source into an unbounded channel for "decoupling," which silently breaks backpressure between the network and the pipeline. The whole point of unbuffered channels is to keep the source's pull rate aligned with the sink's drain rate.

**Follow-up.** *What if the source can't be slowed (e.g. UDP)?* — Then you need an explicit overflow policy (drop oldest, drop newest, sample, alert) at the boundary stage. The pipeline downstream can still be bounded.

---

## Bonus

### Q27. What's the most subtle pipeline bug you've seen?

**Model answer.** A stage that recovered from panic but didn't close its output. Pipeline appeared to "stall" — no new items appeared, no errors logged, no goroutines blocked in obvious places. Goroutine dump showed downstream waiting on a closed-but-not-actually-closed channel. The recover ran, the goroutine returned cleanly, but the deferred close never registered because it was placed *after* the recover defer (so it never executed when recover took the panic).

Fix: `defer close(out)` first, `defer recover()` second. Defers run LIFO, so close runs last — *after* recover handles the panic.

**Follow-up.** *How do you prevent this in code review?* — A unit test that panics inside the stage's transform and asserts that the output channel is closed within a deadline.

---

### Q28. What metrics would you expose for a production pipeline?

**Model answer.**

| Metric | Why |
|--------|-----|
| Items processed per stage per second | Spot the slow stage |
| Items in flight (sum of `len(ch)` across stages) | Spot backpressure / memory bloat |
| Stage idle ratio | Find which stage is the bottleneck |
| Errors per stage per second | Triage error spikes |
| Pipeline shutdown duration | Catch regressions in ctx propagation |
| Goroutine count | Catch leaks |
| Heap in-use bytes | Catch unbounded buffer creep |

Per-stage histograms of latency are useful; counters at the boundaries are mandatory. Without these, a pipeline at 3am is a black box.

---

### Q29. When are pipelines an anti-pattern in microservices?

**Model answer.** When the "pipeline" crosses a process boundary. A pipeline is a single-process construct: stages share goroutines, channels, and a single ctx tree. The moment a stage runs in a different process, you don't have a pipeline — you have a distributed system. Channels are replaced by message queues; ctx by trace IDs; close by tombstone messages; backpressure by explicit credit-based flow control.

Trying to extend Go pipeline semantics across the network is a category error. Use Kafka, NATS, or gRPC streaming with proper protocols (request/credit, ack/nack, retries, dead-letter queues) and stop using the pipeline vocabulary.

**Follow-up.** *Within one process, how big can a pipeline get?* — Within reason, very big. Hundreds of stages, thousands of goroutines, billions of events per day. The constraint is not pipeline size but stage discipline: ctx, close, two-select sandwich, profiled buffers.

---

### Q30. How does a pipeline differ from a worker pool?

**Model answer.** A worker pool is a single stage with N parallel workers all doing the same work, fed from one input channel. A pipeline is a sequence of *different* stages, each transforming the data further.

The two compose: a pipeline can have a worker-pool stage in the middle (fan-out + fan-in inside a stage). But conceptually they answer different questions:

- Worker pool: "I have one slow operation; parallelise it."
- Pipeline: "I have a sequence of operations; let them run concurrently."

If you only have one operation, you don't need a pipeline. If you have a sequence, you don't need to spin up workers per stage — only on the bottleneck.

---

## Cheat Sheet

| Topic | Key idea |
|-------|----------|
| Pipeline | Sequence of stages connected by channels |
| Stage signature | `func(ctx, <-chan In) <-chan Out` |
| Close protocol | Each stage closes its own output |
| Cancellation | ctx + two-select sandwich |
| Errors | Result type, parallel error channel, or errgroup |
| Backpressure | Automatic via channel block |
| Fan-out within stage | Replace bottleneck with N workers + fan-in |
| Buffer sizing | Default 0; tune by P99/median ratio |
| Long pipelines | Watch goroutine count, in-flight memory |
| Anti-pattern | Crossing process boundaries — that's a distributed system |
