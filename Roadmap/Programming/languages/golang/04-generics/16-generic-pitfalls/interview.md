# Generic Pitfalls — Interview Q&A

## How to use this file

Each question has a **short answer** and a **long answer**. Use the short version in interviews; expand to the long answer when prompted. The questions are arranged by difficulty.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. How do you produce the zero value of a type parameter `T`?
**Short:** `var zero T` or `*new(T)`.

**Long:** `T{}` is rejected because `T` may not be a struct/slice/array/map type. Both `var zero T` and `*new(T)` are always valid; `var zero T` is the idiomatic choice.

### Q2. Are `any` and `interface{}` the same?
**Short:** Yes. `any` is a predeclared alias for `interface{}` since Go 1.18.

**Long:** They are interchangeable. New code prefers `any`. Mixing them in one file is fine semantically but ugly stylistically.

### Q3. Why does `T{}` not compile inside `func F[T any]`?
**Short:** Composite literals require a struct, array, slice, or map underlying type. `T any` does not guarantee that.

**Long:** The Go spec restricts composite literals to specific kinds. Until `T` is instantiated, the compiler cannot prove the underlying type is appropriate, so it rejects the syntax conservatively.

### Q4. How do you type-switch on a value of type `T`?
**Short:** Convert through `any` first: `switch any(v).(type) { ... }`.

**Long:** Type switches and type assertions require interface-typed expressions. `T` is a type parameter, not an interface. The conversion `any(v)` boxes the value (unless already pointer-shaped) and unlocks the type-switch syntax.

### Q5. Why does `v == nil` not compile for `T any`?
**Short:** `==` requires `comparable`, and `nil` requires a nilable type.

**Long:** `T any` has no operators. Even with `T comparable`, comparing to bare `nil` requires `T` to be a pointer, channel, function, slice, map, or interface — none of which is guaranteed.

### Q6. How do you check whether a value of type `T` is the zero value?
**Short:** Use `T comparable` and compare to `var zero T`.

**Long:** `func IsZero[T comparable](v T) bool { var zero T; return v == zero }`. Works for all comparable types in Go 1.20+ including interfaces. Fails to compile when `T` is a slice, map, or struct containing them.

### Q7. Name three pitfalls every junior hits in their first week.
**Short:** Zero value of `T`, `nil` checks, type switch on `T`.

**Long:** Plus mixing `any` and `interface{}` styles, and inference failures with multiple constraints. These five together account for the bulk of compile-time complaints in junior generic code.

### Q8. What does `any(v) == nil` return for a typed nil pointer?
**Short:** `false`. The interface value has a non-nil type tag.

**Long:** `var p *int = nil; any(p) == nil` is `false`. The interface holds the pair `(*int, nil)`. Comparing to bare nil compares the type tag, which is non-nil. This is the same gotcha that exists with `error` and typed-nil interfaces in non-generic code.

### Q9. Why does `cmp.Ordered` differ from `comparable`?
**Short:** `cmp.Ordered` allows `<`, `<=`, `>`, `>=`. `comparable` allows only `==` and `!=`.

**Long:** `cmp.Ordered` is the constraint for ordered types (int family, float family, string). `comparable` is the constraint for types usable with equality. Many beginners mix them up; the body's operations must match the constraint exactly.

### Q10. Are slices comparable?
**Short:** No. Only against `nil`.

**Long:** Slices, maps, and functions are not strictly comparable. A `Set[T comparable]` cannot have `T = []int`. The fix is to wrap the slice in a comparable representation (e.g., a string).

---

## Mid-level 🟡

### Q11. Why might you write `*new(T)` instead of `var zero T`?
**Short:** They are equivalent. Pick one and stick with it. `var zero T` is the idiomatic choice.

**Long:** `*new(T)` is sometimes shorter inline (`return *new(T)`) than `var zero T; return zero`. Some authors prefer it; the Go style guide does not. Functionally identical.

### Q12. What is wrong with this code?
```go
func IsNil[T any](v T) bool { return v == nil }
```
**Short:** `==` is not defined for `T any`, and `nil` cannot be compared to non-nilable types.

**Long:** `T` could be `int`, where `int == nil` is invalid. Tighten the constraint to `comparable` and a nilable kind, or rewrite as `IsZero[T comparable](v T) bool`.

### Q13. When is type-switch on `T` justified?
**Short:** Rarely — usually when adding a fast path for primitives in an otherwise generic function.

**Long:** A type switch on `T` indicates polymorphism (different behaviour per type). Polymorphism belongs to interfaces. The rare exception is an optimisation: e.g., `Marshal[T any]` adds fast paths for `[]byte` and `string` and falls back to JSON for everything else.

### Q14. Why might a generic function fail to inline when its hand-written equivalent succeeds?
**Short:** The inline cost estimator counts dictionary instructions and conservative escape decisions, pushing the body over the inline budget.

**Long:** Inlining decisions are based on estimated size. Generic bodies include implicit dictionary parameters and bookkeeping that hand-written bodies do not. The compiler may decide the body is too large to inline. Profile with `-gcflags=-m` to confirm.

### Q15. Why is `comparable` "looser" in Go 1.20+?
**Short:** Interface types now satisfy `comparable`, with a runtime panic possibility if their dynamic types are not comparable.

**Long:** Pre-1.20, interface types could not satisfy `comparable` because their dynamic types might be non-comparable. 1.20 relaxed this — interfaces satisfy `comparable` at compile time, with runtime panic risk. Useful in practice but a subtle pitfall.

### Q16. What is wrong with this constraint?
```go
type Numeric interface {
    ~int | ~float64
    Add(other Numeric) Numeric
}
```
**Short:** No primitive has `Add`. The type set is empty.

**Long:** The constraint requires the underlying type to be `int` or `float64` AND the type to have `Add`. Predeclared `int` and `float64` have no methods. Only named types with `Add` can satisfy. The constraint compiles but is essentially useless without explicit named types.

### Q17. How do you write a generic function that accepts both `T` and `*T`?
**Short:** You can't directly. Use two functions or the `Anything[T] = T | *T` trick.

**Long:** Generic dispatch in Go does not handle "value or pointer" cleanly. Common patterns: write `func F[T any](v T)` and `func FPtr[T any](p *T)`, or use a constraint `interface { *T | T }` (newer Go versions). Most teams pick one form by convention.

### Q18. Why does this fail?
```go
func Map[T, U any](f func(T) U) U {
    var t T
    return f(t)
}
m := Map(func(int) string { return "" })
```
**Short:** Inference does not deduce `T` and `U` purely from the function-typed parameter in older Go versions.

**Long:** Function-typed arguments confuse inference. Pre-1.21, the compiler often refused to infer through function shapes. Fix: `Map[int, string](...)`. Inference improvements in 1.21+ may make some of these compile automatically.

### Q19. What is the difference between `T` having a method and the constraint requiring one?
**Short:** Method sets of `T` are computed from the constraint, not from the actual type argument.

**Long:** Even if every type you pass for `T` has a `String()` method, the body cannot call `v.String()` unless the constraint **requires** `String()`. Generics bind operations through the constraint, not through dynamic capabilities.

### Q20. When is a constraint type set empty?
**Short:** When intersecting type elements yields no overlap.

**Long:** `interface { ~int; ~string }` has empty type set (no type has both underlying ints and underlying strings). The compiler accepts the declaration but no value can satisfy. Some linters flag this; the spec does not require it.

---

## Senior 🔴

### Q21. Explain how implicit boxing affects generic performance.
**Short:** Operations on `T` go through a runtime dictionary, similar to `interface{}` dispatch.

**Long:** GC shape stenciling generates one body per memory shape. Operations like `==` or method calls on `T` are looked up in a dictionary, not inlined. For tight loops with diverse pointer-shaped instantiations, this costs measurable nanoseconds. Specialise hand-written for hot paths.

### Q22. How does cross-package instantiation affect build cache?
**Short:** Each importing package generates its own stencils, which the build cache stores separately.

**Long:** Generics are stenciled at the call site's package, not the definition's. A generic function used by 100 packages has 100 cache entries. Modifying the generic invalidates all of them. For large monorepos, this matters; for small projects, it does not.

### Q23. What is the "useless `T`" anti-pattern?
**Short:** A generic function whose type parameter does nothing in the body.

**Long:** `func F[T any](v T) { log.Println(v) }` has no operation that depends on `T`. The parameter is decorative. Remove it, or commit to using it (e.g., `return v` to preserve the type to the caller).

### Q24. Why might a method-bearing constraint accept the wrong type?
**Short:** Constraints check method existence and signature, not semantics.

**Long:** A constraint `interface { Compare(T) int }` is satisfied by any type with a method of that name and signature, regardless of whether the implementation correctly compares. Buggy implementations slip through. Test with multiple types.

### Q25. How do you reflect on the type of `T` even if `T` is an interface?
**Short:** `t := reflect.TypeOf((*T)(nil)).Elem()`.

**Long:** `reflect.TypeOf(zero)` returns `nil` for nil interface zero values. The canonical idiom uses a pointer-to-`T` and unwraps with `.Elem()`. Works for all types including interfaces.

### Q26. Why is `Optional[T]` an anti-pattern in Go?
**Short:** It competes with Go's idiomatic `(T, bool)` and `(T, error)` returns.

**Long:** Go's idiomatic absence is "second return value is false/error". `Optional[T]` adds a wrapper type that callers must unwrap. Mixing both styles in one codebase doubles the cognitive load. Localize `Optional` if you really want it; expose `(T, bool)` at API boundaries.

### Q27. What goes wrong when you tighten a constraint?
**Short:** Existing callers who satisfied the loose form may not satisfy the tighter one — a breaking change.

**Long:** Going from `T any` to `T comparable` rejects callers who passed slices, maps, or func types. Even if no real caller does this, the contract has changed. Tighten only across major version bumps, with documentation.

### Q28. Why does direct `reflect.TypeOf(v)` fail inside a generic function for nil interface arguments?
**Short:** `reflect.TypeOf(nil)` returns nil, and `.Kind()` panics on it.

**Long:** When `v` has interface type and the dynamic value is nil, `reflect.TypeOf(v)` returns `nil`. Calls to `.Name()`, `.Kind()`, etc. then panic. Always guard: `t := reflect.TypeOf(v); if t == nil { ... }`.

### Q29. What is the "polymorphism by type switch" trap?
**Short:** Generics syntax wrapping interface dispatch with extra steps.

**Long:** A function with `[T any]` and a `switch any(v).(type)` body is doing runtime polymorphism. The type parameter buys nothing — the actual logic depends on the dynamic type. Use a real interface and method dispatch.

### Q30. How can you keep generic build cache friendly?
**Short:** Centralize generic helpers in one internal package; expose non-generic wrappers.

**Long:** Each package that calls a generic produces stencils. By calling a non-generic wrapper, you force one stencil to be produced once and shared. Worth it only for very hot generic helpers in very large monorepos.

---

## Expert 🟣

### Q31. Why does the Go spec forbid composite literals on type parameters?
**Short:** Underlying type is unknown until instantiation; restrictive rules apply per kind.

**Long:** The composite-literal grammar requires the type's underlying form to be array/slice/struct/map. `T any` could instantiate to `int`, where `int{}` is meaningless. The spec rejects conservatively, even if a more refined analysis (per-constraint) could allow some cases.

### Q32. Walk through how GC shape stenciling can produce a measurable performance pitfall.
**Short:** Multiple pointer-shaped instantiations share one body with dictionary-based dispatch on `==` and methods.

**Long:** Suppose `Find[T comparable]` is called with `[]Foo`, `[]Bar`, `[]Baz`. All have the same GC shape (struct with pointer). One stencil is generated. Inside, `==` calls a per-type equal function via the dictionary. The lookup adds a few nanoseconds per iteration. In a 1M-element loop, that is milliseconds.

### Q33. When can the Go compiler devirtualize generic dispatch?
**Short:** When the call site uses one concrete type and the body is small enough.

**Long:** Profile-guided optimization (1.21+) and single-instantiation analysis allow the compiler to inline through the dictionary, effectively monomorphizing hot paths. For diverse instantiations or large bodies, devirtualization fails and dictionary calls remain.

### Q34. Why is the "constraint factory explosion" anti-pattern dangerous over years?
**Short:** Many one-off constraints accumulate, godoc grows, and most are unused or duplicate stdlib.

**Long:** A package that defines 30 constraints — `Equatable`, `Cloneable`, `Mergeable`, etc. — places a tax on every reader. Many duplicate `cmp.Ordered` or `comparable`. Most have one or two callers. The fix is a quarterly audit and deletion of unused constraints.

### Q35. How can you detect lost inlining in a generic codebase?
**Short:** `go build -gcflags="-m=2"` and look for "cannot inline F[shape]".

**Long:** The verbose compiler output annotates each inlining decision. For generic functions, lines like `cannot inline Find[go.shape.struct{...}]: cost X exceeds budget Y` indicate the inliner gave up. Combined with `pprof`, you can find the hottest non-inlined generics and consider hand-specialisation.

### Q36. Why does Go not implement explicit specialisation like C++?
**Short:** It would multiply binary size and complicate the compiler.

**Long:** C++ allows `template<> Foo specialize<int>` to override behaviour for specific types. Go deliberately omits this — the team prefers the simpler model where the body is the same for every instantiation. Hand-writing a separate `func FooInt(...)` is the Go-idiomatic substitute.

### Q37. What is the long-term risk of inference improvements between Go versions?
**Short:** Code that needed explicit instantiation may suddenly compile without it, or vice-versa.

**Long:** Each Go release tweaks inference. Code that compiles on 1.21 may fail on a future version that handles inference differently (rare, but possible). Code that fails on 1.18 may suddenly compile on 1.22. Standardize on a Go version per project and avoid relying on bleeding-edge inference behaviour.

### Q38. How does generic instantiation interact with `go vet`?
**Short:** Most checks work but a few are limited; constraint-mismatch checks are mature.

**Long:** `go vet` runs on type-checked code, including generic instantiations. Some checks (e.g., unreachable code) work normally. Others (e.g., `printf` format string checks across generics) have known limitations. `staticcheck` adds checks that complement `vet` for generic-specific concerns like empty type sets.

### Q39. Could Go ever ship monomorphization as a build flag?
**Short:** Possibly via PGO; not as a general flag without binary-size tradeoffs.

**Long:** PGO enables targeted monomorphization for hot generic functions. A general `--monomorphize` flag would significantly grow binaries — at odds with Go's "small binary" philosophy. The team has not committed to it.

### Q40. What is the "polymorphism by type switch" trap and why is it harmful?
**Short:** Generic syntax wrapping a runtime type switch — gives no compile-time benefit, defeats generics' purpose.

**Long:** A function with `[T any]` whose body switches on `any(v).(type)` is doing exactly what `interface{}` did, with extra type-parameter syntax. The compile-time `T` carries no information. Adding a new case requires editing the function (open/closed violated). Use an interface with methods instead.

---

## Summary

Memorize the **short answers** for fluency. The most common interview themes from this topic:

- The five junior pitfalls (zero, nil, any/interface{}, type switch, inference)
- `comparable` vs `cmp.Ordered`
- Method set of `T` is intersected from the constraint, not from the actual argument
- Implicit boxing through dictionary calls
- When generics defeat inlining
- Why `T{}` is rejected and `var zero T` is the fix
- Cross-package instantiation effects
- Anti-patterns: useless `T`, `Optional[T]` everywhere, polymorphism-by-type-switch

A confident candidate explains **what**, **why**, and **fix** for each pitfall. The "why" is usually a spec rule; the "fix" is usually a one-line idiom.
