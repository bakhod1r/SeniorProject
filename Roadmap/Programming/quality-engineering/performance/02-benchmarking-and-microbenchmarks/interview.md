# Benchmarking and Microbenchmarks — Interview Questions

> **Roadmap:** [Performance](../README.md) → Benchmarking and Microbenchmarks
> *A benchmarking interview rarely asks "what is `time.Now()`." It hands you a microbenchmark reporting `0.3 ns/op` and asks why that number is a lie — then watches whether you reach for "the compiler deleted my code" or for "let me run it again." This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Why Benchmark at All](#theme-1--why-benchmark-at-all)
3. [Theme 2 — Microbenchmark Pitfalls](#theme-2--microbenchmark-pitfalls)
4. [Theme 3 — Statistics and Noise](#theme-3--statistics-and-noise)
5. [Theme 4 — Tooling](#theme-4--tooling)
6. [Theme 5 — Micro vs Macro and Coordinated Omission](#theme-5--micro-vs-macro-and-coordinated-omission)
7. [Theme 6 — Debugging Scenarios](#theme-6--debugging-scenarios)
8. [Theme 7 — Design and Judgment](#theme-7--design-and-judgment)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **measure vs guess** (a number under a profiler beats an opinion about hot paths)
- **the benchmark vs what it claims to measure** (the optimizer may have measured nothing)
- **a single number vs a distribution** (mean hides the tail; the tail is the product)
- **micro vs macro** (a fast function inside a system that's bottlenecked elsewhere is a fast irrelevance)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *distrust the number first* — they assume a microbenchmark is wrong until it survives an attack, rather than reading the first result aloud as fact.

---

## Theme 1 — Why Benchmark at All

### Q1.1 — Why benchmark instead of reasoning about which code is faster?

> **Testing:** Whether you respect that intuition about performance is routinely wrong.

**A.** Because hardware defeats intuition. Branch prediction, cache hierarchy, prefetching, SIMD, and the optimizer mean the "obviously faster" algorithm frequently loses: a linear scan over a contiguous slice beats a "smarter" linked-list traversal because it's cache-friendly; a branchless version beats a clever early-exit because the branch was mispredicting. None of that is visible in the source. The discipline is *measure, don't guess* — and specifically measure on representative hardware with representative data, because the answer changes across CPUs and input distributions. Benchmarking exists to make performance an empirical question instead of an argument between two engineers who both feel confident.

### Q1.2 — A senior engineer says "this loop is the bottleneck." How do you respond?

> **Testing:** Whether you profile before you benchmark, and benchmark before you optimize.

**A.** I'd ask for the profile. The order of operations is: **profile to find where time actually goes**, then **benchmark the specific hot path** to get a stable before/after number, then **optimize**. Skipping the profile is how teams spend a sprint shaving a loop that's 2% of runtime while the real cost is a synchronous DNS lookup or an N+1 query. Knuth's "premature optimization is the root of all evil" is really an argument *for* measurement: you earn the right to optimize a piece of code by showing, with a profile, that it matters. A benchmark without a profile to justify it is optimizing on a hunch.

### Q1.3 — What's the difference between a benchmark and a profile, and when do you use each?

> **Testing:** Two tools, two jobs — do you conflate them?

**A.** A **profile** answers *where* — it samples or instruments a whole running workload and tells you which functions, lines, or allocations dominate. A **benchmark** answers *how fast* — it repeatedly runs one isolated piece of code and produces a comparable number (ns/op, throughput, allocations). You profile to *locate* the problem and to validate that your benchmark targets something that matters; you benchmark to *quantify* a change to that located hot path and to guard it against regression. Using a benchmark to find the bottleneck is backwards — you'd be measuring code you guessed at. See [../01-profiling/01-cpu-profiling/interview.md](../01-profiling/01-cpu-profiling/interview.md) for the profiling side of this.

---

## Theme 2 — Microbenchmark Pitfalls

### Q2.1 — A microbenchmark times a pure function and reports 0.3 ns/op. What happened?

> **Testing:** The single most important microbenchmark failure: dead-code elimination.

**A.** The compiler almost certainly **deleted the work**. If the function has no observable side effect and its result is never used, the optimizer is free to prove the call is dead and remove it entirely — so you're timing an empty loop, and 0.3 ns/op is the cost of *nothing*. The fix is to make the result escape so the optimizer can't prove it's unused: in Go, assign to a package-level sink (`sink = result`) inside the loop, or use `b.Loop()` (Go 1.24+) which is designed to defeat this; in JMH, **return the value from the method** or feed it to a `Blackhole`; in google/benchmark, call `benchmark::DoNotOptimize(result)` and `benchmark::ClobberMemory()`. The tell is a number that's physically implausible — sub-nanosecond for anything doing real arithmetic means the arithmetic isn't happening.

### Q2.2 — Even with a sink, the benchmark folds to a constant. Why, and how do you stop it?

> **Testing:** Constant folding and loop-invariant hoisting, the subtler cousins of DCE.

**A.** Two related optimizations. **Constant folding**: if the input is a compile-time constant, the optimizer computes the answer at compile time and your loop just returns a literal — you've benchmarked a `mov`. **Loop-invariant code motion (hoisting)**: if the computation doesn't depend on the loop variable, the optimizer lifts it *out* of the loop and runs it once, so dividing by iteration count gives a meaningless tiny number. The defenses are symmetric: make the **input vary or come from a non-constant source** the optimizer can't see through (read it from a slice indexed by the loop counter, or mark it volatile/opaque), and make the **output escape** (the sink from Q2.1). JMH's `@State` objects and `Blackhole.consumeCPU`, and google/benchmark's `DoNotOptimize` on *both* input and output, exist precisely to break these two optimizations.

### Q2.3 — What is warm-up, and why does the first iteration of a JVM benchmark lie?

> **Testing:** JIT compilation, tiered compilation, and steady state.

**A.** On a managed runtime, the **JIT hasn't run yet** at the start. The JVM begins interpreting bytecode, then C1-compiles hot methods, then C2-recompiles the hottest with aggressive optimizations — so the same code gets faster over the first few thousand invocations as it climbs the tiers. The first iterations also pay class loading, lazy initialization, and a cold instruction/data cache. If you average those in, you're measuring a transient that never happens in a long-running server. So you **warm up**: run untimed iterations until the runtime reaches **steady state**, then measure. JMH does this for you with `@Warmup`/`@Measurement` forks; rolling your own JMH-style harness almost always under-warms. The same logic applies, more mildly, to AOT languages: cold caches and lazy `sync.Once` init mean the first call differs from the millionth.

### Q2.4 — Go statically links and has no JIT. Does it still need warm-up and these guards?

> **Testing:** Whether you understand the guards are about the *optimizer and the machine*, not just the JIT.

**A.** Yes — the JIT is gone but the other traps remain. The Go compiler still does dead-code elimination, constant folding, and inlining, so DCE and constant-folding defenses are mandatory. And the *machine* still warms up: cold caches, TLB misses, CPU frequency ramping from idle, and on-demand page faults all make early iterations slow. `testing.B` amortizes this by choosing `b.N` adaptively and running enough iterations to dominate the fixed costs, and `b.ResetTimer()` lets you exclude expensive setup. The lesson generalizes: warm-up and anti-DCE guards aren't JVM trivia, they're properties of *optimizing compilers running on real CPUs*, which is everything.

### Q2.5 — Your benchmark allocates inside the timed loop. Why might that distort the comparison?

> **Testing:** Whether you isolate the thing under test from GC and allocator noise.

**A.** Allocation drags in the allocator and the garbage collector, which run *asynchronously and amortized* — a GC pause triggered by your benchmark's garbage lands on some arbitrary iteration, inflating its time and adding variance, and the cost attributed to "the function" is really "the function plus its share of a collection." If allocation is genuinely part of what you're comparing, keep it and **report allocations explicitly** (`b.ReportAllocs()` / `-benchmem` in Go, `-prof gc` in JMH) so the number is honest. If it isn't — if you only care about CPU cost of the algorithm — preallocate buffers outside the timed region and reuse them. Either way, name it: "this is 40 ns/op *and 2 allocs/op*" is a different claim than "40 ns/op."

---

## Theme 3 — Statistics and Noise

### Q3.1 — Should you report mean, median, or percentiles for a benchmark? Defend it.

> **Testing:** Whether you know the mean is the wrong default for skewed, tail-heavy data.

**A.** It depends on the question, but the **mean is the worst default** for latency. Latency distributions are right-skewed with heavy tails — a single GC pause or context switch drags the mean far above the typical case, so the mean describes neither the common experience nor the bad one. The **median (p50)** is robust to those outliers and answers "what does a typical call cost." But the product is usually the tail: **p99/p99.9** answer "how bad is the bad case," which is what users actually feel and what SLOs are written against. For a tight CPU microbenchmark with low noise the mean and median nearly coincide and either is fine; for anything touching I/O, locks, or the allocator, report **percentiles**, and never report mean alone. Min is also useful for a microbenchmark: it's the closest thing to "the work with no interference."

### Q3.2 — Two benchmark runs differ by 3%. Is the change real?

> **Testing:** Whether you reason about variance and significance instead of eyeballing two numbers.

**A.** Unknown without the variance. A 3% difference is meaningless if run-to-run noise is ±5%, and clearly real if noise is ±0.2%. You can't judge a delta from two single numbers — you need **multiple runs of each** and a measure of spread. The right tool in Go is **benchstat**: run each version ~10+ times (`-count=10`), then `benchstat old.txt new.txt`, which reports the median delta *and* a p-value plus the `~` marker when the difference is statistically indistinguishable from noise. JMH reports confidence intervals for the same reason. The discipline: never claim a regression or improvement from `n=1`; let the statistics tell you whether the signal exceeds the noise.

### Q3.3 — What statistical test does benchstat use, and why not just a t-test?

> **Testing:** Senior-level statistics awareness — distribution-free testing.

**A.** Modern benchstat uses the **Mann–Whitney U test** (a rank-based, non-parametric test). The reason it avoids the classic two-sample t-test is that the t-test assumes roughly **normally distributed** samples, and benchmark timings are not normal — they're skewed, multimodal (steady state vs the occasional GC blip), and tail-heavy. Mann–Whitney makes no normality assumption; it asks whether one sample tends to rank higher than the other, which is exactly the robust question you want for noisy timing data. The practical upshot is the same: it gives you a p-value so you can say "this 3% is significant at p<0.05" rather than guessing.

### Q3.4 — Your laptop benchmark swings wildly. Name the OS/hardware sources of noise and how you'd suppress them.

> **Testing:** Whether you can make a machine *quiet* before trusting it.

**A.** The big ones:
- **CPU frequency scaling / turbo boost** — the clock ramps and throttles, so the same code runs at different speeds. Pin the governor to `performance` (`cpupower frequency-set -g performance`) and, for serious work, disable turbo so the frequency is fixed.
- **Thermal throttling** — a hot laptop downclocks mid-run; let it cool, or run on a cooled/desktop machine.
- **Scheduler migration and other tenants** — the OS moves your thread across cores (cold caches) and other processes steal cycles. **Pin to a core** (`taskset -c 3`, or `isolcpus` + `cset shield` to evacuate that core), close everything else, disable the screensaver/indexer.
- **Hyperthreading / SMT** — a sibling thread shares execution units; isolate the physical core or disable SMT.
- **ASLR and address-layout effects** — randomized layout shifts cache/TLB behavior run to run; some setups disable it for reproducibility.

The honest answer for most engineers: laptops are noisy by design (power management), so I'd run on a dedicated, pinned, fixed-frequency machine for any number I'm going to make a decision on — and treat laptop numbers as directional only.

### Q3.5 — Why run many short iterations rather than one long timed run?

> **Testing:** Sampling the distribution vs getting a single point.

**A.** Because one long run gives you a single number that has *already averaged away the distribution you care about* — you can't recover variance, percentiles, or whether a GC pause happened from one aggregate. Many iterations let you observe the **distribution**: the median, the tail, the variance, and outliers you can investigate or discard. It also lets statistical tests work (Q3.3) and lets the harness detect that it has enough samples to be confident. The exception is fixed costs: each iteration must run *enough work* that timer resolution and call overhead don't dominate — which is why `testing.B` runs the body `b.N` times and scales `b.N` up until the total is large enough to time accurately.

---

## Theme 4 — Tooling

### Q4.1 — What does Go's `testing.B` do for you, and what does it deliberately not guard against?

> **Testing:** Knowing the tool's contract — and its sharp edges.

**A.** `testing.B` **adaptively chooses `b.N`** so the timed region runs long enough to measure accurately, **reports ns/op** (and bytes/allocs with `b.ReportAllocs()`/`-benchmem`), gives you `b.ResetTimer()`/`b.StartTimer()`/`b.StopTimer()` to exclude setup, and `b.RunParallel` for contention benchmarks. What it does *not* do automatically is defeat **dead-code elimination and constant folding** — that's on you (assign to a sink, or use the newer `b.Loop()` which is designed to keep the body live). It also doesn't pin CPUs, fix frequency, or run statistics across runs — you pair it with `-count=N` and **benchstat** for that. So `testing.B` handles iteration scaling and reporting; *you* handle the optimizer and the machine.

### Q4.2 — What specific traps does JMH exist to eliminate?

> **Testing:** Whether you know the JVM-specific failure modes by name.

**A.** JMH (Java Microbenchmark Harness) is built because hand-rolled JVM benchmarks are almost always wrong. It guards:
- **Dead-code elimination** — return your result or sink it into a `Blackhole`, which JMH consumes in a way the JIT can't optimize away.
- **Constant folding** — read inputs from `@State` objects the JIT must treat as non-constant.
- **Warm-up / JIT tiering** — `@Warmup` runs untimed iterations to reach steady state before `@Measurement`.
- **Profile pollution across benchmarks** — `@Fork` runs each benchmark in a **fresh JVM** so one method's JIT profile doesn't bias another's.
- **Loop optimizations** — it controls the loop so the JVM can't unroll/hoist your work away.

It also reports confidence intervals. The meta-point: JMH encodes, as a framework, every lesson from a decade of people publishing bogus JVM benchmarks.

### Q4.3 — In Rust's criterion and C++'s google/benchmark, what's the equivalent of "don't let the compiler delete it"?

> **Testing:** Whether you can map the same concept across ecosystems.

**A.** Same idea, different spelling. In **criterion** you wrap values in `std::hint::black_box(x)` (criterion re-exports it) — a function the optimizer is told to treat as opaque, so it can't prove the input is constant or the output unused; criterion also handles warm-up, statistical analysis with outlier detection, and saves baselines for regression comparison. In **google/benchmark** you call `benchmark::DoNotOptimize(value)` to force a value to be materialized and `benchmark::ClobberMemory()` to act as a compiler memory barrier so writes aren't elided; you use `state.range()` for parameterized sizes and the `BENCHMARK` macros for the loop. The portable principle across Go, Java, Rust, and C++: **make inputs opaque and outputs escape**, and let the framework own warm-up and statistics.

### Q4.4 — Why prefer a real harness over `start := time.Now(); ...; elapsed := time.Since(start)`?

> **Testing:** Whether you respect everything a harness quietly gets right.

**A.** A naive `time.Now()` wrapper times *one* run, so it captures no distribution, no warm-up, and no iteration scaling — and if the body is fast it's swamped by timer resolution and the cost of calling the clock itself. It does nothing to stop the optimizer from deleting the body. A real harness (testing.B, JMH, criterion, google/benchmark) chooses iteration counts so the timer is accurate, warms up, runs multiple samples for statistics, and gives you the hooks to exclude setup and defeat DCE. Hand-rolled timing is fine for a 10x order-of-magnitude sanity check; it is not fine for a 3% decision — and most benchmarking decisions are small-percentage decisions where the harness's rigor is the whole point.

---

## Theme 5 — Micro vs Macro and Coordinated Omission

### Q5.1 — A function is 2x faster in a microbenchmark but the service shows no improvement. How is that possible?

> **Testing:** The "microbenchmark lies about production" insight — Amdahl's law in the wild.

**A.** Several ways, all real:
- **It wasn't the bottleneck.** By Amdahl's law, doubling a function that's 5% of runtime buys at most 2.5%, lost in noise. The micro number is true and irrelevant.
- **The microbenchmark ran on data the optimizer/cache loved** — a hot L1-resident buffer, a constant size, no contention — while production runs cold caches, varied sizes, and cross-core contention that erase the win.
- **The win was at a layer that's not the constraint** — the service is I/O- or lock-bound, so CPU savings don't move the wall-clock.

The discipline is to *validate micro wins at the macro level*: a microbenchmark proves the change is faster in isolation; only a macrobenchmark or production metric proves it helps the system. Treat a micro improvement as a hypothesis about the system, not a conclusion.

### Q5.2 — Explain coordinated omission and why it makes a load test lie about latency.

> **Testing:** The most important latency-measurement trap — do you know it exists?

**A.** **Coordinated omission** is when your measurement harness accidentally *coordinates* with the system under test and skips the very requests that would have shown the worst latency. The classic case: a load generator sends one request, waits for the response, then sends the next. When the server stalls for 1 second, the generator also stalls — it simply doesn't send the requests it *would* have sent during that second, so those requests never appear in the histogram. The result is a latency distribution that drastically *understates the tail*: a 1-second stall that should have shown up as hundreds of slow requests shows up as one. The fix is to measure latency against the **intended send time** (when the request *should* have gone out at a fixed rate), not the actual send time — open-loop load generation with rate-based scheduling, as tools like wrk2 and Gil Tene's HdrHistogram-based approach do. If your load tool waits for each response before issuing the next, distrust its tail percentiles.

### Q5.3 — When is a microbenchmark the *right* tool despite all these caveats?

> **Testing:** Balance — you criticized micros, can you defend them?

**A.** When you're comparing **alternative implementations of a known-hot, isolatable piece of code** and you want a fast, repeatable, regression-guarded signal. Picking between two hashing functions, two serialization codecs, two slice-growth strategies, or checking that a refactor didn't add allocations — these are exactly what microbenchmarks do well: small surface, controllable inputs, runs in milliseconds in CI, and benchstat tells you if the delta is real. The caveat from Q5.1 is about *generalizing* a micro result to the system, not about the micro itself. The mature stance: microbenchmark to choose between implementations and to lock in regressions; macrobenchmark and profile in production to decide *what's worth microbenchmarking in the first place*.

---

## Theme 6 — Debugging Scenarios

### Q6.1 — A microbenchmark reports 0 ns/op (or sub-nanosecond). Walk me through it.

> **Testing:** Calm, hypothesis-driven triage of the canonical failure.

**A.** Sub-nanosecond means **no work is being measured** — modern CPUs can't do anything useful in 0.3 ns of amortized time, so the optimizer removed the body. Triage in order:
1. **Is the result used?** If not, dead-code elimination deleted the call. Assign it to a package-level sink (Go), return it / `Blackhole` it (JMH), `DoNotOptimize` it (google/benchmark), `black_box` it (criterion).
2. **Is the input constant?** Constant folding computed it at compile time. Feed inputs from a non-constant source (a slice indexed by the loop counter, an opaque value).
3. **Is the work loop-invariant?** Hoisting ran it once outside the loop. Make the work depend on the iteration.
4. **Confirm** by checking the generated assembly (`go build -gcflags=-S`, JMH's `-prof perfasm`) — if the loop body is empty, you've proven it.

The meta-skill is recognizing the *impossible number* as a signal of measurement failure, not a real result.

### Q6.2 — Results swing 40% run to run. Why, and how do you stabilize them?

> **Testing:** Systematic attribution of variance to environment.

**A.** A 40% swing is almost always the **machine, not the code**. Walk the usual suspects: **CPU frequency scaling / turbo** ramping and throttling; **thermal throttling** on a warm laptop; **scheduler migration** bouncing the thread across cores with cold caches; **noisy neighbors** (browser, indexer, antivirus, a VM) stealing cycles; **SMT siblings** contending for execution units; and on a cloud VM, **steal time** from co-tenants. Stabilize by making the machine quiet and deterministic: pin to an isolated core (`taskset`/`isolcpus`+`cset`), set the governor to `performance` and disable turbo so frequency is fixed, let the machine cool, close other processes, and prefer a dedicated bare-metal or fixed-size instance over a shared laptop/cloud box. Then re-measure: if the swing collapses to a couple of percent, it was environmental. If it persists on a quiet pinned machine, *then* suspect the code — genuine input-dependent branching or GC.

### Q6.3 — Your benchmark is fast in isolation but slow when run alongside the rest of the suite. What's going on?

> **Testing:** State leakage and shared-resource interference between benchmarks.

**A.** The other benchmarks changed the **shared state of the machine or runtime**. Common causes: a prior benchmark warmed or polluted the **CPU cache / TLB / branch predictor** so yours starts cold (or, oppositely, was artificially warm when run alone); a prior benchmark left the **heap large** so your run pays a GC it wouldn't have alone; on the JVM, the **JIT profile** from another method biased the compilation of shared code (which is exactly why JMH `@Fork`s a fresh JVM per benchmark); or a global like a connection pool, a `sync.Pool`, or a cache is in a different state. The fix is **isolation**: run each benchmark in its own process/fork, reset relevant global state, and call `b.ResetTimer()` after any warm-up so cross-benchmark warmth isn't measured. The takeaway — a benchmark that's only stable when run alone is telling you it has a hidden dependency on machine or runtime state.

### Q6.4 — A benchmark "improved" right after you added a print/log inside the timed loop for debugging. Trust it?

> **Testing:** Whether you understand observation perturbs the optimizer.

**A.** No — the log statement **changed what the optimizer could do**. Before, the result was unused and the body was a candidate for dead-code elimination; the `print` *uses* the value (and has a side effect), so now the work actually runs — meaning the "before" number was the deleted-code lie and the "after" is real, or the I/O dominates and the number is now meaningless. Either way the comparison is invalid because the two versions don't measure the same thing. The lesson: any change that alters observability — a print, a sink, a `DoNotOptimize` — can flip whether the optimizer elides the work, so you must establish the *anti-DCE guards as a constant baseline* and never use debug I/O inside the timed region to draw conclusions.

---

## Theme 7 — Design and Judgment

### Q7.1 — You're asked to set up benchmarking for a new library. What do you benchmark, and what do you deliberately not?

> **Testing:** Taste — benchmarking the right small set, not everything.

**A.** I benchmark the **public hot paths and the regression-prone internals**: the operations users call in tight loops (encode/decode, lookup, the core transform), the paths a profile of a realistic workload flags as expensive, and the allocation behavior of those paths (allocs/op is a frequent silent regression). I deliberately *don't* benchmark trivial getters, cold one-time setup, or code that a profile shows is negligible — those benchmarks cost CI time and maintenance while guarding nothing that matters. I also wouldn't microbenchmark anything dominated by I/O or external services in isolation, because the micro number won't reflect reality. The guiding question for each candidate benchmark: "if this regresses 2x and the benchmark doesn't catch it, do I care?" If no, don't write it.

### Q7.2 — How do you keep benchmarks useful in CI without them becoming flaky gates?

> **Testing:** Engineering benchmarks as a sustainable signal, not noise.

**A.** Shared CI runners are noisy, so a hard "fail if slower than X ns" gate produces false alarms and gets disabled. Better approaches:
- **Compare against a baseline statistically** — store last-known-good results, run with `-count` high enough, and use benchstat-style significance so only changes that exceed noise flag. Alert on regressions beyond a confidence threshold, not absolute numbers.
- **Track trends over time** (a dashboard) rather than gating every PR, so a slow drift is visible without blocking merges on jitter.
- **Run the gating benchmarks on a dedicated, pinned, quiet machine**, not the general CI pool, so the noise floor is low enough to trust.
- **Make failures actionable** — report the delta and which benchmark, so an engineer can reproduce locally.

The principle: a benchmark gate is only worth having if its noise floor is well below the regression you want to catch; otherwise it trains people to ignore it.

### Q7.3 — When should you *not* benchmark, and just ship?

> **Testing:** Whether you treat benchmarking as a cost, not a virtue in itself.

**A.** When the code isn't on a hot path, when the difference doesn't affect any user-visible metric or SLO, and when the engineering time to build a trustworthy benchmark exceeds the value of the answer. Most code is not performance-critical; benchmarking it is gold-plating that adds CI time and maintenance for a number nobody acts on. The right defaults: write clear, correct code first; let a profile of a realistic workload tell you what's actually hot; and *then* benchmark the handful of paths that matter. Benchmarking everything is its own form of premature optimization — you're paying the measurement cost without the profile that says the measurement is worth it.

### Q7.4 — A teammate's PR includes a microbenchmark proving their change is 15% faster. What do you check before approving?

> **Testing:** Reviewing a benchmark with appropriate skepticism.

**A.** I'd check, roughly in order: (1) **Are the anti-DCE/constant-folding guards present** — does the result escape and is the input non-constant, or could the optimizer have measured nothing? (2) **What's the variance and `n`** — is this `-count=10` + benchstat with a real p-value, or a single run? (3) **Is the input representative** — realistic sizes and distributions, not a cherry-picked best case? (4) **Does it match a real hot path** — is there a profile showing this code matters, or is it a 15% win on 0.5% of runtime? (5) **Allocations** — did allocs/op stay flat? A microbenchmark in a PR is a *claim*; my job is to check it survives the standard attacks before I let "15% faster" become folklore.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Mean or median for latency?** A: Median (and percentiles) — the mean is dragged around by tail outliers and describes nobody's experience.
- **Q: What does benchstat's `~` mean?** A: The difference between old and new is statistically indistinguishable from noise — don't claim a change.
- **Q: One-line cause of `0 ns/op`?** A: Dead-code elimination deleted the unused result; make it escape.
- **Q: Go's anti-DCE escape hatch?** A: Assign to a package-level sink, or use `b.Loop()` (1.24+).
- **Q: JMH's anti-DCE escape hatch?** A: Return the value or hand it to a `Blackhole`.
- **Q: google/benchmark's?** A: `benchmark::DoNotOptimize(x)` plus `ClobberMemory()`.
- **Q: criterion's?** A: `std::hint::black_box(x)`.
- **Q: Why warm up a JVM benchmark?** A: To let the JIT reach steady state before timing; cold interpreted code isn't what production runs.
- **Q: Why pin to a CPU core?** A: To stop scheduler migration from giving you cold caches and noisy, unreproducible numbers.
- **Q: Why fix CPU frequency?** A: Turbo/scaling changes the clock mid-run, so the same code times differently.
- **Q: What is coordinated omission?** A: A load tester skipping the slow requests it should have sent during a stall, hiding the tail.
- **Q: Why Mann–Whitney over a t-test?** A: Benchmark timings aren't normally distributed; the rank-based test makes no normality assumption.
- **Q: `b.ResetTimer()` is for?** A: Excluding expensive setup from the measured region.
- **Q: `-benchmem` reports?** A: Bytes/op and allocs/op alongside ns/op.
- **Q: Micro vs macro in one line?** A: Micro proves a piece is faster in isolation; macro proves it helps the system.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Reading the first benchmark number aloud as fact without suspecting the optimizer.
- Claiming a regression or win from `n=1`, or eyeballing two numbers.
- Reporting the mean for latency and never mentioning percentiles or the tail.
- Not knowing dead-code elimination / constant folding can delete the timed work.
- Treating a microbenchmark win as automatically a system win (ignoring Amdahl).
- Never having heard of coordinated omission, or trusting a closed-loop load tool's p99.
- Benchmarking on a hot laptop with turbo on and calling the number authoritative.

**Green flags:**
- Distrusting an implausible number (0 ns/op) and naming DCE/constant-folding immediately.
- Reaching for *profile first, then benchmark, then optimize* unprompted.
- Bringing up benchstat / Mann–Whitney / confidence intervals for significance.
- Pinning cores and fixing frequency before trusting a measurement.
- Naming coordinated omission and the open-loop fix.
- Framing micro vs macro with Amdahl's law and "validate at the system level."
- Knowing when *not* to benchmark — treating measurement as a cost with a payoff.

---

## Summary

- The bank reduces to four distinctions in costumes: **measure vs guess**, **the benchmark vs what it claims to measure**, **a number vs a distribution**, and **micro vs macro**. Distrust the number first.
- **Pitfalls:** dead-code elimination, constant folding, and loop hoisting can make the optimizer measure *nothing* — defeat them by making inputs opaque and outputs escape; warm up to reach steady state; report (or exclude) allocations honestly.
- **Statistics:** the mean lies for tail-heavy latency — use median and p99; never judge a delta from `n=1`; benchstat's Mann–Whitney test gives significance without assuming normality.
- **Tooling:** testing.B scales iterations and reports but won't stop DCE; JMH owns warm-up, forking, and Blackholes; criterion uses `black_box`; google/benchmark uses `DoNotOptimize`/`ClobberMemory`. All encode the same lessons.
- **Micro vs macro:** a micro win is a hypothesis about the system (Amdahl), not a conclusion; **coordinated omission** makes closed-loop load tests hide the tail — measure against intended send time.
- **Judgment:** benchmark the hot, regression-prone, isolatable paths a profile justifies; make CI gates statistical and quiet or don't gate at all; and know when shipping unbenchmarked is the right call.

---

## Further Reading

- *Systems Performance* (Brendan Gregg) — methodology, observability, and why measurements mislead.
- Gil Tene, "How NOT to Measure Latency" — the definitive talk on coordinated omission and tail latency.
- The Go blog and `testing` docs on `b.Loop()`, `-benchmem`, and benchstat; the JMH samples (`org.openjdk.jmh.samples`) — the canonical catalog of microbenchmark traps.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [01 — Performance Fundamentals](../01-profiling/01-cpu-profiling/interview.md) — Amdahl's law, latency vs throughput, and what "fast" means.
- [03 — Profiling and Flame Graphs](../01-profiling/01-cpu-profiling/interview.md) — the profile that tells you *what* to benchmark.
- [04 — Latency and Throughput](../03-latency-and-throughput/interview.md) — percentiles, tail latency, and load testing in depth.
- [Quality Engineering README](../../README.md) — where benchmarking sits in the broader interview landscape.
