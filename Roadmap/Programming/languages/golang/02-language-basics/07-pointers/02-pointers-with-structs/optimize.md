# Go Pointers with Structs — Optimize

## Instructions

Identify the issue, fix, explain. Difficulty: 🟢 🟡 🔴.

---

## Exercise 1 🟢 — Constructor Allocates Per Call

**Problem**:
```go
func NewParser() *Parser { return &Parser{} } // 2 KB alloc per call
// Hot: 50k calls/sec → 100 MB/sec alloc
```

**Fix** — `sync.Pool`:
```go
var parserPool = sync.Pool{New: func() any { return new(Parser) }}

func acquire() *Parser { return parserPool.Get().(*Parser) }
func release(p *Parser) { p.Reset(); parserPool.Put(p) }
```

Reduces allocation rate ~95% in steady state.

---

## Exercise 2 🟢 — Pointer for Large Struct, Value for Small

**Problem**:
```go
type Coord struct{ X, Y, Z float64 } // 24 B

func newCoord() *Coord { return &Coord{} } // unnecessary heap alloc
```

**Fix** — return value:
```go
func newCoord() Coord { return Coord{} } // register-passed
```

For small types, value return is faster.

---

## Exercise 3 🟡 — Method on Large Struct With Value Receiver

**Problem**:
```go
type State struct{ Buffer [256]int }

func (s State) Sum() int { /* ... */ } // copies 2 KB per call!
```

**Fix** — pointer receiver:
```go
func (s *State) Sum() int { /* ... */ }
```

Cuts call cost from ~300 ns to ~150 ns + 0 alloc.

---

## Exercise 4 🟡 — Reduce Pointer Density

**Problem**:
```go
type EventList struct{ items []*Event } // 1M pointers + 1M events
```

**Fix** — value slice:
```go
type EventList struct{ items []Event } // contiguous memory, fewer GC roots
```

GC scan time drops dramatically. Cache locality improves.

When pointers are needed (sharing across structures): keep them. Otherwise prefer values.

---

## Exercise 5 🟡 — Atomic Pointer for Snapshot Config

**Problem**:
```go
var mu sync.RWMutex
var config *Config

func get() *Config { mu.RLock(); defer mu.RUnlock(); return config }
```

**Fix** — atomic.Pointer:
```go
var configPtr atomic.Pointer[Config]
func get() *Config { return configPtr.Load() }
```

Lock-free reads; faster under high concurrency.

---

## Exercise 6 🔴 — Sub-Object Lifetime Pinning

**Problem**:
```go
big := &Big{Sub: SubStruct{...}}
sub := &big.Sub
big = nil
// sub keeps Big alive (Sub is part of Big's allocation)
```

**Fix** — copy out:
```go
sub := big.Sub // value copy
big = nil
// sub is independent; Big can be GC'd
```

---

## Exercise 7 🔴 — Struct Field Layout for Cache Locality

**Problem**:
```go
type Bad struct {
    A int8     // 1 byte
    B int64    // 8 bytes — but offset 8 due to padding
    C int8     // offset 16
    D int64    // offset 24 due to padding
}
// Total: 32 bytes (lots of padding)
```

**Fix** — reorder by size descending:
```go
type Good struct {
    B int64    // offset 0
    D int64    // offset 8
    A int8     // offset 16
    C int8     // offset 17
    // 6 bytes padding to multiple of 8
}
// Total: 24 bytes
```

Verify with `unsafe.Sizeof`.

For high-volume data structures, the saved bytes × millions of instances matters.

---

## Exercise 8 🔴 — Verify Constructor Doesn't Heap-Allocate

**Problem**:
```go
func use() {
    p := &Point{X: 1, Y: 2}
    fmt.Println(p.X)
}
```

**Verify** stack allocation:
```bash
go build -gcflags="-m" .
# Look for: "&Point literal does not escape"
```

If you see "moved to heap", the pointer escaped. Investigate.

For non-escaping uses, `&T{}` stays on the stack — no allocation cost.

**Lesson**: Profile escape behavior; don't speculate.
