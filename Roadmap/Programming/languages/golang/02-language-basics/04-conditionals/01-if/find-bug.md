# if Statement — Find the Bug

Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard

---

## Bug 1 🟢 The Inverted Error Check

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    data, err := os.ReadFile("config.json")
    if err == nil {
        fmt.Println("Error reading file:", err)
        return
    }
    fmt.Printf("File content (%d bytes): %s\n", len(data), data)
}
```

**What should it do:** Read a file, print its contents on success, print error on failure.

<details>
<summary>Hint</summary>
The error check condition is checking the wrong thing. When `err == nil`, there is no error.
</details>

<details>
<summary>Solution</summary>

**Bug:** The condition is inverted. `err == nil` means there is NO error — so the code currently prints "Error reading file" when there's no error, and tries to use `data` (which may be empty/invalid) when there IS an error.

**Fix:**
```go
data, err := os.ReadFile("config.json")
if err != nil {   // err != nil means error occurred
    fmt.Println("Error reading file:", err)
    return
}
fmt.Printf("File content (%d bytes): %s\n", len(data), data)
```

**Key Lesson:** In Go, `err == nil` means "no error occurred" (success). `err != nil` means "an error occurred". Always check `err != nil` to detect errors.
</details>

---

## Bug 2 🟢 Missing Braces on Single-Statement `if`

```go
package main

import "fmt"

func checkAge(age int) string {
    if age >= 18
        return "adult"
    return "minor"
}

func main() {
    fmt.Println(checkAge(20))
    fmt.Println(checkAge(15))
}
```

**What should it do:** Return "adult" for age >= 18, "minor" otherwise.

<details>
<summary>Hint</summary>
Go requires braces around `if` bodies. What happens when they're missing?
</details>

<details>
<summary>Solution</summary>

**Bug:** Go requires braces `{}` for all `if` bodies — even single-statement bodies. This is a syntax error that the compiler catches.

**Fix:**
```go
func checkAge(age int) string {
    if age >= 18 {     // braces required
        return "adult"
    }
    return "minor"
}
```

**Key Lesson:** Unlike C/Java, Go does not allow brace-free single-statement `if` bodies. This design choice prevents bugs like Apple's "goto fail" SSL vulnerability.
</details>

---

## Bug 3 🟢 Checking `== true` Instead of Direct Boolean

```go
package main

import "fmt"

func isEven(n int) bool {
    return n%2 == 0
}

func main() {
    numbers := []int{1, 2, 3, 4, 5}
    for _, n := range numbers {
        if isEven(n) == true {
            fmt.Printf("%d is even\n", n)
        } else if isEven(n) == false {
            fmt.Printf("%d is odd\n", n)
        }
    }
}
```

**What should it do:** Print whether each number is even or odd.

<details>
<summary>Hint</summary>
The code works but violates Go idioms. How should boolean values be used in `if` conditions?
</details>

<details>
<summary>Solution</summary>

**Bug:** Two problems:
1. `isEven(n) == true` is redundant — `isEven(n)` is already a `bool`
2. `isEven(n)` is called twice — unnecessary double computation

**Fix:**
```go
for _, n := range numbers {
    if isEven(n) {           // not: if isEven(n) == true
        fmt.Printf("%d is even\n", n)
    } else {                  // not: else if isEven(n) == false
        fmt.Printf("%d is odd\n", n)
    }
}
```

**Key Lesson:** Use `if flag` not `if flag == true`, and `if !flag` not `if flag == false`. Never call the same function twice in a condition — store the result.
</details>

---

## Bug 4 🟢 Variable Not Accessible After `if` Block

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    input := "42"

    if n, err := strconv.Atoi(input); err != nil {
        fmt.Println("Error:", err)
    }

    fmt.Println("Parsed:", n) // using n outside its scope!
}
```

<details>
<summary>Hint</summary>
Variables declared in the `if` init statement are scoped to the if-else block. Where is `n` accessible?
</details>

<details>
<summary>Solution</summary>

**Bug:** `n` is declared in the `if` init statement (`n, err := strconv.Atoi(input)`) and is only accessible within the `if-else` block. Using it after the closing `}` is a compile error: `undefined: n`.

**Fix — Option 1: Declare before `if`:**
```go
n, err := strconv.Atoi(input)
if err != nil {
    fmt.Println("Error:", err)
    return
}
fmt.Println("Parsed:", n) // n is in scope
```

**Fix — Option 2: Use `n` inside the `else` block:**
```go
if n, err := strconv.Atoi(input); err != nil {
    fmt.Println("Error:", err)
} else {
    fmt.Println("Parsed:", n) // n accessible in else
}
```

**Key Lesson:** Variables declared in an `if` init statement are scoped to the entire `if-else` chain, not to the code after it. If you need the value outside, declare it before the `if`.
</details>

---

## Bug 5 🟡 Incorrect `nil` Check on Interface

```go
package main

import "fmt"

type MyError struct {
    msg string
}

func (e *MyError) Error() string { return e.msg }

func getError(fail bool) error {
    if fail {
        return &MyError{"something failed"}
    }
    var err *MyError = nil  // typed nil!
    return err              // returns non-nil interface holding nil *MyError
}

func main() {
    err := getError(false)
    if err != nil {
        fmt.Println("Got error:", err) // prints even though we returned "nil"!
    } else {
        fmt.Println("No error")
    }
}
```

<details>
<summary>Hint</summary>
In Go, an interface value is `nil` only if both its type and value are nil. What happens when you return a typed nil pointer wrapped in an interface?
</details>

<details>
<summary>Solution</summary>

**Bug:** The function returns `err` (of type `*MyError`, value nil) as an `error` interface. The interface value holds: `{type: *MyError, value: nil}`. This is a **non-nil interface** even though the underlying pointer is nil. The `if err != nil` check sees a non-nil interface.

**Fix — Option 1: Return `nil` directly:**
```go
func getError(fail bool) error {
    if fail {
        return &MyError{"something failed"}
    }
    return nil // returns nil interface, not typed nil
}
```

**Fix — Option 2: Return typed value, check typed nil:**
```go
func getMyError(fail bool) *MyError {
    if fail {
        return &MyError{"something failed"}
    }
    return nil
}
// Caller checks typed nil:
if err := getMyError(false); err != nil { }
```

**Key Lesson:** Never return a typed nil pointer as an interface. Always return the untyped `nil` directly. This is one of Go's most common subtle bugs.
</details>

---

## Bug 6 🟡 Float Comparison with `==`

```go
package main

import "fmt"

func calculateTax(amount float64) float64 {
    tax := amount * 0.1
    return tax
}

func main() {
    price := 19.90
    tax := calculateTax(price)
    total := price + tax

    if total == 21.89 {
        fmt.Println("Total is correct: 21.89")
    } else {
        fmt.Printf("Total is wrong: %.20f\n", total)
    }
}
```

<details>
<summary>Hint</summary>
Floating-point arithmetic is not exact. What is `19.90 * 1.1` in IEEE 754 binary representation?
</details>

<details>
<summary>Solution</summary>

**Bug:** `total == 21.89` uses exact equality with floating-point numbers. Due to binary floating-point representation, `19.90 * 1.1` is not exactly `21.89` — it's approximately `21.890000000000001...`.

```
price = 19.90 (not exactly representable in binary float)
tax   = 19.90 * 0.1 ≈ 1.9899999999999999289...
total = 21.8899999999999... ≠ 21.89
```

**Fix:**
```go
import "math"

epsilon := 0.001
if math.Abs(total-21.89) < epsilon {
    fmt.Println("Total is approximately correct")
}

// Or for financial calculations: use integer cents
priceInCents := 1990 // $19.90
taxInCents := priceInCents / 10 // integer division: 199
totalInCents := priceInCents + taxInCents // 2189 = $21.89
if totalInCents == 2189 {
    fmt.Printf("Total: $%d.%02d\n", totalInCents/100, totalInCents%100)
}
```

**Key Lesson:** Never use `==` for float comparison. Use `math.Abs(a-b) < epsilon` or use integer arithmetic (cents) for money.
</details>

---

## Bug 7 🟡 `else` After `return` (Unnecessary Else)

```go
package main

import (
    "errors"
    "fmt"
)

func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    } else {
        result := a / b
        if result > 1000 {
            return 0, errors.New("result too large")
        } else {
            return result, nil
        }
    }
}

func main() {
    if r, err := divide(10, 2); err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Printf("Result: %.2f\n", r)
    }
}
```

**What's wrong?** The code works correctly but has structural issues.

<details>
<summary>Hint</summary>
When an `if` block always returns, the `else` is logically equivalent to the code just continuing after the `if`.
</details>

<details>
<summary>Solution</summary>

**Bug:** Redundant `else` blocks after `return` statements — deep nesting that could be flat.

**Fixed (guard clause style):**
```go
func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    result := a / b
    if result > 1000 {
        return 0, errors.New("result too large")
    }
    return result, nil
}
```

**Also fix the caller (else after return):**
```go
r, err := divide(10, 2)
if err != nil {
    fmt.Println("Error:", err)
    return
}
fmt.Printf("Result: %.2f\n", r) // no else needed
```

**Key Lesson:** If an `if` block always returns, the subsequent `else` is redundant. Drop it for cleaner, flatter code. Linters (`revive`, `staticcheck`) flag this pattern.
</details>

---

## Bug 8 🟡 Shadowing Variable in `if` Init

```go
package main

import (
    "fmt"
    "errors"
)

var ErrDatabase = errors.New("database error")

func queryDB() error {
    return ErrDatabase
}

func process() error {
    err := queryDB()
    if err != nil {
        if err := fmt.Errorf("process: %w", err); err != nil {
            // The developer intended to check the WRAPPED error,
            // but actually checks if Errorf itself failed (it never does)
            return err
        }
    }
    return nil
}

func main() {
    err := process()
    if err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Println("Success")
    }
}
```

<details>
<summary>Hint</summary>
Look carefully at the nested `if err :=`. Does `fmt.Errorf` ever return an error? What does the inner `err` shadow?
</details>

<details>
<summary>Solution</summary>

**Bug:** The code tries to wrap the error, but the structure is wrong:
1. `fmt.Errorf("process: %w", err)` always succeeds and returns a non-nil error — the outer `err != nil` check is always true when we reach the inner block
2. `if err := fmt.Errorf(...); err != nil` — `fmt.Errorf` never returns nil! The inner `err` is always non-nil, so this is effectively `if true`
3. The inner `err` shadows the outer `err` — confusing

**Fix:**
```go
func process() error {
    if err := queryDB(); err != nil {
        return fmt.Errorf("process: %w", err) // wrap and return directly
    }
    return nil
}
```

**Key Lesson:** Don't use `if` init statement to create wrapped errors — just wrap and return. `fmt.Errorf` always returns a non-nil error value, so `if err := fmt.Errorf(...); err != nil` is always true.
</details>

---

## Bug 9 🔴 Check-Then-Act Race Condition

```go
package main

import (
    "fmt"
    "sync"
)

type Cache struct {
    mu   sync.Mutex
    data map[string]string
}

func (c *Cache) GetOrCreate(key string, create func() string) string {
    c.mu.Lock()
    val, ok := c.data[key]
    c.mu.Unlock() // unlock to allow concurrent reads

    if !ok { // check
        newVal := create()
        c.mu.Lock()
        c.data[key] = newVal // act
        c.mu.Unlock()
        return newVal
    }
    return val
}

var cache = &Cache{data: make(map[string]string)}

func main() {
    // Simulating concurrent access:
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            val := cache.GetOrCreate("key", func() string {
                fmt.Printf("creating value (goroutine %d)\n", n)
                return fmt.Sprintf("value-%d", n)
            })
            fmt.Printf("goroutine %d got: %s\n", n, val)
        }(i)
    }
    wg.Wait()
}
```

<details>
<summary>Hint</summary>
Between the "check" (reading `ok`) and the "act" (writing `c.data[key]`), the lock is released. What can happen?
</details>

<details>
<summary>Solution</summary>

**Bug:** Classic check-then-act (TOCTOU) race condition:
1. Goroutine A checks `!ok` — key not found
2. Lock released
3. Goroutine B also checks `!ok` — also not found (before A writes)
4. Both goroutines call `create()` and write the key
5. `create()` runs multiple times — data is overwritten, last writer wins

The `if !ok` check and the subsequent write are not atomic.

**Fix — Option 1: Keep lock held for both check and act:**
```go
func (c *Cache) GetOrCreate(key string, create func() string) string {
    c.mu.Lock()
    defer c.mu.Unlock()

    if val, ok := c.data[key]; ok {
        return val // return while still locked
    }
    val := create() // create while locked — prevents race
    c.data[key] = val
    return val
}
```

**Fix — Option 2: Double-checked locking with sync.Map:**
```go
var cache sync.Map

func getOrCreate(key string, create func() string) string {
    if val, ok := cache.Load(key); ok {
        return val.(string)
    }
    val, _ := cache.LoadOrStore(key, create()) // atomic check-and-store
    return val.(string)
}
```

**Note:** In Fix 2, `create()` may still be called multiple times, but only one result is stored. Use LoadOrStore carefully when `create()` has side effects.

**Key Lesson:** Any "check then act" sequence must be protected by holding a lock for the entire sequence. Releasing and re-acquiring the lock creates a race window.
</details>

---

## Bug 10 🔴 Wrong Error Type Check with Interface

```go
package main

import (
    "fmt"
    "net"
)

func isTimeout(err error) bool {
    if netErr, ok := err.(net.Error); ok {
        return netErr.Timeout()
    }
    return false
}

func main() {
    // Simulate a wrapped timeout error
    originalErr := &net.OpError{
        Op:   "dial",
        Net:  "tcp",
        Err:  &timeoutError{},
    }
    wrappedErr := fmt.Errorf("connection failed: %w", originalErr)

    fmt.Println("isTimeout (direct):", isTimeout(originalErr)) // true
    fmt.Println("isTimeout (wrapped):", isTimeout(wrappedErr)) // false! BUG
}

type timeoutError struct{}
func (e *timeoutError) Error() string   { return "timeout" }
func (e *timeoutError) Timeout() bool   { return true }
func (e *timeoutError) Temporary() bool { return true }
```

<details>
<summary>Hint</summary>
Type assertion `err.(net.Error)` only checks the top-level error type. What happens when the error is wrapped?
</details>

<details>
<summary>Solution</summary>

**Bug:** `err.(net.Error)` is a type assertion — it only checks if the **top-level** error implements `net.Error`. When `err` is a `*fmt.wrapError` (from `fmt.Errorf(...%w...)`), the type assertion fails even if the wrapped error implements `net.Error`.

**Fix — Use `errors.As` which unwraps:**
```go
func isTimeout(err error) bool {
    var netErr net.Error
    if errors.As(err, &netErr) { // unwraps error chain
        return netErr.Timeout()
    }
    return false
}

// Or check the Timeout() method directly:
func isTimeout(err error) bool {
    type timeouter interface{ Timeout() bool }
    var te timeouter
    if errors.As(err, &te) {
        return te.Timeout()
    }
    return false
}
```

**Key Lesson:** Use `errors.As` instead of type assertions when working with errors that may be wrapped. Type assertions only look at the top-level error type; `errors.As` traverses the entire error chain.
</details>

---

## Bug 11 🔴 Condition Always True Due to Unsigned Integer

```go
package main

import "fmt"

func processItems(count uint) {
    items := make([]string, count)

    for i := uint(0); i < count; i++ {
        items[i] = fmt.Sprintf("item-%d", i)
    }

    // Remove last N items
    removeCount := uint(5)
    if count-removeCount > 0 { // BUG: always true when count < removeCount!
        items = items[:count-removeCount]
        fmt.Printf("Kept %d items\n", len(items))
    } else {
        fmt.Println("Removing all items")
        items = items[:0]
    }
}

func main() {
    processItems(3) // count=3, removeCount=5 → should remove all
}
```

<details>
<summary>Hint</summary>
What happens when you subtract from an unsigned integer when the result would be negative?
</details>

<details>
<summary>Solution</summary>

**Bug:** `count-removeCount` with `count=3` and `removeCount=5` causes **unsigned integer underflow**. Unsigned integers wrap around: `uint(3) - uint(5) = uint(^uint(0) - 1)` (a very large number). So `count-removeCount > 0` is always true when underflow occurs.

```
uint(3) - uint(5) = 0xFFFFFFFFFFFFFFFE (not -2!)
0xFFFFFFFFFFFFFFFE > 0 → true → always takes the wrong branch
```

**Fix:**
```go
if count > removeCount { // check before subtracting
    items = items[:count-removeCount]
    fmt.Printf("Kept %d items\n", len(items))
} else {
    fmt.Println("Removing all items")
    items = items[:0]
}
```

**Or use signed integers:**
```go
func processItems(count int) {
    removeCount := 5
    remaining := count - removeCount
    if remaining > 0 {
        items = items[:remaining]
    } else {
        items = items[:0]
    }
}
```

**Key Lesson:** Never subtract unsigned integers when the result could be negative — you get silent underflow. Always check `a > b` before computing `uint(a) - uint(b)`. Prefer signed integers unless you have a specific reason for unsigned.
</details>

---

## Bug 12 🔴 Panic Instead of Error in Library Function

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Parser struct {
    data map[string]interface{}
}

func (p *Parser) Parse(jsonStr string) {
    // If unmarshaling fails, the entire program panics
    if err := json.Unmarshal([]byte(jsonStr), &p.data); err != nil {
        panic(fmt.Sprintf("invalid JSON: %v", err))
    }
}

func (p *Parser) GetString(key string) string {
    val, ok := p.data[key]
    if !ok {
        panic(fmt.Sprintf("key not found: %s", key))
    }
    return val.(string) // also panics if not string!
}

func main() {
    p := &Parser{}
    p.Parse(`{"name":"Alice","age":30}`)

    name := p.GetString("name")
    fmt.Println("Name:", name)

    // This will panic — should return error instead
    p.Parse("not valid json")
}
```

<details>
<summary>Hint</summary>
When is it appropriate to use `panic` vs returning an error? Library code should handle invalid input gracefully.
</details>

<details>
<summary>Solution</summary>

**Bug:** Library functions should return errors, not panic. Panics propagate up the call stack and crash the program unless explicitly recovered. This makes the library unusable in a server context (where panics must be recovered in a middleware, losing context).

**Fix:**
```go
type Parser struct {
    data map[string]interface{}
}

func (p *Parser) Parse(jsonStr string) error {
    if err := json.Unmarshal([]byte(jsonStr), &p.data); err != nil {
        return fmt.Errorf("parse JSON: %w", err)
    }
    return nil
}

func (p *Parser) GetString(key string) (string, error) {
    val, ok := p.data[key]
    if !ok {
        return "", fmt.Errorf("key %q not found", key)
    }
    str, ok := val.(string)
    if !ok {
        return "", fmt.Errorf("key %q is not a string (got %T)", key, val)
    }
    return str, nil
}

func main() {
    p := &Parser{}

    if err := p.Parse(`{"name":"Alice","age":30}`); err != nil {
        fmt.Println("Error:", err)
        return
    }

    if name, err := p.GetString("name"); err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Println("Name:", name)
    }

    // Graceful error handling:
    if err := p.Parse("not valid json"); err != nil {
        fmt.Println("Parse error:", err) // handled, program continues
    }
}
```

**Key Lesson:** Library functions should return errors, not panic. Reserve `panic` for programming errors (invariant violations, impossible states) — not for bad input. Use `if err != nil { return err }` pattern consistently.
</details>

---

## Bug 13 🔴 Lost Error from Deferred Function

```go
package main

import (
    "fmt"
    "os"
)

func writeToFile(filename, content string) error {
    f, err := os.Create(filename)
    if err != nil {
        return fmt.Errorf("create file: %w", err)
    }
    defer f.Close() // BUG: ignores Close error!

    if _, err := f.Write([]byte(content)); err != nil {
        return fmt.Errorf("write: %w", err)
    }

    return nil // caller thinks everything succeeded, but Close may have failed!
}

func main() {
    if err := writeToFile("/tmp/test.txt", "hello"); err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Println("Success")
    }
}
```

<details>
<summary>Hint</summary>
`f.Close()` can return an error (e.g., if the write buffer couldn't be flushed). How do you capture a deferred function's error return?
</details>

<details>
<summary>Solution</summary>

**Bug:** `defer f.Close()` discards the error returned by `Close()`. For file writes, `Close()` can fail if the OS couldn't flush the write buffer to disk. The caller sees `nil` (success) but the data may not be persisted.

**Fix — named return value captures defer error:**
```go
func writeToFile(filename, content string) (err error) {
    f, err := os.Create(filename)
    if err != nil {
        return fmt.Errorf("create file: %w", err)
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = fmt.Errorf("close file: %w", cerr)
        }
    }()

    if _, err = f.Write([]byte(content)); err != nil {
        return fmt.Errorf("write: %w", err)
    }
    return nil
}
```

The named return `err` allows the deferred function to update the return value. If write succeeded (`err == nil`) but Close fails (`cerr != nil`), the Close error is returned.

**Key Lesson:** For file writes, always capture and check the `Close()` error. A `defer f.Close()` without error handling is a silent data loss bug. Use named return values + defer to properly propagate close errors.
</details>
