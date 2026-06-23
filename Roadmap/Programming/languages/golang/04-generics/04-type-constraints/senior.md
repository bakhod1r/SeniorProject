# Type Constraints — Senior Level

## Table of Contents
1. [Overview](#overview)
2. [Architecting Constraint Hierarchies](#architecting-constraint-hierarchies)
3. [`comparable` Semantics — Pre-1.20 vs 1.20+](#comparable-semantics-pre-120-vs-120)
4. [When a Constraint Is Too Restrictive](#when-a-constraint-is-too-restrictive)
5. [When a Constraint Is Too Loose](#when-a-constraint-is-too-loose)
6. [Constraint Composition Strategies](#constraint-composition-strategies)
7. [Reusable Constraint Packages](#reusable-constraint-packages)
8. [Constraints in Public APIs](#constraints-in-public-apis)
9. [The Subtle Cost of Method Elements](#the-subtle-cost-of-method-elements)
10. [Constraint Inference and Diagnostics](#constraint-inference-and-diagnostics)
11. [Code Examples](#code-examples)
12. [Patterns](#patterns)
13. [Anti-Patterns](#anti-patterns)
14. [Architecture Case Studies](#architecture-case-studies)
15. [Summary](#summary)

---

## Overview

At the senior level the question stops being "how do I write a constraint?" and becomes **"how do I design a system of constraints that scales across a large codebase, survives Go version changes, and stays usable for the next engineer?"**

We assume you already know:
- All forms of type elements (`int`, `~int`, unions).
- The difference between basic and general interfaces.
- The contents of `golang.org/x/exp/constraints`.
- How to combine method elements and type elements.

Now we examine constraint **design** as a software-architecture concern.

---

## Architecting Constraint Hierarchies

### The pyramid

In a mature library, constraints form a small inverted pyramid:

```
                any
                 │
            comparable
                 │
             Ordered
            ┌─┴─┐
        Numeric  ~string
        ┌─┴─┐
    Integer Float
       │      │
   Signed,  (just floats)
   Unsigned
```

Concrete observations:
- The top is `any` and `comparable` — built in.
- The middle is `Ordered`, `Integer`, `Float` — `x/exp/constraints`.
- The bottom is **your domain layer**: `Money`, `Latency`, `BytesPerSec`.

### The layering rule

A higher-layer constraint must be **at least as permissive** as the layers below it. Concretely:
- `Numeric` ⊆ `Ordered` (every numeric is ordered, but not every ordered is numeric — strings are ordered but not numeric).
- `Integer` ⊆ `Numeric`.
- `Signed` ⊆ `Integer`.

If you accidentally invert the hierarchy (a "deeper" constraint accepts a type the "shallower" one rejects), refactor immediately — it always indicates a misnamed type.

### Hierarchy in code

```go
package mypkg

import "golang.org/x/exp/constraints"

// Layer 0: re-exports for convenience and future-proofing.
type Integer = constraints.Integer
type Float   = constraints.Float
type Ordered = constraints.Ordered

// Layer 1: domain-shaped composites.
type Numeric interface { Integer | Float }

// Layer 2: domain-specific shapes.
type Money interface { ~int64 }            // monetary amount in cents
type Duration interface { ~int64 }         // nanoseconds
type Bytes interface { ~int64 }            // file/payload size

// Layer 3: combined where it makes sense.
type Quantity interface { Money | Duration | Bytes }
```

When a function says `func F[T Quantity](x T)`, the reader instantly knows the domain. Compare with `func F[T ~int64](x T)` which conveys nothing.

---

## `comparable` Semantics — Pre-1.20 vs 1.20+

This is the single most important Go-version detail at the senior level.

### Pre-Go 1.20 behaviour

`comparable` matched **only types whose values can be compared with `==` without panicking**. That excluded:
- `any` / `interface{}` (because the dynamic type might be non-comparable).
- Any interface containing a method element only (it would always be value-storable, so the dynamic type was unknown).

Concretely, this code **failed to compile** before 1.20:

```go
type Set[T comparable] map[T]struct{}

s := Set[any]{}                       // ❌ pre-1.20 error: any is not comparable
```

### Go 1.20 expansion

Go 1.20 [relaxed `comparable`](https://go.dev/blog/comparable) so that interface types — including `any` — also satisfy it. The comparison can still **panic at runtime** if the dynamic types are non-comparable (e.g., comparing two `any` values that hold slices).

After 1.20:

```go
s := Set[any]{}                       // ✅ compiles
s[[]int{1}] = struct{}{}              // ✅ compiles
// At runtime: panic: hash of unhashable type []int
```

### What changed in practice

- Library authors can now write `K comparable` for cache keys and accept `any` keys without breaking generics-only callers.
- The trade-off is moved from compile-time to runtime — you have to trust the caller not to pass slices through the `any` channel.
- `strict comparable` is sometimes called the pre-1.20 behaviour; some libraries provide their own narrower `StrictComparable` constraint to recover it.

### When you want strict comparability

If you absolutely must reject non-comparable dynamic types at compile time, you cannot do it with `comparable` alone in Go 1.20+. Instead, narrow the constraint to a type element union:

```go
type StrictComparable interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 | ~complex64 | ~complex128 |
        ~string | ~bool
}
```

This excludes interfaces and structs but accepts the comparable primitives. For most production cases this is overkill; document the panic risk and move on.

---

## When a Constraint Is Too Restrictive

Symptoms:
1. Users wrap a type and your function refuses it. → You forgot `~`.
2. You can only sum signed integers but want unsigned too. → Replace `Signed` with `Integer`.
3. The constraint mentions `string` but rejects `[]byte`. → Add `~[]byte` if your function works on either.
4. Method element is too specific. `MarshalJSON()` excludes types that have `MarshalText()`. → Reshape the constraint or split the function.

### The "narrow now, widen later" trap

Saying "we can always widen later" is technically true but practically painful: widening a constraint changes the type set, which can change overload resolution and code generation. Better to start permissive and narrow only when the implementation forces it.

---

## When a Constraint Is Too Loose

Symptoms:
1. The function accepts `any` but immediately type-asserts to `[]byte`. → The constraint should be `~[]byte`.
2. You catch invalid types with `panic`. → Move the check into the constraint.
3. `comparable` is used but `==` is never called. → Drop to `any`.
4. The function works for `string` but you accept `Ordered`. → Are you sure? If you only need lexicographic order, `~string` is fine. If you need numeric comparison too, keep `Ordered`.

### Examples of looseness

```go
// LOOSE — any allows nil, slices, channels, anything.
func Sum[T any](xs []T) T {
    var total T
    for _, x := range xs {
        total = total.(int) + x.(int) // ❌ runtime panic city
    }
    return total
}

// TIGHT — constrain to what you actually need.
func Sum[T constraints.Integer | constraints.Float](xs []T) T { ... }
```

---

## Constraint Composition Strategies

### Strategy 1: Layered union

```go
type A interface { ~int }
type B interface { ~string }
type AorB interface { A | B }
```

### Strategy 2: Intersection by embedding

```go
type A interface { ~int }
type B interface { String() string }
type Both interface { A; B }
```

### Strategy 3: Parameterised constraint via a type parameter

You cannot write `interface { ~T }` where `T` is itself a type parameter — Go does not allow type parameters in constraint position recursively. But you can sidestep by accepting both:

```go
func Both[A constraints.Integer, B constraints.Float](a A, b B) (A, B) {
    return a, b
}
```

### Strategy 4: Adapter constraints

When two libraries define overlapping but not identical constraints, write an adapter:

```go
import (
    libA "github.com/x/a"
    libB "github.com/x/b"
)

type Common interface {
    libA.Numeric | libB.Numeric  // ❌ not allowed if both are general interfaces
}
```

Actually that fails: you cannot union two general interfaces directly. The fix is to redeclare the union explicitly:

```go
type Common interface {
    ~int | ~int64 | ~float64 // restate the elements you need
}
```

Or use intersection:

```go
type Common interface {
    libA.Numeric
    libB.Numeric
}
```

The intersection includes only types in both sets — usually the right choice for adapter scenarios.

---

## Reusable Constraint Packages

When constraints span multiple packages, factor them out:

```
mymodule/
├── constraints/
│   └── constraints.go   # all reusable constraints live here
├── pkg1/
│   └── ...
├── pkg2/
│   └── ...
```

`mymodule/constraints/constraints.go`:

```go
package constraints

import xc "golang.org/x/exp/constraints"

type (
    Integer = xc.Integer
    Float   = xc.Float
    Signed  = xc.Signed
    Unsigned = xc.Unsigned
    Complex  = xc.Complex
    Ordered  = xc.Ordered
)

type Numeric interface { Integer | Float }
type Hashable interface { Integer | Float | ~string | ~bool }
```

Other packages now import `mymodule/constraints` and get the whole suite. If `x/exp` ever moves into the standard library, you swap the import in one place.

### Naming conventions

- Plural? Singular? Project style. Go standard library would prefer singular: `constraint`, but `constraints` is the established name.
- Avoid generic names like `types` — too easy to confuse with type definitions.
- Use a short alias when importing: `import xc "mymodule/constraints"`.

---

## Constraints in Public APIs

When you expose generic functions and types in a published library, your constraints become part of your **stable API surface**. Treat them as such:

1. **Document the type set.** Even a one-line comment listing example types prevents 80% of confusion.
2. **Avoid breaking changes.** Narrowing a constraint is breaking; widening is not. Plan for widening.
3. **Stay independent of `x/exp` if you can.** It's stable but technically not 1.0; some downstream users avoid it.
4. **Don't expose unexported constraints in exported function signatures** — the compiler allows it but readers can't see the rule.
5. **Consider providing constraint type aliases for callers** so they can re-use them: `type Numeric = mypkg.Numeric`.

### Versioning constraint changes

| Change | Breaking? |
|--------|-----------|
| Adding a new type to a union | Backward compatible (more types accepted) |
| Removing a type from a union | Breaking |
| Adding a method element | Breaking (existing types may not have the method) |
| Removing a method element | Backward compatible |
| Adding `~` | Backward compatible |
| Removing `~` | Breaking |
| Renaming the constraint | Breaking; provide an alias |

---

## The Subtle Cost of Method Elements

A constraint with **only** type elements lets the compiler emit straight-line code: `+`, `<`, `==` map to machine instructions on the underlying type.

A constraint with a **method element** forces the compiler to generate a method dispatch — even though it's monomorphized, the function call sits between operations. In hot loops, this matters.

```go
type Pure interface { ~int | ~float64 }       // straight-line
type WithMethod interface { ~int; M() string } // method dispatch on M
```

Profile-driven decision: if your constraint has a method element and the function is called in a tight loop, consider:
1. Splitting the constraint: pure type-element generic for the hot path, method-element generic for the cold path.
2. Calling the method outside the loop and passing a captured value.
3. Using a function callback rather than a method element: `func(T) string` instead of `String() string`.

---

## Constraint Inference and Diagnostics

Type inference for constraints is fragile in some cases. Senior-level techniques:

### Always specify constraints explicitly when authoring

```go
// ✅ Clear — caller and reader know exactly what's expected
func Min[T constraints.Ordered](xs []T) T { ... }
```

### Help the compiler when inference fails

If users see "cannot infer T", the cause is usually that `T` only appears in a return type or in an interface argument. Refactor or instruct callers to write `Min[int](xs)`.

### Read constraint mismatch errors carefully

Go's error messages for constraint mismatches mention the type set; learn to read them:

```
foo.go:10:5: int does not satisfy constraints.Float (~int missing in ~float32 | ~float64)
```

The `(~int missing in ~float32 | ~float64)` is the diagnostic. Match the type set in the constraint.

---

## Code Examples

### Example 1: Two-level constraint with version-resilient alias
```go
package geom

import "golang.org/x/exp/constraints"

type Coord interface {
    constraints.Float
}

type Pt[T Coord] struct{ X, Y T }

func Add[T Coord](a, b Pt[T]) Pt[T] { return Pt[T]{a.X + b.X, a.Y + b.Y} }
```

### Example 2: Strict-comparable workaround for pre-1.20-style behaviour
```go
type StrictComparable interface {
    ~bool |
        ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 |
        ~complex64 | ~complex128 |
        ~string
}

type SafeMap[K StrictComparable, V any] struct {
    data map[K]V
}
```

### Example 3: Inversion test
```go
// Are these in the right order?
type Numeric interface { Integer | Float }    // wider
type Integer interface { Signed | Unsigned }  // narrower
// ✅ Wider sits on top — good.
```

### Example 4: Adapter constraint
```go
package adapters

type LibAOrdered interface { ~int | ~float64 | ~string }
type LibBOrdered interface { ~int64 | ~float64 | ~string }

type Common interface {
    LibAOrdered
    LibBOrdered
}
// Type set: ~float64 | ~string  (intersection of the two sets)
```

### Example 5: Method-element-aware fast path
```go
type FastNumeric interface { ~int | ~float64 }
type SlowNumeric interface { FastNumeric; String() string }

func SumFast[T FastNumeric](xs []T) T {
    var t T
    for _, x := range xs { t += x }
    return t
}

func SumLogged[T SlowNumeric](xs []T, log func(string)) T {
    var t T
    for _, x := range xs {
        log(x.String())
        t += x
    }
    return t
}
```

### Example 6: Re-exported constraints in your module
```go
package myconstraints

import xc "golang.org/x/exp/constraints"

type (
    Integer = xc.Integer
    Float   = xc.Float
    Ordered = xc.Ordered
    Signed  = xc.Signed
    Unsigned = xc.Unsigned
    Complex  = xc.Complex
)

type Numeric interface { Integer | Float }
```

### Example 7: Constraint as documentation
```go
// Money is the constraint for currency types.
//
// Type set: int64 and any defined type whose underlying type is int64.
// Examples: USD, EUR, BTCSatoshi.
type Money interface { ~int64 }
```

### Example 8: Public API checklist
```go
// Package collections provides type-safe containers.
//
// Constraints exposed publicly:
//   - Hashable (for keys)
//   - Ordered  (for sorted containers)
//
// We re-export from golang.org/x/exp/constraints so callers don't depend on it directly.
package collections

import xc "golang.org/x/exp/constraints"

type Hashable interface {
    xc.Integer | xc.Float | ~string | ~bool
}

type Ordered = xc.Ordered
```

### Example 9: Avoid the "infinite constraint" trap
```go
// BAD — forces every caller to satisfy ALL of these
type Everything interface {
    ~int
    ~string                 // intersection — empty!
    Comparable() bool
}
// No type can be both ~int and ~string. The constraint is unsatisfiable.
// The compiler accepts the declaration but rejects every type argument.
```

### Example 10: Constraint that forces a phantom type
```go
// Phantom Tag, used purely at the type level, never dispatched on.
type Tag any
type Tagged[T any, _ Tag] struct{ Value T }

type UserID Tag
type OrderID Tag

func main() {
    var u Tagged[int, UserID]
    var o Tagged[int, OrderID]
    _ = u
    _ = o
    // u and o have distinct types — the compiler will not let you assign one to the other.
}
```

This is a senior-level pattern: using constraints as **brand markers** to enforce type identity at the API boundary even when the underlying representation is identical.

---

## Patterns

### Pattern 1: Promote x/exp constraints via type aliases
Always re-export `constraints.Integer` etc. through your own package. This insulates you from a future move into the standard library or a rename.

### Pattern 2: Two-tier constraint
Top tier (your library's surface): `Numeric`, `Hashable`. Bottom tier (implementation detail): the underlying x/exp set. Callers depend on the top, you depend on the bottom.

### Pattern 3: Constraint follows naming
A constraint named `Ordered` should imply `<` works. Don't put `Ordered` in front of a type set that lacks ordering. Tie names to operations.

### Pattern 4: Constraint per behavior, not per type
"Hashable" is a behavior. "IntOrString" is types. Prefer behavior names; they survive type-set changes.

### Pattern 5: Brand types
Use empty constraints to mark distinct types that share a representation. Useful for security tokens, IDs, units of measure.

---

## Anti-Patterns

1. **Re-deriving `Ordered` in every package.**
2. **Using `comparable` as a synonym for `Ordered`.**
3. **Hand-rolling a copy of `constraints.Integer` and missing `~uintptr`.**
4. **Forgetting `~` in a constraint that appears in a public API.**
5. **Adding a method element "in case we need it later".**
6. **Building a hierarchy where deeper constraints are wider than shallower ones.**
7. **Putting two unrelated semantics into one constraint.**
8. **Embedding a method-only interface as if it were a type element.**

---

## Architecture Case Studies

### Case Study A — Telemetry SDK

A telemetry library accepts metrics of any numeric kind: counters (uint64), gauges (float64), timing (Duration). The team designed:

```go
type Metric interface {
    ~uint64 | ~float64 | ~int64
}

type Counter[T constraints.Unsigned] struct{ ... }
type Gauge[T constraints.Float] struct{ ... }
type Timing[T ~int64] struct{ ... }
```

The general constraint `Metric` is exposed for users who want a single API surface; the more specific constraints back the typed primitives. Users start with the general, narrow as they specialize.

### Case Study B — Distributed Cache

A team built `Cache[K, V]`. Initial constraint: `K comparable`. Users on Go 1.19 hit the strict-comparable wall when passing `any` keys; users on Go 1.20+ hit runtime panics on slice keys. They added:

```go
type SafeKey interface {
    ~string | ~int | ~int64 | ~uint | ~uint64
}

type Cache[K SafeKey, V any] struct { ... }
```

Trade-off: lost the ability to use struct keys, but gained guaranteed safety from non-comparable dynamic types.

### Case Study C — DSL Builder

A query builder used a constraint to encode "anything that can appear in a SELECT clause":

```go
type Selectable interface {
    Column | Aggregate | Literal
}
```

Where `Column`, `Aggregate`, `Literal` are interfaces over user-defined types. The DSL's type safety comes entirely from the constraint hierarchy.

---

## Summary

At senior level, constraint design is a software architecture activity, not a coding-trick activity. Build a small hierarchy that mirrors your domain. Re-export from `x/exp/constraints` to insulate your code. Understand the Go 1.20 `comparable` change cold — it affects compile-time vs runtime safety. Prefer permissive over restrictive constraints. Avoid mixing method elements and type elements unless both are necessary. Treat constraints as part of your stable API surface and version them accordingly.
