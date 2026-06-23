# Type Inference — Optimization Guide

Type inference is a *language* feature, but it has measurable effects on developer experience, build times, and tooling. This document collects practical optimizations.

---

## Table of Contents
1. [What Inference Affects](#what-inference-affects)
2. [Reducing Call-Site Noise](#reducing-call-site-noise)
3. [When Explicit Arguments Speed Up Compilation](#when-explicit-arguments-speed-up-compilation)
4. [Tooling and IDE Performance](#tooling-and-ide-performance)
5. [Optimizing for Readers, Not Writers](#optimizing-for-readers-not-writers)
6. [Refactoring Patterns](#refactoring-patterns)
7. [Production Migration Tactics](#production-migration-tactics)
8. [Compile-Time Considerations](#compile-time-considerations)
9. [Runtime Cost: Spoiler, Zero](#runtime-cost-spoiler-zero)
10. [A Checklist Before Shipping a Generic API](#a-checklist-before-shipping-a-generic-api)

---

## What Inference Affects

Inference influences three things directly:

1. **Source-code length and noise.** Fewer brackets, shorter lines, less visual clutter.
2. **Compile time.** In rare cases, the compiler does extra work to attempt inference; explicit instantiation can shortcut this.
3. **Tooling responsiveness.** Hover, "go to definition", and autocomplete must compute inferred types.

It does *not* affect runtime performance, code size, or binary layout.

---

## Reducing Call-Site Noise

### Tactic 1: Anchor every type parameter

If `T` is only in the return, callers will always need `[T]`. Move `T` into an argument when possible.

```go
// Before — explicit always required.
func Empty[T any]() []T { return nil }

// After — caller can write Empty(0).
func Empty[T any](_ T) []T { return nil }
```

### Tactic 2: Use `~[]E` for slice-style helpers

```go
// Less convenient — rejects named slice types.
func Sum[E Number](s []E) E

// Friendlier — accepts named slice types and infers E.
func Sum[S ~[]E, E Number](s S) E
```

### Tactic 3: Push type parameters onto the receiver

When all methods of a struct share the same `T`, attach `T` to the struct.

```go
// Before — every call needs T.
func Get[V any](k string) V

// After — T pinned at construction.
type Cache[V any] struct{}
func (c *Cache[V]) Get(k string) V
```

### Tactic 4: Standardize on `cmp.Ordered`

Once available (Go 1.21+), prefer it over hand-rolled ordering constraints:

```go
import "cmp"
func Min[T cmp.Ordered](a, b T) T
```

### Tactic 5: Reorder type parameters for partial instantiation

If only one parameter is unsolvable from arguments, list it first:

```go
// Convert[Out, In any] — write Convert[float64](42).
// vs Convert[In, Out any] — would require Convert[int, float64](42).
```

---

## When Explicit Arguments Speed Up Compilation

In nearly all real codebases the compile-time difference between inferred and explicit calls is negligible. But there are pathological situations:

- **Very deep generic call chains.** When `Map(Map(Map(...)))` cascades, each level performs unification. Explicit instantiation can cut a few microseconds — usually not worth the readability cost.
- **Highly overloaded constraints.** If a constraint is a long union type, type-set computation runs more often. Naming and reusing the constraint type helps the compiler cache results.
- **Generated code.** Generators emit thousands of generic calls. Pre-instantiating once is faster than letting the compiler infer at every call site.

For performance-conscious teams: profile your build with `go build -p 1 -x` and `GODEBUG=gctrace=1`. If a hot module rebuild is dominated by generic inference, switching that module to explicit instantiation is reasonable.

---

## Tooling and IDE Performance

`gopls` performs inference on the fly to power hover and autocomplete. Things that help:

- **Stay on the latest gopls.** Inference improvements ship regularly.
- **Avoid extremely large constraint unions** in public APIs — gopls must enumerate the type set.
- **Prefer named constraints over inline ones** — the resolved type set is cached.

In large monorepos, hover lag on generic calls is a common complaint. Three remedies:

1. Upgrade Go and gopls.
2. Split very-large generic packages into smaller ones.
3. Use explicit instantiation in the most-edited files.

---

## Optimizing for Readers, Not Writers

A subtle point: terser code is not always more readable. Inference can hide:

- **Numeric width.** `int` vs `int64` vs `float64` matters in pricing, accounting, and time math.
- **Domain types.** `UserID` vs `string`.
- **Pointer-ness.** `*User` vs `User`.

Tactics for reader-friendly inference:

- **Use named types** at API boundaries: `func Sum(prices Prices) Money`.
- **Add explicit instantiation in tutorials and READMEs.** Even if real call sites infer, examples for new readers benefit from explicit forms.
- **Comment the non-obvious.** A one-line comment beats a 30-minute debugging session.

```go
// Reduce starts with int64(0) so we don't truncate at large totals.
total := Reduce(events, int64(0), addCount)
```

---

## Refactoring Patterns

### Pattern: From explicit-only to fully inferred

Step 1. Identify the unanchored type parameter.
Step 2. Add a sentinel argument or move the parameter to a receiver.
Step 3. Update callers to pass the sentinel.

```go
// Before
func Build[T any]() T
v := Build[Order]()

// After
func Build[T any](_ T) T
v := Build(Order{})
```

### Pattern: From single-parameter to slice + element

```go
// Before
func Sum[E Number](xs []E) E
type Salaries []float64
total := Sum([]float64(Salaries{1, 2})) // ugly cast

// After
func Sum[S ~[]E, E Number](xs S) E
total := Sum(Salaries{1, 2}) // clean
```

### Pattern: From package-level generics to type-bound methods

```go
// Before
func Get[K, V any](c *Cache, k K) V

// After
type Cache[K, V any] struct{}
func (c *Cache[K, V]) Get(k K) V
```

### Pattern: From custom Ordered to cmp.Ordered

```go
// Before
type Ordered interface { ~int | ~float64 | ~string }
func Min[T Ordered](a, b T) T

// After
import "cmp"
func Min[T cmp.Ordered](a, b T) T
```

---

## Production Migration Tactics

### Phase 1: Audit
Run `gopls` "Show inferred types" or `go vet` to identify unnecessary explicit type-argument lists. List the top 10 most common inferred-type call sites.

### Phase 2: Deduplicate constraints
Identify constraints duplicated across files. Promote them into a shared internal package.

### Phase 3: Adopt standard library
- Replace hand-rolled `Ordered` with `cmp.Ordered`.
- Replace ad-hoc slice helpers with `slices` package.
- Replace map utilities with `maps` package.

### Phase 4: Lock in inference contracts
- Add `Example` tests for every public generic function.
- Run them in CI.

### Phase 5: Document
- Update README to advertise inferred call forms.
- Add a `MIGRATION.md` for users coming from older versions.

---

## Compile-Time Considerations

Inference performance scales roughly with:
- Number of type parameters.
- Depth of constraint type sets.
- Recursion depth in unification.

In practice none of these dominate a real Go build. CGO, large vendor trees, and link time always matter more. Profile before optimizing.

If you do hit a build-time hot spot:
1. Use `go build -p 1 -gcflags='-m=2'` to see compile-time diagnostics.
2. Look for very-deep generic call chains.
3. Reduce them by splitting into helper functions or pre-instantiating once.

---

## Runtime Cost: Spoiler, Zero

Inference is purely compile-time. After instantiation, the compiler emits the same code it would have emitted from explicit instantiation. There is no runtime dispatch, no boxing introduced by inference itself, no extra allocations.

Where runtime cost *can* arise is:
- Choosing `any` for `T` — boxing all values.
- Letting inference pick `interface{}` because you passed `any` literals — same.
- Using `~T` constraints that force conversions in tight loops — usually negligible, but profile.

These are constraint and instantiation choices, not inference choices.

---

## A Checklist Before Shipping a Generic API

Use this list when you are about to publish a generic helper:

- [ ] Every type parameter is anchored in an argument or on a receiver.
- [ ] The slice form uses `~[]E` if it should accept named slice types.
- [ ] Ordering constraints use `cmp.Ordered` (Go 1.21+).
- [ ] At least one `Example` test pins the canonical inferred call.
- [ ] The doc comment shows an inferred call.
- [ ] The minimum Go version is documented.
- [ ] `staticcheck` reports zero generic-related warnings.
- [ ] A representative caller compiles cleanly without explicit type-argument lists.
- [ ] Numeric defaults (e.g., `int` from `0`) are documented or pinned via `int64(0)` etc.
- [ ] You have considered partial instantiation order (`Cast[Out, In any]`).
- [ ] You have an `examples_test.go` or compile-only test that locks the inference contract.
- [ ] If your library targets Go 1.18, you have tested without 1.21 inference improvements.

---

## Closing Notes

Type inference is not free of cost in design effort — it must be earned through careful API shape. The reward is libraries that feel native, code reviews that focus on logic instead of syntax, and migrations that simplify rather than complicate. Optimize for the reader, the maintainer, and the toolchain — in that order.
