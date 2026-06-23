# Go Pointers with Maps & Slices — Senior Level

## 1. Overview

Senior-level mastery: precise reasoning about slice header semantics, append's realloc decisions, map bucket layout, the GC trade-offs of pointer-vs-value collections, and concurrent-access patterns.

---

## 2. Advanced Semantics

### 2.1 Slice Header Layout
```
type slice struct {
    array unsafe.Pointer  // 8 B
    len   int             // 8 B
    cap   int             // 8 B
}
```

24 B total. Passed as 3 register values (AX, BX, CX) on amd64.

### 2.2 Append Growth Strategy
- Doubling for small slices (< 256 elements).
- ~25% growth for larger slices.
- Exact thresholds depend on element size and Go version.

```go
go func() {
    var s []int
    for i := 0; i < 100; i++ {
        oldCap := cap(s)
        s = append(s, i)
        if cap(s) != oldCap {
            fmt.Printf("len=%d cap=%d (was %d)\n", len(s), cap(s), oldCap)
        }
    }
}()
```

Observe growth pattern.

### 2.3 Map Internals
```go
type hmap struct {
    count     int           // # entries
    flags     uint8
    B         uint8         // log2 of bucket count
    noverflow uint16
    hash0     uint32
    buckets   unsafe.Pointer  // 2^B buckets
    oldbuckets unsafe.Pointer // for incremental rehash
    nevacuate uintptr
    extra     *mapextra
}
```

Maps grow by doubling buckets when load factor exceeds threshold (~6.5 entries per bucket on average).

During rehash, map values may move; this is why values aren't addressable.

### 2.4 Bucket Storage
Each bucket holds 8 (key, value) entries plus overflow pointer. Keys and values stored separately for cache locality.

For small value types: stored inline.
For large value types: stored as pointer; bucket holds the pointer.

### 2.5 GC Cost of Pointer Density

```go
type A struct{ items []*Item } // each *Item is a GC root
type B struct{ items []Item }  // 0 pointer roots within
```

For 1M items:
- A: 1M pointer roots; GC scans each.
- B: 1 root (the slice's backing array); GC scans the value bits.

GC overhead can differ 100×.

---

## 3. Production Patterns

### 3.1 Avoid Stale Pointer Pattern
```go
// Bad
p := &s[0]
s = append(s, ...)
*p = ... // possibly stale

// Good
i := 0
s = append(s, ...)
s[i] = ... // index is stable
```

### 3.2 Pre-Allocate Map Size
```go
m := make(map[string]int, expectedN)
```

Avoids progressive rehashing; faster fills.

### 3.3 Pool Map for Reuse
```go
var pool = sync.Pool{New: func() any { return make(map[string]int, 64) }}

func use() {
    m := pool.Get().(map[string]int)
    defer func() {
        for k := range m { delete(m, k) }
        pool.Put(m)
    }()
    // use m
}
```

### 3.4 Slice of Pointers Trade-off

When to use `[]*T`:
- Polymorphism (interface satisfaction needs pointer for some types).
- Sharing T instances across multiple slices.
- T is large and you don't want to copy on access.

When to prefer `[]T`:
- T is small.
- Each item logically owned by the slice.
- High GC sensitivity.

---

## 4. Concurrency Considerations

### 4.1 Slice Mutation Across Goroutines
```go
s := []int{1, 2, 3}
go func() { s[0] = 99 }()
go func() { s[1] = 100 }()
```

Different INDICES are technically not a race (different memory). BUT:
- Reading `s[i]` while another goroutine reads/writes is a race (unless synchronized).
- `len(s)` is a read of the slice header — racy if header is mutated.
- `append` may reallocate the backing array — definite race if shared.

### 4.2 Map Access
**Map operations are NOT goroutine-safe.** Concurrent reads + writes panic ("concurrent map read and map write").

Use:
- `sync.RWMutex` for protected access.
- `sync.Map` for specialized concurrent maps (designed for "set once, read many" or disjoint key sets).

### 4.3 Atomic Pointer Swap for Snapshot
```go
var snap atomic.Pointer[map[string]int]

m := map[string]int{...}
snap.Store(&m)

// Reader
ms := snap.Load()
v := (*ms)["key"]
```

Lock-free reads of immutable map snapshots.

---

## 5. Memory and GC Interactions

### 5.1 Slice Backing Array Lifetime
A subslice keeps the entire backing array alive:

```go
big := make([]byte, 1<<20)
small := big[:10]
big = nil
// 1 MB still alive via small
```

Fix: copy out small portion explicitly.

### 5.2 Map Rehash Cost
Maps rehash incrementally during operations. Each operation may pay a small rehash tax.

Pre-allocating size avoids most of this cost.

### 5.3 Pointer-Heavy Map Buckets
A `map[string]*BigStruct` has 8 B per value in buckets. A `map[string]BigStruct` (with 1 KB BigStruct) has 1 KB per value — buckets are huge, cache-unfriendly.

For large value types, prefer pointer storage.

---

## 6. Production Incidents

### 6.1 Stale Pointer After Append
A function returned a pointer to a slice element. Caller stored it; caller's slice was later appended; the stored pointer became stale. Bugs surfaced under load when slice sizes triggered reallocation.

Fix: return index instead of pointer; or copy the value out.

### 6.2 Map of Large Structs
`map[string]Config` where Config was 4 KB caused massive bucket sizes. Map operations were slow (cache misses).

Fix: `map[string]*Config`.

### 6.3 Concurrent Map Access Panic
Standard map concurrent read+write panic in production.

Fix: `sync.RWMutex` or `sync.Map`.

### 6.4 Subslice Pinning Memory
A function returned `data[:1000]` from a 100 MB buffer. The 100 MB stayed alive until the returned slice was discarded.

Fix: explicit copy when returning a small portion.

---

## 7. Best Practices

1. Always reassign after `append`.
2. Use `map[K]*V` for mutable struct values.
3. Pre-allocate slice cap and map size.
4. Defensive copy when storing caller data.
5. Use `atomic.Pointer[map]` for snapshot reads.
6. Use `sync.RWMutex` or `sync.Map` for concurrent maps.
7. Reduce pointer density for high-throughput services.
8. Watch sub-slice memory pinning.

---

## 8. Reading the Compiler Output

```bash
go build -gcflags="-m=2"
# Look for: "moved to heap" on slice element pointers, map values
```

```bash
go test -bench=. -benchmem
# See allocation patterns
```

---

## 9. Self-Assessment Checklist

- [ ] I understand slice header + backing
- [ ] I know append's growth strategy
- [ ] I avoid stale pointers
- [ ] I use map[K]*V for mutable values
- [ ] I pre-allocate sizes
- [ ] I synchronize concurrent map access
- [ ] I'm aware of subslice memory pinning
- [ ] I reduce pointer density for high-throughput

---

## 10. Summary

Slices and maps interact subtly with pointers. Slice element pointers go stale after append realloc. Map values can't be addressed. Use `map[K]*V` for mutable values. Pre-allocate capacities. Synchronize concurrent map access. Watch for subslice memory pinning. Reduce pointer density for GC throughput.

---

## 11. Further Reading

- [Slice internals](https://go.dev/blog/slices-intro)
- [Map source code](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/map.go)
- [`sync.Map`](https://pkg.go.dev/sync#Map)
- 2.7.4 Memory Management
