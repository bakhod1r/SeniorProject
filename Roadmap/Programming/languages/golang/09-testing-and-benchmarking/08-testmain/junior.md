---
layout: default
title: TestMain — Junior
parent: TestMain Function
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/08-testmain/junior/
---

# TestMain — Junior

[← Back](../)

This page introduces `TestMain` from absolute zero. If you have written a `TestXxx` function and run `go test`, that is enough background. By the end of this page you should be able to declare a `TestMain`, run setup and teardown around `m.Run`, exit with the correct status code, and avoid the single biggest beginner pitfall: the interaction between `defer` and `os.Exit`.

## Where `TestMain` fits

A normal Go test file looks like this:

```go
package mathutil

import "testing"

func TestSum(t *testing.T) {
    got := Sum(2, 3)
    if got != 5 {
        t.Errorf("Sum(2,3) = %d, want 5", got)
    }
}
```

Run `go test` and the Go tool compiles every `*_test.go` file in the package into a self-contained binary, links it against the package under test, and runs it. Behind the scenes the generated binary has a `main` function provided by the tool. That `main` does two things: it sees what tests, benchmarks, and examples exist in the binary, then it runs them.

When you define `TestMain`, the tool-generated `main` does something slightly different. Instead of running the tests directly, it constructs a value of type `testing.M`, then calls your `TestMain(m)`. From inside `TestMain` you are responsible for eventually calling `m.Run()` — that is the method that actually runs all `TestXxx`, `BenchmarkXxx`, `ExampleXxx`, and `FuzzXxx` functions in the binary. `m.Run` returns an `int`: `0` if everything passed, `1` if anything failed. You take that int and exit the process with it, typically via `os.Exit`.

Pictorially:

```
go test
   |
   v
[generated main]
   |
   v
TestMain(m)     <-- you wrote this
   |
   +- setup()
   |
   v
m.Run()         <-- runs all TestXxx, BenchmarkXxx, ...
   |
   +- teardown()
   |
   v
os.Exit(code)
```

If you do **not** define `TestMain`, the generated `main` simply calls `m.Run` itself and exits with the result. So `TestMain` is purely additive: the testing framework already knows how to run tests; `TestMain` is your hook to wrap that run with custom code.

## The signature

```go
func TestMain(m *testing.M)
```

That is the entire signature. One parameter of type `*testing.M`, no return value. The function must be declared in a `_test.go` file (the test compiler will not see it otherwise) and must have exactly that name. The parameter name `m` is conventional — you can call it whatever you like, but every example you will read uses `m`, so stick with it for the sake of grep-friendliness.

You may have **at most one** `TestMain` per package. Two declarations are a compile error: `duplicate function TestMain`.

## First example

Here is the smallest non-trivial example. Place this in `mathutil_test.go`:

```go
package mathutil

import (
    "fmt"
    "os"
    "testing"
)

func TestMain(m *testing.M) {
    fmt.Println("setup")
    code := m.Run()
    fmt.Println("teardown")
    os.Exit(code)
}

func TestSum(t *testing.T) {
    if Sum(2, 3) != 5 {
        t.Error("Sum broken")
    }
}
```

Run `go test -v`:

```
setup
=== RUN   TestSum
--- PASS: TestSum (0.00s)
PASS
teardown
ok      example.com/mathutil    0.001s
```

Look closely at the order:

1. `setup` runs first, before any `=== RUN`.
2. `m.Run()` then runs `TestSum`.
3. `teardown` runs after `--- PASS` but before the trailing `ok` line.
4. The process exits with `code`, which `m.Run` reported as `0`.

If `TestSum` were to fail, `m.Run` would return `1` and `os.Exit(1)` would tell CI the run failed. Try it:

```go
func TestSum(t *testing.T) {
    t.Errorf("broken on purpose")
}
```

Run `go test`:

```
setup
--- FAIL: TestSum (0.00s)
    mathutil_test.go:18: broken on purpose
FAIL
teardown
exit status 1
FAIL    example.com/mathutil    0.001s
```

The shell saw `exit status 1`, CI marks the job red, you fix the test. The key point: `os.Exit(code)` is how the test process tells its parent (`go test`, your CI runner) what happened. If you forget it or pass `0` always, CI will lie to you.

## Why `m.Run`?

`m.Run` is the only method on `*testing.M` you call. Internally it iterates through the test, benchmark, example, and fuzz target metadata that the test compiler emitted into the binary, runs them in the order specified by `-test.run`, and aggregates a pass/fail. It also performs flag parsing if `flag.Parse` has not been called yet. Conceptually `m.Run` is just *the run loop you would have written yourself if you had to implement a test framework from scratch*.

You do not need to know any other method on `*testing.M`. There are no setters, no event hooks, no parallel-toggle methods. The entire API is `Run() int`.

## The defer + os.Exit trap

Here is the single most common bug juniors write. Read carefully:

```go
func TestMain(m *testing.M) {
    db := openDB()
    defer db.Close()        // <-- this does not run!
    os.Exit(m.Run())
}
```

`db.Close()` is **not** called. Why? Because `os.Exit` is the Unix-style exit syscall — it terminates the process immediately, without unwinding the stack, without running deferred functions. The defer is registered, but no one ever returns from `TestMain`, so the defer queue is never drained.

You will not get a warning. You will get leaked connections. In tests, the symptom is "subsequent `go test` runs sometimes fail with too many connections". The fix is mechanical: capture the code, run cleanup explicitly, then exit:

```go
func TestMain(m *testing.M) {
    db := openDB()
    code := m.Run()
    db.Close()
    os.Exit(code)
}
```

If you really like `defer`, push the run into a helper:

```go
func TestMain(m *testing.M) {
    os.Exit(run(m))
}

func run(m *testing.M) int {
    db := openDB()
    defer db.Close()
    return m.Run()
}
```

`run` returns normally, so the defer fires, and the outer `os.Exit` propagates the result. Many production codebases adopt this pattern as house style.

## Setup and teardown skeleton

Here is the boilerplate you will copy into the first integration test package you write:

```go
package myapp

import (
    "fmt"
    "os"
    "testing"
)

var globalThing *Thing // shared by all tests in this package

func TestMain(m *testing.M) {
    var err error
    globalThing, err = openThing()
    if err != nil {
        fmt.Fprintf(os.Stderr, "test setup failed: %v\n", err)
        os.Exit(1)
    }
    code := m.Run()
    globalThing.Close()
    os.Exit(code)
}
```

`globalThing` is shared by every `TestXxx` in the package. Each test can use it directly without re-opening. If setup fails, you do not even try to run the tests — exit with `1` so CI fails loudly.

A small note on error handling in `TestMain`: there is no `*testing.T` available, so you cannot call `t.Fatal`. Print to stderr and `os.Exit(1)`. Do **not** call `log.Fatal`, which works but emits a stack trace; the friendlier shape is a one-line message.

## `TestMain` is optional

The most important thing to remember as a junior: **most packages do not need `TestMain`**. A package with twenty `TestXxx` functions and no shared state is better off without one. Each test owns its setup and teardown via `t.Setenv`, `t.TempDir`, `t.Cleanup`, or simple local variables. Adding `TestMain` increases coupling: now every test runs after `setup` and every test contributes to whether `teardown` is reached. Order-dependent bugs creep in.

Use `TestMain` when there is genuinely shared expensive state. Skip it otherwise.

## Print vs. log

Inside `TestMain`, you might be tempted to call `fmt.Println` for diagnostics. That is fine, but be aware: that output will appear *before* the `=== RUN` lines from `go test -v`, sandwiched between the test names, or after them, depending on when you print. It does not interleave with `t.Log` output. If you want structured diagnostics, prefer `log.Printf` to stderr — it has a consistent format with timestamp and prefix.

## A complete annotated example

Let us combine everything we have learned. Imagine a tiny package that depends on an environment variable. We want to set it once at the package level, run the tests, then unset it.

```go
// file: greeter_test.go
package greeter

import (
    "fmt"
    "os"
    "testing"
)

func TestMain(m *testing.M) {
    // Step 1: setup.
    fmt.Println("setting GREETER_PREFIX=Hello")
    os.Setenv("GREETER_PREFIX", "Hello")

    // Step 2: run all tests.
    code := m.Run()

    // Step 3: teardown.
    fmt.Println("unsetting GREETER_PREFIX")
    os.Unsetenv("GREETER_PREFIX")

    // Step 4: exit with the run's status code.
    os.Exit(code)
}

func TestGreeting(t *testing.T) {
    got := Greet("World")
    want := "Hello, World"
    if got != want {
        t.Errorf("Greet(World) = %q, want %q", got, want)
    }
}
```

Trace through what happens when you run `go test -v`:

1. The Go toolchain builds the binary.
2. The generated `main` calls `TestMain(m)`.
3. `TestMain` prints `setting GREETER_PREFIX=Hello`.
4. `TestMain` sets the env var.
5. `m.Run()` is called. It discovers one test, `TestGreeting`, and runs it.
6. `TestGreeting` reads `GREETER_PREFIX`, builds `"Hello, World"`, compares, passes.
7. `m.Run` returns `0`.
8. `TestMain` prints `unsetting GREETER_PREFIX`.
9. `os.Exit(0)` terminates the process.

If `TestGreeting` failed, step 7 would produce `1` and `os.Exit(1)` would be the final action. Either way, the env var teardown ran first. Good.

Compare this to using `os.Setenv` inside the test itself:

```go
func TestGreeting(t *testing.T) {
    t.Setenv("GREETER_PREFIX", "Hello")   // scoped to this test
    got := Greet("World")
    if got != "Hello, World" {
        t.Errorf("bad")
    }
}
```

`t.Setenv` is per-test and self-cleaning. If there is only one test, you do not need `TestMain`. If there are five tests and all want the same env var, you can either repeat `t.Setenv` in each or set it once in `TestMain`. Repetition is sometimes clearer, sometimes wasteful — judgment call.

## Frequently asked baby questions

**Q. Can I have multiple `TestMain` functions across files?**
No. One per package. If you add a second, the compiler refuses.

**Q. Can `TestMain` be in a file named `foo.go` instead of `_test.go`?**
No. Only `_test.go` files are linked into the test binary. A `TestMain` in `foo.go` would just be an unreferenced function in your production binary.

**Q. Do I have to call `os.Exit`?**
Since Go 1.15, no — `TestMain` may return normally and the runtime will exit with the result of `m.Run`. But the idiomatic, widely-recognized pattern is `os.Exit(m.Run())`, and it is what every linter and code review expects. Stick with `os.Exit`.

**Q. Can I call `m.Run` more than once?**
Effectively no. The first call runs every test. The second is undefined and historically panicked. One call per process.

**Q. What about `t.Skip`?**
`t.Skip` is for inside individual tests. From `TestMain` you cannot skip individual tests; you can only choose not to run the suite, or to make every test skip via shared state.

## Walking through a real package

Let us look at how the standard library's `net/http/httptest` package would have used `TestMain` if it needed to. It does not, because each test sets up its own server, but a hypothetical heavy version might:

```go
package httptest_test

import (
    "net/http/httptest"
    "os"
    "testing"
)

var sharedServer *httptest.Server

func TestMain(m *testing.M) {
    sharedServer = httptest.NewServer(buildBigHandler())
    code := m.Run()
    sharedServer.Close()
    os.Exit(code)
}

func TestGet(t *testing.T) {
    resp, err := http.Get(sharedServer.URL + "/ping")
    if err != nil { t.Fatal(err) }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        t.Errorf("got %d", resp.StatusCode)
    }
}
```

Every test reads `sharedServer.URL`. The server starts once. Closing it after `m.Run` releases the port. Standard pattern.

## Common beginner stumbles

### Stumble 1: thinking `TestMain` runs before every test

It does not. It runs **once** per test binary, before *any* test, then **once** after *all* tests. If you have ten `TestXxx` functions, your `setup` runs one time, not ten. If you want per-test setup, write a helper or use `t.Cleanup`.

### Stumble 2: putting test logic inside `TestMain`

```go
func TestMain(m *testing.M) {
    // wrong:
    if Sum(2, 3) != 5 {
        os.Exit(1)
    }
    os.Exit(m.Run())
}
```

`TestMain` is for *lifecycle*, not for assertions. Put your assertions in `TestXxx`. The reason: assertions in `TestMain` are not reported as test failures — they just kill the process. CI sees "exit 1" without any line number, test name, or context. Use `t.Errorf` inside a `TestXxx`.

### Stumble 3: using `t.Fatal` inside `TestMain`

```go
func TestMain(m *testing.M) {
    if err := openDB(); err != nil {
        t.Fatal(err) // compile error: no t in scope
    }
}
```

There is no `*testing.T` in `TestMain`. You cannot use `t.Fatal`, `t.Log`, `t.Run`, or any `t.*` method. The compiler stops you. The substitute is `fmt.Fprintln(os.Stderr, ...)` plus `os.Exit(1)`.

### Stumble 4: confusing `TestMain` with `main`

`TestMain` is **not** your program's entry point. It is a hook called by the test binary's generated `main`. Your production binary's `main` function lives in `main.go` and is unrelated. `go test` does not call your `main`; it calls your `TestMain` (if defined) or the generated wrapper otherwise.

### Stumble 5: forgetting that flags are not parsed

A common surprise: `testing.Short()` returns `false` inside `TestMain` even when `-short` was passed.

```go
func TestMain(m *testing.M) {
    if testing.Short() {
        fmt.Println("short mode")
    }
    os.Exit(m.Run())
}
```

`go test -short` prints nothing. Why? `flag.Parse` has not been called yet. The fix is one line:

```go
func TestMain(m *testing.M) {
    flag.Parse() // <-- add this
    if testing.Short() {
        fmt.Println("short mode")
    }
    os.Exit(m.Run())
}
```

Now `go test -short` prints `short mode`.

## Reading test output

When `TestMain` is involved, the test output gets a little richer. Here is a typical run with both setup logs and test results:

```
$ go test -v
[setup] connecting to db
[setup] running migrations
=== RUN   TestInsert
--- PASS: TestInsert (0.01s)
=== RUN   TestQuery
--- PASS: TestQuery (0.00s)
PASS
[teardown] closing db
ok      example.com/mypkg    0.123s
```

Read the order: setup logs, then per-test lines from `m.Run`, then teardown logs, then the trailing `ok` (or `FAIL`) summary, then the exit code that `go test` interprets.

If a test fails:

```
$ go test -v
[setup] connecting to db
=== RUN   TestInsert
    mypkg_test.go:42: insert failed
--- FAIL: TestInsert (0.01s)
=== RUN   TestQuery
--- PASS: TestQuery (0.00s)
FAIL
[teardown] closing db
exit status 1
FAIL    example.com/mypkg    0.123s
```

Teardown still runs (we wrote our `TestMain` correctly). The exit code is `1`. CI marks the build red.

## Practice: write your first `TestMain` from memory

Before moving on to the middle page, close this document and write a complete `TestMain` for the following spec:

1. The package needs an in-memory SQLite database.
2. Migrations should run once at startup.
3. A `*sql.DB` should be exposed to tests as a package variable.
4. The database should be closed at shutdown.
5. The exit code should be propagated to the OS.

Try it. Then compare against the version below:

```go
package store

import (
    "database/sql"
    "fmt"
    "os"
    "testing"

    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func TestMain(m *testing.M) {
    var err error
    db, err = sql.Open("sqlite3", ":memory:")
    if err != nil {
        fmt.Fprintln(os.Stderr, "open:", err)
        os.Exit(1)
    }
    if err := migrate(db); err != nil {
        fmt.Fprintln(os.Stderr, "migrate:", err)
        os.Exit(1)
    }
    code := m.Run()
    db.Close()
    os.Exit(code)
}

func migrate(db *sql.DB) error {
    _, err := db.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`)
    return err
}

func TestInsertUser(t *testing.T) {
    _, err := db.Exec("INSERT INTO users(name) VALUES(?)", "alice")
    if err != nil { t.Fatal(err) }
}
```

If your version matches the structure — setup with error handling, `m.Run`, cleanup, `os.Exit` — you have the basics. If you wrote `defer db.Close()`, re-read the section on the `os.Exit` trap.

## A few things `TestMain` cannot do

To prevent over-application of the hammer, here are things `TestMain` is **not** for:

- **Per-test setup.** Use `t.Helper` and `t.Cleanup` in the test itself.
- **Skipping individual tests by name.** Use `t.Skip` inside the test, controlled by a flag if you like.
- **Reporting test results.** `m.Run` does that.
- **Generating dynamic test cases.** Use `t.Run` (subtests) inside a single `TestXxx`.
- **Sharing state across packages.** Each package compiles to its own binary; `TestMain` runs once per binary.

If you find yourself reaching for `TestMain` and the answer to "is this expensive enough to amortize?" is no, the answer is probably "don't use `TestMain`."

## Recap

- `func TestMain(m *testing.M)` is the testing package's lifecycle hook.
- Call `m.Run()` exactly once.
- `m.Run()` returns an `int`; exit with it via `os.Exit`.
- `os.Exit` does not run `defer`s; capture the code, run teardown, then exit.
- One `TestMain` per package; live in `_test.go` files.
- Default to *not* having a `TestMain`. Add one only when you have real shared setup.
- Call `flag.Parse()` before reading flags inside `TestMain`.
- No `t.Fatal`, `t.Log`, or other `t.*` inside `TestMain` — there is no `*testing.T`.

That is everything a junior needs to know to read and write a basic `TestMain`. The middle page goes deeper into flag parsing, custom flags, and per-test wrappers.

## Glossary

- **Test binary** — The executable that `go test` compiles from your `_test.go` files plus the package under test.
- **Generated `main`** — The function the Go tool writes into `_testmain.go`, which calls `TestMain` or `m.Run` directly.
- **`m.Run`** — The method on `*testing.M` that runs all tests/benchmarks/examples/fuzz targets.
- **Setup** — Code run before any test, typically inside `TestMain` before `m.Run`.
- **Teardown** — Code run after all tests, typically inside `TestMain` after `m.Run`.
- **`-short`** — A standard test flag that requests skipping slow tests.
- **`testing.Short()`** — Returns `true` when `-short` was passed; usable after `flag.Parse`.

Keep this glossary handy; the terms appear in every page that follows.

## A short FAQ

**Q. Why do I see a `_testmain.go` file in some build outputs?**
That is the generated file the Go tool writes. You normally never see it unless you pass `-work` to preserve build artifacts. It contains the actual `main()` function that the test binary runs.

**Q. Can I have two test packages in one directory?**
Yes — `mypkg` and `mypkg_test`. They share a single test binary. You can have one `TestMain` total across both (because the compiler builds them together).

**Q. Why does `go test` show no output for my `TestMain` print statements?**
Because by default `go test` only shows output on failure. Run with `-v` to see all output.

**Q. Can `TestMain` accept arguments?**
No. The signature is fixed: `func TestMain(m *testing.M)`. Arguments come from flags (parsed via `flag.Parse`) or environment variables (`os.Getenv`).

**Q. Does `TestMain` work with `-race`?**
Yes. `go test -race` enables the data race detector for the whole binary, including `TestMain`. If your setup has a race, `-race` will print it.

**Q. Does `TestMain` work with `-cover`?**
Yes. `-cover` instruments the package under test for coverage; `TestMain` itself is also instrumented. Coverage results include `TestMain` if there are branches inside.

**Q. Can I call `os.Exit(0)` from inside a test to short-circuit?**
You can but should not. `os.Exit(0)` from inside `TestXxx` halts the binary mid-suite, skipping later tests and `TestMain` teardown. Use `t.Skip` or `t.SkipNow` instead.

If you internalized this page, you are ready for the middle page, which introduces custom flags, shared resources, and the `t.Cleanup` integration that elevates `TestMain` from "useful" to "indispensable".

## Extended walkthrough: a calculator package

Let us build a small calculator package from scratch, watching `TestMain` evolve as our needs grow. This is the kind of progression you will follow on a real project, in slow motion.

### Step A: no `TestMain` needed

```go
// calc.go
package calc

func Add(a, b int) int { return a + b }
func Sub(a, b int) int { return a - b }
```

```go
// calc_test.go
package calc

import "testing"

func TestAdd(t *testing.T) {
    if Add(2, 3) != 5 { t.Errorf("Add wrong") }
}

func TestSub(t *testing.T) {
    if Sub(5, 3) != 2 { t.Errorf("Sub wrong") }
}
```

`go test` passes. No `TestMain`. There is nothing shared, nothing expensive. This is the right state.

### Step B: add a custom rounding mode that comes from an env var

```go
// calc.go
package calc

import "os"

var roundingMode = os.Getenv("CALC_ROUND") // read at startup

func Div(a, b int) int {
    if roundingMode == "ceil" {
        return (a + b - 1) / b
    }
    return a / b
}
```

We want to test both modes. The naive approach is to use `t.Setenv`:

```go
func TestDivFloor(t *testing.T) {
    t.Setenv("CALC_ROUND", "")
    // but roundingMode was already set at init time!
    if Div(5, 2) != 2 { t.Errorf("expected 2") }
}
```

This fails because `roundingMode` was captured at package init, before `t.Setenv` ran. We could refactor `Div` to read the env every time, but the cleaner fix is to centralize:

```go
func TestMain(m *testing.M) {
    // for tests, override the rounding mode default
    os.Setenv("CALC_ROUND", "floor")
    roundingMode = "floor"
    os.Exit(m.Run())
}
```

Now we have a `TestMain` because of the init-order issue. Whether this is the right architectural choice or whether we should refactor `Div` to read the env lazily is debatable; the example shows how `TestMain` becomes the natural fix for init-time captures.

### Step C: add a configuration file

The calculator now reads a config from disk:

```go
// calc.go
package calc

var defaultPrecision int

func init() {
    f, _ := os.Open("calc.toml")
    if f == nil {
        defaultPrecision = 2
        return
    }
    // parse and set defaultPrecision
}
```

Tests want to control `defaultPrecision`. Now `TestMain` is mandatory because the init runs before any test, and we cannot stop it from reading the file. The fix: write a temporary file before init... except init has already run by the time `TestMain` is called. So we need to refactor `init` to be lazy, or to read from an injectable source.

This is a moment of design choice: `TestMain` is calling out that your `init` does too much. The right move is to refactor the production code so config loading is a function you can call from `TestMain` after pointing it at a test fixture.

```go
// calc.go
var defaultPrecision int

func LoadConfig(path string) error {
    // ...
    defaultPrecision = parsed.Precision
    return nil
}
```

Then:

```go
func TestMain(m *testing.M) {
    if err := calc.LoadConfig("testdata/calc.toml"); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
    os.Exit(m.Run())
}
```

The lesson: `TestMain` reveals init-order assumptions in your production code. Often the right answer is to refactor the production code, not to pile workarounds into `TestMain`.

### Step D: a long-running calculator with a server

Suppose the calculator grows a tiny HTTP server. Tests want to issue HTTP requests:

```go
var server *httptest.Server

func TestMain(m *testing.M) {
    server = httptest.NewServer(buildHandler())
    code := m.Run()
    server.Close()
    os.Exit(code)
}

func TestPing(t *testing.T) {
    resp, _ := http.Get(server.URL + "/ping")
    defer resp.Body.Close()
    if resp.StatusCode != 200 { t.Errorf("bad") }
}
```

This is the textbook use case for `TestMain`: an expensive resource (an HTTP server) shared across tests. The setup is two lines, the teardown is one line, and every test reads `server.URL` to get the address.

`httptest.NewServer` actually starts on a random port and is cheap — about 100 microseconds. Whether you need `TestMain` depends on how many tests you have. With three tests, just call `httptest.NewServer` per test and let `t.Cleanup` close it. With a hundred tests, the amortization wins. Engineering judgment, not religion.

### Step E: the test suite outgrows a single binary

If your package gets to 200 tests and `TestMain` is doing complex setup, consider splitting into multiple test packages or build-tagged groups. `TestMain` is still useful within each group, but the question shifts from "what should `TestMain` do?" to "what are the right test boundaries?". That is a senior-level question; the middle and senior pages cover it.

## Comparison: `TestMain` vs. `init`

A natural beginner question is "why not just use `init`?". After all, `init` runs before `main`, so it runs before `TestMain` too. Why have two mechanisms?

Differences:

- **Error handling.** `init` cannot return an error. If something goes wrong in `init`, you must `panic` or `log.Fatal`, both of which produce noisy output. `TestMain` can write a clean error message and `os.Exit(1)`.
- **Order.** Multiple `init` functions in multiple files run in alphabetical-file order, then top-to-bottom within each file. `TestMain` is one function in one file; the order is whatever you write.
- **Teardown.** `init` has no symmetric teardown. `TestMain` has a clear "after `m.Run`" section.
- **Test-only.** `init` runs for both the test binary and the production binary (if in the same package). `TestMain` runs only for the test binary (because it lives in `_test.go`).

In practice you may have both: `init` for production-relevant registration that you want to also happen in tests, and `TestMain` for test-specific lifecycle.

## A note on `Example` functions

`Example` functions are tested by `m.Run` just like `TestXxx`. If your package has examples with `// Output:` comments, they run alongside tests. Your `TestMain` setup applies to examples too. If your example reads from a shared `*sql.DB`, make sure the DB is set up by the time the example runs.

```go
func ExampleQuery() {
    rows, _ := db.Query("SELECT 1")
    defer rows.Close()
    fmt.Println("done")
    // Output: done
}
```

The example uses the package-level `db` that `TestMain` initialized. No different from a test from the example's point of view.

## Practical tip: use `log.SetFlags(0)` in `TestMain`

The default `log` package output includes a date/time prefix that interleaves messily with `go test -v` output:

```
2026/05/21 10:23:45 setup done
```

If you want cleaner output, drop the date/time:

```go
func TestMain(m *testing.M) {
    log.SetFlags(0)
    log.Println("setup done")
    os.Exit(m.Run())
}
```

Now your `setup done` line is just one word, easier to scan.

## When `TestMain` does too much

A sign your `TestMain` is in trouble: it is longer than 50 lines, has multiple nested helpers, and the package's `TestXxx` functions are short and uniform. The shared setup is doing the heavy lifting, and the tests are mostly assertions on globals. That coupling makes the suite brittle. The fix is usually to push setup into per-test helpers that build fresh fixtures, accepting some repetition for the sake of isolation.

This is not a junior problem to solve, but it is a junior problem to notice. If you find a `TestMain` that scares you, that is a real signal.

## Final practice

Write a `TestMain` for a package that:

1. Reads a config file from `testdata/config.json`.
2. Initializes a `*log.Logger` writing to `os.Stderr`.
3. Logs the config values at startup.
4. Logs "shutdown" at exit.
5. Exits with the correct code.

Spend ten minutes. Then read this:

```go
package myapp

import (
    "encoding/json"
    "log"
    "os"
    "testing"
)

type Config struct {
    APIKey   string `json:"api_key"`
    Endpoint string `json:"endpoint"`
}

var (
    config Config
    logger *log.Logger
)

func TestMain(m *testing.M) {
    logger = log.New(os.Stderr, "[test] ", log.LstdFlags)

    data, err := os.ReadFile("testdata/config.json")
    if err != nil {
        logger.Printf("read config: %v", err)
        os.Exit(1)
    }
    if err := json.Unmarshal(data, &config); err != nil {
        logger.Printf("parse config: %v", err)
        os.Exit(1)
    }
    logger.Printf("loaded config: endpoint=%s", config.Endpoint)

    code := m.Run()

    logger.Println("shutdown")
    os.Exit(code)
}
```

If your version is similar, you have it. Move on to middle.

## More worked examples

To cement the pattern, here are four more small, realistic `TestMain` examples. Read each, identify the pattern, and try to write a similar one from memory.

### Example 1: temporary directory for fixtures

A package that reads and writes files needs a scratch directory:

```go
var tmpDir string

func TestMain(m *testing.M) {
    var err error
    tmpDir, err = os.MkdirTemp("", "myapp-test-*")
    if err != nil {
        fmt.Fprintln(os.Stderr, "mkdir:", err)
        os.Exit(1)
    }
    code := m.Run()
    os.RemoveAll(tmpDir)
    os.Exit(code)
}

func TestWriteFile(t *testing.T) {
    path := filepath.Join(tmpDir, "out.txt")
    if err := os.WriteFile(path, []byte("hello"), 0644); err != nil {
        t.Fatal(err)
    }
}
```

Why `TestMain` here? Because `t.TempDir` already gives each test a directory. The reason to use `TestMain` is if you want to seed the directory with fixtures once and have tests read from it. Otherwise prefer `t.TempDir`.

### Example 2: pre-warmed cache

A package computes expensive things and caches them:

```go
var cache *Cache

func TestMain(m *testing.M) {
    cache = NewCache()
    for _, item := range testdata.Fixtures {
        cache.Set(item.Key, item.Value)
    }
    os.Exit(m.Run())
}

func TestLookup(t *testing.T) {
    got, ok := cache.Get("alpha")
    if !ok { t.Fatal("not found") }
    _ = got
}
```

The cache is pre-populated once. Tests read; they may also write, in which case isolation is broken — choose between cleaning the cache per test (`t.Cleanup`) or accepting coupling.

### Example 3: signal handler test

A package that registers a signal handler:

```go
func TestMain(m *testing.M) {
    // production code registers a handler in its init
    // tests just want to verify the handler is registered
    signal.Stop(stopChan) // clear default
    signal.Notify(stopChan, syscall.SIGUSR1)
    code := m.Run()
    signal.Stop(stopChan)
    os.Exit(code)
}
```

Signal handlers are process-wide; setting them up in `TestMain` and clearing in teardown is the right scope.

### Example 4: random seed

Tests that use randomness want determinism:

```go
var seed int64

func TestMain(m *testing.M) {
    if envSeed := os.Getenv("TEST_SEED"); envSeed != "" {
        seed, _ = strconv.ParseInt(envSeed, 10, 64)
    } else {
        seed = time.Now().UnixNano()
    }
    fmt.Fprintf(os.Stderr, "seed=%d\n", seed)
    rand.Seed(seed)
    os.Exit(m.Run())
}
```

When a test fails, you see the seed in the output. Re-running with `TEST_SEED=...` reproduces the failure. This pattern is essential for any test suite using randomness.

## Mental model summary

After reading this page, you should hold the following model in your head:

```
TestMain is a hook the testing framework gives you to wrap m.Run.
m.Run runs every test, benchmark, and example in the binary.
m.Run returns an exit code (0 or 1).
You exit the process with that code via os.Exit.
os.Exit skips defers. Wrap with a helper if you want defers.
You may not use *testing.T inside TestMain. Use stderr + os.Exit.
flag.Parse has not run. Call it if you need flags before m.Run.
One TestMain per package, in a _test.go file.
```

If you can recite that paragraph in your sleep, your foundation is solid. The middle page builds on it with custom flags, shared resources, and the `t.Cleanup` integration.

## Reading other people's `TestMain` code

A good exercise is to read `TestMain` functions from popular Go projects on GitHub. Here are starter points:

- **`k8s.io/kubernetes`** — many integration test packages have `TestMain` that sets up clusters. The patterns are mature and battle-tested.
- **`go.etcd.io/etcd`** — distributed-system tests with deep lifecycle requirements.
- **`github.com/grpc/grpc-go`** — networking integration tests.
- **`github.com/prometheus/prometheus`** — monitoring tests with file fixtures.

Pick one, search for `func TestMain(m \*testing.M)` (in GitHub's UI), read three. Notice the shape: how do they handle setup errors? Do they use `defer`? Do they have flag parsing? Do they call `os.Exit` or return normally?

By the time you have read ten real `TestMain` functions, you will recognize the patterns instantly.

## A tiny diagnostic exercise

Here is a `TestMain` with a subtle bug. Read it, find the bug, and explain the fix without scrolling.

```go
package mypkg

import (
    "flag"
    "fmt"
    "os"
    "testing"
)

var debug = flag.Bool("debug", false, "")

func TestMain(m *testing.M) {
    if *debug {
        fmt.Println("debug mode on")
    }
    flag.Parse()
    os.Exit(m.Run())
}
```

Take ten seconds.

The bug: `*debug` is read **before** `flag.Parse()`. So `*debug` is always the default value `false`, even when you run `go test -debug`. The fix: move `flag.Parse()` before the conditional:

```go
func TestMain(m *testing.M) {
    flag.Parse()
    if *debug {
        fmt.Println("debug mode on")
    }
    os.Exit(m.Run())
}
```

If you spotted that, you have internalized the most common `TestMain` flag bug. If you missed it, re-read the flag-parsing section.

## Walking through `go test -v` carefully

Let us look at the precise output of a small example. Source:

```go
package adder

import (
    "fmt"
    "os"
    "testing"
)

var globalValue int

func TestMain(m *testing.M) {
    fmt.Println("[TestMain] setup")
    globalValue = 42
    code := m.Run()
    fmt.Println("[TestMain] teardown")
    os.Exit(code)
}

func TestGlobalValue(t *testing.T) {
    t.Logf("globalValue=%d", globalValue)
    if globalValue != 42 {
        t.Errorf("globalValue is %d, want 42", globalValue)
    }
}

func TestZero(t *testing.T) {
    if 1+1 != 2 {
        t.Error("math broken")
    }
}
```

Running `go test -v` produces approximately:

```
[TestMain] setup
=== RUN   TestGlobalValue
    adder_test.go:21: globalValue=42
--- PASS: TestGlobalValue (0.00s)
=== RUN   TestZero
--- PASS: TestZero (0.00s)
PASS
[TestMain] teardown
ok      example.com/adder    0.001s
```

Each line means something specific:

- `[TestMain] setup` — your `fmt.Println` from before `m.Run`.
- `=== RUN   TestGlobalValue` — the testing framework announces a test starts.
- `    adder_test.go:21: globalValue=42` — your `t.Logf` output, indented to show it belongs to the test.
- `--- PASS: TestGlobalValue (0.00s)` — the test passed; duration in parentheses.
- `=== RUN   TestZero` — next test starts.
- `--- PASS: TestZero (0.00s)` — passed.
- `PASS` — overall result for the package.
- `[TestMain] teardown` — your `fmt.Println` from after `m.Run`.
- `ok      example.com/adder    0.001s` — `go test`'s summary line, printed after the binary exits.

Notice: `PASS` (or `FAIL`) is printed by `m.Run` itself, before `m.Run` returns. Your teardown logs come after. The summary line is printed by `go test`, the wrapper command, after seeing the binary's exit code.

Understanding this output order is critical when debugging. If teardown logs appear *before* `PASS`, something is wrong — either you put teardown in the wrong place, or your output is being buffered weirdly.

## Buffered output gotcha

Speaking of buffering: `fmt.Println` writes to `os.Stdout`, which is line-buffered when connected to a terminal but **block-buffered** when piped. If you do:

```
go test -v | tee output.log
```

You may see `[TestMain] setup` appear *after* the test names. The fix is to call `os.Stdout.Sync()` after your prints, or to write to `os.Stderr`, which is unbuffered:

```go
fmt.Fprintln(os.Stderr, "[TestMain] setup")
```

Many testing setups prefer stderr for this reason.

## Beware of `init` order with `TestMain`

A subtle gotcha: package init functions run before `TestMain`. So if your package's `init` reads an env var and stores it in a global, and your `TestMain` wants to set that env var, the timing is wrong:

```go
// production code:
var apiKey string
func init() {
    apiKey = os.Getenv("API_KEY")
}
```

```go
// test code:
func TestMain(m *testing.M) {
    os.Setenv("API_KEY", "test-key") // too late! init already ran
    os.Exit(m.Run())
}
```

Tests see `apiKey == ""`. The fix is either:

1. Refactor `init` to be lazy, reading the env each call.
2. Have your test set the env *before the binary starts* — pass it as `API_KEY=test-key go test`.
3. Expose a setter that tests can call.

Each is appropriate in some context; choose based on whether you want tests to control config easily.

## A pitfall: shared mutable state

If your `TestMain` initializes a `map[string]int` and tests mutate it, parallel tests will race. The map will silently corrupt. The race detector (`go test -race`) catches this.

Fix options:

- Protect with a `sync.Mutex` or use `sync.Map`.
- Initialize per test.
- Make the global read-only after `TestMain` setup.

The cleanest pattern: read-only globals (set in `TestMain`, never mutated), per-test mutable state (created in `TestXxx` or `t.Helper`).

## Summary of common patterns

| Pattern | When to use | Example |
|---------|-------------|---------|
| No `TestMain` | Unit tests, no shared state | Pure function tests |
| `TestMain` + global `*sql.DB` | Integration tests, expensive DB | Shared in-memory SQLite |
| `TestMain` + `httptest.Server` | API testing | Shared handler |
| `TestMain` + flag parsing | Configurable test runs | `-dburl=...` |
| `TestMain` + `os.Setenv` | Process-wide env config | `LOG_LEVEL=debug` |
| `TestMain` + fixture loading | File-based test data | Load JSON once |

Pick the simplest that meets your need. Add complexity only when measured speed or stability demands it.

Now you have all the junior-level fundamentals. On to middle.

## Appendix A: a complete starter template

For quick reference, here is a "blank" `TestMain` template you can copy into any new package:

```go
package mypkg

import (
    "flag"
    "fmt"
    "os"
    "testing"
)

func TestMain(m *testing.M) {
    flag.Parse()

    if err := setup(); err != nil {
        fmt.Fprintln(os.Stderr, "setup:", err)
        os.Exit(1)
    }

    code := m.Run()

    teardown()
    os.Exit(code)
}

func setup() error {
    // initialize shared resources here
    return nil
}

func teardown() {
    // close shared resources here
}
```

Customize `setup` and `teardown`. Add package-level variables for shared state. That is the entire boilerplate.

## Appendix B: cheat sheet

When in doubt, refer to this:

- Define `TestMain` in `*_test.go`, exactly one per package.
- Call `flag.Parse()` first if reading flags.
- Call `m.Run()` exactly once.
- `m.Run()` returns `int`; pass it to `os.Exit`.
- No `defer` for cleanup unless using a return-normally helper.
- No `t.*` methods; use `fmt.Fprintln(os.Stderr, ...)` and `os.Exit(1)` on error.
- Print to `os.Stderr` for unbuffered output.
- Document what your `TestMain` sets up.

Keep this open in another tab the first few times you write a `TestMain`. Within a week, you will not need it.

## Appendix C: minimal vs. full template comparison

A side-by-side of "just enough" and "production-ready" for reference.

### Minimal

```go
func TestMain(m *testing.M) {
    setup()
    code := m.Run()
    teardown()
    os.Exit(code)
}
```

When: simple shared state, no flags, no expensive resources.

### Full

```go
func TestMain(m *testing.M) {
    flag.Parse()
    code := func() (c int) {
        defer func() {
            if r := recover(); r != nil {
                fmt.Fprintf(os.Stderr, "panic: %v\n", r)
                c = 1
            }
        }()
        if err := setup(); err != nil {
            fmt.Fprintln(os.Stderr, "setup:", err)
            return 1
        }
        defer teardown()
        return m.Run()
    }()
    os.Exit(code)
}
```

When: integration tests, shared expensive resources, flag-driven config.

Start with minimal; graduate to full as the package's needs grow. Most packages live happily in the minimal shape.
