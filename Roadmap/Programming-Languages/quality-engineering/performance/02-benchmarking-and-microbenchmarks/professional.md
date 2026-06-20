# Benchmarking and Microbenchmarks — Professional Level

> **Roadmap:** [Performance](../README.md) → Benchmarking and Microbenchmarks
> *The senior page taught you to write a microbenchmark that doesn't lie to itself — defeating dead-code elimination, warming the JIT, reporting a distribution instead of a mean. This page is about benchmarking as infrastructure: a stable harness other people trust, a dedicated runner that isn't a noisy cloud VM, a pipeline that catches a 3% regression before it ships, and the judgment to know when a green microbenchmark is still lying about production.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [A Benchmark Harness Is Infrastructure, Not a Script](#a-benchmark-harness-is-infrastructure-not-a-script)
4. [The Runner Problem — Why Cloud CI Makes Microbenchmarks Worthless](#the-runner-problem--why-cloud-ci-makes-microbenchmarks-worthless)
5. [Continuous Benchmarking Pipelines and Dashboards](#continuous-benchmarking-pipelines-and-dashboards)
6. [Result Storage, Baselines, and Trend Tracking](#result-storage-baselines-and-trend-tracking)
7. [When a Microbenchmark Is a Lie About Production](#when-a-microbenchmark-is-a-lie-about-production)
8. [Flame-Graph-Guided Benchmark Targeting](#flame-graph-guided-benchmark-targeting)
9. [The Cost and ROI of Benchmarking](#the-cost-and-roi-of-benchmarking)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Running benchmarking as an organizational practice — a trusted harness, stable runners, a continuous pipeline, and the judgment to know when the number is real.**

A single engineer can write an honest microbenchmark on their laptop. An organization needs something harder: a *system* that produces benchmark numbers everyone trusts, runs on every pull request, stores results so trends are visible, and flags regressions before a customer notices p99 climbing. That is a different discipline from "write a good `Benchmark` function."

The professional-level failures are not "I forgot to warm up the JIT." They are: *we ran benchmarks on shared cloud CI and the variance was 40%, so everyone learned to ignore them*; *a microbenchmark said the new serializer was 12% faster and it was 8% slower in production*; *we benchmarked everything, the suite took 40 minutes, and people stopped running it*; *the benchmark measured the framework's reflection overhead, not the code we changed*. Each of these is a judgment failure, not a syntax failure. This page is about that judgment: building the harness as infra, choosing the runner, wiring the pipeline into [regression detection](../07-performance-budgets-and-regression-testing/professional.md), and staying honest about when a green microbenchmark still tells you nothing about production.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — DCE defeat, JIT warm-up, measuring a distribution, `benchstat`/JMH/Criterion mechanics, the difference between micro and macro benchmarks.
- **Required:** [01 — Profiling](../01-profiling/) — you can read a flame graph and find the hot path a benchmark should target.
- **Helpful:** You've owned a CI pipeline and felt the pain of a flaky check people learned to ignore.
- **Helpful:** You've shipped something that was "faster in the benchmark" and watched production disagree.

---

## A Benchmark Harness Is Infrastructure, Not a Script

The moment more than one person relies on a benchmark number, the benchmark stops being a script and becomes infrastructure — with the same obligations as any shared system: stable inputs, versioned configuration, reproducible output, and a contract about what the number means.

A harness that people trust has these properties:

- **Pinned environment.** Same compiler/JIT, same CPU governor, same allocator, same dependency versions. A benchmark whose result depends on whoever's laptop ran it is worse than no benchmark — it manufactures false signal. Pin the toolchain the same way you pin a [build toolchain](../../build-systems/01-build-fundamentals/professional.md).
- **Fixed, versioned workload.** The input data is part of the benchmark. If the corpus changes, the number changes, and a "regression" is really a workload change. Store the corpus with a hash; record the hash in the result.
- **Self-describing output.** Every result carries the commit SHA, host ID, toolchain version, workload hash, and the raw sample distribution — not just a mean. A number without provenance can't be compared across time.
- **Deterministic invocation.** One command, no manual steps. `make bench` or `cargo bench` or a single CI job. If running the suite requires a wiki page of steps, it will be run wrong.

A minimal harness contract, encoded as the shape of every result record:

```json
{
  "benchmark": "json/encode/large-struct",
  "commit": "a1b2c3d",
  "host_id": "bench-runner-01",
  "toolchain": "go1.22.3",
  "workload_hash": "sha256:9f2a…",
  "samples_ns": [1182, 1175, 1190, 1183, 1179, 1201, 1176],
  "iterations": 50000,
  "allocs_per_op": 3,
  "bytes_per_op": 256,
  "started_at": "2026-06-19T14:02:11Z"
}
```

Notice what is *not* here: a single "result" field. The harness emits the raw distribution and lets the comparison layer ([regression detection](../07-performance-budgets-and-regression-testing/professional.md)) decide whether two distributions differ. The harness measures; it does not judge. Keeping those concerns separate is what lets you change the statistical test later without re-running history.

> **The professional reality:** the hardest part of a benchmark harness is not the measurement loop — `testing.B`, JMH, and Criterion already solve that. It's making the result *comparable across machines and across months*. That means provenance on every sample and a workload that is versioned, not ambient. Treat the harness like a measurement instrument: it needs calibration, a serial number, and a logbook.

---

## The Runner Problem — Why Cloud CI Makes Microbenchmarks Worthless

This is the single most important professional insight on this page: **a shared cloud CI runner cannot produce a trustworthy absolute microbenchmark number, and most teams don't realize it until they've shipped a regression a noisy benchmark failed to catch.**

A microbenchmark measures nanoseconds-to-microseconds per operation. To resolve a 3% change, your measurement noise must be well under 3%. A standard GitHub Actions / GitLab SaaS / generic cloud CI runner gives you noise far larger than that, because:

- **Noisy neighbors.** You're on a shared hypervisor. Another tenant's workload steals CPU, thrashes the shared L3 cache, and saturates memory bandwidth — invisibly. The same code can run 30%+ slower depending on who else landed on the box.
- **CPU frequency is not yours to control.** Turbo boost, thermal throttling, and cloud-vendor frequency scaling move the clock under you. You can't pin the governor to `performance` on a runner you don't own.
- **vCPUs are shared cores.** Hyperthread siblings and burstable instance credits (AWS `t3`, etc.) mean your "CPU" is a time-slice, not a core. Burstable instances literally throttle after you exhaust credits — mid-suite.
- **Ephemeral, heterogeneous hardware.** Today's runner is a Skylake, tomorrow's is an Ice Lake or Graviton. Absolute numbers across runs compare different silicon.

The result: variance of 20–50% run-to-run, which drowns every real regression smaller than "we accidentally added an N² loop." Teams that benchmark on cloud CI get a check that is *red for noise and green for noise*, learn it's untrustworthy, and route around it. A benchmark people ignore is negative value — it cost CI minutes and trained the team to dismiss perf signal.

**What to do instead — in priority order:**

1. **Relative comparison on the same host, same run (A/B in one job).** The highest-leverage technique. Don't compare today's runner to last week's runner. In a *single* CI job on *one* machine, check out `main`, build and benchmark it; check out the PR, build and benchmark it; compare the two distributions *to each other*. The noisy neighbor and the frequency drift affect both arms roughly equally and cancel out. This works even on a cloud VM, because you've turned an absolute measurement into a relative one. This is the technique that makes cloud benchmarking salvageable.

   ```bash
   # A/B in one job: both arms on the same host, interleaved
   git checkout main      && go test -bench=. -count=10 ./... > base.txt
   git checkout $PR_SHA   && go test -bench=. -count=10 ./... > new.txt
   benchstat base.txt new.txt        # reports delta + p-value, not absolutes
   # Interleaving (alternating base/new runs) further cancels slow drift.
   ```

2. **A dedicated bare-metal benchmark runner.** For absolute numbers and the smallest detectable regression, you need a machine you control: bare metal (not a VM), CPU governor pinned to `performance`, turbo/boost disabled, hyperthreading off, the process pinned to an isolated core (`isolcpus` + `taskset`/`cset`), ASLR and address-space randomization understood, swap off, and nothing else scheduled. Such a box drives run-to-run noise under 1–2%, enough to resolve a 3% regression reliably. One dedicated machine (even a refurbished workstation) serving the whole org is cheap relative to the value of a trustworthy perf gate.

   ```bash
   # Bare-metal runner setup (Linux), per boot / per run
   sudo cpupower frequency-set -g performance        # no frequency scaling
   echo 0 | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/boost   # no turbo jitter
   echo off | sudo tee /sys/devices/system/cpu/smt/control        # no hyperthreading
   # kernel cmdline: isolcpus=2,3 nohz_full=2,3 rcu_nocbs=2,3
   taskset -c 2 ./bench_runner                         # pin to the isolated core
   ```

3. **Accept that cloud absolute numbers are directional only.** If you can't get bare metal and can't do A/B-in-one-run, treat cloud microbenchmark absolutes as a smoke test for catastrophic regressions (2x+) only, and do real perf validation on a controlled host before release. Don't pretend a 5% cloud delta is signal.

> **The hard rule:** *never gate on absolute microbenchmark numbers measured on shared cloud CI.* Either compare two builds on the same host in the same run (relative, drift cancels), or measure on a dedicated bare-metal runner (absolute, noise controlled). A benchmark whose variance exceeds the regression you care about is not a weak signal — it's an anti-signal that trains people to ignore performance.

---

## Continuous Benchmarking Pipelines and Dashboards

Once you have a trustworthy harness and a runner, the goal is to make performance a *continuous, visible* property — like test coverage or build status — rather than something measured in a panic after an incident.

The pipeline shape:

```
PR opened ──► CI: A/B benchmark on same host (fast, relative gate)
                   │
                   ├─ regression > threshold? ─► block + comment with benchstat table
                   └─ ok ─► merge

merge to main ──► dedicated bare-metal runner (nightly or per-merge)
                   │   absolute numbers, full suite
                   ├─ store result (commit, host, distribution)
                   ├─ compare to rolling baseline ─► alert on regression
                   └─ push to dashboard (trend over time)
```

Two distinct stages, because they answer different questions:

- **The PR gate (relative, fast).** Runs the *affected* benchmarks A/B on one host, in minutes, and posts a comment. Its job is to stop an obvious regression from merging. It tolerates cloud noise because it's relative. Keep it fast or people will route around it.
- **The trend pipeline (absolute, thorough).** Runs the full suite on the dedicated runner per-merge or nightly, stores every result, and feeds a dashboard. Its job is to catch slow drift — the 0.5%-per-week creep that no single PR trips but that adds up to 30% over two quarters.

A practical PR-gate job that comments on regressions:

```yaml
# .github/workflows/bench.yml (relative A/B gate)
bench:
  runs-on: [self-hosted, bench]      # ideally your controlled runner; cloud works for relative
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }
    - run: |
        git checkout ${{ github.base_ref }}
        go test -bench=. -benchmem -count=8 ./pkg/hotpath > base.txt
        git checkout ${{ github.sha }}
        go test -bench=. -benchmem -count=8 ./pkg/hotpath > new.txt
        benchstat -format csv base.txt new.txt > delta.csv
    - run: ./scripts/comment_if_regression.sh delta.csv 3.0   # fail if >3% slower, p<0.05
```

The alerting logic — *is this delta a real regression or noise?* — is non-trivial and belongs to [regression detection](../07-performance-budgets-and-regression-testing/professional.md): a Mann-Whitney U test on the two sample distributions, a minimum effect size (don't alert on a statistically-significant 0.3% that no one cares about), and a guard against alerting on a single bad run. The benchmarking layer's job is to *produce clean distributions*; the regression layer's job is to *decide if they differ*. Don't conflate them.

The dashboard makes the trend pipeline pay off. A per-benchmark time series (latency/op on Y, commit/date on X) annotated with merge SHAs turns "perf got worse sometime this quarter" into "perf stepped 9% at commit `e4f7a1` on May 3." Grafana over a results table, or a hosted tool (Bencher, `cargo-criterion` + a viewer, the Go `benchmark` dashboards), both work. The non-negotiable is *annotation by commit* — a trend line without commit markers tells you something is wrong but not where.

> **The professional reality:** a continuous benchmarking pipeline is two pipelines with different SLAs — a fast relative gate that blocks PRs, and a thorough absolute trend job that catches drift. Conflating them gives you a gate too slow to keep and a trend too noisy to read. And the dashboard is only useful if every point links back to a commit.

---

## Result Storage, Baselines, and Trend Tracking

Benchmark results are time-series data with provenance, and the cheapest correct storage is usually a structured append-only store keyed by `(benchmark, commit, host)`. The schema matters more than the technology — Postgres, a columnar store, or even committed JSON files in a results repo all work if the record carries enough context.

What every stored record needs (so a future comparison is valid):

```json
{
  "benchmark": "serialize/order-batch",
  "commit": "e4f7a1c", "parent": "d9c0b2a",
  "host_id": "bench-runner-01", "toolchain": "rustc-1.78.0",
  "workload_hash": "sha256:1c7e…",
  "metric": "ns_per_op",
  "p50": 842, "p90": 871, "p99": 940,
  "raw_samples": [/* … for re-running the stat test later */],
  "git_branch": "main", "ts": "2026-06-19T03:11:00Z"
}
```

**Baselines** are the comparison target, and choosing the baseline is a design decision:

- **Parent-commit baseline (relative gate).** Compare a commit to its parent. Best for catching a single regressing change. This is what the A/B PR gate does.
- **Rolling-window baseline (trend).** Compare to the median of the last N green runs on the same host. Robust to single-run noise; catches slow drift. A regression alert fires when the new distribution is significantly worse than the rolling baseline by more than the minimum effect size.
- **Release baseline (product SLA).** Compare to the last released version. This is the number you cite to product: "v2.4 encodes order batches 11% faster than v2.3." It's a [performance budget](../07-performance-budgets-and-regression-testing/professional.md) anchor.

Baseline hygiene that bites people:

- **Re-baseline only on the same host.** A baseline measured on `runner-01` is meaningless for a result from `runner-02`. Key baselines by host.
- **Re-baseline after intended changes.** When you deliberately accept a 5% slowdown for a feature, *move the baseline* and note why, or every future run alerts forever.
- **Keep raw samples, not just summaries.** If you only store the mean, you can never re-run a better statistical test later or investigate whether a "regression" was bimodal (a GC-pause tail) vs a true shift.

> **The principle:** a benchmark result is only meaningful relative to a baseline measured under the same conditions. Store provenance and raw samples so comparisons stay valid as your tooling evolves, key baselines by host, and treat a deliberate slowdown as a baseline *move*, not a standing alert. A stale baseline produces alert fatigue, and alert fatigue kills the whole pipeline's credibility.

---

## When a Microbenchmark Is a Lie About Production

A microbenchmark can be *internally honest* — DCE-defeated, warmed up, low variance, statistically sound — and still tell you something false about production. This is the most expensive class of benchmarking error because the number *looks* trustworthy. The mechanisms:

- **Cache warm vs cold.** A microbenchmark hammers the same small working set in a tight loop, so by the second iteration everything is in L1/L2 and the branch predictor is trained. Production touches that code path once per request, cold, with the caches full of *other* requests' data. A function that's 50ns hot can be 400ns cold. Your benchmark measured the warm case; production lives in the cold case.
- **Single-tenant vs contended.** The benchmark runs alone on the box. Production runs that code on 64 threads contending for the same lock, the same allocator arena, the same cache lines (false sharing). A lock-free path that benchmarks beautifully single-threaded can collapse under contention — see [concurrency overhead](../06-concurrency-and-contention/). The microbenchmark measured zero contention; production has plenty.
- **Synthetic vs real data distributions.** Benchmarks use clean, uniform, or worst-case-free inputs. Production data is skewed: 90% of strings are short and one is 4 MB; the hash keys cluster; the JSON is mostly nulls. A parser benchmarked on uniform input can be 3x slower on the real long-tail distribution, or vice versa. *The input distribution is part of the measurement* — a benchmark on the wrong distribution measures the wrong thing.
- **Allocation amortized away.** Tight loops let the allocator and GC reach a steady state the benchmark doesn't pay for; production's bursty allocation triggers GC pauses the microbenchmark never sees. Always report `allocs/op` and validate against production GC behavior.
- **The whole-system effect is missing.** Making a function 2x faster that's 1% of request time is invisible in production (Amdahl). The microbenchmark celebrates a real local win that the macro picture renders irrelevant.

The defense is layering, not abandoning microbenchmarks:

1. **Microbenchmark** to iterate fast on a hot function (cheap, fast feedback).
2. **Validate against a macrobenchmark / load test** with realistic concurrency and data before believing the win is real (see [throughput vs latency](../03-latency-and-throughput/)).
3. **Confirm in production** with a canary and real metrics. The only authority on production performance is production.

> **The hard-won lesson:** an internally-honest microbenchmark answers "is this function faster in isolation?" — which is a *different question* from "is the system faster for users?" The gap is cache state, contention, data distribution, and Amdahl. Treat a microbenchmark win as a hypothesis to be confirmed by a load test and a canary, never as a conclusion. The number being low-variance does not make it relevant.

---

## Flame-Graph-Guided Benchmark Targeting

The complement to "don't trust every benchmark" is "don't *write* benchmarks blindly." The most common waste in benchmarking is optimizing — and benchmarking — code that doesn't matter. The flame graph tells you where the time actually goes, and that's where your benchmarks (and optimization effort) belong.

The disciplined loop:

1. **Profile the real workload first** ([01 — Profiling](../01-profiling/)). A CPU flame graph from a production-like load shows the widest frames — the functions that own the most wall-clock or CPU time.
2. **Write microbenchmarks for the wide frames, not the narrow ones.** If `json.Marshal` is 22% of CPU and your custom `validate()` is 0.4%, benchmark the marshaling path. Benchmarking `validate()` is effort spent on a frame too thin to matter.
3. **Use the flame graph to scope the benchmark correctly.** The graph shows whether the cost is in *your* code or in a framework/library frame underneath it — which directly determines whether your benchmark should isolate your code or include the framework. (This is exactly the trap in the war story below.)
4. **Re-profile after optimizing** to confirm the wide frame shrank and a new bottleneck didn't just take its place.

This turns benchmarking from a guessing game into targeted work. You benchmark the hot 5% of code that owns 80% of the time, and you ignore the cold 95% — because a benchmark of cold code is, by construction, measuring something that can't move the system.

> **The principle:** a flame graph is the map; benchmarks are the measurements you take at the marked locations. Writing a benchmark without first profiling is surveying random coordinates. Benchmark the widest frames; ignore the thin ones — Amdahl guarantees the thin ones can't matter.

---

## The Cost and ROI of Benchmarking

Benchmarks are not free. Each one costs authoring time, CI minutes, runner wear, maintenance as the code evolves, and — most insidiously — *attention*: a 40-minute suite with 300 benchmarks is a suite no one reads. The professional question is not "should we benchmark?" but "*which* code earns a benchmark?"

Benchmark when the ROI is clear:

- **Hot paths** the flame graph proves own real time. A 5% win here is worth real money in fleet CPU and latency.
- **Regression-prone code** — the serializer, the core data structure, the request router, the hot allocation path — code where a careless change silently costs 10% and no test would catch it. These earn a *gate*, not just a benchmark.
- **Code with a contractual performance SLA** — a library others depend on for speed, a latency-budgeted component.
- **Algorithmic decisions** where you're choosing between implementations and need a defensible comparison.

Do *not* benchmark:

- **Cold code** — startup paths, config parsing, admin endpoints. A microsecond saved on something that runs once at boot is zero value.
- **Code that's about to change** — benchmarking churning code is maintaining benchmarks faster than they pay back.
- **Everything, reflexively.** "100% benchmark coverage" is an anti-goal. It produces a slow suite of mostly-noise that buries the few benchmarks that matter and trains the team to ignore the whole thing.

A simple ROI heuristic: a benchmark is worth maintaining if `(probability the code regresses) × (cost of a missed regression) > (authoring + CI + maintenance cost)`. For the request hot path that's clearly true; for a config parser it's clearly false. Spend your benchmarking budget where the flame graph and the regression history say it pays.

> **The professional reality:** the goal is not maximum benchmark coverage — it's maximum *signal per minute of suite time and per unit of attention*. Benchmark the hot, regression-prone, SLA-bound code and gate it; skip the cold and the churning. A small suite people trust and run beats a huge suite people ignore, every time.

---

## War Stories

**The "10% faster" microbenchmark that was slower in prod.** A team replaced their JSON encoder with a hand-rolled one. The microbenchmark — encoding a fixed struct in a tight loop — showed a clean, low-variance 10% improvement. Shipped. Production p99 *rose* 8%. Cause: the microbenchmark encoded the *same* struct repeatedly, so the branch predictor and caches were perfectly warm and the input was a single shape. Production encoded thousands of *different* struct shapes cold, and the hand-rolled encoder's branch-heavy code path predicted badly on the varied real input where the standard library's table-driven approach didn't. The benchmark measured the warm, single-shape case; production is cold and varied. The lesson: a microbenchmark's input distribution and cache state *are* the measurement — match them to production or distrust the number.

**The benchmark that measured the framework, not the code.** An engineer "optimized" a request handler and the microbenchmark showed a 40% speedup. Celebration, until a colleague noticed the benchmark invoked the handler *through the full web framework's routing and middleware stack*. Profiling revealed 85% of the benchmarked time was framework reflection and JSON binding — the "40% improvement" was noise in the 15% that was actually the handler, amplified by a lucky run. The benchmark was measuring the framework, not the code under change. Fix: benchmark the handler function directly, with the framework excluded, so the number reflected the code being changed. The lesson: a flame graph of your *own benchmark* tells you whether you're measuring what you think you are.

**The cloud-CI benchmark everyone learned to ignore.** A team added benchmarks to GitHub Actions, gating on a 5% absolute-number threshold. Run-to-run variance on the shared runners was 25–40%. The check went red and green at random; within a month the team had a `[skip-bench]` label and used it on every PR. A real 12% regression then shipped unnoticed because the gate had zero credibility. Fix: move to A/B-in-one-run relative comparison (drift cancels) plus a nightly absolute run on one refurbished bare-metal box. The relative gate's false-positive rate dropped to near zero and people started trusting it. The lesson: a benchmark noisier than the regression it's meant to catch is worse than none — it destroys trust in the signal.

**The 0.5%-per-week creep.** No single PR ever tripped the 3% regression gate. But the trend dashboard showed the core request path had gotten 31% slower over two quarters — a steady drip of "harmless" 0.4% changes, each below threshold, compounding. Without the absolute trend pipeline and its commit-annotated dashboard, the drift was invisible; with it, bisecting the trend line found the worst contributors. The lesson: a per-PR gate catches steps, only a long-horizon trend catches creep — you need both stages.

---

## Decision Frameworks

**Where do I run this benchmark? Ask:**
- Do I need an *absolute* number (latency/op, throughput)? → dedicated bare-metal runner, governor pinned, isolated core. Cloud absolutes are noise.
- Do I just need "is the PR faster or slower than main?" → A/B in one CI job on the same host; relative, drift cancels; cloud is fine.
- Can I get neither? → treat cloud absolutes as a catastrophic-regression smoke test only (2x+), and validate on a controlled host before release.

**Should this code have a benchmark at all? Ask:**
- Does the flame graph show it owning real time? → yes, benchmark it.
- Is it regression-prone (serializer, core data structure, hot path)? → yes, and *gate* it.
- Is it cold (startup, config, admin) or about to be rewritten? → no.
- Am I chasing "100% benchmark coverage"? → stop; that's an anti-goal.

**Do I believe this microbenchmark's win? Ask:**
- Was the input the real production distribution, or synthetic/uniform? → if synthetic, distrust.
- Warm cache + single-tenant in the bench vs cold + contended in prod? → if so, validate with a load test.
- Is the function a meaningful fraction of request time (flame graph)? → if <1–2%, Amdahl says it won't move the system.
- Confirmed by a macrobenchmark and a canary? → if not, it's a hypothesis, not a result.

**What's my pipeline shape? Default to:**
- Fast *relative* A/B gate on PRs (blocks obvious regressions) + thorough *absolute* trend run on a dedicated host (catches creep), with a commit-annotated dashboard and the stat test owned by [regression detection](../07-performance-budgets-and-regression-testing/professional.md).

---

## Mental Models

- **A benchmark is a measurement instrument; treat it like one.** It needs calibration (pinned environment), a serial number (provenance on every sample), and a logbook (stored results). An instrument whose reading depends on who's holding it is broken.

- **On shared cloud, only *relative* numbers survive.** A/B two builds on the same host in the same run and the noise cancels. Absolute microbenchmark numbers on a shared VM are anti-signal — red and green at random.

- **An internally-honest microbenchmark can still lie about production.** Warm vs cold cache, single-tenant vs contended, synthetic vs real data, Amdahl. Low variance proves the number is *stable*, not that it's *relevant*.

- **The flame graph is the map; benchmarks are measurements at marked spots.** Benchmark the widest frames. A benchmark of thin (cold) code is, by construction, measuring something that can't move the system.

- **A benchmark people ignore is negative value.** It spent CI minutes and trained the team to dismiss perf signal. A small trusted suite beats a huge ignored one.

- **Two pipelines, two SLAs.** Fast relative gate to block PRs; thorough absolute trend to catch creep. Conflate them and you get a gate too slow to keep and a trend too noisy to read.

---

## Common Mistakes

1. **Gating on absolute microbenchmark numbers from shared cloud CI.** Variance (20–50%) dwarfs real regressions; the check goes red/green at random and the team learns to ignore it. Use A/B-in-one-run relative comparison, or a dedicated bare-metal runner for absolutes.

2. **No provenance on results.** A number without commit SHA, host ID, toolchain version, and workload hash can't be compared across time or machines. Every sample carries its context, or it's not infrastructure.

3. **Believing a low-variance microbenchmark is therefore relevant.** Stable ≠ representative. Warm-cache, single-tenant, synthetic-input numbers routinely disagree with production. Validate wins with a load test and a canary.

4. **Benchmarking the framework instead of the code.** If the benchmark routes through middleware/reflection/ORM, most of the measured time isn't your change. Flame-graph your own benchmark; isolate the code under change.

5. **Benchmarking everything for "coverage."** A 40-minute suite of mostly cold-code noise buries the few benchmarks that matter and trains people to skip the whole thing. Benchmark hot, regression-prone, SLA-bound code only.

6. **Only a per-PR gate, no trend pipeline.** Catches steps, misses the 0.5%-per-week creep that compounds to 30%. You need the absolute trend run with a commit-annotated dashboard too.

7. **Stale baselines.** A deliberate slowdown not re-baselined alerts forever; a baseline from a different host is meaningless. Key baselines by host; move them on intended changes; keep raw samples to re-test later.

8. **Conflating "measure" with "judge."** The harness should emit distributions; whether two distributions differ belongs to [regression detection](../07-performance-budgets-and-regression-testing/professional.md). Mixing them locks you into one stat test and one threshold forever.

---

## Test Yourself

1. Your team gates PRs on absolute microbenchmark numbers run on GitHub Actions. The check is red half the time for no code reason. Explain the root cause and give the two-part fix.
2. Describe the A/B-in-one-run technique and explain *why* it produces a trustworthy delta even on a noisy shared cloud VM.
3. List four reasons an internally-honest microbenchmark (low variance, DCE-defeated, warmed up) can still mispredict production performance.
4. A microbenchmark shows a request handler is 40% faster. A colleague is skeptical. What would you check first to see whether the number reflects the code you actually changed?
5. What must every stored benchmark result contain so that a comparison made six months later is still valid? Why keep raw samples and not just the mean?
6. Why do you need *two* benchmark pipeline stages (a PR gate and a trend run)? What does each catch that the other misses?
7. How does a flame graph decide *which* code earns a benchmark — and which doesn't?
8. You deliberately accept a 4% slowdown to ship a feature. What must you do to the baseline, and what happens if you don't?

<details>
<summary>Answers</summary>

1. **Root cause:** shared cloud runners have noisy neighbors, uncontrolled CPU frequency (turbo/throttling), shared/burstable vCPUs, and heterogeneous hardware, producing 20–50% run-to-run variance that dwarfs any real regression — so the gate flips on noise. **Fix:** (a) switch the PR gate to *relative* A/B comparison — benchmark `main` and the PR on the *same host in the same job* and compare them to each other so drift cancels; (b) run *absolute* numbers on a dedicated bare-metal runner (governor pinned, turbo off, isolated core) for trend tracking.
2. Check out and benchmark `main`, then check out and benchmark the PR, **both on the same machine in the same CI run** (ideally interleaved), and compare the two distributions to *each other* with `benchstat`. It's trustworthy because the noisy neighbor, frequency drift, and cache thrash affect *both arms roughly equally* and cancel out in the delta — you've converted a fragile absolute measurement into a robust relative one.
3. Any four: **warm cache** in the tight loop vs **cold** per-request in prod; **single-tenant** in the bench vs **contended** (lock/allocator/false-sharing) in prod; **synthetic/uniform input** vs the **real skewed data distribution**; **amortized allocation/GC** in steady-state loops vs bursty prod GC pauses; and **Amdahl** — a real local win on code that's 1% of request time is invisible system-wide.
4. **Flame-graph the benchmark itself.** If most of the measured time is framework routing/middleware/reflection/ORM rather than the handler code you changed, the benchmark is measuring the framework, not your change — the "40%" is noise in the small fraction that's actually your code. Re-scope the benchmark to call the changed function directly.
5. Commit SHA (and parent), host ID, toolchain version, workload hash, the metric, and the **raw sample distribution**. Keep raw samples (not just the mean) so you can re-run a better statistical test later and investigate whether a "regression" is a true shift vs a bimodal tail (e.g., a GC pause) — a mean alone hides that and can't be re-analyzed.
6. The **PR gate** (relative, fast) catches a single regressing change before merge but, being per-commit, can't see slow drift. The **trend run** (absolute, thorough, on the dedicated host, commit-annotated dashboard) catches the 0.5%-per-week creep where every PR is individually under threshold but the total compounds to 30%. Steps vs creep — you need both.
7. Profile the real workload; the flame graph's **widest frames** are the code owning the most time. Benchmark those; ignore the thin frames. Amdahl guarantees that optimizing (or benchmarking) cold code that's <1–2% of time can't move the system, so a benchmark there is measuring something irrelevant by construction.
8. **Move the baseline** to the new (slower) level on that host and record *why*. If you don't, every subsequent run compares against the old faster baseline and fires a regression alert forever — alert fatigue that erodes trust in the whole pipeline.

</details>

---

## Cheat Sheet

```
RUNNER CHOICE (the core professional decision)
  absolute numbers needed   → DEDICATED BARE METAL
     cpupower -g performance; boost off; SMT off; isolcpus + taskset
     → run-to-run noise <1-2%, resolves a 3% regression
  "is PR faster than main?"  → A/B IN ONE JOB on same host (relative)
     git checkout main; bench; git checkout PR; bench; benchstat base new
     → drift cancels, works even on noisy cloud
  NEVER gate on absolute microbench numbers from shared cloud CI (20-50% noise)

HARNESS = INFRASTRUCTURE
  pinned env + versioned workload (hashed) + provenance on every sample
  emit the DISTRIBUTION, not a single number; harness measures, doesn't judge

RESULT RECORD (so comparison stays valid)
  {benchmark, commit, parent, host_id, toolchain, workload_hash,
   metric, p50/p90/p99, raw_samples, branch, ts}

PIPELINE (two stages, two SLAs)
  PR gate:    relative A/B, fast, blocks obvious regressions
  trend run:  absolute, dedicated host, per-merge/nightly, dashboard
  dashboard:  time series ANNOTATED BY COMMIT (else can't find the step)
  stat test:  Mann-Whitney U + min effect size → regression-detection topic

BASELINES
  parent-commit → catch a single regressing change (PR gate)
  rolling window → catch slow drift (trend)
  release       → product SLA number
  RULES: key by host; MOVE baseline on intended slowdowns; keep raw samples

IS THE WIN REAL? (microbench lies)
  warm vs cold cache | single-tenant vs contended | synthetic vs real data
  | amortized GC | Amdahl (1% of time = invisible)
  → microbench = hypothesis; confirm with load test + canary

WHAT TO BENCHMARK
  YES: hot paths (flame graph), regression-prone code, SLA'd libs
  NO:  cold code, churning code, "100% coverage"
```

---

## Summary

- **A benchmark harness is infrastructure**, not a script: pinned environment, versioned and hashed workload, provenance on every sample, and output that's a *distribution* with a commit/host/toolchain stamp — not a single number. The harness measures; deciding whether two distributions differ belongs to [regression detection](../07-performance-budgets-and-regression-testing/professional.md).
- **Shared cloud CI cannot produce trustworthy absolute microbenchmark numbers** (20–50% noise from noisy neighbors, frequency scaling, shared vCPUs). Either do **A/B comparison on the same host in the same run** (relative, drift cancels — works on cloud) or use a **dedicated bare-metal runner** (governor pinned, turbo/SMT off, isolated core — noise <1–2%). Never gate on cloud absolutes.
- **A continuous pipeline is two stages:** a fast *relative* PR gate that blocks obvious regressions, and a thorough *absolute* trend run on the dedicated host that catches the slow creep no single PR trips — with a **commit-annotated dashboard** so a step is locatable.
- **Store results as time-series with provenance and raw samples**; key baselines by host; *move* the baseline on deliberate slowdowns or alert forever.
- **An internally-honest microbenchmark can still lie about production** — warm vs cold cache, single-tenant vs contended, synthetic vs real data, Amdahl. Treat a microbenchmark win as a hypothesis to confirm with a load test and a canary.
- **Use the flame graph to target benchmarks** at the widest frames, and **spend your benchmarking budget by ROI** — hot, regression-prone, SLA-bound code earns a gate; cold and churning code earns nothing. A small trusted suite beats a huge ignored one.

You can now run benchmarking as an organizational practice: a harness people trust, a runner that isn't noise, a pipeline that catches regressions early, and the judgment to know when a green number is still a lie. The final tier — [interview.md](interview.md) — distills the whole topic into the questions that reveal whether someone has actually internalized all of this.

---

## Further Reading

- *Systems Performance* — Brendan Gregg — the canonical text on measurement methodology, the USE method, and why your environment is part of the measurement.
- [Aleksey Shipilëv — "Nanotrusting the Nanotime"](https://shipilev.net/blog/2014/nanotrusting-the-nanotime/) — the definitive treatment of why microbenchmark numbers deceive, JMH-flavored but universal.
- [`benchstat` documentation](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) — comparing two distributions honestly, the A/B-in-one-run workflow's backbone.
- [Criterion.rs](https://bheisler.github.io/criterion.rs/book/) — statistically-rigorous Rust benchmarking with stored baselines and trend detection built in.
- [JMH samples](https://github.com/openjdk/jmh) — the reference for warm-up, fork isolation, and `Blackhole` (DCE defeat) on the JVM.
- *The Tail at Scale* — Dean & Barroso — why the distribution and the contended/real-world case, not the warm single-tenant mean, is what matters.

---

## Related Topics

- [08 — Regression Detection](../07-performance-budgets-and-regression-testing/professional.md) — the statistical test (Mann-Whitney U), thresholds, and alerting that decide whether the distributions your harness produces actually differ.
- [01 — Profiling](../01-profiling/) — the flame graphs that target which code earns a benchmark and verify a benchmark measures your code, not the framework.
- [04 — Throughput vs Latency](../03-latency-and-throughput/) — the macrobenchmark / load-test layer that confirms a microbenchmark win is real under concurrency.
- [07 — Concurrency Overhead](../06-concurrency-and-contention/) — why a single-threaded microbenchmark win can collapse under production contention.
- [Build Systems › Build Fundamentals](../../build-systems/01-build-fundamentals/professional.md) — pinning the toolchain that a reproducible benchmark depends on.
