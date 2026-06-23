# Go Garbage Collection — Optimize

## Exercise 1 🟢 — Set GOMEMLIMIT

```go
import "runtime/debug"

func main() {
    debug.SetMemoryLimit(int64(0.95 * float64(containerMem)))
}
```

Prevents OOM by triggering aggressive GC near limit.

---

## Exercise 2 🟢 — Tune GOGC for Workload

```bash
GOGC=200 ./prog  # less GC, more memory
```

For memory-rich, latency-sensitive services. Trade memory for fewer GC cycles.

---

## Exercise 3 🟡 — Reduce Allocation Rate

```go
// Bad: alloc per request
func handle() {
    buf := make([]byte, 4096)
    process(buf)
}

// Good: pool
var pool = sync.Pool{New: func() any { return make([]byte, 4096) }}

func handle() {
    buf := pool.Get().([]byte)
    defer pool.Put(buf)
    process(buf)
}
```

Less alloc → less GC pressure.

---

## Exercise 4 🟡 — Reduce Pointer Density

```go
// Bad: 1M GC roots
items := []*Item{...}

// Good: 1 GC root (the slice backing)
items := []Item{...}
```

GC mark cost drops dramatically.

---

## Exercise 5 🟡 — Pre-Allocate Slice/Map

```go
make([]T, 0, n)
make(map[K]V, n)
```

Avoids reallocations + their GC overhead.

---

## Exercise 6 🔴 — Bound Goroutines

```go
sem := make(chan struct{}, 100)
for _, item := range items {
    sem <- struct{}{}
    go func(item Item) {
        defer func() { <-sem }()
        process(item)
    }(item)
}
```

Limits concurrent goroutines; reduces stack scan time during GC.

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
    if c.deletes > len(c.m)*2 {
        // Rebuild to release oversized buckets
        newM := make(map[K]V, len(c.m))
        for k, v := range c.m { newM[k] = v }
        c.m = newM
        c.deletes = 0
    }
}
```

---

## Exercise 8 🔴 — Profile-Guided Optimization (PGO)

```bash
go test -cpuprofile=cpu.prof -bench=.
go build -pgo=cpu.prof .
```

Compiler uses profile to inline hot paths, devirtualize interfaces. Often eliminates allocations.

---

## Exercise 9 🔴 — Inspect with `gctrace`

```bash
GODEBUG=gctrace=1 ./service 2>gc.log
```

Parse:
- Heap size trends.
- GC frequency.
- Pause times.

If pauses exceed SLO, investigate top allocators.

---

## Exercise 10 🔴 — Allocation Profile in Production

```go
import _ "net/http/pprof"

go http.ListenAndServe("localhost:6060", nil)
```

```bash
# Capture 30s of allocation samples
go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
```

Identify and fix top allocators.
