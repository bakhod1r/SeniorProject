---
layout: default
title: TestMain — Middle
parent: TestMain Function
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/08-testmain/middle/
---

# TestMain — Middle

[← Back](../)

This page assumes you can write a `TestMain` with `m.Run()` and `os.Exit(code)`. We now look at flag parsing, custom flags, shared resources, per-test wrappers via the `TestMain` pattern, and the interaction with `t.Cleanup`. By the end you should be able to design a test package that uses `TestMain` cleanly without leaking goroutines, connections, or surprise behaviour.

## Flag parsing inside `TestMain`

The testing package's godoc is explicit: when `TestMain` is entered, `flag.Parse` has **not** been called. If your setup wants to read a flag — `-short`, `-v`, your own custom `-dburl` — you must call `flag.Parse()` first. Inside `m.Run`, the testing framework calls `flag.Parse` itself as a safety net, so for *test code* the flags are usable regardless. But the safety net does not help your `setup()` call that runs before `m.Run`.

The canonical shape:

```go
func TestMain(m *testing.M) {
    flag.Parse()
    setup()
    code := m.Run()
    teardown()
    os.Exit(code)
}
```

After `flag.Parse()` returns, `testing.Short()`, `testing.Verbose()`, and any custom flags you registered with `flag.String`, `flag.Bool`, etc., are populated.

If you forget `flag.Parse`, two bugs can occur:

1. Reading your custom flag returns the default value forever, regardless of the command line.
2. Reading `testing.Short()` returns `false` even when `-short` is passed.

Both are silent. The test runs; the output is wrong.

## Custom flags

`go test` lets you define your own flags for the test binary. Define them at the package level in a `_test.go` file:

```go
var (
    dbURL = flag.String("dburl", "memory://", "database URL for integration tests")
    seed  = flag.Int64("seed", 0, "random seed for test data")
)

func TestMain(m *testing.M) {
    flag.Parse()
    if *seed == 0 {
        *seed = time.Now().UnixNano()
    }
    log.Printf("using db=%s seed=%d", *dbURL, *seed)
    db := openDB(*dbURL)
    rng := rand.New(rand.NewSource(*seed))
    sharedDB = db
    sharedRNG = rng
    code := m.Run()
    db.Close()
    os.Exit(code)
}
```

Run it with `go test -dburl=postgres://localhost/test -seed=42 ./...`. Note that `go test` accepts custom flags after its own. There is no `-test.dburl` mangling for user flags — the testing infrastructure only mangles `-v`, `-run`, etc.

A practical convention: prefix custom flags with the package or a short tag to avoid collisions with the testing flags. `dburl` is fine; `v` would collide.

## Sharing state through package variables

`TestMain` is the natural owner of package-level state used by tests. Pattern:

```go
var (
    db     *sql.DB
    server *httptest.Server
    rng    *rand.Rand
)

func TestMain(m *testing.M) {
    flag.Parse()
    var err error
    db, err = sql.Open("sqlite3", ":memory:")
    if err != nil { fail(err) }
    if err := migrate(db); err != nil { fail(err) }
    server = httptest.NewServer(newHandler(db))
    rng = rand.New(rand.NewSource(*seed))
    code := m.Run()
    server.Close()
    db.Close()
    os.Exit(code)
}

func fail(err error) {
    fmt.Fprintf(os.Stderr, "setup: %v\n", err)
    os.Exit(1)
}
```

Tests then use `db`, `server`, `rng` directly. This is the canonical "fixture" pattern in Go. It works because the testing framework runs all tests sequentially by default within a binary, and even with `t.Parallel`, every test sees the same `db` pointer.

Caveat: if tests mutate `db` (truncate tables, insert seed rows), they are coupled. Either pick an isolation strategy (one txn per test rolled back, separate database per test, etc.) or accept the coupling and order-randomize in CI to surface accidental dependencies.

## Per-test wrappers via `TestMain` indirection

A useful pattern: `TestMain` does not run tests directly; it runs them through a wrapper that adds per-test setup/teardown. Concretely:

```go
func TestMain(m *testing.M) {
    flag.Parse()
    initOnce()
    os.Exit(m.Run())
}

// withTx wraps a test in a database transaction that is rolled back at the end.
func withTx(t *testing.T, fn func(*testing.T, *sql.Tx)) {
    t.Helper()
    tx, err := db.BeginTx(context.Background(), nil)
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { tx.Rollback() })
    fn(t, tx)
}

func TestInsertUser(t *testing.T) {
    withTx(t, func(t *testing.T, tx *sql.Tx) {
        if _, err := tx.Exec("INSERT INTO users(name) VALUES(?)", "alice"); err != nil {
            t.Fatal(err)
        }
    })
}
```

The `db` is opened once by `TestMain`. Each test gets a transaction; `t.Cleanup` rolls it back. No test sees state from another test, but no test pays the cost of opening the database.

This is the marriage of `TestMain` (package-level expensive setup) with `t.Cleanup` (per-test cheap, deferred-style cleanup). The two are complementary, not alternatives.

## `t.Cleanup` vs `defer` again — but in tests, not TestMain

A quick reminder: `defer` inside a `TestXxx` does run, because the test function returns normally. The defer-vs-os.Exit problem is unique to `TestMain`. So in tests you can write:

```go
func TestThing(t *testing.T) {
    f, err := os.Create("tmp.txt")
    if err != nil { t.Fatal(err) }
    defer f.Close() // fires when TestThing returns
}
```

This works. `t.Cleanup` is still preferable because it composes with subtests and helper functions, and because it runs after the test logs are flushed, but plain `defer` is correct in test bodies. Just not in `TestMain`.

## Honoring `-short`

`testing.Short()` is the universal "skip slow stuff" signal. Use it in `TestMain` to skip expensive setup when the user wants a fast feedback loop:

```go
func TestMain(m *testing.M) {
    flag.Parse()
    if !testing.Short() {
        startContainers()
        defer stopContainers()
    }
    os.Exit(runRun(m))
}

func runRun(m *testing.M) int {
    return m.Run()
}
```

Then in slow tests:

```go
func TestIntegration(t *testing.T) {
    if testing.Short() {
        t.Skip("integration test skipped in short mode")
    }
    // ...
}
```

`go test -short ./...` pays the cheap setup and skips slow tests. `go test ./...` pays the full setup and runs everything.

Note the refactor into `runRun` so the `defer stopContainers()` fires. Recall: defers inside `TestMain` *do not* run when `os.Exit` is called, but defers inside a callee that returns normally *do*. Pushing `m.Run` into a helper that returns is the workaround.

## Logging and tracing initialization

Production code likely uses `slog`, OpenTelemetry, or a custom logger. Tests benefit from the same logger so that error messages have context. Initialize once in `TestMain`:

```go
func TestMain(m *testing.M) {
    handler := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})
    slog.SetDefault(slog.New(handler))
    flag.Parse()
    os.Exit(m.Run())
}
```

Now every test inherits the configured logger. Beware: `slog.SetDefault` is process-global; if you run `go test ./pkg1 ./pkg2` the binaries are separate processes, so there is no cross-package leak.

For OpenTelemetry, instantiate a tracer provider with a noop exporter (or a span recorder for assertion-driven tests):

```go
func TestMain(m *testing.M) {
    tp := tracetest.NewTracerProvider(tracetest.WithSpanProcessor(rec))
    otel.SetTracerProvider(tp)
    code := m.Run()
    tp.Shutdown(context.Background())
    os.Exit(code)
}
```

The `tp.Shutdown` call flushes spans before exit. If you put it after `os.Exit`, it never runs — same lesson as `defer`.

## Testcontainers in `TestMain`

The Go testcontainers library lets you spin up Docker containers in test code. `TestMain` is the right place to start them so the cost is paid once:

```go
import (
    "github.com/testcontainers/testcontainers-go"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

var dsn string

func TestMain(m *testing.M) {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16",
        postgres.WithDatabase("testdb"),
        postgres.WithUsername("u"),
        postgres.WithPassword("p"),
    )
    if err != nil {
        fmt.Fprintf(os.Stderr, "start postgres: %v\n", err)
        os.Exit(1)
    }
    dsn, err = pg.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        fmt.Fprintf(os.Stderr, "dsn: %v\n", err)
        pg.Terminate(ctx)
        os.Exit(1)
    }
    code := m.Run()
    pg.Terminate(ctx)
    os.Exit(code)
}
```

Each `TestXxx` reads `dsn` and opens its own `*sql.DB` against the running container. Container startup costs about 1–3 seconds; that cost is paid once. With `Reuse: true` and a stable name, even that is amortized across runs.

The same pattern works for Redis, Kafka, MinIO, Elasticsearch, and so on. Testcontainers also speaks the Ryuk protocol (a reaper container that watches for orphaned test containers and cleans them up if your binary crashes mid-run). That means even if a developer kills `go test` with Ctrl-C, the Postgres container will be cleaned up within a minute. Without Ryuk, you would leak Docker containers.

## Per-test database — pattern

A common refinement: each test gets its own logical database, not just a transaction.

```go
func newDB(t *testing.T) *sql.DB {
    t.Helper()
    name := fmt.Sprintf("test_%d_%s", time.Now().UnixNano(), randStr(6))
    if _, err := adminDB.Exec("CREATE DATABASE " + name); err != nil {
        t.Fatal(err)
    }
    db, err := sql.Open("postgres", buildDSN(dsn, name))
    if err != nil { t.Fatal(err) }
    if err := migrate(db); err != nil { t.Fatal(err) }
    t.Cleanup(func() {
        db.Close()
        adminDB.Exec("DROP DATABASE " + name)
    })
    return db
}
```

`TestMain` opens the long-lived `adminDB` once. Each `TestXxx` calls `newDB(t)` to get a freshly migrated database, and `t.Cleanup` drops it. Tests are fully isolated, parallelism is safe, and the cost per test is "create + migrate + drop" — measurable but acceptable.

## `t.Cleanup` ordering vs `TestMain` teardown

Important subtlety: `t.Cleanup` functions run after each `TestXxx` returns, in LIFO order. `TestMain` teardown runs after **all** tests have completed. So the timeline is:

```
TestMain setup
  TestA setup (via t.Helper-style code)
  TestA body
  TestA cleanups (LIFO)
  TestB setup
  TestB body
  TestB cleanups (LIFO)
TestMain teardown
os.Exit
```

This means a `t.Cleanup` in one test cannot affect a later test directly (assuming no shared mutable state), and `TestMain` teardown can safely close shared resources after every test has finished using them.

## `t.Parallel` and `TestMain`

`t.Parallel` makes tests run concurrently. `TestMain` is unaffected: setup still runs once, sequentially, before any test starts. Teardown still runs once, after every parallel test completes. The parallelism happens entirely within `m.Run`. So you do not need to do anything special in `TestMain` to support parallel tests — but you do need to make sure the *shared state* you set up is safe for concurrent access. A `*sql.DB` is goroutine-safe; a plain `map` is not.

## A complete middle-level example

Putting it all together:

```go
package userstore_test

import (
    "context"
    "database/sql"
    "flag"
    "fmt"
    "log/slog"
    "os"
    "testing"

    "github.com/testcontainers/testcontainers-go/modules/postgres"
    _ "github.com/lib/pq"
)

var (
    dsn   string
    short = flag.Bool("xshort", false, "skip docker setup")
)

func TestMain(m *testing.M) {
    flag.Parse()
    slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
    if *short || testing.Short() {
        fmt.Println("short mode: skipping docker setup")
        os.Exit(m.Run())
    }
    code := runIntegration(m)
    os.Exit(code)
}

func runIntegration(m *testing.M) int {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16")
    if err != nil {
        fmt.Fprintf(os.Stderr, "start postgres: %v\n", err)
        return 1
    }
    defer pg.Terminate(ctx) // returns normally, so this runs

    dsn, err = pg.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        fmt.Fprintf(os.Stderr, "dsn: %v\n", err)
        return 1
    }
    return m.Run()
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

Notice the structure:

- `TestMain` parses flags, sets up the logger, decides whether to skip docker entirely.
- Heavy lifting is pushed into `runIntegration`, which returns normally, so `defer pg.Terminate` works.
- Tests call `newDB(t)` which is safe in `-short` mode because it `t.Skip`s.

This shape scales well. As you add more resources (Redis, Kafka, S3), you keep the structure: parse, decide, push lifecycle into a helper that returns, exit with the result.

## Anti-patterns to avoid at middle level

- Spawning goroutines from `TestMain` and not joining them before `m.Run`. The tests start mid-flight; race conditions ensue.
- Using `log.Fatal` for setup errors. Works, but emits a noisy stack trace. Prefer a one-line stderr message and `os.Exit(1)`.
- Calling `t.Fatal` from `TestMain`. There is no `*testing.T`. The compiler will catch this, but it is worth internalizing.
- Defining the same custom flag in multiple `_test.go` files. The `flag` package panics on the duplicate registration.

## Recap

- Call `flag.Parse()` before reading any flag inside `TestMain`.
- Custom flags are package-level `flag.String`/`flag.Bool`/etc. declarations.
- Package variables initialized in `TestMain` are the standard way to share fixtures.
- Pair `TestMain` (package-wide setup) with `t.Cleanup` (per-test teardown).
- Push lifecycle that needs `defer` into a helper that returns normally.
- `t.Parallel` and `TestMain` coexist without ceremony, as long as your shared state is concurrency-safe.

The senior page goes deeper into testcontainers patterns, panic recovery, sub-process tests, and how a multi-package monorepo extracts shared `TestMain` logic.

## Deeper dive: flag interaction with `go test`

Go's testing framework defines a set of flags whose names are prefixed with `test.` internally but exposed without the prefix on the command line. For example, `-v` is `-test.v` from the binary's perspective. When you build a test binary with `go test -c`, you can run `./mypkg.test -test.v` directly.

Your custom flags do not get the `test.` prefix. They are first-class flags in the package's flag set. So `go test -dburl=...` and `./mypkg.test -dburl=...` both work.

The `flag` package also accepts `--flag` (double-dash) syntax. Either form is fine.

A subtle issue arises if your flag name conflicts with a testing flag. `-v`, `-run`, `-count`, `-timeout`, etc. are reserved. Choose unique names; prefix with your package or `test` if needed.

## Multiple custom flags: a real-world example

```go
var (
    dbURL    = flag.String("dburl", "memory://", "database URL")
    redisURL = flag.String("redis", "", "redis URL; empty disables redis tests")
    timeout  = flag.Duration("test-timeout", 30*time.Second, "per-test timeout")
    seed     = flag.Int64("seed", 0, "RNG seed (0 = random)")
)

func TestMain(m *testing.M) {
    flag.Parse()

    if *seed == 0 {
        *seed = time.Now().UnixNano()
    }
    rng := rand.New(rand.NewSource(*seed))
    log.Printf("seed=%d (reproduce with -seed=%d)", *seed, *seed)

    db, err := openDB(*dbURL)
    if err != nil { fail(err) }
    sharedDB = db

    if *redisURL != "" {
        rd, err := openRedis(*redisURL)
        if err != nil { fail(err) }
        sharedRedis = rd
    }

    sharedRNG = rng
    code := m.Run()
    db.Close()
    if sharedRedis != nil { sharedRedis.Close() }
    os.Exit(code)
}
```

The Redis flag is optional: if empty, Redis-dependent tests skip themselves. The seed is reported every run so flaky tests can be reproduced. Real production `TestMain` files often look like this.

## Why `flag.Parse` is so important

A common subtle bug: `testing.Short()` returns the parsed state of `-short`. Before `flag.Parse`, it returns the zero value `false`. After parse, it returns the actual command-line value.

```go
func TestMain(m *testing.M) {
    if testing.Short() {           // returns false even with -short
        skipHeavySetup = true
    }
    flag.Parse()                   // too late
    os.Exit(m.Run())
}
```

`skipHeavySetup` is always false. The fix: `flag.Parse()` first, then read `testing.Short()`.

This rule extends to every flag, custom or built-in. Always parse before reading.

## Shared state and the data race detector

`go test -race` enables the race detector. If your `TestMain` initializes a map and parallel tests write to it, the detector will catch the race and fail the run. This is precisely what `-race` is for. Treat any race report from `TestMain`-shared state as a P0 bug.

Common races:

- A `map[string]X` initialized in `TestMain`, written by parallel tests.
- A `[]Item` appended to by parallel tests.
- A `time.Time` field updated by parallel tests for "last seen".

Fix: use `sync.Map`, `sync.Mutex`, or `atomic` primitives. Or make the state read-only after `TestMain` setup.

## `t.Cleanup` ordering: a detailed example

Suppose you have:

```go
func TestThing(t *testing.T) {
    t.Cleanup(func() { log.Println("outer cleanup") })

    t.Run("sub", func(t *testing.T) {
        t.Cleanup(func() { log.Println("inner cleanup") })
    })

    t.Cleanup(func() { log.Println("outer cleanup 2") })
}
```

The output order:

```
inner cleanup
outer cleanup 2
outer cleanup
```

`t.Cleanup` is LIFO **within each test**. Subtests cleanup before the parent. Multiple cleanups in the same test are LIFO. `TestMain` teardown runs after all of this, when `m.Run` returns.

This is important when you have layered resources: a transaction inside a database inside a Redis cache inside a Postgres container. Each layer registers a cleanup at the right scope (`TestMain` for the container, helper for the DB, `t.Cleanup` for the transaction). They unwind in reverse order automatically.

## Combining `TestMain` with subtests

A common, powerful pattern: run a parameterized suite via subtests inside a single `TestXxx`, with `TestMain` providing the shared setup:

```go
func TestMain(m *testing.M) {
    sharedDB = openDB()
    os.Exit(m.Run())
}

func TestUsers(t *testing.T) {
    cases := []struct {
        name  string
        user  User
        valid bool
    }{
        {"valid", User{Name: "alice"}, true},
        {"empty name", User{}, false},
        {"long name", User{Name: strings.Repeat("a", 1000)}, false},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            err := sharedDB.SaveUser(tc.user)
            if tc.valid && err != nil { t.Fatal(err) }
            if !tc.valid && err == nil { t.Fatal("expected error") }
        })
    }
}
```

`TestMain` opens the DB. `TestUsers` is one Go function but produces three subtests. Each subtest has its own pass/fail line. You can run just one: `go test -run TestUsers/valid`.

## Custom flags for fine-grained selection

Tests sometimes need to be enabled or disabled by configuration. Flags are the right interface:

```go
var (
    runKafka = flag.Bool("kafka", false, "run kafka tests")
    runRedis = flag.Bool("redis", false, "run redis tests")
)

func TestKafka(t *testing.T) {
    if !*runKafka { t.Skip("kafka tests disabled; pass -kafka to enable") }
    // ...
}
```

`go test -kafka -redis ./...` runs everything. `go test ./...` skips. CI can pick the right combination per job.

## Integration with `httptest` and `httptrace`

`httptest.Server` is a natural fit for `TestMain`. One server, many tests:

```go
var server *httptest.Server

func TestMain(m *testing.M) {
    server = httptest.NewServer(buildAPI())
    code := m.Run()
    server.Close()
    os.Exit(code)
}

func TestPing(t *testing.T) {
    resp, err := http.Get(server.URL + "/ping")
    if err != nil { t.Fatal(err) }
    defer resp.Body.Close()
}
```

If you want HTTPS, use `httptest.NewTLSServer`. The server's certificate is self-signed and added to the test client's root CAs by `server.Client()`.

## Test isolation strategies with shared state

If `TestMain` opens a database, you have a choice for how tests achieve isolation:

### Strategy A: separate database per test

```go
func newDB(t *testing.T) *sql.DB {
    name := uniqDBName()
    adminDB.Exec("CREATE DATABASE " + name)
    db, _ := sql.Open("postgres", dsnFor(name))
    t.Cleanup(func() {
        db.Close()
        adminDB.Exec("DROP DATABASE " + name)
    })
    return db
}
```

Pros: complete isolation, parallel-safe. Cons: per-test cost.

### Strategy B: transaction per test

```go
func newTx(t *testing.T) *sql.Tx {
    tx, _ := sharedDB.Begin()
    t.Cleanup(func() { tx.Rollback() })
    return tx
}
```

Pros: very fast. Cons: cannot test code that uses transactions internally (nested transactions in Postgres require savepoints).

### Strategy C: truncate tables per test

```go
func resetDB(t *testing.T) {
    sharedDB.Exec("TRUNCATE TABLE users, orders RESTART IDENTITY CASCADE")
    t.Cleanup(func() { /* nothing or re-truncate */ })
}
```

Pros: shared DB, real transactions. Cons: parallel tests will collide; must be serial.

Pick based on parallelism needs and what you are testing. Most teams settle on A or B for parallel suites.

## `init` interaction in tests

If your package has both `init` functions in production files and `TestMain` in test files, the order is:

1. All `init` functions in all imported packages (recursively).
2. All `init` functions in the package under test.
3. `TestMain(m)`.

This means `init` cannot read state that `TestMain` sets up. If your `init` reads a file and your tests want to control that file, the right move is to refactor `init` to be lazy or expose a setter.

A common refactor pattern:

```go
// before:
var config Config
func init() { config = loadConfig() }

// after:
var config Config
var configOnce sync.Once
func loadConfigOnce() Config {
    configOnce.Do(func() { config = loadConfig() })
    return config
}
```

Tests can override `config` directly in `TestMain` before any test calls `loadConfigOnce`.

## When to use `os.Args[0]`

`os.Args[0]` is the path to the running test binary. Two uses:

1. Sub-process tests (re-exec the binary with a flag/env to invoke a different code path).
2. Path-relative discovery of test fixtures (`filepath.Dir(os.Args[0])` + relative).

For fixtures, prefer `testdata/` and `t.TempDir()` or use `runtime.Caller(0)` to get the path of the test file. `os.Args[0]` is fine for sub-process; less ideal for fixtures.

## A pitfall: relying on `testing.Verbose`

`testing.Verbose()` returns `true` when `-v` is passed. Some `TestMain` code branches on it:

```go
if testing.Verbose() {
    log.SetLevel(slog.LevelDebug)
}
```

This is fine, but be aware: `-v` is a developer concern (read the output). It is **not** a feature flag for test behavior. Do not skip slow tests based on `-v`; use `-short` for that.

## Combining flags and `testing.Short`

A real test binary often has both built-in `-short` and a custom flag. Use them together:

```go
func TestMain(m *testing.M) {
    flag.Parse()
    if testing.Short() {
        // skip slow setup entirely
        os.Exit(m.Run())
    }
    if *runKafka {
        startKafka()
    }
    os.Exit(m.Run())
}
```

`-short` disables all heavy setup; `-runKafka` selectively enables Kafka. Combinations: `-short` alone (fast unit tests), `-runKafka` (with Kafka tests), nothing (everything).

## Recap

- Call `flag.Parse()` before reading any flag inside `TestMain`.
- Custom flags are package-level `flag.String`/`flag.Bool`/etc. declarations.
- Package variables initialized in `TestMain` are the standard way to share fixtures.
- Pair `TestMain` (package-wide setup) with `t.Cleanup` (per-test teardown).
- Push lifecycle that needs `defer` into a helper that returns normally.
- `t.Parallel` and `TestMain` coexist without ceremony, as long as your shared state is concurrency-safe.
- Pick a test isolation strategy: separate DB per test, transaction per test, or truncate.
- `init` runs before `TestMain`; refactor lazy if you want tests to control init-time state.

The senior page goes deeper into testcontainers patterns, panic recovery, sub-process tests, and how a multi-package monorepo extracts shared `TestMain` logic.

## Appendix: a fully fleshed integration test package

Here is a template that combines everything from this page. Use it as a starting point for a new integration test package:

```go
package mypkg_test

import (
    "context"
    "database/sql"
    "flag"
    "fmt"
    "log"
    "os"
    "testing"

    _ "github.com/mattn/go-sqlite3"
)

var (
    dbURL = flag.String("dburl", "sqlite::memory:", "database URL")
    seed  = flag.Int64("seed", 0, "RNG seed (0=random)")

    sharedDB *sql.DB
)

func TestMain(m *testing.M) {
    flag.Parse()
    log.SetFlags(0)

    var err error
    sharedDB, err = sql.Open("sqlite3", ":memory:")
    if err != nil {
        log.Fatalf("open: %v", err)
    }
    if err := migrate(sharedDB); err != nil {
        log.Fatalf("migrate: %v", err)
    }

    log.Printf("dburl=%s seed=%d", *dbURL, *seed)

    code := m.Run()

    sharedDB.Close()
    os.Exit(code)
}

func migrate(db *sql.DB) error {
    _, err := db.Exec(`CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT)`)
    return err
}

func newTx(t *testing.T) *sql.Tx {
    tx, err := sharedDB.BeginTx(context.Background(), nil)
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { tx.Rollback() })
    return tx
}

func TestInsert(t *testing.T) {
    tx := newTx(t)
    if _, err := tx.Exec("INSERT INTO items(name) VALUES(?)", "alpha"); err != nil {
        t.Fatal(err)
    }
}
```

Copy this, change the SQL, change the package name, and you have a working integration test package with proper isolation, sensible flags, and clean shutdown.

## Edge case: failing setup mid-flight

Consider what happens when setup partially succeeds:

```go
func TestMain(m *testing.M) {
    db := openDB()
    redis := openRedis()  // <-- this fails
    if redis == nil {
        log.Fatal("redis failed")
    }
    // db is leaked
}
```

`log.Fatal` calls `os.Exit(1)`, which skips `db.Close()`. The DB connection is leaked. In a long CI run, you accumulate orphan connections.

The robust pattern: accumulate cleanup as you go.

```go
func TestMain(m *testing.M) {
    cleanups := []func(){}
    defer func() {
        for i := len(cleanups) - 1; i >= 0; i-- {
            cleanups[i]()
        }
    }()

    db, err := openDB()
    if err != nil { log.Fatal(err) }
    cleanups = append(cleanups, func() { db.Close() })

    redis, err := openRedis()
    if err != nil { log.Fatal(err) }
    cleanups = append(cleanups, func() { redis.Close() })

    // ... but defer + log.Fatal still loses cleanup!
}
```

Wait — `log.Fatal` still skips defers. So we need to push everything into a helper:

```go
func TestMain(m *testing.M) {
    os.Exit(run(m))
}

func run(m *testing.M) int {
    var cleanups []func()
    defer func() {
        for i := len(cleanups) - 1; i >= 0; i-- {
            cleanups[i]()
        }
    }()

    db, err := openDB()
    if err != nil {
        fmt.Fprintln(os.Stderr, "openDB:", err)
        return 1
    }
    cleanups = append(cleanups, func() { db.Close() })

    redis, err := openRedis()
    if err != nil {
        fmt.Fprintln(os.Stderr, "openRedis:", err)
        return 1
    }
    cleanups = append(cleanups, func() { redis.Close() })

    return m.Run()
}
```

Now `run` returns normally on error or success; defer fires; cleanups in LIFO order; outer `os.Exit` propagates the code. This is the canonical "robust setup" shape.

## Tracing through `TestMain` with OpenTelemetry

A modern observability setup might add tracing:

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/sdk/trace"
    "go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
)

func TestMain(m *testing.M) {
    exp, _ := stdouttrace.New()
    tp := trace.NewTracerProvider(trace.WithBatcher(exp))
    otel.SetTracerProvider(tp)
    code := m.Run()
    tp.Shutdown(context.Background()) // flush spans
    os.Exit(code)
}
```

Tests then use `otel.Tracer("mypkg")` and `tracer.Start(ctx, "name")`. Spans flow through the exporter; `Shutdown` flushes the batch before exit.

If you omit `Shutdown`, in-flight spans are dropped. The behaviour is silent — your debug spans simply do not appear, and you waste hours wondering why.

## A small library for shared lifecycle

A useful abstraction at middle level: a small "lifecycle" type that you compose in `TestMain`:

```go
type Lifecycle struct {
    closers []func() error
}

func (l *Lifecycle) Add(name string, closer func() error) {
    l.closers = append(l.closers, closer)
}

func (l *Lifecycle) Close() error {
    var firstErr error
    for i := len(l.closers) - 1; i >= 0; i-- {
        if err := l.closers[i](); err != nil && firstErr == nil {
            firstErr = err
        }
    }
    return firstErr
}
```

Usage:

```go
func TestMain(m *testing.M) {
    var lc Lifecycle
    db, _ := openDB()
    lc.Add("db", db.Close)

    rd, _ := openRedis()
    lc.Add("redis", rd.Close)

    code := m.Run()
    lc.Close()
    os.Exit(code)
}
```

Adopting this pattern across packages keeps `TestMain` files tidy.

## Watch out: `t.Setenv` does not work in `TestMain`

`t.Setenv` is per-test; it cannot be called from `TestMain` (no `*testing.T`). For process-wide env changes, use `os.Setenv` in `TestMain`. Tests that want their own value use `t.Setenv` inside themselves. The latter takes precedence.

Note: `os.Setenv` in `TestMain` is permanent for the process; subsequent tests see it unless they explicitly override.

## Subtle: package init runs concurrently with imports

A weird detail: when Go starts a binary, all imported packages' init functions run in dependency order, but multiple packages with no dependency relationship may have their inits run in any order. `TestMain` is guaranteed to run after **all** inits. So you cannot rely on `init` order for cross-package setup; use `TestMain` if order matters.

## Profile your `TestMain`

If startup is slow, profile it. Wrap the setup in CPU profiling:

```go
f, _ := os.Create("setup.prof")
pprof.StartCPUProfile(f)
setup()
pprof.StopCPUProfile()
f.Close()
```

`go tool pprof setup.prof` opens the profile. Identify the slow step; optimize it.

For memory profiles:

```go
runtime.GC()
f, _ := os.Create("setup.heap")
pprof.WriteHeapProfile(f)
f.Close()
```

Open with `go tool pprof setup.heap`. Useful for finding setup that allocates a lot.

These tools are not specific to `TestMain`; they work anywhere. The point is that you can apply them to setup code as easily as to production code.

## Closing thoughts on middle-level `TestMain`

Middle-level mastery is mostly about owning the pattern: knowing when to use a return-normally helper, when to attach cleanups dynamically, when to gate behind flags, when to read env, when to lean on `sync.Once`, when to spread work across goroutines vs. keeping serial. The next page (senior) layers on testcontainers, panic recovery, sub-process tests, goleak integration, and the monorepo helper-package pattern.

## Mini-glossary for middle-level concepts

- **Lifecycle helper** — A small struct or function that owns cleanup registration, called from `TestMain`.
- **Isolation strategy** — How tests avoid each other's state: separate DB, transaction-per-test, truncate-per-test.
- **Lazy fixture** — A `sync.Once`-wrapped resource that is allocated on first request rather than in `TestMain`.
- **Custom test flag** — A `flag.String`/`Bool`/etc. variable defined in a `_test.go` file, parsed at `TestMain` start.
- **Setup error** — An error during `TestMain` setup that prevents tests from running; should produce a clean stderr message and exit 1.
- **Process-wide env** — `os.Setenv` in `TestMain`, visible to all tests in the binary.
- **Per-test env** — `t.Setenv` inside a `TestXxx`, scoped and self-cleaning.

## Practice exercises for middle level

1. Write a `TestMain` that opens a SQLite in-memory database, runs migrations, and exposes it. Verify two tests can share it.
2. Add a `-dburl` flag and switch between SQLite and Postgres testcontainer based on the flag value.
3. Implement the `Lifecycle` helper above and use it for three resources (DB, Redis, HTTP server).
4. Add a `sync.Once`-protected lazy initializer for an expensive cache that only some tests need.
5. Write a test that uses `t.Cleanup` to roll back a transaction; verify the rollback fires by checking row count in a sibling test.

When you can do all five, you have middle-level mastery.

## Diving into `t.Cleanup` semantics

`t.Cleanup` has subtleties worth knowing:

- Cleanups run in LIFO order.
- Cleanups run even if the test fails or panics. They are the test framework's `defer` equivalent.
- Cleanups run before the test's subtests' parents' cleanups (i.e., subtest cleanups complete before the parent's cleanups).
- Cleanups are reported through `t.Log` if they call `t.Log`, but they cannot mark the test as failed retroactively (the result is already locked in).
- Cleanups run on a separate goroutine than the test body. If the cleanup needs to read state set by the test body, ensure proper synchronization (typically not an issue because the test body has returned by then).

A subtle case: if the test body spawns a goroutine that the `t.Cleanup` is supposed to join, you have a race between cleanup and the goroutine completing. Use a `sync.WaitGroup` or a channel.

## Anti-pattern: parallel writes to shared state

```go
var counter int

func TestMain(m *testing.M) {
    counter = 0
    os.Exit(m.Run())
}

func TestA(t *testing.T) { t.Parallel(); counter++ }
func TestB(t *testing.T) { t.Parallel(); counter++ }
```

`counter++` is not atomic. Race detector flags it. Fix with `atomic.AddInt64` or a mutex. Better: do not share mutable counters across tests; each test owns its data.

## Pattern: thread-safe shared resource

Most "shared resources" are already thread-safe by their type:

- `*sql.DB` (uses an internal connection pool)
- `*http.Client` (each request runs independently)
- `*log.Logger` (uses an internal mutex)
- `*prometheus.Registry` (thread-safe by design)
- `*redis.Client` (thread-safe; uses connection pool internally)

So sharing these across parallel tests is fine. The pattern fails for:

- Plain `map[K]V` (use `sync.Map` or a mutex)
- `[]T` (use a mutex)
- Custom structs (audit them; usually need a mutex)

## Going beyond the basics: writing your first helper package

Once you have written three `TestMain` functions in different packages, refactor. The first refactor is usually to a helper:

```go
// internal/testhelp/testhelp.go
package testhelp

import (
    "context"
    "database/sql"
    "fmt"
    "os"
    "testing"

    _ "github.com/mattn/go-sqlite3"
)

func OpenDB(tb testing.TB) *sql.DB {
    tb.Helper()
    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil { tb.Fatalf("sqlite open: %v", err) }
    if err := migrate(db); err != nil { tb.Fatalf("migrate: %v", err) }
    tb.Cleanup(func() { db.Close() })
    return db
}
```

Now any package can use:

```go
func TestThing(t *testing.T) {
    db := testhelp.OpenDB(t)
    // use db
}
```

No `TestMain` needed in the consuming package. `t.Cleanup` handles the close.

The migration to `TestMain` happens when this becomes expensive: if `OpenDB` opens a heavy DB or testcontainer, you do not want to pay per test. Then you add a `TestMain` that initializes a package-level shared instance.

## A reflection on the journey from junior to middle

Junior `TestMain` work is about getting the basics right: signature, `m.Run`, `os.Exit`, `defer`-trap awareness. Middle level adds: flag parsing, custom flags, shared resources, isolation strategies, `t.Cleanup` integration, careful error handling. You have everything you need to write a `TestMain` for any package whose setup costs less than a few seconds.

Senior level adds: testcontainers, panic recovery, sub-process tests, monorepo helpers, observability integration, goroutine leak detection. The shape stays the same; the depth increases.

## Common middle-level mistakes (and fixes)

A few patterns I have seen in real PRs at the middle level:

### Mistake: parsing flags in `init`

```go
func init() {
    flag.StringVar(&dbURL, "dburl", "", "")
    flag.Parse()
}
```

`flag.Parse` in `init` is too early; the testing framework's flags have not been registered yet. The fix: parse only in `TestMain`. Define flags as package-level `flag.String` calls, which are evaluated at init time without parsing.

### Mistake: setting up a goroutine that the tests need to wait for

```go
func TestMain(m *testing.M) {
    go startBackgroundJob()
    os.Exit(m.Run())
}
```

If the background job is needed by tests, the tests may start before it is ready. Fix: use a `sync.WaitGroup` or a "ready" channel:

```go
ready := make(chan struct{})
go func() {
    startBackgroundJob()
    close(ready)
}()
<-ready
os.Exit(m.Run())
```

### Mistake: holding a connection across `m.Run`

```go
var conn *Conn

func TestMain(m *testing.M) {
    conn = openConn()
    os.Exit(m.Run())
}
```

`conn` is never closed. If your server has a connection limit, this matters. Fix: capture-and-close:

```go
code := m.Run()
conn.Close()
os.Exit(code)
```

### Mistake: flag with same name in two packages

If you `go test ./...` runs two packages that both define `-dburl`, each binary has its own flag set, so they do not collide *across binaries*. But if both are imported into a single test binary (which can happen with helper packages), they will collide. Fix: prefix custom flags with the package name (`-mypkg.dburl`).

### Mistake: setup that depends on `os.Getwd`

```go
func TestMain(m *testing.M) {
    data, _ := os.ReadFile("testdata/config.json")
    // ...
}
```

`os.Getwd` during `go test` is the package directory, which is usually fine. But if you `cd` somewhere unusual before `go test`, the relative path breaks. Use a path computed from the test file location:

```go
_, file, _, _ := runtime.Caller(0)
data, _ := os.ReadFile(filepath.Join(filepath.Dir(file), "testdata", "config.json"))
```

Verbose but robust.

### Mistake: ignoring `flag.Parsed`

`flag.Parsed() bool` returns whether `flag.Parse` has been called. Sometimes you call into a helper that may or may not have parsed already. Idempotent guard:

```go
if !flag.Parsed() {
    flag.Parse()
}
```

Safe to call multiple times.

## Beyond the basics: command-line flag conventions

Idiomatic Go test flags:

- `-short`: standard testing flag, request to skip slow tests.
- `-v`: standard testing flag, verbose output.
- `-run`: standard testing flag, regex filter.
- `-count`: standard testing flag, repetitions.
- `-race`: standard testing flag, enable race detector.
- `-cover`, `-coverprofile`: standard testing flags, coverage.
- `-timeout`: standard testing flag, per-test timeout.
- `-cpu`: standard testing flag, sets GOMAXPROCS.
- `-bench`, `-benchmem`, `-benchtime`: benchmark-related.
- `-fuzz`, `-fuzztime`: fuzz-related.

Your custom flags should not collide with these. Common safe prefixes: `-test.*` (but reserved by the testing framework), `-myapp.*`, `-test-*`.

## A pragmatic checklist for any middle-level `TestMain`

Before merging a `TestMain` PR, run through:

1. Is `flag.Parse()` called before any flag read?
2. Is `m.Run()` called exactly once?
3. Is `os.Exit(code)` propagating the run's result?
4. Are setup errors emitted to `stderr` with a clear message?
5. Are all setup resources captured into cleanup logic?
6. Are cleanups in LIFO order?
7. Does the package honor `-short`?
8. Are package-level shared variables goroutine-safe?
9. Is there documentation explaining what `TestMain` sets up?
10. Is the file readable in under two minutes?

Each "no" is a reason to iterate.

Middle-level mastery means writing `TestMain` files that pass this checklist on the first try. With practice, this becomes second nature.

## A note on test caching

`go test` caches results when source files have not changed. The cache key includes the test binary's flag values. If you pass `-dburl=postgres://x` once and `-dburl=postgres://y` the next time, the second run will not be served from cache.

Implications:

- A `TestMain` that reads the current time (e.g., for a seed) does not invalidate the cache (the cache key does not include runtime state).
- A `TestMain` that reads env vars does invalidate the cache when the env changes.
- `-count=1` always invalidates the cache.

For most teams, the cache behavior is fine. The thing to know: if you suspect a stale cache is hiding a test failure, run `go test -count=1`.

## Practical wrap-up

Middle-level `TestMain` is where you stop just writing `os.Exit(m.Run())` and start owning the lifecycle. You add flags, capture cleanups, document the contract, and pair `TestMain` with `t.Cleanup` for layered isolation. You measure setup time and gate behind `-short`. You audit shared state for thread safety.

Senior-level work — testcontainers, sub-process tests, observability — builds on this foundation. If you have read this page and worked through the exercises, you are ready.
