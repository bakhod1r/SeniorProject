---
layout: default
title: Benchmark Deep — Senior
parent: Benchmarking Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/senior/
---

# Benchmark Deep — Senior

[← Back](../)

The senior page is for engineers who own performance — who are expected to defend numbers in a design review, design a benchmark suite for a long-lived service, and own the diagnostic when production p99 grows by 8% with no obvious cause. The material below is denser; it assumes the middle page is internalised.

## 1. The benchmark as an experiment

Treat each benchmark as a scientific experiment. An experiment has:

- A **hypothesis**: "switching `map[string]int` to a `radix.Tree` will reduce p99 lookup by 30% for keys >40 chars."
- An **independent variable**: the data structure choice.
- A **dependent variable**: p99 lookup time.
- **Controls**: input distribution, key length, hardware, Go version, GOMEMLIMIT, all unchanged across the two arms.
- A **null result region**: define before running what would falsify the hypothesis (e.g., "delta < 5% or `p > 0.05`").

If you cannot fill in all five, you do not have a benchmark; you have a fishing expedition. The discipline is unusual in software engineering but normal in any field that takes measurement seriously. Senior engineers internalise it.

## 2. Confidence intervals beyond the median

benchstat shows `±X%` around the median. That number is the half-width of the interquartile range or a similar robust spread. It is not a 95% confidence interval. For tighter analysis:

- Bootstrap the median: resample `n` values with replacement from your samples 10,000 times, compute the median of each resample, take the 2.5th and 97.5th percentile of those medians. That is a 95% CI for the median.
- For a difference of medians, do the bootstrap on the *difference*, not on each side separately.
- Read about Bessel's correction, Welch's t-test, and Bonferroni correction when comparing many benchmarks at once.

The reason this matters: if you have 100 benchmarks and you compare each at `α = 0.05`, you expect ~5 false positives by chance. Without Bonferroni or a similar correction your "significant regressions" list will be 5% noise. Senior teams either Bonferroni-correct or use a hierarchical FDR (false discovery rate) method.

## 3. Geometric mean for suite-level comparison

You ran 30 benchmarks; the team asks "is the new release faster?" Reporting "20 faster, 7 slower, 3 unchanged" is true but unhelpful. The right summary is the geometric mean of the per-benchmark ratios:

```
ratio_i = new_i / old_i
gmean = (prod ratio_i)^(1/n)
```

Geometric mean is correct because performance is multiplicative. A benchmark that goes 2x slower and another that goes 2x faster cancel out under geometric mean (ratio 0.5 and 2; gmean = 1). They do not cancel under arithmetic mean — the slower one dominates.

benchstat does not print geomean by default but can with `-geomean`. Use it whenever you summarise across benchmarks.

## 4. The cache hierarchy and what benchmarks see

A modern CPU has L1 (~32KB, 1ns), L2 (~256KB-1MB, 3-5ns), L3 (~MB, 10-15ns), and main memory (~100ns). The Go benchmark framework warms caches by running your code many times before reporting; this puts you in the *hot* regime.

For data structures, the regime that matters is the *application's* regime. A `sync.Map` for a service with 10 keys is always hot — measure it hot. A `sync.Map` keyed by user ID with 100M users is always cold — measure it after polluting the cache with a 100MB working set.

A useful pattern is to parametrise benchmarks by working-set size and plot the curve:

```go
for _, wssMB := range []int{1, 8, 64, 512} {
    b.Run(fmt.Sprintf("WSS=%dMB", wssMB), func(b *testing.B) {
        wss := make([][]byte, wssMB*1024/blockSize)
        for i := range wss {
            wss[i] = make([]byte, blockSize)
        }
        b.ResetTimer()
        for i := 0; i < b.N; i++ {
            // Touch one block per iteration to advance through wss.
            sink = process(wss[i%len(wss)])
        }
    })
}
```

The output is a series: WSS=1MB → 5ns, WSS=8MB → 12ns, WSS=64MB → 35ns, WSS=512MB → 90ns. The shape of this curve reveals where the cache hierarchy stops helping. Senior performance work optimises both ends: keep WSS in L2 when possible, optimise the cold path when not.

## 5. Branch prediction

CPUs predict the direction of conditional branches. Predictable branches (e.g. a sorted-data filter where most elements pass) are nearly free; unpredictable branches (random data) cost ~10-20 cycles per misprediction. This is the entire reason Quicksort's branch behaviour differs by input distribution.

To measure branch effects:

```go
func BenchmarkBranchSorted(b *testing.B) {
    data := make([]int, 1<<20)
    rng := rand.New(rand.NewSource(1))
    for i := range data {
        data[i] = rng.Intn(256)
    }
    sort.Ints(data) // sorted -> predictable

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sum := 0
        for _, x := range data {
            if x > 128 {
                sum += x
            }
        }
        sink = sum
    }
}

func BenchmarkBranchRandom(b *testing.B) {
    data := make([]int, 1<<20)
    rng := rand.New(rand.NewSource(1))
    for i := range data {
        data[i] = rng.Intn(256)
    }
    // not sorted

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sum := 0
        for _, x := range data {
            if x > 128 {
                sum += x
            }
        }
        sink = sum
    }
}
```

On x86 you will see the random version 2-3x slower than the sorted version for *identical code* on *identical data with the same arithmetic mean*. The difference is branch prediction. Senior engineers know this exists and reach for *branchless* idioms in hot inner loops:

```go
// Branchless: convert the condition to an arithmetic mask.
mask := -((x - 129) >> 63)  // ~0 if x > 128 else 0
sum += x & mask
```

This is ugly Go but if the loop is a measured hotspot it is sometimes worth it.

## 6. PGO in depth

`go build -pgo=default.pgo` reads a CPU profile and biases compilation. As of Go 1.23 the inliner uses the profile to inline hot call sites past the default cost budget. The runtime devirtualises some interface calls based on the profile.

Profile collection in production:

```go
import (
    "net/http"
    _ "net/http/pprof"
)
go http.ListenAndServe("localhost:6060", nil)
// curl http://localhost:6060/debug/pprof/profile?seconds=30 > prof.pb.gz
```

Build with the profile:

```bash
go build -pgo=prof.pb.gz -o myapp ./cmd/myapp
```

Benchmark with PGO:

```bash
go test -bench=. -pgo=prof.pb.gz -count=10
```

The compare:

```bash
go test -bench=. -count=10 > nopgo.txt
go test -bench=. -pgo=prof.pb.gz -count=10 > pgo.txt
benchstat nopgo.txt pgo.txt
```

Typical wins: 2-10% on service workloads. Benchmarks that exercise one hot function very narrowly may show no win because the compiler was already inlining it.

The trap: a profile collected under a non-representative workload makes the wrong functions hot. PGO is then biased *against* your benchmark. Always collect under representative load.

## 7. CI integration: the regression detector

A naive CI gate: "run bench, fail if any benchmark is >5% slower." This produces hundreds of false positives a week on shared runners. Better designs:

**Tiered**: smoke on every PR, focused on merge, full nightly. (Covered in professional page.)

**Statistical**: per-PR, run baseline and HEAD on the *same* CI worker, alternating, e.g. `b0 h0 b1 h1 ... b9 h9` (20 runs total). The alternation cancels slow-drift noise (a worker getting hotter over time). benchstat the two groups. Gate on `p < 0.01 AND delta > 5%`. This is roughly what `golang.org/x/build`'s perfrunner does.

**Trend-based**: post-merge, store the median into a TSDB. Once a week, run a CUSUM detector over the last 90 days. The CUSUM finds *change points* (when the level shifted) rather than per-day deltas. This catches the slow 0.5%/week creep that no per-PR gate would notice.

The right design depends on your team's cost tolerance for false positives vs false negatives.

## 8. The noisy CI problem

Public cloud CI runners share hardware with arbitrary other tenants. The noise floor is 10-30% even with care. Mitigations:

- Use *bare metal* CI runners for perf gates. GitHub Actions, Buildkite, and CircleCI all offer this; the per-hour cost is 2-5x but the noise drops to 1-3%.
- Within a runner, pin to a core and disable turbo.
- Run baseline and HEAD on the *same* runner in the *same* invocation. Cross-runner comparison is unreliable.
- Repeat with `-count=20` minimum. The marginal cost of more samples is small; the statistical power gain is large.
- Accept a 5-10% threshold. Trying to detect 2% on noisy CI is wishful thinking.

## 9. runtime/metrics deep dive

`runtime/metrics` is the right tool for benchmarks that need *system-level* signals: GC frequency, scheduler latency, mutex wait. Here is a wrapper that snapshots before/after a benchmark and reports the diff:

```go
type metricSnap struct {
    gcCycles, gcCPU, schedLatP99, mutexWait uint64
}

var metricNames = []string{
    "/gc/cycles/total:gc-cycles",
    "/gc/cpu-time:seconds",
    "/sched/latencies:seconds",
    "/sync/mutex/wait/total:seconds",
}

func snapshot() metricSnap {
    samples := make([]metrics.Sample, len(metricNames))
    for i, n := range metricNames {
        samples[i].Name = n
    }
    metrics.Read(samples)
    var s metricSnap
    s.gcCycles = samples[0].Value.Uint64()
    s.gcCPU = uint64(samples[1].Value.Float64() * 1e9)
    if hist := samples[2].Value.Float64Histogram(); hist != nil {
        s.schedLatP99 = pctHist(hist, 0.99)
    }
    s.mutexWait = uint64(samples[3].Value.Float64() * 1e9)
    return s
}

func pctHist(h *metrics.Float64Histogram, q float64) uint64 {
    total := uint64(0)
    for _, c := range h.Counts {
        total += c
    }
    target := uint64(float64(total) * q)
    cum := uint64(0)
    for i, c := range h.Counts {
        cum += c
        if cum >= target {
            return uint64(h.Buckets[i] * 1e9)
        }
    }
    return uint64(h.Buckets[len(h.Buckets)-1] * 1e9)
}

func BenchmarkServiceLoop(b *testing.B) {
    before := snapshot()
    for i := 0; i < b.N; i++ {
        sink = serviceLoopIter()
    }
    after := snapshot()
    b.ReportMetric(float64(after.gcCycles-before.gcCycles), "gc-cycles")
    b.ReportMetric(float64(after.gcCPU-before.gcCPU)/float64(b.N), "gc-cpu-ns/op")
    b.ReportMetric(float64(after.schedLatP99), "sched-p99-ns")
    b.ReportMetric(float64(after.mutexWait-before.mutexWait)/float64(b.N), "mutex-ns/op")
}
```

This wrapper turns a benchmark into a small system-health probe. Comparing with benchstat tells you whether a change moved GC, scheduling, or mutex contention. Citation: `golang.org/pkg/runtime/metrics`.

## 10. GOGC / GOMEMLIMIT tuning experiments

A common senior-level task: pick the right `GOMEMLIMIT` for a service. The technique:

```bash
for mem in 256MiB 384MiB 512MiB 768MiB 1GiB; do
    GOMEMLIMIT=$mem go test -bench=BenchmarkSteadyState \
        -count=10 -benchtime=5s ./... > "out_${mem}.txt"
done

for mem in 256MiB 384MiB 512MiB 768MiB 1GiB; do
    echo "=== $mem ==="
    grep -E "ns/op|gc-cpu-ns/op|p99-ns" "out_${mem}.txt"
done
```

Plot the result. The shape is typically:

- At low GOMEMLIMIT (heap pressure), throughput drops and GC CPU rises.
- At moderate GOMEMLIMIT (near working-set), GC CPU is minimum, throughput is highest.
- At high GOMEMLIMIT (memory abundant), GC is rare, throughput is high, but you waste memory.

The knee of the curve is the right setting. Senior engineers do this exercise once per major workload change, not once per release.

## 11. Long-tail benchmarks

For services where the tail matters, run benchmarks for *minutes*, not seconds. `-benchtime=60s -count=5` gives you 5 minutes per benchmark, enough time for GC to fire many times, for the scheduler to do many rebalances, for caches to evict and refill. The mean tells you the typical cost; the p99 over 60s gives you a real tail measurement.

The trade-off: a CI suite of 30 benchmarks at 5 minutes each is 2.5 hours. Reserve long-tail bench for the *contract* benchmarks (the 3-5 that gate the service's perf SLO), not the whole suite.

## 12. Profile-guided benchmarking

You ran the suite. One benchmark moved by 12%; you want to know *why*. The procedure:

```bash
go test -bench=BenchmarkSlow -cpuprofile=before.pprof -count=10
git checkout new-branch
go test -bench=BenchmarkSlow -cpuprofile=after.pprof -count=10
```

```bash
go tool pprof -base before.pprof after.pprof
(pprof) top -cum
(pprof) list FunctionName
```

`-base` makes pprof show the *difference* between profiles. Positive samples are functions that got slower; negative are functions that got faster. This is the fastest way to localise a regression: instead of reading 10k lines of diff you get the 3 functions that account for it.

Flame graphs (`go tool pprof -http=:6060`) are visual but slower to scan. For an experienced engineer, `top -cum` plus `list` is the daily-driver pair.

## 13. The hot-path measurement on net/http handlers

A real example. You have an HTTP handler whose p99 grew by 8% after a refactor. To measure in a benchmark:

```go
func BenchmarkAPIRoute(b *testing.B) {
    srv := newTestServer(b)
    body := []byte(`{"id":"123","action":"do"}`)

    b.ReportAllocs()
    b.ResetTimer()

    samples := make([]time.Duration, b.N)
    for i := 0; i < b.N; i++ {
        req := httptest.NewRequest("POST", "/api/v1/do", bytes.NewReader(body))
        w := httptest.NewRecorder()
        t0 := time.Now()
        srv.Handler.ServeHTTP(w, req)
        samples[i] = time.Since(t0)
        if w.Code != 200 {
            b.Fatal("non-200")
        }
    }

    sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
    b.ReportMetric(float64(samples[len(samples)/2]), "p50-ns")
    b.ReportMetric(float64(samples[len(samples)*99/100]), "p99-ns")
}
```

Use `httptest.NewRecorder` (in-memory) not a real TCP socket, otherwise you measure the syscall cost and the kernel's TCP stack which dwarfs anything you can change.

If the regression replicates in this microbenchmark, it is in the handler code. If not, it is in something the test harness skips (TLS, middleware not exercised here, DB roundtrip). Bisect to find which.

## 14. Build flag combinations you must know

```bash
# Standard fast build, the default.
go build ./...

# With PGO from a saved profile.
go build -pgo=default.pgo ./...

# With race detector — about 5-10x slower, do not use in perf benches.
go build -race ./...

# With trimpath, stable across machines.
go build -trimpath ./...

# Stripped binary, smaller, no behavioural change at runtime.
go build -ldflags="-s -w" ./...

# Disable optimisation and inlining (debug builds).
go build -gcflags="all=-N -l" ./...

# Print all inlining/escape decisions.
go build -gcflags="all=-m=2" ./...

# Set GOAMD64=v3 to assume modern x86 (AVX2 etc).
GOAMD64=v3 go build ./...
```

Each of these can change benchmark numbers. Senior engineers document which flags are in use for any published number.

## 15. Detecting subtle regressions: the CUSUM method

A 5% regression in a single PR is hard to miss. A 0.1%-per-week
creep across 50 PRs over a year compounds to 5% — and no per-PR
gate would see it. You need a *trend-aware* detector.

CUSUM (cumulative sum) is the standard tool. The idea: maintain a
running sum of (sample - mean), where the mean is the expected
steady-state level. When the cumulative sum exceeds a threshold,
the level has shifted.

A simplified Go implementation for daily monitoring:

```go
type CUSUM struct {
    mean      float64
    threshold float64
    posSum    float64
    negSum    float64
}

func (c *CUSUM) Add(x float64) (alert string) {
    diff := x - c.mean
    c.posSum = max(0, c.posSum+diff-c.threshold)
    c.negSum = min(0, c.negSum+diff+c.threshold)
    if c.posSum > 5*c.threshold {
        return "positive shift detected"
    }
    if c.negSum < -5*c.threshold {
        return "negative shift detected"
    }
    return ""
}
```

Feed it the nightly median. When it fires, you have a *change
point* — a date where the level shifted. Bisect git between that
date and the previous quiet date to find the responsible commit.
This is how to catch slow regressions that no per-PR diff would
notice.

The tunable: the threshold. Too low and you fire on noise; too high
and you miss real shifts. Calibrate by running CUSUM on historical
data and finding the threshold that maximises true-positive rate
at an acceptable false-positive rate.

## 16. The bisect workflow for perf

When CUSUM (or a complaint from on-call) tells you "perf regressed
between dates A and B", you bisect:

```bash
git bisect start
git bisect bad <date-B-commit>
git bisect good <date-A-commit>
# Loop:
go test -bench=BenchmarkContract -count=10 -benchtime=2s > /tmp/now.txt
benchstat /tmp/baseline.txt /tmp/now.txt
# If significantly worse: git bisect bad
# If not: git bisect good
```

The challenge: each step takes minutes (the bench), so a 14-step
bisect (across 16k commits) takes hours. Three optimisations:

1. **Bisect on a subset.** Pick the one bench that most clearly
   shows the regression. Skip the rest.
2. **Bisect with `-count=5` first.** When a step is ambiguous, raise
   to `-count=20` for that step only.
3. **Run the bisect on the pinned runner**, not your laptop. The
   noise floor of your laptop will make many steps ambiguous.

A scripted `git bisect run`:

```bash
git bisect run bash -c '
    go test -bench=BenchmarkContract -count=5 -benchtime=2s > now.txt
    delta=$(benchstat baseline.txt now.txt | grep delta | awk "{print \$5}")
    # If delta > 5%, this commit is bad.
    [[ ${delta%\%} -lt 5 ]]
'
```

A four-hour automated bisect that lands on the right commit is much
cheaper than four hours of human staring at git log.

## 17. The macro vs micro benchmark distinction

A microbenchmark measures one function in isolation. A
macrobenchmark exercises the system end-to-end (network, parser,
allocator, GC). Each tells you something the other cannot:

- Micro tells you "function X is 23% faster after the change."
- Macro tells you "p99 of /api/foo dropped 8% — *some* combination
  of changes did it."

A senior is comfortable in both modes. The pitfall is using one
when you need the other:

- Using only micro: you optimise things that do not move prod.
- Using only macro: you cannot localise *why* prod moved.

The discipline is to write a macrobench first ("does the SLO hold?"),
then drill down with micros only when macro shows a problem.

A macrobench template:

```go
func BenchmarkServiceMacro(b *testing.B) {
    srv := startRealishServer(b) // realistic deps, in-process DB, etc.
    defer srv.Close()
    client := srv.Client()

    workload := loadProductionTrace(b, "trace-2024-09.json")

    b.ResetTimer()
    samples := make([]time.Duration, 0, b.N)
    for i := 0; i < b.N; i++ {
        req := workload[i%len(workload)]
        t0 := time.Now()
        resp, err := client.Do(req)
        samples = append(samples, time.Since(t0))
        if err != nil || resp.StatusCode >= 500 {
            b.Fatal("request failed")
        }
        resp.Body.Close()
    }
    reportQuantiles(b, samples)
}
```

The `loadProductionTrace` is the key: a replay of real production
traffic, captured anonymised, gives realistic input distribution. A
synthetic uniform distribution misses the long tail that production
shows.

## 18. NUMA awareness in benchmarks

Multi-socket servers have non-uniform memory access: memory
attached to socket 0 is fast for socket 0's CPUs and slow for
socket 1's. Go is *not* NUMA-aware natively. The allocator does
not know which socket needs which memory. Result: on dual-socket
machines a Go program can spend 20-40% more time on memory access
than necessary.

For benchmarks the answer is to pin everything to one socket:

```bash
numactl --cpunodebind=0 --membind=0 go test -bench=. -count=10
```

This forces all execution and allocation onto NUMA node 0. The
numbers now match what a single-socket production machine would
see. For dual-socket production, the macrobench should run on a
dual-socket runner with no NUMA pinning to expose the cross-socket
cost.

Both numbers are useful: the pinned single-socket bench measures
*algorithm*; the un-pinned dual-socket bench measures *deployment*.

## 19. The `go test -benchmem` invariant

`-benchmem` adds two columns: `B/op` and `allocs/op`. Both are
*exact*: they are computed by counting heap allocations, not
sampled. This makes them the most reliable signal in your bench
output.

Consequence: a single bench run with `-count=1` produces a reliable
allocs/op figure even though it produces a noisy ns/op. If you only
have one shot at a benchmark (e.g. on a hostile CI environment),
trust the alloc columns and discount the time column.

This is also why "drop allocs/op to zero" is a useful sub-goal: it
is *measurable* with zero noise. Once allocs/op is zero, ns/op is
dominated by CPU work which can be optimised by different
techniques.

## 20. The runtime/metrics histogram extraction

`/sched/latencies:seconds` is a histogram. It is the most useful
runtime signal you have: it tells you the scheduler's distribution
of goroutine wait times. P99 of this histogram should be in low
microseconds in a healthy Go service. P99 in milliseconds means
the scheduler is sometimes preempted or starved.

To extract:

```go
func schedLatencyP99() time.Duration {
    samples := []metrics.Sample{{
        Name: "/sched/latencies:seconds",
    }}
    metrics.Read(samples)
    h := samples[0].Value.Float64Histogram()
    if h == nil {
        return 0
    }
    total := uint64(0)
    for _, c := range h.Counts {
        total += c
    }
    target := uint64(float64(total) * 0.99)
    cum := uint64(0)
    for i, c := range h.Counts {
        cum += c
        if cum >= target {
            // Bucket i covers [Buckets[i], Buckets[i+1])
            return time.Duration(h.Buckets[i] * float64(time.Second))
        }
    }
    return time.Duration(h.Buckets[len(h.Buckets)-1] * float64(time.Second))
}
```

Sample this in your benchmark before and after the work. A large
diff in p99 means the scheduler had a bad time during your bench
(GC, mutex, runtime issue). Report it as a custom metric.

## 21. The `/sync/mutex/wait/total:seconds` metric

This is the total time *all* goroutines waited on contended
mutexes during the process lifetime. Sampled before and after a
benchmark, the diff tells you how much mutex contention your
benchmark induced:

```go
func mutexWaitNanos() uint64 {
    s := []metrics.Sample{{Name: "/sync/mutex/wait/total:seconds"}}
    metrics.Read(s)
    return uint64(s[0].Value.Float64() * 1e9)
}
```

A benchmark with `b.N = 10^6` that shows 50ms of mutex wait is
spending 50ns per iteration in lock contention. If your function
should take 10ns total, mutex wait is 5x the work — your benchmark
exposes a contention problem.

Conversely, if mutex wait is near zero, contention is not the
bottleneck and you should look elsewhere.

## 22. Bench-time tracing

`go test -bench=. -trace=trace.out` captures an execution trace.
Open with `go tool trace trace.out`. The browser opens; you see
the runtime's actual schedule across CPUs.

Useful for benchmarks that involve goroutines or channels: the
trace shows you exactly when goroutines blocked, on what, and for
how long. Without trace, "10µs p99" is mysterious; with trace,
"10µs p99 because of channel send blocking" is actionable.

Trace files are large (10-100MB for a few seconds of work). For
long bench runs you may run out of disk. Use a shorter `-benchtime`
when collecting trace data; the goal is qualitative understanding,
not statistical precision.

## 23. The PGO-aware benchmark fixture

When PGO is in play, the bench fixture must specify the profile:

```
PGO: default-2024-09-15.pgo (commit abc123, weekly aggregate)
```

Without this line, a benchmark run is not reproducible. A different
profile produces different inlining and different numbers.

Best practice: pin the PGO profile in git (the file is small,
~MB). The bench fixture references the git path. A run from any
machine, given the same profile, produces matching inlining
decisions.

When you compare *with* vs *without* PGO, run both variants in the
*same* invocation:

```
go test -bench=. -count=10 > nopgo.txt
go test -bench=. -count=10 -pgo=default.pgo > pgo.txt
benchstat nopgo.txt pgo.txt
```

The delta is the PGO win.

## 24. The release-validation suite

Before adopting a new Go version in production, run the release-
validation suite:

- All contract benchmarks under old and new Go, on the pinned
  runner.
- All performance-sensitive macrobenches.
- A 24-hour soak test of a representative service under the new Go.

The reason: Go runtime changes can have non-obvious effects.
Examples from history:

- Go 1.14 introduced async preemption, fixing some hangs but
  occasionally slowing tight loops.
- Go 1.18 introduced generics, which initially had a 1-2% overall
  perf hit due to dictionary-based dispatch.
- Go 1.20 changed the GC pacer, improving steady-state but
  occasionally causing thrash on memory-constrained services.

Each was caught by teams running release-validation suites *before*
prod adoption. Teams without such suites caught them in prod, which
is more expensive.

## 25. SIMD and `GOAMD64`

Go's compiler does not auto-vectorise to SIMD (as of the time of
writing) in the way `clang` or `gcc` does. But the standard library
includes hand-written SIMD assembly for hot functions
(`bytes.IndexByte`, `crypto/sha256`, `encoding/base64`). The
`GOAMD64=v3` env at build time enables the v3 baseline (AVX2,
BMI2), letting the assembly use richer instructions.

For your own benchmarks:

```bash
GOAMD64=v3 go test -bench=. -count=10 > v3.txt
GOAMD64=v1 go test -bench=. -count=10 > v1.txt
benchstat v1.txt v3.txt
```

If your hot path goes through `bytes.IndexByte` or a similar
standard library function, you may see 2-3x speedups on AVX2-
enabled machines. If your hot path is pure Go arithmetic with no
SIMD-eligible calls, the delta is zero.

Important: Go binaries built with GOAMD64=v3 *will not run* on CPUs
that lack AVX2. Choose the baseline that matches your minimum
production hardware.

## 26. Cgo and benchmarks

Cgo calls have a fixed overhead: ~50-150ns per call on modern
hardware due to stack switching, GMP shuffling, and signal-mask
restoration. A benchmark that wraps a C function does not measure
the C function in isolation; it measures the wrapper overhead plus
the work.

If your benchmark says "C function X takes 200ns", you may be
measuring 150ns of cgo overhead and 50ns of actual work. To
isolate:

- Bench a C-no-op (`extern void cnoop(void) {}`) to measure cgo
  overhead.
- Subtract from your function's measurement.
- Better: batch C work so the overhead amortises. Process 1000
  elements per cgo call, not one.

The cgo overhead is one of the hardest invisible costs in Go perf
work. A senior recognises it on sight when the per-call time has a
flat floor around 50-150ns regardless of input size.

## 27. The escape-to-heap as a regression signal

A perf regression has many possible causes. The most actionable is
an escape regression: a function that used to keep a value on the
stack now puts it on the heap. The diagnostic:

```bash
# In the old commit:
go build -gcflags="-m" ./pkg/... 2>old.escapes
# In the new commit:
go build -gcflags="-m" ./pkg/... 2>new.escapes
# Diff:
diff old.escapes new.escapes | grep -E "(escapes|moved to heap)"
```

A new "moved to heap" line is your regression. Find the source line,
read the code, and the cause is usually one of:

- An interface return type was introduced.
- A function newly captures a local in a closure.
- A pointer return path was added.
- An untyped `interface{}` was passed somewhere.

Each has a known fix pattern. The senior diagnostician finds the
escape, identifies the cause, and proposes the fix without running
a benchmark.

## 28. Mutex profile and `runtime.SetMutexProfileFraction`

For benchmarks of contended code, `runtime.SetMutexProfileFraction(1)`
enables the mutex profile. Then:

```bash
go test -bench=. -mutexprofile=mutex.pprof -count=1 -benchtime=10s
go tool pprof -top mutex.pprof
```

Shows the call stacks that hold contended locks. A bench whose ns/op
is dominated by mutex wait will reveal *which* mutex is the
bottleneck. Often the answer is "the one I expected"; sometimes it
is "the sync.Pool internal mutex" or "the runtime's m-list", which
points to a different optimisation entirely.

## 29. Block profile

`runtime.SetBlockProfileRate(1)` enables the block profile, which
records goroutine-blocking events (channel, mutex, system call).
Useful for benchmarks of concurrent code that show high latency but
low CPU usage — the goroutines are blocking, not computing.

```bash
go test -bench=. -blockprofile=block.pprof -count=1 -benchtime=10s
go tool pprof -top -cum block.pprof
```

The top stack is where most blocked time accumulates. Often a
surprise: a goroutine you thought was running is actually waiting
on a channel that filled up.

## 30. The cache-line padding trick

A struct of two `int64` fields:

```go
type Counter struct {
    A int64
    B int64
}
```

Lives in a single 16-byte stretch of memory, which fits inside one
64-byte cache line. If goroutine 1 modifies `A` and goroutine 2
modifies `B`, they bounce the cache line between cores — false
sharing.

Bench it:

```go
func BenchmarkFalseSharing(b *testing.B) {
    var c Counter
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for i := 0; i < b.N; i++ {
            atomic.AddInt64(&c.A, 1)
        }
    }()
    go func() {
        defer wg.Done()
        for i := 0; i < b.N; i++ {
            atomic.AddInt64(&c.B, 1)
        }
    }()
    wg.Wait()
}
```

Now pad to separate cache lines:

```go
type CounterPadded struct {
    A    int64
    _pad [56]byte
    B    int64
}
```

Re-bench. You will see 3-10x speedup. The padding wastes 56 bytes
but eliminates cache-line bouncing. This is a senior-level move:
recognising false sharing in your bench and fixing it with a small
layout change.

## 31. The `unsafe.Sizeof` audit

When optimising struct layouts, `unsafe.Sizeof` tells you the
actual size including padding. A struct with poor field order
wastes bytes:

```go
type Bad struct {
    A byte  // 1 byte + 7 padding
    B int64 // 8 bytes
    C byte  // 1 byte + 7 padding
} // total 24 bytes
```

Reorder by descending size:

```go
type Good struct {
    B int64 // 8 bytes
    A byte
    C byte
    // 6 bytes padding
} // total 16 bytes
```

Now the struct is 33% smaller. For a slice of millions of these the
memory savings are real, and cache utilisation improves
proportionally.

Tools: `golangci-lint`'s `fieldalignment` linter (or
`golang.org/x/tools/go/analysis/passes/fieldalignment`) automates
the audit and proposes the right order.

## 32. Benchmark longevity: when to delete

A benchmark suite grows. After two years your suite has 300
benchmarks and takes 4 hours to run. Some are redundant. The
discipline of pruning:

- Each quarter, review the suite. For each benchmark, ask:
  - Is the function still in production?
  - Is it in a profile hotspot?
  - Has the benchmark caught a real regression in the past year?
  - Is it covered by another bench?
- Delete or merge accordingly.

A 30% reduction in suite size for the same coverage is a typical
quarterly outcome. The pruning meeting takes an hour; the savings
in CI time are recurring.

## 33. Real-world: the net/http handler hot-path measurement

This is the most common senior-level benchmark question:
"my /api/foo got slower; help."

The procedure:

Step 1: reproduce in a benchmark. Use `httptest`, the same handler
chain (including middleware), realistic request body, and a
fixture matching production hardware as closely as possible.

```go
func BenchmarkAPIFoo(b *testing.B) {
    mux := newRouter()
    body := loadRequestFixture("api_foo_typical.json")
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        req := httptest.NewRequest("POST", "/api/foo", bytes.NewReader(body))
        w := httptest.NewRecorder()
        mux.ServeHTTP(w, req)
        if w.Code != 200 {
            b.Fatalf("status %d", w.Code)
        }
    }
}
```

Step 2: confirm the bench reproduces the regression. If it does
not, the cause is in something the bench skips: TLS, real network
RTT, an external service the bench mocks, the load balancer. Add
the missing layer.

Step 3: profile. `go test -bench=BenchmarkAPIFoo -cpuprofile=cpu.pprof -count=1 -benchtime=10s`.
Open `go tool pprof -http=:6060 cpu.pprof` and look at the flame
graph. The widest blocks under your handler are the targets.

Step 4: diff. Repeat the profile on the pre-regression commit.
`go tool pprof -base before.pprof after.pprof` shows what got
wider. That is your regression site.

Step 5: bench the regression site in isolation. A micro for the
exact function that grew. Hypothesise a fix, bench it, verify it
fixes the macro.

This five-step workflow handles 80% of "perf got worse" tickets
without exotic tooling. The exotic tooling is for the other 20%.

## 34. Channels in benchmarks

Channel send/receive has a fixed overhead of ~50-80ns on modern
hardware (the runtime's chan code is sophisticated and well-
optimised but not free). A benchmark of a function called via a
channel measures the channel overhead plus the work:

```go
func BenchmarkWorkViaChannel(b *testing.B) {
    in := make(chan int, b.N)
    out := make(chan int, b.N)
    go func() {
        for x := range in {
            out <- work(x)
        }
    }()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        in <- i
    }
    close(in)
    for i := 0; i < b.N; i++ {
        <-out
    }
}
```

If `work` is sub-microsecond, the channel overhead dominates. The
benchmark looks like "work is slow" but is actually "channels are
slow for this work size".

Mitigation: batch. Send slices through channels, not individual
elements. Reduces channel ops by 10-1000x.

## 35. sync.Pool and benchmark fairness

`sync.Pool` exists to recycle allocations. A benchmark that uses
sync.Pool gives different numbers depending on whether the pool is
"warm" (has items) or "cold" (empty):

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func BenchmarkWithPool(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        buf := bufPool.Get().(*bytes.Buffer)
        buf.Reset()
        buf.WriteString("hello")
        sinkS = buf.String()
        bufPool.Put(buf)
    }
}
```

The first iteration allocates (pool was empty); subsequent
iterations recycle. `allocs/op` may report `0.2` or similar (an
amortised count). This is the *right* number for production but
can confuse readers expecting integer alloc counts.

Be explicit in the benchmark comment that it reports amortised
counts. Reviewers should know not to round to integers.

A separate benchmark for the cold pool ("each iteration starts
with an empty pool") measures the pessimistic case:

```go
func BenchmarkColdPool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var localPool sync.Pool
        localPool.New = func() any { return new(bytes.Buffer) }
        buf := localPool.Get().(*bytes.Buffer)
        buf.WriteString("hello")
        sinkS = buf.String()
        localPool.Put(buf)
    }
}
```

Now every iteration creates a fresh pool. Slower; matches the
"every request gets a new pool" scenario (which is the wrong way
to use sync.Pool, but bench it to show the cost).

## 36. The `defer` cost in tight loops

Each `defer` statement costs ~3-5ns on modern Go. In a tight inner
loop this adds up:

```go
func work(items []int) int {
    sum := 0
    for _, x := range items {
        sum += slowOp(x)
    }
    return sum
}

func slowOp(x int) int {
    defer recover() // 3-5ns overhead each call
    return x * 2
}
```

Removing the `defer recover()` from `slowOp` (assuming you do not
need it) halves the per-call cost for a 5ns function. The bench
diff makes the case for the change.

Go 1.14 made `defer` cheaper than earlier versions (open-coded
defers). Go 1.22 made it cheaper still. The cost varies by version;
re-bench after each Go upgrade.

## 37. The benchmark of a benchmark

For deep performance work you sometimes need to benchmark *the
measurement infrastructure itself*. How much does `b.ReportMetric`
cost? How much does a `time.Now()` cost?

```go
func BenchmarkBNop(b *testing.B) {
    for i := 0; i < b.N; i++ {
        // nothing
    }
}

func BenchmarkTimeNow(b *testing.B) {
    var t time.Time
    for i := 0; i < b.N; i++ {
        t = time.Now()
    }
    sinkT = t
}

func BenchmarkReportMetric(b *testing.B) {
    for i := 0; i < b.N; i++ {
        b.ReportMetric(1.0, "noop/op")
    }
}
```

Numbers (representative, on x86-64 Linux):

- `BenchmarkBNop`: ~0.3 ns/op (empty loop, branch-predicted)
- `BenchmarkTimeNow`: ~25 ns/op
- `BenchmarkReportMetric`: ~50 ns/op

If your benchmark body is 30ns and you wrap each iteration in
`time.Now()` + `b.ReportMetric`, you have added 75ns of overhead
to measure 30ns of work. Garbage in, garbage out.

Senior measurement: know these numbers for your platform.

## 38. The framework's adaptive `b.N` and edge cases

The framework's `b.N` selection follows roughly this schedule:
1, 100, 10000, 1000000, ... until total time hits `-benchtime`.

If your bench body has high variance (90% iterations 10ns, 10%
iterations 10ms because of GC), the framework may pick a small
`b.N` because the first sample happened to hit a slow iteration. The
result: a tiny `b.N`, noisy measurement.

Mitigation: `-benchtime=10s` overrides the stabilisation logic and
ensures lots of iterations. Or pre-warm before `b.ResetTimer` to
clear any one-off cost. Either way the senior knows that `b.N` is
*adaptive* and the adaptation can sometimes go wrong.

## 39. Cross-package benchmark correlations

A change to package A may affect a benchmark in package B because
B imports A. Tracking these correlations is hard manually; the
discipline of *recursive bench* helps:

```bash
go test -bench=. -count=10 ./... > today.txt
```

Run the whole-repo suite. benchstat against yesterday's run. Now
you see *all* affected benchmarks, not just the package you
touched. A change to a logging utility shows up in benchmarks for
every package that uses it.

This catches "I optimised function X but accidentally regressed
function Y in another package" cases that per-package benches miss.

## 40. The macro-bench in a `_test/integration` directory

A common layout for serious bench suites:

```
pkg/
  service/
    handler.go
    handler_test.go        # unit tests
    handler_bench_test.go  # microbenchmarks
test/
  perf/
    macro_test.go          # macrobenchmarks
    fixtures/
      trace-2024-09.json
      trace-2024-10.json
```

The microbenches live next to the code. The macrobenches and
production traces live in a top-level `test/perf/` directory,
versioned with the code. The traces are the production load
profiles, scrubbed of PII, replayed by the macro benchmarks.

Build tags separate the runs:

```go
//go:build perf_macro
```

`go test -bench=. -tags=perf_macro ./test/perf/...`

Now the contract benchmarks run on the pinned runner with a single
command and never interfere with the regular test suite.

## 41. Calibrating PGO profile drift

A PGO profile collected today may be unrepresentative in three
months because the workload changed. To detect drift:

```bash
# Collect last week's profile.
go tool pprof -proto last_week/*.pprof > last_week.pgo

# Collect this week's profile.
go tool pprof -proto this_week/*.pprof > this_week.pgo

# Bench with each:
go test -bench=. -pgo=last_week.pgo -count=10 > a.txt
go test -bench=. -pgo=this_week.pgo -count=10 > b.txt
benchstat a.txt b.txt
```

If a > 2% delta appears, the profile has drifted enough to matter.
Time to re-aggregate.

If no delta appears, the profile is stable; you can use last week's
without loss. The cost of this check is one bench run per week,
which is cheap insurance against silently shipping a stale profile.

## 42. Memory bandwidth as a ceiling

For data-heavy workloads (large scans, encode/decode of big buffers,
hashing of files), the bottleneck is often memory bandwidth, not
CPU. A modern x86 server has ~50 GB/s of DRAM bandwidth per socket.
Divided by 64-byte cache lines that is 780M cache-line accesses
per second per socket.

If your benchmark processes 1GB of data, the *minimum* time is
1GB / 50GB/s = 20ms regardless of how clever your code is. A
benchmark that hits this floor is *bandwidth-bound* and no
algorithmic improvement helps; the only fix is to do less I/O
(compression, smarter data layout).

The diagnostic: read `runtime/metrics` for cache-miss-rate-like
signals (Go does not expose these directly; use `perf stat` on
Linux to read them from hardware counters).

```
perf stat -e LLC-loads,LLC-load-misses go test -bench=. -count=1
```

A high LLC-load-misses count means cache thrashing. The cure is
data layout, not algorithm.

## 43. Allocation tracing for one allocation only

You see `1 allocs/op` and cannot find it. The diagnostic:

```bash
go test -bench=BenchmarkX -gcflags="-m=2" 2>&1 | grep -A2 "escapes to heap"
```

If the escape message is unhelpful, add a tracing allocator (via
the `-allocfreetrace=1` GODEBUG flag, on a runtime built from
source). Or use `pprof` with `-alloc_space`:

```bash
go test -bench=BenchmarkX -memprofile=mem.pprof -benchtime=10s -count=1
go tool pprof -alloc_objects -top mem.pprof
```

The top entry is the call stack producing the allocation. Walk the
stack to the user code line; that is your allocator.

Common surprises:

- A `string` concatenation in a debug log line (compile-time guarded
  but evaluated anyway? Check the log library).
- An interface boxing of an `int` for a `fmt.Printf` argument.
- A slice append that exceeded capacity.
- A map insertion that triggered growth.

Each has a known fix; finding it is the hard part.

## 44. `bytes.Buffer` vs `strings.Builder`

For string assembly in hot paths:

- `strings.Builder` does not allow the underlying byte slice to be
  copied (its `String()` is zero-copy by virtue of `unsafe` pointer
  reuse).
- `bytes.Buffer` has the same effect but copies on `String()`.

Bench:

```go
func BenchmarkStringsBuilder(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var sb strings.Builder
        for j := 0; j < 100; j++ {
            sb.WriteString("hello")
        }
        sink = sb.String()
    }
}

func BenchmarkBytesBuffer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var buf bytes.Buffer
        for j := 0; j < 100; j++ {
            buf.WriteString("hello")
        }
        sink = buf.String() // copies
    }
}
```

The Builder version is ~30% faster on this workload because it
avoids the final copy. Senior code reviews flag `bytes.Buffer` used
in this pattern and suggest `strings.Builder`.

## 45. `reflect` cost in benchmarks

`reflect.Value.Field` is ~50ns per call; `reflect.TypeOf` is ~5ns;
`reflect.Value.Set` is ~30ns. A benchmark heavy on reflection
(generic JSON unmarshal, for example) sees these dominate the
profile.

Mitigations:

- Cache the `reflect.Type` and `reflect.StructField` lookups once,
  reuse forever.
- For very hot paths, generate code instead of reflecting at
  runtime (tools: `easyjson`, `ffjson`, `protobuf`).
- Use `encoding/json/v2` when available; it caches reflection state
  better than v1.

A bench comparing reflection-heavy and code-generated paths on the
same workload often shows 5-10x difference. The trade-off: generated
code is more lines but faster.

## 46. The `testing.B.N` upper bound

`b.N` grows in roughly 2-3x steps. The upper bound is conventionally
~1B but in practice is limited by `-benchtime`. If your benchmark
body is 1ns and `-benchtime=1s`, `b.N` ends around 10^9. If your
body is 1ms and `-benchtime=1s`, `b.N` ends around 1000.

For benches whose iterations differ in cost (some hit cache, some
miss), large `b.N` averages over many regimes. Small `b.N` may
hit only one regime. Force a high `b.N` with `-benchtime=Nx` if
you need uniform sampling.

## 47. Avoiding pitfalls when measuring fast operations

For operations under 10ns the overhead of the loop, the variable
update, and `time.Now` (if used) dominate. Strategies:

- Loop unrolling inside the bench body. Do the work 10x per `b.N`
  iteration; divide the reported time by 10.
- Use `b.SetBytes` to convert ns/op into MB/s where applicable.
- Use perf counters via `perf stat` on Linux to read cycle counts
  directly.

Senior measurement of sub-10ns code requires this care; without it
the numbers reflect framework overhead, not the work.

## 48. Profile-guided optimisation: the production loop

A mature PGO setup is a closed loop:

1. Build with PGO from last week's `default.pgo`.
2. Deploy.
3. Collect `cpu.pprof` continuously from a canary.
4. Aggregate weekly into next week's `default.pgo`.
5. Goto 1.

The aggregation step deserves attention. Naively concatenating raw
profiles weights by sample count; if one host produced more samples
(longer canary period, higher load) it dominates. Use
`go tool pprof -proto` to merge profiles with explicit weighting,
or use the `pprof.Merge` API from `golang.org/x/perf/pprof`.

Once the loop is running, perf optimisations compound: each
deployment is a little better than the last, and the team's
optimisations are amplified by PGO's knowledge of *current*
hotspots.

## 49. The bench-on-CL prototype

For staff engineers proposing a perf-sensitive change, "bench on
CL" is a workflow:

1. Open a Gerrit-style change with a clear hypothesis.
2. Attach a bench file demonstrating the issue.
3. The bot runs the bench on a pinned runner.
4. The bot posts benchstat output to the CL.
5. Reviewers see the data before reading code.

The Go team itself uses a variant of this. The discipline gives
reviewers data without the per-PR human effort of running the bench
locally. It scales to dozens of perf PRs per week.

## 50. The bench-test correctness pairing

Every benchmark MUST have a paired correctness test. The reason:
optimisations frequently introduce subtle bugs. A faster decoder
that occasionally produces wrong output is worse than a slow correct
one. The discipline:

- For each `BenchmarkX`, write a `TestX` that exercises the same
  function on representative inputs and verifies output.
- The test runs in `go test` (no flag); the bench runs in
  `go test -bench`.
- A PR that adds a benchmark without a test triggers a review
  comment. A PR that modifies a benched function without re-running
  the test fails CI.

Without this discipline a perf-optimisation PR can ship a regression
that the bench number hides. The test is the safety net.

## 51. The hot-path inlining audit

Once a quarter, audit the inlining of your top-30 hot functions.
Procedure:

```bash
go build -gcflags="all=-m=2" 2>&1 | grep -A1 "inlining call to" > /tmp/inlines.txt
```

For each top hot function:

- Confirm it inlines at all important call sites.
- If not, file a ticket: "investigate inlining for X".
- If it inlines too far (a long inline chain), consider whether
  splitting would help (smaller inlined fragment, less I-cache
  pressure).

The audit takes a few hours per quarter and is cheap insurance
against silent inlining regressions across Go versions.

## 52. Selecting representative inputs

A benchmark's inputs determine what it measures. Naive inputs
(short strings, uniform distributions) miss the long tail that
production sees. Mature input selection:

- Capture production traffic for an hour. Anonymise.
- Replay it through a bench harness via `httptest`.
- The bench's per-iteration cost reflects realistic input
  distribution: short and long, ASCII and Unicode, simple and
  pathological.

The cost is non-trivial: anonymisation tooling, storage, and replay
plumbing. The payoff is that bench numbers correlate with prod
behaviour, so optimisations that move bench numbers move prod
numbers too.

## 53. The "perf 101" onboarding

When a new engineer joins, give them a perf-onboarding day:

- Read this chapter end-to-end (junior + middle pages).
- Run the suite locally.
- Read one project postmortem.
- Pair on a bench-driven debugging session.

A day of focused onboarding saves weeks of guessing later. Make it
part of the standard new-hire process for any team that takes perf
seriously.

## 54. The senior takeaways

- Statistics: median, Mann–Whitney, CIs, geomean, FDR, CUSUM. Mean
  is rarely the right summary; trend detection requires more than
  per-PR gates.
- Machine: pin, frequency-lock, SMT-off, NUMA-aware, cache-conscious.
  Without this you are measuring weather.
- Toolchain: PGO, -gcflags="-m", build flag matrix. Different flags,
  different numbers.
- Runtime metrics: not just ns/op. GC, scheduler, mutex wait — all
  observable, all relevant.
- Tail: -benchtime long, percentile metrics, separate from mean.
- CI: tiered, statistical, trend-based. Single per-PR gate fails.
- Profile-guided: a regression's cause is one `pprof -base` command
  away.
- Bisect: when prod p99 moved and no PR is suspect, automated
  bisect on the contract bench finds the commit.
- Trace: when a benchmark surprises you, `-trace` shows the
  runtime's actual behaviour.
- Macro vs micro: write the macro first, drill in with micros.

These are the habits that distinguish someone who measures Go
performance professionally from someone who runs a benchmark and
squints at a number.

The professional page picks up here and addresses how to make the
discipline survive at organisational scale — CI tiers, dashboards,
contracts, postmortems. If you have internalised the senior
material, that is the next step.

[← Back](../)
