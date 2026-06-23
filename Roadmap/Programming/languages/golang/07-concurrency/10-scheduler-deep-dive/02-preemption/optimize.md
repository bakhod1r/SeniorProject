# Goroutine Preemption — Optimization Guide

How to tune Go programs in the presence of preemption. The default settings are good for almost everyone; this document is for the cases where they are not.

---

## Optimization 1 — Trust the defaults

Before tuning anything, run with default `GOMAXPROCS`, default `GODEBUG`, default Go version. Measure p50, p99, p999 latency. In the vast majority of services, async preemption works invisibly and well. Tuning prematurely loses time and may regress.

The single most important "optimisation": **stay on a recent Go**. Each release improves the runtime; 1.14 introduced async preemption, 1.17 reworked the ABI to reduce its cost, 1.19 improved cgo handoff, 1.21 fine-tuned sysmon. A program on Go 1.21+ does almost everything right.

---

## Optimization 2 — Avoid function-call-free hot loops

Even though async preemption can interrupt them, *cooperative* preemption is cheaper (no signal). If you can introduce a tiny helper call into a hot loop without changing semantics, you give the runtime a free preemption point.

```go
// Slightly slower preemption response
for i := 0; i < N; i++ {
    sum += data[i] * data[i]
}

// Faster preemption response (negligible runtime cost)
for i := 0; i < N; i++ {
    sum += square(data[i])
}

func square(x float64) float64 { return x * x }
```

The compiler may inline `square` (defeating the purpose). To prevent inlining, mark it `//go:noinline`. But: most code does not need this. Only do it if profiling shows preemption-latency tails.

---

## Optimization 3 — Chunk large computations

A long-running computation that needs to be responsive to cancellation should be chunked.

```go
const chunk = 1024
for i := 0; i < N; i += chunk {
    end := min(i+chunk, N)
    for j := i; j < end; j++ {
        sum += data[j]
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
}
```

The outer loop's `select` is a function call (compiled into runtime helpers), so cooperative preemption fires there. The chunk size trades CPU efficiency against cancellation latency. 1024 is a good starting point for arithmetic.

---

## Optimization 4 — Honour `GOMAXPROCS` in containerised environments

Go 1.5–1.18 set `GOMAXPROCS` based on the OS's CPU count, ignoring cgroup limits. A container limited to 0.5 CPUs but running on a 64-core host would see `GOMAXPROCS=64`, leading to extreme preemption pressure.

Go 1.19+ auto-detects cgroup limits. If you are on older Go or special platforms, use `uber-go/automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

The library reads `/sys/fs/cgroup` and sets `GOMAXPROCS` correctly at init time.

---

## Optimization 5 — Spread CPU-bound work across goroutines, not iterations

If you have N CPU-bound items to process and want to use M cores, do not write one big loop and a `WaitGroup` over channels. Spawn M goroutines and split the data.

```go
// Less ideal: preemption rotates through one giant loop
for i := 0; i < N; i++ {
    process(items[i])
}

// Better: M goroutines, each runs without rotation
var wg sync.WaitGroup
for w := 0; w < M; w++ {
    wg.Add(1)
    go func(w int) {
        defer wg.Done()
        for i := w; i < N; i += M {
            process(items[i])
        }
    }(w)
}
wg.Wait()
```

The runtime parallelises across Ps; each goroutine runs without preemption pressure if `M <= GOMAXPROCS`.

---

## Optimization 6 — Reduce cgo crossings

Each cgo call is a non-preemptible region. If you have many short cgo calls, batch them.

```go
// 1000 cgo crossings
for _, x := range data {
    C.process(C.int(x))
}

// 1 cgo crossing
arr := make([]C.int, len(data))
for i, x := range data {
    arr[i] = C.int(x)
}
C.process_batch(&arr[0], C.int(len(arr)))
```

Each crossing costs ~200 ns plus the non-preemption window. Batching wins on both axes.

---

## Optimization 7 — Avoid `runtime.LockOSThread` unless necessary

Every locked goroutine pins an M. Pinned Ms cost memory (1–8 MB stack each) and reduce the runtime's flexibility. Preemption still works on locked goroutines but the M cannot be reused. Audit your use of `LockOSThread`; remove what you can.

Common (legitimate) uses: OpenGL, X11, certain `syscall` interactions that require a specific TID (e.g., `prctl`), some cgo libraries.

---

## Optimization 8 — Profile preemption itself

Use `pprof`:

```go
import _ "net/http/pprof"
```

Then:

```
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
(pprof) top10
(pprof) list runtime.asyncPreempt
```

If `asyncPreempt` shows up at > 1 % of CPU, you have unusually frequent preemption. Causes:
- `GOMAXPROCS` too low for the workload.
- Many short-lived goroutines competing.
- Tight loops that never reach cooperative checkpoints.

The fix depends on the cause: raise `GOMAXPROCS`, pool goroutines, or add cooperative checkpoints.

---

## Optimization 9 — Tune for GC pause sensitivity

Programs with hard latency SLOs benefit from:

1. Keeping async preemption enabled (the default).
2. Avoiding long write-barrier-heavy loops (use slice-of-values rather than slice-of-pointers where possible).
3. Avoiding long cgo calls during GC-sensitive paths.
4. Setting `GOGC` thoughtfully: too low triggers GC often; too high lets the heap grow.

`debug.SetGCPercent(50)` is a reasonable starting point for latency-sensitive services.

---

## Optimization 10 — Use `runtime.Gosched` sparingly and correctly

In modern Go, `runtime.Gosched` is rarely needed. The few legitimate cases:

- A custom spinlock under contention.
- A producer in a tight loop wanting to deprioritise itself relative to consumers.
- An optimistic retry loop where the alternative is to spin uselessly.

Never use `Gosched` "to help the scheduler." The scheduler does not need help.

If you must spin, the canonical pattern:

```go
spins := 0
for !condition() {
    spins++
    if spins%64 == 0 {
        runtime.Gosched()
    }
}
```

The `64` is a heuristic. Higher values reduce yield overhead at the cost of latency.

---

## Optimization 11 — Use `runtime/trace` to validate

After any tuning, capture a trace and compare. Look for:

- **Fewer `GoPreempt` events** — your changes reduced preemption pressure.
- **Reduced "schedule" durations** — Ps are busy with real work.
- **Even distribution across Ps** — work-stealing is functioning.
- **No long `Syscall` regions** — cgo and blocking syscalls are short.

A trace is the ground truth. Without it, you are guessing.

---

## Optimization 12 — Pin to a specific Go version in production

Preemption behaviour changes subtly between minor versions. If your performance budget is tight, test against the exact Go version you ship. Do not blindly upgrade in production without re-benchmarking. The Go team is very careful, but micro-regressions occur.

Pinning is also useful for reproducible bug reports: "on Go 1.21.5 we see X" is easier to triage than "on Go".

---

## Optimization 13 — When `asyncpreemptoff=1` is actually useful

It is *not* a production optimisation. It is a *debugging* tool.

Set it when:
- Investigating a signal-handling bug in a third-party C library.
- Reproducing a pre-1.14 behaviour for testing.
- Measuring the cost of async preemption (run twice, compare).

Never set it in production. Pathological loops will hang the GC.

---

## Optimization 14 — Profile before each change

The advice in this document is *defaults*. Your workload is *specific*. The single most effective optimisation is:

1. Measure.
2. Hypothesise.
3. Change one thing.
4. Measure again.
5. Keep the change if it helped; revert otherwise.

A profile-driven tuning loop will beat any cookbook.

---

## Optimization 15 — Know when to stop

If your p99 latency is 1 ms and your SLO is 10 ms, do not touch preemption. The default is good enough. Spend your time on code that calls system-level resources slowly, on poorly chosen data structures, on JSON parsing — not on the runtime's micro-tuning. Most Go programs leave 100x more performance on the table elsewhere.

---

## Summary checklist

- [ ] I am on Go 1.20+.
- [ ] `GOMAXPROCS` is set correctly (cgroup-aware in containers).
- [ ] I have measured p50/p99/p999 latency with realistic load.
- [ ] I have captured at least one `runtime/trace` of a representative workload.
- [ ] My hot loops have either short bodies or include a function call.
- [ ] My cgo calls are short, or batched.
- [ ] I have audited `LockOSThread` usage.
- [ ] I do not set `GODEBUG=asyncpreemptoff=1` in production.
- [ ] I have a way to tell when async preemption is the bottleneck (`pprof` of `asyncPreempt`).
- [ ] I have re-measured after every change.
