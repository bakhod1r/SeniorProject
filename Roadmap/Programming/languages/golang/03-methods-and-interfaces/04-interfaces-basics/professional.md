# Interfaces Basics — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Hexagonal Architecture](#hexagonal-architecture)
3. [Domain-Driven Design](#domain-driven-design)
4. [Library API Design](#library-api-design)
5. [Mocking Strategies](#mocking-strategies)
6. [Versioning Interfaces](#versioning-interfaces)
7. [Production Patterns](#production-patterns)
8. [Documentation Standards](#documentation-standards)
9. [Linter Rules](#linter-rules)
10. [Cheat Sheet](#cheat-sheet)

---

## Introduction

At the professional level, an interface is an architectural decision. It:
- Separates domain logic from infrastructure
- Enables testable code
- Maintains library API stability
- Simplifies onboarding through team standards

---

## Hexagonal Architecture

### Ports = interface

```go
// Domain port
type OrderRepository interface {
    Find(ctx context.Context, id OrderID) (*Order, error)
    Save(ctx context.Context, o *Order) error
}

type EmailGateway interface {
    Send(ctx context.Context, to, subject, body string) error
}

type EventBus interface {
    Publish(ctx context.Context, event Event) error
}
```

### Adapters = struct implements

```go
// PostgreSQL adapter
package postgres

type OrderRepo struct{ db *pgxpool.Pool }

func New(db *pgxpool.Pool) *OrderRepo { return &OrderRepo{db: db} }

func (r *OrderRepo) Find(ctx context.Context, id OrderID) (*Order, error) { ... }
func (r *OrderRepo) Save(ctx context.Context, o *Order) error { ... }

// SMTP adapter
package smtp

type Gateway struct{ host string }

func (g *Gateway) Send(ctx context.Context, to, subject, body string) error { ... }
```

### Use case (application core)

```go
package usecase

type CheckoutUseCase struct {
    orders   OrderRepository
    payments PaymentGateway
    email    EmailGateway
    events   EventBus
}

func New(...) *CheckoutUseCase { ... }

func (uc *CheckoutUseCase) Execute(ctx context.Context, cmd CheckoutCmd) error {
    o, err := uc.orders.Find(ctx, cmd.OrderID)
    if err != nil { return err }
    if err := o.Submit(); err != nil { return err }
    if err := uc.payments.Charge(ctx, o.Total()); err != nil { return err }
    if err := uc.orders.Save(ctx, o); err != nil { return err }
    if err := uc.email.Send(ctx, ...); err != nil {
        // log, but don't fail
    }
    return uc.events.Publish(ctx, OrderSubmitted{ID: o.ID})
}
```

The domain core (Order) is completely independent of infrastructure.

---

## Domain-Driven Design

### Repository pattern

```go
type UserRepository interface {
    FindByID(ctx context.Context, id UserID) (*User, error)
    FindByEmail(ctx context.Context, email Email) (*User, error)
    Save(ctx context.Context, u *User) error
}
```

The domain layer declares the interface. The infrastructure adapter implements it.

### Specification pattern

```go
type Specification[T any] interface {
    IsSatisfiedBy(t T) bool
}

type AgeAbove struct{ Min int }
func (s AgeAbove) IsSatisfiedBy(u User) bool { return u.Age >= s.Min }

type IsActive struct{}
func (s IsActive) IsSatisfiedBy(u User) bool { return u.Active }

type And[T any] struct{ A, B Specification[T] }
func (s And[T]) IsSatisfiedBy(t T) bool {
    return s.A.IsSatisfiedBy(t) && s.B.IsSatisfiedBy(t)
}
```

### Domain event

```go
type DomainEvent interface {
    Name() string
    OccurredAt() time.Time
}

type OrderPlaced struct {
    OrderID   string
    UserID    string
    Total     Money
    occurredAt time.Time
}

func (e OrderPlaced) Name() string         { return "OrderPlaced" }
func (e OrderPlaced) OccurredAt() time.Time { return e.occurredAt }
```

### Domain service

```go
type PricingPolicy interface {
    PriceFor(p Product, customer Customer) Money
}
```

A domain service interface enables swapping different pricing policies.

---

## Library API Design

### Keep the public API small

```go
// PUBLIC
type Client interface {
    Do(req *Request) (*Response, error)
    Close() error
}

// PRIVATE — implementation
type clientImpl struct{ ... }
func (c *clientImpl) Do(...) ... { ... }
func (c *clientImpl) buildURL(...) string { ... }   // private
```

Private methods are not exposed in the public interface.

### Combined with functional options

```go
type Option func(*Client)

func WithTimeout(d time.Duration) Option { ... }
func WithRetries(n int) Option { ... }

func New(opts ...Option) *Client {
    c := &Client{}
    for _, opt := range opts { opt(c) }
    return c
}
```

### Backward compatibility

```go
// v1
type Reader interface {
    Read(p []byte) (int, error)
}

// v2 — adding a new method — BREAKING
// Solution — a new interface
type ReaderAt interface {
    ReadAt(p []byte, off int64) (int, error)
}

// Caller uses either `Reader` or `ReaderAt`
```

---

## Mocking Strategies

### Manual mock

```go
type MockUserRepo struct {
    users map[string]*User
    calls []string  // call recorder
}

func (m *MockUserRepo) FindByID(ctx context.Context, id UserID) (*User, error) {
    m.calls = append(m.calls, "FindByID:"+string(id))
    if u, ok := m.users[string(id)]; ok { return u, nil }
    return nil, ErrNotFound
}
```

### Generated mock (mockgen, mockery)

```bash
mockgen -source=user_repo.go -destination=mocks/user_repo_mock.go
```

```go
// mocks/user_repo_mock.go
type MockUserRepository struct{ ctrl *gomock.Controller }

func (m *MockUserRepository) FindByID(ctx context.Context, id UserID) (*User, error) {
    m.ctrl.Call(m, "FindByID", ctx, id)
    // ...
}
```

### Testify mock

```go
import "github.com/stretchr/testify/mock"

type MockUserRepo struct{ mock.Mock }

func (m *MockUserRepo) FindByID(ctx context.Context, id UserID) (*User, error) {
    args := m.Called(ctx, id)
    return args.Get(0).(*User), args.Error(1)
}

// Test
mockRepo := &MockUserRepo{}
mockRepo.On("FindByID", mock.Anything, UserID("u1")).Return(&User{}, nil)
```

### Manual fake (for integration-style)

```go
type InMemoryUserRepo struct {
    mu    sync.Mutex
    users map[string]*User
}

func (r *InMemoryUserRepo) FindByID(ctx context.Context, id UserID) (*User, error) {
    r.mu.Lock(); defer r.mu.Unlock()
    if u, ok := r.users[string(id)]; ok {
        cp := *u   // defensive copy
        return &cp, nil
    }
    return nil, ErrNotFound
}
```

An in-memory fake provides production-grade test data.

---

## Versioning Interfaces

### Breaking change matrix

| Change | Breaking? |
|--------------|-----------|
| Add a new method | BREAKING (all implementations break) |
| Remove a method | BREAKING |
| Rename a method | BREAKING |
| Add an argument | BREAKING |
| Change return type | BREAKING |
| Change documentation | Soft |

### Soft migration

```go
// v1
type Reader interface {
    Read(p []byte) (int, error)
}

// v2 — new capability
type ReaderAt interface {
    ReadAt(p []byte, off int64) (int, error)
}

// Declared a new type separately — `Reader` is unchanged
```

### Deprecated method

```go
type Service interface {
    DoNew(ctx context.Context, req Req) error

    // Deprecated: use DoNew instead.
    Do(req Req) error
}
```

`golangci-lint`'s `staticcheck` warns on deprecated methods.

---

## Production Patterns

### Pattern 1: Repository + UnitOfWork

```go
type Repo[T any] interface {
    Find(ctx context.Context, id string) (*T, error)
    Save(ctx context.Context, t *T) error
}

type UnitOfWork interface {
    Begin(ctx context.Context) (UnitOfWork, error)
    Commit() error
    Rollback() error
}
```

### Pattern 2: Pipeline / middleware

```go
type Handler interface {
    Handle(ctx context.Context, req Request) (Response, error)
}

type Middleware func(Handler) Handler

func WithLogging(next Handler) Handler { ... }
func WithMetrics(next Handler) Handler { ... }
func WithRetry(next Handler) Handler { ... }

h := WithLogging(WithMetrics(WithRetry(realHandler)))
```

### Pattern 3: Event sourcing

```go
type EventStore interface {
    Append(ctx context.Context, streamID string, events []Event) error
    Read(ctx context.Context, streamID string) ([]Event, error)
}

type Aggregate interface {
    ID() string
    Apply(event Event)
    PullEvents() []Event
}
```

### Pattern 4: Observer / Pub-sub

```go
type Subscriber interface {
    Receive(ctx context.Context, event Event) error
}

type Publisher interface {
    Subscribe(s Subscriber) func()
    Publish(ctx context.Context, event Event)
}
```

### Pattern 5: Worker pool with interface

```go
type Job interface {
    Process(ctx context.Context) error
}

type Pool struct{ jobs chan Job; workers int }

func (p *Pool) Submit(j Job) { p.jobs <- j }
```

---

## Documentation Standards

### Interface documentation

```go
// UserRepository persists and retrieves User entities.
//
// All methods are safe for concurrent use.
// Implementations must return ErrNotFound when an entity does not exist.
type UserRepository interface {
    // FindByID returns the user with the given ID, or ErrNotFound.
    FindByID(ctx context.Context, id UserID) (*User, error)

    // Save persists the user. If the user already exists, it is updated.
    Save(ctx context.Context, u *User) error
}
```

### Method documentation

```go
// Read reads up to len(p) bytes into p.
// It returns the number of bytes read (0 <= n <= len(p))
// and any error encountered. If some data is available but not len(p) bytes,
// Read may return what is available instead of waiting for more.
//
// When Read encounters an error or end-of-file condition after
// successfully reading n > 0 bytes, it returns the number of
// bytes read. It may return the (non-nil) error from the same call
// or return the error (and n == 0) from a subsequent call.
//
// Implementations of Read are discouraged from returning a
// zero byte count with a nil error, except when len(p) == 0.
func (r *Reader) Read(p []byte) (n int, err error) { ... }
```

`io.Reader` documentation is the model for Go standards.

### Concurrency disclaimer

Document the concurrency safety of an interface:

```go
// Cache provides thread-safe access to cached data.
// All methods are safe for concurrent use.
type Cache interface { ... }

// Builder is NOT safe for concurrent use. Concurrent access
// must be synchronized externally.
type Builder interface { ... }
```

---

## Linter Rules

### `go vet`

- Interface satisfaction checks
- Method has pointer receiver

### `staticcheck`

- **SA1015** — `time.Tick` resource leak
- **SA4023** — Impossible nil interface comparison

### `revive`

- **var-naming** — Interface naming (avoid xUer prefix)
- **interface-naming** — Single-method interface ends in `-er`

### `errcheck`

- Ignoring an error returned by a method

### `interfacer` (deprecated, but useful)

- Suggests replacing a concrete type with an interface where applicable

### `iface` (custom)

- Interface bloat detection

---

## Cheat Sheet

```
HEXAGONAL ARCH
─────────────────────────
Ports = interface (domain port)
Adapters = struct implements
Use case = service struct + DI methods

DDD
─────────────────────────
Repository = interface
Specification = interface
Domain event = interface
Domain service = interface

LIBRARY API
─────────────────────────
Public small, private big
Functional options
New method = BREAKING
New interface = non-breaking

MOCKING
─────────────────────────
Manual mock
mockgen / mockery
testify mock
In-memory fake

VERSIONING
─────────────────────────
Add new method → BREAKING
Add new interface → soft
Deprecated method → comment
Remove in major version

PATTERNS
─────────────────────────
Repository, UnitOfWork
Pipeline / middleware
Event sourcing, EventStore
Observer / Pub-sub
Worker pool

DOCUMENTATION
─────────────────────────
Interface contract
Method semantics
Concurrency safety
Sentinel errors
```

---

## Summary

Interfaces at the professional level:
- Hexagonal architecture (ports = interface, adapters = struct)
- DDD repository, specification, domain event, domain service
- Library API — minimal public surface, functional options
- Mocking — manual, generated, testify, in-memory fake
- Versioning — new method = breaking, new interface = soft
- Production patterns — pipeline, event sourcing, observer
- Documentation — contract, semantics, concurrency

The interface is Go's powerful architectural tool. At the professional level, using it together with team standards, documentation, and linters produces code that will keep working for the next 5–10 years.
