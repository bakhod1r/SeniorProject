# Zero Values — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §The_zero_value

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Core Rules & Constraints](#3-core-rules-constraints)
4. [Type Rules](#4-type-rules)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Defined vs Undefined Behavior](#6-defined-vs-undefined-behavior)
7. [Edge Cases from Spec](#7-edge-cases-from-spec)
8. [Version History](#8-version-history)
9. [Implementation-Specific Behavior](#9-implementation-specific-behavior)
10. [Spec Compliance Checklist](#10-spec-compliance-checklist)
11. [Official Examples](#11-official-examples)
12. [Related Spec Sections](#12-related-spec-sections)

---

## 1. Spec Reference

### The Zero Value — Official Text (verbatim)

> When storage is allocated for a variable, either through a declaration or a
> call of `new`, or when a new value is created, either through a composite
> literal or a call of `make`, and no explicit initialization is provided, the
> variable or value is given a default value. **Each element of such a variable
> or value is set to the zero value for its type**: `false` for booleans, `0`
> for numeric types, `""` for strings, and `nil` for pointers, functions,
> interfaces, slices, channels, and maps. This initialization is done
> recursively, so for instance each element of an array of structs will have its
> fields zeroed if no value is specified.

Source: https://go.dev/ref/spec#The_zero_value

### Variables Section — Supplementary Official Text

> A variable's value is retrieved by referring to the variable in an expression;
> it is the most recent value assigned to the variable. If a variable has not
> yet been assigned a value, its value is the **zero value for its type**.

Source: https://go.dev/ref/spec#Variables

### Spec Equivalence Statement (Official)

The spec provides the following equivalence for zero-initialized variables:

> These two simple declarations are equivalent:
>
> ```
> var i int
> var i int = 0
> ```

Source: https://go.dev/ref/spec#The_zero_value

---

## 2. Formal Grammar (EBNF)

Zero values are not expressed as a grammar production but arise from any
variable declaration that omits an initializer. The relevant grammar rules are:

```ebnf
VarDecl  = "var" ( VarSpec | "(" { VarSpec ";" } ")" ) .
VarSpec  = IdentifierList ( Type [ "=" ExpressionList ] | "=" ExpressionList ) .
```

When the optional `"=" ExpressionList` is absent and a Type is present, the
variable is zero-initialized. Zero initialization also occurs for:

```ebnf
// new() built-in — allocates zeroed memory
BuiltinCall = "new" "(" Type ")" .

// make() built-in — initializes to zero for slice/map/chan element types
BuiltinCall = "make" "(" Type [ "," ArgumentList ] ")" .
```

Composite literals initialize only the fields/elements explicitly provided;
all others receive their zero value:

```ebnf
CompositeLit  = LiteralType LiteralValue .
LiteralValue  = "{" [ ElementList [ "," ] ] "}" .
```

---

## 3. Core Rules & Constraints

### Rule 1 — Zero Initialization is Always Guaranteed

The spec guarantees that **every** variable or value that is allocated storage
without an explicit initializer is set to its zero value. This is not
optional — it is mandated by the specification.

### Rule 2 — Zero Initialization is Recursive

The spec explicitly states: "This initialization is done recursively." This
means:

- Every field of a struct is individually zeroed.
- Every element of an array is individually zeroed.
- For slices, maps, and channels the zero value is `nil` (the container itself),
  not its elements.

### Rule 3 — nil is the Zero Value for Reference Types

For the following types, the zero value is `nil`:

- Pointers (`*T`)
- Functions (`func(...)`)
- Interfaces (including `any` / `interface{}`)
- Slices (`[]T`)
- Maps (`map[K]V`)
- Channels (`chan T`)

### Rule 4 — Structs and Arrays Are Never nil

Struct and array zero values are value types (not reference types). Their zero
value is a fully allocated value with all fields/elements set to their
respective zero values. They are **never** `nil`.

### Rule 5 — Zero Value Applies to new() and make()

- `new(T)` returns a `*T` pointing to a zero-initialized `T`.
- `make([]T, n)` returns a slice where all `n` elements are zero-initialized.
- `make(map[K]V)` returns an empty (but non-nil) map.
- `make(chan T)` returns an unbuffered (but non-nil) channel.

---

## 4. Type Rules

### Complete Zero Value Table

| Type Category | Specific Type(s) | Zero Value | Notes |
|---------------|-----------------|------------|-------|
| Boolean | `bool` | `false` | |
| Integer | `int`, `int8`, `int16`, `int32`, `int64` | `0` | |
| Unsigned Integer | `uint`, `uint8`, `uint16`, `uint32`, `uint64`, `uintptr` | `0` | |
| Float | `float32`, `float64` | `0.0` | IEEE 754 positive zero |
| Complex | `complex64`, `complex128` | `0+0i` | Both real and imaginary parts are 0 |
| String | `string` | `""` | Empty string, length 0 |
| Byte | `byte` (alias for `uint8`) | `0` | |
| Rune | `rune` (alias for `int32`) | `0` | Unicode code point 0 |
| Pointer | `*T` (any pointer type) | `nil` | Does not point to any value |
| Function | `func(...)` | `nil` | Not callable when nil |
| Interface | `interface{}`, `any`, named interface | `nil` | Both type and value are nil |
| Slice | `[]T` | `nil` | nil slice: len=0, cap=0, no backing array |
| Map | `map[K]V` | `nil` | Reading from nil map returns zero value; writing panics |
| Channel | `chan T` | `nil` | Sending/receiving on nil channel blocks forever |
| Array | `[N]T` | `[N]T{T{}, T{}, ...}` | Each element is its zero value; NOT nil |
| Struct | `struct{ ... }` | all fields zero | Each field is its zero value; NOT nil |

### Numeric Zero Value Details

| Type | Zero Value | Bit Representation |
|------|-----------|-------------------|
| `int8` | `0` | `0x00` |
| `int16` | `0` | `0x0000` |
| `int32` | `0` | `0x00000000` |
| `int64` | `0` | `0x0000000000000000` |
| `float32` | `0.0` | `0x00000000` (IEEE 754 +0) |
| `float64` | `0.0` | `0x0000000000000000` (IEEE 754 +0) |
| `complex64` | `0+0i` | real=0x00000000, imag=0x00000000 |
| `complex128` | `0+0i` | real=0x0000000000000000, imag=0x0000000000000000 |

---

## 5. Behavioral Specification

### Storage Allocation Triggers Zero Initialization

Zero initialization occurs in ALL of the following cases:

1. **`var` declaration without initializer**: `var x int`
2. **`new(T)` call**: allocates and zero-initializes a `T`, returns `*T`
3. **Composite literal with missing fields**: `Point{X: 1}` — Y gets zero value
4. **`make([]T, n)` call**: all n elements are zero-initialized
5. **Array declaration**: `var arr [5]int` — all 5 elements are 0

### Struct Zero Initialization (Recursive)

The spec guarantees recursive zeroing. For a struct with nested structs:

```
type T struct { i int; f float64; next *T }
t := new(T)
```

After this allocation, the spec guarantees:

```
t.i == 0
t.f == 0.0
t.next == nil
```

And the same is true for `var t T`.

### nil Slice Behavior

A nil slice is a valid, usable slice for read operations:

- `len(nil_slice) == 0`
- `cap(nil_slice) == 0`
- Ranging over a nil slice produces zero iterations
- Appending to a nil slice works correctly
- A nil slice is NOT equal to an empty slice (`[]int{}`) in reflect comparison,
  but both have length 0

### nil Map Behavior

Reading from a nil map is safe and returns the zero value for the value type.
Writing to a nil map causes a runtime panic.

### nil Channel Behavior

Sending to or receiving from a nil channel blocks forever (no panic). Closing
a nil channel panics.

---

## 6. Defined vs Undefined Behavior

### Defined — Safe Zero Value Operations

| Operation | Behavior |
|-----------|----------|
| Read from zero-value `bool` | Returns `false` |
| Read from zero-value `int` | Returns `0` |
| Read from zero-value `string` | Returns `""` |
| `len("")` | Returns `0` |
| Read from nil slice `s[0]` | **Panic** — index out of range on nil slice |
| `len(nil_slice)` | Returns `0` — defined, safe |
| `cap(nil_slice)` | Returns `0` — defined, safe |
| `append(nil_slice, x)` | Returns a new slice — defined, safe |
| Range over nil slice | Zero iterations — defined, safe |
| Read from nil map `m[key]` | Returns zero value for V — defined, safe |
| Write to nil map `m[key] = v` | **Panic** — assignment to entry in nil map |
| Send on nil channel | Blocks forever — defined but will deadlock |
| Receive on nil channel | Blocks forever — defined but will deadlock |
| Close nil channel | **Panic** — close of nil channel |
| Call nil function | **Panic** — nil pointer dereference |
| Dereference nil pointer | **Panic** — nil pointer dereference |

### Key Distinction: nil vs Zero Value

`nil` is itself the zero value for reference types, but a struct with all-zero
fields is **not** `nil`. Zero value for structs means "all fields are their
respective zero values," which is a valid, non-nil Go value.

---

## 7. Edge Cases from Spec

### Edge Case 1 — Struct with Pointer Field

```go
type Node struct {
    Value int
    Next  *Node
}
var n Node
// n.Value == 0
// n.Next == nil  (pointer zero value)
```

`n.Next` being `nil` means this is a leaf node — a valid sentinel value.

### Edge Case 2 — Array of Structs (Recursive Zeroing)

```go
type Point struct { X, Y float64 }
var points [3]Point
// points[0] == Point{X: 0.0, Y: 0.0}
// points[1] == Point{X: 0.0, Y: 0.0}
// points[2] == Point{X: 0.0, Y: 0.0}
```

Each element is recursively zeroed per the spec.

### Edge Case 3 — Interface Zero Value vs nil Interface

A nil interface (`var err error`) is not the same as an interface holding a
typed nil pointer:

```go
var p *MyError = nil
var err error = p    // err is NOT nil! It holds (*MyError, nil)
```

This is a famous Go gotcha. The zero value of `error` is nil (both type and
value are nil). But assigning a typed nil pointer creates a non-nil interface.

### Edge Case 4 — Composite Literal with Missing Fields

```go
type Config struct {
    Host    string
    Port    int
    Timeout float64
    Debug   bool
}

c := Config{Host: "localhost"} // Port=0, Timeout=0.0, Debug=false
```

Fields not mentioned in the composite literal receive their zero values.

### Edge Case 5 — new() vs var

```go
p := new(int)   // *int pointing to a zero-initialized int
var i int       // int with zero value

// *p == i == 0, but p is a pointer while i is a value
```

### Edge Case 6 — Zero Value for Function Types

```go
var fn func(int) int
// fn == nil

if fn != nil {
    fn(42) // only safe to call if not nil
}
```

Calling a nil function panics at runtime.

### Edge Case 7 — map[string]int Zero Value on Missing Key

```go
m := map[string]int{"a": 1}
v := m["nonexistent"]  // v == 0 (zero value for int), no panic
```

This is the defined behavior from the spec — reading a missing key returns the
zero value for the value type.

---

## 8. Version History

| Go Version | Change Relating to Zero Values |
|------------|-------------------------------|
| Go 1.0 | Zero value semantics established. All types have defined zero values. Recursive initialization guaranteed. |
| Go 1.5 | No change to zero value semantics. |
| Go 1.9 | `sync.Map` introduced; its zero value is valid and ready to use (demonstrates useful zero value design). |
| Go 1.18 | Generics added; zero value of a type parameter `T` is the zero value of its underlying type. The `*new(T)` idiom used to obtain zero value of type parameter in generics. |
| Go 1.21 | No change to zero value semantics. |
| Go 1.22 | Loop variable zero-value semantics unchanged; loop variable scoping change does not affect zero initialization. |

---

## 9. Implementation-Specific Behavior

### Memory Zeroing

The `gc` compiler and `gccgo` both guarantee that all allocated memory is
zero-filled before use. This is not just a language rule — it is implemented
at the hardware level using memory-clearing instructions (e.g., `memclr` on x86).

### Stack vs Heap Allocation

Whether a variable is allocated on the stack or the heap (escape analysis) does
not affect zero initialization. Both locations are zero-initialized.

### Compiler Optimization

A compiler is permitted to elide zero initialization if it can prove that the
variable is always written before it is read. However, the observable behavior
must be identical to zero initialization.

### float64 Zero Value and IEEE 754

The zero value for `float64` is IEEE 754 positive zero (`+0.0`). In IEEE 754,
`+0.0 == -0.0` is true, but they have different bit patterns. Go's zero value
is always `+0.0`.

---

## 10. Spec Compliance Checklist

- [ ] Variables declared without initializers produce their type's zero value
- [ ] `new(T)` returns a pointer to a zero-initialized T
- [ ] Composite literals zero-initialize omitted fields
- [ ] nil slice operations (len, cap, append, range) behave per spec
- [ ] Reading from a nil map returns the zero value (no panic)
- [ ] Writing to a nil map causes a panic (not undefined behavior)
- [ ] Nil interface differs from interface holding a typed nil pointer
- [ ] Struct zero values are not nil — they are valid values with zeroed fields
- [ ] Array zero values are not nil — each element is its type's zero value
- [ ] Recursive zero initialization applies to nested structs and arrays
- [ ] Calling a nil function panics (documented behavior, not undefined)

---

## 11. Official Examples

### Official Spec Example — Struct Zero Value

The following is taken directly from the Go Language Specification
(§The_zero_value):

```go
package main

import "fmt"

type T struct {
    i    int
    f    float64
    next *T
}

func main() {
    // Using new() — from the spec example
    t := new(T)
    fmt.Println(t.i)    // Output: 0
    fmt.Println(t.f)    // Output: 0
    fmt.Println(t.next) // Output: <nil>

    // Using var — spec states this is equivalent
    var t2 T
    fmt.Println(t2.i)    // Output: 0
    fmt.Println(t2.f)    // Output: 0
    fmt.Println(t2.next) // Output: <nil>

    // Spec equivalence: var i int  ≡  var i int = 0
    var i int
    var j int = 0
    fmt.Println(i == j) // Output: true
}
```

### Complete Zero Values for All Types

```go
package main

import "fmt"

func main() {
    // Boolean
    var b bool
    fmt.Printf("bool:       %v\n", b) // false

    // Integer types
    var i8 int8
    var i16 int16
    var i32 int32
    var i64 int64
    var i int
    fmt.Printf("int8:       %v\n", i8)  // 0
    fmt.Printf("int16:      %v\n", i16) // 0
    fmt.Printf("int32:      %v\n", i32) // 0
    fmt.Printf("int64:      %v\n", i64) // 0
    fmt.Printf("int:        %v\n", i)   // 0

    // Unsigned integer types
    var u8 uint8
    var u16 uint16
    var u32 uint32
    var u64 uint64
    var u uint
    fmt.Printf("uint8:      %v\n", u8)  // 0
    fmt.Printf("uint16:     %v\n", u16) // 0
    fmt.Printf("uint32:     %v\n", u32) // 0
    fmt.Printf("uint64:     %v\n", u64) // 0
    fmt.Printf("uint:       %v\n", u)   // 0

    // Aliases
    var by byte // alias for uint8
    var r rune  // alias for int32
    fmt.Printf("byte:       %v\n", by) // 0
    fmt.Printf("rune:       %v\n", r)  // 0

    // Float types
    var f32 float32
    var f64 float64
    fmt.Printf("float32:    %v\n", f32) // 0
    fmt.Printf("float64:    %v\n", f64) // 0

    // Complex types
    var c64 complex64
    var c128 complex128
    fmt.Printf("complex64:  %v\n", c64)  // (0+0i)
    fmt.Printf("complex128: %v\n", c128) // (0+0i)

    // String
    var s string
    fmt.Printf("string:     %q\n", s)      // ""
    fmt.Printf("string len: %v\n", len(s)) // 0

    // Pointer
    var p *int
    fmt.Printf("*int:       %v\n", p) // <nil>

    // Function
    var fn func(int) int
    fmt.Printf("func:       %v\n", fn) // <nil>

    // Interface
    var iface interface{}
    fmt.Printf("interface{}: %v\n", iface) // <nil>

    // Slice
    var sl []int
    fmt.Printf("[]int:      %v\n", sl)      // []
    fmt.Printf("slice nil:  %v\n", sl == nil) // true
    fmt.Printf("slice len:  %v\n", len(sl))  // 0
    fmt.Printf("slice cap:  %v\n", cap(sl))  // 0

    // Map
    var m map[string]int
    fmt.Printf("map:        %v\n", m)        // map[]
    fmt.Printf("map nil:    %v\n", m == nil) // true
    v := m["key"]
    fmt.Printf("map read:   %v\n", v) // 0 (no panic)

    // Channel
    var ch chan int
    fmt.Printf("chan:        %v\n", ch)        // <nil>
    fmt.Printf("chan nil:    %v\n", ch == nil) // true
}
```

### Struct with Multiple Fields — All Zero-Initialized

```go
package main

import "fmt"

type Address struct {
    Street string
    City   string
    Zip    string
}

type Person struct {
    Name    string
    Age     int
    Active  bool
    Score   float64
    Tags    []string
    Attrs   map[string]string
    Addr    Address    // nested struct — zeroed recursively
    Manager *Person    // pointer — nil
}

func main() {
    var p Person

    fmt.Println("Name:    ", p.Name)           // ""
    fmt.Println("Age:     ", p.Age)            // 0
    fmt.Println("Active:  ", p.Active)         // false
    fmt.Println("Score:   ", p.Score)          // 0
    fmt.Println("Tags:    ", p.Tags)           // []
    fmt.Println("Tags nil:", p.Tags == nil)    // true
    fmt.Println("Attrs:   ", p.Attrs)          // map[]
    fmt.Println("Attrs nil:", p.Attrs == nil)  // true
    fmt.Println("Addr:    ", p.Addr)           // {  }
    fmt.Println("Addr.Street:", p.Addr.Street) // ""
    fmt.Println("Manager: ", p.Manager)        // <nil>

    // Zero value is useful as default / sentinel
    // p.Manager == nil means "has no manager" — idiomatic Go
}
```

### Array of Structs — Recursive Zeroing

```go
package main

import "fmt"

type Point struct {
    X, Y float64
}

func main() {
    // Array of structs: each element is zero-initialized recursively
    var points [3]Point

    for i, p := range points {
        fmt.Printf("points[%d] = {X: %v, Y: %v}\n", i, p.X, p.Y)
    }
    // Output:
    // points[0] = {X: 0, Y: 0}
    // points[1] = {X: 0, Y: 0}
    // points[2] = {X: 0, Y: 0}

    // Composite literal — unspecified fields get zero value
    p := Point{X: 3.0} // Y is not specified → Y = 0.0
    fmt.Printf("p = {X: %v, Y: %v}\n", p.X, p.Y)
    // Output: p = {X: 3, Y: 0}
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Variables | https://go.dev/ref/spec#Variables | Where zero values first arise |
| Variable declarations | https://go.dev/ref/spec#Variable_declarations | `var` without initializer → zero value |
| Short variable declarations | https://go.dev/ref/spec#Short_variable_declarations | `:=` always provides explicit value, no zero init |
| Constants | https://go.dev/ref/spec#Constants | Constants have no zero value; they are never variables |
| Composite literals | https://go.dev/ref/spec#Composite_literals | Missing fields receive zero values |
| Making slices/maps/channels | https://go.dev/ref/spec#Making_slices_maps_and_channels | make() and zero initialization |
| Allocation | https://go.dev/ref/spec#Allocation | new() and zero initialization |
| Package initialization | https://go.dev/ref/spec#Package_initialization | Zero init precedes init() functions |
| Assignability | https://go.dev/ref/spec#Assignability | nil as zero value for reference types |
| Interface types | https://go.dev/ref/spec#Interface_types | nil interface: both type and value are nil |
