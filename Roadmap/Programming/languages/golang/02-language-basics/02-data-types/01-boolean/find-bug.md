# Boolean — Find the Bug

## Overview
10+ bugs at varying difficulty levels. Each bug includes: description, buggy code, expected vs actual output, hint, and fix with explanation.

---

## Bug 1 — Wrong Side of Short-Circuit 🟢

**Description:** A nil pointer dereference panic occurs because the nil check is on the wrong side of `&&`.

**Buggy Code:**
```go
package main

import "fmt"

type User struct {
    Age int
}

func main() {
    var u *User // nil pointer

    // This code panics
    if u.Age > 18 && u != nil {
        fmt.Println("Adult user")
    }
}
```

**Expected:** No panic, just skips the block
**Actual:** `panic: runtime error: invalid memory address or nil pointer dereference`

<details>
<summary>Hint</summary>
Short-circuit evaluation goes left to right. If the left side panics, the right side never gets a chance to prevent it.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
// Fix: nil check FIRST
if u != nil && u.Age > 18 {
    fmt.Println("Adult user")
}
```

**Explanation:** `&&` evaluates left to right. When Go evaluates `u.Age > 18`, `u` is nil, causing a panic. The nil check on the right is never reached. Always put cheaper/safety checks (like nil checks) on the LEFT side of `&&`.
</details>

---

## Bug 2 — Comparing Bool to `true` (Logic Error) 🟢

**Description:** The condition accidentally inverts the logic due to a misunderstanding of how boolean comparison works.

**Buggy Code:**
```go
package main

import "fmt"

func isUserActive(id int) bool {
    activeUsers := map[int]bool{1: true, 2: true, 3: false}
    return activeUsers[id]
}

func main() {
    // Should print users that are NOT active
    for i := 1; i <= 3; i++ {
        if isUserActive(i) == false {
            fmt.Printf("Inactive user: %d\n", i)
        }
    }

    // Bug: what about user 4? (not in map)
    fmt.Printf("User 4 active: %v\n", isUserActive(4) == true)
    // Expected: false (not in map = not active)
    // Actual: false — but this masks a logic issue below

    // The real bug: this condition is always wrong
    users := []int{1, 2, 3, 4, 5}
    activeCount := 0
    for _, id := range users {
        if isUserActive(id) == true == true { // BUG: double == true
            activeCount++
        }
    }
    fmt.Println("Active count:", activeCount) // Expected: 2, Actual: 2 (but fragile code)
}
```

**Expected:** Clean, readable code without redundant comparisons
**Actual:** Code works but is fragile and hard to read

<details>
<summary>Hint</summary>
`bool == true` is always equal to `bool`. `bool == false` is equal to `!bool`. Double comparisons like `== true == true` are confusing.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
// Fix: use bool directly
for _, id := range users {
    if isUserActive(id) {  // NOT: if isUserActive(id) == true
        activeCount++
    }
}

// For inactive check:
if !isUserActive(id) {  // NOT: if isUserActive(id) == false
    fmt.Printf("Inactive user: %d\n", id)
}
```

**Explanation:** Since `isUserActive(id)` already returns `bool`, comparing it to `true` or `false` is redundant. `if isUserActive(id)` is idiomatic Go. `if isUserActive(id) == true == true` is `if (isUserActive(id) == true) == true` = `if isUserActive(id)` — it happens to work but is confusing and violates Go idioms.
</details>

---

## Bug 3 — Integer Used as Bool (Won't Compile) 🟢

**Description:** Developer coming from C tries to use integer values as booleans.

**Buggy Code:**
```go
package main

import "fmt"

func getStatus() int {
    return 1 // 1 means active
}

func main() {
    status := getStatus()

    // BUG: This doesn't compile in Go
    if status {
        fmt.Println("Active")
    }

    count := 5
    // BUG: This doesn't compile either
    for count {
        fmt.Println("running")
        count--
    }
}
```

**Expected:** Code that compiles and runs
**Actual:** Compile errors: `non-bool status used as if condition`

<details>
<summary>Hint</summary>
Go requires explicit boolean expressions in `if` and `for` conditions. Convert integers to booleans explicitly.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
if status != 0 {
    fmt.Println("Active")
}

count := 5
for count > 0 {
    fmt.Println("running")
    count--
}
```

**Explanation:** Unlike C, Go does not implicitly convert integers to booleans. You must provide an explicit comparison. This prevents the classic C bug `if (x = 0)` (assignment instead of comparison) which compiles silently in C.
</details>

---

## Bug 4 — Wrong Operator Precedence 🟡

**Description:** Developer assumes `||` has higher precedence than `&&`, leading to incorrect logic.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    isAdmin := false
    isOwner := true
    isActive := true

    // Intended: (isAdmin || isOwner) && isActive
    // Actual evaluation: isAdmin || (isOwner && isActive)
    if isAdmin || isOwner && isActive {
        fmt.Println("Access granted")
    } else {
        fmt.Println("Access denied")
    }

    // Test case that reveals the bug:
    isAdmin2 := false
    isOwner2 := false
    isActive2 := true

    // With intended logic: (false || false) && true = false
    // With actual logic:   false || (false && true) = false
    // Both give same result here — but what about:

    isAdmin3 := false
    isOwner3 := true
    isActive3 := false

    // Intended: (false || true) && false = false (owner but inactive)
    // Actual:   false || (true && false)  = false (same result — hidden bug!)

    // This case REVEALS the bug:
    isAdmin4 := true
    isOwner4 := false
    isActive4 := false

    // Intended: (true || false) && false = FALSE (admin but inactive)
    // Actual:   true || (false && false) = TRUE  (BUG: inactive admin gets access!)
    if isAdmin4 || isOwner4 && isActive4 {
        fmt.Println("Bug: inactive admin got access!")
    }

    _ = isAdmin2
    _ = isOwner2
    _ = isActive2
    _ = isAdmin3
    _ = isOwner3
    _ = isActive3
}
```

**Expected:** Inactive admin should be denied access
**Actual:** Inactive admin is granted access (because `||` has lower precedence than `&&`)

<details>
<summary>Hint</summary>
In Go (and most languages), `&&` binds more tightly than `||`. So `a || b && c` is `a || (b && c)`, NOT `(a || b) && c`.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
// Fix: explicit parentheses
if (isAdmin4 || isOwner4) && isActive4 {
    fmt.Println("Access granted only to active admin/owner")
} else {
    fmt.Println("Access denied") // correct
}
```

**Explanation:** `&&` has higher precedence than `||`. `isAdmin || isOwner && isActive` parses as `isAdmin || (isOwner && isActive)`. Use explicit parentheses whenever mixing `&&` and `||` to make intent clear and avoid bugs.
</details>

---

## Bug 5 — Data Race on Bool 🟡

**Description:** A boolean flag is read and written from multiple goroutines without synchronization.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "time"
)

var isReady bool // SHARED: data race!

func producer() {
    time.Sleep(100 * time.Millisecond)
    isReady = true // WRITE: no synchronization
}

func consumer() {
    for !isReady { // READ: no synchronization
        time.Sleep(10 * time.Millisecond)
    }
    fmt.Println("Ready!")
}

func main() {
    go producer()
    consumer()
}
```

**Expected:** Prints "Ready!" after ~100ms, no race condition
**Actual:** May work but `go test -race` reports DATA RACE; compiler may cache `isReady` in register, causing infinite loop

<details>
<summary>Hint</summary>
Boolean variables shared across goroutines require synchronization. Use `sync/atomic`, `sync.Mutex`, or channels.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

var isReady int32 // 0 = not ready, 1 = ready

func producer() {
    time.Sleep(100 * time.Millisecond)
    atomic.StoreInt32(&isReady, 1) // atomic write
}

func consumer() {
    for atomic.LoadInt32(&isReady) == 0 { // atomic read
        time.Sleep(10 * time.Millisecond)
    }
    fmt.Println("Ready!")
}

func main() {
    go producer()
    consumer()
}

// Alternative: use a channel
// done := make(chan struct{})
// go func() { time.Sleep(100*time.Millisecond); close(done) }()
// <-done
// fmt.Println("Ready!")
```

**Explanation:** Concurrent access to a `bool` without synchronization is a data race. The Go memory model does not guarantee that a write in one goroutine is visible to another without proper synchronization. `sync/atomic` provides atomic load/store operations. Alternatively, channels are idiomatic Go for goroutine communication.
</details>

---

## Bug 6 — Double Negation Logic Error 🟡

**Description:** Double negation makes the logic accidentally correct but unreadable, and a future edit breaks it.

**Buggy Code:**
```go
package main

import "fmt"

type User struct {
    Name      string
    IsBlocked bool
    IsBanned  bool
}

func canSendMessage(user User) bool {
    // BUG: double negative — confusing and error-prone
    isNotBlocked := !user.IsBlocked
    isNotBanned := !user.IsBanned
    return !(!isNotBlocked || !isNotBanned)
}

func main() {
    alice := User{Name: "Alice", IsBlocked: false, IsBanned: false}
    bob := User{Name: "Bob", IsBlocked: true, IsBanned: false}
    charlie := User{Name: "Charlie", IsBlocked: false, IsBanned: true}

    fmt.Println(alice.Name, "can send:", canSendMessage(alice))   // true
    fmt.Println(bob.Name, "can send:", canSendMessage(bob))       // false
    fmt.Println(charlie.Name, "can send:", canSendMessage(charlie)) // false
}
```

**Expected:** Correct logic but readable code
**Actual:** Logic is (accidentally) correct but `!(!isNotBlocked || !isNotBanned)` is a maintenance nightmare

<details>
<summary>Hint</summary>
Apply De Morgan's law: `!(!A || !B)` = `A && B`. Simplify the double negatives.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
func canSendMessage(user User) bool {
    return !user.IsBlocked && !user.IsBanned
}
```

**Explanation:**
- `isNotBlocked = !user.IsBlocked`
- `isNotBanned = !user.IsBanned`
- `!(!isNotBlocked || !isNotBanned)` = by De Morgan's: `isNotBlocked && isNotBanned` = `!user.IsBlocked && !user.IsBanned`

The simplified version is direct and readable. Double negations in variable names (`isNot...`) and double negation operators compound the confusion. Always simplify using De Morgan's laws.
</details>

---

## Bug 7 — Zero Value Bool Confusion in Config 🟡

**Description:** A config struct uses a boolean that has the "wrong" zero value for the intended behavior.

**Buggy Code:**
```go
package main

import "fmt"

type ServerConfig struct {
    Host     string
    Port     int
    DisableTLS bool // zero value = false = TLS is NOT disabled = TLS enabled
}

func NewDefaultConfig() ServerConfig {
    return ServerConfig{
        Host: "localhost",
        Port: 8080,
        // DisableTLS not set — zero value = false
        // This means TLS is ENABLED by default — intended? Maybe.
    }
}

func startServer(cfg ServerConfig) {
    if cfg.DisableTLS {
        fmt.Println("Starting HTTP server (TLS disabled)")
    } else {
        fmt.Println("Starting HTTPS server (TLS enabled)")
    }
}

// The BUG: developer adds a new config and forgets to set it
func main() {
    // Scenario 1: production (wants TLS enabled)
    prodConfig := NewDefaultConfig()
    startServer(prodConfig) // Correct: HTTPS

    // Scenario 2: developer forgets to explicitly disable TLS in test
    testConfig := ServerConfig{Host: "localhost", Port: 9090}
    startServer(testConfig) // BUG: TLS enabled in test (developer expected HTTP!)
    // Developer intended: DisableAuth: true — but forgot to set it

    // Scenario 3: field renamed by someone else
    // DisableTLS renamed to EnableTLS without updating all callers
    // Now all callers that didn't set it have EnableTLS=false (disabled!)
    // This is the "zero value trap" with negative-named booleans
}
```

**Expected:** Clear, predictable behavior with zero values
**Actual:** Confusing: `DisableTLS = false` means TLS is enabled — the field name implies "disable" but the value `false` means "don't disable" = enabled. Cognitive overhead.

<details>
<summary>Hint</summary>
Name your boolean fields so that the zero value (`false`) means "safe default" or "natural off state." `DisableTLS = false` is confusing; `EnableTLS = false` is clearer (though TLS disabled by default might not be safe).
</details>

<details>
<summary>Fix & Explanation</summary>

```go
type ServerConfig struct {
    Host      string
    Port      int
    EnableTLS bool // zero value = false = TLS disabled (explicit, clear)
}

func startServer(cfg ServerConfig) {
    if cfg.EnableTLS {
        fmt.Println("Starting HTTPS server (TLS enabled)")
    } else {
        fmt.Println("Starting HTTP server (TLS disabled)")
    }
}
```

**Explanation:** Use positive boolean names (`Enable`, `Is`, `Has`) so that `false` means "off/disabled" — this matches the zero value. Negative names like `Disable`, `Skip`, `No` make `false` mean "don't disable" = enabled, which is counterintuitive. The rule: **the zero value should be the safe/off/disabled state.**

For production safety, you might also want TLS enabled by default — in that case use `InsecureDisableTLS bool` to make it clear that the non-zero value is the dangerous/non-default option.
</details>

---

## Bug 8 — Short-Circuit Side Effect Bug 🔴

**Description:** A function with a side effect is being skipped due to short-circuit evaluation, causing a counter to be wrong.

**Buggy Code:**
```go
package main

import "fmt"

var processedCount int

func validateAndCount(item string) bool {
    processedCount++ // side effect: increment counter
    return len(item) > 0
}

func processItems(items []string) int {
    // BUG: short-circuit means validateAndCount may not be called for all items
    for _, item := range items {
        if false && validateAndCount(item) { // always false — validateAndCount NEVER called
            fmt.Println("Processing:", item)
        }
    }
    return processedCount
}

func main() {
    items := []string{"apple", "banana", "cherry"}
    count := processItems(items)
    fmt.Printf("Processed %d items (expected 3)\n", count) // 0, not 3!
}
```

**Expected:** All 3 items validated and counted
**Actual:** 0 items processed (short-circuit prevents validateAndCount from being called)

<details>
<summary>Hint</summary>
When a function has side effects (like incrementing a counter), never place it where short-circuit evaluation might skip it. Call it unconditionally, then use the result in the condition.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
func processItems(items []string) int {
    for _, item := range items {
        isValid := validateAndCount(item) // Always called, side effect happens
        if isValid {
            fmt.Println("Processing:", item)
        }
    }
    return processedCount
}
```

**Explanation:** If `validateAndCount` must always run (because it has the side effect of incrementing the counter), it must not be placed inside a short-circuit expression. Call it first, store the result, then use the result in the condition. **Never rely on a side-effectful function being called when it's in a short-circuit expression.**
</details>

---

## Bug 9 — Bitwise AND on Bool (Wrong Operator) 🔴

**Description:** Developer uses `&` (bitwise AND) instead of `&&` (logical AND), losing short-circuit evaluation.

**Buggy Code:**
```go
package main

import (
    "fmt"
)

func riskyCheck(s string) bool {
    fmt.Printf("  checking: '%s'\n", s)
    if s == "panic" {
        panic("deliberate panic!")
    }
    return len(s) > 0
}

func main() {
    // Using & instead of && — no short-circuit, both sides always evaluated
    // This won't compile for bool — but developers sometimes make this mistake
    // conceptually, thinking & and && are interchangeable

    // Simulated scenario: using functions in conditions
    a := len("hello") > 0  // evaluates to true
    b := len("") > 0       // evaluates to false

    // BUG: using single & (bitwise) won't compile on bool:
    // result := a & b  // compile error

    // But in C, you could do: if (getUser() & validateUser())
    // In Go, the correct form is:
    result := a && b  // logical AND with short-circuit
    fmt.Println("Result:", result)

    // The real bug manifests when developers call functions:
    // if expensiveQuery() & validateResult()  -- this is WRONG in Go
    // It would try bitwise AND on bool, which doesn't compile

    // What they should write:
    if riskyCheck("hello") && riskyCheck("world") {
        fmt.Println("Both valid")
    }

    // This would panic without short-circuit if first returns false:
    fmt.Println("Testing short-circuit safety:")
    safeStr := ""
    if len(safeStr) > 0 && riskyCheck(safeStr) {
        fmt.Println("Won't reach here")
    }
    fmt.Println("No panic!")
}
```

**Expected:** Short-circuit prevents unnecessary calls; `&` on bool doesn't compile in Go
**Actual:** Using `&` on `bool` is a compile error; using `&&` correctly provides short-circuit safety

<details>
<summary>Hint</summary>
Go does NOT support bitwise `&` on `bool` types. Use `&&` for logical AND. The key difference: `&&` short-circuits, `&` (for integers) does not.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
// WRONG (compile error for bool):
// result := a & b

// CORRECT:
result := a && b  // logical AND, short-circuit

// For boolean operations, ALWAYS use:
// &&  (not &)
// ||  (not |)
// !   (not ~)
```

**Explanation:** In Go, `&`, `|`, `^` are **bitwise** operators for integers. For booleans, only `&&`, `||`, and `!` are valid. Using `&` on a `bool` is a compile-time error. Even if it compiled (as in C), `&` doesn't short-circuit — both sides would always be evaluated, which is unsafe when the right side has preconditions.
</details>

---

## Bug 10 — Boolean State Machine with Invalid States 🔴

**Description:** Multiple boolean fields allow impossible/invalid state combinations, leading to inconsistent behavior.

**Buggy Code:**
```go
package main

import "fmt"

type Order struct {
    ID          int
    IsPending   bool
    IsPaid      bool
    IsShipped   bool
    IsDelivered bool
    IsCancelled bool
}

func (o *Order) Pay() {
    o.IsPaid = true
    // BUG: forgot to set IsPending = false
}

func (o *Order) Ship() {
    o.IsShipped = true
    // BUG: didn't check if IsPaid first
    // BUG: didn't set IsPending = false
}

func (o *Order) Cancel() {
    o.IsCancelled = true
    // BUG: didn't set other flags to false
    // Now IsPaid=true AND IsCancelled=true — invalid state!
}

func (o Order) Status() string {
    if o.IsCancelled {
        return "cancelled"
    }
    if o.IsDelivered {
        return "delivered"
    }
    if o.IsShipped {
        return "shipped"
    }
    if o.IsPaid {
        return "paid"
    }
    return "pending"
}

func main() {
    order := Order{ID: 1, IsPending: true}

    order.Pay()
    order.Ship() // shipped without checking IsPaid!
    order.Cancel()

    fmt.Printf("Status: %s\n", order.Status())
    // Status: cancelled — but order.IsPaid=true AND order.IsShipped=true AND order.IsCancelled=true
    // This is an INVALID STATE

    fmt.Printf("Paid: %v, Shipped: %v, Cancelled: %v\n",
        order.IsPaid, order.IsShipped, order.IsCancelled)
    // Paid: true, Shipped: true, Cancelled: true — IMPOSSIBLE in real life
}
```

**Expected:** Valid state transitions only; invalid states prevented
**Actual:** Multiple booleans allow impossible combinations like "paid AND cancelled AND shipped"

<details>
<summary>Hint</summary>
Multiple boolean fields for mutually exclusive states always risk invalid combinations. Use a single state field with an enumeration.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
type OrderStatus int

const (
    StatusPending   OrderStatus = iota
    StatusPaid
    StatusShipped
    StatusDelivered
    StatusCancelled
)

func (s OrderStatus) String() string {
    return [...]string{"pending", "paid", "shipped", "delivered", "cancelled"}[s]
}

type Order struct {
    ID     int
    Status OrderStatus // SINGLE source of truth
}

func (o *Order) Pay() error {
    if o.Status != StatusPending {
        return fmt.Errorf("can only pay a pending order, current: %s", o.Status)
    }
    o.Status = StatusPaid
    return nil
}

func (o *Order) Ship() error {
    if o.Status != StatusPaid {
        return fmt.Errorf("can only ship a paid order, current: %s", o.Status)
    }
    o.Status = StatusShipped
    return nil
}

func (o *Order) Cancel() error {
    if o.Status == StatusDelivered {
        return fmt.Errorf("cannot cancel a delivered order")
    }
    o.Status = StatusCancelled
    return nil
}

func main() {
    order := Order{ID: 1, Status: StatusPending}
    order.Pay()
    order.Ship()
    fmt.Println("Status:", order.Status) // shipped

    order2 := Order{ID: 2, Status: StatusPending}
    err := order2.Ship() // Error: must be paid first
    fmt.Println("Ship error:", err)
}
```

**Explanation:** Multiple boolean fields representing mutually exclusive states create `2^n` possible combinations, most of which are invalid. Using a single `Status` field with an enum:
1. Prevents invalid states by construction
2. Makes state transitions explicit and validatable
3. Reduces the cognitive overhead of reading and modifying state
</details>

---

## Bug 11 — Nil Map Bool Panic 🔴

**Description:** A `map[string]bool` is not initialized before use, causing a panic on write.

**Buggy Code:**
```go
package main

import "fmt"

type AccessControl struct {
    Permissions map[string]bool // BUG: not initialized
}

func NewAccessControl() AccessControl {
    return AccessControl{} // BUG: map is nil!
}

func (ac *AccessControl) Grant(permission string) {
    ac.Permissions[permission] = true // PANIC: assignment to nil map
}

func (ac *AccessControl) Has(permission string) bool {
    return ac.Permissions[permission] // OK to read from nil map (returns false)
}

func main() {
    ac := NewAccessControl()

    // Reading from nil map is OK:
    fmt.Println(ac.Has("read")) // false (no panic)

    // Writing to nil map: PANIC
    ac.Grant("read") // panic: assignment to entry in nil map
}
```

**Expected:** No panic; permissions work correctly
**Actual:** `panic: assignment to entry in nil map`

<details>
<summary>Hint</summary>
In Go, reading from a nil map returns the zero value (false for bool). But writing to a nil map panics. Always initialize maps with `make` before writing.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
func NewAccessControl() AccessControl {
    return AccessControl{
        Permissions: make(map[string]bool), // Initialize!
    }
}
```

**Explanation:** A nil map in Go is readable (returns zero values) but not writable. `ac.Permissions[permission]` returns `false` safely even when the map is nil. But `ac.Permissions[permission] = true` panics because you can't write to a nil map. Always initialize maps in constructors or before first use. Also, use `_ = NewAccessControl()` style constructors to enforce initialization.
</details>
