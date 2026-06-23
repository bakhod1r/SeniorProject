# Go Maps — Interview Questions & Answers

## Categories
- [Junior Level (Q1–Q7)](#junior-level)
- [Middle Level (Q8–Q14)](#middle-level)
- [Senior Level (Q15–Q19)](#senior-level)
- [Scenario / Code Review (Q20–Q24)](#scenario-code-review)
- [FAQ / Tricky Questions (Q25–Q28)](#faq-tricky-questions)

---

## Junior Level

### Q1. What is a map in Go, and how do you declare one?

**Answer:**

A map is a built-in hash table data structure that associates keys with values. It provides O(1) average-time lookup, insert, and delete.

```go
// Declaration methods:
var m1 map[string]int         // nil map — read-safe, write panics
m2 := make(map[string]int)    // empty, usable
m3 := map[string]int{}        // empty literal
m4 := map[string]int{"a": 1, "b": 2} // literal with initial values
```

Key properties:
- Reference type (assignment copies the pointer, not data)
- Unordered — iteration order is random
- Keys must be comparable types (not slice, map, or function)

---

### Q2. What happens when you read a key that doesn't exist in a map?

**Answer:**

Go returns the **zero value** of the value type — no error, no panic.

```go
m := map[string]int{"a": 1}
v := m["missing"] // v = 0 (zero value for int)
```

This is a common source of bugs. Use the comma-ok idiom to distinguish between "key exists with zero value" and "key does not exist":

```go
v, ok := m["missing"]
// v = 0, ok = false
```

---

### Q3. What is the difference between a nil map and an empty map?

**Answer:**

```go
var nilMap map[string]int      // nil
emptyMap := map[string]int{}   // not nil, but has zero elements
```

| Operation | nil map | empty map |
|-----------|---------|-----------|
| `len(m)` | 0 | 0 |
| Read `m["k"]` | returns zero value | returns zero value |
| Write `m["k"] = v` | **PANIC** | works fine |
| `m == nil` | true | false |

**Rule:** Always initialize a map with `make()` or a literal before writing.

---

### Q4. How do you check if a key exists in a map?

**Answer:**

Use the two-value (comma-ok) form of map access:

```go
m := map[string]int{"score": 0}

// One-value form — cannot distinguish missing from zero
v := m["score"]  // v = 0, but is it "no key" or "key with value 0"?

// Comma-ok form — definitively checks existence
v, ok := m["score"]  // v = 0, ok = true (key exists!)
v, ok = m["missing"] // v = 0, ok = false (key absent)
```

Typical usage:
```go
if v, ok := m["key"]; ok {
    fmt.Println("found:", v)
} else {
    fmt.Println("not found")
}
```

---

### Q5. How do you delete an entry from a map?

**Answer:**

Use the built-in `delete()` function:

```go
m := map[string]int{"a": 1, "b": 2}
delete(m, "a")          // removes "a"
delete(m, "missing")    // no-op, no panic
fmt.Println(len(m))     // 1
```

`delete` is always safe — it does nothing if the key doesn't exist.

---

### Q6. Can you iterate over a map? What is special about map iteration?

**Answer:**

Yes, using `for range`:

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k, v := range m {
    fmt.Println(k, v)
}
```

**Special property: iteration order is random.** Go intentionally randomizes the start position of iteration on each run to prevent programs from depending on undefined behavior.

To iterate in a deterministic order, extract and sort the keys first:

```go
import "sort"
keys := make([]string, 0, len(m))
for k := range m {
    keys = append(keys, k)
}
sort.Strings(keys)
for _, k := range keys {
    fmt.Println(k, m[k])
}
```

---

### Q7. What types can be used as map keys?

**Answer:**

Key types must be **comparable** (support `==` and `!=`):

**Allowed:** `bool`, `int`, `float`, `complex`, `string`, `pointer`, `channel`, `interface`, arrays, structs (if all fields comparable)

**Not allowed:** `slice`, `map`, `function` — these are not comparable

```go
// OK
var m1 map[string]int
var m2 map[[3]int]string      // arrays are comparable
type Point struct{ X, Y int }
var m3 map[Point]string       // struct with comparable fields

// Compile error:
// var bad map[[]int]string   // slices not comparable
// var bad map[map[string]int]string  // maps not comparable
```

---

## Middle Level

### Q8. Why are maps reference types? What does that mean practically?

**Answer:**

A map variable is internally a pointer to a runtime `hmap` struct. Assignment copies the pointer, not the data.

```go
a := map[string]int{"x": 1}
b := a              // b points to same underlying map
b["y"] = 2
fmt.Println(a["y"]) // 2 — a is also modified!
```

Practical implications:
- Passing a map to a function allows the function to modify the caller's map
- To truly copy a map, you must iterate and copy manually (or use `maps.Clone` in Go 1.21+)
- Comparing two maps with `==` doesn't work (only `m == nil` is valid)

```go
// True copy:
copy := make(map[string]int, len(a))
for k, v := range a {
    copy[k] = v
}
```

---

### Q9. Are maps safe for concurrent use?

**Answer:**

**No.** Maps are not safe for concurrent reads and writes without external synchronization. Concurrent writes will cause a fatal "concurrent map writes" error (not recoverable with `defer/recover`).

**Options:**

1. `sync.Mutex` — protects all operations:
```go
var mu sync.Mutex
m := make(map[string]int)
mu.Lock(); m["key"] = 1; mu.Unlock()
```

2. `sync.RWMutex` — allows concurrent reads:
```go
var mu sync.RWMutex
mu.RLock(); _ = m["key"]; mu.RUnlock()
```

3. `sync.Map` — built-in concurrent map, best for stable key sets:
```go
var sm sync.Map
sm.Store("key", 1)
v, ok := sm.Load("key")
```

4. Sharded map — for maximum throughput (divide into N smaller maps, each with its own lock).

**Always run tests with `-race` flag** to detect data races.

---

### Q10. When should you use sync.Map vs a regular map with a mutex?

**Answer:**

**Use `sync.Map` when:**
- Entry sets are relatively stable (mostly reads, rare writes)
- Goroutines are reading disjoint sets of keys
- You want a lock-free read path

**Use `mutex + map` when:**
- Frequent writes
- Need `len()` atomically
- Need complex multi-step operations (atomic read-modify-write)
- Need to iterate while holding lock

```go
// sync.Map — no len(), type assertion required
var sm sync.Map
sm.Store("k", 42)
v, ok := sm.Load("k")
fmt.Println(v.(int), ok) // type assertion required

// mutex + map — more control
var mu sync.RWMutex
m := map[string]int{}
mu.Lock(); m["k"] = 42; mu.Unlock()
mu.RLock(); fmt.Println(m["k"]); mu.RUnlock()
```

---

### Q11. What is the difference between deleting from a map during iteration vs after?

**Answer:**

**Deleting during range iteration is safe in Go:**

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k, v := range m {
    if v < 2 {
        delete(m, k) // safe!
    }
}
```

The deleted key will not appear in subsequent iterations. The spec guarantees this.

**Adding during iteration is defined but unpredictable:**

```go
m := map[string]int{"a": 1}
for k := range m {
    m["new"] = 99 // may or may not be visited
    fmt.Println(k)
}
```

Newly added keys may or may not appear in the current iteration. The spec says: "The iteration order over maps is not specified and is not guaranteed to be the same from one iteration to the next. If a map entry that has not yet been reached is removed during iteration, the corresponding iteration value will not be produced. If a map entry is created during iteration, that entry may be produced during the iteration or may be skipped."

**Best practice:** Collect keys to delete, then delete after the loop.

---

### Q12. What is a dispatch table and how do you implement one with a map?

**Answer:**

A dispatch table is a map from names (or codes) to functions, replacing long `switch` statements:

```go
// Instead of switch:
func process(cmd string) {
    switch cmd {
    case "add":   doAdd()
    case "delete": doDelete()
    // ... many cases
    }
}

// Dispatch table — extensible at runtime:
type HandlerFunc func()

var handlers = map[string]HandlerFunc{
    "add":    doAdd,
    "delete": doDelete,
}

func process(cmd string) {
    if fn, ok := handlers[cmd]; ok {
        fn()
    } else {
        fmt.Println("unknown command:", cmd)
    }
}

// Register new handler at runtime:
handlers["update"] = doUpdate
```

Advantages: extensible, plugins can register themselves, eliminates repetitive switch code.

---

### Q13. How do you implement a set in Go?

**Answer:**

Go has no built-in set type. Use a map:

```go
// Option 1: map[T]bool — simpler to read
set := map[string]bool{}
set["apple"] = true
set["banana"] = true
if set["apple"] { /* apple is in set */ }
delete(set, "apple")

// Option 2: map[T]struct{} — zero memory for values (preferred)
set2 := map[string]struct{}{}
set2["apple"] = struct{}{}
if _, ok := set2["apple"]; ok { /* in set */ }
delete(set2, "apple")

// Set operations:
func union(a, b map[string]struct{}) map[string]struct{} {
    result := make(map[string]struct{}, len(a)+len(b))
    for k := range a { result[k] = struct{}{} }
    for k := range b { result[k] = struct{}{} }
    return result
}

func intersection(a, b map[string]struct{}) map[string]struct{} {
    result := make(map[string]struct{})
    for k := range a {
        if _, ok := b[k]; ok {
            result[k] = struct{}{}
        }
    }
    return result
}
```

**Prefer `struct{}`** over `bool` because it uses zero bytes of memory per entry.

---

### Q14. What happens to map memory after you delete all entries?

**Answer:**

**Maps do not shrink.** After deleting entries, the bucket array remains allocated. The deleted slots are marked as empty but the underlying memory is not returned to the OS.

```go
m := make(map[int]int)
for i := 0; i < 1_000_000; i++ {
    m[i] = i
}
// Memory: ~50MB

for k := range m {
    delete(m, k)
}
fmt.Println(len(m)) // 0
// Memory: still ~50MB — buckets allocated but empty
```

**To release memory:** assign nil or create a new map:

```go
m = nil                          // old map GC-eligible
m = make(map[int]int)            // fresh empty map
```

This is by design — if you'll fill the map again, reusing the allocated buckets is more efficient.

---

## Senior Level

### Q15. Explain the internal bucket structure of a Go map.

**Answer:**

A Go map (`hmap`) contains:
- `count` — number of live entries
- `B` — `log2` of bucket count (2^B buckets)
- `hash0` — random seed for hash security
- `buckets` — pointer to array of `2^B` buckets (`bmap`)
- `oldbuckets` — previous bucket array during growth

Each `bmap` bucket holds up to **8** key-value pairs:
- `tophash[8]` — top 8 bits of each key's hash (fast slot discrimination)
- Keys are stored together (not interleaved with values)
- Values are stored together (better memory alignment)
- `overflow` pointer — chain to next bucket if all 8 slots are full

**Lookup flow:**
1. Hash the key with AES-NI or wyhash
2. Low bits of hash → bucket index
3. Compare top 8 bits against `tophash[8]` (fast: 8 byte comparisons, fits in one cache line)
4. Full key comparison only on tophash match

---

### Q16. What are the two growth modes of Go maps, and when does each trigger?

**Answer:**

**Mode 1: Overload growth** (most common)
- Trigger: `count > 6.5 * 2^B` (load factor exceeded)
- Action: `B++` — double the number of buckets
- Effect: better key distribution, fewer overflow chains

**Mode 2: Same-size growth** (reorganization)
- Trigger: too many overflow buckets even at acceptable count
- Happens after many deletes followed by inserts ("Swiss cheese" pattern)
- Action: B stays same, bucket contents are reorganized
- Effect: eliminates overflow chains, better cache locality

**Growth is incremental** — during each `mapassign` or `mapdelete`, Go evacuates 2 old buckets to the new array. This prevents stop-the-world pauses.

---

### Q17. What is the hashWriting flag and why is "concurrent map writes" fatal (not recoverable)?

**Answer:**

The `hashWriting` flag is bit 4 of `hmap.flags`. It is set at the start of `mapassign`/`mapdelete` and cleared at the end. If either function detects the flag is already set, it calls `runtime.throw()`.

```
mapassign start: h.flags ^= hashWriting   // set bit
mapassign end:   h.flags &^= hashWriting  // clear bit

On second concurrent write: throw("concurrent map writes")
```

`runtime.throw()` is **not** recoverable with `defer/recover()` because it calls `runtime.exit()` directly. This is distinct from `panic()` which can be recovered.

Why fatal? The map's internal state during a write is invariant-breaking. A half-written map has undefined bucket structure and cannot be safely used. Making it fatal ensures no partial state is ever observed.

**Detection:** The `hashWriting` check is a best-effort detector. For guaranteed detection, use `-race` flag which enables the full race detector with shadow memory.

---

### Q18. How does the Go runtime avoid pointer-scanning overhead in maps with scalar types?

**Answer:**

The Go GC must scan all live pointers to identify reachable objects. For maps:

- If **both K and V contain no pointers** (e.g., `map[int]int`, `map[int][8]float64`): the bucket array is marked as `noscan`. The GC only needs to trace the bucket pointer itself, not each individual slot.

- If **K or V contain pointers** (e.g., `map[string]*T`, `map[int][]byte`): the GC must scan every live slot in every bucket to find embedded pointers.

```go
// GC-friendly: no pointer scanning of buckets
m1 := map[int64]int64{}  // noscan bucket

// GC-heavy: every slot scanned
m2 := map[string]*MyStruct{}  // string has pointer; *MyStruct is pointer

// Optimization: for pointer-value maps, prefer value types where possible
type Data struct{ X, Y, Z int }  // no pointers
m3 := map[int]Data{}  // noscan! even though Data has multiple fields
```

This optimization significantly reduces GC pause time for large maps with scalar types.

---

### Q19. Describe a production scenario where you would use a sharded map instead of sync.Map or RWMutex+map.

**Answer:**

**Scenario:** A metrics counter system that handles 1 million increments per second across 10,000 different metric keys from thousands of goroutines.

```go
const numShards = 256

type MetricsMap struct {
    shards [numShards]struct {
        sync.RWMutex
        data map[string]int64
    }
}
```

**Why sharded:**
- `RWMutex+map`: All writes contend on a single lock → bottleneck at high concurrency
- `sync.Map`: Optimized for read-heavy; write-heavy workloads have internal lock contention
- **Sharded map**: Each shard has its own lock, so 256 goroutines can write simultaneously (each to different shard)

**Key formula:** `shard = hash(key) % numShards`

A good shard hash distributes keys evenly so no single shard becomes a hotspot.

**When to use:** Counter/metrics systems, request-rate-limiting maps, distributed caches in microservices where multiple goroutines write different keys simultaneously.

---

## Scenario / Code Review

### Q20. Find the bugs in this code:

```go
func countWords(words []string) map[string]int {
    var counts map[string]int
    for _, w := range words {
        counts[w]++
    }
    return counts
}
```

**Answer:**

**Bug:** `counts` is a nil map. Writing to it (`counts[w]++`) will panic with "assignment to entry in nil map".

**Fix:**
```go
func countWords(words []string) map[string]int {
    counts := make(map[string]int)
    for _, w := range words {
        counts[w]++
    }
    return counts
}
```

**Bonus:** `counts[w]++` works even for missing keys because `counts[w]` returns 0 for missing keys, and `0+1 = 1` is then stored. The zero-value-as-default is intentional here.

---

### Q21. What is wrong with this concurrent code?

```go
var cache = map[string][]byte{}

func getFromCache(key string) ([]byte, bool) {
    v, ok := cache[key]
    return v, ok
}

func setCache(key string, data []byte) {
    cache[key] = data
}
```

**Answer:**

`cache` is a global map used without any synchronization. Concurrent calls to `setCache` will cause a fatal "concurrent map writes" error. Even concurrent reads with a write can fail.

**Fix:**

```go
var (
    cacheMu sync.RWMutex
    cache   = map[string][]byte{}
)

func getFromCache(key string) ([]byte, bool) {
    cacheMu.RLock()
    defer cacheMu.RUnlock()
    v, ok := cache[key]
    return v, ok
}

func setCache(key string, data []byte) {
    cacheMu.Lock()
    defer cacheMu.Unlock()
    cache[key] = data
}
```

---

### Q22. What will this code print and why?

```go
m := map[string]int{"a": 1, "b": 2}
keys := make([]string, 0)
for k := range m {
    keys = append(keys, k)
}
fmt.Println(keys)
```

**Answer:**

The output contains both `"a"` and `"b"`, but the **order is not guaranteed**. It could print `[a b]` or `[b a]`, and the order may differ between runs.

Go intentionally randomizes map iteration order to prevent programs from depending on undefined behavior. If ordered output is needed:

```go
sort.Strings(keys)
fmt.Println(keys) // always [a b]
```

---

### Q23. Is this code correct? If not, fix it:

```go
func getUser(users map[string]User, name string) User {
    return users[name]
}

type User struct {
    Name  string
    Admin bool
}

func main() {
    users := map[string]User{
        "alice": {Name: "alice", Admin: true},
    }

    u := getUser(users, "bob")
    if u.Admin {
        fmt.Println("Admin access granted")
    }
}
```

**Answer:**

The code compiles and runs without panicking, but has a **logical bug**: when `"bob"` is not in the map, `users["bob"]` returns a zero-value `User{}` where `Admin = false`. So the `if` block won't execute — that's correct behavior here.

However, the function gives no way to distinguish "user not found" from "user found with Admin=false". This can lead to bugs in callers that need to know if the user exists.

**Better design:**

```go
func getUser(users map[string]User, name string) (User, bool) {
    u, ok := users[name]
    return u, ok
}

u, ok := getUser(users, "bob")
if !ok {
    fmt.Println("user not found")
    return
}
if u.Admin {
    fmt.Println("Admin access granted")
}
```

---

### Q24. Review this code for performance issues:

```go
func buildIndex(records []Record) map[string]Record {
    index := make(map[string]Record)
    for _, r := range records {
        key := r.ID + ":" + r.Category + ":" + r.Region
        index[key] = r
    }
    return index
}
```

**Answer:**

**Issues:**

1. **No size hint:** `make(map[string]Record)` will trigger multiple reallocations as `records` grows. Fix: `make(map[string]Record, len(records))`.

2. **String concatenation allocates:** `r.ID + ":" + r.Category + ":" + r.Region` creates a new string on each iteration. In hot paths, use `fmt.Sprintf` (which is actually slower due to reflection) or `strings.Builder`.

3. **Large value type:** If `Record` is a large struct, storing it by value copies it on each insert and lookup. Consider `map[string]*Record`.

**Improved:**
```go
func buildIndex(records []Record) map[string]*Record {
    index := make(map[string]*Record, len(records))
    var sb strings.Builder
    for i := range records {
        sb.Reset()
        sb.WriteString(records[i].ID)
        sb.WriteByte(':')
        sb.WriteString(records[i].Category)
        sb.WriteByte(':')
        sb.WriteString(records[i].Region)
        index[sb.String()] = &records[i]
    }
    return index
}
```

---

## FAQ / Tricky Questions

### Q25. Can you use NaN as a map key? What happens?

**Answer:**

`float64` NaN can be used as a map key because float64 is technically comparable. However, the behavior is surprising:

```go
m := map[float64]string{}
nan := math.NaN()

m[nan] = "first"
m[nan] = "second" // Does NOT overwrite! NaN != NaN, so it's a new slot

fmt.Println(len(m)) // 2

v, ok := m[nan] // ok = false! You can never retrieve a NaN key
fmt.Println(v, ok) // "" false
```

This happens because `NaN != NaN` by IEEE 754 definition, so Go can never find an existing NaN key — every `m[nan]` lookup always returns "not found", and every `m[nan] = x` always inserts a new entry.

**Lesson:** Never use float keys in maps, especially if values might be NaN. Validate inputs and convert to string if needed.

---

### Q26. If I copy a map variable, does the copy get its own data?

**Answer:**

**No.** Copying a map variable just copies the pointer:

```go
a := map[string]int{"x": 1}
b := a        // b holds the same pointer as a
b["y"] = 2
fmt.Println(a) // map[x:1 y:2] — a was modified through b!
```

This is unlike slices where you have a slice header + underlying array. A map variable is just a single pointer — copying it gives two pointers to the same hash table.

**For a true copy:**
```go
// Go 1.21+
import "maps"
b = maps.Clone(a)

// Earlier:
b = make(map[string]int, len(a))
for k, v := range a {
    b[k] = v
}
```

---

### Q27. What is the difference between `delete` on a map and setting a key to its zero value?

**Answer:**

```go
m := map[string]int{"a": 1, "b": 2}

// Setting to zero value — key STILL EXISTS
m["a"] = 0
v, ok := m["a"]
fmt.Println(v, ok)  // 0, true (key exists with zero value)
fmt.Println(len(m)) // 2

// delete — key is REMOVED
delete(m, "b")
v, ok = m["b"]
fmt.Println(v, ok)  // 0, false (key does not exist)
fmt.Println(len(m)) // 1
```

**When it matters:** If you need to distinguish "this key was explicitly set to zero" from "this key has never been set", you must use `delete`. The comma-ok idiom tells the difference.

---

### Q28. How does Go prevent hash-flooding attacks on maps?

**Answer:**

Hash-flooding is a DoS attack where an attacker crafts input keys that all hash to the same bucket, turning O(1) lookups into O(n) chains.

Go prevents this with **per-map randomized hash seeds:**

1. When `make(map[K]V)` is called, `hash0` is set to a random 32-bit seed from `runtime.fastrand()`
2. All key hashes are computed as `hash = hashfn(key, seed)`
3. An attacker cannot pre-compute a key set that collides without knowing the seed
4. The seed changes with each program run and each map creation

This is called **hash randomization** or **seed randomization** and is why map iteration is random — the hash seed determines bucket placement, and it changes every run.

```go
// Same keys, different maps — different iteration order
m1 := map[string]int{"a": 1, "b": 2}
m2 := map[string]int{"a": 1, "b": 2}
// m1 and m2 have different hash seeds → different bucket layouts
```

---

## Quick Reference: Common Map Interview Gotchas

| Gotcha | Correct Behavior |
|--------|-----------------|
| Writing to nil map | Panics — use `make()` |
| Reading from nil map | Returns zero value (safe) |
| Map iteration order | Random — never rely on it |
| `m2 := m1` | Both share the same data |
| `m1 == m2` | Compile error (only `m == nil` works) |
| NaN float64 key | Leaks memory — never retrievable |
| `delete` during range | Safe — key won't appear again |
| Map shrinks after delete | Never — rebuild to release memory |
| `concurrent map writes` | Fatal — not recoverable with recover() |
| `len(nilMap)` | 0 (safe) |
