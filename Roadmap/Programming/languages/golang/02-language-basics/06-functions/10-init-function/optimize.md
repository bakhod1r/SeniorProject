# Go init() Function — Optimize

## Instructions

Each exercise presents a wasteful or slow init pattern. Identify the issue, write an optimized version, and explain. Difficulty: Easy, Medium, Hard.

---

## 1. Why init Cost Matters

Every line of `init` runs:
- Once per process, before `main` returns control to user code.
- In serverless / Lambda / Cloud Run, every cold start.
- In every test binary, once per `go test ./...` invocation.
- In every `go run`, every CLI invocation.

For long-running servers, init cost amortizes over the process lifetime — so a few milliseconds usually don't matter. For short-lived processes (CLIs, Lambdas, scripts, batch jobs) and for tests, init cost is paid frequently.

This document is about measuring and reducing it.

---

## Exercise 1 (Easy) — Heavy String Build

**Problem**:
```go
package config

import "strings"

var SQLPrefix string

func init() {
    var b strings.Builder
    for _, k := range allKeys() { // 10000 keys
        b.WriteString("SELECT ")
        b.WriteString(k)
        b.WriteString(" FROM t;\n")
    }
    SQLPrefix = b.String()
}
```

What's wrong from a startup-cost perspective, and how do you optimize?

<details>
<summary>Solution</summary>

**Issue**: 10000 string allocations on every program start, even if `SQLPrefix` is never used. On AWS Lambda this can add 5-50ms to cold start.

**Optimization** — lazy compute:
```go
var (
    onceSQL    sync.Once
    sqlPrefix  string
)

func SQLPrefix() string {
    onceSQL.Do(func() {
        var b strings.Builder
        b.Grow(50 * 10000) // pre-size
        for _, k := range allKeys() {
            b.WriteString("SELECT ")
            b.WriteString(k)
            b.WriteString(" FROM t;\n")
        }
        sqlPrefix = b.String()
    })
    return sqlPrefix
}
```

Two improvements:
1. Pay only when called.
2. `b.Grow` avoids buffer reallocations.

**Benchmark sketch**:
```
BenchmarkInitBuild      1  4500000 ns/op  (bad)
BenchmarkLazyBuild      1     2200 ns/op  (first call after Grow)
BenchmarkLazyBuildHit   1        4 ns/op  (subsequent)
```

**Key insight**: init runs whether the symbol is used or not. Lazy init pays only when a real caller asks.
</details>

---

## Exercise 2 (Easy) — Compiled Regex Pool

**Problem**:
```go
package validate

import "regexp"

var (
    EmailRe = regexp.MustCompile(`^[^@]+@[^@]+\.[^@]+$`)
    PhoneRe = regexp.MustCompile(`^\+?\d{7,15}$`)
    UUIDRe  = regexp.MustCompile(`^[0-9a-f]{8}-...`)
)
```

A program uses only `EmailRe`. Should the others be lazily compiled?

<details>
<summary>Solution</summary>

**Trade-off**:
- Eager (current): 3 compiles at startup, all paid even if unused.
- Lazy: only used regexes compiled, but each call incurs a `sync.Once` check.

For a server that handles all three regularly, eager wins (one-time cost; no per-call sync overhead).
For a CLI that branches and only ever uses one, lazy wins.

**Recommended pattern** for libraries:
```go
var (
    onceEmail sync.Once
    emailRe   *regexp.Regexp
)

func EmailRegex() *regexp.Regexp {
    onceEmail.Do(func() {
        emailRe = regexp.MustCompile(`^[^@]+@[^@]+\.[^@]+$`)
    })
    return emailRe
}
```

**Measurement**: regex compile is ~10-100 µs depending on pattern. For 20 regexes, that's measurable in CLI startup.

**Insight**: Regex compilation is moderately expensive. Decide based on usage pattern.
</details>

---

## Exercise 3 (Medium) — DB Open in init

**Problem**:
```go
package store

import (
    "database/sql"
    _ "github.com/lib/pq"
    "log"
    "os"
)

var DB *sql.DB

func init() {
    var err error
    DB, err = sql.Open("postgres", os.Getenv("DSN"))
    if err != nil {
        log.Fatal(err)
    }
    if err := DB.Ping(); err != nil {
        log.Fatal(err)
    }
}
```

Why is this catastrophic for tests and cold starts? Refactor.

<details>
<summary>Solution</summary>

**Issues**:
1. Every test binary that imports `store` opens a real DB. Unit tests turn into integration tests.
2. `Ping` does a network round-trip — ~10ms even on localhost, hundreds of ms across regions.
3. Missing `DSN` env var = panic before logging is set up.
4. Lambda cold start pays for DB handshake even if the handler never queries.

**Optimization** — lazy:
```go
package store

import (
    "database/sql"
    _ "github.com/lib/pq"
    "errors"
    "os"
    "sync"
)

var (
    once sync.Once
    db   *sql.DB
    dbErr error
)

func DB() (*sql.DB, error) {
    once.Do(func() {
        dsn := os.Getenv("DSN")
        if dsn == "" {
            dbErr = errors.New("DSN not set")
            return
        }
        db, dbErr = sql.Open("postgres", dsn)
        if dbErr == nil {
            dbErr = db.Ping()
        }
    })
    return db, dbErr
}
```

**Result**:
- Tests that don't need DB: 0 ms init cost.
- Production callers: same total cost, paid on first request.
- Errors are returned, not fatal.

**Measurement (rough)**:
```
Init-based:   500 µs init + ~10 ms DB Ping
Lazy:         <1 µs init; ~10 ms on first DB() call
```

For an API with steady traffic, both look the same after warm-up. For batch jobs and tests, lazy is dramatically better.
</details>

---

## Exercise 4 (Medium) — Unused Driver Imports

**Problem**:
```go
import (
    _ "github.com/lib/pq"
    _ "github.com/go-sql-driver/mysql"
    _ "github.com/microsoft/go-mssqldb"
    _ "github.com/mattn/go-sqlite3"
)
```

The application only uses Postgres. What's wasted?

<details>
<summary>Solution</summary>

**Costs**:
- Binary size: each driver adds 1-5 MB.
- Init time: each driver registers itself, allocates internal state. mssqldb in particular allocates connection pool buffers.
- Cold-start (Lambda): ~5-20 ms across all four.
- Memory footprint at startup: tens of MB of driver code/data resident.

**Fix**: only import what you use.
```go
import _ "github.com/lib/pq"
```

For multi-database support, use **build tags**:
```go
// File: db_postgres.go
//go:build postgres
package db
import _ "github.com/lib/pq"

// File: db_mysql.go
//go:build mysql
package db
import _ "github.com/go-sql-driver/mysql"
```

Build with: `go build -tags=postgres ./...`

**Measurement**: a stripped binary went from 18 MB to 12 MB by removing 3 unused drivers; cold start dropped from 240 ms to 180 ms.

**Insight**: blank imports are not free. They add code, data, and init time to the binary.
</details>

---

## Exercise 5 (Medium) — File Read in init

**Problem**:
```go
package keys

var PublicKey []byte

func init() {
    data, err := os.ReadFile("/etc/myapp/pub.key")
    if err != nil { log.Fatal(err) }
    PublicKey = data
}
```

What goes wrong, and how do you optimize?

<details>
<summary>Solution</summary>

**Issues**:
- Tests fail in containers without that file.
- Slow on Lambda (cold-start file read).
- Cannot inject a different key for testing.

**Optimization 1 — embed**:
```go
import _ "embed"

//go:embed pub.key
var PublicKey []byte
```

Compile-time inclusion. Zero runtime I/O. Tests work everywhere.

**Optimization 2 — explicit Setup**:
```go
var PublicKey []byte
func Setup(path string) error {
    data, err := os.ReadFile(path)
    if err != nil { return err }
    PublicKey = data
    return nil
}
```

`main` calls `Setup`, tests inject test keys.

**Measurement**:
```
init+ReadFile:   ~100 µs (warm) / ~5 ms (cold cache)
//go:embed:      0 µs (data is in the binary's data segment)
```

**Insight**: For static data, prefer `//go:embed` over file reads in init. For dynamic data, prefer explicit setup.
</details>

---

## Exercise 6 (Hard) — Lazy Goroutine Pool

**Problem**:
```go
package workers

var pool chan job

func init() {
    pool = make(chan job, 100)
    for i := 0; i < 16; i++ {
        go worker(pool)
    }
}
```

Tests that import `workers` accidentally start 16 goroutines. Some hang the test runner. Refactor.

<details>
<summary>Solution</summary>

```go
package workers

import "sync"

type Pool struct {
    ch chan job
}

func NewPool(workers, queue int) *Pool {
    p := &Pool{ch: make(chan job, queue)}
    for i := 0; i < workers; i++ {
        go p.worker()
    }
    return p
}

func (p *Pool) worker() { for j := range p.ch { j() } }
func (p *Pool) Submit(j job) { p.ch <- j }
func (p *Pool) Close() { close(p.ch) }
```

`main` creates the pool, tests don't unless they need it.

**Bonus** — if you want a default singleton:
```go
var (
    onceDefault sync.Once
    defaultPool *Pool
)

func Default() *Pool {
    onceDefault.Do(func() { defaultPool = NewPool(16, 100) })
    return defaultPool
}
```

**Measurement**:
```
init pool:  goroutines created at program start = 16
lazy pool:  goroutines = 0 until Default() called
```

In a test suite of 200 packages, eliminating init-time goroutine spawns can drop test runtime by 30-40%.

**Insight**: Goroutines started in init are global state. They have lifetimes longer than any test should require.
</details>

---

## Exercise 7 (Hard) — Reflective Type Registration

**Problem**:
```go
package codec

import "reflect"

var registry = map[reflect.Type]Codec{}

func init() {
    Register(reflect.TypeOf(User{}), userCodec)
    Register(reflect.TypeOf(Order{}), orderCodec)
    Register(reflect.TypeOf(Invoice{}), invoiceCodec)
    // ... 200 types
}
```

How do you reduce init cost?

<details>
<summary>Solution</summary>

**Issue**: 200 calls to `reflect.TypeOf` and 200 map inserts. ~200 µs typical.

**Optimization 1** — split per file:
Move groups to separate files, each with its own `init`. The total work is the same, but it parallelizes better with build-time `pgo` and improves locality.

**Optimization 2** — code generation:
A generator emits a single literal map:
```go
var registry = map[reflect.Type]Codec{
    typeUser:    userCodec,
    typeOrder:   orderCodec,
    typeInvoice: invoiceCodec,
    // ...
}
var typeUser = reflect.TypeOf((*User)(nil)).Elem()
```
Now init is reduced to var initializers, which are themselves still O(N) but slightly faster (no function call per entry, no nil-check on the map).

**Optimization 3** — lazy:
```go
func Codec(t reflect.Type) Codec {
    onceRegistry.Do(buildRegistry)
    return registry[t]
}
```

For 200 types, eager is fine. The optimization mainly matters when N grows to thousands and only a subset is used.

**Measurement** (200 types):
```
init eager:        180 µs
init eager (genmap): 100 µs
lazy:              <1 µs init, then 100 µs on first Codec call
```

**Insight**: For very large registries, code generation reduces init cost.
</details>

---

## Exercise 8 (Hard) — Init Cycle Detection

**Problem**:
You suspect there's an init cycle in a large project. What tools and techniques can you use?

<details>
<summary>Solution</summary>

**Static analysis**:
- `go build` will detect var-init cycles (`initialization cycle: x refers to y`).
- `go vet` doesn't catch init-function dependencies (those aren't analyzed).

**Runtime debugging**:
- Add log lines: `func init() { log.Println("foo init") }` in each suspect package. The output shows exact order.
- Use `go build -gcflags='-m=2'` to see escape analysis (sometimes hints at init-time allocations).
- Use `go tool nm` and `go tool objdump` to find init symbols and their order.

**Visualization**:
```bash
go list -deps ./... | head    # list dependencies
goda graph github.com/me/proj  # visualize package graph
```

**Eliminating cycles**:
- Restructure so that A and B share a common dependency C, and C is what registers things.
- Use `sync.Once` to defer the dependent work until both are ready.

**Measurement**: There's no direct "init time" pprof. Approximate by:
```go
import "time"
func init() {
    t := time.Now()
    setup()
    log.Printf("init took %v", time.Since(t))
}
```

Or wrap `main` with a startup-only profile:
```go
import "runtime/pprof"
// ... start cpu profile in main, trigger work, stop
```

Production teams sometimes ship a debug build that timestamps each init call; the diff identifies hot spots.
</details>

---

## Exercise 9 (Hard) — Cold Start in Serverless

**Scenario**: AWS Lambda function, Go runtime. Cold start budget: 200 ms.

Your handler imports:
- `database/sql` + `lib/pq` (60 ms init)
- `aws-sdk-go-v2/service/dynamodb` (40 ms init for client setup)
- `prometheus/client_golang` (20 ms registering default collectors)
- Your own packages (50 ms validating in-memory tables)

Cold start = 170 ms. Tight. How do you reduce?

<details>
<summary>Solution</summary>

**Strategies**:

1. **Lazy DB**: don't open postgres until first request that needs it.
   - Saves ~60 ms cold start (Lambda invocations not needing DB pay nothing).

2. **Lazy AWS clients**: AWS SDK v2 supports lazy config. Initialize the client struct, defer auth until first call.
   - Saves ~30 ms.

3. **Drop unused metrics**: replace `client_golang` with a custom lightweight registry that doesn't pre-collect 20 standard metrics.
   - Saves ~15 ms.

4. **Move table validation to a test**: the validation catches programmer bugs at CI time. In production, just trust the binary.
   - Saves ~50 ms.

After optimization: ~15 ms cold start.

**Measurement**:
```
                   Cold start (ms)
Before              170
+ Lazy DB           110
+ Lazy AWS           80
+ Lighter metrics    65
+ No init validate   15
```

**Insight**: Cold-start budgets force you to confront every init line. The same techniques (lazy initialization, avoiding I/O, code generation) all apply.
</details>

---

## Exercise 10 (Hard) — Init for Binary Size

**Problem**: A CLI binary is 35 MB. You run `go tool nm -size <binary> | sort -n -k 1 | tail -50` and see most space is taken by code reachable only from inits.

How do you reduce binary size by removing init dead code?

<details>
<summary>Solution</summary>

**Investigation**:
```bash
go tool nm -size ./bin | awk '$3 ~ /\.init/' | sort -n -k 1
```

This lists init functions by code size. Common offenders:
- Driver inits that pull in entire driver code paths.
- Reflection-heavy init that retains reflect metadata.
- `expvar`/`pprof` (small, but not free).

**Reduction techniques**:
1. **Build tags**: gate driver imports behind tags, build per-target.
2. **Replace reflection-based codecs with code-generated codecs**: generated code is smaller and faster than reflect at runtime.
3. **Audit transitive imports**: `go list -deps ./... | wc -l`. Remove unneeded packages.
4. **`-ldflags="-s -w"`**: strips symbol and DWARF tables (not init-specific, general size win).
5. **`-trimpath`**: removes path strings (small win).
6. **Use `go build -gcflags="-m"` and look for "leaking" or "escapes" in init**: large init heap allocations bloat the data segment.

**Result**: removed unused drivers and reflection code, binary went from 35 MB to 22 MB.

**Insight**: `init` dead code reachability often inflates binaries. Treat blank imports as a first-class build artifact.
</details>

---

## Cheat Sheet — Optimization Patterns

| Issue | Fix |
|------|-----|
| Heavy init for unused work | Move to `sync.Once` lazy |
| Static file in init | `//go:embed` |
| DB open in init | `sync.Once` + return error |
| Multiple unused drivers | Build tags |
| Reflection-heavy init | Code generation |
| Goroutines in init | Move to explicit `Start()` |
| Many small inits | Acceptable; runs in source order |
| Cold start budget | Lazy everything; measure with timestamps |
| Binary size | Drop blank imports; `-ldflags="-s -w"` |
| Tests slow | Find init-time I/O and lazy it |

You now have measurement-driven techniques for init optimization. The find-bug document teaches recognition of init bugs.
