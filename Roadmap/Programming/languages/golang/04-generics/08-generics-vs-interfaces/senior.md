# Generics vs Interfaces — Senior Level

## Table of Contents
1. [The four-way decision matrix](#the-four-way-decision-matrix)
2. [Where interfaces still win](#where-interfaces-still-win)
3. [Where generics still win](#where-generics-still-win)
4. [Hybrid patterns](#hybrid-patterns)
5. [Dependency injection and plugin systems](#dependency-injection-and-plugin-systems)
6. [Designing extensible abstractions](#designing-extensible-abstractions)
7. [API stability considerations](#api-stability-considerations)
8. [Anti-patterns at the senior level](#anti-patterns-at-the-senior-level)
9. [Summary](#summary)

---

## The four-way decision matrix

A senior engineer faces one of four situations when designing reusable code:

| Situation | Tool |
|-----------|------|
| Same body, single type per call site, no per-type behaviour | **Generics** |
| Different bodies, callers want polymorphism | **Interfaces** |
| Same body, but body needs methods on `T` | **Generic + interface constraint** |
| Heterogeneous storage, plugin / runtime swap | **Interfaces** |

The trap is that all four situations look like "I want reuse". The senior's job is to look past the surface and ask: **what kind of reuse, and decided when?**

---

## Where interfaces still win

Despite the appeal of generics, interfaces remain the right answer in several large categories:

### 1. Heterogeneous collections

When a slice or map must hold values of different concrete types, only an interface unifies them under a shared identity:

```go
type Shape interface { Area() float64 }
shapes := []Shape{Circle{1}, Square{2}, Triangle{3, 4}}
total := 0.0
for _, s := range shapes { total += s.Area() }
```

Generics cannot do this. `[]Shape[T]` is not a thing. Each instantiation `Circle`, `Square`, `Triangle` is a distinct type and they cannot share a slice.

### 2. Dependency injection

Services accept interfaces so they can be swapped in tests:

```go
type UserRepo interface {
    Find(ctx context.Context, id int) (*User, error)
}

type UserService struct { repo UserRepo }

func (s *UserService) Get(ctx context.Context, id int) (*User, error) {
    return s.repo.Find(ctx, id)
}
```

The test injects a fake; production injects the real DB-backed version. A generic `UserService[R UserRepo]` would force every consumer to know about `R` and propagate the type parameter through every call site. Interfaces erase that surface.

### 3. Plugin systems

Runtime registration of handlers is fundamentally interface-shaped:

```go
type Handler interface { Serve(ctx context.Context, req Request) Response }

var registry = map[string]Handler{}

func Register(name string, h Handler) { registry[name] = h }
```

The map can hold any concrete `Handler`. With generics, every handler would need the same `T`, which defeats the purpose.

### 4. Standard library protocols

`io.Reader`, `io.Writer`, `error`, `fmt.Stringer`, `flag.Value`, `http.Handler` — all interfaces. They will not be replaced by generics. Why?

Because they describe **behaviour** that varies per implementation: a file reads from disk, a network connection reads from sockets, a `bytes.Reader` reads from memory. The body of `Read` is fundamentally different per type. That is exactly the case where interfaces, not generics, are the right tool.

### 5. Method values

You can take a method value off an interface and pass it as a function:

```go
fn := r.Read           // bound method
result, err := fn(buf) // calls *os.File.Read(buf)
```

Generics do not give you this kind of "value-level abstraction" — they parametrize types, not values.

### 6. Late binding

Interfaces allow a system to be extended **without recompiling the caller**. New `Handler` implementations can be added, registered at runtime, swapped via configuration. Generics require the type to be known at compile time at every instantiation site.

---

## Where generics still win

Generics dominate when the body is identical and per-type behaviour is not the point:

### 1. Algorithmic code over collections

`Map`, `Filter`, `Reduce`, `Sort`, `Find`, `Index`, `Contains`. The body is one shape. Different types only change what is being iterated. Generics are correct.

### 2. Type-safe containers

`Stack[T]`, `Queue[T]`, `Set[T comparable]`, `LRUCache[K, V]`, `RingBuffer[T]`. The container's logic is the same regardless of element type; only the type of element varies.

### 3. Numeric utilities

`Min`, `Max`, `Abs`, `Clamp`, `Sum`, `Mean`. Operations differ on the type but the algorithm is the same.

### 4. Wrapping primitives

`atomic.Pointer[T]`, `sync.OnceValue[T]`, `Result[T]`, `Page[T]`. Tiny wrappers that add type safety without changing the underlying primitive's behaviour.

### 5. Hot-path inner loops

If a slice of `int` is summed a million times per second, the cost of `interface{}` boxing dwarfs the gain of polymorphism. Use generics so the loop stays flat.

---

## Hybrid patterns

The post-1.18 idiom that has emerged is to use **both** tools at different layers.

### Pattern 1 — Generic function over interface constraint

```go
type Comparator[T any] interface { Compare(other T) int }

func Sort[T Comparator[T]](s []T) {
    sort.Slice(s, func(i, j int) bool { return s[i].Compare(s[j]) < 0 })
}
```

The function is generic for type safety on the slice; the constraint requires a method, giving per-type comparison logic.

### Pattern 2 — Interface for the API, generics inside

```go
// Public surface — interface, stable
type Cache interface {
    Get(key string) (any, bool)
    Set(key string, val any)
}

// Internal — generic, performant
type typedCache[V any] struct{ m map[string]V }
func (c *typedCache[V]) get(k string) (V, bool) { v, ok := c.m[k]; return v, ok }
```

Library users see the interface; the implementation uses generics for fast typed access.

### Pattern 3 — Generic helpers feeding interface-shaped pipelines

```go
type Stage interface { Run(in []byte) ([]byte, error) }

func Parallel[T Stage](stages []T, in []byte) ([]byte, error) {
    // generic over a typed slice of stages — but each stage is interface-shaped
    ...
}
```

The slice is typed (no boxing on element access); the body still calls into per-stage behaviour through the interface methods.

### Pattern 4 — Repository with generic helpers and interface methods

```go
type Repository[T any] interface {
    Find(ctx context.Context, id int) (*T, error)
    Save(ctx context.Context, v *T) error
}

func FindOrCreate[T any](ctx context.Context, r Repository[T], id int, factory func() *T) (*T, error) {
    if v, err := r.Find(ctx, id); err == nil { return v, nil }
    nv := factory()
    return nv, r.Save(ctx, nv)
}
```

`Repository[T]` is a generic interface. `FindOrCreate` is a generic helper that uses it. Two different aggregates (`User`, `Order`) get different concrete repositories, but `FindOrCreate` is written once.

---

## Dependency injection and plugin systems

### Why DI is interface-shaped

Dependency injection swaps an implementation at runtime. The site that uses the dependency must not be parametrized by the dependency's type — otherwise every test, mock, and configuration change ripples through.

```go
// Good — interface, runtime swap
type Mailer interface { Send(to, body string) error }
type Service struct { mail Mailer }

// Painful — generic, propagates everywhere
type Service[M Mailer] struct { mail M }
func New[M Mailer](m M) *Service[M] { ... }
// every call site, every type signature, every test now has [M] noise
```

For DI specifically, the compile-time gain of generics is small (the dependency is rarely on a hot path) and the API friction is large.

### Plugin systems

A plugin system is the extreme of DI: implementations are not even known at compile time. Generics cannot express this. Interfaces are the only option.

```go
type Plugin interface {
    Name() string
    Init(cfg map[string]any) error
}

var pluginRegistry = map[string]Plugin{}
```

A user dropping in a new `.so` file (or compiling a new binary with extra packages) extends the system without touching the core.

### A useful test

When in doubt, ask: **could a third party provide an implementation, after my code ships?**

- Yes → interface.
- No → generic is fine if the body is identical.

---

## Designing extensible abstractions

### Open for extension via interfaces

The classic Go API style is "small interfaces". An interface with one method is the minimum surface needed for users to add their own implementation:

```go
type Stringer interface { String() string }
type Reader interface { Read(p []byte) (n int, err error) }
```

A new package can provide a new `Reader` without anyone recompiling. This is how `io`, `net/http`, `database/sql` evolved.

### Closed by generics

A generic API closes the type set to "whatever satisfies the constraint". That is fine for utilities (`Map`, `Sort`) but uncomfortable for evolving systems where new types must be added by callers.

### Choosing the open/closed axis

| Quality wanted | Tool |
|----------------|------|
| Open to new implementations | Interfaces |
| Closed, type-safe across known operations | Generics |
| Open in protocol, closed in implementation detail | Interface API + generic internals |

A senior thinks about evolution. Will users provide their own types? If yes, interfaces. If no, generics may be cleaner.

---

## API stability considerations

### Generics propagate

A generic public API forces every caller to mention `T`. Once published, removing or renaming `T` breaks consumers. Adding a constraint also breaks consumers — types that used to satisfy `any` may not satisfy a tighter constraint.

### Interfaces are usually additive

Adding a method to a public interface **breaks** callers that implement it externally. But interfaces with method sets that grow rarely is a stable API surface.

### Strategy

1. **For shared utility functions**, generics with the loosest constraint that compiles. Tighten only with major-version bumps.
2. **For public protocols** (Reader, Writer, Notifier), interfaces. Keep the method set tiny.
3. **For internal speed-critical code**, generics. Internal callers can change.
4. **For DI-shaped boundaries**, interfaces. Tests and configuration depend on it.

### Evolving an existing API

Migrating an interface-shaped public API to generics is rarely worth it. The Go team itself kept `sort.Slice` (interface) alive even after introducing `slices.Sort` (generic). Both exist; old callers do not break; new callers pick the new style. This is the right model.

---

## Anti-patterns at the senior level

### Anti-pattern 1 — Generic interface explosion

```go
type Repository[T any, ID comparable, Q any, R any, F any] interface {
    Find(F) (R, error)
    Save(T) error
    Query(Q) ([]R, error)
    ...
}
```

Five type parameters in a public interface is a smell. Split the interface or accept that some operations belong to a sub-interface.

### Anti-pattern 2 — Forcing polymorphism into generics

```go
// Bad: type switch hides interface dispatch
func Process[T any](v T) {
    switch x := any(v).(type) {
    case Email: x.Send()
    case Slack: x.Send()
    }
}
```

This is a `Notifier` interface in costume. Replace with `func Process(n Notifier)`.

### Anti-pattern 3 — Forcing parametricity into interfaces

```go
// Bad: interface with one method per type
type IntCache interface { GetInt(string) (int, bool) }
type StringCache interface { GetString(string) (string, bool) }
```

The bodies are identical. Replace with `Cache[V any]`.

### Anti-pattern 4 — Generic for "future flexibility"

A function that takes one concrete type but is written `func F[T concrete](v T)` "in case we need other types later" pays the cognitive cost now for a benefit that may never come. **YAGNI applies to generics too.**

### Anti-pattern 5 — Interface with one implementation

```go
type UserRepo interface { Find(int) (*User, error) }
type pgUserRepo struct{ ... }
// no other implementation, ever
```

If there is no second implementation and no plan for one, the interface is noise. Use the concrete type. Add the interface only when the second implementation arrives — usually for tests.

### Anti-pattern 6 — Generic constraint built from union types when an interface would suffice

```go
type Notifier interface {
    Notify(string) error
}
// vs
type NotifierConstraint interface {
    Email | Slack | SMS
    Notify(string) error
}
```

The second form is closed. New notifier types require updating the constraint. The first form is open. Choose the closed form only when the closed set is a deliberate guarantee.

---

## Summary

A senior Go engineer chooses between generics and interfaces based on **decision time** (compile vs runtime), **shape** (homogeneous vs heterogeneous), and **openness** (will third parties add implementations?).

- Interfaces win at architectural seams: DI, plugin systems, heterogeneous collections, evolving APIs, stdlib-style protocols.
- Generics win at the leaves: algorithms, containers, numeric utilities, hot-path inner loops, type-safe wrappers.
- Hybrids are the modern idiom: a generic function over an interface constraint gives compile-time safety and per-type behaviour at the same time.

Three habits that mark a senior:

1. **Default to interfaces** at architectural boundaries, **default to generics** at leaves, **resist abstraction** in the middle.
2. **Resist generic public APIs** unless the value is overwhelming. Public generics propagate type parameters everywhere.
3. **Resist single-implementation interfaces.** Add the interface when the second implementation arrives, not before.

Move on to `professional.md` to see how mature library authors apply these heuristics in real migrations.
