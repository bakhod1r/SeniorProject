# Empty Interfaces — Specification

> Source: [Go Language Specification](https://go.dev/ref/spec) — §Interface_types, §Predeclared_identifiers

---

## 1. Spec Reference

### Empty Interface

> The interface type that specifies no methods is called the empty interface.

Source: https://go.dev/ref/spec#Interface_types

### `any` predeclared

> The predeclared type `any` is an alias for the empty interface `interface{}`.

Source: https://go.dev/ref/spec#Predeclared_identifiers

---

## 2. Formal Grammar

```ebnf
EmptyInterface = "interface" "{" "}" .
// or just `any` (Go 1.18+)
```

---

## 3. Core Rules

### Rule 1: Every type satisfies `interface{}`

Per spec: empty interface has no methods, so every type's method set includes all of (zero) methods.

### Rule 2: `any` is alias

```go
type any = interface{}
```

`any` introduced in Go 1.18 as a predeclared alias.

### Rule 3: Comparison

Two `any` values are equal if:
- Both are nil interfaces, OR
- Both have the same dynamic type AND the dynamic values are equal.

If the dynamic type is **not comparable** (slice, map, function), comparison **panics at runtime**.

### Rule 4: Type assertion

```go
v := i.(T)        // panic on mismatch
v, ok := i.(T)    // ok=false on mismatch
```

### Rule 5: Type switch

```go
switch v := i.(type) {
case T1: ...
case T2, T3: ...   // v retains type any
case nil: ...
default: ...
}
```

---

## 4. Boxing

### Rule: Value type → empty interface

When a value type is assigned to an empty interface, the value is **boxed** —
copied to the heap (or sometimes optimized to fit in the data word for small
types).

```go
var x int = 42
var i any = x   // 42 stored on heap, i.data points to it
```

### Rule: Pointer type → empty interface

When a pointer is assigned, no additional allocation:

```go
var x int = 42
var p *int = &x
var i any = p   // i.data = address of x
```

---

## 5. Defined vs Undefined Behavior

### Defined

| Operation | Behavior |
|-----------|---------|
| `var i any = T{}` | Boxing if T is value type |
| `v, ok := i.(T)` | Safe type assertion |
| `switch v := i.(type)` | Type switch |
| `i == nil` | True only if i is nil interface |

### Undefined / Illegal

| Operation | Result |
|-----------|--------|
| `i == j` where dynamic type non-comparable | Runtime panic |
| `i.(T)` single-value with mismatch | Runtime panic |
| Method call on nil interface | Runtime panic |

---

## 6. Edge Cases

### Edge Case 1: nil concrete in any

```go
var p *int = nil
var i any = p   // i is NOT nil — type info present
fmt.Println(i == nil)  // false
```

### Edge Case 2: Comparing maps in any

```go
var i any = map[string]int{"a": 1}
var j any = map[string]int{"a": 1}
// i == j  // RUNTIME PANIC
```

### Edge Case 3: Type switch nil case

```go
switch v := i.(type) {
case nil:
    // i is nil interface
case int:
    // ...
}
```

### Edge Case 4: Multi-case keeps any

```go
switch v := i.(type) {
case int, int64:
    // v is any — common type not deduced
}
```

---

## 7. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Empty interface `interface{}` introduced. |
| Go 1.18 | `any` predeclared alias. |
| Go 1.18 | Generics — alternative to `any`. |
| Go 1.21 | `min`, `max`, `clear` — no `any` change. |

---

## 8. Spec Compliance

- [ ] `any` and `interface{}` are interchangeable.
- [ ] Boxing semantics understood.
- [ ] Two-value type assertion preferred.
- [ ] Comparison panics with non-comparable dynamic types.
- [ ] nil interface vs nil concrete distinct.

---

## 9. Related Spec Sections

| Section | URL |
|---------|-----|
| Interface types | https://go.dev/ref/spec#Interface_types |
| Predeclared identifiers | https://go.dev/ref/spec#Predeclared_identifiers |
| Type assertions | https://go.dev/ref/spec#Type_assertions |
| Type switches | https://go.dev/ref/spec#Type_switches |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators |
| Type parameters | https://go.dev/ref/spec#Type_parameters |
