# `runtime/trace` & Application Tracing — Find the Bug

> Each snippet contains a real-world bug in how an execution trace is captured, annotated, or interpreted. `runtime/trace` records timestamped scheduling events into a file you open with `go tool trace`; user annotations (`NewTask`, `WithRegion`/`StartRegion`, `Log`) are propagated by `context.Context` and have strict pairing rules. For each scenario: find the bug, explain the root cause, and fix it.

---

## Bug 1 — `os.Exit` skips `defer trace.Stop()`

```go
func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    run()
    os.Exit(0) // tidy exit
}
```

```bash
$ go run .
$ go tool trace trace.out
failed to read trace: unexpected end of file
```

**Symptom:** The trace file is empty or truncated and will not open.

**Root cause:** `os.Exit` terminates the process immediately and does **not** run deferred functions. `trace.Stop()` — which flushes the per-P buffers and writes the trailing generation markers that make the file valid — never runs.

**Fix:** stop the trace explicitly before any forced exit (and avoid `os.Exit` where you can):

```go
run()
trace.Stop() // flush before exiting
f.Close()
os.Exit(0)
```

The same trap applies to `log.Fatal` and `panic` without recovery.

---

## Bug 2 — Two tracers at once

```bash
$ cat trace_test.go
func TestPipeline(t *testing.T) {
    f, _ := os.Create("inner.out")
    trace.Start(f)        // the test ALSO starts a tracer
    defer trace.Stop()
    runPipeline()
}

$ go test -trace=outer.out -run=TestPipeline .
--- FAIL: TestPipeline
    panic: tracing already enabled
```

**Symptom:** `tracing already enabled` when running a test under `-trace`.

**Root cause:** `go test -trace` makes the testing framework start the tracer around the whole test binary. The in-code `trace.Start` is then the *second* tracer, and only one trace can be active per process.

**Fix:** pick one mechanism. If you run under `go test -trace`, do not call `trace.Start` in the code under test:

```go
func TestPipeline(t *testing.T) {
    runPipeline() // let -trace own the tracer
}
```

If you want the in-code trace, run the test *without* `-trace`.

---

## Bug 3 — Context not threaded, so the task is empty

```go
func handle(ctx context.Context) {
    _, task := trace.NewTask(ctx, "request") // discards the derived ctx!
    defer task.End()

    trace.WithRegion(ctx, "db.query", func() { query() })   // original ctx
    trace.Log(ctx, "cache", "miss")                         // original ctx
}
```

```text
go tool trace → User-defined tasks → "request": 0 regions, 0 logs
```

**Symptom:** The `request` task exists but contains no regions and no logs.

**Root cause:** `NewTask` returns a *derived* context carrying the task ID, but here it is discarded (`_`). The region and log calls receive the *original* `ctx`, which has no task ID, so their events are not attributed to the task.

**Fix:** keep and thread the derived context:

```go
ctx, task := trace.NewTask(ctx, "request")
defer task.End()
trace.WithRegion(ctx, "db.query", func() { query() })
trace.Log(ctx, "cache", "miss")
```

This is the single most common annotation bug — the task is "empty" because attribution was silently lost.

---

## Bug 4 — `defer task.End()` forgotten

```go
func handle(ctx context.Context) {
    ctx, task := trace.NewTask(ctx, "request")
    // no defer task.End()
    process(ctx)
    // returns without ending the task
}
```

```text
go tool trace → "request" task duration: 4.812 s  (the whole trace!)
```

**Symptom:** Every `request` task's duration equals the full trace length, not the request length.

**Root cause:** Without `task.End()`, no task-end event is emitted. The viewer treats the task as running until the trace ends, so its duration is meaningless.

**Fix:** always pair `NewTask` with `defer task.End()`:

```go
ctx, task := trace.NewTask(ctx, "request")
defer task.End()
process(ctx)
```

Note this does *not* error — it silently inflates durations, which is worse than a crash.

---

## Bug 5 — Region crossing a goroutine boundary

```go
func handle(ctx context.Context) {
    r := trace.StartRegion(ctx, "work")
    go func() {
        defer r.End() // ended on a DIFFERENT goroutine
        work()
    }()
}
```

```text
go tool trace → region "work": mismatched / not ended on the same goroutine
```

**Symptom:** The region is malformed or missing; the viewer complains about the goroutine.

**Root cause:** A region's begin/end are paired by the runtime using a *per-goroutine* nesting stack. `StartRegion` ran on the handler goroutine; `r.End()` ran on the spawned goroutine. The pairing fails because they are on different Gs.

**Fix:** for work that crosses goroutines, use a **task** (ctx-propagated), not a region. Keep the region inside the spawned goroutine:

```go
go func() {
    trace.WithRegion(ctx, "work", func() { work() })
}()
```

Regions are single-goroutine; tasks span goroutines.

---

## Bug 6 — Regions not LIFO-nested

```go
func handle(ctx context.Context) {
    a := trace.StartRegion(ctx, "outer")
    b := trace.StartRegion(ctx, "inner")
    a.End() // ends "outer" before "inner"
    b.End()
}
```

**Symptom:** Region durations are wrong or the viewer shows a nesting error.

**Root cause:** Regions on one goroutine form a stack and must be ended in **LIFO** order. Here `outer` is ended while `inner` is still open, violating the nesting the runtime expects.

**Fix:** end in reverse order of starting, or use closures which enforce nesting automatically:

```go
trace.WithRegion(ctx, "outer", func() {
    trace.WithRegion(ctx, "inner", func() { /* ... */ })
})
```

`WithRegion` makes mis-nesting impossible by construction — prefer it over manual `StartRegion`/`End`.

---

## Bug 7 — Region not ended on an error path

```go
func handle(ctx context.Context) error {
    r := trace.StartRegion(ctx, "db.query")
    rows, err := query()
    if err != nil {
        return err // r.End() never called
    }
    process(rows)
    r.End()
    return nil
}
```

**Symptom:** On error-heavy traffic, `db.query` regions run far longer than the actual query — sometimes to the goroutine's end.

**Root cause:** The early `return` skips `r.End()`. The region stays open until something else ends it (or the goroutine finishes), badly skewing the region's duration.

**Fix:** `defer r.End()` right after `StartRegion`, or use the closure form:

```go
r := trace.StartRegion(ctx, "db.query")
defer r.End()
```

---

## Bug 8 — Double `trace.Start`

```go
func main() {
    f, _ := os.Create("trace.out")
    trace.Start(f)
    defer trace.Stop()

    setup() // setup ALSO calls trace.Start internally
    run()
}
```

```text
panic: tracing already enabled  (from inside setup)
```

**Symptom:** A panic deep inside `setup`, far from the obvious `trace.Start`.

**Root cause:** Two `trace.Start` calls in the same process. The second errors (`tracing already enabled`); if the return value is ignored or the caller panics on it, you get a confusing crash.

**Fix:** there must be exactly one owner of the tracer. Remove the inner `trace.Start`; if a library needs to support tracing, it should accept that the *caller* owns it, or check `trace.IsEnabled()` before starting. Always check the error from `trace.Start`:

```go
if err := trace.Start(f); err != nil {
    log.Printf("trace already running: %v", err)
}
```

---

## Bug 9 — Capturing the wrong window with `?seconds=N`

```bash
# p99 spiked at 14:02:31. On-call reacts at 14:04:00:
$ curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=10'
$ go tool trace trace.out   # shows a perfectly healthy 10 seconds
```

**Symptom:** The captured trace shows nothing wrong — because the spike already passed.

**Root cause:** `?seconds=10` records the **next** ten seconds, not the past. By the time a human reacts, the anomaly is gone. On-demand tracing captures the future; incidents are in the past.

**Fix:** run a **flight recorder** that keeps a bounded rolling window of the recent past, and dump it on the anomaly:

```go
fr := trace.NewFlightRecorder() // runtime/trace on 1.25+, else x/exp/trace
fr.SetPeriod(5 * time.Second)
fr.SetSize(10 << 20)
_ = fr.Start()
// on a slow request / SLO breach:
fr.WriteTo(file) // captures the window leading UP TO the anomaly
```

---

## Bug 10 — Flight recorder never written

```go
func main() {
    fr := trace.NewFlightRecorder()
    fr.SetPeriod(5 * time.Second)
    _ = fr.Start()
    defer fr.Stop()

    serve() // runs forever; WriteTo is never called
}
```

**Symptom:** The flight recorder runs (and costs memory) but no trace ever comes out.

**Root cause:** The flight recorder only *retains* a rolling window; it produces a file only when `WriteTo` is called. With no trigger wired up, it records into a buffer that is continuously overwritten and never dumped.

**Fix:** wire a trigger — a latency threshold, an SLO watchdog, or a manual endpoint:

```go
mux.HandleFunc("/admin/flighttrace", func(w http.ResponseWriter, _ *http.Request) {
    if _, err := fr.WriteTo(w); err != nil {
        http.Error(w, err.Error(), 500)
    }
})
```

A flight recorder without a dump trigger is pure overhead.

---

## Bug 11 — `SetSize` silently shrinks the window

```go
fr := trace.NewFlightRecorder()
fr.SetPeriod(30 * time.Second) // "I want 30s of history"
fr.SetSize(1 << 20)            // 1 MiB cap
fr.Start()
```

```text
Dumped trace covers only ~600 ms, not 30 s.
```

**Symptom:** The dump covers a tiny fraction of the requested period.

**Root cause:** `SetPeriod` and `SetSize` are both upper bounds; the effective window is whichever binds **first**. On a busy process, 1 MiB of trace data is far less than 30 seconds, so the size cap wins and the retained history is short.

**Fix:** size the buffer for the event rate you actually have. Measure how much data your process emits per second of tracing, then set `SetSize` high enough to hold the period you want:

```go
fr.SetPeriod(30 * time.Second)
fr.SetSize(64 << 20) // enough bytes to actually hold ~30s for THIS workload
```

---

## Bug 12 — Always-on tracing in production

```go
func main() {
    f, _ := os.Create("/var/log/app/trace.out")
    trace.Start(f) // never stopped — "we always want a trace"
    serve()
}
```

**Symptom:** Latency regresses after deploy; the trace file grows without bound and fills the disk.

**Root cause:** Full tracing is left on continuously in a hot path. It records *every* scheduling event, so it both adds steady overhead and writes an ever-growing file. Tracing is meant for bounded windows, not as a permanent fixture.

**Fix:** default tracing off. For continuous coverage, use the flight recorder (bounded memory, dump on demand); for investigations, capture short windows:

```go
fr := trace.NewFlightRecorder()
fr.SetPeriod(5 * time.Second)
fr.SetSize(10 << 20)
_ = fr.Start() // bounded; dumps only when triggered
```

---

## Bug 13 — Public trace endpoint

```go
func main() {
    // pprof handlers, including /debug/pprof/trace, on the public listener:
    log.Fatal(http.ListenAndServe(":8080", nil)) // import _ "net/http/pprof"
}
```

**Symptom:** Anyone on the internet can `curl '.../debug/pprof/trace?seconds=60'`.

**Root cause:** Importing `net/http/pprof` registers `/debug/pprof/trace` on the default mux, and here that mux is served on the *public* `:8080`. This is both an information leak (traces contain stacks, timing, and any `trace.Log` content) and a denial-of-service lever (an attacker forcing continuous 60-second captures).

**Fix:** serve diagnostics on a separate, private listener; never on the public one:

```go
go func() {
    log.Println(http.ListenAndServe("127.0.0.1:6060", nil)) // private diagnostics
}()
log.Fatal(http.ListenAndServe(":8080", appMux)) // public app, no pprof
```

Gate it behind auth if it must be reachable.

---

## Bug 14 — Reusing one task across unrelated requests

```go
var ctx, task = trace.NewTask(context.Background(), "request") // package-level!

func handle(_ context.Context) {
    trace.WithRegion(ctx, "work", func() { work() })
}
```

**Symptom:** The trace has *one* `request` task containing thousands of regions from every request mixed together; per-request durations are meaningless.

**Root cause:** A single task instance is shared across all requests via a package-level variable. Tasks are meant to be one-per-logical-operation; sharing one collapses all requests into a single span.

**Fix:** create a fresh task per request, from the request's own context:

```go
func handle(ctx context.Context) {
    ctx, task := trace.NewTask(ctx, "request")
    defer task.End()
    trace.WithRegion(ctx, "work", func() { work() })
}
```

---

## Bug 15 — Misreading a network block as a CPU problem

```text
Symptom: /checkout p99 = 400ms, CPU at 30%.
Engineer's action: captures a CPU profile, finds nothing hot, gives up.
```

**Symptom:** The CPU profile is flat and unhelpful, so the investigation stalls.

**Root cause:** Wrong tool. Low CPU + high latency means time goes to *waiting*, which a CPU profile is blind to (a parked goroutine burns no CPU). The right tool is the execution trace, specifically the **Network blocking profile**, which would show the goroutine blocked on a downstream read.

**Fix:** for "slow but CPU is low," capture a trace and read the blocking profiles:

```bash
go tool trace trace.out  # → Network blocking profile names the call site
```

If the network block dominates, the slowness is downstream — hand off to the *distributed* trace to find which service.

---

## Bug 16 — Mistaking the trace for distributed tracing

```go
// Service A, hoping to see service B's internals:
func callB(ctx context.Context) {
    ctx, task := trace.NewTask(ctx, "call-B")
    defer task.End()
    httpClient.Do(reqToB.WithContext(ctx)) // expecting B's regions to appear
}
```

```text
go tool trace (on A's trace) → "call-B" task shows only: blocked on network 240ms.
No regions from service B anywhere.
```

**Symptom:** The trace shows the call to B as an opaque network block; B's internal work is nowhere.

**Root cause:** `runtime/trace` is **intra-process**. A task/region on service A never crosses the wire to service B. The expectation that B's regions appear in A's trace is the classic confusion of `runtime/trace` with distributed tracing.

**Fix:** use both layers. `runtime/trace` explains why *one* process is slow; OpenTelemetry (distributed tracing, sibling topic [04-opentelemetry-in-go](../04-opentelemetry-in-go/middle.md)) stitches the request across A and B. Stamp the OTel span ID into a `trace.Log` so the two correlate:

```go
sc := otelTrace.SpanContextFromContext(ctx)
trace.Logf(ctx, "otel", "trace_id=%s span_id=%s", sc.TraceID(), sc.SpanID())
```

---

## Bug 17 — Huge trace, unopenable

```bash
$ curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=120'
$ ls -lh trace.out
-rw-r--r-- 1 me me 1.8G trace.out
$ go tool trace trace.out
# hangs for minutes, then OOMs the laptop
```

**Symptom:** A 1.8 GB trace takes minutes to open and exhausts memory.

**Root cause:** A 120-second window on a busy server records millions of events per second; trace size scales with *scheduling activity*. `go tool trace` parses the whole file into memory before serving the UI, so a multi-gigabyte trace is impractical to open.

**Fix:** bound the window — patterns repeat, so a few seconds is almost always enough:

```bash
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=3'
```

Or scope an in-code trace to one phase, or dump a small flight-recorder window. Smaller is better for *both* capture overhead and analysis.

---

## Bug 18 — `GOMAXPROCS` mismatch read as a downstream problem

```text
Container: 2-CPU cgroup limit, host has 64 cores, GOMAXPROCS unset.
Symptom: p99 latency high, CPU "low" (per the cgroup), scheduler-latency profile huge.
Engineer's conclusion: "the database is slow."
```

**Symptom:** Heavy scheduler-latency in the trace, blamed on a downstream.

**Root cause:** With `GOMAXPROCS` unset (pre-1.25), the runtime sees the host's 64 cores and creates 64 Ps, but the cgroup grants only 2 CPUs. ~62 Ps' worth of goroutines are runnable-but-not-running — *starvation*, which looks like high latency / low CPU, exactly like a slow downstream. The scheduler-latency profile (not the network profile) is large, which is the tell.

**Fix:** match `GOMAXPROCS` to the cgroup CPU limit (or rely on Go 1.25's automatic cgroup-aware default):

```go
import "go.uber.org/automaxprocs" // pre-1.25; sets GOMAXPROCS from the cgroup
```

The trace then shows the starvation vanish; the database was never the problem.

---

## Bug 19 — Lock held across I/O, misdiagnosed

```go
func (c *Cache) Get(ctx context.Context, k string) ([]byte, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.m[k]; ok {
        return v, nil
    }
    v, err := c.fetchFromDB(ctx, k) // I/O while holding the lock!
    if err != nil {
        return nil, err
    }
    c.m[k] = v
    return v, nil
}
```

```text
go tool trace → Synchronization blocking profile: huge time on (*Cache).Get's Lock.
Timeline: one goroutine blocked-in-syscall while a queue of others wait on c.mu.
```

**Symptom:** Massive synchronization blocking; every request serialises behind the cache.

**Root cause:** The mutex is held across a *blocking database call*. While one goroutine does I/O under the lock, every other goroutine queues behind it — concurrency collapses to serial. The timeline shows the holder blocked-in-syscall with a stack of blocked-on-mutex goroutines behind it.

**Fix:** never hold a lock across I/O. Release before the slow call, re-acquire to store:

```go
c.mu.RLock(); v, ok := c.m[k]; c.mu.RUnlock()
if ok { return v, nil }
v, err := c.fetchFromDB(ctx, k) // no lock held
if err != nil { return nil, err }
c.mu.Lock(); c.m[k] = v; c.mu.Unlock()
return v, nil
```

(Beware the thundering-herd on concurrent misses — singleflight is the next refinement.)

---

## Bug 20 — Version mismatch between capture and viewer

```bash
$ go version            # capture host
go version go1.24.0 linux/amd64
$ curl -o trace.out 'http://prod:6060/debug/pprof/trace?seconds=3'

# analysis laptop:
$ go version
go version go1.20.5 darwin/arm64
$ go tool trace trace.out
failed to parse trace: unknown trace version
```

**Symptom:** A trace captured in production refuses to open on the analysis machine.

**Root cause:** The trace format is *versioned* and changed significantly at Go 1.21 (the generational rewrite). A 1.20 `go tool trace` cannot parse a 1.24 trace — the reader only understands a bounded range of format versions.

**Fix:** view with a toolchain at least as new as the one that captured the trace. Match versions:

```bash
# install/use the same (or newer) Go to open it
go1.24.0 tool trace trace.out
```

In a fleet, standardise the Go version, or record the capturing version alongside the trace so the analyst knows which toolchain to use.

---

## Bug 21 — Secrets logged into the trace

```go
trace.Logf(ctx, "auth", "validated token=%s for user=%s", rawToken, email)
```

**Symptom:** A trace file shared with a vendor for debugging contains live bearer tokens and user emails.

**Root cause:** `trace.Log`/`Logf` write the message *verbatim* into the trace file, which is an artifact people open and share. Putting secrets or PII into a log event leaks them into every copy of the trace.

**Fix:** log decisions and identifiers, never sensitive values:

```go
trace.Logf(ctx, "auth", "validated user_id=%d", userID) // no token, no email
```

Treat `trace.Log` content with the same care as any other log sink.

---

## Bug 22 — Forgetting the trace perturbs the very latency you measure

```bash
# Box has a slow NFS-mounted /data; the trace is written there:
$ curl -o /data/trace.out 'http://localhost:6060/debug/pprof/trace?seconds=10'
# Conclusion: "the service has terrible I/O latency under load"
```

**Symptom:** The traced run looks far worse than untraced production, and the I/O numbers look catastrophic.

**Root cause:** The trace is being *written* to a slow shared filesystem. The writer goroutine flushing batches to a slow mount competes with the application's own I/O, inflating the very latency under investigation. The measurement perturbed the system.

**Fix:** write the trace to fast local storage (or stream it off-box over a fast path), never to a slow mount in the request path:

```bash
curl -o /tmp/trace.out 'http://localhost:6060/debug/pprof/trace?seconds=10'  # local SSD
```

Then compare traced vs untraced throughput to confirm the tracer's overhead is acceptable for this workload.

---

## Summary

A trace looks like a simple file, but it is a derived artifact governed by strict pairing and consistency rules. Most tracing bugs come from one of three habits:

1. **Breaking the capture lifecycle.** `os.Exit`/`log.Fatal`/panic skipping `trace.Stop` (empty file), two tracers at once (`tracing already enabled`), always-on tracing (overhead + unbounded files), or writing the trace to slow storage that perturbs the measurement. The capture has a lifecycle; respect it.
2. **Mis-using annotations.** Not threading the `NewTask`-derived ctx (empty task), forgetting `task.End()` (inflated duration), crossing a goroutine boundary with a region (use a task), mis-nesting regions or skipping `End` on error paths, and reusing one task across requests. Prefer `WithRegion` (closure-nested) and `defer` everywhere.
3. **Misinterpreting the trace.** Capturing the future with `?seconds=N` when the incident is in the past (use the flight recorder), reading a network block or a `GOMAXPROCS`-starvation as a CPU or downstream problem, expecting cross-service spans from an intra-process tracer, and refusing to match Go versions between capture and viewer.

Treat capture as a lifecycle, annotations as context-propagated pairs, and the trace as an *intra-process* view that composes with — but is not — distributed tracing. With those three habits, the trace becomes the precise instrument it is meant to be.
