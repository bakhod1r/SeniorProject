# Go Specification: Variadic Functions

**Source:** https://go.dev/ref/spec#Function_types
**Sections:** Function types (variadic parameter), Passing arguments to ... parameters

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Function_types |
| **Passing args** | https://go.dev/ref/spec#Passing_arguments_to_..._parameters |
| **Go Version** | Go 1.0+ |

Official definition from the spec:

> "The final incoming parameter in a function signature may have a type prefixed with `...`. A function with such a parameter is called variadic and may be invoked with zero or more arguments for that parameter."

> "Within the function, the parameter is treated as a slice of the parameter type."

---

## 2. Formal Grammar (EBNF)

```ebnf
ParameterDecl = [ IdentifierList ] [ "..." ] Type .
```

The `...` prefix is allowed only on the **last** parameter declaration. The parameter's type inside the function is `[]T` where `T` was the declared element type.

**Forms at a glance:**

```
func f(args ...int)                  // 0+ ints, accessed as []int
func f(prefix string, rest ...int)   // string + 0+ ints
func f(args ...interface{})          // 0+ values of any type
func f(args ...any)                  // Go 1.18+ — same as ...interface{}
```

**At the call site:**

```
f()                                  // zero variadic args
f(1)                                 // one
f(1, 2, 3)                           // three
xs := []int{1, 2, 3}; f(xs...)       // spread an existing slice
```

---

## 3. Core Rules & Constraints

### 3.1 Only the Last Parameter May Be Variadic

```go
package main

func valid(prefix string, rest ...int) {}
// func bad(rest ...int, suffix string) {} // compile error: can only use ... with final parameter

func main() { valid("nums:", 1, 2, 3) }
```

### 3.2 Inside the Function, the Parameter Is a Slice

```go
package main

import "fmt"

func sum(nums ...int) int {
    fmt.Printf("nums: %v (type: %T, len: %d)\n", nums, nums, len(nums))
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

func main() {
    fmt.Println(sum())            // nums: [] ([]int) len: 0    → 0
    fmt.Println(sum(1, 2, 3))     // nums: [1 2 3] ([]int) len: 3 → 6
}
```

### 3.3 Spreading a Slice With `...`

To pass an existing slice as the variadic argument, append `...` to the call:

```go
package main

import "fmt"

func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

func main() {
    nums := []int{1, 2, 3, 4, 5}
    fmt.Println(sum(nums...))   // 15
    // fmt.Println(sum(nums))   // compile error: cannot use nums (type []int) as type int
}
```

**Mixing literal args with `...` is forbidden:**
```go
// sum(1, 2, nums...)  // compile error: have to choose one form or the other
```

### 3.4 The Variadic Parameter May Be `nil`

When called with zero variadic args, the parameter is the zero value of `[]T` (`nil`), not an empty non-nil slice:

```go
package main

import "fmt"

func describe(args ...int) {
    fmt.Println("nil:", args == nil, "len:", len(args))
}

func main() {
    describe()              // nil: true  len: 0
    describe(1)             // nil: false len: 1

    var empty []int
    describe(empty...)      // nil: true  len: 0  (empty is nil)

    nonNil := []int{}
    describe(nonNil...)     // nil: false len: 0
}
```

### 3.5 Spread Reuses the Caller's Backing Array

`f(s...)` does **not** copy the slice. The function receives a slice header that points to the same underlying array. Mutations to elements inside the function are visible to the caller.

```go
package main

import "fmt"

func zeroOut(xs ...int) {
    for i := range xs {
        xs[i] = 0
    }
}

func main() {
    s := []int{1, 2, 3}
    zeroOut(s...)
    fmt.Println(s) // [0 0 0]  — caller's slice was mutated
}
```

In contrast, the literal-arg form creates a fresh slice each call:

```go
zeroOut(1, 2, 3) // creates a new []int{1,2,3} for the call; nothing to observe afterward
```

### 3.6 The Variadic Parameter Type Can Be Any Type

```go
package main

import "fmt"

func anyOf(args ...any) {
    for i, a := range args {
        fmt.Printf("%d: %v (type %T)\n", i, a, a)
    }
}

func main() {
    anyOf(1, "hello", true, 3.14, []int{1, 2})
}
```

For `...any` (or `...interface{}`), each argument is **boxed** into an interface value. This is the source of allocation overhead in helpers like `fmt.Println`.

### 3.7 Method Receivers Cannot Be Variadic

A method's receiver list cannot use `...`. Only the parameter list can have a variadic.

```go
type T struct{}
// func (t ...T) M() {} // compile error
func (t T) M(args ...int) {} // OK
```

---

## 4. Type Rules

### 4.1 Variadic Parameter Type Inside the Function

For a parameter declared as `name ...T`, the parameter inside the function has type `[]T`. This affects how you pass it on:

```go
func outer(args ...int) {
    inner(args...) // forwarding: must use spread
}

func inner(args ...int) {}
```

### 4.2 Variadic Function Type Identity

Two function types are identical only if both are variadic or both are non-variadic. A non-variadic and a variadic function are NEVER identical even if their signatures otherwise match.

```go
package main

type A func(...int)
type B func([]int)

func main() {
    var a A = func(args ...int) {}
    // var b B = a // compile error: cannot use a (type A) as type B
    _ = a
}
```

### 4.3 Argument Conversion Rules

When calling `f(args ...T)`:
- Each literal argument must be **assignable to** `T`.
- The spread form `s...` requires `s` to be assignable to `[]T` exactly.

```go
package main

func sum(xs ...int) int { total := 0; for _, x := range xs { total += x }; return total }

func main() {
    sum(int32(1)) // compile error: cannot use int32(1) as int
    // Spread of []int32 also fails:
    var s []int32
    // sum(s...)   // compile error
    _ = s
}
```

### 4.4 Variadic of Interface Type Requires Explicit Boxing for Spread

`...interface{}` parameters allow heterogeneous arguments, but spreading a typed slice does NOT auto-box:

```go
package main

import "fmt"

func main() {
    nums := []int{1, 2, 3}
    // fmt.Println(nums...) // compile error: cannot use nums (type []int) as type []interface{}

    // Correct: explicit conversion:
    boxed := make([]any, len(nums))
    for i, n := range nums {
        boxed[i] = n
    }
    fmt.Println(boxed...)
}
```

---

## 5. Behavioral Specification

### 5.1 Implicit Slice Construction

When you call `f(a, b, c)`, the compiler constructs a slice `[]T{a, b, c}` and passes it as the parameter. For small variadic lists this slice is typically allocated on the **caller's stack** (since Go 1.4). For large or escaping cases it goes to the heap.

```go
package main

import "fmt"

func sum(xs ...int) int { total := 0; for _, x := range xs { total += x }; return total }

func main() {
    // Compiler synthesizes []int{1, 2, 3} on the stack and passes its slice header.
    fmt.Println(sum(1, 2, 3))
}
```

### 5.2 Spread Form Bypasses Construction

`f(s...)` passes `s`'s slice header directly — no new allocation.

### 5.3 Aliasing in the Spread Form

After `f(s...)`, the caller's `s` and the callee's `args` are aliases. The callee can modify elements (visible to caller) and re-slice (only the local view changes). Length and capacity changes via `append` may or may not be visible depending on whether `append` reallocates.

```go
package main

import "fmt"

func mutate(xs ...int) {
    if len(xs) > 0 {
        xs[0] = 999
    }
    xs = append(xs, 100) // local view extends; caller's slice header doesn't change
}

func main() {
    s := []int{1, 2, 3}
    mutate(s...)
    fmt.Println(s, len(s)) // [999 2 3] 3
}
```

### 5.4 Argument Evaluation Order

Variadic arguments are evaluated **left to right** like all other arguments:

```go
package main

import "fmt"

func args(xs ...int) { fmt.Println(xs) }

func gen(label string, v int) int {
    fmt.Println("eval", label)
    return v
}

func main() {
    args(gen("a", 1), gen("b", 2), gen("c", 3))
    // Output:
    // eval a
    // eval b
    // eval c
    // [1 2 3]
}
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Calling a variadic with zero args | Defined — parameter is `nil` slice |
| Calling a variadic with `s...` where `s` is nil | Defined — parameter is `nil` slice (same as zero args) |
| Mutating elements via the variadic parameter | Defined — changes visible to caller in spread form, isolated in literal form |
| Passing `s...` and then having the callee append beyond cap | Defined — append may reallocate; caller does not see growth |
| Mixing literal args with `...` (`f(1, 2, s...)`) | Compile error |
| `...` on a non-final parameter | Compile error |
| Spread with a slice of wrong element type | Compile error |
| Variadic call passing typed nil | Defined — receives a typed nil slice |

---

## 7. Edge Cases from Spec

### 7.1 Variadic Parameter With No Other Parameters

```go
package main

import "fmt"

func max(args ...int) int {
    if len(args) == 0 {
        return 0
    }
    best := args[0]
    for _, a := range args[1:] {
        if a > best {
            best = a
        }
    }
    return best
}

func main() {
    fmt.Println(max())          // 0
    fmt.Println(max(5))         // 5
    fmt.Println(max(3, 7, 1))   // 7
}
```

### 7.2 Variadic After Required Parameters

```go
package main

import "fmt"

func logf(level string, format string, args ...any) {
    fmt.Printf("[%s] "+format+"\n", append([]any{}, args...)...)
}

func main() {
    logf("INFO", "user %s connected from %s", "ada", "127.0.0.1")
}
```

### 7.3 Forwarding a Variadic

```go
package main

import "fmt"

func inner(prefix string, args ...any) {
    fmt.Println(prefix, args)
}

func outer(args ...any) {
    inner("forwarded:", args...) // spread to forward
}

func main() {
    outer("a", "b", "c")
}
```

### 7.4 Empty Spread of nil Slice

```go
package main

import "fmt"

func sum(xs ...int) int { total := 0; for _, x := range xs { total += x }; return total }

func main() {
    var nilSlice []int
    fmt.Println(sum(nilSlice...))  // 0  — same as sum()
    fmt.Println(sum())             // 0
}
```

### 7.5 Mixing Same-Type Values

The classic question: how do you concatenate two slices via a variadic?

```go
package main

import "fmt"

func main() {
    a := []int{1, 2, 3}
    b := []int{4, 5, 6}
    c := append(a, b...) // append IS variadic; b... spreads
    fmt.Println(c)       // [1 2 3 4 5 6]
}
```

### 7.6 Go 1.18+ Generic Variadic

```go
package main

import "fmt"

func Sum[T int | float64](xs ...T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}

func main() {
    fmt.Println(Sum(1, 2, 3))         // 6
    fmt.Println(Sum(1.5, 2.5, 3.0))   // 7
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Variadic parameters with `...T` syntax; spread with `s...` |
| Go 1.4 | Compiler began stack-allocating small variadic argument slices when they don't escape |
| Go 1.18 | Generic functions can be variadic with type parameter element type |
| Go 1.21 | `min`, `max`, `clear` built-ins are effectively variadic in usage |

---

## 9. Implementation-Specific Behavior

### 9.1 Slice Construction Cost

For `f(a, b, c)`, the compiler emits code equivalent to:

```go
tmp := [...]T{a, b, c}    // backing array
slice := tmp[:]           // slice header
f(slice)                  // call with []T arg
```

When the slice doesn't escape `f`, `tmp` is on the caller's stack (zero allocation). When it escapes, `tmp` is on the heap.

### 9.2 Spread Form Cost

`f(s...)` is essentially `f(s)` — no construction, no allocation. The function receives `s`'s slice header (24 bytes on 64-bit: pointer, length, capacity).

### 9.3 The `...any` Special Case

Variadic of an interface type forces each argument through interface-boxing. For `fmt.Println(1, "hi", true)`, three small allocations may occur (one per arg) plus the slice. Structured loggers like `zap` avoid this by exposing typed `Field` constructors.

---

## 10. Spec Compliance Checklist

- [ ] `...T` appears only on the last parameter
- [ ] No mixing of `...` spread with extra literal arguments at the call site
- [ ] Spread argument type matches `[]T` exactly (no implicit conversion)
- [ ] Function handles the zero-args case (nil slice)
- [ ] When forwarding, the variadic param is forwarded with `args...`
- [ ] Be aware that spread form aliases the caller's backing array

---

## 11. Official Examples

### Example 1: Basic Variadic

```go
package main

import "fmt"

func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

func main() {
    fmt.Println(sum())             // 0
    fmt.Println(sum(1))            // 1
    fmt.Println(sum(1, 2, 3, 4))   // 10

    nums := []int{10, 20, 30}
    fmt.Println(sum(nums...))      // 60
}
```

### Example 2: `fmt.Println` Style

```go
package main

import "fmt"

func myPrintln(args ...any) {
    for i, a := range args {
        if i > 0 {
            fmt.Print(" ")
        }
        fmt.Print(a)
    }
    fmt.Println()
}

func main() {
    myPrintln("the", "answer", "is", 42)
}
```

### Example 3: Forwarding (the `Errorf` pattern)

```go
package main

import "fmt"

func errorWith(code int, format string, args ...any) error {
    return fmt.Errorf("[E%03d] "+format, append([]any{}, args...)...)
}

func main() {
    err := errorWith(404, "user %s not found in %s", "ada", "primary")
    fmt.Println(err)
}
```

### Example 4: Aliasing Demo

```go
package main

import "fmt"

func swapFirst(xs ...int) {
    if len(xs) >= 2 {
        xs[0], xs[1] = xs[1], xs[0]
    }
}

func main() {
    s := []int{1, 2, 3}
    swapFirst(s...)
    fmt.Println(s) // [2 1 3] — caller sees the swap

    swapFirst(10, 20, 30)
    // No external observation possible — literal-form slice was synthesized
}
```

### Example 5: Invalid Variadic Constructs

```go
// 1. Variadic not last:
// func bad(rest ...int, x int) {} // ERROR

// 2. Mixing literal + spread:
// xs := []int{1,2,3}
// sum(0, xs...) // ERROR

// 3. Wrong element type in spread:
// var f []float64
// sum(f...) // ERROR (sum expects []int)

// 4. Spread of array, not slice:
// arr := [3]int{1,2,3}
// sum(arr...) // ERROR — arr is array, not slice
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Function types | https://go.dev/ref/spec#Function_types | Where variadic syntax is defined |
| Passing arguments to ... | https://go.dev/ref/spec#Passing_arguments_to_..._parameters | Argument evaluation rules |
| Slice types | https://go.dev/ref/spec#Slice_types | The parameter is a slice inside the function |
| Append built-in | https://go.dev/ref/spec#Appending_and_copying_slices | `append` is itself variadic |
| Function declarations | https://go.dev/ref/spec#Function_declarations | Parameter list grammar |
