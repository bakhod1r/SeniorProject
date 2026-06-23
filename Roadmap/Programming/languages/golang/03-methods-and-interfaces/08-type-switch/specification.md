# Go Specification: Type Switches

**Source:** https://go.dev/ref/spec#Type_switches
**Sections:** Type switches; Type assertions; Switch statements; Interface types

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Type_switches |
| **Type Assertions** | https://go.dev/ref/spec#Type_assertions |
| **Switch Statements** | https://go.dev/ref/spec#Switch_statements |
| **Interface Types** | https://go.dev/ref/spec#Interface_types |
| **Go Version** | Go 1.0+ (no syntactic changes since release) |

Official text (excerpt):

> "A type switch compares types rather than values. It is otherwise similar to an expression switch. It is marked by a special switch expression that has the form of a type assertion using the keyword `type` rather than an actual type:
>
> ```
> switch x.(type) {
> // cases
> }
> ```
>
> Cases then match actual types `T` against the dynamic type of the expression `x`. As with type assertions, `x` must be of interface type, and each non-interface type `T` listed in a case must implement the type of `x`."

> "The TypeSwitchGuard may include a short variable declaration. When that form is used, the variable is declared at the end of the TypeSwitchCase implicit block of each clause. In clauses with a case listing exactly one type, the variable has that type; otherwise, the variable has the type of the expression in the TypeSwitchGuard."

---

## 2. Definition

A **type switch** is a control statement of the form:

```
switch [SimpleStmt;] [Identifier :=] PrimaryExpr.(type) {
    // type case clauses
}
```

The `PrimaryExpr.(type)` form (called the **TypeSwitchGuard**) is legal **only** as the operand of `switch`. It does not represent a value; it instructs the runtime to dispatch on the dynamic type of `PrimaryExpr`.

Each case clause is `case TypeList: ...` where each type in the list is either:
- a concrete type that implements the static interface type of the operand, or
- an interface type, or
- the predeclared identifier `nil` (matches a nil interface value).

The optional `Identifier :=` introduces a per-case bound variable carrying the typed value.

---

## 3. Core Rules & Constraints

### 3.1 Operand Must Be an Interface Type

```go
n := 5
switch n.(type) { // ERROR: cannot type switch on non-interface value
}
```

The compiler rejects type switches on concrete-type operands. The static type must be an interface type — `any`, `error`, `io.Reader`, etc.

### 3.2 Each Concrete Case Must Implement the Operand Type

```go
type Stringer interface{ String() string }

var s Stringer
switch s.(type) {
case int: // ERROR: int does not implement Stringer
}
```

If the operand has a non-empty interface type, every concrete case type must implement that interface. Otherwise the compiler rejects the case.

For empty-interface operands (`any`), any type is allowed since every type implements `any`.

### 3.3 Bound Variable Type Per Case

When the guard is `v := x.(type)`:

- In a clause with **exactly one** type `T`, the variable `v` has type `T`.
- In a clause with **multiple** types or `default`, `v` has the operand's interface type.
- In a clause with `nil`, `v` has the operand's interface type and value nil.

```go
switch v := x.(type) {
case int:
    // v has type int
case int, int64:
    // v has type any (the operand's type)
case nil:
    // v has type any
default:
    // v has type any
}
```

### 3.4 The `nil` Case

`case nil:` matches an interface value with **no dynamic type** (nil iface/eface). Typed nil pointers (e.g., `(*Foo)(nil)`) do NOT match `case nil:` — they match `case *Foo:`.

### 3.5 At Most One `default` Clause

A type switch may have at most one `default` clause. It need not appear last but conventionally does.

```go
switch x.(type) {
default:
    // ...
case int:
    // ...
}
```

### 3.6 No `fallthrough`

```go
switch v := x.(type) {
case int:
    fallthrough // ERROR: cannot fallthrough in type switch
case string:
}
```

The compiler rejects `fallthrough` because `v` would change type between cases, breaking type safety.

### 3.7 Multiple Types Per Case Allowed

```go
switch x.(type) {
case int, int32, int64:
    // matches any of these
}
```

The bound `v` (if present) keeps the operand's interface type.

### 3.8 Duplicate Cases Forbidden

```go
switch x.(type) {
case int:
case int: // ERROR: duplicate case in type switch
}
```

The compiler rejects duplicates within a single switch.

### 3.9 Case Order — Semantics

For non-interface cases, no order matters; at most one matches.

For interface-type cases, **the first matching case wins**. Concrete types that implement an interface case may become unreachable if the interface case is listed first. The compiler does NOT generally diagnose this; `staticcheck` SA4020 catches some instances.

### 3.10 The Implicit Block

Each case clause introduces an implicit block scoped to that clause. The bound `v` is declared at the end of this implicit block — accessible inside the case body, inaccessible from other cases.

### 3.11 Optional SimpleStmt Init

A type switch may begin with a `SimpleStmt` followed by `;`:

```go
switch err := getErr(); v := err.(type) {
case *os.PathError:
    // v has type *os.PathError; err has type error
}
```

Both `err` and `v` are scoped to the switch.

### 3.12 The `_` Form

If you don't need the typed value, omit the binding:

```go
switch x.(type) {
case int:    // no v
case string:
}
```

This is equivalent to `_ := x.(type)` conceptually but written without the assignment.

---

## 4. Edge Cases

### 4.1 `case nil:` vs Typed Nil Pointer

```go
var p *int
var x any = p
switch x.(type) {
case nil:
    fmt.Println("untyped nil")
case *int:
    fmt.Println("typed nil *int") // prints this
}
```

The interface holds dynamic type `*int` with a nil data pointer. It is NOT a nil interface.

### 4.2 Multi-Type Case Loses Typed `v`

```go
switch v := x.(type) {
case int, int64:
    _ = v + 1 // ERROR: v has type any here
}
```

To use typed `v`, list one type per case.

### 4.3 No `fallthrough`

Already covered — see 3.6.

### 4.4 Shadowing `v`

```go
switch v := x.(type) {
case []int:
    v := len(v) // shadows; v is now int
    _ = v
}
```

The inner `v := len(v)` shadows the typed `v`. Legal but error-prone.

### 4.5 Anonymous Form (`switch x.(type)` Without `v`)

```go
switch x.(type) {
case int:
    fmt.Println("int")
}
```

No bound variable; the bodies cannot access the typed value. Useful only when the body doesn't need it.

### 4.6 Nested Type Switches

```go
switch outer := x.(type) {
case []any:
    for _, inner := range outer {
        switch inner.(type) {
        case int:
            // ...
        }
    }
}
```

Legal and common — JSON walking does this routinely.

### 4.7 Type Switch in `defer`

```go
defer func() {
    if r := recover(); r != nil {
        switch v := r.(type) {
        case string:
            fmt.Println("panic string:", v)
        case error:
            fmt.Println("panic error:", v)
        }
    }
}()
```

`recover` returns `any`; type switching on it is the canonical way to inspect a panic value.

### 4.8 Generic Function With Type Switch

```go
func handle[T any](x T) {
    switch v := any(x).(type) {
    case int:    // ...
    case string: // ...
    }
}
```

Convert `T` to `any` first. The boxing cost applies as for normal interfaces.

---

## 5. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Type switch on interface operand | Defined |
| Type switch on concrete operand | Compile error |
| Case lists incompatible type | Compile error |
| `fallthrough` in type switch | Compile error |
| Duplicate case types | Compile error |
| Multiple `default` clauses | Compile error |
| `case nil:` matches untyped nil | Defined |
| Typed nil pointer + `case nil:` | Defined — does NOT match |
| Interface case matches first | Defined |
| Concrete case after matching interface case | Defined — unreachable |
| Multi-type case typing of `v` | Defined — operand's interface type |

---

## 6. Type Rules

### 6.1 Static vs Dynamic Type

- **Static type**: type written in source for the variable.
- **Dynamic type**: actual concrete type stored in the interface header at runtime.

A type switch matches on the dynamic type.

### 6.2 Matching Rules

A case `T` matches if:
- `T` is a non-interface type and `e._type == T_descriptor`.
- `T` is an interface type and `e._type` implements `T` (i.e., `getitab(T_iface, e._type)` succeeds).
- `T` is `nil` and `e._type == nil`.

### 6.3 Bound Variable Typing

In `case T:` (single type), the bound `v` is `e.data` reinterpreted as `T`:
- For "direct" types (small, kind allows direct iface representation), `v = e.data` cast to `T`.
- For "indirect" types, `v = *(*T)(e.data)` — a copy.

In `case T1, T2, ...:` (multiple), `v` keeps the operand's interface type.

In `default:`, same as multi-type — operand's interface type.

---

## 7. Behavioral Specification

### 7.1 At Most One Case Body Executes

Per execution of the switch, at most one case body runs. Once a case matches, the body executes and control falls out of the switch. There is no implicit fallthrough and no explicit one allowed.

### 7.2 Order of Evaluation

The TypeSwitchGuard expression `x` evaluates exactly once. The evaluated value's dynamic type is read once. Cases are tested in source order.

### 7.3 Bound Variable Lifetime

The bound variable `v` lives for the duration of the case body. It is freshly bound for each entry — closures capturing `v` see the value at the time they were created.

### 7.4 `default` May Appear Anywhere

`default` may be the first, last, or middle case clause. Convention places it last.

---

## 8. Spec Compliance Checklist

- [ ] Operand is an interface type
- [ ] Each concrete case implements the operand's interface
- [ ] No duplicate case types
- [ ] At most one `default`
- [ ] No `fallthrough`
- [ ] Bound `v` typing follows single-type / multi-type / default rules
- [ ] `case nil:` matches untyped nil only
- [ ] Order accounts for interface case shadowing

---

## 9. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Type switches introduced; syntax stable |
| Go 1.11 | No syntactic changes; `errors.As` introduced as a complementary tool |
| Go 1.18 | Generics added; `any` aliased to `interface{}`; type sets are NOT a runtime substitute for type switches |
| Go 1.20 | Multiple `error` wraps via `errors.Join`; type switches on errors should still use `errors.As` |
| Go 1.21 | Range-over-function (`yield` callbacks); type switches inside iterators are common |

The syntax of type switches has not changed since Go 1.0.

---

## 10. Implementation-Specific Behavior

### 10.1 Compiler Lowering

- **Concrete case**: pointer comparison (`e._type == T_descriptor`).
- **Interface case**: `getitab(T_iface, e._type)` cached lookup.
- **Multi-type case**: chain of compares against each listed type.
- **Default**: implicit fall-through to the default body.

The gc compiler currently uses linear scan; no jump-table optimization for type switches.

### 10.2 itab Cache

Interface-case matching uses a runtime cache (`runtime.itabTable`). First match for a (interface, concrete type) pair builds the itab; subsequent matches are O(1).

### 10.3 Boxing

For switches on operands that aren't already interface values (e.g., a generic `T` first converted via `any(x)`), the value is boxed into an interface header. Boxing allocates on the heap unless escape analysis proves the value can stay on the stack.

### 10.4 Bound Variable Realization

For "direct" types, `v` is realized by reinterpreting the iface data field. For "indirect" types (large structs), `v` is a copy of the heap-stored value.

---

## 11. Official Examples

### Example 1: Classify a Value

```go
package main

import "fmt"

func classify(x any) {
    switch v := x.(type) {
    case nil:
        fmt.Println("nil")
    case bool:
        fmt.Println("bool:", v)
    case int:
        fmt.Println("int:", v)
    case string:
        fmt.Println("string:", v)
    default:
        fmt.Printf("unknown %T\n", v)
    }
}

func main() {
    classify(nil)
    classify(true)
    classify(42)
    classify("hello")
    classify(3.14)
}
```

### Example 2: Walk JSON Tree

```go
package main

import (
    "encoding/json"
    "fmt"
)

func walk(v any, depth int) {
    switch t := v.(type) {
    case map[string]any:
        for k, val := range t {
            fmt.Printf("%*s%s:\n", depth*2, "", k)
            walk(val, depth+1)
        }
    case []any:
        for i, val := range t {
            fmt.Printf("%*s[%d]:\n", depth*2, "", i)
            walk(val, depth+1)
        }
    default:
        fmt.Printf("%*s%v\n", depth*2, "", t)
    }
}

func main() {
    var root any
    _ = json.Unmarshal([]byte(`{"a":1,"b":[2,3]}`), &root)
    walk(root, 0)
}
```

### Example 3: Interface Cases

```go
package main

import (
    "errors"
    "fmt"
)

type tempError interface{ Temporary() bool }

func describe(err error) {
    switch e := err.(type) {
    case nil:
        fmt.Println("ok")
    case tempError:
        fmt.Println("temporary?", e.Temporary())
    default:
        fmt.Println("other:", err)
    }
}

func main() {
    describe(nil)
    describe(errors.New("boom"))
}
```

### Example 4: Anonymous Type Switch

```go
package main

import "fmt"

func isStringy(x any) bool {
    switch x.(type) {
    case string, []byte, fmt.Stringer:
        return true
    }
    return false
}

func main() {
    fmt.Println(isStringy("hi"))         // true
    fmt.Println(isStringy([]byte("hi"))) // true
    fmt.Println(isStringy(42))           // false
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Type assertions | https://go.dev/ref/spec#Type_assertions | The single-shot version of a type switch |
| Interface types | https://go.dev/ref/spec#Interface_types | Operand requirements; method-set rules |
| Switch statements | https://go.dev/ref/spec#Switch_statements | The general `switch` syntax |
| Type identity | https://go.dev/ref/spec#Type_identity | When two types are considered equal |
| Method sets | https://go.dev/ref/spec#Method_sets | Determines interface satisfaction |

---

## 13. Pitfalls Explicitly Noted by the Spec

1. **The operand's type must be an interface** — non-interface operands are a compile error.
2. **No fallthrough** — the spec explicitly says fallthrough cannot be used in type switches.
3. **Multi-type cases re-type `v`** — the bound variable falls back to the operand's interface type.
4. **`case nil` semantics** — matches only the untyped nil interface, not typed-nil pointers.
5. **Case order with interfaces** — though not explicitly called out as a hazard, the "first match wins" rule means interface cases listed before concrete cases shadow them.

---

## 14. Substitutes and Related Constructs

- **Type assertions**: `x.(T)` and `v, ok := x.(T)` — single-type checks.
- **`reflect.Type` map**: dynamic dispatch over an open type set.
- **Sealed interfaces + methods**: when operations are uniform across the type family.
- **Generics (Go 1.18+)**: replaces type switches over numeric kinds; doesn't substitute for runtime dispatch over unrelated types.

---

## 15. Summary

Type switches are a stable, Go-1.0 feature. The TypeSwitchGuard `x.(type)` is a special syntactic form usable only as the operand of `switch`. The operand must be an interface; cases must list types compatible with that interface. The bound `v` is typed per-case-arity (single → typed; multi → interface type). `fallthrough` is forbidden. `case nil:` matches untyped nil only. Order matters when interface types appear among the cases. The spec covers all of this; implementation is straightforward via interface header inspection and (for interface cases) the runtime itab cache.

---

## 16. Further Reading

- [Go Spec — Type switches](https://go.dev/ref/spec#Type_switches)
- [Go Spec — Type assertions](https://go.dev/ref/spec#Type_assertions)
- [Go Spec — Interface types](https://go.dev/ref/spec#Interface_types)
- [Effective Go — Interfaces and other types](https://go.dev/doc/effective_go#interfaces_and_types)
- [runtime/iface.go](https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/iface.go)
- [cmd/compile/internal/walk/switch.go](https://cs.opensource.google/go/go/+/refs/heads/master:src/cmd/compile/internal/walk/switch.go)
