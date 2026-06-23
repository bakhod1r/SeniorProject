# Architecture Patterns — Optimization

> Honest framing: most "architecture optimisation" in Go is *subtraction*. A clean diagram pasted onto a small project usually means more files, more interfaces, more indirection — and no real benefit. Each entry below shows a layout that has paid for ceremony it does not need, and a leaner version that keeps the architectural intent without the overhead. The goal is not to forbid clean/hexagonal/onion — it is to spend the architectural budget intentionally instead of by accident.

---

## Optimization 1 — Collapse single-implementation interfaces

**Problem.** Hexagonal/clean projects love interfaces. Many of them have exactly one implementation, no test fake, and no plan for a second. Each costs four lines plus a separate file.

**Before.**
```
internal/core/port/clock.go        ← Clock interface
internal/adapter/secondary/clock/  ← system implementation
```
```go
// port/clock.go
package port

import "time"
type Clock interface{ Now() time.Time }

// adapter/secondary/clock/clock.go
package clock
type System struct{}
func (System) Now() time.Time { return time.Now() }
```

A `Clock` port that wraps `time.Now`. Nobody fakes it; tests use real time anyway.

**After.** Delete both files. Use `time.Now()` directly. Re-introduce an interface the day a test actually needs to inject a fake clock.

**Gain.** Two fewer files, no constructor parameter, no wiring in `main.go`. The day a test wants a fake, *that* test introduces the abstraction — closer to the consumer, smaller blast radius.

---

## Optimization 2 — Drop per-method DTO types

**Problem.** Clean tutorials prescribe `XxxInput` / `XxxOutput` for every use case. In Go, when the input and output are nearly identical to the entity plus an `error`, the DTOs add lines without adding meaning.

**Before.**
```go
type PlaceOrderInput struct {
    OrderID string
    Items   []ItemInput
}
type ItemInput struct{ SKU string; Quantity int }

type PlaceOrderOutput struct {
    OrderID string
    Total   int64
}

func (p *PlaceOrder) Execute(in PlaceOrderInput) (PlaceOrderOutput, error) {
    o := entity.Order{ID: in.OrderID, Items: convertItems(in.Items)}
    if err := o.Validate(); err != nil { return PlaceOrderOutput{}, err }
    if err := p.Repo.Save(&o); err != nil { return PlaceOrderOutput{}, err }
    return PlaceOrderOutput{OrderID: o.ID, Total: o.Total}, nil
}
```

**After.**
```go
func (p *PlaceOrder) Execute(o *entity.Order) error {
    if err := o.Validate(); err != nil { return err }
    return p.Repo.Save(o)
}
```

**Gain.** Removed two types, two converters, and the mental cost of mapping between them. The entity is the contract.

When DTOs *are* worth keeping: when the input is a strict subset of the entity (e.g., `CreateUser` takes a password but `User` does not store it in cleartext), or when the API stability of the use case must not follow the domain.

---

## Optimization 3 — Merge layers that always change together

**Problem.** A "service" layer and a "use case" layer where every service has exactly one method and every use case wraps exactly one service. Two layers, one purpose.

**Before.**
```
internal/usecase/place_order.go     ← calls service
internal/service/order_service.go   ← calls repo
```

```go
type PlaceOrder struct{ Svc *OrderService }
func (p *PlaceOrder) Execute(o *entity.Order) error { return p.Svc.Place(o) }

type OrderService struct{ Repo Repo }
func (s *OrderService) Place(o *entity.Order) error { return s.Repo.Save(o) }
```

**After.**
```go
type PlaceOrder struct{ Repo Repo }
func (p *PlaceOrder) Execute(o *entity.Order) error { return p.Repo.Save(o) }
```

**Gain.** One layer instead of two. The `OrderService` re-introduces itself the day a use case orchestrates more than one repository — when it earns its keep.

---

## Optimization 4 — Inline tiny "controller" packages

**Problem.** A tutorial-driven layout has separate `controller/`, `presenter/`, and `dto/` packages, each containing two functions and one struct. The split exists in theory because Java needs it; in Go it is just three folders.

**Before.**
```
internal/adapter/http/controller/order.go
internal/adapter/http/presenter/order.go
internal/adapter/http/dto/order.go
```

**After.**
```
internal/adapter/http/order.go     ← struct, handler, DTO, all together
```

Three small files in one folder become one cohesive file. If it grows to 300 lines, then split. Splitting *before* it grows is speculation.

**Gain.** Less navigation, fewer imports across thin packages, less ceremony in the tree.

---

## Optimization 5 — Delete `internal/utils` and friends

**Problem.** Any package named `utils`, `common`, `helpers`, `shared`, or `misc` is a junk drawer waiting to happen. They start small, accumulate unrelated functions, and erode the architecture.

**Before.**
```
internal/utils/
├── time.go           ← business-day rules (domain leak)
├── format.go         ← currency formatting (presentation leak)
├── validation.go     ← order rules (domain leak)
└── strings.go        ← actually generic strings.TrimX wrappers
```

**After.**
```
internal/core/domain/calendar.go    ← business-day rules
internal/adapter/http/format.go     ← currency formatting
internal/core/domain/order.go        ← order validation
                                      ← (delete strings.go; the stdlib already does it)
```

**Gain.** Each function is now in its architecturally correct home. The "utils" name is gone; the diagonal architectural leaks are repaired.

---

## Optimization 6 — Stop generating one folder per use case for trivial features

**Problem.** Clean architecture's "one use case per file" guidance becomes "one use case per *folder*" in some templates. A `CRUD` feature now has four folders.

**Before.**
```
internal/usecase/order/
├── create/usecase.go
├── update/usecase.go
├── delete/usecase.go
└── get/usecase.go
```

Each folder holds one 20-line file.

**After.**
```
internal/usecase/order.go
```

A single file with `Create`, `Update`, `Delete`, `Get` methods on one `OrderUseCase` struct. Splits when it actually grows past 300 lines or when one of those operations gets complex enough to warrant its own life.

**Gain.** Fewer folders, fewer imports, less navigation. The split is delayed until it pays for itself.

---

## Optimization 7 — Use the `cmd/` composition root, not a "container" package

**Problem.** A pattern imported from Java/C# DI frameworks: an `internal/container/` package that constructs everything, exposed as a global. It looks neat but introduces a hidden dependency to *every* test and *every* binary.

**Before.**
```go
// internal/container/container.go
package container

var (
    DB    *sql.DB
    Repo  *postgres.OrderRepo
    Svc   *service.OrderService
)

func Init() { DB = sql.Open(...); Repo = ...; Svc = ... }
```

```go
// internal/handler/order.go
import "myshop/internal/container"
func Handler() http.Handler { return makeHandler(container.Svc) }
```

**After.** Move all wiring into `cmd/api/main.go`. Pass dependencies through constructor parameters. Tests construct what they need; production constructs once, in `main`.

**Gain.** No hidden globals, tests are obvious, two binaries can share the core without sharing globals. The cost saved is "every test must reset the container before running" — which adds up across a few hundred tests.

---

## Optimization 8 — Drop the "abstract repository" base

**Problem.** Cargo-culted from object-oriented frameworks: a `Repository` interface so generic that every concrete repo implements `Save(any)`, `Find(id any) any`, `Delete(any)`. Every consumer then casts the return value.

**Before.**
```go
type Repository interface {
    Save(any) error
    Find(id any) (any, error)
    Delete(any) error
}
```

**After.** One specific port per role:
```go
type OrderRepository interface {
    Save(*domain.Order) error
    FindByID(domain.OrderID) (*domain.Order, error)
}
```

**Gain.** Type safety, no `any`, no casts. The Go convention is *small, role-specific* interfaces, not generic ones. The day you actually need polymorphic storage, generics give you `Repository[T]`, which is type-safe.

---

## Optimization 9 — Stop wrapping stdlib types just to "abstract them"

**Problem.** Wrapping `*sql.DB` in your own `DB interface{ Exec(...); Query(...) }` is ceremony. The wrapper has the same shape as `*sql.DB`; the abstraction does not let you swap to a different storage technology — only to a different *fake* of `*sql.DB`. The actual abstraction you want — `OrderRepository` — is one ring up.

**Before.**
```go
type DB interface {
    Exec(string, ...any) (sql.Result, error)
    Query(string, ...any) (*sql.Rows, error)
}
type OrderRepo struct{ DB DB }
```

**After.**
```go
type OrderRepo struct{ DB *sql.DB }
```

The port that the *core* depends on is `OrderRepository`. The repository's internal use of `*sql.DB` is an implementation detail of the adapter. Wrapping `*sql.DB` itself adds a layer that does not pay rent.

**Gain.** One fewer interface, one fewer mock. The architectural seam is at the right altitude (the repository), not too deep (the SQL driver).

---

## Optimization 10 — Collapse "feature → layer → file" into "layer → feature"

**Problem.** A layout that splits feature first, then layer, ends up with deeply nested folders that mirror nothing meaningful.

**Before.**
```
internal/feature/order/handler/handler.go
internal/feature/order/service/service.go
internal/feature/order/repo/repo.go
internal/feature/invoice/handler/handler.go
internal/feature/invoice/service/service.go
internal/feature/invoice/repo/repo.go
```

Six folders for two features.

**After.**
```
internal/handler/{order.go, invoice.go}
internal/service/{order.go, invoice.go}
internal/repo/{order.go, invoice.go}
```

Or, for medium-sized projects, the hybrid:
```
internal/core/service/order/place.go
internal/core/service/invoice/issue.go
internal/adapter/secondary/postgres/{order.go, invoice.go}
```

**Gain.** Fewer folders, the dependency rule is visible at the top level, common cross-feature changes are one folder away.

---

## Optimization 11 — Replace `pkg/` with `internal/` until a real consumer appears

**Problem.** "We might need this externally one day" → everything in `pkg/`. Now every type is a public API; every change risks breaking unknown consumers.

**Before.**
```
pkg/entity/
pkg/usecase/
pkg/adapter/
```

**After.**
```
internal/entity/
internal/usecase/
internal/adapter/
```

Move to `pkg/` only when an actual second module wants to import it.

**Gain.** Free refactoring inside the module, no public-API contract until you opt in, less worry about breaking external consumers.

---

## Optimization 12 — Stop generating boilerplate the compiler will catch anyway

**Problem.** Defensive patterns inherited from dynamically-typed languages: `if svc == nil { panic("nil service") }` at the start of every method, `var _ port.OrderRepository = (*OrderRepo)(nil)` "compile-time checks" for every adapter, etc.

**Before.**
```go
type OrderService struct{ Repo port.OrderRepository }

func NewOrderService(r port.OrderRepository) *OrderService {
    if r == nil { panic("repo is required") }
    return &OrderService{Repo: r}
}

func (s *OrderService) Place(o *domain.Order) error {
    if s == nil { panic("nil service") }
    if s.Repo == nil { panic("nil repo") }
    if o == nil { panic("nil order") }
    // ...
}
```

**After.**
```go
func NewOrderService(r port.OrderRepository) *OrderService {
    return &OrderService{Repo: r}
}

func (s *OrderService) Place(o *domain.Order) error {
    if err := o.Validate(); err != nil { return err }
    return s.Repo.Save(o)
}
```

**Gain.** Less code, faster code, equivalent safety in practice. A nil dereference will panic with a stack trace that is just as useful as the explicit check. Save the explicit check for boundaries that must report a clean error.

When the explicit check *is* worth keeping: at the *outer* boundary (HTTP handler, CLI parser) where the panic would otherwise crash the binary mid-request.

---

## Optimization 13 — Delete the `domain/service/` ring when there is nothing in it

**Problem.** Onion architecture mandates a "domain services" ring. If your domain logic fits inside entity methods, the ring is empty — yet you have a folder, an import path, and contributors looking at it wondering what to put there.

**Before.**
```
internal/domain/
├── model/
└── service/      ← contains nothing or a single one-line function
```

**After.** Drop `service/`. Re-add it the day a domain operation actually spans multiple entities and refuses to live inside one of them.

**Gain.** One fewer empty folder. Onion is then effectively clean architecture for this codebase, which is fine — names follow needs, not the reverse.

---

## Optimization 14 — Stop importing every adapter from `cmd/main.go` directly

**Problem.** A `main.go` that imports thirty adapter packages, constructs them in order, and wires them. Hard to read, hard to extend, and `go build` for the command pulls in *all* adapters even when only some are used.

**Before.**
```go
// cmd/api/main.go
import (
    "myshop/internal/adapter/secondary/postgres"
    "myshop/internal/adapter/secondary/redis"
    "myshop/internal/adapter/secondary/stripe"
    "myshop/internal/adapter/secondary/sendgrid"
    // ...20 more
)
```

**After.** Extract a `bootstrap` package that handles wiring:
```go
// internal/bootstrap/api.go
package bootstrap

import (
    "myshop/internal/adapter/secondary/postgres"
    // ...
)

func NewAPI(cfg Config) (*App, error) {
    repo := postgres.NewOrderRepo(...)
    // ...
    return &App{...}, nil
}
```

```go
// cmd/api/main.go
func main() {
    app, err := bootstrap.NewAPI(cfg)
    if err != nil { log.Fatal(err) }
    app.Run()
}
```

**Gain.** `main.go` stays under 30 lines. Different binaries (`cmd/api`, `cmd/worker`) call different `bootstrap.NewXxx`, pulling in only the adapters they need.

---

## Optimization 15 — Trim oversize ARCHITECTURE.md down to the rules

**Problem.** A 600-line `ARCHITECTURE.md` that explains hexagonal in tutorial detail. Nobody reads past the first page; the rules drift from the code.

**Before.** A novel about clean architecture, including diagrams from Robert Martin's book reproduced from memory.

**After.** A 30-line file with the rules:

```
# Architecture

Pattern: Hexagonal (ports and adapters).

Components:
  internal/core/domain    — entities; depends on nothing in this module.
  internal/core/port      — interfaces; depends on domain only.
  internal/core/service   — input-port impls; depends on domain + port.
  internal/adapter/primary/...   — driving adapters.
  internal/adapter/secondary/... — driven adapters.
  cmd/<binary>            — composition root; may import anything.

Rules:
  R1. internal/core/** must not import internal/adapter/**.
  R2. internal/core/domain/** must not import internal/core/port,service.
  R3. internal/adapter/secondary/A must not import internal/adapter/secondary/B.
  R4. cmd/** is the only allowed composition root.

Enforcement: depguard rules in .golangci.yml + boundary tests in
internal/core/**/boundary_test.go.

Deeper context: roadmap/.../19-architecture-patterns/.
```

**Gain.** People read it; rules survive. The deeper material lives in the roadmap, not in this file.

---

## A short closing note

Architecture is most valuable when it is *invisible* — when engineers add features without consciously thinking about which folder code goes in, because the patterns are already in their bones. Every optimisation above moves toward invisibility: less to think about per change, less ceremony, less navigation, fewer files that exist for explanation rather than function.

If a pattern is making you think about itself more often than about the problem, the pattern is winning a fight it should not be in.

For deeper material on each individual pattern see [`../../19-architecture-patterns/`](../../19-architecture-patterns/).

---

[← Find the Bug](find-bug.md) · [Back to Index](index.md)
