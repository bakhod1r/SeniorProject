# Method Dispatch — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Every task centers on **how the call gets made** — static (direct) vs dynamic (via `itab.fun[]`), inlined vs out-of-line, monomorphized vs GCShape-stenciled.

---

## Easy 🟢

### Task 1 — Spot the dispatch kind
Given the snippet, label each call site as **static** or **dynamic**:

```go
type Speaker interface{ Speak() string }
type Dog struct{}
func (Dog) Speak() string { return "woof" }

func main() {
    d := Dog{}
    _ = d.Speak()              // (a)
    var s Speaker = d
    _ = s.Speak()              // (b)
    _ = Dog.Speak(d)           // (c) method expression
}
```

### Task 2 — Read the inline budget
Compile with `-gcflags='-m'` and identify which method got inlined:

```go
type P struct{ X, Y int }
func (p P) Sum() int        { return p.X + p.Y }
func (p P) Heavy() int {
    s := 0
    for i := 0; i < 100; i++ { s += i*p.X + i*p.Y } // ~80+ nodes
    return s
}
```

Run `go build -gcflags='-m=2' ./...` and write down the cost numbers reported.

### Task 3 — Static dispatch baseline benchmark
Write a benchmark for a direct (static) method call:

```go
type Add struct{ K int }
func (a Add) Do(x int) int { return x + a.K }
// Write: BenchmarkStatic, called 1<<20 times
```

### Task 4 — Dynamic dispatch baseline benchmark
Same operation, but through an interface:

```go
type Op interface{ Do(int) int }
// Write: BenchmarkDynamic. Compare ns/op against Task 3.
```

### Task 5 — Method value escape check
Show via `-gcflags='-m'` that this method value escapes to the heap:

```go
func loop(s *Service) {
    cb := s.Handle           // method value
    for i := 0; i < 1000; i++ { cb(i) }
}
```

Then rewrite to avoid the escape and re-check.

---

## Medium 🟡

### Task 6 — Devirtualization via concrete pin
Convert this dynamically-dispatched hot loop into a statically-dispatched one without changing public API:

```go
type Encoder interface{ Encode(b []byte) []byte }

func Run(e Encoder, items [][]byte) {
    for _, it := range items { _ = e.Encode(it) }
}
```

Hint: pin the concrete type inside `Run` via a type assertion before the loop.

### Task 7 — Compare three dispatch styles
Write three benchmarks that differ only in dispatch:
1. Direct concrete call
2. Interface call
3. Function pointer (closure)

```go
type Adder struct{ K int }
func (a Adder) Add(x int) int { return x + a.K }
```

Report which is fastest and explain why.

### Task 8 — Inline-friendly receiver size
Two structs do the same arithmetic. Predict which one inlines and verify with `-gcflags='-m'`:

```go
type Small struct{ X int }
func (s Small) Get() int { return s.X }

type Big struct{ Buf [256]byte; X int }
func (b Big) Get() int { return b.X }   // value receiver, 264-byte copy
```

### Task 9 — Branch predictor friendly dispatch
Given a slice of `Shape` (interface), measure the cost when:
1. All elements have the same concrete type.
2. Elements alternate between two concrete types.

```go
type Shape interface{ Area() float64 }
// Write benchmarks ShapesHomogeneous and ShapesAlternating.
```

### Task 10 — Method expression vs method value
Two functions equivalent in behaviour, different in allocation:

```go
type Handler struct{ id int }
func (h *Handler) Process(x int) int { return x + h.id }

func A(h *Handler, xs []int) int {
    s := 0
    for _, x := range xs { s += h.Process(x) }     // direct
    return s
}

func B(h *Handler, xs []int) int {
    s := 0
    fn := h.Process                                // method value (escapes?)
    for _, x := range xs { s += fn(x) }
    return s
}
```

Benchmark both. Explain the difference using `-gcflags='-m'`.

### Task 11 — Dispatch cost across CPU caches
Build a benchmark where the receiver lives in different memory locations. Measure how dispatch latency changes when the icache predicts vs mispredicts the call target.

### Task 12 — Generics dispatch across shapes
Write a generic function and call it with `int`, `int64`, `*T`, and `interface{}`:

```go
func SumAll[T any](xs []T, add func(T, T) T, zero T) T { ... }
```

Inspect the GCShape-stenciled symbols with `go tool nm -size <binary>`. Which shapes share code?

---

## Hard 🔴

### Task 13 — PGO devirtualization
Set up a profile-guided build for a hot interface call:

1. Build with `-pgo=off`, run a workload, capture a CPU profile.
2. Save it as `default.pgo`.
3. Rebuild with `-pgo=auto`.
4. Confirm the hot interface call was devirtualized via `-gcflags='-m=2'`.

```go
type Logger interface{ Log(string) }
type Stdout struct{}
func (Stdout) Log(s string) { _ = s }

func Hot(l Logger, msg string) { for i := 0; i < 1<<20; i++ { l.Log(msg) } }
```

### Task 14 — Devirt via a type switch
Convert this loop so the compiler can devirtualize for two well-known concrete types and fall back to dynamic dispatch otherwise:

```go
func Sum(shapes []Shape) float64 {
    var s float64
    for _, sh := range shapes { s += sh.Area() } // dynamic
    return s
}
```

Goal: a `switch sh := sh.(type)` with `case *Circle`, `case *Square`, `default:` that yields static calls in the two hot cases.

### Task 15 — Interface call elimination via generics
Replace this interface-driven hot path with a generic one and benchmark:

```go
type Reducer interface{ Add(a, b int) int }

func Reduce(r Reducer, xs []int) int {
    acc := 0
    for _, x := range xs { acc = r.Add(acc, x) }
    return acc
}
```

Generic version must produce static dispatch for scalar `T`.

### Task 16 — Hidden dynamic dispatch via embedding
Below the embedded interface causes a dynamic call even when the concrete type is known. Find it and remove it:

```go
type Store struct {
    Logger
    db *sql.DB
}

func (s *Store) Save(k string) {
    s.Log("saving " + k)   // dispatch?
}
```

### Task 17 — Microbench dispatch over slice of itab variants
Build a benchmark with N concrete types implementing the same interface. Measure ns/op as N grows from 1 → 16. Plot the cost curve — call-site cache thrash.

### Task 18 — Forced devirt with build constraints
Use a build tag `prod` to swap the interface for a concrete struct in the hot path while keeping the interface in tests:

```go
// +build prod
type repo = pgRepo

// +build !prod
type repo = repoIface
```

Show benchmark numbers with and without the tag.

---

## Expert 🟣

### Task 19 — Reading the itab in the runtime
Write a tiny `unsafe`-based helper that prints the function pointer slot for a given `(iface, methodIndex)` pair. Verify that two interface values built from the same concrete type share the same `itab.fun[0]` address.

### Task 20 — End-to-end PGO pipeline
Set up a CI-like pipeline:
1. Run a synthetic workload.
2. Capture pprof CPU profile.
3. Move it to `default.pgo`.
4. Rebuild.
5. Diff `go build -gcflags='-m=2'` output before/after to highlight the devirts.

### Task 21 — Dispatch budget in a real allocator
Implement a memory pool with a `Get/Put` interface. Show how using interface dispatch costs ~3x more than a concrete-type pool in a 100M-op workload, and write a wrapper that pins the concrete type.

### Task 22 — Inline-budget surgery
Take a method whose body is just over the inline budget. Restructure it (extract slow path into a non-inlined function) until the hot wrapper inlines. Confirm with `-gcflags='-m=2'`.

```go
func (c *Cache) Get(k string) (V, bool) {
    if v, ok := c.fast[k]; ok { return v, true } // hot
    // slow path: lock, network, retry, decode...
}
```

---

## Solutions

### Solution 1
- (a) **Static** — concrete `Dog`, direct call.
- (b) **Dynamic** — through `Speaker`'s `itab.fun[0]`.
- (c) **Static** — method expression compiles to a regular function call.

### Solution 2

```bash
$ go build -gcflags='-m=2' ./...
./p.go:2:6: can inline P.Sum with cost 4 as: ...
./p.go:3:6: cannot inline P.Heavy: function too complex: cost 90 exceeds budget 80
```

The default budget is 80 nodes. `Sum` (cost 4) inlines, `Heavy` (cost 90) does not.

### Solution 3

```go
func BenchmarkStatic(b *testing.B) {
    a := Add{K: 1}
    sum := 0
    for i := 0; i < b.N; i++ { sum = a.Do(sum) }
    runtime.KeepAlive(sum)
}
```

Typical: ~0.3 ns/op (often inlined to a single ADD).

### Solution 4

```go
func BenchmarkDynamic(b *testing.B) {
    var op Op = Add{K: 1}
    sum := 0
    for i := 0; i < b.N; i++ { sum = op.Do(sum) }
    runtime.KeepAlive(sum)
}
```

Typical: ~1.5–3 ns/op. The cost is the indirect call through `itab.fun[0]` plus a load that the branch predictor cannot hoist.

### Solution 5

```bash
$ go build -gcflags='-m' .
./loop.go:3:8: s.Handle escapes to heap
```

Rewrite using a method expression, which does not allocate:

```go
func loop(s *Service) {
    fn := (*Service).Handle
    for i := 0; i < 1000; i++ { fn(s, i) }
}
```

### Solution 6

```go
func Run(e Encoder, items [][]byte) {
    if pe, ok := e.(*ProdEncoder); ok {       // pin concrete type
        for _, it := range items { _ = pe.Encode(it) } // static
        return
    }
    for _, it := range items { _ = e.Encode(it) }      // fallback
}
```

The compiler can now inline `pe.Encode` inside the hot branch.

### Solution 7

```go
func BenchmarkDirect(b *testing.B) {
    a := Adder{K: 1}; s := 0
    for i := 0; i < b.N; i++ { s = a.Add(s) }
    runtime.KeepAlive(s)
}

func BenchmarkInterface(b *testing.B) {
    var a interface{ Add(int) int } = Adder{K: 1}; s := 0
    for i := 0; i < b.N; i++ { s = a.Add(s) }
    runtime.KeepAlive(s)
}

func BenchmarkClosure(b *testing.B) {
    a := Adder{K: 1}
    fn := func(x int) int { return a.Add(x) }
    s := 0
    for i := 0; i < b.N; i++ { s = fn(s) }
    runtime.KeepAlive(s)
}
```

Typical ranking: direct < interface ≈ closure. The closure may also escape `a` to the heap.

### Solution 8

```bash
./inline.go:2:6: can inline Small.Get with cost 4
./inline.go:5:6: cannot inline Big.Get: function too complex (large receiver copy)
```

Even though the body is identical, the value-receiver copy of `Big` (264 bytes) bumps the cost over the budget. Use `*Big` or move `X` out.

### Solution 9

Homogeneous loops are 2–4x faster. The CPU's indirect-branch predictor learns the single target and predicts every iteration correctly. Alternating types thrash the predictor.

```
BenchmarkShapesHomogeneous-8   500000000   2.1 ns/op
BenchmarkShapesAlternating-8   200000000   6.3 ns/op
```

### Solution 10

```bash
$ go build -gcflags='-m' .
./b.go:14:9: h.Process escapes to heap   <-- method value allocates
```

`A` runs at static-call speed (~0.5 ns/op). `B` allocates a closure once **and** every call goes through the closure indirection (~2 ns/op).

### Solution 11

```go
func BenchmarkDispatchCacheCold(b *testing.B) {
    targets := make([]Op, 1024)
    for i := range targets { targets[i] = &Adder{K: i} }
    var s int
    for i := 0; i < b.N; i++ { s = targets[i&1023].Do(s) }
    runtime.KeepAlive(s)
}
```

Cold cache: ~10–15 ns/op (L1 icache miss on the call target). Hot cache (single target): ~1.5 ns/op.

### Solution 12

```bash
$ go tool nm ./bin | grep SumAll
... T main.SumAll[go.shape.int_0]
... T main.SumAll[go.shape.int64_0]
... T main.SumAll[go.shape.*uint8_0]
... T main.SumAll[go.shape.interface_{}_0]
```

`int` and `int64` get separate stencils (different size), `*int` shares with `*string` (any pointer = same shape), and `interface{}` is its own shape. The pointer stencil performs a runtime type lookup per operation — slower than the scalar stencils.

### Solution 13

```bash
go test -bench=Hot -cpuprofile=cpu.pprof
mv cpu.pprof default.pgo
go build -pgo=auto -gcflags='-m=2' ./... 2>&1 | grep devirt
# ./hot.go:3:9: devirtualizing l.Log to Stdout
```

After PGO, `Hot` calls `Stdout.Log` directly inside the loop and the wrapper inlines.

### Solution 14

```go
func Sum(shapes []Shape) float64 {
    var s float64
    for _, sh := range shapes {
        switch v := sh.(type) {
        case *Circle: s += v.Area()  // static, inlined
        case *Square: s += v.Area()  // static, inlined
        default:      s += sh.Area() // dynamic
        }
    }
    return s
}
```

The type switch lets the compiler emit two direct calls; the default keeps correctness for unknown types.

### Solution 15

```go
type AddFn[T any] func(a, b T) T
func ReduceG[T any](add AddFn[T], xs []T, zero T) T {
    acc := zero
    for _, x := range xs { acc = add(acc, x) }
    return acc
}
```

When called with `int` and `func(a, b int) int { return a + b }`, the closure inlines and the loop becomes a tight `ADD`. With the interface version it stayed at ~2 ns/op; the generic version drops to ~0.4 ns/op.

### Solution 16

```go
type Store struct {
    log *FileLogger      // concrete pointer instead of `Logger`
    db  *sql.DB
}

func (s *Store) Save(k string) { s.log.Log("saving " + k) } // static
```

Embedding an interface promotes its method but keeps dynamic dispatch — replace with a concrete struct in hot code.

### Solution 17

The cost stays flat (~2 ns/op) at N=1, climbs sharply at N=4 (predictor saturates), and plateaus around 8–10 ns/op by N≥8. CPUs typically track 2–4 indirect-branch targets per call site.

### Solution 18

```
$ go test -bench=. -tags=prod
BenchmarkLookup-8   400000000  3.1 ns/op
$ go test -bench=.
BenchmarkLookup-8   200000000  6.7 ns/op
```

The `prod` tag erases the interface; production gets static dispatch, tests keep the interface seam.

### Solution 19

```go
type iface struct {
    tab  *itab
    data unsafe.Pointer
}
type itab struct {
    inter *interfacetype
    typ   *_type
    hash  uint32
    _     [4]byte
    fun   [1]uintptr      // variable length
}

func MethodPtr(i any, idx int) uintptr {
    p := (*iface)(unsafe.Pointer(&i))
    fun := (*[16]uintptr)(unsafe.Pointer(&p.tab.fun))
    return fun[idx]
}
```

Two interface values built from `Dog{}` print the same `MethodPtr(_, 0)` because the runtime caches itabs by `(interface, concrete)` pair.

### Solution 20

```bash
go test -run=^$ -bench=BenchmarkHot -cpuprofile=cpu.pprof ./...
cp cpu.pprof default.pgo
go build -pgo=auto -gcflags='-m=2' ./... 2>m_after.txt
diff m_before.txt m_after.txt | grep devirt
```

You should see one or more `devirtualizing X.Y to Z` lines for the hottest interface sites.

### Solution 21

```go
type Pool interface { Get() *Buf; Put(*Buf) }

type fastPool struct{ p *concretePool }
func (f *fastPool) Get() *Buf       { return f.p.Get() } // pinned, inlines
func (f *fastPool) Put(b *Buf)      { f.p.Put(b) }
```

Wrap the concrete pool once; the wrapper's methods statically call the concrete methods, and once you have a `*concretePool` directly in the hot path, even the wrapper disappears.

### Solution 22

```go
func (c *Cache) Get(k string) (V, bool) {
    if v, ok := c.fast[k]; ok { return v, true } // small, inlines
    return c.getSlow(k)                          // out-of-line
}

//go:noinline
func (c *Cache) getSlow(k string) (V, bool) { /* big body */ }
```

`Get`'s cost drops well under 80, the JIT-like compiler inlines it at every call site, and the slow path lives once in the binary.

---

## Diagnostics quick reference

```
-gcflags='-m'         # inline + escape decisions
-gcflags='-m=2'       # also: cost numbers, devirt notes
-pgo=auto             # use default.pgo for PGO devirt (Go 1.21+)
go tool nm -size BIN  # see GCShape stencils
go test -bench .      # measure ns/op for static vs dynamic
```
