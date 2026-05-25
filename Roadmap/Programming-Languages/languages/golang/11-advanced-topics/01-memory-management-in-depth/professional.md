# Memory Management in Depth — Professional

## 1. The production framing

In a real service, memory management is not "tune GOGC". It's a budget you negotiate with the platform team and a steady stream of small decisions in code review. The professional job, roughly:

1. **Set a memory budget** in your deployment manifest (cgroup, k8s limit, ECS memory) and *make the runtime aware of it* via `GOMEMLIMIT`.
2. **Bound allocation rate** in hot paths — pools, preallocation, careful interface use.
3. **Continuously observe** heap, GC CPU, allocation rate, and goroutine count.
4. **Detect and roll back** memory regressions on each release — they are the single most common silent SLO killer.
5. **Have a runbook** for OOM and "RSS climbing" incidents.

The rest of this file is what that looks like.

---

## 2. Setting `GOMEMLIMIT` correctly in containers

Pre-1.19 the standard trick was `automaxprocs` + heuristics. Now:

```yaml
# kubernetes deployment, container spec
resources:
  limits:
    memory: 2Gi
env:
  - name: GOMEMLIMIT
    value: "1800MiB"   # ~90% of the cgroup limit
  - name: GOGC
    value: "100"       # leave default unless you have data
```

Why 90%, not 100%? Because `GOMEMLIMIT` accounts for the Go runtime, but the process also uses memory you can't see — cgo allocations, mmap'd files via `syscall`, third-party C libraries. Reserve ~10% headroom.

For projects that can't change deployment, the [`go.uber.org/automemlimit`](https://github.com/KimMachineGun/automemlimit) library reads the cgroup limit at startup and sets `GOMEMLIMIT` for you. Acceptable in mature codebases; preferred over hand-tuning.

---

## 3. The four numbers your dashboards need

Build one panel per service with:

| Metric | Source | Alert when |
|--------|--------|------------|
| **RSS (process)** | `/proc/self/status` or container metric | Trending up over 24h |
| **Go live heap** | `runtime/metrics` `/gc/heap/live:bytes` | Steady-state climbs > 2× weekly baseline |
| **GC CPU fraction** | `/cpu/classes/gc/total:cpu-seconds` (rate) | > 20% sustained |
| **Goroutine count** | `runtime.NumGoroutine()` | Monotonic growth, no plateau |

The two pairs distinguish four failures:

- RSS up, heap flat → idle pages retained (cosmetic, but tune `MADV_DONTNEED` or `debug.FreeOSMemory`).
- RSS up, heap up → real leak or growing working set.
- GC CPU up, heap flat → allocation rate up; profile `-alloc_objects`.
- Goroutines up → leaked goroutines; see [07-goroutine-lifecycle-leaks](../../07-concurrency/07-goroutine-lifecycle-leaks/).

---

## 4. Exporting from `runtime/metrics` to Prometheus

```go
import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/collectors"
)

func init() {
    prometheus.MustRegister(
        collectors.NewGoCollector(
            collectors.WithGoCollections(collectors.GoRuntimeMetricsCollection),
        ),
    )
}
```

`GoRuntimeMetricsCollection` exports the modern `runtime/metrics` view, including pause histograms (`go_gc_pauses_seconds`) and per-class heap memory. The default collector (without `WithGoCollections`) is the legacy MemStats view — fine, but less expressive.

---

## 5. Multi-stage Dockerfile, memory-aware

```dockerfile
FROM golang:1.24 AS build
WORKDIR /src
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOFLAGS="-trimpath" \
    go build -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/server /server
ENV GOMEMLIMIT=900MiB GOGC=100
USER 65532:65532
ENTRYPOINT ["/server"]
```

Notes:

- `CGO_ENABLED=0` strips the cgo runtime; smaller image, no glibc dep.
- `-trimpath` and `-ldflags="-s -w"` produce a smaller, reproducible binary.
- The base is distroless `static`: no shell, no libc, smaller attack surface.
- `GOMEMLIMIT` is set in the image, but the deployment can override it.

---

## 6. `sync.Pool` in real handlers

```go
var reqBufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handle(w http.ResponseWriter, r *http.Request) {
    buf := reqBufPool.Get().(*bytes.Buffer)
    defer func() {
        if buf.Cap() < 64<<10 {     // drop oversized buffers
            buf.Reset()
            reqBufPool.Put(buf)
        }
    }()

    if _, err := io.Copy(buf, r.Body); err != nil {
        http.Error(w, err.Error(), 400)
        return
    }
    // ... process buf ...
}
```

Three rules:

1. **Always `Reset` before putting back.** Otherwise you leak references through the pooled object.
2. **Drop oversized values.** Otherwise one 64 MiB request pins 64 MiB until the next GC cycle.
3. **Type-assert exactly once.** If callers do `.(*bytes.Buffer)` everywhere, the type is part of the contract — encode it.

---

## 7. Allocation budgets in benchmarks

```go
func BenchmarkHandler(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = handle(req, resp)
    }
}
```

Then enforce via CI:

```bash
go test -bench=. -benchmem -run=^$ -count=10 ./... | tee new.txt
benchstat baseline.txt new.txt
```

A PR that takes `BenchmarkHandler` from 12 allocs/op to 24 allocs/op is **a regression**, even if latency is unchanged. The 2× allocation hits you in GC CPU under load, not in the microbenchmark. Treat alloc count as a tracked metric.

---

## 8. Memory regression detection in production

Two practical patterns:

**Canary diff.** Deploy to 1% of traffic for an hour. Compare `live_heap`, `gc_cpu`, and `goroutines` against the previous version. Block the rollout if any of the three rises more than (say) 15%.

**Steady-state probe.** A small synthetic-load goroutine runs the same N requests in a loop, every hour, and snapshots `runtime/metrics`. Plot week-over-week. Slow leaks show up here before customers do.

Both are cheap to build and worth their cost during the first year of a service's life.

---

## 9. The "RSS climbing" runbook

When the on-call dashboard shows RSS up but live heap flat:

1. Hit `/debug/pprof/heap` and `/debug/pprof/heap?debug=2` (in-use bytes + allocation graph).
2. Compare `HeapInuse` vs `HeapAlloc`. A wide gap = lots of partially used spans = fragmentation. A narrow gap = the runtime simply hasn't returned pages yet.
3. Check `HeapReleased` against time-since-restart. Slow returns are normal with `MADV_FREE`.
4. If you must, call `debug.FreeOSMemory()` from a maintenance endpoint (`/admin/free-os`) — but log it loudly. Then start a ticket to remove that endpoint.
5. If `HeapAlloc` is also growing, this is a leak. Capture two profiles 30 minutes apart, `pprof -base old.pb.gz new.pb.gz`, look at the diff.

---

## 10. Standard library footguns at scale

| Pattern | Hidden cost |
|---------|-------------|
| `encoding/json` with `interface{}` decoding | Many small allocations per field; consider `json.RawMessage` or codegen |
| `http.Request.Body` not closed | Connection isn't returned to the pool, retained until GC |
| `fmt.Sprintf` in hot paths | Allocates the format args slice, the formatter, the result |
| `regexp.MustCompile` inside handlers | Allocates the regex every call; compile once at package init |
| `time.After` in long-lived selects | Timer + goroutine + closure, not collected until fired |
| `context.WithTimeout` without cancel | Leaks the timer and goroutine until expiry |
| `range` over a large map for filtering | Allocates iteration state; prefer key lookup |

These are not micro-optimizations; they are the difference between a service that holds steady at 500 MiB and one that drifts to 5 GiB over a week.

---

## 11. Production-grade pprof endpoint

```go
import _ "net/http/pprof"
import "net/http"

func startProfiler() {
    mux := http.NewServeMux()
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/heap", pprof.Index)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    mux.HandleFunc("/debug/pprof/allocs", pprof.Index)
    mux.HandleFunc("/debug/pprof/goroutine", pprof.Index)

    go http.ListenAndServe("127.0.0.1:6060", mux)  // localhost only
}
```

Two musts:

- **Bind to localhost** (or behind an admin auth). `pprof` endpoints expose source-level info; never put them on a public port.
- **Don't import `net/http/pprof` into your main listener.** It registers handlers on `http.DefaultServeMux`, which is then shared with whatever else you registered there. Use a dedicated mux on a dedicated port.

---

## 12. Capacity planning

For a server at steady state:

```
peak_rss ≈ live_heap × (1 + GOGC/100) + stacks × goroutines + fixed_overheads + cgo
```

Rough numbers for a typical Go service:

- Fixed overheads: 30–80 MiB (runtime, libraries, mappings).
- Per-goroutine stack: 4–8 KiB after a few growths.
- `GOGC=100` adds a 100% headroom over live.

If `live_heap=400 MiB` and `goroutines=2000`, expect peak RSS around 800 MiB + 16 MiB + 50 MiB ≈ ~870 MiB. Add 10–20% safety, deploy with a 1 GiB limit, set `GOMEMLIMIT=900MiB`.

---

## 13. When to give up and pre-allocate

For latency-sensitive code paths, the allocator's fast path is fast, but it's never free. If a hot loop must hit zero allocations:

1. Use `sync.Pool` for variable-sized buffers.
2. Use slab arrays for fixed-size objects with bounded counts.
3. Pass output slices in (`(*MyResult).Decode(buf, dst)`), don't return new ones.
4. Avoid interfaces in the hot path; use generics or type-specific code.
5. Audit with `-benchmem` and `pprof -alloc_objects`.

Zero-alloc Go is achievable for kernels of routing, parsing, encoding code. It is not a goal for whole services.

---

## 14. Summary

Production memory management is budgeting plus observability. Set `GOMEMLIMIT` from the platform's memory limit, watch RSS / live heap / GC CPU / goroutines as four independent signals, gate releases on allocation regressions, and keep a runbook for the two failure modes (real leak vs. retained idle pages). Reach for `sync.Pool` and pre-allocation surgically in hot paths; let the runtime do its job everywhere else.

---

## Further reading
- `GOMEMLIMIT` & container memory: https://go.dev/doc/gc-guide#Memory_limit
- `automemlimit`: https://github.com/KimMachineGun/automemlimit
- Distroless images: https://github.com/GoogleContainerTools/distroless
- Prometheus Go collector: https://pkg.go.dev/github.com/prometheus/client_golang/prometheus/collectors
