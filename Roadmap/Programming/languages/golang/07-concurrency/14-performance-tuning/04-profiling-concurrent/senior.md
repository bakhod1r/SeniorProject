# Profiling Concurrent Go Code — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Goroutine Labels: `pprof.Do` and `pprof.SetGoroutineLabels`](#goroutine-labels-pprofdo-and-pprofsetgoroutinelabels)
3. [`runtime/trace` Tasks and Regions](#runtimetrace-tasks-and-regions)
4. [Label-Driven Profile Slicing](#label-driven-profile-slicing)
5. [Fleet-Wide Continuous Profiling](#fleet-wide-continuous-profiling)
6. [Profile-Guided Optimization (PGO)](#profile-guided-optimization-pgo)
7. [Trace Correlation Across Services](#trace-correlation-across-services)
8. [Production Hardening for Concurrent Profiles](#production-hardening-for-concurrent-profiles)
9. [Building a Concurrency Health Dashboard](#building-a-concurrency-health-dashboard)
10. [Common Anti-Patterns at Scale](#common-anti-patterns-at-scale)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At middle level you ran the tools. At senior level you make them part of the platform. Every goroutine that handles a request is labelled. Every trace has a task that maps to a span ID. Every fleet member feeds a continuous profiler. The data is normalised so that "this endpoint's mutex profile" or "this tenant's block profile" is a one-line query, not a tcpdump-and-grep session. You also understand the second-order effects: labelled goroutines slightly slow the runtime; PGO using a CPU profile from peak traffic biases the optimiser; some traces are too large for the viewer to render. You make the trade-offs explicitly.

After this file you will:

- Tag goroutines with labels and slice profiles by them.
- Instrument `runtime/trace` with tasks and regions that map to your request graph.
- Run a production-grade continuous profiler with mutex/block enabled fleetwide.
- Use PGO with profiles drawn from real traffic.
- Correlate Go traces with distributed tracing (OpenTelemetry) at the goroutine boundary.

For sampler internals and protobuf format, see `professional.md`.

---

## Goroutine Labels: `pprof.Do` and `pprof.SetGoroutineLabels`

Labels are key/value pairs attached to a goroutine that the profiler records alongside its stack. This is the single biggest leverage on real-world debugging: instead of "the mutex profile shows contention in `Cache.Get`," you get "the mutex profile shows contention in `Cache.Get` for tenant `T17` on endpoint `/checkout`."

### The API

```go
import "runtime/pprof"

ctx := pprof.WithLabels(parentCtx, pprof.Labels(
    "endpoint", r.URL.Path,
    "tenant", tenantID,
))
pprof.Do(ctx, pprof.Labels("worker", "ingestor"), func(ctx context.Context) {
    // any goroutine started here inherits the labels too
    work(ctx)
})
```

Two important properties:

1. Labels **propagate to goroutines started inside `pprof.Do`** (since Go 1.9). Standalone `go f()` does not propagate; a goroutine inherits labels only when its parent goroutine had them.
2. Labels live in the goroutine itself, not the context — `ctx` is the carrier. If a goroutine survives the `pprof.Do` call, its labels persist.

### Lower-level: `SetGoroutineLabels`

For goroutines you cannot wrap in a `pprof.Do` (top of a worker pool's run loop, for example):

```go
func (w *Worker) run(ctx context.Context) {
    pprof.SetGoroutineLabels(pprof.WithLabels(ctx, pprof.Labels(
        "pool", w.poolName,
        "shard", strconv.Itoa(w.shard),
    )))
    for task := range w.in {
        w.handle(task)
    }
}
```

Call once at the top. From that point on, every sample taken on this goroutine carries those labels.

### Designing label keys

Two rules:

1. **Low cardinality only.** Labels are stored per-sample. A handful of values per key is fine; thousands is not. Don't put `request_id` — put `endpoint`. Don't put `tenant_id` directly — bucket it into the top N tenants and call the rest `other`.
2. **Stable keys.** Use `endpoint`, `tenant`, `pool`, `worker`, `role`. Pick a vocabulary and document it.

Recommended starter set:

| Key | Example values |
|-----|----------------|
| `endpoint` | `/checkout`, `/search`, `/admin` |
| `role` | `http-handler`, `worker`, `bg-task`, `scheduler` |
| `pool` | `image-resize`, `email-sender` |
| `tenant` | top-10 tenants explicit, else `other` |
| `priority` | `high`, `normal`, `low` |

### Reading labelled profiles

`go tool pprof` exposes labels via `tag*` flags.

```bash
go tool pprof -tagfocus=endpoint=/checkout mutex.prof
(pprof) top
```

Same in the web UI: the dropdown "Tag" lets you filter and aggregate. The Pyroscope/Parca UIs do this natively.

### Cost

Labels add a small per-sample overhead. Empirically <1% for typical service workloads. Worth it.

---

## `runtime/trace` Tasks and Regions

The trace becomes ten times more useful when you mark what your code is doing.

### Tasks

A **task** spans one logical operation, often a request. It has a name and a unique ID.

```go
import "runtime/trace"

func handle(w http.ResponseWriter, r *http.Request) {
    ctx, task := trace.NewTask(r.Context(), "http:"+r.URL.Path)
    defer task.End()

    process(ctx)
}
```

`trace.NewTask` is **free when no trace is running** — single atomic check. You can leave it on in production.

### Regions

A **region** is a span inside a task. Tasks are usually one-per-request; regions are dozens-per-request — DB query, RPC call, cache lookup, etc.

```go
func process(ctx context.Context) {
    defer trace.StartRegion(ctx, "db.lookup").End()
    db.Query(...)
}
```

`StartRegion` returns a `*Region` with an `End()` method. Use `defer` immediately.

### Logging events inside a task

```go
trace.Logf(ctx, "category", "format %d %s", 42, "value")
```

Shows up as an event in the timeline.

### Viewing tasks and regions

`go tool trace trace.out` has a section "User-defined tasks." Click "http:/checkout" → see every instance of that task during the trace window, with breakdown:

- Wall time per task.
- Time in each region.
- Goroutines involved (a task can span goroutines through context propagation).
- Events logged.

Click a single task to see its timeline isolated from the noise.

### A real instrumentation pattern

```go
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    ctx, task := trace.NewTask(r.Context(), "http:"+r.URL.Path)
    defer task.End()

    ctx = pprof.WithLabels(ctx, pprof.Labels(
        "endpoint", r.URL.Path,
    ))
    pprof.SetGoroutineLabels(ctx)

    // ... handler logic, with region per logical step ...
    func() {
        defer trace.StartRegion(ctx, "auth").End()
        if err := s.auth(ctx, r); err != nil {
            ...
        }
    }()
    func() {
        defer trace.StartRegion(ctx, "db.fetch").End()
        ...
    }()
}
```

Now both profiles (sliceable by `endpoint=` label) and traces (filterable by task name) are rich.

---

## Label-Driven Profile Slicing

Once labels are deployed, profile reading changes. You stop looking at the whole profile and start querying for the relevant slice.

### CLI

```bash
# Mutex contention on /checkout only
go tool pprof -tagfocus=endpoint=/checkout mutex.prof
(pprof) top

# Block profile on the image-resize pool
go tool pprof -tagfocus=pool=image-resize block.prof
(pprof) top

# Everything except admin endpoints
go tool pprof -tagignore=endpoint=/admin profile.prof
```

### Web UI

The web UI (`-http=:9090`) has a "Tag" dropdown. Pick the label key, then the value, then re-render. The flame graph updates.

### Pyroscope queries

In Pyroscope, the same is expressed as a query:

```
go.mutex{endpoint="/checkout"}
```

Pyroscope stores labels as first-class dimensions, so a query like this is fast even at fleet scale.

### Tag-keyed differential profiling

The most powerful workflow:

1. Capture pre-deploy mutex profile.
2. Deploy a change that affects only `endpoint=/checkout`.
3. Capture post-deploy.
4. Diff with `-base`, but with `-tagfocus=endpoint=/checkout` on both.
5. The result is the contention change isolated to that endpoint, ignoring all unrelated noise.

---

## Fleet-Wide Continuous Profiling

A continuous profiler scrapes every instance, stores history, and lets you query. Choosing between Pyroscope, Parca, and Polar Signals is mostly an operational decision. The technical setup is similar in all three.

### Required on the service side

```go
// At startup
runtime.SetMutexProfileFraction(100)
runtime.SetBlockProfileRate(int(time.Millisecond))

// Pprof listener (private port)
go http.ListenAndServe("127.0.0.1:6060", nil)
```

For Pyroscope's push model, the agent runs in-process. For Parca and Pyroscope-pull, the backend scrapes `/debug/pprof/*`.

### Profiles to scrape

- `profile?seconds=15` (CPU) every minute.
- `heap?gc=1` every minute.
- `goroutine` every minute.
- `mutex` and `block` every minute (assuming enabled).
- `allocs` every 5 minutes.

Skipping `trace` is intentional. Traces are too large for continuous collection. Capture them on demand.

### Storage sizing

A typical Go service produces ~500 KB of profile per scrape. At 6 profiles/min, that's 3 MB/min = 4.3 GB/day per instance. 30-day retention on a fleet of 100 instances: 13 TB. Sample down or use Parquet compression (Parca does this natively).

### Cost-controlled enablement

A pattern: keep mutex/block off by default, enable for 10% of pods. Or enable for one canary pod. The continuous profiler reports stable data for the enabled subset; you trust it as a fleet-wide signal.

```go
import (
    "math/rand"
    "os"
)

func init() {
    if rand.Float64() < 0.10 || os.Getenv("POD_ROLE") == "canary" {
        runtime.SetMutexProfileFraction(100)
        runtime.SetBlockProfileRate(int(time.Millisecond))
    }
}
```

---

## Profile-Guided Optimization (PGO)

Since Go 1.21, `go build -pgo=<profile>` accepts a CPU profile and uses it to drive inlining, devirtualisation, and basic block ordering. PGO can deliver 2–7% speedup in real workloads.

### Capturing a PGO profile

Use a CPU profile taken during representative traffic. **Not** an empty service. **Not** a peak that includes a rare path. Aim for "median day."

```bash
curl -o pgo.prof 'http://prod:6060/debug/pprof/profile?seconds=60'
```

Put it at `default.pgo` in the main package. `go build` auto-detects.

### PGO and concurrency

PGO doesn't directly help with contention — it optimises hot CPU paths, not lock paths. But by making the work inside critical sections faster, it can reduce contention as a side effect.

### Pitfalls

- A PGO profile from a workload that does not match production biases the build. If you mostly serve search but profile during a checkout spike, the wrong paths get optimised.
- PGO profiles drift with code changes. Refresh every few releases.

### Concurrent profiling and PGO together

The standard flow:

1. Use continuous profiling to confirm "is this CPU profile representative?"
2. Pull a recent 60 s profile from a representative pod.
3. Commit as `default.pgo`.
4. Compare microbenchmark deltas in CI to confirm a net win.

---

## Trace Correlation Across Services

`runtime/trace` is local: it sees this binary's goroutines, no others. Distributed tracing (OpenTelemetry, Jaeger) is the cross-service tool. The interesting question: can you correlate?

Yes, with manual glue:

```go
import (
    "context"
    "runtime/trace"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/trace" // alias collision: rename one
)

func handle(ctx context.Context, r *http.Request) {
    span := otelTrace.SpanFromContext(ctx)
    spanID := span.SpanContext().SpanID().String()

    ctx, task := trace.NewTask(ctx, "http:"+r.URL.Path)
    defer task.End()

    trace.Logf(ctx, "otel", "span=%s trace=%s",
        spanID, span.SpanContext().TraceID().String())

    // ... handler ...
}
```

Now a slow request observed in Jaeger has a `span=XXXX` trace event in the Go trace, letting you cross-reference. The reverse is harder: from a Go trace's task, look up the span ID in your tracing backend.

A more ambitious approach is the `gotraceui` project — third-party trace UI that can ingest OTel data alongside Go traces.

---

## Production Hardening for Concurrent Profiles

### Authentication on the pprof endpoint

`net/http/pprof` registers handlers on the default mux. In production:

```go
mux := http.NewServeMux()
mux.HandleFunc("/debug/pprof/", pprof.Index)
mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
mux.HandleFunc("/debug/pprof/trace", pprof.Trace)

authed := basicAuth(mux, os.Getenv("PPROF_USER"), os.Getenv("PPROF_PASS"))
go http.ListenAndServe("127.0.0.1:6060", authed)
```

Bind to localhost; route through a sidecar that adds auth. Never expose unauthenticated.

### Rate-limited trace capture

`runtime/trace` is expensive while running. A misbehaving operator could request a 10-minute trace and stall the service. Add a rate limit:

```go
var traceTicket = make(chan struct{}, 1)
traceTicket <- struct{}{}

func traceHandler(w http.ResponseWriter, r *http.Request) {
    select {
    case <-traceTicket:
        defer func() { traceTicket <- struct{}{} }()
    default:
        http.Error(w, "another trace in progress", 429)
        return
    }
    pprof.Trace(w, r)
}
```

One concurrent trace, end-to-end, with a 429 for everyone else.

### Bounded trace duration

```go
func traceHandler(w http.ResponseWriter, r *http.Request) {
    // Cap seconds= to 10.
    if s := r.FormValue("seconds"); s != "" {
        n, err := strconv.Atoi(s)
        if err == nil && n > 10 {
            r.Form.Set("seconds", "10")
        }
    }
    pprof.Trace(w, r)
}
```

Operators get a trace, the service stays healthy.

### Production-safe fractions

| Profile | Production-safe | Forensic |
|---------|-----------------|----------|
| `SetMutexProfileFraction` | 100 | 1 |
| `SetBlockProfileRate` (ns) | 1e6 (1 ms) | 1 |

A switchable knob at runtime is useful:

```go
http.HandleFunc("/admin/mutex-fraction", func(w http.ResponseWriter, r *http.Request) {
    v, err := strconv.Atoi(r.FormValue("v"))
    if err != nil || v < 0 {
        http.Error(w, "bad value", 400)
        return
    }
    runtime.SetMutexProfileFraction(v)
})
```

---

## Building a Concurrency Health Dashboard

The metrics you want on a permanent dashboard:

| Metric | Source |
|--------|--------|
| Goroutine count | `runtime/metrics`: `/sched/goroutines:goroutines` |
| Goroutines runnable | `runtime/metrics`: `/sched/latencies:seconds` distribution |
| GC stop-the-world time | `runtime/metrics`: `/gc/pauses:seconds` |
| Heap inuse | `runtime/metrics`: `/memory/classes/heap/objects:bytes` |
| Mutex contention rate | derived from continuous mutex profile (sum of samples per minute) |
| Block contention rate | same, block profile |

The continuous profiler can publish per-minute aggregates as Prometheus metrics. Pyroscope ships a Prometheus exporter; Parca emits OpenTelemetry metrics.

### Alerts

- Goroutine count > 10× baseline → leak likely.
- p99 scheduler latency > 50 ms → over-scheduled.
- Mutex contention rate up 3× from last hour → regression.
- Block contention rate up 3× from last hour → regression.

These four alerts catch most live concurrency regressions before customers complain.

---

## Common Anti-Patterns at Scale

### Anti-pattern: per-request label cardinality

```go
pprof.Do(ctx, pprof.Labels("request_id", reqID), func(...){})
```

Every request has a unique ID. The profile store explodes. Use bucket labels instead.

### Anti-pattern: traces enabled on every pod

`runtime/trace` is for targeted captures. Continuous trace collection burns enormous bandwidth and overwhelms the viewer. Continuous profiles, yes. Continuous traces, no.

### Anti-pattern: PGO from a profile that includes startup

The first ten seconds of a service's life are not representative. Wait for warmup, then capture.

### Anti-pattern: removing labels because "profiling is slow"

If labels are causing measurable overhead, your label keys are wrong (too many values), not the API. Reduce cardinality, don't remove labels.

### Anti-pattern: trusting one continuous profile in isolation

A single Pyroscope flame graph from 03:00 UTC reflects 03:00 UTC. To diagnose a regression, you need at least two windows (before and after the deploy) and the labels to slice them.

### Anti-pattern: trace.NewTask without trace.WithRegion

Tasks alone tell you the duration; regions tell you what dominated inside it. Use both.

### Anti-pattern: label name collisions

`pprof.Labels("name", "foo")` collides with whatever your tracing library calls "name." Establish a prefix convention: `goprof.endpoint`, `goprof.pool` etc.

---

## Self-Assessment

- [ ] I have introduced goroutine labels into at least one production service.
- [ ] I can write a request handler that wraps `trace.NewTask`, `pprof.WithLabels`, and `pprof.SetGoroutineLabels` correctly.
- [ ] I can read a labelled mutex profile sliced by endpoint.
- [ ] I can argue for one of Pyroscope / Parca / Polar Signals based on the team's stack.
- [ ] I have used PGO with a representative profile and measured the gain.
- [ ] I have a runbook for "capture a trace safely in prod" — rate limit, bounded seconds, auth.
- [ ] I have a dashboard for the four concurrency health metrics.

---

## Summary

Senior-level concurrent profiling means turning a debugging skill into a platform feature. Goroutine labels give every profile a tenant/endpoint/role dimension. `runtime/trace` tasks and regions give you a request-level timeline that maps directly to your application's structure. A continuous profiler turns one-shot captures into queryable history. PGO closes the loop by feeding a CPU profile back into the compiler. Each of these costs a small fraction of a percent in steady-state and pays for itself the first time a concurrency regression ships. Production hardening — auth, rate-limited traces, switchable fractions — is the price of using these tools at scale safely. At professional level we'll look inside the sampler itself, the trace event protocol, and how the runtime decides what to record.
