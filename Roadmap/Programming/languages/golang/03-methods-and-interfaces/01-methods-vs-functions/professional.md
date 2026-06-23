# Methods vs Functions — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Domain-Driven Design](#domain-driven-design)
3. [Hexagonal Architecture](#hexagonal-architecture)
4. [API Design at Scale](#api-design-at-scale)
5. [Code Organization Standards](#code-organization-standards)
6. [Method Naming Conventions](#method-naming-conventions)
7. [Receiver Style Guide](#receiver-style-guide)
8. [Production-Grade Patterns](#production-grade-patterns)
9. [Anti-Patterns Catalog](#anti-patterns-catalog)
10. [Migration Strategies](#migration-strategies)
11. [Performance and Profiling](#performance-and-profiling)
12. [Tooling and Linters](#tooling-and-linters)
13. [Summary](#summary)

---

## Introduction

At the professional level, the choice between methods and functions is tightly coupled with:
- Team conventions
- API stability (versioning)
- Domain logic consistency
- Observability and profiling in production

This file explores these concerns through the lens of real production scenarios.

---

## Domain-Driven Design

### A type with methods as an aggregate root

```go
// Order — aggregate root
type Order struct {
    id     OrderID
    items  []OrderItem
    status OrderStatus
    events []DomainEvent
}

// Domain methods — protect business-rule invariants
func (o *Order) AddItem(p Product, qty int) error {
    if o.status != Draft {
        return ErrOrderNotDraft
    }
    if qty <= 0 {
        return ErrInvalidQty
    }
    o.items = append(o.items, OrderItem{
        ProductID: p.ID,
        Price:     p.Price,
        Qty:       qty,
    })
    o.events = append(o.events, ItemAdded{ID: o.id, ProductID: p.ID})
    return nil
}

func (o *Order) Submit() error {
    if len(o.items) == 0 {
        return ErrEmptyOrder
    }
    o.status = Submitted
    o.events = append(o.events, OrderSubmitted{ID: o.id})
    return nil
}

// Read-only — value receiver
func (o Order) Total() Money {
    var total Money
    for _, it := range o.items {
        total = total.Add(it.Price.Mul(it.Qty))
    }
    return total
}
```

Here `Order` protects its own business rules. External code cannot do `o.items = ...` — only via `AddItem`/`RemoveItem` methods.

### Value object — preference for pure functions

```go
type Money struct{ amount, scale int64 }

func (m Money) Add(o Money) Money     { ... }
func (m Money) Sub(o Money) Money     { ... }
func (m Money) Mul(qty int) Money     { ... }
func (m Money) String() string        { ... }
```

A value object is immutable — every method returns a new value. The receiver is a value (not a pointer), because copying is cheap and immutability demands it.

### Domain service — pure function

A pure operation that spans multiple aggregates:

```go
// Between Cart and Inventory
func ApplyDiscount(cart Cart, rules []DiscountRule) Cart {
    // pure function — no state, no side effects
}
```

---

## Hexagonal Architecture

### Ports — interface (methods)

```go
// Domain port
type OrderRepository interface {
    Find(ctx context.Context, id OrderID) (*Order, error)
    Save(ctx context.Context, o *Order) error
}
```

### Adapters — concrete struct (methods)

```go
// PostgreSQL adapter
type PgOrderRepo struct{ db *sql.DB }

func (r *PgOrderRepo) Find(ctx context.Context, id OrderID) (*Order, error) {
    // SQL query
}
func (r *PgOrderRepo) Save(ctx context.Context, o *Order) error {
    // SQL upsert
}
```

### Use case — service struct + method

```go
type CheckoutUseCase struct {
    orders   OrderRepository
    payments PaymentGateway
    events   EventBus
}

func (uc *CheckoutUseCase) Execute(ctx context.Context, cmd CheckoutCmd) error {
    o, err := uc.orders.Find(ctx, cmd.OrderID)
    if err != nil { return err }
    if err := o.Submit(); err != nil { return err }
    if err := uc.payments.Charge(ctx, o.Total()); err != nil { return err }
    if err := uc.orders.Save(ctx, o); err != nil { return err }
    for _, e := range o.PullEvents() {
        uc.events.Publish(ctx, e)
    }
    return nil
}
```

Structural view:
- **Ports** = methods (interface)
- **Adapters** = methods (struct)
- **Domain** = methods (entity)
- **Helpers** = function

---

## API Design at Scale

### Public API — keep methods to a minimum

A library author's rule: **keep the public API small**. Each public method is a permanent commitment.

```go
// PUBLIC — small, precise
type Client struct { ... }
func New(opts ...Option) *Client
func (c *Client) Do(req *Request) (*Response, error)
func (c *Client) Close() error

// PRIVATE — broad, flexible
func (c *Client) buildRequest(...) *http.Request
func (c *Client) parseResponse(...) (*Response, error)
func (c *Client) retryWithBackoff(...) error
```

### Functional options — variadic function pattern

```go
type Option func(*Client)

func WithTimeout(d time.Duration) Option {
    return func(c *Client) { c.timeout = d }
}
func WithRetries(n int) Option {
    return func(c *Client) { c.retries = n }
}

c := New(
    WithTimeout(5*time.Second),
    WithRetries(3),
)
```

This pattern is Constructor (function) + Option (function returning function). It is not a method — because `Client` does not yet exist.

### Builder vs functional options

| Pattern | When to choose |
|---------|--------|
| Functional options (function) | The standard, idiomatic Go approach |
| Builder method-chain (method) | Complex configuration with validation |

```go
// Builder
b := NewClientBuilder().
    Timeout(5*time.Second).
    Retries(3)
if err := b.Validate(); err != nil { ... }
c, err := b.Build()
```

---

## Code Organization Standards

### One type per file rule (optional)

```
order/
├── order.go            // Order type and its methods
├── order_test.go
├── item.go             // Item value object
├── repository.go       // Interface
├── pg_repository.go    // PostgreSQL adapter
├── pg_repository_test.go
├── service.go          // Use case service
└── errors.go           // Domain errors
```

Each method lives in the same file as its type. This makes the code easier to navigate and review.

### `helpers.go` — functions

Pure utility functions belong in `helpers.go` or `internal/util/`:

```go
// internal/util/strings.go
package util

func TrimToLength(s string, max int) string { ... }
func Slugify(s string) string { ... }
```

### Doc-comment style

```go
// Submit confirms the order and emits an OrderSubmitted event.
// Returns ErrEmptyOrder if no items have been added.
//
// Submit is the only valid transition from Draft to Submitted.
func (o *Order) Submit() error { ... }
```

A doc-comment is mandatory for public methods. Start with the method name.

---

## Method Naming Conventions

### Rule 1: Verb-based (behavior)

```go
// Correct
o.Submit()
u.Activate()
c.Close()

// Bad
o.Submission()  // a noun — not a method
u.IsActivation() // unclear
```

### Rule 2: Do not use the `Get` prefix

```go
// Bad — Java/JavaBean style
func (u User) GetName() string { return u.name }

// Good — Go style
func (u User) Name() string { return u.name }
```

`Set` is acceptable (`SetName`) — there is no return value because using a noun instead would be confusing.

### Rule 3: Boolean — `Is`/`Has`/`Can`

```go
func (u User) IsActive() bool
func (o Order) HasItems() bool
func (s Subscription) CanCancel() bool
```

### Rule 4: Don't repeat the returned type's name

```go
// Bad
func (s *Stack) PushElement(e Element)

// Good
func (s *Stack) Push(e Element)
```

### Rule 5: Don't stutter

```go
// Bad
package user
func (u User) UserName() string  // user.User.UserName()  — ugly

// Good
func (u User) Name() string  // user.User.Name()
```

---

## Receiver Style Guide

### Receiver name should be 1-2 letters, derived from the type

```go
type Server struct{}
func (s *Server) Start() { ... }     // s — Server

type HTTPClient struct{}
func (c *HTTPClient) Do() { ... }    // c — Client

type DatabasePool struct{}
func (p *DatabasePool) Get() { ... } // p — Pool
```

### Don't use `me`, `this`, or `self`

```go
// Bad (Java/Python style)
func (this *Server) Start() { ... }
func (self *Server) Start() { ... }

// Correct
func (s *Server) Start() { ... }
```

### One type — one receiver name (consistency)

```go
// Bad
func (s *Server) Start() { ... }
func (srv *Server) Stop() { ... }   // consistency broken

// Good
func (s *Server) Start() { ... }
func (s *Server) Stop()  { ... }
```

### When the type name has repeating letters — use an abbreviation

```go
type RPC struct{}
func (r *RPC) Send() { ... }  // r — easy across all receivers

type DBConnection struct{}
func (db *DBConnection) Open() { ... }  // db — semantic
```

---

## Production-Grade Patterns

### Pattern 1: Repository pattern

```go
type UserRepo interface {
    Find(ctx context.Context, id UserID) (*User, error)
    Save(ctx context.Context, u *User) error
    Delete(ctx context.Context, id UserID) error
}

type pgUserRepo struct{ db *pgxpool.Pool }

func NewPgUserRepo(db *pgxpool.Pool) UserRepo { return &pgUserRepo{db: db} }

func (r *pgUserRepo) Find(ctx context.Context, id UserID) (*User, error) { ... }
```

### Pattern 2: Decorator (logging, retry, cache)

```go
type cachingUserRepo struct {
    inner UserRepo
    cache *Cache
}

func (r *cachingUserRepo) Find(ctx context.Context, id UserID) (*User, error) {
    if u, ok := r.cache.Get(id); ok { return u, nil }
    u, err := r.inner.Find(ctx, id)
    if err == nil { r.cache.Set(id, u) }
    return u, err
}
```

### Pattern 3: Closer interface

```go
type Closer interface { Close() error }

func cleanup(closers ...Closer) {
    for _, c := range closers {
        if err := c.Close(); err != nil {
            log.Printf("close error: %v", err)
        }
    }
}
```

### Pattern 4: Stringer for logging

```go
func (s OrderStatus) String() string {
    switch s {
    case Draft:     return "draft"
    case Submitted: return "submitted"
    case Paid:      return "paid"
    }
    return "unknown"
}
```

`fmt.Println(o.Status)` automatically calls `String()`.

---

## Anti-Patterns Catalog

### Anti-pattern 1: A method that doesn't use its receiver

```go
// Bad
func (s *Server) FormatTime(t time.Time) string {
    return t.Format(time.RFC3339)  // s is unused
}

// Good
func formatTime(t time.Time) string { ... }
```

### Anti-pattern 2: God struct

```go
// Bad
type App struct{}
func (a *App) HandleHTTP(...)
func (a *App) ProcessQueue(...)
func (a *App) GenerateReport(...)
func (a *App) SendEmail(...)
// 50+ methods
```

Solution: separate types, each with a single responsibility (SRP).

### Anti-pattern 3: Setter avalanche

```go
// Bad
type Server struct{}
func (s *Server) SetTimeout(...)
func (s *Server) SetMaxConn(...)
func (s *Server) SetTLS(...)
func (s *Server) SetLogger(...)
// many setters — mutable configuration
```

Solution: functional options or an immutable builder.

### Anti-pattern 4: Methods returning the same type — fluent API pitfalls

```go
// Bad — callers make mistakes
func (q *Query) Where(...) *Query {
    return q  // always the same pointer — chaining can introduce bugs
}

q1 := q.Where("a")
q2 := q.Where("b")  // q2 == q1, both end up with "a" and "b"
```

Solution: return a new copy (immutable builder) or document the behavior clearly.

### Anti-pattern 5: Implicit state

```go
// Bad
var config = Config{}

func (c Config) Get(k string) string { return globalConfig[k] }
```

The method ignores its receiver — it pulls from global state. Testing becomes a nightmare.

---

## Migration Strategies

### Migrating from a function to a method

```go
// Before
func ValidateUser(u User) error { ... }

// After
func (u User) Validate() error { ... }
```

Migration:
1. Add the new method.
2. Make the function proxy to the method: `func ValidateUser(u User) error { return u.Validate() }`.
3. Add a deprecation warning.
4. Remove it in the next major version.

### From a value receiver to a pointer receiver

**This is a BREAKING change** — the method set changes.

```go
// Before
func (o Order) Total() Money

// After (breaking)
func (o *Order) Total() Money
```

Migration:
1. Issue a new major version
2. A clear warning in the CHANGELOG
3. Keep the old API on a separate type if possible

### Removing a method

1. Deprecate it: `// Deprecated: use NewMethod instead.`
2. Add the new method.
3. Remove it in the next major version.

`golangci-lint`'s `staticcheck` warns on deprecated methods.

---

## Performance and Profiling

### Profiling: method overhead

```go
import "testing"

func BenchmarkMethodCall(b *testing.B) {
    o := &Order{}
    for i := 0; i < b.N; i++ {
        o.Total()
    }
}

func BenchmarkFunctionCall(b *testing.B) {
    o := &Order{}
    for i := 0; i < b.N; i++ {
        OrderTotal(o)
    }
}
```

In most cases — they are equivalent. Differences come from inlining and escape analysis.

### Escape analysis

```bash
go build -gcflags='-m=2' ./...
```

`./order.go:42:6: leaking param: o`  — the method returns its own receiver, causing it to escape.

### Method value escapes — when to be careful

```go
// Don't use a method value on a hot path
for i := 0; i < N; i++ {
    cb := obj.DoWork  // heap allocation on every iteration
    cb()
}

// Better
for i := 0; i < N; i++ {
    obj.DoWork()
}
```

---

## Tooling and Linters

### `gofmt` / `goimports`
Standard formatting. Method order is preserved.

### `go vet`
- "passes lock by value" — a struct containing a mutex used as a value receiver
- "method has pointer receiver" — embedded interface compatibility

### `staticcheck`
- SA1015 — `time.Tick` leak
- ST1016 — receiver name consistency
- ST1020 — exported method comment

### `revive`
- `var-naming` — receiver naming
- `unused-receiver` — receiver unused inside a method

### `gocritic`
- `paramTypeCombine` — group parameters with the same type
- `methodExprCall` — incorrect use of method expressions

### `errcheck`
Catches ignored errors returned by methods.

### Custom linter — `analysisutil`

You can write a custom analyzer that enforces team standards:

```go
// analyzer: receiver name length must be 1-2 chars
```

---

## Cheat Sheet

```
DDD MAPPING
────────────────────────────
Aggregate root  → struct + state-changing methods
Value object    → struct + pure value-receiver methods
Domain service  → pure function (cross-aggregate)
Repository      → interface (port)
Adapter         → struct + interface satisfaction (methods)
Use case        → service struct + Execute() method

NAMING
────────────────────────────
NO Get prefix (User.Name, not User.GetName)
Set prefix ALLOWED (SetName)
Boolean: Is/Has/Can
Verb-based behavior
Don't repeat the type name (User.Name, not User.UserName)

RECEIVER STYLE
────────────────────────────
1-2 letters, matching the type
NO me/this/self
One type — one name (consistent)
Mutex/atomic present — always pointer

PUBLIC API STABILITY
────────────────────────────
Add a method                  → non-breaking
Remove a method               → BREAKING
Receiver value→ptr            → BREAKING
Add an argument               → BREAKING
Add a return value            → BREAKING
Documentation change          → soft

MIGRATION
────────────────────────────
Add a new method → proxy the old one → deprecate → remove
```

---

## Summary

The professional choice between method and function:

1. **DDD** — entity methods, value object pure methods, domain service as a function.
2. **Hexagonal** — port = interface, adapter = struct, helper = function.
3. **API design** — minimal public surface, functional options or builder.
4. **Naming** — verb-based, no Get prefix, boolean Is/Has/Can.
5. **Receiver** — short, consistent, pointer when a mutex is involved.
6. **Migration** — always deprecate; breaking changes only in a major version.
7. **Tooling** — go vet, staticcheck, and revive enforce team standards.

Methods and functions are the fundamental building blocks of code architecture in Go. Choosing the right one and using them consistently determines team code quality, maintainability, and scalability.
