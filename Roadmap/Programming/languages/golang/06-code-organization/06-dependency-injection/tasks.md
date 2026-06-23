# Dependency Injection — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Replace a global with constructor injection

You inherit this code:

```go
var clock = time.Now

type Token struct{ issuer string }

func (t Token) Mint() string {
    return fmt.Sprintf("%s|%d", t.issuer, clock().Unix())
}
```

Refactor `Token` to receive its time source via constructor injection. The `Mint` method must still produce identical output.

**Goal.** Your test should be able to assert an exact `Mint()` string by injecting a fixed time source.

---

### Task 2 — Inject a logger interface

Take this snippet:

```go
type Service struct{}

func (s Service) Charge(amount int) {
    log.Printf("charging %d", amount)
}
```

Define a small `Logger` interface (one method, e.g. `Logf(format string, args ...any)`), inject it into `Service`, and write a fake logger that captures messages into a slice. Add a test that asserts on the captured messages.

**Goal.** No standard-library `log` calls remain inside `Service`.

---

### Task 3 — Spot the service locator

```go
var registry = map[string]any{}

func Register(name string, v any) { registry[name] = v }

type Mailer struct{}

func (Mailer) Send(to, body string) error {
    smtp := registry["smtp"].(SMTPClient)
    return smtp.Send(to, body)
}
```

Refactor to constructor injection. After your refactor, `Mailer` should never touch the global `registry`. Delete `registry` entirely and adjust whoever calls `Mailer.Send`.

**Goal.** Function signatures honestly state what they need.

---

### Task 4 — A `Deps` struct

A constructor is growing:

```go
func NewService(repo Repo, users UserRepo, billing Billing,
    clock Clock, logger *slog.Logger, metrics Metrics) *Service { ... }
```

Refactor to use a `Deps` struct as the single parameter. Update one call site to use named-field initialisation.

**Goal.** Future additions to `Deps` don't break existing call sites.

---

### Task 5 — Compile-time interface conformance

Your fake repo lives in a test file:

```go
type fakeRepo struct{}

func (fakeRepo) Get(id string) (User, error) { return User{}, nil }
```

Add a single line that, if the real `Repo` interface ever changes, makes the test file fail to compile. This catches drift between fake and real interface.

**Hint.** It is a one-liner using a blank `_` variable.

---

## Medium

### Task 6 — Refactor `init()` to explicit wiring

Project layout:

```
main.go
db/db.go
service/service.go
```

`db/db.go`:

```go
package db

import "database/sql"

var Conn *sql.DB

func init() {
    var err error
    Conn, err = sql.Open("postgres", "...")
    if err != nil { panic(err) }
}
```

`service/service.go`:

```go
package service

import "example.com/app/db"

func GetUser(id string) (string, error) {
    var name string
    err := db.Conn.QueryRow(...).Scan(&name)
    return name, err
}
```

Refactor:

- Remove `init()`. Move DB construction into `main`.
- Make `service.GetUser` a method on a struct that receives the DB through a constructor.
- Define a small `RowQuerier` interface in `service` so the service can be tested with a fake.

**Goal.** Importing `service` no longer triggers a database connection.

---

### Task 7 — A clock interface for a rate limiter

Implement a token-bucket rate limiter:

```go
type Limiter struct { /* ... */ }

func NewLimiter(clock Clock, ratePerSecond int, burst int) *Limiter { ... }

func (l *Limiter) Allow() bool { ... }
```

The limiter must take a `Clock` interface so tests can advance time without `time.Sleep`.

**Goal.** A test that records 10 calls advancing 100ms each and asserts which were allowed runs in microseconds.

---

### Task 8 — Tests with a fake repo

Write a small `OrderService` whose only dependency is a `Repo` interface:

```go
type Repo interface {
    Get(ctx context.Context, id string) (Order, error)
    Save(ctx context.Context, o Order) error
}
```

Implement `Cancel(ctx, id) error` that loads, mutates, and saves.

Now write a fake repo backed by `map[string]Order` and three tests:

1. Cancel a non-existent order (expect `ErrNotFound`).
2. Cancel an already-cancelled order (expect idempotent success or specific error of your choice).
3. Cancel a normal order (expect success and stored state mutated).

**Goal.** The tests should run without any database, in milliseconds.

---

### Task 9 — Adapter pattern

You have a third-party `stripeclient` with this method:

```go
func (c *Stripe) CreateCharge(p CreateChargeParams) (*Charge, error)
```

Your domain code calls `Charge(ctx, userID, cents) (string, error)`. Write an adapter type in your domain package whose interface matches the domain shape, internally delegating to the Stripe client. Wire it together in `main`.

**Goal.** The domain package does not import `stripeclient`. The adapter package does.

---

### Task 10 — Cleanup composition

Write a `Build` function that constructs three resources, each returning `(value, cleanup, error)`:

1. `OpenDB(cfg) (*sql.DB, func(), error)`
2. `OpenRedis(cfg) (*redis.Client, func(), error)`
3. `OpenStorage(db, redis) (*Storage, func(), error)`

`Build` should compose all three cleanups into a single `func()` that runs in *reverse* construction order. If step 2 fails, step 1's cleanup must run; if step 3 fails, both 1 and 2 must run.

**Goal.** Resource leaks are impossible regardless of which step errs.

---

## Hard

### Task 11 — Replace `fx` with manual wiring

A small service uses `fx`:

```go
func main() {
    fx.New(
        fx.Provide(
            config.Load,
            infra.OpenDB,
            repo.NewUsers,
            service.NewUserService,
            transport.NewAPI,
        ),
        fx.Invoke(startAPI),
    ).Run()
}
```

Rewrite `main` without `fx`. Preserve startup order, error handling, and cleanup. Use a custom `App` struct if helpful.

**Goal.** No `fx` import. Startup is reflection-free. CPU profile across `Start` no longer shows `dig` symbols.

---

### Task 12 — Convert manual wiring to `wire`

Take the `App` struct and `Build` function from Task 10/11. Now create a `wire` setup:

1. Declare a `wire.NewSet(...)` of providers.
2. Write an injector skeleton under `//go:build wireinject`.
3. Run `wire ./...` and commit `wire_gen.go`.
4. Replace the hand-written `Build` body with a call to the generated injector.

**Goal.** `go generate ./...` is reproducible. `git diff --exit-code` after regen passes in CI.

---

### Task 13 — Two binaries, one provider set

Build a project with two binaries:

```
cmd/api/main.go      <- starts an HTTP server
cmd/worker/main.go   <- consumes a queue and processes jobs
internal/app/        <- shared providers
```

Both binaries share most providers (config, logging, DB, repos). The API additionally needs a `*Router`; the worker additionally needs a `QueueClient`. Define a base `wire.NewSet` and per-binary sets that compose with it.

**Goal.** Adding a shared dependency requires editing one set, not both.

---

### Task 14 — Environment-specific implementation selection

Extend Task 13 so that:

- In `prod`, `Payments` is the real `stripeclient` adapter.
- In `staging`, `Payments` is the same adapter wrapping a recording HTTP client.
- In `dev`, `Payments` is an in-memory fake.

The selection happens once, in `main`, before the rest of the graph is built. The chosen value is fed into `wire`'s injector as a parameter.

**Goal.** No runtime `if env == "prod"` deeper than `main`.

---

### Task 15 — Detect a nil-interface trap

This code panics intermittently in production:

```go
type Logger interface{ Log(string) }

func New(l Logger) *Service {
    if l == nil {
        l = noopLogger{}
    }
    return &Service{l: l}
}

func startup() *Service {
    var rl *RealLogger
    if shouldLog() {
        rl = NewRealLogger()
    }
    return New(rl) // <- bug here
}
```

Explain why the `if l == nil` guard fails to catch the case where `rl` is a typed nil. Then fix it. Two acceptable fixes; describe both.

**Hint.** The fixes are: never pass typed nil through an interface (assign the noop in `startup`), or check the concrete type in `startup` before assignment.

---

### Task 16 — Request-scoped `*sql.Tx`

Add transactional support to a service:

- HTTP middleware begins a `*sql.Tx` at the start of a request and attaches it to `ctx`.
- Repository calls check for a tx in ctx and use it if present; otherwise they use the singleton `*sql.DB`.
- The middleware commits on a 2xx response, rolls back otherwise.

The DI graph stays singleton-shaped — only the *value flowing through ctx* is per-request.

**Goal.** Two repo calls in one handler must hit the same transaction. Two requests in flight see two transactions.

---

### Task 17 — Group dependencies into modules

Refactor a project into `internal/<x>/` packages where each `x` provides a `Set` (or `wire.NewSet`) of its own providers:

- `internal/repo` exposes `RepoSet`.
- `internal/service` exposes `ServiceSet`.
- `internal/transport` exposes `TransportSet`.

`main` (or the `wire` injector) assembles the three sets into a single graph.

**Goal.** A new repository can be added by editing one file and one set.

---

### Task 18 — Decorator middleware via DI

Build an HTTP service whose handlers receive a `Logger` interface. Create a `LoggingMiddleware` that wraps another `Logger` and prefixes the request ID. Wire it as a `fx.Decorate` (if using `fx`) or as an explicit wrap step in manual wiring.

**Goal.** Deep handlers receive a logger already tagged with the request ID — without ever knowing about HTTP or middleware.

---

## Solutions

### Solution 1 — Constructor injection for `Token`

```go
type Now func() time.Time

type Token struct {
    issuer string
    now    Now
}

func NewToken(issuer string, now Now) *Token { return &Token{issuer: issuer, now: now} }

func (t *Token) Mint() string {
    return fmt.Sprintf("%s|%d", t.issuer, t.now().Unix())
}

func TestMint(t *testing.T) {
    fixed := func() time.Time { return time.Unix(1700000000, 0) }
    tok := NewToken("acme", fixed)
    if got, want := tok.Mint(), "acme|1700000000"; got != want {
        t.Errorf("got %q, want %q", got, want)
    }
}
```

---

### Solution 2 — Logger fake

```go
type Logger interface {
    Logf(format string, args ...any)
}

type capturingLogger struct {
    msgs []string
}

func (l *capturingLogger) Logf(format string, args ...any) {
    l.msgs = append(l.msgs, fmt.Sprintf(format, args...))
}

type Service struct{ log Logger }

func NewService(l Logger) *Service { return &Service{log: l} }

func (s *Service) Charge(amount int) {
    s.log.Logf("charging %d", amount)
}

func TestCharge(t *testing.T) {
    cap := &capturingLogger{}
    NewService(cap).Charge(99)
    if len(cap.msgs) != 1 || cap.msgs[0] != "charging 99" {
        t.Errorf("unexpected log: %v", cap.msgs)
    }
}
```

---

### Solution 5 — Compile-time conformance assertion

```go
var _ Repo = (*fakeRepo)(nil)
```

If `Repo` gains or changes a method, `fakeRepo` will fail to satisfy it and the test file will fail to compile.

---

### Solution 7 — Clock-injected limiter

```go
type Clock interface{ Now() time.Time }

type Limiter struct {
    clock     Clock
    rate      int
    burst     int
    tokens    int
    lastFill  time.Time
}

func NewLimiter(c Clock, ratePerSecond, burst int) *Limiter {
    return &Limiter{clock: c, rate: ratePerSecond, burst: burst, tokens: burst, lastFill: c.Now()}
}

func (l *Limiter) Allow() bool {
    now := l.clock.Now()
    elapsed := now.Sub(l.lastFill).Seconds()
    refill := int(elapsed * float64(l.rate))
    if refill > 0 {
        l.tokens += refill
        if l.tokens > l.burst {
            l.tokens = l.burst
        }
        l.lastFill = now
    }
    if l.tokens > 0 {
        l.tokens--
        return true
    }
    return false
}

type fakeClock struct{ t time.Time }

func (c *fakeClock) Now() time.Time { return c.t }
func (c *fakeClock) Advance(d time.Duration) { c.t = c.t.Add(d) }
```

---

### Solution 10 — Cleanup composition

```go
func Build(cfg Config) (App, func(), error) {
    var cleanups []func()
    cleanup := func() {
        for i := len(cleanups) - 1; i >= 0; i-- {
            cleanups[i]()
        }
    }

    db, dbClean, err := OpenDB(cfg)
    if err != nil {
        return App{}, cleanup, err
    }
    cleanups = append(cleanups, dbClean)

    rdb, rdbClean, err := OpenRedis(cfg)
    if err != nil {
        return App{}, cleanup, err
    }
    cleanups = append(cleanups, rdbClean)

    storage, storeClean, err := OpenStorage(db, rdb)
    if err != nil {
        return App{}, cleanup, err
    }
    cleanups = append(cleanups, storeClean)

    return App{DB: db, Redis: rdb, Storage: storage}, cleanup, nil
}
```

The caller writes:

```go
app, cleanup, err := Build(cfg)
defer cleanup()
if err != nil { ... }
```

If any step fails, `cleanup` runs whatever resources were opened up to that point, in reverse order.

---

### Solution 15 — Nil-interface trap

The bug: `var rl *RealLogger` is a typed nil. When passed to `New(l Logger)`, the interface value `l` becomes `(*RealLogger, nil)`. The check `l == nil` is **false** because the type slot is populated. The defaulted-to-noop branch is skipped. The first call into `l.Log("...")` dispatches the method on `*RealLogger` with a nil receiver and panics.

Fix A — assign the noop in the producer, never produce a typed nil:

```go
func startup() *Service {
    var rl Logger = noopLogger{}
    if shouldLog() {
        rl = NewRealLogger()
    }
    return New(rl)
}
```

Fix B — defend in the consumer using the concrete type, which the interface is hiding from us:

```go
func New(l Logger) *Service {
    if l == nil {
        return &Service{l: noopLogger{}}
    }
    if rl, ok := l.(*RealLogger); ok && rl == nil {
        return &Service{l: noopLogger{}}
    }
    return &Service{l: l}
}
```

Fix A is preferred. Fix B works but encodes knowledge of *which* concrete types might be nil — a leak of implementation details into the constructor.

---

### Solution 16 — Request-scoped tx via context

```go
type ctxKey int

const txKey ctxKey = 1

func WithTx(ctx context.Context, tx *sql.Tx) context.Context {
    return context.WithValue(ctx, txKey, tx)
}

func TxFrom(ctx context.Context) (*sql.Tx, bool) {
    tx, ok := ctx.Value(txKey).(*sql.Tx)
    return tx, ok
}

// Repo uses the tx when present, otherwise the singleton DB.
type UserRepo struct{ db *sql.DB }

func (r *UserRepo) Get(ctx context.Context, id string) (User, error) {
    if tx, ok := TxFrom(ctx); ok {
        return scanOne(tx.QueryRowContext(ctx, "SELECT ...", id))
    }
    return scanOne(r.db.QueryRowContext(ctx, "SELECT ...", id))
}

// Middleware begins/commits/rolls back.
func TxMiddleware(db *sql.DB) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tx, err := db.BeginTx(r.Context(), nil)
            if err != nil { http.Error(w, err.Error(), 500); return }
            sw := &statusWriter{ResponseWriter: w, code: 200}
            next.ServeHTTP(sw, r.WithContext(WithTx(r.Context(), tx)))
            if sw.code >= 200 && sw.code < 300 {
                _ = tx.Commit()
            } else {
                _ = tx.Rollback()
            }
        })
    }
}
```

Two requests in flight have two distinct `*sql.Tx` values, each pinned to its `r.Context()`. The DI graph still holds a single `*sql.DB`.

---

> Solutions for tasks 3, 4, 6, 8, 9, 11, 12, 13, 14, 17, 18 are intentionally left for the reader. They follow the same patterns as the solved ones above.
