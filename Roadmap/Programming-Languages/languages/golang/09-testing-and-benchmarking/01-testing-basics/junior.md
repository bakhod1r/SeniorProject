---
layout: default
title: Testing Basics — Junior
parent: Testing Basics
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/junior/
---

# Testing Basics — Junior

[← Back](../)

This page walks through the Go testing system from absolute zero. You will not see a tool more advanced than `go test`. By the end you should be able to: write a `TestXxx` function, run it, read the failure output, write a table-driven test, and add an `Example` that doubles as documentation. We will go slowly because the surface area is small and almost every feature you see in advanced Go projects is composed from these few primitives.

## 1. What is a test in Go?

A test is a regular Go function with a specific signature, placed in a file with a specific suffix, in the same package as the code it tests. There is no annotation, no class, no inheritance. The framework is:

- A file ending in `_test.go`.
- A function `func TestXxx(t *testing.T)` where `Xxx` starts with an uppercase letter.

That is it. The `go test` command finds and runs the function.

### A minimal example

Create a directory `calc/` with one file:

```go
// calc/calc.go
package calc

func Add(a, b int) int {
    return a + b
}
```

And one test file next to it:

```go
// calc/calc_test.go
package calc

import "testing"

func TestAdd(t *testing.T) {
    got := Add(2, 3)
    want := 5
    if got != want {
        t.Errorf("Add(2, 3) = %d, want %d", got, want)
    }
}
```

Now from inside `calc/`:

```
$ go test
PASS
ok      calc    0.123s
```

That is the whole loop. No registration, no DSL. The test passes silently. To see what ran, pass `-v`:

```
$ go test -v
=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
PASS
ok      calc    0.124s
```

### When the test fails

Break `Add` deliberately:

```go
func Add(a, b int) int {
    return a - b
}
```

Re-run:

```
$ go test
--- FAIL: TestAdd (0.00s)
    calc_test.go:9: Add(2, 3) = -1, want 5
FAIL
exit status 1
FAIL    calc    0.123s
```

The framework printed:

- The test name.
- The file and line of the failing assertion.
- The message you passed to `t.Errorf`.
- A non-zero exit code so CI sees the failure.

Notice we built the failure message manually. Go does not have built-in `assert(got == want)` because the standard advice is to print *both* values explicitly. A bare "assertion failed" is useless; "got -1, want 5" tells you what to do next.

Fix the bug:

```go
func Add(a, b int) int { return a + b }
```

and re-run. PASS.

## 2. The `_test.go` rule

The Go toolchain treats `_test.go` as a magic suffix. Such files are compiled *only* by `go test`; they are invisible to `go build`, `go install`, `go run`, and any tool walking the package's source files.

```
$ go build ./calc
# nothing happens — calc has no main, but calc_test.go is ignored

$ ls -la
calc.go         calc_test.go
```

Three consequences:

1. Your production binary contains no test code, ever.
2. You can `import "testing"` and other test-only packages without polluting the public dependency list.
3. Test helpers and fixtures live next to the code they test, not in a separate `tests/` tree.

A test file can declare:

- `package calc` — the *internal* test package. Has access to unexported identifiers.
- `package calc_test` — the *external* test package. Sees only the public API.

Both can coexist in the same directory; `go test` compiles them together. The middle page covers the trade-off; for now, use `package calc` (internal) and move on.

## 3. The `testing.T` API

`*testing.T` is the handle the framework gives every test function. The methods you will use 99% of the time:

- `t.Errorf(format, args...)` — mark the test as failed, log a formatted message, keep running.
- `t.Fatalf(format, args...)` — same as `Errorf` but stop the test immediately.
- `t.Log(args...)` / `t.Logf(format, args...)` — log a message (printed only on failure or with `-v`).
- `t.Run(name, func)` — run a subtest with its own `*testing.T`.
- `t.Helper()` — mark this function as a helper so failure lines point at the caller.
- `t.Skip(args...)` / `t.Skipf(format, args...)` — skip the test with a message.
- `t.Cleanup(func)` — register a function to run when the test ends.
- `t.TempDir()` — return a unique temp directory that is cleaned up automatically.
- `t.Setenv(key, value)` — set an env var, restored when the test ends.

We will meet every one of these. Right now, the only two you need are `Errorf` and `Fatalf`.

### When to use `Errorf` vs `Fatalf`

The rule: if continuing the test would produce a panic or noise, use `Fatalf`. Otherwise use `Errorf`.

```go
func TestUser(t *testing.T) {
    u, err := NewUser("alice")
    if err != nil {
        t.Fatalf("NewUser: %v", err) // u is nil; can't continue
    }
    if u.Name != "alice" {
        t.Errorf("u.Name = %q, want %q", u.Name, "alice")
    }
    if u.ID == 0 {
        t.Errorf("u.ID = 0, want non-zero")
    }
}
```

If `NewUser` failed, the next line would dereference a nil pointer. `Fatalf` stops it. The two `Errorf` calls are independent assertions: if the name is wrong *and* the ID is zero, you want both reported, not just the first.

### A subtle point about `Fatalf`

`Fatalf` calls `runtime.Goexit`, which exits only the goroutine it runs in. That means you *cannot* call `Fatalf` from a goroutine other than the one running the test function — the test goroutine would never see the failure and the test would silently pass.

```go
// WRONG
func TestServer(t *testing.T) {
    go func() {
        if err := serve(); err != nil {
            t.Fatalf("serve: %v", err) // WRONG goroutine
        }
    }()
    // ...
}
```

The correct form is to pass the error back via a channel and assert in the test goroutine, or to call `t.Errorf` (which is safe from any goroutine because it does not exit). We come back to this in the find-bug page.

## 4. Table-driven tests

The single most idiomatic Go test pattern is the table-driven test: define a slice of cases, loop over them, run an assertion per case.

```go
func TestAdd(t *testing.T) {
    cases := []struct {
        a, b int
        want int
    }{
        {2, 3, 5},
        {-1, 1, 0},
        {0, 0, 0},
        {-2, -3, -5},
    }
    for _, tc := range cases {
        if got := Add(tc.a, tc.b); got != tc.want {
            t.Errorf("Add(%d, %d) = %d, want %d", tc.a, tc.b, got, tc.want)
        }
    }
}
```

Three properties make this idiom good:

1. New cases are one line. Coverage grows linearly with little code.
2. All cases run even if one fails (because we use `Errorf`, not `Fatalf`).
3. Failure messages include the input, so the report identifies the case.

### Improving the report with subtests

When the table grows, you want each case named in the output. Use `t.Run`:

```go
func TestAdd(t *testing.T) {
    cases := []struct {
        name string
        a, b int
        want int
    }{
        {"positives", 2, 3, 5},
        {"negative_to_zero", -1, 1, 0},
        {"zero", 0, 0, 0},
        {"two_negatives", -2, -3, -5},
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

Now `-v` shows each case:

```
=== RUN   TestAdd
=== RUN   TestAdd/positives
=== RUN   TestAdd/negative_to_zero
=== RUN   TestAdd/zero
=== RUN   TestAdd/two_negatives
--- PASS: TestAdd (0.00s)
    --- PASS: TestAdd/positives (0.00s)
    --- PASS: TestAdd/negative_to_zero (0.00s)
    --- PASS: TestAdd/zero (0.00s)
    --- PASS: TestAdd/two_negatives (0.00s)
```

And you can run a single case:

```
$ go test -run TestAdd/zero -v
```

The `-run` flag is a regular expression matched against the full test name. The slash separates parent from subtest.

## 5. Reading the failure line

When a test fails the framework prints something like:

```
--- FAIL: TestAdd/negative_to_zero (0.00s)
    calc_test.go:12: Add(-1, 1) = 1, want 0
```

The components:

- `--- FAIL` — final status of this test (or subtest).
- `TestAdd/negative_to_zero` — full hierarchical name.
- `(0.00s)` — wall time spent in the test.
- `calc_test.go:12` — the file and line where `t.Errorf` was called.
- The formatted message.

The line number is the *call site* of `Errorf`, not the line of the bug. If you wrap assertions in a helper, the line will point inside the helper unless you call `t.Helper()`. We will see that in `middle.md`.

## 6. The `go test` command

`go test` has a lot of flags. As a junior you will use a small subset:

```
go test                  # current package, no output unless failure
go test -v               # verbose: print every RUN/PASS line
go test -run TestAdd     # only tests matching the regexp
go test ./...            # all packages under current directory
go test -count=1         # disable test cache (force re-run)
go test -timeout=30s     # kill the binary if it takes longer than 30s
go test -race            # run with the race detector
go test -cover           # print coverage percentage
go test -failfast        # stop at first failure
go test -short           # set testing.Short() to true (we use this later)
```

Run them all once on your `calc` package to get a feel.

### `-run` regexp behaviour

The argument to `-run` is a regular expression. It matches anywhere in the test name. So `-run Add` matches `TestAdd`, `TestAddSubtract`, `TestThingAdd`. To anchor: `-run '^TestAdd$'`. For subtests: `-run 'TestAdd/zero'`. The `/` separates levels; each level is matched independently against the regexp split on `/`.

### Test packages

`go test` operates on one package at a time. `go test` (no arg) is the current directory. `go test ./calc` is a specific package. `go test ./...` expands to every package under the current directory tree. Each package gets its own ephemeral binary, so packages run independently.

## 7. The test binary

You can see the binary `go test` builds:

```
$ go test -c -o calc.test
$ ls -la calc.test
-rwxr-xr-x  1 user  staff  1.2M  calc.test
```

`-c` says "compile but do not run". `-o` names the output. Running the binary executes the tests:

```
$ ./calc.test -test.v
=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
PASS
```

The flags accepted by the binary are the same as `go test` but with a `-test.` prefix: `-test.v`, `-test.run`, `-test.timeout`. The `go test` command translates the user-facing flags into the binary form. This matters when you debug a test binary in `dlv` or run it manually under `strace`.

## 8. `Example` functions

Examples are runnable documentation. They look like tests but have a special signature and a magic comment.

```go
package calc_test

import (
    "fmt"
    "calc" // adjust import path for your module
)

func ExampleAdd() {
    fmt.Println(calc.Add(2, 3))
    // Output: 5
}
```

What happens:

- `go test` finds `ExampleAdd` by name.
- It runs the function, capturing `os.Stdout`.
- It compares the captured output line-by-line (after trimming trailing whitespace) to the `// Output:` comment block.
- If they match, the example passes. If not, it fails like a normal test.
- `go doc calc.Add` and `pkg.go.dev` render the example next to the function's documentation.

A few rules:

- An `Example` with no `// Output:` comment is compiled but not run. (Useful when stdout would be too noisy or non-deterministic.)
- `// Output:` and the lines below must immediately precede the function's closing brace.
- `// Unordered output:` compares the lines as an unordered set — useful for maps and other random-order outputs.

### Naming examples

The function name determines what doc symbol the example attaches to:

- `ExampleAdd` — attached to `Add`.
- `ExampleAdd_negative` — sub-example of `Add`.
- `Example` — package-level example.
- `Example_overview` — package-level example with a tag.

In `go doc calc`, all of these appear under the relevant header.

### Examples vs tests

An `Example` is also a test in that it fails the suite when its output disagrees. But its primary purpose is documentation. Use examples for the happy path; use tests for edge cases. Do not write 20 examples; write the one that demonstrates the typical use, then test the edges with `TestXxx`.

## 9. The `testing.T.Log` family

Sometimes you want to log diagnostic information without failing the test. `t.Log` and `t.Logf` do this:

```go
func TestX(t *testing.T) {
    payload := buildPayload()
    t.Logf("payload size: %d bytes", len(payload))
    if err := send(payload); err != nil {
        t.Errorf("send: %v", err)
    }
}
```

The log is buffered and printed only if the test fails *or* if `-v` is set. This keeps a passing suite quiet.

`t.Log` is useful for:

- Confirming what input a test used.
- Recording timing or sizes for later inspection.
- Annotating failure context when many small assertions might trigger.

Avoid `fmt.Println` in test code — it always prints and clutters CI logs.

## 10. Setup and teardown — the simplest form

Many tests need a small amount of setup. The simplest pattern is local: do the work inside the test function.

```go
func TestUser(t *testing.T) {
    db := newInMemoryDB()
    defer db.Close()
    // ... assertions
}
```

This works because `defer` runs when the function returns. The pattern breaks down when:

- The setup must run once per test binary, not per test.
- The test launches goroutines that outlive the function body.
- The cleanup needs to happen after parallel subtests complete.

For those cases we use `TestMain` and `t.Cleanup`, which the middle page covers in depth. For now, `defer` is fine.

## 11. `TestMain` — once per package

If you need setup that applies to the whole test binary, declare a `TestMain` function:

```go
package calc

import (
    "os"
    "testing"
)

func TestMain(m *testing.M) {
    // setup before any test runs
    setupDatabase()
    code := m.Run() // runs all the TestXxx functions, returns 0 if all pass
    teardownDatabase()
    os.Exit(code)
}
```

Key points:

- `TestMain` replaces the auto-generated `main` of the test binary. The framework calls it.
- You must call `m.Run()` to actually run the tests.
- You must `os.Exit(code)` with the return value of `m.Run()` — otherwise the binary exits with code 0 regardless of test results.
- There can be at most one `TestMain` per package.

If you do not define `TestMain`, the framework auto-generates one that just calls `m.Run()` and exits with its code. So `TestMain` is purely a hook for cross-cutting setup.

## 12. A complete first test file

Putting it all together:

```go
// calc/calc.go
package calc

import "errors"

func Add(a, b int) int { return a + b }

func Div(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}
```

```go
// calc/calc_test.go
package calc

import (
    "fmt"
    "testing"
)

func TestAdd(t *testing.T) {
    cases := []struct {
        name    string
        a, b    int
        want    int
    }{
        {"positives", 2, 3, 5},
        {"negative_to_zero", -1, 1, 0},
        {"zero", 0, 0, 0},
        {"two_negatives", -2, -3, -5},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            if got := Add(tc.a, tc.b); got != tc.want {
                t.Errorf("Add(%d, %d) = %d, want %d", tc.a, tc.b, got, tc.want)
            }
        })
    }
}

func TestDiv_Success(t *testing.T) {
    got, err := Div(10, 2)
    if err != nil {
        t.Fatalf("Div(10, 2) returned error: %v", err)
    }
    if got != 5 {
        t.Errorf("Div(10, 2) = %d, want 5", got)
    }
}

func TestDiv_ZeroDenominator(t *testing.T) {
    _, err := Div(10, 0)
    if err == nil {
        t.Fatalf("Div(10, 0) returned nil error, want non-nil")
    }
}

func ExampleAdd() {
    fmt.Println(Add(2, 3))
    // Output: 5
}
```

Run it:

```
$ go test -v
=== RUN   TestAdd
=== RUN   TestAdd/positives
=== RUN   TestAdd/negative_to_zero
=== RUN   TestAdd/zero
=== RUN   TestAdd/two_negatives
--- PASS: TestAdd (0.00s)
    --- PASS: TestAdd/positives (0.00s)
    --- PASS: TestAdd/negative_to_zero (0.00s)
    --- PASS: TestAdd/zero (0.00s)
    --- PASS: TestAdd/two_negatives (0.00s)
=== RUN   TestDiv_Success
--- PASS: TestDiv_Success (0.00s)
=== RUN   TestDiv_ZeroDenominator
--- PASS: TestDiv_ZeroDenominator (0.00s)
=== RUN   ExampleAdd
--- PASS: ExampleAdd (0.00s)
PASS
ok      calc    0.123s
```

You now have everything a Go program needs to be tested: unit assertions, table-driven coverage, named cases, and a runnable documentation example.

## 13. Common newcomer mistakes

A short list of things that confuse people coming from JUnit, RSpec, or pytest:

### "Where is the assertion library?"

There isn't one. You write `if got != want { t.Errorf(...) }`. The reason: explicit comparison makes the failure message useful (`got 3, want 5` instead of `assertion failed`). For complex types, use `reflect.DeepEqual` or `github.com/google/go-cmp/cmp` — we'll cover both later. There is also the community library `testify`, but the Go standard recommendation is to avoid dependency-heavy assertion frameworks.

### "How do I run a specific test?"

`go test -run TestName`. The argument is a regular expression. For a subtest: `go test -run 'TestParent/sub_name'`.

### "Why do I need `_test.go` suffix?"

To keep test code out of your production binary. The Go toolchain refuses to compile `_test.go` files except via `go test`. This is a feature.

### "Why don't I have a `setUp` method?"

You have `TestMain` (once per binary) and `t.Cleanup` (once per test). Per-test setup is just code at the top of the test function. Most Go developers prefer the explicit local style.

### "Why do my parallel tests share data?"

If you call `t.Parallel()` in a subtest closure that captures a loop variable, before Go 1.22 the closure sees the loop variable's final value. Fix with `tc := tc` or upgrade to Go 1.22+. Even with the fix, parallel tests share *process state*: globals, env, file system. Plan accordingly.

### "Why does my test pass even when the assertion is wrong?"

Three likely causes:

1. You used `t.Log` instead of `t.Error`/`t.Fatal`. `Log` never fails.
2. You called `t.Fatal` from a goroutine other than the test goroutine.
3. The test is cached. Try `-count=1`.

## 14. What to do next

You can now write basic Go tests. The middle page introduces:

- The internal-vs-external package choice.
- Subtests with `t.Run`, deeper than the brief intro here.
- Parallel tests (`t.Parallel`).
- `t.Cleanup`, `t.TempDir`, `t.Setenv` — the three lifecycle helpers.
- `t.Helper` for clean failure lines.
- `t.Skip` for conditional skipping.

Before moving on, do the first three tasks in `tasks.md`. They take ten minutes total and burn the basic patterns into muscle memory.

## 15. Glossary

- **Test function**: A function `func TestXxx(t *testing.T)` in a `_test.go` file. Run by `go test`.
- **Subtest**: A nested test created by `t.Run(name, func)`. Has its own `*testing.T`.
- **Internal test package**: A `_test.go` file declaring `package foo` — sees unexported identifiers.
- **External test package**: A `_test.go` file declaring `package foo_test` — sees only exported identifiers.
- **Example function**: `func ExampleXxx()` with a `// Output:` comment. Verified runnable documentation.
- **TestMain**: Optional `func TestMain(m *testing.M)` for per-binary setup and teardown.
- **`-run`**: `go test` flag selecting tests by regexp on the test name.
- **`-v`**: `go test` flag for verbose output. Prints every `RUN`/`PASS` line.
- **`-count=1`**: `go test` flag that disables the test cache for this invocation.
- **`t.Errorf`**: Mark the test as failed, continue running.
- **`t.Fatalf`**: Mark the test as failed and exit the test goroutine.
- **`t.Log` / `t.Logf`**: Log a message. Visible on failure or with `-v`.

That's all you need to start. Move on to `middle.md`.
