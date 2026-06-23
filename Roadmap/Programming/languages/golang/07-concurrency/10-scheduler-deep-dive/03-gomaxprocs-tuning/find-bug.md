# `GOMAXPROCS` — Find the Bug

> Each section presents a snippet (code, manifest, or runbook) with at least one defect related to `GOMAXPROCS` configuration or behaviour. Your job is to identify the bug. Solutions follow.

---

## Bug 1 — The Headroom Override

```go
package main

import (
    "log"
    "net/http"
    "runtime"
)

func init() {
    // "Add some headroom for spikes"
    runtime.GOMAXPROCS(runtime.NumCPU() * 4)
}

func main() {
    log.Printf("GOMAXPROCS=%d", runtime.GOMAXPROCS(0))
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("ok"))
    })
    http.ListenAndServe(":8080", nil)
}
```

What is wrong?

---

## Bug 2 — Manifest Mismatch

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: app
    image: my-go-service:latest
    env:
    - name: GOMAXPROCS
      value: "32"
    resources:
      limits:
        cpu: "2"
        memory: "1Gi"
```

The pod runs on a node with 64 cores. What is wrong?

---

## Bug 3 — Stale Detection

```go
package main

import (
    "fmt"
    "log"
    "os"
    "runtime"
    "time"
)

func detectQuota() int {
    data, err := os.ReadFile("/sys/fs/cgroup/cpu.cfs_quota_us") // v1
    if err != nil {
        return runtime.NumCPU()
    }
    var quota int
    fmt.Sscanf(string(data), "%d", &quota)
    return quota / 100000
}

func init() {
    runtime.GOMAXPROCS(detectQuota())
}

func main() {
    log.Printf("GOMAXPROCS=%d", runtime.GOMAXPROCS(0))
    select {}
}
```

The service runs on Ubuntu 22.04 (cgroup v2 default). What is wrong?

---

## Bug 4 — Sidecar Surprise

```yaml
spec:
  containers:
  - name: app
    resources:
      requests:
        cpu: "2"
  - name: envoy
    resources:
      requests:
        cpu: "1"
```

App service uses Go 1.21 with `automaxprocs`. p99 latency randomly spikes. What is wrong?

---

## Bug 5 — Resize in a Hot Loop

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if r.URL.Query().Get("burst") == "1" {
        runtime.GOMAXPROCS(runtime.NumCPU())
    } else {
        runtime.GOMAXPROCS(1)
    }
    process(r)
    w.Write([]byte("ok"))
}
```

What is wrong?

---

## Bug 6 — Wrong Default After Tests

```go
func TestParallelStuff(t *testing.T) {
    runtime.GOMAXPROCS(1)
    defer runtime.GOMAXPROCS(runtime.NumCPU())
    // ... test body ...
}
```

What is wrong?

---

## Bug 7 — Missing Round-Up

```go
func cgroupV2CPU() int {
    data, _ := os.ReadFile("/sys/fs/cgroup/cpu.max")
    var q, p int
    fmt.Sscanf(string(data), "%d %d", &q, &p)
    return q / p
}
```

Cgroup quota: `50000 100000`. What does this return? What is wrong?

---

## Bug 8 — `automaxprocs` Order

```go
package main

import (
    "log"
    "runtime"

    _ "go.uber.org/automaxprocs"
)

func init() {
    // "Set explicitly to NumCPU just in case"
    runtime.GOMAXPROCS(runtime.NumCPU())
}

func main() {
    log.Printf("GOMAXPROCS=%d", runtime.GOMAXPROCS(0))
}
```

The pod has `cpu: 2` limit on a 64-core node. What does `main` print? What is wrong?

---

## Bug 9 — NUMA Single Process

A team runs a Go service on a 4-socket box (64 cores total, 16 per socket). They configure `GOMAXPROCS=64` and one process. Throughput peaks at 40% of theoretical. What is wrong?

---

## Bug 10 — Goroutine Count vs Procs

```go
const numWorkers = 4 // = GOMAXPROCS

func main() {
    runtime.GOMAXPROCS(numWorkers)
    work := make(chan int, 1024)
    for i := 0; i < numWorkers; i++ {
        go worker(work)
    }
    for i := 0; i < 1_000_000; i++ {
        work <- i
    }
    close(work)
    // ... wait ...
}
```

What is wrong? (Two issues.)

---

## Bug 11 — Adaptive Without Hysteresis

```go
func adaptive() {
    for range time.Tick(1 * time.Second) {
        if schedP99() > 5*time.Millisecond {
            runtime.GOMAXPROCS(runtime.GOMAXPROCS(0) + 1)
        } else {
            runtime.GOMAXPROCS(runtime.GOMAXPROCS(0) - 1)
        }
    }
}
```

What is wrong?

---

## Bug 12 — Wrong Field

```go
log.Printf("GOMAXPROCS=%d", runtime.NumCPU())
```

What is wrong?

---

## Bug 13 — Read After Set

```go
prev := runtime.GOMAXPROCS(8)
log.Printf("set to %d", prev)
```

What is wrong?

---

## Bug 14 — Cgroup Path

```go
quota, _ := os.ReadFile("/sys/fs/cgroup/cpu.max")
```

The container's cgroup is `/kubepods.slice/kubepods-besteffort.slice/...`. What is wrong?

---

## Bug 15 — Pre-1.16 Runtime in Container

A service runs on Go 1.14. The Dockerfile sets `cpu: 1` quota. `runtime.GOMAXPROCS(0)` returns 64. What is wrong?

---

## Solutions

### Bug 1 Solution

`runtime.NumCPU() * 4` is `4× NumCPU`. Far above the physical core count. Result:

- More Ps than cores. Spin overhead, work-stealing scan overhead.
- In a container with `cpu: 2` on a 64-core node, this sets `GOMAXPROCS = 256`. CFS throttles aggressively.

Fix: remove the `init` function. Trust the default.

---

### Bug 2 Solution

The env var `GOMAXPROCS=32` overrides cgroup detection. The Go runtime sees 32 but the cgroup quota is 2. The kernel throttles after 200 ms of CPU per second.

Fix: remove the env var entirely, or set `GOMAXPROCS: "2"` to match the limit.

---

### Bug 3 Solution

The cgroup detection code reads cgroup v1 paths. On a v2-only system (Ubuntu 22.04 by default), `/sys/fs/cgroup/cpu.cfs_quota_us` does not exist. The function falls back to `runtime.NumCPU()`, which on Go ≥ 1.18 already detects v2 correctly — but the manual override may overwrite a correct value.

Fix: use the runtime default. Remove the manual detection. Or use `automaxprocs` which handles both v1 and v2.

---

### Bug 4 Solution

There are no per-container CPU limits, only requests. The cgroup quota is `max` (no limit). `automaxprocs` falls back to node CPU count. With 64 cores visible but only 2 requested, the pod over-subscribes other neighbours and gets context-switched aggressively.

Fix: add `limits.cpu` to each container. The Go runtime will then see the correct quota.

---

### Bug 5 Solution

Each `runtime.GOMAXPROCS(n)` with `n != current` is **stop-the-world**. Calling this per request causes 50–500 µs STW per request — visible latency penalty, possibly serialising the whole service.

Fix: set `GOMAXPROCS` once at startup. Never in a hot path.

---

### Bug 6 Solution

The `defer` calls `runtime.NumCPU()`. But the previous value might not have been `NumCPU()` — it might have been overridden by env var. Restoring to `NumCPU()` overrides that override.

Fix: capture the previous value.

```go
prev := runtime.GOMAXPROCS(1)
defer runtime.GOMAXPROCS(prev)
```

---

### Bug 7 Solution

Integer division. `50000 / 100000 == 0`. Then `runtime.GOMAXPROCS(0)` is interpreted as "read only" — no change happens. Also, 0 would be invalid even if it did set.

Fix: round up.

```go
return (q + p - 1) / p
```

And clamp:

```go
if n < 1 { n = 1 }
return n
```

---

### Bug 8 Solution

The explicit `runtime.GOMAXPROCS(runtime.NumCPU())` in the user `init()` runs **after** `automaxprocs`'s `init()` (Go runs imported package inits before the current package's inits). So `automaxprocs` correctly set `GOMAXPROCS=2`, then the user code overrode it with `NumCPU()=64`. Final value: 64. CFS throttling guaranteed.

Fix: remove the explicit override.

---

### Bug 9 Solution

Single-process on a multi-socket box. Cross-socket memory traffic dominates: a goroutine on socket 0 may have its data on socket 3's RAM, paying 1.5× to 2× memory latency.

Fix: run 4 processes, each pinned to one NUMA node with `numactl --cpunodebind=N --membind=N`, each with `GOMAXPROCS=16`.

---

### Bug 10 Solution

Two issues.

1. **Spawning N workers = GOMAXPROCS** is a misconception. Worker count should match the *queue depth* you need, not the parallelism cap. The runtime time-slices goroutines onto the Ps automatically.

2. **`close(work)` after pushing all items** but before workers finish: this is the queue draining pattern, which works. But the example does not have a `WaitGroup` to wait for workers. Likely deadlock/race outside the snippet.

Fix: think about goroutine count separately from `GOMAXPROCS`. Use a worker pool sized to your needs, not to the parallelism cap.

---

### Bug 11 Solution

No hysteresis. Each tick may flip the value if latency oscillates around the threshold. Each flip is STW. Also no minimum/maximum bounds — `GOMAXPROCS` could grow without limit (until `NumCPU` cap, but still wasteful) or drop to 0 (which is a no-op, but reaches 1 eventually).

Fix: add a cooldown between adjustments, bounds, and a smoothing function (e.g., require sustained high latency for N consecutive samples).

---

### Bug 12 Solution

Printing `NumCPU()` and labelling it `GOMAXPROCS`. Two different values; can disagree (especially when env var overrides).

Fix:

```go
log.Printf("GOMAXPROCS=%d NumCPU=%d", runtime.GOMAXPROCS(0), runtime.NumCPU())
```

---

### Bug 13 Solution

`runtime.GOMAXPROCS(8)` returns the **previous** value, not 8. The log line shows the old value.

Fix:

```go
runtime.GOMAXPROCS(8)
log.Printf("set to %d", runtime.GOMAXPROCS(0))
```

---

### Bug 14 Solution

The code reads the root cgroup `cpu.max`, not the process's actual cgroup. On Kubernetes with v2, the process is inside a sub-cgroup like `/kubepods.slice/kubepods-besteffort.slice/<pod-id>/cpu.max`.

Fix: parse `/proc/self/cgroup` to find the subpath, then read `/sys/fs/cgroup<subpath>/cpu.max`. Or use `automaxprocs` which does this correctly.

---

### Bug 15 Solution

Go 1.14 predates cgroup detection (added in 1.16). The runtime ignores the quota and returns the node CPU count.

Fix: upgrade Go, or import `automaxprocs`, which reads cgroup v1 on any Go version.

---

## Wrap-Up

Common patterns across these bugs:

1. **Overrides that defeat the runtime default.** The runtime since 1.18 is smart about cgroups; manual overrides usually break it.
2. **Env var > code, but watched-for code overrides anyway.** Init order matters.
3. **Confusing `NumCPU` with `GOMAXPROCS` with cgroup quota.** Three related but distinct values.
4. **Forgetting integer-division round-up.** Quotas like `500m` give `0` if you forget to ceil.
5. **Mid-program resizes cost STW.** Always set once at startup.
6. **Pre-1.16 / pre-1.18 Go in containers.** Most subtle, most common.
7. **Per-container vs per-pod limits.** Sidecars steal CPU.

If you can detect each of these in a code review or a manifest review, you have internalised the day-to-day operational reality of `GOMAXPROCS` in production Go.
