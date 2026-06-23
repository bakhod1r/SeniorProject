# Go Specification: Closures

**Source:** https://go.dev/ref/spec#Function_literals
**Sections:** Function literals (closure semantics)

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Function_literals |
| **Loop variables** | https://go.dev/ref/spec#For_statements |
| **Go Version** | Go 1.0+ (closures); Go 1.22 changes loop var semantics |

Official text:

> "Function literals are closures: they may refer to variables defined in a surrounding function. Those variables are then shared between the surrounding function and the function literal, and they survive as long as they are accessible."

---

## 2. Definition

A **closure** is a function value that **captures** variables from its enclosing lexical scope. The captured variables are shared between the inner function and the outer scope; their lifetime is extended to match the closure's lifetime.

In Go, every function literal `func(...) {...}` is potentially a closure. If it references variables from the surrounding scope, it captures them. If it references no outside variables, it's a function value but doesn't carry any captured state — sometimes called a "non-closing literal" though Go doesn't formally distinguish.

---

## 3. Core Rules & Constraints

### 3.1 Captures Are By Reference

Variables captured by a closure are **shared**, not copied:

```go
package main

import "fmt"

func main() {
    x := 1
    f := func() int { return x }
    x = 99
    fmt.Println(f()) // 99 — sees the updated value
}
```

Modifying `x` inside the closure also modifies it outside:

```go
x := 1
f := func() { x++ }
f()
fmt.Println(x) // 2
```

### 3.2 Captured Variables Survive the Outer Function

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

`count` would normally die when `makeCounter` returns. Because the returned closure references it, the compiler moves it to the heap.

### 3.3 Each Closure Instance Has Its Own Captures

```go
c1 := makeCounter()
c2 := makeCounter()
fmt.Println(c1(), c2(), c1()) // 1 1 2
```

Each call to `makeCounter` creates a new `count` and a new closure capturing it.

### 3.4 Closure Captures Pointers, Not Values, of Local Variables

The captured variable IS the same variable. The compiler may implement this via a pointer to a heap-allocated cell, but conceptually it's a single named storage location.

```go
package main

import "fmt"

func main() {
    x := 1
    incr := func() { x++ }
    show := func() { fmt.Println(x) }
    
    incr()
    show() // 2
    x = 100
    show() // 100
}
```

`incr` and `show` share `x`.

### 3.5 Loop Variable Capture (Go 1.22 Change)

**Pre Go 1.22**: a loop variable was shared across all iterations of the loop. Closures captured the same variable.

**Go 1.22+**: each iteration creates a fresh loop variable when declared with `:=`. Closures capture per-iteration variables.

```go
package main

import "fmt"

func main() {
    fns := []func() int{}
    for i := 0; i < 3; i++ {
        fns = append(fns, func() int { return i })
    }
    for _, f := range fns {
        fmt.Println(f())
    }
    // Go 1.22+: 0, 1, 2
    // Pre 1.22: 3, 3, 3
}
```

The change is gated by the `go` directive in `go.mod`:
- `go 1.21` or earlier: per-loop semantics.
- `go 1.22` or later: per-iteration semantics.

Applies to all three for-loop forms when iteration variables are declared with `:=`.

### 3.6 Closures Capture What They Reference, Including Pointers

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}
    f := func() {
        s[0] = 99 // modifies the underlying array
    }
    f()
    fmt.Println(s) // [99 2 3]
}
```

The closure captures the slice header `s`. Modifying elements through it affects the underlying array, which is shared with the outer scope.

### 3.7 Closures Cannot Recurse By Their Anonymous Name

Inside a function literal, the literal has no name. Use `var f func(...); f = ...` for recursion.

### 3.8 Capture Does Not Restrict Access — But Can Cause Concurrent Bugs

Multiple closures can capture the same variable. Concurrent access requires synchronization:

```go
var counter int
incr := func() { counter++ }
go incr()
go incr()
// RACE: counter accessed concurrently without sync
```

Use `sync.Mutex` or `sync/atomic`.

---

## 4. Type Rules

### 4.1 The Closure Has the Function Type Determined by Its Signature

```go
adder := func(by int) func(int) int {
    return func(x int) int { return x + by }
}

inc := adder(1) // type: func(int) int
```

The captures don't show up in the type. Two closures with identical signatures are interchangeable.

### 4.2 Captured Variables' Types

Each captured variable retains its declared type. Closures don't see "boxed" or "unboxed" versions.

```go
x := 5 // int
f := func() { x++ }
// inside f: x is int, accessed as a normal int variable
```

### 4.3 Generic Captures

Generic type parameters of the enclosing function can be captured:

```go
func Wrap[T any](t T) func() T {
    return func() T { return t }
}

f := Wrap(42)
fmt.Println(f()) // 42, type int
```

The closure captures `t` (a `T` value).

---

## 5. Behavioral Specification

### 5.1 Capture Lifetime Equals Closure Lifetime

```go
func factory() func() int {
    n := 100
    return func() int { return n }
}

f := factory()
// `n` survives as long as `f` is reachable.
fmt.Println(f()) // 100
```

The compiler moves `n` to the heap because it's captured by an escaping closure.

### 5.2 Captured Variable Initial Value

Captured variables are initialized to their declared/assigned value when the closure is created. The closure sees subsequent updates because the capture is a reference.

```go
n := 1
f := func() int { return n }
fmt.Println(f()) // 1
n = 99
fmt.Println(f()) // 99
```

### 5.3 Capture Across Multiple Closures

```go
n := 0
incr := func() { n++ }
get  := func() int { return n }

incr(); incr(); incr()
fmt.Println(get()) // 3
```

Both closures share the same `n`.

### 5.4 Closures and `defer`

A closure used in `defer` evaluates its body at function exit. Captured variables reflect their value at that time:

```go
x := 1
defer func() { fmt.Println(x) }() // captures x by ref
x = 99
// At return: prints 99
```

This contrasts with `defer fmt.Println(x)` (no closure), which evaluates `x` eagerly: prints 1.

### 5.5 Closures and Goroutines

```go
x := 1
go func() {
    fmt.Println(x) // captures x by ref
}()
x = 99
// Race: x is read by goroutine, written by main, no synchronization
```

Concurrent capture requires synchronization.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Capturing a variable from enclosing scope | Defined — by reference |
| Captured variable lifetime | Defined — extends to closure's lifetime |
| Two closures sharing a captured variable | Defined — same variable |
| Concurrent access to captured variable | Defined as race; needs synchronization |
| Loop variable captured (Go 1.22+) | Defined — per iteration |
| Loop variable captured (pre Go 1.22) | Defined — shared across iterations |
| Closure escaping the function | Defined — captures move to heap |
| Closure not escaping | Defined — captures may stay on stack |

---

## 7. Edge Cases from Spec

### 7.1 Capture by Value Workaround

To capture a snapshot (not the live variable), shadow the variable:

```go
x := 1
f := func() int {
    x := x // shadow; captures the value at this point
    return x
}
x = 99
fmt.Println(f()) // 1
```

The inner `x := x` creates a per-closure copy.

### 7.2 Recursive Closure via Variable

```go
var fact func(int) int
fact = func(n int) int {
    if n <= 1 { return 1 }
    return n * fact(n-1)
}
```

The literal captures the variable `fact`. By the time it's called, `fact` has been assigned.

### 7.3 Mutual Recursion via Two Variables

```go
var even func(int) bool
var odd  func(int) bool

even = func(n int) bool { if n == 0 { return true } ; return odd(n-1) }
odd  = func(n int) bool { if n == 0 { return false } ; return even(n-1) }
```

Each captures the other.

### 7.4 Closure Capturing Receiver

```go
type C struct{ n int }
func (c *C) Inc() func() {
    return func() { c.n++ } // captures c (the receiver pointer)
}
```

The closure captures `c`. Subsequent modifications via the closure update `c.n` for all observers of `c`.

### 7.5 Closure in `select`

Used inside `select` for callbacks:

```go
ch := make(chan int)
go func() { ch <- 42 }()
select {
case v := <-ch:
    fmt.Println(v)
}
```

The receiving goroutine and the sending goroutine each capture `ch` (a reference type).

### 7.6 Closures of Generic Functions

```go
func Apply[T any](xs []T, fn func(T) T) []T {
    out := make([]T, len(xs))
    for i, x := range xs {
        out[i] = fn(x)
    }
    return out
}

double := func(x int) int { return x * 2 }
result := Apply([]int{1, 2, 3}, double)
```

The closure `double` doesn't capture; it's just a function value passed to `Apply`.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Closures with shared loop variable across iterations |
| Go 1.21 | `GOEXPERIMENT=loopvar` opt-in to per-iteration semantics |
| Go 1.22 | Per-iteration loop variable as default for modules with `go 1.22+` |
| Go 1.23 | Range-over-function iterators; closures used as `yield` callbacks |

---

## 9. Implementation-Specific Behavior

### 9.1 Closure Struct Allocation

For each escaping closure:
- The compiler synthesizes a closure struct containing captured variables (or pointers to them, depending on the compiler's analysis).
- The struct is heap-allocated if the closure escapes.
- The funcval contains a code pointer + the closure struct (or an indirection).

### 9.2 Capture Representation

For captured variables that fit in a register and are read-only after creation, the compiler may store the value directly in the closure struct (avoiding indirection).

For mutable captures shared with the outer scope, the compiler stores a pointer in the closure struct, pointing to a heap-allocated cell that holds the actual value.

### 9.3 Stack-Allocated Closures

If escape analysis proves a closure doesn't escape its enclosing function, the closure struct stays on the goroutine stack. No heap allocation.

```go
// Doesn't escape:
func direct() {
    x := 1
    f := func() int { return x }
    _ = f()
}

// Escapes:
func returns() func() int {
    x := 1
    return func() int { return x } // x and closure go to heap
}
```

### 9.4 Go 1.22 Loop Variable Implementation

The compiler synthesizes per-iteration variables. Conceptually:

```
for i := 0; i < N; i++ { body }
```

becomes:

```
for outerI := 0; outerI < N; outerI++ {
    i := outerI // fresh variable per iteration
    body
}
```

When closures capture `i`, they capture the per-iteration variable, which has its own storage location.

If the closure doesn't escape, the compiler may optimize away the per-iteration allocation and reuse a single stack slot.

---

## 10. Spec Compliance Checklist

- [ ] Closures capture variables by reference
- [ ] Captured variables survive as long as the closure is reachable
- [ ] Each closure instance has its own copy of captures (when factory returns multiple)
- [ ] Loop variable capture accounts for Go 1.22 change
- [ ] Recursive closures use the `var f ... ; f = ...` pattern
- [ ] Concurrent capture access is synchronized
- [ ] Snapshot capture uses the shadow `x := x` idiom

---

## 11. Official Examples

### Example 1: Counter Closure

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
    c1 := makeCounter()
    c2 := makeCounter()
    fmt.Println(c1(), c1(), c1()) // 1 2 3
    fmt.Println(c2(), c2())       // 1 2
}
```

### Example 2: Sequence Generator

```go
package main

import "fmt"

func nextN(start, step int) func() int {
    n := start
    return func() int {
        v := n
        n += step
        return v
    }
}

func main() {
    odd := nextN(1, 2)
    fmt.Println(odd(), odd(), odd(), odd()) // 1 3 5 7
}
```

### Example 3: Capture by Snapshot

```go
package main

import "fmt"

func main() {
    fns := []func(){}
    for i := 0; i < 3; i++ {
        i := i // snapshot per iteration (still works in Go 1.22+)
        fns = append(fns, func() { fmt.Println(i) })
    }
    for _, f := range fns {
        f()
    }
    // 0
    // 1
    // 2
}
```

### Example 4: Mutual Recursion

```go
package main

import "fmt"

func main() {
    var even, odd func(int) bool
    even = func(n int) bool {
        if n == 0 { return true }
        return odd(n-1)
    }
    odd = func(n int) bool {
        if n == 0 { return false }
        return even(n-1)
    }
    for i := 0; i < 5; i++ {
        fmt.Println(i, even(i), odd(i))
    }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Function literals | https://go.dev/ref/spec#Function_literals | Closure capture semantics |
| Variable declarations | https://go.dev/ref/spec#Variable_declarations | Captured variable lifetimes |
| For statements | https://go.dev/ref/spec#For_statements | Loop variable scoping |
| Memory model | https://go.dev/ref/mem | Concurrent capture access |
| Defer statements | https://go.dev/ref/spec#Defer_statements | Closures in defer |
| Go statements | https://go.dev/ref/spec#Go_statements | Closures in goroutines |
