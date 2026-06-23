# Race Detector — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+.

---

## Task 1: Trigger your first race report

Write a tiny program with a deliberate data race: `N` goroutines each increment a shared `int` without synchronization.

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var x int
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            x++
        }()
    }
    wg.Wait()
    fmt.Println(x)
}
```

**Acceptance criteria**
- [ ] `go run main.go` runs to completion (with no warning).
- [ ] `go run -race main.go` prints a `WARNING: DATA RACE` block and exits non-zero.
- [ ] You can point at the line number it reports and explain why both accesses race.

---

## Task 2: Fix the race with `sync.Mutex`

Take the program from Task 1 and add a mutex around `x++`.

**Acceptance criteria**
- [ ] The mutex protects every read and every write to `x` (none escape the lock).
- [ ] `go run -race main.go` is now silent (no `DATA RACE`).
- [ ] `go run main.go` consistently prints `100`.

---

## Task 3: Fix the same race with a channel

Replace the mutex with a counting goroutine that owns `x` and processes increments sent over a `chan struct{}`.

**Acceptance criteria**
- [ ] Only one goroutine ever touches `x` directly; other goroutines `ch <- struct{}{}`.
- [ ] `go run -race main.go` is silent.
- [ ] You can explain in one sentence why ownership-via-channel removes the race without needing a mutex.

---

## Task 4: Configure `GORACE=halt_on_error=1`

Take the original racy program from Task 1.

**Acceptance criteria**
- [ ] `go build -race -o racy && GORACE='halt_on_error=1' ./racy` exits on the first race report (exit code 66 unless you change it).
- [ ] `GORACE='halt_on_error=0' ./racy` runs the program to completion despite race reports.
- [ ] You set `GORACE='log_path=/tmp/race'` and confirm `/tmp/race.<pid>` files contain the reports instead of stderr.

---

## Task 5: Race-only test helper via `//go:build race`

Create two files in a package:

- `assert_race.go` with `//go:build race` containing a function `AssertInvariants()` that performs expensive consistency checks.
- `assert_norace.go` with `//go:build !race` containing the same function as a no-op.

**Acceptance criteria**
- [ ] `go test ./pkg` does not call into the expensive checks (verify with `-v` and a `fmt.Println` inside the race version).
- [ ] `go test -race ./pkg` runs the expensive checks.
- [ ] Both builds compile cleanly; no symbol is duplicated.

---

## Task 6: Wire `-race` into CI

Add a GitHub Actions (or your CI of choice) workflow step that runs `go test -race -count=1 -shuffle=on ./...` on every push.

**Acceptance criteria**
- [ ] The workflow runs on a PR and shows a failing job when a race is introduced.
- [ ] The race job is separated from the fast unit-test job so the fast job still gives quick feedback (optional but recommended).
- [ ] You can show a green run on `main` and a red run on a branch that intentionally adds a racy line.

---

## Task 7: Stage a `-race` binary under real-ish load

Build a tiny HTTP server with a deliberately shared (and racy) cache:

```go
var cache = map[string]int{}

func handler(w http.ResponseWriter, r *http.Request) {
    cache[r.URL.Path]++          // unsynchronized write
    fmt.Fprintln(w, cache[r.URL.Path])
}
```

Run it with `go build -race -o app && GORACE='log_path=/tmp/race halt_on_error=0' ./app`. Hit it with `hey -c 50 -z 60s http://localhost:8080/` (or `wrk`, or a simple shell loop).

**Acceptance criteria**
- [ ] The server keeps serving traffic for the full minute (because `halt_on_error=0`).
- [ ] `/tmp/race.<pid>` contains at least one `DATA RACE` report.
- [ ] The report's user-code frames point at the line containing the racy map access.

---

## Task 8: Distinguish a `sync/atomic` race from a `sync.Mutex` race

Write two small programs:
- One races on a shared `int64` using bare `++`.
- Convert that one to `atomic.AddInt64` and verify the report disappears.
- Then make a second program where two goroutines hold *different* mutexes around the same variable — the detector still reports a race because the locks don't synchronize each other.

**Acceptance criteria**
- [ ] `atomic.AddInt64` version is silent under `-race`.
- [ ] The "two different mutexes" version is **not** silent — the detector reports a race even though both accesses are technically locked.
- [ ] You can articulate the difference: atomics establish a happens-before edge on the same variable; two unrelated mutexes establish edges only among holders of the *same* mutex.

---

## Task 9: A long-running tail race

Run `go test -race -count=200 -run=TestFlaky ./pkg` on a test you suspect of being racy but which usually passes. If you do not have one, write one: two goroutines write to a shared map without locking but with a `runtime.Gosched()` that makes most runs appear clean.

**Acceptance criteria**
- [ ] Most runs pass; some print `DATA RACE`.
- [ ] Increasing `-count` increases the failure frequency.
- [ ] You write 2–3 sentences on why a flaky `-race` failure should be treated as a real bug, not "the detector being noisy."
