# Floating-Point Types — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Numeric_types (float section) + IEEE 754-2008

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

### Floating-Point Types (from Go Language Specification)

> ```
> float32     the set of all IEEE 754 32-bit floating-point numbers
> float64     the set of all IEEE 754 64-bit floating-point numbers
> ```

> Floating-point types are comparable and ordered. Two floating-point values are compared as defined by the **IEEE 754 standard**.

### Floating-Point Conversion Rules (from Go Language Specification)

> When converting an integer or floating-point number to a floating-point type, or a complex number to another complex type, the result value is rounded to the precision specified by the destination type. For instance, the value of a variable `x` of type `float32` may be stored using additional precision beyond that of an IEEE 754 32-bit number, but `float32(x)` represents the result of rounding `x`'s value to 32-bit precision. Similarly, `x + 0.1` may use more than 32 bits of precision, but `float32(x + 0.1)` does not.
>
> In all non-constant conversions involving floating-point or complex values, if the result type cannot represent the value the conversion succeeds but the result value is **implementation-dependent**.

### Floating-Point Arithmetic (from Go Language Specification)

> Floating-point constants represent exact values in the set of all rational numbers with an infinite number of bits; they are not bounded by the hardware precision of the platform.

---

## 2. Formal Grammar

From the Go specification, floating-point literal EBNF:

```ebnf
float_lit         = decimal_float_lit | hex_float_lit .

decimal_float_lit = decimal_digits "." [ decimal_digits ] [ decimal_exponent ] |
                    decimal_digits decimal_exponent |
                    "." decimal_digits [ decimal_exponent ] .
decimal_exponent  = ( "e" | "E" ) [ "+" | "-" ] decimal_digits .

hex_float_lit     = "0" ( "x" | "X" ) hex_mantissa hex_exponent .
hex_mantissa      = [ "_" ] hex_digits "." [ hex_digits ] |
                    [ "_" ] hex_digits |
                    "." hex_digits .
hex_exponent      = ( "p" | "P" ) [ "+" | "-" ] decimal_digits .
```

Examples from the spec:
```
0.
72.40
072.40       // == 72.40
2.71828
1.e+0
6.67428e-11
1E6
.25
.12345E+5
1_5.         // == 15.0
0.15e+0_2    // == 15.0
0x1p-2       // == 0.25
0x2.p10      // == 2048.0
0x1.Fp+0     // == 1.9375
0X.8p-0      // == 0.5
0x15e-2      // == 0x15e - 2 (integer subtraction! not a float)
```

---

## 3. Core Rules

### Rule 1: IEEE 754 Conformance
Both `float32` and `float64` conform to the **IEEE 754-2008** standard:
- `float32`: IEEE 754 binary32 (single precision)
- `float64`: IEEE 754 binary64 (double precision)

### Rule 2: NaN and Infinity
IEEE 754 defines special values that Go fully supports:
- `+Inf`, `-Inf`: positive and negative infinity
- `NaN`: Not-a-Number (result of 0/0, sqrt of negative, etc.)

The `math` package provides:
```go
math.Inf(1)   // +Inf
math.Inf(-1)  // -Inf
math.NaN()    // NaN
math.IsNaN(x)
math.IsInf(x, 0)  // either Inf
```

### Rule 3: NaN Comparison (IEEE 754)
Per IEEE 754 and the Go spec:
> Two floating-point values are compared as defined by the IEEE 754 standard.

IEEE 754 mandates: `NaN != NaN` is **true**. Any comparison involving NaN returns **false** (except `!=`).

```go
nan := math.NaN()
fmt.Println(nan == nan)  // false (IEEE 754 rule)
fmt.Println(nan != nan)  // true
fmt.Println(nan < 1.0)   // false
fmt.Println(nan > 1.0)   // false
```

### Rule 4: Negative Zero
IEEE 754 defines `-0.0` and `+0.0` as equal:
```go
fmt.Println(-0.0 == 0.0)  // true (IEEE 754)
```

### Rule 5: float64 is the Default Untyped Float
Untyped floating-point constants default to `float64`:
```go
x := 1.5       // x is float64
var y = 1.5    // y is float64
```

---

## 4. Type Rules

### IEEE 754 Binary32 (float32) Structure
| Component | Bits | Description |
|-----------|------|-------------|
| Sign | 1 | 0 = positive, 1 = negative |
| Exponent | 8 | Biased exponent (bias = 127) |
| Mantissa | 23 | Fractional bits (24 effective with implicit 1) |

- Approximate range: ±1.18 × 10^-38 to ±3.4 × 10^38
- Decimal precision: ~7 significant decimal digits

### IEEE 754 Binary64 (float64) Structure
| Component | Bits | Description |
|-----------|------|-------------|
| Sign | 1 | 0 = positive, 1 = negative |
| Exponent | 11 | Biased exponent (bias = 1023) |
| Mantissa | 52 | Fractional bits (53 effective with implicit 1) |

- Approximate range: ±2.23 × 10^-308 to ±1.8 × 10^308
- Decimal precision: ~15-17 significant decimal digits

### Special Values (IEEE 754)

| Value | float32 bits | float64 bits | Go representation |
|-------|-------------|-------------|-------------------|
| `+Inf` | `0 11111111 00000000000000000000000` | exponent all 1s, mantissa 0 | `math.Inf(1)` |
| `-Inf` | `1 11111111 00000000000000000000000` | exponent all 1s, mantissa 0 | `math.Inf(-1)` |
| `NaN` | `_ 11111111 non-zero mantissa` | exponent all 1s, mantissa ≠ 0 | `math.NaN()` |
| `+0` | `0 00000000 00000000000000000000000` | all bits 0 | `0.0` |
| `-0` | `1 00000000 00000000000000000000000` | sign=1, rest 0 | `-0.0` |

### Arithmetic Operators on Floats

| Operator | Description |
|----------|-------------|
| `+` | Sum (IEEE 754 round to nearest) |
| `-` | Difference |
| `*` | Product |
| `/` | Quotient |
| `==`, `!=`, `<`, `<=`, `>`, `>=` | IEEE 754 comparison |

Note: `%` (modulo) is **not defined** for floating-point types. Use `math.Mod` instead.

---

## 5. Behavioral Specification

### Rounding
From the spec:
> When converting an integer or floating-point number to a floating-point type, the result value is rounded to the precision specified by the destination type.

IEEE 754 default rounding mode: **round to nearest, ties to even** (banker's rounding).

### Extended Precision
From the spec:
> The value of a variable `x` of type `float32` may be stored using additional precision beyond that of an IEEE 754 32-bit number.

This means intermediate calculations may use higher precision. The explicit conversion `float32(x)` forces rounding to 32-bit precision.

### Floating-Point Division by Zero
IEEE 754 defines division of a finite non-zero number by zero:
- `1.0 / 0.0` produces `+Inf`
- `-1.0 / 0.0` produces `-Inf`
- `0.0 / 0.0` produces `NaN`

Unlike integer division by zero, **floating-point division by zero does NOT panic**.

```go
a := 1.0 / 0.0    // +Inf (no panic)
b := -1.0 / 0.0   // -Inf (no panic)
c := 0.0 / 0.0    // NaN (no panic)
```

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec

| Operation | Behavior |
|-----------|----------|
| `NaN == NaN` | Always `false` (IEEE 754) |
| `NaN != NaN` | Always `true` |
| Any comparison with NaN | Always `false` (except `!=`) |
| `+Inf + x` (finite x) | `+Inf` |
| `+Inf - +Inf` | `NaN` |
| `1.0 / 0.0` | `+Inf` (no panic) |
| `0.0 / 0.0` | `NaN` (no panic) |
| `-0.0 == 0.0` | `true` |
| Float overflow → Inf | No panic, produces Inf |

### Implementation-Dependent

| Behavior | Notes |
|----------|-------|
| Extended precision of intermediate results | Compiler may use 80-bit x87 |
| Result of `float32(x + 0.1)` | May differ across architectures |
| NaN payload bits | Implementation-specific |

### No Runtime Panic for Float Operations
Unlike integer division by zero, floating-point operations never cause runtime panics. They produce IEEE 754 special values instead.

---

## 7. Edge Cases from Spec

### Edge Case 1: Float Constants Have Infinite Precision
```go
// Valid: untyped float constant (no precision limit)
const Pi = 3.14159265358979323846264338327950288419716939937510

// When assigned to float64, rounded to float64 precision
var f float64 = Pi
// When assigned to float32, rounded to float32 precision
var g float32 = Pi
```

### Edge Case 2: Representation Error
Not all decimal fractions can be represented exactly in binary:
```go
var x float64 = 0.1 + 0.2
fmt.Println(x)          // 0.30000000000000004 (not exactly 0.3)
fmt.Println(x == 0.3)   // false
```

### Edge Case 3: Overflow in Conversion
```go
var big float64 = 1e308
f32 := float32(big)
fmt.Println(f32)  // +Inf (float32 can't represent 1e308)
```
No panic — the spec says "conversion succeeds but result value is implementation-dependent."

### Edge Case 4: float32(x) Forces Rounding
```go
var x float32 = 1.0
result := x + 0.1           // may use float64 precision internally
rounded := float32(x + 0.1) // forced to float32 precision
```

### Edge Case 5: Unordered Comparisons and NaN
IEEE 754 defines four comparison outcomes: less than, equal, greater than, and **unordered** (when either operand is NaN). Go maps unordered to false for all ordering comparisons and false for equality.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `float32` and `float64` as IEEE 754 types |
| Go 1.0 | `math.NaN()`, `math.Inf()`, `math.IsNaN()`, `math.IsInf()` |
| Go 1.13 | Hex floating-point literals (`0x1.8p+1`) |
| Go 1.13 | Digit separators in float literals (`1_234.567_89`) |

---

## 9. Implementation-Specific Behavior

### Memory Layout (gc compiler)
| Type | `unsafe.Sizeof` | `unsafe.Alignof` |
|------|----------------|------------------|
| `float32` | 4 bytes | 4 bytes |
| `float64` | 8 bytes | 8 bytes |

### Extended Precision (x87 FPU)
On x86 (32-bit), the hardware FPU operates in 80-bit extended precision by default. The gc compiler uses SSE2 instructions (64-bit precision) for `float64` operations on amd64, which avoids this issue.

### NaN Signaling vs Quiet
Go only produces **quiet NaN** (qNaN). The `math.NaN()` function returns a quiet NaN. Signaling NaN (sNaN) is not used in Go.

---

## 10. Spec Compliance Checklist

- [ ] `float32` conforms to IEEE 754-2008 binary32
- [ ] `float64` conforms to IEEE 754-2008 binary64
- [ ] `NaN == NaN` must return `false`
- [ ] `NaN != NaN` must return `true`
- [ ] Floating-point division by zero does NOT cause runtime panic (produces Inf/NaN)
- [ ] `+0.0 == -0.0` returns `true`
- [ ] Float overflow in conversion produces Inf, not panic
- [ ] Untyped float constants default to `float64`
- [ ] `float32(x)` rounds to 32-bit precision
- [ ] `%` operator is not defined for float types (compile error)
- [ ] Intermediate results may use extended precision

---

## 11. Official Examples

### Example 1: IEEE 754 Special Values

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    posInf := math.Inf(1)
    negInf := math.Inf(-1)
    nan    := math.NaN()

    fmt.Println("posInf:", posInf)       // +Inf
    fmt.Println("negInf:", negInf)       // -Inf
    fmt.Println("nan:", nan)             // NaN

    // IEEE 754: NaN comparisons
    fmt.Println("nan == nan:", nan == nan)   // false
    fmt.Println("nan != nan:", nan != nan)   // true
    fmt.Println("nan < 1:", nan < 1)         // false
    fmt.Println("nan > 1:", nan > 1)         // false

    // IsNaN to properly detect NaN
    fmt.Println("IsNaN:", math.IsNaN(nan))   // true

    // Inf arithmetic
    fmt.Println("Inf + 1:", posInf + 1)      // +Inf
    fmt.Println("Inf - Inf:", posInf - posInf) // NaN

    // Float division by zero: no panic
    x := 1.0
    y := 0.0
    fmt.Println("1.0/0.0:", x/y)    // +Inf
    fmt.Println("0.0/0.0:", y/y)    // NaN
    fmt.Println("-1.0/0.0:", -x/y)  // -Inf
}
```

### Example 2: Float32 vs Float64 Precision

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    // float32: ~7 significant decimal digits
    var f32 float32 = 3.14159265358979323846
    fmt.Printf("float32: %.20f\n", f32)
    // Output: 3.14159274101257324219

    // float64: ~15-17 significant decimal digits
    var f64 float64 = 3.14159265358979323846
    fmt.Printf("float64: %.20f\n", f64)
    // Output: 3.14159265358979323846

    // Max and min values
    fmt.Printf("float32 max: %e\n", math.MaxFloat32)   // 3.402823e+38
    fmt.Printf("float64 max: %e\n", math.MaxFloat64)   // 1.797693e+308
    fmt.Printf("float32 smallest: %e\n", math.SmallestNonzeroFloat32)
    fmt.Printf("float64 smallest: %e\n", math.SmallestNonzeroFloat64)
}
```

### Example 3: Floating-Point Representation Pitfalls

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    // 0.1 + 0.2 != 0.3 in binary floating point
    x := 0.1 + 0.2
    fmt.Printf("0.1 + 0.2 = %.17f\n", x) // 0.30000000000000004
    fmt.Println(x == 0.3)                  // false

    // Proper float comparison using epsilon
    epsilon := 1e-9
    fmt.Println(math.Abs(x-0.3) < epsilon) // true

    // Negative zero
    negZero := -0.0
    posZero := 0.0
    fmt.Println(negZero == posZero)       // true (IEEE 754)
    fmt.Println(math.Signbit(negZero))    // true (-0.0 has negative sign bit)
    fmt.Println(math.Signbit(posZero))    // false

    // float32(x) forces rounding
    var a float32 = 1.0
    b := a + 0.1            // may use extended precision
    c := float32(a + 0.1)   // rounded to float32
    fmt.Println(b, c)
}
```

### Example 4: Hex Float Literals (Go 1.13+)

```go
package main

import "fmt"

func main() {
    // Hex float literals: 0x<mantissa>p<exponent>
    // p exponent is base-2
    a := 0x1p0      // 1.0 * 2^0 = 1.0
    b := 0x1p1      // 1.0 * 2^1 = 2.0
    c := 0x1.8p1    // 1.5 * 2^1 = 3.0
    d := 0x1p-2     // 1.0 * 2^-2 = 0.25

    fmt.Println(a, b, c, d) // 1 2 3 0.25

    // Useful for exact float representation
    exact := 0x1.fffffep+127  // max float32 (exact!)
    fmt.Printf("%.7e\n", float32(exact))
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Numeric types | https://go.dev/ref/spec#Numeric_types | float32/float64 declarations |
| Floating-point literals | https://go.dev/ref/spec#Floating-point_literals | EBNF for float literals |
| Arithmetic operators | https://go.dev/ref/spec#Arithmetic_operators | IEEE 754 arithmetic |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | IEEE 754 comparisons |
| Conversions | https://go.dev/ref/spec#Conversions | Float conversion rounding rules |
| Constants | https://go.dev/ref/spec#Constants | Infinite precision float constants |
| Complex literals | https://go.dev/ref/spec#Imaginary_literals | Float used in complex numbers |
| math package | https://pkg.go.dev/math | NaN, Inf, IsNaN, MaxFloat32/64 |
| IEEE 754-2008 | https://ieeexplore.ieee.org/document/4610935 | The underlying standard |
