# Go if-else — Optimization Exercises

Each exercise has a difficulty rating:
- 🟢 Easy — Simple refactoring
- 🟡 Medium — Performance or design improvement
- 🔴 Hard — Advanced optimization or architectural change

---

## Exercise 1 🟢 — Eliminate Redundant else After Return

**Problem:** This code uses unnecessary else blocks after return statements.

```go
package main

import "fmt"

func getCategory(score int) string {
    if score >= 90 {
        return "excellent"
    } else if score >= 70 {
        return "good"
    } else if score >= 50 {
        return "average"
    } else {
        return "poor"
    }
}

func processUser(age int, hasSubscription bool) string {
    if age < 18 {
        return "minor"
    } else {
        if hasSubscription {
            return "premium user"
        } else {
            return "free user"
        }
    }
}

func main() {
    fmt.Println(getCategory(95))
    fmt.Println(processUser(25, true))
}
```

**Task:** Remove all unnecessary else blocks without changing behavior.

<details>
<summary>Solution</summary>

```go
func getCategory(score int) string {
    if score >= 90 {
        return "excellent"
    }
    if score >= 70 {
        return "good"
    }
    if score >= 50 {
        return "average"
    }
    return "poor"
}

func processUser(age int, hasSubscription bool) string {
    if age < 18 {
        return "minor"
    }
    if hasSubscription {
        return "premium user"
    }
    return "free user"
}
```

**Why:** After a `return`, the `else` is syntactically redundant. Removing it reduces indentation, flattens the code, and makes the control flow clearer. Staticcheck reports this as S1023.
</details>

---

## Exercise 2 🟢 — Replace if-else with Direct bool Return

**Problem:** These functions use if-else to return true/false when the condition already gives the answer.

```go
package main

import "fmt"

func isEven(n int) bool {
    if n%2 == 0 {
        return true
    } else {
        return false
    }
}

func isPositive(n float64) bool {
    if n > 0 {
        return true
    }
    return false
}

func contains(s []int, target int) bool {
    for _, v := range s {
        if v == target {
            return true
        }
    }
    if true {
        return false
    }
    return false  // unreachable
}

func main() {
    fmt.Println(isEven(4), isPositive(3.14))
}
```

**Task:** Simplify all three functions.

<details>
<summary>Solution</summary>

```go
func isEven(n int) bool {
    return n%2 == 0
}

func isPositive(n float64) bool {
    return n > 0
}

func contains(s []int, target int) bool {
    for _, v := range s {
        if v == target {
            return true
        }
    }
    return false
}
```

**Why:** Boolean expressions already evaluate to `true` or `false`. Wrapping them in `if-else { return true } else { return false }` is verbose noise. The direct `return expr` form is idiomatic Go.
</details>

---

## Exercise 3 🟢 — Replace Long if-else Chain with Map

**Problem:** This lookup function uses a long if-else chain.

```go
package main

import "fmt"

func getCountryCode(country string) string {
    if country == "United States" {
        return "US"
    } else if country == "United Kingdom" {
        return "GB"
    } else if country == "Germany" {
        return "DE"
    } else if country == "France" {
        return "FR"
    } else if country == "Japan" {
        return "JP"
    } else if country == "China" {
        return "CN"
    } else if country == "Australia" {
        return "AU"
    } else if country == "Canada" {
        return "CA"
    } else {
        return "XX"
    }
}

func main() {
    fmt.Println(getCountryCode("Germany"))
    fmt.Println(getCountryCode("Unknown"))
}
```

**Task:** Replace with a map-based lookup. Which approach is faster for large inputs?

<details>
<summary>Solution</summary>

```go
var countryCodes = map[string]string{
    "United States":  "US",
    "United Kingdom": "GB",
    "Germany":        "DE",
    "France":         "FR",
    "Japan":          "JP",
    "China":          "CN",
    "Australia":      "AU",
    "Canada":         "CA",
}

func getCountryCode(country string) string {
    if code, ok := countryCodes[country]; ok {
        return code
    }
    return "XX"
}
```

**Performance:** Map lookup is O(1) average vs O(n) for if-else chain. For 8 entries the difference is tiny, but scales better as entries grow. Map also makes it easy to add entries without modifying function code (Open/Closed Principle).

**Note:** The map is initialized once (package-level `var`), so no per-call allocation.
</details>

---

## Exercise 4 🟡 — Avoid Repeated Function Calls in if-else

**Problem:** The same expensive function is called multiple times in conditions.

```go
package main

import (
    "fmt"
    "time"
)

func getUserLevel(userID string) int {
    time.Sleep(50 * time.Millisecond)  // DB call simulation
    if userID == "admin" {
        return 3
    }
    return 1
}

func handleRequest(userID, action string) string {
    // BUG PATTERN: getUserLevel called 3 times!
    if getUserLevel(userID) >= 3 {
        return "admin action: " + action
    } else if getUserLevel(userID) >= 2 {
        return "moderator action: " + action
    } else if getUserLevel(userID) >= 1 {
        return "user action: " + action
    }
    return "denied"
}

func main() {
    start := time.Now()
    result := handleRequest("user123", "post")
    fmt.Println(result, "took:", time.Since(start))
}
```

**Task:** Optimize to call `getUserLevel` exactly once.

<details>
<summary>Solution</summary>

```go
func handleRequest(userID, action string) string {
    // Call once, store result
    level := getUserLevel(userID)

    if level >= 3 {
        return "admin action: " + action
    }
    if level >= 2 {
        return "moderator action: " + action
    }
    if level >= 1 {
        return "user action: " + action
    }
    return "denied"
}
```

**Performance gain:** 50ms × 3 = 150ms → 50ms × 1 = 50ms. 3x speedup.

**Principle:** Never call a function with side effects or significant cost multiple times in an if-else chain. Always cache the result.
</details>

---

## Exercise 5 🟡 — Replace Nested if-else with Guard Clauses

**Problem:** This deeply nested function is hard to read and test.

```go
package main

import (
    "errors"
    "fmt"
)

func processOrder(userID string, amount float64, currency string, inStock bool) error {
    if userID != "" {
        if amount > 0 {
            if currency == "USD" || currency == "EUR" || currency == "GBP" {
                if inStock {
                    fmt.Printf("Processing order: user=%s, amount=%.2f %s\n",
                        userID, amount, currency)
                    return nil
                } else {
                    return errors.New("item out of stock")
                }
            } else {
                return errors.New("unsupported currency")
            }
        } else {
            return errors.New("amount must be positive")
        }
    } else {
        return errors.New("user ID required")
    }
}

func main() {
    err := processOrder("u123", 99.99, "USD", true)
    fmt.Println(err)
}
```

**Task:** Refactor using guard clauses. Target: max 1 level of nesting.

<details>
<summary>Solution</summary>

```go
import "slices"

var supportedCurrencies = []string{"USD", "EUR", "GBP"}

func processOrder(userID string, amount float64, currency string, inStock bool) error {
    if userID == "" {
        return errors.New("user ID required")
    }
    if amount <= 0 {
        return errors.New("amount must be positive")
    }
    if !slices.Contains(supportedCurrencies, currency) {
        return errors.New("unsupported currency")
    }
    if !inStock {
        return errors.New("item out of stock")
    }

    fmt.Printf("Processing order: user=%s, amount=%.2f %s\n", userID, amount, currency)
    return nil
}
```

**Metrics:**
- Before: 4 levels of nesting, cyclomatic complexity = 5
- After: 0 levels of nesting, cyclomatic complexity = 5 (same logic, better layout)

**Principle:** Guard clauses keep the happy path flat and readable. Errors are handled at the top, success at the bottom.
</details>

---

## Exercise 6 🟡 — Branchless Optimization for Hot Loop

**Problem:** This loop with a branch runs on millions of data points per second.

```go
package main

import (
    "fmt"
    "testing"
)

// Count elements that are in range [lo, hi]
func countInRange(data []int, lo, hi int) int {
    count := 0
    for _, v := range data {
        if v >= lo && v <= hi {
            count++
        }
    }
    return count
}

// Profile shows this function is called 10M times/second
// with random data — branch predictor is ~50% accurate

func BenchmarkCurrent(b *testing.B) {
    data := make([]int, 1000)
    for i := range data {
        data[i] = i % 256
    }
    for i := 0; i < b.N; i++ {
        countInRange(data, 64, 192)
    }
}

func main() {
    data := []int{10, 50, 100, 150, 200, 250}
    fmt.Println(countInRange(data, 50, 200))  // Expected: 4
}
```

**Task:** Implement a branchless version. Benchmark both.

<details>
<summary>Solution</summary>

```go
func countInRangeBranchless(data []int, lo, hi int) int {
    count := 0
    for _, v := range data {
        // (v - lo) >= 0 && (hi - v) >= 0
        // Use unsigned comparison trick: uint(v-lo) <= uint(hi-lo)
        count += int(uint(v-lo) <= uint(hi-lo))
        // true converts to 1, false to 0 — no branch!
    }
    return count
}

// Alternative: using conditional expression via array index
func countInRangeBranchless2(data []int, lo, hi int) int {
    var results [2]int
    for _, v := range data {
        inRange := 0
        if v >= lo && v <= hi {
            inRange = 1
        }
        results[inRange]++
    }
    return results[1]
}
```

**How it works:** `uint(v-lo) <= uint(hi-lo)` — if `v < lo`, then `v-lo` is negative, which as uint32 is a huge number, so `<= uint(hi-lo)` is false. This is a single comparison instead of two, and the result is directly used as 0 or 1.

**Expected speedup:** 10-30% on random data due to eliminated branch mispredictions.

**Warning:** Only use branchless tricks in verified hot paths. Readability suffers.
</details>

---

## Exercise 7 🟡 — Replace if-else with Strategy Pattern

**Problem:** Adding a new payment processor requires modifying a central if-else chain.

```go
package main

import "fmt"

func processPayment(method string, amount float64) (string, error) {
    if method == "credit_card" {
        // Simulate credit card processing
        fee := amount * 0.029
        return fmt.Sprintf("CC: charged %.2f + fee %.2f", amount, fee), nil
    } else if method == "paypal" {
        fee := amount*0.034 + 0.30
        return fmt.Sprintf("PayPal: charged %.2f + fee %.2f", amount, fee), nil
    } else if method == "crypto" {
        fee := amount * 0.01
        return fmt.Sprintf("Crypto: charged %.2f + fee %.2f", amount, fee), nil
    } else if method == "bank_transfer" {
        return fmt.Sprintf("Bank: charged %.2f + fee 0.00", amount), nil
    } else {
        return "", fmt.Errorf("unsupported payment method: %s", method)
    }
}

func main() {
    result, _ := processPayment("paypal", 100)
    fmt.Println(result)
}
```

**Task:** Refactor to be open for extension (adding new processors) without modifying the core logic.

<details>
<summary>Solution</summary>

```go
type PaymentProcessor interface {
    Process(amount float64) (string, error)
    Method() string
}

type CreditCard struct{}
func (c CreditCard) Method() string { return "credit_card" }
func (c CreditCard) Process(amount float64) (string, error) {
    fee := amount * 0.029
    return fmt.Sprintf("CC: charged %.2f + fee %.2f", amount, fee), nil
}

type PayPal struct{}
func (p PayPal) Method() string { return "paypal" }
func (p PayPal) Process(amount float64) (string, error) {
    fee := amount*0.034 + 0.30
    return fmt.Sprintf("PayPal: charged %.2f + fee %.2f", amount, fee), nil
}

type BankTransfer struct{}
func (b BankTransfer) Method() string { return "bank_transfer" }
func (b BankTransfer) Process(amount float64) (string, error) {
    return fmt.Sprintf("Bank: charged %.2f + fee 0.00", amount), nil
}

// Registry — no if-else needed
type PaymentRegistry struct {
    processors map[string]PaymentProcessor
}

func NewPaymentRegistry() *PaymentRegistry {
    r := &PaymentRegistry{processors: make(map[string]PaymentProcessor)}
    r.Register(CreditCard{})
    r.Register(PayPal{})
    r.Register(BankTransfer{})
    return r
}

func (r *PaymentRegistry) Register(p PaymentProcessor) {
    r.processors[p.Method()] = p
}

func (r *PaymentRegistry) Process(method string, amount float64) (string, error) {
    p, ok := r.processors[method]
    if !ok {
        return "", fmt.Errorf("unsupported: %s", method)
    }
    return p.Process(amount)
}
```

**Benefits:** Open/Closed Principle — add new processors without touching existing code. Each processor is independently testable.
</details>

---

## Exercise 8 🟡 — Optimize Error Handling Chain

**Problem:** This pipeline creates many allocations due to error wrapping.

```go
package main

import (
    "fmt"
    "strconv"
)

type PipelineError struct {
    Step    string
    Wrapped error
}

func (e *PipelineError) Error() string {
    return fmt.Sprintf("step '%s': %v", e.Step, e.Wrapped)
}

func (e *PipelineError) Unwrap() error { return e.Wrapped }

func parseNumber(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, &PipelineError{"parse", err}  // allocation!
    }
    return n, nil
}

func multiplyBy2(n int) (int, error) {
    if n > 1000000 {
        return 0, &PipelineError{"multiply", fmt.Errorf("overflow risk: %d", n)}  // allocation!
    }
    return n * 2, nil
}

func formatResult(n int) (string, error) {
    if n == 0 {
        return "", &PipelineError{"format", fmt.Errorf("zero result")}  // allocation!
    }
    return fmt.Sprintf("result=%d", n), nil
}

func runPipeline(input string) (string, error) {
    n, err := parseNumber(input)
    if err != nil {
        return "", err
    }
    doubled, err := multiplyBy2(n)
    if err != nil {
        return "", err
    }
    return formatResult(doubled)
}

func main() {
    fmt.Println(runPipeline("21"))
    fmt.Println(runPipeline("abc"))
}
```

**Task:** Reduce allocations in the error path. Use `go test -bench -benchmem` to measure.

<details>
<summary>Solution</summary>

```go
// Pre-allocated sentinel errors for common cases
var (
    ErrParseStep    = &PipelineError{"parse", nil}
    ErrMultiplyStep = &PipelineError{"multiply", nil}
    ErrFormatStep   = &PipelineError{"format", nil}
)

// For truly hot paths: use error codes instead of allocations
type ErrorCode int

const (
    ErrNone     ErrorCode = 0
    ErrParseFail ErrorCode = 1
    ErrOverflow  ErrorCode = 2
    ErrZeroResult ErrorCode = 3
)

type FastPipelineResult struct {
    Value string
    Code  ErrorCode
}

func runFastPipeline(input string) FastPipelineResult {
    n, err := strconv.Atoi(input)
    if err != nil {
        return FastPipelineResult{Code: ErrParseFail}
    }
    if n > 1000000 {
        return FastPipelineResult{Code: ErrOverflow}
    }
    doubled := n * 2
    if doubled == 0 {
        return FastPipelineResult{Code: ErrZeroResult}
    }
    return FastPipelineResult{Value: fmt.Sprintf("result=%d", doubled)}
}

func (r FastPipelineResult) Err() error {
    switch r.Code {
    case ErrNone:
        return nil
    case ErrParseFail:
        return ErrParseStep
    // ...
    }
    return fmt.Errorf("error code %d", r.Code)
}
```

**Tradeoff:** Zero-allocation error paths are faster but less descriptive. Use for very hot paths (>1M/sec). For normal paths, readable error wrapping is worth the allocation.
</details>

---

## Exercise 9 🔴 — Profile-Guided Branch Ordering

**Problem:** This validation function is called millions of times. The most common failure mode (missing email) is checked last.

```go
package main

import (
    "fmt"
    "strings"
    "unicode"
)

type SignupForm struct {
    Email    string
    Password string
    Age      int
    Country  string
}

// Validation called 5M times/second
// Profiling shows:
// - 80% of calls fail due to empty email
// - 15% fail due to invalid password
// - 3% fail due to age
// - 2% fail due to country
// - 0.1% succeed

func validateSignup(f SignupForm) error {
    // Currently checks in "logical" order, not frequency order
    if f.Age < 18 {
        return fmt.Errorf("must be 18+")
    }
    if !isValidCountry(f.Country) {
        return fmt.Errorf("unsupported country")
    }
    if !isValidPassword(f.Password) {
        return fmt.Errorf("invalid password")
    }
    if f.Email == "" {
        return fmt.Errorf("email required")
    }
    return nil
}

func isValidCountry(c string) bool { return c != "" }
func isValidPassword(p string) bool {
    if len(p) < 8 { return false }
    var hasUpper, hasDigit bool
    for _, ch := range p {
        if unicode.IsUpper(ch) { hasUpper = true }
        if unicode.IsDigit(ch) { hasDigit = true }
    }
    return hasUpper && hasDigit
}

func main() {
    forms := []SignupForm{
        {"", "Password1", 25, "US"},
        {"user@example.com", "Pass1234", 25, "US"},
        {"user@example.com", "weak", 25, "US"},
    }
    for _, f := range forms {
        if err := validateSignup(f); err != nil {
            fmt.Println("Error:", err)
        } else {
            fmt.Println("Valid!")
        }
    }
    _ = strings.Contains
}
```

**Task:** Reorder the checks based on failure frequency to minimize average work per call.

<details>
<summary>Solution</summary>

```go
func validateSignupOptimized(f SignupForm) error {
    // Order by failure frequency (most common first)
    // 80% fail here: cheap check first
    if f.Email == "" {
        return fmt.Errorf("email required")
    }
    // 15% fail here: medium cost
    if !isValidPassword(f.Password) {
        return fmt.Errorf("invalid password")
    }
    // 3% fail here: cheap check
    if f.Age < 18 {
        return fmt.Errorf("must be 18+")
    }
    // 2% fail here: cheap check
    if !isValidCountry(f.Country) {
        return fmt.Errorf("unsupported country")
    }
    return nil
}
```

**Expected improvement:**
- Before: Average path = 0.03×(age check) + 0.02×(country) + 0.15×(password) + 0.80×(email)
  = proportionally expensive (password check on 95% of calls)
- After: 80% of calls exit after the first (cheap) check

**Calculation:**
- Before avg cost ≈ 0.80×(age+country+password+email) + 0.15×(age+country+password) + 0.03×(age+country) + 0.02×(age)
  = dominated by password check (expensive) on 95% of calls
- After avg cost ≈ 0.80×(email check only) + much less for rest

**Principle:** Put the cheapest AND most-commonly-failing checks first in your guard clause chain.
</details>

---

## Exercise 10 🔴 — Replace Recursive if-else with Iterative FSM

**Problem:** This recursive permission checker is O(n) with deep recursion risk.

```go
package main

import "fmt"

type Role struct {
    Name   string
    Parent string  // parent role name
}

var roles = map[string]Role{
    "guest":       {"guest", ""},
    "user":        {"user", "guest"},
    "moderator":   {"moderator", "user"},
    "admin":       {"admin", "moderator"},
    "superadmin":  {"superadmin", "admin"},
}

// Recursive: O(depth) calls, stack growth
func hasRoleRecursive(userRole, requiredRole string) bool {
    if userRole == requiredRole {
        return true
    }
    role, ok := roles[userRole]
    if !ok || role.Parent == "" {
        return false
    }
    return hasRoleRecursive(role.Parent, requiredRole)
}

func main() {
    fmt.Println(hasRoleRecursive("superadmin", "guest"))  // true
    fmt.Println(hasRoleRecursive("user", "admin"))        // false
    fmt.Println(hasRoleRecursive("admin", "user"))        // true
}
```

**Task:** Convert to iterative approach. Precompute a permission matrix for O(1) lookup.

<details>
<summary>Solution</summary>

```go
// Iterative version: O(depth) per call, no recursion
func hasRoleIterative(userRole, requiredRole string) bool {
    current := userRole
    for current != "" {
        if current == requiredRole {
            return true
        }
        role, ok := roles[current]
        if !ok {
            break
        }
        current = role.Parent
    }
    return false
}

// Precomputed matrix: O(1) lookup, O(n²) initialization
type PermissionMatrix struct {
    matrix map[string]map[string]bool
}

func BuildPermissionMatrix(roles map[string]Role) *PermissionMatrix {
    pm := &PermissionMatrix{
        matrix: make(map[string]map[string]bool),
    }
    for roleName := range roles {
        pm.matrix[roleName] = make(map[string]bool)
        // Walk up hierarchy
        current := roleName
        for current != "" {
            pm.matrix[roleName][current] = true
            role, ok := roles[current]
            if !ok {
                break
            }
            current = role.Parent
        }
    }
    return pm
}

func (pm *PermissionMatrix) HasRole(userRole, requiredRole string) bool {
    if perms, ok := pm.matrix[userRole]; ok {
        return perms[requiredRole]
    }
    return false
}

func main() {
    pm := BuildPermissionMatrix(roles)
    fmt.Println(pm.HasRole("superadmin", "guest"))  // true: O(1)
    fmt.Println(pm.HasRole("user", "admin"))        // false: O(1)
    fmt.Println(pm.HasRole("admin", "user"))        // true: O(1)
}
```

**Performance comparison:**
- Recursive: O(depth) call stack, risk of stack overflow for deep hierarchies
- Iterative: O(depth) per call, no recursion risk
- Matrix: O(1) per check, O(n²) build time and space — best for read-heavy systems

**When to use matrix:** Role hierarchy rarely changes but is checked millions of times (auth middleware, API rate limiting).
</details>

---

## Exercise 11 🔴 — Eliminate Allocations in Hot Error Path

**Problem:** This middleware is called on every HTTP request and allocates on the common "not authorized" path.

```go
package main

import (
    "fmt"
    "net/http"
)

type AuthError struct {
    UserID  string
    Message string
    Code    int
}

func (e *AuthError) Error() string {
    return fmt.Sprintf("[%d] user %s: %s", e.Code, e.UserID, e.Message)
}

func checkAuth(r *http.Request) error {
    token := r.Header.Get("Authorization")
    if token == "" {
        // HOT PATH: 70% of requests are unauthorized
        // This allocates a new AuthError every time!
        return &AuthError{
            UserID:  r.Header.Get("X-User-ID"),
            Message: "missing token",
            Code:    401,
        }
    }
    if !isValidToken(token) {
        return &AuthError{
            UserID:  r.Header.Get("X-User-ID"),
            Message: "invalid token",
            Code:    401,
        }
    }
    return nil
}

func isValidToken(token string) bool {
    return len(token) > 10
}

func main() {
    r, _ := http.NewRequest("GET", "/api/data", nil)
    if err := checkAuth(r); err != nil {
        fmt.Println("Auth error:", err)
    }
}
```

**Task:** Reduce allocations using sentinel errors and sync.Pool.

<details>
<summary>Solution</summary>

```go
import "sync"

// Pre-allocated sentinel errors for common cases
var (
    ErrMissingToken = &AuthError{Message: "missing token", Code: 401}
    ErrInvalidToken = &AuthError{Message: "invalid token", Code: 401}
)

// For errors that need dynamic data, use sync.Pool
var authErrPool = sync.Pool{
    New: func() interface{} {
        return &AuthError{}
    },
}

func checkAuthOptimized(r *http.Request) error {
    token := r.Header.Get("Authorization")
    if token == "" {
        // Return pre-allocated sentinel (zero allocation!)
        return ErrMissingToken
    }
    if !isValidToken(token) {
        return ErrInvalidToken
    }
    return nil
}

// When you need to include dynamic data (user ID):
func checkAuthWithUserID(r *http.Request) error {
    token := r.Header.Get("Authorization")
    if token == "" {
        // Only allocate when we need dynamic data
        err := authErrPool.Get().(*AuthError)
        err.UserID = r.Header.Get("X-User-ID")
        err.Message = "missing token"
        err.Code = 401
        return err
    }
    return nil
}

// Caller MUST call this to return error to pool
func releaseAuthError(err error) {
    if ae, ok := err.(*AuthError); ok {
        ae.UserID = ""
        authErrPool.Put(ae)
    }
}
```

**Benchmark results (typical):**
- Before: 1 alloc/op, 64 B/op
- After (sentinel): 0 allocs/op, 0 B/op

**Trade-offs:**
- Sentinel errors lose per-request context (user ID)
- sync.Pool requires careful lifecycle management
- For most services, the allocation is negligible — measure before optimizing
</details>
