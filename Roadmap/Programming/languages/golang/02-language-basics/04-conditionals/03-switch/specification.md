# Go Specification: Switch Statements

**Source:** https://go.dev/ref/spec#Switch_statements
**Section:** Statements → Switch statements

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec |
| **Primary Section** | [Switch statements](https://go.dev/ref/spec#Switch_statements) |
| **Related Section** | [Expression switches](https://go.dev/ref/spec#Expression_switches) |
| **Related Section** | [Type switches](https://go.dev/ref/spec#Type_switches) |
| **Related Section** | [Fallthrough statements](https://go.dev/ref/spec#Fallthrough_statements) |
| **Related Section** | [Comparison operators](https://go.dev/ref/spec#Comparison_operators) |
| **Related Section** | [Type assertions](https://go.dev/ref/spec#Type_assertions) |
| **Go Version** | Go 1.0+ (stable since initial release) |

Official definition from the spec:

> "'Switch' statements provide multi-way execution. An expression or type is compared to the 'cases' inside the 'switch' to determine which branch to execute."

Go provides two forms of switch:
1. **Expression switches** — compare a value against a list of possible matches.
2. **Type switches** — compare the type of an interface value against a list of types.

---

## 2. Formal Grammar (EBNF)

### 2.1 Switch Statement (top-level)

```ebnf
SwitchStmt = ExprSwitchStmt | TypeSwitchStmt .
```

### 2.2 Expression Switch

```ebnf
ExprSwitchStmt = "switch" [ SimpleStmt ";" ] [ Expression ] "{" { ExprCaseClause } "}" .
ExprCaseClause = ExprSwitchCase ":" StatementList .
ExprSwitchCase = "case" ExpressionList | "default" .

ExpressionList = Expression { "," Expression } .
```

Key structural observations:
- The `Expression` after `switch` is **optional**. If omitted, it defaults to `true`.
- Each `case` can list **multiple expressions** separated by commas.
- At most one `default` clause is permitted.
- The `SimpleStmt` init statement (same as in `if`) is optional.

### 2.3 Type Switch

```ebnf
TypeSwitchStmt  = "switch" [ SimpleStmt ";" ] TypeSwitchGuard "{" { TypeCaseClause } "}" .
TypeSwitchGuard = [ identifier ":=" ] PrimaryExpr "." "(" "type" ")" .
TypeCaseClause  = TypeSwitchCase ":" StatementList .
TypeSwitchCase  = "case" TypeList | "default" .
TypeList        = Type { "," Type } .
```

Key structural observations:
- The `TypeSwitchGuard` must use a **type assertion** of the form `x.(type)`.
- The optional `identifier :=` captures the asserted value with the matched concrete type.
- Each `case` can list **multiple types** separated by commas.
- The `x.(type)` syntax is only valid inside a `switch` statement; it cannot be used standalone.

### 2.4 Supporting Productions

```ebnf
SimpleStmt = ExpressionStmt | SendStmt | IncDecStmt | Assignment |
             ShortVarDecl | EmptyStmt .
Block      = "{" StatementList "}" .
```

---

## 3. Core Rules & Constraints

### 3.1 No Automatic Fallthrough (Unlike C/Java)

In Go, execution does **not** fall through from one case to the next by default. Once a matching case body executes, control leaves the switch. This is a deliberate departure from C, C++, and Java where `break` is needed to prevent fallthrough.

```go
package main

import "fmt"

func main() {
    x := 2

    // In C you would need "break" after each case.
    // In Go, each case implicitly breaks.
    switch x {
    case 1:
        fmt.Println("one")
    case 2:
        fmt.Println("two")   // only this prints
    case 3:
        fmt.Println("three") // NOT reached
    }
}
```

### 3.2 Cases Do Not Need to Be Constants

Unlike C/Java switch statements, Go expression switch cases can be **any expression** (not just compile-time constants). The case expressions are evaluated left to right, top to bottom, and the first match wins.

```go
package main

import (
    "fmt"
    "math/rand"
)

func main() {
    a := 5
    b := rand.Intn(10)

    switch a {
    case b:
        fmt.Println("a equals random b")
    case b + 1:
        fmt.Println("a equals b+1")
    default:
        fmt.Println("no match")
    }
}
```

### 3.3 Multiple Expressions Per Case (Comma-Separated)

A single `case` clause can list multiple expressions separated by commas. The case matches if **any** of the expressions equals the switch expression.

```go
package main

import "fmt"

func isWeekend(day string) bool {
    switch day {
    case "Saturday", "Sunday":
        return true
    default:
        return false
    }
}

func main() {
    fmt.Println(isWeekend("Saturday")) // true
    fmt.Println(isWeekend("Monday"))   // false
}
```

### 3.4 Switch with No Condition Equals `switch true`

When the switch expression is omitted, it defaults to `true`. This makes `switch` act as a clean alternative to if-else if-else chains.

```go
package main

import "fmt"

func classify(n int) string {
    switch {
    case n < 0:
        return "negative"
    case n == 0:
        return "zero"
    case n < 100:
        return "small positive"
    default:
        return "large positive"
    }
}

func main() {
    fmt.Println(classify(-5))   // negative
    fmt.Println(classify(0))    // zero
    fmt.Println(classify(42))   // small positive
    fmt.Println(classify(999))  // large positive
}
```

### 3.5 Type Switch Syntax and Rules

A type switch compares types rather than values. The special form `x.(type)` can only appear inside a `switch` statement.

```go
package main

import "fmt"

func describe(i interface{}) string {
    switch v := i.(type) {
    case int:
        return fmt.Sprintf("integer: %d", v)
    case string:
        return fmt.Sprintf("string: %q", v)
    case bool:
        return fmt.Sprintf("boolean: %t", v)
    default:
        return fmt.Sprintf("other: %T", v)
    }
}

func main() {
    fmt.Println(describe(42))
    fmt.Println(describe("hello"))
    fmt.Println(describe(true))
    fmt.Println(describe(3.14))
}
```

Rules for type switches:
- The guard expression must be a type assertion on an **interface** type.
- The variable `v` in `v := i.(type)` takes the concrete type of the matched case.
- If a case lists multiple types, `v` has the type of the interface (not a specific concrete type).
- `fallthrough` is **not allowed** in type switch statements.

### 3.6 The `fallthrough` Keyword — Behavior and Restrictions

The `fallthrough` statement transfers control to the first statement of the **next** case clause. It must be the **last statement** in a case clause and cannot appear in the last clause of a switch.

```go
package main

import "fmt"

func main() {
    v := 1

    switch v {
    case 1:
        fmt.Println("one")
        fallthrough
    case 2:
        fmt.Println("two (via fallthrough or direct match)")
        fallthrough
    case 3:
        fmt.Println("three (via fallthrough or direct match)")
    }
    // Output:
    // one
    // two (via fallthrough or direct match)
    // three (via fallthrough or direct match)
}
```

**Restrictions on `fallthrough`:**
- Must be the **last statement** in a case clause (nothing can follow it).
- Cannot appear in the **last case** of a switch (there is no next clause to fall into).
- Is **not allowed** in type switch statements.
- Transfers control **unconditionally** — the next case's condition is **not** re-evaluated.

```go
package main

import "fmt"

func main() {
    x := 1

    switch x {
    case 1:
        fmt.Println("one")
        fallthrough
    case 99:
        // This executes even though x != 99, because fallthrough
        // transfers control unconditionally.
        fmt.Println("ninety-nine (unconditional)")
    }
    // Output:
    // one
    // ninety-nine (unconditional)
}
```

### 3.7 Init Statement in Switch

Like the `if` statement, a `switch` can have an optional init statement separated by a semicolon. Variables declared in the init statement are scoped to the entire switch block.

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    switch env := os.Getenv("GO_ENV"); env {
    case "production":
        fmt.Println("Running in production")
    case "staging":
        fmt.Println("Running in staging")
    default:
        fmt.Printf("Running in: %s\n", env)
    }
    // env is not accessible here
}
```

---

## 4. Type Rules

### 4.1 Expression Switch — Comparability and Assignability

In an expression switch, each case expression must be **comparable** to the switch expression using `==`. If the switch expression has an explicit type, each case expression must be **assignable** to that type. If the switch expression is untyped (e.g., an untyped constant), it is first implicitly converted to its default type.

```go
package main

import "fmt"

type Weekday int

const (
    Monday Weekday = iota
    Tuesday
    Wednesday
)

func main() {
    day := Wednesday

    switch day {
    case Monday:
        fmt.Println("Monday")
    case Tuesday:
        fmt.Println("Tuesday")
    case Wednesday:
        fmt.Println("Wednesday")
    }
}
```

**What is not allowed:**

```go
// Slices, maps, and functions are not comparable with ==
// so they cannot be used as switch expressions or case values.

// switch []int{1, 2} { }           // compile error: slice can only be compared to nil
// switch map[string]int{} { }      // compile error: map can only be compared to nil
```

### 4.2 Untyped Constants in Cases

Untyped constants in case expressions are implicitly converted to the type of the switch expression.

```go
package main

import "fmt"

func main() {
    var x int64 = 42

    switch x {
    case 42:    // untyped constant 42 is converted to int64
        fmt.Println("matched 42")
    case 100:   // untyped constant 100 is converted to int64
        fmt.Println("matched 100")
    }
}
```

### 4.3 Type Switch — Variable Typing

In a type switch with `v := x.(type)`:
- In each **single-type** case, `v` has the concrete type listed in that case.
- In each **multi-type** case (comma-separated), `v` has the static type of the interface `x`.
- In the `default` case, `v` has the static type of `x`.

```go
package main

import "fmt"

func inspect(i interface{}) {
    switch v := i.(type) {
    case int:
        // v is of type int here
        fmt.Printf("int: %d (doubled: %d)\n", v, v*2)
    case string:
        // v is of type string here
        fmt.Printf("string: %q (length: %d)\n", v, len(v))
    case int, float64:
        // v is of type interface{} here (multi-type case)
        fmt.Printf("numeric: %v\n", v)
    default:
        // v is of type interface{} here
        fmt.Printf("unknown type: %T\n", v)
    }
}

func main() {
    inspect(42)
    inspect("hello")
    inspect(3.14)
    inspect(true)
}
```

### 4.4 Interface Satisfaction in Type Switch

A type switch case matches if the concrete type of the interface value implements the listed interface or is identical to the listed concrete type.

```go
package main

import "fmt"

type Stringer interface {
    String() string
}

type Animal struct {
    Name string
}

func (a Animal) String() string {
    return a.Name
}

func printValue(i interface{}) {
    switch v := i.(type) {
    case Stringer:
        fmt.Println("Stringer:", v.String())
    case int:
        fmt.Println("int:", v)
    default:
        fmt.Printf("other: %T\n", v)
    }
}

func main() {
    printValue(Animal{Name: "Cat"})  // Stringer: Cat
    printValue(42)                    // int: 42
    printValue(3.14)                  // other: float64
}
```

### 4.5 nil Case in Type Switch

A type switch can include a `nil` case to match when the interface value itself is `nil`.

```go
package main

import "fmt"

func check(i interface{}) {
    switch i.(type) {
    case nil:
        fmt.Println("nil value")
    case int:
        fmt.Println("int value")
    default:
        fmt.Println("other value")
    }
}

func main() {
    check(nil)  // nil value
    check(42)   // int value
}
```

---

## 5. Behavioral Specification

### 5.1 Top-to-Bottom, Left-to-Right Evaluation

In an expression switch, case expressions are evaluated **top to bottom** and, within a single case clause, **left to right**. Evaluation stops as soon as a matching expression is found.

```go
package main

import "fmt"

func eval(label string, val int) int {
    fmt.Printf("  evaluating %s (%d)\n", label, val)
    return val
}

func main() {
    fmt.Println("switch begins:")
    switch eval("switch-expr", 2) {
    case eval("A", 1), eval("B", 2):
        fmt.Println("matched case A/B")
    case eval("C", 3):
        fmt.Println("matched case C")
    }
    // Output:
    //   evaluating switch-expr (2)
    //   evaluating A (1)
    //   evaluating B (2)
    //   matched case A/B
    // Note: C is never evaluated because B matched.
}
```

### 5.2 First Match Wins

If multiple cases could match (because cases are not required to be unique in expression switches), only the **first** matching case executes.

```go
package main

import "fmt"

func main() {
    x := 5

    switch {
    case x > 0:
        fmt.Println("positive")     // this one wins
    case x > 3:
        fmt.Println("greater than 3") // never reached, even though true
    case x == 5:
        fmt.Println("exactly five")   // never reached, even though true
    }
}
```

### 5.3 The `default` Clause

The `default` clause executes if no other case matches. It can appear **anywhere** in the switch body (not necessarily last), but by convention it is placed last.

```go
package main

import "fmt"

func statusText(code int) string {
    switch code {
    case 200:
        return "OK"
    case 404:
        return "Not Found"
    case 500:
        return "Internal Server Error"
    default:
        return "Unknown Status"
    }
}

func main() {
    fmt.Println(statusText(200))  // OK
    fmt.Println(statusText(404))  // Not Found
    fmt.Println(statusText(418))  // Unknown Status
}
```

**Default in a non-last position (valid but unusual):**

```go
package main

import "fmt"

func main() {
    x := 42

    switch x {
    default:
        fmt.Println("default reached")
    case 1:
        fmt.Println("one")
    case 2:
        fmt.Println("two")
    }
    // Output: default reached
    // The default is still only matched if no case matches.
    // Position does not change semantics.
}
```

### 5.4 Compile-Time vs Run-Time Evaluation

- **Case expressions** in expression switches are evaluated at **run time** (they do not need to be constants).
- The **compiler** may optimize cases that are compile-time constants into jump tables.
- In a **type switch**, matching is performed at run time via the interface's type descriptor.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    // Run-time case expressions
    now := time.Now()
    switch {
    case now.Hour() < 12:
        fmt.Println("Good morning")
    case now.Hour() < 18:
        fmt.Println("Good afternoon")
    default:
        fmt.Println("Good evening")
    }
}
```

### 5.5 Switch with No Cases

A switch with no case clauses is syntactically valid. The body is empty and nothing happens.

```go
package main

func main() {
    switch 42 {
    }
    // Valid. Nothing happens.
}
```

### 5.6 Break in Switch

A `break` statement inside a switch terminates execution of the innermost switch (or for/select). This is rarely needed because cases do not fall through, but it is useful for early exit from a case body.

```go
package main

import "fmt"

func main() {
    x := 3

    switch x {
    case 3:
        if x%2 != 0 {
            fmt.Println("odd, breaking early")
            break
        }
        fmt.Println("this would only run if x were even")
    }
    fmt.Println("after switch")
}
```

### 5.7 Labeled Break with Switch Inside a Loop

When a switch is inside a loop, `break` breaks out of the switch, not the loop. To break the loop, use a **labeled break**.

```go
package main

import "fmt"

func main() {
loop:
    for i := 0; i < 10; i++ {
        switch i {
        case 5:
            fmt.Println("breaking loop at 5")
            break loop // breaks the for loop, not just the switch
        default:
            fmt.Println(i)
        }
    }
    fmt.Println("done")
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Duplicate Case Expressions Are Allowed (Expression Switch)

The Go spec does **not** forbid duplicate constant case expressions in expression switches at the language level. However, the compiler issues a **warning/error** for duplicate constant cases because only the first would ever match, making the second dead code.

```go
package main

import "fmt"

func main() {
    x := 1

    // The gc compiler rejects duplicate constant cases:
    // switch x {
    // case 1:
    //     fmt.Println("first")
    // case 1:                    // compile error: duplicate case 1 in switch
    //     fmt.Println("second")
    // }

    // Non-constant duplicates are allowed (compiler cannot detect):
    a, b := 1, 1
    switch x {
    case a:
        fmt.Println("matched a") // this runs
    case b:
        fmt.Println("matched b") // unreachable, but compiles
    }
}
```

### 6.2 Defined: `fallthrough` Not Allowed in Type Switch

The spec explicitly states that `fallthrough` is not permitted in type switch statements. This is a compile-time error.

```go
// INVALID: fallthrough in type switch
//
// func invalid(i interface{}) {
//     switch i.(type) {
//     case int:
//         fmt.Println("int")
//         fallthrough          // compile error: cannot fallthrough in type switch
//     case string:
//         fmt.Println("string")
//     }
// }
```

### 6.3 Defined: At Most One `default` Clause

A switch statement may contain at most one `default` clause. Multiple `default` clauses cause a compile error.

```go
// INVALID: multiple defaults
//
// switch x {
// case 1:
//     fmt.Println("one")
// default:
//     fmt.Println("first default")
// default:                        // compile error: multiple defaults in switch
//     fmt.Println("second default")
// }
```

### 6.4 Defined: Empty Switch Body

A switch statement with no case clauses is valid. It is a no-op.

### 6.5 Defined: Case Order Does Not Affect `default`

The `default` case only runs if no other case matches, regardless of where it appears in the switch body. Its position is a style choice, not a semantic one.

---

## 7. Edge Cases from Spec

### 7.1 Empty Case Body

A case clause can have an empty body. This is a valid no-op when matched.

```go
package main

import "fmt"

func main() {
    x := 2

    switch x {
    case 1:
        // intentionally empty: skip processing for 1
    case 2:
        fmt.Println("two")
    case 3:
        // intentionally empty: skip processing for 3
    }
}
```

Note: An empty case is **not** the same as fallthrough. The case matches, does nothing, and control exits the switch.

### 7.2 `fallthrough` to `default`

The `fallthrough` keyword can transfer control into the `default` clause if it is the next clause.

```go
package main

import "fmt"

func main() {
    x := 1

    switch x {
    case 1:
        fmt.Println("one")
        fallthrough
    default:
        fmt.Println("default (reached via fallthrough)")
    }
    // Output:
    // one
    // default (reached via fallthrough)
}
```

### 7.3 Switch on `interface{}`

Switching on an `interface{}` value uses `==` comparison. The concrete type must be comparable.

```go
package main

import "fmt"

func match(v interface{}) {
    switch v {
    case 42:
        fmt.Println("forty-two")
    case "hello":
        fmt.Println("greeting")
    case nil:
        fmt.Println("nil")
    default:
        fmt.Printf("other: %v (%T)\n", v, v)
    }
}

func main() {
    match(42)      // forty-two
    match("hello") // greeting
    match(nil)     // nil
    match(3.14)    // other: 3.14 (float64)
}
```

**Caution:** If the interface holds a non-comparable type (e.g., a slice), a runtime panic occurs when comparing:

```go
// This would panic at runtime:
// var v interface{} = []int{1, 2, 3}
// switch v {
// case []int{1, 2, 3}:  // compile error: slice can only be compared to nil
// }
```

### 7.4 Type Switch with Multiple Types Per Case

When a type switch case lists multiple types, the captured variable has the **interface type** (not a specific concrete type).

```go
package main

import "fmt"

func describe(i interface{}) {
    switch v := i.(type) {
    case int, int64:
        // v is interface{} here, NOT int or int64
        fmt.Printf("some integer: %v (type in case: interface{})\n", v)
    case string:
        // v is string here
        fmt.Printf("string: %s (len=%d)\n", v, len(v))
    default:
        fmt.Printf("other: %T\n", v)
    }
}

func main() {
    describe(42)
    describe(int64(100))
    describe("hello")
}
```

### 7.5 Type Switch Without Variable Capture

The `identifier :=` part is optional. You can use a type switch purely for branching without capturing the typed value.

```go
package main

import "fmt"

func kindOf(i interface{}) string {
    switch i.(type) {
    case int:
        return "int"
    case string:
        return "string"
    case bool:
        return "bool"
    default:
        return "unknown"
    }
}

func main() {
    fmt.Println(kindOf(1))       // int
    fmt.Println(kindOf("hi"))    // string
    fmt.Println(kindOf(true))    // bool
    fmt.Println(kindOf(3.14))    // unknown
}
```

### 7.6 Switch with Init Statement and No Expression

You can combine an init statement with an omitted expression (defaulting to `true`).

```go
package main

import "fmt"

func main() {
    switch x := 15; {
    case x < 10:
        fmt.Println("small")
    case x < 20:
        fmt.Println("medium")
    default:
        fmt.Println("large")
    }
    // Output: medium
}
```

### 7.7 `fallthrough` Must Be the Last Statement

`fallthrough` must be the final statement in a case. Placing any statement after it is a compile error.

```go
// INVALID:
// switch x {
// case 1:
//     fallthrough
//     fmt.Println("after fallthrough") // compile error: fallthrough statement out of place
// case 2:
//     fmt.Println("two")
// }
```

### 7.8 `fallthrough` Cannot Appear in the Last Case

`fallthrough` in the last case clause (or `default` if it is last) is a compile error because there is no next clause to transfer to.

```go
// INVALID:
// switch x {
// case 1:
//     fmt.Println("one")
// case 2:
//     fmt.Println("two")
//     fallthrough // compile error: cannot fallthrough final case in switch
// }
```

### 7.9 Scope of Type Switch Variable

The variable declared in a type switch guard is scoped to each case clause individually, with the appropriate type.

```go
package main

import "fmt"

func process(i interface{}) {
    switch v := i.(type) {
    case int:
        // v is int; can do integer operations
        fmt.Println("square:", v*v)
    case string:
        // v is string; can do string operations
        fmt.Println("upper:", v+"!")
    }
    // v is not accessible here
}

func main() {
    process(5)
    process("hello")
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 (2012) | Switch statements (expression and type) introduced with current semantics. No automatic fallthrough. `fallthrough` keyword available for expression switches only. |
| Go 1.1 | No changes to switch semantics. |
| Go 1.4 | Compiler improved diagnostics for duplicate constant cases. |
| Go 1.12 | Improved error messages for `fallthrough` misuse in type switches. |
| Go 1.18 | Generics introduced, but switch statements do not support type parameter constraints directly in type switches. |
| Go 1.20 | Profile-guided optimization (PGO) may affect branch layout of compiled switch statements. |
| Go 1.21 | No changes to switch semantics. |
| Go 1.22 | No changes to switch semantics. `range over int` added for loops, not switches. |

**Note:** The switch statement has been semantically stable since Go 1.0. Changes have been limited to compiler diagnostics and optimization, not language semantics.

---

## 9. Implementation-Specific Behavior

### 9.1 Jump Table Optimization

When all case values in an expression switch are **integer constants** and they form a dense range, the gc compiler may generate a **jump table** (indexed branch) rather than a sequence of comparisons. This provides O(1) dispatch instead of O(n) linear scanning.

```go
package main

import "fmt"

func dayName(d int) string {
    // Dense integer cases: compiler may use a jump table
    switch d {
    case 0:
        return "Sunday"
    case 1:
        return "Monday"
    case 2:
        return "Tuesday"
    case 3:
        return "Wednesday"
    case 4:
        return "Thursday"
    case 5:
        return "Friday"
    case 6:
        return "Saturday"
    default:
        return "Invalid"
    }
}

func main() {
    for i := 0; i <= 7; i++ {
        fmt.Printf("%d: %s\n", i, dayName(i))
    }
}
```

### 9.2 Linear Scan for Non-Constant Cases

When case expressions are not compile-time constants (e.g., variables, function calls), the compiler generates a **linear scan** — each case expression is evaluated and compared sequentially.

### 9.3 Binary Search for Sparse Constants

When case values are integer constants but **sparse** (widely separated values), the gc compiler may use a **binary search** strategy rather than a jump table to keep the generated code compact.

### 9.4 String Switch Optimization

For switches on string values, the gc compiler may first compare string **lengths** or compute a **hash** before performing full string comparisons, reducing the number of expensive string equality checks.

### 9.5 Dead Code Elimination

If the switch expression is a compile-time constant, the compiler eliminates all non-matching case branches from the generated binary.

```go
package main

import "fmt"

const mode = "release"

func main() {
    switch mode {
    case "debug":
        fmt.Println("debug logging enabled") // eliminated from binary
    case "release":
        fmt.Println("release mode")           // only this remains
    }
}
```

---

## 10. Spec Compliance Checklist

- [ ] Expression switch: each case expression must be comparable (`==`) to the switch expression
- [ ] Expression switch: case expressions are evaluated top-to-bottom, left-to-right
- [ ] Expression switch: first matching case wins; subsequent cases are not evaluated
- [ ] Expression switch: no automatic fallthrough between cases
- [ ] Expression switch: `fallthrough` transfers control unconditionally to the next case's body
- [ ] Expression switch: `fallthrough` must be the last statement in a case clause
- [ ] Expression switch: `fallthrough` cannot appear in the last case clause
- [ ] Expression switch: omitted switch expression defaults to `true`
- [ ] Expression switch: case expressions need not be constants
- [ ] Expression switch: multiple expressions per case are comma-separated (OR semantics)
- [ ] Type switch: guard must use `x.(type)` syntax on an interface value
- [ ] Type switch: `fallthrough` is not allowed
- [ ] Type switch: captured variable has the concrete type in single-type cases
- [ ] Type switch: captured variable has the interface type in multi-type cases
- [ ] Type switch: `nil` case matches a nil interface value
- [ ] Both forms: at most one `default` clause is allowed
- [ ] Both forms: `default` can appear at any position (convention: last)
- [ ] Both forms: optional init statement scopes variables to the switch block
- [ ] Both forms: `break` terminates the innermost switch statement
- [ ] Both forms: labeled `break` can break enclosing for/select from within a switch
- [ ] Duplicate constant case expressions cause a compile error

---

## 11. Official Examples

### Example 1: Expression Switch with Multiple Values

```go
package main

import "fmt"

func main() {
    tag := "go"

    switch tag {
    case "go":
        fmt.Println("Go!")
    case "rust", "c", "c++":
        fmt.Println("Systems language")
    case "python", "javascript":
        fmt.Println("Scripting language")
    default:
        fmt.Println("Unknown language")
    }
}
```

**Output:**
```
Go!
```

### Example 2: Tagless Switch (switch true)

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.Now()

    switch {
    case t.Hour() < 12:
        fmt.Println("Good morning!")
    case t.Hour() < 17:
        fmt.Println("Good afternoon.")
    default:
        fmt.Println("Good evening.")
    }
}
```

### Example 3: Type Switch — Comprehensive

```go
package main

import "fmt"

func do(i interface{}) {
    switch v := i.(type) {
    case int:
        fmt.Printf("Twice %v is %v\n", v, 2*v)
    case string:
        fmt.Printf("%q is %v bytes long\n", v, len(v))
    case bool:
        if v {
            fmt.Println("TRUE")
        } else {
            fmt.Println("FALSE")
        }
    case nil:
        fmt.Println("<nil>")
    default:
        fmt.Printf("I don't know about type %T!\n", v)
    }
}

func main() {
    do(21)
    do("hello")
    do(true)
    do(nil)
    do(3.14)
}
```

**Output:**
```
Twice 21 is 42
"hello" is 5 bytes long
TRUE
<nil>
I don't know about type float64!
```

### Example 4: Switch with Init Statement

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    switch os := runtime.GOOS; os {
    case "darwin":
        fmt.Println("macOS")
    case "linux":
        fmt.Println("Linux")
    case "windows":
        fmt.Println("Windows")
    default:
        fmt.Printf("Other OS: %s\n", os)
    }
}
```

### Example 5: Fallthrough Demonstration

```go
package main

import "fmt"

func main() {
    n := 3

    switch {
    case n > 0:
        fmt.Println("positive")
        fallthrough
    case n > -5:
        fmt.Println("greater than -5")
        fallthrough
    case n > -10:
        fmt.Println("greater than -10")
    }
    // Output:
    // positive
    // greater than -5
    // greater than -10
}
```

### Example 6: Type Switch with Interface Matching

```go
package main

import "fmt"

type Shape interface {
    Area() float64
}

type Circle struct {
    Radius float64
}

func (c Circle) Area() float64 {
    return 3.14159 * c.Radius * c.Radius
}

type Rectangle struct {
    Width, Height float64
}

func (r Rectangle) Area() float64 {
    return r.Width * r.Height
}

func describeShape(s Shape) {
    switch v := s.(type) {
    case Circle:
        fmt.Printf("Circle with radius %.1f, area = %.2f\n", v.Radius, v.Area())
    case Rectangle:
        fmt.Printf("Rectangle %gx%g, area = %.2f\n", v.Width, v.Height, v.Area())
    default:
        fmt.Printf("Unknown shape with area = %.2f\n", v.Area())
    }
}

func main() {
    shapes := []Shape{
        Circle{Radius: 5},
        Rectangle{Width: 3, Height: 4},
    }
    for _, s := range shapes {
        describeShape(s)
    }
}
```

**Output:**
```
Circle with radius 5.0, area = 78.54
Rectangle 3x4, area = 12.00
```

### Example 7: Valid vs Invalid Switch Patterns

```go
package main

import "fmt"

func main() {
    // --- VALID patterns ---

    // Multiple values in one case
    x := 3
    switch x {
    case 1, 2, 3:
        fmt.Println("one, two, or three")
    }

    // Empty case (no-op)
    switch x {
    case 1:
    case 2:
    case 3:
        fmt.Println("three")
    }

    // Switch on boolean expression
    switch x > 0 {
    case true:
        fmt.Println("positive")
    case false:
        fmt.Println("non-positive")
    }

    // --- INVALID patterns (compile errors) ---

    // Duplicate constant case:
    // switch x {
    // case 1:
    //     fmt.Println("first")
    // case 1:                   // compile error
    //     fmt.Println("second")
    // }

    // fallthrough in type switch:
    // var i interface{} = 42
    // switch i.(type) {
    // case int:
    //     fallthrough           // compile error
    // case string:
    // }

    // Multiple defaults:
    // switch x {
    // default:
    // default:                  // compile error
    // }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Switch statements | https://go.dev/ref/spec#Switch_statements | Primary specification for both switch forms |
| Expression switches | https://go.dev/ref/spec#Expression_switches | Detailed rules for value-based switching |
| Type switches | https://go.dev/ref/spec#Type_switches | Detailed rules for type-based switching |
| Fallthrough statements | https://go.dev/ref/spec#Fallthrough_statements | `fallthrough` keyword specification |
| If statements | https://go.dev/ref/spec#If_statements | Alternative conditional; shares init statement pattern |
| Select statements | https://go.dev/ref/spec#Select_statements | Similar syntax for channel operations |
| Type assertions | https://go.dev/ref/spec#Type_assertions | Foundation of type switch (`x.(type)`) |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | Rules for `==` used in case matching |
| Assignability | https://go.dev/ref/spec#Assignability | Case expressions must be assignable to switch type |
| Semicolons | https://go.dev/ref/spec#Semicolons | Automatic semicolons affect switch formatting |
| Declarations and scope | https://go.dev/ref/spec#Declarations_and_scope | Scoping of init statement and type switch variables |
| Break statements | https://go.dev/ref/spec#Break_statements | `break` behavior inside switch |
