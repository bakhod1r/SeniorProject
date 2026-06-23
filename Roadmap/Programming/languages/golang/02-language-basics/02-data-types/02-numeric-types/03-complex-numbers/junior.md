# Complex Numbers in Go — Junior Level

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
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security](#security)
15. [Performance Tips](#performance-tips)
16. [Metrics](#metrics)
17. [Best Practices](#best-practices)
18. [Edge Cases](#edge-cases)
19. [Common Mistakes](#common-mistakes)
20. [Common Misconceptions](#common-misconceptions)
21. [Tricky Points](#tricky-points)
22. [Test (Quiz)](#test-quiz)
23. [Tricky Questions](#tricky-questions)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment](#self-assessment)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction

Complex numbers are numbers that have two parts: a **real** part and an **imaginary** part. They are written as `a + bi`, where:
- `a` is the real part (a regular number)
- `b` is the imaginary part
- `i` is the imaginary unit where `i² = -1`

Go has built-in support for complex numbers with two types: `complex64` and `complex128`. You don't need a library — complex numbers are part of the language itself.

Why do they matter? Complex numbers are used in:
- Signal processing and audio analysis
- 2D rotations in graphics
- Electrical engineering (AC circuits)
- Fractal generation (Mandelbrot set)
- Physics simulations (wave equations)

---

## Prerequisites

- Basic Go syntax (variables, types, loops)
- Understanding of `float32` and `float64`
- Basic math (multiplication, addition)
- No prior knowledge of complex numbers required

---

## Glossary

| Term | Definition |
|------|------------|
| **Complex number** | A number with both real and imaginary parts: `a + bi` |
| **Real part** | The `a` in `a + bi` — a regular real number |
| **Imaginary part** | The `b` in `a + bi` — multiplied by `i` |
| **Imaginary unit (`i`)** | The number where `i² = -1` (written as `1i` in Go) |
| **`complex64`** | Complex number using `float32` for both parts (8 bytes total) |
| **`complex128`** | Complex number using `float64` for both parts (16 bytes total) |
| **Magnitude (modulus)** | The "length" or "size" of a complex number: `√(a² + b²)` |
| **Phase (argument)** | The angle of a complex number in the complex plane |
| **Conjugate** | `a + bi` → `a - bi` (flip the sign of imaginary part) |
| **`cmplx` package** | Go's standard library for complex number math |

---

## Core Concepts

### Two Complex Types

```go
var c64  complex64  = 3 + 4i   // float32 real + float32 imaginary = 8 bytes
var c128 complex128 = 3 + 4i   // float64 real + float64 imaginary = 16 bytes
```

The **default** complex type is `complex128` (just like `float64` is the default float).

### Zero Value

```go
var c complex128
fmt.Println(c) // (0+0i)
```

### Creating Complex Numbers

```go
// Method 1: using built-in complex() function
c1 := complex(3.0, 4.0)   // 3 + 4i

// Method 2: literal syntax
c2 := 3 + 4i              // same as above, inferred as complex128

// Method 3: with explicit type
var c3 complex128 = 2 - 3i

// Method 4: pure imaginary
c4 := 5i   // (0+5i), type complex128

// Method 5: from float variables
realPart := 3.0
imagPart := 4.0
c5 := complex(realPart, imagPart) // (3+4i)
```

### Extracting Parts

```go
c := complex(3.0, 4.0)

r := real(c)   // 3.0 — returns float64
i := imag(c)   // 4.0 — returns float64

fmt.Printf("Real: %f, Imaginary: %f\n", r, i)
// Real: 3.000000, Imaginary: 4.000000
```

### Arithmetic

All basic arithmetic operators work on complex numbers:

```go
a := complex(1.0, 2.0)  // 1 + 2i
b := complex(3.0, 1.0)  // 3 + 1i

fmt.Println(a + b)  // (4+3i)   — add real and imaginary parts separately
fmt.Println(a - b)  // (-2+1i)  — subtract separately
fmt.Println(a * b)  // (1+7i)   — (1+2i)(3+1i) = 3+1i+6i+2i² = 3+7i-2 = 1+7i
fmt.Println(a / b)  // complex division (Go handles this automatically)
```

---

## Real-World Analogies

### The 2D Map Analogy
A complex number `a + bi` is like a GPS coordinate where `a` is East-West position and `b` is North-South position. Adding two complex numbers is like adding two direction vectors — the end result is where you'd end up if you followed both directions.

### The Rotation Analogy
Multiplying a complex number by `i` rotates it 90° counterclockwise. Multiplying by `-1` rotates it 180°. This makes complex numbers perfect for 2D rotations without using `sin` and `cos`.

### The Audio Signal Analogy
A sound wave has both amplitude (how loud) and phase (timing). A complex number captures both at once: the real part is one measurement, the imaginary part is another. This is why Fourier transforms — which analyze sounds — use complex numbers.

---

## Mental Models

### Model 1: Complex Number as 2D Arrow
Think of `a + bi` as an arrow starting at origin `(0,0)` and pointing to `(a, b)`:
- The real part `a` is the horizontal (x) component
- The imaginary part `b` is the vertical (y) component
- The length of the arrow = `√(a² + b²)` = magnitude

### Model 2: Multiplication as Rotation
When you multiply two complex numbers, the lengths multiply and the angles add:
```
|a × b| = |a| × |b|
∠(a × b) = ∠a + ∠b
```
Multiplying by `i` (which has length 1 and angle 90°) just rotates 90°.

---

## Pros & Cons

### Pros
- Built into Go — no external imports for basic operations
- Clean literal syntax: `3 + 4i` is readable
- All standard operators work: `+`, `-`, `*`, `/`
- `cmplx` package provides comprehensive math functions
- Eliminates the need for two separate float variables for 2D math
- Natural for wave, rotation, and frequency domain calculations

### Cons
- Rarely needed in everyday business/web programming
- Uses more memory than two separate floats when only one part is needed
- Less familiar to developers without math/engineering background
- Can make code harder to understand for team members unfamiliar with the math

---

## Use Cases

| Use Case | Why Complex? |
|----------|-------------|
| Mandelbrot / Julia fractals | `z = z² + c` is a natural complex iteration |
| FFT (audio frequency analysis) | Fourier transform fundamentally uses complex math |
| 2D rotation without sin/cos | Multiply by `e^(iθ)` to rotate a point |
| AC circuit analysis | Impedance, voltage are naturally complex |
| Wave simulation | Wave equations use complex exponentials |
| Quantum mechanics | Wave functions are complex-valued |
| Image processing (filters) | Frequency domain operations |

---

## Code Examples

### Example 1: Basic Complex Arithmetic

```go
package main

import "fmt"

func main() {
    a := complex(2.0, 3.0)  // 2 + 3i
    b := complex(1.0, -1.0) // 1 - i

    fmt.Println("a =", a)       // (2+3i)
    fmt.Println("b =", b)       // (1-1i)
    fmt.Println("a+b =", a+b)   // (3+2i)
    fmt.Println("a-b =", a-b)   // (1+4i)
    fmt.Println("a*b =", a*b)   // (2+3i)(1-i) = 2-2i+3i-3i² = (5+1i)
    fmt.Println("a/b =", a/b)   // Go computes complex division automatically

    // Extract parts
    fmt.Printf("real(a) = %.1f\n", real(a))  // 2.0
    fmt.Printf("imag(a) = %.1f\n", imag(a))  // 3.0
}
```

### Example 2: Using the cmplx Package

```go
package main

import (
    "fmt"
    "math/cmplx"
)

func main() {
    c := complex(3.0, 4.0)  // 3 + 4i

    // Magnitude (distance from origin)
    fmt.Println(cmplx.Abs(c))   // 5.0 = sqrt(3²+4²) = sqrt(25)

    // Phase (angle in radians, range [-π, π])
    fmt.Println(cmplx.Phase(c)) // 0.9272952... radians (~53°)

    // Conjugate: flip sign of imaginary part
    fmt.Println(cmplx.Conj(c))  // (3-4i)

    // Square root of negative number: sqrt(-1) = i
    fmt.Println(cmplx.Sqrt(complex(-1, 0))) // (0+1i)

    // Euler's formula: e^(iπ) = -1
    pi := 3.14159265358979
    fmt.Println(cmplx.Exp(complex(0, pi))) // approximately (-1+0i)
}
```

### Example 3: 2D Rotation Using Complex Multiplication

```go
package main

import (
    "fmt"
    "math"
    "math/cmplx"
)

// Rotate a 2D point (x, y) by angleDeg degrees around the origin
func rotate2D(x, y, angleDeg float64) (float64, float64) {
    point := complex(x, y)
    angleRad := angleDeg * math.Pi / 180.0
    // e^(iθ) = cos(θ) + i*sin(θ) — the rotation factor
    rotation := cmplx.Exp(complex(0, angleRad))
    result := point * rotation
    return real(result), imag(result)
}

func main() {
    // Rotate (1, 0) by 90° → should give (0, 1)
    x, y := rotate2D(1.0, 0.0, 90.0)
    fmt.Printf("(1,0) rotated 90°: (%.4f, %.4f)\n", x, y)
    // Output: (0.0000, 1.0000)

    // Rotate (1, 0) by 45° → (√2/2, √2/2) ≈ (0.7071, 0.7071)
    x, y = rotate2D(1.0, 0.0, 45.0)
    fmt.Printf("(1,0) rotated 45°: (%.4f, %.4f)\n", x, y)
    // Output: (0.7071, 0.7071)

    // Rotate (3, 4) by 180°: should give (-3, -4)
    x, y = rotate2D(3.0, 4.0, 180.0)
    fmt.Printf("(3,4) rotated 180°: (%.4f, %.4f)\n", x, y)
    // Output: (-3.0000, -4.0000)
}
```

### Example 4: Simple Mandelbrot Check

```go
package main

import (
    "fmt"
    "math/cmplx"
)

// Returns iterations before |z| > 2, or maxIter if it never escapes
func mandelbrot(c complex128, maxIter int) int {
    z := complex(0.0, 0.0)
    for i := 0; i < maxIter; i++ {
        if cmplx.Abs(z) > 2.0 {
            return i
        }
        z = z*z + c // the Mandelbrot iteration
    }
    return maxIter
}

func main() {
    // Point inside Mandelbrot set (doesn't escape)
    inside := complex(0.0, 0.0)
    fmt.Println("Origin (inside):", mandelbrot(inside, 100))  // 100

    // Point outside Mandelbrot set (escapes quickly)
    outside := complex(2.0, 2.0)
    fmt.Println("(2+2i) (outside):", mandelbrot(outside, 100)) // 2

    // Border region (escapes after several iterations)
    border := complex(-0.7, 0.27)
    fmt.Println("Border region:", mandelbrot(border, 100)) // somewhere < 100
}
```

---

## Coding Patterns

### Pattern 1: Convert Between Cartesian and Polar

```go
import "math/cmplx"
import "math"

// Cartesian (x, y) → Complex
func fromCartesian(x, y float64) complex128 {
    return complex(x, y)
}

// Polar (magnitude, angle in radians) → Complex
func fromPolar(r, theta float64) complex128 {
    return cmplx.Rect(r, theta)
}

// Complex → Polar
func toPolar(c complex128) (r, theta float64) {
    return cmplx.Polar(c)
}
```

### Pattern 2: Average of Complex Numbers

```go
func averageComplex(vals []complex128) complex128 {
    if len(vals) == 0 {
        return 0
    }
    sum := complex(0, 0)
    for _, v := range vals {
        sum += v
    }
    return sum / complex(float64(len(vals)), 0)
}
```

### Pattern 3: Check if Approximately Real

```go
import "math"

func isApproximatelyReal(c complex128) bool {
    return math.Abs(imag(c)) < 1e-9
}
```

---

## Clean Code

```go
// Good: descriptive variable names that explain what the complex number represents
voltageAC := complex(120.0, 45.0)  // 120V magnitude, 45° phase shift (AC circuit)
playerPos := complex(100.0, 200.0) // x=100, y=200 screen position

// Good: extract parts with meaningful names
magnitude := cmplx.Abs(voltageAC)
phaseAngle := cmplx.Phase(voltageAC)

// Good: use constants for well-known rotation values
i := complex(0, 1) // imaginary unit — rotating 90°
negOne := complex(-1, 0)

// Avoid: cryptic complex literals without context
transform := 0.7071 + 0.7071i // What does this mean?

// Better:
const sqrt2over2 = 0.7071067811865476
rotate45 := complex(sqrt2over2, sqrt2over2) // 45° rotation factor
```

---

## Product Use / Feature

### Feature: 2D Game Entity Transform

```go
package game

import (
    "math"
    "math/cmplx"
)

// Entity represents a game object with position and facing direction
type Entity struct {
    Position complex128 // x + iy represents screen position
    Facing   float64    // angle in radians
}

// MoveForward moves the entity forward by `distance` in its facing direction
func (e *Entity) MoveForward(distance float64) {
    direction := cmplx.Exp(complex(0, e.Facing))
    e.Position += complex(distance, 0) * direction
}

// TurnLeft rotates the entity by degrees to the left
func (e *Entity) TurnLeft(degrees float64) {
    e.Facing += degrees * math.Pi / 180.0
}

func (e *Entity) X() float64 { return real(e.Position) }
func (e *Entity) Y() float64 { return imag(e.Position) }
```

---

## Error Handling

Complex number operations rarely return errors in Go — they return NaN or Inf for invalid inputs (same as float operations). Always validate inputs:

```go
package main

import (
    "fmt"
    "math"
    "math/cmplx"
)

// ValidateComplex checks if both parts are finite
func ValidateComplex(c complex128) error {
    r, i := real(c), imag(c)
    if math.IsNaN(r) || math.IsNaN(i) {
        return fmt.Errorf("complex number contains NaN: %v", c)
    }
    if math.IsInf(r, 0) || math.IsInf(i, 0) {
        return fmt.Errorf("complex number contains Inf: %v", c)
    }
    return nil
}

// SafeLog computes complex logarithm with validation
func SafeLog(c complex128) (complex128, error) {
    if c == 0 {
        return 0, fmt.Errorf("log(0) is undefined")
    }
    result := cmplx.Log(c)
    if err := ValidateComplex(result); err != nil {
        return 0, fmt.Errorf("log(%v) produced invalid result: %w", c, err)
    }
    return result, nil
}
```

---

## Security

- Complex number inputs from external sources (HTTP, files) should validate both real and imaginary parts
- Both parts can be NaN or Inf — check them separately
- Division by zero in complex arithmetic gives Inf, not panic — be aware this may propagate silently

```go
// Validate both parts independently
func parseComplexInput(realStr, imagStr string) (complex128, error) {
    r, err := strconv.ParseFloat(realStr, 64)
    if err != nil {
        return 0, fmt.Errorf("invalid real part %q: %w", realStr, err)
    }
    im, err := strconv.ParseFloat(imagStr, 64)
    if err != nil {
        return 0, fmt.Errorf("invalid imaginary part %q: %w", imagStr, err)
    }
    if math.IsNaN(r) || math.IsInf(r, 0) || math.IsNaN(im) || math.IsInf(im, 0) {
        return 0, fmt.Errorf("special float values not allowed")
    }
    return complex(r, im), nil
}
```

---

## Performance Tips

1. **Use `complex128`** as the default — same reasoning as float64.
2. **Precompute rotation factors** outside loops:

```go
// Good: compute rotation once
rotation := cmplx.Exp(complex(0, angleRad))
for i := range points {
    points[i] *= rotation
}

// Bad: recompute every iteration
for i := range points {
    points[i] *= cmplx.Exp(complex(0, angleRad)) // wasteful
}
```

3. **Use `cmplx.Abs` for magnitude** — more accurate than manual `math.Sqrt(real(c)*real(c)+imag(c)*imag(c))`.
4. **Use `complex64` only** when processing large arrays and memory is constrained.

---

## Metrics

| Type | Size | Real Part | Imaginary Part | Precision |
|------|------|-----------|----------------|-----------|
| `complex64` | 8 bytes | float32 | float32 | ~7 decimal digits |
| `complex128` | 16 bytes | float64 | float64 | ~15 decimal digits |

---

## Best Practices

1. **Default to `complex128`** — like float64, it's the safe choice.
2. **Use `cmplx.Abs` for magnitude** — not manual calculation.
3. **Use `cmplx.Phase` for angle** — returns value in `[-π, π]`.
4. **Use `cmplx.Rect(r, θ)` for polar coordinates** — cleaner than manual conversion.
5. **Document what real and imaginary parts represent** — it's not always obvious.
6. **Never use complex numbers for simple 2D coordinates** where you just need two floats — use a struct.

---

## Edge Cases

```go
import (
    "math"
    "math/cmplx"
)

// 1. sqrt(-1) = i (NOT an error!)
fmt.Println(cmplx.Sqrt(-1))     // (0+1i)
fmt.Println(cmplx.Sqrt(-4))     // (0+2i)

// 2. Division by zero → Inf, not panic
zero := complex(0, 0)
fmt.Println(complex(1, 0) / zero) // (+Inf+NaNi)

// 3. NaN propagation
nanC := complex(math.NaN(), 0)
fmt.Println(nanC * complex(2, 3)) // (NaN+NaN) — NaN propagates

// 4. Negative zero matters
negZeroC := complex(-0.0, 0.0)
posZeroC := complex(0.0, 0.0)
fmt.Println(negZeroC == posZeroC) // true (same as float)

// 5. Phase of zero is 0 (mathematically undefined but Go returns 0)
fmt.Println(cmplx.Phase(complex(0, 0))) // 0

// 6. large magnitude
big := complex(1e200, 1e200)
fmt.Println(cmplx.Abs(big)) // 1.414...e+200 (not overflow)
```

---

## Common Mistakes

### Mistake 1: Using `math.Abs` on a Complex Number

```go
c := complex(3.0, 4.0)

// WRONG: compile error — math.Abs takes float64, not complex128
// fmt.Println(math.Abs(c))

// RIGHT: use cmplx.Abs
fmt.Println(cmplx.Abs(c))  // 5.0
```

### Mistake 2: Expecting `4i` to Be an Integer

```go
x := 4i
fmt.Printf("type: %T, value: %v\n", x, x)
// type: complex128, value: (0+4i)
// 4i is NOT int — it's a complex128 with zero real part!
```

### Mistake 3: Comparing Complex Numbers with NaN Parts

```go
c := complex(math.NaN(), 1.0)
fmt.Println(c == c)  // false — NaN comparison failure
// Always check parts separately:
isValid := !math.IsNaN(real(c)) && !math.IsNaN(imag(c))
```

### Mistake 4: Wrong Import

```go
// WRONG: math.Sqrt works on float64, not complex128
import "math"
c := complex(-1.0, 0.0)
// math.Sqrt(-1.0) → NaN (returns float64, doesn't understand complex)

// RIGHT: use cmplx.Sqrt
import "math/cmplx"
fmt.Println(cmplx.Sqrt(c))  // (0+1i)
```

---

## Common Misconceptions

1. **"complex64 uses int64"** — FALSE. `complex64` uses `float32` for both parts (total 8 bytes).
2. **"`5i` is an integer"** — FALSE. In Go, `5i` creates a `complex128` value `(0+5i)`.
3. **"Complex numbers are only for advanced math PhDs"** — FALSE. They simplify 2D rotations greatly.
4. **"I need an external library for complex math"** — FALSE. `math/cmplx` has everything.
5. **"complex multiplication is just multiplying corresponding parts"** — FALSE. It follows the formula `(a+bi)(c+di) = (ac-bd) + (ad+bc)i`.

---

## Tricky Points

```go
// Tricky 1: The literal 4i creates complex128, not a float or int
x := 4i          // type: complex128, value: (0+4i)
y := 3.0 + 4i    // type: complex128, value: (3+4i)

// Tricky 2: real() and imag() return float types matching the complex type
var c64 complex64 = 1 + 2i
r32 := real(c64)   // float32! (not float64)

var c128 complex128 = 1 + 2i
r64 := real(c128)  // float64

// Tricky 3: You CANNOT directly add float64 and complex128 (different types)
// f := 3.0
// c := 2 + 1i
// sum := f + c    // COMPILE ERROR: mismatched types float64 and complex128

// Correct: convert explicitly
sum := complex(3.0, 0) + complex(2, 1)  // (5+1i)

// Tricky 4: Go doesn't have a polar literal syntax
// Use cmplx.Rect(magnitude, angle) for polar form
polar := cmplx.Rect(5.0, 0.9272952)  // creates 3+4i approximately
```

---

## Test (Quiz)

1. What is the zero value of `complex128`?
   - a) `0`
   - b) **`(0+0i)`** ✓
   - c) `nil`
   - d) `NaN+NaNi`

2. What type does `real(c complex128)` return?
   - a) complex128
   - b) float32
   - c) **float64** ✓
   - d) int64

3. What is the magnitude of `complex(3.0, 4.0)`?
   - a) 3
   - b) 4
   - c) **5.0** ✓ (sqrt(9+16) = 5)
   - d) 7

4. What does `cmplx.Sqrt(complex(-4, 0))` return?
   - a) compile error
   - b) NaN
   - c) **`(0+2i)`** ✓ (sqrt(-4) = 2i)
   - d) `-2`

5. How many bytes does `complex128` use?
   - a) 8
   - b) **16** ✓
   - c) 32
   - d) 4

6. What is `(1+2i) * (1+2i)` equal to?
   - a) `(1+4i)`
   - b) **`(-3+4i)`** ✓ (1+2i+2i+4i² = 1+4i-4 = -3+4i)
   - c) `(2+4i)`
   - d) `(1+4i²)`

---

## Tricky Questions

**Q: What is the difference between `complex64` and `complex128`?**
A: `complex64` stores both real and imaginary parts as `float32` (4 bytes each, total 8 bytes). `complex128` stores both as `float64` (8 bytes each, total 16 bytes). The default is `complex128` for better precision.

**Q: Can you use `==` to compare complex numbers?**
A: Yes, but only when neither contains NaN. Two complex numbers are equal when both real AND imaginary parts are equal. Since complex numbers contain floats, if either part is NaN, the comparison fails: `(NaN+1i) == (NaN+1i)` is `false`.

**Q: What is the Go syntax for writing the imaginary unit i?**
A: In Go, the imaginary unit is written as `1i`. So `3 + 4i` is the complex number 3+4i. The `i` suffix after a numeric literal creates an imaginary number. `5i` means `0 + 5i` (type complex128).

---

## Cheat Sheet

```go
// Creating complex numbers
c := complex(3.0, 4.0)   // (3+4i) using built-in
c := 3 + 4i              // literal syntax
c := 5i                  // (0+5i)
var c complex128 = 2 - 3i

// Extracting parts
real(c)   // real part as float64 (or float32 for complex64)
imag(c)   // imaginary part as float64

// Types
complex64:  8 bytes  (float32 + float32)
complex128: 16 bytes (float64 + float64)  ← default

// cmplx package (import "math/cmplx")
cmplx.Abs(c)          // magnitude: sqrt(r²+i²)
cmplx.Phase(c)        // angle in radians: [-π, π]
cmplx.Conj(c)         // conjugate: a+bi → a-bi
cmplx.Sqrt(c)         // complex square root (works for negative reals!)
cmplx.Exp(c)          // e^c
cmplx.Log(c)          // natural log
cmplx.Pow(base, exp)  // base^exp
cmplx.Rect(r, θ)      // polar → complex: r×e^(iθ)
cmplx.Polar(c)        // complex → (r, θ)

// Arithmetic operators
a + b   // add
a - b   // subtract
a * b   // multiply (NOT elementwise)
a / b   // divide
```

---

## Self-Assessment

- [ ] I can create complex numbers using `complex()` and literal syntax
- [ ] I know how to extract `real()` and `imag()` parts
- [ ] I can perform arithmetic: `+`, `-`, `*`, `/` on complex numbers
- [ ] I know `cmplx.Abs` computes magnitude (not `math.Abs`)
- [ ] I understand that `complex64` uses float32, `complex128` uses float64
- [ ] I can use complex multiplication for 2D rotation
- [ ] I can write the Mandelbrot iteration `z = z*z + c`
- [ ] I understand that `cmplx.Sqrt(-1)` gives `(0+1i)`, not an error

---

## Summary

- Go has built-in `complex64` and `complex128` types
- Create with `complex(r, i)` or literal `3 + 4i`
- Extract parts with `real(c)` (returns float64) and `imag(c)` (returns float64)
- All arithmetic: `+`, `-`, `*`, `/` work natively
- Use `math/cmplx` for advanced functions: `Abs`, `Phase`, `Sqrt`, `Exp`, `Rect`
- Default to `complex128` (uses float64 for both parts)
- Key uses: 2D rotations, signal processing, fractals, physics simulations

---

## What You Can Build

After mastering complex numbers, you can build:
- ASCII Mandelbrot set visualizer
- 2D game entity movement/rotation engine
- Simple oscilloscope display for sine waves
- Phasor diagram for AC circuit analysis
- A toy Fourier series visualizer
- Complex number calculator CLI

---

## Further Reading

- [Go spec: Complex types](https://go.dev/ref/spec#Numeric_types)
- [math/cmplx package docs](https://pkg.go.dev/math/cmplx)
- [Wikipedia: Complex number](https://en.wikipedia.org/wiki/Complex_number)
- [3Blue1Brown: e^(iπ) in 3.14 minutes](https://www.youtube.com/watch?v=v0YEaeIClKY)
- [Khan Academy: Complex numbers](https://www.khanacademy.org/math/algebra2/x2ec2f6f830c9fb89:complex)

---

## Related Topics

- `float64` — the base type inside complex128
- `math/cmplx` package — all complex math functions
- Fourier Transform — uses complex numbers for frequency analysis
- 2D graphics / game engines — rotation uses complex math
- Signal processing — audio analysis in frequency domain

---

## Diagrams & Visual Aids

### The Complex Plane (Argand Diagram)
```
Imaginary axis (Im)
        ^
  4i ---+-------* (3+4i)
  3i    |      /|
  2i    |     / | imag = 4
  1i    |    /  |
  ------+---+---+-------> Real axis (Re)
        0   1   3
              real = 3

magnitude = sqrt(3² + 4²) = sqrt(25) = 5
phase = arctan(4/3) ≈ 53.13° ≈ 0.927 radians
```

### Multiplication as Rotation + Scaling
```
Original point:  (1+0i)  ← length 1, angle 0°
After × i:       (0+1i)  ← length 1, angle 90°   (rotated CCW)
After × i²:      (-1+0i) ← length 1, angle 180°
After × i³:      (0-1i)  ← length 1, angle 270°
After × i⁴:      (1+0i)  ← back to start!

Multiplying by i = rotating 90° counterclockwise
```

### Memory Layout
```
complex64:  [  float32 real (4B)  ][  float32 imag (4B)  ]  = 8 bytes
complex128: [    float64 real (8B)    ][    float64 imag (8B)    ]  = 16 bytes
```

### Mandelbrot Iteration Visualization
```
z₀ = 0 + 0i
z₁ = z₀² + c = c
z₂ = z₁² + c = c² + c
z₃ = z₂² + c = (c²+c)² + c
...

If |zₙ| ever exceeds 2 → point c is OUTSIDE the Mandelbrot set
If |zₙ| stays ≤ 2 forever → point c is INSIDE the Mandelbrot set
```
