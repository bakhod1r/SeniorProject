# Go Maps — Middle Level

## Table of Contents
1. How Go's Map Works Internally (High Level)
2. Hash Functions and Buckets
3. Load Factor and Growth
4. Why Maps Are Not Ordered
5. Reference Semantics — Deep Dive
6. When to Use Map vs Other Structures
7. Thread Safety: The Data Race Problem
8. sync.Map vs Mutex+Map
9. Map Iteration During Modification
10. Key Design Decisions
11. Handling Complex Value Types
12. Functional Patterns with Maps
13. Maps as Dispatch Tables
14. The Frequency Pattern
15. Inversion Pattern (Reverse Map)
16. Map-Reduce Pattern in Go
17. Error Handling with Maps
18. Map Memory Characteristics
19. Benchmark: Map vs Switch vs Slice
20. Evolution of Maps in Go
21. Alternative Approaches
22. Anti-Patterns to Avoid
23. Debugging Guide
24. Language Comparison: Go vs Python/Java/C++
25. Testing Code That Uses Maps
26. Maps in Concurrent Systems
27. Advanced Iteration Techniques
28. Map Cloning Strategies
29. Design Patterns Using Maps
30. Production Checklist

---

## 1. How Go's Map Works Internally (High Level)

Go's map is a **hash table** implementation. Understanding the basics helps you use maps more effectively.

```
Map Structure (simplified):
┌─────────────────────────────────────────────┐
│  hmap                                       │
│  ┌──────────┬──────────┬───────────────┐    │
│  │  count   │  flags   │  B (log2 #    │    │
│  │  (len)   │          │   buckets)    │    │
│  └──────────┴──────────┴───────────────┘    │
│  ┌──────────────────────────────────────┐   │
│  │  buckets → [ ]bmap                  │   │
│  │    bmap: up to 8 key-value pairs    │   │
│  │    overflow → next bmap if needed   │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

```go
// What happens when you do m["key"]:
// 1. Compute hash of "key"
// 2. Use low bits of hash to find bucket index
// 3. Scan bucket's 8 slots for matching high-bits (tophash)
// 4. Compare full key if tophash matches
// 5. Return value or zero value

package main

import "fmt"

func main() {
    m := make(map[string]int)

    // Each assignment triggers hash computation and bucket placement
    m["hello"] = 1  // hash("hello") -> bucket N
    m["world"] = 2  // hash("world") -> bucket M (likely different)

    // Lookup is the reverse
    v := m["hello"] // O(1) average, not O(log n)
    fmt.Println(v)
}
```

---

## 2. Hash Functions and Buckets

Go uses AES-based hashing on supported hardware (most modern CPUs):

```go
package main

import (
    "fmt"
    "math/rand"
)

func main() {
    // Demonstrate that equal keys always hash the same
    m := map[string]int{}

    key := "consistent"
    m[key] = 1

    // Multiple lookups of the same key always work
    for i := 0; i < 5; i++ {
        fmt.Println(m[key]) // always 1
    }

    // Keys that are == always map to the same bucket
    // This is why slice keys are not allowed: slices aren't ==

    _ = rand.Int // just to show import
}
```

**Important consequence:** Float NaN keys are problematic because `NaN != NaN`:

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    m := map[float64]string{}

    nan := math.NaN()
    m[nan] = "value1"
    m[nan] = "value2" // stores ANOTHER entry because NaN != NaN

    // You can never retrieve a NaN-keyed value:
    v, ok := m[nan]
    fmt.Println(v, ok) // "" false — can't find it!

    fmt.Println(len(m)) // 2 — both stored, neither retrievable!
}
```

---

## 3. Load Factor and Growth

Go maps grow automatically when the **load factor** (items per bucket) gets too high:

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var ms runtime.MemStats

    // Before allocation
    runtime.ReadMemStats(&ms)
    before := ms.TotalAlloc

    // Create a large map
    m := make(map[int]int)
    for i := 0; i < 100000; i++ {
        m[i] = i * 2
    }

    // After allocation
    runtime.ReadMemStats(&ms)
    after := ms.TotalAlloc

    fmt.Printf("Map with 100k entries used ~%d bytes\n", after-before)
    fmt.Println(len(m))

    // With hint — fewer reallocations during fill
    m2 := make(map[int]int, 100000)
    for i := 0; i < 100000; i++ {
        m2[i] = i * 2
    }
    fmt.Println(len(m2))
}
```

**Growth trigger:** When average bucket load exceeds 6.5 items, Go doubles the number of buckets and rehashes. This is an **incremental** process — Go doesn't rehash all at once (it would stall goroutines).

---

## 4. Why Maps Are Not Ordered

This is a deliberate design decision, not a bug:

```go
package main

import (
    "fmt"
    "sort"
)

func main() {
    m := map[int]string{1: "a", 2: "b", 3: "c", 4: "d", 5: "e"}

    // Go intentionally randomizes start position of iteration
    // This prevents developers from depending on undefined behavior
    fmt.Println("Random order:")
    for k, v := range m {
        fmt.Printf("  %d: %s\n", k, v)
    }

    // Sorted iteration — the correct approach
    keys := make([]int, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    sort.Ints(keys)

    fmt.Println("Sorted order:")
    for _, k := range keys {
        fmt.Printf("  %d: %s\n", k, m[k])
    }
}
```

**Why randomize?** Before Go 1.12, the order was not random but was still undefined. Some programs accidentally relied on it, breaking when Go changed the implementation. By actively randomizing, Go forces correct code.

---

## 5. Reference Semantics — Deep Dive

Understanding exactly what "reference type" means for maps:

```go
package main

import "fmt"

func modify(m map[string]int) {
    m["new"] = 99  // modifies caller's map
}

func replace(m map[string]int) {
    m = make(map[string]int) // replaces LOCAL variable only
    m["new"] = 99            // does NOT affect caller
}

func replaceWithPointer(m *map[string]int) {
    *m = make(map[string]int) // replaces caller's variable
    (*m)["new"] = 99
}

func main() {
    m := map[string]int{"a": 1}

    modify(m)
    fmt.Println(m) // map[a:1 new:99] — modified

    replace(m)
    fmt.Println(m) // map[a:1 new:99] — unchanged (local replacement)

    replaceWithPointer(&m)
    fmt.Println(m) // map[new:99] — replaced
}
```

**Mental model:** A map variable is a pointer to an internal `hmap` struct. Assignment copies the pointer, not the data.

---

## 6. When to Use Map vs Other Structures

```go
package main

import (
    "fmt"
    "sort"
)

// Use map when: fast lookup by arbitrary key
func exampleMap() {
    index := map[string]int{
        "apple": 0, "banana": 1, "cherry": 2,
    }
    fmt.Println(index["banana"]) // O(1)
}

// Use slice when: ordered, integer-indexed, sequential access
func exampleSlice() {
    fruits := []string{"apple", "banana", "cherry"}
    fmt.Println(fruits[1]) // O(1) by index
    // But finding by value requires O(n) scan
    for i, f := range fruits {
        if f == "banana" {
            fmt.Println(i)
            break
        }
    }
}

// Use sorted slice + binary search when: read-heavy, memory-efficient
func exampleSortedSlice() {
    fruits := []string{"apple", "banana", "cherry"}
    sort.Strings(fruits)
    idx := sort.SearchStrings(fruits, "banana") // O(log n)
    fmt.Println(idx)
}

// Use sync.Map when: concurrent read-heavy workloads with stable key set
// Use map+RWMutex when: concurrent with writes

func main() {
    exampleMap()
    exampleSlice()
    exampleSortedSlice()
}
```

**Decision matrix:**

| Need | Use |
|------|-----|
| Key-value lookup | `map[K]V` |
| Ordered pairs | Slice of structs + sort |
| Set membership | `map[K]struct{}` |
| Concurrent read-heavy | `sync.Map` or `RWMutex` + map |
| Frequent writes, concurrent | `Mutex` + map |
| Small fixed set | Switch statement |

---

## 7. Thread Safety: The Data Race Problem

Go maps are **not safe for concurrent use**:

```go
package main

import (
    "fmt"
    "sync"
)

// WRONG: concurrent map writes cause panic
func badConcurrentMap() {
    m := make(map[int]int)
    var wg sync.WaitGroup

    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            m[n] = n * 2 // DATA RACE — concurrent write
        }(i)
    }
    wg.Wait()
    fmt.Println(len(m))
}

// CORRECT: protect with mutex
func safeConcurrentMap() {
    var mu sync.Mutex
    m := make(map[int]int)
    var wg sync.WaitGroup

    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            mu.Lock()
            m[n] = n * 2
            mu.Unlock()
        }(i)
    }
    wg.Wait()
    fmt.Println(len(m)) // 100
}

func main() {
    safeConcurrentMap()
}
```

**Run with `-race` flag** to detect data races: `go run -race main.go`

---

## 8. sync.Map vs Mutex+Map

```go
package main

import (
    "fmt"
    "sync"
)

// sync.Map — optimized for:
// 1. Entries written once and read many times
// 2. Goroutines reading disjoint sets of keys
func usingSyncMap() {
    var m sync.Map

    // Store
    m.Store("key", 42)

    // Load
    if v, ok := m.Load("key"); ok {
        fmt.Println(v.(int)) // type assertion needed
    }

    // LoadOrStore — atomic: load if exists, store if not
    actual, loaded := m.LoadOrStore("key2", 100)
    fmt.Println(actual, loaded) // 100 false (newly stored)

    actual, loaded = m.LoadOrStore("key2", 200)
    fmt.Println(actual, loaded) // 100 true (already existed)

    // Delete
    m.Delete("key")

    // Range iteration
    m.Range(func(k, v interface{}) bool {
        fmt.Printf("%v: %v\n", k, v)
        return true // return false to stop
    })
}

// Mutex+map — better when:
// 1. Lots of writes (sync.Map has overhead for write-heavy workloads)
// 2. Need len() or complex operations atomically
func usingMutexMap() {
    var mu sync.RWMutex
    m := make(map[string]int)

    // Read (multiple goroutines can read simultaneously)
    read := func(key string) int {
        mu.RLock()
        defer mu.RUnlock()
        return m[key]
    }

    // Write (exclusive)
    write := func(key string, val int) {
        mu.Lock()
        defer mu.Unlock()
        m[key] = val
    }

    write("a", 1)
    fmt.Println(read("a"))
}

func main() {
    usingSyncMap()
    usingMutexMap()
}
```

---

## 9. Map Iteration During Modification

Go has well-defined rules for modifying a map during iteration:

```go
package main

import "fmt"

func main() {
    m := map[string]int{
        "a": 1, "b": 2, "c": 3, "d": 4,
    }

    // DELETION during iteration: safe, key won't appear
    for k := range m {
        if k == "b" {
            delete(m, k) // safe
        }
    }
    fmt.Println(m) // "b" is gone

    // ADDITION during iteration: defined but unpredictable
    // New key may or may not be visited in current iteration
    m2 := map[string]int{"a": 1}
    for k, v := range m2 {
        fmt.Println(k, v)
        m2["new_key"] = 99 // may or may not see "new_key" in this loop
    }
    fmt.Println(m2) // both "a" and "new_key" present after

    // BEST PRACTICE: collect deletions, apply after
    m3 := map[string]int{"a": 1, "b": 2, "c": 3}
    toDelete := []string{}
    for k, v := range m3 {
        if v < 2 {
            toDelete = append(toDelete, k)
        }
    }
    for _, k := range toDelete {
        delete(m3, k)
    }
    fmt.Println(m3) // map[b:2 c:3]
}
```

---

## 10. Key Design Decisions

How to choose your key and value types thoughtfully:

```go
package main

import "fmt"

// Composite keys using structs
type CacheKey struct {
    UserID int
    Region string
}

type GeoPoint struct {
    Lat, Lon float64 // Be careful with float keys and precision!
}

func main() {
    // Struct key — clean and safe
    cache := map[CacheKey]string{
        {UserID: 1, Region: "us-east"}: "data1",
        {UserID: 1, Region: "eu-west"}: "data2",
    }
    fmt.Println(cache[CacheKey{1, "us-east"}]) // data1

    // String key for composite lookups (alternative)
    cache2 := map[string]string{
        "1:us-east": "data1",
        "1:eu-west": "data2",
    }
    key := fmt.Sprintf("%d:%s", 1, "us-east")
    fmt.Println(cache2[key]) // data1

    // Float keys — risky due to precision
    _ = map[GeoPoint]string{
        {40.7128, -74.0060}: "New York",
    }
    // Floating-point comparison issues may cause unexpected misses
}
```

---

## 11. Handling Complex Value Types

```go
package main

import "fmt"

// Map of slices — common pattern
func addToGroup(groups map[string][]string, group, item string) {
    groups[group] = append(groups[group], item)
    // append to nil slice works fine — creates new slice
}

// Map of maps with lazy initialization
func setNested(m map[string]map[string]int, outer, inner string, val int) {
    if m[outer] == nil {
        m[outer] = make(map[string]int)
    }
    m[outer][inner] = val
}

func main() {
    groups := make(map[string][]string)
    addToGroup(groups, "fruits", "apple")
    addToGroup(groups, "fruits", "banana")
    addToGroup(groups, "veggies", "carrot")
    fmt.Println(groups)
    // map[fruits:[apple banana] veggies:[carrot]]

    nested := make(map[string]map[string]int)
    setNested(nested, "row1", "col1", 10)
    setNested(nested, "row1", "col2", 20)
    setNested(nested, "row2", "col1", 30)
    fmt.Println(nested)
    // map[row1:map[col1:10 col2:20] row2:map[col1:30]]
}
```

---

## 12. Functional Patterns with Maps

```go
package main

import "fmt"

// Filter a map
func filterMap(m map[string]int, predicate func(string, int) bool) map[string]int {
    result := make(map[string]int)
    for k, v := range m {
        if predicate(k, v) {
            result[k] = v
        }
    }
    return result
}

// Transform values
func mapValues(m map[string]int, transform func(int) int) map[string]int {
    result := make(map[string]int, len(m))
    for k, v := range m {
        result[k] = transform(v)
    }
    return result
}

// Merge two maps (second wins on conflict)
func mergeMaps(m1, m2 map[string]int) map[string]int {
    result := make(map[string]int, len(m1)+len(m2))
    for k, v := range m1 {
        result[k] = v
    }
    for k, v := range m2 {
        result[k] = v
    }
    return result
}

func main() {
    scores := map[string]int{
        "Alice": 95, "Bob": 72, "Carol": 88, "Dave": 61,
    }

    passing := filterMap(scores, func(_, v int) bool { return v >= 75 })
    fmt.Println(passing) // Alice:95 Carol:88

    doubled := mapValues(scores, func(v int) int { return v * 2 })
    fmt.Println(doubled)

    extra := map[string]int{"Eve": 90, "Alice": 100}
    merged := mergeMaps(scores, extra)
    fmt.Println(merged["Alice"]) // 100 (extra wins)
}
```

---

## 13. Maps as Dispatch Tables

Replace long switch statements with maps of functions:

```go
package main

import (
    "fmt"
    "strings"
)

// Instead of:
func processV1(cmd string, arg string) string {
    switch cmd {
    case "upper":
        return strings.ToUpper(arg)
    case "lower":
        return strings.ToLower(arg)
    case "reverse":
        runes := []rune(arg)
        for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
            runes[i], runes[j] = runes[j], runes[i]
        }
        return string(runes)
    default:
        return arg
    }
}

// Use a dispatch table:
var handlers = map[string]func(string) string{
    "upper": strings.ToUpper,
    "lower": strings.ToLower,
    "reverse": func(s string) string {
        runes := []rune(s)
        for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
            runes[i], runes[j] = runes[j], runes[i]
        }
        return string(runes)
    },
}

func processV2(cmd string, arg string) string {
    if fn, ok := handlers[cmd]; ok {
        return fn(arg)
    }
    return arg
}

func main() {
    fmt.Println(processV1("upper", "hello")) // HELLO
    fmt.Println(processV2("upper", "hello")) // HELLO
    fmt.Println(processV2("reverse", "hello")) // olleh

    // Dispatch table is extensible at runtime
    handlers["title"] = func(s string) string {
        return strings.Title(s)
    }
    fmt.Println(processV2("title", "hello world")) // Hello World
}
```

---

## 14. The Frequency Pattern

Counting occurrences is one of the most common map patterns:

```go
package main

import (
    "fmt"
    "sort"
    "strings"
)

func topN(text string, n int) []string {
    // Count word frequencies
    freq := make(map[string]int)
    for _, word := range strings.Fields(text) {
        word = strings.ToLower(strings.Trim(word, ".,!?"))
        freq[word]++
    }

    // Sort by frequency
    type wordFreq struct {
        word  string
        count int
    }
    pairs := make([]wordFreq, 0, len(freq))
    for w, c := range freq {
        pairs = append(pairs, wordFreq{w, c})
    }
    sort.Slice(pairs, func(i, j int) bool {
        if pairs[i].count != pairs[j].count {
            return pairs[i].count > pairs[j].count
        }
        return pairs[i].word < pairs[j].word
    })

    result := make([]string, 0, n)
    for i := 0; i < n && i < len(pairs); i++ {
        result = append(result, fmt.Sprintf("%s(%d)", pairs[i].word, pairs[i].count))
    }
    return result
}

func main() {
    text := "the quick brown fox jumps over the lazy dog the fox"
    fmt.Println(topN(text, 3)) // [the(3) fox(2) brown(1)] or similar
}
```

---

## 15. Inversion Pattern (Reverse Map)

```go
package main

import (
    "fmt"
    "errors"
)

// Invert a map (values become keys, keys become values)
// Panics if values are not unique — use safe version in production
func invertMap(m map[string]int) map[int]string {
    result := make(map[int]string, len(m))
    for k, v := range m {
        result[v] = k
    }
    return result
}

// Safe inversion — returns error if values are not unique
func invertMapSafe(m map[string]int) (map[int]string, error) {
    result := make(map[int]string, len(m))
    for k, v := range m {
        if _, exists := result[v]; exists {
            return nil, errors.New(fmt.Sprintf("duplicate value: %d", v))
        }
        result[v] = k
    }
    return result, nil
}

func main() {
    codes := map[string]int{
        "OK":           200,
        "Not Found":    404,
        "Server Error": 500,
    }

    byCode, err := invertMapSafe(codes)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }

    fmt.Println(byCode[200]) // OK
    fmt.Println(byCode[404]) // Not Found
}
```

---

## 16. Map-Reduce Pattern in Go

```go
package main

import "fmt"

type Record struct {
    Category string
    Amount   float64
}

func groupAndSum(records []Record) map[string]float64 {
    totals := make(map[string]float64)
    for _, r := range records {
        totals[r.Category] += r.Amount
    }
    return totals
}

func main() {
    sales := []Record{
        {"Electronics", 1200.00},
        {"Books", 45.99},
        {"Electronics", 350.00},
        {"Books", 12.99},
        {"Clothing", 89.50},
    }

    totals := groupAndSum(sales)
    for cat, total := range totals {
        fmt.Printf("%s: $%.2f\n", cat, total)
    }
    // Electronics: $1550.00
    // Books: $58.98
    // Clothing: $89.50
}
```

---

## 17. Error Handling with Maps

```go
package main

import (
    "errors"
    "fmt"
)

// Registry pattern with error handling
type Registry struct {
    handlers map[string]func([]byte) ([]byte, error)
}

func NewRegistry() *Registry {
    return &Registry{handlers: make(map[string]func([]byte) ([]byte, error))}
}

var ErrHandlerNotFound = errors.New("handler not found")
var ErrHandlerExists = errors.New("handler already registered")

func (r *Registry) Register(name string, fn func([]byte) ([]byte, error)) error {
    if _, exists := r.handlers[name]; exists {
        return fmt.Errorf("%w: %s", ErrHandlerExists, name)
    }
    r.handlers[name] = fn
    return nil
}

func (r *Registry) Process(name string, data []byte) ([]byte, error) {
    fn, ok := r.handlers[name]
    if !ok {
        return nil, fmt.Errorf("%w: %s", ErrHandlerNotFound, name)
    }
    return fn(data)
}

func main() {
    reg := NewRegistry()
    reg.Register("echo", func(b []byte) ([]byte, error) { return b, nil })

    result, err := reg.Process("echo", []byte("hello"))
    if err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Println(string(result)) // hello
    }

    _, err = reg.Process("missing", nil)
    fmt.Println(errors.Is(err, ErrHandlerNotFound)) // true
}
```

---

## 18. Map Memory Characteristics

```go
package main

import (
    "fmt"
    "runtime"
    "unsafe"
)

func memStats() uint64 {
    var ms runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&ms)
    return ms.Alloc
}

func main() {
    before := memStats()

    // Empty map still allocates
    m := make(map[string]int)
    _ = m
    fmt.Printf("Empty map: ~%d bytes\n", unsafe.Sizeof(m))

    // Fill with 1 million entries
    m2 := make(map[int]int, 1_000_000)
    for i := 0; i < 1_000_000; i++ {
        m2[i] = i
    }

    after := memStats()
    fmt.Printf("1M int-int entries: ~%d bytes (%d MB)\n",
        after-before, (after-before)/(1024*1024))

    // Maps don't shrink after deletion
    for k := range m2 {
        delete(m2, k)
    }
    afterDelete := memStats()
    fmt.Printf("After deleting all: ~%d bytes\n", afterDelete-before)
    // Memory is NOT released back to OS immediately
}
```

**Key insight:** Maps do not shrink after elements are deleted. If you need to release memory, assign `nil` or create a new map.

---

## 19. Benchmark: Map vs Switch vs Slice

```go
package main

import (
    "fmt"
    "strings"
)

// Simulating what a benchmark would show:
// - For small fixed sets (< ~10 items): switch is fastest
// - For medium sets (10-1000): map is competitive
// - For large sets (1000+): map wins clearly
// - Binary search on sorted slice is between switch and map

func lookupWithMap(m map[string]int, key string) (int, bool) {
    v, ok := m[key]
    return v, ok
}

func lookupWithSwitch(key string) (int, bool) {
    switch key {
    case "apple":
        return 1, true
    case "banana":
        return 2, true
    case "cherry":
        return 3, true
    default:
        return 0, false
    }
}

func main() {
    m := map[string]int{"apple": 1, "banana": 2, "cherry": 3}

    // Both produce same results
    v1, ok1 := lookupWithMap(m, "banana")
    v2, ok2 := lookupWithSwitch("banana")
    fmt.Println(v1, ok1) // 2 true
    fmt.Println(v2, ok2) // 2 true

    _ = strings.ToLower // just to use import
}
```

---

## 20. Evolution of Maps in Go

```
Go 1.0  — Maps introduced, basic hash table
Go 1.1  — Performance improvements to hash table
Go 1.6  — Concurrent map writes detected and panic at runtime
Go 1.12 — Map printing now sorted (fmt.Println output stable)
Go 1.13 — Minor hash improvements
Go 1.18 — No map generics in stdlib yet (added later)
Go 1.21 — maps package added to stdlib (maps.Clone, maps.Copy, etc.)
```

```go
// Go 1.21+ maps package
import "maps"

func main() {
    m := map[string]int{"a": 1, "b": 2}

    // Clone (shallow copy)
    clone := maps.Clone(m)
    clone["c"] = 3
    fmt.Println(m)     // map[a:1 b:2] — original unchanged
    fmt.Println(clone) // map[a:1 b:2 c:3]

    // Copy source into dest
    dest := map[string]int{"x": 10}
    maps.Copy(dest, m) // dest now has x:10, a:1, b:2
    fmt.Println(dest)

    // Equal
    fmt.Println(maps.Equal(m, clone)) // false
}
```

---

## 21. Alternative Approaches

```go
package main

import (
    "fmt"
    "sort"
)

// 1. Sorted slice of pairs (ordered, no map overhead)
type Pair struct{ Key string; Value int }

type OrderedMap []Pair

func (o *OrderedMap) Set(k string, v int) {
    for i, p := range *o {
        if p.Key == k {
            (*o)[i].Value = v
            return
        }
    }
    *o = append(*o, Pair{k, v})
}

func (o OrderedMap) Get(k string) (int, bool) {
    idx := sort.Search(len(o), func(i int) bool { return o[i].Key >= k })
    if idx < len(o) && o[idx].Key == k {
        return o[idx].Value, true
    }
    return 0, false
}

// 2. Struct with known fields (compile-time known set)
type Config struct {
    Host    string
    Port    int
    Timeout int
}

// 3. Two parallel slices (cache-friendly for small N)
type TwoSlices struct {
    keys   []string
    values []int
}

func main() {
    om := &OrderedMap{}
    om.Set("b", 2)
    om.Set("a", 1)
    v, ok := om.Get("a")
    fmt.Println(v, ok) // 1 true
}
```

---

## 22. Anti-Patterns to Avoid

```go
package main

import "fmt"

// ANTI-PATTERN 1: Writing to nil map
func antiPattern1() {
    var m map[string]int
    // m["key"] = 1 // panic! Always use make() or literal

    m = make(map[string]int) // fix
    m["key"] = 1
    fmt.Println(m)
}

// ANTI-PATTERN 2: Using float as key (NaN problem)
// var m = map[float64]string{} // danger!

// ANTI-PATTERN 3: Assuming iteration order
func antiPattern3() {
    m := map[string]int{"a": 1, "b": 2, "c": 3}
    keys := make([]string, 0)
    for k := range m {
        keys = append(keys, k) // order unknown!
    }
    fmt.Println(keys) // different every run
}

// ANTI-PATTERN 4: Map as global mutable state (race condition)
var globalCache = map[string]string{} // unsafe for concurrent use

// ANTI-PATTERN 5: Not using comma-ok when zero is a valid value
func antiPattern5() {
    scores := map[string]int{"Alice": 0}
    if scores["Alice"] == 0 {
        fmt.Println("Alice has no score?") // wrong! Alice scored 0
    }
    if _, ok := scores["Alice"]; !ok {
        fmt.Println("Alice not found") // correct check
    }
}

// ANTI-PATTERN 6: Storing pointers to loop variables
func antiPattern6() {
    m := map[string]*int{}
    for _, v := range []int{1, 2, 3} {
        v := v // shadow to get new variable each iteration
        m[fmt.Sprintf("%d", v)] = &v
    }
    for k, v := range m {
        fmt.Printf("%s: %d\n", k, *v)
    }
}

func main() {
    antiPattern1()
    antiPattern3()
    antiPattern5()
    antiPattern6()
}
```

---

## 23. Debugging Guide

```go
package main

import (
    "fmt"
    "runtime"
)

// Debug helpers

// 1. Detect nil map writes
func debugNilWrite() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("Recovered panic:", r)
            // "assignment to entry in nil map"
        }
    }()

    var m map[string]int
    m["key"] = 1 // panics
}

// 2. Trace map operations
type TracedMap struct {
    data map[string]int
}

func (t *TracedMap) Set(k string, v int) {
    _, file, line, _ := runtime.Caller(1)
    fmt.Printf("[SET] %s=%d called from %s:%d\n", k, v, file, line)
    t.data[k] = v
}

func (t *TracedMap) Get(k string) (int, bool) {
    v, ok := t.data[k]
    if !ok {
        fmt.Printf("[MISS] key %q not found\n", k)
    }
    return v, ok
}

// 3. Check for concurrent access (use -race flag)
// go run -race main.go

// 4. Print map state at any point
func dumpMap(label string, m map[string]int) {
    fmt.Printf("=== %s (len=%d) ===\n", label, len(m))
    for k, v := range m {
        fmt.Printf("  %q: %d\n", k, v)
    }
}

func main() {
    debugNilWrite()

    tm := &TracedMap{data: make(map[string]int)}
    tm.Set("a", 1)
    tm.Get("b") // will print MISS

    m := map[string]int{"x": 10, "y": 20}
    dumpMap("my map", m)
}
```

---

## 24. Language Comparison: Go vs Python/Java/C++

```go
// Go
m := map[string]int{"a": 1}
m["b"] = 2
v, ok := m["a"]
delete(m, "a")
```

```python
# Python dict — ordered since 3.7, can use any hashable key
d = {"a": 1}
d["b"] = 2
v = d.get("a", 0)   # get with default
del d["a"]
"a" in d            # membership test (Go uses comma-ok)
```

```java
// Java HashMap — unordered, keys must implement hashCode/equals
Map<String, Integer> m = new HashMap<>();
m.put("a", 1);
m.put("b", 2);
m.getOrDefault("a", 0);  // with default
m.remove("a");
m.containsKey("a");       // membership test
```

```cpp
// C++ unordered_map — hash-based, similar to Go
std::unordered_map<std::string, int> m;
m["a"] = 1;
auto it = m.find("a");
if (it != m.end()) { /* found */ }
m.erase("a");
// C++ std::map is a RED-BLACK TREE (ordered!) unlike Go
```

**Key differences:**
- Go: No default value syntax — use comma-ok
- Python: `dict.get(key, default)` for defaults
- Java: Requires boxed types (Integer, not int)
- C++ `std::map` is ordered (tree); `unordered_map` is hash-based like Go

---

## 25. Testing Code That Uses Maps

```go
package main

import (
    "fmt"
    "reflect"
    "sort"
)

func wordFrequency(words []string) map[string]int {
    freq := make(map[string]int)
    for _, w := range words {
        freq[w]++
    }
    return freq
}

// Testing map equality
func assertEqual(t interface{ Fatal(...interface{}) }, got, want map[string]int) {
    if !reflect.DeepEqual(got, want) {
        t.Fatal(fmt.Sprintf("got %v, want %v", got, want))
    }
}

// Testing map keys (order-independent)
func assertKeys(got map[string]int, wantKeys []string) bool {
    gotKeys := make([]string, 0, len(got))
    for k := range got {
        gotKeys = append(gotKeys, k)
    }
    sort.Strings(gotKeys)
    sort.Strings(wantKeys)
    return reflect.DeepEqual(gotKeys, wantKeys)
}

func main() {
    freq := wordFrequency([]string{"a", "b", "a", "c", "b", "a"})
    fmt.Println(freq) // map[a:3 b:2 c:1]

    want := map[string]int{"a": 3, "b": 2, "c": 1}
    fmt.Println(reflect.DeepEqual(freq, want)) // true

    hasKeys := assertKeys(freq, []string{"a", "b", "c"})
    fmt.Println(hasKeys) // true
}
```

---

## 26. Maps in Concurrent Systems

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

// Sharded map for high-concurrency
type ShardedMap struct {
    shards [16]struct {
        sync.RWMutex
        data map[string]int
    }
}

func NewShardedMap() *ShardedMap {
    sm := &ShardedMap{}
    for i := range sm.shards {
        sm.shards[i].data = make(map[string]int)
    }
    return sm
}

func (sm *ShardedMap) shard(key string) int {
    h := 0
    for _, c := range key {
        h = h*31 + int(c)
    }
    if h < 0 {
        h = -h
    }
    return h % len(sm.shards)
}

func (sm *ShardedMap) Set(key string, val int) {
    s := sm.shard(key)
    sm.shards[s].Lock()
    sm.shards[s].data[key] = val
    sm.shards[s].Unlock()
}

func (sm *ShardedMap) Get(key string) (int, bool) {
    s := sm.shard(key)
    sm.shards[s].RLock()
    v, ok := sm.shards[s].data[key]
    sm.shards[s].RUnlock()
    return v, ok
}

func main() {
    sm := NewShardedMap()
    var wg sync.WaitGroup
    var written atomic.Int64

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            sm.Set(fmt.Sprintf("key%d", n), n)
            written.Add(1)
        }(i)
    }
    wg.Wait()
    fmt.Println("Written:", written.Load()) // 1000
}
```

---

## 27. Advanced Iteration Techniques

```go
package main

import (
    "fmt"
    "sort"
)

func main() {
    m := map[string]int{"c": 3, "a": 1, "b": 2}

    // Collect and sort by value
    type kv struct{ k string; v int }
    pairs := make([]kv, 0, len(m))
    for k, v := range m {
        pairs = append(pairs, kv{k, v})
    }
    sort.Slice(pairs, func(i, j int) bool {
        return pairs[i].v < pairs[j].v
    })
    for _, p := range pairs {
        fmt.Printf("%s: %d\n", p.k, p.v)
    }
    // a: 1, b: 2, c: 3

    // Early termination simulation
    found := ""
    for k, v := range m {
        if v == 2 {
            found = k
            break
        }
    }
    fmt.Println("Found key with value 2:", found)
}
```

---

## 28. Map Cloning Strategies

```go
package main

import (
    "encoding/json"
    "fmt"
)

// Shallow clone
func shallowClone(m map[string]int) map[string]int {
    clone := make(map[string]int, len(m))
    for k, v := range m {
        clone[k] = v
    }
    return clone
}

// Deep clone of map[string][]int
func deepCloneSliceMap(m map[string][]int) map[string][]int {
    clone := make(map[string][]int, len(m))
    for k, v := range m {
        vc := make([]int, len(v))
        copy(vc, v)
        clone[k] = vc
    }
    return clone
}

// JSON round-trip clone (handles any JSON-serializable type)
func jsonClone(src map[string]interface{}) map[string]interface{} {
    b, _ := json.Marshal(src)
    var dst map[string]interface{}
    json.Unmarshal(b, &dst)
    return dst
}

func main() {
    m := map[string]int{"a": 1, "b": 2}
    c := shallowClone(m)
    c["c"] = 3
    fmt.Println(m) // map[a:1 b:2] — unaffected
    fmt.Println(c) // map[a:1 b:2 c:3]
}
```

---

## 29. Design Patterns Using Maps

```go
package main

import "fmt"

// Registry / Plugin pattern
type Plugin interface {
    Execute(input string) string
}

type PluginRegistry struct {
    plugins map[string]Plugin
}

func (r *PluginRegistry) Register(name string, p Plugin) {
    if r.plugins == nil {
        r.plugins = make(map[string]Plugin)
    }
    r.plugins[name] = p
}

func (r *PluginRegistry) Execute(name, input string) (string, bool) {
    p, ok := r.plugins[name]
    if !ok {
        return "", false
    }
    return p.Execute(input), true
}

type UpperPlugin struct{}
func (u UpperPlugin) Execute(s string) string {
    result := ""
    for _, c := range s {
        if c >= 'a' && c <= 'z' {
            c -= 32
        }
        result += string(c)
    }
    return result
}

func main() {
    reg := &PluginRegistry{}
    reg.Register("upper", UpperPlugin{})

    result, ok := reg.Execute("upper", "hello world")
    fmt.Println(result, ok) // HELLO WORLD true

    _, ok = reg.Execute("missing", "test")
    fmt.Println(ok) // false
}
```

---

## 30. Production Checklist

```
Map Production Checklist:
========================

[ ] Never write to a nil map — always initialize with make() or literal
[ ] Use comma-ok idiom when zero value is a valid result
[ ] Protect map with sync.Mutex/RWMutex in concurrent code
[ ] Pre-size with make(map[K]V, n) when size is known
[ ] Do not use float keys (NaN inequality issue)
[ ] Do not rely on iteration order — sort when needed
[ ] Assign nil or replace map after heavy deletions to free memory
[ ] Use maps.Clone (Go 1.21+) instead of manual copy loops
[ ] Test map-returning functions with reflect.DeepEqual
[ ] Run tests with -race flag to catch concurrent map access
[ ] Consider sync.Map for concurrent read-heavy stable key sets
[ ] Consider sharded maps for very high write concurrency
[ ] Use struct{} not bool for set membership (zero memory value)
[ ] Validate keys before storing (prevent unbounded growth)
[ ] Set a max size or use an LRU cache for cache maps
```

---

*Middle level complete. Covers "why" and "when" with deeper patterns.*
