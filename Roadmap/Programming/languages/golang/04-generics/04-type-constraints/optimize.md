# Type Constraints — Optimization Guide

## Table of Contents
1. [Overview](#overview)
2. [The Permissive-Constraint Principle](#the-permissive-constraint-principle)
3. [Constraint Impact on Code Generation](#constraint-impact-on-code-generation)
4. [Monomorphization vs Dictionary](#monomorphization-vs-dictionary)
5. [Reducing Constraint Duplication](#reducing-constraint-duplication)
6. [Method Elements: When They Hurt](#method-elements-when-they-hurt)
7. [Constraint Choice in Hot Paths](#constraint-choice-in-hot-paths)
8. [Benchmarks That Matter](#benchmarks-that-matter)
9. [Refactoring Toward Better Constraints](#refactoring-toward-better-constraints)
10. [Measurement Tools](#measurement-tools)
11. [Constraint Hygiene Patterns](#constraint-hygiene-patterns)
12. [Anti-Patterns to Remove](#anti-patterns-to-remove)
13. [Case Studies](#case-studies)
14. [Summary](#summary)

---

## Overview

Optimization in the constraint world has two faces:

1. **Engineering optimization** — reducing duplication, improving clarity, making constraints reusable across packages.
2. **Performance optimization** — choosing constraints that produce the fastest code under Go's GC-shape stenciling implementation.

Both matter; we cover both. The single most important rule is the **permissive-constraint principle**, which is itself an engineering concern that produces performance benefits as a side effect.

---

## The Permissive-Constraint Principle

> Use the most permissive constraint that gives you the operations you need.

Why permissive?

1. **Wider library reach.** Callers with newtype wrappers can use your function.
2. **Fewer changes when you widen later.** If you start narrow and widen, you risk breaking compile-time guarantees in dependent code; if you start permissive, you can always narrow internally without affecting callers.
3. **Better code generation potential.** Permissive type-element constraints often share a GC shape with their narrower siblings, but the compiler can pick the most efficient lowering when fewer method-element constraints are involved.

Concrete example:

```go
// Restrictive — only int
func Sum[T int](xs []T) T { ... }

// Better — any signed integer (newtype-friendly)
func Sum[T constraints.Signed](xs []T) T { ... }

// Best for many use cases — any number
func Sum[T constraints.Integer | constraints.Float](xs []T) T { ... }
```

Each step widens the type set. None of them slow the function down — the compiler still monomorphizes per concrete shape. But the wider versions reach more callers.

When you should **not** be permissive:
- The implementation actually depends on a specific bit-width or representation.
- You're building security-sensitive code that needs to reject types you don't fully control.
- The wider constraint admits types that would silently produce wrong answers (e.g., complex numbers in an ordering context).

---

## Constraint Impact on Code Generation

Go uses **GC-shape stenciling** to compile generic functions. The basic idea:

- Types that share a "GC shape" (same memory layout, same garbage-collection treatment) share one compiled function body.
- A runtime dictionary supplied at the call site provides type-specific information (method tables, sizes for things that vary).

### What this means in practice

| Constraint kind | Codegen behavior |
|---|---|
| `int` only | One copy. |
| `~int` (multiple `int`-shaped types) | One copy shared via dictionary. |
| `~int \| ~int64` | Two GC shapes (different sizes), two copies. |
| `~int \| ~float64` | Two shapes (different GC treatment), two copies. |
| `any` | Boxed values, one copy that handles every shape via reflection-light dispatch. |
| Method-element constraint | One copy per shape, with method dispatch through the dictionary. |

In most cases this is fine — the compiler handles it. The only time it matters for performance is when you have a **very hot loop** with method elements, where the dispatch cost adds up.

### Inlining

The compiler can inline calls to generic functions, but only when the call site sees a fully concrete type. If your function body calls a method element on `T`, and the method has a substantial body, inlining is unlikely.

To maximize inlining:
- Prefer pure type-element constraints (no method elements) in hot loops.
- Pass functions as arguments rather than relying on method elements.
- Keep generic functions small.

---

## Monomorphization vs Dictionary

Two extremes:

### Pure monomorphization

A separate compiled body per concrete type argument. Pros: maximum performance. Cons: code-size explosion, slower compilation.

C++ templates work this way. Rust generics work this way.

### Pure dictionary passing

One compiled body for all type arguments, with a runtime dictionary providing per-call type metadata. Pros: small code size, fast compilation. Cons: dispatch overhead.

Java generics (with type erasure) are roughly this.

### Go's hybrid

GC-shape stenciling: monomorphize per shape, share within a shape via a dictionary. Best of both worlds for most cases.

The implication for constraints: **if your constraint creates many shapes, you get many copies**. A constraint like `int8 | int16 | int32 | int64 | uint8 | uint16 | uint32 | uint64` could produce up to eight code copies, each carrying its own machine-instruction sequences.

For libraries with strict binary-size budgets, prefer narrower constraints in hot paths and reserve the wide ones for cold-path utilities.

---

## Reducing Constraint Duplication

Duplication of constraints is a code smell. Two cures:

### Cure 1: A central `constraints` package

Already covered in `professional.md`. One file, all constraints, re-exported from `x/exp/constraints`.

### Cure 2: Embedding

Rather than re-listing types, embed:

```go
// Bad
type A interface { ~int | ~int8 | ~int16 }
type B interface { ~int | ~int8 | ~int16 | ~int32 | ~int64 }

// Good
type Smallish interface { ~int | ~int8 | ~int16 }
type Signed interface { Smallish | ~int32 | ~int64 }
```

When the smaller constraint changes, the larger one inherits the change automatically.

### Cure 3: Composition over copy-paste

Same principle. If you find yourself listing `~uint, ~uint8, ~uint16, ~uint32, ~uint64, ~uintptr` more than once, you should be embedding `constraints.Unsigned` (or your re-export of it).

---

## Method Elements: When They Hurt

A constraint with method elements forces method dispatch through a runtime dictionary. The cost: a few nanoseconds per call, plus disabled inlining.

In a hot loop processing millions of items, this matters:

```go
// Potentially slow — String() called per element
type Stringy interface { String() string }
func PrintAll[T Stringy](xs []T) {
    for _, x := range xs {
        fmt.Println(x.String())
    }
}

// Faster — pass the function once, call directly
func PrintAllF[T any](xs []T, str func(T) string) {
    for _, x := range xs {
        fmt.Println(str(x))
    }
}
```

The second version may inline `str`, eliminating dispatch.

When to use method elements:
- The cost is negligible compared to the per-iteration body.
- You want stronger documentation: "this only works on types with method M".
- The function is called rarely.

When to avoid method elements:
- Tight inner loops.
- Sub-microsecond per-call work.
- Library-critical paths where you control both sides.

---

## Constraint Choice in Hot Paths

Quick rules of thumb for hot-path constraints:

1. **Pure type-element constraints inline best.** `~int | ~float64` is your friend.
2. **Avoid `any` in hot loops** unless the per-iteration work is large enough to dominate.
3. **`comparable` is fine.** `==` lowers to direct machine instructions.
4. **`constraints.Ordered` is fine** for `<`, `>`, etc.
5. **A method element adds about a function-call's overhead per call.** Profile to confirm.

---

## Benchmarks That Matter

Set up Go benchmarks to compare constraint choices:

```go
package generics_bench

import "testing"

type Numeric interface { ~int | ~float64 }
type Stringy interface { String() string }

type IntID int
func (i IntID) String() string { return strconv.Itoa(int(i)) }

func BenchmarkSumPure(b *testing.B) {
    xs := make([]int, 1<<16)
    for i := range xs { xs[i] = i }
    var sink int
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sink = SumPure(xs)
    }
    _ = sink
}

func SumPure[T Numeric](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}

func BenchmarkSumWithMethod(b *testing.B) {
    xs := make([]IntID, 1<<16)
    for i := range xs { xs[i] = IntID(i) }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        for _, x := range xs {
            _ = x.String()
        }
    }
}
```

Run with `go test -bench=. -benchmem`. Typical results:
- Pure type-element loop: ~50-100 µs for 65K items, zero allocations.
- Method-element loop: ~500 µs - 1 ms (dominated by `String()` allocations), with allocations.

---

## Refactoring Toward Better Constraints

Refactoring patterns you'll apply repeatedly:

### Pattern A: Narrow `any` to a typed constraint

Look for `any`-parameterized functions where the body type-asserts. Almost always, you can promote the assertion into the constraint.

```go
// Before
func Process[T any](x T) { ... if v, ok := any(x).(int); ok { ... } ... }

// After
func Process[T constraints.Integer](x T) { ... }
```

### Pattern B: Replace method element with function argument

```go
// Before
type Hashy interface { Hash() uint64 }
func Bucket[T Hashy](x T) int { return int(x.Hash() % 32) }

// After
func Bucket[T any](x T, hash func(T) uint64) int { return int(hash(x) % 32) }
```

The "after" is faster in tight loops because the function pointer can be captured and inlined. It's also more flexible (callers don't need to define a method).

### Pattern C: Split fast and slow paths

```go
type FastNumeric interface { ~int | ~float64 }
type SlowNumeric interface { FastNumeric; String() string }

func SumFast[T FastNumeric](xs []T) T { ... }   // hot path
func SumLogged[T SlowNumeric](xs []T) T { ... } // diagnostic path
```

### Pattern D: Promote ad-hoc constraints to a shared package

When the same constraint appears in three files, move it to `mypkg/constraints` and import.

---

## Measurement Tools

Tools to measure constraint impact:

- `go test -bench=.` — benchmarks.
- `go build -gcflags="-m"` — see inlining decisions.
- `go test -gcflags="-m -m"` — verbose inlining decisions.
- `go tool objdump` — see the assembly for a function.
- `go tool compile -d=ssa/check_bce/debug=1` — bounds-check elimination diagnostics.
- `pprof` — runtime CPU and allocation profiles.

Practical approach:
1. Write the function with the most permissive constraint that compiles.
2. Benchmark.
3. If it's hot, look at the inlining output (`-gcflags="-m"`).
4. If method elements block inlining, refactor to function arguments.
5. Re-benchmark.

---

## Constraint Hygiene Patterns

### Hygiene 1: One name per concept

Don't have `MyInt` in one file and `IntegerLike` in another both meaning the same thing. Pick one.

### Hygiene 2: Document the type set

A one-line comment listing the types saves the next reader 60 seconds.

### Hygiene 3: Test wrapper types

For every constraint with `~`, have a unit test that instantiates the generic with a `type X int`-style wrapper. This proves `~` is in place and stays in place.

### Hygiene 4: No constraint without a use case

Don't define `Hashable` and never use it. Dead constraints rot.

### Hygiene 5: Keep constraints near their first user

Premature centralization is as bad as duplication. Move to `constraints/` only when at least two places need the constraint.

---

## Anti-Patterns to Remove

1. **`type Foo any` aliases.** Use `any` directly.
2. **Constraint listed inline in the type parameter list.** `func F[T interface{ ~int | ~float64 }](x T)` is legal but ugly. Define a named constraint.
3. **Long unions copy-pasted across files.** Replace with imports.
4. **Constraint with methods that the body never calls.** Drop the methods.
5. **`any` in security-sensitive code.** Tighten.
6. **`comparable` where you actually need `Ordered`.** Tighten.
7. **`Ordered` where you actually need `Numeric`.** You probably want both — split.
8. **Re-declaring `comparable`.** It's predeclared; pick a different name.
9. **Constraint with empty type set.** Refactor immediately.
10. **Recursive constraint attempt.** Use F-bounded polymorphism instead: `interface{ M(T) }`.

---

## Case Studies

### Case Study A — Removing 80% of generated binary

A team had a generic `Encode[T constraints.Integer | constraints.Float]` used by 30 callers. Each caller produced its own copy. Binary size grew 4 MB.

Fix: convert the function to take an `io.Writer` and a callback `func(io.Writer, T) error`, then provide concrete helpers for the few common cases. Total binary: -3.2 MB.

Lesson: generic functions are not free in code size. Profile binary growth, not just runtime cost.

### Case Study B — Eliminating method-element overhead

A telemetry library had `type Metric interface { Tags() map[string]string }` and used it as a constraint. Profiling showed 20% of CPU was in `Tags()` calls.

Fix: pre-compute tags at registration time, store in the metric struct, drop the method element. CPU usage dropped to 5%.

Lesson: method elements force runtime dispatch. If the data can be precomputed, do so.

### Case Study C — Constraint package consolidation

A large monorepo had 23 different `Numeric` constraints across 17 packages, each subtly different. Merging into one shared `myrepo/constraints.Numeric` deleted 400 lines and fixed three latent bugs (one had `~uint` missing).

Lesson: duplication in constraint definitions hides bugs. Centralize.

---

## Summary

Optimization is mostly about taste: choose the most permissive constraint that gives you the operations you need; centralize constraints in one package; prefer pure type-element constraints in hot paths; avoid method elements when you can pass a function instead. Measure with `go test -bench` and `-gcflags="-m"`. Treat constraint choices as architectural decisions: they affect binary size, runtime cost, and the human reader's understanding all at once.
