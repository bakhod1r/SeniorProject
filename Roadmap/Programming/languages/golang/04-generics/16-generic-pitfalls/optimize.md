# Generic Pitfalls — Optimize

## Table of Contents
1. [The pitfall-performance connection](#the-pitfall-performance-connection)
2. [Pitfall 1 — Implicit boxing through `any(v)`](#pitfall-1-implicit-boxing-through-anyv)
3. [Pitfall 2 — Dictionary-lookup overhead in tight loops](#pitfall-2-dictionary-lookup-overhead-in-tight-loops)
4. [Pitfall 3 — Lost inlining from generic body size](#pitfall-3-lost-inlining-from-generic-body-size)
5. [Pitfall 4 — Escape-analysis surprises](#pitfall-4-escape-analysis-surprises)
6. [Pitfall 5 — Type-switch fast paths that backfire](#pitfall-5-type-switch-fast-paths-that-backfire)
7. [Pitfall 6 — `reflect` inside generic body](#pitfall-6-reflect-inside-generic-body)
8. [Pitfall 7 — Cross-package instantiation hits build cache](#pitfall-7-cross-package-instantiation-hits-build-cache)
9. [Detection toolkit](#detection-toolkit)
10. [Fix patterns](#fix-patterns)
11. [Summary](#summary)

---

## The pitfall-performance connection

Most generic pitfalls are correctness traps. Some are **performance traps**: code that compiles, behaves correctly, and ships — yet costs nanoseconds (or microseconds) per call that you did not pay before. Unlike `07-generic-performance`, which surveys raw numbers, this file focuses on the **UX traps** that produce performance regressions invisibly.

Each pitfall below is something a junior or middle engineer writes intending to "be type-safe" but quietly degrades the hot path.

---

## Pitfall 1 — Implicit boxing through `any(v)`

### The trap

```go
func Process[T any](v T) {
    log(any(v)) // boxing for non-pointer T
}
```

Every call to `any(v)` for a non-pointer-shaped `T` allocates an interface header on the stack or heap. For small values like `int`, this allocation may live on the stack (cheap) or escape to the heap (expensive) depending on context.

In a tight loop:

```go
for _, x := range largeIntSlice {
    Process(x) // each call may box
}
```

You can pay 1M heap allocations for 1M iterations.

### How to spot

```bash
go build -gcflags="-m=2" ./...
```

Look for output like:
```
./util.go:7:14: any(v) escapes to heap
```

Or run benchmarks with `-benchmem`:
```bash
go test -bench=. -benchmem
```

A sudden `1 alloc/op` where you expected 0 is a flag.

### The fix

- Avoid `any(v)` in the inner loop. Hoist outside.
- Or, if the caller really wants logging, accept a `func()` instead of a generic value, deferring the boxing decision to the caller's call site.
- Or, use a constraint that lets you operate on `T` without converting to `any`.

```go
// Better: accept a Stringer-like constraint
type Loggable interface { fmt.Stringer }

func Process[T Loggable](v T) {
    log(v.String())
}
```

---

## Pitfall 2 — Dictionary-lookup overhead in tight loops

### The trap

```go
func Find[T comparable](s []T, target T) int {
    for i, v := range s {
        if v == target { return i }
    }
    return -1
}
```

Called with diverse pointer-shaped types (e.g., struct types containing pointers), the compiler stencils one body for the shape and routes `==` through a runtime dictionary. Each `==` is a dictionary fetch + indirect call.

In a 10M-element loop, this is measurable.

### How to spot

```bash
go test -bench=BenchmarkFind -cpuprofile=cpu.out
go tool pprof cpu.out
```

Look for:
- `runtime.cmpstring` or `runtime.dictForOp` in the hottest stack frames
- `pkg.Find[go.shape.X]` taking more time than a hand-written equivalent

### The fix

For hot paths:

```go
// Hand-written specialization for hot type
func FindFoo(s []Foo, target Foo) int {
    for i, v := range s {
        if v == target { return i }
    }
    return -1
}

// Generic version remains for cold callers
func Find[T comparable](s []T, target T) int { ... }
```

Or hoist the comparison out of the loop into a closure factory:

```go
// Conceptually — actual implementation requires creativity
func makeEqual[T comparable]() func(T, T) bool {
    return func(a, b T) bool { return a == b }
}
```

Whether the compiler can devirtualize this depends on the call graph. Profile to confirm.

---

## Pitfall 3 — Lost inlining from generic body size

### The trap

A generic helper that would inline if hand-written may not inline because the generic version's estimated size includes dictionary instructions:

```go
func Apply[T any](f func(T) T, v T) T {
    return f(v)
}
```

When called in a tight loop, `Apply` itself is too big to inline. The hand-written equivalent inlines and `f(v)` becomes a direct call.

### How to spot

```bash
go build -gcflags="-m=2" 2>&1 | grep "cannot inline"
```

Look for `cannot inline F[shape]` lines. Compare against a hand-written equivalent: did it inline?

### The fix

- Mark the body simpler — sometimes removing one return path helps the size estimate.
- Hand-write the hot specialization.
- Use PGO (1.21+): if `Apply[int]` is hot, PGO can cause the compiler to specialise and inline it.

```bash
# Profile-guided optimization
go test -bench=. -cpuprofile=cpu.pprof
go build -pgo=cpu.pprof
```

PGO is the most promising tool for closing the generic-vs-hand-written inlining gap.

---

## Pitfall 4 — Escape-analysis surprises

### The trap

A function that did not escape its argument suddenly does, after being made generic:

```go
// Before
func ProcessInt(v int) { use(v) }

// After
func Process[T any](v T) { use(v) }
```

The generic version may force `v` to escape to the heap because the compiler cannot prove `v` does not escape across all instantiations.

### How to spot

```bash
go build -gcflags="-m=2"
```

Look for:
```
./gen.go:5:18: leaking param: v
./gen.go:5:18: moved to heap: v
```

Compare against the non-generic version's output.

### The fix

- Specialise: hand-write the function for the hot type, keep generic for cold ones.
- Pass pointers explicitly: `func Process[T any](p *T)` — pointers have predictable escape behaviour.
- Avoid passing generic values into things that **store** them (channels, callbacks, packages we do not control).

```go
// Avoid this in hot paths
go func() { Process(v) }() // value escapes into goroutine

// Prefer
go func(v T) { Process(v) }(v) // explicit copy
```

---

## Pitfall 5 — Type-switch fast paths that backfire

### The trap

```go
func Marshal[T any](v T) ([]byte, error) {
    switch x := any(v).(type) {
    case []byte: return x, nil
    case string: return []byte(x), nil
    }
    return json.Marshal(v) // slow path
}
```

The intent: speed up `[]byte` and `string` cases. The reality: the type switch **always** boxes through `any`, even for types that hit the fast path. The boxing cost can dominate for very small values.

### How to spot

Benchmark each branch separately:
```go
func BenchmarkMarshalString(b *testing.B) { ... }
func BenchmarkMarshalBytes(b *testing.B) { ... }
func BenchmarkMarshalStruct(b *testing.B) { ... }
```

Compare with a non-generic equivalent. If the generic is slower for the type-switched cases, the boxing overhead exceeds the JSON savings.

### The fix

Provide non-generic specialisations:
```go
func MarshalBytes(b []byte) ([]byte, error) { return b, nil }
func MarshalString(s string) ([]byte, error) { return []byte(s), nil }
func Marshal[T any](v T) ([]byte, error) { return json.Marshal(v) }
```

Callers who know they have `[]byte` use `MarshalBytes`; everyone else uses `Marshal`.

---

## Pitfall 6 — `reflect` inside generic body

### The trap

```go
func Clone[T any](v T) T {
    rv := reflect.ValueOf(v)
    nv := reflect.New(rv.Type()).Elem()
    nv.Set(rv)
    return nv.Interface().(T)
}
```

Reflection is **5-50x** slower than direct operations. Wrapping it in a generic gives type-safety to the caller but pays the reflection cost on every call. The generic gives no performance benefit.

### How to spot

```bash
go test -bench=BenchmarkClone -benchmem
```

Look for high allocation counts and `reflect.*` in CPU profile.

### The fix

- For shallow copy, `var nv T; nv = v; return nv` works for most types and is **free**.
- For deep copy, accept that you need reflection — but skip the generic wrapper. Just use `interface{}` and keep the API honest.
- For performance-critical types, hand-write the copy.

```go
func Clone[T any](v T) T {
    return v // for non-pointer types, this is a copy
}
// User must implement deep copy themselves for pointer-bearing T
```

---

## Pitfall 7 — Cross-package instantiation hits build cache

### The trap

A widely-used generic helper triggers stencil generation in every importing package:

```go
// pkg/genericx/find.go
func Find[T comparable](s []T, t T) int { ... }
```

Used by 100 packages, each with different `T`. The build cache has 100 entries. Modifying the function invalidates them all. CI clean builds slow down.

### How to spot

```bash
go tool nm $(go env GOCACHE)/...
```

Or inspect the binary:
```bash
go tool nm yourbinary | grep Find
```

You see many `pkg.Find[go.shape.X]` symbols.

### The fix

For very hot, very widely-used helpers, provide non-generic wrappers in a stable place:

```go
// pkg/genericx/concrete.go
func FindInt(s []int, t int) int { return Find(s, t) }
func FindString(s []string, t string) int { return Find(s, t) }
```

The wrapper instantiation happens in `genericx` once, not in each caller. Callers import the concrete wrapper instead of instantiating the generic themselves.

This is overkill for normal projects. Use it only when CI build time is a measurable problem and profiling has confirmed generic instantiation as the cause.

---

## Detection toolkit

The five tools every senior engineer should run on a generic-heavy codebase:

### 1. `-gcflags=-m`

Inlining decisions and escape analysis:
```bash
go build -gcflags="-m=2" ./... 2>&1 | grep -E "(cannot inline|escapes to heap)"
```

### 2. `go test -benchmem`

Allocation counts:
```bash
go test -bench=. -benchmem -count=10
```

Compare allocations between generic and hand-written versions.

### 3. `go test -cpuprofile`

Hot paths:
```bash
go test -bench=. -cpuprofile=cpu.out
go tool pprof -http=:8080 cpu.out
```

Look for `[go.shape.X]` symbols dominating the profile.

### 4. `go tool nm`

Binary inspection:
```bash
go tool nm binary | grep -E "go\.shape" | sort | uniq -c | sort -rn
```

Reveals duplicate stencils.

### 5. PGO (1.21+)

Profile-guided optimization:
```bash
go test -bench=. -cpuprofile=default.pgo
go build -pgo=default.pgo
```

PGO can monomorphize hot generic call paths automatically.

---

## Fix patterns

### Pattern 1 — Hand-written specialisation

When profiling shows a generic helper as hot, write a non-generic version for the dominant type:

```go
func Find[T comparable](s []T, t T) int { ... } // generic, cold
func FindHot(s []HotType, t HotType) int { ... } // specialised, hot
```

### Pattern 2 — Hoist the dictionary lookup

Instead of paying the dictionary cost per iteration, prepare the operation once:

```go
// Conceptual
func MakeFinder[T comparable](target T) func([]T) int {
    return func(s []T) int {
        for i, v := range s {
            if v == target { return i }
        }
        return -1
    }
}
```

### Pattern 3 — Constrain to avoid `any`

If the body needs `==`, use `comparable`. If it needs `<`, use `cmp.Ordered`. Tightening the constraint enables more compiler optimization.

### Pattern 4 — Wrapper for the hot caller

Provide a non-generic wrapper that the hot caller uses:

```go
func Find[T comparable](s []T, t T) int { ... }
func FindInt(s []int, t int) int { return Find(s, t) }
```

### Pattern 5 — Use stdlib

Stdlib `slices`, `maps`, `cmp` are heavily optimised. Replace home-grown helpers with them whenever possible.

```go
// Before
func Contains[T comparable](s []T, t T) bool { ... }

// After
import "slices"
slices.Contains(s, t)
```

---

## Summary

The seven UX-driven performance pitfalls of generics:

1. **Implicit boxing** through `any(v)` allocates interface headers in tight loops.
2. **Dictionary lookups** for `==` and methods cost a few nanoseconds per call.
3. **Lost inlining** turns one-line generics into regular calls.
4. **Escape analysis** sometimes makes `v` heap-allocate where the non-generic equivalent did not.
5. **Type-switch fast paths** can underperform because boxing is paid even for the fast cases.
6. **`reflect` inside generic** removes the type-safety benefit while keeping the cost.
7. **Cross-package instantiation** affects build cache and binary size.

Each is a UX trap: code that compiles and runs correctly, but costs measurable resources. The remedy is the same triplet: **profile**, **specialise hot paths**, **lean on stdlib**.

A senior engineer treats every "let's make this generic" PR as a candidate for performance review. A junior assumes generics are free; a senior knows they are usually free, but verifies.

The single best habit: when generic code lives on a hot path, **benchmark before and after**, look for `[go.shape.X]` in the profile, and write a non-generic specialisation if the numbers warrant it.
