# Iterating Maps — Optimization Exercises

---

## Exercise 1 🟢 — Repeated Full-Map Scan for Single Key

```go
package main

import "fmt"

func findByValue(m map[string]int, target int) string {
    for k, v := range m { // O(n) scan
        if v == target {
            return k
        }
    }
    return ""
}

// Called many times with the same m but different targets
func main() {
    m := map[string]int{"alice": 95, "bob": 87, "carol": 95, "dave": 72}
    for i := 0; i < 10000; i++ {
        _ = findByValue(m, 95)
    }
    fmt.Println("done")
}
```

**Problem:** O(n) scan repeated 10K times.

<details>
<summary>Optimized Solution</summary>

Build an inverted index (value → []key) once:
```go
// Build once
type BiMap struct {
    forward  map[string]int    // key -> value
    inverted map[int][]string  // value -> []key
}

func NewBiMap(m map[string]int) *BiMap {
    inv := make(map[int][]string, len(m))
    for k, v := range m {
        inv[v] = append(inv[v], k)
    }
    return &BiMap{forward: m, inverted: inv}
}

func (b *BiMap) FindByValue(target int) []string {
    return b.inverted[target] // O(1)
}

// Now: 10000 lookups = 10000 O(1) operations instead of O(n) each
```
</details>

---

## Exercise 2 🟢 — Repeated Map Building

```go
package main

import (
    "fmt"
    "strings"
)

func normalize(input string) map[string]int {
    m := map[string]int{} // allocates every call
    for _, word := range strings.Fields(input) {
        m[strings.ToLower(word)]++
    }
    return m
}

func compare(a, b string) bool {
    ma := normalize(a) // two map allocations per call
    mb := normalize(b)
    if len(ma) != len(mb) { return false }
    for k, v := range ma {
        if mb[k] != v { return false }
    }
    return true
}

func main() {
    for i := 0; i < 1000; i++ {
        _ = compare("Hello World", "world hello")
    }
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Reuse a pre-allocated map (clear between uses)
func normalizeInto(input string, m map[string]int) {
    for k := range m { delete(m, k) } // clear
    for _, word := range strings.Fields(input) {
        m[strings.ToLower(word)]++
    }
}

// Option 2: For comparison, avoid building second map
// Count words in first, then subtract for second:
func compare(a, b string) bool {
    ma := map[string]int{}
    for _, w := range strings.Fields(strings.ToLower(a)) { ma[w]++ }
    for _, w := range strings.Fields(strings.ToLower(b)) { ma[w]-- }
    for _, v := range ma {
        if v != 0 { return false }
    }
    return true
    // One map, not two — 50% fewer allocations
}
```
</details>

---

## Exercise 3 🟢 — Converting Map to Sorted Slice Repeatedly

```go
package main

import (
    "fmt"
    "sort"
)

func topScorers(scores map[string]int, n int) []string {
    type kv struct{ k string; v int }
    pairs := make([]kv, 0, len(scores))
    for k, v := range scores {
        pairs = append(pairs, kv{k, v})
    }
    sort.Slice(pairs, func(i, j int) bool {
        return pairs[i].v > pairs[j].v
    })
    result := make([]string, min(n, len(pairs)))
    for i := range result {
        result[i] = pairs[i].k
    }
    return result
}

// Called every second with essentially the same data
func main() {
    scores := map[string]int{"Alice": 95, "Bob": 82, "Carol": 91}
    for i := 0; i < 1000; i++ {
        _ = topScorers(scores, 3)
    }
    fmt.Println("done")
}

func min(a, b int) int { if a < b { return a }; return b }
```

<details>
<summary>Optimized Solution</summary>

```go
// Cache the sorted result; only re-sort when map changes
type RankedScores struct {
    scores  map[string]int
    sorted  []string // cached sorted keys
    version int
}

func (rs *RankedScores) UpdateScore(name string, score int) {
    rs.scores[name] = score
    rs.version++ // invalidate cache
    rs.sorted = nil
}

func (rs *RankedScores) TopN(n int) []string {
    if rs.sorted == nil { // rebuild only when needed
        type kv struct{ k string; v int }
        pairs := make([]kv, 0, len(rs.scores))
        for k, v := range rs.scores { pairs = append(pairs, kv{k, v}) }
        sort.Slice(pairs, func(i, j int) bool { return pairs[i].v > pairs[j].v })
        rs.sorted = make([]string, len(pairs))
        for i, p := range pairs { rs.sorted[i] = p.k }
    }
    if n > len(rs.sorted) { n = len(rs.sorted) }
    return rs.sorted[:n]
}
```
</details>

---

## Exercise 4 🟡 — Map Scan Instead of Direct Lookup

```go
package main

import "fmt"

type Config struct {
    settings map[string]string
}

func (c *Config) IsProduction() bool {
    for k, v := range c.settings {
        if k == "env" && v == "production" {
            return true
        }
    }
    return false
}

func main() {
    cfg := &Config{settings: map[string]string{
        "env":     "production",
        "version": "1.0",
        "region":  "us-east",
    }}
    for i := 0; i < 1_000_000; i++ {
        _ = cfg.IsProduction()
    }
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
// Direct lookup is O(1) — no need to range
func (c *Config) IsProduction() bool {
    return c.settings["env"] == "production"
}
// If key might not exist:
func (c *Config) IsProduction() bool {
    v, ok := c.settings["env"]
    return ok && v == "production"
}
// Speedup: O(n) → O(1). For n=1M calls with map size 3: 3M→1M operations
```
</details>

---

## Exercise 5 🟡 — Inefficient Map Union

```go
package main

import "fmt"

func union(maps ...map[string]int) map[string]int {
    result := map[string]int{}
    for _, m := range maps {
        for k, v := range m {
            result[k] += v
        }
    }
    return result
}

// Called with many small maps
func main() {
    // 1000 maps, each with 100 entries
    mapsSlice := make([]map[string]int, 1000)
    for i := range mapsSlice {
        mapsSlice[i] = map[string]int{}
        for j := 0; j < 100; j++ {
            mapsSlice[i][fmt.Sprintf("key%d", j)] = j + i
        }
    }
    _ = union(mapsSlice...)
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
func union(maps ...map[string]int) map[string]int {
    // Calculate total unique keys estimate for pre-allocation
    totalSize := 0
    for _, m := range maps { totalSize += len(m) }
    // Pre-allocate with estimated capacity
    result := make(map[string]int, totalSize) // overestimates but prevents rehashing
    for _, m := range maps {
        for k, v := range m {
            result[k] += v
        }
    }
    return result
}
// Without pre-allocation: map rehashes ~log2(100) = 7 times for 100 entries
// With pre-allocation: 0 rehashes — significant for large inputs
```
</details>

---

## Exercise 6 🟡 — Iterating Map of Channels Serially

```go
package main

import (
    "fmt"
    "time"
)

func drainAll(channels map[string]chan int) map[string][]int {
    results := map[string][]int{}
    for name, ch := range channels {
        close(ch) // signal done
        for v := range ch { // serial drain — one at a time
            results[name] = append(results[name], v)
        }
    }
    return results
}

func main() {
    channels := map[string]chan int{}
    for _, name := range []string{"a", "b", "c", "d"} {
        ch := make(chan int, 100)
        for i := 0; i < 100; i++ { ch <- i }
        channels[name] = ch
    }
    start := time.Now()
    _ = drainAll(channels)
    fmt.Println(time.Since(start))
}
```

<details>
<summary>Optimized Solution</summary>

```go
import "sync"

func drainAll(channels map[string]chan int) map[string][]int {
    var mu sync.Mutex
    results := map[string][]int{}
    var wg sync.WaitGroup

    for name, ch := range channels {
        name, ch := name, ch
        wg.Add(1)
        go func() {
            defer wg.Done()
            close(ch)
            local := []int{}
            for v := range ch { local = append(local, v) }
            mu.Lock()
            results[name] = local
            mu.Unlock()
        }()
    }
    wg.Wait()
    return results
}
// Parallel drain: 4 channels simultaneously instead of sequentially
```
</details>

---

## Exercise 7 🟡 — String Key with Repeated Allocation

```go
package main

import "fmt"

func hotFunction(userID int, action string) {
    key := fmt.Sprintf("user:%d:action:%s", userID, action)
    // use key to access map
    _ = key
}

func main() {
    for i := 0; i < 1_000_000; i++ {
        hotFunction(i%100, "click")
    }
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Use struct as map key (no allocation)
type UserAction struct {
    UserID int
    Action string
}
var cache = map[UserAction]struct{}{}
func hotFunction(userID int, action string) {
    key := UserAction{userID, action} // stack-allocated struct, no alloc
    _ = cache[key]
}

// Option 2: Pre-compute/intern strings if userID and action sets are small
var actionCache = map[string]struct{}{"click": {}, "view": {}, "buy": {}}
// Use canonical string references

// Option 3: Integer encoding for small bounded sets
// encode userID*1000 + actionIndex as a single int key
var actionIdx = map[string]int{"click": 0, "view": 1, "buy": 2}
var cache2 = map[int]struct{}{}
func hotFunction2(userID int, action string) {
    key := userID*1000 + actionIdx[action]
    _ = cache2[key]
}
```
</details>

---

## Exercise 8 🔴 — Full Map Scan for Existence Check

```go
package main

import "fmt"

var blacklist = []string{"spam@evil.com", "bad@actor.net", "fraud@scam.org"}
// ... potentially thousands of entries

func isBlacklisted(email string) bool {
    for _, b := range blacklist { // O(n) scan!
        if b == email {
            return true
        }
    }
    return false
}

func main() {
    emails := []string{"user@good.com", "spam@evil.com", "another@good.com"}
    for _, email := range emails {
        if isBlacklisted(email) {
            fmt.Println("BLOCKED:", email)
        }
    }
}
```

<details>
<summary>Optimized Solution</summary>

```go
// Build a set (map) for O(1) lookup
var blacklistSet map[string]struct{}

func init() {
    blacklist := []string{"spam@evil.com", "bad@actor.net", "fraud@scam.org"}
    blacklistSet = make(map[string]struct{}, len(blacklist))
    for _, email := range blacklist {
        blacklistSet[email] = struct{}{}
    }
}

func isBlacklisted(email string) bool {
    _, ok := blacklistSet[email] // O(1)
    return ok
}
// Speedup: O(n) → O(1) per check
// For 1000-entry blacklist checking 1M emails: 1B ops → 1M ops (1000x)
```
</details>

---

## Exercise 9 🔴 — Unnecessary Map for Counting When Slice Suffices

```go
package main

import "fmt"

func countGrades(grades []int) map[int]int {
    freq := map[int]int{}
    for _, g := range grades {
        freq[g]++ // grades are 0-100
    }
    return freq
}

func printDistribution(grades []int) {
    freq := countGrades(grades)
    for score := 0; score <= 100; score++ {
        if freq[score] > 0 {
            fmt.Printf("%d: %d\n", score, freq[score])
        }
    }
}
```

<details>
<summary>Optimized Solution</summary>

```go
// Grades are bounded integers 0-100: use array (slice) instead of map
func countGrades(grades []int) [101]int {
    var freq [101]int
    for _, g := range grades {
        if g >= 0 && g <= 100 {
            freq[g]++
        }
    }
    return freq
}

func printDistribution(grades []int) {
    freq := countGrades(grades)
    for score, count := range freq { // array range: cache-friendly!
        if count > 0 {
            fmt.Printf("%d: %d\n", score, count)
        }
    }
}
// Benefits:
// - [101]int on stack: 0 heap allocations
// - Array access: O(1) with perfect cache behavior
// - Iteration: cache-friendly sequential access
// - 100x more memory-efficient than map for dense integer ranges
```
</details>

---

## Exercise 10 🔴 — Deep Copy in Hot Loop

```go
package main

import "fmt"

func processBatch(templates map[string]map[string]int, multiplier int) []map[string]int {
    results := make([]map[string]int, 0, len(templates))
    for _, tmpl := range templates {
        copy := map[string]int{} // allocation per template!
        for k, v := range tmpl {
            copy[k] = v * multiplier // copy + transform
        }
        results = append(results, copy)
    }
    return results
}

func main() {
    templates := map[string]map[string]int{
        "t1": {"x": 1, "y": 2},
        "t2": {"x": 3, "y": 4},
    }
    for i := 0; i < 10000; i++ {
        _ = processBatch(templates, i)
    }
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Pre-allocate with capacity hint per template
func processBatch(templates map[string]map[string]int, multiplier int) []map[string]int {
    results := make([]map[string]int, 0, len(templates))
    for _, tmpl := range templates {
        result := make(map[string]int, len(tmpl)) // pre-sized — no rehash
        for k, v := range tmpl {
            result[k] = v * multiplier
        }
        results = append(results, result)
    }
    return results
}

// Option 2: If multiplier 1 (pure copy): use maps.Clone (optimized)
import "maps"
func cloneBatch(templates map[string]map[string]int) []map[string]int {
    results := make([]map[string]int, 0, len(templates))
    for _, tmpl := range templates {
        results = append(results, maps.Clone(tmpl))
    }
    return results
}

// Option 3: Structural sharing — return views with lazy multiplier
type MultipliedMap struct {
    base       map[string]int
    multiplier int
}
func (m *MultipliedMap) Get(k string) int { return m.base[k] * m.multiplier }
// Zero copy! Multiplier applied on read only
```
</details>

---

## Exercise 11 🔴 — Unbounded Cache Growth

```go
package main

import (
    "fmt"
    "sync"
)

var (
    mu    sync.RWMutex
    cache = map[string][]byte{}
)

func getOrCompute(key string, compute func() []byte) []byte {
    mu.RLock()
    if v, ok := cache[key]; ok {
        mu.RUnlock()
        return v
    }
    mu.RUnlock()

    v := compute()
    mu.Lock()
    cache[key] = v // grows without bound!
    mu.Unlock()
    return v
}

func main() {
    for i := 0; i < 1_000_000; i++ {
        key := fmt.Sprintf("key-%d", i)
        _ = getOrCompute(key, func() []byte { return make([]byte, 1024) })
    }
    // cache now holds 1GB of data!
    fmt.Println("cache size:", len(cache))
}
```

<details>
<summary>Optimized Solution</summary>

```go
// LRU cache with bounded size
type LRUCache struct {
    mu       sync.Mutex
    capacity int
    cache    map[string]*entry
    order    []string // simple LRU tracking (use container/list for O(1))
}

type entry struct {
    value []byte
}

func NewLRU(capacity int) *LRUCache {
    return &LRUCache{
        capacity: capacity,
        cache:    make(map[string]*entry, capacity),
        order:    make([]string, 0, capacity),
    }
}

func (c *LRUCache) GetOrCompute(key string, compute func() []byte) []byte {
    c.mu.Lock()
    defer c.mu.Unlock()

    if e, ok := c.cache[key]; ok {
        return e.value
    }

    if len(c.cache) >= c.capacity {
        // Evict oldest (first in order)
        oldest := c.order[0]
        c.order = c.order[1:]
        delete(c.cache, oldest)
    }

    v := compute()
    c.cache[key] = &entry{v}
    c.order = append(c.order, key)
    return v
}

// Production: use github.com/hashicorp/golang-lru or similar
```
</details>

---

## Optimization Summary

| Exercise | Problem | Fix | Impact |
|---|---|---|---|
| 1 | O(n) scan for value lookup | Build inverted index | O(n)→O(1) per lookup |
| 2 | Two maps per comparison | One map + subtract | 50% fewer allocations |
| 3 | Re-sort on every call | Cache sorted result | O(n log n)→O(1) when unchanged |
| 4 | Range scan for direct key | Direct `m[key]` lookup | O(n)→O(1) |
| 5 | Map without pre-allocation | `make(map, totalSize)` | Eliminate rehashing |
| 6 | Serial channel drain | Parallel goroutines | Nx speedup (N channels) |
| 7 | String key allocation | Struct key or int encoding | 0 allocs per call |
| 8 | Slice scan for blacklist | Map set O(1) | O(n)→O(1) per check |
| 9 | Map for bounded ints | Array/slice | 0 allocs, cache-friendly |
| 10 | Deep copy in hot loop | Pre-sized map, structural sharing | 50-90% fewer allocs |
| 11 | Unbounded cache | LRU with capacity | O(1) bounded memory |
