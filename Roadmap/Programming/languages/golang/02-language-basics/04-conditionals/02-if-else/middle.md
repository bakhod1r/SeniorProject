# Go if-else — Middle Level

## Table of Contents
1. Why if-else Exists — Decision Theory
2. How Go's if Differs from Other Languages
3. The Init Statement — Deep Dive
4. Variable Scope and Shadowing in if-else
5. Guard Clauses — The Go Way
6. Avoid else after return
7. Error Handling Patterns with if
8. Sentinel Errors vs Wrapped Errors
9. Multiple Return Values and if
10. Truthiness — Why Go Refuses It
11. Short-Circuit Evaluation — Performance and Safety
12. Comparison of Structs and Interfaces
13. nil Comparisons — Subtle Bugs
14. if-else in Goroutines
15. if-else and Closures
16. Panic vs if-based Error Handling
17. Testing Code That Uses if-else
18. Benchmarking Branch Prediction
19. The Complexity Metric (Cyclomatic Complexity)
20. Refactoring Long if-else Chains
21. Table-Driven Logic as if-else Alternative
22. Function Dispatch as if-else Alternative
23. Strategy Pattern to Replace if-else
24. Anti-Patterns in Go if-else
25. Debugging if-else Logic
26. Evolution of if-else in Go Versions
27. Alternative Approaches: switch, maps, dispatch tables
28. Language Comparison: Go vs Python vs Java vs Rust
29. if-else in Standard Library (Real examples)
30. Debugging Guide: Common Logic Errors

---

## 1. Why if-else Exists — Decision Theory

Conditional execution is the foundation of all computation. Without branching, programs would be simple straight-line machines. The `if-else` construct encodes **binary decisions** in your control flow.

In Go's design philosophy:
- **Explicit over implicit**: Go requires explicit booleans, unlike C's "truthy" values
- **Simple over clever**: Go favors readable if-else over clever ternary tricks
- **Errors as values**: Go's error-as-value model means `if err != nil` is ubiquitous

```go
// Why "if err != nil" is everywhere in Go
// Go's error model forces you to THINK about each error case
func readFile(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, fmt.Errorf("opening %s: %w", path, err)
    }
    defer f.Close()

    data, err := io.ReadAll(f)
    if err != nil {
        return nil, fmt.Errorf("reading %s: %w", path, err)
    }

    return data, nil
}
```

Each `if err != nil` is a deliberate checkpoint. The verbosity is intentional — it forces acknowledgment.

---

## 2. How Go's if Differs from Other Languages

| Feature                    | Go       | C        | Java     | Python   | Rust     |
|----------------------------|----------|----------|----------|----------|----------|
| Parentheses required       | No       | Yes      | Yes      | No       | No       |
| Braces required            | Yes      | No       | Yes      | No       | Yes      |
| Truthy integers            | No       | Yes      | No       | Yes      | No       |
| Ternary operator           | No       | Yes      | Yes      | Yes (?)  | No       |
| Init statement             | Yes      | No       | No       | No       | Yes (let)|
| else on same line required | Yes      | No       | No       | N/A      | No       |

```go
// Go: no ternary. Use if expression result via function or variable
// Python: result = "yes" if condition else "no"
// Go equivalent:
result := "no"
if condition {
    result = "yes"
}

// Or use a helper function
func ternary(cond bool, a, b string) string {
    if cond {
        return a
    }
    return b
}
result := ternary(condition, "yes", "no")
```

---

## 3. The Init Statement — Deep Dive

The init statement is syntactic sugar that keeps variable scope tight:

```go
// Without init statement (variable leaks to outer scope)
result, err := riskyOperation()
if err != nil {
    log.Fatal(err)
}
use(result)
// result and err are still in scope here — potential confusion

// With init statement (clean scope)
if result, err := riskyOperation(); err != nil {
    log.Fatal(err)
} else {
    use(result)
}
// result and err gone — clean

// Most idiomatic: use init + early return
func process() error {
    if err := step1(); err != nil {
        return fmt.Errorf("step1: %w", err)
    }
    if err := step2(); err != nil {
        return fmt.Errorf("step2: %w", err)
    }
    return nil
}
```

**When to use init statement:**
- When the initialized value is ONLY needed in the if-else block
- Error checking with `if err := ...; err != nil`
- When you want to prevent variable pollution

**When NOT to use:**
- When the value is needed after the if-else block
- When it reduces readability for complex expressions

---

## 4. Variable Scope and Shadowing in if-else

```go
package main

import "fmt"

func main() {
    x := 10

    if x := 20; x > 15 {  // This x SHADOWS the outer x
        fmt.Println("inner x:", x)  // prints 20
    }
    fmt.Println("outer x:", x)  // prints 10! Original unchanged

    // More dangerous shadowing
    err := doFirstThing()
    if err != nil {
        return
    }

    // MISTAKE: accidentally shadowing err
    if result, err := doSecondThing(); err != nil {
        // This err is a NEW variable, shadows outer err
        fmt.Println("second error:", err)
        _ = result
    }
    // The outer err here is still the first err
}

func doFirstThing() error  { return nil }
func doSecondThing() (int, error) { return 42, nil }
```

Use `go vet` to catch shadowing issues. The `-shadow` flag in older versions:

```bash
go install golang.org/x/tools/go/analysis/passes/shadow/cmd/shadow@latest
shadow ./...
```

---

## 5. Guard Clauses — The Go Way

Guard clauses eliminate nesting by handling exceptional cases early:

```go
package main

import (
    "errors"
    "fmt"
)

type Order struct {
    UserID   int
    Amount   float64
    Currency string
}

// BAD: Arrow code (nesting increases rightward like an arrow)
func processOrderBad(o *Order) error {
    if o != nil {
        if o.UserID > 0 {
            if o.Amount > 0 {
                if o.Currency != "" {
                    // actual business logic
                    fmt.Println("Processing:", o.Amount, o.Currency)
                    return nil
                } else {
                    return errors.New("currency required")
                }
            } else {
                return errors.New("amount must be positive")
            }
        } else {
            return errors.New("invalid user ID")
        }
    } else {
        return errors.New("order is nil")
    }
}

// GOOD: Guard clauses (flat, readable)
func processOrderGood(o *Order) error {
    if o == nil {
        return errors.New("order is nil")
    }
    if o.UserID <= 0 {
        return errors.New("invalid user ID")
    }
    if o.Amount <= 0 {
        return errors.New("amount must be positive")
    }
    if o.Currency == "" {
        return errors.New("currency required")
    }

    // Happy path — no indentation
    fmt.Println("Processing:", o.Amount, o.Currency)
    return nil
}
```

**The principle**: Handle the error/edge cases first, so the happy path is flat and readable.

---

## 6. Avoid else after return

One of the most important Go idioms: **don't use else after a return statement**.

```go
// BAD: unnecessary else after return
func getDiscount(memberType string) float64 {
    if memberType == "premium" {
        return 0.20
    } else if memberType == "standard" {
        return 0.10
    } else {
        return 0.0
    }
}

// GOOD: drop the else (early returns make it unnecessary)
func getDiscount(memberType string) float64 {
    if memberType == "premium" {
        return 0.20
    }
    if memberType == "standard" {
        return 0.10
    }
    return 0.0
}

// BAD: else after return in error handling
func processInput(s string) (int, error) {
    if s == "" {
        return 0, errors.New("empty input")
    } else {
        n, err := strconv.Atoi(s)
        if err != nil {
            return 0, err
        } else {
            return n * 2, nil
        }
    }
}

// GOOD: flat structure
func processInput(s string) (int, error) {
    if s == "" {
        return 0, errors.New("empty input")
    }
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, err
    }
    return n * 2, nil
}
```

Linters like `staticcheck` and `golangci-lint` flag this pattern.

---

## 7. Error Handling Patterns with if

```go
package main

import (
    "errors"
    "fmt"
    "os"
)

// Pattern 1: Check and return
func readConfig(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("readConfig: %w", err)
    }
    return data, nil
}

// Pattern 2: Check and continue with default
func getEnvOrDefault(key, defaultVal string) string {
    val, ok := os.LookupEnv(key)
    if !ok {
        return defaultVal
    }
    return val
}

// Pattern 3: errors.Is for specific error types
func handleFileError(err error) {
    if err == nil {
        return
    }
    if errors.Is(err, os.ErrNotExist) {
        fmt.Println("File does not exist")
    } else if errors.Is(err, os.ErrPermission) {
        fmt.Println("Permission denied")
    } else {
        fmt.Println("Unknown error:", err)
    }
}

// Pattern 4: errors.As for error types
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error: %s - %s", e.Field, e.Message)
}

func handleError(err error) {
    var ve *ValidationError
    if errors.As(err, &ve) {
        fmt.Printf("Field '%s' failed: %s\n", ve.Field, ve.Message)
    } else {
        fmt.Println("System error:", err)
    }
}
```

---

## 8. Sentinel Errors vs Wrapped Errors

```go
package main

import (
    "errors"
    "fmt"
)

// Sentinel errors (compared with ==)
var (
    ErrNotFound   = errors.New("not found")
    ErrPermission = errors.New("permission denied")
    ErrTimeout    = errors.New("timeout")
)

func findItem(id int) error {
    if id <= 0 {
        return ErrNotFound
    }
    return nil
}

// Checking sentinel errors
func main() {
    err := findItem(-1)
    if err != nil {
        if err == ErrNotFound {
            fmt.Println("Item does not exist")
        } else if err == ErrPermission {
            fmt.Println("Cannot access item")
        }
    }

    // With wrapping (use errors.Is, not ==)
    wrapped := fmt.Errorf("findItem: %w", ErrNotFound)
    if errors.Is(wrapped, ErrNotFound) {
        fmt.Println("Correctly detected wrapped ErrNotFound")
    }
    // wrapped == ErrNotFound would be FALSE (it's wrapped)
    // errors.Is(wrapped, ErrNotFound) is TRUE (unwraps chain)
}
```

---

## 9. Multiple Return Values and if

Go functions often return `(value, error)`. The if-init pattern is perfect for this:

```go
package main

import (
    "fmt"
    "strconv"
)

func parseAndDouble(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parseAndDouble: %w", err)
    }
    return n * 2, nil
}

func main() {
    inputs := []string{"5", "abc", "10", ""}

    for _, input := range inputs {
        if result, err := parseAndDouble(input); err != nil {
            fmt.Printf("Error for %q: %v\n", input, err)
        } else {
            fmt.Printf("Result for %q: %d\n", input, result)
        }
    }
}
```

The two-value return with `ok` idiom (maps, type assertions, channel receives):

```go
// Map lookup
m := map[string]int{"a": 1, "b": 2}
if val, ok := m["a"]; ok {
    fmt.Println("Found:", val)
} else {
    fmt.Println("Not found")
}

// Type assertion
var i interface{} = "hello"
if s, ok := i.(string); ok {
    fmt.Println("String:", s)
}

// Channel receive with context
select {
case v, ok := <-ch:
    if !ok {
        fmt.Println("Channel closed")
        return
    }
    fmt.Println("Received:", v)
}
```

---

## 10. Truthiness — Why Go Refuses It

Languages like C, Python, JavaScript allow "truthy" values in conditions. Go explicitly rejects this.

```go
// In C: if (ptr) { ... }   -- OK, checks non-null
// In Python: if my_list: { ... }  -- OK, checks non-empty
// In Go: NONE of these work

var ptr *int
// if ptr { }  // ERROR: ptr (type *int) is not bool

nums := []int{1, 2, 3}
// if nums { }  // ERROR: nums (type []int) is not bool

// Go forces you to be explicit
if ptr != nil { fmt.Println("non-nil") }
if len(nums) > 0 { fmt.Println("non-empty") }
```

**Why?** Go's designers believe:
- Implicit truthiness hides bugs (e.g., `0` is falsy in C/Python, but is `0` a valid value in your domain?)
- Explicit comparisons make code self-documenting
- Reduces cognitive load — you always know what's being tested

---

## 11. Short-Circuit Evaluation — Performance and Safety

```go
package main

import (
    "fmt"
    "time"
)

func expensiveCheck() bool {
    time.Sleep(100 * time.Millisecond)
    return true
}

func cheapCheck() bool {
    return false
}

func main() {
    start := time.Now()

    // cheapCheck() is false, so expensiveCheck() is NEVER called (&&)
    if cheapCheck() && expensiveCheck() {
        fmt.Println("both true")
    }

    fmt.Println("Elapsed:", time.Since(start)) // ~0ms, not 100ms

    // Safety: nil check prevents panic
    var m map[string]int
    key := "x"
    // Without short-circuit: m[key] would panic if m is nil
    if m != nil && m[key] > 0 {
        fmt.Println("found")
    }

    // With ||: if first is true, second skipped
    isAdmin := true
    if isAdmin || expensivePermissionCheck() {
        fmt.Println("allowed")  // expensivePermissionCheck not called
    }
}

func expensivePermissionCheck() bool {
    time.Sleep(500 * time.Millisecond)
    return false
}
```

**Optimization tip**: In `&&` chains, put the cheapest/most-likely-false check first. In `||` chains, put the cheapest/most-likely-true check first.

---

## 12. Comparison of Structs and Interfaces

```go
package main

import "fmt"

type Point struct {
    X, Y int
}

func main() {
    p1 := Point{1, 2}
    p2 := Point{1, 2}
    p3 := Point{3, 4}

    // Structs with comparable fields can use ==
    if p1 == p2 {
        fmt.Println("Equal points")
    }
    if p1 != p3 {
        fmt.Println("Different points")
    }

    // Interfaces: compared by (type, value)
    var i, j interface{}
    i = 42
    j = 42
    if i == j {
        fmt.Println("Same interface value")  // true
    }

    i = []int{1, 2}
    // if i == j { }  // PANIC: comparing slices via interface
    // Use reflect.DeepEqual for deep comparison
}
```

---

## 13. nil Comparisons — Subtle Bugs

The most common subtle bug in Go if-else:

```go
package main

import "fmt"

type MyError struct {
    Message string
}
func (e *MyError) Error() string { return e.Message }

// This function has a bug!
func getBuggyError(fail bool) error {
    var err *MyError  // typed nil
    if fail {
        err = &MyError{"something went wrong"}
    }
    return err  // Returns typed nil, NOT untyped nil!
}

func main() {
    err := getBuggyError(false)
    if err != nil {
        fmt.Println("BUG: This prints even though we expect no error!")
        fmt.Printf("err type: %T, value: %v\n", err, err)
    }

    // Fix: return untyped nil
    // return nil  // not: return err (when err is typed nil)
}

// Correct version
func getCorrectError(fail bool) error {
    if fail {
        return &MyError{"something went wrong"}
    }
    return nil  // untyped nil
}
```

This is one of the most notorious Go gotchas: an interface holds `(type, value)`. A typed nil (`*MyError(nil)`) is NOT equal to an untyped nil interface.

---

## 14. if-else in Goroutines

```go
package main

import (
    "fmt"
    "sync"
)

func processItems(items []int, threshold int) {
    var wg sync.WaitGroup
    var mu sync.Mutex
    results := make([]string, 0, len(items))

    for _, item := range items {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            var result string
            // if-else inside goroutine — each goroutine has its own stack
            if n > threshold {
                result = fmt.Sprintf("%d: above threshold", n)
            } else {
                result = fmt.Sprintf("%d: below threshold", n)
            }
            mu.Lock()
            results = append(results, result)
            mu.Unlock()
        }(item)
    }

    wg.Wait()
    for _, r := range results {
        fmt.Println(r)
    }
}

func main() {
    processItems([]int{1, 5, 10, 3, 8, 2}, 5)
}
```

Note: The if-else itself is not a concurrency concern — the concurrent issue is accessing shared state (results).

---

## 15. if-else and Closures

```go
package main

import "fmt"

// Returning different functions based on condition
func getFormatter(compact bool) func(string, int) string {
    if compact {
        return func(key string, val int) string {
            return fmt.Sprintf("%s=%d", key, val)
        }
    } else {
        return func(key string, val int) string {
            return fmt.Sprintf("%-20s: %d", key, val)
        }
    }
}

func main() {
    compact := getFormatter(true)
    verbose := getFormatter(false)

    fmt.Println(compact("items", 42))
    fmt.Println(verbose("items", 42))

    // Closure capture — be careful
    funcs := make([]func(), 3)
    for i := 0; i < 3; i++ {
        i := i  // New variable per iteration (pre-1.22 fix)
        if i%2 == 0 {
            funcs[i] = func() { fmt.Println("even:", i) }
        } else {
            funcs[i] = func() { fmt.Println("odd:", i) }
        }
    }
    for _, f := range funcs {
        f()
    }
}
```

---

## 16. Panic vs if-based Error Handling

```go
package main

import "fmt"

// When to panic:
// 1. Programming errors (shouldn't happen at runtime)
// 2. Initialization failures that prevent startup

func mustParseConfig(path string) *Config {
    cfg, err := parseConfig(path)
    if err != nil {
        panic(fmt.Sprintf("cannot parse config %s: %v", path, err))
    }
    return cfg
}

// When to use if err != nil:
// 1. Expected failure conditions (file not found, network timeout)
// 2. User input errors
// 3. Any recoverable situation

type Config struct{}

func parseConfig(path string) (*Config, error) {
    if path == "" {
        return nil, fmt.Errorf("path cannot be empty")
    }
    return &Config{}, nil
}

func main() {
    // Use if for recoverable errors
    cfg, err := parseConfig("/etc/app.conf")
    if err != nil {
        fmt.Println("Using default config:", err)
        cfg = &Config{}
    }
    _ = cfg

    // panic/recover for non-recoverable situations
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("Recovered:", r)
        }
    }()
    mustParseConfig("")  // Will panic, caught by recover
}
```

---

## 17. Testing Code That Uses if-else

```go
package main

import (
    "testing"
)

func classify(n int) string {
    if n < 0 {
        return "negative"
    } else if n == 0 {
        return "zero"
    } else {
        return "positive"
    }
}

func TestClassify(t *testing.T) {
    tests := []struct {
        name  string
        input int
        want  string
    }{
        {"negative", -1, "negative"},
        {"zero", 0, "zero"},
        {"positive", 1, "positive"},
        {"large negative", -1000, "negative"},
        {"large positive", 1000, "positive"},
        // Boundary values
        {"min int", -2147483648, "negative"},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := classify(tt.input)
            if got != tt.want {
                t.Errorf("classify(%d) = %q, want %q", tt.input, got, tt.want)
            }
        })
    }
}
```

**Coverage goal**: Each branch of if-else should be tested. Use `go test -cover` to verify.

---

## 18. Benchmarking Branch Prediction

Modern CPUs predict branches. Unpredictable branches are slower:

```go
package main

import (
    "math/rand"
    "testing"
)

func sumPositives(data []int) int {
    sum := 0
    for _, v := range data {
        if v > 0 {
            sum += v
        }
    }
    return sum
}

func BenchmarkSortedData(b *testing.B) {
    // Sorted data: CPU can predict the branch well
    data := make([]int, 1000)
    for i := range data {
        data[i] = i - 500  // -500 to 499
    }
    // sort.Ints(data)  // sorting would help branch prediction
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sumPositives(data)
    }
}

func BenchmarkRandomData(b *testing.B) {
    // Random data: CPU cannot predict branches
    data := make([]int, 1000)
    for i := range data {
        data[i] = rand.Intn(2000) - 1000
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sumPositives(data)
    }
}
```

---

## 19. The Complexity Metric (Cyclomatic Complexity)

Cyclomatic complexity counts independent paths through code. Each `if` adds 1.

```go
// Complexity 1 (no branches)
func add(a, b int) int { return a + b }

// Complexity 2 (one if)
func abs(n int) int {
    if n < 0 {
        return -n
    }
    return n
}

// Complexity 5 (four conditions)
func classify(n int, isSpecial bool) string {
    if n < 0 {                  // +1
        if isSpecial {          // +1
            return "special negative"
        }
        return "negative"
    } else if n == 0 {          // +1
        return "zero"
    } else if n > 1000 {        // +1
        return "large"
    }
    return "positive"
}
// Total complexity: 1 (base) + 4 (branches) = 5
```

**Guidelines**:
- 1-5: Simple, low risk
- 6-10: Moderate complexity
- 11+: High complexity, consider refactoring

Use `gocyclo` or `golangci-lint` to measure:

```bash
go install github.com/fzipp/gocyclo/cmd/gocyclo@latest
gocyclo -over 10 .
```

---

## 20. Refactoring Long if-else Chains

```go
// BEFORE: long if-else chain
func getStatusMessage(status int) string {
    if status == 200 {
        return "OK"
    } else if status == 201 {
        return "Created"
    } else if status == 400 {
        return "Bad Request"
    } else if status == 401 {
        return "Unauthorized"
    } else if status == 403 {
        return "Forbidden"
    } else if status == 404 {
        return "Not Found"
    } else if status == 500 {
        return "Internal Server Error"
    } else {
        return "Unknown"
    }
}

// AFTER: map lookup
var statusMessages = map[int]string{
    200: "OK",
    201: "Created",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
}

func getStatusMessage(status int) string {
    if msg, ok := statusMessages[status]; ok {
        return msg
    }
    return "Unknown"
}
```

---

## 21. Table-Driven Logic as if-else Alternative

```go
package main

import "fmt"

type Rule struct {
    Check   func(int) bool
    Message string
}

func validateAge(age int) []string {
    rules := []Rule{
        {func(a int) bool { return a < 0 }, "Age cannot be negative"},
        {func(a int) bool { return a > 150 }, "Age seems unrealistic"},
        {func(a int) bool { return a < 18 }, "Must be 18 or older"},
    }

    var errors []string
    for _, rule := range rules {
        if rule.Check(age) {
            errors = append(errors, rule.Message)
        }
    }
    return errors
}

func main() {
    for _, age := range []int{-1, 200, 15, 25} {
        errs := validateAge(age)
        if len(errs) > 0 {
            fmt.Printf("Age %d: %v\n", age, errs)
        } else {
            fmt.Printf("Age %d: valid\n", age)
        }
    }
}
```

---

## 22. Function Dispatch as if-else Alternative

```go
package main

import "fmt"

type Handler func(data string) string

var commandHandlers = map[string]Handler{
    "greet": func(d string) string { return "Hello, " + d },
    "upper": func(d string) string {
        result := ""
        for _, c := range d {
            if c >= 'a' && c <= 'z' {
                result += string(c - 32)
            } else {
                result += string(c)
            }
        }
        return result
    },
    "reverse": func(d string) string {
        runes := []rune(d)
        for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
            runes[i], runes[j] = runes[j], runes[i]
        }
        return string(runes)
    },
}

func dispatch(command, data string) string {
    handler, ok := commandHandlers[command]
    if !ok {
        return "unknown command: " + command
    }
    return handler(data)
}

func main() {
    fmt.Println(dispatch("greet", "World"))
    fmt.Println(dispatch("upper", "hello"))
    fmt.Println(dispatch("reverse", "golang"))
    fmt.Println(dispatch("unknown", "data"))
}
```

---

## 23. Strategy Pattern to Replace if-else

```go
package main

import "fmt"

// Instead of if-else on type, use interfaces
type Discounter interface {
    Discount(price float64) float64
    Name() string
}

type PremiumDiscount struct{}
func (p PremiumDiscount) Discount(price float64) float64 { return price * 0.80 }
func (p PremiumDiscount) Name() string { return "Premium (20% off)" }

type StandardDiscount struct{}
func (s StandardDiscount) Discount(price float64) float64 { return price * 0.90 }
func (s StandardDiscount) Name() string { return "Standard (10% off)" }

type NoDiscount struct{}
func (n NoDiscount) Discount(price float64) float64 { return price }
func (n NoDiscount) Name() string { return "No discount" }

func getDiscounter(memberType string) Discounter {
    switch memberType {
    case "premium":
        return PremiumDiscount{}
    case "standard":
        return StandardDiscount{}
    default:
        return NoDiscount{}
    }
}

func checkout(price float64, memberType string) {
    d := getDiscounter(memberType)
    final := d.Discount(price)
    fmt.Printf("%s: $%.2f -> $%.2f\n", d.Name(), price, final)
}

func main() {
    checkout(100.0, "premium")
    checkout(100.0, "standard")
    checkout(100.0, "guest")
}
```

---

## 24. Anti-Patterns in Go if-else

```go
// Anti-pattern 1: else after return
func bad1(x int) string {
    if x > 0 {
        return "positive"
    } else {  // unnecessary else
        return "non-positive"
    }
}

// Anti-pattern 2: Negation confusion
func bad2(isValid bool) {
    if !isValid == false {  // double negation — confusing!
        // ...
    }
    // BETTER:
    if isValid {
        // ...
    }
}

// Anti-pattern 3: Empty else
func bad3(x int) {
    if x > 0 {
        fmt.Println("positive")
    } else {
        // nothing here
    }
}

// Anti-pattern 4: Condition always true/false
func bad4(x int) {
    if x > 0 || true {  // always true!
        fmt.Println("this always runs")
    }
}

// Anti-pattern 5: Assigning in condition (not Go, but conceptual)
// Anti-pattern 6: Deeply nested (>3 levels)
// Anti-pattern 7: Giant else blocks (prefer early return)
```

---

## 25. Debugging if-else Logic

```go
package main

import (
    "fmt"
    "log"
)

// Debugging tip 1: Log which branch was taken
func processWithLogging(x int) string {
    if x < 0 {
        log.Printf("DEBUG: taking negative branch, x=%d", x)
        return "negative"
    } else if x == 0 {
        log.Printf("DEBUG: taking zero branch")
        return "zero"
    }
    log.Printf("DEBUG: taking positive branch, x=%d", x)
    return "positive"
}

// Debugging tip 2: Extract condition to named variable
func validateUser(age int, hasID bool, isVIP bool) bool {
    isAdult := age >= 18
    hasValidAccess := hasID || isVIP
    canEnter := isAdult && hasValidAccess

    fmt.Printf("isAdult=%v, hasValidAccess=%v, canEnter=%v\n",
        isAdult, hasValidAccess, canEnter)

    return canEnter
}

// Debugging tip 3: Use fmt.Println strategically in test
func main() {
    fmt.Println(processWithLogging(-3))
    fmt.Println(processWithLogging(0))
    fmt.Println(processWithLogging(7))
    fmt.Println(validateUser(20, false, true))
}
```

---

## 26. Evolution of if-else in Go Versions

Go's if-else syntax has been stable since Go 1.0 (2012). Key changes:

- **Go 1.18 (2022)**: Generics introduced — `if` can now appear in generic functions with type constraints
- **Go 1.22 (2024)**: Loop variable scoping changed, but if-else unchanged
- The init statement has always been part of Go's syntax

```go
// Go 1.18+ generic function using if-else
func Max[T int | float64](a, b T) T {
    if a > b {
        return a
    }
    return b
}
```

---

## 27. Alternative Approaches: switch, maps, dispatch tables

```go
// When if-else becomes too long, alternatives exist:

// 1. switch — for discrete values
switch x {
case 1: doA()
case 2: doB()
default: doC()
}

// 2. map — for lookup-based dispatch
handlers := map[string]func(){
    "cmd1": doA,
    "cmd2": doB,
}
if h, ok := handlers[cmd]; ok {
    h()
}

// 3. Interface dispatch — for behavior-based selection
type Processor interface { Process() }
func run(p Processor) { p.Process() }

// 4. Function tables
actions := []func() bool{checkA, checkB, checkC}
for _, action := range actions {
    if action() { break }
}
```

---

## 28. Language Comparison: Go vs Python vs Java vs Rust

```
Feature              Go              Python          Java            Rust
---------------------------------------------------------------------------
Syntax               if x > 0 {}    if x > 0:       if (x > 0) {}   if x > 0 {}
Parens required?     No             No              Yes             No
Braces required?     Yes            No (indent)     Yes             Yes
Ternary operator?    No             a if c else b   c ? a : b       No (match)
Truthy non-booleans? No             Yes             No (strict)     No
else placement?      Same line      Newline OK      Newline OK      Same line
Init statement?      Yes            No              No              Yes (let)
Pattern matching?    No (type sw.)  3.10+ match     No              Yes (match)
Null checks?         nil != null    None            null            Option<T>
```

---

## 29. if-else in Standard Library (Real examples)

```go
// From fmt package (simplified)
func (f *fmt) fmtInteger(u uint64, base int, isSigned bool, verb rune, digits string) {
    if isSigned {
        // handle signed
    } else {
        // handle unsigned
    }
}

// From net/http package
if r.Method != http.MethodGet {
    http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
    return
}

// From database/sql
if db.maxIdleClosed > 0 {
    db.maybeOpenNewConnections()
}

// From os package
func Open(name string) (*File, error) {
    return OpenFile(name, O_RDONLY, 0)
}

func OpenFile(name string, flag int, perm FileMode) (*File, error) {
    if name == "" {
        return nil, &PathError{Op: "open", Path: name, Err: syscall.ENOENT}
    }
    // ...
}
```

---

## 30. Debugging Guide: Common Logic Errors

| Error | Example | Fix |
|-------|---------|-----|
| Wrong operator | `if x = 5` (assign) | Use `==` |
| Off-by-one | `if age > 18` misses exact 18 | Use `>=` |
| Wrong order of conditions | Larger range before smaller | Order matters! |
| Unreachable else | Two conditions that always match | Analyze condition coverage |
| Type mismatch | `if int32 == int` | Explicit conversion |
| Shadowed variable | Inner `x` hides outer `x` | Rename variable |
| Typed nil | Returns typed nil as error | Return untyped `nil` |
| Missing parentheses in complex expressions | `a && b \|\| c` | Use `(a && b) \|\| c` |

```go
// Off-by-one example
age := 18
if age > 18 {  // BUG: 18-year-olds are excluded
    fmt.Println("adult")
}
if age >= 18 {  // CORRECT: includes exactly 18
    fmt.Println("adult")
}

// Wrong order of conditions
score := 95
if score >= 60 {  // BUG: matches before checking for A
    fmt.Println("D")
} else if score >= 90 {
    fmt.Println("A")  // NEVER REACHED
}
// CORRECT: check higher values first
if score >= 90 {
    fmt.Println("A")
} else if score >= 60 {
    fmt.Println("D")
}
```
