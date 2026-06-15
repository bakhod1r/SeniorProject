# `runtime/trace` & Application Tracing — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end. Use Go 1.21+ throughout; the flight-recorder tasks assume Go 1.25 for the stdlib `runtime/trace.FlightRecorder`, or `golang.org/x/exp/trace` on 1.21–1.24.

---

## Easy

### Task 1 — Capture a trace in code

Create a module `example.com/tracedemo`. Write a `main.go` that spawns 8 goroutines each summing a million integers, wrapped in `trace.Start`/`trace.Stop`. Run it, then open the trace.

```bash
go run .
go tool trace trace.out
```

Open **View trace by proc**. Confirm you see eight goroutines spread across your CPUs.

**Goal.** See what the tracer produces and that `defer trace.Stop()` yields a valid file.

---

### Task 2 — Capture the same workload via `go test`

Move the workload into a `BenchmarkWork`. Capture a trace without touching `trace.Start`:

```bash
go test -trace=trace.out -bench=BenchmarkWork -run='^$' .
go tool trace trace.out
```

Confirm you get the same kind of trace. Then *also* add an in-code `trace.Start` and run under `-trace` again — observe the "tracing already enabled" error.

**Goal.** Learn the test-capture path and that only one tracer runs per process.

---

### Task 3 — Capture from a live server

Write a tiny HTTP server that imports `net/http/pprof` and serves some handler doing real work. With it running, capture a 5-second trace:

```bash
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=5'
go tool trace trace.out
```

**Goal.** Internalise the production capture path: a live server, no code change beyond the import.

---

### Task 4 — Break the trace on purpose

Take Task 1 and replace the normal return with `os.Exit(0)` before the deferred `trace.Stop()` would run. Run it, then try to open `trace.out`.

Observe that the file is empty or refuses to open. Now fix it by calling `trace.Stop()` explicitly before `os.Exit`.

**Goal.** Feel the "`os.Exit` skips defers, so `Stop` never flushes" failure and its fix.

---

### Task 5 — Profile vs trace on the same run

Capture both a CPU profile and a trace from one benchmark, then open each:

```bash
go test -bench=BenchmarkWork -run='^$' -cpuprofile=cpu.out -trace=trace.out .
go tool pprof  cpu.out     # where CPU time goes
go tool trace  trace.out   # when/why goroutines ran or blocked
```

Write one sentence on what each tool told you that the other did not.

**Goal.** Cement that they are complementary, not interchangeable.

---

## Medium

### Task 6 — Annotate a request with a task and regions

Write a `handleRequest(ctx)` that opens a `trace.NewTask(ctx, "request")`, then runs two phases (`fetch`, `render`) as regions — one with `trace.WithRegion`, one with `StartRegion`/`End`. Run them on *different goroutines* sharing the task ctx. Trace it.

In the viewer, open **User-defined tasks** and confirm one `request` task contains both regions even though they ran on different goroutines.

**Goal.** Carve the trace into your vocabulary; see that a task spans goroutines.

---

### Task 7 — Reproduce the missing-annotations bug

Take Task 6 and deliberately pass the *original* `ctx` (not the one `NewTask` returned) to `WithRegion`. Trace it. Observe that the regions no longer appear under the task. Then fix it by threading the derived ctx.

**Goal.** Diagnose the single most common annotation bug — ctx not threaded.

---

### Task 8 — Diagnose lock contention

Write a program where 100 goroutines fight over one `sync.Mutex`, each holding it while doing a short busy loop. Trace it. In `go tool trace`, open the **Synchronization blocking profile** and confirm heavy blocking on `(*Mutex).Lock`. Then open the timeline and find the *staircase* signature (one running, the rest blocked).

**Goal.** Recognise contention in both the blocking profile and the timeline.

---

### Task 9 — Diagnose goroutine starvation

Write a program that spawns far more CPU-bound goroutines than `GOMAXPROCS` (e.g. set `GOMAXPROCS=2` and spawn 200 tight loops). Trace it. Open the **Scheduler latency profile** and confirm large runnable-but-not-running time. On the timeline, find the gap between a goroutine becoming runnable and starting.

```bash
GOMAXPROCS=2 go run .
```

**Goal.** See starvation in the only tool that measures it directly.

---

### Task 10 — Diagnose GC interference

Write a program that allocates aggressively in a hot loop (e.g. building and discarding large slices) across several goroutines. Trace a few seconds. On the timeline, find the GC lanes and confirm a busy goroutine doing **mark assist**. Then take a heap profile of the same workload and identify the allocation site.

**Goal.** Correlate GC assist on the timeline with the allocation cause (the trace→heap-profile relay).

---

### Task 11 — Bound a trace to one phase

Take a program with a noisy startup and a quiet steady state. First trace the *whole* program; note the file size. Then move `trace.Start`/`Stop` to wrap *only* the steady-state phase. Compare file sizes and how fast each opens.

**Goal.** Feel that trace size scales with scheduling activity and that scoping shrinks it.

---

### Task 12 — Log decisions, then find them

Add `trace.Logf(ctx, "cache", "miss key=%s", k)` and `trace.Log(ctx, "retry", "attempt-2")` to a task-annotated handler. Trace it and find the log markers in the task's event list and on the timeline.

**Goal.** Use logs as point-in-time annotations and locate them in the viewer.

---

## Hard

### Task 13 — Wire a `-trace` flag and an admin trace endpoint

Add to a server: (a) a `-trace=FILE` flag that captures a startup trace, and (b) an authenticated admin handler that serves `/debug/pprof/trace`-style output but bound to `127.0.0.1` and behind a simple auth check. Confirm an unauthenticated request is rejected.

**Goal.** Ship a real, *gated* capture surface — operational, not public.

---

### Task 14 — Wire a flight recorder

Add a `FlightRecorder` to a server: `NewFlightRecorder`, `SetPeriod(3s)`, `SetSize(8<<20)`, `Start`. Add an admin handler that calls `WriteTo(w)` to dump the recent window. Generate some load, hit the dump endpoint, and open the resulting trace.

```go
fr := trace.NewFlightRecorder() // runtime/trace on 1.25+, else x/exp/trace
fr.SetPeriod(3 * time.Second)
fr.SetSize(8 << 20)
fr.Start()
```

**Goal.** Capture the *past* on demand, not the next N seconds.

---

### Task 15 — Flight-recorder-on-anomaly

Extend Task 14: add a latency middleware that times each request and, when one exceeds a threshold (e.g. 150ms), calls `fr.WriteTo` to a uniquely-named file with the reason logged. Inject an artificially slow request and confirm a trace is dumped automatically.

**Goal.** Build the senior pattern — dump the rolling window automatically when an anomaly fires.

---

### Task 16 — Parse a trace programmatically

Using `golang.org/x/exp/trace`, write a tool that opens a trace, loops `ReadEvent()`, and prints total duration per region name (a small JSON map `{region: totalNanos}`). Run it against a trace from Task 6.

**Goal.** Read the event stream directly instead of eyeballing the viewer.

---

### Task 17 — CI gate on region duration

Turn Task 16 into a test assertion: a benchmark produces a trace, your parser sums the `db.query` region time, and the test fails if it exceeds a budget. Wire it as a CI step.

**Goal.** Make trace shape an automated, regression-catching gate.

---

### Task 18 — Correlate with a distributed-tracing ID

In a task-annotated handler, extract an OpenTelemetry (or any) trace/span ID from the context and stamp it into a `trace.Logf(ctx, "otel", "trace_id=%s span_id=%s", ...)`. Trace a request, then confirm you can find the intra-process task by searching its logs for the span ID.

**Goal.** Make the intra-process trace correlate with the distributed trace.

---

## Bonus / Stretch

### Task 19 — Measure tracer overhead on your workload

Run steady-state load against a server with and without a trace active, comparing throughput and tail latency:

```bash
hey -z 30s -c 50 http://localhost:8080/api > baseline.txt
curl -s -o /tmp/t.out 'http://localhost:6060/debug/pprof/trace?seconds=30' &
hey -z 30s -c 50 http://localhost:8080/api > traced.txt
```

Compute the delta. Write a one-line overhead budget for this service.

**Goal.** Replace folklore overhead numbers with a measurement on your own code.

---

### Task 20 — Reproduce the container `GOMAXPROCS` starvation

Run a CPU-bound, many-goroutine workload in a container with a 2-CPU cgroup limit but *without* setting `GOMAXPROCS`. Trace it; observe scheduler-latency starvation because the runtime sees the host's core count. Then set `GOMAXPROCS=2` (or use Go 1.25's automatic cgroup-aware default) and confirm the starvation disappears.

**Goal.** See, and fix, the most common production starvation cause.

---

## Solutions (sketched)

### Solution 1
```go
package main

import (
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    if err := trace.Start(f); err != nil {
        panic(err)
    }
    defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            sum := 0
            for j := 0; j < 1_000_000; j++ {
                sum += j
            }
            _ = sum
        }()
    }
    wg.Wait()
}
```
The eight goroutines appear on the proc lanes.

### Solution 2
`go test -trace` makes the testing framework own the tracer. Adding an in-code `trace.Start` under `-trace` is the *second* tracer and errors with `tracing already enabled` — one tracer per process.

### Solution 3
Import `_ "net/http/pprof"`, run `http.ListenAndServe("localhost:6060", nil)` in a goroutine. The `?seconds=5` endpoint records 5 seconds of the live process.

### Solution 4
`os.Exit` does not run deferred functions, so `trace.Stop()` never flushes — the file is empty/truncated. Fix: call `trace.Stop()` explicitly immediately before `os.Exit(0)`.

### Solution 5
The CPU profile shows the hot function (where on-CPU time goes); the trace shows when goroutines ran or blocked. For a CPU-bound benchmark the profile is more direct; the trace adds the scheduling picture.

### Solution 6
```go
ctx, task := trace.NewTask(ctx, "request")
defer task.End()
// goroutine A:
trace.WithRegion(ctx, "fetch", func() { /* ... */ })
// goroutine B:
r := trace.StartRegion(ctx, "render"); /* ... */; r.End()
```
Both regions appear under the one task because the derived `ctx` carries the task ID across goroutines.

### Solution 7
Passing the original `ctx` means region events carry no task ID, so the viewer cannot attribute them — the task looks empty. The fix is to use the exact `ctx` returned by `NewTask`.

### Solution 8
100 goroutines + 1 mutex → the **Synchronization blocking profile** shows heavy time on `(*Mutex).Lock`. The timeline shows the staircase: one goroutine runs while the rest are blocked, repeatedly. A CPU profile would *not* show this clearly — blocked goroutines burn no CPU.

### Solution 9
With `GOMAXPROCS=2` and 200 tight loops, ~198 goroutines are runnable-but-not-running at any moment. The **Scheduler latency profile** attributes this to the spawn site; the timeline shows wide gaps between "runnable" and "running."

### Solution 10
Aggressive allocation forces frequent GC; when background mark workers fall behind, allocating goroutines do **mark assist** (visible on the timeline as the goroutine doing GC work). The heap profile names the allocation site — that is the cause; the trace showed the symptom.

### Solution 11
The whole-program trace includes startup noise and is larger; scoping `Start`/`Stop` to the steady-state phase yields a smaller file that opens faster. Trace size tracks scheduling activity, not wall-clock time.

### Solution 12
```go
trace.Logf(ctx, "cache", "miss key=%s", k)
trace.Log(ctx, "retry", "attempt-2")
```
Logs appear as point markers on the timeline and in the task's event list. Keep them short and non-sensitive.

### Solution 13
A `-trace` flag opens a file and wraps `Start`/`Stop` around startup. The admin handler wraps the pprof trace handler in an auth check and binds to `127.0.0.1:6060`, never `0.0.0.0`. Unauthenticated requests get 401/403.

### Solution 14
```go
fr := trace.NewFlightRecorder()
fr.SetPeriod(3 * time.Second)
fr.SetSize(8 << 20)
_ = fr.Start()
// handler:
func dump(w http.ResponseWriter, _ *http.Request) { _, _ = fr.WriteTo(w) }
```
`WriteTo` writes a self-contained trace of the recent window — openable in `go tool trace`.

### Solution 15
```go
start := time.Now()
next.ServeHTTP(w, r)
if d := time.Since(start); d > 150*time.Millisecond {
    f, _ := os.CreateTemp("", "anomaly-*.trace")
    _, _ = fr.WriteTo(f)
    f.Close()
    log.Printf("dumped anomaly trace %s (latency=%s)", f.Name(), d)
}
```
The dump captures the *past* leading up to the slow request.

### Solution 16
```go
r, _ := trace.NewReader(f)
for {
    ev, err := r.ReadEvent()
    if err != nil { break }
    switch ev.Kind() {
    case trace.EventRegionBegin: /* push start time per goroutine+name */
    case trace.EventRegionEnd:   /* pop, add duration to map[name] */
    }
}
```
Emit the map as JSON. The exact API names track the `x/exp` package version.

### Solution 17
The test runs the benchmark with `-trace`, parses the output with the Solution-16 logic, and `t.Fatalf` if `regionDurations["db.query"] > budget`. Wire it as a normal `go test` step in CI.

### Solution 18
```go
sc := otelTrace.SpanContextFromContext(ctx)
trace.Logf(ctx, "otel", "trace_id=%s span_id=%s", sc.TraceID(), sc.SpanID())
```
Given a slow span ID from the distributed UI, search the intra-process trace's task logs for the matching `span_id`.

### Solution 19
The delta between `baseline.txt` and `traced.txt` (throughput and p99) is the overhead for *this* workload. A process with very fine-grained scheduling shows more; measure, do not guess.

### Solution 20
Without `GOMAXPROCS`, the runtime sees the host's core count (say 64) but the cgroup grants 2 CPUs, so ~62 Ps' worth of goroutines starve — visible in the scheduler-latency profile. Setting `GOMAXPROCS=2` (or Go 1.25's automatic cgroup-aware default) matches Ps to available CPUs and the starvation disappears.

---

## Checkpoints

After the easy tasks: you can capture a trace three ways, open it, recognise the empty-file failure, and choose between a trace and a profile.
After the medium tasks: you can annotate with tasks/regions/logs, diagnose contention, starvation, and GC interference in the right views, and scope a trace.
After the hard tasks: you can ship a gated capture endpoint, run a flight recorder, dump on anomalies, parse a trace programmatically, gate CI on trace shape, and correlate with distributed tracing.
After the bonus tasks: you have measured tracer overhead on your own workload and reproduced-and-fixed the container `GOMAXPROCS` starvation that bites most production Go services.
