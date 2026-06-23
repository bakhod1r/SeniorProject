# Floating Points in Go — Junior Level

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

Floating-point numbers are how computers represent decimal (fractional) numbers. In Go, you have two types: `float32` and `float64`. These types let you work with numbers like `3.14`, `-0.001`, or `1.5e10`.

Go follows the **IEEE 754** standard for floating-point arithmetic, which is the same standard used by almost every modern programming language and CPU.

Understanding floats is essential because:
- You need them for any math involving decimals
- They have surprising behavior (0.1 + 0.2 ≠ 0.3)
- Choosing the wrong type can cause precision bugs

---

## Prerequisites

Before learning about floats, you should know:
- What variables and types are in Go
- Basic Go syntax (`var`, `:=`, `fmt.Println`)
- What integers are
- How to import packages

---

## Glossary

| Term | Definition |
|------|------------|
| `float32` | 32-bit floating-point number (~7 significant decimal digits) |
| `float64` | 64-bit floating-point number (~15 significant decimal digits) |
| **IEEE 754** | International standard for floating-point arithmetic |
| **Precision** | How many significant digits a number can accurately represent |
| **Epsilon** | A very small number used to compare floats for near-equality |
| **NaN** | "Not a Number" — result of invalid math like `0.0/0.0` |
| **Infinity** | Result of dividing a non-zero number by zero |
| **Mantissa** | The significant digits part of a floating-point number |
| **Exponent** | The power-of-two part of a floating-point number |
| **Literal** | A value written directly in source code, like `3.14` |

---

## Core Concepts

### Two Float Types

```go
var a float32 = 3.14    // 32-bit: ~7 decimal digits of precision
var b float64 = 3.14159265358979  // 64-bit: ~15 decimal digits
```

**Go's default float type is `float64`.** When you write `x := 3.14`, Go infers `float64`.

### Zero Value

```go
var f float64  // zero value is 0.0
fmt.Println(f) // Output: 0
```

### Float Literals

```go
a := 3.14       // regular decimal
b := 1.5e10     // scientific notation: 1.5 × 10^10
c := 2.5E-3     // scientific notation: 2.5 × 10^-3 = 0.0025
d := .5         // same as 0.5
e := 100.       // same as 100.0
```

### The Precision Problem

This is the most important thing to understand about floats:

```go
fmt.Println(0.1 + 0.2)         // 0.30000000000000004
fmt.Println(0.1 + 0.2 == 0.3)  // false!
```

Why? Because 0.1, 0.2, and 0.3 cannot be represented exactly in binary. The computer stores an approximation.

---

## Real-World Analogies

### The Ruler Analogy
Imagine measuring a table with a ruler that only has centimeter marks. You can see the table is between 73 and 74 cm, but you can't tell exactly. You approximate it as "73.5 cm". That approximation is like floating-point: you get close but not exact.

### The Scientific Notation Analogy
Scientists write `6.022 × 10²³` (Avogadro's number) instead of `602200000000000000000000`. Floats work similarly — they store significant digits and an exponent.

### The Pigeonhole Analogy
`float64` can only hold 2^64 different values, but there are infinitely many real numbers. So most real numbers are "rounded" to the nearest representable float.

---

## Mental Models

### Model 1: Floats are Approximations
Never think of a float as an exact number. Think of it as "the closest representable value to what you wanted."

### Model 2: The Sliding Scale
`float32` → less memory, less precision, good enough for graphics
`float64` → more memory, more precision, good for calculations

### Model 3: Equality Danger Zone
Never use `==` to compare floats unless you know exactly what you're doing. Always compare "close enough":

```go
func almostEqual(a, b float64) bool {
    const epsilon = 1e-9
    return math.Abs(a-b) < epsilon
}
```

---

## Pros & Cons

### Pros
- Can represent a huge range of numbers (from very tiny to very large)
- Hardware-accelerated (CPUs have dedicated float units)
- Standard across all platforms (IEEE 754)
- Easy to use: `+`, `-`, `*`, `/` all work naturally
- Compact representation compared to arbitrary-precision math

### Cons
- Not exact: rounding errors accumulate
- Cannot represent most decimal fractions exactly
- Comparison with `==` is unreliable
- NaN and Inf require special handling
- Wrong choice for financial calculations

---

## Use Cases

| Use Case | Type | Notes |
|----------|------|-------|
| Scientific calculations | `float64` | Need precision |
| Game physics | `float32` | Speed matters more |
| GPS coordinates | `float64` | Need many decimal places |
| Temperature readings | `float64` | Standard choice |
| 3D graphics (GPU) | `float32` | GPUs prefer float32 |
| Machine learning weights | `float32` | Memory efficiency |
| Financial amounts | ❌ Neither | Use integer cents or `decimal` package |

---

## Code Examples

### Example 1: Basic Float Operations

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    // Declaration and assignment
    var pi float64 = 3.14159265358979

    // Basic arithmetic
    radius := 5.0
    area := pi * radius * radius
    fmt.Printf("Area of circle: %.2f\n", area) // Output: Area of circle: 78.54

    // math package functions
    fmt.Println(math.Sqrt(16.0))  // 4
    fmt.Println(math.Pow(2, 10))  // 1024
    fmt.Println(math.Abs(-3.7))   // 3.7
}
```

### Example 2: Rounding Functions

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    x := 3.7

    fmt.Println(math.Floor(x))  // 3  — round down
    fmt.Println(math.Ceil(x))   // 4  — round up
    fmt.Println(math.Round(x))  // 4  — round to nearest
    fmt.Println(math.Trunc(x))  // 3  — truncate (remove decimal)

    y := -3.7
    fmt.Println(math.Floor(y))  // -4
    fmt.Println(math.Ceil(y))   // -3
    fmt.Println(math.Round(y))  // -4
    fmt.Println(math.Trunc(y))  // -3
}
```

### Example 3: Special Values

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    // Positive and negative infinity
    posInf := math.Inf(1)   // +Inf
    negInf := math.Inf(-1)  // -Inf
    fmt.Println(posInf)         // +Inf
    fmt.Println(negInf)         // -Inf
    fmt.Println(posInf + 1)     // +Inf
    fmt.Println(math.IsInf(posInf, 1))  // true

    // NaN — Not a Number
    nan := math.NaN()
    fmt.Println(nan)          // NaN
    fmt.Println(nan == nan)   // false! NaN is never equal to itself
    fmt.Println(math.IsNaN(nan))  // true — always use this to check

    // How infinity arises
    fmt.Println(1.0 / 0.0)   // compile error — Go catches this
    // Use variables:
    zero := 0.0
    fmt.Println(1.0 / zero)  // +Inf
}
```

### Example 4: String Conversion

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    // Float to string
    f := 3.14159
    s := strconv.FormatFloat(f, 'f', 2, 64)
    fmt.Println(s)  // "3.14"

    // Format options:
    // 'f' = decimal notation
    // 'e' = scientific notation
    // 'g' = shortest representation
    s2 := strconv.FormatFloat(f, 'e', 3, 64)
    fmt.Println(s2)  // "3.142e+00"

    // String to float
    val, err := strconv.ParseFloat("3.14", 64)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println(val)  // 3.14
}
```

---

## Coding Patterns

### Pattern 1: Safe Float Comparison

```go
import "math"

const epsilon = 1e-9

func almostEqual(a, b float64) bool {
    return math.Abs(a-b) < epsilon
}

// Usage
if almostEqual(0.1+0.2, 0.3) {
    fmt.Println("They are equal")
}
```

### Pattern 2: Formatted Output

```go
price := 19.9999
fmt.Printf("%.2f\n", price)  // "20.00" — 2 decimal places
fmt.Printf("%10.2f\n", price) // "     20.00" — right-aligned, width 10
fmt.Printf("%-10.2f\n", price) // "20.00     " — left-aligned
```

### Pattern 3: Clamping a Float

```go
func clamp(val, min, max float64) float64 {
    if val < min {
        return min
    }
    if val > max {
        return max
    }
    return val
}

// Usage: keep a value between 0.0 and 1.0
opacity := clamp(userInput, 0.0, 1.0)
```

### Pattern 4: Convert Integer to Float for Division

```go
a, b := 5, 2
// Integer division: result is 2 (truncated)
fmt.Println(a / b)  // 2

// Float division: result is 2.5
fmt.Println(float64(a) / float64(b))  // 2.5
```

---

## Clean Code

### Do This

```go
// Clear variable names
const gravitationalAcceleration = 9.81 // m/s²
temperature := 36.6                    // °C

// Use type inference for float64 (default)
speed := 60.0  // Go infers float64

// Named constants for special values
const maxPrecision = 1e-10
```

### Avoid This

```go
// Unclear names
x := 9.81
y := 36.6

// Magic numbers
if diff < 0.000000001 { // What is this number?

// Wrong comparison
if a == b { // Unreliable for floats
```

---

## Product Use / Feature

### Real-World Feature: Price Display

```go
package main

import "fmt"

type Product struct {
    Name  string
    Price float64 // stored in dollars (ideally use cents in production)
}

func (p Product) DisplayPrice() string {
    return fmt.Sprintf("$%.2f", p.Price)
}

func main() {
    product := Product{Name: "Coffee", Price: 4.99}
    fmt.Println(product.DisplayPrice()) // $4.99
}
```

### Real-World Feature: Temperature Converter

```go
func celsiusToFahrenheit(c float64) float64 {
    return c*9.0/5.0 + 32.0
}

func fahrenheitToCelsius(f float64) float64 {
    return (f - 32.0) * 5.0 / 9.0
}
```

---

## Error Handling

### Parsing Errors

```go
package main

import (
    "fmt"
    "strconv"
)

func parseTemperature(s string) (float64, error) {
    temp, err := strconv.ParseFloat(s, 64)
    if err != nil {
        return 0, fmt.Errorf("invalid temperature %q: %w", s, err)
    }
    return temp, nil
}

func main() {
    temp, err := parseTemperature("36.6")
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Printf("Temperature: %.1f°C\n", temp)

    _, err = parseTemperature("not-a-number")
    if err != nil {
        fmt.Println("Error:", err)
        // Error: invalid temperature "not-a-number": strconv.ParseFloat: ...
    }
}
```

### NaN Propagation

```go
import "math"

func safeDivide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, fmt.Errorf("division by zero")
    }
    return a / b, nil
}

// Always check inputs before math operations
func safeLog(x float64) (float64, error) {
    if x <= 0 {
        return 0, fmt.Errorf("log undefined for x <= 0, got %f", x)
    }
    return math.Log(x), nil
}
```

---

## Security

- **Never use floats for financial calculations** — floating-point rounding errors can cause accounting discrepancies, which in financial systems can mean losing money or legal issues.
- **Validate float inputs from users** — always parse with `strconv.ParseFloat` and check errors.
- **Watch for NaN injection** — if an attacker can cause your program to produce NaN, subsequent comparisons become unpredictable.

```go
// Safe: always validate before using
func processUserFloat(input string) error {
    val, err := strconv.ParseFloat(input, 64)
    if err != nil {
        return fmt.Errorf("invalid input")
    }
    if math.IsNaN(val) || math.IsInf(val, 0) {
        return fmt.Errorf("special float values not allowed")
    }
    // use val...
    return nil
}
```

---

## Performance Tips

1. **Prefer `float64` over `float32`** on 64-bit systems — modern CPUs are optimized for 64-bit floats and `float64` is often the same speed or faster.
2. **Avoid unnecessary type conversions** between `float32` and `float64` in hot loops.
3. **Batch math operations** — use `math` package functions which are highly optimized.
4. **Avoid string-to-float conversion in loops** — parse once, use many times.

```go
// Good: parse once
val, _ := strconv.ParseFloat(input, 64)
for i := 0; i < 1000; i++ {
    process(val)
}

// Bad: parse in every iteration
for i := 0; i < 1000; i++ {
    val, _ := strconv.ParseFloat(input, 64)
    process(val)
}
```

---

## Metrics

| Type | Size | Precision | Range |
|------|------|-----------|-------|
| `float32` | 4 bytes | ~7 decimal digits | ±3.4 × 10^38 |
| `float64` | 8 bytes | ~15 decimal digits | ±1.8 × 10^308 |

---

## Best Practices

1. **Always use `float64`** unless you have a specific reason for `float32`.
2. **Never use `==` to compare floats** — use an epsilon-based comparison.
3. **Never use floats for money** — use `int64` (cents) or the `decimal` package.
4. **Always check for NaN** using `math.IsNaN()` when the value could be invalid.
5. **Format output with `%.2f`** for user-facing numbers.
6. **Use named constants** for epsilon values to make code self-documenting.

---

## Edge Cases

```go
// 1. NaN comparisons
nan := math.NaN()
fmt.Println(nan < 0)   // false
fmt.Println(nan > 0)   // false
fmt.Println(nan == 0)  // false
fmt.Println(nan != nan) // true — NaN is not equal to itself!

// 2. Infinity arithmetic
posInf := math.Inf(1)
fmt.Println(posInf + posInf)  // +Inf
fmt.Println(posInf - posInf)  // NaN (indeterminate form)
fmt.Println(posInf * 0)       // NaN

// 3. Very small differences
a := 1e15 + 0.1
b := 1e15
fmt.Println(a == b)  // true! The 0.1 is lost in the large number
```

---

## Common Mistakes

### Mistake 1: Float Equality

```go
// WRONG
if 0.1+0.2 == 0.3 {
    fmt.Println("equal") // never prints!
}

// RIGHT
if math.Abs((0.1+0.2)-0.3) < 1e-9 {
    fmt.Println("approximately equal")
}
```

### Mistake 2: Float for Money

```go
// WRONG — rounding errors accumulate
price := 0.10
for i := 0; i < 10; i++ {
    price += 0.10
}
fmt.Println(price) // 1.0000000000000002, not 1.0!

// RIGHT — use integer cents
var priceCents int64 = 10 // 10 cents
for i := 0; i < 10; i++ {
    priceCents += 10
}
fmt.Printf("$%.2f\n", float64(priceCents)/100) // $1.00
```

### Mistake 3: Integer Division

```go
// WRONG
result := 5 / 2
fmt.Println(result) // 2, not 2.5

// RIGHT
result := float64(5) / float64(2)
fmt.Println(result) // 2.5
```

### Mistake 4: Not Checking NaN

```go
// WRONG
val := math.Sqrt(-1)
if val > 0 { // This is false, but not because val is <= 0
    fmt.Println("positive") // never prints
}

// RIGHT
val := math.Sqrt(-1)
if math.IsNaN(val) {
    fmt.Println("Error: got NaN")
}
```

---

## Common Misconceptions

1. **"float64 is always exact"** — FALSE. float64 just has more precision, but still has rounding errors.
2. **"0.1 * 10 == 1.0"** — FALSE. Try it: `fmt.Println(0.1 * 10 == 1.0)` → `false`
3. **"float32 is faster than float64"** — FALSE on modern 64-bit hardware. float64 is often faster.
4. **"I can use float for counting money"** — DANGEROUS. Even small rounding errors compound over transactions.
5. **"NaN == NaN is true"** — FALSE. By definition, NaN is never equal to anything, including itself.

---

## Tricky Points

```go
// Tricky 1: Type inference makes float64 the default
x := 3.14  // float64, NOT float32

// Tricky 2: Untyped constants have unlimited precision until used
const pi = 3.14159265358979323846  // more digits than float64 can hold
var f32 float32 = pi  // truncated to float32 precision
var f64 float64 = pi  // truncated to float64 precision

// Tricky 3: Integer literals can be assigned to float vars
var f float64 = 42  // valid! 42 becomes 42.0

// Tricky 4: Division of two integers is integer division
fmt.Println(7 / 2)         // 3 (integer division)
fmt.Println(7.0 / 2.0)     // 3.5
fmt.Println(float64(7) / 2) // 3.5 (one float is enough)
```

---

## Test (Quiz)

1. What is the default float type in Go?
   - a) float32
   - b) **float64** ✓
   - c) float
   - d) double

2. What does `0.1 + 0.2 == 0.3` evaluate to in Go?
   - a) true
   - b) **false** ✓
   - c) compile error
   - d) runtime error

3. What is the zero value of `float64`?
   - a) `nil`
   - b) `0`
   - c) **`0.0`** ✓ (same as 0 in Go)
   - d) undefined

4. Which function checks if a float is NaN?
   - a) `float64.IsNaN()`
   - b) `f == math.NaN()`
   - c) **`math.IsNaN(f)`** ✓
   - d) `isnan(f)`

5. What does `7 / 2` equal in Go?
   - a) 3.5
   - b) **3** ✓
   - c) 4
   - d) compile error

---

## Tricky Questions

**Q: Why is `nan == nan` false?**
A: This is defined by the IEEE 754 standard. NaN represents an invalid or undefined result. Two undefined results are not considered equal to each other (you don't know *which* invalid computation they came from). Always use `math.IsNaN()`.

**Q: What happens when you divide a float by zero?**
A: Unlike integer division (which panics), float division by zero gives `+Inf`, `-Inf`, or `NaN`:
```go
zero := 0.0
fmt.Println(1.0 / zero)   // +Inf
fmt.Println(-1.0 / zero)  // -Inf
fmt.Println(0.0 / zero)   // NaN
```

**Q: Why does `float64(5) / 2` work, but `5 / 2` gives 2?**
A: When at least one operand is a float, Go does float division. `float64(5) / 2` converts `5` to `5.0`, so the division is `5.0 / 2.0 = 2.5`. In `5 / 2`, both are integers, so Go does integer (truncating) division.

---

## Cheat Sheet

```go
// Declaration
var f float64 = 3.14
f := 3.14        // inferred as float64

// Literals
3.14    1.5e10    2.5E-3    .5    100.

// Math package (import "math")
math.Abs(x)         // absolute value
math.Sqrt(x)        // square root
math.Pow(x, y)      // x^y
math.Floor(x)       // round down
math.Ceil(x)        // round up
math.Round(x)       // round to nearest
math.Trunc(x)       // truncate decimal part
math.Inf(1)         // +Inf
math.Inf(-1)        // -Inf
math.NaN()          // NaN
math.IsNaN(x)       // check NaN
math.IsInf(x, 1)    // check +Inf

// Formatting
fmt.Printf("%.2f", 3.14159)  // "3.14"
fmt.Sprintf("%.4f", x)       // string with 4 decimal places

// Conversion
strconv.ParseFloat("3.14", 64)  // string → float64
strconv.FormatFloat(f, 'f', 2, 64)  // float64 → string

// Safe comparison
const eps = 1e-9
math.Abs(a-b) < eps  // "approximately equal"

// Type sizes
float32: 4 bytes, ~7 digits
float64: 8 bytes, ~15 digits
```

---

## Self-Assessment

Rate yourself on each skill (1–5):

- [ ] I can declare and use `float32` and `float64` variables
- [ ] I understand why `0.1 + 0.2 != 0.3`
- [ ] I can use `math.Abs`, `math.Floor`, `math.Ceil`, `math.Round`
- [ ] I know how to compare floats safely using epsilon
- [ ] I can format float output with `fmt.Printf`
- [ ] I know when NOT to use floats (money)
- [ ] I understand NaN and can check for it with `math.IsNaN`
- [ ] I can convert strings to floats with `strconv.ParseFloat`

---

## Summary

- Go has two float types: `float32` (4 bytes, ~7 digits) and `float64` (8 bytes, ~15 digits)
- **Default to `float64`** for all calculations
- Floats are **approximations**, not exact values — `0.1 + 0.2 ≠ 0.3`
- **Never use `==`** to compare floats; use epsilon-based comparison
- Special values: `+Inf`, `-Inf`, `NaN` — check them with `math.IsInf` and `math.IsNaN`
- **Never use floats for money** — use integer cents or `decimal` package
- Use `math` package for mathematical operations
- Use `strconv` package for string conversion

---

## What You Can Build

After mastering floats, you can build:
- A scientific calculator
- A unit converter (km/miles, °C/°F)
- A simple physics simulation (projectile motion)
- A 2D game with movement and collision
- A statistics library (mean, standard deviation)
- A data analysis tool reading CSV numbers

---

## Further Reading

- [Go spec: Floating-point types](https://go.dev/ref/spec#Numeric_types)
- [Go `math` package docs](https://pkg.go.dev/math)
- [Go `strconv` package docs](https://pkg.go.dev/strconv)
- [IEEE 754 Wikipedia article](https://en.wikipedia.org/wiki/IEEE_754)
- [What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)

---

## Related Topics

- **Integers** — the exact-value alternative for whole numbers
- **Complex Numbers** — built on top of floats
- **Type Conversion** — converting between float32, float64, int
- **`math` package** — mathematical functions for floats
- **`strconv` package** — string/float conversions
- **`fmt` package** — formatting floats for display
- **Financial math** — why to use `shopspring/decimal` instead of floats

---

## Diagrams & Visual Aids

### Float64 Memory Layout (IEEE 754)
```
63      62    52     51                              0
+-------+----------+--------------------------------+
| sign  | exponent |          mantissa              |
| 1 bit |  11 bits |          52 bits               |
+-------+----------+--------------------------------+

value = (-1)^sign × 2^(exponent-1023) × (1 + mantissa/2^52)
```

### float32 vs float64 Comparison
```
float32:  [sign][  8-bit exp  ][      23-bit mantissa      ]
float64:  [sign][   11-bit exp   ][         52-bit mantissa                  ]

float32:  ≈ 7 significant decimal digits
float64:  ≈ 15-16 significant decimal digits
```

### Number Line of Representable Values
```
...  |  |  |  | | | | ||| ||||| ||||||||| 0 ||||||||| ||||| | | | | |  |  |  ...
<--- More sparse near ±Inf          Denser near zero --->
```
(Floats are more precise near zero, less precise for very large/small numbers)
