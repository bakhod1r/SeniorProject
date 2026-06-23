# Interface Internals — Optimize

This file focuses on performance, allocation control, and clean code in the runtime layer of interfaces. Every section maps to a real cost: itab lookups, boxing allocations, comparison panics, or escape regressions.

---

## 1. Avoid boxing primitives

### Problem

```go
func observe(metric any) { /* ... */ }

for i := 0; i < 1_000_000; i++ {
    observe(i)
}
```

`int` is not a pointer. The interface data word must hold the address of an int. The compiler heap-allocates one int per call.

### Fix — specialise the hot signature

```go
func observeInt(metric int)    { /* ... */ }
func observeFloat(metric float64) { /* ... */ }
```

Two signatures cost zero allocations.

### Fix — pre-box once

```go
var (
    keyAlive any = "alive"
    keyDead  any = "dead"
)

observe(keyAlive) // reuses the same boxed any
```

If the values are constants, allocate once and reuse.

### Measurement

```bash
go test -bench=Box -benchmem
# BenchmarkBoxInt   600000000   2.1 ns/op   8 B/op   1 allocs/op
```

The `1 allocs/op` is the boxing cost. After the fix it should be `0`.

---

## 2. Prefer concrete types in hot loops

### Problem

```go
type Adder interface{ Add(int) int }

func sum(items []Adder, x int) int {
    total := 0
    for _, it := range items {
        total += it.Add(x) // itab indirection per element
    }
    return total
}
```

Each call goes through `itab.fun[0]`. The compiler cannot inline an interface call.

### Fix

```go
type IntAdder struct{ n int }
func (a IntAdder) Add(x int) int { return a.n + x }

func sum(items []IntAdder, x int) int {
    total := 0
    for _, it := range items {
        total += it.Add(x) // statically dispatched, often inlined
    }
    return total
}
```

Static dispatch lets the compiler inline `Add` and unroll. Benchmarks typically show 2–4x speedups.

### When to keep the interface

- Heterogeneous collection (`Adder`, `Multiplier`, `Logger`).
- Mocking boundary in tests.
- Public API surface.

Inside a single hot function, drop the interface.

---

## 3. Reduce itab pressure with type switches

### Problem

```go
if c, ok := s.(Circle);    ok { return c.Area() }
if r, ok := s.(Rectangle); ok { return r.Area() }
if t, ok := s.(Triangle);  ok { return t.Area() }
```

Three separate itab lookups. The runtime hashes `(Shape, X)` for each `X`.

### Fix

```go
switch v := s.(type) {
case Circle:    return v.Area()
case Rectangle: return v.Area()
case Triangle:  return v.Area()
}
```

The compiler emits a single dispatch table. The runtime reads the type descriptor once.

### Tip

If you have a few hot types and a long tail, branch on the hot ones first:

```go
switch v := op.(type) {
case AddOp: return v.do() // 90% of traffic
case MulOp: return v.do()
default:    return op.Run()
}
```

---

## 4. Stop the typed-nil escape

### Problem

```go
func find(id int) (*User, error) {
    var u *User
    if err := db.Get(id, &u); err != nil {
        return nil, err // returns interface (*MyErr, nil) — typed nil
    }
    return u, nil
}
```

If `db.Get` returns a typed-nil `*MyErr`, the wrapped `error` is non-nil at the call site even though "no error" is the intent.

### Fix

```go
err := db.Get(id, &u)
if err != nil {
    return nil, err
}
```

Or normalise at boundaries:

```go
if reflect.ValueOf(err).IsNil() {
    err = nil
}
```

Better: never return `*MyErr` directly. Return the `error` interface and produce `nil` by hand.

---

## 5. Avoid allocation from method values

### Problem

```go
go w.Run            // method value — escapes; closure on heap
ch <- conn.Read     // same problem
defer s.Close()     // same problem (sometimes)
```

A method value binds the receiver to the function. If the value escapes (channel, goroutine, slice), the runtime heap-allocates the closure.

### Fix — method expression

```go
go func() { (*Worker).Run(w) }() // closure inline; w captured cheaply
```

Or eliminate the closure with a struct that owns the receiver:

```go
type job struct{ w *Worker }
func (j job) run() { j.w.Run() }
```

### Profiling

```bash
go build -gcflags='-m=2' main.go 2>&1 | grep escape
# main.go:42: w.Run escapes to heap
```

---

## 6. Batch reflect calls outside the hot path

### Problem

```go
func encode(v any) []byte {
    t := reflect.TypeOf(v) // every call
    fields := []reflect.StructField{}
    for i := 0; i < t.NumField(); i++ {
        fields = append(fields, t.Field(i))
    }
    /* ... */
}
```

`reflect.TypeOf` is cheap (it just reads the type word), but `Field(i)` walks an internal table. Repeated calls add up.

### Fix — cache the type metadata

```go
var fieldCache sync.Map // map[reflect.Type][]reflect.StructField

func fields(t reflect.Type) []reflect.StructField {
    if v, ok := fieldCache.Load(t); ok {
        return v.([]reflect.StructField)
    }
    out := make([]reflect.StructField, t.NumField())
    for i := range out { out[i] = t.Field(i) }
    fieldCache.Store(t, out)
    return out
}
```

`encoding/json`, `encoding/gob`, and `database/sql` all use this technique.

---

## 7. Skip reflect entirely when you can

### Problem

```go
func clone(v any) any {
    rv := reflect.ValueOf(v)
    out := reflect.New(rv.Type()).Elem()
    out.Set(rv)
    return out.Interface()
}
```

Generic-looking, slow.

### Fix — generics

```go
func Clone[T any](v T) T { return v }
```

No reflection, no boxing, no itab. Use `reflect` only when the type is genuinely unknown at compile time (decoders, schema engines).

---

## 8. Comparison without panic

### Problem

```go
seen := map[any]bool{}
seen[anything] = true // may panic on uncomparable types
```

### Fix — check up front

```go
func canCompare(v any) bool {
    return reflect.TypeOf(v).Comparable()
}
```

Or normalise to a stable key:

```go
key := fmt.Sprintf("%v", anything)
seen[key] = true
```

For known shapes, hand-roll a key:

```go
type k struct{ id int; tag string }
seen[k{id: x.id, tag: x.tag}] = true
```

Hand-rolled keys are zero-allocation and never panic.

---

## 9. Generics over `any` for performance

### Problem

```go
func Sum(values []any) any {
    total := 0
    for _, v := range values {
        total += v.(int) // type assertion + panic risk
    }
    return total
}
```

Every element is boxed; every iteration runs an itab assertion.

### Fix

```go
func Sum[T int | float64](values []T) T {
    var total T
    for _, v := range values { total += v }
    return total
}
```

The compiler generates one specialised version per `T` shape. No boxing. No itab. The inner loop becomes a tight scalar add.

---

## 10. Watch out for `interface { ... }` as a tag

### Problem

```go
type Tag interface{ tag() }

type A struct{}; func (A) tag() {}
type B struct{}; func (B) tag() {}

var things []Tag
for _, x := range raw {
    things = append(things, A{x}) // boxes each element
}
```

A "marker interface" forces every concrete value into an iface header.

### Fix — use a sum type pattern

```go
type Tag struct {
    kind int8
    a    A
    b    B
}
```

A single struct, no boxing, branch on `kind`. Slightly more memory per element, no allocations during iteration.

This is what the standard library's `go/ast` and `database/sql.(*Rows).Scan` do.

---

## 11. Inline-friendly methods

### Problem

```go
type Counter interface{ Get() int }
type intCounter int
func (c intCounter) Get() int { return int(c) }

for i := 0; i < n; i++ {
    total += counter.Get() // not inlined — interface
}
```

Interface dispatch blocks inlining.

### Fix — escape the interface inside the loop

```go
if c, ok := counter.(intCounter); ok {
    for i := 0; i < n; i++ {
        total += c.Get() // inlined — concrete
    }
} else {
    for i := 0; i < n; i++ {
        total += counter.Get()
    }
}
```

Pay the type assertion once; let the compiler inline the rest.

---

## 12. Profile the runtime cost

### CPU

```bash
go test -bench . -cpuprofile=cpu.prof
go tool pprof -list 'getitab|convT.*' cpu.prof
```

Symbols to look for:
- `runtime.convT64`, `runtime.convTstring`, `runtime.convTslice` — boxing.
- `runtime.getitab` — itab lookups in a hot loop.
- `runtime.assertI2T2` — failing type assertions.
- `runtime.ifaceeq` — interface comparisons.

### Memory

```bash
go test -bench . -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
```

A spike in `runtime.convT*` callers tells you exactly where boxing happens.

### Trace

```bash
go test -bench . -trace=trace.out
go tool trace trace.out
```

Look for goroutine GC waits — boxing-heavy code triggers more cycles.

---

## 13. Cheat Sheet

```
ALLOCATION CONTROL
─────────────────────────────
boxing primitive   → 1 alloc + 1 itab  (avoid in hot loops)
boxing pointer     → 0 alloc, data = ptr
boxing slice/map   → 1 alloc for the header

DISPATCH
─────────────────────────────
concrete call    → inlined, ~1 ns
generic call     → inlined per shape
interface call   → itab + indirect, ~3 ns
reflect call     → ~100 ns

COMPARISON
─────────────────────────────
== on iface  : type word + data word (or deep ifaceeq)
panic if underlying type is uncomparable
typed nil    : type != nil, data == nil → not equal to nil

PROFILING SYMBOLS
─────────────────────────────
runtime.convT*    : boxing
runtime.getitab   : itab lookup
runtime.assertI2T : type assertion
runtime.ifaceeq   : iface compare
```

---

## Summary

The two-word interface header is cheap, but only when you respect it:

1. Do not box primitives in hot loops — specialise or use generics.
2. Prefer concrete types when the static type is known — let the compiler inline.
3. Collapse repeated assertions into a type switch — fewer itab lookups.
4. Treat typed-nil as a bug to be eliminated at the boundary.
5. Avoid method values that escape; use method expressions.
6. Cache reflect metadata; never reflect inside the inner loop.
7. Skip reflect entirely with generics where the type is statically known.
8. Use comparable hand-rolled keys when uncomparable types reach interfaces.
9. Replace marker interfaces with sum-type structs when the variant set is fixed.
10. Profile with `convT*` and `getitab` symbols — they flag exactly where the runtime pays.
