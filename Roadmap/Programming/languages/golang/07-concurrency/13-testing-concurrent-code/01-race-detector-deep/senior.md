# Race Detector Deep Dive — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Pipeline Design for `-race`](#pipeline-design-for--race)
3. [Sharding Race Jobs](#sharding-race-jobs)
4. [Race-Only Test Suites](#race-only-test-suites)
5. [Catching Rare Races Reliably](#catching-rare-races-reliably)
6. [Production Sampling Strategy](#production-sampling-strategy)
7. [Halt-On-Error and Crash-Loop Policies](#halt-on-error-and-crash-loop-policies)
8. [Working With Build Caches](#working-with-build-caches)
9. [Race Detector on Container Builds](#race-detector-on-container-builds)
10. [Reproducing Reports from CI](#reproducing-reports-from-ci)
11. [Multi-Module Repositories](#multi-module-repositories)
12. [Race Reports and Metrics](#race-reports-and-metrics)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At middle level you wired `-race` into one CI job and a single Makefile target. At senior level you treat the race detector as a piece of infrastructure: it has cost, latency, reliability, and observability requirements. You design the pipeline so race jobs finish quickly enough to gate every PR; you shard tests across runners so a multi-package codebase still completes in minutes; you accept that race detection is a probabilistic tool and design experiments (nightly stress, soak tests, scheduler variation) to push the probability of catching rare races as close to one as possible.

After this file you will:

- Architect a CI pipeline where race detection runs on every PR without becoming the bottleneck.
- Shard the test suite across N runners and aggregate reports.
- Run race-only test suites that complement the unit suite.
- Design stress and soak experiments that turn 0.1%-per-run races into nearly-certain catches.
- Make informed decisions about running `-race` in production (you almost never should — but the exceptions are interesting).
- Handle build-cache invalidation when teams mix race and non-race builds.
- Reproduce a race seen in CI on a developer laptop in a few minutes.
- Manage `-race` across a multi-module monorepo.

This file does not yet cover TSan internals (professional) or specification-level guarantees (specification). It is the practical architecture layer.

---

## Pipeline Design for `-race`

A mature pipeline has at least three flavours of race-aware jobs:

| Job | Trigger | What it does |
|---|---|---|
| `test-fast` | every PR commit | `go test -count=1 ./...` without `-race`; quick correctness signal. |
| `test-race` | every PR commit | `go test -race -count=1 ./...`; the real race gate. |
| `stress-race` | nightly cron | `go test -race -count=N -run TestStress` with high repetition. |
| `soak-race` | optional, weekly | Race-instrumented binary running a synthetic workload for hours. |

The `test-race` job is the merge gate. The other two are early-warning systems.

### Latency budgets

Aim for these times:

- `test-fast`: under 2 minutes.
- `test-race`: under 10 minutes.
- `stress-race`: 30–60 minutes overnight.

If `test-race` is creeping over 10 minutes, shard it (next section). Above 10 minutes, developers stop trusting it and bypass it; the gate becomes social, not technical.

### Job dependencies

```
PR commit ---> test-fast (block on)
                  +---> test-race (block on)
                  +---> lint, vet, build (block on)
```

`test-race` runs in parallel with `test-fast`. Merging requires both to be green. Re-runs are cheap because the build cache is warm.

### Failure ergonomics

When `test-race` fails:

- The race report should be the **last** thing in the log (use `halt_on_error=1`).
- The exact `go test` command should be in the log header for one-line reproduction.
- The artifact uploader should grab `race-report.*` files if any.
- A bot may auto-comment the report on the PR.

Make failure information friction-free. Engineers will not investigate races buried under thousands of log lines.

---

## Sharding Race Jobs

A monorepo with 200 packages and 30 minutes of race-test runtime is too slow for PR gating. Shard:

### Static sharding by package

Split packages into N groups at config time:

```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: |
      packages=$(go list ./... | awk 'NR%4==${{ matrix.shard }}-1')
      go test -race -count=1 -timeout 10m $packages
```

Four parallel runners, each runs a quarter of the suite. Total wall time drops to roughly 1/N.

### Dynamic sharding by test discovery

Use a tool that runs a discovery pass, sorts tests by historical duration, then distributes them across runners (bin-packing). Tools: `gotestsum`, `go test -json` plus a custom splitter, or commercial CI features (Buildkite test analytics, GitHub Actions `matrix`).

### Per-package vs per-test sharding

| Strategy | Pros | Cons |
|---|---|---|
| Per-package | Simple; respects test setup. | Uneven if one package dominates. |
| Per-test | Even load. | Build cache misses, more harness setup. |

Most teams start per-package and move to per-test once one package becomes the long pole.

### Aggregating reports

Each shard produces its own race report (if any). The CI should:

- Mark the job failed if any shard fails.
- Concatenate or list each shard's race reports.
- Show the first failing shard prominently.

A common helper script:

```bash
#!/bin/bash
set -e
for shard in $(seq 1 4); do
  if [ -f "race-report.shard-$shard.txt" ]; then
    echo "=== Shard $shard ==="
    cat "race-report.shard-$shard.txt"
  fi
done
```

---

## Race-Only Test Suites

Some tests are too slow or too dependent on real concurrency to run on every PR. Group them under a build tag:

```go
//go:build race_only

package mypkg_test

import "testing"

func TestLongConcurrentScenario(t *testing.T) {
	// 1000 goroutines, 10s of operations
}
```

Run only with:

```bash
go test -race -tags=race_only -count=1 -timeout 30m ./...
```

The tag opts these tests into a separate CI job — usually nightly. Developers can run them locally on demand. They are exempt from PR gating.

### Why a separate suite?

- Avoids 30-minute PR feedback loops.
- Lets you run with higher iteration counts.
- Allows expensive setup (large data, simulated network).
- Catches races that need long observation windows.

---

## Catching Rare Races Reliably

A race that fires once in 1,000 runs is invisible to PR gates. Strategies to push it into view:

### Strategy 1: Increase iterations

```bash
go test -race -count=1000 -run TestRareRace -failfast ./pkg
```

1000 runs, exit on first fail. If the race fires 1/1000, expected one failure per run.

### Strategy 2: Vary `GOMAXPROCS`

```bash
for procs in 1 2 4 8; do
  GOMAXPROCS=$procs go test -race -count=100 -run TestRareRace ./pkg
done
```

Different scheduler regimes expose different races. `GOMAXPROCS=1` catches cooperative races; high values catch true-parallelism races.

### Strategy 3: Tickle the scheduler

```go
import "runtime"

func tickle(t *testing.T) {
	t.Helper()
	for i := 0; i < 100; i++ {
		runtime.Gosched()
	}
}
```

Insert `tickle(t)` between potentially-racy operations to widen the window. Use only in tests.

### Strategy 4: Use `testing/synctest` (Go 1.24+)

`synctest.Run` makes time and goroutine scheduling deterministic, allowing precise reproduction of interleavings. See `02-deterministic-testing`.

### Strategy 5: Replay-based testing

For protocol code, capture an execution trace and replay it under `-race`. Useful for distributed-system unit tests.

### Strategy 6: Halt-and-bisect

If a race fires occasionally on `main`, `git bisect` it. Combine with a stress harness:

```bash
git bisect run sh -c 'go test -race -count=100 -run TestRare -failfast ./pkg'
```

`bisect run` will narrow to the commit that introduced the race.

---

## Production Sampling Strategy

Running `-race` in production is usually a bad idea. Sampling is the rare exception.

### When sampling might be justified

- A race manifests only under real traffic patterns.
- Repro in CI is impossible.
- The cost of one bad request matters more than 10x latency on a sampled instance.

### How to sample

- Run **one** canary instance with `-race`.
- Send it 0.1% of traffic.
- Wire its stderr to a log aggregator with alerting on "WARNING: DATA RACE".
- Limit blast radius: separate database read-replica, no writes, restricted permissions.

### Why this is dangerous

- A race binary is 5–15x slower; if any caller times out, you create cascading failures.
- A race-instrumented binary uses 5–10x more memory; container limits may kill it.
- The race detector is a debugging tool, not a production runtime. Bugs in TSan itself can crash your canary.

Almost always, the right answer is "reproduce with stress tests, not production sampling."

---

## Halt-On-Error and Crash-Loop Policies

`GORACE=halt_on_error=1` causes the process to exit on the first race. In CI this is what you want. In a long-running development environment it can be annoying.

### CI: always halt

```bash
GORACE="halt_on_error=1" go test -race ./...
```

### Local: dont halt during interactive debugging

```bash
GORACE="halt_on_error=0" go run -race ./cmd/server
```

You see multiple reports as you exercise the running server. Set `halt_on_error=1` when you want exact reproduction.

### Crash-loop guard

If a developer accidentally deploys a race binary that crashes on a frequent race, the orchestrator will restart it in a loop. Defensive measures:

- Tag race binaries clearly (binary name suffix `-race`).
- Refuse to deploy `-race` binaries to production from CI.
- Add a startup check in your code: panic loudly if `runtime/race` is enabled in production:

```go
//go:build race

package main

func init() {
	if os.Getenv("ENVIRONMENT") == "production" {
		panic("race-instrumented binary running in production")
	}
}
```

The build tag means the check exists only in race binaries.

---

## Working With Build Caches

`-race` builds use a different cache key than non-race builds. Go handles this automatically:

```
$GOCACHE/-race-...   <-- race instrumented objects
$GOCACHE/-normal-... <-- regular objects
```

But subtle issues arise:

### Issue 1: Disk pressure

Doubled cache size. On CI runners with small disks, `$GOCACHE` may fill up. Periodically run `go clean -cache` or size the cache directory generously.

### Issue 2: Cache misses on flag flips

Switching between `go test ./...` and `go test -race ./...` causes a partial recompile. The objects exist in both caches but cross-cache misses still trigger linker work. Keep race and non-race builds in separate workflows.

### Issue 3: Distributed caches

`bazel` and similar tools require explicit tagging for race builds. Make sure your `BUILD` files distinguish `cgo`, `race`, and normal builds.

---

## Race Detector on Container Builds

Building a race-instrumented binary inside Docker:

```dockerfile
FROM golang:1.22 AS builder
WORKDIR /src
COPY . .
RUN go build -race -o /out/app ./cmd/server

FROM debian:bookworm-slim
COPY --from=builder /out/app /usr/local/bin/app
ENTRYPOINT ["/usr/local/bin/app"]
```

Caveats:

- The race detector requires libc symbols at runtime. The final stage cannot be `scratch` or `distroless/static`. Use `distroless/base` or a glibc-based image.
- Race binaries are bigger; container layers grow.
- Use only for development environments. Tag the image clearly (`myapp:0.5.0-race`).

### Alpine and musl

Alpine uses musl libc. The race detector has limited or no support on musl in many Go versions. Test before relying on it. If musl-incompatibility appears, switch the builder image to a glibc-based one and the final image to debian-slim.

---

## Reproducing Reports from CI

A flake fires in CI; you want to reproduce locally. Procedure:

### 1. Capture the exact command

The CI log should print:

```
+ GORACE="halt_on_error=1 history_size=2" go test -race -count=1 -timeout 5m ./internal/queue/
```

Copy this verbatim. Reproduce in your terminal.

### 2. Capture the commit SHA

Always reproduce against the same commit. If CI tested `abc1234`, run:

```bash
git checkout abc1234
```

### 3. Iterate to reproduce

Rarely will the race fire on the first try. Use:

```bash
GORACE="halt_on_error=1" go test -race -count=100 -run TestFlaky -failfast ./internal/queue/
```

### 4. Vary `GOMAXPROCS`

```bash
for p in 1 2 4 8; do GOMAXPROCS=$p go test -race -count=50 -run TestFlaky ./internal/queue/; done
```

### 5. If still no repro, instrument

Add `runtime.Gosched()` calls between suspicious operations. Try harder schedulers (`GODEBUG=schedtrace=1000`).

### 6. Once repro is reliable

Fix the bug. Verify fix by running the same stress loop 1,000 times. If green, ship.

---

## Multi-Module Repositories

A repo with multiple `go.mod` files needs explicit per-module race jobs:

```bash
#!/bin/bash
set -e
for module in $(find . -name go.mod -execdir pwd \;); do
  (cd "$module" && go test -race -count=1 -timeout 5m ./...)
done
```

In CI, run modules in parallel matrix jobs:

```yaml
strategy:
  matrix:
    module:
      - ./
      - ./submodule/api
      - ./submodule/internal
steps:
  - run: |
      cd ${{ matrix.module }}
      go test -race -count=1 ./...
```

Each module has its own race signal. A monorepo with 10 modules can run all races in 10 parallel jobs, each finishing in a couple of minutes.

---

## Race Reports and Metrics

When you treat `-race` as infrastructure, you measure it:

- Number of race reports per CI run, plotted over time.
- Time-to-detect new races (commit-to-failure delay).
- Time-to-fix (failure-to-merge-of-fix).
- Flakiness rate: how often a race fires per N runs in stress jobs.

Dashboards: a per-week trend of "races detected" lets you see whether the rate is climbing (people writing more concurrent code) or falling (better discipline).

### Quarantine and triage

When a known race fires repeatedly while a fix is in flight:

- Tag the test with `// FLAKY: race in #1234`.
- Skip it conditionally:

```go
if os.Getenv("SKIP_FLAKY_1234") == "1" {
    t.Skip("flaky, see #1234")
}
```

- Have a weekly review of the quarantine list. Anything older than two weeks is a release blocker.

Never silently skip. Always reference the bug.

---

## Self-Assessment

- [ ] I can design a CI pipeline that runs race tests on every PR within 10 minutes.
- [ ] I know how to shard race jobs across N runners.
- [ ] I can write a race-only test suite under a build tag.
- [ ] I have strategies for catching races that fire 1 in 1,000 runs.
- [ ] I understand the cost and risk of running `-race` in production.
- [ ] I can reproduce a CI race report on my laptop in under 10 minutes.
- [ ] I can handle race testing across a multi-module monorepo.
- [ ] I track race-detection metrics over time.
- [ ] I have a triage process for newly-discovered races.

---

## Summary

At senior level the race detector is no longer just a flag; it is a piece of CI infrastructure with its own latency budget, sharding strategy, stress-test variants, and metrics. You design the pipeline so race detection gates every PR within a small wall-time budget, you build nightly stress jobs to expose rare races, you keep race-only suites for expensive scenarios, and you have a documented procedure for reproducing CI races on a laptop. You almost never run `-race` in production; when you do, it is a tightly controlled canary. Across a multi-module repo, race detection is just another matrix dimension, and the team tracks race-detection trends as a quality indicator.
