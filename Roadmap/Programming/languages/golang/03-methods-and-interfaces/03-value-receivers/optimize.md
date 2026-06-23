# Value Receivers — Optimize

## 1. Type size

| Size | Choice | Reason |
|------|--------|-------|
| ≤ 16 bytes | Value | Passed in registers, copy is very fast |
| 16–64 bytes | Depends | Justify with a profile |
| > 64 bytes | Pointer | Exceeds a cache line, copy is expensive |

## 2. Field order (padding)

```go
// BAD — 24 bytes
type Bad struct {
    a bool   // 1 + 7 padding
    b int64  // 8
    c bool   // 1 + 7 padding
}

// GOOD — 16 bytes
type Good struct {
    b int64  // 8
    a bool   // 1
    c bool   // 1 + 6 padding
}
```

The `fieldalignment` tool shows the optimized order.

## 3. Inline candidates

Small value receiver methods are good inline candidates:

```go
func (p Point) X() int { return p.x }   // inline candidate
```

`go build -gcflags='-m'` shows: "can inline (Point).X".

## 4. Defensive copy — cost

```go
func (b Box) Items() []int {
    out := make([]int, len(b.items))  // alloc
    copy(out, b.items)                // copy
    return out
}
```

Defensive copy can be expensive. Only do it when mutation of the original is a real risk.

## 5. Slice header optimization

Slice value receiver — the slice header (24 bytes) is copied. This is usually cheap.

```go
type IntSlice []int
func (s IntSlice) Sum() int { ... }   // value OK — header copy
```

## 6. Pure function inline → no escape

```go
func (p Point) DistSq() int { return p.x*p.x + p.y*p.y }

p := Point{3, 4}
result := p.DistSq()  // inlined — p stays on the stack, no escape
```

## 7. Interface escape

```go
type S struct{ name string }
func (s S) String() string { return s.name }

s := S{name: "x"}
var i fmt.Stringer = s   // s escapes to the heap
```

The contents of the interface value go to the heap. Sometimes the value escapes at the caller.

## 8. Comparable for map keys

A comparable type as a map key — the hash is cheap and consistent:

```go
type Key struct{ A, B int }   // comparable
m := map[Key]string{}
```

## 9. Sync.Pool with value types

When the value type is large, reuse it via `sync.Pool`:

```go
var pool = sync.Pool{New: func() any { return new(BigStruct) }}

func process() {
    b := pool.Get().(*BigStruct)
    defer pool.Put(b)
    // ...
}
```

But this uses pointers — value receivers do not fit.

## 10. Profile

```bash
go test -bench=. -cpuprofile=cpu.prof
go tool pprof cpu.prof
(pprof) list MyMethod
```

Memory:
```bash
go test -bench=. -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
```

## 11. Cleaner code

### Pure logic — value receiver

```go
func (m Money) Add(o Money) Money { ... }   // pure
```

Easy to test, immutable, parallel-safe.

### Avoid hidden mutations

```go
// BAD — returns the slice field
func (b Box) Items() []int { return b.items }

// GOOD — defensive or duplicated
func (b Box) Items() []int {
    out := make([]int, len(b.items))
    copy(out, b.items)
    return out
}
```

### Constructor validation

```go
func NewEmail(s string) (Email, error) {
    if !valid(s) { return Email{}, errInvalid }
    return Email{value: s}, nil
}
```

An invalid value cannot be created.

## 12. Cheat Sheet

```
TYPE SIZE
─────────────────────────
≤16   → value (register)
16-64 → with a profile
>64   → pointer (cache line)

FIELD ORDER
─────────────────────────
Largest to smallest (minimum padding)
fieldalignment tool

INLINE
─────────────────────────
Small body preferred
defer/recover/goroutine — no inline

ESCAPE
─────────────────────────
Stack: local value, return value
Heap: interface, goroutine

DEFENSIVE COPY
─────────────────────────
Slice/map field → mutation risk
out := make(...); copy(out, ...)

CLEANER CODE
─────────────────────────
Pure logic → value
Don't mutate — return new
Constructor validation
```

## 13. Summary

Value receiver performance:
- Small type → fast
- Padding optimization — smaller
- Good for inlining
- Comparable → map key, `==` works
- Pure function — test/concurrency are cheap

Cleaner code:
- Immutable update (return new)
- Defensive copy — slice/map fields
- Constructor validation
- Documentation — immutability disclaimer

Value receiver — one of Go's simplest, most powerful tools. Used correctly, code becomes simpler, has fewer bugs, and concurrency concerns become tractable.
