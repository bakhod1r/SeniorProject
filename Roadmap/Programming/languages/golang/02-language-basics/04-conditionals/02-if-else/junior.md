# Go if-else — Junior Level

## Table of Contents
1. What is if-else?
2. Basic Syntax
3. The Condition Expression
4. Boolean Values in Go
5. Basic if Statement (no else)
6. if-else Statement
7. if-else if-else Chain
8. Nested if-else
9. The Init Statement
10. Variable Scope in Init Statement
11. Comparison Operators
12. Logical Operators
13. Short-Circuit Evaluation
14. String Comparisons
15. Numeric Comparisons
16. Checking nil
17. Checking Error Values
18. Checking Boolean Variables
19. Multiple Conditions
20. The else Placement Rule
21. Braces Are Mandatory
22. Whitespace and Formatting (gofmt)
23. Common Beginner Mistakes
24. Guard Clauses (Introduction)
25. if-else vs switch (When to Use Which)
26. Real-World Example: Grade Calculator
27. Real-World Example: Login Validation
28. Real-World Example: Temperature Classifier
29. Flowchart of if-else
30. Practice Summary

---

## 1. What is if-else?

An `if-else` statement lets your program **make decisions**. Based on whether a condition is `true` or `false`, your code takes one of two paths.

```go
package main

import "fmt"

func main() {
    age := 20

    if age >= 18 {
        fmt.Println("You are an adult.")
    } else {
        fmt.Println("You are a minor.")
    }
}
```

Output:
```
You are an adult.
```

The program checks: is `age >= 18`? Since `20 >= 18` is `true`, it prints the first message.

---

## 2. Basic Syntax

```go
if condition {
    // code runs when condition is true
} else {
    // code runs when condition is false
}
```

Key rules in Go:
- The condition does NOT need parentheses (unlike C, Java, JavaScript)
- The opening brace `{` must be on the SAME line as `if`
- The `else` must be on the SAME line as the closing `}` of the if block

```go
// CORRECT Go syntax
if x > 0 {
    fmt.Println("positive")
} else {
    fmt.Println("non-positive")
}

// WRONG - will not compile (brace on next line)
if x > 0
{
    fmt.Println("positive")
}
```

---

## 3. The Condition Expression

The condition must evaluate to a `bool` (either `true` or `false`). Go does NOT allow non-boolean conditions like C does.

```go
package main

import "fmt"

func main() {
    x := 5

    // These are valid conditions
    if x > 0 { fmt.Println("positive") }
    if x == 5 { fmt.Println("five") }
    if x != 3 { fmt.Println("not three") }

    // This would NOT compile in Go (unlike C)
    // if x { fmt.Println("truthy") }  // ERROR: x is int, not bool
}
```

---

## 4. Boolean Values in Go

Go's boolean type is `bool` with values `true` and `false`.

```go
package main

import "fmt"

func main() {
    isLoggedIn := true
    hasPremium := false

    if isLoggedIn {
        fmt.Println("Welcome back!")
    }

    if !hasPremium {
        fmt.Println("Upgrade to premium for more features.")
    }

    // Comparing booleans explicitly (but redundant)
    if isLoggedIn == true {
        fmt.Println("This works but is verbose")
    }

    // Better: just use the bool directly
    if isLoggedIn {
        fmt.Println("This is idiomatic Go")
    }
}
```

---

## 5. Basic if Statement (no else)

You don't always need an `else`. Sometimes you only care about one case.

```go
package main

import "fmt"

func main() {
    temperature := 35

    if temperature > 30 {
        fmt.Println("It's hot today!")
    }

    // Program continues here regardless
    fmt.Println("Have a great day!")
}
```

Output:
```
It's hot today!
Have a great day!
```

---

## 6. if-else Statement

When you have exactly two paths:

```go
package main

import "fmt"

func main() {
    score := 75

    if score >= 60 {
        fmt.Println("You passed!")
    } else {
        fmt.Println("You failed. Try again.")
    }
}
```

```go
package main

import "fmt"

func main() {
    number := -5

    if number >= 0 {
        fmt.Println("Non-negative number")
    } else {
        fmt.Println("Negative number")
    }
}
```

---

## 7. if-else if-else Chain

When you have more than two paths:

```go
package main

import "fmt"

func main() {
    score := 85

    if score >= 90 {
        fmt.Println("Grade: A")
    } else if score >= 80 {
        fmt.Println("Grade: B")
    } else if score >= 70 {
        fmt.Println("Grade: C")
    } else if score >= 60 {
        fmt.Println("Grade: D")
    } else {
        fmt.Println("Grade: F")
    }
}
```

Output:
```
Grade: B
```

Go checks conditions top-to-bottom and executes the FIRST matching branch.

---

## 8. Nested if-else

You can put if-else inside another if-else:

```go
package main

import "fmt"

func main() {
    isLoggedIn := true
    isAdmin := false

    if isLoggedIn {
        if isAdmin {
            fmt.Println("Welcome, Administrator!")
        } else {
            fmt.Println("Welcome, User!")
        }
    } else {
        fmt.Println("Please log in.")
    }
}
```

Output:
```
Welcome, User!
```

**Note:** Deep nesting makes code hard to read. Later you'll learn how to flatten it with guard clauses.

---

## 9. The Init Statement

Go allows a short initialization statement before the condition:

```go
if statement; condition {
    // body
}
```

Example:

```go
package main

import "fmt"

func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, fmt.Errorf("cannot divide by zero")
    }
    return a / b, nil
}

func main() {
    if result, err := divide(10, 2); err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Println("Result:", result)
    }
}
```

The init statement `result, err := divide(10, 2)` runs first, then the condition `err != nil` is checked.

---

## 10. Variable Scope in Init Statement

Variables declared in the init statement are scoped to the ENTIRE if-else block (including else branches):

```go
package main

import "fmt"

func getValue() int { return 42 }

func main() {
    if x := getValue(); x > 0 {
        fmt.Println("Positive:", x)  // x is accessible here
    } else {
        fmt.Println("Non-positive:", x)  // x is ALSO accessible here!
    }

    // fmt.Println(x)  // ERROR: x is not accessible here (out of scope)
}
```

This is very useful for error handling:

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    input := "42"

    if n, err := strconv.Atoi(input); err != nil {
        fmt.Println("Parse error:", err)
    } else {
        fmt.Println("Parsed number:", n)
    }
}
```

---

## 11. Comparison Operators

| Operator | Meaning              | Example       |
|----------|----------------------|---------------|
| `==`     | Equal to             | `x == 5`      |
| `!=`     | Not equal to         | `x != 0`      |
| `<`      | Less than            | `x < 10`      |
| `>`      | Greater than         | `x > 0`       |
| `<=`     | Less than or equal   | `x <= 100`    |
| `>=`     | Greater than or equal| `x >= 18`     |

```go
package main

import "fmt"

func main() {
    a, b := 10, 20

    fmt.Println(a == b)  // false
    fmt.Println(a != b)  // true
    fmt.Println(a < b)   // true
    fmt.Println(a > b)   // false
    fmt.Println(a <= b)  // true
    fmt.Println(a >= b)  // false
}
```

---

## 12. Logical Operators

Combine multiple conditions:

| Operator | Meaning | Example             |
|----------|---------|---------------------|
| `&&`     | AND     | `x > 0 && x < 10`  |
| `\|\|`   | OR      | `x < 0 \|\| x > 100` |
| `!`      | NOT     | `!isValid`          |

```go
package main

import "fmt"

func main() {
    age := 25
    hasID := true

    // AND: both must be true
    if age >= 18 && hasID {
        fmt.Println("Entry allowed")
    }

    x := -5
    // OR: at least one must be true
    if x < 0 || x > 100 {
        fmt.Println("Out of valid range")
    }

    isBlocked := false
    // NOT: reverses the boolean
    if !isBlocked {
        fmt.Println("Account is active")
    }
}
```

---

## 13. Short-Circuit Evaluation

Go evaluates logical expressions left-to-right and stops early:

```go
package main

import "fmt"

func isPositive(n int) bool {
    fmt.Printf("Checking if %d is positive\n", n)
    return n > 0
}

func main() {
    // With &&: if first is false, second is NOT evaluated
    if isPositive(-1) && isPositive(5) {
        fmt.Println("both positive")
    }
    // Only prints: "Checking if -1 is positive"

    fmt.Println("---")

    // With ||: if first is true, second is NOT evaluated
    if isPositive(3) || isPositive(5) {
        fmt.Println("at least one positive")
    }
    // Only prints: "Checking if 3 is positive"
}
```

This is important for safety checks:

```go
// Safe: checks for nil before accessing field
if user != nil && user.IsActive {
    fmt.Println("Active user:", user.Name)
}
```

---

## 14. String Comparisons

Strings in Go are compared using `==`, `!=`, `<`, `>`:

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    name := "Alice"

    if name == "Alice" {
        fmt.Println("Hello, Alice!")
    }

    if name != "Bob" {
        fmt.Println("You are not Bob")
    }

    // Case-insensitive comparison
    input := "HELLO"
    if strings.ToLower(input) == "hello" {
        fmt.Println("Got hello (case-insensitive)")
    }

    // Lexicographic comparison
    if "apple" < "banana" {
        fmt.Println("apple comes before banana")
    }
}
```

---

## 15. Numeric Comparisons

```go
package main

import "fmt"

func classifyNumber(n int) string {
    if n < 0 {
        return "negative"
    } else if n == 0 {
        return "zero"
    } else {
        return "positive"
    }
}

func main() {
    numbers := []int{-5, 0, 3, -1, 42}
    for _, n := range numbers {
        fmt.Printf("%d is %s\n", n, classifyNumber(n))
    }
}
```

Output:
```
-5 is negative
0 is zero
3 is positive
-1 is negative
42 is positive
```

---

## 16. Checking nil

In Go, `nil` means "no value" for pointers, slices, maps, channels, functions, and interfaces:

```go
package main

import "fmt"

type User struct {
    Name string
    Age  int
}

func findUser(id int) *User {
    if id == 1 {
        return &User{Name: "Alice", Age: 30}
    }
    return nil
}

func main() {
    user := findUser(1)
    if user != nil {
        fmt.Println("Found:", user.Name)
    } else {
        fmt.Println("User not found")
    }

    missing := findUser(99)
    if missing == nil {
        fmt.Println("No user with that ID")
    }
}
```

---

## 17. Checking Error Values

The most common use of `if` in Go is checking errors:

```go
package main

import (
    "errors"
    "fmt"
)

func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

func main() {
    result, err := divide(10, 0)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println("Result:", result)
}
```

Output:
```
Error: division by zero
```

This pattern (`if err != nil`) is extremely common in Go code.

---

## 18. Checking Boolean Variables

```go
package main

import "fmt"

type Config struct {
    Debug   bool
    Verbose bool
    Cache   bool
}

func printConfig(c Config) {
    if c.Debug {
        fmt.Println("[DEBUG MODE ENABLED]")
    }

    if c.Verbose {
        fmt.Println("[VERBOSE LOGGING ON]")
    } else {
        fmt.Println("[QUIET MODE]")
    }

    if !c.Cache {
        fmt.Println("[WARNING: Caching disabled - performance may suffer]")
    }
}

func main() {
    cfg := Config{Debug: true, Verbose: false, Cache: false}
    printConfig(cfg)
}
```

Output:
```
[DEBUG MODE ENABLED]
[QUIET MODE]
[WARNING: Caching disabled - performance may suffer]
```

---

## 19. Multiple Conditions

Combining comparisons into complex conditions:

```go
package main

import "fmt"

func canEnter(age int, hasTicket bool, isVIP bool) bool {
    if age < 18 {
        return false
    }
    if isVIP {
        return true
    }
    if hasTicket && age >= 18 {
        return true
    }
    return false
}

func main() {
    scenarios := []struct {
        age       int
        hasTicket bool
        isVIP     bool
        name      string
    }{
        {25, true, false, "Alice"},
        {16, true, false, "Bob"},
        {30, false, true, "Carol"},
        {22, false, false, "Dave"},
    }

    for _, s := range scenarios {
        if canEnter(s.age, s.hasTicket, s.isVIP) {
            fmt.Printf("%s: ENTER\n", s.name)
        } else {
            fmt.Printf("%s: DENIED\n", s.name)
        }
    }
}
```

---

## 20. The else Placement Rule

In Go, the `else` keyword MUST appear on the same line as the closing `}` of the `if` block. This is enforced by the Go formatter (gofmt).

```go
// CORRECT
if condition {
    doThis()
} else {
    doThat()
}

// WRONG - does not compile
if condition {
    doThis()
}
else {   // ERROR: unexpected else, expecting }
    doThat()
}
```

Why? Go uses automatic semicolon insertion. A `}` at the end of a line gets a semicolon inserted, which breaks the if-else.

---

## 21. Braces Are Mandatory

Unlike C or Java, Go requires braces `{}` even for single-line bodies:

```go
// WRONG in Go
if x > 0
    fmt.Println("positive")  // ERROR

// CORRECT
if x > 0 {
    fmt.Println("positive")
}

// Technically valid (single line) but not recommended
if x > 0 { fmt.Println("positive") }
```

---

## 22. Whitespace and Formatting (gofmt)

Go has an official formatter called `gofmt`. It automatically formats your code:

```go
// Before gofmt (messy)
if x>0{
fmt.Println("positive")
}else{
fmt.Println("non-positive")
}

// After gofmt (clean)
if x > 0 {
    fmt.Println("positive")
} else {
    fmt.Println("non-positive")
}
```

Run `gofmt -w yourfile.go` or use `go fmt ./...` to format your entire project.

---

## 23. Common Beginner Mistakes

```go
package main

import "fmt"

func main() {
    x := 5

    // Mistake 1: Using = instead of ==
    // if x = 5 { }  // ERROR in Go (assignment, not comparison)

    // Mistake 2: Comparing different types
    var y int32 = 5
    // if x == y { }  // ERROR: mismatched types int and int32
    if x == int(y) { fmt.Println("equal") }  // CORRECT: explicit conversion

    // Mistake 3: else on wrong line (won't compile)
    // if x > 0 {
    //     fmt.Println("pos")
    // }
    // else { fmt.Println("neg") }

    // Mistake 4: Non-boolean condition (won't compile in Go)
    // if x { fmt.Println("truthy") }  // ERROR in Go!
    if x != 0 { fmt.Println("non-zero") }  // CORRECT

    // Mistake 5: Forgetting that strings need ==
    name := "Alice"
    if name == "Alice" {  // Correct
        fmt.Println("Alice!")
    }
}
```

---

## 24. Guard Clauses (Introduction)

A guard clause is an early return that handles special/error cases first, keeping the "happy path" at the left margin:

```go
package main

import (
    "errors"
    "fmt"
)

// Without guard clauses (deeply nested)
func processOrderBad(user *User, amount float64) error {
    if user != nil {
        if user.IsActive {
            if amount > 0 {
                fmt.Println("Processing order...")
                return nil
            } else {
                return errors.New("invalid amount")
            }
        } else {
            return errors.New("user is not active")
        }
    } else {
        return errors.New("user is nil")
    }
}

type User struct {
    IsActive bool
    Name     string
}

// With guard clauses (flat, readable)
func processOrderGood(user *User, amount float64) error {
    if user == nil {
        return errors.New("user is nil")
    }
    if !user.IsActive {
        return errors.New("user is not active")
    }
    if amount <= 0 {
        return errors.New("invalid amount")
    }

    fmt.Println("Processing order...")
    return nil
}

func main() {
    user := &User{IsActive: true, Name: "Alice"}
    if err := processOrderGood(user, 99.99); err != nil {
        fmt.Println("Error:", err)
    }
}
```

---

## 25. if-else vs switch (When to Use Which)

| Situation                        | Use          |
|----------------------------------|--------------|
| 2-3 conditions                   | if-else      |
| 4+ conditions on same variable   | switch       |
| Range conditions (x > 0 < 10)    | if-else      |
| Type checking (interface)         | type switch  |
| Complex boolean expressions       | if-else      |
| Single value, multiple exact matches | switch   |

```go
// Better as if-else (range conditions)
if score >= 90 && score <= 100 {
    fmt.Println("Excellent")
} else if score >= 70 {
    fmt.Println("Good")
}

// Better as switch (exact values)
switch status {
case "pending", "processing":
    fmt.Println("In progress")
case "done":
    fmt.Println("Complete")
case "failed":
    fmt.Println("Failed")
}
```

---

## 26. Real-World Example: Grade Calculator

```go
package main

import "fmt"

func calculateGrade(score int) string {
    if score < 0 || score > 100 {
        return "Invalid score"
    } else if score >= 90 {
        return "A"
    } else if score >= 80 {
        return "B"
    } else if score >= 70 {
        return "C"
    } else if score >= 60 {
        return "D"
    } else {
        return "F"
    }
}

func main() {
    scores := []int{95, 82, 74, 65, 40, -5, 105}
    for _, s := range scores {
        fmt.Printf("Score %d -> Grade %s\n", s, calculateGrade(s))
    }
}
```

Output:
```
Score 95 -> Grade A
Score 82 -> Grade B
Score 74 -> Grade C
Score 65 -> Grade D
Score 40 -> Grade F
Score -5 -> Grade Invalid score
Score 105 -> Grade Invalid score
```

---

## 27. Real-World Example: Login Validation

```go
package main

import (
    "fmt"
    "strings"
)

type LoginResult struct {
    Success bool
    Message string
}

func validateLogin(username, password string) LoginResult {
    if strings.TrimSpace(username) == "" {
        return LoginResult{false, "Username cannot be empty"}
    }
    if len(password) < 8 {
        return LoginResult{false, "Password must be at least 8 characters"}
    }
    if username == "admin" && password == "secret123" {
        return LoginResult{true, "Welcome, Administrator!"}
    }
    if username == "alice" && password == "alicepass" {
        return LoginResult{true, "Welcome, Alice!"}
    }
    return LoginResult{false, "Invalid username or password"}
}

func main() {
    attempts := []struct{ user, pass string }{
        {"admin", "secret123"},
        {"alice", "short"},
        {"", "password123"},
        {"bob", "wrongpass"},
    }

    for _, a := range attempts {
        result := validateLogin(a.user, a.pass)
        if result.Success {
            fmt.Println("LOGIN OK:", result.Message)
        } else {
            fmt.Println("LOGIN FAIL:", result.Message)
        }
    }
}
```

---

## 28. Real-World Example: Temperature Classifier

```go
package main

import "fmt"

type TempUnit string

const (
    Celsius    TempUnit = "C"
    Fahrenheit TempUnit = "F"
)

func classifyTemperature(temp float64, unit TempUnit) string {
    var celsius float64
    if unit == Fahrenheit {
        celsius = (temp - 32) * 5 / 9
    } else {
        celsius = temp
    }

    if celsius < -20 {
        return "Extreme Cold"
    } else if celsius < 0 {
        return "Freezing"
    } else if celsius < 10 {
        return "Cold"
    } else if celsius < 20 {
        return "Cool"
    } else if celsius < 30 {
        return "Comfortable"
    } else if celsius < 40 {
        return "Hot"
    } else {
        return "Extreme Heat"
    }
}

func main() {
    fmt.Println(classifyTemperature(100, Fahrenheit))  // Comfortable (37.8C? no - 37.8 is Hot)
    fmt.Println(classifyTemperature(0, Celsius))       // Freezing? No - exactly 0 is "Cool" with < 0 check
    fmt.Println(classifyTemperature(-5, Celsius))      // Freezing
    fmt.Println(classifyTemperature(35, Celsius))      // Hot
    fmt.Println(classifyTemperature(212, Fahrenheit))  // Extreme Heat (100C)
}
```

---

## 29. Flowchart of if-else

```
        Start
          |
          v
    [Evaluate Condition]
          |
     _____|_____
    |           |
  true        false
    |           |
    v           v
[if block]  [else block]
    |           |
    |___________|
          |
          v
    (continue...)
```

For if-else if chain:

```
        Start
          |
          v
    [Condition 1?] --false--> [Condition 2?] --false--> [else block]
          |                         |
        true                      true
          |                         |
    [Block 1]                  [Block 2]
          |                         |
          |_________________________|
                      |
                      v
               (continue...)
```

---

## 30. Practice Summary

Key takeaways for beginners:

1. **Condition must be `bool`** — Go does not allow integer or other types as conditions
2. **No parentheses needed** around the condition (but allowed)
3. **Braces `{}`  are required** — even for single statements
4. **`else` on same line** as closing `}` of if block
5. **Init statement** — `if x := getValue(); x > 0` scopes `x` to the if-else block
6. **Check errors with `if err != nil`** — the most common Go pattern
7. **Guard clauses** — return early to avoid deep nesting
8. **`&&` short-circuits** — second operand not evaluated if first is false
9. **`||` short-circuits** — second operand not evaluated if first is true
10. **Use switch** when you have 4+ branches on the same value

```go
// Template for common Go if patterns
package main

import "fmt"

func main() {
    // Pattern 1: Simple condition
    x := 10
    if x > 5 {
        fmt.Println("big")
    }

    // Pattern 2: Two branches
    if x%2 == 0 {
        fmt.Println("even")
    } else {
        fmt.Println("odd")
    }

    // Pattern 3: Error check with init
    if val, err := someFunction(); err != nil {
        fmt.Println("error:", err)
    } else {
        fmt.Println("got:", val)
    }
}

func someFunction() (int, error) {
    return 42, nil
}
```
