# Interface Anti-Patterns — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architectural Smells](#architectural-smells)
3. [Leaky Abstractions](#leaky-abstractions)
4. [The "interfaces" Package Anti-Pattern](#the-interfaces-package-anti-pattern)
5. [Hidden Coupling Through Interfaces](#hidden-coupling-through-interfaces)
6. [Performance Cost of Bad Interface Design](#performance-cost-of-bad-interface-design)
7. [Itab Cache and Method-Set Bloat](#itab-cache-and-method-set-bloat)
8. [Allocation Cost of Boxing into Interface](#allocation-cost-of-boxing-into-interface)
9. [Stringer That Allocates / Panics](#stringer-that-allocates-panics)
10. [Errors Boxed Into Different Interfaces](#errors-boxed-into-different-interfaces)
11. [Generics vs Interface Cost](#generics-vs-interface-cost)
12. [Decision Matrix for Senior Reviewers](#decision-matrix-for-senior-reviewers)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At senior level, an interface decision is no longer "do I need polymorphism here?" — it is "what does this design force on the rest of the codebase, the test suite, and the runtime?" Bad interfaces:
- spread a single change across dozens of files
- prevent escape analysis from keeping objects on the stack
- inflate the itab cache
- box concrete errors into untyped interfaces, breaking `errors.Is`/`As`

This file looks at each of these structural costs.

---

## Architectural Smells

### Smell 1 — `interfaces.go` at the package root

```
mypackage/
├── interfaces.go       ← every interface in the package
├── postgres_repo.go
├── http_client.go
├── service.go
```

**Why bad:** consumers and producers are forced to import `interfaces.go` for every dependency. The file becomes a hub: changing any interface ripples through unrelated files. It also signals **producer-side interface design** — the original sin.

**Fix:** put each interface next to the consumer that needs it. Most "interfaces" are just one or two methods and live in the consumer's file.

### Smell 2 — `*_mock.go` outnumbers real implementations 5:1

If `find . -name '*_mock.go' | wc -l` is bigger than `find . -name '*.go' ! -name '*_test.go' ! -name '*_mock.go' | wc -l / 3`, you have mock-driven architecture. Tests live in fantasy-land.

### Smell 3 — Constructors return interfaces in app code

In a library, returning an interface (`http.Handler`, `io.Reader`) is sometimes appropriate. In application code, it is almost never right:

```go
// Application code
func NewBillingService(...) BillingService { ... }   // smell

// Same code, fixed
func NewBillingService(...) *BillingService { ... }
```

### Smell 4 — Type-switch ladders on `any`

```go
switch v := x.(type) {
case Order: ...
case Refund: ...
case Subscription: ...
case Invoice: ...
default: panic(fmt.Sprintf("unknown %T", v))
}
```

This is a closed, hand-maintained dispatch table. Adding a new case in one file requires updating ladders in others. Either:
1. Use a real interface with a method that each type implements.
2. Use a sealed-interface pattern (see `17-sealed-interfaces`).
3. Use generics if the dispatch is structurally identical.

### Smell 5 — Interface methods that return interfaces

```go
type Repository interface {
    NewQuery() QueryBuilder
}
type QueryBuilder interface {
    Filter(string, any) QueryBuilder
    OrderBy(string) QueryBuilder
    Run() ([]any, error)
}
```

Every step is dynamically dispatched and returns yet another interface. The compiler can't inline anything. For a fluent builder, return concrete types and let callers convert at the boundary.

---

## Leaky Abstractions

A leaky abstraction is one whose interface promises generality but whose semantics depend on a specific implementation.

### Example — a "Cache" that is really Redis

```go
type Cache interface {
    Get(key string) (string, error)
    Set(key, value string, ttl time.Duration) error
    Pipeline() Pipeline                    // Redis-specific
    Subscribe(channel string) <-chan string // Redis-specific
}
```

`Pipeline()` and `Subscribe()` are pure Redis. An "in-memory" implementation either no-ops them (silent breakage) or panics. The interface lies.

### Example — a "Repository" exposing SQL

```go
type Repository interface {
    Find(id string) (*User, error)
    QuerySQL(sql string, args ...any) ([]*User, error)  // leak
}
```

A non-SQL implementation cannot satisfy `QuerySQL` honestly.

### Fix

Either:
- shrink the interface to the truly common surface
- split the interface into capability-specific roles

```go
type UserFinder interface { Find(id string) (*User, error) }
type SQLUserStore struct { /* concrete */ }
func (s *SQLUserStore) QuerySQL(...) ([]*User, error) { ... }
```

Consumers needing `QuerySQL` depend on the concrete type or a SQL-specific role; consumers needing only `Find` depend on `UserFinder`.

---

## The "interfaces" Package Anti-Pattern

### BAD

```
service/
├── interfaces/
│   ├── repository.go
│   ├── notifier.go
│   ├── billing.go
│   └── auth.go
├── service.go
```

The team thought "let's centralize all interfaces." The result:

- Every package imports `service/interfaces` — a shared mutable hub.
- Cyclic imports become hard to avoid.
- Interfaces are designed top-down, not discovered.
- A change to one interface forces recompilation of every consumer.

### Why this happens

Engineers coming from Java/C# expect interfaces in their own folder (`com.example.repository.IRepository`). Go discourages this — interfaces should live where they are **consumed**, not where they are **declared**.

### GOOD

```
service/
├── billing/
│   ├── billing.go        // type Service struct{...}
│   └── billing_test.go   // type chargerStub struct{} for tests
├── auth/
│   └── auth.go           // type Service struct{...}; declares its own minimal interfaces
```

Each package owns its consumer-facing interfaces; the producer ships a struct.

---

## Hidden Coupling Through Interfaces

### BAD

```go
type Notifier interface {
    Send(msg Message) error
}

type Message struct {
    To       string
    Body     string
    Channel  string
    Provider ProviderType   // tightly coupled to providers
    Template *Template      // tightly coupled to templating
}
```

The interface looks small, but the **types it transports** drag the entire dependency graph along. Every consumer of `Notifier` also depends on `ProviderType`, `Template`, and so on.

### Fix

Push concrete types out of interface signatures:

```go
type Notifier interface {
    Send(to, body string) error
}
```

If the consumer needs richer messages, define them at the consumer side. The interface boundary should be **as concrete and minimal as possible** — primitives, not domain types.

---

## Performance Cost of Bad Interface Design

### Cost 1 — Dynamic dispatch in hot loops

```go
type Hash interface { Hash(b []byte) uint32 }

func ProcessAll(items [][]byte, h Hash) {
    for _, it := range items {
        _ = h.Hash(it)         // virtual call every iteration
    }
}
```

Each call goes through `itab` lookup. For a 5-line `Hash` implementation that would otherwise inline, the cost is enormous.

### Cost 2 — Boxing on each call

```go
func Sum(values ...any) float64 {
    var t float64
    for _, v := range values {
        t += v.(float64)
    }
    return t
}

Sum(1.0, 2.0, 3.0)   // each float64 is boxed into an interface — heap alloc
```

Even when escape analysis can prove no escape, boxing constants into `any` typically allocates because the language allows the interface to outlive the call.

### Cost 3 — Itab construction

The first time a type is used as an interface, Go builds an itab. Itabs are cached, but a project that boxes hundreds of struct types into the same interface — for example a generic event bus — pays construction cost during startup.

### Cost 4 — Inline barriers

The compiler inlines direct method calls when the body is small. Interface method calls **do not inline**. Worse: the compiler also can't inline the surrounding code that depends on the result. Bad interface design propagates "no inline" through the call chain.

### Benchmarks

```go
type op interface{ Apply(int) int }
type addOne struct{}
func (addOne) Apply(x int) int { return x + 1 }

func BenchmarkDirect(b *testing.B) {
    o := addOne{}
    for i := 0; i < b.N; i++ { _ = o.Apply(i) }
}

func BenchmarkIface(b *testing.B) {
    var o op = addOne{}
    for i := 0; i < b.N; i++ { _ = o.Apply(i) }
}
```

Typical result: direct ~0.3 ns/op (inlined), interface ~2.5 ns/op. A hot loop that does `op.Apply` a billion times pays seconds.

---

## Itab Cache and Method-Set Bloat

When a value of type `T` is assigned to interface `I`, the runtime checks: does `*T`'s method set contain `I`'s methods? The result is cached in an `itab` keyed by `(I, T)`.

### Anti-pattern

```go
// One huge interface with 25 methods
type StorageBackend interface { /* 25 methods */ }
```

Now imagine 50 concrete types and 5 different consumer interfaces. The itab table has up to `50 * 6 = 300` entries. Each first-use pays a method-set walk. The walk is O(25) per entry — slow in cold paths.

### Fix

Small interfaces (1-3 methods) keep the method-set walk fast and itab usage tiny.

---

## Allocation Cost of Boxing into Interface

### Stack vs heap

```go
func sumDirect() int {
    p := Point{X: 1, Y: 2}     // stack
    return p.X + p.Y
}

func sumViaInterface() int {
    var s Sumable = Point{X: 1, Y: 2}   // boxed — likely heap
    return s.Sum()
}
```

When a value is assigned to an interface, escape analysis often gives up and moves the value to the heap. Inspect with:

```bash
go build -gcflags='-m=2' .
```

Look for lines like:
```
./main.go:12: Point{...} escapes to heap
./main.go:12: Point literal does not escape (with generics)
```

### Heap escape via interface{} parameters

```go
func Log(args ...any) { /* ... */ }
Log(user)   // user usually escapes to heap because args is []any
```

If `user` is a stack-resident struct, it gets copied to the heap to live inside `[]any`. Heavy logging can dominate allocation profiles.

---

## Stringer That Allocates / Panics

### BAD

```go
type Order struct{ /* ... */ }

func (o Order) String() string {
    raw, err := json.Marshal(o)        // allocates, may fail
    if err != nil { panic(err) }       // panic in String()!
    return string(raw)
}
```

### WHY

`String()` is called by `fmt`, `log`, `panic`, and `t.Logf`. A panic inside `String()` triggers during another panic — a double panic, which crashes the program with no useful message. JSON allocation in a hot logging path is also costly.

### GOOD

```go
func (o Order) String() string {
    return fmt.Sprintf("Order(%s, items=%d)", o.ID, len(o.Items))
}
```

Rules for `String()`:
- never panic
- never call back through `fmt.Sprintf("%v", o)` (infinite recursion)
- keep it cheap (no I/O, no JSON)
- safe with a zero value (`var o Order; o.String()` must work)

The same constraints apply to `Error()` (the `error` interface) and `Format()`.

---

## Errors Boxed Into Different Interfaces

### BAD

```go
type AppError interface {
    error
    Code() int
}

func work() AppError {
    return &myErr{code: 500}
}

// Caller
err := work()
if err == nil { /* ... */ }   // typed-nil bug if work returns (*myErr)(nil)

// Worse — wrap
errors.Is(err, ErrNotFound)   // works only if myErr implements Is correctly
```

A custom error interface adds:
- a typed-nil bug surface
- a wrapping incompatibility (your `AppError` is not the same as `error`)
- duplicated machinery (`errors.As` can already extract the concrete type)

### GOOD

Return plain `error`, define a concrete error type, and let callers use `errors.As`:

```go
type AppError struct { Code int; Msg string }
func (e *AppError) Error() string { return e.Msg }

func work() error {
    return &AppError{Code: 500, Msg: "boom"}
}

// Caller
var ae *AppError
if errors.As(err, &ae) {
    log.Println("status", ae.Code)
}
```

This cleanly composes with `fmt.Errorf("...: %w", err)` and the rest of the standard library.

---

## Generics vs Interface Cost

### When generics dominate

A generic function `Map[T, U any]` is monomorphized per gcshape. For pointer-shaped types it goes through itab. For value-shaped types (int, structs) the compiler emits a specialized version. This means:

- Generic `Map` over `int` is faster than `Map` over `any`.
- Generic `Map` over `*Foo` is roughly as fast as the interface version.

### When interfaces dominate

A two-method interface used in a domain boundary (HTTP handler, repository) costs nothing in real-world workloads — the cost of dynamic dispatch is dwarfed by the cost of network I/O.

### The trap

Choosing generics for "performance" in domain code where the inner work is I/O-bound is **premature optimization**. Choose generics for inner-loop pure transforms, choose interfaces for boundaries.

---

## Decision Matrix for Senior Reviewers

| Question | If yes... | If no... |
|---|---|---|
| Does at least one consumer need polymorphism? | Consider an interface | Don't introduce one |
| Is there >1 real implementation, or imminently will be? | Define the interface | Use the concrete type |
| Is the interface declared near the consumer? | Good | Move it |
| Is the method count ≤ 3? | Good | Split |
| Are method signatures using primitives or stdlib types? | Good | Reduce coupling |
| Does the function returning `error` use `return nil`? | Good | Audit for typed-nil |
| Are there generated mocks for every interface? | Smell | Acceptable |
| Does the interface promise behavior any implementation can honor? | Good | Leaky abstraction |
| Will this interface end up with `Pipeline()` / `Stats()` / `Driver()` after 6 months? | Bloat | OK |

---

## Cheat Sheet

```
ARCHITECTURAL SMELLS
─────────────────────────────────────
- "interfaces.go" hub package
- *_mock.go > real implementations
- Constructor returns interface in app code
- Type-switch ladders over any
- Interface methods return interfaces

LEAKY ABSTRACTION
─────────────────────────────────────
- Interface method only one implementation can honor
- Domain types in interface signatures (drag dependencies)

PERFORMANCE
─────────────────────────────────────
- Interface dispatch in hot loops
- Boxing into any allocates on heap
- Itab lookups on first use of (I, T)
- No inlining through interface calls
- Generics for pure inner work, interfaces for boundaries

ERROR HANDLING
─────────────────────────────────────
- Return error, not custom AppError interface
- errors.As to extract concrete types
- Stringer/Error must not panic, allocate heavily, or recurse
```

---

## Summary

At senior level the cost of bad interface design is structural:

1. **Architecture** — `interfaces.go` hubs, mock-driven layouts, and constructors returning interfaces all push the team toward producer-side design.
2. **Leaky abstractions** — interfaces promising more than every implementation can deliver.
3. **Performance** — dynamic dispatch, itab cache, heap boxing, lost inlining.
4. **Error handling** — custom error interfaces fight with `errors.Is`/`As`; Stringer/Error in panicky form crash production.
5. **Generics vs interfaces** — generics for pure work, interfaces for boundaries.

The next level looks at how to lead a team through anti-pattern cleanup in a large codebase.
