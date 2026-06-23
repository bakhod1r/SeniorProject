# Runtime Hooks — Optimize

## 1. The optimization mindset

Tuning the runtime is the *last* lever you pull. Before reaching for `GOGC`, `GOMEMLIMIT`, or `GOMAXPROCS`, exhaust:

1. Allocation reduction (pools, preallocation, escape avoidance).
2. Algorithmic improvements (better data structures, fewer copies).
3. Code-level fixes (zero-alloc parsing, generics over interfaces).

When you have done that and a profile still shows GC or scheduler cost dominating, the knobs become useful. This page is the decision matrix for which knob to turn, and the costs of each.

---

## 2. The four numbers that gate every tuning decision

| Signal | Source | Question it answers |
|--------|--------|---------------------|
| GC CPU fraction | `/cpu/classes/gc/total:cpu-seconds` (rate) | Am I allocation-bound? |
| Live heap | `/gc/heap/live:bytes` | Is memory the bottleneck? |
| Goroutines | `/sched/goroutines:goroutines` | Am I leaking? |
| Scheduler latency p99 | `/sched/latencies:seconds` (histogram) | Is preemption suffering? |

The combinations:

- High GC CPU + flat live heap → allocation rate; profile `-alloc_objects`, fix code.
- High GC CPU + climbing live heap → real growth or leak; capture heap profile diffs.
- Low GC CPU + high scheduler latency → CPU starvation or GOMAXPROCS misconfig.
- High goroutines + flat heap → goroutine leak hidden behind closures.

Only after you know which quadrant you're in do you pick a knob.

---

## 3. `GOGC`: when raising it helps

The default `GOGC=100` GCs when the heap doubles. Raising it cuts GC frequency at the cost of RSS.

```bash
GOGC=200 ./server    # GC at 3× live instead of 2×
```

Mathematical model: roughly, GC cost per byte allocated is proportional to `1/GOGC`. Doubling `GOGC` halves total GC CPU. The memory cost is symmetric: RSS proportional to `(1+GOGC/100) × live`.

Raise it when:

- Profile shows GC CPU > 10% sustained.
- Live heap is small relative to your memory budget (e.g., 200 MiB live with 2 GiB available).
- The workload is allocation-heavy but the working set is small.

Don't raise it when:

- The platform's memory limit is the binding constraint. Use `GOMEMLIMIT` instead.
- GC CPU is already < 5% — you're optimizing noise.

---

## 4. `GOMEMLIMIT`: the right cap

`GOMEMLIMIT` is the right setting for production containers because it expresses what the platform actually enforces — a memory ceiling.

```bash
GOMEMLIMIT=900MiB ./server
```

Combining with `GOGC=off` (Go 1.19+) is the **memory-bounded** pattern: no ratio-based GC; the runtime collects only when memory pressure rises toward the cap. This dramatically reduces GC CPU for spiky workloads but produces longer, less frequent pauses.

Suggested progression:

1. Start with `GOMEMLIMIT=90% of container limit, GOGC=100` (default ratio, soft cap).
2. If GC CPU is high and you have memory headroom, raise `GOGC` to `200`, `300`.
3. If GC CPU is *still* high and the workload is spiky, try `GOGC=off` with `GOMEMLIMIT`.
4. If you frequently hit the cap (GC death spiral), the answer is fewer allocations or more memory — not knob tuning.

---

## 5. `GOMAXPROCS`: usually leave it alone

The runtime sets `GOMAXPROCS = NumCPU()` automatically. From Go 1.25, this honors cgroup CPU quotas; before that you need `automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

Override only for:

- **Single-threaded execution** for determinism in tests (`GOMAXPROCS=1`).
- **CPU-throttled environments** where the cgroup quota is fractional (the lib rounds up to ≥1).
- **NUMA-aware deployments** where you pin one process per NUMA node.

Setting it lower than `NumCPU()` to "leave room" for sidecars almost never helps — the OS already schedules across containers. Setting it higher than `NumCPU()` is essentially never correct; it adds context switches without parallelism.

---

## 6. When `FreeOSMemory` is appropriate

```go
import "runtime/debug"

// At the end of a batch stage:
processBigBatch()
debug.FreeOSMemory()
```

`FreeOSMemory` forces a GC and advises the OS that idle pages are reclaimable. Costs: one full GC cycle (sub-millisecond pauses but real wall time) and immediate page-table churn.

Use it:

- After a one-shot ingestion in a batch process.
- Before a known idle period in a service (cron-style maintenance).
- In tests, to get clean state between cases.

Do not use it:

- On every request or every loop iteration.
- As a remedy for a real leak — it doesn't help.
- In code paths sensitive to latency.

The `GOMEMLIMIT` pacer does most of what people use `FreeOSMemory` for, more smoothly.

---

## 7. Avoiding `runtime.GC()` in services

`runtime.GC()` is a blocking call. The mark phase runs concurrently, but the sweep phase and the two STW phases (mark setup, mark termination) block the caller. In a service, calling it periodically:

- Adds blocking time the pacer would otherwise have hidden.
- Defeats the pacer's heap-rate feedback model.
- Looks busy on the GC dashboard without doing useful work.

The only legitimate `runtime.GC()` calls in production code:

1. Right before `pprof.WriteHeapProfile` to get a clean snapshot.
2. In a test setup function.

Everything else — periodic GC, "force collection after heavy operation" — is the wrong tool. Use `SetGCPercent`, `SetMemoryLimit`, or fix allocations.

---

## 8. `MemStats` vs `runtime/metrics` for monitoring

```go
// Costly — STW snapshot on every scrape:
var m runtime.MemStats
runtime.ReadMemStats(&m)
exportMetrics(&m)
```

```go
// Cheap — lock-free read:
samples := []metrics.Sample{
    {Name: "/memory/classes/heap/objects:bytes"},
    {Name: "/gc/cycles/automatic:gc-cycles"},
    {Name: "/sched/goroutines:goroutines"},
}
metrics.Read(samples)
```

`ReadMemStats` briefly stops the world. On a high-throughput service scraped every 10 seconds, that's a measurable tail-latency cost. `runtime/metrics` does not stop the world — the runtime maintains the counters continuously.

If your code (or library) calls `ReadMemStats` from a metrics handler, migrate it. The Prometheus collector with `GoRuntimeMetricsCollection` does this for you.

---

## 9. `MemProfileRate` and `BlockProfileRate` tuning

```go
runtime.MemProfileRate = 512 * 1024  // default
```

The heap profile samples one allocation per `MemProfileRate` bytes. Default 512 KiB is a good production setting — sufficient resolution, near-zero overhead. Two adjustments:

- For tests where you need precise counts: `MemProfileRate = 1` (record every allocation).
- For very-low-allocation services where you want better resolution: `MemProfileRate = 16 * 1024`.

Setting it lower in production costs CPU and pollutes profiles with the profiler itself. The block and mutex profile fractions follow the same logic:

```go
runtime.SetBlockProfileRate(100_000)        // sample 1 in 100µs blocks
runtime.SetMutexProfileFraction(100)        // sample 1 in 100 contended unlocks
```

Off (0) is the production default. Turn them on briefly during contention investigations.

---

## 10. Cost of `gctrace=1`

`GODEBUG=gctrace=1` writes one line per GC cycle to stderr. Sounds harmless, but:

- Each line is ~150 bytes; under high GC frequency that's several KB/s of stderr writes.
- If stderr is unbuffered (typical for containers), every line is a write syscall.
- Logs systems may rate-limit, dropping useful operational lines.

For long-running services, prefer the `runtime/metrics` histograms (`/gc/pauses:seconds`) over `gctrace`. Use `gctrace=1` for a focused window — capture 5 minutes during an incident, then turn it off.

---

## 11. CPU profile sampling rate

```go
runtime.SetCPUProfileRate(250) // 250 Hz instead of default 100
```

Default 100 Hz means a sample every 10 ms. For functions running 1% of the time, 100 Hz catches ~1 sample per second — enough to rank them but not to characterize them. Raising to 250 Hz (4 ms) costs more profiler overhead but gives finer detail on short-lived hot paths.

Don't go above 1000 Hz; the timer signal overhead dominates and the profile becomes self-distorting.

Practical defaults:

- Production CPU profile via `/debug/pprof/profile?seconds=30`: keep 100 Hz.
- Microbenchmarks where you want function-level resolution: 1000 Hz.

---

## 12. Stack growth costs and `SetMaxStack`

Stack growth costs `O(stack size)` — every pointer in every frame must be rewritten. A goroutine that grows from 2 KiB to 1 MiB through gradual recursion will have copied its stack 9 times (each doubling).

```go
// Probably wrong:
debug.SetMaxStack(100 << 20) // 100 MiB ceiling

// Probably better:
// Restructure the algorithm to not recurse 100k frames deep.
```

`SetMaxStack` doesn't pre-grow the stack; it just sets a panic threshold. To pre-grow, you have to actually run frames that deep, which is rarely worth it.

If you find a profile dominated by `runtime.morestack` or `runtime.copystack`, the fix is usually iterative rewriting of a recursive algorithm, not a knob change.

---

## 13. `LockOSThread` and scheduler hostility

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
```

A locked goroutine prevents the underlying thread from running anything else. With `GOMAXPROCS=N`, locking M threads leaves only `N-M` for the rest of your program. Three patterns become slow:

- Pinning a goroutine for a long-running computation that doesn't need it.
- Forgetting to call `UnlockOSThread` (the lock leaks until goroutine exit).
- Locking inside a loop, expecting it to be cheap (each call grows the lock count).

If a profile shows few P's actually doing useful Go work but no apparent contention, search for `LockOSThread` calls. The fix is almost always to remove the lock and use a different synchronization primitive.

---

## 14. Allocator hints with `make(..., capacity)`

This is not technically a runtime hook, but it interacts directly with the same systems:

```go
// Bad: log2(N) reallocations, 2× total throwaway memory
var out []int
for _, p := range parts {
    out = append(out, p...)
}

// Good: one allocation, exact size
total := 0
for _, p := range parts { total += len(p) }
out := make([]int, 0, total)
for _, p := range parts {
    out = append(out, p...)
}
```

For maps: `make(map[K]V, n)` pre-sizes the bucket array. For channels: `make(chan T, n)` pre-allocates the ring buffer. Pre-sizing reduces GC pressure proportionally to the size of the data — and the GC's pacer responds by collecting less often, which compounds the win.

---

## 15. The "should I tune?" checklist

Before you turn any knob, write down:

1. Which of the four signals (GC CPU, live heap, goroutines, scheduler latency) is anomalous?
2. What is the baseline measurement?
3. What knob do you intend to change, and what is the theoretical effect?
4. What measurement will tell you it worked?
5. What measurement will tell you it broke something else?

If you can't answer all five, the knob is the wrong fix. Almost every "I tuned GOGC and it got faster" anecdote is followed three months later by "we ran out of memory in production". Tuning without measurement is just rolling dice.

---

## 16. Summary

Runtime hook optimization is a structured activity: identify the bottleneck signal, choose the knob that targets it, measure before and after, watch for second-order effects. `GOMEMLIMIT` for memory budgets, `GOGC` for allocation-bound services with memory headroom, `runtime/metrics` instead of `ReadMemStats`, `FreeOSMemory` only after batch stages, `runtime.GC()` only in tests. Most "performance" improvements come from allocating less; the knobs help around the edges.

---

## Further reading
- GC guide (knobs section): https://go.dev/doc/gc-guide#GOGC
- Pacer redesign: https://github.com/golang/proposal/blob/master/design/44167-gc-pacer-redesign.md
- `automaxprocs`: https://github.com/uber-go/automaxprocs
- Profile-Guided Optimization: https://go.dev/doc/pgo
- Performance dashboards: https://perf.golang.org/
