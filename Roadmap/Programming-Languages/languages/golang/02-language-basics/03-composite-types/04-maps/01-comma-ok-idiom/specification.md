# Go Specification: The Comma-Ok Idiom

**Source:** https://go.dev/ref/spec#Index_expressions
**Section:** Expressions → Index expressions, Type assertions, Receive operator

---

## 1. Spec Reference

The comma-ok idiom is not a single spec section; it is the special two-value form permitted by three distinct spec rules:

- **Map index:** https://go.dev/ref/spec#Index_expressions
- **Type assertion:** https://go.dev/ref/spec#Type_assertions
- **Channel receive:** https://go.dev/ref/spec#Receive_operator

Representative wording (index expressions):

> "An index expression on a map `a` of type `map[K]V` used in an assignment or initialization of the special form `v, ok = a[x]` ... yields an additional untyped boolean value. The value of `ok` is `true` if the key `x` is present in the map, and `false` otherwise."

---

## 2. Formal Grammar (EBNF)

The idiom is a property of assignment/initialization with two left-hand operands, not new syntax:

```ebnf
Assignment      = ExpressionList assign_op ExpressionList .
ShortVarDecl    = IdentifierList ":=" ExpressionList .

// Special two-result forms (semantic, not grammatical):
//   v, ok  = m[key]          // map index
//   t, ok  = i.(T)           // type assertion
//   x, ok  = <-ch            // receive
```

```go
v, ok := m[key]   // map lookup
t, ok := i.(T)    // type assertion
x, ok := <-ch     // channel receive
```

---

## 3. Core Rules & Constraints

### 3.1 Map Index — Presence Test

`v, ok := m[k]` sets `v` to the value (or the value type's zero value if absent) and `ok` to whether `k` was present.

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1}
    v, ok := m["a"]
    fmt.Println(v, ok) // 1 true
    v, ok = m["z"]
    fmt.Println(v, ok) // 0 false  — 0 is the zero value of int
}
```

### 3.2 Type Assertion — Safe Form

`t, ok := i.(T)` sets `t` to the asserted value (or `T`'s zero value) and `ok` to whether the dynamic type matched. The safe form never panics.

```go
package main

import "fmt"

func main() {
    var i any = "hello"
    s, ok := i.(string)
    fmt.Println(s, ok) // hello true
    n, ok := i.(int)
    fmt.Println(n, ok) // 0 false — no panic
}
```

### 3.3 Channel Receive — Closed Detection

`x, ok := <-ch` sets `ok` to `false` when the channel is closed AND drained; otherwise `true`.

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 42
    close(ch)
    x, ok := <-ch
    fmt.Println(x, ok) // 42 true  — buffered value still available
    x, ok = <-ch
    fmt.Println(x, ok) // 0 false  — closed and empty
}
```

### 3.4 `ok` Is an Untyped Boolean

The second result is an untyped boolean; it may initialize a `bool` variable or be used directly in a condition.

---

## 4. Type Rules

### 4.1 First Result Type

- Map: the value type `V`.
- Type assertion: the asserted type `T`.
- Receive: the channel's element type.

### 4.2 Second Result Type

Always boolean. In `:=` it has type `bool`.

### 4.3 One-Value vs Two-Value Forms Differ in Panic Behavior

The single-value type assertion `t := i.(T)` **panics** if the type does not match. The two-value form never panics. Map index and receive do not panic in either form, but only the two-value form reports presence/closed state.

```go
package main

func main() {
    var i any = 123
    // _ = i.(string) // panic: interface conversion: any is int, not string
    _, _ = i.(string) // safe
}
```

### 4.4 The Special Form Requires Exactly Two LHS Operands

Using `_` for either operand is allowed; using three operands is a compile error.

```go
package main

func main() {
    m := map[string]int{}
    _, ok := m["x"] // discard value, keep ok
    v, _ := m["x"]  // keep value, discard ok
    _ = ok
    _ = v
}
```

---

## 5. Behavioral Specification

### 5.1 Zero Value on Failure

When the lookup/assertion/receive "fails," the first result is the zero value of its type — not undefined.

| Context | First result on failure |
|---------|-------------------------|
| Map index, key absent | zero value of `V` |
| Type assertion mismatch | zero value of `T` |
| Receive on closed+empty | zero value of element type |

### 5.2 Distinguishing Absent Key From Zero-Valued Entry

The idiom is the only way to tell "key absent" from "key present with zero value."

```go
package main

import "fmt"

func main() {
    counts := map[string]int{"seen": 0}
    if v, ok := counts["seen"]; ok {
        fmt.Println("present with value", v) // present with value 0
    }
    if _, ok := counts["never"]; !ok {
        fmt.Println("absent")                // absent
    }
}
```

### 5.3 Receive `ok` Semantics Are About the Channel, Not the Value

`ok == false` means the channel is closed and drained. A zero value with `ok == true` is a legitimately sent zero.

### 5.4 Use in `if` With Init Statement

The idiom is idiomatically combined with an `if` init statement to scope the result.

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1}
    if v, ok := m["a"]; ok {
        fmt.Println(v)
    }
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Safe Assertion Never Panics

The two-value type assertion is guaranteed never to panic, even on a nil interface.

```go
package main

import "fmt"

func main() {
    var i any // nil
    s, ok := i.(string)
    fmt.Printf("%q %v\n", s, ok) // "" false
}
```

### 6.2 Defined: Receive on Nil Channel Blocks Forever

`<-ch` on a nil channel blocks forever regardless of comma-ok; the idiom does not make it non-blocking.

### 6.3 Defined: Map Index Never Panics

A read index on a nil map returns the zero value with `ok == false`; it does not panic (only writing to a nil map panics).

```go
package main

import "fmt"

func main() {
    var m map[string]int // nil
    v, ok := m["x"]
    fmt.Println(v, ok) // 0 false
}
```

### 6.4 Defined: Single-Value Assertion Panic Is Recoverable

The panic from `i.(T)` is an ordinary runtime panic and can be recovered; but the two-value form is the idiomatic way to avoid it.

---

## 7. Edge Cases from Spec

### 7.1 Asserting to an Interface Type

`v, ok := i.(SomeInterface)` checks whether the dynamic type implements `SomeInterface`.

```go
package main

import "fmt"

type Stringer interface{ String() string }

type T struct{}
func (T) String() string { return "T" }

func main() {
    var i any = T{}
    s, ok := i.(Stringer)
    fmt.Println(ok, s.String()) // true T
}
```

### 7.2 Comma-Ok Only in Assignment Context

The two-value form is only valid in an assignment or short variable declaration. It cannot appear as a general expression (e.g., as a function argument expecting one value).

```go
package main

func main() {
    m := map[string]int{}
    // f(m["x"], ok)        // illegal: comma-ok is not an expression here
    v, ok := m["x"]
    _ = v
    _ = ok
}
```

### 7.3 Receiving From a Buffered Closed Channel

A closed channel still yields buffered values with `ok == true` until drained, then yields zero with `ok == false`.

### 7.4 Map Value Is a Struct

The zero value returned for an absent key of a struct-valued map is the struct's zero value, fully usable.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Comma-ok forms for map index, type assertion, and receive defined |
| Go 1.0 | Single-value type assertion panic semantics defined |
| Go 1.18 | `any` alias for `interface{}` makes assertion code more readable (no semantic change) |
| Go 1.21 | No change to comma-ok semantics |

---

## 9. Implementation-Specific Behavior

### 9.1 Map Access Lowering

The gc compiler lowers `v, ok := m[k]` to a runtime call such as `runtime.mapaccess2`, which returns a pointer to the value and a boolean found flag. The single-value form calls `mapaccess1`.

### 9.2 Type Assertion Lowering

`t, ok := i.(T)` compiles to a type-comparison against the interface's type descriptor (itab/type pointer). For concrete `T` it is a pointer comparison; for interface `T` it checks method-set satisfaction, possibly via a cached itab.

### 9.3 No Extra Allocation

None of the comma-ok forms allocate; the boolean is returned in a register. The first result for value types is returned by value or via a pointer the caller reads.

---

## 10. Spec Compliance Checklist

- [ ] `v, ok := m[k]` — `ok` true iff key present; `v` is zero value if absent
- [ ] `t, ok := i.(T)` — safe form, never panics
- [ ] `x, ok := <-ch` — `ok` false iff channel closed and drained
- [ ] Single-value `i.(T)` panics on mismatch; two-value form does not
- [ ] First result on failure is the zero value of its type
- [ ] The idiom distinguishes "absent key" from "present zero value"
- [ ] Reading a nil map returns zero + false (no panic)
- [ ] Two-value form is only valid in assignment / short var decl
- [ ] `_` may discard either result
- [ ] `ok` is an untyped boolean (type `bool` under `:=`)
- [ ] Asserting to an interface type checks method-set satisfaction

---

## 11. Official Examples

### Example 1: Map Presence

```go
package main

import "fmt"

func main() {
    cache := map[string][]byte{"k": {1, 2, 3}}
    if data, ok := cache["k"]; ok {
        fmt.Println("hit:", data)
    } else {
        fmt.Println("miss")
    }
}
```

### Example 2: Safe Type Switch Alternative

```go
package main

import "fmt"

func describe(i any) string {
    if s, ok := i.(string); ok {
        return "string: " + s
    }
    if n, ok := i.(int); ok {
        return fmt.Sprintf("int: %d", n)
    }
    return "unknown"
}

func main() {
    fmt.Println(describe("hi"))  // string: hi
    fmt.Println(describe(42))    // int: 42
    fmt.Println(describe(3.14))  // unknown
}
```

### Example 3: Draining a Closed Channel

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    close(ch)
    for {
        v, ok := <-ch
        if !ok {
            break
        }
        fmt.Println(v) // 1, then 2
    }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Index expressions | https://go.dev/ref/spec#Index_expressions | Map two-value index form |
| Type assertions | https://go.dev/ref/spec#Type_assertions | Safe `t, ok := i.(T)` form |
| Receive operator | https://go.dev/ref/spec#Receive_operator | `x, ok := <-ch` closed detection |
| Assignments | https://go.dev/ref/spec#Assignments | Two-operand assignment context |
| Map types | https://go.dev/ref/spec#Map_types | Map semantics and zero values |
| Channel types | https://go.dev/ref/spec#Channel_types | Channel close behavior |
| The zero value | https://go.dev/ref/spec#The_zero_value | Result on failed lookup |
| Blank identifier | https://go.dev/ref/spec#Blank_identifier | Discarding a result with `_` |
