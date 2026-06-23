# var vs := — Practical Tasks

## Table of Contents
1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: Fix the Compiler Error
**Type:** Debug
**Goal:** Understand why `:=` cannot be used at package level.

**Starter code:**
```go
package main

import "fmt"

// TODO: This code has a compilation error. Fix it.
// x := 10  // uncomment this line to see the error

var x = 10 // leave this as a hint placeholder

func main() {
    fmt.Println(x)
}
```

**What to do:** Change the commented line `// x := 10` (package level) to a valid declaration and explain why the original was wrong.

**Expected output:**
```
10
```

**Evaluation:**
- [ ] Identified the error (`:=` at package level)
- [ ] Used `var x = 10` or `var x int = 10` instead
- [ ] Can explain why `:=` is not allowed at package level
- [ ] Code compiles and runs without errors

---

### Task 2: Zero Values Explorer
**Type:** Code
**Goal:** Learn what zero values are for each type.

**Starter code:**
```go
package main

import "fmt"

func main() {
    // TODO: Declare one variable of each type using var (no initialization)
    // Then print all of them.

    var i int
    // var f float64
    // var s string
    // var b bool
    // var p *int
    // var sl []int
    // var m map[string]int

    fmt.Println("int:", i)
    // TODO: add fmt.Println for each type you declare
}
```

**Expected output:**
```
int: 0
float64: 0
string:
bool: false
*int: <nil>
[]int: []
map[string]int: map[]
```

**Evaluation:**
- [ ] All 7 types declared with `var` and no initialization
- [ ] Correct zero values printed for each type
- [ ] Student can state the zero value for each type from memory

---

### Task 3: Short Declaration Practice
**Type:** Code
**Goal:** Practice using `:=` for different types.

**Starter code:**
```go
package main

import "fmt"

func main() {
    // TODO: Use := to declare variables for:
    // 1. Your name (string)
    // 2. Your age (int)
    // 3. Your height in meters (float64)
    // 4. Whether you like Go (bool)

    // TODO: Print all variables

    // TODO: Use multiple := to swap two numbers
    // a := 5
    // b := 10
    // swap them
    // fmt.Println(a, b) // should print: 10 5
}
```

**Expected output (example):**
```
Alice 25 1.7 true
10 5
```

**Evaluation:**
- [ ] All variables declared with `:=`
- [ ] Correct types inferred
- [ ] Swap done correctly (either with temp variable or `a, b = b, a`)

---

### Task 4: Package-Level Configuration
**Type:** Code
**Goal:** Practice package-level `var` declarations.

**Starter code:**
```go
package main

import "fmt"

// TODO: Declare package-level variables for:
// - appName (string) = "TaskManager"
// - version (string) = "1.0.0"
// - maxUsers (int) = 100
// - debugMode (bool) = false
// Use a grouped var(...) block.

func main() {
    // TODO: Print a startup banner using the package-level variables
    // Example: "TaskManager v1.0.0 (max users: 100, debug: false)"
    fmt.Println("app started")
}
```

**Expected output:**
```
TaskManager v1.0.0 (max users: 100, debug: false)
```

**Evaluation:**
- [ ] Used grouped `var (...)` block
- [ ] All four variables declared at package level
- [ ] Banner printed correctly
- [ ] No `:=` used at package level

---

### Task 5: Multiple Return Values
**Type:** Code
**Goal:** Practice `:=` with multiple return values and error handling.

**Starter code:**
```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    inputs := []string{"42", "hello", "100", "3.14"}

    for _, input := range inputs {
        // TODO: Use strconv.Atoi to convert input to int
        // Use := to capture both the result and error
        // If there is an error, print "could not parse: <input>"
        // If successful, print "parsed: <number>"
        _ = input
    }
}
```

**Expected output:**
```
parsed: 42
could not parse: hello
parsed: 100
could not parse: 3.14
```

**Evaluation:**
- [ ] Used `:=` correctly with multiple return values
- [ ] Checked error before using result
- [ ] Correct output for all 4 inputs

---

## Middle Tasks

### Task 6: Fix the Shadowing Bug
**Type:** Debug
**Goal:** Identify and fix a variable shadowing bug.

**Starter code:**
```go
package main

import "fmt"

func calculateDiscount(price float64, isPremium bool) float64 {
    discount := 0.0

    if isPremium {
        discount := 0.2  // TODO: Is this correct? Why or why not?
        _ = discount
    }

    // TODO: Also add 5% discount if price > 100
    if price > 100 {
        discount := discount + 0.05  // TODO: Is this correct?
        _ = discount
    }

    return price * (1 - discount)
}

func main() {
    fmt.Printf("Premium price: %.2f\n", calculateDiscount(150.0, true))
    // Expected: 150 * (1 - 0.25) = 112.50

    fmt.Printf("Regular price: %.2f\n", calculateDiscount(150.0, false))
    // Expected: 150 * (1 - 0.05) = 142.50

    fmt.Printf("Small premium: %.2f\n", calculateDiscount(50.0, true))
    // Expected: 50 * (1 - 0.20) = 40.00
}
```

**Expected output:**
```
Premium price: 112.50
Regular price: 142.50
Small premium: 40.00
```

**Evaluation:**
- [ ] Found both shadowing bugs (`:=` should be `=`)
- [ ] Fixed both bugs
- [ ] All three test cases produce correct output
- [ ] Can explain why `:=` caused the bug in each case

---

### Task 7: Scope Management with if-init
**Type:** Code
**Goal:** Practice using if-init statements to limit variable scope.

**Starter code:**
```go
package main

import (
    "fmt"
    "os"
    "strconv"
)

func main() {
    // TODO: Rewrite this code using if-init statements
    // to remove the variables n and err from the outer scope.

    // Current code (without if-init):
    args := os.Args
    if len(args) < 2 {
        fmt.Println("Usage: program <number>")
        return
    }

    n, err := strconv.Atoi(args[1])
    if err != nil {
        fmt.Println("Not a number:", args[1])
        return
    }
    fmt.Println("Square:", n*n)

    // TODO: Rewrite the strconv.Atoi part using if n, err := ...; err != nil { }
    // After rewrite, n and err should not be accessible outside the if block
}
```

**Expected output (run with argument "7"):**
```
Square: 49
```

**Evaluation:**
- [ ] Used if-init syntax correctly
- [ ] `n` and `err` are scoped to the if/else block
- [ ] Code behaves identically to original
- [ ] Outer scope is cleaner (fewer variables)

---

### Task 8: Error Chain with `:=` Re-use
**Type:** Code
**Goal:** Practice the standard Go error-handling chain with `:=`.

**Starter code:**
```go
package main

import (
    "fmt"
    "os"
    "strconv"
    "strings"
)

// processLine reads a line like "Alice:25" and returns name and age
func processLine(line string) (string, int, error) {
    // TODO: Implement using :=
    // Step 1: Split line by ":" — use strings.SplitN(line, ":", 2)
    // Step 2: Check that we got exactly 2 parts
    // Step 3: Parse the age part using strconv.Atoi
    // Step 4: Return name, age, nil on success

    // Use := for all declarations
    // Re-use err across multiple calls
    _ = line
    return "", 0, fmt.Errorf("not implemented")
}

func main() {
    lines := []string{"Alice:25", "Bob:30", "Charlie:abc", "invalid"}

    for _, line := range lines {
        // TODO: Call processLine and handle the result
        _ = line
    }

    _ = os.Stderr
    _ = strings.Split
}
```

**Expected output:**
```
Alice is 25 years old
Bob is 30 years old
Error processing "Charlie:abc": strconv.Atoi: parsing "abc": invalid syntax
Error processing "invalid": invalid format
```

**Evaluation:**
- [ ] `err` is re-used (not re-declared) across multiple `:=` calls
- [ ] Each error case is handled correctly
- [ ] At least one new variable on left of each `:=`
- [ ] Function signature and return values are correct

---

### Task 9: var vs := Audit
**Type:** Code Review
**Goal:** Review code and improve variable declaration style.

**Starter code (to review and fix):**
```go
package main

import (
    "fmt"
    "sync"
)

// TODO: Audit this code and fix all incorrect/non-idiomatic variable declarations.
// There are at least 5 issues to find.

var count int = 0           // Issue 1: ?
var items []string = nil    // Issue 2: ?

func countWords(text string) int {
    var result int = 0       // Issue 3: ?
    var words []string
    words = splitWords(text) // Issue 4: could be better?
    for i := 0; i < len(words); i++ {
        result = result + 1
    }
    return result
}

func safeIncrement() {
    var mu sync.Mutex = sync.Mutex{}  // Issue 5: ?
    mu.Lock()
    defer mu.Unlock()
    count++
}

func splitWords(s string) []string {
    return []string{s}
}

func main() {
    text := "hello world foo"
    n := countWords(text)
    fmt.Println(n)
}
```

**Evaluation:**
- [ ] Found and fixed at least 5 issues
- [ ] `var count int = 0` → `var count int` (zero value redundant)
- [ ] `var items []string = nil` → `var items []string`
- [ ] `var result int = 0` → `result := 0` or `var result int`
- [ ] `var words []string; words = ...` → `words := splitWords(...)`
- [ ] `var mu sync.Mutex = sync.Mutex{}` → `var mu sync.Mutex`

---

### Task 10: Build a Simple In-Memory Store
**Type:** Code
**Goal:** Use both `var` and `:=` correctly in a realistic mini-application.

**Starter code:**
```go
package main

import "fmt"

// Store is a simple in-memory key-value store
type Store struct {
    // TODO: add a map field (zero value should work)
    data map[string]string
}

// Set stores a key-value pair
func (s *Store) Set(key, value string) {
    // TODO: implement (initialize map if nil, then set)
}

// Get retrieves a value by key
// Returns the value and a bool indicating if it was found
func (s *Store) Get(key string) (string, bool) {
    // TODO: implement
    return "", false
}

// Delete removes a key
func (s *Store) Delete(key string) {
    // TODO: implement
}

func main() {
    // TODO: Create a Store using var (zero value should work)
    // Set "name" → "Alice"
    // Set "city" → "NYC"
    // Get and print "name"
    // Get and print "unknown" (should show not found)
    // Delete "city"
    // Try to get "city" again (should show not found)
    var s Store
    _ = s
}
```

**Expected output:**
```
name: Alice (found: true)
unknown:  (found: false)
city after delete:  (found: false)
```

**Evaluation:**
- [ ] `Store` has a useful zero value (no explicit initialization needed)
- [ ] `var s Store` works without calling `NewStore()`
- [ ] All three methods implemented correctly
- [ ] Used `:=` inside functions where appropriate
- [ ] Used `var` for zero-value struct

---

## Senior Tasks

### Task 11: Custom Static Analyzer
**Type:** Code
**Goal:** Write a basic Go analyzer that detects `:=` in init functions.

**Starter code:**
```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
)

// findInitColonEquals finds := used to assign package-level variables in init()
// This is a common bug pattern.
func findInitColonEquals(src string) []string {
    fset := token.NewFileSet()
    f, err := parser.ParseFile(fset, "test.go", src, 0)
    if err != nil {
        return nil
    }

    var issues []string

    // TODO: Walk the AST
    // Find all init() functions
    // Inside each init(), find AssignStmt with Tok == token.DEFINE (:=)
    // For each such statement, check if any left-hand side identifier
    // matches a package-level variable name
    // Add an issue string like "line N: := used for package-level var X in init()"

    ast.Inspect(f, func(n ast.Node) bool {
        // TODO: implement
        _ = n
        return true
    })

    return issues
}

func main() {
    src := `package main
import "database/sql"
var db *sql.DB
func init() {
    db, err := sql.Open("postgres", "dsn")
    if err != nil { panic(err) }
    _ = db
}
`
    issues := findInitColonEquals(src)
    for _, issue := range issues {
        fmt.Println(issue)
    }
}
```

**Expected output:**
```
line 5: := used for package-level var 'db' in init()
```

**Evaluation:**
- [ ] AST walking implemented correctly
- [ ] Detects `:=` (token.DEFINE) inside `init()` functions
- [ ] Matches left-hand side names against package-level var names
- [ ] Reports correct line numbers
- [ ] Does not false-positive on purely local variables in init()

---

### Task 12: Benchmark Stack vs Heap Allocation
**Type:** Code + Benchmark
**Goal:** Measure the difference between stack-allocated and heap-allocated variables.

**Starter code:**
```go
package main_test

import "testing"

// StackResult holds an int by value (no escape)
func sumStack(n int) int {
    // TODO: accumulate sum in a local int variable (stays on stack)
    result := 0
    for i := 0; i < n; i++ {
        result += i
    }
    return result
}

// HeapResult returns a pointer (forces heap allocation)
func sumHeap(n int) *int {
    // TODO: accumulate sum in a local int variable, return pointer
    result := 0
    for i := 0; i < n; i++ {
        result += i
    }
    return &result
}

func BenchmarkSumStack(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        // TODO: call sumStack and use the result
        x := sumStack(1000)
        _ = x
    }
}

func BenchmarkSumHeap(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        // TODO: call sumHeap and use the result
        x := sumHeap(1000)
        _ = x
    }
}
```

**Expected output (approximate):**
```
BenchmarkSumStack-8    1000000    ~500 ns/op    0 B/op    0 allocs/op
BenchmarkSumHeap-8      500000   ~520 ns/op    8 B/op    1 allocs/op
```

**Evaluation:**
- [ ] Both benchmarks run without error
- [ ] `-benchmem` flag shows 0 allocs for stack version
- [ ] `-benchmem` flag shows 1 alloc for heap version
- [ ] Student can explain why the pointer version allocates
- [ ] Student runs `go build -gcflags='-m'` to confirm escape analysis

---

## Questions

**Q1:** What is the zero value of `chan int`?

**A1:** `nil`. A nil channel blocks forever on send and receive. You must use `make(chan int)` to create a usable channel.

**Q2:** Can you use `:=` to assign to a variable inside a struct?

**A2:** No. `:=` only works with simple identifiers. `s.Field := 5` is a compile error. Use `s.Field = 5`.

**Q3:** What does `var x interface{}` give you?

**A3:** A variable of type `interface{}` (or `any`) with zero value `nil`. It can hold any value.

**Q4:** Why does `var x = nil` fail to compile?

**A4:** Go cannot infer the type of `nil`. You must specify a type: `var x *int = nil` or `var x interface{} = nil`.

**Q5:** Is it possible to have an unused package-level variable?

**A5:** Yes. The "declared and not used" rule only applies to local function variables. Package-level variables can be unused (the compiler does not complain). However, tools like `deadcode` or `unused` (from golangci-lint) can detect them.

---

## Mini Projects

### Mini Project 1: CLI Argument Parser
**Goal:** Build a minimal command-line argument parser that uses both `var` and `:=` correctly.

```go
package main

import (
    "fmt"
    "os"
    "strconv"
)

var (
    programName = os.Args[0]
    // TODO: add more package-level config
)

// parseArgs parses os.Args and returns a map of flag→value
func parseArgs(args []string) map[string]string {
    result := make(map[string]string)
    // TODO: implement simple "--key=value" and "--flag" parsing
    // Use := for all local variables
    for i := 1; i < len(args); i++ {
        arg := args[i]
        _ = arg
        // parse and add to result
    }
    return result
}

func main() {
    flags := parseArgs(os.Args)

    if verbose, ok := flags["--verbose"]; ok {
        fmt.Println("verbose mode:", verbose)
    }

    if port, ok := flags["--port"]; ok {
        if n, err := strconv.Atoi(port); err == nil {
            fmt.Println("port:", n)
        }
    }

    fmt.Println("program:", programName)
}
```

### Mini Project 2: Simple HTTP Server with Config
**Goal:** Build a minimal HTTP server that uses package-level `var` for config and `:=` for request handling.

```go
package main

import (
    "fmt"
    "net/http"
    "os"
    "time"
)

var (
    // TODO: Declare package-level config vars for:
    // addr    = ":8080" (from env PORT or default)
    // timeout = 30 * time.Second
    addr    = getEnvOrDefault("PORT", "8080")
    timeout = 30 * time.Second
)

func getEnvOrDefault(key, def string) string {
    if v := os.Getenv(key); v != "" {
        return ":" + v
    }
    return ":" + def
}

func handler(w http.ResponseWriter, r *http.Request) {
    // TODO: use := for all local variables
    start := time.Now()
    msg := fmt.Sprintf("Hello from %s", r.URL.Path)
    elapsed := time.Since(start)
    fmt.Fprintf(w, "%s (took %v)", msg, elapsed)
}

func main() {
    srv := &http.Server{
        Addr:         addr,
        Handler:      http.HandlerFunc(handler),
        ReadTimeout:  timeout,
        WriteTimeout: timeout,
    }
    fmt.Println("Listening on", addr)
    srv.ListenAndServe()
}
```

---

## Challenge

### Challenge: Zero-Value Chain
**Difficulty:** Hard
**Goal:** Design and implement a type where every field has a meaningful zero value, and prove it works.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

// RateLimiter allows N requests per Duration.
// It must work correctly when declared as:
//   var rl RateLimiter
// (without calling any constructor).
//
// TODO: Design RateLimiter so its zero value is valid.
// Use sync.Mutex (zero = unlocked), time.Time (zero = beginning of time), etc.
type RateLimiter struct {
    mu       sync.Mutex
    limit    int
    window   time.Duration
    count    int
    windowAt time.Time
    // TODO: add fields as needed
}

// Allow returns true if the request is within the rate limit.
// If the window has expired, reset the counter.
func (r *RateLimiter) Allow(limit int, window time.Duration) bool {
    r.mu.Lock()
    defer r.mu.Unlock()

    now := time.Now()

    // TODO: implement
    // If zero value (windowAt is zero time), initialize the window
    // If window has expired, reset count and windowAt
    // If count < limit, increment and return true
    // Otherwise return false
    _ = now
    _ = limit
    _ = window
    return true
}

func main() {
    // Must work without any constructor call
    var rl RateLimiter

    allowed := 0
    denied := 0
    for i := 0; i < 10; i++ {
        if rl.Allow(5, time.Second) {
            allowed++
        } else {
            denied++
        }
    }
    fmt.Printf("allowed: %d, denied: %d\n", allowed, denied)
    // Expected: allowed: 5, denied: 5
}
```

**Evaluation:**
- [ ] `var rl RateLimiter` works without constructor
- [ ] Zero-value `time.Time` used to detect first use
- [ ] Thread-safe (uses `sync.Mutex`)
- [ ] Correct count of allowed/denied
- [ ] Student can explain which fields use zero-value semantics
