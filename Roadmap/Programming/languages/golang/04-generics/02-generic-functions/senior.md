# Generic Functions — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architectural Impact](#architectural-impact)
3. [Building Generic Libraries](#building-generic-libraries)
4. [Flexibility vs Simplicity](#flexibility-vs-simplicity)
5. [`~int` vs `int` — Approximation Decisions](#int-vs-int-approximation-decisions)
6. [The Cost of Over-Parameterization](#the-cost-of-over-parameterization)
7. [Generics and Reflection](#generics-and-reflection)
8. [Runtime Overhead — GC Shape Stenciling](#runtime-overhead-gc-shape-stenciling)
9. [Specialization and Inlining](#specialization-and-inlining)
10. [Backwards Compatibility](#backwards-compatibility)
11. [Documentation Strategy](#documentation-strategy)
12. [Architecture Patterns](#architecture-patterns)
13. [Code Review Checklist (Senior)](#code-review-checklist-senior)
14. [Tricky Questions](#tricky-questions)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

Senior engineering is about **trade-offs**, not features. By now you can write generic functions; the senior question is **when not to**, and **how the resulting library fits into a larger system**.

In this file we cover:
- Architectural consequences of introducing generics into a codebase
- How to design a small but useful generic library
- The hidden runtime cost of generic functions in Go
- How generics interact with `reflect` and serialization layers
- Concrete heuristics for choosing between a generic helper, a non-generic helper, and an interface

---

## Architectural Impact

When you turn a function generic, three things happen architecturally:

### 1. The blast radius of changes increases

Any change to a generic helper used in 50 places affects 50 places. With a non-generic `func SumInts([]int) int` only `int` callers care about a signature change. A `func Sum[T Numeric](xs []T) T` change touches every numeric caller.

**Heuristic:** Make a function generic only after at least two real callers exist with different concrete types.

### 2. Compile time grows

Every distinct instantiation produces a copy of the function body in object code (modulo GC shape sharing — see below). On a large codebase with hundreds of generic helpers and dozens of types, this is measurable.

In practice, a service with 50K LOC sees compile-time growth of 5-15% after broadly adopting generics. Usually acceptable, but worth tracking.

### 3. The API surface shape changes

`Sum[T Numeric](xs []T) T` is a different *kind* of API than `SumInts([]int) int` — it expresses intent ("a sum of any numeric") rather than a specific operation. This invites callers to use it more liberally, which can be good (less boilerplate) or bad (forcing developers to mentally instantiate).

---

## Building Generic Libraries

A small generic library should follow these rules:

### Rule 1: Define your constraints in one place

```go
// constraints/constraints.go
package constraints

type Signed interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64
}
type Unsigned interface {
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr
}
type Integer interface { Signed | Unsigned }
type Float interface { ~float32 | ~float64 }
type Ordered interface { Integer | Float | ~string }
```

(Most of this is now in `cmp.Ordered` and `golang.org/x/exp/constraints` — use those when available.)

### Rule 2: Group helpers by domain, not by type

`slicesx`, `mapsx`, `numx`, `chansx` — not `intx`, `stringx`, `userx`.

### Rule 3: Keep the surface area small

If you find yourself writing `MapToInt`, `MapToString`, `MapToFloat`, you've gone too far. Map should be one function with two type parameters.

### Rule 4: Provide unboxed and boxed versions when needed

```go
// Most common path
func Map[T, U any](xs []T, f func(T) U) []U

// Error-aware path
func MapErr[T, U any](xs []T, f func(T) (U, error)) ([]U, error)

// Don't pre-emptively add MapCtx — wait until a real caller needs it
```

### Rule 5: Don't expose internals via type parameters

```go
// Bad
func Process[State any, Result any](initial State, ...) Result

// Good — make State internal
type processor[Result any] struct { ... }
func Process[Result any](...) Result
```

### Rule 6: Document the constraint, not the syntax

```go
// Sum returns the sum of all values in xs.
//
// T may be any signed or unsigned integer or floating point type
// (anything implementing constraints.Numeric). Sum returns the zero
// value of T for an empty slice.
func Sum[T constraints.Numeric](xs []T) T { /* ... */ }
```

---

## Flexibility vs Simplicity

A generic function is more flexible than a non-generic one — by definition. But flexibility has a cost: **every reader must understand the parameter list before they can read the function body**.

### When simpler wins

```go
// Used only by money calculations
func SumPrices(items []Item) Cents {
    var total Cents
    for _, it := range items { total += it.Price }
    return total
}
```

This is **clearer** than:

```go
func Sum[T Numeric](xs []T) T { /* ... */ }
total := Sum(SliceMap(items, func(it Item) Cents { return it.Price }))
```

The second form is more reusable but also more code at the call site.

### When generics win

```go
// Used 30 times across 12 packages with different element types
func Filter[T any](xs []T, pred func(T) bool) []T { /* ... */ }
```

Writing 12 specialized versions would be silly.

### The 3+ rule

A pragmatic rule of thumb: **generalize after the third specialized version**. Once you have `FilterUsers`, `FilterOrders`, and `FilterEvents` all doing the same thing, replacing them with `Filter[T]` is the right call.

---

## `~int` vs `int` — Approximation Decisions

The `~` token means "any type whose **underlying** type is X." This is one of the most consequential design decisions in a generic constraint.

### Use `~int` when

- Callers may have **defined types** like `type Cents int` and you want to support them.
- You operate purely on the value via arithmetic (`+`, `<`, etc.) — those work on the underlying.
- You want **maximum reusability**.

### Use `int` (no tilde) when

- You want to **prevent** callers from passing arbitrary defined types.
- The behavior depends on identity, not just shape (rare for primitives).
- You're enforcing a contract: "this function accepts only the standard integer."

### Real example

```go
type UserID int

// Probably wrong — accepts UserID and arbitrary other defined ints
func Add[T ~int](a, b T) T { return a + b }

// Probably right — adds two values of the same defined type
type Cents int
func AddCents(a, b Cents) Cents { return a + b }
```

The first form is too permissive. The second is type-safe and self-documenting.

**Rule:** When in doubt, omit `~`. Add it once a caller actually needs it.

### Test your constraint

Try to instantiate with several defined types. If only `int`/`float64` should be allowed, drop `~`. If `Cents`, `UserID`, etc. should also work, keep `~`.

---

## The Cost of Over-Parameterization

Each type parameter adds cognitive load. Three or more is rare; five is almost certainly wrong.

### Smell: many type parameters

```go
// Suspicious
func Pipeline[A, B, C, D, E any](
    in A,
    f1 func(A) B, f2 func(B) C, f3 func(C) D, f4 func(D) E,
) E {
    return f4(f3(f2(f1(in))))
}
```

Better:

```go
func Compose2[A, B, C any](f func(A) B, g func(B) C) func(A) C {
    return func(a A) C { return g(f(a)) }
}

// Usage:
process := Compose2(Compose2(Compose2(f1, f2), f3), f4)
```

Or just use a slice-of-functions approach with `any`.

### Smell: type parameters that aren't used

```go
func Bad[T any, U any](x T) T { return x } // U is unused — drop it
```

The compiler may not warn here — your reviewer should.

### Smell: type parameter for something not type-driven

```go
// Bad — config is just data
func Run[C Config](cfg C) error
```

If `Config` is a single concrete type, drop the parameter.

---

## Generics and Reflection

Generics and `reflect` coexist but interact in surprising ways.

### `reflect.TypeOf` returns the **runtime** type

```go
func TypeName[T any](x T) string {
    return reflect.TypeOf(x).String()
}

TypeName(42)          // "int"
TypeName[any](42)     // "int" — note: not "any", because the value's runtime type is int
```

This means a generic function instantiated with `any` boxes its argument and `reflect.TypeOf` reports the boxed type, not `T`.

### Type parameters are **not** preserved at runtime

You cannot write:

```go
func ConstructorByType[T any]() T {
    // there's no way at runtime to ask "what type was T instantiated as?"
    // unless you have a value of type T.
    var z T
    return z
}
```

`reflect.TypeOf((*T)(nil)).Elem()` does work to recover the type, since the pointer-to-T is a known type at the call site:

```go
func TypeOf[T any]() reflect.Type {
    var z T
    return reflect.TypeOf(&z).Elem()
}

TypeOf[int]() // int
```

### Interaction with `encoding/json`

`json.Marshal[T](x T)` would be redundant — `json.Marshal` already takes `any`. Adding type parameters does not give you a free typed Unmarshal:

```go
// Convenient wrapper
func Unmarshal[T any](data []byte) (T, error) {
    var v T
    err := json.Unmarshal(data, &v)
    return v, err
}

p, err := Unmarshal[Person](data) // typed result without manual var declaration
```

This **is** a useful pattern — it compresses the typical `var v Person; json.Unmarshal(data, &v)` boilerplate.

---

## Runtime Overhead — GC Shape Stenciling

Go does **not** generate one machine-code copy per type argument. It uses **GC shape stenciling**:

- Types with the same memory layout for the GC (same size, same pointer locations) share **one** compiled body.
- The shared body receives a hidden **dictionary** parameter that supplies type-specific information at runtime.

### What does this mean in practice?

| Type argument | GC shape | Body |
|----------------|----------|------|
| `int`, `int64` (on 64-bit) | same shape | shared body |
| `string` | shape | unique body |
| `*Foo`, `*Bar` | same shape (single pointer) | shared body |
| `struct{X int}` | shape | unique body |

The dictionary look-up costs roughly **one extra indirect call or pointer load** per generic operation. For most code this is below noise, but on hot loops calling small generic functions you may see 5-10% overhead vs hand-specialized code.

### Implications

- Calling `min(a, b)` from `cmp.Ordered` is ~as fast as a specialized `min` in nearly all cases.
- Calling a generic function inside a hot inner loop **may** be slower than copy-pasting the type-specific body. Benchmark before reaching for generics.
- For pointer-typed elements, sharing means one body — even better cache locality.

We benchmark this in `optimize.md`.

---

## Specialization and Inlining

The Go compiler will inline generic functions at the call site when:
- The function is small (under the inliner's budget)
- The instantiation is used only at this site (or the body is otherwise inlinable)

But:
- Generic dictionaries can sometimes prevent inlining
- Methods on generic types are harder to inline because they may go through an interface table

If a hot path is slow, check `go build -gcflags='-m'` to see what the inliner is doing.

```sh
go build -gcflags='-m -m' ./... 2>&1 | grep -i inline
```

If the generic helper is not inlining and the work it does per call is tiny (one comparison, one load), consider a non-generic specialization for that hot path.

---

## Backwards Compatibility

Once a generic function is exported, **everything** about it becomes part of the API:

- The type parameter list (number, names, order)
- The constraints
- The order of regular parameters
- The return signature

Some changes are non-breaking:
- Loosening a constraint (`int` → `~int`)
- Adding a method to a constraint **interface** (might break if consumers rely on type sets)
- Adding a new generic function

Most changes are breaking:
- Renaming type parameters? Not breaking (callers don't reference them by name) — but renaming is still a code-review concern.
- Tightening a constraint? Breaking.
- Reordering type parameters? Breaking.
- Adding a new type parameter? Breaking, even with a default — Go has no defaults.

### `v2` migration

If you must change a generic signature, prefer a `Foo` → `FooV2` rename and deprecate `Foo`. Avoid silent semantic changes.

---

## Documentation Strategy

Generic signatures are dense. Compensate with extra docs.

```go
// Map applies f to each element of xs and returns a new slice
// containing the results in the same order. The output slice has
// length len(xs).
//
// T is the input element type. U is the output element type.
//
// Example:
//
//   nums := []int{1, 2, 3}
//   strs := Map(nums, strconv.Itoa) // ["1", "2", "3"]
//
// Time:  O(n)
// Space: O(n)
func Map[T, U any](xs []T, f func(T) U) []U
```

Things to mention:
- What each type parameter represents
- A runnable example
- Time/space complexity
- Empty-input behavior

---

## Architecture Patterns

### Pattern: Functional core, generic edge

Keep your **business logic** non-generic and centered on domain types. Use generics at the **edges** — utilities, transformers, adapters.

```
┌─────────────────────────┐
│   Generic helpers       │  Map, Filter, Reduce, ...
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│   Domain logic          │  func processOrder(o Order) Result
└─────────────────────────┘
```

Domain logic should rarely touch a type parameter. Helpers should rarely touch a domain type.

### Pattern: Phantom type parameters for safety

You can use a generic function whose type parameter is purely informational:

```go
type Token[Scope any] string

type ReadScope struct{}
type WriteScope struct{}

func Authorize[S any](t Token[S], req *http.Request) bool { /* ... */ }

func Read(t Token[ReadScope], r *http.Request)  { /* ... */ }
func Write(t Token[WriteScope], r *http.Request) { /* ... */ }
```

Now the compiler enforces that a write-scope token is only used in `Write`. This is a **phantom type** — the type parameter is never stored as a real value but it constrains usage at compile time.

### Pattern: Generic interface adapters

```go
type Repository[T any] interface {
    Get(ctx context.Context, id string) (T, error)
    Save(ctx context.Context, x T) error
}

func Cached[T any](r Repository[T]) Repository[T] {
    return &cachedRepo[T]{inner: r, cache: make(map[string]T)}
}
```

Adding cross-cutting behavior (caching, logging, retries) to any repository in one place.

---

## Code Review Checklist (Senior)

- [ ] Is generalization justified by ≥2 real call sites with different types?
- [ ] Is the constraint as tight as the use case requires?
- [ ] Is `~T` used intentionally, not by reflex?
- [ ] Is the function name still readable after generalization?
- [ ] Does the doc comment include an example?
- [ ] Are tests parameterized over multiple instantiations?
- [ ] Does the function avoid `reflect` (or document why it needs it)?
- [ ] Have you measured impact on compile time for large packages?
- [ ] Can a junior engineer read the signature and understand it within 30 seconds?

---

## Tricky Questions

**Q1.** A function takes 90% of the time in a benchmark. After generalizing it, the benchmark slows by 8%. What's likely?
**A.** The dictionary lookup or a missed inline. Re-specialize the hot path.

**Q2.** Why are pointer types more likely to share a generic body?
**A.** All pointers have the same GC shape (single word, scannable), so the compiler emits one body and uses the dictionary to discriminate.

**Q3.** A team wants `Sum[T ~int | ~float64]` but encounters errors when callers use `time.Duration` (whose underlying is `int64`). What's wrong?
**A.** `time.Duration`'s underlying is `int64`, not `int`. Add `~int64` to the constraint.

**Q4.** Why might inlining be worse for generic methods than generic functions?
**A.** Methods may go through interface tables when called via an interface, which the inliner cannot see through. Direct calls usually inline normally.

**Q5.** Is `func Hash[T any](x T) uint64` a good API?
**A.** Probably not. Hashing requires knowing how to access bytes — without a constraint, you'd fall back to `reflect`. Either constrain to `~[]byte | ~string` or drop generics.

---

## Cheat Sheet

```go
// Architectural rules
- Generalize after the 3rd specialized copy
- Group helpers by domain (slicesx, mapsx)
- Keep constraint definitions in one place
- Document examples and complexity in doc comments

// Performance rules
- Same-shape types share one body (GC shape stenciling)
- Generic call adds ~1 extra indirect access (dictionary)
- For hot loops over int/float, specialize and benchmark
- Watch inliner output: go build -gcflags='-m -m'

// Constraint design
- Use ~T only when defined types should be allowed
- Compose constraints: type Numeric interface { Integer | Float }
- Reach for cmp.Ordered (Go 1.21+) instead of hand-rolled

// API stability
- All of the signature is part of the API
- Loosen rather than tighten constraints over time
- Use FooV2 rather than silent breaking changes
```

---

## Summary

Senior decisions about generic functions revolve around **trade-offs**: more flexibility but more cognitive load, slightly slower hot paths but less duplication, more powerful libraries but stricter API contracts. The best generic code at this level looks unremarkable — it solves a real problem, has tight constraints, and lives in a small, focused helper package. The worst generic code is over-parameterized, under-documented, and tries to be clever where a regular function would do.

[← middle.md](./middle.md) · [professional.md →](./professional.md)
