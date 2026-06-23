# `LockOSThread` Performance — Senior Level

> Cross-reference: semantics in [01-goroutines/02-vs-os-threads/senior.md](../../01-goroutines/02-vs-os-threads/senior.md). This page is the tuning-side counterpart: production architectures built on pinning, capacity-planning rules, fleet policies, the cost of preempting a pinned goroutine, and how to detect that pinning is hurting throughput in a running service.

## Table of Contents

1. [The Senior Decision: Pin or Not](#the-senior-decision-pin-or-not)
2. [Architecture: GPU/OpenGL/CUDA Fleet](#architecture-gpuopenglcuda-fleet)
3. [Architecture: Linux Namespace Switcher](#architecture-linux-namespace-switcher)
4. [Architecture: Pinned Signal Handler](#architecture-pinned-signal-handler)
5. [Architecture: HSM and Per-Thread Crypto Sessions](#architecture-hsm-and-per-thread-crypto-sessions)
6. [The "Main Loop" Question](#the-main-loop-question)
7. [Capacity Planning with Pinned Ms](#capacity-planning-with-pinned-ms)
8. [The `tgkill` Cost of Preempting Pinned Goroutines](#the-tgkill-cost-of-preempting-pinned-goroutines)
9. [Detecting Problematic Pinning in Production](#detecting-problematic-pinning-in-production)
10. [Fleet Policy: Pinning Audits](#fleet-policy-pinning-audits)
11. [NUMA and Pinned Workers](#numa-and-pinned-workers)
12. [Failover Patterns for Pinned Workers](#failover-patterns-for-pinned-workers)
13. [Observability Tags for Pinned Goroutines](#observability-tags-for-pinned-goroutines)
14. [Pinning and `automaxprocs`](#pinning-and-automaxprocs)
15. [Migration: Removing an Accidental Pin](#migration-removing-an-accidental-pin)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## The Senior Decision: Pin or Not

At senior level the answer is rarely a flat yes/no. It is a workload-shape decision:

| Workload | Pinning recommendation |
|---|---|
| Pure Go service, no cgo | No pinning. Trust the scheduler. |
| Cgo into a thread-safe library, light call rate | No pinning. Per-call M-acquisition is acceptable. |
| Cgo into a thread-affine library (OpenGL, CUDA, certain crypto) | Pin once per resource, single-owner pattern. |
| Cgo with measured hot loops (>10K calls/s, small C functions) | Pin a worker pool sized to the cgo concurrency budget. |
| Linux namespace switching | Pin per namespace context, often per request boundary. |
| Per-thread OS state (signal mask, capabilities, `setuid`) | Pin the specific goroutine that needs the state. |
| Real-time audio/control loops | Consider pinning + `GODEBUG=asyncpreemptoff=1`. Niche. |
| Soft real-time RPC | Don't pin. Reduce GC and contention instead. |

The default for every other workload is *don't pin*. The cost (one M per pin) is paid up front and forever; the benefit is only realised when there is genuine thread-affine state or measured locality gains.

When teams ask "should we pin this?", the senior answer starts with "what state does the thread hold that the goroutine cannot hold?" If the answer is "nothing," the conversation ends — no pinning. If the answer is "an OpenGL context" or "a network namespace," the conversation moves to "single owner or pool, how many."

---

## Architecture: GPU/OpenGL/CUDA Fleet

A canonical thread-affine architecture. Each GPU device requires a context bound to one OS thread for the lifetime of operations.

Design:

```
                  +-------------+
HTTP / gRPC ----> | Dispatcher  | --+--> Worker[0] (pinned, GPU 0)
                  +-------------+   +--> Worker[1] (pinned, GPU 1)
                                    +--> Worker[2] (pinned, GPU 2)
                                    +--> Worker[3] (pinned, GPU 3)
```

```go
type Pool struct {
    workers []*Worker
    sel     selector
}

type selector interface{ pick(load []int32) int }

func (p *Pool) Submit(ctx context.Context, j Job) (Result, error) {
    load := p.snapshotLoad()
    idx := p.sel.pick(load)
    return p.workers[idx].SubmitCtx(ctx, j)
}
```

Key decisions:

- **One worker per GPU.** Two workers competing for one GPU's context is undefined; one worker per resource is the only safe rule.
- **`GOMAXPROCS` is GPU count + headroom.** If you have 4 GPUs and want 4 CPU cores for other work, `GOMAXPROCS=8`. (Or split: pinned workers on a separate container with `GOMAXPROCS=4`, non-pinned services elsewhere.)
- **Load-balancer is non-pinned.** The dispatcher goroutine has no thread-affinity; it lives in the normal pool.
- **Sticky affinity for cached datasets.** If you upload a model to GPU 0 and want subsequent inferences to reuse it, hash by model ID, not round-robin.

Operational concerns:

- **GPU process isolation.** A GPU OOM or hang kills the worker but should not poison the others. Use one CUDA process per worker if possible (CUDA MPS / multi-process service).
- **Restart on failure.** Spawn a replacement worker when one panics. The pin is released when the old goroutine dies; the new one acquires a fresh M.
- **Driver pinning.** Some drivers care about NUMA. `numactl --cpunodebind=0` the worker if the GPU is on socket 0.

Capacity:

- 4 GPUs × 1 pinned M = 4 pinned Ms.
- HTTP server, dispatcher, GC, sysmon: ~6 Ms baseline.
- Total: ~10 Ms steady-state. Comfortable on a 16-CPU host.

---

## Architecture: Linux Namespace Switcher

`setns(2)` and `unshare(2)` operate on *the calling thread's* namespace. To execute a syscall inside a different network namespace, you must be on a thread that has switched into that namespace.

A network-tooling service that probes endpoints from multiple network namespaces:

```go
type NsWorker struct {
    nsPath string
    in     chan Probe
}

func (w *NsWorker) loop() {
    runtime.LockOSThread()
    // do NOT defer UnlockOSThread: we permanently mutate the thread.

    if err := setNs(w.nsPath); err != nil {
        log.Fatalf("setns: %v", err)
    }

    for p := range w.in {
        result := probe(p.target)
        p.reply <- result
    }

    // When `in` closes, return — the thread (now with a "dirty" namespace) dies.
    // Do not UnlockOSThread; we do not want this M reused with the wrong namespace.
}
```

The key trick: **do not unlock**. When the worker exits, the M is destroyed, taking the namespace mutation with it. Reusing the M for any other goroutine would expose them to a thread with a non-default namespace, which would silently break correctness.

The runtime handles the "exit while locked" case correctly: it calls `pthread_exit` on the thread instead of returning it to the pool. This is one of the few times this behaviour is what you want.

For a service with hundreds of namespaces, you cannot have hundreds of pinned workers. Instead, pin one switcher per namespace family, or use a kernel feature (`ip netns exec` subprocesses) to avoid in-process namespace pollution.

---

## Architecture: Pinned Signal Handler

Standard Go signal handling does not require pinning: the runtime installs handlers process-wide and funnels signals through `signal.Notify`. But certain niche cases benefit from a dedicated signal-owning thread:

- A C library that uses `pthread_sigmask` to block signals on most threads, requiring one specific thread to receive them.
- A real-time-style design where SIGALRM-driven heartbeats must land on a known thread.

```go
func init() {
    go signalOwner()
}

func signalOwner() {
    runtime.LockOSThread()
    // sigprocmask via syscall to unblock SIGUSR1 only here
    var set syscall.Sigset_t
    sigaddset(&set, syscall.SIGUSR1)
    syscall.Syscall6(syscall.SYS_RT_SIGPROCMASK, _SIG_UNBLOCK, uintptr(unsafe.Pointer(&set)), 0, 8, 0, 0)

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGUSR1)
    for s := range sigCh {
        handle(s)
    }
}
```

This is exotic. Most Go services should not need it; if you find yourself reaching here, audit whether the C library can be configured to not depend on per-thread signal masks.

---

## Architecture: HSM and Per-Thread Crypto Sessions

Hardware Security Modules (HSMs) and certain crypto SDKs (PKCS#11 in some vendor implementations) maintain per-thread session state. A session opened on thread A is unusable on thread B.

Design:

```go
type HSMWorker struct {
    sess *C.session_t
    in   chan Op
}

func New(slot string) (*HSMWorker, error) {
    w := &HSMWorker{in: make(chan Op, 64)}
    errCh := make(chan error, 1)
    go w.loop(slot, errCh)
    return w, <-errCh
}

func (w *HSMWorker) loop(slot string, errCh chan<- error) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    s, rc := C.session_open(C.CString(slot))
    if rc != 0 {
        errCh <- fmt.Errorf("session_open: %d", rc)
        return
    }
    w.sess = s
    defer C.session_close(w.sess)
    errCh <- nil

    for op := range w.in {
        op.reply <- C.session_sign(w.sess, op.data)
    }
}
```

Capacity:

- Sessions are expensive (TPM-style HSMs charge real money per session, plus operations).
- Concurrency is bounded by session count, not CPU.
- Pin one worker per session, size the pool to the HSM's operation throughput.

For a service that signs at 10K ops/s and the HSM can do 1K ops/s per session, you need 10 sessions, 10 workers, 10 pinned Ms. Plus your `GOMAXPROCS`, plus baseline — a 12-CPU container is reasonable.

This is one of the few production designs where "pin a moderate-sized pool" is the obvious answer rather than a code smell.

---

## The "Main Loop" Question

A recurring design question: should the central event loop be pinned?

**Cases for pinning the main loop:**

- macOS GUI applications. AppKit's main thread *is* `pthread_main_np()`; everything related to the window manager must run there. `runtime.LockOSThread` in `init` is required.
- OpenGL applications where the GL context lives on `main`.
- Some embedded SDKs that expect the main thread.

**Cases against:**

- Server applications. The main goroutine's only job is usually to wait for shutdown signals. Pinning wastes an M for no benefit.
- CLI applications doing parallel work. Pinning `main` forces all top-level work onto one M.
- Anything where the rest of the program does heavier work than `main` itself.

The default is *don't*. The exceptions are easy to spot — they are documented by the SDK you are integrating with. If no SDK requires it, no pin.

---

## Capacity Planning with Pinned Ms

A planning model that catches most pinning mistakes early:

```
total_Ms = GOMAXPROCS                            // baseline P-bound Ms
         + pinned_workers                         // permanent retirements
         + cgo_blocking_concurrency               // in-flight cgo
         + file_io_concurrency                    // blocking disk reads
         + 3                                      // sysmon, GC, signal
```

For a service with 4 GPUs (4 pinned), 8 concurrent cgo calls, 4 file readers, `GOMAXPROCS=8`:

```
total = 8 + 4 + 8 + 4 + 3 = 27 Ms
```

Kernel scheduling overhead at 27 threads is fine; CPU throttling, however, depends on container limits. If the container is limited to 8 CPUs, those 27 threads contend for 8 cores. CFS throttling appears as p99 latency tails.

Two policies:

1. **Right-size the container.** `cpu = ceil((effective_GOMAXPROCS + pinned + heavy_blocking) × headroom)`. For the example, that is `~12 CPUs`.
2. **Reduce pin count.** Consolidate work into fewer, bigger pinned workers (one worker handling 2 GPUs round-robin is a bad idea for GPUs but fine for some HSM models).

Track these in dashboards:

- `pinned_worker_count` (your own metric).
- `process_threads_total` (Prometheus default).
- `container_cpu_cfs_throttled_seconds_total` (cgroup metric).

A capacity-plan PR should compute the model and show it in the description.

---

## The `tgkill` Cost of Preempting Pinned Goroutines

Since Go 1.14, the runtime preempts long-running goroutines via `SIGURG`. The signal is sent with `tgkill(2)` on Linux, targeting a specific TID. Cost per preemption: ~1–3 µs of kernel time.

For unpinned goroutines, preemption is rare and cheap; the runtime can also move the G to another M for load balancing.

For pinned goroutines, two facts matter:

1. **Pinned goroutines can still be preempted.** The pin only prevents migration, not preemption.
2. **Preempting a pinned goroutine yields no scheduling benefit** if the M is dedicated to it. The G is the only one on the M; preemption just makes it sleep briefly.

The runtime is aware of this and applies preemption rules consistently — it does not specifically skip pinned goroutines. So a pinned goroutine in a tight CPU loop pays preemption cost (~1 µs per ~10 ms quantum, so 0.01% overhead).

If you have a workload where this matters (high-frequency trading, audio DSP, control loops), the only stock-Go workaround is `GODEBUG=asyncpreemptoff=1`, which disables async preemption globally — risky for the rest of the program (cooperative preemption only, so tight loops without function calls become un-preemptible).

Production practice: live with the preemption cost. The 0.01% is invisible compared to the workload's own variance.

---

## Detecting Problematic Pinning in Production

Signals that pinning is hurting throughput:

**Signal 1: thread count grows past expected.**

`process_threads_total` should be roughly `baseline + pinned_count`. If it grows higher, you have either accidental pinning (per-request `LockOSThread`), cgo storms (unbounded cgo concurrency), or blocking syscalls.

**Signal 2: scheduler latency rises.**

`runtime/metrics /sched/latencies:seconds` p99 > 5 ms on a moderately loaded machine is a red flag. Usually means too many Ms competing for too few cores, often because pin count + GOMAXPROCS exceeds the CPU budget.

**Signal 3: pinned worker idle but tail latency rises.**

Run `top -H -p <pid>`. A pinned worker thread showing 5% CPU while other threads are at 100% means the pin is starving the worker of work *or* the worker is fast and other work is starving for CPU. Inspect channel depths in dispatcher metrics.

**Signal 4: M creation rate spikes during traffic burst.**

`runtime/metrics /sched/threads:threads` jumping by tens within seconds is M-pool churn. Usually means cgo bursts. If you have pinned workers, check they aren't being created per request.

**Signal 5: `pprof goroutine` shows many stacks parked at `runtime.gopark` after `runtime.LockOSThread`.**

Lots of pinned goroutines parked = pinned workers waiting for work. If queue depth is 0 and they are idle, you over-provisioned the pin pool. If queue depth is high, the bottleneck is elsewhere.

The standard production check sequence:

```
1. process_threads_total trending up? → audit pinning + cgo
2. sched_latencies p99 high? → check effective GOMAXPROCS
3. per-thread CPU uneven? → load-balancer or pin sizing
4. pinned worker queue depth high? → scale pool or cap submitters
```

---

## Fleet Policy: Pinning Audits

For an organisation running hundreds of Go services, a pinning audit policy:

**Rule 1: every `LockOSThread` in code must have a comment explaining why.**

Enforced by lint. Comment must include: the API/library that requires pinning, the resource owned, the cleanup semantics.

**Rule 2: pin counts logged at startup.**

Each service prints its expected pin count when it starts. Operations dashboards check `process_threads_total` against expected + baseline.

**Rule 3: `LockOSThread` not allowed in HTTP handlers.**

`go vet` custom rule. Per-request pinning is virtually never correct; force the developer to either move it to a worker or document an exception.

**Rule 4: alert on thread count > 50 (or org-specific threshold).**

A simple alarm catches cgo storms, accidental pinning, file I/O bursts.

**Rule 5: integration tests assert thread count under load.**

```go
func TestThreadCountUnderLoad(t *testing.T) {
    // start service, load test, then:
    got := readThreadCount(t)
    if got > 30 {
        t.Fatalf("thread count %d exceeds 30; pinning audit required", got)
    }
}
```

The test fails fast if a developer introduces accidental pinning.

These rules together catch ~all production pinning regressions. The lint rule alone has saved more outages than any monitoring alert.

---

## NUMA and Pinned Workers

On NUMA machines (multi-socket), an M floats between cores by kernel scheduling unless pinned at the OS level. A `LockOSThread` pin from Go does not give the kernel any hint about CPU affinity — only that the goroutine must stay on that M.

If your pinned worker accesses memory on socket 0 but the kernel migrates the M to socket 1, you pay cross-socket cache misses (~100 ns vs ~10 ns). For GPU workers this can matter: the GPU PCIe lane is on a specific socket.

Combined OS-level pinning:

```go
// Linux only:
//   runtime.LockOSThread first, then sched_setaffinity to pin to a CPU set.
runtime.LockOSThread()
defer runtime.UnlockOSThread()

var cpus unix.CPUSet
cpus.Set(0); cpus.Set(1); cpus.Set(2); cpus.Set(3)
if err := unix.SchedSetaffinity(0, &cpus); err != nil {
    log.Printf("sched_setaffinity: %v", err)
}
```

This pins the M (and thus the goroutine) to CPUs 0–3 (socket 0). Combined with `numactl --membind=0`, you avoid cross-socket allocations entirely.

For most services on cloud VMs (≤16 vCPU), NUMA is single-node and this is unnecessary. For bare-metal multi-socket: required for predictable performance.

---

## Failover Patterns for Pinned Workers

A pinned worker is single-threaded by design; if it panics or hangs, work backs up. Failover patterns:

**Hot replacement.** When a worker dies, the pool spawns a new one. Health checks via timing channel sends.

```go
func (p *Pool) supervise() {
    for {
        time.Sleep(1 * time.Second)
        for i, w := range p.workers {
            if !w.alive() {
                go p.replace(i)
            }
        }
    }
}
```

**Drain on suspicion.** If a worker's response time exceeds a threshold, mark it sick, drain its queue to siblings, restart it.

**Pre-warmed standbys.** Keep `n + spare` workers; route to the first `n` healthy ones.

**Restart cascade containment.** If many workers die at once (a bug in the C library), don't restart all of them simultaneously — that creates a thundering herd of `pthread_create` syscalls and re-initialisation cost.

For HSM/GPU workers where re-initialisation costs seconds (driver reset, hardware reset), a 5-second backoff on restart and a circuit breaker is standard.

---

## Observability Tags for Pinned Goroutines

Tag pinned goroutines so they show up clearly in profiles:

```go
import "runtime/pprof"

func (w *Worker) loop() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    pprof.SetGoroutineLabels(pprof.WithLabels(
        context.Background(),
        pprof.Labels(
            "role", "gpu-worker",
            "device", strconv.Itoa(w.deviceID),
        ),
    ))

    // ... run loop ...
}
```

Now `go tool pprof` can filter:

```
go tool pprof http://host:6060/debug/pprof/goroutine
> tags
> tag_focus device:0
> top
```

In the goroutine profile you see exactly which Gs are pinned to which device. Invaluable when investigating why one GPU's queue is backing up.

Extend with a per-request label inside `process()`:

```go
func (w *Worker) process(ctx context.Context, j Job) Result {
    ctx = pprof.WithLabels(ctx, pprof.Labels("request_id", j.RequestID))
    pprof.SetGoroutineLabels(ctx)
    defer pprof.SetGoroutineLabels(pprof.WithLabels(ctx, pprof.Labels("request_id", "")))
    // ... real work ...
}
```

Now a stuck request shows up in the pinned worker's profile with its own ID.

---

## Pinning and `automaxprocs`

`go.uber.org/automaxprocs` sets `GOMAXPROCS` to match the container's CPU quota. If you pin K workers and the container has C CPUs, you want `GOMAXPROCS = C` (so the runtime can use all CPUs) but you effectively have `C − K` Ps available for non-pinned work.

Two policies:

- **Conservative:** size the container with `C ≥ K + desired_unpinned_GOMAXPROCS`. Always have headroom for non-pinned work. Standard.
- **Aggressive:** `C = K + 1`. Save costs by treating pinned workers as the bulk of the work. Only works if non-pinned work is negligible (pure dispatcher + occasional housekeeping).

Aggressive policy is fragile: any unexpected non-pinned spike (GC, sysmon, telemetry) competes with pinned workers for CPU. Conservative is the default.

When using `automaxprocs`, log the effective `GOMAXPROCS` and the pinned count at startup. A health check that verifies `GOMAXPROCS > pinned` catches misconfiguration:

```go
if runtime.GOMAXPROCS(0) <= pinnedCount {
    log.Fatalf("GOMAXPROCS=%d not enough for %d pinned workers + baseline",
        runtime.GOMAXPROCS(0), pinnedCount)
}
```

---

## Migration: Removing an Accidental Pin

Sometimes a code audit reveals an unjustified pin. Removal pattern:

1. **Confirm the pin's effect.** Run with and without the pin under load; measure thread count and latency. If removal doesn't break correctness or change perf, the pin was vestigial.
2. **Identify what state the pin protected.** Cgo TLS? OS-level state? If state exists, leaving the pin in is safer until you have a migration plan.
3. **Replace per-thread state with goroutine-local.** Move the state into the Go side (a struct, a channel, a `sync.Mutex`-protected field).
4. **Remove the `LockOSThread`/`UnlockOSThread` calls.**
5. **Watch thread count drop.** If it doesn't drop, you have other pinning sources (cgo storms, file I/O); investigate separately.

A common case: the pin was inherited from a tutorial that included it for clarity, then never reviewed. The codebase has run for years with the unjustified pin. Removing it can produce a measurable throughput improvement at zero behavioural cost.

Always migrate in test environments first. Production rollout via flag.

---

## Self-Assessment

- [ ] I can describe one production workload where pinning is required and one where it would be a mistake.
- [ ] I have measured thread count before and after pinning was added to a service.
- [ ] I can compute the effective `GOMAXPROCS` for a service with pinned workers and predict scheduler-latency impact.
- [ ] I have audited a codebase for `LockOSThread` usage and judged each instance against criteria.
- [ ] I have built a single-owner pinned worker for a thread-affine library.
- [ ] I have a Prometheus dashboard with `process_threads_total` and `/sched/latencies:seconds`.
- [ ] I have an alert that fires when thread count exceeds expected baseline by a wide margin.
- [ ] I have a runbook entry for "thread count climbing" that includes pinning audit steps.
- [ ] I have used pprof labels to distinguish pinned-worker goroutines from request-handler goroutines.
- [ ] I have refactored a per-request pinning anti-pattern into a single-owner pool, and measured the throughput improvement.

---

## Summary

Senior pinning is about architecture: design patterns (single owner, bounded pool), capacity planning (M budget = `GOMAXPROCS + pins + cgo + IO + baseline`), fleet policy (lint rules, dashboards, alerts), and migration.

Five rules for production:

1. **Pin once per thread-affine resource.** Never per request.
2. **Document each pin** with the reason and the API that requires it.
3. **Size the container** so `GOMAXPROCS ≥ pinned + headroom`.
4. **Track thread count** as a first-class metric.
5. **Alert on growth past baseline** to catch accidental pinning early.

Three architectures dominate real-world pinning use:

- **GPU/OpenGL fleet** — one worker per device.
- **Namespace switcher** — pin without unlock so the dirty namespace dies with the M.
- **HSM worker pool** — one session per worker, sized to operation throughput.

Three signals of misuse:

- Thread count climbing.
- Scheduler latency p99 rising.
- Per-thread CPU utilisation grossly uneven.

The professional page goes one level lower: runtime mechanics of `LockOSThread`, the `tgkill` preemption path in detail, M growth controllers, NUMA hardware effects, and what changes between Go versions.
