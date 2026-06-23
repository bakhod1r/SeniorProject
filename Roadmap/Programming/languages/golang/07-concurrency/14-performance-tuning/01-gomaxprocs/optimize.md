# `GOMAXPROCS` — Optimization Exercises

> Each exercise starts with a baseline measurement, a tuning hypothesis, and a target metric. The point is to validate or refute the hypothesis on real hardware. Sweeps are the spine: never tune without a curve. This file is the heaviest in the chapter — performance tuning is what `14-performance-tuning` is about.

---

## How to Use This File

- **Read the goal carefully.** Each exercise has a specific metric and constraint.
- **Run the sweep.** No exercise can be answered without measurement.
- **Report variance.** Single-run numbers are noise.
- **Document hardware.** A win on your machine may be a loss on production.

Quick reference for sweep methodology:

```bash
for n in 1 2 4 8 NumCPU; do
    for trial in 1 2 3; do
        GOMAXPROCS=$n ./svc &
        pid=$!
        sleep 2  # warmup
        wrk -t8 -c128 -d20s --latency http://localhost:8080/ > "out-$n-$trial.txt"
        kill $pid; wait $pid 2>/dev/null
    done
done
```

---

## Easy

### E1 — Confirm `NumCPU` Is the Sweet Spot

**Setup.** A pure CPU-bound service, no I/O, no allocation per request.

```go
package main

import (
    "crypto/sha256"
    "log"
    "net/http"
    "runtime"
)

func handler(w http.ResponseWriter, r *http.Request) {
    h := sha256.New()
    buf := make([]byte, 4096)
    for i := 0; i < 64; i++ {
        h.Write(buf)
    }
    _, _ = w.Write(h.Sum(nil))
}

func main() {
    log.Printf("GOMAXPROCS=%d", runtime.GOMAXPROCS(0))
    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Hypothesis.** Throughput peaks at `GOMAXPROCS = NumCPU`.

**Sweep.** `GOMAXPROCS ∈ {1, 2, 4, 8, NumCPU, 2×NumCPU}`. Three repeats.

**Target.** Plot throughput. Confirm peak at `NumCPU`. Confirm regression beyond.

**Expected result.** Throughput curve like the one in junior.md — monotonic to `NumCPU`, then flat or slightly down.

---

### E2 — Find the Container Default

**Setup.** A Go service in a Docker container.

```bash
docker run --rm --cpus=2 your-image
```

**Hypothesis.** On Go 1.18+ Linux, `GOMAXPROCS` defaults to 2; on Go 1.15, it defaults to the host's CPU count.

**Target.** Run with three Go base images: 1.15, 1.18, 1.22. Record the startup log.

**Deliverable.** A table:

| Go version | Startup `GOMAXPROCS` | Startup `NumCPU` |
|---|---|---|
| 1.15 | ? | ? |
| 1.18 | ? | ? |
| 1.22 | ? | ? |

Plus recommendation: which version is safe to deploy without `automaxprocs`?

---

### E3 — Add `automaxprocs` and Measure

**Setup.** Take E2's 1.15 image. Add `automaxprocs`.

**Hypothesis.** `GOMAXPROCS` will drop to 2 (matching `--cpus=2`).

**Target.** Confirm log line. Run a CPU-bound sweep before/after. Latency under load should improve dramatically.

**Deliverable.** Before/after table with `GOMAXPROCS`, RPS, p99.

---

### E4 — Right-Size a Misconfigured Service

**Setup.** A service with this in `main.go`:

```go
runtime.GOMAXPROCS(64)
```

Running in a pod with `cpu: 4`.

**Hypothesis.** Removing the line will improve p99 and keep throughput equal-or-better.

**Target.** Remove the line. Run the sweep harness from middle.md before and after.

**Deliverable.** A diff (one-line deletion) plus before/after RPS and p99.

---

### E5 — Right-Size for an I/O Service

**Setup.** A service that calls a downstream HTTP API for each request:

```go
package main

import (
    "io"
    "log"
    "net/http"
    "time"
)

var client = &http.Client{Timeout: 5 * time.Second}

func handler(w http.ResponseWriter, r *http.Request) {
    resp, err := client.Get("http://downstream/api")
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadGateway)
        return
    }
    defer resp.Body.Close()
    _, _ = io.Copy(w, resp.Body)
}

func main() {
    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Hypothesis.** Throughput is flat across `GOMAXPROCS` values from `NumCPU/2` to `2×NumCPU`. Optimal value is `NumCPU` for latency.

**Target.** Sweep with a real downstream (use a local fake or sleep-based mock). Confirm the flat curve. Confirm `NumCPU` is fine.

**Deliverable.** RPS curve + interpretation: "the netpoller absorbs the I/O, `GOMAXPROCS` is not the constraint".

---

## Medium

### M1 — The "Less Is More" p99 Win

**Setup.** A service running at `GOMAXPROCS=NumCPU` with p99 = 12 ms and target ≤ 8 ms.

**Hypothesis.** Reducing `GOMAXPROCS` to `NumCPU - 2` or `NumCPU/2` will cut p99 by relieving runtime contention, at the cost of some throughput.

**Target.** Sweep `GOMAXPROCS ∈ {NumCPU/2, NumCPU-4, NumCPU-2, NumCPU}`. Plot p99. Find the value that hits p99 ≤ 8 ms.

**Deliverable.** Table of (`GOMAXPROCS`, RPS, p99). Choose a value. Compute replica-count change needed to recover throughput.

---

### M2 — Confirm the GC Bottleneck Hypothesis

**Setup.** An allocation-heavy service:

```go
package main

import (
    "encoding/json"
    "net/http"
)

type Resp struct {
    Items []map[string]string
}

func handler(w http.ResponseWriter, r *http.Request) {
    resp := Resp{Items: make([]map[string]string, 1000)}
    for i := range resp.Items {
        resp.Items[i] = map[string]string{
            "k1": "v1", "k2": "v2", "k3": "v3",
        }
    }
    _ = json.NewEncoder(w).Encode(resp)
}

func main() {
    http.HandleFunc("/", handler)
    _ = http.ListenAndServe(":8080", nil)
}
```

**Hypothesis.** Beyond a certain `GOMAXPROCS`, GC mark workers compete with mutators; reducing `GOMAXPROCS` actually helps.

**Target.** Sweep with a CPU profile (`go tool pprof`) at each setting. Measure time in `runtime.gcBgMarkWorker`. Plot RPS, p99, and `gcBgMarkWorker%` together.

**Deliverable.** Three-line plot. Identify where mark-worker fraction exceeds 15%.

---

### M3 — Detect and Fix CFS Throttling

**Setup.** A service with `cpu: 1` limit, `GOMAXPROCS=8` (hard-coded), running on a host with CPU available.

**Hypothesis.** The hard-coded value causes throttling visible in `cpu.stat`.

**Target.**
1. Confirm throttling: `cat /sys/fs/cgroup/cpu.stat`, expect `nr_throttled > 0`.
2. Remove hard-coded `GOMAXPROCS`.
3. Confirm throttling drops to 0 or near-0.
4. Compare p99 before and after.

**Deliverable.** Throttle metrics before/after, p99 before/after, diff.

---

### M4 — NUMA Sweep on a Dual-Socket Box

**Setup.** A bare-metal server with 2 sockets, 16 cores each. A latency-critical service.

**Hypothesis.** Pinning to one socket and setting `GOMAXPROCS=16` improves p99 at the cost of throughput per replica.

**Target.** Run two configurations:

1. `GOMAXPROCS=32`, no pinning.
2. `taskset --cpu-list <socket0> ./svc` with `GOMAXPROCS=16`.

Run the sweep harness for each (or at least 3 repeats).

**Deliverable.** Table of (config, RPS, p99). Compute how many additional replicas the pinned config needs to match unpinned throughput.

---

### M5 — Workload-Class Tuning

**Setup.** Three services on the same hardware:
- A: CPU-bound (hashing).
- B: I/O-bound (HTTP to a slow downstream).
- C: Mixed (some CPU + some I/O).

**Hypothesis.** A peaks at `NumCPU`; B is flat above `NumCPU/2`; C is flat-ish with a slight peak around `NumCPU`.

**Target.** Sweep each. Confirm the hypothesis.

**Deliverable.** Three sweep curves on one plot. Interpretation.

---

### M6 — `GOMEMLIMIT` Coordination

**Setup.** A memory-heavy service in a `memory: 2Gi, cpu: 4` pod. Currently sets `GOMAXPROCS=4` but no `GOMEMLIMIT`.

**Hypothesis.** Setting `GOMEMLIMIT=1800MiB` stabilises heap; combined with correct `GOMAXPROCS`, the service runs longer without OOM.

**Target.** Run a 1-hour soak test before and after setting `GOMEMLIMIT`. Track heap-in-use over time.

**Deliverable.** Two heap timelines. Note OOM occurrences. Conclusion on the right `GOMEMLIMIT` value.

---

### M7 — Compare Spawning Strategies Under `GOMAXPROCS` Pressure

**Setup.** A job worker that processes N items. Two strategies:

A. One goroutine per item:
```go
for _, item := range items {
    wg.Add(1)
    go func(it Item) { defer wg.Done(); process(it) }(item)
}
wg.Wait()
```

B. Worker pool sized to `GOMAXPROCS`:
```go
ch := make(chan Item, len(items))
for _, it := range items { ch <- it }
close(ch)
for i := 0; i < runtime.GOMAXPROCS(0); i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for it := range ch { process(it) }
    }()
}
wg.Wait()
```

**Hypothesis.** B has lower overhead at high N; A is slightly faster at low N.

**Target.** Run both with N ∈ {100, 10 k, 1 M}, `GOMAXPROCS ∈ {2, 8, 32}`. Record wall time.

**Deliverable.** A heatmap or grid showing the crossover point.

---

### M8 — Locked Threads Under `GOMAXPROCS=NumCPU`

**Setup.** A service that calls `runtime.LockOSThread()` in many goroutines (perhaps for OpenGL, perhaps for a C library).

**Hypothesis.** Locked threads do not free their `P` for other goroutines, effectively shrinking parallelism. The right `GOMAXPROCS` is `NumCPU + N_locked_goroutines`.

**Target.** Run with and without the extra `P`s. Measure throughput.

**Deliverable.** Confirm or refute. Most plausible outcome: the runtime spawns additional `M`s; `GOMAXPROCS` alone is not the bottleneck. Worth measuring.

---

## Hard

### H1 — Build a Sweep Harness and Run It in CI

**Setup.** Service of your choice.

**Hypothesis.** Continuous sweeps detect performance regressions earlier than user complaints.

**Target.**
1. Build the sweep harness from middle.md.
2. Schedule it nightly in CI.
3. Upload CSV as an artifact.
4. Plot trends over time (a `sweep-history.csv` accumulating weeks of data).

**Deliverable.** CI config, results from a week of runs, plot of throughput/p99 over time for `GOMAXPROCS=NumCPU`.

---

### H2 — Internal `gmpconfig` Library With Tier Awareness

**Setup.** Implement the `gmpconfig` API from professional.md.

**Hypothesis.** A unified library reduces fleet-wide misconfiguration vs ad-hoc service-by-service handling.

**Target.**
1. Implement `Apply(Config{Tier, Logger, EmitMetric, AllowEnvOverride}) int`.
2. Unit test cgroup v1, v2, no cgroup, env-var override.
3. Add to 3 services in your codebase; remove their existing `automaxprocs` / manual logic.
4. Confirm logs and metrics behave identically across the three.

**Deliverable.** Library code, tests, three-service rollout report.

---

### H3 — Workload-Aware Autosetting (Carefully)

**Setup.** A latency-critical service with a known SLO (e.g. p99 ≤ 10 ms).

**Hypothesis.** A throttled-aware autosetter that reduces `GOMAXPROCS` by 1 when throttling exceeds 5%, and increases by 1 when p99 is well below SLO and throttling is zero, will hold p99 within SLO better than a static value.

**Target.**
1. Implement the autosetter with rate limiting (1 change per hour), bounded ±2 from baseline.
2. Run two pods: one with autosetter enabled, one with static `GOMAXPROCS=NumCPU`.
3. Run for 24 hours under varying load.
4. Compare p99 and throughput.

**Deliverable.** Code, 24-hour comparison, recommendation on whether to enable in production.

**Note.** This is research, not a production recipe. Most teams should not build this.

---

### H4 — NUMA-Aware Sharded Service

**Setup.** A dual-socket box hosting a latency-critical service.

**Hypothesis.** Running two pinned replicas (one per socket) outperforms one unpinned replica with `GOMAXPROCS=NumCPU` on p99 with negligible throughput cost.

**Target.**
1. Configure one unpinned instance, run sweep, record best p99 and RPS.
2. Configure two pinned instances, place a TCP load balancer in front, repeat.
3. Compare.

**Deliverable.** Tables for both configurations, decision on which to deploy.

---

### H5 — End-to-End: Document the Optimum for One Service

**Goal.** Pick a real service in your fleet. Produce a one-page document covering:

- Hardware and Go version.
- Current `GOMAXPROCS` (logged or measured).
- Workload class (CPU-bound, I/O-bound, mixed) and evidence.
- Sweep results — table and plot.
- Recommended setting.
- Trade-off analysis (throughput vs latency vs cost).
- Action items: settings to change, monitoring to add, alerts to wire.

This is what senior engineers produce when asked "is `GOMAXPROCS` right for service X?". The deliverable is the document.

---

### H6 — Reproduce a Real Production Story

Pick one of the production stories from professional.md (Story 1: Friday slowdown; Story 2: NUMA win; Story 3: mysterious GC pauses; Story 4: autoscaler confusion; Story 5: hard-coded constant).

**Target.** Build a reproducible setup that exhibits the symptom. Apply the fix. Measure before/after. Write a runbook for handling the issue if it occurs in production.

**Deliverable.** Working reproduction, working fix, runbook.

---

### H7 — Cross-Runtime Throughput Comparison

**Goal.** The same CPU-bound HTTP service in Go, Rust (Tokio), and Java. Compare throughput-vs-`GOMAXPROCS`-equivalent curves.

**Target.**
1. Implement the SHA256 handler in each runtime.
2. Run sweeps with each runtime's parallelism knob (`GOMAXPROCS`, `tokio worker_threads`, JVM thread pool).
3. Plot all three curves on one chart.

**Deliverable.** Three implementations, one plot, interpretation.

---

### H8 — Production Policy Audit

**Goal.** Audit your fleet against the senior-level policy (five rules from senior.md).

**Target.** For 5–10 services in your org:
1. Is `GOMAXPROCS` logged at startup?
2. Is `process_gomaxprocs` exposed as a metric?
3. Does the pod manifest declare CPU limits?
4. What Go version is in use?
5. Are there any hard-coded `runtime.GOMAXPROCS(n)` calls?

**Deliverable.** Audit spreadsheet, list of services needing remediation, prioritised by SLO impact.

---

### H9 — Build an Alert and Test It

**Goal.** Wire the three senior-level alerts (misconfigured `GOMAXPROCS`, CFS throttling, accidental `GOMAXPROCS=1`).

**Target.**
1. Write PromQL for each alert.
2. Validate with synthetic load that each alert fires.
3. Write a runbook for each alert.

**Deliverable.** Alert configs, runbooks, test artefacts showing each alert fired and was resolved.

---

### H10 — Capacity-Plan a Service Migration

**Setup.** A service currently running on `cpu: 4 × 10 replicas`. Operator proposes consolidating to `cpu: 8 × 5 replicas` to save coordination overhead.

**Target.**
1. Run a `GOMAXPROCS` sweep on both configurations.
2. Compare RPS, p99, and tail latency (p99.9).
3. Consider GC behaviour: heap size and pause duration scale with `GOMAXPROCS`.
4. Compute total node usage (should be similar; verify).

**Deliverable.** Comparison report. Recommendation: stick with current, migrate, or A/B test.

---

## Bonus

### B1 — Use `runtime/metrics` for Live Tuning Signals

Wire `/sched/latencies:seconds` and `/sched/gomaxprocs:threads` to Prometheus. Alert on p99 scheduling latency > 1 ms (indicates saturation).

### B2 — Per-Container CFS Visibility

For each container in a pod, expose `cpu.stat` as Prometheus metrics. Useful when standard cAdvisor metrics are missing or coarse.

### B3 — Test `taskset` Effect on `runtime.NumCPU()`

Run a Go program with `taskset --cpu-list 0-3 ./prog` on an 8-core box. Confirm `NumCPU()` returns 4. Confirm `GOMAXPROCS` default is 4.

### B4 — Read the `automaxprocs` Source

It is ~500 lines. Read it. Note: cgroup v1 vs v2 detection, the rounding rule, the env-var override behaviour, the logger interface. Compare with the Go runtime's own detection (in `src/runtime/proc.go`).

### B5 — Compute Replica Count From SLO and Per-Replica RPS

Given an SLO (p99 ≤ 10 ms, total RPS = 100 k), the sweep tells you the max RPS per replica at p99 ≤ 10 ms. Replica count = ceil(100 000 / max_per_replica_RPS). Build this calculation into your capacity-planning tooling.

---

## Sequencing

For middle-level mastery: E1 → E5, then M1 → M4.
For senior-level: M5 → M8, then H1 → H4.
For professional: H5 → H10.
For depth: B1 → B5 in your spare time.

The single most useful exercise for any reader is **E1**: confirm the canonical curve on your own hardware. Everything else builds on that intuition.
