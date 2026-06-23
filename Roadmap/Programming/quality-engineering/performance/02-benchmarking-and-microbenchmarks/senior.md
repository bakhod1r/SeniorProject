# Benchmarking and Microbenchmarks — Senior Level

> **Roadmap:** [Performance](../README.md) → Benchmarking and Microbenchmarks
> *The middle page taught you to run a benchmark and read its numbers. This page is about whether those numbers mean anything: the physics of the machine that adds noise, the statistics that tell signal from noise, the compiler that quietly deletes the code you are timing, and the load generator that lies to you about tail latency.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Machine Is Not a Stopwatch — Controlling Measurement Noise](#the-machine-is-not-a-stopwatch--controlling-measurement-noise)
4. [The Statistics of Benchmarking — Why the Mean Lies](#the-statistics-of-benchmarking--why-the-mean-lies)
5. [Comparing Two Versions — benchstat, p-values, and Effect Size](#comparing-two-versions--benchstat-p-values-and-effect-size)
6. [Steady State and the JIT Compilation Tiers](#steady-state-and-the-jit-compilation-tiers)
7. [The Dead-Code Elimination Arms Race](#the-dead-code-elimination-arms-race)
8. [Verify at the Assembly Level — perfasm and Disassembly](#verify-at-the-assembly-level--perfasm-and-disassembly)
9. [Coordinated Omission in Load Generators](#coordinated-omission-in-load-generators)
10. [Macro Benchmarks and Reproducible Environments](#macro-benchmarks-and-reproducible-environments)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The science of trustworthy measurement — and the long list of ways a benchmark fools you before you ever read the number.**

By the middle level you can write a `testing.B` loop, run `cargo bench`, configure a JMH `@Benchmark`, and avoid the obvious traps — you warm up, you don't time the setup, you run multiple iterations. That makes your numbers *plausible*. The senior jump is treating plausibility with suspicion.

A benchmark is a measurement instrument, and every instrument has a noise floor, a calibration, and failure modes that produce confident-looking garbage. The senior questions are: *How much of this number is the machine and not the code? Is this difference real or did I roll dice? Did the compiler actually run the work I think I measured? Is my load generator hiding the tail it was built to find?* Getting these wrong doesn't produce no answer — it produces a **wrong answer that looks rigorous**, which is worse, because it gets committed to a regression dashboard and trusted for years.

This page is the discipline that separates a number you can stake a decision on from a number that merely has error bars drawn around noise.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — `b.N` loops, warm-up, `b.ResetTimer`, JMH modes, `criterion`, avoiding timing your setup.
- **Required:** Comfort reading [profiling](../01-profiling/01-cpu-profiling/senior.md) output — a benchmark tells you *that* something changed; a profile tells you *where*.
- **Helpful:** Basic statistics: mean, median, standard deviation, what a distribution is. We'll build the rest.
- **Helpful:** You can read x86-64 assembly at the level of "this is a load, this is a multiply, this loop body is empty."

---

## The Machine Is Not a Stopwatch — Controlling Measurement Noise

A modern CPU is an adaptive, shared, thermally-constrained system that actively changes its own speed while you measure. Run the *same* microbenchmark twice and you'll see 5–30% variation from the hardware alone. Before any statistics matter, you must pin down the machine, or you're measuring the air conditioning.

The major noise sources, roughly in order of impact:

**Frequency scaling and turbo.** The CPU runs at a base frequency but boosts ("turbo") under light load and throttles under thermal or power limits. The *first* iterations of a benchmark often run at turbo (3.8 GHz), then drop to base (2.4 GHz) as the boost budget depletes — a 40% drift that looks like the code "slowing down."

```bash
# Pin to a fixed frequency: disable turbo, force the performance governor
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo
sudo cpupower frequency-set -g performance
sudo cpupower frequency-set -d 2.4GHz -u 2.4GHz   # lock min == max
cat /proc/cpuinfo | grep MHz                        # verify it actually stuck
```

**C-states (idle power states).** When a core goes idle between iterations it drops into a deep C-state; waking it costs microseconds. For a benchmark with sleeps or I/O, wake latency contaminates the timing.

```bash
# Keep cores out of deep idle for the duration of the run
sudo cpupower idle-set -D 0          # disable C-states deeper than C0
```

**CPU pinning, isolation, and hyperthreading.** The scheduler will migrate your benchmark across cores (cold caches on the new core) and let other threads — including a sibling hyperthread sharing your core's execution units — steal cycles. Pin the benchmark to a dedicated, isolated core whose sibling is offline:

```bash
# At boot (kernel cmdline): hand cores 2,3 to no one but us
isolcpus=2,3 nohz_full=2,3 rcu_nocbs=2,3

# Take core 3's hyperthread sibling offline so core 3 owns its execution units
echo 0 | sudo tee /sys/devices/system/cpu/cpu3/online   # if 3 is a sibling of 2

# Run pinned to the isolated physical core
taskset -c 2 ./bench
chrt -f 99 taskset -c 2 ./bench       # also bump to real-time priority
```

**ASLR-induced layout effects.** Address-space layout randomization changes where code and the stack land each run, which changes cache-set conflicts and branch-predictor aliasing. This produces a *bimodal* result — two stable clusters depending on the layout drawn — that masquerades as "the optimization helped 50% of the time." Mitra & Berger's [Stabilizer](https://github.com/ccurtsinger/stabilizer) work showed layout alone can swing results past the size of the effect people were publishing. To pin it down:

```bash
setarch "$(uname -m)" -R ./bench      # disable ASLR for this process
# or repeat with many random layouts and report the distribution honestly
```

**Thermal throttling and NUMA placement.** A long run heats the package and the CPU throttles — your *later* samples are slower not because of code but heat. And on a multi-socket box, memory allocated on a remote NUMA node costs ~1.5–2x the access latency of local memory; if the allocator and the thread land on different nodes between runs, you get a phantom regression.

```bash
numactl --cpunodebind=0 --membind=0 ./bench     # keep CPU and memory on node 0
turbostat --interval 1 -- ./bench               # watch frequency AND package temp
```

> **Key insight:** Before you trust a single number, ask "what was the machine doing?" Turbo, C-states, the sibling hyperthread, ASLR layout, heat, and NUMA each move results by more than most real optimizations. A senior benchmark harness *captures and controls* these — pinned frequency, isolated core, disabled ASLR, recorded temperature — so the only variable left is the code.

---

## The Statistics of Benchmarking — Why the Mean Lies

Suppose you collect 1000 timings of an operation. The reflex is to report the **mean**. The mean is almost always the wrong summary, for a structural reason: benchmark distributions are **not** Gaussian. They are right-skewed with a hard floor (the operation cannot be faster than its minimum work) and a long tail (any sample can be delayed by a context switch, a page fault, a GC pause, an interrupt).

A single 50 ms scheduler hiccup in a set of 1 µs operations drags the mean up by an amount unrelated to your code. The mean answers "if I sum all the work and divide, what's the average?" — a question you rarely care about. You care about *typical* (median) and *worst realistic* (high percentiles).

```
Sorted timings (ns):  98 99 100 100 101 101 102 ... 105   then one outlier: 51,000
  mean   ≈ 612 ns      ← dominated by ONE outlier; describes nothing
  median ≈ 101 ns      ← the typical operation; robust to the tail
  p99    ≈ 105 ns      ← realistic worst case (excluding the freak)
  min    ≈  98 ns      ← the "noise-free" lower bound — what the code can do
```

Two more truths the mean hides:

**Distributions are often multimodal.** A function that hits an inlined fast path most of the time and a slow path occasionally produces *two* peaks. So does the ASLR layout effect above, and so does a JIT recompilation mid-run. A mean (and even a standard deviation) reported over a bimodal distribution is statistical nonsense — it points to a value that *never occurs*. Always look at the histogram before summarizing:

```bash
# Go: dump every iteration's time and histogram it instead of trusting the summary
go test -bench=BenchmarkParse -benchtime=100000x -count=20 | tee raw.txt
```

**`min` is the most reproducible number.** Noise can only ever make an operation *slower*, never faster than its true cost. So the minimum across many runs is the closest thing to a noise-free measurement and the most reproducible across machines — which is exactly why `criterion` and Google Benchmark surface it prominently. The median is what users feel; the min is what the code is capable of. Report both, and the high percentiles for tail behavior.

**Confidence intervals, not single numbers.** A point estimate with no spread is a lie of precision. Report the median *with* an interval. `criterion` does this by default via bootstrapping — it resamples your data thousands of times to estimate how much the median itself could vary:

```
parse_json              time:   [101.23 µs 101.87 µs 102.61 µs]
                                  ^lower    ^estimate ^upper      (95% CI, bootstrapped)
                        change: [-2.1% -0.4% +1.3%] (p = 0.62 > 0.05)
                        No change in performance detected.
```

> **Key insight:** A benchmark produces a *distribution*, not a number. The mean is the one summary almost guaranteed to mislead, because the distribution is skewed and often multimodal. Report **median** (typical), **min** (noise-free capability), and **high percentiles** (realistic worst case), always with a confidence interval — and look at the histogram before you trust any of them.

---

## Comparing Two Versions — benchstat, p-values, and Effect Size

The real job isn't "how fast is `foo`" — it's "did my change make `foo` faster?" That is a *comparison of two distributions*, and eyeballing two medians is how false regressions get filed. Run *both* versions many times and compare statistically.

Go's `benchstat` is the reference tool. Collect N runs of each, then compare:

```bash
git checkout main
go test -bench=BenchmarkEncode -count=15 > old.txt
git checkout my-optimization
go test -bench=BenchmarkEncode -count=15 > new.txt
benchstat old.txt new.txt
```

```
name        old time/op    new time/op    delta
Encode-8     1.42µs ± 2%    1.21µs ± 3%   -14.79%  (p=0.000 n=15+15)
Decode-8      890ns ± 4%     902ns ± 8%      ~     (p=0.190 n=14+15)

name        old alloc/op   new alloc/op   delta
Encode-8      512B ± 0%      256B ± 0%   -50.00%  (p=0.000 n=15+15)
```

Read this carefully:

- **`Encode` is a real win.** `p=0.000` (well below 0.05) means the difference is statistically significant — unlikely to be chance — *and* the effect is large (-14.79%). Both matter.
- **`Decode` shows `~`** with `p=0.190`. The medians differ by ~1%, but `benchstat` refuses to call it: the noise is large enough that this difference could easily be a coincidence. Reporting "+1.3% regression" here would be filing noise as a bug.

**Why a p-value at all?** A p-value answers: "if the two versions were *actually identical*, how often would random noise alone produce a difference this big or bigger?" `p=0.000` means "basically never — so they're not identical." `p=0.190` means "this happens 19% of the time by pure chance — I can't conclude anything." It's the formal guard against shipping a "speedup" that's a lucky run.

**Why a *non-parametric* test (Mann-Whitney U)?** Older `benchstat` used a t-test, which *assumes the data is roughly Gaussian* — and we just established benchmark data isn't. The modern `benchstat` (and the right choice generally) uses the **Mann-Whitney U test**, which makes no distributional assumption: it just asks whether samples from one set tend to *rank* higher than samples from the other. Given skewed, multimodal benchmark data, the non-parametric test is the one that won't be fooled by a fat tail.

**Significance ≠ effect size.** This is the trap that catches even careful engineers. With enough samples, a *statistically significant* result can be *practically meaningless*: a 0.3% change with `p=0.001` is real but you do not care. Conversely a 15% improvement with `p=0.08` is probably real but under-sampled. Always read **both** columns: `p` tells you *whether* it's real; `delta` (the effect size) tells you *whether it matters*. A senior never reports one without the other.

> **Key insight:** Comparing performance is comparing two *distributions*, which demands a statistical test, not two medians side by side. `benchstat`'s `p` (significance, via Mann-Whitney U) answers *"is this real or noise?"*; the `delta` (effect size) answers *"is it big enough to care?"* You need both — and `~` is a feature, not a failure: it's the tool correctly refusing to call noise a result.

---

## Steady State and the JIT Compilation Tiers

On a JIT-compiled runtime — the JVM, V8, .NET — the *same bytecode runs at radically different speeds over its lifetime*, because the runtime is recompiling it underneath you. Benchmarking before the code reaches **steady state** measures the warm-up, not the workload. Understanding the tiers tells you *why* warm-up takes as long as it does.

HotSpot's tiered compilation pipeline:

```
Tier 0:  Interpreter           — every bytecode dispatched by hand. Slowest. Counts invocations.
Tier 1:  C1 (client), no prof  — quick machine code, no profiling. Used when C2 is saturated.
Tier 2:  C1 + invocation count
Tier 3:  C1 + full profiling   — instruments branches/types to feed C2. Common warm tier.
Tier 4:  C2 (server)           — the heavily-optimized code, driven by Tier-3 profiles.
```

A method climbs tiers as its invocation and back-edge counters cross thresholds. The expensive transition is Tier 3 → Tier 4: C2 inlines aggressively, unrolls loops, and *speculates* on the profile it gathered (e.g., "this call site only ever saw `ArrayList`, so devirtualize and inline it"). Until that happens — typically **thousands to tens of thousands of invocations** — you are measuring slower code. Watch it happen:

```bash
java -XX:+PrintCompilation Bench         # every (re)compilation, with tier numbers
# 1234  567       4       com.x.Bench::hot (42 bytes)   ← made it to Tier 4 (C2)
```

Worse: C2's speculation can be *invalidated*. If a previously-monomorphic call site suddenly sees a second type, C2 **deoptimizes** — throws away the optimized code, falls back to the interpreter, and recompiles. A benchmark that mixes input types mid-run can trigger a deopt and record a cliff that has nothing to do with the change under test.

This is precisely the problem JMH exists to solve. JMH runs explicit warm-up iterations (discarded) before measurement iterations, forks fresh JVMs to avoid profile pollution between benchmarks, and — critically — uses `Blackhole` to defeat DCE (next section).

```java
@Benchmark
@Warmup(iterations = 10, time = 1)        // 10s of warm-up — let it reach Tier 4
@Measurement(iterations = 20, time = 1)
@Fork(value = 5)                           // 5 fresh JVMs — independent steady states
@BenchmarkMode(Mode.AverageTime)
public void hot(Blackhole bh) { bh.consume(work()); }
```

Go and Rust are AOT-compiled, so there's no JIT warm-up — but steady state still exists in a different guise: caches must warm, the branch predictor must train, and (in Go) the GC must reach its steady allocation rhythm. The first iterations are always cold; `b.ResetTimer()` after setup and a long enough `-benchtime` cover it.

> **Key insight:** On a JIT, the code you're timing is a moving target until it reaches Tier 4 — and even then a deopt can throw the optimized code away mid-run. Measure only after warm-up has driven the hot path to steady state, fork fresh JVMs to keep profiles from leaking between benchmarks, and treat a sudden cliff as a possible deopt before you treat it as a regression.

---

## The Dead-Code Elimination Arms Race

Here is the single most embarrassing benchmark failure: the optimizer notices your benchmark's result is never used, declares the entire loop body dead, and deletes it. You then proudly report that your function runs in 0.3 ns — the cost of an empty loop. The whole field has an ongoing arms race between benchmark authors and optimizers determined to delete their work.

The classic broken Go benchmark:

```go
func BenchmarkSqrt(b *testing.B) {
    for i := 0; i < b.N; i++ {
        math.Sqrt(float64(i))   // result discarded → compiler may elide the whole call
    }
}
```

The fix is to make the result *escape* in a way the optimizer cannot prove is useless — accumulate into a package-level sink:

```go
var Sink float64   // package-level: the compiler can't prove it's unread

func BenchmarkSqrt(b *testing.B) {
    var local float64
    for i := 0; i < b.N; i++ {
        local += math.Sqrt(float64(i))   // result is used...
    }
    Sink = local                          // ...and observably escapes
}
```

Each language ships a purpose-built sink because "assign to a global" doesn't always survive aggressive optimizers:

- **Go:** a package-level exported `var Sink` (or the `b.Loop()` form in Go 1.24+, which the toolchain understands as keep-alive).
- **Java (JMH):** **return the value** from the `@Benchmark` (JMH consumes it) or pass it to `Blackhole.consume()`. The `Blackhole` is engineered to be opaque to C2 — it uses tricks (volatile reads, conditional stores) specifically so the optimizer cannot prove the value is unused without proving impossible things.
- **Rust (criterion):** `criterion::black_box(x)` — the optimizer is forced to assume `x` is read with arbitrary side effects, so it can't fold or delete the producing computation. Also `black_box` the *inputs* so constants aren't pre-computed.
- **C++ (google/benchmark):** `benchmark::DoNotOptimize(x)` (forces `x` into a register/memory the compiler must keep) and `benchmark::ClobberMemory()` (a memory barrier preventing store elimination).

```cpp
static void BM_Sqrt(benchmark::State& state) {
  double x = state.range(0);
  for (auto _ : state) {
    double r = std::sqrt(x);
    benchmark::DoNotOptimize(r);   // r must be computed and kept
    benchmark::DoNotOptimize(x);   // x is not a known constant
  }
}
```

There's a subtler failure even when the result *is* used: **loop-invariant hoisting**. If your input doesn't change across iterations, the optimizer computes the answer once and reuses it, and you measure a copy, not the work. `black_box` on the *input* defeats this by making the input opaque.

> **Key insight:** An unobserved computation is, to an optimizer, no computation. Every benchmark must make its result *and its inputs* opaque to the compiler — via `Sink`/`Blackhole`/`black_box`/`DoNotOptimize` — or you risk timing an empty loop with a straight face. And "it produced a non-zero number" is *not* proof it worked: 0.3 ns is exactly what a deleted body costs.

---

## Verify at the Assembly Level — perfasm and Disassembly

The only way to *know* your benchmark body survived is to look at the machine code the runtime actually executed. This is the senior's non-negotiable final check on any microbenchmark whose result surprises (or pleases) you.

For Go, dump the compiled assembly and confirm your work is present:

```bash
go test -gcflags=-S -bench=BenchmarkSqrt 2>&1 | grep -A30 BenchmarkSqrt
# Look for the SQRTSD instruction. If the loop body is just an increment
# and a compare, the call was eliminated and your number is meaningless.
```

For Rust:

```bash
cargo asm --bench my_bench 'my_crate::hot_function'   # cargo-show-asm
# or objdump -d target/release/deps/my_bench-*  and find the loop
```

The most powerful tool here is **JMH's `perfasm` profiler**, which runs the benchmark under Linux `perf`, samples the program counter, and then *annotates the disassembled hot loop with the percentage of cycles spent on each instruction*. It is the closest thing to x-ray vision for a microbenchmark:

```bash
java -jar benchmarks.jar Bench -prof perfasm
```

```
....[Hottest Region 1].....................................................
 c2, level 4, com.x.Bench::hot, version 3

       │  0x...a20: vmulsd %xmm1,%xmm0,%xmm0
 38.1% │  0x...a24: vaddsd %xmm0,%xmm2,%xmm2      ← the actual FP work: 38% of cycles
  4.2% │  0x...a28: inc    %r11
  2.0% │  0x...a2b: cmp    %r10,%r11
       │  0x...a2e: jl     0x...a20               ← tight loop, body intact ✓
....................................................................................
```

`perfasm` tells you three things at once: (1) your work is *there* (you can see `vmulsd`/`vaddsd`), so DCE didn't strike; (2) *where* the cycles actually go, so you optimize the right instruction; and (3) whether you've hit a real hazard — a single instruction at 80% usually means a cache miss, a mispredicted branch, or a pipeline stall, not "this instruction is slow."

JMH's `-prof gc` is the allocation analog: it reports allocation rate (`gc.alloc.rate.norm` in **bytes per operation**, which is *deterministic* and far less noisy than wall-clock), so a change that adds an allocation per call shows up cleanly even when timing noise hides it:

```bash
java -jar benchmarks.jar Bench -prof gc
# Bench:·gc.alloc.rate.norm   256.001 ± 0.001  B/op   ← exactly one extra 256B alloc
```

> **Key insight:** "The number looks right" is not verification. Disassemble the hot loop (Go `-gcflags=-S`, `cargo asm`) or run JMH `-prof perfasm` to confirm your work survived the optimizer and to see where cycles truly go. `gc.alloc.rate.norm` (bytes/op) is the most reproducible allocation signal there is — use it when timing is too noisy to trust.

---

## Coordinated Omission in Load Generators

Microbenchmarks measure a function in isolation. **Macro / load-generator benchmarks** measure a running system under request load — and they have a notorious, subtle bug, named and popularized by Gil Tene: **coordinated omission**. It systematically *erases the worst latencies you built the benchmark to find*, making p99 numbers off by orders of magnitude.

The mechanism: a naive load generator works in lockstep — send a request, *wait for the response*, record the latency, send the next. Now suppose the server stalls for 1 second (a GC pause, a lock convoy). During that second, a generator targeting 1000 req/s *should* have sent 1000 requests. Instead it sent **one** — and it patiently waited for it. So instead of recording 1000 samples of ~1 s latency, it records *one* sample of 1 s. The 999 requests that *would have* piled up during the stall — the ones a real user fleet would have experienced — are simply never sent. The generator "coordinates" with the server's stall and omits exactly the data that matters.

```
Intended schedule (1 req/ms):  t=0  t=1  t=2  ... t=999  t=1000 ...
Server stalls for 1000ms at t=0.

Naive (coordinated) generator:
  sends 1 request at t=0, gets reply at t=1000, records ONE 1000ms sample.
  → reports p99 ≈ a few ms. Looks great. Completely wrong.

Reality a user fleet sees:
  request at t=0  → 1000ms,  request at t=1 → 999ms,  ... t=999 → 1ms
  → ~half of all requests in that window exceeded 500ms. Catastrophic tail.
```

The result: a benchmark that reports a beautiful p99 while the system is actually unusable under load. The fix is to **decouple request scheduling from response timing**: send requests on a fixed schedule regardless of whether prior responses returned, and measure latency from when a request *should have been sent* (its intended time), not when the generator got around to it.

Tooling that gets this right:
- **wrk2** (Tene's fork of wrk) — drives a *constant throughput* and corrects for coordinated omission by back-filling the omitted samples.
- **HdrHistogram** — records latencies with constant precision across the whole range (microseconds to minutes) and exposes `recordValueWithExpectedInterval()`, which synthesizes the omitted samples a stalled generator missed.
- **Avoid** closed-loop tools (naive `ab`, naive `wrk`, hand-rolled "send-then-wait" loops) for *tail* measurement — they are structurally blind to it.

> **Key insight:** A load generator that waits for each response before sending the next will *under-report tail latency by orders of magnitude*, because it stops sending exactly when the system is slowest — the moment it most needs to sample. Measure latency against the *intended* send time on a *fixed* schedule (wrk2, HdrHistogram). If your p99 looks suspiciously good under load, suspect coordinated omission before you celebrate.

---

## Macro Benchmarks and Reproducible Environments

Microbenchmarks answer "is this function faster?"; they cannot answer "is the *system* faster?" because real workloads have cache effects, contention, GC interaction, and I/O that no isolated loop reproduces. A function 2x faster in a microbenchmark can be *invisible* end-to-end if it was 1% of total time — or can *regress* the system if its speedup came from caching that now thrashes a shared cache. The senior keeps both kinds and trusts the macro one for "should we ship this."

Designing a macro benchmark that means something:

- **Use representative input.** Synthetic uniform-random data has different cache, branch, and compression behavior than production traffic. Capture and replay a real request distribution (anonymized) — the shape of the input is often the dominant factor.
- **Measure the whole pipeline at realistic concurrency.** Tail latency only emerges under load; a single-threaded macro run hides contention and queueing entirely. Drive it at the concurrency level you actually run at, with an open-loop generator (see coordinated omission).
- **Separate warm-up from measurement** at the system level too — caches, connection pools, and JITs all need to reach steady state.

Whatever you measure, **capture the environment** or the number is unreproducible and therefore unfalsifiable. A benchmark result with no environment manifest is a rumor. Record, at minimum:

```bash
# Environment capture — commit this alongside the numbers
uname -a                                    # kernel, arch
cat /proc/cpuinfo | grep 'model name' | head -1
lscpu | grep -E 'MHz|NUMA|Thread'           # frequency, topology
cat /sys/devices/system/cpu/intel_pstate/no_turbo   # was turbo off?
cpupower frequency-info | grep 'governor'
free -h ; numactl --hardware                # memory, NUMA layout
go version    # or: java -version, rustc --version, the exact compiler + flags
git rev-parse HEAD                          # the exact code
```

This is where benchmarking meets [reproducible builds](../../build-systems/09-reproducible-builds/senior.md) and [regression testing](../07-performance-budgets-and-regression-testing/senior.md): a CI performance gate is only trustworthy if it runs on *pinned hardware* with *captured environment*, compares against a baseline using a *statistical test* (Mann-Whitney U), and stores enough metadata that a flagged regression can be reproduced months later. A regression dashboard built on means from noisy shared runners produces nothing but flapping false alarms — and teams that learn to ignore it.

> **Key insight:** Microbenchmarks find *where*; macro benchmarks decide *whether to ship*. A macro benchmark is only as good as its input realism and its concurrency, and *any* benchmark is only as good as its environment capture — an uncaptured environment makes the result unreproducible, which makes it unfalsifiable, which makes it worthless for a decision.

---

## Mental Models

- **The machine actively fights you.** A CPU changes its own frequency, parks idle cores, shares execution units across hyperthreads, and throttles when hot. Before any statistic, *control the machine* — pin frequency, isolate a core, disable ASLR, watch temperature — or you measure the environment, not the code.

- **A benchmark is a distribution, not a number.** The mean is the worst summary because the distribution is skewed and often multimodal. `min` is the noise-free capability, `median` is what's typical, high percentiles are the realistic worst case. Look at the histogram first.

- **Comparison requires a statistical test.** "Faster" is a claim about two distributions, settled by a non-parametric test (Mann-Whitney U), not by two medians. `p` says *real or noise*; `delta` says *big enough to matter*. Never one without the other; `~` is the tool being correct.

- **The optimizer will delete your benchmark if you let it.** An unobserved result is dead code. Sink/Blackhole/black_box/DoNotOptimize make work observable; disassembly and `perfasm` *prove* it survived. A suspiciously fast number is a deleted loop until shown otherwise.

- **The load generator can hide the very tail you're hunting.** A send-then-wait generator stops sampling exactly when the system stalls — coordinated omission. Schedule on intended time, open-loop, and your p99 stops lying.

---

## Common Mistakes

1. **Reporting the mean.** Benchmark distributions are skewed and multimodal; the mean describes a value that often never occurs. Report median, min, and percentiles, with a confidence interval — and look at the histogram.

2. **Calling a difference a regression by comparing two medians.** Without a statistical test you're filing noise. Run `count=15+` of each version and use `benchstat`; respect the `~`.

3. **Confusing significance with effect size.** A 0.3% change at `p=0.001` is real and irrelevant; a 15% change at `p=0.08` is relevant and under-sampled. Read both columns, always.

4. **Trusting a number without checking the assembly.** DCE or loop-invariant hoisting may have deleted the work. A 0.3 ns "result" is an empty loop. Disassemble (`-gcflags=-S`, `cargo asm`) or run `-prof perfasm`.

5. **Benchmarking a JIT before steady state.** You measure the interpreter and C1 warm-up, not C2. Use JMH-style warm-up + forks; treat a mid-run cliff as a possible deopt, not a code change.

6. **Leaving turbo, C-states, ASLR, and the scheduler uncontrolled.** Each moves results more than most real optimizations. Pin frequency, isolate and pin a core (offline its hyperthread sibling), `setarch -R`, watch temperature.

7. **Measuring tail latency with a closed-loop generator.** Send-then-wait suffers coordinated omission and under-reports p99 by orders of magnitude. Use wrk2 / HdrHistogram with intended-time scheduling.

8. **Shipping a number with no environment manifest.** Unreproducible means unfalsifiable. Capture kernel, CPU, frequency/governor, turbo state, NUMA, compiler version + flags, and the git SHA.

---

## Test Yourself

1. You report a 12% speedup from a microbenchmark. Name three machine-level noise sources that could *each* be larger than 12%, and how you'd neutralize each.
2. Why is the mean a poor summary of benchmark timings, and what three numbers would you report instead? What makes `min` special?
3. `benchstat` reports `delta = -1.2% (p = 0.21)`. Should you claim a speedup? What about `delta = -0.4% (p = 0.000)`?
4. Why does `benchstat` use the Mann-Whitney U test rather than a t-test for benchmark data?
5. Your `BenchmarkHash` reports 0.4 ns/op. What almost certainly happened, and how would you (a) prevent it and (b) prove whether it occurred?
6. Explain coordinated omission in one paragraph and give the fix.
7. A JMH benchmark gets 30% faster after the first ~5 seconds of every run. What's happening, and how should the harness handle it?

<details>
<summary>Answers</summary>

1. **Turbo/frequency scaling** (first iterations at 3.8 GHz, later at 2.4 GHz — ~40% drift): lock the governor to `performance` and pin min == max frequency, disable turbo (`no_turbo`). **ASLR layout effects** (bimodal results from cache-set/branch aliasing): `setarch -R` to disable ASLR, or repeat over many layouts and report the distribution. **Hyperthread/scheduler contention** (a sibling thread steals execution units, or the scheduler migrates you to a cold core): `taskset -c` to pin, `isolcpus` to dedicate the core, and offline the sibling hyperthread. (Also acceptable: C-states, thermal throttling, NUMA remote memory.)

2. The distribution is right-skewed with a hard floor and a long tail (any sample can be delayed by a context switch/GC/page fault), and is often *multimodal* — so the mean describes a value that may never occur and is dragged around by single outliers. Report **median** (typical), **min** (noise-free capability — noise can only slow things down, never speed them up, so min ≈ true cost and is the most reproducible), and **high percentiles** (realistic worst case), with a confidence interval.

3. `delta=-1.2% (p=0.21)`: **no** — `p > 0.05` means this difference is plausibly pure noise; you can't claim anything. `delta=-0.4% (p=0.000)`: the difference is *statistically real* but the *effect size* is negligible (0.4%) — real but not worth caring about. Significance and effect size are independent; you need both.

4. The t-test assumes the data is approximately Gaussian, but benchmark timings are skewed and multimodal, so that assumption is violated and the t-test can be fooled by fat tails. Mann-Whitney U is **non-parametric** — it only compares ranks ("do samples from one set tend to rank higher than the other?") and makes no distributional assumption, so it's robust to the exact shape benchmark data actually has.

5. The compiler eliminated the loop body via **dead-code elimination** (the hash result was unused) — 0.4 ns is the cost of an empty loop. (a) Make the result and inputs opaque: accumulate into a package-level `Sink` / use `Blackhole.consume` / `black_box` / `DoNotOptimize`, and `black_box` the input to prevent constant-folding/hoisting. (b) Prove it by disassembling the hot loop (`go test -gcflags=-S`, `cargo asm`, or JMH `-prof perfasm`) and confirming the hash instructions are actually present.

6. A closed-loop ("send a request, wait for the response, then send the next") generator stops sending while the server is stalled, so during a 1 s stall that should have produced ~1000 high-latency samples it records only *one* — it omits exactly the worst-case data it exists to capture, making p99 look great while the system is unusable. Fix: decouple scheduling from responses — send on a *fixed* schedule regardless of prior responses (open-loop), and measure latency from each request's *intended* send time (wrk2, HdrHistogram's expected-interval recording).

7. The JVM is climbing its **JIT compilation tiers** — interpreter → C1 → C2 (Tier 4) — and the 30% jump is the hot method reaching C2 with its aggressive inlining and speculation; the first ~5 s is warm-up, not the workload. The harness must run *discarded warm-up iterations* until steady state, then measure, and *fork fresh JVMs* per benchmark so profiles don't leak — exactly what JMH does. A sudden *slowdown* mid-run instead would suggest a **deoptimization**.

</details>

---

## Cheat Sheet

```
CONTROL THE MACHINE (before any statistics)
  no_turbo=1; cpupower frequency-set -g performance -d 2.4GHz -u 2.4GHz   lock freq
  cpupower idle-set -D 0                          disable deep C-states
  isolcpus=2,3 nohz_full=2,3 (kernel cmdline)     dedicate cores
  echo 0 > /sys/.../cpu3/online                   offline hyperthread sibling
  taskset -c 2  [chrt -f 99]                       pin (+ real-time priority)
  setarch -R ./bench                               disable ASLR (kill layout bimodality)
  numactl --cpunodebind=0 --membind=0              keep CPU+memory on one NUMA node
  turbostat --interval 1 -- ./bench                watch frequency AND temperature

SUMMARIZE A DISTRIBUTION (never the mean)
  min     noise-free capability (most reproducible)
  median  typical operation (robust to tail)
  p99     realistic worst case
  + 95% confidence interval, + LOOK AT THE HISTOGRAM (catch multimodality)

COMPARE TWO VERSIONS
  go test -bench=. -count=15 > old.txt ; ...new.txt ; benchstat old.txt new.txt
  p < 0.05  → real (Mann-Whitney U, non-parametric)     '~' → can't distinguish from noise
  read BOTH: p (significance) AND delta (effect size)

DEFEAT DEAD-CODE ELIMINATION
  Go:    var Sink T   (or b.Loop() in 1.24+)
  JMH:   return value, or Blackhole.consume(x)
  Rust:  criterion::black_box(x)   (inputs AND outputs)
  C++:   benchmark::DoNotOptimize(x); benchmark::ClobberMemory();

VERIFY / DIAGNOSE
  go test -gcflags=-S | grep -A30 Bench          confirm work survived (Go)
  cargo asm --bench b 'crate::fn'                 confirm work survived (Rust)
  java -jar b.jar -prof perfasm                   asm annotated with %cycles (JMH)
  java -jar b.jar -prof gc                        gc.alloc.rate.norm = bytes/op (deterministic)
  java -XX:+PrintCompilation                      watch JIT tiers / deopts

LOAD GENERATORS (tail latency)
  use wrk2 / HdrHistogram  → constant throughput, intended-time latency (no coordinated omission)
  avoid naive ab / wrk / send-then-wait loops for p99

ALWAYS CAPTURE: kernel, CPU model, freq+governor+turbo, NUMA, compiler+flags, git SHA
```

---

## Summary

- **Control the machine before you trust a number.** Turbo, C-states, hyperthread contention, ASLR layout, thermal throttling, and NUMA placement each move results by more than most real optimizations. Pin frequency, isolate and pin a core, disable ASLR, watch temperature.
- **A benchmark produces a distribution, not a number.** The mean lies because the distribution is skewed and often multimodal. Report **min** (noise-free capability), **median** (typical), and **high percentiles** (realistic worst case), with a confidence interval — and inspect the histogram.
- **Comparing versions is a statistical test.** Use `benchstat` with many runs; the **p-value** (Mann-Whitney U, non-parametric) says *real or noise*, the **delta** says *big enough to matter*. Need both; trust the `~`.
- **JIT runtimes change speed as they recompile.** Measure only after warm-up reaches steady state (C2/Tier 4), fork fresh JVMs, and treat a mid-run cliff as a possible deopt.
- **The optimizer deletes unobserved work.** Make results and inputs opaque (Sink/Blackhole/black_box/DoNotOptimize), and *prove* the body survived via disassembly or `-prof perfasm`. `gc.alloc.rate.norm` (bytes/op) is the most reproducible allocation signal.
- **Closed-loop load generators hide the tail** via coordinated omission. Schedule on intended time, open-loop (wrk2/HdrHistogram). And capture the full environment — an unreproducible benchmark is unfalsifiable.

You now treat every benchmark number as a claim to be defended — against the machine, the statistics, the compiler, and the harness — before it earns a place on a dashboard. The next layer — [professional.md](professional.md) — is about operating performance benchmarking as continuous, organization-wide infrastructure.

---

## Further Reading

- *Systems Performance* — Brendan Gregg. The USE method, and a rigorous treatment of what's actually happening on the machine you're measuring.
- Aleksey Shipilëv — *JMH talks and "Nanotrusting the Nanotime"* and the JMH samples. The definitive, hard-won catalog of microbenchmark traps (DCE, constant folding, false sharing, warm-up).
- Gil Tene — *"How NOT to Measure Latency"* (talk). The canonical explanation of coordinated omission, wrk2, and HdrHistogram.
- *Stabilizer* — Curtsinger & Berger (ASPLOS 2013). Why ASLR/layout effects can exceed the optimizations people publish, and statistically sound randomization.
- *The Art of Computer Systems Performance Analysis* — Raj Jain. The deep reference on benchmark statistics, confidence intervals, and experiment design.
- `criterion.rs` book, Google Benchmark user guide, and the Go `benchstat` README — each documents its statistics and DCE-defeating primitives.

---

## Related Topics

- [01 — Profiling and Flame Graphs](../01-profiling/01-cpu-profiling/senior.md) — a benchmark says *that* it changed; a profile says *where* the time went.
- [03 — Latency and Throughput](../03-latency-and-throughput/senior.md) — percentiles, the p99 trap, and Little's Law that macro benchmarks must respect.
- [07 — Performance Budgets and Regression Testing](../07-performance-budgets-and-regression-testing/senior.md) — turning trustworthy benchmarks into a CI gate that doesn't flap.
- [Build Systems › Reproducible Builds](../../build-systems/09-reproducible-builds/senior.md) — pinning toolchain and environment so a measured result can be reproduced later.
