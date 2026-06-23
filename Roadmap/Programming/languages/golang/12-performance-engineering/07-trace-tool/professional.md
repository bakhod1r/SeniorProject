# The Go Execution Tracer — Professional

## 1. The production framing

You will almost never sit at a developer machine with a 30-second trace from production and the time to dig through it. The professional question is: how do you get a *useful* trace from a service that's misbehaving, without making it worse, and with enough surrounding context to interpret it?

The answer has four parts:

1. Keep a pprof+trace HTTP endpoint always available — but only on the admin network.
2. Have the **flight recorder** running so you don't have to predict the incident.
3. Bound the cost: rate limit on-demand captures, cap output size, and never run a trace on the primary while the system is degraded.
4. Stitch traces to your tracing system (OpenTelemetry, Datadog APM) so an issue surfaced in distributed tracing has a one-click "open execution trace at that moment" link.

The rest of this file is how to actually build that.

---

## 2. The always-available endpoint

```go
package admin

import (
    "net/http"
    "net/http/pprof"
)

func New() http.Handler {
    mux := http.NewServeMux()
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)        // CPU
    mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
    mux.HandleFunc("/debug/pprof/trace", pprof.Trace)            // execution trace
    return mux
}

func Serve(addr string) {
    s := &http.Server{Addr: addr, Handler: New()}
    go s.ListenAndServe()
}
```

```go
// in main.go
admin.Serve("127.0.0.1:6060")
```

Hard rules:

- **Localhost or admin VIP only.** The trace endpoint reveals function names, file paths, and goroutine stacks. Treat it like a debug symbol dump.
- **Dedicated mux**, never `http.DefaultServeMux` (which becomes shared with whatever else registers there).
- **Authenticate** anything beyond localhost. A reverse-proxy mTLS or basic-auth wrapper is enough.

---

## 3. The flight recorder

Since Go 1.25, `runtime/trace` ships a flight recorder: a circular in-memory trace buffer that runs continuously but only emits on demand.

```go
import "runtime/trace"

var fr *trace.FlightRecorder

func init() {
    fr = trace.NewFlightRecorder(trace.FlightRecorderConfig{
        MinAge:   5 * time.Second,
        MaxBytes: 64 << 20,    // 64 MiB ring
    })
    fr.Start()
}

func dumpHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/octet-stream")
    if _, err := fr.WriteTo(w); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
}
```

You wire `dumpHandler` to your admin endpoint and trigger it:

- Manually during a brewing incident.
- Automatically from a sentinel that watches `runtime/metrics` for SLO breaches (latency spike, GC pause spike, goroutine surge).

The captured window is the most recent `MaxBytes` of events older than `MinAge`. The `MinAge` matters because the recorder cannot give you events that aren't yet committed to the ring.

Steady-state overhead is comparable to a full trace (5-10%), but you produce no I/O unless `WriteTo` is called. Many teams keep it always on in canary/staging and behind a sentinel in production.

---

## 4. On-demand capture, throttled

Even with the flight recorder, you'll still want a fresh on-demand trace sometimes. Throttle so you can't accidentally take three traces in 30 seconds:

```go
var traceMu sync.Mutex
var traceCooldown time.Time

func adminTrace(w http.ResponseWriter, r *http.Request) {
    traceMu.Lock()
    defer traceMu.Unlock()
    if time.Now().Before(traceCooldown) {
        http.Error(w, "trace cooldown active", http.StatusTooManyRequests)
        return
    }
    traceCooldown = time.Now().Add(60 * time.Second)

    sec, _ := strconv.Atoi(r.URL.Query().Get("seconds"))
    if sec <= 0 || sec > 30 {
        sec = 5
    }

    if err := trace.Start(w); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    defer trace.Stop()

    select {
    case <-time.After(time.Duration(sec) * time.Second):
    case <-r.Context().Done():
    }
}
```

Notes:

- Cap `seconds` to a defensible maximum (5-30 s); a 5-minute trace from a busy service is unusable.
- Honor request cancellation; if the operator hits Ctrl-C, stop.
- Only one capture at a time, process-wide. `trace.Start` returns an error if already started.

---

## 5. Sentinel-driven captures

A common pattern: trigger a flight-recorder dump from a watcher goroutine.

```go
func sentinel(fr *trace.FlightRecorder) {
    tick := time.NewTicker(5 * time.Second)
    defer tick.Stop()
    last := time.Time{}

    for range tick.C {
        var samples = []metrics.Sample{
            {Name: "/sched/latencies:seconds"},
        }
        metrics.Read(samples)
        h := samples[0].Value.Float64Histogram()
        p99 := percentile(h, 0.99)

        if p99 > 50*time.Millisecond && time.Since(last) > time.Minute {
            f, _ := os.Create(fmt.Sprintf("flight-%d.out", time.Now().Unix()))
            fr.WriteTo(f)
            f.Close()
            last = time.Now()
            log.Printf("sentinel: dumped flight recorder, p99 sched=%v", p99)
        }
    }
}
```

This is the production version of "I'll grab a trace if it happens again." Once the sentinel proves itself, you can route the dumps to S3 or a local incident bucket.

---

## 6. Cost budgeting

| Component | Cost when off | Cost when on | Notes |
|-----------|---------------|--------------|-------|
| `trace.Start` (one-shot) | 0 | 5-10% CPU, up to 50 MB/s output | Bounded by the `seconds` arg |
| Flight recorder | 0 | 5-10% CPU, RAM = `MaxBytes` | No I/O until `WriteTo` |
| pprof endpoint imports | 0 | Negligible (registers handlers) | Don't import into the public mux |
| `runtime/metrics` polling | 0 | < 0.1% per second | Pull this constantly |

A reasonable production setup: pprof+trace endpoints always available on admin, flight recorder always running with a 64 MiB ring, sentinel triggering dumps on SLO breach, manual on-demand captures throttled to once per minute.

---

## 7. Tracing context across the trace tool and your APM

Distributed tracing (OpenTelemetry, Datadog APM) gives you span timing across services. The Go execution tracer gives you in-process detail. Bridge them:

```go
func (h *Handler) handle(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    span := trace.SpanFromContext(ctx)            // OTel
    traceID := span.SpanContext().TraceID().String()

    rtctx, task := runtimetrace.NewTask(ctx, "http-"+r.URL.Path)
    defer task.End()
    runtimetrace.Logf(rtctx, "otel", "trace_id=%s", traceID)

    // ... handler body uses rtctx ...
}
```

Now, in your APM, you can attach the OTel trace ID to a "open execution trace" link that filters the `go tool trace` "User-defined log messages" view by that ID. When an APM span looks suspicious, you jump straight into the runtime trace for that exact request.

---

## 8. Building a custom analyzer

The trace file is decodable programmatically via `golang.org/x/exp/trace`. A surprisingly useful analyzer to keep in your team toolbox: **goroutine state aggregator**.

```go
import xtrace "golang.org/x/exp/trace"

func summarize(path string) {
    f, _ := os.Open(path)
    r, _ := xtrace.NewReader(f)

    blocked := map[string]time.Duration{}
    for {
        ev, err := r.ReadEvent()
        if err == io.EOF { break }
        if ev.Kind() != xtrace.EventStateTransition { continue }
        st := ev.StateTransition()
        if st.Resource.Kind != xtrace.ResourceGoroutine { continue }
        from, to := st.Goroutine()
        if from == xtrace.GoRunning && to.Executing() == false {
            // record blocking site
            blocked[ev.Stack().String()] += /* compute duration */ 0
        }
    }
    // print top-N blocking sites
}
```

This kind of one-off analyzer answers questions the viewer can't: "which goroutine started function blocks for the most cumulative time?" or "how often does goroutine X get preempted before completing?" Build them as needs arise; share via internal libraries.

---

## 9. Per-request tracing in production

The pattern that scales: emit a task per inbound request, regions per phase, and tasks per outbound RPC.

```go
func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
    ctx, task := trace.NewTask(r.Context(), "http "+r.Method+" "+r.URL.Path)
    defer task.End()

    trace.WithRegion(ctx, "auth", func() { h.auth(ctx, r) })
    var data Data
    trace.WithRegion(ctx, "db", func() { data = h.fetch(ctx, r) })
    trace.WithRegion(ctx, "render", func() { h.render(ctx, w, data) })
}
```

Cost: each task/region is a couple of hundred nanoseconds. For a handler that does milliseconds of work, that's noise. For a 100-ns hot path, skip the regions and use logs instead.

When a customer reports "request X was slow at 14:32", you grab the flight-recorder dump, filter the "User-defined tasks" view by the task name, and see exactly which region took the time.

---

## 10. Trace + metrics + logs: the trio

In real triage, you don't pick one. You read them together:

| Signal | Strength | Weakness |
|--------|----------|----------|
| Metrics (`runtime/metrics`, Prometheus) | Always-on, cheap, aggregate | Tells you *something* is wrong, not *why* |
| Logs | Causal narrative, easy to query | No timing, sparse |
| Trace | Microsecond truth | Expensive, point-in-time |

The flow: a metric (p99 latency) breaches → a log line confirms the timing → you trigger a trace dump and read the actual scheduler behavior at that moment. Skip any of the three and triage becomes a guessing game.

---

## 11. CI integration

A unit-test trace, captured in CI and stored as a build artifact, is the best way to catch a regression in scheduler behavior:

```yaml
# .github/workflows/test.yml
- name: Run benchmark with trace
  run: |
    go test -bench=BenchmarkCriticalPath -benchtime=1s \
      -trace=trace.out ./internal/critical/...
- name: Upload trace
  uses: actions/upload-artifact@v4
  with:
    name: trace
    path: trace.out
```

When a PR regresses latency, you download the artifact from before and after, open both in `go tool trace`, and the difference (more GC pauses? new contention? higher sched-wait?) is usually obvious.

---

## 12. Comparing two traces

`go tool trace` doesn't natively diff two traces, but you can:

1. Open both in two browser tabs side-by-side, matching time scales (`f` to zoom to selection).
2. Use `golang.org/x/exp/trace` to extract per-goroutine summaries and diff them with `benchstat`-style tooling.
3. Capture both with identical `runtime/trace` user regions and compare per-region totals.

A small internal CLI that prints "total time per region, sorted by delta" turns trace comparison into a routine code-review step for performance work.

---

## 13. The on-call runbook for "trace says X"

When the on-call sees a trace, here's the decision tree:

1. **STW > 1 ms?** → GC regression. Check `runtime/metrics` `/gc/pauses:seconds`; correlate with allocation rate; bisect recent commits for new allocations.
2. **`Sched wait` huge, `Running` small?** → Oversubscription. Look for `go func()` loops without bounded concurrency. Tune worker pool.
3. **Long `gcAssistAlloc` slices?** → Allocator outrunning pacer. Set or raise `GOMEMLIMIT`; reduce allocation rate.
4. **Single goroutine running, others blocked on `Mutex`?** → Lock contention. Capture mutex profile (`/debug/pprof/mutex`); shorten the critical section or partition the lock.
5. **Long `GoBlockNet` slices on internal calls?** → Backend service is slow; trace the downstream service.
6. **Sudden goroutine count surge with no work?** → Leak. Capture goroutine profile (`/debug/pprof/goroutine?debug=2`); find the stuck stacks.
7. **All P lanes silent except one?** → Serial bottleneck. Find the long single-goroutine slice; restructure to fan out.

Print this on the runbook page. The fixes are usually well-known; the diagnosis is the part that requires the trace.

---

## 14. Things never to do

| Anti-pattern | Why |
|--------------|-----|
| `trace.Start` in `init` and `trace.Stop` in `defer main` | Produces a multi-hour trace, unreadable, terabytes of output |
| Forgetting to call `trace.Stop` | File is truncated, viewer errors |
| Capturing the trace into a `bytes.Buffer` in memory | Pinned memory equal to trace size; OOM risk |
| Triggering captures from a user-facing endpoint | One curl from a stranger DoSes your process |
| Reading a trace with mismatched Go versions | "unknown event" errors, partial decoding |
| Comparing absolute times between traces from different machines | Clocks aren't synced; only durations carry over |

---

## 15. Summary

Production tracing is built around the flight recorder (always-on, dump-on-demand), a localhost admin endpoint, sentinel-driven captures, and integration with your distributed tracing system. Capture short windows, store dumps as incident artifacts, and stitch trace IDs across your APM and `runtime/trace`. Build small analyzers with `golang.org/x/exp/trace` for questions the viewer can't answer; gate releases on benchmark traces archived from CI. The trace is the most expensive tool in the box; treat it like a controlled substance.

---

## Further reading
- Flight recorder proposal: https://go.dev/issue/63185
- `golang.org/x/exp/trace`: https://pkg.go.dev/golang.org/x/exp/trace
- Go diagnostics guide: https://go.dev/doc/diagnostics
- "Diagnose user-perceived latency with execution traces" (Go blog): https://go.dev/blog/execution-traces-2024
