# Go Specification: Pointers Basics

**Source:** https://go.dev/ref/spec#Pointer_types
**Sections:** Pointer types, Address operators, Composite literals (taking addresses)

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Pointer_types |
| **Address operators** | https://go.dev/ref/spec#Address_operators |
| **`new`** | https://go.dev/ref/spec#Allocation |
| **Go Version** | Go 1.0+ |

Official text:

> "A pointer type denotes the set of all pointers to variables of a given type, called the base type of the pointer. The value of an uninitialized pointer is nil."

> "The unary `&` operator yields the address of its operand, which must be addressable. The unary `*` operator denotes pointer indirection. Its operand must be of pointer type, and the result is the variable referred to."

---

## 2. Formal Grammar (EBNF)

```ebnf
PointerType = "*" BaseType .
BaseType    = Type .

UnaryExpr = ... | unary_op UnaryExpr .
unary_op  = "+" | "-" | "!" | "^" | "*" | "&" | "<-" .
```

`*T` is the pointer-to-T type. `&x` takes the address of `x`. `*p` dereferences `p`.

---

## 3. Core Rules & Constraints

### 3.1 Pointer Type
```go
var p *int       // p is a pointer to int; nil by default
var s *string    // pointer to string
var pt *Point    // pointer to Point struct
```

The zero value of any pointer type is `nil`.

### 3.2 Taking an Address with `&`
```go
x := 42
p := &x       // p is *int, points to x
fmt.Println(*p) // 42
```

`&` requires its operand to be **addressable**: a variable, a struct field, an array/slice element. Not addressable: literals, map elements, function results.

### 3.3 Dereferencing with `*`
```go
*p = 99       // writes to the value at p
fmt.Println(x) // 99
```

`*p` accesses the value pointed to. Works for both reads and writes.

### 3.4 Nil Pointer
```go
var p *int
if p == nil {
    fmt.Println("nil")
}
// *p // panic: nil pointer dereference
```

Always check for nil before dereferencing if the pointer comes from an uncertain source.

### 3.5 No Pointer Arithmetic
```go
p := &arr[0]
// p++         // compile error: invalid operation
// p + 4       // compile error
```

Unlike C, Go forbids pointer arithmetic. Use slices for indexed access.

### 3.6 Pointer Comparison
```go
p1 := &x
p2 := &x
p3 := new(int)
fmt.Println(p1 == p2) // true (same address)
fmt.Println(p1 == p3) // false (different)
fmt.Println(p1 == nil) // false
```

Pointers are comparable with `==` and `!=`.

### 3.7 The `new` Built-in
```go
p := new(int)         // *int, points to a zero-initialized int
fmt.Println(*p)       // 0
*p = 42
fmt.Println(*p)       // 42

q := new(struct{ N int })
q.N = 5
```

`new(T)` allocates a zero-initialized T on the heap and returns `*T`. Equivalent to `&T{}` for most cases.

### 3.8 Composite Literal Address
```go
p := &Point{X: 1, Y: 2}  // pointer to a new Point
arr := &[3]int{1, 2, 3}  // pointer to a new array
```

This is the idiomatic way to allocate and initialize together.

### 3.9 Auto-Dereference for Method Calls and Field Access
```go
p := &User{Name: "Ada"}
fmt.Println(p.Name)    // Go auto-dereferences: same as (*p).Name
p.Inc()                // method call on pointer; auto-dereferences if needed
```

Both `p.Name` and `(*p).Name` work; Go inserts the dereference.

### 3.10 Address-of a Function or Method
```go
f := someFunc
// _ = &f // error: cannot take address of someFunc

var v someFunc
_ = &v // OK: address of a variable (which holds the function value)
```

You can take the address of a variable holding a function value, but not of a function literal or named function directly.

---

## 4. Type Rules

### 4.1 `*T` and `T` Are Different Types
```go
var x int = 5
var p *int = &x
// var y int = p  // compile error
y := *p           // OK: dereference
```

### 4.2 `*T1` and `*T2` Are Different
```go
var p *int
var q *float64
// p = q // compile error: type mismatch
```

### 4.3 Pointer to Pointer
```go
x := 5
p := &x
pp := &p
fmt.Println(**pp) // 5
*pp = nil
fmt.Println(p) // <nil>
```

`**T` is a pointer to a pointer. Reach for it sparingly.

### 4.4 Pointers in Generics
```go
func setToZero[T any](p *T) {
    var zero T
    *p = zero
}

n := 42
setToZero(&n)
fmt.Println(n) // 0
```

---

## 5. Behavioral Specification

### 5.1 Pointer to Local Escapes to Heap

If a pointer to a local variable escapes the function, the variable is allocated on the heap:

```go
func newInt(v int) *int {
    n := v
    return &n // n escapes; allocated on heap
}
```

Verify with `go build -gcflags="-m"`.

### 5.2 Pointer to Pointer

```go
x := 1
p := &x
q := &p

*p = 2          // x = 2
**q = 3         // x = 3
```

Each `*` peels one level.

### 5.3 Pointer Equality

Pointers compare equal iff they point to the same memory location, OR both are nil. Two `new(int)` calls produce non-equal pointers (different memory).

### 5.4 Garbage Collection Through Pointers

The GC tracks pointers as roots. As long as a pointer to T is reachable, T is kept alive.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Dereferencing nil pointer | Defined — runtime panic |
| Comparing pointers | Defined — by address |
| Pointer arithmetic | Compile error |
| Address of map element | Compile error |
| Address of function result | Compile error |
| Address of literal | Compile error (some exceptions for composite literals) |
| Pointer to local that escapes | Defined — variable on heap |
| Pointer to local that doesn't escape | Defined — stack-allocated |
| Returning pointer from function | Defined — variable lifetime extends |

---

## 7. Edge Cases from Spec

### 7.1 Address of Map Element
```go
m := map[string]int{"a": 1}
// p := &m["a"] // compile error: cannot take the address of m["a"]
```

Map values are not addressable. Workaround: extract to a variable.

### 7.2 Address of Composite Literal
```go
p := &Point{X: 1, Y: 2} // OK: addressable composite literal
arr := [3]int{1, 2, 3}
q := &arr               // OK: variable
// _ = &[3]int{1, 2, 3} // OK in expression context, but rare
```

### 7.3 Nil Comparison

```go
var p *int
fmt.Println(p == nil) // true
p = new(int)
fmt.Println(p == nil) // false
```

### 7.4 Pointer to Receiver in Method Value

```go
type T struct{ N int }
func (t *T) Inc() { t.N++ }

t := &T{}
inc := t.Inc // method value; binds the pointer
inc()
fmt.Println(t.N) // 1
```

### 7.5 `new` vs `&T{}`

```go
p1 := new(Point)  // zero-initialized; (Point{X: 0, Y: 0})
p2 := &Point{}    // same as new(Point)
p3 := &Point{X: 1, Y: 2} // initialized to specific values
```

Use `&T{}` when you want to specify field values; `new(T)` for zero-initialized.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Pointers, `&`, `*`, `new`, nil semantics established |
| Go 1.18 | Generics: `*T` works with type parameters |

---

## 9. Implementation-Specific Behavior

### 9.1 Pointer Size
8 bytes on 64-bit systems; 4 on 32-bit.

### 9.2 Stack vs Heap

Escape analysis decides:
- Pointer's pointee can stay on stack if pointer doesn't escape.
- Otherwise, heap allocation.

### 9.3 Pointer Alignment

Pointers must be word-aligned. The runtime ensures this.

### 9.4 Unsafe Pointers

`unsafe.Pointer` is a special type that can be converted to/from any pointer type and `uintptr`. Bypasses safety; reserved for low-level code.

---

## 10. Spec Compliance Checklist

- [ ] Use `*T` for pointer types
- [ ] Use `&` to take address of addressable values
- [ ] Use `*` to dereference
- [ ] Always check for nil before dereferencing
- [ ] No pointer arithmetic
- [ ] Use `new(T)` for zero-initialized allocations
- [ ] Use `&T{...}` for initialized allocations
- [ ] Auto-dereference works for `.field` and method calls

---

## 11. Official Examples

### Example 1: Basic Pointer
```go
package main

import "fmt"

func main() {
    x := 42
    p := &x
    fmt.Println(*p) // 42
    *p = 99
    fmt.Println(x)  // 99
}
```

### Example 2: Nil Check
```go
package main

import "fmt"

func deref(p *int) int {
    if p == nil {
        return 0
    }
    return *p
}

func main() {
    fmt.Println(deref(nil)) // 0
    n := 42
    fmt.Println(deref(&n))  // 42
}
```

### Example 3: `new`
```go
package main

import "fmt"

func main() {
    p := new(int)
    fmt.Println(*p) // 0
    *p = 42
    fmt.Println(*p) // 42
}
```

### Example 4: Pointer to Struct
```go
package main

import "fmt"

type Point struct{ X, Y int }

func main() {
    p := &Point{X: 1, Y: 2}
    fmt.Println(p.X, p.Y) // 1 2
    p.X = 99
    fmt.Println(p.X)      // 99
}
```

### Example 5: Invalid Constructs
```go
// 1. Pointer arithmetic:
// p := &x; p++ // ERROR

// 2. Address of map element:
// m := map[string]int{"a": 1}
// p := &m["a"] // ERROR

// 3. Address of function literal:
// _ = &func(){} // ERROR

// 4. Different pointer types:
// var p *int = new(float64) // ERROR
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Pointer types | https://go.dev/ref/spec#Pointer_types | Type definition |
| Address operators | https://go.dev/ref/spec#Address_operators | & and * |
| Allocation (`new`) | https://go.dev/ref/spec#Allocation | new(T) |
| Composite literals | https://go.dev/ref/spec#Composite_literals | &T{...} |
| Selectors | https://go.dev/ref/spec#Selectors | Auto-dereference |
| Method declarations | https://go.dev/ref/spec#Method_declarations | Pointer receivers |
| Memory model | https://go.dev/ref/mem | Concurrent pointer access |
