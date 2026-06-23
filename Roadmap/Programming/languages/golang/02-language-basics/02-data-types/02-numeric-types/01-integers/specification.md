# Integers — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Numeric_types (integer section) + §Arithmetic_operators + §Integer_overflow

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

### Integer Types (from Go Language Specification)

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
> byte        alias for uint8
> rune        alias for int32
> ```
>
> The value of an n-bit integer is n bits wide and represented using **two's complement arithmetic**.
>
> There is also a set of predeclared integer types with implementation-specific sizes:
>
> ```
> uint     either 32 or 64 bits
> int      same size as uint
> uintptr  an unsigned integer large enough to store the uninterpreted bits of a pointer value
> ```

### Integer Overflow (from Go Language Specification — Arithmetic Operators)

> For integer values, `+`, `-`, `*`, and `<<` may legally overflow and the resulting value exists and is deterministically defined by the signed integer representation, the operation, and its operands. Overflow does not cause a run-time panic. A compiler may not optimize code under the assumption that overflow does not occur. For instance, it may not assume that `x < x + 1` is always true.

### Integer Division (from Go Language Specification)

> The quotient `q = x div y` and remainder `r = x mod y` satisfy the following relationships:
>
> ```
> x = q*y + r  and  |r| < |y|
> ```
>
> with `x div y` truncated towards zero.

---

## 2. Formal Grammar

From the Go specification, integer literal EBNF:

```ebnf
int_lit        = decimal_lit | binary_lit | octal_lit | hex_lit .
decimal_lit    = "0" | ( "1" … "9" ) [ [ "_" ] decimal_digits ] .
binary_lit     = "0" ( "b" | "B" ) [ "_" ] binary_digits .
octal_lit      = "0" [ "o" | "O" ] [ "_" ] octal_digits .
hex_lit        = "0" ( "x" | "X" ) [ "_" ] hex_digits .

decimal_digits = decimal_digit { [ "_" ] decimal_digit } .
binary_digits  = binary_digit  { [ "_" ] binary_digit  } .
octal_digits   = octal_digit   { [ "_" ] octal_digit   } .
hex_digits     = hex_digit     { [ "_" ] hex_digit     } .

decimal_digit  = "0" … "9" .
binary_digit   = "0" | "1" .
octal_digit    = "0" … "7" .
hex_digit      = "0" … "9" | "A" … "F" | "a" … "f" .
```

Note: Underscores (`_`) are allowed as digit separators for readability (introduced in Go 1.13).

---

## 3. Core Rules

### Rule 1: Two's Complement Representation
The spec mandates two's complement for all integer types. This means:
- Bit negation and arithmetic overflow have fully defined behavior
- The range for a signed n-bit integer is: -2^(n-1) to 2^(n-1)-1
- The range for an unsigned n-bit integer is: 0 to 2^n-1

### Rule 2: Overflow is Defined (Not Undefined Behavior)
Unlike C/C++, integer overflow in Go is **not undefined behavior**. It wraps around in a well-defined manner:

> For integer values, `+`, `-`, `*`, and `<<` may legally overflow and the resulting value exists and is deterministically defined.

### Rule 3: Division Truncates Toward Zero
Integer division always truncates toward zero. The remainder has the same sign as the dividend:

```
 5 /  3 =  1, remainder  2
-5 /  3 = -1, remainder -2
 5 / -3 = -1, remainder  2
-5 / -3 =  1, remainder -2
```

### Rule 4: Shift Operators
From the spec:
> The right operand in a shift expression must have integer type or be an untyped constant representable by a value of type `uint`. The type of a shift expression is the type of the left operand.

Left shift `x << n` = x * 2^n (for unsigned; wraps for signed)
Right shift `x >> n` = x / 2^n (arithmetic shift for signed, logical for unsigned)

---

## 4. Type Rules

### Size Guarantees Table

| Type | Size | Min Value | Max Value |
|------|------|-----------|-----------|
| `uint8` / `byte` | 8 bits | 0 | 255 |
| `uint16` | 16 bits | 0 | 65,535 |
| `uint32` | 32 bits | 0 | 4,294,967,295 |
| `uint64` | 64 bits | 0 | 18,446,744,073,709,551,615 |
| `int8` | 8 bits | -128 | 127 |
| `int16` | 16 bits | -32,768 | 32,767 |
| `int32` / `rune` | 32 bits | -2,147,483,648 | 2,147,483,647 |
| `int64` | 64 bits | -9,223,372,036,854,775,808 | 9,223,372,036,854,775,807 |
| `int` | 32 or 64 bits | platform | platform |
| `uint` | 32 or 64 bits | 0 | platform |
| `uintptr` | platform | 0 | platform |

### Exact Range Formulas
- `uint8`: 0 to 2^8-1 = 0 to 255
- `int8`: -2^7 to 2^7-1 = -128 to 127
- `uint64`: 0 to 2^64-1 = 0 to 18446744073709551615
- `int64`: -2^63 to 2^63-1

### Arithmetic Operators on Integers

| Operator | Description |
|----------|-------------|
| `+` | Sum |
| `-` | Difference |
| `*` | Product |
| `/` | Quotient (truncates toward zero) |
| `%` | Remainder |
| `&` | Bitwise AND |
| `\|` | Bitwise OR |
| `^` | Bitwise XOR |
| `&^` | Bit clear (AND NOT) |
| `<<` | Left shift |
| `>>` | Right shift |

---

## 5. Behavioral Specification

### Two's Complement Overflow (Spec-Defined)

For a signed 8-bit integer (`int8`):
- Max value: 127 (binary: `01111111`)
- Adding 1: wraps to -128 (binary: `10000000`)

```go
var x int8 = 127
x++         // x is now -128 (defined behavior, not panic)
```

For an unsigned 8-bit integer (`uint8`):
- Max value: 255 (binary: `11111111`)
- Adding 1: wraps to 0 (binary: `00000000`)

```go
var y uint8 = 255
y++         // y is now 0 (defined behavior, not panic)
```

### Division and Modulo Rules
From the spec, the division algorithm guarantees:
- `q = x/y` truncated toward zero (not floor division)
- `r = x%y` such that `x == q*y + r`
- `|r| < |y|` always holds

### Bitwise Operations
All bitwise operations (`&`, `|`, `^`, `&^`, `<<`, `>>`) operate on the two's complement representation of the integer.

- `^x` (unary): bitwise complement — flips all bits
- `&^` (binary): bit clear — `x &^ y` clears bits in `x` where `y` has 1s

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec (No Undefined Behavior in Go)

| Operation | Go Behavior | C Behavior (for contrast) |
|-----------|------------|---------------------------|
| Signed integer overflow | Wraps (two's complement) | Undefined behavior |
| Unsigned integer overflow | Wraps modulo 2^n | Well-defined in C too |
| Integer division by zero | Runtime panic | Undefined behavior |
| Left shift beyond width | Defined (zero bits shifted in) | Undefined behavior in C |
| Negative right-shift amount | Compile error / runtime panic | Undefined behavior |

### Runtime Panics (Defined)
Division by zero causes a **runtime panic** (not undefined behavior):

```go
var x int = 5
var y int = 0
z := x / y  // runtime panic: integer divide by zero
```

---

## 7. Edge Cases from Spec

### Edge Case 1: Integer Literal Overflow at Compile Time
An integer constant that overflows its target type is a **compile error**:

```go
var x int8 = 200   // COMPILE ERROR: constant 200 overflows int8
```

But at runtime, wrapping is defined:
```go
var x int8 = 127
x += 1  // valid at runtime: x becomes -128
```

### Edge Case 2: Shift Count Type
Before Go 1.13, shift counts had to be unsigned. Since Go 1.13:
> The right operand in a shift expression must have integer type or be an untyped constant representable by a value of type `uint`.

```go
var n int = 3
var x int = 1 << n    // valid since Go 1.13 (n is signed int)
```

### Edge Case 3: int32 vs int (Even on 32-bit Platform)
```go
var a int32 = 5
var b int   = 5
// a = b  // COMPILE ERROR: cannot use b (type int) as type int32
a = int32(b)  // valid
```

### Edge Case 4: Untyped Integer Constants Have Arbitrary Precision
```go
const big = 1000000000000000000000  // valid untyped integer constant
// var x int64 = big  // COMPILE ERROR: big overflows int64
const small = big / 1000000000000  // still an untyped constant computation
```

### Edge Case 5: Conversion Truncation
```go
var a int16 = 0x10F0
b := int8(a)     // truncates to 0xF0 = -16 (two's complement)
c := uint32(int8(uint16(0x10F0)))  // 0xFFFFFFF0 per spec example
fmt.Println(b, c)
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | All integer types introduced with two's complement semantics |
| Go 1.0 | Integer overflow defined as wrapping (no UB) |
| Go 1.13 | Signed shift counts allowed (`x << n` where `n` is `int`) |
| Go 1.13 | Underscore digit separator in integer literals (`1_000_000`) |
| Go 1.13 | Binary (`0b`) and octal (`0o`) integer literal prefixes added |
| Go 1.17 | `unsafe.Add` and `unsafe.Slice` added for pointer arithmetic |

---

## 9. Implementation-Specific Behavior

### Memory Layout (gc compiler, amd64)
| Type | `unsafe.Sizeof` | `unsafe.Alignof` |
|------|----------------|------------------|
| `int8` | 1 | 1 |
| `int16` | 2 | 2 |
| `int32` | 4 | 4 |
| `int64` | 8 | 8 |
| `uint8` | 1 | 1 |
| `uint16` | 2 | 2 |
| `uint32` | 4 | 4 |
| `uint64` | 8 | 8 |
| `int` | 8 | 8 |
| `uint` | 8 | 8 |
| `uintptr` | 8 | 8 |

### Compiler Optimizations
The spec states:
> A compiler may not optimize code under the assumption that overflow does not occur.

This prevents the compiler from removing code that relies on overflow behavior.

---

## 10. Spec Compliance Checklist

- [ ] Integer types use two's complement representation
- [ ] Signed integer overflow wraps — no undefined behavior
- [ ] Unsigned integer overflow wraps modulo 2^n
- [ ] Integer division truncates toward zero (not floor division)
- [ ] Remainder `x%y` has the same sign as the dividend `x`
- [ ] Division by zero causes runtime panic (not UB)
- [ ] `int`, `uint`, `uintptr` are platform-dependent (32 or 64 bits)
- [ ] `int32` and `int` are distinct types even if same size
- [ ] Untyped integer constants have arbitrary precision
- [ ] Shift count may be signed since Go 1.13
- [ ] Negative shift count causes runtime panic
- [ ] Overflow at compile time (constant overflow) is a compile error

---

## 11. Official Examples

### Example 1: Integer Ranges and Overflow

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    // Fixed-size integer ranges (from spec)
    fmt.Printf("int8:   %d to %d\n", math.MinInt8, math.MaxInt8)   // -128 to 127
    fmt.Printf("int16:  %d to %d\n", math.MinInt16, math.MaxInt16) // -32768 to 32767
    fmt.Printf("int32:  %d to %d\n", math.MinInt32, math.MaxInt32)
    fmt.Printf("int64:  %d to %d\n", math.MinInt64, math.MaxInt64)
    fmt.Printf("uint8:  %d to %d\n", 0, math.MaxUint8)   // 0 to 255
    fmt.Printf("uint16: %d to %d\n", 0, math.MaxUint16)  // 0 to 65535
    fmt.Printf("uint32: %d to %d\n", 0, math.MaxUint32)
    fmt.Printf("uint64: %d to %d\n", 0, uint64(math.MaxUint64))

    // Overflow wraps (spec-defined, not panic)
    var a int8 = 127
    a++
    fmt.Printf("int8 overflow: 127++ = %d\n", a) // -128

    var b uint8 = 255
    b++
    fmt.Printf("uint8 overflow: 255++ = %d\n", b) // 0
}
```

### Example 2: Integer Division and Modulo (Truncation Toward Zero)

```go
package main

import "fmt"

func main() {
    // Spec: quotient truncated toward zero
    fmt.Println(7 / 2)    //  3 (not 3.5, truncated)
    fmt.Println(-7 / 2)   // -3 (not -4, truncated toward zero)
    fmt.Println(7 / -2)   // -3
    fmt.Println(-7 / -2)  //  3

    // Remainder has same sign as dividend
    fmt.Println(7 % 2)    //  1
    fmt.Println(-7 % 2)   // -1 (sign matches dividend -7)
    fmt.Println(7 % -2)   //  1 (sign matches dividend 7)
    fmt.Println(-7 % -2)  // -1

    // Verify spec invariant: x = (x/y)*y + x%y
    x, y := -7, 2
    fmt.Println(x == (x/y)*y + x%y) // true
}
```

### Example 3: Bitwise Operations

```go
package main

import "fmt"

func main() {
    a := 0b10110100  // binary literal (Go 1.13+)
    b := 0b11001010

    fmt.Printf("a      = %08b\n", a)
    fmt.Printf("b      = %08b\n", b)
    fmt.Printf("a & b  = %08b\n", a&b)   // bitwise AND
    fmt.Printf("a | b  = %08b\n", a|b)   // bitwise OR
    fmt.Printf("a ^ b  = %08b\n", a^b)   // bitwise XOR
    fmt.Printf("a &^ b = %08b\n", a&^b)  // bit clear (AND NOT)
    fmt.Printf("a << 2 = %08b\n", a<<2)  // left shift
    fmt.Printf("a >> 2 = %08b\n", a>>2)  // right shift
    fmt.Printf("^a     = %08b\n", uint8(^a)) // bitwise complement
}
```

### Example 4: Platform-Dependent int Size

```go
package main

import (
    "fmt"
    "unsafe"
    "math/bits"
)

func main() {
    // Spec: int is either 32 or 64 bits
    intSize := unsafe.Sizeof(int(0)) * 8
    fmt.Printf("int is %d-bit on this platform\n", intSize)

    // Use bits.UintSize for portable code
    fmt.Printf("bits.UintSize = %d\n", bits.UintSize)
}
```

### Example 5: Integer Literal Formats (Go 1.13+)

```go
package main

import "fmt"

func main() {
    decimal := 255
    binary  := 0b11111111
    octal   := 0o377
    hex     := 0xFF

    fmt.Println(decimal, binary, octal, hex)  // 255 255 255 255

    // Digit separators for readability
    million := 1_000_000
    fmt.Println(million)  // 1000000

    // Hex with separators
    mask := 0xFF_FF_FF_FF
    fmt.Printf("mask = %d\n", mask) // 4294967295
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Numeric types | https://go.dev/ref/spec#Numeric_types | Integer type declarations |
| Arithmetic operators | https://go.dev/ref/spec#Arithmetic_operators | +, -, *, /, %, bitwise, shift |
| Integer literals | https://go.dev/ref/spec#Integer_literals | Decimal, binary, octal, hex |
| Conversions between numeric types | https://go.dev/ref/spec#Conversions | Truncation rules |
| Constant expressions | https://go.dev/ref/spec#Constant_expressions | Arbitrary precision in constants |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | Integer comparison is ordered |
| Predeclared identifiers | https://go.dev/ref/spec#Predeclared_identifiers | `int`, `uint`, `byte`, `rune` |
| Run-time panics | https://go.dev/ref/spec#Run_time_panics | Division by zero |
| unsafe package | https://pkg.go.dev/unsafe | Pointer/integer interop |
| math package | https://pkg.go.dev/math | `MaxInt8`, `MinInt64`, etc. |
