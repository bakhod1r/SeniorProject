# `GOMAXPROCS` Performance Tuning — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Beyond `automaxprocs` — Internal Autosetting Libraries](#beyond-automaxprocs--internal-autosetting-libraries)
3. [Dynamic `GOMAXPROCS` and the STW Cost](#dynamic-gomaxprocs-and-the-stw-cost)
4. [`GOMAXPROCS` and the GC Pacer](#gomaxprocs-and-the-gc-pacer)
5. [`GOMAXPROCS`, `GOMEMLIMIT`, and Capacity](#gomaxprocs-gomemlimit-and-capacity)
6. [Kernel Hooks — `sched_setaffinity` and `cpuset`](#kernel-hooks--sched_setaffinity-and-cpuset)
7. [Real-Time Workloads — When You Need More](#realtime-workloads--when-you-need-more)
8. [Cross-Runtime Comparison](#cross-runtime-comparison)
9. [Designing the Auto-Tuner You Will Eventually Want](#designing-the-auto-tuner-you-will-eventually-want)
10. [Production Stories](#production-stories)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

Professional-level `GOMAXPROCS` work is the territory of teams running services at scale where 1% latency improvements translate to real money, where the fleet spans 50+ services across multiple hardware generations, and where the standard `automaxprocs` plus sweep methodology is the *floor* not the ceiling. The mechanical underpinnings — `procresize`, the runtime's source — live in `10-scheduler-deep-dive/03-gomaxprocs-tuning/professional.md`. Here we focus on the **operational and performance edges** that show up at scale.

By the end you should be able to: design an internal autosetting library that goes beyond `automaxprocs`; reason about `GOMAXPROCS`'s interaction with the GC pacer and `GOMEMLIMIT`; decide when kernel-level affinity is worth the operational complexity; and benchmark against other runtimes (Java, Tokio) when making language choices for performance-critical paths.

---

## Beyond `automaxprocs` — Internal Autosetting Libraries

`automaxprocs` reads cgroup quota and sets `GOMAXPROCS`. That covers the common case. At scale you want more.

What an internal library adds:

1. **Workload-tier awareness.** Latency-critical services subtract a core for the runtime; batch services keep the full quota.
2. **Custom logging integration.** Pipes through the org's slog/zap configuration.
3. **Metrics emission.** Records `process_gomaxprocs`, `process_cpu_quota`, and the derivation reason as Prometheus gauges.
4. **Override with audit.** Allow `GOMAXPROCS` env var to override but log a warning and emit a metric.
5. **Non-Linux fallback.** `automaxprocs` is a no-op on macOS/Windows; an internal lib can encode local conventions (e.g. "on dev machines, leave 2 cores for the developer").
6. **Boot-order ordering.** Ensure the lib runs *first*, before any `init()` that depends on `GOMAXPROCS`.

A sketch of the API:

```go
package gmpconfig

import "runtime"

type Tier int

const (
    TierLatency Tier = iota
    TierThroughput
    TierBatch
)

type Config struct {
    Tier         Tier
    Logger       func(format string, args ...interface{})
    EmitMetric   func(name string, value float64)
    AllowEnvOverride bool
}

// Apply derives GOMAXPROCS from cgroup quota and tier, then sets it.
// Returns the resolved value.
func Apply(cfg Config) int {
    quota := readCgroupQuota() // ceil(cpu_max / period)
    if quota <= 0 {
        quota = runtime.NumCPU()
    }
    target := quota
    switch cfg.Tier {
    case TierLatency:
        if target > 1 {
            target--
        }
    case TierBatch:
        // keep full quota
    case TierThroughput:
        // keep full quota
    }
    if cfg.AllowEnvOverride {
        if env := envInt("GOMAXPROCS"); env > 0 {
            cfg.Logger("gmpconfig: GOMAXPROCS env override %d (would have been %d)",
                env, target)
            target = env
        }
    }
    prev := runtime.GOMAXPROCS(target)
    cfg.Logger("gmpconfig: GOMAXPROCS=%d quota=%d tier=%v prev=%d",
        target, quota, cfg.Tier, prev)
    if cfg.EmitMetric != nil {
        cfg.EmitMetric("process_gomaxprocs", float64(target))
        cfg.EmitMetric("process_cpu_quota", float64(quota))
    }
    return target
}
```

Such a library is small. The value is *uniformity*: every service in the fleet uses it, every service emits the same metrics, every override is logged.

---

## Dynamic `GOMAXPROCS` and the STW Cost

Calling `runtime.GOMAXPROCS(n)` mid-program triggers `procresize`, which is a stop-the-world. The cost is bounded but real — typically 100 µs to 1 ms depending on the number of `P`s and goroutines.

The mechanical details (the locks taken, the per-P state migrated) live in the scheduler-internals chapter. Here, the performance-relevant facts:

1. **The STW pauses every goroutine.** Any active request takes a hit equal to the STW duration.
2. **The duration scales with `|new - old|`** and with the number of runnable goroutines that need to be moved.
3. **Allocator and GC state is updated.** Per-P caches are flushed and re-created.

When you might consider dynamic adjustment despite the cost:

- **Day/night load patterns.** A service that uses 8 cores during the day and 2 at night could shrink `GOMAXPROCS` overnight to free CPU for batch jobs on the same node. Done at the orchestrator level (resize the pod) is cleaner; in-process dynamic resize is a fallback.
- **Reaction to detected throttling.** A service that detects CFS throttling could *reduce* `GOMAXPROCS` to match the effective quota, reducing contention and improving p99 even though the total CPU budget is unchanged. Empirically this works for some workloads.
- **Bursty workloads with predictable peaks.** Set higher `GOMAXPROCS` for peak windows, lower otherwise. Rarely worth the complexity over horizontal scaling.

Implementation tip: if you must do this, **rate-limit** the calls. A naive feedback loop can oscillate and STW the process many times per second. Limit to one adjustment per minute, and only change by ±1.

```go
type Tuner struct {
    last     time.Time
    cooldown time.Duration
}

func (t *Tuner) Adjust(delta int) {
    if time.Since(t.last) < t.cooldown {
        return
    }
    cur := runtime.GOMAXPROCS(0)
    runtime.GOMAXPROCS(cur + delta)
    t.last = time.Now()
}
```

Even this is a sharp tool. For 95% of services, set once at startup and forget.

---

## `GOMAXPROCS` and the GC Pacer

The Go garbage collector runs concurrently with mutator goroutines, using a *pacer* that decides when to start a GC cycle and how aggressively to assist. `GOMAXPROCS` influences the pacer in two ways:

1. **Mark workers.** During a GC mark phase, the runtime spawns up to `25% × GOMAXPROCS` *dedicated* mark workers, plus some *fractional* mark workers that share `P`s with mutators. More `P`s = more mark workers = faster mark phase. But the dedicated workers reduce mutator throughput.

2. **Assist credits.** Goroutines that allocate quickly run out of GC credit and are forced to help mark before continuing. With more `P`s, total allocation rate can be higher, requiring more assist work distributed across more `P`s.

The performance consequence: a service with high allocation rate may see GC become a bottleneck *because* `GOMAXPROCS = NumCPU` allowed more parallel allocation. Tuning `GOGC` lower (more frequent, shorter GCs) or setting `GOMEMLIMIT` is the right response — not changing `GOMAXPROCS`.

A signal you might be in this regime: in a CPU profile, time in `runtime.gcBgMarkWorker` is > 15% of the total. Read more in [14-performance-tuning/02-gogc](../02-gogc/) (not yet written if you are reading early).

---

## `GOMAXPROCS`, `GOMEMLIMIT`, and Capacity

`GOMEMLIMIT` (Go 1.19+) caps the heap size by triggering GC more aggressively as the heap approaches the limit. Its interaction with `GOMAXPROCS`:

- Heap size scales (roughly) with `GOMAXPROCS × allocation rate per P × time-between-GCs`.
- Higher `GOMAXPROCS` means more parallel allocation, faster heap growth.
- `GOMEMLIMIT` forces GC to keep up; the GC must scan with mark workers proportional to `GOMAXPROCS`.

In a memory-constrained container, this combination matters:

- Container `memory: 1Gi`, `cpu: 4`. `GOMEMLIMIT=900MiB`.
- With `GOMAXPROCS=4`, allocation rate is high, GC fires often.
- If GC cannot keep up, the heap exceeds the limit; the runtime back-pressures by stealing CPU for GC, which manifests as throughput collapse.

Senior practice is to set `GOMEMLIMIT` to ~90% of the container memory limit. Combined with `GOMAXPROCS = cpu.limit`, this gives the runtime a clear picture of its resource budget.

The deeper interactions live in [14-performance-tuning/02-gogc](../02-gogc/). For our purposes: be aware that `GOMAXPROCS` is not independent of memory pressure.

---

## Kernel Hooks — `sched_setaffinity` and `cpuset`

For NUMA pinning or other affinity work, the kernel offers `sched_setaffinity(2)` and the `cpuset` cgroup controller.

`sched_setaffinity` is per-thread (`tid`). Setting it for a Go process means setting it for every `M` the runtime creates. Tools:

- **`taskset --cpu-list 0-7 ./binary`** — sets affinity on the process at exec, inherited by all threads.
- **`numactl --cpunodebind=0 --membind=0 ./binary`** — also constrains memory allocation to the specified NUMA node.
- **Kubernetes `cpuset` via the `static` CPU Manager policy** — pins guaranteed-QoS pods to specific cores.

What this does for Go: it limits which CPUs the runtime's `M`s can run on. If you also set `GOMAXPROCS = len(affinity_set)`, the runtime has just enough parallelism for the cores it can use, and no more.

A subtle interaction: `runtime.NumCPU()` on Linux reads the affinity mask, not the kernel's total CPU count. So `taskset` *transitively* affects the default `GOMAXPROCS`. This is convenient: `taskset --cpu-list 0-7 ./binary` on a 64-core box gives you `NumCPU = 8` and `GOMAXPROCS = 8` automatically.

When to use kernel-level affinity:

1. **NUMA pinning** (discussed at senior level).
2. **Avoiding hyperthread contention.** Pin to physical cores only when SIMD-bound or cache-bound. Use `lscpu --extended` to map logical → physical.
3. **Isolating from system noise.** Pin to a subset of CPUs reserved via `isolcpus=` kernel boot parameter. Used in low-latency systems.

Cost: operational complexity. Affinity makes containers less portable, scheduling decisions more constrained, debugging harder. Use only when you have measured a real win.

---

## Real-Time Workloads — When You Need More

Hard real-time is not Go's strength — the GC and the scheduler introduce occasional pauses incompatible with microsecond SLOs. But *soft* real-time (sub-millisecond p99) is achievable with care.

Tuning levers, in approximate order of impact:

1. **`GOMAXPROCS` = pinned cores.** Set `GOMAXPROCS` to the count of cores reserved via `isolcpus=`. The kernel will not schedule other work on those cores.
2. **`GODEBUG=asyncpreemptoff=1`.** Disable async preemption. Reduces scheduling jitter at the cost of bad behaviour from runaway loops.
3. **`GOGC=off` + manual `runtime.GC()`.** Disable automatic GC; run GC during quiet windows. Risky.
4. **`runtime.LockOSThread()` on the hot goroutine.** Tie it to a single thread. Combined with `taskset`, give it a dedicated core.
5. **No allocation in hot paths.** Pre-allocate buffers, sync.Pool, struct-of-arrays.

For most teams, soft real-time means p99 < 10 ms, achievable with the standard tuning. For p99 < 1 ms, all of the above and some prayer.

`GOMAXPROCS` in this context is a *capacity* knob, not a *parallelism* knob — you size it to give your latency-critical goroutine an uncontended core.

---

## Cross-Runtime Comparison

Knowing how other runtimes handle CPU parallelism makes Go's design easier to argue for or against.

**Java (HotSpot / OpenJDK).** No equivalent of `GOMAXPROCS`. The JVM creates as many threads as user code requests (or as many as the thread pool is sized for); the kernel schedules them. CPU container detection added in Java 10 (via the `-XX:ActiveProcessorCount=` flag, defaulted from cgroup quota). For Java, sizing is at the thread-pool level: `ForkJoinPool` parallelism, `Executors.newFixedThreadPool(n)` size.

**Node.js.** Single-threaded by design (V8 main thread). Worker threads via `worker_threads` module are explicit. Effective `GOMAXPROCS` analog is the number of worker processes (cluster) or worker threads spawned.

**Rust + Tokio.** `tokio::runtime::Builder::worker_threads(n)` sets the number of workers — direct analog to `GOMAXPROCS`. Default is `num_cpus::get()`. No automatic cgroup detection; community crates fill this gap.

**Python + asyncio.** Single-threaded event loop. Parallelism via multiprocessing or external workers. No `GOMAXPROCS` equivalent.

**C# / .NET.** ThreadPool size is dynamic, defaults to `Environment.ProcessorCount`. Container-aware since .NET Core 3.0.

The lesson: Go's `GOMAXPROCS` is unusually visible (a single integer knob) and unusually well-tuned by default. Other runtimes either hide the parallelism (Java) or expose multiple, finer knobs (Tokio). When choosing Go for a performance-critical service, the default-correctness of `GOMAXPROCS` is a real selling point.

---

## Designing the Auto-Tuner You Will Eventually Want

Mature performance teams sometimes build an in-process auto-tuner. The principles:

1. **Stable equilibrium first.** The default (static `GOMAXPROCS`) must be safe; the tuner only *improves* over it. No regression vs static under any condition.
2. **Slow control loop.** Adjustments at minute or hour scale, not second. The STW cost and oscillation risk demand it.
3. **Bounded actions.** Tuner can adjust ±2 from baseline; never below 1, never above `cgroup_quota × 1.5`.
4. **Observable.** Every adjustment is logged and emitted as a metric. Operators can disable the tuner.
5. **Validated in shadow first.** Run the tuner alongside production logic but with a no-op apply, for weeks. Validate that its decisions would have been good.

A skeleton:

```go
type AutoTuner struct {
    Window   time.Duration  // 5m
    Cooldown time.Duration  // 1h
    Min, Max int

    lastChange time.Time
}

type Sample struct {
    Throttled float64 // ratio over Window
    P99       time.Duration
    RPS       float64
}

func (t *AutoTuner) Decide(s Sample, cur int) int {
    if time.Since(t.lastChange) < t.Cooldown {
        return cur
    }
    // Heuristic: throttled? Reduce. Slack? Increase.
    if s.Throttled > 0.05 && cur > t.Min {
        return cur - 1
    }
    if s.Throttled < 0.001 && s.P99 > slo && cur < t.Max {
        return cur + 1
    }
    return cur
}
```

This is incomplete; a real implementation needs hysteresis, validation, observability. Treat the snippet as a starting point.

For 99% of teams: do not build this. Use `automaxprocs` + monitoring + manual tuning. Build the tuner only when the fleet is large enough that manual tuning is intractable.

---

## Production Stories

A few stories from production, anonymised.

**Story 1: The Friday slowdown.** A latency-critical service ran at p99 = 6 ms Mon–Thu, p99 = 50 ms on Fri afternoons. Cause: a weekly batch job kicked off on the same nodes, fully utilising the host CPU. The online service's `GOMAXPROCS` was `NumCPU` (the host's, because Go 1.15, no `automaxprocs`). Fix: added `automaxprocs`; the online service correctly read its `cpu: 4` limit and used 4 `P`s. The batch job stopped over-subscribing. p99 returned to 6 ms.

**Story 2: NUMA win, NUMA loss.** A multi-socket bare-metal service: 2 sockets, 24 cores each. Default `GOMAXPROCS = 48`. p99 = 12 ms. Pinned to one socket with `taskset` and `GOMAXPROCS=24`: p99 = 7 ms, throughput dropped 35%. Decision: keep two replicas, each pinned to one socket. Net: 30% latency improvement at no throughput cost.

**Story 3: The mysterious GC pauses.** A service with high allocation rate, `GOMAXPROCS=32`, occasional GC pauses of 50 ms. Investigation showed the GC was healthy but mark workers were starving for CPU during peak load. Reducing `GOMAXPROCS` to 28 (leaving 4 cores' worth of capacity for GC) cut pauses to 5 ms with negligible throughput impact.

**Story 4: The autoscaler confusion.** HPA scaled a service on CPU utilisation. The service was CFS-throttled, reporting 30% CPU utilisation even at full throttle. HPA did not scale up. Fix: alert on throttling; raise `cpu` limit; HPA started scaling correctly. `GOMAXPROCS` was set correctly all along — the bug was in capacity planning.

**Story 5: The hard-coded constant.** A service had `runtime.GOMAXPROCS(8)` in `main()`, written years ago when servers had 8 cores. Now running on 32-core nodes, p99 was capped because only 8 `P`s served requests that needed parallel processing. Removing the constant (one line of code) doubled throughput.

The common thread: incidents start with *not knowing* what `GOMAXPROCS` is set to. The cure is observability, not exotic tuning.

---

## Self-Assessment

Answer without looking up:

1. Why might an internal `gmpconfig` library be preferable to bare `automaxprocs`?
2. What is the upper bound on `procresize` STW duration in practice?
3. How does `GOMAXPROCS` influence GC mark workers?
4. Why does `taskset --cpu-list 0-7` transitively affect Go's default `GOMAXPROCS`?
5. Which runtimes have a direct analog to `GOMAXPROCS`? Which do not?
6. In Story 3, why was reducing `GOMAXPROCS` the right fix?
7. What invariants must an auto-tuner respect?

---

## Summary

Professional-level `GOMAXPROCS` tuning is mostly about *operational maturity*:

- Build internal libraries for fleet-wide uniformity.
- Avoid dynamic resizing unless rate-limited and validated.
- Account for GC pacer and `GOMEMLIMIT` interactions.
- Use kernel affinity only with measured wins.
- Compare against other runtimes when making language decisions.
- Trust observability — most incidents are diagnosed by reading the resolved value.

Internals references in `10-scheduler-deep-dive/03-gomaxprocs-tuning/professional.md`. Move to [specification.md](specification.md) for the contracts and guarantees that all of this rests on.
