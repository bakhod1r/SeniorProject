---
layout: default
title: TestMain — Find Bug
parent: TestMain Function
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/08-testmain/find-bug/
---

# TestMain — Find Bug

[← Back](../)

Each snippet has at least one bug related to `TestMain`. Spot the bug; the fix follows. These are real bugs from real code review. Internalize the pattern; the next one you encounter will look slightly different.

## Bug 1 — defer + os.Exit

```go
func TestMain(m *testing.M) {
    db := openDB()
    defer db.Close()
    os.Exit(m.Run())
}
```

**Bug.** `db.Close` is never called. `os.Exit` skips deferred functions.

**Fix:**

```go
func TestMain(m *testing.M) {
    db := openDB()
    code := m.Run()
    db.Close()
    os.Exit(code)
}
```

Or the helper-function pattern:

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

## Bug 2 — ignored exit code

```go
func TestMain(m *testing.M) {
    setup()
    m.Run()
}
```

**Bug.** The exit code is discarded. CI thinks the suite passed even when tests fail.

**Fix:** `os.Exit(m.Run())` (or rely on Go 1.15+ implicit forwarding by writing `code := m.Run()` is still wrong if `code` is discarded — use `os.Exit(m.Run())` for clarity).

## Bug 3 — flag read before parse

```go
var dbURL = flag.String("dburl", "memory://", "")

func TestMain(m *testing.M) {
    fmt.Println("Using DB:", *dbURL)
    os.Exit(m.Run())
}
```

**Bug.** Output always prints `memory://` regardless of `-dburl=...`.

**Fix:** call `flag.Parse()` first:

```go
func TestMain(m *testing.M) {
    flag.Parse()
    fmt.Println("Using DB:", *dbURL)
    os.Exit(m.Run())
}
```

## Bug 4 — duplicate `TestMain`

Two files in the same package each define `func TestMain(m *testing.M)`. The build fails with `duplicate function TestMain`.

**Fix:** keep exactly one. If both files have setup needs, fold them into a single function and call helpers.

## Bug 5 — wrong signature

```go
func TestMain(t *testing.T) {
    setup()
}
```

**Bug.** The test binary treats it as a normal test (because the name starts with `Test`), not as a lifecycle hook.

**Fix:** parameter must be `*testing.M`, not `*testing.T`:

```go
func TestMain(m *testing.M) {
    setup()
    os.Exit(m.Run())
}
```

## Bug 6 — calling `m.Run` twice

```go
func TestMain(m *testing.M) {
    m.Run()
    m.Run()
    os.Exit(0)
}
```

**Bug.** Second `m.Run` panics or no-ops depending on Go version. Either way, useless.

**Fix:** one `m.Run` per process.

## Bug 7 — setup goroutine race

```go
var data []string

func TestMain(m *testing.M) {
    go func() {
        data = loadData()
    }()
    os.Exit(m.Run())
}
```

**Bug.** Tests start running before `loadData` completes. Read of `data` races with the write.

**Fix:** do the work synchronously, or `wg.Wait()` before `m.Run`:

```go
func TestMain(m *testing.M) {
    data = loadData() // synchronous
    os.Exit(m.Run())
}
```

## Bug 8 — log to file with no flush

```go
func TestMain(m *testing.M) {
    f, _ := os.Create("test.log")
    log.SetOutput(f)
    os.Exit(m.Run())
}
```

**Bug.** `f.Close()` is never called; `os.Exit` skips defers; buffered writes may be lost.

**Fix:** `code := m.Run(); f.Close(); os.Exit(code)`.

## Bug 9 — `TestMain` in a non-test file

```go
// file: main.go
package main

func TestMain(m *testing.M) { /* ... */ }
```

**Bug.** `go test` does not see it (not in a `_test.go` file), and the production binary gets a confusingly named function.

**Fix:** move to `main_test.go`.

## Bug 10 — environment leak across tests

```go
func TestMain(m *testing.M) {
    os.Setenv("APP_MODE", "test")
    os.Exit(m.Run())
}
```

**Bug.** Any test that wants to verify "what if APP_MODE is unset" cannot, because the env was set process-wide. The leak is within the same binary, not across processes.

**Fix:** prefer `t.Setenv` inside individual tests when scope is per-test. If truly process-wide, document it and have tests that need a different value `t.Setenv` to override.

## Bug 11 — coverage misconfiguration

```go
func TestMain(m *testing.M) {
    setup()
    os.Exit(m.Run())
}
// no tests in the package
```

**Bug.** `go test -cover` reports 0% coverage because no test functions exist. `TestMain` is not a test.

**Fix:** add at least one `TestXxx`, even an empty one, or accept the report.

## Bug 12 — calling `os.Exit` inside a test

```go
func TestThing(t *testing.T) {
    if err := setup(); err != nil {
        os.Exit(1)
    }
}
```

**Bug.** Skips teardown registered in `TestMain` and other tests.

**Fix:** `t.Fatal(err)` and let `TestMain` handle teardown.

## Bug 13 — flag definition after `flag.Parse`

```go
func TestMain(m *testing.M) {
    flag.Parse()
    flag.String("foo", "", "")
    os.Exit(m.Run())
}
```

**Bug.** Flag is defined too late; `-foo=bar` on the command line was already rejected during `flag.Parse`.

**Fix:** define flags as package-level variables in a `_test.go` file, never after `flag.Parse`.

## Bug 14 — test that depends on `TestMain` order

```go
var counter int

func TestMain(m *testing.M) {
    counter = 0
    os.Exit(m.Run())
}

func TestA(t *testing.T) { counter++ }
func TestB(t *testing.T) {
    if counter != 1 {
        t.Fatal("TestA must run first")
    }
}
```

**Bug.** Tests have no defined execution order. `go test -shuffle=on` will break it.

**Fix:** each test sets up its own state, or use a single test with subtests.

## Bug 15 — leaking container

```go
func TestMain(m *testing.M) {
    container := startPostgres()
    code := m.Run()
    if code != 0 {
        os.Exit(code) // leaks container on failure
    }
    container.Terminate(context.Background())
    os.Exit(code)
}
```

**Bug.** On failure, the container is never terminated.

**Fix:** terminate before the exit, unconditionally:

```go
func TestMain(m *testing.M) {
    container := startPostgres()
    code := m.Run()
    container.Terminate(context.Background())
    os.Exit(code)
}
```

## Bug 16 — `log.Fatal` in setup

```go
func TestMain(m *testing.M) {
    if err := setup(); err != nil {
        log.Fatal(err)
    }
    os.Exit(m.Run())
}
```

**Bug (subtle).** `log.Fatal` calls `os.Exit(1)`, which is technically fine for the immediate purpose, but it also emits a stack trace that adds noise and prevents you from running any teardown.

**Fix:** prefer a one-line message and explicit exit:

```go
if err := setup(); err != nil {
    fmt.Fprintf(os.Stderr, "setup failed: %v\n", err)
    os.Exit(1)
}
```

## Bug 17 — incorrect return type assumption

```go
func TestMain(m *testing.M) int {
    return m.Run()
}
```

**Bug.** Signature wrong; `TestMain` must return nothing. The compiler may not flag it if the generated test main expects a `func(*testing.M)`. In some Go versions this builds as a regular function and is ignored.

**Fix:** correct signature:

```go
func TestMain(m *testing.M) {
    os.Exit(m.Run())
}
```

## Bug 18 — relying on `init` order between test files

```go
// file: a_test.go
var a *Thing
func init() { a = newThing() }

// file: b_test.go
var b *Thing
func init() { b = newThingDependentOn(a) }
```

**Bug.** Go does not guarantee init order across files in the same package beyond top-to-bottom within each file and alphabetical for files. `b`'s init may run before `a`'s, observing `nil`.

**Fix:** do the dependent setup in `TestMain` where the order is explicit:

```go
func TestMain(m *testing.M) {
    a = newThing()
    b = newThingDependentOn(a)
    os.Exit(m.Run())
}
```

## Bug 19 — recovering panics and swallowing them

```go
func TestMain(m *testing.M) {
    defer func() {
        if r := recover(); r != nil {
            // swallowed; tests appear to pass
        }
    }()
    os.Exit(m.Run())
}
```

**Bug.** A panic in setup (before `m.Run`) is silently swallowed, the program exits 0, CI thinks the suite passed.

**Fix:** at minimum re-emit and exit non-zero:

```go
defer func() {
    if r := recover(); r != nil {
        fmt.Fprintf(os.Stderr, "panic: %v\n", r)
        os.Exit(1)
    }
}()
```

## Bug 20 — assuming `t.Parallel` affects `TestMain`

A developer writes:

```go
func TestMain(m *testing.M) {
    setup()
    setup2() // expected to run in parallel with setup()
    os.Exit(m.Run())
}
```

**Bug.** `setup` and `setup2` run sequentially. There is no `t.Parallel` available in `TestMain`. Calling them concurrently requires explicit goroutines or `errgroup`.

**Fix:**

```go
g, _ := errgroup.WithContext(context.Background())
g.Go(setup)
g.Go(setup2)
if err := g.Wait(); err != nil { /* ... */ }
```

## Bug 21 — `TestMain` in `_test.go` of an external test package, depends on internal symbol

```go
// file: mypkg_test.go
package mypkg_test

import "example.com/mypkg"

func TestMain(m *testing.M) {
    mypkg.internalSetup() // not exported
    os.Exit(m.Run())
}
```

**Bug.** `internalSetup` is unexported and unreachable from `mypkg_test`. Build fails.

**Fix:** either export it (rename `InternalSetup`), or move `TestMain` into `package mypkg` (white-box).

## Bug 22 — forgetting `os.Exit` after manual code path

```go
func TestMain(m *testing.M) {
    code := m.Run()
    cleanup()
    // missing os.Exit(code)
}
```

**Bug.** Since Go 1.15 returning normally exits with the result of `m.Run`, *if the variable goes through*. But here we never used `code`, so the runtime forwards 0 always. Subtle.

Actually re-check: Go 1.15+ forwards the result of `m.Run` regardless of whether you assigned it — the runtime hooks into the M itself. So this might be safe. But the explicit `os.Exit(code)` is clearer and works on all Go versions.

**Fix:** explicit is better:

```go
os.Exit(code)
```

These bugs cover the bulk of what surfaces in real review. Internalize the deferred-os.Exit interaction and the flag-parse rule, then add the rest as muscle memory. Make a habit, when reviewing a `TestMain` you have not written, of asking five questions:

1. Is `flag.Parse()` called before any flag read?
2. Is `m.Run()` called exactly once?
3. Is the exit code propagated via `os.Exit`?
4. Do all setup resources have corresponding teardown that does not rely on `defer` after `os.Exit`?
5. Are there goroutines started in `TestMain` that need to be joined?

If you can answer yes to all five, the `TestMain` is probably correct.
