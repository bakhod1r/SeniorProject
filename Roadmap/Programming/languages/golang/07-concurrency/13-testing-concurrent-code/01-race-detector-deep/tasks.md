# Race Detector Deep Dive — Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Junior Tasks](#junior-tasks)
3. [Middle Tasks](#middle-tasks)
4. [Senior Tasks](#senior-tasks)
5. [Professional Tasks](#professional-tasks)
6. [Verification Checklist](#verification-checklist)

---

## How to Use This File

Each task is self-contained. Read the goal, write the code, run the command, observe the result. The tasks build from "write a race on purpose to see what the detector says" to "design a CI matrix that shards race tests across runners." A solution sketch follows each task.

Run every solution with:

```bash
go test -race -count=1 -timeout 30s ./...
```

---

## Junior Tasks

### Task 1: Trigger a race on a counter

**Goal:** Write a program with two goroutines incrementing the same integer 10,000 times each, without synchronisation. Run with `-race` and capture the report.

**Solution:**

```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	var counter int
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 10000; i++ {
			counter++
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 10000; i++ {
			counter++
		}
	}()
	wg.Wait()
	fmt.Println(counter)
}
```

Run: `go run -race main.go`. The report points at the `counter++` line in both goroutines.

### Task 2: Fix the counter race with `sync/atomic`

**Goal:** Modify Task 1 so `-race` is silent and the result is always 20,000.

**Solution:**

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

func main() {
	var counter int64
	var wg sync.WaitGroup
	wg.Add(2)
	worker := func() {
		defer wg.Done()
		for i := 0; i < 10000; i++ {
			atomic.AddInt64(&counter, 1)
		}
	}
	go worker()
	go worker()
	wg.Wait()
	fmt.Println(counter)
}
```

Run with `-race`. No report. Output: 20000.

### Task 3: Fix the counter race with `sync.Mutex`

**Goal:** Same outcome as Task 2, but use `sync.Mutex`.

**Solution:**

```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	var (
		counter int
		mu      sync.Mutex
	)
	var wg sync.WaitGroup
	wg.Add(2)
	worker := func() {
		defer wg.Done()
		for i := 0; i < 10000; i++ {
			mu.Lock()
			counter++
			mu.Unlock()
		}
	}
	go worker()
	go worker()
	wg.Wait()
	fmt.Println(counter)
}
```

### Task 4: Write a race on a slice

**Goal:** Two goroutines appending to the same slice. Capture the report.

**Solution:**

```go
package main

import "sync"

func main() {
	var s []int
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s = append(s, i)
		}(i)
	}
	wg.Wait()
}
```

Run with `-race`. Report points at the `append` line.

### Task 5: Write a race on a map

**Goal:** Two goroutines writing to the same map. Capture the report.

**Solution:**

```go
package main

import "sync"

func main() {
	m := map[string]int{}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			m["k"] = i
		}(i)
	}
	wg.Wait()
}
```

Run with `-race`. Report points at the map write. May also panic with "concurrent map writes" first; that is the same underlying bug.

### Task 6: Read a real race report

**Goal:** Take the output of Task 1 and annotate each line.

**Expected annotations:**

- `WARNING: DATA RACE` — TSan header.
- `Read at 0x... by goroutine 8:` — current access type and goroutine ID.
- File:line — the offending source location.
- `Previous write at 0x... by goroutine 7:` — the conflicting prior access.
- `Goroutine N (running) created at:` — where the goroutine was spawned.
- `Found 1 data race(s)` — exit summary.
- Exit code 66.

---

## Middle Tasks

### Task 7: Add a `Makefile` race target

**Goal:** Write a `Makefile` target that runs `go test -race -count=1 -timeout 5m ./...` with `GORACE=halt_on_error=1`.

**Solution:**

```makefile
.PHONY: test-race
test-race:
	GORACE="halt_on_error=1 history_size=2" \
	go test -race -count=1 -timeout 5m ./...
```

Run: `make test-race`.

### Task 8: Write a race-only assertion

**Goal:** Add a function `raceAssert(cond bool, msg string)` that panics under `-race` but compiles to nothing otherwise. Use a build tag.

**Solution:**

`raceassert_race.go`:

```go
//go:build race

package mypkg

func raceAssert(cond bool, msg string) {
	if !cond {
		panic("race assertion failed: " + msg)
	}
}
```

`raceassert_norace.go`:

```go
//go:build !race

package mypkg

func raceAssert(cond bool, msg string) {}
```

### Task 9: Build a GitHub Actions workflow

**Goal:** Write a `.github/workflows/race.yml` that runs `go test -race -count=1` on every PR and uploads race reports on failure.

**Solution:**

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
          GORACE: "halt_on_error=1 history_size=2 log_path=race-report"
        run: go test -race -count=1 -timeout 5m ./...
      - name: Upload race reports
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: race-reports
          path: race-report.*
```

### Task 10: Stress-test a queue

**Goal:** Given a `Queue` type with `Enqueue` and `Dequeue`, write a stress test that hammers it with 100 producer goroutines and 100 consumer goroutines, 1,000 operations each. Confirm it passes under `-race`.

**Solution sketch:**

```go
func TestQueue_Stress(t *testing.T) {
	q := NewQueue()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				q.Enqueue(i*1000 + j)
			}
		}(i)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				q.Dequeue()
			}
		}()
	}
	wg.Wait()
}
```

If `-race` fires, the queue's internals are not properly synchronised; fix them.

### Task 11: Use `-count=N` to expose a flake

**Goal:** Given a test that intermittently fails, run it 100 times with `-failfast` and capture the first failure.

**Solution:**

```bash
go test -race -count=100 -failfast -run TestFlaky -v ./internal/queue/
```

`-failfast` stops on the first failure. `-v` shows each iteration.

### Task 12: Vary `GOMAXPROCS`

**Goal:** Run a test under three different `GOMAXPROCS` values and look for races that only fire under one.

**Solution:**

```bash
for p in 1 2 4 8; do
  echo "=== GOMAXPROCS=$p ==="
  GOMAXPROCS=$p go test -race -count=100 -run TestFlaky -failfast ./internal/queue/
done
```

---

## Senior Tasks

### Task 13: Shard race tests across four runners

**Goal:** Modify a CI workflow to split tests into four parallel shards.

**Solution sketch (GitHub Actions matrix):**

```yaml
strategy:
  matrix:
    shard: [0, 1, 2, 3]
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-go@v5
    with:
      go-version: '1.22'
  - name: Test shard
    env:
      GORACE: "halt_on_error=1"
    run: |
      packages=$(go list ./... | awk "NR%4==${{ matrix.shard }}")
      go test -race -count=1 -timeout 10m $packages
```

Each shard runs a quarter of packages; total wall time is ~1/4.

### Task 14: Race-only test suite

**Goal:** Split a slow stress test into a `race_only` build-tag file so it runs only in a nightly job.

**Solution:**

```go
//go:build race_only

package mypkg_test

import "testing"

func TestLongConcurrentScenario(t *testing.T) {
	// 1000 goroutines, 10s of work
}
```

Nightly CI job runs:

```bash
go test -race -tags=race_only -count=1 -timeout 30m ./...
```

### Task 15: Race-detection metric

**Goal:** In CI, after race tests, emit a single line `RACE_FAILURES=N` (count of failing packages) for a metrics collector to scrape.

**Solution sketch:**

```bash
go test -race -count=1 -json ./... > test.json
fail_count=$(jq '.Action=="fail"' < test.json | wc -l)
echo "RACE_FAILURES=$fail_count"
```

### Task 16: Reproduce a CI race locally

**Goal:** Given a CI log that says `WARNING: DATA RACE` in `internal/queue`, reproduce locally.

**Steps:**

1. Capture the exact CI command including `GORACE`.
2. `git checkout <commit-from-CI>`.
3. Run the exact command in a loop:

```bash
GORACE="halt_on_error=1" go test -race -count=200 -run TestEnqueue -failfast ./internal/queue/
```

4. If no repro, vary `GOMAXPROCS`:

```bash
for p in 1 2 4 8; do GOMAXPROCS=$p go test -race -count=200 -run TestEnqueue -failfast ./internal/queue/; done
```

5. If still no repro, instrument with `runtime.Gosched()` calls in the suspect code.

### Task 17: Halt-on-error vs continue

**Goal:** Compare the output of a test with `halt_on_error=1` vs `halt_on_error=0` (default) when three races fire.

**Approach:** Write a test with three independent races, then run twice:

```bash
GORACE="halt_on_error=1" go test -race ./...
GORACE="halt_on_error=0" go test -race ./...
```

Observe that `halt_on_error=1` shows one report and exits, while `halt_on_error=0` shows all three plus a count.

### Task 18: Container build with `-race`

**Goal:** Write a Dockerfile that builds a race-instrumented binary suitable for dev environments.

**Solution:**

```dockerfile
FROM golang:1.22 AS builder
WORKDIR /src
COPY . .
RUN go build -race -o /out/app ./cmd/server

FROM debian:bookworm-slim
COPY --from=builder /out/app /usr/local/bin/app
ENTRYPOINT ["/usr/local/bin/app"]
```

Tag clearly: `myapp:0.5.0-race`.

---

## Professional Tasks

### Task 19: Inspect compiler-inserted instrumentation

**Goal:** Disassemble a race-built binary and identify the `runtime.raceread` and `runtime.racewrite` calls.

**Steps:**

```bash
cat > main.go <<'EOF'
package main
var x int
func foo() int { return x }
func bar(v int) { x = v }
func main() { foo(); bar(5) }
EOF

go build -race -o /tmp/app main.go
go tool objdump -s 'main\.foo|main\.bar' /tmp/app
```

Look for `CALL runtime.raceread(SB)` before the load of `x` in `foo`, and `CALL runtime.racewrite(SB)` before the store in `bar`.

### Task 20: Vector clock thought experiment

**Goal:** Trace by hand what happens to two goroutines' vector clocks across a `sync.Mutex.Lock`/`Unlock` pair.

**Setup:**

- Goroutine A: writes `x = 1`, then `mu.Unlock()`.
- Goroutine B: `mu.Lock()`, then reads `x`.

**Expected trace:**

Initial: `VC_A = [0, 0]`, `VC_B = [0, 0]` (entries for A and B).

After `x = 1`: A's clock advances at index A. `VC_A = [1, 0]`. Shadow slot at `&x` records `(epoch=1, tid=A, write)`.

A calls `mu.Unlock()`: TSan records the release; the mutex captures a snapshot of `VC_A`.

B calls `mu.Lock()`: TSan absorbs the mutex snapshot into `VC_B`. Now `VC_B = [1, 0]` (or with B's own entry maybe `[1, 1]` depending on bumping convention).

B reads `x`: TSan checks shadow slot. Slot says epoch 1 by A. `VC_B[A] = 1 >= 1`. No race.

If B had read `x` *without* locking the mutex, `VC_B[A]` would still be 0, and 0 < 1: race detected.

### Task 21: Read `runtime/race.go`

**Goal:** Open the file in the Go source tree (e.g., `/usr/local/go/src/runtime/race.go`). Identify:

- `racefuncenter`, `racefuncexit` — function entry/exit hooks.
- `raceread`, `racewrite`, `racereadrange`, `racewriterange` — memory access hooks.
- `racerelease`, `raceacquire` — synchronisation primitives.
- Public Go-visible variables: `raceenabled`.

Sketch the call flow from `compile-emitted call` to TSan's C library.

### Task 22: Compare cross-platform support

**Goal:** Identify all platforms where `go build -race` is supported. Write a small script that prints "supported" / "not supported" for the current `GOOS`/`GOARCH`.

**Solution sketch:**

```go
package main

import (
	"fmt"
	"runtime"
)

var supported = map[string]bool{
	"linux/amd64":   true,
	"linux/arm64":   true,
	"linux/ppc64le": true,
	"linux/s390x":   true,
	"linux/riscv64": true,
	"darwin/amd64":  true,
	"darwin/arm64":  true,
	"freebsd/amd64": true,
	"netbsd/amd64":  true,
	"windows/amd64": true,
}

func main() {
	key := runtime.GOOS + "/" + runtime.GOARCH
	if supported[key] {
		fmt.Printf("%s: -race supported\n", key)
	} else {
		fmt.Printf("%s: -race NOT supported\n", key)
	}
}
```

### Task 23: Compare report formats across versions

**Goal:** Run the same race program under Go 1.18, 1.20, and 1.22. Diff the reports. Confirm the user-visible format is stable.

**Approach:** Use `gotip` or installed Go versions. Save the output of each, run `diff`. Differences should be limited to PC offsets and addresses; format and exit code should be identical.

---

## Verification Checklist

For every task you complete:

- [ ] The race actually appears (or does not appear, where expected).
- [ ] You read the report and identified the offending lines.
- [ ] The fix passes under `-race -count=100`.
- [ ] The fix does not change observable behaviour without `-race`.
- [ ] The test exits with status 0 (or 66 if you expected a race).
- [ ] You re-ran with `-count=1` to defeat the cache.
- [ ] If using CI, the job reports the failure clearly with the race report visible.

When all checks pass for all junior and middle tasks, you have demonstrated working competence with the race detector. The senior and professional tasks deepen that into architectural and runtime-level understanding.
