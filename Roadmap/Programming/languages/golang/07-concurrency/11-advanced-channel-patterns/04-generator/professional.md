# Generator Pattern — Professional Level

> Focus: "Production-grade source stages: SLOs, capacity planning, observability, and integration with platform-level concerns."

This file is for engineers responsible for streams that must run for months at a time, survive partial failures, hit explicit throughput targets, and be diagnosable at 3am. It assumes the senior-level material is internalised.

## Table of Contents

1. [Treating a Generator as a Service](#treating-a-generator-as-a-service)
2. [Capacity Planning](#capacity-planning)
3. [Operational SLOs](#operational-slos)
4. [Observability Contract](#observability-contract)
5. [Failure Modes and Recovery](#failure-modes-and-recovery)
6. [Multi-Tenant Generators](#multi-tenant-generators)
7. [Generator-as-a-Plugin](#generator-as-a-plugin)
8. [Compatibility and Migration](#compatibility-and-migration)

---

## Treating a Generator as a Service

A long-lived channel generator in production is *a service*, even if it lives inside the same process as its consumer. Apply the same discipline you would to a microservice:

- **Explicit interface.** The generator's public surface is the function signature plus the contract in its doc-comment. Any behaviour change is an API change.
- **Versioned configuration.** Buffer size, poll interval, batch size are configuration knobs, not magic numbers. Wire them through your config system; surface defaults in code.
- **Lifecycle hooks.** Define a clear startup (return the channel), runtime (yield values), and shutdown (channel closes; goroutine exits) phase. Log each transition.
- **Error budget.** If a streaming error rate exceeds a threshold, surface it; don't paper over it.
- **Ownership.** The team that owns the consumer is not the team that owns the generator. Treat the generator's contract as a public API.

A common failure mode: a generator that "just works" in development quietly becomes brittle in production because nobody owns its operational health. Assign an owner.

---

## Capacity Planning

For a high-throughput generator, capacity planning means answering three questions:

1. **What is the steady-state throughput target?** Items per second.
2. **What is the burst tolerance?** Peak items per second the system must absorb.
3. **What is the acceptable end-to-end latency?** From source to sink.

Given these, work out:

- **Channel buffer size** ≈ `target_throughput × acceptable_send_latency`. If you target 10k items/sec and tolerate 10ms of producer wait, the buffer must hold ~100 items.
- **Fan-out width** for parallel consumers. If consumer processing is 1ms/item and target is 10k/sec, you need 10 parallel consumers (with overhead margin: ~12-15).
- **Memory footprint.** `buffer_size × item_size` per generator; multiply by number of generator instances.
- **Goroutine budget.** One per generator, plus fan-out width per consumer. A service with 100 generators and fan-out 16 has 1600+ goroutines just for the streaming layer. Goroutines are cheap but not free at this scale.

Document these numbers in a sizing comment near the generator:

```go
// Throughput: 5k events/sec steady, 20k burst.
// Buffer: 256 (≈50ms of peak load).
// Memory: 256 × 4KB = 1MB per stream.
// Fan-out (consumer side): 8 workers.
func StreamEvents(ctx context.Context) <-chan Event { ... }
```

When the numbers change, the comment changes. Without this comment, the next engineer guesses.

---

## Operational SLOs

For a production stream, define and measure:

- **Availability:** percentage of time the generator is producing within the throughput SLO. (Not just "the goroutine is alive".)
- **Freshness:** for event streams, the lag between event creation upstream and yield at the generator. p50, p95, p99.
- **Throughput floor:** items per second the generator must sustain. Alert if below.
- **Error rate:** streaming errors per minute. Distinguishable from setup errors.
- **Goroutine count:** alert if it grows unboundedly (a leak signal).

Each SLO needs:
- A metric.
- A dashboard.
- An alert.
- A runbook for when the alert fires.

A generator without these is a future incident.

---

## Observability Contract

The minimum production-grade observability for a long-lived generator:

```go
// At the top of the goroutine:
ctx = pprof.WithLabels(ctx, pprof.Labels("source", "kafka_events"))
pprof.SetGoroutineLabels(ctx)

// Counters:
metrics.Inc("generator.items_sent", labels)
metrics.Inc("generator.errors", labels)

// Histograms:
metrics.Observe("generator.send_latency_seconds", elapsed)
metrics.Observe("generator.fetch_latency_seconds", elapsed)

// Gauges:
metrics.Set("generator.buffer_used", len(out))
metrics.Set("generator.buffer_capacity", cap(out))

// Cancellation log:
defer func() {
    log.Info("generator exiting",
        "source", "kafka_events",
        "reason", ctx.Err(),
        "items_sent", count,
    )
}()
```

Tracing: emit a span per fetch (paginator) or per batch (Kafka). Spans carry the cursor / offset / partition so a slow segment of the stream can be traced back to the source.

Structured logs: every log line includes the generator name and the cursor. The runbook starts with "grep for source=X to find the latest cursor".

---

## Failure Modes and Recovery

Production generators encounter:

### 1. Transient upstream errors (network blip, 503)

Strategy: retry with exponential backoff *inside* the generator. The consumer keeps reading; transient errors do not surface.

```go
for {
    page, err := fetch(ctx, cursor)
    if err != nil {
        if isRetryable(err) {
            time.Sleep(backoff.Next())
            continue
        }
        // permanent: signal downstream
        out <- Result{Err: err}
        return
    }
    backoff.Reset()
    // ...
}
```

### 2. Permanent upstream failure (auth revoked, bucket deleted)

Strategy: surface as a streaming error, exit the goroutine, let the supervisor decide. Do not retry forever.

### 3. Slow consumer

Strategy: detect via the buffer-saturation metric. Alternatives:
- Apply backpressure upstream (default — let the producer slow down).
- Drop oldest items (ring-buffer the generator output).
- Drop newest items (non-blocking sends).
- Spill to disk (rarely worth the complexity).

Pick one policy per stream and document it.

### 4. Producer panic

Strategy: `recover()` inside the goroutine; emit a metric; close the channel cleanly so the consumer drains. Optionally restart the generator via a supervisor; do not let the consumer's `range` see a half-closed state.

```go
defer func() {
    if r := recover(); r != nil {
        metrics.Inc("generator.panics", labels)
        log.Error("generator panicked", "panic", r, "stack", debug.Stack())
    }
    close(out)
}()
```

### 5. Resource exhaustion (file handles, sockets)

Strategy: bound the number of concurrent generators with a semaphore; release the resource handle before closing the channel; tie the resource lifetime to a `defer` chain that always runs.

---

## Multi-Tenant Generators

When one generator instance serves many tenants:

- **Isolation:** a slow or buggy tenant must not starve others. Use one generator goroutine per tenant; never multiplex tenants onto one goroutine.
- **Fairness:** a tenant with 10x the events must not consume 10x the channel slots. Apply per-tenant rate-limiting upstream.
- **Tenant-aware metrics:** every metric carries a tenant label. A throughput drop in one tenant must not be hidden by a global average.
- **Tenant-aware cancellation:** cancelling tenant A's stream must not affect tenant B's. Use per-tenant contexts derived from a parent.

The shape:

```go
parentCtx
   ├── ctxTenantA → genA → consumerA
   ├── ctxTenantB → genB → consumerB
   └── ctxTenantC → genC → consumerC
```

Cancelling `ctxTenantA` stops only genA. Cancelling `parentCtx` stops all.

---

## Generator-as-a-Plugin

Some platforms expose a `Source` interface so third parties can ship custom generators:

```go
type Source interface {
    Name() string
    Stream(ctx context.Context) (<-chan Event, error)
    Close() error
}
```

When designing a plugin-style generator interface:

- **Make `Stream` return `(<-chan Event, error)`.** Setup errors are synchronous.
- **Make `Close` idempotent.** Plugins must tolerate `Close` being called twice or after `ctx` is cancelled.
- **Forbid blocking in `Stream`.** It must return promptly; streaming happens in the goroutine.
- **Document the cancellation contract.** "When `ctx` is cancelled, the channel must close within N seconds."
- **Surface plugin errors with the plugin name attached.** Operators need to know *which* plugin failed.

A plugin that violates the contract poisons the consumer's pipeline. The interface must make the contract checkable, ideally with a conformance test suite the plugin author runs.

---

## Compatibility and Migration

When a generator's behaviour must evolve in production:

### Adding a new field to the yielded type

Make the type a struct from day one. Adding a field is backward-compatible if consumers use `_ = ev.NewField` patterns.

### Changing the cancellation semantics

Cannot be done in-place. Introduce a new function (`StreamV2`), keep the old one, migrate consumers, remove the old one. Behavioural changes deserve a new signature.

### Migrating from `done` to `ctx`

Step 1: introduce a parallel signature accepting `ctx`. Both call into a shared internal implementation that takes both. Step 2: migrate consumers. Step 3: deprecate the `done` form. Step 4: remove it after a deprecation window.

### Migrating from channel generator to `iter.Seq`

Often desirable as Go 1.23+ adoption rises. Approach:

1. Expose an iterator API: `func StreamSeq(ctx context.Context) iter.Seq[Event]`.
2. Internally, the iterator may still drive a channel generator if the upstream is naturally concurrent. The wrapper is small.
3. Mark the channel API deprecated but keep it; some consumers still need the channel for fan-out/tee/bridge.

Do not delete the channel API just because iterators are newer. Different consumers need different shapes.

---

A professional-grade generator is a documented, measured, supervised source stage with a known SLO and a runbook. The pattern is the same as the junior-level template; the difference is everything around it.
