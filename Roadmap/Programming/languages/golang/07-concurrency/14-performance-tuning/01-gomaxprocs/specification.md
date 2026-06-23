# `GOMAXPROCS` — Specification (Performance-Tuning View)

## Table of Contents
1. [Scope](#scope)
2. [Documented Behaviour Relevant to Tuning](#documented-behaviour-relevant-to-tuning)
3. [Measurement Contracts](#measurement-contracts)
4. [Container Detection Guarantees](#container-detection-guarantees)
5. [Interaction Specifications](#interaction-specifications)
6. [What Is *Not* Specified](#what-is-not-specified)
7. [Conformance Tests for Tuning Policy](#conformance-tests-for-tuning-policy)
8. [References](#references)

---

## Scope

This file documents the **tuning-relevant** specifications: what the Go runtime guarantees about `GOMAXPROCS` behaviour that tuning policies can rely on, what measurement primitives are stable across Go versions, and what is explicitly undefined.

The mechanical specification (the prose contract of `runtime.GOMAXPROCS`, env-var precedence, cgroup detection algorithm) lives in `10-scheduler-deep-dive/03-gomaxprocs-tuning/specification.md`. This file complements it from the performance angle.

---

## Documented Behaviour Relevant to Tuning

### S1. Default value

Since Go 1.5, the default `GOMAXPROCS` is `runtime.NumCPU()`.

**Tuning consequence.** Code may assume the default is sane on bare metal. Code must *not* assume the default is correct in containers on Go < 1.16 (cgroup v1) or < 1.18 (cgroup v2).

### S2. `runtime.GOMAXPROCS(n)` semantics

`runtime.GOMAXPROCS(n)` sets the new value if `n > 0` and returns the previous value. Passing `n = 0` reads without setting.

**Tuning consequence.** The idiomatic read is `runtime.GOMAXPROCS(0)`. Logging this at startup is the cheapest observability investment a service can make.

### S3. Environment variable precedence

The `GOMAXPROCS` environment variable is read at runtime startup. If set to a positive integer, it overrides the default. Subsequent `runtime.GOMAXPROCS(n)` calls in code override the env-var value.

**Tuning consequence.** Operators can set `GOMAXPROCS` via env var without source changes; code that calls `runtime.GOMAXPROCS()` will silently override the operator's choice. Avoid the call in production code unless deliberately overriding.

### S4. `runtime.NumCPU()` is container-aware on Linux

Since Go 1.16 (cgroup v1) and 1.18 (cgroup v2), `runtime.NumCPU()` on Linux returns the ceiling of `cgroup_cpu_quota / cgroup_cpu_period` when a quota is set; otherwise the host's logical CPU count.

**Tuning consequence.** On modern Go in containers, the default `GOMAXPROCS` equals the effective CPU limit. Tuning code can rely on this without parsing cgroup files. On older Go, parse cgroup or use `automaxprocs`.

### S5. STW on `procresize`

Mid-program calls to `runtime.GOMAXPROCS(n)` trigger `procresize`, which stops the world. The duration is bounded by O(number of goroutines + |old_n - new_n|).

**Tuning consequence.** Dynamic tuners must rate-limit calls. STW cost is small (sub-millisecond on small fleets) but cumulative.

### S6. Stability of `GOMAXPROCS` value

Once set, `GOMAXPROCS` does not change spontaneously. The runtime does not adjust based on observed load or system pressure.

**Tuning consequence.** A value set at startup remains constant for the process lifetime unless explicitly changed via `runtime.GOMAXPROCS(n)`. Workload-aware autosetting must be implemented explicitly.

---

## Measurement Contracts

The following metrics and entry points are documented and may be relied on for tuning observability across Go versions.

### M1. `runtime.GOMAXPROCS(0)`

Returns the current `GOMAXPROCS` value. Cheap (one atomic load).

### M2. `runtime.NumCPU()`

Returns the logical CPU count visible to the process. Cheap.

### M3. `runtime/metrics` package

Stable since Go 1.16 (graduated from experimental in 1.19). Relevant gauges and histograms for `GOMAXPROCS` tuning:

| Metric | Description |
|---|---|
| `/sched/gomaxprocs:threads` | Current value of `GOMAXPROCS`. |
| `/sched/latencies:seconds` | Histogram: time goroutines spent runnable before scheduling. |
| `/sched/goroutines:goroutines` | Number of live goroutines. |
| `/cpu/classes/gc/total:cpu-seconds` | CPU time spent in GC. |
| `/cpu/classes/scavenge/total:cpu-seconds` | CPU time spent in scavenger. |
| `/cpu/classes/idle:cpu-seconds` | CPU time the runtime considered idle. |

**Tuning consequence.** Wire `runtime/metrics` into your Prometheus exporter. The `sched/latencies` histogram is the cleanest signal of scheduling saturation.

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/sched/gomaxprocs:threads"},
    {Name: "/sched/latencies:seconds"},
}
metrics.Read(samples)
gmp := samples[0].Value.Uint64()
hist := samples[1].Value.Float64Histogram()
```

### M4. `GODEBUG=schedtrace=N`

Periodic scheduler diagnostics to stderr, every `N` milliseconds. Format documented (informally) in the runtime source. Not stable across versions but useful for ad-hoc debugging.

**Tuning consequence.** Use during incident response, not for sustained monitoring.

### M5. `pprof` profiles

CPU profile (`/debug/pprof/profile`), trace (`/debug/pprof/trace`), mutex profile (`/debug/pprof/mutex`). Stable across versions; format documented.

**Tuning consequence.** The mutex profile reveals contention that scales with `GOMAXPROCS`. A trace shows scheduler decisions in detail.

---

## Container Detection Guarantees

### C1. Cgroup v1 detection (Go 1.16+)

On Linux with cgroup v1, the runtime reads `cpu.cfs_quota_us` and `cpu.cfs_period_us`. If quota > 0 and quota/period < `online_cpus`, `NumCPU()` returns `ceil(quota/period)`.

### C2. Cgroup v2 detection (Go 1.18+)

On Linux with cgroup v2, the runtime reads `cpu.max`. If the quota is not `max`, `NumCPU()` returns `ceil(quota/period)`.

### C3. Non-Linux platforms

On macOS, Windows, FreeBSD: no cgroup awareness. `NumCPU()` returns the OS-reported logical CPU count.

**Tuning consequence.** Production deployments outside Linux containers cannot rely on automatic sizing. Use explicit env var or platform-specific logic.

### C4. cgroup file format stability

Cgroup v1 and v2 file formats are kernel ABIs; stable in practice. The runtime parses them defensively.

### C5. CPU affinity awareness

On Linux, `NumCPU()` honours the process's CPU affinity mask (`sched_getaffinity`). `taskset --cpu-list 0-7 ./binary` causes `NumCPU()` to return 8 even on a 64-core host.

**Tuning consequence.** Pre-launch `taskset` is a clean way to constrain `GOMAXPROCS` without code changes.

---

## Interaction Specifications

### I1. Interaction with `GOGC`

`GOGC` controls GC trigger ratio independently of `GOMAXPROCS`. However, the runtime sizes GC mark workers as a function of `GOMAXPROCS`: up to `0.25 × GOMAXPROCS` dedicated workers during a mark phase.

**Specification status.** Documented in the GC pacer design docs; the exact 25% fraction is not API but is stable across recent versions.

### I2. Interaction with `GOMEMLIMIT`

`GOMEMLIMIT` (Go 1.19+) is independent of `GOMAXPROCS`. The runtime triggers GC more aggressively as the heap approaches the limit, regardless of `GOMAXPROCS`.

**Tuning consequence.** Set both: `GOMAXPROCS` from CPU quota, `GOMEMLIMIT` from memory quota. They do not conflict.

### I3. Interaction with `runtime.LockOSThread`

A goroutine that calls `LockOSThread` is bound to an `M` until `UnlockOSThread`. While locked, the `M` cannot be re-used; the runtime may create new `M`s to keep `GOMAXPROCS` `P`s active.

**Tuning consequence.** Excessive `LockOSThread` use can spawn many `M`s. `GOMAXPROCS` does not bound `M` count.

### I4. Interaction with `runtime/debug.SetMaxThreads`

`SetMaxThreads(n)` caps the number of `M`s the runtime will create. The default is 10000. Independent of `GOMAXPROCS`.

**Tuning consequence.** If your service uses heavy cgo or `LockOSThread`, monitor `M` count and consider `SetMaxThreads` as a safety cap.

### I5. Interaction with `GOEXPERIMENT`

Experimental flags may change scheduler behaviour. `GOMAXPROCS` semantics are stable; surrounding mechanisms (preemption, work stealing) may shift.

**Tuning consequence.** Re-validate sweeps after toggling experiments.

---

## What Is *Not* Specified

The following behaviours are *not* specified and should not be relied on for tuning policy:

1. **Exact `procresize` STW duration.** Order of magnitude is documented; precise timing varies across versions and hardware.
2. **Internal work-stealing heuristics.** Cross-P stealing decisions, spin counts, and park timing are implementation details.
3. **GC pacer specifics.** The 25% mark-worker fraction is current behaviour but may change.
4. **Netpoller architecture.** The single-poller-thread design is implementation; could change to per-`P` pollers in future.
5. **`GODEBUG=schedtrace` output format.** Useful for debugging, not for parsing.
6. **`runtime.NumCPU()` rounding rules in containers.** Documented as "ceiling of quota/period" but the exact handling of fractional CPUs across cgroup versions has had subtle changes.

If a tuning policy depends on any of these, it is fragile across Go upgrades.

---

## Conformance Tests for Tuning Policy

A tuning policy that conforms to this specification can be validated by these tests.

### T1. Startup logging present

Grep service logs for a startup line containing `GOMAXPROCS=`. CI check.

### T2. Metric emitted

Confirm Prometheus endpoint returns `process_gomaxprocs` with a positive integer value. Smoke test in deployment.

### T3. Cgroup match

```bash
# inside the pod
quota=$(grep -o '^[0-9]*' /sys/fs/cgroup/cpu.max)
period=$(grep -o '[0-9]*$' /sys/fs/cgroup/cpu.max)
expected=$(( (quota + period - 1) / period ))
actual=$(curl -s localhost:9090/metrics | grep '^process_gomaxprocs ' | awk '{print $2}')
[ "$actual" = "$expected" ] || echo "MISMATCH: expected $expected, got $actual"
```

CI integration test.

### T4. No hard-coded `runtime.GOMAXPROCS(N)`

Lint:

```bash
grep -rn 'runtime\.GOMAXPROCS([1-9]' --include='*.go' .
```

Should return empty (or only well-commented exceptions).

### T5. CFS throttling below threshold

Prometheus alert on `rate(container_cpu_cfs_throttled_periods_total[5m]) / rate(container_cpu_cfs_periods_total[5m]) > 0.01`.

If T1–T5 all pass, the service conforms to the tuning specification.

---

## References

- [`runtime` package documentation](https://pkg.go.dev/runtime) — official API.
- [`runtime/metrics`](https://pkg.go.dev/runtime/metrics) — stable metrics.
- [Go GC pacer design document](https://go.googlesource.com/proposal/+/master/design/44167-gc-pacer-redesign.md) — mark worker sizing.
- `10-scheduler-deep-dive/03-gomaxprocs-tuning/specification.md` — internals specification.
- `10-scheduler-deep-dive/03-gomaxprocs-tuning/professional.md` — runtime source references.
- Linux kernel documentation: `Documentation/scheduler/sched-bwc.txt` for CFS bandwidth control.
- `cgroup v2` admin guide: kernel docs `Documentation/admin-guide/cgroup-v2.rst`.

Nothing in this file should surprise a reader of the upstream Go documentation; the value is in *which* parts are tuning-relevant.
