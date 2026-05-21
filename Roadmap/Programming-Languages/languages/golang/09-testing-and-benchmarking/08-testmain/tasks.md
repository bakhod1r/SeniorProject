---
layout: default
title: TestMain — Tasks
parent: TestMain Function
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/08-testmain/tasks/
---

# TestMain — Tasks

[← Back](../)

Hands-on exercises that build a working understanding of `TestMain`. Do them in order; each one introduces one concept. Each task is small enough to finish in 10–30 minutes; together they cover the full surface area.

## Task 1 — Minimal `TestMain`

Create a package `mathutil` with a function `Sum(a, b int) int`. Write `mathutil_test.go` containing a `TestSum` and a `TestMain` that prints `"setup"` before `m.Run` and `"teardown"` after.

```go
package mathutil

func Sum(a, b int) int { return a + b }
```

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
        t.Errorf("Sum(2,3) wrong")
    }
}
```

Run `go test -v`. Confirm you see `setup`, then `--- PASS: TestSum`, then `teardown`, in that order.

Now remove `os.Exit(code)` entirely and re-run. Note that since Go 1.15 the test still reports correctly. Add a deliberately failing test and confirm the binary exits non-zero.

## Task 2 — Demonstrate the `defer + os.Exit` bug

In the same package, write:

```go
func TestMain(m *testing.M) {
    defer fmt.Println("teardown")
    os.Exit(m.Run())
}
```

Run and observe that `teardown` is **not** printed. Now refactor to capture the code, call the cleanup, then exit. Confirm `teardown` prints again. Explain in a comment why `defer` did not fire.

Bonus: refactor a third time using the helper-function pattern:

```go
func TestMain(m *testing.M) {
    os.Exit(run(m))
}
func run(m *testing.M) int {
    defer fmt.Println("teardown")
    return m.Run()
}
```

Confirm `teardown` prints. Explain why this works while the original did not.

## Task 3 — Add a custom flag

Add a top-level test flag:

```go
var dbURL = flag.String("dburl", "memory://", "database URL for tests")
```

In `TestMain`, after `flag.Parse()`, log the value. Run `go test -dburl=postgres://localhost/test -v` and confirm the value is observed. Then run without the flag and confirm the default `memory://` is used.

Now move the `flag.Parse()` call to *after* the `log.Printf` line. Re-run with `-dburl=...`. Observe that the printed value is always the default. This demonstrates why parse-before-read is mandatory.

## Task 4 — Gate setup on `-short`

Add a "slow" setup step (a `time.Sleep(2*time.Second)`) and skip it when `-short` is passed:

```go
func TestMain(m *testing.M) {
    flag.Parse()
    if !testing.Short() {
        time.Sleep(2 * time.Second) // simulated heavy setup
    }
    os.Exit(m.Run())
}
```

Time `go test` and `go test -short`. Confirm `-short` is approximately 2 seconds faster.

## Task 5 — Shared `*sql.DB`

Use `mattn/go-sqlite3` or `glebarez/go-sqlite` to open an in-memory database in `TestMain`, run a CREATE TABLE, and expose it via a package-level `var db *sql.DB`. Write two tests that insert and query. Verify both see the same table.

```go
var db *sql.DB

func TestMain(m *testing.M) {
    var err error
    db, err = sql.Open("sqlite3", ":memory:")
    if err != nil { fail(err) }
    if _, err := db.Exec(`CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
        fail(err)
    }
    code := m.Run()
    db.Close()
    os.Exit(code)
}

func TestInsert(t *testing.T) {
    if _, err := db.Exec("INSERT INTO items(name) VALUES(?)", "alpha"); err != nil {
        t.Fatal(err)
    }
}

func TestQuery(t *testing.T) {
    var n int
    if err := db.QueryRow("SELECT COUNT(*) FROM items").Scan(&n); err != nil {
        t.Fatal(err)
    }
    t.Logf("rows: %d", n)
}
```

Add a deferred `db.Close()` (using the capture-and-exit pattern). Notice how `TestQuery` depends on `TestInsert` running first; this exposes the order-coupling that `TestMain`-shared state can produce. Discuss in comments how to fix (per-test transactions, separate test DBs, etc.).

## Task 6 — Sub-process integration test

Write a `cmd/greet` binary that prints `Hello, $1`. In its `cmd/greet/main_test.go`, define a `TestMain` that branches on an env var to run the binary's `main` function. This pattern lets you exercise the actual `main` function under coverage. Reference: `src/os/exec/exec_test.go` in the Go source.

```go
func TestMain(m *testing.M) {
    if os.Getenv("BE_GREETER") == "1" {
        main()
        os.Exit(0)
    }
    os.Exit(m.Run())
}

func TestGreet(t *testing.T) {
    cmd := exec.Command(os.Args[0], "World")
    cmd.Env = append(os.Environ(), "BE_GREETER=1")
    out, err := cmd.CombinedOutput()
    if err != nil { t.Fatal(err) }
    if strings.TrimSpace(string(out)) != "Hello, World" {
        t.Errorf("got %q", out)
    }
}
```

## Task 7 — Testcontainers Postgres

Using `github.com/testcontainers/testcontainers-go/modules/postgres`, start a Postgres 16 container in `TestMain`. Run migrations once. Expose the DSN as a package var. Write one test that inserts a row and one that queries it. Terminate the container after `m.Run`. Measure first-run time vs subsequent runs.

```go
var dsn string

func TestMain(m *testing.M) {
    code := func() int {
        ctx := context.Background()
        pg, err := postgres.Run(ctx, "postgres:16")
        if err != nil { fmt.Fprintln(os.Stderr, err); return 1 }
        defer pg.Terminate(ctx)
        dsn, _ = pg.ConnectionString(ctx, "sslmode=disable")
        if err := runMigrations(dsn); err != nil { return 1 }
        return m.Run()
    }()
    os.Exit(code)
}
```

## Task 8 — Coverage of init paths

Add an `init` function to your library that registers a driver. Run `go test -coverprofile c.out -covermode atomic`. Open `c.out` and confirm the `init` lines have hit counts greater than zero. Explain in comments why `TestMain` is enough to trigger init coverage even when no test calls the registered driver.

```go
func init() {
    sql.Register("mydriver", &myDriver{})
}
```

After `go test -coverprofile c.out`, run `go tool cover -func c.out` and confirm the `init` function shows non-zero coverage.

## Task 9 — Parallel container startup

Set up both Postgres and Redis containers concurrently using `golang.org/x/sync/errgroup`. Measure wall-clock time. Confirm it is closer to `max(startupP, startupR)` than `startupP + startupR`.

```go
g, ctx := errgroup.WithContext(context.Background())
g.Go(func() error { return startPostgres(ctx) })
g.Go(func() error { return startRedis(ctx) })
if err := g.Wait(); err != nil {
    log.Fatal(err)
}
```

## Task 10 — Reuse pattern

In Testcontainers, set `Reuse: true` and a stable container name. Run `go test` twice in succession and confirm the second run does not start a new container. Time both runs.

```go
pg, err := postgres.Run(ctx, "postgres:16",
    testcontainers.WithName("myapp-test-pg"),
    testcontainers.CustomizeRequest(testcontainers.GenericContainerRequest{
        ContainerRequest: testcontainers.ContainerRequest{
            Name: "myapp-test-pg",
        },
        Reuse: true,
    }),
)
```

## Task 11 — Logging through `TestMain`

Initialize `slog` with a JSON handler writing to `os.Stderr` in `TestMain`. Have every test call `slog.Info` with a fixed message. Run with `go test -v` and confirm log lines are interleaved with `--- PASS` output. Now switch the handler to write to a buffer that you flush after `m.Run`. Reason about which approach is more debugger-friendly.

## Task 12 — Panic recovery

Wrap `m.Run()` in a recover:

```go
func TestMain(m *testing.M) {
    code := func() (c int) {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("panic in TestMain: %v", r)
                c = 1
            }
        }()
        return m.Run()
    }()
    cleanup()
    os.Exit(code)
}
```

Verify cleanup still runs when a test panics. (Tests that panic are already reported as failed; this exercise is purely about teardown.)

## Task 13 — Multiple flag groups

Define three custom flags: `-redis=...`, `-postgres=...`, `-kafka=...`. Build a `setup()` that reads the URLs and only initializes the resources that were provided. Write tests that skip when the relevant resource is missing.

```go
var (
    redisURL    = flag.String("redis", "", "redis URL")
    postgresURL = flag.String("postgres", "", "postgres URL")
    kafkaURL    = flag.String("kafka", "", "kafka URL")
)

func TestRedis(t *testing.T) {
    if *redisURL == "" { t.Skip("no -redis flag") }
    // ...
}
```

## Task 14 — Run a test binary directly

Build with `go test -c -o mathutil.test`. Execute `./mathutil.test -test.v -test.run TestSum -dburl=memory://`. Observe that all flags work outside `go test`. Useful for debugging under `dlv exec`.

## Task 15 — `goleak` integration

Add `go.uber.org/goleak` and replace `os.Exit(m.Run())` with `goleak.VerifyTestMain(m)`. Add a test that leaks a goroutine:

```go
func TestLeak(t *testing.T) {
    go func() {
        time.Sleep(10 * time.Second)
    }()
}
```

Confirm `go test` reports the leak and exits non-zero. Now `t.Cleanup` a `close(done)` and `<-done` in the goroutine to fix the leak. Confirm tests pass.

## Task 16 — Shared `TestMain` helper

Create `internal/testsupport/testsupport.go`:

```go
package testsupport

func Run(m *testing.M) int {
    flag.Parse()
    fmt.Println("[testsupport] setup")
    code := m.Run()
    fmt.Println("[testsupport] teardown")
    return code
}
```

Use it from two different packages:

```go
func TestMain(m *testing.M) {
    os.Exit(testsupport.Run(m))
}
```

Confirm both packages share the same setup/teardown message.

## Task 17 — Read the generated `_testmain.go`

Run `go test -work -c -o /dev/null ./yourpkg`. The output prints a `WORK=...` directory. Open the directory's `_testmain.go`. Find the line that calls your `TestMain`. Observe how `testing.MainStart` is invoked and how the test/benchmark slices are populated.

## Task 18 — `runtime.GC` before exit

Write a test that uses `runtime.SetFinalizer`. Without a `runtime.GC` call in `TestMain`, the finalizer may not run before exit, and your test cannot verify it. Add `runtime.GC(); runtime.GC()` between `m.Run` and `os.Exit`. Re-run; confirm the finalizer fires.

## Task 19 — CI shape

Add a `Makefile` with three targets: `test` (`-short`), `test-full`, and `test-integration` (uses build tag `//go:build integration`). Convert one heavy test to require the build tag. Confirm `make test` runs in 1 second while `make test-full` runs the full suite.

## Task 20 — Refactor an open-source `TestMain`

Find a `TestMain` in a real Go project (search GitHub for `func TestMain(m *testing.M)`). Read it, identify what setup it does, and rewrite it in your own words. Compare your version against the original — which is cleaner? Why?

When you finish all 20 tasks, you should be comfortable reading, writing, and debugging any `TestMain` you encounter in a production Go codebase.
