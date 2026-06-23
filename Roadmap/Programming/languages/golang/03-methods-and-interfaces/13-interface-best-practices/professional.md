# Interface Best Practices — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [DDD — Ports and Aggregates](#ddd-ports-and-aggregates)
3. [Hexagonal Architecture in Go](#hexagonal-architecture-in-go)
4. [Interface Governance in Large Codebases](#interface-governance-in-large-codebases)
5. [Module Boundary Contracts](#module-boundary-contracts)
6. [API Stability Guarantees and Semver](#api-stability-guarantees-and-semver)
7. [Cross-Team Interface Reviews](#cross-team-interface-reviews)
8. [Tooling Pipeline](#tooling-pipeline)
9. [Migration Playbooks](#migration-playbooks)
10. [Production-Grade Documentation Standards](#production-grade-documentation-standards)
11. [Observability and Interface Contracts](#observability-and-interface-contracts)
12. [Case Study — Splitting a Monolith Repo Interface](#case-study-splitting-a-monolith-repo-interface)
13. [Summary](#summary)

---

## Introduction

At the professional level, interface design is no longer just a code-quality concern — it is an **organisational** concern. Each interface published from your service is a contract with other teams, other services, and your own future self. Decisions about interface size, location, and stability ripple into:

- Release management
- On-call burden
- Cross-team review velocity
- Migration cost when a dependency churns

This file is about the *positive* practices that scale: how to ship interfaces that survive multiple major refactors, multiple team rotations, and multiple semver bumps. The companion section `14-interface-anti-patterns` describes what to avoid.

---

## DDD — Ports and Aggregates

In domain-driven design the **ports** of an aggregate are interfaces. They describe what the aggregate needs from the outside world, not what it provides.

### Port — declared by the domain, satisfied by infrastructure

```go
// Package: domain/billing
package billing

import "context"

// Port — the domain knows it needs to load and persist invoices.
// It does NOT know about Postgres, MongoDB, or HTTP.
type InvoiceRepo interface {
    Get(ctx context.Context, id InvoiceID) (*Invoice, error)
    Save(ctx context.Context, inv *Invoice) error
}

// Port — the domain knows it needs to charge a payment method.
type PaymentGateway interface {
    Charge(ctx context.Context, customer CustomerID, amount Money) (TxID, error)
}
```

### Aggregate root — concrete struct with methods

```go
type Invoice struct {
    id     InvoiceID
    lines  []Line
    status InvoiceStatus
    events []DomainEvent
}

func (i *Invoice) Settle(tx TxID) error {
    if i.status != Issued { return ErrNotIssued }
    i.status = Paid
    i.events = append(i.events, InvoiceSettled{ID: i.id, Tx: tx})
    return nil
}
```

The aggregate is concrete; ports are interfaces. Tests construct the aggregate directly and stub the ports. **Both rules from junior level — "small interfaces" and "consumer-side definition" — fall out automatically when DDD is applied.**

### Application service composes ports

```go
type SettleUseCase struct {
    repo    InvoiceRepo
    gateway PaymentGateway
    events  EventBus
}

func (uc *SettleUseCase) Execute(ctx context.Context, id InvoiceID) error {
    inv, err := uc.repo.Get(ctx, id)
    if err != nil { return err }
    tx, err := uc.gateway.Charge(ctx, inv.Customer, inv.Total)
    if err != nil { return err }
    if err := inv.Settle(tx); err != nil { return err }
    if err := uc.repo.Save(ctx, inv); err != nil { return err }
    for _, e := range inv.PullEvents() {
        uc.events.Publish(ctx, e)
    }
    return nil
}
```

Each port is one or two methods. Each test fakes only the ports it needs.

---

## Hexagonal Architecture in Go

Hexagonal architecture says: keep the domain in the centre; surround it by adapters that translate the outside world into the language of the domain. **Interfaces are the hexagon's edges.**

### Layout

```
internal/
  billing/                  domain — invoices, money, events
    invoice.go
    invoice_repo.go         (interface — port)
    payment_gateway.go      (interface — port)
    settle_usecase.go
    notify_usecase.go

  adapters/
    postgres/               adapter — implements ports against Postgres
      invoice_repo.go
    stripe/                 adapter — implements PaymentGateway against Stripe
      gateway.go
    kafka/                  adapter — implements EventBus
      bus.go

cmd/
  billingd/main.go          composition root — wires adapters into use cases
```

### Wiring at the composition root

```go
func main() {
    db := openPostgres()
    stripe := newStripeClient(secret)
    bus := newKafkaBus(brokers)

    repo := postgres.NewInvoiceRepo(db)        // *postgres.InvoiceRepo
    gw := stripe.NewGateway(stripe)            // *stripe.Gateway
    publisher := kafka.NewBus(bus)             // *kafka.Bus

    settle := billing.NewSettleUseCase(repo, gw, publisher)
    server := newHTTPServer(settle)
    server.ListenAndServe()
}
```

Domain code never imports `postgres`, `stripe`, `kafka`, or `net/http`. Each adapter only needs to satisfy its port — *implicitly*, because Go interfaces are structurally typed.

### Why this scales

- Swap Postgres for SQLite — change `main.go` only.
- Add a second event bus (RabbitMQ) — drop another adapter; the domain is untouched.
- Test the entire use case with in-memory fakes — no docker compose required.
- Onboard a new engineer — they read `internal/billing/` and understand the system without learning Postgres syntax.

---

## Interface Governance in Large Codebases

When dozens or hundreds of engineers share a repo, interface design needs **governance**, not heroism.

### Conventions to codify

1. **Location** — interfaces live in the consumer package; exceptions require a doc comment explaining why.
2. **Size** — at most three methods unless reviewed and approved.
3. **Naming** — `-er` for one method, role nouns for orchestrators (`Service`, `Repository`).
4. **Exporting** — unexported by default; exported requires a use case from at least two consumers or external SDK requirements.
5. **Compile-time check** — required for any concrete type whose godoc mentions a satisfied interface.
6. **Documentation** — the required godoc has sections for contract, errors, concurrency, optional cousins.

### Enforce mechanically

Use `staticcheck`, `revive`, and a custom analyser to fail builds when:
- An exported interface has more than N methods (configurable, default 4)
- An interface declared in a package has zero callers in that package (likely producer-side, may be misplaced)
- A concrete type has a "// implements X" comment but no `var _ X = ...` check

### A code review template line

> "Interface `Foo` has 6 methods, declared in the implementer package. Can it be split per consumer?"

This becomes a routine review prompt; the rule scales without depending on memory.

---

## Module Boundary Contracts

In a Go monorepo with multiple modules (or a polyrepo with `replace` directives), the public API of each module is its **interface surface**.

### Practice — one file per public interface set

```
mymodule/
  doc.go              package overview
  client.go           public *Client (concrete)
  options.go          public Options (concrete)
  iface.go            public interfaces (if any)
  internal/...        everything else
```

Engineers reviewing a PR see at a glance what the module promises to the world.

### Practice — `internal/` for everything you do not promise

If a type or interface is in `internal/`, no other module can import it. Use this aggressively. Anything that *could* leak should not be public.

### Practice — semantic versioning

- `v1.x.x` while the API is unstable.
- `v1.0.0` only when ready to commit.
- `v2/` subdirectory when introducing breaking interface changes.
- `replace` only as a temporary measure during migration.

---

## API Stability Guarantees and Semver

Adding a method to an exported interface is a major-version event. Even if the standard library lets you compile, every consumer that implemented the interface (e.g., as a mock) breaks.

### Stability tiers

| Tier | Definition | Allowed changes |
|------|-----------|-----------------|
| **Frozen** (v1+) | Public, semver-protected | Add types, add fields, add functions. No method add to interface. No signature change. |
| **Experimental** (v0) | Tagged `experimental` | Anything, but with changelog notes |
| **Internal** | `internal/` package | Anything anytime |

### How to *grow* a frozen interface

1. **Sibling interface** — define `MyInterfaceV2` that embeds the original and adds methods.
2. **Optional interface** — define a new one-method interface and probe with `if x, ok := v.(Optional); ok { ... }`.
3. **Major bump** — release `mypkg/v2` if a fundamentally new shape is needed.

### Senior comment in the interface file

```go
// API stability: v1 frozen.
// Do not add methods. Use SiblingV2 or an optional probe interface.
type Cache interface {
    Get(key string) ([]byte, bool)
    Set(key string, val []byte)
}
```

That comment is law; CI rejects PRs that violate it.

---

## Cross-Team Interface Reviews

When team A's interface is consumed by teams B, C, D, the review process must include the consumers.

### Review request template

> Title: `[interfaces] Adding payments.Refunder optional interface`
>
> Required signatures:
> - `Refund(ctx, txID, amount) (RefundID, error)`
>
> Consumers expected to use it: `billing/`, `support/`
>
> Question: Are the error semantics right? Is `amount` allowed to be nil for full-refund?

### Sign-off

Consumer teams approve before the interface lands. Frozen interfaces get an `OWNERS` file listing required reviewers from each consumer team.

### Periodic interface audits

Quarterly: list all public interfaces, count consumers, count methods, count age. Outliers (10-method interface in use by 1 caller) get a refactor ticket.

---

## Tooling Pipeline

The Go ecosystem has the tools; you need to wire them as build gates.

### `go vet`

- Catches `passes lock by value` and `composites` mistakes that affect interface satisfaction.

### `staticcheck`

- ST1003 — receiver naming
- ST1016 — receiver name consistency
- ST1020/ST1021 — exported types and interfaces require godoc
- SA1019 — deprecated method usage

### `revive`

- `unused-receiver` flags methods whose receiver is unused (often signs of "should be a function")
- `exported` enforces godoc presence

### `golangci-lint`

Pull all of the above into a single CI step. Add the interface-size custom analyser:

```yaml
linters-settings:
  custom:
    interface-size:
      path: ./tools/iface_size.so
      description: "Reject exported interfaces with more than 3 methods"
```

### `gomock` / `mockery`

- For the few interfaces that *are* big and stable (gateways, drivers), generate mocks.
- For one-method ports, prefer hand-written fakes — the mock is shorter than the generator config.

### `golang.org/x/tools/cmd/goimports`

Formats and orders imports; makes interface dependency visualisation trivial.

### `goda` and `go list -deps`

Visualise dependency direction. If `domain/billing` depends on `adapters/postgres` — alarm bell, hexagonal violation.

---

## Migration Playbooks

Real migrations need recipes, not heroics.

### Migration A — Splitting a fat interface

1. Inventory call sites. Group methods by consumer.
2. Declare per-consumer interfaces in their own packages.
3. Update consumer parameter types.
4. Confirm `*ConcreteImpl` satisfies all of them with `var _ I = ...` checks.
5. Mark the old fat interface `// Deprecated: split into ...` and remove on the next major version.

### Migration B — Moving an interface from producer to consumer side

1. Copy the interface declaration to the consumer package.
2. Add `var _ consumer.Iface = (*producer.Impl)(nil)` in the consumer.
3. Update consumer parameters to use the local interface.
4. Remove the original declaration once nothing imports it.

### Migration C — Introducing an optional interface

1. Declare the optional interface alongside the required one.
2. Add `if x, ok := v.(Optional); ok { ... }` probes in the package that benefits.
3. Document the new interface in the required interface's godoc ("Implementations may also satisfy Optional...").
4. Any caller that wants the fast path implements the new interface; nobody else changes.

### Migration D — From single producer to multiple producers

1. Start with the consumer-side interface already in place.
2. Add the second concrete type satisfying it.
3. Add a CI test that asserts both `var _ I = (*Type1)(nil)` and `var _ I = (*Type2)(nil)`.
4. Update the godoc to mention both implementations.

---

## Production-Grade Documentation Standards

A production interface doc has sections, not paragraphs.

```go
// Cache stores small bytes blobs keyed by string.
//
// Concurrency
//
// All methods are safe for concurrent use by multiple goroutines.
//
// Errors
//
// Get never returns an error; the bool indicates miss vs hit.
// Set never returns an error; overwrites silently. Implementations
// that may fail should not satisfy this interface; instead, see
// FailibleCache below.
//
// Optional capabilities
//
// Implementations may also satisfy Patterner to support DeletePattern
// for bulk invalidation.
//
// Implementations
//
// The package provides MemCache (in-process LRU) and RedisCache
// (network-backed) as standard adapters.
type Cache interface {
    Get(key string) ([]byte, bool)
    Set(key string, val []byte)
}
```

That doc replaces a wiki page. Engineers read the source; the source teaches them everything.

### Documenting the contract on optional probes

```go
// Patterner extends Cache with bulk-by-pattern invalidation. Cache
// callers should look for this interface via type assertion before
// using DeletePattern.
type Patterner interface {
    DeletePattern(pattern string) error
}
```

The probe pattern itself becomes part of the package convention.

---

## Observability and Interface Contracts

Production interfaces should be **observable**. Wrap them with logging, tracing, and metrics adapters.

```go
// In adapters/observability/
package observability

import (
    "context"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/trace"
)

type tracedRepo struct {
    inner billing.InvoiceRepo
    tr    trace.Tracer
}

func TraceRepo(inner billing.InvoiceRepo) billing.InvoiceRepo {
    return &tracedRepo{inner: inner, tr: otel.Tracer("billing")}
}

func (t *tracedRepo) Get(ctx context.Context, id billing.InvoiceID) (*billing.Invoice, error) {
    ctx, span := t.tr.Start(ctx, "InvoiceRepo.Get")
    defer span.End()
    return t.inner.Get(ctx, id)
}

func (t *tracedRepo) Save(ctx context.Context, inv *billing.Invoice) error {
    ctx, span := t.tr.Start(ctx, "InvoiceRepo.Save")
    defer span.End()
    return t.inner.Save(ctx, inv)
}
```

Because `billing.InvoiceRepo` is small, the wrapper is small. Composition: `TraceRepo(LogRepo(MetricsRepo(PgRepo)))`. Each layer adds one cross-cutting concern.

### Senior takeaway

Interfaces are the natural seam where observability is woven in. The smaller and more stable the interface, the cheaper the observability layer.

---

## Case Study — Splitting a Monolith Repo Interface

A real refactor pattern.

### Before

```go
// internal/repo/repo.go
package repo

type Repo interface {
    GetUser(ctx context.Context, id UserID) (*User, error)
    SaveUser(ctx context.Context, u *User) error
    GetOrder(ctx context.Context, id OrderID) (*Order, error)
    SaveOrder(ctx context.Context, o *Order) error
    GetInvoice(ctx context.Context, id InvoiceID) (*Invoice, error)
    SaveInvoice(ctx context.Context, inv *Invoice) error
    ListInvoicesByCustomer(ctx context.Context, c CustomerID) ([]Invoice, error)
    DeleteUser(ctx context.Context, id UserID) error
    // … 14 methods total
}

type pgRepo struct{ db *sql.DB }

// pgRepo satisfies Repo
```

Every consumer takes `Repo`. Mocks are huge. Adding a method breaks all consumers.

### After (per-consumer interfaces)

```go
// internal/users/users.go
package users
type Store interface {
    Get(ctx context.Context, id UserID) (*User, error)
    Save(ctx context.Context, u *User) error
    Delete(ctx context.Context, id UserID) error
}
```

```go
// internal/orders/orders.go
package orders
type Store interface {
    Get(ctx context.Context, id OrderID) (*Order, error)
    Save(ctx context.Context, o *Order) error
}
```

```go
// internal/billing/billing.go
package billing
type InvoiceRepo interface {
    Get(ctx context.Context, id InvoiceID) (*Invoice, error)
    Save(ctx context.Context, inv *Invoice) error
}
type InvoiceLister interface {
    ListByCustomer(ctx context.Context, c CustomerID) ([]Invoice, error)
}
```

The concrete `pgRepo` keeps all 14 methods and satisfies every small interface implicitly. `var _` checks confirm:

```go
// internal/repo/check.go
package repo

var (
    _ users.Store          = (*pgRepo)(nil)
    _ orders.Store         = (*pgRepo)(nil)
    _ billing.InvoiceRepo  = (*pgRepo)(nil)
    _ billing.InvoiceLister = (*pgRepo)(nil)
)
```

### Outcomes

- Mocks shrunk from 14 methods to 1-3 per consumer.
- New methods can be added to `pgRepo` without affecting any interface.
- Each domain package compiles independently.
- Onboarding new engineers: each domain reads its own ~10-line port.

---

## Summary

Professional interface practice is governance plus discipline:

1. **DDD ports** — domain declares small interfaces; infrastructure satisfies them.
2. **Hexagonal architecture** — interfaces are the hexagon edges.
3. **Governance** — codify size, naming, location rules; enforce in CI.
4. **Module boundaries** — public surface is small and frozen; everything else `internal/`.
5. **Semver discipline** — never add to a frozen interface; embed, sibling, or v2.
6. **Cross-team review** — consumer sign-off on interface changes.
7. **Tooling pipeline** — go vet, staticcheck, revive, custom size analyser.
8. **Migration playbooks** — splitting, moving, optional probes — recipes, not improv.
9. **Observability seams** — small interfaces make tracing/logging wrappers trivial.

When the interface is right, the rest of the system bends around it cleanly. When it is wrong, no amount of code can compensate.
