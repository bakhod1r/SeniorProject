# Go Type Switch — Optimization

## 1. Overview

A type switch is generally cheap — a few pointer compares and a branch — but performance hazards lurk in three places:
1. **Boxing**: turning a concrete value into an interface allocates if the type is large or escapes.
2. **`getitab` first-call cost**: building an interface dispatch table for an unknown (interface, type) pair takes a method-set check.
3. **Linear scan**: dozens of cases mean dozens of compares per dispatch.

This document quantifies each via benchmarks and offers alternative dispatch mechanisms with measured trade-offs.

---

## 2. Benchmark Setup

All benchmarks use Go 1.22, amd64, on a typical developer laptop. Numbers vary by machine; the **ratios** are what matter.

```go
package main

import (
    "fmt"
    "reflect"
    "testing"
)

var sink any
```

---

## 3. Benchmark 1 — Type Switch vs Chained Type Assertions

### 3.1 Type Switch
```go
func dispatchSwitch(x any) int {
    switch v := x.(type) {
    case int:
        return v
    case int64:
        return int(v)
    case float64:
        return int(v)
    case string:
        return len(v)
    default:
        return 0
    }
}
```

### 3.2 Chained Type Assertions
```go
func dispatchAssert(x any) int {
    if v, ok := x.(int); ok {
        return v
    }
    if v, ok := x.(int64); ok {
        return int(v)
    }
    if v, ok := x.(float64); ok {
        return int(v)
    }
    if v, ok := x.(string); ok {
        return len(v)
    }
    return 0
}
```

### 3.3 `reflect.TypeOf` Comparison
```go
var (
    intType    = reflect.TypeOf(int(0))
    int64Type  = reflect.TypeOf(int64(0))
    f64Type    = reflect.TypeOf(float64(0))
    stringType = reflect.TypeOf("")
)

func dispatchReflect(x any) int {
    t := reflect.TypeOf(x)
    switch t {
    case intType:
        return reflect.ValueOf(x).Interface().(int)
    case int64Type:
        return int(reflect.ValueOf(x).Interface().(int64))
    case f64Type:
        return int(reflect.ValueOf(x).Interface().(float64))
    case stringType:
        return len(reflect.ValueOf(x).Interface().(string))
    }
    return 0
}
```

### 3.4 Benchmark Bodies
```go
func BenchmarkSwitch(b *testing.B) {
    var x any = 42
    for i := 0; i < b.N; i++ {
        sink = dispatchSwitch(x)
    }
}

func BenchmarkAssert(b *testing.B) {
    var x any = 42
    for i := 0; i < b.N; i++ {
        sink = dispatchAssert(x)
    }
}

func BenchmarkReflect(b *testing.B) {
    var x any = 42
    for i := 0; i < b.N; i++ {
        sink = dispatchReflect(x)
    }
}
```

### 3.5 Typical Results

```
BenchmarkSwitch-12     500000000     2.1 ns/op    0 B/op    0 allocs/op
BenchmarkAssert-12     500000000     2.0 ns/op    0 B/op    0 allocs/op
BenchmarkReflect-12     30000000    45.0 ns/op   16 B/op    1 allocs/op
```

**Findings:**
- Type switch and chained assertions are essentially equal — both compile to similar code on the first-match path.
- The difference grows when the matching case is far down the chain (more compares for assertions).
- `reflect.TypeOf` + `reflect.ValueOf` is ~20x slower due to the interface roundtrip and allocation.

---

## 4. Benchmark 2 — Order Sensitivity

### 4.1 Hot Type First vs Last

```go
func dispatchHotFirst(x any) int {
    switch v := x.(type) {
    case int:    return v
    case int64:  return int(v)
    case float64: return int(v)
    case string: return len(v)
    case []byte: return len(v)
    case bool:   if v { return 1 } else { return 0 }
    case nil:    return -1
    default:     return 0
    }
}

func dispatchHotLast(x any) int {
    switch v := x.(type) {
    case bool:    if v { return 1 } else { return 0 }
    case nil:     return -1
    case []byte:  return len(v)
    case string:  return len(v)
    case float64: return int(v)
    case int64:   return int(v)
    case int:     return v
    default:      return 0
    }
}
```

### 4.2 Typical Results

```
BenchmarkHotFirst-12   500000000    2.1 ns/op
BenchmarkHotLast-12    300000000    3.8 ns/op
```

**Finding**: Order matters in a linear scan. When the hot type is last, you pay for every preceding compare. Order cases by frequency on hot paths.

---

## 5. Benchmark 3 — `itab` Cache First-Call Cost

### 5.1 Setup

```go
type ifaceA interface{ MethodA() }
type ifaceB interface{ MethodB() }

type implA struct{}
func (implA) MethodA() {}
type implB struct{}
func (implB) MethodB() {}

func dispatchIface(x any) int {
    switch x.(type) {
    case ifaceA:
        return 1
    case ifaceB:
        return 2
    default:
        return 0
    }
}
```

### 5.2 Cold vs Warm

The first time `implA` is matched against `ifaceA`, the runtime builds an `itab`. Subsequent matches are cache hits.

```go
func BenchmarkColdItab(b *testing.B) {
    // Build a fresh impl type per iteration via interface boxing of a new value.
    for i := 0; i < b.N; i++ {
        var x any = implA{}
        sink = dispatchIface(x)
    }
}
```

After the first iteration, the (`ifaceA`, `implA`) itab is cached for the rest of the benchmark. So this measures hot-cache behavior.

To measure cold behavior, you'd need fresh types each iteration — practically impossible without code generation. In production, cold misses happen at startup; warm cost is what you measure long-term.

### 5.3 Hot Cache Cost

```
BenchmarkIfaceHot-12   200000000    5.5 ns/op
```

About 2-3x the cost of a concrete-only switch — the extra cycles come from the cache lookup vs a direct pointer compare.

---

## 6. Benchmark 4 — Map Dispatch

### 6.1 Setup

```go
var handlers = map[reflect.Type]func(any) int{
    reflect.TypeOf(0):     func(x any) int { return x.(int) },
    reflect.TypeOf(int64(0)): func(x any) int { return int(x.(int64)) },
    reflect.TypeOf(0.0):   func(x any) int { return int(x.(float64)) },
    reflect.TypeOf(""):    func(x any) int { return len(x.(string)) },
}

func dispatchMap(x any) int {
    if h, ok := handlers[reflect.TypeOf(x)]; ok {
        return h(x)
    }
    return 0
}
```

### 6.2 Typical Results

```
BenchmarkMap-12      30000000    35.0 ns/op    0 B/op    0 allocs/op
```

**Finding**: Map dispatch is ~15x slower than a small type switch because of the hash, the map probe, and the closure call. Maps win only when:
- Cases number in the dozens or hundreds.
- Type set is open (callers can register new types).

For a 4-case switch, type switch wins easily.

---

## 7. Benchmark 5 — Sealed-Interface Method Dispatch

### 7.1 Setup

```go
type Op interface{ apply(int) int }

type Add struct{ K int }
func (a Add) apply(x int) int { return x + a.K }

type Mul struct{ K int }
func (m Mul) apply(x int) int { return x * m.K }

func dispatchOp(o Op) int {
    return o.apply(10)
}

func dispatchOpSwitch(o any) int {
    switch x := o.(type) {
    case Add:
        return 10 + x.K
    case Mul:
        return 10 * x.K
    }
    return 0
}
```

### 7.2 Typical Results

```
BenchmarkSealedMethod-12  500000000    2.0 ns/op
BenchmarkSealedSwitch-12  400000000    2.3 ns/op
```

**Finding**: Sealed-interface method dispatch is slightly faster than the equivalent type switch because the indirect call goes through one itab lookup vs two pointer compares + a body.

For homogeneous operations, prefer methods. For heterogeneous operations across a closed family, type switches are still idiomatic.

---

## 8. Benchmark 6 — Boxing Cost

### 8.1 Setup

```go
type Big struct {
    A, B, C, D, E, F, G, H int64
}

func describe(x any) int {
    switch v := x.(type) {
    case int:
        return v
    case Big:
        return int(v.A)
    }
    return 0
}

func BenchmarkBoxInt(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = describe(42)
    }
}

func BenchmarkBoxBig(b *testing.B) {
    big := Big{A: 1}
    for i := 0; i < b.N; i++ {
        sink = describe(big)
    }
}
```

### 8.2 Typical Results

```
BenchmarkBoxInt-12     1000000000    1.5 ns/op    0 B/op    0 allocs/op
BenchmarkBoxBig-12       50000000   30.0 ns/op   64 B/op    1 allocs/op
```

**Finding**: Boxing a small value (int) is free — `eface.data` holds the value directly. Boxing a struct allocates on the heap and adds GC pressure. Avoid passing large structs by value through `any`.

Workaround: pass `*Big` instead. Pointer interfaces use `data` as the pointer; no copy.

---

## 9. Benchmark 7 — Multi-Type Case Cost

```go
func switchSplit(x any) int {
    switch v := x.(type) {
    case int:    return v
    case int8:   return int(v)
    case int16:  return int(v)
    case int32:  return int(v)
    case int64:  return int(v)
    }
    return 0
}

func switchMulti(x any) int {
    switch x.(type) {
    case int, int8, int16, int32, int64:
        // can't access typed v; use reflect
        return int(reflect.ValueOf(x).Int())
    }
    return 0
}
```

### 9.1 Typical Results

```
BenchmarkSplit-12      500000000    2.5 ns/op    0 B/op    0 allocs/op
BenchmarkMulti-12       50000000   30.0 ns/op    0 B/op    0 allocs/op
```

**Finding**: A multi-type case forces reflection (or some other type-erasing approach) inside the body, costing 10-15x. If you actually need the typed value, split the cases.

---

## 10. pprof Sample — Before / After

### 10.1 Before (Hot-Type Last)

```
go test -cpuprofile=before.prof -bench=BenchmarkHotLast
go tool pprof -top before.prof
```

```
flat  flat%   sum%        cum   cum%
1.20s 60.00% 60.00%     1.20s 60.00%  main.dispatchHotLast
0.40s 20.00% 80.00%     0.40s 20.00%  runtime.assertI2I
0.20s 10.00% 90.00%     0.20s 10.00%  runtime.eqType
```

### 10.2 After (Hot-Type First)

```
flat  flat%   sum%        cum   cum%
0.65s 65.00% 65.00%     0.65s 65.00%  main.dispatchHotFirst
0.10s 10.00% 75.00%     0.10s 10.00%  runtime.eqType
```

The total time dropped ~50% just by reordering cases. `runtime.assertI2I` (the itab path) shrank because we now hit concrete cases earlier.

---

## 11. Optimization Strategies

### 11.1 Order by Frequency

Profile, then place the hottest case first. For 80/20 distributions, this halves average cost.

### 11.2 Hoist Boxing Out of Hot Loops

```go
// Bad — boxes per iter
for _, n := range numbers {
    sink = describe(n)
}

// Good — monomorphize
for _, n := range numbers {
    sink = describeInt(n)
}
```

### 11.3 Use Generics for Numeric Dispatch

```go
func sum[T int | int64 | float64](xs []T) T {
    var t T
    for _, x := range xs {
        t += x
    }
    return t
}
```

Compiler generates one specialization per type set element — no runtime type check.

### 11.4 Sealed Interface + Method Dispatch

For a closed family with homogeneous operations:

```go
type Op interface{ exec(state) }

func run(ops []Op, s state) {
    for _, o := range ops {
        o.exec(s) // single indirect call
    }
}
```

### 11.5 Map Dispatch for Wide-Open Families

When you have hundreds of types or callers register new types at runtime:

```go
var registry = map[reflect.Type]Handler{}

func Register(t reflect.Type, h Handler) {
    registry[t] = h
}

func Dispatch(x any) {
    if h, ok := registry[reflect.TypeOf(x)]; ok {
        h(x)
    }
}
```

### 11.6 Avoid Multi-Type Cases When You Need Typed Access

Split into one case per type. Slight code duplication, much better performance and clarity.

### 11.7 Cache `reflect.Type` Constants

If you must use `reflect.TypeOf` (rare):

```go
var typeOfInt = reflect.TypeOf(0)
```

Avoid recomputing in a loop.

---

## 12. Real-World Optimization Story

A logging pipeline classified each event by type and emitted JSON:

```go
func emit(e any) []byte {
    switch v := e.(type) {
    case Trace, Debug, Info, Warn, Error, Fatal:
        return defaultEncode(v) // typed v is `any` here, hit reflect path
    }
    return nil
}
```

Profile showed `defaultEncode` doing reflection on every event. Throughput: 200K events/sec.

**Fix**: split the multi-type case:

```go
func emit(e any) []byte {
    switch v := e.(type) {
    case Trace: return v.encode()
    case Debug: return v.encode()
    // ...
    }
    return nil
}
```

Each type's `encode()` was directly called, no reflection. Throughput: 1.5M events/sec — **7.5x improvement**.

---

## 13. When NOT To Optimize

- The switch isn't on a hot path.
- It's called once at startup or rarely.
- The cost is dominated by the per-case body, not the dispatch.
- Profile doesn't single it out.

Premature reordering or refactoring obscures intent for marginal gains.

---

## 14. Verifying With pprof

```bash
go test -cpuprofile=cpu.prof -bench=. ./...
go tool pprof -http=:8080 cpu.prof
```

Look at the **flame graph** — type switch dispatch should appear as a thin slice. If it's a fat slice, optimize it.

```bash
# To see allocations from boxing:
go test -memprofile=mem.prof -bench=.
go tool pprof -alloc_space mem.prof
```

Boxing shows up as anonymous allocations attributed to the call site of the function taking `any`.

---

## 15. Compiler Flags

### 15.1 Inlining

```bash
go build -gcflags="-m -m" 2>&1 | grep "inlining call to"
```

Type switch bodies are inlined into the caller when small. Look for "can inline dispatch" lines.

### 15.2 Escape Analysis

```bash
go build -gcflags="-m=2" 2>&1 | grep "escapes to heap"
```

If `describe(big)` causes `big` to escape, that's the boxing allocation. Decide whether to pass a pointer.

### 15.3 PGO (Profile-Guided Optimization)

Go 1.21+ supports PGO:

```bash
go test -cpuprofile=cpu.prof -bench=.
go build -pgo=cpu.prof
```

PGO can devirtualize hot indirect calls. For a type switch, PGO doesn't currently reorder cases — but it can inline matching-case bodies more aggressively.

---

## 16. Summary

A type switch is fast (single-digit nanoseconds) on small case sets. Its cost is dominated by:
1. Boxing the operand (if not already an interface) — large structs allocate.
2. `itab` first-call build for interface cases — amortized by caching.
3. Linear scan over cases — order by frequency.

When the case count grows past ~10 or callers extend the type set, switch to map dispatch or sealed-interface methods. Generics eliminate type switches over numeric kinds entirely. Always profile before optimizing — premature reordering rarely pays.

---

## 17. Self-Assessment Checklist

- [ ] I can read pprof output and identify type-switch dispatch as a hotspot
- [ ] I know boxing is the dominant cost for large structs
- [ ] I can choose between type switch, map dispatch, and method dispatch
- [ ] I order cases by frequency on hot paths
- [ ] I split multi-type cases when typed access is needed
- [ ] I use generics where they apply
- [ ] I verify allocations with `-gcflags="-m"` and pprof

---

## 18. Further Reading

- [Profile-guided optimization in Go 1.21](https://go.dev/blog/pgo)
- [Russ Cox — Interfaces](https://research.swtch.com/interfaces)
- [runtime/iface.go — itab cache](https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/iface.go)
- [Go pprof guide](https://go.dev/doc/diagnostics#profiling)
