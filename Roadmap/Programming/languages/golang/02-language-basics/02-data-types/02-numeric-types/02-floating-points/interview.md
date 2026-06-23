# Floating Points in Go — Interview Questions

## Table of Contents
1. [Junior Level (5–7 Questions)](#junior-level)
2. [Middle Level (5–7 Questions)](#middle-level)
3. [Senior Level (5–7 Questions)](#senior-level)
4. [Scenario-Based (3–5 Questions)](#scenario-based)
5. [FAQ (3–5 Questions)](#faq)

---

## Junior Level

### Q1: What are the two floating-point types in Go, and what is the default?

**Answer:**

Go has `float32` and `float64`.

- `float32`: 32-bit IEEE 754 single precision, ~7 significant decimal digits
- `float64`: 64-bit IEEE 754 double precision, ~15 significant decimal digits

The **default** is `float64`. When you write `x := 3.14`, Go infers `float64`. You should almost always use `float64` unless you have a specific memory constraint.

```go
x := 3.14        // inferred as float64
var y float32 = 3.14  // explicitly float32
```

---

### Q2: What is the zero value of a floating-point variable in Go?

**Answer:**

The zero value is `0.0` (which prints as `0` in Go). This applies to both `float32` and `float64`.

```go
var f float64
fmt.Println(f)        // 0
fmt.Println(f == 0.0) // true
```

---

### Q3: Why does `0.1 + 0.2 == 0.3` evaluate to `false` in Go?

**Answer:**

Because floating-point numbers are represented in binary (base-2), and most decimal fractions (like 0.1, 0.2, 0.3) cannot be represented exactly in binary — just like 1/3 cannot be represented exactly in decimal.

`0.1` is stored as `0.1000000000000000055511151...` and `0.2` as `0.2000000000000000111022302...`. Their sum is `0.30000000000000004`, which is not equal to the float64 representation of `0.3`.

```go
fmt.Println(0.1 + 0.2)         // 0.30000000000000004
fmt.Println(0.1 + 0.2 == 0.3)  // false

// Correct comparison using epsilon:
import "math"
const epsilon = 1e-9
fmt.Println(math.Abs((0.1+0.2)-0.3) < epsilon) // true
```

---

### Q4: What are `+Inf`, `-Inf`, and `NaN` in Go floats?

**Answer:**

- `+Inf` (positive infinity): result of dividing a positive number by zero, or overflow
- `-Inf` (negative infinity): result of dividing a negative number by zero
- `NaN` (Not a Number): result of invalid operations like `0.0/0.0` or `math.Sqrt(-1)`

```go
import "math"

zero := 0.0
fmt.Println(1.0 / zero)    // +Inf
fmt.Println(-1.0 / zero)   // -Inf
fmt.Println(0.0 / zero)    // NaN

posInf := math.Inf(1)
negInf := math.Inf(-1)
nan := math.NaN()

fmt.Println(math.IsNaN(nan))       // true
fmt.Println(nan == nan)            // false! NaN != NaN
fmt.Println(math.IsInf(posInf, 1)) // true
```

---

### Q5: How do you safely compare two floating-point numbers in Go?

**Answer:**

Never use `==` for float comparison. Use an epsilon (small tolerance value):

```go
import "math"

const epsilon = 1e-9

func almostEqual(a, b float64) bool {
    return math.Abs(a-b) < epsilon
}

// Usage
if almostEqual(0.1+0.2, 0.3) {
    fmt.Println("approximately equal") // prints!
}
```

For large numbers, a relative epsilon is better:

```go
func relativeEqual(a, b, relTol float64) bool {
    return math.Abs(a-b) <= relTol * math.Max(math.Abs(a), math.Abs(b))
}
```

---

### Q6: How do you format a float to 2 decimal places in Go?

**Answer:**

Use `fmt.Sprintf` or `fmt.Printf` with the `%.2f` verb:

```go
x := 3.14159
fmt.Printf("%.2f\n", x)           // "3.14"
s := fmt.Sprintf("%.2f", x)       // string "3.14"
fmt.Printf("%8.2f\n", x)          // "    3.14" (right-aligned, width 8)
```

For conversion from string to float:

```go
val, err := strconv.ParseFloat("3.14", 64)
if err != nil {
    // handle error
}
```

---

### Q7: What are the `math.Floor`, `math.Ceil`, and `math.Round` functions?

**Answer:**

```go
import "math"

x := 3.7
math.Floor(x)  // 3.0 — round toward -infinity (always down)
math.Ceil(x)   // 4.0 — round toward +infinity (always up)
math.Round(x)  // 4.0 — round to nearest, ties away from zero
math.Trunc(x)  // 3.0 — truncate decimal part (toward zero)

// Negative numbers:
y := -3.7
math.Floor(y)  // -4.0
math.Ceil(y)   // -3.0
math.Round(y)  // -4.0
math.Trunc(y)  // -3.0
```

---

## Middle Level

### Q8: What is catastrophic cancellation and how do you avoid it?

**Answer:**

Catastrophic cancellation is the severe loss of precision when subtracting two nearly equal floating-point numbers.

Example:
```go
a := 1.0000000001
b := 1.0000000000
diff := a - b
// Expected: 1e-10
// Actual: may be 9.99...e-11 or similar — only ~1 correct digit!
```

All the significant digits cancel out, leaving only noise.

**How to avoid:**
1. Reformulate the computation to avoid subtraction of nearly-equal values
2. Use different algorithmic approaches (e.g., Welford's algorithm for mean/variance instead of `sum_x_squared - sum_x^2/n`)
3. Use compensated algorithms

```go
// BAD: variance via two-pass (catastrophic cancellation)
func badVariance(data []float64) float64 {
    n := float64(len(data))
    sumX, sumX2 := 0.0, 0.0
    for _, x := range data {
        sumX += x
        sumX2 += x * x
    }
    return sumX2/n - (sumX/n)*(sumX/n) // can give negative result due to cancellation!
}

// GOOD: Welford's online algorithm
func goodVariance(data []float64) float64 {
    var mean, M2 float64
    for i, x := range data {
        delta := x - mean
        mean += delta / float64(i+1)
        M2 += delta * (x - mean)
    }
    return M2 / float64(len(data)-1)
}
```

---

### Q9: When should you use `float32` instead of `float64`?

**Answer:**

Use `float32` when:
1. **Memory is the bottleneck**: Large arrays of floats (ML model weights, image data, sensor arrays) — `float32` uses half the memory → better cache utilization → better performance
2. **GPU/graphics**: GPUs natively work with 32-bit floats; using `float32` avoids costly conversions
3. **Interfacing with C/hardware**: Some APIs require `float32` (OpenGL, audio APIs)
4. **The precision is sufficient**: ~7 decimal digits is enough for your use case

Use `float64` for everything else. On 64-bit CPUs, `float64` is often the same speed as `float32`.

```go
// ML use case: trade precision for memory
type NeuralNet struct {
    Weights []float32 // 1M weights × 4 bytes = 4MB (fits in L3 cache)
    // vs float64: 8MB (may not fit)
}
```

---

### Q10: What is the Kahan summation algorithm and why is it needed?

**Answer:**

Kahan summation reduces the accumulated floating-point error when summing many values.

**The problem**: Each addition introduces a rounding error. After `n` additions, the total error is O(n × ε × value).

**Kahan solution**: Track the rounding error and compensate for it in the next iteration.

```go
// Naive: error grows with n
func naiveSum(vals []float64) float64 {
    sum := 0.0
    for _, v := range vals {
        sum += v
    }
    return sum
}

// Kahan: error is constant (O(ε × total), independent of n)
func kahanSum(vals []float64) float64 {
    sum := 0.0
    c := 0.0  // compensation term
    for _, v := range vals {
        y := v - c          // compensated value
        t := sum + y        // sum + compensated value
        c = (t - sum) - y  // new compensation
        sum = t
    }
    return sum
}
```

Use it when:
- Summing many (millions) of floating-point values
- Values have very different magnitudes
- Accuracy is more important than speed

---

### Q11: How should you handle money/currency in Go? Why not float?

**Answer:**

**Never use float for money.** Floating-point rounding errors accumulate and can cause incorrect calculations.

```go
// WRONG: float accumulates errors
price := 0.10
total := 0.0
for i := 0; i < 10; i++ {
    total += price
}
fmt.Println(total) // 1.0000000000000002 — NOT 1.00!
```

**Correct approaches:**

**Option 1: Integer cents (simplest)**
```go
// Store all amounts as integer cents
type Cents int64

func (c Cents) String() string {
    return fmt.Sprintf("$%d.%02d", int64(c)/100, int64(c)%100)
}

price := Cents(1099)  // $10.99
tax := Cents(88)      // $0.88 (8% of $10.99, rounded)
total := price + tax  // Cents(1187) = $11.87 — EXACT
```

**Option 2: `shopspring/decimal` package**
```go
import "github.com/shopspring/decimal"
price := decimal.NewFromString("10.99")
taxRate := decimal.NewFromFloat(0.08)
tax := price.Mul(taxRate).Round(2)
total := price.Add(tax)
fmt.Println(total) // 11.87 — exact
```

---

### Q12: What happens when you use a float as a map key?

**Answer:**

It compiles and runs, but has dangerous semantics:

```go
m := map[float64]string{}

// NaN key is a permanent bug
m[math.NaN()] = "nan"
fmt.Println(m[math.NaN()]) // "" — NaN != NaN, so key is never found!
fmt.Println(len(m))         // 1 — the entry IS there, just unreachable

// -0.0 and 0.0 have the same key
m[-0.0] = "neg zero"
m[0.0] = "pos zero"  // OVERWRITES the previous entry!
fmt.Println(len(m))   // 1, not 2
```

**Best practice**: Never use `float` as map keys. Use strings (formatted floats) or other types.

---

### Q13: What is the difference between `strconv.FormatFloat` format options `'f'`, `'e'`, and `'g'`?

**Answer:**

```go
f := 1234.5678

strconv.FormatFloat(f, 'f', 2, 64)  // "1234.57"   — decimal notation
strconv.FormatFloat(f, 'e', 2, 64)  // "1.23e+03"  — scientific notation
strconv.FormatFloat(f, 'g', -1, 64) // "1234.5678" — shortest representation

// 'f': fixed-point notation, precision = decimal places
// 'e': scientific notation, precision = digits after decimal in mantissa
// 'g': 'e' for large exponents, 'f' for others; precision = significant digits
//      -1 means use minimum digits to represent the value uniquely
// 'G': same as 'g' but uses 'E'
// 'b': binary notation
// 'x': hexadecimal notation
```

---

## Senior Level

### Q14: How does Go implement float comparison at the assembly level, and how does it handle NaN?

**Answer:**

Go uses the `UCOMISD` (Unordered Compare Scalar Double) instruction on amd64, not `COMISD`.

The difference:
- `COMISD`: raises an invalid floating-point exception if either operand is NaN
- `UCOMISD`: never raises an exception; sets CF=1, ZF=1, PF=1 (parity flag) for NaN comparisons

When checking `a > b`, the compiler generates:
```asm
UCOMISD b, a    ; sets ZF, CF, PF based on comparison
SETHI   AL      ; set result = 1 if "above" (a > b, both normal)
; If either is NaN, UCOMISD sets PF=1, and SETHI = 0
; So NaN comparisons always return false — consistent with IEEE 754
```

This is why `NaN > 5.0` is `false`, `NaN < 5.0` is `false`, and `NaN == NaN` is `false`.

---

### Q15: What is the performance impact of subnormal (denormalized) floating-point numbers?

**Answer:**

Subnormal numbers are values with exponent 0 (very close to zero: smaller than ~2.2e-308 for float64). They have reduced precision and are handled by CPU microcode rather than dedicated hardware:

- Normal float64 operations: ~0.5-4 cycles
- Subnormal float64 operations: ~150-500 cycles (10-100× slower)

This is a production performance trap in machine learning and signal processing.

**Detection and mitigation:**

```go
const minNormal = 2.2250738585072014e-308

// Detect subnormal
func isSubnormal(f float64) bool {
    return f != 0 && math.Abs(f) < minNormal
}

// Flush subnormals to zero (for performance, at the cost of accuracy)
func flushToZero(vals []float64) {
    for i, v := range vals {
        if isSubnormal(v) {
            vals[i] = 0.0
        }
    }
}

// In C/C++, you can set FTZ+DAZ bits in MXCSR to do this automatically.
// Go provides no way to do this without unsafe + assembly.
```

---

### Q16: Explain the two-sum error-free transform and its applications.

**Answer:**

The `TwoSum` algorithm computes `a + b` and returns the result AND the exact rounding error, with no loss of information:

```go
// TwoSum: s + err = a + b exactly (in exact arithmetic)
func TwoSum(a, b float64) (s, err float64) {
    s = a + b
    bVirtual := s - a
    aVirtual := s - bVirtual
    bRoundoff := b - bVirtual
    aRoundoff := a - aVirtual
    err = aRoundoff + bRoundoff
    return
}
```

This is exact: `a + b = s + err` with no approximation.

**Applications:**
1. **Compensated summation (Kahan)**: uses `TwoSum` internally to track error
2. **Double-double arithmetic**: use two float64s to get ~30 digits of precision
3. **Error-free dot product**: compute inner products with full accuracy

```go
// Double-double: represents a number as (hi, lo) where value = hi + lo
type DoubleDouble struct {
    Hi, Lo float64
}

func (a DoubleDouble) Add(b DoubleDouble) DoubleDouble {
    s, e := TwoSum(a.Hi, b.Hi)
    e += a.Lo + b.Lo
    s2, e2 := TwoSum(s, e)
    return DoubleDouble{s2, e2}
}
// Effectively gives ~30 significant decimal digits using two float64s
```

---

### Q17: How does Go's floating-point behavior differ from C/C++ with `-ffast-math`?

**Answer:**

C/C++ with `-ffast-math` allows the compiler to:
- Assume no NaN or Inf occur
- Reorder floating-point operations (break IEEE 754 associativity guarantees)
- Replace `x/2.0` with `x * 0.5` (may differ for subnormals)
- Merge `a*b + c` into FMA automatically
- Treat NaN and Inf as errors (skip special-case code)

**Go never does this.** Go is always in strict IEEE 754 mode:
- All NaN/Inf special cases are handled
- Operations are NOT reordered for performance
- FMA is only used via explicit `math.FMA`

**Result:**
- Go: slower but reproducible, portable, IEEE 754 compliant
- C with `-ffast-math`: faster (can be 2-10×) but results may differ across optimization levels or platforms

This is a deliberate Go design decision: correctness over performance.

---

### Q18: What is the risk of using `int(floatVal)` for type conversion, and what is the safe way?

**Answer:**

`int(floatVal)` (and `int64(floatVal)`) uses the `CVTTSD2SI` instruction, which truncates to zero. If the float value is outside the integer range, the instruction returns `0x8000000000000000` (which is `math.MinInt64`) — **silently**, with no panic.

```go
f := math.MaxFloat64
i := int64(f)
fmt.Println(i) // -9223372036854775808 (MinInt64) — WRONG, SILENT BUG!

f2 := -1e30
i2 := int64(f2)
fmt.Println(i2) // -9223372036854775808 — same wrong value!
```

**Safe conversion:**
```go
func safeInt64(f float64) (int64, error) {
    if math.IsNaN(f) || math.IsInf(f, 0) {
        return 0, fmt.Errorf("non-finite float: %v", f)
    }
    if f > float64(math.MaxInt64) || f < float64(math.MinInt64) {
        return 0, fmt.Errorf("float %v out of int64 range", f)
    }
    return int64(f), nil
}
```

---

### Q19: How do you ensure consistent floating-point results across distributed systems in Go?

**Answer:**

Challenge: Different nodes may process data in different orders, causing different float results (due to non-associativity).

Strategies:

1. **Sort before reducing**: Sort all values before summing/multiplying to ensure consistent order
2. **Use compensated summation**: Kahan/Neumaier gives more accurate results regardless of order
3. **Use integer arithmetic** where exact results are needed
4. **Use explicit algorithm with defined order**: Don't use goroutine-parallel sums for reproducibility-critical calculations

```go
type ReproducibleAggregator struct {
    values []float64
}

func (r *ReproducibleAggregator) Add(v float64) {
    r.values = append(r.values, v)
}

// Same result regardless of insertion order
func (r *ReproducibleAggregator) Sum() float64 {
    sorted := make([]float64, len(r.values))
    copy(sorted, r.values)
    sort.Float64s(sorted) // deterministic order

    // Kahan on sorted values
    sum, c := 0.0, 0.0
    for _, v := range sorted {
        y := v - c
        t := sum + y
        c = (t - sum) - y
        sum = t
    }
    return sum
}
```

---

### Q20: What is `math.FMA` and when should you use it?

**Answer:**

`math.FMA(a, b, c)` computes `a*b + c` as a **single operation** with a single rounding step, instead of two separate operations (multiply, then add) with two roundings.

```go
import "math"

// Standard: two roundings
result1 := a*b + c  // rounding after *, rounding after +

// FMA: one rounding
result2 := math.FMA(a, b, c)  // rounding only at the end

// On hardware with FMA support (Intel Haswell+, ARM64): single instruction
// On hardware without: emulated in software (slower but still single-rounded)
```

**When to use:**
1. **Polynomial evaluation**: Horner's method with FMA is faster and more accurate
2. **Dot products**: each term `a[i] * b[i]` fed into FMA
3. **When you explicitly want single-rounding semantics** for numerical analysis

```go
// Polynomial: p(x) = a + b*x + c*x^2 evaluated with Horner's + FMA
func polyFMA(x, a, b, c float64) float64 {
    return math.FMA(math.FMA(c, x, b), x, a)
}
// More accurate than: a + b*x + c*x*x
```

---

## Scenario-Based

### Q21: A microservice calculates shipping costs. After 1 million transactions, the total cost is off by $50. What is the likely cause and fix?

**Answer:**

**Likely cause**: Floating-point accumulation error. Each float64 addition introduces up to 2.2e-16 relative error. Over 1 million transactions with prices around $10:

`Error ≈ n × ε × average_value = 10^6 × 2.2e-16 × $10 = $2.2e-9`

That's too small to account for $50. More likely causes:
1. **Wrong rounding mode**: truncating to 2 decimal places instead of rounding
2. **Float arithmetic with tax rates**: `price * 1.08` in float vs exact decimal
3. **Currency conversion with float**: loses cents

**Fix investigation:**
```go
// Debug: print full precision to find where error enters
fmt.Printf("%.20f\n", price)
fmt.Printf("%.20f\n", price * taxRate)

// Fix: use integer cents
type PriceCents int64
func (p PriceCents) ApplyTax(rateBPS int64) PriceCents {
    return PriceCents(int64(p)*rateBPS/10000 + int64(p))
}
```

---

### Q22: You're writing a physics simulation. After 1000 time steps, the simulation diverges. How do you debug this?

**Answer:**

1. **Check for NaN propagation**: Add validation at each step
```go
func validateState(state PhysicsState, step int) error {
    for _, v := range state.Velocities {
        if math.IsNaN(v) || math.IsInf(v, 0) {
            return fmt.Errorf("invalid velocity at step %d: %v", step, v)
        }
    }
    return nil
}
```

2. **Check time step stability**: Explicit integrators (Euler) require `dt < 2/ω` for stability
3. **Inspect accumulated error**: Compare float32 vs float64 results — large divergence suggests insufficient precision
4. **Use print at full precision** to find when values first become unreasonable
5. **Use energy conservation as invariant**: total energy should be approximately constant

---

### Q23: A Go program parsing JSON from an API is getting wrong user IDs. What could be wrong?

**Answer:**

**Root cause**: JSON numbers are unmarshaled to `float64` by default when using `map[string]interface{}`. Large IDs lose precision:

```go
// JSON: {"id": 9007199254740993}
var data map[string]interface{}
json.Unmarshal(jsonBytes, &data)
id := data["id"].(float64)
fmt.Println(int64(id)) // 9007199254740992 — WRONG (off by 1!)
// float64 can only represent integers up to 2^53 exactly
```

**Fix:**
```go
// Option 1: Use a typed struct
type User struct {
    ID int64 `json:"id"`
}

// Option 2: Use json.Number for large integers
var data map[string]json.Number
json.Unmarshal(jsonBytes, &data)
id, _ := data["id"].Int64() // exact
```

---

### Q24: You need to implement a function that checks if a floating-point value is a valid probability (between 0 and 1 inclusive). Write it.

**Answer:**

```go
import (
    "fmt"
    "math"
)

// IsValidProbability returns true if p is a valid probability value [0, 1].
// Returns false for NaN, Inf, or values outside [0, 1].
func IsValidProbability(p float64) bool {
    return !math.IsNaN(p) && !math.IsInf(p, 0) && p >= 0.0 && p <= 1.0
}

// ValidateProbability returns an error if p is not a valid probability.
func ValidateProbability(name string, p float64) error {
    if math.IsNaN(p) {
        return fmt.Errorf("%s is NaN", name)
    }
    if math.IsInf(p, 0) {
        return fmt.Errorf("%s is Inf", name)
    }
    if p < 0.0 || p > 1.0 {
        return fmt.Errorf("%s = %v is not in [0, 1]", name, p)
    }
    return nil
}

// Usage
probs := []float64{0.5, 1.1, math.NaN(), -0.1, 0.0, 1.0}
for _, p := range probs {
    if err := ValidateProbability("p", p); err != nil {
        fmt.Println("Invalid:", err)
    } else {
        fmt.Printf("Valid: %.2f\n", p)
    }
}
```

---

### Q25: A team member suggests using `float32` for all database coordinates to save storage. How do you evaluate this?

**Answer:**

**Analysis:**

`float32` precision at different coordinate scales:
- Latitude/longitude range: [-180, 180]
- `float32` machine epsilon: ~1.19e-7
- Absolute precision: `180 * 1.19e-7 = 2.14e-5` degrees

At equator: 1 degree longitude ≈ 111 km
Precision: `2.14e-5 × 111000 = 2.4 meters`

If 2.4-meter precision is sufficient for the use case → `float32` is acceptable.

For:
- City-level: `float32` is fine (precision far exceeds what's needed)
- Street navigation: borderline (2.4m error can misroute)
- Indoor positioning / survey: `float64` required (11mm precision)

**Recommendation:**
```go
// float32: 2-3 meter accuracy (acceptable for many apps)
type CoarseLocation struct {
    Lat, Lng float32
}

// float64: millimeter accuracy (required for surveys, precise navigation)
type PreciseLocation struct {
    Lat, Lng float64
}

// Database storage: use DECIMAL(10,7) in SQL for exact decimal storage
// Or store as integer microDegrees: 41.123456° → 41123456 (int32)
```

---

## FAQ

### FAQ 1: Should I always use `float64`?

**Yes, in almost all cases.** Use `float32` only when:
- You have millions of floats in memory and memory bandwidth is the bottleneck
- Your interface requires `float32` (GPU APIs, graphics, some hardware interfaces)
- You've benchmarked and confirmed `float32` provides measurable benefit

For all other code, `float64` is the right choice. It's the same speed on 64-bit hardware, more precise, and the `math` package returns `float64`.

---

### FAQ 2: What is `math.NaN()` vs `math.IsNaN()`?

```go
// math.NaN() creates a NaN value
nan := math.NaN()

// math.IsNaN() checks if a value is NaN
// NEVER compare nan == math.NaN() — that would be false!
fmt.Println(nan == math.NaN())  // false
fmt.Println(math.IsNaN(nan))    // true — ALWAYS use this

// Why? NaN != NaN by IEEE 754 definition.
// The only reliable way to check is math.IsNaN().
```

---

### FAQ 3: Can I use floats in struct tags or const declarations in Go?

```go
// Const: yes, with arbitrary precision
const Pi = 3.14159265358979323846264338327950288

// Struct tags: no (struct tags are strings)
type Point struct {
    X float64 `json:"x"`  // tag is a string "json:\"x\""
}

// iota with floats: no, iota only works with integer-typed constants
// But you can use float constants in const blocks:
const (
    Small  = 0.001
    Medium = 0.01
    Large  = 0.1
)
```

---

### FAQ 4: Why does `fmt.Println(0.1 + 0.2)` print `0.30000000000000004` and not something shorter?

Go uses the shortest decimal representation that uniquely identifies the float64 value. `0.30000000000000004` is the shortest decimal string that, when parsed back, gives the exact same float64 bits as the result of `0.1 + 0.2`.

```go
fmt.Println(0.1 + 0.2)           // 0.30000000000000004 (shortest unique)
fmt.Printf("%.1f\n", 0.1+0.2)   // 0.3 (rounded to 1 decimal)
fmt.Printf("%.20f\n", 0.1+0.2)  // 0.30000000000000004441 (full precision)
```

---

### FAQ 5: What package should I use for financial calculations in Go?

**Recommended packages:**
1. **`github.com/shopspring/decimal`** — the most popular, production-tested
   - Exact decimal arithmetic up to 28 significant digits
   - Supports JSON marshaling/unmarshaling
   - Used in many production financial systems

2. **`math/big`** — built-in, but verbose API
   - `big.Int` for exact integer arithmetic
   - `big.Float` for arbitrary-precision floats (not decimal-exact)
   - `big.Rat` for exact rational numbers

3. **Integer cents** — simplest for basic money math
   - Store as `int64` (cents, cents, basis points)
   - Zero external dependencies

```go
// shopspring/decimal example
import "github.com/shopspring/decimal"
price, _ := decimal.NewFromString("10.99")
tax := price.Mul(decimal.NewFromFloat(0.0875)).Round(2)
total := price.Add(tax)
fmt.Println(total.String()) // "11.95"
```
