# Microbenchmarking & Statistical Rigor (benchstat)

> Write Go benchmarks that **don't lie**. Most microbenchmarks measure the
> compiler, not the code — dead-code elimination, hoisting, cold caches, and a
> single noisy run conspire to produce a number you'll quote in a PR and regret.
> Learn to measure a change and **prove** the difference is real with a p-value,
> then wire that proof into CI so a real regression fails the build.

| | |
|---|---|
| **Tier** | Load-testing (perf craft) |
| **Primary domain** | Benchmarking methodology / Go runtime |
| **Skills exercised** | `testing.B`, `b.N` mechanics, dead-code-elimination defeat, allocation accounting, `RunParallel`, variance & noise control, `benchstat` A/B with p-values, CI perf-regression gates, micro-vs-macro reasoning |
| **Interview sections** | 1 (Go language & runtime), 17 (performance engineering), 15 (testing) |
| **Est. effort** | 2–4 focused days |

---

## 1. Context

You're optimizing the hot path of a high-RPS service — say, the request-decode
and routing step that runs on every one of 80k req/s. Someone sends a PR claiming
"new JSON path is 30% faster, see the benchmark." You run it and get a *different*
number. You run it again and get a third. The benchmark allocates a slice the
compiler can prove is unused, the loop body gets hoisted out of `b.N`, the laptop
throttled mid-run, and the "30%" is inside the noise.

This is the normal state of microbenchmarks. A microbenchmark is a *measurement
instrument*, and an uncalibrated instrument is worse than none — it gives false
confidence. Your job in this project is to build benchmarks you can trust, learn
exactly how `testing.B` can betray you, and connect a micro number to the macro
load-test number so you know when a 12 ns/op win actually matters and when it's
theatre. You will produce numbers with confidence intervals, not opinions.

## 2. Goals / Non-goals

**Goals**
- Write a single benchmark that is **correct**: no dead-code elimination, warmed
  up, allocations reported, and stable enough that repeated runs agree.
- Defeat the compiler: prove (via `go test -gcflags=-m` and disassembly) that the
  work you think you're measuring is actually executed.
- Quantify variance and reduce it: measure the run-to-run coefficient of variation
  on your machine and drive it down with pinning, frequency control, and `-count`.
- Run an **A/B comparison the right way** with `benchstat`: multiple runs per
  side, a p-value, and a confidence/`±` on the delta — and learn to *withhold a
  conclusion* when `p > 0.05`.
- Benchmark **concurrent** code with `RunParallel` and a `-cpu` sweep; read
  per-core scalability, not just a single throughput number.
- Wire a **CI gate** that fails a build on a *statistically significant* slowdown
  of a tracked benchmark — and tune it so it doesn't fire on noise.
- Connect micro to macro: take the hot-path function you benchmarked, drive it
  through a load test, and show the relationship (and the limits) between the
  `ns/op` and the system's RPS/p99.

**Non-goals**
- Profiling and flame graphs — that's project 07 (this project tells you *whether*
  a change helped; 07 tells you *where* to spend the effort).
- Allocation-reduction technique itself (`sync.Pool`, escape analysis, arenas) —
  that's project 05. Here you only need to *measure* allocations honestly.
- Building a benchmark *framework*. Use `testing.B` and `benchstat` as shipped.
- Cross-language benchmark wars. One language (Go), measured rigorously.

## 3. Functional requirements

1. A package under test (`hotpath/`) with **at least two implementations** of the
   same hot-path function (e.g. a request-key builder, a JSON field extractor, or
   a small encoder), so you have a real A vs B to compare.
2. A benchmark suite (`hotpath/bench_test.go`) that:
   - measures both implementations with `b.ReportAllocs()` and a defended sink so
     no result is eliminated;
   - calls `b.ResetTimer()` after any per-benchmark setup;
   - parameterizes input **size** via sub-benchmarks (`b.Run(fmt.Sprintf("n=%d", n), …)`);
   - includes a `RunParallel` variant for the concurrent path.
3. A `scripts/bench.sh` that runs each side `-count=10` (or more) into separate
   files and produces a `benchstat old.txt new.txt` report committed as an artifact.
4. A **CI workflow** (`/.github/workflows/bench.yml` or equivalent) that runs the
   tracked benchmarks on a PR, compares against a stored baseline with
   `benchstat`, and **fails** when a tracked metric regresses with `p < 0.05` by
   more than a stated threshold.
5. A short bridge to the load test (project 01): drive the *same* hot-path through
   the load generator at a defined RPS and record the system p99, so the findings
   note can place the micro delta next to the macro delta.

## 4. Load & data profile

This project's "load" is the **input to the function under test** and the
**parallelism** of the benchmark — that's where the two scale axes live.

- **Input sizes:** sweep at least `n ∈ {1, 64, 1024, 65536}` so an O(n) and an
  O(n²) implementation visibly diverge. State the units (bytes, elements, fields).
- **Input shape:** deterministic given a seed (`cmd/gen` or a `testing` helper);
  include at least one *adversarial* shape (e.g. all-distinct keys vs all-same key,
  worst-case for a map or a sort) so you don't benchmark the lucky case.
- **Parallelism:** sweep `-cpu=1,2,4,8` (and up to your core count) for the
  `RunParallel` benchmark; record per-core `ns/op` and total throughput.
- **Runs per measurement:** `-count ≥ 10` per side for any A/B claim; more if the
  coefficient of variation is high. One run is never a measurement.
- **Machine state:** record CPU model, core count, `GOMAXPROCS`, governor/turbo
  state, and whether the machine was otherwise idle. A benchmark number without
  its machine context is not reproducible.

## 5. Non-functional requirements / SLOs

These are the *measurement-quality* SLOs — the bar your instrument must clear
before any performance claim it produces is allowed to count.

| Metric | Target |
|--------|--------|
| Correctness of the benchmark (no DCE) | The measured work is provably executed — `-gcflags=-m` and/or disassembly show the call is not elided; removing the sink changes `ns/op` |
| Run-to-run coefficient of variation (single benchmark, `-count=10`) | < 3% on a quiesced machine; if you can't get under ~5%, you must say so and widen your significance threshold accordingly |
| Warm-up | `b.N` auto-scales to ≥ ~1 s of work; first iterations not counted (timer reset after setup) |
| Allocation accounting | `B/op` and `allocs/op` reported for every benchmark; a "zero-alloc" claim shows `0 allocs/op` |
| A/B significance | A speedup is only claimed when `benchstat` reports `p < 0.05`; the report includes the `±` / confidence and the delta % |
| Regression-detection threshold (CI gate) | Gate fires on a real ≥ X% slowdown (state X, e.g. 5%) at `p < 0.05`; **false-positive rate** of the gate on a no-op PR is ~0 over 10 trial runs |
| Micro↔macro link | The findings note states the hot-path `ns/op`, the fraction of request CPU it represents, and the *measured* effect on system p99/RPS |

> The goal is not a fast number — it's a number you would **bet the deploy on**.
> A benchmark you can't reproduce within its stated variance is not a result.

## 6. Architecture constraints & guidance

- **Defeat dead-code elimination explicitly.** Assign the result to a package-level
  `var sink T` (or accumulate into one), then read it. The compiler must not be
  able to prove the result is unused. A function call whose result is discarded and
  whose body has no observable effect can be eliminated entirely — and then you're
  timing an empty loop.
- **Beware hoisting & constant-folding.** If the benchmark input is a constant, the
  compiler can compute the answer once and hoist it out of the `b.N` loop. Vary the
  input by loop index, or read it from a slice the compiler can't see through.
- **Use `//go:noinline` deliberately**, not reflexively. Inlining is *real*
  behavior you usually want to measure; force `noinline` only when you're isolating
  a single function's cost and inlining would fuse it into the loop and let the
  optimizer cheat. State why each `noinline` is there.
- **`b.ResetTimer()` after setup, `b.StopTimer()`/`b.StartTimer()` around
  per-iteration setup** you don't want counted — but know that `StopTimer` in a
  tight loop adds overhead and can itself distort cheap benchmarks; prefer building
  inputs once outside the timed region.
- **`b.ReportAllocs()`** on every benchmark (or `-benchmem`). Allocations are often
  the real story; an implementation that's 5 ns/op slower but does `0 allocs/op`
  may win at scale because it doesn't feed the GC.
- **Pin and quiet the machine.** Disable turbo / set a fixed CPU governor
  (`performance`), close everything else, and ideally pin to specific cores
  (`taskset` on Linux). Thermal throttling and frequency scaling are the #1 source
  of fake variance. On a laptop, run plugged in.
- **`benchstat` is the arbiter.** Never eyeball two `ns/op` numbers and declare a
  winner. Feed `-count`-many runs of each side to `benchstat`; it computes the
  delta, the `±` (or confidence interval), and a p-value via the Mann–Whitney
  U test. `p > 0.05` means **"no detectable difference,"** full stop.
- **Tooling versions:** modern `benchstat` lives at
  `golang.org/x/perf/cmd/benchstat`. Pin its version in your findings — output
  format and the default statistics have changed across versions.

## 7. Data model

```
benchmark sample (one -count run, one b.Run case):
  { name string, n int, cpu int, ns_per_op float64, b_per_op int, allocs_per_op int }

run file (go test -bench=. -count=10 -benchmem > old.txt):
  goos/goarch/pkg/cpu header + N lines of:
  BenchmarkXxx/n=1024-8   123456   812 ns/op   256 B/op   3 allocs/op   (×10 lines)

benchstat comparison (benchstat old.txt new.txt):
  per benchmark row: old (mean ± / CI), new (mean ± / CI), delta %, p-value
  p < 0.05  → significant;  "~"  → not significant (withhold the claim)

CI baseline:
  baseline.txt committed per tracked benchmark; PR run produces new.txt;
  gate = benchstat baseline.txt new.txt, parsed for delta% > X at p<0.05 → exit 1
```

`ns/op` is a *mean over `b.N` iterations*; `-count` gives you a *sample of means*,
and that sample is what `benchstat` reasons over. The single `ns/op` you see in
one run is one draw from a distribution — never quote it alone.

## 8. Interface contract

- `go test -run=^$ -bench=BenchmarkHotpath -benchmem -count=10 ./hotpath/`
- `go test -bench=BenchmarkHotpathParallel -cpu=1,2,4,8 ./hotpath/`
- `scripts/bench.sh <ref-old> <ref-new>` → checks out each, runs the suite
  `-count=10` into `old.txt`/`new.txt`, prints `benchstat old.txt new.txt`.
- `scripts/gate.sh new.txt baseline.txt -threshold 5` → exit non-zero iff any
  tracked benchmark regressed > 5% at `p < 0.05`.
- Verification of "no DCE": `go test -gcflags=-m ./hotpath/ 2>&1 | grep <fn>` plus
  a disassembly check (`go test -gcflags=-S`), recorded in the findings note.
- Micro↔macro bridge: `cmd/loadbridge -rate <rps> -duration 2m` drives the same
  function through project 01's harness and emits system p50/p99/RPS.

## 9. Key technical challenges

- **Dead-code elimination is silent.** The most common failure: the benchmark
  reports a few hundred picoseconds/op because the compiler deleted the work
  entirely. The tell is an implausibly tiny `ns/op` and *no allocations*. You must
  prove the work runs — sink + read, and confirm with `-gcflags=-m`. Until you've
  seen DCE *fire* on a deliberately broken benchmark, you don't really know it.
- **`b.N` mechanics & warm-up.** `testing` runs the body with a growing `b.N`
  until the timed region reaches ~1 s, then reports the last run's `ns/op`. If your
  per-iteration setup leaks into the loop, you measure setup, not work. If the
  function has a one-time cold-cache cost, the first cheap `b.N` values mislead.
- **CPU frequency scaling & noise.** Turbo boost, thermal throttling, and
  background processes produce 10–30% swings that dwarf the change you're hunting.
  This is *the* reason naive A/B "it's faster on my machine" claims are worthless.
  Control it, or measure it and inflate your significance bar.
- **Single-run delusion.** One `ns/op` vs another `ns/op` tells you nothing about
  significance. A 4% "improvement" from a single run is, on most machines, pure
  noise. The fix is `-count` + `benchstat` — and the discipline to report `~` (no
  difference) when the statistics say so.
- **Benchmarking concurrency honestly.** `RunParallel` measures aggregate
  throughput across `GOMAXPROCS` workers — but contention (a shared mutex, false
  sharing, an atomic hot line) makes per-core `ns/op` *rise* as you add cores. A
  benchmark that only runs at `-cpu=1` hides the exact scalability problem the
  high-RPS service will hit. The `-cpu` sweep is where contention becomes visible.
- **Micro ≠ macro.** A function that's 2× faster in isolation may move system p99
  by 0% — because it wasn't on the critical path, or the bottleneck is the DB, or
  GC pressure dominates, or the win is amortized away by batching. A micro number
  is a *hypothesis* about the system; the load test is the test of that hypothesis.

## Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 correct first — a benchmark that lies at Stage 0 lies at every stage.
Each stage pushes one axis (input size, then parallelism) before combining them and
gating the result in CI.

| Stage | Input size | Parallelism | What's measured | Pass criterion |
|-------|-----------|-------------|-----------------|----------------|
| **0 · Simple** | one fixed `n` (e.g. 1 KB) | `-cpu=1` | A single clean benchmark: `ns/op`, `B/op`, `allocs/op` of one implementation | No DCE (proven via `-gcflags=-m` + sink-removal sanity check); timer reset after setup; **CV < 3%** over `-count=10` on a quiesced machine |
| **1 · Big data** | sweep `n ∈ {1, 64, 1k, 64k}` | `-cpu=1` | `ns/op` and `allocs/op` *as a function of n* across both implementations | The complexity curve is **read off the numbers**: an O(n) vs O(n²) gap is visible in the sweep, and per-`n` allocation growth is quantified and explained |
| **2 · High RPS** | one fixed `n` | `RunParallel`, `-cpu=1,2,4,8,…` | Aggregate throughput and **per-core `ns/op`** as cores are added | Scalability characterized: state whether the path scales linearly or where contention (mutex/atomic/false-sharing) flattens or worsens per-core cost, with the inflection point named |
| **3 · Both** | large `n` (≥ 64k) | high parallelism (`-cpu` = core count) | Worst realistic load on the hot path **+ a benchstat-gated CI regression check** | A↔B compared with `benchstat` (`p < 0.05`, `±` reported); CI gate **fails on a real ≥5% slowdown** and **does not fire** on a no-op PR over 10 trials; findings note links the micro `ns/op` to the measured system p99/RPS |

## 10. Experiments to run (break it / tune it)

Record before/after numbers, the `benchstat` row (with p-value), and a one-line
conclusion for each:

1. **Watch DCE fire.** Write the "obvious" benchmark that discards the result. Note
   the absurd `ns/op`. Add the sink + read; watch `ns/op` jump to a realistic
   value. Confirm with `go test -gcflags=-m`. This is the foundational experiment —
   do it first.
2. **Hoisting demo.** Benchmark with a *constant* input, then with an
   index-varied input from a slice. Show the constant version is suspiciously fast
   because the compiler folded it. Quantify the gap.
3. **Warm-up / timer placement.** Put expensive setup inside the timed loop, then
   move it out with `b.ResetTimer()`. Show how much the misplaced setup inflated
   `ns/op`, and how `StopTimer`/`StartTimer` overhead distorts a *cheap* benchmark.
4. **Variance hunt.** Run the same benchmark `-count=20` with turbo on vs a fixed
   `performance` governor (and idle vs a busy machine). Report the coefficient of
   variation for each condition. Show that an A/B "win" smaller than your noise is
   undetectable.
5. **A/B done right.** Compare implementation A vs B with `benchstat` at
   `-count=10`. Report delta %, `±`, and p. Then construct a case where the
   difference is *real but tiny* and `p > 0.05` — and correctly report "no
   detectable difference."
6. **Input-size sweep (complexity).** Run both implementations across the `n` sweep.
   Plot `ns/op` and `allocs/op` vs `n`. Identify which is O(n) and which is O(n²)
   *from the numbers alone*, and verify against the code.
7. **Parallel scaling / contention.** Run the `RunParallel` benchmark across the
   `-cpu` sweep. Show a contended version (shared mutex/atomic) whose per-core
   `ns/op` *rises* with cores, vs a sharded/local version that stays flat. Name the
   inflection point.
8. **CI gate, true & false positive.** Introduce a deliberate 8% slowdown and prove
   the gate fails the build with its `benchstat` evidence. Then run the gate on a
   no-op PR 10 times and prove it never fires. Report the gate's threshold and
   false-positive rate.
9. **Micro↔macro reconciliation.** Take the A/B micro delta from experiment 5,
   drive both versions through the load harness at a fixed RPS, and report the
   change in system p99 and max sustainable RPS. Explain any *gap* between the micro
   win and the macro effect (critical-path fraction, GC, batching, the real
   bottleneck).

## 11. Milestones

1. `hotpath/` with A and B; first clean Stage-0 benchmark; DCE proven defeated
   (experiment 1) and CV measured.
2. Input-size sweep + allocation accounting (Stage 1, experiments 2, 6); complexity
   curves read off the numbers.
3. `RunParallel` + `-cpu` sweep (Stage 2, experiment 7); contention characterized.
4. `benchstat` A/B discipline + variance control (experiments 3, 4, 5); a result
   you'd bet on.
5. CI regression gate with proven true-positive and ~0 false-positive (Stage 3,
   experiment 8); micro↔macro bridge (experiment 9); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] A Stage-0 benchmark with **proven** no-DCE (sink + `-gcflags=-m` evidence in
      the note) and a measured CV < 3% (or a stated, justified higher bar).
- [ ] `B/op` and `allocs/op` reported for every benchmark; any "zero-alloc" claim
      shows `0 allocs/op`.
- [ ] An input-size sweep that reveals the O(n) vs O(n²) difference *from the
      numbers*, with the allocation-growth explanation.
- [ ] A `RunParallel` `-cpu` sweep with per-core `ns/op` and a named contention
      inflection point (or a justified "scales linearly" with evidence).
- [ ] An A/B `benchstat` report committed, including a case correctly reported as
      `~` (not significant) — proving you withhold conclusions when the stats say so.
- [ ] A CI gate that **fails** on a real ≥5% slowdown (show the failing run) and
      does **not** fire on a no-op PR over 10 trials (show the green runs).
- [ ] A findings note connecting the micro `ns/op` to the measured system p99/RPS,
      including any gap and its explanation.
- [ ] Every number is reproducible from a committed command + the recorded machine
      context (CPU, GOMAXPROCS, governor, idle state, `benchstat` version).

## 13. Stretch goals

- **`benchstat` over time:** store baselines per commit and plot the tracked
  benchmark's trend across the last N merges to catch slow drift (the "boiling
  frog" regression no single PR trips).
- **`-benchtime` sensitivity:** run with `-benchtime=100x` vs `-benchtime=1s` vs
  `-benchtime=10s` and show how fixed-iteration vs fixed-time benchmarking changes
  variance and what each is good for.
- **`perflock` / cpuset isolation:** add machine-level isolation (a dedicated
  benchmark runner, `perflock`, or isolated cores) and re-measure your CV to show
  the variance floor your CI gate can actually rely on.
- **PGO interaction:** build with profile-guided optimization and re-benchmark —
  show how PGO moves inlining decisions and therefore your micro numbers.
- **Allocation regression gate:** extend the CI gate to fail on an `allocs/op`
  increase too, not just `ns/op` — often the earlier and more reliable signal.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Benchmark correctness | Knows to add a sink; benchmark looks right | **Proves** no DCE via `-gcflags=-m`/disassembly; has *seen* DCE fire and can spot a fake number on sight |
| Variance control | Runs `-count` and averages | Measures CV, controls frequency scaling, states the machine context, and sets the significance bar to the noise floor |
| Statistical reasoning | Uses `benchstat` for A/B | Reads the p-value and `±`; **withholds** the claim when `p > 0.05`; explains what the test actually tests |
| Allocation accounting | Reports `allocs/op` | Treats allocations as a first-class signal; knows when the alloc delta predicts the macro win better than `ns/op` |
| Concurrency benchmarking | Uses `RunParallel` | Sweeps `-cpu`, reads per-core scaling, locates the contention inflection, ties it to the high-RPS path |
| CI gating | Has a benchmark in CI | Gate fires on real regressions, doesn't fire on noise (proven both ways); threshold justified by measured variance |
| Micro↔macro judgment | Reports the `ns/op` | Connects (or *disconnects*) the micro win from the system p99; trusts only statistically-sound numbers and says so when a micro number is meaningless |
| Communication | Clear findings note | Could defend every delta — and every `~` — to a staff panel |

> Staff bar in one line: **trusts only statistically-sound numbers**, knows when a
> micro number is meaningless, and never ships a perf claim without a p-value and a
> machine context behind it.

## 15. References

- Go `testing` package docs: `B`, `b.N`, `ResetTimer`, `ReportAllocs`,
  `RunParallel`, `-bench`, `-benchmem`, `-benchtime`, `-count`, `-cpu`.
- `golang.org/x/perf/cmd/benchstat` — installation, output format, the
  significance test it uses; pin the version you used.
- Dave Cheney, "How to write benchmarks in Go" and "High Performance Go Workshop"
  — DCE, sinks, `b.N` mechanics, the canonical pitfalls.
- Gil Tene on measurement honesty (the load-side companion: project 01, coordinated
  omission) — the same "your instrument is lying to you" discipline, applied to
  latency.
- Builds on [`load-testing/01-distributed-load-generator`](../01-distributed-load-generator/)
  (the macro side of the micro↔macro bridge); feeds
  [`load-testing/07-profiling-guided-optimization`](../07-profiling-guided-optimization/)
  (benchmarks tell you *whether*; profiling tells you *where*).
- See also: `Interview Question/17-performance-engineering/` (benchmarking,
  measurement, regression) and `Interview Question/01-golang-language-and-runtime/`
  (compiler optimizations, inlining, escape analysis, the GC the allocations feed).
