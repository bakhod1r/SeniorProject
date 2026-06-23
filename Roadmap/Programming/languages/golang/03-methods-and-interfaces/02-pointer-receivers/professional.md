# Pointer Receivers — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Library Design](#library-design)
3. [Public API Stability](#public-api-stability)
4. [Common Conventions](#common-conventions)
5. [Linter Rules](#linter-rules)
6. [Documentation Standards](#documentation-standards)
7. [Domain Modeling](#domain-modeling)
8. [Migration Strategies](#migration-strategies)
9. [Real-World Production Patterns](#real-world-production-patterns)
10. [Cheat Sheet](#cheat-sheet)

---

## Introduction

At the professional level, choosing and using pointer receivers is closely tied to:
- Library API stability
- Team conventions
- Linter and review rules
- Domain modeling (DDD)
- Production-grade patterns

---

## Library Design

### Choosing a receiver — public API

In public methods, the receiver choice is a **permanent commitment**. Changing it is breaking.

```go
// v1
func (c Client) Do(req *Request) (*Response, error)  // value

// v2 (BREAKING)
func (c *Client) Do(req *Request) (*Response, error) // pointer
```

Reasons it's breaking:
1. The method set changes — interface satisfaction breaks
2. If the caller was using a `Client{}` value — now they need `&Client{}`
3. Compilation error or subtle bug

### Standards

| Type characteristic | Receiver |
|----------------|----------|
| Resource holder (DB, File, Conn) | Pointer |
| State accumulator (Buffer, Builder) | Pointer |
| Sync primitive (Counter, Cache) | Pointer |
| Value object (Money, Color, ID) | Value |
| Configuration | Value or Pointer (value if immutable) |
| Service (with DI) | Pointer |

### Reference: Go standard library

- `*http.Client` — pointer (state, config)
- `*sql.DB` — pointer (resource)
- `bytes.Buffer` — pointer (writable)
- `strings.Builder` — pointer (writable, and `noCopy`)
- `time.Time` — value (immutable)
- `time.Duration` — value (alias)
- `*template.Template` — pointer (parsed templates)

---

## Public API Stability

### Catalog of breaking changes

| Change | Breaking? |
|--------------|-----------|
| Adding a new method (T) | Non-breaking |
| Adding a new method (*T) | Non-breaking |
| Removing a method | BREAKING |
| Receiver value → pointer | BREAKING (method set, caller usage) |
| Receiver pointer → value | BREAKING (method set) |
| Adding an argument | BREAKING |
| Adding variadic (to existing arg) | BREAKING |
| Adding a return value | BREAKING |
| Renaming a method | BREAKING |

### Adding a new method — choosing the receiver

When adding a new method, choose the receiver that fits the type. But follow the style of existing methods:

```go
// Existing
type Client struct{}
func (c *Client) Do(...) {}
func (c *Client) Close() {}

// New method — pointer (for consistency)
func (c *Client) Stats() Stats { ... }
```

### Constructor convention

```go
func NewClient(...) *Client  // returned type — pointer
```

This is the standard convention — the Go community expects it. The constructor encourages the caller to responsibly hold a pointer.

---

## Common Conventions

### Convention 1: `New*` constructor

```go
func NewServer(opts ...Option) *Server { ... }
func NewClient(addr string) *Client    { ... }
```

### Convention 2: `noCopy` marker

To restrict copying of a type:

```go
type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

type SafeCounter struct {
    _  noCopy
    mu sync.Mutex
    n  int
}
```

`go vet` finds the `_ noCopy` field and warns about copy operations.

### Convention 3: Receiver name — abbreviated type

```go
type DatabasePool struct{}
func (p *DatabasePool) Acquire() {}  // p — Pool

type HTTPClient struct{}
func (c *HTTPClient) Do() {}          // c — Client
```

### Convention 4: Pointer-only types

Some types must work **only via pointer** — document it:

```go
// Buffer is a write-once accumulator.
// Use NewBuffer to create one. Do not use the zero value.
// Buffer must not be copied after first use.
type Buffer struct {
    _ noCopy
    // ...
}
```

### Convention 5: Method order — public first

```go
type Server struct{ ... }

// Public methods first
func (s *Server) Start() error { ... }
func (s *Server) Stop()        { ... }
func (s *Server) Stats() Stats { ... }

// Private helpers after
func (s *Server) handle(...) { ... }
func (s *Server) cleanup(...) { ... }
```

---

## Linter Rules

### `go vet`

- **passes lock by value** — mutex/sync.Cond/sync.WaitGroup value receiver
- **method has pointer receiver** — interface compatibility check

### `staticcheck`

- **SA9001** — defer in loop
- **SA1015** — `time.Tick` resource leak
- **ST1016** — Receiver name should be consistent
- **ST1020** — Exported method without comment

### `revive`

- **var-naming** — receiver naming
- **unused-receiver** — receiver not used
- **receiver-naming** — receiver name length

### `gocritic`

- **methodExprCall** — incorrect use of method expression
- **paramTypeCombine** — group parameters of the same type

### `errcheck`

- Ignoring an error returned by a method

### Custom analyzer

For team standards:

```go
// pkg/lint/receiver.go
func checkReceiverName(...) {
    // Receiver name must be 1-2 chars
    // Same type must use same receiver name
}
```

---

## Documentation Standards

### Public method comment

```go
// Submit confirms the order and emits an OrderSubmitted event.
// Returns ErrEmptyOrder if no items have been added,
// or ErrInvalidState if the order is not in Draft state.
//
// Submit is the only valid transition from Draft to Submitted.
// Concurrency: not safe for concurrent use.
func (o *Order) Submit() error { ... }
```

### Concurrency disclaimer

Document the safety of working with a pointer receiver:

```go
// Cache provides thread-safe access to a key-value store.
// All methods are safe for concurrent use.
type Cache struct { ... }

// Buffer is NOT safe for concurrent use.
// Concurrent access must be synchronized externally.
type Buffer struct { ... }
```

### Lifecycle disclaimer

```go
// NewClient creates a new HTTP client.
//
// The caller must call Close() to release resources.
// Calling methods on a closed Client returns ErrClosed.
func NewClient(addr string) *Client { ... }
```

---

## Domain Modeling

### Aggregate root — pointer

```go
type Order struct {
    id     OrderID
    items  []OrderItem
    status OrderStatus
}

func (o *Order) AddItem(p Product, qty int) error { ... }
func (o *Order) Submit() error                    { ... }
```

Aggregate root — with state-changing methods, always pointer.

### Value object — value

```go
type Money struct { amount, scale int64 }

func (m Money) Add(o Money) Money { ... }   // immutable, returns new
func (m Money) Format() string    { ... }
```

A value object is immutable — pointer receiver isn't needed, it's not reused.

### Domain service — pointer struct

```go
type CheckoutService struct {
    orders   OrderRepository
    payments PaymentGateway
}

func (s *CheckoutService) Execute(...) error { ... }
```

The service struct is passed via DI, internal mutability is allowed.

### Repository — interface + pointer concrete

```go
type OrderRepo interface {
    Find(ctx context.Context, id OrderID) (*Order, error)
    Save(ctx context.Context, o *Order) error
}

type pgOrderRepo struct{ db *sql.DB }
func (r *pgOrderRepo) Find(...) (*Order, error) { ... }
func (r *pgOrderRepo) Save(...) error           { ... }
```

---

## Migration Strategies

### V1 → V2: Changing receiver type

This is **breaking** — requires a new major version.

```go
// v1
type Counter struct{}
func (c Counter) Inc() Counter { ... }   // immutable style

// v2 — breaking
type Counter struct{}
func (c *Counter) Inc() { ... }          // mutable
```

### Migration checklist

1. Create a new type or new package
2. Keep the old API around for a while
3. Add a deprecation comment:
   ```go
   // Deprecated: use NewCounter and pointer methods instead.
   ```
4. Remove it in a major release

### Soft migration: alongside

```go
// v1.x
func (c Counter) Inc() Counter { ... }

// v1.5 — new method added (pointer)
// Deprecated: use IncP for in-place increment.
func (c Counter) Inc() Counter { ... }

func (c *Counter) IncP() { ... }
```

In V2, Inc() is removed.

---

## Real-World Production Patterns

### Pattern 1: Worker pool

```go
type Pool struct {
    in   chan Job
    quit chan struct{}
    wg   sync.WaitGroup
}

func NewPool(workers int) *Pool {
    p := &Pool{
        in:   make(chan Job),
        quit: make(chan struct{}),
    }
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for {
        select {
        case j := <-p.in:
            j.Process()
        case <-p.quit:
            return
        }
    }
}

func (p *Pool) Submit(j Job)  { p.in <- j }
func (p *Pool) Stop()         {
    close(p.quit)
    p.wg.Wait()
}
```

### Pattern 2: Circuit breaker

```go
type Breaker struct {
    mu        sync.Mutex
    state     state
    failures  int
    threshold int
}

func NewBreaker(threshold int) *Breaker {
    return &Breaker{state: closed, threshold: threshold}
}

func (b *Breaker) Call(fn func() error) error {
    b.mu.Lock()
    if b.state == open {
        b.mu.Unlock()
        return ErrCircuitOpen
    }
    b.mu.Unlock()

    if err := fn(); err != nil {
        b.recordFailure()
        return err
    }
    b.recordSuccess()
    return nil
}

func (b *Breaker) recordFailure() {
    b.mu.Lock(); defer b.mu.Unlock()
    b.failures++
    if b.failures >= b.threshold { b.state = open }
}

func (b *Breaker) recordSuccess() {
    b.mu.Lock(); defer b.mu.Unlock()
    b.failures = 0
    b.state = closed
}
```

### Pattern 3: Graceful shutdown

```go
type Server struct {
    srv  *http.Server
    quit chan os.Signal
}

func NewServer(addr string) *Server {
    s := &Server{
        srv:  &http.Server{Addr: addr},
        quit: make(chan os.Signal, 1),
    }
    signal.Notify(s.quit, syscall.SIGINT, syscall.SIGTERM)
    return s
}

func (s *Server) Start() error {
    go func() {
        <-s.quit
        ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
        defer cancel()
        s.srv.Shutdown(ctx)
    }()
    return s.srv.ListenAndServe()
}
```

### Pattern 4: Observable state

```go
type Counter struct {
    n        atomic.Int64
    onChange []func(int64)
    mu       sync.RWMutex
}

func (c *Counter) Inc() {
    n := c.n.Add(1)
    c.mu.RLock()
    callbacks := c.onChange
    c.mu.RUnlock()
    for _, cb := range callbacks { cb(n) }
}

func (c *Counter) Watch(cb func(int64)) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.onChange = append(c.onChange, cb)
}
```

---

## Cheat Sheet

```
LIBRARY DESIGN
────────────────────────────────
Resource holder    → pointer (*DB, *Client)
State accumulator  → pointer (*Buffer, *Builder)
Value object       → value (Money, Color)
Service struct     → pointer
Configuration      → value (immutable) or pointer

CONVENTIONS
────────────────────────────────
NewX() *X — constructor returns pointer
noCopy marker — copy-protection
Receiver name — short and consistent
Method order — public first

PUBLIC API STABILITY
────────────────────────────────
Adding a method    → non-breaking
Removing a method  → BREAKING
Changing receiver type → BREAKING
Changing argument/return → BREAKING

DOCUMENTATION
────────────────────────────────
Concurrency safety — always document
Lifecycle (Close) — always document
Returning errors — reasons and conditions

MIGRATION
────────────────────────────────
Adding a new method → soft
Deprecate old → comment
Remove → major version
```

---

## Summary

Professional pointer receiver:
- Following library design conventions
- API stability — minimizing breaking changes
- Maintaining team standards with linters and analyzers
- Documentation — about concurrency and lifecycle
- Domain modeling — aggregate vs value object
- Migration — soft transition + deprecation
- Production patterns — worker pool, circuit breaker, graceful shutdown

Pointer receiver is a powerful tool, but using it at a professional level comes with team conventions, documentation, and testing. A well-written pointer receiver method produces an API that can serve for the next 5+ years.
