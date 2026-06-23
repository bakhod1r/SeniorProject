# Go Specification: If-Else Statement

**Source:** https://go.dev/ref/spec#If_statements
**Section:** Statements → If statements (else branch)

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#If_statements
- **Related:** https://go.dev/ref/spec#Block
- **Related:** https://go.dev/ref/spec#Scope
- **Related:** https://go.dev/ref/spec#Semicolons
- **Related:** https://go.dev/ref/spec#Switch_statements

Official definition from the spec:

> "'If' statements specify the conditional execution of two branches according to the value of a boolean expression. If the expression evaluates to true, the 'if' branch is executed, otherwise, if present, the 'else' branch is executed."

Full grammar covering `else`:

```ebnf
IfStmt = "if" [ SimpleStmt ";" ] Expression Block
         [ "else" ( IfStmt | Block ) ] .
```

The `else` clause binds to the nearest preceding `if`. The `else` can be followed by either:
1. A `Block` — `else { ... }` for a simple else branch
2. Another `IfStmt` — `else if condition { ... }` for chaining

---

## 2. Formal Grammar (EBNF)

```ebnf
IfStmt    = "if" [ SimpleStmt ";" ] Expression Block [ "else" ElseClause ] .
ElseClause = IfStmt | Block .

Block     = "{" StatementList "}" .
SimpleStmt = ExpressionStmt | SendStmt | IncDecStmt | Assignment |
             ShortVarDecl | EmptyStmt .
```

Key structural rules:
- The `else` keyword must appear on the **same line** as the closing `}` of the `if` block (due to automatic semicolon insertion).
- `else if` is syntactic sugar for `else { if ... }` — the `if` in `else if` begins a new `IfStmt`.
- There is no limit on the number of `else if` chains.

---

## 3. Core Rules & Constraints

### 3.1 The `else` Block Must Use Braces

Like the `if` branch, the `else` branch body must be enclosed in curly braces.

```go
package main

import "fmt"

func main() {
    x := 3

    if x > 5 {
        fmt.Println("greater than 5")
    } else {
        fmt.Println("5 or less")
    }
    // else
    //     fmt.Println("invalid") // compile error: expected '{'
}
```

### 3.2 The `else` Must Be on the Same Line as the Closing Brace

Go's automatic semicolon insertion rule requires this. The parser inserts a semicolon after `}` if it is at the end of a line, which would make the `else` a syntax error.

```go
package main

import "fmt"

func main() {
    x := 5

    // CORRECT: else on same line as closing brace
    if x > 0 {
        fmt.Println("positive")
    } else {
        fmt.Println("non-positive")
    }

    // INCORRECT (would be a parse error):
    // if x > 0 {
    //     fmt.Println("positive")
    // }
    // else {   <-- semicolon inserted after }, making this invalid
    //     fmt.Println("non-positive")
    // }
}
```

### 3.3 else if Chaining

Multiple conditions are chained with `else if`. Each `else if` is a new `if` statement in the `else` branch.

```go
package main

import "fmt"

func classify(n int) string {
    if n < 0 {
        return "negative"
    } else if n == 0 {
        return "zero"
    } else if n < 10 {
        return "small positive"
    } else if n < 100 {
        return "medium positive"
    } else {
        return "large positive"
    }
}

func main() {
    fmt.Println(classify(-5))
    fmt.Println(classify(0))
    fmt.Println(classify(7))
    fmt.Println(classify(50))
    fmt.Println(classify(999))
}
```

### 3.4 Scope of Init Statement Variables Across all Branches

Variables declared in the `if` init statement are in scope through all `else if` and `else` branches.

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    if f, err := os.Open("/tmp"); err != nil {
        // f and err in scope here
        fmt.Println("error:", err)
    } else {
        // f and err STILL in scope here
        fmt.Println("opened:", f.Name())
        f.Close()
    }
    // f and err out of scope here
}
```

### 3.5 No Fallthrough in If-Else

Unlike `switch` statements in some languages, Go `if-else` chains do not fall through. Only the first matching branch executes.

```go
package main

import "fmt"

func main() {
    x := 5
    if x > 0 {
        fmt.Println("positive") // only this executes
    } else if x > 3 {
        fmt.Println("greater than 3") // NOT reached even though x > 3
    }
}
```

---

## 4. Type Rules

### 4.1 Each Condition Must Be Boolean

Every condition in an `if` / `else if` chain must be a boolean expression. There are no implicit truthy conversions.

```go
package main

import "fmt"

func main() {
    s := "hello"
    n := 42

    if len(s) > 0 {
        fmt.Println("non-empty string")
    } else if n != 0 {
        fmt.Println("non-zero number")
    }

    // if s { }    // compile error: non-boolean condition
    // if n { }    // compile error: non-boolean condition
}
```

### 4.2 Branches Can Have Differing Types in Variables

Variables declared in different branches are independent and can have different types.

```go
package main

import "fmt"

func maybeInt() (int, bool)    { return 42, true }
func maybeString() (string, bool) { return "hello", false }

func main() {
    found := false
    if v, ok := maybeInt(); ok {
        fmt.Println("int:", v)
        found = true
    } else if s, ok2 := maybeString(); ok2 {
        fmt.Println("string:", s)
        found = true
    }
    fmt.Println("found:", found)
}
```

### 4.3 No Type Narrowing

Go does not perform type narrowing in `if` branches. After `if v, ok := x.(SomeType); ok { }`, `v` is of type `SomeType` within the block, but this is because of the type assertion syntax, not type narrowing.

---

## 5. Behavioral Specification

### 5.1 Complete if-else if-else Pattern

```go
package main

import "fmt"

func httpStatus(code int) string {
    if code >= 500 {
        return "Server Error"
    } else if code >= 400 {
        return "Client Error"
    } else if code >= 300 {
        return "Redirection"
    } else if code >= 200 {
        return "Success"
    } else if code >= 100 {
        return "Informational"
    } else {
        return "Unknown"
    }
}

func main() {
    codes := []int{200, 301, 404, 500, 0}
    for _, c := range codes {
        fmt.Printf("%d: %s\n", c, httpStatus(c))
    }
}
```

### 5.2 If-Else for Return Value Selection

A common pattern: use `if-else` to select a return value.

```go
package main

import "fmt"

func abs(x int) int {
    if x < 0 {
        return -x
    }
    return x
}

func max(a, b int) int {
    if a > b {
        return a
    }
    return b
}

func min(a, b int) int {
    if a < b {
        return a
    }
    return b
}

func main() {
    fmt.Println(abs(-5), abs(5))
    fmt.Println(max(3, 7))
    fmt.Println(min(3, 7))
}
```

### 5.3 Error Handling with else

Using `else` to continue processing after a successful operation:

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Config struct {
    Host string `json:"host"`
    Port int    `json:"port"`
}

func parseConfig(data []byte) {
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        fmt.Println("parse error:", err)
    } else {
        fmt.Printf("Config: %s:%d\n", cfg.Host, cfg.Port)
    }
}

func main() {
    good := []byte(`{"host":"localhost","port":8080}`)
    bad := []byte(`invalid json`)
    parseConfig(good)
    parseConfig(bad)
}
```

### 5.4 Nested If-Else

```go
package main

import "fmt"

func fizzBuzz(n int) string {
    if n%15 == 0 {
        return "FizzBuzz"
    } else if n%3 == 0 {
        return "Fizz"
    } else if n%5 == 0 {
        return "Buzz"
    } else {
        return fmt.Sprintf("%d", n)
    }
}

func main() {
    for i := 1; i <= 20; i++ {
        fmt.Println(fizzBuzz(i))
    }
}
```

### 5.5 If-Else with defer

Variables declared in `if` init statements work with `defer`. The deferred call executes when the enclosing function returns.

```go
package main

import (
    "fmt"
    "os"
)

func readFile(name string) error {
    if f, err := os.Open(name); err != nil {
        return fmt.Errorf("open: %w", err)
    } else {
        defer f.Close()
        // use f
        fmt.Println("reading:", f.Name())
        return nil
    }
}

func main() {
    err := readFile("/tmp")
    if err != nil {
        fmt.Println("error:", err)
    }
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Mutually Exclusive Branches

Exactly one branch of an `if-else if-else` chain executes per evaluation. The conditions are tested in order from top to bottom.

```go
package main

import "fmt"

func main() {
    x := 5
    count := 0
    if x > 0 {
        count++
    } else if x > 3 {
        count++ // never reached even if x > 3, because x > 0 matched first
    } else {
        count++
    }
    fmt.Println(count) // always 1
}
```

### 6.2 Defined: No Implicit Else

If no `else` is specified and all conditions are false, execution continues after the `if` statement with no action taken.

```go
package main

import "fmt"

func main() {
    x := -5
    if x > 0 {
        fmt.Println("positive")
    } else if x == 0 {
        fmt.Println("zero")
    }
    // no else: nothing printed for negative x
    fmt.Println("done") // always reaches here
}
```

### 6.3 Defined: Semicolon Insertion and Else

Go's spec (section on Semicolons) states:

> "When the input is broken into tokens, a semicolon is automatically inserted into the token stream immediately after a line's final token if that token is a `}` ... [among other conditions]"

This is why:
```go
// INVALID — semicolon inserted after }
// if cond { }
// else { }

// VALID — else on same line
// if cond { } else { }
```

### 6.4 Defined: Short-Circuit Evaluation

Logical operators in `if-else if` conditions use short-circuit evaluation.

```go
package main

import "fmt"

func sideEffect(name string, val bool) bool {
    fmt.Println("evaluating:", name)
    return val
}

func main() {
    // Only first condition checked (true || anything = true)
    if sideEffect("A", true) || sideEffect("B", false) {
        fmt.Println("true branch")
    }
    // Output: evaluating: A, true branch
    // B is never evaluated
}
```

---

## 7. Edge Cases from Spec

### 7.1 else if vs switch

When you have many `else if` branches, a `switch` statement is often more readable. Functionally equivalent but clearer style.

```go
package main

import "fmt"

func dayType(day string) string {
    // if-else if approach
    if day == "Saturday" || day == "Sunday" {
        return "weekend"
    } else if day == "Monday" || day == "Friday" {
        return "near-weekend"
    } else {
        return "weekday"
    }
}

func dayTypeSwitched(day string) string {
    // switch approach — more idiomatic for multi-value matching
    switch day {
    case "Saturday", "Sunday":
        return "weekend"
    case "Monday", "Friday":
        return "near-weekend"
    default:
        return "weekday"
    }
}

func main() {
    fmt.Println(dayType("Saturday"))
    fmt.Println(dayTypeSwitched("Saturday"))
}
```

### 7.2 Variable Shadowing in Else Blocks

A new `:=` in the `else` block can shadow a variable from the init statement if it uses the same name.

```go
package main

import "fmt"

func getVal() (int, bool) { return 42, true }

func main() {
    if v, ok := getVal(); ok {
        fmt.Println("if branch, v =", v)
    } else {
        v := "shadowed" // new v shadows the outer v in this block
        fmt.Println("else branch, v =", v, "ok =", ok)
    }
}
```

### 7.3 Returning From Inside If-Else

Each branch can independently return from the function. Not all branches need to return.

```go
package main

import "fmt"

func describe(x int) string {
    if x > 0 {
        return "positive"
    } else if x < 0 {
        return "negative"
    }
    return "zero" // reached when both conditions are false
}

func main() {
    fmt.Println(describe(1), describe(-1), describe(0))
}
```

### 7.4 If-Else in Multi-Return Context

```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

func parseInt(s string) (int, error) {
    if s == "" {
        return 0, errors.New("empty string")
    } else if n, err := strconv.Atoi(s); err != nil {
        return 0, fmt.Errorf("invalid number %q: %w", s, err)
    } else {
        return n, nil
    }
}

func main() {
    if v, err := parseInt("123"); err != nil {
        fmt.Println("error:", err)
    } else {
        fmt.Println("value:", v)
    }

    if _, err := parseInt("abc"); err != nil {
        fmt.Println("error:", err)
    }
}
```

### 7.5 Blank Identifier in If-Else Init

The blank identifier `_` can be used in the init statement to discard values.

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    // Discard the file, keep only the error
    if _, err := os.Open("/nonexistent"); err != nil {
        fmt.Println("file not found:", err)
    } else {
        fmt.Println("file found")
    }
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | `if-else` and `else if` chaining established with current semantics |
| Go 1.22    | `for range` over integers added, no changes to `if` |

The `if-else` statement has been completely stable since Go 1.0. The mandatory-brace requirement and else-same-line rule have never changed.

---

## 9. Implementation-Specific Behavior

### 9.1 Compiler Optimization: Constant Folding in Else Chains

If any condition in an `else if` chain is a compile-time constant, the gc compiler eliminates dead branches.

```go
package main

import "fmt"

const isProduction = false

func main() {
    if isProduction {
        fmt.Println("production mode")
    } else {
        fmt.Println("development mode") // only this remains in binary
    }
}
```

### 9.2 Branch Layout in Generated Code

The gc compiler typically generates a conditional jump for `if`, with the `else` branch as the fall-through or a separate jump target. PGO (profile-guided optimization, Go 1.20+) can reorder branches based on observed frequency.

### 9.3 Stack Depth

Each nested `if-else` block introduces a new scope but does not necessarily increase the runtime stack depth (unless a function call is made). The compiler determines stack frame size based on the maximum variables live at any point.

---

## 10. Spec Compliance Checklist

- [ ] Every condition (if and else if) must be of type `bool`
- [ ] All branches must use curly brace blocks
- [ ] `else` must appear on the same line as the closing `}` of the preceding block
- [ ] `else if` is syntactically an `else` branch containing an `if` statement
- [ ] Init statement variables are scoped to all branches (if, else if, else)
- [ ] Conditions are tested in order; only the first matching branch executes
- [ ] No fallthrough between `if-else if-else` branches
- [ ] Short-circuit evaluation applies within each condition expression
- [ ] Each condition evaluated exactly once
- [ ] If no condition matches and no `else` branch exists, execution continues after the statement
- [ ] Variables declared in different branches do not conflict
- [ ] `else` clause is optional (the entire `[ "else" ... ]` is optional)

---

## 11. Official Examples

### Example 1: If-Else

```go
package main

import "fmt"

func main() {
    if 7%2 == 0 {
        fmt.Println("7 is even")
    } else {
        fmt.Println("7 is odd")
    }
}
```

### Example 2: If-Else If-Else Chain

```go
package main

import "fmt"

func main() {
    num := 9
    if num < 0 {
        fmt.Println(num, "is negative")
    } else if num < 10 {
        fmt.Println(num, "has 1 digit")
    } else {
        fmt.Println(num, "has multiple digits")
    }
}
```

### Example 3: If with Init Statement and Else

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    input := "42"
    if n, err := strconv.Atoi(input); err == nil {
        fmt.Println("converted:", n*2)
    } else {
        fmt.Println("conversion error:", err)
    }
}
```

### Example 4: Multiple Else If Branches

```go
package main

import "fmt"

func bmi(weight, height float64) string {
    bmiVal := weight / (height * height)
    if bmiVal < 18.5 {
        return "Underweight"
    } else if bmiVal < 25.0 {
        return "Normal"
    } else if bmiVal < 30.0 {
        return "Overweight"
    } else {
        return "Obese"
    }
}

func main() {
    fmt.Println(bmi(50, 1.75))   // Underweight
    fmt.Println(bmi(70, 1.75))   // Normal
    fmt.Println(bmi(85, 1.75))   // Overweight
    fmt.Println(bmi(100, 1.75))  // Obese
}
```

### Example 5: Idiomatic Error Handling with If-Else

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    filename := "/tmp"
    if info, err := os.Stat(filename); err != nil {
        fmt.Printf("Error accessing %s: %v\n", filename, err)
    } else if info.IsDir() {
        fmt.Printf("%s is a directory with %d bytes\n", filename, info.Size())
    } else {
        fmt.Printf("%s is a file with %d bytes\n", filename, info.Size())
    }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| If statements | https://go.dev/ref/spec#If_statements | Primary spec section (covers both if and if-else) |
| Semicolons | https://go.dev/ref/spec#Semicolons | Why `else` must be on same line as `}` |
| Switch statements | https://go.dev/ref/spec#Switch_statements | Alternative to long if-else if chains |
| Block | https://go.dev/ref/spec#Block | Branches are always blocks |
| Scope | https://go.dev/ref/spec#Declarations_and_scope | Init statement variable scope |
| Short variable declarations | https://go.dev/ref/spec#Short_variable_declarations | `:=` in init statement |
| Logical operators | https://go.dev/ref/spec#Logical_operators | Short-circuit in conditions |
| For statements | https://go.dev/ref/spec#For_statements | Also uses init statement pattern |
