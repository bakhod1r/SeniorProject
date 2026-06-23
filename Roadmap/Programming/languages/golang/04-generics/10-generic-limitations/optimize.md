# Generic Limitations — Optimize

## Table of Contents
1. [The cost of each workaround](#the-cost-of-each-workaround)
2. [Free function vs method](#free-function-vs-method)
3. [Type-switch via `any` cost](#type-switch-via-any-cost)
4. [Element-by-element copy cost](#element-by-element-copy-cost)
5. [Reflection vs interface vs codegen](#reflection-vs-interface-vs-codegen)
6. [Choosing the lowest-cost workaround](#choosing-the-lowest-cost-workaround)
7. [Profiling for limit-driven hot spots](#profiling-for-limit-driven-hot-spots)
8. [Summary](#summary)

---

## The cost of each workaround

Every generic limit forces you toward a workaround. Each workaround has a different runtime profile. The table is the cheat sheet:

| Workaround | Typical overhead | Allocations | Notes |
|------------|-------------------|-------------|-------|
| Free function (replacing method) | 0 ns | 0 | Compiles to identical code |
| `any(v).(type)` switch | 1-5 ns + possible alloc | 0-1 | Boxing if T is value-typed |
| Element-by-element copy | O(n) | 1 (the new slice) | Cannot be amortized |
| Cached reflection | ~50 ns first call, ~10 ns cached | 0 cached | Depends on cache hit rate |
| Codegen | 0 ns | 0 | Build-time cost only |
| Interface dispatch | ~1-2 ns | 0-1 | One v-table call |

The right workaround minimizes the overhead given the call frequency and the data size.

---

## Free function vs method

This is the cheapest workaround by far. The Go compiler generates **identical code** for:

```go
// Method version (forbidden because of new type parameter)
// func (b Box[T]) Map[U any](f func(T) U) Box[U] { return Box[U]{V: f(b.V)} }

// Free function workaround
func MapBox[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{V: f(b.V)}
}
```

The receiver `b` becomes a regular first parameter. The dictionary lookup mechanism is unchanged. The only "cost" is at the call site: `MapBox(b, f)` instead of `b.Map(f)`. There is no runtime difference.

### Benchmark sketch

```go
func BenchmarkMethodCall(b *testing.B) {
    s := &Stack[int]{}
    for i := 0; i < 1000; i++ { s.Push(i) }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = s.Len() // method call
    }
}

func BenchmarkFreeFunction(b *testing.B) {
    s := &Stack[int]{}
    for i := 0; i < 1000; i++ { s.Push(i) }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = LenStack(s) // equivalent free function
    }
}
```

Both run at the same speed. The compiler emits the same instructions.

### Conclusion

**Never** worry about the perf of switching from a method to a free function. The "cost" is purely ergonomic.

---

## Type-switch via `any` cost

This is where surprises happen. `any(v).(type)` looks innocuous but carries:

1. **Conversion to interface** — for value types, this allocates if escape analysis cannot prove the boxed value stays on the stack.
2. **Type tag dispatch** — the type switch compares the runtime type tag against each case.
3. **Loss of constant-folding** — the compiler cannot fold the switch at compile time.

### Benchmark numbers (illustrative)

For `T = int`:

| Approach | ns/op | allocs |
|----------|-------|--------|
| Direct branch on a constraint | 0.5 | 0 |
| `switch any(v).(type)` | 4-8 | 0-1 |
| Interface method call | 2-3 | 0 |

For `T = struct{a, b int}`:

| Approach | ns/op | allocs |
|----------|-------|--------|
| Direct field access | 0.3 | 0 |
| `switch any(v).(type)` | 8-15 | 1 (boxing) |
| Interface method call | 3-5 | 1 |

The boxing cost is the killer for value types. **Inside a hot loop**, this can dominate.

### Mitigations

1. **Hoist the switch out of the loop** — do the type analysis once, then loop with the resolved branch.
2. **Use an interface** if the per-type behaviour is real polymorphism.
3. **Specialize the hot path** — write a non-generic helper for the common type.

```go
// Slow:
for _, v := range items {
    switch x := any(v).(type) {
    case int: total += x
    case string: total += len(x)
    }
}

// Faster: dispatch once
switch first := any(items[0]).(type) {
case int:
    s := items.([]int) // (assuming convertibility)
    for _, v := range s { total += v }
case string:
    /* etc. */
}
```

---

## Element-by-element copy cost

When invariance forces you to convert `[]Cat` to `[]Animal`, the cost is unavoidable:

```go
animals := make([]Animal, len(cats))
for i, c := range cats { animals[i] = c }
```

For each element:
- One interface conversion (boxing).
- One slice store.

For `n` elements: O(n) operations and one allocation for the result slice. If `Cat` is a value type, **n** boxings happen. For pointer types it is just `n` stores.

### When this hurts

- A hot middleware that converts request slices on every call.
- A serialization layer that re-types elements before encoding.
- A data-pipeline node that must adapt slice element types.

### Mitigations

1. **Design with the broader type from the start** — accept `[]Animal` in the API, not `[]Cat`.
2. **Avoid the conversion** — work with `[]Cat` throughout if downstream consumers are flexible.
3. **Cache the converted slice** if the input does not change.
4. **Use `unsafe`** as a last resort to reinterpret memory — but only if the layouts genuinely match and you accept the safety cost. (Discouraged.)

---

## Reflection vs interface vs codegen

When the limit pushes toward a runtime mechanism, three choices remain. Compare:

### Reflection

Cost per call: ~50-200 ns uncached, ~10 ns cached.

```go
rv := reflect.ValueOf(v)
field := rv.FieldByName("Name") // ~100 ns
```

Best for one-shot operations on dynamic input (decode, validate). Disastrous in inner loops.

### Interface

Cost per call: ~1-2 ns. One v-table lookup, no allocation if the value is already an interface.

```go
type Named interface{ Name() string }
n := v.(Named).Name() // ~2 ns
```

Best for any time you can express the operation as a method.

### Codegen

Cost per call: 0 ns. Pre-compiled to direct calls.

```go
// Generated: type-specific function
func ProcessUser(u User) { /* direct field access */ }
```

Best for stable types where method sets must vary.

### The hierarchy

> **Use interfaces first. Reach for codegen when method sets vary per type. Use reflection only when the input is genuinely dynamic.**

Mixing the three is normal in mature codebases — typed interface API on top, reflection for serialization, codegen for client stubs.

---

## Choosing the lowest-cost workaround

A practical decision tree:

```
You hit a limit. Which workaround?

├─ Method needs new type param?
│  └─ Free function — 0 cost, no thought required.
│
├─ Type-switch on T?
│  ├─ Per-type behaviour really differs? → Interface (~2 ns)
│  └─ Just formatting / one-off? → any(v).(type) at boundary
│
├─ Container covariance?
│  ├─ Slice is small or static? → Element-by-element copy
│  └─ Slice is large + hot? → Restructure to use the broader type from the start
│
├─ HKT abstraction?
│  └─ Per-container free functions. Verbose, no perf cost.
│
├─ Specialization for hot type?
│  ├─ Profile-guided? → PGO; no code change
│  ├─ Critical path? → Hand-write a non-generic helper
│  └─ One-shot? → Inline the hot branch with any(v).(type)
│
└─ Dynamic per-type metadata?
   ├─ Stable types, small set? → Codegen
   ├─ Open type space? → Cached reflection
   └─ Single dispatch? → Interface
```

The rule of thumb: **prefer the workaround that compiles to direct code**. Free functions and codegen do; reflection and `any(v)` do not.

---

## Profiling for limit-driven hot spots

When you suspect a limit-driven workaround is hurting performance:

### 1. CPU profile

```bash
go test -cpuprofile=cpu.prof -bench=.
go tool pprof cpu.prof
```

Look for:
- `runtime.convT*` functions — boxing for `any(v)` conversions.
- `runtime.typeswitch*` — type-switch dispatch.
- `reflect.*` calls — reflection overhead.

If they appear in your hot path, the workaround cost is real.

### 2. Allocation profile

```bash
go test -memprofile=mem.prof -bench=.
go tool pprof -alloc_objects mem.prof
```

Look for allocations matching the rate of your `any(v)` calls. Each allocation is a boxing.

### 3. `-gcflags="-m"` to inspect escape analysis

```bash
go build -gcflags="-m=2" .
```

Look for messages like:
```
moved to heap: v (because of any(v) conversion)
```

If `v` escapes only because of the workaround, consider restructuring the call so the boxing happens once outside the loop.

### 4. PGO

```bash
# Record profile in production
go test -cpuprofile=prod.prof
# Build with PGO
go build -pgo=prod.prof .
```

PGO can devirtualize hot generic dispatches automatically. Even if you do not change a line of code, the compiler may specialize for the dominant instantiation.

---

## Summary

The generic limitations have **predictable** workaround costs:

| Workaround | Cost level |
|------------|-----------|
| Free function | None |
| Codegen | None (build-time only) |
| Element copy | Linear in slice size |
| Interface | Small (1-2 ns) |
| `any(v).(type)` | Small per call, big in hot loops |
| Reflection (cached) | Medium |
| Reflection (uncached) | Big |

Choose the lightest workaround for your use case:

1. **Lift methods to free functions without hesitation.** No cost.
2. **Use interfaces** when the limit pushes toward polymorphism.
3. **Reach for `any(v).(type)`** only at boundaries, never inside hot loops.
4. **Restructure away from element-by-element copy** when the hot path demands it.
5. **Cache reflection** if you must use it.
6. **Codegen** when method sets vary per type or when the perf budget rules out alternatives.

The biggest performance lesson: **the workaround you choose has more impact on speed than the limit itself**. A good workaround is invisible; a bad one shows up at the top of every flame graph. Profile, choose deliberately, and let the design follow the data.
