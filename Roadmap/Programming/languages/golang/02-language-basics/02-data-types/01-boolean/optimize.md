# Boolean — Optimize

## Overview
10+ optimization exercises at varying difficulty. Each includes: description, slow/bad code, hint, and optimized solution.

---

## Exercise 1 — Avoid Redundant Bool Comparisons 🟢

**Description:** Code repeatedly compares booleans to `true`/`false`, adding unnecessary overhead and reducing readability.

**Slow/Bad Code:**
```go
package main

import "fmt"

type User struct {
    IsActive  bool
    IsAdmin   bool
    IsDeleted bool
}

func processUsers(users []User) int {
    count := 0
    for _, u := range users {
        if u.IsActive == true && u.IsAdmin == true && u.IsDeleted == false {
            count++
        }
    }
    return count
}

func main() {
    users := []User{
        {IsActive: true, IsAdmin: true, IsDeleted: false},
        {IsActive: false, IsAdmin: true, IsDeleted: false},
        {IsActive: true, IsAdmin: false, IsDeleted: false},
    }
    fmt.Println(processUsers(users)) // 1
}
```

<details>
<summary>Hint</summary>
`u.IsActive == true` is identical to `u.IsActive`. `u.IsDeleted == false` is identical to `!u.IsDeleted`. Remove the redundant comparisons.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func processUsers(users []User) int {
    count := 0
    for _, u := range users {
        if u.IsActive && u.IsAdmin && !u.IsDeleted {
            count++
        }
    }
    return count
}
```

**Improvement:** More readable, idiomatic, and slightly faster (eliminates unnecessary comparison operations). The compiler may optimize these away, but the code is cleaner for human readers too.
</details>

---

## Exercise 2 — Short-Circuit Order Optimization 🟢

**Description:** Expensive boolean checks are placed before cheap checks in `&&` chains, wasting resources.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "regexp"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

func isValidInput(s string) bool {
    // BAD ORDER: regex (expensive) before length check (cheap)
    return emailRegex.MatchString(s) && len(s) > 0 && len(s) < 255
}

func main() {
    inputs := []string{"", "a", "valid@example.com", "x"}
    for _, input := range inputs {
        fmt.Printf("'%s': %v\n", input, isValidInput(input))
    }
}
```

<details>
<summary>Hint</summary>
`&&` short-circuits left to right. Put the cheapest check first. `len(s) > 0` is O(1) and prevents expensive regex on empty strings.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func isValidInput(s string) bool {
    // OPTIMIZED ORDER: cheap checks first, expensive last
    return len(s) > 0 && len(s) < 255 && emailRegex.MatchString(s)
}
```

**Improvement:** For empty strings (which are invalid), `len(s) > 0` returns false immediately — the expensive regex is never executed. For strings longer than 254 chars (also invalid), the regex is skipped too. Only valid-length strings trigger the regex.

**Benchmark Impact:** For a list with many empty/short invalid strings, this can be orders of magnitude faster.
</details>

---

## Exercise 3 — map[string]bool vs map[string]struct{} for Large Sets 🟢

**Description:** Using `map[string]bool` for a large set wastes memory when you only need presence/absence.

**Slow/Bad Code:**
```go
package main

import "fmt"

func buildBannedIPs(ips []string) map[string]bool {
    banned := make(map[string]bool)
    for _, ip := range ips {
        banned[ip] = true
    }
    return banned
}

func isBanned(banned map[string]bool, ip string) bool {
    return banned[ip]
}

func main() {
    ips := []string{"1.2.3.4", "5.6.7.8", "9.10.11.12"}
    banned := buildBannedIPs(ips)
    fmt.Println(isBanned(banned, "1.2.3.4")) // true
    fmt.Println(isBanned(banned, "0.0.0.0")) // false
}
```

<details>
<summary>Hint</summary>
`map[string]bool` stores 1 byte per value. `map[string]struct{}` stores 0 bytes per value (empty struct). For sets with thousands of entries, this saves meaningful memory.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func buildBannedIPs(ips []string) map[string]struct{} {
    banned := make(map[string]struct{}, len(ips)) // pre-size for performance
    for _, ip := range ips {
        banned[ip] = struct{}{}
    }
    return banned
}

func isBanned(banned map[string]struct{}, ip string) bool {
    _, ok := banned[ip]
    return ok
}
```

**Memory Improvement:**
- `map[string]bool`: ~8 bytes per entry (bool value + alignment)
- `map[string]struct{}`: ~7 bytes per entry (no value stored)

For 1 million IPs: saves ~1MB. Also pre-sizing with `make(map[...], len(ips))` prevents rehashing.

**Note:** Use `map[string]bool` when you genuinely need three-state semantics (true, false, absent). For pure membership testing, use `map[string]struct{}`.
</details>

---

## Exercise 4 — Replace State Booleans with Bitmask 🟡

**Description:** 8 individual boolean fields waste 8 bytes per record; with millions of records, this is significant.

**Slow/Bad Code:**
```go
package main

import "fmt"

type UserFlags struct {
    IsActive    bool
    IsVerified  bool
    IsPremium   bool
    Is2FA       bool
    IsAdmin     bool
    IsSuspended bool
    IsDeleted   bool
    IsEmployee  bool
}

type User struct {
    ID    int
    Flags UserFlags
}

// With 10M users: 10M * 8 bytes = 80MB just for flags
func countActiveVerified(users []User) int {
    count := 0
    for _, u := range users {
        if u.Flags.IsActive && u.Flags.IsVerified {
            count++
        }
    }
    return count
}
```

<details>
<summary>Hint</summary>
Pack 8 booleans into a single `uint8` using bitwise operations. One byte holds 8 flags.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

type UserFlags uint8

const (
    FlagActive    UserFlags = 1 << 0 // 0b00000001
    FlagVerified  UserFlags = 1 << 1 // 0b00000010
    FlagPremium   UserFlags = 1 << 2 // 0b00000100
    Flag2FA       UserFlags = 1 << 3 // 0b00001000
    FlagAdmin     UserFlags = 1 << 4 // 0b00010000
    FlagSuspended UserFlags = 1 << 5 // 0b00100000
    FlagDeleted   UserFlags = 1 << 6 // 0b01000000
    FlagEmployee  UserFlags = 1 << 7 // 0b10000000
)

func (f UserFlags) Has(flag UserFlags) bool { return f&flag != 0 }
func (f *UserFlags) Set(flag UserFlags)     { *f |= flag }
func (f *UserFlags) Clear(flag UserFlags)   { *f &^= flag }

type User struct {
    ID    int
    Flags UserFlags // 1 byte instead of 8
}

func countActiveVerified(users []User) int {
    count := 0
    needed := FlagActive | FlagVerified
    for _, u := range users {
        if u.Flags&needed == needed { // single bitwise AND, very fast
            count++
        }
    }
    return count
}

func main() {
    u := User{ID: 1}
    u.Flags.Set(FlagActive | FlagVerified | FlagPremium)
    fmt.Println(u.Flags.Has(FlagActive))   // true
    fmt.Println(u.Flags.Has(FlagAdmin))    // false
}
```

**Memory:** 10M users: 80MB → 10MB (8x reduction). Bitwise operations are also faster than struct field access due to cache efficiency.
</details>

---

## Exercise 5 — Eliminate Redundant Boolean Computation in Loop 🟡

**Description:** A boolean expression that doesn't change across iterations is computed inside the loop on every iteration.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "os"
)

func processLines(lines []string) []string {
    var result []string
    for _, line := range lines {
        // BUG: os.Getenv called on EVERY iteration — expensive!
        if os.Getenv("ENABLE_PROCESSING") == "true" && len(line) > 0 {
            result = append(result, line)
        }
    }
    return result
}

func main() {
    lines := make([]string, 100000)
    for i := range lines {
        lines[i] = fmt.Sprintf("line %d", i)
    }
    result := processLines(lines)
    fmt.Println(len(result))
}
```

<details>
<summary>Hint</summary>
`os.Getenv` involves a syscall and doesn't change during the loop. Compute it once before the loop and store in a variable.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func processLines(lines []string) []string {
    // Compute once before the loop
    enabled := os.Getenv("ENABLE_PROCESSING") == "true"
    if !enabled {
        return nil // fast path: no processing needed
    }

    result := make([]string, 0, len(lines)) // pre-allocate
    for _, line := range lines {
        if len(line) > 0 {
            result = append(result, line)
        }
    }
    return result
}
```

**Improvement:**
1. `os.Getenv` called once instead of N times
2. Fast path: if disabled, return immediately
3. Pre-allocated slice avoids repeated allocation
4. Inner loop condition simplified

**Benchmark:** For 100K iterations, removes 100K syscall calls.
</details>

---

## Exercise 6 — Branch-Free Boolean to Int Conversion 🟡

**Description:** Converting boolean to 0/1 integer using a branch is slower than direct assignment in tight loops.

**Slow/Bad Code:**
```go
package main

import "fmt"

func countTrueValues(flags []bool) int {
    count := 0
    for _, f := range flags {
        if f {
            count++ // branch: jump instruction, potential misprediction
        }
    }
    return count
}

func main() {
    flags := make([]bool, 1000000)
    for i := range flags {
        flags[i] = i%3 == 0 // 1/3 true
    }
    fmt.Println(countTrueValues(flags))
}
```

<details>
<summary>Hint</summary>
Boolean values in Go are stored as 0 or 1. You can use `*(*byte)(unsafe.Pointer(&f))` or let the compiler generate branchless code with proper casting hints.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "unsafe"
)

// Option 1: Let compiler generate branchless code (idiomatic)
func countTrueValues(flags []bool) int {
    count := 0
    for _, f := range flags {
        // Modern Go compilers often optimize this to SETCC + ADD (no branch)
        if f {
            count++
        }
    }
    return count
}

// Option 2: Explicit branchless (when profiling confirms it helps)
func countTrueValuesFast(flags []bool) int {
    count := 0
    for i := range flags {
        // Read bool as byte directly: 0 or 1
        count += int(*(*byte)(unsafe.Pointer(&flags[i])))
    }
    return count
}

func main() {
    flags := make([]bool, 1000000)
    for i := range flags {
        flags[i] = i%3 == 0
    }
    fmt.Println(countTrueValues(flags))
    fmt.Println(countTrueValuesFast(flags))
}
```

**Note:** The `unsafe` version is only justified if profiling shows the branch is a bottleneck. The idiomatic version often compiles to branchless code anyway due to compiler optimizations. Always benchmark before using unsafe.
</details>

---

## Exercise 7 — Avoid Repeated Logic in Boolean Expressions 🟡

**Description:** The same expensive boolean expression is evaluated multiple times.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "strings"
)

func handleRequest(username, email, action string) {
    // isValidUser computed TWICE
    if strings.Contains(email, "@") && len(username) > 2 && action != "" {
        fmt.Printf("Processing %s for %s\n", action, username)
    }

    if strings.Contains(email, "@") && len(username) > 2 {
        fmt.Printf("Logging action for %s\n", username)
    }

    if strings.Contains(email, "@") && len(username) > 2 && action == "delete" {
        fmt.Printf("Audit: delete by %s\n", username)
    }
}
```

<details>
<summary>Hint</summary>
Extract the repeated boolean expression into a named variable. This evaluates it once and makes the code more readable.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func handleRequest(username, email, action string) {
    isValidUser := strings.Contains(email, "@") && len(username) > 2

    if isValidUser && action != "" {
        fmt.Printf("Processing %s for %s\n", action, username)
    }

    if isValidUser {
        fmt.Printf("Logging action for %s\n", username)
    }

    if isValidUser && action == "delete" {
        fmt.Printf("Audit: delete by %s\n", username)
    }
}
```

**Improvement:** `strings.Contains` and `len` are called once instead of 3 times each. Named variable `isValidUser` also makes the intent clearer.
</details>

---

## Exercise 8 — Sorted Data for Branch Prediction 🔴

**Description:** Processing a slice of bool fields in random order causes branch mispredictions. Sorting first improves CPU branch prediction.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "math/rand"
)

type Record struct {
    IsActive bool
    Data     int
}

func sumActiveData(records []Record) int64 {
    var sum int64
    for _, r := range records {
        if r.IsActive { // random true/false = ~50% misprediction rate
            sum += int64(r.Data)
        }
    }
    return sum
}

func main() {
    n := 1000000
    records := make([]Record, n)
    for i := range records {
        records[i] = Record{IsActive: rand.Intn(2) == 0, Data: i}
    }
    fmt.Println(sumActiveData(records))
}
```

<details>
<summary>Hint</summary>
CPU branch predictors work best with predictable patterns. If you sort records so all active ones come first, the branch becomes predictable: many trues, then many falses. This reduces misprediction penalty (~15 CPU cycles each).
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "math/rand"
    "sort"
    "testing"
)

type Record struct {
    IsActive bool
    Data     int
}

func sumActiveData(records []Record) int64 {
    var sum int64
    for _, r := range records {
        if r.IsActive {
            sum += int64(r.Data)
        }
    }
    return sum
}

func sumActiveDataSorted(records []Record) int64 {
    // Sort: active records first
    sort.Slice(records, func(i, j int) bool {
        return records[i].IsActive && !records[j].IsActive
    })
    return sumActiveData(records)
}

// Alternative: two-pass approach (avoids sort overhead)
func sumActiveDataTwoPass(records []Record) int64 {
    var sum int64
    for _, r := range records {
        if r.IsActive {
            sum += int64(r.Data)
        }
        // Second pass processes inactive — but the branch is now predictable
        // in each pass
    }
    return sum
}

func BenchmarkUnsorted(b *testing.B) {
    records := makeRandomRecords(100000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sumActiveData(records)
    }
}

func BenchmarkSorted(b *testing.B) {
    records := makeRandomRecords(100000)
    sort.Slice(records, func(i, j int) bool {
        return records[i].IsActive && !records[j].IsActive
    })
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sumActiveData(records)
    }
}

func makeRandomRecords(n int) []Record {
    records := make([]Record, n)
    for i := range records {
        records[i] = Record{IsActive: rand.Intn(2) == 0, Data: i}
    }
    return records
}

func main() {
    records := makeRandomRecords(1000000)
    fmt.Println(sumActiveData(records))
}
```

**Note:** Whether sorting helps depends on:
1. The proportion of true/false values
2. The size of the data
3. Whether the sort cost is amortized over multiple passes

For single-pass processing, sorting first is only beneficial when the sort can be done once and reused.
</details>

---

## Exercise 9 — Lazy Boolean Evaluation with Function Type 🔴

**Description:** Multiple expensive checks are computed eagerly even when only one is needed.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "time"
)

func checkDatabaseHealth() bool {
    time.Sleep(10 * time.Millisecond) // simulate slow check
    return true
}

func checkCacheHealth() bool {
    time.Sleep(5 * time.Millisecond) // simulate slow check
    return true
}

func checkExternalAPIHealth() bool {
    time.Sleep(20 * time.Millisecond) // simulate slow check
    return true
}

func isSystemHealthy() bool {
    // BAD: all checks run even if the first fails
    dbOK := checkDatabaseHealth()
    cacheOK := checkCacheHealth()
    apiOK := checkExternalAPIHealth()
    return dbOK && cacheOK && apiOK
}

func main() {
    start := time.Now()
    fmt.Println("Healthy:", isSystemHealthy())
    fmt.Println("Duration:", time.Since(start)) // ~35ms — all three ran
}
```

<details>
<summary>Hint</summary>
Evaluate checks lazily using function types. Pass functions instead of values — they're only called when needed.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "time"
)

func checkDatabaseHealth() bool {
    time.Sleep(10 * time.Millisecond)
    return true
}

func checkCacheHealth() bool {
    time.Sleep(5 * time.Millisecond)
    return false // Cache is unhealthy
}

func checkExternalAPIHealth() bool {
    time.Sleep(20 * time.Millisecond) // This won't run if cache fails
    return true
}

// Option 1: Use short-circuit directly (simplest)
func isSystemHealthyFast() bool {
    return checkDatabaseHealth() && checkCacheHealth() && checkExternalAPIHealth()
    // If checkCacheHealth returns false, checkExternalAPIHealth is NOT called
}

// Option 2: Lazy checks with function slice
func allChecksPass(checks ...func() bool) bool {
    for _, check := range checks {
        if !check() {
            return false // stop at first failure
        }
    }
    return true
}

func main() {
    start := time.Now()
    // Cache fails, so API check is skipped
    healthy := allChecksPass(
        checkDatabaseHealth,   // 10ms
        checkCacheHealth,      // 5ms → returns false
        checkExternalAPIHealth, // SKIPPED
    )
    fmt.Println("Healthy:", healthy)
    fmt.Println("Duration:", time.Since(start)) // ~15ms, not 35ms
}
```

**Improvement:** By passing function references and using short-circuit evaluation, the expensive API check (20ms) is skipped when the cache check fails. Total time: ~15ms instead of ~35ms.
</details>

---

## Exercise 10 — Eliminate Boolean Allocation in Interface Wrapping 🔴

**Description:** Wrapping booleans in `interface{}` in a tight loop causes repeated allocations.

**Slow/Bad Code:**
```go
package main

import "fmt"

func logFields(fields map[string]interface{}) {
    // Simplified logging
    for k, v := range fields {
        fmt.Printf("%s=%v ", k, v)
    }
    fmt.Println()
}

func processBatch(items []string, debug bool) {
    for _, item := range items {
        // BAD: wrapping bool in interface{} may allocate in tight loop
        logFields(map[string]interface{}{
            "item":  item,
            "debug": debug, // bool → interface{} wrapping
        })
    }
}

func main() {
    items := []string{"a", "b", "c"}
    processBatch(items, true)
}
```

<details>
<summary>Hint</summary>
The compiler has a special optimization: wrapping `true` and `false` in `interface{}` uses static data (no heap allocation). However, map literals in loops allocate on each iteration. Pre-compute or restructure.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

// Option 1: Use a structured log type instead of map
type LogEntry struct {
    Item  string
    Debug bool
}

func (e LogEntry) Log() {
    fmt.Printf("item=%s debug=%v\n", e.Item, e.Debug)
}

func processBatch(items []string, debug bool) {
    for _, item := range items {
        // No allocation: struct is stack-allocated
        entry := LogEntry{Item: item, Debug: debug}
        entry.Log()
    }
}

// Option 2: Pre-evaluate the debug string once
func processBatchFast(items []string, debug bool) {
    debugStr := "false"
    if debug {
        debugStr = "true"
    }
    for _, item := range items {
        // No bool→interface conversion, no map allocation
        fmt.Printf("item=%s debug=%s\n", item, debugStr)
    }
}

func main() {
    items := []string{"a", "b", "c"}
    processBatch(items, true)
    processBatchFast(items, false)
}
```

**Improvement:**
- Removes per-iteration map allocation
- Struct-based logging is zero-allocation when fields don't escape
- Pre-computed debug string avoids repeated bool→interface conversion

**Benchmark:** For tight loops, this eliminates GC pressure and reduces latency spikes.
</details>

---

## Exercise 11 — Pre-Compute Boolean Conditions for Filters 🔴

**Description:** A filter function re-evaluates complex boolean conditions for every element, even though some conditions are constant across the entire filter operation.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "os"
    "strings"
)

type Event struct {
    Type    string
    Source  string
    Payload string
}

func filterEvents(events []Event) []Event {
    var result []Event
    for _, e := range events {
        // These checks happen N times but could be computed once:
        isDebug := os.Getenv("DEBUG") == "true"
        allowedSources := strings.Split(os.Getenv("ALLOWED_SOURCES"), ",")

        sourceAllowed := false
        for _, s := range allowedSources {
            if e.Source == strings.TrimSpace(s) {
                sourceAllowed = true
                break
            }
        }

        if (isDebug || e.Type != "debug") && sourceAllowed {
            result = append(result, e)
        }
    }
    return result
}

func main() {
    os.Setenv("DEBUG", "false")
    os.Setenv("ALLOWED_SOURCES", "web, mobile, api")

    events := make([]Event, 10000)
    for i := range events {
        events[i] = Event{Type: "info", Source: "web", Payload: "data"}
    }
    fmt.Println(len(filterEvents(events)))
}
```

<details>
<summary>Hint</summary>
Extract all constant computations (env vars, config parsing) outside the loop. Build a lookup set for allowed sources.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "os"
    "strings"
)

type Event struct {
    Type    string
    Source  string
    Payload string
}

type EventFilter struct {
    IsDebug        bool
    AllowedSources map[string]struct{} // O(1) lookup
}

func NewEventFilter() EventFilter {
    isDebug := os.Getenv("DEBUG") == "true" // computed ONCE

    sources := strings.Split(os.Getenv("ALLOWED_SOURCES"), ",")
    allowedSources := make(map[string]struct{}, len(sources))
    for _, s := range sources {
        allowedSources[strings.TrimSpace(s)] = struct{}{} // built ONCE
    }

    return EventFilter{IsDebug: isDebug, AllowedSources: allowedSources}
}

func (f EventFilter) Matches(e Event) bool {
    _, sourceOK := f.AllowedSources[e.Source] // O(1) map lookup
    return sourceOK && (f.IsDebug || e.Type != "debug")
}

func filterEvents(events []Event) []Event {
    filter := NewEventFilter() // setup ONCE

    result := make([]Event, 0, len(events)/2) // pre-allocate estimate
    for _, e := range events {
        if filter.Matches(e) { // fast per-event check
            result = append(result, e)
        }
    }
    return result
}

func main() {
    os.Setenv("DEBUG", "false")
    os.Setenv("ALLOWED_SOURCES", "web, mobile, api")

    events := make([]Event, 10000)
    for i := range events {
        events[i] = Event{Type: "info", Source: "web", Payload: "data"}
    }
    fmt.Println(len(filterEvents(events)))
}
```

**Improvements:**
1. `os.Getenv` called once, not N times
2. Source parsing done once, not N times
3. Linear source search (O(N)) replaced with O(1) map lookup
4. Pre-allocated result slice
5. Filter logic encapsulated in a clean struct
</details>
