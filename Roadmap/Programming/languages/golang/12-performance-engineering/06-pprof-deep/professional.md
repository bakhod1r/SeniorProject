# pprof Deep Dive — Professional

## 1. From "I can profile" to "we run profiling"

A senior engineer can read a profile. A professional builds the system that makes profiles cheap to collect, safe to expose, easy to compare across releases, and routine to inspect during incidents. The rest of this file is the work that turns pprof from a debugging tool into a production capability.

The four pillars:

1. A locked-down profiling endpoint on every service.
2. Continuous profiling that captures profiles automatically, week in, week out.
3. Label conventions so profiles can be sliced by route, tenant, version.
4. A small set of runbooks that everyone on call has read.

---

## 2. Production-safe pprof endpoint

```go
import (
    "net/http"
    "net/http/pprof"
    "runtime"
)

func startDebugServer(addr string) {
    mux := http.NewServeMux()

    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
    mux.HandleFunc("/debug/pprof/trace", pprof.Trace)

    // Enable block and mutex profiling with bounded overhead.
    runtime.SetBlockProfileRate(10000)        // sample ~1 in 10000 blocking ns
    runtime.SetMutexProfileFraction(100)      // sample 1% of contentions

    srv := &http.Server{
        Addr:    addr,
        Handler: mux,
    }
    go srv.ListenAndServe()
}
```

Operational rules:

- **Bind to `127.0.0.1`** (or a Unix socket). `pprof` endpoints leak source-level information; never expose them on a public port.
- **Use a dedicated mux and port.** The convenience side-effect `_ "net/http/pprof"` registers handlers on `http.DefaultServeMux`. If you also serve your application on `DefaultServeMux`, you've published your profiles. Always use an explicit mux for either path.
- **Enable block/mutex with a fraction**, not 1. A rate of `1` records every event and can cost noticeable CPU under contention.
- **Don't authenticate via cookies.** If you must expose the port through a proxy, use mTLS or a header secret.

Access pattern: `kubectl port-forward` from a workstation to the localhost-only port. No NetworkPolicy hole, no auth proxy.

---

## 3. Continuous profiling — what and why

The case for continuous profiling: most performance regressions land in production and stay invisible for weeks. By the time someone notices, the responsible commit is buried. Continuous profiling solves this by **storing profiles forever** and letting you `-base` compare any two timestamps.

Modern options:

| Tool | What it is | Storage model |
|------|------------|---------------|
| **Pyroscope / Grafana Pyroscope** | Self-hosted; agent pulls from `/debug/pprof/*` | Time-series indexed by labels |
| **Parca** | Self-hosted; eBPF + pprof agent | Open-source, kube-native |
| **GCP Cloud Profiler** | Managed; agent pushes from inside the process | Linked to GCP project |
| **AWS CodeGuru Profiler** | Managed; similar to GCP | Linked to AWS account |
| **Polar Signals Cloud** | Managed Parca | Hosted |
| **Datadog / NR continuous profiler** | Managed APM extension | Tied to vendor APM |

The pattern is the same regardless of vendor: a sidecar or in-process agent collects profiles at a fixed cadence (e.g., 30 s every 10 min), tags them with service/version/host/labels, and uploads.

---

## 4. Pyroscope-style agent setup

```go
import "github.com/grafana/pyroscope-go"

pyroscope.Start(pyroscope.Config{
    ApplicationName: "checkout-api",
    ServerAddress:   "http://pyroscope:4040",
    Tags: map[string]string{
        "version": buildInfo.Version,
        "env":     "prod",
        "region":  os.Getenv("REGION"),
    },
    ProfileTypes: []pyroscope.ProfileType{
        pyroscope.ProfileCPU,
        pyroscope.ProfileInuseObjects,
        pyroscope.ProfileInuseSpace,
        pyroscope.ProfileAllocObjects,
        pyroscope.ProfileAllocSpace,
        pyroscope.ProfileGoroutines,
        pyroscope.ProfileMutexCount,
        pyroscope.ProfileMutexDuration,
        pyroscope.ProfileBlockCount,
        pyroscope.ProfileBlockDuration,
    },
})
```

The agent itself uses `runtime/pprof` under the hood. The crucial value-add is the **label propagation**: any `pprof.Labels` you attach with `pprof.Do` become Pyroscope query dimensions. You can answer "show me the CPU flame graph for `/checkout` requests from `tenant=acme` in the last hour" without writing any new code.

---

## 5. Label conventions

Pick a small, consistent label vocabulary across all your services. A starting set:

| Label | Cardinality | Purpose |
|-------|-------------|---------|
| `service` | low | Service name |
| `version` | low | Build / commit |
| `env` | low | dev / staging / prod |
| `region` | low | Cloud region |
| `route` | medium | HTTP route pattern (`/api/v1/orders/:id`, not `/api/v1/orders/4839`) |
| `endpoint` | medium | RPC method name |
| `tenant` | high (in multi-tenant) | Customer ID |
| `priority` | low | Request priority class |

**Cardinality matters.** Pyroscope and Parca index by labels; high-cardinality labels (user_id, request_id) bloat the index and slow queries. Use `route` (the pattern), not the path with IDs.

Apply labels at the boundary of each request:

```go
func instrumented(next http.HandlerFunc, routePattern string) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx := pprof.WithLabels(r.Context(), pprof.Labels(
            "route", routePattern,
            "method", r.Method,
        ))
        pprof.Do(ctx, pprof.Labels(), func(ctx context.Context) {
            next(w, r.WithContext(ctx))
        })
    }
}
```

Wire this into your router middleware. Now every CPU sample taken during a handler invocation carries the route — a huge improvement in profile readability.

---

## 6. Labels and goroutines

`pprof.Do` labels the **current** goroutine. When the handler launches workers, those workers are unlabeled unless you explicitly extend them:

```go
labels := pprof.Labels("workunit", "batchJobX")

for i := 0; i < N; i++ {
    go func(i int) {
        // Worker starts unlabeled. Apply labels from the parent context here.
        pprof.SetGoroutineLabels(pprof.WithLabels(ctx, labels))
        worker(i)
    }(i)
}
```

A cleaner idiom:

```go
go func(i int) {
    pprof.Do(ctx, pprof.Labels("worker_id", strconv.Itoa(i)), func(ctx context.Context) {
        worker(ctx, i)
    })
}(i)
```

In a continuous profiling deployment, this means **every goroutine launched inside `pprof.Do` is unlabeled by default**. Plan for it: spawn helper goroutines from inside a `pprof.Do` block, or always re-label.

---

## 7. Continuous profiling vs. on-demand

You'll have both. Continuous profiling lives in the background, gives you the long view, and powers regressions detection. On-demand pprof lives on each pod's debug port and gives you the deep dive during an incident.

| Use case | Tool |
|----------|------|
| "Did this release regress CPU?" | Continuous (diff two windows) |
| "Why is this one pod slow right now?" | On-demand `pprof -http` |
| "What allocates over the next 24 h?" | Continuous |
| "Pod has 50k goroutines stuck" | On-demand `pprof goroutine?debug=2` |
| "Mutex contention spike at 14:23 yesterday" | Continuous |
| "Reproducer in a load test" | On-demand, save profiles to a folder |

Treat them as separate disciplines that share a tool.

---

## 8. Release-gate with profile diffs

Wire profile collection into your CI/CD:

```yaml
# pseudocode pipeline step
- name: "Collect baseline profile"
  run: |
    kubectl port-forward svc/myapp-baseline 6060:6060 &
    sleep 5
    curl -o baseline.pb.gz "http://localhost:6060/debug/pprof/profile?seconds=60"

- name: "Collect candidate profile"
  run: |
    kubectl port-forward svc/myapp-canary 6060:6060 &
    sleep 5
    curl -o candidate.pb.gz "http://localhost:6060/debug/pprof/profile?seconds=60"

- name: "Diff"
  run: |
    go tool pprof -text -base=baseline.pb.gz candidate.pb.gz | tee diff.txt
    # Custom script asserts no function regresses by > 20%
```

The trickiest part is reproducing the same load on both. The two practical patterns:

- **Canary in production traffic.** Route 1–5% of real traffic to the new version. Collect both profiles concurrently for 60 seconds. Diff. This is honest data but noisy.
- **Synthetic load test.** Replay a captured RPS pattern against both versions in a sandbox. More deterministic; less representative.

---

## 9. The four profiles to capture every release

For each release, archive these in your build artifacts:

| Profile | Why archive |
|---------|-------------|
| `cpu_60s.pb.gz` under steady-state load | Catch CPU regressions |
| `heap.pb.gz` at end of 30-min soak | Catch retained-memory regressions |
| `allocs.pb.gz` after 30-min soak | Catch allocation-rate regressions |
| `goroutine.pb.gz` at end | Catch leaked-goroutine regressions |

Six months later, when someone asks "what changed?", you have receipts.

```bash
# nightly snapshot script
DATE=$(date +%Y%m%d)
mkdir -p profiles/$DATE
for kind in profile heap allocs goroutine; do
  args=""
  [ "$kind" = profile ] && args="?seconds=60"
  curl -s "http://localhost:6060/debug/pprof/$kind$args" \
       -o "profiles/$DATE/$kind.pb.gz"
done
```

Store in object storage with a 1-year retention. Disk is cheap; regret is expensive.

---

## 10. GCP Cloud Profiler example

```go
import "cloud.google.com/go/profiler"

func main() {
    if err := profiler.Start(profiler.Config{
        Service:        "checkout-api",
        ServiceVersion: buildVersion,
        ProjectID:      "my-gcp-project",
        MutexProfiling: true,
    }); err != nil {
        log.Fatal(err)
    }
    runServer()
}
```

The agent runs in-process, captures profiles periodically, and uploads. The GCP console gives you a flame graph and a built-in diff between any two time windows. The data model is the same pprof format; you can download a `.pb.gz` from the UI and use `go tool pprof` locally.

Costs to budget: ~5% CPU overhead averaged, a few MiB per pod per day of network egress.

---

## 11. Operating block and mutex profiles at scale

These two are tricky in production:

- They are **disabled by default** because they cost something.
- The "right" sampling rate depends on contention level — too low and you see nothing, too high and you slow the program.

A reasonable default for a busy service:

```go
runtime.SetBlockProfileRate(10_000)        // 10 µs threshold (events ≥ 10 µs)
runtime.SetMutexProfileFraction(100)       // 1% of contention events
```

If you find a contention hotspot is too rare to show in the default profile, lower temporarily via an admin endpoint, capture, restore. Don't leave it at `1` in steady-state.

---

## 12. Cross-process diff (canary)

```
# canary pod
curl -s "http://canary:6060/debug/pprof/profile?seconds=120" -o canary.pb.gz

# stable pod
curl -s "http://stable:6060/debug/pprof/profile?seconds=120" -o stable.pb.gz

# compare on your laptop
go tool pprof -http=: -diff_base=stable.pb.gz canary.pb.gz
```

In the web UI, red boxes got worse on the canary, green got better. This is the **production version** of "does my change help?". When a release seems risky, run it for 5 minutes on a canary, collect both, diff. If red boxes exceed your tolerance, roll back.

Two practical gotchas:

- The two pods must serve similar traffic. Compare `route`-labeled subsets via `tagfocus`.
- A 2-minute window on a noisy service has high variance. For a meaningful diff, prefer 5–10 minutes.

---

## 13. Incident response runbook: "service is slow"

```
1. SSH-tunnel to a slow pod's 6060.
2. curl /debug/pprof/profile?seconds=30 → cpu.pb.gz
3. go tool pprof -http=: cpu.pb.gz
   - Flame graph: is the hot box your code or runtime/syscall?
4. If your code: jump to source view, identify the line.
   If runtime.mallocgc dominates: also grab /heap, sample_index=alloc_objects.
   If syscall.Syscall dominates: also grab /goroutine?debug=2.
5. Cross-check with metrics: GC CPU? Allocation rate?
6. Save the profile. Add it to the incident ticket.
```

The pattern: **always save profiles**. They are your evidence trail.

---

## 14. Incident response runbook: "RSS climbing"

```
1. curl -o heap1.pb.gz /debug/pprof/heap
   ... wait 30 minutes ...
2. curl -o heap2.pb.gz /debug/pprof/heap
3. go tool pprof -http=: -base=heap1.pb.gz heap2.pb.gz
   - The "top" shows what grew. Each function is "new bytes since heap1".
4. List the suspects. Read what they retain.
5. Confirm with /goroutine?debug=2 — sometimes the leak is goroutines holding objects, not direct heap leak.
```

The `-base` diff is the difference between "I see lots of memory" and "I see exactly what new code is responsible".

---

## 15. Incident response runbook: "goroutine count exploded"

```
1. curl -o gr1.txt "/debug/pprof/goroutine?debug=2"
2. Read with less / pager. Search for repeated stacks.
3. The most-repeated stack is the leak. Look at the line where it's parked.
   - chan receive → who's not sending?
   - chan send    → who's not receiving?
   - select       → which case never fires?
   - sync.Cond.Wait → who's not Broadcasting?
```

The text dump (`?debug=2`) is more useful than the binary profile here because you want to *read* representative stacks, not aggregate them.

---

## 16. Storage costs

For continuous profiling, plan storage budget per service:

```
profile_size × profiles_per_hour × hours × replicas
```

Typical numbers for a Go service:

- CPU profile (30 s, 100 Hz, normal service): 50–500 KiB compressed.
- Heap profile: 50–500 KiB.
- Goroutine profile: depends on goroutine count; usually <100 KiB.

With Pyroscope's defaults (10/min × 4 profile types × 10 KiB average), each replica writes ~3 MiB/h, ~70 MiB/day. A 50-pod fleet generates ~3 GiB/day. Plan for tiered storage (hot 30 days, cold 1 year).

---

## 17. Don'ts

| Don't | Why |
|-------|-----|
| Expose pprof on a public listener | Source-level information leak |
| Import `_ "net/http/pprof"` alongside your real handlers on the same mux | Same listener serves both |
| `SetBlockProfileRate(1)` in production for hours | Real CPU cost |
| `MemProfileRate = 1` in production | Profile overhead, big profile files |
| Diff CPU vs. heap profiles | Different sample_type; tool errors |
| Trust heap profile bytes as "ground truth" | Sampled; use MemStats for absolute numbers |
| Profile a 5 s workload over 30 s | 25 s of idle dilutes percentages |

---

## 18. Summary

Production pprof is two systems, not one: an on-demand interactive endpoint on every service, and a continuous-profiling pipeline that archives profiles long-term. Pair them with a strict label vocabulary (route, version, env, region, tenant), a hardened debug listener bound to localhost, and a few runbooks for the canonical incidents. Use diffs (`-base` / `-diff_base`) for both release-gating and incident triage. Treat profiles as build artifacts: archive them so you can answer "what changed?" six months later.

---

## Further reading
- Pyroscope continuous profiling: https://grafana.com/oss/pyroscope/
- Parca: https://www.parca.dev/docs/overview
- GCP Cloud Profiler: https://cloud.google.com/profiler/docs
- Go profiling labels post: https://rakyll.org/profiler-labels/
- "Continuous Profiling: The Production Engineer's Edge" (Polar Signals): https://www.polarsignals.com/blog
