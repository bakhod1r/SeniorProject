---
layout: default
title: Benchmarks — Professional
parent: Benchmarks (testing.B)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/professional/
---

# Benchmarks — Professional

[← Back](../)

> Focus: shipping benchmarks as production engineering artefacts. CI integration, performance regression gating, stable measurement infrastructure, and interpreting `allocs/op` patterns when you own a service in production.

This page assumes you have read the junior, middle, and senior pages. It is about turning benchmarks from "something you run before pushing" into a continuously-evaluated quality signal of your codebase.

## Table of Contents

1. [What "professional benchmarking" means](#what-professional-benchmarking-means)
2. [The performance regression problem](#the-performance-regression-problem)
3. [Architecture of a perf CI pipeline](#architecture-of-a-perf-ci-pipeline)
4. [Choosing a benchmark host](#choosing-a-benchmark-host)
5. [Stability budget for CI](#stability-budget-for-ci)
6. [Storing baselines](#storing-baselines)
7. [Gate logic — when do we fail the build](#gate-logic--when-do-we-fail-the-build)
8. [`benchstat` in CI](#benchstat-in-ci)
9. [Pinning, isolation, GOMAXPROCS=1](#pinning-isolation-gomaxprocs1)
10. [Reading `allocs/op` patterns in production code](#reading-allocsop-patterns-in-production-code)
11. [When benchmarks lie](#when-benchmarks-lie)
12. [Closing the loop with production telemetry](#closing-the-loop-with-production-telemetry)
13. [Anti-patterns](#anti-patterns)
14. [Summary](#summary)

---

## What "professional benchmarking" means

Most Go developers write benchmarks the same way they write unit tests: occasionally, for personal validation, after a "this is slow" hunch. That works for an individual contributor. It does not work for a 50-engineer team shipping a high-throughput service where any commit can introduce a 5 % regression that nobody notices until p99 latency creeps over the SLO three months later.

Professional benchmarking is the discipline of:

1. Making per-commit performance measurable.
2. Storing those measurements in a queryable form.
3. Alerting on regressions before they reach production.
4. Knowing the **noise floor** of your benchmarking infrastructure so alerts are not noise themselves.

The deliverables are: a CI job, a dedicated host or pool, a baseline format, and a gate.

---

## The performance regression problem

Consider a JSON-parsing hot path that costs 800 ns/op today. Over six months of commits:

- Commit A: refactor field iteration. +12 ns/op (1.5 %). Nobody notices.
- Commit B: add an opaque interface boundary. +35 ns/op (4.4 %). Nobody notices.
- Commit C: replace `[]byte` with `string` for safety. +60 ns/op (7.5 %). Nobody notices.

Six months later you parse JSON at 907 ns/op. That is a 13 % regression. Cumulative, irreversible without archaeology. The individual commits passed review because no single change was glaring.

The cure is **per-commit detection of small regressions**. If commit B had failed CI with "you slowed `BenchmarkParseJSON` by 4 % (p=0.001)", the author would have either justified or fixed it.

This is the same logic as unit tests preventing functional regressions, applied to perf.

---

## Architecture of a perf CI pipeline

A minimal pipeline looks like this:

```
PR commit
   │
   ▼
[ regular CI: build, vet, unit tests ]
   │
   ▼
[ perf job ]
   ├── checkout PR
   ├── run benchmarks on dedicated runner, -count=N
   ├── fetch baseline.txt from artifact store
   ├── benchstat baseline.txt new.txt
   ├── parse benchstat output
   ├── compare deltas against thresholds
   └── post comment to PR / fail build
```

The pieces:

1. **Dedicated runner.** Not a shared GitHub Actions hosted runner — those see 10–20 % noise. Either a self-hosted bare-metal box, or a stable cloud VM (e.g. EC2 metal instance) used exclusively for perf jobs.
2. **Baseline storage.** Usually a flat-file artifact in S3 / GCS keyed by branch + benchmark name. On merge to main, the merged commit's results overwrite the baseline.
3. **`benchstat` invocation.** With `-row` and `-col` flags to format the output sensibly.
4. **Gate logic.** A small script that parses `benchstat` output and decides pass/fail.

---

## Choosing a benchmark host

The hierarchy, by stability:

1. **Bare-metal server, dedicated.** Best. ± 0.5–1 % noise.
2. **Bare-metal server, shared with low-priority workloads.** Acceptable if isolation is enforced (cgroups, isolcpus).
3. **Cloud "metal" instances** (e.g. `c6i.metal`). ± 1–3 % noise. Pricier than VMs but no hypervisor jitter.
4. **Cloud dedicated VMs** (e.g. `c6i.large`, dedicated tenancy). ± 3–8 % noise.
5. **Shared cloud VMs.** ± 5–15 % noise. **Do not use** for sub-10 % regression detection.
6. **Hosted CI runners** (GitHub Actions, GitLab.com). ± 10–20 % noise. Suitable only for catching huge regressions.

For most teams, option 3 or 4 is the cost/benefit sweet spot.

---

## Stability budget for CI

Define explicitly, in your repo:

```yaml
# .perf.yaml — illustrative
host: ec2-c6i-metal
gomaxprocs: 4
benchtime: 1s
count: 10
noise_floor_pct: 2.0
regression_threshold_pct: 5.0
significance_p: 0.05
```

The semantics:

- `noise_floor_pct`: smaller deltas are ignored (treated as "no change").
- `regression_threshold_pct`: a delta exceeding this magnitude with `p < significance_p` fails the build.
- `count`: passed as `-count` to `go test`.

These numbers should be **measured**, not guessed. Run the same benchmark 30 times on your perf host with no code changes; the stddev of `ns/op` is your noise floor.

---

## Storing baselines

Two common patterns:

### Pattern A — git-tracked baseline file

```
testdata/perf/baseline.txt
```

Updated by a maintainer running benchmarks on the perf host after each merge to main. Pros: reviewable, diffable. Cons: requires a manual or scripted update; can drift if forgotten.

### Pattern B — artifact store keyed by commit

CI uploads `bench.txt` to S3/GCS after every main-branch build. The PR perf job downloads the latest main-branch artifact and compares. Pros: fully automatic. Cons: needs an artifact retention policy.

For most teams, B scales better. A works fine for repos < 20 engineers.

---

## Gate logic — when do we fail the build

The parser of `benchstat` output looks roughly like:

```go
// pseudocode
for _, row := range benchstatTable.Rows {
    delta := row.DeltaPercent
    p := row.PValue
    if math.Abs(delta) < noiseFloorPct {
        continue  // in the noise
    }
    if delta > regressionThresholdPct && p < significanceP {
        fail("regression on %s: %+.1f%% (p=%.3f)", row.Name, delta, p)
    }
    if delta < -improvementThresholdPct && p < significanceP {
        comment("improvement on %s: %+.1f%% (p=%.3f)", row.Name, delta, p)
    }
}
```

Notes:

- Fail on regressions; **comment** on improvements (do not silently pass — improvements deserve celebration and a record).
- Always include the p-value in the message so the author can argue.
- Track per-benchmark allowlists for known-flaky cases; mark them as "warn, do not fail".

---

## `benchstat` in CI

A typical invocation:

```bash
benchstat \
  -filter ".unit:ns/op" \
  -row "/size /algo" \
  -col ".branch" \
  -delta-test "u" \
  baseline.txt new.txt > report.txt
```

Key flags (modern benchstat):

- `-filter`: subset metrics (e.g., only `ns/op`, ignore `allocs/op` for the gate).
- `-row` / `-col`: pivot the table.
- `-delta-test u`: Mann–Whitney U-test (default).
- `-confidence`: confidence level for the test.

Capture stdout to a file; parse it with a small Go program that emits exit code 0/1 and a markdown summary for the PR comment.

---

## Pinning, isolation, GOMAXPROCS=1

On the perf host, the runner script (not `go test` itself) is responsible for isolation:

```bash
#!/bin/bash
set -euo pipefail

# Verify governor
gov=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor)
[[ "$gov" == "performance" ]] || { echo "CPU governor is $gov, expected performance"; exit 1; }

# Verify turbo off
turbo=$(cat /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null || echo 1)
[[ "$turbo" == "1" ]] || { echo "Turbo is on, refuse to run"; exit 1; }

# Pin
exec taskset -c 4 env GOMAXPROCS=1 go test -bench=. -count=10 -benchmem
```

Failing the run if conditions are not met prevents the team from accidentally running on a misconfigured host and merging spurious "regressions".

For benchmarks of concurrent code that need `GOMAXPROCS > 1`, pin to a fixed number of cores:

```bash
exec taskset -c 4-7 env GOMAXPROCS=4 go test -bench=. -count=10 -benchmem
```

---

## Reading `allocs/op` patterns in production code

`allocs/op` is more stable than `ns/op` — allocations are counted deterministically, not measured. This makes it the single most useful column for regression gating.

Common patterns and what they tell you:

### `0 allocs/op`

The code is allocation-free. Inspect the hot path; expect stack-allocated locals, slice reuse, possibly `sync.Pool`. A regression from `0` to `1` is highly visible and worth investigating immediately.

### `1 alloc/op`

A single heap allocation per call. Often a returned slice/string/struct that escapes. Look at the escape analysis (`go build -gcflags='-m'`) and consider whether the return value can be reused.

### `2-3 allocs/op`

Multiple structured returns: a map result, an error allocation on a hot path, an interface boxing. The cost is modest but watch for growth.

### `N allocs/op` where N tracks input size

This is almost always **the** performance problem. Each input element triggers an allocation: typically `append` to a slice without pre-sizing, or a per-element `fmt.Sprintf`, or a closure capturing a loop variable.

### Allocation cliffs

`B/op = 32 KiB` for `n=1000` but `B/op = 1 MiB` for `n=10000` is a cliff: the inner data structure crossed a size threshold (slice doubling, map resize). The cliff is real and explains nonlinear `ns/op` growth.

---

## When benchmarks lie

Even with perfect infrastructure, a microbenchmark can lie about production performance. Cases:

### The cache-hot benchmark

`b.N` iterations on the same `1 KB` input keep that input in L1 cache. Production traffic has cold data. The benchmark over-reports speed.

**Mitigation:** Vary the input. Use a corpus of `M` distinct inputs, cycle through with `inputs[i%M]`. The corpus should be large enough to evict L1.

### The single-goroutine benchmark

Your function is fast on its own; under contention from 16 goroutines it serialises on a mutex you forgot about. The benchmark passes.

**Mitigation:** Add a `b.RunParallel` variant for any benchmark of code that runs concurrently in prod.

### The fresh-process benchmark

`go test` starts a fresh process with empty caches, fresh GC, fresh heap. Production runs for days; heap state, GC tuning, scheduler choices all differ.

**Mitigation:** Long-running benchmarks (`-benchtime=60s`) approximate this slightly better. Even better: load-test the actual binary.

### The compiler-cooperative benchmark

A microbenchmark may inline aggressively because the function is small and called from a small caller. In production the function is called from many sites and may not be inlined.

**Mitigation:** Use `//go:noinline` directives to compare apples to apples, or measure the call site you actually care about.

---

## Closing the loop with production telemetry

A benchmark predicts; production telemetry verifies. After a change ships:

- Watch the relevant Prometheus histogram for that operation.
- Compare p50/p99 latency for the week before and the week after.
- If telemetry disagrees with the benchmark, the benchmark is wrong — investigate which assumption failed.

The discipline: every PR with a meaningful perf delta is annotated with the expected telemetry change *before* merge, and reviewed against actual telemetry one week after deploy. This catches benchmarks that systematically lie.

---

## Anti-patterns

- **Vanity benchmarks.** A benchmark added to a PR to "show" the improvement, with no commitment to maintaining it. Either land it in the suite with a CI gate, or do not bother.
- **Benchmarks that measure constants.** A benchmark whose result depends on a hardcoded constant (length, parameter) is fragile. Parametrise via sub-benchmarks.
- **Skipping `-count` "to save time".** A 9-second saving on a 30-minute CI run is no saving at all if the result is statistical noise.
- **Comparing on different hardware.** Baseline taken on the old build server, new run on a replaced server. The "improvement" is silicon, not code.
- **Optimising the benchmark, not the code.** You make `BenchmarkX` 30 % faster by changing the benchmark itself (different input, different setup). Production sees nothing.
- **Ignoring `allocs/op`.** A change with 0 % `ns/op` delta and `+1 allocs/op` is still a regression — at scale it becomes GC pressure.

---

## Summary

Professional benchmarking treats performance as a tested, gated property. The deliverables: a dedicated host, a baseline format, a CI job, and a gate. The discipline: detect small regressions per-commit, never trust a single run, always pair benchmark numbers with production telemetry. Once you have this in place, performance becomes a property your tests defend — same as correctness.

---

## Appendix A — A complete CI configuration sketch

For a small team adopting performance CI for the first time, here is an opinionated starting configuration. Adapt as needed.

### Repository layout

```
.
├── .github/
│   └── workflows/
│       └── perf.yml          # CI workflow
├── perf/
│   ├── baseline.txt          # current main-branch baseline
│   ├── threshold.json        # gating configuration
│   └── compare.sh            # comparison script
├── internal/
│   └── ... (production code)
└── ... (tests, benchmarks)
```

### `threshold.json`

```json
{
  "noise_floor_pct": 2.0,
  "regression_threshold_pct": 5.0,
  "significance_p": 0.05,
  "ignored_benchmarks": [
    "BenchmarkFlaky"
  ],
  "metric_thresholds": {
    "sec/op": 5.0,
    "B/op": 10.0,
    "allocs/op": 0.0
  }
}
```

Note: `allocs/op` threshold of 0.0 means *any* allocation regression fails. Allocations are deterministic; there is no excuse for an unexplained increase.

### `compare.sh`

```bash
#!/bin/bash
set -euo pipefail

BASELINE="${1:-perf/baseline.txt}"
NEW="${2:-perf/new.txt}"
THRESH="${3:-perf/threshold.json}"

# Quick sanity check
[[ -f "$BASELINE" ]] || { echo "baseline missing"; exit 1; }
[[ -f "$NEW" ]] || { echo "new results missing"; exit 1; }

# Compare
benchstat "$BASELINE" "$NEW" > perf/report.txt
cat perf/report.txt

# Gate
go run ./tools/perf-gate -threshold "$THRESH" -report perf/report.txt
```

### `perf-gate` (a Go tool you write)

```go
package main

import (
    "encoding/json"
    "flag"
    "fmt"
    "os"
    "strings"
)

type Threshold struct {
    RegressionPct      float64            `json:"regression_threshold_pct"`
    SignificanceP      float64            `json:"significance_p"`
    IgnoredBenchmarks  []string           `json:"ignored_benchmarks"`
    MetricThresholds   map[string]float64 `json:"metric_thresholds"`
}

func main() {
    var threshPath, reportPath string
    flag.StringVar(&threshPath, "threshold", "", "path to thresholds.json")
    flag.StringVar(&reportPath, "report", "", "path to benchstat report")
    flag.Parse()

    // ... load threshold, parse report, apply rules,
    // ... exit 0 / 1 with markdown summary.
    fmt.Println("perf-gate placeholder")
    os.Exit(0)
}
```

### `.github/workflows/perf.yml`

```yaml
name: perf

on:
  pull_request:
    paths:
      - '**.go'
      - 'go.mod'
      - 'go.sum'

jobs:
  perf:
    runs-on: self-hosted-perf  # custom label for dedicated perf runner
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}

      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'

      - name: Verify perf machine
        run: |
          gov=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor)
          [[ "$gov" == "performance" ]] || exit 1
          turbo=$(cat /sys/devices/system/cpu/intel_pstate/no_turbo)
          [[ "$turbo" == "1" ]] || exit 1

      - name: Fetch baseline
        run: aws s3 cp s3://perf-baselines/main.txt perf/baseline.txt

      - name: Run benchmarks
        run: |
          taskset -c 4 go test -bench=. -count=10 -benchmem ./... \
            | tee perf/new.txt

      - name: Compare and gate
        run: bash perf/compare.sh

      - name: Post PR comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const body = fs.readFileSync('perf/report.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '```\n' + body + '\n```'
            });
```

The pieces work together. Baseline lives in S3, refreshed on each main-branch merge by a separate workflow. PR comparisons download the baseline, run benchmarks on a dedicated runner, gate, and post the result back to the PR.

This is a *starter* configuration. Mature setups have more — alerting, dashboards, historical baselines for multi-week trends — but this is enough to detect regressions on a small team.

## Appendix B — Tuning the noise floor on a new perf host

When you provision a new perf host, the first hour is establishing its noise budget. Steps:

### Day 1 — Hardware tuning

Set the BIOS:

- Disable hyper-threading (or leave it; choose deliberately).
- Disable turbo boost.
- Set CPU power profile to maximum performance.
- Disable C-states (deep sleep states).

Boot Linux with kernel arguments:

```
isolcpus=4-7 nohz_full=4-7 rcu_nocbs=4-7
```

This isolates cores 4-7 from the scheduler's normal workload, RCU callbacks, and timer ticks.

Set CPU governor:

```bash
sudo cpupower frequency-set -g performance
```

Stop unnecessary services:

```bash
sudo systemctl stop cron
sudo systemctl stop unattended-upgrades
sudo systemctl stop snapd
```

### Day 1 — Establish a canary

Pick a benchmark that exercises a mix of CPU and memory work. For most teams, a JSON-parse benchmark works. Run it 30 times:

```bash
taskset -c 4 go test -bench=BenchmarkCanary -count=30 -benchmem > canary-day1.txt
benchstat canary-day1.txt
```

Note the `± X%` figure. This is your day-1 noise floor.

### Day 2-7 — Confirm stability

Run the canary daily for a week. Track the noise floor. It should be stable. If it drifts, investigate (firmware update, hardware degradation, accumulated state).

### Quarterly recalibration

Every quarter, re-establish the noise floor. Track over time. A trend toward higher noise means the machine is degrading or accumulating cruft.

## Appendix C — Multi-benchmark gating logic

A real `perf-gate` tool needs to handle several edge cases. The pseudo-code:

```go
func gate(report Report, t Threshold) error {
    var regressions []string
    var improvements []string

    for _, row := range report.Rows {
        if contains(t.IgnoredBenchmarks, row.Name) {
            continue
        }

        for metric, delta := range row.Deltas {
            thresh, ok := t.MetricThresholds[metric]
            if !ok {
                continue
            }

            if math.Abs(delta.Pct) < t.NoiseFloorPct {
                continue
            }

            if delta.P > t.SignificanceP {
                continue
            }

            if delta.Pct > thresh {
                regressions = append(regressions,
                    fmt.Sprintf("%s/%s +%.1f%% (p=%.3f)", row.Name, metric, delta.Pct, delta.P))
            }
            if delta.Pct < -thresh {
                improvements = append(improvements,
                    fmt.Sprintf("%s/%s %.1f%% (p=%.3f)", row.Name, metric, delta.Pct, delta.P))
            }
        }
    }

    fmt.Println("## Performance Report")
    if len(improvements) > 0 {
        fmt.Println("\n### Improvements")
        for _, i := range improvements {
            fmt.Println("- " + i)
        }
    }
    if len(regressions) > 0 {
        fmt.Println("\n### Regressions")
        for _, r := range regressions {
            fmt.Println("- " + r)
        }
        return fmt.Errorf("%d regressions detected", len(regressions))
    }
    return nil
}
```

The tool returns a non-zero exit code on regressions; that fails the CI step.

## Appendix D — Storing baselines: tradeoffs

Three baseline-storage strategies:

### A: Git-tracked file

```
perf/baseline.txt  (committed)
```

Pros: reviewable, auditable, version-controlled with the code.

Cons: requires manual updating (or a bot); the file grows with each benchmark added.

Best for: small teams (< 20 engineers), stable benchmark suite.

### B: S3 / artifact store with branch keys

```
s3://perf-baselines/main.txt
s3://perf-baselines/release-v2.txt
```

Pros: automatic on every main-branch merge, multiple parallel baselines.

Cons: requires S3 setup, retention policy, secrets management.

Best for: medium teams, multiple long-lived branches.

### C: Time-series database

```
InfluxDB / Prometheus pushing benchmark results as time series.
```

Pros: historical trends, dashboards, anomaly detection, queryable.

Cons: complex setup, needs a server.

Best for: large teams with dedicated perf infrastructure.

Choose based on team size and complexity tolerance. Start with A; graduate to B; consider C only when you have a dedicated perf engineer.

## Appendix E — Performance review etiquette

When reviewing a PR that includes perf claims:

- **Ask for the methodology, not just the numbers.** "How did you run it? On what machine? With `-count` what?"
- **Verify the change is isolated.** "Is this the only change in the PR, or are there refactors that affect performance independently?"
- **Ask about allocations.** "What does `allocs/op` look like?"
- **Ask about parallel behaviour.** "Did you run `b.RunParallel`?"
- **Ask about production confirmation.** "Will we see this in production telemetry?"
- **Be skeptical of huge wins.** "30 % is a lot. Are you sure the work isn't being eliminated?"
- **Be tolerant of small wins.** "2 % with `p=0.001` and `n=30` is real; do not block on the size alone."

The goal of perf review is not to gatekeep. It is to ensure the team's perf data is reliable. A merged regression that nobody catches is a debt that compounds.

## Appendix F — Long-running benchmark suites

Some benchmarks take minutes per run. With `-count=10`, that is hours of CI time per PR. Strategies:

- **Run heavy benchmarks on a schedule, not per-PR.** Hourly or daily.
- **Per-PR run a "fast subset"** — selected light benchmarks.
- **Tag heavy benchmarks** with a build tag (`//go:build heavy`). Run only when needed.
- **Sample randomly** — run 10 % of heavy benchmarks per PR, full suite weekly.

The trade-off: faster CI feedback vs. earlier detection of regressions. The right balance depends on how often heavy regressions happen in your codebase.

## Appendix G — Working with `perflock`

`perflock` (`golang.org/x/perf/cmd/perflock`) serialises benchmark runs on a shared machine. If two PRs hit the perf job simultaneously, they would otherwise interfere. `perflock` queues them.

```bash
# Wrap your bench command
perflock -governor performance -- taskset -c 4 go test -bench=. -count=10
```

`perflock` does two things:

1. Acquires a system-wide lock so only one perf job runs at a time.
2. Sets the CPU governor for the duration of the run, restoring afterwards.

Useful when you cannot afford one perf box per CI job and need to share.

## Appendix H — Production telemetry confirmation

The cycle does not end at merge. After a perf PR deploys:

1. Watch the relevant Prometheus / Datadog metrics for one full traffic cycle (usually 1 week).
2. Compare p50, p99, p99.9 latency for the operation that the benchmark measured.
3. Compare GC pause time, allocation rate, RSS.
4. Compare error rates (changes that improve performance sometimes worsen correctness).

If the benchmark predicted 20 % improvement and production shows 1 %, investigate. Most often the cause is: the benchmark's input or call pattern differs from production. Fix the benchmark to be more representative; document the discrepancy.

If telemetry agrees, celebrate quietly and move on.

If telemetry shows a regression where the benchmark showed improvement, *that is a problem*. The change shipped, the benchmark is wrong, and production is suffering. Roll back, investigate.

## Appendix I — Closing thought

Performance as a *gated property of the codebase* is a different cultural posture than performance as *something we measure when we worry*. The professional shift is the former. It requires:

- Dedicated infrastructure.
- A CI gate.
- A baseline format.
- A review etiquette.
- A connection to production telemetry.

It is more work than ad-hoc benchmarking. It also catches regressions that ad-hoc benchmarking misses. For services where performance matters (which is most), the investment pays back many times over.

The professional engineer's job is to make this infrastructure exist, work reliably, and produce results the team trusts. Once it is in place, performance becomes mundane — the same kind of property as correctness or security, tested by CI, gated on PRs, and forgotten until a gate fails. That is the goal.
