---
layout: default
title: Parallel Tests — Specification
parent: Parallel Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/09-parallel-tests/specification/
---

# Parallel Tests — Specification

[← Back](../)

This page collects the normative text that defines parallel-test behavior in Go. Every rule on the other pages can be traced back to one of these excerpts. References are to the `testing` package godoc (`go doc testing`), the `go help testflag` output, and the `cmd/go` source tree (`src/cmd/go/internal/test`).

## 1. `testing.T.Parallel`

From `src/testing/testing.go`, the godoc comment for `(*T).Parallel`:

> Parallel signals that this test is to be run in parallel with (and only with) other parallel tests. When a test is run multiple times due to use of -test.count or -test.cpu, multiple instances of a single test never run in parallel with each other.

Key normative bullets:

1. `Parallel` may be called at most once per test. Calling it twice panics with `testing: t.Parallel called multiple times`.
2. `Parallel` pauses the current goroutine until the parent test has completed all its serial work and `m.Run` has decided to release parallel tests.
3. Parallel tests only run in parallel with *other parallel tests*. Serial tests in the same package still run one at a time.
4. The same test function executed under `-count=N` or `-cpu=N1,N2` never runs concurrently with itself.

## 2. `testing.T.Setenv` and the implicit serial mark

From `src/testing/testing.go`, `(*T).Setenv` godoc:

> Setenv calls os.Setenv(key, value) and uses Cleanup to restore the environment variable to its original value after the test. ... Because Setenv affects the whole process, it cannot be used in parallel tests or tests with parallel ancestors.

Behavior:

- Calling `t.Setenv` after `t.Parallel` panics with `testing: t.Setenv called after t.Parallel; cannot set environment variables in parallel tests`.
- Calling `t.Parallel` after `t.Setenv` panics with `testing: t.Parallel called after t.Setenv; cannot set environment variables in parallel tests`.
- The same rule applies transitively through subtests: a child cannot call `t.Parallel` if any ancestor called `t.Setenv`.

## 3. `testing.T.Chdir` (Go 1.24+)

From `src/testing/testing.go`, `(*T).Chdir` godoc (introduced in Go 1.24):

> Chdir calls os.Chdir(dir) and uses Cleanup to restore the current working directory to its original value after the test. ... Because Chdir affects the whole process, it cannot be used in parallel tests or tests with parallel ancestors.

The serialization rule mirrors `t.Setenv`: `t.Chdir` and `t.Parallel` are mutually exclusive on the same test or any ancestor.

## 4. `-parallel` flag

From `go help testflag`:

> -parallel n
>     Allow parallel execution of test functions that call t.Parallel, and
>     fuzz targets that call t.Parallel when running the seed corpus.
>     The value of this flag is the maximum number of tests to run
>     simultaneously.
>     While fuzzing, the value of this flag is the maximum number of
>     subprocesses that may call F.Fuzz concurrently, regardless of
>     whether T.Parallel is called.
>     By default, -parallel is set to the value of GOMAXPROCS.
>     Setting -parallel to a value higher than GOMAXPROCS may cause
>     degraded performance due to CPU contention, especially when fuzzing.
>     Note that -parallel only applies within a single test binary.
>     The 'go test' command may run tests for different packages
>     in parallel as well, according to the setting of the -p flag (see 'go help build').

## 5. `-p` flag (package-level parallelism)

From `go help build`:

> -p n
>     the number of programs, such as build commands or
>     test binaries, that can be run in parallel.
>     The default is GOMAXPROCS, normally the number of CPUs available.

`-p` and `-parallel` compose: `go test -p 4 -parallel 8 ./...` may run 4 test binaries simultaneously, each executing up to 8 parallel tests, for a peak of 32 concurrent `testing.T` instances.

## 6. `-race` flag

From `go help testflag` (and `go help build`):

> -race
>     enable data race detection. Supported only on linux/amd64, freebsd/amd64,
>     darwin/amd64, darwin/arm64, linux/ppc64le and linux/arm64.

The race detector instruments memory accesses at compile time and reports unsynchronized read/write pairs at runtime. Combined with `t.Parallel`, it is the canonical way to detect shared-state bugs across tests. The race detector adds 5x–10x runtime overhead and ~10x memory; CI configurations typically run a separate `-race` job.

## 7. `-cpu` flag

From `go help testflag`:

> -cpu 1,2,4
>     Specify a list of GOMAXPROCS values for which the tests, benchmarks
>     or fuzz tests should be executed. The default is the current value
>     of GOMAXPROCS. -cpu does not apply to fuzz tests matched by -fuzz.

`-cpu` is orthogonal to `-parallel`: the former sets `runtime.GOMAXPROCS` for the test binary, the latter caps the number of concurrently running `t.Parallel` tests. Under `-cpu=1,2,4` every test function runs three times, each at a different GOMAXPROCS.

## 8. `TestMain` and parallel tests

From `src/testing/testing.go`, `M.Run` godoc:

> Run runs the tests. It returns an exit code to pass to os.Exit.

Inside `m.Run`:

1. Tests are matched against `-run` and executed in the order they appear in the source.
2. A test that calls `t.Parallel` is paused and added to the parallel queue.
3. After all serial tests in the current "level" (top-level or subtest level) finish, the parallel queue is drained respecting `-parallel`.
4. `m.Run` only returns after all parallel tests have completed, so `TestMain` teardown is guaranteed to run last.

## 9. Subtests and the parallel hierarchy

From the `testing` package documentation on subtests:

> A subtest is run in its own goroutine. The parent test's goroutine returns from t.Run only after the subtest has finished. Calling t.Parallel in a subtest pauses the subtest until its sibling subtests have all started or completed serially.

Concretely:

- A subtest that calls `t.Parallel` runs in parallel with **its sibling subtests** that also called `t.Parallel`.
- The parent `t.Run` call returns when *all serial subtests* have finished and *all parallel subtests* have been *registered* (not necessarily completed).
- To wait for a group of parallel subtests, wrap them in another `t.Run`:

```go
t.Run("group", func(t *testing.T) {
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            // ...
        })
    }
})
// After this point, all "group/*" parallel subtests are guaranteed to be done.
```

## 10. `t.Cleanup` ordering with parallel tests

From `(*T).Cleanup` godoc:

> Cleanup registers a function to be called when the test (or subtest) and all its subtests complete. Cleanup functions will be called in last added, first called order.

For parallel tests:

- Cleanup functions registered before `t.Parallel` still run after the parallel work completes.
- Each parallel test's cleanups run on its own goroutine, after the test function returns.
- A parent test's cleanups run only after *all* of its parallel subtests have finished.

## 11. Loop-variable capture (Go versions before 1.22)

In Go 1.21 and earlier:

> A loop variable in `for k, v := range slice` had a single address for the entire loop. A closure capturing `v` saw the final iteration's value.

In Go 1.22+:

> Each iteration of a `for` loop creates a new instance of each variable declared in the loop's init or range clause.

Tests that called `t.Parallel` inside a `for ... := range cases` loop without the `tc := tc` shadow saw all goroutines run against the last test case on Go ≤1.21. The fix on older versions:

```go
for _, tc := range cases {
    tc := tc // re-declare per iteration
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // tc is safe to capture here.
    })
}
```

On Go ≥1.22 the explicit shadow is redundant but harmless. `go vet`'s `loopclosure` analyzer flags the pre-1.22 pattern.

## 12. Default values and environment

| Flag | Default | Notes |
|------|---------|-------|
| `-parallel` | `GOMAXPROCS` | Per test binary |
| `-p` | `GOMAXPROCS` | Across packages |
| `-cpu` | current `GOMAXPROCS` | Comma list runs each |
| `-race` | off | Adds 5–10x overhead |
| `-count` | 1 | `-count=1` disables test caching |
| `-timeout` | 10m | Whole binary, not per test |

## 13. Process-level state that defeats `t.Parallel`

The standard library documents these explicitly as "process-global":

- The environment (`os.Setenv`, `os.Unsetenv`).
- The working directory (`os.Chdir`).
- File descriptor limits.
- `runtime.GOMAXPROCS`.
- Signal handlers (`signal.Notify`).
- `flag.CommandLine`.

Touching any of these from a parallel test without serialization is a documented bug.

## 14. `testing.T.Context` (Go 1.24+)

From `(*T).Context` godoc (Go 1.24):

> Context returns a context that is canceled just before Cleanup-registered functions are called.
>
> Cleanup functions can wait for any resources that shut down on Context.Done before the test or benchmark completes.

For parallel tests, `t.Context()` is the canonical cancellation channel. RPC clients, background loops, and timeouts inside the test should derive deadlines from it. When the test ends (success, failure, or timeout), `ctx.Done()` fires before cleanups run, so any goroutines listening on it shut down deterministically.

## 15. `B.RunParallel` (benchmark equivalent)

For completeness: benchmarks have their own parallel model. From `(*B).RunParallel` godoc:

> RunParallel runs a benchmark in parallel. It creates multiple goroutines and distributes b.N iterations among them. The number of goroutines defaults to GOMAXPROCS. To increase parallelism for non-CPU-bound benchmarks, call SetParallelism before RunParallel.

`B.RunParallel` differs from `T.Parallel`:

- The goroutines all run the *same* benchmark function; they don't represent sibling tests.
- `b.N` is shared and split among the goroutines.
- The pattern is one `b.RunParallel(func(pb *PB) { for pb.Next() { ... } })` call per benchmark.

For benchmarks, see the `09-benchmarking-basics` subsection. The rest of this page is specifically about `T.Parallel`.

## 16. Scheduling order rules

The exact ordering rules implemented in `src/testing/run.go`:

1. Tests run in source order until one calls `t.Parallel`.
2. A test calling `t.Parallel` is added to the parallel queue and the test goroutine is parked on a channel.
3. After all serial tests at the current level complete, the parent's `t.Run` loop returns.
4. The parallel queue is drained, releasing up to `-parallel` parked goroutines at a time.
5. When a parallel test completes, the next one is released.
6. The parent's `m.Run` (top level) or `t.Run` (subtest level) returns only after the queue is empty and all parallel tests have finished.

This guarantees that:

- `TestMain`'s teardown after `m.Run` always sees a clean slate.
- A parent `t.Run` wrapping parallel children blocks until all are done.
- No test starts before all serial siblings at the same level have finished.

## 17. Error and panic propagation

A `panic` inside a parallel test:

- Is recovered by the framework's test goroutine.
- Marks the test as failed.
- Does not abort the test binary; other parallel tests continue.

A `runtime.Goexit` (called by `t.FailNow`, `t.Skip`):

- Terminates the test's goroutine.
- Runs deferred functions and `t.Cleanup` callbacks.
- Does not affect siblings.

A fatal error from `log.Fatal` or `os.Exit` in test code:

- Terminates the whole test binary.
- Cleanups for in-progress parallel tests do **not** run.
- Avoid `log.Fatal` in tests; use `t.Fatal` instead.

## 18. Determinism guarantees

The testing package guarantees:

- Serial tests run in declaration order.
- Same-name subtests are deterministic in declaration order *until* `t.Parallel`.
- After `t.Parallel`, the relative order of parallel siblings is **not** guaranteed.

The framework does *not* guarantee:

- A stable interleaving of parallel test output (use `t.Log` per test, which is buffered until the test ends).
- A stable goroutine count at any given moment.
- The same `t.TempDir` paths between runs.

## 19. Interaction with `-shuffle`

From `go help testflag`:

> -shuffle off,on,N
>     Randomize the execution order of tests and benchmarks.

`-shuffle` randomises the order of top-level tests *before* they start. Parallel tests still pause and run concurrently; only the *serial* tests reorder visibly. The randomisation seed is printed at the start of the run for reproduction:

```
-test.shuffle 1735862400123456789
```

Re-run with `-shuffle 1735862400123456789` to reproduce the same order.

## References

- `testing` package: <https://pkg.go.dev/testing>
- `go help testflag`: <https://pkg.go.dev/cmd/go#hdr-Testing_flags>
- `go help build`: <https://pkg.go.dev/cmd/go#hdr-Compile_packages_and_dependencies>
- Go 1.22 release notes, "for loop": <https://go.dev/blog/loopvar-preview>
- Go 1.24 release notes, `t.Context`, `t.Chdir`: <https://go.dev/doc/go1.24>
- Race detector: <https://go.dev/doc/articles/race_detector>
- `src/testing/testing.go`: source of truth for all godoc above.

## 20. Glossary of terms used in the godoc

- **Parallel test**: a test that has called `(*T).Parallel`.
- **Subtest**: a test launched via `(*T).Run` inside another test.
- **Sibling**: subtests sharing the same direct parent.
- **Level**: the depth in the subtest tree; the top-level is level 0.
- **Parallel queue**: an internal channel holding parked parallel tests.
- **Cleanup**: a function registered via `(*T).Cleanup`, run after the test completes.
