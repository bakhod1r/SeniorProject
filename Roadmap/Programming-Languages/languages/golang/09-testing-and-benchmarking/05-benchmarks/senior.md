---
layout: default
title: Benchmarks — Senior
parent: Benchmarks (testing.B)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/senior/
---

# Benchmarks — Senior

[← Back](../)

> Focus: turning a number into a defensible claim. Statistical analysis with `benchstat`. Noise budgets. CPU governors and frequency scaling. Comparing alternative implementations rigorously. Recognising when your benchmark is wrong.

The junior page taught you to write a benchmark. The middle page taught you to structure a suite. This page is about the moment you stop being a person who *writes* benchmarks and become a person who *trusts* them. The vocabulary changes: mean, stddev, p-value, geomean, U-test. The tooling changes: `benchstat`, `cpupower`, `taskset`. The discipline changes: you stop quoting a single run; you start saying "p=0.003, n=10+10, delta -11.4 %".

## Table of Contents

1. [Why a single number is never enough](#why-a-single-number-is-never-enough)
2. [The shape of benchmark noise](#the-shape-of-benchmark-noise)
3. [Where noise comes from](#where-noise-comes-from)
4. [`-count` and what it actually buys](#-count-and-what-it-actually-buys)
5. [`benchstat` — the missing summary tool](#benchstat--the-missing-summary-tool)
6. [Installing and using `benchstat`](#installing-and-using-benchstat)
7. [Reading the `benchstat` table](#reading-the-benchstat-table)
8. [The Mann–Whitney U-test in 200 words](#the-mannwhitney-u-test-in-200-words)
9. [Geomean for multi-case suites](#geomean-for-multi-case-suites)
10. [The CPU frequency governor](#the-cpu-frequency-governor)
11. [Turbo, boost, and stochastic frequency](#turbo-boost-and-stochastic-frequency)
12. [Thermal throttling](#thermal-throttling)
13. [Background processes and co-tenants](#background-processes-and-co-tenants)
14. [CPU pinning with `taskset`](#cpu-pinning-with-taskset)
15. [SMT/hyper-threading and sibling cores](#smthyper-threading-and-sibling-cores)
16. [`GOMAXPROCS` for stable single-threaded measurement](#gomaxprocs-for-stable-single-threaded-measurement)
17. [GC interference](#gc-interference)
18. [Warm-up and cold caches](#warm-up-and-cold-caches)
19. [Defining a noise budget](#defining-a-noise-budget)
20. [The full benchmark-comparison workflow](#the-full-benchmark-comparison-workflow)
21. [Comparing algorithms — the right way](#comparing-algorithms--the-right-way)
22. [When alternatives have different complexity classes](#when-alternatives-have-different-complexity-classes)
23. [The "I optimised the benchmark, not the code" failure mode](#the-i-optimised-the-benchmark-not-the-code-failure-mode)
24. [Long-running benchmarks — what changes](#long-running-benchmarks--what-changes)
25. [Allocation-rate benchmarks vs latency benchmarks](#allocation-rate-benchmarks-vs-latency-benchmarks)
26. [Aliased benchmarks — false equivalence](#aliased-benchmarks--false-equivalence)
27. [Reproducing someone else's numbers](#reproducing-someone-elses-numbers)
28. [Senior-level mistakes](#senior-level-mistakes)
29. [Cheat sheet](#cheat-sheet)
30. [Self-assessment](#self-assessment)
31. [Summary](#summary)

---

## Why a single number is never enough

A benchmark produces a measurement. A measurement is a random variable — repeat it tomorrow, you get a different number. The variation is real; it comes from the CPU, the OS, the memory subsystem, the universe.

A single run gives you a point estimate with **no uncertainty**. You cannot say:

- "This change made the code faster" — maybe the new code is genuinely faster; maybe today the machine was 5 % cooler; you have one data point per side.
- "The numbers are statistically significant" — you have no statistics.
- "We have a 5 % improvement" — 5 % of what variance?

The senior-level practice replaces the point estimate with a **distribution**. Run the benchmark many times. Compute mean and stddev. Compare distributions with a statistical test. *Now* you can defend a claim.

## The shape of benchmark noise

Plot the `ns/op` from 30 runs of the same benchmark on the same machine, same code. You will see something like this:

```
ns/op   count
1018    *
1020    *
1022    ***
1024    ******
1026    ********    <-- mean
1028    *****
1030    ***
1032    **
1040    *           <-- outlier
```

It is approximately normal with a long right tail. The right-tail outliers are GC pauses, scheduler interventions, page faults. The bulk is your code's "real" performance.

For modern, careful Go benchmarks on a well-prepared machine:

- Stddev / mean is typically **1–3 %**.
- Right-tail outliers are typically **5–15 %** above the mean.
- Median is a slightly tighter summary than mean (resistant to outliers).

`benchstat` reports mean ± relative stddev. The number to focus on is the *relative* stddev (often called "RSD" or "noise"). When `benchstat` says `805ns ± 2%`, the `2%` is your noise budget — improvements smaller than that are undetectable.

## Where noise comes from

A non-exhaustive list, by typical magnitude:

| Source | Typical magnitude |
|---|---|
| CPU frequency scaling | 5–15 % |
| Thermal throttling | 5–30 % (sustained) |
| Background processes | 1–10 % |
| Hyper-threading interference | 5–20 % |
| OS scheduler migration | 1–5 % |
| GC pauses | 1–5 % (allocation-heavy benchmarks) |
| Memory bus contention | 1–5 % |
| Branch predictor warm-up | < 1 % (per benchmark) |
| Clock measurement granularity | < 1 ns absolute |
| Page faults | rare but large when they happen |

Each can be controlled or removed. The remaining sections explain how.

## `-count` and what it actually buys

`-count=N` runs each benchmark `N` times in the same `go test` invocation. Output:

```
BenchmarkX-8   1000000   810 ns/op
BenchmarkX-8   1000000   805 ns/op
BenchmarkX-8   1000000   812 ns/op
... (N total)
```

What you can do with N samples:

- Compute mean: `Σ x_i / N`.
- Compute stddev: `sqrt(Σ (x_i - mean)² / (N-1))`.
- Compute confidence intervals.
- Run a statistical test against a baseline of the same N.

What you *cannot* do with N=1:

- Estimate stddev.
- Reason about significance.
- Distinguish a 3 % improvement from noise.

The community default is **N=10**. It is the smallest N at which the Mann–Whitney U-test (used by `benchstat`) has reasonable power for detecting 5 % effects against typical Go benchmark noise. Below 10, the test rejects most claims as "not significant". Above 30, returns diminish.

The cost: linear. `-count=10` makes a 30-second suite take 5 minutes. Live with it.

## `benchstat` — the missing summary tool

`go test` outputs raw lines. Eyeballing 10 lines per benchmark is unreasonable. `benchstat` is the official tool for summarising and comparing.

It ships separately, in `golang.org/x/perf`. The package layout has changed over the years; the current canonical path is `golang.org/x/perf/cmd/benchstat`.

It does three things:

1. **Summarises** — computes mean, stddev, and confidence intervals from multiple samples of the same benchmark.
2. **Compares** — given two files (baseline and candidate), reports per-benchmark deltas and p-values.
3. **Geomean** — when there are multiple benchmarks, reports a single geomean delta as the "average improvement across the suite".

## Installing and using `benchstat`

```
go install golang.org/x/perf/cmd/benchstat@latest
```

Basic usage — summarise one file:

```
go test -bench=. -count=10 -benchmem > result.txt
benchstat result.txt
```

You will see:

```
                │   result.txt    │
                │     sec/op      │
ParseURL-8          805.0n ± 2%
HashSHA256-8         2.40m ± 1%
```

Compare two files:

```
benchstat old.txt new.txt
```

```
                │     old.txt     │             new.txt              │
                │     sec/op      │   sec/op     vs base             │
ParseURL-8          805.0n ± 2%    612.0n ± 1%   -23.97% (p=0.000 n=10)
HashSHA256-8         2.40m ± 1%     2.42m ± 1%        ~ (p=0.342 n=10)
```

Read the columns left to right: name, old mean ± rsd, new mean ± rsd, delta, p-value, sample count.

## Reading the `benchstat` table

Each cell tells you something:

- **`805.0n ± 2%`** — mean is 805 nanoseconds; relative stddev is 2 %. (`n` is nano, `µ` is micro, `m` is milli.)
- **`-23.97%`** — the new version is 24 % faster. A negative delta on a `sec/op` column means improvement.
- **`(p=0.000 n=10)`** — p-value from the U-test; sample count.
- **`~`** — no statistically significant change. The change exists numerically but the test cannot distinguish it from noise. `benchstat` refuses to put a number on it.

You also get rows for `B/op` and `allocs/op` if those were collected, and `MB/s` if `SetBytes` was called.

Beware: a small `delta` with a tiny `p` can still be meaningful (real but small). A large `delta` with a large `p` is not meaningful (probably noise). Always read both.

## The Mann–Whitney U-test in 200 words

The U-test is a non-parametric test for the question: "are these two samples drawn from the same distribution?"

Why non-parametric? Because Go benchmark noise is *not* perfectly normal — it has fat right tails. A t-test (which assumes normality) over-trusts large outliers. The U-test ranks the combined samples and asks whether one side's ranks are systematically higher than the other.

Mechanics, briefly:

1. Combine the two samples (say 10 baseline + 10 candidate).
2. Sort and assign ranks 1–20.
3. Sum ranks for the baseline side; call this `R1`. Sum for candidate is `R2`.
4. Compute U = R1 − N1(N1+1)/2 (where N1 is the baseline sample size).
5. Compare U against a tabled critical value (or compute a p-value).

The output is a probability under the null hypothesis "the distributions are the same". `p < 0.05` is convention for "reject the null"; the change is real.

`benchstat` does all this for you. You just read the column.

## Geomean for multi-case suites

When you have many benchmarks, deltas vary. Some are −5 %, some +3 %, some unchanged. What is the "average" change?

Arithmetic mean of percentages is misleading: −50 % and +50 % do not cancel. Geometric mean is correct for ratios:

```
geomean(r_1, r_2, ..., r_n) = (r_1 * r_2 * ... * r_n)^(1/n)
```

where `r_i = new_i / old_i`.

`benchstat` prints this as `[Geo mean]` in the last row:

```
                │   old.txt    │            new.txt
                │   sec/op     │   sec/op     vs base
ParseURL-8       805.0n ± 2%    612.0n ± 1%   -23.97%
ParseHTML-8        1.20µ ± 1%    1.05µ ± 2%   -12.50%
ParseXML-8         3.40µ ± 1%    3.35µ ± 1%       ~
[Geo mean]      1.483µ          1.250µ         -15.71%
```

Geomean is the headline number for "how much did the suite improve". Quote it in PR descriptions.

## The CPU frequency governor

A modern x86 CPU does not run at one frequency. It picks a frequency dynamically based on load, temperature, and power policy. The mechanism is called the **CPU frequency governor**.

Linux exposes the current governor:

```bash
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
```

Common values:

- `performance` — always at max frequency. Best for benchmarks.
- `powersave` — always at min frequency. Worst for benchmarks (slow but stable).
- `ondemand`, `conservative`, `schedutil` — dynamic. Default. **Unsuitable** for benchmarks because the same code at 800 MHz vs 4.5 GHz looks dramatically different.

Set to performance:

```bash
sudo cpupower frequency-set -g performance
```

Or directly:

```bash
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
```

Verify:

```bash
watch -n1 'grep MHz /proc/cpuinfo'
```

The MHz should stay near max during benchmarks. If it drops, the governor is still ondemand.

## Turbo, boost, and stochastic frequency

Even with `performance` governor, modern CPUs add another layer: **Intel Turbo Boost** / **AMD Core Performance Boost**. The CPU runs *above* its rated base frequency when thermal and power budgets allow.

The interaction:

- A cold benchmark hits 5.2 GHz (turbo). Reported `ns/op` is fast.
- Five minutes in, the CPU thermals climb. Turbo throttles to 4.5 GHz. Same code, `ns/op` is now 15 % slower.

For *reproducible* numbers, disable turbo:

```bash
# Intel
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo

# AMD
echo 0 | sudo tee /sys/devices/system/cpu/cpufreq/boost
```

The CPU is now stuck at its rated base frequency. Slower in absolute terms; stable across runs.

This is the single biggest factor for laptop benchmarking. With turbo on, benchmarks "improve" or "regress" based on temperature. With turbo off, they reflect code changes.

## Thermal throttling

Even with turbo off, sustained load on a small chassis (laptop) eventually causes thermal throttling — the CPU drops *below* base frequency to avoid melting.

Symptoms:

- First few seconds of a long benchmark are fast.
- After 30–60 seconds, throughput drops.
- `cat /proc/cpuinfo | grep MHz` shows declining frequency.

Mitigation:

- Use a desktop or server, not a laptop.
- Reduce ambient temperature.
- Run benchmarks in shorter bursts (`-benchtime=1s`, not `-benchtime=30s`).
- Insert cooldown between benchmark runs.

The Linux kernel exposes per-core thermal state:

```bash
cat /sys/class/thermal/thermal_zone*/temp
```

## Background processes and co-tenants

Anything else using the CPU competes with your benchmark. Common offenders:

- Web browsers running JavaScript timers in background tabs.
- IDE language servers indexing.
- System updaters (`apt`, `dnf`, `softwareupdate`).
- Antivirus.
- Spotlight indexing (macOS), Tracker (GNOME), Recoll (any).
- Container runtimes with auto-scaling.

Mitigation:

- Close everything except a terminal.
- Disable auto-updates during benchmarks.
- On servers: `systemctl stop` cron, monitoring agents (briefly!).
- Check: `top -bn1 -o %CPU | head -20`.

A single Chrome tab can cost 5 % per benchmark. Multiple tabs, more.

## CPU pinning with `taskset`

The OS scheduler is free to migrate processes between cores. Migration is expensive — the new core has cold caches, the old core still has the dirty cache lines that need invalidation. Mid-benchmark migration manifests as a sudden 5–15 % slow stretch.

Pin the benchmark to a specific core:

```bash
taskset -c 3 go test -bench=. -count=10
```

The `-c 3` means CPU index 3. Pick a core that is:

- Not the boot CPU (avoid 0 on most distros).
- Not the same physical core as a sibling SMT thread you have something else running on.

Verify the pinning worked:

```bash
ps -o pid,psr,comm -p $(pgrep -f 'go test')
```

The `PSR` column shows the current CPU. It should match what you asked for.

For ultimate isolation, boot with `isolcpus=3`:

```
GRUB_CMDLINE_LINUX="isolcpus=3"
```

The kernel scheduler will not place any other workload on core 3. Your `taskset -c 3` benchmark has it alone.

## SMT/hyper-threading and sibling cores

Intel Hyper-Threading and AMD SMT present each physical core as two logical CPUs (CPUn and CPUm). The two share execution units, caches, and bandwidth. A workload on CPUn affects a workload on CPUm.

For benchmarks:

- Pin to one logical core in each physical pair.
- Make sure nothing else is pinned to its sibling.

Find sibling pairs:

```bash
for cpu in /sys/devices/system/cpu/cpu[0-9]*; do
  echo "$cpu: $(cat $cpu/topology/thread_siblings_list)"
done
```

Output (8-core Intel with HT):

```
cpu0: 0,8
cpu1: 1,9
...
cpu8: 0,8
```

CPU 0's sibling is CPU 8. Pin to CPU 0, ensure CPU 8 is idle. Or, on more aggressive setups, disable HT entirely in BIOS for pristine benchmarks.

For *contention* benchmarks (`b.RunParallel`), keep SMT on — it reflects production.

## `GOMAXPROCS` for stable single-threaded measurement

For microbenchmarks of pure computation, `GOMAXPROCS=1` removes scheduler-induced noise:

```bash
GOMAXPROCS=1 taskset -c 3 go test -bench=. -count=10
```

With one P, the scheduler does no work-stealing, no spinning, no probing. The reported `ns/op` is the cleanest single-thread number you can get.

This is **not** appropriate for:

- `b.RunParallel` benchmarks.
- Benchmarks of channels, sync primitives, anything that exercises parallelism.
- End-to-end service benchmarks.

For those, keep `GOMAXPROCS` at a stable nonzero value (e.g. `4`) and pin to that many cores.

## GC interference

The Go GC runs concurrently. During a benchmark, especially an allocation-heavy one, it will pause for short periods. Each pause shows up as an outlier in `ns/op`.

For stable numbers, you have two options:

1. **Run long enough** that GC pauses amortise. `-benchtime=10s` is usually sufficient.
2. **Disable GC** during the measurement: `GOGC=off`. The benchmark may OOM if it allocates a lot, but the per-op number is stable.

`GOGC=off` is a measurement tool, not a production setting. Use it to *diagnose* GC noise: if `GOGC=off` and default GC give very different numbers, GC is your variance source.

For latency-critical benchmarks of GC-sensitive code, the right number is *with* the default GC, run for long enough that the distribution is meaningful. Quoting `GOGC=off` numbers would be misleading.

## Warm-up and cold caches

The first few iterations of a benchmark are cold:

- CPU branch predictor has no history.
- L1/L2 caches do not contain the working set.
- TLB has not seen the relevant pages.

`go test`'s calibration provides implicit warm-up: small `b.N` runs trigger the framework to scale up. By the time `b.N` is large, the caches are warm.

If you want explicit warm-up (e.g. JIT-like effects, sync.Pool population):

```go
for i := 0; i < 100; i++ {
    _ = work(input)
}
b.ResetTimer()
for i := 0; i < b.N; i++ {
    _ = work(input)
}
```

Conversely, for *cold-cache* numbers (rare but interesting), flush caches between iterations. This is hard in Go from userspace; usually it requires writing to a "cold-flusher" buffer of a few MiB that evicts everything.

```go
var cacheFlusher = make([]byte, 64<<20) // 64 MiB
for i := 0; i < b.N; i++ {
    for j := range cacheFlusher {
        cacheFlusher[j] = byte(i + j)
    }
    _ = work(input)
}
```

Now you measure cache-cold latency. Useful for "what if my data is not hot?" questions.

## Defining a noise budget

Before claiming a perf improvement, you must know your noise floor. The recipe:

1. Pick a baseline benchmark on your benchmarking machine.
2. Run it 30 times: `go test -bench=BenchmarkX -count=30 > noise.txt`.
3. `benchstat noise.txt`. Note the relative stddev.

That number — say `1.8 %` — is your noise floor. Improvements smaller than that are statistically invisible.

The noise budget depends on:

- Hardware (laptop vs server vs cloud VM).
- Quietness (closing background processes helps).
- Frequency policy (performance governor, turbo off).
- Length of run (`-benchtime`).
- `-count` (higher `n` tightens the confidence interval).

Track your noise budget. Re-measure quarterly. When it drifts, investigate.

## The full benchmark-comparison workflow

Putting it all together:

```bash
# 1. Quiet the machine
# (close apps, disable background work)

# 2. Configure CPU
sudo cpupower frequency-set -g performance
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo

# 3. Baseline
git checkout main
taskset -c 3 go test -bench=. -count=10 -benchmem > old.txt

# 4. Candidate
git checkout feature/optimisation
taskset -c 3 go test -bench=. -count=10 -benchmem > new.txt

# 5. Compare
benchstat old.txt new.txt

# 6. Restore
echo 0 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo
sudo cpupower frequency-set -g schedutil
```

The output line you can quote in a PR description:

```
Result: BenchmarkParse improved 23.97 % (p=0.000, n=10+10) on the parse-heavy hot path; geomean across the suite -15.7 %.
```

That sentence — with `p`, `n`, and geomean — is the senior-level statement. Anything less should be challenged.

## Comparing algorithms — the right way

When you have two candidate implementations, evaluate them across:

- **Multiple input sizes.** Algorithms with different complexity classes will cross over. Cover small, medium, large.
- **Multiple input shapes.** Sorted vs unsorted, all-zeros vs random, ascii vs unicode.
- **Multiple parallelism levels.** Some algorithms scale better than others.
- **Both `ns/op` and `allocs/op`.** A 10 % faster algorithm with 5× allocations is rarely a win in production.

Structure the benchmark as a nested table:

```go
for _, size := range []int{10, 100, 1000, 10000, 100000} {
    for _, shape := range []string{"sorted", "reversed", "random"} {
        for _, algo := range []namedFn{{"std", sort.Ints}, {"insertion", insertionSort}} {
            b.Run(fmt.Sprintf("size=%d/shape=%s/algo=%s", size, shape, algo.name),
                func(b *testing.B) { ... })
        }
    }
}
```

5 sizes × 3 shapes × 2 algos = 30 benchmarks. Each runs 10 times = 300 measurements. `benchstat` reduces this to a comparison table you can read.

## When alternatives have different complexity classes

If algorithm A is `O(n)` and algorithm B is `O(n log n)`, no single benchmark answers "which is better". The answer is "B is better above n=X". Find X by sweeping size and looking for the crossover.

`benchstat` does not do this directly. You read the table:

```
size=10        std-8 (n log n): 80 ns    insertion-8 (n): 30 ns    insertion wins
size=100       std-8:           420 ns   insertion-8:     800 ns   std wins
size=1000      std-8:          4500 ns   insertion-8:   80000 ns   std wins by 18x
```

Crossover is around `n=50`. The standard library actually does this kind of analysis when implementing sort — for small sub-arrays the implementation switches to insertion sort.

## The "I optimised the benchmark, not the code" failure mode

Worst case in benchmarking: you change the *benchmark* to produce a better number, without improving the actual code. Examples:

- Pre-warmed cache that production never sees.
- Smaller working set that fits in L1.
- Removed assertion that was catching a real bug.
- Different input distribution that favours your new code.

Symptoms:

- Benchmark improves by 30 %; production telemetry shows no change.
- Reviewer asks "what changed in the test?" and the answer is "I tuned the input".

Mitigation:

- Review benchmark diffs as carefully as code diffs.
- Pair benchmark numbers with production telemetry post-deploy.
- Lock benchmark inputs (golden corpora, version-controlled).

## Long-running benchmarks — what changes

Default `-benchtime=1s` works for most microbenchmarks. Long-running benchmarks (`-benchtime=60s` or more) change the picture:

- **GC behaviour stabilises.** Short benchmarks may run before the first GC; longer runs experience the full GC cycle.
- **Thermal effects appear.** A laptop will throttle. Plan for it.
- **Working sets churn.** Caches turn over; allocation rate stabilises.
- **Noise averages out.** Stddev drops because more samples are integrated.
- **You catch slow-path bugs.** A worker that leaks resources every 10⁶ ops only shows up with a long run.

Use long-running benchmarks for:

- Production-realistic measurements.
- Memory leak detection (run for 5 min, check RSS).
- Tail-latency analysis (collect histogram via `b.ReportMetric`).

## Allocation-rate benchmarks vs latency benchmarks

Two different questions a benchmark can answer:

**Latency.** "How long does *one* operation take?" Measured by `ns/op`. Optimised for low per-op cost.

**Allocation rate.** "How fast does this code create heap pressure?" Measured by `B/op × b.N / wall_time`. Optimised for low MB/s of allocation.

A function can have great latency but terrible allocation rate (allocates a lot but does it fast). In production, the allocation rate matters because it drives GC pauses for the *rest* of the service.

`benchstat` shows `B/op` and `allocs/op` as separate columns. Read them as carefully as `ns/op`. A 5 % faster benchmark with 2× `B/op` is *not* a win — it pushes GC pressure onto other code.

## Aliased benchmarks — false equivalence

A subtle trap: two benchmarks with the same name in different packages will collide in `benchstat`. The tool sees them as the same row.

If you rename a benchmark mid-experiment ("BenchmarkParseJSON" → "BenchmarkParseJSON_v2"), `benchstat` will not know they are related. The new one looks new; the old one looks deleted.

Discipline: keep benchmark names stable. Use sub-benchmarks to add variants, not new top-level names.

## Reproducing someone else's numbers

When a blog post or PR claims "X is 30 % faster", do not believe it until you reproduce. Steps:

1. Clone the code at the relevant commit.
2. Run on *your* machine, *your* `-count`, *your* `benchstat`.
3. Compare to *your* baseline.

Reasons the original numbers might not reproduce:

- Different CPU / memory configuration.
- Different Go version (escape analysis, inlining, GC tuning all change).
- Different system load.
- Different `GOMAXPROCS`.
- They cherry-picked a favourable run.

The Go project's perf builders publish their hardware and methodology. Most blog posts do not. Reproducibility is the senior-level standard.

## Senior-level mistakes

1. **Quoting `ns/op` without `±` or `p`.** Single-run statements.
2. **Comparing across different machines.** Even "same model laptop" is not the same machine.
3. **Ignoring `B/op` regressions.** A 5 % faster benchmark with +50 % allocations is a bad trade.
4. **Optimising the benchmark to win.** Different input, different setup. Production sees nothing.
5. **Turbo on, performance governor off.** Numbers swing 15 %.
6. **Cherry-picking the best of 10 runs.** Quote the mean, not the min.
7. **Not pinning cores on a contention benchmark.** Migration noise.
8. **Trusting CI runners for sub-10 % comparisons.** Shared cloud is too noisy.
9. **No noise-budget measurement.** Cannot reason about whether a delta is real.
10. **Forgetting `-benchmem`.** Half the picture missing.

## Cheat sheet

```bash
# Setup (Linux)
sudo cpupower frequency-set -g performance
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo

# Baseline + candidate
taskset -c 3 go test -bench=. -count=10 -benchmem > old.txt
taskset -c 3 go test -bench=. -count=10 -benchmem > new.txt

# Statistical comparison
benchstat old.txt new.txt
```

| Concept | Tool |
|---|---|
| Single-run uncertainty | `-count=10` |
| Statistical comparison | `benchstat old new` |
| Summary across suite | geomean (in `benchstat` output) |
| Frequency stability | `cpupower frequency-set -g performance` + turbo off |
| Migration avoidance | `taskset -c N` |
| SMT isolation | `taskset` to non-sibling cores |
| Microbenchmark stability | `GOMAXPROCS=1` |
| GC noise | `GOGC=off` (diagnostic only) |
| Long-run stability | `-benchtime=10s` or more |

## Self-assessment

- [ ] I always run with `-count=10` before quoting any number.
- [ ] I never quote a delta without `p` and `n`.
- [ ] I know what my benchmarking machine's noise floor is.
- [ ] I run `benchstat` instead of eyeballing.
- [ ] I read `B/op` and `allocs/op` columns as carefully as `ns/op`.
- [ ] I set the CPU governor to performance and disable turbo before benchmarking.
- [ ] I pin to a specific core with `taskset`.
- [ ] I use `GOMAXPROCS=1` for microbenchmarks of pure computation.
- [ ] I report geomean for multi-case suites.
- [ ] I review benchmark diffs as carefully as code diffs.

## Summary

Senior-level benchmarking is statistics + system hygiene. The statistics: many runs, `benchstat`, U-test, geomean. The hygiene: governor=performance, turbo off, pinned core, quiet machine, defined noise budget. Together they turn a number into a defensible claim with a p-value. That claim is what survives code review.

The next page (`professional.md`) is about taking these techniques to CI: making them automatic, repeatable, gating PRs on regressions. The principles are the same; the deliverable is a pipeline.

---

## Appendix A — `benchstat` output format in deep detail

The shape of `benchstat` output has shifted over the years. The current canonical layout (2023 onwards) prints a separate table for each metric, with one column per input file.

A two-file comparison with two benchmarks:

```
goos: linux
goarch: amd64
pkg: example.com/foo
cpu: AMD Ryzen 9 5950X 16-Core Processor

                │     old.txt      │              new.txt
                │     sec/op       │    sec/op     vs base
ParseURL-32         805.0n ±  2%    612.0n ±  1%   -23.97% (p=0.000 n=10)
HashSHA256-32        2.40m ±  1%     2.42m ±  1%        ~ (p=0.342 n=10)
geomean             1.398µ          1.218µ         -12.86%

                │     old.txt      │              new.txt
                │      B/op        │     B/op      vs base
ParseURL-32          320.0 ±  0%    160.0 ±  0%    -50.00% (p=0.000 n=10)
HashSHA256-32        0.000          0.000               ~ (p=1.000 n=10) ¹
geomean             ²              ²                ?
¹ all samples are equal
² summaries must be >0 to compute geomean

                │     old.txt      │              new.txt
                │   allocs/op      │  allocs/op    vs base
ParseURL-32          3.000 ±  0%    1.000 ±  0%    -66.67% (p=0.000 n=10)
HashSHA256-32        0.000          0.000               ~ (p=1.000 n=10) ¹
```

Three blocks: one for `sec/op`, one for `B/op`, one for `allocs/op`. Each block has the same row structure (benchmark names) and column structure (one column per input file).

Footnotes (1–9 etc.) explain edge cases: zero values, identical samples, missing data. Read them; they are diagnostic.

### Modifying the output with flags

| Flag | Effect |
|---|---|
| `-row .label` | Group rows by a label parsed from benchmark names. Useful for pivot tables. |
| `-col .label` | Group columns by a label. The default is to use the file names. |
| `-filter .unit:sec/op` | Show only the `sec/op` metric (suppress others). |
| `-delta-test u|t|none` | Choose the statistical test. U-test (Mann–Whitney) is default. |
| `-confidence 0.95` | Confidence level for the test (default 0.95, i.e. p<0.05 threshold). |
| `-format text|csv|html` | Output format. `csv` is useful for piping into spreadsheets. |
| `-ignore .label` | Ignore certain labels when grouping. |

Worth knowing: with thoughtful naming, you can pivot the output in interesting ways. Example: if your benchmarks are named `BenchmarkParse/codec=json/size=1k`, `benchstat -col .codec -row .size` produces a 2D table with size as rows and codec as columns. Visual inspection is much faster than reading a long flat list.

## Appendix B — Sources of non-stationary noise

Some noise is constant across runs (the universe is noisy). Other noise is *non-stationary* — its magnitude changes over time. Non-stationary noise breaks the statistical assumptions of the U-test and makes comparisons unreliable.

Common sources:

### Thermal drift

A laptop starts cold, heats up over minutes, eventually throttles. A 30-second benchmark suite measures different thermal regimes in its first and last runs.

**Mitigation:** Pre-heat the machine with a warm-up run. Or use a desktop. Or take many short bursts with cooldown between.

### Aging CPU caches

`sync.Pool`, the GC, and runtime caches all accumulate state over the lifetime of a `go test` process. The 1st of 10 `-count` runs sees an empty pool; the 10th sees a full one.

**Mitigation:** Insert a no-op `go test` invocation between baseline and candidate, to reset the runtime state. Or run baseline and candidate in interleaved order (`-shuffle=on`).

### File-system cache effects

A benchmark that reads files from disk benefits from page cache hits after the first run. Later runs are faster because the files are in memory.

**Mitigation:** Drop caches between runs (`echo 3 | sudo tee /proc/sys/vm/drop_caches`). Or hoist `os.ReadFile` outside the benchmark entirely.

### Cron jobs

System cron jobs (mlocate, anacron, package-manager updates) run on schedules. If your benchmark coincides with one, that run is slow. Subsequent runs are fast again.

**Mitigation:** Disable cron during benchmarking. Or run on a dedicated bare-metal box with no scheduled jobs.

### NUMA effects

On multi-socket machines, memory allocated on one socket and accessed from a CPU on the other socket is slower. The allocation pattern of your benchmark may distribute memory across sockets non-deterministically.

**Mitigation:** Use `numactl --membind=0 --cpunodebind=0` to pin both CPUs and memory to one socket.

## Appendix C — A worked statistical comparison

Walking through a real comparison end to end. We have a parser that we believe is faster after a refactor.

**Step 1.** Verify the machine is configured:

```bash
$ cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
performance
$ cat /sys/devices/system/cpu/intel_pstate/no_turbo
1
$ uptime
 13:24:01 up 7 days, load average: 0.02, 0.04, 0.05
```

Quiet machine, performance governor, turbo off. Good.

**Step 2.** Establish noise floor:

```bash
$ taskset -c 3 go test -bench=BenchmarkParse -count=30 -benchmem > noise.txt
$ benchstat noise.txt
                  │    noise.txt
                  │     sec/op
Parse-32             802.0n ± 1%
```

Noise is `± 1%`. Good. Anything smaller than ~2 % delta will not be detectable; we should expect to detect 3 % or more.

**Step 3.** Run baseline and candidate:

```bash
$ git checkout main
$ taskset -c 3 go test -bench=BenchmarkParse -count=15 -benchmem > old.txt
$ git checkout pr/parser-refactor
$ taskset -c 3 go test -bench=BenchmarkParse -count=15 -benchmem > new.txt
```

15 samples per side is enough for the U-test to detect 3 % effects.

**Step 4.** Compare:

```bash
$ benchstat old.txt new.txt
                  │     old.txt      │              new.txt
                  │     sec/op       │    sec/op     vs base
Parse-32             802.0n ±  1%    640.0n ±  1%   -20.20% (p=0.000 n=15)
```

A 20.2 % improvement at `p=0`. With `± 1 %` noise on both sides, this is a clean signal. The fingerprint of a real change.

**Step 5.** Check allocations:

```
                  │     old.txt      │              new.txt
                  │      B/op        │     B/op      vs base
Parse-32             192.0 ±  0%    128.0 ±  0%    -33.33% (p=0.000 n=15)

                  │     old.txt      │              new.txt
                  │   allocs/op      │  allocs/op    vs base
Parse-32             3.000 ±  0%    2.000 ±  0%    -33.33% (p=0.000 n=15)
```

Allocations also reduced. Consistent with the speed improvement (less heap pressure).

**Step 6.** Sanity-check with a *parallel* benchmark:

```bash
$ git checkout main
$ taskset -c 0-7 go test -bench=BenchmarkParseParallel -count=15 -benchmem > old-par.txt
$ git checkout pr/parser-refactor
$ taskset -c 0-7 go test -bench=BenchmarkParseParallel -count=15 -benchmem > new-par.txt
$ benchstat old-par.txt new-par.txt
                  │  old-par.txt     │           new-par.txt
                  │     sec/op       │    sec/op    vs base
ParseParallel-32     180.0n ±  2%    105.0n ±  1%   -41.67% (p=0.000 n=15)
```

Under contention, the improvement is even larger (42 %). Consistent with the allocation reduction story: less heap pressure means less GC contention.

**Step 7.** Quote the result in the PR:

> Benchmark results (median of n=15 each, AMD Ryzen 9 5950X, performance governor, turbo off, pinned to core 3, GOMAXPROCS=1):
>
> - `BenchmarkParse`: -20.2 % (p=0.000)
> - `BenchmarkParseParallel`: -41.7 % (p=0.000)
> - `B/op`: -33.3 %, `allocs/op`: -33.3 %
>
> Both improvements are statistically significant. Production traffic should see a corresponding latency reduction proportional to time-in-parser as a fraction of total request time.

That is a *defensible* perf claim. The reviewer can challenge the methodology but cannot dispute the numbers.

## Appendix D — When `benchstat` says `~`

The `~` means "no statistically significant change". This is not "no change" — it means *the test cannot tell*. Two possibilities:

1. There genuinely is no change. The code is doing the same work in the same time.
2. There is a change, but it is smaller than your noise floor. The test cannot distinguish it.

You cannot distinguish (1) from (2) without reducing noise. If a `~` result matters, lower the noise floor (more `-count`, better hardware isolation, longer `-benchtime`) and re-run.

Conversely, when `benchstat` reports a significant change at large p-values (say p=0.01), be cautious. p=0.01 means "in 1 % of universes where the null hypothesis is true, we would see a difference this large by chance". With 100 benchmarks, you would expect *one* false positive. Multiple-comparison correction (Bonferroni, FDR) is rarely applied in casual benchmark workflows but worth knowing about for large suites.

## Appendix E — The `-benchtime` choice for senior work

Default `-benchtime=1s` is good enough for laptop iteration. For senior-grade work, calibrate based on what you are measuring.

| Operation cost | Recommended `-benchtime` |
|---|---|
| < 10 ns/op | 1s (timer resolution dominates with longer; not helpful) |
| 10-1000 ns/op | 3-5s (averages out short noise events) |
| 1 µs - 1 ms/op | 5-10s |
| > 1 ms/op | 30s+ (catch GC, ensure stable thermal state) |
| > 100 ms/op (e.g. I/O) | use `-benchtime=Nx` with a low N |

`-benchtime=Nx` is useful when you do not want calibration and you want exact iteration counts (e.g. when reproducing someone else's setup).

## Appendix F — `benchstat` versus the world

A few tools that overlap with `benchstat`:

- **`perflock`** (`golang.org/x/perf/cmd/perflock`) — coordinates multiple benchmark runs on the same machine, serialising them so they do not interfere. Useful in a CI pool of one machine running multiple PRs.
- **`benchstat -filter`** — narrows analysis to a metric subset.
- **`benchcmp`** (legacy) — predecessor to `benchstat`. Do not use.
- **Custom scripts** — Many teams write small Python or Go scripts that parse benchstat output and emit Markdown for PR comments. These are easy; do not over-engineer.

Use `benchstat` for human-facing comparison. Use scripts for CI gating. They both consume the same `go test -bench` output format.

## Appendix G — Reading `benchstat -delta-test t` output

If you pass `-delta-test t`, you get a Welch's t-test instead of the U-test. Generally:

- U-test: non-parametric, robust to outliers, no normality assumption.
- t-test: assumes approximately normal distribution, more powerful when that assumption holds.

For Go benchmarks, the U-test is almost always the better choice. The t-test is included for legacy and special-case use. If you find yourself reaching for it, ask why.

## Appendix H — Disagreeing benchmark and telemetry

A scenario you will face: the benchmark says "X is 20 % faster", production telemetry after deploy says "no change". What happened?

Possibilities, roughly ordered by likelihood:

1. **Benchmark input is unrealistic.** Production inputs are larger / smaller / shaped differently than the benchmark's corpus.
2. **The function is no longer the bottleneck.** A 20 % improvement on something that takes 5 % of request time is a 1 % improvement to the request. Lost in noise.
3. **Allocation was the bottleneck, GC was not the bottleneck.** You reduced heap pressure but GC was already comfortable.
4. **The new code is colder.** In production, the function is called less often, falls out of the I-cache. The benchmark's hot loop kept it warm.
5. **Different workloads stress different paths.** The benchmark exercised path A; production exercises path B which is unchanged.

The cure is to verify *which* of these is true. Profile a production binary; compare the function's `pprof` weight before and after. If the function is 5 % of total CPU and you sped it up 20 %, you should see ~1 % CPU drop.

## Appendix I — Profiling beyond `-cpuprofile`

`-cpuprofile` is the workhorse but not the only profiler. Each gives a different view:

| Flag | What it captures | When to use |
|---|---|---|
| `-cpuprofile` | Sampled CPU time | Where is CPU spent? |
| `-memprofile` | Sampled allocations | Where do allocations come from? |
| `-blockprofile` | Goroutine block durations | Where are goroutines waiting? |
| `-mutexprofile` | Mutex contention | Which mutexes are hot? |
| `-trace` | Full execution trace | Scheduling, GC, syscall detail |

For a contended benchmark, run mutex+block profiles. For an allocation-heavy benchmark, run memprofile. For "why is this slow on parallel" benchmarks, run a trace.

Example workflow for diagnosing why a `b.RunParallel` benchmark scales negatively:

```bash
go test -bench=BenchmarkX -mutexprofile=mu.out -blockprofile=bl.out -cpuprofile=cpu.out
go tool pprof -top mu.out
go tool pprof -top bl.out
```

The top of `mu.out` shows mutex contention sources. The top of `bl.out` shows where goroutines wait. Both diagnose contention; together they narrow the cause.

## Appendix J — Statistical-thinking checklist for performance reviews

When reviewing someone else's perf claim, run through this list:

- [ ] Was it run more than once? `-count >= 10`?
- [ ] Was the same machine used for baseline and candidate?
- [ ] Was the machine quiet (no other heavy workload)?
- [ ] Was the CPU governor set to performance?
- [ ] Was turbo / boost disabled?
- [ ] Was the benchmark pinned to a stable core?
- [ ] Were `B/op` and `allocs/op` reported?
- [ ] Is the delta larger than the noise floor?
- [ ] Is the p-value below 0.05?
- [ ] If multiple benchmarks, is the geomean reported?
- [ ] Was the change isolated (only one variable changed)?
- [ ] Does production telemetry confirm the change?

A "yes" to all twelve is the gold standard. Most teams hit eight or nine; that is good enough for most decisions.

## Appendix K — A note on Go version sensitivity

Performance numbers depend on the Go compiler version. Major changes that have affected benchmark numbers in recent history:

- **Go 1.17** — register-based calling convention. Many functions got 5–10 % faster.
- **Go 1.18** — generics; some hot paths got slightly slower due to monomorphisation choices.
- **Go 1.19** — soft memory limit (`GOMEMLIMIT`); GC behaviour shifted.
- **Go 1.20** — improved escape analysis; some hot paths shed allocations.
- **Go 1.21** — `loop` semantics changes; benchmark dead-code elimination differs slightly.
- **Go 1.24** — `b.Loop` added; new compiler hints for benchmark loops.

Always include the Go version in benchmark output (the header line says `goos`, `goarch`, `cpu` but not the Go version explicitly — it is in the file header you should include). Comparisons across Go versions are *inherently noisy* because the compiler changed.

## Appendix L — Sanity-check questions to ask before publishing numbers

A senior engineer asks themselves these before sending a PR:

1. **Can I re-run this and get the same number?** If not, it is not a benchmark.
2. **Does it measure what I claim?** A `BenchmarkParse` that secretly does I/O is mismeasured.
3. **Did I include `allocs/op`?** A speed improvement at the cost of GC pressure is rarely net-positive.
4. **Did I exclude my own setup?** `b.ResetTimer` after setup.
5. **Did I run on a stable machine?** If on a laptop, what is your noise floor?
6. **Did I use `benchstat`?** Not eyeballing.
7. **Did I assert correctness?** A benchmark that "succeeds" because it returns early on an error is broken.
8. **Is this the right input?** Realistic, representative, not adversarial unless intentional.
9. **Did I commit the methodology, not just the numbers?** The PR description should let someone reproduce.
10. **Have I checked production?** If the change is deployed, do telemetry numbers agree?

This is the senior checklist. Internalising it is what separates "writes benchmarks" from "uses benchmarks to make decisions".

## Appendix M — Closing thought (extended)

Microbenchmarks are a microscope. They let you see a single function's performance in artificially isolated conditions. That isolation is both their strength and their weakness:

- **Strength:** small, reproducible, focused. They tell you what the *function* costs, not what some confounding factor costs.
- **Weakness:** the function does not run alone in production. Inlining, cache state, GC, scheduler quirks — all conspire to make production behaviour differ.

The senior-level discipline is to remember both at once. Use microbenchmarks to *measure*. Use telemetry to *validate*. Trust neither alone; trust them together.

When you write `BenchmarkParse improved 23.97% (p=0.000, n=10+10)`, that is one ingredient of a decision. The other ingredients — what fraction of request time is `Parse`, does production traffic look like the benchmark corpus, will the change break anything — are arguments you make in the PR description. The benchmark is evidence, not proof.

A few final aphorisms:

- "Trust the geomean, doubt the outliers."
- "Always read the `allocs/op` column."
- "If `~`, you do not know."
- "Reproduce or do not believe."
- "The cleanest benchmark is the one with one variable changed."

Carry these into your perf work. They are what makes the difference between a confident performance engineer and a person who quotes numbers without knowing what they mean.

## Appendix N — Suggested reading

- The `testing` package documentation: <https://pkg.go.dev/testing>
- `benchstat` documentation: <https://pkg.go.dev/golang.org/x/perf/cmd/benchstat>
- Russ Cox, "How to Read a benchstat Comparison": Go blog, 2020.
- Daniel Lemire, "Reading and Understanding Microbenchmarks" — discussions of benchmark methodology generally, not Go-specific but applicable.
- The Go project's perf dashboard at <https://perf.golang.org> — a reference for how the Go team itself runs and reports benchmarks.

## Appendix O — Detecting compiler-eliminated benchmarks systematically

A senior-level concern: how do you *systematically* detect that the compiler is eliminating your benchmark's work? Eyeballing for "implausibly fast" numbers works but is unreliable. Three more rigorous techniques:

### Technique 1 — Disassembly check

```bash
go test -bench=BenchmarkX -c -gcflags="-S" 2>&1 | grep -A 50 BenchmarkX
```

Look at the assembly for the benchmark loop. If the function under test is *not* called (no `CALL` instruction with its name), or the function call site shows no register usage corresponding to its arguments, the compiler eliminated it.

This is verbose but unambiguous.

### Technique 2 — Inflate body, observe linearity

If the benchmark body genuinely runs, doubling its work should roughly double `ns/op`. If `ns/op` is unchanged when you call the function *twice* per iteration, the optimiser is eliminating both calls.

```go
// Original
for i := 0; i < b.N; i++ {
    sink = work(input)
}
// Doubled
for i := 0; i < b.N; i++ {
    sink = work(input)
    sink = work(input)
}
```

If the second version reports the same `ns/op` as the first, the compiler is eliminating work in at least one of them. Time to investigate.

### Technique 3 — Inspect with `-gcflags="-m=2"`

```bash
go test -gcflags="-m=2" -bench=BenchmarkX 2>&1 | grep -i 'dead\|elim'
```

The compiler emits diagnostics about elimination decisions. Reading them tells you what was inlined, what escaped, what was dropped.

For paranoid benchmark engineering, all three together. Most benchmarks pass with the sink-variable trick; if you suspect a problem, escalate to disassembly.

## Appendix P — The "warm CPU" question

A subtle issue when interleaving baseline and candidate runs. The CPU's various adaptive features (branch predictor, prefetcher, cache lines) get tuned to the code that ran recently. If you alternate:

```
run baseline; run candidate; run baseline; run candidate; ...
```

each run "warms up" the CPU's adaptive state to *its* code, then the other code starts from cold. Result: spurious differences.

The cleaner pattern is grouped:

```
run baseline 10 times; run candidate 10 times
```

Each group keeps the CPU's adaptive state coherent.

The trade-off: grouped runs are vulnerable to *temporal drift* (CPU temperature, system load) — if conditions change between the two groups, the comparison is invalid. Interleaved runs are robust to temporal drift but vulnerable to CPU adaptive state mixing.

In practice, grouped + short total runtime + stable machine = the right balance. Run 10 of A in ~10 seconds; run 10 of B immediately after in ~10 seconds; the machine state has not drifted.

If you need both robustness *and* lots of samples, do multiple grouped passes:

```
run baseline 10; run candidate 10; run baseline 10; run candidate 10; ...
```

`benchstat` averages within file. Concatenate the two `baseline` outputs into one file before comparing.

## Appendix Q — Detecting machine drift over time

Track the absolute number on a canary benchmark over weeks. If the canary's `ns/op` drifts, your benchmark machine is changing — firmware update, hardware degradation, accumulated cruft. Re-establish your noise floor.

A simple cron:

```bash
0 3 * * * /path/to/canary-bench.sh >> /var/log/canary-bench.log
```

where `canary-bench.sh` runs a stable benchmark and appends to a log. Once a week, plot the values. A trend (especially a regression) means something has changed on the machine, not in your code.

## Appendix R — Comparing across machines (when you cannot avoid it)

Sometimes you only have access to a different machine for one of the runs. Comparisons across machines are *unreliable*, but you can do them carefully:

1. **Run identical benchmarks on both** (using `-count=20` for tighter intervals).
2. **Compute a "calibration ratio"** from a stable benchmark you trust on both machines.
3. **Apply the ratio** to your candidate's results.

This is the same idea as the Go project's perf normalization. It is hand-wavy and noisy compared to single-machine, but if it is your only option, document the methodology clearly.

A safer alternative: *do not* compare. State "ran on machine X; old commit also ran on machine X" and "ran on machine Y; new commit also ran on machine Y". Two independent statements.

## Appendix S — `b.ReportMetric` for tail-latency tracking

A senior trick: in addition to `ns/op` (which is a mean), report tail latencies as separate metrics.

```go
func BenchmarkServiceLatency(b *testing.B) {
    durations := make([]time.Duration, 0, b.N)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        start := time.Now()
        _ = serve(req)
        durations = append(durations, time.Since(start))
    }
    b.StopTimer()
    sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
    p50 := durations[len(durations)*50/100]
    p99 := durations[len(durations)*99/100]
    p999 := durations[len(durations)*999/1000]
    b.ReportMetric(float64(p50.Nanoseconds()), "p50-ns")
    b.ReportMetric(float64(p99.Nanoseconds()), "p99-ns")
    b.ReportMetric(float64(p999.Nanoseconds()), "p99.9-ns")
}
```

Output (illustrative):

```
BenchmarkServiceLatency-8   100000   1200 ns/op   1100 p50-ns   1800 p99-ns   3500 p99.9-ns
```

Now you can compare p99/p99.9 between baseline and candidate. For latency-sensitive services, p99 matters far more than mean. A change that improves mean by 5 % but worsens p99 by 50 % is a regression no matter what the headline number says.

This pattern requires per-iteration timing — overhead that may not be negligible for fast operations. Use it for slow-ish operations (microseconds and up) where measurement overhead is small relative to operation cost.

## Appendix T — Custom benchmark frameworks (and when not to)

For most cases, `testing.B` is sufficient. For some, custom frameworks make sense:

- **JMH-style** (Java) — explicit warm-up, fork-isolation, multiple measurement modes. Useful when you cannot trust the JIT (not applicable to Go, but instructive).
- **`hyperfine`** — command-line benchmark of *whole programs*. Useful for end-to-end CLI tools.
- **In-house frameworks** — some teams write thin wrappers over `testing.B` for their specific service.

The temptation to write a custom framework usually comes from:

1. Wanting a different output format. (Often solved by post-processing.)
2. Wanting more isolation. (Often solved by `taskset` and process-level controls.)
3. Wanting macro-benchmark capability. (Use a load generator, not `testing.B`.)

Resist the temptation unless you have a strong reason. `testing.B` is well-understood, well-tooled, and integrated with the toolchain. Stay within it where possible.

## Appendix U — Glossary of senior-level perf terms

| Term | Meaning |
|---|---|
| **noise floor** | Smallest delta detectable above measurement variance. |
| **relative stddev (RSD)** | stddev / mean, expressed as percent. |
| **U-test** | Mann–Whitney U-test; non-parametric significance test. |
| **p-value** | Probability of observing the data under the null hypothesis. |
| **geomean** | Geometric mean; correct average for ratios. |
| **performance governor** | OS subsystem managing CPU frequency. |
| **turbo / boost** | CPU feature that runs above base frequency. |
| **SMT / Hyper-Threading** | Sharing a physical core between two logical threads. |
| **NUMA** | Non-Uniform Memory Access; multi-socket memory locality. |
| **taskset / pinning** | Binding a process to specific CPUs. |
| **isolcpus** | Kernel parameter excluding CPUs from scheduler. |
| **microbenchmark** | A `testing.B` benchmark of a single function. |
| **macrobenchmark** | An end-to-end benchmark of a service or pipeline. |
| **regression** | Code change that worsens performance. |
| **canary** | A stable benchmark used to monitor machine drift. |

## Appendix V — A long-form case study

A senior-level case study: a real-looking debugging trail that combines all the techniques on this page.

### The setup

You maintain a Go service. A PR claims to speed up `BenchmarkProcessRequest` by 30 %. Before merging, you want to verify the claim and understand whether the speedup is real, robust, and applicable to production.

### Step 1 — Reproduce locally

You pull both branches and run on your laptop:

```bash
git checkout main
go test -bench=BenchmarkProcessRequest -count=10 -benchmem > old.txt

git checkout pr/optimisation
go test -bench=BenchmarkProcessRequest -count=10 -benchmem > new.txt

benchstat old.txt new.txt
```

You see:

```
ProcessRequest-8   3.2µs ± 8%   2.5µs ± 6%   -21.88% (p=0.001 n=10)
```

A 22 % improvement, statistically significant. But variance is `± 6-8 %` — your laptop is noisy. The point estimate is plausible but you want more confidence.

### Step 2 — Reproduce on the perf box

Your team has a dedicated bare-metal benchmark box. You SSH in:

```bash
# Verify
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor   # performance
cat /sys/devices/system/cpu/intel_pstate/no_turbo           # 1
uptime                                                       # load 0.01

# Run
taskset -c 4 go test -bench=BenchmarkProcessRequest -count=20 -benchmem > old.txt
git checkout pr/optimisation
taskset -c 4 go test -bench=BenchmarkProcessRequest -count=20 -benchmem > new.txt
benchstat old.txt new.txt
```

Cleaner output:

```
ProcessRequest-8   3.1µs ± 1%   2.4µs ± 1%   -22.58% (p=0.000 n=20)
```

22.6 %, p=0.000, ± 1 %. This is a real, robust improvement.

### Step 3 — Allocations

```
ProcessRequest-8   2048 B/op ± 0%   1024 B/op ± 0%   -50.00% (p=0.000)
ProcessRequest-8     12 allocs/op    6 allocs/op     -50.00% (p=0.000)
```

Allocations halved. This explains the speedup: less heap pressure, less GC overhead per request.

### Step 4 — Parallel behaviour

```bash
taskset -c 4-7 go test -bench=BenchmarkProcessRequestParallel -count=20 -benchmem
```

Under contention, the candidate improves by 35 % — more than the serial improvement. Consistent: when GC is a contention source, reducing allocations helps more under load.

### Step 5 — Cross-input check

The benchmark uses one canonical input. You add sub-benchmarks for short, medium, long, and pathological inputs. Re-run.

Result: improvement is largest for medium inputs (the common case in production) and smaller for very short or very long ones. This is informative — you should not expect the win to be uniform across all production traffic.

### Step 6 — Profile

You collect CPU and memory profiles from the candidate:

```bash
go test -bench=BenchmarkProcessRequest -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -top cpu.out
go tool pprof -top mem.out
```

Top of CPU now shows the inner work; previously it was dominated by `runtime.mallocgc`. Top of memory shows the remaining allocations come from logging — a target for future optimisation.

### Step 7 — Read the diff

You read the PR. The change introduces a `sync.Pool` for the request struct and switches some `[]byte` returns to `*[]byte` to avoid escape. Both make sense.

You ask the author to add a comment explaining the `sync.Pool` lifecycle and reference the benchmark in the commit message.

### Step 8 — Approve and merge

Comment on the PR:

> Reproduced the improvement on the perf box: -22.6 % (p=0.000, n=20). Allocations -50 %. Improvement is even larger under parallel contention (-35 %). Profile confirms the runtime.mallocgc time was the bottleneck. Approved.

This is what senior-level perf review looks like. It is not "the number changed; merge". It is a complete chain of reproducibility, attribution, and contextualisation. The number is a starting point; the rest is the engineering.

### Lessons from this case

- Laptop confirmation is *suggestive*, not conclusive. Use the perf box.
- Always check allocations alongside `ns/op`.
- Always check parallel behaviour for code that runs concurrently.
- Always profile to confirm *why* the number changed.
- Always include the methodology in the PR comment.

That is the workflow. Internalise it; apply it to every non-trivial perf claim.

## Appendix W — Mistakes I have personally made

A list of mistakes that are easy to make and embarrassing to admit. Recognise them in yourself before someone else points them out.

### Mistake 1 — Quoting a single best run

"On my best run, the new code did 950 ns/op vs 1200 ns/op." Cherry-picking the minimum is cheating. The right number is the median or mean across `-count=10`, with stddev.

### Mistake 2 — Forgetting to rebuild

After `git checkout`, you must `go test -c` (or just `go test -bench`) again. Running an old binary against a checked-out tree is comparing two copies of the same version. The build cache *usually* prevents this, but not always.

### Mistake 3 — Running with a different `GOMAXPROCS`

You set `GOMAXPROCS=1` for baseline. Forgot for candidate. The candidate's `RunParallel` ran with 8 cores; baseline with 1. Apples to coconuts.

### Mistake 4 — Different `go` versions

`brew upgrade` between baseline and candidate runs. The Go compiler changed. Numbers shifted. Not the code.

### Mistake 5 — Different input data

You re-ran `makeRandomInput` for candidate; the random seed differed. The two are not benchmarking the same input.

### Mistake 6 — Different machine load

Baseline ran while you were on a call. Candidate ran in deep work mode. The 5 % "improvement" was 5 % more CPU available.

### Mistake 7 — Forgetting `-benchmem`

You optimised for `ns/op`, missed a 50 % increase in `B/op`. Production GC pressure jumped.

### Mistake 8 — Trusting `~`

`~` from benchstat means "not statistically significant", not "no change". You concluded "no change" and merged; later production showed a 4 % regression that was real but below your detection threshold.

### Mistake 9 — Not pinning a core

The OS migrated your benchmark mid-run. The "regression" was a cache-cold migration, not the code.

### Mistake 10 — Mocking the wrong thing

You benchmarked with a mock that returns a constant. The real implementation's variance is hidden. The numbers are not predictive of production.

Forewarned is forearmed. Most senior engineers have made several of these. The discipline is to slow down and check before quoting.

## Appendix X — The shape of a perf review meeting

When a team has a regular perf review, the agenda usually looks like:

1. **Recent regressions** — what failed CI in the last week, root causes, fixes.
2. **Trends** — multi-week graphs from canary benchmarks; any drift?
3. **Pending optimisations** — PRs claiming improvements; status of validation.
4. **Production telemetry** — did recent perf changes manifest in the expected metrics?
5. **Infrastructure** — is the perf box healthy? Any hardware concerns?
6. **Open questions** — benchmarks that are flaky, gating policies that need tuning.

This meeting is most useful with a clear chair and concrete data on screen. It is least useful when it becomes a forum for hand-wavy "I think X is fast/slow" claims. Discipline: every claim should come with numbers.

## Appendix Y — Final senior-level summary

You have read a long page. The key ideas to take away:

1. **A single number is not data.** You need multiple samples and a statistical test.
2. **`benchstat` is the tool.** Learn its output format.
3. **System hygiene matters more than you think.** Governor, turbo, pinning, quiet machine.
4. **Allocations are usually the real story.** `B/op` and `allocs/op` change more deterministically than `ns/op`.
5. **Parallel scaling reveals contention.** `b.RunParallel` + `-cpu=...` tells you what serial benchmarks cannot.
6. **Microbenchmarks are not production.** Always validate with telemetry post-deploy.
7. **Reproducibility is the gold standard.** Document your methodology; let others recreate.
8. **Noise floor defines what you can detect.** Measure it; do not exceed it in your claims.
9. **Statistical significance is necessary but not sufficient.** A 1 % significant improvement on a cold path is not worth pursuing.
10. **Performance is a property tested by CI.** Same as correctness.

Carry these forward. They are what separates "writes benchmarks" from "uses benchmarks to make engineering decisions". The professional page is about institutionalising this discipline into your team's workflow.

## Appendix Z — Comparison with other ecosystems

For perspective, a glance at how other ecosystems handle benchmarking:

### Java — JMH

The Java Microbenchmark Harness (JMH) is much more elaborate than `testing.B`. Features:

- Multiple measurement modes (throughput, average time, sample time, single-shot).
- Forking — runs each benchmark in a fresh JVM to avoid JIT cross-contamination.
- Warm-up iterations as a first-class concept.
- Dead-code elimination defeat via `Blackhole.consume(...)`.

Go's approach is simpler: a single `*testing.B` loop, the framework's calibration, and sink variables. The result is fewer features but a lower learning curve. Most production Go benchmarking does not need JMH's complexity.

### Rust — Criterion

Criterion is Rust's de facto benchmarking library. Features:

- Statistical analysis built into the harness (no separate `benchstat`).
- Automatic graphs and HTML reports.
- Black-box helpers to defeat DCE.
- Threshold-based regression detection.

Go's ecosystem has these features distributed across `testing.B` + `benchstat` + custom tooling, not bundled. The trade-off: less out-of-the-box, more composability.

### C++ — Google Benchmark

Similar in spirit to JMH but for C++. Provides `benchmark::DoNotOptimize` (analogous to a sink) and `benchmark::ClobberMemory` (memory barrier). Templated for various measurement modes.

### What Go's approach optimises for

Go's `testing.B` chose simplicity:

- One way to write a benchmark.
- Output is line-oriented text, machine-parseable.
- Statistical analysis is a separate concern (`benchstat`).
- No fancy DCE-defeat helpers (you use a sink or `b.Loop`).

The cost: a few gotchas the framework does not protect you from. The benefit: low conceptual overhead, easy to remember, integrated with the toolchain.

For most projects, Go's approach is sufficient. If you find yourself wishing for JMH-level features, ask whether you actually need them or whether a small wrapper would suffice.

## Appendix AA — Suggested practice exercises

Before considering yourself senior-level on this topic:

1. **Establish a noise floor.** Run a canary benchmark 30 times on your machine. Compute the relative stddev. Aim for < 3 % with reasonable hygiene (governor=performance, quiet machine).

2. **Write a parallel benchmark.** Compare a mutex-protected counter vs an atomic counter. Run with `-cpu=1,2,4,8`. Observe scaling differences.

3. **Compare two implementations with `benchstat`.** Pick a function with a known optimisation; implement both versions; benchmark; compare with `benchstat`; quote the result with p-value and `n`.

4. **Set up CI gating.** On a personal project, add a GitHub Action that runs benchmarks and posts a `benchstat` comparison on PRs. Live with it for a month.

5. **Validate a benchmark against telemetry.** Deploy a perf change to a real service; record the predicted improvement; compare against production p99 latency one week later. Investigate any disagreement.

These exercises put the concepts into muscle memory. Without them, the page is a list of abstract rules. With them, you have the experience to apply the rules in unfamiliar situations.

## Appendix BB — Where to go from here

You have completed the senior-level material on Go benchmarks. The next steps:

- **Professional page** (this section) — institutionalise the discipline as CI infrastructure.
- **Profiling deep dive** (separate sections) — `pprof`, flame graphs, mutex/block profiles.
- **Runtime internals** — GC tuning, scheduler behaviour, allocator details.
- **Macro-benchmarking** — load testing tools (`wrk`, `hey`, `k6`), service-level latency.
- **Performance debugging** — applying microbenchmarks to diagnose specific production issues.

Each is a substantial topic. The benchmarking page you just read is the *measurement* foundation under all of them. Without trustworthy measurements, no other performance work makes sense.

The discipline is contagious. Once one engineer on a team starts insisting on `benchstat` output for perf claims, the team's perf rigour rises. Once a CI gate is in place, regressions become rare. Once production telemetry is paired with benchmark predictions, the team learns *which benchmarks predict reality* and which do not. The result is a team that can be trusted on performance questions — and that is what senior-level work, on this topic, ultimately produces.
