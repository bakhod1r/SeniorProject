# Go Maps — Senior Level

## Table of Contents
1. Hash Table Architecture in Go's Runtime
2. Bucket Structure and tophash
3. Evacuation and Incremental Rehashing
4. Map Growth Algorithm
5. Overflow Buckets
6. Memory Layout: hmap and bmap
7. mapaccess1 and mapaccess2 Internals
8. mapassign and mapdelete Internals
9. Hash Seed and Security
10. Concurrent Map Detection in Runtime
11. Map in the GC — Pointer Scanning
12. Performance Characteristics Under Load
13. Production Monitoring Patterns
14. Cache-Effective Map Designs
15. Lock-Free Map Alternatives
16. Postmortem: Data Race on Global Map
17. Postmortem: Memory Leak via Map Growth
18. Postmortem: NaN Key Bug in Production
19. System Failure: Concurrent Map Write Panic
20. Advanced Pattern: Expiring Cache
21. Advanced Pattern: Bidirectional Map
22. Advanced Pattern: Typed Registry
23. Profiling Map Performance
24. Assembly-Level Map Inspection
25. Maps in microservice Caching Layer
26. Tuning map for Throughput
27. Summary: Senior Decision Framework

---

## 1. Hash Table Architecture in Go's Runtime

Go's map implementation lives in `runtime/map.go`. The key struct is `hmap`:

```go
// runtime/map.go (simplified)
type hmap struct {
    count     int            // number of live cells (len(map))
    flags     uint8          // iterator, writing, hashWriting flags
    B         uint8          // log_2 of # of buckets (can hold loadFactor * 2^B items)
    noverflow uint16         // approx number of overflow buckets
    hash0     uint32         // hash seed (randomized at map creation)
    buckets   unsafe.Pointer // array of 2^B Buckets
    oldbuckets unsafe.Pointer // previous bucket array (during growth)
    nevacuate uintptr        // progress counter for evacuation
    extra     *mapextra      // optional fields for overflow buckets
}
```

```
Visual memory layout:

hmap header (8 fields)
    │
    ├── buckets → [2^B]bmap
    │               │
    │               ├── bmap[0]: tophash[8], keys[8], values[8], overflow*
    │               ├── bmap[1]: ...
    │               └── bmap[2^B-1]: ...
    │
    └── oldbuckets → [2^(B-1)]bmap  (only during growth)
```

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    m := make(map[string]int)
    // The map variable itself is just a pointer (8 bytes on 64-bit)
    fmt.Println(unsafe.Sizeof(m)) // 8
    // The hmap header is allocated on the heap
}
```

---

## 2. Bucket Structure and tophash

Each bucket (`bmap`) holds up to **8** key-value pairs:

```go
// runtime/map.go (simplified bmap)
type bmap struct {
    // tophash stores the top 8 bits of each key's hash
    // Special values (0-4) indicate empty/evacuated slots
    tophash [bucketCnt]uint8 // bucketCnt = 8
    // keys and values follow in memory:
    // keys   [bucketCnt]K
    // values [bucketCnt]V
    // overflow *bmap
}
```

```
Bucket memory layout (for map[string]int):
┌─────────────────────────────────────────────────────┐
│ tophash  [8]uint8  (8 bytes)                        │
├─────────────────────────────────────────────────────┤
│ keys     [8]string (16 bytes each = 128 bytes)      │
├─────────────────────────────────────────────────────┤
│ values   [8]int    (8 bytes each = 64 bytes)        │
├─────────────────────────────────────────────────────┤
│ overflow *bmap     (8 bytes)                        │
└─────────────────────────────────────────────────────┘
Total: 8 + 128 + 64 + 8 = 208 bytes per bucket
```

**Why tophash?** Comparing 8-bit integers is faster than comparing full keys. When looking up a key, Go first checks tophash to rule out non-matching slots before doing a full key comparison.

```go
package main

import "fmt"

func main() {
    // Demonstrating the efficiency: tophash acts as a mini bloom filter
    // For a map[string]int with 8 entries in one bucket:
    // - Lookup checks 8 tophash bytes first (very fast, cache line friendly)
    // - Full key comparison only happens on tophash match
    m := make(map[string]int)
    for i := 0; i < 8; i++ {
        m[fmt.Sprintf("key%d", i)] = i
    }
    fmt.Println(len(m)) // 8 — fits in one bucket
}
```

---

## 3. Evacuation and Incremental Rehashing

Go's map growth is **incremental** — it evacuates old buckets over time:

```go
// Pseudocode of incremental evacuation
// During mapassign or mapdelete:
//   if map is growing:
//     evacuate(oldbuckets[nevacuate])
//     nevacuate++
//     if nevacuate == len(oldbuckets):
//       growth complete
```

This design avoids stop-the-world pauses during growth:

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    // During growth, both oldbuckets and buckets are live
    // Reads check both; writes always go to new buckets
    m := make(map[int]int)

    // Force multiple growths by adding many items
    var gcCount uint32
    before := gcCount

    for i := 0; i < 1_000_000; i++ {
        m[i] = i
        if i%100000 == 0 {
            runtime.GC()
            fmt.Printf("Progress: %d entries\n", i)
        }
    }
    _ = before
    fmt.Println("Final length:", len(m))
    // No stalls observed — incremental evacuation ensures smooth operation
}
```

---

## 4. Map Growth Algorithm

Growth happens when `count > loadFactor * 2^B` where loadFactor = 6.5:

```
Growth triggers:
1. Overload: count > 6.5 * 2^B  → double bucket count (B++)
2. Too many overflow buckets → same-size growth (reorganize)

Growth process:
1. Allocate new bucket array (2x size)
2. Set oldbuckets = buckets, buckets = new
3. Set flags to indicate growth
4. Each subsequent write evacuates 2 buckets from oldbuckets
```

```go
package main

import "fmt"

func demonstrateGrowth() {
    // Approximate bucket count at different sizes:
    // len=0: B=0, 1 bucket
    // len=7: B=1, 2 buckets (0 < 6.5*2=13, no growth yet)
    // len=13: B=1 → triggers growth to B=2, 4 buckets
    // len=26: B=2 → triggers growth to B=3, 8 buckets
    // Formula: growth when len > 6.5 * 2^B

    m := make(map[int]int)
    prev := 0
    for i := 0; i <= 100; i++ {
        m[i] = i
        if i != prev+1 {
            // In real code, you'd use runtime internals to detect growth
            _ = m
        }
        prev = i
    }
    fmt.Printf("Map with 100 entries, len=%d\n", len(m))
}

func main() {
    demonstrateGrowth()
}
```

---

## 5. Overflow Buckets

When a bucket fills up (8 items), Go allocates an overflow bucket:

```go
package main

import "fmt"

func main() {
    // Force hash collisions by using a small map type
    // In practice, a well-distributed hash rarely causes many overflows

    // The map grows when too many overflow buckets exist
    // even if count is low — this handles the pathological case
    // where many keys hash to the same bucket

    m := make(map[int]int, 1) // start small, force growth
    for i := 0; i < 100; i++ {
        m[i] = i
    }
    fmt.Println(len(m)) // 100
    // Overflow buckets are chained via the overflow pointer in bmap
}
```

---

## 6. Memory Layout: hmap and bmap

```
Mermaid diagram: hmap structure

graph TD
    A[map variable<br/>8 bytes pointer] --> B[hmap<br/>~64 bytes]
    B --> C[buckets<br/>pointer]
    B --> D[oldbuckets<br/>pointer, nil if not growing]
    B --> E[extra<br/>pointer]
    C --> F[bmap array<br/>2^B elements]
    F --> G[bmap 0<br/>tophash+keys+values+overflow]
    F --> H[bmap 1]
    F --> I[bmap N...]
    G --> J[overflow bmap<br/>chained if bucket full]
```

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    // Map variable is just a pointer
    var m1 map[string]int
    var m2 = make(map[string]int)

    fmt.Printf("nil map pointer: %v\n", m1 == nil)
    fmt.Printf("empty map pointer: %v\n", m2 == nil)

    // Size of the map variable (pointer-sized)
    fmt.Printf("sizeof map var: %d bytes\n", unsafe.Sizeof(m1)) // 8

    // The actual hmap is on the heap, we can't easily measure it
    // But we know hmap is approximately:
    // count(8) + flags(1) + B(1) + noverflow(2) + hash0(4) +
    // buckets(8) + oldbuckets(8) + nevacuate(8) + extra(8) = ~48 bytes
}
```

---

## 7. mapaccess1 and mapaccess2 Internals

```
mapaccess1 (v := m[k]) flow:
1. If m is nil or count==0: return zero value pointer
2. Check hashWriting flag: panic if concurrent write detected
3. Compute hash = hasher(key, seed)
4. bucket = hash & (2^B - 1)          // low bits → bucket index
5. If map is growing: maybe use oldbuckets
6. top = uint8(hash >> (64-8))         // top 8 bits
7. For each overflow chain:
   a. For each slot i in [0..7]:
      - If tophash[i] != top: skip
      - If key == bucket.key[i]: return &bucket.value[i]
   b. Follow overflow pointer
8. Return zero value pointer
```

```go
package main

import "fmt"

// Demonstrating what the runtime does conceptually
func simulatedLookup(m map[string]int, key string) (int, bool) {
    // The runtime does this in assembly + Go, we simulate in Go:

    // 1. Nil/empty check
    if m == nil {
        return 0, false
    }

    // 2. The actual lookup
    v, ok := m[key] // this IS the mapaccess2 call
    return v, ok
}

func main() {
    m := map[string]int{"hello": 42, "world": 99}

    v, ok := simulatedLookup(m, "hello")
    fmt.Println(v, ok) // 42 true

    v, ok = simulatedLookup(nil, "hello")
    fmt.Println(v, ok) // 0 false

    // Assembly generated for m[k]:
    // CALL runtime.mapaccess1_faststr(SB)  // for string keys
    // CALL runtime.mapaccess2_faststr(SB)  // for v, ok = m[k]
}
```

---

## 8. mapassign and mapdelete Internals

```
mapassign (m[k] = v) flow:
1. Nil check: panic if m is nil
2. Check hashWriting flag: panic if concurrent write
3. Set hashWriting flag (detects concurrent writes)
4. Compute hash
5. Find bucket (may trigger growth if needed)
6. Find empty slot in bucket chain
7. Write key and value to slot, update tophash
8. Increment count
9. Clear hashWriting flag

mapdelete (delete(m, k)) flow:
1. Nil/empty check: return immediately (no-op)
2. Set hashWriting flag
3. Compute hash, find bucket
4. Find matching slot
5. Clear slot: set tophash to emptyOne or emptyRest
6. Decrement count
7. Clear hashWriting flag
NOTE: Memory is NOT freed; bucket remains allocated
```

```go
package main

import "fmt"

func main() {
    m := make(map[string]int)

    // mapassign
    m["key1"] = 100
    m["key2"] = 200

    // mapdelete — note: the bucket slot is marked empty, not freed
    delete(m, "key1")
    fmt.Println(len(m)) // 1

    // The bucket still occupies memory
    // This is why maps don't shrink: delete just marks slots empty
    // To free memory: m = nil or m = make(map[string]int)

    m = nil // now the old hmap is GC eligible
    fmt.Println(m == nil) // true
}
```

---

## 9. Hash Seed and Security

Go uses a **random hash seed** per map, created at map initialization:

```go
// runtime/map.go
// hash0 is set from runtime.fastrand() during makemap
// This prevents hash-flooding attacks (DoS via crafted inputs)
```

```go
package main

import "fmt"

func main() {
    // Two maps with the same keys will have DIFFERENT internal bucket layouts
    // because they have different hash seeds (hash0)

    m1 := map[string]int{"a": 1, "b": 2, "c": 3}
    m2 := map[string]int{"a": 1, "b": 2, "c": 3}

    // Same content, same iteration is NOT guaranteed
    keys1 := make([]string, 0)
    for k := range m1 {
        keys1 = append(keys1, k)
    }
    keys2 := make([]string, 0)
    for k := range m2 {
        keys2 = append(keys2, k)
    }

    // These may differ because different seeds → different bucket layout
    fmt.Println("m1 iteration:", keys1)
    fmt.Println("m2 iteration:", keys2)

    // Hash flooding protection: an attacker cannot pre-compute key sequences
    // that all hash to the same bucket (because seed is unknown)
}
```

---

## 10. Concurrent Map Detection in Runtime

Go 1.6+ detects concurrent map writes at **runtime** using the `hashWriting` flag:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    // The runtime sets hashWriting flag during mapassign/mapdelete
    // If two goroutines both try to write simultaneously:
    // Second goroutine sees hashWriting=true → throws fatal error

    // "concurrent map writes" is NOT a panic you can recover from
    // It calls runtime.throw() which is fatal (not recover()-able)

    // Safe concurrent access example:
    var mu sync.RWMutex
    m := make(map[string]int)

    var wg sync.WaitGroup

    // Writers
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            for j := 0; j < 100; j++ {
                mu.Lock()
                m[fmt.Sprintf("w%d-%d", n, j)] = n*100 + j
                mu.Unlock()
                time.Sleep(time.Microsecond)
            }
        }(i)
    }

    // Readers
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 100; j++ {
                mu.RLock()
                _ = len(m)
                mu.RUnlock()
                time.Sleep(time.Microsecond)
            }
        }()
    }

    wg.Wait()
    fmt.Println("Concurrent ops completed safely, len:", len(m))
}
```

---

## 11. Map in the GC — Pointer Scanning

The garbage collector needs to scan maps for pointers:

```go
package main

import "fmt"

func main() {
    // Map[string]int: both K and V have no GC pointers
    // GC doesn't need to scan individual slots — just the bucket array
    m1 := map[string]int{}
    _ = m1

    // Map[string]*SomeStruct: values are pointers
    // GC must scan every live value slot — more GC pressure
    type T struct{ Data []byte }
    m2 := map[string]*T{}
    m2["key"] = &T{Data: make([]byte, 1024)}
    _ = m2

    // Map[int]int: no pointers anywhere
    // Most GC-friendly: buckets are not pointer-containing
    m3 := map[int]int{}
    for i := 0; i < 10000; i++ {
        m3[i] = i
    }
    fmt.Println(len(m3))

    // Recommendation for hot paths: prefer scalar keys and values
    // to reduce GC scan time
}
```

---

## 12. Performance Characteristics Under Load

```go
package main

import (
    "fmt"
    "time"
)

func benchmarkMap(n int) time.Duration {
    m := make(map[int]int, n)
    for i := 0; i < n; i++ {
        m[i] = i
    }

    start := time.Now()
    for i := 0; i < n; i++ {
        _ = m[i]
    }
    return time.Since(start)
}

func main() {
    sizes := []int{100, 10_000, 1_000_000}
    for _, n := range sizes {
        d := benchmarkMap(n)
        fmt.Printf("n=%7d: %v total, %v/op\n", n, d, d/time.Duration(n))
    }

    // Expected: O(1) per operation, roughly constant per-op time
    // In practice, larger maps have worse cache behavior
    // L1 cache miss latency: ~4ns; L3: ~40ns; RAM: ~100ns
    // map lookups on large maps are RAM-bound, not compute-bound
}
```

---

## 13. Production Monitoring Patterns

```go
package main

import (
    "expvar"
    "fmt"
    "sync"
    "sync/atomic"
)

// Instrumented map for production
type MonitoredMap struct {
    mu      sync.RWMutex
    data    map[string]interface{}
    hits    atomic.Int64
    misses  atomic.Int64
    writes  atomic.Int64
    deletes atomic.Int64
}

func NewMonitoredMap() *MonitoredMap {
    mm := &MonitoredMap{data: make(map[string]interface{})}
    // Export metrics to /debug/vars
    expvar.Publish("map_hits", expvar.Func(func() interface{} { return mm.hits.Load() }))
    expvar.Publish("map_misses", expvar.Func(func() interface{} { return mm.misses.Load() }))
    return mm
}

func (mm *MonitoredMap) Get(key string) (interface{}, bool) {
    mm.mu.RLock()
    v, ok := mm.data[key]
    mm.mu.RUnlock()
    if ok {
        mm.hits.Add(1)
    } else {
        mm.misses.Add(1)
    }
    return v, ok
}

func (mm *MonitoredMap) Set(key string, val interface{}) {
    mm.mu.Lock()
    mm.data[key] = val
    mm.mu.Unlock()
    mm.writes.Add(1)
}

func (mm *MonitoredMap) Stats() string {
    return fmt.Sprintf("hits=%d misses=%d writes=%d deletes=%d",
        mm.hits.Load(), mm.misses.Load(),
        mm.writes.Load(), mm.deletes.Load())
}

func main() {
    mm := NewMonitoredMap()
    mm.Set("user:1", "Alice")
    mm.Set("user:2", "Bob")

    mm.Get("user:1")
    mm.Get("user:3") // miss

    fmt.Println(mm.Stats()) // hits=1 misses=1 writes=2 deletes=0
}
```

---

## 14. Cache-Effective Map Designs

```go
package main

import "fmt"

// For sequential integer keys, a slice beats a map in cache performance
// But for string/arbitrary keys, maps are the right tool

// Interning: reuse equal strings to reduce GC pressure
type StringInterner struct {
    pool map[string]string
}

func NewStringInterner() *StringInterner {
    return &StringInterner{pool: make(map[string]string)}
}

func (si *StringInterner) Intern(s string) string {
    if interned, ok := si.pool[s]; ok {
        return interned // return the shared copy
    }
    si.pool[s] = s
    return s
}

// Flat key strategy: avoid allocations in hot paths
func flatKey(userID int, resource string) string {
    // Precomputed constant keys avoid allocation
    // In hot paths, consider a fixed-size array key instead
    return fmt.Sprintf("%d:%s", userID, resource)
}

func main() {
    interner := NewStringInterner()

    // Both return same string pointer
    s1 := interner.Intern("repeated-string")
    s2 := interner.Intern("repeated-string")
    fmt.Println(s1 == s2) // true (and same underlying memory)

    key := flatKey(42, "read")
    cache := map[string]bool{}
    cache[key] = true
    fmt.Println(cache[flatKey(42, "read")]) // true
}
```

---

## 15. Lock-Free Map Alternatives

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "unsafe"
)

// Copy-on-write map — optimized for read-heavy, rare-write workloads
type COWMap struct {
    ptr atomic.Pointer[map[string]int]
    mu  sync.Mutex // only for writers
}

func NewCOWMap() *COWMap {
    m := &COWMap{}
    empty := map[string]int{}
    m.ptr.Store(&empty)
    return m
}

func (c *COWMap) Get(key string) (int, bool) {
    // Completely lock-free read
    m := *c.ptr.Load()
    v, ok := m[key]
    return v, ok
}

func (c *COWMap) Set(key string, val int) {
    c.mu.Lock()
    defer c.mu.Unlock()

    // Copy current map
    old := *c.ptr.Load()
    newMap := make(map[string]int, len(old)+1)
    for k, v := range old {
        newMap[k] = v
    }
    newMap[key] = val

    // Atomically swap pointer
    c.ptr.Store(&newMap)
}

func main() {
    _ = unsafe.Sizeof(0) // suppress import
    cm := NewCOWMap()

    var wg sync.WaitGroup
    // Many concurrent readers
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 100; j++ {
                cm.Get("key")
            }
        }()
    }

    // Occasional writer
    cm.Set("key", 42)
    wg.Wait()

    v, ok := cm.Get("key")
    fmt.Println(v, ok) // 42 true
}
```

---

## 16. Postmortem: Data Race on Global Map

**Incident:** Service crashes with "concurrent map read and map write" during high load.

```go
package main

import (
    "fmt"
    "net/http"
    "sync"
)

// BAD: Global mutable map without protection
var sessionCache = map[string]string{} // DATA RACE!

func badHandler(w http.ResponseWriter, r *http.Request) {
    token := r.URL.Query().Get("token")
    sessionCache[token] = "user" // concurrent write from multiple goroutines
    fmt.Fprintln(w, sessionCache[token])
}

// FIXED: Protected with RWMutex
var (
    sessionMu    sync.RWMutex
    sessionStore = map[string]string{}
)

func goodHandler(w http.ResponseWriter, r *http.Request) {
    token := r.URL.Query().Get("token")

    sessionMu.Lock()
    sessionStore[token] = "user"
    sessionMu.Unlock()

    sessionMu.RLock()
    user := sessionStore[token]
    sessionMu.RUnlock()

    fmt.Fprintln(w, user)
}

func main() {
    // Postmortem lessons:
    // 1. Never use global maps without synchronization
    // 2. Use -race flag in CI to catch data races before production
    // 3. Prefer passing maps via context or typed stores
    // 4. Consider sync.Map for read-heavy session caches
    fmt.Println("Postmortem: global map race — fixed with RWMutex")
}
```

---

## 17. Postmortem: Memory Leak via Map Growth

**Incident:** Service memory grows steadily over days, OOM eventually.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

// BAD: unbounded cache map that never shrinks
type BadCache struct {
    mu   sync.RWMutex
    data map[string][]byte
}

func (c *BadCache) Set(key string, val []byte) {
    c.mu.Lock()
    c.data[key] = val // never evicted!
    c.mu.Unlock()
}

// FIXED: LRU cache with bounded size
type LRUCache struct {
    mu       sync.Mutex
    data     map[string][]byte
    order    []string
    maxItems int
}

func NewLRUCache(max int) *LRUCache {
    return &LRUCache{
        data:     make(map[string][]byte, max),
        order:    make([]string, 0, max),
        maxItems: max,
    }
}

func (c *LRUCache) Set(key string, val []byte) {
    c.mu.Lock()
    defer c.mu.Unlock()

    if len(c.data) >= c.maxItems {
        // Evict oldest
        oldest := c.order[0]
        c.order = c.order[1:]
        delete(c.data, oldest)
    }
    c.data[key] = val
    c.order = append(c.order, key)
}

func main() {
    cache := NewLRUCache(3)
    cache.Set("a", []byte("1"))
    cache.Set("b", []byte("2"))
    cache.Set("c", []byte("3"))
    cache.Set("d", []byte("4")) // evicts "a"

    fmt.Println(len(cache.data)) // 3 (bounded)

    _ = time.Second // using import
    // Lesson: always bound cache size; monitor map length in production
}
```

---

## 18. Postmortem: NaN Key Bug in Production

**Incident:** Metrics map accumulates zombie entries that are never readable.

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    // Production scenario: metric values come from user input
    // One user sends a NaN temperature reading

    // BAD: using float64 keys
    readings := map[float64]string{}

    temperatures := []float64{
        98.6, 101.2, math.NaN(), 99.1, math.NaN(),
    }

    for i, t := range temperatures {
        readings[t] = fmt.Sprintf("reading_%d", i)
    }

    fmt.Printf("Expected: %d entries\n", len(temperatures))
    fmt.Printf("Actual: %d entries\n", len(readings))
    // Actual: 4 (two NaN entries, neither retrievable)

    // Can never read NaN entries back
    v, ok := readings[math.NaN()]
    fmt.Println("NaN lookup:", v, ok) // "" false

    // FIX: use string keys, reject NaN at input validation
    sanitizedReadings := map[string]string{}
    for i, t := range temperatures {
        if math.IsNaN(t) {
            fmt.Printf("Rejected NaN at index %d\n", i)
            continue
        }
        sanitizedReadings[fmt.Sprintf("%.2f", t)] = fmt.Sprintf("reading_%d", i)
    }
    fmt.Println("Sanitized entries:", len(sanitizedReadings)) // 3
}
```

---

## 19. System Failure: Concurrent Map Write Panic

**Incident:** Kubernetes controller crashes fatally (not recoverable) during high traffic.

```go
package main

import (
    "fmt"
    "sync"
)

// The fatal error: "concurrent map writes" is not recoverable
// It calls runtime.throw(), which is different from panic()
// defer + recover() CANNOT catch it

func demonstrateFatalNature() {
    // DO NOT RUN: this will kill the process
    // var m = map[int]int{}
    // go func() { for { m[1] = 1 } }()
    // go func() { for { m[2] = 2 } }()

    // CORRECT FIX for a controller cache:
    type Cache struct {
        sync.RWMutex
        data map[string]interface{}
    }

    c := &Cache{data: make(map[string]interface{})}

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            c.Lock()
            c.data[fmt.Sprintf("resource/%d", n)] = n
            c.Unlock()
        }(i)
    }
    wg.Wait()

    c.RLock()
    fmt.Println("Cache entries:", len(c.data)) // 100
    c.RUnlock()
}

func main() {
    demonstrateFatalNature()
    // Lessons:
    // 1. Run all tests with -race flag
    // 2. Embed sync.RWMutex in cache structs
    // 3. Fatal errors cannot be recovered — prevention is essential
    // 4. Use go vet and staticcheck in CI
}
```

---

## 20. Advanced Pattern: Expiring Cache

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type entry struct {
    value   interface{}
    expires time.Time
}

type ExpiringCache struct {
    mu   sync.RWMutex
    data map[string]entry
}

func NewExpiringCache() *ExpiringCache {
    c := &ExpiringCache{data: make(map[string]entry)}
    go c.janitor()
    return c
}

func (c *ExpiringCache) Set(key string, val interface{}, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: val, expires: time.Now().Add(ttl)}
    c.mu.Unlock()
}

func (c *ExpiringCache) Get(key string) (interface{}, bool) {
    c.mu.RLock()
    e, ok := c.data[key]
    c.mu.RUnlock()
    if !ok || time.Now().After(e.expires) {
        return nil, false
    }
    return e.value, true
}

func (c *ExpiringCache) janitor() {
    ticker := time.NewTicker(time.Minute)
    defer ticker.Stop()
    for range ticker.C {
        c.mu.Lock()
        now := time.Now()
        for k, e := range c.data {
            if now.After(e.expires) {
                delete(c.data, k)
            }
        }
        c.mu.Unlock()
    }
}

func main() {
    cache := NewExpiringCache()
    cache.Set("session:abc", "user123", 100*time.Millisecond)

    v, ok := cache.Get("session:abc")
    fmt.Println(v, ok) // user123 true

    time.Sleep(200 * time.Millisecond)
    v, ok = cache.Get("session:abc")
    fmt.Println(v, ok) // <nil> false (expired)
}
```

---

## 21. Advanced Pattern: Bidirectional Map

```go
package main

import (
    "errors"
    "fmt"
)

type BiMap[K, V comparable] struct {
    forward map[K]V
    reverse map[V]K
}

func NewBiMap[K, V comparable]() *BiMap[K, V] {
    return &BiMap[K, V]{
        forward: make(map[K]V),
        reverse: make(map[V]K),
    }
}

func (b *BiMap[K, V]) Put(k K, v V) error {
    if _, exists := b.forward[k]; exists {
        return errors.New("key already exists")
    }
    if _, exists := b.reverse[v]; exists {
        return errors.New("value already exists")
    }
    b.forward[k] = v
    b.reverse[v] = k
    return nil
}

func (b *BiMap[K, V]) GetByKey(k K) (V, bool) {
    v, ok := b.forward[k]
    return v, ok
}

func (b *BiMap[K, V]) GetByValue(v V) (K, bool) {
    k, ok := b.reverse[v]
    return k, ok
}

func (b *BiMap[K, V]) Delete(k K) {
    if v, ok := b.forward[k]; ok {
        delete(b.reverse, v)
        delete(b.forward, k)
    }
}

func main() {
    bm := NewBiMap[string, int]()
    bm.Put("one", 1)
    bm.Put("two", 2)
    bm.Put("three", 3)

    v, _ := bm.GetByKey("two")
    fmt.Println(v) // 2

    k, _ := bm.GetByValue(3)
    fmt.Println(k) // three

    err := bm.Put("one", 99) // duplicate key
    fmt.Println(err) // key already exists
}
```

---

## 22. Advanced Pattern: Typed Registry

```go
package main

import (
    "errors"
    "fmt"
    "reflect"
)

// Type-safe registry using generics
type Registry[T any] struct {
    entries  map[string]T
    onCreate func(T)
}

func NewRegistry[T any]() *Registry[T] {
    return &Registry[T]{entries: make(map[string]T)}
}

func (r *Registry[T]) OnCreate(fn func(T)) {
    r.onCreate = fn
}

func (r *Registry[T]) Register(name string, item T) error {
    if _, exists := r.entries[name]; exists {
        return fmt.Errorf("already registered: %s", name)
    }
    r.entries[name] = item
    if r.onCreate != nil {
        r.onCreate(item)
    }
    return nil
}

func (r *Registry[T]) Get(name string) (T, error) {
    item, ok := r.entries[name]
    if !ok {
        var zero T
        return zero, fmt.Errorf("not found: %s", name)
    }
    return item, nil
}

func (r *Registry[T]) List() []string {
    names := make([]string, 0, len(r.entries))
    for name := range r.entries {
        names = append(names, name)
    }
    return names
}

type Handler func(string) string

func main() {
    reg := NewRegistry[Handler]()
    reg.OnCreate(func(h Handler) {
        fmt.Printf("Registered handler of type %v\n", reflect.TypeOf(h))
    })

    reg.Register("echo", func(s string) string { return s })
    reg.Register("reverse", func(s string) string {
        runes := []rune(s)
        for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
            runes[i], runes[j] = runes[j], runes[i]
        }
        return string(runes)
    })

    h, _ := reg.Get("reverse")
    fmt.Println(h("hello")) // olleh

    _, err := reg.Get("missing")
    fmt.Println(errors.Is(err, err)) // true (it's the error itself)
    fmt.Println(err)
}
```

---

## 23. Profiling Map Performance

```go
package main

import (
    "fmt"
    "os"
    "runtime/pprof"
    "time"
)

func heavyMapWork(n int) map[string]int {
    m := make(map[string]int, n)
    for i := 0; i < n; i++ {
        key := fmt.Sprintf("key_%d", i)
        m[key] = i
    }
    return m
}

func main() {
    // CPU profile
    f, _ := os.Create("cpu.prof")
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()

    start := time.Now()
    m := heavyMapWork(1_000_000)
    fmt.Printf("Build time: %v, len=%d\n", time.Since(start), len(m))

    // Look up all keys
    start = time.Now()
    total := 0
    for i := 0; i < 1_000_000; i++ {
        key := fmt.Sprintf("key_%d", i)
        total += m[key]
    }
    fmt.Printf("Lookup time: %v, total=%d\n", time.Since(start), total)

    // Analysis commands:
    // go tool pprof cpu.prof
    // (pprof) top10
    // (pprof) web
    // Key bottleneck: fmt.Sprintf allocation in hot path
    // Fix: use integer keys or pre-computed string keys
}
```

---

## 24. Assembly-Level Map Inspection

```go
package main

// To see the assembly Go generates for map operations:
// go build -gcflags="-S" main.go 2>&1 | grep -A5 "mapaccess"
//
// For map[string]int, Go calls:
//   runtime.mapaccess1_faststr  (for v := m[k])
//   runtime.mapaccess2_faststr  (for v, ok := m[k])
//   runtime.mapassign_faststr   (for m[k] = v)
//   runtime.mapdelete_faststr   (for delete(m, k))
//
// For map[int]int, Go calls:
//   runtime.mapaccess1_fast64
//   runtime.mapassign_fast64
//
// For other types:
//   runtime.mapaccess1 (generic, slower)
//   runtime.mapassign  (generic)
//
// The fast* variants avoid reflection overhead for common key types

import "fmt"

func mapOps() {
    m := map[string]int{"key": 42}
    // CALL runtime.mapaccess2_faststr
    v, ok := m["key"]
    // CALL runtime.mapassign_faststr
    m["key2"] = 99
    // CALL runtime.mapdelete_faststr
    delete(m, "key2")
    fmt.Println(v, ok)
}

func main() {
    mapOps()
}
```

---

## 25. Maps in microservice Caching Layer

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

// Tiered cache: L1 (local map) + L2 (simulated remote)
type TieredCache struct {
    l1     map[string]cacheItem
    l1Mu   sync.RWMutex
    l1TTL  time.Duration
    l2Get  func(key string) (string, bool) // remote cache (Redis etc.)
    l2Set  func(key, val string, ttl time.Duration)
}

type cacheItem struct {
    val     string
    expires time.Time
}

func (tc *TieredCache) Get(key string) (string, bool) {
    // L1 check
    tc.l1Mu.RLock()
    item, ok := tc.l1[key]
    tc.l1Mu.RUnlock()
    if ok && time.Now().Before(item.expires) {
        return item.val, true
    }

    // L2 check
    if tc.l2Get != nil {
        if val, ok := tc.l2Get(key); ok {
            tc.setL1(key, val)
            return val, true
        }
    }
    return "", false
}

func (tc *TieredCache) setL1(key, val string) {
    tc.l1Mu.Lock()
    tc.l1[key] = cacheItem{val: val, expires: time.Now().Add(tc.l1TTL)}
    tc.l1Mu.Unlock()
}

func main() {
    l2Store := map[string]string{"user:1": "Alice"}

    cache := &TieredCache{
        l1:    make(map[string]cacheItem),
        l1TTL: 30 * time.Second,
        l2Get: func(key string) (string, bool) {
            v, ok := l2Store[key]
            return v, ok
        },
    }

    v, ok := cache.Get("user:1")
    fmt.Println(v, ok) // Alice true (from L2, promoted to L1)

    v, ok = cache.Get("user:1")
    fmt.Println(v, ok) // Alice true (from L1 now)
}
```

---

## 26. Tuning map for Throughput

```go
package main

import (
    "fmt"
    "sync"
)

// Sharded map for maximum write throughput
const numShards = 256

type HighThroughputMap struct {
    shards [numShards]mapShard
}

type mapShard struct {
    sync.RWMutex
    data map[uint64]int64
}

func NewHighThroughputMap() *HighThroughputMap {
    m := &HighThroughputMap{}
    for i := range m.shards {
        m.shards[i].data = make(map[uint64]int64)
    }
    return m
}

func (m *HighThroughputMap) shardIndex(key uint64) int {
    // FNV-like mixing for distribution
    key ^= key >> 33
    key *= 0xff51afd7ed558ccd
    key ^= key >> 33
    return int(key & (numShards - 1))
}

func (m *HighThroughputMap) Inc(key uint64, delta int64) {
    idx := m.shardIndex(key)
    s := &m.shards[idx]
    s.Lock()
    s.data[key] += delta
    s.Unlock()
}

func (m *HighThroughputMap) Get(key uint64) int64 {
    idx := m.shardIndex(key)
    s := &m.shards[idx]
    s.RLock()
    v := s.data[key]
    s.RUnlock()
    return v
}

func (m *HighThroughputMap) TotalLen() int {
    total := 0
    for i := range m.shards {
        m.shards[i].RLock()
        total += len(m.shards[i].data)
        m.shards[i].RUnlock()
    }
    return total
}

func main() {
    m := NewHighThroughputMap()
    var wg sync.WaitGroup

    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            for j := 0; j < 1000; j++ {
                m.Inc(uint64(n*1000+j), 1)
            }
        }(i)
    }
    wg.Wait()
    fmt.Println("Total keys:", m.TotalLen()) // 100000
}
```

---

## 27. Summary: Senior Decision Framework

```
Senior Map Decision Framework:
================================

CONCURRENCY
  Single-goroutine only?     → plain map[K]V
  Read-heavy, stable keys?   → sync.Map
  Write-heavy, concurrent?   → RWMutex + map[K]V
  Extreme throughput?        → Sharded map (256 shards)
  Read-only after init?      → plain map (safe, no lock needed)

MEMORY
  Known size upfront?        → make(map[K]V, n)
  Must shrink after delete?  → m = make(map[K]V) (rebuild)
  GC pressure concern?       → prefer scalar keys/values
  Bounded size required?     → LRU or bounded cache wrapper

PERFORMANCE
  < 10 fixed string lookups?  → switch statement
  Large fixed set?            → map
  Integer keys, dense?        → slice (better cache)
  Frequent string key concat? → pre-compute keys, avoid fmt.Sprintf

CORRECTNESS
  Float keys?                → Never (NaN issue)
  Zero is a valid value?     → Always use comma-ok
  Concurrent?                → Always use mutex or sync.Map
  Production cache?          → Add size limit + TTL + monitoring

KEY SELECTION
  Multiple fields compose key? → struct key if all comparable
  String concat key?           → fmt.Sprintf or string builder
  Integer id + enum?           → int key with bit-packing
```

---

*Senior level complete. Covers runtime internals, postmortems, and production patterns.*
