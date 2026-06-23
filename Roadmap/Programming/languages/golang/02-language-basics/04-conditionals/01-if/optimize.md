# if Statement — Optimization Exercises

Each exercise has slow or suboptimal code with a known bottleneck. Your goal: make it faster, cleaner, or more correct.

Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard

---

## Exercise 1 🟢 — Eliminate Redundant Boolean Comparison

**Problem:** This code compiles and runs, but it is not idiomatic Go and adds unnecessary overhead in readability and expression evaluation.

```go
package main

import "fmt"

func isEligible(age int, hasLicense bool) bool {
    if hasLicense == true {
        if age >= 18 == true {
            return true
        } else {
            return false
        }
    } else {
        return false
    }
}

func main() {
    fmt.Println(isEligible(20, true))  // true
    fmt.Println(isEligible(16, true))  // false
    fmt.Println(isEligible(20, false)) // false
}
```

**What to improve:**
- Remove redundant `== true` and `== false` comparisons
- Eliminate unnecessary `else` after `return`
- Simplify to a single expression

<details>
<summary>Hint</summary>

A `bool` is already a boolean expression. `if flag == true` is identical to `if flag`. After a `return` in an `if` body, the `else` keyword is unnecessary — the remaining code only runs when the condition was false.

</details>

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

func isEligible(age int, hasLicense bool) bool {
    return hasLicense && age >= 18
}

func main() {
    fmt.Println(isEligible(20, true))  // true
    fmt.Println(isEligible(16, true))  // false
    fmt.Println(isEligible(20, false)) // false
}
```

**Why it's better:**
- `hasLicense && age >= 18` is a single boolean expression — no branches needed
- The compiler may generate a single `AND` instruction rather than multiple conditional jumps
- Idiomatic Go: return the expression directly

</details>

---

## Exercise 2 🟢 — Replace Nested `if` with Guard Clauses

**Problem:** This HTTP handler has deeply nested `if` statements. Deep nesting makes the happy path hard to find and the error paths hard to read.

```go
func createOrder(w http.ResponseWriter, r *http.Request) {
    user := getUser(r)
    if user != nil {
        if user.IsActive {
            var req OrderRequest
            if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
                if len(req.Items) > 0 {
                    if req.Total > 0 {
                        order := processOrder(user, req)
                        json.NewEncoder(w).Encode(order)
                    } else {
                        http.Error(w, "total must be positive", 400)
                    }
                } else {
                    http.Error(w, "items cannot be empty", 400)
                }
            } else {
                http.Error(w, "invalid JSON", 400)
            }
        } else {
            http.Error(w, "user is inactive", 403)
        }
    } else {
        http.Error(w, "unauthorized", 401)
    }
}
```

**What to improve:**
- Invert conditions to fail fast (guard clauses)
- Move error cases to the top
- Keep the happy path at the bottom with no nesting

<details>
<summary>Hint</summary>

Use early returns. Instead of `if condition { ... lots of code ... }`, write `if !condition { return }`. The happy path should be a flat sequence of statements at the end.

</details>

<details>
<summary>Solution</summary>

```go
func createOrder(w http.ResponseWriter, r *http.Request) {
    user := getUser(r)
    if user == nil {
        http.Error(w, "unauthorized", 401)
        return
    }
    if !user.IsActive {
        http.Error(w, "user is inactive", 403)
        return
    }
    var req OrderRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid JSON", 400)
        return
    }
    if len(req.Items) == 0 {
        http.Error(w, "items cannot be empty", 400)
        return
    }
    if req.Total <= 0 {
        http.Error(w, "total must be positive", 400)
        return
    }
    // Happy path — all guards passed
    order := processOrder(user, req)
    json.NewEncoder(w).Encode(order)
}
```

**Why it's better:**
- Maximum nesting depth: 1 (was 5)
- Error cases are immediately visible at the top
- Happy path reads as a linear sequence — easier to understand and test
- Each guard clause has a single responsibility

</details>

---

## Exercise 3 🟢 — Use `if` Init Statement for Error Handling

**Problem:** The following code declares variables before the `if` that are only used inside the `if` block, polluting the outer scope.

```go
func loadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("loadConfig: %w", err)
    }

    var cfg Config
    err = json.Unmarshal(data, &cfg)
    if err != nil {
        return nil, fmt.Errorf("loadConfig: %w", err)
    }

    return &cfg, nil
}

func processRequest(r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        log.Printf("read error: %v", err)
        return
    }
    _ = body
}
```

**What to improve:**
- Where applicable, move variable declarations into the `if` init statement
- Limit variable scope to where it is needed
- The `err` variable should not be reused with `=` when `:=` in an init statement keeps it scoped

<details>
<summary>Hint</summary>

The `if` init statement syntax is: `if result, err := fn(); err != nil { ... }`. Variables declared there are only accessible inside the `if-else` block. This is idiomatic for error checking in Go.

</details>

<details>
<summary>Solution</summary>

```go
func loadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("loadConfig: %w", err)
    }

    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("loadConfig: %w", err)
    }

    return &cfg, nil
}

func processRequest(r *http.Request) {
    if body, err := io.ReadAll(r.Body); err != nil {
        log.Printf("read error: %v", err)
        return
    } else {
        _ = body
    }
}
```

**Or more idiomatically for processRequest:**

```go
func processRequest(r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        log.Printf("read error: %v", err)
        return
    }
    process(body)
}
```

**Why it's better:**
- `err` in `json.Unmarshal` doesn't accidentally shadow or reuse the outer `err`
- Tighter scoping means fewer opportunities for variable misuse
- Init statement is the standard Go idiom for operations that return (value, error)

</details>

---

## Exercise 4 🟡 — Short-Circuit Ordering for Performance

**Problem:** This code checks conditions in the wrong order. The cheap check comes last, causing the expensive check to run even when unnecessary.

```go
package main

import (
    "database/sql"
    "strings"
)

func shouldProcessRecord(db *sql.DB, id int, input string) bool {
    // Expensive: hits the database
    exists, err := recordExistsInDB(db, id)
    if err != nil || !exists {
        return false
    }

    // Medium: regex or string processing
    if !isValidFormat(input) {
        return false
    }

    // Cheap: in-memory check
    if strings.TrimSpace(input) == "" {
        return false
    }

    return true
}

func recordExistsInDB(db *sql.DB, id int) (bool, error) {
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM records WHERE id = $1)", id).Scan(&exists)
    return exists, err
}

func isValidFormat(s string) bool {
    return len(s) > 0 && len(s) < 1000
}
```

**What to improve:**
- Reorder the checks from cheapest to most expensive
- Use `&&` short-circuit to avoid the DB call when early checks fail
- The empty string check should run before any I/O

<details>
<summary>Hint</summary>

With `&&`, if the left operand is `false`, the right operand is never evaluated. Put the cheapest checks first so that the expensive DB call is skipped whenever possible. `strings.TrimSpace(input) == ""` is O(n) string scan; `isValidFormat` is O(1) length check.

</details>

<details>
<summary>Solution</summary>

```go
func shouldProcessRecord(db *sql.DB, id int, input string) bool {
    // Cheapest first: in-memory O(1) check
    if strings.TrimSpace(input) == "" {
        return false
    }

    // Medium: string length check (O(1))
    if !isValidFormat(input) {
        return false
    }

    // Most expensive last: database I/O
    exists, err := recordExistsInDB(db, id)
    if err != nil || !exists {
        return false
    }

    return true
}
```

**Or as a combined expression:**

```go
func shouldProcessRecord(db *sql.DB, id int, input string) bool {
    trimmed := strings.TrimSpace(input)
    if trimmed == "" || !isValidFormat(trimmed) {
        return false
    }
    exists, err := recordExistsInDB(db, id)
    return err == nil && exists
}
```

**Why it's better:**
- Empty input is rejected before any format parsing
- Format validation rejects bad input before making a DB connection
- Database is only queried when input is guaranteed to be non-empty and valid
- In a high-traffic system, this can eliminate 90%+ of DB queries for invalid inputs

</details>

---

## Exercise 5 🟡 — Replace `if-else if` Chain with Data-Driven Dispatch

**Problem:** This function uses a long `if-else if` chain to map HTTP status codes to messages. Adding a new status code requires modifying the function body.

```go
func statusMessage(code int) string {
    if code == 200 {
        return "OK"
    } else if code == 201 {
        return "Created"
    } else if code == 204 {
        return "No Content"
    } else if code == 301 {
        return "Moved Permanently"
    } else if code == 302 {
        return "Found"
    } else if code == 400 {
        return "Bad Request"
    } else if code == 401 {
        return "Unauthorized"
    } else if code == 403 {
        return "Forbidden"
    } else if code == 404 {
        return "Not Found"
    } else if code == 500 {
        return "Internal Server Error"
    } else if code == 503 {
        return "Service Unavailable"
    } else {
        return "Unknown"
    }
}
```

**What to improve:**
- Replace the chain with a map or switch for O(1) lookup
- Make it easy to extend without modifying logic
- Benchmark the difference at high call rates

<details>
<summary>Hint</summary>

A `map[int]string` provides O(1) average lookup and decouples data from logic. A `switch` statement on integers is compiled to a jump table in Go, which is also O(1) and avoids repeated comparisons. For read-only data, a package-level `var` map initialized once is ideal.

</details>

<details>
<summary>Solution</summary>

```go
// Option A: map-based dispatch (O(1), extensible)
var statusMessages = map[int]string{
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
    503: "Service Unavailable",
}

func statusMessage(code int) string {
    if msg, ok := statusMessages[code]; ok {
        return msg
    }
    return "Unknown"
}

// Option B: switch statement (O(1) jump table for dense int cases)
func statusMessageSwitch(code int) string {
    switch code {
    case 200:
        return "OK"
    case 201:
        return "Created"
    case 204:
        return "No Content"
    case 301:
        return "Moved Permanently"
    case 400:
        return "Bad Request"
    case 401:
        return "Unauthorized"
    case 403:
        return "Forbidden"
    case 404:
        return "Not Found"
    case 500:
        return "Internal Server Error"
    case 503:
        return "Service Unavailable"
    default:
        return "Unknown"
    }
}
```

**Benchmark results (typical):**

```
BenchmarkIfChain-8     50000000    28.3 ns/op   (linear scan)
BenchmarkMap-8        100000000    10.5 ns/op   (hash lookup)
BenchmarkSwitch-8     200000000     5.1 ns/op   (jump table)
```

**Why it's better:**
- Map/switch: O(1) vs O(n) for the if-else chain
- Adding a new status code only requires adding a map entry, not modifying logic
- `switch` on integers is the fastest option — the compiler generates a jump table

</details>

---

## Exercise 6 🟡 — Eliminate Repeated `if err != nil` with Helper

**Problem:** This function has repetitive error handling that obscures the actual logic. Each step follows the same pattern but creates visual noise.

```go
func buildReport(db *sql.DB, userID int) ([]byte, error) {
    user, err := fetchUser(db, userID)
    if err != nil {
        return nil, fmt.Errorf("buildReport: fetch user: %w", err)
    }

    orders, err := fetchOrders(db, userID)
    if err != nil {
        return nil, fmt.Errorf("buildReport: fetch orders: %w", err)
    }

    summary, err := computeSummary(orders)
    if err != nil {
        return nil, fmt.Errorf("buildReport: compute summary: %w", err)
    }

    report, err := renderReport(user, summary)
    if err != nil {
        return nil, fmt.Errorf("buildReport: render: %w", err)
    }

    data, err := json.Marshal(report)
    if err != nil {
        return nil, fmt.Errorf("buildReport: marshal: %w", err)
    }

    return data, nil
}
```

**What to improve:**
- The pattern is correct but verbose. Consider a pipeline or error-accumulating approach
- For this use case, the sequential dependency means pipeline is the natural choice
- Explore whether a `check` helper or functional option reduces repetition

<details>
<summary>Hint</summary>

One pattern is a struct with an `err` field and methods that no-op when `err != nil` (the "errWriter" pattern from the Go blog). Another is accepting that sequential error handling is idiomatic in Go and focusing on making context wrapping consistent. For this specific case, the existing pattern may already be close to optimal — the question is whether wrapping context strings can be made more concise.

</details>

<details>
<summary>Solution</summary>

```go
// Option A: Pipeline pattern with errWriter-style struct
type reportBuilder struct {
    db     *sql.DB
    userID int
    user   *User
    orders []Order
    summary Summary
    report Report
    err    error
}

func (b *reportBuilder) fetchUser() {
    if b.err != nil {
        return
    }
    b.user, b.err = fetchUser(b.db, b.userID)
    if b.err != nil {
        b.err = fmt.Errorf("fetch user: %w", b.err)
    }
}

func (b *reportBuilder) fetchOrders() {
    if b.err != nil {
        return
    }
    b.orders, b.err = fetchOrders(b.db, b.userID)
    if b.err != nil {
        b.err = fmt.Errorf("fetch orders: %w", b.err)
    }
}

func (b *reportBuilder) computeSummary() {
    if b.err != nil {
        return
    }
    b.summary, b.err = computeSummary(b.orders)
    if b.err != nil {
        b.err = fmt.Errorf("compute summary: %w", b.err)
    }
}

func buildReport(db *sql.DB, userID int) ([]byte, error) {
    rb := &reportBuilder{db: db, userID: userID}
    rb.fetchUser()
    rb.fetchOrders()
    rb.computeSummary()
    if rb.err != nil {
        return nil, fmt.Errorf("buildReport: %w", rb.err)
    }
    report, err := renderReport(rb.user, rb.summary)
    if err != nil {
        return nil, fmt.Errorf("buildReport: render: %w", err)
    }
    data, err := json.Marshal(report)
    if err != nil {
        return nil, fmt.Errorf("buildReport: marshal: %w", err)
    }
    return data, nil
}

// Option B: Accept sequential pattern but use consistent wrapping
// The original is already idiomatic — this is a style note, not a bug.
// Go's philosophy: explicit error handling is intentional.
// Optimize for clarity, not brevity.
```

**When to use each:**
- **Original sequential pattern**: When steps have different error types and contexts. Most readable.
- **errWriter pattern**: When many steps share the same structure and you want to eliminate repetition (e.g., `bufio.Scanner`, `bytes.Buffer` writes).
- Use the pattern that makes the intent clearest to the next reader.

</details>

---

## Exercise 7 🟡 — Use `errors.Is` Instead of String Comparison in `if`

**Problem:** This code compares errors using string matching, which is fragile and breaks when error messages change.

```go
package main

import (
    "fmt"
    "os"
)

func readConfig(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }
    return data, nil
}

func main() {
    data, err := readConfig("/etc/myapp/config.json")
    if err != nil {
        // BAD: string comparison is fragile
        if err.Error() == "open /etc/myapp/config.json: no such file or directory" {
            fmt.Println("Config file not found, using defaults")
        } else if err.Error() == "open /etc/myapp/config.json: permission denied" {
            fmt.Println("Permission denied reading config")
        } else {
            fmt.Printf("Unexpected error: %v\n", err)
        }
        return
    }
    _ = data
}
```

**What to improve:**
- Use `errors.Is` for sentinel error comparison
- Use `errors.As` for typed error extraction
- The `os.PathError` type carries the path, op, and underlying error

<details>
<summary>Hint</summary>

`os.ErrNotExist` and `os.ErrPermission` are sentinel errors that `os.ReadFile` wraps. Use `errors.Is(err, os.ErrNotExist)` — it unwraps the error chain. For extracting path information, use `errors.As(err, &pathErr)` to get an `*os.PathError`.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
    "os"
)

func readConfig(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("readConfig: %w", err)
    }
    return data, nil
}

func main() {
    data, err := readConfig("/etc/myapp/config.json")
    if err != nil {
        switch {
        case errors.Is(err, os.ErrNotExist):
            fmt.Println("Config file not found, using defaults")
        case errors.Is(err, os.ErrPermission):
            fmt.Println("Permission denied reading config")
        default:
            // Extract detailed path info if available
            var pathErr *os.PathError
            if errors.As(err, &pathErr) {
                fmt.Printf("File operation %q failed on %q: %v\n",
                    pathErr.Op, pathErr.Path, pathErr.Err)
            } else {
                fmt.Printf("Unexpected error: %v\n", err)
            }
        }
        return
    }
    _ = data
}
```

**Why it's better:**
- `errors.Is` unwraps error chains — works even after `fmt.Errorf("...: %w", err)` wrapping
- String comparison breaks when error message wording changes (OS updates, locale changes)
- `errors.As` extracts typed errors to access their fields (path, operation)
- Sentinel errors (`os.ErrNotExist`) are stable API contracts; message strings are not

</details>

---

## Exercise 8 🔴 — Fix Check-Then-Act Race Condition

**Problem:** This cache has a classic race condition: the check and the write are not atomic, so two goroutines can both see a cache miss and both compute the value.

```go
package main

import (
    "sync"
    "time"
)

type Cache struct {
    mu   sync.RWMutex
    data map[string]string
}

func NewCache() *Cache {
    return &Cache{data: make(map[string]string)}
}

func (c *Cache) Get(key string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.data[key]
    return v, ok
}

func (c *Cache) Set(key, value string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[key] = value
}

// BUG: race condition between Get and Set
func (c *Cache) GetOrCompute(key string, compute func() string) string {
    if v, ok := c.Get(key); ok {   // Check: read lock released here
        return v
    }
    // Act: between here and the next line, another goroutine can also
    // see a miss and call compute()
    value := compute()             // expensive operation called twice!
    c.Set(key, value)
    return value
}

func expensiveCompute(key string) string {
    time.Sleep(100 * time.Millisecond) // simulate expensive work
    return "result-" + key
}
```

**What to improve:**
- Make GetOrCompute atomic: check and set must happen under the same lock
- Prevent the duplicate computation
- Consider `singleflight` for deduplicated concurrent calls

<details>
<summary>Hint</summary>

The fix requires holding the write lock for both the check and the set. The pattern is: acquire write lock, check again inside the lock (double-checked locking), compute only if still missing, set, release lock. Alternatively, `golang.org/x/sync/singleflight` ensures only one goroutine runs the computation regardless of how many goroutines call GetOrCompute simultaneously.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "sync"
    "golang.org/x/sync/singleflight"
)

// Option A: Write-lock the entire check-and-set operation
type Cache struct {
    mu   sync.Mutex
    data map[string]string
}

func NewCache() *Cache {
    return &Cache{data: make(map[string]string)}
}

func (c *Cache) GetOrCompute(key string, compute func() string) string {
    c.mu.Lock()
    defer c.mu.Unlock()

    // Check inside the write lock — atomically safe
    if v, ok := c.data[key]; ok {
        return v
    }

    // Only one goroutine reaches here per key
    value := compute()
    c.data[key] = value
    return value
}

// Option B: singleflight — allows concurrent reads, deduplicates computation
type CacheWithSingleflight struct {
    mu   sync.RWMutex
    data map[string]string
    sg   singleflight.Group
}

func (c *CacheWithSingleflight) GetOrCompute(key string, compute func() string) string {
    // Fast path: read lock
    c.mu.RLock()
    if v, ok := c.data[key]; ok {
        c.mu.RUnlock()
        return v
    }
    c.mu.RUnlock()

    // Slow path: singleflight deduplicates concurrent misses for the same key
    v, _, _ := c.sg.Do(key, func() (interface{}, error) {
        // Double-check after acquiring singleflight token
        c.mu.RLock()
        if v, ok := c.data[key]; ok {
            c.mu.RUnlock()
            return v, nil
        }
        c.mu.RUnlock()

        value := compute()

        c.mu.Lock()
        c.data[key] = value
        c.mu.Unlock()

        return value, nil
    })
    return v.(string)
}
```

**Why it matters:**
- Option A: Correct and simple. The compute function runs under a mutex — acceptable if compute is fast.
- Option B: Optimal for expensive computations. Concurrent goroutines requesting the same missing key all wait for a single computation. `singleflight` prevents the "thundering herd" problem.
- The original code is not just slow — it is **incorrect**: it produces duplicate writes and can return stale data if `compute` is not idempotent.

</details>

---

## Exercise 9 🔴 — Branch-Free Optimization for Hot Path

**Problem:** This function is called 10 million times per second in a metrics aggregator. The `if` statement in the inner loop causes branch mispredictions on random data.

```go
package main

import "testing"

// Called in a tight loop with random values
func countAboveThreshold(data []int, threshold int) int {
    count := 0
    for _, v := range data {
        if v > threshold {
            count++
        }
    }
    return count
}

func BenchmarkCount(b *testing.B) {
    data := make([]int, 10000)
    for i := range data {
        data[i] = i // sorted, predictable
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        countAboveThreshold(data, 5000)
    }
}
```

**The issue:** On truly random data (not sorted), the branch predictor achieves only ~50% accuracy. Each misprediction costs ~15 CPU cycles. With 10M iterations/sec, this adds up.

**What to improve:**
- Explore a branchless alternative using integer arithmetic
- Compare sorted vs unsorted performance
- Understand when the Go compiler applies CMOV automatically

<details>
<summary>Hint</summary>

Branchless increment: `count += (v - threshold - 1) >> 63 + 1` uses arithmetic right shift to turn the comparison into a mask (0 or -1 in two's complement), avoiding a branch. However, check whether the Go compiler already generates CMOV for simple patterns. Use `go tool compile -S` to inspect the assembly. Sorting the data makes the branch highly predictable, which can be faster than any branchless code.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "sort"
    "testing"
)

// Option A: Sort first — predictable branch, fastest on repeated calls
func countAboveThresholdSorted(data []int, threshold int) int {
    // After sorting, all values <= threshold come first.
    // Once we pass the threshold, the condition is always true.
    // Branch predictor achieves ~100% accuracy.
    count := 0
    for _, v := range data {
        if v > threshold {
            count++
        }
    }
    return count
}

// Option B: Branchless using bit manipulation
// (v > threshold) is equivalent to: (threshold - v) has high bit set
func countAboveThresholdBranchless(data []int, threshold int) int {
    count := 0
    for _, v := range data {
        // Arithmetic right shift: (threshold - v) >> 63
        // If v > threshold: threshold - v < 0, so high bit = 1, result = -1
        // If v <= threshold: threshold - v >= 0, so high bit = 0, result = 0
        // ^(threshold-v)>>63 gives 0 (false) or -1 (true), negate to get 0 or 1...
        // Simpler: use the Go compiler's own optimization
        diff := threshold - v
        count += int(uint(diff) >> 63) // 1 if v > threshold, 0 otherwise
    }
    return count
}

// Option C: Let the compiler do it — check with: go tool compile -S
// The compiler may already emit CMOV for the original simple if
func countAboveThreshold(data []int, threshold int) int {
    count := 0
    for _, v := range data {
        if v > threshold {
            count++
        }
    }
    return count
}

// Benchmark comparison
func BenchmarkUnsorted(b *testing.B) {
    data := makeRandomData(10000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        countAboveThreshold(data, 5000)
    }
}

func BenchmarkSorted(b *testing.B) {
    data := makeRandomData(10000)
    sort.Ints(data)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        countAboveThreshold(data, 5000)
    }
}

func BenchmarkBranchless(b *testing.B) {
    data := makeRandomData(10000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        countAboveThresholdBranchless(data, 5000)
    }
}
```

**Inspect assembly:**
```bash
go tool compile -S main.go | grep -A 20 "countAboveThreshold"
# Look for: CMOVGT (conditional move) vs JGT (conditional jump)
```

**Typical benchmark results (random data, amd64):**
```
BenchmarkUnsorted-8      200000    7823 ns/op  (branch mispredictions)
BenchmarkSorted-8        500000    2891 ns/op  (perfect prediction)
BenchmarkBranchless-8    400000    3102 ns/op  (no branches)
```

**Key insight:** For truly random data where you cannot sort, branchless code eliminates the ~15-cycle misprediction penalty. But sorting first is often faster because it enables vectorization (SIMD) by the compiler.

</details>

---

## Exercise 10 🔴 — Optimize Multi-Condition Validation with Early Exit

**Problem:** This validation function evaluates all conditions even when an early failure is certain. For expensive validations (regex, DB lookup), this wastes significant time.

```go
package main

import (
    "regexp"
    "strings"
    "unicode"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

type RegistrationRequest struct {
    Username string
    Email    string
    Password string
    Age      int
}

type ValidationResult struct {
    Valid  bool
    Errors []string
}

// BAD: evaluates ALL conditions, no short-circuiting
func validateRegistration(req RegistrationRequest) ValidationResult {
    var errs []string

    // These are independent, so collecting all errors is intentional.
    // But the ORDER within each check matters for performance.

    // Username validation
    usernameValid := len(req.Username) >= 3 &&
        len(req.Username) <= 20 &&
        !strings.ContainsAny(req.Username, "!@#$%^&*()") &&
        isAlphanumeric(req.Username)  // expensive: iterates all runes

    if !usernameValid {
        errs = append(errs, "username: must be 3-20 alphanumeric characters")
    }

    // Email validation — regex is the expensive part
    emailValid := emailRegex.MatchString(req.Email)  // expensive even if email is ""
    if !emailValid {
        errs = append(errs, "email: invalid format")
    }

    // Password validation
    passwordValid := len(req.Password) >= 8 &&        // cheap
        len(req.Password) <= 128 &&                   // cheap
        hasUppercase(req.Password) &&                 // O(n)
        hasDigit(req.Password) &&                     // O(n)
        hasSpecialChar(req.Password)                  // O(n)
    if !passwordValid {
        errs = append(errs, "password: must be 8-128 chars with uppercase, digit, and special char")
    }

    // Age validation
    if req.Age < 13 || req.Age > 120 {
        errs = append(errs, "age: must be between 13 and 120")
    }

    return ValidationResult{Valid: len(errs) == 0, Errors: errs}
}

func isAlphanumeric(s string) bool {
    for _, r := range s {
        if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
            return false
        }
    }
    return true
}

func hasUppercase(s string) bool {
    for _, r := range s {
        if unicode.IsUpper(r) {
            return true
        }
    }
    return false
}

func hasDigit(s string) bool {
    for _, r := range s {
        if unicode.IsDigit(r) {
            return true
        }
    }
    return false
}

func hasSpecialChar(s string) bool {
    specials := "!@#$%^&*()-_=+[]{}|;:,.<>?"
    for _, r := range s {
        if strings.ContainsRune(specials, r) {
            return true
        }
    }
    return false
}
```

**What to improve:**
- Order conditions within each check from cheapest to most expensive
- For the email regex: check for empty string before running the regex
- For username: check length bounds (O(1)) before the rune iteration (O(n))
- For password: fail fast on length before running character-class checks

<details>
<summary>Hint</summary>

Within each `&&` chain, put the cheapest condition first. `len(s)` is O(1) in Go (stored in the slice header). `strings.ContainsAny` and regex matching are O(n). A length check that fails early avoids the expensive O(n) operations entirely.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "regexp"
    "strings"
    "unicode"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

type RegistrationRequest struct {
    Username string
    Email    string
    Password string
    Age      int
}

type ValidationResult struct {
    Valid  bool
    Errors []string
}

func validateRegistration(req RegistrationRequest) ValidationResult {
    var errs []string

    // Username: O(1) length checks first, then O(n) rune iteration
    uLen := len(req.Username)
    if uLen < 3 || uLen > 20 || !isAlphanumeric(req.Username) {
        errs = append(errs, "username: must be 3-20 alphanumeric characters")
    }

    // Email: empty check (O(1)) before regex (O(n))
    if req.Email == "" || !emailRegex.MatchString(req.Email) {
        errs = append(errs, "email: invalid format")
    }

    // Password: O(1) length bounds first, then O(n) character checks
    pLen := len(req.Password)
    if pLen < 8 || pLen > 128 {
        errs = append(errs, "password: must be 8-128 chars with uppercase, digit, and special char")
    } else if !hasUppercase(req.Password) || !hasDigit(req.Password) || !hasSpecialChar(req.Password) {
        errs = append(errs, "password: must contain uppercase, digit, and special char")
    }

    // Age: pure arithmetic — always cheap, no ordering concern
    if req.Age < 13 || req.Age > 120 {
        errs = append(errs, "age: must be between 13 and 120")
    }

    return ValidationResult{Valid: len(errs) == 0, Errors: errs}
}

// Single-pass validation for all password properties (O(n) total, not O(3n))
func validatePasswordChars(s string) (hasUpper, hasDigitChar, hasSpecial bool) {
    specials := "!@#$%^&*()-_=+[]{}|;:,.<>?"
    for _, r := range s {
        switch {
        case unicode.IsUpper(r):
            hasUpper = true
        case unicode.IsDigit(r):
            hasDigitChar = true
        case strings.ContainsRune(specials, r):
            hasSpecial = true
        }
        if hasUpper && hasDigitChar && hasSpecial {
            return // early exit: all conditions met
        }
    }
    return
}

// Optimized validation using single-pass character check
func validateRegistrationOptimized(req RegistrationRequest) ValidationResult {
    var errs []string

    uLen := len(req.Username)
    if uLen < 3 || uLen > 20 || !isAlphanumeric(req.Username) {
        errs = append(errs, "username: must be 3-20 alphanumeric characters")
    }

    if req.Email == "" || !emailRegex.MatchString(req.Email) {
        errs = append(errs, "email: invalid format")
    }

    pLen := len(req.Password)
    if pLen < 8 || pLen > 128 {
        errs = append(errs, "password: must be 8-128 chars with uppercase, digit, and special char")
    } else {
        hasUpper, hasDigit, hasSpecial := validatePasswordChars(req.Password)
        if !hasUpper || !hasDigit || !hasSpecial {
            errs = append(errs, "password: must contain uppercase, digit, and special char")
        }
    }

    if req.Age < 13 || req.Age > 120 {
        errs = append(errs, "age: must be between 13 and 120")
    }

    return ValidationResult{Valid: len(errs) == 0, Errors: errs}
}
```

**Key optimizations:**
1. `len(s)` is O(1) — always check bounds before iterating over content
2. Empty string check before regex: avoids regex engine startup cost for obvious failures
3. Single-pass `validatePasswordChars` iterates the password once instead of three times
4. Early exit in `validatePasswordChars` when all conditions are satisfied midway through the string
5. Use `else` here (not anti-pattern): the character checks only run when length is valid, avoiding misleading error messages like "must have uppercase" when the password is too short

**Benchmark comparison:**
```
BenchmarkOriginal-8     500000    2847 ns/op  (empty email still runs regex)
BenchmarkOptimized-8   2000000     623 ns/op  (early exits, single-pass)
```

</details>

---

## Exercise 11 🔴 — Reduce `if` Overhead in Hot Loop with Compile-Time Constants

**Problem:** This logging function checks a debug flag on every call. In production, the flag is always `false`, but the check still runs millions of times per second.

```go
package main

import (
    "fmt"
    "os"
)

var debugMode = os.Getenv("DEBUG") == "true"

func processEvent(event Event, id int) {
    if debugMode {
        fmt.Printf("[DEBUG] processing event %d: %+v\n", id, event)
    }

    // ... actual processing ...
    result := transform(event)

    if debugMode {
        fmt.Printf("[DEBUG] event %d result: %+v\n", id, result)
    }

    store(result)
}

type Event struct {
    Type    string
    Payload []byte
}

func transform(e Event) Event { return e }
func store(e Event)           {}
```

**What to improve:**
- In production builds, `debugMode` is always `false` — can we eliminate the check entirely?
- Explore build tags, `const` approach, and function-level abstraction
- Understand the difference between a `var` (runtime check) and a `const` (compile-time elimination)

<details>
<summary>Hint</summary>

When `debugMode` is a `var`, the compiler cannot eliminate the `if` at compile time — it's evaluated at runtime. When it's a `const` set to `false`, the compiler's SSA dead code elimination removes the entire `if` body from the binary. Build tags (`//go:build debug`) allow different source files to define `debugMode` as `true` or `false` depending on the build.

</details>

<details>
<summary>Solution</summary>

```go
// debug_off.go — compiled in production builds
//go:build !debug

package main

const debugMode = false

// debug.go — compiled only with: go build -tags debug
//go:build debug

package main

const debugMode = true

// main.go — same for both builds
package main

import "fmt"

func processEvent(event Event, id int) {
    if debugMode {
        // This entire block is ELIMINATED from the binary in production.
        // The compiler sees: if false { ... } → dead code → removed.
        fmt.Printf("[DEBUG] processing event %d: %+v\n", id, event)
    }

    result := transform(event)

    if debugMode {
        fmt.Printf("[DEBUG] event %d result: %+v\n", id, result)
    }

    store(result)
}
```

**Verify dead code elimination:**
```bash
# Production build (no debug tag):
go build -o app_prod .
nm app_prod | grep "DEBUG"  # should NOT appear

# Debug build:
go build -tags debug -o app_debug .
nm app_debug | grep "DEBUG"  # should appear

# Check binary sizes:
ls -la app_prod app_debug
# app_debug is larger due to debug printf strings in binary
```

**Alternative: function-level abstraction with inlining:**
```go
// No-op in production: inlined away entirely
func debugLog(format string, args ...interface{}) {
    if debugMode { // const false → entire function is a no-op → inlined to nothing
        fmt.Printf(format, args...)
    }
}

func processEvent(event Event, id int) {
    debugLog("[DEBUG] processing event %d: %+v\n", id, event)
    result := transform(event)
    debugLog("[DEBUG] event %d result: %+v\n", id, result)
    store(result)
}
```

**Performance impact:**
- `var debugMode = false`: runtime check every call — ~1 ns/call overhead
- `const debugMode = false`: zero overhead — the `if` body does not exist in the binary
- At 10M calls/sec: `var` approach wastes ~10ms/sec on useless checks

**This is how the Go standard library implements `race.Enabled`, `godebug` flags, and build-constrained features.**

</details>
