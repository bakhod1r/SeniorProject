---
layout: default
title: Coverage — Tasks
parent: Test Coverage
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/06-coverage/tasks/
---

# Coverage — Tasks

[← Back](../)

Hands-on exercises for `go test -cover`. Each task tells you what to build, what to measure, and how to verify the result. Work through them in order; later tasks assume the artifacts of earlier ones.

## Task 1 — Your first profile

Create a package `calc` with a small API:

```go
// calc/calc.go
package calc

func Add(a, b int) int { return a + b }
func Sub(a, b int) int { return a - b }
func Div(a, b int) (int, error) {
    if b == 0 {
        return 0, errAddZeroDiv
    }
    return a / b, nil
}

var errAddZeroDiv = fmtErr("division by zero")
type fmtErr string
func (e fmtErr) Error() string { return string(e) }
```

Write `calc_test.go` that tests `Add` and `Sub` only. Run:

```
go test -cover ./calc
```

**Expected**: a percentage less than 100% because `Div` is not exercised. Generate a profile:

```
go test -coverprofile=cover.out ./calc
go tool cover -func=cover.out
```

**Goal**: read the per-function output and identify exactly which lines are uncovered. Open `go tool cover -html=cover.out` and confirm visually.

## Task 2 — Reach 100% on `calc`

Extend the test file to cover `Div` both for the success branch and for the `b == 0` branch. Re-run `-cover` and confirm `coverage: 100.0% of statements`. Note that this is *statement* coverage — task 6 will show why this is not the same as branch coverage.

## Task 3 — Cross-package coverage with `-coverpkg`

Create a sibling package `cmd/calculator` that imports `calc` and uses it in a tiny CLI:

```go
package main

import (
    "fmt"
    "os"
    "strconv"
    "example.com/calc"
)

func main() {
    a, _ := strconv.Atoi(os.Args[1])
    b, _ := strconv.Atoi(os.Args[2])
    fmt.Println(calc.Add(a, b))
}
```

Now run with coverage extended to all packages in the module:

```
go test -coverpkg=./... -coverprofile=cover.out ./...
```

**Expected**: the percentage drops because the `cmd/calculator` package has no tests; its statements are in the denominator but not exercised. Inspect the profile to verify `cmd/calculator/main.go` lines are 0.

## Task 4 — Atomic mode for parallel tests

Write a package `cache` with a `Get`/`Set` map protected by a mutex. Add a test that uses `t.Parallel()` plus many subtests pounding the cache concurrently. Run:

```
go test -cover -covermode=atomic ./cache
```

Then run the same test under the race detector:

```
go test -race -cover ./cache
```

**Goal**: confirm both work. Then try `-cover -covermode=count` with `-parallel=8` and many goroutines; depending on the workload you may see undercounting due to lost atomic-less increments. Compare the count totals between modes.

## Task 5 — Coverage of an integration test (Go 1.20+)

Build the `calculator` binary with coverage enabled:

```
go build -cover -o /tmp/calc ./cmd/calculator
```

Create a coverage directory and run the binary several times with different arguments:

```
mkdir -p /tmp/cov
GOCOVERDIR=/tmp/cov /tmp/calc 1 2
GOCOVERDIR=/tmp/cov /tmp/calc 7 9
```

Convert and inspect:

```
go tool covdata percent -i=/tmp/cov
go tool covdata textfmt -i=/tmp/cov -o=/tmp/integration.out
go tool cover -func=/tmp/integration.out
```

**Goal**: see that lines exercised only by the binary run (CLI parsing, `os.Args` handling) are marked covered.

## Task 6 — Find the branch-coverage gap

Add this function to `calc`:

```go
func Categorize(n int) string {
    if n > 0 && n%2 == 0 {
        return "positive-even"
    }
    return "other"
}
```

Write *one* test calling `Categorize(4)`. Run `go test -cover` — you will get 100% statement coverage. Add a second test calling `Categorize(-2)` and observe that statement coverage was lying: the path where `n > 0` is false and the short-circuit fires was never executed. **Goal**: convince yourself that Go's metric does not measure branch coverage; write at least four tests to cover the four logical combinations of the two predicates.

## Task 7 — Parse the profile in Go

Write a small program that reads `cover.out` using `golang.org/x/tools/cover` and prints, for each file, the percentage of statements covered, sorted ascending. Skeleton:

```go
package main

import (
    "fmt"
    "os"
    "sort"
    "golang.org/x/tools/cover"
)

func main() {
    profiles, err := cover.ParseProfiles(os.Args[1])
    if err != nil {
        panic(err)
    }
    type row struct {
        file string
        pct  float64
    }
    var rows []row
    for _, p := range profiles {
        var tot, covered int
        for _, b := range p.Blocks {
            tot += b.NumStmt
            if b.Count > 0 {
                covered += b.NumStmt
            }
        }
        if tot == 0 {
            continue
        }
        rows = append(rows, row{p.FileName, 100 * float64(covered) / float64(tot)})
    }
    sort.Slice(rows, func(i, j int) bool { return rows[i].pct < rows[j].pct })
    for _, r := range rows {
        fmt.Printf("%6.2f%%  %s\n", r.pct, r.file)
    }
}
```

**Goal**: produce a programmatic, sortable coverage table that you can use in CI gates.

## Task 8 — Enforce a per-file floor in CI

Extend the parser from task 7 to fail with exit code 1 if any file under `internal/critical/` is below 80%. Add it as a CI step after `go test -coverprofile=cover.out ./...`. **Goal**: a working enforcement pipeline that rejects PRs lowering coverage of designated critical paths.

## Task 9 — Exclude generated code

Add a `gen/types_gen.go` to the module with thousands of trivial accessor methods (`func (x *T) Foo() string { return x.foo }`). Run `go test -cover` and watch the percentage explode upward. Now post-process the profile to drop any block whose `FileName` ends in `_gen.go` and recompute the percentage. **Goal**: realize the headline number was dominated by trivial generated code and the post-processing is essential.

## Task 10 — Coverage delta on PRs

Write a script that:

1. Checks out `main`, runs `go test -coverprofile=base.out ./...`.
2. Checks out the PR branch, runs `go test -coverprofile=head.out ./...`.
3. Diffs the two using `golang.org/x/tools/cover` and prints files whose coverage decreased by more than 1 percentage point.

**Goal**: a delta-aware report that resists Goodhart's law better than a hard floor.

## Task 11 — Compare coverage modes

Take any package with a parallel-friendly test (e.g., `cache` from task 4). Run it three times:

```
go test -covermode=set -coverprofile=set.out ./cache
go test -covermode=count -coverprofile=count.out ./cache
go test -covermode=atomic -coverprofile=atomic.out ./cache
```

Compare the three profiles. The percentages should be identical or nearly so. The counter values will differ:

- `set.out`: 0 or 1 per block.
- `count.out`: actual counts, possibly with lost increments under parallelism.
- `atomic.out`: accurate counts.

**Goal**: observe that for the percentage metric the modes are interchangeable; only count fidelity differs.

## Task 12 — Race-detection forces atomic

Run the same test with `-race -covermode=set`:

```
go test -race -covermode=set -coverprofile=race.out ./cache
```

Inspect the first line of `race.out`. It should say `mode: atomic`, not `mode: set` — the Go toolchain promoted the mode to satisfy the race detector. **Goal**: confirm the documented behavior by direct observation.

## Task 13 — Filter generated code

Take a project that includes a `*_gen.go` file (or create one with lots of trivial getter methods). Run coverage and note the percentage. Then post-process:

```bash
grep -vE '_gen\.go:' cover.out > cover.filtered.out
go tool cover -func=cover.filtered.out | tail -1
```

The filtered percentage should be lower (or higher, depending on whether the generated code was well-covered). **Goal**: see how generated-code inclusion skews the metric, and how filtering produces a more honest number.

## Task 14 — Coverage as design feedback

Find a function in your codebase that you have struggled to test. Run coverage. Note which branches are uncovered. Now refactor the function to make those branches reachable — extract dependencies into parameters, split into smaller functions, replace globals with arguments. After refactoring, write the tests for the previously-uncovered branches.

**Goal**: experience coverage gaps as design feedback, not just test debt. The refactor should make the code easier to test and (usually) easier to understand.

## Task 15 — Coverage-aware code review

For your next PR review, pull down the branch, run coverage, and look at the HTML diff between the base branch's coverage and the PR's coverage. Identify any new uncovered code. Leave a review comment pointing at it (or asking why it is uncovered).

**Goal**: build the habit of inspecting coverage during review, not just looking at the diff.

## Task 16 — Build the integration coverage workflow

Pick a small Go service or CLI you have written. Build it with `-cover`:

```
go build -cover -o /tmp/myapp .
```

Run it through its normal CLI flow (whatever the app does) while `GOCOVERDIR` points at a fresh directory. Then:

```
go tool covdata percent -i=/tmp/cov
go tool covdata textfmt -i=/tmp/cov -o=/tmp/integration.out
go tool cover -html=/tmp/integration.out
```

You should see code paths that no unit test would have exercised — `main`, argument parsing, signal handlers. **Goal**: prove to yourself that integration coverage genuinely reveals code beyond unit-test scope.

## Task 17 — Mutation testing as a coverage check

Install `go-mutesting` (`go install github.com/zimmski/go-mutesting/cmd/go-mutesting@latest`). Run it on a package with high statement coverage but possibly weak assertions:

```
go-mutesting --tests=./mypkg ./mypkg
```

Watch for "alive" mutations — these indicate covered code without sufficient assertions. **Goal**: discover the difference between covered code and tested code on a real package.

## Task 18 — Inspect a real coverage file

Get a real coverage profile from a public Go project (clone `golang/go`, `kubernetes/kubernetes`, or any popular project; run `go test -cover ./<small-package>`). Open `cover.out` in a text editor. Find:

- The mode declaration.
- A block with count=0 (uncovered).
- A block spanning multiple lines.
- A block with high `numStatements`.

**Goal**: develop intuition for what a real-world profile looks like.

## Task 19 — Write your own coverage gate

Extend the parser from task 7 to be a complete CI tool with:

- Per-directory thresholds from a YAML config file.
- Delta enforcement (compared against a base profile).
- A JSON output mode for machine processing.
- Exit code 0 for pass, 1 for fail.

**Goal**: a real CI utility you can integrate into your team's pipeline.

## Task 20 — Measure coverage overhead

For a package with non-trivial tests, time the test suite with and without coverage:

```
time go test ./mypkg
time go test -cover ./mypkg
time go test -covermode=atomic ./mypkg
time go test -race -cover ./mypkg
```

Compute the overhead percentages. **Goal**: measure your project's real coverage cost. The ratios will inform when you can afford coverage on every PR versus when you should run it nightly.

## Task 21 — Coverage for an HTTP server

Build a small HTTP server with at least three endpoints (GET, POST, error). Write tests using `httptest`. Run with `-coverprofile=cover.out`. Open the HTML. Identify which endpoint paths are best covered. Add tests for the gaps.

**Goal**: practice coverage in the context of HTTP handlers, where many of the interesting branches are status-code dependent.

## Task 22 — Cover a `select` statement fully

Write a function that uses `select` over three channels: an input channel, a done channel, and a timeout. Write three tests, each triggering a different case. Confirm 100% coverage. **Goal**: experience the per-case block coverage of `select`.

## Task 23 — Coverage of a state machine

Implement a small state machine with 4-5 states and transitions. Write tests that walk through all transitions. Run coverage. Identify any transition not exercised. **Goal**: state machines often have hidden uncovered transitions; coverage forces you to think about which are missing.

## Task 24 — Integrate with Codecov locally

Sign up for a free Codecov account. Push your test project to GitHub. Configure `codecov.yml` with per-directory targets. Run a PR that lowers coverage and observe the Codecov PR comment. **Goal**: end-to-end experience of a real coverage SaaS workflow.

## Task 25 — Coverage and mutation testing

Install `go-mutesting`. Run it on a package with high coverage. Note any "alive" mutations — these indicate covered but under-asserted code. Add stronger assertions to kill the alive mutations. **Goal**: distinguish covered code from tested code by direct experimentation.


