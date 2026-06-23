# Work Stealing — Optimisation

## Table of Contents
1. [Introduction](#introduction)
2. [Measure First](#measure-first)
3. [Optimisation 1: Reduce Goroutine Churn](#optimisation-1-reduce-goroutine-churn)
4. [Optimisation 2: Avoid `LockOSThread`](#optimisation-2-avoid-lockosthread)
5. [Optimisation 3: Tune `GOMAXPROCS`](#optimisation-3-tune-gomaxprocs)
6. [Optimisation 4: Shard Hot Resources](#optimisation-4-shard-hot-resources)
7. [Optimisation 5: Cap cgo Concurrency](#optimisation-5-cap-cgo-concurrency)
8. [Optimisation 6: Batch Work](#optimisation-6-batch-work)
9. [Optimisation 7: Reduce GRQ Pressure](#optimisation-7-reduce-grq-pressure)
10. [Optimisation 8: Pin Hot Tasks Carefully](#optimisation-8-pin-hot-tasks-carefully)
11. [When Not to Optimise](#when-not-to-optimise)
12. [Summary](#summary)

---

## Introduction

The Go scheduler is well-tuned for general workloads. Most programs do not benefit from optimisation aimed at the scheduler — the gains are second-order. But when you have profiled and found scheduling overhead to be a bottleneck, this page provides the levers.

Targets where optimisation makes a measurable difference:

- High-throughput RPC servers (>100k QPS).
- Stream processors (Kafka, NATS) at high message rates.
- Tightly-coupled parallel algorithms (graph traversal, matrix ops).
- Latency-sensitive paths in trading or telemetry.

For typical web apps, batch jobs, and CLI tools, ignore this page. Write clear code.

---

## Measure First

Before optimising, confirm scheduling is the bottleneck.

### Profile CPU

```bash
go tool pprof -http=:8080 http://prod:6060/debug/pprof/profile?seconds=30
```

Look at the flame graph. If `runtime.findRunnable`, `runtime.runqsteal`, `runtime.gopark`, or `runtime.lock2` (the scheduler mutex) are >5% of total, scheduling is significant.

### Profile blocking

```bash
runtime.SetBlockProfileRate(10000)
go tool pprof http://prod:6060/debug/pprof/block
```

Shows where goroutines park. If most blocking is on channels or mutexes you control, the scheduler is doing its job — the bottleneck is your synchronisation.

### Trace

```bash
curl -o trace.out 'http://prod:6060/debug/pprof/trace?seconds=5'
go tool trace trace.out
```

Look at:
- "Procs" timeline. Are Ps utilised? Gaps mean idle.
- "Goroutines" view. How many runnable Gs over time? Spikes mean bursts; troughs mean starvation.
- The "Scheduler Latency" tab. Distribution of "time runnable but not running."

If scheduler latency p99 > 100 μs, you have a stealing/spinning issue.

### `GODEBUG=schedtrace=1000`

```
SCHED 1000ms: gomaxprocs=8 idleprocs=0 threads=15 spinningthreads=2
  runqueue=0
  P0: tickset=42... lrq=15 runnext=true gfree=1 sysmonticks=0
  ...
```

- `idleprocs > 0` with `runqueue > 0`: a P sat idle while GRQ had work. Sign of `wakep` failure (rare).
- `spinningthreads` high while `runqueue=0` and all LRQs are low: scheduler is hyperactive, possible runaway spinning.

---

## Optimisation 1: Reduce Goroutine Churn

### Problem

Each `go func()` costs ~200 ns (stack allocation, scheduling). Each completion involves the runtime. For very short tasks (~100 ns), the overhead dominates.

### Anti-pattern

```go
for _, item := range items {
    item := item
    go func() {
        defer wg.Done()
        tinyWork(item)
    }()
}
```

If `tinyWork` is 100 ns and `items` is 1M, total useful work is 100 ms but goroutine overhead is 200 ms. 3× slowdown.

### Fix

Batch:

```go
const batchSize = 100
batches := splitIntoBatches(items, batchSize)
for _, batch := range batches {
    batch := batch
    go func() {
        defer wg.Done()
        for _, item := range batch {
            tinyWork(item)
        }
    }()
}
```

Now there are 10,000 goroutines instead of 1M. Overhead is 2 ms; useful work is 100 ms. 50× improvement.

### Trade-off

Larger batches mean less granular load balancing. If `tinyWork` has highly variable cost, small batches steal-spread better. Profile both.

### Measurement

`go tool pprof` should show `runtime.newproc` and `runtime.goexit` drop dramatically. Throughput should rise.

---

## Optimisation 2: Avoid `LockOSThread`

### Problem

A locked G is unstealable. Its M sits idle when the G blocks. Equivalent to wasting one CPU.

### Anti-pattern

```go
func worker() {
    runtime.LockOSThread() // "for speed"
    defer runtime.UnlockOSThread()
    for req := range queue {
        process(req)
    }
}
```

This is *slower*, not faster, in 99% of cases.

### Fix

Just remove `LockOSThread`. The runtime will keep the G on the same M anyway for cache locality (unless stealing intervenes).

### Exception

`LockOSThread` is required for:
- cgo with thread-local state (e.g., OpenGL, MySQL client library).
- `seccomp`, `setns`, `prctl` calls.
- Signal handling that must run on a specific thread.

Use it then. Otherwise, never.

### Measurement

After removing `LockOSThread`, `GODEBUG=schedtrace` should show fewer "stuck" Ms; `idleprocs` should drop.

---

## Optimisation 3: Tune `GOMAXPROCS`

### Problem

Default `GOMAXPROCS = runtime.NumCPU()`. In containers, `NumCPU()` may return the host CPU count, not the container's quota.

### Fix

For containers: use `go.uber.org/automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

For oversubscribed systems (where you want to leave room for other processes): set explicitly:

```go
runtime.GOMAXPROCS(runtime.NumCPU() - 1)
```

For embarrassingly parallel work: set to `NumCPU() * 2`. Allows more concurrent syscall handling. Not a default — profile first.

### Trade-off

Higher `GOMAXPROCS`:
- More Ps, more potential parallelism.
- More stealing churn, more spinning Ms.
- More OS thread creation cost.

Lower `GOMAXPROCS`:
- Less stealing.
- Lower CPU utilisation if work is parallelisable.

The sweet spot is usually `physical CPUs`, occasionally `physical * 1.5` for I/O-heavy.

### Measurement

Benchmark across `GOMAXPROCS` values:

```bash
for n in 1 2 4 8 16; do
    GOMAXPROCS=$n ./myprogram --benchmark
done
```

Throughput typically plateaus at physical CPU count.

---

## Optimisation 4: Shard Hot Resources

### Problem

A single `sync.Mutex` or channel is the bottleneck. Goroutines stack up on its wait queue. Stealing finds them but they immediately re-park. CPU is high but progress is slow.

### Fix

Shard:

```go
type Counter struct {
    shards [64]struct {
        count atomic.Int64
        _     [8]uint64 // padding to avoid false sharing
    }
}

func (c *Counter) Add(n int64) {
    sid := runtime_procPin() // pseudo: get current P
    c.shards[sid % 64].count.Add(n)
    runtime_procUnpin()
}

func (c *Counter) Total() int64 {
    var sum int64
    for i := range c.shards {
        sum += c.shards[i].count.Load()
    }
    return sum
}
```

(Note: `runtime_procPin/Unpin` are internal; for user code use `sync.Pool` or random sharding.)

### Trade-off

- Read cost is O(shards), not O(1).
- Memory overhead per shard.
- Visible only when contention is genuine.

For a moderately contended counter, shard count = 16-64 is plenty.

### Measurement

`pprof` should show `runtime.lock2` drop. Throughput should rise.

---

## Optimisation 5: Cap cgo Concurrency

### Problem

Many simultaneous cgo calls spawn many Ms. Each M creation costs ~10 μs (clone(2)). M churn pollutes the scheduler.

### Fix

Semaphore-bounded cgo:

```go
var cgoSem = make(chan struct{}, runtime.NumCPU())

func cgoOp() {
    cgoSem <- struct{}{}
    defer func() { <-cgoSem }()
    C.heavy_function()
}
```

Now at most `NumCPU()` cgo calls in flight. M count stabilises.

### Trade-off

Throughput cap if your workload is highly cgo-parallel. Tune the semaphore size.

### Measurement

`GODEBUG=schedtrace`: `threads=` count should stabilise instead of growing unboundedly.

---

## Optimisation 6: Batch Work

### Problem

A producer creates one goroutine per item. Each item is tiny. Producer P's LRQ fills, overflows to GRQ. GRQ overflow path takes `sched.lock`. Latency spikes.

### Fix

Batch before spawning:

```go
const batch = 50
for i := 0; i < len(items); i += batch {
    end := i + batch
    if end > len(items) { end = len(items) }
    chunk := items[i:end]
    go func() {
        for _, item := range chunk {
            process(item)
        }
    }()
}
```

Reduces goroutine count by `batch`× and avoids LRQ overflow.

### Trade-off

Less granular load balancing. If `process` has variable cost, small batches steal-spread better.

### Measurement

`runtime/metrics` shows `/sched/goroutines:goroutines` counter. Batching should drop the peak.

---

## Optimisation 7: Reduce GRQ Pressure

### Problem

Many `time.AfterFunc` calls. Each callback enters the GRQ. `sched.lock` contention.

### Fix

Use a single timer with a heap of callbacks:

```go
type TimerPool struct {
    mu       sync.Mutex
    pending  []timerEntry
    cond     *sync.Cond
}

func (p *TimerPool) After(d time.Duration, f func()) { ... }
```

Or use `time.Ticker` with batched dispatch:

```go
ticker := time.NewTicker(10 * time.Millisecond)
for range ticker.C {
    p.dispatchDue() // process many at once
}
```

### Trade-off

Worse granularity (10 ms instead of arbitrary delay). Acceptable for many workloads.

### Measurement

`GODEBUG=schedtrace` shows `runqueue` size dropping.

---

## Optimisation 8: Pin Hot Tasks Carefully

### Problem

A hot task has cache-warm data on P0. Stealing moves it to P3, cold cache. Slowdown.

### Fix

`runtime.LockOSThread` for the hot task only:

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for {
        select {
        case task := <-hotTaskChan:
            hotProcessing(task) // cache-warm on this thread
        }
    }
}()
```

The task is pinned; the cache stays warm.

### Trade-off

The M is dedicated to this G. If `hotTaskChan` is empty, the M sits idle. Other Gs cannot use it.

### When justified

- Single-producer single-consumer hot path.
- Cache footprint is large (MB+).
- You have measured: with `LockOSThread`, throughput is N; without, throughput is M; M >> N is required to justify.

Most code does *not* benefit. Profile twice; pin once.

---

## When Not to Optimise

### Signs you should stop

- Scheduling is <5% of CPU profile. Optimise the 95% instead.
- Throughput is bottlenecked by external systems (database, network). Stealing won't help.
- You're tuning `GOMAXPROCS` in dev without prod measurements. Always measure prod.
- You're adding `LockOSThread` to "make things faster." It rarely does.

### Default trust

The Go scheduler's default config is correct for >95% of workloads. The team at Google has measured it on every benchmark you can think of. Trust the defaults; deviate only with evidence.

### Stop when

- Your p99 latency meets SLO.
- Your throughput meets target.
- CPU profile is dominated by your code, not the runtime.

Pursuing further scheduling optimisation past these points is yak-shaving.

---

## Summary

Work-stealing-related optimisations, in order of typical impact:

1. **Reduce goroutine churn** (batch work). Often 5-50× improvement.
2. **Avoid `LockOSThread`** unless required. Recovers wasted CPU.
3. **Fix `GOMAXPROCS` in containers** via `automaxprocs`. Recovers 2-10×.
4. **Shard hot mutexes/counters**. Often 10× improvement on contended counters.
5. **Cap cgo concurrency**. Stabilises M count, smoother latency.
6. **Reduce GRQ pressure** (consolidate timers). Drops `sched.lock` contention.
7. **Pin hot paths** with `LockOSThread` — rare; measure carefully.

The first three solve 80% of real performance issues. The rest are advanced.

Final rule: **measure before, measure after**. If you cannot show a benchmark or pprof difference, you have not optimised — you have changed the code.
