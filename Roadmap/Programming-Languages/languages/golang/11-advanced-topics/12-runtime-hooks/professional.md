# Runtime Hooks — Professional

## 1. The production framing

Runtime hooks in production are not a debugging activity, they are an *operational interface*. They are how your service tells the platform what it needs and how the platform tells your service what to do. The professional checklist:

1. **Negotiate the memory budget** with the platform team and wire it into `GOMEMLIMIT` from the container's real limit, not a hardcoded value.
2. **Wire `GOMAXPROCS`** to the CPU limit (or rely on Go 1.25's built-in cgroup awareness).
3. **Expose `runtime/metrics`** to your monitoring system on a stable contract.
4. **Run an admin pprof endpoint** behind auth or on localhost — never public.
5. **Forward crash output** to your central log/storage with `SetCrashOutput`.
6. **Graceful shutdown** via `signal.NotifyContext` + `Shutdown` + bounded drain timeout.
7. **Have a runbook** for the three classic incidents: OOM, goroutine leak, p99 spike.

The rest of this page is what that wiring actually looks like.

---

## 2. Wiring `GOMEMLIMIT` from cgroups

Pre-1.25 the canonical solution was the `automemlimit` library:

```go
import (
    _ "go.uber.org/automaxprocs"   // CPU
    "github.com/KimMachineGun/automemlimit/memlimit"
)

func init() {
    _, err := memlimit.SetGoMemLimitWithOpts(
        memlimit.WithRatio(0.9),
        memlimit.WithProvider(memlimit.FromCgroup),
    )
    if err != nil {
        log.Printf("automemlimit: %v", err)
    }
}
```

This reads `/sys/fs/cgroup/memory.max` (cgroup v2) or `memory.limit_in_bytes` (v1), multiplies by 0.9, and calls `debug.SetMemoryLimit`. The 10% headroom covers cgo allocations and kernel accounting that `GOMEMLIMIT` doesn't see.

For Go 1.25+, `GOMAXPROCS` honors CPU quotas natively — drop `automaxprocs`. `GOMEMLIMIT` still needs `automemlimit` or your own equivalent.

Verification under load:

```bash
# Show the live setting
curl -s localhost:8080/debug/runtime/memlimit
# Compare against
kubectl describe pod ... | grep -i memory
```

---

## 3. Exposing `runtime/metrics` to Prometheus

The official Prometheus client `client_golang` ships a collector that exports the full `runtime/metrics` namespace.

```go
import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/collectors"
)

func registerRuntimeMetrics(reg prometheus.Registerer) {
    reg.MustRegister(
        collectors.NewGoCollector(
            collectors.WithGoCollections(
                collectors.GoRuntimeMetricsCollection |
                    collectors.GoRuntimeMemStatsCollection,
            ),
        ),
    )
}
```

The two collections are independent: `GoRuntimeMetricsCollection` is the modern stream (histograms!), `GoRuntimeMemStatsCollection` is the legacy `ReadMemStats` view kept for dashboards that reference `go_memstats_*`. Migrate dashboards onto the modern names; the legacy ones cost a STW on each scrape.

Dashboard panels every service should have:

| Panel | PromQL |
|-------|--------|
| Heap live | `go_memory_classes_heap_objects_bytes` |
| GC CPU % | `rate(go_cpu_classes_gc_total_cpu_seconds_total[5m]) / rate(process_cpu_seconds_total[5m])` |
| GC pause p99 | `histogram_quantile(0.99, sum by (le) (rate(go_gc_pauses_seconds_bucket[5m])))` |
| Goroutines | `go_sched_goroutines_goroutines` |
| Scheduler latency p99 | `histogram_quantile(0.99, sum by (le) (rate(go_sched_latencies_seconds_bucket[5m])))` |

The last one — scheduler latency — is the underrated metric. If it rises while CPU is unsaturated, you have a GOMAXPROCS misconfiguration or a busy loop blocking preemption.

---

## 4. Safe pprof endpoint

```go
import (
    "net/http"
    "net/http/pprof"
)

func startAdminServer() {
    mux := http.NewServeMux()
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
    mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
    mux.HandleFunc("/version", versionHandler)
    mux.HandleFunc("/healthz", healthHandler)

    srv := &http.Server{
        Addr:    "127.0.0.1:6060",
        Handler: mux,
    }
    go func() {
        if err := srv.ListenAndServe(); err != nil {
            log.Printf("admin server: %v", err)
        }
    }()
}
```

Two rules that get ignored at every junior shop:

1. **Bind admin to localhost.** `127.0.0.1:6060` is invisible to the outside world; tunneling in via `kubectl port-forward` or SSH is the friction you want.
2. **Don't register pprof on `http.DefaultServeMux`.** The single side-effect import `_ "net/http/pprof"` mounts handlers on `DefaultServeMux`; if you also `http.ListenAndServe(":80", nil)` you just published your source structure to the internet.

---

## 5. Crash forwarding with `SetCrashOutput`

```go
import "runtime/debug"

func setupCrashLog() (cleanup func() error) {
    path := fmt.Sprintf("/var/log/myapp/crash-%d-%d.log", os.Getpid(), time.Now().Unix())
    f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_APPEND, 0o600)
    if err != nil {
        log.Printf("crash log: %v", err)
        return func() error { return nil }
    }
    if err := debug.SetCrashOutput(f, debug.CrashOptions{}); err != nil {
        f.Close()
        log.Printf("SetCrashOutput: %v", err)
        return func() error { return nil }
    }
    return f.Close
}

func main() {
    cleanup := setupCrashLog()
    defer cleanup()
    // ... run server ...
}
```

For S3 forwarding the pattern is: write to a local file (cheap, lock-free), and run a separate sidecar process (or `fluentd`/`vector`) that tails the file and ships records. **Do not** write to a network socket directly from inside the crash handler — networking can deadlock with whatever caused the crash.

For Kubernetes, a common shape: write `/dev/termination-log` so the kubelet attaches the panic to the pod's status, plus a per-process crash file shipped by your log aggregator.

---

## 6. Graceful shutdown

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    srv := &http.Server{Addr: ":8080", Handler: routes()}
    errc := make(chan error, 1)
    go func() { errc <- srv.ListenAndServe() }()

    select {
    case err := <-errc:
        log.Fatal(err)
    case <-ctx.Done():
        log.Print("shutdown signal received")
    }

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Printf("shutdown: %v", err)
        os.Exit(1)
    }
    log.Print("shutdown complete")
}
```

The 30 seconds is your **drain budget** — long enough for in-flight requests but shorter than the orchestrator's grace period. If the platform sends SIGKILL after 60 s, drain in 30 s and use the remaining time for log flushing, metric scraping, and cleanup deferreds.

A subtlety: `os.Exit` does **not** run `defer`s. If you must call it (after an unrecoverable error in shutdown), call your log flusher and metric flusher manually first.

---

## 7. Health endpoints that mean something

```go
type Health struct {
    started time.Time
}

func (h *Health) ready(w http.ResponseWriter, r *http.Request) {
    if time.Since(h.started) < 5*time.Second {
        http.Error(w, "warming up", http.StatusServiceUnavailable)
        return
    }
    var gs uint64
    s := []metrics.Sample{{Name: "/sched/goroutines:goroutines"}}
    metrics.Read(s)
    gs = s[0].Value.Uint64()
    if gs > 100_000 {
        http.Error(w, "too many goroutines", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
}
```

A `/readyz` that just returns 200 is a placebo. A real one checks **invariants** that, if violated, mean the pod is sick: goroutine count above a threshold, GC CPU above 50%, scheduler latency above 100 ms, or a per-service business signal. Don't go overboard — pick three indicators that empirically correlate with user-visible failure.

---

## 8. Continuous profiling

The pattern that has displaced ad-hoc pprof use:

```go
import "cloud.google.com/go/profiler" // or pyroscope, parca, datadog-profiler...

func main() {
    cfg := profiler.Config{
        Service:        "checkout",
        ServiceVersion: vcsRevision(),
        ProjectID:      "my-project",
    }
    if err := profiler.Start(cfg); err != nil {
        log.Printf("profiler: %v", err)
    }
    // ...
}
```

Continuous profilers attach periodically (every 10 minutes for CPU, etc.), aggregate samples server-side, and let you ask "what allocated in the p99 latency window yesterday" without scheduling a capture. They cost 1–2% CPU. For any service hot enough to need pprof regularly, run a continuous profiler instead.

Parca and Pyroscope are self-hostable; GCP, Datadog, and Sentry sell hosted variants. All consume the standard Go pprof format.

---

## 9. Tracing one request end-to-end

`runtime/trace` is for *runtime* tracing — scheduler behavior, goroutine lifetimes. For *distributed* tracing across services, use OpenTelemetry. The two are complementary:

```go
import (
    "go.opentelemetry.io/otel"
    "runtime/trace"
)

func handle(ctx context.Context, req *Request) {
    // Distributed trace span
    ctx, span := otel.Tracer("checkout").Start(ctx, "handle")
    defer span.End()

    // Runtime trace region (visible in `go tool trace`)
    trace.WithRegion(ctx, "handle", func() {
        process(ctx, req)
    })
}
```

The OpenTelemetry span carries the request across service boundaries; the runtime region tells you whether the time inside this service was spent on-CPU, blocked on GC, or waiting on the scheduler. When you have to debug "why was this one request slow" you usually want both.

---

## 10. Capturing a trace from a running process

```go
// In your admin mux:
mux.HandleFunc("/debug/trace", func(w http.ResponseWriter, r *http.Request) {
    sec, _ := strconv.Atoi(r.URL.Query().Get("seconds"))
    if sec <= 0 || sec > 60 {
        sec = 5
    }
    w.Header().Set("Content-Type", "application/octet-stream")
    if err := trace.Start(w); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    time.Sleep(time.Duration(sec) * time.Second)
    trace.Stop()
})
```

`curl -o trace.out localhost:6060/debug/trace?seconds=10` gives you a usable trace. `go tool trace trace.out` opens the browser viewer. Bound the duration server-side — uncapped traces from production are how you DOS your own service.

---

## 11. The Dockerfile, runtime-hooked

```dockerfile
FROM golang:1.24 AS build
WORKDIR /src
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOFLAGS="-trimpath" \
    go build -ldflags="-s -w -X main.gitRev=$(git rev-parse HEAD)" \
    -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/server /server
ENV GOMEMLIMIT=900MiB \
    GODEBUG=madvdontneed=0 \
    GOGC=100
USER 65532:65532
ENTRYPOINT ["/server"]
```

The environment variables here are **defaults**; the deployment overrides them. Keeping them in the image means the binary still runs locally for testing.

`GODEBUG=madvdontneed=0` is the explicit "use `MADV_FREE`" — fine on managed platforms. Switch to `madvdontneed=1` if you observe RSS-vs-heap drift confusing your platform team's billing dashboards.

---

## 12. Capacity planning hooks

A small startup probe that emits known constants for your capacity model:

```go
import "runtime/debug"

func emitBudget() {
    log.Printf("budget GOMAXPROCS=%d GOMEMLIMIT=%d GOGC=%d build=%s",
        runtime.GOMAXPROCS(0),
        debug.SetMemoryLimit(-1),  // read-only
        debug.SetGCPercent(-1),    // read-only — but careful: this also disables GC if you don't restore
        vcsRevision(),
    )
}
```

Caveat: `SetMemoryLimit(-1)` is documented as "report current and do not change". `SetGCPercent(-1)` is documented as "disable GC and return previous" — **not** read-only. Read `GOGC` from `os.Getenv` if you only want to observe it.

Tracking the budget per-pod makes capacity planning numerical:

```
expected_rss = GOMEMLIMIT + 10% headroom + cgo + mappings
expected_max_cpu = GOMAXPROCS * 100%
```

These should match your platform's resource requests/limits within a small margin. Drift between them means somebody changed the env var without updating the manifest.

---

## 13. Per-handler labels for production pprof

```go
func withLabels(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        pprof.Do(r.Context(), pprof.Labels(
            "handler", routeName(r),
            "method", r.Method,
        ), func(ctx context.Context) {
            h.ServeHTTP(w, r.WithContext(ctx))
        })
    })
}
```

Wrap your top-level mux with this and every CPU profile you capture in production will be sliced by handler. `go tool pprof -tagfocus 'handler=/checkout' cpu.pprof` then shows only the checkout flow. The overhead is one map lookup per request — invisible.

---

## 14. The three runbook entries

**OOMKill.** Capture: `kubectl describe pod` (cause), `kubectl logs --previous` (last stderr), `kubectl exec` to the sidecar for the local crash log (if `SetCrashOutput` was wired). Hypothesis check: heap profile diff between healthy and pre-kill. Fix path: increase limit + `GOMEMLIMIT`, or reduce allocations.

**Goroutine leak.** Capture: `curl localhost:6060/debug/pprof/goroutine?debug=2` (full text dump). Diff the same query 10 minutes later. Look for `chan receive (nil chan)`, `IO wait`, or a single growing stack frame. Fix path: `context.Context` propagation through whatever goroutine is leaking.

**p99 spike.** Capture: a CPU profile (`/debug/pprof/profile?seconds=30`) during the incident, plus a `go tool trace` snapshot. Cross-check `go_gc_pauses_seconds` p99 in the same window. Common causes: GC under memory pressure, mutex contention, scheduler starvation from `LockOSThread` abuse.

---

## 15. Summary

Production runtime hooks are an operational interface. Set `GOMEMLIMIT` from the cgroup, expose `runtime/metrics`, run pprof on localhost, forward crash output with `SetCrashOutput`, label your CPU profiles per handler, and put `signal.NotifyContext` at the top of `main`. Treat the runtime as a managed dependency: you negotiate its budget, observe its behavior, and tune it from data — never from feeling.

---

## Further reading
- Continuous profiling at Google: https://research.google/pubs/google-wide-profiling-a-continuous-profiling-infrastructure-for-data-centers/
- Parca: https://www.parca.dev/
- Pyroscope / Grafana profiling: https://grafana.com/docs/pyroscope/
- `client_golang` Go collector: https://pkg.go.dev/github.com/prometheus/client_golang/prometheus/collectors
- OpenTelemetry Go: https://opentelemetry.io/docs/instrumentation/go/
- `automemlimit`: https://github.com/KimMachineGun/automemlimit
