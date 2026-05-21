---
layout: default
title: Parallel Tests — Middle
parent: Parallel Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/09-parallel-tests/middle/
---

# Parallel Tests — Middle

[← Back](../)

The junior page covered the syntax and the most common pitfalls. This page is about composing the primitives into reliable patterns: grouped parallel subtests, cleanup with sibling synchronisation, integration-style isolation with `t.TempDir`, environment-variable handling, the race detector in serious use, and the way `TestMain` interacts with parallel scheduling.

## 1. Two-tier parallelism in detail

There are two flags that govern test-time concurrency, and they compose:

| Flag | Scope | Default | Purpose |
|------|-------|---------|---------|
| `-p` | `go test` driver | `GOMAXPROCS` | Number of test binaries (packages) running simultaneously |
| `-parallel` | One test binary | `GOMAXPROCS` | Number of `t.Parallel` tests running simultaneously inside that binary |

On a 16-core CI runner, `go test -p 8 -parallel 16 ./...` peaks at 128 concurrent `*testing.T` goroutines. The runtime then multiplexes those goroutines across the OS threads available via `GOMAXPROCS`.

If you set `-parallel` very high and your tests are CPU-bound, you do not get more throughput — you get more context switches. If your tests are I/O-bound (DB, network), a higher `-parallel` lets goroutines wait concurrently, which is genuinely faster.

Rule of thumb:

- Pure-CPU tests: `-parallel ≈ GOMAXPROCS`.
- I/O-bound tests: `-parallel` 2x–8x `GOMAXPROCS`.
- Mixed: measure with `-cpuprofile` and decide.

## 2. Grouped parallel subtests

A subtest that calls `t.Parallel` causes its enclosing `t.Run` to return *immediately* (after pausing). The framework runs paused subtests after all serial siblings finish. This means:

```go
func TestThing(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            // ...
        })
    }
    // Here: subtests are NOT done yet. They are paused.
    // Any code after the loop runs BEFORE the parallel subtests.
    finalize() // wrong place for a teardown that needs all subtests done
}
```

To get a synchronisation point — a place where you know all your parallel subtests are finished — wrap them in another `t.Run`:

```go
func TestThing(t *testing.T) {
    t.Run("group", func(t *testing.T) {
        for _, tc := range cases {
            t.Run(tc.name, func(t *testing.T) {
                t.Parallel()
                // ...
            })
        }
    })
    // Here: all "group/*" subtests have finished.
    finalize() // safe
}
```

The outer `t.Run("group", ...)` does not return until *all* its children — including parallel ones — have completed. This is the canonical pattern for "do something after a fan-out".

## 3. Cleanup ordering

`t.Cleanup` functions registered on a test run after the test (and all its subtests) finish. Order is LIFO. For nested parallel tests, the order is:

1. Each child's cleanups run after the child finishes.
2. The parent's cleanups run after all children finish.

```go
func TestNested(t *testing.T) {
    t.Cleanup(func() { t.Log("parent cleanup") })

    t.Run("group", func(t *testing.T) {
        for i := 0; i < 2; i++ {
            i := i
            t.Run(fmt.Sprint(i), func(t *testing.T) {
                t.Parallel()
                t.Cleanup(func() { t.Logf("child %d cleanup", i) })
            })
        }
    })
}
```

Output (order of the two child cleanups is non-deterministic):

```
child 1 cleanup
child 0 cleanup
parent cleanup
```

When designing teardown:

- Register the cleanup as close to the resource acquisition as possible. `t.Cleanup` makes "acquire and register" a one-line idiom.
- Don't rely on cleanup running before the test returns; that's `defer`. Cleanup runs *after* the test returns.
- A failing test still runs its cleanups. `t.FailNow` (and friends) leave cleanups intact.

## 4. `t.Setenv` and the implicit serial mark

`t.Setenv` calls `os.Setenv` and registers a cleanup that restores the previous value. Because environment variables are process-global, parallel tests cannot share them safely. The Go team handled this by making `t.Setenv` *incompatible* with `t.Parallel`:

```go
func TestEnv(t *testing.T) {
    t.Parallel()
    t.Setenv("FOO", "bar")
    // PANIC: testing: t.Setenv called after t.Parallel
}
```

The reverse order also panics:

```go
func TestEnv(t *testing.T) {
    t.Setenv("FOO", "bar")
    t.Parallel()
    // PANIC: testing: t.Parallel called after t.Setenv
}
```

The rule is transitive through subtests: if an ancestor called `t.Setenv`, no descendant can call `t.Parallel`.

So how do you test code that reads env vars without serialising the whole suite? Two patterns:

**Pattern A: thread the config through.** Make the production code read its config from a struct or a constructor argument, not from `os.Getenv`. Then the test passes a value instead of setting an env var. This is the better design 90% of the time.

**Pattern B: serialise just the env-dependent tests.** Put them in a single top-level test with subtests (no `t.Parallel`), or put them in a separate test file under a build tag. The rest of the suite remains parallel.

```go
func TestEnvBased(t *testing.T) {
    // intentionally NOT parallel; uses t.Setenv
    t.Setenv("DB_HOST", "127.0.0.1")
    cfg := loadConfig()
    if cfg.DBHost != "127.0.0.1" {
        t.Fatalf("got %q", cfg.DBHost)
    }
}
```

The `t.Setenv` cleanup will restore the original value before the next test runs, so sibling tests (parallel or not) are not affected — they just have to wait until this one finishes.

## 5. `t.Chdir` (Go 1.24+)

Go 1.24 added `t.Chdir`, the working-directory equivalent of `t.Setenv`. It calls `os.Chdir` and registers a cleanup. Like `t.Setenv`, it forbids being called from a parallel test or one with a parallel ancestor:

```go
func TestRelativePath(t *testing.T) {
    t.Chdir(t.TempDir())
    // any os.ReadFile("foo.txt") here uses the new working dir
}
```

Before 1.24, the only safe pattern was to never call `os.Chdir` from tests — use absolute paths with `filepath.Join`. That's still the best practice in libraries that need to support older Go.

## 6. `t.TempDir` as a parallel-friendly isolation primitive

`t.TempDir` is the most-used isolation tool in serious Go test suites. Each call creates a fresh directory under `os.TempDir()`, registers cleanup, and returns the path.

```go
func TestArchive(t *testing.T) {
    t.Parallel()
    dir := t.TempDir()

    // Build a tar file in dir/out.tar:
    out := filepath.Join(dir, "out.tar")
    if err := writeTar(out, files); err != nil {
        t.Fatal(err)
    }

    // Inspect it:
    info, err := os.Stat(out)
    if err != nil {
        t.Fatal(err)
    }
    if info.Size() == 0 {
        t.Errorf("empty archive")
    }
}
```

Run a hundred of these in parallel; they don't collide. The directory names embed the test name, a counter, and a random suffix, so debugging when something goes wrong is also easier.

A common pattern is to put helpers that build the test fixtures into the directory:

```go
func setupRepo(t *testing.T) string {
    t.Helper()
    dir := t.TempDir()
    must(t, os.WriteFile(filepath.Join(dir, "README.md"), []byte("hi"), 0o644))
    must(t, os.MkdirAll(filepath.Join(dir, "src"), 0o755))
    must(t, os.WriteFile(filepath.Join(dir, "src", "main.go"), []byte("package main"), 0o644))
    return dir
}

func must(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatal(err)
    }
}
```

Now every parallel test that calls `setupRepo(t)` gets its own isolated workspace.

## 7. Port assignment

Tests that listen on a TCP port need to avoid colliding with each other. The wrong way:

```go
ln, _ := net.Listen("tcp", ":8080") // collides with siblings
```

The right way:

```go
ln, err := net.Listen("tcp", "127.0.0.1:0") // OS picks a free port
if err != nil {
    t.Fatal(err)
}
addr := ln.Addr().String()
t.Cleanup(func() { ln.Close() })
```

Or use `httptest`, which does this internally:

```go
srv := httptest.NewServer(handler)
t.Cleanup(srv.Close)
```

`httptest.NewServer` listens on `127.0.0.1:0` and exposes the URL. Each parallel test gets its own port — no collision.

## 8. Shared external resources: pools

When parallel tests share a *limited* external resource — a Postgres database, a Redis instance, a Kafka broker — you need a budget. Pool the resource via a buffered channel.

```go
var dbPool chan *sql.DB

func TestMain(m *testing.M) {
    dbPool = make(chan *sql.DB, 8)
    for i := 0; i < 8; i++ {
        db, err := openDB() // each acquires a connection
        if err != nil {
            log.Fatalf("openDB: %v", err)
        }
        dbPool <- db
    }
    code := m.Run()
    close(dbPool)
    for db := range dbPool {
        db.Close()
    }
    os.Exit(code)
}

func acquireDB(t *testing.T) *sql.DB {
    t.Helper()
    db := <-dbPool
    t.Cleanup(func() {
        truncateAll(t, db)
        dbPool <- db
    })
    return db
}

func TestUserService(t *testing.T) {
    t.Parallel()
    db := acquireDB(t)
    // use db; on test return it's truncated and returned to the pool.
}
```

The buffered channel size is your budget. Tests beyond the budget block until a peer releases its connection. The `t.Cleanup` returns the connection — safer than `defer`, because `t.FailNow` from inside the test still triggers cleanup.

## 9. The race detector in serious use

`-race` is mandatory CI hygiene for any package with `t.Parallel`. Three operational details matter:

**Memory cost.** A `-race` binary holds shadow memory for every byte of regular memory. A test suite that allocates 1 GB regular uses ~10 GB under `-race`. CI machines with 8 GB cannot run such a suite at `-parallel 16`; cap `-parallel` lower under `-race`.

**Time cost.** Expect 5–10x slowdown for CPU-heavy tests; 2–4x for I/O-heavy. Plan CI minutes accordingly.

**Scheduling shifts.** The race detector instruments allocation and access, which subtly changes goroutine scheduling. A bug that manifests in production may not under `-race`, and vice versa. The detector is necessary but not sufficient for thread safety.

A typical CI configuration:

```yaml
jobs:
  test:
    run: go test -parallel 16 -count=1 ./...
  race:
    run: go test -race -parallel 8 -count=1 ./...
```

Two jobs, both required to pass. The `-race` job uses lower `-parallel` to stay within memory.

## 10. Goroutine leak detection

A test that spawns a goroutine and forgets to stop it leaks. Over thousands of runs, the heap fills with orphans. `go.uber.org/goleak` checks for leaked goroutines at process exit (and optionally per-test):

```go
package mypkg_test

import (
    "testing"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

If any goroutine other than the runtime's own background workers is alive at exit, the test process fails with a stack trace.

Per-test detection:

```go
func TestLeak(t *testing.T) {
    t.Parallel()
    defer goleak.VerifyNone(t)
    // test code
}
```

Combine with `t.Cleanup`:

```go
func TestLeak(t *testing.T) {
    t.Parallel()
    t.Cleanup(func() { goleak.VerifyNone(t) })
    // test code
}
```

Goleak is especially useful for tests that exercise async code paths — pub/sub, HTTP keep-alive, background workers.

## 11. `TestMain` and parallel tests

`TestMain` is the package-level entry point. When defined, `go test` calls `TestMain(m *testing.M)` instead of running tests directly. It must call `m.Run()`, which returns an exit code.

```go
func TestMain(m *testing.M) {
    if err := setup(); err != nil {
        log.Fatal(err)
    }
    code := m.Run()
    teardown()
    os.Exit(code)
}
```

`m.Run` runs *all* tests, serial and parallel. It does not return until everything (including parallel tests and their cleanups) is done. So:

- `setup()` runs once before any test.
- `teardown()` runs once after all tests, including parallel ones.

This is the right place for package-wide resources (DB pool, shared HTTP client, expensive fixture). Do not call `os.Exit(0)` directly; you'd skip the cleanups and leak resources.

A subtle point: if `setup` initialises a package-level `var` that parallel tests read, the writes happen-before all test starts (because `m.Run` happens after `TestMain`'s body). Reads from parallel tests are safe as long as nobody writes after `m.Run` starts.

## 12. Combining `t.Parallel` with `t.Cleanup` for fixtures

A fixture function builds a test resource and registers cleanup. It must be safe to call from parallel tests:

```go
func newServer(t *testing.T) *httptest.Server {
    t.Helper()
    srv := httptest.NewServer(http.HandlerFunc(handle))
    t.Cleanup(srv.Close)
    return srv
}

func TestAPI(t *testing.T) {
    t.Parallel()
    srv := newServer(t)
    resp, err := http.Get(srv.URL + "/health")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK {
        t.Errorf("got %d", resp.StatusCode)
    }
}
```

Each parallel test that calls `newServer(t)` gets a fresh server on its own port. Cleanup ensures the listener doesn't leak.

The `t.Helper()` call marks `newServer` as a helper, so failure-line reporting points to the caller, not inside `newServer`.

## 13. Subtest hierarchy and `t.Parallel`

Subtests inherit the parallel hierarchy:

- A parallel subtest's parent does not need to call `t.Parallel`.
- A serial parent with parallel children is the most common pattern (table-driven tests).
- A parallel parent with parallel children is allowed and useful when the parent itself does serial setup before fanning out.

```go
func TestService(t *testing.T) {
    t.Parallel()
    svc := newService(t) // serial setup inside this test's goroutine

    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            run(t, svc, tc)
        })
    }
}
```

`TestService` runs in parallel with *other top-level tests*. Inside, it constructs `svc` serially. The subtests run in parallel with each other and share `svc` — which must be thread-safe for reads (most production services are).

## 14. Detecting tests that are accidentally serial

A subtle source of slow suites: a test that *should* be parallel but isn't, because someone forgot `t.Parallel`. A quick audit:

```bash
grep -L "t.Parallel" *_test.go
```

Lists files where `t.Parallel` does not appear. Inspect each manually; not every test should be parallel, but the list catches forgotten ones.

A more robust tool is a custom `go/analysis` pass:

```go
// Pseudo-code for a linter
for _, fn := range testFunctions {
    if !callsParallel(fn) && !hasNoParallelMarker(fn.Doc) {
        report(fn, "missing t.Parallel()")
    }
}
```

`golangci-lint` has a `paralleltest` linter that does this and more (catches loop-var capture, missing `tc := tc` on older Go).

## 15. `t.Context()` (Go 1.24+) and parallel tests

Go 1.24 added `t.Context()`, returning a `context.Context` that is cancelled when the test (or its parent) ends. Combined with parallel tests, this is the idiomatic way to wire deadlines and cancellation:

```go
func TestRPC(t *testing.T) {
    t.Parallel()
    ctx := t.Context()
    resp, err := client.Call(ctx, &req)
    if err != nil {
        t.Fatal(err)
    }
    _ = resp
}
```

If the test times out (via `-timeout`), `ctx` is cancelled, and `client.Call` returns promptly with `ctx.Err()`. No more "test hangs forever" because someone forgot a deadline.

On Go ≤1.23, the manual equivalent is:

```go
ctx, cancel := context.WithCancel(context.Background())
t.Cleanup(cancel)
```

## 16. Race conditions across parallel subtests

The most common scenario: package-level state shared between parallel subtests of a single `TestXxx`.

```go
var registry = map[string]int{}

func TestRegister(t *testing.T) {
    for _, name := range []string{"a", "b", "c"} {
        name := name
        t.Run(name, func(t *testing.T) {
            t.Parallel()
            registry[name] = len(name) // unsynchronised write
        })
    }
}
```

`-race` reports it: `WARNING: DATA RACE`. The fixes:

1. Make `registry` thread-safe (`sync.Map`, mutex).
2. Scope `registry` to the test function (no longer package-level).
3. Remove the parallelism if the test really must mutate package state.

Option 2 is usually cleanest. Production code that genuinely needs a shared registry should expose a constructor: `r := newRegistry()` so tests can build a fresh one per test.

## 17. Putting it together: a robust parallel test

The shape of a well-designed parallel test in a serious Go project:

```go
func TestSomething(t *testing.T) {
    t.Parallel()

    // Build per-test fixtures using helpers that register cleanup.
    db := acquireDB(t)         // pooled
    srv := newServer(t)        // per-test port
    dir := t.TempDir()         // per-test workspace
    ctx := t.Context()         // cancelled on test end

    // Run the assertion.
    got, err := doWork(ctx, db, srv.URL, dir)
    if err != nil {
        t.Fatalf("doWork: %v", err)
    }
    if got != "expected" {
        t.Errorf("got %q, want %q", got, "expected")
    }
}
```

Five lines of setup, every one of them parallel-safe. No `defer`, no `os.Setenv`, no `os.Chdir`. The test reads top-to-bottom, each helper handles cleanup automatically, and `-race` keeps the whole pattern honest.

## 18. Summary

- `-p` and `-parallel` compose; tune them to workload type.
- Wrap fan-out parallel subtests in another `t.Run` to get a synchronisation point.
- `t.Cleanup` is LIFO and runs after subtests; prefer it to `defer`.
- `t.Setenv` and `t.Chdir` panic in parallel tests by design; thread config through structs instead.
- `t.TempDir` is the universal file-system isolation primitive.
- Use `httptest.NewServer` and `127.0.0.1:0` to avoid port collisions.
- Pool scarce external resources with a buffered channel; cleanup returns them.
- `-race` is mandatory; budget memory accordingly.
- Goleak catches goroutine leaks at process exit.
- `TestMain` runs setup/teardown around `m.Run`, which includes parallel tests.

## 19. Patterns for HTTP testing in parallel

`net/http/httptest` makes parallel HTTP testing straightforward. The standard pattern:

```go
func newAPIServer(t *testing.T) *httptest.Server {
    t.Helper()
    mux := http.NewServeMux()
    mux.HandleFunc("/users", usersHandler)
    mux.HandleFunc("/items", itemsHandler)
    srv := httptest.NewServer(mux)
    t.Cleanup(srv.Close)
    return srv
}

func TestUsersAPI(t *testing.T) {
    t.Parallel()
    srv := newAPIServer(t)
    client := srv.Client() // gets a properly-configured *http.Client
    resp, err := client.Get(srv.URL + "/users")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        t.Errorf("got %d", resp.StatusCode)
    }
}
```

Each parallel test gets its own server on its own port; the cleanup closes the listener. Server.Client() returns a properly-configured `*http.Client` with the right TLS settings if the server uses TLS.

For TLS-enabled testing, use `httptest.NewTLSServer` instead. Same parallel semantics; same cleanup pattern.

## 20. Sub-pattern: per-test handler instances

If your handler holds per-request state (a counter, a flag for "ran"), each parallel test should get its own:

```go
func newCountingServer(t *testing.T) (*httptest.Server, *atomic.Int64) {
    t.Helper()
    var count atomic.Int64
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        count.Add(1)
        w.WriteHeader(200)
    }))
    t.Cleanup(srv.Close)
    return srv, &count
}

func TestRequestCount(t *testing.T) {
    t.Parallel()
    srv, count := newCountingServer(t)
    for i := 0; i < 3; i++ {
        http.Get(srv.URL)
    }
    if got := count.Load(); got != 3 {
        t.Errorf("got %d, want 3", got)
    }
}
```

Each parallel test sees its own server *and* its own counter. No sharing.

## 21. Parallel testing with mocks

When the production code depends on an interface, the test injects a mock. Parallel tests need each their own mock instance:

```go
type Storage interface {
    Save(string, []byte) error
    Load(string) ([]byte, error)
}

type memStore struct {
    data map[string][]byte
    mu   sync.Mutex
}

func newMemStore() *memStore {
    return &memStore{data: make(map[string][]byte)}
}

func (m *memStore) Save(k string, v []byte) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.data[k] = v
    return nil
}

func (m *memStore) Load(k string) ([]byte, error) {
    m.mu.Lock()
    defer m.mu.Unlock()
    return m.data[k], nil
}

func TestService(t *testing.T) {
    t.Parallel()
    store := newMemStore()
    svc := NewService(store)
    svc.Save("k", []byte("v"))
    if got, _ := svc.Load("k"); string(got) != "v" {
        t.Error("wrong value")
    }
}
```

Each parallel test calls `newMemStore()` and gets a fresh map. Even though the mock has a mutex (because production code may call it from multiple goroutines), there's no inter-test sharing.

## 22. Test code organization

For a package with many parallel tests, consider this structure:

```
mypkg/
├── core.go
├── core_test.go         // tests for core.go's API
├── helpers_test.go      // fixture helpers (newFooFixture, openTestDB, etc.)
└── main_test.go         // TestMain with shared setup
```

`helpers_test.go` is compiled only with tests (because of the `_test.go` suffix). It can contain helpers that other test files import via the package-internal namespace.

`main_test.go` houses `TestMain` and any package-level test fixtures (pools, shared services).

## 23. Shared `TestMain` across packages

If multiple packages need similar setup, hoist into a shared internal `testutil` package:

```go
// internal/testutil/main.go
package testutil

import (
    "go.uber.org/goleak"
)

func MainWithLeakCheck(m TestingM) int {
    code := m.Run()
    if err := goleak.Find(); err != nil {
        log.Printf("leak: %v", err)
    }
    return code
}
```

Each package's `TestMain` then calls into the shared helper. DRY and consistent.

## 24. Combining `t.Parallel` with `sync.WaitGroup`

When a test launches goroutines and needs them to finish before assertion, use `sync.WaitGroup`:

```go
func TestFanOut(t *testing.T) {
    t.Parallel()
    var wg sync.WaitGroup
    results := make([]int, 5)
    for i := 0; i < 5; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = compute(i)
        }()
    }
    wg.Wait()
    // Now safe to inspect `results`.
    for i, got := range results {
        if got != i*i {
            t.Errorf("results[%d] = %d, want %d", i, got, i*i)
        }
    }
}
```

The WaitGroup orchestrates within one test; `t.Parallel` orchestrates between tests. They compose without interference.

## 25. `errgroup` for parallel sub-operations within a test

`golang.org/x/sync/errgroup` is the canonical way to run multiple goroutines and collect the first error:

```go
import "golang.org/x/sync/errgroup"

func TestParallelFetches(t *testing.T) {
    t.Parallel()
    urls := []string{"/a", "/b", "/c"}
    var eg errgroup.Group
    results := make([][]byte, len(urls))
    for i, u := range urls {
        i, u := i, u
        eg.Go(func() error {
            data, err := fetch(u)
            results[i] = data
            return err
        })
    }
    if err := eg.Wait(); err != nil {
        t.Fatal(err)
    }
    // Inspect results...
}
```

The test itself is parallel-marked; inside, three sub-operations run concurrently. The combined wall-time is the slowest sub-operation, not the sum.

## 26. The cost of `t.Parallel` for fast tests

Parallel scheduling has overhead: a channel send/receive, a goroutine swap, log buffering. For tests that run in microseconds, this overhead can exceed the test's actual work, and the parallel version is *slower* than the serial one.

In practice:

- Tests under 100 microseconds: parallelism is usually a wash.
- Tests 100 µs to 1 ms: small speedup.
- Tests over 1 ms: meaningful speedup.

Don't optimise micro-tests by making them parallel. Optimise them by making them micro-tests in the first place — the rest of the suite gains more from the cores being free for slower tests.

## 27. The lifecycle of a parallel test

A parallel test passes through several states in the framework's internal state machine:

1. **Created**: `(*T).Run` invoked the closure, but no goroutine yet.
2. **Running serially**: goroutine started; running serial work.
3. **Paused**: `t.Parallel()` called; goroutine parked.
4. **Running in parallel**: framework woke the goroutine; running concurrently with siblings.
5. **Finished**: test function returned.
6. **Cleanup**: cleanup callbacks run on the test's goroutine.
7. **Reported**: PASS/FAIL/SKIP printed.

A test in state 3 holds a slot in the parallel queue but no slot in the "running" budget. A test in state 4 holds a "running" slot, counted toward `-parallel`.

## 28. Parallel test failure isolation

A failing parallel test does not stop sibling tests. Each test is independent:

```go
func TestA(t *testing.T) { t.Parallel(); t.Errorf("A failed") }
func TestB(t *testing.T) { t.Parallel(); /* passes */ }
```

Result: TestA fails, TestB passes, the binary's exit code reflects the failure but TestB ran to completion.

This is different from `log.Fatal`, which kills the process. `t.Errorf`, `t.Fatalf`, `t.Fail` all only affect their own test.

## 29. Cleanup callbacks and panics

If a `t.Cleanup` callback panics, the framework recovers it, marks the test as failed, and continues with the next cleanup. The other tests are unaffected.

```go
t.Cleanup(func() { panic("oops") })
```

This pattern is occasionally useful for "this resource must always be cleaned up" guarantees, but it's better to handle errors explicitly than rely on panic recovery.

## 30. `httptest.NewServer` cleanup race

A subtle bug: if a test starts an HTTP request to `httptest.Server` and then the cleanup closes the server before the request completes, the request fails with a connection error. The fix is to wait for in-flight requests before closing:

```go
srv := httptest.NewServer(handler)
t.Cleanup(func() {
    // Cleanup runs after the test body. If the test left goroutines
    // mid-request, they're now racing with srv.Close.
    srv.Close() // typically OK; Close waits for active connections
})
```

`httptest.Server.Close()` blocks until all active HTTP requests complete, so it's safe in most scenarios. The race shows up only with raw TCP listeners or custom protocols.

## 31. Working with goroutine groups in parallel tests

For tests that spawn many goroutines and need them all to finish:

```go
func TestWorkers(t *testing.T) {
    t.Parallel()
    ctx, cancel := context.WithCancel(context.Background())
    t.Cleanup(cancel)

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            doWork(ctx, i)
        }()
    }
    // Test logic that may cancel ctx early...
    wg.Wait()
}
```

The cancel-via-context pattern ensures workers exit even if the test fails mid-way. `wg.Wait()` ensures the test doesn't return until all workers are done. `t.Cleanup(cancel)` is a belt-and-suspenders for any path that bypasses `wg.Wait()`.

## 32. `t.Setenv` with non-parallel subtests

If a parent test doesn't call `t.Parallel`, but some subtests do, the rule applies per-subtest:

```go
func TestThing(t *testing.T) {
    t.Setenv("MODE", "test") // OK; parent is serial
    t.Run("a", func(t *testing.T) {
        // OK to use the env var
        if os.Getenv("MODE") != "test" {
            t.Fatal("env not set")
        }
    })
    t.Run("b", func(t *testing.T) {
        // PANIC: parent called t.Setenv, child can't be parallel.
        t.Parallel()
    })
}
```

The restriction is transitive. Once any ancestor calls `t.Setenv`, no descendant can be parallel.

## 33. Reading test output deterministically

In a parallel test, log lines from different tests don't interleave (Go buffers them). But the order of *tests* finishing is non-deterministic. To debug a test you must rely on the test's own log block, not the relative order of multiple tests.

If you must compare against expected output, capture inside the test and assert:

```go
func TestSomething(t *testing.T) {
    t.Parallel()
    var buf bytes.Buffer
    log.SetOutput(&buf) // CAREFUL: not parallel-safe!
    // ...
}
```

This is wrong: `log.SetOutput` modifies the global logger, racing with sibling tests. Use a per-test logger instead:

```go
logger := log.New(&buf, "", 0)
runWithLogger(logger)
```

## 34. Database transaction-per-test pattern

A common pattern for parallel DB tests: each test wraps its work in a transaction and rolls back at the end. This way, the schema is shared but the test sees its own isolated changes.

```go
func withTx(t *testing.T, db *sql.DB, fn func(*sql.Tx)) {
    t.Helper()
    tx, err := db.Begin()
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { tx.Rollback() })
    fn(tx)
}

func TestUserCRUD(t *testing.T) {
    t.Parallel()
    withTx(t, sharedDB, func(tx *sql.Tx) {
        // Insert, update, query — all in the transaction.
        // Rollback at cleanup removes all changes.
    })
}
```

Caveat: the transaction-per-test pattern only works if the production code accepts a `*sql.Tx` (or a wrapper interface). If it always opens its own transaction, this pattern doesn't apply.

Another caveat: certain Postgres operations (e.g., `pg_advisory_lock`, sequences) behave specially inside transactions, which can mask production bugs.

## 35. Race vs no-race performance comparison

For a representative package on a 16-core machine:

| Mode | Wall time | RAM peak |
|------|-----------|----------|
| Serial | 12.5s | 80 MB |
| Parallel | 1.8s | 90 MB |
| Parallel + `-race` | 11.2s | 700 MB |
| Serial + `-race` | 65s | 720 MB |

Observations:

- Parallel is ~7x faster than serial.
- `-race` is ~6x slower than non-race for parallel, ~5x slower for serial.
- `-race` parallel is roughly the same speed as serial non-race. This is why teams run both: a fast non-race suite and a slower race suite.
- RAM grows ~9x under `-race`.

These numbers are approximate but typical. Measure on your own suite to budget CI resources.

## 36. Common questions at middle level

**Q: Should I refactor to use `t.Cleanup` everywhere?**

Yes. It's cleaner, safer, and the de facto idiom in modern Go test code. `defer` still works but is less robust.

**Q: How do I know if `t.Parallel` is too aggressive?**

Run `-race -count=10` overnight. If you see races, you have shared state to fix. If memory grows, you have leaks. If wall time stays the same after adding `t.Parallel`, your tests are CPU-bound and you've hit `GOMAXPROCS`.

**Q: My CI is on 2 cores. Is `t.Parallel` worth it?**

For I/O-bound tests, yes. For CPU-bound, modest gains (1.5–2x). Worth the small investment of adding the calls.

**Q: How do I parallelise tests that share a single Postgres database?**

Either namespace per test (each gets its own schema) or pool connections (limit concurrent tests). Both are described in the senior page.

## 37. Middle summary

- Compose `-p` and `-parallel` for full-suite throughput.
- Wrap parallel subtests in `t.Run("group", ...)` for synchronisation points.
- `t.Setenv` and `t.Chdir` are anti-parallel by design; refactor to remove process-global dependence.
- `t.TempDir` is universal file-system isolation.
- `httptest` handles ports automatically.
- Pool scarce resources with buffered channels.
- `-race` is mandatory; budget memory.
- `goleak` catches leaks early.
- The transaction-per-test pattern keeps DB schemas shared but data isolated.

The senior page covers full-suite design — including layered fixtures, integration boundaries, and how to migrate a legacy serial suite to parallel-by-default without breaking it.

## 38. A complete middle-level worked example

To consolidate, here's a complete `_test.go` file for a hypothetical user-management package. It uses every pattern from this page: parallel tests, helpers with `t.Cleanup`, pooled fixtures, table-driven subtests, group synchronisation, and goroutine leak detection.

```go
package users

import (
    "context"
    "database/sql"
    "fmt"
    "net/http"
    "net/http/httptest"
    "sync"
    "testing"
    "time"

    _ "github.com/lib/pq"
    "go.uber.org/goleak"
)

var (
    dbPool chan *sql.DB
    apiSrv *httptest.Server
)

func TestMain(m *testing.M) {
    // Pool 8 DB connections.
    dbPool = make(chan *sql.DB, 8)
    for i := 0; i < 8; i++ {
        db, err := sql.Open("postgres", "postgresql://localhost/test")
        if err != nil {
            panic(err)
        }
        dbPool <- db
    }
    // One shared API server.
    apiSrv = httptest.NewServer(http.HandlerFunc(handler))
    code := m.Run()
    apiSrv.Close()
    close(dbPool)
    for db := range dbPool {
        db.Close()
    }
    goleak.VerifyTestMain(m)
    _ = code
}

func acquireDB(t *testing.T) *sql.DB {
    t.Helper()
    db := <-dbPool
    t.Cleanup(func() {
        // truncate test data
        db.Exec("DELETE FROM users")
        dbPool <- db
    })
    return db
}

func TestCreateUser(t *testing.T) {
    t.Parallel()
    cases := []struct {
        name string
        in   User
        want error
    }{
        {"valid", User{Name: "Alice", Age: 30}, nil},
        {"empty name", User{Age: 30}, ErrEmptyName},
        {"negative age", User{Name: "Bob", Age: -1}, ErrInvalidAge},
    }
    t.Run("cases", func(t *testing.T) {
        for _, tc := range cases {
            t.Run(tc.name, func(t *testing.T) {
                t.Parallel()
                db := acquireDB(t)
                err := CreateUser(db, tc.in)
                if err != tc.want {
                    t.Errorf("got %v, want %v", err, tc.want)
                }
            })
        }
    })
    // After the "cases" t.Run, all parallel children are done.
}

func TestAPIHealth(t *testing.T) {
    t.Parallel()
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    req, _ := http.NewRequestWithContext(ctx, "GET", apiSrv.URL+"/health", nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        t.Errorf("got status %d", resp.StatusCode)
    }
}

func TestConcurrentUpdate(t *testing.T) {
    t.Parallel()
    db := acquireDB(t)
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            _, _ = db.Exec("INSERT INTO users VALUES($1, $2)", fmt.Sprintf("user-%d", i), 30)
        }()
    }
    wg.Wait()
    // Assert eventually consistent state...
}
```

Read through it:

- `TestMain` sets up a pool and a shared API server.
- `acquireDB` is a parallel-safe helper.
- `TestCreateUser` is a table-driven test with grouped parallel subtests.
- `TestAPIHealth` is a simple parallel HTTP test using a context.
- `TestConcurrentUpdate` exercises concurrent writes from within one test.

Every pattern works together. This is the shape of a middle-grade Go test file.

## 39. The `goleak` API in practical use

`goleak.VerifyTestMain(m)` runs once after `m.Run()` exits. It compares the goroutines alive at exit to a baseline taken before `m.Run`. Any goroutine not in the baseline (and not in the ignore list) triggers a failure.

```go
package mypkg_test

import (
    "testing"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        goleak.IgnoreTopFunction("github.com/some/lib.backgroundFlusher"),
        goleak.IgnoreTopFunction("net/http.(*persistConn).readLoop"),
    )
}
```

The ignores are usually for:

- Background workers spawned by third-party libraries on init.
- HTTP keep-alive goroutines (`persistConn`).
- Metric flushers, log shippers, etc.

Each ignore should be a deliberate decision, documented in a comment. The list becomes the team's vocabulary for "intentionally long-lived goroutines".

For finer-grained detection, use `goleak.VerifyNone(t)` in a `t.Cleanup`:

```go
func TestThing(t *testing.T) {
    t.Parallel()
    t.Cleanup(func() { goleak.VerifyNone(t) })
    // ...
}
```

This catches leaks per-test, attributing them to the exact test that introduced them. The downside: slower (each cleanup snapshots goroutines), and false positives if the test legitimately leaves a goroutine running for `t.Cleanup` to consume.

## 40. The `paralleltest` linter

`golangci-lint` ships with a `paralleltest` linter that checks:

1. Every top-level `TestXxx` calls `t.Parallel`.
2. Every `t.Run` subtest calls `t.Parallel` (configurable).
3. Loop variables in `t.Run` are shadowed for pre-1.22 safety.

Enable in `.golangci.yml`:

```yaml
linters:
  enable:
    - paralleltest
linters-settings:
  paralleltest:
    ignore-missing: false        # require t.Parallel
    ignore-missing-subtests: false
```

For tests that genuinely shouldn't be parallel, suppress with a comment:

```go
//nolint:paralleltest // uses t.Setenv intentionally
func TestEnvBased(t *testing.T) {
    t.Setenv("KEY", "value")
    // ...
}
```

The linter is a forcing function: a PR introducing a new test without `t.Parallel` fails CI. The author learns the norm immediately.

## 41. Channel-based synchronisation in tests

For testing async code, channels are the canonical synchronisation primitive:

```go
func TestEvent(t *testing.T) {
    t.Parallel()
    bus := newBus()
    received := make(chan Event, 1)
    bus.Subscribe(func(e Event) { received <- e })
    bus.Publish(Event{ID: 1})
    select {
    case e := <-received:
        if e.ID != 1 {
            t.Errorf("got ID %d", e.ID)
        }
    case <-time.After(time.Second):
        t.Fatal("timed out")
    }
}
```

The buffered `received` channel ensures `Publish` doesn't block if the test isn't ready. The `select` with timeout ensures the test fails cleanly if the event never arrives.

Far better than:

```go
bus.Publish(Event{ID: 1})
time.Sleep(100 * time.Millisecond) // hope it's delivered
if !delivered { t.Fail() }
```

## 42. Cancellation: `t.Context()` and `context.WithCancel`

Go 1.24's `t.Context()` returns a context that cancels at test end. Use it as the root for any time-bounded work in the test:

```go
func TestRPC(t *testing.T) {
    t.Parallel()
    ctx := t.Context()
    resp, err := client.Call(ctx, &req)
    // ...
}
```

If the test times out (`-timeout`), `ctx` cancels, and `client.Call` returns promptly with `ctx.Err()`. No hangs.

Pre-1.24:

```go
ctx, cancel := context.WithCancel(context.Background())
t.Cleanup(cancel)
```

Either way, every blocking call in a test should accept a context. If production code doesn't accept contexts, that's another design pressure.

## 43. The `-timeout` flag

`go test -timeout 30s ./...` aborts the test binary if it runs longer than 30 seconds. The default is 10 minutes.

In a parallel suite, `-timeout` applies to the entire binary, not per test. If 50 parallel tests each take 5 seconds, the binary takes ~5 seconds wall-time, well under the timeout.

If a single test hangs, the entire binary hangs until `-timeout` fires. The framework then prints all goroutine stacks before exiting, which is invaluable for diagnosing the hang.

A common pattern:

```go
func TestThing(t *testing.T) {
    t.Parallel()
    ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
    defer cancel()
    // ... use ctx
}
```

Per-test deadlines short-circuit before the binary-wide `-timeout`. Better attribution; better diagnostics.

## 44. Per-test directory naming in `t.TempDir`

`t.TempDir` builds the path as:

```
{os.TempDir()}/{TestNameSanitized}{RandomSuffix}
```

For nested subtests, the test name includes the parent: `TestX/sub1`. The path becomes `/tmp/TestX_sub1...`. Two parallel subtests with the same name (impossible in practice, but) would get different random suffixes, so paths still differ.

The path is reasonably readable for debugging:

```
=== RUN TestXxx/case_1
--- FAIL: TestXxx/case_1
    ... tempdir was /tmp/TestXxx_case_11234567/001
```

You can `ls /tmp` and inspect (until the cleanup runs).

For long-running CI debugging, set `TMPDIR` to a persistent location and disable the cleanup with `-cleanup=false` (but the latter requires a custom test runner; standard `go test` always cleans up).

## 45. Helper-driven test design

A widespread pattern: every fixture is created by a helper that returns a value and registers cleanup. The test code becomes a sequence of helper calls plus assertions:

```go
func TestUserService(t *testing.T) {
    t.Parallel()
    cfg := newTestConfig(t)
    db := newTestDB(t)
    svc := NewUserService(cfg, db)
    // assertion code
}
```

`newTestConfig` and `newTestDB`:

```go
func newTestConfig(t *testing.T) *Config {
    t.Helper()
    return &Config{Port: 0, LogLevel: "debug"}
}

func newTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db := acquireFromPool(t)
    seed(t, db)
    return db
}
```

The test author doesn't know or care that `newTestDB` uses a pool, registers cleanup, and seeds data. They just want a DB. The helper handles the rest.

This is the discipline that scales to 5000-test suites without going insane.

## 46. Tracing parallel execution

For debugging a hard-to-reproduce parallel test bug, add tracing:

```go
import "runtime/trace"

func TestThing(t *testing.T) {
    t.Parallel()
    if os.Getenv("TRACE") != "" {
        f, _ := os.Create("trace.out")
        trace.Start(f)
        defer trace.Stop()
    }
    // ... test body
}
```

Run with `TRACE=1 go test -run TestThing`, then `go tool trace trace.out`. The browser-based tool shows every goroutine, every channel, every block. Invaluable for understanding why a parallel test gets stuck.

For more targeted tracing, use `trace.Log` and `trace.WithRegion`:

```go
trace.Log(ctx, "phase", "setup")
// ...
trace.Log(ctx, "phase", "assertion")
```

The trace UI then highlights each phase.

## 47. The Postgres connection pool pattern

A reference implementation for a 16-connection Postgres pool shared across parallel tests:

```go
package testdb

import (
    "context"
    "database/sql"
    "fmt"
    "math/rand"
    "sync"
    "testing"
)

var (
    poolOnce sync.Once
    pool     chan *sql.DB
    schemaSQL = `CREATE TABLE IF NOT EXISTS users (...);`
)

func initPool() {
    pool = make(chan *sql.DB, 16)
    for i := 0; i < 16; i++ {
        db, err := sql.Open("postgres", "postgresql://localhost/testdb")
        if err != nil {
            panic(err)
        }
        if _, err := db.Exec(schemaSQL); err != nil {
            panic(err)
        }
        pool <- db
    }
}

func Acquire(t *testing.T) *sql.DB {
    t.Helper()
    poolOnce.Do(initPool)
    select {
    case db := <-pool:
        t.Cleanup(func() {
            // Truncate test data before returning to pool.
            db.Exec("TRUNCATE TABLE users")
            pool <- db
        })
        return db
    case <-t.Context().Done():
        t.Fatal("timed out waiting for DB connection")
        return nil
    }
}
```

Usage from a test:

```go
func TestUserCRUD(t *testing.T) {
    t.Parallel()
    db := testdb.Acquire(t)
    // use db; on cleanup, it's truncated and returned.
}
```

Properties:

- `poolOnce` ensures one-time initialization across all parallel tests.
- The `select` with `t.Context().Done()` prevents indefinite hangs.
- Cleanup truncates data, ensuring siblings see an empty table.
- The pool size (16) is the explicit budget.

The senior page covers full-suite design — including layered fixtures, integration boundaries, and how to migrate a legacy serial suite to parallel-by-default without breaking it.
