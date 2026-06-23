# Go if-else — Interview Questions

## Question Categories
- Junior (Q1–Q7): Basic syntax and usage
- Middle (Q8–Q14): Why, when, design decisions
- Senior (Q15–Q18): Internals and system design
- Scenario (Q19–Q22): Real-world problems
- FAQ (Q23–Q25): Common gotchas

---

## Junior Questions

### Q1: What is the syntax of if-else in Go? How does it differ from C?

**Answer:**

```go
// Go syntax
if condition {
    // true branch
} else {
    // false branch
}
```

Key differences from C:
1. **No parentheses** required around condition (but allowed)
2. **Braces `{}` are mandatory** — even for single statements
3. **Condition must be `bool`** — Go has no truthy integers
4. **`else` must be on same line** as closing `}` (due to auto-semicolon insertion)
5. **Optional init statement**: `if x := getValue(); x > 0 {}`

```go
// C: if (x > 0) doSomething();
// Go: if x > 0 { doSomething() }

// Go: no ternary operator
// C: result = x > 0 ? "pos" : "neg";
// Go: result := "neg"; if x > 0 { result = "pos" }
```

---

### Q2: What is the init statement in Go's if-else?

**Answer:**

The init statement runs before the condition is evaluated. Variables declared in it are scoped to the entire if-else block.

```go
// Syntax: if initStmt; condition { }
if err := doSomething(); err != nil {
    log.Fatal(err)
}

// err is NOT accessible here — out of scope

// Common use: map lookup
if val, ok := myMap[key]; ok {
    fmt.Println("Found:", val)
} else {
    fmt.Println("Not found")
    // val and ok are still accessible here!
}
```

Benefits:
- Limits variable scope to where it's needed
- Prevents accidental use of variables after the if-else
- Idiomatic Go error handling

---

### Q3: Why does the following code NOT compile?

```go
if x > 0 {
    fmt.Println("positive")
}
else {
    fmt.Println("non-positive")
}
```

**Answer:**

Go's lexer inserts automatic semicolons. After `}` at the end of a line, a semicolon is inserted, resulting in:

```go
if x > 0 {
    fmt.Println("positive")
};    // <-- automatic semicolon inserted!
else {  // SYNTAX ERROR: unexpected else
    ...
}
```

The fix: put `else` on the same line as `}`:

```go
if x > 0 {
    fmt.Println("positive")
} else {
    fmt.Println("non-positive")
}
```

---

### Q4: What is wrong with this code?

```go
x := 5
if x {
    fmt.Println("truthy")
}
```

**Answer:**

This does NOT compile in Go. `x` is of type `int`, and Go requires the condition to be of type `bool`. Unlike C, Python, or JavaScript, Go does not have "truthy" values.

Fix:
```go
if x != 0 {
    fmt.Println("non-zero")
}
// or
if x > 0 {
    fmt.Println("positive")
}
```

This is by design — Go forces you to be explicit about what you're checking.

---

### Q5: What is the difference between = and == in an if condition?

**Answer:**

- `=` is assignment
- `==` is equality comparison

In Go, `=` inside an if condition is a compile error:

```go
x := 5
if x = 10 { }  // ERROR: x = 10 is an assignment, not a condition

if x == 10 { }  // CORRECT: comparison returning bool
```

Unlike C (where `if (x = 10)` silently assigns and evaluates to true), Go's type system catches this because an assignment is not a boolean expression.

---

### Q6: Explain short-circuit evaluation with && and ||.

**Answer:**

- `&&` (AND): If the left side is `false`, the right side is **never evaluated**
- `||` (OR): If the left side is `true`, the right side is **never evaluated**

```go
// Safe nil check: second condition not evaluated if user is nil
if user != nil && user.IsActive {
    // safe to access user.IsActive
}

// Short-circuit for performance: cheap check first
if quickCheck() && expensiveCheck() {
    // expensiveCheck only called if quickCheck is true
}

// OR: fallback to default if first fails
if readFromCache() || readFromDB() {
    // readFromDB only called if cache miss
}
```

---

### Q7: What does the following print and why?

```go
if x := 10; x > 5 {
    fmt.Println("inside if:", x)
} else {
    fmt.Println("inside else:", x)
}
// fmt.Println("outside:", x)  // What happens here?
```

**Answer:**

```
inside if: 10
```

The `x := 10` in the init statement scopes `x` to the entire if-else block. The commented line would cause a compile error: `undefined: x`. `x` only exists inside the if-else chain.

---

## Middle Questions

### Q8: When should you use if-else vs switch?

**Answer:**

| Scenario | Use |
|----------|-----|
| 2-3 branches | if-else |
| 4+ branches on same value | switch |
| Range conditions (`x > 0 && x < 10`) | if-else |
| Exact value matching | switch |
| Complex boolean expressions | if-else |
| Type checking (interface) | type switch |

```go
// if-else: range conditions — switch can't express this
if score >= 90 {
    grade = "A"
} else if score >= 80 {
    grade = "B"
}

// switch: exact values — cleaner
switch command {
case "start", "begin":
    startProcess()
case "stop", "end":
    stopProcess()
default:
    fmt.Println("unknown command")
}
```

---

### Q9: What is a guard clause and why is it important?

**Answer:**

A guard clause is an early return/exit that handles exceptional cases first, keeping the happy path flat:

```go
// BAD: deeply nested (arrow code)
func process(order *Order) error {
    if order != nil {
        if order.UserID > 0 {
            if order.Amount > 0 {
                // actual work
                return nil
            } else {
                return errors.New("invalid amount")
            }
        }
    }
    return errors.New("invalid order")
}

// GOOD: guard clauses
func process(order *Order) error {
    if order == nil {
        return errors.New("order is nil")
    }
    if order.UserID <= 0 {
        return errors.New("invalid user")
    }
    if order.Amount <= 0 {
        return errors.New("invalid amount")
    }
    // actual work — flat, readable
    return nil
}
```

Benefits: Readability, reduces cyclomatic complexity, easier to test.

---

### Q10: What is the "typed nil interface" bug in Go?

**Answer:**

```go
type MyError struct{ msg string }
func (e *MyError) Error() string { return e.msg }

// BUG: Returns typed nil — callers' nil check fails!
func getBuggyError(fail bool) error {
    var err *MyError  // typed nil (*MyError)(nil)
    if fail {
        err = &MyError{"failed"}
    }
    return err  // wraps in interface: (*MyError, nil) != (nil, nil)
}

func main() {
    err := getBuggyError(false)
    if err != nil {
        fmt.Println("BUG: this prints!")  // interface is non-nil
    }
}

// FIX: return untyped nil explicitly
func getCorrectError(fail bool) error {
    if fail {
        return &MyError{"failed"}
    }
    return nil  // untyped nil
}
```

An interface holds `(type, value)`. A typed nil `(*MyError)(nil)` is not the same as an untyped nil interface.

---

### Q11: How would you refactor deeply nested if-else?

**Answer:**

Strategies:
1. Guard clauses (early returns)
2. Extract to functions
3. Use switch
4. Table-driven logic

```go
// Original (nested)
func validate(a, b, c int) error {
    if a > 0 {
        if b > 0 {
            if c > 0 {
                return nil
            } else {
                return errors.New("c must be positive")
            }
        } else {
            return errors.New("b must be positive")
        }
    } else {
        return errors.New("a must be positive")
    }
}

// Refactored (guard clauses)
func validate(a, b, c int) error {
    if a <= 0 { return errors.New("a must be positive") }
    if b <= 0 { return errors.New("b must be positive") }
    if c <= 0 { return errors.New("c must be positive") }
    return nil
}

// Refactored (table-driven)
func validate2(values map[string]int) error {
    for name, val := range values {
        if val <= 0 {
            return fmt.Errorf("%s must be positive", name)
        }
    }
    return nil
}
```

---

### Q12: Why should you avoid else after return?

**Answer:**

When you return inside an `if` block, the `else` is syntactically redundant and adds visual noise:

```go
// BAD: else is unnecessary (return exits the function)
func abs(n int) int {
    if n < 0 {
        return -n
    } else {    // unnecessary else
        return n
    }
}

// GOOD: cleaner
func abs(n int) int {
    if n < 0 {
        return -n
    }
    return n
}
```

This is enforced by `staticcheck` (S1023). The "else after return" pattern adds cognitive overhead — the reader must track whether the return was taken.

---

### Q13: How do you test all branches of an if-else?

**Answer:**

1. Use table-driven tests with a case for each branch
2. Include boundary values
3. Use `go test -cover` to verify coverage
4. Consider mutation testing

```go
func classify(n int) string {
    if n < 0    { return "negative" }
    if n == 0   { return "zero" }
    return "positive"
}

func TestClassify(t *testing.T) {
    tests := []struct {
        in   int
        want string
    }{
        {-1, "negative"},   // true branch of first if
        {0, "zero"},        // true branch of second if
        {1, "positive"},    // both false — fall through
        {-100, "negative"}, // additional negative case
    }
    for _, tt := range tests {
        if got := classify(tt.in); got != tt.want {
            t.Errorf("classify(%d) = %q; want %q", tt.in, got, tt.want)
        }
    }
}
```

Run: `go test -coverprofile=c.out && go tool cover -html=c.out`

---

### Q14: What's wrong with comparing errors using ==?

**Answer:**

Direct `==` comparison breaks when errors are wrapped with `%w`:

```go
var ErrNotFound = errors.New("not found")

// Works if error is not wrapped
err := ErrNotFound
if err == ErrNotFound { fmt.Println("ok") }

// FAILS if error is wrapped
wrapped := fmt.Errorf("database: %w", ErrNotFound)
if wrapped == ErrNotFound {
    fmt.Println("never printed")  // wrapped != ErrNotFound
}

// CORRECT: use errors.Is (unwraps the chain)
if errors.Is(wrapped, ErrNotFound) {
    fmt.Println("correctly detected")
}
```

Always use `errors.Is` for error comparison since Go 1.13.

---

## Senior Questions

### Q15: How does Go's compiler optimize if-else branches?

**Answer:**

Multiple optimizations:
1. **Dead code elimination**: `if false { ... }` removed at compile time
2. **Constant folding**: `if 5 > 3 { }` → always true, else removed
3. **Branch prediction hints**: PGO (Go 1.20+) reorders branches
4. **CMOV generation**: Simple if-else may compile to conditional move (no branch)
5. **Inlining**: Small if-else functions may be inlined at call site

```asm
# Go: if n < 0 { return -n } return n
# Compiles to (x86-64):
TESTQ   AX, AX      # test n with itself
JGE     positive    # jump if >= 0
NEGQ    AX          # negate: -n
RET
positive:
RET                 # n unchanged
```

With PGO, the compiler can place the "hot" branch as fall-through (faster — avoids the jump instruction).

---

### Q16: Explain the memory ordering implications of if-else in concurrent code.

**Answer:**

if-else itself has no memory ordering guarantees. The conditions can be based on data races:

```go
// DATA RACE: unsynchronized read in if condition
var ready bool  // no synchronization
go func() { ready = true }()
if ready {  // may read stale/partially-written value
    doWork()
}

// CORRECT: use atomic for simple flag
var ready atomic.Bool
go func() { ready.Store(true) }()
if ready.Load() {
    doWork()
}

// CORRECT: use mutex for complex state
var mu sync.Mutex
var data int
go func() {
    mu.Lock()
    data = 42
    mu.Unlock()
}()

mu.Lock()
if data > 0 {
    fmt.Println(data)
}
mu.Unlock()
```

The key: the condition in if-else must read memory safely. Use `sync/atomic`, mutexes, or channels.

---

### Q17: Design a feature flag system using if-else. What are the tradeoffs?

**Answer:**

```go
package main

import (
    "sync"
    "sync/atomic"
)

// Level 1: Simple bool (fast, atomic)
var newCheckoutEnabled atomic.Bool

func handleCheckout() {
    if newCheckoutEnabled.Load() {
        newCheckout()
    } else {
        oldCheckout()
    }
}

// Level 2: Percentage rollout
type ABFlag struct {
    name    string
    percent int  // 0-100
}

func (f *ABFlag) IsEnabled(userID string) bool {
    h := hash(userID + f.name) % 100
    return int(h) < f.percent
}

// Level 3: Remote config (more complex)
type FlagStore struct {
    mu    sync.RWMutex
    flags map[string]interface{}
}

func (s *FlagStore) Bool(name string) bool {
    s.mu.RLock()
    defer s.mu.RUnlock()
    v, ok := s.flags[name].(bool)
    return ok && v
}

func hash(s string) uint32 {
    var h uint32 = 2166136261
    for i := 0; i < len(s); i++ {
        h ^= uint32(s[i])
        h *= 16777619
    }
    return h
}

func newCheckout() {}
func oldCheckout() {}
```

**Tradeoffs**:
- Atomic bool: O(1), but only on/off
- Percentage rollout: deterministic, requires hashing
- Remote config: flexible, adds network/lock overhead

---

### Q18: What is the cyclomatic complexity of this function, and how would you reduce it?

```go
func processPayment(amount float64, currency string, user *User, isRecurring bool) error {
    if user == nil {
        return errors.New("user required")
    }
    if amount <= 0 {
        return errors.New("positive amount required")
    }
    if currency == "" {
        return errors.New("currency required")
    }
    if isRecurring {
        if user.HasPaymentMethod {
            return chargeRecurring(user, amount, currency)
        } else {
            return errors.New("payment method required for recurring")
        }
    }
    if amount > 10000 {
        if user.IsVerified {
            return chargeHighValue(user, amount, currency)
        } else {
            return errors.New("verification required for high-value")
        }
    }
    return chargeStandard(user, amount, currency)
}
```

**Answer:**

Cyclomatic complexity = 1 + number of decision points = 1 + 7 = 8. This is borderline (target: ≤10).

Reduction strategies:

```go
// Extract validation
func validatePaymentRequest(amount float64, currency string, user *User) error {
    if user == nil { return errors.New("user required") }
    if amount <= 0 { return errors.New("positive amount required") }
    if currency == "" { return errors.New("currency required") }
    return nil
}

// Strategy pattern for payment type
type PaymentStrategy func(*User, float64, string) error

func getStrategy(amount float64, user *User, isRecurring bool) (PaymentStrategy, error) {
    switch {
    case isRecurring && !user.HasPaymentMethod:
        return nil, errors.New("payment method required for recurring")
    case isRecurring:
        return chargeRecurring, nil
    case amount > 10000 && !user.IsVerified:
        return nil, errors.New("verification required for high-value")
    case amount > 10000:
        return chargeHighValue, nil
    default:
        return chargeStandard, nil
    }
}

func processPayment(amount float64, currency string, user *User, isRecurring bool) error {
    if err := validatePaymentRequest(amount, currency, user); err != nil {
        return err
    }
    strategy, err := getStrategy(amount, user, isRecurring)
    if err != nil {
        return err
    }
    return strategy(user, amount, currency)
}
```

type User struct{ HasPaymentMethod, IsVerified bool }
func chargeRecurring(u *User, a float64, c string) error  { return nil }
func chargeHighValue(u *User, a float64, c string) error  { return nil }
func chargeStandard(u *User, a float64, c string) error   { return nil }

---

## Scenario Questions

### Q19: You're debugging a production issue where an if-else condition occasionally misses. What do you check?

**Answer:**

Systematic debugging checklist:

1. **Race condition** — is the variable read/written by multiple goroutines without synchronization?
   ```go
   // Run with: go test -race ./...
   ```

2. **Boundary off-by-one** — is it `>` when it should be `>=`?
   ```go
   if age > 18 { ... }   // misses exactly 18
   if age >= 18 { ... }  // includes 18
   ```

3. **Floating point precision**:
   ```go
   // 0.1 + 0.2 != 0.3 in floating point!
   if 0.1 + 0.2 == 0.3 { ... }  // false!
   // Use: math.Abs(a-b) < epsilon
   ```

4. **Typed nil interface** — returning typed nil from a function that returns error

5. **String comparison** — Unicode normalization issues

6. **Time zones** — `time.Time` comparison with different locations

7. **Wraparound** — integer overflow changing sign

8. **Data mutation** — condition captured in closure, value changes

```go
// Add logging to trace which branch is taken
if condition {
    log.Printf("took true branch: condition=%v", condition)
} else {
    log.Printf("took false branch: condition=%v", condition)
}
```

---

### Q20: How would you implement an approval workflow using if-else?

**Answer:**

```go
package main

import (
    "fmt"
    "time"
)

type RequestStatus int

const (
    Pending RequestStatus = iota
    AutoApproved
    ManualReview
    Rejected
)

type ApprovalRequest struct {
    UserID    string
    Amount    float64
    Category  string
    CreatedAt time.Time
    IsVIP     bool
}

func processApproval(req ApprovalRequest) RequestStatus {
    // Immediate rejection conditions
    if req.Amount <= 0 {
        return Rejected
    }
    if req.UserID == "" {
        return Rejected
    }

    // VIP auto-approval
    if req.IsVIP && req.Amount < 50000 {
        return AutoApproved
    }

    // Category-based rules
    if req.Category == "emergency" {
        return AutoApproved
    }

    // Amount thresholds
    if req.Amount < 1000 {
        return AutoApproved
    }
    if req.Amount < 10000 {
        return ManualReview
    }
    return Rejected  // Too large — auto-reject
}

func main() {
    requests := []ApprovalRequest{
        {UserID: "u1", Amount: 500, Category: "office", IsVIP: false},
        {UserID: "u2", Amount: 5000, Category: "travel", IsVIP: true},
        {UserID: "u3", Amount: 50000, Category: "capital", IsVIP: false},
        {UserID: "u4", Amount: -100, Category: "refund", IsVIP: false},
    }

    statuses := map[RequestStatus]string{
        Pending: "PENDING", AutoApproved: "AUTO_APPROVED",
        ManualReview: "MANUAL_REVIEW", Rejected: "REJECTED",
    }

    for _, r := range requests {
        status := processApproval(r)
        fmt.Printf("User %s, $%.0f -> %s\n", r.UserID, r.Amount, statuses[status])
    }
}
```

---

### Q21: Implement rate limiting using if-else logic.

**Answer:**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type RateLimiter struct {
    mu       sync.Mutex
    requests map[string][]time.Time
    limit    int
    window   time.Duration
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
    return &RateLimiter{
        requests: make(map[string][]time.Time),
        limit:    limit,
        window:   window,
    }
}

func (r *RateLimiter) Allow(clientID string) bool {
    r.mu.Lock()
    defer r.mu.Unlock()

    now := time.Now()
    cutoff := now.Add(-r.window)

    // Get existing requests, filter old ones
    times := r.requests[clientID]
    valid := times[:0]
    for _, t := range times {
        if t.After(cutoff) {
            valid = append(valid, t)
        }
    }

    if len(valid) >= r.limit {
        r.requests[clientID] = valid
        return false  // Rate limit exceeded
    }

    r.requests[clientID] = append(valid, now)
    return true
}

func main() {
    limiter := NewRateLimiter(3, time.Second)
    client := "user-123"

    for i := 0; i < 5; i++ {
        if limiter.Allow(client) {
            fmt.Printf("Request %d: ALLOWED\n", i+1)
        } else {
            fmt.Printf("Request %d: RATE LIMITED\n", i+1)
        }
    }
}
```

---

### Q22: How would you handle multi-region failover using if-else?

**Answer:**

```go
package main

import (
    "context"
    "fmt"
    "time"
)

type Region struct {
    Name     string
    Healthy  bool
    Latency  time.Duration
}

type Request struct {
    ID string
}

type Response struct {
    Data   string
    Region string
}

func fetchFromRegion(ctx context.Context, region Region, req Request) (*Response, error) {
    // Simulate fetch
    if !region.Healthy {
        return nil, fmt.Errorf("region %s is unhealthy", region.Name)
    }
    return &Response{Data: "result", Region: region.Name}, nil
}

func fetchWithFailover(ctx context.Context, req Request, regions []Region) (*Response, error) {
    var lastErr error

    for _, region := range regions {
        if !region.Healthy {
            continue  // Skip unhealthy regions
        }

        resp, err := fetchFromRegion(ctx, region, req)
        if err != nil {
            lastErr = err
            fmt.Printf("Region %s failed: %v, trying next\n", region.Name, err)
            continue
        }

        if resp == nil {
            continue
        }

        // Check latency SLA
        if region.Latency > 500*time.Millisecond {
            fmt.Printf("Region %s is slow (%v), continuing to try others\n",
                region.Name, region.Latency)
        }

        return resp, nil  // Success
    }

    if lastErr != nil {
        return nil, fmt.Errorf("all regions failed, last error: %w", lastErr)
    }
    return nil, fmt.Errorf("no healthy regions available")
}

func main() {
    regions := []Region{
        {Name: "us-east-1", Healthy: false, Latency: 10 * time.Millisecond},
        {Name: "eu-west-1", Healthy: true, Latency: 600 * time.Millisecond},
        {Name: "ap-east-1", Healthy: true, Latency: 50 * time.Millisecond},
    }

    resp, err := fetchWithFailover(context.Background(), Request{ID: "req-1"}, regions)
    if err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Printf("Got response from %s: %s\n", resp.Region, resp.Data)
    }
}
```

---

## FAQ Questions

### Q23: Is there a ternary operator in Go?

**Answer:**

No. Go intentionally omits the ternary operator (`? :`). The Go team's reasoning: ternaries can be chained and nested in ways that reduce readability.

Alternatives:
```go
// Option 1: Regular if-else
var result string
if condition {
    result = "yes"
} else {
    result = "no"
}

// Option 2: Helper function (when used repeatedly)
func ternary(cond bool, a, b string) string {
    if cond { return a }
    return b
}
result := ternary(condition, "yes", "no")

// Option 3: Map (for constant values)
result := map[bool]string{true: "yes", false: "no"}[condition]
```

The map option is a common trick but adds allocation. The function option is more readable for complex logic.

---

### Q24: Can I use if-else inside a defer?

**Answer:**

Yes. `defer` runs a function call, and that function can contain if-else:

```go
package main

import "fmt"

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("Recovered from panic:", r)
        } else {
            fmt.Println("Function completed normally")
        }
    }()

    // Simulating some work
    fmt.Println("Working...")
    // panic("test panic")  // uncomment to test recovery
}
```

Common pattern: `if r := recover(); r != nil` — the init statement `r := recover()` is evaluated when defer runs (at function exit), not when defer is registered.

---

### Q25: What is the difference between if-else and switch in Go?

**Answer:**

```go
// switch is syntactic sugar for a special if-else pattern
// These are equivalent:

// if-else version
if x == 1 {
    doA()
} else if x == 2 {
    doB()
} else if x == 3 {
    doC()
} else {
    doDefault()
}

// switch version (cleaner)
switch x {
case 1:
    doA()
case 2:
    doB()
case 3:
    doC()
default:
    doDefault()
}
```

Key differences:
- `switch` evaluates `x` once; if-else re-evaluates the left side
- `switch` has no implicit `fallthrough`; each case ends with implicit `break`
- `switch` without expression = `switch true` (expressionless switch)
- `switch` supports multiple values per case: `case 1, 2, 3:`
- Both compile to similar machine code for small cases
- Large `switch` (10+ cases) may compile to a jump table (O(1) vs O(n) for if-else chain)

**Performance**: For 4+ cases on the same value, `switch` is generally preferred both for readability and because the compiler can optimize it to a jump table.
