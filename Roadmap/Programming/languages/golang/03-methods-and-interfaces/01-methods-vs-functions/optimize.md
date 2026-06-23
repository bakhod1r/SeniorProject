# Methods vs Functions — Optimize

This file focuses on performance, cleaner code, and profiling concerns related to methods and functions.

---

## 1. Receiver choice — performance

### Small type — value receiver

```go
type Point struct{ X, Y int }
func (p Point) DistanceSq() int { return p.X*p.X + p.Y*p.Y }
```

`Point` is 16 bytes. Copying is equivalent to a single register move. It stays on the stack — no allocation.

### Large type — pointer receiver

```go
type Buffer struct{ data [4096]byte; pos int }
func (b *Buffer) Append(d []byte) { ... }
```

`Buffer` is 4 KB+. Copying is expensive. Choose a pointer receiver.

### Sync primitive — always pointer

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

// MUST be pointer
func (c *Counter) Inc() {
    c.mu.Lock(); defer c.mu.Unlock()
    c.n++
}
```

The `go vet` "passes lock by value" warning will save you from a wrong decision.

### Benchmark

```go
func BenchmarkValueReceiver(b *testing.B) {
    var p Point = Point{X: 3, Y: 4}
    for i := 0; i < b.N; i++ {
        _ = p.DistanceSq()
    }
}

func BenchmarkPointerReceiver(b *testing.B) {
    p := &Point{X: 3, Y: 4}
    for i := 0; i < b.N; i++ {
        _ = p.DistanceSq()  // extra dereference
    }
}
```

For small types, value receivers are usually slightly faster because there is no dereference.

---

## 2. Method value escape

### Problem: method value in a hot path

```go
// Bad — heap allocation on every iteration
func process(items []Item, srv *Service) {
    for _, it := range items {
        cb := srv.Handle  // method value — a closure is created each time
        cb(it)
    }
}
```

### Solution 1: Direct call

```go
func process(items []Item, srv *Service) {
    for _, it := range items {
        srv.Handle(it)  // static dispatch, no alloc
    }
}
```

### Solution 2: Method expression

```go
fn := (*Service).Handle
for _, it := range items {
    fn(srv, it)  // receiver passed as argument — no closure
}
```

### Profiling

```bash
go build -gcflags='-m=2' main.go
# main.go:5: srv.Handle escapes to heap
```

The `-m` flag shows escape analysis results.

---

## 3. Method inlining

The compiler can inline small methods:

```go
func (p Point) X() int { return p.x }  // likely inlined
```

Inlining eliminates `function call overhead`. However:
- If the method body is large — it will not be inlined
- Pointer receiver — slightly more complex
- Called via an interface — not inlined

```bash
go build -gcflags='-m' main.go
# main.go:10: can inline (*Point).X
# main.go:15: inlining call to (*Point).X
```

**Rules that help inlining:**
1. Method is short (1-3 lines)
2. No side effects
3. Does not spawn goroutines
4. Does not use defer (defer broke inlining before Go 1.13; 1.14+ is mostly OK)

---

## 4. Interface dispatch overhead

```go
type Handler interface { Handle(int) }
type ConcreteHandler struct{}
func (h *ConcreteHandler) Handle(x int) { ... }

// Static dispatch — faster
h := &ConcreteHandler{}
h.Handle(42)

// Dynamic dispatch — via itab
var i Handler = h
i.Handle(42)  // 1-2 ns slower
```

In most cases the difference is unnoticeable. But across millions of calls in a hot loop — it becomes significant.

### Benchmark

```go
func BenchmarkStatic(b *testing.B) {
    h := &ConcreteHandler{}
    for i := 0; i < b.N; i++ { h.Handle(i) }
}

func BenchmarkInterface(b *testing.B) {
    var h Handler = &ConcreteHandler{}
    for i := 0; i < b.N; i++ { h.Handle(i) }
}
```

Typical result: static ~1ns/op, interface ~3ns/op.

---

## 5. Slice receiver

### With slice header

```go
type Words []string
func (w Words) Len() int { return len(w) }
```

A slice header is 24 bytes (pointer+len+cap). Copying with a value receiver is cheap, and the underlying data is not moved.

```go
words := Words{"a", "b", "c"}
words.Len()  // 24-byte copy, same data
```

### `append` problem

```go
type Words []string
func (w Words) Add(s string) Words {
    return append(w, s)
}

words := Words{"a"}
words.Add("b")  // result is ignored
fmt.Println(words)  // ["a"]
```

With a slice value receiver — you must return the result of `append`. Or use a pointer receiver:

```go
type Words []string
func (w *Words) Add(s string) {
    *w = append(*w, s)
}
```

---

## 6. Generic method and monomorphization

```go
type List[T any] struct{ items []T }
func (l *List[T]) Add(x T) { l.items = append(l.items, x) }
```

Go 1.18+ generics use **GCShape stenciling** — one compiled copy per "shape" (one for pointer-typed, one for scalar, etc.).

**Performance:**
- Pointer/interface types — go through itab, with slight overhead
- Scalar types (int, float, struct) — separate code, faster

Use generics in hot paths, but confirm with profiling.

---

## 7. Function pointer cache

### Problem: method value on every iteration

```go
for _, x := range data {
    callback := obj.Process  // heap alloc each iteration
    callback(x)
}
```

### Solution: create once

```go
callback := obj.Process
for _, x := range data {
    callback(x)
}
```

Or call directly.

---

## 8. Method on slice for batch operations

```go
type Items []Item
func (items Items) FilterActive() Items {
    result := items[:0]   // re-use same backing array
    for _, it := range items {
        if it.Active { result = append(result, it) }
    }
    return result
}
```

`items[:0]` reuses the original array — no new allocation.

---

## 9. Defer optimization

```go
// 1.13 and earlier — defer broke inlining
func (l *Lock) WithLock(f func()) {
    l.mu.Lock()
    defer l.mu.Unlock()  // overhead
    f()
}
```

Go 1.14+ "open-coded defer" — much cheaper. Still, you may skip defer in a hot path:

```go
func (l *Lock) WithLock(f func()) {
    l.mu.Lock()
    f()
    l.mu.Unlock()  // unlock will not run on panic — be careful
}
```

---

## 10. Profile and measure

### CPU profile

```bash
go test -bench=. -cpuprofile=cpu.prof
go tool pprof cpu.prof
(pprof) top
(pprof) list MyMethod
```

### Heap profile

```bash
go test -bench=. -memprofile=mem.prof
go tool pprof mem.prof
(pprof) top -cum
```

### Trace

```bash
go test -bench=. -trace=trace.out
go tool trace trace.out
```

Trace shows the lifecycle of goroutines, GC, and lock contention.

---

## 11. Cleaner code patterns

### Pattern 1: Extract pure functions

```go
// Bad — everything inside the method
func (s *Service) Process(req Req) Resp {
    // 50 lines of logic
}

// Good
func (s *Service) Process(req Req) Resp {
    validated := validate(req)         // pure function
    enriched := enrich(validated, s.cfg)  // pure
    return s.persist(enriched)          // method (touches DB)
}
```

Pure functions are easy to test and inlining-friendly.

### Pattern 2: Receiver choice consistency

```go
// Bad — mixed
func (b Buffer) Len() int       { return len(b.data) }
func (b *Buffer) Reset()        { b.data = nil }
func (b Buffer) String() string { return string(b.data) }
func (b *Buffer) Write(p []byte) { ... }

// Good — all pointer
func (b *Buffer) Len() int       { return len(b.data) }
func (b *Buffer) Reset()         { b.data = nil }
func (b *Buffer) String() string { return string(b.data) }
func (b *Buffer) Write(p []byte) { ... }
```

### Pattern 3: Helper functions kept internal

```go
package myservice

// Public method
func (s *Service) Calculate(x int) int {
    return s.transform(x) + offset(x)
}

// Private helper — function (no state)
func offset(x int) int { return x % 7 }

// Private method — stateful
func (s *Service) transform(x int) int { return x * s.factor }
```

---

## 12. Premature optimization — be careful

### Anti-pattern: Premature optimization

```go
// Bad — hard to read, no issue found in profiling
func (s *Service) Get() *Data {
    // unsafe pointer hacks
    // manual bounds check elimination
    // ...
}
```

### Pattern: Profile first

```
1. Write the code — clean, idiomatic
2. Test it
3. Profile and benchmark
4. Found a clear bottleneck → optimize
5. Re-test and re-benchmark
```

Knuth: "Premature optimization is the root of all evil."

---

## 13. Mock-friendliness

Mocking methods through interfaces slightly reduces performance (interface dispatch). In production:

```go
// Test
type mockRepo struct{}
func (m *mockRepo) Find(id string) (*User, error) { return nil, nil }

// Production
type pgRepo struct{ db *sql.DB }
func (p *pgRepo) Find(id string) (*User, error) { ... }

// Service
type Service struct{ repo Repo }  // interface
```

If it is not a hot path — this is fine. If it is a hot path — you may need to use the concrete type.

---

## 14. Cheat Sheet

```
PERFORMANCE GUIDE
─────────────────────────────
Small type → value receiver
Large type → pointer receiver
Sync primitive → pointer receiver
Method value in hot path → static dispatch
Generics — justify with profiling
Inline — favor small methods

ESCAPE CONTROL
─────────────────────────────
go build -gcflags='-m=2'    # escape analysis
method value (s.M)          → s on heap
method expression (T.M)     → no escape

PROFILING
─────────────────────────────
go test -bench=. -cpuprofile=cpu.prof
go test -bench=. -memprofile=mem.prof
go test -bench=. -trace=trace.out
go tool pprof / trace

CLEANER CODE
─────────────────────────────
Pure logic → function
State/IO   → method
Receiver consistency → important
Premature optimization → bad
Profile first, optimize later
```

---

## Summary

Method and function performance is usually identical — in most cases the difference is unnoticeable. However:

1. **Receiver choice** — value for small types, pointer for large types.
2. **Method value escape** — be careful in hot paths.
3. **Interface dispatch** — slight overhead via itab.
4. **Inlining** — small methods are preferred.
5. **Generics** — different code paths for pointer/interface vs scalar.
6. **Profile first** — measure before optimizing.

For cleaner code:
- Extract pure logic into functions.
- Keep receiver choice consistent.
- Hold up `go vet`, `staticcheck`, `go test -race` as team standards.
