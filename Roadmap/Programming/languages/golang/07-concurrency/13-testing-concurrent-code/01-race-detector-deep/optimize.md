# Race Detector Deep Dive — Optimisation

## Table of Contents
1. [Why Optimise Race Testing](#why-optimise-race-testing)
2. [Where the Time Goes](#where-the-time-goes)
3. [Sharding](#sharding)
4. [Test Selection](#test-selection)
5. [Build Caching](#build-caching)
6. [Reducing `history_size` for Speed](#reducing-history_size-for-speed)
7. [Skipping Race-Irrelevant Tests](#skipping-race-irrelevant-tests)
8. [Layered Pipelines](#layered-pipelines)
9. [Race-Aware Test Design](#race-aware-test-design)
10. [Sampling vs Full Coverage](#sampling-vs-full-coverage)
11. [Memory Footprint](#memory-footprint)
12. [CI Runner Sizing](#ci-runner-sizing)
13. [Summary](#summary)

---

## Why Optimise Race Testing

The race detector is the most valuable concurrency tool in the Go toolchain — but it is also the slowest. A test suite that runs in 30 seconds without `-race` may take 5 minutes with it. On large monorepos, race tests can stretch to 30 or 60 minutes, at which point developers start bypassing them. The point of this file is keeping the gate fast enough that the team stays inside it.

The goals:

- Keep PR-blocking race jobs under 10 minutes.
- Keep nightly stress jobs under 60 minutes.
- Keep CI compute costs proportional to the value gained.
- Keep developer-laptop race runs under 1 minute for the package they are working on.

---

## Where the Time Goes

In a race test run, time is consumed by:

1. **Compilation.** Race-instrumented compilation is slower because the compiler inserts instrumentation code at every memory access. Typically 1.5–2x normal compile time.
2. **Linking.** The race runtime adds about 5 MB to the binary; linking is marginally slower.
3. **Execution.** Each instrumented memory access takes a function call. Tight loops with many memory accesses run 5–15x slower.
4. **Reporting.** When a race fires, symbolisation is slow (single-threaded path through the runtime). Halting on the first error reduces reporting time on failing runs.
5. **Test discovery and setup.** `go test` overhead per package (init, harness setup) is amortised over tests; with many small packages, this overhead dominates.

For a typical Go service with a few hundred tests, execution dominates. Optimisation usually means parallelising execution (sharding) or reducing the number of tests run per PR.

---

## Sharding

The single most effective optimisation. Splitting tests across N parallel runners cuts wall-clock time by roughly 1/N, at the cost of N times the compute.

### Per-package sharding (simplest)

```bash
packages=$(go list ./... | awk -v s=$SHARD -v n=$SHARD_COUNT 'NR % n == s - 1')
go test -race -count=1 -timeout 10m $packages
```

Works for any list-able package set. Run N copies of the CI job, each with `SHARD=1..N` and `SHARD_COUNT=N`.

### Stable hash sharding (reproducible)

For deterministic assignment that survives package additions:

```bash
go list ./... | awk -v s=$SHARD -v n=$SHARD_COUNT '{
  h = 0
  for (i = 1; i <= length($0); i++) h = (h * 31 + index("abcdefghijklmnopqrstuvwxyz", substr($0, i, 1))) % n
  if (h == s - 1) print
}' > shard.txt
go test -race -count=1 -timeout 10m $(cat shard.txt)
```

Each package always lands on the same shard, regardless of insertion order. Useful if you cache test results per shard.

### Test-level sharding

When one package dominates wall time:

```bash
go test -list '.*' ./large/package > all-tests.txt
# Distribute test names across shards, then run with -run.
shard_tests=$(awk -v s=$SHARD -v n=$SHARD_COUNT 'NR % n == s - 1' all-tests.txt | paste -sd'|' -)
go test -race -count=1 -run "^($shard_tests)\$" ./large/package
```

Gets even load even when one package has 80% of the runtime.

### Tooling

- `gotestsum` — supports JSON output and parallel runners.
- `pterodactyl`, `go test -json` plus a custom splitter.
- Buildkite/GitHub Actions matrix features for distribution.

### Aggregating results

When sharding, ensure CI marks the overall job failed if any shard fails. Aggregate race reports for visibility:

```bash
for f in race-report.*.txt; do echo "--- $f ---"; cat "$f"; done
```

---

## Test Selection

Not every test must run on every PR. Two strategies:

### 1. Affected packages only

A PR touching `internal/queue/*` does not need to run race tests in `internal/auth/*` if they have no transitive dependency.

```bash
# Find packages that import the changed packages, transitively.
changed=$(git diff --name-only origin/main | sed 's|/[^/]*$||' | sort -u)
affected=$(go list -deps $(go list ./...) | grep -Fx "$changed")
go test -race $affected
```

Trade-off: less coverage per PR, but quicker feedback. Pair with a nightly job that runs *all* race tests.

### 2. Test cache

If `go test` cache is intact between runs and only one package changed, only that package is re-tested. But `-count=1` defeats the cache. The trade-off: re-running cached tests catches races on the same code under different schedules, which is valuable. Most teams keep `-count=1`.

A middle ground: cache the *first* run of each test, but require `-count=N` for stress jobs.

---

## Build Caching

`-race` builds use a separate cache key from non-race builds. Make sure `$GOCACHE` has enough space — race objects are bigger.

### Tips

- Pre-warm the cache in your CI base image: build all packages with `-race` once at image build time, save the cache.
- Use a shared cache volume across CI runners (with care for concurrent access).
- Run `go test -race` rather than `go test` then `go test -race` separately: separate runs each pay for their cache miss.

### Avoid

- Running `go clean -cache` unnecessarily between runs.
- Switching back and forth between `-race` and non-race in the same job.
- Disk-pressure-driven cache eviction during a run.

---

## Reducing `history_size` for Speed

`GORACE=history_size=N` controls per-goroutine history depth. Higher values trade memory and a tiny CPU bump for better stack traces in reports.

For CI:

- `history_size=1` (default): smallest memory, sometimes incomplete reports.
- `history_size=2`: small bump, useful for most CI.
- `history_size=7`: full history, recommended only when you are actively investigating a hard race.

Most teams set `history_size=2` in CI: minor memory cost, no measurable CPU cost, better reports when races fire.

---

## Skipping Race-Irrelevant Tests

Pure-CPU tests with no goroutines do not need `-race`. But Go does not allow opting out at the test level once the binary is race-built; the instrumentation is global.

The practical workaround: split tests into two suites by build tag.

```go
//go:build !race

func TestPureMath(t *testing.T) { ... }
```

Runs only without `-race`. The race job skips it. Saves CPU on the race job.

Caveat: most tests are not safe to skip from race builds. Default to including everything; only exclude when profiling shows a hot test is the long pole.

---

## Layered Pipelines

A mature pipeline separates concerns:

```
PR commit
  +-> fast tests (no -race)      ~30s  — instant feedback
  +-> race tests (sharded)       ~5m   — concurrency gate
  +-> lint, vet, build           ~1m   — style gate

Nightly cron
  +-> race stress (-count=50)    ~30m  — flakiness shaker
  +-> race long suite            ~60m  — race-tagged tests
  +-> soak test (1h workload)    ~60m  — long-running races
```

Each layer has a budget and a clear purpose. Failures at lower layers are blockers; failures at higher layers are early warnings.

---

## Race-Aware Test Design

Tests can be written to maximise the chance of catching races without bloating runtime:

### Design 1: Multiple workers in a single test

A single test that spawns N producers and M consumers is cheaper than N+M separate tests. Setup costs are amortised.

### Design 2: Use `t.Parallel()`

Tests marked `t.Parallel()` run concurrently. Combined with `-race`, you may surface races between tests that share global state (a common bug). Be careful — this can also mask races by changing the schedule.

### Design 3: Avoid `time.Sleep` for coordination

`time.Sleep` makes tests slow and flaky. Use channels and `sync.WaitGroup`. The total time spent under `-race` drops dramatically.

### Design 4: Bound goroutine counts

A test that spawns 100,000 goroutines under `-race` may run for minutes. 1,000 or 10,000 is usually enough to surface races. Bigger numbers add little.

### Design 5: Short loops in inner code paths

A test that loops 1,000,000 times in an inner function is paying 5–15x on every iteration. Use 10,000 or 100,000 unless you specifically need stress at higher numbers.

---

## Sampling vs Full Coverage

You can sample race tests:

- Run `-race` on only 10% of PR-triggered runs.
- Run full race tests on `main` after merge.
- Run nightly comprehensive race jobs.

This reduces per-PR CPU at the cost of letting some races into `main` briefly. Trade-off depends on team velocity.

Most teams prefer full coverage on PRs to keep `main` clean. Sampling is a fallback for resource-constrained teams.

---

## Memory Footprint

Race builds use 5–10x more memory. Implications:

### CI runners

A test that uses 200 MB without `-race` may use 1–2 GB with it. Size CI runners accordingly. Out-of-memory kills look like mysterious test failures.

### Container limits

If a Dockerised race build runs with a 512 MB memory limit, it will OOM. Set the limit to at least 4 GB for race builds.

### Large test data

A test that loads a 1 GB fixture into memory will use 5–10 GB under `-race`. Either reduce the fixture or skip the test on race builds.

### Monitoring

Track peak memory usage of CI race jobs. Sudden increases often indicate a memory leak under instrumentation (the leak is real, just amplified).

---

## CI Runner Sizing

Right-sizing CI runners for race jobs:

| Workload | CPU | Memory | Disk |
|---|---|---|---|
| Small service, ~50 packages | 2 vCPU | 4 GB | 20 GB |
| Medium service, ~200 packages | 4 vCPU | 8 GB | 40 GB |
| Large monorepo, sharded | 4 vCPU x N shards | 8 GB x N | 40 GB x N |

The bottleneck is usually CPU, then memory. Disk matters only for large `$GOCACHE`.

### Spot vs reserved instances

Race tests are deterministic enough that spot interruption is harmless (the job re-runs). Spot instances cut compute cost by 60–80%.

---

## Summary

Optimising race testing is mostly about parallelism and pipeline design, not micro-tuning the detector. Shard across N runners for nearly-linear speedup. Keep `history_size` low (1 or 2) for normal CI and high (7) only for active investigation. Layer pipelines so PR feedback is fast (<10 min), stress runs are nightly, and soak tests are weekly. Size runners with 5–10x more memory than non-race builds. Track race-job duration as a metric and keep it within budget; when it creeps over, add another shard. The detector itself is fixed-cost per memory access; almost all optimisation is at the test-orchestration layer.
