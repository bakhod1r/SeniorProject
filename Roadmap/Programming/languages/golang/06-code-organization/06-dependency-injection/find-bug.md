# Dependency Injection — Find the Bug

> Each snippet contains a real-world DI bug in Go. Find it, explain it, fix it.

---

## Bug 1 — Typed nil through an interface

```go
type Logger interface{ Log(string) }

type RealLogger struct{ /* config */ }

func (l *RealLogger) Log(msg string) { /* writes somewhere */ }

func NewService(l Logger) *Service {
    if l == nil {
        l = noopLogger{}
    }
    return &Service{logger: l}
}

func startup() {
    var rl *RealLogger // forgot to construct it
    svc := NewService(rl)
    svc.logger.Log("hello") // panics
}
```

**Bug:** `rl` is a *typed nil* — its dynamic type is `*RealLogger`, its value is `nil`. When passed to `NewService`, the interface value `l` becomes `(*RealLogger, nil)`, which is **not** equal to the untyped `nil`. The fallback to `noopLogger{}` is skipped. The first call dispatches into the method on `*RealLogger` with a nil receiver and panics.

**Fix:** never let a typed nil cross the interface boundary. Assign a real default *before* the conditional:

```go
func startup() {
    var rl Logger = noopLogger{}
    if shouldLog() {
        rl = NewRealLogger()
    }
    NewService(rl)
}
```

Alternatively, ensure constructors always return an interface-typed value, never a typed nil.

---

## Bug 2 — Service locator masquerading as DI

```go
var deps = map[string]any{}

func Register(key string, v any) { deps[key] = v }

type OrderService struct{}

func (OrderService) Cancel(id string) error {
    repo := deps["orderRepo"].(OrderRepo) // hidden dependency
    return repo.Delete(id)
}
```

**Bug:** `OrderService` advertises itself as taking no dependencies but reaches into a global `deps` map. This is a service locator. The function signature lies; tests must mutate a global; parallel tests race; missing keys panic at runtime.

**Fix:** make the dependency explicit in the constructor.

```go
type OrderService struct{ repo OrderRepo }

func NewOrderService(repo OrderRepo) *OrderService { return &OrderService{repo: repo} }

func (s *OrderService) Cancel(id string) error { return s.repo.Delete(id) }
```

Delete the global `deps` map. Wire `OrderService` from `main`.

---

## Bug 3 — `init()` opens a database

```go
package db

import "database/sql"

var Conn *sql.DB

func init() {
    var err error
    Conn, err = sql.Open("postgres", "postgres://localhost/app")
    if err != nil { panic(err) }
}
```

**Bug:** `init()` runs at package import. Importing this package — even from a test that does not need the DB — triggers a connection attempt and panics if the DB is unreachable. There is no way to override the DSN, no way to test without a live DB, and no way to skip the connection.

**Fix:** move construction into `main`. The package exposes a constructor instead.

```go
package db

func Open(dsn string) (*sql.DB, error) {
    return sql.Open("postgres", dsn)
}
```

`main` calls `db.Open(cfg.DSN)` and passes the result to whoever needs it.

---

## Bug 4 — Cyclic providers

```go
type A struct{ b *B }
type B struct{ a *A }

func NewA(b *B) *A { return &A{b: b} }
func NewB(a *A) *B { return &B{a: a} }

func main() {
    // How do you build either?
    a := NewA(nil)
    b := NewB(a)
    a.b = b // tying the knot post-hoc
}
```

**Bug:** `A` needs `B` and `B` needs `A`. There is no order in which both constructors can be called legitimately. The "tying the knot" workaround leaves `A.b` nil for an instant, which any concurrent consumer of `A` sees as a bug.

If you wired this into `wire`, `wire` would refuse to compile with a cycle error.

**Fix:** decouple via an interface and a third type, or merge `A` and `B`.

```go
// Option 1: interface seam.
type BCallable interface { DoB() }

type A struct{ b BCallable }
func NewA(b BCallable) *A { return &A{b: b} }

// B no longer needs A; it is given what it needs at call time.
type B struct{}
func (B) DoB() {}
func NewB() *B { return &B{} }
```

Option 2 is to recognise that `A` and `B` are the same logical thing and merge them.

---

## Bug 5 — Constructor with hidden network call

```go
func NewMailer(addr string) (*Mailer, error) {
    conn, err := net.Dial("tcp", addr) // bad: side effect
    if err != nil { return nil, err }
    return &Mailer{conn: conn}, nil
}
```

**Bug:** `NewMailer` opens a TCP connection during construction. Tests cannot construct a `Mailer` without a real network. Wiring code is now ordering-sensitive (must be done after the network is available). Any timeout or failure mid-startup leaks the connection.

**Fix:** accept an already-open connection, or split into construction and `Connect`.

```go
type Mailer struct{ conn net.Conn }

func NewMailer(conn net.Conn) *Mailer { return &Mailer{conn: conn} }

// or:
func NewMailer() *Mailer { return &Mailer{} }
func (m *Mailer) Connect(addr string) error { ... }
```

`main` opens the connection, passes it into the constructor, and tracks the cleanup.

---

## Bug 6 — Fake drift

```go
// repo.go
type UserRepo interface {
    Get(ctx context.Context, id string) (User, error)
    Save(ctx context.Context, u User) error
    Delete(ctx context.Context, id string) error // recently added
}

// service_test.go
type fakeUserRepo struct{ /* in-memory map */ }

func (f *fakeUserRepo) Get(ctx context.Context, id string) (User, error) { ... }
func (f *fakeUserRepo) Save(ctx context.Context, u User) error           { ... }
// Delete is missing — test compiles because *fakeUserRepo is never assigned to UserRepo.
```

**Bug:** the test happens to pass because `service` accepts a struct directly or through a less-strict interface, and the missing method is never called. When a future test or refactor relies on the `UserRepo` interface, the fake silently fails to satisfy it.

**Fix:** add a compile-time assertion at the top of the test file.

```go
var _ UserRepo = (*fakeUserRepo)(nil)
```

If any method is missing or has a wrong signature, the test file fails to compile.

---

## Bug 7 — Singleton mutated by tests

```go
var Default = &Service{retries: 3}

func TestSomething(t *testing.T) {
    Default.retries = 0 // for this test
    // ... test runs
    Default.retries = 3 // restore
}

func TestParallel(t *testing.T) {
    t.Parallel()
    if Default.retries != 3 { t.Fatal(...) } // sometimes fails
}
```

**Bug:** `Default` is a package-level singleton. Tests mutate and "restore" it, but `t.Parallel()` lets multiple tests run concurrently; they race on the same struct.

**Fix:** stop relying on a default. Construct what you need per test.

```go
func TestSomething(t *testing.T) {
    svc := New(Options{Retries: 0})
    // ...
}

func TestParallel(t *testing.T) {
    t.Parallel()
    svc := New(Options{Retries: 3})
    // ...
}
```

If `Default` is genuinely needed for non-test callers, keep it but make all internal logic accept a passed-in `*Service` instead of reaching into the global.

---

## Bug 8 — `wire.Build` with missing provider

```go
//go:build wireinject

func InitializeApp() (*Service, error) {
    panic(wire.Build(
        config.Load,
        infra.OpenDB,
        // forgot: repo.NewUsers
        service.New, // requires *Users
    ))
}
```

```
$ wire ./...
wire: example.com/app: inject InitializeApp:
        no provider found for *repo.Users
```

**Bug:** `service.New` declares it needs `*repo.Users`, but no provider for that type is in the set.

**Fix:** add the missing provider.

```go
panic(wire.Build(
    config.Load,
    infra.OpenDB,
    repo.NewUsers,
    service.New,
))
```

This is the failure mode `wire` exists to make impossible: the build cannot succeed until you supply the missing piece.

---

## Bug 9 — `wire.Bind` ambiguity

```go
var Set = wire.NewSet(
    repo.NewPostgresUsers,
    repo.NewSQLiteUsers, // dev mode
    service.New,         // takes orders.UserRepo
)
```

```
$ wire ./...
wire: multiple providers for *repo.PostgresUsers and *repo.SQLiteUsers
        both bind orders.UserRepo
```

**Bug:** two providers produce types satisfying the same interface, with no `wire.Bind` to pick one.

**Fix:** make the binding explicit.

```go
var Set = wire.NewSet(
    repo.NewPostgresUsers,
    wire.Bind(new(orders.UserRepo), new(*repo.PostgresUsers)),
    service.New,
)

// In a separate set used only for dev:
var DevSet = wire.NewSet(
    repo.NewSQLiteUsers,
    wire.Bind(new(orders.UserRepo), new(*repo.SQLiteUsers)),
    service.New,
)
```

Or pass the choice in via a function selector and use `wire.Value`/`wire.InterfaceValue`.

---

## Bug 10 — `fx` lifecycle hook leaks goroutine on shutdown

```go
func startWorker(lc fx.Lifecycle, w *Worker) {
    lc.Append(fx.Hook{
        OnStart: func(ctx context.Context) error {
            go w.Loop()
            return nil
        },
        OnStop: nil, // forgot to stop it
    })
}
```

**Bug:** `OnStart` spawns a goroutine running `w.Loop()`. There is no `OnStop` hook to signal shutdown. `App.Stop()` returns successfully but the goroutine continues until the process exits, possibly holding open files or DB connections.

**Fix:** wire shutdown into the worker.

```go
func startWorker(lc fx.Lifecycle, w *Worker) {
    ctx, cancel := context.WithCancel(context.Background())
    lc.Append(fx.Hook{
        OnStart: func(_ context.Context) error {
            go w.Loop(ctx)
            return nil
        },
        OnStop: func(_ context.Context) error {
            cancel()
            w.WaitDone() // worker's own quiescence signal
            return nil
        },
    })
}
```

Goroutines started by lifecycle hooks must have a corresponding `OnStop` that joins them.

---

## Bug 11 — Constructor returning a partially-constructed value on error

```go
func NewService(repo Repo, cache Cache) (*Service, error) {
    s := &Service{repo: repo, cache: cache}
    if err := s.Warm(); err != nil {
        return s, err // bug: returns non-nil *Service alongside non-nil error
    }
    return s, nil
}
```

```go
svc, err := NewService(repo, cache)
if err != nil {
    log.Println(err)
    // svc is non-nil here — easy mistake to use it
}
svc.DoSomething() // panics if Warm left s in a bad state
```

**Bug:** Go's convention is that on error, the value return is the zero value (or nil for pointers). Returning a non-nil `*Service` alongside an error invites callers to use it.

**Fix:** return nil on error.

```go
if err := s.Warm(); err != nil {
    return nil, fmt.Errorf("warm: %w", err)
}
return s, nil
```

If a partially-constructed value is genuinely useful for diagnostics, document it loudly — but the default convention is "nil on error".

---

## Bug 12 — DI graph re-creating singletons per request

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    db, _ := sql.Open("postgres", dsn)   // per-request!
    repo := NewUserRepo(db)              // per-request!
    svc := NewService(repo)              // per-request!
    svc.Handle(w, r)
}
```

**Bug:** the handler re-builds the entire dependency tree on every request. `sql.Open` does not actually open a connection but it allocates a driver state; called per-request, it leaks. `NewUserRepo` and `NewService` allocate fresh structs; the cumulative GC pressure is real.

The author intended to "use DI" but inverted it: instead of constructing once and injecting, they construct on every call.

**Fix:** construct once in `main`, store in a struct, methods take `*http.Request`.

```go
type Server struct{ svc *Service }

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    s.svc.Handle(w, r)
}

func main() {
    db, _ := sql.Open("postgres", dsn)
    repo := NewUserRepo(db)
    svc := NewService(repo)
    srv := &Server{svc: svc}
    http.HandleFunc("/", srv.handle)
    http.ListenAndServe(":8080", nil)
}
```

---

## Bug 13 — Interface defined on the producer instead of the consumer

```go
// internal/postgres/users.go
package postgres

type UserRepo interface { // 47 methods
    GetByID(...) ...
    GetByEmail(...) ...
    GetByUsername(...) ...
    SaveProfile(...) ...
    UpdatePassword(...) ...
    UpdateLastLogin(...) ...
    // ... 41 more
}

type Users struct{ db *sql.DB }

func (u *Users) GetByID(...) ... { ... }
// ... etc.
```

```go
// internal/orderservice/service.go
package orderservice

import "example.com/app/internal/postgres" // bad: domain depends on infra

type Service struct{ users postgres.UserRepo }
```

**Bug 1:** the interface is huge — 47 methods. Any consumer that needs *one* method has to either implement all 47 in fakes or accept the full coupling.

**Bug 2:** `orderservice` (domain) imports `postgres` (infrastructure), reversing the dependency direction Clean Architecture requires.

**Fix:** define a small consumer-side interface. `orderservice` declares the two or three methods *it* uses; `postgres.Users` happens to satisfy it structurally.

```go
// internal/orderservice/service.go
package orderservice

type UserLookup interface {
    GetByID(ctx context.Context, id string) (User, error)
}

type Service struct{ users UserLookup }
```

`main` imports both packages and wires `postgres.Users` in where the `orderservice.UserLookup` is needed.

---

## Bug 14 — Mutating `Deps` after construction

```go
type Deps struct {
    Repo   Repo
    Logger *slog.Logger
}

func New(d Deps) *Service { return &Service{deps: d} }

// later:
svc := New(Deps{Repo: r1, Logger: l})
svc.deps.Logger = nil // !!
svc.deps.Repo = r2
```

**Bug:** `Deps` is a struct passed by value, but `*Service` stores it as an addressable field (`deps Deps`). External callers can reach in (if they have access) and mutate. More importantly, this style invites teammates to *expect* that mutating `deps` post-hoc has effect.

**Fix:** copy fields out into unexported scalar fields on the service.

```go
type Service struct {
    repo   Repo
    logger *slog.Logger
}

func New(d Deps) *Service {
    return &Service{repo: d.Repo, logger: d.Logger}
}
```

Now there is one place to change a dependency: through the constructor.

---

## Bug 15 — Goroutine leak from a "lazy" provider

```go
type Cache struct {
    once sync.Once
    data map[string]string
}

func (c *Cache) Get(k string) string {
    c.once.Do(func() {
        c.data = loadFromDisk() // slow
        go c.refreshLoop()      // never stops
    })
    return c.data[k]
}
```

**Bug:** the cache spawns a refresh goroutine on first use and never stops it. `Cache` has no `Close` method. A test that constructs a fresh `Cache` per case leaks one goroutine each.

**Fix:** require the goroutine's lifecycle to be managed via construction.

```go
type Cache struct {
    data    map[string]string
    cancel  context.CancelFunc
    done    chan struct{}
}

func NewCache(ctx context.Context) *Cache {
    cctx, cancel := context.WithCancel(ctx)
    c := &Cache{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(c.done)
        c.refreshLoop(cctx)
    }()
    return c
}

func (c *Cache) Close() {
    c.cancel()
    <-c.done
}
```

Now construction is explicit, lifetime is bounded, and the cleanup is part of the contract.

---

## Bug 16 — `fx.Provide` ordering assumption

```go
func main() {
    fx.New(
        fx.Provide(
            NewLogger, // logger is needed by everything
            NewDB,
            NewRepo,
            NewService,
        ),
        fx.Invoke(StartService),
    ).Run()
}
```

**Bug (subtle):** people often think the order in `fx.Provide` matters. It does not — `fx`/`dig` resolve by *dependency edge*, not by argument order. So this is not actually a bug *yet*; the bug is that someone deletes `NewLogger` thinking "service is at the bottom, logger is at the top", and the test still passes because the logger is only injected via `dig.In` somewhere. Then the build "works" but the constructor for some module receives a typed-nil logger.

**Fix mindset:** treat `fx.Provide` as an unordered set. Order does not protect you. The real safety comes from typing — every required parameter must have exactly one provider, or `fx` crashes at startup with a clear message.

---

## Bug 17 — Hand-rolled "container" with reflection

```go
type Container struct{ data map[reflect.Type]any }

func (c *Container) Register(v any) {
    c.data[reflect.TypeOf(v)] = v
}

func (c *Container) Resolve(out any) {
    t := reflect.TypeOf(out).Elem()
    val := c.data[t]
    reflect.ValueOf(out).Elem().Set(reflect.ValueOf(val))
}
```

**Bugs:**
1. There is no compile-time check that `Resolve` will succeed.
2. Storing by `reflect.Type` confuses interfaces vs concrete types.
3. Once anyone uses this, every consumer's signature *lies* — it takes nothing, but secretly resolves from this container.
4. It is a service locator, with reflection, with no error path.

**Fix:** delete it. Use plain Go constructors. If you genuinely need a runtime container, use `dig` or `fx` — they have made every mistake on your behalf already.

---

## Bug 18 — Forgetting to flush the logger before exit

```go
func main() {
    logger := newAsyncLogger()
    svc := NewService(logger)
    if err := svc.Run(); err != nil {
        logger.Error("run failed", "err", err)
        os.Exit(1) // logger.Flush() never runs
    }
}
```

**Bug:** `os.Exit(1)` skips deferred functions, including the logger's flush. The error log is written to a buffer and lost.

This is a DI bug because the logger's lifecycle (flush on shutdown) is part of its contract — and `main` is the only place that contract is honoured. Skipping defers undoes everything DI would have given you.

**Fix:** isolate the run into a function that returns an error, and `Exit` only after deferred cleanups have run.

```go
func main() {
    if err := run(); err != nil {
        os.Stderr.WriteString(err.Error() + "\n")
        os.Exit(1)
    }
}

func run() error {
    logger := newAsyncLogger()
    defer logger.Flush()

    svc := NewService(logger)
    return svc.Run()
}
```

---

## Bug 19 — Provider returning interface, then comparing to `nil`

```go
func ProvideMetrics(cfg Config) Metrics {
    if cfg.MetricsAddr == "" {
        return nil // bug
    }
    return newRealMetrics(cfg.MetricsAddr)
}

// elsewhere:
type Service struct{ m Metrics }

func (s *Service) Inc() {
    if s.m == nil {
        return
    }
    s.m.Inc("event") // surprise: still panics sometimes
}
```

**Bug:** if `ProvideMetrics` is called via reflection (as in `fx`/`dig`), the framework wraps the return into an interface value of type `Metrics`. When the body returns `nil`, the resulting interface value can be a typed nil depending on framework implementation details, *not* the untyped nil. The `s.m == nil` check is unreliable.

**Fix:** return a no-op implementation, never nil.

```go
type noopMetrics struct{}

func (noopMetrics) Inc(string) {}

func ProvideMetrics(cfg Config) Metrics {
    if cfg.MetricsAddr == "" {
        return noopMetrics{}
    }
    return newRealMetrics(cfg.MetricsAddr)
}
```

Consumers no longer need a nil check.

---

## Bug 20 — Test that secretly uses real time

```go
type Service struct{ clock Clock }

func (s *Service) Throttle() {
    if time.Since(s.lastCall) < time.Second { // bug: uses real time, not clock
        return
    }
    s.lastCall = s.clock.Now()
    s.do()
}
```

**Bug:** the service was *given* a `Clock`, but `Throttle` calls `time.Since` directly. A test that injects a fake clock cannot control this branch — the test will use real wall time and behave non-deterministically.

**Fix:** route every time-related call through the injected `Clock`.

```go
func (s *Service) Throttle() {
    now := s.clock.Now()
    if now.Sub(s.lastCall) < time.Second {
        return
    }
    s.lastCall = now
    s.do()
}
```

A grep audit (`time.Since`, `time.Now`, `time.Sleep`) per service is a quick way to catch leftover direct calls.

---

> Each of these bugs is recoverable in minutes once seen, and silent for hours when not. Reviewing constructor-and-wiring code with these patterns in mind catches a surprising fraction of "weird" issues.
