# Type Assertions — Specification

> Source: [Go Language Specification](https://go.dev/ref/spec) — §Type_assertions

---

## 1. Spec Reference

> For an expression x of interface type, but not a type parameter, and a type
> T, the primary expression x.(T) asserts that x is not nil and that the value
> stored in x is of type T. The notation x.(T) is called a type assertion.

Source: https://go.dev/ref/spec#Type_assertions

---

## 2. Formal Grammar

```ebnf
TypeAssertion = PrimaryExpr "." "(" Type ")" .
```

---

## 3. Core Rules

### Rule 1: Operand must be interface

```go
var i any = 42
v := i.(int)         // OK — i is interface

var n int = 42
// v := n.(int)      // illegal — n is not interface
```

### Rule 2: Single-value form panics on mismatch

```go
v := i.(T)   // panic if i's dynamic type != T
```

Panic message: `interface conversion: interface {} is X, not T`.

### Rule 3: Two-value form returns ok

```go
v, ok := i.(T)   // ok = false on mismatch (no panic)
```

### Rule 4: nil interface

If `i` is nil interface:
- Single-value: panic
- Two-value: `(zero T, false)`

### Rule 5: Non-nil interface with nil dynamic value

```go
var p *T = nil
var i I = p
v, ok := i.(*T)   // v = nil, ok = true
```

Dynamic type matches even if value is nil.

### Rule 6: Interface-to-interface assertion

```go
var i any = T{}
s, ok := i.(Stringer)   // T's method set must include Stringer's methods
```

### Rule 7: Asserting to non-interface type

```go
v, ok := i.(T)   // T can be any type, not just interface
```

---

## 4. Type Switches

A type switch is similar to a switch but with type assertions:

```go
switch v := i.(type) {
case int: ...      // v is int
case string: ...   // v is string
case nil: ...      // i is nil interface
default: ...       // v is i's dynamic type
}
```

`case T1, T2:` — `v` retains type any (common type not deduced).

---

## 5. Defined vs Undefined Behavior

### Defined

| Operation | Behavior |
|-----------|---------|
| `v, ok := i.(T)` | Always safe |
| `v := i.(T)` matching | Returns concrete value |
| `v := i.(T)` mismatch | Panics |
| `v, ok := i.(I)` interface | Method set check |

### Illegal

| Operation | Result |
|-----------|--------|
| Type assertion on non-interface | Compile error |
| Type assertion on type parameter | Compile error (but supported in some contexts) |

---

## 6. Edge Cases

### Edge Case 1: Nil interface assertion

```go
var i any = nil
v, ok := i.(int)
// v = 0, ok = false (no panic)

w := i.(int)
// PANIC
```

### Edge Case 2: Interface containing nil

```go
var p *T = nil
var i I = p
v, ok := i.(*T)
// v = nil, ok = true (type matches)
```

### Edge Case 3: Method set check for interface assertion

```go
type Speaker interface { Speak() }

type Cat struct{}
func (Cat) Speak() {}

var i any = Cat{}
s, ok := i.(Speaker)   // ok=true (Cat satisfies Speaker)

type Dog struct{}
// no Speak method
var j any = Dog{}
s, ok := j.(Speaker)   // ok=false
```

---

## 7. Version History

| Version | Change |
|---------|--------|
| Go 1.0 | Type assertions introduced. |
| Go 1.13 | `errors.As` and `errors.Is` for wrapped error inspection. |
| Go 1.18 | Generics — type assertions on type parameters in some contexts. |

---

## 8. Compliance Checklist

- [ ] Single-value form used only when match guaranteed.
- [ ] Two-value form preferred for safety.
- [ ] Type switch for multiple types.
- [ ] `errors.As` for wrapped errors.
- [ ] Interface satisfaction understood (method set).
- [ ] nil interface handled.

---

## 9. Official Examples

### Single vs two-value

```go
var i any = "hello"

s := i.(string)        // OK
n := i.(int)           // panic

s2, ok := i.(string)   // s2="hello", ok=true
n2, ok := i.(int)      // n2=0, ok=false
```

### Interface assertion

```go
type Stringer interface { String() string }

var i any = User{Name: "Alice"}
if s, ok := i.(Stringer); ok {
    fmt.Println(s.String())
}
```

### Type switch

```go
switch v := i.(type) {
case int:    fmt.Println("int:", v)
case string: fmt.Println("string:", v)
case nil:    fmt.Println("nil")
default:     fmt.Printf("unknown: %T\n", v)
}
```

---

## 10. Related Spec Sections

| Section | URL |
|---------|-----|
| Type assertions | https://go.dev/ref/spec#Type_assertions |
| Type switches | https://go.dev/ref/spec#Type_switches |
| Interface types | https://go.dev/ref/spec#Interface_types |
| Method sets | https://go.dev/ref/spec#Method_sets |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators |
