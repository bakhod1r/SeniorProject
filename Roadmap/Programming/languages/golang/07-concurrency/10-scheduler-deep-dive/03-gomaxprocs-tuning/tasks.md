# `GOMAXPROCS` — Tasks

> Hands-on exercises. Each has a clear deliverable. Solutions follow at the end. Aim to complete the easy block before reading any solution.

---

## Easy

### Task 1 — Startup Log Line

Add a startup log line to a Go program that prints:

- `GOMAXPROCS` (current value).
- `NumCPU` (runtime's view).
- `GOOS`, `GOARCH`, `Go version`.

**Deliverable.** A 5-line `main` that prints all five. Verify by running with and without `GOMAXPROCS=2` env var.

---

### Task 2 — Read the Cgroup File

Write a function `func cgroupCPULimit() (int, error)` that:

- Opens `/sys/fs/cgroup/cpu.max` (cgroup v2).
- Parses the two integers.
- Returns `ceil(quota / period)`.
- Returns an error if the quota is `max` or the file does not exist.

**Deliverable.** A working function plus a test using a temp file to inject inputs.

---

### Task 3 — Set GOMAXPROCS at Startup

Modify a program so that `GOMAXPROCS` is set explicitly from a `--maxprocs` CLI flag. If the flag is unset, fall back to the runtime default.

**Deliverable.** A program where `./prog --maxprocs=4` overrides everything, and `./prog` leaves the default.

---

### Task 4 — Sweep Driver

Write a shell script that runs a server at `GOMAXPROCS=1, 2, 4, 8` and drives 30 seconds of load with `wrk` at each value. Output throughput per setting.

**Deliverable.** A `sweep.sh` script plus example output.

---

### Task 5 — Detect Mismatch

Write a function `func MismatchDetected() (bool, string)` that compares `runtime.GOMAXPROCS(0)` to the cgroup limit (if any) and returns true with a description if they disagree. Use it at startup to log a warning.

**Deliverable.** Function plus test cases for matching, mismatching, and no-cgroup states.

---

## Medium

### Task 6 — Reproduce CFS Throttling

Build a CPU-burning program. Run it in Docker with `--cpus=1` but with `GOMAXPROCS=8` env var. Observe via `docker stats` or `/sys/fs/cgroup/cpu.stat` that the kernel is throttling.

**Deliverable.** A reproducible setup (`Dockerfile` and run script) plus a markdown summary of the observation: throttled periods, throttled µs.

---

### Task 7 — Prometheus Gauge

Export `process_gomaxprocs` and `process_num_cpu` as Prometheus gauges from a Go HTTP service.

**Deliverable.** A complete service that serves `/metrics` and exposes both gauges with correct values.

---

### Task 8 — Sweep Plot

Take the output of Task 4 and plot it (Python matplotlib, gnuplot, anything). Identify the peak throughput point.

**Deliverable.** A PNG plot of throughput vs `GOMAXPROCS`. Annotate the peak.

---

### Task 9 — Sidecar-Aware Limits

Given a Kubernetes manifest with both an `app` container and a `proxy` sidecar:

- Annotate the file with explicit per-container CPU limits.
- Compute what `GOMAXPROCS` should be inside the app container.
- Document why per-pod limits alone are insufficient.

**Deliverable.** A revised YAML plus a 100-word explanation.

---

### Task 10 — Compare automaxprocs to Runtime

Build a small program with and without `import _ "go.uber.org/automaxprocs"`. Run under cgroup v2 with various quotas. Log `GOMAXPROCS` for each case.

**Deliverable.** A markdown table showing input quota, runtime detection, automaxprocs detection. Identify any discrepancy.

---

### Task 11 — NUMA Inspection

Inspect a machine via `lscpu` and `numastat`. Identify:

- Number of NUMA nodes.
- CPUs per node.
- Whether the kernel is balancing memory.
- Existing process memory locality.

**Deliverable.** A markdown report for the inspected machine. (If no NUMA box is available, document a 1-node machine for completeness.)

---

### Task 12 — Goroutine vs P Visualisation

Build a program that:

- Starts N CPU-burning goroutines.
- Logs `runtime.GOMAXPROCS(0)`, `runtime.NumGoroutine()`, and per-thread CPU usage (via `/proc/self/task/*/stat`) every 200 ms.

**Deliverable.** A program plus 10 seconds of output that clearly shows goroutines distributing across Ps.

---

## Hard

### Task 13 — Workload-Aware Autoscaler

Implement a Go controller that:

- Reads `/sched/latencies:seconds` from `runtime/metrics` every 30 seconds.
- If p99 > 5 ms, calls `runtime.GOMAXPROCS(current + 1)` up to `NumCPU`.
- If p99 < 100 µs sustained for 10 minutes, calls `runtime.GOMAXPROCS(current - 1)` down to 2.
- Logs every adjustment with reason.

**Deliverable.** A library exposing `func Adaptive(ctx context.Context, opts Options)`. Tests that exercise both scale-up and scale-down.

---

### Task 14 — Cgroup Watcher

Build a goroutine that:

- Watches `/sys/fs/cgroup/cpu.max` via `fsnotify`.
- On change, re-reads the file and calls `runtime.GOMAXPROCS` with the new value.
- Logs each change.

**Deliverable.** A working watcher plus integration test using a temp cgroup-like file.

---

### Task 15 — STW Cost Benchmark

Write a benchmark that measures the latency of `runtime.GOMAXPROCS(n)` calls:

- One benchmark for no-op calls (same value).
- One for actual resize (toggling between two values).
- Multiple goroutine counts (0, 100, 10 000, 1 000 000).

**Deliverable.** A benchmark file plus a markdown summary of observed STW costs.

---

### Task 16 — NUMA Split Service

Take an existing Go HTTP service. Modify the deployment to run two instances:

- Each pinned to one NUMA node via `numactl`.
- Each with appropriate `GOMAXPROCS`.
- Load-balanced by HAProxy or nginx.

**Deliverable.** A deployment manifest (systemd or docker-compose), a load-balancer config, and a markdown summary comparing single-process vs split throughput.

---

### Task 17 — Automated Sweep in CI

Add a CI job to a Go project that:

- Builds the binary.
- Runs a 60-second sweep over `GOMAXPROCS=1, 2, 4, 8, 16`.
- Compares peak throughput to a baseline stored in the repo.
- Fails CI if regression > 10%.

**Deliverable.** A GitHub Actions YAML plus a baseline file and a script.

---

### Task 18 — Per-Container Limits Audit

Write a script that scans a directory of Kubernetes manifests and flags any pod that:

- Has multiple containers but no per-container limits.
- Has a pod-level limit that exceeds the sum of container limits.

**Deliverable.** A Go program that reports issues found.

---

### Task 19 — Multi-Process Manager

Build a small supervisor that:

- Detects the number of NUMA nodes via `/sys/devices/system/node/`.
- Forks N replicas of a server, each pinned to its NUMA node via `taskset`.
- Restarts any replica that crashes.
- Exposes a single load-balanced endpoint via HTTP reverse proxy.

**Deliverable.** A supervisor binary plus example usage.

---

### Task 20 — End-to-End Tail-Latency Tuning

Take a CPU-intensive Go service. Establish a baseline (p50, p99, p99.9) under typical load. Then iterate:

1. Reduce allocation rate via `sync.Pool`.
2. Tune `GOGC`.
3. Set `GOMEMLIMIT`.
4. Sweep `GOMAXPROCS`.
5. Try `GOMAXPROCS = quota - 1`.

At each step, record measurements. The final report should show the cumulative improvement.

**Deliverable.** A markdown report with metrics at each step and a final tuned config.

---

## Solutions

### Solution 1

```go
package main

import (
    "log"
    "runtime"
)

func main() {
    log.Printf("startup: GOMAXPROCS=%d NumCPU=%d GOOS=%s GOARCH=%s GoVer=%s",
        runtime.GOMAXPROCS(0), runtime.NumCPU(), runtime.GOOS, runtime.GOARCH, runtime.Version())
}
```

Run with `GOMAXPROCS=2 ./prog` and verify the line shows 2.

---

### Solution 2

```go
package main

import (
    "errors"
    "fmt"
    "os"
    "strings"
)

func cgroupCPULimit() (int, error) {
    data, err := os.ReadFile("/sys/fs/cgroup/cpu.max")
    if err != nil {
        return 0, err
    }
    s := strings.TrimSpace(string(data))
    parts := strings.Fields(s)
    if len(parts) != 2 {
        return 0, fmt.Errorf("unexpected format: %q", s)
    }
    if parts[0] == "max" {
        return 0, errors.New("no quota")
    }
    var quota, period int64
    if _, err := fmt.Sscanf(parts[0], "%d", &quota); err != nil {
        return 0, err
    }
    if _, err := fmt.Sscanf(parts[1], "%d", &period); err != nil {
        return 0, err
    }
    n := (quota + period - 1) / period
    if n < 1 {
        n = 1
    }
    return int(n), nil
}
```

Test with a temp file containing `50000 100000` (should return 1) and `200000 100000` (returns 2).

---

### Solution 3

```go
package main

import (
    "flag"
    "log"
    "runtime"
)

func main() {
    maxprocs := flag.Int("maxprocs", 0, "override GOMAXPROCS")
    flag.Parse()
    if *maxprocs > 0 {
        runtime.GOMAXPROCS(*maxprocs)
    }
    log.Printf("GOMAXPROCS=%d", runtime.GOMAXPROCS(0))
}
```

---

### Solution 4

```bash
#!/usr/bin/env bash
set -e
for n in 1 2 4 8; do
  GOMAXPROCS=$n ./server &
  pid=$!
  sleep 2
  wrk -t8 -c64 -d30s http://localhost:8080/ | tail -3
  kill $pid
  wait $pid 2>/dev/null
done
```

---

### Solution 5

```go
func MismatchDetected() (bool, string) {
    gm := runtime.GOMAXPROCS(0)
    cgroup, err := cgroupCPULimit() // from Solution 2
    if err != nil {
        return false, "no cgroup quota; default applies"
    }
    if gm != cgroup {
        return true, fmt.Sprintf("GOMAXPROCS=%d but cgroup quota=%d", gm, cgroup)
    }
    return false, "consistent"
}
```

---

### Solution 6

`Dockerfile`:

```Dockerfile
FROM golang:1.22
WORKDIR /app
COPY main.go .
RUN go build -o /server main.go
ENTRYPOINT ["/server"]
```

`main.go` with a busy loop. Then:

```bash
docker build -t throttle-demo .
docker run --cpus=1 -e GOMAXPROCS=8 throttle-demo
docker stats <container>
docker exec <container> cat /sys/fs/cgroup/cpu.stat
```

The `cpu.stat` output shows `nr_throttled` and `throttled_usec` rising.

---

### Solution 7

```go
import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
    "runtime"
)

var (
    gomaxprocs = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "process_gomaxprocs",
        Help: "Current GOMAXPROCS",
    })
    numCPU = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "process_num_cpu",
        Help: "Result of runtime.NumCPU()",
    })
)

func init() {
    gomaxprocs.Set(float64(runtime.GOMAXPROCS(0)))
    numCPU.Set(float64(runtime.NumCPU()))
}
```

---

### Solution 8

Use the output of Solution 4. A minimal Python plotter:

```python
import matplotlib.pyplot as plt
xs = [1, 2, 4, 8]
ys = [1100, 2100, 3900, 7200]  # fill from sweep results
plt.plot(xs, ys, marker="o")
plt.xlabel("GOMAXPROCS")
plt.ylabel("Throughput (req/s)")
plt.title("GOMAXPROCS sweep")
plt.grid(True)
plt.savefig("sweep.png")
```

---

### Solution 9

```yaml
spec:
  containers:
  - name: app
    resources:
      limits:
        cpu: "3"
        memory: "1Gi"
  - name: proxy
    resources:
      limits:
        cpu: "1"
        memory: "256Mi"
```

`GOMAXPROCS` in the app container = 3 (the runtime reads the per-container cgroup). Pod-level limits would let either container burn the entire pod budget; per-container limits prevent that.

---

### Solution 10

A typical table after testing:

| cgroup quota | Go 1.22 default | automaxprocs |
|---|---|---|
| 500 ms / 100 ms | 1 | 1 |
| 1 500 ms / 100 ms | 2 | 2 |
| max (unset) | NumCPU | NumCPU |
| 2 000 ms / 100 ms | 2 | 2 |

They should agree on Go ≥ 1.18. On older Go, automaxprocs corrects.

---

### Solution 11

A typical report for a 2-socket box:

```
Sockets: 2
Cores per socket: 16 (32 logical)
NUMA nodes: 2 (node0: cpus 0-15,32-47; node1: cpus 16-31,48-63)
Auto-balance: enabled (/proc/sys/kernel/numa_balancing=1)
Process locality: 95% local (good); cross-socket traffic 5%.
```

For a 1-node box: report `NUMA nodes: 1` and note that NUMA tuning is unnecessary.

---

### Solution 12

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "time"
)

func busy() { for { _ = 0 } }

func main() {
    for i := 0; i < 8; i++ { go busy() }
    for {
        fmt.Printf("[%s] GOMAXPROCS=%d NumGoroutine=%d\n",
            time.Now().Format("15:04:05.000"),
            runtime.GOMAXPROCS(0),
            runtime.NumGoroutine())
        // per-thread CPU
        entries, _ := os.ReadDir("/proc/self/task")
        fmt.Printf("  threads: %d\n", len(entries))
        time.Sleep(200 * time.Millisecond)
    }
}
```

---

### Solution 13

```go
package adaptive

import (
    "context"
    "log"
    "runtime"
    "runtime/metrics"
    "time"
)

type Options struct {
    Interval time.Duration
    HighP99  time.Duration
    LowP99   time.Duration
    MaxProcs int
    MinProcs int
}

func Adaptive(ctx context.Context, o Options) {
    samples := []metrics.Sample{{Name: "/sched/latencies:seconds"}}
    ticker := time.NewTicker(o.Interval)
    defer ticker.Stop()
    var lowStart time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            metrics.Read(samples)
            h := samples[0].Value.Float64Histogram()
            p99 := percentile(h, 0.99)
            cur := runtime.GOMAXPROCS(0)
            switch {
            case p99 > o.HighP99 && cur < o.MaxProcs:
                runtime.GOMAXPROCS(cur + 1)
                log.Printf("adaptive: raised to %d (p99=%v)", cur+1, p99)
                lowStart = time.Time{}
            case p99 < o.LowP99:
                if lowStart.IsZero() { lowStart = time.Now() }
                if time.Since(lowStart) > 10*time.Minute && cur > o.MinProcs {
                    runtime.GOMAXPROCS(cur - 1)
                    log.Printf("adaptive: lowered to %d (p99=%v)", cur-1, p99)
                    lowStart = time.Time{}
                }
            default:
                lowStart = time.Time{}
            }
        }
    }
}

// percentile is left as exercise — approximate from histogram buckets.
```

---

### Solution 14

```go
import "github.com/fsnotify/fsnotify"

func watchCgroup(ctx context.Context) {
    w, _ := fsnotify.NewWatcher()
    defer w.Close()
    w.Add("/sys/fs/cgroup/cpu.max")
    for {
        select {
        case <-ctx.Done(): return
        case ev := <-w.Events:
            if ev.Op&fsnotify.Write != 0 {
                if n, err := cgroupCPULimit(); err == nil {
                    runtime.GOMAXPROCS(n)
                    log.Printf("cgroup change: GOMAXPROCS=%d", n)
                }
            }
        }
    }
}
```

---

### Solution 15

```go
func BenchmarkGOMAXPROCSNoop(b *testing.B) {
    cur := runtime.GOMAXPROCS(0)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        runtime.GOMAXPROCS(cur)
    }
}

func BenchmarkGOMAXPROCSResize(b *testing.B) {
    cur := runtime.GOMAXPROCS(0)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        if i%2 == 0 {
            runtime.GOMAXPROCS(cur)
        } else {
            runtime.GOMAXPROCS(cur + 1)
        }
    }
    runtime.GOMAXPROCS(cur)
}
```

Expected: no-op ~10 ns; resize ~50 000 ns (50 µs). Scales with goroutine count.

---

### Solution 16

```bash
# Process 1
numactl --cpunodebind=0 --membind=0 ./server --port=8080 &
# Process 2
numactl --cpunodebind=1 --membind=1 ./server --port=8081 &
```

HAProxy config:

```
backend api
  server n0 127.0.0.1:8080
  server n1 127.0.0.1:8081
```

Compare throughput: typically 20–40% better than single-process on memory-heavy workloads.

---

### Solution 17

GitHub Actions snippet:

```yaml
- run: |
    go build -o server ./cmd/server
    ./scripts/sweep.sh > sweep.txt
    python ./scripts/check_baseline.py sweep.txt baseline.txt
```

`check_baseline.py` returns non-zero if peak throughput regressed > 10%.

---

### Solution 18

```go
// Parses YAML, walks containers, flags missing per-container limits.
// Use sigs.k8s.io/yaml.
```

(Implementation left as exercise — straightforward YAML parsing.)

---

### Solution 19

A supervisor that does `fork+exec` with `taskset`. Uses `unix.Wait4` to detect crashes and respawn.

```go
for i := 0; i < numNodes; i++ {
    cmd := exec.Command("taskset", "-c", cpuListForNode(i), "./server")
    cmd.Env = append(os.Environ(), fmt.Sprintf("PORT=%d", basePort+i))
    cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
    cmd.Start()
}
```

---

### Solution 20

Step-by-step measurements for a sample service:

| Step | p50 | p99 | p99.9 |
|---|---|---|---|
| Baseline | 5 ms | 50 ms | 200 ms |
| + sync.Pool | 5 ms | 30 ms | 100 ms |
| + GOGC=200 | 5 ms | 25 ms | 60 ms |
| + GOMEMLIMIT=2Gi | 5 ms | 22 ms | 50 ms |
| + GOMAXPROCS sweep (optimal at 6) | 5 ms | 18 ms | 40 ms |
| Final | 5 ms | 18 ms | 40 ms |

Net improvement: p99 reduced by ~60%, p99.9 by ~80%. Memory rose from 1 Gi to 2 Gi.

---

## Wrap-Up

The themes across these tasks:

1. **Observability first.** Log lines, metrics, sweep reports.
2. **Detect before tune.** Mismatch detectors, cgroup watchers.
3. **Static beats dynamic.** Workload-aware autoscalers are interesting but rarely used in practice.
4. **NUMA matters on big iron.** Most cloud instances are 1-node; some bare metal is not.
5. **`GOMAXPROCS` is one knob of many.** Always tune alongside `GOGC`, `GOMEMLIMIT`, allocation profile.

Working through all 20 tasks gives you the toolkit a senior engineer needs to own `GOMAXPROCS` policy for a production service fleet.
