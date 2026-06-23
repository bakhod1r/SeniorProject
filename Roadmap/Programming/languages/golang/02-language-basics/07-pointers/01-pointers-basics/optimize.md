# Go Pointers Basics — Optimize

## Instructions

Each exercise presents inefficient pointer usage. Identify the issue, fix it. Difficulty: 🟢 🟡 🔴.

---

## Exercise 1 🟢 — Returning Pointer When Value Suffices

**Problem**:
```go
func newPair(a, b int) *Pair { return &Pair{A: a, B: b} }
```

For small types, this allocates per call. **Fix** — return value:
```go
func newPair(a, b int) Pair { return Pair{A: a, B: b} }
```

Benchmark: pointer ~20 ns/op + 1 alloc; value ~3 ns/op + 0 alloc.

**Key insight**: For small types, return value. Pointer return forces heap.

---

## Exercise 2 🟢 — Unnecessary Pointer Argument

**Problem**:
```go
func sum(p *int) int { return *p }
sum(&n)
```

Just pass the value:
```go
func sum(n int) int { return n }
```

For primitives, value pass is faster (register, no indirection).

---

## Exercise 3 🟡 — Pool Heavy Allocations

**Problem**: A function allocates a 1 KB buffer per call.

**Fix** — `sync.Pool`:
```go
var pool = sync.Pool{New: func() any { return new([1024]byte) }}

func use() {
    buf := pool.Get().(*[1024]byte)
    defer pool.Put(buf)
    // use buf
}
```

Benchmark: ~50× fewer allocations.

---

## Exercise 4 🟡 — Use atomic.Pointer Instead of Mutex for Snapshot

**Problem**:
```go
var mu sync.RWMutex
var config *Config

func get() *Config {
    mu.RLock(); defer mu.RUnlock()
    return config
}
```

**Fix** — atomic.Pointer:
```go
var configPtr atomic.Pointer[Config]

func get() *Config { return configPtr.Load() }
```

Lock-free reads; faster under high concurrency.

---

## Exercise 5 🟡 — Reduce Pointer Density

**Problem**: `[]*Item` for 1M items adds 1M GC roots.

**Fix** — `[]Item` (slice of values):
```go
type Items []Item // value-typed slice
```

Each item inline; better cache locality; fewer GC roots.

When pointers ARE needed (sharing): keep them; otherwise prefer values.

---

## Exercise 6 🔴 — Atomic.Pointer for Snapshot Config

**Problem**: Reload config without locking readers.

```go
import "sync/atomic"

type Config struct { /* ... */ }
var current atomic.Pointer[Config]

func init() {
    current.Store(loadConfig())
}

func reload() {
    new := loadConfig()
    current.Store(new) // lock-free swap
}

func handle() {
    cfg := current.Load() // safe snapshot
    // use cfg
}
```

Old configs become garbage when all readers finish; GC handles cleanup.

---

## Exercise 7 🔴 — Verify Stack Allocation

**Problem**:
```go
func helper() int {
    p := new(int)
    *p = 42
    return *p
}
```

Does `new(int)` heap-allocate?

**Verify**:
```bash
go build -gcflags="-m" .
# helper inlined; new(int) likely doesn't escape; allocated on stack.
```

If you see "moved to heap", investigate. For simple cases, escape analysis keeps it on the stack.

---

## Exercise 8 🔴 — Avoid Pointer Aliasing in Hot Path

**Problem**:
```go
func add(a, b *int) {
    for i := 0; i < 1000; i++ {
        *a = *a + *b
    }
}
```

Each iteration must reload `*a` because the compiler can't prove `a != b`.

**Fix** — load to register first:
```go
func add(a, b *int) {
    sum := *a
    delta := *b
    for i := 0; i < 1000; i++ {
        sum += delta
    }
    *a = sum
}
```

Benchmark: ~10× speedup for memory-bound loop.

**Key insight**: Pointer aliasing limits compiler optimization. Hoist loads/stores.
