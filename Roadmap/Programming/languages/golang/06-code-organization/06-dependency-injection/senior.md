# Dependency Injection — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [DI as an Architectural Tool](#di-as-an-architectural-tool)
3. [Layering and Ports/Adapters](#layering-and-portsadapters)
4. [Scoping: Singleton, Request, Per-Call](#scoping-singleton-request-per-call)
5. [The Composition Root](#the-composition-root)
6. [When to Introduce `wire`](#when-to-introduce-wire)
7. [Evaluating `fx` for a Codebase](#evaluating-fx-for-a-codebase)
8. [Large-Graph Wiring Strategies](#large-graph-wiring-strategies)
9. [Multi-Binary, Multi-Environment Wiring](#multi-binary-multi-environment-wiring)
10. [Testing Strategy at Scale](#testing-strategy-at-scale)
11. [Anti-Patterns at Scale](#anti-patterns-at-scale)
12. [Senior-Level Checklist](#senior-level-checklist)
13. [Summary](#summary)

---

## Introduction

At senior level, DI is no longer about how to pass a logger into a function. It is an *architectural* lever. The way you express dependencies determines how testable your system is, how cleanly it layers, how easily you can split it into services, and how cheaply you can swap an implementation under load.

This file is about the decisions a tech lead or staff engineer makes about DI: how to shape the graph, where to draw the seams, when frameworks earn their keep, and when "just write it manually" is the staff-level answer.

After reading this you will:

- Use DI deliberately to enforce architectural boundaries (ports/adapters, hexagonal).
- Reason about scoping — when a singleton is wrong, when request-scoped wins.
- Decide when to introduce `wire` or `fx`, and when not to.
- Wire multi-binary monorepos without duplication.
- Spot the architectural smells that DI alone cannot fix.

---

## DI as an Architectural Tool

A naive view of DI: "tests need fakes, so use interfaces." That works at small scale. At large scale, DI is the mechanism by which you *declare your boundaries*. If `OrderService` accepts a `Payments` interface, you have promised that orders do not depend on Stripe; they depend on *anything that can charge*. That promise is enforced by the type system every time you compile.

The architectural payoff is not just testability:

- **Replaceability.** Stripe → Adyen is one provider swap.
- **Boundary enforcement.** If `OrderService` imported `stripeclient` directly, a junior could call `stripeclient.RawListSubscriptions()` and your boundary leaks.
- **Multiple implementations live side by side.** A canary deploys 1% of traffic on a new payment provider — same interface, two providers, a routing rule in `main`.
- **Module separation.** With consumer-side interfaces, a downstream package never imports an upstream concrete type. Compile times stay sane.

DI is the cheapest way to make architectural intent *enforceable* in Go.

---

## Layering and Ports/Adapters

### A typical layered service

```
┌────────────────────────────────────────────────────────────┐
│                         transport                          │
│        HTTP handlers, gRPC servers, queue consumers        │
├────────────────────────────────────────────────────────────┤
│                          service                           │
│              business rules / use cases                    │
├────────────────────────────────────────────────────────────┤
│                          ports                             │
│      interfaces describing the world the service needs     │
├────────────────────────────────────────────────────────────┤
│                         adapters                           │
│   concrete impls: Postgres repo, Stripe client, S3 store    │
└────────────────────────────────────────────────────────────┘
```

Service code depends on the **port** (interface), not the **adapter** (implementation). DI is how the adapter gets in: the composition root constructs the adapter and passes it through the port.

### Why hexagonal works in Go

Go's structural interfaces fit hexagonal architecture beautifully. A repository port can live inside the `service` package; the adapter package implements it implicitly (no `implements` keyword); `main` is the only file that knows about both.

```go
// internal/orders/service.go (the inside)
package orders

type Repo interface {
    Get(ctx context.Context, id string) (Order, error)
    Save(ctx context.Context, o Order) error
}

type Service struct{ repo Repo }

func New(r Repo) *Service { return &Service{repo: r} }

// internal/orders/postgres/repo.go (the outside)
package postgres

import "example.com/app/internal/orders"

type Repo struct{ db *sql.DB }

func New(db *sql.DB) *Repo { return &Repo{db: db} }

// satisfies orders.Repo structurally — no "implements" needed
func (r *Repo) Get(ctx context.Context, id string) (orders.Order, error) { ... }
func (r *Repo) Save(ctx context.Context, o orders.Order) error           { ... }
```

`orders` does not import `postgres`. `postgres` imports `orders` (only for the `Order` data type). The dependency points *inward* — Clean Architecture's central rule, achieved at zero cost in Go.

---

## Scoping: Singleton, Request, Per-Call

### Singletons (process-scoped)

The default in Go services. `*sql.DB`, `*http.Client`, the logger, the clock, the metrics emitter — all singletons created in `main`.

Two reasons most things are singletons:

1. They have expensive setup (TCP pool, file handles).
2. They are inherently thread-safe (Go stdlib is rigorous about this).

### Request-scoped values

A request-scoped value is created at the top of an HTTP request and lives until it returns. The two canonical examples:

- A logger pre-tagged with the request ID.
- A database transaction shared across multiple service calls in the same request.

In Go, request-scoped values *do not* go through the DI graph. They go through `context.Context`:

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
```

The DI graph stays singleton-shaped. Request scope rides on `context.Context`.

> **Senior insight.** Resist the temptation to "scope" an entire DI graph per request. That is what frameworks like Spring (Java) or NestJS (Node) do. In Go it is unnecessary, slow, and complicates everything.

### Per-call values

Things constructed inside one method, used, discarded. No DI needed — they are just local variables.

---

## The Composition Root

The composition root is the unique place where all the wiring happens. In a Go binary, it is `main` (or a sibling file like `internal/app/wire.go`). The senior rule:

> **`main` is the only place allowed to know all the concrete types.**

Everything else depends on interfaces. Only `main` "sees" Postgres, Stripe, S3, Kafka all in one place.

This rule is what gives you:

- **Zero import-cycle risk.** Domain code does not import infra code.
- **Easy replacement.** Switch a Postgres adapter for a SQLite one for tests by editing one file.
- **Clear ownership.** Lifecycle (startup/shutdown) is owned by `main`, period.

If you find yourself with concrete-type imports outside `main`, treat it as architectural debt.

---

## When to Introduce `wire`

`google/wire` is worth its complexity when *all* of these are true:

1. Wiring code is more than ~150 lines, or repeats across binaries.
2. The dependency graph changes often enough that the boilerplate is real.
3. You have multiple binaries that share most providers (CLI + API + worker).
4. Your team is comfortable with a mandatory `go generate` step before commits.

It is *not* worth it when:

- You have one binary and 30 providers. Manual is fine.
- Your team is small and the build pipeline already groans.
- You want runtime configurability (different impls based on env). `wire` is build-time; switching impls at runtime is awkward.

### The `wire` workflow

1. Define provider sets: `wire.NewSet(ProviderA, ProviderB, ...)`.
2. Write injector skeletons under a `//go:build wireinject` tag.
3. Run `wire ./...` (or `go generate ./...`) to produce `wire_gen.go`.
4. Commit `wire_gen.go`.

A senior practice: gate CI on `git diff --exit-code` after running `go generate ./...`. This catches "I changed a provider but forgot to regen".

### When `wire` saves you

The single most useful `wire` feature is *interface bindings*:

```go
var Set = wire.NewSet(
    repo.NewPostgresUsers,
    wire.Bind(new(orders.UserRepo), new(*repo.PostgresUsers)),
)
```

You have stated, statically: "wherever an `orders.UserRepo` is needed, give it a `*repo.PostgresUsers`." If the binding ever becomes ambiguous (two providers, both implementing `UserRepo`), `wire` fails the build with a clear error. That single check pays back the boilerplate on a large graph.

---

## Evaluating `fx` for a Codebase

`go.uber.org/fx` is a runtime, reflection-based DI container built on top of `go.uber.org/dig`. It offers:

- A `Module` system for grouping providers.
- First-class `OnStart` / `OnStop` lifecycle hooks.
- Automatic graph resolution at startup.
- A test helper (`fxtest`) for spinning up partial graphs.

Costs:

- Reflection at startup. For a 200-component service this is hundreds of milliseconds of cold-start latency.
- Errors surface at *startup*, not at *compile* time. A missing provider crashes the process when the operator starts it, not when the engineer commits.
- Stack traces become "go.uber.org/fx internals" deep — debugging is harder.
- The framework owns the program shape. `main` becomes `fx.New(...).Run()`; idiomatic Go control flow gives way to fx's lifecycle.

### When `fx` makes sense

- You operate **many services** that share a common skeleton (logging, metrics, tracing, config). `fx` modules are an excellent abstraction for "every service must have these ten things."
- You want **plug-in style** modules — registering a feature is "import this fx module".
- Your team treats Go services as *applications*, not as *standalone binaries*, and is willing to pay the framework cost.

### When `fx` is the wrong answer

- Single service, one team, simple lifecycle. Manual or `wire` wins.
- Performance-sensitive cold start (CLI tools, serverless). The reflection cost is real.
- Teams that prefer "no magic" Go. `fx` is famously magical compared to the rest of the Go ecosystem.

A senior engineer presented with `fx` should ask: *what does this give me that ten lines of manual wiring would not?* If the answer is "uniformity across many services," fine. If the answer is "I prefer the API," push back.

---

## Large-Graph Wiring Strategies

Once you cross ~50 providers, manual wiring needs structure.

### Strategy 1 — Group providers by package

Each package exposes a `Build` (or `Provide`) function that returns its piece of the graph:

```go
// internal/repo/repo.go
type Set struct {
    Users  *Users
    Orders *Orders
    Items  *Items
}

func New(db *sql.DB, logger *slog.Logger) Set {
    return Set{
        Users:  NewUsers(db, logger),
        Orders: NewOrders(db, logger),
        Items:  NewItems(db, logger),
    }
}
```

Now `main` calls `repo.New(db, logger)` and gets a struct holding all repositories.

### Strategy 2 — Layered "App" struct

```go
type App struct {
    Cfg     config.Config
    DB      *sql.DB
    Repos   repo.Set
    Service *service.App
    API     *transport.API
}

func Build(ctx context.Context) (*App, func(), error) { ... }
```

The cleanup function returned alongside `*App` runs every shutdown step in reverse. `main` becomes:

```go
func main() {
    app, cleanup, err := Build(context.Background())
    if err != nil { ... }
    defer cleanup()
    app.API.Run()
}
```

### Strategy 3 — Adopt `wire`

When the manual `Build` function itself becomes 200 lines and you have multiple binaries, `wire` starts paying for itself. The migration is mechanical: declare your provider set, write injector skeletons, run `wire`.

---

## Multi-Binary, Multi-Environment Wiring

A single repo often produces several binaries: an HTTP API, a gRPC API, a background worker, a one-off CLI for migrations. They share *most* dependencies but differ at the edges (an HTTP API does not need the worker queue; the worker does not need the API server).

### Shared base + per-binary tail

```
internal/
  app/
    base.go         <- providers shared by every binary
    api.go          <- providers added for the API
    worker.go       <- providers added for the worker
cmd/
  api/main.go       <- calls app.BuildAPI(ctx)
  worker/main.go    <- calls app.BuildWorker(ctx)
  migrate/main.go   <- calls app.BuildMigrate(ctx)
```

Each `Build*` is a function in `internal/app` that combines the base set with the per-binary additions.

With `wire`, this is exactly the use case for shared `wire.NewSet`:

```go
var BaseSet = wire.NewSet(config.Load, infra.OpenDB, ...)
var APISet  = wire.NewSet(BaseSet, transport.NewAPI)
var WorkerSet = wire.NewSet(BaseSet, worker.New)
```

### Environment differences

A common need: the API has a real `Stripe` client in prod, an HTTP-recording fake in staging, an in-memory fake in dev. With manual wiring, do this in `main`:

```go
var payments orders.Payments
switch cfg.Env {
case "prod":
    payments = stripeclient.New(cfg.StripeKey)
case "staging":
    payments = stripeclient.NewRecorder(cfg.StripeKey, "stripe-recordings.json")
default:
    payments = inmem.NewPayments()
}
```

With `wire`, this is more awkward — `wire` is build-time, so per-environment swapping requires either build tags or a *plain Go* selector function used as the provider. Senior insight: this is the strongest reason teams keep one or two pieces of `main` *outside* `wire`'s scope.

---

## Testing Strategy at Scale

DI's biggest dividend is testability. At scale, the strategy splits:

- **Unit tests.** Each service tested with hand-written fakes for its ports. Fast, parallel, deterministic.
- **Component tests.** Bring up a full layer (e.g. all repositories) against a real database via testcontainers or `pgx` against a local pg. Fakes only for *external* services (Stripe, S3).
- **End-to-end tests.** Stand up the binary against real infra. Few, expensive, run on PR or nightly.

DI makes the layering possible: at unit level you wire fakes, at component level you wire real local infra, at e2e you wire production-shaped clients pointing at staging.

A senior pattern: a `testapp` package next to `app` that builds the same graph but with test-friendly defaults (in-memory infra, fake clock). All three test layers reuse it.

---

## Anti-Patterns at Scale

### "Universal interface"

A single 50-method `Storage` interface implemented by every backend. Every consumer can call any method. The seam is meaningless — it is just the implementation, with extra steps.

Fix: split into per-consumer interfaces.

### Reflection-based "auto-wiring" reinvented in-house

Engineers who liked Spring/Dagger sometimes build a Go reflection container. They reinvent `dig` poorly. Either use `dig`/`fx` or do not.

### Conditional construction inside services

```go
func (s *Service) Send(...) error {
    if s.cfg.Env == "prod" {
        return s.realMailer.Send(...)
    }
    return s.fakeMailer.Send(...)
}
```

The choice belongs in `main`, not in `Send`. Inject a single `Mailer`, decide which one in the composition root.

### Massive `Module` files in `fx`

When you adopt `fx`, the temptation is to make one giant `AppModule`. A better practice is one `fx.Module` per package, mirroring the layering. Without that discipline, `fx` becomes a single 1,000-line graph nobody understands.

### "Container as map"

`type Container map[string]any` — a hand-rolled service locator. We covered why this is bad. It comes back at scale because someone "needed it" to pass things around. Reject in code review.

---

## Senior-Level Checklist

Before introducing a DI framework, ask:

- [ ] Is wiring code actually a problem, or is it just verbose? (Verbose code is fine.)
- [ ] Will more than one binary share the graph?
- [ ] Is the team comfortable with mandatory codegen or runtime reflection?
- [ ] Are environment differences a runtime decision, a build-time decision, or both?
- [ ] Are lifecycle hooks (orderly start/stop) actually needed or imagined?

Before approving a "let's just inject it" solution, ask:

- [ ] Whose interface is it? Define it consumer-side.
- [ ] Is this a singleton, request-scoped, or per-call value?
- [ ] Is the constructor side-effect-free? (It should be.)
- [ ] Does the composition root know about this concrete type? (Only it should.)
- [ ] If this code were tested without a network, what fakes would it need?

---

## Summary

At senior level, DI is the mechanism by which architectural decisions become enforceable. Layering, ports/adapters, hexagonal — all of them *describe* a structure; constructor injection is what *enforces* it line by line. The composition root is the only place that knows the concrete world; everything else lives behind interfaces it owns.

`google/wire` and `uber-go/fx` are tools, not philosophies. Reach for `wire` when manual wiring genuinely becomes a maintenance burden. Reach for `fx` when you need a service framework with lifecycle and module orchestration; the price is reflection, runtime errors, and a less idiomatic Go shape.

Most of the senior insight, in the end, is about *not* reaching: the same boring, manual constructor injection that a junior learns is the same shape that a 200-component Go service uses in production. Frameworks add value at the edges, but the centre is unchanged.
