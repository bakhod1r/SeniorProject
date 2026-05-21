---
layout: default
title: Testing Basics — Middle
parent: Testing Basics
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/middle/
---

# Testing Basics — Middle

[← Back](../)

The junior page covered `TestXxx`, basic assertions, and the bare `go test` command. This page covers everything you need to write *production-quality* unit tests in Go: internal vs external test packages, subtests, parallelism, the three lifecycle helpers (`Cleanup`, `TempDir`, `Setenv`), `Helper`, `Skip`, and the lesser-known corners of `testing.T`. By the end you should be able to read a `_test.go` file in `net/http`, `encoding/json`, or `sync` and recognise every idiom on the page.

## 1. Internal vs external test packages

A `_test.go` file in directory `foo/` declares one of two packages:

- `package foo` — internal test package. Compiles alongside `foo`. Sees unexported identifiers.
- `package foo_test` — external test package. Compiles as if it were a consumer of `foo`. Sees only exported identifiers.

Both are allowed in the same directory. The Go test toolchain links them into a single test binary. You can also have both in a single project — many stdlib packages do.

### When to use which

The default should be `package foo_test` for three reasons:

1. **API hygiene** — it forces tests to use only the public API, which is what real users see. If a test cannot reach a case via the public API, the public API may be inadequate.
2. **Refactor safety** — internal changes do not break external tests as long as the public contract holds.
3. **Documentation** — `Example` functions in `foo_test` show up in `pkg.go.dev` under `foo`. Internal examples appear differently.

Drop into `package foo` when:

- You need to test an unexported function with complex invariants (a small private state machine).
- You want to assert against unexported state for white-box debugging.
- You need to inject a private mock that should not be public.

Many packages split: `foo_internal_test.go` (`package foo`) holds the white-box unit tests; `foo_test.go` (`package foo_test`) holds the black-box ones.

### The `export_test.go` pattern

If your external tests need to reach unexported state occasionally, write an `export_test.go` file in `package foo`:

```go
// foo/export_test.go
package foo

// only compiled in _test.go context, so this never escapes to users
var InternalState = &state
func ResetForTest() { state = newState() }
```

Now external tests can do:

```go
package foo_test

import "foo"

func TestX(t *testing.T) {
    foo.ResetForTest()
    *foo.InternalState = 42
    // ...
}
```

`export_test.go` is only compiled into the test binary, so the public API stays clean. The Go standard library uses this pattern in many packages (look at `src/runtime/export_test.go`).

### Compile-time check

Try writing both files:

```go
// foo/foo.go
package foo

type secret struct{ value int }
var hidden = secret{}
func Public() int { return hidden.value }
```

```go
// foo/foo_test.go
package foo_test

import (
    "testing"
    "foo"
)

func TestPublic(t *testing.T) {
    if got := foo.Public(); got != 0 {
        t.Errorf("Public() = %d, want 0", got)
    }
    // foo.hidden would not compile — unexported
}
```

```go
// foo/foo_white_test.go
package foo

import "testing"

func TestHidden(t *testing.T) {
    if hidden.value != 0 {
        t.Error("hidden.value not zero")
    }
}
```

Both tests run from `go test ./foo`. The toolchain compiles `foo_white_test.go` against the internal package; `foo_test.go` against an imported view.

## 2. Subtests with `t.Run`

`t.Run` creates a nested test with its own `*testing.T`. The pattern is fundamental.

```go
func TestUser(t *testing.T) {
    t.Run("create", func(t *testing.T) {
        // assertions about user creation
    })
    t.Run("update", func(t *testing.T) {
        // assertions about user update
    })
    t.Run("delete", func(t *testing.T) {
        // assertions about user deletion
    })
}
```

Three benefits:

1. **Named cases in output**: `TestUser/create` is more readable than three separate functions.
2. **Independent assertions**: a `Fatal` inside one subtest does not stop the next.
3. **Selectable via `-run`**: `go test -run TestUser/create`.

### Subtest naming

The first argument is the subtest name. The framework normalises it: spaces become underscores, non-printable characters get escaped, slashes are interpreted as path separators in the full name. So:

- `t.Run("create user", ...)` → `TestUser/create_user`
- `t.Run("a/b", ...)` → `TestUser/a/b` (two levels)

Pick names that survive the normalisation. Stick to alphanumeric, underscore, dash.

### Table-driven with subtests

The combination is the canonical Go test pattern:

```go
func TestAdd(t *testing.T) {
    cases := []struct {
        name    string
        a, b    int
        want    int
    }{
        {"positives", 2, 3, 5},
        {"negatives", -2, -3, -5},
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

Read enough Go test code and you will see this layout ten times a day. Every Go developer recognises it instantly.

### `t.Run` return value

`t.Run` returns a `bool`: true if the subtest passed, false otherwise. Use it when subsequent work depends on prior success:

```go
func TestPipeline(t *testing.T) {
    if !t.Run("setup", setup) {
        return
    }
    if !t.Run("migrate", migrate) {
        return
    }
    t.Run("query", query)
}
```

Without the early return, a failed setup leaves the test running through migrate and query, drowning the real error in cascading failures.

## 3. Parallel tests with `t.Parallel`

`t.Parallel` marks the current test as parallel. The framework:

1. Records the test in a queue.
2. Pauses the test immediately.
3. Runs all non-parallel tests serially first.
4. Resumes parallel tests up to `-parallel` (default `GOMAXPROCS`) at a time.

```go
func TestSlow(t *testing.T) {
    t.Parallel()
    time.Sleep(200 * time.Millisecond)
}
```

If you have five such tests, they take ~200 ms in total on a multi-core machine instead of 1 s.

### Parallel subtests

`t.Parallel` works at the subtest level too:

```go
func TestAll(t *testing.T) {
    cases := []struct{ name string }{ /* ... */ }
    for _, tc := range cases {
        tc := tc // pre-Go 1.22; safe in 1.22+
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            run(tc)
        })
    }
}
```

The subtests run concurrently. The parent `TestAll` waits for them all before its `Cleanup` runs.

### The loop-variable gotcha

Before Go 1.22, each iteration of a `for _, tc := range cases` reuses the same `tc` variable. The subtest closure captures the variable, not the value. By the time parallel subtests resume, the loop is finished and `tc` holds the last element. Symptom: every parallel subtest sees the same case.

The fix is one of:

```go
for _, tc := range cases {
    tc := tc                  // shadowing creates a new variable per iteration
    t.Run(tc.name, ...)
}
```

or upgrade to Go 1.22+, where the language change makes the loop variable per-iteration by default.

### Two `Parallel` calls

If both the parent and the subtest call `t.Parallel`, that is intentional:

```go
func TestAll(t *testing.T) {
    t.Parallel()      // parallel with other Test functions
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel() // parallel with sibling subtests
            run(tc)
        })
    }
}
```

The first call lets `TestAll` run concurrently with other `TestXxx` in the package. The second call lets the subtests run concurrently among themselves.

### `Parallel` ordering and cleanup

A subtle but important rule: a parent's `t.Run` *returns* before parallel subtests finish, but the parent's `Cleanup` runs only after all subtests complete.

```go
func TestX(t *testing.T) {
    pool := newPool()
    t.Cleanup(pool.Close) // runs AFTER subtests
    // pool.Close after subtests finish — safe
    
    t.Run("a", func(t *testing.T) { t.Parallel(); pool.Use() })
    t.Run("b", func(t *testing.T) { t.Parallel(); pool.Use() })
}
```

If you used `defer pool.Close()` instead, the pool would close immediately after the `t.Run` calls return — *before* the parallel subtests resumed. The subtests would then use a closed pool. Always prefer `t.Cleanup` over `defer` in tests with parallel subtests.

### When NOT to use `t.Parallel`

- Tests that read/write process-global state (env vars, working directory, locale).
- Tests that touch package-level variables in the package under test.
- Tests using `t.Setenv` — the framework panics if you try.
- Tests that use shared resources without locks (a single Redis connection, a single file handle).

Parallel tests are great when the package under test is genuinely concurrency-safe. They expose hidden assumptions otherwise.

## 4. `t.Cleanup` — the lifecycle helper

`t.Cleanup(f)` registers `f` to run when the test ends, including after parallel subtests.

```go
func TestX(t *testing.T) {
    file, err := os.Open("data.txt")
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { file.Close() })
    // assertions
}
```

Properties:

- Cleanups run in **LIFO** order: the last registered runs first.
- Cleanups run even if the test `Fatal`s or `Skip`s.
- Cleanups themselves can register further cleanups (which then run within the LIFO ordering).
- Cleanups run after all parallel subtests complete.

### Why `t.Cleanup` instead of `defer`?

Two reasons:

1. **Parallel subtest correctness**: `defer` runs when the function returns, which for a `TestX` with parallel subtests is *before* the subtests resume. `Cleanup` waits.
2. **Helper-friendly**: A helper function that opens a resource can register the close via `t.Cleanup(...)` without forcing every caller to remember a `defer`:

```go
func openTestFile(t *testing.T, name string) *os.File {
    t.Helper()
    f, err := os.Open(name)
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { f.Close() })
    return f
}

func TestX(t *testing.T) {
    f := openTestFile(t, "data.txt")
    // use f; no defer needed
}
```

This pattern — helpers that handle their own cleanup — is the Go-idiomatic way to write fixtures. There is no `setUp`/`tearDown`; instead, helpers attach cleanups to the test they run inside.

### LIFO ordering example

```go
func TestX(t *testing.T) {
    t.Cleanup(func() { fmt.Println("first") })
    t.Cleanup(func() { fmt.Println("second") })
    t.Cleanup(func() { fmt.Println("third") })
}
```

Output:

```
third
second
first
```

This mirrors `defer` semantics, which is what makes the pattern feel natural.

## 5. `t.TempDir` — managed temp directories

`t.TempDir()` returns a unique directory path. The framework:

- Creates the directory before returning.
- Registers a cleanup to remove it (and all its contents) when the test ends.
- Returns the same path on subsequent calls within the same `*testing.T`.

```go
func TestWrite(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "out.txt")
    if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
        t.Fatal(err)
    }
    // dir is removed automatically when the test ends
}
```

Compared to `os.MkdirTemp`:

- No need to write the cleanup yourself.
- Unique per test — parallel tests cannot collide.
- Cross-platform: works on Linux, macOS, Windows.

### Subtest behaviour

A subtest gets a *different* path from its parent:

```go
func TestX(t *testing.T) {
    parent := t.TempDir() // e.g. /tmp/TestX12345
    t.Run("sub", func(t *testing.T) {
        child := t.TempDir() // e.g. /tmp/TestX/sub54321 (different)
    })
}
```

If you want subtests to share a directory, call `t.TempDir` on the parent and pass `parent` down explicitly. If you want them isolated, call `t.TempDir` inside each subtest.

### Permissions and platform notes

`t.TempDir` creates directories under `os.TempDir()` (`/tmp` on Linux, `%TEMP%` on Windows). The directory is owned by the test process and removed at end of test. If a test deliberately changes permissions on a file inside the temp dir, the cleanup may still fail on Windows — the framework prints a warning but does not fail the test.

## 6. `t.Setenv` — managed environment variables

`t.Setenv(key, value)` sets an environment variable for the duration of the test and registers a cleanup to restore it.

```go
func TestConfig(t *testing.T) {
    t.Setenv("APP_PORT", "9999")
    cfg := LoadConfig()
    if cfg.Port != 9999 {
        t.Errorf("port = %d, want 9999", cfg.Port)
    }
}
```

After the test:

- If `APP_PORT` was set before, it is restored to that value.
- If it was unset before, `os.Unsetenv("APP_PORT")` is called.

This is markedly safer than `os.Setenv` plus a `defer os.Setenv("APP_PORT", "")` — the latter cannot distinguish "set to empty string" from "unset", which is observably different to `os.LookupEnv`.

### Incompatibility with `t.Parallel`

`t.Setenv` panics if called from a test that has called `t.Parallel`. The reason: env vars are process-global, so two parallel tests setting different values would race. The check is one-way:

- `t.Parallel()` then `t.Setenv` → panic.
- `t.Setenv` then `t.Parallel` → marks the test as not-parallel, no panic. (The framework also refuses to mark a Setenv'd test parallel.)

If you want env-dependent tests to run in parallel with other tests, isolate them in a non-parallel subtest:

```go
func TestX(t *testing.T) {
    t.Parallel() // parallel with other tests
    t.Run("env_dependent", func(t *testing.T) {
        // no t.Parallel here
        t.Setenv("FOO", "bar")
        // assertions
    })
}
```

The subtest runs serially within `TestX` but `TestX` itself runs in parallel with sibling tests. This is the standard workaround.

## 7. `t.Helper` — clean failure lines

When you write an assertion helper, the framework should report the failure line in the *caller*, not inside the helper. Mark the helper with `t.Helper()`:

```go
func assertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}

func TestX(t *testing.T) {
    assertEqual(t, 1+1, 2) // failure reported at this line
    assertEqual(t, 2*2, 5) // failure reported at this line
}
```

Without `t.Helper()`, all failures point to line 3 inside `assertEqual`. With it, they point at the call sites. The mark is per-function: every helper in a chain must call it.

### Chained helpers

A helper that calls another helper must also call `t.Helper`:

```go
func assertContains(t *testing.T, haystack, needle string) {
    t.Helper()
    if !strings.Contains(haystack, needle) {
        t.Errorf("%q does not contain %q", haystack, needle)
    }
}

func assertContainsAll(t *testing.T, haystack string, needles ...string) {
    t.Helper()
    for _, n := range needles {
        assertContains(t, haystack, n) // each call reports at the original call site of assertContainsAll
    }
}
```

If `assertContainsAll` did not call `t.Helper`, the failure line would be inside it. Add the call to every helper.

### What `Helper` is, technically

`t.Helper()` records the calling function's PC in a `map[uintptr]bool` on the test. When the framework formats a failure message, it walks up the stack and reports the first frame whose PC is not in the helper map. So a chain of helpers all calling `t.Helper` correctly reports the test function as the failure site.

## 8. `t.Skip` — conditional skipping

`t.Skip(args...)`, `t.Skipf(format, args...)`, and `t.SkipNow()` mark the test as skipped and stop its execution. The test counts as neither passed nor failed.

```go
func TestNetwork(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping network test in short mode")
    }
    // do network stuff
}

func TestRequiresLinux(t *testing.T) {
    if runtime.GOOS != "linux" {
        t.Skipf("only runs on linux, got %s", runtime.GOOS)
    }
    // linux-specific
}
```

Common patterns:

- Skip in `-short` mode for slow tests.
- Skip on unsupported OS or arch.
- Skip if an external service is unavailable.
- Skip if a feature flag is off.

Use `t.Skip` honestly: a permanent skip is dead code. If a test is broken, fix it or delete it.

## 9. `testing.Short()` and `testing.Verbose()`

Two package-level functions that report the state of `-short` and `-v`:

```go
func TestExpensive(t *testing.T) {
    if testing.Short() {
        t.Skip("expensive test skipped in short mode")
    }
    // ...
}
```

`testing.Short()` returns true if `-short` was passed. `testing.Verbose()` returns true if `-v` was passed.

Two cautions:

1. Both read flag state, so they require `flag.Parse` to have run. The framework calls `flag.Parse` inside `m.Run` automatically; calling these functions in `init` panics.
2. They are global, not per-test. A test that checks `Short()` once at the top is conventional; checking it in a loop is just noise.

## 10. `t.Deadline` — bounded waits

`t.Deadline()` returns the absolute time at which `-timeout` will kill the binary, plus a bool indicating whether a deadline is set.

```go
func TestPoll(t *testing.T) {
    deadline, ok := t.Deadline()
    if !ok {
        // no timeout set — be conservative
        deadline = time.Now().Add(30 * time.Second)
    }
    for time.Now().Before(deadline) {
        if condition() {
            return
        }
        time.Sleep(50 * time.Millisecond)
    }
    t.Fatal("condition never met")
}
```

The deadline is shared across the test binary. If you have `-timeout=2m`, every test sees the same absolute end time. Use it to make tests adaptive: stop polling, write partial diagnostics, return early.

## 11. `t.Name`, `t.Failed`, `t.Skipped`

Less-used but occasionally useful:

- `t.Name()` returns the full hierarchical name (e.g. `TestX/sub_a`). Handy for log lines.
- `t.Failed()` returns true if the test has called `Error` or `Fail`.
- `t.Skipped()` returns true if the test has called `Skip`.

```go
func TestX(t *testing.T) {
    t.Cleanup(func() {
        if t.Failed() {
            // dump extra diagnostics
            t.Logf("test %s failed, here's the buffer: %s", t.Name(), buf.String())
        }
    })
    // assertions
}
```

This pattern — emit diagnostics only on failure — keeps passing tests quiet.

## 12. Test binary layout

When `go test` runs a package, it does:

1. Compile package `foo` and all dependencies.
2. Compile `foo_test.go` files (internal package).
3. Compile `foo_test/*` files (external package, if any).
4. Generate a `_testmain.go` that calls the user's `TestMain` or auto-generates one.
5. Link into a binary, run it, capture output, present it as `--- PASS:`/`--- FAIL:` lines.

You can keep the binary with `-c -o name.test`. You can dump the generated main with `go test -x -work ./foo`:

```
$ go test -x -work ./foo
WORK=/tmp/go-build123
...
# generates _testmain.go in WORK
```

Inspect `_testmain.go` to see exactly what the framework wires up. This is useful when debugging odd test discovery problems.

## 13. Test discovery details

`go test` discovers tests by reflecting on the test binary's `func TestXxx` symbols (collected at link time). The discovery rules:

- The function must be exported (`Test`, `Benchmark`, `Fuzz`, `Example` prefix).
- The character after the prefix must be uppercase (for `Test`, `Benchmark`, `Fuzz`) or `_` (for `Example_xxx`).
- The signature must match: `(*testing.T)`, `(*testing.B)`, `(*testing.F)`, or no args (for `Example`).

`go vet` warns about near-misses: `func TestSomething(t *testing.B)` triggers a warning because the signature is wrong. Fix the signature, do not silence the warning.

## 14. Logging from concurrent code

Tests that spawn goroutines may want to log from those goroutines. `t.Log` and `t.Errorf` are safe to call concurrently from any goroutine. Only `t.Fatal`, `t.FailNow`, and `t.SkipNow` are restricted to the test goroutine.

```go
func TestWorkers(t *testing.T) {
    errs := make(chan error, 10)
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            if err := work(i); err != nil {
                errs <- fmt.Errorf("worker %d: %w", i, err)
            }
            t.Logf("worker %d done", i) // safe
        }(i)
    }
    wg.Wait()
    close(errs)
    for err := range errs {
        t.Errorf("%v", err) // safe
    }
}
```

The pattern: do the work concurrently, route errors back through a channel, assert in the test goroutine.

## 15. The interplay of `-run` and subtests

`-run` is a regular expression, and the subtest name is treated as a path. To run only `TestUser/create`, you pass `-run TestUser/create`. The framework splits the regexp on `/` and matches each segment against the corresponding level of the test name.

To run *every* `create` subtest across many parent tests: `-run /create`. The leading `/` makes the first segment empty, matching every top-level test, then `create` matches the subtest.

To anchor: `-run '^TestUser$/^create$'` requires the exact names. Often useful in CI to disambiguate `TestUser` from `TestUserAdmin`.

## 16. `t.Parallel` and `TestMain`

If `TestMain` calls `m.Run()` once, parallel tests behave as expected. If `TestMain` calls `m.Run()` multiple times (rare — for example to run the suite twice with different configurations), parallel scheduling resets between calls. The `-parallel` value carries over because it is read once during flag parsing.

## 17. A realistic middle-page test file

Putting everything together:

```go
package useragent_test

import (
    "io"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"

    "example.com/useragent"
)

func newServer(t *testing.T) *httptest.Server {
    t.Helper()
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        io.WriteString(w, r.Header.Get("User-Agent"))
    }))
    t.Cleanup(srv.Close)
    return srv
}

func TestClient_SetsUserAgent(t *testing.T) {
    t.Parallel()
    srv := newServer(t)
    cases := []struct {
        name string
        ua   string
        want string
    }{
        {"default", "", "useragent/1.0"},
        {"custom", "myapp/2.0", "myapp/2.0"},
        {"empty_explicit", "  ", "useragent/1.0"},
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            c := useragent.NewClient(srv.URL, tc.ua)
            got, err := c.Fetch()
            if err != nil {
                t.Fatalf("Fetch: %v", err)
            }
            if !strings.EqualFold(got, tc.want) {
                t.Errorf("got %q, want %q", got, tc.want)
            }
        })
    }
}
```

Note the patterns:

- External test package (`useragent_test`).
- Test server constructed via a helper that registers its own cleanup.
- Outer `t.Parallel` lets `TestClient_SetsUserAgent` run concurrently with other tests.
- Inner `t.Parallel` parallelises the table cases.
- `tc := tc` shadows for pre-Go 1.22 correctness.
- Setup failures use `Fatalf`, assertion failures use `Errorf`.

Once these idioms feel natural, you are ready for the senior page.

## 18. Common mistakes at this level

- **Forgetting `t.Helper` in a chained helper** — failure line points inside the wrong function.
- **Using `defer` instead of `t.Cleanup` in a test with parallel subtests** — cleanup runs too early.
- **Calling `t.Setenv` after `t.Parallel`** — panic. Refactor or remove `t.Parallel`.
- **Sharing a map across subtests with `t.Parallel`** — race. Move state into the subtest.
- **Subtest name with `/`** — the framework treats `/` as a separator. Use `_` or `-`.
- **Reading flag state in `init`** — panics because `flag.Parse` has not run.
- **`t.Fatal` from a non-test goroutine** — test reports PASS silently or panics on recent Go versions.

The find-bug page collects these into runnable snippets.

## 19. What's next

You can now write production-quality unit tests. The senior page covers:

- Designing your packages to be testable (dependency injection without DI frameworks).
- White-box vs black-box trade-offs in real codebases.
- Test suites built on `TestMain`.
- Fixture management at scale.
- Integration boundaries: where unit ends and integration begins.
- Build tags for selective test runs.

Before moving on, finish tasks 1-10 in `tasks.md`. They cover everything above with one exercise each.
