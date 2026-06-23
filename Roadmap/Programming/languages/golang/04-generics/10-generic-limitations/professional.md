# Generic Limitations — Professional Level

## Table of Contents
1. [The four real-world workarounds](#the-four-real-world-workarounds)
2. [Codegen as a partner to generics](#codegen-as-a-partner-to-generics)
3. [Interface fallbacks](#interface-fallbacks)
4. [Runtime reflection escape hatches](#runtime-reflection-escape-hatches)
5. [Hybrid designs](#hybrid-designs)
6. [Trade-off matrix](#trade-off-matrix)
7. [When to wait for a language change](#when-to-wait-for-a-language-change)
8. [Case study: ORM mappers](#case-study-orm-mappers)
9. [Case study: Kubernetes typed clients](#case-study-kubernetes-typed-clients)
10. [Case study: functional libraries](#case-study-functional-libraries)
11. [Summary](#summary)

---

## The four real-world workarounds

When you hit a hard limit, mature Go projects pick from a small menu:

1. **Codegen** — generate per-type code from a template.
2. **Interface fallback** — accept the perf cost of dynamic dispatch.
3. **Runtime reflection** — accept the perf cost AND the lost type safety.
4. **Hybrid** — generic frontend, codegen or interface backend.

Each has well-known trade-offs. A professional engineer knows them by heart.

---

## Codegen as a partner to generics

Code generation predates generics by a decade in Go. After 1.18, many people declared codegen dead. They were wrong.

### Where codegen still wins

1. **Per-type method sets** — generics cannot vary the method set per instantiation; codegen can.
2. **Specialization for hot paths** — generics give you one body; codegen gives you N optimized bodies.
3. **Cross-cutting concerns** — protobuf, deepcopy, conversion, mock generation; these are about **structure**, not type parameters.
4. **Interop with non-Go systems** — gRPC stubs, GraphQL resolvers, openapi clients.

### Tools the ecosystem still uses

- **`stringer`** — generates `String()` for enum-like int constants.
- **`mockery` / `gomock`** — generates mock implementations from interfaces.
- **`go-bindata`-likes** — embed assets.
- **`protoc-gen-go`** — protobuf bindings.
- **`gopls` codegen helpers** — fill struct, fill switch.

### Codegen + generics together

A mature pattern: generate a thin per-type wrapper, then have it delegate to a generic core.

```go
// Generated per-type
//go:generate go run ./tools/gen.go -type=User
func ListUsers(ctx context.Context, db *sql.DB, q Query) ([]User, error) {
    return list[User](ctx, db, q) // delegates to generic
}

// Hand-written generic
func list[T any](ctx context.Context, db *sql.DB, q Query) ([]T, error) {
    /* shared body */
}
```

The wrapper compiles to a direct, devirtualized call. Each `ListUsers`, `ListOrders`, `ListInvoices` looks idiomatic to a non-generic-savvy reader. The generic core stays DRY.

### When codegen is the wrong answer

- The "thing" you would generate is one line. Use generics directly.
- The number of types is open-ended (e.g., user-defined). Generation breaks down.
- You cannot afford build-step complexity (small teams, no CI infra).

---

## Interface fallbacks

When the generic limit pushes toward polymorphism, **just use an interface**:

```go
// Tried: switch on T
// Failed: cannot type-switch on T
// Workaround: an interface

type Handler interface { Handle() error }

type Order struct{}; func (Order) Handle() error { /* ... */ return nil }
type Refund struct{}; func (Refund) Handle() error { /* ... */ return nil }

func Process(h Handler) error { return h.Handle() }
```

### Trade-offs

| Aspect | Generic | Interface fallback |
|--------|---------|---------------------|
| Compile-time safety | Strong | Weaker (depends on contract) |
| Runtime speed | Fast (often inlined) | One v-table call (~1 ns) |
| Allocations | None | Often one per boxed value |
| API surface | Type parameters in signatures | Interface name only |
| Onboarding | Heavier (`[T any]`) | Lighter |

### A real heuristic

> If your generic ends up doing a type-switch, the interface was the right answer all along.

The mental cost of generics is justified only when callers benefit from compile-time type guarantees. If the function will dispatch at runtime anyway, interfaces are simpler.

---

## Runtime reflection escape hatches

When even interfaces are not flexible enough, reflection is the trapdoor:

```go
import "reflect"

func Decode[T any](data []byte) (T, error) {
    var t T
    rv := reflect.ValueOf(&t).Elem()
    /* walk rv, populate from data */
    return t, nil
}
```

### Where reflection is the right answer

- **JSON/XML/YAML decoders** — the input is dynamic, the type is fixed at compile time.
- **ORM mappers** — column-to-field mapping is structural.
- **Generic deep-copy** — without going field by field by hand.
- **Validation rules** — annotation-driven.

### Where reflection is the wrong answer

- A type-switch that would have been an interface.
- A loop that runs millions of times. Reflection is **5-50× slower** than direct calls.
- Anything where the set of types is small and known.

### The performance cliff

```go
// Direct call: ~1 ns
v.Method()

// Interface call: ~2-3 ns
i.Method()

// Reflect call: ~50-200 ns
rv.MethodByName("Method").Call(nil)
```

Reflection is fine at the **edges** of a system (one call per HTTP request). It is disastrous in **inner loops**.

### Caching reflection

Mature reflection-heavy libraries (sqlx, gorm, validator) cache `reflect.Type`-keyed metadata. The first call walks the type; subsequent calls hit the cache. This brings reflection's amortized cost down to roughly an interface call.

```go
var typeCache sync.Map // map[reflect.Type]*meta

func metaFor(t reflect.Type) *meta {
    if m, ok := typeCache.Load(t); ok { return m.(*meta) }
    m := buildMeta(t)
    typeCache.Store(t, m)
    return m
}
```

If your reflection-using code is in any kind of hot path, **make sure** it caches. Otherwise the cost is one teardown per call.

---

## Hybrid designs

Real codebases mix all of the above. A canonical pattern:

```
        ┌──────────────────────────────────────┐
        │  Public API                          │
        │  - generic typed wrappers            │
        │  - per-type codegen for stability    │
        └──────────────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────────────────┐
        │  Generic core                        │
        │  - one stenciled body                │
        │  - shared algorithm                  │
        └──────────────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────────────────┐
        │  Reflection-backed implementation    │
        │  - type-cached metadata              │
        │  - dynamic field access              │
        └──────────────────────────────────────┘
```

Each layer hides the layer below from its callers. The user sees a clean typed API, the implementer enjoys DRY, and the runtime gets to amortize reflection costs.

### Why this layering matters

It localizes the **cost of the limit** to one layer. A change in the reflection layer does not ripple up. If Go 1.30 ever adds method type parameters, the generic core can be rewritten without touching the public API.

---

## Trade-off matrix

A decision aid for senior engineers:

| Situation | Recommended workaround |
|-----------|------------------------|
| Method needs new type param | Free function |
| Per-type method set | Codegen |
| Specialization for hot type | Hand-written non-generic + benchmark |
| Type-switch on T | Interface OR `any(v).(type)` at boundary |
| Container covariance | Element-by-element copy |
| HKT abstraction | Per-container free functions |
| Negative constraint | Runtime check + error |
| Generic type alias (<1.24) | Type definition (or upgrade to 1.24) |
| Function name overloading | Different names |
| Reflective metadata | Cached reflection |

---

## When to wait for a language change

A pragmatic rule: if you can **work around** the limit in <50 lines of code, do not wait. The Go release cadence is two releases a year, and many proposals never land.

But sometimes waiting **is** the right answer:

- **Generic type aliases** — accepted in 1.24. Teams blocked on this between 1.18 and 1.24 simply waited.
- **Iterators (range-over-func)** — accepted in 1.23. Teams that wanted ergonomic iterators waited.
- **Slices/maps in stdlib** — promoted in 1.21. Many teams used `golang.org/x/exp` until then.

The Go team is **deliberate** but not glacial. Critical features ship within a year or two of acceptance. The risky decision is to bend generics around an unresolved proposal — your code may need to be rewritten when the feature lands.

### How to track upcoming generic changes

- The Go [proposal tracker](https://github.com/golang/go/issues?q=label%3Agenerics)
- The [Go specification commits](https://github.com/golang/go/commits/master/doc/go_spec.html)
- Release notes for every minor version
- Talks at GopherCon (typically a "state of generics" each year)

---

## Case study: ORM mappers

ORMs were one of the most reflection-heavy parts of pre-1.18 Go. Generics let them present a typed API, but reflection did not disappear.

### Pre-1.18

```go
var u User
err := db.Get(&u, "SELECT * FROM users WHERE id = ?", 1)
// reflection scans columns into &u
```

### Post-1.18 (typed wrapper)

```go
u, err := QueryOne[User](db, "SELECT * FROM users WHERE id = ?", 1)
```

Internally:

```go
func QueryOne[T any](db *sql.DB, q string, args ...any) (T, error) {
    var t T
    err := scanInto(db, q, args, &t) // reflection still happens here
    return t, err
}
```

The user sees a typed return. The implementer still uses `reflect.Value.FieldByName` underneath.

### What generics eliminated

- The `&u` argument with type assertion on the way back.
- The `var u User` declaration above the call.
- The cast / assertion failure modes.

### What generics did NOT eliminate

- The reflection cost per row scanned.
- The struct-tag-based column mapping.
- The need for a code path per column type.

### Lesson

Generics are **glue**, not magic. They tighten the type signature; they rarely change the implementation strategy.

---

## Case study: Kubernetes typed clients

Kubernetes' client-go has historically used **codegen** for typed clients (`PodLister`, `ServiceLister`, etc). Each Kubernetes API type gets its own `Lister` and `Client`.

### Why not just use generics?

The team experimented:

```go
type Lister[T runtime.Object] interface {
    List(selector labels.Selector) ([]T, error)
    Get(name string) (T, error)
}
```

But:

1. **Method set differences** — some resources are namespaced, others are cluster-scoped. The method set must vary per type.
2. **Open-ended type space** — third parties define new resources. Codegen handles them; generics do not.
3. **API stability** — public clients have been around for years. Switching to generics breaks every consumer.
4. **Reflection-heavy core** — the underlying machinery uses reflection regardless of the typed wrapper.

The compromise: generics in **internal helpers**, codegen for the **public API**. This is a textbook hybrid.

### Lesson

When the type space is **open** and the method set is **per-type**, codegen wins. Generics are best when the type space is closed (your library defines the constraint) and the method set is uniform.

---

## Case study: functional libraries

`samber/lo` is the most popular functional library in the post-generics era:

```go
import "github.com/samber/lo"

evens := lo.Filter([]int{1,2,3,4}, func(x int, _ int) bool { return x%2 == 0 })
strs := lo.Map([]int{1,2,3}, func(x int, _ int) string { return fmt.Sprint(x) })
```

It deliberately does **not** define HKT abstractions. Every helper is a top-level free function with its own type parameters. The library is shaped by Go's limits:

- No `Functor[F[_]]` — `Map` exists per container (slice, map, chan).
- No method chaining — operators are free functions.
- No specialization — one body per signature.

The result: 100+ functions, each independently understandable, no clever interlocking abstractions. **Verbose but maintainable.**

### Compare: `samber/mo`

`samber/mo` adds `Result[T]`, `Option[T]`, `Either[L, R]`. Useful, but bumps into the no-method-type-parameter limit:

```go
// Wished:
opt.Map[U](func(t T) U) Option[U]

// Provided (free function):
mo.MapOption(opt, func(t T) U) Option[U] // if it existed exactly like this
```

The library compromises by making `Map` take a `func(T) T` (same type) and providing free-function variants like `mo.Map[T, U]` for type-changing transforms. The asymmetry is a direct consequence of Go's method-type-parameter limit.

### Lesson

Even libraries explicitly designed around generics work around these limits. The limits **shape** API design more than they constrain it.

---

## Summary

The professional view of generic limitations is **strategic**:

1. **Pick a workaround** that matches the limit, the team, and the project.
2. **Codegen still has a role** — for per-type method sets, specialization, open type spaces.
3. **Interface fallbacks** are the cleanest answer when a generic would dispatch at runtime anyway.
4. **Reflection** is the last-resort escape hatch — cache its metadata aggressively.
5. **Hybrid layered designs** localize the workaround cost to one layer.
6. **Wait for the language** only when the proposal is accepted or imminent.

A senior, working engineer measures each design against these limits before committing. The cost of "fighting the limit" is paid by every reader and every CI build, forever. The cost of accepting the limit is one extra line of code or one cached `reflect.Type`. Almost always, the second cost is cheaper.

The next file (`specification.md`) anchors all of this in formal spec citations and the proposal-numbering history, so you can argue your case from primary sources when reviewing PRs.
