# Go Specification: Pointers with Structs

**Source:** https://go.dev/ref/spec#Struct_types, https://go.dev/ref/spec#Pointer_types
**Sections:** Struct types, Selectors (auto-dereference), Method receivers

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Struct types** | https://go.dev/ref/spec#Struct_types |
| **Selectors** | https://go.dev/ref/spec#Selectors |
| **Method declarations** | https://go.dev/ref/spec#Method_declarations |
| **Composite literals** | https://go.dev/ref/spec#Composite_literals |
| **Go Version** | Go 1.0+ |

Official text:

> "A struct type T may not contain a field of type T, or of a type containing T as a component, directly or indirectly, if those containing types are only array or struct types."

> "For a value x of type T or *T where T is not a pointer or interface type, x.f denotes the field or method at the shallowest depth in T where there is such an f."

The selector `x.f` is the bridge: it works on both `T` (value) and `*T` (pointer), with auto-dereference for the pointer case.

---

## 2. Definition

A "pointer with struct" is `*StructType` — a pointer to a struct value. It enables:
- Mutation of struct fields through the pointer.
- Sharing the same struct across multiple references.
- Linked structures (next, prev, parent).
- Method receivers that mutate.

---

## 3. Core Rules & Constraints

### 3.1 Auto-Dereference for Field Access

```go
type Point struct{ X, Y int }

p := &Point{X: 1, Y: 2}
fmt.Println(p.X)    // 1 — auto-dereference, equivalent to (*p).X
p.X = 99           // also auto-dereference for write
```

Both `p.X` and `(*p).X` are equivalent. Go inserts the dereference.

### 3.2 Allocating Pointer-to-Struct

```go
p1 := new(Point)            // *Point, zero-init
p2 := &Point{X: 1, Y: 2}    // *Point, with values
p3 := &Point{}              // *Point, zero-init (same as new)
```

`&CompositeLiteral{}` is the idiomatic constructor pattern.

### 3.3 Pointer Receiver Methods

```go
func (p *Point) Translate(dx, dy int) {
    p.X += dx
    p.Y += dy
}

p := &Point{X: 1, Y: 2}
p.Translate(10, 20)
fmt.Println(p) // &{11 22}
```

Pointer receivers can mutate. Value receivers cannot.

### 3.4 Calling Pointer Methods on Addressable Values

```go
p := Point{X: 1, Y: 2} // value, not pointer
p.Translate(1, 1)      // OK: Go takes &p automatically
fmt.Println(p)         // {2 3}
```

This works only if `p` is addressable (a variable, field, etc.). Function results and map values are not addressable.

### 3.5 Pointer to Field

```go
p := &Point{X: 1, Y: 2}
xp := &p.X      // *int, pointing to p.X
*xp = 99
fmt.Println(p.X) // 99
```

Struct fields are addressable when the containing struct is addressable.

### 3.6 Nil Pointer-to-Struct

```go
var p *Point
// p.X       // panic: nil pointer dereference
// p.X = 1   // panic
```

Must check for nil first.

### 3.7 Embedded Struct via Pointer

```go
type Base struct{ ID int }
type Sub struct{ *Base; Name string }

s := Sub{Base: &Base{ID: 1}, Name: "foo"}
fmt.Println(s.ID, s.Name) // 1 foo (auto-promoted via embedded pointer)
```

Embedded pointer fields enable composition with field promotion.

### 3.8 Self-Referential Structs

```go
type Node struct {
    Value int
    Next  *Node // pointer to same type
}
```

Required for linked structures. Go forbids direct self-containment of structs (`Node Node`) but permits via pointers.

---

## 4. Type Rules

### 4.1 `*StructType` Is a Distinct Type

```go
var p *Point
// var v Point = p // compile error
v := *p             // OK: dereference
```

### 4.2 Method Set Includes `*T` Methods Plus `T` Methods

For `*T`, methods with pointer receivers AND value receivers are accessible.
For `T`, only value-receiver methods are.

This affects interface satisfaction.

### 4.3 Pointer to Anonymous Struct

```go
p := &struct{ N int }{N: 1}
fmt.Println(p.N) // 1
```

Inline anonymous struct allocated, pointer obtained.

---

## 5. Behavioral Specification

### 5.1 Allocation of `&Struct{}`

When you write `&Struct{...}`, the compiler:
1. Allocates a struct (stack or heap based on escape analysis).
2. Initializes its fields.
3. Returns a pointer to it.

If the pointer escapes (returned, stored beyond function), the allocation is on the heap.

### 5.2 Copy on Pointer Dereference and Assignment

```go
type T struct{ N int }

p := &T{N: 1}
v := *p     // v is a COPY of *p
v.N = 99
fmt.Println(p.N) // 1 — original unchanged
```

`*p` reads the value. Assigning it copies.

### 5.3 Struct Pointer Equality

Two pointers compare equal iff they point to the same struct (same address):

```go
p1 := &Point{1, 2}
p2 := &Point{1, 2}
p3 := p1
fmt.Println(p1 == p2) // false (different allocations)
fmt.Println(p1 == p3) // true (same address)
```

To compare struct values: `*p1 == *p2`.

### 5.4 Method Selector on Pointer

`p.Method()`:
- If `Method` has value receiver: Go copies `*p` for the method.
- If `Method` has pointer receiver: Go uses `p` directly.

`v.Method()` (where v is a value):
- If `Method` has value receiver: Go copies `v`.
- If `Method` has pointer receiver: Go takes `&v` (only if v is addressable).

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Auto-dereference `p.field` | Defined — equivalent to `(*p).field` |
| Field address `&p.field` | Defined — pointer to field |
| Calling pointer method on addressable value | Defined — Go inserts `&` |
| Calling pointer method on non-addressable value | Compile error |
| Nil pointer to struct field access | Defined — runtime panic |
| Pointer to embedded struct field | Defined — auto-promotes |
| Pointer to recursive struct via pointer | Defined — linked structure |
| Direct self-containment without pointer | Compile error: invalid recursive type |

---

## 7. Edge Cases from Spec

### 7.1 Constructor Pattern

```go
func NewPoint(x, y int) *Point {
    return &Point{X: x, Y: y}
}
```

Idiomatic; the returned pointer escapes; struct heap-allocated.

### 7.2 Returning Multiple Pointers Sharing Substate

```go
func split() (*Point, *Point) {
    p := &Point{X: 1, Y: 2}
    return p, p // same pointer!
}
```

Both returned pointers refer to the same Point.

### 7.3 Embedded Pointer Method Promotion

```go
type Reader struct{ *bytes.Reader }
// Reader gets all *bytes.Reader methods automatically.
```

A common pattern for "extension by composition".

### 7.4 Pointer to Field in Slice

```go
type T struct{ N int }
ts := []T{{1}, {2}, {3}}
p := &ts[0]      // pointer to first element
*p = T{N: 99}
fmt.Println(ts[0]) // {99}
```

Slice elements are addressable; pointers to them are valid.

### 7.5 Pointer to Field in Map (NOT Allowed)

```go
m := map[string]T{"a": {1}}
// p := &m["a"] // compile error
```

Map values are not addressable.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Pointer-to-struct, auto-dereference, method receivers established |
| Go 1.18 | Generic struct types with pointer methods |

---

## 9. Implementation-Specific Behavior

### 9.1 Pointer Size

8 B on 64-bit. Always.

### 9.2 Method Call Through Pointer

Direct method call: same as a regular function call with the pointer as the first arg.

```go
p.Method() // compiled to: Method(p)  (where Method takes *T)
```

### 9.3 Field Access Cost

`p.field` lowers to `MOVQ offset(rp), reg` — single load instruction.

### 9.4 Embedded Struct Promotion

The compiler resolves promoted fields/methods at compile time; no runtime overhead.

---

## 10. Spec Compliance Checklist

- [ ] Use `&T{...}` to allocate and initialize struct pointer
- [ ] Use auto-dereference `p.field` instead of `(*p).field`
- [ ] Pointer receivers for mutating methods
- [ ] Nil-check pointer-to-struct before field access
- [ ] Use `*T` field for self-referential types
- [ ] Avoid `&struct{}` literals in hot loops (allocates per call)

---

## 11. Official Examples

### Example 1: Constructor + Methods
```go
package main

import "fmt"

type Counter struct{ n int }

func NewCounter() *Counter { return &Counter{} }
func (c *Counter) Inc()    { c.n++ }
func (c *Counter) Get() int { return c.n }

func main() {
    c := NewCounter()
    c.Inc(); c.Inc(); c.Inc()
    fmt.Println(c.Get()) // 3
}
```

### Example 2: Linked List
```go
package main

import "fmt"

type Node struct {
    V    int
    Next *Node
}

func main() {
    head := &Node{V: 1, Next: &Node{V: 2, Next: &Node{V: 3}}}
    for n := head; n != nil; n = n.Next {
        fmt.Print(n.V, " ")
    }
}
```

### Example 3: Embedded Pointer
```go
package main

import (
    "bytes"
    "fmt"
)

type Reader struct{ *bytes.Reader }

func main() {
    r := &Reader{Reader: bytes.NewReader([]byte("hello"))}
    buf := make([]byte, 5)
    n, _ := r.Read(buf) // promoted method
    fmt.Println(n, string(buf))
}
```

### Example 4: Auto-Dereference in Action
```go
package main

import "fmt"

type Point struct{ X, Y int }

func (p *Point) Double() { p.X *= 2; p.Y *= 2 }

func main() {
    p := &Point{X: 1, Y: 2}
    p.Double()
    fmt.Println(p.X, p.Y) // 2 4
    
    // Equivalent (rare):
    (*p).Double()
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Struct types | https://go.dev/ref/spec#Struct_types | Struct definition |
| Selectors | https://go.dev/ref/spec#Selectors | Auto-dereference |
| Method declarations | https://go.dev/ref/spec#Method_declarations | Pointer receivers |
| Composite literals | https://go.dev/ref/spec#Composite_literals | `&T{...}` syntax |
| Type identity | https://go.dev/ref/spec#Type_identity | `*T` vs `T` |
