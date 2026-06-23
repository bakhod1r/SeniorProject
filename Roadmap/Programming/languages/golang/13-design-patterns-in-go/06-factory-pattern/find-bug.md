# Factory Pattern — Find the Bug

## 1. How to use this file

Fifteen short scenarios. Each has a buggy factory. Read the code, identify the bug, then expand the answer to check. The bugs are *realistic* — every one of them has shipped to production somewhere.

Difficulty varies. Some are obvious panics waiting to happen; others are init-order subtleties that only bite when you reorganise packages or rerun a test suite.

---

## Bug 1 — Registry lookup without the `ok` check

```go
package storage

type Storage interface {
    Get(key string) ([]byte, error)
    Put(key string, val []byte) error
}

var registry = map[string]func() Storage{}

func Register(name string, factory func() Storage) {
    registry[name] = factory
}

func New(name string) Storage {
    return registry[name]()
}
```

Used:

```go
storage.Register("memory", func() Storage { return &MemStorage{} })
s := storage.New("redis") // typo, never registered
s.Put("k", []byte("v"))
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `registry[name]` returns the zero value when the key is missing — for a function type, that's `nil`. Calling `nil()` panics with `runtime error: invalid memory address or nil pointer dereference`. The error message says nothing about an unknown storage backend.

**Spot in review:** Any registry lookup that immediately invokes the value, with no `, ok` check and no nil guard. Map-of-functions patterns are particularly prone to this.

**Fix:**

```go
func New(name string) (Storage, error) {
    factory, ok := registry[name]
    if !ok {
        return nil, fmt.Errorf("storage: unknown backend %q", name)
    }
    return factory(), nil
}
```

**Why common:** "Registry pattern" tutorials often skip the `ok` check for brevity. The first time a config file has a typo, production goes down with a useless stack trace. Always treat registry lookups as fallible.
</details>

---

## Bug 2 — Factory returning concrete type via interface variable

```go
type Notifier interface {
    Notify(msg string) error
}

type SlackNotifier struct{ webhook string }
func (s *SlackNotifier) Notify(msg string) error { /* ... */ return nil }

func NewSlackNotifier(cfg Config) Notifier {
    var s *SlackNotifier
    if cfg.Webhook != "" {
        s = &SlackNotifier{webhook: cfg.Webhook}
    }
    return s
}
```

Used:

```go
n := NewSlackNotifier(Config{}) // empty config
if n == nil {
    fmt.Println("no notifier configured")
    return
}
n.Notify("hello")
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Typed nil. `NewSlackNotifier` returns an interface value containing a `*SlackNotifier` type descriptor and a nil pointer. The interface itself is non-nil (it has a type), so `n == nil` is false. `n.Notify(...)` dispatches through the itab, hits `(*SlackNotifier).Notify`, dereferences the nil receiver → panic.

**Spot in review:** Constructors that declare `var x *Concrete` and conditionally assign before returning an interface. The return type is interface; the variable is a concrete pointer.

**Fix:** Return an untyped nil when there's nothing to wrap:

```go
func NewSlackNotifier(cfg Config) Notifier {
    if cfg.Webhook == "" {
        return nil
    }
    return &SlackNotifier{webhook: cfg.Webhook}
}
```

Or — better — make the caller explicit about whether a notifier is optional, and return an error or use a no-op implementation rather than nil at all.

**Why common:** Idiomatic "declare zero values" advice clashes with interface returns. The bug hides until production triggers the empty-config path that tests never exercised.
</details>

---

## Bug 3 — Factory doing I/O in the constructor

```go
type Config struct {
    DB     *sql.DB
    Cache  *redis.Client
    Auth   *AuthService
}

func NewConfig() *Config {
    db, err := sql.Open("postgres", os.Getenv("DB_URL"))
    if err != nil { log.Fatal(err) }
    if err := db.Ping(); err != nil { log.Fatal(err) }

    cache := redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})
    if err := cache.Ping(context.Background()).Err(); err != nil { log.Fatal(err) }

    auth, err := dialAuthService(os.Getenv("AUTH_HOST"))
    if err != nil { log.Fatal(err) }

    return &Config{DB: db, Cache: cache, Auth: auth}
}

var defaultConfig = NewConfig() // package-level
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug 1 — Blocking startup:** The factory performs three network handshakes synchronously. If Redis is slow, the process boots slowly. If Redis is down, the process refuses to boot at all — even if the calling service doesn't need Redis right now.

**Bug 2 — Package-level evaluation:** `var defaultConfig = NewConfig()` runs at import time. Importing this package for *any* reason (including tests that only touch unrelated code) triggers all three handshakes. Tests can't run offline. Build pipelines that run `go test ./...` hit production network on import.

**Bug 3 — `log.Fatal`:** Using `log.Fatal` from a constructor calls `os.Exit(1)`, bypassing deferred cleanup. Tests can't recover; binaries can't gracefully degrade.

**Spot in review:** Constructors that open connections, ping endpoints, read disk, or run shell commands. Package-level `var x = NewSomething()` for anything non-trivial.

**Fix:**

```go
func NewConfig(ctx context.Context) (*Config, error) {
    db, err := sql.Open("postgres", os.Getenv("DB_URL"))
    if err != nil { return nil, fmt.Errorf("db: %w", err) }
    // Defer the Ping to first use, or do it here but return error not Fatal.
    cache := redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})
    auth, err := dialAuthService(ctx, os.Getenv("AUTH_HOST"))
    if err != nil { return nil, fmt.Errorf("auth: %w", err) }
    return &Config{DB: db, Cache: cache, Auth: auth}, nil
}
```

Call `NewConfig` from `main` with a timeout context. Don't evaluate it at package init.

**Why common:** "Just dial everything in `init`" feels tidy until the binary can't start during a partial outage. Constructors should *prepare* objects; `main` should *connect* them.
</details>

---

## Bug 4 — Eager construction in a type-selecting factory

```go
type Storage interface {
    Put(key string, value []byte) error
}

func NewStorage(cfg StorageConfig) Storage {
    mem := newMemoryStorage()
    disk, _ := newDiskStorage(cfg.DiskPath)
    redis := newRedisStorage(cfg.RedisAddr) // dials Redis
    s3 := newS3Storage(cfg.S3Bucket)       // opens HTTP client + IAM creds

    switch cfg.Backend {
    case "memory": return mem
    case "disk":   return disk
    case "redis":  return redis
    case "s3":     return s3
    }
    return mem
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Every backend is constructed, regardless of which one is selected. A config that says `Backend: "memory"` still dials Redis, opens an HTTP client to S3, fetches IAM credentials, and creates disk file handles. Three of the four are silently leaked — never used, never closed. Errors from `newDiskStorage` are even swallowed via `_`.

**Spot in review:** Type-selecting factories where every branch is built before the `switch` chooses one. Look for `_` on errors that follow.

**Fix:** Construct only the selected backend:

```go
func NewStorage(cfg StorageConfig) (Storage, error) {
    switch cfg.Backend {
    case "memory": return newMemoryStorage(), nil
    case "disk":   return newDiskStorage(cfg.DiskPath)
    case "redis":  return newRedisStorage(cfg.RedisAddr)
    case "s3":     return newS3Storage(cfg.S3Bucket)
    default:       return nil, fmt.Errorf("unknown backend: %q", cfg.Backend)
    }
}
```

**Why common:** Refactoring a constructor that initially returned a struct (`return Storage{mem, disk, redis, s3}`) into one that picks. The author forgets to move the construction into the branches. Tests pass because all backends *also* work, but operations get a Redis bill they didn't expect.
</details>

---

## Bug 5 — Factory sharing the caller's map without copying

```go
type Service struct {
    options map[string]string
}

func (s *Service) Get(key string) string { return s.options[key] }

func NewService(opts map[string]string) *Service {
    return &Service{options: opts}
}
```

Used:

```go
opts := map[string]string{"region": "us-east-1"}
svc := NewService(opts)

// Later, somewhere else, totally unrelated code:
opts["region"] = "eu-west-2"

fmt.Println(svc.Get("region")) // eu-west-2, not us-east-1
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Maps in Go are reference types. The factory stores the *caller's* map directly. Any later mutation by the caller — or any other holder of that map — is reflected inside the service. The service has no encapsulation; its internal state is rented from its constructor.

This isn't just a hypothetical. A test setup that builds an `opts` map, passes it to several services, and then mutates it for the next test case will accidentally mutate the previous services too.

**Spot in review:** Factories that accept maps, slices, or any other reference type and store them by direct assignment. Same pattern with channels and function values is also a smell.

**Fix:** Defensive copy at the boundary:

```go
func NewService(opts map[string]string) *Service {
    copied := make(map[string]string, len(opts))
    for k, v := range opts {
        copied[k] = v
    }
    return &Service{options: copied}
}
```

Alternatively, switch to functional options or a builder, which forces the construction-time vs runtime separation explicitly.

**Why common:** Devs write `s.options = opts` thinking they've "stored" the map — they've stored a reference. The bug is invisible until two pieces of code mutate the same map for different reasons.
</details>

---

## Bug 6 — Factory using package-level state

```go
package logger

var (
    level    = "info"
    output   = os.Stdout
    instance *Logger
)

func SetLevel(l string)     { level = l }
func SetOutput(w io.Writer) { output = w }

func New() *Logger {
    if instance == nil {
        instance = &Logger{level: level, out: output}
    }
    return instance
}
```

Used:

```go
// in main:
logger.SetLevel("debug")
log := logger.New()

// in a test:
func TestLogger(t *testing.T) {
    logger.SetLevel("error")
    log := logger.New()
    if log.level != "error" { t.Fatal("expected error") }
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug 1 — Test pollution:** `level` and `output` are package-level variables shared by every caller and every test. The test sets `level = "error"`. The *next* test runs with `level = "error"` still in effect, even though it never asked for it. Test outcomes depend on execution order — exactly what Go's `go test -run X` parallelism is supposed to avoid.

**Bug 2 — Cached instance ignores later changes:** `instance` is cached on first `New()`. After the first call, `SetLevel("debug")` has no effect — the cached logger keeps its old level. The setter looks like it works (no error) but silently does nothing.

**Bug 3 — Race condition:** `level`, `output`, and `instance` are mutated and read without synchronisation. Two goroutines calling `New()` concurrently can both see `instance == nil`.

**Spot in review:** Package-level mutable variables touched by both factories and setters. Cached singletons constructed from mutable globals. Any factory whose behaviour depends on the call order across the program.

**Fix:** Return a fresh logger configured by parameters, not by reading package globals:

```go
type Config struct {
    Level  string
    Output io.Writer
}

func New(cfg Config) *Logger {
    return &Logger{level: cfg.Level, out: cfg.Output}
}
```

Tests construct their own logger with their own config — no globals to pollute.

**Why common:** "Convenience" globals creep in early ("we only need one logger") and metastasise. Refactoring later is painful: every caller must learn to construct config explicitly.
</details>

---

## Bug 7 — Factory spawning a goroutine without cleanup

```go
type Worker struct {
    queue chan Job
}

func NewWorker(bufSize int) *Worker {
    w := &Worker{queue: make(chan Job, bufSize)}
    go w.run()
    return w
}

func (w *Worker) run() {
    for job := range w.queue {
        job.Execute()
    }
}

func (w *Worker) Submit(j Job) { w.queue <- j }
```

Used:

```go
for _, req := range incomingRequests {
    w := NewWorker(10)
    w.Submit(req.ToJob())
    // ... no Close, no way to stop the goroutine
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Goroutine leak. Every `NewWorker` spawns a goroutine that lives forever — the `for job := range w.queue` loop only exits when `w.queue` is *closed*, and nothing ever closes it. As more workers are created, more goroutines accumulate.

A subtler problem: the goroutine retains a reference to `w.queue`, which in turn keeps `w` alive. The worker can't be garbage-collected even when no one holds a reference to it. The constructor has effectively pinned the object forever.

**Spot in review:** Factories that contain `go ...` without exposing a `Close()` method or accepting a `ctx context.Context`. Any object that owns a goroutine needs an explicit lifecycle.

**Fix:** Provide a shutdown mechanism:

```go
type Worker struct {
    queue chan Job
}

func NewWorker(bufSize int) *Worker {
    w := &Worker{queue: make(chan Job, bufSize)}
    go w.run()
    return w
}

func (w *Worker) Close() { close(w.queue) }
```

Callers `defer w.Close()`. The `run` loop exits when the channel is drained.

For long-lived workers, accept a `context.Context`:

```go
func NewWorker(ctx context.Context, bufSize int) *Worker {
    w := &Worker{queue: make(chan Job, bufSize)}
    go w.run(ctx)
    return w
}

func (w *Worker) run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done(): return
        case job := <-w.queue: job.Execute()
        }
    }
}
```

**Why common:** Starting background work in a constructor is convenient — and dangerously asymmetric. Construction is one line; cleanup is forgotten. In long-running servers the leak goes unnoticed; in tests it accumulates until the process runs out of memory.
</details>

---

## Bug 8 — Lazy init with a mutex on the fast path

```go
type Service struct {
    mu     sync.Mutex
    client *HTTPClient
}

func (s *Service) Client() *HTTPClient {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.client == nil {
        s.client = NewHTTPClient()
    }
    return s.client
}
```

Used millions of times per second.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Every call to `Client()` acquires and releases the mutex — even after `client` is initialised and will never change again. The fast path (the 99.999% of calls that just read the pointer) is bottlenecked through a single lock. Under contention, throughput collapses.

The mutex *is* correct in the sense that it prevents the race. The cost is that it makes every read serial, even when nothing is being written.

**Spot in review:** Mutex-guarded lazy init in hot paths. The signature is "always lock to read".

**Fix:** `sync.Once` is purpose-built for this. After the first call, subsequent calls take no lock at all — they hit a fast atomic check.

```go
type Service struct {
    once   sync.Once
    client *HTTPClient
}

func (s *Service) Client() *HTTPClient {
    s.once.Do(func() { s.client = NewHTTPClient() })
    return s.client
}
```

`sync.Once.Do` uses a done flag protected by atomics on the fast path; the lock is only taken during the first call.

For Go 1.21+, `sync.OnceValue[T]` is even cleaner:

```go
var clientOnce = sync.OnceValue(func() *HTTPClient { return NewHTTPClient() })
```

**Why common:** Devs reach for `sync.Mutex` as the obvious synchronisation primitive. `sync.Once` is "the same thing but specialised", and the specialisation matters in hot code paths. The mutex version is correct *and* slow; the once version is correct *and* fast.
</details>

---

## Bug 9 — `sync.Once` but reading the result outside `Do`

```go
type Service struct {
    once   sync.Once
    client *HTTPClient
}

func (s *Service) initClient() {
    s.once.Do(func() { s.client = NewHTTPClient() })
}

func (s *Service) Client() *HTTPClient {
    s.initClient()
    return s.client
}

func (s *Service) Replace(c *HTTPClient) {
    s.client = c // ?!
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `sync.Once` guarantees the initialiser runs exactly once — but it *doesn't* synchronise reads/writes that happen outside its `Do`. The `Replace` method writes `s.client` without going through the once, and `Client` reads `s.client` directly. Concurrent `Client()` and `Replace()` calls race on the pointer.

Go's memory model says writes outside synchronisation primitives don't have a happens-before relationship with reads outside them. `Client()` may see a torn or stale `s.client`. Go's race detector flags this.

**Spot in review:** `sync.Once` field paired with any other code that writes the same field. The Once protects the initial assignment; nothing protects subsequent ones.

**Fix:** If the field can change after initialisation, `sync.Once` isn't the right primitive — use `sync.RWMutex` or `atomic.Pointer[T]`:

```go
type Service struct {
    client atomic.Pointer[HTTPClient]
}

func (s *Service) Client() *HTTPClient {
    if c := s.client.Load(); c != nil { return c }
    newC := NewHTTPClient()
    if !s.client.CompareAndSwap(nil, newC) {
        // someone else won; discard ours
        newC.Close()
    }
    return s.client.Load()
}

func (s *Service) Replace(c *HTTPClient) {
    s.client.Store(c)
}
```

If the field truly *never* changes after init, then `Replace` shouldn't exist — remove it.

**Why common:** `sync.Once` is treated as a magic wrapper around any field. Reality: it only synchronises one specific function's execution. Concurrent writes from elsewhere are unprotected, and the race detector is the only thing that catches it.
</details>

---

## Bug 10 — Init order across packages

```go
// package config
package config

var DefaultTimeout = parseDuration(os.Getenv("TIMEOUT"))

func parseDuration(s string) time.Duration {
    if s == "" { return 5 * time.Second }
    d, _ := time.ParseDuration(s)
    return d
}

// package client
package client

import "myapp/config"

var defaultClient = NewClient(config.DefaultTimeout)

func NewClient(timeout time.Duration) *Client { /* ... */ }
```

Used:

```go
// package main
package main

import _ "myapp/client"

func main() { /* ... */ }
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** This *happens* to work today — Go guarantees that an imported package's `init` and var initialisers complete before the importer's do. The catch: the design *assumes* a strict ordering, and any change to it can break silently.

Specifically:
- If `parseDuration` is later moved into an `init()` function (e.g., to capture more env vars), things still work — `init()` runs before importers' vars are evaluated.
- But if `config` later adds another package-level var that itself imports something circular, or if someone adds `var DefaultTimeout = computeFromConfig(LoadConfig())` where `LoadConfig` has its own init dependencies, the order can become impossible to satisfy and you get cycles or unexpected zero values.
- Worse, if the var is *moved* from `config` to `client` itself, or if a developer adds `var x = client.NewClient(config.DefaultTimeout)` *in package config*, you get an import cycle that the Go compiler rejects with no clear hint about what depended on what.

The bigger lurking bug: `defaultClient` is initialised when `client` is imported, which is before `main` runs. If `config.DefaultTimeout` is later changed to depend on a flag that's parsed in `main.init` (which runs *after* var initialisers in the same package, but before `main()` itself), the client is built with the wrong timeout.

**Spot in review:** Package-level vars whose values depend on other packages' state. Any factory called at package scope. Any `init()` that reads env vars or flags.

**Fix:** Defer construction to `main`:

```go
func main() {
    cfg := config.Load() // explicit, reads env/flags
    client := NewClient(cfg.Timeout)
    run(client)
}
```

No package-level `defaultClient`, no implicit ordering. The dependency graph is whatever `main` says it is.

**Why common:** Convenience. "We always need a default client, let's pre-build it." Then the env var changes, or a flag is added, or two packages import each other transitively — and the order silently shifts. Init-order bugs are the hardest to diagnose because the symptom is "wrong value" without any stack trace pointing at the cause.
</details>

---

## Bug 11 — Factory calling `log.Fatal` instead of returning an error

```go
func NewServer(cfg ServerConfig) *Server {
    if cfg.Port == 0 {
        log.Fatal("port must be set")
    }
    listener, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.Port))
    if err != nil {
        log.Fatalf("listen: %v", err)
    }
    return &Server{listener: listener}
}
```

Used:

```go
func TestServer(t *testing.T) {
    srv := NewServer(ServerConfig{Port: 0}) // intentional, to test the error path
    if srv != nil { t.Fatal("expected nil") }
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `log.Fatal` calls `os.Exit(1)`. Deferred cleanup doesn't run. The test process exits with status 1 — the test runner reports it as a generic failure, with no `t.Fatal` message and no recoverable diagnostic. You can't write a test that *asserts the failure*.

Worse, `os.Exit` from a library means library users can't choose how to handle the failure. If the same `NewServer` is reused inside a CLI tool that wants to print a friendly error and exit cleanly, `log.Fatal` defeats that.

**Spot in review:** Any factory (or library function in general) that calls `log.Fatal`, `log.Panic`, or `os.Exit`. Libraries return errors; only `main` decides whether to exit.

**Fix:**

```go
func NewServer(cfg ServerConfig) (*Server, error) {
    if cfg.Port == 0 {
        return nil, errors.New("port must be set")
    }
    listener, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.Port))
    if err != nil {
        return nil, fmt.Errorf("listen on port %d: %w", cfg.Port, err)
    }
    return &Server{listener: listener}, nil
}
```

Now the test can assert on the error type or message, and CLI callers can decide their own exit behaviour.

**Why common:** Developers prototyping a binary write `log.Fatal` because the function is only called from `main`. Then someone else reuses the function from a test, or from another binary, and the `Fatal` propagates everywhere. The fix is mechanical but the discipline (errors flow up, exits happen only in `main`) requires team convention.
</details>

---

## Bug 12 — Factory returning interface when concrete is needed

```go
package storage

type Storage interface {
    Get(key string) ([]byte, error)
    Put(key string, val []byte) error
}

type S3Storage struct {
    bucket string
    client *s3.Client
}

func (s *S3Storage) Get(k string) ([]byte, error) { /* ... */ return nil, nil }
func (s *S3Storage) Put(k string, v []byte) error { /* ... */ return nil }

// S3-specific:
func (s *S3Storage) Presign(key string, ttl time.Duration) (string, error) { /* ... */ return "", nil }
func (s *S3Storage) ListPrefix(prefix string) ([]string, error)            { /* ... */ return nil, nil }

func NewS3Storage(bucket string) Storage {
    return &S3Storage{bucket: bucket}
}
```

Used elsewhere:

```go
s := storage.NewS3Storage("my-bucket")
// I need Presign...
url, err := s.Presign("key", time.Hour) // doesn't compile
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `NewS3Storage` returns the *narrow* `Storage` interface. The caller has lost access to S3-specific methods like `Presign` and `ListPrefix`. To use them, they'd have to type-assert: `s.(*S3Storage).Presign(...)`, which couples the call site to the concrete type *and* loses static type safety (a wrong assertion panics).

The general Go guideline is "accept interfaces, return structs" — *especially* for constructors. The factory should return `*S3Storage`. Callers that only need the narrow `Storage` interface can assign to one. Callers that need `Presign` get it for free.

**Spot in review:** Factories whose return type is an interface narrower than the struct's full method set. Especially common when authors over-apply "return interfaces" advice.

**Fix:**

```go
func NewS3Storage(bucket string) *S3Storage {
    return &S3Storage{bucket: bucket}
}
```

Now `*S3Storage` is returned. Wherever a `Storage` is needed, Go's structural typing assigns it implicitly:

```go
var s storage.Storage = storage.NewS3Storage("bkt")
```

**Why common:** "Always return interfaces" is a Java/C# habit. In Go, it strips information from the caller. The right rule: *consumers* take interfaces (so they can be mocked); *constructors* return concrete types (so all methods stay reachable).

Exception: if the factory is *type-selecting* (returns one of several concrete types), it must return an interface — there's no concrete type to return. That's a different situation from this one.
</details>

---

## Bug 13 — Duplicate registration silently overwrites

```go
var registry = map[string]func() Handler{}

func Register(name string, factory func() Handler) {
    registry[name] = factory
}

// in package a:
func init() { Register("json", newJSONHandler) }

// in package b:
func init() { Register("json", newOtherJSONHandler) } // !
```

After both packages are imported (via blank imports), which JSON handler does `registry["json"]()` produce?

<details><summary>Answer</summary>

**Bug:** Whichever package's `init` ran *last* wins. Map assignment overwrites silently. The first registration is gone — no error, no warning, no log line. Worse, init order across packages is non-deterministic across builds (Go specifies init order within a package but the order between unrelated packages is implementation-defined when they share no import relationship).

So `registry["json"]` might be `newJSONHandler` in one build and `newOtherJSONHandler` in the next. Tests pass locally, fail in CI, depending on which import order the linker happened to produce.

**Spot in review:** `Register` functions that take a name and overwrite without checking. `map[K]V` assignments in init code with no guard against duplicates.

**Fix:** Reject duplicates loudly:

```go
func Register(name string, factory func() Handler) {
    if _, exists := registry[name]; exists {
        panic(fmt.Sprintf("handler %q already registered", name))
    }
    registry[name] = factory
}
```

Yes, `panic` from `init` is heavy — but the alternative is a silent, undetectable conflict. The panic forces the developer to rename one of the conflicting registrations. Production never starts with two registrations claiming the same key.

A gentler alternative is to log a warning and refuse the second registration. The point is: don't silently overwrite.

**Why common:** Plugin-style architectures encourage "blind" registration: each package registers its handler in `init`, and the package importing them assumes uniqueness. The day two packages choose the same name (a refactor, a fork, a typo), the bug is invisible until production behaviour diverges.
</details>

---

## Bug 14 — `NewX` factory secretly returning a singleton

```go
var singleton *Cache

func NewCache(maxSize int) *Cache {
    if singleton == nil {
        singleton = &Cache{maxSize: maxSize, entries: map[string][]byte{}}
    }
    return singleton
}
```

Used:

```go
a := NewCache(100)
b := NewCache(50)
a.Put("k", []byte("v"))
fmt.Println(b.Get("k")) // surprise: returns "v"
fmt.Println(b.MaxSize())  // surprise: 100, not 50
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The constructor name is `NewCache` — by Go convention, callers expect each call to return a fresh instance. Reality: every call returns the same `singleton`. The `maxSize` parameter is silently ignored after the first call. Mutating `a` mutates `b`.

This is a singleton in disguise. Singletons should be named to make their nature obvious — `DefaultCache`, `SharedCache`, or accessed via a package-level getter (`cache.Default()`). `New...` should always allocate.

**Spot in review:** `New...` factories with package-level state that lazily initialises and caches. Any factory that ignores its parameters on subsequent calls.

**Fix:** Two options.

Option A — actually create a new one each time:

```go
func NewCache(maxSize int) *Cache {
    return &Cache{maxSize: maxSize, entries: map[string][]byte{}}
}
```

Option B — keep the singleton but name it honestly:

```go
var (
    defaultCache     *Cache
    defaultCacheOnce sync.Once
)

func Default() *Cache {
    defaultCacheOnce.Do(func() {
        defaultCache = &Cache{maxSize: 1024, entries: map[string][]byte{}}
    })
    return defaultCache
}
```

Now callers see `cache.Default()` and understand they're getting a shared instance.

**Why common:** Devs add "small optimisation: reuse the cache" without renaming the factory. The signature lies; the caller is misled. The first time two unrelated parts of the program share the cache and step on each other, the bug surfaces — usually at the worst possible time.
</details>

---

## Bug 15 — Test polluting a global registry

```go
// package codec
package codec

var registry = map[string]Codec{}

func Register(name string, c Codec) { registry[name] = c }
func Lookup(name string) (Codec, bool) {
    c, ok := registry[name]
    return c, ok
}

// in codec_test.go:
func TestJSONCodec(t *testing.T) {
    Register("json", fakeJSONCodec{})
    c, _ := Lookup("json")
    if _, err := c.Encode(map[string]string{"k": "v"}); err != nil {
        t.Fatal(err)
    }
}

// in another_test.go (same package):
func TestUsesJSON(t *testing.T) {
    c, _ := Lookup("json")
    _, _ = c.Encode(realData) // uses leftover fake from TestJSONCodec
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Tests share package-level state. `TestJSONCodec` registers a fake. The registry is never reset. `TestUsesJSON` reads the *fake* JSON codec, not the real one. If `go test -run TestUsesJSON` is run in isolation, it might fail (no fake registered) or pass (real codec is registered by an `init`). Run together, the behaviour depends on order.

`go test` runs tests within a package serially by default, in source order — so the bug is partly hidden. But:
- `-shuffle` flips the order.
- `-run` filters can isolate one test without the prior setup.
- A subtest in `TestJSONCodec` failing midway can leave the registry in an undefined state.
- Parallel tests (`t.Parallel()`) interleave and race on the registry.

**Spot in review:** Tests that mutate package globals without restoring them. Test setup that registers fakes without `t.Cleanup`. Any registry that's modified in test code.

**Fix:** Restore state after the test:

```go
func TestJSONCodec(t *testing.T) {
    prev, hadPrev := registry["json"]
    Register("json", fakeJSONCodec{})
    t.Cleanup(func() {
        if hadPrev {
            registry["json"] = prev
        } else {
            delete(registry, "json")
        }
    })
    // ... test body
}
```

A better long-term fix: don't have a global registry at all. Pass a `*Registry` into anything that needs one. Tests construct their own:

```go
func TestJSONCodec(t *testing.T) {
    r := NewRegistry()
    r.Register("json", fakeJSONCodec{})
    // assertions on r
}
```

Now there is nothing shared between tests, and `t.Cleanup` becomes unnecessary.

**Why common:** Package-level registries are a convenient pattern for plugin discovery (`init()` registers the codec, `main` looks it up). Tests then must mutate that shared registry — and once mutation is in play, isolation breaks. The solution is either explicit cleanup (laborious, easy to forget) or replacing the global with an injected dependency.
</details>

---

## Summary

Three families of bugs in this set:

**Lookup and return-shape bugs** (1, 2, 12, 14): The factory returns the wrong thing — nil func, typed nil, narrow interface, or a singleton in disguise. Cure: be explicit about what the factory produces and how the caller will use it.

**Initialisation-cost bugs** (3, 4, 7, 10): The factory does more than it should — I/O, eager construction, leaked goroutines, hidden init-order dependencies. Cure: constructors *prepare*, `main` *connects*. Defer cost; expose lifecycle.

**State and concurrency bugs** (5, 6, 8, 9, 11, 13, 15): The factory shares mutable state — caller's map, package globals, registry entries, race conditions during lazy init. Cure: copy at the boundary, prefer `sync.Once` over manual locks, avoid package-level mutable state, and never silently overwrite.

**Review checklist:**
- [ ] Registry lookups use `, ok` and return an error on miss.
- [ ] Constructors returning interfaces don't accidentally return typed nil.
- [ ] No I/O in package-level var initialisers.
- [ ] Type-selecting factories build only the selected backend.
- [ ] Reference-type parameters (maps, slices) are defensively copied.
- [ ] No package-level mutable state read by factories.
- [ ] Goroutines started in constructors have a `Close()` or `ctx` for shutdown.
- [ ] Lazy init uses `sync.Once` / `sync.OnceValue`, not a hot-path mutex.
- [ ] `sync.Once`-protected fields aren't written elsewhere outside the Once.
- [ ] Cross-package factories don't rely on package-level var init order.
- [ ] Factories return errors; they don't call `log.Fatal`.
- [ ] Concrete-returning constructors stay concrete; only type-selecting factories return interfaces.
- [ ] `Register` rejects duplicate names loudly.
- [ ] `New...` always allocates; singletons are named honestly.
- [ ] Tests that mutate global registries restore them with `t.Cleanup`.

If you reviewed factory code with this checklist, you'd catch most of the bugs above before they reached production.
