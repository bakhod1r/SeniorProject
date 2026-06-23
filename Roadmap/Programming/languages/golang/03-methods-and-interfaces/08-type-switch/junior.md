# Go Type Switch — Junior Level

## 1. Introduction

### What is it?
A **type switch** is a special form of `switch` statement that branches on the **dynamic type** stored inside an interface value. Instead of comparing on equality, each `case` matches a specific type. The matched value is exposed in a typed local variable that you can use directly inside the case body.

A type switch lets you ask "what concrete type is currently inside this interface?" and then act accordingly — without writing a chain of type assertions and `if/else` blocks.

### How to use it?
```go
package main

import "fmt"

func describe(x any) {
    switch v := x.(type) {
    case int:
        fmt.Println("int:", v+1)
    case string:
        fmt.Println("string of length", len(v))
    case nil:
        fmt.Println("nil interface")
    default:
        fmt.Printf("unknown type %T\n", v)
    }
}

func main() {
    describe(42)
    describe("hello")
    describe(nil)
    describe(3.14)
}
```

The expression `x.(type)` is only legal as the operand of a type switch. Inside each case, `v` has the type written in the case clause.

---

## 2. Prerequisites
- Switch statement (2.4.3)
- Interfaces (basic understanding of `any` / `interface{}`)
- Type assertions (`x.(T)` and `v, ok := x.(T)`)
- Static vs dynamic type concept

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| type switch | A switch whose cases match types instead of values |
| type assertion | Expression `x.(T)` that extracts a concrete type from an interface |
| interface value | A pair of (dynamic type, dynamic value) stored at runtime |
| static type | The type written in source code for a variable |
| dynamic type | The actual concrete type held at runtime by an interface value |
| case clause | A `case T:` (or `case T1, T2:`) line in a type switch |
| default clause | The fallback case that runs when no other case matches |
| comma-ok form | `v, ok := x.(T)` — a type assertion that doesn't panic on mismatch |
| empty interface | `interface{}` (alias `any`); accepts any value |
| nil case | A `case nil:` that matches a nil interface value |

---

## 4. Core Concepts

### 4.1 Basic Syntax

The two valid forms are:

```go
// Form A — capture the typed value in v
switch v := x.(type) {
case T1:
    // v has type T1 here
case T2:
    // v has type T2 here
default:
    // v has the same type as x (the interface type) here
}

// Form B — discard the typed value
switch x.(type) {
case T1:
    // no v in scope
case T2:
}
```

Form A is far more common because the typed value is usually exactly what you want to work with.

```go
package main

import "fmt"

func main() {
    var x any = 42
    switch v := x.(type) {
    case int:
        fmt.Println("int:", v*2) // v is int here
    case string:
        fmt.Println("string:", v + "!") // v is string here
    }
}
```

### 4.2 The Operand Must Be an Interface

A type switch only works on **interface** values. You cannot type-switch on a concrete type like `int` or `*Foo`:

```go
var n int = 5
switch v := n.(type) { // compile error: invalid type switch on n (n has type int)
case int:
    _ = v
}
```

The compiler rejects this because there's no dynamic type to inspect — the static type already tells you everything.

If you want a type switch, the operand must be `any`, `error`, or some other interface type:

```go
var x any = 5
switch v := x.(type) { // OK — x is an interface value
case int:
    _ = v
}
```

### 4.3 Multiple Types Per Case

A single case may list several types separated by commas:

```go
package main

import "fmt"

func numericLike(x any) bool {
    switch x.(type) {
    case int, int32, int64, float32, float64:
        return true
    default:
        return false
    }
}

func main() {
    fmt.Println(numericLike(1))     // true
    fmt.Println(numericLike(1.5))   // true
    fmt.Println(numericLike("hi"))  // false
}
```

When a case lists multiple types, the bound variable `v` keeps the **interface type of the switch expression** inside that case body — not any specific listed type. So you can't do `v + 1` in `case int, int32:` because the compiler doesn't know which one it is.

```go
switch v := x.(type) {
case int, int64: // v has type any here, NOT int or int64
    fmt.Println(v) // OK
    // v + 1       // compile error: operator + not defined on any
}
```

To keep the typed access, use one type per case.

### 4.4 The `default` Clause

`default` matches anything not covered by the other cases. Inside `default`, the bound variable `v` has the same type as the switch operand (typically `any`):

```go
package main

import "fmt"

func main() {
    var x any = 3.14
    switch v := x.(type) {
    case int:
        fmt.Println("int", v)
    case string:
        fmt.Println("string", v)
    default:
        fmt.Printf("type %T value %v\n", v, v) // any
    }
}
```

`default` can appear in any position — top, middle, or bottom — but conventionally goes last.

### 4.5 The `nil` Case

A nil interface (one with no dynamic type) matches `case nil`:

```go
package main

import "fmt"

func main() {
    var x any
    switch x.(type) {
    case nil:
        fmt.Println("got nil interface")
    case int:
        fmt.Println("got int")
    }
}
```

Note that a non-nil interface holding a nil pointer (e.g., `var p *Foo; var i any = p`) does NOT match `case nil` — it matches `case *Foo` with a nil-valued `v`.

### 4.6 Comparison With Type Assertion

A type assertion is the single-shot version:

```go
v, ok := x.(int) // ok = true if dynamic type is exactly int
if ok {
    fmt.Println(v + 1)
}
```

A type switch is preferred when you have several types to handle:

```go
switch v := x.(type) {
case int:
    fmt.Println(v + 1)
case string:
    fmt.Println(v + "!")
case bool:
    fmt.Println(!v)
}
```

The same logic with chained type assertions is verbose and error-prone:

```go
if v, ok := x.(int); ok {
    fmt.Println(v + 1)
} else if v, ok := x.(string); ok {
    fmt.Println(v + "!")
} else if v, ok := x.(bool); ok {
    fmt.Println(!v)
}
```

The type switch is also slightly faster because it shares one type read across all branches.

---

## 5. Common Mistakes

### Mistake 1 — Type Switch on a Concrete Type

```go
// BAD
n := 5
switch v := n.(type) { // compile error
case int:
    _ = v
}
```

```go
// GOOD
var n any = 5
switch v := n.(type) {
case int:
    _ = v
}
```

### Mistake 2 — Forgetting `default`

```go
// BAD — silently ignores unknown types
switch v := x.(type) {
case int:
    return v
case string:
    n, _ := strconv.Atoi(v)
    return n
}
return 0 // dead code if cases are exhaustive — but they aren't for `any`
```

```go
// GOOD — log or error on unexpected types
switch v := x.(type) {
case int:
    return v
case string:
    n, _ := strconv.Atoi(v)
    return n
default:
    panic(fmt.Sprintf("unsupported type %T", v))
}
```

### Mistake 3 — Using `==` Instead of `case T:`

```go
// BAD — compile error
switch t := reflect.TypeOf(x); t {
case int: // int is a type, not a value
    _ = t
}
```

```go
// GOOD — proper type switch
switch v := x.(type) {
case int:
    _ = v
}
```

### Mistake 4 — Multi-Type Case Then Using `v` as a Specific Type

```go
// BAD
switch v := x.(type) {
case int, int64:
    fmt.Println(v + 1) // compile error: v is any here
}
```

```go
// GOOD — split the cases
switch v := x.(type) {
case int:
    fmt.Println(v + 1)
case int64:
    fmt.Println(v + 1)
}
```

### Mistake 5 — Expecting `fallthrough` to Work

```go
// BAD — compile error
switch v := x.(type) {
case int:
    fmt.Println(v)
    fallthrough // illegal in type switch
case string:
    _ = v
}
```

`fallthrough` is rejected by the compiler in type switches because the typed `v` would change between cases.

```go
// GOOD — duplicate the action or extract a helper
switch v := x.(type) {
case int:
    handle(v)
    handle("after-int") // explicit
case string:
    handle(v)
}
```

---

## 6. Mini Exercises

### Exercise 1
Write `kind(x any) string` returning `"int"`, `"string"`, `"bool"`, `"nil"`, or `"other"`.

<details>
<summary>Solution</summary>

```go
func kind(x any) string {
    switch x.(type) {
    case int:
        return "int"
    case string:
        return "string"
    case bool:
        return "bool"
    case nil:
        return "nil"
    default:
        return "other"
    }
}
```
</details>

### Exercise 2
Write `sum(values ...any) int` that adds all `int` and `int64` values, ignoring others.

<details>
<summary>Solution</summary>

```go
func sum(values ...any) int {
    total := 0
    for _, x := range values {
        switch v := x.(type) {
        case int:
            total += v
        case int64:
            total += int(v)
        }
    }
    return total
}
```
</details>

### Exercise 3
Write `stringify(x any) string` that returns a friendly string for `int`, `float64`, `string`, `[]byte`, `nil`, and panics on anything else.

<details>
<summary>Solution</summary>

```go
import (
    "fmt"
    "strconv"
)

func stringify(x any) string {
    switch v := x.(type) {
    case int:
        return strconv.Itoa(v)
    case float64:
        return strconv.FormatFloat(v, 'f', -1, 64)
    case string:
        return v
    case []byte:
        return string(v)
    case nil:
        return "<nil>"
    default:
        panic(fmt.Sprintf("unsupported type %T", v))
    }
}
```
</details>

### Exercise 4
Build `flatten(values []any) []any` that, given a list possibly containing nested `[]any`, returns a flat list. Use a type switch on each element.

<details>
<summary>Solution</summary>

```go
func flatten(values []any) []any {
    out := make([]any, 0, len(values))
    for _, v := range values {
        switch s := v.(type) {
        case []any:
            out = append(out, flatten(s)...)
        default:
            out = append(out, v)
        }
    }
    return out
}
```
</details>

### Exercise 5
Write `isError(x any) bool` that returns true if `x` implements `error`. Use a type switch.

<details>
<summary>Solution</summary>

```go
func isError(x any) bool {
    switch x.(type) {
    case error:
        return true
    default:
        return false
    }
}
```

Alternatively, a single type assertion: `_, ok := x.(error); return ok`. The type switch form is useful when you need additional cases.
</details>

---

## 7. Real-World Analogies

**Sorting mail by envelope shape**: a type switch is like checking the shape of an envelope and routing it accordingly. A square envelope goes to invitations, a long one to bills, a padded one to packages. You don't open the envelope first — you act based on the shape (the type), then handle the contents (the typed value).

**A vending machine slot detector**: the slot looks at coin diameter and weight and routes the coin into the right tray. Each case is a coin type; the matched value is the coin you can now process.

**Customs at the airport**: officers check the type of declaration (food, electronics, drugs, nothing) and apply different procedures. The type switch is the form-checker; each case is the corresponding inspector.

---

## 8. Mental Model

```
        x : any
        ┌─────────────┐
        │  type tag   │ ── inspected by (.type)
        │  data ptr   │
        └──────┬──────┘
               │
       ┌───────┴────────┐
       │ which type?    │
       └─┬───┬───┬───┬──┘
         │   │   │   │
       int  str bool default
        v   v   v   v
       int  str bool any
```

A type switch reads the type tag from the interface header, picks a branch, and binds `v` with the matching static type.

---

## 9. Pros & Cons

### Pros
- Clear, readable multi-type dispatch
- Bound variable `v` is automatically typed
- Faster than chained type assertions
- Supports `nil` case and a default branch
- Multiple types per case allowed

### Cons
- Only works on interface values
- No `fallthrough` (cases aren't homogeneous)
- Multi-type case loses the typed `v`
- Not exhaustively checked by the compiler
- Adding a new concrete type to an interface family means visiting every type switch

---

## 10. Use Cases

1. Decoding `interface{}` JSON values (number, string, bool, map, slice, nil)
2. AST walking (each node has a different type)
3. Implementing an `error` inspector for error chains
4. Polymorphic logging (handle different log payload types)
5. Database driver value adapters
6. Building a pretty-printer for heterogeneous data
7. Visitor patterns where a sealed-interface set of subtypes is dispatched

---

## 11. Code Examples

### Example 1 — Classify a JSON value
```go
package main

import (
    "encoding/json"
    "fmt"
)

func classify(x any) string {
    switch x.(type) {
    case bool:
        return "bool"
    case float64:
        return "number"
    case string:
        return "string"
    case []any:
        return "array"
    case map[string]any:
        return "object"
    case nil:
        return "null"
    default:
        return "unknown"
    }
}

func main() {
    raw := []byte(`{"a":1,"b":"hi","c":[true,null]}`)
    var v any
    _ = json.Unmarshal(raw, &v)
    fmt.Println(classify(v)) // object
}
```

### Example 2 — Length of any container
```go
package main

import "fmt"

func length(x any) int {
    switch v := x.(type) {
    case string:
        return len(v)
    case []int:
        return len(v)
    case []string:
        return len(v)
    case map[string]int:
        return len(v)
    default:
        return -1
    }
}

func main() {
    fmt.Println(length("hello"))           // 5
    fmt.Println(length([]int{1, 2, 3}))    // 3
    fmt.Println(length(map[string]int{}))  // 0
    fmt.Println(length(42))                 // -1
}
```

### Example 3 — Error unwrapping by type
```go
package main

import (
    "errors"
    "fmt"
    "os"
)

func reportErr(err error) {
    switch e := err.(type) {
    case *os.PathError:
        fmt.Println("path error on", e.Path, "op", e.Op)
    case *os.LinkError:
        fmt.Println("link error", e.Op, e.Old, "->", e.New)
    case nil:
        fmt.Println("no error")
    default:
        fmt.Println("generic:", err)
    }
}

func main() {
    _, err := os.Open("/no/such/file")
    reportErr(err)
    reportErr(errors.New("plain"))
    reportErr(nil)
}
```

### Example 4 — Pretty-print
```go
package main

import "fmt"

func pretty(x any) string {
    switch v := x.(type) {
    case nil:
        return "null"
    case bool:
        if v {
            return "true"
        }
        return "false"
    case int:
        return fmt.Sprintf("%d", v)
    case string:
        return fmt.Sprintf("%q", v)
    case []any:
        out := "["
        for i, item := range v {
            if i > 0 {
                out += ", "
            }
            out += pretty(item)
        }
        return out + "]"
    default:
        return fmt.Sprintf("%v", v)
    }
}

func main() {
    fmt.Println(pretty([]any{1, "hi", true, nil}))
}
```

### Example 5 — Polymorphic adder
```go
package main

import "fmt"

func add(a, b any) any {
    switch x := a.(type) {
    case int:
        if y, ok := b.(int); ok {
            return x + y
        }
    case string:
        if y, ok := b.(string); ok {
            return x + y
        }
    case float64:
        if y, ok := b.(float64); ok {
            return x + y
        }
    }
    return nil
}

func main() {
    fmt.Println(add(1, 2))            // 3
    fmt.Println(add("a", "b"))        // ab
    fmt.Println(add(1, "x"))          // <nil>
}
```

---

## 12. Coding Patterns

### Pattern 1 — Discriminated Decode
```go
switch v := decoded.(type) {
case map[string]any:
    handleObject(v)
case []any:
    handleArray(v)
case string:
    handleString(v)
default:
    handleScalar(v)
}
```

### Pattern 2 — Sealed-interface Visitor
```go
type Node interface{ isNode() }
type IntLit struct{ V int }
func (IntLit) isNode() {}
type Add struct{ L, R Node }
func (Add) isNode() {}

func eval(n Node) int {
    switch x := n.(type) {
    case IntLit:
        return x.V
    case Add:
        return eval(x.L) + eval(x.R)
    }
    return 0
}
```

### Pattern 3 — Defensive `default`
```go
switch v := x.(type) {
case int, string, bool:
    handle(v)
default:
    log.Printf("type-switch: unexpected %T", v)
    handleFallback(x)
}
```

### Pattern 4 — Two-Layer Switch
```go
switch outer := x.(type) {
case []any:
    for _, inner := range outer {
        switch v := inner.(type) {
        case int:
            handleInt(v)
        case string:
            handleStr(v)
        }
    }
}
```

---

## 13. Clean Code Guidelines

1. **Always include `default`** — at minimum to log unknown types.
2. **Prefer single-type cases** — keep the typed `v` available.
3. **Keep cases short** — extract long bodies into helpers.
4. **Order cases by frequency** — most common type first when readability allows.
5. **Don't `panic` casually** — usually return an error or call a fallback.

```go
// Good — handler per case
switch v := x.(type) {
case Cmd:
    handleCmd(v)
case Event:
    handleEvent(v)
default:
    return fmt.Errorf("unknown message: %T", v)
}
```

---

## 14. Performance Tips

1. A type switch is a single type-tag read plus a small dispatch — comparable to a virtual call.
2. Order common types first only if the compiler doesn't reorder; usually negligible.
3. Avoid large multi-type cases that re-box `v` as the interface type.
4. For very hot paths, consider sealed-interface dispatch via a method (no boxing).
5. The `*itab` (interface dispatch table) is cached per type pair; first match cost is amortized.

---

## 15. Best Practices

1. Type-switch only on interface values.
2. Provide a `default` clause.
3. Use `case nil:` when nil is a meaningful value.
4. Split multi-type cases when you need typed access.
5. Don't try `fallthrough` — it's not allowed.
6. Prefer one type-switch to a chain of type assertions.
7. Document the expected types in a comment.

---

## 16. Common Misconceptions

**Misconception 1**: "Type switch works on any value."
**Truth**: Only on interface values. Compile error otherwise.

**Misconception 2**: "Multi-type case lets me use `v` as one of those types."
**Truth**: `v` falls back to the switch operand's interface type.

**Misconception 3**: "`case nil:` matches a typed nil pointer."
**Truth**: It matches an untyped nil interface only. A typed nil (e.g., `(*Foo)(nil)` boxed in `any`) matches `case *Foo`.

**Misconception 4**: "`fallthrough` works in type switches."
**Truth**: It doesn't — compile error.

**Misconception 5**: "Order of cases doesn't matter."
**Truth**: For concrete types, order is irrelevant; but if cases name interface types, the first matching interface wins.

---

## 17. Tricky Points

1. `case nil` vs typed nil pointer.
2. Multi-type case re-types `v` as the operand's interface type.
3. Interface-typed cases can shadow concrete cases if listed first.
4. The bound `v` in `default` keeps the operand's interface type.
5. Type switches don't check exhaustiveness — write your own lint or use `staticcheck`.

---

## 18. Test

```go
package main

import "testing"

func kind(x any) string {
    switch x.(type) {
    case int:
        return "int"
    case string:
        return "string"
    case nil:
        return "nil"
    default:
        return "other"
    }
}

func TestKind(t *testing.T) {
    cases := []struct {
        in   any
        want string
    }{
        {1, "int"},
        {"hi", "string"},
        {nil, "nil"},
        {3.14, "other"},
    }
    for _, c := range cases {
        if got := kind(c.in); got != c.want {
            t.Errorf("kind(%v) = %q, want %q", c.in, got, c.want)
        }
    }
}
```

---

## 19. Tricky Questions

**Q1**: What does this print?
```go
var p *int
var x any = p
switch x.(type) {
case nil:
    fmt.Println("nil")
case *int:
    fmt.Println("*int")
}
```
**A**: `*int`. The interface holds a non-nil dynamic type (`*int`) even though the pointer value is nil.

**Q2**: What's the type of `v` here?
```go
var x any = 5
switch v := x.(type) {
case int, int64:
    _ = v
}
```
**A**: `any`. With multiple types per case, `v` retains the operand's interface type.

**Q3**: Will this compile?
```go
n := 5
switch v := n.(type) {
case int:
    _ = v
}
```
**A**: No. Compile error: type switch operand must be of interface type.

---

## 20. Cheat Sheet

```go
// Basic
switch v := x.(type) {
case int:
    use(v)              // v is int
case string:
    use(v)              // v is string
case nil:
    fmt.Println("nil")
default:
    fmt.Printf("%T\n", v) // v has the operand's interface type
}

// Multiple types per case
switch x.(type) {
case int, int64, int32:
    // v not bound here (or v is `any`)
}

// Discard the value
switch x.(type) {
case error:
    fmt.Println("an error")
}

// Implements check
switch x.(type) {
case fmt.Stringer:
    // dynamic type implements Stringer
}
```

---

## 21. Self-Assessment Checklist

- [ ] I know type switch is `switch v := x.(type) { case T: ... }`
- [ ] I know it requires an interface operand
- [ ] I can write a `case nil:` and explain typed-nil pitfalls
- [ ] I can use multi-type cases and know `v`'s type there
- [ ] I avoid `fallthrough`
- [ ] I include a `default` branch
- [ ] I prefer type switches over chained type assertions

---

## 22. Summary

A type switch is the idiomatic Go way to branch on the dynamic type of an interface value. The form `switch v := x.(type)` exposes a typed local `v` inside each case. The operand must be an interface; concrete types are rejected at compile time. Cases may list multiple types (in which case `v` keeps the operand's interface type), include `nil` to match the empty interface, and a `default` branch for everything else. `fallthrough` is not permitted.

---

## 23. What You Can Build

- JSON value classifier
- AST walker / pretty-printer
- Polymorphic message dispatcher
- Error type inspector
- Database value adapter
- Heterogeneous collection processor

---

## 24. Further Reading

- [Go Tour — Type switches](https://go.dev/tour/methods/16)
- [Effective Go — Interfaces and other types](https://go.dev/doc/effective_go#interfaces_and_types)
- [Go Spec — Type switches](https://go.dev/ref/spec#Type_switches)
- [Go Spec — Type assertions](https://go.dev/ref/spec#Type_assertions)

---

## 25. Related Topics

- 2.4.3 Switch
- 2.4.5 Short-statement if
- Interfaces (Chapter 4)
- Type assertions
- `reflect` package

---

## 26. Diagrams & Visual Aids

```mermaid
flowchart TD
    A[interface value x] --> B{x.(type) ?}
    B -->|int| C[v: int]
    B -->|string| D[v: string]
    B -->|nil| E[no dynamic type]
    B -->|other| F[default: v: any]
```
