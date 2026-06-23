# Complex Numbers — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Numeric_types (complex section) + §Complex_literals + §Built-in_functions

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

### Complex Types (from Go Language Specification)

> ```
> complex64   the set of all complex numbers with float32 real and imaginary parts
> complex128  the set of all complex numbers with float64 real and imaginary parts
> ```

> Complex types are comparable. Two complex values `u` and `v` are equal if both `real(u) == real(v)` and `imag(u) == imag(v)`.

### Built-in Functions for Complex Numbers (from Go Language Specification)

> Three functions assemble and disassemble complex numbers. The built-in function `complex` constructs a complex value from a floating-point real and imaginary part, while `real` and `imag` extract the real and imaginary parts of a complex value.
>
> ```
> complex(realPart, imagPart FloatType) ComplexType
> real(complexValue ComplexType) FloatType
> imag(complexValue ComplexType) FloatType
> ```
>
> The type of the arguments and return value correspond. For `complex`, the two arguments must be of the same floating-point type and the return type is the complex type with the corresponding floating-point components: `complex64` for `float32` arguments, and `complex128` for `float64` arguments.
>
> If the operands of a complex call are untyped constants, they are converted to the type of the other operand. If both operands are untyped, they must both be integer or floating-point constants and the return value is an untyped complex constant.

### Imaginary Literals (from Go Language Specification)

> An imaginary literal represents the imaginary part of a complex constant. It consists of an integer or floating-point literal followed by the lowercase letter `i`.

---

## 2. Formal Grammar

From the Go specification, imaginary literal EBNF:

```ebnf
imaginary_lit = (decimal_digits | int_lit | float_lit) "i" .
```

Examples from the spec:
```
0i
0123i         // == 123i for backward-compatibility
0o123i        // == 0o123 * 1i == 83i
0xabci        // == 0xabc * 1i == 2748i
0.i
2.71828i
1.e+0i
6.67428e-11i
1E6i
.25i
.12345E+5i
0x1p-2i       // == 0x1p-2 * 1i == 0.25i
```

Note: `0123i` is `123i` (not `83i`) because imaginary literals do not inherit the octal-by-prefix rule from integer literals.

---

## 3. Core Rules

### Rule 1: Two Component Types
- `complex64`: real part is `float32`, imaginary part is `float32`
- `complex128`: real part is `float64`, imaginary part is `float64`

Each complex type is built from two IEEE 754 floating-point values of the corresponding size.

### Rule 2: Comparable but Not Ordered
From the spec:
> Complex types are comparable. Two complex values `u` and `v` are equal if both `real(u) == real(v)` and `imag(u) == imag(v)`.

Complex types support `==` and `!=` but **NOT** `<`, `<=`, `>`, `>=` — they are not ordered.

### Rule 3: complex() Built-in Returns Typed Result
```go
complex(float32(1.0), float32(2.0)) // returns complex64
complex(float64(1.0), float64(2.0)) // returns complex128
complex(1.0, 2.0)                   // untyped complex constant
```

### Rule 4: real() and imag() Extract Components
```go
var c complex128 = 3 + 4i
r := real(c)   // float64(3)
i := imag(c)   // float64(4)
```

### Rule 5: Default Untyped Complex
Untyped complex constants default to `complex128` when given a type context, consistent with `float64` being the default float type.

---

## 4. Type Rules

### Type Table

| Type | Total Size | Real Part | Imaginary Part |
|------|-----------|-----------|----------------|
| `complex64` | 8 bytes | `float32` (4 bytes) | `float32` (4 bytes) |
| `complex128` | 16 bytes | `float64` (8 bytes) | `float64` (8 bytes) |

### Built-in Function Signatures (from Spec)

```
func complex(r, i FloatType) ComplexType
func real(c ComplexType) FloatType
func imag(c ComplexType) FloatType
```

Precise type matching:

| Argument types | Result type |
|----------------|-------------|
| `float32, float32` | `complex64` |
| `float64, float64` | `complex128` |
| untyped, untyped | untyped complex constant |

### Arithmetic Operations

| Operation | Behavior |
|-----------|----------|
| `c1 + c2` | `real(c1+c2) = real(c1)+real(c2)`, `imag(c1+c2) = imag(c1)+imag(c2)` |
| `c1 - c2` | `real(c1-c2) = real(c1)-real(c2)`, `imag(c1-c2) = imag(c1)-imag(c2)` |
| `c1 * c2` | `(a+bi)(c+di) = (ac-bd) + (ad+bc)i` |
| `c1 / c2` | Standard complex division |
| `c1 == c2` | `real(c1)==real(c2) && imag(c1)==imag(c2)` |

### Zero Value
The zero value for complex types is `0 + 0i` (both real and imaginary parts are 0.0).

---

## 5. Behavioral Specification

### Arithmetic Rules for Complex Multiplication
For complex numbers `(a + bi)` and `(c + di)`:
```
(a + bi) * (c + di) = (ac - bd) + (ad + bc)i
```

Go's implementation follows standard complex arithmetic. The underlying IEEE 754 operations apply to each component.

### NaN Propagation in Complex Numbers
Since complex numbers are built from IEEE 754 floats, NaN propagates:
```go
import "math"
c := complex(math.NaN(), 1.0)
d := complex(2.0, 3.0)
result := c + d  // real part is NaN
```

The equality rule from the spec:
> Two complex values u and v are equal if both `real(u) == real(v)` and `imag(u) == imag(v)`.

Since `NaN != NaN` (IEEE 754), a complex with NaN component is never equal to itself:
```go
c := complex(math.NaN(), 0)
fmt.Println(c == c)  // false (because NaN != NaN in real part)
```

### Division by Zero
Complex division by zero follows IEEE 754 rules for each component. The result may contain `Inf` or `NaN` components. No runtime panic.

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec

| Operation | Behavior |
|-----------|----------|
| `complex(a, b) == complex(a, b)` | Delegates to float IEEE 754 comparison |
| Complex with NaN component | NaN propagation follows IEEE 754 |
| Complex division by zero | IEEE 754 rules — produces Inf/NaN |
| Zero value of complex64 | `0+0i` (both parts are float32 zero) |
| Zero value of complex128 | `0+0i` (both parts are float64 zero) |
| `real(c)` and `imag(c)` | Extract exact float32/float64 parts |

### Not Defined (Compile Error)
| Operation | Error |
|-----------|-------|
| `c1 < c2` | Cannot use ordering operators on complex types |
| `c1 > c2` | Same |
| `complex(float32, float64)` | Mismatched argument types |

---

## 7. Edge Cases from Spec

### Edge Case 1: Untyped Complex Constants
```go
const c = 1 + 2i      // untyped complex constant
const r = real(c)     // untyped float constant: 1
const i = imag(c)     // untyped float constant: 2

var z complex64 = c   // converts untyped complex to complex64
```

### Edge Case 2: complex() with Mismatched Types Requires Conversion
```go
var r float32 = 1.0
var i float64 = 2.0
// complex(r, i)  // COMPILE ERROR: mismatched types float32 and float64
complex(r, float32(i))  // valid: complex64
complex(float64(r), i)  // valid: complex128
```

### Edge Case 3: Imaginary Literal 0123i
Per the spec, `0123i` is `123i` (decimal 123 imaginary), NOT octal 83 imaginary. This is a backward-compatibility exception.
```go
fmt.Println(0123i == 123i)  // true
fmt.Println(0o123i == 83i)  // true (explicit octal)
```

### Edge Case 4: complex128 is Default for Float64 Operations
```go
var f float64 = 3.14
c := complex(f, 0)  // complex128, not complex64
fmt.Printf("%T\n", c)  // complex128
```

### Edge Case 5: Equality Uses Both Components
```go
c1 := complex(1.0, 2.0)
c2 := complex(1.0, 3.0)
c3 := complex(1.0, 2.0)

fmt.Println(c1 == c2)  // false (imaginary parts differ)
fmt.Println(c1 == c3)  // true (both parts equal)
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `complex64` and `complex128` introduced |
| Go 1.0 | `complex()`, `real()`, `imag()` as built-in functions |
| Go 1.0 | Imaginary literal syntax (`1i`, `2.5i`) |
| Go 1.13 | Hex float imaginary literals (`0x1p-2i`) |
| Go 1.13 | Digit separators in imaginary literals |

---

## 9. Implementation-Specific Behavior

### Memory Layout (gc compiler)
| Type | `unsafe.Sizeof` | Layout |
|------|----------------|--------|
| `complex64` | 8 bytes | [float32 real][float32 imag] |
| `complex128` | 16 bytes | [float64 real][float64 imag] |

### Alignment
- `complex64`: 4-byte aligned (same as `float32`)
- `complex128`: 8-byte aligned (same as `float64`)

### math/cmplx Package
The standard library provides complex math functions in `math/cmplx`:
- `cmplx.Abs(c)` — magnitude (modulus)
- `cmplx.Phase(c)` — argument (angle in radians)
- `cmplx.Polar(c)` — converts to polar form
- `cmplx.Sqrt(c)` — complex square root
- `cmplx.Exp(c)` — e^c
- `cmplx.Log(c)` — complex logarithm

---

## 10. Spec Compliance Checklist

- [ ] `complex64` has float32 real and float32 imaginary parts
- [ ] `complex128` has float64 real and float64 imaginary parts
- [ ] Complex types are comparable (`==`, `!=`) but NOT ordered
- [ ] Two complex values equal iff both real parts equal AND both imaginary parts equal
- [ ] `complex(a, b)` returns `complex64` for float32 args, `complex128` for float64 args
- [ ] `real(c)` and `imag(c)` extract the corresponding float components
- [ ] NaN in a component propagates per IEEE 754 rules
- [ ] Zero value is `0+0i`
- [ ] `0123i` == `123i` (decimal, not octal — backward compatibility)
- [ ] Division by zero does NOT panic (produces Inf/NaN per IEEE 754)
- [ ] `complex()` arguments must be the same float type

---

## 11. Official Examples

### Example 1: Creating and Using Complex Numbers

```go
package main

import (
    "fmt"
    "math/cmplx"
)

func main() {
    // Using imaginary literals
    c1 := 3 + 4i
    fmt.Printf("c1: %v, type: %T\n", c1, c1) // (3+4i), complex128

    // Using complex() built-in
    c2 := complex(float64(3), float64(4))
    fmt.Printf("c2: %v, type: %T\n", c2, c2) // (3+4i), complex128

    // complex64
    c3 := complex(float32(1), float32(2))
    fmt.Printf("c3: %v, type: %T\n", c3, c3) // (1+2i), complex64

    // Extracting real and imaginary parts
    r := real(c1)
    i := imag(c1)
    fmt.Printf("real: %v, imag: %v\n", r, i) // real: 3, imag: 4

    // Magnitude (|c|)
    mag := cmplx.Abs(c1)
    fmt.Printf("magnitude of %v = %v\n", c1, mag) // 5
}
```

### Example 2: Complex Arithmetic

```go
package main

import "fmt"

func main() {
    a := 2 + 3i
    b := 1 - 1i

    fmt.Println("a + b =", a+b)   // (3+2i)
    fmt.Println("a - b =", a-b)   // (1+4i)
    fmt.Println("a * b =", a*b)   // (2+3i)*(1-1i) = (2-2i+3i-3i²) = (5+1i)
    fmt.Println("a / b =", a/b)   // (2+3i)/(1-1i) = (2+3i)(1+1i)/2 = (-1/2 + 5/2i)

    // Verify multiplication: (2+3i)(1-1i) = 2-2i+3i-3i² = 2+i+3 = 5+i
    r := real(a * b)
    i := imag(a * b)
    fmt.Printf("real: %v, imag: %v\n", r, i) // real: 5, imag: 1
}
```

### Example 3: Complex Comparison (Comparable, Not Ordered)

```go
package main

import "fmt"

func main() {
    c1 := complex(1.0, 2.0)
    c2 := complex(1.0, 2.0)
    c3 := complex(1.0, 3.0)

    fmt.Println(c1 == c2)  // true (both parts equal)
    fmt.Println(c1 == c3)  // false (imaginary parts differ)
    fmt.Println(c1 != c3)  // true

    // Ordering is NOT defined for complex types
    // fmt.Println(c1 < c2)  // COMPILE ERROR: invalid operation
}
```

### Example 4: NaN Propagation in Complex Numbers

```go
package main

import (
    "fmt"
    "math"
    "math/cmplx"
)

func main() {
    nan := math.NaN()
    c := complex(nan, 1.0)

    // NaN propagates
    fmt.Println(c == c)         // false (NaN != NaN per IEEE 754)
    fmt.Println(math.IsNaN(real(c)))  // true
    fmt.Println(cmplx.IsNaN(c))       // true

    // Complex NaN and infinity
    inf := cmplx.Inf()
    fmt.Println(cmplx.IsInf(inf))     // true

    // Division by zero — no panic
    zero := complex(0, 0)
    result := complex(1.0, 0) / zero
    fmt.Println(result)  // (+Inf+NaNi) or similar
}
```

### Example 5: math/cmplx Functions

```go
package main

import (
    "fmt"
    "math/cmplx"
)

func main() {
    c := 3 + 4i

    // Polar form: r*e^(i*theta)
    r, theta := cmplx.Polar(c)
    fmt.Printf("magnitude: %.4f, angle: %.4f rad\n", r, theta)
    // magnitude: 5.0000, angle: 0.9273 rad

    // Convert back from polar
    back := cmplx.Rect(r, theta)
    fmt.Printf("back: %.4f + %.4fi\n", real(back), imag(back))

    // Euler's formula: e^(i*pi) + 1 = 0
    euler := cmplx.Exp(complex(0, 3.14159265358979323846))
    fmt.Printf("e^(i*pi) = %.6f + %.6fi\n", real(euler), imag(euler))
    // e^(i*pi) = -1.000000 + 0.000000i

    // Square root of -1 = i
    sqrtNeg1 := cmplx.Sqrt(-1)
    fmt.Println("sqrt(-1) =", sqrtNeg1) // (0+1i)
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Numeric types | https://go.dev/ref/spec#Numeric_types | complex64/complex128 declarations |
| Imaginary literals | https://go.dev/ref/spec#Imaginary_literals | Syntax for `1i`, `2.5i` |
| Built-in functions | https://go.dev/ref/spec#Built-in_functions | `complex()`, `real()`, `imag()` |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | Complex comparability rules |
| Arithmetic operators | https://go.dev/ref/spec#Arithmetic_operators | Complex arithmetic |
| Constants | https://go.dev/ref/spec#Constants | Untyped complex constants |
| Conversions | https://go.dev/ref/spec#Conversions | Converting between complex types |
| math/cmplx package | https://pkg.go.dev/math/cmplx | Complex math functions |
| Floating-point types | https://go.dev/ref/spec#Numeric_types | Underlying float types |
| IEEE 754-2008 | https://ieeexplore.ieee.org/document/4610935 | Underlying float standard |
