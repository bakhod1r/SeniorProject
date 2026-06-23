# Numeric Types — Tasks

## Junior Tasks

### Task 1 — Type Explorer
**Type**: Coding Exercise
**Goal**: Declare variables of every numeric type and print their values and types.

```go
// Starter code
package main

import "fmt"

func main() {
    // Declare at least one variable of each type:
    // int8, int16, int32, int64, int
    // uint8, uint16, uint32, uint64, uint
    // float32, float64
    // complex64, complex128
    // byte, rune

    // Print each with fmt.Printf using %T for type, %v for value
    var a int8 = 42
    fmt.Printf("int8: %v (%T)\n", a, a)
    // ... continue for all types
}
```

**Expected Output**:
```
int8: 42 (int8)
int16: 42 (int16)
int32: 42 (int32)
int64: 42 (int64)
int: 42 (int)
uint8: 42 (uint8)
...
float64: 3.14 (float64)
complex128: (3+4i) (complex128)
byte: 65 (uint8)
rune: 65 (int32)
```

**Evaluation Criteria**:
- All 15+ numeric types declared and printed
- Correct use of %T format verb
- Correct format verbs for each type (%d for int, %f for float, %v for complex)

---

### Task 2 — Overflow Experiment
**Type**: Experiment & Observe
**Goal**: Understand integer overflow by intentionally triggering it and observing the result.

```go
// Starter code
package main

import (
    "fmt"
    "math"
)

func main() {
    // 1. Show the maximum value of int8
    fmt.Println("int8 max:", math.MaxInt8) // 127

    // 2. Add 1 to max and print result
    var x int8 = math.MaxInt8
    x++
    fmt.Println("After overflow:", x) // should be -128

    // 3. Do the same for uint8 underflow
    var u uint8 = 0
    u--
    fmt.Println("After underflow:", u) // should be 255

    // 4. Do the same for int16
    var y int16 = math.MaxInt16
    y++
    fmt.Println("int16 overflow:", y)
}
```

**Expected Output**:
```
int8 max: 127
After overflow: -128
After underflow: 255
int16 overflow: -32768
```

**Evaluation Criteria**:
- Correctly uses math.MaxInt8 constant
- Demonstrates both overflow and underflow
- Comments explain what is happening

---

### Task 3 — Temperature Converter
**Type**: Real-World Application
**Goal**: Build a temperature converter using named numeric types to prevent unit errors.

```go
// Starter code
package main

import "fmt"

// Define named types
type Celsius    float64
type Fahrenheit float64
type Kelvin     float64

// Implement these conversion functions:
func CelsiusToFahrenheit(c Celsius) Fahrenheit {
    // Formula: (C × 9/5) + 32
    // TODO: implement
    return 0
}

func FahrenheitToCelsius(f Fahrenheit) Celsius {
    // Formula: (F − 32) × 5/9
    // TODO: implement
    return 0
}

func CelsiusToKelvin(c Celsius) Kelvin {
    // Formula: C + 273.15
    // TODO: implement
    return 0
}

func main() {
    bodyTemp := Celsius(37.0)
    fmt.Printf("%.1f°C = %.1f°F\n", bodyTemp, CelsiusToFahrenheit(bodyTemp))
    fmt.Printf("%.1f°C = %.2fK\n", bodyTemp, CelsiusToKelvin(bodyTemp))

    boiling := Fahrenheit(212.0)
    fmt.Printf("%.1f°F = %.1f°C\n", boiling, FahrenheitToCelsius(boiling))
}
```

**Expected Output**:
```
37.0°C = 98.6°F
37.0°C = 310.15K
212.0°F = 100.0°C
```

**Evaluation Criteria**:
- Correct conversion formulas
- Named types prevent mixing Celsius and Fahrenheit
- Appropriate float64 precision

---

## Middle Tasks

### Task 4 — Safe Integer Arithmetic Library
**Type**: Library Design
**Goal**: Implement a set of safe integer arithmetic operations that detect overflow.

```go
// Starter code
package safemath

import (
    "fmt"
    "math"
)

// SafeAdd adds two int64 values and returns an error on overflow
func SafeAdd(a, b int64) (int64, error) {
    // TODO: implement overflow detection
    // Hint: if a > 0 && b > 0 && a > MaxInt64 - b → overflow
    return 0, nil
}

// SafeSub subtracts b from a and returns an error on overflow
func SafeSub(a, b int64) (int64, error) {
    // TODO: implement
    return 0, nil
}

// SafeMul multiplies two int64 values and returns an error on overflow
func SafeMul(a, b int64) (int64, error) {
    // TODO: implement using int64 checked via result/a == b
    return 0, nil
}

// SafeDiv divides a by b and returns an error for division by zero
func SafeDiv(a, b int64) (int64, error) {
    // TODO: implement
    return 0, nil
}
```

**Expected Output** (test cases):
```
SafeAdd(MaxInt64, 1) → error: overflow
SafeSub(MinInt64, 1) → error: overflow
SafeMul(1000000000, 1000000000) → 1000000000000000000, nil
SafeDiv(10, 0) → error: division by zero
```

**Evaluation Criteria**:
- All four operations implemented
- Correct overflow detection for all edge cases
- Clear error messages
- Unit tests covering boundary cases

---

### Task 5 — Money Calculator
**Type**: Domain Modeling
**Goal**: Build a money type that uses int64 internally to avoid floating-point errors.

```go
// Starter code
package main

import "fmt"

// Money represents an amount in cents (int64)
type Money int64

// NewMoney creates a Money value from dollars and cents
func NewMoney(dollars, cents int64) Money {
    return Money(dollars*100 + cents)
}

// String formats money as "$X.YY"
func (m Money) String() string {
    // TODO: implement
    return ""
}

// Add returns the sum of two Money values
func (m Money) Add(other Money) Money {
    // TODO: implement
    return 0
}

// Mul multiplies money by an integer quantity
func (m Money) Mul(qty int64) Money {
    // TODO: implement
    return 0
}

// Tax calculates tax at the given rate (in basis points: 850 = 8.5%)
func (m Money) Tax(basisPoints int64) Money {
    // TODO: implement (use integer arithmetic!)
    return 0
}

func main() {
    price := NewMoney(19, 99)
    qty := int64(3)
    subtotal := price.Mul(qty)
    tax := subtotal.Tax(850) // 8.5%
    total := subtotal.Add(tax)

    fmt.Printf("Price: %s × %d = %s\n", price, qty, subtotal)
    fmt.Printf("Tax (8.5%%): %s\n", tax)
    fmt.Printf("Total: %s\n", total)
}
```

**Expected Output**:
```
Price: $19.99 × 3 = $59.97
Tax (8.5%): $5.10
Total: $65.07
```

**Evaluation Criteria**:
- All arithmetic done with int64, no float64
- String method correctly formats with leading zeros for cents
- Tax calculation uses integer rounding
- No floating-point errors

---

### Task 6 — Floating-Point Investigation
**Type**: Research & Documentation
**Goal**: Document and explain 5 cases of floating-point behavior that surprise beginners.

Write a Go program that demonstrates each case with an explanation comment:

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    // Case 1: 0.1 + 0.2 != 0.3
    // TODO: demonstrate and explain

    // Case 2: NaN != NaN
    // TODO: demonstrate and explain

    // Case 3: Infinity arithmetic
    // TODO: demonstrate +Inf, -Inf, Inf+Inf, Inf-Inf

    // Case 4: Very large + very small = large (precision loss)
    // TODO: demonstrate that 1e15 + 1 == 1e15

    // Case 5: Negative zero
    // TODO: demonstrate that -0.0 == 0.0 but 1/-0.0 = -Inf
}
```

**Evaluation Criteria**:
- All 5 cases correctly demonstrated
- Clear explanation comments
- Suggests correct alternatives where applicable

---

## Senior Tasks

### Task 7 — Numeric Type Benchmark Suite
**Type**: Performance Engineering
**Goal**: Write a comprehensive benchmark comparing different numeric types for a real computation.

```go
// Starter code
package bench_test

import (
    "testing"
)

// Benchmark computing the sum of 10,000 elements with different types
func BenchmarkSumInt32(b *testing.B) {
    data := make([]int32, 10000)
    for i := range data { data[i] = int32(i) }
    b.ResetTimer()
    for n := 0; n < b.N; n++ {
        var sum int32
        for _, v := range data { sum += v }
        _ = sum
    }
}

// TODO: Add benchmarks for:
// BenchmarkSumInt64
// BenchmarkSumFloat32
// BenchmarkSumFloat64
// BenchmarkSumWithConversion (int32 data → float64 sum)

// Also benchmark:
// Matrix multiply with float32 vs float64 (4x4 matrices)
// String-to-int parsing: strconv.Atoi vs strconv.ParseInt
```

**Expected Output** (approximate):
```
BenchmarkSumInt32-8        50000    25000 ns/op    0 B/op    0 allocs/op
BenchmarkSumInt64-8        50000    25000 ns/op    0 B/op    0 allocs/op
BenchmarkSumFloat32-8      50000    25000 ns/op    0 B/op    0 allocs/op
BenchmarkSumFloat64-8      50000    25000 ns/op    0 B/op    0 allocs/op
```

**Evaluation Criteria**:
- All benchmark functions implemented correctly
- Uses b.ResetTimer() after setup
- Includes _=result to prevent dead code elimination
- Analyzes and comments on results

---

### Task 8 — Production Numeric Error Handler
**Type**: System Design
**Goal**: Design a production-ready numeric operations library with error handling, overflow protection, and metrics.

Requirements:
- Safe arithmetic for int64 and float64
- Structured error types with error codes
- Overflow/underflow detection
- NaN/Inf handling for floats
- Request metrics (how many overflow errors per hour?)
- JSON-serializable error responses

```go
// Design this package structure:
// package numericops

type NumericError struct {
    Code    string
    Message string
    Inputs  []interface{}
}

type SafeInt64 struct{ v int64 }
type SafeFloat64 struct{ v float64 }

// Implement Add, Sub, Mul, Div for both with full error handling
// Add metrics collection
// Add JSON serialization
```

**Evaluation Criteria**:
- Typed error system with codes
- All four arithmetic operations safe
- Comprehensive test coverage (>90%)
- Metrics design documented

---

## Questions

1. What is the difference between `int8(127) + 1` and `int16(127) + 1` in Go?
2. Why does Go's `range` over a string iterate by rune, not by byte?
3. What is the risk of storing a loop variable as `uint` when counting down?
4. How does `strconv.ParseFloat` determine precision? What is the `bitSize` parameter?
5. Why is `math.MaxInt` a constant in Go but `math.MaxUint` is not?

---

## Mini Projects

### Project 1 — Unit Conversion Library
Build a library that converts between metric and imperial units using named types:
- Length: Meters, Feet, Inches, Centimeters
- Weight: Kilograms, Pounds, Ounces
- Temperature: Celsius, Fahrenheit, Kelvin
- Volume: Liters, Gallons, Milliliters

Each conversion should be type-safe (cannot accidentally pass Meters where Pounds is expected).

### Project 2 — Financial Calculator
Build a command-line financial calculator supporting:
- Compound interest: `A = P(1 + r/n)^(nt)`
- Loan payment: `M = P[r(1+r)^n]/[(1+r)^n-1]`
- Currency conversion using int64 (cents)
- Output formatted to 2 decimal places
- All intermediate calculations in int64 to avoid FP errors

---

## Challenge — Arbitrary Precision Factorial

Implement a factorial function that works for large inputs without overflow, using the `math/big` package. Compare the performance of big.Int factorial vs a float64 approximation using Stirling's formula.

```go
package main

import (
    "fmt"
    "math"
    "math/big"
    "time"
)

// Exact factorial using math/big (arbitrary precision)
func factorialExact(n int) *big.Int {
    // TODO: implement
    return nil
}

// Approximate factorial using Stirling's approximation
// ln(n!) ≈ n*ln(n) - n + 0.5*ln(2πn)
func factorialApprox(n int) float64 {
    if n == 0 { return 1 }
    return math.Exp(float64(n)*math.Log(float64(n)) -
        float64(n) + 0.5*math.Log(2*math.Pi*float64(n)))
}

func main() {
    n := 100
    start := time.Now()
    exact := factorialExact(n)
    exactTime := time.Since(start)

    start = time.Now()
    approx := factorialApprox(n)
    approxTime := time.Since(start)

    fmt.Printf("100! (exact):  %v (took %v)\n", exact, exactTime)
    fmt.Printf("100! (approx): %.2e (took %v)\n", approx, approxTime)
}
```
