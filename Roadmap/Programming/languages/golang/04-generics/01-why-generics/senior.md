# Why Generics? — Senior Level

## Table of Contents
1. [The decision matrix: generics vs interfaces vs duplication](#the-decision-matrix-generics-vs-interfaces-vs-duplication)
2. [API surface and library design](#api-surface-and-library-design)
3. [Binary size and compile-time tradeoffs](#binary-size-and-compile-time-tradeoffs)
4. [Readability and the cognitive cost](#readability-and-the-cognitive-cost)
5. [The "rule of three" for genericization](#the-rule-of-three-for-genericization)
6. [When NOT to use generics](#when-not-to-use-generics)
7. [Generics in domain-driven design](#generics-in-domain-driven-design)
8. [Generic abstractions that age well](#generic-abstractions-that-age-well)
9. [Anti-patterns](#anti-patterns)
10. [Summary](#summary)

---

## The decision matrix: generics vs interfaces vs duplication

A senior Go engineer must constantly choose between three tools that look similar from a distance. Here is the decision matrix:

| Question | Tool |
|----------|------|
| Same body, different concrete types, no per-type behaviour | **Generics** |
| Different bodies per type (polymorphic behaviour) | **Interfaces** |
| Two types, body so simple that abstraction obscures it | **Duplication** |
| Need both polymorphism and type safety in one slot | **Generics + interface constraint** |
| Public API, callers care about ergonomics | **Interfaces** (more often) |
| Internal hot path, callers are private | **Generics** |

### Concrete examples

**Generics win**
```go
func Keys[K comparable, V any](m map[K]V) []K {
    out := make([]K, 0, len(m))
    for k := range m { out = append(out, k) }
    return out
}
```
The body does not care **what** `K` and `V` are. Same logic for every instantiation.

**Interfaces win**
```go
type Notifier interface {
    Notify(msg string) error
}

type EmailNotifier struct{}
func (e EmailNotifier) Notify(msg string) error { ... }

type SlackNotifier struct{}
func (s SlackNotifier) Notify(msg string) error { ... }
```
Each implementation does **different things**. Generics cannot express that — you need polymorphism.

**Duplication wins**
```go
func clampInt(v, lo, hi int) int { /* 3 lines */ }
func clampFloat(v, lo, hi float64) float64 { /* 3 lines */ }
```
A 3-line body, used twice — generics add **more** complexity than they remove.

---

## API surface and library design

Generics change what a public API looks like. A senior engineer must think carefully about what they expose.

### Exported generic functions

When you export `func F[T any](...)`, you are committing to a contract: every caller can pick `T`. Once published, you cannot easily change the constraint without breaking callers.

Concrete advice:

1. **Start with the loosest constraint that compiles.** If `any` works, use `any`. Tightening later is usually compatible; loosening is not.
2. **Avoid leaking implementation types** through the type parameter list. A signature `func Encode[T MyInternal]` chains every caller to `MyInternal`.
3. **Name parameters consistently across the package.** If `K` is your map key everywhere, do not switch to `Key` in one function.
4. **Document the constraint** when it is a custom interface — godoc cannot infer your intent.

### Exported generic types

A generic type spreads its type parameter through every method signature:

```go
type Cache[K comparable, V any] struct { ... }

func (c *Cache[K, V]) Get(k K) (V, bool)
func (c *Cache[K, V]) Set(k K, v V)
func (c *Cache[K, V]) Delete(k K)
```

Each method must repeat the parameter list. This **clutters godoc** and IDE hover panes. Public generic types are heavier to use than concrete types.

### Should you generify a stable API?

Migrating a stable API to generics is **not free**:
- Callers must update to Go 1.18+.
- Type inference may fail on call sites that used to compile.
- Method documentation grows by an order of magnitude.

The standard library does this carefully — `slices.Sort` and `slices.SortFunc` were added **alongside** `sort.Slice`, not as replacements. Followers should do the same.

---

## Binary size and compile-time tradeoffs

GC shape stenciling reduces but does not eliminate code bloat. Real numbers from the Go team's measurements (early 1.18):

| Project | Without generics | With generics | Delta |
|---------|------------------|---------------|-------|
| `go` itself | 14.8 MB | 15.0 MB | +1.5% |
| `kubectl` | 47 MB | 47.3 MB | +0.6% |
| `gopls` | 35 MB | 35.4 MB | +1.1% |

A few percent — modest, but measurable. The cost grows with:
- Number of distinct **GC shapes** instantiated
- Number of generic functions used
- Depth of nested generic calls

### Compile time

Generic code takes longer to compile because the compiler must:
1. Type-check the generic body once
2. Stencil it for each shape
3. Build dictionaries

In practice, the slowdown is around **5-15%** for projects with heavy generic use. The Go team is actively optimising this; numbers improve every release.

### Binary cache and incremental builds

Generics interact subtly with the build cache. A change to a single generic function can invalidate the cache for every package that **instantiates** it. For monorepos with thousands of packages, this can be felt on CI.

---

## Readability and the cognitive cost

Compare:

```go
// Concrete
func MaxAge(users []User) int {
    if len(users) == 0 { return 0 }
    m := users[0].Age
    for _, u := range users[1:] {
        if u.Age > m { m = u.Age }
    }
    return m
}
```

```go
// Generic
func MaxBy[T any](s []T, key func(T) int) int {
    if len(s) == 0 { return 0 }
    m := key(s[0])
    for _, v := range s[1:] {
        if k := key(v); k > m { m = k }
    }
    return m
}
```

The generic version is **more reusable** but harder to grasp at first glance. The cognitive surface area increased:
- The reader must understand type parameters
- The reader must trace `key` to know what is being compared
- The function name no longer expresses intent

A senior engineer chooses the right level of abstraction. **Generality has a cost**, paid by every future reader.

### The "library vs application" rule

| Code lives in | Lean towards |
|---------------|---------------|
| Reusable library | Generics |
| Internal package | Concrete |
| Application "main" code | Concrete unless duplication is real |

Libraries pay the cognitive cost once and reap the benefits forever. Application code rarely benefits from premature genericization.

---

## The "rule of three" for genericization

Borrowed from the DRY school: **do not generalize until you have three concrete instances**.

Why three?
- One instance is just code.
- Two instances might be coincidence, and the cost of refactoring is small.
- Three instances reveal the **real** abstraction — and you have enough data points to design the right type parameter list.

Premature generalization is worse than duplication because the wrong abstraction is much harder to undo.

### Worked example

You start with `IntSet`. A week later you need `StringSet`. Should you reach for `Set[T comparable]`?

- If `IntSet` and `StringSet` are 50 lines each and identical: yes.
- If they are 5 lines each: probably not.
- If `StringSet` already started to diverge (e.g., case-insensitive equality), then **no** — you have polymorphism, not parameterism. Use an interface.

A third type request (`UUIDSet`?) is the trigger to genericize.

---

## When NOT to use generics

A senior engineer says "no" more often than "yes" to generics.

### Anti-cases

1. **One concrete type, one call site.** No payoff.
2. **The body is shorter than the constraint declaration.** The reader spends more time on the signature than the logic.
3. **You need different behaviour per type.** That is interfaces, not generics.
4. **You need reflection anyway.** Generics do not eliminate the reflect call; they just type-check the input.
5. **Public API stability matters more than DRY.** Breaking changes via generics are easy to make, hard to detect.
6. **The constraint becomes "any with a method"** — that is exactly what an interface is.

### The anti-pattern: "generic everywhere"

```go
// What not to do
func Add[T int | float64 | int32 | int64 | float32 | uint | uint8 | uint16 | uint32 | uint64](a, b T) T {
    return a + b
}
```

A signature that big tells the reader "I tried to be clever". If you really need this, define a constraint `type Number interface { ... }` and reuse it.

---

## Generics in domain-driven design

Generics tempt teams to model business types generically:

```go
type Repository[T Entity] interface {
    Find(id ID) (T, error)
    Save(e T) error
    Delete(id ID) error
}
```

Tempting and clean — but think hard before adopting:

| Concern | Generic repository | Interface per entity |
|---------|-------------------|----------------------|
| Onboarding | "What is `T`?" | Direct method names |
| Custom queries | Hard — break the abstraction | Easy — add a method |
| Mocking | Generic mocks are awkward | Standard mock pattern |
| godoc | Same set of methods for every entity | Per-entity docs |

A common middle ground: **one generic helper** (`type-safe Find[T]`) and **one repository interface per aggregate**. The aggregate-specific interface keeps the domain language; the generic helper kills the boilerplate.

### Generic Result/Option types

Some teams introduce `Result[T any]` and `Option[T any]` after coming from Rust or Scala. Be careful:

- Go's idiom is `value, err := f()`. A `Result[T]` wrapper fights that idiom.
- Mixing both styles within one codebase doubles the cognitive load.

If you do introduce `Result[T]`, make it **internal** to one package and provide adapters at the package boundary.

---

## Generic abstractions that age well

After two years of community experience, three patterns have proven themselves:

### 1. Algorithmic helpers

`Map`, `Filter`, `Reduce`, `Min`, `Max`, `Sum`. Small, well-defined, well-known.

### 2. Container types where T is data, not behaviour

`Stack[T]`, `Queue[T]`, `Set[T comparable]`, `LRUCache[K comparable, V any]`. The element is **inert** — the container does all the work.

### 3. Wrapping helpers

`AtomicValue[T any]`, `Pool[T any]`, `Result[T any]`, `Page[T any]`. Tiny wrappers that add type safety to existing primitives.

### 4. Pipeline builders

```go
type Pipeline[I, O any] struct { ... }
func (p Pipeline[I, O]) Then[X any](next func(O) X) Pipeline[I, X] { ... }
```

(Note: requires Go 1.21+ for some patterns; earlier versions reject method-level type parameters.)

---

## Anti-patterns

### Anti-pattern 1 — Constraint inflation

```go
type EverythingNumeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 | ~uint | ~uint8 | ...
}
```

If your function works for "any number", reach for the **standard** `cmp.Ordered` or `constraints.Integer`/`Float`/`Complex` (from `golang.org/x/exp/constraints`). Don't reinvent.

### Anti-pattern 2 — Generic God Type

```go
type Container[T any, K comparable, F func(T) bool, R any, ...] struct { ... }
```

Five type parameters is a smell. Split the type or the responsibility.

### Anti-pattern 3 — Hidden polymorphism

```go
func Process[T any](v T) {
    switch x := any(v).(type) { // 🚨 runtime type switch on T
    case Dog: ...
    case Cat: ...
    }
}
```

You wrote a generic function but immediately checked the type at runtime. That is an interface in disguise. Use `interface { Process() }` instead.

### Anti-pattern 4 — Constraint declared in the function

```go
func Foo[T interface{ ~int | ~float64 }](a T) T { ... }
```

Local type sets are valid syntax but harder to reuse. Promote them to package-level types when shared.

### Anti-pattern 5 — Over-instantiation

Calling the same generic function with hundreds of distinct types in one binary makes the binary larger. If you find yourself doing this, ask whether `interface{}` is actually the right tool — sometimes runtime polymorphism is cheaper than 200 stenciled bodies.

---

## Summary

Generics in Go are a powerful tool, but a senior engineer respects three rules:

1. **Generality has a cost** — every reader pays it, forever.
2. **Wait for the third use case** — premature abstraction is worse than duplication.
3. **Choose the right tool** — generics for parameterism, interfaces for polymorphism, duplication for trivia.

The architectural impact of generics goes beyond code — it shapes API surfaces, binary sizes, build times, and team cognition. A senior engineer evaluates each of those axes when deciding whether to introduce a generic abstraction.

The post-1.18 Go ecosystem has settled into a clean consensus: **generics for the leaves, interfaces for the architecture, duplication for the trivial**. Internalize that and your code will fit naturally with the rest of the Go community.

Move on to `professional.md` to see how mature Go projects have applied these principles in real-world migrations.
