# Generic Constraints Deep Dive — Optimize

## Table of Contents
1. [Constraints and the call-site cost](#constraints-and-the-call-site-cost)
2. [Type-only constraints — the fast path](#type-only-constraints-the-fast-path)
3. [Method-bearing constraints — dictionary cost](#method-bearing-constraints-dictionary-cost)
4. [Mixed constraints — the worst-case shape](#mixed-constraints-the-worst-case-shape)
5. [Inlining and devirtualization](#inlining-and-devirtualization)
6. [Minimal vs maximal constraints](#minimal-vs-maximal-constraints)
7. [Constraint design for hot paths](#constraint-design-for-hot-paths)
8. [Benchmark patterns](#benchmark-patterns)
9. [Summary](#summary)

---

## Constraints and the call-site cost

Two kinds of cost flow from a generic function's constraint:

1. **Compile-time cost** — the compiler must stencil bodies and build dictionaries per shape.
2. **Run-time cost** — operations authorised by the constraint may go through a runtime dictionary if they cannot be inlined.

The **shape** of a constraint determines both. A senior performance engineer reads a constraint and predicts which costs will manifest.

### The mental model

```
Constraint            Body operations    Likely cost at runtime
---------------------------------------------------------------
[T any]               assignment only    free (no per-T ops)
[T comparable]        ==, !=             dictionary indirection for non-trivial T
[T cmp.Ordered]       <, <=, >, >=, ==   inlined for primitives, dict for others
[T Stringer]          v.String()         method dispatch through dictionary
[T ~int | ~float64]   + - * /            inlined (one stencil per shape)
[T ~[]E, E any]       len, indexing      inlined (slice ops are cheap)
```

The pattern: **type-only constraints over numeric types** are essentially free. **Method constraints** add dictionary lookups. **Heterogeneous constraints** with no core type may force the body to be slower than expected.

---

## Type-only constraints — the fast path

A constraint that lists only type elements (no methods) leads to the cleanest performance profile:

```go
type Numeric interface {
    ~int | ~int64 | ~float64
}

func Sum[T Numeric](s []T) T {
    var t T
    for _, v := range s { t += v }
    return t
}
```

For each **GC shape** (8-byte int, 8-byte float, 4-byte int) the compiler emits one stenciled body. Inside, `t += v` is a direct machine instruction — `add` for ints, `addsd` for floats. No dictionary, no indirection.

### Benchmark

Summing 1M `int64` values:

| Implementation | ns/op | allocations |
|----------------|-------|-------------|
| Hand-rolled `func Sum(s []int64) int64` | 280 | 0 |
| Generic `Sum[int64]` (Numeric) | 285 | 0 |
| Generic `Sum[int64]` (just `~int64`) | 285 | 0 |

Within 2%. The constraint shape did not matter — once the type is known, the body is the same machine code.

### Take-away

Use type-only constraints (`~int | ~float64 | ...`) for hot numeric paths. The compiler will not introduce overhead.

---

## Method-bearing constraints — dictionary cost

A constraint that requires a method authorises method calls inside the body, but those calls go through the **runtime dictionary** unless the compiler can devirtualize them.

```go
type Stringer interface { String() string }

func JoinStrings[T Stringer](xs []T, sep string) string {
    parts := make([]string, len(xs))
    for i, x := range xs { parts[i] = x.String() }
    return strings.Join(parts, sep)
}
```

Inside the loop, `x.String()` is dispatched via the dictionary entry for `T`'s `String` method. For each instantiation (`JoinStrings[Foo]`, `JoinStrings[Bar]`), the dictionary holds a pointer to the right `String` method.

### Cost

| Implementation | ns/op (1000 elements) |
|----------------|----------------------|
| Hand-rolled `JoinFoos([]Foo, sep)` | 4,500 |
| Generic `JoinStrings[Foo]` | 5,800 |
| `interface{}`-based `JoinStringers([]fmt.Stringer)` | 6,200 |

The generic version is 25-30% slower than the hand-rolled. But it is still faster than the `interface{}`/runtime-interface version because the compiler knows each `T` exactly and avoids per-call type assertions.

### When it matters

Method-bearing constraints are the **fast middle ground** between hand-written and `interface{}`. For most code, the difference is invisible. For tight loops in performance libraries, hand-rolling specific types may win.

---

## Mixed constraints — the worst-case shape

A constraint with **both** type elements and methods:

```go
type FormatInt interface {
    ~int
    String() string
}

func Format[T FormatInt](xs []T) []string {
    out := make([]string, len(xs))
    for i, x := range xs { out[i] = x.String() }
    return out
}
```

This combines the two cost models. The good news: the type element (`~int`) constrains the shape, so the compiler stencils a body specific to int-shaped types. The bad news: the `String()` call still goes through the dictionary.

In practice, the cost is dominated by the method call. A type-only `~int | ~int64 | ~float64` and a mixed `~int | ~int64; String() string` perform similarly **per call site**, but the mixed constraint accepts fewer types — which can be a feature, not a cost.

---

## Inlining and devirtualization

The Go compiler can sometimes turn a dictionary call into a direct call when:

- The generic function is called from one site with one type argument.
- Profile-guided optimization (PGO) marks the call hot (Go 1.21+).
- The function body is small enough to inline.

You can inspect inlining decisions:

```bash
go build -gcflags="-m=2" ./...
```

Output includes:

```
./fmt.go:7:6: can inline JoinStrings[Foo]
./fmt.go:9:18: inlined call to (Foo).String
```

When this happens, the generic call performs identically to a hand-rolled specialised version.

### What blocks inlining

- Many distinct instantiations of the same generic function (the compiler is conservative).
- Large bodies (over the inlining budget).
- Recursive generics.
- Constraints with many method elements.

### Helping the compiler

- **Keep generic bodies small.** Extract heavy logic into non-generic helpers.
- **Specialise hot paths.** A `JoinFoos` non-generic wrapper can delegate to a generic implementation; the compiler inlines aggressively for the wrapper.
- **Use PGO** (Go 1.21+) for production binaries with hot-path data.

---

## Minimal vs maximal constraints

A subtle performance lever: **looser constraints often produce faster code** than tighter ones.

### Counter-intuitive but true

```go
// Tight constraint — accepts only Stringer types
func Print[T fmt.Stringer](xs []T) { for _, x := range xs { fmt.Println(x.String()) } }

// Loose constraint — accepts anything, internally calls fmt.Sprintf
func Print2[T any](xs []T) { for _, x := range xs { fmt.Println(x) } }
```

`Print2` looks worse — `fmt.Println` calls reflection internally. But `Print2` does not need a dictionary (no methods on `T`). For very small slices, `Print2` may be faster because the dictionary setup cost dominates.

For large slices, `Print` is faster: amortised dictionary cost beats repeated reflection.

The lesson: the **shape of the workload** determines which constraint is fastest, not which constraint sounds tighter.

### Rule of thumb

- **Hot path with many calls per slice element** → tighter constraint pays off.
- **Cold path or tiny slices** → looser constraint may avoid setup costs.
- **Single-instantiation hot loops** → either works; the compiler inlines.

Benchmark before optimising.

---

## Constraint design for hot paths

When designing a constraint for a performance-critical helper, consider:

### 1. Prefer type-only constraints

Numeric and slice-shape constraints (`~int`, `~[]E`) generate inlinable bodies. Method constraints add dictionary indirection. If you can express the requirement structurally rather than behaviourally, do so.

### 2. Limit the union size

A union of 30 types may compile slower and produce more dictionary entries. Keep it focused: integers only, or floats only, or a single underlying shape.

### 3. Avoid heterogeneous shapes when possible

`~[]int | ~[]string` has no core type → many operations are forbidden. Designing around `[T ~[]E, E any]` lets the compiler stencil per shape and inline.

### 4. Specialise by hand if benchmarks demand

```go
// Generic version
func Sum[T Numeric](s []T) T { ... }

// Specialised hot wrapper
func SumInt(s []int) int { return Sum(s) }
```

The wrapper instantiates the generic for one type. The compiler tends to inline the call and produce code identical to a hand-rolled `SumInt`.

### 5. Use PGO for production

Profile-guided optimization helps the compiler decide which generic instantiations to specialise more aggressively. For binaries that run a lot of the same code path, PGO regularly recovers 5-10% on generic-heavy workloads.

---

## Benchmark patterns

### Pattern 1 — Compare constraints

```go
type Tight interface { ~int }
type Loose interface { ~int | ~int8 | ~int16 | ~int32 | ~int64 |
                        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 }

func SumT[T Tight](s []T) T { var t T; for _, v := range s { t += v }; return t }
func SumL[T Loose](s []T) T { var t T; for _, v := range s { t += v }; return t }

func BenchmarkSumT(b *testing.B) {
    s := make([]int, 1<<20)
    for i := 0; i < b.N; i++ { _ = SumT(s) }
}
func BenchmarkSumL(b *testing.B) {
    s := make([]int, 1<<20)
    for i := 0; i < b.N; i++ { _ = SumL(s) }
}
```

For most platforms, the two benchmarks produce identical numbers. The constraint shape does not affect the stenciled body for a single concrete instantiation.

### Pattern 2 — Compare type-only vs method-bearing

```go
type S interface { String() string }

func JoinM[T S](xs []T) string { /* uses x.String() */ }
func JoinT[T any](xs []T, get func(T) string) string { /* uses get(x) */ }
```

`JoinT` is often faster because the function value `get` can be inlined; the method dispatch via dictionary in `JoinM` cannot always be.

### Pattern 3 — pprof inspection

```bash
go test -bench=. -cpuprofile=cpu.prof
go tool pprof cpu.prof
(pprof) top
```

Look for symbols like `pkg.JoinStrings[go.shape.string]` — the `[go.shape.X]` suffix tells you the GC shape used. Multiple suffixes for the same function suggest multiple stencils, which means the binary is bigger and possibly the hot loops are missing inlining opportunities.

---

## Summary

Constraint shape governs both compile-time and run-time cost:

1. **Type-only constraints** over numeric or scalar shapes are essentially free.
2. **Method-bearing constraints** add a dictionary lookup per call.
3. **Mixed constraints** combine both costs but pay the higher of the two.
4. **Heterogeneous unions** without a core type forbid many operations and can force redesign.
5. **Inlining** can erase the dictionary cost for small, single-instantiation bodies.
6. **PGO** further helps in Go 1.21+.
7. **Looser constraints can be faster** for cold paths because they avoid setup.
8. **Benchmark before tightening** — the constraint that "feels right" is not always the fastest.

The golden rule: write the constraint that says **what the body needs**, no more. Then benchmark hot paths. If a tight constraint slows you down via dictionary lookups, loosen it; if a loose one prevents inlining, tighten it. The compiler's perspective on cost is sometimes the opposite of human intuition.

For most Go code, all of these concerns are invisible — generics are fast enough that you should design for clarity first and only profile when production data demands it.
