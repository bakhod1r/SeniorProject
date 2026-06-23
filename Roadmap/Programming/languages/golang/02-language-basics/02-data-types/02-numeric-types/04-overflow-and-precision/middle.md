# Go Overflow and Precision — Middle Level

## 1. Introduction

At the middle level, you stop being surprised by overflow and precision. You **design APIs** that avoid the trap (money types, validated conversions), reach for the **right standard-library tool** when you need it (`math/bits`, `math/big`), and choose **third-party decimal libraries** when the requirement is real money or financial calculation. You also know how to test for overflow without producing it, and how to read and reason about floats at the bit level.

---

## 2. Prerequisites
- Junior-level overflow / precision material
- `math` package basics
- `math/bits`, `math/big`, `encoding/binary`
- IEEE 754 fundamentals
- Decimal libraries (`shopspring/decimal`, `cockroachdb/apd`)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Saturating arithmetic | After overflow, clamp at the type's max/min |
| Checked arithmetic | Operations that return a flag on overflow |
| Big integer | `*big.Int`, arbitrary precision |
| Big float | `*big.Float`, arbitrary mantissa precision |
| Big rational | `*big.Rat`, exact rationals |
| Decimal | Library type for base-10 arithmetic |
| Subnormal | A float in the underflow range with reduced precision |
| ULP | Unit in the Last Place; one float gap |
| Kahan summation | An algorithm to reduce float accumulation error |

---

## 4. Core Concepts

### 4.1 `math/bits` for Overflow-Aware Primitives

The `math/bits` package exposes functions that perform arithmetic and report overflow:

```go
package main

import (
    "fmt"
    "math/bits"
)

func main() {
    a := uint64(0xffff_ffff_ffff_fff0)
    sum, carry := bits.Add64(a, 0x20, 0)
    fmt.Println(sum, carry) // 16 1   (carry == 1 means overflow)

    p, q := bits.Mul64(1<<40, 1<<40)
    fmt.Println(p, q)       // 1099511627776 0   (no overflow)
    p, q = bits.Mul64(1<<60, 1<<60)
    fmt.Println(p, q)       // ... 0 1152921504606846976 (overflow into upper word)
}
```

`Add64`, `Sub64`, `Mul64`, `Div64` give you the low and high words and a carry/borrow. They're also the building blocks for `math/big` internally.

### 4.2 Signed Overflow Detection

For signed math, you don't have a single bits function but you can layer over the unsigned ones:

```go
func addInt64Checked(a, b int64) (int64, bool) {
    sum := a + b
    if (a > 0 && b > 0 && sum < a) || (a < 0 && b < 0 && sum > a) {
        return 0, false
    }
    return sum, true
}
```

This checks for the two overflow cases: positive + positive overflowing positive, and negative + negative overflowing negative.

### 4.3 `math/big` for Arbitrary Precision

When inputs are unbounded:

```go
package main

import (
    "fmt"
    "math/big"
)

func main() {
    a := new(big.Int)
    a.SetString("123456789012345678901234567890", 10)
    b := new(big.Int)
    b.SetString("987654321098765432109876543210", 10)
    c := new(big.Int).Mul(a, b)
    fmt.Println(c.String())
}
```

Operations:
- `Add`, `Sub`, `Mul`, `Quo`, `Rem`, `Mod`
- Comparisons: `Cmp` returns -1 / 0 / 1
- Conversions: `Int64`, `Uint64`, `String`

`big.Float` is the float counterpart with adjustable precision (specified in mantissa bits). `big.Rat` represents exact rationals like 1/3.

### 4.4 NaN-Safe Comparisons

The standard ordering operators `<`, `<=` return false when an operand is NaN. Sort routines must handle this:

```go
sort.Slice(values, func(i, j int) bool {
    a, b := values[i], values[j]
    if math.IsNaN(a) { return false }
    if math.IsNaN(b) { return true }
    return a < b
})
```

In Go 1.21+, `slices.SortFunc` and `cmp.Compare` provide a NaN-aware ordering.

### 4.5 IsInf

```go
if math.IsInf(x, 1)  { /* +Inf */ }
if math.IsInf(x, -1) { /* -Inf */ }
if math.IsInf(x, 0)  { /* either */ }
```

Sign of 0 means "either direction" — common when guarding against any infinity.

### 4.6 Decimal Libraries

For money math, you almost always want decimal:

```go
import "github.com/shopspring/decimal"

a, _ := decimal.NewFromString("0.1")
b, _ := decimal.NewFromString("0.2")
sum := a.Add(b)
fmt.Println(sum.String()) // "0.3"   (exact)
```

Trade-offs:
- 100x slower than float (typical).
- Heap allocations per operation.
- Exact decimal — no rounding surprises.

`cockroachdb/apd` is similar, with finer control over rounding modes (used in CockroachDB's SQL engine).

### 4.7 When to Use big.Int vs big.Float vs big.Rat

| Need | Type |
|------|------|
| Integer arithmetic with arbitrary range | `big.Int` |
| Float-like arithmetic with adjustable precision | `big.Float` |
| Exact rational like 1/3 | `big.Rat` |
| Money / decimal | use a decimal library, not `big.Float` |

`big.Float` is binary internally — same precision issues as float64 just with more bits. It does NOT solve `0.1 + 0.2 != 0.3`. Use a decimal library for that.

### 4.8 Choosing Float Width

| Use case | Width |
|----------|-------|
| General numeric | float64 |
| GPU shaders, ML inference | float32 |
| Audio / signal | float32 sometimes, float64 for high quality |
| File formats | match the spec (often float32) |
| Money | NEITHER — use decimal |

---

## 5. Real-World Analogies

**A bank ledger** — money is recorded as integer cents (or smaller units like satoshi or wei), never as a float.

**A speedometer that pegs at 200 km/h** — saturating overflow. You know the actual speed is "at least that".

**A label on a 5-digit display** — large numbers can't fit; you need a wider display (`int64`) or scientific notation (`big.Int`).

**A scale that snaps to grams** — float precision: real weight is 1.236547 g but the scale shows 1.236.

---

## 6. Mental Models

### Model 1 — Three Tiers of Numeric Math

```
Tier 1: int / float          — fast, but bounded
Tier 2: math/bits primitives — overflow-aware, still fast
Tier 3: math/big, decimal    — slow, but unbounded / exact
```

Pick the lowest tier that meets your requirements.

### Model 2 — Float as Approximation Pipeline

```
input → snap to nearest float → operations (each snaps) → output
              ε                          ε                ε
```

Each step contributes a rounding error. Long chains accumulate error.

### Model 3 — Money Is Integer

```
$ 12.34   →   1234 cents
$  0.10   →    10 cents
$  0.10   →    10 cents
sum   →    20 cents   →   $0.20
```

No float ever appears. Result is always exact.

---

## 7. Pros & Cons

### `math/bits`

**Pros**: detects overflow without converting to a wider type; building block for portable wide arithmetic.
**Cons**: only unsigned variants are exposed; signed overflow detection requires extra logic.

### `math/big`

**Pros**: arbitrary precision, no overflow.
**Cons**: orders of magnitude slower; allocations.

### Decimal libraries

**Pros**: exact decimal — money-safe.
**Cons**: not in stdlib; ~100x slower than float; allocations.

---

## 8. Use Cases

1. Cryptography — modular arithmetic with `math/big` or carefully designed `uint64` paths.
2. Money / financial — decimal libraries.
3. Counting (potentially large) — `int64` with saturation guard.
4. Hashing — `uint32` / `uint64`, modular arithmetic.
5. ML / numerical — `float64`, with awareness of accumulated error.
6. Time — `time.Time` and `time.Duration` (int64 nanoseconds), not floats.
7. Coordinates / geometry — `float64`, with epsilon comparisons.
8. ID generation — `uint64`, careful about wraparound on long-running services.

---

## 9. Code Examples

### Example 1 — Checked Add

```go
package main

import (
    "errors"
    "fmt"
    "math"
)

var ErrOverflow = errors.New("overflow")

func addInt64(a, b int64) (int64, error) {
    if (b > 0 && a > math.MaxInt64-b) || (b < 0 && a < math.MinInt64-b) {
        return 0, ErrOverflow
    }
    return a + b, nil
}

func main() {
    s, err := addInt64(math.MaxInt64-3, 5)
    fmt.Println(s, err) // 0 overflow
}
```

### Example 2 — `math/bits.Add64`

```go
package main

import (
    "fmt"
    "math/bits"
)

func main() {
    a := uint64(1<<63) | 0xffff
    b := uint64(1<<63)
    sum, carry := bits.Add64(a, b, 0)
    fmt.Println(sum, carry)
}
```

### Example 3 — `math/big`

```go
package main

import (
    "fmt"
    "math/big"
)

func factorial(n int) *big.Int {
    out := big.NewInt(1)
    for i := 2; i <= n; i++ {
        out.Mul(out, big.NewInt(int64(i)))
    }
    return out
}

func main() {
    fmt.Println(factorial(50))
}
```

### Example 4 — Decimal Money

```go
package main

import (
    "fmt"
    "github.com/shopspring/decimal"
)

func main() {
    price, _ := decimal.NewFromString("19.99")
    qty := decimal.NewFromInt(3)
    total := price.Mul(qty)
    fmt.Println(total.String()) // "59.97"
}
```

### Example 5 — Kahan Summation

A trick to reduce float accumulation error:

```go
package main

import "fmt"

func kahanSum(xs []float64) float64 {
    var sum, c float64
    for _, x := range xs {
        y := x - c
        t := sum + y
        c = (t - sum) - y
        sum = t
    }
    return sum
}

func main() {
    xs := make([]float64, 10000)
    for i := range xs { xs[i] = 0.1 }
    naive := 0.0
    for _, x := range xs { naive += x }
    fmt.Println(naive)               // close to 1000, but error
    fmt.Println(kahanSum(xs))        // closer to 1000
}
```

Kahan keeps a running compensation term `c` that captures the rounding error and reapplies it each step.

### Example 6 — Comparing Floats With ULP

```go
package main

import (
    "fmt"
    "math"
)

func equalULP(a, b float64, ulps uint64) bool {
    if math.IsNaN(a) || math.IsNaN(b) { return false }
    if math.Signbit(a) != math.Signbit(b) {
        return a == b // handle ±0
    }
    ai := math.Float64bits(a)
    bi := math.Float64bits(b)
    var diff uint64
    if ai > bi { diff = ai - bi } else { diff = bi - ai }
    return diff <= ulps
}

func main() {
    a := 0.1 + 0.2
    fmt.Println(equalULP(a, 0.3, 4)) // true (within 4 ULPs)
}
```

ULP-based comparison scales with the magnitude — fairer than a fixed epsilon.

### Example 7 — Range-Checked Conversion

```go
package main

import (
    "errors"
    "fmt"
    "math"
)

var ErrRange = errors.New("out of range")

func toInt32(x int64) (int32, error) {
    if x < math.MinInt32 || x > math.MaxInt32 {
        return 0, ErrRange
    }
    return int32(x), nil
}

func main() {
    fmt.Println(toInt32(123))         // 123 nil
    fmt.Println(toInt32(1 << 40))     // 0 out of range
}
```

### Example 8 — `bits.Mul64` for Wide Multiply

```go
package main

import (
    "fmt"
    "math/bits"
)

func main() {
    hi, lo := bits.Mul64(1_000_000_000_000, 1_000_000_000_000)
    fmt.Printf("hi=%x lo=%x\n", hi, lo)
}
```

This is how arbitrary-precision multiplication is built.

---

## 10. Coding Patterns

### Pattern 1 — Validate, Don't Trust

Always range-check user-provided integers before using them as sizes / indices / counts.

### Pattern 2 — Money Type

```go
type Cents int64

func (c Cents) Add(other Cents) Cents { return c + other }
func (c Cents) String() string { ... }
func ParseCents(s string) (Cents, error) { ... }
```

The internal representation is integer; the API hides it.

### Pattern 3 — Saturating Math

```go
func saturatingAdd(a, b int64) int64 {
    if b > 0 && a > math.MaxInt64-b { return math.MaxInt64 }
    if b < 0 && a < math.MinInt64-b { return math.MinInt64 }
    return a + b
}
```

### Pattern 4 — Use big.Int Only at the Boundary

```go
// Inputs are unbounded; convert to big.Int for math; convert back to int64 with check.
result := new(big.Int).Mul(a, b)
if result.IsInt64() {
    return result.Int64(), nil
}
return 0, ErrTooBig
```

### Pattern 5 — Float Equality With Tolerance

```go
func equal(a, b, eps float64) bool {
    return math.Abs(a-b) <= eps*math.Max(1, math.Abs(a))
}
```

Relative tolerance: scales with magnitude.

---

## 11. Clean Code Guidelines

1. Centralize range checks in helpers (`toInt32`, `toUint16`, etc.).
2. Wrap money in a type that hides the representation.
3. Don't sprinkle `float64` through business logic for "currency".
4. Use `math.IsNaN` / `math.IsInf` after any operation that could produce them.
5. Prefer `math/big` over hand-rolled big integer code.
6. Comment WHY you're using `int8` or `uint16` if you do — usually it's a serialization requirement.

---

## 12. Product Use / Feature Example

**A pricing service**:

```go
package pricing

import (
    "github.com/shopspring/decimal"
)

type Price struct {
    Amount   decimal.Decimal
    Currency string
}

func (p Price) Multiply(qty int64) Price {
    return Price{
        Amount:   p.Amount.Mul(decimal.NewFromInt(qty)),
        Currency: p.Currency,
    }
}

func (p Price) Tax(rate decimal.Decimal) Price {
    tax := p.Amount.Mul(rate)
    return Price{Amount: p.Amount.Add(tax), Currency: p.Currency}
}
```

No float in sight. The pricing math is exact.

---

## 13. Error Handling

For operations that can overflow:

```go
type Calc struct {
    err error
}

func (c *Calc) Add(a, b int64) int64 {
    if c.err != nil { return 0 }
    sum, ok := safeAdd(a, b)
    if !ok { c.err = ErrOverflow }
    return sum
}
```

Or use Go 1.21's `errors.Join` to accumulate errors across many operations.

For floats, the result of an overflow is `±Inf`, not an error. Check with `math.IsInf` if you care.

---

## 14. Security Considerations

1. **Length-prefix attacks**: a `uint32` length larger than expected, cast to `int`, can become negative. Always range-check.
2. **Timing attacks via NaN**: NaN comparisons return false; some early-exit code may leak information.
3. **Decimal-to-float in financial APIs**: do not round-trip money through float — use exact decimal end-to-end.
4. **Hash table sizing**: `int` length cast to `uint64` index can wrap; bound sizes explicitly.
5. **`gosec` G701** flags integer overflow conversions; review each finding.

---

## 15. Performance Tips

1. `int64` ops are 1-2 cycles. Hard to beat.
2. `math/bits` ops are 2-5 cycles. Negligible cost for safety.
3. `math/big` ops are 100x-1000x slower; only use for unbounded math.
4. Decimal ops are 50x-100x slower than float; budget accordingly.
5. Float-to-int and int-to-float conversions involve specialized instructions but are not free.
6. Mixing float32 and float64 in the same expression triggers conversions.

---

## 16. Metrics & Analytics

Track overflow incidents:

```go
import "expvar"

var overflowCount = expvar.NewInt("integer.overflow.count")

func addChecked(a, b int64) int64 {
    s, ok := safeAdd(a, b)
    if !ok {
        overflowCount.Add(1)
    }
    return s
}
```

In production, watch for spikes — they often indicate adversarial input.

---

## 17. Best Practices

1. Use `int64` and `float64` by default.
2. Range-check at type boundaries.
3. Use integer cents or a decimal library for money.
4. Use `math/bits` when you need overflow detection without `big`.
5. Use `math/big` for unbounded inputs.
6. Use ULP or relative-epsilon comparison for floats.
7. Test with extreme values (max, min, zero, NaN, Inf).
8. Use `gosec` and `staticcheck` in CI.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — `int(math.MaxFloat64)` Is Implementation-Defined

```go
i := int(math.MaxFloat64) // result varies; in current Go on amd64 you get math.MinInt64.
```

Always range-check the float first.

### Pitfall 2 — Signed Conversion Wrap

```go
var u uint32 = 0xffff_ffff
i := int32(u)
fmt.Println(i) // -1   (top bit reinterpreted as sign)
```

The bits don't change; the interpretation does. This is almost always a logic error.

### Pitfall 3 — Mixing Types

```go
var x int32 = 100
var y int = 200
// x + y       // ERROR: type mismatch
fmt.Println(int(x) + y)
```

Go doesn't auto-widen. You convert explicitly.

### Pitfall 4 — float32 Rounding in Hot Loops

```go
var sum float32
for i := 0; i < 1<<24; i++ {
    sum += 1.0
}
// sum saturates around 16777216 because float32 can't represent 16777217 exactly.
```

The increment becomes invisible past the mantissa precision. Use float64 or accumulate as int.

### Pitfall 5 — `math.Inf(0)` Is a Trick

```go
math.Inf(0) // panics? Actually it returns +Inf.
math.Inf(1)  // +Inf
math.Inf(-1) // -Inf
```

The arg sign chooses direction; 0 is undocumented behavior — don't pass it.

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Use float for money | Use cents or decimal |
| Cast int64 → int32 without check | Range-check first |
| Compare floats with `==` | Use ULP or epsilon |
| Use `math/big` for money | Use a decimal library |
| Use float32 for ML inference inputs that need precision | Use float64 |
| Test for overflow after the fact | Use checked ops |

---

## 20. Common Misconceptions

**Misconception 1**: "`math/big.Float` solves the 0.1 + 0.2 problem."
**Truth**: It's binary-based with more precision; the problem is identical, just at higher precision.

**Misconception 2**: "`int` is fine for monetary cents — it's exact."
**Truth**: It's exact for cents, but you must guard against overflow on aggregation.

**Misconception 3**: "Go's compiler optimizes away overflow checks."
**Truth**: There are no built-in overflow checks. You write them explicitly.

**Misconception 4**: "All floats lose precision."
**Truth**: Only most. Powers of two and some sums are exact. `1.5 + 2.0` is exact in float64.

**Misconception 5**: "Higher precision (float64) makes my code more correct."
**Truth**: Same class of bug; just smaller magnitude. The fix is the right type for the domain (decimal for money, integer for counts).

---

## 21. Tricky Points

1. `math/big.Float` is binary, not decimal.
2. Signed overflow is defined wrap; signed conversion is bit reinterpretation.
3. NaN propagates through almost every op (`NaN + x == NaN`).
4. `+0.0 == -0.0` is true, but `1.0/+0.0 == +Inf` and `1.0/-0.0 == -Inf`.
5. ULP-based comparison handles different magnitudes; epsilon doesn't.
6. `math/bits.Add64` produces an unsigned carry; signed equivalents need manual logic.

---

## 22. Test

```go
package main

import (
    "math"
    "testing"
)

func TestSaturating(t *testing.T) {
    if got := saturatingAdd(math.MaxInt64-2, 5); got != math.MaxInt64 {
        t.Errorf("got %d", got)
    }
}

func TestKahanReducesError(t *testing.T) {
    xs := make([]float64, 100000)
    for i := range xs { xs[i] = 0.1 }
    naive := 0.0
    for _, x := range xs { naive += x }
    kahan := kahanSum(xs)
    if math.Abs(kahan-10000) > math.Abs(naive-10000) {
        t.Errorf("kahan %v naive %v", kahan, naive)
    }
}

func saturatingAdd(a, b int64) int64 {
    if b > 0 && a > math.MaxInt64-b { return math.MaxInt64 }
    if b < 0 && a < math.MinInt64-b { return math.MinInt64 }
    return a + b
}

func kahanSum(xs []float64) float64 {
    var s, c float64
    for _, x := range xs {
        y := x - c; t := s + y; c = (t - s) - y; s = t
    }
    return s
}
```

---

## 23. Tricky Questions

**Q1**: What does `int32(uint32(0xffff_ffff))` return?
**A**: -1. The bits are unchanged; the leading 1 becomes the sign bit.

**Q2**: How would you safely add two int64?
**A**: `bits.Add64` doesn't help directly (unsigned). Roll your own:
```go
func addInt64(a, b int64) (int64, bool) {
    s := a + b
    if (a ^ s) & (b ^ s) < 0 { return 0, false }
    return s, true
}
```

**Q3**: Why is `math.MaxFloat64` finite while addition can produce `+Inf`?
**A**: `math.MaxFloat64` is the largest finite float64. Adding to it (or multiplying) overflows the exponent range; IEEE 754 produces `+Inf`, not a number.

**Q4**: Is `0.5 + 0.25 == 0.75` exact?
**A**: Yes. Both 0.5 and 0.25 are exact in binary; their sum 0.75 is also exact.

---

## 24. Cheat Sheet

```go
// Overflow-aware unsigned
sum, carry := bits.Add64(a, b, 0)

// Signed overflow check
addInt64(a, b) // (a^s)&(b^s) < 0 means overflow

// Big int
n := new(big.Int).SetInt64(123)
n.Mul(n, big.NewInt(456))

// Decimal money
import "github.com/shopspring/decimal"
d := decimal.NewFromFloat(0.1).Add(decimal.NewFromFloat(0.2))

// NaN-safe equal
math.IsNaN(a) || math.IsNaN(b) || a == b

// Float equal (ULP)
diffBits := math.Float64bits(a) - math.Float64bits(b)
diffBits <= 4

// Range-check before narrow
if x < math.MinInt32 || x > math.MaxInt32 { ... }
```

---

## 25. Self-Assessment Checklist

- [ ] I use `math/bits` for overflow-aware unsigned ops
- [ ] I write checked add/sub/mul for signed integers
- [ ] I use `math/big` when input is unbounded
- [ ] I use a decimal library for money
- [ ] I never compare floats with `==` in production
- [ ] I range-check before narrowing conversions
- [ ] I handle NaN and Inf explicitly
- [ ] I know when to use big.Float vs big.Rat vs decimal

---

## 26. Summary

At the middle level you've internalized that integer overflow is defined-but-silent and float precision is not negotiable. You reach for `math/bits` for overflow-aware unsigned ops, `math/big` for unbounded integers, and a decimal library for money. You range-check at every conversion boundary. You compare floats with epsilon or ULP, not `==`. You know that `big.Float` is binary, not decimal, and that the right tool for money is a decimal library.

---

## 27. What You Can Build

- A money type backed by integer cents or `decimal.Decimal`
- A safe length-prefixed protocol decoder
- A statistics aggregator that uses Kahan summation
- A range-validated input parser
- A modular-arithmetic helper for cryptographic constants
- A counter with saturating overflow and metrics

---

## 28. Further Reading

- [`math/bits`](https://pkg.go.dev/math/bits)
- [`math/big`](https://pkg.go.dev/math/big)
- [`shopspring/decimal`](https://pkg.go.dev/github.com/shopspring/decimal)
- [`cockroachdb/apd`](https://pkg.go.dev/github.com/cockroachdb/apd/v3)
- [Kahan summation algorithm](https://en.wikipedia.org/wiki/Kahan_summation_algorithm)
- [Comparing floating point numbers (Bruce Dawson)](https://randomascii.wordpress.com/2012/02/25/comparing-floating-point-numbers-2012-edition/)
- [What every computer scientist should know about FP](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)

---

## 29. Related Topics

- 2.2.1 Integers
- 2.2.2 Floating Points
- 2.2.5 Type Conversions
- 2.10 Constants
- Chapter 7 (concurrency — atomic int operations)

---

## 30. Diagrams & Visual Aids

### Tier diagram

```
+---------------------------------------------+
| math/big — arbitrary precision (slow)       |
+---------------------------------------------+
| math/bits — overflow-aware (fast)           |
+---------------------------------------------+
| int / float — native (fastest, bounded)     |
+---------------------------------------------+
```

### Float bit layout

```
float64:
| sign | exponent (11) | mantissa (52)        |
   1         11               52
```

### Float gap

```
| ε around 0     |   ε around 1   |   ε around 1e6  |
        ↑               ↑                  ↑
    very small      ~2.2e-16          ~1e-10
```

The gap between adjacent floats grows with magnitude.
