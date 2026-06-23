# Scope and Shadowing — Tasks

## Overview

These tasks are designed to build a deep understanding of Go's scope rules and shadowing behavior through hands-on practice. Complete them in order — earlier tasks build foundations for later ones.

**Difficulty levels:** Beginner | Intermediate | Advanced

---

## Task 1: Scope Identification Quiz (Beginner)

**Goal:** Identify the scope of each variable in the following code.

For each numbered variable declaration below, identify its scope level:
- `U` = Universe (predeclared)
- `P` = Package scope
- `Fn` = Function scope
- `B` = Block scope (specify which block)

```go
// task1.go
package main

import "fmt"                    // (1)

var AppVersion = "1.0.0"        // (2)

type Config struct {             // (3)
    Debug bool
}

func main() {                   // (4) — function itself is package-scoped
    cfg := Config{Debug: true}  // (5)

    if cfg.Debug {
        msg := "debug mode"     // (6)
        fmt.Println(msg)        // (7) — fmt, Println, msg: what scope is each?
    }

    for i := 0; i < 3; i++ {   // (8) — i
        square := i * i         // (9)
        fmt.Println(square)
    }

    _ = AppVersion              // (10) — AppVersion
}
```

**Your task:**

Fill in the table:

| # | Identifier | Scope |
|---|-----------|-------|
| 1 | `fmt` (import) | ? |
| 2 | `AppVersion` | ? |
| 3 | `Config` | ? |
| 5 | `cfg` | ? |
| 6 | `msg` | ? |
| 7a | `fmt` (use in Println) | ? |
| 7b | `Println` | ? |
| 8 | `i` | ? |
| 9 | `square` | ? |
| 10 | `AppVersion` (use) | ? |

**Starter code:** No code to run — this is a reasoning exercise. After answering, verify by:
```bash
# Create the file and run:
go run task1.go
# Try moving variables out of their scope to see compile errors
```

<details>
<summary>Solution</summary>

| # | Identifier | Scope |
|---|-----------|-------|
| 1 | `fmt` (import) | File scope |
| 2 | `AppVersion` | Package scope |
| 3 | `Config` | Package scope |
| 5 | `cfg` | Function scope (main) |
| 6 | `msg` | Block scope (if body) |
| 7a | `fmt` (use) | Resolved from file scope |
| 7b | `Println` | Universe scope (method of fmt package) |
| 8 | `i` | Block scope (for loop) |
| 9 | `square` | Block scope (for loop body) |
| 10 | `AppVersion` (use) | Resolved from package scope |

</details>

---

## Task 2: Spot the Shadow (Beginner)

**Goal:** Identify all instances of variable shadowing in the following function.

```go
// task2.go
package main

import "fmt"

func process(data []int, multiplier int) int {
    total := 0

    for _, v := range data {
        if v > 0 {
            total := total + v*multiplier
            fmt.Println("added:", total)
        }
    }

    multiplier := 2  // reassign multiplier for some reason
    _ = multiplier

    return total
}

func main() {
    result := process([]int{1, -2, 3, -4, 5}, 10)
    fmt.Println("result:", result)  // What does this print?
}
```

**Your tasks:**
1. List all shadow occurrences (there are 2)
2. Predict the output
3. Write the corrected version that produces the intended sum of positive values multiplied by `multiplier`

**Starter code:**

```go
package main

import "fmt"

// Fix this function
func processFixed(data []int, multiplier int) int {
    total := 0
    // Your fix here
    return total
}

func main() {
    result := processFixed([]int{1, -2, 3, -4, 5}, 10)
    fmt.Println("result:", result) // Should print: 90 (1+3+5=9, *10=90)
}
```

<details>
<summary>Solution</summary>

**Shadow occurrences:**
1. `total := total + v*multiplier` — shadows outer `total` (the one returned)
2. `multiplier := 2` — shadows the function parameter `multiplier`

**Predicted output:** `result: 0` — outer `total` is never updated.

**Fixed version:**
```go
package main

import "fmt"

func processFixed(data []int, multiplier int) int {
    total := 0
    for _, v := range data {
        if v > 0 {
            total += v * multiplier  // = not :=
            fmt.Println("added:", total)
        }
    }
    return total
}

func main() {
    result := processFixed([]int{1, -2, 3, -4, 5}, 10)
    fmt.Println("result:", result) // prints: 90
}
```
</details>

---

## Task 3: Fix the Shadowed err Variable (Beginner-Intermediate)

**Goal:** Fix a common production-style bug where `err` is shadowed across multiple operations.

**Starter code:**

```go
package main

import (
    "errors"
    "fmt"
)

func validateAge(age int) error {
    if age < 0 {
        return errors.New("age cannot be negative")
    }
    if age > 150 {
        return errors.New("age is unrealistically large")
    }
    return nil
}

func validateName(name string) error {
    if name == "" {
        return errors.New("name cannot be empty")
    }
    if len(name) > 100 {
        return errors.New("name is too long")
    }
    return nil
}

func saveUser(name string, age int) error {
    // Simulated save
    fmt.Printf("saving user: name=%s age=%d\n", name, age)
    return nil
}

// BUG: This function has shadowing issues
// Fix it so all errors are properly propagated
func createUser(name string, age int) error {
    err := validateName(name)
    if err != nil {
        if err := fmt.Errorf("name validation: %w", err); err != nil {
            return err
        }
    }

    err = validateAge(age)
    if err != nil {
        if err := fmt.Errorf("age validation: %w", err); err != nil {
            return err
        }
    }

    if err := saveUser(name, age); err != nil {
        return fmt.Errorf("save: %w", err)
    }

    return nil
}

func main() {
    tests := []struct {
        name string
        age  int
    }{
        {"Alice", 30},
        {"", 30},        // should error: name empty
        {"Bob", -5},     // should error: negative age
        {"Carol", 200},  // should error: age too large
    }

    for _, tt := range tests {
        err := createUser(tt.name, tt.age)
        if err != nil {
            fmt.Printf("createUser(%q, %d) error: %v\n", tt.name, tt.age, err)
        } else {
            fmt.Printf("createUser(%q, %d) success\n", tt.name, tt.age)
        }
    }
}
```

**Your task:** Rewrite `createUser` so it correctly propagates all errors. The nested `if err := ...; err != nil` pattern is redundant and confusing — simplify it.

<details>
<summary>Solution</summary>

```go
func createUser(name string, age int) error {
    if err := validateName(name); err != nil {
        return fmt.Errorf("name validation: %w", err)
    }

    if err := validateAge(age); err != nil {
        return fmt.Errorf("age validation: %w", err)
    }

    if err := saveUser(name, age); err != nil {
        return fmt.Errorf("save: %w", err)
    }

    return nil
}
```

The original code's `if err := fmt.Errorf(...); err != nil` is always true (Errorf never returns nil), so it was logically correct by accident — but the original intent of the outer `if err != nil` check was already handling the error. The clean version uses the if-initializer pattern consistently.

</details>

---

## Task 4: Fix the Goroutine Loop Variable Capture Bug (Intermediate)

**Goal:** Fix a goroutine capture bug in three different ways, and verify correctness with a sync.WaitGroup.

**Starter code:**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

// BUG: this function has a goroutine loop capture bug
// It should print each URL being fetched, but prints wrong URLs
func fetchURLs(urls []string) {
    var wg sync.WaitGroup
    for _, url := range urls {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(10 * time.Millisecond) // simulate work
            fmt.Printf("fetching: %s\n", url)
        }()
    }
    wg.Wait()
}

func main() {
    urls := []string{
        "https://api.example.com/users",
        "https://api.example.com/products",
        "https://api.example.com/orders",
    }

    fmt.Println("=== Buggy version ===")
    fetchURLs(urls)

    fmt.Println("\n=== Fix 1: argument passing ===")
    // TODO: implement fetchURLsFix1

    fmt.Println("\n=== Fix 2: loop variable copy ===")
    // TODO: implement fetchURLsFix2

    fmt.Println("\n=== Fix 3: Go 1.22 style (document only) ===")
    // TODO: explain in a comment what changes with Go 1.22
}
```

**Your task:** Implement all three versions.

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

// Original buggy version
func fetchURLs(urls []string) {
    var wg sync.WaitGroup
    for _, url := range urls {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(10 * time.Millisecond)
            fmt.Printf("fetching: %s\n", url) // BUG: captures url by ref
        }()
    }
    wg.Wait()
}

// Fix 1: Pass as function argument
func fetchURLsFix1(urls []string) {
    var wg sync.WaitGroup
    for _, url := range urls {
        wg.Add(1)
        go func(u string) { // u is a copy of url at call time
            defer wg.Done()
            time.Sleep(10 * time.Millisecond)
            fmt.Printf("fetching: %s\n", u)
        }(url) // pass url as argument
    }
    wg.Wait()
}

// Fix 2: Create new variable per iteration
func fetchURLsFix2(urls []string) {
    var wg sync.WaitGroup
    for _, url := range urls {
        url := url // shadow loop variable — new variable each iteration
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(10 * time.Millisecond)
            fmt.Printf("fetching: %s\n", url) // captures per-iteration url
        }()
    }
    wg.Wait()
}

// Fix 3: With Go 1.22 (go.mod: go 1.22)
// The original fetchURLs function works correctly — no code change needed.
// Each iteration of range automatically gets its own 'url' variable.

func main() {
    urls := []string{
        "https://api.example.com/users",
        "https://api.example.com/products",
        "https://api.example.com/orders",
    }

    fmt.Println("=== Buggy version ===")
    fetchURLs(urls) // May print the last URL 3 times

    fmt.Println("\n=== Fix 1: argument passing ===")
    fetchURLsFix1(urls) // Correct

    fmt.Println("\n=== Fix 2: loop variable copy ===")
    fetchURLsFix2(urls) // Correct
}
```

</details>

---

## Task 5: Understanding Closure Scope (Intermediate)

**Goal:** Predict the output of closure-related code and then write your own closures.

**Part A: Predict the output**

```go
package main

import "fmt"

func makeMultiplier(factor int) func(int) int {
    return func(n int) int {
        return n * factor
    }
}

func makeAccumulator() func(int) int {
    sum := 0
    return func(n int) int {
        sum += n
        return sum
    }
}

func main() {
    double := makeMultiplier(2)
    triple := makeMultiplier(3)

    fmt.Println(double(5))   // A: ?
    fmt.Println(triple(5))   // B: ?
    fmt.Println(double(10))  // C: ?

    acc := makeAccumulator()
    fmt.Println(acc(1))   // D: ?
    fmt.Println(acc(2))   // E: ?
    fmt.Println(acc(10))  // F: ?

    acc2 := makeAccumulator()
    fmt.Println(acc2(5))  // G: ?
    fmt.Println(acc(0))   // H: ?
}
```

**Part B: Write a closure**

Write a function `makeRateLimiter` that:
1. Takes `maxCalls int` as parameter
2. Returns a function that:
   - Returns `true` if the call count is below `maxCalls`
   - Returns `false` if the limit has been reached
   - Tracks calls using a captured variable

```go
// Starter:
func makeRateLimiter(maxCalls int) func() bool {
    // TODO: implement
    return nil
}

func main() {
    allow := makeRateLimiter(3)
    fmt.Println(allow()) // true
    fmt.Println(allow()) // true
    fmt.Println(allow()) // true
    fmt.Println(allow()) // false
    fmt.Println(allow()) // false
}
```

<details>
<summary>Solution</summary>

**Part A outputs:**
```
A: 10    (5 * 2)
B: 15    (5 * 3)
C: 20    (10 * 2)
D: 1     (sum: 0+1=1)
E: 3     (sum: 1+2=3)
F: 13    (sum: 3+10=13)
G: 5     (acc2 is independent, sum: 0+5=5)
H: 13    (acc's sum unchanged: 13+0=13)
```

**Part B solution:**
```go
func makeRateLimiter(maxCalls int) func() bool {
    calls := 0
    return func() bool {
        if calls >= maxCalls {
            return false
        }
        calls++
        return true
    }
}
```

</details>

---

## Task 6: Named Return Value Shadow Trap (Intermediate)

**Goal:** Fix a function where named return values are accidentally shadowed.

**Starter code:**

```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

// This function should:
// 1. Parse a string to int
// 2. Double it
// 3. Return the result and any error
// But it has a shadow bug — fix it.
func doubleString(s string) (result int, err error) {
    if parsed, err := strconv.Atoi(s); err != nil {
        // handle parse error
        err = fmt.Errorf("parse %q: %w", s, err)
        return
    } else {
        result, err := parsed*2, error(nil)
        _ = err
        result = result // this looks wrong...
        return result, nil
    }
}

func main() {
    tests := []struct {
        input string
        want  int
        isErr bool
    }{
        {"5", 10, false},
        {"abc", 0, true},
        {"-3", -6, false},
    }

    for _, tt := range tests {
        got, err := doubleString(tt.input)
        if tt.isErr && err == nil {
            fmt.Printf("FAIL %q: expected error\n", tt.input)
        } else if !tt.isErr && err != nil {
            fmt.Printf("FAIL %q: unexpected error: %v\n", tt.input, err)
        } else if !tt.isErr && got != tt.want {
            fmt.Printf("FAIL %q: got %d, want %d\n", tt.input, got, tt.want)
        } else {
            fmt.Printf("PASS %q\n", tt.input)
        }
    }
}
```

**Your task:** Rewrite `doubleString` cleanly without shadow bugs.

<details>
<summary>Solution</summary>

```go
func doubleString(s string) (int, error) {
    parsed, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parse %q: %w", s, err)
    }
    return parsed * 2, nil
}
```

The original function was broken because:
1. `if parsed, err := strconv.Atoi(s); err != nil` — creates new `parsed` and `err` shadowing named returns
2. Inside the else, `result, err := ...` creates yet another shadow
3. The named returns `result` and `err` were never assigned

The clean version avoids named returns entirely, which is often the right call when they create confusion.

</details>

---

## Task 7: Configure the Shadow Linter (Intermediate)

**Goal:** Set up a complete golangci-lint configuration for a Go project that catches shadow issues.

**Your task:**

1. Create a `.golangci.yml` file with:
   - Shadow detection enabled
   - At least 3 other linters enabled
   - A rule to exclude shadow warnings in test files

2. Write a `Makefile` with:
   - A `lint` target that runs golangci-lint
   - A `lint-shadow` target that specifically runs the shadow checker
   - A `check` target that runs both lint and tests

3. Write a shell script `scripts/check-shadows.sh` that:
   - Runs the shadow checker
   - Exits with code 1 if shadows are found
   - Prints a helpful message

**Starter code:**

```yaml
# .golangci.yml — complete this
run:
  timeout: 5m

linters:
  enable:
    # TODO: add linters including shadow detection
```

```makefile
# Makefile — complete this
.PHONY: lint lint-shadow check test

test:
	go test ./...

# TODO: add lint, lint-shadow, check targets
```

```bash
#!/bin/bash
# scripts/check-shadows.sh — complete this
# TODO: implement
```

<details>
<summary>Solution</summary>

**.golangci.yml:**
```yaml
run:
  timeout: 5m
  go: '1.22'

linters:
  disable-all: true
  enable:
    - govet
    - staticcheck
    - ineffassign
    - unused
    - errorlint
    - gocritic
    - revive

linters-settings:
  govet:
    enable:
      - shadow
      - assign
      - loopclosure
      - lostcancel
  revive:
    rules:
      - name: redefines-builtin-id
        severity: error

issues:
  exclude-rules:
    - path: "_test.go"
      linters:
        - govet
      text: "shadow"
  max-same-issues: 0
```

**Makefile:**
```makefile
.PHONY: lint lint-shadow check test

test:
	go test -race ./...

lint:
	golangci-lint run ./...

lint-shadow:
	go vet -vettool=$(shell which shadow 2>/dev/null || echo shadow) ./... 2>&1 | \
		grep -v "^#" || echo "No shadow issues found"

check: lint test
	@echo "All checks passed!"
```

**scripts/check-shadows.sh:**
```bash
#!/bin/bash
set -e

echo "Checking for variable shadowing..."

# Check if shadow tool is installed
if ! command -v shadow &> /dev/null; then
    echo "Installing shadow tool..."
    go install golang.org/x/tools/go/analysis/passes/shadow/cmd/shadow@latest
fi

# Run shadow checker
OUTPUT=$(shadow ./... 2>&1 || true)

if [ -n "$OUTPUT" ]; then
    echo "Shadow issues found:"
    echo "$OUTPUT"
    echo ""
    echo "Fix: use '=' instead of ':=' to update existing variables,"
    echo "or rename the inner variable to avoid shadowing."
    exit 1
else
    echo "No shadow issues found!"
    exit 0
fi
```

</details>

---

## Task 8: Scope in Switch Statements (Intermediate)

**Goal:** Understand and work with switch statement scope.

**Starter code:**

```go
package main

import "fmt"

type Shape interface {
    Area() float64
}

type Circle struct{ Radius float64 }
type Rectangle struct{ Width, Height float64 }
type Triangle struct{ Base, Height float64 }

func (c Circle) Area() float64     { return 3.14159 * c.Radius * c.Radius }
func (r Rectangle) Area() float64  { return r.Width * r.Height }
func (t Triangle) Area() float64   { return 0.5 * t.Base * t.Height }

// Fix the scope issues in this function:
func describeShape(s Shape) string {
    var description string

    switch v := s.(type) {
    case Circle:
        description = fmt.Sprintf("Circle with radius %.2f", v.Radius)
        area := v.Area()
        // area is only needed here — is it scoped correctly?
        _ = area
    case Rectangle:
        description = fmt.Sprintf("Rectangle %gx%g", v.Width, v.Height)
        area := v.Area()
        _ = area
    case Triangle:
        description = fmt.Sprintf("Triangle base=%g height=%g", v.Base, v.Height)
        area := v.Area()
        _ = area
    default:
        description = "Unknown shape"
    }

    // TODO: include area in description for all cases
    // Currently area is not accessible here — how to fix?

    return description
}

func main() {
    shapes := []Shape{
        Circle{Radius: 5},
        Rectangle{Width: 3, Height: 4},
        Triangle{Base: 6, Height: 8},
    }

    for _, s := range shapes {
        fmt.Println(describeShape(s))
    }
}
```

**Your task:** Rewrite `describeShape` so the output includes the area. Example:
```
Circle with radius 5.00 (area: 78.54)
Rectangle 3x4 (area: 12.00)
Triangle base=6 height=8 (area: 24.00)
```

<details>
<summary>Solution</summary>

```go
func describeShape(s Shape) string {
    area := s.Area()  // compute area at function scope

    var shapeName string
    switch v := s.(type) {
    case Circle:
        shapeName = fmt.Sprintf("Circle with radius %.2f", v.Radius)
    case Rectangle:
        shapeName = fmt.Sprintf("Rectangle %gx%g", v.Width, v.Height)
    case Triangle:
        shapeName = fmt.Sprintf("Triangle base=%g height=%g", v.Base, v.Height)
    default:
        shapeName = "Unknown shape"
    }

    return fmt.Sprintf("%s (area: %.2f)", shapeName, area)
}
```

The key insight: `area` must be computed at function scope to be accessible for the final return statement. Variables declared inside `case` blocks are scoped to that case only.

</details>

---

## Task 9: Write a Shadow-Safe Error Handling Pipeline (Advanced)

**Goal:** Build a multi-step data processing pipeline without any shadowed variables.

**Context:** You are building a user registration system. The pipeline must:
1. Parse JSON input
2. Validate email format
3. Hash the password
4. Check if email exists in DB (simulated)
5. Store the user (simulated)

Each step should return an error, and all errors should be properly propagated.

**Starter code:**

```go
package main

import (
    "crypto/sha256"
    "encoding/json"
    "errors"
    "fmt"
    "strings"
)

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
    Name     string `json:"name"`
}

type User struct {
    Email        string
    PasswordHash string
    Name         string
}

// Simulate DB
var existingEmails = map[string]bool{
    "taken@example.com": true,
}

func parseRequest(data []byte) (RegisterRequest, error) {
    var req RegisterRequest
    if err := json.Unmarshal(data, &req); err != nil {
        return req, fmt.Errorf("parse: %w", err)
    }
    return req, nil
}

func validateEmail(email string) error {
    if !strings.Contains(email, "@") {
        return errors.New("invalid email: missing @")
    }
    if len(email) < 3 {
        return errors.New("invalid email: too short")
    }
    return nil
}

func hashPassword(password string) (string, error) {
    if len(password) < 8 {
        return "", errors.New("password must be at least 8 characters")
    }
    h := sha256.Sum256([]byte(password))
    return fmt.Sprintf("%x", h), nil
}

func checkEmailAvailable(email string) error {
    if existingEmails[email] {
        return fmt.Errorf("email %q is already registered", email)
    }
    return nil
}

func storeUser(user User) error {
    existingEmails[user.Email] = true
    fmt.Printf("stored: %+v\n", user)
    return nil
}

// TODO: Implement this function without ANY variable shadowing
// Use early returns and clear error propagation
func registerUser(data []byte) error {
    // Your implementation here
    return nil
}

func main() {
    testCases := []string{
        `{"email":"alice@example.com","password":"secure123","name":"Alice"}`,
        `{"email":"invalid-email","password":"secure123","name":"Bob"}`,
        `{"email":"taken@example.com","password":"secure123","name":"Carol"}`,
        `{"email":"bob@example.com","password":"short","name":"Bob"}`,
        `invalid json`,
    }

    for _, tc := range testCases {
        err := registerUser([]byte(tc))
        if err != nil {
            fmt.Printf("register failed: %v\n", err)
        }
        fmt.Println("---")
    }
}
```

<details>
<summary>Solution</summary>

```go
func registerUser(data []byte) error {
    req, err := parseRequest(data)
    if err != nil {
        return err
    }

    if err = validateEmail(req.Email); err != nil {
        return fmt.Errorf("email: %w", err)
    }

    passwordHash, err := hashPassword(req.Password)
    if err != nil {
        return fmt.Errorf("password: %w", err)
    }

    if err = checkEmailAvailable(req.Email); err != nil {
        return err
    }

    user := User{
        Email:        req.Email,
        PasswordHash: passwordHash,
        Name:         req.Name,
    }

    if err = storeUser(user); err != nil {
        return fmt.Errorf("store: %w", err)
    }

    return nil
}
```

Key points:
- `err` is declared once with `:=` and reused with `=` for all subsequent operations
- Each step's error is wrapped with context
- No nested blocks — flat structure eliminates shadow risk
- `passwordHash` uses a descriptive name different from `req`

</details>

---

## Task 10: Analyze and Refactor a Shadow-Heavy Function (Advanced)

**Goal:** Take a deeply nested, shadow-filled function and refactor it into clean, shadow-free code.

**Starter code (do not modify the logic, only the structure):**

```go
package main

import (
    "errors"
    "fmt"
    "os"
    "strconv"
    "strings"
)

// This function processes a config file line by line.
// It has multiple shadow bugs and deeply nested logic.
// Refactor it WITHOUT changing the behavior.
func processConfigFile(filename string) (map[string]int, error) {
    result := map[string]int{}

    f, err := os.Open(filename)
    if err == nil {
        defer f.Close()

        data := make([]byte, 4096)
        n, err := f.Read(data)
        if err == nil {
            content := string(data[:n])
            lines := strings.Split(content, "\n")

            for _, line := range lines {
                line := strings.TrimSpace(line)
                if line != "" && !strings.HasPrefix(line, "#") {
                    parts := strings.SplitN(line, "=", 2)
                    if len(parts) == 2 {
                        key := strings.TrimSpace(parts[0])
                        value := strings.TrimSpace(parts[1])

                        if key != "" {
                            n, err := strconv.Atoi(value)
                            if err == nil {
                                result[key] = n
                            } else {
                                err = fmt.Errorf("invalid value for %q: %w", key, err)
                                return result, err
                            }
                        }
                    } else {
                        return result, errors.New("invalid line format: " + line)
                    }
                }
            }
        } else {
            return result, fmt.Errorf("read file: %w", err)
        }
    } else {
        return result, fmt.Errorf("open file: %w", err)
    }

    return result, nil
}

func main() {
    // Create a test file
    content := "# config file\nport=8080\ntimeout=30\n# comment\nworkers=4\n"
    os.WriteFile("test.conf", []byte(content), 0644)
    defer os.Remove("test.conf")

    cfg, err := processConfigFile("test.conf")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("config:", cfg)
}
```

**Shadow bugs to find and fix:**
1. `n` is shadowed (two different `n` variables)
2. `err` is shadowed in nested blocks
3. `line` is shadowed (loop variable vs. trimmed version)

**Your task:** Refactor into clean helper functions with no shadowing.

<details>
<summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
    "io"
    "os"
    "strconv"
    "strings"
)

func readFileContent(filename string) (string, error) {
    f, err := os.Open(filename)
    if err != nil {
        return "", fmt.Errorf("open file: %w", err)
    }
    defer f.Close()

    data, err := io.ReadAll(f)
    if err != nil {
        return "", fmt.Errorf("read file: %w", err)
    }
    return string(data), nil
}

func parseLine(line string) (key string, value int, skip bool, err error) {
    line = strings.TrimSpace(line)
    if line == "" || strings.HasPrefix(line, "#") {
        return "", 0, true, nil // skip blank lines and comments
    }

    parts := strings.SplitN(line, "=", 2)
    if len(parts) != 2 {
        return "", 0, false, errors.New("invalid line format: " + line)
    }

    key = strings.TrimSpace(parts[0])
    if key == "" {
        return "", 0, true, nil // skip empty keys
    }

    valueStr := strings.TrimSpace(parts[1])
    value, err = strconv.Atoi(valueStr)
    if err != nil {
        return "", 0, false, fmt.Errorf("invalid value for %q: %w", key, err)
    }

    return key, value, false, nil
}

func processConfigFile(filename string) (map[string]int, error) {
    content, err := readFileContent(filename)
    if err != nil {
        return nil, err
    }

    result := map[string]int{}
    for _, rawLine := range strings.Split(content, "\n") {
        key, value, skip, err := parseLine(rawLine)
        if err != nil {
            return result, err
        }
        if skip {
            continue
        }
        result[key] = value
    }

    return result, nil
}

func main() {
    content := "# config file\nport=8080\ntimeout=30\n# comment\nworkers=4\n"
    os.WriteFile("test.conf", []byte(content), 0644)
    defer os.Remove("test.conf")

    cfg, err := processConfigFile("test.conf")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("config:", cfg)
}
```

Key improvements:
- Extracted `readFileContent` and `parseLine` — each has its own scope
- No shadowed `n`, `err`, or `line` variables
- Used `io.ReadAll` instead of manually managing buffer size
- Flat structure within each function

</details>

---

## Summary of Tasks

| Task | Topic | Difficulty |
|------|-------|-----------|
| 1 | Scope identification quiz | Beginner |
| 2 | Spot the shadow | Beginner |
| 3 | Fix shadowed err variable | Beginner-Intermediate |
| 4 | Goroutine loop capture bug (3 fixes) | Intermediate |
| 5 | Closure scope and writing closures | Intermediate |
| 6 | Named return value shadow trap | Intermediate |
| 7 | Configure shadow linter (golangci-lint) | Intermediate |
| 8 | Switch statement scope | Intermediate |
| 9 | Shadow-safe error handling pipeline | Advanced |
| 10 | Refactor shadow-heavy function | Advanced |

## How to Verify Your Solutions

```bash
# Run all tests
go test ./...

# Check for shadows
golangci-lint run --enable-all ./...

# Run with race detector
go test -race ./...

# Check escape analysis
go build -gcflags="-m" ./...
```
