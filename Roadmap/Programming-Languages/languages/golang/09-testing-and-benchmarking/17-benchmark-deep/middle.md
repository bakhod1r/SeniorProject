---
layout: default
title: Benchmark Deep — Middle
parent: Benchmarking Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/middle/
---

# Benchmark Deep — Middle

[← Back](../)

The middle page assumes you have internalised the four rules from junior. Now we move from *correctness of measurement* to *statistical rigor*, *machine state*, and the *toolchain knobs* that change what you are actually measuring.

## 1. Why a single ns/op is a lie

The Go testing framework reports `ns/op` as `(total elapsed time) / b.N`. This is an arithmetic mean. Arithmetic means are dragged by outliers. In a typical bench run, 99% of iterations cluster tightly and 1% are slow because of GC, scheduler preemption, or a cache miss. Those slow ones, summed, push the mean up.

Here is a thought experiment. Suppose 99% of iterations take 100ns and 1% take 10,000ns (a 100x outlier from a GC pause). The mean is `0.99 * 100 + 0.01 * 10000 = 99 + 100 = 199`ns. The mean is *double* the typical iteration. If a change halves the GC pause frequency, the mean drops to ~150ns — a 25% "improvement" with no impact on the typical hot path.

Conclusion: the mean tells you a story but not necessarily the one you want. For p99-critical code you want the actual p99 of per-iteration latency.

## 2. Measuring quantiles inside a benchmark

The framework gives you no per-iteration timing for free. You measure each iteration with `time.Now()` deltas and call `b.ReportMetric` at the end:

```go
func BenchmarkProcessQuantiles(b *testing.B) {
    samples := make([]time.Duration, b.N)
    for i := 0; i < b.N; i++ {
        t0 := time.Now()
        process(inputs[i%len(inputs)])
        samples[i] = time.Since(t0)
    }
    sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
    p := func(q float64) float64 {
        if len(samples) == 0 {
            return 0
        }
        idx := int(float64(len(samples)) * q)
        if idx >= len(samples) {
            idx = len(samples) - 1
        }
        return float64(samples[idx])
    }
    b.ReportMetric(p(0.50), "p50-ns")
    b.ReportMetric(p(0.95), "p95-ns")
    b.ReportMetric(p(0.99), "p99-ns")
}
```

The output now includes additional columns:

```
BenchmarkProcessQuantiles-1    100000    312 ns/op    250 p50-ns    480 p95-ns    1240 p99-ns
```

benchstat understands these custom metrics and will compare them across runs. Two warnings:

1. `time.Now()` on x86-64 Linux costs ~25ns. For sub-100ns operations the timing overhead dominates the work; the measurement is meaningless. Use this technique for ops that take >1µs.
2. The slice of `b.N` durations costs `8 * b.N` bytes of RAM. For `b.N = 10^7` that is 80MB which is fine on a server, less so on a laptop. Cap it with `min(b.N, 1<<20)` if you have memory constraints, sampling the rest.

## 3. The Mann–Whitney U test and what it means

benchstat does not assume the underlying distribution is normal (it almost never is — benchmark distributions have a long right tail). It uses the Mann–Whitney U test, a rank-based non-parametric test.

The intuition: pool the samples from both groups, rank them from smallest to largest, and look at whether the ranks from group A and group B are mixed (no effect) or separated (real effect). The U statistic is a function of the rank sum; the p-value answers "if there were no real difference, how likely would I see ranks this separated?"

The reason this is the right test for benchmarks:

- It does not require Gaussianity (good — bench data is not Gaussian).
- It is robust to outliers (good — bench data has tails).
- It works on small samples (n=10 is fine).
- It is order-of-magnitude faster to run than bootstrap (irrelevant for us, but nice).

The p-value is *not* the probability that the change is real. It is the probability of seeing this data *under the assumption that there is no change*. Low p means "if there were no effect, my data would be weird." That is the closest you can get to "the change is real" with classical statistics.

## 4. The α/threshold pair

You report a result as significant only if *both* `p < α` *and* `|effect| ≥ threshold`. Why both?

- `p < α` controls the *false positive* rate: how often do you claim a regression when there is none?
- `threshold` controls the *false negative* rate, sort of: it forces you to ignore changes too small to matter even if they are statistically detectable.

A super-stable bench with 1000 samples can detect a 0.1% real change at `p < 10^-6`. That change is real but irrelevant. The threshold says "I do not care about 0.1%; show me changes over 2%". This is engineering judgement, not statistics.

Defaults: benchstat uses `α = 0.05` and no threshold. For CI gating use `α = 0.01` and a threshold tuned to your noise floor (typically `2-5%`).

## 5. Noise floor measurement

Before claiming any speedup, you must know the noise floor of *your* setup. The procedure:

```bash
# Two identical runs with the same code.
go test -bench=. -count=20 > a.txt
go test -bench=. -count=20 > b.txt
benchstat a.txt b.txt
```

Anything benchstat reports as significant here is by definition noise (the code did not change). The largest delta you see across your benchmarks is your noise floor. Any future change must produce a delta larger than this to be plausibly real.

Typical noise floors:

- Bare metal, pinned, frequency-locked: 0.5%-1%.
- Bare metal, default settings: 2%-5%.
- Laptop on AC: 3%-8%.
- Laptop on battery: 5%-15%.
- Shared CI runner: 10%-30%.

The shared CI number is why you cannot gate PRs on shared CI.

## 6. CPU pinning on Linux

`taskset` sets the CPU affinity of a process. On a benchmark machine:

```bash
# Inspect CPUs:
lscpu --extended
# Pick core 3 (a P-core, not E-core, no SMT sibling running).
taskset -c 3 go test -bench=. -count=10
```

The pin removes scheduling jitter (no migrations between cores) and locks the benchmark into a known cache hierarchy. For benchmarks under 100ns per op the difference between pinned and unpinned is often 2x stability.

Combine with `nice -n -20` (give the process highest priority) and `chrt -f 99` (real-time priority) for the strongest guarantees. Be careful with `chrt -f` — a runaway can lock your machine.

`numactl --cpunodebind=0 --membind=0` extends pinning to memory: it ensures allocations come from the same NUMA node as the executing CPU. For Go programs whose heap is small enough to fit in one node's local memory, this removes interconnect traffic.

## 7. Turbo and SMT

These are BIOS settings, mostly.

**Turbo Boost** lets the CPU temporarily run above its base frequency. Great for production. Bad for measurement: the same code at 4.5GHz takes 1/1.5 the time at 3GHz. Two benchmarks back to back, the second often slower because turbo dropped. Solution: disable turbo. On Linux: `echo 1 > /sys/devices/system/cpu/intel_pstate/no_turbo`. On bare metal you may need BIOS access.

**SMT/Hyperthreading** exposes one physical core as two logical CPUs that share L1/L2 cache and many execution units. If your benchmark runs on logical CPU 7 and the OS schedules something heavy on logical CPU 19 (the sibling), your numbers tank by 30-50%. Solution: turn SMT off in BIOS, or pin both siblings to your benchmark.

A working compromise on developer laptops: do not turn SMT off, but pin to a single logical CPU and run nothing else.

## 8. The cache state of an operation

A benchmark of `bytes.Equal(a, b)` for `a, b` of length 1KB will show very different numbers depending on whether `a` and `b` are in L1 (fits easily), L2 (fits with friends), L3 (still hot), or RAM (cold). The Go framework's warmup pulls everything into L1 quickly, so most benchmarks measure the hot case. This is fine for the "what does it cost when called repeatedly" question but lies about the "what does it cost on first call" question.

To measure cold:

```go
func BenchmarkColdCacheEqual(b *testing.B) {
    bufA := make([]byte, 1<<20) // 1MB
    bufB := make([]byte, 1<<20)
    rand.Read(bufA)
    copy(bufB, bufA)

    // Pollute cache with a 64MB working set:
    pollute := make([]byte, 64<<20)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        // Touch the polluter to evict the bufs from cache:
        for j := 0; j < len(pollute); j += 64 {
            pollute[j]++
        }
        b.StartTimer()
        bytes.Equal(bufA, bufB)
        b.StopTimer()
    }
}
```

The `b.StopTimer/b.StartTimer` is what makes the pollute step uncounted. You now measure the equal-on-cold-cache cost. Expect numbers 10-100x higher than the hot case.

## 9. Inlining and `-gcflags="-m"`

Inlining changes both what is measured and how it relates to production. To see inlining decisions:

```
go test -bench=. -gcflags="-m=2" ./... 2>&1 | grep -A1 "inlining"
```

You will see lines like:

```
./foo.go:42:6: can inline square with cost 4 as: func(int) int { return x * x }
./foo.go:55:9: inlining call to square
```

If a function you expect to be inlined is not, the message will say "cannot inline X: function too complex: cost > 80". You can hint with `//go:inline` (rare) or rewrite to be simpler.

For a benchmark, the question is: does the production caller see the same inlining as your benchmark caller? A free function called from a `BenchmarkX` is inlined the same way as if called from any other site. An interface method, however, is a virtual call that PGO may devirtualise — your bench may underestimate the speedup PGO provides in prod.

## 10. Escape analysis

`-gcflags="-m"` also prints escape-analysis decisions:

```
./foo.go:42:6: x does not escape
./foo.go:50:6: moved to heap: y
```

"Moved to heap" means an allocation. Even one allocation per hot-path call multiplies GC pressure by your QPS. Hunting for these is the bulk of Go performance work for service code.

A common pattern: a closure captures a variable and forces it to the heap.

```go
func badCounter() func() int {
    count := 0
    return func() int {
        count++
        return count
    }
}
```

`count` escapes because the returned closure outlives the function. There is no fix without changing the API; the lesson is to *know* this is happening when you reach for closures in hot code.

## 11. Comparing across Go versions

A new Go release can change your benchmarks for many reasons: compiler improvements, runtime tweaks (scheduler, GC pacer), standard library rewrites. To compare:

```bash
go install golang.org/dl/go1.21.13@latest && go1.21.13 download
go install golang.org/dl/go1.22.8@latest  && go1.22.8 download
go install golang.org/dl/go1.23.4@latest  && go1.23.4 download

go1.21.13 test -bench=. -count=10 ./... > go1.21.txt
go1.22.8  test -bench=. -count=10 ./... > go1.22.txt
go1.23.4  test -bench=. -count=10 ./... > go1.23.txt

benchstat go1.21.txt go1.22.txt
benchstat go1.22.txt go1.23.txt
```

When you see a regression, the next step is reading the release notes for the in-between version and identifying the likely cause. The Go team labels significant perf changes in the release notes; for surprises, `git log` on the runtime or compiler at the right SHA range.

## 12. GOGC and GOMEMLIMIT

`GOGC` controls the GC trigger: default 100 means "trigger when heap doubles". Lower values (50) trigger sooner — more CPU spent in GC, lower memory use. Higher (200) trigger later — less CPU in GC, more memory use.

`GOMEMLIMIT` (Go 1.19+) is a soft heap limit that the GC pacer tries to honour. Above it, GC becomes aggressive; well below it, GC backs off.

For benchmarks the key insight is: production has a `GOMEMLIMIT` and so should your benchmark, or else the GC pacer behaves differently in measurement than in deployment. Set:

```bash
GOMEMLIMIT=2GiB GOGC=100 go test -bench=. -count=10
```

Matching production settings. Then read `runtime/metrics` during the bench to see how often GC actually ran (`/gc/cycles/total:gc-cycles`).

## 13. The professional benchmark file template

After absorbing the above, your benchmarks should follow a template:

```go
package myservice_test

import (
    "runtime/metrics"
    "sort"
    "testing"
    "time"
)

var sink any

func BenchmarkHotPath(b *testing.B) {
    fixture := buildFixture(b)
    b.ReportAllocs()
    b.ResetTimer()

    samples := make([]time.Duration, 0, b.N)
    var beforeGCCycles, afterGCCycles uint64

    samplesBuf := []metrics.Sample{
        {Name: "/gc/cycles/total:gc-cycles"},
    }
    metrics.Read(samplesBuf)
    beforeGCCycles = samplesBuf[0].Value.Uint64()

    for i := 0; i < b.N; i++ {
        t0 := time.Now()
        sink = hotPath(fixture, i)
        samples = append(samples, time.Since(t0))
    }

    metrics.Read(samplesBuf)
    afterGCCycles = samplesBuf[0].Value.Uint64()

    sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
    pct := func(q float64) float64 {
        return float64(samples[int(float64(len(samples))*q)])
    }
    b.ReportMetric(pct(0.50), "p50-ns")
    b.ReportMetric(pct(0.99), "p99-ns")
    b.ReportMetric(float64(afterGCCycles-beforeGCCycles), "gc-cycles")
}
```

This template gives you the mean (free), p50, p99, allocs, and GC cycles. Compared across runs with benchstat it answers most production-relevant performance questions about a hot path.

## 14. Common middle-level mistakes

- Forgetting to set `GOMEMLIMIT` to match production.
- Reporting mean delta without checking p50/p99.
- Running on a laptop on battery and trusting the numbers.
- Comparing `BenchmarkOldName` to `BenchmarkNewName` with benchstat — it cannot match them, you get two unrelated rows.
- Trusting `-count=1`: benchstat refuses to be useful without samples.
- Adding `b.StopTimer/b.StartTimer` to a 50ns operation — the timer overhead becomes the measurement.

## 15. Concurrent benchmarks with `b.RunParallel`

For code that exists to be called concurrently (locks, channels,
caches with internal sharding), serial benchmarks lie. They omit the
contention cost. `b.RunParallel` measures the right thing:

```go
func BenchmarkCounterAtomic(b *testing.B) {
    var c int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            atomic.AddInt64(&c, 1)
        }
    })
}

func BenchmarkCounterMutex(b *testing.B) {
    var (
        c  int64
        mu sync.Mutex
    )
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            c++
            mu.Unlock()
        }
    })
}
```

Run with `-cpu=1,2,4,8,16` to see the contention scaling curve.
At `-cpu=1` both look fast; at `-cpu=16` the atomic is dramatically
faster than the mutex because mutex contention forces park/unpark
syscalls. The number you should report is the one at the
`GOMAXPROCS` value matching production, not the best of the table.

A subtle point about `b.RunParallel`: the inner closure runs *once
per goroutine*, not once per iteration. Setup inside the closure
(before `pb.Next` loop) executes `GOMAXPROCS` times. If that setup
is expensive, factor it out and pass a reference into the closure.

## 16. Allocation tracking with `runtime.MemStats`

`b.ReportAllocs` summarises the bench-level allocs, but sometimes you
want to attribute allocations to specific phases of a benchmark. The
older but still useful approach uses `runtime.ReadMemStats`:

```go
func BenchmarkPipeline(b *testing.B) {
    var m1, m2, m3 runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&m1)

    // Phase 1: parse
    for i := 0; i < b.N; i++ {
        parsed[i] = parse(inputs[i])
    }
    runtime.ReadMemStats(&m2)

    // Phase 2: validate
    for i := 0; i < b.N; i++ {
        valid[i] = validate(parsed[i])
    }
    runtime.ReadMemStats(&m3)

    b.ReportMetric(float64(m2.TotalAlloc-m1.TotalAlloc)/float64(b.N), "parse-B/op")
    b.ReportMetric(float64(m3.TotalAlloc-m2.TotalAlloc)/float64(b.N), "validate-B/op")
}
```

Caveat: `ReadMemStats` stops the world for ~hundreds of microseconds.
Calling it inside a hot inner loop ruins the measurement. Use it only
at phase boundaries, never per iteration.

`runtime/metrics` is the modern replacement and does *not* stop the
world. Prefer it. The example above translates directly to
`metrics.Read` on `/gc/heap/allocs:bytes`.

## 17. Benchstat threshold tuning

The `-threshold` flag to benchstat sets the minimum effect size
that will be reported as significant. Default is 0%, meaning any
statistically significant delta is shown. For CI gates you almost
always want a positive threshold:

```
benchstat -threshold=5% before.txt after.txt
```

This says "do not flag deltas under 5% even if p < 0.05." The
reasoning: a 1% real delta on a 50ns operation saves 0.5ns per call.
Across 1B calls per day that is 500ms total — meaningless. The
threshold filters out detectable but irrelevant changes.

The right threshold depends on the benchmark's role:

- Microbenchmarks of pure functions: 5-10%. Real changes below this
  are rarely worth code review attention.
- Contract benchmarks (gate the SLO): 2-5%. Here you care about
  small drifts because they accumulate.
- Allocation count: 0% (any change is significant; allocs/op is
  integer and exact).

Document the threshold in the bench fixture so future readers know
what was filtered.

## 18. The geomean trap

`benchstat -geomean` adds a "geomean" row that summarises all
benchmarks with the geometric mean of their ratios. Useful for the
"is release N faster than release N-1 overall" question. *Not*
useful for "is *this specific benchmark* faster" — for that you
read the individual rows.

The trap: a release that improves 90% of benchmarks by 5% and
regresses 10% by 50% may have a positive geomean. A naive reader
sees "release is 3% faster overall" and ships it. The 10% of
regressed benchmarks may correspond to the hottest paths in prod.
Geomean is a *summary*, not a *verdict*. Always scan the individual
deltas as well.

## 19. The `pb.Next()` cost

`pb.Next()` is not free. On x86 it costs ~5ns per call (an atomic
counter increment plus a comparison). For benchmarks where the body
itself takes ~10ns, `pb.Next` is 33% of the measurement. To
amortise, do `N` iterations per `Next` call:

```go
b.RunParallel(func(pb *testing.PB) {
    for pb.Next() {
        for i := 0; i < 100; i++ {
            cheap_op()
        }
    }
})
b.SetBytes(int64(100)) // if you want per-op rate
```

The `b.SetBytes` is not quite right here — `SetBytes` reports
throughput in `MB/s`, not iterations — but the same idea applies via
`b.ReportMetric`. The point is: when the work-per-Next is small,
batching keeps the framework overhead from dominating.

## 20. The cost of the timer itself

`b.StartTimer` / `b.StopTimer` internally call `time.Now()` and do a
small amount of bookkeeping. On modern hardware this is around
200-400ns per pair. If your timed region is under 1µs, the timer
overhead is significant. Two strategies:

1. Pre-allocate inputs and avoid the StopTimer/StartTimer dance
   entirely.
2. Batch: time 1000 iterations as one block.

The framework's `ResetTimer` is cheap; the *Start/Stop* pair is what
hurts. So `ResetTimer` after setup is free; per-iteration
Start/Stop is expensive.

## 21. The Go scheduler and benchmark stability

Go's scheduler can pre-empt a goroutine *while it is running*. As of
Go 1.14 this is preemption based on a runtime signal, not on
function call boundaries. A bench iteration that loops for 10ms
without entering the runtime can be pre-empted mid-iteration. The
result: occasional outliers that are 1-2x slower than baseline,
showing up in the long tail.

This is normally not a problem because `b.N` runs many iterations and
outliers wash out in the average. But for *per-iteration* histogram
measurement (the p99 trick from section 2), pre-emption shows up in
the tail.

Mitigations:

- `runtime.LockOSThread()` inside the benchmark body, paired with
  `runtime.UnlockOSThread()` after. This pins the goroutine to an
  OS thread, but does not prevent the OS scheduler from preempting
  the thread.
- `GOMAXPROCS=1` plus `taskset -c X`. Now there is one Go thread on
  one CPU; the only pre-emption is from the kernel, which on a
  bench-tuned machine is rare.
- Accept the tail and increase sample count (`-count=20+`).

## 22. The race detector and benchmarks

Never benchmark with `-race`. The race detector adds 5-10x runtime
overhead and 2-3x memory overhead. The numbers you get are
unrepresentative of production by a wide margin. Bench in race-free
mode and use `-race` only in *correctness tests*.

If you want a bench that runs under race for the express purpose of
catching data races in concurrent benchmarks, name it something
explicit like `BenchmarkParallelRace` and run it separately. Do not
mix race and non-race benches in the same suite output, because
benchstat will compare them as if the difference were a real perf
delta.

## 23. The bench artifact for your PR

A PR description should include a bench section. Template:

```
## Performance

Hardware: Linux amd64, 13th Gen Intel i7-13700H, pinned to core 3,
turbo off, SMT off. Go 1.23.4. GOGC=100. GOMEMLIMIT=4GiB.

```
benchstat before.txt after.txt
name                old time/op    new time/op    delta
ProcessRequest-1    18.4µs ± 2%    11.7µs ± 2%    -36.4%  (p=0.000 n=20+20)

name                old alloc/op   new alloc/op   delta
ProcessRequest-1    12.5kB ± 0%     6.4kB ± 0%    -48.8%  (p=0.000 n=20+20)

name                old allocs/op  new allocs/op  delta
ProcessRequest-1     34.0 ± 0%      18.0 ± 0%     -47.1%  (p=0.000 n=20+20)
```

Cause: replaced per-call json.Encoder with a pool of pre-allocated
ones. The win comes from avoided heap allocation; the rest is a
2ns reduction per call from skipping the bufio.Writer init.
```

A reviewer reads this in 30 seconds. They have the hardware, the
samples, the p-values, and the cause attribution. They can either
trust it or ask a sharp follow-up question. Anything less gives them
less to work with.

## 24. The "I cannot reproduce" problem

A common scenario: dev A merges a 10% improvement with benchstat
proof. Dev B pulls and reruns; the improvement is gone. What
happened?

Almost always the cause is one of:

- Dev B has a different machine (laptop vs server, AC vs battery).
- Dev B has different background load (browser, IDE indexing).
- Dev B is running a different Go version.
- Dev B has different GOGC or GOMEMLIMIT.
- Dev B is on a different OS.

The fix is the bench fixture: the eight invariants from the spec
page. If A documented the fixture and B reproduced it, they will see
the same delta. If A did not document it, the disagreement is
unresolvable.

This is why public-facing perf claims always include a fixture. A
blog post that says "Go 1.23 is 15% faster" with no fixture is
folklore. The Go team's own perf release notes include hardware,
flags, and benchstat output for this exact reason.

## 25. Benchmark suite size and the iron triangle

For a given budget of CI minutes you trade off:

- **Coverage**: how many benchmarks you run.
- **Depth**: how long each benchmark runs (`-benchtime`).
- **Samples**: how many times you run each (`-count`).

Tripling any one of these triples the wall time. The other two are
fixed.

Recommended starting allocation:

- Smoke tier (per PR): 30 benchmarks, 1s benchtime, 1 sample. Total:
  30 * 1 = 30 seconds. Detects 50%+ regressions.
- Focused tier (per merge): 30 benchmarks, 5s benchtime, 10 samples.
  Total: 30 * 5 * 10 = 25 minutes. Detects 5% regressions.
- Trend tier (nightly): 100 benchmarks, 5s benchtime, 20 samples.
  Total: 100 * 5 * 20 = 2.8 hours. Detects 1-2% regressions.

Tune these to your team's CI capacity. Importantly, do not run a
trend-tier configuration on a per-PR basis: developers will not wait
3 hours to merge a typo fix.

## 26. The `b.SetBytes` and `b.SetParallelism` knobs

`b.SetBytes(n)` reports throughput in MB/s by treating each iteration
as processing `n` bytes. For codecs and parsers this is the natural
metric:

```go
func BenchmarkDecodeJSON(b *testing.B) {
    data := loadFixture("payload-1024b.json")
    b.SetBytes(int64(len(data)))
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var out Document
        json.Unmarshal(data, &out)
        sink = out
    }
}
```

Output:

```
BenchmarkDecodeJSON-8    300000   4123 ns/op   248.31 MB/s   320 B/op   3 allocs/op
```

The MB/s column is meaningful because a 2KB payload at 4000 ns/op
and a 4KB payload at 8000 ns/op should report the same throughput
*if the decoder scales linearly with size*. Sub-linear scaling
(throughput rising with size) is the signature of fixed overhead
amortising; super-linear (throughput falling) usually means cache
effects kicking in.

`b.SetParallelism(p)` adjusts the parallelism factor for
`RunParallel`. The default is 1, meaning GOMAXPROCS goroutines.
Setting it to 2 doubles the goroutines, which is useful for
benchmarks that simulate "more than CPU count" of concurrent calls,
such as a database client pool.

## 27. Reading inlining decisions in practice

`-gcflags="all=-m=2"` is verbose. The output for a non-trivial
program is thousands of lines. To find what you care about:

```
go test -bench=. -gcflags="all=-m=2" 2>&1 | grep "inlining call to YourFunc"
```

This narrows the output to call sites that successfully inlined your
function. The opposite — sites that failed to inline — appears as:

```
./foo.go:55:9: cannot inline call to YourFunc: function too complex: cost N
```

If you see "cost N" with N just over 80 (the default budget), you
can sometimes coax inlining by:

- Splitting the function: extract the slow-path into a separate
  function, leave the fast-path inline.
- Removing reflection or runtime type assertion (these cost a lot).
- Avoiding closures inside the function (each `func() { ... }` has
  a fixed cost).
- Removing the `defer` (each `defer` adds ~3 cost units).

Example. This function does not inline (cost ~85):

```go
func validate(s string) bool {
    defer recover()
    for _, c := range s {
        if c < 32 || c > 126 {
            return false
        }
    }
    return true
}
```

Remove the `defer recover()`. Now it inlines (cost ~40). For a hot
path called millions of times, this can save 20-30% of total cost.

## 28. Escape-analysis hunting

`-gcflags="-m=2"` also reveals escape decisions. Hunt with:

```
go test -bench=. -gcflags="-m=2" 2>&1 | grep "escapes to heap"
```

Typical findings on a sloppy codebase:

```
./foo.go:42:15: x escapes to heap: flow: from x (parameter x) to {heap}
./foo.go:50:20: &y escapes to heap: flow: from &y (address-of) to {heap}
./foo.go:55:30: ... argument escapes to heap: flow: from ... (parameter ...) to {heap}
```

The fix patterns:

- "x escapes to heap" because of interface conversion: avoid the
  conversion in the hot path, take a concrete type instead.
- "&y escapes" because `y`'s address was returned or stored: keep
  the variable scoped to the function, return a value not a pointer.
- "... argument escapes": variadic interface arguments always
  escape; use a typed slice or a fixed-arity function instead.

A benchmark with `allocs/op > 0` for a function you believed was
pure is almost always one of these three.

## 29. The interplay of GOGC and CPU

Lower GOGC values trigger GC more often. More GC = more CPU time
spent collecting = less CPU time for mutator work. A benchmark at
GOGC=50 looks slower than GOGC=200 on the same code *not because the
algorithm changed* but because GC is eating mutator time.

This is why benchmarks must declare GOGC. A 10% improvement at
GOGC=200 may vanish at GOGC=100. Both are "right" for different
deployment contexts.

The practical trick: set GOGC and GOMEMLIMIT to match production in
all your benchmarks. If production runs at GOGC=100 with a 2GB
memory limit, your benchmarks should too.

## 30. The cold-vs-hot benchmark pattern

You sometimes need to measure the *first* call's cost specifically,
not the steady-state. Examples: lazy initialisation, JIT-like setup,
cache fill. The pattern:

```go
func BenchmarkColdFirstCall(b *testing.B) {
    for i := 0; i < b.N; i++ {
        b.StopTimer()
        // Tear down any caches.
        service := newFreshService()
        b.StartTimer()
        sink = service.FirstCall()
    }
}
```

Note: `b.StopTimer/b.StartTimer` overhead is now per-iteration. For
operations under 1µs the timer overhead dominates. The cold-call
benchmark is most useful for operations >100µs (e.g. DB connection
init), where timer overhead is < 1% of measurement.

## 31. The case for benchstat in CI even if it cannot gate

Many teams say "we cannot gate on perf because CI is too noisy."
Fine — do not *gate*. Still *report*. Add a CI step that runs the
focused benchmarks and posts the benchstat output as a PR comment.
The output is informational; reviewers see whether the change moved
numbers and can ask questions. Over time the team builds intuition
about which kinds of changes move which benchmarks, and PRs get
better-reasoned perf claims.

A pre-built tool for this: `cmd/benchseries` from
`golang.org/x/perf`. It reads multiple bench files, fits a series,
and posts a delta plot. Useful for long-running PR branches that
accumulate many commits.

## 32. A reusable benchmark fixture helper

Write this once and reuse it everywhere:

```go
package benchutil

import (
    "runtime"
    "runtime/metrics"
    "sort"
    "testing"
    "time"
)

type Fixture struct {
    samples []time.Duration
    before  metricSnap
}

func Begin(b *testing.B) *Fixture {
    runtime.GC()
    f := &Fixture{
        samples: make([]time.Duration, 0, b.N),
        before:  snap(),
    }
    b.ReportAllocs()
    b.ResetTimer()
    return f
}

func (f *Fixture) Record(dur time.Duration) {
    f.samples = append(f.samples, dur)
}

func (f *Fixture) End(b *testing.B) {
    after := snap()
    sort.Slice(f.samples, func(i, j int) bool { return f.samples[i] < f.samples[j] })
    if len(f.samples) > 0 {
        b.ReportMetric(float64(f.samples[len(f.samples)/2]), "p50-ns")
        b.ReportMetric(float64(f.samples[len(f.samples)*99/100]), "p99-ns")
    }
    b.ReportMetric(float64(after.gcCycles-f.before.gcCycles), "gc-cycles")
}

type metricSnap struct {
    gcCycles uint64
}

func snap() metricSnap {
    s := []metrics.Sample{{Name: "/gc/cycles/total:gc-cycles"}}
    metrics.Read(s)
    return metricSnap{gcCycles: s[0].Value.Uint64()}
}
```

Usage:

```go
func BenchmarkProcessRequest(b *testing.B) {
    f := benchutil.Begin(b)
    for i := 0; i < b.N; i++ {
        t0 := time.Now()
        sink = processRequest(req)
        f.Record(time.Since(t0))
    }
    f.End(b)
}
```

Every benchmark using `benchutil` automatically reports p50, p99, and
GC cycles. Consistency across the suite makes benchstat comparisons
trivial.

## 33. The `-benchtime=Nx` form

`-benchtime` accepts two forms:

- Duration: `-benchtime=5s` runs each benchmark for 5 seconds.
- Iteration count: `-benchtime=1000x` runs each benchmark for exactly
  1000 iterations.

The `Nx` form is useful when:

- You want every run to do the same work (for reproducibility).
- Your benchmark has expensive setup that you precomputed for `N`
  iterations.
- You are comparing across machines and want a fixed workload, not
  a fixed wall-time budget.

Example:

```
go test -bench=BenchmarkSort -benchtime=1000x -count=10
```

The danger: if 1000 iterations is too few, the per-op time is
dominated by overhead. If too many, you run a long time. Tune to
your operation: aim for total per-run wall time around 1 second.

## 34. Distributed bench infrastructure

For large teams, individual laptop runs do not scale. The pattern
that does:

- A small fleet of dedicated bench machines (2-4 nodes), each
  identically configured.
- A queue (could be just a `kubectl` job) where developers submit
  bench requests by branch + commit.
- A storage layer (S3, GCS, or a simple file server) where outputs
  go.
- A web UI showing benchstat between any two commits.

Open-source examples:

- `golang.org/x/build/perfdata` — the Go team's own perf data store.
- Cockroach Labs publishes their bench infrastructure as
  `cockroachdb/cockroach/pkg/cmd/roachperf`.
- The `pprof.me` service for ad-hoc profile sharing.

You do not need a custom system on day one. Start with a baseline
file in git; graduate to a dedicated runner; graduate again to a
fleet when scale demands.

## 35. Differential bench under load

A specific scenario: you want to know how the bench numbers change
*when the system is busy*. Production servers are never idle. A
benchmark that runs alone on a quiet machine measures the best case.

Trick: run a synthetic noisy neighbour in the background:

```bash
# Spawn 8 CPU-bound siblings:
stress-ng --cpu 8 --timeout 60s &

# Now run the bench under load:
go test -bench=. -count=10 -benchtime=2s

wait
```

The numbers will be 2-10x worse depending on contention. The
*ratio* between two implementations should be largely preserved if
they are equally affected by noise. If one degrades more under
load, that is a signal — the more-affected one is more sensitive to
the scheduler or to cache eviction.

This is rarely the only metric you care about, but for services
that are CPU-bound under stress it is an essential complement to
the quiet-machine numbers.

## 36. The "warm up the JIT" myth

Go is not a JITted language. There is no JIT to warm up. There is,
however, *page-cache* warmup (the binary's pages are paged in on
first access) and *cache-line* warmup (your hot data needs to be in
L1/L2). The framework partially handles this by running for
`-benchtime` instead of one iteration.

If you suspect cold-cache effects are confusing your numbers,
discard the first sample of `-count=10`:

```
benchstat -filter ".sample > 1" first_run.txt
```

Or pre-warm explicitly in the bench setup with a `runtime.GC()` and
a small warmup loop:

```go
b.ResetTimer()
for i := 0; i < 100; i++ {
    sink = work() // warmup
}
runtime.GC()
b.ResetTimer() // reset again
for i := 0; i < b.N; i++ {
    sink = work()
}
```

Two `ResetTimer` calls is fine; the second wins.

## 37. Reading `-cpuprofile` output

A bench that runs with `-cpuprofile=cpu.pprof` produces a profile
that pprof can render. The relevant invocations:

```
# Top functions by cumulative time:
go tool pprof -top -cum cpu.pprof

# Diff between two profiles:
go tool pprof -base before.pprof after.pprof

# Interactive web UI with flame graph:
go tool pprof -http=:6060 cpu.pprof

# Source-annotated listing for one function:
go tool pprof cpu.pprof
(pprof) list FunctionName
```

The `list` command is the workhorse. It shows source lines annotated
with the cumulative time spent on each. A line with `1.2s (cum: 1.2s)`
in front of it is where the time goes. From there you can decide
whether the line is fundamentally slow (e.g. a syscall) or merely
called too often (a quadratic loop, an allocator hotspot).

## 38. The relationship between bench numbers and prod numbers

A common disappointment: you optimise a benchmark from 100ns to
50ns, deploy, and prod p99 drops by 2% instead of the expected 30%.
Why?

Several possible reasons:

- The function is a tiny fraction of total CPU. Halving 1% of CPU
  saves 0.5% — invisible.
- The function is fast but called in a slow context (e.g. a syscall
  before each call dominates).
- The change moved the bottleneck. Now p99 is dominated by GC or
  a different function.
- Production sees inputs the benchmark did not.

The fix is the feedback loop: instrument prod, see what dominates,
benchmark *that*. Iterate. The first cycle usually surprises you;
later cycles converge.

## 39. The `pkg.go.dev/golang.org/x/perf/cmd/benchstat` flags worth knowing

- `-delta-test=u-test|t-test|none`. The default `u-test` is Mann–Whitney; `t-test` assumes Gaussian; `none` disables significance testing.
- `-alpha=0.05` (default). The significance threshold.
- `-threshold=0%` (default). Minimum effect size.
- `-geomean`. Add geomean row.
- `-csv`. Output as CSV for spreadsheet import.
- `-html`. Output as HTML.
- `-row name`. Aggregation key for matched samples.
- `-col name`. Column-grouping key.
- `-ignore name`. Drop a key entirely.

The `-row` and `-col` flags are crucial for cross-cutting analysis.
For example to compare Go versions across benchmark sizes:

```
benchstat -col .file ... go1.21.txt go1.22.txt go1.23.txt
```

Read the godoc once; you will reach for these flags weekly.

## 40. The `-shuffle=on` flag for test stability

`-shuffle=on` randomises test order. For *benchmarks* it does not
apply directly, but the underlying lesson does: order matters. A
benchmark that runs first sees a cold runtime; one that runs after
warmup sees a different cost.

Order benchmarks deterministically (alphabetical by default) and
remember that the first one always carries warmup cost. If you want
clean steady-state numbers, put a tiny warmup bench first:

```go
func BenchmarkAAAWarmup(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = i * i
    }
}
```

The `AAA` prefix puts it first alphabetically. Now the real
benchmarks start with a hot runtime.

## 41. The `cmd/benchseries` tool

For long-running PR branches (many commits, gradual changes),
`golang.org/x/perf/cmd/benchseries` plots a series of benchstat
outputs as a chart. Workflow:

```
git log --oneline main..feature-branch > commits.txt
for sha in $(cat commits.txt); do
    git checkout $sha
    go test -bench=. -count=10 > /tmp/bench-$sha.txt
done
benchseries -kind ns/op /tmp/bench-*.txt > series.html
```

The HTML output shows a chart of the median over commits. You can
see *which commit* moved the number, not just "the branch is
faster". For a 50-commit branch this is the difference between a
useful PR review and a useless one.

## 42. The `t.Helper()` analogue in benchmarks

Benchmarks do not have a `b.Helper()` (as of the time of writing).
A common workaround for shared bench helpers:

```go
func benchSomething(b *testing.B, n int) {
    b.Helper() // No-op for benches; harmless.
    data := buildFixture(n)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sink = something(data)
    }
}

func BenchmarkSomething100(b *testing.B)  { benchSomething(b, 100) }
func BenchmarkSomething1000(b *testing.B) { benchSomething(b, 1000) }
```

The `b.Helper()` call is harmless (it is inherited from `testing.B`'s
embedding of common). The wrapper functions give you named, easy-
to-filter benchmarks while sharing the fixture logic.

## 43. The `testing.AllocsPerRun` function

For *non-benchmark* allocation checks, `testing.AllocsPerRun(n, f)`
runs `f` n times and reports average allocations. Useful for unit
tests that assert "this function does not allocate":

```go
func TestNoAllocs(t *testing.T) {
    avg := testing.AllocsPerRun(100, func() {
        sink = squareInt(42)
    })
    if avg != 0 {
        t.Errorf("got %v allocs/op, want 0", avg)
    }
}
```

Not a benchmark, but related to bench discipline: it enforces
allocation-free contracts in CI without needing benchstat.

## 44. The `pprof` for a benchmark: an example walkthrough

You ran `BenchmarkProcessRequest` and got `45µs ± 2%`. Where does
the time go?

```bash
go test -bench=BenchmarkProcessRequest -cpuprofile=cpu.pprof \
    -count=1 -benchtime=10s
go tool pprof -top -cum cpu.pprof | head -20
```

Output:

```
Showing top 20 nodes out of 142
      flat  flat%   sum%        cum   cum%
     2.34s 23.40% 23.40%      2.34s 23.40%  runtime.mallocgc
     0.00s     0     23.40%   7.21s 72.10%  myapp.handleRequest
     1.21s 12.10% 35.50%      1.21s 12.10%  encoding/json.Marshal
     0.85s  8.50% 44.00%      0.85s  8.50%  runtime.scanobject
     0.50s  5.00% 49.00%      0.50s  5.00%  syscall.Write
     ...
```

Read top-down:

- `runtime.mallocgc` 23% — heavy allocation. Reduce.
- `encoding/json.Marshal` 12% — the encoder is hot. Consider
  alternatives.
- `runtime.scanobject` 8.5% — GC is busy. Symptom of high alloc
  rate.
- `syscall.Write` 5% — writing the response. Probably can be
  buffered.

Action items emerge from the profile: reduce allocations (saves
mallocgc + scanobject), replace encoder if hot (saves the 12%),
buffer writes (saves syscall.Write).

Without the profile you would guess; with it you have a ranked
list.

## 45. The `GODEBUG=gctrace=1` signal

Set `GODEBUG=gctrace=1` and run your benchmark. Each GC cycle
prints a line like:

```
gc 14 @0.123s 3%: 0.012+1.8+0.008 ms clock, 0.097+0.21/1.5/3.6+0.066 ms cpu, 8->9->4 MB, 9 MB goal, 16 P
```

Decode:

- `gc 14` — cycle number.
- `@0.123s` — wall time since process start.
- `3%` — total CPU spent in GC.
- `0.012+1.8+0.008 ms clock` — STW sweep + concurrent + STW mark
  termination wall times.
- `8->9->4 MB` — heap size before, after, live after.
- `9 MB goal` — target heap for next cycle.

For a benchmark, watch the percentage. If it grows above 5-10%
your code is GC-pressured; reducing allocs/op is the highest-
leverage fix. The `goal` column shows whether the pacer is
keeping up.

## 46. The `runtime.GC()` knob in tests

Sometimes a benchmark needs deterministic GC behaviour. Two tricks:

- `runtime.GC()` before `b.ResetTimer()` ensures the heap is clean
  before timing begins.
- `runtime.SetGCPercent(-1)` disables GC for the duration of the
  bench. Useful for *isolating* mutator throughput from GC. Not
  representative of prod but informative for understanding
  bottlenecks.

```go
old := runtime.SetGCPercent(-1)
b.ResetTimer()
// ... benchmark body ...
runtime.SetGCPercent(old)
```

Restore the original at the end (using `b.Cleanup` is even safer).
Forgetting to restore can taint subsequent benchmarks.

## 47. Reading the runtime trace

`go tool trace trace.out` opens an interactive web UI. The most
useful views:

- "Goroutines" timeline — when each goroutine ran, blocked, was
  scheduled.
- "Heap" timeline — heap size over wall time.
- "Network blocking profile" — network-induced waits.
- "Scheduler latency profile" — how long goroutines waited to be
  scheduled.

For a benchmark that looks slow but has low CPU usage, the
goroutines view often reveals the answer: goroutines blocking on
each other (channel, mutex, syscall). Without trace this is
guesswork.

## 48. The `-shuffle=on` and benchmark stability

`-shuffle=on` randomises test order each run; it does not affect
bench order. But the underlying principle — that order can affect
results — applies to benchmarks too. The framework runs benchmarks
in source order by default. To detect order dependence:

```bash
go test -bench=BenchmarkA,BenchmarkB -count=10 > forward.txt
go test -bench=BenchmarkB,BenchmarkA -count=10 > reverse.txt
benchstat forward.txt reverse.txt
```

If the deltas are large, the benchmarks influence each other (e.g.
one warms a cache the other reads). Either accept this or
restructure to make each bench self-contained.

## 49. The TC malloc Go-specific tuning

Go's allocator is derived from TCMalloc but tuned for the Go
runtime. Some Go-specific knobs:

- `GOGC=100` (default) — the heap trigger.
- `GOMEMLIMIT` — the soft cap.
- `GODEBUG=allocfreetrace=1` — costly trace of every alloc/free.
- `GODEBUG=invalidptr=1` — costly check of pointer validity.

These exist for diagnosis, not perf tuning. For perf, the two main
levers remain GOGC and GOMEMLIMIT.

## 50. `runtime.Stack` and `runtime.Callers` cost in benchmarks

Some benchmarks inadvertently call into the runtime's stack-walking
functions. Examples:

- A logging library that captures stack on every call.
- An error library that records the construction site.
- A custom metric that records call site by stack frame.

`runtime.Caller(1)` is ~100ns; `runtime.Callers(0, buf)` is
~500ns-1µs depending on stack depth. If your hot path triggers
one of these you will see surprise costs.

Diagnose with `pprof`: `runtime.callers` showing up in the top
flame is the signal. Mitigate by lazy-initialising the call-site
data only when the error is converted to a string.

## 51. The `go test -json` output

`-json` outputs structured events instead of human-readable text.
Each bench result becomes a JSON event:

```json
{"Action":"output","Package":"x","Test":"BenchmarkX","Output":"BenchmarkX-8\t100\t12.3 ns/op\n"}
{"Action":"bench","Package":"x","Test":"BenchmarkX","Output":"PASS"}
```

Useful when feeding bench results into a custom analysis pipeline.
Many CI systems consume the JSON natively.

## 52. The bench command in `go test` vs `go test -bench`

A subtle point: `go test` (no flag) runs unit tests but skips
benches. `go test -bench=.` runs benches *and* tests (unless you
add `-run=^$`). To run only benches without tests:

```
go test -bench=. -run=^$ ./...
```

This is the muscle-memory invocation. Adopt it as the team standard
to avoid the "why is the bench run also running my flaky test"
problem.

## 53. Closing on the middle

The middle page covered: per-iteration timing for percentiles, the
Mann–Whitney U test, noise floor measurement, CPU pinning, cache
awareness, inlining and escape inspection, GC tuning, Go-version
cross-comparison, parallel benchmarks, and a reusable fixture
helper. With these tools you can produce numbers that survive
review.

The senior page goes deeper into the machine model (cache, branch
prediction, NUMA, frequency scaling internals), the toolchain (PGO,
build tags, link-time options), and how to design a benchmark suite
that survives years of code churn. If you have mastered the middle
material, that is the next step.

[← Back](../)
