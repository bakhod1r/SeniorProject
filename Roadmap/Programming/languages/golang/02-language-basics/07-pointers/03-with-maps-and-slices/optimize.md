# Go Pointers with Maps & Slices — Optimize

## Instructions

Identify, fix, explain. Difficulty: 🟢 🟡 🔴.

---

## Exercise 1 🟢 — Pre-Allocate Slice Capacity

**Problem**:
```go
var s []int
for i := 0; i < 1000; i++ {
    s = append(s, i)
}
```

**Fix**:
```go
s := make([]int, 0, 1000)
for i := 0; i < 1000; i++ {
    s = append(s, i)
}
```

Avoids ~10 reallocations; 2-3× faster.

---

## Exercise 2 🟢 — Pre-Allocate Map Size

**Problem**:
```go
m := map[int]int{}
for i := 0; i < 1000; i++ {
    m[i] = i
}
```

**Fix**:
```go
m := make(map[int]int, 1000)
```

Avoids progressive rehashing.

---

## Exercise 3 🟡 — Use Index, Not Pointer After Append

**Problem**:
```go
p := &s[0]
s = append(s, 99) // may invalidate p
*p = 999          // potentially stale
```

**Fix**:
```go
i := 0
s = append(s, 99)
s[i] = 999
```

Indices are stable; pointers may go stale.

---

## Exercise 4 🟡 — Reduce Pointer Density in Slice

**Problem**:
```go
type Event struct{ /* fields */ }
events := []*Event{} // each ptr is GC root
```

**Fix** (when ownership exclusive):
```go
events := []Event{} // contiguous; 0 internal pointer roots
```

GC scan time drops dramatically. Cache locality improves.

---

## Exercise 5 🟡 — Map Value Inline vs Pointer

**Problem**: `map[string]Config` where Config is 4 KB. Buckets are huge → cache misses.

**Fix**:
```go
m := map[string]*Config{}
```

Bucket value slot is 8 B (pointer) → buckets fit in L1 cache.

---

## Exercise 6 🔴 — Defensive Copy Cost

**Problem**:
```go
func Set(items []Item) {
    cache.items = append([]Item(nil), items...) // copies every time
}
```

If callers don't mutate, the copy is wasteful.

**Fix** — document contract: "caller must not mutate items after Set".

OR copy only when caller may mutate; trust documentation otherwise.

For library code where you can't trust callers: keep the copy.

---

## Exercise 7 🔴 — sync.Pool Map Reuse

**Problem**: A function allocates a `map[string]int` per call, used for a single pass.

**Fix**:
```go
var mapPool = sync.Pool{New: func() any { return make(map[string]int, 64) }}

func use() {
    m := mapPool.Get().(map[string]int)
    defer func() {
        for k := range m { delete(m, k) }
        mapPool.Put(m)
    }()
    // use m
}
```

Reduces map allocation rate.

---

## Exercise 8 🔴 — Atomic.Pointer for Hot-Reload Config Map

**Problem**:
```go
var configMu sync.RWMutex
var configMap map[string]string

func Get(k string) string {
    configMu.RLock()
    defer configMu.RUnlock()
    return configMap[k]
}
```

Hot reads pay locking cost.

**Fix** — atomic.Pointer to immutable map:
```go
import "sync/atomic"

var configPtr atomic.Pointer[map[string]string]

func Get(k string) string {
    return (*configPtr.Load())[k]
}

func Reload(newConfig map[string]string) {
    configPtr.Store(&newConfig)
}
```

Lock-free reads; writers atomically swap.
