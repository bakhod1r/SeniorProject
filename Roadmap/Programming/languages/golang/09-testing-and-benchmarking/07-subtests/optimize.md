---
layout: default
title: Subtests — Optimize
parent: Subtests (t.Run)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/optimize/
---

# Subtests — Optimize

[← Back](../)

## Reduce wall-clock time

Convert independent table cases to parallel:

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        check(tc)
    })
}
```

Combined with `-parallel N`, this divides a 200ms suite by N up to the
ceiling. Note: under Go 1.21 and earlier, also add `tc := tc`.

## Share expensive fixtures

If each case spins up a server, do it once in the parent and pass the
handle into each subtest. Use `t.Cleanup(srv.Shutdown)` on the parent so
shutdown happens after all parallel children complete.

## Group by `-run` for selective re-runs

When debugging one failing case, run only that subtest:

```
go test -run 'TestParse/^bad_utf8$' -v
```

This avoids rebuilding fixtures for the entire family.

## Avoid over-nesting

Three nested levels (`TestX/group/case/variant`) makes `-run` patterns hard
to type and `-v` output noisy. Two levels is usually enough; flatten the
third into the case name (`group_variant`).

## Don't pay for `t.Parallel` on trivial cases

For sub-millisecond cases, `t.Parallel` adds scheduler overhead without
saving meaningful wall-clock time. Reserve it for IO-bound or
compute-heavy cases.

## Use `-skip` for known-slow cases

Go 1.20 added `-skip`:

```
go test -run TestParse -skip 'TestParse/slow_'
```

This is cleaner than wrapping every slow case in `if testing.Short()`.

## Reuse build cache across subtests

Subtests live in one binary; switching from many `TestXxx` files to one
table-driven function with subtests can reduce per-package overhead when
the package contains hundreds of cases.

## Limit cleanup work

Cleanups run after every subtest. Heavy work in cleanup (full DB resets,
filesystem walks) multiplies by the number of cases. Push expensive
teardown to the parent's cleanup when safe, and let per-subtest cleanups
do only the minimum.

## Avoid per-subtest allocations

If your test creates a 10MB buffer per subtest, a table of 100 cases
allocates 1GB. Either share a pooled buffer across cases (cleanly,
without contention) or shrink the per-case work.

## Use `-count=1` to bypass the test cache only when needed

The Go test cache skips re-running tests with unchanged inputs. For CI,
this is gold. For local iteration on a flaky test, `-count=1` forces a
re-run. Don't enable it globally; the cache pays off.

## Profile with `-cpuprofile`

If a subtest suite is slow and you don't know which case dominates:

```
go test -cpuprofile=cpu.out -run TestX
go tool pprof cpu.out
```

The profile attributes time per function, not per subtest, but the
function names usually reveal which case's path is hot.

## Trade-offs of parallelism

Parallelism has overhead: goroutine scheduling, lock contention on shared
fixtures, race detector instrumentation when `-race` is set. For
sub-millisecond cases, the overhead can exceed the savings. Benchmark
before assuming `t.Parallel` is faster.

## Sharing expensive setup across packages

When many packages need the same fixture (e.g., a test database), spin
it up in a `setup_test.go` with build tag, or use `go test -p 1` to
serialize packages and reuse process-wide state. Cross-package fixtures
sit outside the subtest model but interact with it.

## Pre-allocate the cases slice

```go
cases := make([]tc, 0, 100)
for /* ... */ {
    cases = append(cases, ...)
}
```

For tables generated from external data, pre-sizing the slice avoids
growing it. Negligible for hundreds of cases; meaningful for hundreds
of thousands.

## Skip cases under `testing.Short()`

```go
for _, tc := range cases {
    if tc.slow && testing.Short() {
        continue
    }
    t.Run(tc.name, ...)
}
```

For `go test -short` runs (typical for pre-commit hooks), expensive
cases are excluded automatically. Long mode runs them all.

## Use `t.Parallel` selectively

Mark every CPU-light, IO-light case `t.Parallel`. Skip it for cases
that:

- Need exclusive access to a shared resource.
- Mutate process-global state (`os.Setenv`, working directory).
- Are short enough that scheduler overhead dominates.

## Measure before optimizing

Subtest performance work is the easiest place to write fast wrong code.
Always run `go test -v -bench .` or `time go test ./pkg` before and
after a change. Tens of milliseconds is the threshold below which
optimization rarely pays.

## Reduce test binary size

A package with thousands of subtests has a large test binary. To
shrink:

- Move helper code out of `*_test.go` files into the production package
  (when reusable) or a shared internal test package.
- Avoid importing heavy dependencies just for tests.
- Use build tags to exclude expensive test code from default builds.

A smaller binary loads faster, improving CI startup time.

## Cache test results

Go's test cache skips re-running tests when inputs haven't changed.
To maximize cache hits:

- Avoid `os.Getenv` for non-cache-related env vars (the cache key
  includes env).
- Avoid `time.Now()` in test inputs (changes every run).
- Avoid random data without a seed.

Pure tests with deterministic inputs cache reliably.

## Order cases by speed

Within a sequential subtest suite, run fast cases first. Failures
in fast cases give quick feedback; slow cases run only if everything
fast passed.

```go
sort.Slice(cases, func(i, j int) bool {
    return cases[i].expectedDuration < cases[j].expectedDuration
})
```

For parallel suites, the order doesn't matter (the framework
schedules concurrently).

## Use t-shirt sizing for cases

Tag each case with a size: small (sub-millisecond), medium (under
a second), large (multi-second). Run small in pre-commit, medium in
PR, large in nightly. Filter with `-skip`.

## Drop unnecessary subtests

A subtest that asserts only one thing and has no shared setup with
others adds framework overhead without value. If you have:

```go
t.Run("case1", func(t *testing.T) {
    if got := f(); got != 1 { t.Error("got", got) }
})
```

And `case1` is the only subtest, just write the assertion directly in
the test function.

## Limit log output

`t.Log` calls accumulate in the per-test buffer. For a subtest that
logs heavily, the buffer can grow into megabytes. Either:

- Log only in `-v` mode by checking `testing.Verbose()`.
- Reduce log verbosity in tight loops.
- Use a separate sink for verbose diagnostic output.

## Profile slow suites

If a test suite is slow:

```
go test -cpuprofile=cpu.out -memprofile=mem.out ./pkg
go tool pprof -http :8080 cpu.out
```

The profile attributes time to functions, not subtests, but
function names reveal which path dominates. Combined with
`-bench`, you can quantify the cost of specific code paths.

## Use `-failfast` for development

```
go test -failfast ./pkg
```

Stops after the first failure. Saves time during the inner-loop
debugging phase. Don't use in CI, where you want to see all
failures.

## Avoid expensive setup in tight tables

```go
for _, tc := range cases {
    srv := startServer() // expensive, runs N times
    t.Run(tc.name, func(t *testing.T) {
        // ...
        srv.Close()
    })
}
```

Move setup outside the loop if cases can share it:

```go
srv := startServer()
defer srv.Close()
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        // ... uses srv
    })
}
```

The trade-off is parallelism: shared `srv` must be safe for
concurrent calls if subtests are parallel.

## Right-size `-parallel`

The default `-parallel N` is `GOMAXPROCS`. For CPU-light, IO-heavy
tests, increasing `-parallel` (e.g., to 32 on a 4-core machine)
overlaps IO and gets better wall-clock performance. For CPU-bound
tests, the default is right.

Measure: run with `-parallel 4`, `-parallel 8`, `-parallel 16` and
pick the elbow of the speedup curve.
