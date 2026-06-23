# Scheduler Tracing — Senior Level

[Back to index](index.md)

## Table of Contents
1. [Introduction](#introduction)
2. [Custom Annotations Overview](#custom-annotations-overview)
3. [`trace.WithRegion` for Code Paths](#tracewithregion-for-code-paths)
4. [`trace.NewTask` for Logical Operations](#tracenewtask-for-logical-operations)
5. [`trace.Log` for Event Data](#tracelog-for-event-data)
6. [Task and Region Together: A Request Lifecycle](#task-and-region-together-a-request-lifecycle)
7. [Cost of Annotations](#cost-of-annotations)
8. [Integrating with Distributed Tracing](#integrating-with-distributed-tracing)
9. [Sampled Tracing in Production](#sampled-tracing-in-production)
10. [Diagnosing Tail Latency Caused by GC Stalls](#diagnosing-tail-latency-caused-by-gc-stalls)
11. [Diagnosing a Stuck P](#diagnosing-a-stuck-p)
12. [Diagnosing a Syscall Storm](#diagnosing-a-syscall-storm)
13. [Diagnosing Netpoller Saturation](#diagnosing-netpoller-saturation)
14. [`runtime/metrics` Histogram Arithmetic](#runtimemetrics-histogram-arithmetic)
15. [Trace-Driven Capacity Decisions](#trace-driven-capacity-decisions)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

Junior gave you the four scheduler-tracing tools and a vocabulary. Middle taught the UI in depth. Senior is where you become the engineer who:

- Adds custom regions and tasks so the next person on the team can read a trace in seconds.
- Operates a sampled tracing pipeline in production without overhead concerns.
- Diagnoses GC-induced tail latency from first principles.
- Decides whether to raise `GOMAXPROCS`, reduce allocations, or shard the work — based on data.

The chapter is built around four real diagnostic narratives. Each follows the same pattern: symptom, hypothesis, trace, conclusion.

---

## Custom Annotations Overview

`runtime/trace` exposes three annotation primitives:

| Primitive | Scope | Function | Effect |
|-----------|-------|----------|--------|
| Region | Function-local | `trace.WithRegion(ctx, name, fn)` | Wraps `fn` with begin/end events tagged `name`. |
| Task | Logical operation, cross-goroutine | `trace.NewTask(ctx, name)` | Issues a task id; ends when `task.End()` is called. Survives across goroutines. |
| Log | Point-in-time event | `trace.Log(ctx, cat, msg)` | Emits a tagged log entry. |

The three compose: tasks contain regions and logs. The viewer renders them in the **User-defined tasks** and **User-defined regions** views and inline in the timeline.

Annotation cost: zero if tracing is off (early-return on a global atomic check), otherwise a few hundred nanoseconds. It is safe to leave in shipping code.

---

## `trace.WithRegion` for Code Paths

Regions answer the question "how long does *this code* take?" with the trace's per-G context.

```go
package server

import (
    "context"
    "runtime/trace"
)

func handle(ctx context.Context, req *Request) (*Response, error) {
    var resp *Response
    var err error
    trace.WithRegion(ctx, "handle", func() {
        trace.WithRegion(ctx, "parse", func() {
            req.parsed, err = parse(req.raw)
        })
        if err != nil {
            return
        }
        trace.WithRegion(ctx, "lookup", func() {
            resp, err = lookup(ctx, req.parsed)
        })
        if err != nil {
            return
        }
        trace.WithRegion(ctx, "encode", func() {
            err = encode(resp)
        })
    })
    return resp, err
}
```

The regions form a stack on the trace timeline. In the viewer's **User-defined regions** view, you can sort by aggregate time:

```
Region        Count  Total      Avg
handle        2400   3.2s       1.3ms
  parse       2400   0.2s       0.08ms
  lookup      2400   2.6s       1.1ms
  encode      2400   0.4s       0.17ms
```

That breakdown is impossible from CPU profiles alone — profiles attribute by function, not by logical phase.

Region rules:

- Regions are per-G. They must begin and end on the same goroutine.
- Nesting is fine; siblings can overlap freely with sibling regions on other Gs.
- The closure form (`WithRegion(ctx, name, fn)`) is preferred. The raw `StartRegion`/`End` form exists for cases where you cannot use a closure, but you must call `End` on the same G that called `StartRegion`.

---

## `trace.NewTask` for Logical Operations

A task is a **logical operation that may span many goroutines**: one HTTP request, one batch processing job, one cron tick. Tasks have a beginning, an end, and a unique id that survives across `go` statements.

```go
func handleRequest(ctx context.Context, req *Request) error {
    ctx, task := trace.NewTask(ctx, "request")
    defer task.End()

    parsed, err := parse(ctx, req.raw)
    if err != nil {
        return err
    }

    var wg sync.WaitGroup
    errs := make(chan error, 2)
    wg.Add(2)
    go func() {
        defer wg.Done()
        errs <- lookupA(ctx, parsed) // ctx carries the task; spans across go.
    }()
    go func() {
        defer wg.Done()
        errs <- lookupB(ctx, parsed)
    }()
    wg.Wait()
    close(errs)
    for e := range errs {
        if e != nil {
            return e
        }
    }
    return respond(ctx, parsed)
}
```

In the **User-defined tasks** view, each `request` task appears as one row, with its total duration, child regions, and event log. Sort by duration to find the slow ones.

The `ctx` returned from `NewTask` is the **only** carrier of the task identity. If you do not propagate `ctx`, the trace does not know which goroutine belongs to which task. Discipline: every function on the request path must accept and forward `context.Context`.

---

## `trace.Log` for Event Data

Logs are tagged messages emitted at a point in time, attached to the current task.

```go
trace.Logf(ctx, "stage", "parsed bytes=%d schema=%s", n, schemaID)
trace.Logf(ctx, "stage", "lookup ms=%d hits=%d", ms, hits)
```

The first argument is a category string (used by the UI to group); the second is the message. Use `Logf` for formatted messages.

Logs are the bridge between traces and structured logging. In the **User-defined tasks** view, clicking a task expands the log entries in chronological order. If you tag with the same category names you use in your structured logger, the trace becomes a navigable log.

Best practice categories: `stage` for lifecycle events, `decision` for branch points, `error` for failures (paired with the actual error logger), `metric` for one-off counters.

---

## Task and Region Together: A Request Lifecycle

The combination of task + region + log instruments a request fully.

```go
func handleRequest(ctx context.Context, req *Request) (*Response, error) {
    ctx, task := trace.NewTask(ctx, "handleRequest")
    defer task.End()
    trace.Logf(ctx, "stage", "received bytes=%d", len(req.raw))

    var resp *Response
    var err error
    trace.WithRegion(ctx, "parse", func() {
        resp, err = parse(req.raw)
    })
    if err != nil {
        trace.Logf(ctx, "error", "parse failed: %v", err)
        return nil, err
    }

    trace.WithRegion(ctx, "fanout", func() {
        var wg sync.WaitGroup
        for _, shard := range resp.Shards {
            wg.Add(1)
            go func(s Shard) {
                defer wg.Done()
                trace.WithRegion(ctx, "shard", func() {
                    queryShard(ctx, s)
                })
            }(shard)
        }
        wg.Wait()
    })

    trace.WithRegion(ctx, "encode", func() {
        err = encode(resp)
    })
    if err != nil {
        trace.Logf(ctx, "error", "encode failed: %v", err)
    }
    return resp, err
}
```

In the trace UI, the task `handleRequest` shows a tree:

```
handleRequest (1.4ms)
  parse           (0.1ms)
  fanout          (1.2ms)
    shard         (0.6ms)   on G201
    shard         (0.8ms)   on G202
    shard         (0.4ms)   on G203
  encode          (0.1ms)
```

You can see in one click: parsing was fast, fanout did parallel shard queries on three goroutines, encoding was fast. The slow shard query points you to the right place.

---

## Cost of Annotations

The compile-time check is the magic. Each annotation begins with:

```go
if !trace.IsEnabled() {
    return
}
```

When tracing is off (the common case), the call inlines to a single atomic load and a branch. The overhead is single-digit nanoseconds per annotation. Ship annotations in production.

When tracing is on, each region or task takes ~150–300ns. A 1ms request with 8 regions and 2 logs adds ~3µs — about 0.3% overhead.

Real-world counts:

- Trivial annotation (one task per request, no regions): ~zero.
- Modest annotation (one task, ~10 regions): ~0.5% overhead under trace.
- Heavy annotation (one task, ~100 regions, many logs): can hit 5–10%.

If you have a hot loop and you want to annotate each iteration, sample: only annotate one in 1000 iterations.

---

## Integrating with Distributed Tracing

Many services already run OpenTelemetry, Jaeger, or Zipkin. The relationship to `runtime/trace`:

- **OpenTelemetry traces** describe distributed work (this service calls that service). They cross process boundaries.
- **`runtime/trace`** describes intra-process scheduler behaviour. It does not cross process boundaries.

They complement each other. Pattern: when an OTel span enters your handler, start a `runtime/trace` task too:

```go
func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx, span := tracer.Start(r.Context(), "handle")
        defer span.End()

        ctx, task := trace.NewTask(ctx, span.SpanContext().SpanID().String())
        defer task.End()

        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

Now the task name in `runtime/trace` is the OTel span id. When you capture a trace during an investigation, you can correlate to your distributed-tracing backend by id.

---

## Sampled Tracing in Production

Always-on tracing is too expensive. Always-off tracing is useless when an incident strikes. Sampled tracing is the production answer.

The model: every few minutes, capture a short trace, save it to local disk or upload it to object storage. When you need to investigate, pull the most recent samples for the affected pod.

```go
package contrace

import (
    "context"
    "fmt"
    "log"
    "os"
    "path/filepath"
    "runtime/trace"
    "time"
)

func RunSampledLoop(ctx context.Context, dir string, every, dur time.Duration) {
    ticker := time.NewTicker(every)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            captureOne(dir, dur)
        }
    }
}

func captureOne(dir string, dur time.Duration) {
    ts := time.Now().UTC().Format("20060102T150405Z")
    path := filepath.Join(dir, fmt.Sprintf("trace-%s.out", ts))
    f, err := os.Create(path)
    if err != nil {
        log.Printf("contrace: create: %v", err)
        return
    }
    defer f.Close()
    if err := trace.Start(f); err != nil {
        log.Printf("contrace: start: %v", err)
        return
    }
    time.Sleep(dur)
    trace.Stop()
}
```

Reasonable defaults: `every=5*time.Minute`, `dur=2*time.Second`. That gives you 24 traces per service per hour at ~1% sustained overhead. Combined with a 7-day retention policy and a few hundred MB of disk, you have a rolling forensic record.

Production discipline:

- Disable when CPU is critical. Listen for a signal or read a flag to suspend the sampling loop.
- Cap disk usage. Rotate when the directory exceeds N bytes.
- Tag the filename with hostname and process id; multiple replicas need distinct files.
- For uploads, write to a `tmp-*.out`, fsync, then rename. Half-written files crash `go tool trace`.

---

## Diagnosing Tail Latency Caused by GC Stalls

The most common scheduler-related production complaint is "p99 spiked." Often the cause is GC.

### Symptom

Service metrics show p50 latency at 10ms but p99 at 250ms. Throughput is healthy. No upstream errors.

### Hypothesis

GC mark-assist is stealing CPU from request goroutines during high-allocation periods.

### Plan

1. Enable `gctrace=1` for one minute. Observe pause and mark times.
2. Take a 5-second `runtime/trace` during a known peak.
3. Open **Minimum mutator utilisation** view.
4. Open **View trace**; zoom on a slow request.

### Walk-through

`gctrace=1` shows lines like:

```
gc 1024 @120.0s 8%: 0.05+12.3+0.04 ms clock, 0.4+24/35/87+0.32 ms cpu, 240->250->130 MB, 256 MB goal, 8 P
gc 1025 @120.5s 9%: 0.04+18.6+0.05 ms clock, 0.32+30/45/100+0.4 ms cpu, 250->260->140 MB, 252 MB goal, 8 P
gc 1026 @121.0s 10%: 0.04+21.0+0.05 ms clock, 0.32+35/52/108+0.4 ms cpu, 260->270->145 MB, 256 MB goal, 8 P
```

GC running at 8–10% of CPU, mark phase ~12–21 ms per cycle, GC every 500ms. The `cpu` column shows mark-assist time: `35/52/108` means 35ms in mark-prep, 52ms in mark, 108ms in mark-assist across all Ps. The last number, mark-assist, is **stolen from your code**.

The trace UI **Minimum mutator utilisation** shows:

```
window=1ms:   MMU=0.20    -- in some 1ms windows, GC took 80% of CPU.
window=10ms:  MMU=0.55
window=100ms: MMU=0.85
```

That confirms: 1ms windows during mark-assist have only 20% CPU for user code. A 10ms request that requires 100% CPU for 10ms across one P would, in such a window, take 50ms.

### Conclusion

Reduce allocation churn or raise `GOGC`. The trace timeline shows red mark-assist stripes overlaying request goroutines during the slow tail. Once allocations drop or `GOGC` rises (allowing GC less often but accepting higher heap), the red stripes thin and p99 falls.

### Fix verification

After rolling the fix, capture the same trace shape. The MMU curve should rise at the 1ms point; the mark-assist time in `gctrace` should drop; the application p99 should fall.

---

## Diagnosing a Stuck P

A P that has been donated to a syscall and not reclaimed for seconds is rare but happens.

### Symptom

Service is throughput-bound. `gomaxprocs=8` but the load tester only saturates 7 cores. CPU appears unused.

### Trace

Capture both schedtrace and runtime/trace.

```
SCHED 1000ms: gomaxprocs=8 idleprocs=0 threads=24 ... P5 status=2 syscalltick=1
SCHED 2000ms: gomaxprocs=8 idleprocs=0 threads=24 ... P5 status=2 syscalltick=1
SCHED 3000ms: gomaxprocs=8 idleprocs=0 threads=24 ... P5 status=2 syscalltick=1
```

`scheddetail` shows P5 in `_Psyscall` with `syscalltick=1` and no change across samples. Same M is bound to P5 across all lines.

In the runtime trace **View trace by thread**, the M associated with P5 is just one continuous syscall lane, no Go execution.

### Conclusion

A cgo call is blocked in a kernel routine that does not return. Either:

- A buggy native library is sleeping forever.
- An ioctl on a misbehaving device.
- A `gettimeofday` storm (rare on modern kernels).

Sysmon would normally retake the P, but sysmon does not preempt cgo. Once the cgo call returns, the M re-enters Go code; until then, the P is effectively lost.

### Fix

Replace the blocking cgo call with a non-blocking variant, or wrap it in a budgeted timeout. If the library you depend on cannot be fixed, use `runtime.LockOSThread` plus a watchdog goroutine that kills the M (no clean API in standard library; this is a code-smell).

---

## Diagnosing a Syscall Storm

### Symptom

`runtime.NumGoroutine()` is normal. `threads` from schedtrace climbs into the hundreds. CPU usage healthy. Latency tail bad.

### Trace

`schedtrace=1000,scheddetail=1`:

```
SCHED 1000ms: threads=10  ...
SCHED 2000ms: threads=50  ...
SCHED 3000ms: threads=200 ...
SCHED 4000ms: threads=200 ...
```

`scheddetail` reveals each M with `curg=N` in a syscall. The G ids correspond to file-read or DNS-lookup goroutines.

The runtime trace **Syscall blocking profile** shows:

```
Function                Total
net.lookupHostFD        12.3s
os.(*File).Read         2.4s
```

DNS lookups dominate.

### Conclusion

The service is doing 1000 DNS lookups per second to resolve outbound calls; each lookup is a blocking syscall (cgo via the system resolver) and donates its P. Each donation causes an idle M to wake or a new M to spawn.

### Fix

Pre-resolve the hostnames at startup; cache results for the TTL of the record; use `net.Resolver.PreferGo = true` to use Go's pure-Go resolver, which is non-blocking.

---

## Diagnosing Netpoller Saturation

### Symptom

Many Gs in `_Gwaiting(IO wait)`. Run queues empty. CPU usage low. Throughput stuck.

### Trace

The `scheddetail` listing shows thousands of `IO wait` Gs. The runtime trace **Network blocking profile** confirms `net.(*conn).Read` is the dominant call site.

The trace timeline shows wide white gaps on P lanes — Ps idle, no Gs runnable.

### Conclusion

The scheduler is fine. The bottleneck is the network: backend latency, connection pool exhaustion, or TCP buffers. The scheduler trace ruled out the scheduler, which is the win.

### Fix

Outside the scope of scheduler tuning: enlarge connection pools, tune TCP, fix the backend. The trace told you where not to look.

---

## `runtime/metrics` Histogram Arithmetic

`/sched/latencies:seconds` is a histogram. To export p50/p99/p999 you need to do a little math.

```go
import "runtime/metrics"

func schedLatencyPercentiles() (p50, p99, p999 float64) {
    s := metrics.Sample{Name: "/sched/latencies:seconds"}
    metrics.Read([]metrics.Sample{s})
    h := s.Value.Float64Histogram()

    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    if total == 0 {
        return
    }

    p50target := total / 2
    p99target := total - total/100
    p999target := total - total/1000

    var cumulative uint64
    for i, c := range h.Counts {
        cumulative += c
        upper := h.Buckets[i+1]
        if p50 == 0 && cumulative >= p50target {
            p50 = upper
        }
        if p99 == 0 && cumulative >= p99target {
            p99 = upper
        }
        if p999 == 0 && cumulative >= p999target {
            p999 = upper
        }
    }
    return
}
```

This gives you upper-bound estimates of each percentile from the histogram. For most alerting, this is enough.

To get a delta between two reads (for rate-of-change alerts), subtract the count arrays:

```go
type histogramSnap struct {
    buckets []float64
    counts  []uint64
}

func (a histogramSnap) Sub(b histogramSnap) histogramSnap {
    out := histogramSnap{buckets: a.buckets, counts: make([]uint64, len(a.counts))}
    for i := range a.counts {
        out.counts[i] = a.counts[i] - b.counts[i]
    }
    return out
}
```

The buckets are stable across reads, so subtraction is well-defined.

---

## Trace-Driven Capacity Decisions

When you are deciding whether to raise `GOMAXPROCS`, scale the pod, or shard the work, a trace gives data instead of guesses.

### Question: should I raise `GOMAXPROCS`?

Capture a trace under your load.

- **Procs running** counter at peak < `GOMAXPROCS`: no, the scheduler is not the bottleneck. Look elsewhere.
- **Procs running** at peak == `GOMAXPROCS` and scheduler-latency p99 > 10ms: yes, scale CPU.
- **Procs running** at peak == `GOMAXPROCS` and scheduler-latency p99 < 1ms: probably not; raising won't help.

### Question: should I shard the work into more goroutines?

- Per-P runqueue length spikes near 256 (the max): yes, but check carefully — these are runnable Gs queueing on one P. Adding more concurrency creates more.
- Per-P queues short, scheduler-latency p99 high: the issue is somewhere else (GC, syscalls, contention).

### Question: should I move to fewer goroutines?

If `Goroutines` counter climbs to tens of thousands but most are waiting on netpoll, your model is wasteful. Consider a worker-pool model with bounded concurrency. The trace will show the change immediately: goroutine count drops, scheduling stays smooth.

---

## Self-Assessment

- [ ] I add `trace.WithRegion` around each major phase of a request handler.
- [ ] I propagate `context.Context` everywhere so `trace.NewTask` survives across goroutines.
- [ ] I use `trace.Log` to record decision points and state.
- [ ] I operate a sampled tracing loop in at least one service.
- [ ] I diagnosed at least one production incident with `go tool trace`.
- [ ] I can compute p99 from `/sched/latencies:seconds`.
- [ ] I know the four scheduler patterns (GC stall, stuck P, syscall storm, netpoller saturation) by sight.
- [ ] I make capacity decisions from trace data, not guesses.

---

## Summary

Senior-level scheduler tracing is about *instrumentation* and *interpretation*. Instrumentation: tasks for logical operations, regions for code paths, logs for events, in shipping code. Interpretation: four diagnostic narratives — GC tail, stuck P, syscall storm, netpoller saturation — each followed end-to-end with trace artifacts. Sampled tracing in production gives you forensic data for free. Histograms from `runtime/metrics` feed alerts. The professional level continues with the binary format, the data model, and what to build when the standard tooling stops being enough.
