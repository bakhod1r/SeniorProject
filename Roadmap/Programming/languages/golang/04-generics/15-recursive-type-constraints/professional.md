# Recursive Type Constraints — Professional Level

## Table of Contents
1. [Real codebases that use F-bounded polymorphism](#real-codebases-that-use-f-bounded-polymorphism)
2. [Case study: test-mocking frameworks](#case-study-test-mocking-frameworks)
3. [Case study: fluent query builders](#case-study-fluent-query-builders)
4. [Case study: ORMs (`ent`, `bun`, `gorm`)](#case-study-orms-ent-bun-gorm)
5. [Case study: configuration and option builders](#case-study-configuration-and-option-builders)
6. [Case study: domain-driven aggregates](#case-study-domain-driven-aggregates)
7. [Does the complexity pay off?](#does-the-complexity-pay-off)
8. [Migration patterns](#migration-patterns)
9. [Team-level guidelines](#team-level-guidelines)
10. [Summary](#summary)

---

## Real codebases that use F-bounded polymorphism

Recursive type constraints are not a daily tool. Most Go programs never need them. But where they appear, they appear **strategically** — usually one or two abstractions per project. The most common settings:

| Setting | Why recursive constraints help |
|---------|--------------------------------|
| Test mocks | Builder-style mock setup needs `B.With(...).With(...)` to keep returning `B` |
| Query builders | `q.Where(...).OrderBy(...)` chains demand the concrete type |
| ORMs | Entity types implement `Clone`, `Equals`, `PrimaryKey()` returning self |
| Functional options | Some options libraries use builder fluent style |
| Domain aggregates | DDD entities expose `WithEvent` returning the same aggregate |
| Persistent collections | Immutable lists that return their own type on `Append` |

The pattern is rare but recognisable. When you spot a method named `WithX` returning the receiver's exact type, the library is using F-bounded polymorphism whether the author calls it that or not.

---

## Case study: test-mocking frameworks

`mockery`, `gomock`, `pegomock` predate generics. Modern frameworks experiment with generics for mock builders.

### A simplified generic mock builder

```go
type MockBuilder[B any] interface {
    With(name string, value any) B
    Build() any
}

type UserMock struct{ data map[string]any }

func (u UserMock) With(name string, value any) UserMock {
    out := UserMock{data: map[string]any{}}
    for k, v := range u.data { out.data[k] = v }
    out.data[name] = value
    return out
}

func (u UserMock) Build() any { return u.data }

func Compose[B MockBuilder[B]](b B, attrs map[string]any) B {
    out := b
    for k, v := range attrs {
        out = out.With(k, v)
    }
    return out
}
```

Without the recursive constraint, `Compose` would have to return an interface and the caller would lose the `UserMock` type.

### Trade-off

In real frameworks, the build-up is often heterogeneous: different attributes have different types, and the chain must produce different intermediate types. Pure F-bounded polymorphism cannot express that. So most production mock builders use **codegen** (mockery) instead of generics. Generic recursive constraints work for the simplest mocks but lose to codegen for the complex cases.

---

## Case study: fluent query builders

SQL builders like `squirrel`, `goqu`, and `bun` provide fluent APIs:

```go
q := db.NewSelect().
    Model(&users).
    Where("age > ?", 18).
    OrderBy("name ASC").
    Limit(10)
```

For each method to return the same builder type (so the chain keeps the concrete `SelectBuilder` methods), the underlying interface uses recursive bounds:

```go
type Where[B any] interface {
    Where(cond string, args ...any) B
}
type Order[B any] interface {
    OrderBy(s string) B
}
type Limit[B any] interface {
    Limit(n int) B
}

// A real Select builder satisfies all three with B = *SelectBuilder.
```

When users compose generic helpers across builder types:

```go
func ApplyFilters[B Where[B]](b B, filters []Filter) B {
    for _, f := range filters {
        b = b.Where(f.Cond, f.Args...)
    }
    return b
}
```

This `ApplyFilters` works for **any** builder that has a `Where` method returning itself. That is the practical payoff.

### Why some libraries avoid generics

`bun` and `gorm` v2 use traditional method receivers without generic constraints. They prefer concrete builder types over generic helpers because:

1. The user-facing API is already type-safe through receiver methods
2. Generic helpers add complexity the average user does not need
3. Type inference for two-parameter F-bounds was unreliable before Go 1.21

So even where the pattern theoretically applies, library authors often skip it.

---

## Case study: ORMs (`ent`, `bun`, `gorm`)

ORMs need entity types to support common operations: clone, equality, primary key, etc. The temptation is:

```go
type Entity[E any] interface {
    Clone() E
    Equals(other E) bool
    PrimaryKey() any
}

func Save[E Entity[E]](db *DB, e E) error { ... }
func Refresh[E Entity[E]](db *DB, e E) (E, error) { ... }
```

In practice:

- **`ent`** uses **codegen**: every entity gets a generated typed CRUD client. No recursive generics needed.
- **`bun`** uses reflection and runtime tag parsing. No recursive generics.
- **`gorm`** uses reflection extensively. Generics are added on top in places, but the core is reflection-based.

The reason is that ORMs deal with **schema mapping**, which is inherently runtime. Recursive constraints don't help with column-to-field mapping. They only help with the surface-level method API, which most ORM users do not see directly.

### Where recursive bounds **do** appear in ORMs

Some thinner ORMs (e.g., experimental `pgxgen`-style libraries) use generic clients:

```go
type Repository[E any, ID comparable] interface {
    Find(id ID) (E, error)
    Save(e E) error
}
```

The constraint is not recursive here. But a `Cloner[E]` would help if the repository wanted to return defensive copies. In practice, ORM authors prefer adding a `Clone` method per entity over enforcing a recursive constraint.

---

## Case study: configuration and option builders

Functional options pattern is very common in Go:

```go
type Server struct{ ... }
type Option func(*Server)

func New(opts ...Option) *Server { ... }
```

This does **not** use recursive constraints — `Option` is a closure. But some authors prefer **builder-style** options for richer APIs:

```go
type ServerBuilder struct { /* fields */ }

func (b ServerBuilder) WithPort(p int) ServerBuilder    { b.port = p; return b }
func (b ServerBuilder) WithHost(h string) ServerBuilder { b.host = h; return b }
func (b ServerBuilder) Build() *Server                  { ... }
```

When you want to **share** builder helpers across multiple builders, recursive constraints come in:

```go
type ConfigBuilder[B any] interface {
    WithTimeout(d time.Duration) B
}

func ApplyTimeouts[B ConfigBuilder[B]](b B, timeouts map[string]time.Duration) B {
    for _, t := range timeouts {
        b = b.WithTimeout(t)
    }
    return b
}
```

In a microservice with five different config builders all having `WithTimeout`, this is genuine reuse. Without the recursive bound, the helper would lose the concrete builder type.

---

## Case study: domain-driven aggregates

In DDD, aggregates produce events:

```go
type Aggregate[A any] interface {
    Apply(event Event) A
}
```

`Apply` returns the aggregate's own type so subsequent calls can use aggregate-specific methods. A test helper:

```go
func ReplayEvents[A Aggregate[A]](initial A, events []Event) A {
    cur := initial
    for _, e := range events {
        cur = cur.Apply(e)
    }
    return cur
}
```

Without the recursive bound, `Apply` would return `Aggregate`, callers would assert, and the test fixture code would be uglier.

This is one of the cleanest real-world wins for F-bounded polymorphism in Go. Event sourcing libraries like `eventhorizon` and `goes` have started adopting this pattern in their generic helpers.

---

## Does the complexity pay off?

A blunt cost-benefit analysis from teams that have adopted recursive constraints:

### Benefits

- **Type-safe fluent APIs** without losing the concrete type
- **Generic helpers** that work across multiple builder types
- **Compile-time enforcement** that the method actually returns the receiver's type

### Costs

- **Onboarding** — junior engineers struggle with `[T C[T]]`
- **Compiler errors** — "T does not satisfy C[T]" can be cryptic
- **Inference limits** — explicit instantiation required in edge cases
- **Documentation overhead** — every public API needs an example
- **Refactoring friction** — changing the recursive interface breaks every implementer

### Verdict

For **library authors** building reusable abstractions across many builder types, recursive constraints are worth it. Examples: SQL builder libraries, mock framework helpers, event-sourcing kits.

For **application code**, recursive constraints are usually overkill. Plain receiver methods (each builder has its own `WithX`) are simpler and clearer.

The Go community has converged on a quiet consensus: **use recursive constraints sparingly, in libraries, with thorough examples**. Most application code should never see them.

---

## Migration patterns

If you have a non-recursive interface returning interface (the pre-generics style), you can migrate to a recursive bound:

### Before

```go
type Cloner interface {
    Clone() Cloner
}

func DupAll(xs []Cloner) []Cloner {
    out := make([]Cloner, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}
```

### After

```go
type Cloner[T any] interface {
    Clone() T
}

func DupAll[T Cloner[T]](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}

// Keep a non-generic adapter for old callers
func DupAllAny(xs []Cloner_compat) []Cloner_compat { ... }

type Cloner_compat interface { Clone() Cloner_compat }
```

The adapter keeps the old API alive while new code uses the generic version. This is the textbook **trickle migration**.

### Pitfalls during migration

1. **Type inference may surprise** — calls that used to compile may need explicit instantiation.
2. **Interface satisfaction differs** — the recursive `Cloner[T]` is satisfied differently from the non-generic `Cloner`. Some types may need a method tweak.
3. **Public API breakage** — exporting a recursive interface for the first time commits you to its method set forever.

### When to skip migration

If the existing `interface{}`-style code works and is not on a hot path, leave it alone. Migrating just for elegance is rarely worth the churn.

---

## Team-level guidelines

After observing teams adopt recursive constraints:

### Adoption phases

1. **Phase 0 — Forbidden.** Team is still learning basic generics.
2. **Phase 1 — Read-only.** Members can read code that uses recursive bounds but shouldn't write them.
3. **Phase 2 — Internal only.** Recursive bounds allowed in `internal/` packages, not in public APIs.
4. **Phase 3 — Library-grade.** Public APIs may use recursive bounds with documentation and examples.

Most teams stop at **Phase 2** and never reach Phase 3.

### Code review checklist

| Check | Why |
|-------|-----|
| Is the recursion necessary? | Often a non-recursive interface is enough |
| Does the method return T (not I[T])? | Otherwise the recursion is wasted |
| Are constraints named meaningfully? | `Cloner`, `Comparable`, `Builder` — not `C`, `D`, `B` |
| Does godoc include a worked example? | Required for public APIs |
| Is type inference reliable at all call sites? | Otherwise expect verbosity |
| Is the constraint stable? | Adding methods later breaks every implementer |

### Style guide excerpt

> 1. Recursive type constraints are allowed only after design review.
> 2. Public APIs using recursive bounds must have at least one godoc example.
> 3. Recursive constraints must have one method when possible.
> 4. Free functions, not methods, host operations using recursive constraints.
> 5. Prefer `cmp.Ordered` for primitives; use `Comparable[T]` only for domain types.

---

## Summary

Recursive type constraints have a **narrow but valuable** place in Go's professional codebase landscape. They appear most often in:

- **Test mocks** where builder chains must keep the concrete mock type
- **SQL and query builders** with composable `WhereX`, `OrderByX` methods
- **Event-sourcing aggregates** that apply events and return themselves
- **DDD entities** that expose `Clone` returning the concrete type

They appear rarely in:

- Plain ORMs (use codegen or reflection)
- Application code (use plain receiver methods)
- Logging, networking, file I/O (use ordinary interfaces)

The professional view of recursive constraints is **strategic, not tactical**. A working engineer must:

1. **Recognise the pattern** when reviewing third-party code.
2. **Use it sparingly** — only when the concrete type genuinely matters across the chain.
3. **Document with examples** — readers will not infer the meaning.
4. **Accept the verbosity** — `[T C[T]]` is the cost of doing business.
5. **Know the limits** — Go's compiler stops at one layer of self-reference.

Recursive constraints are a tool for the rare day when nothing else fits. The next file (`specification.md`) drills into the formal grammar that lets the whole pattern exist.
