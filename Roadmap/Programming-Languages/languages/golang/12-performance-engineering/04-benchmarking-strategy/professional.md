# Benchmarking Strategy — Professional

## 1. The production framing

In a real engineering organization, benchmarks are not a thing you write for one PR and forget. They are an operational asset: a tracked, versioned, automated signal that catches regressions before customers do. The professional job, roughly:

1. **Curate a benchmark suite** for each performance-sensitive package, sized so the whole suite finishes in minutes, not hours.
2. **Run the suite on every PR** and on every merge to `main`, with results stored and trended.
3. **Detect regressions** via `benchstat` with a defined threshold and surface them in code review.
4. **Stabilize the runner** so noise doesn't drive false positives. This usually means dedicated hardware or aggressive governor pinning on a known-good CI host.
5. **Track absolute numbers over time** so slow drift (1% per release × 20 releases = 22% slower) is visible.
6. **Wire alerts** for severe regressions on `main` (post-merge) — the merge happened, but the on-call should know.

The rest of this file is what that looks like.

---

## 2. What to put in a tracked suite

A benchmark suite is not "every `Benchmark*` in the repo". A tracked suite is a small set of *representative* benchmarks where:

- The function is on a documented hot path (validated by `pprof` from production).
- The input shape reflects production traffic (size, distribution, randomness).
- The benchmark runs in under 30 seconds at `-count=10 -benchtime=1s`.
- The variance is under 5% on the runner.

A typical tracked suite for a mid-sized service is 10–40 benchmarks. The full repo may have 200 — most of them ad-hoc, only some tracked.

Convention: tag tracked benchmarks with a build tag or a name prefix.

```go
//go:build bench

func BenchmarkHotpath_RouteRequest(b *testing.B) { /* ... */ }
```

Or, by name:

```go
func BenchmarkTracked_RouteRequest(b *testing.B) { /* ... */ }
```

Then in CI: `go test -bench='^BenchmarkTracked_' -count=10 -run=^$ ./...`.

---

## 3. The CI workflow

A complete GitHub Actions job for benchmark comparison on PRs:

```yaml
name: bench
on: pull_request

jobs:
  benchmark:
    runs-on: [self-hosted, bench-runner]   # dedicated host
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'

      - name: install benchstat
        run: go install golang.org/x/perf/cmd/benchstat@latest

      - name: bench base
        run: |
          git checkout ${{ github.event.pull_request.base.sha }}
          go test -bench='^BenchmarkTracked_' -benchmem \
            -count=10 -benchtime=1s -run=^$ \
            ./... | tee .bench/base.txt

      - name: bench head
        run: |
          git checkout ${{ github.event.pull_request.head.sha }}
          go test -bench='^BenchmarkTracked_' -benchmem \
            -count=10 -benchtime=1s -run=^$ \
            ./... | tee .bench/head.txt

      - name: compare
        run: |
          benchstat .bench/base.txt .bench/head.txt | tee .bench/diff.txt

      - name: post comment
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          path: .bench/diff.txt
```

Two non-obvious decisions here:

- **Self-hosted bench runner.** GitHub-hosted runners share hardware; variance is too high (>10%) for reliable regression detection. A modest dedicated VM or bare-metal node with `perflock` and a pinned governor pays for itself in week one.
- **Order matters.** Bench the base commit first, then head. If you bench head and find a regression, you cannot retroactively bench base on the same warmed-up runner; the variance changes.

---

## 4. Stabilizing the runner

Without stable hardware, the entire pipeline is theatre. A reference setup for a Linux bench runner:

```bash
# CPU governor
sudo cpupower frequency-set -g performance

# Disable turbo (intel)
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo

# Disable hyperthreading siblings on benchmark cores
for cpu in /sys/devices/system/cpu/cpu{8..15}/online; do
    echo 0 | sudo tee "$cpu"
done

# Stop background daemons
sudo systemctl stop snapd packagekit fwupd

# Lock memory frequency, kernel.numa_balancing=0 if NUMA
echo 0 | sudo tee /proc/sys/kernel/numa_balancing
```

Pair with `perflock` to serialize and isolate runs:

```bash
perflock -governor=performance -cpu=2,3 -- \
    go test -bench=. -count=10 -benchtime=2s -run=^$ ./...
```

`perflock` ensures two concurrent CI jobs don't fight over the same CPUs, and it temporarily sets the governor so a misconfigured machine still produces stable numbers.

With this setup, a typical microbenchmark on dedicated hardware has 0.3–1% variance. Without it, the same code on a shared cloud VM is 5–15%.

---

## 5. Regression thresholds

Once you have stable numbers, decide what counts as a regression. A common policy:

| Delta | Action |
|-------|--------|
| `~` (no significant change) | Pass silently. |
| `p < 0.05` and ≤ +3% | Pass, but show in PR. |
| `p < 0.05` and +3% to +10% | PR comment, require acknowledgment. |
| `p < 0.05` and > +10% | Block merge, require explicit override. |

Implement with a small script:

```bash
#!/usr/bin/env bash
# fail if any benchmark regressed > 10%
set -euo pipefail

benchstat -format csv base.txt head.txt > diff.csv

awk -F, '
    NR > 1 && $4 ~ /[+]/ {
        gsub(/[+%]/, "", $4)
        if ($4+0 > 10) {
            print "REGRESSION: " $1 " " $4 "%"
            exit_code = 1
        }
    }
    END { exit exit_code+0 }
' diff.csv
```

The threshold is a policy decision. For an SLO-bound service, 3% may be too generous. For a research library where ergonomics matters more than the last cycle, 20% may be fine. The number should be on a wiki, not in code review folklore.

---

## 6. Storing history

A PR comparison is point-in-time. The drift over six months — "the service got 22% slower since v2.0" — needs a different infrastructure.

Two approaches:

**Push to a time-series store.** On every merge to `main`, run the tracked suite and POST the parsed results to InfluxDB / Prometheus / a tiny SQLite file in S3:

```go
type BenchResult struct {
    Commit    string
    Timestamp time.Time
    Name      string
    NsPerOp   float64
    BPerOp    int64
    AllocsPerOp int64
}
```

Plot `NsPerOp` over time per benchmark. Slow drift becomes immediately visible.

**Use `benchstat` over historical archives.** Keep every merge-to-main bench output in git LFS or object storage:

```
.bench-history/
    2024-01-15-a1b2c3d.txt
    2024-01-16-e4f5g6h.txt
    ...
```

A nightly job runs `benchstat <last-30-days>` to surface multi-day trends `benchstat`-style. Visual but lower-fidelity than a TSDB.

The first scales better; the second is cheaper to set up.

---

## 7. Profile-guided benchmarks

Once you have CPU profiles from production (via continuous profiling — Pyroscope, Parca, Google Cloud Profiler, or periodic `/debug/pprof/profile`), you can derive what benchmarks to *write*. The workflow:

1. Pull a representative production CPU profile.
2. `go tool pprof -top` it. The top 20 functions account for, say, 70% of CPU.
3. For each of those functions, write a benchmark with input shaped like production calls.

This is the inverse of the usual "I optimized a thing; here's a microbench". You start from production, profile down to functions, and *only then* write benchmarks. The benchmarks that drive the most production wins are produced this way.

Bonus: Go 1.20+ supports **PGO** (profile-guided optimization) via `-pgo=profile.pprof`. Your benchmarks should be PGO-aware:

```bash
# Build with PGO
go test -bench=. -pgo=prod.pprof ./...
```

Without PGO matching, your local bench will measure non-PGO code paths while production runs PGO-optimized binaries. That's a 5–15% systematic difference in some workloads.

---

## 8. Catching allocation regressions specifically

A PR can keep `ns/op` flat while doubling `allocs/op`. Under benchmark load that doesn't matter; under real load with active GC, the GC CPU rises and tail latencies grow. Treat alloc count as a separately tracked metric:

```bash
# Extract allocs/op for each benchmark
benchstat -col Allocs old.txt new.txt
```

```
                old allocs/op    new allocs/op    delta
BenchmarkRoute  12.0 ± 0%        24.0 ± 0%      +100.00%  (p=0.000 n=10+10)
```

A +100% alloc delta with `~` for time is *still a regression*. The CI guard should check both:

```bash
benchstat -col Time old.txt new.txt > time.txt
benchstat -col Allocs old.txt new.txt > allocs.txt

check_regression "Time"   time.txt   10
check_regression "Allocs" allocs.txt 20
```

---

## 9. Microbench-only optimization is a trap

A common professional failure: the PR is "BenchmarkX got 30% faster, ship it!" But:

- The function was 0.3% of CPU. The 30% improvement is 0.09% on the whole service.
- The change added complexity (manual unrolling, unsafe pointers, removed validation).
- Production has different cache behavior. The win evaporates.

The discipline:

1. **Always quote the production-CPU share** of the optimized function. "Got 30% faster; this function is 12% of request CPU, so net 3.6% latency improvement expected."
2. **Validate after deploy**. A canary at 1% traffic, profiled, compared against the previous version. If the predicted gain doesn't materialize, the bench was wrong — investigate before rolling out.
3. **Require a justification for "clever" code.** A 5% gain via a one-line `strings.Builder` change is fine. A 5% gain via `unsafe.Pointer` arithmetic needs three reviewers and a comment block explaining the assumptions.

Microbench wins that don't show up in service-level metrics are the most expensive code change you can make: complexity without ROI.

---

## 10. The "bench in production" hybrid

Some teams ship a benchmark binary alongside the service and run it on canaries:

```go
// cmd/benchprod/main.go
package main

import (
    "encoding/json"
    "os"
    "testing"

    "example.com/svc/internal/router"
)

func BenchmarkRoute(b *testing.B) {
    r := router.New()
    for i := 0; i < b.N; i++ {
        r.Route("/users/42")
    }
}

func main() {
    result := testing.Benchmark(BenchmarkRoute)
    json.NewEncoder(os.Stdout).Encode(map[string]any{
        "ns_per_op": result.NsPerOp(),
        "allocs_per_op": result.AllocsPerOp(),
    })
}
```

The CI bench measures the build on a controlled runner. The production bench measures the same code on production hardware (which may differ in CPU model, NUMA topology, kernel version). A weekly run that diffs the two is a useful signal — "the CI runner says we're 5% faster, but production hardware shows no change" usually means the optimization is microarchitecture-specific.

---

## 11. Alert on post-merge regressions

PR-time benchmarks catch regressions before merge. Post-merge benchmarks catch regressions that snuck through (e.g., a config flag that flipped, a dependency update). A small post-merge job:

```yaml
on:
  push:
    branches: [main]

jobs:
  bench:
    runs-on: [self-hosted, bench-runner]
    steps:
      - run: go test -bench='^BenchmarkTracked_' -count=10 -run=^$ ./... | tee bench.txt
      - run: |
          benchstat last-known-good.txt bench.txt > diff.txt
          if grep -q '+1[0-9]\.' diff.txt; then
              curl -X POST -d @diff.txt $SLACK_WEBHOOK
          fi
          cp bench.txt last-known-good.txt
```

The pager should ring for a >10% regression, not a 1% one. Alert fatigue is the enemy.

---

## 12. Benchmark hygiene in code review

Things to check in any PR that touches a tracked benchmark:

- Does the benchmark still measure the intended thing? A refactor often moves work in/out of the loop.
- Does `b.ResetTimer` happen *after* setup?
- Is there a sink or `b.Loop()` for non-trivial returns?
- Is `-benchmem` used where allocations matter?
- For new benchmarks: is the input shape documented and realistic?
- Did the author run `benchstat` locally and include the output in the PR description?

A team convention: every PR that changes a benchmark must include the `benchstat` output in the description. The reviewer compares it against the CI's run.

---

## 13. Common professional anti-patterns

| Anti-pattern | What goes wrong |
|--------------|----------------|
| Running benchmarks on shared CI runners | Variance too high; false positives drive distrust. |
| `-count=1` in CI | Single sample is noise; conclusions are guesses. |
| Tracking only `ns/op` | Allocation regressions slip through. |
| Bench suite takes 45 minutes | Developers stop running it; the safety net rusts. |
| One benchmark per PR | Drift across non-tracked code is invisible. |
| No production profile to anchor benchmarks | Optimizing functions that aren't on the hot path. |
| Comparing against an old `baseline.txt` checked in months ago | Hardware drift, compiler updates; comparison meaningless. |
| Treating `benchstat ~` as "good enough" | Many small `~` deltas sum to a real regression. |

---

## 14. Summary

Production benchmarking is an automated pipeline: tracked suite, dedicated runner, PR-time `benchstat`, history store, threshold-based alerts. The hardware-and-stability problem is half the battle; the curation-and-policy problem is the other half. Anchor benchmarks in production profiles, gate on both time and allocations, and treat microbench-only wins as suspicious until validated post-deploy.

---

## Further reading
- `perflock`: https://github.com/aclements/perflock
- Go PGO guide: https://go.dev/doc/pgo
- Pyroscope continuous profiling: https://pyroscope.io
- Google Cloud Profiler: https://cloud.google.com/profiler
- `benchstat` advanced usage: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- `golang.org/x/perf/benchproc` (for custom analysis): https://pkg.go.dev/golang.org/x/perf/benchproc
