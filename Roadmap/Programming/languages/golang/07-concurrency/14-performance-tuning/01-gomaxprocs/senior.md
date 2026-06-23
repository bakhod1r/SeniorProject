# `GOMAXPROCS` Performance Tuning — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Policy at the Fleet Level](#production-policy-at-the-fleet-level)
3. [`automaxprocs` as a Deployment Standard](#automaxprocs-as-a-deployment-standard)
4. [Container CFS Quotas — The Operator's View](#container-cfs-quotas--the-operators-view)
5. [Alerting on `GOMAXPROCS` Misconfiguration](#alerting-on-gomaxprocs-misconfiguration)
6. [Benchmark-Driven Tuning in CI](#benchmark-driven-tuning-in-ci)
7. [NUMA at Production Scale](#numa-at-production-scale)
8. [Workload-Aware Autosetting](#workload-aware-autosetting)
9. [Throughput vs Tail Latency — Choosing the Optimum](#throughput-vs-tail-latency--choosing-the-optimum)
10. [Co-Tenant Sizing — Sidecars, Batch, Mixed Pods](#co-tenant-sizing--sidecars-batch-mixed-pods)
11. [Incident Patterns From the Field](#incident-patterns-from-the-field)
12. [Capacity Planning With `GOMAXPROCS` in Mind](#capacity-planning-with-gomaxprocs-in-mind)
13. [Senior-Level Checklist](#senior-level-checklist)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

At senior level you own the policy that governs `GOMAXPROCS` across many services. The mechanical material on `procresize`, cgroup files, and the runtime's detection logic lives in `10-scheduler-deep-dive/03-gomaxprocs-tuning/senior.md`. Here we focus on **performance policy**: how to make sure the right value is set everywhere, how to detect when it is not, and how to allocate engineering time to tuning vs to capacity changes.

The senior brief, in one paragraph: every service in the fleet emits `process_gomaxprocs` as a metric; every service logs the resolved value at startup; every manifest declares CPU limits; the runtime version is uniform enough that the default detection works, and `automaxprocs` is in place where it is not; CFS throttling is monitored and alerted; benchmark sweeps are run as part of release engineering when hardware or runtime versions change.

If any of these is missing in your fleet, the senior-level work is to put it in place. Tuning individual services is the smaller part of the job.

---

## Production Policy at the Fleet Level

Five rules cover 95% of cases. They are described in more detail in the scheduler-internals senior file; here we focus on the tuning consequences.

**Rule 1: Every service emits `process_gomaxprocs`.** A Prometheus gauge set at startup. The dashboard for the service shows it alongside CPU utilisation. Any operator can answer "what is `GOMAXPROCS`?" in 5 seconds.

```go
import (
    "runtime"
    "github.com/prometheus/client_golang/prometheus"
)

var gomaxprocsGauge = prometheus.NewGauge(prometheus.GaugeOpts{
    Name: "process_gomaxprocs",
    Help: "Current GOMAXPROCS value at startup.",
})

func init() {
    prometheus.MustRegister(gomaxprocsGauge)
    gomaxprocsGauge.Set(float64(runtime.GOMAXPROCS(0)))
}
```

**Rule 2: Pod manifests have `cpu` limits.** Without a limit, the cgroup file says `max` and the runtime falls back to `NumCPU()` of the node — which may be 64 on a node hosting a pod that gets 0.5 cores at peak. Reject manifests without limits via OPA, Kyverno, or whatever policy engine you use.

**Rule 3: Service base image is a known Go version, ideally 1.22+.** Old Go is the largest single source of `GOMAXPROCS` misconfiguration. Mandate via CI lint or admission control.

**Rule 4: `runtime.GOMAXPROCS(n)` calls in source require justification.** Anything other than zero (the read) requires a comment linking to a benchmark issue. Lint for it:

```bash
grep -rn 'runtime\.GOMAXPROCS([^0]' . \
    | grep -v 'GOMAXPROCS(0)'
```

**Rule 5: Critical services run a `GOMAXPROCS` sweep before major hardware changes.** Annual at minimum. Whenever the underlying node type changes (e.g. m5 → m6 in AWS, Skylake → Ice Lake), re-sweep. Make this part of the release engineering ritual.

The senior win is having these rules *automated*, not posted on a wiki.

---

## `automaxprocs` as a Deployment Standard

`go.uber.org/automaxprocs` is the de-facto standard for production Go services. Even on Go ≥ 1.18 where the runtime handles cgroup detection, many teams include it because:

1. **It logs.** A clear line at startup: `maxprocs: Updating GOMAXPROCS=2: determined from CPU quota of 2.00`. Invaluable in incident response.
2. **It handles edge cases.** Custom cgroup layouts, nested containers, runtimes where the Go detection misses. Not common, but the library is more battle-tested across deployment quirks.
3. **It is one import.** The cost is trivial.

A typical service main:

```go
package main

import (
    _ "go.uber.org/automaxprocs"
    "log"
    "runtime"
)

func main() {
    log.Printf("startup: GOMAXPROCS=%d NumCPU=%d Version=%s",
        runtime.GOMAXPROCS(0), runtime.NumCPU(), runtime.Version())
    // ... rest of program
}
```

The library reads cgroup files (v1 and v2), computes the ceiling of `quota / period`, calls `runtime.GOMAXPROCS()`, and logs. It respects an explicitly set `GOMAXPROCS` environment variable (does not override). It runs in an `init()` so it executes before `main()` and any other package init that needs the final value.

The internals — the cgroup parsing code, the procresize STW it triggers — live in the scheduler-internals chapter. Here, the senior policy questions:

- **Mandate inclusion?** Most fleets do. The import cost is negligible.
- **Pin the version?** Yes — Renovate or Dependabot, weekly checks.
- **Allow override?** Yes — if `GOMAXPROCS` env var is set, the library respects it. This allows escape hatches for unusual cases.
- **Log line format?** Customise via `maxprocs.Logger()` if your structured-logging convention differs.

If you have an internal logging library that wraps zap, slog, or zerolog, wire `automaxprocs` to use it so the line goes through your standard pipeline.

---

## Container CFS Quotas — The Operator's View

The kernel's CFS bandwidth controller enforces CPU limits via a quota-per-period mechanism, described in `10-scheduler-deep-dive/03-gomaxprocs-tuning/middle.md`. At senior level you should be able to:

1. Read the cgroup quota for any pod from `/sys/fs/cgroup/cpu.max` (v2) or the v1 files.
2. Compute the runtime's expected `GOMAXPROCS` from the quota.
3. Identify when `cpu.requests != cpu.limits` and the operational consequences.
4. Diagnose throttling-induced latency from cAdvisor or `cpu.stat`.

A common but subtle case: `cpu.requests = 100m`, `cpu.limits = 4`. The pod is *requested* 0.1 cores but *limited* to 4. The cgroup quota is the *limit* (400 ms per 100 ms period). Go's runtime sets `GOMAXPROCS = 4`. Sensible — until the scheduler co-locates many such pods on the same node and total requested CPU exceeds capacity. Then everyone throttles.

The takeaway: **`GOMAXPROCS` follows the limit, not the request**. Capacity planning must use limits as the upper bound when summing across pods.

Tuning levers at the orchestrator:

| Lever | Effect on `GOMAXPROCS` | When to use |
|---|---|---|
| Raise `cpu.limits` | Higher `GOMAXPROCS` (modern Go) | Service is throttled; node has spare capacity |
| Use `Guaranteed` QoS (request = limit) | Same `GOMAXPROCS`; better latency under contention | Latency-critical services |
| Use `cpuset` (static CPU pinning) | Pinned to specific cores | NUMA-sensitive services |
| Set `GOMAXPROCS` env var explicitly | Overrides runtime detection | When detection is unreliable |

---

## Alerting on `GOMAXPROCS` Misconfiguration

Three alerts cover most of the failure modes:

**Alert A: `process_gomaxprocs > cpu.limit × 1.5`** for any pod. Indicates the runtime is configured for more parallelism than the cgroup allows. PromQL:

```
process_gomaxprocs > (
  kube_pod_container_resource_limits{resource="cpu"} * 1.5
)
```

**Alert B: CFS throttling above 1% over 5 minutes.** Indicates active throttling, regardless of cause. PromQL:

```
rate(container_cpu_cfs_throttled_periods_total[5m])
  / rate(container_cpu_cfs_periods_total[5m])
  > 0.01
```

**Alert C: `process_gomaxprocs == 1` for a service expected to use parallelism.** Catches the "someone set `GOMAXPROCS=1` for debugging and forgot" case. Service-specific.

Tune the thresholds to your fleet's noise level. Alert C is especially valuable: it is silent, easy to miss, and catastrophic for throughput.

A page-worthy alert needs a runbook. Yours should answer: how do I find the resolved value (`process_gomaxprocs`); how do I find the cgroup quota (`kubectl describe pod`); how do I temporarily override (`GOMAXPROCS` env var); how do I roll back (revert manifest).

---

## Benchmark-Driven Tuning in CI

A senior practice that few teams reach but high-performance ones do: continuous `GOMAXPROCS` benchmarks in CI.

The pattern:

1. A nightly job spins up a representative load shape against the service in a controlled environment (kind, ephemeral cluster, or dedicated test node).
2. Sweeps `GOMAXPROCS` over `{NumCPU/2, NumCPU, 2×NumCPU}` minimum.
3. Records RPS and p99 for each.
4. Posts the results to an internal dashboard and the team's chat.

When the curves shift unexpectedly (e.g. a code change moves the optimum), the team sees it within a day. Without this, the optimum drifts as code changes; the value you tuned six months ago might not be best now.

A minimal CI snippet (GitHub Actions style):

```yaml
name: gomaxprocs-sweep
on:
  schedule:
    - cron: '0 6 * * *'
jobs:
  sweep:
    runs-on: [self-hosted, perf-bench]
    steps:
      - uses: actions/checkout@v4
      - name: Build service
        run: go build -o ./bin/svc ./cmd/svc
      - name: Run sweep
        run: ./tools/sweep.sh > results.csv
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: sweep-${{ github.sha }}
          path: results.csv
      - name: Post summary
        run: ./tools/post-summary.sh results.csv
```

`./tools/sweep.sh` is the harness from middle.md, adapted to run inside CI. `./tools/post-summary.sh` posts a chart to Slack or stores a row in a metrics database.

The cost is one dedicated CI runner (or shared with other perf jobs). The benefit is detecting regressions before customers do.

---

## NUMA at Production Scale

Most fleets do not need NUMA-aware tuning. The exceptions are: large core-count servers (≥ 32 cores per socket), latency-critical services (p99 < 5 ms), and workloads with sizeable working sets (more than per-socket cache).

When you do need it, the levers are:

1. **`taskset --cpu-list` at process start.** Bind the process to one socket's CPUs. Set `GOMAXPROCS = cores per socket`.
2. **`numactl --membind`.** Force memory allocation onto a specific NUMA node. Combine with `taskset` for both CPU and memory locality.
3. **Kubernetes Topology Manager.** Schedules pods with CPU pinning and memory locality. Requires `static` CPU manager policy and `single-numa-node` topology policy.

Example: a 2-socket, 32-core-per-socket box hosting a latency-critical service. The service runs at p99 = 8 ms with `GOMAXPROCS = 64`. After pinning to one socket and setting `GOMAXPROCS = 32`:

| Config | RPS | p99 |
|---|---|---|
| `GOMAXPROCS=64`, no pin | 142 000 | 8.2 ms |
| `GOMAXPROCS=32`, pinned to node 0 | 91 000 | 5.1 ms |

Half the throughput, 40% better p99. For a fixed-capacity latency-critical service, this is a clear win — but only if you can deploy more instances to maintain total throughput.

The decision is: are you throughput-limited (use both sockets) or latency-limited (pin to one)? The answer depends on the service's SLO. Senior policy is to keep both options available and run the sweep periodically to validate the choice.

---

## Workload-Aware Autosetting

A few teams build their own `GOMAXPROCS` autosetting on top of `automaxprocs`. The motivation: the cgroup quota is a *cap*, but the *optimum* may be lower for latency-sensitive services or higher for some I/O-blocking edge cases.

Patterns:

**Pattern 1: Static derivation from service tier.** Latency-critical services use `GOMAXPROCS = cgroup_quota - 1` (leave one core for sidecars / kernel work). Throughput services use the full `cgroup_quota`. Set via a small wrapper that runs before `automaxprocs`.

**Pattern 2: Adjust at startup based on workload class.** A config flag `--workload-class=latency|throughput|batch` selects the formula. Implement as an `init()` that runs *before* `automaxprocs`'s init, then re-checks after.

**Pattern 3: Dynamic re-tuning.** The most ambitious: a goroutine monitors p99 and CPU utilisation, calling `runtime.GOMAXPROCS()` to adjust. **Generally a bad idea** — `procresize` is a stop-the-world, and a dynamic loop can oscillate. If you must, gate it heavily: only adjust during predictable low-traffic windows, log every change, alert on every change.

For most teams, static derivation from service tier is the right level. Pattern 3 is reserved for very specialised systems.

---

## Throughput vs Tail Latency — Choosing the Optimum

The most important senior trade-off, deeper than the junior file covered.

Throughput-optimal and latency-optimal `GOMAXPROCS` rarely match. The difference depends on:

- **Concurrency level.** Under heavy concurrency, more `P`s improves throughput but adds queuing-system contention that hurts tail. Under light concurrency, more `P`s only adds scheduling overhead.
- **Lock contention.** If the service has any global contention (a shared mutex, a global map, the GC), more `P`s amplifies the contention. Tail latency suffers.
- **GC pressure.** Allocation-heavy services see GC-induced tail spikes that scale with `P`s.

Rules of thumb:

- For throughput-optimal: usually `NumCPU`. Sometimes `NumCPU + 1` on services with some blocking syscalls.
- For latency-optimal: often `NumCPU - 1` or `NumCPU/2 + 1`. Leave headroom for the runtime and GC to schedule without contending.
- For mixed SLOs: pick the value that maximises throughput *subject to* p99 < threshold. Compute from the sweep.

A simple decision rule in pseudocode:

```
sweep results: array of (gmp, rps, p99)
constraint: p99 <= SLO
candidates = [r for r in results if r.p99 <= SLO]
chosen = argmax(rps for r in candidates)
```

This is the formal way to pick. In practice you eyeball the plot.

---

## Co-Tenant Sizing — Sidecars, Batch, Mixed Pods

Per-tenant `GOMAXPROCS` is not a thing — the value is process-wide. So co-tenancy is managed at the orchestrator level via cgroups, not from inside the runtime.

Common scenarios:

**Sidecar in a Kubernetes pod (Envoy + main app).** Each container in the pod has its own cgroup with its own quota. Each runtime picks its own `GOMAXPROCS` from its own quota. Set Envoy `cpu` to 1, main app `cpu` to whatever it needs.

**Batch + online in one pod.** Bad pattern. Even with per-container quotas, the batch job will steal CPU during low-traffic windows in a way the online service does not expect. Better: separate pods, separate nodes, with Kubernetes Topology Spread or anti-affinity to keep them apart.

**Co-located services on the same node.** Use Kubernetes `Guaranteed` QoS for latency-critical services so they get fixed CPUs and are not preempted.

The pattern to avoid at all costs: many `Burstable` QoS services on one node, each with `GOMAXPROCS = NumCPU` (the node's, not their quota), each spinning up many `P`s. The node's CPU is over-subscribed by ~10× and everyone CFS-throttles.

Senior-level guidance: **enforce CPU limits everywhere** (rule 2 in the policy), and the runtime takes care of itself.

---

## Incident Patterns From the Field

Five patterns that recur enough to deserve a dedicated runbook.

**Pattern 1: "Latency spike on Friday afternoons."** Cause: a co-located batch job kicks off, the noisy neighbour over-subscribes the node, CFS throttles everyone. Fix: move batch off the node, or use `Guaranteed` QoS for the online service.

**Pattern 2: "Performance regressed after the cluster upgrade."** Cause: node type changed (e.g. AWS m5 → m6) and the new node has different core count or NUMA topology. Old `GOMAXPROCS` values (if hard-coded) are now wrong. Fix: remove hard-coded values; re-sweep.

**Pattern 3: "Service consumes 64 cores instead of its 4-core budget."** Cause: missed cgroup detection because of an old Go version or a custom container runtime. Fix: add `automaxprocs`; upgrade Go.

**Pattern 4: "p99 fine in staging, spikes in prod."** Cause: staging is single-tenant, prod is co-tenant. Throttling appears under prod's combined load. Fix: replicate prod co-tenancy in staging; add throttling alert.

**Pattern 5: "Throughput dropped after a code change."** Cause: new code added lock contention; more `P`s amplifies it. Fix: profile the lock, reduce contention; do not change `GOMAXPROCS`.

The first four are `GOMAXPROCS` problems. The fifth is *not*, but is commonly misdiagnosed as one. Always check the profile before blaming the runtime.

---

## Capacity Planning With `GOMAXPROCS` in Mind

When sizing capacity for a service, `GOMAXPROCS` ties the runtime to the orchestrator's CPU allocation. A few capacity-planning notes:

1. **Right-sizing pods.** If the service peaks at 70% of its `cpu` limit, the limit is correct; if at 100% (throttling), raise the limit. `GOMAXPROCS` adjusts automatically with modern Go.

2. **Horizontal vs vertical scaling.** Going from `cpu: 2` × 8 replicas to `cpu: 4` × 4 replicas changes `GOMAXPROCS` from 2 to 4 per replica. Latency may improve (less per-replica queueing); throughput per replica doubles but total throughput stays the same. Sweep before committing.

3. **Bin-packing on nodes.** A 64-core node holding 16 pods at `cpu: 4` works only if the runtime detects the quota correctly. If one pod misconfigures and grabs 64 `P`s, everyone throttles. Hence: enforce CPU limits *and* monitor `process_gomaxprocs`.

4. **HPA (Horizontal Pod Autoscaler).** Scales replica count based on CPU utilisation. `GOMAXPROCS` does not affect the scaling target but does affect whether the per-pod CPU utilisation is accurate (under-throttled pods report low utilisation despite being saturated, which can confuse the HPA).

5. **Reserve overhead.** Leave 10–20% of node CPU unallocated for kernel, kubelet, monitoring, log shipping. Without overhead, the node itself starts to throttle.

---

## Senior-Level Checklist

You are senior-level on `GOMAXPROCS` performance when:

1. You can articulate the fleet-wide policy and the alerts that enforce it.
2. You can read `cpu.stat` and decide whether a service is mis-sized.
3. You can choose between `automaxprocs`, runtime defaults, and explicit env vars based on Go version and platform.
4. You can run a sweep in CI and act on results.
5. You can identify NUMA effects in a sweep curve and decide whether to pin.
6. You can size pods given an SLO, hardware, and co-tenancy constraints.
7. You can debug a tail-latency incident and distinguish `GOMAXPROCS` from contention from downstream.
8. You can balance throughput vs latency by reading both curves.

---

## Self-Assessment

Answer without looking up:

1. Five fleet rules — name them.
2. What does an alert on `process_gomaxprocs > cpu.limit × 1.5` catch?
3. Why does `automaxprocs` still matter on Go 1.18+?
4. When does NUMA pinning win, and what does it cost?
5. Pattern 1 (Friday latency spike) — what is the cause and the fix?
6. Why is `runtime.GOMAXPROCS()` called dynamically a generally bad idea?
7. What is the formal rule for picking `GOMAXPROCS` given throughput, p99, and SLO?
8. Why is "per-tenant `GOMAXPROCS`" not feasible, and what is the alternative?

If most are crisp, move to [professional.md](professional.md) for kernel-level interactions, runtime hooks, and cross-runtime comparisons.

---

## Summary

Senior-level `GOMAXPROCS` performance work is mostly about **policy and process**, not knob-twiddling.

- A handful of fleet rules prevent the bulk of misconfiguration: log, metric, limits, version.
- `automaxprocs` remains a deployment standard even on modern Go.
- CFS throttling is the dominant container failure mode; alerting on it catches incidents early.
- NUMA is occasionally a latency win, requires deliberate sizing.
- Throughput-optimal and latency-optimal `GOMAXPROCS` differ; pick by SLO.
- Co-tenancy is managed at the orchestrator, not the runtime.

Move on to professional level for the deeper interactions with the runtime and kernel, and the patterns reserved for the most performance-critical services.
