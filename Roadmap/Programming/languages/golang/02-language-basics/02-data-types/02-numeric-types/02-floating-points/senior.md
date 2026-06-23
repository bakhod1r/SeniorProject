# Floating Points in Go — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Core Concepts](#core-concepts)
3. [Pros & Cons](#pros-cons)
4. [Use Cases](#use-cases)
5. [Code Examples](#code-examples)
6. [Coding Patterns](#coding-patterns)
7. [Clean Code](#clean-code)
8. [Best Practices](#best-practices)
9. [Product Use](#product-use)
10. [Error Handling](#error-handling)
11. [Security](#security)
12. [Performance Optimization](#performance-optimization)
13. [Metrics](#metrics)
14. [Debugging Guide](#debugging-guide)
15. [Edge Cases](#edge-cases)
16. [Postmortems](#postmortems)
17. [Common Mistakes](#common-mistakes)
18. [Tricky Points](#tricky-points)
19. [Comparison](#comparison)
20. [Test](#test)
21. [Tricky Questions](#tricky-questions)
22. [Cheat Sheet](#cheat-sheet)
23. [Summary](#summary)
24. [What You Can Build](#what-you-can-build)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams](#diagrams)

---

## Introduction

At the senior level, you are responsible for designing systems where floating-point behavior affects correctness, performance, and reliability at scale. You need to architect solutions that handle:

- Numerical stability across millions of computations
- Consistent results across different hardware/OS
- Performance characteristics at the limits of float throughput
- Correctness proofs and bounds on accumulated error
- Architectural decisions: when to use floats vs fixed-point vs integer vs external libraries

This guide focuses on **optimize**, **architect**, and **prove** — not just "how to use."

---

## Core Concepts

### Numerical Stability Categories

**Forward stable**: small input perturbation → small output perturbation
**Backward stable**: result is exact for slightly different input
**Condition number**: how much output amplifies input error

```go
// High condition number = numerically unstable
// Example: solving near-singular linear system
// Ax = b where A is nearly singular amplifies errors massively

// Low condition number = stable
// Example: computing mean of positive numbers
func stableMean(vals []float64) float64 {
    if len(vals) == 0 {
        return 0
    }
    // Welford's algorithm: O(1) extra space, numerically stable
    mean := 0.0
    for i, v := range vals {
        mean += (v - mean) / float64(i+1)
    }
    return mean
}
```

### Error Bounds and ULP Analysis

Every IEEE 754 operation is guaranteed to return the "correctly rounded" result — the float nearest to the mathematically exact result. This means the error of a single operation is at most 0.5 ULP (unit in the last place).

```go
// Compute the ULP of a float64
func ulp(x float64) float64 {
    if x == 0 {
        return math.SmallestNonzeroFloat64
    }
    return math.Abs(math.Nextafter(x, math.Inf(1)) - x)
}

// Error bound for a+b is at most 0.5 * ulp(a+b)
```

### Interval Arithmetic for Error Tracking

For safety-critical code, represent each value as an interval [lo, hi]:

```go
type Interval struct {
    Lo, Hi float64
}

func (a Interval) Add(b Interval) Interval {
    return Interval{a.Lo + b.Lo, a.Hi + b.Hi}
}

func (a Interval) Mul(b Interval) Interval {
    products := [4]float64{a.Lo * b.Lo, a.Lo * b.Hi, a.Hi * b.Lo, a.Hi * b.Hi}
    lo, hi := products[0], products[0]
    for _, p := range products[1:] {
        if p < lo { lo = p }
        if p > hi { hi = p }
    }
    return Interval{lo, hi}
}
```

---

## Pros & Cons

### Senior Perspective Pros
- Hardware FMA (fused multiply-add) enables high-performance numerics with single-rounding
- IEEE 754 strict mode (Go's default) enables reproducible distributed computation
- Compiler can generate SIMD instructions for float slices when patterns are recognized
- No Go GC pressure — floats are value types, not heap-allocated

### Senior Perspective Cons
- Non-associativity breaks naive parallelization: sum(a, b, c, d) != sum(a+b) + sum(c+d) exactly
- 64-bit floats limit integer representation to 2^53 — JSON IDs over 9e15 lose precision
- Transcendental functions (`sin`, `exp`, `log`) may not be correctly rounded across all inputs
- No hardware decimal float support on most architectures (software decimal is 10-100x slower)

---

## Use Cases

### Architectural Decision Matrix

| Scenario | Correct Choice | Reason |
|----------|---------------|--------|
| Scientific simulation | float64 | Precision needed, error bounds acceptable |
| Financial ledger | int64 or decimal | Exact representation required |
| ML model weights | float32 | Memory bandwidth >> precision |
| GPS coordinates | float64 | ~11mm precision at 1e-7 degrees |
| Game physics (real-time) | float32 | GPU native, cache efficient |
| High-frequency trading | int64 (fixed point) | No rounding, deterministic |
| Statistical sampling | float64 + Kahan | Accumulated errors matter |
| Hash keys | string or int | float NaN/equality semantics wrong |

---

## Code Examples

### Example 1: Compensated Summation at Scale

```go
package numerics

import "math"

// PairwiseSum is more accurate than linear sum for large arrays
// Error bound: O(log n * epsilon * sum) vs O(n * epsilon * sum) for naive
func PairwiseSum(vals []float64) float64 {
    n := len(vals)
    if n == 0 {
        return 0
    }
    if n == 1 {
        return vals[0]
    }
    if n <= 8 { // base case: linear sum is fine for small n
        s := 0.0
        for _, v := range vals {
            s += v
        }
        return s
    }
    mid := n / 2
    return PairwiseSum(vals[:mid]) + PairwiseSum(vals[mid:])
}

// NeumaierSum is Kahan's improvement — handles cases where new value
// is larger than the running sum (which Kahan misses)
func NeumaierSum(vals []float64) float64 {
    sum := 0.0
    c := 0.0
    for _, v := range vals {
        t := sum + v
        if math.Abs(sum) >= math.Abs(v) {
            c += (sum - t) + v
        } else {
            c += (v - t) + sum
        }
        sum = t
    }
    return sum + c
}
```

### Example 2: Two-Sum Exact Algorithm (Error-Free Transform)

```go
// TwoSum computes the exact rounding error of a + b
// Returns (sum, error) such that a + b = sum + err EXACTLY
func TwoSum(a, b float64) (float64, float64) {
    s := a + b
    bVirtual := s - a
    aVirtual := s - bVirtual
    bRoundoff := b - bVirtual
    aRoundoff := a - aVirtual
    return s, aRoundoff + bRoundoff
}

// Use TwoSum to build exact dot product
func exactDotProduct(a, b []float64) float64 {
    if len(a) != len(b) {
        panic("length mismatch")
    }
    sum := 0.0
    c := 0.0
    for i := range a {
        p := a[i] * b[i]
        s, err := TwoSum(sum, p)
        c += err
        sum = s
    }
    return sum + c
}
```

### Example 3: Float-Safe Configuration System

```go
package config

import (
    "fmt"
    "math"
    "strconv"
)

type FloatConstraint struct {
    Min, Max float64
    AllowNaN bool
    AllowInf bool
}

func (c FloatConstraint) Validate(name string, val float64) error {
    if !c.AllowNaN && math.IsNaN(val) {
        return fmt.Errorf("config %s: NaN not allowed", name)
    }
    if !c.AllowInf && math.IsInf(val, 0) {
        return fmt.Errorf("config %s: Inf not allowed", name)
    }
    if !math.IsNaN(val) && !math.IsInf(val, 0) {
        if val < c.Min {
            return fmt.Errorf("config %s: %f < min %f", name, val, c.Min)
        }
        if val > c.Max {
            return fmt.Errorf("config %s: %f > max %f", name, val, c.Max)
        }
    }
    return nil
}

type FloatConfig struct {
    constraints map[string]FloatConstraint
    values      map[string]float64
}

func (fc *FloatConfig) Set(name, raw string, c FloatConstraint) error {
    val, err := strconv.ParseFloat(raw, 64)
    if err != nil {
        return fmt.Errorf("config %s: %w", name, err)
    }
    if err := c.Validate(name, val); err != nil {
        return err
    }
    if fc.values == nil {
        fc.values = make(map[string]float64)
    }
    fc.values[name] = val
    return nil
}
```

### Example 4: Float Benchmark Harness

```go
package bench

import (
    "math"
    "testing"
)

// BenchmarkSumStrategies compares summation strategies
func BenchmarkNaiveSum(b *testing.B) {
    data := make([]float64, 1_000_000)
    for i := range data {
        data[i] = 1.0 / float64(i+1)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sum := 0.0
        for _, v := range data {
            sum += v
        }
        _ = sum
    }
}

func BenchmarkKahanSum(b *testing.B) {
    data := make([]float64, 1_000_000)
    for i := range data {
        data[i] = 1.0 / float64(i+1)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sum, c := 0.0, 0.0
        for _, v := range data {
            y := v - c
            t := sum + y
            c = (t - sum) - y
            sum = t
        }
        _ = sum
    }
}

// Note: Kahan is ~2x slower but significantly more accurate
// Decision: use Kahan when accuracy matters more than speed
```

---

## Coding Patterns

### Pattern: Error-Tracking Accumulator

```go
type AccurateSum struct {
    sum float64
    c   float64 // Kahan compensator
}

func (s *AccurateSum) Add(v float64) {
    y := v - s.c
    t := s.sum + y
    s.c = (t - s.sum) - y
    s.sum = t
}

func (s *AccurateSum) Result() float64 {
    return s.sum + s.c
}

// Usage: drop-in replacement for sum += v
```

### Pattern: Float-Safe Sorting

```go
import "sort"

// Canonical NaN-aware float sort
func SortFloat64s(vals []float64) {
    sort.Slice(vals, func(i, j int) bool {
        // NaN is not < anything, treat NaN as +Inf for sorting
        a, b := vals[i], vals[j]
        if math.IsNaN(a) {
            return false
        }
        if math.IsNaN(b) {
            return true
        }
        return a < b
    })
}
```

---

## Clean Code

### Float Types in APIs

```go
// BAD: ambiguous what float32 precision means
type Sensor struct {
    Reading float32
}

// GOOD: document precision and units
// TemperatureReading holds a temperature measurement.
// Precision: ±0.1°C (sensor spec). Stored as float64 for computation safety.
type TemperatureReading struct {
    Celsius float64
}

// BAD: epsilon as magic number
if math.Abs(a-b) < 0.000001 {

// GOOD: named, documented
const (
    // angleEpsilonRad is the tolerance for angle comparison.
    // Corresponds to <0.001 degree, which is below GPS bearing accuracy.
    angleEpsilonRad = 1.74533e-5 // 0.001 * pi / 180
)
```

---

## Best Practices

1. **Establish error budgets** before choosing float type. If you need 5 significant digits and do 10^6 operations, float64's 15 digits is sufficient; float32's 7 is not.

2. **Use Neumaier summation** instead of Kahan when you might have cancellation between partial sums.

3. **Validate at system boundaries**: every float entering your system from external sources (HTTP, files, databases) must be validated for NaN, Inf, and range.

4. **Profile before choosing float32**: the actual speedup from float32 depends on whether you're memory-bound or compute-bound. Measure first.

5. **Use `math.Nextafter`** for robust less-than checks in unit testing:
```go
// Assert x < y with tolerance
func assertLT(t *testing.T, x, y float64) {
    t.Helper()
    if x >= math.Nextafter(y, math.Inf(1)) {
        t.Errorf("%v is not < %v", x, y)
    }
}
```

---

## Product Use

### Real Production Pattern: Distributed Aggregation with Consistent Results

```go
// Problem: different nodes sum in different order, get different results
// Solution: sort before summing, use Kahan

type DistributedAggregate struct {
    values []float64
    sorted bool
}

func (d *DistributedAggregate) Add(v float64) {
    d.values = append(d.values, v)
    d.sorted = false
}

// Deterministic result regardless of insertion order
func (d *DistributedAggregate) Sum() float64 {
    if !d.sorted {
        sort.Float64s(d.values) // sort ascending for consistent order
        d.sorted = true
    }
    sum, c := 0.0, 0.0
    for _, v := range d.values {
        y := v - c
        t := sum + y
        c = (t - sum) - y
        sum = t
    }
    return sum
}
```

---

## Error Handling

### Float Error Propagation Analysis

```go
// For safety-critical systems, compute error bounds explicitly
type BoundedFloat struct {
    Value   float64
    AbsErr  float64 // absolute error bound
}

func (a BoundedFloat) Add(b BoundedFloat) BoundedFloat {
    sum := a.Value + b.Value
    // Error bound: sum of individual errors + rounding error of addition
    rounding := 0.5 * ulp(sum)
    return BoundedFloat{
        Value:  sum,
        AbsErr: a.AbsErr + b.AbsErr + rounding,
    }
}

func (a BoundedFloat) Mul(b BoundedFloat) BoundedFloat {
    product := a.Value * b.Value
    // Error: |a||eb| + |b||ea| + ea*eb + 0.5*ulp(product)
    rounding := 0.5 * ulp(product)
    absErr := math.Abs(a.Value)*b.AbsErr + math.Abs(b.Value)*a.AbsErr + rounding
    return BoundedFloat{Value: product, AbsErr: absErr}
}
```

---

## Security

### Float in Authorization Logic

```go
// CRITICAL: Never use float comparison for authorization
// VULNERABLE:
func canWithdraw(balance, amount float64) bool {
    return balance >= amount // float >= float — imprecise!
}

// SAFE: use integer comparison (cents)
func canWithdrawCents(balanceCents, amountCents int64) bool {
    return balanceCents >= amountCents // exact
}

// Float-to-int conversion security:
// VULNERABLE: large float overflows int
func unsafeToInt(f float64) int {
    return int(f) // if f > math.MaxInt64, result is undefined/negative
}

// SAFE:
func safeToInt64(f float64) (int64, error) {
    const maxSafe = float64(math.MaxInt64)
    const minSafe = float64(math.MinInt64)
    if math.IsNaN(f) || math.IsInf(f, 0) {
        return 0, fmt.Errorf("non-finite float: %v", f)
    }
    if f > maxSafe || f < minSafe {
        return 0, fmt.Errorf("float %v out of int64 range", f)
    }
    return int64(f), nil
}
```

---

## Performance Optimization

### Vectorization-Friendly Code

```go
// Go compiler CAN vectorize this pattern (SIMD)
func sumSlice(vals []float64) float64 {
    sum := 0.0
    for _, v := range vals {  // simple range, no branches
        sum += v
    }
    return sum
}

// This CANNOT be vectorized (branch in loop)
func conditionalSum(vals []float64) float64 {
    sum := 0.0
    for _, v := range vals {
        if v > 0 {
            sum += v  // branch prevents SIMD
        }
    }
    return sum
}
```

### Float32 for Large Datasets

```go
// When processing millions of sensor readings:
// float32 uses half the memory → better cache utilization

type SensorBatch struct {
    Values []float32 // 4 bytes each, 1M readings = 4MB (fits in L3 cache)
}

// vs float64: 8MB, may cause cache misses in inner loops
```

### Avoiding Repeated math.Sqrt

```go
// Compare distances without sqrt (use squared distances)
func closestPoint(points []Point, target Point) Point {
    minDistSq := math.MaxFloat64
    var closest Point
    for _, p := range points {
        dx := p.X - target.X
        dy := p.Y - target.Y
        distSq := dx*dx + dy*dy // no sqrt needed for comparison!
        if distSq < minDistSq {
            minDistSq = distSq
            closest = p
        }
    }
    return closest
}
```

---

## Metrics

| Metric | Value |
|--------|-------|
| float64 add latency | ~1 cycle (pipelined) |
| float64 mul latency | ~4 cycles |
| float64 div latency | ~10-20 cycles |
| float64 sqrt latency | ~15-20 cycles |
| math.Sin latency | ~50-100 cycles |
| float32 SIMD width (AVX2) | 8 at once |
| float64 SIMD width (AVX2) | 4 at once |
| Kahan vs naive overhead | ~2x more ops |

---

## Debugging Guide

### Production Float Bug Checklist

1. **Print at full precision**: `fmt.Printf("%.20g\n", val)`
2. **Check for NaN propagation**: Add `math.IsNaN` assertions at stage boundaries
3. **Verify operation order is deterministic**: same input → same output across runs
4. **Use `math.Float64bits`** to inspect exact bit pattern
5. **Test with edge inputs**: 0, -0, MaxFloat64, SmallestNonzeroFloat64, NaN, Inf

```go
// Production debug helper
func DebugFloat(label string, f float64) {
    bits := math.Float64bits(f)
    sign := bits >> 63
    exp := int64((bits>>52)&0x7FF) - 1023
    mantissa := bits & ((1<<52)-1)
    log.Printf("%s: %v (sign=%d exp=%d mantissa=%016x bits=%064b)",
        label, f, sign, exp, mantissa, bits)
}
```

---

## Edge Cases

### Floating-Point Non-Determinism Across CPUs

```go
// Different CPUs may reorder operations in FP pipelines
// Solution: use strict IEEE 754 mode (Go does this by default)
// NEVER use unsafe FP optimizations

// Subnormal performance cliff
tiny := math.SmallestNonzeroFloat64
result := 0.0
for i := 0; i < 1000000; i++ {
    result += tiny  // subnormal arithmetic is 10-100x slower on some CPUs!
}
// Fix: if values can be subnormal, consider flushing to zero or using larger scale
```

### Float Comparison in Sorting

```go
// sort.Float64s uses < which is WRONG for NaN
// sort.Float64s([]float64{1.0, math.NaN(), 2.0}) // unpredictable result

// Go 1.21+ provides slices.Sort which handles NaN correctly:
import "slices"
vals := []float64{1.0, math.NaN(), 2.0, math.Inf(1)}
slices.Sort(vals) // NaN goes to end, -Inf to start, +Inf before NaN
```

---

## Postmortems

### Real-World Float Bug: Trading System Loss

**Incident**: A trading system accumulated fractional-cent errors in position calculations. Over 10 million trades, the cumulative error reached $15,000.

**Root cause**: Used `float64` to track position values. Each trade introduced ~1e-13 relative error. 10^7 trades × 10^5 dollar positions × 1e-13 error/trade = $10,000 error.

**Fix**: Switched to `int64` (cent-based) arithmetic throughout. Zero error.

**Lesson**: Even float64's 15-digit precision is insufficient when you need EXACT arithmetic over millions of operations.

---

### Real-World Float Bug: Coordinate Precision

**Incident**: A mapping service showed all customers in the same city block.

**Root cause**: GPS coordinates were stored as `float32`. At latitude 40°, `float32` has ~5-meter precision. The system was supposed to show 1-meter precision.

**Fix**: Switched coordinate storage to `float64` (11-millimeter precision at equator).

**Lesson**: Always verify that chosen float type has sufficient precision for the actual data range.

---

## Common Mistakes

### Mistake: Assuming Stable Sorting with floats

```go
// sort.Stable on floats with equal values (by value): correct
// sort.Stable on floats with NaN: behavior undefined
// Always handle NaN before sorting
```

### Mistake: Float in Protocol Buffers without Care

```go
// Protobuf float (float32) loses precision for coordinates
// Use double (float64) in .proto files for geographic data
// message Location {
//   float lat = 1;   // WRONG for precise GPS
//   double lat = 1;  // CORRECT
// }
```

---

## Tricky Points

### Signed Zero Semantics

```go
negZero := -0.0
posZero := 0.0
fmt.Println(negZero == posZero)   // true
fmt.Println(1/negZero)            // -Inf
fmt.Println(1/posZero)            // +Inf
fmt.Println(math.Signbit(negZero)) // true — only way to detect -0
```

### Float to String and Back is Not Exact

```go
f := 0.1
s := fmt.Sprintf("%v", f)   // "0.1"
f2, _ := strconv.ParseFloat(s, 64)
fmt.Println(f == f2)         // true — Go uses round-trip format by default
// But with other formats:
s2 := fmt.Sprintf("%.5f", f)  // "0.10000"
f3, _ := strconv.ParseFloat(s2, 64)
fmt.Println(f == f3)          // may be false
```

---

## Comparison

| Property | float64 (Go) | BigDecimal (Java) | decimal.Decimal (Go) | big.Float (Go) |
|----------|-------------|-------------------|---------------------|----------------|
| Exact decimal | No | Yes | Yes | No |
| Speed | Very fast | Slow (10-100x) | Slow | Very slow |
| Memory | 8 bytes | ~100 bytes | Variable | Variable |
| Standard ops | +,-,*,/ | +,-,*,/ | +,-,*,/ | +,-,*,/ |
| Use case | Science/ML | Finance | Finance | High-precision |

---

## Test

1. What is the error bound on a single IEEE 754 float64 addition?
   - **0.5 ULP** ✓

2. Why is `(a+b)+c ≠ a+(b+c)` for floats?
   - **Rounding occurs at each step; different groupings round differently** ✓

3. What is the performance impact of subnormal floats?
   - **10-100x slower than normal floats on most CPUs** ✓

4. What algorithm should you use for summing a million floats accurately?
   - **Kahan or Neumaier compensated summation** ✓

---

## Tricky Questions

**Q: Go float arithmetic is deterministic — why can the same program give different results on different machines?**
A: Go is IEEE 754 strict, but the compiler may choose different operation orderings for optimization (within IEEE 754 rules). Transcendental functions (`sin`, `log`) may have different last-bit accuracy across platforms. Use explicit ordering and avoid transcendentals in reproducibility-critical paths.

**Q: A `float64` can represent all integers up to 2^53. What happens to `float64(1<<53 + 1)`?**
A: It becomes `float64(1<<53)` because the mantissa has only 52 bits — `1<<53` is the first integer that cannot be represented exactly. The result is the same as `9007199254740992.0`.

---

## Cheat Sheet

```go
// Error analysis
ulp(x) = math.Abs(math.Nextafter(x, math.Inf(1)) - x)
singleOpError ≤ 0.5 * ulp(result)

// Stable algorithms
// Welford's mean:    mean += (x - mean) / count
// Kahan sum:         y=v-c; t=sum+y; c=(t-sum)-y; sum=t
// TwoSum exact:      s=a+b; bv=s-a; av=s-bv; return s, (a-av)+(b-bv)

// Production validation
math.IsNaN(f) || math.IsInf(f, 0)  // check non-finite

// Safe int conversion
f > math.MaxInt64 || f < math.MinInt64  // range check before int64()

// Signed zero
math.Signbit(f)  // detects -0.0

// Bit inspection
math.Float64bits(f)       // float64 → uint64
math.Float64frombits(b)   // uint64 → float64
```

---

## Summary

At the senior level, floating-point mastery means:
- Understanding IEEE 754 error bounds and using them to design error budgets
- Knowing compensated summation algorithms and when they're worth the overhead
- Making architectural decisions: float64 vs fixed-point vs decimal vs big.Float
- Debugging production float bugs using bit inspection and full-precision printing
- Designing APIs that validate float inputs at system boundaries
- Understanding performance: vectorization, subnormal traps, SIMD width

---

## What You Can Build

- A numerically stable linear algebra library with error bounds
- A financial calculation engine using fixed-point arithmetic
- A distributed aggregation system with consistent cross-node results
- A GPS/coordinate processing library with precision guarantees
- A sensor data pipeline with validated float inputs and Kahan summation

---

## Further Reading

- [Handbook of Floating Point Arithmetic (Muller et al.)](https://www.springer.com/gp/book/9783319765259)
- [Accuracy and Stability of Numerical Algorithms (Higham)](https://epubs.siam.org/doi/book/10.1137/1.9780898718027)
- [Go math package source — study the implementations](https://cs.opensource.google/go/go/+/main:src/math/)
- [IEEE 754-2019 standard](https://ieeexplore.ieee.org/document/8766229)

---

## Related Topics

- `math/big` — arbitrary precision for when float64 isn't enough
- `encoding/json` — float precision loss in JSON unmarshaling
- SIMD in Go via `unsafe` and assembly
- Go compiler optimizations (`-gcflags="-m"`)

---

## Diagrams

### Error Accumulation: Naive vs Kahan
```
Naive sum (n=10^6):  error ≈ n × ε × average_value
                              = 10^6 × 2.2e-16 × avg
Kahan sum (n=10^6):  error ≈ ε × total_sum
                              = 2.2e-16 × total   (constant!)

For avg=1.0, n=10^6:
  Naive error: ~2.2e-10
  Kahan error: ~2.2e-16  (1 million times better!)
```

### Float64 Precision by Magnitude
```
Value range      Absolute precision
1e-300           ~2.2e-316   (subnormal: reduced precision)
1e-15            ~2.2e-31
1.0              ~2.2e-16
1e9              ~1.2e-7
1e15             ~0.24
1e16             ~2.0        (integers > 2^53 lose precision)
1e18             ~256.0
```
