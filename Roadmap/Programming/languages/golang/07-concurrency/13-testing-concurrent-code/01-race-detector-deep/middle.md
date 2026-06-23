# Race Detector Deep Dive — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Running `-race` Effectively](#running--race-effectively)
3. [The `GORACE` Environment Variable](#the-gorace-environment-variable)
4. [Race-Only Build Tags](#race-only-build-tags)
5. [Race Detector and the Test Cache](#race-detector-and-the-test-cache)
6. [CI Integration Patterns](#ci-integration-patterns)
7. [Stress Testing Under `-race`](#stress-testing-under--race)
8. [Combining `-race` with `-timeout` for Deadlocks](#combining--race-with--timeout-for-deadlocks)
9. [Reading Race Reports at Scale](#reading-race-reports-at-scale)
10. [Mapping Reports to Synchronisation Bugs](#mapping-reports-to-synchronisation-bugs)
11. [Race Detector and cgo](#race-detector-and-cgo)
12. [Race Detector and `unsafe`](#race-detector-and-unsafe)
13. [Common Mistakes at Middle Level](#common-mistakes-at-middle-level)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

At junior level you learned to enable `-race`, read a report, and fix the obvious cases. At middle level you treat `-race` as a permanent member of your build and test infrastructure. The shift is from "I ran `-race` once" to "the entire team's PR pipeline gates on `-race` every push, with stress tests, halt-on-error, and short feedback loops."

After this file you will:

- Configure `-race` correctly across `go test`, `go build`, and `go run` for every workflow.
- Tune `GORACE` for CI vs local development.
- Combine `-race` with `-timeout` and `-count=N` for stress and stability runs.
- Add race-only build tags for assertion code that runs only when `-race` is on.
- Read a race report and immediately classify the synchronisation gap (missing mutex, missing channel edge, missing atomic).
- Set up a CI job in GitHub Actions, GitLab CI, and CircleCI with race detection plus log archival.
- Stress-test code paths under `-race` to surface races that single test runs hide.
- Know when `-race` produces an apparent false positive and what causes it.

This file does not cover TSan internals (professional level) or scheduler-aware tricks for pinning down rare races (senior level). It is the practical toolbox.

---

## Running `-race` Effectively

### The four canonical invocations

```bash
# Run the whole test suite with race detection
go test -race -count=1 -timeout 120s ./...

# Run a specific package
go test -race -count=1 ./internal/queue/

# Run a specific test
go test -race -count=1 -run TestQueue_Enqueue ./internal/queue/

# Run a program under the detector
go run -race ./cmd/server
```

### Always pair with `-count=1`

`go test` caches results by package. If the cached run passed, the test is not re-executed. `-count=1` forces a fresh run. This matters under `-race` because:

- A flaky race that passed once will not re-run from cache.
- Schedule-sensitive bugs need fresh entropy each invocation.
- CI logs that show "PASS (cached)" are misleading.

The standard team command is:

```bash
go test -race -count=1 ./...
```

Internalise it. Type it without thinking.

### `-race` on `go install`

```bash
go install -race ./cmd/devserver
```

Produces a binary in `$GOBIN` with detection on. Useful for end-to-end manual testing of a local server. The resulting binary is slower and bigger; do not ship.

### `-race` on `go build`

```bash
go build -race -o ./bin/server ./cmd/server
./bin/server
```

Identical effect. Useful when you want to run a long-lived process under `-race` in a development environment.

---

## The `GORACE` Environment Variable

`GORACE` is a space-separated list of `key=value` settings that tune the runtime detector. Set it before running the binary or test:

```bash
GORACE="halt_on_error=1 history_size=7" go test -race ./...
```

| Key | Default | Meaning |
|---|---|---|
| `halt_on_error` | 0 | Exit the process the moment the first race fires, instead of continuing to report more. |
| `history_size` | 1 | Size of the per-goroutine history buffer, 0..7. Each step doubles. Bigger = more memory but better stack traces for old accesses. |
| `log_path` | "" | If set, append reports to `<path>.<pid>`. If empty, print to stderr. |
| `exitcode` | 66 | Exit code on race detection. Override only for tooling reasons. |
| `strip_path_prefix` | "" | Trim a path prefix from all source paths in reports. Useful for vendor or container paths. |
| `atexit_sleep_ms` | 1000 | How long to wait at process exit for in-flight reports to flush. |

### CI configuration

In CI, the standard combination is:

```bash
GORACE="halt_on_error=1 history_size=2" go test -race -count=1 ./...
```

- `halt_on_error=1` makes the log easy to find: the report is the last thing printed.
- `history_size=2` is a small bump from the default with negligible cost.

### Local debugging

When you have a specific race and want richer traces:

```bash
GORACE="history_size=7 log_path=./race.log" go test -race -run TestFlaky -count=10 ./...
```

Logs to `./race.log.PID` and runs the test 10 times to increase the chance of hitting the race.

---

## Race-Only Build Tags

Some helper code should only compile when the race detector is on. Use the `race` build tag:

```go
//go:build race

package mypkg

// raceAssert is compiled only under -race.
func raceAssert(cond bool, msg string) {
	if !cond {
		panic("race assertion: " + msg)
	}
}
```

Provide a stub for non-race builds:

```go
//go:build !race

package mypkg

func raceAssert(cond bool, msg string) {}
```

Call from production code:

```go
func (q *Queue) Enqueue(v int) {
	raceAssert(q.mu.TryLock(), "Enqueue should always succeed taking the lock")
	q.buf = append(q.buf, v)
	q.mu.Unlock()
}
```

Under `-race`, you get cheap runtime checks for invariants. Without `-race`, the call compiles to nothing.

### A common race-only pattern: load-bearing assertion

```go
//go:build race

func init() {
	runtime.SetBlockProfileRate(1) // collect blocking events for diagnosis
}
```

Or for a package that needs to detect single-thread-access invariants:

```go
//go:build race

import "sync/atomic"

var owner atomic.Int64 // goroutine ID, race-only
```

Use these sparingly. Race-only logic must never change observable behaviour.

---

## Race Detector and the Test Cache

`go test` caches results keyed by:

- Source hash.
- Build tags.
- Environment variables.
- Test arguments.

The `-race` flag affects the build tag set (`race` is in the tag list under `-race`), so a non-race run and a race run cache separately. Good. But within either mode, a re-run is cached.

### How `-count=1` defeats the cache

The flag `-count=1` is documented as "run each test N times." When N is 1, the cache is bypassed because the test runner explicitly re-runs. Any value of `-count` other than the default behaviour bypasses the cache; `-count=1` is the convention.

```bash
# This may print PASS (cached) on the second run:
go test -race ./...

# This always runs fresh:
go test -race -count=1 ./...
```

### When you want repetition

For genuine repeated runs to expose flakiness:

```bash
go test -race -count=10 -run TestFlaky ./internal/queue/
```

Runs `TestFlaky` ten times. If the race fires on average once per five runs, ten increases your odds. Combine with `-failfast` to stop on the first failure:

```bash
go test -race -count=100 -failfast -run TestFlaky ./internal/queue/
```

---

## CI Integration Patterns

### GitHub Actions

```yaml
name: race
on: [pull_request, push]
jobs:
  race:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: Run tests with race detector
        env:
          GORACE: "halt_on_error=1 history_size=2"
        run: go test -race -count=1 -timeout 5m ./...
```

### GitLab CI

```yaml
race:
  image: golang:1.22
  variables:
    GORACE: "halt_on_error=1 history_size=2"
  script:
    - go test -race -count=1 -timeout 5m ./...
```

### CircleCI

```yaml
version: 2.1
jobs:
  race:
    docker:
      - image: cimg/go:1.22
    environment:
      GORACE: "halt_on_error=1 history_size=2"
    steps:
      - checkout
      - run: go test -race -count=1 -timeout 5m ./...
```

### Two-job pattern

Keep a fast `test` job (no `-race`) and a slower `race` job in parallel:

- `test` runs in 30 seconds, gives quick feedback for typos.
- `race` runs in 3 minutes, gives a thorough check.

Both must pass to merge.

### Archiving race logs

When a race fires in CI, you usually want the report stored as an artifact. Configure `GORACE="log_path=race-report"` and upload `race-report.*` files at the end of the job:

```yaml
- name: Run race tests
  env:
    GORACE: "halt_on_error=1 log_path=race-report"
  run: go test -race -count=1 ./...
- name: Upload race reports
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: race-reports
    path: race-report.*
```

### Race in nightly stress

A second CI job runs every night with high repetition:

```yaml
nightly-race:
  schedule:
    - cron: '0 3 * * *'
  steps:
    - run: go test -race -count=50 -run TestConcurrent ./...
```

Catches races that single-run jobs miss.

---

## Stress Testing Under `-race`

A race that fires once in a hundred runs is undetectable in normal CI. Stress tests fix this. The simplest pattern:

```go
//go:build !short

package queue_test

import (
	"sync"
	"testing"
)

func TestQueue_Stress(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping stress test in short mode")
	}
	q := NewQueue()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); for j := 0; j < 1000; j++ { q.Enqueue(j) } }()
		go func() { defer wg.Done(); for j := 0; j < 1000; j++ { q.Dequeue() } }()
	}
	wg.Wait()
}
```

Run with `-race`:

```bash
go test -race -count=1 -run TestQueue_Stress ./...
```

200 goroutines, 100k operations, fully race-instrumented. Any data race shows up. Pair with `-count=10` for extra coverage.

### Stress matrix

| Variable | Suggested range |
|---|---|
| Number of producers | 1, 4, 16, 64 |
| Number of consumers | 1, 4, 16, 64 |
| Operations per goroutine | 100, 1000, 10000 |
| `GOMAXPROCS` | 1, 2, num_cpu |

Vary one dimension at a time. Some races appear only with `GOMAXPROCS=1` (cooperative scheduling), others only with `GOMAXPROCS=N` (true parallelism).

---

## Combining `-race` with `-timeout` for Deadlocks

`-race` does not catch deadlocks. Use `-timeout` instead. The default is 10 minutes; for unit tests, set it shorter:

```bash
go test -race -count=1 -timeout 30s ./...
```

If a goroutine deadlocks, the test runner kills the process after 30 seconds and prints a goroutine dump showing exactly where every goroutine is parked. That dump is your debug output.

A typical mixed test:

```go
func TestDoesNotDeadlock(t *testing.T) {
	done := make(chan struct{})
	go func() {
		ProcessRequest()
		close(done)
	}()
	select {
	case <-done:
		// success
	case <-time.After(2 * time.Second):
		t.Fatal("ProcessRequest hung")
	}
}
```

A timeout inside the test itself, plus the outer `-timeout`, gives two layers of deadlock protection.

---

## Reading Race Reports at Scale

A single report is easy. When ten reports fire in one CI run, you need a strategy.

### Step 1: Halt on first

`GORACE=halt_on_error=1` reduces the log to one race. Often that one race is the root cause of the others.

### Step 2: Group by site

Multiple reports for the same memory address from the same call sites are duplicates. Look for unique (`Read at`, `Write at`) pairs.

### Step 3: Check the goroutine creator

```
Goroutine 8 (running) created at:
  main.main()
      /path:12 +0xe4
```

If both racing goroutines come from the same creator, the race is between two instances of the same code. If they come from different creators, the race spans two subsystems.

### Step 4: Look at the address

```
Read at 0x00c00001a0a8 by goroutine 8:
```

The hex address is a heap location. If multiple reports share the same address, they are racing on the same object. Different addresses with the same call sites mean the object is being created repeatedly and each instance has the race (i.e., the race is in the type, not in one instance).

---

## Mapping Reports to Synchronisation Bugs

The most common report patterns and their fixes.

### Pattern 1: One reader, one writer, no sync

```
Read at ... by goroutine 8
Previous write at ... by goroutine 7
```

Fix: add a `sync.Mutex` or use a channel. Both accesses must use the same primitive.

### Pattern 2: Two writers, no sync

```
Write at ... by goroutine 8
Previous write at ... by goroutine 7
```

Fix: lock both writers. If the writes are independent counters, consider `sync/atomic`.

### Pattern 3: Read with mutex, write without

```
Read at ... by goroutine 8:
  q.mu.Lock(); q.buf[i]; q.mu.Unlock()
Previous write at ... by goroutine 7:
  q.buf = append(q.buf, x)   // <-- no lock
```

Fix: lock the writer too. Both sides must respect the invariant.

### Pattern 4: Channel close vs send

```
Write at ... by goroutine 8 (close)
Previous send at ... by goroutine 7
```

Fix: never send on a channel that may be closed. The convention is "only the sender closes." Restructure so close is signaled by a separate mechanism (e.g., `context.Done`) and the send checks before sending.

### Pattern 5: Map without lock

```
Write at ... by goroutine 8 (mapassign)
Previous write at ... by goroutine 7 (mapassign)
```

Fix: lock all map operations or use `sync.Map`. Go's runtime also panics with "concurrent map writes" sometimes — same root cause.

### Pattern 6: Captured loop variable

```
Read at ... by goroutine 8 of `i`
Previous write at ... by goroutine 0 of `i` (the loop)
```

Fix: pass `i` as a parameter to the goroutine, or upgrade to Go 1.22+ where loop variables are per-iteration.

---

## Race Detector and cgo

`-race` works with cgo on supported platforms, with caveats:

- Memory accessed only from C code is invisible to TSan.
- Memory passed from Go to C is tracked as a single access at the boundary; TSan does not see what C does to it.
- If C code mutates Go-allocated memory concurrently with Go code, the race is real but the report may be confusing.

### Practical advice

- For libraries that wrap a C dependency, write a Go-side mutex around all calls into C that touch shared state.
- Avoid passing Go slices or maps into C and modifying them concurrently.
- Test C-heavy libraries with `-race` and inspect the reports carefully; expect occasional confused output.

---

## Race Detector and `unsafe`

`unsafe.Pointer` casts and `uintptr` arithmetic can confuse TSan. Common pitfalls:

- Reinterpreting a byte slice as an `int64` slice: TSan sees the access at the byte level but the size mismatch can produce odd reports.
- Holding `uintptr` references: not visible to TSan; you lose tracking for those accesses.
- Using `unsafe.Slice` or `unsafe.String` (Go 1.20+): TSan understands these.

If a race report looks impossible, check whether the offending memory is touched via `unsafe`. The fix is usually to remove the unsafe code, not the report.

---

## Common Mistakes at Middle Level

### Mistake 1: Skipping `-count=1` in CI

Cached PASS hides flakes. Always force a fresh run.

### Mistake 2: Configuring `halt_on_error=0` and drowning in noise

If twenty races all stem from one root cause, twenty pages of report help no one. `halt_on_error=1` is the right default for CI.

### Mistake 3: Running `-race` and `-bench` together

```
go test -race -bench=. ./...
```

Benchmarks become 5–15x slower, results are useless. Run benchmarks separately, without `-race`.

### Mistake 4: Forgetting to run `-race` on integration tests

`go test ./...` without `-race` may miss races in code only exercised by integration suites. Apply `-race` to all `go test` invocations.

### Mistake 5: Treating a one-off race report as flaky

A race that fires once and not again is not flaky — the schedule changed. The bug is still there. Investigate, do not retry.

### Mistake 6: Adding `t.Skip("races on slow machine")`

If a test hits a race on a slow machine and passes on a fast one, the race is real on both. Fix the code.

### Mistake 7: Believing the binary is identical

A `-race` build differs from a non-`-race` build: instrumented calls, larger binary, different symbol table. Performance benchmarks and binary-size checks must use non-`-race` builds.

---

## Self-Assessment

- [ ] I can write a `Makefile` target that runs all tests with `-race -count=1` and a sane timeout.
- [ ] I can configure GitHub Actions, GitLab CI, or CircleCI to run a race job.
- [ ] I know what `GORACE=halt_on_error=1` does and when to use it.
- [ ] I can write a stress test that hammers a concurrent function from many goroutines.
- [ ] I can read a race report and classify the bug in under one minute.
- [ ] I know how `-race` interacts with cgo and `unsafe`.
- [ ] I can write a race-only assertion guarded by `//go:build race`.
- [ ] I understand why benchmarks must run without `-race`.

---

## Summary

At middle level the race detector is no longer something you remember to run; it is the default for tests and stress runs across every workflow. You combine `-race` with `-count=1`, `-timeout`, and `GORACE` knobs to surface bugs reliably. You wire CI to run a dedicated race job per PR and a nightly stress job for rare races. You read reports quickly by recognising the patterns: missing mutex, missing channel edge, captured loop variable, concurrent map. You also know what `-race` cannot see — cgo internals, `unsafe` games, deadlocks, logical races — and you pair it with timeouts, code review, and integration tests to cover those gaps.
