# Method Dispatch — Optimize

This file is about **how the call gets made**. Static dispatch is a single `CALL imm32`. Dynamic dispatch is a load from `itab.fun[i]` followed by `CALL [reg]` — measurable when it happens millions of times per second. The sections below cover the levers Go gives you to control which one you get.

---

## 1. The two dispatch shapes

```
STATIC                           DYNAMIC
──────                           ───────
direct CALL site                 load itab.fun[i] then CALL
inline candidate                 never inlined
predicted by branch predictor    needs indirect-branch predictor
~0.3 ns/op (often free)          ~1–3 ns/op + icache pressure
```

Static dispatch is what you get from concrete types and method expressions. Dynamic dispatch is what you get from interface variables, slices/maps of interfaces, embedded interface fields, and reflection.

```go
type Speaker interface{ Speak() string }
type Dog struct{}
func (Dog) Speak() string { return "woof" }

func main() {
    d := Dog{}; _ = d.Speak()         // static
    var s Speaker = d; _ = s.Speak()  // dynamic
}
```

---

## 2. Concrete-type pinning

The cheapest win. If the hot path knows the concrete type, type the variable as the concrete type:

```go
// Before — interface in the hot field
type Service struct{ enc Encoder }

// After — concrete pointer in the hot field
type Service struct{ enc *GzipEncoder }
```

When you must accept an interface at the API boundary, pin inside the function:

```go
func Run(e Encoder, items [][]byte) {
    if pe, ok := e.(*GzipEncoder); ok {
        for _, it := range items { _ = pe.Encode(it) }   // static, inlined
        return
    }
    for _, it := range items { _ = e.Encode(it) }
}
```

Cost: one assertion (~1 ns) at the entrance, free dispatch for every iteration after.

---

## 3. Inline-friendly receiver size

Default inline budget: ~80 nodes (varies slightly across Go versions). The receiver counts.

```go
type Small struct{ X int }
func (s Small) Get() int { return s.X }   // cost ~4, inlines

type Big struct{ Buf [256]byte; X int }
func (b Big) Get() int { return b.X }     // value receiver = 264-byte copy, often skipped
```

Diagnostic:

```
$ go build -gcflags='-m=2' .
./inline.go:2:6: can inline Small.Get with cost 4 as: ...
./inline.go:5:6: cannot inline Big.Get: function too complex
```

Rules:
- Hot methods should be short (cost < ~80).
- Use a pointer receiver for any struct bigger than ~64 bytes.
- Avoid `defer` in hot inline candidates (Go 1.14+ open-coded defer is cheap, but the cost still bumps the budget).
- Avoid method calls on the receiver inside a tiny method — they bump the cost too.

---

## 4. Method values vs method expressions

```go
type W struct{ id int }
func (w *W) Step(x int) int { return x + w.id }

// Method value — closes over `w`, often escapes:
fn := w.Step
for _, x := range xs { _ = fn(x) }

// Method expression — receiver passed explicitly, no closure:
fn := (*W).Step
for _, x := range xs { _ = fn(w, x) }
```

`-gcflags='-m'`:

```
./mv.go:5:8: w.Step escapes to heap        <-- method value
./mv.go:8:11: (*W).Step does not escape    <-- method expression
```

In hot loops always prefer the method expression — or, better, just call the method directly.

---

## 5. Devirtualization opportunities

The compiler can prove a concrete type and emit a static call when:

- The variable holding the interface is a local with a known assignment.
- A type switch isolates a concrete branch.
- PGO indicates one concrete type dominates the call site (Go 1.21+).

```go
// Type-switch devirt
for _, sh := range shapes {
    switch v := sh.(type) {
    case *Circle: total += v.Area()  // static, inlines
    case *Square: total += v.Area()  // static, inlines
    default:      total += sh.Area() // dynamic fallback
    }
}
```

Verify:

```
$ go build -gcflags='-m=2' .
./shapes.go:4:36: inlining call to (*Circle).Area
./shapes.go:5:36: inlining call to (*Square).Area
```

---

## 6. PGO devirtualization (Go 1.21+)

```bash
# 1. Capture a representative profile
go test -run=^$ -bench=BenchmarkHot -cpuprofile=default.pgo ./hotpath

# 2. Build with the profile
go build -pgo=auto ./...

# 3. Confirm devirt
go build -pgo=auto -gcflags='-m=2' ./... 2>&1 | grep devirt
# devirtualizing l.Log to *FileLogger
# devirtualizing s.Encode to *GzipEncoder
```

Notes:
- Commit `default.pgo` to the repo for reproducible builds.
- PGO devirt is **opportunistic** — design hot paths so they work without PGO too.
- A stale profile is worse than none. Refresh after structural changes.

---

## 7. Generics: monomorphization vs GCShape

Go does not fully monomorphize generics. The compiler emits one stencil per **GCShape**:
- All pointer types share one stencil (any `*T` = `*uint8` shape).
- Each scalar size has its own stencil (`int`, `int64`, `float64`, etc).
- Each interface type is its own shape.

```go
func Reduce[T any](add func(T, T) T, xs []T, zero T) T {
    acc := zero
    for _, x := range xs { acc = add(acc, x) }
    return acc
}
```

Inspect:

```
$ go tool nm -size ./bin | grep Reduce
... T main.Reduce[go.shape.int_0]
... T main.Reduce[go.shape.int64_0]
... T main.Reduce[go.shape.*uint8_0]
... T main.Reduce[go.shape.interface_{}_0]
```

Performance implications:
- Scalar shapes inline tight code (`ADD`, no boxing).
- Pointer shape uses a runtime dictionary for type-specific operations (e.g. `runtime.typedmemmove`) — measurably slower.
- Interface shape is essentially the same as a non-generic interface call.

```go
type Adder interface{ Add(int) int }
func ApplyI[T Adder](a T, xs []int) { ... }   // T's shape = interface, dispatch via itab
```

If you are using generics for performance, prefer:
- Concrete struct constraints, or
- Function arguments instead of interface methods.

---

## 8. Branch predictor and icache

The CPU's indirect-branch predictor remembers a few targets per call site (typically 2–4). Workloads:

```
Single concrete type behind iface : ~1.5 ns/op (fully predicted)
Two concrete types alternating    : ~3–5 ns/op
N>4 concrete types interleaved    : ~8–12 ns/op (mispredict + icache miss)
```

```go
func BenchmarkIfaceMix(b *testing.B) {
    types := make([]Op, 16)
    for i := range types { types[i] = mkOp(i) }   // 16 distinct concrete types
    s := 0
    for i := 0; i < b.N; i++ { s = types[i&15].Do(s) }
    runtime.KeepAlive(s)
}
```

Mitigations:
- Group calls by concrete type (process all `*Circle`, then all `*Square`).
- Sort `[]Shape` by underlying type before iteration.
- Pin the concrete type when you know it dominates.

---

## 9. Static-call benchmark template

Use this skeleton for any dispatch comparison:

```go
type Op interface{ Do(int) int }
type Add struct{ K int }
func (a Add) Do(x int) int { return x + a.K }

var sink int

func BenchmarkStatic(b *testing.B) {
    a := Add{K: 1}
    s := 0
    b.ResetTimer()
    for i := 0; i < b.N; i++ { s = a.Do(s) }
    sink = s
}

func BenchmarkDynamic(b *testing.B) {
    var op Op = Add{K: 1}
    s := 0
    b.ResetTimer()
    for i := 0; i < b.N; i++ { s = op.Do(s) }
    sink = s
}
```

Typical result on amd64:

```
BenchmarkStatic-8      2000000000  0.31 ns/op
BenchmarkDynamic-8      500000000  2.10 ns/op
```

The 6x gap shrinks to ~2x when the concrete `Do` body is non-trivial — but it never disappears.

---

## 10. Hot-path checklist

Before merging hot-path code, run through:

```
[ ] Hot variable typed as concrete (not interface) where possible
[ ] No method value created inside the loop
[ ] Method body cost < ~80 (verified with -m=2)
[ ] No surprising //go:noinline pragmas
[ ] No type assertions inside the loop body
[ ] Embedded interface fields replaced with concrete types
[ ] PGO enabled in production build (or devirt manually pinned)
[ ] Benchmarks for static and dynamic variants kept side-by-side
```

A 10-line hot loop reviewed with this list usually buys 2–5x throughput on dispatch-bound code.

---

## 11. Reading `-gcflags='-m=2'` output

```
$ go build -gcflags='-m=2' ./...
./svc.go:14:6: can inline (*Service).Save with cost 18 as: ...
./svc.go:21:9: inlining call to (*FileLogger).Log
./svc.go:25:6: cannot inline (*Service).Slow: function too complex: cost 142 exceeds budget 80
./svc.go:30:9: devirtualizing s.enc.Encode to *GzipEncoder
./svc.go:34:9: l.Step escapes to heap
```

What to look for:
- `can inline ... cost N` — N tells you how close to the budget you are.
- `inlining call to ...` — confirmed inline at this site.
- `cannot inline ... function too complex` — body needs splitting.
- `devirtualizing X to Y` — PGO or local proof devirted the call.
- `escapes to heap` — closure or method value allocated; usually a bug in hot code.

---

## 12. Worked example — from interface to inline

Starting point:

```go
type Encoder interface{ Encode([]byte) []byte }

type Service struct{ enc Encoder; out []byte }

func (s *Service) Run(items [][]byte) {
    for _, it := range items { s.out = append(s.out, s.enc.Encode(it)...) }
}
```

Step 1 — pin the concrete encoder field:

```go
type Service struct{ enc *GzipEncoder; out []byte }
```

Step 2 — verify devirt:

```
$ go build -gcflags='-m=2' ./svc
./svc.go:6:36: inlining call to (*GzipEncoder).Encode
./svc.go:6:36: inlining call to append
```

Step 3 — benchmark:

```
Before:  BenchmarkRun-8   200000000   8.4 ns/op
After:   BenchmarkRun-8   600000000   2.3 ns/op
```

Step 4 — keep the abstraction at the constructor:

```go
func NewService(e Encoder) *Service {
    g, _ := e.(*GzipEncoder)            // pin concrete
    return &Service{enc: g}
}
```

The interface lives at the seam, the hot path stays static.

---

## 13. When dynamic dispatch is the right answer

Static dispatch is not always the goal. Keep dynamic dispatch when:
- The hot path runs once or a few hundred times per request — interface overhead is invisible.
- The boundary genuinely needs to swap implementations (mocks, test doubles, plug-ins).
- The cost of pinning would be a bigger maintenance burden than the saved nanoseconds.

Knuth still applies: profile first. The optimizations above are reserved for paths that show up in pprof.

---

## 14. Cheat Sheet

```
LEVERS — STATIC vs DYNAMIC
──────────────────────────────────
Concrete-type field            → static
Type switch with cases         → static (per case)
Type assertion before loop     → static
Interface field/parameter      → dynamic
Slice of interface             → dynamic
Embedded interface             → dynamic
Method value in loop           → indirect + heap alloc
Method expression              → static (no alloc)
PGO -pgo=auto + default.pgo    → opportunistic devirt

INLINE BUDGET
──────────────────────────────────
default ~80 nodes
defer / recover / closures      bump cost
dynamic dispatch                disables inline
//go:noinline                   forbids inline (debug only)

GENERICS DISPATCH
──────────────────────────────────
scalar T          → unique stencil, fast
*T (any pointer)  → shared stencil + dictionary
interface T       → itab dispatch, no devirt
function param    → inlines per shape

DIAGNOSTICS
──────────────────────────────────
-gcflags='-m'        inline + escape
-gcflags='-m=2'      cost numbers + devirt notes
-pgo=auto            PGO devirt (Go 1.21+)
go test -bench .     confirm ns/op
go tool nm -size     see GCShape stencils

RULES OF THUMB
──────────────────────────────────
- Hot field → concrete type
- Hot loop  → no method values, no assertions
- Hot body  → cost < 80
- Boundary  → interface OK
- PGO       → bonus, not foundation
```

---

## Summary

Method dispatch in Go is cheap, but not free. The compiler can give you static, inlined calls when the concrete type is provable — through declarations, type switches, or PGO data. The cost when it cannot is a few nanoseconds per call plus icache pressure, which adds up to real CPU on dispatch-heavy workloads.

The mental model:
1. Interfaces at the boundary, concrete types in the body.
2. Keep hot bodies under the inline budget; split slow paths out.
3. Avoid method values inside loops — use method expressions or direct calls.
4. For generics, prefer scalar shapes and function parameters over interface constraints.
5. Use PGO as a force multiplier, not a band-aid.
6. Verify everything with `-gcflags='-m=2'` and `go test -bench`.
