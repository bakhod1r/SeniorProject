# Floating Points in Go — Tasks

## Table of Contents
1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: Basic Float Operations
**Type:** Implementation
**Goal:** Practice declaring and using float variables, doing arithmetic, and formatting output.

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    // TODO 1: Declare a float64 variable 'radius' with value 7.5

    // TODO 2: Calculate the area of a circle (π × r²)
    // Use math.Pi for π

    // TODO 3: Calculate the circumference (2 × π × r)

    // TODO 4: Print area with 2 decimal places: "Area: 176.71"

    // TODO 5: Print circumference with 2 decimal places: "Circumference: 47.12"

    // TODO 6: Print the rounded area using math.Round

    _ = math.Pi // remove this line after using math.Pi
}
```

**Expected Output:**
```
Area: 176.71
Circumference: 47.12
Rounded area: 177
```

**Evaluation Checklist:**
- [ ] Used `float64` for radius
- [ ] Correctly applied area formula `π * r * r`
- [ ] Used `fmt.Printf` with `%.2f` format
- [ ] Used `math.Pi` (not a hardcoded approximation)
- [ ] Used `math.Round` correctly

---

### Task 2: Safe Float Comparison
**Type:** Function Implementation
**Goal:** Implement an epsilon-based float comparison function and use it.

```go
package main

import (
    "fmt"
    "math"
)

// TODO 1: Implement almostEqual that returns true if |a - b| < epsilon
func almostEqual(a, b float64) bool {
    const epsilon = 1e-9
    // TODO: implement
    return false
}

// TODO 2: Implement roundTo that rounds a float to n decimal places
func roundTo(val float64, decimals int) float64 {
    // Hint: multiply by 10^decimals, round, divide back
    _ = math.Pow
    _ = math.Round
    return 0
}

func main() {
    // TODO 3: Test almostEqual with these cases
    fmt.Println(almostEqual(0.1+0.2, 0.3))   // should print: true
    fmt.Println(almostEqual(0.1+0.3, 0.5))   // should print: false
    fmt.Println(almostEqual(1.0, 1.0))        // should print: true

    // TODO 4: Test roundTo
    fmt.Println(roundTo(3.14159, 2))  // should print: 3.14
    fmt.Println(roundTo(2.5550, 2))   // should print: 2.56
    fmt.Println(roundTo(1.005, 2))    // tricky case — what does it print?
}
```

**Expected Output:**
```
true
false
true
3.14
2.56
1.0  (or 1.01 — discuss why this is tricky)
```

**Evaluation Checklist:**
- [ ] `almostEqual` uses `math.Abs`
- [ ] `almostEqual` uses a named epsilon constant
- [ ] `roundTo` uses `math.Pow(10, decimals)` and `math.Round`
- [ ] Understanding of why `1.005` rounds unexpectedly (discuss)

---

### Task 3: Special Values Handling
**Type:** Function Implementation
**Goal:** Understand and handle NaN and Infinity.

```go
package main

import (
    "fmt"
    "math"
)

// TODO 1: Implement safeDiv that divides a by b.
// Returns (result, error) where:
// - error is nil if division is valid
// - error contains a message if b == 0
func safeDiv(a, b float64) (float64, error) {
    // TODO
    return 0, nil
}

// TODO 2: Implement safeSqrt that returns the square root.
// Returns an error if x < 0.
func safeSqrt(x float64) (float64, error) {
    // TODO
    return 0, nil
}

// TODO 3: Implement classifyFloat that returns:
// "positive", "negative", "zero", "NaN", or "Inf"
func classifyFloat(f float64) string {
    // TODO: use math.IsNaN, math.IsInf
    return ""
}

func main() {
    result, err := safeDiv(10.0, 3.0)
    fmt.Printf("10/3 = %.4f, err = %v\n", result, err)

    _, err = safeDiv(5.0, 0.0)
    fmt.Println("5/0 error:", err)

    root, _ := safeSqrt(16.0)
    fmt.Printf("sqrt(16) = %.2f\n", root)

    _, err = safeSqrt(-4.0)
    fmt.Println("sqrt(-4) error:", err)

    for _, f := range []float64{3.14, -2.7, 0.0, math.NaN(), math.Inf(1)} {
        fmt.Printf("%.2v -> %s\n", f, classifyFloat(f))
    }
}
```

**Expected Output:**
```
10/3 = 3.3333, err = <nil>
5/0 error: division by zero
sqrt(16) = 4.00
sqrt(-4) error: cannot take square root of negative number
3.14 -> positive
-2.70 -> negative
0.00 -> zero
NaN -> NaN
+Inf -> Inf
```

**Evaluation Checklist:**
- [ ] Uses `fmt.Errorf` for error messages
- [ ] Checks `b == 0` before division
- [ ] Uses `math.IsNaN` and `math.IsInf` in classifyFloat
- [ ] Handles all five cases in classifyFloat

---

### Task 4: Temperature Converter
**Type:** Implementation
**Goal:** Build a simple temperature conversion utility.

```go
package main

import "fmt"

// TODO 1: Implement CelsiusToFahrenheit: F = C × (9/5) + 32
func CelsiusToFahrenheit(c float64) float64 {
    return 0
}

// TODO 2: Implement FahrenheitToCelsius: C = (F - 32) × (5/9)
func FahrenheitToCelsius(f float64) float64 {
    return 0
}

// TODO 3: Implement CelsiusToKelvin: K = C + 273.15
func CelsiusToKelvin(c float64) float64 {
    return 0
}

func main() {
    temps := []float64{0, 100, -40, 37}
    for _, c := range temps {
        f := CelsiusToFahrenheit(c)
        k := CelsiusToKelvin(c)
        fmt.Printf("%.1f°C = %.1f°F = %.2fK\n", c, f, k)
    }

    // Round-trip check: C -> F -> C should give back original
    original := 36.6
    roundTrip := FahrenheitToCelsius(CelsiusToFahrenheit(original))
    fmt.Printf("Round-trip: %.1f°C -> %.1f°C\n", original, roundTrip)
}
```

**Expected Output:**
```
0.0°C = 32.0°F = 273.15K
100.0°C = 212.0°F = 373.15K
-40.0°C = -40.0°F = 233.15K
37.0°C = 98.6°F = 310.15K
Round-trip: 36.6°C -> 36.6°C
```

**Evaluation Checklist:**
- [ ] Formulas are correct
- [ ] Uses floating-point division (not integer division)
- [ ] Round-trip gives approximately original value (within epsilon)

---

## Middle Tasks

### Task 5: Statistics Library
**Type:** Implementation
**Goal:** Implement basic statistical functions with correct numerical behavior.

```go
package stats

import (
    "errors"
    "math"
)

// TODO 1: Implement Mean using Welford's incremental algorithm
// to avoid catastrophic cancellation.
// Must return an error for empty slice.
func Mean(data []float64) (float64, error) {
    // TODO: use Welford: mean += (x - mean) / count
    return 0, errors.New("not implemented")
}

// TODO 2: Implement Variance using Welford's online algorithm.
// Returns population variance (divide by n, not n-1).
// Must return error for < 2 elements.
func Variance(data []float64) (float64, error) {
    // TODO: track M2 along with mean
    return 0, errors.New("not implemented")
}

// TODO 3: Implement StdDev as sqrt(Variance).
func StdDev(data []float64) (float64, error) {
    // TODO
    return 0, errors.New("not implemented")
}

// TODO 4: Implement Median. Must handle even-length slices.
// Hint: sort a copy, don't modify original.
func Median(data []float64) (float64, error) {
    // TODO
    return 0, errors.New("not implemented")
}
```

**Expected behavior:**
```go
data := []float64{2, 4, 4, 4, 5, 5, 7, 9}
mean, _ := stats.Mean(data)     // 5.0
variance, _ := stats.Variance(data) // 4.0
stddev, _ := stats.StdDev(data) // 2.0
median, _ := stats.Median(data) // 4.5
```

**Evaluation Checklist:**
- [ ] Uses Welford's algorithm (not sum/n which can lose precision)
- [ ] Returns appropriate errors for edge cases
- [ ] Median sorts a copy (doesn't mutate input)
- [ ] Handles even-length slice for median (averages middle two)
- [ ] All functions pass table-driven unit tests

---

### Task 6: Money Calculator (No Float for Amounts)
**Type:** Architecture + Implementation
**Goal:** Design a currency type that uses integer cents internally but presents a clean API.

```go
package money

import "fmt"

// TODO 1: Define type Money as int64 (represents cents)
type Money int64

// TODO 2: Implement NewMoney(dollars, cents int) Money
// e.g., NewMoney(10, 99) = $10.99
func NewMoney(dollars, cents int) Money {
    return 0
}

// TODO 3: Implement String() method that formats as "$X.XX"
func (m Money) String() string {
    return ""
}

// TODO 4: Implement Add(other Money) Money
func (m Money) Add(other Money) Money {
    return 0
}

// TODO 5: Implement ApplyTax(ratePct float64) Money
// ratePct is a percentage like 8.5 for 8.5%
// Round to nearest cent using banker's rounding (or standard rounding)
func (m Money) ApplyTax(ratePct float64) Money {
    return 0
}

// TODO 6: Write tests to verify:
// NewMoney(10, 99) + NewMoney(5, 0) = $15.99
// NewMoney(10, 0).ApplyTax(8.0) = $0.80
```

**Evaluation Checklist:**
- [ ] `Money` type uses `int64` internally (no float for storage)
- [ ] `String()` handles negative values and zero
- [ ] `ApplyTax` converts to float for multiplication then rounds back to cents
- [ ] Tests cover edge cases (zero, negative, large values)

---

### Task 7: Float Parsing Service
**Type:** Production-Ready Implementation
**Goal:** Build a robust service that parses float values from strings with validation.

```go
package floatparser

import (
    "fmt"
    "math"
    "strconv"
)

type FloatConstraints struct {
    Min      float64
    Max      float64
    AllowNaN bool
    AllowInf bool
}

// TODO 1: Implement ParseFloat that:
// - Parses the string as float64
// - Validates against constraints
// - Returns a wrapped error with the field name on failure
func ParseFloat(fieldName, value string, c FloatConstraints) (float64, error) {
    return 0, fmt.Errorf("not implemented")
}

// TODO 2: Implement ParseFloatSlice that parses a comma-separated string of floats
// e.g., "1.0,2.5,3.7" -> []float64{1.0, 2.5, 3.7}
func ParseFloatSlice(input string, c FloatConstraints) ([]float64, error) {
    return nil, fmt.Errorf("not implemented")
}

// TODO 3: Add a test that verifies these inputs:
// "3.14"    -> valid
// "abc"     -> error (parse failure)
// "NaN"     -> error (NaN not allowed)
// "Inf"     -> error (Inf not allowed)
// "200.0"   -> error if Max is 100.0
// "-5.0"    -> error if Min is 0.0
```

**Evaluation Checklist:**
- [ ] Uses `strconv.ParseFloat` (not `fmt.Sscanf` or regex)
- [ ] Explicitly checks NaN and Inf when not allowed
- [ ] Error messages include field name for debugging
- [ ] `ParseFloatSlice` handles empty input and whitespace
- [ ] Function is tested with table-driven tests

---

### Task 8: Kahan Summation Benchmark
**Type:** Benchmarking + Analysis
**Goal:** Measure the accuracy difference between naive and Kahan summation.

```go
package benchmark

import (
    "fmt"
    "math"
    "testing"
)

// TODO 1: Implement NaiveSum
func NaiveSum(vals []float64) float64 {
    return 0
}

// TODO 2: Implement KahanSum
func KahanSum(vals []float64) float64 {
    return 0
}

// TODO 3: Generate test data: 1,000,000 values of 0.1
// Known exact sum: 100,000.0
func generateTestData() []float64 {
    return nil
}

// TODO 4: Write a comparison that shows the error of each approach
func CompareAccuracy() {
    data := generateTestData()
    expected := 100000.0

    naive := NaiveSum(data)
    kahan := KahanSum(data)

    fmt.Printf("Expected: %.10f\n", expected)
    fmt.Printf("Naive:    %.10f  (error: %e)\n", naive, math.Abs(naive-expected))
    fmt.Printf("Kahan:    %.10f  (error: %e)\n", kahan, math.Abs(kahan-expected))
}

// TODO 5: Add benchmarks
func BenchmarkNaiveSum(b *testing.B) { /* TODO */ }
func BenchmarkKahanSum(b *testing.B) { /* TODO */ }
```

**Expected Output (approximate):**
```
Expected: 100000.0000000000
Naive:    100000.0000001364  (error: 1.364e-07)
Kahan:    100000.0000000000  (error: 0.000e+00)
```

**Evaluation Checklist:**
- [ ] Both algorithms are correctly implemented
- [ ] Shows measurable accuracy difference
- [ ] Benchmarks use `b.ResetTimer()` after setup
- [ ] Analysis includes note on performance tradeoff

---

## Senior Tasks

### Task 9: Numerical Stability Audit
**Type:** Code Review + Refactoring
**Goal:** Find and fix numerical stability issues in a signal processing function.

```go
package signal

import "math"

// Original function (has numerical issues — find and fix them)
func processSignal(samples []float64, noiseFloor float64) []float64 {
    // TODO: Identify issues:
    // 1. Naive summation in high-frequency noise
    // 2. Float comparison for noise gating
    // 3. Potential NaN if samples are empty
    // 4. Loss of precision in energy calculation

    n := len(samples)
    if n == 0 {
        return nil
    }

    // Calculate total energy (ISSUE: may lose precision)
    sumX2 := 0.0
    sumX := 0.0
    for _, s := range samples {
        sumX += s
        sumX2 += s * s
    }
    energy := sumX2/float64(n) - (sumX/float64(n))*(sumX/float64(n))

    // Normalize by energy
    result := make([]float64, n)
    for i, s := range samples {
        normalized := s / math.Sqrt(energy)
        // Gate: remove values below noise floor (ISSUE: == comparison)
        if normalized == noiseFloor {
            result[i] = 0
        } else {
            result[i] = normalized
        }
    }
    return result
}

// TODO: Implement processSignalFixed that:
// 1. Uses Welford's algorithm for variance (eliminates cancellation)
// 2. Uses epsilon comparison for noise gating
// 3. Handles empty input
// 4. Handles zero variance (constant signal)
// 5. Validates inputs (NaN, Inf detection)
func processSignalFixed(samples []float64, noiseFloor float64) ([]float64, error) {
    return nil, nil
}
```

**Evaluation Checklist:**
- [ ] Identified all 4 numerical issues in the original
- [ ] Fixed variance calculation uses Welford's algorithm
- [ ] Noise gate uses epsilon comparison
- [ ] Zero-energy (constant signal) case handled without division by zero
- [ ] Added input validation for NaN/Inf samples

---

### Task 10: Distributed Float Aggregation
**Type:** System Design + Implementation
**Goal:** Design a distributed aggregation system that gives consistent results across nodes.

```go
package aggregation

// Problem: Multiple goroutines receive float64 samples concurrently.
// Each goroutine processes a subset. The final aggregation must be
// DETERMINISTIC — same input values must always give same result.

// TODO 1: Design a type that can receive floats concurrently
// and return a deterministic final sum.
type DeterministicAggregator struct {
    // TODO: what fields do you need?
}

// TODO 2: Implement Add (thread-safe)
func (d *DeterministicAggregator) Add(val float64) {
    // TODO
}

// TODO 3: Implement Sum that returns the same value regardless of Add call order.
// Hint: sort the collected values before summing.
func (d *DeterministicAggregator) Sum() float64 {
    return 0
}

// TODO 4: Write a test that proves determinism:
// - Send same 1000 values in different orders
// - Sum must be identical

// TODO 5: Benchmark the aggregator under concurrent load.
// How many goroutines can you use before contention becomes a bottleneck?
```

**Evaluation Checklist:**
- [ ] Uses mutex or channel for thread safety
- [ ] Sum sorts before summing for determinism
- [ ] Uses Kahan or Neumaier sum after sorting
- [ ] Test verifies same sum for different insertion orders
- [ ] Performance acceptable (discuss tradeoffs)

---

## Questions

**Q1**: Why does `0.1 + 0.2 != 0.3` in Go, and how would you fix a function that checks equality of prices?

**Q2**: A loop runs `for f := 0.0; f != 1.0; f += 0.1`. Will it terminate? Why or why not? What is the correct way to write this loop?

**Q3**: You have a `[]float64` with 10 million elements. Should you use `float32` instead to save memory? What are the tradeoffs?

**Q4**: What is the difference between `math.Trunc(-3.7)`, `math.Floor(-3.7)`, and `int(-3.7)`? When would each give different results?

**Q5**: A colleague writes `if math.Sqrt(x) == 2.0`. What's wrong with this comparison, and how would you fix it?

---

## Mini Projects

### Mini Project 1: Scientific Calculator
**Goal:** Build a CLI calculator that supports floating-point operations.

Requirements:
- Support `+`, `-`, `*`, `/`, `sqrt`, `pow`, `log`, `sin`, `cos`
- Display results with appropriate precision (`%g` format)
- Handle division by zero gracefully (return error, not panic)
- Handle NaN results from invalid operations
- Support scientific notation input (`1.5e10`)

```go
package main

// TODO: Implement Calculator struct with methods for each operation
// TODO: Implement a REPL: read "3.14 * 2", compute, print result
// TODO: Handle errors: "sqrt(-1)" -> "Error: cannot take sqrt of negative"
// TODO: Test with: 0.1 + 0.2, 1e308 * 2, sqrt(-1), 1/0
```

**Evaluation Checklist:**
- [ ] All operations implemented correctly
- [ ] Error handling for invalid operations
- [ ] NaN detection and meaningful error messages
- [ ] Scientific notation input works
- [ ] Results formatted appropriately

---

### Mini Project 2: Price Analysis Tool
**Goal:** Analyze a list of product prices and generate statistics.

```go
package main

// Input: CSV file with product prices (as strings)
// "Apple","1.99"
// "Banana","0.59"
// ...

// TODO: Implement priceAnalysis that:
// 1. Parses prices from strings (handle malformed input)
// 2. Computes: min, max, mean, median, standard deviation
// 3. Identifies prices within 1 std dev of mean
// 4. Formats all output to 2 decimal places
// 5. NEVER uses float for accumulation — use int cents for sum/count

// Expected output:
// Total products: 50
// Min price: $0.59
// Max price: $19.99
// Mean: $5.43
// Median: $4.99
// Std Dev: $3.21
// Products within 1 std dev: 38 (76%)
```

**Evaluation Checklist:**
- [ ] Parses CSV correctly with error handling
- [ ] Uses int cents for financial calculations
- [ ] Uses float only for statistics (mean, std dev)
- [ ] Handles malformed price strings
- [ ] All output formatted to 2 decimal places

---

## Challenge

### Challenge: High-Precision π Calculator

Implement a function that calculates π to N significant digits using the Leibniz formula with Kahan summation, then compare accuracy with Go's `math.Pi`.

```go
package main

import (
    "fmt"
    "math"
)

// Leibniz formula: π/4 = 1 - 1/3 + 1/5 - 1/7 + ...
// This converges very slowly; use Kahan summation for best accuracy.

// TODO 1: Implement LeibnizPi(terms int) float64 using Kahan summation
func LeibnizPi(terms int) float64 {
    return 0
}

// TODO 2: Implement the more efficient Machin formula:
// π/4 = 4*arctan(1/5) - arctan(1/239)
// where arctan(x) = x - x³/3 + x⁵/5 - ...
func MachinPi(terms int) float64 {
    return 0
}

// TODO 3: Compare both with math.Pi
func main() {
    fmt.Printf("math.Pi: %.15f\n", math.Pi)

    for _, n := range []int{100, 1000, 10000, 1000000} {
        leibniz := LeibnizPi(n)
        machin := MachinPi(n / 100) // Machin converges much faster

        leibnizErr := math.Abs(leibniz - math.Pi)
        machinErr := math.Abs(machin - math.Pi)

        fmt.Printf("n=%7d: Leibniz=%.15f (err=%e)  Machin=%.15f (err=%e)\n",
            n, leibniz, leibnizErr, machin, machinErr)
    }
}
```

**Expected Output (approximate):**
```
math.Pi: 3.141592653589793
n=    100: Leibniz=3.131592903558... (err=1.0e-02)  Machin=3.141592653589... (err=<1e-15)
n=   1000: Leibniz=3.140592653840... (err=1.0e-03)  Machin=3.141592653589... (err=<1e-15)
n=  10000: Leibniz=3.141492653590... (err=1.0e-04)  Machin=3.141592653589... (err=<1e-15)
n=1000000: Leibniz=3.141591653590... (err=1.0e-06)  Machin=3.141592653589... (err=<1e-15)
```

**Challenge Extension:** Implement `math/big.Float` version of Machin's formula that can compute π to 100+ significant digits.

**Evaluation Checklist:**
- [ ] Leibniz formula implemented with correct signs (+1, -1, +1, ...)
- [ ] Kahan summation applied to Leibniz
- [ ] Machin formula correctly implements both arctan series
- [ ] Error analysis shows Machin converges much faster
- [ ] (Extension) `big.Float` version achieves 100+ digit accuracy
- [ ] Code is well-commented explaining the math
