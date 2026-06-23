# Type Inference — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Patterns: When Explicit Beats Inferred](#production-patterns-when-explicit-beats-inferred)
3. [Library-Author Guidance](#library-author-guidance)
4. [Team Conventions for Generics and Inference](#team-conventions-for-generics-and-inference)
5. [Case Study 1: standard library `slices` package](#case-study-1-standard-library-slices-package)
6. [Case Study 2: `cmp.Ordered` and Sorting](#case-study-2-cmpordered-and-sorting)
7. [Case Study 3: Iterators (Go 1.23+) and Inference](#case-study-3-iterators-go-123-and-inference)
8. [Case Study 4: How 1.21 Improvements Reshaped a Real Codebase](#case-study-4-how-121-improvements-reshaped-a-real-codebase)
9. [Migration Strategies Across Go Versions](#migration-strategies-across-go-versions)
10. [Designing Public APIs With Inference Contracts](#designing-public-apis-with-inference-contracts)
11. [Tooling: Linters, IDE, and CI Considerations](#tooling-linters-ide-and-ci-considerations)
12. [Risk Management: Silent Inference Regressions](#risk-management-silent-inference-regressions)
13. [Performance Considerations at Scale](#performance-considerations-at-scale)
14. [Documentation and Examples](#documentation-and-examples)
15. [Common Production Pitfalls](#common-production-pitfalls)
16. [Summary](#summary)

---

## Introduction

At professional level the focus is on operating generic Go in production: shipping libraries used by other teams, evolving APIs across Go versions without breaking callers, codifying team conventions, and managing the long tail of inference-related issues that show up only at scale. This document collects the patterns, guidance, and case studies you need to do that well.

---

## Production Patterns: When Explicit Beats Inferred

Inference is a default, not a mandate. There are real cases where being explicit pays off:

### Case 1: Wide-impact constructors
A constructor that returns a typed object should usually receive the type as an explicit instantiation. This is what users will see in code search, in tutorials, and in stack traces.

```go
cache := NewCache[*User]() // explicit T is documentary
```

### Case 2: Numeric defaults that bite
```go
total := Reduce(events, 0, addCount) // 0 is int by default — surprise if you wanted int64.
total := Reduce[Event, int64](events, 0, addCount) // explicit, safe.
```

### Case 3: Re-exported helpers
A package that re-exports `Map`/`Filter`/`Reduce` from `slices` should provide explicitly-typed helpers if its callers will not have generics in scope:
```go
func MapStrings(in []string, f func(string) string) []string {
    return slices.Map(in, f) // hypothetical
}
```

### Case 4: Public test fixtures
Test helpers used across packages should not depend on inference quirks:
```go
func MustGet[T any](t *testing.T, c *Cache[T], key string) T { /* ... */ }

want := MustGet[*User](t, cache, "u-1") // explicit, robust to refactor
```

### Case 5: Generated code
Code generated from templates should always use explicit instantiation. Generators do not benefit from terseness, and explicit forms are easier to grep for.

---

## Library-Author Guidance

### 1. Treat inference as part of the API contract

Your `go doc` output shows the function signature with type parameters. Your example test fixes the canonical call site. Both are public surfaces. Document inference behaviour:

```go
// Map returns a new slice of the same length whose elements are produced by
// applying f to each element of s.
//
// Type parameters T and U are inferred at the call site:
//
//   strs := Map([]int{1,2,3}, strconv.Itoa)
//
// Requires Go 1.21 or later for inference to work with named functions.
func Map[T, U any](s []T, f func(T) U) []U
```

### 2. Pin a `go.mod` directive

If your library relies on 1.21 inference behaviour, declare `go 1.21` in `go.mod` and document it in the README. Users on older toolchains will see compile errors with a clear hint.

### 3. Curate your constraints

A constraint named `Number` in your package becomes part of your public API. Choose carefully; reuse rather than redefine; export rarely.

```go
package math
type Number interface {
    ~int | ~int64 | ~float32 | ~float64
}
```

### 4. Write `Example` tests that lock inference

```go
func ExampleSum() {
    fmt.Println(math.Sum([]int{1, 2, 3, 4}))
    // Output: 10
}
```

If the example fails to compile because inference broke, CI catches it.

### 5. Provide explicit aliases for hot types

If 80% of your users will call `Sum` with `[]int64`, add:
```go
func SumInt64(xs []int64) int64 { return Sum(xs) }
```

This shrinks the call site and avoids accidental defaulting.

---

## Team Conventions for Generics and Inference

A typical team convention document lists:

1. **Default position**: prefer inference where the inferred type is unambiguous and correct.
2. **Always explicit** at:
   - Public API boundaries.
   - Test helpers.
   - Generated code.
   - Constructors of typed containers.
3. **Add a comment** whenever explicit instantiation is required:
   ```go
   // We must specify [int64] because the literal 0 would default to int.
   total := Reduce[Event, int64](events, 0, count)
   ```
4. **Prefer named slice types in domain code**, with `~[]E`-style helpers in the generic utility layer.
5. **Treat constraint changes as breaking changes**, even if the call site still happens to compile.
6. **Run `go vet` and `staticcheck`** in CI; both catch a number of generic-API mistakes.
7. **Set a minimum Go version** of 1.21 or later for new modules.

---

## Case Study 1: standard library `slices` package

Go 1.21 added `slices` to the standard library. Its design is a masterclass in inference-friendly APIs.

```go
package slices

func Index[S ~[]E, E comparable](s S, v E) int { /* ... */ }
func Contains[S ~[]E, E comparable](s S, v E) bool { /* ... */ }
func Sort[S ~[]E, E cmp.Ordered](s S) { /* ... */ }
func Equal[S1, S2 ~[]E, E comparable](s1 S1, s2 S2) bool { /* ... */ }
```

Notes:
- Every function uses the `~[]E` pattern so named slice types are accepted.
- `cmp.Ordered` standardizes the ordering constraint.
- All functions infer fully without explicit brackets:
  ```go
  i := slices.Index(words, "go")  // inferred
  slices.Sort(prices)             // inferred
  ok := slices.Equal(a, b)        // inferred
  ```

The decision to expose `S` as a type parameter is deliberate: it lets `Sort` operate on `type IDs []int` without conversions and *preserves* the named type at the call site.

---

## Case Study 2: `cmp.Ordered` and Sorting

Before Go 1.21, you had to write your own ordering constraint:

```go
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 | ~string
}
```

Each library copied this. Go 1.21 added `cmp.Ordered`. Now:

```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}

Min(3, 5)         // T = int
Min(3.0, 5.0)     // T = float64
Min("a", "b")     // T = string
```

The lesson: when the standard library publishes a constraint, switch to it. This standardizes inference behaviour across third-party libraries and makes errors easier to diagnose.

---

## Case Study 3: Iterators (Go 1.23+) and Inference

Go 1.23 introduced range-over-function. It interacts with generics:

```go
func Filter[T any](src iter.Seq[T], pred func(T) bool) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range src {
            if pred(v) && !yield(v) { return }
        }
    }
}

// Caller:
for v := range Filter(slices.Values([]int{1,2,3}), func(x int) bool { return x > 1 }) {
    fmt.Println(v)
}
```

`T = int` infers through `iter.Seq[T]` from `slices.Values([]int{...})`. The iterator world makes inference even more important — explicit `iter.Seq[int]` annotations are verbose.

---

## Case Study 4: How 1.21 Improvements Reshaped a Real Codebase

A team maintaining an internal data-pipeline library reported the following before/after when upgrading from Go 1.20 to 1.21:

**Before (1.20)**:
```go
out := pipeline.Map[Order, Receipt](orders, formatReceipt)
errs := pipeline.Filter[error](errors, isCritical)
totals := pipeline.Reduce[Receipt, int64](receipts, 0, addCount)
```

**After (1.21)**:
```go
out := pipeline.Map(orders, formatReceipt)
errs := pipeline.Filter(errors, isCritical)
totals := pipeline.Reduce(receipts, int64(0), addCount)
```

Observations:
- 60% reduction in call-site characters.
- The `int64(0)` cast in `Reduce` is the team's convention for pinning the accumulator type — explicit to the reader.
- The `Map` call benefited from 1.21's improved function-shape unification: in 1.20, `formatReceipt`'s signature did not unify cleanly without instantiation.

The team also introduced a pre-commit check: run `gofmt` plus `staticcheck`, which flagged unnecessary type-argument lists left over from the migration.

---

## Migration Strategies Across Go Versions

### Strategy A: Forward only
- Bump `go.mod` to 1.21+.
- Remove redundant `[T]` brackets opportunistically.
- Run `go vet`; address warnings.

### Strategy B: Compatibility window
- Maintain support for 1.20 in a separate branch.
- Use explicit instantiation in code that must work in both.
- Hold off on adopting 1.21-only inference shapes until the floor moves.

### Strategy C: Vendored shim
- Provide both `Sum(xs)` (inferred) and `SumExplicit[T](xs)` for legacy code.
- Once the floor moves, remove the explicit form.

### Tools
- `gopls` provides "remove redundant type parameters" code action.
- `staticcheck` SA1029-style checks help detect type-argument lists that can be inferred.
- Custom `analysis.Analyzer` plugins can enforce team rules ("explicit at boundaries, inferred internally").

---

## Designing Public APIs With Inference Contracts

A "inference contract" is the implicit promise that callers can write `Foo(x)` instead of `Foo[T](x)`. It is part of your public API.

### Rules for stable inference contracts
1. Do not add new type parameters that lack argument anchors.
2. Do not narrow existing constraints in patch releases.
3. Do not reorder existing type parameters.
4. Do not change the underlying core type a constraint exposes (e.g. switching from `~[]E` to `~[]int`).
5. Do publish examples (`ExampleFoo`) that exercise the canonical inferred form.

### Treating inference as an SLA
Some teams formalize inference as an SLA:
- The function `Map(s, f)` must compile without explicit instantiation when `s` is `[]T` and `f` is `func(T) U`.
- Breaking that contract requires a major version bump.

This sounds extreme, but it correctly elevates inference to the same status as backward-compatible serialization formats.

---

## Tooling: Linters, IDE, and CI Considerations

### `gopls`
- Quick fix: "remove unnecessary type arguments".
- Hover: shows the inferred types for generic calls.
- Code action: convert explicit to inferred and vice versa.

### `staticcheck`
- Catches obvious mistakes like unused type parameters.
- Warns about redundant constraints.

### `go vet`
- Reports a small set of generics issues.

### Custom CI checks
- Compile a `examples_test.go` against multiple Go versions.
- Build with `-gcflags=-G=3` historically; today simply use the `go` directive.

### IDE behaviour
- VSCode and GoLand show inferred types inline.
- Hovering a generic call should display the inferred substitution. If your IDE lags, an upgrade is usually the fix.

---

## Risk Management: Silent Inference Regressions

A signature change that *still compiles* but causes inference to pick a different type is a real risk.

```go
// v1
func Get[T any](key string) T { /* ... */ }
v := Get("k") // FAILS to infer — caller writes Get[int]("k").

// v2: maintainer adds a sentinel
func Get[T any](key string, _ T) T { /* ... */ }
// Old call sites Get[int]("k") now fail to compile (arity mismatch).
// New call sites Get("k", 0) infer T = int.
```

This is a *breaking change* even though it added inference capability. Document it as such.

### Mitigations
- Treat any signature touch as ABI-relevant.
- Maintain a `compat_test.go` that verifies the canonical call form still compiles.
- Use semver: signature touches go in a major.

---

## Performance Considerations at Scale

Inference itself is free at runtime. But the design choices that *enable* inference can affect performance:

- `~T` constraints permit named types but do not pessimize performance.
- Generic instantiation may produce one shape per type or per "GC shape" (Go's stenciling vs dictionary-based approach). Inference does not change which path the compiler picks.
- Heavy generic code increases compile time noticeably; inference does not, but the generics it enables do.

For latency-sensitive code, consider:
- Specialized non-generic implementations on hot paths.
- `go:generate` tooling to materialize specialized versions.
- Profiling with `-gcflags=-m` to ensure inlining still happens through generic call sites.

---

## Documentation and Examples

A good generic API ships with:

1. A doc comment that shows an inferred call.
2. At least one `ExampleFoo` that exercises the canonical inferred call.
3. A note about the minimum Go version.
4. A note about constraint shapes (e.g., "accepts named slice types via `~[]E`").

Example doc comment:
```go
// Sum returns the total of the elements of s.
//
// Inferred call:
//
//   total := Sum([]int{1, 2, 3})
//
// Sum accepts any named slice whose underlying element type is a Number.
func Sum[S ~[]E, E Number](s S) E
```

---

## Common Production Pitfalls

### Pitfall 1: Reduce with literal zero
```go
total := Reduce(events, 0, addCount) // 0 → int, but you wanted int64.
```
Fix: `int64(0)` or `Reduce[Event, int64](events, 0, addCount)`.

### Pitfall 2: Generic assertion utility eats interface{}
```go
func MustBe[T any](x any) T { return x.(T) }
v := MustBe[string]("ok") // explicit T because no argument carries it.
```

### Pitfall 3: API change cascades through callers
A new constraint addition can propagate through layers. Maintain integration tests at the *outermost* call site.

### Pitfall 4: Cross-version inconsistency
A library compiled with 1.21 inferring through `func(T) U` will not compile under 1.20 callers. Either bump the floor or downgrade the API.

### Pitfall 5: Untyped string literal interaction
```go
func Concat[T ~string](a, b T) T { return a + b }
type Slug string
var s Slug = "hi"
Concat(s, "world") // 1.21+: T = Slug, "world" representable. OK.
                    // Earlier versions: could fail.
```

### Pitfall 6: Exported generics in internal packages
Internal generics that leak through interface boundaries cause surprising inference at the API surface. Keep generic boundaries close to where the types are known.

### Pitfall 7: Reflect-based wrappers around generic functions
`reflect.MakeFunc` and similar techniques cannot recover inferred type parameters. Plan ahead.

---

## Summary

In production, type inference is a feature you *operate*. It needs documentation, tests, version-pinning, lint rules, and team conventions. Designed well, it produces APIs that read like ordinary Go and feel friction-free. Designed poorly, it produces APIs that subtly break when constraints tighten or when callers mix typed and untyped values. The standard library since Go 1.21 — `slices`, `maps`, `cmp` — sets the bar: every public function is fully inferable from natural call sites, every constraint is named and reused, and every change is treated as part of the public contract. Aim for the same in your own libraries.
