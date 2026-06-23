# Method Sets Deep — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architectural View](#architectural-view)
3. [Designing Interface Contracts Around Method Sets](#designing-interface-contracts-around-method-sets)
4. [Dispatch Internals — itab and Method Set Lookup](#dispatch-internals-itab-and-method-set-lookup)
5. [Memory Layout of Embedded Types](#memory-layout-of-embedded-types)
6. [Concurrency: Method Sets and Lock Safety](#concurrency-method-sets-and-lock-safety)
7. [Generics + Method Sets](#generics-method-sets)
8. [Loop-Variable Semantics in Concurrent Code](#loop-variable-semantics-in-concurrent-code)
9. [Library Design and Method Set Stability](#library-design-and-method-set-stability)
10. [Refactoring: Value-To-Pointer Migration](#refactoring-value-to-pointer-migration)
11. [Testing Strategies](#testing-strategies)
12. [Diagnosing Hard Cases](#diagnosing-hard-cases)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the senior level, method-set rules stop being a syntactic concern and start being a **design tool**. They influence:

- The shape of public interfaces (do callers receive `T` or `*T`?)
- The lifetime model of your domain entities (heap-allocated, addressable)
- The concurrency story (mutex-bearing types must always be passed by pointer)
- The migration story (changing a receiver kind is a breaking change)

This file looks at method sets through the lens of an entire codebase, with examples drawn from real production patterns.

---

## Architectural View

### Domain entities — pointer-method receivers

Aggregates that emit events or maintain invariants almost always need pointer receivers (mutation) and addressable storage (so the call site can hand a `*T` to repository APIs):

```go
type Order struct {
    id     OrderID
    items  []OrderItem
    state  OrderState
    events []DomainEvent
}

func (o *Order) AddItem(p Product, qty int) error { /* ... */ }
func (o *Order) Submit() error                    { /* ... */ }
func (o *Order) PullEvents() []DomainEvent        { /* ... */ }
```

Domain repositories store `*Order`, never `Order`:

```go
type OrderRepo interface {
    Find(ctx context.Context, id OrderID) (*Order, error)
    Save(ctx context.Context, o *Order) error
}
```

This avoids the map-element-not-addressable trap and ensures the method set of the stored value is complete.

### Value objects — value-receiver methods only

Money, currency codes, and ranges should be **immutable**, with all methods using value receivers and returning new values:

```go
type Money struct{ amount, scale int64 }

func (m Money) Add(o Money) Money { /* returns new Money */ }
func (m Money) Mul(qty int) Money { /* returns new Money */ }
```

Both `Money` and `*Money` carry the full method set, so callers freely pass either form into interfaces.

### Service ports — pointer-receiver everywhere, with `*Service` constructors

```go
type CheckoutService struct {
    orders   OrderRepo
    payments PaymentGateway
}

func NewCheckoutService(o OrderRepo, p PaymentGateway) *CheckoutService { /* ... */ }
func (s *CheckoutService) Execute(ctx context.Context, cmd Cmd) error  { /* ... */ }
```

Returning `*CheckoutService` preserves a stable address for the entire process lifetime.

---

## Designing Interface Contracts Around Method Sets

### Rule of thumb: the interface should match the receiver kind

If your concrete type has pointer-receiver methods, your callers must hand you `*T`. Document that explicitly:

```go
// Doer is satisfied by *Job. A bare Job{} value will not satisfy Doer
// because Do has a pointer receiver — see method-set rules.
type Doer interface { Do() }
```

### Empty struct trick for stateless implementations

When a type has no fields and all methods are value-receiver, both `T` and `*T` satisfy interfaces freely:

```go
type NoOpHandler struct{}
func (NoOpHandler) Handle(req Req) Resp { return Resp{} }

var h Handler = NoOpHandler{}     // ✅
var h Handler = &NoOpHandler{}    // ✅
```

This is why standard library "noop" types (`io.Discard` precursor, `pipe.NoOp`, etc.) typically use empty structs and value receivers.

### Pre-flight assertion at package init

```go
// At package level:
var (
    _ OrderRepo      = (*PgOrderRepo)(nil)
    _ PaymentGateway = (*StripeGateway)(nil)
)
```

If a future refactor changes the receiver kind, the build breaks immediately — long before tests touch the interface.

---

## Dispatch Internals — itab and Method Set Lookup

When the compiler sees `var i I = &T{}`, it does the following at link time:

1. Computes the **method set of `*T`**.
2. Verifies it is a superset of `I`'s method list.
3. Builds an **itab** (interface table) — a small struct with `type *T`, `type I`, and a function-pointer slice in the order `I` declares its methods.
4. Stores `(itab, &T{})` in `i`'s two-word interface header.

A call `i.M()` resolves at runtime by:
1. Loading the itab pointer from `i.tab`.
2. Indexing into the function-pointer slice to find `M`.
3. Calling that function with `i.data` as the receiver.

If you box a `T` value (with no `*T` involved), the compiler uses `T`'s method set — strictly the value-receiver methods.

The runtime cost is one extra indirection compared to a static call. The compiler cannot inline interface calls (in Go 1.21; partial devirtualisation lands in 1.22+ when the concrete type is provably static).

### Method set is computed once per `(T, I)` pair

The first time an `(itab type pair)` is constructed, the runtime caches it in a global table. Subsequent uses are O(1) lookups. So the cost of method set checks is amortised — but **the rules for what's in the set are still strict**.

---

## Memory Layout of Embedded Types

Given:

```go
type Logger struct{ prefix string }       // 16 bytes (string header)

type Service struct{ Logger; id int }     // 24 bytes total
```

Layout:

```
Service:
  +0   prefix.data (8 bytes)   // Logger.prefix.data
  +8   prefix.len  (8 bytes)   // Logger.prefix.len
  +16  id          (8 bytes)
```

`Service` *contains* `Logger` inline. Calling `service.Info("x")` rewrites to `service.Logger.Info("x")` and (since `Info` has a value receiver) Go copies `service.Logger` to a local. No allocation.

Calling `service.SetPrefix("x")` (with `*Logger` receiver) rewrites to `(&service.Logger).SetPrefix("x")` — only legal if `service` is addressable.

### Pointer embedding

```go
type Service struct{ *Logger; id int }    // 16 bytes (8 ptr + 8 int)
```

Layout:

```
Service:
  +0   *Logger    (8 bytes)
  +8   id         (8 bytes)
```

Now `service.SetPrefix("x")` rewrites to `service.Logger.SetPrefix("x")`, which uses the stored pointer directly — no need for `service` to be addressable. This is why pointer embedding makes the outer's method set "thicker" without requiring outer addressability.

Trade-off: pointer embedding adds an indirection on every promoted method call and forces the embedded struct to be heap-allocated.

---

## Concurrency: Method Sets and Lock Safety

A type embedding or containing a `sync.Mutex` must always be passed by pointer. Otherwise a value receiver would copy the mutex — leading to silent races:

```go
type SafeMap struct {
    mu sync.Mutex
    m  map[string]int
}

// Pointer receivers everywhere
func (s *SafeMap) Get(k string) int          { /* ... */ }
func (s *SafeMap) Set(k string, v int)       { /* ... */ }
```

What does the method-set rule add here? The interface satisfaction story:

```go
type Cache interface {
    Get(string) int
    Set(string, int)
}

var c Cache = &SafeMap{m: map[string]int{}}    // ✅
var c Cache = SafeMap{m: map[string]int{}}     // ❌ — Get/Set have pointer receivers
```

So the same rule that prevented the value-method-set hijack also prevents the silent mutex copy. Two safety nets converge on one design choice.

`go vet` warns about `passes lock by value`. Pair it with the compiler's method-set check and you have strong static guarantees against mutex misuse.

---

## Generics + Method Sets

A generic type's methods can only use the receiver's type parameters. A method cannot introduce new type parameters:

```go
type List[T any] struct{ items []T }

func (l *List[T]) Add(x T)         { l.items = append(l.items, x) }
func (l *List[T]) Get(i int) T     { return l.items[i] }

// ❌ method cannot have its own type parameter
// func (l *List[T]) Map[U any](f func(T) U) *List[U] { ... }
```

This restriction interacts with method sets in subtle ways:

1. **Interface satisfaction is per-instantiation**: `*List[int]` and `*List[string]` are different types with different method sets containing the same method *names* but different signatures.
2. **Generic interfaces are rare** because the constraint typically lives on a type parameter rather than a value-level interface.

For map/transform-style operations, lift to a package-level generic function:

```go
func Map[T, U any](l *List[T], f func(T) U) *List[U] {
    r := &List[U]{}
    for _, x := range l.items {
        r.Add(f(x))
    }
    return r
}
```

This sidesteps the method-set-on-generic-types restriction entirely.

---

## Loop-Variable Semantics in Concurrent Code

The Go 1.22 per-iteration loop variable change has direct consequences for concurrent dispatch built on method values:

```go
type Worker struct{ id int }
func (w *Worker) Run() { fmt.Println("worker", w.id) }

workers := []*Worker{{1}, {2}, {3}}

var wg sync.WaitGroup
for _, w := range workers {
    wg.Add(1)
    go func() {
        defer wg.Done()
        w.Run()        // captures w via closure
    }()
}
wg.Wait()
```

**Go 1.21 and earlier**: `w` is one variable shared across iterations. The closure captures `&w`. Output (typically): `3 3 3`. Fix: write `w := w` shadow.

**Go 1.22+**: each iteration has its own `w`. Output: `1 2 3` (in any order due to scheduling).

The same applies to method values:

```go
fns := []func(){}
for _, w := range workers {
    fns = append(fns, w.Run)    // method value binds receiver
}
for _, f := range fns { f() }
```

Method value `w.Run` binds the receiver at the moment of expression evaluation. With `*Worker` receiver, it captures the pointer value of `w`. In 1.21 that pointer value got overwritten on every iteration; in 1.22 each iteration has its own variable.

For library code that supports both Go versions, defensively copy:

```go
for _, w := range workers {
    w := w   // safe in both 1.21 and 1.22
    fns = append(fns, w.Run)
}
```

The shadow is harmless under 1.22 semantics.

---

## Library Design and Method Set Stability

Adding a new method is non-breaking. **Changing a receiver kind is breaking** — it changes the method set of one or both of `T`/`*T`:

| Change | T set | *T set | Breaking? |
|--------|-------|--------|-----------|
| Add value-receiver method `M` | gain `M` | gain `M` | no |
| Add pointer-receiver method `M` | unchanged | gain `M` | no |
| Convert `(t T)` to `(t *T)` | lose `M` | unchanged | **yes** |
| Convert `(t *T)` to `(t T)` | gain `M` | unchanged | no (but semantically risky) |
| Remove method | lose `M` | lose `M` | yes |

Migration plan for `value → pointer`:
1. Bump major version.
2. Add new pointer-receiver method with a different name.
3. Mark the old method `// Deprecated:`.
4. Remove old in version N+1.

Or: introduce a new type `T2` and provide a constructor that returns `*T2`, leaving `T` intact.

---

## Refactoring: Value-To-Pointer Migration

A common scenario: a value-object type grows state and now needs pointer methods.

### Before

```go
type User struct { name, email string }
func (u User) Email() string  { return u.email }
func (u User) Name() string   { return u.name }
```

### After (need to mutate)

```go
type User struct { name, email string; updates int }
func (u *User) SetEmail(e string) { u.email = e; u.updates++ }
```

If callers were doing:

```go
m := map[string]User{}
m["a"] = User{...}
// m["a"].SetEmail(...)  // now compile error
```

You must change call sites to:

```go
u := m["a"]; u.SetEmail("x"); m["a"] = u
// or
m := map[string]*User{}
m["a"] = &User{...}
m["a"].SetEmail("x")
```

A team-wide migration check:

```bash
git grep -n "map\[.*\]User"        # find value-storage sites
git grep -n "func.*User).*) {.*= " # find mutating value methods
```

---

## Testing Strategies

### Compile-time interface assertion

Always include this for any concrete-to-interface mapping:

```go
var _ Renamer = (*Cat)(nil)
```

If you change `Cat`'s method receiver kind from pointer to value (or vice versa), the assertion breaks at build time.

### Table-driven addressability check

```go
func TestRenamerSatisfaction(t *testing.T) {
    cases := []struct {
        name    string
        construct func() Renamer
    }{
        {"pointer literal", func() Renamer { return &Cat{} }},
        {"factory",         func() Renamer { return NewCat() }},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            r := c.construct()
            r.Rename("New")
        })
    }
}
```

### Race tests on embedded mutex types

```bash
go test -race ./...
```

If your interface satisfaction silently fell back to value receivers (for example, you removed a pointer in an embedded type), the race detector will catch it.

---

## Diagnosing Hard Cases

### Case 1: Method works in tests but interface refuses it

```go
// In tests
c := Cat{}
c.Rename("x")    // OK — c is variable, addressable

// In production
type Repo struct { cats []Renamer }
r.cats = append(r.cats, Cat{})    // ❌
```

Rule: just because a method *call* works, doesn't mean an *interface assignment* will. The interface needs the method set, not just the addressable receiver.

### Case 2: Embedded interface refuses concrete type

```go
type ReadCloser interface { io.Reader; io.Closer }

type myReader struct{}
func (r myReader)  Read(p []byte) (int, error) { /* ... */ return 0, io.EOF }
func (r *myReader) Close() error               { return nil }

var rc ReadCloser = myReader{}    // ❌ Close has pointer receiver
var rc ReadCloser = &myReader{}   // ✅
```

The fix is the same as the simple case — but harder to see when interfaces are nested.

### Case 3: Method values escaping when method set looked fine

```go
type Worker struct{ /* large */ }
func (w *Worker) Process(req Req) { /* ... */ }

func register(callbacks []func(Req)) []func(Req) {
    w := &Worker{/* fields */}
    return append(callbacks, w.Process)   // w escapes to heap
}
```

The method set of `*Worker` includes `Process`, so the assignment compiles. But `w` was a local — and a method value implicitly closes over `w`. The escape analysis (`go build -gcflags='-m'`) will report `&Worker{} escapes to heap`. Method-set rules and escape rules are independent — both must pass for the code to be correct *and* fast.

---

## Cheat Sheet

```
INTERFACE SATISFACTION DESIGN
─────────────────────────────
Mutating methods   → pointer receivers everywhere
                   → constructors return *T
Value object       → value receivers everywhere
                   → both T and *T satisfy I
Stateless impl     → empty struct + value receivers

DISPATCH
─────────────────────────────
i.M()  → load itab, index into method-pointer slice
itab   → cached per (concreteType, interfaceType)
method-set check happens once at first use

EMBEDDING
─────────────────────────────
struct{ T  } — outer T value carries (T methods + *T methods if outer addressable)
struct{ *T } — outer T value carries full T+*T method set unconditionally

CONCURRENCY
─────────────────────────────
Mutex-bearing type → pointer receivers + interface uses *T
go vet 'passes lock by value' + method-set rule converge

GENERICS
─────────────────────────────
Methods cannot introduce type parameters
Lift Map/Transform to package-level generic functions

LOOP VARIABLES
─────────────────────────────
Pre-1.22: shared variable (method values bind to one address)
Post-1.22: per-iteration variable (each method value binds independently)
Defensive `x := x` works in both

API STABILITY
─────────────────────────────
Add method     → non-breaking
Remove method  → BREAKING
T → *T receiver kind change → BREAKING
```

---

## Summary

The senior view of method sets:

1. **Architectural shape**: domain entities → pointer-method types; value objects → value-method types; services → pointer-method types with `*T` constructors.
2. **Dispatch internals**: itab caching, runtime method-pointer indexing, no inline through interface (yet).
3. **Embedding layout**: pointer embedding makes the outer's method set thicker but adds heap allocation and indirection.
4. **Concurrency**: pointer receivers protect against mutex copy; interface satisfaction follows from the same constraint.
5. **Generics**: methods cannot add their own type parameters — lift to package functions for transforms.
6. **Loop variables**: Go 1.22 per-iteration semantics make method-value-in-loop safe by default; defensive shadowing remains harmless.
7. **API stability**: receiver-kind changes are breaking — plan migrations across major versions.

At the professional level we marry these technical decisions to team conventions, production patterns, profiling, and large-scale code organisation.
