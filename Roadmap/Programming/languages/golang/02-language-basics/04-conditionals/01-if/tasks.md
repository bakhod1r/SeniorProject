# if Statement — Practice Tasks

## Task 1: Basic Conditionals (Beginner)

**Goal:** Practice basic `if`, `else if`, `else` syntax.

**Requirements:**
- Write a `grade(score int) string` function
- Returns: "A" (90+), "B" (80-89), "C" (70-79), "D" (60-69), "F" (below 60)
- Handle negative scores and scores > 100 with "invalid"
- Print results for: -1, 45, 60, 70, 80, 90, 100, 101

**Starter Code:**
```go
package main

import "fmt"

func grade(score int) string {
    // TODO: implement using if-else if-else
    return ""
}

func main() {
    scores := []int{-1, 45, 60, 70, 80, 90, 100, 101}
    for _, s := range scores {
        fmt.Printf("score=%-4d grade=%s\n", s, grade(s))
    }
}
```

**Expected Output:**
```
score=-1   grade=invalid
score=45   grade=F
score=60   grade=D
score=70   grade=C
score=80   grade=B
score=90   grade=A
score=100  grade=A
score=101  grade=invalid
```

**Evaluation Checklist:**
- [ ] No parentheses around condition
- [ ] Braces always used
- [ ] All 8 test cases produce correct output
- [ ] "invalid" case handles both < 0 and > 100

---

## Task 2: Error Checking with `if` (Beginner)

**Goal:** Practice the `if err != nil` pattern.

**Requirements:**
- Function `parseAndDouble(s string) (int, error)` that:
  - Parses `s` as integer using `strconv.Atoi`
  - If parsing fails, returns 0 and the error
  - If value is negative, returns 0 and `errors.New("value must be non-negative")`
  - Otherwise returns `value * 2` and nil
- Test with: "42", "-5", "abc", "0", "100"

**Starter Code:**
```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

func parseAndDouble(s string) (int, error) {
    // TODO: use if err := strconv.Atoi(s); err != nil { }
    // TODO: check if negative
    // TODO: return doubled value
    return 0, nil
}

func main() {
    inputs := []string{"42", "-5", "abc", "0", "100"}
    for _, input := range inputs {
        result, err := parseAndDouble(input)
        if err != nil {
            fmt.Printf("input=%-5q error=%v\n", input, err)
        } else {
            fmt.Printf("input=%-5q result=%d\n", input, result)
        }
    }
}
```

**Expected Output:**
```
input="42"  result=84
input="-5"  error=value must be non-negative
input="abc" error=strconv.Atoi: parsing "abc": invalid syntax
input="0"   result=0
input="100" result=200
```

**Evaluation Checklist:**
- [ ] Uses `if err := strconv.Atoi(s); err != nil` init-statement pattern
- [ ] Negative value check with custom error
- [ ] All 5 test cases correct
- [ ] Error checking with `if err != nil` in main

---

## Task 3: Guard Clauses (Beginner-Intermediate)

**Goal:** Refactor nested if to guard clauses.

**Requirements:**
- Start with the nested version (provided in starter)
- Refactor `processPayment` to use guard clauses
- Add proper error messages for each failure case
- Keep the same behavior, just flatten the nesting

**Starter Code:**
```go
package main

import (
    "errors"
    "fmt"
)

type Payment struct {
    Amount    float64
    Currency  string
    CardToken string
    UserID    int
}

// NESTED version (refactor this):
func processPaymentNested(p Payment) error {
    if p.Amount > 0 {
        if p.Currency != "" {
            if p.CardToken != "" {
                if p.UserID > 0 {
                    fmt.Printf("Processing $%.2f %s for user %d\n",
                        p.Amount, p.Currency, p.UserID)
                    return nil
                } else {
                    return errors.New("invalid user ID")
                }
            } else {
                return errors.New("card token required")
            }
        } else {
            return errors.New("currency required")
        }
    } else {
        return errors.New("amount must be positive")
    }
}

// TODO: implement using guard clauses
func processPayment(p Payment) error {
    return nil
}

func main() {
    payments := []Payment{
        {Amount: 99.99, Currency: "USD", CardToken: "tok_123", UserID: 42},
        {Amount: -5, Currency: "USD", CardToken: "tok_123", UserID: 42},
        {Amount: 10, Currency: "", CardToken: "tok_123", UserID: 42},
        {Amount: 10, Currency: "EUR", CardToken: "", UserID: 42},
        {Amount: 10, Currency: "EUR", CardToken: "tok_456", UserID: 0},
    }

    for i, p := range payments {
        fmt.Printf("Payment %d: ", i+1)
        if err := processPayment(p); err != nil {
            fmt.Printf("FAILED — %v\n", err)
        } else {
            fmt.Println("OK")
        }
    }
}
```

**Evaluation Checklist:**
- [ ] Guard clause version has at most 1 level of nesting (no nesting for success path)
- [ ] Same 5 test cases pass
- [ ] All error messages match the nested version
- [ ] Flat, readable code

---

## Task 4: `if` Init Statement Scope (Intermediate)

**Goal:** Understand and use variable scoping in `if` init statements.

**Requirements:**
- Write `lookupConfig(key string) (string, bool)` that reads from a hardcoded map
- Use `if val, ok := lookupConfig(key); ok { }` pattern
- Write `loadAllConfigs(keys []string) (map[string]string, []string)` that:
  - Returns found configs as map
  - Returns list of missing keys
- Demonstrate that `val` and `ok` are not accessible outside the `if`

**Starter Code:**
```go
package main

import "fmt"

var config = map[string]string{
    "host":     "localhost",
    "port":     "8080",
    "database": "mydb",
}

func lookupConfig(key string) (string, bool) {
    // TODO: look up key in config map
    return "", false
}

func loadAllConfigs(keys []string) (found map[string]string, missing []string) {
    found = make(map[string]string)
    // TODO: for each key, use if val, ok := lookupConfig(key); ok { }
    // if found: add to found map
    // if missing: add to missing list
    return
}

func main() {
    keys := []string{"host", "port", "database", "timeout", "retry_count"}

    found, missing := loadAllConfigs(keys)

    fmt.Println("Found configs:")
    for k, v := range found {
        fmt.Printf("  %s = %s\n", k, v)
    }

    fmt.Println("Missing keys:")
    for _, k := range missing {
        fmt.Printf("  %s\n", k)
    }
}
```

**Expected Output:**
```
Found configs:
  host = localhost
  port = 8080
  database = mydb
Missing keys:
  timeout
  retry_count
```

**Evaluation Checklist:**
- [ ] Uses `if val, ok := lookupConfig(key); ok` pattern
- [ ] `val` and `ok` not used outside the if block
- [ ] Found map has 3 entries
- [ ] Missing list has 2 entries

---

## Task 5: Boolean Short-Circuit Safety (Intermediate)

**Goal:** Use short-circuit evaluation for safe nil dereference.

**Requirements:**
- Create a `Node` struct with `Value int`, `Next *Node`
- Write `safeNext(n *Node) *Node` that returns `n.Next` or nil if n is nil
- Write `safeValue(n *Node) (int, bool)` that returns n.Value or (0, false) if n is nil
- Write `findFirst(head *Node, target int) *Node` using `&&` short-circuit safely
- Build a linked list and test traversal

**Starter Code:**
```go
package main

import "fmt"

type Node struct {
    Value int
    Next  *Node
}

func safeNext(n *Node) *Node {
    // TODO: use if n != nil to avoid panic
    return nil
}

func safeValue(n *Node) (int, bool) {
    // TODO: return (0, false) if n is nil
    return 0, false
}

func findFirst(head *Node, target int) *Node {
    current := head
    for current != nil {
        // TODO: use short-circuit: current != nil && current.Value == target
        if current.Value == target {
            return current
        }
        current = current.Next
    }
    return nil
}

func main() {
    // Build: 1 → 2 → 3 → 4 → 5 → nil
    head := &Node{1, &Node{2, &Node{3, &Node{4, &Node{5, nil}}}}}

    // Test safeValue
    if v, ok := safeValue(head); ok {
        fmt.Println("Head value:", v) // 1
    }
    if v, ok := safeValue(nil); ok {
        fmt.Println("Should not print:", v)
    } else {
        fmt.Println("Nil node: no value")
    }

    // Test findFirst
    if n := findFirst(head, 3); n != nil {
        fmt.Println("Found 3, next value:", n.Next.Value) // 4
    }
    if n := findFirst(head, 99); n != nil {
        fmt.Println("Found 99") // should not print
    } else {
        fmt.Println("99 not found")
    }
}
```

**Evaluation Checklist:**
- [ ] `safeValue(nil)` returns (0, false) — no panic
- [ ] `safeNext(nil)` returns nil — no panic
- [ ] Uses `if n != nil && ...` pattern
- [ ] All test cases pass

---

## Task 6: Multi-Layer Validation (Intermediate)

**Goal:** Build a layered validation system using `if` guard clauses.

**Requirements:**
- `UserRegistration` struct: `Name`, `Email`, `Password`, `Age int`
- `validateName(name string) error`: non-empty, 2-50 chars
- `validateEmail(email string) error`: non-empty, contains `@` and `.`
- `validatePassword(pass string) error`: 8+ chars, must contain at least one digit
- `validateAge(age int) error`: 18-120
- `validateRegistration(reg UserRegistration) []error`: collects ALL errors (not fail-fast)

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
    "unicode"
)

type UserRegistration struct {
    Name     string
    Email    string
    Password string
    Age      int
}

func validateName(name string) error {
    // TODO: guard clauses for length checks
    return nil
}

func validateEmail(email string) error {
    // TODO: guard clauses for @ and . checks
    return nil
}

func validatePassword(pass string) error {
    // TODO: length check, then digit check
    return nil
}

func validateAge(age int) error {
    // TODO: range check
    return nil
}

func validateRegistration(reg UserRegistration) []error {
    var errs []error
    // TODO: call each validator, collect non-nil errors
    return errs
}

func main() {
    regs := []UserRegistration{
        {"Alice", "alice@example.com", "password1", 25},    // valid
        {"", "bad-email", "short", 15},                      // all invalid
        {"Bob", "bob@test.com", "nodigits!", 30},            // password invalid
        {"X", "valid@email.com", "valid123", 200},           // name + age invalid
    }

    for i, reg := range regs {
        errs := validateRegistration(reg)
        if len(errs) == 0 {
            fmt.Printf("Registration %d: VALID\n", i+1)
        } else {
            fmt.Printf("Registration %d: %d error(s)\n", i+1, len(errs))
            for _, e := range errs {
                fmt.Printf("  - %v\n", e)
            }
        }
    }
}
```

**Evaluation Checklist:**
- [ ] All validators use guard clauses (not nested if)
- [ ] `validateRegistration` collects ALL errors (not just first)
- [ ] Registration 1 is valid
- [ ] Registration 2 has 4 errors
- [ ] Password validation checks for digit

---

## Task 7: Error Wrapping and `if` Dispatch (Intermediate-Advanced)

**Goal:** Practice error wrapping and dispatching errors in `if` conditions.

**Requirements:**
- Define sentinel errors: `ErrNotFound`, `ErrPermission`, `ErrTimeout`
- `fetchResource(id string, userRole string) (*Resource, error)` that:
  - Returns `ErrNotFound` if id doesn't exist
  - Returns `ErrPermission` if userRole is not "admin"
  - Wraps errors: `fmt.Errorf("fetchResource: %w", err)`
- HTTP handler that dispatches error to status code using `errors.Is`

**Starter Code:**
```go
package main

import (
    "errors"
    "fmt"
    "net/http"
)

var (
    ErrNotFound   = errors.New("not found")
    ErrPermission = errors.New("permission denied")
    ErrTimeout    = errors.New("timeout")
)

type Resource struct {
    ID   string
    Data string
}

var db = map[string]*Resource{
    "r1": {ID: "r1", Data: "secret data"},
    "r2": {ID: "r2", Data: "public data"},
}

func fetchResource(id string, userRole string) (*Resource, error) {
    // TODO: check if id exists, return wrapped ErrNotFound if not
    // TODO: check if userRole == "admin", return wrapped ErrPermission if not
    // TODO: return the resource
    return nil, nil
}

func handler(w http.ResponseWriter, r *http.Request) {
    id := r.URL.Query().Get("id")
    role := r.Header.Get("X-Role")

    resource, err := fetchResource(id, role)
    if err != nil {
        // TODO: use errors.Is to dispatch to correct status code
        // ErrNotFound → 404
        // ErrPermission → 403
        // default → 500
        return
    }

    fmt.Fprintf(w, "Resource: %s", resource.Data)
}

func main() {
    // Test without HTTP server
    tests := []struct{ id, role string }{
        {"r1", "admin"},
        {"r1", "user"},
        {"r99", "admin"},
    }

    for _, t := range tests {
        r, err := fetchResource(t.id, t.role)
        if err != nil {
            switch {
            case errors.Is(err, ErrNotFound):
                fmt.Printf("id=%s role=%s → 404 Not Found\n", t.id, t.role)
            case errors.Is(err, ErrPermission):
                fmt.Printf("id=%s role=%s → 403 Forbidden\n", t.id, t.role)
            default:
                fmt.Printf("id=%s role=%s → 500 Error: %v\n", t.id, t.role, err)
            }
        } else {
            fmt.Printf("id=%s role=%s → 200 Data: %s\n", t.id, t.role, r.Data)
        }
    }
}
```

**Expected Output:**
```
id=r1 role=admin → 200 Data: secret data
id=r1 role=user → 403 Forbidden
id=r99 role=admin → 404 Not Found
```

**Evaluation Checklist:**
- [ ] `errors.Is` correctly detects wrapped errors
- [ ] All 3 test cases produce correct output
- [ ] `fmt.Errorf("...: %w", err)` used for wrapping

---

## Task 8: `if` with Concurrency (Advanced)

**Goal:** Practice thread-safe `if` checks with atomic operations.

**Requirements:**
- `OnceValue[T]` struct: computes a value only once, returns cached value thereafter
- Uses `sync.Mutex` to prevent race conditions
- `Get(compute func() T) T` method: uses `if` to check if already computed
- Test with multiple goroutines calling `Get` concurrently

**Starter Code:**
```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type OnceValue[T any] struct {
    mu       sync.Mutex
    computed bool
    value    T
}

func (o *OnceValue[T]) Get(compute func() T) T {
    o.mu.Lock()
    defer o.mu.Unlock()

    // TODO: if not yet computed, call compute() and store result
    // TODO: return cached value

    return o.value
}

func main() {
    callCount := 0
    var ov OnceValue[string]

    compute := func() string {
        callCount++
        time.Sleep(10 * time.Millisecond) // simulate work
        return fmt.Sprintf("computed-%d", callCount)
    }

    // Call from multiple goroutines
    var wg sync.WaitGroup
    results := make([]string, 5)

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            results[i] = ov.Get(compute)
        }(i)
    }

    wg.Wait()

    // All results should be the same (computed only once)
    for i, r := range results {
        fmt.Printf("goroutine %d: %s\n", i, r)
    }
    fmt.Printf("compute() called: %d time(s)\n", callCount)
    // Expected: 1 time
}
```

**Evaluation Checklist:**
- [ ] `compute()` is called exactly once
- [ ] All 5 goroutines get the same value
- [ ] `if !o.computed` guards the computation
- [ ] No data race (test with: `go test -race`)

---

## Task 9: Feature Flag System (Advanced)

**Goal:** Build a feature flag system using `if` for runtime toggling.

**Requirements:**
- `FeatureFlags` struct with flags loaded from environment or config
- `IsEnabled(name string) bool` method
- Handlers use `if flags.IsEnabled("new_checkout")` to switch behavior
- Support overriding flags at runtime
- Test that flags correctly switch behavior

**Starter Code:**
```go
package main

import (
    "fmt"
    "os"
    "sync"
)

type FeatureFlags struct {
    mu    sync.RWMutex
    flags map[string]bool
}

func NewFeatureFlags() *FeatureFlags {
    flags := map[string]bool{}

    // TODO: load from environment variables
    // e.g., FEATURE_NEW_CHECKOUT=true → flags["new_checkout"] = true
    for _, key := range []string{"NEW_CHECKOUT", "DARK_MODE", "BETA_SEARCH"} {
        envKey := "FEATURE_" + key
        if val := os.Getenv(envKey); val == "true" {
            // TODO: add to flags map (use lowercase snake_case key)
        }
    }

    return &FeatureFlags{flags: flags}
}

func (f *FeatureFlags) IsEnabled(name string) bool {
    f.mu.RLock()
    defer f.mu.RUnlock()
    return f.flags[name]
}

func (f *FeatureFlags) Set(name string, enabled bool) {
    f.mu.Lock()
    defer f.mu.Unlock()
    // TODO: set flag
}

func checkoutPage(flags *FeatureFlags) string {
    if flags.IsEnabled("new_checkout") {
        return "new checkout experience"
    }
    return "legacy checkout"
}

func main() {
    flags := NewFeatureFlags()

    fmt.Println("Default:", checkoutPage(flags))  // legacy checkout

    flags.Set("new_checkout", true)
    fmt.Println("After enable:", checkoutPage(flags))  // new checkout experience

    flags.Set("new_checkout", false)
    fmt.Println("After disable:", checkoutPage(flags))  // legacy checkout
}
```

**Evaluation Checklist:**
- [ ] `IsEnabled` returns `false` for unknown flags (zero value of map)
- [ ] `Set` correctly toggles flags
- [ ] `checkoutPage` switches behavior based on flag
- [ ] Thread-safe with RWMutex
- [ ] Environment variable loading works

---

## Task 10: Circuit Breaker with `if` State Machine (Advanced)

**Goal:** Implement a simple circuit breaker using `if` for state transitions.

**Requirements:**
- States: "closed" (normal), "open" (failing), "half-open" (testing recovery)
- Transitions: closed→open (on threshold failures), open→half-open (after timeout), half-open→closed (on success), half-open→open (on failure)
- `Allow() bool`: returns whether a request should be allowed
- `RecordSuccess()` and `RecordFailure()` update state
- Test the state machine with a sequence of successes and failures

**Starter Code:**
```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type CircuitBreaker struct {
    mu           sync.Mutex
    state        string // "closed", "open", "half-open"
    failures     int
    lastFailure  time.Time
    threshold    int
    timeout      time.Duration
}

func NewCircuitBreaker(threshold int, timeout time.Duration) *CircuitBreaker {
    return &CircuitBreaker{
        state:     "closed",
        threshold: threshold,
        timeout:   timeout,
    }
}

func (cb *CircuitBreaker) Allow() bool {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    if cb.state == "closed" {
        return true
    }

    if cb.state == "open" {
        // TODO: if timeout has passed, transition to half-open and allow
        // Otherwise, deny
        return false
    }

    // half-open: allow one test request
    return true
}

func (cb *CircuitBreaker) RecordSuccess() {
    cb.mu.Lock()
    defer cb.mu.Unlock()
    // TODO: if half-open, close the circuit (reset failures, state = "closed")
}

func (cb *CircuitBreaker) RecordFailure() {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    cb.failures++
    cb.lastFailure = time.Now()

    // TODO: if failures >= threshold, open the circuit
    // TODO: if half-open, go back to open
}

func main() {
    cb := NewCircuitBreaker(3, 50*time.Millisecond)

    simulate := func(success bool) {
        if cb.Allow() {
            if success {
                cb.RecordSuccess()
                fmt.Printf("  → allowed, success (state: %s)\n", cb.state)
            } else {
                cb.RecordFailure()
                fmt.Printf("  → allowed, failure (state: %s)\n", cb.state)
            }
        } else {
            fmt.Printf("  → BLOCKED (state: %s)\n", cb.state)
        }
    }

    fmt.Println("3 failures → open:")
    simulate(false)
    simulate(false)
    simulate(false)

    fmt.Println("\n2 blocked requests:")
    simulate(false)
    simulate(false)

    fmt.Println("\nWait for timeout, then half-open:")
    time.Sleep(60 * time.Millisecond)
    simulate(true) // should allow and close

    fmt.Println("\nClosed again:")
    simulate(true)
    simulate(true)
}
```

**Evaluation Checklist:**
- [ ] State transitions implemented correctly (all 4 transitions)
- [ ] Requests blocked in "open" state
- [ ] Timeout correctly transitions to "half-open"
- [ ] Success in "half-open" closes the circuit
- [ ] Failure in "half-open" reopens the circuit
- [ ] Thread-safe with mutex
