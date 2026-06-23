# if Statement — Middle Level

## 1. Design Philosophy: Why Go's `if` Works the Way It Does

Go's `if` statement was designed with explicit preferences rooted in correctness and readability:

- **No parentheses:** reduces visual noise, distinguishes Go from C/Java
- **Required braces:** prevents off-by-one bugs (Apple's "goto fail" SSL bug, 2014, was caused by missing braces)
- **Init statement:** enables idiomatic error checking without polluting outer scope
- **No ternary `?:`:** encourages explicit, readable branching over concise-but-cryptic one-liners
- **Bool only:** no implicit int→bool or string→bool — prevents `if n` where `n==0` is unexpectedly false

```go
// The Apple SSL "goto fail" bug (C, 2014) — required braces prevent this in Go:
// if (err = hashUpdate(&hashCtx, &data)) != 0)
//     goto fail;
//     goto fail;  // always executes! Missing braces made it unconditional
```

---

## 2. When to Use `if` vs `switch`

```go
// Use if when:
// - Condition is complex (multiple operators)
// - Different conditions on different variables
// - Error checking (nil/non-nil pattern)

if err != nil { return err }
if len(s) > 0 && s[0] == 'A' { process(s) }

// Use switch when:
// - Multiple equality checks on the SAME variable/expression
// - 4+ branches
// - Type switching

switch status {
case "active":   doActive()
case "pending":  doPending()
case "inactive": doInactive()
default:         doDefault()
}
```

---

## 3. The Init Statement: Scope Management Tool

The init statement is not just syntactic sugar — it prevents scope pollution.

```go
// WITHOUT init statement: err leaks into outer scope
err := doA()
if err != nil { return err }
err = doB() // must use = not :=
if err != nil { return err }

// WITH init statement: each err is locally scoped
if err := doA(); err != nil { return err }
if err := doB(); err != nil { return err }
// No stale err variable in scope between calls
```

**Why this matters:** In long functions, a leaked `err` variable from one call can shadow errors from subsequent calls if the developer accidentally uses `=` instead of `:=`.

---

## 4. Why Go Has No Ternary Operator

The Go authors explicitly rejected ternary `?:`:

1. **Complexity:** Nested ternaries `a ? b ? c : d : e` are nearly unreadable
2. **Debugging:** Can't place a breakpoint inside a ternary expression
3. **Ambiguity:** Different precedence rules across languages cause bugs
4. **Readability:** `if-else` is always unambiguous

```go
// Go's way for conditional assignment:
var status string
if isActive {
    status = "active"
} else {
    status = "inactive"
}

// Or: use a helper function for repeated patterns
func cond(ok bool, a, b string) string {
    if ok { return a }
    return b
}
status := cond(isActive, "active", "inactive")
```

---

## 5. Guard Clauses: The Psychological Model

Guard clauses work because of how humans read code:

**Mental model — nested approach:**
> "To understand what happens, I must first track all conditions to reach the main logic... and keep them in working memory while reading."

**Mental model — guard clause approach:**
> "The first few lines tell me what's invalid and exits early. Past that, I'm in the valid case."

```go
// Nested (reader tracks multiple conditions simultaneously):
func CreateOrder(req OrderRequest) (*Order, error) {
    if req.UserID > 0 {
        if len(req.Items) > 0 {
            if req.PaymentMethod != "" {
                // main logic 3 levels deep
            }
        }
    }
    return nil, errors.New("invalid")
}

// Guard clauses (reader handles one concern at a time):
func CreateOrder(req OrderRequest) (*Order, error) {
    if req.UserID <= 0        { return nil, errors.New("invalid user") }
    if len(req.Items) == 0    { return nil, errors.New("no items") }
    if req.PaymentMethod == "" { return nil, errors.New("no payment method") }

    // Main logic — no condition tracking needed
    order := &Order{UserID: req.UserID, Items: req.Items}
    return order, nil
}
```

---

## 6. Short-Circuit Evaluation — Safety Patterns

```go
// Nil guard before field access:
if user != nil && user.IsActive {
    process(user) // safe: user.IsActive only accessed if user is non-nil
}

// Cheap check before expensive operation:
if quickSanityCheck(data) && expensiveParsing(data) {
    // expensiveParsing only called if quick check passes
}

// Lazy initialization:
if cache != nil || initCache() != nil {
    use(cache)
}

// BEWARE: don't use short-circuit for side effects
// This creates hidden control flow:
if writeLog() || sendAlert() {
    // sendAlert only called if writeLog returns false — confusing!
}
```

---

## 7. Error Handling with `errors.Is` and `errors.As`

```go
var ErrNotFound = errors.New("not found")

func getUser(id int) (*User, error) {
    row := db.QueryRow("SELECT * FROM users WHERE id = $1", id)
    if err := row.Scan(&user); err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, fmt.Errorf("user %d: %w", id, ErrNotFound)
        }
        return nil, fmt.Errorf("query user %d: %w", id, err)
    }
    return &user, nil
}

// Caller dispatches on error type:
user, err := getUser(42)
if err != nil {
    switch {
    case errors.Is(err, ErrNotFound):
        http.Error(w, "not found", 404)
    case errors.Is(err, ErrPermission):
        http.Error(w, "forbidden", 403)
    default:
        log.Printf("unexpected: %v", err)
        http.Error(w, "internal error", 500)
    }
    return
}
```

---

## 8. Anti-Pattern: `else` After `return`

```go
// ANTI-PATTERN: unnecessary else
func getUser(id int) (*User, error) {
    u, err := db.Find(id)
    if err != nil {
        return nil, err
    } else {            // else is unnecessary!
        return u, nil
    }
}

// IDIOMATIC: drop the else
func getUser(id int) (*User, error) {
    u, err := db.Find(id)
    if err != nil {
        return nil, err
    }
    return u, nil
}
```

The `revive` and `staticcheck` linters flag `else` after `return`, `continue`, `break`, or `goto`.

---

## 9. Anti-Pattern: Boolean Blindness

```go
// ANTI-PATTERN: boolean return hides intent
func canVote(age int) bool {
    if age >= 18 {
        return true
    }
    return false
    // Simplify to: return age >= 18
}

// ANTI-PATTERN: condition restated in if
isValid := validateUser(user)
if isValid == true { }   // use: if isValid { }
if isValid == false { }  // use: if !isValid { }

// Better: return descriptive errors when more context is needed
func checkVotingEligibility(age, registrationYear int) error {
    if age < 18 {
        return fmt.Errorf("voter must be 18+, got %d", age)
    }
    if registrationYear > currentYear {
        return fmt.Errorf("registration year %d is in the future", registrationYear)
    }
    return nil
}
```

---

## 10. Alternative: Function Table for Large Dispatch

```go
// 5+ branches — consider a function table instead of if-else if
type HandlerFn func(ctx context.Context, req Request) Response

var actionHandlers = map[string]HandlerFn{
    "create": handleCreate,
    "update": handleUpdate,
    "delete": handleDelete,
    "list":   handleList,
    "get":    handleGet,
}

func dispatch(ctx context.Context, action string, req Request) Response {
    h, ok := actionHandlers[action]
    if !ok {
        return Response{Error: fmt.Sprintf("unknown action: %s", action)}
    }
    return h(ctx, req)
}
```

**vs if-else if chain:**

```go
// Hard to maintain at 5+ cases:
if action == "create" {
    return handleCreate(ctx, req)
} else if action == "update" {
    return handleUpdate(ctx, req)
} else if action == "delete" {
    return handleDelete(ctx, req)
    // ... more cases
}
```

---

## 11. `if` in the Standard Library Error Pattern

The Go standard library consistently uses the guard-clause pattern:

```go
// From net/http (simplified):
func (h *Handler) ServeHTTP(w ResponseWriter, r *Request) {
    if r.Method == "" {
        r.Method = "GET"
    }
    if r.URL == nil {
        http.Error(w, "missing URL", 400)
        return
    }
    if r.Body == http.NoBody {
        // handle no-body case
    }
    // main logic
}
```

---

## 12. Debugging `if` Conditions

**Technique 1: Extract condition to named variable**
```go
// Hard to debug:
if user.Age >= 18 && user.IsActive && !user.IsBlocked && user.Balance > 0 {
    grantAccess()
}

// Debuggable:
isAdult    := user.Age >= 18
isActive   := user.IsActive
notBlocked := !user.IsBlocked
hasFunds   := user.Balance > 0
log.Printf("access check: adult=%v active=%v notBlocked=%v funds=%v",
    isAdult, isActive, notBlocked, hasFunds)
if isAdult && isActive && notBlocked && hasFunds {
    grantAccess()
}
```

**Technique 2: Use delve**
```bash
dlv debug ./cmd/main
(dlv) break handlers.go:42
(dlv) continue
(dlv) print user
(dlv) print user.Age >= 18
```

---

## 13. Evolution of Go's `if` Statement

| Era | Change |
|---|---|
| Go 1.0 (2012) | Current `if` syntax established (no changes since) |
| Go 1.13 (2019) | `errors.Is`/`errors.As` changed how errors are checked in if conditions |
| Go 1.18 (2022) | Generics didn't change `if`, but type constraints use similar boolean logic |
| Go 1.21 (2023) | `min`/`max` builtins reduce some `if` usage for comparisons |

```go
// Go 1.21: use min/max instead of if-else for simple comparisons
// Before:
var result int
if a < b {
    result = a
} else {
    result = b
}

// After (Go 1.21+):
result := min(a, b)
```

---

## 14. Language Comparison: Error Handling

```python
# Python: exceptions (implicit control flow)
try:
    result = parse(data)
except ValueError as e:
    handle_error(e)
```

```java
// Java: checked exceptions (forced handling)
try {
    result = parse(data);
} catch (ParseException e) {
    handleError(e);
}
```

```rust
// Rust: Result type with ? operator (concise propagation)
let result = parse(data)?;  // ? propagates error up
```

```go
// Go: explicit if check (visible, no hidden control flow)
result, err := parse(data)
if err != nil {
    return fmt.Errorf("parse: %w", err)
}
```

Go's approach makes error propagation visible at every call site. Verbose but eliminates surprise control flow jumps.

---

## 15. `if` with Context Cancellation

```go
func processWithContext(ctx context.Context, items []Item) error {
    for _, item := range items {
        // Check context before each iteration
        if err := ctx.Err(); err != nil {
            return fmt.Errorf("processing cancelled: %w", err)
        }
        if err := processItem(ctx, item); err != nil {
            return fmt.Errorf("item %v: %w", item.ID, err)
        }
    }
    return nil
}
```

---

## 16. Scope Issues with `:=` in Init Statement

```go
x := 10

// Shadowing (creates NEW x in if scope):
if x := x + 5; x > 10 {
    fmt.Println("inner x:", x)  // 15
}
fmt.Println("outer x:", x)  // 10 — unchanged!

// Intentional use (error chain):
err := firstOp()
if err != nil {
    if err := secondOp(); err != nil {
        // inner err is secondOp's error
        return err
    }
    return err // firstOp's error
}
```

---

## 17. Performance: Branch Prediction

Modern CPUs predict branch outcomes. Mispredictions cost ~15 clock cycles.

```go
// For predictable branches (hot path always taken):
// Branch predictor learns — minimal cost after warmup

// For unpredictable branches (50/50):
// ~15 cycle penalty per misprediction

// Go compiler optimization for simple branches:
func max(a, b int) int {
    if a > b { return a }
    return b
}
// May compile to CMOV (conditional move) — no branch, no misprediction penalty

// Order conditions: most likely first for early exit
if !criticalCheck() { // fast common path
    return
}
if slowCheck() { }    // only evaluated when criticalCheck passes
```

---

## 18. Testing All `if` Branches

```go
// Every branch of an if should be tested:
func TestDivide(t *testing.T) {
    // Test: error branch (b == 0)
    _, err := divide(10, 0)
    if err == nil {
        t.Error("expected error for division by zero")
    }

    // Test: normal branch (b != 0)
    result, err := divide(10, 2)
    if err != nil {
        t.Errorf("unexpected error: %v", err)
    }
    if result != 5 {
        t.Errorf("10/2 = %v, want 5", result)
    }
}

// Check branch coverage:
// go test -coverprofile=coverage.out ./...
// go tool cover -func=coverage.out | grep -v "100.0%"
```

---

## 19. `if` in Request Validation Pipelines

```go
type Validator func(*http.Request) error

func validateRequest(r *http.Request, validators ...Validator) error {
    for _, v := range validators {
        if err := v(r); err != nil {
            return err
        }
    }
    return nil
}

func requireMethod(method string) Validator {
    return func(r *http.Request) error {
        if r.Method != method {
            return fmt.Errorf("method %s not allowed", r.Method)
        }
        return nil
    }
}

func requireContentType(ct string) Validator {
    return func(r *http.Request) error {
        if !strings.HasPrefix(r.Header.Get("Content-Type"), ct) {
            return fmt.Errorf("content-type must be %s", ct)
        }
        return nil
    }
}

func handler(w http.ResponseWriter, r *http.Request) {
    if err := validateRequest(r,
        requireMethod("POST"),
        requireContentType("application/json"),
    ); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
}
```

---

## 20. `if` Linting Rules

```yaml
# .golangci.yml
linters:
  enable:
    - revive      # "else-return": flags else after return
    - gocritic    # "sloppyReassign", "boolExprSimplify"
    - staticcheck # "SA4003": unreachable conditions
    - errcheck    # ensures all errors are checked
```

Common findings:
```go
// revive: redundant else
if cond { return true } else { return false }
// → return cond

// gocritic: equalFold
if strings.ToLower(s) == "go" { }
// → if strings.EqualFold(s, "go") { }

// staticcheck SA4003: condition always false
var x uint8
if x < 0 { }  // uint8 is always >= 0
```

---

## 21. `if` vs `select` for Channel Operations

```go
// if for single channel operation:
if val, ok := <-ch; ok {
    process(val)
}

// select for multiple channels (non-blocking):
select {
case val := <-ch:
    process(val)
case <-ctx.Done():
    return ctx.Err()
default:
    // non-blocking: nothing ready
}
```

---

## 22. Mixing `if` with `defer`

```go
func processFile(path string) (err error) {
    f, err := os.Open(path)
    if err != nil {
        return fmt.Errorf("open: %w", err)
    }
    // Named return + defer captures close error
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = fmt.Errorf("close: %w", cerr)
        }
    }()

    if _, err = f.Write([]byte("data")); err != nil {
        return fmt.Errorf("write: %w", err)
    }
    return nil
}
```

---

## 23. The `errors.As` Pattern in `if`

```go
// Type-specific error handling with errors.As:
func handleError(err error) (statusCode int, message string) {
    var notFound *NotFoundError
    var validation *ValidationError
    var timeout interface{ Timeout() bool }

    switch {
    case errors.As(err, &notFound):
        return 404, fmt.Sprintf("not found: %s", notFound.Resource)
    case errors.As(err, &validation):
        return 422, fmt.Sprintf("invalid: %s", validation.Message)
    case errors.As(err, &timeout) && timeout.Timeout():
        return 504, "gateway timeout"
    default:
        return 500, "internal server error"
    }
}
```

---

## 24. `if` in Go Generics

```go
// Generic function using if:
func Filter[T any](items []T, predicate func(T) bool) []T {
    var result []T
    for _, item := range items {
        if predicate(item) {
            result = append(result, item)
        }
    }
    return result
}

// Type constraint check at runtime (using reflect or type assertion):
func MustBePositive[T int | float64](v T) T {
    if v <= 0 {
        panic(fmt.Sprintf("expected positive value, got %v", v))
    }
    return v
}
```

---

## 25. Chaining vs. Nesting: Visual Comparison

```
NESTED (avoid):                    CHAINED GUARD CLAUSES (prefer):

┌─────────────────────────┐       if !A { return errA }
│ if A {                  │       if !B { return errB }
│   if B {                │       if !C { return errC }
│     if C {              │
│       // main logic     │       // main logic here
│     }                   │
│   }                     │
│ }                       │
└─────────────────────────┘
```

---

## 26. The `if` Statement Cyclomatic Complexity

Each `if`, `else if`, `for`, `case`, and `&&`/`||` adds to cyclomatic complexity. Tools measure it:

```bash
gocyclo -over 10 ./...
# Reports functions with complexity > 10
```

Keep functions with many `if` statements simple by:
1. Extracting validation into helper functions
2. Using early returns (guard clauses)
3. Moving branching logic into a table

---

## 27. Pattern: `if` for Feature Flags

```go
type FeatureFlags struct {
    NewCheckout  bool
    BetaSearch   bool
    DarkMode     bool
}

func handleCheckout(w http.ResponseWriter, r *http.Request, flags FeatureFlags) {
    if flags.NewCheckout {
        newCheckoutHandler(w, r)
        return
    }
    legacyCheckoutHandler(w, r)
}

func renderPage(flags FeatureFlags) string {
    if flags.DarkMode {
        return renderWithTheme("dark")
    }
    return renderWithTheme("light")
}
```

---

## 28. `if` Without Explicit `else` — The Continuation Pattern

```go
// Pattern: if terminates (return/panic/continue/break), else is implicit
func processItems(items []Item) []Result {
    var results []Result
    for _, item := range items {
        if item.IsExpired() {
            continue // skip expired — no else needed
        }
        if !item.IsValid() {
            log.Printf("invalid item %v, skipping", item.ID)
            continue
        }
        // Only valid, non-expired items reach here
        results = append(results, process(item))
    }
    return results
}
```

---

## 29. `if` in Benchmark Tests

```go
func BenchmarkClassify(b *testing.B) {
    testValues := []int{-100, 0, 5, 50, 500}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        // Use all paths to benchmark all branches
        for _, v := range testValues {
            if v < 0 {
                _ = "negative"
            } else if v == 0 {
                _ = "zero"
            } else {
                _ = "positive"
            }
        }
    }
}
```

---

## 30. Complete Pattern: Multi-Layer `if` Validation

```go
// A production-quality request handler using guard clauses throughout
func (h *OrderHandler) CreateOrder(w http.ResponseWriter, r *http.Request) {
    // Layer 1: HTTP validation
    if r.Method != http.MethodPost {
        writeError(w, 405, "method not allowed")
        return
    }
    if r.Header.Get("Content-Type") != "application/json" {
        writeError(w, 415, "unsupported media type")
        return
    }

    // Layer 2: Request parsing
    var req CreateOrderRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, 400, fmt.Sprintf("invalid JSON: %v", err))
        return
    }

    // Layer 3: Input validation
    if req.UserID <= 0 {
        writeError(w, 422, "user_id must be positive")
        return
    }
    if len(req.Items) == 0 {
        writeError(w, 422, "items cannot be empty")
        return
    }

    // Layer 4: Business logic
    order, err := h.orderService.Create(r.Context(), req)
    if err != nil {
        if errors.Is(err, ErrUserNotFound) {
            writeError(w, 404, "user not found")
            return
        }
        if errors.Is(err, ErrInsufficientStock) {
            writeError(w, 409, "insufficient stock")
            return
        }
        h.logger.Error("create order failed", "err", err)
        writeError(w, 500, "internal error")
        return
    }

    // Success path — reached only after all guards pass
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(order)
}
```
