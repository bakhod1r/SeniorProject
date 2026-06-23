# `GOMAXPROCS` — Optimization Exercises

> Each exercise starts with a baseline measurement, identifies a tuning hypothesis, and asks you to validate or refute it on real hardware. Benchmarks are the spine — never tune without numbers.

---

## Easy

### Exercise 1 — Confirm `NumCPU` is the Sweet Spot

**Setup.** A CPU-burning HTTP server, 8-core box, no cgroup limits.

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
    http.ListenAndServe(":8080", nil)
}
```

**Target.** Run a sweep `GOMAXPROCS=1, 2, 4, 8, 16, 32` with `wrk -t8 -c64 -d20s`. Plot throughput. Confirm peak at `GOMAXPROCS=8` (NumCPU). Confirm regression beyond.

**Deliverable.** Plot + 50-word interpretation.

---

### Exercise 2 — Find the Container Default

**Setup.** A Go binary in a Docker container with `--cpus=2` on a 64-core host. Go version 1.20.

```bash
docker run --cpus=2 -it my-go-bin
```

**Target.** Without modifying source, confirm what `GOMAXPROCS` resolves to. Compare with a Go 1.15 image and a Go 1.22 image. Document the differences.

**Deliverable.** A markdown table: Go version vs reported `GOMAXPROCS`. Recommendation based on the table.

---

### Exercise 3 — Eliminate a Manual Override

**Setup.** Production code with `runtime.GOMAXPROCS(64)` near `main()`. The service runs in a pod with `cpu: 2`.

**Target.** Remove the manual override. Confirm via the sweep harness that throughput is equal-or-better and p99 latency drops. Report numbers before and after.

**Deliverable.** A before/after table and the PR diff (a single line deletion).

---

### Exercise 4 — Add `automaxprocs`

**Setup.** A service running Go 1.15 (cannot upgrade — third-party dependency). Pod has `cpu: 4`. Service reports `GOMAXPROCS=64`.

**Target.** Add `import _ "go.uber.org/automaxprocs"`. Confirm log line. Confirm `GOMAXPROCS` drops to 4. Confirm p99 latency improves.

**Deliverable.** Diff (one import) and metrics before/after.

---

### Exercise 5 — Right-Size for an I/O Service

**Setup.** An HTTP gateway that forwards requests to a backend. Each request: 10 µs of CPU work, 5 ms of backend wait.

```go
func proxy(w http.ResponseWriter, r *http.Request) {
    resp, _ := http.Get("http://backend/" + r.URL.Path)
    defer resp.Body.Close()
    io.Copy(w, resp.Body)
}
```

**Target.** Run the sweep `GOMAXPROCS=1, 2, 4, 8` at 5 000 concurrent connections. Confirm `GOMAXPROCS=2` is sufficient (per-request CPU is small; the netpoller handles the wait).

**Deliverable.** A throughput-vs-`GOMAXPROCS` curve that is **flat** beyond 2. Explanation: 5 000 connections × 10 µs / 5 ms = ~10 cores of *concurrent* but parked work. CPU demand is trivial.

---

## Medium

### Exercise 6 — Tail Latency Headroom

**Setup.** A service with `GOMAXPROCS = NumCPU = 8`. p99 = 25 ms. GC mark workers occasionally compete with request handlers for cores.

**Target.** Try `GOMAXPROCS = 7`. Hypothesis: leaving one core for OS interrupts and GC mark reduces p99 tail. Confirm or refute.

**Deliverable.** Side-by-side p50, p99, p99.9 measurements. Likely outcome: p50 slightly worse (less parallelism), p99 noticeably better. Total throughput slightly lower.

---

### Exercise 7 — GOGC + GOMAXPROCS Interaction

**Setup.** Service does 200 K allocations per second. GC pauses ~5 ms p99.

**Target.** Run a 2D sweep: `GOMAXPROCS` × `GOGC`:

| | GOGC=100 | GOGC=200 | GOGC=400 |
|---|---|---|---|
| GOMAXPROCS=4 | | | |
| GOMAXPROCS=8 | | | |
| GOMAXPROCS=16 | | | |

For each cell, record throughput, p99, peak heap. Identify the global optimum.

**Deliverable.** Heatmap + recommended config.

---

### Exercise 8 — Reduce Spinning Overhead

**Setup.** Service with `GOMAXPROCS=32` on a 16-core box ("for headroom"). `GODEBUG=schedtrace=1000` shows `spinningthreads=4-8` continuously.

**Target.** Reduce `GOMAXPROCS` to 16. Confirm spinning drops. Measure CPU usage (`top`, `process_cpu_seconds_total`). Hypothesis: CPU usage drops by ~5% with no throughput regression.

**Deliverable.** Before/after CPU usage and throughput.

---

### Exercise 9 — Burst Headroom

**Setup.** Service usually at 30% CPU, but bursts to 95% for 5 seconds every minute. Pod has `cpu: 4` limit. CFS throttle counter is non-zero during bursts.

**Target.** Either raise the limit to 5 (with corresponding `GOMAXPROCS`) or accept the throttling. Quantify the throttle penalty during bursts; quantify the cost of raising the limit (Kubernetes scheduling).

**Deliverable.** A short cost-benefit analysis.

---

### Exercise 10 — NUMA Split

**Setup.** Service on a 2-socket box, 16 cores per socket, single process at `GOMAXPROCS=32`. Throughput is 70% of expected.

**Target.** Split into two processes, each `numactl`-pinned to one socket, each `GOMAXPROCS=16`. Front with HAProxy. Measure total throughput, p99, and `numastat` cross-socket traffic.

**Deliverable.** Throughput improvement (expect 15–30%), `numastat` before/after.

---

### Exercise 11 — Cgo-Aware Sizing

**Setup.** Service makes heavy cgo calls. Each cgo call holds an M for ~5 ms. Service handles 100 RPS. p99 jumps to 50 ms during cgo bursts.

**Target.** Investigate whether raising `GOMAXPROCS` helps (cgo holds an M but not a P — so other Gs can run). Hypothesis: no improvement; the bottleneck is cgo concurrency, not parallelism.

**Deliverable.** A sweep proving the hypothesis. Suggest the real fix: bound cgo concurrency with a semaphore.

---

### Exercise 12 — Disk I/O Parallelism

**Setup.** Service reads many small files. Currently spawns 1000 concurrent goroutines, each doing `os.ReadFile`. Thread count climbs to 200+.

**Target.** Each `os.ReadFile` is a blocking syscall on a regular file (not netpoller-backed). Test whether raising `GOMAXPROCS` helps. Hypothesis: no, because Ms are blocked in syscalls, not Ps.

**Deliverable.** Confirm by sweep. The real fix is bounding parallelism with a semaphore — show that.

---

## Hard

### Exercise 13 — Latency-Critical Service

**Setup.** A trading-system order matcher. p99 latency must be below 1 ms. CPU work per request: 50 µs.

**Target.** Optimise for tail latency:

1. Baseline.
2. `GOGC=off` (no GC), set `GOMEMLIMIT` for safety.
3. Pre-allocate everything in `sync.Pool`.
4. `GOMAXPROCS = NumCPU - 2` (headroom for system).
5. Run-to-completion goroutines (no `time.Sleep`, no blocking).
6. Pin the matcher goroutine via `LockOSThread`.

Measure at each step.

**Deliverable.** Stepwise table; final p99 should be < 500 µs.

---

### Exercise 14 — Multi-Region Replicated Service

**Setup.** Same service runs in 5 regions. Each region has different CPU instance types. Hard-coded `GOMAXPROCS=8` works in some, not in others.

**Target.** Switch to cgroup-aware sizing. Add `process_gomaxprocs` metric. Generate a per-region report showing `GOMAXPROCS` resolution for each instance type.

**Deliverable.** A Grafana dashboard or markdown report showing per-region `GOMAXPROCS`. Confirm sane values across regions.

---

### Exercise 15 — Sweep Automation

**Setup.** Service's CPU profile has changed three times in the last 6 months. The team manually tunes after each change.

**Target.** Build a CI job that:

1. On every PR touching `internal/handlers/`, runs a sweep.
2. Compares peak throughput to baseline in repo.
3. Updates baseline if PR explicitly opts in.
4. Fails CI on > 10% regression.

**Deliverable.** GitHub Actions workflow + baseline file + sweep script.

---

### Exercise 16 — Workload-Aware Autoscale

**Setup.** Bursty service: 100 RPS steady, 5 000 RPS bursts. Static `GOMAXPROCS=8`. Tail latency suffers during bursts (queue depth grows).

**Target.** Build an adaptive controller that raises `GOMAXPROCS` from 8 to 16 (within cgroup quota) during sustained high latency and lowers back when latency normalises. Add hysteresis. Measure: tail latency during bursts should improve; overhead during steady state should be < 1%.

**Deliverable.** Adaptive package + tests + before/after p99 measurements.

---

### Exercise 17 — Multi-Process Manager

**Setup.** Service on a 64-core, 2-socket bare-metal box. Currently single process at `GOMAXPROCS=64`.

**Target.** Build a supervisor that:

1. Forks 2 child processes.
2. Pins each to one NUMA node via `taskset` / `numactl`.
3. Sets each child's `GOMAXPROCS=32`.
4. Restarts crashed children.
5. Load-balances via an in-process reverse proxy or front HAProxy.

Compare total throughput, p99, and operational complexity to the single-process baseline.

**Deliverable.** Supervisor + manifest + comparison report.

---

### Exercise 18 — CFS Throttle Hunt

**Setup.** Fleet of 200 Go services. ~10 of them show occasional CFS throttling. Identifying which is manual and slow.

**Target.** Build an audit tool that:

1. Queries Prometheus for `container_cpu_cfs_throttled_seconds_total > 0` over the last 7 days.
2. For each affected service, fetches `process_gomaxprocs` and the pod's `cpu` limit.
3. Reports mismatches.

**Deliverable.** A Go program that emits a markdown report. Run weekly via cron.

---

### Exercise 19 — Memory-Bound Workload

**Setup.** Service does sequential 8 GB memory scans. `GOMAXPROCS=16`. Throughput is bound by memory bandwidth (~25 GB/s on modern DDR4).

**Target.** Confirm raising `GOMAXPROCS` does not help (memory bandwidth is the bottleneck). Measure with `perf stat -e cycles,stalled-cycles-frontend,LLC-loads,LLC-load-misses ./bin`.

**Deliverable.** A short report demonstrating memory-bandwidth saturation. Suggest mitigations: better locality, prefetching, smaller dataset.

---

### Exercise 20 — End-to-End Tail Tuning

**Setup.** Take any non-trivial Go service. Establish baseline p50, p99, p99.9 at expected load.

**Target.** Iteratively tune through every knob covered in this section:

1. Log `GOMAXPROCS` at startup.
2. Audit manifest for per-container CPU limits.
3. Run a sweep; confirm default value.
4. Run another sweep with `GOMAXPROCS = quota - 1`.
5. Profile allocations; pool the top 3 hotspots.
6. Sweep `GOGC` ∈ {100, 200, 400} at fixed `GOMAXPROCS`.
7. Set `GOMEMLIMIT` to bound memory.
8. Final sweep across all combinations to lock in.

Record measurements at each step.

**Deliverable.** A final markdown report with the cumulative improvement. Realistic target: 50%+ reduction in p99.9 latency, similar throughput, controlled memory.

---

## Solutions

### Solution 1

Sweep results for an Intel 8-core dev box:

| GOMAXPROCS | Throughput (req/s) | p99 (ms) |
|---|---|---|
| 1 | 1 100 | 70 |
| 2 | 2 200 | 35 |
| 4 | 4 200 | 20 |
| 8 | 8 100 | 12 |
| 16 | 8 000 | 13 |
| 32 | 7 700 | 15 |

Peak at 8 (= `NumCPU`). 16 and 32 cost ~1% throughput. Sweet spot confirmed.

---

### Solution 2

| Go version | `GOMAXPROCS` reported |
|---|---|
| 1.15 | 64 (cgroup unaware) |
| 1.20 | 2 (cgroup v2 detected) |
| 1.22 | 2 (same) |

Recommendation: pin to Go ≥ 1.18 for accurate cgroup detection. Add `automaxprocs` as belt-and-braces.

---

### Solution 3

Before (with hard-coded 64): throughput 4 000 req/s, p99 35 ms, CFS throttle rate 5%.
After (default 2): throughput 4 100 req/s, p99 9 ms, throttle rate 0%.

Net: same throughput, p99 reduced 75%. PR is one-line deletion.

---

### Solution 4

After adding `automaxprocs`: log line `maxprocs: Updating GOMAXPROCS=4: determined from CPU quota`. `GOMAXPROCS` drops from 64 to 4. p99 improves; CFS throttling drops to 0.

---

### Solution 5

Sweep at 5 000 concurrent connections, request = 10 µs CPU + 5 ms wait:

| GOMAXPROCS | Throughput (req/s) | p99 (ms) |
|---|---|---|
| 1 | 9 500 | 30 |
| 2 | 19 000 | 12 |
| 4 | 19 200 | 10 |
| 8 | 19 100 | 10 |

`GOMAXPROCS=2` is enough. The netpoller handles 5 000 parked goroutines for free. Higher `GOMAXPROCS` does not help because the CPU portion is trivial.

---

### Solution 6

| Config | p50 | p99 | p99.9 |
|---|---|---|---|
| GOMAXPROCS=8 | 4 ms | 25 ms | 60 ms |
| GOMAXPROCS=7 | 5 ms | 18 ms | 40 ms |

p50 slightly worse, p99 and p99.9 better. Trade-off worth it for latency-sensitive services.

---

### Solution 7

Sample heatmap:

| | GOGC=100 | GOGC=200 | GOGC=400 |
|---|---|---|---|
| GMP=4 | tput 12k, p99 30 ms, heap 1 G | 13k, 25 ms, 2 G | 13k, 24 ms, 4 G |
| GMP=8 | 23k, 18 ms, 1 G | 24k, 15 ms, 2 G | 24k, 14 ms, 4 G |
| GMP=16 | 25k, 22 ms, 1 G | 25k, 20 ms, 2 G | 25k, 19 ms, 4 G |

Optimum: `GOMAXPROCS=8, GOGC=200` — best p99 at acceptable memory.

---

### Solution 8

Before: 32 Ps, 24% CPU usage (spinning + work), 40 K req/s throughput.
After: 16 Ps, 18% CPU usage, 41 K req/s throughput.

CPU saved: ~5 percentage points. Throughput marginally better (less scheduler overhead). `spinningthreads` drops from 4–8 to 0–2.

---

### Solution 9

Throttle penalty during bursts: ~30 ms added p99 latency for ~5 seconds per minute.

Cost of `cpu: 5` instead of 4: scheduler may need a different node; node capacity must accommodate the spike.

Recommendation: keep `cpu: 4` but provision more replicas for burst capacity. Or use Vertical Pod Autoscaler for adaptive limits.

---

### Solution 10

Single process, `GOMAXPROCS=32`: 60k req/s, `numastat` shows 40% cross-socket access.
Two processes, each `GOMAXPROCS=16`, NUMA-pinned: 78k req/s (+30%), `numastat` shows < 5% cross-socket.

Expected pattern. Memory locality matters.

---

### Solution 11

Sweep with `GOMAXPROCS=4, 8, 16, 32` — all give same throughput (~100 RPS) and same p99 (~50 ms during bursts). Cgo holds M, not P; raising P count does not help.

Real fix:

```go
sem := semaphore.NewWeighted(20)
// in handler:
sem.Acquire(ctx, 1)
defer sem.Release(1)
C.slow_call()
```

Now cgo concurrency is bounded; p99 stabilises.

---

### Solution 12

Sweep confirms: thread count rises proportionally to concurrent file reads, regardless of `GOMAXPROCS`. Blocking syscalls park Ms; they do not contend for Ps.

Fix:

```go
sem := make(chan struct{}, 8)
for _, p := range paths {
    sem <- struct{}{}
    go func() {
        defer func() { <-sem }()
        data, _ := os.ReadFile(p)
        process(data)
    }()
}
```

Thread count caps at ~10 (GOMAXPROCS + a few syscall holders).

---

### Solution 13

Stepwise tuning for trading matcher:

| Step | p50 | p99 | p99.9 |
|---|---|---|---|
| Baseline | 80 µs | 2 ms | 8 ms |
| `GOGC=off` + GOMEMLIMIT | 80 µs | 1.2 ms | 4 ms |
| sync.Pool everywhere | 75 µs | 800 µs | 2 ms |
| GOMAXPROCS=NumCPU-2 | 75 µs | 700 µs | 1.5 ms |
| LockOSThread on matcher | 70 µs | 400 µs | 800 µs |

Final p99: 400 µs. Achieved target.

---

### Solution 14

Per-region report:

| Region | Instance type | NumCPU | Cgroup quota | GOMAXPROCS resolved |
|---|---|---|---|---|
| us-east-1 | c5.4xlarge | 16 | 8 | 8 |
| eu-west-1 | c6i.4xlarge | 16 | 8 | 8 |
| ap-southeast-1 | c5.2xlarge | 8 | 8 | 8 |
| us-west-2 | c5a.4xlarge | 16 | 8 | 8 |
| ap-northeast-1 | c5.8xlarge | 32 | 8 | 8 |

All consistent at 8 (cgroup quota). No hard-coded overrides surviving.

---

### Solution 15

GitHub Actions:

```yaml
- name: Sweep
  run: ./scripts/sweep.sh > sweep.json

- name: Compare
  run: |
    python ./scripts/compare.py sweep.json baseline.json --tolerance=0.10
```

Workflow fails if any `GOMAXPROCS` setting regresses > 10%. `compare.py` is ~50 lines.

---

### Solution 16

Adaptive controller (see [tasks.md](tasks.md) Solution 13). With hysteresis (3 consecutive samples), bounds [4, 16], cooldown 30 s.

Result: p99 during bursts drops from 100 ms to 30 ms. Steady-state CPU overhead < 0.5%.

---

### Solution 17

Supervisor in Go: forks 2 children with `taskset`, monitors via `Wait4`, restarts on exit, exposes single port via in-process reverse proxy.

Single process: 80k req/s, p99 18 ms.
Two-process NUMA-split: 105k req/s (+30%), p99 14 ms.

Operational complexity rises: deployments must restart both processes, logs are interleaved, metrics are per-process. Worth it on memory-heavy services.

---

### Solution 18

Audit tool queries Prometheus, joins with manifest data:

```
service-foo: GOMAXPROCS=8, limit=2 (mismatch); throttled 3% of time
service-bar: GOMAXPROCS=4, limit=4 (OK); throttled 1% (real load issue)
service-baz: GOMAXPROCS=64, limit=none (no limit); throttled 0% (noisy neighbour risk)
```

Run weekly. Top 3 offenders get an issue auto-filed.

---

### Solution 19

`perf stat` output:

```
LLC-loads: 1.2 G
LLC-load-misses: 1.1 G (91%)
stalled-cycles-frontend: 80% of cycles
```

Memory bandwidth saturated. Raising `GOMAXPROCS` adds more demands on the same memory bus; no improvement.

Mitigations: tile the dataset for better cache use; prefetch sparingly; or accept the limit.

---

### Solution 20

Stepwise improvement for a sample service:

| Step | p50 | p99 | p99.9 | Tput | Mem |
|---|---|---|---|---|---|
| Baseline | 8 ms | 80 ms | 250 ms | 1000 rps | 1 G |
| +log + audit manifest | (no change in metrics) | | | | |
| +default GOMAXPROCS sweep | 8 ms | 60 ms | 180 ms | 1100 rps | 1 G |
| +sync.Pool | 7 ms | 35 ms | 100 ms | 1200 rps | 1 G |
| +GOGC=200 | 7 ms | 30 ms | 80 ms | 1300 rps | 2 G |
| +GOMEMLIMIT=2 G | 7 ms | 28 ms | 75 ms | 1300 rps | 2 G |
| +GOMAXPROCS=NumCPU-1 | 8 ms | 25 ms | 60 ms | 1280 rps | 2 G |
| Final | 8 ms | 25 ms | 60 ms | 1280 rps | 2 G |

Net: p99 reduced from 80 ms to 25 ms (~70% improvement). p99.9 reduced from 250 ms to 60 ms (~75%). Throughput unchanged (+28%). Memory doubled (acceptable trade).

---

## Wrap-Up

Themes across these optimisations:

1. **Trust the default first.** The Go runtime since 1.18 gets it right in containers. Manual overrides should be rare and justified.
2. **`GOMAXPROCS` is a small lever.** Allocation profile, GC tuning, and per-container limits dominate the latency picture. Tune `GOMAXPROCS` last.
3. **Sweep before changing.** Without before/after numbers, you are guessing.
4. **NUMA splits for big iron.** Multi-socket boxes benefit from multiple processes, one per socket.
5. **CFS throttling is loud.** A non-zero throttle rate is always a problem.
6. **`GOMAXPROCS` does not affect I/O concurrency.** The netpoller takes care of it.
7. **Adaptive sizing is rare.** Most teams set once and trust.

These exercises form the practical curriculum for `GOMAXPROCS` tuning. Working through them — with real numbers — builds the intuition that no amount of reading can replace.
