# Runtime Goroutine Management — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [GOMAXPROCS in Production](#gomaxprocs-in-production)
3. [GOMEMLIMIT and SetMemoryLimit](#gomemlimit-and-setmemorylimit)
4. [GOGC and SetGCPercent](#gogc-and-setgcpercent)
5. [SetMaxStack and SetMaxThreads as Safety Nets](#setmaxstack-and-setmaxthreads-as-safety-nets)
6. [Stack Trace Discipline](#stack-trace-discipline)
7. [LockOSThread Patterns](#lockosthread-patterns)
8. [Adopting runtime/metrics](#adopting-runtimemetrics)
9. [Profile and Trace Sampling Rates](#profile-and-trace-sampling-rates)
10. [GODEBUG Companion Knobs](#godebug-companion-knobs)
11. [Common Anti-Patterns](#common-anti-patterns)
12. [Diagnostics Playbook](#diagnostics-playbook)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At junior level you learned which APIs exist. At middle level you apply them in production: containers, capacity planning, leak hunts, OOM avoidance, and pprof-driven debugging. The mindset shifts from "what does this function do" to "given a Kubernetes pod with 2 CPU, 1 GB memory, and 30k req/s, which runtime settings are correct?"

After this file you will:

- Choose `GOMAXPROCS` correctly for containers, NUMA hosts, and mixed workloads.
- Set `GOMEMLIMIT` to prevent OOM kills without crippling throughput.
- Tune `GOGC` for the right CPU/memory tradeoff.
- Use `SetMaxStack` and `SetMaxThreads` as production safety nets.
- Take diagnostic dumps without surprising production traffic.
- Integrate `runtime/metrics` into Prometheus.
- Recognise the common anti-patterns: `Gosched` sprinkles, manual `GC` calls, library-set `GOMAXPROCS`.

For internals — how the scheduler actually consumes `GOMAXPROCS`, how `SetMemoryLimit` interacts with the pacer — see the professional file and the scheduler/GC sections. Cross-reference to [02-vs-os-threads](../02-vs-os-threads/) for the M:N model that `GOMAXPROCS` directly tunes.

---

## GOMAXPROCS in Production

### What it actually controls

`GOMAXPROCS` is the number of **P** (processor) contexts the Go scheduler creates. Each P is the resource an M (OS thread) must hold to execute Go code. Net effect: at most `GOMAXPROCS` goroutines run user code simultaneously. Other Ms exist for blocking syscalls and cgo, so the OS thread count exceeds `GOMAXPROCS` under I/O load.

```go
runtime.GOMAXPROCS(0)   // read, do not change
runtime.GOMAXPROCS(4)   // set to 4, returns previous
```

### Default behaviour

- **Before Go 1.5:** default 1 (single-core).
- **Go 1.5 to 1.24:** default `runtime.NumCPU()`. In a container with `cpu.cfs_quota_us=2`, this still returned the host's core count.
- **Go 1.25+:** default reads cgroup CPU quota when present and rounds up.

If you cannot rely on 1.25+, you must set it yourself. The standard library does not.

### The container problem

A Kubernetes pod with `resources.limits.cpu: 2` runs on a 64-core host. Before Go 1.25, `runtime.NumCPU()` returned 64. The scheduler created 64 Ps, each spinning trying to run goroutines, but the kernel only let 2 cores actually progress. Effects:

- Heavy lock contention on internal scheduler structures.
- GC workers oversubscribing CPU.
- p99 latency spikes from CPU throttling.
- Higher kernel CPU usage (scheduling, throttling).

The fix:

```go
import "go.uber.org/automaxprocs/maxprocs"

func init() {
    _, _ = maxprocs.Set()
}
```

Or manually:

```go
quota := readCPUQuota("/sys/fs/cgroup/cpu.max") // implement per platform
runtime.GOMAXPROCS(int(math.Ceil(quota)))
```

Or via env: `GOMAXPROCS=2 ./server`.

### When to deviate from `NumCPU`

- **Containerised, no auto-detection:** set to the container's CPU quota.
- **Cgo-heavy workload:** sometimes lower; cgo holds Ms, and oversubscription thrashes.
- **Mixed I/O and CPU:** leave at `NumCPU`. Blocking I/O parks goroutines without consuming a P.
- **Single-core box, CPU-bound:** leave at 1. Extra Ps do nothing useful.
- **Diagnosing a race:** set to 1 to serialize goroutines. Useful for race reproduction; do not ship.

### What `GOMAXPROCS` is *not*

- Not a hard cap on OS threads. Use `SetMaxThreads` for that.
- Not a goroutine cap. Spawn as many as you like.
- Not a guarantee of parallelism if the OS does not give you the cores.

### Reading `GOMAXPROCS` from env

The env var is parsed once at startup. Subsequent changes to `GOMAXPROCS` after the program starts must go through `runtime.GOMAXPROCS(n)`. You cannot change it via env mid-process.

---

## GOMEMLIMIT and SetMemoryLimit

### What it does

`debug.SetMemoryLimit(bytes int64) int64` (Go 1.19+) sets a soft memory cap. The GC pacer uses the cap as a target: as live memory + stacks + reserved memory approaches the cap, the runtime triggers GC more aggressively. The "soft" qualifier means the runtime cannot stop user code mid-allocation; under burst allocation, you may briefly exceed the cap.

The environment variable equivalent: `GOMEMLIMIT=900MiB`.

### Why you should set it in containers

The default GC trigger is purely heap-growth based (`GOGC=100`, GC when heap doubles since last live). It has no awareness of "I am running in a 1 GB container." Sequence of events without `GOMEMLIMIT`:

1. Heap grows to 600 MB.
2. Working set lives there for a while.
3. A burst happens. Heap grows to 1100 MB before next GC trigger.
4. Kernel OOM kills the process.

With `GOMEMLIMIT=900MiB`:

1. Heap grows to 600 MB.
2. As live + stacks approach 900 MB, GC frequency rises.
3. The runtime may GC every few allocations to stay under the limit.
4. Throughput degrades but the process survives.

Net: `GOMEMLIMIT` trades CPU for memory in a controlled way.

### How to choose the value

- Set below the hard cap. A common heuristic is 90% of the container's memory limit, leaving headroom for stacks, runtime overhead, and burst.
- Subtract a guess for non-heap memory: goroutine stacks (~8 KB per active goroutine), runtime metadata, scratch space.
- If your workload's allocation rate is bursty, leave more headroom. If it is steady, you can be tighter.

```go
// In init() or main, before serving traffic.
func init() {
    const containerMem = 1024 << 20 // 1 GiB
    debug.SetMemoryLimit(int64(containerMem) * 9 / 10)
}
```

### Pathological case: GC death spiral

If `GOMEMLIMIT` is set too tight relative to working-set, the runtime enters a GC death spiral: it spends nearly all CPU running GC, throughput collapses, requests time out, the working set never shrinks. The runtime caps GC CPU usage at ~50% to mitigate this, but the symptom is still real.

Signs:

- `/cpu/classes/gc/total:cpu-seconds` rising sharply.
- `/gc/pauses:seconds` showing many small pauses.
- p99 latency spiking even though the program "is not OOM."

Fix: raise `GOMEMLIMIT` or reduce allocation rate.

### Disabling

`debug.SetMemoryLimit(math.MaxInt64)` removes the cap. Same as not setting it.

---

## GOGC and SetGCPercent

### What it does

`debug.SetGCPercent(p int)` sets the GC trigger ratio. With `GOGC=100` (the default), the GC starts when the new heap is 100% larger than the live heap at the end of the previous GC. `GOGC=50` triggers when heap grows by 50%; `GOGC=200` when it doubles plus once more.

Special values:

- `0`: invalid. Treated as `100`.
- `-1`: disables GC entirely. Used in `go test -bench` setups, never in production.

### CPU/memory tradeoff

| `GOGC` | Behaviour |
|---|---|
| 25 | Aggressive GC. Lower peak heap. ~2–4× more GC CPU. |
| 100 | Default. Heap roughly doubles between GCs. |
| 200 | Lazier GC. Higher peak heap. ~30% less GC CPU. |
| 500 | Very lazy. Useful when memory is cheap and CPU is the bottleneck. |
| off (-1) | No automatic GC. Memory grows unbounded. |

### Interaction with `GOMEMLIMIT`

When `GOMEMLIMIT` is set, the runtime uses *both* triggers: GC runs at `GOGC` ratio *or* when approaching the memory limit, whichever comes first. In practice, once you set `GOMEMLIMIT`, `GOGC` matters most when memory is abundant.

### When to tune

- Latency-sensitive service with abundant memory: raise `GOGC` to 200 or 300 to reduce GC frequency.
- Memory-tight service: lower `GOGC` to 50 to keep heap smaller.
- Throughput-focused batch job: leave at 100.

Always measure before and after with `runtime/metrics` or `pprof`.

---

## SetMaxStack and SetMaxThreads as Safety Nets

### `SetMaxStack`

```go
debug.SetMaxStack(64 << 20) // 64 MB per goroutine
```

Default: 1 GB on 64-bit platforms. Hitting the cap crashes the goroutine (and the program if not recovered) with `runtime: goroutine stack exceeds N-byte limit`.

Reasons to lower:

- Catch infinite recursion faster (1 MB is plenty for normal code).
- Container with limited memory — a single runaway goroutine eating 1 GB is wasteful.
- Compliance / testing environments where stack-overflow detection should be early.

Reasons to raise: very deep recursive algorithms (you should usually iterativise instead).

### `SetMaxThreads`

```go
debug.SetMaxThreads(2000)
```

Default: 10 000. The runtime calls `exit(1)` when this is exceeded, *not* a panic. There is no recovery.

Reasons to lower:

- Defend against cgo-induced thread explosions. A cgo call holds an M; many concurrent cgo calls create many Ms.
- Crash on bug rather than thrash the host.
- Make thread limits explicit in capacity planning.

Reasons to keep the default: most pure-Go workloads never approach it.

### Putting them together

```go
func init() {
    debug.SetMaxStack(8 << 20)   // 8 MB; catch runaway recursion early
    debug.SetMaxThreads(2000)    // crash if cgo storms
}
```

Add a comment explaining why these are set. Future readers will not know.

---

## Stack Trace Discipline

### When to call which

| API | When to use |
|---|---|
| `debug.Stack()` | In a panic handler. Returns current goroutine. |
| `debug.PrintStack()` | Quick local debug. Writes to stderr. |
| `runtime.Stack(buf, false)` | Same as `debug.Stack` but with a caller-supplied buffer. |
| `runtime.Stack(buf, true)` | "Show me everything." Stops the world. |
| `SIGQUIT` (kill -3) | Built-in: triggers `runtime.Stack(_, true)` and exits. |
| `pprof.Lookup("goroutine").WriteTo(w, n)` | Structured dump via pprof. Does not stop the world for long. |

### The `pprof.Lookup` alternative

```go
import "runtime/pprof"

func dump(w io.Writer) error {
    return pprof.Lookup("goroutine").WriteTo(w, 2)
}
```

`debug` verbosity:

- `0`: protobuf format (for `go tool pprof`).
- `1`: human-readable, counts only.
- `2`: human-readable, full stacks (like `kill -3`).

`pprof`'s dump is less disruptive than `runtime.Stack(_, true)` because it can be sampled — but for "every goroutine, full stack" the cost is similar.

### Production endpoint

```go
mux.HandleFunc("/debug/stacks", func(w http.ResponseWriter, r *http.Request) {
    pprof.Lookup("goroutine").WriteTo(w, 2)
})
```

Behind authentication. Always.

### Buffer sizing for `runtime.Stack`

Naive code uses a 64 KB buffer and silently truncates. Correct pattern:

```go
func allStacks() []byte {
    n := 64 << 10
    for {
        buf := make([]byte, n)
        got := runtime.Stack(buf, true)
        if got < n {
            return buf[:got]
        }
        n *= 2
        if n > 64<<20 {
            return buf // give up; 64 MB of stacks is already absurd
        }
    }
}
```

A server with 50 000 goroutines may need several MB of buffer. Do not hardcode a single size.

---

## LockOSThread Patterns

Full coverage: [02-vs-os-threads](../02-vs-os-threads/). Summary at middle level:

### Use cases

- Calling C libraries that use TLS (OpenGL, GTK, some OpenSSL paths).
- Setting a signal mask on the current thread.
- Setting CPU affinity on the current thread.
- Setting Linux capabilities or namespaces (these are thread-local on Linux).

### Reference-counting since Go 1.10

```go
runtime.LockOSThread()    // count = 1
runtime.LockOSThread()    // count = 2
runtime.UnlockOSThread()  // count = 1
runtime.UnlockOSThread()  // count = 0; goroutine unpinned
```

Mismatch (more Unlocks than Locks) panics.

### Idiom: lock-as-init

```go
func initOpenGLThread() {
    runtime.LockOSThread()
    C.gladLoadGL()
    // never UnlockOSThread; this goroutine is the GL thread for life
}
```

Goroutine that exits while locked → its OS thread is destroyed. Safety net: prevents leaked thread-local state.

### Anti-pattern: lock for performance

A common bad idea: "if I lock to a thread, my goroutine will be faster because no migration." False. The Go scheduler's migration cost is sub-microsecond; the L1 cache penalty is usually less than the cost of waiting for the thread to be free.

---

## Adopting runtime/metrics

### Why over `MemStats`

`runtime.ReadMemStats` returns a 30-field struct of mostly memory data. It stops the world briefly. `runtime/metrics`:

- Stops nothing (most metrics are continuously updated by the runtime).
- Typed (`KindFloat64`, `KindUint64`, `KindFloat64Histogram`).
- Versioned: stable names like `/sched/goroutines:goroutines`.
- Includes scheduler latencies and GC pause histograms that `MemStats` lacks.

### Reading

```go
import "runtime/metrics"

var (
    goroutines metrics.Sample
    heapBytes  metrics.Sample
    gcCPU      metrics.Sample
    schedLat   metrics.Sample
)

func init() {
    goroutines.Name = "/sched/goroutines:goroutines"
    heapBytes.Name  = "/memory/classes/heap/objects:bytes"
    gcCPU.Name      = "/cpu/classes/gc/total:cpu-seconds"
    schedLat.Name   = "/sched/latencies:seconds"
}

func scrape() {
    samples := []metrics.Sample{goroutines, heapBytes, gcCPU, schedLat}
    metrics.Read(samples)
    for _, s := range samples {
        switch s.Value.Kind() {
        case metrics.KindUint64:
            log.Printf("%s = %d", s.Name, s.Value.Uint64())
        case metrics.KindFloat64:
            log.Printf("%s = %f", s.Name, s.Value.Float64())
        case metrics.KindFloat64Histogram:
            h := s.Value.Float64Histogram()
            log.Printf("%s p99 = %f", s.Name, percentile(h, 0.99))
        }
    }
}
```

### Useful metric names

| Name | Meaning |
|---|---|
| `/sched/goroutines:goroutines` | Live goroutine count (cheaper than `NumGoroutine`). |
| `/sched/latencies:seconds` | Histogram of "time goroutine was runnable but not running." |
| `/memory/classes/heap/objects:bytes` | Live heap allocations. |
| `/memory/classes/heap/free:bytes` | Free space in heap not yet returned to OS. |
| `/memory/classes/total:bytes` | All memory the runtime tracks. |
| `/gc/heap/allocs:bytes` | Cumulative bytes allocated (total). |
| `/gc/pauses:seconds` | Histogram of GC stop-the-world pause durations. |
| `/gc/cycles/total:gc-cycles` | Number of completed GC cycles. |
| `/cpu/classes/gc/total:cpu-seconds` | CPU spent in GC. |
| `/cpu/classes/scavenge/total:cpu-seconds` | CPU spent returning memory to OS. |

Full list: `metrics.All()`.

### Histograms

`KindFloat64Histogram` gives you `Counts []uint64` and `Buckets []float64`. You sum counts to get totals, walk buckets to compute percentiles. Helper:

```go
func percentile(h *metrics.Float64Histogram, p float64) float64 {
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    target := uint64(float64(total) * p)
    var sum uint64
    for i, c := range h.Counts {
        sum += c
        if sum >= target {
            return h.Buckets[i+1]
        }
    }
    return h.Buckets[len(h.Buckets)-1]
}
```

### Prometheus integration

Use `prometheus/collectors.NewGoCollector(collectors.WithGoCollections(collectors.GoRuntimeMetricsCollection))`. It exposes the entire `runtime/metrics` catalog as Prometheus metrics with `go_` prefix. One line of setup, dozens of free dashboards.

---

## Profile and Trace Sampling Rates

### Mutex profile

```go
runtime.SetMutexProfileFraction(5) // sample 1/5 contention events
```

`0` = disabled (default). `1` = every event (high overhead). `5` = 20% sampling, recommended for production.

Read with `pprof.Lookup("mutex").WriteTo(w, 0)`.

### Block profile

```go
runtime.SetBlockProfileFraction(10000) // sample blockings >= 10 µs
```

Argument is the *rate* at which a blocking event is recorded, sampled by total blocked nanoseconds. `0` disables; `1` records every event (high overhead); `10000` records ~one event per 10 µs of blocking time.

Read with `pprof.Lookup("block").WriteTo(w, 0)`.

### Both default off

These profiles are *opt-in* because they add overhead per channel-op / mutex-op. Turn them on for a few minutes during an investigation, then turn them back off.

### Goroutine profile

Always on. Read with `pprof.Lookup("goroutine").WriteTo(w, 0)`. Gives a profile of goroutine *creation* sites and their counts — perfect for leak hunts.

### Heap profile

Always on. `pprof.Lookup("heap").WriteTo(w, 0)`. Reports current and total allocations.

### `runtime/trace`

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
// run workload
trace.Stop()
f.Close()
```

Then `go tool trace trace.out` opens an interactive UI showing every goroutine state transition, every GC event, every syscall. Heaviest profiling tool Go has. Run for a few seconds at most.

Production tip: expose via HTTP for on-demand capture, behind authentication.

```go
mux.HandleFunc("/debug/trace", func(w http.ResponseWriter, r *http.Request) {
    sec, _ := strconv.Atoi(r.URL.Query().Get("seconds"))
    if sec <= 0 { sec = 5 }
    trace.Start(w)
    time.Sleep(time.Duration(sec) * time.Second)
    trace.Stop()
})
```

---

## GODEBUG Companion Knobs

Some runtime knobs are env-only, no API equivalent. Notable ones:

| `GODEBUG` setting | Effect |
|---|---|
| `gctrace=1` | Print one line per GC cycle to stderr. Cheap, informative. |
| `schedtrace=1000` | Every 1000 ms, print scheduler state (Ps, Ms, queues). |
| `scheddetail=1` | Combined with `schedtrace`, also print per-goroutine state. |
| `allocfreetrace=1` | Trace every allocation/free. Use only for tiny test programs. |
| `madvdontneed=1` | Use `MADV_DONTNEED` instead of `MADV_FREE` on Linux. Useful when working with monitoring tools that only see RSS. |
| `asyncpreemptoff=1` | Disable async preemption. Diagnostic only — your program may starve. |
| `cgocheck=2` | Heavy cgo argument checking. Slow but catches pointer-passing bugs. |
| `inittrace=1` | Print init function timing. |
| `panicnil=1` | Allow `panic(nil)` (legacy compat). |

You set them via env: `GODEBUG=gctrace=1,schedtrace=1000 ./server`.

---

## Common Anti-Patterns

### Anti-pattern: `runtime.Gosched` in hot loops

```go
// WRONG
for i := 0; i < 1e6; i++ {
    work()
    runtime.Gosched()
}
```

Adds a scheduler entry per iteration. Async preemption already interrupts after ~10 ms; manual yields just add overhead. Remove them.

### Anti-pattern: manual `runtime.GC()` calls

```go
// WRONG
func handleRequest(req Request) Response {
    runtime.GC() // "clean up before responding"
    return process(req)
}
```

A 5–50 ms forced pause per request, with no long-term memory improvement. The runtime would have GC'd at a better moment.

The legitimate uses of `runtime.GC()`:

- Microbenchmarks: force a clean baseline before measurement.
- Tests that check finalizer behaviour.
- After known massive deallocations in a startup hook, *if* you can prove it reduces future GC pressure.

### Anti-pattern: `runtime.GOMAXPROCS` in a library

```go
// WRONG: library code
func init() {
    runtime.GOMAXPROCS(4)
}
```

A library has no business setting a process-global tunable. The application controls `GOMAXPROCS`; a library cannot know how many cores are available for its share.

### Anti-pattern: `SetMaxThreads(N)` "to limit thread usage"

`SetMaxThreads` is a kill-switch. Hitting it terminates the program. Use it for safety nets, not as a normal-operations limit. If your service routinely needs more threads, raise the limit, don't set it tight.

### Anti-pattern: finalizers for resource cleanup

```go
// WRONG
type FileWrapper struct{ f *os.File }

func NewFileWrapper(path string) *FileWrapper {
    f, _ := os.Open(path)
    fw := &FileWrapper{f: f}
    runtime.SetFinalizer(fw, func(fw *FileWrapper) { fw.f.Close() })
    return fw
}
```

The file may stay open arbitrarily long. Use explicit `Close()` with `defer`. Reserve finalizers for the standard library's last-resort safety net pattern (and even there, the std lib is moving away from them).

### Anti-pattern: `LockOSThread` for "performance"

Locking does not improve cache locality enough to matter for typical Go code. It does block scheduler migration, which can *hurt* throughput in mixed workloads. Lock only when there is a thread-affine API (TLS, signals) that requires it.

---

## Diagnostics Playbook

### "My goroutine count is rising"

1. Run `pprof.Lookup("goroutine").WriteTo(w, 1)` to get a count-by-creation-site dump.
2. Identify the call site with the highest count. That is your leak.
3. Check: does the goroutine block on a channel that is never closed? On a `context.Context` that is never cancelled? On a network read with no timeout?
4. Fix the exit condition. Run again. Count should plateau.

### "My memory is rising"

1. Capture two heap profiles 60 seconds apart: `go tool pprof http://host/debug/pprof/heap`.
2. Compare with `top -diff_base`: which allocation site grew?
3. Distinguish: more *live* objects vs slower GC.
4. Inspect `/memory/classes/heap/free:bytes` — if huge, the runtime is just not releasing to OS yet. Set `GOMEMLIMIT` or wait for the scavenger.

### "My latency p99 is bad"

1. Read `/sched/latencies:seconds` histogram. If p99 is > 1 ms, the scheduler is overloaded — too many runnable goroutines.
2. Read `/gc/pauses:seconds`. High p99 = stop-the-world pauses too long.
3. Read `/cpu/classes/gc/total:cpu-seconds` over time. If GC is consuming > 20% CPU, GC is over-pressured.
4. Possible fixes: raise `GOMEMLIMIT`, raise `GOGC`, reduce allocation rate via pooling.

### "My service was OOM-killed"

1. Did you set `GOMEMLIMIT`? If no, set it.
2. If yes, check the container's actual memory at kill time: was the limit reasonable?
3. Look at `/memory/classes/heap/objects:bytes` over time. Was there a sustained climb or a burst?
4. If burst: investigate the request that caused it. Consider per-request memory budgets.

### "My program is stuck"

1. `kill -SIGQUIT <pid>` to dump every goroutine's stack. Capture in logs.
2. Look for `runtime.gopark` and `chan send`/`chan receive` patterns — common deadlock signature.
3. Look for `runtime.semacquire` — mutex deadlock.
4. Cross-reference goroutine creation sites: which call introduced the deadlock?

### "Sudden thread spike"

1. Check `pid`'s thread count: `cat /proc/<pid>/status | grep Threads`.
2. Is the spike correlated with a cgo call site? Each cgo call holds an M.
3. Is the spike correlated with a blocking syscall on a non-net fd?
4. Mitigate: bound concurrency for the cgo call, or use the netpoller-eligible API.

---

## Self-Assessment

- [ ] I can choose `GOMAXPROCS` for a Kubernetes pod and justify the number.
- [ ] I have set `GOMEMLIMIT` in at least one production service and verified it prevents OOM.
- [ ] I can read a `/sched/latencies:seconds` histogram and explain what it tells me.
- [ ] I have wired `runtime/metrics` into Prometheus.
- [ ] I know which goroutine and heap profiles are on by default and which require `SetMutexProfileFraction`/`SetBlockProfileFraction`.
- [ ] I can take a `runtime/trace` snapshot from a running service.
- [ ] I know `runtime.Gosched` and `runtime.GC` are anti-patterns in production code.
- [ ] I have an HTTP endpoint that dumps all goroutine stacks, behind authentication.
- [ ] I can explain why `LockOSThread` is rare and what its lock count means.
- [ ] I can dump and read a goroutine count by creation site.

---

## Summary

At middle level the runtime API moves from curiosity to discipline. Three rules cover most production scenarios:

1. **Set `GOMAXPROCS` and `GOMEMLIMIT` for your environment.** Containers in particular cannot rely on defaults until Go 1.25+.
2. **Read, do not write, the diagnostic surface.** `NumGoroutine`, `runtime/metrics`, `pprof.Lookup` should be in every dashboard. `GC`, `Gosched`, `Goexit` should be in almost no business code.
3. **Make profiling part of the deployment.** `net/http/pprof` endpoint, mutex/block fractions tuned, `pprof.Do` wrapping handlers, `SIGQUIT` working.

The senior file goes deeper into labels, request-scoped profiling, and `runtime/trace` analysis. The professional file explains how each of these knobs is wired into the runtime internals.
