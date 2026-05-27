# Singleton Pattern — Optimization

## 1. How to use this file

Twelve scenarios where singleton code costs more than it should. Each:

- **Scenario** — the inefficiency.
- **Before** — measured-slow code with realistic benchmark numbers.
- **After** (collapsible) — optimised version with benchmark comparison.
- **Why faster** — what changed at the runtime level.
- **Trade-offs** — what you lose by optimising.
- **When NOT to do this** — the cases where the optimisation isn't worth it.

Singletons sit on the hot path of nearly every Go service: a logger, a config, a DB pool, a metrics registry. The access function gets called millions of times per second. Even a 5 ns saving on `Get()` multiplied by `1e7` QPS is 50 ms of CPU per second — half a core. So unlike adapters, singleton micro-optimisations frequently *do* pay back.

But the inverse is also true: a misplaced atomic or a `sync.Map` where a `sync.RWMutex` would do can turn `Get()` into the bottleneck of a whole service. The right answer is almost always "the cheapest primitive that still gives the guarantees you need".

Benchmarks are illustrative — your numbers will differ. The qualitative direction (faster vs slower, allocs vs no allocs) is more important than the absolute ns/op.

Go 1.22, amd64, GOMAXPROCS=8.

---

## 2. Table of Contents

1. [How to use this file](#1-how-to-use-this-file)
2. [Table of Contents](#2-table-of-contents)
3. [Exercise 1 — Mutex on every access](#exercise-1--mutex-on-every-access)
4. [Exercise 2 — Eager init in init() blocks startup](#exercise-2--eager-init-in-init-blocks-startup)
5. [Exercise 3 — sync.Once when the value is always needed](#exercise-3--synconce-when-the-value-is-always-needed)
6. [Exercise 4 — sync.Map for shared singleton state](#exercise-4--syncmap-for-shared-singleton-state)
7. [Exercise 5 — Hot-reload with full lock](#exercise-5--hot-reload-with-full-lock)
8. [Exercise 6 — Singleton called from a hot loop](#exercise-6--singleton-called-from-a-hot-loop)
9. [Exercise 7 — Global mutex for a read-heavy field](#exercise-7--global-mutex-for-a-read-heavy-field)
10. [Exercise 8 — PGO devirtualization of singleton-returning factory](#exercise-8--pgo-devirtualization-of-singleton-returning-factory)
11. [Exercise 9 — Singleton config parsed on every read](#exercise-9--singleton-config-parsed-on-every-read)
12. [Exercise 10 — JSON-loaded singleton re-read per test](#exercise-10--json-loaded-singleton-re-read-per-test)
13. [Exercise 11 — log.Default mutex on every log line](#exercise-11--logdefault-mutex-on-every-log-line)
14. [Exercise 12 — Three singletons collapsed into one access](#exercise-12--three-singletons-collapsed-into-one-access)
15. [When NOT to optimize](#when-not-to-optimize)
16. [Summary](#summary)

---

## Exercise 1 — Mutex on every access

**Scenario:** Classic textbook singleton using a `sync.Mutex` on every `Get()`.

**Before:**

```go
type Config struct {
    mu       sync.Mutex
    instance *Config
    Region   string
}

var cfg Config

func Get() *Config {
    cfg.mu.Lock()
    defer cfg.mu.Unlock()
    if cfg.instance == nil {
        cfg.instance = &Config{Region: "us-east-1"}
    }
    return cfg.instance
}
```

Benchmark:

```
BenchmarkGet_Mutex-8        30000000     42 ns/op    0 B/op   0 allocs/op
BenchmarkGet_Mutex-8-par    10000000    145 ns/op    0 B/op   0 allocs/op   // contended
```

The Lock/Unlock pair is unavoidable on every call, and under contention the cost balloons because goroutines serialise.

<details><summary>After</summary>

Use `sync.Once` for the init guard, then store the value in an `atomic.Pointer` for read-mostly access:

```go
var (
    once     sync.Once
    cfgPtr   atomic.Pointer[Config]
)

func Get() *Config {
    if p := cfgPtr.Load(); p != nil {
        return p
    }
    once.Do(func() {
        cfgPtr.Store(&Config{Region: "us-east-1"})
    })
    return cfgPtr.Load()
}
```

```
BenchmarkGet_Atomic-8        500000000    2.3 ns/op   0 B/op   0 allocs/op
BenchmarkGet_Atomic-8-par   1000000000    0.6 ns/op   0 B/op   0 allocs/op   // scales linearly
```

~18× faster single-threaded, ~240× under contention.

**Why faster:** `atomic.Pointer.Load` is a single `MOVQ` on amd64 with a load-acquire fence — no lock, no defer, no contention. After the first `Get()`, the fast path never touches `sync.Once`. Compare that to mutex Lock/Unlock, which is two atomic CAS operations *plus* potential park/unpark on contention.

**Trade-offs:** Two atomic loads on the slow init path (cheap, but two instead of one). The pattern is harder to read than `sync.Once.Do(...)` alone — junior reviewers may not see why both are needed.

**When NOT to do this:** When the singleton is mutated after init. `atomic.Pointer` works for read-mostly; for read-write, see Exercise 7 (RWMutex) or Exercise 5 (atomic swap on whole pointer).
</details>

---

## Exercise 2 — Eager init in `init()` blocks startup

**Scenario:** A heavyweight singleton built in `init()`, slowing every binary start.

**Before:**

```go
var db *sql.DB

func init() {
    var err error
    db, err = sql.Open("postgres", os.Getenv("DSN"))
    if err != nil {
        log.Fatal(err)
    }
    if err := db.Ping(); err != nil {  // 50-300 ms network RTT
        log.Fatal(err)
    }
}
```

Measured at process startup:

```
$ time ./service --version
real    0m0.287s
```

287 ms before the binary can even print its version — because `init()` opened a database connection.

<details><summary>After</summary>

Defer the work behind `sync.Once`:

```go
var (
    dbOnce sync.Once
    dbInst *sql.DB
    dbErr  error
)

func DB() (*sql.DB, error) {
    dbOnce.Do(func() {
        dbInst, dbErr = sql.Open("postgres", os.Getenv("DSN"))
        if dbErr != nil {
            return
        }
        dbErr = dbInst.Ping()
    })
    return dbInst, dbErr
}
```

```
$ time ./service --version
real    0m0.012s
```

24× faster startup. The DB connects only when `DB()` is first called.

**Why faster:** `init()` runs unconditionally when the package is imported, even for commands that don't use the DB (`--version`, `--help`, CLI tools that share the package). Lazy init defers the cost to the first real use.

**Trade-offs:** First request pays the connect latency. If your service is request-driven and you want predictable first-request latency, *prime* the singleton at the right moment (after readiness probe, before HTTP server starts) instead of leaving it cold:

```go
func main() {
    if _, err := DB(); err != nil { log.Fatal(err) }  // explicit warm-up
    startHTTP()
}
```

**When NOT to do this:** When the singleton *must* exist before any user code runs (e.g., a global tracer that other packages' `init()` register into). In that case, eager init is required by ordering, not chosen for performance.
</details>

---

## Exercise 3 — `sync.Once` when the value is always needed

**Scenario:** A singleton guarded by `sync.Once` that is *always* accessed by every code path. Lazy init costs one atomic load per access for no reason.

**Before:**

```go
var (
    once   sync.Once
    metric *prometheus.Counter
)

func Metric() *prometheus.Counter {
    once.Do(func() {
        metric = prometheus.NewCounter(prometheus.CounterOpts{Name: "reqs"})
    })
    return metric
}
```

```
BenchmarkOnceAccess-8     500000000    2.4 ns/op
```

Every call performs one atomic load on `once.done`. For a counter incremented millions of times per second, that's wasted work.

<details><summary>After</summary>

If the value is needed unconditionally and the cost of init is small, use plain `init()`:

```go
var metric *prometheus.Counter

func init() {
    metric = prometheus.NewCounter(prometheus.CounterOpts{Name: "reqs"})
}

func Metric() *prometheus.Counter { return metric }
```

```
BenchmarkInitAccess-8    2000000000    0.30 ns/op
```

8× faster — and `Metric()` is now eligible for inlining.

**Why faster:** No atomic load. The variable is plain memory; reads are free. The compiler can also inline `Metric()` because it has no branching.

**Trade-offs:** Loses laziness. Init runs even if the singleton is never used. Counter creation is microseconds, so for Prometheus counters this is fine; for a DB pool, this is Exercise 2's anti-pattern.

**When NOT to do this:** When init is expensive (network, file I/O) or has ordering hazards (depends on other packages' init that may not have run). Keep `sync.Once` for those cases.
</details>

---

## Exercise 4 — `sync.Map` for shared singleton state

**Scenario:** A singleton service registry uses `sync.Map` because someone read that it's "concurrent". The workload is high write contention from many goroutines.

**Before:**

```go
type Registry struct {
    services sync.Map  // map[string]*Service
}

var reg = &Registry{}

func (r *Registry) Get(name string) *Service {
    v, _ := r.services.Load(name)
    if v == nil { return nil }
    return v.(*Service)
}

func (r *Registry) Register(name string, s *Service) {
    r.services.Store(name, s)
}
```

Concurrent Register benchmark (8 goroutines, mixed read/write):

```
BenchmarkSyncMap_Mixed-8    3000000    480 ns/op    32 B/op   2 allocs/op
```

`sync.Map` was designed for the "write-once, read-many" case (e.g., type-to-method caches). Mixed write workloads make it serialise on the `dirty` mutex, and the type-assertion on `Load` adds an iface unbox per call.

<details><summary>After</summary>

Shard the map. Use N small maps, each guarded by its own `sync.RWMutex`:

```go
const shardCount = 32

type shard struct {
    mu sync.RWMutex
    m  map[string]*Service
}

type Registry struct {
    shards [shardCount]shard
}

func (r *Registry) shardFor(key string) *shard {
    return &r.shards[fnv32(key)%shardCount]
}

func (r *Registry) Get(name string) *Service {
    s := r.shardFor(name)
    s.mu.RLock()
    v := s.m[name]
    s.mu.RUnlock()
    return v
}

func (r *Registry) Register(name string, svc *Service) {
    s := r.shardFor(name)
    s.mu.Lock()
    if s.m == nil { s.m = make(map[string]*Service) }
    s.m[name] = svc
    s.mu.Unlock()
}
```

```
BenchmarkSharded_Mixed-8    20000000    62 ns/op    0 B/op   0 allocs/op
```

~7× faster, zero allocations.

**Why faster:** Contention is divided by 32 — 8 writer goroutines no longer pile up on the same lock. Reads use `RLock`, which is non-blocking against other reads. No interface conversion (the map is typed `map[string]*Service`).

**Trade-offs:** Iteration over all entries now needs to lock all shards in order — clumsier and slightly slower. Memory is N × map overhead instead of 1. Shard count tuning matters (too few = contention, too many = waste).

Profile contention with `go test -bench=. -mutexprofile=mu.out` and `go tool pprof mu.out` to see actual contention before sharding.

**When NOT to do this:** When the map is small (<1000 entries), write rate is low, or you're not seeing mutex contention in profiles. Plain `map + sync.RWMutex` is usually enough.
</details>

---

## Exercise 5 — Hot-reload with full lock

**Scenario:** A config singleton supports hot reload from disk. Every `Get()` takes a read lock, every reload takes a write lock.

**Before:**

```go
type Config struct {
    Limits map[string]int
    Hosts  []string
}

var (
    cfgMu sync.RWMutex
    cfg   *Config
)

func Get() *Config {
    cfgMu.RLock()
    defer cfgMu.RUnlock()
    return cfg
}

func Reload(c *Config) {
    cfgMu.Lock()
    cfg = c
    cfgMu.Unlock()
}
```

```
BenchmarkRLock_Get-8     200000000    7.2 ns/op    // single-threaded
BenchmarkRLock_Get-8-par  50000000    32 ns/op     // 8 readers, contended on the RWMutex internal state
```

Even `RLock` has cost — it bumps an atomic reader counter. Under high concurrency that atomic becomes a contention point of its own.

<details><summary>After</summary>

Store the whole config pointer in `atomic.Pointer[Config]` and swap on reload:

```go
var cfg atomic.Pointer[Config]

func Get() *Config { return cfg.Load() }

func Reload(c *Config) { cfg.Store(c) }
```

```
BenchmarkAtomic_Get-8     2000000000    0.30 ns/op
BenchmarkAtomic_Get-8-par 2000000000    0.30 ns/op   // scales perfectly
```

20–100× faster, perfect read scalability.

**Why faster:** `atomic.Pointer.Load` is a single load-acquire. Multiple readers don't interact — no shared atomic counter to contend on. The whole config is copy-on-write: `Reload` builds a new `*Config` and atomically swaps it in. Readers either see the old pointer or the new one; never a torn read.

**Trade-offs:**

1. **Reload allocates** — you can't mutate the config in place; you must build a new `*Config`. For configs that change rarely this is fine; for high-write workloads, see Exercise 4.
2. **Readers may see stale data briefly** — between `Reload` and the next `Load`. Acceptable for most config use; not acceptable for strict-consistency state.
3. **The `Config` value should be immutable** — if any field of the loaded `*Config` is itself a mutable map/slice, readers will race on that. Make all fields immutable, or deep-copy on reload.

**When NOT to do this:** When readers and writers need to coordinate (e.g., a reader needs to see "the version that was current when I started"). RWMutex with explicit versioning is clearer there. Also when the singleton state contains many fields where only one changes — copying the whole struct on every reload becomes wasteful.
</details>

---

## Exercise 6 — Singleton called from a hot loop

**Scenario:** A hot inner loop calls `Get()` per iteration. Even a 2 ns `Get()` adds up over 1e9 iterations.

**Before:**

```go
func process(items []Item) {
    for _, it := range items {
        cfg := config.Get()
        if it.Size > cfg.MaxSize {
            return
        }
        write(it)
    }
}
```

```
BenchmarkLoopWithGet-8   30    42_000_000 ns/op    // 1e6 items, ~42 ns/item
```

Even with `atomic.Pointer`, the loop performs an atomic load every iteration plus a field read.

<details><summary>After</summary>

Hoist the singleton fetch out of the loop:

```go
func process(items []Item) {
    cfg := config.Get()       // once
    maxSize := cfg.MaxSize    // hoist the field too
    for _, it := range items {
        if it.Size > maxSize {
            return
        }
        write(it)
    }
}
```

```
BenchmarkLoopHoisted-8   100    11_000_000 ns/op   // 1e6 items, ~11 ns/item
```

~4× faster on this loop.

**Why faster:** The compiler *cannot* hoist `config.Get()` itself out of the loop automatically — it doesn't know whether the function has side effects or whether the pointer might change. Once you hoist it manually, the inner loop becomes pure arithmetic + branch + memory write. No atomic loads, no function calls.

**Trade-offs:** If the singleton is hot-reloadable (Exercise 5) and the loop is long-running, you'll miss a reload that happens mid-loop. For a 1ms loop that's fine; for a 10-minute batch, it's a bug. Two safe patterns:

1. Re-fetch on outer chunk boundaries (every N items).
2. Pass `cfg` explicitly as a function argument so the call site decides when to refresh.

**When NOT to do this:** When the loop body is already slow (>1 µs/iteration). The `Get()` call disappears into the noise. Don't optimise loops where the singleton fetch isn't measurably hot.
</details>

---

## Exercise 7 — Global mutex for a read-heavy field

**Scenario:** Singleton wraps a counter behind a `sync.Mutex`. Reads dominate writes 1000:1.

**Before:**

```go
type Stats struct {
    mu     sync.Mutex
    count  int64
    label  string
}

var stats Stats

func GetCount() int64 {
    stats.mu.Lock()
    defer stats.mu.Unlock()
    return stats.count
}

func Inc() {
    stats.mu.Lock()
    stats.count++
    stats.mu.Unlock()
}
```

```
BenchmarkMutex_Get-8       100000000    18 ns/op
BenchmarkMutex_Get-8-par    20000000   180 ns/op    // 8 readers contend
```

`Lock`/`Unlock` serialises reads even when no writer is present.

<details><summary>After (atomic for counter; RWMutex if structure needed)</summary>

For a single counter, `atomic.Int64` is the right primitive:

```go
type Stats struct {
    count atomic.Int64
}

var stats Stats

func GetCount() int64 { return stats.count.Load() }
func Inc()            { stats.count.Add(1) }
```

```
BenchmarkAtomic_Get-8      2000000000    0.30 ns/op
BenchmarkAtomic_Get-8-par  2000000000    0.30 ns/op
```

If the singleton holds *multiple* fields that need to be read together, use `sync.RWMutex`:

```go
type Stats struct {
    mu    sync.RWMutex
    count int64
    label string
}

func GetSnapshot() (int64, string) {
    stats.mu.RLock()
    defer stats.mu.RUnlock()
    return stats.count, stats.label
}

func Update(c int64, l string) {
    stats.mu.Lock()
    stats.count, stats.label = c, l
    stats.mu.Unlock()
}
```

```
BenchmarkRWMutex_Read-8     200000000     7 ns/op
BenchmarkRWMutex_Read-8-par 100000000    24 ns/op   // RLock scales better than Lock
```

60× faster atomic, 2.5× faster RWMutex under load.

**Why faster:**

- `atomic.Int64.Load` is a single uncontended load. No barrier, no atomic CAS.
- `RWMutex.RLock` allows N concurrent readers — only writes block. The reader cost is one atomic add (vs Lock's CAS+park).

**Trade-offs:**

- `atomic.Int64` works only for primitive-sized fields. For multi-field reads you need RWMutex or a struct in `atomic.Pointer`.
- `RWMutex` is faster than `Mutex` only when reads truly dominate. With ~50/50 read/write, `Mutex` may win (lower constant factor; no reader-counter bookkeeping). Benchmark before switching.
- `RWMutex` has higher constant overhead than `Mutex` (~1.5×). Don't use it for low-contention paths.

**When NOT to do this:** When reads and writes are roughly balanced. When the protected region holds multiple fields that need joint atomic updates (`atomic` only handles one machine word at a time). For those, keep `Mutex`.
</details>

---

## Exercise 8 — PGO devirtualization of singleton-returning factory

**Scenario:** A singleton is exposed via an interface for testability. Calls to its methods go through interface dispatch.

**Before:**

```go
type Storage interface {
    Save(key string, val []byte) error
    Load(key string) ([]byte, error)
}

var storage Storage = newRealStorage()  // initialised at startup

func Get() Storage { return storage }

// In a hot handler:
func handle(req Request) error {
    return Get().Save(req.Key, req.Val)
}
```

```
BenchmarkInterfaceCall-8     50000000    24 ns/op
```

Each `Save` call goes through an itab lookup.

<details><summary>After (with PGO)</summary>

Collect a profile in production load, then build with PGO:

```bash
go test -bench=. -cpuprofile=cpu.pprof
go build -pgo=cpu.pprof ./cmd/service
```

Or in production:

```bash
curl -o cpu.pprof http://localhost:6060/debug/pprof/profile?seconds=30
cp cpu.pprof default.pgo   # Go's build picks default.pgo automatically
go build ./cmd/service
```

```
BenchmarkInterfaceCall_PGO-8   100000000    9 ns/op
```

~2.5× faster on the hot call.

**Why faster:** PGO sees that `storage` is always `*realStorage` in the profile. It rewrites the call site to a direct call to `(*realStorage).Save`, with a fallback indirect call if the type ever differs. Direct calls inline; indirect ones don't.

**Trade-offs:**

- Build pipeline must produce and ship a profile. Stale profiles target outdated types.
- ~5–10% larger binaries (PGO inlines more aggressively).
- Only helps when one concrete type dominates the interface. If you genuinely swap implementations, PGO has nothing to specialise on.

**When NOT to do this:** Small services, batch jobs, anything where you'd be tuning build complexity for invisible wins. For sub-1k QPS services the engineering cost beats the runtime savings.

**Alternative without PGO:** if the singleton is *truly* immutable across the binary's life, drop the interface entirely:

```go
var storage = newRealStorage()
func Get() *realStorage { return storage }
```

Direct call, no interface. Trade: tests can no longer substitute the singleton. (You can recover testability with a per-test override variable; see Exercise 10.)
</details>

---

## Exercise 9 — Singleton config parsed on every read

**Scenario:** "Lazy" config that parses environment variables every time `Get()` is called, defeating the point of a singleton.

**Before:**

```go
type Config struct{ Region string; Limit int }

func Get() *Config {
    return &Config{
        Region: os.Getenv("AWS_REGION"),
        Limit:  parseIntOr(os.Getenv("LIMIT"), 100),
    }
}

func parseIntOr(s string, def int) int {
    if s == "" { return def }
    n, err := strconv.Atoi(s)
    if err != nil { return def }
    return n
}
```

```
BenchmarkParseEveryGet-8    2000000    640 ns/op    48 B/op   2 allocs/op
```

Two `os.Getenv` syscalls, one `strconv.Atoi`, one heap allocation — every call.

<details><summary>After</summary>

Parse once, cache in `atomic.Pointer`:

```go
var (
    once sync.Once
    cfg  atomic.Pointer[Config]
)

func Get() *Config {
    if p := cfg.Load(); p != nil { return p }
    once.Do(func() {
        cfg.Store(&Config{
            Region: os.Getenv("AWS_REGION"),
            Limit:  parseIntOr(os.Getenv("LIMIT"), 100),
        })
    })
    return cfg.Load()
}
```

```
BenchmarkParseOnce-8        500000000    2.3 ns/op    0 B/op   0 allocs/op
```

~280× faster after first call. Zero allocations.

**Why faster:** Parsing is moved from per-call to per-process. After the first call, `Get()` is a single atomic load. The parse-and-allocate work happens exactly once.

**Trade-offs:** The config can't pick up environment changes after process start. If you need that, reload explicitly (and atomically swap, per Exercise 5):

```go
func Reload() { cfg.Store(parseFromEnv()) }
```

Don't parse-on-read just to allow env-var changes — call `Reload()` from a SIGHUP handler instead.

**When NOT to do this:** When the config is intentionally per-call dynamic (rare; usually a sign of a different bug — the singleton has become a misnomer for "look up environment").
</details>

---

## Exercise 10 — JSON-loaded singleton re-read per test

**Scenario:** A singleton loads its data from a JSON file at startup. Tests want isolation, so each test calls a "reset" that re-parses the file.

**Before:**

```go
type Catalog struct{ Items map[string]Item }

var (
    once    sync.Once
    catalog *Catalog
)

func Get() *Catalog {
    once.Do(func() {
        data, _ := os.ReadFile("catalog.json")
        catalog = &Catalog{}
        json.Unmarshal(data, catalog)
    })
    return catalog
}

func ResetForTest() {
    once = sync.Once{}
    catalog = nil
    _ = Get()  // re-reads the file
}
```

In a test suite with 500 tests, each calling `ResetForTest`:

```
$ go test -count=1 -run TestCatalog
ok      example/catalog    8.421s
```

Per test: 1× file read (~50 µs) + 1× JSON unmarshal (~800 µs) = ~850 µs × 500 tests = 425 ms just on catalog parsing.

<details><summary>After</summary>

Parse the JSON once *per process* (not per test). Store the parsed result in a package-level var; reset by swapping a fresh deep copy:

```go
var (
    parseOnce    sync.Once
    catalogProto *Catalog   // the immutable parsed prototype
)

func loadProto() *Catalog {
    parseOnce.Do(func() {
        data, _ := os.ReadFile("catalog.json")
        catalogProto = &Catalog{}
        json.Unmarshal(data, catalogProto)
    })
    return catalogProto
}

var current atomic.Pointer[Catalog]

func Get() *Catalog {
    if p := current.Load(); p != nil { return p }
    current.Store(loadProto())
    return current.Load()
}

func ResetForTest() {
    // Deep-clone the proto so tests can mutate freely.
    current.Store(deepClone(loadProto()))
}
```

```
$ go test -count=1 -run TestCatalog
ok      example/catalog    8.073s    // 348 ms saved
```

The file is read and JSON-unmarshalled exactly once across the whole test binary. `deepClone` (e.g., a `map` copy) is much cheaper than re-parsing JSON.

**Why faster:**

- File I/O syscalls happen once per process, not per test.
- JSON unmarshal happens once. JSON is one of Go's slowest stdlib codecs — moving it out of the per-test path is almost always worth it.
- Deep-clone of a parsed Go struct is ~10× faster than re-parsing JSON.

**Trade-offs:** Tests share a parsed prototype. If a test corrupts `catalogProto` *itself* (not just its clone), subsequent tests see corruption. Enforce by making `catalogProto`'s fields unexported and only handing out clones.

**When NOT to do this:** When the JSON file content varies between tests (e.g., each test loads a different fixture). In that case the singleton was the wrong abstraction — pass the catalog explicitly to tests as a parameter.
</details>

---

## Exercise 11 — `log.Default` mutex on every log line

**Scenario:** Code uses `log.Printf` (or a homegrown logger) on the hot path. The standard library's `log.Logger` takes a mutex on every line, even when the level would suppress the message.

**Before:**

```go
var lvl atomic.Int32  // 0=debug, 1=info, 2=warn, 3=error

func DebugF(format string, args ...any) {
    if lvl.Load() <= 0 {
        log.Printf("DEBUG "+format, args...)   // log.Default mutex inside
    }
}
```

```
BenchmarkLogDebug_AtLevelInfo-8    10000000    180 ns/op    32 B/op   2 allocs/op
```

Even when debug is suppressed, the *arguments* are evaluated and (if any are interfaces) boxed. The fast path takes ~180 ns and 2 allocations per ignored debug line.

<details><summary>After</summary>

Two layers of optimisation:

1. Check the level *before* arg evaluation (kill the boxing).
2. When emitting, use a logger that writes to a buffered, lock-free per-goroutine sink — or use `slog` with a discard handler at low levels.

```go
type Logger struct {
    level atomic.Int32
    out   io.Writer  // typically os.Stderr, or a buffered sink
    mu    sync.Mutex // only used when actually emitting
}

func (l *Logger) DebugEnabled() bool { return l.level.Load() <= 0 }

func (l *Logger) Debug(msg string, args ...any) {
    if !l.DebugEnabled() { return }
    l.emit("DEBUG", msg, args)
}

// Caller pattern:
if log.DebugEnabled() {
    log.Debug("user %d state=%s", userID, state)
}
```

```
BenchmarkDebug_Suppressed-8    2000000000    0.30 ns/op    0 B/op   0 allocs/op
```

~600× faster on the suppressed path. The conditional check uses one atomic load; nothing is evaluated, nothing is allocated.

For the *emit* path, `slog.New(slog.NewTextHandler(...))` plus `slog.SetDefault` gives you structured logging where formatting is deferred:

```go
slog.Debug("user state", "user_id", userID, "state", state)
```

`slog` checks the level *before* recording the attributes. With a discard handler at info level, debug calls cost ~3 ns.

**Why faster:**

- Atomic level check is one MOVQ; no lock, no syscall.
- Boxing `userID` and `state` into `[]any` is the dominant cost when the log line is suppressed — eliminating it removes both allocations.
- The mutex is reserved for the *actual emit*, which only happens for unsuppressed lines.

**Trade-offs:** The `if log.DebugEnabled() { log.Debug(...) }` idiom is verbose. Structured loggers (`slog`, `zap`, `zerolog`) handle this internally — they check the level inside `Debug()` *before* recording attributes, so callers can write `log.Debug(...)` directly.

**When NOT to do this:** When you log very rarely (background daemons, batch jobs). The default `log` package is fine there.
</details>

---

## Exercise 12 — Three singletons collapsed into one access

**Scenario:** A hot request handler fetches three independent singletons (config, metrics, logger). Each fetch is cheap, but three atomic loads back-to-back add up.

**Before:**

```go
func handle(req Request) error {
    cfg := config.Get()
    met := metrics.Get()
    lg  := logger.Get()
    if req.Size > cfg.MaxSize {
        met.IncReject()
        lg.Warn("too big")
        return ErrTooBig
    }
    ...
}
```

```
BenchmarkThreeGets-8     100000000    9 ns/op    // 3 atomic loads × ~3 ns
```

Three atomic loads, three function calls.

<details><summary>After</summary>

Bundle related singletons into a single context struct exposed via one `Get()`:

```go
type Services struct {
    Cfg     *Config
    Metrics *Metrics
    Logger  *Logger
}

var svc atomic.Pointer[Services]

func init() {
    svc.Store(&Services{
        Cfg:     loadConfig(),
        Metrics: newMetrics(),
        Logger:  newLogger(),
    })
}

func Get() *Services { return svc.Load() }

// Caller:
func handle(req Request) error {
    s := Get()
    if req.Size > s.Cfg.MaxSize {
        s.Metrics.IncReject()
        s.Logger.Warn("too big")
        return ErrTooBig
    }
    ...
}
```

```
BenchmarkBundledGet-8    500000000    3 ns/op
```

3× faster. One atomic load instead of three. The follow-up field reads are free (struct member access).

**Why faster:** One atomic load brings the bundle into a register; field reads off the pointer are cache-friendly direct loads. Three separate atomics each invalidate the pipeline (or at minimum the memory ordering barrier).

**Trade-offs:**

- The three subsystems are now coupled at the access level. Reloading any one requires building a whole new `Services` struct. For services where config reloads and metrics never do, this is awkward.
- Tests that want to swap one subsystem (say, the logger) must build a full `Services`. A test helper helps:

```go
func WithTestLogger(l *Logger) (restore func()) {
    old := svc.Load()
    svc.Store(&Services{Cfg: old.Cfg, Metrics: old.Metrics, Logger: l})
    return func() { svc.Store(old) }
}
```

**When NOT to do this:** When the singletons have very different lifecycles (one reloads every minute, another never). Coupling them forces unnecessary work on every reload. Also when the bundle becomes a "god struct" — when adding any new singleton means modifying the bundle, you're courting the same problems Service Locator brings.
</details>

---

## When NOT to optimize

Singleton access isn't free, but it isn't the bottleneck in most services either. The right order of operations:

1. **Profile.** `go test -bench=. -cpuprofile=cpu.out` or `curl /debug/pprof/profile`. Then `go tool pprof -top cpu.out`.
2. **Identify.** Is `config.Get` (or your equivalent) in the top 10 of CPU? Top 20? If not, leave it alone.
3. **Mutex profile too.** `go test -mutexprofile=mu.out`. Singleton contention shows up here, not in CPU. A 1 ms median lock-wait will not appear in CPU profiles but will tank tail latency.
4. **Apply selectively.** Use the cheapest primitive that still gives the guarantees:
    - Read-mostly immutable → `atomic.Pointer` swap (Exercises 1, 5).
    - Read-mostly with field reads → `RWMutex` (Exercise 7).
    - Counter only → `atomic.Int64` (Exercise 7).
    - Truly contended map → shard (Exercise 4).
    - Truly cold init that may never run → `sync.Once` (Exercises 1, 2).
    - Always-needed init → plain `init()` + package var (Exercise 3).
5. **Measure again.** Confirm the optimisation removed the bottleneck. If not, revert (simplicity wins).

What's almost always worth it (no profile needed):

- Replacing `Mutex.Lock()/Unlock()` around a single read of an immutable pointer with `atomic.Pointer.Load`. The mutex was over-engineering from the start.
- Pre-compiling, pre-parsing, or pre-allocating anything that the singleton hands out (Exercise 9).
- Moving expensive `init()` to `sync.Once`-guarded lazy init (Exercise 2) — this is faster *and* improves startup.

What's rarely worth it:

- Sharding a small map. Profile first; 32 shards of a 50-entry map is just waste.
- PGO for a singleton-returning factory in a low-QPS service.
- Manually unrolling a `Get()` call out of a loop that isn't hot.

What can backfire:

- Using `sync.Map` because "it's lock-free". It isn't; it's "lock-free for the read-mostly path". For mixed workloads it's slower than sharded `map+RWMutex`.
- Replacing `Mutex` with `RWMutex` when reads are not actually dominant. The reader-counter overhead can make things worse.
- `atomic.Pointer` swaps when the underlying struct contains mutable maps/slices — readers still race on those.

---

## Summary

**Wins that always ship:**

- `sync.Once` + `atomic.Pointer` for read-mostly singletons (Exercise 1).
- Lazy init via `sync.Once` instead of `init()` for expensive resources (Exercise 2).
- Plain `init()` for always-needed, cheap-to-build singletons (Exercise 3) — *not* `sync.Once`.
- Parse env/config once, cache (Exercise 9).
- Atomic level check before formatting log args (Exercise 11).

**Wins behind a profile:**

- Shard `sync.Map` or contended map (Exercise 4).
- Atomic-pointer swap for hot reload (Exercise 5).
- Hoist `Get()` out of hot loops (Exercise 6).
- `atomic.Int64` or `RWMutex` for read-heavy fields (Exercise 7).
- Bundle related singletons into one access (Exercise 12).

**Wins that trade off flexibility:**

- PGO devirtualization of interface-returning factories (Exercise 8).
- Sharing a parsed prototype across tests instead of re-parsing (Exercise 10).
- Bundling singletons into a `Services` struct (Exercise 12).

**Rarely worth it:**

- Sharding small maps.
- PGO for low-QPS services.
- Manual hoist of cold-path `Get()` calls.

Singletons are special among patterns: they sit on the hot path, so even small per-call savings compound. But the inverse is also true — a misplaced atomic or shard scheme will cost more than the textbook implementation it replaced. Profile, identify, then apply the cheapest primitive that still gives the guarantees you need.
