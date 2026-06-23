# Stack Traces & Debugging — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Debugging as a Production Discipline](#debugging-as-a-production-discipline)
3. [The Diagnostic Stack: Logs, Metrics, Traces, Stacks](#the-diagnostic-stack-logs-metrics-traces-stacks)
4. [pprof at Production Scale](#pprof-at-production-scale)
5. [Continuous Profiling](#continuous-profiling)
6. [Distributed Tracing and OpenTelemetry](#distributed-tracing-and-opentelemetry)
7. [Goroutine Leak Hunting](#goroutine-leak-hunting)
8. [Live Debugging with delve](#live-debugging-with-delve)
9. [Debugging Production Crashes](#debugging-production-crashes)
10. [Core Dumps and Postmortem Analysis](#core-dumps-and-postmortem-analysis)
11. [Logging Architecture for Stacks](#logging-architecture-for-stacks)
12. [Designing for Diagnosability](#designing-for-diagnosability)
13. [Architectural Patterns](#architectural-patterns)
14. [Anti-Patterns at Scale](#anti-patterns-at-scale)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to optimize?" and "How to architect?"

At senior level, debugging is not "what command do I run when something breaks?" It is a **system property**: how quickly your team can move from "an alert fired" to "I know the root cause, here are the fix and the followups." Stack traces are one input among many — alongside metrics, logs, distributed traces, and live profiles. The decisions you make at architecture time decide whether the on-call engineer in 18 months has a fighting chance.

This file is about **production debugging architecture for Go services**: tooling, conventions, and the trade-offs that come with each.

---

## Debugging as a Production Discipline

Three properties separate a service that is debuggable from one that is not:

1. **Identity propagation.** Every request carries a `trace_id` (and often a `request_id`, `user_id`, `tenant_id`). Every log, span, and error decoration carries those identifiers. Without them, two events from the same request cannot be correlated.

2. **Boundaries that translate.** Each architectural layer (transport, domain, storage, edge) re-expresses errors in its own language. The HTTP boundary attaches a trace; the domain attaches an op name; the storage attaches a row identifier. By the time an error reaches a log, it carries a chain of explanatory context.

3. **Cheap evidence collection.** When something goes wrong you can take a goroutine dump, a 30-second CPU profile, a heap snapshot, and a slow-query report — all without a deploy and ideally without restarting. Tools wired in at design time are cheap; tools added during an outage are expensive.

A senior engineer reviews services for these three properties before reviewing them for performance.

---

## The Diagnostic Stack: Logs, Metrics, Traces, Stacks

Each tool answers a different question:

| Tool | Question | When to use |
|------|----------|-------------|
| **Metrics** | How often, how slow, how saturated? | Detection, alerting, trend analysis. |
| **Logs** | What happened to *this one* request/event? | Specific debugging, correlation. |
| **Traces** | How did a request flow across services? | Distributed-system causality. |
| **Stack traces** | Where in the code was a goroutine when X happened? | Crash diagnosis, deadlocks, unexpected blocks. |
| **Profiles** | Where is time/memory spent across many samples? | Performance, leak hunting. |

A failure typically traverses them in order: a metric alerts, you find the logs for that timeframe, you follow a trace ID to the span that misbehaved, you grab a goroutine dump or profile from the affected pod, and you sift through stacks to find the offending code.

The mistake is to over-rely on one. Metrics without logs become unactionable; logs without metrics become haystacks.

---

## pprof at Production Scale

`net/http/pprof` exposes a small set of HTTP endpoints. Wire them up:

```go
import _ "net/http/pprof"

// in main:
go func() {
    log.Println(http.ListenAndServe("localhost:6060", nil))
}()
```

Endpoints:

| Endpoint | What it gives |
|----------|---------------|
| `/debug/pprof/profile?seconds=30` | 30-second CPU profile. |
| `/debug/pprof/heap` | Heap snapshot — what is allocated *now*. |
| `/debug/pprof/heap?gc=1` | Force GC first, then snapshot — what is *retained*. |
| `/debug/pprof/allocs` | Cumulative allocations since process start. |
| `/debug/pprof/goroutine?debug=2` | Verbose stacks of every goroutine. |
| `/debug/pprof/block` | Blocking-operation stacks (must enable). |
| `/debug/pprof/mutex` | Contended mutex stacks (must enable). |
| `/debug/pprof/threadcreate` | OS thread creation. |
| `/debug/pprof/cmdline`, `/debug/pprof/symbol` | Auxiliary. |

Block and mutex profiles must be enabled at runtime:

```go
runtime.SetBlockProfileRate(1)    // every block event
runtime.SetMutexProfileFraction(1) // every contention
```

These have measurable overhead — set them low (`100`, `1000`) in production unless investigating a specific issue.

### Reading a profile

```bash
go tool pprof -http :8080 http://prod-host:6060/debug/pprof/heap
```

This opens an interactive web UI with flame graphs, source listings, and a top-N table. Three views to know:

- **Top** — largest contributors by self/cum.
- **Source** — annotated source listing, line by line.
- **Flame graph** — visual stack composition; wide bars = expensive call paths.

A senior engineer reads a flame graph the way a lawyer reads a brief: top to bottom, looking for the unfamiliar wide block.

### Common pprof discoveries

- A repeated `bytes.Buffer` allocation in a logger.
- A `regexp.MustCompile` inside a request handler instead of at package init.
- A goroutine creating leaks because its parent never cancels.
- A `sync.Map` becoming a hot mutex.
- An unbounded map growing one entry per request.

---

## Continuous Profiling

Periodic on-demand pprof works for known issues. For unknown ones, **continuous profiling** captures small samples around the clock, indexes them, and lets you query "show me CPU profiles from yesterday at 14:32 when the latency spike happened."

Tools:
- **Pyroscope / Grafana Phlare** — open-source, well-integrated with Prometheus/Grafana.
- **Google Cloud Profiler / Pixie / Datadog Continuous Profiler** — managed.
- **Polar Signals Parca** — eBPF-based, language-agnostic.

The Go SDKs are typically tiny — they hit the same `pprof` endpoints on a schedule and stream the data.

Continuous profiling pays off when you need to diagnose **transient** problems. It is what separates a 10-minute investigation from a 10-day one.

---

## Distributed Tracing and OpenTelemetry

Go services in any non-trivial architecture should produce **traces**. A trace is a tree of spans, each span representing a unit of work (HTTP request, DB query, external call). Each span carries timing, attributes, and — crucially — a *cause-effect* link to its parent.

### OpenTelemetry SDK in Go

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/codes"
)

func Handle(ctx context.Context, ...) (err error) {
    ctx, span := otel.Tracer("svc").Start(ctx, "Handle")
    defer span.End()

    if err := doStep(ctx); err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        return err
    }
    return nil
}
```

`span.RecordError(err)` attaches the error message — and, with the right options, a stack — to the span. Once the trace is shipped to Jaeger, Tempo, or another backend, you can click any failed span and see the full causality of the request.

### Why traces matter for stacks

Traces give you the *across-services* view. A stack trace shows where you stopped *inside* a single goroutine; a span tree shows how you got *to* that goroutine across an API boundary. A senior debugging story typically uses both: the trace narrows the failure to one service, the stack pinpoints the line.

### Stack on span vs. log

A common pattern: **record stack on the *server* side of the failing span**. The stack joins the trace as a span event:

```go
span.AddEvent("error", trace.WithAttributes(
    attribute.String("stack", string(debug.Stack())),
))
```

Tools then surface it at the span. This is far more useful than a flat log line because the stack is correlated with the rest of the trace.

---

## Goroutine Leak Hunting

A goroutine leak is a class of bug where a function spawns a goroutine that never exits. Symptoms:

- `runtime.NumGoroutine()` grows linearly with traffic.
- Memory grows linearly with goroutines.
- Eventually OOM.

Diagnostic protocol:

1. **Confirm the leak.** Plot `goroutines` over time. Steady growth = leak.
2. **Capture two dumps**, one early, one later. Diff them.
3. **Look for repeated `created by` lines.** That is the spawning function.
4. **Look at the wait state.** `chan receive` = the receiver is blocked because the producer never closed/sent. `select` = a select with a missing case. `sync.Mutex.Lock` = a lock holder did not release.

Snippet for a leak detector:

```go
var initialGoroutines int

func init() {
    initialGoroutines = runtime.NumGoroutine()
}

func checkLeak() {
    cur := runtime.NumGoroutine()
    if cur > initialGoroutines+1000 {
        buf := make([]byte, 1<<20)
        n := runtime.Stack(buf, true)
        log.Printf("possible leak: %d goroutines\n%s", cur, buf[:n])
    }
}
```

In tests, the [`go.uber.org/goleak`](https://github.com/uber-go/goleak) library wraps `TestMain` to fail any test that ends with extra goroutines. A worthwhile dependency in a service of any size.

---

## Live Debugging with delve

`dlv` is the de-facto Go debugger. Three modes worth knowing:

### Local

```bash
dlv debug ./cmd/myservice
(dlv) break main.handle
(dlv) continue
```

Source-level breakpoints, variables, goroutine inspection.

### Attach

```bash
dlv attach <pid>
```

Hooks into a *running* process. Read its variables. Set breakpoints. Continue.

### Remote (headless)

```bash
dlv --listen=:40000 --headless=true exec ./mybinary
```

A remote debugger listens; you connect from your IDE. The standard way to debug containerized programs.

### Useful commands

| Command | What it does |
|---------|--------------|
| `goroutines` | List all goroutines with their states. |
| `goroutine <id>` | Switch to that goroutine; its stack becomes "current". |
| `bt` (`stack`) | Print the current goroutine's stack. |
| `frame <n>` | Switch to frame `n`. |
| `print <expr>` | Evaluate an expression. |
| `set <var> = <expr>` | Modify a variable. |
| `breakpoint -hitcount <n>` | Conditional break by hit count. |

For production debugging without `dlv`, a goroutine dump remains the safest tool. `dlv attach` to a live production process is rarely worth the freeze.

---

## Debugging Production Crashes

A crash in production typically leaves three artifacts:

1. **Stderr / panic log** — the runtime's traceback.
2. **Logs** — your service's structured logs around the time of crash.
3. **Optional: core dump** — if `GOTRACEBACK=crash` is set on a Linux host with `ulimit -c` allowing one.

### What to do, in order

1. Find the panic message. That is the *what*.
2. Find the line listed in the trace top frame. That is the *where*.
3. Find the request/correlation IDs in surrounding logs. That is the *who*.
4. If the panic is reproducible, write a regression test using the offending input.
5. If not, instrument with `runtime/debug.SetPanicOnFault(true)` to catch sub-panic faults that Go normally swallows.

### `GOTRACEBACK=crash`

In a controlled environment (Linux, `ulimit -c unlimited`), this writes a core dump on panic. Then:

```bash
dlv core ./mybinary corefile
(dlv) goroutines
(dlv) goroutine <id>
(dlv) bt
```

You can examine the *exact state at crash*: variables, stack frames, all goroutines. This is the closest Go gets to gdb-style postmortem analysis.

---

## Core Dumps and Postmortem Analysis

In a containerized environment, three steps to enable core dumps:

1. **Allow core files.** `ulimit -c unlimited` and a writable `/proc/sys/kernel/core_pattern`.
2. **Set `GOTRACEBACK=crash`** in the container env.
3. **Persist the core file** to a volume that survives the container.

Then load with `dlv core`. Note that core files are large (multi-GB for big-heap services) and contain *everything*, including secrets in memory. Treat them as you would treat a database backup: encrypt, restrict, rotate.

For most services the goroutine dump from a panic log is enough; cores are the heavy artillery for "we cannot understand this otherwise" cases.

---

## Logging Architecture for Stacks

Senior systems separate *transport*, *enrichment*, and *destination*:

- **Capture (cheap)** — at the error origin, capture PCs and any structured context. No formatting yet.
- **Enrich** — at known boundaries (HTTP middleware, RPC interceptor, queue consumer), add the trace/request/user identifiers.
- **Transport** — the structured logger ships records to a backend (file, syslog, ELK, Loki, Datadog).
- **Destination** — the backend indexes by the structured fields, so engineers can query `level:error AND request_id:abc123 AND service:checkout`.

Stacks belong as a structured field, not as a free-form string in a flat message. A typical record:

```json
{
  "ts": "2026-05-05T12:34:56Z",
  "level": "error",
  "msg": "checkout failed",
  "service": "orders",
  "trace_id": "...",
  "request_id": "...",
  "user_id": 4711,
  "err": "validate: cart empty",
  "stack": "goroutine 47 [running]:\n..."
}
```

Now you can search by trace, by user, by service, and *also* read the stack when needed.

---

## Designing for Diagnosability

Five questions to ask early in a project:

1. **Where does a request ID enter the system?** Header? Generated? How is it propagated?
2. **What does an internal error look like?** Wrapped? Has a kind? Has a stack?
3. **Where do panics get recovered?** Top of every goroutine? Top of HTTP only? In workers?
4. **What does a goroutine dump look like for a healthy steady state?** (Should be small and well-named.)
5. **Where can an on-call engineer get a CPU profile in 30 seconds?** Production endpoint? CLI command? Sidecar?

Senior services answer all five before they ship. Junior services answer them during the first incident.

---

## Architectural Patterns

### Pattern: Sidecar diagnostic agent

A small companion process (or thread) on each instance exposes pprof, healthchecks, and goroutine dump endpoints. The main process focuses on serving traffic; the sidecar focuses on observability.

### Pattern: On-demand verbose logging

A control plane flips a flag (Kubernetes ConfigMap, feature flag service) that raises log verbosity for one tenant or one trace ID. Latency goes up, you get the data, you flip it back.

### Pattern: Crash with intent

Some classes of failures are best handled by panicking and letting the orchestrator restart the pod with a clean state. Make sure the panic logs the stack first, then exits. Coupled with a trip-wire on goroutine count or memory, this is a self-healing strategy.

### Pattern: Trace-aware error wrapping

Every wrap adds the current span ID. When the error reaches the boundary log, you can hop straight from log to trace UI.

```go
func WithSpan(ctx context.Context, err error) error {
    span := trace.SpanFromContext(ctx)
    return fmt.Errorf("[trace=%s] %w", span.SpanContext().TraceID(), err)
}
```

---

## Anti-Patterns at Scale

- **No request ID in logs.** Every error becomes "did this go wrong for that user, or for nobody, or for everyone?"
- **`log.Printf("%v", err)` everywhere.** No structure, no filtering, no correlation.
- **Stack on every error.** Wasted CPU, indexing pressure, and the data is mostly redundant.
- **No goroutine-leak detection.** Slow death by a thousand goroutines.
- **No pprof endpoints in production.** When it breaks at 3 AM, you have no telescope.
- **`GOTRACEBACK=none` in containers.** A panic disappears with no trace.
- **Catching `panic` and continuing in a worker pool**, masking systematic bugs.
- **Trusting the trace alone.** Without metrics you do not know how often the failure occurs; without logs you do not know which user.
- **Treating tests as the only debugging tool.** Production systems fail in ways no test reproduces.
- **Same log message in five layers.** Search for "request failed" returns 50,000 lines and no insight.

---

## Summary

At senior level, stack traces are one slice of a larger diagnostic ecosystem: metrics, logs, traces, profiles, dumps, debuggers. Each tool answers a different question; senior engineers wire them together so that a failure flows naturally from "alert fired" to "root cause known." Pprof endpoints, structured logs with correlation IDs, OpenTelemetry, goroutine dumps, on-demand profiling, core dumps for the rare case — these are the habits that make a Go service *operable*. The keystroke-level details from junior and middle level matter; the discipline of wiring them into a coherent story is what makes a senior.

---

## Further Reading

- [Go Diagnostics Guide](https://go.dev/doc/diagnostics)
- [Profiling Go Programs (Russ Cox)](https://go.dev/blog/pprof)
- [Continuous Profiling — Pyroscope](https://pyroscope.io/)
- [OpenTelemetry Go SDK](https://opentelemetry.io/docs/instrumentation/go/)
- [github.com/uber-go/goleak](https://github.com/uber-go/goleak)
- [Delve Debugger](https://github.com/go-delve/delve)
- [Postmortem of a goroutine leak](https://www.ardanlabs.com/blog/) — search "goroutine leak" on Ardan Labs
- [Google SRE — Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)
