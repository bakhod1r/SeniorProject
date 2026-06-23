# Generic Performance — Optimize

## Table of Contents
1. [The performance loop: measure, change, re-measure](#the-performance-loop-measure-change-re-measure)
2. [Use concrete types in hot paths](#use-concrete-types-in-hot-paths)
3. [Avoid generic interfaces in tight loops](#avoid-generic-interfaces-in-tight-loops)
4. [Manual specialization](#manual-specialization)
5. [Reduce shape diversity](#reduce-shape-diversity)
6. [Inline-friendly bodies](#inline-friendly-bodies)
7. [Memory layout hints](#memory-layout-hints)
8. [PGO and warm-up](#pgo-and-warm-up)
9. [Summary](#summary)

---

## The performance loop: measure, change, re-measure

Optimization without measurement is guessing. The loop:

1. **Measure** — capture a benchmark and a `pprof` baseline.
2. **Hypothesise** — propose a single change.
3. **Apply** — make the change, ideally in a small commit.
4. **Re-measure** — same benchmark, same machine, same workload.
5. **Decide** — keep, revert, or iterate.

This file lists concrete, repeatable techniques that work in this loop.

---

## Use concrete types in hot paths

A non-generic version of a function on a hot path is often **the simplest and fastest** option. The cost is duplication; the benefit is no dictionary, no escape surprises, and easier inlining.

### The pattern

Keep the generic API for ergonomics, but route hot calls through a concrete wrapper:

```go
// Generic API
func Sum[T int | float64](s []T) T {
    var t T
    for _, v := range s { t += v }
    return t
}

// Hot-path wrapper
func sumIntsHot(s []int) int { return Sum(s) }
```

The compiler usually inlines `Sum` into `sumIntsHot`, producing the same code as a hand-written `sumInts`. Confirm with `-gcflags="-m=2"`.

### When to apply

- Single dominant type on the hot path
- Profile shows the generic body in the top 5 frames
- The hot path is in a leaf module with stable types

### When not to bother

- Cold paths, CLIs, batch jobs
- Code dominated by I/O — generic cost is invisible against syscall cost
- When the generic call site uses many distinct types

---

## Avoid generic interfaces in tight loops

A "generic interface" is a constraint with methods:

```go
type Hashable interface { Hash() uint64 }
func GroupBy[T Hashable](s []T) map[uint64][]T { ... }
```

This compiles, but every `t.Hash()` is a dictionary call. For tight loops, prefer a free function:

```go
func GroupBy[T any](s []T, hash func(T) uint64) map[uint64][]T { ... }
```

The `hash` parameter is a regular function value. The compiler can inline it when the call site passes a known function literal.

### Real cost difference

For 1,000,000 iterations:

| Pattern | ns/op |
|---------|-------|
| Method-on-constraint (`t.Hash()`) | 4,500,000 |
| `hash` parameter passed at call site | 1,800,000 |

About **2.5×** difference. The function-value pattern lets the compiler specialise per call site.

---

## Manual specialization

Go has no `func F[int](...)` specialization syntax. The workaround is to add a non-generic function for the hot type:

```go
func Find[T comparable](s []T, target T) int { ... }

func FindInt(s []int, target int) int {
    // hand-written, no dictionary
    for i, v := range s { if v == target { return i } }
    return -1
}
```

Callers on hot paths use `FindInt`; everyone else uses `Find`. The pattern keeps the generic API for ergonomics and gains a few nanoseconds where it matters.

### Verifying it pays off

Always benchmark. The dictionary cost is sometimes negligible — modern CPUs are good at predicting indirect calls when the target is stable.

---

## Reduce shape diversity

Each new GC shape adds a stencil. Reducing the variety of shapes in a binary shrinks the dictionary table and improves cache locality.

### Techniques

1. **Use the same underlying type** for related domain values where it makes sense:
    ```go
    type UserID = int64
    type OrderID = int64 // same shape as UserID
    ```
2. **Replace many one-off struct keys with a single canonical type**:
    ```go
    // Before: Cache[Foo], Cache[Bar], Cache[Baz] over distinct structs
    // After: a string-keyed cache with consistent encoding
    ```
3. **Avoid generic types parameterised by other generic types** unless necessary — each combination adds shapes.

### Trade-off

Reducing shape diversity sometimes means giving up a layer of typed abstraction. For most code this is a worthwhile trade. For domain-driven designs, balance carefully.

---

## Inline-friendly bodies

A generic body that inlines is essentially free — the dictionary disappears at compile time. Tactics to keep generics inlinable:

### 1. Keep the body small

The compiler has a budget per inlined function (controllable via `//go:nosplit` or compiler flags, but defaults are sane). A body under ~40 instructions usually inlines.

### 2. Avoid `defer`

`defer` disables inlining. If your generic uses `defer`, push the deferred work into a non-generic helper that the generic calls.

### 3. Avoid `recover`

`recover` implies `defer`, same effect.

### 4. Avoid runtime calls that the inliner does not understand

Some runtime calls are inline-blocked by the compiler. `reflect.Value` operations, certain `unsafe` patterns, and a few others.

### 5. Confirm with `-gcflags=-m=2`

If the compiler reports `can inline F[...]` and then `inlining call to F[...]`, you are good. If it reports `cannot inline ...`, identify why.

---

## Memory layout hints

For generic structs, layout matters more than for concrete structs because the same body is used across instantiations.

### Order fields by size

```go
type Pair[A, B any] struct {
    A A
    B B
}
```

`Pair[bool, int64]` has padding because Go aligns the `int64` to 8 bytes. Reordering fields helps when you can:

```go
type Pair[A, B any] struct {
    B B   // larger first
    A A
}
```

For generic types you cannot always force the order, but for concrete wrappers you can.

### Avoid pointer-rich generic structs on hot paths

A `Cache[K, V]` storing `*BigStruct` causes GC scanning of every entry. If the lifetimes are bounded, prefer storing values directly when feasible.

### Pre-size maps and slices

```go
m := make(map[K]V, expectedSize)
out := make([]T, 0, expectedSize)
```

The expected size avoids re-allocations. Especially relevant inside generic bodies that handle batch input.

---

## PGO and warm-up

### Profile-guided optimization

Since Go 1.21:

```bash
go test -bench=. -cpuprofile=default.pgo
go build -pgo=auto .
```

PGO devirtualizes generic call sites for the dominant types observed in the profile. Reported gains: 2-5% on real services with generic-heavy hot paths.

Refresh the profile periodically — once a month is enough for most services. Stale profiles can mislead the compiler.

### Warm-up

For short-lived processes (CLIs, AWS Lambda functions) the **first** generic call may be slower than subsequent ones because of cold cache lines on the dictionary. If startup matters:

1. Call the generic once during initialization with cheap input.
2. The dictionary loads into cache.
3. Production calls hit the warm path.

This adds a microsecond at startup and saves microseconds per request thereafter.

---

## Summary

Concrete optimisation techniques for generic Go code:

1. **Specialise hot paths** with a non-generic wrapper.
2. **Avoid generic interfaces in tight loops** — pass functions instead of using methods on constraints.
3. **Reduce shape diversity** to shrink dictionary tables and improve cache locality.
4. **Keep bodies inline-friendly** — small, no `defer`, no `recover`.
5. **Lay out structs carefully** to avoid padding waste.
6. **Use PGO** to let the compiler specialise based on real workloads.
7. **Warm up** when cold-start matters.

Each technique is testable. The optimization loop is **measure, change, re-measure** — every claim in this file should be verified for your specific workload.

The biggest unspoken rule: **most generic code does not need optimization at all**. Reach for these techniques only when a profile shows the generic in a hot frame. Premature optimization clutters the codebase with concrete wrappers and shape-reduction hacks that future maintainers will not understand.

Generics in Go are usually fast enough. When they are not, the techniques above recover the speed without giving up the ergonomic gains.
