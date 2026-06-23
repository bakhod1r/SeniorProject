# Go Specification: Anonymous Functions (Function Literals)

**Source:** https://go.dev/ref/spec#Function_literals
**Sections:** Function literals, Function types, Calls

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Function_literals |
| **Function types** | https://go.dev/ref/spec#Function_types |
| **Closures** | implied via "may refer to variables defined in a surrounding function" |
| **Go Version** | Go 1.0+ |

Official text:

> "A function literal represents an anonymous function. Function literals are closures: they may refer to variables defined in a surrounding function. Those variables are then shared between the surrounding function and the function literal, and they survive as long as they are accessible."

---

## 2. Formal Grammar (EBNF)

```ebnf
FunctionLit = "func" Signature FunctionBody .
Signature   = Parameters [ Result ] .
FunctionBody = Block .
```

A function literal looks identical to a function declaration but **without a name**. It's an expression of function type.

**Forms at a glance:**

```go
func() {}                                     // no params, no result
func(x int) int { return x * 2 }              // one param, one result
func(a, b int) (int, int) { return a, b }    // multi-result
func() {                                       // anonymous, immediately invoked
    fmt.Println("IIFE")
}()                                            // ← parens at the end invoke immediately
```

---

## 3. Core Rules & Constraints

### 3.1 A Function Literal Is an Expression

```go
package main

import "fmt"

func main() {
    f := func(x int) int { return x * 2 }
    fmt.Println(f(5)) // 10
}
```

The right-hand side is an expression of type `func(int) int`. You can assign it, pass it, return it, store it.

### 3.2 No Name Means No Recursion By Name

```go
package main

func main() {
    // f := func(n int) int {
    //     if n <= 1 { return 1 }
    //     return n * f(n-1) // ERROR: f undefined inside the literal
    // }
    
    // Workaround — declare first, then assign:
    var f func(int) int
    f = func(n int) int {
        if n <= 1 { return 1 }
        return n * f(n-1)
    }
    _ = f(5) // 120
}
```

The recursive workaround works because the variable `f` is captured by reference, so the inner call sees the assigned value.

### 3.3 Function Literals Are Closures

A function literal captures variables from its surrounding scope. Those variables become part of the closure's state and live as long as the closure does.

```go
package main

import "fmt"

func makeCounter() func() int {
    count := 0
    return func() int {
        count++
        return count
    }
}

func main() {
    c := makeCounter()
    fmt.Println(c(), c(), c()) // 1 2 3
}
```

(Closures are covered in detail in 2.6.5.)

### 3.4 Immediately-Invoked Function Expression (IIFE)

You can call a function literal directly:

```go
package main

import "fmt"

func main() {
    result := func(a, b int) int {
        return a + b
    }(3, 4)
    fmt.Println(result) // 7
}
```

The trailing `(args)` invokes the literal immediately. Useful for scoping and `defer`-style patterns.

### 3.5 Anonymous Functions in `defer` and `go`

Two of the most common uses:

```go
package main

import "fmt"

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    
    go func() {
        fmt.Println("in goroutine")
    }()
}
```

Both `defer` and `go` accept a function CALL expression. The function literal must be invoked (with `()`).

### 3.6 Type of a Function Literal

The literal's type is `func(params) results` — same as if it were a named function declaration:

```go
package main

import "fmt"

func main() {
    f := func(x int) int { return x }
    fmt.Printf("%T\n", f) // func(int) int
}
```

### 3.7 Function Literal Identity

Each occurrence of a function literal at runtime is a NEW funcval value, even if the source is identical.

```go
package main

import "fmt"

func main() {
    f := func() {}
    g := func() {}
    // fmt.Println(f == g) // compile error: invalid operation
    _ = f
    _ = g
    fmt.Println("ok")
}
```

Function values can only be compared to nil, not to each other.

### 3.8 Returning a Function Literal

```go
package main

import "fmt"

func adder(by int) func(int) int {
    return func(x int) int {
        return x + by
    }
}

func main() {
    add3 := adder(3)
    fmt.Println(add3(10)) // 13
}
```

The returned literal closes over `by`.

### 3.9 Passing a Function Literal

```go
package main

import (
    "fmt"
    "sort"
)

func main() {
    s := []int{5, 2, 8, 1}
    sort.Slice(s, func(i, j int) bool {
        return s[i] < s[j]
    })
    fmt.Println(s) // [1 2 5 8]
}
```

`sort.Slice` takes a `less func(i, j int) bool` parameter; a literal is the natural value to pass.

---

## 4. Type Rules

### 4.1 Type Inference With `:=`

```go
f := func(x int) string { return "hi" }
// f has type func(int) string
```

### 4.2 Assignability to a Named Function Type

```go
type IntOp func(int) int

var op IntOp = func(x int) int { return x + 1 }
```

Assignability requires identical signatures (excluding parameter names).

### 4.3 Cannot Take Address of Function Literal Directly

```go
// _ = &func(){} // compile error
f := func(){}
_ = &f          // OK — address of variable
```

Function literals are not addressable. Their values are stored in funcval cells which are themselves not user-addressable.

### 4.4 Function Literals in Struct Fields

```go
type Handler struct {
    Process func(int) int
}

h := Handler{
    Process: func(x int) int { return x * 2 },
}
fmt.Println(h.Process(5)) // 10
```

---

## 5. Behavioral Specification

### 5.1 Closure Captures Are By Reference

Variables captured by a function literal are shared with the enclosing scope:

```go
package main

import "fmt"

func main() {
    x := 1
    f := func() { fmt.Println(x) }
    x = 99
    f() // 99 — sees the updated value
}
```

### 5.2 Capture Lifetime

Captured variables outlive the enclosing function if the closure escapes:

```go
package main

import "fmt"

func makeF() func() int {
    x := 100
    return func() int { return x } // x escapes to heap
}

func main() {
    f := makeF()
    fmt.Println(f()) // 100 — x is still alive
}
```

`x` is on the heap because the returned closure references it.

### 5.3 Loop-Variable Capture (Go 1.22 Change)

Inside `for range`, loop variables get **per-iteration** semantics in Go 1.22+. Inside C-style `for`, they are still **shared** across iterations.

```go
package main

import "fmt"

func main() {
    fns := make([]func() int, 0)
    
    // for range — per-iteration in Go 1.22+
    for _, n := range []int{1, 2, 3} {
        fns = append(fns, func() int { return n })
    }
    for _, f := range fns {
        fmt.Println(f()) // 1 2 3 (Go 1.22+) ; 3 3 3 (pre-1.22)
    }
    
    // C-style — still shared
    fns = nil
    for i := 0; i < 3; i++ {
        fns = append(fns, func() int { return i })
    }
    for _, f := range fns {
        fmt.Println(f()) // 3 3 3 in all versions
    }
}
```

### 5.4 IIFE Argument Evaluation

Arguments to an IIFE are evaluated at call time, like any function call:

```go
package main

import "fmt"

func main() {
    n := 1
    func(v int) {
        fmt.Println(v) // 1
    }(n)
    n = 99
}
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Calling a function literal stored in a variable | Defined — calls the literal |
| Calling a nil function-typed variable | Defined — runtime panic |
| Comparing two function literals | Compile error |
| Recursing into a literal by self-reference | Compile error (no name) |
| Capturing a loop variable in `for range` (Go 1.22+) | Defined — per-iteration |
| Capturing a loop variable in C-style `for` | Defined — shared across iterations |
| Returning a function literal that captures locals | Defined — locals escape to heap |
| Storing a function literal in a struct field | Defined |
| Taking address of a function literal directly | Compile error |
| Method on a function literal | Cannot — literals are not types you can attach methods to |

---

## 7. Edge Cases from Spec

### 7.1 Empty Function Literal

```go
do := func() {}
do() // no-op
```

Useful as a default callback.

### 7.2 Function Literal With Variadic

```go
sum := func(xs ...int) int {
    total := 0
    for _, x := range xs { total += x }
    return total
}
fmt.Println(sum(1, 2, 3))
```

### 7.3 Function Literal With Named Returns

```go
split := func(sum int) (a, b int) {
    a = sum / 2
    b = sum - a
    return
}
```

### 7.4 Function Literal Captures Itself Indirectly

```go
var fact func(int) int
fact = func(n int) int {
    if n <= 1 { return 1 }
    return n * fact(n-1)
}
```

This is the standard recursion pattern for anonymous functions.

### 7.5 Generic Function Literals

Function literals **cannot** declare type parameters directly:

```go
// f := func[T any](x T) T { return x } // compile error: type parameters in literal not allowed

// Workaround — wrap in a generic named function:
func id[T any](x T) T { return x }
f := id[int] // f is func(int) int
```

### 7.6 Function Literal in `init` Function

```go
package main

import "fmt"

var compute = func(x int) int { return x * 2 }

func init() {
    fmt.Println(compute(5)) // 10
}

func main() {}
```

A package-level variable can be initialized to a function literal. This runs at init time.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Function literals with closure semantics |
| Go 1.21 | `GOEXPERIMENT=loopvar` opt-in to per-iteration loop variable capture |
| Go 1.22 | Per-iteration loop variable capture default for `for range` (and C-style with `=` form) |
| Go 1.23 | Range-over-function iterators: function literals are the body of `for range f`. |

Note on Go 1.22: the loop-variable change applies to ALL three for-loop forms. C-style `for i := 0; ...; i++` also creates a fresh `i` per iteration in Go 1.22+. (This contradicts what was previously commonly stated; verify with the official Go 1.22 release notes for your specific case.)

---

## 9. Implementation-Specific Behavior

### 9.1 Closure Representation

A function literal that captures variables is compiled into a closure: a struct containing the captured variables plus a code pointer to the literal's body. At call sites, the runtime accesses captures via a context pointer (DX on amd64).

### 9.2 Stack vs Heap

If a function literal does NOT capture any variables, it's a plain code pointer with no allocation cost.

If it captures variables AND escapes (returned, stored, etc.), the closure struct is heap-allocated.

If it captures but does NOT escape, the compiler may stack-allocate the closure.

Verify:
```bash
go build -gcflags="-m=2" 2>&1 | grep "func literal"
```

### 9.3 Inlining

Small function literals can be inlined at the call site, especially when assigned to a variable used directly. Indirect calls through function values or interfaces typically prevent inlining unless devirtualized by PGO.

---

## 10. Spec Compliance Checklist

- [ ] Function literal uses `func(params) result { body }` syntax
- [ ] No name immediately after `func` (that's reserved for declarations)
- [ ] Captures from enclosing scope work via closure semantics
- [ ] IIFE invokes with trailing `()`
- [ ] Loop-variable capture accounts for Go 1.22 changes
- [ ] No attempt to declare type parameters on the literal directly
- [ ] No attempt to take address of a literal expression
- [ ] No attempt to compare two function literals

---

## 11. Official Examples

### Example 1: Common Forms

```go
package main

import "fmt"

func main() {
    // Assigned
    add := func(a, b int) int { return a + b }
    fmt.Println(add(3, 4))

    // Passed as argument
    apply := func(f func(int) int, x int) int { return f(x) }
    fmt.Println(apply(func(n int) int { return n * 10 }, 7))

    // Returned (factory pattern)
    multiplier := func(factor int) func(int) int {
        return func(x int) int { return x * factor }
    }
    times3 := multiplier(3)
    fmt.Println(times3(5))

    // IIFE
    sum := func(xs []int) int {
        s := 0
        for _, x := range xs { s += x }
        return s
    }([]int{1, 2, 3, 4, 5})
    fmt.Println(sum)

    // In defer
    defer func() {
        fmt.Println("cleanup")
    }()
}
```

### Example 2: Goroutine Body

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            fmt.Println("goroutine", i)
        }(i)
    }
    wg.Wait()
}
```

### Example 3: Sort Comparator

```go
package main

import (
    "fmt"
    "sort"
)

type Person struct {
    Name string
    Age  int
}

func main() {
    people := []Person{{"Charlie", 25}, {"Alice", 30}, {"Bob", 22}}
    sort.Slice(people, func(i, j int) bool {
        return people[i].Age < people[j].Age
    })
    fmt.Println(people)
}
```

### Example 4: Invalid Constructs

```go
// 1. Recursion by name (no name to reference):
// f := func(n int) int { return f(n-1) } // ERROR: f undefined inside literal

// 2. Address of literal:
// _ = &func(){} // ERROR

// 3. Comparing literals:
// _ = func(){} == func(){} // ERROR

// 4. Type parameters in literal:
// _ = func[T any](x T) T { return x } // ERROR
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Function literals | https://go.dev/ref/spec#Function_literals | Primary spec |
| Function types | https://go.dev/ref/spec#Function_types | Type identity |
| Calls | https://go.dev/ref/spec#Calls | IIFE invocation |
| Defer statements | https://go.dev/ref/spec#Defer_statements | Anonymous defer pattern |
| Go statements | https://go.dev/ref/spec#Go_statements | Anonymous goroutine pattern |
| For statements | https://go.dev/ref/spec#For_statements | Loop-variable capture (Go 1.22) |
| Closures | (informal — covered under function literals) | See 2.6.5 |
