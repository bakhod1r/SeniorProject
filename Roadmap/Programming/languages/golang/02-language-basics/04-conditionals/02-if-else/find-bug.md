# Go if-else — Find the Bug

Each bug has a difficulty rating:
- 🟢 Easy — Obvious once spotted
- 🟡 Medium — Requires understanding of Go semantics
- 🔴 Hard — Subtle runtime behavior or compiler edge case

---

## Bug 1 🟢 — Wrong Comparison Operator

```go
package main

import "fmt"

func isAdult(age int) bool {
    if age > 18 {
        return true
    }
    return false
}

func main() {
    fmt.Println(isAdult(18))  // Expected: true, Got: false
    fmt.Println(isAdult(19))  // Expected: true, Got: true
    fmt.Println(isAdult(17))  // Expected: false, Got: false
}
```

<details>
<summary>Hint</summary>
Think about what happens when age is exactly 18. Is someone 18 years old an adult?
</details>

<details>
<summary>Solution</summary>

**Bug:** `age > 18` should be `age >= 18`. The current code excludes 18-year-olds.

```go
func isAdult(age int) bool {
    return age >= 18
}
```

**Root cause:** Off-by-one error. The condition should be "greater than or equal to" to include the boundary value 18.

**Lesson:** Always double-check `>` vs `>=` and `<` vs `<=` at boundaries. This is one of the most common bugs in conditional logic.
</details>

---

## Bug 2 🟢 — Wrong Order of Conditions

```go
package main

import "fmt"

func getGrade(score int) string {
    if score >= 60 {
        return "D"
    } else if score >= 70 {
        return "C"
    } else if score >= 80 {
        return "B"
    } else if score >= 90 {
        return "A"
    }
    return "F"
}

func main() {
    fmt.Println(getGrade(95))  // Expected: A, Got: D
    fmt.Println(getGrade(82))  // Expected: B, Got: D
    fmt.Println(getGrade(45))  // Expected: F, Got: F
}
```

<details>
<summary>Hint</summary>
Go evaluates conditions top-to-bottom and takes the FIRST matching branch. What matches 95 first?
</details>

<details>
<summary>Solution</summary>

**Bug:** Conditions are in the wrong order. `score >= 60` matches first for any score 60+, so scores of 70, 80, 90+ always return "D".

```go
func getGrade(score int) string {
    if score >= 90 {
        return "A"
    } else if score >= 80 {
        return "B"
    } else if score >= 70 {
        return "C"
    } else if score >= 60 {
        return "D"
    }
    return "F"
}
```

**Root cause:** Range-based if-else chains must check the most restrictive condition first.

**Lesson:** When using `>=` in a chain, order from highest to lowest threshold.
</details>

---

## Bug 3 🟢 — Missing else (FizzBuzz)

```go
package main

import "fmt"

func fizzBuzz(n int) string {
    if n%3 == 0 {
        return "Fizz"
    }
    if n%5 == 0 {
        return "Buzz"
    }
    if n%3 == 0 && n%5 == 0 {
        return "FizzBuzz"
    }
    return fmt.Sprintf("%d", n)
}

func main() {
    fmt.Println(fizzBuzz(15))  // Expected: FizzBuzz, Got: Fizz
    fmt.Println(fizzBuzz(3))   // Expected: Fizz, Got: Fizz
    fmt.Println(fizzBuzz(5))   // Expected: Buzz, Got: Buzz
}
```

<details>
<summary>Hint</summary>
For n=15: it's divisible by both 3 and 5. Which check runs first?
</details>

<details>
<summary>Solution</summary>

**Bug:** The "FizzBuzz" condition is checked last, but numbers divisible by both 3 and 5 will match the first condition (`n%3 == 0`) and return "Fizz" before reaching "FizzBuzz".

```go
func fizzBuzz(n int) string {
    if n%3 == 0 && n%5 == 0 {  // Check both first!
        return "FizzBuzz"
    }
    if n%3 == 0 {
        return "Fizz"
    }
    if n%5 == 0 {
        return "Buzz"
    }
    return fmt.Sprintf("%d", n)
}
```

**Root cause:** The most specific condition (divisible by both) must come before the less specific ones.

**Lesson:** Always handle the most specific case before the more general cases.
</details>

---

## Bug 4 🟡 — Typed Nil Interface

```go
package main

import "fmt"

type AppError struct {
    Code    int
    Message string
}

func (e *AppError) Error() string {
    return fmt.Sprintf("error %d: %s", e.Code, e.Message)
}

func getError(fail bool) error {
    var err *AppError
    if fail {
        err = &AppError{404, "not found"}
    }
    return err  // BUG: returns typed nil when fail=false
}

func main() {
    err := getError(false)
    if err != nil {
        fmt.Println("Error occurred:", err)  // This prints unexpectedly!
    } else {
        fmt.Println("No error")
    }
}
```

<details>
<summary>Hint</summary>
In Go, an interface holds two things: a type and a value. What type does `err` have when `fail=false`?
</details>

<details>
<summary>Solution</summary>

**Bug:** `var err *AppError` creates a typed nil. When returned as `error` interface, it becomes `(*AppError)(nil)` — a non-nil interface containing a nil pointer.

An interface is nil only when BOTH the type AND value are nil. `(*AppError)(nil)` has a non-nil type.

```go
func getError(fail bool) error {
    if fail {
        return &AppError{404, "not found"}
    }
    return nil  // FIX: return untyped nil directly
}
```

**Root cause:** Typed nil vs untyped nil — one of Go's most notorious gotchas.

**Detection:** Run `go vet` or use `errcheck` linter. Also: never declare `var err ConcreteType` and return it as an interface.
</details>

---

## Bug 5 🟡 — Shadowed Variable in if Init

```go
package main

import (
    "fmt"
    "strconv"
)

func processNumbers(inputs []string) ([]int, []string) {
    var results []int
    var errors []string

    for _, input := range inputs {
        if n, err := strconv.Atoi(input); err != nil {
            errors = append(errors, err.Error())
        } else {
            results = append(results, n*2)
        }
        // BUG: can you spot it?
        fmt.Println("Processing:", input) // This is fine
    }

    return results, errors
}

func main() {
    results, errs := processNumbers([]string{"1", "abc", "3"})
    fmt.Println("Results:", results)   // Expected: [2, 6], Got: [2, 6]
    fmt.Println("Errors:", errs)       // Expected: 1 error, Got: 1 error
    // The bug is subtle — look at a different version:
    processV2([]string{"1", "abc", "3"})
}

func processV2(inputs []string) {
    total := 0
    for _, input := range inputs {
        if n, err := strconv.Atoi(input); err == nil {
            total = total + n  // using n from init
        }
        // BUG: What if we try to use n here?
        // n is out of scope!
        // fmt.Println(n)  // compile error
    }
    fmt.Println("Total:", total)
}
```

<details>
<summary>Hint</summary>
This bug is about variable scope. What happens when you declare variables in the init statement that you want to use after the if-else block?
</details>

<details>
<summary>Solution</summary>

**Bug (conceptual):** Variables declared in the if-init statement (`n, err`) are scoped only to the if-else block. If you need them after the block, you must declare them outside.

```go
func processV3(inputs []string) {
    total := 0
    for _, input := range inputs {
        // Option 1: Declare outside if you need it after
        n, err := strconv.Atoi(input)
        if err == nil {
            total += n
            fmt.Println("parsed:", n)  // n accessible here
        }
        // n is accessible here too
        fmt.Printf("processed %q -> n=%d, err=%v\n", input, n, err)
    }
    fmt.Println("Total:", total)
}
```

**Lesson:** Init statement scope is a feature (tight scope), but can be a trap if you need the variable after the if-else.
</details>

---

## Bug 6 🟡 — Short-Circuit Not Used for Safety

```go
package main

import "fmt"

type Config struct {
    Settings map[string]string
}

func getValue(cfg *Config, key string) string {
    if cfg.Settings[key] != "" {  // BUG: panics when cfg is nil
        return cfg.Settings[key]
    }
    return "default"
}

func main() {
    fmt.Println(getValue(nil, "theme"))  // PANIC: nil pointer dereference
}
```

<details>
<summary>Hint</summary>
What happens when you access a field on a nil pointer? How can short-circuit evaluation help?
</details>

<details>
<summary>Solution</summary>

**Bug:** When `cfg` is nil, `cfg.Settings` causes a nil pointer dereference panic. The nil check must come before accessing `cfg.Settings`.

```go
func getValue(cfg *Config, key string) string {
    if cfg != nil && cfg.Settings[key] != "" {
        return cfg.Settings[key]
    }
    return "default"
}

// Even better with guard clause:
func getValueSafe(cfg *Config, key string) string {
    if cfg == nil {
        return "default"
    }
    if val := cfg.Settings[key]; val != "" {
        return val
    }
    return "default"
}
```

**Root cause:** Missing nil check before pointer dereference. Short-circuit `&&` ensures right side only evaluated when left is true.

**Lesson:** Always check for nil before accessing fields. Use guard clauses or short-circuit `&&`.
</details>

---

## Bug 7 🟡 — Float Comparison in Condition

```go
package main

import "fmt"

func calculateTax(amount float64) float64 {
    if amount == 100.0 {  // BUG: may never be true for computed floats
        return 10.0
    }
    return amount * 0.1
}

func main() {
    subtotal := 33.33 + 33.33 + 33.34
    fmt.Printf("subtotal = %.10f\n", subtotal)  // May not be exactly 100.0
    tax := calculateTax(subtotal)
    fmt.Printf("tax = %.2f\n", tax)

    // The problem:
    a := 0.1 + 0.2
    if a == 0.3 {
        fmt.Println("equal")  // NEVER prints due to floating point!
    }
    fmt.Printf("0.1 + 0.2 = %.20f\n", a)
}
```

<details>
<summary>Hint</summary>
Floating point arithmetic is not exact. 0.1 + 0.2 in binary floating point is not exactly 0.3.
</details>

<details>
<summary>Solution</summary>

**Bug:** Comparing floating-point numbers with `==` is almost always wrong unless the value comes directly from a literal or a deterministic computation.

```go
import "math"

const epsilon = 1e-9

func floatEqual(a, b float64) bool {
    return math.Abs(a-b) < epsilon
}

func calculateTax(amount float64) float64 {
    if floatEqual(amount, 100.0) {
        return 10.0
    }
    return amount * 0.1
}

// For currency, use integer cents or decimal library
// import "github.com/shopspring/decimal"
```

**Lesson:** Never use `==` to compare computed floating-point values. Use an epsilon comparison or a decimal library for money.
</details>

---

## Bug 8 🔴 — Race Condition in if-else Condition

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Cache struct {
    data map[string]string
    mu   sync.Mutex
}

func (c *Cache) GetOrFetch(key string) string {
    // BUG: check and set are not atomic!
    if _, ok := c.data[key]; !ok {    // Thread 1 checks here
        // Thread 2 also checks here — both see "not found"
        time.Sleep(time.Millisecond)   // simulate fetch latency
        c.mu.Lock()
        c.data[key] = "fetched-" + key  // Both threads write!
        c.mu.Unlock()
    }
    return c.data[key]
}

func main() {
    cache := &Cache{data: make(map[string]string)}
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            cache.GetOrFetch("key1")
        }()
    }
    wg.Wait()
    fmt.Println("Done:", cache.data["key1"])
}
// Also has DATA RACE: reading c.data without lock!
// Run: go test -race to detect
```

<details>
<summary>Hint</summary>
The map read (`c.data[key]`) outside the mutex is a data race. And even with the mutex, check-then-act is a TOCTOU bug.
</details>

<details>
<summary>Solution</summary>

**Bug 1:** Reading `c.data[key]` outside mutex is a data race.
**Bug 2:** Even with locks, the check and the write are not atomic (TOCTOU — Time of Check, Time of Use).

```go
func (c *Cache) GetOrFetch(key string) string {
    // Double-checked locking pattern
    c.mu.Lock()
    defer c.mu.Unlock()

    if val, ok := c.data[key]; ok {
        return val
    }

    // Fetch and store while holding lock
    val := "fetched-" + key
    c.data[key] = val
    return val
}

// For high concurrency, use sync.Map or singleflight:
// import "golang.org/x/sync/singleflight"
```

**Lesson:** Map access in Go is NOT concurrency-safe. Any concurrent read/write requires synchronization. Check-then-set must be atomic.
</details>

---

## Bug 9 🔴 — else Block with Variable Declared in if

```go
package main

import (
    "fmt"
    "os"
)

func readConfig() error {
    if file, err := os.Open("config.json"); err != nil {
        return fmt.Errorf("cannot open config: %w", err)
    }
    // BUG: file is not closed! Where is defer file.Close()?
    // Also: file is out of scope here!

    // Trying to use file here would be a compile error
    // file.Close()  // undefined: file

    return nil
}

// Better: see how to actually handle this
func readConfigFixed() error {
    file, err := os.Open("config.json")
    if err != nil {
        return fmt.Errorf("cannot open config: %w", err)
    }
    defer file.Close()  // Now properly closed

    // Use file...
    _ = file
    return nil
}

func main() {
    if err := readConfig(); err != nil {
        fmt.Println("Error:", err)
    }
}
```

<details>
<summary>Hint</summary>
When you open a file in the if-init statement, where is that file handle accessible? When does it get closed?
</details>

<details>
<summary>Solution</summary>

**Bug:** The `file` opened in the init statement is scoped to the if-else block and is never closed. Resource leak!

```go
func readConfigCorrect() error {
    // Declare outside if-else so defer can access it
    file, err := os.Open("config.json")
    if err != nil {
        return fmt.Errorf("cannot open config: %w", err)
    }
    defer file.Close()  // Now properly deferred

    // Use file...
    _ = file
    return nil
}
```

**Root cause:** Init statement scope means `defer file.Close()` cannot be called inside the if block (it would close before leaving the function's scope), and the variable isn't available after the if-else.

**Lesson:** For resources that need to be closed, declare them before the if statement, not inside it.
</details>

---

## Bug 10 🔴 — Condition with Side Effect Called Multiple Times

```go
package main

import (
    "fmt"
    "time"
)

var callCount int

func checkService() bool {
    callCount++
    fmt.Printf("  [checkService called, count=%d]\n", callCount)
    time.Sleep(10 * time.Millisecond)  // expensive!
    return callCount%2 == 0  // alternates true/false
}

func handleRequest() {
    // BUG: checkService is called TWICE
    if checkService() {
        fmt.Println("Service is up")
    } else if !checkService() {  // Called again here!
        fmt.Println("Service is definitely down")
    } else {
        fmt.Println("Service state unknown")
    }
}

func main() {
    handleRequest()
    fmt.Printf("Total calls: %d (expected: 1)\n", callCount)
}
```

<details>
<summary>Hint</summary>
How many times is `checkService()` called in the if-else chain? What if the function has side effects or is expensive?
</details>

<details>
<summary>Solution</summary>

**Bug:** `checkService()` is called up to twice — once in the `if` condition and potentially once more in the `else if` condition. This:
1. Doubles the latency (10ms × 2)
2. May return different results (state changed between calls)
3. Increments the counter twice

```go
func handleRequestFixed() {
    // Cache the result
    isUp := checkService()  // Called ONCE

    if isUp {
        fmt.Println("Service is up")
    } else {
        fmt.Println("Service is down")
    }
}
```

**Root cause:** Function calls in conditions are re-evaluated for each branch. If the function has side effects or is expensive, always cache the result.

**Lesson:** Never call a function with side effects or significant cost more than once in an if-else chain. Store the result in a variable first.
</details>

---

## Bug 11 🔴 — Nil Map Access in if Condition

```go
package main

import "fmt"

type Router struct {
    routes map[string]func()
}

func (r *Router) Handle(path string) {
    // BUG: if r.routes is nil, this panics
    if handler, ok := r.routes[path]; ok {
        handler()
    } else {
        fmt.Println("404: not found")
    }
}

func main() {
    r := &Router{}  // routes map is nil!
    r.Handle("/home")  // PANIC: assignment to entry in nil map?
    // Actually: reading from nil map is OK in Go, but let's verify...
}
```

<details>
<summary>Hint</summary>
In Go, reading from a nil map is safe (returns zero value). But is WRITING to a nil map safe?
</details>

<details>
<summary>Solution</summary>

**Surprising fact:** Reading from a nil map in Go is SAFE — it returns the zero value and `ok=false`. So `r.routes[path]` when `routes` is nil will return `(nil, false)`, NOT panic.

However, WRITING to a nil map DOES panic:
```go
var m map[string]int
_ = m["key"]   // Safe: returns 0, false
m["key"] = 1   // PANIC: assignment to entry in nil map
```

The actual bug in this code is subtle — `r.routes` being nil might be unexpected behavior for users. Better design:

```go
func NewRouter() *Router {
    return &Router{routes: make(map[string]func())}
}

func (r *Router) Register(path string, handler func()) {
    if r.routes == nil {
        r.routes = make(map[string]func())
    }
    r.routes[path] = handler
}
```

**Lesson:** Reading nil maps is safe in Go. Writing is a panic. Always initialize maps with `make()`.
</details>

---

## Bug 12 🔴 — Logic Error in Complex Boolean

```go
package main

import "fmt"

// Check if user can post: must be verified AND (premium OR admin),
// but NOT banned, and account age > 7 days
func canPost(verified, premium, admin, banned bool, accountAgeDays int) bool {
    // BUG: operator precedence and logic error
    if verified && premium || admin && !banned && accountAgeDays > 7 {
        return true
    }
    return false
}

func main() {
    // Test: banned admin with new account — should be FALSE
    fmt.Println(canPost(true, false, true, true, 1))  // Expected: false
    // Output: true  ← BUG!

    // Why? && has higher precedence than ||
    // Parsed as: (verified && premium) || (admin && !banned && accountAgeDays > 7)
    // For banned=true: (true && false) || (true && false && false) = false || false = false
    // Wait, that's false... let me reconsider the bug

    // Test: unverified premium user — should be FALSE
    fmt.Println(canPost(false, true, false, false, 30))
    // Parsed: (false && true) || (false && true && true) = false || false = false
    // That's correct...

    // The real bug: verified && premium misses accountAgeDays check!
    // A verified premium user with account age = 1 day can post!
    fmt.Println(canPost(true, true, false, false, 1))
    // Expected: FALSE (account too new)
    // Got: TRUE (verified && premium is true, skips accountAgeDays check)
}
```

<details>
<summary>Hint</summary>
The condition `verified && premium` does not check `accountAgeDays > 7`. A premium user with a 1-day-old account can post!
</details>

<details>
<summary>Solution</summary>

**Bug:** The `accountAgeDays > 7` check is missing from the premium path due to incorrect operator grouping.

```go
func canPost(verified, premium, admin, banned bool, accountAgeDays int) bool {
    // Must not be banned
    if banned {
        return false
    }
    // Account must be old enough
    if accountAgeDays <= 7 {
        return false
    }
    // Must be verified
    if !verified {
        return false
    }
    // Must have elevated access
    if !premium && !admin {
        return false
    }
    return true
}

// Or with explicit parentheses:
func canPostExplicit(verified, premium, admin, banned bool, accountAgeDays int) bool {
    return !banned &&
        accountAgeDays > 7 &&
        verified &&
        (premium || admin)
}
```

**Lesson:** Complex boolean conditions are prone to logic errors. Extract named variables or use guard clauses for clarity. Add explicit parentheses when combining `&&` and `||`.
</details>
