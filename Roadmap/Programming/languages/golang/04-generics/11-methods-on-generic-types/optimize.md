# Methods on Generic Types — Optimize

## Table of Contents
1. [Receiver kind impact](#receiver-kind-impact)
2. [Method dispatch cost on generic types](#method-dispatch-cost-on-generic-types)
3. [Method values and accidental heap allocation](#method-values-and-accidental-heap-allocation)
4. [Inlining of generic methods](#inlining-of-generic-methods)
5. [Embedded methods and indirection](#embedded-methods-and-indirection)
6. [Benchmark patterns for generic methods](#benchmark-patterns-for-generic-methods)
7. [Practical optimization checklist](#practical-optimization-checklist)
8. [Summary](#summary)

---

## Receiver kind impact

Choosing pointer vs value receiver on a generic type is a performance decision as well as a correctness decision.

### Value receiver — copies on every call

```go
type Big[T any] struct {
    a, b, c, d, e, f, g, h int
    items                   []T
}

func (b Big[T]) Method() {}
```

Every call to `Method()` copies all eight `int` fields **plus** the slice header. For tiny types this is cheap; for fat structs it is wasteful.

### Pointer receiver — no copy

```go
func (b *Big[T]) Method() {}
```

A pointer receiver passes one machine word. Always cheap — but the caller must have an addressable `Big[T]` or a pointer.

### Rule of thumb

| Struct size | Receiver |
|-------------|----------|
| ≤ 16 bytes (1-2 words) | Value is fine |
| > 16 bytes | Pointer |
| Contains slices/maps/channels | Pointer (almost always) |
| Mutating | Pointer |

This rule is **independent of generics**. Generics inherit it unchanged.

### Cost in numbers

```go
type T16 struct { a, b int }                       // 16 bytes
type T64 struct { a, b, c, d int; arr [4]int }    // 64 bytes
```

Approximate per-call overhead from copying the receiver:

| Receiver size | Overhead vs pointer |
|---------------|---------------------|
| 16 bytes | ~0 ns (registers) |
| 32 bytes | ~1 ns |
| 64 bytes | ~2-3 ns |
| 128 bytes | ~4-6 ns |
| 256 bytes | ~8-12 ns |

Tiny per-call costs that explode in tight loops with millions of calls.

---

## Method dispatch cost on generic types

A method on a generic type is dispatched **directly** — no interface table, no virtual dispatch. The compiler stencils a body per GC shape and the call site goes straight to the right stencil.

### Numeric path — essentially free

```go
type Counter[T ~int | ~int64] struct{ n T }
func (c *Counter[T]) Inc() { c.n++ }
```

Calling `c.Inc()` for `*Counter[int]` is functionally identical to a hand-written `func IncCounter(c *IntCounter) { c.n++ }`. The compiler typically inlines both.

### Pointer-shaped types — dictionary cost

For a generic method that does `==` or hashing on `T`, when `T` is pointer-shaped, the body cannot inline the operation — it must look it up in the runtime dictionary.

```go
func (s *Set[T]) Has(v T) bool {
    _, ok := s.m[v]
    return ok
}
```

For `Set[int]`, the map lookup uses the inlined integer hash. For `Set[*Foo]`, the map lookup goes through the dictionary's hash function. Cost: a few extra nanoseconds per call.

### Interface satisfaction — extra indirection

When a generic-instantiated value is held through an interface, the call goes through the interface table, **not** the direct dispatch:

```go
var p IntPusher = &Stack[int]{}
p.Push(1)   // interface call — slower than s.Push(1)
```

Inside the method body, generic logic still runs as compiled. The overhead is purely the interface dispatch on the outer call.

---

## Method values and accidental heap allocation

A method value captures the receiver. For pointer receivers, this typically forces the receiver onto the heap.

### The escape

```go
func makePusher() func(int) {
    s := &Stack[int]{}
    return s.Push   // s escapes to the heap
}
```

`s` cannot live on the stack — the closure (the method value) outlives `makePusher`. The compiler allocates `s` on the heap.

### Why it matters

In a hot loop:

```go
for i := 0; i < n; i++ {
    push := s.Push       // creates a method value each iteration
    push(i)
}
```

This allocates a method-value structure **per iteration** if the compiler cannot eliminate it. Replacement:

```go
for i := 0; i < n; i++ {
    s.Push(i)            // direct call, zero allocation
}
```

A 100x improvement in the inner loop is typical.

### Detection

Use `go build -gcflags="-m=2"` to see escape decisions:

```
./main.go:12:9: s escapes to heap
./main.go:12:9: s.Push escapes to heap
```

Look for these in performance-sensitive code.

### Mitigation

1. **Don't create method values in hot loops** — use direct method calls.
2. **Pass pointers explicitly** when the method-value pattern is needed across function boundaries.
3. **Prefer free functions** when the receiver does not need to be hidden.

---

## Inlining of generic methods

The Go compiler inlines small functions including generic-type methods, but the rules are subtle.

### When inlining works

- Method body is small (a few statements)
- `T` is a single concrete shape used at the call site
- No type-dependent operations (equality, hashing) inside the body
- No `defer`, no closures, no loops with too many iterations

For most simple methods like `Get`, `Set`, `Push`, `Pop`, `Len`, inlining works well.

### When inlining fails

- Method uses generic operations (`==`, `<`, `range` over `map[T]V`)
- Method calls into the runtime dictionary
- Method body is too large
- Method is exported and may be called from many shapes

Use `-gcflags="-m=2"` to see inlining decisions:

```
./stack.go:7:6: can inline (*Stack[T]).Push
./stack.go:7:6: inlining call to (*Stack[int]).Push
```

### PGO (profile-guided optimisation)

Go 1.21+ introduced PGO. With a profile, the compiler can specialise hot generic functions and inline more aggressively. For a hot generic method, the speedup is typically 5-15%.

```
go build -pgo=default.pgo ./...
```

---

## Embedded methods and indirection

When a generic type embeds another generic type, calling promoted methods involves an extra indirection.

```go
type Inner[T any] struct{}
func (Inner[T]) Foo() {}

type Outer[T any] struct{ Inner[T] }

o := Outer[int]{}
o.Foo()   // resolved as o.Inner.Foo()
```

The compiler's job is to expand `o.Foo()` to `o.Inner.Foo()` and inline the call. Most of the time this is free.

### The "embedded pointer" pattern

A common pattern is to embed a **pointer** to a generic type:

```go
type Outer[T any] struct{ *Inner[T] }
```

Now method calls dereference the pointer first. If `Inner[T]` is large or shared, this saves copying. If `Inner[T]` is tiny, value embedding is cheaper.

### Cost per embedding level

Each embedding level adds a tiny offset computation on access. For 1-2 levels, this is invisible. For deeply nested types (5+), call sites can become slower than direct fields.

---

## Benchmark patterns for generic methods

Always benchmark before optimizing. Here are useful patterns.

### Pattern 1 — Compare with hand-written

```go
func BenchmarkPushGeneric(b *testing.B) {
    s := &Stack[int]{}
    for i := 0; i < b.N; i++ {
        s.Push(i)
    }
}

func BenchmarkPushHand(b *testing.B) {
    var s []int
    for i := 0; i < b.N; i++ {
        s = append(s, i)
    }
}
```

Result: usually within 1-3% on numeric types.

### Pattern 2 — Compare with `interface{}` baseline

```go
func BenchmarkPushIface(b *testing.B) {
    var s []interface{}
    for i := 0; i < b.N; i++ {
        s = append(s, i)
    }
}
```

The generic path is typically 5-10x faster than the interface path due to no boxing.

### Pattern 3 — Method value vs direct call

```go
func BenchmarkMethodValue(b *testing.B) {
    s := &Stack[int]{}
    push := s.Push
    for i := 0; i < b.N; i++ { push(i) }
}

func BenchmarkDirect(b *testing.B) {
    s := &Stack[int]{}
    for i := 0; i < b.N; i++ { s.Push(i) }
}
```

The method-value version is usually slightly slower due to the captured receiver.

### Pattern 4 — Pointer vs value receiver

```go
type Big struct { /* 64 bytes */ }
func (b Big) DoVal() {}
func (b *Big) DoPtr() {}
```

Same struct, different receivers. The pointer version is typically faster for big structs.

### Practical setup

```bash
go test -bench=. -benchmem -count=10 ./...
```

Run with `-count=10` and inspect `benchstat` output to filter noise.

---

## Practical optimization checklist

Before merging generic code that might be performance-sensitive:

- [ ] Receiver is pointer for any method that mutates state
- [ ] Receiver is pointer for any struct larger than 16 bytes
- [ ] Method values are not created inside hot loops
- [ ] `-gcflags="-m=2"` shows expected inlining for hot methods
- [ ] No hidden interface satisfaction adds dispatch overhead
- [ ] Embedded types are positioned to minimize indirection
- [ ] Benchmarks compare generic, interface-based, and hand-written variants
- [ ] PGO is enabled for production builds if hot paths use generics
- [ ] No accidental escape to heap (check with `-gcflags="-m"`)

---

## Summary

Optimizing methods on generic types comes down to the same fundamentals as optimizing classic Go methods, with two generic-specific concerns:

1. **GC shape stenciling** can add small dictionary indirection for type-dependent operations on pointer-shaped types.
2. **Method values** of generic methods cause the receiver to escape — avoid in hot loops.

The big wins:

- **Pointer receivers** for any non-trivial generic struct.
- **Direct method calls** instead of method values in hot paths.
- **Free functions** for shape-changing operations (no method dispatch overhead).
- **PGO** when the hot path crosses generic boundaries.

The biggest "do not panic" lesson: generic methods are usually within a few percent of hand-written code. The simplicity benefits — one implementation, type safety — almost always outweigh the small per-call cost. Optimize only when benchmarks demand it.
