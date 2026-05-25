# Reflection — Optimize

## 1. Measure first

Reflection is the largest single source of hidden allocation cost in many Go services. Before optimizing:

```bash
go test -bench=. -benchmem -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -alloc_objects mem.out
```

Look for top entries containing `reflect.`. If reflection is < 5% of CPU, leave it alone. If it's 20%+, the techniques below apply.

---

## 2. Cache the type plan

Cheapest win for any reflection-driven library:

```go
var planCache sync.Map  // map[reflect.Type]*plan

func planFor(t reflect.Type) *plan {
    if p, ok := planCache.Load(t); ok {
        return p.(*plan)
    }
    p := buildPlan(t)
    planCache.Store(t, p)
    return p
}
```

The expensive parts (`NumField`, `Field(i)`, `Tag.Get`) happen once per type, not per call. Most reflection libraries already do this; if yours doesn't, that's the first change.

---

## 3. Use indexed field access

```go
// Slow: linear name search per call
v.FieldByName("Email").SetString(email)

// Fast: precomputed index
const emailFieldIdx = 3
v.Field(emailFieldIdx).SetString(email)
```

`FieldByName` walks the field list to find a match — fine once, awful per call. Cache the index when you build the plan.

---

## 4. Avoid `Interface()` when possible

`v.Interface()` boxes into `any`, which always allocates on the heap. Often you don't need it:

```go
// Allocates: boxes the int into any
out := v.Field(i).Interface()
fmt.Println(out)

// No allocation: read directly with the kind-specific method
switch v.Field(i).Kind() {
case reflect.Int, reflect.Int64:
    fmt.Println(v.Field(i).Int())
case reflect.String:
    fmt.Println(v.Field(i).String())
}
```

Inside libraries that walk fields, the kind switch + direct accessor pays for itself many times over.

---

## 5. Offset-based access with `unsafe`

The next step in performance is to bypass reflection entirely on the hot path:

```go
import "unsafe"

type fieldPlan struct {
    offset uintptr
    set    func(p unsafe.Pointer, v string)
}

func makeStringSetter(off uintptr) func(p unsafe.Pointer, v string) {
    return func(p unsafe.Pointer, v string) {
        *(*string)(unsafe.Add(p, off)) = v
    }
}

func decode(target any, src map[string]string) {
    p := unsafe.Pointer(reflect.ValueOf(target).Pointer())
    plan := planFor(reflect.TypeOf(target).Elem())
    for _, f := range plan.fields {
        if v, ok := src[f.name]; ok {
            f.set(p, v)
        }
    }
}
```

Fast JSON libraries do exactly this. The reflection cost is amortized at registration; per-call cost is offset arithmetic + a small closure.

Caveat: now you're touching `unsafe`. Document the invariants and test thoroughly.

---

## 6. Fast paths via type switch

Before falling into reflection, peel off common cases:

```go
func encode(v any) ([]byte, error) {
    switch x := v.(type) {
    case []byte:
        return x, nil
    case string:
        return []byte(x), nil
    case Marshaler:
        return x.Marshal()
    case int:
        return strconv.AppendInt(nil, int64(x), 10), nil
    default:
        return reflectEncode(v)
    }
}
```

`switch` dispatch is essentially free; reflection is hundreds of nanoseconds. Catching the top 5 types as type-switch cases can eliminate most of the reflection traffic.

---

## 7. Generics for value-shape monomorphic code

```go
// reflection-based: works for any T but slow
func ContainsAny(slice []any, target any) bool {
    for _, v := range slice {
        if reflect.DeepEqual(v, target) { return true }
    }
    return false
}

// generic: typed, fast, no reflection
func Contains[T comparable](slice []T, target T) bool {
    for _, v := range slice {
        if v == target { return true }
    }
    return false
}
```

If the call site knows the type, generics eliminate the reflection entirely. The standard library now has `slices.Contains`, `maps.Keys`, etc., all generic.

---

## 8. Avoid `DeepEqual` in hot paths

`reflect.DeepEqual` walks types recursively. For known shapes:

```go
// slow
if reflect.DeepEqual(a, b) { ... }

// fast (assuming a, b are *User)
if a.ID == b.ID && a.Name == b.Name && a.Email == b.Email { ... }
```

For tests, `go-cmp` is fine. For production matching, write the specific comparison.

---

## 9. The "MakeFunc" alternative

If you need runtime-generated functions but performance matters, two alternatives:

1. **Pre-allocate the set.** If the universe of functions is known, build them eagerly at startup.
2. **Code generation.** If the function signatures are known at build time, generate code.

`MakeFunc` is fine for tools that don't run on a hot path (test mocks). For production middleware, prefer a typed wrapper:

```go
type Handler func(ctx context.Context, req *Request) (*Response, error)

func WithLogging(h Handler) Handler {
    return func(ctx context.Context, req *Request) (*Response, error) {
        log.Info("call")
        res, err := h(ctx, req)
        log.Info("done", "err", err)
        return res, err
    }
}
```

Typed, fast, no reflection.

---

## 10. Pool the buffer, not the value

```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 0, 1024) },
}

func formatVia(v any) []byte {
    b := bufPool.Get().([]byte)[:0]
    defer func() {
        if cap(b) < 64<<10 { bufPool.Put(b) }
    }()
    // ... use reflection to walk v, appending to b ...
    out := make([]byte, len(b))
    copy(out, b)
    return out
}
```

Even if reflection itself allocates internally, you can keep the surrounding scratch space alloc-free. The pattern: scratch buffer pooled, final result copied out.

---

## 11. Profile-guided opportunities

Run your reflection-heavy library with the `-pgo` flag (Go 1.21+):

```bash
go build -pgo=auto -o app ./cmd/app
```

The compiler will inline hot reflection paths more aggressively. Typical gains: 5–10% in reflection-bound code. Not transformative, but free given a profile.

---

## 12. The boundary trick

For middleware that decorates many specific handler types, do reflection once per type at registration:

```go
type Adapter func(args ...any) ([]any, error)

func Adapt(h any) Adapter {
    v := reflect.ValueOf(h)
    t := v.Type()
    return func(args ...any) ([]any, error) {
        in := make([]reflect.Value, len(args))
        for i, a := range args { in[i] = reflect.ValueOf(a) }
        out := v.Call(in)
        result := make([]any, len(out))
        for i, o := range out { result[i] = o.Interface() }
        return result, nil
    }
}
```

This still pays per-call reflection. Better: generate the adapter at compile time from a typed `interface` or descriptor.

---

## 13. The cost ladder

From cheapest to most expensive:

1. Type assertion (`v.(string)`) — sub-nanosecond, no allocation.
2. Type switch on a known set of types — sub-nanosecond.
3. Generic function call — direct function call, no allocation.
4. Cached `reflect.Type` lookup + indexed field access — ~10 ns.
5. `FieldByName` per call — ~100 ns.
6. `Interface()` — heap allocation (~30 ns + GC pressure).
7. `MethodByName` + `Call` — micro-seconds.
8. `MakeFunc`-generated wrapper — microseconds + boxing per arg.

Always pick the cheapest tool that fits the contract.

---

## 14. Summary

Reflection optimization is mostly mechanical: cache plans, replace `FieldByName` with `Field(i)`, avoid `Interface()`, peel off fast paths with type switches, and reach for `unsafe.Pointer` offsets when the reflection bookkeeping is the bottleneck. The bigger win is often architectural: code generation eliminates the cost altogether for well-defined types.

---

## Further reading
- `goccy/go-json` source code: how to do fast reflection right
- "Reflection without reflection": https://www.dolthub.com/blog/2024-04-19-reflection-without-reflection/
- `unsafe.Add` / `unsafe.Slice` (Go 1.17+): https://pkg.go.dev/unsafe
- PGO docs: https://go.dev/doc/pgo
