# `GOMAXPROCS` — Find the Bug

> Each puzzle below shows a snippet with a performance bug related to `GOMAXPROCS` tuning. Diagnose, then check your answer. Difficulty rises gradually. These are *performance* bugs, not correctness bugs — the programs all compile and produce correct output; they just perform badly.

---

## Bug 1 — The Hard-Coded Constant

```go
package main

import (
    "log"
    "net/http"
    "runtime"
)

func init() {
    runtime.GOMAXPROCS(4)
}

func handler(w http.ResponseWriter, r *http.Request) {
    _, _ = w.Write([]byte("ok"))
}

func main() {
    log.Printf("GOMAXPROCS=%d", runtime.GOMAXPROCS(0))
    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Symptom.** Service runs on 32-core nodes; CPU utilisation never exceeds 4 cores; throughput is capped.

<details>
<summary>Answer</summary>

The `init()` hard-codes `GOMAXPROCS=4`. It was reasonable when the service ran on 4-core boxes years ago. Now on 32-core hardware, 28 cores sit idle.

**Fix.** Remove the `init()`. Trust the runtime default (or `automaxprocs`).

**Why this bug recurs.** A line of code with no comment survives every code review. The cure is the lint rule from senior.md: any non-zero `runtime.GOMAXPROCS()` call requires a benchmark-linked comment.
</details>

---

## Bug 2 — The "Headroom" Mistake

```go
package main

import (
    "log"
    "runtime"
)

func main() {
    n := runtime.NumCPU() * 4
    runtime.GOMAXPROCS(n)
    log.Printf("GOMAXPROCS=%d for headroom", n)
    // ... service
}
```

**Symptom.** p99 latency is 20% worse than on a similar service that does not call `GOMAXPROCS`.

<details>
<summary>Answer</summary>

There is no "headroom" to be had from extra `P`s — they do not buffer load, they only add overhead. With `GOMAXPROCS = 4 × NumCPU`, you pay for cross-P stealing, spinning, and per-P caches on `P`s that have no core to run on.

**Fix.** Remove the call. The runtime default is correct.

**Why this bug recurs.** "More is better" is a common (wrong) instinct. The cure is education and the lint rule.
</details>

---

## Bug 3 — The I/O Multiplier

```go
package main

import (
    "log"
    "runtime"
)

func main() {
    // "Our service is I/O bound, so we need more parallelism for blocking calls."
    runtime.GOMAXPROCS(runtime.NumCPU() * 2)
    log.Printf("GOMAXPROCS=%d (I/O service)", runtime.GOMAXPROCS(0))
    // ... HTTP server with downstream calls
}
```

**Symptom.** No measurable improvement over `GOMAXPROCS=NumCPU`; in fact slight p99 regression.

<details>
<summary>Answer</summary>

The netpoller frees the `P` while a goroutine waits on a socket. Parked goroutines do not consume `P`s. So extra `P`s do not help I/O concurrency — the service can handle a million parked connections on `GOMAXPROCS=NumCPU`.

**Fix.** Remove the `GOMAXPROCS` call. Trust the default.

**Why this bug recurs.** Engineers coming from thread-per-request models (Java NIO, Python threadpool) carry the wrong sizing intuition. The cure is teaching the netpoller.
</details>

---

## Bug 4 — The Container Trap

```go
// Go 1.15 service running in a pod with cpu: 2 on a 64-core host.

package main

import (
    "log"
    "runtime"
)

func main() {
    log.Printf("GOMAXPROCS=%d NumCPU=%d", runtime.GOMAXPROCS(0), runtime.NumCPU())
    // ... CPU-bound HTTP service
}
```

**Symptom.** Startup log shows `GOMAXPROCS=64 NumCPU=64`. cAdvisor shows constant CFS throttling. p99 is 50× the expected baseline.

<details>
<summary>Answer</summary>

Go 1.15 predates the cgroup awareness added in 1.16/1.18. `NumCPU()` returns the host's CPU count, not the pod's quota. Default `GOMAXPROCS = 64` overcommits the 2-core quota; CFS pauses the process repeatedly.

**Fix.** Two options. Best: upgrade Go to 1.18+. Acceptable: import `_ "go.uber.org/automaxprocs"` and confirm the log shows `GOMAXPROCS=2`.

**Why this bug recurs.** Pinning to old Go versions for dependency-compatibility reasons. The cure is `automaxprocs` as a fleet standard.
</details>

---

## Bug 5 — The Forgotten Debug Override

```go
package main

import (
    "log"
    "net/http"
    "runtime"
)

func main() {
    runtime.GOMAXPROCS(1) // TODO: remove this, just for race debugging
    log.Printf("GOMAXPROCS=%d", runtime.GOMAXPROCS(0))
    http.HandleFunc("/", handleAll)
    log.Fatal(http.ListenAndServe(":8080", nil))
}

func handleAll(w http.ResponseWriter, r *http.Request) { /* ... */ }
```

**Symptom.** Service deployed to production; throughput is 1/16th of expected.

<details>
<summary>Answer</summary>

The `GOMAXPROCS(1)` was added to make a race condition deterministic during debugging. The TODO was forgotten. In production, the service uses one core out of sixteen.

**Fix.** Remove the line.

**Why this bug recurs.** Debugging code makes it to production when there is no PR review, no startup-value alert, or no metric on `process_gomaxprocs`. The cure is the senior policy: log + metric + alert.
</details>

---

## Bug 6 — The Sweep on the Same Machine

A junior engineer runs:

```bash
for n in 1 2 4 8 16; do
    GOMAXPROCS=$n ./service &
    pid=$!
    sleep 1
    wrk -t8 -c64 -d10s http://localhost:8080/
    kill $pid
done
```

**Symptom.** Throughput rises until `GOMAXPROCS=4`, then *drops* dramatically. Engineer concludes the optimum is 4.

<details>
<summary>Answer</summary>

Both `wrk` and `./service` are running on the same machine. They compete for cores. At `GOMAXPROCS=4`, the service uses 4 cores and `wrk` uses the other 4 (on an 8-core box). At `GOMAXPROCS=8`, the service tries to use all 8 cores, starving `wrk`, which generates less load. The "regression" is actually load-generator starvation.

**Fix.** Run the load generator on a separate machine.

**Why this bug recurs.** Laptops are convenient. The cure is "thou shalt not benchmark on your laptop" enforced at PR review, and a dedicated benchmark runner.
</details>

---

## Bug 7 — The Single-Run Conclusion

Engineer reports: "I ran the sweep. `GOMAXPROCS=8` gives 102 k RPS, `GOMAXPROCS=12` gives 100 k RPS. So 8 is better. Closing ticket."

<details>
<summary>Answer</summary>

A single run with 2% difference and unknown variance is not a conclusion. Per-run noise on shared hardware is typically 5–10%; 2% is well within noise.

**Fix.** Run 3+ repeats per setting. Report median ± spread. Report "within noise" when applicable.

**Why this bug recurs.** Time pressure, lack of statistical rigor. The cure is "report variance" as a review standard.
</details>

---

## Bug 8 — The Sidecar Surprise

A pod has two containers: `main` (the Go service) and `proxy` (Envoy sidecar). Both at `cpu: 4`. Service runs at `GOMAXPROCS=4`. Envoy uses 1 core on average.

**Symptom.** Node-level CPU is at 90%; many similar pods on the node throttle; debugging shows total cgroup usage of `main + proxy` per pod is `~5 cores` against `~4 cores` of quota.

<details>
<summary>Answer</summary>

The pod's *limit* is the sum of containers' limits when no pod-level limit is set. Here that is 8 cores. But the node's CPU capacity is finite; many such pods over-subscribe the node. The runtime is correctly using 4 cores per container; the policy mistake is at the manifest / scheduler level.

**Fix.** Reduce per-container limits to match reality. Set `main: cpu=3, proxy: cpu=1` if the proxy genuinely uses 1. Use Kubernetes Resource Quotas at the namespace level.

**Why this bug recurs.** Engineers set generous limits "just in case". Aggregated across many pods, this over-subscribes nodes. The cure is capacity planning that accounts for the sum of limits across pods on a node.
</details>

---

## Bug 9 — The NUMA Catastrophe

A latency-critical Go service runs on a dual-socket 32-core-per-socket bare-metal server. `GOMAXPROCS=64`. p99 is 18 ms; target 8 ms. Engineer raises `GOMAXPROCS=128` thinking "more parallelism".

**Symptom.** p99 spikes to 35 ms; throughput unchanged.

<details>
<summary>Answer</summary>

The latency problem is *not* parallelism — it is cross-socket memory access. Goroutines migrate freely across `P`s; a goroutine running on socket 1 with its data in socket 0's memory pays a 30–80% latency penalty per access. More `P`s amplifies migration and thus cache-miss + remote-memory cost.

**Fix.** Pin the process to one socket: `taskset --cpu-list 0-31 ./service`. Set `GOMAXPROCS=32`. Memory accesses stay local; p99 drops. To compensate for halved throughput per replica, run two replicas, one per socket.

**Why this bug recurs.** NUMA is invisible from inside the runtime; the symptoms look like a scheduling problem. The cure is to know your hardware topology.
</details>

---

## Bug 10 — The Dynamic-Tuning Oscillation

A team builds an in-process auto-tuner: when p99 exceeds the SLO, call `runtime.GOMAXPROCS(current - 1)`; when p99 is well below, call `runtime.GOMAXPROCS(current + 1)`. Adjustment runs every 5 seconds.

**Symptom.** Service flips between `GOMAXPROCS=7` and `GOMAXPROCS=9` every 5–10 seconds. p99 has new sawtooth pattern. Throughput is below baseline.

<details>
<summary>Answer</summary>

Each `runtime.GOMAXPROCS()` triggers a `procresize` STW. At 5-second cadence, the service is paused frequently. Worse, the heuristic has no hysteresis — small p99 fluctuations cause large `GOMAXPROCS` swings.

**Fix.** Rate-limit adjustments to once per hour at most. Add hysteresis (only adjust when the signal is sustained for N intervals). Bound adjustments to ±1 around a baseline. Better: do not adjust dynamically in-process; let the orchestrator resize the pod.

**Why this bug recurs.** Naive control loops without rate-limiting or hysteresis. The cure is documented design patterns for control loops (see professional.md).
</details>

---

## Bug 11 — The Friday Spike

A latency-critical service runs at p99 = 6 ms Mon–Thu. Every Friday afternoon at 14:00, p99 jumps to 80 ms for ~20 minutes.

<details>
<summary>Answer</summary>

A weekly batch job (cron, CronJob, or similar) starts on the same nodes at 14:00 Friday. The batch job has no CPU limit (or a very high one) and fully utilises the node. The latency-critical service's `GOMAXPROCS` is correct for its pod quota, but CFS throttles it because the node is over-subscribed.

**Fix.** Several options: move the batch job to dedicated nodes; use Guaranteed QoS for the online service so its CPU is reserved; reduce the batch job's CPU limit.

**Why this bug recurs.** Co-location decisions are made by different teams with different SLOs. The cure is anti-affinity rules and node-pool segregation.
</details>

---

## Bug 12 — The Mismatched `GOMAXPROCS` and `GOMEMLIMIT`

A service has `GOMAXPROCS=16` (cgroup quota correctly detected) and no `GOMEMLIMIT`. Container memory limit is 2Gi. Heap grows to 1.9 GiB, the kernel OOM-kills the process.

<details>
<summary>Answer</summary>

`GOMAXPROCS=16` allows fast parallel allocation. Without `GOMEMLIMIT`, the runtime does not know about the 2 Gi limit; it lets the heap grow until cgroup OOM kills it.

**Fix.** Set `GOMEMLIMIT` to ~1.8 GiB (90% of the memory limit). The runtime will trigger more aggressive GC as heap approaches the limit, preventing OOM.

**Why this bug recurs.** `GOMAXPROCS` is widely known; `GOMEMLIMIT` is newer and less well-known. The cure is documenting both as a unit in your service templates.
</details>

---

## Bug 13 — The Misleading CPU Graph

Operator sees a service running at 30% CPU utilisation. "We have plenty of headroom — let's add more traffic." Adding traffic causes p99 to skyrocket.

<details>
<summary>Answer</summary>

The 30% CPU utilisation is the *cgroup-throttled* number. The service is actually CPU-saturated for its quota; it spends the rest of the time *paused* by CFS. Adding traffic increases the runnable goroutine count, increasing queueing during the paused windows.

**Fix.** Check throttling metrics (`container_cpu_cfs_throttled_seconds_total`). If non-trivial, raise the CPU limit (and `GOMAXPROCS` follows automatically on modern Go).

**Why this bug recurs.** CPU utilisation as reported by the orchestrator is *limited* CPU, not "fraction of available". The cure is dashboards that show throttling alongside utilisation.
</details>

---

## Bug 14 — The "Less Is More" That Was Right

A team had `GOMAXPROCS=NumCPU=32`. They tried `GOMAXPROCS=24` and p99 *dropped* from 12 ms to 7 ms; throughput dropped 10%. They reverted because "throughput matters more". Now p99 is back to 12 ms and they cannot understand why the latency win does not transfer to production.

<details>
<summary>Answer</summary>

The "less is more" was right, but the team's revert was wrong. With `GOMAXPROCS=24`, GC mark workers and runtime overhead get 8 cores' worth of breathing room, and contention on shared state drops. The throughput loss was real, but compensated by adding replicas.

**Fix.** Stay at `GOMAXPROCS=24`, scale replicas from N to ceil(N × 32/24) to maintain throughput, accept the better p99.

**Why this bug recurs.** Throughput is locally easier to optimise than latency, especially when the SLO is invisible to the engineer making the call. The cure is service-level SLOs and explicit p99 targets.
</details>

---

## Bug 15 — The Per-Tenant `GOMAXPROCS` Request

Product asks: "Tenant A is paying 10× more than tenant B. Can we give A more CPU?" Engineering writes a wrapper that calls `runtime.GOMAXPROCS(16)` before tenant A's requests and `runtime.GOMAXPROCS(8)` before tenant B's.

**Symptom.** Both tenants see catastrophic p99 spikes. Audit logs show `procresize` happening hundreds of times per second.

<details>
<summary>Answer</summary>

`GOMAXPROCS` is process-wide. There is no per-tenant or per-request scope. The wrapper triggers STW on every request, pausing everyone. Worse, the value alternates based on whichever request was most recent, so tenant A may experience tenant B's "small" value or vice versa.

**Fix.** Per-tenant isolation requires per-tenant *processes*. Run tenant A in pods with `cpu: 16`, tenant B in pods with `cpu: 8`. The runtime sets the right `GOMAXPROCS` in each. Route requests to the right pod set.

**Why this bug recurs.** Engineers misread `GOMAXPROCS` as a "per-thing" knob. The cure is education and clear API documentation.
</details>

---

## Bug 16 — The Failing CI Sweep

The team set up a nightly `GOMAXPROCS` sweep in CI. For two weeks it produced consistent numbers. Today it shows wildly different results — `GOMAXPROCS=8` is 30% better than yesterday's `GOMAXPROCS=8`.

<details>
<summary>Answer</summary>

The CI runner is shared. Another job started running on the same runner today; the sweep is contending with that job for cores. The "improvement" is noise from the other job finishing at different times during sweep runs.

**Fix.** Dedicated benchmark runner. Tag it appropriately. Disable other workloads during sweep windows.

**Why this bug recurs.** CI runners are infrastructure that "everyone shares". The cure is dedicated perf hardware, often a single machine reserved for benchmarks.
</details>

---

## Self-Assessment

You should be able to diagnose Bugs 1–8 in under five minutes each at junior–middle level, Bugs 9–14 at senior level, and Bugs 15–16 at professional level. If you found yourself surprised, re-read the relevant level's file.

Cross-reference: the planned `10-scheduler-deep-dive/03-gomaxprocs-tuning/find-bug.md` chapter (coming soon) for mechanics-side bugs that complement these performance-focused ones.
