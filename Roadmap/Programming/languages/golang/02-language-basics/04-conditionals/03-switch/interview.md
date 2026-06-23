# switch Statement — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is the main difference between Go's `switch` and C's `switch`?**

**Answer:** The biggest difference is that Go's `switch` cases do **not fall through automatically**. In C, every case "falls through" to the next unless you add `break`. In Go, each case automatically breaks — you use `fallthrough` only when you explicitly want to continue to the next case.

```go
// Go switch — NO automatic fallthrough
x := 2
switch x {
case 1:
    fmt.Println("one")
case 2:
    fmt.Println("two")   // only "two" prints
case 3:
    fmt.Println("three") // NOT printed
}

// C equivalent would need break in each case:
// switch (x) {
//     case 1: printf("one"); break;
//     case 2: printf("two"); break;
//     ...
// }

// Go fallthrough (explicit):
switch x {
case 1:
    fmt.Println("one")
    fallthrough
case 2:
    fmt.Println("two")  // prints for x==1 AND x==2
}
```

---

**Q2: What is an expressionless switch in Go? When is it useful?**

**Answer:** An expressionless switch has no expression after the `switch` keyword. Each case contains a boolean expression. It is essentially a cleaner alternative to an `if-else if` chain.

```go
// Expressionless switch — like if-else but cleaner
x := 42
switch {
case x < 0:
    fmt.Println("negative")
case x == 0:
    fmt.Println("zero")
case x < 100:
    fmt.Println("small positive")
default:
    fmt.Println("large positive")
}

// Equivalent if-else:
if x < 0 {
    fmt.Println("negative")
} else if x == 0 {
    fmt.Println("zero")
} else if x < 100 {
    fmt.Println("small positive")
} else {
    fmt.Println("large positive")
}

// When useful:
// 1. Multiple unrelated conditions (not matching one variable)
// 2. Conditions involving different variables
// 3. Ranges and inequalities (not equality matching)
```

---

**Q3: What is a type switch? Give a practical example.**

**Answer:** A type switch performs different actions based on the dynamic type of an interface value. It uses the syntax `switch v := i.(type)`.

```go
package main

import "fmt"

func describe(i interface{}) {
    switch v := i.(type) {
    case int:
        fmt.Printf("Integer: %d (doubled: %d)\n", v, v*2)
    case string:
        fmt.Printf("String: %q (length: %d)\n", v, len(v))
    case bool:
        fmt.Printf("Bool: %t\n", v)
    case []int:
        fmt.Printf("Int slice with %d elements\n", len(v))
    case nil:
        fmt.Println("nil value")
    default:
        fmt.Printf("Unknown type: %T\n", v)
    }
}

func main() {
    describe(42)
    describe("hello")
    describe(true)
    describe([]int{1, 2, 3})
    describe(nil)
    describe(3.14)
}
```

**Output:**
```
Integer: 42 (doubled: 84)
String: "hello" (length: 5)
Bool: true
Int slice with 3 elements
nil value
Unknown type: float64
```

---

**Q4: Can you have multiple values in one switch case? How?**

**Answer:** Yes. You can list multiple values separated by commas in a single `case`. The case matches if the switch tag equals **any** of the listed values.

```go
func classifyDay(day string) string {
    switch day {
    case "Monday", "Tuesday", "Wednesday", "Thursday", "Friday":
        return "Weekday"
    case "Saturday", "Sunday":
        return "Weekend"
    default:
        return "Unknown"
    }
}

func main() {
    fmt.Println(classifyDay("Monday"))   // Weekday
    fmt.Println(classifyDay("Saturday")) // Weekend
    fmt.Println(classifyDay("Holiday"))  // Unknown
}

// Also works with integers:
func isVowelPosition(n int) bool {
    switch n {
    case 1, 5, 9, 15, 21:  // positions of a, e, i, o, u in alphabet
        return true
    default:
        return false
    }
}
```

---

**Q5: What is the `default` case, and when should you use it?**

**Answer:** The `default` case executes when no other case matches. It is optional — if omitted and no case matches, the switch does nothing.

```go
func getStatusText(code int) string {
    switch code {
    case 200:
        return "OK"
    case 404:
        return "Not Found"
    case 500:
        return "Internal Server Error"
    default:
        return fmt.Sprintf("HTTP %d", code)  // handles all unknown codes
    }
}
```

**When to use `default`:**
1. When you want to handle unexpected/unknown values
2. When the switch is over an enum to catch future values
3. When you want to log or error on unhandled cases

**When to omit `default`:**
1. When "no match → do nothing" is the correct behavior
2. For boolean switches where you only care about `true`

---

**Q6: What does `fallthrough` do? Can you use it in a type switch?**

**Answer:** `fallthrough` causes execution to continue into the next case's body, bypassing that case's condition. It can only appear as the last statement in a case body. It CANNOT be used in a type switch.

```go
// fallthrough in expression switch
n := 1
switch n {
case 1:
    fmt.Println("one")
    fallthrough        // continues to case 2's body
case 2:
    fmt.Println("two") // prints for n==1 AND n==2
case 3:
    fmt.Println("three") // only prints for n==3
}
// For n=1 output: "one" then "two"

// fallthrough is NOT allowed in type switch:
var i interface{} = 42
switch i.(type) {
case int:
    fmt.Println("int")
    // fallthrough  // COMPILE ERROR: cannot fallthrough in type switch
case float64:
    fmt.Println("float64")
}
```

---

## Middle Level Questions

**Q7: When should you prefer `switch` over `if-else if` chains?**

**Answer:** Use `switch` when:
1. Matching multiple values of the **same variable** (3+ conditions)
2. Matching on type (type switch)
3. You want the "first match wins" semantics to be visually clear
4. Using `default` to catch unhandled cases

Use `if-else if` when:
1. Each condition involves **different variables or expressions**
2. Complex compound conditions: `if a > 0 && b < 10`
3. Only 1-2 branches

```go
// PREFER switch: matching one variable
switch status {
case "active":    activateUser()
case "suspended": suspendUser()
case "deleted":   deleteUser()
default:          log.Error("unknown status", status)
}

// PREFER if-else: different conditions
if user.Age >= 18 && user.HasID {
    allowEntry()
} else if user.IsVIP {
    allowVIPEntry()
} else {
    denyEntry()
}
```

---

**Q8: Explain the init statement in a switch. What is its scope?**

**Answer:** Like `if`, a `switch` can have an optional initialization statement before the switched expression, separated by a semicolon. The variable declared there is scoped to the switch block.

```go
// Init statement: x is scoped to the switch
switch x := getUserStatus(); x {
case "admin":
    grantAdminAccess()
case "user":
    grantUserAccess()
default:
    denyAccess()
}
// x is NOT accessible here

// Practical use: scoped temporary variable
switch err := validateInput(data); {
case err == nil:
    process(data)
case errors.Is(err, ErrTooLong):
    truncate(data)
default:
    return fmt.Errorf("invalid input: %w", err)
}
```

---

**Q9: How does Go handle a switch on a floating-point value? Are there any concerns?**

**Answer:** Go allows switching on floating-point values, but it uses exact equality comparison — which is problematic for computed floats due to floating-point precision.

```go
// Works for exact values
switch f {
case 0.0:
    fmt.Println("zero")
case 1.0:
    fmt.Println("one")
default:
    fmt.Println("other")
}

// DANGEROUS: computed floats may not equal exactly
result := 0.1 + 0.2
switch result {
case 0.3:                   // FALSE — 0.1 + 0.2 != 0.3 due to float precision
    fmt.Println("0.3")
default:
    fmt.Println("not 0.3")  // this prints
}

// Better approach for computed floats:
switch {
case math.Abs(result-0.3) < 1e-10:
    fmt.Println("approximately 0.3")
}
```

---

**Q10: How do you break out of an outer loop from inside a switch inside the loop?**

**Answer:** Use a labeled `break`. A regular `break` inside a switch only exits the switch, not any enclosing loop.

```go
// Regular break: exits switch only, loop continues
for i := 0; i < 10; i++ {
    switch i {
    case 5:
        break         // exits switch, NOT the for loop
    }
    fmt.Println(i)    // prints 0,1,2,3,4,5,6,7,8,9
}

// Labeled break: exits the labeled loop
loop:
for i := 0; i < 10; i++ {
    switch i {
    case 5:
        break loop    // exits the for loop
    }
    fmt.Println(i)    // prints 0,1,2,3,4
}
fmt.Println("after loop")
```

This is one of the key distinctions between `break` in a switch vs `break` in a for loop.

---

**Q11: What is the difference between switching on a value and switching on a type? When does each apply?**

**Answer:**

```go
// Expression switch: dispatch on value
func handleCode(code int) {
    switch code {
    case 200: handleOK()
    case 404: handleNotFound()
    case 500: handleError()
    }
}
// Use when: you have a concrete type and want to match specific values

// Type switch: dispatch on dynamic type of interface
func handleValue(v interface{}) {
    switch t := v.(type) {
    case int:    fmt.Println("int:", t)
    case string: fmt.Println("string:", t)
    case error:  fmt.Println("error:", t.Error())
    }
}
// Use when: you receive an interface and need different behavior per concrete type
```

Common use cases for type switch:
- JSON unmarshaling: handling `interface{}` decoded values
- Protocol buffers: handling `oneof` fields
- Plugin systems: handling different handler types
- AST traversal: handling different node types

---

## Senior Level Questions

**Q12: Describe how the Go compiler chooses between jump table, binary search, and linear scan for a switch statement.**

**Answer:** The compiler analyzes the case values:

1. **Linear scan** (≤4 cases OR strings): Generates sequential comparisons. Fastest for very few cases due to no overhead.

2. **Binary search** (≥5 cases, sparse values): Sorts case values, generates a binary search. O(log n) comparisons.

3. **Jump table** (≥5 cases, dense values): When `(maxValue - minValue + 1) / numCases ≤ ~2.0`, generates an array of jump addresses. O(1) dispatch.

```go
// Jump table: values 0-6 (7 cases, density 1.0)
switch day { // 0-6 → jump table
case 0: ...
case 1: ...
case 2: ...
case 3: ...
case 4: ...
case 5: ...
case 6: ...
}

// Binary search: sparse values
switch code { // 200, 301, 400, 404, 500 → binary search
case 200: ...
case 301: ...
case 400: ...
case 404: ...
case 500: ...
}

// Verify with: go build -gcflags="-S" | grep -A 50 "LEAQ"
```

---

**Q13: How does the `exhaustive` linter improve switch statement safety?**

**Answer:** The `exhaustive` linter checks that switch statements over enumerated types handle all values. Without it, adding a new enum value is silent — the switch just has no case for it and falls to `default` (or does nothing if there's no `default`).

```go
//go:generate stringer -type=OrderStatus
type OrderStatus int

const (
    OrderPending  OrderStatus = iota
    OrderShipped
    OrderDelivered
    OrderCancelled
)

// Without exhaustive linter: compiles fine, but misses OrderCancelled
func processOrder(status OrderStatus) error {
    switch status {
    case OrderPending:
        return initiate()
    case OrderShipped:
        return trackShipment()
    case OrderDelivered:
        return markDelivered()
    // OrderCancelled missing — no compile error, no warning
    }
    return nil  // silently does nothing for OrderCancelled
}

// With exhaustive linter:
// error: missing cases in switch of type OrderStatus: OrderCancelled
// Forces the developer to explicitly handle or acknowledge the missing case
```

Configuration:
```yaml
# .golangci.yml
linters:
  enable:
    - exhaustive
linters-settings:
  exhaustive:
    default-signifies-exhaustive: false  # default: doesn't count as handling all cases
```

---

**Q14: Explain a real production scenario where improper switch design caused a bug.**

**Answer:** A common production bug is adding a new enum value without updating all switches that use it.

**Scenario:** A payment system had `PaymentState` with `Pending`, `Completed`, `Failed`. All switches handled these three. Later, `Refunding` was added. One switch in the notification service was not updated:

```go
func sendNotification(p *Payment) {
    switch p.State {
    case Pending:   sendPendingEmail(p)
    case Completed: sendSuccessEmail(p)
    case Failed:    sendFailureEmail(p)
    // Refunding: no case, no default — silently does nothing
    }
}
```

Customers in refunding state never received notifications. The bug was discovered weeks later through customer complaints, not monitoring.

**Fix:** Always add `default: log.Error("unhandled state", "state", p.State)` or use the `exhaustive` linter.

---

**Q15: What is the performance comparison between a large switch and a map dispatch? When should you prefer each?**

**Answer:**

```go
// Benchmark setup (20 cases)
var handlers = map[string]Handler{
    "cmd1": handler1, ..., "cmd20": handler20,
}

func dispatchSwitch(cmd string) Handler {
    switch cmd {
    case "cmd1": return handler1
    // ... 20 cases
    }
    return nil
}

func dispatchMap(cmd string) Handler {
    return handlers[cmd]
}

// Benchmark results (20 string cases):
// dispatchSwitch: ~8 ns/op  (binary search + string comparisons)
// dispatchMap:    ~10 ns/op (hash + map lookup)
// — Switch is slightly faster for 20 cases

// For 100 string cases:
// dispatchSwitch: ~15 ns/op (deeper binary search)
// dispatchMap:    ~10 ns/op (O(1) hash, constant regardless of N)
// — Map wins
```

**When to prefer switch:**
- ≤20 cases, known at compile time
- Performance-critical code (avoids map overhead)
- Static dispatch (no runtime extension needed)

**When to prefer map:**
- 50+ cases
- Need to add/remove cases at runtime
- Cases are plugins or user-configurable

---

## Scenario-Based Questions

**Scenario 1:** Review this code. What are the issues?

```go
type Color int
const (
    Red Color = iota
    Green
    Blue
)

func colorName(c Color) string {
    switch c {
    case Red:
        return "red"
    case Green:
        return "green"
    }
    return ""
}
```

**Answer:** Missing `Blue` case and no `default`. The function silently returns `""` for Blue and any future Color values. Fix:

```go
func colorName(c Color) string {
    switch c {
    case Red:   return "red"
    case Green: return "green"
    case Blue:  return "blue"
    default:
        panic(fmt.Sprintf("unknown color: %d", c))
        // or: return fmt.Sprintf("color(%d)", c)
    }
}
```

---

**Scenario 2:** This code has an unexpected behavior. Explain what happens and fix it.

```go
for i := 0; i < 5; i++ {
    switch i {
    case 3:
        fmt.Println("found 3, stopping")
        break  // intention: stop the loop
    default:
        fmt.Println(i)
    }
}
```

**Answer:** `break` inside a switch exits the switch, NOT the for loop. The loop continues. Output is `0 1 2 found 3, stopping 4`. Fix with labeled break:

```go
loop:
for i := 0; i < 5; i++ {
    switch i {
    case 3:
        fmt.Println("found 3, stopping")
        break loop  // exits the for loop
    default:
        fmt.Println(i)
    }
}
// Output: 0 1 2 found 3, stopping
```

---

**Scenario 3:** Design a type-safe command dispatcher that handles 10 different command types using switch.

```go
type Command interface{ isCommand() }

type CreateUserCmd  struct{ Name, Email string }
type DeleteUserCmd  struct{ UserID int }
type UpdateEmailCmd struct{ UserID int; NewEmail string }

func (CreateUserCmd) isCommand()  {}
func (DeleteUserCmd) isCommand()  {}
func (UpdateEmailCmd) isCommand() {}

type CommandResult struct{ Success bool; Message string }

func dispatch(cmd Command) CommandResult {
    switch c := cmd.(type) {
    case CreateUserCmd:
        if err := createUser(c.Name, c.Email); err != nil {
            return CommandResult{false, err.Error()}
        }
        return CommandResult{true, "user created: " + c.Name}

    case DeleteUserCmd:
        if err := deleteUser(c.UserID); err != nil {
            return CommandResult{false, err.Error()}
        }
        return CommandResult{true, fmt.Sprintf("user %d deleted", c.UserID)}

    case UpdateEmailCmd:
        if err := updateEmail(c.UserID, c.NewEmail); err != nil {
            return CommandResult{false, err.Error()}
        }
        return CommandResult{true, "email updated"}

    default:
        return CommandResult{false, fmt.Sprintf("unknown command type: %T", c)}
    }
}
```

---

## FAQ

**Q: Can I use `switch` without any cases?**

A: Yes — `switch {}` with no cases compiles but does nothing. It's a no-op. More practically, you might write `switch { }` as a placeholder.

**Q: Can switch cases overlap in value?**

A: No — duplicate case values are a compile error (caught by `go vet`). Each case must have unique values.

**Q: Is the order of cases in a switch significant?**

A: For correctness with an expression switch, order doesn't matter (each value is unique). For expressionless switch, order IS significant — the first matching condition wins (like if-else if). For performance, the compiler may reorder cases for optimization (e.g., jump table).

**Q: Can I `return` from inside a switch case?**

A: Yes. `return` exits the enclosing function. `break` exits only the switch. `continue` (inside a for loop) continues the loop.

**Q: Does `switch` on a string compare case-sensitively?**

A: Yes. `switch s { case "hello": }` is case-sensitive. "Hello" != "hello". For case-insensitive matching, normalize first: `switch strings.ToLower(s)`.
