# Dependency Injection — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Real-World Wiring in a Go Service](#real-world-wiring-in-a-go-service)
3. [Constructor Patterns at Scale](#constructor-patterns-at-scale)
4. [Defining Interfaces on the Consumer Side](#defining-interfaces-on-the-consumer-side)
5. [Testing with Fakes](#testing-with-fakes)
6. [Avoiding the Service Locator](#avoiding-the-service-locator)
7. [Provider Functions and Object Lifecycles](#provider-functions-and-object-lifecycles)
8. [A Brief Tour of `google/wire`](#a-brief-tour-of-googlewire)
9. [Manual vs Wire vs Fx — When to Reach For Each](#manual-vs-wire-vs-fx--when-to-reach-for-each)
10. [Configuration vs Dependency](#configuration-vs-dependency)
11. [Common Anti-Patterns](#common-anti-patterns)
12. [Pitfalls](#pitfalls)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At the junior level you learned the discipline: pass things in, don't go fetch them. At the middle level you learn how to *operate* DI at the size of a real service — half-a-dozen layers, 30+ constructors, a dozen tests per package, and at least one external system per layer (DB, HTTP server, cache, queue).

The code you wrote at the junior level still works at this size. But you will start hitting two new problems:

1. **`main` becomes long.** A real service has 50–200 lines of wiring. Most teams keep that as plain code; some adopt `google/wire` to generate it.
2. **You hit cross-cutting concerns.** Every layer wants the logger, the clock, the metrics emitter, request IDs. You either pass them in everywhere (more typing) or smuggle them in (anti-pattern).

This file is about handling both at scale, with manual DI as the baseline and `wire` as the optional next step.

After reading this you will:

- Structure a real Go service so wiring lives in one cohesive place.
- Use small, consumer-side interfaces to keep tests fast.
- Recognise the service locator anti-pattern in disguise.
- Understand what `google/wire` does and decide whether you need it.
- Compare manual wiring, `wire`, and `fx` along the dimensions that matter.

---

## Real-World Wiring in a Go Service

A typical Go service has these layers, each with its own constructor:

| Layer | Example | Depends on |
|-------|---------|-----------|
| Config | `Config{DSN, Port, JWTKey}` | env / file |
| Infra | `*sql.DB`, `*redis.Client`, `*http.Client` | Config |
| Repositories | `UserRepo`, `OrderRepo` | Infra |
| Services | `UserService`, `OrderService` | Repositories, clock, logger |
| Transport | `APIServer`, `gRPCServer` | Services |
| Process | `main` | Transport |

Manual wiring follows the dependency order from top to bottom:

```go
// cmd/api/main.go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os"
    "time"

    "example.com/billing/internal/config"
    "example.com/billing/internal/infra"
    "example.com/billing/internal/orderservice"
    "example.com/billing/internal/repo"
    "example.com/billing/internal/transport"
)

func main() {
    ctx := context.Background()

    cfg, err := config.Load()
    if err != nil {
        slog.Error("config load", "err", err)
        os.Exit(1)
    }

    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

    db, err := infra.OpenDB(ctx, cfg.DSN)
    if err != nil {
        logger.Error("db open", "err", err)
        os.Exit(1)
    }
    defer db.Close()

    redis := infra.NewRedis(cfg.RedisAddr)
    defer redis.Close()

    clock := realClock{}

    orders := repo.NewOrders(db, logger)
    users := repo.NewUsers(db, logger)

    orderSvc := orderservice.New(orders, users, clock, logger)

    api := transport.NewAPI(orderSvc, logger)

    srv := &http.Server{
        Addr:              ":" + cfg.Port,
        Handler:           api.Router(),
        ReadHeaderTimeout: 5 * time.Second,
    }
    logger.Info("listening", "port", cfg.Port)
    if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
        logger.Error("listen", "err", err)
        os.Exit(1)
    }
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }
```

This is around 50 lines of wiring for a small service. Read top to bottom: config, infra, repos, service, transport, run. No magic.

---

## Constructor Patterns at Scale

### Pattern 1 — Plain `New<Service>` with positional args

Works perfectly for 1–5 dependencies:

```go
func New(repo OrderRepo, users UserRepo, clock Clock, logger *slog.Logger) *Service { ... }
```

### Pattern 2 — Group dependencies into a struct

Once you cross 5 dependencies, hide them behind a `Deps` struct:

```go
type Deps struct {
    OrderRepo  OrderRepo
    UserRepo   UserRepo
    Clock      Clock
    Logger     *slog.Logger
    Metrics    Metrics
    Tracer     Tracer
}

func New(d Deps) *Service { ... }
```

Now the call site reads:

```go
svc := orderservice.New(orderservice.Deps{
    OrderRepo: orders,
    UserRepo:  users,
    Clock:     clock,
    Logger:    logger,
    Metrics:   metrics,
    Tracer:    tracer,
})
```

It is more verbose at the construction site, but the field names act as documentation, and adding a new dependency is a *minor* change rather than a parameter-list churn.

### Pattern 3 — Functional options

For optional dependencies and configuration, the *functional options* pattern is idiomatic Go:

```go
type Option func(*Service)

func WithMetrics(m Metrics) Option { return func(s *Service) { s.metrics = m } }
func WithTracer(t Tracer) Option   { return func(s *Service) { s.tracer = t } }

func New(repo OrderRepo, opts ...Option) *Service {
    s := &Service{repo: repo, metrics: noopMetrics{}, tracer: noopTracer{}}
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

Use options for *optional* knobs. Required dependencies stay as positional or struct fields, where the type system enforces them.

### Pattern 4 — Mixing required and optional

```go
type Deps struct {
    Repo   OrderRepo
    Logger *slog.Logger
}

func New(d Deps, opts ...Option) *Service { ... }
```

Required dependencies are explicit and type-checked; optional knobs go through options. This is a clean middle ground.

---

## Defining Interfaces on the Consumer Side

This is the rule that pays the largest dividends in Go DI:

> **Define an interface where it is consumed, not where it is implemented.**

If `OrderService` calls `Charge(ctx, userID, amountCents)` on the payment gateway, then `OrderService` should declare a tiny `Payments` interface with that one method:

```go
// internal/orderservice/service.go
package orderservice

type Payments interface {
    Charge(ctx context.Context, userID string, cents int) (string, error)
}

type Service struct {
    payments Payments
}

func New(p Payments) *Service { return &Service{payments: p} }
```

Even if the real `*stripeclient.Client` has 60 methods, `OrderService` only knows about one. Reasons this matters:

- **Tests are tiny.** A fake `Payments` is two lines.
- **No package cycle.** `orderservice` does not import `stripeclient`; it depends on its own interface. `main` is the only place that pulls both packages together.
- **Multiple consumers, multiple interfaces.** Each consumer declares only what it uses. Interfaces stay small.

Counter-rule: do *not* define a "kitchen-sink" interface in the package that *implements* it. The implementation package returns concrete types; consumers narrow to interfaces.

---

## Testing with Fakes

A fake is a hand-written, in-memory implementation of an interface. Fakes are the simplest and most maintainable kind of test double in Go.

### Example: a repo fake

```go
// in orderservice_test.go
type fakePayments struct {
    charges []charge
    err     error
}

type charge struct {
    userID string
    cents  int
}

func (f *fakePayments) Charge(ctx context.Context, userID string, cents int) (string, error) {
    if f.err != nil {
        return "", f.err
    }
    f.charges = append(f.charges, charge{userID, cents})
    return "ch_test_" + userID, nil
}

func TestService_Charge(t *testing.T) {
    fp := &fakePayments{}
    svc := New(fp)

    receipt, err := svc.Pay(context.Background(), "u-1", 1000)
    if err != nil {
        t.Fatal(err)
    }
    if want := "ch_test_u-1"; receipt != want {
        t.Errorf("receipt = %q, want %q", receipt, want)
    }
    if got := len(fp.charges); got != 1 {
        t.Errorf("charges = %d, want 1", got)
    }
}
```

### Fake vs mock — pick one and stick with it

| | Fake (hand-written) | Mock (generated) |
|--|---------------------|------------------|
| Setup cost | Higher (write the code) | Lower (`mockgen` generates it) |
| Read at the call site | Easy — explicit data | Mid — `EXPECT().Foo().Return(...)` |
| Refactor cost | Low — change Go code | Mid — regen, fix matchers |
| Behaviour fidelity | High — you can simulate state | Low — just return canned values |
| Best for | Repos, gateways with state | One-shot dependencies |

For Go services, fakes win for stateful dependencies (repositories, queues, caches) and mocks (e.g. via `go.uber.org/mock`, formerly `gomock`) win for simple single-call dependencies.

### Don't over-mock

A test that mocks every dependency reads like a configuration file. If the test exists only to verify "this thing called that thing", it is a tautology test. Test *behaviour*, not call sequences.

---

## Avoiding the Service Locator

The *service locator* is a global registry — typically a map keyed by string or `reflect.Type` — that code reaches into to find its dependencies.

```go
// Anti-pattern: the service locator.
var Locator = map[string]any{}

func GetService[T any](name string) T {
    return Locator[name].(T)
}

func (s *OrderService) Charge() {
    payments := GetService[Payments]("payments") // hidden dependency
    // ...
}
```

It looks like DI — code is reading a dependency from outside — but it has every problem the global solution has:

- The function signature lies. `Charge()` looks free of dependencies; it has at least one hidden one.
- Tests are awkward — you have to mutate a global before each test.
- Parallel tests can race.
- The compiler cannot tell you when you forget to register something. You learn at runtime.

**Spot it by:** any function that reads a package-level variable (or singleton) to do its primary work.

**Fix it by:** moving the dependency into the constructor.

This includes things that look "free":

- `db.Get()` (a global `*sql.DB`).
- `log.Println(...)` (the global default logger).
- `tracing.Span(...)` (a global tracer registered in `init`).
- `viper.GetString("foo")` reaching into a global config — pass the resolved value.

Each of these is a service locator wearing a different hat.

---

## Provider Functions and Object Lifecycles

A *provider function* is just a Go function that returns a constructed value:

```go
func ProvideDB(cfg config.Config) (*sql.DB, error) {
    db, err := sql.Open("postgres", cfg.DSN)
    if err != nil {
        return nil, err
    }
    db.SetMaxOpenConns(cfg.DBMaxOpen)
    return db, nil
}
```

In manual wiring you call providers from `main`. In `wire`, you register them as a set and the tool generates the wiring. Either way, the *unit* is a provider function.

### Lifecycles you actually have

- **Singleton (process-scoped).** Created in `main`, lives until shutdown: DB, HTTP client, logger, config.
- **Per-request (request-scoped).** Created at the start of an HTTP request: a request-scoped logger with the request ID, a transaction.
- **Per-call.** Created and destroyed within one method.

In Go, request-scoped values usually flow through `context.Context`, *not* through a DI graph. We will return to this in `senior.md`.

### Cleanup

Constructors that allocate resources should return a cleanup function:

```go
func ProvideDB(cfg config.Config) (*sql.DB, func(), error) {
    db, err := sql.Open("postgres", cfg.DSN)
    if err != nil {
        return nil, nil, err
    }
    cleanup := func() { _ = db.Close() }
    return db, cleanup, nil
}
```

`main` collects every cleanup function and calls them in reverse order on shutdown. `wire` formalises this with its "cleanup" return convention.

---

## A Brief Tour of `google/wire`

`github.com/google/wire` is a *compile-time* DI tool maintained by Google. It is a code generator: you describe your provider set, and `wire` generates the wiring code. The generated code is exactly what you would have written by hand — no reflection, no runtime container, no magic at runtime.

Install:

```bash
go install github.com/google/wire/cmd/wire@latest
```

### A minimal example

```go
// internal/wire/wire.go
//go:build wireinject

package wire

import (
    "github.com/google/wire"
    "example.com/app/internal/orderservice"
    "example.com/app/internal/repo"
    "example.com/app/internal/infra"
    "example.com/app/internal/config"
)

var Set = wire.NewSet(
    config.Load,
    infra.OpenDB,
    repo.NewOrders,
    repo.NewUsers,
    orderservice.New,
)

func InitializeApp() (*orderservice.Service, func(), error) {
    panic(wire.Build(Set))
}
```

You run `wire` and it produces `wire_gen.go`:

```go
// Code generated by Wire. DO NOT EDIT.
//go:build !wireinject

package wire

func InitializeApp() (*orderservice.Service, func(), error) {
    cfg, err := config.Load()
    if err != nil {
        return nil, nil, err
    }
    db, cleanup, err := infra.OpenDB(cfg)
    if err != nil {
        return nil, nil, err
    }
    orders := repo.NewOrders(db)
    users := repo.NewUsers(db)
    svc := orderservice.New(orders, users)
    return svc, func() {
        cleanup()
    }, nil
}
```

That generated function is exactly what your `main` would have called by hand. The build tag `wireinject` ensures the source skeleton is excluded from regular builds.

### Why `wire` is "Go-flavoured" DI

- **No reflection.** All wiring is real Go code at build time.
- **Compile-time errors.** Forget a provider, you get a build error — not a runtime crash.
- **Trivial to debug.** The generated file is normal Go you can read.
- **Zero runtime cost.** It is the same code you would have written.

The trade-off is the build step: every change to the dependency graph requires re-running `wire`.

### When `wire` starts paying for itself

- You have 50+ providers and `main` is becoming a wall of construction.
- You have multiple binaries (CLI, API, worker) sharing most of the same providers.
- You have provider sets that vary by environment (real vs mock infra) and want them tracked statically.

Below ~20 providers, manual wiring is usually clearer.

---

## Manual vs Wire vs Fx — When to Reach For Each

| Dimension | Manual | `google/wire` | `uber-go/fx` |
|-----------|--------|---------------|--------------|
| When wiring runs | Build of `main` | Build (codegen) | Process startup (reflection) |
| Magic level | None | Some (codegen step) | High (reflection on types) |
| Failure mode | Compile error | Compile error after `wire gen` | Runtime panic / startup error |
| Lifecycle hooks | DIY | Cleanup funcs | First-class `OnStart`/`OnStop` |
| Best for | Small/medium services | Larger services with many providers | Service frameworks, multi-binary apps |
| Learning curve | Low | Mid | Higher |
| Test friendliness | Excellent | Excellent | Good (`fxtest`) |
| Runtime cost | Zero | Zero | Reflection at startup |

**Rule of thumb.** Start manual. Move to `wire` when wiring code becomes annoying to maintain. Reach for `fx` only when you have a service-framework problem (lifecycle orchestration of dozens of components, plug-in modules, multiple binaries sharing a runtime). The vast majority of Go services never outgrow manual.

---

## Configuration vs Dependency

A frequent confusion: is a `Config` struct a "dependency"?

- **Dependency:** something with behaviour you call into. A logger, a DB, a clock.
- **Configuration:** plain data describing how to construct dependencies. URLs, ports, timeouts.

Treat them differently:

- Load configuration in `main` (env, files, flags).
- Use it to *construct* dependencies.
- Pass the *resolved values* into services. Never pass the whole `Config` blob into business logic.

Bad:

```go
func NewOrderService(cfg Config, repo OrderRepo) *Service {
    return &Service{
        repo:    repo,
        timeout: cfg.OrderTimeout, // why does the service know about Config?
    }
}
```

Good:

```go
func NewOrderService(repo OrderRepo, timeout time.Duration) *Service { ... }
```

The service depends on a duration, not on the config object that contains it. This keeps the service decoupled from how the config happens to be structured today.

---

## Common Anti-Patterns

### `init()` for resource construction

```go
// Don't do this.
var DB *sql.DB

func init() {
    var err error
    DB, err = sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil { panic(err) }
}
```

`init` runs before `main`, takes no arguments, cannot be skipped, and is impossible to test. Move all resource construction into `main`.

### Constructors with side effects

```go
func NewMailer(smtp SMTPClient) *Mailer {
    if err := smtp.Connect(); err != nil { panic(err) } // bad
    return &Mailer{smtp: smtp}
}
```

A constructor that opens connections is impossible to test without real network. Either accept an *already-connected* dependency, or split: `NewMailer` returns the value, `(*Mailer).Connect()` is a separate method.

### Threading a "context" object as a bag of dependencies

Some teams put logger, DB, metrics, etc. into a custom `Context` struct and pass it everywhere. This is a service locator wearing a context-shaped jacket. Real `context.Context` is for *request-scoped* cancellation/values, not for DI.

### Building "smart" containers

Hand-rolling a `Container` struct with `RegisterService` and `Resolve` methods is the service locator anti-pattern, again. Just write the constructors.

### Optional dependencies as nil

```go
type Service struct {
    metrics Metrics // sometimes nil
}

func (s *Service) Do() {
    if s.metrics != nil {
        s.metrics.Inc("...") // nil checks everywhere
    }
}
```

Better: inject a no-op implementation by default, and let callers swap a real one in.

```go
type noopMetrics struct{}

func (noopMetrics) Inc(string) {}

func New(metrics Metrics) *Service {
    if metrics == nil {
        metrics = noopMetrics{}
    }
    return &Service{metrics: metrics}
}
```

---

## Pitfalls

- **Long parameter lists.** Past five parameters, group into a `Deps` struct.
- **Fake drift.** Hand-written fakes can drift from the real interface. Compile-time check: `var _ Payments = (*fakePayments)(nil)` at the top of the test file.
- **Cyclic dependencies.** If `A` needs `B` and `B` needs `A`, the design is wrong. Introduce a third type, or merge them.
- **Premature interfaces.** Interface for a type with one implementation, no test, no expected variants? Probably premature. Wait until you need the seam.
- **`wire` build creep.** Once you adopt `wire`, every change to a constructor's signature requires regenerating. Make `wire generate ./...` part of `go generate ./...` and CI.

---

## Self-Assessment

You are at the middle level if you can:

- Open a 50-component service, point at `main`, and explain the wiring order.
- Spot a service locator in code review and explain why it is a problem.
- Refactor an `init()` into explicit `main` wiring.
- Decide between manual DI and `google/wire` for a given project.
- Write a fake for an interface and ensure with a compile-time assertion that it stays in sync.
- Group dependencies into a `Deps` struct without breaking call sites unnecessarily.

---

## Summary

Real-world Go DI is manual constructor injection plus a `main.go` that reads top to bottom. Interfaces live on the consumer side, fakes do most of your testing, and the service locator is the recurring anti-pattern to refuse. `google/wire` is a code generator that automates the wiring once it gets large; `uber-go/fx` is a runtime container you reach for only when you genuinely need lifecycle orchestration. Both are useful tools — but the *style* you have learned here, with no framework at all, scales surprisingly far.

The senior level will look at architectural shape (ports/adapters), scoping (request-scoped vs singleton), and how to evaluate whether a given DI tool earns its keep on a real codebase.
