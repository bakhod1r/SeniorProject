# Go Maps — Find the Bug

Each exercise contains buggy code. Find the bug, understand why it's wrong, then check the hint and solution.

**Difficulty:** 🟢 Easy | 🟡 Medium | 🔴 Hard

---

## Bug 1 — Writing to nil map 🟢

```go
package main

import "fmt"

func buildIndex(words []string) map[string]int {
    var index map[string]int
    for i, w := range words {
        index[w] = i
    }
    return index
}

func main() {
    idx := buildIndex([]string{"hello", "world"})
    fmt.Println(idx)
}
```

**What happens when you run this?**

<details>
<summary>Hint</summary>

Look at how `index` is declared. What is its value before any assignment?

</details>

<details>
<summary>Solution</summary>

**Bug:** `var index map[string]int` declares a nil map. Writing to a nil map panics: `assignment to entry in nil map`.

**Fix:**
```go
func buildIndex(words []string) map[string]int {
    index := make(map[string]int, len(words)) // initialize first!
    for i, w := range words {
        index[w] = i
    }
    return index
}
```

**Rule:** Always initialize a map before writing. `make(map[K]V)` or `map[K]V{}` both work.

</details>

---

## Bug 2 — Assuming key exists (no comma-ok) 🟢

```go
package main

import "fmt"

func isAdmin(roles map[string]string, username string) bool {
    return roles[username] == "admin"
}

func main() {
    roles := map[string]string{
        "alice": "admin",
        "bob":   "user",
    }

    // Is "charlie" an admin?
    fmt.Println(isAdmin(roles, "charlie")) // false — correct?
    // Is "" (empty string role) an admin?
    emptyRoles := map[string]string{"dave": ""}
    fmt.Println(isAdmin(emptyRoles, "dave"))   // false — but dave IS in the map!
    fmt.Println(isAdmin(emptyRoles, "missing")) // false — same result, confusing!
}
```

**What is the logical bug?**

<details>
<summary>Hint</summary>

The function returns the same result for "user not found" and "user found with empty role". Is that correct?

</details>

<details>
<summary>Solution</summary>

**Bug:** `roles[username]` returns the zero value (`""`) for missing keys. So "user not found" and "user found with empty string role" produce the same result. In this case, it accidentally works correctly (neither is "admin"), but the design is fragile.

A worse version of the same bug:

```go
// Bug: treats missing key same as key with zero value
func getScore(scores map[string]int, user string) int {
    return scores[user] // returns 0 for both "no score" and "score is 0"
}
```

**Fix:**
```go
func isAdmin(roles map[string]string, username string) bool {
    role, ok := roles[username]
    return ok && role == "admin"
}

// Or for the score case:
func getScore(scores map[string]int, user string) (int, bool) {
    score, ok := scores[user]
    return score, ok
}
```

</details>

---

## Bug 3 — Concurrent map write panic 🟢

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    cache := make(map[string]int)
    var wg sync.WaitGroup

    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            key := fmt.Sprintf("key%d", n)
            cache[key] = n // concurrent write!
        }(i)
    }

    wg.Wait()
    fmt.Println(len(cache))
}
```

**What happens when you run this with `go run -race`?**

<details>
<summary>Hint</summary>

Multiple goroutines are writing to the same map simultaneously. Maps are not thread-safe.

</details>

<details>
<summary>Solution</summary>

**Bug:** Multiple goroutines write to `cache` concurrently without synchronization. This causes a data race and may result in a fatal "concurrent map writes" error.

**Fix using sync.Mutex:**
```go
func main() {
    var mu sync.Mutex
    cache := make(map[string]int)
    var wg sync.WaitGroup

    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            key := fmt.Sprintf("key%d", n)
            mu.Lock()
            cache[key] = n
            mu.Unlock()
        }(i)
    }

    wg.Wait()
    fmt.Println(len(cache)) // 10
}
```

**Fix using sync.Map:**
```go
var cache sync.Map
go func(n int) {
    cache.Store(fmt.Sprintf("key%d", n), n)
}(i)
```

</details>

---

## Bug 4 — Map copy is shallow 🟢

```go
package main

import "fmt"

func addDefaults(config map[string]int) map[string]int {
    defaults := config // "copy" the config
    defaults["timeout"] = 30
    defaults["retries"] = 3
    return defaults
}

func main() {
    userConfig := map[string]int{"port": 8080}
    finalConfig := addDefaults(userConfig)

    fmt.Println("User config:", userConfig)
    // Expected: map[port:8080]
    // Actual?
    fmt.Println("Final config:", finalConfig)
}
```

**What does `userConfig` contain after `addDefaults`?**

<details>
<summary>Hint</summary>

Maps are reference types. What happens when you assign a map to a new variable?

</details>

<details>
<summary>Solution</summary>

**Bug:** `defaults := config` does NOT copy the map. Both `defaults` and `config` (which is the same as `userConfig` in main) point to the same underlying map. Modifications to `defaults` affect `userConfig`.

**Output:**
```
User config: map[port:8080 retries:3 timeout:30]  ← modified!
Final config: map[port:8080 retries:3 timeout:30]
```

**Fix — true copy:**
```go
func addDefaults(config map[string]int) map[string]int {
    result := make(map[string]int, len(config)+2)
    for k, v := range config {
        result[k] = v  // copy each entry
    }
    result["timeout"] = 30
    result["retries"] = 3
    return result
}
```

Or with Go 1.21+:
```go
import "maps"
result := maps.Clone(config)
result["timeout"] = 30
```

</details>

---

## Bug 5 — Relying on map iteration order 🟡

```go
package main

import (
    "fmt"
    "strings"
)

func buildCSV(data map[string]string) string {
    var parts []string
    for k, v := range data {
        parts = append(parts, k+"="+v)
    }
    return strings.Join(parts, ",")
}

func main() {
    data := map[string]string{
        "name":  "Alice",
        "age":   "30",
        "email": "alice@example.com",
    }

    csv1 := buildCSV(data)
    csv2 := buildCSV(data)

    fmt.Println(csv1 == csv2) // Not always true!
    fmt.Println(csv1)
}
```

**What is wrong with using this CSV in a signature verification system?**

<details>
<summary>Hint</summary>

Run the program multiple times. Is the output always the same?

</details>

<details>
<summary>Solution</summary>

**Bug:** Map iteration order is random. `buildCSV` produces different strings on different runs:
- Run 1: `name=Alice,age=30,email=alice@example.com`
- Run 2: `email=alice@example.com,name=Alice,age=30`
- Run 3: `age=30,email=alice@example.com,name=Alice`

This breaks any system that relies on consistent ordering (signatures, hashes, caching).

**Fix — sort keys first:**
```go
import "sort"

func buildCSV(data map[string]string) string {
    keys := make([]string, 0, len(data))
    for k := range data {
        keys = append(keys, k)
    }
    sort.Strings(keys)

    parts := make([]string, 0, len(keys))
    for _, k := range keys {
        parts = append(parts, k+"="+data[k])
    }
    return strings.Join(parts, ",")
}
```

Now `buildCSV(data)` always produces the same canonical string.

</details>

---

## Bug 6 — Nested map: nil inner map 🟡

```go
package main

import "fmt"

func main() {
    // Store user permissions: userID → action → allowed
    permissions := map[string]map[string]bool{}

    // Grant alice read access
    permissions["alice"]["read"] = true // panic!

    fmt.Println(permissions)
}
```

**Why does this panic?**

<details>
<summary>Hint</summary>

When you access `permissions["alice"]`, what do you get for a missing key? And what happens when you try to write to it?

</details>

<details>
<summary>Solution</summary>

**Bug:** `permissions["alice"]` returns the zero value for `map[string]bool`, which is `nil`. Writing to `nil["read"]` panics.

**Fix — initialize inner map first:**
```go
func main() {
    permissions := map[string]map[string]bool{}

    // Method 1: initialize explicitly
    if permissions["alice"] == nil {
        permissions["alice"] = make(map[string]bool)
    }
    permissions["alice"]["read"] = true

    // Method 2: helper function
    grant(permissions, "bob", "write")

    fmt.Println(permissions)
}

func grant(perms map[string]map[string]bool, user, action string) {
    if perms[user] == nil {
        perms[user] = make(map[string]bool)
    }
    perms[user][action] = true
}
```

</details>

---

## Bug 7 — NaN float64 key 🟡

```go
package main

import (
    "fmt"
    "math"
    "strconv"
)

func parseAndStore(m map[float64]string, input string, label string) {
    val, err := strconv.ParseFloat(input, 64)
    if err != nil {
        val = math.NaN() // use NaN for invalid inputs
    }
    m[val] = label
}

func main() {
    readings := map[float64]string{}

    parseAndStore(readings, "98.6", "normal")
    parseAndStore(readings, "invalid", "error1")
    parseAndStore(readings, "also-invalid", "error2")

    fmt.Println("Count:", len(readings)) // expect 3? what actually?

    // Try to find errors
    v, ok := readings[math.NaN()]
    fmt.Println("Found error:", v, ok) // expect "error1"? what actually?
}
```

**What are the two bugs caused by using NaN as a map key?**

<details>
<summary>Hint</summary>

`NaN != NaN` in IEEE 754. What does that mean for map lookup and storage?

</details>

<details>
<summary>Solution</summary>

**Bug 1:** Every `m[NaN] = x` creates a NEW entry because NaN is never equal to any existing key (including another NaN). So both "error1" and "error2" are stored as separate entries, but there's no way to access either.

**Bug 2:** `readings[math.NaN()]` always returns `("", false)` because the lookup can never match any existing NaN key.

Result: `len(readings) == 3` but 2 of those entries are phantom entries that can never be retrieved. This is a memory leak.

**Fix:**
```go
func parseAndStore(m map[string]string, input string, label string) {
    // Use a sentinel string key for errors, not NaN
    val, err := strconv.ParseFloat(input, 64)
    if err != nil || math.IsNaN(val) {
        // Handle error case appropriately
        fmt.Printf("Invalid input %q for label %q\n", input, label)
        return
    }
    m[strconv.FormatFloat(val, 'f', -1, 64)] = label
}
```

**Rule:** Never use `float64` as a map key. If you must, validate that the value is not NaN first: `if math.IsNaN(val) { ... }`.

</details>

---

## Bug 8 — Capturing loop variable in map value 🟡

```go
package main

import "fmt"

func main() {
    callbacks := map[string]func(){}

    actions := []string{"start", "stop", "restart"}
    for _, action := range actions {
        callbacks[action] = func() {
            fmt.Println("Executing:", action) // captures loop variable!
        }
    }

    // Execute all callbacks
    for name, cb := range callbacks {
        fmt.Printf("Calling %s: ", name)
        cb()
    }
}
```

**What will the output be? Is it what you expect?**

<details>
<summary>Hint</summary>

The closure captures the variable `action`, not its value at the time of closure creation. By the time the callbacks are called, what is `action`'s value?

</details>

<details>
<summary>Solution</summary>

**Bug:** All closures capture the same `action` variable. By the time the callbacks run, the loop has finished and `action` holds its last value: `"restart"`.

**Output (approximately):**
```
Calling start: Executing: restart
Calling stop: Executing: restart
Calling restart: Executing: restart
```

All three print "restart"!

**Fix — shadow the variable inside the loop:**
```go
for _, action := range actions {
    action := action // new variable per iteration (Go 1.22+: automatic)
    callbacks[action] = func() {
        fmt.Println("Executing:", action) // captures its own copy
    }
}
```

Or pass as parameter:
```go
makeCallback := func(a string) func() {
    return func() { fmt.Println("Executing:", a) }
}
for _, action := range actions {
    callbacks[action] = makeCallback(action)
}
```

Note: Go 1.22+ fixes this by making loop variables per-iteration automatically.

</details>

---

## Bug 9 — Deleting map entries during aggregation 🔴

```go
package main

import "fmt"

// Remove all entries with value below threshold, then return remaining sum
func filterAndSum(m map[string]int, threshold int) int {
    for k, v := range m {
        if v < threshold {
            delete(m, k)
        }
    }

    // Now sum the remaining entries
    total := 0
    for _, v := range m {
        total += v
    }
    return total
}

func main() {
    scores := map[string]int{
        "alice": 90, "bob": 45, "carol": 80, "dave": 30, "eve": 70,
    }

    sum := filterAndSum(scores, 60)
    fmt.Println("Sum of passing scores:", sum)
    fmt.Println("Remaining entries:", scores)
    // Is the deletion during range loop safe?
    // Is the result correct?
}
```

**Is the deletion during range safe? Is the overall design correct?**

<details>
<summary>Hint</summary>

Deletion during range is safe. But think about what happens to `scores` after the function returns.

</details>

<details>
<summary>Solution</summary>

**Bug:** The deletion during range IS safe in Go. However, `filterAndSum` has a side effect: it **permanently modifies the caller's map**. The function's behavior is surprising to callers who don't expect their map to be mutated.

After calling `filterAndSum(scores, 60)`:
- `scores` has been permanently modified (bob and dave are deleted)
- The caller can no longer recover the original data

**Fix — don't modify the input:**
```go
func filterAndSum(m map[string]int, threshold int) (int, map[string]int) {
    result := make(map[string]int)
    total := 0
    for k, v := range m {
        if v >= threshold {
            result[k] = v
            total += v
        }
    }
    return total, result
}

func main() {
    scores := map[string]int{
        "alice": 90, "bob": 45, "carol": 80, "dave": 30, "eve": 70,
    }

    sum, passing := filterAndSum(scores, 60)
    fmt.Println("Sum:", sum)
    fmt.Println("Passing:", passing)
    fmt.Println("Original:", scores) // unchanged
}
```

**Rule:** Functions that accept maps should document whether they modify the map. Prefer returning a new filtered map rather than mutating the input.

</details>

---

## Bug 10 — sync.Map type assertion trap 🔴

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var sm sync.Map

    sm.Store("count", 0)

    // Increment count 100 times concurrently
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // Atomic increment pattern (wrong!)
            v, _ := sm.Load("count")
            sm.Store("count", v.(int)+1)
        }()
    }
    wg.Wait()

    v, _ := sm.Load("count")
    fmt.Println("Final count:", v.(int)) // expected 100, what do we get?
}
```

**Why doesn't this reach 100? What is the correct approach?**

<details>
<summary>Hint</summary>

`sync.Map` makes individual Store/Load calls safe, but does it make the read-modify-write SEQUENCE atomic?

</details>

<details>
<summary>Solution</summary>

**Bug:** Even with `sync.Map`, the sequence `Load → compute new value → Store` is NOT atomic. Two goroutines can both load the same value (e.g., 50), both compute 51, and both store 51 — losing one increment.

This is a classic **check-then-act** race condition. `sync.Map` prevents data corruption but not logical races.

**Fix 1 — Use `sync/atomic` for counter:**
```go
var counter int64
go func() {
    atomic.AddInt64(&counter, 1)
}()
```

**Fix 2 — Use `sync.Map.CompareAndSwap` (Go 1.20+):**
```go
for {
    old, _ := sm.Load("count")
    if sm.CompareAndSwap("count", old, old.(int)+1) {
        break // successfully incremented
    }
    // retry if someone else changed it
}
```

**Fix 3 — Use regular map with Mutex:**
```go
var mu sync.Mutex
count := 0
mu.Lock()
count++
mu.Unlock()
```

**Lesson:** `sync.Map` ensures thread-safe access to individual operations but does not provide transactional semantics across multiple operations. Use `CompareAndSwap` for atomic read-modify-write patterns.

</details>

---

## Bug 11 — Memory not released after heavy deletions 🔴

```go
package main

import (
    "fmt"
    "runtime"
)

func memUsage() uint64 {
    var ms runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&ms)
    return ms.Alloc
}

func main() {
    before := memUsage()

    // Build large map
    cache := make(map[int][]byte)
    for i := 0; i < 100_000; i++ {
        cache[i] = make([]byte, 1024) // 1KB per entry
    }

    after := memUsage()
    fmt.Printf("After fill: +%d MB\n", (after-before)/(1024*1024))

    // "Clear" the cache
    for k := range cache {
        delete(cache, k)
    }

    afterDelete := memUsage()
    fmt.Printf("After delete: +%d MB\n", (afterDelete-before)/(1024*1024))
    // Bug: memory is still high! Why?

    // Supposedly cleared, but map still holds buckets
    fmt.Println("Cache len:", len(cache)) // 0
}
```

**Why is memory still high after deleting all entries?**

<details>
<summary>Hint</summary>

What does `delete` actually do to a map's internal bucket array?

</details>

<details>
<summary>Solution</summary>

**Bug:** `delete` marks slots as empty but does NOT free the bucket array. After deleting 100,000 entries, the map still holds ~100,000/8 ≈ 12,500 allocated buckets plus all the now-unreachable `[]byte` values waiting for GC.

However, the `[]byte` values (the 1KB slices) ARE eligible for GC after delete — GC will collect those. But the bucket array itself remains allocated until the map is replaced.

**Fix — replace the map:**
```go
// Clear the cache properly
for k := range cache {
    delete(cache, k)
}
cache = make(map[int][]byte) // replace with fresh empty map

// Or simply:
cache = nil  // make entire map GC-eligible

runtime.GC() // force GC for demonstration
afterFix := memUsage()
fmt.Printf("After fix: +%d MB\n", (afterFix-before)/(1024*1024))
```

**When it matters:** Long-lived servers with maps that grow large then shrink repeatedly. The bucket array grows with the map but never returns that memory. If this pattern repeats, use a fresh map at regular intervals.

</details>

---

## Bug 12 — Race on global dispatch table 🔴

```go
package main

import (
    "fmt"
    "net/http"
    "sync"
)

// Global dispatch table — looks safe because it's "read-only" after init
var routes = map[string]http.HandlerFunc{}

func registerRoute(path string, handler http.HandlerFunc) {
    routes[path] = handler // "initialization"
}

func init() {
    registerRoute("/health", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "OK")
    })
}

func handleRequest(w http.ResponseWriter, r *http.Request) {
    if handler, ok := routes[r.URL.Path]; ok {
        handler(w, r)
    }
}

// Meanwhile, in a plugin system...
func loadPlugin(path string, handler http.HandlerFunc) {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        registerRoute(path, handler) // concurrent write while handlers read!
    }()
    wg.Wait()
}

func main() {
    fmt.Println("Routes:", len(routes))
    // Is this safe for concurrent use?
}
```

**What race condition exists here?**

<details>
<summary>Hint</summary>

If `loadPlugin` is called while HTTP handlers are being served, what happens?

</details>

<details>
<summary>Solution</summary>

**Bug:** `routes` is accessed by `handleRequest` (readers, multiple goroutines from HTTP server) and by `registerRoute` (writer, called from `loadPlugin` goroutine) simultaneously. This is a data race on the global map.

The "read-only after init" assumption breaks when plugins can dynamically register routes.

**Fix — protect with RWMutex:**
```go
var (
    routesMu sync.RWMutex
    routes   = map[string]http.HandlerFunc{}
)

func registerRoute(path string, handler http.HandlerFunc) {
    routesMu.Lock()
    defer routesMu.Unlock()
    routes[path] = handler
}

func handleRequest(w http.ResponseWriter, r *http.Request) {
    routesMu.RLock()
    handler, ok := routes[r.URL.Path]
    routesMu.RUnlock()
    if ok {
        handler(w, r)
    }
}
```

Or use a copy-on-write approach where routes are frozen after initialization and plugins get their own isolated route table.

**Alternative:** Build all routes before starting the server, then treat `routes` as truly read-only during serving.

</details>
