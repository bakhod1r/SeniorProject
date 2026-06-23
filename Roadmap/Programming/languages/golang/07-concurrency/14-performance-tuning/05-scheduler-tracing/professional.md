# Scheduler Tracing — Professional Level

[Back to index](index.md)

## Table of Contents
1. [Introduction](#introduction)
2. [Trace Format History](#trace-format-history)
3. [The Go 1.21+ Trace Format](#the-go-121-trace-format)
4. [Event Encoding](#event-encoding)
5. [Generations and Streaming](#generations-and-streaming)
6. [Per-M Batches](#per-m-batches)
7. [String Tables and Stack Tables](#string-tables-and-stack-tables)
8. [Reading the Trace from Code](#reading-the-trace-from-code)
9. [Building Custom Analysis](#building-custom-analysis)
10. [Continuous Tracing Pipelines](#continuous-tracing-pipelines)
11. [Trace Overhead Engineering](#trace-overhead-engineering)
12. [Versioning, Compatibility, and Tooling](#versioning-compatibility-and-tooling)
13. [What Engineers Build on Top of `runtime/trace`](#what-engineers-build-on-top-of-runtimetrace)
14. [Summary](#summary)

---

## Introduction

At professional level you do not just *use* the trace tooling. You know how the bytes are laid out on disk, you can parse them without `go tool trace`, you build custom analyses, and you operate a continuous tracing pipeline at scale. The professional reader of this section already has read `runtime/trace/trace.go`, knows the difference between Go 1.20 and Go 1.21 trace formats, and has at least once shipped a service that uploads sampled traces to object storage with a few percent overhead.

The reference is Go 1.22+. Anything format-specific is called out by version.

---

## Trace Format History

| Version | Format | Major change |
|---------|--------|--------------|
| Go 1.5 | v1 | Original tracer; per-P-and-G event log. |
| Go 1.11 | v2 | Smaller event records; added user tasks/regions. |
| Go 1.21 | v3 | Generations. Per-M batches. Streamable. Re-stitching at boundaries. Lower overhead. |
| Go 1.22 | v3 | Refinements; minor event type additions. |
| Go 1.23 | v4 / v3-cleanup | Continued evolution; CPU samples in trace. |

Pre-1.21 traces had a "stop the world to dump string table" phase at the end. Post-1.21, traces are split into *generations*; strings and stack samples are flushed per generation; the file can be cut at a generation boundary and remain analysable. This is what makes continuous tracing realistic.

`go tool trace` reads any version. Third-party tools (Datadog continuous profiler, custom analyzers) typically pin to v3+.

---

## The Go 1.21+ Trace Format

The on-disk file is a stream of bytes with this top-level structure:

```
[Header]
[Generation 0]
  [Per-M batches]
  [String table]
  [Stack table]
  [CPU samples]
  [Frequencies]
[Generation 1]
  ...
[Generation N]
[EOF]
```

A generation is roughly 64 MB or 1 second of trace data, whichever comes first. Each generation is self-contained: it carries its own string and stack tables, so any whole-generation slice of the file can be parsed and rendered independently.

The header is a single line: `go 1.22 trace\n` (text). The body is binary.

---

## Event Encoding

Each event is a variable-length record:

```
[event-type byte] [varint args ...]
```

Common event types:

| Type | Bytes | Meaning |
|------|-------|---------|
| `EvProcStart` | 1 + 1 varint | A P became active. |
| `EvProcStop` | 1 | A P became inactive. |
| `EvProcsChange` | 1 + 1 varint | `GOMAXPROCS` changed. |
| `EvGoCreate` | 1 + 3 varints | go statement created a G. |
| `EvGoStart` | 1 + 2 varints | M picked up a G; G entered `_Grunning`. |
| `EvGoEnd` | 1 | G returned from its top function. |
| `EvGoStop` | 1 + 1 varint | G stopped (sysmon preempt). |
| `EvGoBlock`, `EvGoBlockSend`, `EvGoBlockRecv`, ... | 1 + varint | G blocked, with reason. |
| `EvGoUnblock` | 1 + 2 varints | G transitioned `_Gwaiting` → `_Grunnable`. |
| `EvGoSysCall` | 1 + 1 varint | G entered syscall. |
| `EvGoSysBlock` | 1 | Syscall took longer than 20µs; P donated. |
| `EvGoSysExit` | 1 + 2 varints | G left syscall. |
| `EvGCStart`, `EvGCDone`, `EvGCSTWStart`, `EvGCSTWDone` | 1 + varints | GC phase boundaries. |
| `EvUserTaskCreate` | 1 + 3 varints | `trace.NewTask`. |
| `EvUserTaskEnd` | 1 + 1 varint | `task.End()`. |
| `EvUserRegion` | 1 + 4 varints | `trace.WithRegion` begin or end. |
| `EvUserLog` | 1 + 4 varints | `trace.Log`. |
| `EvHeapAlloc`, `EvHeapGoal` | 1 + varint | Heap stats sample. |

Varint encoding is the standard protobuf-style varint: 7 bits per byte, MSB indicates continuation.

Timestamps are differential within a batch (the batch carries an absolute base; events carry deltas). String references are indices into the string table; stack references are indices into the stack table.

---

## Generations and Streaming

The `runtime/trace.Start` API has not changed at the surface — you still call it once, you still call `Stop` once. Internally, Go 1.21+ writes a header and an open generation, then periodically rotates generations as the trace continues.

```
[Header]
[Generation 0 begin]
... events accumulating ...
[Generation 0 end with string/stack tables]
[Generation 1 begin]
... events ...
[Generation 1 end]
... and so on until Stop ...
```

Generation rotation is cheap (no STW); it just locks the per-M buffers briefly to flush.

For streaming consumers: you can read the file as it is being written. A reader that knows the format can wait at the end of one generation, parse it, render it, and then wait for the next. This unlocks long-running tracing without batched analysis at the end.

`go tool trace` does not yet expose live streaming; it reads completed files. But for an internal tool, you can implement the live reader.

---

## Per-M Batches

Trace events are emitted by the running M onto a per-M ring buffer. When the buffer fills (~32 KB), the M flushes to the trace file under a mutex. Flushing is the only synchronous cost on the hot path; emit-into-buffer is just an atomic store and a few writes.

The on-disk layout interleaves M batches by flush order, not by event time. The reader sorts events by timestamp after parsing. The reader must hold all events of a generation in memory before delivering them in order; this is why generations have a size cap (64 MB roughly) — the consumer's memory is bounded.

For the writer, the per-M buffer is what makes tracing fast. There is no contention between Ms; each emits to its own buffer. The global mutex is taken only at flush.

---

## String Tables and Stack Tables

Every string used in the trace (function names, user log categories, region names) is interned. The string table maps string IDs to bytes. The trace records the integer IDs in events.

```
String table (in generation 0):
  1 -> "main"
  2 -> "main.handler"
  3 -> "parse"
  4 -> "lookup"
  5 -> "stage"
```

Stack samples are emitted similarly. A stack is an array of program counters; each PC resolves to a (file, line, function) tuple. The stack table maps stack IDs to PC arrays.

```
Stack table (in generation 0):
  1 -> [0x401234, 0x401abc, 0x402def]
  2 -> [0x401234, 0x401abc, 0x403456]
```

The reader maintains running tables across generations; if a new generation introduces a new string ID, it is added. IDs are monotonic across the trace.

Resolution of PC → (function, file, line) happens at read time using the binary's symbol table. If you analyse traces from a binary you do not have, you cannot resolve frames — you see addresses only.

---

## Reading the Trace from Code

The standard library does not export the trace parser. The internal package `internal/trace` does the parsing for `go tool trace`. Two paths:

1. **Use `golang.org/x/exp/trace` (was `internal/trace/v2` in 1.21+).** This is a publicly-available wrapper around the parsing logic; supported by the Go team.
2. **Write your own parser using the format spec.**

Path 1 in code:

```go
import (
    "io"
    "log"
    "os"

    "golang.org/x/exp/trace"
)

func parseTrace(path string) {
    f, err := os.Open(path)
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()

    r, err := trace.NewReader(f)
    if err != nil {
        log.Fatal(err)
    }
    for {
        ev, err := r.ReadEvent()
        if err == io.EOF {
            return
        }
        if err != nil {
            log.Fatal(err)
        }
        handle(ev)
    }
}

func handle(ev trace.Event) {
    switch ev.Kind() {
    case trace.EventStateTransition:
        st := ev.StateTransition()
        // st.Resource, st.Stack, st.From, st.To, ev.Time()
    case trace.EventLog:
        l := ev.Log()
        _ = l // task, category, message
    case trace.EventRegionBegin, trace.EventRegionEnd:
        r := ev.Region()
        _ = r
    case trace.EventTaskBegin, trace.EventTaskEnd:
        t := ev.Task()
        _ = t
    }
}
```

Path 2 requires implementing the varint reader, generation framing, string/stack table maintenance, and event-record decoding. Useful only for tools that need fewer dependencies (e.g., something embedded in a closed-source profiler).

---

## Building Custom Analysis

Once you can read events, the analyses you can build are unlimited. A few useful ones:

### Per-task latency histograms

For each `EventTaskBegin`, record the start time. On the matching `EventTaskEnd`, compute duration. Bucket into a histogram. Output: distribution of request latency by task name.

### Per-region attribution

For each region, accumulate total time, count, and the parent task. Report regions sorted by total time. This is the **User-defined regions** table built locally — but you can customise it: filter by tag, slice by time of day, compare two traces.

### Scheduler latency by call site

For each `EventStateTransition` from `_Grunnable` to `_Grunning`, look at the previous `EventStateTransition` (which moved the G to `_Grunnable`). The gap is scheduler latency. Attribute to the function that became runnable. Output: same data as `-pprof=sched`, with whatever pivots you want.

### Stuck-P detector

For each P, track the longest interval between consecutive `EvProcStart`/`EvProcStop` and the longest `_Psyscall` interval. Alert if any P was in syscall > 100ms.

### GC-blame attribution

For each `EvUserTaskBegin`/`EvUserTaskEnd` pair, count how many `EvGCSTWStart` events fell within. Compute "what fraction of my tail latency was overlap with a STW phase?"

These analyses run in O(events). On a 5-second trace with 10M events, that is sub-second.

---

## Continuous Tracing Pipelines

A production pipeline:

```
[service A] --upload--> [object storage] <--ingest-- [analyzer]
[service B] --upload--> [object storage] <--ingest-- [analyzer]
                                                    |
                                                    v
                                             [time-series DB]
                                                    |
                                                    v
                                             [dashboards/alerts]
```

Each service runs a sampled tracing loop. Files are uploaded to S3 (or equivalent) with a key like `service/host/yyyymmdd/hhmmss.trace`. An analyzer process pulls new files, parses them, extracts:

- Per-region histograms.
- Per-task tail latencies.
- Scheduler-latency p99/p999.
- Mark-assist fraction.
- Goroutine count peak.

These are emitted as metrics to your TSDB. Dashboards plot them per service.

When an alert fires, you have not only the metric — you have the *raw trace file* that produced it. The analyzer keeps the URL; you can fetch the trace, open it with `go tool trace`, and see the timeline that triggered the alarm.

Implementation sketch in skeleton form:

```go
// tracer.go
package contrace

import (
    "context"
    "io"
    "os"
    "runtime/trace"
    "time"
)

type Sink interface {
    Upload(ctx context.Context, key string, r io.Reader) error
}

type Tracer struct {
    Sink     Sink
    Interval time.Duration
    Duration time.Duration
    Hostname string
    Service  string
}

func (t *Tracer) Run(ctx context.Context) error {
    tick := time.NewTicker(t.Interval)
    defer tick.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-tick.C:
            if err := t.captureAndUpload(ctx, now); err != nil {
                // log; continue
            }
        }
    }
}

func (t *Tracer) captureAndUpload(ctx context.Context, now time.Time) error {
    tmp, err := os.CreateTemp("", "trace-*.out")
    if err != nil {
        return err
    }
    defer os.Remove(tmp.Name())

    if err := trace.Start(tmp); err != nil {
        tmp.Close()
        return err
    }
    time.Sleep(t.Duration)
    trace.Stop()

    if _, err := tmp.Seek(0, io.SeekStart); err != nil {
        tmp.Close()
        return err
    }
    key := t.Service + "/" + t.Hostname + "/" + now.UTC().Format("20060102/150405") + ".trace"
    err = t.Sink.Upload(ctx, key, tmp)
    tmp.Close()
    return err
}
```

The `Sink` is your S3 or GCS implementation. The pattern is robust and ship-ready.

---

## Trace Overhead Engineering

Tracing is not free. Three components contribute:

1. **Hot-path emit cost.** Each event is one or two atomic adds plus a few buffer writes. ~50–150ns per event on amd64.
2. **Per-M flush cost.** When a per-M buffer fills (~32KB), the M takes a global lock and flushes. The lock is short (~1µs), but contended on busy systems.
3. **String/stack table writes.** Strings are interned once per generation; the lookup is a hash table.

For a service emitting ~1M events/sec, the steady-state cost is roughly 5–15% CPU.

Mitigations:

- **Disable tracing on low-priority Ms.** Not exposed via API; would require a runtime patch.
- **Sample at the source.** Only call `trace.WithRegion` on 1-in-100 requests. The trace will not show what was happening for the unsampled 99 requests, but you keep overhead low.
- **Disable user annotations in a hot loop.** If you have a 1000-times-per-request loop, the regions in the loop alone can dominate.
- **Capture short windows.** A 2-second capture every 5 minutes is < 1% sustained.

The Go team has been progressively reducing the overhead in each release. Go 1.21 cut emit cost by roughly 2x over 1.20. Go 1.22 and 1.23 have continued the trend.

---

## Versioning, Compatibility, and Tooling

The trace format is **not** an official Go compatibility guarantee. The Go team has revised it three times in a decade. Practical advice:

- **For internal tools that parse traces, use `golang.org/x/exp/trace`.** It handles format versions transparently.
- **For long-term storage**, store the binary trace files and the Go version that produced them. If the format changes in a future release and you need to analyse old traces, install the matching `go tool trace`.
- **For dashboards**, extract metrics at capture time and store those. The raw trace is for human investigation; the metrics drive alerts.

`go tool trace` itself ships with each Go release. There is one for Go 1.22, one for Go 1.23, etc. They typically read older traces correctly.

Vendor tools that parse traces (Datadog, Pyroscope, Grafana Pyroscope) typically pin to one version of `golang.org/x/exp/trace`. When the format evolves, they upgrade.

---

## What Engineers Build on Top of `runtime/trace`

Several real systems use the trace format as their building block:

- **Datadog continuous profiler** — captures short traces continuously, uploads to Datadog, renders per-task latency in their UI.
- **Grafana Pyroscope** — supports the runtime/trace format alongside pprof for "continuous profiling" of Go services.
- **In-house tools at large Go shops** — Uber, Google, Cloudflare have published blog posts about continuous tracing setups feeding their internal observability platforms.
- **Custom alerting systems** — extract scheduler-latency p99 every minute; alert if it exceeds a threshold for N minutes.

The pattern is always the same:

1. Sample short traces.
2. Upload or ingest centrally.
3. Extract metrics from each trace.
4. Plot or alert on the metrics.
5. Keep the raw traces for human follow-up.

If you operate a Go service at scale, building this — or buying it — is one of the highest-leverage observability investments you can make.

---

## Summary

The Go 1.21+ trace format is generation-structured, per-M-batched, and streamable. Events are compact varint-encoded records emitted onto per-M buffers and flushed in bulk. Strings and stacks are interned per generation. `golang.org/x/exp/trace` exposes a parser; analyses build on top in linear time. Continuous tracing pipelines — sampled captures, object-storage upload, central analysis — are how production Go shops use this format at scale. Overhead is small but not zero; sample. The format evolves; pin parsers and store versions. With this layer of mastery you stop being a user of `go tool trace` and start being someone who builds the next observability layer for your team.
