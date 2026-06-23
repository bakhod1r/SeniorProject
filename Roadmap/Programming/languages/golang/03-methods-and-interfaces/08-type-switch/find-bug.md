# Go Type Switch — Find the Bug

## Instructions

Each exercise contains buggy Go code involving type switches or related patterns. Identify the bug, explain why, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Type Switch on a Concrete Type

```go
package main

import "fmt"

func main() {
    n := 5
    switch v := n.(type) {
    case int:
        fmt.Println("int:", v)
    case string:
        fmt.Println("string:", v)
    }
}
```

What happens?

<details>
<summary>Solution</summary>

**Bug**: `n` has static type `int`, not an interface type. Type switches require an **interface** operand. The compiler rejects this:

```
./main.go:7:13: cannot type switch on non-interface value n (variable of type int)
```

**Fix** — make the operand an interface:

```go
var n any = 5
switch v := n.(type) {
case int:
    fmt.Println("int:", v)
case string:
    fmt.Println("string:", v)
}
```

**Key lesson**: Type switches inspect the **dynamic** type of an interface value. A concrete-type variable already has a known static type, so there's nothing to switch on.
</details>

---

## Bug 2 🟢 — Missing `default` for Unknown Types

```go
package main

import "fmt"

type Cmd any

func handle(c Cmd) string {
    switch v := c.(type) {
    case string:
        return "string: " + v
    case int:
        return fmt.Sprintf("int: %d", v)
    }
    return "" // silently returns empty
}

func main() {
    fmt.Println(handle(3.14))   // unexpected: ""
    fmt.Println(handle(true))   // unexpected: ""
    fmt.Println(handle(nil))    // unexpected: ""
}
```

What's wrong?

<details>
<summary>Solution</summary>

**Bug**: No `default` clause. Anything not `string` or `int` silently falls through to the empty return. Bugs hide because nothing tells you a new type was missed.

**Fix** — add a `default` that at minimum logs or errors:

```go
func handle(c Cmd) string {
    switch v := c.(type) {
    case string:
        return "string: " + v
    case int:
        return fmt.Sprintf("int: %d", v)
    case nil:
        return "<nil>"
    default:
        return fmt.Sprintf("unsupported type %T", v)
    }
}
```

**Key lesson**: For type switches over `any` or any open interface, always include `default`. Use it to log, error, or panic with diagnostic info — never to silently fall through.
</details>

---

## Bug 3 🟢 — Shadowing `v` Inside the Case Body

```go
package main

import "fmt"

func describe(x any) {
    switch v := x.(type) {
    case []int:
        v := len(v) // BUG?
        fmt.Println("slice of length", v)
    case string:
        v := len(v)
        fmt.Println("string of length", v)
    default:
        fmt.Println("unknown:", v)
    }
}

func main() {
    describe([]int{1, 2, 3})
    describe("abc")
}
```

The author thinks this works correctly. What's the issue?

<details>
<summary>Solution</summary>

**Discussion**: The code does work, but the inner `v := len(v)` **shadows** the typed `v`. Inside that block, `v` is now an `int` (the length), not the slice or string. If the author later adds code below `v := len(v)` that needs the original typed `v`, it'll break.

```go
case []int:
    v := len(v)
    fmt.Println("slice of length", v)
    fmt.Println("first element:", v[0]) // compile error — v is int now
```

**Fix** — rename the shadow:

```go
case []int:
    n := len(v)
    fmt.Println("slice of length", n)
    fmt.Println("first element:", v[0])
```

**Key lesson**: The bound `v` in a type switch case is precious — it's already correctly typed. Don't reassign or shadow it; introduce a new name for derived values.
</details>

---

## Bug 4 🟢 — Using `==` Instead of `case T:`

```go
package main

import (
    "fmt"
    "reflect"
)

func describe(x any) string {
    t := reflect.TypeOf(x)
    switch t {
    case int: // BUG
        return "int"
    case string:
        return "string"
    }
    return "?"
}

func main() {
    fmt.Println(describe(5))
}
```

<details>
<summary>Solution</summary>

**Bug**: `case int:` here treats `int` as a value, but `int` is a type — not a `reflect.Type` value. Compile error:

```
./main.go:10:10: int (type) is not an expression
```

Even if you fix the syntax (`case reflect.TypeOf(int(0)):`), this is a roundabout way to do something the language has built in.

**Fix** — use a real type switch:

```go
func describe(x any) string {
    switch x.(type) {
    case int:
        return "int"
    case string:
        return "string"
    }
    return "?"
}
```

**Key lesson**: Don't reach for `reflect.TypeOf` to drive a switch. The `x.(type)` form exists for exactly this purpose, is faster, and the syntax is checked at compile time.
</details>

---

## Bug 5 🟡 — Case Order Matters for Interface Types

```go
package main

import (
    "fmt"
    "net"
)

func reportErr(err error) {
    switch e := err.(type) {
    case net.Error: // BUG: too broad
        fmt.Println("net error, timeout:", e.Timeout())
    case *net.OpError:
        fmt.Println("op:", e.Op, "addr:", e.Addr)
    case nil:
        fmt.Println("no error")
    default:
        fmt.Println("other:", err)
    }
}

func main() {
    _, err := net.Dial("tcp", "127.0.0.1:0") // typically *net.OpError
    reportErr(err)
}
```

<details>
<summary>Solution</summary>

**Bug**: `*net.OpError` implements `net.Error`. Because the `net.Error` case is listed **first**, every `*net.OpError` matches it — the second case is dead code.

**Fix** — order from most specific to least specific:

```go
func reportErr(err error) {
    switch e := err.(type) {
    case nil:
        fmt.Println("no error")
    case *net.OpError:
        fmt.Println("op:", e.Op, "addr:", e.Addr)
    case net.Error:
        fmt.Println("net error, timeout:", e.Timeout())
    default:
        fmt.Println("other:", err)
    }
}
```

**Key lesson**: When interface types appear in case clauses, **the first match wins**. List concrete types (and narrower interfaces) before broader interface types. `staticcheck` SA4020 catches some of these but not all.
</details>

---

## Bug 6 🟡 — `case nil:` Doesn't Match Typed Nil

```go
package main

import "fmt"

func describe(x any) {
    switch x.(type) {
    case nil:
        fmt.Println("nil!")
    case *int:
        fmt.Println("*int")
    }
}

func main() {
    var p *int
    var x any = p
    describe(x)        // expected "nil!" — actually prints "*int"
    describe(nil)      // prints "nil!"
}
```

What's going on?

<details>
<summary>Solution</summary>

**Bug**: A nil `*int` boxed into an `any` is NOT a nil interface. The interface still has a non-nil dynamic type (`*int`); only the data pointer is nil. So it matches `case *int:`, not `case nil:`.

**Fix** — handle the typed-nil case explicitly:

```go
switch v := x.(type) {
case nil:
    fmt.Println("nil interface")
case *int:
    if v == nil {
        fmt.Println("*int (nil)")
    } else {
        fmt.Println("*int:", *v)
    }
}
```

**Key lesson**: `case nil:` matches only the **untyped nil** interface (no dynamic type). A typed-nil pointer matches its concrete type case. Inspect the bound `v` for nil if needed.
</details>

---

## Bug 7 🟡 — Multi-Type Case With Typed Access

```go
package main

import "fmt"

func double(x any) any {
    switch v := x.(type) {
    case int, int64:
        return v * 2 // BUG
    case float64:
        return v * 2
    }
    return nil
}

func main() {
    fmt.Println(double(5))
}
```

<details>
<summary>Solution</summary>

**Bug**: In a multi-type case, the bound `v` keeps the **switch operand's interface type** (here `any`). You can't apply `*` to `any`.

```
./main.go:8:16: invalid operation: v * 2 (mismatched types interface {} and int)
```

**Fix** (option A — split the cases):

```go
switch v := x.(type) {
case int:
    return v * 2
case int64:
    return v * 2
case float64:
    return v * 2
}
```

**Fix** (option B — drop the typed access and use reflect):

```go
case int, int64:
    return reflect.ValueOf(x).Int() * 2 // returns int64
```

**Key lesson**: Multi-type cases are useful only when the body doesn't depend on the specific case type. If you need typed access, split into one case per type.
</details>

---

## Bug 8 🟡 — `fallthrough` in a Type Switch

```go
package main

import "fmt"

func describe(x any) {
    switch v := x.(type) {
    case int:
        fmt.Println("number:", v)
        fallthrough // BUG
    case string:
        fmt.Println("also stringable")
    }
}

func main() {
    describe(5)
}
```

<details>
<summary>Solution</summary>

**Bug**: `fallthrough` is illegal in a type switch. Compile error:

```
./main.go:9:9: cannot fallthrough in type switch
```

The reason: cases bind `v` to different types, and `fallthrough` would carry an int into a string case. Allowing it would break the type system.

**Fix** — extract shared logic into a helper:

```go
func handleStringable(s string) { fmt.Println("also stringable") }

func describe(x any) {
    switch v := x.(type) {
    case int:
        fmt.Println("number:", v)
        handleStringable(fmt.Sprintf("%d", v))
    case string:
        handleStringable(v)
    }
}
```

**Key lesson**: There's no `fallthrough` in type switches. Refactor shared logic into a helper or duplicate the call.
</details>

---

## Bug 9 🟡 — Type Assertion Comma-OK Mistaken for a Type Switch

```go
package main

import "fmt"

func main() {
    var x any = "hello"
    if v, ok := x.(int); ok { // works — comma-ok type assertion
        fmt.Println("int:", v)
    }
    
    // Now the author tries to "type-switch" inline
    if v, ok := x.(type); ok { // BUG?
        fmt.Println(v)
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: `x.(type)` is only legal as the operand of a type switch — never inside an `if`, never with comma-ok. Compile error:

```
./main.go:11:18: use of .(type) outside type switch
```

The comma-ok form `v, ok := x.(T)` is a **type assertion**, not a type switch. `T` must be a real type, not the keyword `type`.

**Fix** — pick the right tool:

```go
// Single type — use comma-ok assertion:
if v, ok := x.(string); ok {
    fmt.Println("string:", v)
}

// Multiple types — use a type switch:
switch v := x.(type) {
case int:
    fmt.Println("int:", v)
case string:
    fmt.Println("string:", v)
}
```

**Key lesson**: `x.(type)` is syntax exclusive to the type-switch form. Comma-ok needs a concrete type. Don't mix them.
</details>

---

## Bug 10 🔴 — Bound `v` In `default` Has Operand's Type

```go
package main

import "fmt"

func process(x any) {
    switch v := x.(type) {
    case int:
        fmt.Println("int:", v+1)
    case string:
        fmt.Println("string:", v+"!")
    default:
        fmt.Println("default:", v.SomeMethod()) // BUG
    }
}

type Doer interface {
    SomeMethod() string
}

func main() {
    process(struct{}{})
}
```

<details>
<summary>Solution</summary>

**Bug**: In the `default` case, `v` has the **operand's type** — `any`. `any` has no methods. Compile error:

```
./main.go:11:36: v.SomeMethod undefined (type interface {} has no field or method SomeMethod)
```

**Fix** — assert if you need a specific interface, or add a typed case:

```go
default:
    if d, ok := v.(Doer); ok {
        fmt.Println("default:", d.SomeMethod())
    } else {
        fmt.Println("default:", v)
    }
```

Or add `case Doer:` before `default`:

```go
case Doer:
    fmt.Println("doer:", v.SomeMethod())
default:
    fmt.Println("default:", v)
```

**Key lesson**: `v` in `default` keeps the operand's static interface type. To call a typed method, narrow further with a comma-ok assertion or add a specific case.
</details>

---

## Bug 11 🔴 — Type Switch Outside the `switch` Statement

```go
package main

import "fmt"

func main() {
    var x any = 5
    
    if x.(type) == int { // BUG
        fmt.Println("int")
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: `x.(type)` is only valid as the **direct operand** of a type switch. Anywhere else, it's a syntax error.

```
./main.go:7:8: use of .(type) outside type switch
```

**Fix** — type assertion or a real type switch:

```go
// Option A — type assertion:
if _, ok := x.(int); ok {
    fmt.Println("int")
}

// Option B — type switch:
switch x.(type) {
case int:
    fmt.Println("int")
}
```

**Key lesson**: `.(type)` is a special form, not a general expression.
</details>

---

## Bug 12 🔴 — Sealed Interface With Forgotten Implementation

```go
package main

import "fmt"

type Shape interface{ shape() }

type Circle struct{ R float64 }
func (Circle) shape() {}

type Square struct{ S float64 }
func (Square) shape() {}

// Later, a developer adds:
type Triangle struct{ B, H float64 }
func (Triangle) shape() {}

func area(s Shape) float64 {
    switch x := s.(type) {
    case Circle:
        return 3.14 * x.R * x.R
    case Square:
        return x.S * x.S
    // forgot to add Triangle
    }
    return 0 // silently returns 0
}

func main() {
    fmt.Println(area(Triangle{B: 3, H: 4})) // expected 6, gets 0
}
```

<details>
<summary>Solution</summary>

**Bug**: Adding a new sealed-interface implementation didn't update every type switch. The compiler doesn't enforce exhaustiveness. The new `Triangle` falls through to the implicit empty default, returning 0.

**Fix** (immediate):

```go
case Triangle:
    return 0.5 * x.B * x.H
```

**Fix** (preventive):
1. Use the `exhaustive` linter with sealed-interface enforcement.
2. Add a default that panics on unknown types — bugs surface immediately.

```go
default:
    panic(fmt.Sprintf("area: unhandled shape %T", x))
```

**Key lesson**: Sealed interfaces don't grant exhaustiveness. Combine sealed-interface convention with a panicking default and a linter.
</details>

---

## Bug 13 🔴 — Interface Type Case Hidden by Concrete Subtype

```go
package main

import "fmt"

type Stringable interface{ String() string }

type Custom struct{ V int }
func (c Custom) String() string { return fmt.Sprintf("Custom(%d)", c.V) }

func describe(x any) string {
    switch v := x.(type) {
    case Custom: // first
        return "Custom: " + v.String()
    case Stringable: // second — would have matched Custom too
        return v.String()
    }
    return "?"
}

func main() {
    fmt.Println(describe(Custom{V: 1})) // ok
    fmt.Println(describe(Custom{V: 2})) // also ok
}
```

The author wonders if the order is wrong. What's the issue?

<details>
<summary>Solution</summary>

**Discussion**: This particular order is correct: `Custom` matches first, the `Stringable` case is fine for any *other* `Stringable` type. But if the author **swapped** the order, every `Custom` would match `Stringable` first and the dedicated `Custom` case would be dead code.

`staticcheck` SA4020 should flag this when the order is reversed.

**Best practice** — list the most specific case first:

```go
switch v := x.(type) {
case Custom:        // specific concrete type
    return "custom: " + v.String()
case Stringable:    // broader interface
    return v.String()
default:
    return "?"
}
```

**Key lesson**: When a concrete type implements an interface, the concrete case must come before the interface case to be reachable. Order is part of the contract; reordering during refactoring can silently break code.
</details>

---

## Bug 14 🔴 — Captured Closure With Type-Switched Variable

```go
package main

import "fmt"

func makeFns(values []any) []func() string {
    fns := []func() string{}
    for _, v := range values {
        switch t := v.(type) {
        case int:
            fns = append(fns, func() string {
                return fmt.Sprintf("int: %d", t)
            })
        case string:
            fns = append(fns, func() string {
                return fmt.Sprintf("string: %s", t)
            })
        }
    }
    return fns
}

func main() {
    fns := makeFns([]any{1, "a", 2, "b"})
    for _, f := range fns {
        fmt.Println(f())
    }
}
```

What's the issue (and what version of Go matters)?

<details>
<summary>Solution</summary>

**Discussion**: Each closure captures `t` from its case. In Go 1.22+, the loop variable `v` (and the case-bound `t`) are per-iteration, so each closure captures a distinct `t`. **Outputs work correctly**:

```
int: 1
string: a
int: 2
string: b
```

But in **Go 1.21 or earlier**, the situation is more nuanced:
- The outer `v` is shared across iterations (pre-1.22 semantics).
- The inner `t` from the type switch is a fresh variable per case body — but it's bound from the shared `v`.
- The closures capture distinct `t` values, but `t` may have been computed from a shared/changing `v` if the case is re-entered.

In practice, because each iteration creates a new `t` in scope of the case body, and the closure is constructed per iteration, this works in pre-1.22 too — but only because the case-bound `t` is a fresh binding.

**Key lesson** (broader): Closures capturing type-switch-bound variables interact with Go 1.22's loop-variable semantics. Always test your closures against the target Go version.

**Defensive idiom** (works in any Go version):

```go
case int:
    t := t // shadow to be explicit
    fns = append(fns, func() string { return fmt.Sprintf("int: %d", t) })
```
</details>

---

## Bug 15 🔴 — Mistaken `case` for `error` Wrapping

```go
package main

import (
    "errors"
    "fmt"
    "io"
)

type MyErr struct{ Code int }

func (e *MyErr) Error() string { return fmt.Sprintf("MyErr(%d)", e.Code) }

func handle(err error) string {
    switch err.(type) {
    case *MyErr:
        return "my error"
    case nil:
        return "no error"
    }
    return "other"
}

func main() {
    base := &MyErr{Code: 1}
    wrapped := fmt.Errorf("context: %w", base)
    fmt.Println(handle(wrapped)) // expected "my error", gets "other"
    fmt.Println(handle(io.EOF))  // "other"
}
```

<details>
<summary>Solution</summary>

**Bug**: A type switch checks the **top-level** dynamic type. Wrapped errors have a different top-level type (`*fmt.wrapError` here); the wrapped `*MyErr` is hidden inside.

**Fix** — use `errors.As` to walk the chain:

```go
func handle(err error) string {
    if err == nil {
        return "no error"
    }
    var my *MyErr
    if errors.As(err, &my) {
        return "my error"
    }
    return "other"
}
```

If you need a switch-like syntax with multiple error types, combine `errors.As` calls or use a sequence of checks. Type switches don't unwrap.

**Key lesson**: For error types, prefer `errors.Is` (sentinel) and `errors.As` (typed). Use type switches on errors only when you've explicitly opted out of wrapping.
</details>

---

## Summary of the 5 Mandated Bugs

1. **Type switch on non-interface value** — Bug 1.
2. **Missing default for unknown types** — Bug 2.
3. **Shadowing `v` in case branch** — Bug 3.
4. **Using `==`/`reflect.TypeOf` instead of `case T:`** — Bug 4.
5. **Type switch order significance with interface satisfaction** — Bug 5 (and Bug 13).
