---
layout: default
title: Testing Basics — Tasks
parent: Testing Basics
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/tasks/
---

# Testing Basics — Tasks

[← Back](../)

A graded set of exercises. Work through them in order; each builds on the previous one. Solutions are sketched at the end of each task; do not peek until you have tried.

## Task 1 — Your first `TestXxx`

Create a package `calc` with one exported function:

```go
package calc

func Add(a, b int) int { return a + b }
```

Write a test file `calc_test.go` that verifies `Add(2, 3) == 5` and `Add(-1, 1) == 0`. Run `go test`. Then deliberately break `Add` (return `a - b`), re-run, and study the failure output. Note the file name, line number, and which line of your test produced the failure message.

**Goal**: feel the `go test` cycle. Confirm the binary is invisible to `go build`.

**Sketch**:

```go
package calc

import "testing"

func TestAdd(t *testing.T) {
    if got := Add(2, 3); got != 5 {
        t.Errorf("Add(2, 3) = %d, want 5", got)
    }
    if got := Add(-1, 1); got != 0 {
        t.Errorf("Add(-1, 1) = %d, want 0", got)
    }
}
```

## Task 2 — Table-driven tests

Convert Task 1 to a table-driven form using a slice of structs and `t.Run` per case. Each subtest name must be readable in `-run TestAdd/...`. Try `go test -run TestAdd/negative -v` and confirm only that one subtest runs.

**Sketch**:

```go
func TestAdd(t *testing.T) {
    cases := []struct {
        name string
        a, b int
        want int
    }{
        {"positive", 2, 3, 5},
        {"negative_to_zero", -1, 1, 0},
        {"two_negatives", -2, -3, -5},
        {"zero", 0, 0, 0},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            if got := Add(tc.a, tc.b); got != tc.want {
                t.Errorf("Add(%d, %d) = %d, want %d", tc.a, tc.b, got, tc.want)
            }
        })
    }
}
```

## Task 3 — Write an `Example`

Add `ExampleAdd` to your test file with an `// Output:` comment. Run `go test -run Example` and `go doc -all`. Confirm the example shows up in the documentation. Then change the comment to disagree with what `Add` prints and watch the test fail.

**Sketch**:

```go
func ExampleAdd() {
    fmt.Println(Add(2, 3))
    // Output: 5
}
```

## Task 4 — TestMain with shared setup

Suppose your package needs a temporary working directory for the whole test binary. Write `TestMain` that creates it, sets an env var pointing to it, runs `m.Run()`, removes the directory, and exits with the code. Write two tests that read the env var and verify it points to a real directory.

**Sketch**:

```go
package mypkg

import (
    "os"
    "testing"
)

var sharedDir string

func TestMain(m *testing.M) {
    var err error
    sharedDir, err = os.MkdirTemp("", "mypkg-")
    if err != nil {
        panic(err)
    }
    os.Setenv("MYPKG_DIR", sharedDir)
    code := m.Run()
    os.RemoveAll(sharedDir)
    os.Exit(code)
}

func TestSharedDirExists(t *testing.T) {
    fi, err := os.Stat(sharedDir)
    if err != nil {
        t.Fatal(err)
    }
    if !fi.IsDir() {
        t.Fatalf("%s is not a directory", sharedDir)
    }
}

func TestEnvVarSet(t *testing.T) {
    if os.Getenv("MYPKG_DIR") != sharedDir {
        t.Fatal("env var mismatch")
    }
}
```

## Task 5 — Per-test temp directory

Refactor Task 4 to use `t.TempDir()` instead of a binary-wide directory. Confirm that each test gets a distinct path and that the path is removed after the test ends. Add a `t.Cleanup` that writes a marker file and verify it is observed in the next test's `t.TempDir` (it should not — paths are distinct).

**Sketch**:

```go
func TestPerTestDir(t *testing.T) {
    dir := t.TempDir()
    if _, err := os.Stat(dir); err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() {
        // dir is removed automatically; this cleanup runs first (LIFO)
        t.Logf("cleaning up %s", dir)
    })
}
```

## Task 6 — Setenv lifecycle

Write a test that reads `os.Getenv("FOO")` before and after `t.Setenv("FOO", "bar")`. Then write a sibling test that re-reads `FOO` to confirm the previous value was restored (or unset). Add `t.Parallel()` to one of them and observe the panic.

**Sketch**:

```go
func TestSetenvSets(t *testing.T) {
    if v := os.Getenv("FOO"); v != "" {
        t.Logf("FOO before = %q", v)
    }
    t.Setenv("FOO", "bar")
    if got := os.Getenv("FOO"); got != "bar" {
        t.Errorf("FOO = %q, want %q", got, "bar")
    }
}

func TestSetenvRestored(t *testing.T) {
    if got := os.Getenv("FOO"); got == "bar" {
        t.Errorf("FOO leaked from previous test: %q", got)
    }
}
```

## Task 7 — Helper for assertions

Write a helper:

```go
func assertEq[T comparable](t *testing.T, got, want T, name string) {
    t.Helper()
    if got != want {
        t.Errorf("%s: got %v, want %v", name, got, want)
    }
}
```

Use it in your `Add` tests. Confirm the failure line reported is the call site, not the helper. Remove the `t.Helper()` line and observe the line move to inside the helper. Put it back.

## Task 8 — Parallel subtests

Write five subtests for a slow function (use `time.Sleep(200 * time.Millisecond)` to simulate). Add `t.Parallel()` and time the whole run with `time -p go test`. Remove `t.Parallel()` and time again. Confirm parallel run is ~5x faster up to `GOMAXPROCS`.

**Sketch**:

```go
func TestSlow(t *testing.T) {
    for i := 0; i < 5; i++ {
        i := i // capture for pre-1.22; safe to omit in 1.22+
        t.Run(fmt.Sprintf("case_%d", i), func(t *testing.T) {
            t.Parallel()
            time.Sleep(200 * time.Millisecond)
        })
    }
}
```

## Task 9 — Skip with `-short`

Mark a test as long-running:

```go
func TestSlow(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping in short mode")
    }
    // ... slow work
}
```

Run `go test`, `go test -short`, and `go test -run TestSlow -v` and observe the SKIP line in the second case.

## Task 10 — External test package

Move your `calc` tests into `package calc_test`. Add an import of `calc`. Make sure you reference only the exported `Add`. Now add an internal helper `func mul(a, b int) int` to `calc.go` and try to call it from the external test — observe the compile error.

Finally, create `calc/export_test.go` with:

```go
package calc

var Mul = mul
```

and use `calc.Mul` from the external test. Note how `export_test.go` is only compiled during `go test`.

## Task 11 — Failing fast

Write a test that issues 100 `t.Errorf` calls. Compare its output to a version that uses `t.Fatalf` after the first failure. Then write a test that does `t.Cleanup(func() { fmt.Println("cleanup") })` followed by `t.Fatal("boom")` and confirm the cleanup still runs.

## Task 12 — Test cache observation

Run `go test ./...` twice in a row in your project. Note the `(cached)` annotation on the second run. Touch a source file (`touch calc.go`). Re-run and confirm cache is invalidated. Now run with `-count=1` and confirm the test re-runs regardless.

## Task 13 — Build tag for integration test

Create a file `integration_test.go`:

```go
//go:build integration

package calc

import "testing"

func TestIntegration(t *testing.T) {
    t.Log("running heavy integration test")
}
```

Confirm `go test` does not run it. Run `go test -tags=integration -v` and confirm it does. Now write a CI script that runs both phases in sequence.

## Task 14 — Naming a subtest with special characters

`t.Run("user/email contains @", ...)` does what you might not expect. The slash is a separator, and `@` gets escaped. Read the doc on `(*T).Run` regarding name normalisation. Confirm what `-run` regexp matches the resulting subtest name.

## Task 15 — Detecting a leaked goroutine in a basic test

Write a test that launches a goroutine waiting on an unbuffered channel that the test never sends to. Add `runtime.NumGoroutine` before and after, and call `t.Errorf` if the count grew. (This is the simplest form of leak detection; tools like `goleak` formalise it. We will see them in `05-test-helpers-libraries`.)

---

For any task you find easy, do it twice: once with the internal package and once with the external test package, and note what differs.
