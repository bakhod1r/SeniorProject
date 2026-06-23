# Maps — Optimize the Code

> Practice optimizing slow, inefficient, or memory-heavy Go map code.

## How to Use
1. Read the slow code and understand what it does
2. Identify the performance bottleneck
3. Write your optimized version
4. Run `go test -bench=. -benchmem` to compare

### Difficulty Levels
| Level | Focus |
|:-----:|:------|
| 🟢 | Easy — obvious inefficiencies |
| 🟡 | Medium — algorithmic improvements |
| 🔴 | Hard — zero-allocation, concurrent patterns |

### Categories
| Category | Icon |
|:--------:|:----:|
| Memory | 📦 |
| CPU | ⚡ |
| Concurrency | 🔄 |

---

## Exercise 1: Pre-size the Map 🟢 📦

**What the code does:** Builds a word frequency map from a large slice.
**The problem:** Map grows dynamically causing many rehashes and allocations.

```go
package main

func wordFreq(words []string) map[string]int {
    freq := make(map[string]int) // no size hint
    for _, w := range words {
        freq[w]++
    }
    return freq
}
```

**Benchmark baseline (1 million words):**
```
BenchmarkWordFreq-8    3    412ms/op    85MB alloc
```

<details>
<summary>Hint</summary>

`make(map[K]V, n)` accepts an optional capacity hint. Pass the length of the input slice — even if words repeat, you avoid most rehash events because the runtime pre-allocates enough buckets.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

func wordFreq(words []string) map[string]int {
    freq := make(map[string]int, len(words)) // pre-size with capacity hint
    for _, w := range words {
        freq[w]++
    }
    return freq
}
```

**Why it is faster:**
Go maps start with 8 buckets and double when the load factor (~0.8) is exceeded. Without a hint, a 1 million-element map rehashes roughly 17 times. With `len(words)` as the hint, the runtime allocates enough buckets upfront, reducing allocations by 60–80 %.

**Benchmark after:**
```
BenchmarkWordFreqOpt-8    7    158ms/op    38MB alloc
```

</details>

---

## Exercise 2: Use struct{} for Sets 🟢 📦

**What the code does:** Builds a set of unique strings to check membership.
**The problem:** Using `map[string]bool` wastes memory on the boolean value.

```go
package main

func buildSet(items []string) map[string]bool {
    set := make(map[string]bool, len(items))
    for _, item := range items {
        set[item] = true
    }
    return set
}

func contains(set map[string]bool, key string) bool {
    return set[key]
}
```

<details>
<summary>Hint</summary>

`bool` takes 1 byte per entry and the runtime still stores it alongside the key. `struct{}` is a zero-size type — it allocates no additional memory.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

type StringSet map[string]struct{}

func buildSet(items []string) StringSet {
    set := make(StringSet, len(items))
    for _, item := range items {
        set[item] = struct{}{}
    }
    return set
}

func contains(set StringSet, key string) bool {
    _, ok := set[key]
    return ok
}
```

**Why it is faster:**
`struct{}` has zero size; the compiler stores the "value" without any extra heap allocation. For 10 million entries the `bool` map uses ~80 MB while the `struct{}` map uses ~48 MB — roughly a 40 % reduction in value storage overhead.

</details>

---

## Exercise 3: Avoid Redundant Map Lookup in a Hot Loop 🟢 ⚡

**What the code does:** Increments a counter for each word in a large document.
**The problem:** Each word performs two hash lookups — one read and one write.

```go
package main

func countWords(words []string) map[string]int {
    counts := make(map[string]int, len(words))
    for _, w := range words {
        if counts[w] > 0 {
            counts[w] += 1
        } else {
            counts[w] = 1
        }
    }
    return counts
}
```

<details>
<summary>Hint</summary>

The `if/else` branch performs two separate hash computations for the same key. The zero-value behavior of Go maps lets you collapse this into a single operation.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

func countWords(words []string) map[string]int {
    counts := make(map[string]int, len(words))
    for _, w := range words {
        counts[w]++ // one lookup: read zero-value, increment, write back
    }
    return counts
}
```

**Why it is faster:**
`counts[w]++` compiles to a single map-address computation followed by an in-place increment, while the `if/else` version forces two full hash computations per word. Over 10 million words this is 20–30 % faster and more idiomatic.

</details>

---

## Exercise 4: Replace Map with Slice for Dense Integer Keys 🟡 ⚡

**What the code does:** Counts occurrences of byte values (0–255) in a large byte slice.
**The problem:** Map hash overhead dominates when keys are small dense integers.

```go
package main

func byteFreq(data []byte) map[byte]int {
    freq := make(map[byte]int, 256)
    for _, b := range data {
        freq[b]++
    }
    return freq
}
```

<details>
<summary>Hint</summary>

When keys are bounded small integers (0–255 for bytes, 0–N for enums), a plain array indexed by the integer gives O(1) access with no hashing, no collision resolution, and no allocator pressure.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

func byteFreq(data []byte) [256]int {
    var freq [256]int // stack-allocated, zero-initialized automatically
    for _, b := range data {
        freq[b]++
    }
    return freq
}
```

**Why it is faster:**
- `[256]int` is 2 KB and lives on the stack — no heap allocation.
- Array indexing is a single pointer arithmetic operation; map lookup involves hashing, bucket search, and a memory indirection.
- Benchmark: map version ~450 ns/op, array version ~120 ns/op for 1 KB input.

**Rule of thumb:** If the key space is at most 1 024 integers and dense, prefer a slice or fixed array over a map.

</details>

---

## Exercise 5: Cache the Map Lookup Result in a Local Variable 🟡 ⚡

**What the code does:** Updates multiple fields of a struct stored in a map inside a loop.
**The problem:** Every access to `registry[key]` re-executes the full hash lookup.

```go
package main

import "strings"

type Record struct {
    Name  string
    Count int
    Tags  []string
}

func process(registry map[string]*Record, keys []string) {
    for _, key := range keys {
        registry[key].Count++
        registry[key].Name = strings.ToUpper(registry[key].Name)
        registry[key].Tags = append(registry[key].Tags, "processed")
    }
}
```

<details>
<summary>Hint</summary>

Store the result of `registry[key]` in a local variable once per iteration and reuse it. Because the value is a pointer, mutations through the local variable still update the original struct in the map.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "strings"

type Record struct {
    Name  string
    Count int
    Tags  []string
}

func process(registry map[string]*Record, keys []string) {
    for _, key := range keys {
        r := registry[key] // one hash lookup per key
        if r == nil {
            continue
        }
        r.Count++
        r.Name = strings.ToUpper(r.Name)
        r.Tags = append(r.Tags, "processed")
    }
}
```

**Why it is faster:**
The original code performs 3 hash lookups per key; the optimized version performs 1. Because the value is a pointer (`*Record`), mutating fields through `r` modifies the original struct in the map. For 100 000 keys with 3 fields accessed, this is a 3x reduction in hash work.

</details>

---

## Exercise 6: sync.Map vs RWMutex — Read-Heavy Workload 🔴 🔄

**What the code does:** A cache shared across many goroutines — mostly reads, occasional writes.
**The problem:** Using `sync.Mutex` (exclusive lock) serializes all reads, killing concurrency.

```go
package main

import "sync"

type Cache struct {
    mu    sync.Mutex
    store map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    v, ok := c.store[key]
    return v, ok
}

func (c *Cache) Set(key, value string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.store[key] = value
}
```

<details>
<summary>Hint</summary>

Compare two alternatives: `sync.RWMutex` (allows concurrent reads) and `sync.Map` (optimized for stable key sets with many readers). Choose based on your actual read/write ratio and whether you need `len()` or typed values.

</details>

<details>
<summary>Optimized Solution</summary>

**Option A — RWMutex (best for mostly-read, occasional-write with typed values):**

```go
package main

import "sync"

type Cache struct {
    mu    sync.RWMutex
    store map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
    c.mu.RLock() // multiple goroutines can hold RLock simultaneously
    defer c.mu.RUnlock()
    v, ok := c.store[key]
    return v, ok
}

func (c *Cache) Set(key, value string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.store[key] = value
}
```

**Option B — sync.Map (best when keys are written once and read many times):**

```go
package main

import "sync"

type Cache struct {
    store sync.Map
}

func (c *Cache) Get(key string) (string, bool) {
    v, ok := c.store.Load(key)
    if !ok {
        return "", false
    }
    return v.(string), true
}

func (c *Cache) Set(key, value string) {
    c.store.Store(key, value)
}
```

**Tradeoff table:**

| Scenario | Best choice |
|---|---|
| 90 %+ reads, keys rarely change | `sync.Map` |
| Mixed reads/writes, typed values | `sync.RWMutex` + map |
| Write-heavy | `sync.Mutex` + sharded maps |
| Need `len()` or cheap iteration | `sync.RWMutex` + map |

`sync.Map` avoids lock contention via an internal read-only fast path but uses `any` values (boxing cost) and cannot be sized or iterated cheaply.

</details>

---

## Exercise 7: Sharded Map to Reduce Lock Contention 🔴 🔄

**What the code does:** A global counter map updated by many concurrent goroutines.
**The problem:** A single mutex becomes a bottleneck regardless of read/write mode.

```go
package main

import "sync"

type GlobalCounter struct {
    mu sync.RWMutex
    m  map[string]int64
}

func (g *GlobalCounter) Inc(key string) {
    g.mu.Lock()
    defer g.mu.Unlock()
    g.m[key]++
}

func (g *GlobalCounter) Get(key string) int64 {
    g.mu.RLock()
    defer g.mu.RUnlock()
    return g.m[key]
}
```

<details>
<summary>Hint</summary>

Split the map into N shards where each shard has its own independent mutex. Hash the key to select the shard. Contention drops by a factor of N because goroutines operating on different shards never block each other.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "hash/fnv"
    "sync"
)

const numShards = 32

type shard struct {
    mu sync.RWMutex
    m  map[string]int64
}

type ShardedCounter struct {
    shards [numShards]shard
}

func NewShardedCounter() *ShardedCounter {
    sc := &ShardedCounter{}
    for i := range sc.shards {
        sc.shards[i].m = make(map[string]int64)
    }
    return sc
}

func (sc *ShardedCounter) shardFor(key string) *shard {
    h := fnv.New32a()
    h.Write([]byte(key))
    return &sc.shards[h.Sum32()%numShards]
}

func (sc *ShardedCounter) Inc(key string) {
    s := sc.shardFor(key)
    s.mu.Lock()
    s.m[key]++
    s.mu.Unlock()
}

func (sc *ShardedCounter) Get(key string) int64 {
    s := sc.shardFor(key)
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.m[key]
}
```

**Why it is faster:**
With 32 shards and 64 concurrent writers, each shard handles on average 2 goroutines instead of 64. Average queue depth per lock drops from 64 to ~2 — throughput scales near-linearly up to `numShards` concurrent writers on different keys.

</details>

---

## Exercise 8: String Interning to Eliminate Key Allocations 🔴 📦

**What the code does:** Parses millions of log lines; each line starts with a repeated service name used as a map key.
**The problem:** Every parsed service name is a new heap allocation even though there are only ~20 unique values.

```go
package main

import "strings"

func parseLogs(lines []string) map[string]int {
    counts := make(map[string]int, 256)
    for _, line := range lines {
        parts := strings.SplitN(line, " ", 2)
        if len(parts) == 2 {
            service := parts[0] // new string allocation every iteration
            counts[service]++
        }
    }
    return counts
}
```

<details>
<summary>Hint</summary>

Build an intern table: a `map[string]string` storing the canonical copy of each string. Before using a key, look it up in the intern table. If found, reuse the existing backing array (zero new allocation); if not, insert it once.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "strings"

type Interner struct {
    table map[string]string
}

func NewInterner() *Interner {
    return &Interner{table: make(map[string]string, 64)}
}

// Intern returns the canonical copy of s, allocating only on first encounter.
func (in *Interner) Intern(s string) string {
    if v, ok := in.table[s]; ok {
        return v // reuse existing string, no allocation
    }
    in.table[s] = s
    return s
}

func parseLogs(lines []string) map[string]int {
    intern := NewInterner()
    counts := make(map[string]int, 256)
    for _, line := range lines {
        parts := strings.SplitN(line, " ", 2)
        if len(parts) == 2 {
            service := intern.Intern(parts[0]) // canonical copy reused
            counts[service]++
        }
    }
    return counts
}
```

**Why it is faster:**
When there are only 20 unique service names across 5 million log lines, interning produces 20 allocations instead of 5 million. GC pressure is eliminated and `pprof` heap profiles will show `runtime.mallocgc` disappearing from the hot path.

</details>

---

## Exercise 9: Compact the Map After Mass Deletion 🟡 📦

**What the code does:** A session store that evicts expired sessions periodically.
**The problem:** `delete` removes entries but the underlying bucket array never shrinks, so memory is never released.

```go
package main

import "time"

type Session struct {
    UserID    string
    ExpiresAt time.Time
}

type Store struct {
    sessions map[string]Session
}

func (s *Store) Evict() {
    now := time.Now()
    for id, sess := range s.sessions {
        if sess.ExpiresAt.Before(now) {
            _ = id // BUG: does nothing; expired sessions stay in the map
        }
    }
}
```

<details>
<summary>Hint</summary>

Call `delete(map, key)` for each expired entry — that is safe to do inside a range loop in Go. For bulk evictions, follow up with a compaction step: copy all live entries into a fresh map to release the now-empty bucket array.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "time"

type Session struct {
    UserID    string
    ExpiresAt time.Time
}

type Store struct {
    sessions map[string]Session
}

// Evict removes expired sessions. Safe to delete during range.
func (s *Store) Evict() {
    now := time.Now()
    for id, sess := range s.sessions {
        if sess.ExpiresAt.Before(now) {
            delete(s.sessions, id)
        }
    }
}

// Compact rebuilds the map to release bucket memory after mass eviction.
func (s *Store) Compact() {
    fresh := make(map[string]Session, len(s.sessions))
    for k, v := range s.sessions {
        fresh[k] = v
    }
    s.sessions = fresh
}
```

**Why it matters:**
`delete` marks slots empty but the bucket array never shrinks. After evicting 90 % of 1 million sessions the original map still holds ~125 000 allocated buckets. Calling `Compact()` creates a correctly sized map, dropping held memory from ~80 MB to ~8 MB.

**When to call Compact:** Only after large batch evictions. Rebuilding too often adds O(N) CPU cost; trigger it when `len(s.sessions) < cap_threshold`.

</details>

---

## Exercise 10: Avoid Interface Boxing in Map Values 🟡 📦

**What the code does:** Stores configuration values in a `map[string]any` to allow mixed types.
**The problem:** Every primitive value is boxed into an `interface{}`, causing heap allocations.

```go
package main

import "fmt"

func buildConfig() map[string]any {
    cfg := map[string]any{
        "timeout": 30,
        "retries": 3,
        "host":    "localhost",
        "debug":   true,
    }
    return cfg
}

func printTimeout(cfg map[string]any) {
    fmt.Println(cfg["timeout"].(int))
}
```

<details>
<summary>Hint</summary>

Define a concrete struct for your configuration. Struct field access is a direct memory offset — no boxing, no type assertion, no interface indirection. Reserve `map[string]any` for truly dynamic, schema-unknown data.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

type Config struct {
    Timeout int
    Retries int
    Host    string
    Debug   bool
}

func buildConfig() Config {
    return Config{
        Timeout: 30,
        Retries: 3,
        Host:    "localhost",
        Debug:   true,
    }
}

func printTimeout(cfg Config) {
    fmt.Println(cfg.Timeout) // direct field access — zero allocation
}
```

**Why it is faster:**
`any` boxing allocates each primitive on the heap (8–16 bytes per value plus GC metadata). A struct with the same fields packs everything into one contiguous block with no extra allocation. For hot-path config reads this reduces allocation from O(N fields) to O(1).

**Keep `map[string]any` for:** JSON deserialization of unknown schemas, plugin systems where key names are not known at compile time.

</details>

---

## Exercise 11: O(N×M) Bulk Delete → O(M) Direct Delete 🟡 ⚡

**What the code does:** Removes a list of banned users from an active-users map.
**The problem:** The outer loop iterates the entire `users` map for every banned name — O(N×M) complexity.

```go
package main

func removeBanned(users map[string]bool, bannedList []string) {
    for _, banned := range bannedList {
        for user := range users { // scans ALL users for every banned name
            if user == banned {
                delete(users, user)
            }
        }
    }
}
```

<details>
<summary>Hint</summary>

Map lookup is O(1). Iterate `bannedList` once and call `delete(users, banned)` directly — no inner loop needed.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

func removeBanned(users map[string]bool, bannedList []string) {
    for _, banned := range bannedList {
        delete(users, banned) // O(1) hash lookup and delete
    }
}
```

**Complexity improvement:** O(N×M) reduced to O(M), where N = number of active users and M = number of banned names.

**Example numbers:** For 100 000 users and 500 banned names, the original performs 50 000 000 string comparisons. The optimized version performs 500 hash lookups. This is a 100 000× reduction in work for that ratio.

</details>

---

## Exercise 12: Zero-Value Append Trick — Eliminate Existence Check 🟡 ⚡

**What the code does:** Groups strings into a `map[string][]string` by key.
**The problem:** The code checks for key existence before appending, performing two map lookups per item.

```go
package main

func groupBy(items []string, keyFn func(string) string) map[string][]string {
    groups := make(map[string][]string)
    for _, item := range items {
        key := keyFn(item)
        if _, ok := groups[key]; !ok {
            groups[key] = []string{} // unnecessary existence check
        }
        groups[key] = append(groups[key], item)
    }
    return groups
}
```

<details>
<summary>Hint</summary>

The zero value of `[]string` is `nil`. `append(nil, item)` works correctly and allocates a new backing array. The existence check is completely unnecessary — `append` handles the nil case automatically.

</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

func groupBy(items []string, keyFn func(string) string) map[string][]string {
    groups := make(map[string][]string, 16) // pre-size for expected groups
    for _, item := range items {
        key := keyFn(item)
        groups[key] = append(groups[key], item) // single lookup; nil slice is fine
    }
    return groups
}
```

**Why it is faster:**
- Eliminates the existence check: 1 lookup per item instead of 2.
- `append(nil, item)` allocates a new slice just as correctly as `append([]string{}, item)`.
- For grouping 1 million items into 1 000 buckets, removing the check saves 1 million redundant map lookups.

**Same pattern applies to:** `map[string]int` (zero value 0), `map[string]bool` (zero value false), any map where the zero value is a valid starting state.

</details>

---

## Summary Cheatsheet

| Optimization | Expected Gain | Difficulty |
|---|---|:---:|
| Pre-size with `make(map[K]V, n)` | 40–80 % fewer allocs | 🟢 |
| `struct{}` values for sets | ~40 % less memory | 🟢 |
| Single `counts[k]++` vs if/else | 20–30 % CPU | 🟢 |
| Array/slice for small integer keys | 3–4x CPU | 🟡 |
| Cache lookup in local variable | 2–3x for multi-field access | 🟡 |
| `sync.RWMutex` for read-heavy caches | Nx concurrent readers | 🟡 |
| Sharded maps (N shards) | ~Nx write throughput | 🔴 |
| String interning for repeated keys | Eliminates per-key allocs | 🔴 |
| `Compact()` after mass delete | Releases bucket memory | 🟡 |
| Typed struct instead of `map[string]any` | Eliminates boxing allocs | 🟡 |
| Direct `delete(m, k)` vs nested loop | O(N×M) to O(M) | 🟡 |
| Zero-value append trick | Removes existence check | 🟡 |
