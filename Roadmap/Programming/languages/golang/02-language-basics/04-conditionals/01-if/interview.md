# if Statement — Interview Q&A

## Junior Level Questions

---

**Q1: What is the syntax of an `if` statement in Go? How does it differ from C or Java?**

In Go:
```go
if condition {
    // body
}
```

Key differences from C/Java:
1. **No parentheses** around the condition (`if x > 0`, not `if (x > 0)`)
2. **Braces are always required** — even for single-statement bodies
3. **Opening brace must be on the same line** as `if`
4. Go also has an **init statement**: `if x := compute(); x > 0 { }`

---

**Q2: What is the `if` init statement? Give an example.**

The init statement runs a short statement before the condition is evaluated. Variables declared there are scoped to the entire `if-else` block.

```go
if n, err := strconv.Atoi("42"); err != nil {
    fmt.Println("Error:", err)
} else {
    fmt.Println("Number:", n) // n is accessible in else too
}
// n and err are NOT accessible here
```

Most commonly used for error checking.

---

**Q3: Does Go have a ternary operator?**

No. Go deliberately excludes `?:`. Use `if-else` instead:

```go
// NOT valid Go:
// max := a > b ? a : b

// Go way:
var max int
if a > b {
    max = a
} else {
    max = b
}
```

---

**Q4: What is a guard clause?**

A guard clause is an `if` statement at the start of a function that returns (or panics) on invalid input. It avoids deep nesting.

```go
func process(user *User) error {
    if user == nil {        // guard
        return errors.New("user is nil")
    }
    if user.ID <= 0 {       // guard
        return errors.New("invalid ID")
    }
    // happy path — no deep nesting
    return doWork(user)
}
```

---

**Q5: What is the zero value of `bool` in Go?**

`false`. Declared boolean variables without initialization are `false`.

```go
var ready bool
if ready { }       // false — body never executes
if !ready { }      // true — body executes
```

---

**Q6: Why should you write `if flag` instead of `if flag == true`?**

`if flag == true` is redundant — `flag` is already a `bool`. The idiomatic Go form is `if flag`. Similarly, `if !flag` instead of `if flag == false`.

---

**Q7: How do you check if an error occurred in Go?**

```go
result, err := someFunction()
if err != nil {
    // handle error
    return err
}
// use result
```

This is the most common Go pattern. `nil` means no error.

---

**Q8: Can you assign a value inside an `if` condition in Go?**

No. Go does not allow assignment in the condition position (only in the init statement):

```go
// This causes a compile error:
// if x = 5 { }  // "non-boolean condition in if statement"

// The init statement IS valid:
if x := 5; x > 0 { }  // x is assigned before the condition
```

---

**Q9: How does short-circuit evaluation work with `&&` and `||`?**

- `a && b`: If `a` is false, `b` is never evaluated
- `a || b`: If `a` is true, `b` is never evaluated

```go
if user != nil && user.IsActive {
    // safe: user.IsActive only accessed if user is non-nil
}
```

---

**Q10: What is the scope of a variable declared in an `if` init statement?**

The variable is scoped to the **entire if-else chain** — accessible in the `if` body, any `else if` body, and the `else` body. It is NOT accessible outside the `if` statement.

```go
if x := 10; x > 5 {
    use(x) // accessible
} else if x < 20 {
    use(x) // still accessible
} else {
    use(x) // still accessible
}
// use(x) here // COMPILE ERROR
```

---

## Middle Level Questions

---

**Q11: What is the difference between `if` and `switch` in Go? When would you use each?**

Use `if` for:
- Complex conditions with multiple operators
- Conditions on different variables
- Error checking (`err != nil`)
- 1-3 branches

Use `switch` for:
- Multiple equality checks on the same value
- Type switching
- 4+ branches on the same expression

```go
// if: complex, different variables
if err != nil && retries < maxRetries && !ctx.Err() != nil { }

// switch: same variable, many cases
switch statusCode {
case 200: return "OK"
case 404: return "Not Found"
case 500: return "Server Error"
}
```

---

**Q12: Why is `else` often unnecessary in Go? When should you use it?**

After a `return`, `continue`, `break`, or `panic` in an `if` block, the `else` is redundant — the remaining code only runs when the condition was false.

```go
// Redundant else:
if err != nil {
    return err
} else {          // unnecessary — return already exited
    use(result)
}

// Idiomatic:
if err != nil {
    return err
}
use(result) // only reached if err == nil
```

Use `else` when both branches need to produce a value or when neither branch terminates:
```go
var label string
if isActive {
    label = "active"
} else {
    label = "inactive"
}
```

---

**Q13: What is `errors.Is` and how does it differ from `==` for error comparison?**

`errors.Is` unwraps error chains, while `==` only compares the top-level error.

```go
var ErrNotFound = errors.New("not found")

// Wrapped error:
err := fmt.Errorf("user service: %w", ErrNotFound)

// == doesn't find wrapped error:
err == ErrNotFound  // false

// errors.Is unwraps and finds it:
errors.Is(err, ErrNotFound)  // true
```

Use `errors.Is` for sentinel error comparison; use `errors.As` for type-based extraction.

---

**Q14: What is `errors.As` and how is it used in `if` statements?**

`errors.As` finds the first error in the chain that matches the target type:

```go
var pathErr *os.PathError
if errors.As(err, &pathErr) {
    fmt.Printf("path error at: %s\n", pathErr.Path)
}
```

Used for extracting typed errors that carry extra context (file path, status code, etc.).

---

**Q15: How would you implement a guard clause pattern in a real HTTP handler?**

```go
func createUser(w http.ResponseWriter, r *http.Request) {
    // Guard 1: method
    if r.Method != http.MethodPost {
        http.Error(w, "method not allowed", 405)
        return
    }

    // Guard 2: parse body
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid JSON", 400)
        return
    }

    // Guard 3: validate
    if req.Email == "" {
        http.Error(w, "email required", 422)
        return
    }

    // Happy path — all guards passed
    user, err := h.service.Create(r.Context(), req)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    json.NewEncoder(w).Encode(user)
}
```

---

## Senior Level Questions

---

**Q16: How does the Go compiler handle a simple `if` returning a boolean? What assembly is generated?**

For simple `if` statements returning a boolean, the compiler often generates `SETcc` instructions (conditional set) instead of branches:

```go
func isPositive(x int) bool {
    if x > 0 { return true }
    return false
}
```

Assembly (simplified):
```asm
TESTQ CX, CX    // set flags based on x
SETG  AL        // AL = 1 if x > 0, else 0
RET
```

No branch instructions — this is branch-free code. Also for `min`/`max` patterns, CMOV (conditional move) may be used.

---

**Q17: What is branch prediction, and how does it relate to `if` performance?**

Modern CPUs speculatively execute one branch of an `if` before the condition is resolved. If the prediction is wrong (misprediction), ~15 clock cycles are wasted flushing the pipeline.

**Implications for Go code:**
- Predictable branches (almost always true/false) have nearly zero cost after warmup
- Unpredictable 50/50 branches incur ~15 cycle penalties
- For critical inner loops, sort data to make branches more predictable
- Simple `if` expressions may be compiled to branchless CMOV or SET instructions

```go
// Unpredictable (random data) — potential 15 cycle penalty each:
for _, v := range randomData {
    if v > threshold { count++ }
}

// Predictable (sorted data) — ~0 misprediction cost:
sort.Ints(randomData)
for _, v := range randomData {
    if v > threshold { count++ } // once crossing threshold, always true
}
```

---

**Q18: How does profile-guided optimization (PGO) affect `if` statement performance in Go 1.21+?**

PGO uses a CPU profile from production to guide optimization:

1. **Branch reordering:** Frequently-taken branches move first in generated code → better instruction cache utilization
2. **Inlining decisions:** Functions called frequently in hot `if` paths get inlined more aggressively
3. **Devirtualization:** Interface calls inside `if` blocks can be devirtualized when PGO shows one concrete type dominates

```bash
# Collect production profile:
go tool pprof -proto http://prod:6060/debug/pprof/cpu > profile.pb.gz

# Build with PGO:
go build -pgo=profile.pb.gz -o app_pgo .
# Typical: 2-15% improvement for CPU-bound code
```

---

**Q19: What is dead code elimination in the context of `if` statements?**

The SSA pass eliminates entire `if` bodies when the condition is statically known to be false:

```go
const production = true

func debug() {
    if !production {        // constant false — body eliminated from binary
        expensiveLogging()  // this code does NOT appear in the binary
    }
}
```

Verify:
```bash
go build -gcflags="-m" main.go
nm app | grep expensiveLogging  # won't appear if eliminated
```

This is how Go implements compile-time feature flags without `#ifdef`.

---

**Q20: What is the race condition in "check-then-act" with `if` statements in concurrent code?**

The pattern: check a condition, then act on it — between check and act, another goroutine can change the state.

```go
// RACE CONDITION:
if _, ok := m[key]; !ok {
    m[key] = computeValue() // another goroutine may have set key!
}

// Fix 1: mutex
mu.Lock()
if _, ok := m[key]; !ok {
    m[key] = computeValue()
}
mu.Unlock()

// Fix 2: sync.Map LoadOrStore
actual, loaded := m.LoadOrStore(key, computeValue())
if !loaded {
    // we stored the new value
}

// Fix 3: Compare-and-swap (for atomic values)
if atomic.CompareAndSwapInt32(&flag, 0, 1) {
    // only one goroutine executes this
    initialize()
}
```

---

## Scenario-Based Questions

---

**Q21: A developer wrote this code. What are the problems and how do you fix them?**

```go
func getUser(db DB, id int) *User {
    user, err := db.Find(id)
    if err == nil {
        return user
    } else {
        log.Printf("error: %v", err)
        return nil
    }
}
```

**Problems:**
1. Returns `*User` without error — caller can't distinguish "not found" from "DB error"
2. `else` after `return` is redundant
3. Error is only logged, not propagated — caller has no way to handle the error

**Fix:**
```go
func getUser(db DB, id int) (*User, error) {
    user, err := db.Find(id)
    if err != nil {
        return nil, fmt.Errorf("getUser(%d): %w", id, err)
    }
    return user, nil
}
```

---

**Q22: You see this code pattern in a PR. What's the issue?**

```go
func handler(w http.ResponseWriter, r *http.Request) {
    user := authenticate(r)
    if user != nil {
        if user.HasPermission("write") {
            data := parseBody(r)
            if data != nil {
                if isValid(data) {
                    save(user, data)
                    w.WriteHeader(200)
                } else {
                    w.WriteHeader(400)
                }
            } else {
                w.WriteHeader(400)
            }
        } else {
            w.WriteHeader(403)
        }
    } else {
        w.WriteHeader(401)
    }
}
```

**Problem:** Deep nesting (4 levels) makes it hard to follow. The error cases are buried at the bottom.

**Fix with guard clauses:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    user := authenticate(r)
    if user == nil {
        w.WriteHeader(401); return
    }
    if !user.HasPermission("write") {
        w.WriteHeader(403); return
    }
    data := parseBody(r)
    if data == nil {
        w.WriteHeader(400); return
    }
    if !isValid(data) {
        w.WriteHeader(400); return
    }
    save(user, data)
    w.WriteHeader(200)
}
```

---

**Q23: How would you design a validation system where each validation step uses `if` but errors are collected (not fail-fast)?**

```go
type ValidationError struct {
    Field   string
    Message string
}

func validateOrder(req OrderRequest) []ValidationError {
    var errs []ValidationError

    if req.UserID <= 0 {
        errs = append(errs, ValidationError{"user_id", "must be positive"})
    }
    if len(req.Items) == 0 {
        errs = append(errs, ValidationError{"items", "cannot be empty"})
    }
    if req.Total < 0 {
        errs = append(errs, ValidationError{"total", "cannot be negative"})
    }
    if req.Currency == "" {
        errs = append(errs, ValidationError{"currency", "is required"})
    }

    return errs
}

// In handler:
if errs := validateOrder(req); len(errs) > 0 {
    w.WriteHeader(422)
    json.NewEncoder(w).Encode(map[string]interface{}{"errors": errs})
    return
}
```

---

**Q24: How do you ensure that a security check in an `if` statement cannot be accidentally bypassed?**

1. **Use early return (guard clause)** — not nested blocks where the positive case is easy to enter incorrectly
2. **Make the check explicit and named** — `if !isAuthorized(user, resource)` not `if user.role != "admin"`
3. **Write tests for the rejection path** — not just the happy path
4. **Use `go vet` and `staticcheck`** — to catch always-true/always-false conditions
5. **Separate authentication from authorization** — different `if` checks for "who are you?" vs "can you do this?"

```go
func deleteUser(w http.ResponseWriter, r *http.Request) {
    // Check 1: must be authenticated
    actor := getAuthenticatedUser(r) // returns nil if unauthenticated
    if actor == nil {
        http.Error(w, "unauthorized", 401)
        return // MUST be here — cannot fall through
    }

    // Check 2: must have permission
    if !actor.Can("delete:user") {
        http.Error(w, "forbidden", 403)
        return // MUST be here
    }

    // Only authorized users reach here
    deleteUserFromDB(...)
}
```

---

## FAQ

---

**Q25: Can you use `if` without `else`?**

Yes, and it's very common. `else` is only needed when both branches produce a value or when neither terminates.

---

**Q26: What happens to variables declared in an `if` block after the block ends?**

They go out of scope and become eligible for garbage collection. The Go garbage collector will reclaim the memory when no references remain.

---

**Q27: Is there any performance difference between `if-else if` chain and a map-based dispatch?**

For small numbers of cases (< 5), `if-else if` is typically faster due to simpler execution. For large dispatch tables, a `map` lookup is O(1) but has hash computation overhead. A `switch` statement compiles to a jump table (O(1)) for integer cases and is generally the fastest option for multiple branches on the same value.

---

**Q28: Can you use `if` in a goroutine safely?**

The `if` statement itself is always safe in goroutines — it doesn't access shared state on its own. But conditions that check shared variables require synchronization:

```go
var mu sync.Mutex
var shared int

go func() {
    mu.Lock()
    if shared > 0 { // safe: protected by mutex
        doWork()
    }
    mu.Unlock()
}()
```

---

**Q29: How does Go prevent the "goto fail" bug that affected Apple's SSL?**

Go requires braces around `if` bodies — even for single-statement bodies. Without braces, a second statement that appears to be in the `if` block (because of indentation) is actually always executed.

Go's rule: `if condition { }` — braces are mandatory. No exception.

---

**Q30: What does `go vet` check for in `if` statements?**

- **copylocks:** Detects mutex copying in if-init statements
- **printf:** Checks format strings in branches
- **unreachable:** Code after unconditional return inside if block
- **composites:** Unkeyed composite literals in conditions
- **stdmethods:** Wrong method signature for standard interfaces used in conditions

Run with: `go vet ./...`
