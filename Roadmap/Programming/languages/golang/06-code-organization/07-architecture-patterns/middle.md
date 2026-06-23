# Architecture Patterns — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Choosing a Pattern: a Practical Decision Frame](#choosing-a-pattern-a-practical-decision-frame)
3. [Mapping Each Pattern to Go Folders](#mapping-each-pattern-to-go-folders)
4. [How `cmd/` and `internal/` Interact with Each Pattern](#how-cmd-and-internal-interact-with-each-pattern)
5. [Where `pkg/` Fits (and Where It Does Not)](#where-pkg-fits-and-where-it-does-not)
6. [Common Starter Layouts You Can Copy](#common-starter-layouts-you-can-copy)
7. [Splitting by Feature vs Splitting by Layer](#splitting-by-feature-vs-splitting-by-layer)
8. [Wiring with `main.go`: the Composition Root](#wiring-with-maingo-the-composition-root)
9. [Testing Strategy per Pattern](#testing-strategy-per-pattern)
10. [Migrating Between Patterns](#migrating-between-patterns)
11. [Common Pitfalls at This Level](#common-pitfalls-at-this-level)
12. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At the junior level the question is "what does each pattern look like?" At the middle level the question is "which one do I pick, and how do I actually lay it out so the team is productive on day 30, not just day 1?"

This file is about the *day-30 view*: deciding, mapping the chosen pattern to Go's folder conventions, and avoiding the well-known traps that turn a clean idea into a maze.

After reading this you will:

- Pick between layered, hexagonal, clean, and onion based on the problem, not preference.
- Translate each pattern into a concrete `cmd/`, `internal/`, `pkg/` layout you can `go run`.
- Wire dependencies in `main.go` without leaking concrete types into the core.
- Decide whether to split by *layer* or by *feature* (or both).
- Move a service from layered to hexagonal incrementally without a big-bang rewrite.

For deeper, per-pattern walk-throughs see [`../../19-architecture-patterns/`](../../19-architecture-patterns/).

---

## Choosing a Pattern: a Practical Decision Frame

Most teams overthink this. The honest order of operations:

1. **Default to layered.** It is the most familiar shape and the lowest ceremony. If nothing in the next steps argues against it, ship layered.
2. **Reach for hexagonal when you have *or expect* multiple drivers or drivees.** HTTP plus a Kafka consumer plus a CLI, all calling the same use cases. Postgres in prod, in-memory in tests, plus one team that demands SQLite for offline runs.
3. **Pick clean (or onion) when use-case-per-file is a feature, not overhead.** Large platforms with dozens of distinct use cases benefit from one file, one feature.
4. **Adopt DDD-flavoured onion only when the domain is genuinely complex.** A CRUD app dressed as DDD is a CRUD app with extra commute time.
5. **Reconsider every quarter.** Architecture is not a one-shot decision. The team should be allowed to delete a pattern that earned nothing.

### A simple flowchart

```
                ┌──────────────────────────────────────┐
                │  Will this code live > 6 months?     │
                └──────────────┬───────────────────────┘
                               │ no   ──►  flat layout, no pattern
                               │ yes
                               ▼
                ┌──────────────────────────────────────┐
                │  Is the domain logic non-trivial?    │
                └──────────────┬───────────────────────┘
                               │ no   ──►  layered
                               │ yes
                               ▼
                ┌──────────────────────────────────────┐
                │  Multiple drivers / drivees today    │
                │  or planned within 6 months?         │
                └──────────────┬───────────────────────┘
                               │ no   ──►  layered
                               │ yes
                               ▼
                ┌──────────────────────────────────────┐
                │  Many distinct use cases (>10)?      │
                └──────────────┬───────────────────────┘
                               │ no   ──►  hexagonal
                               │ yes  ──►  clean (or onion)
                               ▼
```

The most common honest answer for a typical Go web service: **layered or hexagonal**. Clean and onion are appropriate, but they *are* heavier — adopt them deliberately.

### Anti-patterns when choosing

- **Picking the pattern before reading the problem statement.** "We always do clean architecture" is religion, not engineering.
- **Mixing patterns without naming the mix.** A `internal/usecase/` and `internal/service/` next to each other usually means two architects argued and nobody won.
- **Inheriting a pattern from a tutorial blog.** Tutorial code optimises for explanation, not maintenance. Grade what you copy.

---

## Mapping Each Pattern to Go Folders

### Layered

```
myapp/
├── cmd/
│   └── api/
│       └── main.go              ← composition root
├── internal/
│   ├── handler/                 ← HTTP, gRPC, CLI
│   ├── service/                 ← application logic
│   ├── domain/                  ← entities, value objects, rules
│   └── repo/                    ← Postgres / Redis / files
└── go.mod
```

The strict version restricts each layer to call only the one directly below; the relaxed version (more common in Go) lets any layer call any layer below itself. Both are fine. The hard rule is the same: nothing below imports from above.

### Hexagonal

```
myapp/
├── cmd/
│   └── api/main.go
├── internal/
│   ├── core/
│   │   ├── domain/              ← entities, value objects
│   │   ├── port/                ← interfaces (input + output)
│   │   └── service/             ← input-port implementations
│   └── adapter/
│       ├── primary/             ← driving adapters
│       │   ├── http/
│       │   ├── grpc/
│       │   └── worker/
│       └── secondary/           ← driven adapters
│           ├── postgres/
│           ├── redis/
│           └── memory/
└── go.mod
```

Two non-negotiables:
- `internal/core/` never imports `internal/adapter/`.
- Ports live in `core/port/`; concrete adapters live in `adapter/.../`.

### Clean

```
myapp/
├── cmd/
│   └── api/main.go
├── internal/
│   ├── entity/                  ← innermost ring
│   ├── usecase/                 ← one file per use case
│   │   ├── place_order.go
│   │   ├── cancel_order.go
│   │   ├── ports.go             ← interfaces the use cases need
│   │   └── ...
│   ├── adapter/                 ← interface adapters
│   │   ├── http/
│   │   └── repository/
│   └── infra/                   ← drivers, framework setup
└── go.mod
```

In Go, the `controllers/` and `presenters/` packages from the canonical clean diagram are usually merged into `adapter/http/`. Do not invent separate packages without a reason.

### Onion

```
myapp/
├── cmd/
│   └── api/main.go
├── internal/
│   ├── domain/
│   │   ├── model/               ← entities, value objects
│   │   └── service/             ← domain services
│   ├── application/             ← application services / use cases
│   └── infrastructure/
│       ├── http/
│       └── repository/
└── go.mod
```

The marker that separates onion from clean in practice: the explicit `domain/service/` package for cross-entity rules.

---

## How `cmd/` and `internal/` Interact with Each Pattern

Two Go conventions touch every pattern:

1. **`cmd/<binary>/main.go`** is the entry point and the composition root. It is where you wire concrete adapters into ports.
2. **`internal/`** is enforced by the toolchain: code under `internal/` can only be imported by packages rooted at the parent of `internal/`. This *is* the outermost boundary of every pattern.

### Why `cmd/` is the natural composition root

`main.go` already has to know everything: which database to open, which HTTP port to listen on, which logger to configure. It is also the only place where dependencies between layers are not a smell — they are the *point*. So you assemble the application there:

```go
// cmd/api/main.go
func main() {
    cfg := config.Load()
    db, _ := sql.Open("postgres", cfg.PostgresDSN)
    repo := postgres.NewOrderRepo(db)        // adapter
    svc  := service.NewOrderService(repo)    // core
    h    := http.NewOrderHandler(svc)        // primary adapter
    log.Fatal(http.ListenAndServe(cfg.Addr, h))
}
```

If a constructor takes a `*sql.DB` somewhere deep in the call stack, the composition root has been smeared across the codebase. Pull it back out.

### Multiple binaries in one module

Each binary gets its own `cmd/<name>/`:

```
cmd/
├── api/main.go         ← HTTP server
├── worker/main.go      ← Kafka consumer
└── migrate/main.go     ← schema migration tool
```

All three import the same `internal/core/`, but each wires different primary adapters. This is the natural shape for hexagonal/clean: the core ships once, the binaries differ in *who calls it*.

### Why `internal/` is your outer boundary

Anything you put under `internal/` is invisible to other modules. If your application pattern says "the domain is private to this service," you put the domain inside `internal/`. That is the language-level enforcement of the outermost ring.

The corollary: do not put the domain under `pkg/` unless you genuinely intend other modules to import it.

---

## Where `pkg/` Fits (and Where It Does Not)

`pkg/` is for code you intend to publish to other modules in the same monorepo or organisation. It is a *public API promise*. Most application code should not be there.

Use `pkg/` when:

- The same data type or interface is used by *multiple modules* (microservices in a monorepo).
- You publish a library that lives alongside the application's main module.
- You want third parties to be able to import a stable, documented API.

Do **not** put architectural innards in `pkg/`. The domain of a single service belongs in `internal/domain/` (or wherever its ring lives) — not `pkg/domain/`. A `pkg/domain/` is a contract you cannot break without coordinating every consumer.

The default rule: **put it in `internal/` first; promote to `pkg/` only when a real consumer asks.**

---

## Common Starter Layouts You Can Copy

### Starter 1 — Tiny CRUD HTTP service (layered)

```
myapi/
├── cmd/api/main.go
├── internal/
│   ├── handler/order.go
│   ├── service/order.go
│   ├── domain/order.go
│   └── repo/order.go
├── go.mod
└── go.sum
```

A few hundred lines, one team, one database. Layered is correct here. Do not add hexagonal scaffolding for fewer than ten endpoints.

### Starter 2 — Multi-driver service (hexagonal)

```
billing/
├── cmd/
│   ├── api/main.go              ← HTTP frontend
│   └── worker/main.go           ← Kafka consumer
├── internal/
│   ├── core/
│   │   ├── domain/{invoice,payment}.go
│   │   ├── port/
│   │   │   ├── input.go         ← BillingService interface
│   │   │   └── output.go        ← PaymentGateway, InvoiceRepo
│   │   └── service/billing.go
│   └── adapter/
│       ├── primary/
│       │   ├── http/handler.go
│       │   └── kafka/consumer.go
│       └── secondary/
│           ├── postgres/invoice.go
│           ├── stripe/gateway.go
│           └── memory/invoice.go
├── go.mod
└── go.sum
```

Both binaries import `core/`. Each pulls in its own primary adapter; both pull in the same secondary adapters in production.

### Starter 3 — Many use cases (clean)

```
platform/
├── cmd/api/main.go
├── internal/
│   ├── entity/
│   │   ├── user.go
│   │   ├── order.go
│   │   └── invoice.go
│   ├── usecase/
│   │   ├── ports.go
│   │   ├── register_user.go
│   │   ├── place_order.go
│   │   ├── cancel_order.go
│   │   ├── issue_invoice.go
│   │   └── ...
│   ├── adapter/
│   │   ├── http/
│   │   └── repository/
│   └── infra/
│       ├── db.go
│       └── logger.go
├── go.mod
└── go.sum
```

If `internal/usecase/` will hold thirty files, consider splitting per feature: `internal/usecase/order/`, `internal/usecase/billing/`. See the next section.

### Starter 4 — DDD-flavoured (onion)

```
shop/
├── cmd/api/main.go
├── internal/
│   ├── domain/
│   │   ├── order/
│   │   │   ├── model.go
│   │   │   ├── repository.go    ← interface, lives with the aggregate
│   │   │   └── service.go       ← domain service
│   │   └── catalog/
│   │       └── ...
│   ├── application/
│   │   ├── place_order.go
│   │   └── ...
│   └── infrastructure/
│       ├── http/
│       └── persistence/
│           └── postgres_order_repo.go
├── go.mod
└── go.sum
```

The DDD twist: the *aggregate* (here, `order`) owns its repository interface. Implementations live in `infrastructure/`. This is a stronger version of "interfaces with their consumer."

---

## Splitting by Feature vs Splitting by Layer

Two valid orientations:

**By layer (top-level)**

```
internal/
├── handler/
├── service/
├── domain/
└── repo/
```

**By feature (top-level)**

```
internal/
├── order/
│   ├── handler.go
│   ├── service.go
│   ├── domain.go
│   └── repo.go
├── invoice/
│   └── ...
└── user/
    └── ...
```

### When to split by layer

- The codebase is small (under a dozen entities).
- Layers swap independently — you change all repos at once.
- The team's mental model is "the API," "the domain," "the storage."

### When to split by feature

- The codebase is large or growing.
- Features ship as units; teams own features, not layers.
- You have started to feel "every change touches four packages because of layering."

### The hybrid — and why it is often the answer

```
internal/
├── core/
│   ├── domain/
│   │   ├── order/
│   │   ├── invoice/
│   │   └── catalog/
│   ├── port/
│   └── service/
│       ├── order/
│       └── invoice/
└── adapter/
    ├── primary/http/
    └── secondary/postgres/
```

Top-level by *layer/ring*; second-level by *feature*. This is the layout that scales gracefully from 5 endpoints to 500 without a global rewrite.

---

## Wiring with `main.go`: the Composition Root

The composition root is the *only* place that is allowed to know about every package. Everywhere else takes interfaces. A clean composition root has three sections:

```go
func main() {
    // 1. Configuration & infrastructure
    cfg := config.Load()
    db, err := sql.Open("postgres", cfg.DSN)
    if err != nil { log.Fatal(err) }
    defer db.Close()

    logger := slog.Default()

    // 2. Adapters (concrete) → ports (interfaces)
    orderRepo := postgres.NewOrderRepo(db)
    paymentGw := stripe.NewGateway(cfg.StripeKey)

    // 3. Core services (depend on ports only)
    orderSvc := service.NewOrderService(orderRepo, paymentGw, logger)

    // 4. Primary adapters (HTTP, gRPC, ...)
    httpHandler := http.NewHandler(orderSvc)
    server := &nethttp.Server{Addr: cfg.Addr, Handler: httpHandler}

    log.Fatal(server.ListenAndServe())
}
```

### Patterns that help

- **Constructors return interfaces only when there are multiple impls.** Otherwise return the concrete type and let the caller take the interface.
- **No globals.** No `var DB *sql.DB` at package scope. Every dependency walks through `main`.
- **No `init()` for app wiring.** It runs in unpredictable order; it cannot return errors; it makes testing harder.
- **A `wire`-style code generator (Google's `wire` or `do`) is optional.** For under thirty constructors it is overkill. Past that, it pays for itself.

### Anti-pattern: "service locator" globals

```go
// DON'T
var Container = struct {
    DB    *sql.DB
    Cache *redis.Client
}{}

func init() { Container.DB = mustOpen(...) }
```

This trades explicit dependencies for invisible ones. Tests have to set globals; bugs are harder to localise. The pattern survives in legacy codebases; it should not be the starting point.

---

## Testing Strategy per Pattern

| Pattern | Where unit tests live | What they need |
|---|---|---|
| Layered | `service` and `domain` packages | Mocks/fakes of `repo` |
| Hexagonal | `core/service` package | In-memory secondary adapter |
| Clean | `usecase` package | Fakes for ports |
| Onion | `application` and `domain/service` | Fakes for repositories |

The shared insight: **the inner ring(s) test without touching real infrastructure.** That is the entire payoff for the layout. If your unit test for `service.OrderService` opens a real Postgres connection, the architecture has not done its job.

### A test that proves the architecture

```go
// internal/core/service/order_test.go
package service_test

import (
    "testing"

    "myshop/internal/adapter/secondary/memory"
    "myshop/internal/core/domain"
    "myshop/internal/core/service"
)

func TestPlace(t *testing.T) {
    repo := memory.NewOrderRepo()
    svc  := service.NewOrderService(repo)

    err := svc.Place(&domain.Order{ID: "1", Items: []domain.Item{{SKU: "x", Quantity: 1}}})
    if err != nil { t.Fatal(err) }

    got, _ := repo.FindByID("1")
    if got == nil { t.Fatal("order not saved") }
}
```

No network. No `testcontainers`. The test runs in milliseconds. This is the *proof* that the pattern is wired correctly — not the README.

---

## Migrating Between Patterns

Real services start one way and grow into another. The good news: in Go, the migration paths are gradual.

### Layered → Hexagonal (the common path)

1. Add an `internal/core/port/` package. Move the interfaces your `service` already defines into it.
2. Rename `internal/repo/` to `internal/adapter/secondary/postgres/`. Update imports.
3. Move `internal/handler/` to `internal/adapter/primary/http/`. Update imports.
4. Move `internal/service/` to `internal/core/service/`. Update imports.
5. Add an `internal/adapter/secondary/memory/` for tests.
6. Add a `go-arch-lint` rule (see [`professional.md`](professional.md)) to forbid `internal/core/` from importing `internal/adapter/`.

The change is mostly *moves and renames*. The Go compiler points out every broken import. Done in one PR for a small service; over a week of small PRs for a large one.

### Hexagonal → Clean (mostly cosmetic)

1. Rename `internal/core/domain/` → `internal/entity/`.
2. Rename `internal/core/service/` → `internal/usecase/`.
3. Make each use case its own file with one method.
4. Move `internal/core/port/` interfaces into `internal/usecase/ports.go` (or alongside their use case).
5. Update tests.

Hexagonal and clean are close cousins; this rename is mostly a vocabulary swap. Only do it if the team has decided clean's vocabulary is worth the disruption.

### Anti-pattern: half-migrated codebases

A repo with both `internal/service/` and `internal/usecase/` is the worst of both worlds. New engineers do not know which to extend. Either commit to the migration or revert it. Do not leave it half-done.

### When to *not* migrate

- The current pattern works. Migration is a cost; the gain has to be visible.
- The team is junior and the new pattern is more abstract. Cost is high; gain is invisible until features are added.
- The project is winding down. Migration is investment; you do not invest in code you are deleting.

---

## Common Pitfalls at This Level

- **The "service" / "use case" / "manager" trinity.** A package that contains all three is begging for confusion. Pick one and stick to it.
- **Putting `context.Context` in the domain.** Some teams accept it; others ban it. The point is to *decide* — not to have one engineer's preference leak in here, another's there.
- **Domain types that carry persistence concerns.** A `User` with `LastFetchedFromCacheAt` is no longer a domain object; it is an infrastructure leak.
- **One enormous `internal/usecase/` package.** Past 15–20 files, split by feature. The compiler stops being a useful guide when grep starts being your friend.
- **Shared "common" packages between layers.** `internal/common/`, `internal/utils/`, `internal/shared/` — they always become junk drawers. Push types where they belong, even if it means duplication. Two small dupes are cheaper than one wrong abstraction.
- **Premature interfaces.** A `UserService` interface satisfied by exactly one struct earns nothing. Add the interface the moment you need a second implementation (a fake, a remote variant, a feature flag), not before.

---

## Best Practices for Established Codebases

- **Document the dependency rule in the repo.** A short `ARCHITECTURE.md` or a comment at the top of `main.go` saying "domain → no infra imports" beats a folder-only convention.
- **Enforce the rule with tooling, not vigilance.** [`professional.md`](professional.md) covers `go-arch-lint`, `depguard`, and custom analyzers.
- **One package, one responsibility.** A package with `service.go`, `repository.go`, and `transport.go` is three packages crammed into one folder.
- **Keep `cmd/` thin.** Composition only. If `cmd/api/main.go` is 600 lines, the wiring has grown a body of its own — extract a `bootstrap` package.
- **Write a smoke test that imports `cmd/api/main`.** Catches wiring bugs at compile time.

---

## Self-Assessment

- [ ] I can pick layered vs hexagonal based on driver/drivee count.
- [ ] I can map any of the four patterns to a concrete `internal/` tree from memory.
- [ ] I know which pattern fits a CRUD service, a multi-driver service, and a many-use-case platform.
- [ ] I can wire a hexagonal service in a 50-line `main.go` without globals.
- [ ] I can split a layered codebase into hexagonal in a sequence of small, compile-clean PRs.
- [ ] I know when to split by feature vs by layer (and the hybrid).
- [ ] I never put domain types under `pkg/` unless another module actually imports them.

---

## Summary

At middle level, choosing an architecture is engineering, not branding. Layered is the default; hexagonal earns its keep when drivers or drivees multiply; clean and onion are flavours of hexagonal that pay off on large codebases. Map the chosen pattern to `cmd/`, `internal/`, and (rarely) `pkg/` deliberately. Use `main.go` as the composition root. Split by layer first, by feature second; mix when needed.

For deeper individual treatments (clean, hexagonal, DDD, CQRS, event sourcing) see [`../../19-architecture-patterns/`](../../19-architecture-patterns/). The next file, [`senior.md`](senior.md), takes this into the territory of evolving large codebases over time.

---

[← Junior](junior.md) · [Senior →](senior.md)
