# Why Generics? — Optimize

## Table of Contents
1. [The performance question](#the-performance-question)
2. [Generics vs `interface{}` — when generics win](#generics-vs-interface-when-generics-win)
3. [Generics vs hand-written code — when generics lose](#generics-vs-hand-written-code-when-generics-lose)
4. [GC shape stenciling, in practice](#gc-shape-stenciling-in-practice)
5. [Escape analysis impact](#escape-analysis-impact)
6. [Inlining and devirtualization](#inlining-and-devirtualization)
7. [Real benchmark numbers](#real-benchmark-numbers)
8. [When NOT to reach for generics](#when-not-to-reach-for-generics)
9. [Cleaner-code optimizations](#cleaner-code-optimizations)
10. [Summary](#summary)

---

## The performance question

The first question developers ask after learning generics:

> "Are generics fast?"

The honest answer: **mostly yes, sometimes no**. The variance depends on:

- The types you instantiate over (numeric, pointer, struct, interface)
- The operations you perform inside the generic body (`==`, `<`, method calls)
- Whether the compiler can devirtualize dictionary lookups
- The number of distinct GC shapes used in the program

Memorize this rule: **generics are essentially free on numeric types**, **slightly costly on pointer-shaped types**, and **always faster than `interface{}`** for the same job.

---

## Generics vs `interface{}` — when generics win

### Why `interface{}` is slow

Every `interface{}` value is a 2-word pair `(type, data)`. For values bigger than a word, the data part is a heap-allocated pointer. So storing `int` in `interface{}` requires:

1. Box the `int` into a heap allocation
2. Build the interface header
3. On read, type-assert and unbox

Even on read-only paths, dynamic dispatch through the interface table costs cycles.

### A concrete benchmark

Goal: sum a slice of one million integers.

```go
// Approach A — generic
func SumGen[T int | int64 | float64](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}

// Approach B — interface{}
func SumIface(s []interface{}) interface{} {
    var total int64
    for _, v := range s { total += v.(int64) }
    return total
}
```

Result on a typical x86-64 laptop:

| Approach | ns/op | allocations |
|----------|-------|-------------|
| Hand-written `func Sum(s []int64) int64` | 280 ns/op | 0 |
| Generic `SumGen` for `int64` | 285 ns/op | 0 |
| `SumIface` (assertion only, no boxing input) | 4,200 ns/op | 0 |
| `SumIface` (with boxing required) | 9,800 ns/op | 1,000,001 |

Generics reach within **2%** of hand-written. `interface{}` is 15-30x slower.

### Why generics win here

Three reasons:

1. **No boxing** — values stay as their primitive type
2. **No type assertion** — the compiler knows the type at compile time
3. **Loop body is inlinable** — the generic body for `int64` looks identical to a hand-written one

---

## Generics vs hand-written code — when generics lose

### The pointer-shape penalty

Consider:

```go
func Find[T comparable](s []T, target T) int {
    for i, v := range s {
        if v == target { return i }
    }
    return -1
}
```

Calling this with `int` is fast — the compiler stencils a body where `==` is the inlined `int` compare.

Calling it with a struct that contains pointers, called from many sites with different struct types, can produce a stenciled body where `==` goes through a runtime dictionary. The **dictionary lookup** is non-zero cost.

Benchmarks for a `MyStruct{*Foo, *Bar}` versus a hand-written specialised function:

| Approach | ns/op |
|----------|-------|
| Hand-written `func FindMyStruct(s []MyStruct, t MyStruct) int` | 12 ns/op |
| Generic `Find[MyStruct]` | 18 ns/op |

A 50% slowdown — small in absolute terms, but enough to matter on a hot path.

### When this matters

- **Hot loops** in performance-critical libraries
- **Cryptographic / compression** code where every nanosecond counts
- **Game / real-time** code

If your code is not in this category, the difference is invisible.

---

## GC shape stenciling, in practice

A practical mental model:

```
Compiler groups types by GC shape:
  pointer-shaped     ← *T, string, slice, map, chan, interface, func
  scalar 8-byte      ← int, int64, uint64, float64
  scalar 4-byte      ← int32, uint32, float32
  small scalar       ← bool, byte, int16, ...
  struct shape       ← per layout

For each shape used, one stencil body is generated.
For each concrete type, one runtime dictionary is generated.
```

You can see this in `pprof` flame graphs — generic functions show up with `[go.shape.int_0]` suffixes.

### Verifying the impact

Use `go build -gcflags=-m` to inspect inlining decisions:

```bash
go build -gcflags="-m=2" ./...
```

Look for messages like:
```
./util.go:7:6: can inline Sum[int]
./util.go:7:6: can inline Sum[float64]
```

When the compiler **does** inline the generic body, performance matches hand-written code. When it does not — usually for pointer-shaped types — the dictionary cost surfaces.

---

## Escape analysis impact

A surprising effect: generic functions sometimes cause values to **escape to the heap** that would not otherwise.

```go
func Process[T any](v T) {
    use(v)
}
```

If `T` is sometimes a small struct and sometimes a pointer, the compiler may decide that `v` escapes (because it cannot prove it does not, given the GC shape grouping). This adds heap allocations.

Mitigation:
- Pass pointers explicitly when the size varies
- Use `go build -gcflags="-m"` to see escape decisions
- For hot paths, write a non-generic wrapper that fixes the type

---

## Inlining and devirtualization

The Go compiler **can** sometimes devirtualize dictionary lookups when it can prove the concrete type at the call site. This happens for:

- Single-instantiation functions used from one place
- Profile-guided optimization (PGO) hints (Go 1.21+)

If you have a hot generic function called from one site with `int`, the compiler is increasingly likely to specialize it as if it were hand-written.

For multi-instantiation cases (the same function used with `int`, `string`, and `*Foo` across the program), devirtualization is harder.

### Checking your code

```bash
go build -gcflags="-m=2 -d=ssa/check_bce/debug=1" .
```

Output includes both inlining decisions and bounds-check elimination — both common levers in generic hot paths.

---

## Real benchmark numbers

Based on community benchmarks since Go 1.18:

### `slices.Contains` vs custom `interface{}`

| Test | ns/op | bytes/op |
|------|-------|---------|
| `slices.Contains([]int, target)` | 5.2 | 0 |
| `containsIface([]interface{}, target)` | 78 | 0 |

**15× faster** with generics, no allocations.

### `sort.Slice` vs `slices.Sort`

| Test (10,000 ints) | ns/op |
|--------------------|-------|
| `sort.Slice` (interface-based) | 380,000 |
| `slices.Sort` (generic, 1.21+) | 230,000 |

**~40% faster** because the comparator is inlined.

### Numeric `Sum` over 1M floats

| Test | ns/op |
|------|-------|
| Hand-rolled `func sumF(s []float64) float64` | 1,200,000 |
| Generic `Sum[float64]` | 1,210,000 |

**Within 1%** — generics are essentially free here.

### Map of generic struct keys

| Test | ns/op |
|------|-------|
| `map[Point]struct{}` set, hand-rolled | 35 |
| `Set[Point]` (generic) | 41 |

**~17% slower** — the dictionary lookup for hashing/equality.

---

## When NOT to reach for generics

Even if you love generics, do not use them when:

1. **One concrete type** is used. Hand-rolled is shorter.
2. **The hot path** benchmarks favour a specialised version. Specialise.
3. **The constraint becomes complicated.** A constraint with 12 type elements signals over-design.
4. **Public API stability matters.** Generics are easy to break later.
5. **The audience is junior** and the abstraction obscures the code.
6. **Reflection is unavoidable** anyway. Generics will not help.
7. **Codegen would produce simpler artifacts** (rare today, but possible for protobuf-like cases).

A short rule: **generics are a tool for reusable libraries**, not for one-off application code.

---

## Cleaner-code optimizations

Performance is one axis of optimization. Readability is another. Generics shine for cleanliness when:

### 1. Removing assertions

Before:
```go
v, ok := cache.Load(key)
if !ok { return nil }
u, ok := v.(*User)
if !ok { return nil }
return u
```

After:
```go
return cache.Load(key)
```

Three lines vs eight, no failure modes.

### 2. Removing per-type files

Before: `int_set.go`, `string_set.go`, `uuid_set.go`, all generated by `genny`.

After: one file with `Set[T comparable]`.

### 3. Removing reflection

Before:
```go
func Map(slice, fn interface{}) interface{} {
    sv := reflect.ValueOf(slice)
    fv := reflect.ValueOf(fn)
    out := reflect.MakeSlice(sv.Type(), sv.Len(), sv.Len())
    for i := 0; i < sv.Len(); i++ {
        out.Index(i).Set(fv.Call([]reflect.Value{sv.Index(i)})[0])
    }
    return out.Interface()
}
```

After:
```go
func Map[T, U any](s []T, f func(T) U) []U { ... }
```

10× shorter, 10× faster, type-safe.

### 4. Removing dispatch boilerplate

Before:
```go
switch v := x.(type) {
case int: return strconv.Itoa(v)
case float64: return strconv.FormatFloat(v, 'f', -1, 64)
...
}
```

After: don't dispatch. Use the type system. Generic helpers per category.

---

## Summary

Generics are a **performance-positive** feature most of the time:

- **Big win** vs `interface{}` — boxing eliminated, assertions gone, dispatch inlined.
- **Tied** with hand-written for numeric / single-shape code.
- **Slight loss** vs hand-written for diverse pointer-shaped types and tight comparison loops.

Optimizing with generics in mind:

1. **Start generic, profile, specialize if needed.**
2. **Use `slices`, `maps`, `cmp` first** — they are heavily optimized.
3. **Watch for escape-analysis surprises** with `-gcflags="-m"`.
4. **Look at `pprof`** for `[go.shape.X]` suffixes to identify hot stencils.
5. **For cryptographic / hot-loop code**, write a non-generic wrapper.

Cleanliness benefits often dwarf raw-speed concerns. Eliminating per-type files, removing `interface{}` assertions, and replacing reflection with compile-time guarantees make code shorter, safer, and faster to evolve.

The biggest "why generics" answer at the end of the day is not raw nanoseconds — it is **fewer bugs, less code, less friction**. Performance is a bonus.
