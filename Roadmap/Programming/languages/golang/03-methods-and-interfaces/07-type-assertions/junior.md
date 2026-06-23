# Type Assertions — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Common Misconceptions](#common-misconceptions)
16. [Test](#test)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Diagrams](#diagrams)

---

## Introduction

**Type assertion** — the operation of extracting the underlying concrete type from an interface value. Syntax: `i.(T)`.

```go
var i any = "hello"

s := i.(string)
fmt.Println(s)  // hello
```

`i.(string)` is read as "does interface `i` hold a `string` value? If so, give it to me."

But if `i` is not a `string` — **panic**! That is why the **two-value form** is safe:

```go
var i any = 42

s, ok := i.(string)
if ok {
    fmt.Println(s)
} else {
    fmt.Println("i is not a string")
}
```

`ok` is a bool. When false, there is no panic — `s` becomes the zero value.

After this file you will:
- Know the type assertion syntax
- Be able to distinguish single-value and two-value forms
- Know how to prevent panics
- Know the typical use cases

---

## Prerequisites
- Interface basics
- Empty interface (`interface{}`, `any`)

---

## Glossary

| Term | Definition |
|--------|--------|
| **Type assertion** | Extracting a concrete type from an interface value |
| **Single-value form** | `v := i.(T)` — panics on mismatch |
| **Two-value form** | `v, ok := i.(T)` — safe |
| **Concrete type** | Real type (struct, primitive) |
| **Zero value** | The type's default value (`int=0`, `string=""`, etc.) |

---

## Core Concepts

### 1. Single-value form

```go
var i any = "hello"
s := i.(string)
fmt.Println(s)  // hello

s2 := i.(int)   // PANIC — interface conversion: interface {} is string, not int
```

### 2. Two-value form (safe)

```go
var i any = "hello"

s, ok := i.(string)
fmt.Println(s, ok)  // hello true

n, ok := i.(int)
fmt.Println(n, ok)  // 0 false (n is the zero value)
```

### 3. Interface to interface

```go
type Stringer interface { String() string }

var i any = User{Name: "Alice"}
s, ok := i.(Stringer)   // Does User satisfy Stringer?
if ok {
    fmt.Println(s.String())
}
```

### 4. Pointer assertion

```go
type T struct{}
var i any = &T{}

p, ok := i.(*T)
if ok { fmt.Println(p) }
```

### 5. nil interface

```go
var i any = nil
v, ok := i.(int)
fmt.Println(v, ok)  // 0 false
```

A `nil` interface always yields `(zero, false)` from an assertion.

---

## Real-World Analogies

**Analogy 1 — Opening a bag**

An interface is like a bag — you do not know what is inside. A type assertion asks the bag "do you contain X?" The two-value form does not panic if the answer is no.

**Analogy 2 — Bag certificate**

`v, ok := i.(T)` is like inspecting a bag: `ok` tells whether the certificate exists, `v` is the goods.

**Analogy 3 — Sport keys**

Single-value is "give me the level-5 key" — crash if it isn't there. Two-value is "do you have it?" — take a different action if not.

---

## Mental Models

### Model 1: Ask + receive

```
i.(T)
 ↓
"Does i contain a T?"
 ↓
Yes → return concrete value
No  → panic (single) or (zero, false) (two)
```

### Model 2: Type-safe unbox

```
Interface (box) → assertion (unbox) → concrete value
```

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Recover the concrete type | Loses type safety |
| Specialize after polymorphism | Panic risk (single-value) |
| Common pattern (error checking) | Reduces code clarity |

---

## Use Cases

### Use case 1: Check interface satisfaction

```go
type Closer interface { Close() error }

func cleanup(x any) {
    if c, ok := x.(Closer); ok {
        c.Close()
    }
}
```

### Use case 2: Custom error inspection

```go
err := doSomething()
if nf, ok := err.(*NotFoundError); ok {
    fmt.Println("ID:", nf.ID)
}
```

### Use case 3: Dynamic data

```go
var data any
json.Unmarshal(payload, &data)

if m, ok := data.(map[string]any); ok {
    fmt.Println(m["name"])
}
```

### Use case 4: Optional capability

```go
func process(r io.Reader) {
    if rs, ok := r.(io.ReadSeeker); ok {
        rs.Seek(0, io.SeekStart)
    }
    // ...
}
```

---

## Code Examples

### Example 1: Simple
```go
package main

import "fmt"

func main() {
    var i any = "hello"

    s, ok := i.(string)
    if ok {
        fmt.Println("string:", s)
    }

    n, ok := i.(int)
    if !ok {
        fmt.Println("not an int")
    } else {
        fmt.Println("int:", n)
    }
}
```

### Example 2: Custom error

```go
package main

import "fmt"

type NotFound struct{ ID string }
func (e *NotFound) Error() string { return "not found: " + e.ID }

func find(id string) error {
    return &NotFound{ID: id}
}

func main() {
    err := find("u1")
    if nf, ok := err.(*NotFound); ok {
        fmt.Println("Specific NotFound for ID:", nf.ID)
    }
}
```

### Example 3: Optional capability

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

func describe(r io.Reader) {
    fmt.Println("Reader:", r)
    if s, ok := r.(io.Seeker); ok {
        fmt.Println("Also Seekable:", s)
    }
}

func main() {
    describe(strings.NewReader("hello"))
}
```

### Example 4: Map[string]any

```go
package main

import (
    "encoding/json"
    "fmt"
)

func main() {
    var data any
    json.Unmarshal([]byte(`{"name":"Alice","age":30}`), &data)

    m, ok := data.(map[string]any)
    if !ok { return }

    name, _ := m["name"].(string)
    age, _ := m["age"].(float64)  // JSON numbers are float64

    fmt.Println(name, age)
}
```

### Example 5: Multiple assertion

```go
func describe(i any) {
    if s, ok := i.(string); ok {
        fmt.Println("string:", s)
        return
    }
    if n, ok := i.(int); ok {
        fmt.Println("int:", n)
        return
    }
    fmt.Println("unknown")
}
```

(A type switch is often faster — covered in the next section.)

---

## Coding Patterns

### Pattern 1: Safe assertion

```go
v, ok := i.(T)
if !ok { /* default behavior */ }
```

### Pattern 2: Ignore second value with `_`

```go
s, _ := i.(string)   // s may be the zero value, but no panic
```

### Pattern 3: Optional capability check

```go
if x, ok := obj.(Closer); ok { x.Close() }
```

### Pattern 4: Custom error

```go
if myErr, ok := err.(*MyError); ok {
    // specific handling
}
```

---

## Clean Code

### Rule 1: Prefer two-value
```go
// Bad
v := i.(T)   // panic risk

// Good
v, ok := i.(T)
if !ok { /* handle */ }
```

### Rule 2: Type switch for many types
```go
// Bad
if s, ok := i.(string); ok { ... }
if n, ok := i.(int); ok { ... }
if b, ok := i.(bool); ok { ... }

// Good
switch v := i.(type) {
case string: ...
case int: ...
case bool: ...
}
```

### Rule 3: `errors.As` (Go 1.13+) is wrapper-aware
```go
// Bad
if e, ok := err.(*MyErr); ok { ... }

// Good (also finds wrapped errors)
var e *MyErr
if errors.As(err, &e) { ... }
```

---

## Best Practices

1. **Always use the two-value form** to prevent panics
2. **Type switch** for multiple types
3. **`errors.Is`/`errors.As`** for errors
4. **Add comments** explaining the reason for the assertion
5. **Refactor** — many assertions usually mean a poor interface design

---

## Edge Cases & Pitfalls

### Pitfall 1: Single-value panic

```go
v := i.(T)   // panics if i is not a T
```

### Pitfall 2: nil interface

```go
var i any = nil
v, ok := i.(int)
// v=0, ok=false
```

### Pitfall 3: Pointer mismatch

```go
type T struct{}
var i any = T{}    // value
p, ok := i.(*T)    // ok=false
v, ok := i.(T)     // ok=true
```

### Pitfall 4: Wrapped error

```go
err := fmt.Errorf("wrap: %w", &MyErr{})
e, ok := err.(*MyErr)   // ok=false (wrapped)

var e2 *MyErr
errors.As(err, &e2)     // OK
```

---

## Common Mistakes

| Mistake | Solution |
|------|--------|
| Single-value form | Two-value `v, ok := i.(T)` |
| Pointer/value confusion | T and *T differ |
| Wrapped error | `errors.As` |
| Many assertions | Type switch |

---

## Common Misconceptions

**1. "Type assertion is the same as type conversion"**
False. Conversion transforms the value. Assertion extracts the concrete value from an interface.

**2. "Type assertion always panics on a mismatch"**
Only the single-value form does. The two-value form is safe.

**3. "`i.(T)` always works"**
Only when the dynamic type of `i` is T.

---

## Test

### 1. When does `i.(T)` panic?
**Answer:** With the single-value form, when the dynamic type of `i` is not T.

### 2. Is `v, ok := i.(T)` safe?
**Answer:** Yes. On a mismatch `v` is the zero value and `ok=false`.

### 3. What is the result of `var i any = nil; v, ok := i.(int)`?
**Answer:** `v=0, ok=false`.

### 4. What is the result of `var i any = T{}; p, ok := i.(*T)`?
**Answer:** `p=nil, ok=false`. The value is T, not *T.

### 5. Type assertion on a wrapped error?
**Answer:** It does not work. Use `errors.As`.

---

## Tricky Questions

**Q1: Difference between type assertion and type conversion?**
Conversion transforms a value. Assertion extracts a concrete value from an interface.

**Q2: Does `i.(any)` work?**
Yes — for any interface type. In practice it is useless.

**Q3: Interface-to-interface assertion?**
Yes. `i.(I2)` checks whether the dynamic type of `i` satisfies I2.

**Q4: When is type assertion panic-free?**
The two-value form is always safe.

**Q5: Difference between `errors.As` and type assertion?**
`errors.As` walks the wrapped error chain (Unwrap chain).

---

## Cheat Sheet

```
SYNTAX
─────────────────
v := i.(T)           single-value (PANICS on mismatch)
v, ok := i.(T)       two-value (SAFE)

INTERFACE → CONCRETE
─────────────────
var i any = "hello"
s, ok := i.(string)  // s="hello", ok=true

INTERFACE → INTERFACE
─────────────────
s, ok := i.(Stringer)  // does the inner type satisfy Stringer?

NIL CASES
─────────────────
nil interface → ok=false
nil concrete inside interface → ok=true (concrete type is known)

ERROR
─────────────────
errors.As(err, &target)  // wrapper-aware
errors.Is(err, sentinel) // sentinel comparison

BEST PRACTICES
─────────────────
Always use two-value
Type switch for multiple types
errors.As for errors
```

---

## Self-Assessment Checklist

- [ ] I can write the type assertion syntax
- [ ] I can distinguish single- and two-value forms
- [ ] I prevent panics
- [ ] I use `errors.As` for wrapped errors
- [ ] I understand the pointer/value distinction in assertions

---

## Summary

Type assertion extracts a concrete type from an interface value:
- `v := i.(T)` panics on mismatch
- `v, ok := i.(T)` is safe (idiomatic)
- Use a type switch for many types
- Use `errors.As` for wrapped errors

Always prefer the two-value form.

---

## Diagrams

### Single vs two-value

```mermaid
graph TD
    A[i.(T)] --> B{single or two?}
    B -->|single v| C{i is T?}
    B -->|two v, ok| D{i is T?}
    C -->|yes| E[v = concrete]
    C -->|no| F[PANIC]
    D -->|yes| G[v=concrete, ok=true]
    D -->|no| H[v=zero, ok=false]
```
