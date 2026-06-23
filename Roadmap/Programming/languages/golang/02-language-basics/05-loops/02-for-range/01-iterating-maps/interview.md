# Iterating Maps — Interview Questions

## Junior Level

### Q1: How do you iterate over a map in Go?

**A:** Use `for range`:
```go
for key, value := range myMap {
    fmt.Println(key, value)
}
```

---

### Q2: Is map iteration order guaranteed in Go?

**A:** No. Map iteration order is deliberately randomized in Go. Even the same map will produce different orderings on consecutive runs. Never rely on map order.

---

### Q3: How do you iterate only over keys?

**A:**
```go
for key := range myMap {
    fmt.Println(key)
}
```

---

### Q4: How do you iterate only over values?

**A:** Use `_` to ignore the key:
```go
for _, value := range myMap {
    fmt.Println(value)
}
```

---

### Q5: What happens if you range over a nil map?

**A:** The loop executes 0 iterations. It does not panic.
```go
var m map[string]int
for k, v := range m { fmt.Println(k, v) } // never runs
```

---

### Q6: How do you get map entries in sorted order?

**A:** Collect keys into a slice, sort it, then look up values:
```go
keys := make([]string, 0, len(m))
for k := range m { keys = append(keys, k) }
sort.Strings(keys)
for _, k := range keys {
    fmt.Println(k, m[k])
}
```

---

### Q7: Can you delete from a map while ranging over it?

**A:** Yes. Deleting during range is safe in Go. The deleted key will not appear in later iterations.

---

### Q8: Can you modify a struct value inside a map during range?

**A:** Not via the value copy. You must reassign to the map key:
```go
for k := range m {
    v := m[k]
    v.Field = 99
    m[k] = v // must reassign!
}
```

---

## Middle Level

### Q9: Why does Go randomize map iteration order?

**A:** Two reasons:
1. **Correctness:** Prevents code from accidentally depending on ordering behavior.
2. **Security:** Randomized hash seeds prevent hash-flooding attacks where an attacker sends many keys that all hash to the same bucket, degrading O(1) to O(n) lookups.

---

### Q10: What is the difference between `map[T]struct{}` and `map[T]bool` for sets?

**A:** `map[T]struct{}` uses zero bytes for values (struct{} occupies no memory). `map[T]bool` uses 1 byte per value. For large sets, `map[T]struct{}` is more memory efficient and signals intent more clearly.

```go
// Set with struct{}
set := map[string]struct{}{}
set["a"] = struct{}{}
_, exists := set["a"] // exists = true
```

---

### Q11: What is `sync.Map` and when should you use it over `map + RWMutex`?

**A:** `sync.Map` is a concurrent map built into the standard library. Use it when:
- Multiple goroutines write to disjoint keys (e.g., each goroutine has its own set of keys)
- Reads heavily outnumber writes

`map + RWMutex` is better when:
- One goroutine writes, many read (classic reader-writer pattern)
- You need atomic snapshot of all entries
- Simpler code is preferable

---

### Q12: What does `maps.DeleteFunc` do?

**A:** `maps.DeleteFunc(m, fn)` (Go 1.21+) deletes all entries where `fn(k, v)` returns true:
```go
maps.DeleteFunc(scores, func(k string, v int) bool {
    return v < 60 // delete failing scores
})
```
This replaces a manual range-with-delete pattern.

---

### Q13: What is the risk of adding keys to a map during range iteration?

**A:** The Go specification says newly added keys may or may not be visited in the current range. The behavior is unpredictable and depends on bucket layout and hash values. Never add keys to a map you are currently ranging over.

---

### Q14: How does `fmt.Println` print maps deterministically?

**A:** Since Go 1.12, the `fmt` package prints maps with keys sorted in their natural order. This is done inside `fmt` only for display. The underlying map iteration is still random; `fmt` collects and sorts internally.

---

### Q15: What is the difference between ranging over `sync.Map` and a regular map?

**A:** Regular maps use `for k, v := range m`. `sync.Map` uses a method: `m.Range(func(k, v interface{}) bool { return true })`. The return value controls whether to continue (`true`) or stop (`false`). `sync.Map.Range` is NOT a snapshot — concurrent modifications may or may not be seen.

---

## Senior Level

### Q16: Explain the internal randomization mechanism of Go's map iteration.

**A:** When `mapiterinit()` is called, it uses `fastrand()` (a lightweight runtime PRNG) to compute a random starting bucket index and an offset within that bucket. The iterator then visits all buckets starting from that position, wrapping around. Every element is visited exactly once regardless of starting position.

---

### Q17: How does map iteration handle concurrent map growth?

**A:** During map growth (load factor > 6.5), Go incrementally evacuates old buckets to new buckets. The iterator maintains both `buckets` (new) and snapshot pointers. For each bucket, it checks the `evacuated` flag:
- Not evacuated: iterate the old bucket
- Evacuated: iterate the corresponding new bucket(s)
This ensures every element is visited exactly once during growth.

---

### Q18: What is the memory layout of a Go map bucket and why does it matter for iteration?

**A:** Each bucket holds 8 key-value pairs with tophash bytes at the start, followed by keys, then values. The tophash array allows the iterator to quickly skip empty slots without examining the keys themselves. The layout is cache-line optimized for 8 entries — the tophash and a few key-value pairs fit in 1-2 cache lines.

---

### Q19: When would you use a COW (Copy-On-Write) map pattern?

**A:** When reads are highly concurrent and frequent but writes are rare (e.g., configuration that updates every few minutes). The reader atomically loads a pointer to an immutable map and ranges over it without any lock. The writer creates a full copy, modifies it, then atomically swaps the pointer.

```go
var configPtr atomic.Pointer[map[string]string]

// Reader — lock-free
cfg := configPtr.Load()
for k, v := range *cfg { use(k, v) }

// Writer — rare
old := configPtr.Load()
newCfg := maps.Clone(*old)
newCfg["key"] = "value"
configPtr.Store(&newCfg)
```

---

### Q20: How does `reflect.MapRange()` differ from direct `for range`?

**A:** `reflect.MapRange()` returns a `*reflect.MapIter` that wraps the runtime's `hiter`. Internally it calls `mapiterinit` and `mapiternext`. Each `iter.Key()` and `iter.Value()` call wraps the raw pointer in a `reflect.Value`, which requires type metadata lookup and possible allocation. This overhead is 20-50x compared to direct `for range`.

---

## Scenario Questions

### Q21: Scenario — Debugging

You have a function that builds a string from a map and uses it as a Redis cache key. Users report intermittent cache misses. What's wrong?

**A:** Map iteration is random. The same map produces different key strings on each call. Fix: sort the keys before building the string, or use a canonical serialization format (e.g., JSON with sorted keys via `encoding/json`).

---

### Q22: Scenario — Performance

A service iterates a `map[string]Record` with 1 million entries on every HTTP request. Profiling shows this loop takes 200ms. How do you fix it?

**A:**
1. First: cache the iteration result (compute once, serve from cache)
2. If freshness required: use a sorted `[]KeyValue` slice instead — 5-10x faster due to cache locality
3. If concurrent updates: use snapshot approach with RWMutex
4. If partial scan: precompute an index, don't full-scan every request

---

### Q23: Scenario — Bug

```go
var handlers = map[string]func(){
    "login":  func() { fmt.Println("login") },
    "logout": func() { fmt.Println("logout") },
}
```

A colleague says: "We can call `handlers[key]()` and it will execute in registration order." What's wrong?

**A:** Maps have no insertion order. `handlers` will not iterate in registration order. If ordered execution matters, use a slice of structs: `[]struct{name string; fn func()}`.

---

### Q24: How would you implement a thread-safe frequency counter used by many goroutines?

**A:**
```go
type Counter struct {
    mu sync.Mutex
    m  map[string]int
}
func (c *Counter) Inc(key string) {
    c.mu.Lock()
    c.m[key]++
    c.mu.Unlock()
}
func (c *Counter) Snapshot() map[string]int {
    c.mu.Lock()
    defer c.mu.Unlock()
    snap := make(map[string]int, len(c.m))
    for k, v := range c.m { snap[k] = v }
    return snap
}
// Or for very high concurrency: sharded counter with per-shard mutex
```

---

## FAQ

### Q25: Is `maps.Keys()` (Go 1.21) lazy or eager?

**A:** In Go 1.21, `maps.Keys()` returns `[]K` (eager — allocates slice). In Go 1.23+, `maps.Keys()` returns `iter.Seq[K]` (lazy — no allocation until iterated). The signature changed between versions.

---

### Q26: What is the fastest way to check if two maps have the same entries?

**A:** Use `maps.Equal(m1, m2)` (Go 1.21+) for maps with comparable values. Manually: check `len` equality first, then range over one and compare values in the other.

---

### Q27: Can I range over a `map[string]any` (interface values)?

**A:** Yes. The `v` variable will have type `interface{}` (or `any`). Use type assertions to access the underlying value:
```go
for k, v := range m {
    if s, ok := v.(string); ok {
        fmt.Println(k, s)
    }
}
```

---

### Q28: Why does `for range` on map not support the `for range n` integer syntax?

**A:** The integer range `for i := range n` is syntactic sugar for `for i := 0; i < n; i++`. Maps need key-value iteration semantics. They are fundamentally different — maps have no natural "length" in terms of iteration position; their iteration is via bucket scanning.

---

### Q29: Does ranging over a map copy the map?

**A:** No. The map header (`hmap*`) is passed by reference. The range expression is evaluated once (capturing the map pointer), but no data is copied. Entries are accessed in-place via the `hiter`.

---

### Q30: What is `maps.Collect` and how is it used with map iteration?

**A:** `maps.Collect` (Go 1.23+) converts an `iter.Seq2[K, V]` into a `map[K]V`. Combined with other iterators:
```go
import "maps"
// Collect filtered map entries
filtered := maps.Collect(filterSeq(maps.All(original), pred))
```
This enables functional-style map transformations without intermediate allocations (lazy evaluation).
