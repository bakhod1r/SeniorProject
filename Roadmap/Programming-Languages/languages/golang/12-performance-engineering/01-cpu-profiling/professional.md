# CPU Profiling in Go — Professional

## 1. The production framing

Profiling in production is not "ssh in and run pprof when there's a fire". The professional posture treats CPU profiles as a **continuously available, statistically sampled telemetry stream**, alongside metrics and logs. The job, roughly:

1. **Expose a profile endpoint** that is safe, authenticated, and isolated from public traffic.
2. **Sample continuously** with a continuous-profiling backend (Pyroscope, Parca, Grafana Cloud Profiles, Polar Signals, Datadog).
3. **Annotate samples with labels** that let you slice by endpoint, tenant, and version.
4. **Gate releases** on automated CPU regression detection.
5. **Keep a runbook** for "service is now CPU-bound" incidents with predictable first moves.
6. **Apply PGO** in CI from a representative production profile.

Done right, the on-call engineer never needs to manually run `pprof` against a live host — the data is already in a dashboard, indexed by service version.

---

## 2. A production-safe pprof endpoint

```go
import (
    "net/http"
    "net/http/pprof"
)

func startProfiler(addr string) *http.Server {
    mux := http.NewServeMux()
    mux.HandleFunc("/debug/pprof/",        pprof.Index)
    mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    mux.HandleFunc("/debug/pprof/symbol",  pprof.Symbol)
    mux.HandleFunc("/debug/pprof/trace",   pprof.Trace)

    srv := &http.Server{Addr: addr, Handler: authMiddleware(mux)}
    go srv.ListenAndServe()
    return srv
}
```

Rules that are not optional:

- **Bind to localhost or a private interface.** Profiles expose source-level identifiers; never put them on the public listener.
- **Do not import `_ "net/http/pprof"` into your main listener.** That registers on `http.DefaultServeMux`, which leaks endpoints if anything else uses the default mux.
- **Use a dedicated port.** Operators can firewall, scrape, or disable it without touching the application port.
- **Wrap with auth.** Even on a private network. mTLS, a bearer token, or a sidecar that proxies authenticated requests.

---

## 3. Continuous profiling, the architecture

A continuous-profiling agent runs alongside your process (or inside it as a library) and ships profiles to a backend every 10–60 seconds. The backend stores them indexed by time, service, version, host, and any labels you supplied.

| Backend | Model | Open source |
|---------|-------|-------------|
| **Pyroscope** (Grafana) | Pull or push agent; stored as flame-graph-friendly columnar | Yes |
| **Parca** | eBPF-based out-of-process or `pprof` push | Yes |
| **Grafana Cloud Profiles** | Managed Pyroscope | Hybrid |
| **Polar Signals Cloud** | Managed Parca | Hybrid |
| **Datadog Continuous Profiler** | Bundled in DD Agent | Closed |
| **Google Cloud Profiler** | Native GCP integration | Hybrid |

For a Go service the typical integration is one of:

- An HTTP endpoint scraped by the agent.
- A library push (`pyroscope-go`, `parca-agent`, `cloud.google.com/go/profiler`).

Library push is simpler when scraping is hard (e.g., Lambda, very short-lived jobs).

---

## 4. Integrating Pyroscope (push model)

```go
import "github.com/grafana/pyroscope-go"

func main() {
    _, err := pyroscope.Start(pyroscope.Config{
        ApplicationName: "api.checkout",
        ServerAddress:   "https://pyroscope.internal:4040",
        Logger:          pyroscope.StandardLogger,
        Tags: map[string]string{
            "version": buildVersion,
            "region":  os.Getenv("REGION"),
        },
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU,
            pyroscope.ProfileAllocObjects,
            pyroscope.ProfileAllocSpace,
            pyroscope.ProfileInuseObjects,
            pyroscope.ProfileInuseSpace,
        },
    })
    if err != nil {
        log.Fatal(err)
    }
    // ... run service ...
}
```

The library starts a background goroutine that captures 10-second CPU profiles and pushes them. Overhead is the standard ~1–3% of one CPU.

For pprof labels (`pprof.Do`), Pyroscope picks them up automatically as additional tag dimensions.

---

## 5. Labels that actually pay off

Aim for **bounded cardinality** labels that map to operational questions:

```go
labels := pprof.Labels(
    "endpoint", routePattern,    // "/api/v1/users/:id" — not the resolved path
    "method",   r.Method,
    "tenant",   tenantBucket,    // bucket large tenant IDs into 10–50 groups
)
pprof.Do(ctx, labels, func(ctx context.Context) {
    handle(ctx, w, r)
})
```

| Good label | Cardinality | Question it answers |
|------------|-------------|---------------------|
| `endpoint` (route pattern) | 10–100 | Which endpoint owns my CPU? |
| `method` | 5–7 | Are reads or writes hotter? |
| `tenant_bucket` | 10–50 | Is one tenant overwhelming the service? |
| `version` (build SHA) | 2 (rolling) | Did the new release regress? |
| `region`, `zone` | 5–20 | Is the regression isolated? |

| Bad label | Why | What to do |
|-----------|-----|------------|
| `request_id` | Cardinality = ∞ | Drop |
| `user_id` | Cardinality = users | Bucket via hash mod N |
| `full_url` | Cardinality = URL space | Use route pattern |
| `error_message` | Cardinality = variants | Use error class |

---

## 6. CI integration: gating on CPU regression

A representative benchmark suite, captured each commit, compared against `main`.

```yaml
# .github/workflows/perf.yml
jobs:
  bench:
    runs-on: self-hosted-perf   # dedicated quiet host
    steps:
      - uses: actions/checkout@v4
      - run: go test -bench=. -cpuprofile=cpu.pprof -benchmem -count=10 \
             -run=^$ ./internal/... > new.txt
      - run: |
          curl -o main.txt https://artifacts.internal/perf/main.txt
          benchstat main.txt new.txt > diff.txt
      - run: |
          if grep -E '^[A-Za-z].*\+[0-9]+\.[0-9]+%' diff.txt; then
              echo "Performance regression detected"
              cat diff.txt
              exit 1
          fi
```

Notes:

- Use a **dedicated** runner. Shared CI runners have variable CPU and produce noisy benchmarks.
- `-count=10` gives `benchstat` enough samples for a meaningful t-test.
- Set a threshold (e.g., 5%) so trivial noise doesn't block merges.
- Store CPU profiles as build artifacts; reviewers can diff them locally.

---

## 7. Automated regression detection from continuous profiles

Continuous profiling backends support comparison queries:

```
flameGraph(
  app="api.checkout",
  version="v2.4.1",
  from=now-1h
) - flameGraph(
  app="api.checkout",
  version="v2.4.0",
  from=now-25h-1h, to=now-24h
)
```

Configure an alert on **any function whose flat fraction grew by > X% between adjacent versions**. The signal is robust and catches things benchmark suites miss (real traffic shapes the load).

A common pattern: deploy v2.4.1 to 5% canary, hold for one hour, compare its flame graph to v2.4.0. Auto-roll-back if the diff exceeds threshold.

---

## 8. PGO in the deployment pipeline

Profile-Guided Optimization (Go 1.20+) is a free 2–14% CPU win for services with stable hot paths.

```yaml
- name: Capture production profile
  run: |
    curl -o default.pgo https://prod.internal/svc/debug/pprof/profile?seconds=60

- name: Build with PGO
  run: |
    cp default.pgo ./cmd/server/default.pgo
    go build -pgo=auto -o bin/server ./cmd/server

- name: Verify the PGO took effect
  run: go version -m bin/server | grep pgo
```

Rules:

- Refresh the `default.pgo` weekly — stale profiles harm rather than help.
- Capture from **steady-state** production, not from cold start or a load test.
- Commit the PGO file or fetch it deterministically; otherwise builds aren't reproducible.

---

## 9. The "CPU climbing" runbook

When the on-call alarm is "CPU is at 90%, service was at 50% yesterday":

1. **Identify what changed.** Deployment in the last 24h? Traffic spike? Schema change?
2. **Open the continuous profiler.** Compare flame graphs `now` vs `24h ago` for the affected version.
3. **Look for new wide flames.** A new wide leaf is the regression; a uniformly wider profile is a traffic spike.
4. If no continuous profiler: capture a 60-second profile locally and compare to a recently saved baseline.
5. **Decide:** is this a regression (rollback), traffic (scale), or a slow leak that finally surfaced (debug)?
6. **Mitigate, then fix.** Rollback is a mitigation; the fix is what unblocks the next release.

Each step should take under five minutes if the tooling is set up. If steps 1–4 take more than 30 minutes, that's where to invest before the next incident.

---

## 10. Profiling at scale: short-lived jobs

Lambda, cron jobs, ETL workers — anything that runs for under 30 seconds — can't use the standard 30-second `seconds=N` endpoint. Options:

```go
import "runtime/pprof"

func main() {
    f, _ := os.Create("/tmp/cpu.pprof")
    pprof.StartCPUProfile(f)
    defer func() {
        pprof.StopCPUProfile()
        f.Close()
        uploadToS3("/tmp/cpu.pprof")
    }()

    work()
}
```

Upload the profile to object storage on completion. Index by job invocation ID. The continuous profiler then ingests from the object store.

For Lambda specifically, Google Cloud Profiler and Pyroscope both have low-overhead start/stop semantics designed for this case.

---

## 11. CPU profiling under heavy concurrency

A common gotcha: at very high goroutine counts, the per-thread signal delivery means short-lived goroutines may never be sampled.

Mitigations:

- **Bunch the work.** Replace 100,000 single-task goroutines with a worker pool of 100.
- **Tag with labels** so even brief work shows up against the right bucket.
- **Cross-check with execution traces.** Traces capture every goroutine creation; CPU profiles do not.

If your profile shows 80% in `runtime.findrunnable` and `runtime.schedule`, the scheduler is doing real work — usually from too many goroutines. Reduce concurrency, don't add CPUs.

---

## 12. Profile retention and PII

Profiles include:

- Function names (sometimes leak implementation details to auditors).
- Source paths (may reveal username, build host).
- `pprof.Labels` values you set explicitly.

Treat profiles as **internal data** with the same controls as logs. Strip paths with `-trimpath` at build time, sanitize labels, and restrict access to the profile store. Don't include `user_id` or `email` in labels.

Retention: 7–30 days is typical. Longer retention is rarely useful — code drifts faster than the profiles age.

---

## 13. Capacity planning from profiles

For a CPU-bound service at steady state:

```
CPU_seconds_per_request = (profile_total_cpu_seconds) / (requests_during_profile)
```

If a 30-second profile recorded across 4 cores shows 90% CPU and the service handled 9,000 requests:

```
cpu_per_request = (30 × 4 × 0.9) / 9000 = 12 ms of CPU per request
```

Plan capacity by:

- Forecasting requests-per-second at peak.
- Multiplying by CPU-per-request to get required cores.
- Adding 30–50% headroom for variance and GC tax.

When a profile reveals "we spend 25% of CPU in JSON decoding", the capacity-plan question becomes "what does that cost in dollars per million requests?" Optimization decisions follow from there.

---

## 14. Summary

Production CPU profiling is continuous, labeled, integrated with CI, and tied to release gates. Run a hardened pprof endpoint behind auth, push to a continuous profiler (Pyroscope/Parca/cloud), tag samples with bounded-cardinality labels, fail PRs on benchmark regressions, gate canaries on flame-graph diffs, and feed steady-state profiles back into PGO builds. When an incident hits, the on-call should be reading flame graphs within minutes, not capturing them.

---

## Further reading
- Pyroscope: https://pyroscope.io
- Parca: https://www.parca.dev
- Grafana Cloud Profiles: https://grafana.com/products/cloud/profiles/
- Go PGO guide: https://go.dev/doc/pgo
- Datadog continuous profiler concepts: https://docs.datadoghq.com/profiler/
