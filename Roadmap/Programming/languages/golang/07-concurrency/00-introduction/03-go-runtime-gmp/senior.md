# Go Runtime GMP — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Scheduler as a Capacity Constraint](#scheduler-as-a-capacity-constraint)
3. [Fairness and Tail Latency](#fairness-and-tail-latency)
4. [Pinning Goroutines and OS Threads](#pinning-goroutines-and-os-threads)
5. [Cgo and the Scheduler](#cgo-and-the-scheduler)
6. [Containers, Kubernetes, and GOMAXPROCS](#containers-kubernetes-and-gomaxprocs)
7. [NUMA Awareness (or Lack Thereof)](#numa-awareness-or-lack-thereof)
8. [Isolation Strategies](#isolation-strategies)
9. [Designing Services with the Scheduler in Mind](#designing-services-with-the-scheduler-in-mind)
10. [Common Misuses of Scheduler Knobs](#common-misuses-of-scheduler-knobs)
11. [Operational Concerns](#operational-concerns)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

At senior level the scheduler is a system-design constraint, not a curiosity. Decisions about `GOMAXPROCS`, thread pinning, Cgo, and runtime tuning have observable consequences: latency tails, throughput ceilings, container behaviour under bursts, NUMA-induced slowness. The senior view weighs these trade-offs, designs around them, and tunes only with measurement.

This file collects the operational and architectural wisdom accumulated by people who have run Go in production at scale. It does not dive into runtime internals (that is `professional.md`); it stays at the system-design altitude.

After this you will:

- Reason about scheduler-induced latency in your services.
- Make informed decisions about container CPU quota and `GOMAXPROCS`.
- Understand when Cgo interacts with the scheduler poorly.
- Recognise NUMA effects and decide whether to address them.
- Distinguish operational knobs that help from ones that hide problems.
- Design services that cooperate with the scheduler rather than fight it.

---

## Scheduler as a Capacity Constraint

Every Go service has a finite capacity. Some of it is CPU (`GOMAXPROCS` cores). Some is memory, FD count, downstream throughput. The scheduler is the gatekeeper that allocates the CPU portion.

Two truths to internalise:

1. **The scheduler is roughly fair, not strict.** Goroutines get CPU time in roughly equal portions over the long run, but there are no priority levels and no SLA on individual scheduling latency.
2. **The scheduler has its own overhead.** At very high goroutine counts (millions runnable), scheduling itself consumes CPU. The practical ceiling is around a million runnable goroutines; well-tuned services typically run far below.

### CPU partitioning

If your service runs on a 16-core host and you want it to use only 8 cores (leaving 8 for other tenants), set `GOMAXPROCS=8`. The scheduler will use only 8 P's. The OS may still schedule those 8 P's onto any of the 16 cores — that is the OS's job.

For strict CPU isolation, you need OS-level mechanisms: cgroups, `taskset`, `numactl`. Go does not provide CPU pinning directly.

### Throughput ceiling

A request that takes 1 ms on one core can theoretically run at `8 × 1000 = 8000 req/sec` on 8 cores, assuming perfect parallelism. In practice you see less:

- GC steals ~5% in typical workloads.
- Lock contention bounds throughput on shared data.
- Allocation pressure adds GC churn.
- The request itself is rarely perfectly parallel (Amdahl).
- I/O wait keeps cores idle even at high goroutine count if downstreams are slow.

The scheduler is doing its job; the ceiling is elsewhere.

---

## Fairness and Tail Latency

The Go scheduler is preemptive (1.14+). A goroutine that runs without yielding for 10 ms gets a preemption signal. But fairness in *aggregate* is rough:

- A high-frequency goroutine (constantly runnable) gets more CPU than a low-frequency one.
- A goroutine that woke up just now goes to the head of `runnext`, not the tail of the queue. Recent activity → next pick.
- The global queue is checked only every 61 schedule iterations on each P. A goroutine on the global queue can wait dozens of microseconds.

For most workloads this is fine. For low-latency services (HFT, real-time games, sub-millisecond APIs), you may notice:

- **p99 latency spikes** when GC happens (~100 µs STW).
- **Occasional outliers** from scheduler queueing under burst.
- **Tail amplification** when fanning out to many goroutines.

Mitigations:

- Lower GC frequency with `GOGC=200` (tolerate more memory for fewer GC cycles).
- Use `GOMEMLIMIT` (Go 1.19+) to bound heap.
- Reduce allocations (object pooling, byte buffers).
- Profile with `go tool trace` to find scheduling gaps.
- Consider `runtime.LockOSThread` for the most latency-critical goroutine (e.g., a network packet handler).

---

## Pinning Goroutines and OS Threads

`runtime.LockOSThread` pins the calling goroutine to its current OS thread for the goroutine's lifetime (or until `UnlockOSThread`).

### Use cases

- **Cgo with thread-local state.** OpenGL contexts, libraries that use `pthread_key_t`, Java JNI bridges that require thread identity.
- **System call sequences.** Some syscalls require staying on the same thread (e.g., `signalfd`, `personality`).
- **Foreign UI frameworks.** GTK and Cocoa main-thread requirements.
- **Real-time / low-jitter code.** Combined with OS-level CPU pinning (`sched_setaffinity` via Cgo) to keep a goroutine on one specific core.

### Costs

- The goroutine occupies an OS thread exclusively. The scheduler cannot move it.
- If you spawn many locked goroutines, each consumes an M (an OS thread). Default Linux thread limit is ~30000; you can exhaust it.
- The runtime creates new M's to replace the locked one, so other goroutines keep running. But the M count grows.

### Best practices

- Lock only when needed.
- Lock for as short a time as possible.
- Unlock explicitly with `runtime.UnlockOSThread` (the locking nests; unlock the same number of times you locked).
- Document why a function locks the thread.

### Avoiding accidental thread pinning

Some Cgo libraries lock the thread for you. The pinning persists across the Cgo call's lifetime. If you do not also unlock, the goroutine is stuck on that thread.

`SetGoroutineBuf` or similar in Cgo bindings are red flags. Read the library docs.

---

## Cgo and the Scheduler

Cgo lets Go call C code. The scheduler treats Cgo calls as syscalls: while in C, the M is "in a syscall" state, the P may be detached, etc.

### Performance characteristics

- **Entry cost.** A Cgo call has ~150 ns of overhead per call (Go-to-C transition: save Go state, switch stacks, restore C state).
- **Exit cost.** Similar ~150 ns to return.
- **Duration.** While in C, the M is held. The runtime may create another M to keep `GOMAXPROCS` P's busy.

### Implications

- **High-frequency Cgo destroys performance.** A loop calling C a million times pays ~300 ns per call, plus the C work. Compare to 1–10 ns for native Go.
- **Long Cgo calls hold M's.** If 100 goroutines all do long Cgo calls, you get 100 extra M's.
- **Stack switching.** Each Cgo call switches between Go's growable stack and C's fixed stack.

### When Cgo is fine

- Calling a C library with infrequent, large work (image decoding, crypto, ML inference). The per-call cost is amortised.
- Bindings to specific OS APIs not available in pure Go.
- Linking to existing C/C++ codebases.

### When Cgo is wrong

- Replacing pure-Go code with C "for speed." Almost always slower due to overhead.
- Implementing a hot inner loop in C. The transitions dominate.
- Anything trivial.

The Go community's strong advice: avoid Cgo. Pure Go is usually fast enough; when it is not, the bottleneck is rarely worth the Cgo cost.

---

## Containers, Kubernetes, and GOMAXPROCS

Containerised Go services have a long history of pain with `GOMAXPROCS`.

### The problem

`runtime.NumCPU()` historically returned the host's logical CPU count, ignoring cgroup CPU quota. A pod limited to 2 cores on a 64-core node would get `GOMAXPROCS=64`. The Go scheduler thought it had 64 cores; the kernel throttled it; latency rose.

### The fix landscape

- **`github.com/uber-go/automaxprocs`** (since 2017). Sets `GOMAXPROCS` from cgroup CPU quota at startup. Industry standard for older Go.
- **Go 1.21 (2023)** introduced native cgroup-aware `GOMAXPROCS` defaults on Linux.
- **Go 1.22+** improved this further.

If you run modern Go on a modern kernel with cgroup v2, you should not need `automaxprocs`. But check.

### Sizing CPU quota

For Go services:

- `cpu.requests = average CPU usage`. Used by the Kubernetes scheduler for placement.
- `cpu.limits = peak CPU usage`. Caps the throttle.

A service that sometimes spikes from 1 to 8 cores benefits from a high limit (or none) to absorb bursts without throttling.

### Memory matters too

`GOMEMLIMIT` (Go 1.19+) tells the runtime "stay under this memory." Combined with a Kubernetes memory limit, this prevents OOM by triggering GC earlier.

```bash
GOMEMLIMIT=1GiB go run main.go
```

For containerised services, set `GOMEMLIMIT` to 75–90% of the container's memory limit.

### Throttling visibility

Use Prometheus to monitor:
- `container_cpu_cfs_throttled_periods_total` — how often the kernel throttles the container.
- `runtime.NumGoroutine` — goroutine count over time.
- `go_gc_duration_seconds` — GC pause time.

Throttling causes the scheduler to look healthy from Go's perspective while the actual CPU is denied. Symptoms: slow requests with no obvious Go-side cause.

---

## NUMA Awareness (or Lack Thereof)

The Go runtime is NUMA-unaware. P's and M's float across sockets. Memory allocation is also socket-blind.

### When NUMA matters

Multi-socket servers (Intel Xeon Scalable, AMD EPYC). Each socket has its own memory bank. Cross-socket memory access is 1.5x–2x slower than local.

### What you observe

- Variable per-operation latency. Some operations are fast (local memory); others slow (remote).
- Lower-than-expected scaling on multi-socket. Adding a second socket gives 1.3x–1.5x, not 2x.
- Heavy memory traffic on the QPI / Infinity Fabric.

### What you can do

- **One process per socket.** Run two Go processes, each with `GOMAXPROCS=local-cores`, pinned to one socket via `numactl --cpunodebind=N --membind=N`.
- **Sharded data.** Partition state by socket; each shard accesses local memory.
- **`runtime.LockOSThread` + OS-level affinity.** Pin the most latency-sensitive goroutine to one core. Memory pressure may still vary.

For most cloud workloads (single-socket VMs), NUMA does not arise. For bare-metal HPC, it dominates.

---

## Isolation Strategies

Sometimes you want one part of the program shielded from another. Options:

### Process isolation

Run two Go processes. Most isolation. Costs IPC overhead.

### `runtime.LockOSThread` + dedicated thread

A "real-time" goroutine on a locked thread, possibly OS-pinned to a specific core. The scheduler still runs other goroutines on other threads/cores, but the locked goroutine has predictable behaviour.

### Per-component worker pools

Different parts of the system use different worker pool sizes. Background work bounded at 4 workers; foreground bounded at 32. Each pool's contention is local.

### GC tuning

- `GOGC=off` disables GC (only for short-lived processes).
- `GOGC=200` increases the GC's target heap ratio, reducing GC frequency at the cost of memory.
- `GOMEMLIMIT` bounds total memory.

### Cooperative back-pressure

Drop or delay background work when foreground is busy. Implement with separate channels and queue depths.

---

## Designing Services with the Scheduler in Mind

Practical guidelines:

### Keep goroutines small

A goroutine should do one thing. Spawn it, let it finish, exit. Long-lived goroutines (worker pools, background tasks) should be few and well-managed.

### Bound goroutine creation rates

Spawning a million goroutines per second pressures the scheduler. Use pools and rate-limiting.

### Avoid pinning unless necessary

Pinning a goroutine to a thread loses scheduler flexibility. Use only for foreign code or real-time needs.

### Match GOMAXPROCS to the container

In Kubernetes, ensure `GOMAXPROCS` reflects the CPU quota. Use `automaxprocs` if Go < 1.21.

### Profile, do not assume

The scheduler is well-tuned; do not second-guess it without evidence. Run benchmarks; collect traces.

### Tune GC for your workload

Latency-sensitive: aggressive GC, smaller heap, lower `GOGC`.
Throughput-oriented: larger heap, less frequent GC, higher `GOGC`.

### Expose runtime metrics

```go
import "runtime/metrics"
```

Read scheduler stats programmatically. Export to Prometheus.

Examples:
- `/sched/goroutines:goroutines`
- `/sched/latencies:seconds`
- `/sched/total-events:events`

### Use `go tool trace` in development

Even a 5-second trace of a representative workload reveals scheduling patterns, contention, and GC behaviour. The investment in learning the tool pays off.

---

## Common Misuses of Scheduler Knobs

### Setting `GOMAXPROCS=1` for "simpler debugging"

You lose parallelism. Bugs visible only with parallel execution hide. Use `-race` instead.

### Calling `runtime.GC()` repeatedly

Triggers GC manually. Almost never helpful — the runtime's heuristic is smarter than humans. Calling it in tight loops kills throughput.

### `runtime.Gosched()` in tight loops

Pre-1.14 this could prevent starvation. Now async preemption handles it. Avoid in modern code.

### Lock OS thread "for cache locality"

The scheduler keeps goroutines on the same M when feasible. Pinning rarely helps and removes flexibility.

### Setting `GOMAXPROCS` higher than `NumCPU`

Pointless. The OS still has only the CPUs it has. More P's just thrash.

### Disabling GC for "performance"

`GOGC=off` removes the safety net. Memory grows until OOM. Only useful for very short-lived processes (build tools, one-shot scripts).

### Reading `runtime/metrics` per request

Each metric read has overhead. Read them periodically (every 1–10 s) into a cached struct, expose from there.

---

## Operational Concerns

### Capacity planning

- Estimate goroutines per request: 1–5 typical.
- Estimate request rate: e.g., 1000 req/sec.
- At any moment, ~`request_rate × p99_latency` goroutines are alive.
- Add background goroutines.
- Multiply by 1.5–2x safety.

A 1000-req/sec service with 100 ms p99 has ~100–200 goroutines in flight steady state. The scheduler handles this easily on 4–8 cores.

### Profiling in production

- Continuous CPU profiling (1% sample rate) is cheap and invaluable.
- Goroutine profiles on demand: `curl :6060/debug/pprof/goroutine`.
- Block / mutex profiles: enable only when debugging contention; they add overhead.

### Alerting

- Sustained goroutine growth → leak.
- High GC pause time → memory pressure.
- High `sched/latencies` → scheduler saturation.
- Container CPU throttling → mismatched `GOMAXPROCS`.

### Upgrades

Each Go release improves the scheduler. Track scheduler changelogs. Test before upgrading; sometimes scheduling behaviour changes affect tail latencies.

---

## Self-Assessment

- [ ] I have explained `GOMAXPROCS` and its tuning to a colleague.
- [ ] I have set up `automaxprocs` or relied on Go 1.21+'s native cgroup awareness for at least one service.
- [ ] I have used `runtime.LockOSThread` knowingly with documented purpose.
- [ ] I have profiled with `go tool trace` and interpreted scheduler events.
- [ ] I have decided against `Cgo` in a particular case based on measurement.
- [ ] I have planned capacity for a service in terms of goroutine count.
- [ ] I have alerted on `runtime.NumGoroutine` in production.
- [ ] I have read the Go release notes for scheduler changes in the last 3 versions.
- [ ] I have argued with a peer who wanted to set `GOMAXPROCS=1` to "simplify."
- [ ] I have used `GOMEMLIMIT` in production.

---

## Summary

The Go scheduler is a high-quality piece of engineering; senior usage is mostly about *not getting in its way*. Default `GOMAXPROCS`, minimal pinning, no `Cgo` unless necessary, GC tuned for the workload, and observability built in.

The operational view is dominated by containers and Kubernetes. `GOMAXPROCS` must match the CPU quota (Go 1.21+ does this natively; older versions need `automaxprocs`). `GOMEMLIMIT` bounds memory. Both prevent OOM and throttling surprises.

NUMA, real-time, and HFT workloads occasionally require lower-level control. Most services do not. When measurement shows the scheduler is the bottleneck, fix it; when it does not, leave it alone.

The next file (`professional.md`) dips into the runtime internals — `g`, `m`, `p` structs, sysmon details, the async preemption protocol — for those who want to read the source.
