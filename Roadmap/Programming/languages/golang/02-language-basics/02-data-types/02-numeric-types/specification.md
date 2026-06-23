# Numeric Types — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Numeric_types

## Table of Contents
1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar](#2-formal-grammar)
3. [Core Rules](#3-core-rules)
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

### Numeric Types (from Go Language Specification)

> An integer, floating-point, or complex type represents the set of integer, floating-point, or complex values, respectively. They are collectively called **numeric types**. The predeclared architecture-independent numeric types are:
>
> ```
> uint8       the set of all unsigned  8-bit integers (0 to 255)
> uint16      the set of all unsigned 16-bit integers (0 to 65535)
> uint32      the set of all unsigned 32-bit integers (0 to 4294967295)
> uint64      the set of all unsigned 64-bit integers (0 to 18446744073709551615)
>
> int8        the set of all signed  8-bit integers (-128 to 127)
> int16       the set of all signed 16-bit integers (-32768 to 32767)
> int32       the set of all signed 32-bit integers (-2147483648 to 2147483647)
> int64       the set of all signed 64-bit integers (-9223372036854775808 to 9223372036854775807)
>
> float32     the set of all IEEE 754 32-bit floating-point numbers
> float64     the set of all IEEE 754 64-bit floating-point numbers
>
> complex64   the set of all complex numbers with float32 real and imaginary parts
> complex128  the set of all complex numbers with float64 real and imaginary parts
>
> byte        alias for uint8
> rune        alias for int32
> ```
>
> The value of an n-bit integer is n bits wide and represented using two's complement arithmetic.
>
> There is also a set of predeclared integer types with implementation-specific sizes:
>
> ```
> uint     either 32 or 64 bits
> int      same size as uint
> uintptr  an unsigned integer large enough to store the uninterpreted bits of a pointer value
> ```
>
> To avoid portability issues all numeric types are defined types and thus distinct except `byte`, which is an alias for `uint8`, and `rune`, which is an alias for `int32`. Explicit conversions are required when different numeric types are mixed in an expression or assignment. For instance, `int32` and `int` are not the same type even though they may have the same size on a particular architecture.

---

## 2. Formal Grammar

```ebnf
NumericType  = IntegerType | FloatType | ComplexType .
IntegerType  = "uint8" | "uint16" | "uint32" | "uint64"
             | "int8"  | "int16"  | "int32"  | "int64"
             | "uint"  | "int"    | "uintptr"
             | "byte"  | "rune" .
FloatType    = "float32" | "float64" .
ComplexType  = "complex64" | "complex128" .
```

These are all **predeclared identifiers** — they exist in the universe block and are always available without import.

---

## 3. Core Rules

### Rule 1: All numeric types are defined types
All 17 numeric types (including the implementation-specific `uint`, `int`, `uintptr`) are **defined types**. This means:
- Each has its own method set (initially empty for predeclared types)
- They are distinct from each other even if same underlying representation
- Exception: `byte` is an alias for `uint8`; `rune` is an alias for `int32`

### Rule 2: Aliases vs Defined Types
| Name | Kind | Equivalent To |
|------|------|---------------|
| `byte` | **alias** | `uint8` — identical, fully interchangeable |
| `rune` | **alias** | `int32` — identical, fully interchangeable |
| All others | **defined type** | distinct even if same size |

### Rule 3: No implicit numeric conversions
The spec requires **explicit conversions** when mixing numeric types:

```go
var a int32 = 5
var b int64 = int64(a)   // explicit conversion required
// var b int64 = a       // COMPILE ERROR
```

### Rule 4: Platform-dependent types
`int`, `uint`, and `uintptr` have implementation-specific sizes (32 or 64 bits). Code that assumes `int` is always 64 bits is not portable.

---

## 4. Type Rules

### Complete Type Table (All 17 Numeric Types)

| Type | Category | Size | Range / Description |
|------|----------|------|---------------------|
| `uint8` | Unsigned integer | 8 bits | 0 to 255 |
| `uint16` | Unsigned integer | 16 bits | 0 to 65,535 |
| `uint32` | Unsigned integer | 32 bits | 0 to 4,294,967,295 |
| `uint64` | Unsigned integer | 64 bits | 0 to 18,446,744,073,709,551,615 |
| `int8` | Signed integer | 8 bits | -128 to 127 |
| `int16` | Signed integer | 16 bits | -32,768 to 32,767 |
| `int32` | Signed integer | 32 bits | -2,147,483,648 to 2,147,483,647 |
| `int64` | Signed integer | 64 bits | -9,223,372,036,854,775,808 to 9,223,372,036,854,775,807 |
| `float32` | Floating-point | 32 bits | IEEE 754 single precision |
| `float64` | Floating-point | 64 bits | IEEE 754 double precision |
| `complex64` | Complex | 64 bits | float32 real + float32 imaginary |
| `complex128` | Complex | 128 bits | float64 real + float64 imaginary |
| `byte` | Alias | 8 bits | Alias for `uint8` |
| `rune` | Alias | 32 bits | Alias for `int32` |
| `uint` | Platform-dependent | 32 or 64 bits | Unsigned, same size as `int` |
| `int` | Platform-dependent | 32 or 64 bits | Signed, same size as `uint` |
| `uintptr` | Platform-dependent | large enough | Stores pointer bits |

### Zero Values
All numeric types have a zero value of `0` (or `0+0i` for complex types, `0.0` for floats).

### Comparability
- Integer types: comparable and **ordered** (`==`, `!=`, `<`, `<=`, `>`, `>=`)
- Floating-point types: comparable and **ordered** (as defined by IEEE 754)
- Complex types: comparable (`==`, `!=` only — **not ordered**)

---

## 5. Behavioral Specification

### Integer Representation
> The value of an n-bit integer is n bits wide and represented using **two's complement arithmetic**.

Two's complement means:
- For `int8`: bit pattern `10000000` represents `-128`
- For `uint8`: bit pattern `11111111` represents `255`

### Overflow Behavior
Integer overflow in Go is **well-defined** (unlike C/C++):
> When converting between integer types, if the value is a signed integer, it is sign extended to implicit infinite precision; otherwise it is zero extended. It is then truncated to fit in the result type's size. The conversion always yields a valid value; there is no indication of overflow.

This means arithmetic overflow **wraps around** predictably.

### Type Distinctness and Conversion
The spec is explicit: `int32` and `int` are **not the same type** even on a 32-bit platform where they have the same size. You must convert explicitly.

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec
| Behavior | Guarantee |
|----------|-----------|
| Integer two's complement | Always; bit-for-bit defined |
| Integer overflow | Wraps around — defined, not UB |
| `byte` == `uint8` | Fully interchangeable, same type |
| `rune` == `int32` | Fully interchangeable, same type |
| `int` size | 32 or 64 bits — NOT guaranteed to be 64 |
| Zero value | Always `0` for all numeric types |
| Numeric conversion truncation | Defined (truncate to fit) |

### Implementation-Dependent
| Behavior | Notes |
|----------|-------|
| Size of `int` / `uint` | 32 or 64 bits depending on platform |
| Size of `uintptr` | Large enough to hold pointer value |
| Float extended precision | May use more than declared precision internally |

---

## 7. Edge Cases from Spec

### Edge Case 1: int32 vs int on 32-bit
```go
var a int32 = 5
var b int   = 5
// a == b  // COMPILE ERROR even on 32-bit platform
```
They are distinct defined types.

### Edge Case 2: byte and uint8 are truly interchangeable
```go
var b byte  = 255
var u uint8 = b   // valid — no conversion needed
```

### Edge Case 3: uintptr is not a safe pointer
`uintptr` is an integer, not a pointer type. The garbage collector does not treat `uintptr` values as references to objects. Converting a pointer to `uintptr` and storing it may cause the GC to collect the pointed-to object.

### Edge Case 4: complex types are not ordered
```go
var c1 complex64 = 1 + 2i
var c2 complex64 = 3 + 4i
// c1 < c2  // COMPILE ERROR: complex types are not ordered
_ = c1 == c2  // valid
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | All 17 numeric types introduced |
| Go 1.0 | `byte` as alias for `uint8`; `rune` as alias for `int32` |
| Go 1.9 | `type aliases` introduced (`byte`/`rune` are true aliases, not defined types) |
| Go 1.18 | Type parameters and constraints can reference numeric types |

---

## 9. Implementation-Specific Behavior

### Standard gc Compiler (amd64)
| Type | `unsafe.Sizeof` |
|------|----------------|
| `int` | 8 bytes |
| `uint` | 8 bytes |
| `uintptr` | 8 bytes |
| `int32` | 4 bytes |
| `float64` | 8 bytes |

### Standard gc Compiler (386 / arm)
| Type | `unsafe.Sizeof` |
|------|----------------|
| `int` | 4 bytes |
| `uint` | 4 bytes |
| `uintptr` | 4 bytes |

---

## 10. Spec Compliance Checklist

- [ ] All 17 numeric type names are predeclared in the universe block
- [ ] `byte` is a true alias for `uint8` (interchangeable without conversion)
- [ ] `rune` is a true alias for `int32` (interchangeable without conversion)
- [ ] All other numeric types are defined types — distinct even if same size
- [ ] Mixed-type expressions require explicit conversion
- [ ] Integer arithmetic uses two's complement
- [ ] Integer overflow wraps — no undefined behavior
- [ ] `int`, `uint`, `uintptr` sizes are platform-dependent (32 or 64 bits)
- [ ] Complex types support `==` and `!=` but NOT `<`, `<=`, `>`, `>=`
- [ ] Zero value for all numeric types is `0`

---

## 11. Official Examples

### Example 1: All Numeric Types and Their Sizes

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    fmt.Printf("uint8:    %d bytes, range: 0 to 255\n", unsafe.Sizeof(uint8(0)))
    fmt.Printf("uint16:   %d bytes, range: 0 to 65535\n", unsafe.Sizeof(uint16(0)))
    fmt.Printf("uint32:   %d bytes, range: 0 to 4294967295\n", unsafe.Sizeof(uint32(0)))
    fmt.Printf("uint64:   %d bytes\n", unsafe.Sizeof(uint64(0)))
    fmt.Printf("int8:     %d bytes, range: -128 to 127\n", unsafe.Sizeof(int8(0)))
    fmt.Printf("int16:    %d bytes, range: -32768 to 32767\n", unsafe.Sizeof(int16(0)))
    fmt.Printf("int32:    %d bytes\n", unsafe.Sizeof(int32(0)))
    fmt.Printf("int64:    %d bytes\n", unsafe.Sizeof(int64(0)))
    fmt.Printf("float32:  %d bytes (IEEE 754)\n", unsafe.Sizeof(float32(0)))
    fmt.Printf("float64:  %d bytes (IEEE 754)\n", unsafe.Sizeof(float64(0)))
    fmt.Printf("complex64:  %d bytes\n", unsafe.Sizeof(complex64(0)))
    fmt.Printf("complex128: %d bytes\n", unsafe.Sizeof(complex128(0)))
    fmt.Printf("byte:     %d bytes (alias for uint8)\n", unsafe.Sizeof(byte(0)))
    fmt.Printf("rune:     %d bytes (alias for int32)\n", unsafe.Sizeof(rune(0)))
    fmt.Printf("int:      %d bytes (platform-dependent)\n", unsafe.Sizeof(int(0)))
    fmt.Printf("uint:     %d bytes (platform-dependent)\n", unsafe.Sizeof(uint(0)))
    fmt.Printf("uintptr:  %d bytes (platform-dependent)\n", unsafe.Sizeof(uintptr(0)))
}
```

### Example 2: Explicit Conversion Required Between Numeric Types

```go
package main

import "fmt"

func main() {
    var a int32 = 100
    var b int64 = int64(a)   // explicit conversion
    var c float64 = float64(a) // explicit conversion

    fmt.Println(a, b, c) // 100 100 100

    // byte and uint8 are interchangeable (aliases)
    var x byte = 65
    var y uint8 = x    // no conversion needed
    fmt.Println(x, y)  // 65 65

    // rune and int32 are interchangeable (aliases)
    var r rune  = 'A'
    var i int32 = r    // no conversion needed
    fmt.Println(r, i)  // 65 65
}
```

### Example 3: Zero Values

```go
package main

import "fmt"

func main() {
    var i   int
    var u   uint
    var f32 float32
    var f64 float64
    var c64 complex64
    var b   byte
    var r   rune

    fmt.Println(i, u, f32, f64, c64, b, r)
    // Output: 0 0 0 0 (0+0i) 0 0
}
```

### Example 4: Platform-Dependent Types

```go
package main

import (
    "fmt"
    "unsafe"
    "runtime"
)

func main() {
    fmt.Printf("GOARCH: %s\n", runtime.GOARCH)
    fmt.Printf("int size:     %d bytes\n", unsafe.Sizeof(int(0)))
    fmt.Printf("uint size:    %d bytes\n", unsafe.Sizeof(uint(0)))
    fmt.Printf("uintptr size: %d bytes\n", unsafe.Sizeof(uintptr(0)))
    // On amd64: all 3 are 8 bytes
    // On 386/arm: all 3 are 4 bytes
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Numeric types | https://go.dev/ref/spec#Numeric_types | Core definition of all 17 types |
| Integer types | https://go.dev/ref/spec#Numeric_types | Integer subtypes and two's complement |
| Float types | https://go.dev/ref/spec#Numeric_types | IEEE 754 floats |
| Complex types | https://go.dev/ref/spec#Numeric_types | complex64 / complex128 |
| Conversions | https://go.dev/ref/spec#Conversions | Rules for numeric conversions |
| Arithmetic operators | https://go.dev/ref/spec#Arithmetic_operators | +, -, *, /, % on numeric types |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | Ordering and equality of numeric types |
| Predeclared identifiers | https://go.dev/ref/spec#Predeclared_identifiers | Where numeric types are declared |
| Type aliases | https://go.dev/ref/spec#Alias_declarations | Why byte/rune are aliases not defined types |
| Constants | https://go.dev/ref/spec#Constants | Untyped numeric constants |
