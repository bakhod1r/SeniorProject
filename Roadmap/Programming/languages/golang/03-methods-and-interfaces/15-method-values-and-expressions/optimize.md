# Method Values and Expressions — Optimize

This file focuses on performance, escape behavior, and cleaner-code patterns specific to **method values** (`t.M`) and **method expressions** (`T.M`). Both produce a `func` value, but the cost model is different.

---

## 1. Method value allocates a closure

A method value `t.M` is sugar for "create a closure that captures `t` and calls `T.M`". The capture forces `t` (and any reachable state) onto the heap.

```go
type Service struct {
    name string
    log  *log.Logger
}

func (s *Service) Handle(x int) { s.log.Printf("%s: %d", s.name, x) }

func badProducer() func(int) {
    s := &Service{name: "core", log: log.Default()}
    return s.Handle  // method value — closure escapes
}
```

Escape report:

```bash
$ go build -gcflags='-m=2' ./...
./svc.go:9:7:  &Service literal escapes to heap
./svc.go:10:9: s.Handle escapes to heap
./svc.go:10:9: leaking param: s to result ~r0 level=1
```

The compiler synthesizes a small wrapper struct holding the receiver and a func pointer; that struct lives on the heap.

### Method expression — no closure, no escape

```go
func goodProducer() func(*Service, int) {
    return (*Service).Handle  // method expression — plain function pointer
}
```

```bash
$ go build -gcflags='-m=2' ./...
./svc.go:14:9: (*Service).Handle does not escape
```

The method expression is a top-level function value. No capture, no allocation. Pass the receiver explicitly at the call site.

---

## 2. Hoisting the method value out of a hot loop

A common inefficiency: rebuilding the closure on every iteration.

```go
// Bad — every iteration allocates a fresh closure
func processBad(items []Item, srv *Service) {
    for _, it := range items {
        cb := srv.Handle
        cb(it.Value)
    }
}

// Better — built once, reused
func processHoisted(items []Item, srv *Service) {
    cb := srv.Handle
    for _, it := range items {
        cb(it.Value)
    }
}

// Best — method expression, no closure at all
func processExpr(items []Item, srv *Service) {
    cb := (*Service).Handle
    for _, it := range items {
        cb(srv, it.Value)
    }
}
```

### Benchmark

```go
func BenchmarkLoopMethodValue(b *testing.B) {
    srv := &Service{name: "x", log: log.New(io.Discard, "", 0)}
    items := make([]Item, 1024)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        processBad(items, srv)
    }
}

func BenchmarkLoopHoisted(b *testing.B) {
    srv := &Service{name: "x", log: log.New(io.Discard, "", 0)}
    items := make([]Item, 1024)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        processHoisted(items, srv)
    }
}

func BenchmarkLoopMethodExpr(b *testing.B) {
    srv := &Service{name: "x", log: log.New(io.Discard, "", 0)}
    items := make([]Item, 1024)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        processExpr(items, srv)
    }
}
```

Typical numbers (Go 1.22, amd64): the hoisted variant matches the method-expression variant; the bad variant adds 1 alloc per *outer* call (Go is smart enough not to allocate per inner iteration when the closure is loop-invariant in trivial cases, but as soon as the receiver itself changes per iteration the per-iteration alloc reappears). Always profile.

---

## 3. `sort.Slice` (closure) vs `sort.Sort` with `sort.Interface` (vtable)

`sort.Slice` takes a closure built from a method expression or lambda; `sort.Sort` takes an interface and uses the itab.

```go
type Row struct{ Score int }
type Rows []Row
func (r Rows) Len() int           { return len(r) }
func (r Rows) Less(i, j int) bool { return r[i].Score < r[j].Score }
func (r Rows) Swap(i, j int)      { r[i], r[j] = r[j], r[i] }

func sortInterface(rows Rows) { sort.Sort(rows) }

func sortSliceClosure(rows Rows) {
    sort.Slice(rows, func(i, j int) bool { return rows[i].Score < rows[j].Score })
}
```

### Benchmark

```go
func BenchmarkSortInterface(b *testing.B) {
    base := makeRows(1 << 14)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        rows := append(Rows(nil), base...)
        b.StartTimer()
        sortInterface(rows)
        b.StopTimer()
    }
}

func BenchmarkSortSliceClosure(b *testing.B) { /* same shape */ }
```

`sort.Slice` calls `reflect.Swapper` under the hood — that costs once, but the comparator is a closure called via indirect call. `sort.Sort` calls `Less`/`Swap` through the itab. On modern CPUs the closure path is competitive but allocates a small amount for the closure itself; the interface path allocates zero if the slice already implements `sort.Interface`. For very hot sort paths, prefer `sort.Sort` (or `slices.SortFunc` in Go 1.21+, which uses generics and avoids both the closure capture and the reflective swapper).

---

## 4. Dispatch tables built from method expressions

Method expressions are first-class function values. They make zero-allocation dispatch tables straightforward.

```go
type Op byte

const (
    OpAdd Op = iota
    OpSub
    OpMul
)

type CPU struct{ R [8]int64 }

func (c *CPU) add(a, b int) { c.R[a] += c.R[b] }
func (c *CPU) sub(a, b int) { c.R[a] -= c.R[b] }
func (c *CPU) mul(a, b int) { c.R[a] *= c.R[b] }

// Built once, package-level: no allocation per dispatch.
var dispatch = [...]func(*CPU, int, int){
    OpAdd: (*CPU).add,
    OpSub: (*CPU).sub,
    OpMul: (*CPU).mul,
}

func (c *CPU) Step(op Op, a, b int) { dispatch[op](c, a, b) }
```

If you used method values instead — `dispatch := []func(int,int){c.add, c.sub, c.mul}` — you would tie the table to a particular receiver and pay an allocation each time it is rebuilt. The method-expression table is shared across every `CPU` instance and lives in the read-only function table.

---

## 5. Inlining — method values are usually opaque

The compiler inlines direct calls (`s.Handle(x)`) aggressively. Once the call goes through a `func` value (method value or method expression assigned to a variable), the compiler typically gives up on inlining at the call site because it cannot statically prove what the variable points to.

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

func directCall(c *Counter) { c.Inc() }                 // inlined
func viaValue(c *Counter)   { fn := c.Inc; fn() }       // not inlined, fn is opaque
func viaExpr(c *Counter)    { fn := (*Counter).Inc; fn(c) } // not inlined either
```

```bash
$ go build -gcflags='-m' ./...
./inl.go:5:6: can inline (*Counter).Inc with cost 6
./inl.go:7:6: can inline directCall with cost 12
./inl.go:7:18: inlining call to (*Counter).Inc
./inl.go:8:6: cannot inline viaValue: function too complex (or func value)
./inl.go:9:6: cannot inline viaExpr: function too complex (or func value)
```

Practical rule: in a hot path, use the **direct** call. Only reach for a method value or expression when you actually need to *pass the function elsewhere* (callbacks, dispatch tables, generic algorithms).

---

## 6. Generic dispatch — method expression vs concrete func

Generics let you pass any callable. Method expressions slot in cleanly because their signature is explicit.

```go
func MapInPlace[T any, A any](xs []T, ctx A, fn func(A, *T)) {
    for i := range xs {
        fn(ctx, &xs[i])
    }
}

type Shape struct{ X, Y, Scale float64 }
func (s *Shape) Normalize(scale float64) { s.X *= scale; s.Y *= scale }

// Method-expression call site — no closure, monomorphized.
MapInPlace(shapes, 2.0, func(scale float64, s *Shape) { s.Normalize(scale) })

// Equivalent without the wrapper — but signatures must align exactly.
// (*Shape).Normalize has signature func(*Shape, float64), so we'd need a
// MapInPlace variant that passes (*T, A) instead. Pick the order that
// matches your existing methods to avoid trampoline closures.
```

If you find yourself writing `func(s *Shape) { s.Normalize() }` everywhere just to massage a signature, redesign the generic helper to accept the method expression's natural shape `func(*T, A)`.

---

## 7. `reflect.Value.Method` cost and caching

Reflection-based dispatch is the slowest path. `reflect.Value.Method(i)` returns a `reflect.Value` representing a method value; calling it goes through the reflection machinery.

```go
func reflectCall(srv *Service, x int) {
    v := reflect.ValueOf(srv)
    m := v.MethodByName("Handle")          // O(num methods) name lookup
    m.Call([]reflect.Value{reflect.ValueOf(x)})
}
```

Costs:
1. `MethodByName` walks the method table (linear in the number of methods).
2. `m.Call` allocates a `[]reflect.Value` argument slot per call.
3. Each `reflect.Value` may box small values into interfaces.

### Caching strategy

```go
type cachedHandler struct {
    target reflect.Value
    method reflect.Value
}

func newCachedHandler(srv any, name string) *cachedHandler {
    v := reflect.ValueOf(srv)
    return &cachedHandler{target: v, method: v.MethodByName(name)}
}

func (c *cachedHandler) Call(x int) {
    c.method.Call([]reflect.Value{reflect.ValueOf(x)})
}
```

Even cached, reflection is ~50-100x slower than a direct call. If the method set is small and known, generate code (or a small map of method expressions) instead.

```go
var routes = map[string]func(*Service, int){
    "Handle": (*Service).Handle,
    "Reset":  (*Service).Reset,
}

func dispatch(srv *Service, name string, x int) { routes[name](srv, x) }
```

The map lookup costs roughly one hash + one indirect call; no reflection, no per-call allocation.

---

## 8. Channel of method values — GC retention

Sending method values across a channel is convenient but pins their receivers in the heap until the value is drained.

```go
type Job func()

func enqueue(jobs chan<- Job, srv *Service, ids []int) {
    for _, id := range ids {
        id := id
        jobs <- func() { srv.Process(id) }   // closure captures srv and id
    }
}
```

If `srv` is a large object and the channel is buffered, you have just promoted `srv` to live as long as the slowest worker. Two cleaner designs:

```go
// Option A — typed payload, method expression at the worker.
type Task struct{ Srv *Service; ID int }
func worker(in <-chan Task) {
    handle := (*Service).Process
    for t := range in {
        handle(t.Srv, t.ID)
    }
}

// Option B — index into a fixed registry, no per-job retention beyond the index.
var registry = map[ServiceID]*Service{}
type Task2 struct{ SrvID ServiceID; ID int }
```

Option A keeps `*Service` lifetime visible in the type system. Option B decouples lifetime entirely. Either is preferable to a `chan func()` for long-lived workers.

---

## 9. Currying — closure vs explicit parameter struct

Method values are the easy way to "bake in" a receiver. For multi-parameter currying, an explicit struct is faster and clearer.

```go
// Currying via closure — one alloc per partial application
func curryClosure(srv *Service, prefix string) func(int) {
    return func(x int) { srv.HandleWithPrefix(prefix, x) }
}

// Explicit parameter struct — zero alloc, easy to inspect, easy to extend
type HandleArgs struct {
    Srv    *Service
    Prefix string
}
func (a HandleArgs) Run(x int) { a.Srv.HandleWithPrefix(a.Prefix, x) }
```

Benchmarks usually show `HandleArgs` faster than the closure because:
- the struct can stay on the stack when its address does not escape;
- the call goes through a known method, so the compiler may inline `Run`;
- no synthesized closure object, no implicit captures.

When you need to *log* or *compare* the bound parameters, a struct beats an opaque closure every time.

---

## 10. Stable function identity — why method expressions matter

`t.M == t.M` is **not** guaranteed in Go: two method values may compare unequal even with the same receiver and method, because each may be a freshly allocated closure. Method expressions, on the other hand, are package-level function values with stable identity.

```go
fn1 := (*Service).Handle
fn2 := (*Service).Handle
// fn1 and fn2 point to the same generated wrapper.

mv1 := srv.Handle
mv2 := srv.Handle
// mv1 == mv2 is undefined behavior — comparing func values panics.
```

Practical consequence: when you build a deduplicated registry of handlers, key it on the method expression (or a name string), never on a method value.

```go
type HandlerKey = func(*Service, Event)
seen := map[uintptr]bool{}
register := func(h HandlerKey) {
    p := reflect.ValueOf(h).Pointer()
    if seen[p] { return }
    seen[p] = true
    // ...
}
register((*Service).OnStart)
register((*Service).OnStop)
```

---

## 11. Cleaner-code patterns

### Pattern 1: Method expression in package-level tables

```go
var commands = map[string]func(*App, []string) error{
    "build":   (*App).build,
    "test":    (*App).test,
    "deploy":  (*App).deploy,
}
```

The table is a single source of truth, statically typed, and zero-alloc per dispatch.

### Pattern 2: Method value only at the API boundary

```go
// Internal layer: pass receiver explicitly.
func runAll(app *App, fns []func(*App) error) error { /* ... */ }

// Public layer: convenience method value for callers who already hold the receiver.
func (app *App) Run(steps ...string) error {
    fns := make([]func(*App) error, len(steps))
    for i, s := range steps { fns[i] = stepTable[s] }
    return runAll(app, fns)
}
```

Internal code stays alloc-free; the convenience cost lives at the boundary where it is paid once.

### Pattern 3: Avoid `interface{}` when a method expression suffices

```go
// Bad
func runAny(x any, methodName string) { /* reflect.MethodByName ... */ }

// Good
func runApp(app *App, fn func(*App)) { fn(app) }
```

Static, fast, type-checked.

---

## 12. Cheat sheet

```
METHOD VALUE  vs  METHOD EXPRESSION
-----------------------------------------
syntax: t.M           syntax: T.M  /  (*T).M
binds receiver        receiver is first arg
allocates closure     no closure, function pointer
opaque to inliner     opaque to inliner
identity unstable     identity stable

WHEN METHOD VALUE WINS
- Single-shot callback at API boundary
- Receiver is small / stack-allocated already
- Code clarity > 1 alloc

WHEN METHOD EXPRESSION WINS
- Hot loop / dispatch table
- Multiple receivers reuse the same callback
- Need stable function identity
- Generic helpers with explicit (T, args) shape

ESCAPE QUICK CHECK
go build -gcflags='-m=2' ./...
  "X escapes to heap"  -> method value capturing X
  "(*T).M does not escape" -> method expression

PROFILE
go test -bench=. -benchmem
go test -bench=. -cpuprofile=cpu.prof
go tool pprof -alloc_objects mem.prof
```

---

## Summary

Method values and method expressions look interchangeable in source but differ sharply in cost:

1. `t.M` allocates a closure; `T.M` does not.
2. Hoist or replace method values in hot loops; better still, call directly.
3. Dispatch tables keyed by method expressions are zero-alloc and stable.
4. Both forms are opaque to the inliner — keep the direct call when you can.
5. Reflection-based `Method`/`MethodByName` is dramatically slower; cache or replace with a method-expression map.
6. Channels carrying closures pin receivers; prefer typed task structs.
7. For currying, an explicit parameter struct outperforms a closure and stays debuggable.
8. Profile with `-gcflags='-m=2'` and `-benchmem` before deciding which form to use.

Reach for method values when ergonomics dominate, for method expressions when performance and identity dominate, and for direct calls whenever the call site already holds the receiver.
