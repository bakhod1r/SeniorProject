---
layout: default
title: Coverage — Middle
parent: Test Coverage
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/06-coverage/middle/
---

# Coverage — Middle

[← Back](../)

The junior page taught you the everyday workflow: `go test -cover`, `-coverprofile`, `go tool cover -html`, `go tool cover -func`. The middle page goes deeper into the toolchain's configuration: the three coverage modes, why parallel tests force atomic mode, the `-coverpkg` flag for cross-package instrumentation, and how to use coverage sensibly in a monorepo with many packages and many teams.

By the end of this page you will be able to:

- Choose intelligently between `-covermode=set`, `count`, and `atomic`.
- Understand exactly when parallel tests demand atomic mode and when they do not.
- Use `-coverpkg` to expand coverage to dependencies, and understand the trade-offs.
- Aggregate coverage profiles across packages in a monorepo.
- Reason about coverage in build tags, internal packages, and example functions.

The senior page picks up from here with Go 1.20 binary coverage, programmatic profile parsing, and CI integration. This page sits between the everyday usage of `go test -cover` and the deeper integration concerns.

## 1. The three coverage modes

`go test -cover` accepts a `-covermode` flag with three values: `set`, `count`, and `atomic`. The default is `set` unless `-race` is enabled, in which case it is `atomic`. Let's understand each.

### 1.1 `set` mode — did this block run?

`set` mode records, for each instrumented block, whether the block executed at least once during the test run. The recorded value is 0 or 1. The instrumentation looks like:

```go
GoCover_0.Count[42] = 1
```

at the entry of block 42. A plain store, not atomic. Subsequent executions overwrite with 1 (harmless). The total cost per block execution is one memory write.

`set` mode is appropriate when:

- You only care about the percentage covered.
- You do not need to distinguish hot blocks from cold blocks.
- You are not running tests in parallel that touch the same instrumented code.

This is the default for a reason — it is cheap and sufficient for the percentage metric most people want.

### 1.2 `count` mode — how often did this block run?

`count` mode records the exact execution count of each block. The instrumentation becomes:

```go
GoCover_0.Count[42]++
```

A plain increment. Still cheap (one read-modify-write on a single cache line) but not atomic.

`count` mode is useful when:

- You want to identify hot paths versus cold paths for profiling.
- You want to verify that a particular branch was actually exercised many times, not just once (e.g. in a load-test profile).
- You want to use the data for *coverage-guided fuzzing* (rare).

The catch: without atomicity, concurrent updates can corrupt counts. If two goroutines simultaneously execute the same block, the increment may be lost (read 5, increment to 6, both write 6 — final value 6 instead of 7). The percentage metric is unaffected because we only care whether count > 0, but the actual count is approximate.

### 1.3 `atomic` mode — count correctly under concurrency

`atomic` mode uses `sync/atomic` to update the counters. The instrumentation becomes:

```go
atomic.AddUint32(&GoCover_0.Count[42], 1)
```

This is correct under concurrency but significantly slower than the count-mode form. The atomic operation is a locked memory operation (LOCK XADD on x86), which is roughly 10–20x slower than a plain increment under contention.

`atomic` mode is required when:

- You run tests in parallel (`t.Parallel()` or `go test -parallel=N`).
- Your code starts goroutines that execute instrumented code concurrently.
- You enable `-race`, which forces atomic mode automatically.

### 1.4 When to choose which

Decision tree:

- Running with `-race`? → Atomic is forced. Done.
- Running tests serially (no `t.Parallel`, no goroutines in production code)? → `set` is fine.
- Running tests in parallel, but you only need the percentage? → `set` is *still* fine — the worst that happens is a count is "0 or 1" when actually it should be "1 or 1", and both round to "covered".
- Running tests in parallel, and you need accurate counts? → `atomic` is the only correct answer.

Wait — re-read that third bullet. In `set` mode, the recorded value is always set to 1 (not incremented). So even if two goroutines race to write 1, the answer is still 1. This is the surprising property: `set` mode is *concurrency-safe in a benign way* even without atomics. Two goroutines writing the same constant value to the same memory location produce no observable race symptom (the race detector still flags it, which is why `-race` forces `atomic`, but the functional output is correct).

This means: for the percentage metric, `set` is enough in nearly all cases. The reason teams sometimes use `atomic` anyway is to satisfy `-race`, not because the percentages need it.

## 2. Parallel tests and coverage

`t.Parallel()` opts a test into running concurrently with other parallel tests. By default, `go test` runs tests serially within a package and in parallel across packages (`-p` flag controls the latter). When a test calls `t.Parallel()`, it joins a pool of concurrent tests.

How does this interact with coverage?

- If the parallel tests touch *different* instrumented code, no contention exists — each test bumps different counters.
- If the parallel tests touch *the same* instrumented code (e.g. they exercise the same shared helper), counter writes race.

In `set` mode the race is benign as discussed. In `count` mode the race produces lost increments. In `atomic` mode the race is resolved correctly.

The simple guideline: if you use `t.Parallel()` *and* you use `-covermode=count`, switch to `atomic`. Otherwise the default `set` is correct.

A worked example:

```go
// shared.go
package shared

var calls int

func DoIt() {
    calls++
    work()
}

func work() {
    // ... some computation
}
```

```go
// shared_test.go
package shared

import (
    "testing"
    "sync"
)

func TestParallelCalls(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            DoIt()
        }()
    }
    wg.Wait()
}
```

Even in `set` mode, `DoIt` and `work` will be marked covered (any goroutine setting them to 1 is fine). In `count` mode you might see `DoIt` recorded as "94" instead of "100" due to lost increments. In `atomic` mode you get exactly 100.

For the percentage `coverage: X% of statements`, the answer is identical in all three modes — both `DoIt` and `work` count as covered.

## 3. The `-race` interaction

`go test -race` enables the race detector, which instruments all memory accesses with shadow-memory bookkeeping. The race detector explicitly flags concurrent writes to the same memory location even when they write the same value. So in `set` mode, the "benign" race of two goroutines writing 1 to the same coverage counter would be flagged as a real race.

To avoid this, the Go test tool automatically promotes `-covermode=set` to `-covermode=atomic` when `-race` is also on. You can verify:

```
$ go test -race -cover ./shared
... coverage: 100.0% of statements
$ cat cover.out
mode: atomic
...
```

The first line of the profile is `mode: atomic` even though we did not explicitly specify it. This promotion is documented in `go help testflag`.

If you explicitly pass `-covermode=set -race`, Go either errors out or silently promotes to atomic depending on version. The right thing is to omit `-covermode` and let `-race` choose.

## 4. The `-coverpkg` flag

By default, `-cover` instruments only the package whose tests are running. If `foo`'s tests import and exercise `bar`, only `foo`'s statements are in the coverage report — `bar`'s statements are invisible.

This default is sensible for unit tests of a single package. But for integration tests, table-driven cross-package tests, or "feature" tests that touch many packages, the default is misleading: the integration test heavily exercises a service layer, but coverage only counts the (tiny) test-driver package.

The `-coverpkg` flag widens the instrumentation scope:

```
go test -cover -coverpkg=./... ./...
```

This instruments *every* package under `./...` for every test. Now when `foo`'s test exercises `bar`, both `foo`'s and `bar`'s statements are in the profile.

### 4.1 The denominator grows

A subtle effect: with `-coverpkg`, the denominator (total statements) grows. Suddenly `cmd/admin-cli`, which has no tests at all, contributes its 500 statements to the total — pulling the percentage down sharply. Teams sometimes see their headline coverage drop 30 points when adopting `-coverpkg`. This is mathematically correct: the package was always uncovered; you just were not counting it before.

### 4.2 What patterns to pass

`-coverpkg` accepts the standard Go package pattern syntax (`go help packages`):

- `-coverpkg=./...` — every package in the current module.
- `-coverpkg=./internal/...` — only internal packages.
- `-coverpkg=./internal/billing,./internal/auth` — explicit list.
- `-coverpkg=example.com/somelib/...` — a specific dependency tree (usually only useful with vendored builds).

A good default for a service: `-coverpkg=./internal/...` to capture all internal business logic without instrumenting `cmd/` driver code.

### 4.3 Build time impact

`-coverpkg` triggers the compiler to instrument every matched package. Build time grows roughly linearly with the number of instrumented packages. On a 50-package module, expect 2–5x slower compilation. The instrumented packages are cached in the `$GOCACHE`, so subsequent builds are fast — but the first cold build is slow.

This is why `-coverpkg=./...` is usually a nightly job, not a per-PR job.

## 5. Per-package versus cross-package coverage

Two distinct interpretations of "coverage":

1. **Per-package**: each package's tests cover that package. Run `go test -cover ./...`, get one percentage per package. This is the default Go workflow.
2. **Cross-package**: any test in the module can contribute coverage to any package. Run `go test -cover -coverpkg=./... ./...`, get one big profile.

The two answer different questions:

- Per-package answers: "is this package's owner taking responsibility for testing their own code?"
- Cross-package answers: "is the codebase as a whole exercising every package?"

Both are useful. Mature teams track both. The per-package number is more honest about ownership; the cross-package number is more realistic about *de facto* coverage from integration tests.

### 5.1 A monorepo pattern

In a large repo with many teams, a useful pattern is:

```
# Per-team CI step
go test -coverprofile=team-foo.out ./teams/foo/...

# Cross-cutting nightly
go test -coverprofile=integration.out -coverpkg=./shared/... ./tests/integration/...

# Merge for global view
... combine into one profile via x/tools/cover ...
```

Each team owns its own coverage trend; the cross-cutting integration view supplements but does not replace it.

## 6. Coverage and the `internal` package convention

Go's `internal` package convention restricts visibility: a package whose import path contains `/internal/` can only be imported by packages rooted at the parent of `internal`. This affects coverage:

- Tests in the same module can exercise internal packages. Coverage works normally.
- Tests *outside* the module cannot import internal packages, so they cannot contribute coverage.
- `-coverpkg=./internal/...` instruments internal packages just like any other.

In practice this is invisible: internal packages are covered like any other by the module's own tests. The only thing to watch out for is that if you split a module and the internal becomes external, tests in the new module suddenly cannot reach it, and coverage drops.

## 7. Coverage and `Example` functions

`Example` functions with an `// Output:` comment are runnable tests. They count toward coverage. So a documented public API often has higher coverage than you might expect from `TestXxx` alone.

```go
func ExampleDiv() {
    fmt.Println(Div(10, 2))
    // Output: 5 <nil>
}
```

This `Example` runs as part of `go test`, exercises `Div`, and the statements inside `Div` are recorded as covered.

A useful pattern: when you write a public API, write an `Example` that runs the happy path. You get documentation, a doctest, and coverage all from the same five lines.

`Example` functions *without* `// Output:` comments compile but do not run. They contribute no coverage. They are essentially compilation-checked snippets.

## 8. Build tags and coverage

Go supports conditional compilation via build tags:

```go
//go:build linux

package mypkg

func platformInit() { /* ... */ }
```

This file is only compiled on Linux. On macOS, `platformInit` does not exist — there is presumably a sibling `mypkg_darwin.go` with the same function name.

For coverage:

- Only files included in the current build are instrumented. On macOS, the Linux file is not in the build, so it cannot be covered.
- The CI matrix should run coverage on each target platform to see all platform-specific code.
- A single-platform CI sees only that platform's coverage and may show high numbers that mask uncovered code on other platforms.

A common gotcha: code wrapped in `//go:build !test` to be excluded from tests never gets coverage. This is rarely a good pattern; prefer testability injection over conditional compilation.

## 9. Coverage in monorepos

A "monorepo" in Go usually means one Git repo containing many Go modules, or one module containing many packages owned by different teams. The coverage challenges scale with size:

- Running coverage on the entire repo takes hours.
- Different packages have different quality bars.
- Generated code dominates the line count.
- Different teams want different reports.

Practical patterns:

### 9.1 Sharded coverage

Split coverage runs by directory:

```
go test -coverprofile=p1.out ./teams/foo/...
go test -coverprofile=p2.out ./teams/bar/...
go test -coverprofile=p3.out ./teams/baz/...
```

Each shard runs faster and can be parallelized in CI. Merge the profiles for a global report (using `x/tools/cover` or `go tool covdata merge`).

### 9.2 Per-team profiles

Each team's CI uploads to Codecov/Coveralls with a team-specific flag:

```
codecov -f team-foo.out -F team-foo
```

The dashboard shows per-team trends and lets you set per-team policies.

### 9.3 Critical-package flags

In `codecov.yml` or `.coveralls.yml`, set per-directory thresholds:

```yaml
coverage:
  status:
    project:
      default:
        target: 70%
      critical:
        paths:
          - internal/auth/
          - internal/billing/
        target: 90%
```

Critical packages have higher floors; the rest of the repo has a lower floor.

### 9.4 Excluding generated code

Drop files matching `_gen.go`, `*.pb.go`, `mock_*.go`, etc. from the profile before reporting:

```bash
grep -vE '(_gen|_mock|\.pb)\.go:' cover.out > cover.filtered.out
mv cover.filtered.out cover.out
```

Or use `golang.org/x/tools/cover` programmatically — covered in the senior page.

## 10. Merging coverage profiles by hand

Sometimes you have two profiles and want one combined view. With Go 1.20+ binary profiles, `go tool covdata merge` handles this. For legacy text profiles, you can write a small Go program using `golang.org/x/tools/cover`:

```go
package main

import (
    "fmt"
    "os"
    "golang.org/x/tools/cover"
)

func main() {
    profiles1, err := cover.ParseProfiles(os.Args[1])
    if err != nil {
        panic(err)
    }
    profiles2, err := cover.ParseProfiles(os.Args[2])
    if err != nil {
        panic(err)
    }
    merged := mergeProfiles(profiles1, profiles2)
    out, _ := os.Create(os.Args[3])
    defer out.Close()
    fmt.Fprintln(out, "mode: set")
    for _, p := range merged {
        for _, b := range p.Blocks {
            fmt.Fprintf(out, "%s:%d.%d,%d.%d %d %d\n",
                p.FileName, b.StartLine, b.StartCol, b.EndLine, b.EndCol, b.NumStmt, b.Count)
        }
    }
}

func mergeProfiles(a, b []*cover.Profile) []*cover.Profile {
    byFile := map[string]*cover.Profile{}
    for _, p := range a {
        byFile[p.FileName] = p
    }
    for _, p := range b {
        if existing, ok := byFile[p.FileName]; ok {
            existing.Blocks = mergeBlocks(existing.Blocks, p.Blocks)
        } else {
            byFile[p.FileName] = p
        }
    }
    out := make([]*cover.Profile, 0, len(byFile))
    for _, p := range byFile {
        out = append(out, p)
    }
    return out
}

func mergeBlocks(a, b []cover.ProfileBlock) []cover.ProfileBlock {
    key := func(blk cover.ProfileBlock) [4]int {
        return [4]int{blk.StartLine, blk.StartCol, blk.EndLine, blk.EndCol}
    }
    byKey := map[[4]int]cover.ProfileBlock{}
    for _, blk := range a {
        byKey[key(blk)] = blk
    }
    for _, blk := range b {
        k := key(blk)
        if existing, ok := byKey[k]; ok {
            existing.Count += blk.Count
            byKey[k] = existing
        } else {
            byKey[k] = blk
        }
    }
    out := make([]cover.ProfileBlock, 0, len(byKey))
    for _, blk := range byKey {
        out = append(out, blk)
    }
    return out
}
```

This is rough but workable. Production tools handle edge cases (different modes, missing files) more carefully.

## 11. Coverage in CI

A complete CI snippet using GitHub Actions:

```yaml
name: test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: go test -race -coverprofile=cover.out -covermode=atomic ./...
      - uses: codecov/codecov-action@v4
        with:
          files: cover.out
          token: ${{ secrets.CODECOV_TOKEN }}
```

Things to note:

- `-race` is enabled, so `-covermode=atomic` is correct (or redundant; the test tool would force it anyway).
- `-coverprofile=cover.out` writes the profile.
- `codecov-action` uploads to Codecov.

For Coveralls, replace the last step with:

```yaml
      - uses: shogo82148/actions-goveralls@v1
        with:
          path-to-profile: cover.out
```

Both services accept the same text profile.

## 12. The mode field in the profile

The first line of `cover.out` declares the mode:

```
mode: set
```

or

```
mode: count
```

or

```
mode: atomic
```

This matters when merging profiles: you cannot merge a `set`-mode profile with a `count`-mode profile sensibly (the count fields mean different things). When merging, all input profiles should be the same mode, and the output profile records that mode.

`go tool covdata merge` enforces this. Hand-rolled mergers should too.

## 13. Coverage of code in vendor directories

If your project vendors dependencies (the `vendor/` directory pattern), those vendored packages are technically part of the module. By default they are *not* instrumented for coverage — vendored code is treated as third-party. To include them you would have to explicitly list them in `-coverpkg`, which is rarely useful.

The pragmatic stance: do not measure coverage of code you do not own. Vendored code's tests live in the upstream project.

## 14. Coverage of test helpers

Go tests often share helper functions in a `testutil` package or a `_test.go` file. These helpers are themselves Go code; do they count toward coverage?

- Helpers in a `_test.go` file: no. Test files are excluded from coverage.
- Helpers in a non-test file (e.g. `testutil/helpers.go`): yes, they are counted like any other code. To exclude them, either move them into `_test.go` files (using the `testing` package's testutil pattern) or use `-coverpkg` to exclude them by pattern.

The cleanest pattern: put test helpers in `_test.go` files in their own subdirectory (e.g. `internal/testutil/helpers_test.go`). They are then invisible to coverage and to production builds.

## 15. The `go test -cover ./...` percentage

Running `go test -cover ./...` shows per-package percentages. There is no single "module total" reported. To compute it:

```
go test -coverprofile=cover.out ./...
go tool cover -func=cover.out | tail -1
```

The last line of `-func` output is `total: (statements) X%`. This is the module-wide percentage.

But: this is across all packages with tests. Packages with no tests at all (because their `_test.go` files do not exist) contribute zero to the denominator — they are simply absent from the profile. To get the *real* module-wide percentage including untested packages, use `-coverpkg`:

```
go test -coverprofile=cover.out -coverpkg=./... ./...
go tool cover -func=cover.out | tail -1
```

Now packages without tests are in the denominator (and are 0% covered), pulling the total down.

This distinction matters when you report coverage: "70% across packages with tests" sounds great until someone notices that 30% of packages have no tests at all.

## 16. Setting up a CI policy

A reasonable middle-page CI policy:

1. Run `go test -race -coverprofile=cover.out ./...` on every PR.
2. Run `go tool cover -func=cover.out` and grep for the total line.
3. Fail the PR if the total is below a configured threshold (e.g. 70%).
4. Compare against the base branch's coverage; comment on the PR with the delta.
5. For a nightly job, also run with `-coverpkg=./...` and upload to Codecov.

This catches most "added code without tests" cases without becoming a heavy gate.

## 17. When coverage drops are legitimate

A PR sometimes drops the percentage and that is fine:

- **Deleting dead code**: removes both the (untested) statements from the numerator and denominator, but the ratio drops because dead code was already pulling the average up.
- **Refactoring to add helper functions**: shifts statements from one place to another; if the new helpers are not exercised by the existing tests, coverage drops temporarily.
- **Adding new public API surface**: introduces uncovered code by design; tests follow in a subsequent PR.

CI policies should accommodate these cases. The usual mechanism is a "you may merge if you click 'override'" escape hatch. Don't make coverage drops a hard fail.

## 18. The `-covermode` and the race detector

A common confusion: developers set `-covermode=atomic` thinking it adds race detection. It does not. `-race` is the race detector; `atomic` is the coverage counter discipline. They are independent in concept, related only because `-race` forces `-covermode=atomic` to avoid the race detector flagging counter writes.

In other words:

- `-race` only: real race detection on all memory, coverage off.
- `-cover` only: coverage on, no race detection.
- `-race -cover` (any mode): race detection on, coverage forced to atomic mode.
- `-covermode=atomic` only: coverage on with atomic counters, no race detection.

Pick what you actually want.

## 19. Coverage of test cases vs. assertion strength

This is worth restating in the middle context: coverage tells you which lines ran. It does not tell you which lines had their *behavior* checked. A test like this:

```go
func TestProcess(t *testing.T) {
    Process("input1")
    Process("input2")
    Process("input3")
}
```

has no assertions but produces full coverage of `Process`. The metric is satisfied; the test is worthless.

Middle-level engineers should know this rule cold and watch for it in code review. Tools like `gocyclo`, `golangci-lint`, and `goimports` do not flag this pattern. Mutation testing (covered in the professional page) does, by mutating `Process` and observing that the test still passes.

## 20. Coverage and refactoring

When you refactor, coverage should generally stay the same — you are not adding or removing behavior, just reorganizing it. A drop after a refactor usually means:

- You introduced a new code path you have not tested yet (e.g. error handling for a case that used to be impossible).
- You moved some logic from one package to another, and the original package's tests no longer cover it.
- You added helper functions whose internals are not directly tested.

The first case is real test debt; write the missing test. The second is a coverage accounting artifact; reorganize tests too. The third is usually fine — coverage of the helper comes from coverage of its caller.

A useful habit: re-run coverage after every meaningful refactor and look at the diff in HTML, not just the percentage.

## 21. Coverage of error wrappers

Many Go projects wrap errors:

```go
func doSomething() error {
    if err := step1(); err != nil {
        return fmt.Errorf("step1: %w", err)
    }
    if err := step2(); err != nil {
        return fmt.Errorf("step2: %w", err)
    }
    return nil
}
```

Each `if err != nil` block is two statements: the comparison and the return. If you test only the happy path, those returns stay uncovered. Coverage tools will flag them.

The tempting fix is to write tests like:

```go
func TestDoSomethingStep1Error(t *testing.T) {
    // somehow force step1 to fail...
}
```

But forcing `step1` to fail requires dependency injection or fault injection — complexity that may not be worth it. A pragmatic stance: leave the error-wrapper returns uncovered, but ensure at least one test exercises an error path so the *pattern* is verified. Coverage of every wrapper is rarely worth the engineering cost.

This is exactly the conversation that distinguishes a "coverage as target" team (forces 100% on these wrappers) from a "coverage as signal" team (accepts the gap with eyes open).

## 22. Sub-tests and coverage

Sub-tests via `t.Run` work normally with coverage:

```go
func TestParseTable(t *testing.T) {
    cases := []struct {
        name string
        in   string
        out  int
    }{
        {"basic", "1", 1},
        {"negative", "-1", -1},
        {"zero", "0", 0},
    }
    for _, c := range cases {
        c := c
        t.Run(c.name, func(t *testing.T) {
            got := Parse(c.in)
            if got != c.out {
                t.Fatalf("got %d, want %d", got, c.out)
            }
        })
    }
}
```

Each sub-test runs as part of `TestParseTable`. Coverage records statements executed by the body, regardless of which sub-test ran them. There is no "per-sub-test coverage" — it is all one run.

If you call `t.Parallel()` inside a sub-test, those sub-tests run concurrently. The same `set`-mode-is-fine logic applies.

## 23. Coverage of `TestMain`

`TestMain` is the package's test entry point if you define one. It runs once per test binary, sets up state, calls `m.Run()`, and tears down. Its body is instrumented like any other Go code.

```go
func TestMain(m *testing.M) {
    setup()
    code := m.Run()
    teardown()
    os.Exit(code)
}
```

The `setup`, `m.Run`, and `teardown` calls are covered as long as the binary runs. If `m.Run()` exits abnormally, `teardown` may not run and may stay uncovered — usually a minor concern.

## 24. Coverage of `init` functions

`init` runs once when the package is loaded. Any test binary that imports the package runs `init`. Coverage records `init` blocks as covered automatically.

Limitations:

- If `init` has branches (e.g. reads an env var), only the branch taken in the test environment is covered.
- Multiple `init` functions are allowed in a single package; they all run in source order.

If you need to test multiple branches of `init`, the cleanest approach is to refactor the logic into a regular function and call it from `init`. Then the function can be tested directly with different inputs.

## 25. Wrap-up

You should now be comfortable with:

- Choosing `-covermode` for your situation.
- Understanding the parallel-tests-and-atomic-mode relationship.
- Using `-coverpkg` to widen instrumentation in a controlled way.
- Aggregating coverage across packages in a monorepo.
- Knowing what counts and what does not (test files, vendored code, generated code).
- Integrating with CI via per-package profiles and external services.

The senior page builds on this with the Go 1.20 integration coverage feature, programmatic profile manipulation, and the design of robust CI coverage pipelines.

## 26. Quick reference card

```
# Default coverage
go test -cover ./...

# Profile with default mode (set)
go test -coverprofile=cover.out ./...

# Count mode for hot-path analysis
go test -covermode=count -coverprofile=cover.out ./...

# Atomic for parallel tests (auto-set by -race)
go test -covermode=atomic -coverprofile=cover.out ./...

# Race detector forces atomic
go test -race -coverprofile=cover.out ./...

# Cross-package instrumentation
go test -coverpkg=./... -coverprofile=cover.out ./...

# Restrict instrumentation to internal/
go test -coverpkg=./internal/... -coverprofile=cover.out ./...

# Per-function summary
go tool cover -func=cover.out

# HTML to a file (no browser)
go tool cover -html=cover.out -o coverage.html

# Module-wide total
go tool cover -func=cover.out | tail -1
```

Keep this handy; the rest of the subsection elaborates these primitives.

## 27. Common middle-level mistakes

1. **Enabling `-coverpkg=./...` without checking build time**: instrumentation cost is real. Profile your CI first.
2. **Manually setting `-covermode=atomic` when not needed**: the default is `set`, which is fastest. Only override for `-race` (forced anyway) or count-mode-with-parallelism.
3. **Merging profiles of different modes**: `set` + `count` is meaningless. Always merge same-mode profiles.
4. **Ignoring generated code in the denominator**: a swing in `.pb.go` can move the headline percentage by 20 points without any actual test changes.
5. **Treating per-package and cross-package coverage as the same number**: they answer different questions. Track both.
6. **Forgetting `-count=1` when testing the CI pipeline**: `go test` caches results aggressively. Use `-count=1` for repeatable benchmarking of the CI run itself.
7. **Running coverage on benchmarks**: `go test -bench=. -cover` distorts benchmark times. Use separate runs.
8. **Asking for atomic coverage on a single-threaded test**: cost without benefit. Use `set`.
9. **Writing tests just to lift the percentage**: produces brittle, assertion-free tests. Always write the assertion first.
10. **Refactoring without checking coverage afterward**: legit refactors should preserve coverage; if they do not, you have a hidden test debt.

That is the middle page. The senior page picks up from here with the Go 1.20 binary coverage feature, programmatic profile parsing, and CI pipeline design.

## 28. A deeper look at the instrumentation pass

The middle level is the right place to peek under the hood of how `-cover` actually works in the compiler. Understanding this demystifies the modes and lets you reason about edge cases.

When you run `go test -cover`, the test tool invokes the compiler with an extra phase: the cover rewriter. The rewriter parses your source files, walks the AST, and inserts counter-increment statements at the start of every basic block. Before instrumentation, your code might look like:

```go
func Process(x int) int {
    if x > 0 {
        return x * 2
    }
    return -1
}
```

After instrumentation (conceptually), the compiler sees:

```go
func Process(x int) int {
    GoCover_0.Count[0] = 1 // entry block
    if x > 0 {
        GoCover_0.Count[1] = 1 // true-branch block
        return x * 2
    }
    GoCover_0.Count[2] = 1 // fallthrough block
    return -1
}
```

The exact rewrite is in `cmd/cover` (Go 1.19 and earlier) or `cmd/compile`'s built-in coverage support (Go 1.20+). The block IDs are package-scoped and the counter array `GoCover_0` is generated at package initialization time. Each instrumented file has its own counter array.

When the test binary exits, a deferred handler walks each counter array, computes the line ranges for each block, and writes the profile file in the format documented in the specification page.

Important consequences of this design:

- **Line numbers in errors may be off**. The rewriter inserts statements, which shifts later lines. If a test fails on a line that the rewriter changed, the reported line number may not match your source. Most editors and `go test` itself adjust for this, but raw `go vet` output on instrumented sources can confuse you.
- **The instrumented binary is bigger**. Each block adds a counter increment and the counter array adds bytes. For typical packages this is a few percent.
- **The instrumented binary is slower**. Each block executes one extra write (set/count) or one extra atomic op (atomic). For tight loops in hot code, the slowdown can be 10–30%.

## 29. Reading the rewriter output

You can see exactly what the rewriter does:

```
$ go tool cover -mode=set -var=MyCover myfile.go
```

This prints the rewritten source to stdout. Try it on a simple file and watch the counter increments appear. The `-var` flag names the counter variable; the default name is something autogenerated.

The output is real Go code; you could compile it yourself. The `go test` tool does this automatically as part of `-cover`.

Reading the rewritten source is a great way to build intuition for what coverage actually measures. You can see for yourself that:

- Each `if` body gets its own block, but the *condition* of the `if` is part of the *enclosing* block.
- A `switch` has one block per case body, but the discriminator expression is part of the enclosing block.
- A `for` loop has one block for the body. Loop headers (the init and the condition) are part of the enclosing block.
- A function call within a block does *not* split the block, even though it might never return (panic, exit).

This last point is the source of an entire category of coverage surprises: if a block contains a call to a function that panics, the panic happens *during* the call, so the coverage counter for that block was already set (it was set at block entry, before the call). Coverage shows the block as "covered" even though the rest of the block never executed.

## 30. Coverage of code after a possible panic

A consequence of the previous section:

```go
func Process(items []int) int {
    sum := 0       // block entry: counter set here
    for _, x := range items {
        sum += x * doSomething(x) // doSomething may panic
    }
    return sum     // covered? depends.
}
```

Suppose `doSomething(x)` panics for some `x`. The `sum += ...` line is in the loop-body block, which is entered before the panic — so the loop body counter is set. The `return sum` is in a different block, the function's "after the loop" block, which is only entered if the loop completes normally. If the panic propagates out, the `return sum` block stays uncovered.

This is not surprising once you internalize the block model, but it can lead to coverage gaps that look mysterious until you trace the control flow.

## 31. Coverage of `goto`

Go supports `goto` (rarely used). The cover rewriter handles it by treating each labeled section as its own block. A `goto` jumps directly to a labeled block, incrementing only that block's counter.

```go
func loop(n int) int {
    i := 0
again:
    if i >= n {
        goto done
    }
    i++
    goto again
done:
    return i
}
```

Each label starts a new block. Tests that exercise the loop cover `again`; tests that exit (which is required to return) cover `done`. The instrumentation handles this transparently.

## 32. Coverage of `select` revisited

`select` deserves its own subsection because beginners often misunderstand its coverage:

```go
func dispatch(ch chan int, done chan struct{}) int {
    select {
    case v := <-ch:
        return v
    case <-done:
        return -1
    case <-time.After(time.Second):
        return -2
    }
}
```

Three cases. Each case body is its own block. The `select` itself is part of the enclosing block — the comparison/dispatch happens implicitly in the runtime, not in source.

Each test exercises exactly one case (whichever fires first). To get 100% coverage you need three tests, each setting up channels so a different case wins.

The third case (the timeout) is hard to test in isolation because of the wall-clock dependency. Common workarounds:

- Inject the timer source as a parameter or interface.
- Use a very short timeout (1 millisecond) and accept that test runs may flake.
- Skip coverage for that specific branch and document it.

This is a classic "coverage forces testability concerns" moment. Some teams refactor; others accept the gap.

## 33. Coverage of `defer` revisited

`defer` registers a function to run when the enclosing function returns. The deferred function's body, if a closure, is its own block (counted when called). If the deferred function is a named function, its body's coverage is independent — recorded whenever that function runs from anywhere, deferred or not.

```go
func Process() error {
    f, err := os.Open("foo")
    if err != nil {
        return err
    }
    defer func() {
        f.Close() // covered when Process returns
    }()
    // ... do work
    return nil
}
```

The closure body is covered any time `Process` returns (after the `defer`). If `Process` returns before reaching the `defer` (via the early `return err`), the closure body is not covered.

For real programs this is mostly background noise. Cleanup is always coverable by a test that goes the happy path; the only uncovered case is when an early error prevents the defer.

## 34. Coverage of generic functions

Go 1.18+ supports generics. How does the cover rewriter handle generic functions?

The generic function body is instrumented like any other body. When the function is instantiated for specific type arguments at compile time, each instantiation shares the same source line numbers (and the same block IDs). Coverage records execution per *block*, not per *instantiation*.

```go
func Max[T constraints.Ordered](a, b T) T {
    if a > b {
        return a
    }
    return b
}
```

A test calling `Max(1, 2)` and another calling `Max("a", "b")` both contribute to the same block counters. The HTML report shows `Max` once with its blocks colored by execution, not separately for each instantiation. This is usually what you want — the function is logically one piece of source.

If you specifically want to verify that *every* instantiation was tested, you need a different tool — coverage cannot help.

## 35. Coverage of receiver methods

A method is just a function with a special receiver. It is instrumented identically to a non-method function:

```go
func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    // ... instrumented like any function body
}
```

The receiver `s *Server` is just an argument from the cover rewriter's perspective. Each block in `Handle` gets its own counter. No special treatment.

## 36. Coverage of interface methods

Interface methods themselves are not instrumented — they are abstract. What gets instrumented is each *implementation* of the interface. If you have:

```go
type Greeter interface {
    Greet() string
}

type EnglishGreeter struct{}
func (EnglishGreeter) Greet() string { return "hello" }

type SpanishGreeter struct{}
func (SpanishGreeter) Greet() string { return "hola" }

func Welcome(g Greeter) {
    fmt.Println(g.Greet())
}
```

`Welcome` is instrumented. Its body counter is bumped whenever it runs. The `Greet` method on each implementation is also instrumented separately. A test calling `Welcome(EnglishGreeter{})` covers the `EnglishGreeter.Greet` body but *not* `SpanishGreeter.Greet`. If you only test `Welcome` with `EnglishGreeter`, `SpanishGreeter.Greet` stays at 0% even though the interface contract is satisfied.

This is a real coverage gap: implementations of interfaces are easy to leave uncovered because the calling code does not know which implementation it is using.

The fix: write tests for each implementation directly, or write integration tests that exercise the calling code with each implementation.

## 37. Coverage of type assertions and type switches

Type assertions (`v, ok := x.(SomeType)`) and type switches (`switch v := x.(type) { ... }`) are control flow constructs the rewriter handles. Each case of a type switch is its own block; the assertion's success and failure paths split into different blocks.

```go
func handle(x interface{}) string {
    switch v := x.(type) {
    case int:
        return fmt.Sprintf("int %d", v)
    case string:
        return "string " + v
    default:
        return "unknown"
    }
}
```

Three blocks, one per case. A test passing only `int`s covers one third. To get 100% you need at least three tests with different runtime types.

## 38. Coverage of error wrapping (`errors.Is`/`errors.As`)

The control flow around `errors.Is` and `errors.As` is normal Go: an `if` with a condition, a body, and a fallthrough. Coverage treats them like any other `if`. The wrapped errors themselves are not relevant to coverage — the metric is about source line execution, not about error identity.

A common confusion: developers expect that "the wrapped error path" should have its own coverage, but Go does not model that. The error path is just normal code being executed with a wrapped value.

## 39. Coverage of init order

Multiple `init` functions in the same package run in source order (top to bottom, file alphabetical). Each `init` is instrumented separately. If `init1` runs before `init2`, both are covered, both have their bodies recorded.

If you have inter-init dependencies and only some inits run (perhaps an init causes a panic), later inits may not run and stay uncovered. This is a rare situation but worth knowing.

## 40. Coverage of CGO

`cgo` lets Go call C code. The Go side of a cgo call is instrumented; the C side is not. Coverage only measures Go statements. If your package is mostly thin Go wrappers around C, coverage shows the wrappers but not the C work, so a 100% covered package may still hide critical untested C code.

For testing C code from Go, use the C-side test framework (CUnit, criterion) and report separately.

## 41. Coverage of assembly

Go allows hand-written assembly in `.s` files. These are not instrumented; coverage shows nothing for them. Assembly-heavy packages like `crypto/sha256` show some Go function declarations as uncovered (the Go-side function signatures point to assembly bodies); the actual coverage of the assembly is invisible.

This is intentional — there is no good way to instrument hand-written assembly without breaking it.

## 42. The `mode:` line and `-mode` consistency

The first line of a profile file is `mode: X` where X is set, count, or atomic. The mode is determined by the `-covermode` of the test run, or the default behavior:

- Without `-covermode` and without `-race`: `set`.
- With `-covermode=foo`: `foo`.
- With `-race` and without `-covermode`: `atomic`.
- With `-race` and `-covermode=foo`: `atomic` (forces, regardless of `foo`).

A common surprise: if you build a profile with `-race -covermode=count`, the profile says `mode: atomic` because the test tool promotes count to atomic when `-race` is present. Trust the `mode:` line as ground truth.

## 43. Aggregating across multiple runs

If you want to combine the coverage of two separate test invocations — e.g. unit tests + integration tests — you have a few options:

1. **Run them as one command if possible**: `go test ./... ./integration/...`. A single profile, no merging.
2. **Run separately and merge text profiles** with `golang.org/x/tools/cover` (see section 10 above).
3. **Run separately and merge binary profiles** with `go tool covdata merge` (Go 1.20+, see senior page).

For the middle level, option 2 is the lift you can do without binary tooling.

A typical script:

```bash
#!/bin/bash
set -e

go test -coverprofile=unit.out -covermode=atomic ./...
go test -tags=integration -coverprofile=int.out -covermode=atomic ./...
go run ./tools/cover-merge -o=cover.out unit.out int.out
go tool cover -func=cover.out
```

The `tools/cover-merge` program is the merger from section 10. Modes must match across all profiles.

## 44. Coverage and build tags

Build tags conditionally compile code. Coverage only sees code that is part of the current build:

```go
//go:build integration

package mypkg

func IntegrationOnly() { /* ... */ }
```

If you build without `-tags=integration`, `IntegrationOnly` does not exist; coverage cannot count it. If you build with `-tags=integration`, it is instrumented like any other function.

For complete coverage across tag combinations, run tests in multiple tag configurations:

```bash
go test -coverprofile=normal.out ./...
go test -tags=integration -coverprofile=integration.out ./...
# Merge them
```

Each build sees a different set of source files; the merged profile represents the union.

## 45. Coverage of conditional code in a single file

Go does not have C-style preprocessor conditionals, but you can simulate them with build tags. A more common pattern is runtime conditional behavior:

```go
func Process() {
    if config.UseFastPath {
        fastPath()
    } else {
        slowPath()
    }
}
```

If your test only exercises the `UseFastPath = true` configuration, `slowPath` is uncovered. To get both, write tests that flip the config:

```go
func TestProcessFastPath(t *testing.T) {
    save := config.UseFastPath
    defer func() { config.UseFastPath = save }()
    config.UseFastPath = true
    Process()
    // ...
}

func TestProcessSlowPath(t *testing.T) {
    save := config.UseFastPath
    defer func() { config.UseFastPath = save }()
    config.UseFastPath = false
    Process()
    // ...
}
```

Note the careful save/restore around the global config — without it, parallel tests would interfere.

For tests that genuinely need to mutate globals, consider using `t.Setenv` for env-var-driven config, or refactor to dependency injection so the config can be passed as an argument.

## 46. Coverage as part of a quality dashboard

Many teams display coverage on a dashboard alongside other metrics:

- Test count and runtime.
- Test flakiness rate.
- Linter warning count.
- Cyclomatic complexity.
- Static analysis findings.

Coverage by itself is misleading; in context with these other signals it tells a richer story. A package with 90% coverage, 0 flaky tests, low complexity, and no linter warnings is in much better shape than a package with 90% coverage, 12 flaky tests, high complexity, and a flood of `// nolint:gosec` annotations.

Tools like SonarQube, CodeClimate, and Codacy aggregate these metrics. You can also build a simple custom dashboard with the per-function output of `go tool cover -func` and other tools' JSON outputs.

## 47. Coverage and refactor PRs

A refactor PR that touches many files but adds no behavior should *not* change coverage. If your CI reports a 5-point drop on a "pure refactor" PR, dig in. Probable causes:

1. The refactor exposed code that was previously dead (declared but never reached) and is still dead — but now lives in a different file, so the coverage attribution shifted.
2. The refactor introduced a new pattern (e.g. error wrapping) whose newly-added lines are not tested.
3. The refactor moved a function from a heavily-tested package to a less-tested one, so the function's coverage contribution moved from "high" to "low".

In each case, the refactor revealed a pre-existing testing gap. The right response is usually "add the missing tests as part of the same PR" or "track it as a follow-up". Just don't ignore it.

## 48. Coverage of helper code in tests

Test code itself is not covered. But the helper code in non-test files (e.g. `testutil/`) is covered. This creates a subtle anti-pattern: if you put test helpers in non-test files for reusability, they count toward the production coverage denominator. Untested helper functions drag down the percentage.

A clean pattern: test helpers go in `_test.go` files (perhaps in a `testhelpers_test.go` in each package). They are then invisible to coverage and to production builds.

If you genuinely need shared test helpers across packages, put them in a package whose name ends in `test` (e.g. `internal/dbtest`) — Go does not have a special exclusion for this, but the convention is to mark the package as test-only via build tags or naming.

## 49. Coverage of code reachable only via reflection

Reflection lets you invoke methods by name at runtime. The cover rewriter treats methods called via reflection identically to direct calls — once the method body executes, its blocks are recorded as covered.

This means tests that drive a system via reflection (e.g. RPC dispatch tests, JSON unmarshalers driving struct setters) do contribute coverage to the underlying methods. Useful for plugin architectures or interface-heavy systems.

## 50. Reading shared profiles in CI artifacts

In CI, the coverage profile is usually uploaded as an artifact. You can download it and re-render locally:

```bash
# Download cover.out from CI
go tool cover -html=cover.out -o coverage.html
open coverage.html
```

This is sometimes faster than browsing the CI's hosted reports, especially if you want to grep for specific lines.

## 51. Closing the middle page

You can now:

- Choose modes with reason: `set` for fastest, `atomic` for parallelism, `count` for hot-path analysis.
- Reason about coverage in concurrent code: when atomic is needed, when `set` is enough.
- Use `-coverpkg` to instrument dependencies, with awareness of the denominator effect.
- Aggregate profiles across packages and test runs.
- Work with build tags, generics, init order, and other Go-specific concerns.
- Avoid common middle-level mistakes around generated code, vendor directories, and pure-refactor PRs.

The senior page extends this with Go 1.20 binary coverage (covering integration tests of compiled binaries), programmatic profile manipulation for custom CI policies, and integration into mature CI pipelines.

Take a moment to internalize one more rule before moving on: **coverage is a diagnostic, not a verdict**. Use it to find places where tests are missing, but always pair it with a question — "what does this missing test verify?" — before writing one. The point is not to cover the line; the point is to verify behavior. The coverage tool will count both, but only one is engineering.

## 52. Worked example: a small HTTP handler

Let's wrap up with a more concrete monorepo-style example. Imagine a tiny package implementing an HTTP handler in one part of a larger codebase. We will instrument it, test it, and watch how `-coverpkg` versus the default changes the picture.

The package `httpapi`:

```go
// httpapi/handler.go
package httpapi

import (
    "encoding/json"
    "net/http"
    "strings"
)

type Server struct {
    users map[string]string
}

func NewServer() *Server {
    return &Server{users: map[string]string{}}
}

func (s *Server) Register(mux *http.ServeMux) {
    mux.HandleFunc("/users", s.handleUsers)
    mux.HandleFunc("/health", s.handleHealth)
}

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodPost:
        s.createUser(w, r)
    case http.MethodGet:
        s.listUsers(w, r)
    default:
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
    var u struct{ Name, Email string }
    if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    if strings.TrimSpace(u.Name) == "" || !strings.Contains(u.Email, "@") {
        http.Error(w, "invalid input", http.StatusBadRequest)
        return
    }
    s.users[u.Name] = u.Email
    w.WriteHeader(http.StatusCreated)
}

func (s *Server) listUsers(w http.ResponseWriter, _ *http.Request) {
    if err := json.NewEncoder(w).Encode(s.users); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
    }
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("ok"))
}
```

A driver `cmd/api/main.go`:

```go
package main

import (
    "log"
    "net/http"
    "example.com/httpapi"
)

func main() {
    s := httpapi.NewServer()
    mux := http.NewServeMux()
    s.Register(mux)
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```

And one test file:

```go
// httpapi/handler_test.go
package httpapi

import (
    "bytes"
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestCreateUser(t *testing.T) {
    s := NewServer()
    body := []byte(`{"name":"Alice","email":"alice@example.com"}`)
    req := httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader(body))
    rec := httptest.NewRecorder()
    s.handleUsers(rec, req)
    if rec.Code != http.StatusCreated {
        t.Fatalf("got %d", rec.Code)
    }
}

func TestHealth(t *testing.T) {
    s := NewServer()
    req := httptest.NewRequest(http.MethodGet, "/health", nil)
    rec := httptest.NewRecorder()
    s.handleHealth(rec, req)
    if rec.Code != http.StatusOK {
        t.Fatalf("got %d", rec.Code)
    }
}
```

Run with the default:

```
$ go test -coverprofile=cover.out ./httpapi
PASS
coverage: 50.0% of statements
ok      httpapi    0.122s
```

The HTML shows `listUsers`, the GET branch, the method-not-allowed branch, and the bad-input branches are uncovered. We will not write more tests now — the point is to compare coverage views.

Default view (just `httpapi`):

```
$ go tool cover -func=cover.out | tail
httpapi/handler.go:14: NewServer       100.0%
httpapi/handler.go:18: Register        0.0%
httpapi/handler.go:23: handleUsers     50.0%
httpapi/handler.go:33: createUser      50.0%
httpapi/handler.go:48: listUsers       0.0%
httpapi/handler.go:54: handleHealth    100.0%
total:                 (statements)    50.0%
```

`Register` is uncovered because no test calls it. `cmd/api/main.go` does, but `cmd/api` is not in the default scope.

Now widen with `-coverpkg`:

```
$ go test -coverpkg=./... -coverprofile=cover.out ./httpapi
PASS
coverage: 40.0% of statements
ok      httpapi    0.124s
```

The percentage *dropped* — from 50% to 40%. Why? Because `-coverpkg=./...` includes `cmd/api/main.go` in the denominator. `main`'s 10 statements (the setup, server creation, listen call) are now uncovered and pulling down the average.

Per-function:

```
$ go tool cover -func=cover.out | tail
cmd/api/main.go:7:        main             0.0%
httpapi/handler.go:14:    NewServer        100.0%
httpapi/handler.go:18:    Register         0.0%
httpapi/handler.go:23:    handleUsers      50.0%
httpapi/handler.go:33:    createUser       50.0%
httpapi/handler.go:48:    listUsers        0.0%
httpapi/handler.go:54:    handleHealth     100.0%
total:                    (statements)     40.0%
```

The denominator now includes `cmd/api/main.go`. The total moved.

Add an integration test that uses `NewServer().Register(...)`:

```go
func TestIntegration(t *testing.T) {
    s := NewServer()
    mux := http.NewServeMux()
    s.Register(mux)
    srv := httptest.NewServer(mux)
    defer srv.Close()
    resp, _ := http.Get(srv.URL + "/health")
    if resp.StatusCode != 200 {
        t.Fatal("bad status")
    }
}
```

Re-run with `-coverpkg`:

```
coverage: 45.0% of statements
```

`Register` is now covered. `main` still is not — `httptest.NewServer` does not exercise `main`'s `http.ListenAndServe`. Only the Go 1.20 integration coverage feature can cover `main` cleanly, and that is the senior page's topic.

This worked example illustrates the key middle-level lessons:

- `-coverpkg` widens the denominator. Numbers usually go down.
- Per-function output identifies the uncovered functions exactly.
- Some code (like `main`) is structurally hard to cover from `go test`. Don't chase it without the right tool.
- Integration tests via `httptest` lift coverage of "wiring" code like `Register`.

## 53. The full middle-page mental model

Pulling it all together:

1. **Mode selection** is a performance/correctness trade-off. `set` for fastest, `atomic` for `-race` or parallel-with-counts, `count` for hot-path analysis.
2. **Scope selection** is a denominator question. Default covers just the tested package; `-coverpkg` widens to many packages, lowering the percentage but giving a fuller picture.
3. **Aggregation** is about combining multiple test runs into one report. Use `cover.ParseProfiles` for text profiles or `go tool covdata merge` for binary ones.
4. **Excluding** generated code, vendored code, and test helpers is essential for meaningful percentages. Post-process the profile.
5. **CI integration** uploads profiles to Codecov or Coveralls and gates on per-directory thresholds, not whole-repo numbers.
6. **The metric** measures statements, not branches, not assertions, not concurrency interleavings. Treat it as a flashlight, not a scorecard.

That is everything the middle-level Go developer needs to wield coverage effectively. The senior page builds on this with the binary coverage tooling, programmatic profile manipulation, and the design of production CI pipelines around coverage data.


