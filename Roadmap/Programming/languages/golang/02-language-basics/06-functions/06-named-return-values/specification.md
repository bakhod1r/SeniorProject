# Go Specification: Named Return Values

**Source:** https://go.dev/ref/spec#Function_declarations
**Sections:** Function declarations (Result list with names), Return statements (naked return)

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Function_declarations |
| **Return statements** | https://go.dev/ref/spec#Return_statements |
| **Go Version** | Go 1.0+ |

Official text:

> "The result type may be either a single unnamed type or a parenthesized list of result parameters. Each named result parameter declares a variable that may be used in the function body. These variables, like the function's parameters, behave as ordinary variables but are initialized to the zero values for their types when the function begins."

> "A 'return' statement that specifies results sets the result parameters before any deferred functions are executed. The expressions may be omitted if the function's result type specifies names for its result parameters."

---

## 2. Formal Grammar (EBNF)

```ebnf
Result        = Parameters | Type .
Parameters    = "(" [ ParameterList [ "," ] ] ")" .
ParameterList = ParameterDecl { "," ParameterDecl } .
ParameterDecl = [ IdentifierList ] [ "..." ] Type .

ReturnStmt    = "return" [ ExpressionList ] .
```

When the parameter list has identifier(s), the result is **named**. A bare `return` (no expressions) is allowed when results are named.

**Forms at a glance:**

```go
// Unnamed (anonymous) results — explicit return required
func a() (int, error) { return 0, nil }

// Named results — naked return allowed
func b() (n int, err error) {
    n = 1
    err = nil
    return // naked: returns n, err
}

// Named results with explicit return values
func c() (n int, err error) {
    return 1, nil // explicit; equivalent to setting n=1, err=nil then returning
}

// Names with grouped types
func d() (a, b int) { return 1, 2 }

// Mix of named for groups
func e() (key string, value int, ok bool) { return "", 0, false }
```

---

## 3. Core Rules & Constraints

### 3.1 Named Results Are Local Variables

When a function has named results, they're declared as local variables at function entry, initialized to their zero values:

```go
package main

import "fmt"

func zero() (n int, s string, ok bool) {
    fmt.Println(n, s, ok) // 0 "" false — initialized to zero values
    return
}

func main() {
    fmt.Println(zero())
}
```

### 3.2 Naked Return

A `return` statement with no expressions returns the current values of the named results:

```go
func split(sum int) (x, y int) {
    x = sum * 4 / 9
    y = sum - x
    return // returns (x, y)
}

split(100) // (44, 56)
```

A naked return without named results is a compile error.

### 3.3 Explicit Return Overrides Named Values

A `return expr1, expr2` overrides whatever the named results currently hold:

```go
func explicit() (n int, err error) {
    n = 42      // assignment to named result
    return 100, nil // overrides; returns (100, nil)
}
```

### 3.4 Defer Can Modify Named Results

Deferred functions can read and modify named results AFTER the explicit return statement runs but BEFORE the function actually returns to the caller:

```go
package main

import (
    "errors"
    "fmt"
)

func work() (result int, err error) {
    defer func() {
        if err != nil {
            result = -1 // overwrite result on error
        }
    }()
    return 42, errors.New("oops")
}

func main() {
    fmt.Println(work()) // -1, oops
}
```

This is a powerful pattern for cleanup-error capture and panic-to-error conversion.

### 3.5 Result Names With Same Type Can Be Grouped

Like parameters:

```go
func bounds(s []int) (lo, hi int) { /* ... */ return 0, 0 }
func point() (x, y, z float64) { return 0, 0, 0 }
```

### 3.6 Naked Return Doesn't Require Assignment to All Named Results

Unassigned named results return their zero values:

```go
func partial(condition bool) (n int, err error) {
    if condition {
        n = 42
    }
    return // returns (42, nil) or (0, nil) depending on condition
}
```

### 3.7 Result Names Are Scoped to the Function

Named results are normal local variables; you can take their address, assign to them, etc.:

```go
func resultPtr() (n int) {
    p := &n
    *p = 42
    return // returns 42
}
```

### 3.8 Two Functions Cannot Have Identical Signatures Differing Only in Result Names

Result names don't affect type identity:

```go
type Op1 func() (n int)
type Op2 func() (m int)
// Op1 and Op2 are identical types
```

---

## 4. Type Rules

### 4.1 Named Result Types

Each named result has a single declared type, determined by the parameter list:

```go
func f() (a int, b string, c bool) {
    // a is int, b is string, c is bool
    return
}
```

### 4.2 Cannot Mix Named and Unnamed in Same Result List

```go
// func bad() (a int, string) {} // compile error: mixed named and unnamed parameters
```

All named or all unnamed.

### 4.3 Named Results With Generic Types

```go
func zeroOf[T any]() (v T) {
    return // returns the zero value of T
}

n := zeroOf[int]()    // 0
s := zeroOf[string]() // ""
```

The named result `v` of type `T` is initialized to `T`'s zero value at function entry.

---

## 5. Behavioral Specification

### 5.1 Initialization to Zero Values

Named results are initialized at function entry, before the first statement runs:

```go
func f() (n int, s string, p *int) {
    fmt.Println(n, s, p) // 0 "" <nil>
    return
}
```

### 5.2 Defer Order: Result Set, Then Defers, Then Return

When `return expr1, expr2` runs:
1. Result expressions are evaluated.
2. Named results are SET to those values.
3. Deferred functions run (in LIFO order). They can modify named results.
4. The function actually returns the (possibly modified) named results.

```go
func ordered() (result int) {
    defer func() {
        fmt.Println("defer sees:", result)
        result *= 2
    }()
    return 5 // result is set to 5; defer prints 5; defer sets result to 10; function returns 10
}
```

Output:
```
defer sees: 5
```
And the caller receives `10`.

### 5.3 Panic and Named Returns

If a panic occurs and is recovered in a deferred function, that deferred function can set named results to recover gracefully:

```go
func safe() (n int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
            n = -1
        }
    }()
    panic("boom")
}
```

This is the canonical pattern for converting panics to errors.

### 5.4 Multiple `return` Statements

A function may have multiple `return` statements; each can be naked or explicit:

```go
func multiReturn(x int) (n int, err error) {
    if x < 0 {
        err = errors.New("negative")
        return // naked
    }
    if x == 0 {
        return 0, errors.New("zero") // explicit
    }
    n = x
    return // naked
}
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Naked return with named results | Defined — returns current values |
| Naked return with unnamed results | Compile error |
| Named results read in defer | Defined — see post-explicit-return values |
| Named results written in defer | Defined — modifies what's returned |
| Named results uninitialized at return | Defined — return zero values |
| Mixing named and unnamed in same result list | Compile error |
| Two named results with same name | Compile error |
| Named result shadowed by local | Defined — local takes precedence in scope |

---

## 7. Edge Cases from Spec

### 7.1 Named Result Shadowed in Inner Scope

```go
func f() (n int) {
    {
        n := 99 // shadows the named result
        _ = n
    }
    return // returns 0 (the named result was never assigned)
}
```

### 7.2 Single Named Result Without Parens

Even a single named result requires parentheses:

```go
// func bad() result int { return 0 } // compile error
func ok() (result int) { return 0 }   // OK
```

### 7.3 Returning Different Number Than Declared

```go
func f() (a, b int) {
    return 1, 2, 3 // compile error: too many values to return
}
```

### 7.4 Named Result Unused

```go
func f() (n int) {
    return // returns 0; n is never explicitly used
}
```

This is allowed and idiomatic — sometimes you name results purely for documentation.

### 7.5 Named Result Read Before Assignment

```go
func f() (n int) {
    fmt.Println(n) // prints 0 (initialized)
    n = 42
    return
}
```

Always returns 42; the read at the start sees 0.

### 7.6 Nested Function Literal Captures Named Result

```go
func f() (n int) {
    helper := func() {
        n++ // captures and modifies n
    }
    helper()
    helper()
    return // returns 2
}
```

Named results are normal variables — closures can capture them.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Named returns + naked return |
| Go 1.14 | Open-coded defer; defers modifying named returns become near-zero-cost |
| Go 1.18 | Generic functions can have named returns |

---

## 9. Implementation-Specific Behavior

### 9.1 Storage of Named Results

Named results are stored in registers (for the first ~9 results) or on the caller's stack frame (for spillover). They're treated like any local variable for SSA purposes.

For functions with both named and unnamed result lists in the same call, this doesn't apply (mixing is illegal).

### 9.2 Naked Return Generates Same Code as Explicit Return

```go
func a() (n int) { n = 5; return }
func b() (n int) { n = 5; return n }
```

Both compile to the same SSA: set the result register to 5, return. Naked return is purely sugar.

### 9.3 Open-Coded Defer With Named Returns

When defer is open-coded (Go 1.14+), the deferred function modifying named results is essentially free — the modification is inlined into each return path. This is what makes `defer + named return` patterns viable in performance-sensitive code.

---

## 10. Spec Compliance Checklist

- [ ] Named results in parentheses
- [ ] Same name not declared twice
- [ ] No mixing of named and unnamed in same result list
- [ ] Naked return only with named results
- [ ] All paths terminate (named or explicit)
- [ ] Defers reading/modifying named results account for post-return semantics
- [ ] Documentation reflects what each named result represents

---

## 11. Official Examples

### Example 1: Idiomatic Naked Return

```go
package main

import "fmt"

func split(sum int) (x, y int) {
    x = sum * 4 / 9
    y = sum - x
    return
}

func main() {
    fmt.Println(split(100)) // 44 56
}
```

### Example 2: Defer Modifying Named Result

```go
package main

import (
    "errors"
    "fmt"
)

func work() (result int, err error) {
    defer func() {
        if err != nil {
            result = -1
        }
    }()
    return 42, errors.New("oops")
}

func main() {
    fmt.Println(work()) // -1 oops
}
```

### Example 3: Panic-to-Error With Named Returns

```go
package main

import "fmt"

func safe() (n int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    panic("boom")
}

func main() {
    n, err := safe()
    fmt.Println(n, err) // 0 recovered: boom
}
```

### Example 4: Cleanup Error Capture

```go
package main

import (
    "fmt"
    "os"
)

func processFile(path string) (count int, err error) {
    f, err := os.Open(path)
    if err != nil { return 0, err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr // capture close error if no other
        }
    }()
    // ... read and count ...
    return count, nil
}

func main() {
    n, err := processFile("/etc/hosts")
    fmt.Println(n, err)
}
```

### Example 5: Invalid Constructs

```go
// 1. Naked return without named results:
// func bad() int { return } // ERROR

// 2. Mixed named and unnamed:
// func bad() (n int, string) { return 0, "" } // ERROR

// 3. Result type without parens for single named:
// func bad() result int { return 0 } // ERROR
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Function declarations | https://go.dev/ref/spec#Function_declarations | Result list grammar |
| Return statements | https://go.dev/ref/spec#Return_statements | Naked vs explicit |
| Defer statements | https://go.dev/ref/spec#Defer_statements | Defer + named results |
| Variable declarations | https://go.dev/ref/spec#Variable_declarations | Named results as local variables |
| Handling panics | https://go.dev/ref/spec#Handling_panics | Recover + named return for panic-to-error |
