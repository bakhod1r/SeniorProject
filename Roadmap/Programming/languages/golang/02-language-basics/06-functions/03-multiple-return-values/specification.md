# Go Specification: Multiple Return Values

**Source:** https://go.dev/ref/spec#Function_types
**Sections:** Function declarations (Result), Return statements, Assignments

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Function_declarations |
| **Return statements** | https://go.dev/ref/spec#Return_statements |
| **Assignments** | https://go.dev/ref/spec#Assignments |
| **Go Version** | Go 1.0+ |

Official text:

> "The return value or values may be explicitly listed in the 'return' statement. Each expression must be single-valued and assignable to the corresponding element of the function's result type."

> "The expression list may be empty if the function's result type specifies names for its result parameters. The result parameters act as ordinary local variables and the function may assign values to them as necessary."

---

## 2. Formal Grammar (EBNF)

```ebnf
Result        = Parameters | Type .
Parameters    = "(" [ ParameterList [ "," ] ] ")" .
ReturnStmt    = "return" [ ExpressionList ] .
ExpressionList = Expression { "," Expression } .
```

Where:
- A function may declare **multiple** result types by listing them in parentheses.
- A `return` with values requires one expression per result, in order.
- A bare `return` is allowed only when results are **named** (or when there are no results).

**Forms at a glance:**

```go
func a() (int, string)              { return 0, "" }
func b() (n int, s string)          { n = 0; s = ""; return }   // naked return
func c() (int, error)               { return 0, nil }            // (value, error) idiom
func d() (a, b, c int)              { return 1, 2, 3 }
func e() (key string, value int, ok bool) { return "", 0, false }
```

---

## 3. Core Rules & Constraints

### 3.1 Multiple Results Require Parentheses
```go
package main

import "fmt"

func single() int          { return 1 }       // no parens
func multi() (int, string) { return 1, "ok" } // parens required
// func bad() int, string  { return 1, "" }   // compile error

func main() {
    fmt.Println(single())
    fmt.Println(multi())
}
```

### 3.2 Each Result Has a Type Position
Result types are listed in declaration order:

```go
func divmod(a, b int) (int, int) {
    return a / b, a % b
}
```

The first returned value has the first declared type; the second has the second; etc.

### 3.3 Multi-Value Assignment at the Call Site
The caller must accept all results (or use `_` to discard):

```go
package main

import "fmt"

func divmod(a, b int) (int, int) { return a / b, a % b }

func main() {
    q, r := divmod(17, 5)
    fmt.Println(q, r)        // 3 2

    onlyQ, _ := divmod(17, 5)
    fmt.Println(onlyQ)        // 3

    // q := divmod(17, 5)     // compile error: multiple-value divmod()
}
```

### 3.4 The `(value, error)` Idiom
The most common multi-result pattern in Go:

```go
package main

import (
    "fmt"
    "strconv"
)

func parse(s string) (int, error) {
    return strconv.Atoi(s)
}

func main() {
    n, err := parse("42")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println(n)
}
```

The convention: the meaningful value comes first, the error last. `err == nil` indicates success.

### 3.5 The `comma-ok` Idiom
A two-result pattern where the second result is a `bool`:

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1, "b": 2}
    v, ok := m["a"]
    fmt.Println(v, ok) // 1 true
    v, ok = m["x"]
    fmt.Println(v, ok) // 0 false (zero value of int + ok=false)

    // Type assertion comma-ok:
    var x any = "hello"
    s, ok := x.(string)
    fmt.Println(s, ok) // hello true

    // Channel comma-ok:
    ch := make(chan int, 1)
    ch <- 7
    close(ch)
    val, ok := <-ch
    fmt.Println(val, ok) // 7 true
    val, ok = <-ch
    fmt.Println(val, ok) // 0 false (channel closed and empty)
}
```

### 3.6 Named Return Values
Result parameters may be named. Named results are initialized to their zero values at function entry and act as local variables:

```go
package main

import "fmt"

func split(sum int) (x, y int) {
    x = sum * 4 / 9
    y = sum - x
    return // naked: returns x and y
}

func main() {
    fmt.Println(split(100)) // 44 56
}
```

(Detailed treatment in 2.6.6.)

### 3.7 The Blank Identifier Discards a Result
```go
package main

import "fmt"

func main() {
    n, _ := divmod(17, 5)
    fmt.Println(n) // discards the remainder
}

func divmod(a, b int) (int, int) { return a / b, a % b }
```

You CANNOT discard ALL results from a multi-result call by simply not assigning — you must assign every result or use `_` for each. Or call as a statement (no assignment at all):

```go
divmod(17, 5)  // ALL results discarded
```

### 3.8 Multi-Result Functions Are Not "Tuple Values"
Multi-result functions cannot be used as a tuple value. They are only valid in:
1. Multi-assignment: `a, b := f()`
2. As the sole argument to another function whose parameter list matches: `g(f())`
3. Discarded entirely as a statement: `f()`

```go
package main

func f() (int, int) { return 1, 2 }
func g(a, b int) int { return a + b }
func h(a int) int    { return a }

func main() {
    _ = g(f()) // OK — f's two results match g's two params
    // _ = h(f())             // compile error
    // _ = []int{f()}         // compile error
    // _ = f() + 1            // compile error
}
```

### 3.9 Cannot Mix Multi-Result with Other Args
The "multi-result as args" form requires the multi-result to be the **only** argument:

```go
package main

func f() (int, int)   { return 1, 2 }
func g(a, b, c int) int { return a + b + c }

func main() {
    // _ = g(f(), 3) // compile error: multiple-value f() in single-value context
    a, b := f()
    _ = g(a, b, 3) // OK
}
```

---

## 4. Type Rules

### 4.1 Result Type Position Is Strict
Each result expression must be assignable to the corresponding result type:

```go
func fail() (int, string) {
    return "wrong", 0 // compile error: cannot use "wrong" (string) as int
}
```

### 4.2 Type Inference With `:=`
`:=` infers each variable's type from the corresponding result:

```go
func f() (int, string) { return 1, "hi" }

a, b := f() // a is int, b is string
```

### 4.3 Mixing `:=` With Existing Variables
At least one variable on the left side must be new for `:=` to be valid. Existing variables are reassigned (with type compatibility check):

```go
package main

import "fmt"

func parse(s string) (int, error) { return 0, nil }

func main() {
    n, err := parse("1") // both new
    n, err = parse("2")  // both existing — use =
    
    var m int
    m, err := parse("3") // err exists; m is new — := allowed if any LHS is new
    fmt.Println(n, m, err)
}
```

### 4.4 Multi-Result Cannot Be Wrapped in `any`
A multi-result function cannot be passed to a single `any` parameter:

```go
func f() (int, error) { return 0, nil }
// var x any = f() // compile error: multiple-value f() in single-value context
```

You must accept the results separately first.

---

## 5. Behavioral Specification

### 5.1 Evaluation Order of Result Expressions
The expressions in a `return` statement are evaluated **left to right**:

```go
package main

import "fmt"

func eval(label string, v int) int {
    fmt.Println("eval", label)
    return v
}

func two() (int, int) {
    return eval("a", 1), eval("b", 2)
}

func main() {
    x, y := two()
    fmt.Println("got", x, y)
    // Output:
    // eval a
    // eval b
    // got 1 2
}
```

### 5.2 Multi-Assignment Is Atomic
The right side is fully evaluated before any assignment to the left side. This is what makes the swap idiom work with multi-result returns:

```go
package main

import "fmt"

func swap(a, b int) (int, int) { return b, a }

func main() {
    x, y := 1, 2
    x, y = swap(x, y)
    fmt.Println(x, y) // 2 1
}
```

### 5.3 Naked Return Uses Named Results
```go
func split(sum int) (x, y int) {
    x = sum / 2
    y = sum - x
    return // returns x, y
}
```

A naked return without naming results is a compile error. (See 2.6.6.)

### 5.4 Returning Without a Result List
A function with no results may have `return` without expressions:

```go
func void() {
    return // optional — falls off the end implicitly
}
```

A function with results must explicitly return them (or have named results and use a naked return).

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Returning the wrong number of values | Compile error |
| Returning the wrong types | Compile error |
| Discarding only some results without `_` | Compile error |
| Bare `return` in a function with unnamed results | Compile error |
| Naked return without named results | Compile error |
| Using a multi-value function as a single value | Compile error |
| Mixing multi-result with other args in a call | Compile error |
| Type-asserting comma-ok form on a non-interface | Compile error |
| Reading from a closed channel via comma-ok | Defined — returns zero value with `ok=false` |
| Map lookup with comma-ok on missing key | Defined — returns zero value with `ok=false` |

---

## 7. Edge Cases from Spec

### 7.1 Nested Multi-Result Forwarding

```go
package main

import "fmt"

func divmod(a, b int) (int, int)    { return a / b, a % b }
func sum(a, b int) int              { return a + b }

func main() {
    fmt.Println(sum(divmod(17, 5))) // 3 + 2 = 5
}
```

`sum` receives the two results of `divmod` directly because their counts and types align.

### 7.2 Error Result Paired With Zero Values

```go
package main

import (
    "errors"
    "fmt"
)

func parse(s string) (int, error) {
    if s == "" {
        return 0, errors.New("empty input") // first result is zero value
    }
    return 42, nil
}

func main() {
    n, err := parse("")
    fmt.Println(n, err) // 0 empty input
}
```

By convention, when an error is returned, the value(s) are zero-value. Callers should not use the value when err != nil.

### 7.3 Three or More Results
There's no upper limit, but more than 3 results suggests you need a struct:

```go
// Awkward:
func split(s string) (string, string, string, error) { /* ... */ return "", "", "", nil }

// Better:
type Parts struct { Scheme, Host, Path string }
func parseURL(s string) (Parts, error) { /* ... */ return Parts{}, nil }
```

### 7.4 Result Names With Same Type Can Be Grouped
Like parameters:

```go
func bounds(s []int) (lo, hi int) { /* ... */ return 0, 0 }
func point() (x, y, z float64)    { return 0, 0, 0 }
```

### 7.5 Returning Different Number from Different Branches Is Not Allowed
Each `return` must match the declared result count exactly:

```go
func f() (int, error) {
    if cond() {
        return 0, nil
    }
    // return 1 // compile error: wrong number of return values
    return 0, errors.New("e")
}
```

### 7.6 Multi-Result From Type Assertion in `range`
The two-value form of map range and channel receive in `range` doesn't apply to function multi-results — but the comma-ok pattern in **expressions** is built on the same multi-value mechanism.

```go
m := map[string]int{"a": 1}
for k, v := range m { fmt.Println(k, v) } // not multi-result; this is range
```

### 7.7 Generic Multi-Result Functions

```go
package main

import "fmt"

func Pair[A, B any](a A, b B) (A, B) {
    return a, b
}

func main() {
    n, s := Pair(42, "hi")
    fmt.Println(n, s)
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Multiple return values, named returns, blank identifier, `(value, error)` idiom established |
| Go 1.18 | Generic functions can return multiple typed results |
| Go 1.20 | `errors.Join` returns combined error from multiple sources |
| Go 1.21 | `min`, `max` built-ins (single-result) |

---

## 9. Implementation-Specific Behavior

### 9.1 Calling Convention for Multiple Results

Since Go 1.17 (amd64) / 1.18 (arm64), multiple results are passed back via the register-based ABI. The first ~9 integer/pointer results travel in registers (RAX, RBX, RCX, RDI, RSI, R8, R9, R10, R11). Floating-point results use X0-X14.

For a function returning `(int, error)`:
- Result 0 (int) → AX
- Result 1 (error: itab+data) → BX, CX

This is significantly faster than the pre-1.17 stack-based ABI.

### 9.2 Result Spilling

When a function has more results than fit in registers, the excess spills to the caller's stack frame. The compiler reserves space in the call site's frame for spilled results.

### 9.3 Inlining With Multiple Results

The inliner handles multiple results normally — they don't disqualify a function from inlining. The cost model counts each result expression against the inline budget.

### 9.4 Naked Return Generates Same Code as Explicit Return

```go
func a() (n int) { n = 5; return }
func b() (n int) { n = 5; return n }
```

Both compile to the same SSA and machine code. Naked return is purely a source-level convenience.

---

## 10. Spec Compliance Checklist

- [ ] Multi-result types are wrapped in parentheses
- [ ] Each `return` matches the declared result count and types
- [ ] Caller assigns or discards every result
- [ ] `_` blank identifier used to discard unwanted results
- [ ] `(value, error)` follows the convention (value first)
- [ ] `comma-ok` follows the convention (value, ok bool)
- [ ] Multi-result function not used as a single value
- [ ] Naked return only with named results
- [ ] When err is non-nil, zero values returned for other results
- [ ] More than 3 results → consider a struct

---

## 11. Official Examples

### Example 1: All Common Forms

```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

// (value, error) — most common
func parseAge(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parse age: %w", err)
    }
    if n < 0 || n > 150 {
        return 0, errors.New("age out of range")
    }
    return n, nil
}

// Multiple values, no error
func divmod(a, b int) (int, int) {
    return a / b, a % b
}

// Comma-ok pattern
func find(m map[string]int, k string) (int, bool) {
    v, ok := m[k]
    return v, ok
}

// Named results with naked return
func split(sum int) (x, y int) {
    x = sum * 4 / 9
    y = sum - x
    return
}

func main() {
    age, err := parseAge("30")
    fmt.Println(age, err)

    q, r := divmod(17, 5)
    fmt.Println(q, r)

    m := map[string]int{"a": 1}
    if v, ok := find(m, "a"); ok {
        fmt.Println("found:", v)
    }

    fmt.Println(split(100))
}
```

### Example 2: Forwarding a Multi-Result

```go
package main

import "fmt"

func source() (int, int, int) { return 1, 2, 3 }
func sum(a, b, c int) int     { return a + b + c }

func main() {
    fmt.Println(sum(source())) // 6
}
```

### Example 3: Comma-Ok Family

```go
package main

import "fmt"

func main() {
    // Map lookup
    m := map[string]int{"a": 1}
    if v, ok := m["b"]; ok {
        fmt.Println(v)
    } else {
        fmt.Println("missing")
    }

    // Type assertion
    var x any = "hello"
    if s, ok := x.(string); ok {
        fmt.Println("string:", s)
    }
    if n, ok := x.(int); ok {
        fmt.Println("int:", n)
    } else {
        fmt.Println("not int")
    }

    // Channel receive
    ch := make(chan int, 1)
    ch <- 42
    close(ch)
    if v, ok := <-ch; ok {
        fmt.Println("received:", v)
    }
    if _, ok := <-ch; !ok {
        fmt.Println("channel closed")
    }
}
```

### Example 4: Invalid Constructs

```go
// 1. Wrong number of return values:
// func f() (int, int) { return 1 }            // ERROR

// 2. Multi-result in single-value context:
// func f() (int, int) { return 1, 2 }
// _ = f() + 1                                  // ERROR
// var x any = f()                              // ERROR

// 3. Mixing multi-result with other args:
// func g(a, b, c int) int { return 0 }
// g(f(), 3)                                    // ERROR

// 4. Naked return without named results:
// func bad() int { return }                    // ERROR

// 5. No parens for multi-result:
// func bad() int, string { return 1, "" }     // ERROR
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Function declarations | https://go.dev/ref/spec#Function_declarations | Result list grammar |
| Return statements | https://go.dev/ref/spec#Return_statements | Naked returns, expression count |
| Calls | https://go.dev/ref/spec#Calls | Multi-result calls in argument position |
| Assignments | https://go.dev/ref/spec#Assignments | Multi-value assignment semantics |
| Type assertions | https://go.dev/ref/spec#Type_assertions | Comma-ok type assertion form |
| Receive operator | https://go.dev/ref/spec#Receive_operator | Comma-ok channel receive |
| Index expressions | https://go.dev/ref/spec#Index_expressions | Comma-ok map index |
| Errors | https://pkg.go.dev/errors | Error interface and wrapping |
