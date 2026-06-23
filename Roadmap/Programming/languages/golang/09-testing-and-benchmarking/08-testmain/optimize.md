---
layout: default
title: TestMain — Optimize
parent: TestMain Function
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/08-testmain/optimize/
---

# TestMain — Optimize

[← Back](../)

The whole point of `TestMain` is amortizing setup. If a test binary launches a Postgres container, runs migrations, seeds 50k rows, and spends 12 seconds doing it, you do not want to pay that 12 seconds per test — you want to pay it once per package and let every `TestXxx` reuse the warm fixture. Optimizing `TestMain` therefore boils down to: do expensive work once, do it lazily when possible, parallelize independent setup, and tear down in a way that does not block the developer feedback loop.

This page walks through every lever you have. Pick the ones that move the needle for *your* suite — measure first.

## Measure first

You cannot optimize what you have not measured. Add timing logs around each setup step:

```go
func TestMain(m *testing.M) {
    flag.Parse()
    t := time.Now()
    setupDB()
    log.Printf("setupDB: %s", time.Since(t))

    t = time.Now()
    setupRedis()
    log.Printf("setupRedis: %s", time.Since(t))

    t = time.Now()
    code := m.Run()
    log.Printf("m.Run: %s", time.Since(t))

    t = time.Now()
    teardown()
    log.Printf("teardown: %s", time.Since(t))

    os.Exit(code)
}
```

Run `go test -v` and read the timestamps. You will usually find one step dominates — that is your target. Optimizing anything else first is wasted effort.

For CI, dump the same data as JSON so you can graph it over time:

```go
log.Printf(`{"step":"setupDB","ms":%d}`, time.Since(t).Milliseconds())
```

A simple grep on the CI log feeds your dashboard.

## Lazy setup with `sync.Once`

`TestMain` is the natural place to set up shared state, but if half your tests skip when `-short` is passed, you are paying for setup you do not need. Guard with `sync.Once`:

```go
var (
    dbOnce sync.Once
    db     *sql.DB
    dbErr  error
)

func getDB(t *testing.T) *sql.DB {
    t.Helper()
    dbOnce.Do(func() {
        db, dbErr = openTestDB()
    })
    if dbErr != nil {
        t.Fatalf("db: %v", dbErr)
    }
    return db
}
```

Now tests pay only when they ask. `TestMain` shrinks to flag parsing plus a deferred cleanup that closes `db` if it was opened:

```go
func TestMain(m *testing.M) {
    flag.Parse()
    code := m.Run()
    if db != nil {
        db.Close()
    }
    os.Exit(code)
}
```

If no test calls `getDB`, the function and its setup cost vanish. This is the single biggest win for packages where some tests are heavy and some are not.

## Parallel setup

If you need both a Postgres container and a Redis container, start them concurrently with `errgroup`:

```go
g, ctx := errgroup.WithContext(context.Background())
var pgDSN, redisAddr string
g.Go(func() error {
    pg, err := postgres.Run(ctx, "postgres:16")
    if err != nil { return err }
    pgDSN, err = pg.ConnectionString(ctx, "sslmode=disable")
    return err
})
g.Go(func() error {
    rd, err := redis.Run(ctx, "redis:7")
    if err != nil { return err }
    redisAddr, err = rd.Endpoint(ctx, "")
    return err
})
if err := g.Wait(); err != nil {
    log.Fatal(err)
}
```

Two 8-second startups overlap into 8 seconds wall clock instead of 16. Generalizes to N independent resources — wall clock approaches `max(startup_i)` minus any contention on shared Docker daemon resources.

Beware: if your CI runner has only 2 GB of RAM and your containers need 1.5 GB each, parallel startup can OOM. Profile, do not assume.

## Reuse containers across runs

Testcontainers-go supports the `reuse` option and Ryuk-managed labels. Tag the container with a stable name; subsequent `go test` invocations attach to the running container instead of starting a new one:

```go
pg, err := postgres.Run(ctx, "postgres:16",
    testcontainers.WithReuse(true),
    testcontainers.WithName("myapp-test-pg"),
)
```

Local dev iteration drops from 10 seconds to 1 second per run. CI still starts cold but pays once per job. The container persists across runs until you `docker rm` it manually or until Ryuk reaps it after an inactivity timeout.

Caveat: schema drift. If migrations changed between runs, the reused container has the old schema. Add an idempotent migration step in `TestMain`:

```go
if err := goose.Up(db, "migrations"); err != nil {
    log.Fatalf("migrate: %v", err)
}
```

`goose.Up` is a no-op when migrations are already applied, so the cost is one round-trip.

## Skip `-short` setup entirely

```go
func TestMain(m *testing.M) {
    flag.Parse()
    if !testing.Short() {
        teardown := setupDB()
        defer teardown()
    }
    os.Exit(m.Run())
}
```

`go test -short ./...` skips both the heavy `TestMain` work and any tests guarded by `if testing.Short() { t.Skip() }`. Pre-push hook fast, full CI thorough.

The trade-off: the test binary is now sensitive to a flag. If a developer forgets `-short` they pay the full cost. Make `-short` the default for local runs via a `Makefile`:

```makefile
test:
	go test -short ./...

test-full:
	go test ./...
```

## Cache migrations

Running 200 migrations on every test run is wasteful. Two options:

**Option A: build a base image.** Build a Docker image where migrations have already been applied, then start that image in `TestMain`:

```dockerfile
FROM postgres:16
COPY migrations/ /docker-entrypoint-initdb.d/
```

`docker build -t myapp-test-db .` once, then `postgres.Run(ctx, "myapp-test-db")`. CI cache hits make this nearly free.

**Option B: snapshot the migrated database.** Run migrations into a `template` database, then for each test run `CREATE DATABASE testdb TEMPLATE template_migrated`. Postgres copies the data block-for-block in seconds rather than re-running every DDL statement.

Option B scales better when migrations are slow (hundreds of statements with index builds).

## Profile `TestMain` itself

If `go test` feels slow before the first `=== RUN` line, the bottleneck is `TestMain`. Add timing logs, then escalate to CPU profiling:

```go
func TestMain(m *testing.M) {
    f, _ := os.Create("startup.prof")
    pprof.StartCPUProfile(f)
    setup()
    pprof.StopCPUProfile()
    f.Close()
    os.Exit(m.Run())
}
```

Open the profile: `go tool pprof startup.prof`. Identify the slow step, then attack it. Common culprits: TLS handshakes against slow DNS, image pulls from a far-away registry, schema creation with many indexes.

## Async teardown

Teardown that takes 5 seconds delays your prompt. If teardown is just "container will be reaped by Ryuk anyway", skip the synchronous wait:

```go
go cleanup() // best-effort, do not block exit
os.Exit(code)
```

Use with care — only for resources that are externally garbage-collected. Otherwise you leak.

A more disciplined version: run teardown with a hard deadline. If teardown exceeds the deadline, give up and exit anyway:

```go
done := make(chan struct{})
go func() {
    cleanup()
    close(done)
}()
select {
case <-done:
case <-time.After(2 * time.Second):
    log.Println("teardown timed out")
}
os.Exit(code)
```

## Smaller process count

`go test ./...` runs one binary per package. Twenty packages each starting their own Postgres container is twenty Postgres containers. Either share via env (`DB_URL` set once at the shell level pointing to a long-running container) or consolidate integration tests into a single package whose `TestMain` runs the heavy setup.

A common pattern: `integration` package containing `TestPostgres`, `TestRedis`, `TestEnd2End` as subtests of one `TestIntegration`. The `TestMain` runs once. Unit tests in other packages have no `TestMain` and run instantly.

## Reuse goroutines, avoid `runtime.GC()`

The classic `runtime.GC()` before `os.Exit` flushes finalizers but adds latency (the GC pause is small for small heaps, but two calls can add 10-50ms). Only call it when you actually need finalizer-driven cleanup (rare). For most code, skip it.

## Watch the `-cover` overhead

Coverage instrumentation slows test binaries by 5-20%. Run plain `go test` during inner-loop development; reserve `-cover` for the CI job that publishes coverage. `TestMain` setup is unaffected by `-cover` mode (the framework does not instrument syscalls), but the overall test budget matters.

If you must use `-cover` in inner-loop runs, the `-covermode=set` is fastest. `-covermode=count` and `-covermode=atomic` track hit counts and add atomic ops respectively.

## Cache the test binary

`go test` caches results when source has not changed. The cache key includes flags. Passing `-count=1` invalidates the cache; do not use it unless you actually want a fresh run. A common mistake is making `-count=1` the project default, which kills the cache benefit.

Documented pattern in your team `Makefile`:

```makefile
test:
	go test ./...

retest:
	go test -count=1 ./...
```

## Persistent test databases (template pattern)

Postgres supports the `TEMPLATE` clause. Apply migrations once to `template_migrated`, then for each test database:

```sql
CREATE DATABASE test_t1 TEMPLATE template_migrated;
```

The copy is fast (block-level) regardless of how many migrations were run. `TestMain` does:

```go
exec("CREATE DATABASE IF NOT EXISTS template_migrated;")
applyMigrations("template_migrated") // idempotent
```

Each test that needs an isolated DB calls:

```go
func newTestDB(t *testing.T) *sql.DB {
    name := "test_" + uniq()
    adminDB.Exec("CREATE DATABASE " + name + " TEMPLATE template_migrated")
    t.Cleanup(func() { adminDB.Exec("DROP DATABASE " + name) })
    return sql.Open("postgres", dsnFor(name))
}
```

Per-test DB creation drops from "wait for migrations" (seconds) to "wait for CREATE DATABASE" (~50ms). Parallelism is safe and isolation is total.

## Container pre-pull

CI runners often start cold. Pulling the Postgres image takes 5-15 seconds. Pre-pull in a separate step before `go test`:

```yaml
# .github/workflows/ci.yml
- name: pull images
  run: docker pull postgres:16 redis:7
- name: test
  run: go test ./...
```

The pull runs while other CI work is happening; by the time `go test` starts, the image is local.

## Skip teardown in CI

Some CI environments are ephemeral — the runner is destroyed after the job. In that case, teardown is wasted effort:

```go
inCI := os.Getenv("CI") != ""
defer func() {
    if !inCI {
        pg.Terminate(ctx)
    }
}()
```

The container dies with the runner; you save a few seconds per package.

## Connection pool sizing

`*sql.DB` has a pool. Default `MaxOpenConns` is 0 (unlimited), `MaxIdleConns` is 2. For tests, set `MaxOpenConns` to a known value matching `t.Parallel` density:

```go
db.SetMaxOpenConns(10)
db.SetMaxIdleConns(10)
db.SetConnMaxLifetime(0) // no rotation in tests
```

Without this, a parallel test suite can open 100 connections, exhaust Postgres limits, and fail mysteriously.

## Compile-time flags

If your code has feature flags that affect setup (e.g., expensive in-memory caches that warm on startup), expose them as build tags or flag values you can disable in tests:

```go
//go:build !testheavycache

package mypkg

func init() {
    preloadCache() // expensive
}
```

Test binaries built with `-tags testheavycache` skip the init. Or simpler: a runtime env var.

## A measurement-driven mindset

Optimization without measurement is theater. The shape of a good `TestMain` optimization session:

1. Run `go test` baseline. Time it.
2. Identify the slowest step by instrumented logging.
3. Apply one optimization.
4. Re-run. Time it. Confirm improvement.
5. Move to the next step.

Skipping step 4 produces cargo-cult optimizations that may slow things down. Container reuse is not free if it adds 100ms to detect the existing container; container pre-pull is not free if you do not actually rebuild often. Measure.

## Bottom line

Optimize `TestMain` like you would optimize any other startup path: measure, parallelize independent steps, cache across runs, lazy-init when possible, and tear down asynchronously when safe. The reward — sub-second `go test` even for integration suites — pays for itself many times per day.

For most teams the high-impact moves are: (1) Postgres template pattern, (2) testcontainers reuse, (3) errgroup-parallel setup, (4) `-short` gating. Implement those three or four levers and your integration suite will feel like a unit suite.
