# Pointer Receivers — Optimize

## 1. Rules for choosing the receiver

```
Type size
─────────────────
≤ 16 bytes  → value (copying is faster for small types)
> 16 bytes  → pointer
has sync    → pointer (always)
```

## 2. Small type — value receiver is faster

```go
type Point struct{ X, Y int }  // 16 bytes

// Value — register move
func (p Point) DistSq() int { return p.X*p.X + p.Y*p.Y }

// Pointer — extra dereference
func (p *Point) DistSqP() int { return p.X*p.X + p.Y*p.Y }
```

`BenchmarkPoint` shows the value variant as faster in most cases.

## 3. Large type — pointer receiver

```go
type Big struct{ data [1024]int }  // 8KB

// Value — 8KB copy on every call
func (b Big) Sum() int { ... }

// Pointer — 8 bytes
func (b *Big) Sum() int { ... }
```

## 4. Inline opportunities

When a pointer receiver method is small — it's a good inline candidate:

```go
func (c *Counter) Inc() { c.n++ }  // inline candidate
```

Inline = no call overhead.

## 5. Escape avoidance

### Method value escape

```go
// Bad in a hot path
for _, x := range data {
    cb := obj.Process  // heap alloc per iteration
    cb(x)
}
```

### Solution

```go
// Direct
for _, x := range data { obj.Process(x) }

// Or build it once
cb := obj.Process
for _, x := range data { cb(x) }
```

## 6. Atomic vs Mutex

### Atomic (lock-free)

```go
type Counter struct{ n atomic.Int64 }
func (c *Counter) Inc() { c.n.Add(1) }
```

Speed: ~5-10ns

### Mutex

```go
type Counter struct {
    mu sync.Mutex
    n  int
}
func (c *Counter) Inc() {
    c.mu.Lock(); defer c.mu.Unlock()
    c.n++
}
```

Speed: ~20-30ns (no contention)

Atomic — typically 2-3x faster.

## 7. Choosing RWMutex

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}
```

Read methods use `RLock`, write methods use `Lock` — for read-heavy workloads.

But: if writes are rare and reads are very frequent — `sync.Map` or `atomic.Pointer[map]` may be faster.

## 8. Sync.Pool — re-use

```go
var bufPool = sync.Pool{New: func() any { return &Buffer{} }}

func process(data []byte) {
    b := bufPool.Get().(*Buffer)
    defer bufPool.Put(b)
    b.Reset()
    // use b
}
```

Reduces heap allocation.

## 9. Profile first

```bash
go test -bench=. -cpuprofile=cpu.prof
go tool pprof cpu.prof
(pprof) top
(pprof) list MyMethod
```

Premature optimization — root of evil. Justify with profiling.

## 10. Cleaner code patterns

### Separate pure logic

```go
// Pull out the pure logic inside
func (s *Service) Process(req Req) Resp {
    validated := validate(req)         // pure
    enriched := enrich(validated, s.cfg)  // pure
    return s.persist(enriched)          // method (state)
}
```

### Receiver consistency

```go
// Bad — mixed
func (c Cache) Len() int       { ... }
func (c *Cache) Set(k, v string) { ... }

// Good
func (c *Cache) Len() int       { ... }
func (c *Cache) Set(k, v string) { ... }
```

### Constructor responsibility

```go
// Let the constructor handle internal init the caller doesn't know about
func NewCache() *Cache {
    return &Cache{
        m: map[string]string{},
        // mutex zero-value OK
    }
}
```

## 11. Generics + pointer receiver

```go
type List[T any] struct{ items []T }
func (l *List[T]) Add(x T) { l.items = append(l.items, x) }
```

Generic monomorphization — one copy for pointer/interface types, separate ones for scalars. Confirm with profiling.

## 12. `noCopy` discipline

```go
type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

type SafeThing struct {
    _  noCopy
    mu sync.Mutex
    // ...
}
```

`go vet` finds copy operations — prevents accidental misuse.

## 13. Cheat Sheet

```
RECEIVER CHOICE
─────────────────────────
≤16 bytes, immutable    → value
>16 bytes or mutate     → pointer
has sync primitive      → pointer (mandatory)
hot path inline         → small pointer receiver

ESCAPE CONTROL
─────────────────────────
go build -gcflags='-m=2'
method value (s.M)     → likely escape
method expression (T.M) → no escape

CONCURRENCY
─────────────────────────
Atomic > Mutex > RWMutex > sync.Map
sync.Pool — reduce heap alloc
Lock-free design — atomic primitive

PROFILE
─────────────────────────
go test -bench=. -cpuprofile=cpu.prof
go test -bench=. -memprofile=mem.prof
go test -bench=. -trace=trace.out
go tool pprof / trace
```

## 14. Summary

Pointer receiver performance:
- Small type → value, large type → pointer
- Mutex/atomic → always pointer
- Method value in a hot path → escape consequences
- Atomic > Mutex in speed
- `noCopy` marker prevents accidental copies
- Justify with profiling, don't optimize prematurely

Cleaner code:
- Separate pure logic into a function
- Keep receiver style consistent
- Constructor responsibility — internal init
- Documentation — concurrency, lifecycle
