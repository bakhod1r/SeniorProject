---
layout: default
title: Parallel Tests — Tasks
parent: Parallel Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/09-parallel-tests/tasks/
---

# Parallel Tests — Tasks

[← Back](../)

Each task is solvable in 20–60 minutes and intentionally drills one parallel-testing concept at a time. Solve the tasks in order; later tasks assume earlier vocabulary.

## Task 1. Mark a pure test parallel

Given the following test, modify it so it runs in parallel with siblings and confirm with `-parallel 4 -v`.

```go
package mathutil

import "testing"

func TestSquare(t *testing.T) {
    if got := Square(7); got != 49 {
        t.Fatalf("Square(7) = %d, want 49", got)
    }
}
```

**Goal**: Add `t.Parallel()` and verify the `=== PAUSE` / `=== CONT` lines appear in `-v` output.

## Task 2. Parallel table-driven test

Convert the following table-driven test so each case runs in parallel. Target Go 1.22+; do **not** rely on the legacy `tc := tc` shadow.

```go
func TestParse(t *testing.T) {
    cases := []struct {
        in   string
        want int
    }{
        {"1", 1}, {"42", 42}, {"-7", -7}, {"0", 0},
    }
    for _, tc := range cases {
        t.Run(tc.in, func(t *testing.T) {
            got, err := Parse(tc.in)
            if err != nil {
                t.Fatal(err)
            }
            if got != tc.want {
                t.Fatalf("Parse(%q)=%d, want %d", tc.in, got, tc.want)
            }
        })
    }
}
```

**Goal**: Add `t.Parallel()` inside the subtest. Verify with `-v -parallel 4` that the subtests run concurrently.

## Task 3. Reproduce the pre-1.22 loop-variable bug

Using Go 1.21 (or `GODEBUG=loopvar=0` on newer Go), write a parallel subtest that exhibits the bug, then fix it. Confirm with `-v` that all subtests originally print the *same* value, and after the fix they print distinct values.

**Goal**: Be able to recognise the bug from `-v` output forever.

## Task 4. Per-test isolation with `t.TempDir`

Write a parallel test that creates a file `out.json` in a directory and verifies its contents. Two instances of the test must not collide on the file path.

```go
func TestWriteJSON(t *testing.T) {
    t.Parallel()
    // TODO: use t.TempDir to pick a unique path.
    // TODO: write {"x":1} and read it back.
}
```

**Goal**: Run `go test -count=10 -parallel 8` and observe zero collisions.

## Task 5. Detect a race with `-race`

Write a buggy parallel test that shares a package-level `var counter int` across two parallel subtests, each incrementing it 1000 times. Run `go test -race` and capture the report. Then fix it with `sync/atomic` (or remove the parallelism). Document the fix in a comment.

**Goal**: Internalise that `-race` is the canonical tool for catching parallel-test races.

## Task 6. `t.Setenv` and the parallel guard

Predict what the following test does, then run it.

```go
func TestEnv(t *testing.T) {
    t.Parallel()
    t.Setenv("FOO", "bar") // What happens here?
    if os.Getenv("FOO") != "bar" {
        t.Fatal("env not set")
    }
}
```

**Goal**: Observe the panic, read the message, fix it by reordering (call `t.Setenv` *before* `t.Parallel`, and remove `t.Parallel` because Setenv forbids it).

## Task 7. Cleanup ordering across parallel subtests

Write two parallel subtests under one parent. Each registers a `t.Cleanup` that logs its name. Add a parent `t.Cleanup` that logs `"parent"`. Predict the log order, then verify with `-v`.

**Goal**: Confirm that the parent's cleanup runs after both children's cleanups.

## Task 8. Pooled resource: HTTP test server

Build a helper `acquireServer(t *testing.T) *httptest.Server` that hands out servers from a pool of 4. Tests calling it via `t.Parallel` should block when all 4 are in use. Use a buffered channel.

```go
var serverPool chan *httptest.Server

func TestMain(m *testing.M) {
    serverPool = make(chan *httptest.Server, 4)
    for i := 0; i < 4; i++ {
        serverPool <- httptest.NewServer(handler)
    }
    code := m.Run()
    close(serverPool)
    for s := range serverPool {
        s.Close()
    }
    os.Exit(code)
}
```

**Goal**: Run 20 parallel tests, confirm only 4 ever execute simultaneously.

## Task 9. Goroutine leak detection

Add `go.uber.org/goleak` to a small package. In `TestMain`, call `goleak.VerifyTestMain(m)`. Write a test that leaks a goroutine (`go func() { for {} }()`). Confirm the suite fails with a goleak report. Then fix the leak with a `context.Context`.

**Goal**: Wire goleak into a test suite from scratch.

## Task 10. `-cpu` and `-count` combinations

Run the following commands on a small parallel suite and explain the difference:

```bash
go test -cpu=1,2,4 -v ./...
go test -count=3 -v ./...
go test -cpu=1,2,4 -count=2 -v ./...
```

**Goal**: Predict how many times each `Test*` runs. Verify your prediction. Document the multiplicative behavior.

## Task 11. Profile the test binary

Take a CPU-heavy package, run `go test -cpuprofile cpu.out -parallel 8` and identify the top function. If it's a mutex in a logger, move the logger to a `sync.Pool` of buffers per test.

**Goal**: Practice using `pprof` on a test binary.

## Task 12. Custom analyzer (stretch)

Write a `go/analysis` pass that flags every top-level `TestXxx` function that does not call `t.Parallel` somewhere in its body. Test it with `analysistest`.

**Goal**: Tooling-level fluency. Useful in real teams to enforce parallel-by-default.

## Task 13. Replace `defer` with `t.Cleanup` in a parallel test

You inherit this code:

```go
func TestThing(t *testing.T) {
    t.Parallel()
    f, err := os.CreateTemp("", "test-*")
    if err != nil {
        t.Fatal(err)
    }
    defer os.Remove(f.Name())
    defer f.Close()
    // ... assertions
}
```

Convert to `t.Cleanup` and explain why the new version is safer when `t.FailNow` is called.

**Goal**: Understand that `t.Cleanup` survives `t.FailNow` (which `defer` after a `t.FailNow` does too, but only within the same goroutine — `t.Cleanup` is the framework-aware version that handles subtests properly).

## Task 14. Build a parallel-safe environment-variable-free config

The legacy code:

```go
func LoadConfig() Config {
    return Config{Host: os.Getenv("APP_HOST"), Port: atoi(os.Getenv("APP_PORT"))}
}
```

Refactor to accept a `Source` interface so tests can pass a `MapSource` without `t.Setenv`. Then write 5 parallel tests covering different config values.

**Goal**: Turn a non-parallel-friendly API into a parallel-friendly one. This is the most common real-world refactor in legacy Go projects.

## Task 15. Diagnose a flake with `-count=N` and `-race`

Take a parallel test that flakes 1% of the time. Use the following protocol:

```bash
# Step 1: reproduce
go test -count=1000 -parallel 16 -run=TestFlaky -v 2>&1 | tee log.txt

# Step 2: with race detector
go test -race -count=200 -parallel 8 -run=TestFlaky -v

# Step 3: lower parallelism
go test -count=1000 -parallel 1 -run=TestFlaky -v
```

If step 3 still flakes, it's not a parallelism bug. If step 3 is clean and steps 1-2 flake, it is.

**Goal**: Build muscle memory for the diagnostic ladder.

## Task 16. Wrap parallel subtests in a synchronization point

Given:

```go
func TestThing(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            // ...
        })
    }
    finalize() // runs BEFORE the parallel subtests finish — bug
}
```

Refactor so `finalize()` runs after all parallel subtests complete.

**Goal**: Master the `t.Run("group", ...)` wrapper pattern.

## Task 17. Add `goleak` to a package

Take any package with `t.Parallel` tests, add `go.uber.org/goleak` to go.mod, and write:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

If the package has legitimate background goroutines (a metrics flusher, a background pool worker), use `goleak.IgnoreTopFunction("pkg/path.funcName")` to whitelist them. Run the suite; investigate every reported leak.

**Goal**: Wire leak detection into a real package.

## Task 18. Implement a parallel-safe singleton fixture

Write a `loadSchema(t *testing.T) *Schema` helper that:

1. Loads `testdata/schema.json` exactly once, no matter how many parallel tests call it.
2. Returns the same `*Schema` to every caller.
3. Fails the test if the load failed.

Use `sync.Once` internally. Test by calling it from 100 parallel subtests.

**Goal**: Build the canonical immutable-shared-fixture pattern.

## Task 19. Detect accidentally-serial parallel tests

Take a `*_test.go` file. Run with `-cpuprofile cpu.out -parallel 16`. Open the profile with `go tool pprof -top cpu.out`. Look for `sync.(*Mutex).Lock` near the top.

If a single mutex shows up, find the call site — likely in a logging or metrics helper. Refactor to either remove the contention or scope the mutex per-test.

**Goal**: Recognise the "parallel tests but no parallelism" anti-pattern.

## Task 20. Test ordering exploration

Write a package with four tests: `TestA` (parallel), `TestB` (serial), `TestC` (parallel), `TestD` (serial). In each, log the start and end time:

```go
t.Logf("start %s at %v", t.Name(), time.Now().UnixNano())
defer t.Logf("end %s at %v", t.Name(), time.Now().UnixNano())
```

Run with `-v -parallel 2`. Trace the schedule on paper, then verify against the logs.

**Goal**: Internalise the actual scheduling order Go's test framework uses.

## Task 21. Two-phase parallel test

Some tests need a setup that depends on a parallel computation. Pattern:

```go
func TestTwoPhase(t *testing.T) {
    var data []int

    t.Run("compute", func(t *testing.T) {
        for i := 0; i < 5; i++ {
            i := i
            t.Run(fmt.Sprint(i), func(t *testing.T) {
                t.Parallel()
                // ... compute something, but only accumulate via channel
            })
        }
    })

    // After "compute" returns, all parallel children are done.
    // Now we can use `data` safely.
}
```

Implement the channel-based accumulation pattern so all parallel computations contribute to `data` without races.

**Goal**: Combine parallel children with a deterministic post-phase.

## Task 22. Constraint: deny package-level state

Set up a tiny package and require that no test file declares any package-level `var` other than constants and one `*M.Run` setup struct. Enforce with a linter (you can use `gochecknoglobals` from `golangci-lint`). Convert any tests that violate.

**Goal**: Build the habit of test-local state.

## Verification checklist

For each task, before declaring it done:

1. The test passes with `go test`.
2. The test passes with `go test -race`.
3. With `-v -parallel 4 -count=10`, no flakes appear over 100 runs (`go test -count=10 -run=TestX -v` ten times).
4. `go vet ./...` reports no `loopclosure` warnings.
5. `goleak` (if used) reports no leaks.

If any check fails, the task is not done.

## Stretch challenges

After tasks 1–22, the following stretch problems require senior-level reasoning:

- **S1**: Profile a parallel suite and reduce wall-time by 30%.
- **S2**: Migrate a 100-file legacy serial test suite to parallel-by-default. Document every test that *can't* be parallel and the reason.
- **S3**: Write a custom `go/analysis` pass that requires every new `TestXxx` either calls `t.Parallel` or has a `// noparallel:` comment with a reason.
- **S4**: Wire a CI dashboard that tracks per-test runtime over the last 30 days. Identify regressions.

These are the kind of tasks a tech lead might face on a real Go project. Treat them as week-long projects, not afternoon exercises.

## Reflection prompts

After completing the tasks, write short answers to these prompts:

1. Which task taught you the most? Why?
2. Which task did you fail first attempt? What was the bug?
3. Which Go feature surprised you?
4. After all 22 tasks, can you write a parallel test from scratch with no reference?
5. If a junior asked "should I make this test parallel?", what's your one-paragraph answer?

The answers are your own; nobody else needs to see them. The act of writing them consolidates the learning.
