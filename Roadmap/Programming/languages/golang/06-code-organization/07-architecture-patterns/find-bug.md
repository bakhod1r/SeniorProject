# Architecture Patterns — Find the Bug

> Each scenario shows a Go module layout that *claims* to follow one of the four patterns (layered, hexagonal, clean, onion) but contains a real architectural violation. Find the bug, explain why it breaks the pattern, and fix it. The bugs are about *structure* — what depends on what, where things live — not about runtime behaviour.

---

## Bug 1 — Domain imports the database driver

**Pattern claimed:** layered.

```go
// internal/domain/order.go
package domain

import (
    "database/sql"
)

type Order struct {
    ID    string
    Items []Item
    DB    *sql.DB
}

func (o *Order) Save() error {
    _, err := o.DB.Exec(`INSERT INTO orders ...`, o.ID)
    return err
}
```

**Bug.** The domain package imports `database/sql` and the `Order` type carries a `*sql.DB`. Layered architecture forbids the domain (lowest layer above infrastructure) from depending on infrastructure types. The `Save` method is an infrastructure concern that has crawled into the domain.

**Fix.** Remove `*sql.DB` from `Order`. Move persistence to a `repo` package:

```go
// internal/domain/order.go
package domain

type Order struct {
    ID    string
    Items []Item
}
```

```go
// internal/repo/order.go
package repo

import (
    "database/sql"
    "myshop/internal/domain"
)

type OrderRepo struct{ DB *sql.DB }

func (r *OrderRepo) Save(o *domain.Order) error {
    _, err := r.DB.Exec(`INSERT INTO orders ...`, o.ID)
    return err
}
```

Domain stays pure; the repo owns SQL.

---

## Bug 2 — Hexagonal core importing an adapter

**Pattern claimed:** hexagonal.

```go
// internal/core/service/order.go
package service

import (
    "myshop/internal/adapter/secondary/postgres" // <-- problem
    "myshop/internal/core/domain"
)

type OrderService struct{ Repo *postgres.OrderRepo }

func (s *OrderService) Place(o *domain.Order) error {
    return s.Repo.Save(o)
}
```

**Bug.** The core service imports a concrete adapter package. Hexagonal's defining rule — `core/` does not import `adapter/` — is violated. The arrow now points outward.

**Fix.** Define a port interface in `internal/core/port/`, depend on it, and let `cmd/main.go` wire the concrete adapter:

```go
// internal/core/port/output.go
package port

import "myshop/internal/core/domain"

type OrderRepository interface {
    Save(*domain.Order) error
}
```

```go
// internal/core/service/order.go
package service

import (
    "myshop/internal/core/domain"
    "myshop/internal/core/port"
)

type OrderService struct{ Repo port.OrderRepository }

func (s *OrderService) Place(o *domain.Order) error { return s.Repo.Save(o) }
```

The Postgres adapter implicitly satisfies `port.OrderRepository`; `main.go` injects it.

---

## Bug 3 — Clean architecture with the interface in the wrong place

**Pattern claimed:** clean.

```
internal/
├── entity/order.go
├── usecase/place_order.go
├── adapter/repository/postgres_order.go
└── adapter/repository/repository.go   ← interface lives here
```

```go
// internal/adapter/repository/repository.go
package repository

import "myshop/internal/entity"

type OrderRepository interface {
    Save(*entity.Order) error
}
```

```go
// internal/usecase/place_order.go
package usecase

import "myshop/internal/adapter/repository"

type PlaceOrder struct{ Repo repository.OrderRepository }
```

**Bug.** The interface is declared in the *adapter* package and imported by the *use case*. The dependency arrow now points outward (use case → adapter), which clean explicitly forbids. The interface belongs in the inner ring, declared by the consumer.

**Fix.** Move the interface to `internal/usecase/`:

```go
// internal/usecase/ports.go
package usecase

import "myshop/internal/entity"

type OrderRepository interface {
    Save(*entity.Order) error
}
```

```go
// internal/usecase/place_order.go
package usecase

type PlaceOrder struct{ Repo OrderRepository }
```

The Postgres struct in `adapter/repository/` satisfies it structurally; no import from adapter to use case.

---

## Bug 4 — Layered violation: handler imports repo directly

**Pattern claimed:** strict layered (handler → service → repo).

```go
// internal/handler/order.go
package handler

import (
    "encoding/json"
    "net/http"

    "myshop/internal/repo"
)

type OrderHandler struct{ Repo *repo.OrderRepo }

func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
    var o domain.Order
    json.NewDecoder(r.Body).Decode(&o)
    h.Repo.Save(&o)
    w.WriteHeader(201)
}
```

**Bug.** Handler skips the service layer and talks to the repo directly. In strict layered, each layer talks only to the one immediately below; here `handler` (presentation) skips `service` (application) and reaches `repo` (infrastructure). The service's validation, transactions, and orchestration are bypassed.

**Fix.** Restore the service in the middle:

```go
// internal/handler/order.go
package handler

import (
    "encoding/json"
    "net/http"

    "myshop/internal/service"
)

type OrderHandler struct{ Svc *service.OrderService }

func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
    var o domain.Order
    json.NewDecoder(r.Body).Decode(&o)
    if err := h.Svc.Create(&o); err != nil {
        http.Error(w, err.Error(), 500); return
    }
    w.WriteHeader(201)
}
```

Even in the *relaxed* layered version, skipping `service` is suspect because validation lives there.

---

## Bug 5 — Domain entity carries JSON tags

**Pattern claimed:** clean.

```go
// internal/entity/order.go
package entity

type Order struct {
    ID    string `json:"id"`
    Total int64  `json:"total"`
}
```

**Bug.** JSON tags are a *presentation* concern and live in the outermost ring of clean. Putting them on the entity couples the domain to the serialisation format used by the HTTP API. Tomorrow the API responds with `total_cents` — every entity has to change.

**Fix.** Strip the tags from the entity. Use a separate DTO at the HTTP boundary:

```go
// internal/entity/order.go
package entity

type Order struct {
    ID    string
    Total int64
}
```

```go
// internal/adapter/http/dto.go
package http

import "myshop/internal/entity"

type OrderDTO struct {
    ID    string `json:"id"`
    Total int64  `json:"total"`
}

func toDTO(o *entity.Order) OrderDTO {
    return OrderDTO{ID: o.ID, Total: o.Total}
}
```

The DTO lives in the adapter; the entity stays pure.

---

## Bug 6 — Onion application service imports infrastructure directly

**Pattern claimed:** onion.

```go
// internal/application/place_order.go
package application

import (
    "myshop/internal/domain/model"
    "myshop/internal/infrastructure/repository" // <-- wrong
)

type PlaceOrder struct{ Repo *repository.PostgresOrderRepo }

func (p *PlaceOrder) Execute(o *model.Order) error {
    return p.Repo.Save(o)
}
```

**Bug.** The application services ring imports the infrastructure ring. Onion's dependency rule says outer depends on inner, never the reverse. The application has reached *out* to grab a concrete `PostgresOrderRepo`.

**Fix.** Define the repository interface in the *domain* (onion's "domain services" ring is a common home for repository interfaces; alternatively, in `application/` itself):

```go
// internal/domain/repository/order.go
package repository

import "myshop/internal/domain/model"

type OrderRepository interface {
    Save(*model.Order) error
}
```

```go
// internal/application/place_order.go
package application

import (
    "myshop/internal/domain/model"
    "myshop/internal/domain/repository"
)

type PlaceOrder struct{ Repo repository.OrderRepository }
```

The Postgres adapter (in `infrastructure/`) implements the interface declared in the domain.

---

## Bug 7 — `init()` in domain wiring up infrastructure

**Pattern claimed:** hexagonal.

```go
// internal/core/domain/db.go
package domain

import (
    "database/sql"
    _ "github.com/lib/pq"
)

var DB *sql.DB

func init() {
    var err error
    DB, err = sql.Open("postgres", "postgres://...")
    if err != nil { panic(err) }
}
```

**Bug.** Two violations at once. The domain imports `database/sql` (and `lib/pq`) and uses `init()` to open a global database connection. The "core does not import infrastructure" rule is broken; additionally, configuration is read at import time, which makes the package impossible to test without a real database.

**Fix.** Move all of this to `cmd/main.go`. Pass the DB connection through a constructor as a port implementation. The domain has no `init()`, no global, no SQL import.

---

## Bug 8 — Two adapters importing each other

**Pattern claimed:** hexagonal.

```go
// internal/adapter/secondary/postgres/order.go
package postgres

import "myshop/internal/adapter/secondary/redis" // <-- wrong

type OrderRepo struct {
    DB    *sql.DB
    Cache *redis.OrderCache
}
```

**Bug.** Two secondary adapters depend on each other directly. Hexagonal expects every adapter to be independent — each implements a port; the core composes them. By importing `redis`, the Postgres adapter has a hidden coupling that bypasses the port abstraction and makes either one unswappable without changing the other.

**Fix.** Move the cache-or-DB orchestration into the core. The core service holds *both* a `port.OrderRepository` and a `port.OrderCache`:

```go
// internal/core/service/order.go
type OrderService struct {
    Repo  port.OrderRepository
    Cache port.OrderCache
}

func (s *OrderService) Get(id domain.OrderID) (*domain.Order, error) {
    if o, ok := s.Cache.Get(id); ok { return o, nil }
    o, err := s.Repo.FindByID(id)
    if err != nil { return nil, err }
    s.Cache.Set(o)
    return o, nil
}
```

Now `postgres/` and `redis/` are independent.

---

## Bug 9 — `pkg/` holding the domain

**Pattern claimed:** clean (or any).

```
shop/
├── pkg/
│   └── entity/order.go    ← domain in pkg/
└── internal/
    ├── usecase/
    └── adapter/
```

**Bug.** The domain is in `pkg/`, which signals "external consumers may import this." Now any change to `entity.Order` is a public-API break for unknown consumers. The domain belongs in `internal/` unless other modules genuinely import it.

**Fix.** Move `pkg/entity/` to `internal/entity/`. If a downstream module truly needs `Order`, expose a *DTO* in `pkg/`, not the domain entity itself.

---

## Bug 10 — `internal/utils` becoming the domain's parking lot

**Pattern claimed:** layered.

```
internal/
├── domain/
├── service/
├── repo/
└── utils/
    ├── time.go            ← business "is_business_day" logic
    ├── validation.go      ← order validation rules
    └── format.go          ← currency formatting
```

```go
// internal/service/order.go
package service

import "myshop/internal/utils"

func (s *OrderService) Create(o *domain.Order) error {
    if err := utils.ValidateOrder(o); err != nil { return err }
    return s.Repo.Save(o)
}
```

**Bug.** `internal/utils` has become a junk drawer. Specifically, business-validation logic lives in `utils/validation.go` instead of the domain. Currency formatting lives there too — that is presentation, not utility. The "utils" name hides architectural violations behind a generic word.

**Fix.** Distribute by concern:

- `utils/validation.go` → `internal/domain/order.go` (rules belong with the entity).
- `utils/format.go` → `internal/adapter/http/format.go` (formatting belongs with presentation).
- `utils/time.go` → either a *standalone* `internal/calendar/` package if it is truly cross-cutting, or split per consumer.

Delete `internal/utils/` entirely. Pure utilities can live in tiny named packages (`internal/idgen/`, `internal/clock/`); generic `utils/` is forbidden.

---

## Bug 11 — Use case depending on a concrete service

**Pattern claimed:** clean.

```go
// internal/usecase/place_order.go
package usecase

import (
    "myshop/internal/entity"
    "myshop/internal/adapter/email" // <-- wrong
)

type PlaceOrder struct {
    Repo  OrderRepository
    Email *email.SendgridSender
}
```

**Bug.** The use case depends on a *concrete* email sender from the adapter ring. The use case ring should depend only on entities and on its own ports. The Sendgrid type is an outer-ring concern.

**Fix.** Add an `EmailSender` interface to `internal/usecase/ports.go`, depend on it, let `main.go` inject the Sendgrid implementation.

```go
// internal/usecase/ports.go
type EmailSender interface {
    SendOrderConfirmation(*entity.Order) error
}

// internal/usecase/place_order.go
type PlaceOrder struct {
    Repo  OrderRepository
    Email EmailSender
}
```

---

## Bug 12 — Cross-context import in a modular monolith

**Pattern claimed:** layered, with three bounded contexts.

```
internal/
├── billing/
│   └── service/billing.go
├── catalog/
│   └── service/catalog.go
└── fulfilment/
    └── service/fulfilment.go
```

```go
// internal/fulfilment/service/fulfilment.go
package service

import (
    "myshop/internal/billing/service" // <-- direct cross-context dep
)

type Fulfilment struct{ Bill *service.Billing }
```

**Bug.** The `fulfilment` context imports `billing/service/` directly. In a modular monolith, contexts should communicate through a *narrow* contract (a published port, an event bus, or HTTP/gRPC), not through direct imports of each other's `internal/`. Direct imports prevent later extraction and create hidden coupling.

**Fix.** Define a contract in a shared location:

```go
// internal/shared/billing/port.go
package billing

import "myshop/internal/billing/model"

type Service interface {
    ChargeForOrder(orderID string, amount int64) error
}
```

`fulfilment` imports `internal/shared/billing/`; `billing` provides an adapter that implements the contract. When you split `billing` into a separate service, only the adapter changes — `fulfilment` keeps its imports.

---

## Bug 13 — `cmd/main.go` containing business logic

**Pattern claimed:** hexagonal.

```go
// cmd/api/main.go
package main

import (
    "log"
    "net/http"

    "myshop/internal/core/service"
)

func main() {
    svc := service.NewOrderService(...)
    http.HandleFunc("/orders", func(w http.ResponseWriter, r *http.Request) {
        var o domain.Order
        json.NewDecoder(r.Body).Decode(&o)
        // ↓ business rule in main()
        if o.Total < 0 { http.Error(w, "negative", 400); return }
        if err := svc.Place(&o); err != nil { http.Error(w, err.Error(), 500); return }
        w.WriteHeader(201)
    })
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Bug.** Business validation (`o.Total < 0`) lives in `main.go`. The composition root has grown a body. If a Kafka consumer is added next month, it will not run the same check. Validation belongs in the domain or service.

**Fix.** Move `o.Total < 0` into `domain.Order.Validate()` (or the service's `Place`). Keep `main.go` to wiring only.

---

## Bug 14 — Adapter holding domain interface

**Pattern claimed:** hexagonal.

```go
// internal/adapter/secondary/postgres/order.go
package postgres

import "myshop/internal/core/domain"

type OrderProvider interface {
    Save(*domain.Order) error
}

type OrderRepo struct { /* ... */ }

func (r *OrderRepo) Save(o *domain.Order) error { /* ... */ return nil }
```

**Bug.** The adapter package declares an interface (`OrderProvider`) that *parallels* the port the core declares. Now there are two interfaces for the same role, in two packages. The core uses `port.OrderRepository`; nobody uses `OrderProvider`. It is dead architecture.

**Fix.** Delete `OrderProvider`. Adapters do not need to declare interfaces for what they expose — they just need to implement the port that lives in `core/port/`. Go's structural typing means the connection is automatic.

---

## Bug 15 — Layered service whose tests need a real DB

**Pattern claimed:** layered.

```go
// internal/service/order_test.go
package service_test

import (
    "database/sql"
    "testing"

    _ "github.com/lib/pq"

    "myshop/internal/repo"
    "myshop/internal/service"
)

func TestCreate(t *testing.T) {
    db, _ := sql.Open("postgres", "postgres://localhost/test")
    s := &service.OrderService{Repo: &repo.OrderRepo{DB: db}}
    // ...
}
```

**Bug.** A *unit test* for the service layer depends on a real Postgres connection. The architecture's promise — that the service is testable in isolation — is broken because the service depends on the *concrete* `repo.OrderRepo` instead of an interface, so the test cannot substitute a fake.

**Fix.** Make the service depend on an interface, and add a memory-backed fake:

```go
// internal/service/order.go
type OrderRepository interface {
    Save(*domain.Order) error
}

type OrderService struct{ Repo OrderRepository }
```

```go
// internal/service/order_test.go
type fakeRepo struct{ saved []*domain.Order }
func (f *fakeRepo) Save(o *domain.Order) error { f.saved = append(f.saved, o); return nil }

func TestCreate(t *testing.T) {
    s := &service.OrderService{Repo: &fakeRepo{}}
    // ...
}
```

The test runs in microseconds with no infrastructure. That *is* the architecture working.

---

[← Tasks](tasks.md) · [Optimize →](optimize.md)
