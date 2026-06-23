# Go Memory Management — Optimize

## Exercise 1 🟢 — Pre-Allocate Slice Cap

```go
// Bad
var s []int
for i := 0; i < N; i++ { s = append(s, i) }

// Good
s := make([]int, 0, N)
```

Saves ~log2(N) reallocations.

---

## Exercise 2 🟢 — Pre-Allocate Map Size

```go
m := make(map[K]V, N)
```

Avoids progressive rehashing.

---

## Exercise 3 🟡 — sync.Pool for Hot Allocation

```go
var pool = sync.Pool{New: func() any { return new(Buffer) }}

func use() {
    b := pool.Get().(*Buffer)
    defer func() { b.Reset(); pool.Put(b) }()
    // use b
}
```

Reduces alloc rate; lower GC frequency.

---

## Exercise 4 🟡 — Reduce Pointer Density

```go
// Bad
type Events struct { items []*Event }

// Good (when ownership exclusive)
type Events struct { items []Event }
```

Fewer GC roots; better cache locality.

---

## Exercise 5 🟡 — Set GOMEMLIMIT for Containers

```go
import "runtime/debug"

func main() {
    debug.SetMemoryLimit(int64(0.9 * containerLimit))
}
```

Prevents OOM by triggering more aggressive GC near the limit.

---

## Exercise 6 🔴 — Subslice Copy to Release Backing

```go
func extractFirst(big []byte) []byte {
    out := make([]byte, 100)
    copy(out, big[:100])
    return out
}
```

Returns independent slice; backing array can be GC'd.

---

## Exercise 7 🔴 — Periodic Map Rebuild

```go
type Cache struct {
    mu sync.Mutex
    m  map[K]V
    deletes int
}

func (c *Cache) Delete(k K) {
    c.mu.Lock(); defer c.mu.Unlock()
    delete(c.m, k)
    c.deletes++
    if c.deletes > len(c.m) {
        // recreate map to release old buckets
        newM := make(map[K]V, len(c.m))
        for k, v := range c.m { newM[k] = v }
        c.m = newM
        c.deletes = 0
    }
}
```

---

## Exercise 8 🔴 — Profile and Optimize Top Allocator

```bash
go test -bench=. -benchmem -memprofile=mem.out
go tool pprof -alloc_space mem.out
top
```

Find hot allocation site. Apply:
- Pre-allocation.
- sync.Pool.
- Reduce pointer density.
- Inline value-typed.

Re-benchmark; verify improvement.

---

## Exercise 9 🔴 — Verify Inlining Eliminates Allocation

```go
func tiny() *int {
    n := 5
    return &n
}
```

Run `go build -gcflags="-m"`. If `tiny` is inlined into a caller that doesn't escape, `n` may stay on stack.

For inlining: keep functions small; avoid `defer`, complex control flow.

---

## Exercise 10 🔴 — `atomic.Pointer` for Lock-Free Snapshot

```go
import "sync/atomic"

var configPtr atomic.Pointer[Config]

func get() *Config { return configPtr.Load() }
func reload() { configPtr.Store(loadConfig()) }
```

Lock-free reads; readers see consistent snapshots without locking.
