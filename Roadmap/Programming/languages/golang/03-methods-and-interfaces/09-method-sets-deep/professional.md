# Method Sets Deep — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Domain-Driven Design and Method Sets](#domain-driven-design-and-method-sets)
3. [Hexagonal Architecture and Receiver Conventions](#hexagonal-architecture-and-receiver-conventions)
4. [API Design at Scale](#api-design-at-scale)
5. [Naming and Style Guide for Method-Set-Heavy APIs](#naming-and-style-guide-for-method-set-heavy-apis)
6. [Production Patterns](#production-patterns)
7. [Anti-Patterns Catalog](#anti-patterns-catalog)
8. [Migration Strategies](#migration-strategies)
9. [Profiling Method-Set-Driven Allocations](#profiling-method-set-driven-allocations)
10. [Tooling and Linters](#tooling-and-linters)
11. [Code Review Standards](#code-review-standards)
12. [Operational Concerns](#operational-concerns)
13. [Summary](#summary)

---

## Introduction

At the professional level, method-set rules become **policy**. Decisions about value-versus-pointer storage propagate through repositories, queues, caches, decorators, and migrations. Get them wrong and you accumulate hidden silent-mutation bugs, mutex-copy races, and migration-blocking breaking changes that span dozens of services.

This file consolidates production-grade conventions, profiling techniques, and tooling configuration tied directly to the unique scope of this section: addressability, map-element traps, interface boxing, embedding propagation, and Go 1.22 loop semantics.

---

## Domain-Driven Design and Method Sets

### Aggregates always pointer-method, always pointer-stored

A DDD aggregate root is mutable, holds invariants, and emits events. Every behavior method must be a pointer-receiver method, and every storage must be a `*T`:

```go
type Order struct {
    id     OrderID
    items  []OrderItem
    state  OrderState
    events []DomainEvent
}

func (o *Order) AddItem(p Product, qty int) error { /* mutate + emit event */ }
func (o *Order) Submit() error                    { /* state transition */ }
func (o *Order) PullEvents() []DomainEvent        { /* drain events */ }

// Repository works with *Order — never Order
type OrderRepo interface {
    Find(ctx context.Context, id OrderID) (*Order, error)
    Save(ctx context.Context, o *Order) error
}
```

The combination of pointer receivers plus `*Order` storage rules out:
- map-element non-addressability bugs
- silent mutation of a temporary copy
- mutex-copy races (if `Order` ever gains a mutex)
- interface-satisfaction surprises

### Value objects always value-method, both T and *T satisfy interfaces

```go
type Money struct{ amount, scale int64 }

func (m Money) Add(o Money) Money       { /* ... */ }
func (m Money) Sub(o Money) Money       { /* ... */ }
func (m Money) Mul(qty int) Money       { /* ... */ }
func (m Money) String() string          { /* ... */ }
```

A `MoneyAdder interface { Add(Money) Money }` is satisfied by both `Money` and `*Money`. Code is robust against later refactors that change pointer/value storage decisions in callers.

### Domain services are functions, not methods

A pure cross-aggregate operation has no receiver and stays a function — sidestepping all method-set rules:

```go
func ApplyDiscountRules(cart Cart, rules []Rule) Cart { /* pure */ }
```

---

## Hexagonal Architecture and Receiver Conventions

### Ports — interfaces describing operations

```go
type PaymentGateway interface {
    Charge(ctx context.Context, amt Money) (TxID, error)
    Refund(ctx context.Context, tx TxID, amt Money) error
}
```

### Adapters — pointer-receiver structs satisfying ports

```go
type StripeGateway struct{ client *stripe.Client; logger Logger }

func (g *StripeGateway) Charge(...) (TxID, error) { /* ... */ }
func (g *StripeGateway) Refund(...) error         { /* ... */ }

// Compile-time assertion
var _ PaymentGateway = (*StripeGateway)(nil)
```

The factory returns `*StripeGateway` so callers receive an addressable form ready for interface assignment:

```go
func NewStripeGateway(c *stripe.Client) *StripeGateway { return &StripeGateway{client: c} }
```

### Use cases — pointer-receiver service structs

```go
type CheckoutUseCase struct {
    orders    OrderRepo
    payments  PaymentGateway
    publisher EventPublisher
}

func (uc *CheckoutUseCase) Execute(ctx context.Context, cmd CheckoutCmd) error { /* ... */ }
```

The receiver pattern means `*CheckoutUseCase` is what gets injected into the HTTP/grpc handlers, ensuring the method set is complete and addressable storage is preserved end-to-end.

---

## API Design at Scale

### Public types: choose receiver kind on day one

Receiver kind is part of your **public API**. Changing it is a major-version bump (see [Migration Strategies](#migration-strategies)). Decide deliberately:

| Type role        | Receiver kind | Storage |
|------------------|---------------|---------|
| Aggregate / mutable entity | pointer | `*T` |
| Value object / immutable   | value   | `T` or `*T` |
| Service / handler          | pointer | `*T` |
| Stateless helper           | value (or function) | `T` |
| Mutex-bearing              | pointer | `*T` |

### Document receiver kind in package docs

```go
// Package order provides the Order aggregate and its repository.
//
// All Order methods have pointer receivers. Always pass *Order, never Order,
// to avoid silent copies and interface-satisfaction errors.
package order
```

### Functional options with addressability awareness

```go
type Option func(*Server)

func WithTimeout(d time.Duration) Option {
    return func(s *Server) { s.timeout = d }
}

func New(opts ...Option) *Server {
    s := &Server{timeout: 30 * time.Second}
    for _, opt := range opts { opt(s) }
    return s
}
```

The signature returns `*Server` so the caller never gets a non-addressable value.

### Avoid exposing types whose method-set would surprise users

```go
// Bad: returns Job by value, but Job's only useful method has pointer receiver
func GetPending() Job { return Job{} }

// Good: return *Job
func GetPending() *Job { return &Job{} }
```

---

## Naming and Style Guide for Method-Set-Heavy APIs

### Constructors return `*T` for any pointer-method type

```go
func NewClient(...) *Client    // ✅
func NewClient(...) Client     // ❌ if any method is pointer-receiver
```

### Don't ship "value-friendly" wrappers around pointer-method types

```go
// Bad — encourages footguns
type ClientValue Client
func (c ClientValue) Do() { ... }   // copy semantics, hidden divergence
```

### `New` vs `Make`

By convention, `New` returns `*T`, `Make` returns `T`:

```go
func NewBuffer() *Buffer    // pointer-method type
func MakePoint(x, y int) Point  // value-method type
```

This convention signals the receiver kind to the reader before they open the file.

### Receiver names: 1–2 letters, consistent across the file

```go
func (s *Service) Find(...) ...
func (s *Service) Save(...) ...
func (s *Service) Delete(...) ...
```

Never mix `s` and `srv`; never `this`/`self`/`me`.

---

## Production Patterns

### Pattern 1: Compile-time interface assertion list at package init

```go
var (
    _ OrderRepo      = (*PgOrderRepo)(nil)
    _ OrderRepo      = (*MockOrderRepo)(nil)
    _ PaymentGateway = (*StripeGateway)(nil)
    _ PaymentGateway = (*MockGateway)(nil)
)
```

These assertions catch:
- Receiver-kind regressions (someone removed a `*` from a method)
- Method-signature mismatch
- Removed methods missing from a mock

### Pattern 2: Pointer-store for mutable maps; value-store for immutable

```go
// Mutable — pointer storage
type Registry struct { players map[string]*Player }

// Immutable lookup — value storage
type LookupTable struct { codes map[string]CountryCode }
```

### Pattern 3: Embed `*T`, not `T`, for shared state

```go
type ServiceWithLogger struct {
    *Logger     // embedding by pointer
    config Config
}
```

This:
- Keeps `Logger`'s full method set on `ServiceWithLogger` even when the outer is a value
- Avoids copying the logger on each method call
- Allows multiple services to share one logger pointer

### Pattern 4: Map values as pointers when callers chain mutations

```go
type Cache struct { mu sync.Mutex; data map[string]*Entry }

func (c *Cache) GetOrCreate(k string) *Entry {
    c.mu.Lock(); defer c.mu.Unlock()
    if e, ok := c.data[k]; ok { return e }
    e := &Entry{}
    c.data[k] = e
    return e
}
```

`*Entry` lets the caller mutate without read-modify-write dance.

### Pattern 5: Defensive `x := x` in loops for cross-version safety

```go
for _, w := range workers {
    w := w     // safe in Go 1.21 and 1.22+
    go func() { w.Run() }()
}
```

For libraries supporting `go 1.21`, this is mandatory. For modules at `go 1.22+`, harmless.

---

## Anti-Patterns Catalog

### Anti-pattern 1: Storing values in maps then forgetting addressability

```go
// Bad
type Player struct { score int }
func (p *Player) Add(n int) { p.score += n }

players := map[string]Player{}
players["alice"].Add(10)        // compile error
```

Fix: `map[string]*Player` (the canonical fix) or refactor `Add` to value-receiver returning new value.

### Anti-pattern 2: Mixing receiver kinds on one type

```go
type Buffer struct{ data []byte }
func (b Buffer)  Len() int       { return len(b.data) }
func (b *Buffer) Write(p []byte) { b.data = append(b.data, p...) }
```

`Buffer`'s value method set has `Len` only. `*Buffer` has both. An interface like `LenWriter { Len() int; Write([]byte) }` cannot be satisfied by `Buffer` (missing `Write`) but can be by `*Buffer`. Result: callers must always pass `*Buffer`. Cheaper to make all methods pointer-receiver.

### Anti-pattern 3: Embedding a value mutex

```go
type Service struct {
    sync.Mutex     // embedded by value
    state State
}

s := Service{}
go func() { s.Lock(); /* ... */ }()    // s might get copied somewhere → race
```

Fix: embed `*sync.Mutex` or move the mutex to a private field on a pointer-receiver type.

### Anti-pattern 4: Returning value type but advertising pointer-method interface

```go
// API doc says: returns a Doer
// Implementation: type Job has pointer-receiver Do
func NewJob() Job { return Job{} }

j := NewJob()
var d Doer = j         // compile error
var d Doer = &j        // works, but caller must know to add &
```

Fix: return `*Job` explicitly, document the convention.

### Anti-pattern 5: Composite-literal interface assignment for pointer-method types

```go
// Bad — relies on the composite-literal exception spec rule
fmt.Println((&Job{ID: "x"}).Process())   // works but reads awkwardly

// Better
j := &Job{ID: "x"}
j.Process()
```

If you ever need a one-liner, use `New*` constructor.

### Anti-pattern 6: Map[string]interface{} for typed mutation

```go
m := map[string]any{"counter": &Counter{}}
m["counter"].(*Counter).Inc()   // works but loses static checks
```

Better: typed map `map[string]*Counter` whenever you know the type.

---

## Migration Strategies

### Migration: T receiver to *T receiver (BREAKING)

This changes both `T`'s and `*T`'s method sets. Existing call sites that depended on the value method set break.

Plan:
1. Bump major version (`/v2`).
2. Add a new module path or sub-package.
3. Provide adapter functions for compatibility:

```go
// v1
func (m Money) Add(o Money) Money { ... }

// v2
func (m *Money) Add(o Money) { /* mutates */ }

// Compat adapter (lives in v1 release branch, removed in v2)
func AddCompat(m Money, o Money) Money { return m.Add(o) }
```

4. Document migration steps in CHANGELOG with code mods.

### Migration: T storage to *T storage in maps

Often forced by adding a mutating method.

Plan:
1. Find all map declarations: `git grep -E 'map\[[^\]]+\]TypeName\b'`.
2. Update declarations to `map[K]*Type`.
3. Update all writes: `m[k] = v` → `m[k] = &v` (and ensure `v` is addressable).
4. Update all reads: tests should still pass; nil checks may need to be added.
5. Run `go test -race ./...` to catch any concurrent access bugs that existed in the value form.

### Migration: Loop body using method values across Go versions

If your module bumps `go.mod` from `go 1.21` to `go 1.22`, audit all `for _, x := range ...` loops that:
- Take a method value (`fns = append(fns, x.M)`)
- Spawn goroutines closing over `x`

Behavior changes from "all bound to the last `x`" to "each iteration has its own `x`". Often this is the **correct** behaviour you wanted; sometimes (rare) tests assumed the old behaviour and need updating.

---

## Profiling Method-Set-Driven Allocations

### Heap allocation from method values

```go
// Hot loop
for _, item := range items {
    cb := s.Process     // method value — receiver pointer captured in closure
    register(cb)
}
```

`go build -gcflags='-m'` will report:

```
main.go:5:11: s.Process escapes to heap
main.go:5:11: moved to heap: s
```

Profile heap allocations:

```bash
go test -bench=. -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) top
```

Look for entries like `runtime.newobject` or your method-value allocation sites.

Mitigation: use a method **expression** instead of a method **value**:

```go
process := (*Service).Process
for _, item := range items {
    process(s, item)    // receiver passed as arg, no closure
}
```

### Heap allocation from interface boxing

Every `var i I = v` for a non-pointer concrete type may allocate a heap cell to box the value:

```go
func emit(events ...EventLike) { /* ... */ }

emit(LogEvent{...})    // LogEvent value boxed into EventLike — heap alloc
```

For high-throughput paths, accept `*EventLike` or use a sync.Pool to reuse boxed values.

### Devirtualisation in Go 1.22+

Go 1.22 introduced limited devirtualisation: when the compiler can statically prove the concrete type behind an interface, it may inline the call. This applies primarily to:

- Local variables not exposed to other goroutines
- Single-method interfaces with one obvious implementation in scope

Profile with `go build -gcflags='-m=2'` to see `devirtualizing` notes.

---

## Tooling and Linters

### `go vet`

- `passes lock by value` — value receiver on a type with `sync.Mutex` or `sync.RWMutex`
- `composites` — flags certain composite-literal misuses
- `copylocks` — value-passing of types containing locks (catches embedding bugs)

### `staticcheck`

- `SA1019` — deprecated method usage (catches half-finished migrations)
- `SA4006` — value receiver on a method that mutates its receiver (a strong hint to switch to pointer)
- `S1024` — fixes `*&` patterns that hint at addressability confusion

### `revive`

- `unused-receiver` — receiver name is unused (suggests converting to function)
- `early-return` — readability
- `var-naming` — receiver names should be 1–2 letter, consistent

### `gocritic`

- `valSwap` — mutating value receivers
- `paramTypeCombine`

### Custom analyzer pattern

For team-specific rules ("aggregate types must use pointer receivers"), write a small `golang.org/x/tools/go/analysis` plugin. Detect:

```go
func (FieldList).has(receiverKind) ...
```

Apply CI gates for receiver-kind drift.

### `gopls` / IDE assistance

`gopls` will surface "X does not implement Y" diagnostics inline. Pair with the `// Deprecated:` comment to flag in-flight migrations.

---

## Code Review Standards

For pull requests touching method sets:

- [ ] Receiver kind is consistent across all methods of a type
- [ ] Mutating types use pointer receivers
- [ ] `var _ I = (*T)(nil)` assertion exists for every public concrete-to-interface mapping
- [ ] Maps that need pointer-method calls are `map[K]*V`
- [ ] Constructors return `*T` for pointer-method types
- [ ] No embedded `sync.Mutex` (always `*Mutex` or pointer-receiver wrapper)
- [ ] No `m[k].PointerMethod()` patterns (caught by go vet but worth a manual scan)
- [ ] Loop body that captures via method value is safe under both Go 1.21 and target version
- [ ] Receiver name is 1–2 letters, consistent across the file
- [ ] Public APIs that returned `T` and now return `*T` are documented in CHANGELOG

---

## Operational Concerns

### Versioning

Receiver-kind changes are part of API stability. Track them in a CHANGELOG section called "Method-set changes":

```
## v2.0.0 — Method-set changes
- order.Order: all methods are now pointer-receiver. Callers must use *Order.
  Migration: replace `order.Order{}` constructions with `order.New()`.
```

### Logging and observability

Method values bind their receiver. If you log "this method was registered" without including the receiver's identity, you may end up with confusing log lines after the Go 1.22 loop-variable change:

```go
log.Printf("registered handler for worker %p", w)
fns = append(fns, w.Run)
```

Including the pointer makes the binding explicit in production logs.

### Crash diagnostics

A nil-pointer panic on a method call almost always means a method-set assumption was wrong. The stack trace shows the receiver type. Combine with `var _ I = (*T)(nil)` assertions: if your build passes those and a runtime nil panic still occurs, the bug is in your construction logic, not your method-set design.

### Backward-compat shims

When you must change a receiver kind in a public API, ship a thin shim package:

```go
// Package compat — temporary v1 → v2 bridge
package compat

func Pay(o order.Order) error {
    op := &o
    return op.Pay()
}
```

Keep the shim for one major version, then remove it.

---

## Summary

Method-set rules are an everyday concern in production Go code. The professional view:

1. **DDD** — aggregates pointer-method, value objects value-method, domain services are functions.
2. **Hexagonal** — port = interface, adapter = pointer-receiver struct returning `*T`, use case = pointer-receiver service.
3. **API design** — choose receiver kind on day one; document; never silently change it.
4. **Naming** — `New*` returns `*T`; receiver names short and consistent.
5. **Production patterns** — `var _ I = (*T)(nil)` assertions; pointer-store for mutable maps; `*T` embedding for shared state.
6. **Anti-patterns** — mixed receiver kinds; value-mutex embedding; map-value mutation gotchas.
7. **Migration** — receiver-kind changes are breaking; plan major-version bumps with shims.
8. **Profiling** — escape analysis for method values; heap-alloc tracking for interface boxing.
9. **Tooling** — `go vet`, `staticcheck`, `revive`, custom analyzers enforce policy.
10. **Code review** — checklist of method-set concerns on every PR touching types/interfaces.
11. **Operations** — version method-set changes; include receivers in logs; ship compat shims for major-version bumps.

Method sets are a quiet but pervasive design dimension. Mastering them is what separates Go code that scales across teams from code that accumulates silent bugs as the codebase grows.
