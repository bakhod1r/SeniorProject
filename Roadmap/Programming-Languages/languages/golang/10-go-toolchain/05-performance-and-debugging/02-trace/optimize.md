# go tool trace — Optimization

The tracer's cost is non-trivial and its UI does not scale to huge traces. These exercises reduce overhead, focus the captured data on what you actually need, and place the tracer correctly in your diagnostic toolbox. Numbers are illustrative; measure on your service.

---

## Exercise 1: Keep capture windows short

**Before** — `?seconds=60` on a busy server produces a 1 GB+ trace that the browser cannot render and that costs noticeable latency to write.

**After** — capture 3-5 seconds, repeat if needed:

```bash
curl -o trace.out 'http://127.0.0.1:6060/debug/pprof/trace?seconds=3'
```

| Metric | `seconds=60` | `seconds=3` |
|--------|--------------|-------------|
| File size (busy svc) | ~1 GB | ~50 MB |
| Browser opens cleanly | no | yes |
| Latency impact during capture | high | small |

You almost never need more than a few seconds to spot a scheduler/GC pattern.

---

## Exercise 2: Snapshot only on SLO miss (flight recorder)

**Before** — continuous trace to disk to "have data when something goes wrong" — wastes I/O 99% of the time and grows files unboundedly.

**After** — Go 1.23+ flight recorder keeps a rolling buffer in memory; you snapshot on alert:

```go
fr := trace.NewFlightRecorder()
fr.Start()
defer fr.Stop()

if latency > slo {
    f, _ := os.Create("slo-miss.trace")
    fr.WriteTo(f); f.Close()
}
```

| Metric | Continuous trace | Flight recorder + snapshot |
|--------|------------------|----------------------------|
| Disk I/O at idle | sustained | none |
| File size growth | unbounded | one snapshot per miss |
| Data when incident hits | maybe (was it on?) | always (last few seconds) |

Same trace fidelity, dramatically lower I/O cost.

---

## Exercise 3: Instrument long-running operations with regions

**Before** — looking at a 5s timeline, you can't tell which 200ms span corresponds to "auth", "db", or "render"; you reason about colours and timestamps.

**After** — annotate explicitly:

```go
trace.WithRegion(ctx, "auth",   func() { authorize(r) })
trace.WithRegion(ctx, "db",     func() { queryDB(ctx) })
trace.WithRegion(ctx, "render", func() { render(w) })
```

| Metric | No regions | With regions |
|--------|-----------|--------------|
| Time to find slowest step | several minutes of clicking | seconds via the "User-defined tasks" tab |
| Reusability for future captures | low | high |

The annotations are cheap (a few events per region) and turn the tracer into a guided debugger.

---

## Exercise 4: Batch task captures (avoid per-request tasks for tiny ops)

**Before** — `trace.NewTask` around every 10µs operation — millions of task events flood the trace and the "User-defined tasks" list is unusable.

**After** — only create tasks for meaningful units (a request, a job, a batch). Inside, use regions for sub-steps:

```go
// good: one task per request
ctx, task := trace.NewTask(r.Context(), "GET /items")
defer task.End()
trace.WithRegion(ctx, "decode", decode)
```

| Metric | per-operation tasks | per-request tasks |
|--------|---------------------|-------------------|
| Task list usability | unusable | clear |
| Event overhead | high | low |

Tasks are the coarse abstraction; regions are the fine one. Don't invert them.

---

## Exercise 5: Exclude init/teardown via narrow windows

**Before** — `trace.Start` in `init` and `trace.Stop` in `defer` from `main`: captures program startup (mostly empty) and shutdown (atypical), padding the trace with noise.

**After** — bracket the actual workload:

```go
func main() {
    setup()
    f, _ := os.Create("trace.out")
    trace.Start(f); defer trace.Stop(); defer f.Close()
    runWorkload()    // exactly what you want to see
}
```

| Metric | Whole-program capture | Workload-only capture |
|--------|----------------------|------------------------|
| File size | inflated | minimal |
| Signal/noise ratio | low | high |

---

## Exercise 6: Use `trace.Log` sparingly

**Before** — `trace.Log(ctx, "row", fmt.Sprint(row))` inside a hot loop — each log is an event with a string payload; you balloon the trace and meaningfully slow the workload.

**After** — log identifying metadata once per task, not per inner iteration:

```go
trace.Log(ctx, "userID", req.UserID)        // once per request
trace.Log(ctx, "queryShape", queryShape)    // once per request
```

| Metric | Logs in inner loop | Logs at task entry |
|--------|--------------------|--------------------|
| Trace file size | bloated | normal |
| Workload slowdown from logging | noticeable | negligible |

The tracer is not a structured-log sink; treat `trace.Log` as labels, not telemetry.

---

## Exercise 7: Right tool for the question (trace vs pprof)

**Before** — using `go tool trace` to find a CPU hot spot, scrolling the timeline trying to spot dense regions of one function.

**After** — use the right tool:

| Question | Right tool | Wrong tool |
|----------|-----------|------------|
| "Where is CPU spent?" | pprof CPU | trace |
| "Where do we allocate?" | pprof heap | trace |
| "Why is p99 high?" | trace | pprof |
| "Why is a goroutine stuck?" | trace (+ goroutine profile) | pprof |
| "How long are GC pauses?" | trace | pprof |

| Metric | Wrong tool for CPU hot spot | pprof |
|--------|------------------------------|-------|
| Time to find hot function | many minutes | seconds (`go tool pprof -top`) |

The tracer is *latency and ordering*; pprof is *aggregate cost*. Don't confuse them.

---

## Measurement checklist
- [ ] Captures are ≤5 seconds unless you explicitly need longer.
- [ ] Continuous tracing replaced with flight recorder + snapshot-on-SLO-miss.
- [ ] Hot paths annotated with `WithRegion`; one task per request, not per operation.
- [ ] Capture window covers the workload, not init/teardown.
- [ ] `trace.Log` used as labels, not per-iteration telemetry.
- [ ] CPU/heap questions go to pprof; latency/ordering questions go to trace.
