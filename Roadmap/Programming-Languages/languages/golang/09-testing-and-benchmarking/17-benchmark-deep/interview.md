---
layout: default
title: Benchmark Deep — Interview
parent: Benchmarking Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/interview/
---

# Benchmark Deep — Interview

[← Back](../)

This page collects interview questions that probe whether a candidate truly understands the statistics, machine model, and toolchain interactions behind Go benchmarks. Answers are written as short paragraphs because in real interviews the follow-up question is what separates a senior from a staff engineer; the bullet form would invite memorisation.

## Question 1: What is the noise floor of a benchmark and how do you measure it?

The noise floor is the variance you observe when you run the *same* benchmark twice with no code changes. It comes from CPU frequency scaling, thermal throttling, SMT siblings stealing cycles, ASLR changing cache alignment, and the OS scheduler. You measure it by running the baseline against itself: `go test -bench . -count=20 > a.txt && go test -bench . -count=20 > b.txt && benchstat a.txt b.txt`. If benchstat reports any statistically significant delta, that delta is your noise floor and any real regression must exceed it.

## Question 2: Why does `b.N` exist instead of a fixed iteration count?

`b.N` lets the framework auto-scale until the total wall time exceeds `-benchtime` (default 1s). This amortises one-off overhead (such as binary loading, JIT-like cache warming, page faults) and makes the per-op cost statistically stable. If you fixed `N=1000`, a 200ns benchmark would finish in 200µs which is well within the noise floor of any modern OS.

## Question 3: How does the compiler defeat naive microbenchmarks?

Three classic mechanisms. First, *dead code elimination*: if the result of `f(x)` is not stored or used, the call vanishes. Second, *constant folding*: if the argument is a literal known at compile time, the call is replaced with its result. Third, *inlining*: small functions get inlined and may then be optimised in the calling context, so you measure something different from what real callers would see. Fix all three by assigning to a package-level `var sink` of the right type and feeding the function inputs that change per iteration.

## Question 4: When would you use `b.ReportAllocs()` vs `b.ResetTimer()`?

`ReportAllocs` adds two extra columns to the output (`B/op` and `allocs/op`) which is essentially free and should be on by default for any benchmark that touches the heap. `ResetTimer` is for benchmarks with expensive setup that must not contaminate the measurement (loading test data, building a fixture). Use `b.StopTimer` and `b.StartTimer` if setup happens *inside* the loop.

## Question 5: Explain `benchstat`'s methodology in one paragraph.

benchstat groups samples by benchmark name, computes the median (not the mean — it is robust to outliers from a noisy machine), and runs a Mann–Whitney U test between the two groups. The null hypothesis is that the two distributions are identical; the reported `p` is the probability of seeing this delta under the null. By default a delta is reported as significant only if `p < 0.05` AND the effect size exceeds a threshold (`-delta-test` and `-threshold` flags). Citation: `golang.org/x/perf/cmd/benchstat`.

## Question 6: Why is the mean a poor summary statistic for a benchmark?

Benchmarks are bimodal in practice: most iterations are cache-warm and a small tail is cache-cold or got pre-empted. The mean is dragged by that tail; the median is not. For latency-sensitive code you want to report p50/p95/p99 separately because a regression that doubles p99 while leaving p50 alone is invisible to a mean-based comparison.

## Question 7: How do you measure p99 inside a benchmark?

`b.N` does not give you per-iteration timing for free. Use `b.ReportMetric(percentile, "p99-ns/op")` after collecting a slice of `time.Now()` deltas. Sort the slice, take the index at `0.99 * len`, and report. The standard trick is to wrap your body in `t0 := time.Now(); /* work */; samples[i] = time.Since(t0)`. Be careful that `time.Now()` itself has ~25ns overhead on x86 and may dominate sub-100ns operations.

## Question 8: What does CPU pinning achieve and what is the risk?

Pinning with `taskset -c 2 go test -bench .` (Linux) or `cpuset` (macOS) forces the benchmark onto a chosen physical core, avoiding migration cost and SMT-sibling interference. The risk is *what* you pinned to: if it is a P-core on a hybrid CPU you measure the fast path; if it is an E-core you measure the slow path. Always document the pinned core and the kernel scheduler version in your bench fixture.

## Question 9: How does PGO interact with benchmarks?

Profile-Guided Optimisation reads a `default.pgo` file at build time and lets the compiler inline hot functions more aggressively and rearrange branches by frequency. If you benchmark a function that PGO inlined more deeply you may see a 10–40% speedup that disappears when the same function is called from a *different* hot path. Always benchmark with the same `default.pgo` you ship.

## Question 10: How would you detect a 2% regression in CI?

Two percent is below the noise floor of most CI runners. The honest answer: do not try to detect it in shared CI. Either (a) use a dedicated bare-metal runner with CPU pinning, frequency lock, SMT off, and `-count=20 -benchtime=5s` followed by benchstat with `-threshold=2%`, or (b) trend the metric over many runs and look for slope changes with a CUSUM-style detector instead of per-PR gates.

## Question 11: What is the difference between `-count` and `-benchtime`?

`-benchtime=10s` extends the duration of *one* run, so `b.N` grows. This reduces per-run statistical error but produces a single sample. `-count=10` re-runs the whole benchmark ten times producing ten samples; benchstat needs samples (not just a longer single run) to compute a confidence interval. Use both: `-benchtime=2s -count=10` is a good default.

## Question 12: When are `-gcflags="-m"` and `-ldflags="-s -w"` relevant?

`-gcflags="-m=2"` makes the compiler print inlining and escape-analysis decisions. Reading this is mandatory when your benchmark shows surprise allocations: 9 times out of 10 a closure captured a variable that escaped to the heap. `-ldflags="-s -w"` strips the symbol and DWARF tables; it does not change runtime performance but reduces binary size and can affect cold-start measurements that include `os.Exec`.

## Question 13: What is `runtime/metrics` and why prefer it over `runtime.MemStats`?

`runtime/metrics` is the modern, low-overhead metric stream introduced in Go 1.16. Unlike `runtime.MemStats` it does not stop the world to collect a snapshot, and it exposes histograms (e.g. `/sched/latencies:seconds`) rather than just counters. For steady-state perf testing you read it before and after the workload and diff. Citation: `pkg.go.dev/runtime/metrics`.

## Question 14: GOGC=off — when is it appropriate in a benchmark?

Almost never. Turning GC off lets you measure pure mutator throughput, which is interesting for compiler micro-tuning, but production never sees that. A better idiom is `GOGC=100` (default) and `GOMEMLIMIT` set to your production target, so the GC pacer behaves the way it will in prod. Compare two configurations with benchstat rather than chasing GC-free numbers.

## Question 15: Why is `benchcmp` deprecated?

`benchcmp` did pure mean-of-mean comparison with no statistical test. It would happily report "30% faster" when the delta was inside the noise floor. `benchstat` is the supported successor; the Go team archived `benchcmp` in 2018. If you still see it in tutorials, replace it.

## Question 16: How would you measure a CPU-bound function under realistic load?

Combine three things. A microbenchmark for the function in isolation (fast feedback, narrow scope). A macrobenchmark replaying production traffic via `httptest` (realistic context, includes middleware and codec costs). A production canary with `runtime/metrics` scraped at 10s resolution (the ground truth). Use the canary to discover what is hot; use the macro to reproduce it; use the micro to localise.

## Question 17: What is the difference between `b.Run` parallelism and `b.RunParallel`?

`b.Run(name, f)` runs sub-benchmarks one at a time, each with its own `b.N`. It is for parametric sweeps. `b.RunParallel(f)` runs the body concurrently across `GOMAXPROCS` goroutines for a single `b.N` total — it is for measuring contention. They serve different purposes and should not be confused.

## Question 18: How do you benchmark a function that mutates global state?

Two strategies. First, reset the global state in `b.StopTimer/b.StartTimer` blocks each iteration. Second — preferred — refactor the function to take state as a parameter so the bench can build a fresh instance per iteration without touching globals. If you cannot refactor, document loudly in the benchmark comment that the function mutates globals and that the bench fixture clears them. Globals are a code smell anyway; the bench discomfort is a signal to refactor.

## Question 19: What does `-trace=trace.out` capture?

A full execution trace: every goroutine creation, blocking, unblocking, syscall, GC event. View with `go tool trace`. Useful for benchmarks where the per-op time is mysterious — the trace shows the runtime's actual schedule. The cost is large (10-100MB of trace data per minute) so use it sparingly, not as a default.

## Question 20: When would you set `runtime.LockOSThread` in a benchmark?

When you want to prevent the goroutine running the bench from being migrated between OS threads. Useful for ultra-precise per-iteration timing where TSC drift between cores adds noise. Combine with `taskset` to pin the OS thread to a CPU. Rarely needed outside microsecond-scale benches.

## Question 21: Explain `-trimpath` and its bench relevance.

`-trimpath` strips the local filesystem prefix from compiled paths. The compiled binary is byte-identical regardless of where it was built. Bench-relevant because reproducible builds let you confirm two team members are benchmarking the same binary. No direct effect on runtime numbers.

## Question 22: What is a "warmup iteration" and does Go's framework do it?

A warmup iteration runs the code once to pull pages into RAM, populate caches, and trigger lazy initialisation. The framework's `-benchtime` loop effectively includes warmup because it runs many iterations and the first few are discarded into the averaging noise. For ultra-precise work you may pre-warm explicitly with a small loop before `b.ResetTimer()`.

## Question 23: How do you compare benchmarks across machines?

You do not, directly. Instead compare *ratios* on each machine. If implementation B is 30% faster than A on machine 1 *and* 32% faster on machine 2, that is a real effect. If it is 30% faster on machine 1 and 5% faster on machine 2, the platforms differ — investigate. Absolute ns/op numbers across machines are nearly useless; ratios are robust.

## Question 24: What is the difference between `pprof -base` and `pprof -diff_base`?

`-base` subtracts samples (samples in base are negative). `-diff_base` does the same but reverses the sign convention (interpret "diff from base" naturally). Functionally similar; choose whichever sign convention your team prefers. Both are differential analysis tools that turn "two profiles" into one annotated profile showing what changed.

## Question 25a: What happens if `b.N` is too small for the framework to stabilise?

If a single iteration exceeds `-benchtime`, `b.N` stays at 1 and the bench produces one noisy sample. Use `-count` to get multiple samples and `benchstat` to summarise. For very slow operations consider whether you should microbench at all — a 30-second per-iteration benchmark is rarely the right tool; integration tests with explicit timing are usually better.

## Question 25b: How do you choose between `runtime.GC()` before timing and letting GC happen during?

Calling `runtime.GC()` before `b.ResetTimer()` clears outstanding garbage so the first iterations are not penalised. It does not prevent GC from firing *during* the bench. For steady-state measurement, prefer to *not* call `runtime.GC()` — production never has a quiet GC; your bench should not either. For setup-cost isolation, the explicit GC is the right tool.

## Question 25: Describe a bench-driven debugging session you would run.

Macro shows a 12% p99 regression on /api/foo. (1) Reproduce in a microbenchmark via httptest. If reproduced, continue; else add missing layers. (2) Profile both before and after commits with `-cpuprofile`. (3) `pprof -base` to find which functions grew. (4) Bench the top growing function in isolation. (5) Read its diff in git, hypothesise a fix. (6) Bench the fix. (7) Re-run the macro to confirm the macro improvement matches. (8) Run benchstat with `-count=20` to confirm `p < 0.05` and effect > the noise floor. Without this discipline, you guess; with it, you have a paper trail.

## Question 26: Why does Go's compiler not auto-vectorise?

Auto-vectorisation requires a complex compiler pipeline (loop unrolling, dependency analysis, target-aware code generation) that the Go team has explicitly chosen not to invest in, preferring instead small compiles, fast builds, and hand-written assembly in performance-critical standard library functions. The trade-off favours compilation speed and predictability over peak per-loop throughput. Workarounds in user code: call into stdlib functions that have hand-written SIMD assembly (e.g. `bytes.IndexByte`), or write your own assembly with `.s` files. As of Go 1.22 there is ongoing work on simd intrinsics but it remains experimental.

## Question 27: How do you benchmark a function that uses a global PRNG?

Two strategies: (1) reset the global PRNG seed in `b.StopTimer/b.StartTimer` blocks so the bench is deterministic; (2) better, use a local `*rand.Rand` initialised once per bench. The global PRNG involves a mutex; in a contended bench the mutex shows up in the profile. Always prefer a local PRNG for hot paths.

## Question 28: Explain `b.SetParallelism` with a concrete example.

`b.SetParallelism(p)` sets the parallelism factor for `RunParallel`: the number of goroutines per CPU. Default 1 (one goroutine per CPU). Setting it to 4 with `GOMAXPROCS=8` spawns 32 goroutines. Useful when benchmarking I/O-bound code that should oversubscribe CPUs, simulating a "many concurrent requests per core" scenario typical of HTTP services.

## Question 29: What is the purpose of `-test.benchtime=1x`?

It runs each benchmark for exactly one iteration. Useful for sanity-checking that the bench compiles and produces output, without actually timing anything meaningfully. Sometimes used as a smoke test in CI: "do all benches still compile and run without panicking?"

## Question 30: How do you measure the cost of garbage collection inside a benchmark?

Three options. First, `runtime/metrics` for `/gc/cpu-time:seconds` (cumulative CPU time spent in GC), sampled before and after. Second, `runtime.MemStats.GCCPUFraction` snapshot. Third, set `GODEBUG=gctrace=1` and parse the per-cycle trace lines for pause time and percentage of CPU. The first is preferred for new code because it does not stop the world. Cite `runtime/metrics`.

## Question 31: What does it mean if `allocs/op` is fractional?

It means the function does not allocate on every call but does sometimes — e.g. a `sync.Pool.Get()` that hits the pool most of the time but occasionally needs to call `New`. The framework averages over `b.N` iterations and reports the mean. Fractional alloc counts are valid and informative; do not "round up" mentally.

## Question 32: How do you benchmark a generator that yields values lazily?

Wrap the generator in a loop that consumes one value per `b.N` iteration. If the generator is itself stateful (channel-based, for example), the bench measures one-receive cost. For a deeper view, also measure the cost of a "full pass" (consume all values until the generator returns EOF) in a separate macro-style benchmark.

## Question 33: What is the difference between `-benchmem` and `b.ReportAllocs()`?

Functionally equivalent: both enable the alloc columns. `-benchmem` is a global flag for the run; `b.ReportAllocs()` is per-benchmark. Use the flag for "always allocate-aware" runs (most teams want this) and the per-bench call for benchmarks that absolutely require the data even if the flag was omitted.

## Question 34: Explain `b.SetBytes` with a JSON decoder example.

`b.SetBytes(int64(len(jsonInput)))` declares that each iteration processes `len(jsonInput)` bytes. The framework computes `(SetBytes * b.N) / elapsed_seconds` and reports in MB/s. For codec benchmarks this is the natural metric because per-byte throughput is what production cares about.

## Question 35: Why might `-pgo=auto` not improve numbers?

`-pgo=auto` looks for a `default.pgo` file in the package directory. If absent, the build proceeds without PGO (silently). Check that the file exists, was collected on a representative workload, and that the build log mentions PGO is enabled. Also remember: PGO may not improve every workload; if the static build was already near-optimal there is no room to grow.

## Question 36: A new Go version's release notes say "compiler is 1% faster overall." Do you upgrade?

The 1% is a *suite geomean*. Individual benchmarks may go up or down. The right answer: run your own bench suite under the new version on the pinned runner, benchstat against the previous version, and read the per-benchmark deltas. If your hot paths improved or stayed flat, upgrade. If they regressed, file an upstream issue and delay the upgrade.

## Question 37: How do you avoid measuring the `b.Run` overhead in sub-benchmarks?

`b.Run` itself has a small fixed cost (sub-µs) that does not affect the inner timing — the framework resets the timer at the start of the inner function. The cost shows up only in total wall time, not in per-iteration ns/op. So you do not need to avoid it; it does not contaminate measurements.

## Question 38: When does `runtime.LockOSThread()` matter for a benchmark?

When the function under test uses thread-local OS state (e.g. cgo callbacks that touch errno, signal handlers, syscalls that depend on per-thread context). For pure Go code it usually does not matter; the goroutine can migrate between OS threads freely.

## Question 39: How would you bench a function that takes a `context.Context` with a timeout?

Pass a context with a timeout long enough that no iteration ever hits it (otherwise you measure the timeout path, which is a different operation). For the timeout path specifically, write a separate benchmark that intentionally triggers the deadline.

## Question 40: What is the role of `b.TempDir()` in benchmarks?

`b.TempDir()` returns a fresh directory that is cleaned up when the benchmark ends. Use for benchmarks that need filesystem state (e.g. opening a file, writing logs). The cleanup is automatic via `b.Cleanup` semantics, so you do not need to remove the directory manually.

## Question 41: Describe what `go test -bench` does when invoked with a regex that matches nothing.

It prints `PASS` and exits 0 without running any benchmarks. This is silent and surprising. A common defensive practice: in CI scripts, after running benches, verify that the output file is non-empty before feeding to benchstat. An empty benchstat input is also silent — you get no output, not an error.

## Question 42: What is `b.Elapsed()` and when is it useful?

`b.Elapsed()` returns the elapsed timer value at the call point. Useful when you want to compute custom rates without using `time.Now`. Example: `b.ReportMetric(float64(totalBytes)/b.Elapsed().Seconds(), "bytes/sec")`.

## Question 43: Explain why a benchmark that uses `t.Helper()` is wrong.

`t.Helper()` is a method on `*testing.T`. For benchmarks use `b.Helper()` (same effect, different receiver). The framework's helper marking is type-specific. Using the wrong one is a compile error; the question is rhetorical for explaining the rule.

## Question 44: How do you bench a function that may panic?

Wrap the bench body in `defer func() { recover() }()`. But ask whether benchmarking a panicking path is what you want: the cost of a panic is high (~5µs+) and rarely the common case. If you really want to measure panic recovery, do so explicitly; otherwise ensure inputs do not trigger panics.

## Question 45: Walk through reading a `pprof` flame graph for the first time.

The horizontal axis is total time; vertical is the call stack. The widest blocks at the top are the leaf functions consuming the most time. Click a block to zoom; the rest of the graph rescales. Look for blocks that surprise you (a function you did not expect to be hot) — that is your investigation target. Common surprises: `runtime.mallocgc` (allocations), `runtime.scanobject` (GC scan), reflection-related runtime functions.

## Question 46: What is "false sharing" and how would you detect it in a benchmark?

False sharing occurs when two CPUs write to different variables that happen to share a cache line. Each write invalidates the line in the other CPU's cache, causing repeated cache-coherency traffic. Detect by benchmarking with `-cpu=1,2,4,8` and looking for non-scaling (or anti-scaling) behaviour on a workload that should scale linearly. Confirm with `perf stat -e cache-misses`. Fix by padding fields to separate cache lines or by separating the variables across structs.

## Question 47: Why might enabling PGO regress some benchmarks?

PGO biases the compiler to inline hot paths more aggressively. If your benchmark exercises a cold path that PGO chose not to inline, the call overhead remains. If the same function is inlined hot but called cold in the bench, the inlined copy has worse locality. Net wins come from the cumulative effect across all hot paths; individual benchmarks may go either way.

## Question 48: How would you measure binary size impact of a code change?

`go build -o /tmp/bin && ls -la /tmp/bin`. Or use `gowiz` / `goweight` to break down by package. For a meaningful comparison, build both versions with the same flags (`-trimpath`, `-ldflags="-s -w"` or not). Binary size matters for cold-start latency, deployment time, and embedded use cases; it does not affect runtime perf directly.

## Question 49: Explain why running benchmarks twice can produce different numbers even with the same code.

Many causes: CPU frequency scaling (turbo), SMT siblings doing different work, cache state, ASLR layout, page-fault timing, kernel scheduler decisions, GC timing. The combination produces a noise floor. Mitigate with pinning, frequency lock, SMT off, `-count`, and benchstat for statistical comparison. Single-run differences are normal; statistically significant deltas across many runs are signals.

## Question 50: What is the ideal `b.N` and how is it chosen?

The framework chooses `b.N` to make total wall time approximately equal to `-benchtime`. The schedule is roughly 1, 100, 10000, 1000000, ... doubling each pass until elapsed time exceeds the target. For sub-µs operations `b.N` ends in the millions to billions; for ms-scale operations it ends at tens to hundreds. Treat `b.N` as opaque output, not input.

## Question 51: When would you skip running benchmarks in CI entirely?

When the CI environment is so noisy that the false-positive rate exceeds 1%. In that case run benchmarks locally on pinned hardware and post results in PR descriptions; let CI focus on correctness. A perf gate with high FP rate is worse than no gate — it desensitises developers.

## Question 52: Why might `-pgo=auto` be safer than `-pgo=path.pgo`?

`-pgo=auto` looks for `default.pgo` in the package directory and skips if not present. If you change branches and forget to copy the profile, builds proceed without PGO (slightly slower but correct). `-pgo=path.pgo` fails if the file is missing. For repeatable builds either is fine; for general developer ergonomics `-pgo=auto` errs on the side of working.

## Question 53: Walk me through optimising a benchmark that reports 1 alloc/op.

(1) Run with `-gcflags="-m=2"` and grep for "escapes to heap" near the function. (2) Identify which value escapes and why. (3) Common causes: closure capture, interface boxing, slice growth, pointer return. (4) Apply the matching fix pattern. (5) Re-bench and confirm allocs/op drops to 0. (6) Run the correctness test to ensure no behavioural change. (7) Document the fix in a commit message that future readers can search for.

[← Back](../)
