# Tuning `GOMAXPROCS` — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap and What Changes at This Level](#recap-and-what-changes-at-this-level)
3. [Container CPU Limits, From the Kernel Up](#container-cpu-limits-from-the-kernel-up)
4. [cgroup v1 vs v2 — Files and Formats](#cgroup-v1-vs-v2--files-and-formats)
5. [How Go Detects the Quota](#how-go-detects-the-quota)
6. [`automaxprocs` — Reading the Source](#automaxprocs--reading-the-source)
7. [CPU-Bound Sizing](#cpu-bound-sizing)
8. [I/O-Bound Sizing](#io-bound-sizing)
9. [Mixed Workloads — The Realistic Case](#mixed-workloads--the-realistic-case)
10. [NUMA Topology in One Page](#numa-topology-in-one-page)
11. [Sharing a Box — Co-Tenancy Math](#sharing-a-box--co-tenancy-math)
12. [The Cost of High GOMAXPROCS](#the-cost-of-high-gomaxprocs)
13. [The Cost of Low GOMAXPROCS](#the-cost-of-low-gomaxprocs)
14. [Reading a `schedtrace` Line in Detail](#reading-a-schedtrace-line-in-detail)
15. [A GOMAXPROCS Sweep on a Toy Server](#a-gomaxprocs-sweep-on-a-toy-server)
16. [Tail Latency vs Average Latency](#tail-latency-vs-average-latency)
17. [Performance Gotchas](#performance-gotchas)
18. [Practical Policy at the Middle Level](#practical-policy-at-the-middle-level)
19. [Self-Assessment](#self-assessment)
20. [Summary](#summary)

---

## Introduction

At junior level you learned what `GOMAXPROCS` is and that the default is almost always right. At middle level you start *measuring*. You can read cgroup files by hand, reproduce a sweep on a benchmark harness, and explain to a colleague why their hard-coded `runtime.GOMAXPROCS(64)` is hurting p99 in the staging pod with `cpu: 2`.

By the end of this file you will:

- Read `/sys/fs/cgroup/cpu.max` and translate it into the value Go would pick.
- Reproduce the cgroup-detection logic that `automaxprocs` uses.
- Run a GOMAXPROCS sweep on a real workload and interpret the curve.
- Distinguish CPU-bound from I/O-bound sizing rules.
- Recognise NUMA effects on a multi-socket box.
- Set a policy for your team: log, alert, sweep on hardware change.

---

## Recap and What Changes at This Level

Three things to internalise before reading further.

1. **`GOMAXPROCS` is the count of `P` structs**, not threads. Threads can be more (parked, blocked in syscalls, in cgo) or coincide with `GOMAXPROCS` at peak Go-code parallelism.
2. **The default is `NumCPU()`** since 1.5, and `NumCPU()` itself has been container-aware on Linux since 1.16 (cgroup v1) / 1.18 (cgroup v2).
3. **`procresize()`** is the runtime function that actually changes the P count. It is a stop-the-world. The cost is small but real.

What changes at middle level is your responsibility: you are no longer just trusting the default, you are sometimes deliberately overriding it. Every override needs a measurement.

---

## Container CPU Limits, From the Kernel Up

When Kubernetes (or Docker, or Podman, or systemd) starts a container with `cpu: 500m`, it does not magically restrict the process. It writes a CPU quota into a **cgroup** — a Linux kernel control-group file. The kernel then enforces the quota using the **CFS** (Completely Fair Scheduler) bandwidth controller: every period (default 100 ms), the process is allowed at most `quota` µs of CPU time before being throttled.

So `cpu: 500m` means 50 000 µs per 100 ms — half a CPU on average. If the process tries to burn a full CPU for 50 ms, it works; for the next 50 ms it is paused; then released again at the next period. From inside Go, this looks like every other syscall returning suspiciously late.

This is invisible to your application unless your runtime is cgroup-aware. The Go runtime since 1.16/1.18 reads the cgroup file at startup and converts it into the right `GOMAXPROCS`. Older Go does not.

---

## cgroup v1 vs v2 — Files and Formats

Two cgroup ABI versions exist. Modern Kubernetes (≥ 1.25) and modern Linux distributions (RHEL 9+, Ubuntu 22.04+, Debian 11+) default to **cgroup v2**. Older systems run cgroup v1, often with both mounted for compatibility.

**cgroup v1** — multiple controllers, each at its own mountpoint. The CPU quota lives in two files:

```
/sys/fs/cgroup/cpu,cpuacct/<group>/cpu.cfs_quota_us
/sys/fs/cgroup/cpu,cpuacct/<group>/cpu.cfs_period_us
```

A value of `-1` in `cpu.cfs_quota_us` means "no quota". Otherwise the limit (in CPUs) is `quota / period`.

**cgroup v2** — unified hierarchy, single mountpoint. The quota lives in one file:

```
/sys/fs/cgroup/cpu.max
```

The file contains two space-separated tokens: `quota period`. A quota of `max` means "no quota". Example:

```
$ cat /sys/fs/cgroup/cpu.max
50000 100000
```

This corresponds to half a CPU. The runtime computes `ceil(50000 / 100000) = 1` and sets `GOMAXPROCS=1`.

Edge case: a quota of `200000 100000` is "two CPUs". `GOMAXPROCS=2`. A quota of `250000 100000` is "two and a half CPUs"; Go rounds up to `3`.

A subtle case: a pod with **only a CPU request and no limit** has no quota at all. cgroup file says `max`. Go falls back to `NumCPU()` (the node CPU count). This is often fine — the pod is allowed to burst — but on a busy node may lead to noisy-neighbour effects.

---

## How Go Detects the Quota

The runtime's cgroup-detection logic lives in `src/runtime/proc.go` (and in `src/internal/syscall/unix` for the helpers). The simplified algorithm:

```
1. If GOMAXPROCS env var is set, use it; skip detection.
2. Read /proc/self/mountinfo to find cgroup v2 unified mount, or v1 cpu controller.
3. Read /proc/self/cgroup to find this process's cgroup path.
4. Open cpu.max (v2) or cpu.cfs_quota_us + cpu.cfs_period_us (v1).
5. If quota is set: GOMAXPROCS = max(1, ceil(quota / period)).
6. Otherwise: GOMAXPROCS = NumCPU() from sched_getaffinity().
```

A few subtleties:

- **`sched_getaffinity`** — this syscall returns the CPU set the kernel will let the thread run on. If you `taskset` a Go process to 4 cores out of 64, `NumCPU()` returns 4.
- **cgroup v2 reads from `cpu.max`**, not from CPU sets. A pod with `cpu: 4` quota on a 64-CPU node may still see `sched_getaffinity` returning 64 — the kernel CFS throttles you instead of pinning you. Go correctly preferes the quota.
- **Cgroup paths can be relative.** The runtime resolves them through `/proc/self/mountinfo`.
- **Permission errors** — if Go cannot read the cgroup file (rare, but happens with restrictive `seccomp` profiles), it falls back silently to `NumCPU()`. Audit your seccomp policy if you suspect this.

---

## `automaxprocs` — Reading the Source

`go.uber.org/automaxprocs` is a small library that does the same job as the runtime's built-in detection, but more aggressively (rounds half-quotas up to 1; logs decisions) and on older Go versions. Its core is:

```go
func init() {
    _, err := maxprocs.Set(maxprocs.Logger(log.Printf))
    if err != nil {
        log.Printf("maxprocs: failed: %v", err)
    }
}
```

Internally, `maxprocs.Set` does:

```
1. Read GOMAXPROCS env var; if set, skip.
2. Detect cgroup v1 or v2 via /proc/self/cgroup + /proc/self/mountinfo.
3. Read quota and period.
4. Compute ceil(quota / period); clamp to >= 1.
5. Call runtime.GOMAXPROCS(n).
6. Log decision via injected logger.
```

It returns an `Undo()` function so tests can restore the previous value:

```go
undo, _ := maxprocs.Set()
defer undo()
```

If you want to read the actual source, it is small enough to read in 20 minutes — see `github.com/uber-go/automaxprocs/maxprocs/maxprocs.go` and `github.com/uber-go/automaxprocs/internal/cgroups/`.

Production tip: enable its log line and pipe it into your structured logger. Operators searching `kubectl logs` for "maxprocs:" can immediately see what value was chosen for that pod.

---

## CPU-Bound Sizing

A pure CPU-bound workload — say, image resizing, video transcoding, scientific compute — has a simple rule: **`GOMAXPROCS = number of cores you exclusively own`**.

- On bare metal: `NumCPU()` (the default).
- On Kubernetes with a CPU limit: the cgroup quota (also the default since 1.16/1.18).
- On Kubernetes with **no** limit but with a request: still ambiguous. The runtime sees `NumCPU()`. If you are pessimistic about co-tenancy, manually cap at the request value.

Above `NumCPU()` produces no speedup because the kernel has no more cores. The runtime adds overhead (more Ps to scan, more idle Ps).

Below `NumCPU()` produces linear throughput loss until you bottleneck somewhere else (memory bandwidth, disk I/O).

A simple way to verify: run your workload at `GOMAXPROCS=1, 2, 4, 8, ..., NumCPU, 2*NumCPU` and plot throughput. You should see a near-linear ramp up to `NumCPU` and a plateau (or slight decline) beyond.

---

## I/O-Bound Sizing

A pure I/O-bound workload — say, an HTTP gateway calling out to a backend — has very different sizing.

The netpoller parks goroutines waiting on network I/O without holding their P. So 10 000 idle connections cost 10 000 goroutines and zero Ps. The Ps are free to run other work.

Concrete consequence: even `GOMAXPROCS=2` can serve 10 000 concurrent connections if each connection's per-request CPU work is small. The bottleneck is rarely the P count; it is downstream latency or socket buffer sizing.

Why does this matter? Because operators often see "huge concurrent connection count" and think "I need more Ps". They do not. Trust the default; the netpoller does the heavy lifting.

Exception: the **server's own CPU work per request** is what consumes Ps. If you parse a 10 MB JSON body on every request, your Ps are busy and `GOMAXPROCS` matters again. Profile to know.

---

## Mixed Workloads — The Realistic Case

Real services are neither pure CPU nor pure I/O. A typical web service:

- Receives a request via the netpoller (free Ps).
- Parses JSON (CPU; consumes Ps).
- Queries a database (netpoller; free Ps).
- Renders a template (CPU; consumes Ps).
- Writes the response (netpoller; free Ps).

The CPU portion of a request might be 1 ms; the I/O portion might be 50 ms. At 1 000 RPS, the service needs ~1 second of CPU per second — one core of work. `GOMAXPROCS=1` is theoretically enough.

In practice, leave a safety margin. With `GOMAXPROCS=4` on a 4-core box, you have 4× the steady-state CPU demand. Burst capacity covers the inevitable GC pause, occasional cgo call, or slow client.

A useful rule of thumb: **set `GOMAXPROCS` to the maximum CPU you expect to use during a sustained burst, plus 1**. For most services, this is the cgroup quota (default) plus nothing — the burst is what the quota was sized for.

---

## NUMA Topology in One Page

On large multi-socket servers (say, two Xeon sockets each with 32 cores, 64 logical CPUs total), memory is **non-uniform**: each socket has its own attached RAM. Accessing remote-socket RAM is 1.5× to 2× slower than local. The kernel reports this as a NUMA topology with multiple **nodes**.

Implications for Go:

- `GOMAXPROCS=64` lets the runtime schedule goroutines on all sockets. A goroutine started on socket 0 may be stolen by a P on socket 1 mid-execution. Its stack and heap allocations live on socket 0's RAM; the new P reads them across the interconnect. Cache misses and remote-memory accesses degrade throughput.
- The Go scheduler is **NUMA-unaware**. It does not try to keep work on a local socket.
- The Go memory allocator (`mcache`/`mcentral`/`mheap`) also has no NUMA awareness — allocations end up on whichever socket the requesting M happens to be on.

The pragmatic fix: instead of one Go process with `GOMAXPROCS=64`, run **two Go processes** — one pinned to each socket via `numactl`:

```bash
numactl --cpunodebind=0 --membind=0 ./server --port=8080 &
numactl --cpunodebind=1 --membind=1 ./server --port=8081 &
```

Each process sees `NumCPU() = 32` (because affinity is constrained) and runs with `GOMAXPROCS=32`. Cross-socket traffic is eliminated. Throughput typically rises 20–40% on memory-heavy workloads.

You only care about this on big servers (32+ cores, multi-socket). Single-socket boxes — or all virtualised cloud instances under ~32 vCPU — are uniform.

---

## Sharing a Box — Co-Tenancy Math

When multiple Go processes share a single machine without cgroup limits (or with overlapping limits), each one sees the full machine CPU count and sets `GOMAXPROCS` aggressively. The kernel time-slices between them, and overall throughput drops.

A worked example: 16-core machine, four Go services co-located, no quotas.

- Each sees `NumCPU() = 16`. Each sets `GOMAXPROCS=16`.
- 64 Ps in total across the services want to run.
- Only 16 cores exist. The kernel context-switches between them aggressively.
- Each P-on-core scheduling decision now races with three other processes' decisions.
- Throughput per service: maybe 1/4 of optimum (linear time-sharing). Tail latency: much worse.

The fix is one of:

- Add cgroup limits so each service sees a fraction of the CPU.
- Set `GOMAXPROCS=4` manually in each service.
- Pin each service to a disjoint core set via `taskset` or `numactl`.

In Kubernetes, this comes for free: set `cpu: 4` on each pod's limits and they each see 4 cores. Outside Kubernetes (bare-metal multi-tenant servers, dev boxes), be deliberate.

---

## The Cost of High GOMAXPROCS

Going above `NumCPU` is wasteful even on a dedicated machine. Where does the waste come from?

1. **Spinning.** When an M finishes its work, the runtime allows it to *spin* for a brief period looking for new work (so that newly produced work is picked up immediately, without a wakeup syscall). More Ps means more places to check. Spin time is CPU time you are not getting back.
2. **Work-stealing scans.** When a P's local runqueue is empty, it scans other Ps' queues. With 100 Ps, each scan touches 100 cache lines. With 8 Ps, it touches 8. Scan overhead grows linearly in P count.
3. **Idle Ps in metadata.** Every P has a struct in `allp`. The `findrunnable` function iterates this slice. Idle Ps are skipped but still touched.
4. **More cross-P migrations.** A goroutine may bounce between Ps, losing cache warmth.

For typical workloads, raising `GOMAXPROCS` from `NumCPU` to `2*NumCPU` costs ~3–8% throughput. Raising to `10*NumCPU` costs 15–30%. The default exists for a reason.

---

## The Cost of Low GOMAXPROCS

Going below `NumCPU` saves no resources — the cores are still there, you are simply not using them. The cost is:

1. **Lower throughput on CPU-bound paths.** Trivially linear; `GOMAXPROCS=4` on an 8-core box halves CPU-bound throughput.
2. **Higher tail latency.** With fewer Ps, queue depth on each P rises under bursts. p99 latency suffers more than p50.
3. **Less burst headroom.** A spike in CPU demand cannot exceed `GOMAXPROCS` cores. With fewer Ps, the spike causes queuing instead of parallelism.
4. **GC under-utilisation.** GC mark workers run on the available Ps. With fewer Ps, GC takes proportionally longer wall-clock time. (Though it consumes less total CPU.)

The trade-off becomes interesting on multi-tenant boxes: lowering `GOMAXPROCS` for one service may free CPU for another that needs it more. Outside of co-tenancy, lowering is rarely worthwhile.

---

## Reading a `schedtrace` Line in Detail

```
SCHED 1000ms: gomaxprocs=4 idleprocs=0 threads=18 spinningthreads=2 needspinning=0 idlethreads=4 runqueue=12 [3 0 5 1]
```

What this tells you:

- `gomaxprocs=4`: configured cap.
- `idleprocs=0`: every P has work. Scheduler is busy.
- `threads=18`: 18 OS threads. 4 are running on Ps, the rest are parked or in syscalls.
- `spinningthreads=2`: two Ms are currently spinning looking for work. Surprising given `idleprocs=0` — usually means there is short-lived work being produced.
- `needspinning=0`: no requests for additional spinning Ms.
- `idlethreads=4`: 4 Ms in the M-pool (parked, awaiting future work).
- `runqueue=12`: 12 goroutines in the global runqueue.
- `[3 0 5 1]`: per-P local runqueues. P0 has 3 runnable, P1 is empty, P2 has 5, P3 has 1.

Pattern recognition:

- **`idleprocs=0` and `runqueue > 0`** repeatedly: scheduler saturated. Either more cores or fewer goroutines.
- **`idleprocs ≈ gomaxprocs`** repeatedly: you have idle Ps, work is light. Maybe `GOMAXPROCS` is fine; maybe over-provisioned.
- **`threads ≫ gomaxprocs + ~10`** persistently: many Ms in syscalls or cgo. Investigate.
- **`spinningthreads > 0`** with no useful work: scheduler is hunting; can indicate `GOMAXPROCS` too high for the workload.

---

## A GOMAXPROCS Sweep on a Toy Server

Concrete reproducible benchmark. Build a tiny HTTP server that does a fixed amount of CPU per request:

```go
package main

import (
    "crypto/sha256"
    "fmt"
    "log"
    "net/http"
    "runtime"
)

func handler(w http.ResponseWriter, r *http.Request) {
    h := sha256.New()
    buf := make([]byte, 4096)
    for i := 0; i < 64; i++ { // ~256 KB of SHA-256 per request, ~1 ms of CPU
        h.Write(buf)
    }
    fmt.Fprintf(w, "%x\n", h.Sum(nil))
}

func main() {
    log.Printf("GOMAXPROCS=%d", runtime.GOMAXPROCS(0))
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}
```

Drive with `wrk`:

```bash
wrk -t8 -c64 -d20s http://localhost:8080/
```

Run the server at `GOMAXPROCS=1, 2, 4, 8, 16, 32` on an 8-core box. Expect a curve like:

| GOMAXPROCS | Throughput (req/s) | p99 latency |
|---|---|---|
| 1 | 1 100 | 70 ms |
| 2 | 2 100 | 35 ms |
| 4 | 3 900 | 20 ms |
| 8 | 7 200 | 12 ms |
| 16 | 7 100 | 14 ms |
| 32 | 6 800 | 18 ms |

Throughput peaks at `GOMAXPROCS = NumCPU`. Beyond, both throughput drops and p99 worsens due to scheduler overhead. This is the canonical "right side of the curve" — what you should be able to reproduce on demand.

---

## Tail Latency vs Average Latency

`GOMAXPROCS` affects p99 more than p50. Why?

- p50 latency depends on per-request work + average queueing. Average queue depth is roughly RPS × per-request CPU / cores. As long as `GOMAXPROCS ≥ RPS × CPU` you are fine.
- p99 latency includes the worst-case wait: a request arriving when all Ps are busy with longer-running peers, plus a GC pause coinciding. With fewer Ps, this worst case is dramatically worse — your request waits behind more peers.

When tuning for tail latency:

- Slightly **higher** `GOMAXPROCS` (up to `NumCPU`) helps absorb bursts.
- **Smaller** GC pauses help — see `GOMEMLIMIT` and `GOGC`.
- **Bounded** per-request work (no monster requests) reduces p99 directly.

`GOMAXPROCS` is one tool of many for tail latency. Profile first.

---

## Performance Gotchas

A short list of gotchas you will run into.

**1. The cgroup quota changes at runtime.** Some orchestrators support hot-resizing pod CPU limits. The Go runtime reads the quota at startup, not continuously. After a resize, `GOMAXPROCS` is stale. Workarounds:

- Restart the pod.
- Implement a small reload routine that re-reads the cgroup and calls `runtime.GOMAXPROCS` (incurs STW).

**2. CPU affinity at startup.** If your launcher sets affinity via `taskset` before exec, the Go runtime sees the constrained CPU set via `sched_getaffinity`. `NumCPU()` returns the constrained count. This is the right behaviour — but it can surprise operators who set `GOMAXPROCS` manually then notice `NumCPU` lower than expected.

**3. CFS throttle storms.** A pod just under its quota will randomly burst over and get throttled. The throttle period is 100 ms by default — a single burst can stall a goroutine for 100 ms. If you see periodic 100 ms latency spikes, suspect CFS throttling. Either raise the quota or lower `GOMAXPROCS` so steady-state CPU stays below quota.

**4. Goroutine count is not GOMAXPROCS.** Repeating from junior level: do not bound your goroutine spawn rate by `GOMAXPROCS`. They are different knobs.

**5. `runtime.GOMAXPROCS(n)` in tests can be racy.** If two parallel test binaries set `GOMAXPROCS` to different values, both share the same process — undefined behaviour. Restore on `defer`.

**6. M creation can stall briefly.** When the runtime first needs a new M, it calls `clone(2)` (Linux) — a syscall that takes ~10 µs. If your workload bursts from 0 to many cgo calls suddenly, the first few requests pay this cost.

**7. `GOMAXPROCS=0` is not a setter.** Calling `runtime.GOMAXPROCS(0)` returns the current value, does not zero it. The signature is `func GOMAXPROCS(n int) int`. `n <= 0` is "read only".

---

## Practical Policy at the Middle Level

A reasonable team policy:

1. **Log `GOMAXPROCS` and `NumCPU` at startup**, always, on every service.
2. **Trust the default** on Go ≥ 1.18 on Linux containers. Verify the log line shows the right value for your cgroup quota.
3. **Include `automaxprocs`** if your fleet has any older Go or any non-Linux container.
4. **Sweep `GOMAXPROCS`** before changing it in production. Reproduce the change on staging with a load generator. Compare p99 and throughput.
5. **Alert if `GOMAXPROCS` is unexpected** — for example, `GOMAXPROCS > 2 * configured_cpu_limit` should fire an alert that someone misconfigured the pod.
6. **Document NUMA splits** if you run on multi-socket bare metal. The pattern (multiple processes, one per socket) is non-obvious; record it.
7. **Never call `runtime.GOMAXPROCS(n)` deep in handler code.** Set once at startup. Mid-program changes are STW.

This is enough for 95% of services. The senior file pushes into the remaining 5%.

---

## Self-Assessment

- [ ] I can read `/sys/fs/cgroup/cpu.max` and compute the value Go will choose.
- [ ] I know cgroup v1 vs v2 file layouts and which Go version added support.
- [ ] I can reproduce a GOMAXPROCS sweep with `wrk` and a toy server.
- [ ] I distinguish CPU-bound from I/O-bound sizing rules.
- [ ] I can explain why `GOMAXPROCS > NumCPU` typically reduces throughput.
- [ ] I recognise CFS throttling symptoms (periodic ~100 ms latency spikes).
- [ ] I understand why NUMA boxes benefit from multiple processes instead of one with high `GOMAXPROCS`.
- [ ] I have a startup log line for `GOMAXPROCS`, `NumCPU`, `GOOS`.
- [ ] I know `automaxprocs` and when it is needed.
- [ ] I can read a `GODEBUG=schedtrace=1000` line and explain each field.

---

## Summary

Middle level is where you stop trusting the default blindly and start verifying it. The runtime since Go 1.18 does the right thing in containers on Linux — but operators routinely break that by setting overrides, by running on older Go, or by deploying onto NUMA boxes where one process is the wrong shape.

The recipes are:

- **Default plus log line.** Solves 90% of cases.
- **`automaxprocs` import** for legacy Go.
- **Per-socket processes** for NUMA boxes.
- **GOMAXPROCS sweep** before any production override.
- **Distinguish CPU-bound from I/O-bound.** The netpoller does the heavy lifting for I/O.

In [senior.md](senior.md) you will graduate from "log and verify" to "metric, alert, autoset", with policies for fleets of hundreds of services, sweep automation in CI, and benchmark-driven NUMA decisions. [professional.md](professional.md) goes into the actual `procresize` function and the STW cost of dynamic resizing.
