---
layout: default
title: Specification
parent: Premature Optimization
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/04-premature-optimization/specification/
---

# Premature Concurrency Optimization — Specification

This is the reference companion to `senior.md` and `professional.md`. It documents the tools, the methodology, the statistical conventions, and the platform-specific concerns that engineers need to look up while working on performance.

## Table of Contents

1. [`pprof` — the profiler](#pprof--the-profiler)
2. [`go tool trace` — the tracer](#go-tool-trace--the-tracer)
3. [`benchstat` — statistical comparison](#benchstat--statistical-comparison)
4. [`testing.B` — writing benchmarks](#testingb--writing-benchmarks)
5. [Statistical significance for benchmarks](#statistical-significance-for-benchmarks)
6. [GOMAXPROCS and its effects](#gomaxprocs-and-its-effects)
7. [GC tunables](#gc-tunables)
8. [Runtime metrics](#runtime-metrics)
9. [Profiling overhead reference](#profiling-overhead-reference)
10. [Reference cost tables](#reference-cost-tables)
11. [Recommended tooling stack](#recommended-tooling-stack)
12. [Common command lines](#common-command-lines)

---

## `pprof` — the profiler

`pprof` is Go's built-in profiler. It samples stack traces at configurable rates and produces a profile file.

### Profile types

| Profile | Endpoint | What it samples |
|---|---|---|
| CPU | `/debug/pprof/profile` | Stack at SIGPROF interrupts (100 Hz default) |
| Heap | `/debug/pprof/heap` | Stack at allocation events (every ~512 KB by default) |
| Goroutine | `/debug/pprof/goroutine` | Stack of every live goroutine |
| Block | `/debug/pprof/block` | Stack of goroutines blocked on synchronization (must be enabled) |
| Mutex | `/debug/pprof/mutex` | Stack of mutex contention (must be enabled) |
| Threadcreate | `/debug/pprof/threadcreate` | Stack of M creation |
| Trace | `/debug/pprof/trace` | Time-ordered scheduler events |

### Enabling pprof in a binary

```go
import _ "net/http/pprof"

func main() {
    go http.ListenAndServe("localhost:6060", nil)
    // ... rest of program
}
```

In production, expose pprof behind auth on an internal port only.

### Collecting profiles

```
# CPU profile, 30 seconds
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30

# Heap profile
go tool pprof http://localhost:6060/debug/pprof/heap

# Goroutine dump
curl -s http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt

# Block profile (enable first)
go test -bench=. -blockprofile=block.prof

# Mutex profile (enable first)
go test -bench=. -mutexprofile=mutex.prof
```

To enable block/mutex profiling at runtime:

```go
runtime.SetBlockProfileRate(1)        // every block event
runtime.SetMutexProfileFraction(1)    // every contention
```

Set higher numbers to sample less frequently (e.g. `100` samples every 100th event).

### Browsing profiles

Interactive mode (terminal):

```
go tool pprof cpu.pb.gz
(pprof) top
(pprof) list myFunc
(pprof) web   # opens SVG in browser
```

Web mode:

```
go tool pprof -http=:8080 cpu.pb.gz
```

Then in browser:

- **Top**: most-consuming functions, flat and cumulative.
- **Graph**: call graph with thickness proportional to cost.
- **Flame Graph**: stacks visualised as horizontal bars.
- **Peek**: per-function caller/callee breakdown.
- **Source**: annotated source with cost per line.

### Comparing profiles

```
go tool pprof -base before.pb.gz after.pb.gz
```

Shows deltas. Useful for verifying an optimisation moved the expected functions.

### Sampling rates

- CPU: `runtime.SetCPUProfileRate(N)` Hz. Default 100. Maximum ~250.
- Heap: `runtime.MemProfileRate` bytes. Default 512 KB. Set to 1 to capture every allocation (high overhead).
- Block: `runtime.SetBlockProfileRate(N)` events. 1 = every event.
- Mutex: `runtime.SetMutexProfileFraction(N)`. 1 = every event.

Higher sampling = more detail = more overhead. Production profiling typically uses defaults.

### Profile labels

Tag goroutines with labels for slicing:

```go
ctx := pprof.WithLabels(ctx, pprof.Labels("phase", "parse"))
pprof.SetGoroutineLabels(ctx)
defer pprof.SetGoroutineLabels(context.Background())
```

In pprof, filter:

```
(pprof) tag:phase
(pprof) tagfocus=parse
```

Useful when multiple code paths run concurrently and you want to see them separately.

---

## `go tool trace` — the tracer

`trace` collects every scheduler, GC, syscall, and user-event in a time-ordered log. It is more detailed than pprof but much higher overhead and more complex to read.

### Collecting a trace

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()

// run workload
```

Or via HTTP endpoint:

```
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=5'
```

Or in benchmarks:

```
go test -bench=BenchmarkX -trace=trace.out
```

### Viewing a trace

```
go tool trace trace.out
```

Opens a browser at a localhost URL. Key views:

- **View trace**: timeline. Each P has a lane. Goroutines appear as colored boxes.
- **Goroutine analysis**: per-class statistics.
- **Network blocking profile**: stacks of goroutines blocked on network.
- **Synchronization blocking profile**: blocked on chan/mutex.
- **Syscall blocking profile**: blocked in syscalls.
- **Scheduler latency profile**: time between runnable and running.
- **Minimum mutator utilization**: GC impact at various windows.

### Reading the timeline

- **Idle gaps**: P with no active goroutine. Time being wasted (or no work).
- **GC bands**: black/pink bands across all Ps. STW pauses + concurrent mark.
- **Heap line**: above the timeline. Shows heap size over time.
- **Goroutine count line**: shows goroutine population.

### Custom regions

```go
ctx, task := trace.NewTask(ctx, "process_batch")
defer task.End()

trace.WithRegion(ctx, "parse", func() {
    parseInput(input)
})
```

These appear in the goroutine-analysis view.

### Caveats

- Trace files are large: MBs per second of activity.
- Trace overhead: ~10% when running. Don't leave it on.
- Browser viewer is slow for traces > 100 MB.

---

## `benchstat` — statistical comparison

`benchstat` compares two sets of benchmark results with statistical tests.

### Install

```
go install golang.org/x/perf/cmd/benchstat@latest
```

### Usage

```
go test -bench=. -count=20 > old.txt
# make changes
go test -bench=. -count=20 > new.txt
benchstat old.txt new.txt
```

### Output

```
                            │  old.txt   │              new.txt              │
                            │   sec/op   │   sec/op     vs base              │
ParallelSum/N1k-8             14.4µ ± 2%   11.8µ ± 2%  -18.21% (p=0.000 n=20)
ParallelSum/N10k-8            142.5µ ± 1%  114.3µ ± 3%  -19.79% (p=0.000 n=20)
geomean                       45.3µ        36.7µ        -19.00%
```

Columns:

- `sec/op`: median time, with confidence interval (CI).
- `vs base`: percent change.
- `p`: p-value (Welch's t-test). `p < 0.05` means statistically significant.
- `n`: count of measurements.

### Interpreting

- Look at p first. If `p > 0.05`, the change is not significant.
- Look at percent change. Negative is faster (for time metrics).
- Look at variance. > 10% means noisy; increase `-count` or fix the machine.

### Common flags

```
benchstat -alpha 0.05 ...      # significance threshold
benchstat -row /name ...       # group by name component
benchstat -col .config ...     # break out by GOMAXPROCS or similar
```

### Filter conventions

`benchstat` uses the Go benchmark name format: `BenchmarkName/subA/subB-N` where `N` is GOMAXPROCS. The slash-separated parts and the suffix become "config" you can filter by.

---

## `testing.B` — writing benchmarks

### Basic form

```go
func BenchmarkX(b *testing.B) {
    for i := 0; i < b.N; i++ {
        doWork()
    }
}
```

`b.N` is auto-tuned by the framework.

### Reset timer for setup

```go
func BenchmarkX(b *testing.B) {
    data := makeData() // not measured
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        process(data)
    }
}
```

### Report allocations

```go
func BenchmarkX(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = work()
    }
}
```

Output adds `bytes/op` and `allocs/op` columns.

### Parallel benchmarks

```go
func BenchmarkX(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            doWork()
        }
    })
}
```

Runs the body from `GOMAXPROCS` goroutines. Useful for measuring under contention.

### Sub-benchmarks

```go
func BenchmarkX(b *testing.B) {
    sizes := []int{100, 1000, 10000}
    for _, n := range sizes {
        b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
            data := makeData(n)
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                process(data)
            }
        })
    }
}
```

Each sub-benchmark gets its own line in the output.

### Avoiding dead-code elimination

```go
var sink int

func BenchmarkX(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = compute(i)
    }
}
```

`sink` ensures the compiler doesn't optimise the call away.

### Common flags

```
go test -bench=. -count=20 -cpu=1,2,4,8 -benchtime=2s -benchmem
```

- `-bench=.`: run all benchmarks (regex pattern).
- `-count=N`: run each benchmark N times.
- `-cpu=1,2,4,8`: vary GOMAXPROCS.
- `-benchtime=2s`: run each benchmark for ~2s (or use `-benchtime=10000x` for fixed iterations).
- `-benchmem`: report allocations.
- `-cpuprofile=cpu.prof`: write CPU profile.
- `-memprofile=mem.prof`: write heap profile.
- `-blockprofile=block.prof`: enable + write block profile.
- `-mutexprofile=mutex.prof`: enable + write mutex profile.
- `-trace=trace.out`: write trace.

---

## Statistical significance for benchmarks

### Why care

Microbenchmarks are noisy. A 5% difference between two implementations might be real or might be sampling noise. Statistical tests distinguish.

### Welch's t-test

`benchstat` uses Welch's t-test (for unequal variances). It computes a p-value: the probability that the observed difference arose by chance under the null hypothesis of identical means.

Conventional threshold: `p < 0.05` is "significant."

### Variance considerations

- Variance in benchmarks: typically 1-5% on a quiet machine, 5-20% on a noisy one.
- Lower variance means smaller effects are detectable.
- For mobile/laptop benchmarks, expect 10%+ variance; for dedicated hardware, 1-2%.

### How many runs?

Rule of thumb:

- `-count=10` for clean benchmarks.
- `-count=20` for typical.
- `-count=50` for noisy.

The framework typically needs `n ≥ 5` for any test; `n=10` is minimal for confidence.

### Reproducibility

Run the same benchmark twice. If the results differ significantly, the benchmark or the machine is unreliable.

### Beware of compiler inlining differences

A small change can cause the compiler to inline (or not), dramatically changing the benchmark. Check the disassembly if results seem implausible:

```
go tool objdump -s 'pkg\.func' binary
```

---

## GOMAXPROCS and its effects

### What it is

`GOMAXPROCS` is the number of Ps (logical schedulers). It bounds the *parallelism* (simultaneous goroutine execution) but not the concurrency (number of goroutines).

### Default

- Before Go 1.5: 1.
- Go 1.5+: `NumCPU()` (number of logical CPUs).
- Go 1.22+ on Linux: respects cgroup CPU quota.

### Setting

```go
runtime.GOMAXPROCS(N)
```

Or via environment:

```
GOMAXPROCS=4 ./mybinary
```

### Effects

- Higher GOMAXPROCS: more parallelism (if there's work), more scheduler overhead, more memory per-P.
- Lower GOMAXPROCS: less parallelism, less overhead, less memory.

### Common settings

| Setting | Use case |
|---|---|
| `NumCPU()` | Default; usually correct |
| Cgroup quota | Container environments |
| 1 | Debugging, deterministic tests |
| 2× NumCPU | Rarely useful; sometimes for I/O-heavy workloads on hyper-threaded CPUs |

### Container note

Older Go (<1.22) on Linux did not respect cgroup quotas. Use `automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

This sets GOMAXPROCS to match the container's CPU quota at startup.

Go 1.22+ does this automatically.

### Hyperthreading

`NumCPU()` returns *logical* CPUs (including hyper-threads). On Intel with HT, 2 logical CPUs share 1 physical core. For pure CPU-bound work, GOMAXPROCS = physical cores may be optimal; for I/O-mixed, logical works.

Measure to decide.

---

## GC tunables

### GOGC

Controls GC trigger. Default 100 means "trigger when heap is 2× the post-previous-GC live heap."

```
GOGC=100  # default
GOGC=200  # less GC, more memory
GOGC=50   # more GC, less memory
GOGC=off  # disable (only for debugging!)
```

### GOMEMLIMIT (Go 1.19+)

Soft memory limit. The GC runs more aggressively as memory approaches the limit.

```
GOMEMLIMIT=8GiB
```

In production, set to ~90% of container memory limit.

Units: `B`, `KiB`, `MiB`, `GiB`. (Note: KiB = 1024 bytes; KB also accepted.)

### debug.SetGCPercent and debug.SetMemoryLimit

Runtime equivalents of the env vars:

```go
debug.SetGCPercent(200)
debug.SetMemoryLimit(8 << 30)
```

Useful for dynamic tuning.

### GODEBUG=gctrace=1

Logs every GC:

```
gc 5 @0.876s 1%: 0.012+1.5+0.045 ms clock, 0.024+0.5/1.2/0.18+0.090 ms cpu, 4->5->2 MB, 5 MB goal
```

Interpretation:

- `gc 5`: 5th GC since program start.
- `@0.876s`: time since program start.
- `1%`: GC's cumulative CPU share.
- `0.012+1.5+0.045 ms`: STW prep, mark, STW cleanup wall times.
- `0.024+0.5/1.2/0.18+0.090 ms cpu`: STW prep CPU, mark assist/background/idle CPU, STW cleanup CPU.
- `4->5->2 MB`: heap before GC, peak during, after.
- `5 MB goal`: next trigger.

### GODEBUG=schedtrace=1000

Logs scheduler state every 1000 ms:

```
SCHED 1000ms: gomaxprocs=8 idleprocs=2 threads=12 spinningthreads=0 ...
```

Useful for diagnosing scheduler behaviour.

---

## Runtime metrics

`runtime/metrics` (Go 1.16+) provides programmatic access to runtime metrics.

### Sample read

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/cpu/classes/gc/total:cpu-seconds"},
    {Name: "/memory/classes/heap/objects:bytes"},
    {Name: "/sched/goroutines:goroutines"},
}
metrics.Read(samples)
for _, s := range samples {
    switch s.Value.Kind() {
    case metrics.KindUint64:
        fmt.Printf("%s = %d\n", s.Name, s.Value.Uint64())
    case metrics.KindFloat64:
        fmt.Printf("%s = %f\n", s.Name, s.Value.Float64())
    }
}
```

### Useful metrics

- `/cpu/classes/gc/total:cpu-seconds`: cumulative GC CPU time.
- `/cpu/classes/scavenge/total:cpu-seconds`: scavenger CPU.
- `/cpu/classes/total:cpu-seconds`: total CPU.
- `/gc/cycles/total:gc-cycles`: GC count.
- `/gc/heap/allocs:bytes`: cumulative allocated bytes.
- `/gc/heap/objects:objects`: live objects.
- `/memory/classes/heap/objects:bytes`: live heap bytes.
- `/memory/classes/total:bytes`: total memory.
- `/sched/goroutines:goroutines`: goroutine count.
- `/sched/latencies:seconds`: scheduling latency histogram.

### List all

```go
descs := metrics.All()
for _, d := range descs {
    fmt.Println(d.Name, d.Description)
}
```

Useful for exporting to Prometheus or similar.

---

## Profiling overhead reference

| Profile | Default sample rate | Overhead |
|---|---|---|
| CPU | 100 Hz | ~1% |
| Heap | 512 KB | <0.5% |
| Goroutine | snapshot | ~0% |
| Block | disabled | depends on rate; 1% at rate=1 |
| Mutex | disabled | similar to block |
| Trace | event-by-event | ~10% |

Run profiles continuously in production *except* trace. Trace should be enabled only for short investigations.

---

## Reference cost tables

Rough costs on modern x86_64 hardware (Go 1.22). All times are approximate.

### Goroutine and channel

| Operation | Cost |
|---|---|
| `go func() { ... }()` (spawn) | ~1 µs |
| Goroutine context switch (same P) | ~200 ns |
| Goroutine context switch (steal) | ~500 ns |
| `chan int` send/recv (buffered, hot) | ~50 ns |
| `chan int` send/recv (unbuffered, sync) | ~250 ns |
| Closed channel recv | ~30 ns |
| `select` with 2 cases | ~150 ns |
| `select` with 10 cases | ~300 ns |

### Synchronisation

| Operation | Cost |
|---|---|
| `sync.Mutex.Lock` (uncontended) | ~10 ns |
| `sync.Mutex.Lock` (contended, parks) | ~1 µs |
| `sync.RWMutex.RLock` (uncontended) | ~50 ns |
| `sync.RWMutex.Lock` (uncontended) | ~25 ns |
| `atomic.LoadInt64` | ~1 ns |
| `atomic.AddInt64` (uncontended) | ~5 ns |
| `atomic.AddInt64` (contended) | ~30-100 ns |
| `atomic.CompareAndSwap` (uncontended) | ~5 ns |
| `atomic.CompareAndSwap` (contended) | ~50-200 ns |
| `sync.Once.Do` (after first) | ~1 ns |
| `sync.WaitGroup.Add/Done` (uncontended) | ~10 ns |

### Memory

| Operation | Cost |
|---|---|
| L1 cache hit | ~1 ns |
| L2 cache hit | ~3 ns |
| L3 cache hit | ~12 ns |
| Main memory (DRAM) | ~70 ns |
| Remote NUMA | ~150 ns |
| `make([]byte, 64)` (small alloc) | ~30 ns |
| `make([]byte, 1<<20)` (1 MB alloc) | ~5 µs |
| Slice append (no growth) | ~3 ns |
| Slice append (with growth) | ~50 ns + alloc |
| Map access (hot, small) | ~20 ns |
| Map access (cold, large) | ~100 ns |
| `string(b)` (small) | ~15 ns + alloc |

### Common library

| Operation | Cost |
|---|---|
| `time.Now()` | ~30 ns |
| `time.Since(t)` | ~50 ns |
| `fmt.Sprintf("%d", n)` | ~150 ns + alloc |
| `strconv.Itoa(n)` | ~30 ns |
| `json.Marshal` (small struct) | ~1 µs + alloc |
| `json.Unmarshal` (small struct) | ~2 µs + alloc |
| `regexp.Match` (compiled, simple) | ~200 ns |
| `regexp.Compile` | ~1-100 µs |
| HTTP round-trip (LAN) | ~500 µs |
| HTTP round-trip (continent) | ~30 ms |
| HTTP round-trip (intercontinental) | ~150 ms |

These are baselines. Your hardware may differ; measure to confirm.

---

## Recommended tooling stack

A production Go service should adopt:

### Required

- `pprof` (built-in).
- `go test -race` (built-in).
- `benchstat` for benchmark comparison.
- `go vet` for static analysis.
- Prometheus client library for metrics.

### Recommended

- `automaxprocs` if Go < 1.22.
- `goleak` for goroutine leak tests.
- `staticcheck` or `golangci-lint` for deeper analysis.
- OpenTelemetry SDK for tracing.

### Optional (case-dependent)

- A continuous profiling agent (Pyroscope, Datadog, Polar Signals).
- `singleflight` (`golang.org/x/sync/singleflight`).
- `errgroup` (`golang.org/x/sync/errgroup`).
- `semaphore` (`golang.org/x/sync/semaphore`).
- `rate` limiter (`golang.org/x/time/rate`).

---

## Common command lines

### Run all tests with race detector

```
go test -race ./...
```

### Run benchmarks with stats

```
go test -bench=. -count=10 -benchmem -cpu=1,2,4,8 ./...
```

### Compare two benchmark runs

```
go test -bench=. -count=10 > old.txt
# make changes
go test -bench=. -count=10 > new.txt
benchstat old.txt new.txt
```

### Generate CPU profile from benchmark

```
go test -bench=BenchmarkX -cpuprofile=cpu.prof
go tool pprof -http=:8080 cpu.prof
```

### Generate trace from benchmark

```
go test -bench=BenchmarkX -trace=trace.out
go tool trace trace.out
```

### Live profile from a running service

```
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
```

### Goroutine dump

```
curl -s 'http://localhost:6060/debug/pprof/goroutine?debug=2' > goroutines.txt
```

### Heap snapshot

```
curl -o heap.prof 'http://localhost:6060/debug/pprof/heap'
go tool pprof -http=:8080 heap.prof
```

### Disassemble a function

```
go tool objdump -s 'mypkg\.MyFunc' /path/to/binary
```

### Inspect compiler decisions

```
go build -gcflags='-m -m' ./...
```

Shows inlining and escape analysis decisions.

---

## Summary

This specification is a reference. The deep treatment is in `senior.md` and `professional.md`. Use this document when:

- You need to remember a `pprof` flag.
- You need to look up a cost number.
- You need a quick refresher on `benchstat` output format.
- You need to choose a GOGC value.

Each section is self-contained. Skip to what you need.

Keep this open in a tab while debugging performance issues. The numbers and tools here are the working vocabulary of Go performance engineering.

---

## Appendix: pprof example session

A realistic pprof session, transcribed:

```
$ go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
Fetching profile over HTTP from ...
Saved profile in /tmp/pprof/...
Type: cpu
Time: ...
Duration: 30s, Total samples = 23.85s (79.51%)

(pprof) top
Showing nodes accounting for 19.62s, 82.27% of 23.85s total
      flat  flat%   sum%        cum   cum%
     5.34s 22.39% 22.39%      5.34s 22.39%  myapp/parse.parseField
     3.21s 13.46% 35.85%      8.92s 37.40%  myapp/handler.handle
     2.45s 10.27% 46.12%      2.45s 10.27%  encoding/json.(*decodeState).object
     ...

(pprof) list myapp/parse.parseField
ROUTINE ======================== myapp/parse.parseField in /src/myapp/parse/parse.go
     5.34s      5.34s (flat, cum) 22.39% of Total
         .          .     45:func parseField(b []byte) (string, error) {
     1.20s      1.20s     46:    if len(b) == 0 {
         .          .     47:        return "", ErrEmpty
         .          .     48:    }
     2.30s      2.30s     49:    for i, c := range b {
     1.84s      1.84s     50:        if c == ',' {
         .          .     51:            return string(b[:i]), nil
         .          .     52:        }
         .          .     53:    }
         .          .     54:    return string(b), nil
         .          .     55:}

(pprof) web
[opens SVG in browser]

(pprof) exit
```

This session shows the structure: `top` for an overview, `list` for details on a function, `web` for the call graph.

---

## Appendix: benchstat with multiple configurations

```
go test -bench=. -count=10 -cpu=1,2,4,8 > all.txt
benchstat -row=/N -col=.cpu all.txt
```

Layout:

```
              │     1     │     2     │     4     │     8     │
              │  sec/op   │  sec/op   │  sec/op   │  sec/op   │
ParallelSum/N100   25µ ± 1%   30µ ± 2%   45µ ± 5%   80µ ± 8%
ParallelSum/N1000  150µ ± 1%  90µ ± 2%   55µ ± 3%   45µ ± 4%
geomean             67µ        53µ        50µ        62µ
```

Shows scaling per `-cpu` setting. ParallelSum/N100 *regresses* with more cores (overhead dominates); ParallelSum/N1000 scales well.

---

## Appendix: trace event types

`go tool trace` reports many event types. Key ones:

- **ProcStart, ProcStop**: P starts/stops a goroutine.
- **GoCreate, GoStart, GoEnd**: goroutine lifecycle.
- **GoBlock**: goroutine becomes Gwaiting.
- **GoUnblock**: goroutine becomes Grunnable.
- **GoSysCall, GoSysBlock, GoSysExit**: syscall transitions.
- **HeapAlloc**: heap allocation.
- **GCStart, GCEnd, GCSTWStart, GCSTWDone**: GC events.
- **UserTaskCreate, UserTaskEnd, UserRegion**: custom regions.

Use these to construct a detailed timeline of what the program was doing.

---

## Appendix: example bench harness

A minimal harness for measuring concurrent code:

```go
func benchmarkParallel(b *testing.B, workers int) {
    items := makeItems(10000)
    b.ResetTimer()

    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        idx := atomic.Int64{}
        for w := 0; w < workers; w++ {
            wg.Add(1)
            go func() {
                defer wg.Done()
                for {
                    j := idx.Add(1) - 1
                    if int(j) >= len(items) {
                        return
                    }
                    _ = process(items[j])
                }
            }()
        }
        wg.Wait()
    }
}

func BenchmarkParallel1(b *testing.B) { benchmarkParallel(b, 1) }
func BenchmarkParallel2(b *testing.B) { benchmarkParallel(b, 2) }
func BenchmarkParallel4(b *testing.B) { benchmarkParallel(b, 4) }
func BenchmarkParallel8(b *testing.B) { benchmarkParallel(b, 8) }
```

This generates benchmarks for varying worker counts. Run with `-count=20` and compare scaling.

---

## Appendix: end

This is the reference document. Bookmark it.

The depth is in `senior.md` and `professional.md`. The hands-on is in `tasks.md`, `find-bug.md`, and `optimize.md`. The Q&A is in `interview.md`.

Use each as appropriate.

End of specification.
