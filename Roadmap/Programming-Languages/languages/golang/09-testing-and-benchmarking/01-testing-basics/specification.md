---
layout: default
title: Testing Basics — Specification
parent: Testing Basics
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/specification/
---

# Testing Basics — Specification

[← Back](../)

This page collects the normative rules that govern the `testing` package and the `go test` command. Everything here is reproducible from running `go doc testing`, `go help test`, `go help testflag`, and reading `src/testing/testing.go` in the Go source tree (tag `go1.22.0` at time of writing, but rules below have been stable across versions; deltas noted).

## 1. File and function naming rules

From `cmd/go/internal/load`:

- A file ending in `_test.go` is compiled only when running `go test`. It is invisible to `go build`, `go install`, and any other tool.
- A file whose name starts with `_` or `.` is ignored entirely by the Go toolchain.
- Inside a `_test.go` file, the following function signatures are recognised:

```go
func TestXxx(t *testing.T)
func BenchmarkXxx(b *testing.B)
func FuzzXxx(f *testing.F)        // Go 1.18+
func ExampleXxx()                  // optional package or method association
func TestMain(m *testing.M)        // at most one per test binary
```

- `Xxx` must begin with an uppercase letter that is not `t`/`b`/`f` followed by lowercase. The exact rule from `src/cmd/go/internal/load/test.go` is `unicode.IsUpper(rune(name[len(prefix)]))`. So `TestX`, `Testx` (no — must be upper after `Test`), `Test123` (no — must be letter) are governed by this.
- A test function must take exactly one argument of the listed pointer type. Extra arguments, wrong receiver, or wrong return type cause `go vet` to fail and the test to be skipped or rejected.

## 2. Internal vs external test package

A file in directory `mypkg/` may declare either `package mypkg` or `package mypkg_test`. The latter is called the *external* test package. Rules:

- Both can coexist in the same directory; the toolchain compiles them into the same test binary.
- External tests can import only the public API of `mypkg` and other packages — they cannot reference unexported identifiers.
- Exactly one external test package is permitted per directory, and its name must be `<pkgname>_test`.
- `Example` functions defined in the external test package are the ones shown in `go doc`.

## 3. `testing.T` core API (from `src/testing/testing.go`)

The methods used in normal control flow are inherited from the unexported embedded type `*common`. Key public methods:

```go
func (t *T) Run(name string, f func(t *T)) bool
func (t *T) Parallel()
func (t *T) Cleanup(f func())
func (t *T) TempDir() string
func (t *T) Setenv(key, value string)
func (t *T) Helper()
func (t *T) Skip(args ...any)
func (t *T) SkipNow()
func (t *T) Skipf(format string, args ...any)
func (t *T) Skipped() bool
func (t *T) Log(args ...any)
func (t *T) Logf(format string, args ...any)
func (t *T) Error(args ...any)
func (t *T) Errorf(format string, args ...any)
func (t *T) Fatal(args ...any)
func (t *T) Fatalf(format string, args ...any)
func (t *T) Fail()
func (t *T) FailNow()
func (t *T) Failed() bool
func (t *T) Name() string
func (t *T) Deadline() (time.Time, bool)
```

Semantic contracts:

- `Error*` calls `Fail` then continues. `Fatal*` calls `FailNow` then calls `runtime.Goexit`. Therefore `Fatal*` must only be called from the goroutine running the test function.
- `FailNow` and `SkipNow` must not be called from any goroutine other than the one running the test (or `t.Run`'s subtest function). Doing so panics.
- `Helper` must be called from the function that wants to be skipped in failure-line reporting; it marks the *calling* function as a helper. The line reported by `Errorf` is the first frame on the stack that is not marked as a helper.
- `Cleanup` registers a function to run when the test (or subtest) and all its subtests complete. Cleanups run in LIFO order. Cleanup functions can themselves call `Cleanup` to register further cleanups.
- `TempDir` creates a unique directory and registers a cleanup that removes it. The directory persists across subtests of the same `*testing.T` (not across separate `Test` functions).
- `Setenv` sets an environment variable and registers a cleanup that restores the previous value (or unsets it if previously unset). `Setenv` cannot be called from a test that has called `t.Parallel()` — it panics.
- `Parallel` signals that the test may run in parallel with other parallel tests. The test pauses; it resumes after all non-parallel tests in the same sequential group have finished, and runs concurrently up to `-parallel` (default `GOMAXPROCS`).

## 4. `testing.M` and `TestMain`

If a package defines `func TestMain(m *testing.M)`, that function becomes the entry point of the test binary instead of the generated `main`. The user is responsible for calling `m.Run()` and exiting with its return code:

```go
func TestMain(m *testing.M) {
    // setup
    code := m.Run()
    // teardown
    os.Exit(code)
}
```

`m.Run` parses `-test.*` flags, runs all matched tests and benchmarks, and returns 0 on success or 1 on failure. Calling `os.Exit` without `m.Run` skips all tests and exits with the chosen code — useful for opting out of a test binary entirely (rare).

## 5. `go test` command-line flags (from `go help testflag`)

Selected subset that every Go developer must know:

| Flag | Meaning |
| ---- | ------- |
| `-v` | Verbose. Pass `-test.v` to the binary. Prints each `RUN`/`PASS`/`FAIL` line. |
| `-run regexp` | Run only tests whose name matches the regexp. Slash separates subtest names: `-run TestFoo/sub`. |
| `-bench regexp` | Run benchmarks whose name matches. `-bench .` runs all. |
| `-count n` | Run each test or benchmark `n` times. `-count=1` disables the test cache. |
| `-timeout d` | Kill the test binary after duration `d` (default `10m`). Fails with stack dump. |
| `-race` | Compile with the race detector. Requires CGO. |
| `-cover` | Enable coverage instrumentation. |
| `-coverprofile=f` | Write coverage profile to file. |
| `-short` | Set `testing.Short()` to true. Tests should self-skip long cases when true. |
| `-failfast` | Stop after first test failure. Does not stop a running test. |
| `-parallel n` | Maximum parallel tests when `t.Parallel()` is called (default `GOMAXPROCS`). |
| `-cpu list` | Run with `GOMAXPROCS` set to each value in list. |

## 6. Test cache

`go test` caches test results keyed by:

- The test binary's hash (sources + compiler version + build tags).
- The values of environment variables read by the test (`os.Getenv` tracked via `runtime/testdeps`).
- The contents of files opened via `os.Open` within the working tree.
- The set of flags passed (`-run`, `-cpu`, `-list`, `-parallel`, `-v`, `-count`).

A cached result is reused only when re-invoked with identical inputs. `-count=1` forces a re-run by changing the key. Cache hits print `(cached)` next to the package name. The cache lives under `$GOCACHE` (`go env GOCACHE`).

## 7. Build constraints in test files

The same `//go:build` lines that apply to regular `.go` files apply to `_test.go` files. Common patterns:

```go
//go:build integration
// +build integration

package mypkg_test
```

Such a file is compiled only when `go test -tags=integration` is passed. There is no special test-only build tag — `_test.go` *is* the convention for test-only files; tags add finer slices.

## 8. Examples and `Output:`

An `Example` function may end with a comment:

```go
// Output:
// 42
// done
```

The framework captures `os.Stdout` while the example runs and compares it line-by-line (after trimming trailing whitespace) to the comment. `// Unordered output:` accepts the same lines in any order. An example without an output comment is compiled but not executed.

Example naming associates the example with documentation:

- `ExampleFoo` — attached to package symbol `Foo`.
- `ExampleFoo_Bar` — attached to method `Foo.Bar` or sub-example named `Bar`.
- `Example_xxx` (lowercase suffix) — package-level example with a tag.
- `Example` — the package-level overview example.

## 9. Exit codes

The test binary exits with:

- `0` if all selected tests passed (or were skipped).
- `1` if any test failed.
- `2` if the binary itself panicked or was killed by `-timeout`.

`go test` propagates these codes upward, so CI systems can treat them as standard `success`/`failure`.

## 10. Stability and version notes

- `t.Cleanup` was added in Go 1.14.
- `t.Setenv` and `t.TempDir` were added in Go 1.15 and 1.15 respectively.
- `testing.F` and the fuzzing engine were added in Go 1.18.
- `t.Deadline` was added in Go 1.15.
- The `testing.Verbose()` and `testing.Short()` accessors require `flag.Parse` to have been called, which `m.Run` does automatically; calling them before `m.Run` (or in `init`) panics.

For the authoritative reference, run:

```
$ go doc testing
$ go help test
$ go help testflag
$ go help testfunc
```

and read `src/testing/testing.go` in the Go source tree.
