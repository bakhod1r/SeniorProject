# Go Specification: Function Declarations

**Source:** https://go.dev/ref/spec#Function_declarations
**Sections:** Function declarations, Function types, Function literals, Calls, Return statements

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Function_declarations |
| **Function types** | https://go.dev/ref/spec#Function_types |
| **Function literals** | https://go.dev/ref/spec#Function_literals |
| **Calls** | https://go.dev/ref/spec#Calls |
| **Return statements** | https://go.dev/ref/spec#Return_statements |
| **Go Version** | Go 1.0+ (generic functions added in Go 1.18) |

Official definition from the spec:

> "A function declaration binds an identifier, the function name, to a function. A function declaration may omit the body. Such a declaration provides the signature for a function implemented outside Go, such as an assembly routine."

> "A function type denotes the set of all functions with the same parameter and result types. The value of an uninitialized variable of function type is nil."

---

## 2. Formal Grammar (EBNF)

From the Go Language Specification:

```ebnf
FunctionDecl  = "func" FunctionName [ TypeParameters ] Signature [ FunctionBody ] .
FunctionName  = identifier .
FunctionBody  = Block .

Signature     = Parameters [ Result ] .
Result        = Parameters | Type .
Parameters    = "(" [ ParameterList [ "," ] ] ")" .
ParameterList = ParameterDecl { "," ParameterDecl } .
ParameterDecl = [ IdentifierList ] [ "..." ] Type .

FunctionType  = "func" Signature .
FunctionLit   = "func" Signature FunctionBody .
```

Where:
- `FunctionName` is the bound identifier visible at package scope.
- `TypeParameters` (Go 1.18+) introduces generic type parameters.
- `Signature` is the parameter list plus optional results — the unnamed function's "type".
- `FunctionBody` is a `Block`. Omitting the body declares an externally implemented function (assembly stub).
- `Result` may be a single type (no parens needed) or a parenthesized parameter list (for multiple results or named results).
- `ParameterDecl` may bind names to types or list types only (in function-type expressions).

**The forms at a glance:**

```
func name()                       { }     // no params, no result
func name(x int) int              { }     // single param, single result
func name(x, y int) int           { }     // grouped params (same type)
func name(x int, y string) bool   { }     // mixed param types
func name() (int, error)          { }     // multiple results
func name() (n int, err error)    { }     // named results
func name(args ...int) int        { }     // variadic (last param)
```

---

## 3. Core Rules & Constraints

### 3.1 The `func` Keyword Is the Only Way to Declare a Function

Go has exactly one keyword for function declaration: `func`. There is no `function`, `def`, `fn`, or `procedure`. The same keyword is reused for function literals (anonymous functions) and method declarations.

```go
package main

import "fmt"

func greet(name string) string {
    return "Hello, " + name
}

func main() {
    fmt.Println(greet("World"))
}
```

### 3.2 Functions Are First-Class Values

A function in Go is a value of a function type. It can be:
- assigned to a variable,
- passed as an argument,
- returned from another function,
- stored in a struct field, slice, or map,
- compared to `nil` (but not to other functions).

```go
package main

import "fmt"

func add(a, b int) int { return a + b }

func main() {
    var op func(int, int) int = add
    fmt.Println(op(2, 3)) // 5

    ops := map[string]func(int, int) int{
        "add": add,
    }
    fmt.Println(ops["add"](10, 20)) // 30
}
```

### 3.3 Named Functions Cannot Be Nested

Unlike JavaScript or Python, you **cannot declare a named function inside another function**. Only function literals (anonymous functions) may appear inside a function body.

```go
package main

func outer() {
    // func inner() { } // compile error: nested func not allowed

    inner := func() {} // OK: anonymous function literal
    inner()
}

func main() { outer() }
```

### 3.4 Parameter Lists

Parameters of the same type may be grouped, with the type appearing only on the last name. Names are required for all parameters in a declaration that has a body; in a function-type expression, names may be omitted entirely.

```go
package main

import "fmt"

// Same type, grouped:
func sum3(a, b, c int) int { return a + b + c }

// Mixed types:
func mixed(name string, age int, active bool) {}

// Function-type expression (names optional):
type BinaryOp func(int, int) int

func main() {
    fmt.Println(sum3(1, 2, 3))
    mixed("Ada", 30, true)
}
```

### 3.5 Result List

The result list is optional. If present and there is exactly one unnamed result, parentheses may be omitted. Multiple results, or any named results, require parentheses.

```go
package main

import "fmt"

func noResult()              {}
func oneResult() int         { return 1 }
func twoResults() (int, int) { return 1, 2 }
func named() (n int, err error) {
    n = 42
    return // naked return uses named results
}

func main() {
    noResult()
    fmt.Println(oneResult())
    a, b := twoResults()
    fmt.Println(a, b)
    n, err := named()
    fmt.Println(n, err)
}
```

### 3.6 The Return Statement

A function with a non-empty result list must end in a terminating statement (typically `return`). A function with no results may omit `return` at the end. A bare `return` is allowed only when results are named (or when there are no results).

```go
package main

func explicit() int {
    return 42
}

func named() (n int) {
    n = 42
    return // naked return — uses named result
}

func void() {
    // implicit return at end
}

func main() {
    _ = explicit()
    _ = named()
    void()
}
```

### 3.7 Call Syntax

A function call evaluates the function expression, evaluates the arguments, and transfers control. Argument evaluation order is **left to right**, but evaluation of the function expression happens before the arguments. The result of a call expression is the function's result (or a comma-separated tuple, which can be assigned or used as the source of a multi-value expression).

```go
package main

import "fmt"

func f() func(int) int {
    fmt.Println("evaluating function expression")
    return func(x int) int {
        fmt.Println("body")
        return x * 2
    }
}

func arg() int {
    fmt.Println("evaluating argument")
    return 5
}

func main() {
    result := f()(arg())
    // Output:
    //   evaluating function expression
    //   evaluating argument
    //   body
    fmt.Println(result) // 10
}
```

### 3.8 The `main` and `init` Functions Are Special

Two function names are reserved for special behavior at the package level:

- `func main()` — must exist in package `main`. It is the entry point. It takes no arguments and returns no values.
- `func init()` — runs once per package, before `main`. A package may have multiple `init` functions (even in the same file). They run in the order they are declared.

```go
package main

import "fmt"

func init() {
    fmt.Println("init runs first")
}

func main() {
    fmt.Println("then main")
}
```

### 3.9 Functions Are Compared Only to nil

Function values are not comparable to each other. `f == g` is a compile error. Only `f == nil` and `f != nil` are valid comparisons.

```go
package main

import "fmt"

func a() {}
func b() {}

func main() {
    var f func()
    fmt.Println(f == nil) // true

    // fmt.Println(a == b) // compile error: invalid operation
    _ = a
    _ = b
}
```

---

## 4. Type Rules

### 4.1 Function Type Identity

Two function types are identical when they have the same parameter types in the same order, the same result types in the same order, and either both are variadic or neither is. Parameter and result names do not affect type identity.

```go
package main

import "fmt"

type Op1 func(a, b int) int
type Op2 func(x, y int) int // identical to Op1 — names ignored

func main() {
    var f Op1 = func(a, b int) int { return a + b }
    var g Op2 = f // OK: same underlying type
    fmt.Println(g(2, 3))
}
```

### 4.2 Assignability

A function value is assignable to a variable of function type when the underlying types match. There is no implicit conversion between different function types, even if the signatures differ only in parameter names.

```go
package main

func add(a, b int) int { return a + b }

type Adder func(int, int) int

func main() {
    var f Adder = add // OK
    _ = f
}
```

### 4.3 The Zero Value of a Function Type

The zero value of a function type is `nil`. Calling a `nil` function panics with `runtime error: invalid memory address or nil pointer dereference`.

```go
package main

func main() {
    var f func()
    // f() // panic: runtime error: invalid memory address or nil pointer dereference
    _ = f
}
```

### 4.4 No Default Parameter Values

Go has no default parameter values. Every parameter must be passed at the call site. The idiomatic alternative is to overload via additional named functions or to use option-struct / functional-option patterns.

```go
package main

import "fmt"

type ServerOpts struct {
    Port    int
    TimeoutSeconds int
}

func startServer(opts ServerOpts) {
    if opts.Port == 0 {
        opts.Port = 8080 // caller-omitted field gets default here
    }
    if opts.TimeoutSeconds == 0 {
        opts.TimeoutSeconds = 30
    }
    fmt.Printf("listening on :%d (timeout %ds)\n", opts.Port, opts.TimeoutSeconds)
}

func main() {
    startServer(ServerOpts{}) // both defaults
    startServer(ServerOpts{Port: 9000})
}
```

### 4.5 No Function Overloading

Two top-level functions in the same package may not share a name. Go has no function overloading by parameter list. Different behavior with different parameter shapes must be expressed via different names, variadic parameters, or generic type parameters.

```go
package main

func add(a, b int) int { return a + b }

// func add(a, b float64) float64 { return a + b } // compile error: redeclared

func main() { _ = add(1, 2) }
```

### 4.6 Generic Functions (Go 1.18+)

A function may declare type parameters in `[ ... ]` between the name and the parameter list. The type parameters constrain a set of allowed argument types. Type parameters are part of the call site, not the function type for assignability purposes — once instantiated, the result is a concrete function value.

```go
package main

import "fmt"

func Max[T int | float64 | string](a, b T) T {
    if a > b {
        return a
    }
    return b
}

func main() {
    fmt.Println(Max(3, 7))
    fmt.Println(Max("apple", "banana"))
    fmt.Println(Max[float64](1.5, 2.5))
}
```

---

## 5. Behavioral Specification

### 5.1 Argument Passing Is Always By Value

Every argument in Go is passed by value. The function receives a **copy** of the argument. To mutate the caller's variable, pass a pointer.

```go
package main

import "fmt"

func tryIncrement(x int)  { x++ }
func actuallyIncrement(x *int) { *x++ }

func main() {
    n := 10
    tryIncrement(n)
    fmt.Println(n) // 10 — unchanged

    actuallyIncrement(&n)
    fmt.Println(n) // 11
}
```

The argument-by-value rule applies even to slices, maps, and channels — what is copied is the *header* (slice descriptor, map handle, channel handle), not the underlying data. See `2.6.7 Call by Value` and `2.7.3 With Maps & Slices`.

### 5.2 Argument Evaluation Order

Arguments are evaluated **left to right** before the call. The function expression itself is evaluated **before** the arguments.

```go
package main

import "fmt"

func chooseFn() func(int, int) int {
    fmt.Println("1: function expression")
    return func(a, b int) int { return a + b }
}

func arg(label string, v int) int {
    fmt.Println("eval arg:", label)
    return v
}

func main() {
    r := chooseFn()(arg("first", 10), arg("second", 20))
    fmt.Println("result:", r)
    // Output:
    //   1: function expression
    //   eval arg: first
    //   eval arg: second
    //   result: 30
}
```

### 5.3 Stack vs Heap Allocation

Where parameters live (stack vs heap) is determined by **escape analysis**, not by syntax. A parameter that does not escape its function is stored on the goroutine stack. A parameter whose address is taken and stored beyond the function's lifetime escapes to the heap. This is invisible to the program but observable via `go build -gcflags="-m"`.

```go
package main

func stackOnly(x int) int {
    y := x + 1 // y stays on the stack
    return y
}

var sink *int

func escapes(x int) {
    y := x + 1
    sink = &y // y escapes to the heap
}

func main() {
    _ = stackOnly(1)
    escapes(2)
}
```

Run `go build -gcflags="-m=2"` to see escape decisions.

### 5.4 Recursion

Functions may call themselves. The Go runtime grows the goroutine stack dynamically (starting at 2 KiB or 8 KiB depending on version), so deep recursion does not immediately overflow. There is no tail call optimization in the standard `gc` compiler.

```go
package main

import "fmt"

func factorial(n uint64) uint64 {
    if n <= 1 {
        return 1
    }
    return n * factorial(n-1)
}

func main() {
    fmt.Println(factorial(20)) // 2432902008176640000
}
```

### 5.5 Deferred Calls Run on Function Exit

`defer` registers a call that runs when the surrounding function returns (whether by normal return, panic, or runtime.Goexit). Deferred calls run in LIFO order. They observe and may modify named return values.

```go
package main

import "fmt"

func defers() (result int) {
    defer func() { result *= 10 }()
    defer fmt.Println("defer 2")
    defer fmt.Println("defer 1")
    result = 5
    return
}

func main() {
    fmt.Println("returned:", defers())
    // Output:
    //   defer 1
    //   defer 2
    //   returned: 50
}
```

### 5.6 Panic Unwinds the Call Stack

A `panic` aborts the current function and unwinds, running deferred calls in each frame, until the goroutine ends or `recover` (called inside a deferred function) stops the unwind.

```go
package main

import "fmt"

func mayPanic() {
    panic("something broke")
}

func safeCall() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    mayPanic()
    fmt.Println("never reached")
}

func main() {
    safeCall()
    fmt.Println("program continues")
}
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Calling a nil function | Defined — runtime panic (nil pointer dereference) |
| Function returning before assigning a named result | Defined — returns the zero value of the result type |
| Recursive call deep enough to grow the stack | Defined — runtime grows the stack |
| Stack growth that exceeds the per-goroutine limit (default 1 GiB on 64-bit) | Defined — runtime fatal: "stack overflow" |
| `defer` in a function that panics | Defined — deferred functions run during unwind |
| `defer` of a nil function value | Defined — the panic is delayed until the deferred call would run |
| Returning more or fewer values than declared | Compile error |
| Calling a function with mismatched argument count or types | Compile error |
| Comparing two function values with `==` (other than to nil) | Compile error |
| Address of a function (`&f`) | Compile error — only addresses of *variables* are allowed; you can take the address of a function-typed variable instead |
| Function literal capturing a loop variable | Defined — Go ≥ 1.22 captures per-iteration; Go < 1.22 captures shared variable |

---

## 7. Edge Cases from Spec

### 7.1 Empty Parameter and Result Lists

A function with no parameters still needs `()`. A function with no result has no result list at all.

```go
package main

import "fmt"

func nothing() {}

func main() {
    nothing()
    fmt.Println("done")
}
```

### 7.2 The Blank Identifier as a Parameter Name

A parameter name may be `_` (the blank identifier). The argument is still required at the call site, but the value is unreferenced inside the function. This is useful for satisfying an interface signature without using the value.

```go
package main

import "fmt"

func handler(_ int, name string) {
    fmt.Println("name:", name)
}

func main() {
    handler(99, "Ada") // 99 is ignored
}
```

### 7.3 Trailing Comma in Parameter List

Like all Go composite literals, parameter lists may end in a trailing comma when split across lines.

```go
package main

func longSig(
    a int,
    b int,
    c int, // trailing comma OK
) int {
    return a + b + c
}

func main() { _ = longSig(1, 2, 3) }
```

### 7.4 Functions With No Body (Assembly)

A function declared without a body is implemented elsewhere (typically in assembly under `cmd/compile`'s rules, or via `//go:linkname`). Such declarations are common in `runtime` and `math` packages.

```go
// In math/sqrt_amd64.s, this function's body is provided by assembly.
// In Go source it is declared without a body:
//
//   func archSqrt(x float64) float64
//
// Outside of low-level packages, never write bodyless functions.
```

### 7.5 The `init` Function May Appear Multiple Times

A package may declare multiple `init` functions, in any combination of files. They run in source order within a file and in import-graph order across files. `init` cannot be called explicitly by user code.

```go
package main

import "fmt"

func init() { fmt.Println("init A") }
func init() { fmt.Println("init B") }

func main() { fmt.Println("main") }
```

### 7.6 Returning a Function

The result of a function may itself be a function value, enabling factory patterns.

```go
package main

import "fmt"

func multiplier(factor int) func(int) int {
    return func(x int) int { return x * factor }
}

func main() {
    double := multiplier(2)
    triple := multiplier(3)
    fmt.Println(double(5), triple(5)) // 10 15
}
```

### 7.7 Methods Are Functions With a Receiver

A method declaration is the same syntax with an additional receiver list before the function name. From the spec's standpoint, a method is just a function whose first argument is the receiver. Method declarations are covered in chapter 3.

```go
package main

import "fmt"

type Counter struct{ n int }

func (c *Counter) Inc() { c.n++ }

func main() {
    var c Counter
    c.Inc()
    c.Inc()
    fmt.Println(c.n) // 2
}
```

### 7.8 Function-Type Parameter Name Reuse

Inside a `func(...)` type expression, names are optional. When omitted, the type lists must be unambiguous.

```go
package main

type Handler func(int, int) bool         // names omitted
type NamedHandler func(a, b int) bool    // names present, no semantic difference

func main() {
    var h Handler = func(a, b int) bool { return a == b }
    var n NamedHandler = h
    _ = n
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `func` declarations, function values, multiple return values, variadic functions, `defer`, `panic`/`recover` all present from launch. |
| Go 1.1 | Method values formalized: `obj.M` produces a bound function value. |
| Go 1.5 | Compiler rewritten in Go; no language changes to functions. |
| Go 1.17 | Register-based calling convention introduced for amd64 (function call ABI changed; observable in stack traces and benchmarks). Extended to arm64 in Go 1.18. |
| Go 1.18 | **Generics**: `TypeParameters` syntax `func F[T constraint](x T) T` added. |
| Go 1.21 | `min`, `max`, and `clear` become built-in functions. |
| Go 1.22 | Loop-variable per-iteration semantics affect closures returned from loops (see `2.6.5 Closures`). |
| Go 1.23 | Range-over-function iterators: a function with signature `func(yield func(V) bool)` can be ranged over. |

---

## 9. Implementation-Specific Behavior

### 9.1 Calling Convention

Before Go 1.17 the standard `gc` compiler used a stack-based calling convention: arguments and results were passed on the goroutine stack. Since Go 1.17 (amd64) and Go 1.18 (arm64), Go uses a register-based calling convention with up to ~9 integer and ~15 floating-point argument registers. This typically produces 5–10% faster code in hot paths.

The convention is an implementation detail; you cannot rely on a specific register from Go source. CGO and assembly stubs use a documented bridging convention.

### 9.2 Inlining

The compiler inlines small functions automatically. Since Go 1.20 the inliner can inline functions with `for` loops, type switches, and method calls. Hints:

- `//go:inline` is **not** a recognized pragma in cmd/compile.
- `//go:noinline` forces a function to never be inlined (used in benchmarks).
- Use `go build -gcflags="-m"` to see inlining decisions.

```go
package main

//go:noinline
func notInlined(a, b int) int { return a + b }

func main() { _ = notInlined(1, 2) }
```

### 9.3 Stack Size

Each goroutine starts with a small stack (~2 KiB in modern Go). The runtime grows the stack as needed by copying it to a larger area. The hard limit per goroutine is set by `runtime/debug.SetMaxStack` (default 1 GiB on 64-bit systems). Exceeding the limit kills the program with `runtime: goroutine stack exceeds limit`.

### 9.4 No Tail Call Optimization

The standard `gc` compiler does **not** perform tail call optimization. Deeply recursive code in tail position grows the stack. For algorithms that require tail recursion (e.g., trampolined evaluators), rewrite as an explicit loop.

### 9.5 Linking and `//go:linkname`

The directive `//go:linkname localname remotepkg.RemoteName` lets a function declaration in one package be linked to another package's private symbol. This bypasses normal visibility rules and is restricted to packages that import `unsafe`. Use is reserved for runtime-internal purposes.

---

## 10. Spec Compliance Checklist

- [ ] Function declared with `func name(params) result { body }`
- [ ] Result list parenthesized when multiple results or any named results
- [ ] No nested named functions (only function literals inside other functions)
- [ ] Every parameter declared at call site (no defaults)
- [ ] No two top-level functions share a name in the same package
- [ ] Function values compared only to `nil`
- [ ] `func main()` exists exactly once in package `main`
- [ ] `init` functions take no arguments and return no values
- [ ] `return` provided wherever a result list is non-empty (or function has a named result and ends in a terminating statement)
- [ ] Argument count and types match the function signature
- [ ] Variadic parameter (`...T`) appears only as the last parameter
- [ ] Function literals capturing closures account for Go 1.22 loop-variable semantics

---

## 11. Official Examples

### Example 1: All Function Declaration Forms

```go
package main

import "fmt"

// 1. No params, no result
func ping() { fmt.Println("ping") }

// 2. Params with grouped types
func add(a, b int) int { return a + b }

// 3. Mixed param types
func tag(name string, count int) string {
    return fmt.Sprintf("%s:%d", name, count)
}

// 4. Multiple results
func divmod(a, b int) (int, int) { return a / b, a % b }

// 5. Named results
func split(sum int) (x, y int) {
    x = sum * 4 / 9
    y = sum - x
    return
}

// 6. Variadic
func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

// 7. Function value as parameter
func apply(f func(int) int, x int) int { return f(x) }

// 8. Function value as result
func adder(by int) func(int) int {
    return func(x int) int { return x + by }
}

func main() {
    ping()
    fmt.Println(add(3, 4))
    fmt.Println(tag("retries", 5))
    q, r := divmod(17, 5)
    fmt.Println(q, r)
    fmt.Println(split(100))
    fmt.Println(sum(1, 2, 3, 4, 5))
    fmt.Println(apply(func(x int) int { return x * x }, 6))
    fmt.Println(adder(10)(5))
}
```

**Expected output:**

```
ping
7
retries:5
3 2
44 56
15
36
15
```

### Example 2: Function as Map Value

```go
package main

import "fmt"

func main() {
    ops := map[string]func(int, int) int{
        "+": func(a, b int) int { return a + b },
        "-": func(a, b int) int { return a - b },
        "*": func(a, b int) int { return a * b },
    }
    for _, op := range []string{"+", "-", "*"} {
        fmt.Printf("3 %s 4 = %d\n", op, ops[op](3, 4))
    }
}
```

**Expected output:**

```
3 + 4 = 7
3 - 4 = -1
3 * 4 = 12
```

### Example 3: Why Argument Evaluation Order Matters

```go
package main

import "fmt"

func main() {
    i := 0
    f := func(a, b int) {
        fmt.Println("a:", a, "b:", b)
    }
    f(i, func() int { i++; return i }())
    // a: 0  b: 1
    // — left arg captured i==0 BEFORE the right arg incremented it.
}
```

### Example 4: Invalid Constructs (Compile Errors)

```go
// 1. Nested named function:
// func outer() {
//     func inner() {} // ERROR: nested func not allowed
// }

// 2. Two functions with same name in package:
// func add(a, b int) int    { return a + b }
// func add(a, b float64)... // ERROR: redeclared

// 3. Default parameter value:
// func greet(name string = "World") {} // ERROR: unexpected '='

// 4. Function comparison:
// func a() {}
// func b() {}
// _ = a == b // ERROR: invalid operation

// 5. Address-of a function:
// _ = &fmt.Println // ERROR: cannot take address of fmt.Println

// 6. Variadic param not last:
// func bad(args ...int, x int) {} // ERROR: can only use ... as final argument
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Function declarations | https://go.dev/ref/spec#Function_declarations | Primary specification |
| Function types | https://go.dev/ref/spec#Function_types | Type identity, function-typed variables |
| Function literals | https://go.dev/ref/spec#Function_literals | Anonymous functions (covered in 2.6.4) |
| Calls | https://go.dev/ref/spec#Calls | Call semantics, argument evaluation |
| Return statements | https://go.dev/ref/spec#Return_statements | When return is required, naked return |
| Defer statements | https://go.dev/ref/spec#Defer_statements | Deferred function calls |
| Handling panics | https://go.dev/ref/spec#Handling_panics | `panic` and `recover` |
| Type parameter declarations | https://go.dev/ref/spec#Type_parameter_declarations | Generic functions (Go 1.18+) |
| Method declarations | https://go.dev/ref/spec#Method_declarations | Functions with a receiver |
| Program initialization | https://go.dev/ref/spec#Program_initialization | `init` and `main` semantics |
