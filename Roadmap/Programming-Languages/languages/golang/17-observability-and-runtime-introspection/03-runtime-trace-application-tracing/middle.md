# `runtime/trace` & Application Tracing — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Three Capture Mechanisms in Depth](#the-three-capture-mechanisms-in-depth)
3. [Navigating `go tool trace`](#navigating-go-tool-trace)
4. [User Annotations: Tasks, Regions, and Logs](#user-annotations-tasks-regions-and-logs)
5. [A Complete Annotated Example](#a-complete-annotated-example)
6. [How Tasks and Regions Appear in the Viewer](#how-tasks-and-regions-appear-in-the-viewer)
7. [`runtime/trace` vs `runtime/pprof`, Precisely](#runtimetrace-vs-runtimepprof-precisely)
8. [Reading the Blocking Profiles](#reading-the-blocking-profiles)
9. [Trace Size and Overhead](#trace-size-and-overhead)
10. [Intra-Process Trace vs Distributed Tracing](#intra-process-trace-vs-distributed-tracing)
11. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
12. [Best Practices](#best-practices)
13. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

At the junior level you learned *what* the execution tracer records and *how* to capture and open a trace. The middle-level questions are: how do you make the trace tell **your** story rather than just the scheduler's, and how do you read the views that matter?

The answer to the first is **user annotations** — `trace.NewTask`, `trace.WithRegion`/`trace.StartRegion`, and `trace.Log`. These let you carve the raw event stream into named, meaningful units: "this is one checkout request," "this is the database phase of that request." Without annotations the trace is a sea of anonymous goroutines; with them, it becomes a map of *your* application's logical work.

After reading this you will:
- Capture traces deliberately for tests, code, and live servers, and know the trade-offs
- Navigate every major view in `go tool trace` and know which answers which question
- Instrument code with tasks, regions, and logs, and thread the `context.Context` correctly
- See those annotations in the viewer's task/region analysis
- Read the four blocking profiles fluently
- Articulate exactly why `runtime/trace` is not distributed tracing

---

## The Three Capture Mechanisms in Depth

### In-code (`trace.Start`/`trace.Stop`)

The lowest-level API. `trace.Start(w io.Writer)` begins recording to `w`; `trace.Stop()` flushes and stops. Use this when you want to trace a *specific phase*:

```go
trace.Start(f)
processBatch()       // recorded
trace.Stop()
```

Only one trace can be active per process. `trace.Start` returns an error if a trace is already running. Pair it with `defer trace.Stop()` and remember that `os.Exit` skips deferred calls.

### Via `go test -trace`

```bash
go test -trace=trace.out -run=TestPipeline ./pipeline
```

The testing framework calls `trace.Start`/`Stop` around the entire test binary run. Cleanest for reproducible local investigations — but note the framework owns the tracer, so your code must **not** also call `trace.Start` (that would be the second tracer and would error).

### Via `net/http/pprof`

Importing the package for its side effects registers handlers, including `/debug/pprof/trace`:

```go
import _ "net/http/pprof"
```

```bash
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=5'
```

The `seconds` parameter bounds the window. This is the production capture path: a live, running server with no code change beyond the import. Keep the endpoint private.

---

## Navigating `go tool trace`

`go tool trace trace.out` serves a local web UI. The landing page links, ranked by usefulness:

- **View trace by proc / by thread** — the timeline. Lanes per P (or per OS thread), coloured bars for each goroutine, plus GC, network poller, and syscall activity. Zoom with `w`/`s`, pan with `a`/`d`. This is where you *see* a GC pause line up with a latency spike.
- **Goroutine analysis** — groups goroutines by their top function and breaks down total time into execution, scheduler wait, block (sync/network/syscall/GC), and more. The fastest way to find *what kind* of waiting dominates.
- **Scheduler latency profile** — a pprof-style profile of time spent *runnable but not running*. High values mean CPU starvation: too many goroutines for too few Ps.
- **Network / Synchronization / Syscall blocking profiles** — pprof-style profiles attributing blocked time to the call sites that blocked. The synchronization profile is your lock-contention finder.
- **User-defined tasks / User-defined regions** — appear once you add annotations (next section). These let you analyse time by *your* logical units.

A practical reading order: start at goroutine analysis to learn *what kind* of time dominates, jump to the matching blocking profile to learn *where*, then open the timeline to *see* it in context.

---

## User Annotations: Tasks, Regions, and Logs

The raw trace knows about goroutines; it does not know about *your* concepts ("request", "job", "query"). The `runtime/trace` annotation API closes that gap. There are three primitives.

### Tasks — logical operations that may span goroutines

A **task** is a logical unit of work that can cross goroutine boundaries — a request, a job, a transaction. You create one and carry it via `context.Context`:

```go
ctx, task := trace.NewTask(ctx, "checkout")
defer task.End()
```

`NewTask` returns a derived `ctx` and a `*trace.Task`. The task spans from `NewTask` to `task.End()`, and any region or log created with the *derived ctx* is attributed to this task — even on a different goroutine, as long as the ctx is threaded through. This is the key idea: **tasks are propagated by context**, exactly like cancellation.

### Regions — a span of code on one goroutine

A **region** marks a contiguous span of execution within a single goroutine:

```go
trace.WithRegion(ctx, "db.query", func() {
    rows = queryDatabase()
})
```

Or the manual form when the work is not naturally a closure:

```go
r := trace.StartRegion(ctx, "encode")
encode(out)
r.End()
```

Regions must start and end on the **same goroutine** and must be properly nested (LIFO). Pass the task-derived `ctx` so the region is attributed to the task.

### Logs — point-in-time events

`trace.Log`/`trace.Logf` emit an instantaneous keyed event:

```go
trace.Log(ctx, "cache", "miss")
trace.Logf(ctx, "rows", "fetched %d", n)
```

Logs appear as markers in the timeline and in the task's event list. Use them to annotate decisions ("cache miss", "retry #2"), not to dump large payloads.

---

## A Complete Annotated Example

A small program that traces one logical "request" composed of two phases, with the phases running on different goroutines but all attributed to the same task:

```go
package main

import (
    "context"
    "fmt"
    "os"
    "runtime/trace"
    "sync"
    "time"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        panic(err)
    }
    defer f.Close()
    if err := trace.Start(f); err != nil {
        panic(err)
    }
    defer trace.Stop()

    handleRequest(context.Background(), "req-42")
}

func handleRequest(ctx context.Context, id string) {
    // One logical task, propagated via ctx.
    ctx, task := trace.NewTask(ctx, "request")
    defer task.End()
    trace.Logf(ctx, "request", "id=%s", id)

    var wg sync.WaitGroup
    wg.Add(2)

    // Phase 1 runs on its own goroutine but shares the task ctx.
    go func() {
        defer wg.Done()
        trace.WithRegion(ctx, "fetch", func() {
            time.Sleep(20 * time.Millisecond) // pretend I/O
        })
    }()

    // Phase 2 runs on another goroutine, same task.
    go func() {
        defer wg.Done()
        r := trace.StartRegion(ctx, "render")
        time.Sleep(10 * time.Millisecond)
        r.End()
    }()

    wg.Wait()
    fmt.Println("done")
}
```

Run and view:

```bash
go run .
go tool trace trace.out
```

In the viewer, open **User-defined tasks**. You will find one `request` task. Drilling into it shows both the `fetch` and `render` regions — *even though they ran on different goroutines* — because the task `ctx` was threaded into both. That cross-goroutine grouping is exactly what tasks are for.

---

## How Tasks and Regions Appear in the Viewer

- **User-defined tasks** view: a list of task instances, each with a total duration (from `NewTask` to `End`), the goroutines involved, the regions inside, and any logs. Latency-distribution histograms per task name help you spot the slow instances.
- **User-defined regions** view: aggregates region durations by name across all tasks, so you can answer "how long does the `db.query` region take, typically and at the tail?"
- **In the timeline:** tasks and regions render as labelled overlays on the goroutine lanes, and logs render as point markers. You can visually line up a slow `db.query` region with a GC pause happening at the same instant.

This is the payoff of annotation: the trace stops being "anonymous goroutine soup" and becomes "request → fetch phase → render phase," in *your* vocabulary, with scheduler and GC reality underneath.

---

## `runtime/trace` vs `runtime/pprof`, Precisely

| Aspect | `runtime/trace` | `runtime/pprof` |
|--------|-----------------|-----------------|
| Output | Timeline of timestamped events | Statistical profile (aggregated samples) |
| Mechanism | Records every scheduling/runtime event | Samples stacks (CPU) or instruments allocations/blocks |
| Reveals | When/why goroutines run, block, are preempted; GC timing | Where CPU/memory/lock time accumulates |
| Viewer | `go tool trace` | `go tool pprof` |
| Cost | Higher (every event); short windows | Lower (sampled); can run longer |
| User annotation | Tasks, regions, logs | Profile labels (`pprof.Labels`) |
| Best for | Latency, contention, scheduling, GC | CPU hotspots, allocation hotspots |

A subtle connection: `runtime/pprof` has its own *labels* mechanism for tagging CPU samples, and `runtime/trace` has *tasks/regions/logs*. They are different systems with a similar spirit. The trace's annotations live on a timeline; pprof's labels live on aggregated samples.

---

## Reading the Blocking Profiles

`go tool trace` derives four blocking profiles from the event stream. Each answers "where did goroutines lose time *not running*?"

- **Scheduler latency profile** — time goroutines spent *runnable but not scheduled*. Dominated by call sites that spawn lots of goroutines or by CPU saturation. Fix: fewer goroutines, more Ps (cores), or less per-goroutine work.
- **Synchronization blocking profile** — time blocked on channels and `sync` primitives. Your lock-contention detector. A fat entry on `(*Mutex).Lock` means a hot lock.
- **Network blocking profile** — time blocked in the network poller (socket reads/writes). Points at slow upstreams or saturated connections.
- **Syscall blocking profile** — time blocked inside syscalls (file I/O, some `cgo`). Points at disk or blocking C calls.

These are the highest-leverage views in the whole tool: they convert a wall of timeline bars into "X% of lost time is *here* in your code."

---

## Trace Size and Overhead

A trace records *every* scheduling event, so size scales with goroutine activity, not wall-clock time alone. A busy server can emit hundreds of MB in seconds. Consequences:

- **Bound the window.** A few seconds is almost always enough to see a pattern. `?seconds=5` on the HTTP endpoint, or a tight `Start`/`Stop` around one phase.
- **Overhead is real but small since Go 1.21.** The tracer rewrite made per-event recording much cheaper and removed most of the stop-the-world cost at trace start. Still, do not run it continuously in hot paths — capture on demand.
- **Disk and memory.** Writing the trace consumes I/O bandwidth; very large traces are also slow for `go tool trace` to parse. Smaller is better for both capture and analysis.

If you need *continuous* recording with on-demand snapshots, that is the **flight recorder** — a senior-level topic that keeps a rolling in-memory window instead of writing everything.

---

## Intra-Process Trace vs Distributed Tracing

This deserves its own section because the confusion is so common and so costly.

- **`runtime/trace` is intra-process.** It records the Go scheduler of *one* process. Its "tasks" and "regions" are local annotations on that one process's timeline. A slow downstream call appears only as "this goroutine blocked on a network read for 300ms."
- **Distributed tracing (OpenTelemetry, Jaeger, Zipkin) is cross-process.** It propagates a trace/span context over the wire (HTTP headers, gRPC metadata) so that a single logical request is stitched together across many services. Its "spans" cross process and machine boundaries.

They share the word "trace" and even the word "span/region/task," but they operate at completely different scales. Use `runtime/trace` to understand *why one process is slow internally* (scheduling, GC, contention). Use OpenTelemetry to understand *which service in a chain is slow*. See [04-opentelemetry-in-go](../04-opentelemetry-in-go/middle.md). They compose: OpenTelemetry tells you "service B is slow," then `runtime/trace` on service B tells you "because of lock contention on the cache mutex."

---

## Common Errors and Their Real Causes

### "tracing already enabled"

Two tracers at once. Usually: code calls `trace.Start` *and* runs under `go test -trace`, or two goroutines race to start a trace. One tracer per process.

### Empty / truncated trace file

`trace.Stop()` never ran. The program exited via `os.Exit`, a `log.Fatal`, or an unrecovered panic before the deferred stop. Stop the trace explicitly before any forced exit.

### Region "not ended on the same goroutine" / mismatched nesting

`StartRegion`/`End` crossed a goroutine boundary or were not LIFO-nested. Regions are single-goroutine and must nest like a stack. For cross-goroutine grouping, use a *task* (ctx-propagated), not a region.

### Annotations missing in the viewer

Almost always: the task-derived `ctx` was not threaded through. If you call `NewTask` and then call regions/logs with the *original* ctx (not the returned one), they are not attributed to the task. Always use the `ctx` that `NewTask` returns.

### `go tool trace` is slow or refuses the file

Trace is enormous, or the Go version that captured it differs from the toolchain viewing it. Capture shorter windows and match versions.

---

## Best Practices

1. **Annotate by your domain.** Wrap each request/job in a `trace.NewTask`; wrap meaningful phases in regions. The viewer becomes a map of *your* work.
2. **Thread the task `ctx` everywhere.** It is the propagation mechanism; the original ctx breaks attribution.
3. **Regions stay on one goroutine; tasks cross goroutines.** Pick the right primitive.
4. **Keep logs cheap and non-sensitive.** Short keys, no PII, no large payloads.
5. **Capture short windows during the symptom.** A trace of a healthy period teaches little.
6. **Start your analysis at goroutine analysis + blocking profiles**, then drill into the timeline.
7. **Match Go versions** for capture and `go tool trace`.
8. **Never confuse this with OpenTelemetry** — intra-process scheduler vs cross-service spans.

---

## Pitfalls You Will Meet in Real Projects

- **`defer task.End()` forgotten** — the task appears to run until trace end, skewing durations.
- **`os.Exit` in `main`** — deferred `trace.Stop()` and `task.End()` never run; the file is unusable.
- **Reusing one task across unrelated requests** — durations and region groupings become meaningless. One task per logical operation.
- **Regions started but not ended on error paths** — wrap with `defer r.End()` or use the closure form `trace.WithRegion`.
- **Tracing the whole program** when you wanted one request — huge file, lost signal.
- **Logging secrets** into `trace.Log` — the trace file is an artifact someone will open.
- **Assuming the trace shows downstream services** — it stops at your process boundary.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Explain when to use each of the three capture mechanisms
- [ ] Navigate to the right `go tool trace` view for a given symptom
- [ ] Create a task with `trace.NewTask` and explain ctx propagation
- [ ] Create regions with both `WithRegion` and `StartRegion`/`End`
- [ ] Explain why a task can span goroutines but a region cannot
- [ ] Emit and find a `trace.Log`/`Logf` event
- [ ] Read the four blocking profiles and say what each finds
- [ ] State, precisely, why `runtime/trace` is not distributed tracing
- [ ] Diagnose "annotations missing in the viewer" as a ctx-threading bug
- [ ] Reason about trace size and why you bound the window

---

## Summary

User annotations turn the execution trace from a scheduler dump into a map of your application's logic. **Tasks** (`trace.NewTask`) mark logical operations that span goroutines and are propagated by `context.Context`; **regions** (`trace.WithRegion`/`StartRegion`) mark spans of code on a single goroutine; **logs** (`trace.Log`/`Logf`) mark point-in-time events. Thread the task-derived `ctx` through everything, or attribution silently breaks.

In `go tool trace`, the highest-leverage views are goroutine analysis and the four blocking profiles (scheduler latency, synchronization, network, syscall); the timeline is where you correlate a slow region with a GC pause. `runtime/trace` is timeline-of-events; `runtime/pprof` is statistical aggregate — complementary tools.

Above all: `runtime/trace` traces *one process's scheduler*. It is not OpenTelemetry. Use it to learn why a single process is internally slow; use distributed tracing to learn which service in a chain is slow.
