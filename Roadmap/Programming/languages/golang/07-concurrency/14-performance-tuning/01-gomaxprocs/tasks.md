# `GOMAXPROCS` Performance Tuning — Hands-On Tasks

> Each task gives you a goal, a starting point, and a definition of done. Tasks are graded easy → hard within each section. Do them in order if you are new to performance work; cherry-pick if you are experienced. All code must compile.

---

## Easy Tasks

### T1. Log `GOMAXPROCS` at startup

**Goal.** Add a single startup log line that captures the resolved `GOMAXPROCS` and `NumCPU` in your service.

**Starting point.**

```go
package main

import (
    "log"
    "net/http"
)

func main() {
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        _, _ = w.Write([]byte("hello"))
    })
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Done when.** Startup log includes `GOMAXPROCS=<n> NumCPU=<m> GoVersion=<v>`. Verify by running `./svc 2>&1 | head -1`.

**Solution sketch.**

```go
import "runtime"

log.Printf("startup: GOMAXPROCS=%d NumCPU=%d Version=%s",
    runtime.GOMAXPROCS(0), runtime.NumCPU(), runtime.Version())
```

---

### T2. Emit `GOMAXPROCS` as a Prometheus gauge

**Goal.** Expose `process_gomaxprocs` on `/metrics`.

**Starting point.** A service that already exposes `/metrics` via `prometheus/client_golang`.

**Done when.** `curl localhost:8080/metrics | grep gomaxprocs` returns a positive integer.

**Solution sketch.**

```go
var gomaxprocsGauge = prometheus.NewGauge(prometheus.GaugeOpts{
    Name: "process_gomaxprocs",
    Help: "Current GOMAXPROCS value.",
})

func init() {
    prometheus.MustRegister(gomaxprocsGauge)
    gomaxprocsGauge.Set(float64(runtime.GOMAXPROCS(0)))
}
```

---

### T3. Sweep `GOMAXPROCS` over a CPU-bound handler

**Goal.** Reproduce the canonical CPU-bound throughput curve.

**Starting point.** Use the `cpu_server.go` from junior.md (SHA256 handler).

**Done when.** You have a CSV with rows `(gmp, rps)` for `gmp ∈ {1, 2, 4, 8, NumCPU}`, three repeats each. Plot or table; the peak is at or near `NumCPU`.

**Solution sketch.** Use the sweep shell loop from junior.md:

```bash
for n in 1 2 4 8 16; do
    for trial in 1 2 3; do
        GOMAXPROCS=$n ./cpu_server &
        pid=$!
        sleep 1
        rps=$(wrk -t8 -c64 -d10s http://localhost:8080/ \
            | awk '/Requests\/sec/ {print $2}')
        echo "$n,$trial,$rps"
        kill "$pid"; wait "$pid" 2>/dev/null
    done
done
```

---

### T4. Read the cgroup CPU quota inside a container

**Goal.** Write code that reads `/sys/fs/cgroup/cpu.max` and prints the computed `GOMAXPROCS`.

**Done when.** The program prints `quota=200000 period=100000 GOMAXPROCS-target=2` (or `quota=max GOMAXPROCS-target=NumCPU`).

**Solution sketch.**

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "strconv"
    "strings"
)

func main() {
    data, err := os.ReadFile("/sys/fs/cgroup/cpu.max")
    if err != nil {
        fmt.Println("no cpu.max:", err)
        fmt.Println("fallback NumCPU =", runtime.NumCPU())
        return
    }
    parts := strings.Fields(strings.TrimSpace(string(data)))
    if len(parts) != 2 {
        fmt.Println("malformed cpu.max:", string(data))
        return
    }
    if parts[0] == "max" {
        fmt.Println("no quota; GOMAXPROCS target =", runtime.NumCPU())
        return
    }
    quota, _ := strconv.Atoi(parts[0])
    period, _ := strconv.Atoi(parts[1])
    target := (quota + period - 1) / period
    fmt.Printf("quota=%d period=%d GOMAXPROCS-target=%d\n",
        quota, period, target)
}
```

---

### T5. Add `automaxprocs` to a service

**Goal.** Import `go.uber.org/automaxprocs` and confirm the log line appears.

**Done when.** Startup log includes a line like `maxprocs: Updating GOMAXPROCS=2: determined from CPU quota of 2.00`.

**Solution.** One-liner.

```go
import _ "go.uber.org/automaxprocs"
```

Run inside a container with `--cpus=2`. Confirm log.

---

## Medium Tasks

### T6. Build a reusable sweep harness

**Goal.** Write a Go program that runs a sweep and emits a CSV.

**Done when.** `./sweep --server ./svc --range 1,2,4,8,16 --repeats 3 --duration 20s > results.csv` produces a file with header `gmp,trial,rps,p50_us,p99_us` and one row per (gmp, trial).

**Hints.** Use `os/exec` to start the server and `wrk` (also via `os/exec`). Parse `wrk`'s output with regex. See middle.md for a skeleton.

---

### T7. Detect CFS throttling from inside the process

**Goal.** Periodically poll `/sys/fs/cgroup/cpu.stat` and emit a `cfs_throttled_ratio` gauge.

**Done when.** The gauge updates every 10 seconds with the ratio of throttled periods to total periods over the interval.

**Solution sketch.** See middle.md `throttledetect/main.go`.

```go
type Stats struct{ NrPeriods, NrThrottled uint64 }

func read() Stats { /* parse /sys/fs/cgroup/cpu.stat */ }

func Watch(emit func(float64)) {
    prev := read()
    t := time.NewTicker(10 * time.Second)
    for range t.C {
        cur := read()
        d := cur.NrPeriods - prev.NrPeriods
        if d > 0 {
            emit(float64(cur.NrThrottled-prev.NrThrottled) / float64(d))
        }
        prev = cur
    }
}
```

---

### T8. Pin a process to one NUMA socket

**Goal.** On a multi-socket machine, run a Go service pinned to one socket and confirm `runtime.NumCPU()` reports only that socket's cores.

**Done when.** On a 2-socket × 16-core box, `taskset --cpu-list 0-15 ./svc` results in `NumCPU=16` and `GOMAXPROCS=16` in the log.

**Hints.** Use `lscpu` to map NUMA nodes to CPU lists. Set `taskset` before exec. The runtime's `NumCPU()` honours the affinity mask.

---

### T9. Compare throughput with and without pinning

**Goal.** Run the sweep twice — unpinned and pinned to socket 0 — and report numbers.

**Done when.** A small table:

| Config | Best RPS | Best p99 |
|---|---|---|
| Unpinned, `GOMAXPROCS=NumCPU` (host) | ? | ? |
| Pinned to socket 0, `GOMAXPROCS=cores/socket` | ? | ? |

Plus a one-sentence interpretation.

---

### T10. Right-size a misconfigured service

**Goal.** Take a service that hard-codes `runtime.GOMAXPROCS(64)`, remove the call, run the sweep, confirm performance is equal-or-better.

**Done when.** PR diff is one line (the deletion); benchmark table shows before/after p99 and RPS for the production-shape load.

---

### T11. Add a benchmark-driven CI sweep

**Goal.** Add a nightly CI job that runs a `GOMAXPROCS` sweep against the service and uploads results.

**Done when.** A GitHub Actions / GitLab CI / Jenkins job runs once per night; results are uploaded as artifacts; a notification posts to your team's chat with a summary line.

**Hints.** Self-hosted runner is required for reproducible numbers. See senior.md for a YAML sketch.

---

## Hard Tasks

### T12. Write an internal `gmpconfig` library

**Goal.** Replicate the `Apply(Config{Tier, Logger, EmitMetric, AllowEnvOverride})` API from professional.md.

**Done when.**

- Library reads cgroup v1 or v2 (or falls back to `NumCPU` on non-Linux).
- Tier-aware derivation: `TierLatency` subtracts 1; `TierThroughput` keeps full; `TierBatch` keeps full.
- Logs through injected logger.
- Emits resolved value as injected metric.
- Honours `GOMAXPROCS` env var if `AllowEnvOverride=true`, logs warning.
- Unit tests cover cgroup v1, v2, no cgroup, env var precedence.

---

### T13. Build a workload-aware autosetter

**Goal.** A package that monitors CFS throttling and p99 (passed as metric callbacks) and adjusts `GOMAXPROCS` within bounds.

**Done when.**

- Adjusts at most once per hour.
- Bounds: `[1, cgroup_quota]`.
- Logs every adjustment with reason.
- Emits a counter of adjustments.
- Tested with a simulated metric stream (no real STW).

**Hint.** Use the `AutoTuner.Decide` skeleton from professional.md.

---

### T14. Throttling-aware load shedder

**Goal.** A middleware that rejects requests with HTTP 503 when CFS throttling exceeds 5% in the last minute.

**Done when.** Middleware integrates with `net/http`; rejected requests count as a Prometheus counter; the threshold is configurable.

**Why.** When the runtime is being throttled, accepting more work makes p99 worse. Shedding early protects upstream services.

---

### T15. Production policy admission controller

**Goal.** A Kubernetes admission webhook that rejects pods missing CPU limits, missing the `process_gomaxprocs` metric label, or running an old Go base image.

**Done when.** Webhook runs locally against a kind cluster; rejects pods that violate any rule; emits structured logs.

**Difficulty.** This is real infrastructure work; budget a day.

---

### T16. Cross-runtime benchmark

**Goal.** Implement the same CPU-bound HTTP service in Go, Java, and Rust (Tokio). Sweep `GOMAXPROCS` (or equivalent) across each. Report throughput and p99 curves side by side.

**Done when.** Three implementations, three CSVs, one plot with three series. A 200-word interpretation.

**Why.** Builds intuition for what is intrinsic to the problem vs intrinsic to the runtime.

---

### T17. NUMA-aware sharded service

**Goal.** Run two instances of a Go service on a 2-socket box, each pinned to one socket, behind a single load balancer that hashes on tenant ID. Measure overall p99 vs a single unpinned instance with `GOMAXPROCS=NumCPU`.

**Done when.** Table with RPS and p99 for both configurations; throughput should be similar, p99 should favour the pinned-shards approach.

---

### T18. Profile-guided tuning

**Goal.** Run a `pprof` CPU profile during peak load; identify the time spent in `runtime.gcBgMarkWorker`, `runtime.findRunnable`, and mutator code; correlate with `GOMAXPROCS` setting.

**Done when.** A table showing the three time fractions at `GOMAXPROCS ∈ {NumCPU/2, NumCPU, 2×NumCPU}`. Identify the regime where each becomes a problem.

---

### T19. Custom autoscaler signal

**Goal.** Expose a custom metric `gomaxprocs_saturation` = `min(1, P99_ms / SLO_ms)` for use as an HPA target.

**Done when.** Service emits the metric; HPA scales based on it; scale-out kicks in before throttling appears.

---

### T20. End-to-end runbook

**Goal.** Write the actual runbook your team would follow when paged on "high p99 + low CPU utilisation" — including the `kubectl` commands, the metric queries, and the resolution branches.

**Done when.** Runbook is reviewed by a colleague; covers the five incident patterns from senior.md; can be followed by an on-caller who has never seen the service before.

---

## Reference Solutions

Solutions for T1–T7 are provided inline above; solutions for T8–T20 are deliberately left as exercises with hints. The point of the harder tasks is *production fluency*, not code golf — the act of integrating with your team's specific tooling is the learning.

If you finish all 20, you are at the level where you could write the next chapter of this guide.

---

## Sequencing Recommendation

For a junior moving to middle: T1, T2, T3, T4, T5, T6.

For a middle moving to senior: T7, T8, T9, T10, T11.

For a senior moving to professional: T12, T13, T14, T15.

For deep specialisation: T16, T17, T18, T19, T20.
