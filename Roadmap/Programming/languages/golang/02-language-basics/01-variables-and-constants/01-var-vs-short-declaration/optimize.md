# var vs := — Optimize the Code

> Practice optimizing variable declaration patterns for clarity, correctness, and performance.

## How to Use
1. Read the original code and understand what it does
2. Identify what can be improved (clarity, correctness, or performance)
3. Write your optimized version
4. Compare with the provided solution

### Categories
| Category | Description |
|:--------:|:-----------|
| **Clarity** | Make code more readable and expressive |
| **Memory** | Reduce unnecessary allocations |
| **Performance** | Faster execution, less GC pressure |
| **Correctness** | Fix logical issues related to declaration |

---

## Exercise 1: Remove Redundant Type Annotations (Easy / Clarity)

**What the code does:** Declares several local variables with explicit types that match the right-hand side.

**The problem:** The types are redundant — they can be inferred. This adds noise without adding information.

```go
package main

import "fmt"

func main() {
    var name string = "Alice"
    var age int = 30
    var height float64 = 1.75
    var active bool = true
    var score int = 0

    fmt.Println(name, age, height, active, score)
}
```

<details>
<summary>Hint</summary>
When the type can be inferred from the right-hand side, you can use `:=` inside functions. For zero values, use `var x T` without a value.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

func main() {
    name := "Alice"
    age := 30
    height := 1.75
    active := true
    var score int  // zero value — intent is clear

    fmt.Println(name, age, height, active, score)
}
```

**Why it's better:**
- `name := "Alice"` is more idiomatic Go inside functions
- `var score int` clearly signals "this starts at zero by design"
- Less visual noise — reader focuses on values, not redundant type names
- Fewer characters to type and read
</details>

---

## Exercise 2: C-Style Declarations at Top of Function (Easy / Clarity)

**What the code does:** Processes an HTTP request, but declares all variables at the top in C style.

**The problem:** Variables are declared far from where they are used. Readers must scroll to understand what each variable holds. Some may not be used in certain code paths.

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
)

type Request struct{ UserID int }
type User struct{ Name string }
type Response struct{ Message string }

func handleRequest(r *http.Request) {
    var req Request
    var user User
    var resp Response
    var data []byte
    var err error

    data, err = readBody(r)
    if err != nil {
        fmt.Println("error reading body")
        return
    }

    err = json.Unmarshal(data, &req)
    if err != nil {
        fmt.Println("error parsing body")
        return
    }

    user, err = getUser(req.UserID)
    if err != nil {
        fmt.Println("error getting user")
        return
    }

    resp = buildResponse(user)
    fmt.Println(resp.Message)
}

func readBody(r *http.Request) ([]byte, error)      { return nil, nil }
func getUser(id int) (User, error)                   { return User{Name: "Alice"}, nil }
func buildResponse(u User) Response                  { return Response{Message: "Hello " + u.Name} }
```

<details>
<summary>Hint</summary>
Declare each variable at the point where it is first assigned. Use `:=` for variables that get their value from function calls.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
)

func handleRequestOptimized(r *http.Request) {
    data, err := readBody(r)
    if err != nil {
        fmt.Println("error reading body")
        return
    }

    var req Request
    if err = json.Unmarshal(data, &req); err != nil {
        fmt.Println("error parsing body")
        return
    }

    user, err := getUser(req.UserID)
    if err != nil {
        fmt.Println("error getting user")
        return
    }

    resp := buildResponse(user)
    fmt.Println(resp.Message)
}
```

**Why it's better:**
- Variables declared close to first use — easier to follow the logic
- Each variable's type and purpose is clear from context
- Shorter scope for each variable — less cognitive load
- Unused variables in error paths are eliminated
</details>

---

## Exercise 3: Unnecessary make for Zero-Value Types (Medium / Memory)

**What the code does:** Creates several types that have useful zero values but initializes them unnecessarily.

**The problem:** `sync.Mutex`, `bytes.Buffer`, and `sync.WaitGroup` all have useful zero values. Explicitly initializing them adds noise.

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

func process() {
    mu := sync.Mutex{}         // unnecessary
    buf := bytes.Buffer{}      // unnecessary
    wg := sync.WaitGroup{}     // unnecessary

    wg.Add(1)
    go func() {
        defer wg.Done()
        mu.Lock()
        buf.WriteString("hello")
        mu.Unlock()
    }()

    wg.Wait()
    fmt.Println(buf.String())
}

func main() {
    process()
}
```

<details>
<summary>Hint</summary>
These types from the standard library are designed to work with their zero values. Use `var` to declare them without initialization.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

func processOptimized() {
    var mu  sync.Mutex    // zero value = unlocked
    var buf bytes.Buffer  // zero value = empty buffer
    var wg  sync.WaitGroup // zero value = counter at 0

    wg.Add(1)
    go func() {
        defer wg.Done()
        mu.Lock()
        buf.WriteString("hello")
        mu.Unlock()
    }()

    wg.Wait()
    fmt.Println(buf.String())
}

func main() {
    processOptimized()
}
```

**Why it's better:**
- `var` with zero-value-ready types is idiomatic Go
- Signals clearly that the zero value is intentional and sufficient
- Avoids unnecessary struct literal syntax
- Matches standard library conventions (see `sync.Mutex`, `bytes.Buffer` docs)
</details>

---

## Exercise 4: Pre-Allocate Slice in Loop (Medium / Memory + Performance)

**What the code does:** Collects transformed items into a slice.

**The problem:** The slice grows through repeated `append` calls, causing multiple reallocations and copies.

```go
package main

import "fmt"

func doubleAll(nums []int) []int {
    var result []int  // nil slice, starts with no capacity

    for _, n := range nums {
        result = append(result, n*2)
        // Each append may trigger reallocation:
        // capacity: 0 → 1 → 2 → 4 → 8 → ...
    }

    return result
}

func main() {
    input := make([]int, 1000)
    for i := range input {
        input[i] = i
    }

    output := doubleAll(input)
    fmt.Println(len(output))
}
```

<details>
<summary>Hint</summary>
When you know the final size of the slice, use `make([]T, 0, n)` to pre-allocate with the right capacity.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

func doubleAllOptimized(nums []int) []int {
    result := make([]int, 0, len(nums))  // pre-allocated

    for _, n := range nums {
        result = append(result, n*2)  // no reallocation needed
    }

    return result
}

// Even simpler: use a pre-sized slice with index assignment
func doubleAllFastest(nums []int) []int {
    result := make([]int, len(nums))  // pre-sized, no append needed

    for i, n := range nums {
        result[i] = n * 2
    }

    return result
}

func main() {
    input := make([]int, 1000)
    for i := range input {
        input[i] = i
    }

    fmt.Println(len(doubleAllOptimized(input)))   // 1000
    fmt.Println(len(doubleAllFastest(input)))     // 1000
}
```

**Why it's better:**
- `make([]int, 0, len(nums))` pre-allocates the backing array once
- Zero reallocations during the loop
- For large slices: ~40% faster, significantly less GC pressure
- `make([]int, len(nums))` with index assignment avoids append overhead entirely
- Benchmark: `go test -bench=. -benchmem`
</details>

---

## Exercise 5: Map Pre-Allocation (Medium / Memory)

**What the code does:** Builds an index from a slice.

**The problem:** Map starts empty and grows incrementally, causing multiple hash table resizes.

```go
package main

import "fmt"

type Item struct {
    Key   string
    Value int
}

func buildIndex(items []Item) map[string]int {
    index := make(map[string]int)  // no size hint

    for _, item := range items {
        index[item.Key] = item.Value
    }

    return index
}

func main() {
    items := make([]Item, 1000)
    for i := range items {
        items[i] = Item{Key: fmt.Sprintf("key%d", i), Value: i}
    }

    index := buildIndex(items)
    fmt.Println(len(index))
}
```

<details>
<summary>Hint</summary>
`make(map[K]V, hint)` allows you to specify an approximate initial capacity, reducing rehash operations.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

type Item2 struct {
    Key   string
    Value int
}

func buildIndexOptimized(items []Item2) map[string]int {
    index := make(map[string]int, len(items))  // size hint

    for _, item := range items {
        index[item.Key] = item.Value
    }

    return index
}

func main() {
    items := make([]Item2, 1000)
    for i := range items {
        items[i] = Item2{Key: fmt.Sprintf("key%d", i), Value: i}
    }

    index := buildIndexOptimized(items)
    fmt.Println(len(index))
}
```

**Why it's better:**
- `make(map[K]V, len(items))` tells the runtime to pre-allocate buckets
- Reduces or eliminates rehash operations (O(n) work each time)
- For 1000 items: roughly 30-50% fewer allocations
- Rule: whenever you know (or can estimate) the map size, provide the hint
</details>

---

## Exercise 6: Scope Reduction with if-init (Medium / Clarity)

**What the code does:** Parses a config value and uses it locally.

**The problem:** Variables leak into the outer scope when they are only needed inside a conditional.

```go
package main

import (
    "fmt"
    "os"
    "strconv"
)

func getConfig() {
    portStr := os.Getenv("PORT")
    port, err := strconv.Atoi(portStr)
    if err != nil {
        port = 8080
    }
    fmt.Println("Using port:", port)

    timeout, err2 := strconv.Atoi(os.Getenv("TIMEOUT"))
    if err2 != nil {
        timeout = 30
    }
    fmt.Println("Using timeout:", timeout)

    // portStr, port, err, err2 are all still in scope here
    // even though they're no longer needed
    _, _, _, _ = portStr, port, err, err2
}

func main() {
    getConfig()
}
```

<details>
<summary>Hint</summary>
Use `if v, err := ...; err != nil` to scope variables to just the block they are needed in.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "os"
    "strconv"
)

func getConfigOptimized() {
    port := 8080
    if p, err := strconv.Atoi(os.Getenv("PORT")); err == nil {
        port = p
    }
    fmt.Println("Using port:", port)

    timeout := 30
    if t, err := strconv.Atoi(os.Getenv("TIMEOUT")); err == nil {
        timeout = t
    }
    fmt.Println("Using timeout:", timeout)
    // Only port and timeout remain in scope — clean!
}

func main() {
    getConfigOptimized()
}
```

**Why it's better:**
- `p` and `err` are scoped to the `if` block — they don't pollute outer scope
- No need for `err2` workaround — each if-init has its own `err`
- `portStr` intermediate variable eliminated
- Outer scope only contains the final values: `port` and `timeout`
- Pattern: default value + override with if-init is very readable
</details>

---

## Exercise 7: Avoid Allocation in Hot Loop (Hard / Performance)

**What the code does:** Formats log messages in a high-frequency loop.

**The problem:** `fmt.Sprintf` allocates a new string on every call. In a hot path, this generates significant GC pressure.

```go
package main

import (
    "fmt"
    "io"
    "os"
)

func logMessages(w io.Writer, count int) {
    for i := 0; i < count; i++ {
        // BAD: allocates a new string on every iteration
        msg := fmt.Sprintf("[INFO] processing item %d", i)
        fmt.Fprintln(w, msg)
    }
}

func main() {
    logMessages(os.Stdout, 5)
}
```

<details>
<summary>Hint</summary>
Declare a `bytes.Buffer` outside the loop (zero value), reset it on each iteration, and write directly to it. This reuses the buffer's backing memory.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "bytes"
    "fmt"
    "io"
    "os"
)

func logMessagesOptimized(w io.Writer, count int) {
    var buf bytes.Buffer  // declared once, zero value is ready

    for i := 0; i < count; i++ {
        buf.Reset()  // reuse backing array — no new allocation
        fmt.Fprintf(&buf, "[INFO] processing item %d", i)
        buf.WriteByte('\n')
        w.Write(buf.Bytes())
    }
}

// Even better for high-frequency: use sync.Pool
var logBufPool = sync.Pool{
    New: func() interface{} { return new(bytes.Buffer) },
}

func logMessagesPool(w io.Writer, count int) {
    for i := 0; i < count; i++ {
        buf := logBufPool.Get().(*bytes.Buffer)
        buf.Reset()
        fmt.Fprintf(buf, "[INFO] processing item %d", i)
        buf.WriteByte('\n')
        w.Write(buf.Bytes())
        logBufPool.Put(buf)
    }
}

func main() {
    logMessagesOptimized(os.Stdout, 5)
}
```

**Why it's better:**
- `var buf bytes.Buffer` uses zero value — no `new(bytes.Buffer)` needed
- `buf.Reset()` clears contents but keeps the backing array allocated
- One allocation for the buffer, reused for all iterations
- `sync.Pool` version amortizes allocation across goroutines
- Benchmark: `go test -bench=. -benchmem` will show 0-1 allocs/op vs N allocs/op
</details>

---

## Exercise 8: Avoid Repeated String Building (Medium / Performance)

**What the code does:** Builds a comma-separated string from a slice.

**The problem:** String concatenation with `+=` creates a new string on every iteration (strings are immutable in Go).

```go
package main

import "fmt"

func joinStrings(items []string) string {
    result := ""
    for i, item := range items {
        if i > 0 {
            result += ", "  // new string allocation every iteration!
        }
        result += item  // another allocation
    }
    return result
}

func main() {
    words := []string{"apple", "banana", "cherry", "date"}
    fmt.Println(joinStrings(words))
}
```

<details>
<summary>Hint</summary>
Use `strings.Builder` (zero value is ready) or `strings.Join` for string concatenation.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "strings"
)

// Option 1: strings.Builder (zero value ready)
func joinStringsBuilder(items []string) string {
    var sb strings.Builder  // zero value is an empty builder

    for i, item := range items {
        if i > 0 {
            sb.WriteString(", ")
        }
        sb.WriteString(item)
    }

    return sb.String()
}

// Option 2: strings.Join (simplest)
func joinStringsJoin(items []string) string {
    return strings.Join(items, ", ")
}

// Option 3: strings.Builder with pre-allocation hint
func joinStringsPrealloc(items []string) string {
    total := 0
    for _, item := range items {
        total += len(item) + 2  // +2 for ", "
    }

    var sb strings.Builder
    sb.Grow(total)  // pre-allocate

    for i, item := range items {
        if i > 0 {
            sb.WriteString(", ")
        }
        sb.WriteString(item)
    }
    return sb.String()
}

func main() {
    words := []string{"apple", "banana", "cherry", "date"}
    fmt.Println(joinStringsBuilder(words))
    fmt.Println(joinStringsJoin(words))
    fmt.Println(joinStringsPrealloc(words))
}
```

**Why it's better:**
- `var sb strings.Builder` uses zero value — no constructor needed
- `strings.Builder` amortizes allocations (similar to `bytes.Buffer`)
- `strings.Join` is clearest for simple cases — one allocation
- `sb.Grow(n)` eliminates all internal reallocations when total size is known
- O(n) total work vs O(n²) with naive `+=`
</details>

---

## Exercise 9: Remove Intermediate Variable (Easy / Clarity)

**What the code does:** Computes a result through an intermediate variable that is used only once.

**The problem:** Intermediate variables that are used exactly once add noise without adding clarity.

```go
package main

import "fmt"

func greet(name string) string {
    greeting := "Hello, " + name + "!"
    return greeting
}

func isEven(n int) bool {
    remainder := n % 2
    result := remainder == 0
    return result
}

func clamp(value, min, max int) int {
    var clamped int
    if value < min {
        clamped = min
    } else if value > max {
        clamped = max
    } else {
        clamped = value
    }
    return clamped
}

func main() {
    fmt.Println(greet("Alice"))
    fmt.Println(isEven(4))
    fmt.Println(clamp(15, 0, 10))
}
```

<details>
<summary>Hint</summary>
Intermediate variables used only once can often be inlined. But `clamp` needs the var pattern — why?
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

// Inline the intermediate variable
func greetOptimized(name string) string {
    return "Hello, " + name + "!"
}

// Remove unnecessary intermediate
func isEvenOptimized(n int) bool {
    return n%2 == 0
}

// clamp is actually a good use case for var — keep it
// But we can still simplify with an idiomatic pattern
func clampOptimized(value, min, max int) int {
    if value < min {
        return min
    }
    if value > max {
        return max
    }
    return value
}

func main() {
    fmt.Println(greetOptimized("Alice"))
    fmt.Println(isEvenOptimized(4))
    fmt.Println(clampOptimized(15, 0, 10))
}
```

**Why it's better:**
- `greet` and `isEven`: single-use variables add noise; inline them
- `clamp`: early returns eliminate the need for a mutable `clamped` variable entirely
- Each function is now shorter and more direct
- No loss of clarity — the logic is actually easier to follow

**When to keep intermediate variables:**
- When the name adds meaningful documentation
- When the computation is complex and naming it aids comprehension
- When debugging: named intermediates are easier to inspect in a debugger
</details>

---

## Exercise 10: Replace var+assign with := in Loop (Easy / Clarity)

**What the code does:** Searches for an item in a slice.

**The problem:** Variables are declared with `var` at the top of a loop body when they could be declared inline with `:=`.

```go
package main

import "fmt"

type Product struct {
    ID    int
    Name  string
    Price float64
}

func findCheapest(products []Product, maxPrice float64) (Product, bool) {
    var found bool
    var best Product

    for _, p := range products {
        var eligible bool
        eligible = p.Price <= maxPrice
        if eligible {
            var better bool
            if !found {
                better = true
            } else {
                better = p.Price < best.Price
            }
            if better {
                best = p
                found = true
            }
        }
    }
    return best, found
}

func main() {
    products := []Product{
        {1, "Widget", 9.99},
        {2, "Gadget", 4.99},
        {3, "Doohickey", 14.99},
        {4, "Thingamajig", 3.99},
    }
    if p, ok := findCheapest(products, 10.0); ok {
        fmt.Printf("Cheapest under $10: %s ($%.2f)\n", p.Name, p.Price)
    }
}
```

<details>
<summary>Hint</summary>
`eligible` and `better` are computed booleans — they should be `:=` inline. The outer `found` and `best` genuinely need `var` because they accumulate state.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

type Product2 struct {
    ID    int
    Name  string
    Price float64
}

func findCheapestOptimized(products []Product2, maxPrice float64) (Product2, bool) {
    var best Product2
    found := false

    for _, p := range products {
        if p.Price > maxPrice {
            continue
        }
        if !found || p.Price < best.Price {
            best = p
            found = true
        }
    }
    return best, found
}

func main() {
    products := []Product2{
        {1, "Widget", 9.99},
        {2, "Gadget", 4.99},
        {3, "Doohickey", 14.99},
        {4, "Thingamajig", 3.99},
    }
    if p, ok := findCheapestOptimized(products, 10.0); ok {
        fmt.Printf("Cheapest under $10: %s ($%.2f)\n", p.Name, p.Price)
    }
}
```

**Why it's better:**
- `eligible` and `better` intermediate variables eliminated — logic is direct
- `found := false` is idiomatic; `var best Product2` signals zero-value intent
- `continue` for early skip is more readable than nested `if`
- The function is 8 lines instead of 20 with no loss of clarity
- Cognitive load reduced: fewer variables to track
</details>

---

## Exercise 11: interface{} to any + Type-Safe Wrapper (Medium / Clarity)

**What the code does:** Stores configuration values in a map.

**The problem:** Using `interface{}` (pre-Go 1.18 style) obscures types. Modern Go (1.18+) uses `any`. Beyond that, the variable declarations can be improved.

```go
package main

import "fmt"

type Config map[string]interface{}

func loadConfig() Config {
    var cfg Config
    cfg = make(Config)  // separate declaration and initialization

    var host interface{}
    host = "localhost"
    cfg["host"] = host

    var port interface{}
    port = 8080
    cfg["port"] = port

    return cfg
}

func getPort(cfg Config) int {
    var portVal interface{}
    var ok bool
    portVal, ok = cfg["port"]
    if !ok {
        return 8080
    }
    var port int
    port, ok = portVal.(int)
    if !ok {
        return 8080
    }
    return port
}

func main() {
    cfg := loadConfig()
    fmt.Println("Port:", getPort(cfg))
}
```

<details>
<summary>Hint</summary>
Combine declarations with their initializations using `:=`. Replace `interface{}` with `any` (Go 1.18+). Remove intermediate single-use variables.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

type Config2 map[string]any  // any is an alias for interface{} (Go 1.18+)

func loadConfig2() Config2 {
    cfg := Config2{   // declare and initialize in one step
        "host": "localhost",
        "port": 8080,
    }
    return cfg
}

func getPort2(cfg Config2) int {
    portVal, ok := cfg["port"]
    if !ok {
        return 8080
    }
    port, ok := portVal.(int)
    if !ok {
        return 8080
    }
    return port
}

func main() {
    cfg := loadConfig2()
    fmt.Println("Port:", getPort2(cfg))
}
```

**Why it's better:**
- `cfg := Config2{...}` is one line vs 3 lines (declare, make, assign)
- Composite literal is clearer and more idiomatic
- `any` instead of `interface{}` is the modern Go convention (Go 1.18+)
- `portVal, ok :=` and `port, ok :=` eliminate unnecessary `var` + separate assignment
- Overall: 40% fewer lines, same functionality
</details>

---

## Exercise 12: sync.Pool for Repeated Allocations (Hard / Performance + Memory)

**What the code does:** Processes many JSON payloads in an HTTP handler.

**The problem:** Every request allocates a new `bytes.Buffer` for decoding. Under load, this creates significant GC pressure.

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

type Payload struct {
    Name  string `json:"name"`
    Value int    `json:"value"`
}

func handlePayload(w http.ResponseWriter, r *http.Request) {
    buf := new(bytes.Buffer)  // NEW allocation per request

    _, err := buf.ReadFrom(r.Body)
    if err != nil {
        http.Error(w, "read error", http.StatusBadRequest)
        return
    }

    var payload Payload
    if err := json.Unmarshal(buf.Bytes(), &payload); err != nil {
        http.Error(w, "parse error", http.StatusBadRequest)
        return
    }

    fmt.Fprintf(w, "received: %s=%d", payload.Name, payload.Value)
}
```

<details>
<summary>Hint</summary>
Use `sync.Pool` with a package-level `var` to reuse `bytes.Buffer` instances across requests. Remember to `Reset()` before use and `Put()` after.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "sync"
)

type Payload2 struct {
    Name  string `json:"name"`
    Value int    `json:"value"`
}

// Package-level pool — declared once, reused across all requests
var bufPool = sync.Pool{
    New: func() interface{} {
        return new(bytes.Buffer)
    },
}

func handlePayloadOptimized(w http.ResponseWriter, r *http.Request) {
    // Get buffer from pool (may reuse existing one)
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()  // clear previous content
    defer bufPool.Put(buf)  // return to pool when done

    if _, err := buf.ReadFrom(r.Body); err != nil {
        http.Error(w, "read error", http.StatusBadRequest)
        return
    }

    var payload Payload2
    if err := json.Unmarshal(buf.Bytes(), &payload); err != nil {
        http.Error(w, "parse error", http.StatusBadRequest)
        return
    }

    fmt.Fprintf(w, "received: %s=%d", payload.Name, payload.Value)
}

func main() {
    http.HandleFunc("/payload", handlePayloadOptimized)
    // http.ListenAndServe(":8080", nil)
    fmt.Println("Handler registered")
}
```

**Why it's better:**
- `var bufPool = sync.Pool{...}` at package level — single declaration, shared across all goroutines
- `sync.Pool` reduces allocations by reusing buffers across requests
- Under load (1000 req/s): reduces from 1000 allocations/s to near 0
- `defer bufPool.Put(buf)` ensures return even on error paths
- `buf.Reset()` clears data while keeping backing memory — key to reuse
- GC pressure drops significantly — measurable with `go tool pprof`
</details>
