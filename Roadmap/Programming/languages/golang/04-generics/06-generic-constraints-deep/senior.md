# Generic Constraints Deep Dive — Senior Level

## Table of Contents
1. [Type set algebra](#type-set-algebra)
2. [Intersection in practice](#intersection-in-practice)
3. [Empty type sets — when they happen, when to fix](#empty-type-sets-when-they-happen-when-to-fix)
4. [`comparable` post Go 1.20](#comparable-post-go-120)
5. [Designing reusable constraint hierarchies](#designing-reusable-constraint-hierarchies)
6. [Self-bounded constraints](#self-bounded-constraints)
7. [Exported vs unexported constraints](#exported-vs-unexported-constraints)
8. [Anti-patterns](#anti-patterns)
9. [Summary](#summary)

---

## Type set algebra

A senior engineer thinks of constraints as **sets** and reasons about them with set algebra. Three operations matter:

| Operation | Notation | Effect on type set |
|-----------|----------|--------------------|
| Union | `A \| B` (within a single type element) | Sum of sets |
| Intersection | Multiple elements / lines / embeds | Product of sets |
| Complement | (not available in Go) | — |

### Union

```go
type C interface { int | string }
// Type set: {int, string}
```

### Intersection

```go
type C interface {
    ~int | ~float64    // {Numeric defined types}
    Stringer           // {types implementing String()}
}
// Type set: defined-int-or-float64 types that also implement String()
```

The two elements are intersected: a type satisfies `C` only if it is in **both** sets.

### No complement

You cannot say "any type that is not a slice". This omission is deliberate — negative constraints would explode in complexity. The workaround is to enumerate positively: `~int | ~string | ~bool | ...`.

### Reasoning by inclusion

A useful rule: if `A`'s type set is a subset of `B`'s, then `A` is **stricter** than `B`. Functions accepting `B` accept everything `A` does.

```go
type Stricter interface { ~int }
type Looser   interface { ~int | ~float64 }

func F[T Stricter](v T) {}
func G[T Looser](v T) {}
```

`F` accepts only `~int` types. `G` accepts those plus `~float64` types. Anything `F` accepts, `G` also accepts. **Loosening** a constraint is backward-compatible for callers; **tightening** is not.

---

## Intersection in practice

Practical uses of intersection:

### 1. Restricting `comparable` to a numeric subset

```go
type ComparableNumeric interface {
    comparable
    ~int | ~float64
}
```

This is unusual — `~int` and `~float64` are already comparable. The intersection is redundant but legal. Linters may flag it.

### 2. Combining shape and behaviour

```go
type IDStringer interface {
    ~int64
    String() string
}
```

Common in domain code where IDs are int64 under the hood but expose a string form for logs.

### 3. Composing standard constraints

```go
import "cmp"

type OrderedHashable interface {
    cmp.Ordered
    Hash() uint64
}
```

A type must be ordered **and** have a `Hash` method. Useful in cache or partitioning code.

### 4. Layering from a base

```go
type Identifiable interface { ID() int64 }
type NamedIdentifiable interface {
    Identifiable
    Name() string
}
type AuditedNamedIdentifiable interface {
    NamedIdentifiable
    CreatedAt() time.Time
    UpdatedAt() time.Time
}
```

Each layer adds one or two methods. A function constraining `[T AuditedNamedIdentifiable]` knows it can call `ID()`, `Name()`, `CreatedAt()`, `UpdatedAt()`. This is exactly the embedding pattern you already know from regular interfaces.

---

## Empty type sets — when they happen, when to fix

An **empty** type set is the intersection of incompatible elements:

```go
type Impossible interface { int; string }
// Intersection: {int} ∩ {string} = {}
```

The compiler accepts this; it does not flag it. But:

- No type can satisfy the constraint.
- A function `func F[T Impossible]()` compiles but cannot be instantiated.
- A type `Foo[T Impossible]` compiles but cannot be used.

### Why does Go allow it?

The Go team chose to allow empty type sets because:

1. They are easy to detect with linters (`SA9009`, `staticcheck`).
2. Banning them would require complex compile-time set arithmetic.
3. They sometimes arise transiently during refactoring; rejecting them would make refactors painful.

### How they sneak in

```go
type Numeric interface { ~int | ~float64 }
type Stringer interface { String() string }

type Wrong interface {
    Numeric
    Stringer
    ~int     // this is intersected too
    ~string  // intersect again — boom
}
```

The intersection `~int ∩ ~string` is empty. The intersected type set is empty. The function that uses `Wrong` will compile but be useless.

### Detecting them

- `staticcheck` flags empty type sets with `SA9009`.
- Manual inspection: read the constraint top-down. Each line is an "and". If two lines mention disjoint type sets, the result is empty.
- A unit test that calls the function with at least one type catches the problem.

### Fixing them

- Remove the redundant or contradictory element.
- Use union (`|`) instead of intersection if you meant "or".
- Split into two functions if the use cases really are disjoint.

---

## `comparable` post Go 1.20

`comparable` is the most subtle constraint in Go. Its behaviour changed materially in **Go 1.20**.

### The original (1.18 - 1.19) rule

> A type `T` satisfies `comparable` if and only if `T` is **strictly comparable** — meaning `==` is well-defined for every value of `T`.

This excluded:

- `interface{}` and other interface types (their dynamic value might be a slice/map/func)
- Types containing those interfaces

So this **did not** compile in 1.18:

```go
func Eq[T comparable](a, b T) bool { return a == b }

type Box struct { v any }
Eq(Box{1}, Box{1}) // ❌ in 1.18-1.19 — Box contains an interface
```

This was a significant ergonomic problem. Many real-world types (anything with an `interface{}` field, or `any` in a struct) were excluded from `comparable`.

### The Go 1.20 change

The Go 1.20 release notes (`https://go.dev/doc/go1.20#language`) document the change:

> Comparable types (such as ordinary interfaces) may now satisfy `comparable` constraints, even if the type arguments are not strictly comparable (because interfaces that are not type parameters are comparable but are not strictly comparable). This makes it possible to instantiate a type parameter constrained by `comparable` (e.g., `T comparable`) with a non-strictly comparable type argument, such as an interface type or a composite type containing an interface type.

In plain English:

- **Before 1.20:** `comparable` accepts only strictly-comparable types. Interfaces are excluded.
- **From 1.20:** `comparable` also accepts types whose comparison **may panic at runtime**.

### Concrete consequence

Go 1.20+:

```go
type Box struct { v any }
Eq(Box{1}, Box{1}) // OK — but may panic if v is non-comparable
Eq(Box{[]int{1}}, Box{[]int{1}}) // panic at runtime
```

The compile-time check is **looser**, the runtime is **risk-bearing**. This is the "looser comparable" trade-off.

### Why the team made this change

1. **Practicality** — too many real-world types were excluded.
2. **Consistency** — pre-1.20, `map[any]int` worked but `map[T]int` (where `T comparable` and instantiated with `any`) did not. The asymmetry was confusing.
3. **Migration** — existing code using `map[any]int` could not be converted to generic equivalents without contortions.

### What this means for your code

- Treat `comparable` as **"compile-time ok, may-panic at runtime"** when used with interface-bearing types.
- Add `recover()` if you take untrusted types as `comparable` parameters.
- Document the runtime risk in public APIs.

```go
// Eq compares two values for equality.
// If T is or contains an interface type whose dynamic value is
// not comparable (slice, map, func), this will panic at runtime.
func Eq[T comparable](a, b T) bool { return a == b }
```

### Migration tip

If your code targets Go ≤ 1.19, the looser behaviour is unavailable. The compatibility note: code written for Go 1.20+ with `comparable` may **not** compile under 1.18-1.19 if it depends on the loosening.

---

## Designing reusable constraint hierarchies

A senior engineer thinks of constraints as a **public API** — even when they are unexported. A constraint commits you to a contract that callers and instantiators rely on.

### Principles

1. **Loose first, tight later.** It is easier to tighten a constraint internally than to loosen it for callers.
2. **Name by intent, not by shape.** `Numeric` is better than `IntsOrFloats`.
3. **Embed, do not duplicate.** If two constraints share a base, factor the base out.
4. **One constraint, one purpose.** Avoid `BigConstraint` that demands eight unrelated things.
5. **Use stdlib first.** `comparable`, `cmp.Ordered` cover most cases; do not reinvent them.

### Layered hierarchy example

```go
// Layer 0 — predeclared
//   any
//   comparable

// Layer 1 — stdlib
//   cmp.Ordered

// Layer 2 — domain numeric (your package)
type Integer interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr
}

type Float interface {
    ~float32 | ~float64
}

type Numeric interface {
    Integer | Float
}

// Layer 3 — domain types
type Money interface { Numeric; Currency() string }
type Quantity interface { Integer; Unit() string }
```

Each layer composes the previous. `Money` is `Numeric` plus a `Currency()` method. `Quantity` is `Integer` plus a `Unit()` method. The chain is clean and easy to teach.

### Anti-pattern: the giant union

```go
// ❌ Don't
type Everything interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
    ~float32 | ~float64 |
    ~string | ~bool |
    ~[]byte | ~[]rune |
    ~complex64 | ~complex128
}
```

This says "any built-in type", which is essentially `any` plus restrictions. Such a constraint betrays unclear intent. If you really mean "any built-in scalar", embed `cmp.Ordered` plus what's missing — but think hard about whether the function should not just be `[T any]` with smaller specialised helpers internally.

### Anti-pattern: the constraint with twelve methods

```go
// ❌ Don't
type RichEntity interface {
    ID() int64
    Name() string
    CreatedAt() time.Time
    UpdatedAt() time.Time
    DeletedAt() *time.Time
    Owner() string
    Tags() []string
    Validate() error
    Save(ctx context.Context) error
    Delete(ctx context.Context) error
    Permissions() []Permission
    Audit() AuditTrail
}
```

A constraint with twelve methods is a smell. It tightly couples generic helpers to a specific entity type. Either:

- The function only really needs three of those methods → narrow the constraint.
- The function needs all twelve → it is not really generic; it is specific to one entity.

---

## Self-bounded constraints

Sometimes a type parameter must reference itself in its constraint. This is the **self-bounded type parameter** (also called the "F-bound" pattern from Java/Scala):

```go
type Less[T any] interface {
    LessThan(other T) bool
}

func Min[T Less[T]](a, b T) T {
    if a.LessThan(b) { return a }
    return b
}
```

Read carefully: `T` must satisfy `Less[T]` — that is, `T` must have a `LessThan(other T) bool` method.

### Why is this needed?

Because the method's parameter type **depends** on `T`. A non-self-bounded version cannot express it:

```go
type Less interface {
    LessThan(other ?) bool  // ? = self type
}
```

The `?` is exactly what type parameters give us.

### Concrete usage

```go
type Money struct { Amount int; Currency string }
func (m Money) LessThan(other Money) bool {
    if m.Currency != other.Currency { panic("currency mismatch") }
    return m.Amount < other.Amount
}

cheap := Min(Money{Amount: 100, Currency: "USD"}, Money{Amount: 200, Currency: "USD"})
```

`Money` satisfies `Less[Money]`. The compiler infers `T = Money` from the call site.

### When to use it

- Sortable / comparable domain types where built-in `<` is not enough.
- Mathematical structures (group, ring, monoid) where operations take "self" parameters.
- Builder-style APIs where every method returns the receiver type.

### When to avoid it

- When `cmp.Ordered` does the job. Self-bounding is a strong commitment for callers.
- When the constraint becomes unreadable. `func F[T A[T], U B[T, U]]` is hard.

---

## Exported vs unexported constraints

A constraint declared at package scope is part of the public API if exported. Decisions:

### Export when

- The constraint expresses a **stable** contract callers rely on.
- The function is **public** and you want its constraint to be reusable.
- Multiple packages need the same constraint shape.

### Keep unexported when

- The constraint is implementation-specific.
- The constraint is likely to change.
- The function is internal or intended for one package only.

```go
// Exported — part of the API
type Ordered interface {
    cmp.Ordered
}

func Sort[T Ordered](s []T) { ... }

// Unexported — implementation detail
type indexable interface {
    ~[]E
}
type E any

func index[T indexable](s T, i int) E { return s[i] }
```

### The "private constraint, public function" pattern

A surprising trick: you can use an unexported constraint on a public function:

```go
type sortable interface { ~int | ~float64 | ~string }

func Sort[T sortable](s []T) { ... }
```

Callers can use `Sort` with any allowed type but cannot **name** the constraint. This is a way to keep the public API surface small while still being type-safe. The downside: callers cannot easily build their own constraint hierarchies on top of yours.

---

## Anti-patterns

### Anti-pattern 1 — Reinventing `cmp.Ordered`

```go
// ❌
type MyOrdered interface {
    ~int | ~float64 | ~string
}
```

Use `cmp.Ordered` (Go 1.21+). It is the canonical, well-tested, and lint-friendly choice.

### Anti-pattern 2 — Constraint that is a runtime interface in disguise

```go
// ❌
type C interface {
    Read(p []byte) (int, error)
    Write(p []byte) (int, error)
    Close() error
}

func F[T C](v T) { ... }
```

If the constraint contains only methods (no type elements), generics buy you very little over a regular interface argument. Use `func F(v io.ReadWriteCloser)` instead. Generics here add ceremony without value.

### Anti-pattern 3 — Mixing structural and behavioural in a confusing way

```go
// ❌
type Confusing interface {
    ~int | string         // mixes ~int with bare string
    Stringer
}
```

Read it carefully: the union `~int | string` admits any defined int **or** the predeclared `string`. The intersection with `Stringer` adds the method requirement. This compiles, but readers cannot easily reason about which types qualify. Prefer:

```go
type DefinedInts interface { ~int }
type Strings interface { ~string }
type Stringy interface { Stringer; DefinedInts | Strings }
```

(The last line uses an embedded union — a Go 1.18 feature.)

### Anti-pattern 4 — Tightening a public constraint

```go
// v1
type C interface { ~int | ~float64 }

// v2
type C interface { ~int }   // ❌ breaks every caller using float
```

Tightening is **always** a breaking change. Loosening is safe. Plan accordingly.

### Anti-pattern 5 — Constraint whose body relies on hidden type knowledge

```go
type Numeric interface { ~int | ~float64 }

func DoubleIfPositive[T Numeric](v T) T {
    switch any(v).(type) { // ❌ runtime type switch on T
    case int:
        if v > 0 { return v * 2 }
    case float64:
        if v > 0 { return v * 2 }
    }
    return v
}
```

If you need a type switch on `T`, the abstraction is wrong. Either factor into per-type helpers or use an interface.

---

## Summary

A senior view of constraints centres on **set algebra** and **API discipline**:

1. **Constraints are sets**; reason with union, intersection, and inclusion.
2. **Empty type sets compile but are useless**; lint for them.
3. **`comparable` is looser since 1.20** — compile-time accept, runtime panic possible.
4. **Hierarchies should be small, layered, and reuse stdlib** primitives.
5. **Self-bounded constraints** unlock methods that take "self" parameters but are heavy on readers.
6. **Unexported constraints** are a valid tool for shrinking the API surface.
7. **Tightening is a breaking change**; design loose first.

The right constraint is the one that **says what the body needs and no more**. Bigger is not safer; smaller is.

Move on to `professional.md` for migration patterns, the `golang.org/x/exp/constraints` story, and constraint API design in real libraries.
