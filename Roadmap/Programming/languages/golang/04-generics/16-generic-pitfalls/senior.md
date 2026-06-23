# Generic Pitfalls — Senior Level

## Table of Contents
1. [The senior taxonomy](#the-senior-taxonomy)
2. [Implicit boxing into the dictionary path](#implicit-boxing-into-the-dictionary-path)
3. [When generics defeat inlining](#when-generics-defeat-inlining)
4. [Method-set constraints that quietly accept the wrong types](#method-set-constraints-that-quietly-accept-the-wrong-types)
5. [Mixing reflect with generics](#mixing-reflect-with-generics)
6. [Cross-package instantiation surprises](#cross-package-instantiation-surprises)
7. [The "useless `T`" anti-pattern](#the-useless-t-anti-pattern)
8. [Long-term maintenance pitfalls](#long-term-maintenance-pitfalls)
9. [Summary](#summary)

---

## The senior taxonomy

The junior list was about syntax. The middle list was about shape. The senior list is about **implementation** — the things the GC shape stenciling implementation does behind your back, the things the compiler can no longer prove, and the things that look correct in code review but degrade silently in production.

Concretely:

1. **Implicit boxing** sneaks values into the dictionary-passing path you did not expect.
2. **Lost inlining** turns a one-line generic into a regular call.
3. **Method-set constraints** accept types that satisfy the **shape** but not the **intent**.
4. **`reflect.TypeOf(v)`** inside a generic body returns the runtime type, not the parameter — sometimes a problem.
5. **Cross-package instantiation** changes the binary in ways that surprise build-cache users.
6. **A generic function with no body operations on `T`** is a smell — the type parameter is "useless".

---

## Implicit boxing into the dictionary path

The Go compiler implements generics with **GC shape stenciling**: one body per memory shape, plus a runtime dictionary for type-specific operations. Most of the time, the dictionary call is direct and the cost is negligible. Sometimes it is not.

### Example — a benchmark surprise

```go
type Foo struct{ X int }
type Bar struct{ X int }
type Baz struct{ X int }

func Find[T comparable](s []T, target T) int {
    for i, v := range s {
        if v == target { return i }
    }
    return -1
}
```

When you call `Find` with `[]Foo`, `[]Bar`, and `[]Baz` in the same binary, the compiler stencils **one** body for the shared GC shape (here, "non-pointer struct of size 8"). Inside, `==` is implemented via a runtime dictionary lookup. The dictionary entry calls a per-type equal function.

Hand-written:

```go
func FindFoo(s []Foo, t Foo) int {
    for i, v := range s {
        if v == t { return i }
    }
    return -1
}
```

Compiles to a tight loop with an inlined int compare. Generic version: a tight loop with an indirect call per iteration.

The "boxing" here is metaphorical — the values do not literally become `interface{}`. But the **operation** is dispatched through a dictionary, the same way a method call on `interface{}` is. From a performance standpoint, the cost is similar.

### How to spot it

```bash
go build -gcflags="-m=2" .
```

Look for output like:

```
./find.go:5:6: cannot inline Find[go.shape.struct{...}]: too many operations
```

Or use `pprof` and look for symbol names with `[go.shape.X]` suffixes.

### How to fix

- For hot paths, write a **non-generic specialisation** for the critical type. The generic version stays for everything else.
- Or pin the call site so only **one** GC shape uses the function — the compiler is more likely to devirtualize.
- Or refactor the loop so the dictionary lookup happens **outside** the loop:

```go
func Find[T comparable](s []T, target T) int {
    eq := equalFunc[T]() // hypothetical helper
    for i, v := range s {
        if eq(v, target) { return i }
    }
    return -1
}
```

(In practice you cannot write `equalFunc[T]()` directly, but you can sometimes hoist comparable assertions out of the loop using a closure factory.)

---

## When generics defeat inlining

Inlining is one of Go's bigger optimizations. Small functions get pasted into call sites, removing the call overhead and enabling further optimization. Generics interact with inlining in non-obvious ways.

### Cost model

The compiler decides to inline based on **estimated size**. Generic bodies often appear larger because:

- The compiler must include dictionary fetch instructions
- It cannot fold operations whose result depends on `T`
- Type parameters force conservative escape analysis

A generic function that would inline if hand-written might **not** inline.

### Example — inline budget exceeded

```go
func Apply[T any](f func(T) T, v T) T {
    return f(v)
}
```

Hand-written for a specific type, this inlines trivially. Generic, the compiler sometimes refuses because the function-typed parameter combined with the type parameter pushes the size estimate over the threshold.

You can check with `-gcflags=-m`:

```
./apply.go:1:6: cannot inline Apply[go.shape.int_0]: function too complex: cost 80 exceeds budget 80
```

### Real-world impact

A loop like:

```go
for _, v := range s { result = Apply(double, result) }
```

might run 2-3x slower than a hand-written version, purely because the inner `Apply` no longer inlines. The cost is per-iteration call overhead.

### Fix

For hot loops, choose one of:

- Hand-write the specialization.
- Mark the helper `//go:noinline` deliberately so you stop chasing inlining gains and pay the call cost honestly.
- Write the body **without** the helper at the call site — yes, copy-paste sometimes wins.

PGO (profile-guided optimization, Go 1.21+) can make smarter inlining decisions for generic code. If you have a real PGO setup, generic inlining gets substantially better.

---

## Method-set constraints that quietly accept the wrong types

A constraint with method requirements may **accept the type** but the body may behave incorrectly because the method is implemented unexpectedly.

### Example — comparator constraint

```go
type Comparable[T any] interface {
    Compare(T) int
}

func Min[T Comparable[T]](a, b T) T {
    if a.Compare(b) < 0 { return a }
    return b
}
```

You'd expect this to give "the smaller of `a` and `b`". But what if a user defines:

```go
type Insensitive string
func (s Insensitive) Compare(other Insensitive) int {
    return strings.Compare(strings.ToLower(string(s)), strings.ToLower(string(other)))
}
```

Now `Min[Insensitive]("Hello", "hello")` returns whichever came first by coincidence — comparison says they are equal, but values differ. The pitfall is that the constraint is satisfied by **any** `Compare` implementation, including buggy or domain-specific ones. The function works "correctly" by its contract but produces results the caller did not expect.

### Example — the empty method set

```go
type Numeric interface {
    ~int | ~int64 | ~float64
    Add(other Numeric) Numeric // ❌
}
```

The first line says "underlying type must be int/int64/float64". The second line requires a method. **No primitive has methods.** The constraint's type set is empty.

But the constraint **declaration** compiles. You only discover the bug when you try to call the function:

```go
var x int = 5
Sum[int]([]int{x, x}) // ❌ — int does not satisfy Numeric
```

Some linters flag empty type sets; many do not. Reading constraint declarations critically is a skill.

### Example — pointer/value method set asymmetry

```go
type Closeable interface { Close() error }

type DB struct{}
func (d *DB) Close() error { return nil } // pointer receiver

func WithClose[T Closeable](v T) {
    defer v.Close()
    // ...
}

WithClose(DB{})    // ❌ — DB does not satisfy Closeable
WithClose(&DB{})   // ✓
```

A common 30-minute debugging session for someone migrating from interface-based to generic-based APIs. The constraint **looks** broad ("anything that closes"), but value vs pointer receiver decides which one satisfies.

### Defensive pattern

When you design a constraint with methods, document **explicitly**:

```go
// Closeable is satisfied by types whose pointer type has a Close() error
// method. To use this constraint, pass a *T, not a T.
type Closeable interface { Close() error }
```

Or use the `*T` constraint form to force the issue:

```go
type Closeable[T any] interface {
    *T
    Close() error
}

func WithClose[T any, P Closeable[T]](p P) {
    defer p.Close()
}
```

Now the type system tells callers they need a pointer.

---

## Mixing reflect with generics

Reflection on a generic value works on the **runtime type**, not the type parameter. This is correct in principle but subtle in practice.

### Example — typed nil

```go
import "reflect"

func TypeName[T any](v T) string {
    return reflect.TypeOf(v).Name()
}

var p *int
fmt.Println(TypeName(p)) // "" — *int has no name; type kind is Ptr
```

Or worse:

```go
var iface error
fmt.Println(TypeName(iface)) // panic — reflect.TypeOf(nil interface) is nil
```

Inside a generic function, the user passed a nil interface. `reflect.TypeOf(v)` returns `nil`, and `.Name()` panics. Defensive code:

```go
func TypeName[T any](v T) string {
    t := reflect.TypeOf(v)
    if t == nil { return "<nil>" }
    return t.String()
}
```

### Example — `reflect.New(reflect.TypeOf(*new(T)))` boilerplate

```go
func ReflectiveZero[T any]() reflect.Value {
    var zero T
    return reflect.New(reflect.TypeOf(zero)).Elem()
}
```

For non-interface `T`, this works. For `T = error`, `reflect.TypeOf(zero)` returns `nil` because the zero value of an interface type is `nil`. You need:

```go
t := reflect.TypeOf((*T)(nil)).Elem()
```

That is the canonical idiom for "give me reflect.Type of T, even if T is an interface".

### The "reflect inside generic" code smell

If you find yourself reaching for reflection inside a generic function, ask whether you actually needed generics. Reflection is slow, error-prone, and **already** type-erased. Generics give you a compile-time `T`; reflection takes that away. The combination is rarely a good idea.

Acceptable cases:

- Building a generic ORM where struct field tags must be inspected
- Implementing a generic deep-copy or deep-equal helper
- Bridge code from generic to non-generic APIs

In all three, the reflection complexity should be **hidden** behind a clean generic surface, not exposed.

---

## Cross-package instantiation surprises

Stenciling happens in the package where the **call** is, not where the function is defined. This has subtle effects on build cache and binary size.

### Example — viral binary growth

```go
// package mathx
func Max[T cmp.Ordered](a, b T) T { ... }
```

```go
// package a
import "mathx"
mathx.Max(1, 2) // stencil for int generated in package a
```

```go
// package b
import "mathx"
mathx.Max(1.5, 2.5) // stencil for float64 generated in package b
```

If `a` and `b` import the same `mathx`, both packages produce stencils. The linker may deduplicate, but the **build cache** has two distinct artifacts. Modifying `mathx.Max` invalidates both.

For a monorepo with thousands of packages and heavy generic use, this can balloon CI time.

### How to mitigate

- Centralize generic helpers in **one** internal package; have other packages call **wrappers**:
  ```go
  // package internal/genericx
  func MaxInt(a, b int) int { return mathx.Max(a, b) }
  ```
- The wrapper has a stable, non-generic signature; instantiation happens once.
- This is **only worth doing** for very hot generic helpers in very large monorepos.

### Linker pitfalls

A binary that imports two libraries each defining `Foo[int]` will get **two** stencils — the linker does not always dedupe across module boundaries. Tooling like `go tool nm` reveals the duplicates. For most projects, the size is negligible. For embedded targets or static binaries, it matters.

---

## The "useless `T`" anti-pattern

A function whose type parameter is never used in a body operation:

```go
func DoWork[T any](v T) {
    log.Println("done")
}
```

`T` is a placeholder that conveys nothing. The function is callable as `DoWork[int](0)` or `DoWork(0)`, but it does not depend on `T`. Possible explanations:

- **Intentional**: the caller wanted to pass a typed value through unchanged. Then the signature should reflect that:
  ```go
  func DoWork[T any](v T) T { ... return v }
  ```
- **Unintentional**: someone added `[T any]` because "generics are good". Remove it.

The pitfall: a useless `T` adds compile time, dictionary overhead, and reading cost without buying anything. Senior code review catches these.

### A subtler case

```go
type Cache[T any] struct {
    m sync.Map
}

func (c *Cache[T]) Get(k string) (T, bool) {
    v, ok := c.m.Load(k)
    if !ok { var zero T; return zero, false }
    return v.(T), ok
}
```

`sync.Map.Load` returns `interface{}`. The generic `Cache[T]` wraps it and casts on every read — no compile-time guarantee, only a runtime assertion. The `T` parameter conveys **type safety to the caller** but does not actually constrain what is stored. A caller could write `Set("k", "hello")` to a `Cache[int]` if the surface API leaks.

The fix is to make `Set[T]` and `Get[T]` consistent on the same `Cache[T]` type and audit the boundaries.

---

## Long-term maintenance pitfalls

Generic APIs age in unique ways. Things to watch for over months and years:

### Constraint drift

Two years after publishing `func F[T any](...)`, you decide it would be more useful as `[T comparable]`. Tightening the constraint is a **breaking change** for callers who passed types like `[]int` or `func() int`. Even if no real caller relies on those types, the contract is broken.

### Inference improvements

Newer Go releases make inference smarter. Code that needed explicit type arguments in 1.18 may not need them in 1.22. This is a **backwards-compatible** change but causes confusing diffs when codebases standardise.

### Constraint package churn

`golang.org/x/exp/constraints` was the early home of `Ordered`, `Integer`, etc. Most of its content moved to stdlib `cmp.Ordered` in Go 1.21. Codebases stuck on the old import path accumulate technical debt.

### Generic type alias adoption (Go 1.24+)

```go
type Vec[T any] = []T // 1.24+
```

Older code uses `type Vec[T any] []T`, which is a **defined type**, not an alias. They are not interchangeable. As Go 1.24 spreads, you'll find both styles in one codebase. Picking a convention early saves churn later.

### Documentation pitfalls

Godoc renders generic functions verbosely. Public APIs with three or more type parameters are hard to read. Senior engineers split such APIs into smaller pieces.

---

## Summary

Senior-grade pitfalls are the ones the compiler will not catch and the test suite will not flag. They cost performance, design clarity, and maintainability over the lifetime of a codebase.

The shortlist:

1. **Implicit boxing** through dictionary calls in pointer-shaped instantiations.
2. **Lost inlining** when the generic body grows past the inline budget.
3. **Method-set constraints** that quietly accept satisfying-but-wrong implementations.
4. **Reflect-with-generic** awkwardness around typed-nil and interface zero values.
5. **Cross-package instantiation** affecting build cache and binary size.
6. **Useless `T`** that adds noise without value.
7. **Long-term drift** in constraints, inference behaviour, and stdlib provenance.

A senior engineer asks, before introducing a generic API: *"Will this still be the right abstraction in two years, with new Go versions and new instantiation patterns?"* The next file walks through real codebase anti-patterns and how to spot them in review.
