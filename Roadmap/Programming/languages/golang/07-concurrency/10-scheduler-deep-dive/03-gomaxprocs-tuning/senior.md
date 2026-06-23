# Tuning `GOMAXPROCS` — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Fleet-Level Policy](#fleet-level-policy)
3. [Observability — Metrics and Alerts](#observability--metrics-and-alerts)
4. [Sweep Automation in CI](#sweep-automation-in-ci)
5. [Production Heuristics](#production-heuristics)
6. [CFS Throttling Diagnostics](#cfs-throttling-diagnostics)
7. [NUMA Architectures in Depth](#numa-architectures-in-depth)
8. [Tail-Latency Tuning](#tail-latency-tuning)
9. [Workload-Aware Autosetting](#workload-aware-autosetting)
10. [Latency vs Throughput Trade-Offs](#latency-vs-throughput-trade-offs)
11. [Sidecar and Service-Mesh Considerations](#sidecar-and-service-mesh-considerations)
12. [Co-Tenancy and Anti-Affinity](#co-tenancy-and-anti-affinity)
13. [Container Runtimes Beyond Kubernetes](#container-runtimes-beyond-kubernetes)
14. [Comparison With Other Runtimes](#comparison-with-other-runtimes)
15. [Production Incident Patterns](#production-incident-patterns)
16. [Senior-Level Checklist](#senior-level-checklist)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)

---

## Introduction

At senior level you own the policy that governs `GOMAXPROCS` for dozens — possibly hundreds — of services. Your concern is not "what should this one service use" but "what is the system-wide contract that prevents one service from blowing up production". You write the runbooks, you set the alerts, you decide when to invest in workload-aware autosetting versus relying on Kubernetes manifests.

This file covers the operational side: fleet-level defaults, observability, sweep automation, and the production incidents that originate from `GOMAXPROCS` misconfiguration. The heavier mechanical content (procresize STW, runtime sources) lives in [professional.md](professional.md). The benchmark-driven tuning recipes live in [optimize.md](optimize.md).

---

## Fleet-Level Policy

When you manage many services, you cannot inspect each one's `GOMAXPROCS` by hand. Codify a small set of rules into your platform.

**Rule 1: Every service emits `GOMAXPROCS` as a metric.**

```go
import (
    "github.com/prometheus/client_golang/prometheus"
    "runtime"
)

var gomaxprocsGauge = prometheus.NewGauge(prometheus.GaugeOpts{
    Name: "process_gomaxprocs",
    Help: "Current GOMAXPROCS value",
})

func init() {
    prometheus.MustRegister(gomaxprocsGauge)
    gomaxprocsGauge.Set(float64(runtime.GOMAXPROCS(0)))
}
```

**Rule 2: Every service uses Go ≥ 1.18 on Linux containers.** Below this, mandate `automaxprocs`. Enforce via base-image versioning or CI lint.

**Rule 3: Manifests must declare CPU limits.** Pods without limits can absorb arbitrary CPU and break neighbour pods. Reject manifests at admission with a policy controller (OPA, Kyverno, etc.).

**Rule 4: Critical services log the resolved `GOMAXPROCS` at startup.** Logs are the last line of defence when the metric is missing.

**Rule 5: `runtime.GOMAXPROCS(n)` calls in source require a comment** linking to a benchmark issue justifying the value. Lint for this.

These five rules cover the long tail of mis-tuning. Most production incidents I have seen would have been caught by rule 1 or rule 3.

---

## Observability — Metrics and Alerts

Beyond `process_gomaxprocs`, the metrics that diagnose `GOMAXPROCS` issues are:

| Metric | Source | What it tells you |
|---|---|---|
| `process_cpu_seconds_total` | Prometheus client | Total CPU consumed. Rate ≈ avg cores in use. |
| `container_cpu_cfs_throttled_periods_total` | cAdvisor / kubelet | How many CFS periods saw throttling. Non-zero = mis-sized. |
| `container_cpu_cfs_throttled_seconds_total` | cAdvisor | Wall-clock time throttled. >0.01/s = serious. |
| `go_sched_latencies_seconds` | `runtime/metrics` | Histogram of scheduling delays. Tail tells you about saturation. |
| `go_sched_goroutines_goroutines` | `runtime/metrics` | Current goroutine count. Per-service trend. |
| `process_open_fds` | Prometheus | Indirect: high I/O concurrency. |

Useful Prometheus rule:

```yaml
- alert: GoServiceCFSThrottled
  expr: rate(container_cpu_cfs_throttled_seconds_total{namespace="prod"}[5m]) > 0.05
  for: 5m
  annotations:
    summary: "Pod {{ $labels.pod }} is being CFS-throttled."
    description: "Likely GOMAXPROCS too high for cpu limit, or actual CPU need exceeds limit."
```

Another:

```yaml
- alert: GoSchedulerLatencyHigh
  expr: histogram_quantile(0.99, rate(go_sched_latencies_seconds_bucket[5m])) > 0.005
  for: 10m
```

Scheduler p99 > 5 ms means goroutines are waiting noticeable time to be picked up. Could be over-load (need more cores) or under-allocation (too-low `GOMAXPROCS`).

A typical dashboard for a service shows three panels stacked: throughput, p99 latency, and CFS throttle rate. If throttle rate is non-zero, throughput drops are explained.

---

## Sweep Automation in CI

Manual sweeps are useful for diagnostics, not for keeping configuration current. Codify them.

A typical sweep job:

```bash
#!/usr/bin/env bash
set -e
for n in 1 2 4 8 16; do
  GOMAXPROCS=$n ./service &
  PID=$!
  sleep 5
  wrk -t8 -c64 -d30s http://localhost:8080/ | tee result-$n.txt
  kill $PID
  wait $PID 2>/dev/null
done
python plot_sweep.py result-*.txt > sweep.png
```

Run on every release that touches CPU-heavy paths. Compare the curve to the previous baseline. Alert if peak throughput shifts by more than 10%.

For services where the workload changes seasonally, run the sweep weekly in a staging environment with replayed production traffic.

**Caveat.** Synthetic benchmarks lie. A request that takes 1 ms of CPU in `wrk` may take 5 ms in production due to GC pressure or downstream variance. Use sweeps to spot regressions, not to set the absolute value.

---

## Production Heuristics

A handful of rules that hold for almost every Go service I have shipped:

**Heuristic 1: For most services, `GOMAXPROCS` should equal the integer cgroup quota.**

If your pod has `cpu: 2`, `GOMAXPROCS=2`. If `cpu: 500m`, `GOMAXPROCS=1` (ceiling). The Go runtime 1.18+ does this automatically.

**Heuristic 2: For latency-critical services, consider `GOMAXPROCS = quota - 1`** with appropriate request sizing.

Reasoning: one core's worth of headroom for GC mark workers and goroutines that need to preempt. Reduces p99 tail under burst.

This is non-default; you must call `runtime.GOMAXPROCS(quota - 1)` yourself. Validate with a sweep.

**Heuristic 3: For batch-processing services, set `GOMAXPROCS = NumCPU` of the node, not the cgroup.**

Batch jobs are insensitive to latency, want maximum throughput, and run when the node is under-utilised. Use Kubernetes `cpu.request = quota` and set no limit (or a very high one). Be sure other pods on the node tolerate the bursty pattern.

**Heuristic 4: Never let `GOMAXPROCS` exceed 2× the cgroup quota.**

Above this, CFS throttling becomes severe enough to break SLOs. Enforce in admission control or a startup self-check.

**Heuristic 5: For services that do significant blocking I/O via filesystem reads, raise `GOMAXPROCS` slightly.**

Reasoning: every blocking syscall parks a P for tens of microseconds during the handoff. A few extra Ps cushion the throughput dip. Typical: `GOMAXPROCS = quota + 1` for log-tailing services or anything reading from local SSDs in 100s of MB/s.

---

## CFS Throttling Diagnostics

When `container_cpu_cfs_throttled_seconds_total` is non-zero, here is the playbook.

**Step 1: Confirm throttling is the cause.** Compare:

```promql
# Wall-clock throttled / 5 minutes
rate(container_cpu_cfs_throttled_seconds_total[5m])

# CPU consumed / 5 minutes
rate(container_cpu_usage_seconds_total[5m])
```

If throttled is > 1% of consumed, you have a real problem.

**Step 2: Check `GOMAXPROCS` vs quota.**

If `GOMAXPROCS > quota`, you are over-subscribing. Two fixes:

- Lower `GOMAXPROCS` to `ceil(quota)`. (Default since 1.18 — if you see this and you are on a recent Go, someone overrode it.)
- Raise the quota.

**Step 3: Check actual CPU demand.**

If `GOMAXPROCS == quota` but throttling is still occurring, your service simply wants more CPU than the quota allows. Either:

- Provision more cores.
- Profile and reduce CPU-per-request.

**Step 4: Check CFS period.**

Default is 100 ms. Some clusters tune this lower (50 ms or 25 ms) to reduce throttle latency. Trade-off: more frequent quota enforcement, more accounting overhead. Worth knowing this exists.

**Step 5: Verify your runtime version.**

A bug in some Go versions (before 1.16 reliably, sporadically after) under-detected cgroup quotas. Upgrade if you are on anything below 1.18.

---

## NUMA Architectures in Depth

Senior-level NUMA decisions go beyond "run one process per socket".

**Map the topology first.**

```bash
$ lscpu | head -20
Architecture:        x86_64
CPU(s):              64
NUMA node(s):        2
NUMA node0 CPU(s):   0-15,32-47
NUMA node1 CPU(s):   16-31,48-63
```

Two sockets. Each has 16 physical cores; HT brings to 32 logical CPUs per socket. The OS interleaves CPU numbering — be careful when pinning.

**Decide the split.**

Options:

1. **One process, GOMAXPROCS=64.** Simplest. Cross-socket traffic ~10% throughput penalty for memory-heavy work.
2. **Two processes, each GOMAXPROCS=32, pinned to one socket.** Best memory locality. Requires load-balancer in front.
3. **Two processes, each GOMAXPROCS=16 (physical cores per socket), HT disabled per-process.** Best per-core throughput for FPU-heavy work.
4. **One process, GOMAXPROCS=32 (one socket worth).** Discards the other socket; useful only for capacity planning on a shared box.

For most services, option 2 is the sweet spot.

**Pinning with systemd.**

```ini
[Service]
ExecStart=/usr/bin/numactl --cpunodebind=0 --membind=0 /usr/local/bin/myservice
CPUAffinity=0-15 32-47
```

**Pinning in Kubernetes.**

Use the static `cpu-manager-policy=static` on the kubelet plus topology hints. The pod must request integer CPUs (no millicores). The kernel pins each pod to a NUMA-local CPU set.

**Verifying.**

```bash
$ cat /proc/$(pgrep myservice)/status | grep Cpus_allowed_list
Cpus_allowed_list:  0-15,32-47
```

This must match the intended NUMA node's CPUs.

**Memory-locality verification.**

```bash
$ numastat -p $(pgrep myservice)
                           Node 0          Node 1           Total
                         --------------- ------------- ---------------
Numa_Hit                    1.2e+10         3.0e+08         1.2e+10
Numa_Miss                   1.5e+07         8.0e+05         1.6e+07
Local_Node                  1.2e+10         3.0e+08         1.2e+10
Other_Node                  1.5e+07         8.0e+05         1.6e+07
```

`Other_Node` should be < 1% of `Local_Node`. Higher means cross-socket traffic.

---

## Tail-Latency Tuning

`GOMAXPROCS` is one of three knobs that govern Go tail latency. The other two are `GOGC` (or `GOMEMLIMIT`) and `GODEBUG=gctrace`. Combined, they determine the distribution.

A typical workflow:

1. **Baseline.** Default `GOMAXPROCS`, `GOGC=100`. Record p50, p99, p99.9.
2. **Reduce GC pressure.** Pool buffers (`sync.Pool`). Reduce allocations per request. Confirm p99.9 drops.
3. **Tune `GOGC`.** Higher (e.g., 200) reduces GC frequency at memory cost. Confirm p99 drops further.
4. **Set `GOMEMLIMIT`.** Hard cap so the GC won't grow unbounded. Confirm process stays within memory budget.
5. **Tune `GOMAXPROCS`.** Try `quota - 1` for headroom. Confirm p99 holds or improves.
6. **Run sweep.** Verify each change in isolation.

The order matters: changing `GOMAXPROCS` before fixing allocation hotspots is throwing darts. Fix the GC story first.

A useful observation: increasing `GOMAXPROCS` *speeds up* GC marking (more parallel workers), but only up to a point. Beyond `NumCPU`, GC overhead per cycle rises. The optimum for tail latency is usually a small adjustment around `NumCPU`, not a large one.

---

## Workload-Aware Autosetting

Some teams have built dynamic `GOMAXPROCS` controllers. The idea: observe scheduler latency or CFS throttle rate, and adjust `GOMAXPROCS` up or down to keep both within bounds.

A sketch:

```go
func adaptiveLoop(ctx context.Context) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            p99 := readSchedLatencyP99()       // /sched/latencies
            throttle := readCFSThrottleRate()  // cgroup
            current := runtime.GOMAXPROCS(0)
            switch {
            case throttle > 0.01:
                // Throttling; back off
                if current > 1 {
                    runtime.GOMAXPROCS(current - 1)
                    log.Printf("autoscale: lowered to %d", current-1)
                }
            case p99 > 5*time.Millisecond && current < runtime.NumCPU():
                // Saturated; expand
                runtime.GOMAXPROCS(current + 1)
                log.Printf("autoscale: raised to %d", current+1)
            }
        }
    }
}
```

**Caveats — and they are big.**

- Each `runtime.GOMAXPROCS(n)` call is **stop-the-world**. Frequent adjustments cause periodic latency spikes.
- Hysteresis is essential; without it the system flaps.
- The decision can be wrong if your throughput is intentionally variable (cron, daily traffic).
- It does not solve under-provisioning. You cannot scale beyond cgroup quota.

In practice, this pattern is rare. Most teams settle for "log it, alert on misconfig, set it statically". The exception is platforms with extreme dynamic load (auction servers, real-time bidding, financial exchanges) where the cost of getting it wrong is high enough to justify the complexity.

---

## Latency vs Throughput Trade-Offs

The two metrics pull in opposite directions.

- **Throughput** is maximised at `GOMAXPROCS = NumCPU`, no overcommit.
- **Latency** is best with slight headroom (`GOMAXPROCS < NumCPU`) so bursts have a margin.

A worked example: 8-core box, request takes 1 ms CPU, expected RPS 5 000, occasional 10 000 RPS bursts.

| GOMAXPROCS | Throughput at 5 000 RPS | p99 at 10 000 RPS burst |
|---|---|---|
| 4 | OK (50% util) | Bad — queue depth doubles |
| 6 | OK (33% util) | OK — burst headroom |
| 8 | OK (12% util) | OK — full headroom |
| 8 + cohort | Worse — cgroup throttle | Worse |

For services with bursty traffic, **set the cgroup limit slightly above steady-state demand** and let `GOMAXPROCS` follow the limit. Headroom is the lever, not `GOMAXPROCS` overcommit.

For services with steady traffic, **set `GOMAXPROCS` equal to the limit**. The default does this for you.

---

## Sidecar and Service-Mesh Considerations

Many Go services run alongside a sidecar — Envoy, Linkerd-proxy, an OPA agent. The sidecar consumes its own CPU and counts against the **pod's** CPU limit (not the container's).

A typical pattern:

```yaml
resources:
  limits:
    cpu: "4"      # for whole pod
```

If your Go service container has 4 cores' worth of `GOMAXPROCS` and the Envoy sidecar consumes 1 core, you are over-subscribing — the pod will be throttled.

The fix is **per-container limits** or **per-container quota**, not per-pod:

```yaml
containers:
- name: app
  resources:
    limits:
      cpu: "3"  # explicit
- name: envoy
  resources:
    limits:
      cpu: "1"
```

Now each container has its own cgroup with its own quota. Go reads only the app container's cgroup. `GOMAXPROCS=3`.

This is one of the most common misconfigurations I have seen. Audit your manifests.

---

## Co-Tenancy and Anti-Affinity

When two CPU-heavy pods land on the same node, they fight. Even with cgroup quotas, CFS scheduling latency rises and tail latencies suffer.

**Mitigations:**

- **Pod anti-affinity** for latency-critical services: prevent two replicas on the same node.
- **Topology spread constraints** to spread across NUMA zones / racks.
- **Reserved nodes** (taints + tolerations) for tier-0 services.
- **Static CPU manager policy** (kubelet) to pin pods to dedicated CPUs.

These belong in your manifest templates; the Go service itself does not need to know. The contract is: each pod has stable, exclusive CPU; `GOMAXPROCS` matches it.

---

## Container Runtimes Beyond Kubernetes

Most of this file assumes Kubernetes, but the principles apply elsewhere.

- **Docker / podman directly.** `--cpus=2` sets a cgroup CPU quota. Go reads it.
- **systemd-nspawn.** Cgroup-aware; respect `CPUQuota=200%`.
- **Nomad.** Translates `cpu = 2000` (MHz) into a cgroup CPU share. Different model — share-based, not quota-based. Go cannot detect shares; falls back to `NumCPU`. Set `GOMAXPROCS` manually.
- **LXC.** Cgroup-based; Go reads correctly.
- **Firecracker, gVisor.** Sandboxed; cgroup files exist; Go reads correctly. Verify with a startup log.

If you run on bare metal without cgroups (rare), set `GOMAXPROCS` from the systemd unit's `CPUAffinity` or `taskset`-launched binary.

---

## Comparison With Other Runtimes

A senior engineer should be conversant with how other runtimes handle this knob.

**Java.** `Runtime.availableProcessors()` returns `nproc` on bare metal. Since JDK 8u191 / JDK 10 it honours cgroup CPU quotas (rounding up). The JVM uses this for thread-pool sizing in `ForkJoinPool`, `CompletableFuture.commonPool()`, GC mark workers, etc. JVMs that pre-date this are notorious for over-threading in containers; the JVM flag `-XX:ActiveProcessorCount=N` overrides.

Key difference: the JVM does not have a single `GOMAXPROCS` equivalent. Thread-pool sizing is distributed across libraries. So `availableProcessors()` influences many things; in Go, `GOMAXPROCS` is the unifying concept.

**Rust + Tokio.** `tokio::runtime::Builder::worker_threads(n)` — defaults to `num_cpus::get()`. The `num_cpus` crate does **not** read cgroup quotas by default. You must enable a feature flag or set `TOKIO_WORKER_THREADS` explicitly. Container-aware sizing is on the user.

Rust's pattern: explicit worker count, manual cgroup detection. Less safe defaults than Go.

**.NET.** `Environment.ProcessorCount` returns container-aware CPU count since .NET 5. ThreadPool sizes automatically. Similar maturity to recent Go.

**Node.js.** Single-threaded for JS execution; `os.availableParallelism()` (Node 18.14+) returns container-aware count. Used for `cluster.workers`. Worker threads opt-in.

**Python (asyncio).** Single-threaded by default. `concurrent.futures.ProcessPoolExecutor(max_workers=os.cpu_count())` is the usual sizing — and `os.cpu_count()` was made cgroup-aware in Python 3.13 (`os.process_cpu_count()`). Before that, manual.

**Erlang/OTP.** `+S N:N` flag sets scheduler count. Default = `nproc` (not cgroup-aware until OTP 24). Equivalent role to `GOMAXPROCS`.

The pattern across ecosystems: cgroup-awareness arrived in the late 2010s. Go (1.16, 2021) and Java (JDK 10, 2018) are the leaders. Rust and Python lag.

---

## Production Incident Patterns

Three real-world patterns I have seen across teams.

**Pattern 1: "Throughput dropped after we upgraded the cluster from cgroup v1 to v2."**

Cause: service was on Go 1.16 or 1.17, which read v1 quotas correctly but not v2. After upgrade, `GOMAXPROCS` defaulted to node count instead of quota. CFS throttling spiked.

Fix: upgrade Go to 1.18+. Add `automaxprocs` as belt-and-braces.

**Pattern 2: "Service is fast on staging, slow on production."**

Cause: staging node had 8 cores; production node had 96 cores. Service hard-coded `runtime.GOMAXPROCS(runtime.NumCPU())` and bypassed cgroup detection. Production pod had `cpu: 4` limit and 96 Ps; throttle storm.

Fix: remove the override line. Let the default work.

**Pattern 3: "p99 latency spiked after we added 4 sidecars to the deployment."**

Cause: sidecars consumed CPU that the app container assumed it would have. Per-pod limit was 8 cores; app container's effective share was ~3 cores. App's `GOMAXPROCS` was 8 — over-subscribed.

Fix: per-container limits. Audit all manifests.

These are not exotic. They reproduce regularly. The detective work is always: check the cgroup file, check `GOMAXPROCS`, check the running Go version. The numbers should add up to the expected story.

---

## Senior-Level Checklist

When taking ownership of a service's `GOMAXPROCS` policy, run through this list:

- [ ] What Go version is the service on? Is it cgroup-aware?
- [ ] Does the manifest declare `cpu` limit explicitly?
- [ ] Is `GOMAXPROCS` logged at startup?
- [ ] Is `process_gomaxprocs` exported as a Prometheus metric?
- [ ] Is `container_cpu_cfs_throttled_seconds_total` alarmed on?
- [ ] Are there any `runtime.GOMAXPROCS(n)` calls in the source? Are they justified?
- [ ] Is the service deployed on multi-socket hardware? Is it NUMA-pinned?
- [ ] Are sidecars accounted for in CPU limits?
- [ ] Is there a sweep benchmark in CI?
- [ ] When was the last time the sweep was rerun against current traffic?

A "no" on any of these is a small backlog item. None is a catastrophe. The aggregate is what differentiates a well-managed fleet from a brittle one.

---

## Self-Assessment

- [ ] I can write the Prometheus rules that alert on misconfigured `GOMAXPROCS` (or its symptoms).
- [ ] I can diagnose CFS throttling from cAdvisor metrics.
- [ ] I can plan a NUMA split for a multi-socket bare-metal box.
- [ ] I know the trade-offs of workload-aware autosetting and why it is rarely used.
- [ ] I can audit a Kubernetes manifest for per-container CPU sanity.
- [ ] I can compare Go's container-awareness with Java's, Tokio's, and .NET's.
- [ ] I have a startup log line in every service I own.
- [ ] I have a CI sweep benchmark I can show on demand.
- [ ] I know the three most common production incidents involving `GOMAXPROCS` (and would not be the one to cause them).
- [ ] I prefer the Go runtime default + cgroup detection over manual overrides.

---

## Summary

Senior-level `GOMAXPROCS` is operational. The actual mechanics — the runtime sets P count, reads cgroup, defaults to `NumCPU` — have not changed since middle level. What changes is **process**.

You codify a fleet-level contract:

- Every service uses Go ≥ 1.18 or `automaxprocs`.
- Every service exports `process_gomaxprocs`.
- Every manifest declares CPU limits explicitly, per-container.
- Every CPU-heavy release has a sweep benchmark.
- Every team can name the three classic incident patterns and how to spot them.

You stop tuning individual services and start tuning the **platform**. The right `GOMAXPROCS` follows automatically from a correct manifest, a recent runtime, and a vigilant alert.

In [professional.md](professional.md) you go below the surface: the `procresize` function in `runtime/proc.go`, the actual STW path, lock-rank invariants the runtime preserves during a resize, and a side-by-side with Java's `ForkJoinPool` parallelism settings and Tokio's worker-thread accounting. The benchmark-driven recipes live in [optimize.md](optimize.md). The interview questions are in [interview.md](interview.md).
