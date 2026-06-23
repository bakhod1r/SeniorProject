# `runtime/trace` & Application Tracing — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `trace.Start` Actually Does, Step by Step](#what-tracestart-actually-does-step-by-step)
3. [The Tracer's Internal Architecture](#the-tracers-internal-architecture)
4. [The 1.21 Generational, Streamable Format](#the-121-generational-streamable-format)
5. [The Trace Event Model](#the-trace-event-model)
6. [How `go tool trace` Builds Its Views](#how-go-tool-trace-builds-its-views)
7. [Programmatic Trace Parsing](#programmatic-trace-parsing)
8. [The FlightRecorder, In Detail](#the-flightrecorder-in-detail)
9. [Integrating Trace Capture Behind a pprof-Style Endpoint](#integrating-trace-capture-behind-a-pprof-style-endpoint)
10. [Tasks, Regions, and Logs at the Wire Level](#tasks-regions-and-logs-at-the-wire-level)
11. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
12. [Operational Playbook](#operational-playbook)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

The professional level treats `runtime/trace` not as three exported functions but as the surface of a contract between the runtime, the trace encoder, and the post-hoc analysis tools. Every event the tracer emits is later decoded by a reader under strict ordering and consistency rules; misunderstanding those rules is the source of most "my trace looks wrong" confusion — empty tasks, mis-nested regions, traces that will not open in an older toolchain.

This file is for engineers who build trace-aware tooling, run tracing in production at scale, parse traces programmatically, or own the correctness of a flight-recorder-based observability pipeline. After reading you will:

- Know what `trace.Start` does inside the runtime, in shape if not line-for-line.
- Reason about the per-P buffer architecture and the generational, streamable format introduced in Go 1.21.
- Understand the event model the encoder emits and the reader consumes.
- Parse a trace with `golang.org/x/exp/trace` instead of only eyeballing `go tool trace`.
- Configure and run a `FlightRecorder` with `SetPeriod`/`SetSize`/`WriteTo` from a runnable example.
- Wire trace capture behind an authenticated, pprof-style HTTP endpoint correctly.

The three exported calls are conceptually simple — turn recording on, turn it off, annotate. The details of *how* the runtime records, *what* it records, and *how* it is later decoded are what make tracing safe to run in production and possible to automate.

---

## What `trace.Start` Actually Does, Step by Step

`trace.Start(w io.Writer)` lives in `runtime/trace/trace.go`, but the heavy machinery is in the runtime package (`runtime/trace.go`, `runtime/traceruntime.go`, and the `traceback`/buffer files). Stripped to essentials, the flow is:

1. **Acquire the trace lock and check state.** Only one trace can be active. If one already is, `Start` returns an error (`tracing already enabled`). This is why a `go test -trace` run plus an in-code `trace.Start` collide.
2. **Enable tracing on every P.** Each processor gets tracing turned on so that, from this point, scheduling events are recorded into per-P buffers.
3. **Emit a synchronization batch.** The tracer writes an initial generation header and a stop-the-world-free synchronization point so the reader can establish a consistent starting picture (which goroutines exist, their states, the current stacks).
4. **Start the writer goroutine.** A background goroutine drains full per-P buffers and writes them to `w`. The application keeps running while this happens.
5. **Record events as they occur.** From here, every goroutine transition, GC phase, syscall boundary, and user annotation appends to the calling P's buffer.

`trace.Stop()`:

1. **Flush all per-P buffers.** Every partially-filled buffer is handed to the writer.
2. **Emit the final batches and the trailing generation marker.**
3. **Drain the writer and disable tracing on all Ps.**
4. **Release the trace lock**, so a subsequent `trace.Start` can run.

The single most important operational fact: **`Stop` is what makes the file valid.** Without it — because `os.Exit`, `log.Fatal`, or an unrecovered panic skipped the deferred call — the buffers are not flushed and the final markers are not written, so the file is empty or truncated. This is the mechanical reason behind the "always `defer trace.Stop()`, and stop explicitly before any forced exit" rule from junior.md.

### The STW removal milestone

Before Go 1.21, starting a trace required a stop-the-world pause to snapshot the goroutine set. The 1.21 rewrite removed that: the tracer now establishes its consistent starting picture *without* stopping the world, using the generational design described below. This is why the modern tracer is cheap enough to consider running far more aggressively than the pre-1.21 one.

---

## The Tracer's Internal Architecture

The tracer is built around three ideas: per-P buffers, lock-free hot-path recording, and a background writer.

### Per-P buffers

Each P owns a trace buffer. When a goroutine running on that P generates an event, the event is appended to *that P's* buffer. Because each P writes only to its own buffer, the hot path needs no cross-P locking — the expensive coordination is avoided exactly where it would hurt throughput most. This is the central reason the tracer scales: recording is a per-P, mostly-local operation.

### The hot-path cost

Recording one event is: figure out the event type, capture a timestamp (a fast monotonic read), optionally capture a stack, and append a compact varint-encoded record to the P's buffer. Stack capture is the expensive part — most of the per-event cost is the unwind, which is why the 1.21 work to make stack collection cheaper mattered so much.

### Batch flushing

When a P's buffer fills, it is handed off as a *batch* to the writer goroutine, and the P gets a fresh buffer. Batches are the unit of the on-disk format: a trace is a sequence of batches, each tagged with the P (or thread) it came from and the generation it belongs to. The writer goroutine serialises batches to the `io.Writer` you passed `trace.Start`. Because flushing is asynchronous and batched, the recording goroutines rarely block on I/O.

### Why this shape matters to you

If you run tracing on an I/O-constrained box, the *writer* is the part that can perturb your latency — the recording is cheap and local, but the batches still have to land somewhere. On a fast local disk this is invisible; on a slow network mount it is not. This is the mechanical basis for the senior advice to write traces to fast local storage or stream them off-box rather than to a slow shared filesystem in the request path.

---

## The 1.21 Generational, Streamable Format

The Go 1.21 rewrite replaced the old monolithic trace format with a **generational** one, and this is the change that makes the flight recorder possible.

### Generations

The trace is divided into **generations** — self-contained spans of trace data, each beginning with the state needed to interpret it (the goroutine set, running stacks, and so on) and ending with a marker. Crucially, a generation is *independently interpretable*: a reader can begin decoding at a generation boundary without having seen the prior generations.

### Why generations enable streaming and flight recording

- **Streamable.** Because each generation re-establishes context, a consumer can process the trace incrementally as batches arrive, rather than needing the whole file first. This is what makes online trace analysis feasible.
- **Flight recording.** The flight recorder keeps only the *most recent* generations in memory and discards older ones. Because a generation is self-contained, dumping "the recent past" produces a valid, openable trace even though the older history was thrown away. The old monolithic format could not do this — you needed the whole stream from the start to interpret any of it.

### Format versioning and the compatibility trap

The trace format is versioned, and it has evolved (the major break at 1.21, with refinements since). The reader in a given toolchain understands a bounded range of format versions. This is the mechanical reason a trace captured with a newer Go may not open in an older `go tool trace`, and vice versa: the version recorded in the trace header does not match what the viewer's reader supports. The practical rule — "capture and view with the same Go version" — is a direct consequence of format versioning, not superstition.

---

## The Trace Event Model

A trace is, at bottom, a time-ordered sequence of typed events. The professional needs a working model of the categories, because every view in `go tool trace` and every programmatic analysis is a projection of this stream.

### Event categories

- **Goroutine lifecycle.** Created, started running, blocked (with a *reason*: chan recv, chan send, select, sync mutex, sync cond, network, GC, syscall, …), unblocked, ended. The *blocking reason* is what lets the tool split waiting into the four blocking profiles.
- **Scheduling.** A G started or stopped running on a P; a G was preempted; a P went idle or started. The gap between "unblocked/runnable" and "started running" is the raw material of the scheduler-latency profile.
- **Garbage collection.** GC cycle start/end, mark phases, mark assist done by a specific goroutine, sweep, and the short STW phases.
- **Syscall.** A goroutine entered and exited a syscall; the M may have been handed off. Syscall durations feed the syscall blocking profile.
- **User annotations.** Task begin/end, region begin/end, and log events — the wire form of `NewTask`, `WithRegion`/`StartRegion`, and `Log`/`Logf`.

### Stacks and timestamps

Most events carry a nanosecond timestamp (monotonic) and many carry a stack. Stacks are *interned* — the encoder writes each unique stack once and references it by ID thereafter, so a hot call site does not re-emit its stack on every event. The reader rehydrates these references. This interning is a large part of why traces are as compact as they are despite the event volume.

### Ordering guarantees

Within a P, events are totally ordered. Across Ps, the reader reconstructs a global order using the synchronization points emitted at generation boundaries plus the per-event timestamps. The consistency rules around this ordering are why a hand-corrupted or partially-flushed trace fails to parse: the reader's invariants are violated.

---

## How `go tool trace` Builds Its Views

`go tool trace` (the `cmd/trace` package) is not magic — every view is a deterministic pass over the decoded event stream. Knowing the passes demystifies the tool.

- **Timeline (view by proc / by thread).** A direct rendering of the event stream onto lanes: each P (or M) is a lane, each "running" interval is a bar, GC and syscall activity get their own lanes. This is the least-processed view — closest to the raw events.
- **Goroutine analysis.** Groups goroutines by their top function and, for each, sums time into buckets — execution, scheduler wait, sync block, network block, syscall block, GC — by walking each goroutine's state transitions. The bucket breakdown is computed from the blocking-reason annotations on the block/unblock events.
- **The four blocking profiles** (scheduler latency, synchronization, network, syscall). Each is a pprof-format profile synthesised from the trace: the tool attributes blocked (or runnable-but-not-running) time to the *stack at the point of blocking*, aggregates across all goroutines, and emits a `pprof`-style profile you can even open in `go tool pprof`. The blocking reason on each event selects which profile it lands in.
- **User-defined tasks / regions.** Reconstructed by matching task-begin/end and region-begin/end events (correlated by task ID for tasks, and by goroutine + nesting for regions), then aggregating durations by name.

The professional takeaway: the views are *derived*, and the same underlying events can be re-derived by your own code if you parse the trace yourself — which is exactly what the next section enables.

---

## Programmatic Trace Parsing

For automation — CI gates, anomaly classifiers, custom dashboards — you do not want to drive a human-facing UI. You want to read the events directly. The reader API lives in `golang.org/x/exp/trace` (and is the basis of the standard-library tooling).

### The reader API shape

```go
import (
    "os"

    "golang.org/x/exp/trace"
)

func summarize(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()

    r, err := trace.NewReader(f)
    if err != nil {
        return err
    }

    var (
        regionDurations = map[string]int64{} // name -> total ns
        openRegions     = map[trace.GoID]regionStack{}
    )

    for {
        ev, err := r.ReadEvent()
        if err != nil {
            break // io.EOF at the end of a well-formed trace
        }
        switch ev.Kind() {
        case trace.EventRegionBegin:
            rg := ev.Region()
            openRegions[ev.Goroutine()] = openRegions[ev.Goroutine()].push(rg.Type, ev.Time())
        case trace.EventRegionEnd:
            rg := ev.Region()
            start, ok := openRegions[ev.Goroutine()].pop(rg.Type)
            if ok {
                regionDurations[rg.Type] += int64(ev.Time() - start)
            }
        }
    }
    // regionDurations now holds total time per named region.
    return nil
}
```

The exact type names and method signatures track the package's evolution (it is in `x/exp`, so it is explicitly unstable), but the *model* is stable: open a reader over the trace bytes, pull `Event`s in order, switch on `Kind()`, and accumulate. Every event exposes its time, the goroutine it belongs to, and kind-specific detail (the region, the task, the state transition, the log message).

### What programmatic parsing unlocks

- **CI assertions on trace shape.** "No region named `db.query` may exceed 50ms in this benchmark trace." A test parses the trace and fails the build on regression.
- **Anomaly classification.** A pipeline ingests flight-recorder dumps and auto-labels them ("dominated by sync block on the cache mutex") so on-call gets a category, not a raw file.
- **Custom aggregation.** Sum mark-assist time per task, count goroutines created per request, or compute scheduler-latency percentiles — anything the built-in views do not surface in the shape you need.

### The stability caveat

Because the reader lives in `x/exp`, pin the version and expect to adjust on upgrades. The trade is real: you get programmatic access years before the API stabilises, at the cost of churn. For one-off analysis, `go tool trace` is enough; for a *pipeline*, the reader is worth the maintenance.

---

## The FlightRecorder, In Detail

The flight recorder is the continuous-but-bounded counterpart to `trace.Start`. Instead of streaming everything to a writer, it keeps the most recent generations in memory and lets you snapshot them on demand. Experimental as `golang.org/x/exp/trace.FlightRecorder`; GA as `runtime/trace.FlightRecorder` in Go 1.25.

### Configuration

```go
import (
    "os"
    "time"

    "golang.org/x/exp/trace" // Go 1.21–1.24; "runtime/trace" on 1.25+
)

func newRecorder() *trace.FlightRecorder {
    fr := trace.NewFlightRecorder()
    fr.SetPeriod(3 * time.Second) // retain ~3s of recent history
    fr.SetSize(8 << 20)           // cap the in-memory buffer at ~8 MiB
    return fr
}
```

- **`SetPeriod(d)`** asks the recorder to retain at least the last `d` of history. It governs *how far back* a dump reaches.
- **`SetSize(n)`** bounds the *memory* the recorder may use. The effective retained window is whichever of period and size binds first — on a busy process, size may cap you below the requested period. Both are advisory upper bounds, not exact guarantees.
- Both must be set *before* `Start`; changing them while running is not the supported path.

### Lifecycle and dumping

```go
fr := newRecorder()
if err := fr.Start(); err != nil {
    log.Fatal(err)
}
defer fr.Stop()

// On an anomaly, snapshot the recent window into a valid trace file:
func dump(fr *trace.FlightRecorder, w io.Writer) error {
    _, err := fr.WriteTo(w) // writes a self-contained, openable trace
    return err
}
```

`WriteTo` serialises the currently-retained generations into a complete trace — openable directly in `go tool trace`. Because each generation is self-contained (the format section above), the dump is valid even though older history was discarded.

### Interaction with `trace.Start`

The flight recorder and an active `trace.Start` are two consumers of the same underlying tracer. Running both simultaneously is constrained — treat the tracer as a single resource and do not assume you can `trace.Start` while a flight recorder is running without checking the toolchain's behaviour for your version. The safe production posture is: run *one* mechanism (almost always the flight recorder) as the standing capture, and reserve `trace.Start` for offline/benchmark use.

---

## Integrating Trace Capture Behind a pprof-Style Endpoint

`net/http/pprof` already exposes `/debug/pprof/trace?seconds=N`, which calls `trace.Start`, sleeps `N` seconds, and `trace.Stop`s into the HTTP response. For flight-recorder dumps you usually want your *own* endpoint, modelled on the same pattern but dumping the *past* instead of the next N seconds.

```go
func flightDumpHandler(fr *trace.FlightRecorder) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // Gate this: admin-only, never public.
        w.Header().Set("Content-Type", "application/octet-stream")
        w.Header().Set("Content-Disposition", `attachment; filename="flight.trace"`)
        if _, err := fr.WriteTo(w); err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
        }
    }
}

func main() {
    fr := newRecorder()
    _ = fr.Start()
    defer fr.Stop()

    mux := http.NewServeMux()
    mux.Handle("/debug/flighttrace", adminOnly(flightDumpHandler(fr)))

    // Bind the diagnostics surface to a private interface, not 0.0.0.0.
    log.Fatal(http.ListenAndServe("127.0.0.1:6060", mux))
}
```

Operational rules, all of which the source/format above motivates:

- **Authenticate and bind privately.** The trace endpoint leaks stacks, timing, and any `trace.Log` content; an unauthenticated public endpoint is both a data leak and a DoS lever (an attacker forcing repeated full captures). Bind to `127.0.0.1` or wrap in `adminOnly`.
- **Stream to the response.** `WriteTo(w)` writes straight to the HTTP `ResponseWriter` — no temp file needed for the on-demand case. For triggered dumps you may instead write to object storage.
- **Use the *flight* endpoint for incidents, the *N-seconds* endpoint for "what is happening now."** The former captures the past; the latter captures the future. Most incidents are the past.

---

## Tasks, Regions, and Logs at the Wire Level

Understanding the annotation API as *events* clarifies the rules middle.md states as facts.

- **A task** emits a task-begin event carrying a unique task ID and the task name, and a task-end event carrying the same ID. The ID — not the goroutine — is what ties them together, which is precisely why a task can span goroutines: the begin and end can occur on different Gs as long as the ID (propagated via `context.Context`) matches. If `task.End()` never fires (a missing `defer`), there is no end event, and the tool treats the task as running until the trace ends — the source of the "task duration looks wrong" symptom.
- **A region** emits region-begin and region-end events tagged with the *goroutine* and the region type/name. They are matched by goroutine and nesting, not by an ID. This is the mechanical reason a region *must* begin and end on the same goroutine and *must* be LIFO-nested: the reader pairs them by popping a per-goroutine stack. Cross a goroutine boundary or violate nesting and the pairing fails — the "region not ended on the same goroutine / mismatched nesting" error.
- **A log** emits a single point-in-time event carrying the category and message. There is no begin/end; it is an instantaneous marker. Because the message is written verbatim into the trace, anything sensitive you log lands in the file.

The attribution rule ("thread the task-derived `ctx`") is, at the wire level, "make sure region/log events carry the right task ID." `NewTask` stashes the task ID in the returned context; regions and logs read it from the context you pass. Pass the *original* context and the events carry no task ID — hence the silent "annotations missing in the viewer" bug.

---

## Edge Cases the Source Reveals

A close reading of `runtime/trace`, the runtime's trace files, and `cmd/trace` exposes corners most users never hit:

- **One tracer per process.** `trace.Start` while a trace is active errors. `go test -trace` *is* an active trace; in-code `trace.Start` under it collides.
- **`Stop` is mandatory for validity.** No flush, no valid file. `os.Exit`/`log.Fatal`/unrecovered panic skip deferred stops. Stop explicitly before forced exit.
- **Format is versioned.** Capture and view with the same Go version, or the reader may reject the header. The 1.21 break is the big one.
- **Stacks are interned.** A corrupted or truncated trace can leave a stack reference dangling, which is one way a partial file fails to parse rather than parsing partially.
- **Generation boundaries are resync points.** A flight-recorder dump always begins at a generation boundary; you never get "half a generation," which is why dumps are always openable.
- **`SetSize` can override `SetPeriod`.** On a busy process the memory cap binds first and the retained window is shorter than the requested period. Measure the actual window if it matters.
- **Tasks without an end run to trace end.** Missing `defer task.End()` does not error; it silently inflates the task's duration.
- **Regions are per-goroutine stacks.** Starting a region and ending it from a goroutine spawned inside the region is a classic mistake; use a task for cross-goroutine grouping.
- **The blocking profiles are real `pprof` profiles.** You can save them and open them in `go tool pprof`, not only in the trace viewer.
- **`trace.Log` is unbounded.** Large or high-frequency log payloads inflate the trace and can dominate it; keep keys short and values small.

These are pointers to *reach for the package source and the format documentation* when something surprising happens. The runtime trace code is dense but tractable, and the format is documented in the design docs referenced below.

---

## Operational Playbook

A condensed reference for common professional scenarios.

| Scenario | Recipe |
|----------|--------|
| Capture a fixed-window trace from a live server | `curl -o t.out 'http://127.0.0.1:6060/debug/pprof/trace?seconds=5'` |
| Capture a trace from a test/benchmark | `go test -trace=t.out -run=TestX ./pkg` |
| Run a standing flight recorder | `fr := trace.NewFlightRecorder(); fr.SetPeriod(...); fr.SetSize(...); fr.Start()` |
| Dump the recent past on an anomaly | `fr.WriteTo(w)` from a latency middleware or admin handler |
| Parse a trace programmatically | `trace.NewReader(f)` from `golang.org/x/exp/trace`; loop `ReadEvent()` |
| Convert a blocking profile to pprof | Save the profile link from `go tool trace`; open in `go tool pprof` |
| Diagnose an empty trace file | `trace.Stop()` never ran — check for `os.Exit`/`log.Fatal`/panic before the defer |
| Diagnose "tracing already enabled" | Two tracers — usually `go test -trace` plus in-code `trace.Start` |
| Diagnose missing annotations | Wrong `ctx` threaded — pass the `NewTask`-derived context to regions/logs |
| Diagnose a trace that will not open | Go-version mismatch between capture and `go tool trace` |
| Gate the diagnostics surface | Bind to `127.0.0.1` and wrap handlers in auth; never expose publicly |
| Keep flight-recorder memory bounded | `SetSize` caps RAM; `SetPeriod` caps history; size wins on busy processes |

---

## Summary

`runtime/trace` is three exported functions over a substantial runtime subsystem. The professional understanding includes what `Start`/`Stop` do inside the runtime (per-P buffers, an asynchronous batched writer, and — since 1.21 — no stop-the-world to begin), the generational and streamable format that makes both online analysis and the flight recorder possible, and the event model that every `go tool trace` view is a projection of.

That same event model is accessible programmatically through `golang.org/x/exp/trace`'s reader, which turns tracing from a human-only activity into something you can put in CI gates, anomaly classifiers, and custom dashboards. The `FlightRecorder` (experimental in `x/exp/trace`, GA as `runtime/trace.FlightRecorder` in 1.25) configured with `SetPeriod`/`SetSize` and dumped with `WriteTo` gives you continuous, bounded, on-demand capture, ideally wired behind an authenticated pprof-style endpoint.

The simplicity of the three calls is by design. The complexity lives in the per-P recording architecture, the generational format, and the consistency rules of the event stream — and knowing where that complexity sits is what lets you run tracing in production and automate the analysis instead of squinting at a timeline.

---

## Further Reading

- [`runtime/trace` package documentation](https://pkg.go.dev/runtime/trace) — the authoritative API reference; `FlightRecorder` lives here on Go 1.25+.
- [`go tool trace` / `cmd/trace` documentation](https://pkg.go.dev/cmd/trace) — how the viewer derives each view from the event stream.
- [`golang.org/x/exp/trace`](https://pkg.go.dev/golang.org/x/exp/trace) — the programmatic reader and the experimental flight recorder for Go 1.21–1.24.
- [Go execution tracer design / trace format docs](https://go.dev/doc/diagnostics) — the diagnostics guide and the format design docs linked from the runtime trace package.
- [Go 1.21 release notes — execution tracer](https://go.dev/doc/go1.21) — the low-overhead, generational, streamable rewrite.
- [Go 1.25 release notes](https://go.dev/doc/go1.25) — `runtime/trace.FlightRecorder` going GA.
