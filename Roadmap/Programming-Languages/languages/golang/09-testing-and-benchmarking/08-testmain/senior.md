---
layout: default
title: TestMain — Senior
parent: TestMain Function
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/08-testmain/senior/
---

# TestMain — Senior

[← Back](../)

The middle page covered the daily mechanics. Senior-level `TestMain` work is about owning the test process: deciding how a binary boots, how it tears down, how it cooperates with CI, how it survives panics, how it exposes hooks for shared infrastructure, how it interacts with coverage and tracing. By the end of this page you should be comfortable writing a `TestMain` for a complex integration package, refactoring duplicated `TestMain` boilerplate across a monorepo, and reasoning about edge cases that surface only at scale.

## Mental model of the test binary

The Go tool generates a `main` function for the test binary that looks roughly like (taken from real `_testmain.go` output of `go test -c -work`):

```go
// generated, do not edit
package main

import (
    "os"
    "testing"
    "testing/internal/testdeps"

    _testpkg "example.com/userstore"
)

var tests = []testing.InternalTest{
    {"TestSomething", _testpkg.TestSomething},
    // ...
}
var benchmarks = []testing.InternalBenchmark{...}
var examples   = []testing.InternalExample{...}
var fuzzTargets = []testing.InternalFuzzTarget{...}

func main() {
    m := testing.MainStart(testdeps.TestDeps{}, tests, benchmarks, fuzzTargets, examples)
    _testpkg.TestMain(m) // <-- your TestMain
}
```

If you do **not** define `TestMain`, the generated code is:

```go
func main() {
    m := testing.MainStart(...)
    os.Exit(m.Run())
}
```

So your `TestMain` substitutes for the trivial `os.Exit(m.Run())` line in the generated `main`. You take over the lifecycle. The generated `MainStart` produces the `*testing.M` you receive, with all internal registries already populated. Calling `m.Run()` walks those registries.

Two implications:

1. By the time `TestMain` runs, the lists of tests/benchmarks are frozen. You cannot register new tests dynamically. (For dynamic test generation, use subtests inside a single `TestXxx`.)
2. The generated `main` does **not** call `flag.Parse`. The testing framework calls it inside `m.Run`. If you want the flags before `m.Run`, call `flag.Parse()` yourself.

## Panic recovery

A test that panics is recorded as a failure by `m.Run`; `m.Run` does not re-panic. So in normal operation, you do not need recovery in `TestMain`. The case where you do want recovery is when *setup* code panics or when you want to ensure teardown runs even if the test binary's internal state is corrupted.

Pattern:

```go
func TestMain(m *testing.M) {
    code := func() (c int) {
        defer func() {
            if r := recover(); r != nil {
                fmt.Fprintf(os.Stderr, "panic in TestMain: %v\n%s\n", r, debug.Stack())
                c = 1
            }
        }()
        setup()
        return m.Run()
    }()
    teardown()
    os.Exit(code)
}
```

The IIFE captures the code. A panic in `setup()` is caught, logged, and converted to exit code `1`. `teardown` still runs. Critical: do **not** put `setup` outside the IIFE without also wrapping in recover, or a panic there bypasses your teardown.

## Sub-process tests via `TestMain`

Sometimes you need to test code that calls `os.Exit` or `log.Fatal`. You cannot test those directly because they would terminate the test binary. The standard library handles this with the "fork-exec" pattern, where the test binary re-executes itself in a child process with a special env var, and the child calls the real `main`.

`os/exec_test.go` demonstrates it:

```go
func TestMain(m *testing.M) {
    if os.Getenv("GO_TEST_HELPER") == "1" {
        // We are the child. Do the work that would normally be in main.
        doWork()
        os.Exit(0)
    }
    os.Exit(m.Run())
}

func TestExit(t *testing.T) {
    cmd := exec.Command(os.Args[0])
    cmd.Env = append(os.Environ(), "GO_TEST_HELPER=1")
    out, err := cmd.CombinedOutput()
    // assert on err and out
}
```

`os.Args[0]` is the path to the running test binary. Re-executing it with the helper env var triggers the alternate branch. This pattern is how you can test "the program exits with code 7 when X happens" without `os.Exit` killing your test run.

Caveat: this requires `TestMain` to check the env var *before* `m.Run`, because we do not want the child to try to run all the tests. Branching early is the whole point.

## Helper packages for shared `TestMain`

In a monorepo with many integration packages, `TestMain` boilerplate is duplication waiting to bite you. Extract a helper:

```go
// internal/testsupport/testsupport.go
package testsupport

import (
    "context"
    "flag"
    "os"
    "testing"

    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

type Config struct {
    Postgres bool
    Redis    bool
}

type Resources struct {
    PostgresDSN string
    RedisAddr   string
    teardowns   []func()
}

func (r *Resources) cleanup() {
    for i := len(r.teardowns) - 1; i >= 0; i-- {
        r.teardowns[i]()
    }
}

func Run(m *testing.M, cfg Config) int {
    flag.Parse()
    res := &Resources{}
    defer res.cleanup()

    if cfg.Postgres {
        ctx := context.Background()
        pg, err := postgres.Run(ctx, "postgres:16")
        if err != nil {
            fmt.Fprintf(os.Stderr, "postgres: %v\n", err)
            return 1
        }
        dsn, _ := pg.ConnectionString(ctx, "sslmode=disable")
        res.PostgresDSN = dsn
        res.teardowns = append(res.teardowns, func() { pg.Terminate(ctx) })
    }
    if cfg.Redis {
        // similar
    }

    Current = res
    return m.Run()
}

var Current *Resources // accessible from tests
```

Each package's `TestMain` becomes:

```go
func TestMain(m *testing.M) {
    os.Exit(testsupport.Run(m, testsupport.Config{Postgres: true}))
}
```

Bug fixes (Ryuk timeout, logger config, retry policy) live in one place. Onboarding a new package is two lines. The helper returns normally, so `defer res.cleanup()` fires reliably.

## Coverage of init paths

`go test -coverprofile c.out` instruments every line in the package under test, including `init` functions. Even if no test calls a function whose body is in `init`, that body is executed once during binary startup, so its lines show up as covered. `TestMain` is the perfect place to confirm side effects of init have happened — e.g., that a driver was registered with `database/sql`, or that a metric was registered with Prometheus.

Example:

```go
func init() {
    sql.Register("mydriver", &myDriver{})
}

func TestMain(m *testing.M) {
    drivers := sql.Drivers()
    if !slices.Contains(drivers, "mydriver") {
        fmt.Fprintln(os.Stderr, "init did not register mydriver")
        os.Exit(1)
    }
    os.Exit(m.Run())
}
```

This guards against silent registration failures. Coverage tools will report the lines of `init` as covered because `TestMain` ran the assertion.

Note: `TestMain` itself is also covered by `-cover`. If your `TestMain` has untested branches (e.g., `if testing.Short()`), they will appear uncovered until you exercise both modes in CI.

## Integration with `testing.RegisterCover`

`testing.RegisterCover` was the API the legacy `cover` tool generated calls to. It takes a `testing.Cover` value containing counter arrays. As of Go 1.20 the cover tool emits a different runtime hook (`runtime/coverage`), and `testing.RegisterCover` is largely unused. You will see it in older codebases but should not call it yourself.

If you are writing a tool that produces test binaries with coverage, prefer the `runtime/coverage` package's `WriteCounters` / `WriteMeta` APIs.

## `runtime.GC()` before exit

A small but occasionally useful detail. `runtime.GC()` is the synchronous garbage collector. Calling it before `os.Exit` forces a collection cycle, which in turn runs any finalizers that have been scheduled. If your tests verify finalizer behaviour — e.g., "this resource is released when no longer referenced" — you may want:

```go
func TestMain(m *testing.M) {
    code := m.Run()
    runtime.GC() // give finalizers a chance to run
    runtime.GC() // a second pass to catch ones queued by the first
    os.Exit(code)
}
```

Two `GC` calls are conventional because the first marks objects unreferenced and queues finalizers; the second collects the finalizers' own allocations. This is a niche use case; for most tests, finalizer behaviour is best tested explicitly with `runtime.SetFinalizer` and `runtime.GC()` inside the test body.

## Hooks: `runtime.Goexit` from `TestMain`?

You will sometimes see codebases that call `runtime.Goexit` instead of `os.Exit`. `runtime.Goexit` terminates the current goroutine after running deferred functions. In the main goroutine, this also terminates the program — but unlike `os.Exit(0)`, the exit code is determined by whether other goroutines are blocked. This is unreliable for test binaries. Stick to `os.Exit`.

## Goroutine leak detection

A widely used package is `go.uber.org/goleak`. The basic idea: at the end of every test, assert there are no extra goroutines. The integration point is `TestMain`:

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

`goleak.VerifyTestMain` calls `m.Run`, then checks `runtime.Stack` for goroutines that are not part of the runtime baseline. If any are found, it prints them and exits with `1`. This catches background goroutines that tests started and forgot to stop.

You can also use `goleak.VerifyNone(t)` at the end of an individual test, but `VerifyTestMain` covers the whole binary in one shot.

## `TestMain` and fuzz targets

A fuzz target is dispatched by `m.Run` like any other test. Your `TestMain` setup applies. There is one wrinkle: when you run `go test -fuzz=Fuzz`, the runtime sometimes restarts the test binary (e.g., to apply a deterministic seed for a new corpus entry). Each restart re-runs `TestMain`. Implications:

- Keep `TestMain` setup idempotent and cheap. A 30-second startup multiplied by every fuzz restart is intolerable.
- Tear down cleanly so restarts do not leak resources.
- Consider gating heavy setup behind a flag: skip it when `testing.Verbose() == false && os.Getenv("GO_FUZZ") != ""`. (There is no official "we are fuzzing now" env var; you can detect it via flag inspection.)

## A composed senior example: integration package

```go
package storage_test

import (
    "context"
    "database/sql"
    "flag"
    "fmt"
    "log/slog"
    "os"
    "runtime"
    "runtime/debug"
    "testing"
    "time"

    "github.com/testcontainers/testcontainers-go/modules/postgres"
    _ "github.com/lib/pq"
    "go.uber.org/goleak"
)

var (
    dsn       string
    keepAlive = flag.Bool("keep-containers", false, "do not terminate containers after run")
)

func TestMain(m *testing.M) {
    flag.Parse()
    slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})))

    code := func() (c int) {
        defer func() {
            if r := recover(); r != nil {
                fmt.Fprintf(os.Stderr, "TestMain panic: %v\n%s\n", r, debug.Stack())
                c = 1
            }
        }()

        if testing.Short() {
            slog.Info("short mode: skipping integration setup")
            return m.Run()
        }

        cleanup, err := startResources()
        if err != nil {
            slog.Error("startResources", "err", err)
            return 1
        }
        defer cleanup()

        return m.Run()
    }()

    // Help finalizer-driven tests pass.
    runtime.GC()
    runtime.GC()

    // Goroutine leak check.
    if err := goleak.Find(
        goleak.IgnoreTopFunction("testing.(*T).Parallel"),
    ); err != nil {
        fmt.Fprintf(os.Stderr, "goroutine leak: %v\n", err)
        if code == 0 {
            code = 1
        }
    }

    os.Exit(code)
}

func startResources() (func(), error) {
    ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
    defer cancel()

    pg, err := postgres.Run(ctx, "postgres:16",
        postgres.WithDatabase("testdb"),
        postgres.WithUsername("u"),
        postgres.WithPassword("p"),
    )
    if err != nil {
        return nil, fmt.Errorf("postgres: %w", err)
    }

    dsn, err = pg.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        pg.Terminate(context.Background())
        return nil, fmt.Errorf("dsn: %w", err)
    }

    if err := runMigrations(dsn); err != nil {
        pg.Terminate(context.Background())
        return nil, fmt.Errorf("migrations: %w", err)
    }

    cleanup := func() {
        if *keepAlive {
            slog.Info("keeping containers alive", "dsn", dsn)
            return
        }
        pg.Terminate(context.Background())
    }
    return cleanup, nil
}

func newDB(t *testing.T) *sql.DB {
    t.Helper()
    if dsn == "" {
        t.Skip("no postgres available")
    }
    db, err := sql.Open("postgres", dsn)
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { db.Close() })
    return db
}
```

Walk through what is happening:

1. Logger configured first so any later error message has the right shape.
2. Lifecycle pushed into an IIFE so `defer cleanup()` fires (no `os.Exit` inside).
3. Panic recovery wraps the IIFE — a setup panic becomes exit code `1` after teardown still runs.
4. `-short` skips heavy setup but still runs tests (which themselves will likely skip).
5. `-keep-containers` flag lets a developer inspect the container after a failed run.
6. After the IIFE, `runtime.GC` runs twice to flush finalizers.
7. `goleak.Find` checks for goroutine leaks; if found, the exit code is bumped.
8. Final `os.Exit(code)` propagates the result.

This is roughly what a serious integration test package looks like. It is more code than the textbook "two-liner" `TestMain`, and every piece earns its place.

## When `TestMain` is the wrong tool

Senior engineers know when to *not* use `TestMain`:

- If only one test in the package needs the setup, put it in that test with `t.Helper` + `t.Cleanup`. Other tests in the package should not pay the setup cost.
- If different tests need different incompatible setups (e.g., one wants a Postgres in UTC, another in `America/Los_Angeles`), splitting into separate packages may be better than a `TestMain` that branches.
- If the setup itself depends on which test is selected (`-run TestThis`), `TestMain` cannot help; it runs before the run filter is interpreted.

## CI considerations

`go test ./...` walks every package's `TestMain` in sequence. If twenty packages each spin up a Postgres container, you incur twenty startups. Strategies:

- **Shared container at CI level.** Spin up Postgres once in the CI job, expose `TEST_DB_URL` env var, have each `TestMain` read it and skip starting its own.
- **Build tags.** Tag heavy tests with `//go:build integration`. Default `go test ./...` skips them.
- **Parallel package runs.** `go test ./...` already parallelizes packages with `-p`. If `TestMain` startup is dominant, more parallelism helps until you saturate CPU or memory.

## Recap

- The generated `main` calls your `TestMain` instead of `m.Run` directly.
- Push lifecycle that requires `defer` into a helper that returns normally.
- Use `recover` around setup if you need teardown to always run.
- Extract shared `TestMain` boilerplate into an internal helper package.
- Use `goleak.VerifyTestMain` or `goleak.Find` to catch goroutine leaks.
- For sub-process tests, branch early in `TestMain` on a sentinel env var.
- `TestMain` is the right place for coverage-of-init assertions, but not for dynamic test registration.
- Know when `TestMain` is the wrong tool and split tests, packages, or build tags instead.

You are now ready to design `TestMain` for any package, debate trade-offs in code review, and refactor monorepo boilerplate without breaking the suite.

## Deep dive: the testcontainers lifecycle

When using `testcontainers-go`, the container lifecycle is more nuanced than "start, use, stop":

1. **Image resolution.** The library asks Docker for the image. If absent, it pulls. Pull time varies from milliseconds (cached) to tens of seconds (cold).
2. **Container creation.** Docker creates the container with the requested config.
3. **Container start.** Docker starts the container.
4. **Readiness probe.** The library runs a `wait` strategy (port open, log line seen, health check passed). This is where most "container not ready" flakes come from.
5. **Test usage.** Your code interacts with the container.
6. **Termination.** Explicit `Terminate(ctx)` or implicit (Ryuk reaps orphans).

The right `TestMain` shape handles each phase explicitly:

```go
func TestMain(m *testing.M) {
    code := func() (c int) {
        defer func() {
            if r := recover(); r != nil {
                fmt.Fprintf(os.Stderr, "panic: %v\n%s\n", r, debug.Stack())
                c = 1
            }
        }()

        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
        defer cancel()

        pg, err := postgres.Run(ctx, "postgres:16",
            postgres.WithDatabase("testdb"),
            postgres.WithUsername("u"),
            postgres.WithPassword("p"),
            testcontainers.WithWaitStrategy(
                wait.ForLog("database system is ready to accept connections").
                    WithOccurrence(2).
                    WithStartupTimeout(60*time.Second),
            ),
        )
        if err != nil {
            fmt.Fprintf(os.Stderr, "postgres run: %v\n", err)
            return 1
        }
        defer pg.Terminate(context.Background())

        dsn, err = pg.ConnectionString(ctx, "sslmode=disable")
        if err != nil {
            fmt.Fprintf(os.Stderr, "dsn: %v\n", err)
            return 1
        }
        return m.Run()
    }()
    os.Exit(code)
}
```

Each piece earns its place: timeout context, explicit wait strategy with two occurrences of the readiness log (Postgres logs that line during init and then again when it accepts connections — only the second is the real signal), panic recovery, explicit termination context that lives beyond the setup `ctx`.

## Container reuse vs. fresh-per-run

Reuse:

```go
pg, err := postgres.Run(ctx, "postgres:16",
    testcontainers.CustomizeRequest(testcontainers.GenericContainerRequest{
        ContainerRequest: testcontainers.ContainerRequest{
            Name: "myapp-test-pg",
        },
        Reuse: true,
    }),
)
```

The first run starts the container. The second run sees the existing container by name and attaches. Saves startup time on every subsequent run.

Trade-off: schema may be stale. Add an idempotent migration step:

```go
if err := goose.Up(db, "migrations"); err != nil {
    log.Fatalf("migrate: %v", err)
}
```

`goose.Up` is a no-op when migrations are already applied. Cost: one round-trip per run.

## The Ryuk reaper

`testcontainers-go` ships with Ryuk, a small container that watches for orphaned test containers and cleans them up after a configurable inactivity period. This is what saves you when a developer kills `go test` with Ctrl-C — the Postgres container they were using is reaped automatically after the inactivity window.

You do not need to do anything special to enable Ryuk; it is on by default. Disable with `TESTCONTAINERS_RYUK_DISABLED=true` if you want manual control.

In CI, Ryuk is less important because the runner is usually destroyed after the job. Disable it to save the resource. Locally, keep it on.

## Sub-process tests: the full pattern

The `os/exec_test` pattern from the standard library:

```go
func TestMain(m *testing.M) {
    if helper := os.Getenv("GO_HELPER"); helper != "" {
        runHelper(helper)
        os.Exit(0)
    }
    os.Exit(m.Run())
}

func runHelper(kind string) {
    switch kind {
    case "exit-zero":
        os.Exit(0)
    case "exit-one":
        os.Exit(1)
    case "panic":
        panic("test panic")
    case "stdout":
        fmt.Println("hello stdout")
    case "stderr":
        fmt.Fprintln(os.Stderr, "hello stderr")
    case "long-running":
        time.Sleep(10 * time.Second)
    default:
        os.Exit(99)
    }
}

func TestExitZero(t *testing.T) {
    cmd := exec.Command(os.Args[0])
    cmd.Env = append(os.Environ(), "GO_HELPER=exit-zero")
    if err := cmd.Run(); err != nil {
        t.Fatalf("expected zero exit, got %v", err)
    }
}

func TestExitOne(t *testing.T) {
    cmd := exec.Command(os.Args[0])
    cmd.Env = append(os.Environ(), "GO_HELPER=exit-one")
    if err := cmd.Run(); err == nil {
        t.Fatalf("expected non-zero exit")
    }
}

func TestPanicExits(t *testing.T) {
    cmd := exec.Command(os.Args[0])
    cmd.Env = append(os.Environ(), "GO_HELPER=panic")
    out, _ := cmd.CombinedOutput()
    if !strings.Contains(string(out), "test panic") {
        t.Fatalf("expected panic message, got %s", out)
    }
}
```

The test binary re-execs itself with a helper-mode env var. The child branches on the env var and does the specific thing the parent test wants to verify. This pattern lets you test code that calls `os.Exit`, `panic`, `log.Fatal`, or other process-killing operations — without those operations killing your test run.

Bonus: the child runs the same binary, with the same coverage instrumentation. So `go test -cover` sees the helper code as covered.

## `goleak` deep dive

`go.uber.org/goleak` finds goroutines that did not exit before `TestMain` returned. The full API:

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        goleak.IgnoreTopFunction("net/http.(*Server).Serve"),
        goleak.IgnoreCurrent(),
    )
}
```

`IgnoreTopFunction` excludes goroutines whose top frame is the given function — useful for known-benign background work. `IgnoreCurrent` captures the goroutines that existed when `VerifyTestMain` was called and ignores any of them.

Catch from the wild: a developer writes a `TestServer` test that starts an `httptest.Server` but never calls `Close`. The connection-accept goroutine leaks. `goleak.VerifyTestMain` catches it and fails the run. The fix: `t.Cleanup(server.Close)` in the test.

Without `goleak`, the leak is invisible until production exhibits the same bug at scale.

## Coverage tooling integration

Go's coverage tooling has evolved:

- **Go 1.0 – 1.19**: `cmd/cover` rewrote source files to add counter increments, emitted a coverage profile after `m.Run`.
- **Go 1.20+**: `runtime/coverage` runs alongside the test binary, captures counters in shared memory, can produce profiles on demand.

For most users, the difference is invisible: `go test -cover` still works. But if you build production binaries with `-cover` (`go build -cover ./...`) for runtime coverage collection, you need to call `coverage.WriteCounters(io.Writer)` periodically.

`TestMain` is not directly involved unless you want to emit a coverage snapshot at a specific moment:

```go
func TestMain(m *testing.M) {
    code := m.Run()
    if dir := os.Getenv("GOCOVERDIR"); dir != "" {
        f, _ := os.Create(filepath.Join(dir, "extra.counters"))
        coverage.WriteCounters(f)
        f.Close()
    }
    os.Exit(code)
}
```

Niche, but useful for integration test rigs that want to merge coverage from sub-processes.

## Logging in a multi-package monorepo

When 20 packages each have a `TestMain` that configures `slog`, you end up with subtly different log shapes per package. Centralize:

```go
// internal/testlog/testlog.go
package testlog

func Init() {
    slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
        Level: slog.LevelDebug,
    })))
}
```

Each `TestMain`:

```go
func TestMain(m *testing.M) {
    testlog.Init()
    os.Exit(m.Run())
}
```

One source of truth for log shape. Easy to change globally (e.g., switch to JSON for CI ingestion).

## Tracing in `TestMain`

OpenTelemetry tracing setup typical pattern:

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/sdk/trace"
    "go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
)

func TestMain(m *testing.M) {
    exp, _ := stdouttrace.New(stdouttrace.WithPrettyPrint())
    tp := trace.NewTracerProvider(trace.WithSyncer(exp))
    otel.SetTracerProvider(tp)

    code := m.Run()

    tp.Shutdown(context.Background())
    os.Exit(code)
}
```

`WithSyncer` (vs. `WithBatcher`) ensures spans are emitted synchronously, which is helpful for tests where you want to assert on emitted spans.

A pattern for asserting on spans:

```go
recorder := tracetest.NewSpanRecorder()
tp := trace.NewTracerProvider(trace.WithSpanProcessor(recorder))
otel.SetTracerProvider(tp)
```

After `m.Run`, you can iterate `recorder.Ended()` to inspect every span the suite produced. Tests that care assert on this; tests that do not, ignore it.

## Metrics in `TestMain`

If your code emits metrics (Prometheus, OpenTelemetry metrics, etc.), `TestMain` is the right place to initialize the registry:

```go
func TestMain(m *testing.M) {
    reg := prometheus.NewRegistry()
    prometheus.DefaultRegisterer = reg
    code := m.Run()
    // optional: dump metrics for inspection
    gatherers, _ := reg.Gather()
    for _, g := range gatherers {
        // print g
    }
    os.Exit(code)
}
```

Using a fresh registry per test binary prevents cross-package interference. (Within a binary, you can use `reg.Reset()` if available, or recreate per test.)

## Real-world helper package: the `testenv` pattern

A common monorepo helper package:

```go
// internal/testenv/testenv.go
package testenv

import (
    "context"
    "database/sql"
    "fmt"
    "os"
    "sync"
    "testing"

    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

type Env struct {
    DB        *sql.DB
    teardowns []func()
}

var (
    once    sync.Once
    current *Env
)

func Get(tb testing.TB) *Env {
    tb.Helper()
    once.Do(func() {
        e, err := build()
        if err != nil {
            fmt.Fprintln(os.Stderr, "testenv:", err)
            os.Exit(1)
        }
        current = e
    })
    return current
}

func build() (*Env, error) {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16")
    if err != nil { return nil, err }

    dsn, _ := pg.ConnectionString(ctx, "sslmode=disable")
    db, err := sql.Open("postgres", dsn)
    if err != nil { pg.Terminate(ctx); return nil, err }

    return &Env{
        DB: db,
        teardowns: []func(){
            func() { db.Close() },
            func() { pg.Terminate(context.Background()) },
        },
    }, nil
}

func Run(m *testing.M) int {
    code := m.Run()
    if current != nil {
        for i := len(current.teardowns) - 1; i >= 0; i-- {
            current.teardowns[i]()
        }
    }
    return code
}
```

Each package's `TestMain` becomes:

```go
func TestMain(m *testing.M) {
    os.Exit(testenv.Run(m))
}
```

Tests get the shared environment via `testenv.Get(t).DB`. The `sync.Once` ensures the environment is built exactly once, lazily. If no test calls `Get`, no setup runs. If three tests call `Get`, only the first triggers the build.

This pattern scales to dozens of packages without duplication.

## When `TestMain` becomes a code smell

If your `TestMain` does any of the following, consider it a code smell:

- Branches heavily on flags. Suggests the package is doing too many things.
- Has 100+ lines. Suggests setup is too complex; extract to a helper package.
- Spawns multiple goroutines. Suggests you have parallel setup, which is fine, but be careful about joining them.
- Uses `time.Sleep` to wait for readiness. Suggests no proper readiness probe; fix the probe.
- Catches and rethrows panics in elaborate ways. Suggests the production code panics where it should return errors.

A `TestMain` is healthy when it is short, linear, and obviously correct.

## Senior reflections

Senior `TestMain` work is about minimizing failure surface. Every line in `TestMain` is a line that can fail to set up, and every failure point is a potential flake. The senior engineer pushes complexity into helpers, helpers into shared packages, shared packages into single sources of truth. The `TestMain` itself becomes a thin shell.

Counterintuitively, the most sophisticated `TestMain` looks the simplest. `os.Exit(testenv.Run(m))` is the endpoint of years of refactoring. Aim for that shape.

## A final integration example: complete `TestMain` with all the layers

Combining everything:

```go
package storage_test

import (
    "context"
    "database/sql"
    "flag"
    "fmt"
    "log/slog"
    "os"
    "runtime"
    "runtime/debug"
    "testing"
    "time"

    "github.com/testcontainers/testcontainers-go/modules/postgres"
    _ "github.com/lib/pq"
    "go.uber.org/goleak"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/sdk/trace"
    "go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
)

var (
    dsn        string
    keepAlive  = flag.Bool("keep-containers", false, "do not terminate containers")
    enableTrace = flag.Bool("trace", false, "emit OpenTelemetry spans to stdout")
)

func TestMain(m *testing.M) {
    flag.Parse()
    slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})))

    code := func() (c int) {
        defer func() {
            if r := recover(); r != nil {
                fmt.Fprintf(os.Stderr, "TestMain panic: %v\n%s\n", r, debug.Stack())
                c = 1
            }
        }()

        if *enableTrace {
            exp, _ := stdouttrace.New()
            tp := trace.NewTracerProvider(trace.WithBatcher(exp))
            otel.SetTracerProvider(tp)
            defer tp.Shutdown(context.Background())
        }

        if testing.Short() {
            slog.Info("short mode: skipping integration setup")
            return m.Run()
        }

        cleanup, err := startResources()
        if err != nil {
            slog.Error("startResources", "err", err)
            return 1
        }
        defer cleanup()

        return m.Run()
    }()

    runtime.GC()
    runtime.GC()

    if err := goleak.Find(
        goleak.IgnoreTopFunction("testing.(*T).Parallel"),
        goleak.IgnoreTopFunction("net/http.(*Server).Serve"),
    ); err != nil {
        fmt.Fprintf(os.Stderr, "goroutine leak: %v\n", err)
        if code == 0 {
            code = 1
        }
    }

    os.Exit(code)
}

func startResources() (func(), error) {
    ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
    defer cancel()

    pg, err := postgres.Run(ctx, "postgres:16",
        postgres.WithDatabase("testdb"),
        postgres.WithUsername("u"),
        postgres.WithPassword("p"),
    )
    if err != nil {
        return nil, fmt.Errorf("postgres: %w", err)
    }

    dsn, err = pg.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        pg.Terminate(context.Background())
        return nil, fmt.Errorf("dsn: %w", err)
    }

    if err := runMigrations(dsn); err != nil {
        pg.Terminate(context.Background())
        return nil, fmt.Errorf("migrations: %w", err)
    }

    cleanup := func() {
        if *keepAlive {
            slog.Info("keeping containers alive", "dsn", dsn)
            return
        }
        pg.Terminate(context.Background())
    }
    return cleanup, nil
}

func newDB(t *testing.T) *sql.DB {
    t.Helper()
    if dsn == "" {
        t.Skip("no postgres available")
    }
    db, err := sql.Open("postgres", dsn)
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { db.Close() })
    return db
}
```

Read it slowly. Every line is intentional. This is what senior `TestMain` engineering looks like in production Go.

## Extended case study: refactoring a flaky integration suite

A real-world refactor. The team had a `TestMain` that started Postgres, Redis, and Kafka. Setup took 25 seconds. The flake rate was 3% — every 33rd run failed somewhere in setup or teardown. After investigation, here is what they changed:

### Issue 1: serial container startup

Containers started one at a time:

```go
pg := startPostgres()
rd := startRedis()
kf := startKafka()
```

Total: 8s + 4s + 12s = 24s. With `errgroup`:

```go
g, ctx := errgroup.WithContext(context.Background())
var pg *postgres.Container
var rd *redis.Container
var kf *kafka.Container
g.Go(func() error { var err error; pg, err = startPostgres(ctx); return err })
g.Go(func() error { var err error; rd, err = startRedis(ctx); return err })
g.Go(func() error { var err error; kf, err = startKafka(ctx); return err })
err := g.Wait()
```

Total: ~12s (max of the three). 12s saved per run.

### Issue 2: weak readiness probes

Postgres was considered "ready" when its port opened, but the database itself was not yet accepting connections. The first 10–50 ms of connection attempts after port-open failed with `connection reset by peer`. Tests that ran immediately after `TestMain` finished sometimes hit this window.

Fix: use a log-based readiness probe that waits for the line "database system is ready to accept connections" to appear twice (Postgres logs it once during init and again when ready).

### Issue 3: leaked goroutines in tests

A test spawned a goroutine that listened for events from Kafka and never closed it. Each test added a leaked goroutine. After 100 tests, the goroutine count was high, and process memory was bloated. `goleak.VerifyTestMain` would have caught this; the team added it.

### Issue 4: teardown order

Teardown closed Postgres before Kafka. Kafka's consumer was still connected to Postgres for offset commits; the close logged a non-zero exit. The `cleanup` reported the wrong error.

Fix: teardown in LIFO order. Use a stack of cleanups appended in setup order, closed in reverse.

### Issue 5: panic recovery missing

A panic in setup (e.g., `nil` Postgres container) crashed the test binary mid-flight. CI logs showed only the panic stack. Adding panic recovery and a clean "TestMain panic" line made the failure modes obvious.

### Final shape

After all five fixes, the `TestMain` looked like the canonical "complete senior example" earlier on this page. Setup time: 12s. Flake rate: 0.1%. Net improvement: 13s faster, 30x more reliable.

This is the kind of refactor a senior engineer leads on a production codebase. The end state is a `TestMain` that is well-instrumented, well-bounded, and clearly correct.

## Anti-patterns to refuse in review

Concrete examples a senior should push back on in code review:

1. **`log.Fatal` in setup.** Reason: spawns a goroutine, emits stack, prevents teardown. Replace with stderr message and `os.Exit(1)`.
2. **`defer cleanup(); os.Exit(...)`.** Reason: defer does not fire. Use return-normally helper.
3. **Mutating env vars without restoring.** Reason: subsequent tests in the binary see modified state.
4. **`time.Sleep` as a readiness probe.** Reason: flaky. Use proper wait strategies.
5. **Goroutines without context cancellation.** Reason: leaks across `m.Run`.
6. **`init`-based setup that tests need to override.** Reason: too late by the time `TestMain` runs. Refactor production code.
7. **Multiple `m.Run` calls.** Reason: undefined behaviour. Call exactly once.
8. **`TestMain` longer than 100 lines.** Reason: complexity belongs in helpers.

Each of these has a clean fix. Senior engineers know the patterns and steer reviews toward them.

## Cross-package coordination

Sometimes you genuinely need cross-package coordination — e.g., one package starts a server, another package's tests want to connect to it. Since `go test ./...` runs each package in its own process, you cannot share state directly.

Options:

1. **Run a long-running server outside `go test`.** Start it in a CI step before `go test`. Each package's `TestMain` reads its address from env.
2. **Run a single integration test binary.** Move the tests into one package; `TestMain` starts the server; tests in that package use it. Other packages have no integration tests.
3. **Use Docker for inter-package fixtures.** A `docker-compose.yml` file describes the test stack; CI brings it up before `go test`.

Option 1 is the most common in monorepos. Document the contract: `TEST_API_URL` must be set, or tests skip.

## Reading the generated `_testmain.go`

A useful exercise for senior engineers: run `go test -work -c -o /dev/null ./yourpkg` and inspect the generated `_testmain.go`. You will see something like:

```go
func main() {
    m := testing.MainStart(
        testdeps.TestDeps{},
        []testing.InternalTest{
            {"TestFoo", _testpkg.TestFoo},
            {"TestBar", _testpkg.TestBar},
        },
        []testing.InternalBenchmark{},
        []testing.InternalFuzzTarget{},
        []testing.InternalExample{},
    )
    _testpkg.TestMain(m)
}
```

Now you can answer questions like "what if my package has no `TestMain`?" empirically — change the package and re-run with `-work`; the generated `main` will be different (calling `m.Run` directly instead of `_testpkg.TestMain(m)`).

This is the difference between reading docs and reading the actual code. Both are valuable; the latter dispels mysteries.

## A short philosophy

`TestMain` is a contract between the test framework and you. The framework promises to call your `TestMain` exactly once with a fully populated `*testing.M`. You promise to call `m.Run` exactly once and exit with the result. Everything else — setup, teardown, observability, isolation — is your responsibility, not the framework's.

The senior engineer respects the contract: keeps `TestMain` short, makes failure modes explicit, documents the package's lifecycle, and refuses to bury complexity in `TestMain` that belongs elsewhere. The result is a test suite that scales with the codebase.

## Recap

- The generated `main` calls your `TestMain` instead of `m.Run` directly.
- Push lifecycle that requires `defer` into a helper that returns normally.
- Use `recover` around setup if you need teardown to always run.
- Extract shared `TestMain` boilerplate into an internal helper package.
- Use `goleak.VerifyTestMain` or `goleak.Find` to catch goroutine leaks.
- For sub-process tests, branch early in `TestMain` on a sentinel env var.
- `TestMain` is the right place for coverage-of-init assertions, but not for dynamic test registration.
- Know when `TestMain` is the wrong tool and split tests, packages, or build tags instead.
- Integrate tracing, metrics, logging at this layer for consistency across the suite.
- Real-world senior `TestMain` files are short: heavy logic lives in helpers.

You are now ready to design `TestMain` for any package, debate trade-offs in code review, and refactor monorepo boilerplate without breaking the suite.

## Final word

If you have read this far, you have the conceptual scaffolding to handle any `TestMain` scenario you will encounter. The remaining pages — specification, interview, tasks, find-bug, optimize — are reference material. Use them to test your understanding, sharpen specific skills, and look up rules you might have forgotten. The senior page itself is the operational manual.

Welcome to senior-level Go testing infrastructure.

## Senior anti-pattern: the god-`TestMain`

Sometimes a single `TestMain` grows to handle everything: ten flag groups, twenty resource initializations, hundreds of lines. This is a code smell. Symptoms:

- The function exceeds 200 lines.
- Setup errors are caught with deep `if err != nil` chains.
- Multiple panics could trigger; recovery logic is tangled.
- New developers cannot edit it without breaking something.

The fix is decomposition. Extract:

- Logger setup → `internal/testlog`
- Tracing setup → `internal/testtrace`
- Database setup → `internal/testdb`
- Cache setup → `internal/testcache`

Each helper is independently testable and reusable. The remaining `TestMain` is two lines.

## Senior anti-pattern: testing the test infrastructure

Tempting at scale: write tests for the helpers used by `TestMain`. A `TestTestDB` that verifies `testdb.Get` returns a usable database. This is fine in moderation, but be wary of infinite recursion — tests for tests for tests. Stop at the level where the helper is genuinely complex enough to warrant assertion.

## Senior pattern: dual-mode `TestMain`

Some packages have both unit tests (no setup) and integration tests (heavy setup). Rather than two test binaries, one `TestMain` can run both:

```go
var integration = flag.Bool("integration", false, "run integration tests")

func TestMain(m *testing.M) {
    flag.Parse()
    if *integration {
        os.Exit(runIntegration(m))
    }
    os.Exit(m.Run())
}

func runIntegration(m *testing.M) int {
    // heavy setup
    return m.Run()
}

func TestUnit(t *testing.T) {
    // no setup needed
}

func TestIntegration(t *testing.T) {
    if !*integration {
        t.Skip("pass -integration to enable")
    }
    // assumes heavy setup ran
}
```

`go test ./...` runs unit only. `go test -integration ./...` runs both. One binary, two modes.

Trade-off: the binary is larger because it links against testcontainers etc. even in unit-only mode. For most teams, this is acceptable. For very large monorepos, separate packages may be cleaner.

## Senior pattern: pre-flight checks

Before `m.Run`, verify the environment is sane:

```go
func preflight() error {
    if _, err := exec.LookPath("docker"); err != nil {
        return fmt.Errorf("docker not in PATH; integration tests require docker")
    }
    if free := freeDiskSpace("/"); free < 1<<30 {
        return fmt.Errorf("less than 1GB free; tests may fail")
    }
    return nil
}

func TestMain(m *testing.M) {
    if err := preflight(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
    os.Exit(m.Run())
}
```

This converts "mysterious test failure" into "clear setup error". CI engineers appreciate it.

## Senior pattern: structured exit codes

Beyond 0 and 1, you can encode richer information:

```go
const (
    exitOK             = 0
    exitTestFail       = 1
    exitSetupFail      = 2
    exitPreflightFail  = 3
    exitGoroutineLeak  = 4
    exitPanic          = 5
)
```

CI can branch on the code. "Test failure" reruns the suite. "Setup failure" alerts infra. "Panic" alerts the developer who pushed.

Note: `go test` itself only reports 0 (pass) or non-zero (fail) — it does not propagate finer codes. But the test binary, when run standalone, does propagate them. Useful for sophisticated CI rigs.

## Senior reflection on goroutine leaks

Goroutine leaks in tests are common because tests are short-lived; the leak does not have time to matter. But the same patterns leak in production, where they accumulate over hours and OOM the process. Catching leaks in tests is *the* way to prevent production goroutine leaks.

`goleak` is the standard tool. Use it. Ignore specific known-benign goroutines via `IgnoreTopFunction` rather than disabling the check.

## Senior reflection on test isolation

The hardest decision in `TestMain`-based suites is isolation. Shared state is fast but couples tests. Per-test state is isolated but slow. The honest answer: pick per-test isolation by default, optimize to shared state only when measurement shows the cost matters.

A `*sql.DB` shared across tests is fine if the tests do not mutate it. A schema mutated by tests requires transaction-per-test or DB-per-test. Choose deliberately.

## Senior pattern: graceful shutdown of background workers

A test binary that runs a worker pool (e.g., a metrics scraper, a log shipper):

```go
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    scraper.Run(ctx)
}()

code := m.Run()

cancel()
wg.Wait()
os.Exit(code)
```

Cancel the context, wait for the worker to acknowledge and exit. Without `wg.Wait`, the worker is killed mid-flight by `os.Exit`, which is technically fine (the process is ending) but produces noisy "context cancelled" logs and may corrupt buffers if the worker was mid-write.

## Wrapping up

`TestMain` is the senior engineer's lever for test infrastructure. Treat it with the same care you treat production initialization code: explicit, measured, well-bounded, well-documented. The reward is a test suite that scales with the codebase and the team.

The other pages in this subsection deepen specific aspects (specification, optimization, common bugs). Refer back as needed. The senior page is the operational guide; the others are reference.

Now go write a clean `TestMain`.

## Appendix: senior-level reading list

If you want to go further:

- Read `src/testing/testing.go` end-to-end. The package is small; you can read it in one sitting.
- Read `src/cmd/go/internal/test/test.go`. See how the Go tool compiles and runs test binaries.
- Read `src/cmd/go/internal/load/test.go`. See how `_testmain.go` is generated.
- Browse Kubernetes' `test/integration` for examples of large-scale integration `TestMain` usage.
- Browse `etcd`'s `tests/integration` for examples of distributed-system test infrastructure.
- Read `goleak`'s source — it is a small, elegant library worth understanding.
- Read `testcontainers-go`'s `container.go` to understand the lifecycle of a test container.

After this you will have a complete picture of how Go testing infrastructure works under the hood, from `go test` to your `TestMain` and back.

## A senior's signoff

If your team's `TestMain` files are short, consistent, and reliably exit with the right code, you have done senior-level work. The discipline shows up everywhere downstream: faster CI, less flake, more time spent on features instead of debugging test infrastructure. That is the senior contribution.

Carry the patterns; teach them; refuse the anti-patterns in review. Your colleagues will thank you, even if they cannot articulate why.

## Senior `TestMain` antifragile patterns

Beyond merely correct, a senior engineer aims for antifragile `TestMain` — code that gets *better* under stress. A few patterns:

### Always log the start time and seed

```go
slog.Info("TestMain starting", "time", time.Now(), "seed", *seed, "go_version", runtime.Version())
```

When a test fails in CI a week later, this log line tells you exactly what state the binary was in. Free debugging info.

### Always emit a final summary line

```go
defer func() {
    slog.Info("TestMain exiting", "code", code, "duration", time.Since(start))
}()
```

You get duration metrics for free. Graph them; spot regressions.

### Tolerate optional resources

If Redis is unavailable, do not fail `TestMain` — log a warning and let Redis-dependent tests skip themselves:

```go
if rd, err := openRedis(); err != nil {
    slog.Warn("redis unavailable; redis tests will skip", "err", err)
} else {
    sharedRedis = rd
}
```

The suite stays useful even when one component is down.

### Retry transient failures

Container startup occasionally fails for transient reasons (port collision, Docker daemon hiccup). Retry once:

```go
var pg *postgres.Container
for attempt := 1; attempt <= 3; attempt++ {
    p, err := postgres.Run(ctx, "postgres:16")
    if err == nil { pg = p; break }
    slog.Warn("postgres start failed", "attempt", attempt, "err", err)
    time.Sleep(time.Duration(attempt) * time.Second)
}
if pg == nil {
    return 1
}
```

Three attempts with linear backoff converts a 1% transient failure rate into a 0.0001% one.

Caveat: only retry transient failures. A misconfigured image tag is not transient; retrying just wastes time. Distinguish:

- **Transient**: network glitch, port collision, Docker daemon restart.
- **Permanent**: missing image, wrong credentials, syntax error in command.

Match on error type or message and only retry the transient ones.

### Never panic from `TestMain`

A panic in `TestMain` is hard to diagnose in CI. Convert all potential panics to returned errors. Recover at the top level.

These four patterns — log start, log end, tolerate optional, retry transient — make `TestMain` more reliable than the simple "do setup, run, exit" template. Add them when the suite matures past 50 tests.
