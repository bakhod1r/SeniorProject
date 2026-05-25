# Memory Profiling in Go — Professional

## 1. Profiling as an SLO input, not a debugging tool

At a serious operational level, memory profiling is part of the platform, not a thing someone occasionally opens after an incident. The professional version of this discipline:

1. **Every service exposes `/debug/pprof` on an admin port** (never the public one).
2. **A continuous profiler scrapes heap samples** every 10–15 seconds, persists them, and lets operators diff across any window.
3. **Release pipelines gate on allocation regressions** measured in CI benchmarks (`benchstat` against the last release).
4. **Production dashboards show RSS, live heap, GC CPU, and allocation rate** side by side — alerts are tuned to the *combination*, not any single metric.
5. **Runbooks exist for each of the four memory-failure shapes** (real leak, retained idle pages, allocation rate spike, goroutine leak).

The rest of this file is what those pieces look like in code and configuration.

---

## 2. The continuous-profiling stack

| Tool | Hosting model | Storage | Notes |
|------|---------------|---------|-------|
| Pyroscope (Grafana) | Self-hosted or Grafana Cloud | Single binary, ClickHouse-backed | Open source; flame graphs and diffs in UI |
| Parca | Self-hosted | Object storage | Open source; ships an agent that scrapes pprof |
| Datadog Continuous Profiler | SaaS only | Datadog | Ties profiles to APM traces |
| Google Cloud Profiler | SaaS | Google Cloud | Tight integration with Cloud Trace |
| Polar Signals | SaaS or self-hosted | Object storage | Same engine as Parca |

What they share: a low-cadence scrape of `/debug/pprof/heap`, deduplication of sample stacks, and a UI to diff "this window" against "that window". The overhead at default `MemProfileRate` is negligible — under 1% CPU in our measurements on a 10k QPS service.

Setup for Pyroscope (minimal):

```go
import "github.com/grafana/pyroscope-go"

func init() {
    pyroscope.Start(pyroscope.Config{
        ApplicationName: "myapp",
        ServerAddress:   "http://pyroscope:4040",
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileAllocObjects,
            pyroscope.ProfileAllocSpace,
            pyroscope.ProfileInuseObjects,
            pyroscope.ProfileInuseSpace,
        },
    })
}
```

The agent inside `pyroscope-go` calls `pprof.Lookup("heap").WriteTo` on a schedule and POSTs the result. Server-side, you query by `app=myapp, profile_type=inuse_space, time=[-30m]`.

---

## 3. The "is it a leak?" runbook

When the on-call dashboard fires on rising heap:

1. **Snapshot the heap.** `curl -s http://localhost:6060/debug/pprof/heap?gc=1 -o /tmp/h0.pb.gz`
2. **Wait the leak interval.** 5–30 minutes depending on the rate.
3. **Snapshot again.** `curl -s http://localhost:6060/debug/pprof/heap?gc=1 -o /tmp/h1.pb.gz`
4. **Diff.** `go tool pprof -base /tmp/h0.pb.gz -http=:8080 /tmp/h1.pb.gz`
5. **Read the top frames.** The site at the top of the diff is the leak source, modulo noise.
6. **Cross-check.** Sort by `alloc_objects` too — sometimes the leak is "many small things" rather than "few big things".
7. **Check goroutines.** `curl -s http://localhost:6060/debug/pprof/goroutine -o /tmp/g.pb.gz` — a goroutine count rising in lockstep is the cause, not the consequence.
8. **Look at `runtime.MemStats`.** If `HeapAlloc` and `HeapInuse` agree, real leak. If `HeapInuse` >> `HeapAlloc`, fragmentation.
9. **Mitigate.** Restart, rate-limit, or roll back. Then fix the bug.

This is dull and effective. Run it the same way every time.

---

## 4. Regression detection in CI

```bash
# baseline
git checkout main
go test -bench=. -benchmem -count=10 -run=^$ ./... > baseline.txt

# candidate
git checkout feat/my-change
go test -bench=. -benchmem -count=10 -run=^$ ./... > candidate.txt

benchstat baseline.txt candidate.txt
```

`benchstat` output looks like:

```
name             old time/op    new time/op    delta
Handler-8           520µs ± 2%     535µs ± 3%   +2.88%  (p=0.001 n=10+10)

name             old alloc/op   new alloc/op   delta
Handler-8           14.0kB ± 0%    28.0kB ± 0%  +100.00%  (p=0.000 n=10+10)

name             old allocs/op  new allocs/op  delta
Handler-8            120 ± 0%       240 ± 0%  +100.00%  (p=0.000 n=10+10)
```

The `delta` columns are the headline. Wire `benchstat -delta-test=mannwhitney -alpha=0.05` into CI and fail the build if `alloc/op` or `allocs/op` regress by more than a configured threshold (say 10%) with p < 0.05.

This catches more memory regressions than monitoring ever will — by the time monitoring trips, the change is already in production for hours.

---

## 5. Heap profiles tied to traces

Pyroscope, Datadog, and Parca all support **profile-to-trace** linking: a span in a distributed trace can carry the heap profile captured during its execution. When a span is slow because the GC ran twice during it, the profile is one click away.

In code, this means tagging profiles with the active span ID:

```go
import "runtime/pprof"

labels := pprof.Labels("trace_id", traceID, "endpoint", "/api/v1/orders")
pprof.Do(ctx, labels, func(ctx context.Context) {
    handleOrder(ctx)
})
```

Allocations within `handleOrder` are tagged with both labels. The continuous profiler can then filter to "show me allocations in `/api/v1/orders` only" or "show me allocations for trace_id X". The overhead is one map lookup per allocation, on top of the existing sampling rate — still negligible.

---

## 6. The four-numbers dashboard, professional version

| Metric | Source | Alert rule |
|--------|--------|------------|
| **Live heap** (`/gc/heap/live:bytes`) | `runtime/metrics` | rising slope > 5%/hour for 6h |
| **Allocation rate** (`/gc/heap/allocs:bytes` rate) | `runtime/metrics` | > 2× weekly p95 for 15 min |
| **GC CPU fraction** (`/cpu/classes/gc/total:cpu-seconds` rate) | `runtime/metrics` | > 20% sustained 10 min |
| **Goroutine count** (`/sched/goroutines:goroutines`) | `runtime/metrics` | monotonic 30 min no plateau |
| **RSS** | `/proc/self/status` or container | RSS / heap > 3× |
| **Resident vs released** | `HeapReleased` / `HeapSys` | < 50% returned after a peak |

Alert combinations matter more than thresholds:

- Live heap up **and** allocation rate flat → bytes per allocation increased; profile `alloc_space`.
- Allocation rate up **and** GC CPU up → real allocation hot path; profile `alloc_objects`.
- RSS up **and** live heap flat **and** allocation rate flat → idle pages retained; runbook says don't act.
- Goroutines up **and** live heap up → goroutine leak that retains heap; profile the `goroutine` endpoint, not heap.

---

## 7. The Dockerfile that ships pprof safely

```dockerfile
FROM golang:1.24 AS build
WORKDIR /src
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/server /server
ENV GOMEMLIMIT=900MiB GOGC=100
EXPOSE 8080
# pprof on a separate port, bound to localhost in code
EXPOSE 6060
USER 65532:65532
ENTRYPOINT ["/server"]
```

The pprof port is *exposed* but the server binds it to `127.0.0.1`. Operators access it via `kubectl port-forward`, never via a Service. This is the right shape — no public exposure of source-revealing endpoints, but full operator access.

---

## 8. The dedicated pprof mux

```go
import (
    "net/http"
    "net/http/pprof"
)

func startProfilerMux() {
    mux := http.NewServeMux()
    mux.HandleFunc("/debug/pprof/",         pprof.Index)
    mux.HandleFunc("/debug/pprof/cmdline",  pprof.Cmdline)
    mux.HandleFunc("/debug/pprof/profile",  pprof.Profile)
    mux.HandleFunc("/debug/pprof/symbol",   pprof.Symbol)
    mux.HandleFunc("/debug/pprof/trace",    pprof.Trace)

    srv := &http.Server{
        Addr:    "127.0.0.1:6060",
        Handler: mux,
    }
    go func() { _ = srv.ListenAndServe() }()
}
```

Why not just `import _ "net/http/pprof"` and a separate listener? Because the underscore import registers on `http.DefaultServeMux`, which leaks pprof handlers into every other listener that happens to use the default mux. The above is explicit and safe.

---

## 9. Leak detection runbook (production)

A real leak looks like a **steady positive slope** in live heap that doesn't return to baseline between traffic troughs.

1. **Identify the start.** Look at the live-heap graph for the inflection point. Correlate against deploys, configuration changes, and traffic patterns.
2. **Pin a baseline.** Take a heap profile *right at the inflection*. If you missed it, take one as soon as possible.
3. **Take a current profile.** With `?gc=1`.
4. **Diff.** Top growers are your candidates.
5. **Bisect deploys** if more than one shipped during the window.
6. **Reproduce locally** with synthetic load. If it doesn't reproduce, you're missing a production-only input (TLS, a specific tenant, a slow downstream).
7. **Write a regression test** before the fix — usually a benchmark that exercises the suspected path and asserts on `allocs/op`.
8. **Fix.** Roll out. Verify with the same diff method after the next traffic peak.

The runbook is boring on purpose. Memory bugs respond to discipline.

---

## 10. Memory budget enforcement in code review

A culture pattern that pays off: in code review, allocation-introducing changes need a sentence justifying the allocation. The grep pattern that flags candidates:

```bash
git diff main...HEAD -G '(make\(|append\(|fmt\.Sprintf|json\.Marshal|new\()'
```

Reviewers ask: "Is this allocation per request, per packet, or per program lifetime? Is it inside a hot path? Did you benchmark?" That conversation alone catches half of the future regressions.

For the hot paths, the team agrees on **allocation budgets**: "this handler must allocate at most 5 objects per request". Benchmarks assert it; reviewers enforce it. The budget moves with deliberate proposals, not by accident.

---

## 11. The microbenchmark that catches a regression

```go
func BenchmarkParseEvent(b *testing.B) {
    raw := []byte(`{"id":"e1","ts":1700000000,"payload":"..."}`)
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var ev Event
        if err := json.Unmarshal(raw, &ev); err != nil {
            b.Fatal(err)
        }
    }
}
```

Run it before and after a change:

```bash
go test -run=^$ -bench=BenchmarkParseEvent -benchmem -count=10 ./pkg > new.txt
benchstat baseline.txt new.txt
```

In a mature service, every package has at least one such benchmark for each hot path. The cost is small (a few minutes of CI), the value is enormous.

---

## 12. Heap profiles in incident postmortems

Every memory incident should produce three artifacts:

1. **The flame graph that identified the cause**, archived in the incident doc.
2. **A `pprof -base` showing the post-fix improvement**, captured from a canary or staging deploy.
3. **A new benchmark or test that would have caught it earlier**, in the repo.

The third is the one teams forget. Without it, the incident will recur. The benchmark doesn't have to be elaborate — `b.ReportAllocs()` plus an assertion on the count is often enough.

---

## 13. Profile retention and PII

`pprof` profiles contain function names and stack traces — not user data, but they reveal the code shape and may include literal field names from your decoded structs. Two rules:

- **Treat profiles like source code.** Don't share them publicly; store them in the same access tier as the repository.
- **Symbol-strip on rotation.** Old profiles older than, say, 90 days, can be aggregated to call-site frequency tables and the raw profiles discarded.

In regulated environments, also verify that no profile labels (added via `pprof.Labels`) carry PII. The label `user_id=42` would.

---

## 14. When to *stop* profiling

A profile that doesn't suggest an action is a sign the bottleneck is elsewhere. If three consecutive heap profiles show no growth and no hot site, the problem isn't heap allocation — it's CPU, lock contention, or downstream latency.

The professional move is to switch tools deliberately:

| Symptom | Profile to capture |
|---------|--------------------|
| Slow handler, no heap growth | CPU profile |
| Wide flame graph with `runtime.lock2` | Mutex profile |
| Wide flame graph with `runtime.gopark` | Block profile |
| Slow under low CPU and low memory | Execution trace (`go tool trace`) |
| Goroutines climbing | Goroutine profile, not heap |

Calling this out matters: hours spent reading a heap profile of a CPU problem are hours wasted.

---

## 15. Summary

Professional memory profiling is institutional, not personal. Continuous profilers scrape heap samples cheaply; CI gates on allocation regressions; dashboards expose four orthogonal signals; runbooks distinguish real leaks from RSS retention. The skills are the same as a senior's — diff profiles, pair with escape analysis, sort by the right metric — applied with discipline at the platform level. The single highest-leverage move is wiring `benchstat` into CI; the second is exposing `/debug/pprof` on every service from day one, behind an admin port.

---

## Further reading
- Pyroscope: https://grafana.com/oss/pyroscope/
- Parca: https://www.parca.dev/
- Datadog Continuous Profiler: https://docs.datadoghq.com/profiler/
- `pprof.Labels`: https://pkg.go.dev/runtime/pprof#Labels
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Production Go profiling at scale (Felix Geisendörfer): https://github.com/DataDog/go-profiler-notes
