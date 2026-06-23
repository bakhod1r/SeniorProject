# Go Specification: If Statement

**Source:** https://go.dev/ref/spec#If_statements
**Section:** Statements → If statements

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#If_statements
- **Related:** https://go.dev/ref/spec#Block
- **Related:** https://go.dev/ref/spec#Short_variable_declarations
- **Related:** https://go.dev/ref/spec#Expressions
- **Related:** https://go.dev/ref/spec#Scope

Official definition from the spec:

> "'If' statements specify the conditional execution of two branches according to the value of a boolean expression. If the expression evaluates to true, the 'if' branch is executed, otherwise, if present, the 'else' branch is executed."

---

## 2. Formal Grammar (EBNF)

```ebnf
IfStmt = "if" [ SimpleStmt ";" ] Expression Block
         [ "else" ( IfStmt | Block ) ] .
```

Where:
- `SimpleStmt` is an optional initialization statement executed before the condition.
- `Expression` must be of type `bool` (no implicit conversion).
- `Block` is a curly-brace enclosed list of statements — **always required**, even for single-statement bodies.
- The `else` clause is optional.

**Examples of valid `if` forms:**

```
if x > 0 { ... }
if x := compute(); x > 0 { ... }
if err != nil { ... } else { ... }
if n, err := f(); err != nil { ... } else { ... }
```

---

## 3. Core Rules & Constraints

### 3.1 Condition Must Be Boolean

The condition expression must evaluate to type `bool`. Unlike C or Java, there is no implicit conversion of integers or pointers to bool.

```go
package main

import "fmt"

func main() {
    x := 5
    if x > 0 {
        fmt.Println("positive")
    }

    // if x { ... }       // compile error: non-boolean condition in if statement
    // if x = 0; x { ... } // compile error
}
```

### 3.2 Braces Are Always Required

Unlike many C-family languages, Go requires curly braces around all `if` branches. Single-line bodies without braces are a compile error.

```go
package main

import "fmt"

func main() {
    x := 10
    if x > 5 {
        fmt.Println("x is greater than 5")
    }
    // if x > 5
    //     fmt.Println("nope") // compile error: expected '{', found 'fmt'
}
```

### 3.3 The Optional Init Statement

The `if` statement optionally accepts a simple statement (assignment, short variable declaration, function call) before the condition, separated by a semicolon.

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    if n, err := strconv.Atoi("42"); err == nil {
        fmt.Println("parsed:", n)
    }
    // n and err are not accessible here
}
```

### 3.4 Scope of Init Statement Variables

Variables declared in the `if` init statement are scoped to the entire `if` statement including all `else if` and `else` branches, but not beyond.

```go
package main

import "fmt"

func divide(a, b float64) {
    if b == 0 {
        fmt.Println("cannot divide by zero")
        return
    }
    if result := a / b; result > 100 {
        fmt.Println("large result:", result)
    } else if result > 10 {
        fmt.Println("medium result:", result)
    } else {
        fmt.Println("small result:", result)
    }
    // result is not accessible here
}

func main() {
    divide(500, 3)
    divide(25, 2)
    divide(1, 1)
}
```

### 3.5 The `else` Branch

The `else` branch can be either a block `{ ... }` or another `if` statement (for chaining).

```go
package main

import "fmt"

func grade(score int) string {
    if score >= 90 {
        return "A"
    } else if score >= 80 {
        return "B"
    } else if score >= 70 {
        return "C"
    } else {
        return "F"
    }
}

func main() {
    fmt.Println(grade(95))
    fmt.Println(grade(82))
    fmt.Println(grade(71))
    fmt.Println(grade(50))
}
```

---

## 4. Type Rules

### 4.1 Condition Type Must Be bool

The expression in an `if` statement must be of type `bool`. There is no truthiness coercion.

```go
package main

import "fmt"

func main() {
    var p *int = nil
    if p != nil {          // must explicitly compare
        fmt.Println(*p)
    } else {
        fmt.Println("nil pointer")
    }

    var s []int
    if len(s) > 0 {        // must compare length, not the slice itself
        fmt.Println(s[0])
    }
}
```

### 4.2 Short Variable Declarations in Init

The init statement can use `:=` to declare and initialize variables. These declarations use the same scoping rules as other short variable declarations.

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    if f, err := os.Open("test.txt"); err != nil {
        fmt.Println("error:", err)
    } else {
        defer f.Close()
        fmt.Println("opened file:", f.Name())
    }
}
```

### 4.3 Interface Comparisons in If Conditions

Interface values can be compared to `nil` or to each other if the concrete types are comparable.

```go
package main

import "fmt"

type Animal interface {
    Sound() string
}

func describe(a Animal) {
    if a == nil {
        fmt.Println("nil animal")
        return
    }
    fmt.Println(a.Sound())
}

type Dog struct{}
func (d Dog) Sound() string { return "woof" }

func main() {
    describe(nil)
    describe(Dog{})
}
```

---

## 5. Behavioral Specification

### 5.1 Execution Flow

1. If the init statement is present, it is executed first.
2. The condition expression is evaluated.
3. If `true`, the `if` block executes.
4. If `false` and `else` is present, the else branch executes.
5. Execution continues after the entire `if` statement.

```go
package main

import "fmt"

func main() {
    x := 42

    // Full flow example
    if y := x * 2; y > 50 {
        fmt.Println("y =", y, "is large")
    } else {
        fmt.Println("y =", y, "is small")
    }

    fmt.Println("x =", x) // x unchanged
}
```

### 5.2 Idiomatic Error Handling

The most common `if` pattern in Go is error checking:

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
    result, err := divide(10, 2)
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("result:", result)
}
```

### 5.3 Early Return (Guard Clause) Pattern

Using `if` at the beginning of a function to handle invalid conditions early:

```go
package main

import (
    "errors"
    "fmt"
)

func processUser(name string, age int) error {
    if name == "" {
        return errors.New("name cannot be empty")
    }
    if age < 0 {
        return errors.New("age cannot be negative")
    }
    if age > 150 {
        return errors.New("age is unreasonably large")
    }
    fmt.Printf("Processing user: %s, age %d\n", name, age)
    return nil
}

func main() {
    fmt.Println(processUser("Alice", 30))
    fmt.Println(processUser("", 25))
    fmt.Println(processUser("Bob", -1))
}
```

### 5.4 Type Assertion in If Condition

```go
package main

import "fmt"

func describe(i interface{}) {
    if s, ok := i.(string); ok {
        fmt.Printf("string: %q, length: %d\n", s, len(s))
    } else if n, ok := i.(int); ok {
        fmt.Printf("int: %d\n", n)
    } else {
        fmt.Printf("other: %T\n", i)
    }
}

func main() {
    describe("hello")
    describe(42)
    describe(3.14)
}
```

### 5.5 Combining Init Statement with Error and Result

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    if info, err := os.Stat("/tmp"); err != nil {
        fmt.Println("stat error:", err)
    } else {
        fmt.Println("dir:", info.Name(), "isDir:", info.IsDir())
    }
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Condition Evaluated Exactly Once

The condition expression is evaluated exactly once per execution of the `if` statement. Side effects in the condition occur once.

```go
package main

import "fmt"

func check() bool {
    fmt.Println("checking...")
    return true
}

func main() {
    if check() {
        fmt.Println("true branch")
    }
    // Output:
    // checking...
    // true branch
}
```

### 6.2 Defined: Init Statement Runs Exactly Once

The init statement runs exactly once per execution of the `if` statement, regardless of which branch is taken.

### 6.3 Defined: Short-Circuit in Compound Conditions

Go uses short-circuit evaluation for `&&` and `||`:
- `a && b`: `b` is not evaluated if `a` is false.
- `a || b`: `b` is not evaluated if `a` is true.

```go
package main

import "fmt"

func expensive() bool {
    fmt.Println("evaluating expensive...")
    return true
}

func main() {
    x := false
    if x && expensive() {
        fmt.Println("both true")
    }
    // expensive() is never called — short circuit
    fmt.Println("done") // just "done"
}
```

### 6.4 Defined: Variables Declared in Init Are Scoped to If Block

Variables from the init statement go out of scope after the `if` statement ends.

---

## 7. Edge Cases from Spec

### 7.1 No Parentheses Around Condition

Go does not use parentheses around the `if` condition (unlike C, Java, JavaScript). Adding them is allowed but triggers a `gofmt` style warning.

```go
package main

import "fmt"

func main() {
    x := 5
    if (x > 0) { // valid but unconventional; gofmt removes extra parens
        fmt.Println("positive")
    }
    if x > 0 { // idiomatic
        fmt.Println("positive")
    }
}
```

### 7.2 If Statement as Expression — Not Supported

Unlike some languages (Rust, etc.), Go's `if` is a **statement**, not an expression. It cannot appear in places that require a value.

```go
package main

import "fmt"

func main() {
    x := 5
    // y := if x > 0 { 1 } else { 0 } // NOT valid in Go

    // Use ternary-like construct:
    var y int
    if x > 0 {
        y = 1
    } else {
        y = 0
    }
    fmt.Println(y)
}
```

### 7.3 Misplaced Else (Dangling Else Problem)

Go's mandatory braces completely eliminate the dangling else problem. The `else` always binds to the nearest `if`.

```go
package main

import "fmt"

func main() {
    x, y := 5, 3
    // The braces make the structure completely unambiguous:
    if x > 0 {
        if y > 0 {
            fmt.Println("both positive")
        } else {
            fmt.Println("x positive, y not")
        }
    }
}
```

### 7.4 Else Must Be on Same Line as Closing Brace

Due to Go's automatic semicolon insertion, the `else` keyword must appear on the same line as the closing brace of the `if` block.

```go
package main

import "fmt"

func main() {
    x := 5
    if x > 0 {
        fmt.Println("positive")
    } else {            // else on same line as "}" — required
        fmt.Println("non-positive")
    }
    // } \n else { ... } would cause a parse error due to semicolon insertion
}
```

### 7.5 Nested If Statements

```go
package main

import "fmt"

func classify(x, y int) string {
    if x > 0 {
        if y > 0 {
            return "Quadrant I"
        } else if y < 0 {
            return "Quadrant IV"
        } else {
            return "Positive X axis"
        }
    } else if x < 0 {
        if y > 0 {
            return "Quadrant II"
        } else if y < 0 {
            return "Quadrant III"
        } else {
            return "Negative X axis"
        }
    } else {
        if y > 0 {
            return "Positive Y axis"
        } else if y < 0 {
            return "Negative Y axis"
        } else {
            return "Origin"
        }
    }
}

func main() {
    fmt.Println(classify(1, 1))    // Quadrant I
    fmt.Println(classify(-1, -1))  // Quadrant III
    fmt.Println(classify(0, 0))    // Origin
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | `if` statement with init form and braces-required design established |
| Go 1.18    | No changes to `if` statement semantics |
| Go 1.22    | No changes to `if` statement semantics |

**Note:** The `if` statement specification has been completely stable since Go 1.0.

---

## 9. Implementation-Specific Behavior

### 9.1 Branch Prediction

The gc compiler generates standard branch instructions. Go 1.20+ may use `//go:noinline`, `//go:nosplit`, and profile-guided optimization (PGO) to improve branch prediction in hot code paths.

### 9.2 Inlining and Dead Code Elimination

If the condition in an `if` statement is a compile-time constant, the gc compiler eliminates the dead branch entirely.

```go
package main

import "fmt"

const debug = false

func main() {
    if debug {
        fmt.Println("debug message") // eliminated at compile time
    }
    fmt.Println("always runs")
}
```

### 9.3 Escape Analysis

Variables declared in the `if` init statement are subject to escape analysis. If they don't escape the block, they may be stack-allocated.

---

## 10. Spec Compliance Checklist

- [ ] Condition expression must be of type `bool`
- [ ] Curly braces are mandatory for all branches (no brace-free bodies)
- [ ] Optional init statement runs exactly once before condition evaluation
- [ ] Variables in init statement are scoped to the entire `if` statement
- [ ] `else` must appear on the same line as the closing brace
- [ ] `else if` chains are valid (else clause can be another `if` statement)
- [ ] Condition is evaluated exactly once per `if` statement execution
- [ ] `&&` and `||` use short-circuit evaluation
- [ ] `if` is a statement, not an expression (cannot be used as a value)
- [ ] No parentheses required around condition (allowed but unconventional)
- [ ] No implicit truthiness (integers, pointers, etc. must be explicitly compared)

---

## 11. Official Examples

### Example 1: Basic If

```go
package main

import "fmt"

func main() {
    if 7%2 == 0 {
        fmt.Println("7 is even")
    } else {
        fmt.Println("7 is odd")
    }

    if 8%4 == 0 {
        fmt.Println("8 is divisible by 4")
    }

    if num := 9; num < 0 {
        fmt.Println(num, "is negative")
    } else if num < 10 {
        fmt.Println(num, "has 1 digit")
    } else {
        fmt.Println(num, "has multiple digits")
    }
}
```

### Example 2: Error Handling Pattern

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    if n, err := strconv.Atoi("123"); err == nil {
        fmt.Println("converted:", n)
    } else {
        fmt.Println("error:", err)
    }
}
```

### Example 3: Guard Clause Pattern

```go
package main

import (
    "errors"
    "fmt"
)

func sqrt(x float64) (float64, error) {
    if x < 0 {
        return 0, errors.New("cannot take sqrt of negative number")
    }
    // proceed with computation
    result := x // simplified
    return result, nil
}

func main() {
    if v, err := sqrt(4.0); err != nil {
        fmt.Println("error:", err)
    } else {
        fmt.Println("sqrt:", v)
    }

    if _, err := sqrt(-1); err != nil {
        fmt.Println("error:", err)
    }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| If statements | https://go.dev/ref/spec#If_statements | Primary specification |
| For statements | https://go.dev/ref/spec#For_statements | Also uses init statement pattern |
| Switch statements | https://go.dev/ref/spec#Switch_statements | Alternative to if-else chains |
| Block | https://go.dev/ref/spec#Block | Body of if is always a block |
| Short variable declarations | https://go.dev/ref/spec#Short_variable_declarations | `:=` in init statement |
| Scope | https://go.dev/ref/spec#Declarations_and_scope | Scope of init-statement variables |
| Expressions | https://go.dev/ref/spec#Expressions | Boolean condition evaluation |
| Logical operators | https://go.dev/ref/spec#Logical_operators | `&&`, `||` short-circuit evaluation |
