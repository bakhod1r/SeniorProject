# Factory Pattern — Hands-on Tasks

## 1. How to use this file

Fifteen progressive tasks. Each has:

- **Problem statement** — the scenario.
- **Acceptance criteria** — checkboxes you should satisfy.
- **Hints** (collapsible) — reach for them if stuck.
- **Solution** (collapsible) — full compilable Go.
- **Discussion** — trade-offs you missed.

All code is written for Go 1.22+. Use `go run` to verify; the solutions assume a `package main` unless otherwise noted.

---

## Task 1 — `NewServer` factory with defaults

You have a config-heavy type:

```go
type Server struct {
    Addr            string
    ReadTimeout     time.Duration
    WriteTimeout    time.Duration
    MaxHeaderBytes  int
    Logger          *log.Logger
}
```

Write a `NewServer(addr string) *Server` factory that returns a fully usable server with sensible defaults — caller supplies only `addr`.

**Acceptance criteria:**
- [ ] Single-arg factory returning `*Server`.
- [ ] Every field has a non-zero default (except `Addr`).
- [ ] Defaults are documented in a comment near the factory.

<details><summary>Hints</summary>

- Pick defaults that make sense for an HTTP server: 5s read, 10s write, 1MB headers.
- `log.Default()` gives you a no-config logger.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "log"
    "time"
)

type Server struct {
    Addr           string
    ReadTimeout    time.Duration
    WriteTimeout   time.Duration
    MaxHeaderBytes int
    Logger         *log.Logger
}

// NewServer returns a Server with conservative defaults:
// 5s read, 10s write, 1MB headers, stdlib default logger.
func NewServer(addr string) *Server {
    return &Server{
        Addr:           addr,
        ReadTimeout:    5 * time.Second,
        WriteTimeout:   10 * time.Second,
        MaxHeaderBytes: 1 << 20,
        Logger:         log.Default(),
    }
}

func main() {
    s := NewServer(":8080")
    fmt.Printf("%+v\n", s)
}
```
</details>

**Discussion:** A factory function is the simplest defence against a "five-field constructor" call site. The zero value of `time.Duration` is `0`, which is *not* what you want for a read timeout — defaults matter. Note we return `*Server` not `Server`: large structs and types with mutable internal state should be heap-allocated.

---

## Task 2 — Type-selecting factory: `NewStorage(kind string)`

Build a factory that returns one of three storage backends behind a common interface:

```go
type Storage interface {
    Put(key string, value []byte) error
    Get(key string) ([]byte, error)
}
```

The kinds are `"memory"`, `"disk"`, and `"s3"`. Unknown kinds return an error.

**Acceptance criteria:**
- [ ] `NewStorage(kind string) (Storage, error)`.
- [ ] Three concrete types behind the interface.
- [ ] Unknown kind produces an error including the kind string.
- [ ] `main` exercises all three branches.

<details><summary>Hints</summary>

- A `switch` on `kind` is fine — no need for a registry yet.
- The disk and S3 implementations can be stubs that just print.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
)

type Storage interface {
    Put(key string, value []byte) error
    Get(key string) ([]byte, error)
}

type memStorage struct{ m map[string][]byte }

func (s *memStorage) Put(k string, v []byte) error { s.m[k] = v; return nil }
func (s *memStorage) Get(k string) ([]byte, error) {
    v, ok := s.m[k]
    if !ok {
        return nil, fmt.Errorf("memStorage: key %q not found", k)
    }
    return v, nil
}

type diskStorage struct{ dir string }

func (s *diskStorage) Put(k string, v []byte) error {
    fmt.Printf("diskStorage[%s]: put %s (%d bytes)\n", s.dir, k, len(v))
    return nil
}
func (s *diskStorage) Get(k string) ([]byte, error) {
    return []byte("from-disk:" + k), nil
}

type s3Storage struct{ bucket string }

func (s *s3Storage) Put(k string, v []byte) error {
    fmt.Printf("s3Storage[%s]: put %s\n", s.bucket, k)
    return nil
}
func (s *s3Storage) Get(k string) ([]byte, error) {
    return []byte("from-s3:" + k), nil
}

func NewStorage(kind string) (Storage, error) {
    switch kind {
    case "memory":
        return &memStorage{m: map[string][]byte{}}, nil
    case "disk":
        return &diskStorage{dir: "/var/data"}, nil
    case "s3":
        return &s3Storage{bucket: "default-bucket"}, nil
    default:
        return nil, fmt.Errorf("NewStorage: unknown kind %q", kind)
    }
}

func main() {
    for _, kind := range []string{"memory", "disk", "s3", "tape"} {
        s, err := NewStorage(kind)
        if err != nil {
            fmt.Println("error:", err)
            continue
        }
        _ = s.Put("k1", []byte("v1"))
        v, _ := s.Get("k1")
        fmt.Printf("%s -> %s\n", kind, v)
    }
}
```
</details>

**Discussion:** This is the bread-and-butter factory. The interface gives you substitutability; the factory gives you a single place to map a config string to an implementation. The error case is essential — never return a "default" implementation for an unknown kind, that hides config typos.

---

## Task 3 — Registry-based factory with `init()` self-registration

Refactor Task 2 so each storage type *registers itself* with a central factory at package init. Adding a new storage type should not require editing `NewStorage`.

```go
type Constructor func() Storage
```

**Acceptance criteria:**
- [ ] Package-level registry `map[string]Constructor`.
- [ ] Each concrete type calls `Register("kind", ctor)` in its own `init()`.
- [ ] `NewStorage` only consults the registry.
- [ ] Double-registration panics (fail-fast).

<details><summary>Hints</summary>

- Guard the registry with a `sync.RWMutex` since `init()` order is sequential but you may want to allow runtime registration too.
- Panic in `Register` if the key already exists — silent overwrite is a bug magnet.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

type Storage interface {
    Put(key string, value []byte) error
    Get(key string) ([]byte, error)
}

type Constructor func() Storage

var (
    regMu sync.RWMutex
    reg   = map[string]Constructor{}
)

func Register(kind string, ctor Constructor) {
    regMu.Lock()
    defer regMu.Unlock()
    if _, exists := reg[kind]; exists {
        panic(fmt.Sprintf("storage: kind %q already registered", kind))
    }
    reg[kind] = ctor
}

func NewStorage(kind string) (Storage, error) {
    regMu.RLock()
    ctor, ok := reg[kind]
    regMu.RUnlock()
    if !ok {
        return nil, fmt.Errorf("NewStorage: unknown kind %q", kind)
    }
    return ctor(), nil
}

// --- memory backend
type memStorage struct{ m map[string][]byte }

func (s *memStorage) Put(k string, v []byte) error { s.m[k] = v; return nil }
func (s *memStorage) Get(k string) ([]byte, error) {
    v, ok := s.m[k]
    if !ok {
        return nil, fmt.Errorf("key %q not found", k)
    }
    return v, nil
}
func init() {
    Register("memory", func() Storage { return &memStorage{m: map[string][]byte{}} })
}

// --- disk backend
type diskStorage struct{}

func (diskStorage) Put(k string, v []byte) error {
    fmt.Printf("disk: put %s (%d bytes)\n", k, len(v))
    return nil
}
func (diskStorage) Get(k string) ([]byte, error) { return []byte("disk:" + k), nil }
func init() {
    Register("disk", func() Storage { return diskStorage{} })
}

func main() {
    for _, kind := range []string{"memory", "disk"} {
        s, _ := NewStorage(kind)
        _ = s.Put("k", []byte("v"))
        v, _ := s.Get("k")
        fmt.Printf("%s -> %s\n", kind, v)
    }
}
```
</details>

**Discussion:** This is the `database/sql` driver model. New backends live in their own file (or package); they "plug in" via `init()` and `Register`. The central factory has no compile-time dependency on the concrete types — they could even live in plugin packages imported only for their side effects (`import _ "myapp/storage/s3"`). The cost: `init()` ordering is implicit and harder to reason about.

---

## Task 4 — Factory returning `(T, error)` with validation

You have a `RateLimiter`:

```go
type RateLimiter struct {
    RPS    int
    Burst  int
    Window time.Duration
}
```

Write `NewRateLimiter(rps, burst int, window time.Duration) (*RateLimiter, error)` that validates inputs.

**Acceptance criteria:**
- [ ] `rps > 0`, else error.
- [ ] `burst >= rps`, else error.
- [ ] `window > 0`, else error.
- [ ] Each error message includes the offending field name and value.

<details><summary>Hints</summary>

- Collect errors with `errors.Join` so the caller sees all problems at once, not just the first.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
    "time"
)

type RateLimiter struct {
    RPS    int
    Burst  int
    Window time.Duration
}

func NewRateLimiter(rps, burst int, window time.Duration) (*RateLimiter, error) {
    var errs []error
    if rps <= 0 {
        errs = append(errs, fmt.Errorf("rps must be > 0, got %d", rps))
    }
    if burst < rps {
        errs = append(errs, fmt.Errorf("burst (%d) must be >= rps (%d)", burst, rps))
    }
    if window <= 0 {
        errs = append(errs, fmt.Errorf("window must be > 0, got %v", window))
    }
    if len(errs) > 0 {
        return nil, errors.Join(errs...)
    }
    return &RateLimiter{RPS: rps, Burst: burst, Window: window}, nil
}

func main() {
    if _, err := NewRateLimiter(0, 5, 0); err != nil {
        fmt.Println("validation failed:")
        fmt.Println(err)
    }
    rl, err := NewRateLimiter(10, 20, time.Second)
    fmt.Printf("ok: %+v err=%v\n", rl, err)
}
```
</details>

**Discussion:** A factory is the natural place for invariant checks. Once `NewRateLimiter` returns successfully, the rest of the program can trust the values. `errors.Join` (Go 1.20+) lets you surface all validation problems at once — much friendlier than the typical "fix one, run again, fix next" loop.

---

## Task 5 — Must-variant factory (panic on error)

Some constructors are called in package-level `var` blocks where returning an error is awkward. Pattern: provide both `New...` (returns error) and `Must...` (panics).

Given Task 4's `NewRateLimiter`, build `MustRateLimiter`.

**Acceptance criteria:**
- [ ] `MustRateLimiter(rps, burst int, window time.Duration) *RateLimiter`.
- [ ] Internally calls `NewRateLimiter`; panics on error.
- [ ] Used in a package-level `var` so the panic on bad input would surface at program startup.

<details><summary>Hints</summary>

- Pattern matches `template.Must`, `regexp.MustCompile`. Keep the signature minimal.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
    "time"
)

type RateLimiter struct {
    RPS    int
    Burst  int
    Window time.Duration
}

func NewRateLimiter(rps, burst int, window time.Duration) (*RateLimiter, error) {
    var errs []error
    if rps <= 0 {
        errs = append(errs, fmt.Errorf("rps must be > 0"))
    }
    if burst < rps {
        errs = append(errs, fmt.Errorf("burst must be >= rps"))
    }
    if window <= 0 {
        errs = append(errs, fmt.Errorf("window must be > 0"))
    }
    if len(errs) > 0 {
        return nil, errors.Join(errs...)
    }
    return &RateLimiter{RPS: rps, Burst: burst, Window: window}, nil
}

func MustRateLimiter(rps, burst int, window time.Duration) *RateLimiter {
    rl, err := NewRateLimiter(rps, burst, window)
    if err != nil {
        panic(err)
    }
    return rl
}

// global limiter — panic at program start if config is wrong.
var globalLimiter = MustRateLimiter(10, 20, time.Second)

func main() {
    fmt.Printf("global limiter: %+v\n", globalLimiter)
}
```
</details>

**Discussion:** Use `Must...` *only* for inputs that are program constants — regexes, templates, configured limits. Never use it for runtime data; a single bad row from a database would crash the process. The stdlib convention (`Must` prefix) makes the panic risk visible at the call site.

---

## Task 6 — Factory with functional options

Replace the multi-arg form of `NewRateLimiter` with a functional-options factory. The caller supplies only what they want to override; everything else gets a default.

```go
rl := NewRateLimiter(WithRPS(50), WithBurst(100))
```

**Acceptance criteria:**
- [ ] Single variadic parameter: `...Option`.
- [ ] Defaults: RPS=10, Burst=20, Window=1s.
- [ ] Each option is a function returning `Option`.
- [ ] At least one option does validation and the factory returns `(rl, error)`.

<details><summary>Hints</summary>

- `type Option func(*RateLimiter) error` is the cleanest form because it lets options report errors.
- Apply options after defaults, then check final invariants.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "time"
)

type RateLimiter struct {
    RPS    int
    Burst  int
    Window time.Duration
}

type Option func(*RateLimiter) error

func WithRPS(rps int) Option {
    return func(r *RateLimiter) error {
        if rps <= 0 {
            return fmt.Errorf("WithRPS: must be > 0, got %d", rps)
        }
        r.RPS = rps
        return nil
    }
}

func WithBurst(burst int) Option {
    return func(r *RateLimiter) error {
        if burst <= 0 {
            return fmt.Errorf("WithBurst: must be > 0, got %d", burst)
        }
        r.Burst = burst
        return nil
    }
}

func WithWindow(w time.Duration) Option {
    return func(r *RateLimiter) error {
        if w <= 0 {
            return fmt.Errorf("WithWindow: must be > 0, got %v", w)
        }
        r.Window = w
        return nil
    }
}

func NewRateLimiter(opts ...Option) (*RateLimiter, error) {
    rl := &RateLimiter{
        RPS:    10,
        Burst:  20,
        Window: time.Second,
    }
    for _, opt := range opts {
        if err := opt(rl); err != nil {
            return nil, err
        }
    }
    if rl.Burst < rl.RPS {
        return nil, fmt.Errorf("invariant: burst (%d) < rps (%d)", rl.Burst, rl.RPS)
    }
    return rl, nil
}

func main() {
    rl, err := NewRateLimiter(WithRPS(50), WithBurst(100))
    fmt.Printf("rl=%+v err=%v\n", rl, err)

    _, err = NewRateLimiter(WithRPS(50)) // burst=20 < rps=50
    fmt.Println("expected error:", err)
}
```
</details>

**Discussion:** Functional options scale much better than positional arguments when a type has more than three or four fields. The call site is self-documenting, defaults stay in one place, and the API can grow without breaking existing callers. The trade-off: more code than a simple struct literal, and discoverability suffers (IDEs help less).

---

## Task 7 — Lazy factory via `sync.Once`

Some objects are expensive to construct (a DB connection pool, a compiled template) and not always needed. Build a *lazy factory* that constructs the value only on first access.

```go
type LazyDB struct{ /* unexported state */ }
func (l *LazyDB) Get() *DB    // builds on first call
```

**Acceptance criteria:**
- [ ] Construction happens on first `Get`, never before.
- [ ] Concurrent `Get` calls construct once.
- [ ] No locking on the fast path after the first call.

<details><summary>Hints</summary>

- `sync.Once.Do` is exactly the primitive you want.
- For a generic version, `sync.OnceValue` (Go 1.21+) is even shorter.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type DB struct{ id int }

var dbIDs atomic.Int64

func newDB() *DB {
    time.Sleep(50 * time.Millisecond) // simulate expensive setup
    return &DB{id: int(dbIDs.Add(1))}
}

type LazyDB struct {
    once sync.Once
    db   *DB
}

func (l *LazyDB) Get() *DB {
    l.once.Do(func() {
        l.db = newDB()
    })
    return l.db
}

// Go 1.21+ alternative:
var lazyDB = sync.OnceValue(newDB)

func main() {
    l := &LazyDB{}
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println("got db", l.Get().id)
        }()
    }
    wg.Wait()

    // OnceValue version
    fmt.Println("OnceValue db:", lazyDB().id, lazyDB().id) // same id twice
}
```
</details>

**Discussion:** `sync.Once` ensures exactly-once construction even under concurrent access; after the first call, `Do` is a near-free atomic load. The Go 1.21 `sync.OnceValue` removes the boilerplate entirely — prefer it when you can. Be careful: errors during construction should make subsequent calls *retry* or *cache the error*, not silently return a partial value.

---

## Task 8 — Abstract factory: `Tracer` producing `Span`, `Counter`, `Histogram`

An *abstract factory* groups several related factories under one interface. Build a `Tracer` whose methods create three related telemetry primitives.

```go
type Span interface {
    End()
}
type Counter interface {
    Inc()
}
type Histogram interface {
    Observe(v float64)
}
type Tracer interface {
    Span(name string) Span
    Counter(name string) Counter
    Histogram(name string) Histogram
}
```

Provide *two* implementations: `NopTracer` (does nothing) and `LogTracer` (prints to stdout).

**Acceptance criteria:**
- [ ] Two `Tracer` implementations.
- [ ] Each produces its own concrete span/counter/histogram types.
- [ ] `main` swaps tracers and shows both working.

<details><summary>Hints</summary>

- The "abstract factory" idea is: one parent interface whose methods are themselves factories. Each implementation produces a *family* of compatible products.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "time"
)

type Span interface{ End() }
type Counter interface{ Inc() }
type Histogram interface{ Observe(v float64) }

type Tracer interface {
    Span(name string) Span
    Counter(name string) Counter
    Histogram(name string) Histogram
}

// --- Nop family
type nopSpan struct{}
type nopCounter struct{}
type nopHistogram struct{}

func (nopSpan) End()              {}
func (nopCounter) Inc()           {}
func (nopHistogram) Observe(float64) {}

type NopTracer struct{}

func (NopTracer) Span(string) Span           { return nopSpan{} }
func (NopTracer) Counter(string) Counter     { return nopCounter{} }
func (NopTracer) Histogram(string) Histogram { return nopHistogram{} }

// --- Log family
type logSpan struct {
    name  string
    start time.Time
}

func (s *logSpan) End() {
    fmt.Printf("span %s took %v\n", s.name, time.Since(s.start))
}

type logCounter struct{ name string }

func (c *logCounter) Inc() { fmt.Printf("counter %s++\n", c.name) }

type logHistogram struct{ name string }

func (h *logHistogram) Observe(v float64) {
    fmt.Printf("histogram %s observed %v\n", h.name, v)
}

type LogTracer struct{}

func (LogTracer) Span(name string) Span {
    return &logSpan{name: name, start: time.Now()}
}
func (LogTracer) Counter(name string) Counter     { return &logCounter{name: name} }
func (LogTracer) Histogram(name string) Histogram { return &logHistogram{name: name} }

func handle(t Tracer) {
    sp := t.Span("handle")
    defer sp.End()
    t.Counter("requests").Inc()
    t.Histogram("latency_ms").Observe(12.5)
    time.Sleep(10 * time.Millisecond)
}

func main() {
    fmt.Println("--- NopTracer ---")
    handle(NopTracer{})
    fmt.Println("--- LogTracer ---")
    handle(LogTracer{})
}
```
</details>

**Discussion:** The abstract factory matters when the *family* of products has to stay coherent — you can't mix a `logSpan` with a `nopCounter` because the consumer of `Tracer` should get one consistent backend. In Go, abstract factory often shows up as "framework `X` provides observability primitives" — `otel.Tracer`, `prometheus.Registry`, etc.

---

## Task 9 — Factory function as a value

Sometimes you want to pass *the factory itself* around — for example to a registry, a test harness, or a worker pool. Build a small example.

```go
type Worker interface { Do() }
type WorkerFactory func(id int) Worker
```

Write:

- A concrete `Worker` (prints its id when `Do` is called).
- A `Pool` that takes a `WorkerFactory` and spins up N workers.
- A second `WorkerFactory` (e.g. counting worker) and reuse the same `Pool`.

**Acceptance criteria:**
- [ ] `Pool.Run(n int)` constructs N workers from the factory and calls `Do` on each.
- [ ] Two distinct `WorkerFactory` values both feed the same `Pool`.
- [ ] No reflection, no type switching.

<details><summary>Hints</summary>

- The factory is the *behaviour parameter*. The pool stays generic without generics — the interface does the work.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync/atomic"
)

type Worker interface{ Do() }
type WorkerFactory func(id int) Worker

type printWorker struct{ id int }

func (w *printWorker) Do() { fmt.Printf("print-worker %d running\n", w.id) }

type countWorker struct {
    id    int
    count *atomic.Int64
}

func (w *countWorker) Do() { w.count.Add(1) }

type Pool struct {
    Factory WorkerFactory
}

func (p *Pool) Run(n int) {
    for i := 0; i < n; i++ {
        p.Factory(i).Do()
    }
}

func main() {
    // factory #1
    p1 := &Pool{Factory: func(id int) Worker { return &printWorker{id: id} }}
    p1.Run(3)

    // factory #2 — closure captures shared state
    var counter atomic.Int64
    p2 := &Pool{Factory: func(id int) Worker {
        return &countWorker{id: id, count: &counter}
    }}
    p2.Run(100)
    fmt.Println("counter:", counter.Load())
}
```
</details>

**Discussion:** Treating the factory as a first-class value buys you two things: tests can pass a stub factory; closures can capture per-pool state (the second factory above shares a single counter across all workers). This is the standard "dependency injection without a framework" pattern in Go — pass functions, not containers.

---

## Task 10 — Generic factory: `Pool[T]`

Using Go generics, build a *typed* pool:

```go
type Pool[T any] struct {
    New func() T
}
func (p *Pool[T]) Get() T
func (p *Pool[T]) Put(t T)
```

This is basically `sync.Pool` with a typed `Get`. The `New` factory provides a fresh instance when the pool is empty.

**Acceptance criteria:**
- [ ] Generic over `T`.
- [ ] Safe for concurrent use.
- [ ] `Get` returns a previously-put `T` if available, else calls `New`.
- [ ] Demo with `Pool[*bytes.Buffer]`.

<details><summary>Hints</summary>

- Wrap `sync.Pool` and add a type assertion (or just write your own with a slice + mutex).
- Going via `sync.Pool` gives you GC-aware behaviour for free.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

type Pool[T any] struct {
    New  func() T
    pool sync.Pool
    once sync.Once
}

func (p *Pool[T]) init() {
    p.pool.New = func() any { return p.New() }
}

func (p *Pool[T]) Get() T {
    p.once.Do(p.init)
    return p.pool.Get().(T)
}

func (p *Pool[T]) Put(t T) {
    p.once.Do(p.init)
    p.pool.Put(t)
}

func main() {
    bufPool := &Pool[*bytes.Buffer]{
        New: func() *bytes.Buffer { return &bytes.Buffer{} },
    }

    b := bufPool.Get()
    b.WriteString("hello")
    fmt.Println("first use:", b.String())
    b.Reset()
    bufPool.Put(b)

    b2 := bufPool.Get() // likely the same buffer
    b2.WriteString("world")
    fmt.Println("reused buffer:", b2.String())
}
```
</details>

**Discussion:** Generics turn an `interface{}`-and-cast API into a type-safe one. The `New` field is *the* factory — it's the only place that knows how to make a `T`. Note we use `sync.Once` to wire `pool.New` lazily; the alternative is forcing callers through a `NewPool` constructor. Both are valid.

---

## Task 11 — Factory returning a cleanup function

Some resources need explicit teardown. The Go idiom: factory returns `(value, cleanupFn, err)`. The caller uses `defer cleanup()`.

```go
func NewTempDir(prefix string) (path string, cleanup func(), err error)
```

**Acceptance criteria:**
- [ ] Returns the directory path.
- [ ] `cleanup` removes the directory and is safe to call multiple times.
- [ ] On error, no resources are leaked.

<details><summary>Hints</summary>

- `os.MkdirTemp` and `os.RemoveAll`.
- Guard the cleanup with a `sync.Once` so double-defer is harmless.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "os"
    "sync"
)

func NewTempDir(prefix string) (string, func(), error) {
    dir, err := os.MkdirTemp("", prefix)
    if err != nil {
        return "", func() {}, fmt.Errorf("NewTempDir: %w", err)
    }
    var once sync.Once
    cleanup := func() {
        once.Do(func() { os.RemoveAll(dir) })
    }
    return dir, cleanup, nil
}

func main() {
    dir, cleanup, err := NewTempDir("demo-*")
    if err != nil {
        panic(err)
    }
    defer cleanup()

    fmt.Println("using", dir)
    os.WriteFile(dir+"/note.txt", []byte("hello"), 0o644)

    // safe to call cleanup directly too:
    cleanup()
    cleanup() // no-op the second time
}
```
</details>

**Discussion:** This is the `testing.T.TempDir`-style API. The `(value, cleanup, err)` triple is preferable to `(value, err)` + a `defer value.Close()` when the *value itself* is a string or struct without an obvious teardown method. The `sync.Once` makes the cleanup idempotent, which lets you be defensive at call sites (defer + explicit close on the happy path).

---

## Task 12 — Factory accepting `context.Context` for lifecycle

A worker manager needs to spawn long-lived goroutines whose lifetime is tied to a context.

```go
type Worker struct {
    ID   int
    done chan struct{}
}

func NewWorker(ctx context.Context, id int) *Worker
```

The factory should start the worker's goroutine and stop it cleanly when `ctx` is cancelled.

**Acceptance criteria:**
- [ ] Goroutine starts inside the factory.
- [ ] When `ctx.Done()` fires, the goroutine exits and `Worker.Wait()` returns.
- [ ] No goroutine leak.

<details><summary>Hints</summary>

- Close a `done` channel when the goroutine exits; `Wait` blocks on it.
- The factory captures `ctx` and starts a `for select` loop.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "time"
)

type Worker struct {
    ID   int
    done chan struct{}
}

func (w *Worker) Wait() { <-w.done }

func NewWorker(ctx context.Context, id int) *Worker {
    w := &Worker{ID: id, done: make(chan struct{})}
    go func() {
        defer close(w.done)
        tick := time.NewTicker(50 * time.Millisecond)
        defer tick.Stop()
        for {
            select {
            case <-ctx.Done():
                fmt.Printf("worker %d stopping: %v\n", w.ID, ctx.Err())
                return
            case t := <-tick.C:
                fmt.Printf("worker %d tick %v\n", w.ID, t.Format("15:04:05.000"))
            }
        }
    }()
    return w
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()

    workers := []*Worker{
        NewWorker(ctx, 1),
        NewWorker(ctx, 2),
    }
    for _, w := range workers {
        w.Wait()
    }
    fmt.Println("all workers done")
}
```
</details>

**Discussion:** Tying lifecycle to a context is the canonical Go pattern. The factory hides goroutine startup; the caller drives shutdown via `cancel()`. Be careful never to return *before* the goroutine has registered for `ctx.Done()` — here that's fine because the goroutine starts immediately, but factories that do setup *inside* the goroutine can race with cancellation.

---

## Task 13 — Factory hot-swap with `atomic.Pointer`

Sometimes the *output* of a factory needs to be swappable at runtime (config reload, feature flag, A/B variant). Build a `Provider[T]` that exposes the current value and lets you replace it atomically.

```go
type Provider[T any] struct{ /* ... */ }
func NewProvider[T any](initial T) *Provider[T]
func (p *Provider[T]) Get() T
func (p *Provider[T]) Set(t T)
```

**Acceptance criteria:**
- [ ] `Get` and `Set` are safe for concurrent use without a mutex on the read path.
- [ ] Demo: one goroutine reads in a loop, another swaps the value.
- [ ] No data race (`go run -race`).

<details><summary>Hints</summary>

- `atomic.Pointer[T]` (Go 1.19+) is exactly this.
- Store a `*T`; loads and stores are atomic.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

type Provider[T any] struct {
    p atomic.Pointer[T]
}

func NewProvider[T any](initial T) *Provider[T] {
    pr := &Provider[T]{}
    pr.p.Store(&initial)
    return pr
}

func (p *Provider[T]) Get() T { return *p.p.Load() }
func (p *Provider[T]) Set(t T) { p.p.Store(&t) }

type Config struct {
    Threshold int
    Mode      string
}

func main() {
    prov := NewProvider(Config{Threshold: 100, Mode: "v1"})

    done := make(chan struct{})
    go func() {
        for i := 0; i < 5; i++ {
            cfg := prov.Get()
            fmt.Printf("reader sees: %+v\n", cfg)
            time.Sleep(30 * time.Millisecond)
        }
        close(done)
    }()

    time.Sleep(60 * time.Millisecond)
    prov.Set(Config{Threshold: 200, Mode: "v2"})
    fmt.Println("config hot-swapped")

    <-done
}
```
</details>

**Discussion:** `atomic.Pointer[T]` makes hot-swap a one-liner with zero locking on the read path. Crucially: the swapped value should be *immutable* — never mutate the struct after publishing it, or you reintroduce the race. If you need to mutate, build a new copy and `Set` it. Run with `go run -race` to confirm.

---

## Task 14 — Test fixture factory with deterministic IDs

Tests need fresh, isolated data. Build a `UserFactory` for tests:

```go
type User struct {
    ID    int
    Name  string
    Email string
}

type UserFactory struct{ /* ... */ }

func NewUserFactory() *UserFactory
func (f *UserFactory) Build(opts ...UserOption) User
```

IDs should be sequential and reset per factory (so each test gets a fresh sequence).

**Acceptance criteria:**
- [ ] `Build()` returns a `User` with auto-incrementing `ID` and sensible defaults.
- [ ] `WithName`, `WithEmail` options override fields.
- [ ] Two factories produce independent ID streams.
- [ ] No randomness (deterministic).

<details><summary>Hints</summary>

- Factory holds a counter. Each `Build` increments it.
- Default name/email derive from the ID: `User 1`, `user-1@example.com`.
</details>

<details><summary>Solution</summary>

```go
package main

import "fmt"

type User struct {
    ID    int
    Name  string
    Email string
}

type UserOption func(*User)

func WithName(n string) UserOption  { return func(u *User) { u.Name = n } }
func WithEmail(e string) UserOption { return func(u *User) { u.Email = e } }

type UserFactory struct{ next int }

func NewUserFactory() *UserFactory { return &UserFactory{} }

func (f *UserFactory) Build(opts ...UserOption) User {
    f.next++
    u := User{
        ID:    f.next,
        Name:  fmt.Sprintf("User %d", f.next),
        Email: fmt.Sprintf("user-%d@example.com", f.next),
    }
    for _, opt := range opts {
        opt(&u)
    }
    return u
}

func main() {
    f := NewUserFactory()
    fmt.Println(f.Build())
    fmt.Println(f.Build(WithName("Alice")))
    fmt.Println(f.Build(WithEmail("custom@x.io")))

    // Independent stream
    g := NewUserFactory()
    fmt.Println(g.Build()) // ID == 1 again
}
```
</details>

**Discussion:** This pattern (factory-bot / object-mother) is invaluable for test code. Determinism beats randomness in tests: failing assertions are easier to read when `User 7` is always the same. The functional-options surface lets tests express "this user, but with field X overridden" without building from scratch.

---

## Task 15 — Mini-project: HTTP server with subsystem factories

Build a tiny HTTP server whose subsystems (storage, auth, logger) each have their own factory. `main` composes them.

**Layout (single `main.go` is fine; sketch the boundaries clearly):**

```go
// storage.go   - NewStorage(kind string) (Storage, error)
// auth.go      - NewAuth(kind string) (Auth, error)
// logger.go    - NewLogger(level string) *slog.Logger
// app.go       - App struct + handlers
// main.go      - reads env vars, builds subsystems, starts server
```

**Acceptance criteria:**
- [ ] Each subsystem is constructed by its own factory.
- [ ] `main` reads three env vars (`STORAGE`, `AUTH`, `LOG_LEVEL`) and assembles the app.
- [ ] One HTTP endpoint (`POST /items`) that writes through `Storage` and checks `Auth`.
- [ ] If any factory fails, the program exits with a clear error before binding the port.
- [ ] `go run` to a local port; `curl -X POST -H "Authorization: Bearer t1" localhost:8080/items -d 'hello'`.

<details><summary>Hints</summary>

- Each factory uses the registry pattern from Task 3 or a plain `switch` — your choice.
- `slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})`.
- Construct *every* dependency before `http.ListenAndServe` so startup failures are loud and early.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
    "io"
    "log/slog"
    "net/http"
    "os"
    "sync"
)

// ---------------- storage.go ----------------

type Storage interface {
    Put(key string, value []byte) error
}

type memStorage struct {
    mu   sync.Mutex
    data map[string][]byte
}

func (s *memStorage) Put(k string, v []byte) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.data[k] = v
    return nil
}

type stdoutStorage struct{}

func (stdoutStorage) Put(k string, v []byte) error {
    fmt.Printf("[stdout-storage] %s = %s\n", k, v)
    return nil
}

func NewStorage(kind string) (Storage, error) {
    switch kind {
    case "memory", "":
        return &memStorage{data: map[string][]byte{}}, nil
    case "stdout":
        return stdoutStorage{}, nil
    default:
        return nil, fmt.Errorf("NewStorage: unknown kind %q", kind)
    }
}

// ---------------- auth.go ----------------

type Auth interface {
    Check(token string) (user string, err error)
}

type staticAuth struct{ tokens map[string]string }

func (a *staticAuth) Check(t string) (string, error) {
    if u, ok := a.tokens[t]; ok {
        return u, nil
    }
    return "", errors.New("invalid token")
}

type noopAuth struct{}

func (noopAuth) Check(string) (string, error) { return "anonymous", nil }

func NewAuth(kind string) (Auth, error) {
    switch kind {
    case "static", "":
        return &staticAuth{tokens: map[string]string{
            "t1": "alice",
            "t2": "bob",
        }}, nil
    case "noop":
        return noopAuth{}, nil
    default:
        return nil, fmt.Errorf("NewAuth: unknown kind %q", kind)
    }
}

// ---------------- logger.go ----------------

func NewLogger(level string) (*slog.Logger, error) {
    var lvl slog.Level
    switch level {
    case "debug":
        lvl = slog.LevelDebug
    case "info", "":
        lvl = slog.LevelInfo
    case "warn":
        lvl = slog.LevelWarn
    case "error":
        lvl = slog.LevelError
    default:
        return nil, fmt.Errorf("NewLogger: unknown level %q", level)
    }
    h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl})
    return slog.New(h), nil
}

// ---------------- app.go ----------------

type App struct {
    Storage Storage
    Auth    Auth
    Log     *slog.Logger
}

func (a *App) handlePutItem(w http.ResponseWriter, r *http.Request) {
    tok := r.Header.Get("Authorization")
    if len(tok) > 7 && tok[:7] == "Bearer " {
        tok = tok[7:]
    }
    user, err := a.Auth.Check(tok)
    if err != nil {
        a.Log.Warn("auth failed", "err", err)
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "read failed", http.StatusBadRequest)
        return
    }
    key := r.URL.Path
    if err := a.Storage.Put(key, body); err != nil {
        a.Log.Error("storage put failed", "err", err)
        http.Error(w, "storage failed", http.StatusInternalServerError)
        return
    }
    a.Log.Info("item stored", "user", user, "key", key, "bytes", len(body))
    fmt.Fprintf(w, "ok user=%s key=%s\n", user, key)
}

func (a *App) Routes() http.Handler {
    mux := http.NewServeMux()
    mux.HandleFunc("POST /items/{name}", a.handlePutItem)
    return mux
}

// ---------------- main.go ----------------

func main() {
    storage, err := NewStorage(os.Getenv("STORAGE"))
    if err != nil {
        fmt.Fprintln(os.Stderr, "fatal:", err)
        os.Exit(1)
    }
    auth, err := NewAuth(os.Getenv("AUTH"))
    if err != nil {
        fmt.Fprintln(os.Stderr, "fatal:", err)
        os.Exit(1)
    }
    log, err := NewLogger(os.Getenv("LOG_LEVEL"))
    if err != nil {
        fmt.Fprintln(os.Stderr, "fatal:", err)
        os.Exit(1)
    }

    app := &App{Storage: storage, Auth: auth, Log: log}
    log.Info("server starting", "addr", ":8080")
    if err := http.ListenAndServe(":8080", app.Routes()); err != nil {
        log.Error("server stopped", "err", err)
        os.Exit(1)
    }
}
```

Run:

```
$ STORAGE=stdout AUTH=static LOG_LEVEL=info go run .
$ curl -X POST -H "Authorization: Bearer t1" localhost:8080/items/note -d 'hello'
ok user=alice key=/items/note
```
</details>

**Discussion:** Each subsystem has *one* factory; `main` is the only place that knows about env vars; the `App` struct only knows interfaces. Three payoffs:

- Swap storage from `memory` to `stdout` with an env var.
- Swap auth from real to noop in dev with an env var.
- Unit-test `App` by passing a fake `Storage` and fake `Auth` directly — no env, no factories.

Factories are the seam between *configuration* (strings, env vars, files) and *typed objects* (interfaces, structs). Keep that seam thin: factories should validate, construct, and return. They should not contain business logic — that belongs in the things they construct.

---

## Wrap-up

You've now used factories for: defaults, type selection, self-registering plugins, validated construction, panicking constructors, functional options, lazy initialization, abstract product families, first-class factory values, generic pools, cleanup-aware construction, context-bound lifecycles, hot-swappable values, deterministic test fixtures, and full-app composition.

The common thread: every factory is a *seam*. It separates the part of the code that decides *what* to build from the part that knows *how*. Put it at the boundaries of your program, keep it small, and let the constructed values carry the behaviour.
