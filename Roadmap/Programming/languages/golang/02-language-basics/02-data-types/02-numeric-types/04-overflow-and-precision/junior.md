# Go Overflow and Precision — Junior Level

## 1. Introduction

### What is it?
Computers store numbers in a fixed number of bits. When you ask them to compute something that won't fit, two things can happen:

- **Integer overflow** — the result wraps around to a value the type can hold. In Go, signed integer overflow is **defined behavior**: the bits wrap two's complement, no panic, no error. (This is different from C/C++ where signed overflow is undefined.)
- **Floating-point imprecision** — most decimal fractions can't be represented exactly in binary, so calculations carry a tiny error. The classic surprise: `0.1 + 0.2 != 0.3`.

Both topics matter the moment you write real code: a counter that wraps to a negative number, money math that accumulates a half-cent error per transaction, a `for i := int8(0); i < 200; i++` that loops forever.

### How to use it?
```go
package main

import (
    "fmt"
    "math"
)

func main() {
    var x int8 = 127
    x++
    fmt.Println(x) // -128 (wrap)

    fmt.Println(0.1 + 0.2)            // 0.30000000000000004
    fmt.Println(0.1+0.2 == 0.3)       // false
    fmt.Println(math.NaN() == math.NaN()) // false
}
```

If your code mixes large integers, money, or scientific values, you must understand both overflow and precision.

---

## 2. Prerequisites
- Integers (2.2.1) — basic int types and ranges
- Floating-points (2.2.2) — basic float32/float64
- Hex / binary representation
- Bit operations (shift, mask)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Overflow | A computed value falls outside the representable range |
| Wrap-around | After overflow, the value cycles modulo 2^N |
| Two's complement | Standard binary representation for signed integers |
| Underflow (int) | Negative overflow; same wrapping rule |
| Constant overflow | Overflow caught at compile time for typed constants |
| IEEE 754 | The standard binary format for floating-point numbers |
| Mantissa | The significand bits in a float (24 for float32, 53 for float64) |
| Exponent | The power-of-two scaling factor in a float |
| Subnormal (denormal) | Very small float values with reduced precision |
| NaN | "Not a Number"; result of invalid operations like 0/0 |
| Inf | Infinity; result of overflow during float arithmetic |
| ULP | Unit in the Last Place; the gap between adjacent representable floats |
| Catastrophic cancellation | Losing precision by subtracting nearly-equal numbers |
| Decimal type | A library type for exact decimal arithmetic (not built-in) |

---

## 4. Core Concepts

### 4.1 Integer Ranges

Each signed integer type has a fixed range:

| Type | Bits | Min | Max |
|------|------|-----|-----|
| int8 | 8 | -128 | 127 |
| int16 | 16 | -32768 | 32767 |
| int32 | 32 | -2147483648 | 2147483647 |
| int64 | 64 | -9223372036854775808 | 9223372036854775807 |

Unsigned types start at 0 and go to `2^N - 1`:

| Type | Bits | Min | Max |
|------|------|-----|-----|
| uint8 | 8 | 0 | 255 |
| uint16 | 16 | 0 | 65535 |
| uint32 | 32 | 0 | 4294967295 |
| uint64 | 64 | 0 | 18446744073709551615 |

The platform-dependent `int` and `uint` are 32 or 64 bits depending on the build target (almost always 64 today).

The `math` package exports the constants:

```go
fmt.Println(math.MaxInt8, math.MinInt8)   // 127 -128
fmt.Println(math.MaxInt32, math.MinInt32) // 2147483647 -2147483648
```

### 4.2 Signed Overflow Wraps (Defined)

When a signed operation produces a value outside the range, Go silently wraps modulo 2^N:

```go
var a int8 = 127
a++ // a == -128
fmt.Println(a)
```

Why? In two's complement, 127 is `01111111`. Adding 1 gives `10000000`, which is -128 (the most negative value).

Same for any integer width:

```go
var b int32 = math.MaxInt32
b++ // b == math.MinInt32
```

This is **legal Go** — no panic, no error. The behavior is defined by the spec.

### 4.3 Unsigned Overflow Wraps Too

```go
var u uint8 = 255
u++ // u == 0
fmt.Println(u)
```

Unsigned arithmetic is modulo 2^N. Subtracting from 0 wraps to the maximum:

```go
var v uint8 = 0
v-- // v == 255
```

### 4.4 Constant Overflow Is a Compile Error

For typed constants, Go catches overflow at compile time:

```go
const x int32 = 1 << 32 // ERROR: constant overflow
```

```
./main.go:N: constant 4294967296 overflows int32
```

Untyped constants use arbitrary precision; the check happens when the constant is converted to a typed context.

### 4.5 Float Basics

Two built-in float types:

| Type | Bits | Mantissa | Approx decimal digits |
|------|------|----------|-----------------------|
| float32 | 32 | 24 | ~7 |
| float64 | 64 | 53 | ~15-17 |

`float64` is the default (the result of `1.5` or `3.14` is `float64`). Use it unless you have a specific reason for `float32` (memory, GPU, file format).

### 4.6 Floats Aren't Decimal

A float64 stores numbers in binary. Many decimal numbers — including `0.1`, `0.2`, `0.3` — have infinite binary representations. The float stores a rounded approximation.

```go
fmt.Println(0.1 + 0.2) // 0.30000000000000004
```

This isn't a Go bug. It's IEEE 754 behavior, the same in every mainstream language.

### 4.7 Special Float Values

Floats can be `+Inf`, `-Inf`, or `NaN`:

```go
fmt.Println(1.0 / 0.0)               // +Inf
fmt.Println(-1.0 / 0.0)              // -Inf
fmt.Println(0.0 / 0.0)               // NaN
fmt.Println(math.Sqrt(-1))           // NaN
```

`NaN` has the strange property that `NaN != NaN`:

```go
nan := math.NaN()
fmt.Println(nan == nan) // false
```

To test for NaN, use `math.IsNaN`:

```go
if math.IsNaN(x) {
    // ...
}
```

### 4.8 Conversions May Truncate or Wrap

When converting between numeric types, you can lose information:

```go
var big int64 = 1<<40
var small int32 = int32(big) // narrows; high bits lost
fmt.Println(small)           // 0  (the low 32 bits of 1<<40 are zero)

f := 3.99
i := int(f) // truncates toward zero
fmt.Println(i) // 3
```

Float-to-int with an out-of-range value is **implementation-defined**. Don't rely on a specific result; check the range first.

---

## 5. Real-World Analogies

**A car odometer** — once it reaches 999999, the next mile rolls it back to 000000. That's unsigned wrap-around.

**A bathroom scale that maxes at 200 kg** — if you load 250 kg, it pegs at 200 (saturating arithmetic), or in Go's case, wraps to a meaningless number.

**Reading a label printed at low resolution** — the printer can't show every digit you wrote. It approximates. That's float precision.

**A currency exchange that always rounds the cent** — two transactions of 0.10 USD each don't equal 0.20 because of accumulated rounding. Same idea as `0.1 + 0.2 != 0.3`.

---

## 6. Mental Models

### Model 1 — The Wrapping Wheel

Imagine an analog clock with N hours instead of 12. After N hours, it wraps to 0. That's unsigned modular arithmetic. For signed types, picture the clock split: half the hours are positive, half negative; crossing the boundary wraps to the other half.

### Model 2 — Float Grid

Picture a number line where only certain points are "lit". Between any two lit points there are infinitely many real numbers — none of them is representable. When you compute, the result snaps to the nearest lit point. Operations accumulate snap errors.

```
... | 0.0999... | 0.1 | 0.1000...01 | ... | 0.3 | 0.3000...04 | ...
```

The float for `0.1` is actually `0.1000000000000000055511...`. After many operations, the gap shows up.

### Model 3 — Two Different Worlds

```
Integers:  exact within range, wrap on overflow.
Floats:    huge range, but only a fixed number of distinct values.
           Most decimal numbers aren't representable.
```

You pick the right type for the job. Use integers (or a decimal library) for money. Use floats for scientific approximations.

---

## 7. Pros & Cons

### Integers

**Pros**:
- Exact within range
- Fast (one CPU instruction per op)
- Predictable wrap-around (defined)
- Compile-time overflow detection for constants

**Cons**:
- Silent runtime overflow
- Easy to choose too narrow a type
- Conversions can truncate quietly

### Floats

**Pros**:
- Huge range (10^-308 to 10^308 for float64)
- One type covers many magnitudes
- Hardware-accelerated on every CPU

**Cons**:
- Not exact for most decimals
- `==` comparison is fragile
- Special values (NaN, Inf) need careful handling
- Catastrophic cancellation on subtraction of close values

---

## 8. Use Cases

1. Loop counters — choose `int` unless you have a reason
2. Bit-twiddling — choose `uint32` / `uint64` for clear masks
3. Money — never `float64`; use integer cents or a decimal library
4. Statistics, ML, graphics — `float64` is fine
5. File formats — match the format spec exactly (`int32`, `uint16`, etc.)
6. Cryptographic constants — `math/bits` for portable wide arithmetic
7. Hashing — unsigned integers and explicit modular arithmetic
8. Physics simulation — `float64`, with awareness of accumulated error

---

## 9. Code Examples

### Example 1 — Signed Integer Overflow

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    var x int8 = math.MaxInt8
    fmt.Println(x)      // 127
    x++
    fmt.Println(x)      // -128 (wrap)

    var y int32 = math.MaxInt32
    y++
    fmt.Println(y)      // -2147483648
}
```

### Example 2 — Unsigned Wrap

```go
package main

import "fmt"

func main() {
    var u uint8 = 0
    u--               // wraps to 255
    fmt.Println(u)    // 255

    var v uint8 = 250
    v += 10           // wraps: 260 mod 256 = 4
    fmt.Println(v)    // 4
}
```

### Example 3 — Constant Overflow Caught at Compile Time

```go
package main

func main() {
    // Uncomment to see the compile error:
    // const x int32 = 1 << 32   // constant 4294967296 overflows int32
    // const y int8 = 200        // constant 200 overflows int8
    _ = 0
}
```

The compiler refuses to build. Untyped constants have arbitrary precision, but converting them into a typed context triggers the check.

### Example 4 — Float Precision

```go
package main

import "fmt"

func main() {
    a := 0.1
    b := 0.2
    c := a + b
    fmt.Println(c)            // 0.30000000000000004
    fmt.Println(c == 0.3)     // false

    fmt.Printf("%.20f\n", c)  // 0.30000000000000004441
    fmt.Printf("%.20f\n", 0.3) // 0.29999999999999998890
}
```

The literal `0.3` and the sum `0.1 + 0.2` are different float64 values.

### Example 5 — NaN and Inf

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    pos := 1.0 / 0.0
    neg := -1.0 / 0.0
    nan := math.NaN()

    fmt.Println(pos)              // +Inf
    fmt.Println(neg)              // -Inf
    fmt.Println(nan)              // NaN

    fmt.Println(math.IsInf(pos, 1))  // true (positive infinity)
    fmt.Println(math.IsInf(neg, -1)) // true (negative infinity)
    fmt.Println(math.IsNaN(nan))     // true
    fmt.Println(nan == nan)          // false (NaN is never equal to itself)
}
```

### Example 6 — Float Comparison With Tolerance

```go
package main

import (
    "fmt"
    "math"
)

func almostEqual(a, b, eps float64) bool {
    return math.Abs(a-b) <= eps
}

func main() {
    a := 0.1 + 0.2
    fmt.Println(a == 0.3)              // false
    fmt.Println(almostEqual(a, 0.3, 1e-9)) // true
}
```

### Example 7 — Narrowing Conversion

```go
package main

import "fmt"

func main() {
    var big int64 = 0x1_0000_0001 // 4294967297
    var small int32 = int32(big)
    fmt.Println(small) // 1  (low 32 bits)

    f := 3.9
    fmt.Println(int(f)) // 3 (truncates toward zero)

    f = -3.9
    fmt.Println(int(f)) // -3 (toward zero, not toward -inf)
}
```

### Example 8 — Float-to-Int Out of Range (Be Careful)

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    big := math.MaxFloat64
    // The result of int(big) is implementation-defined.
    // Don't rely on a specific value; range-check first.
    if big > float64(math.MaxInt64) {
        fmt.Println("out of int64 range")
    } else {
        fmt.Println(int64(big))
    }
}
```

---

## 10. Coding Patterns

### Pattern 1 — Range-Check Before Narrowing

```go
func toInt32(x int64) (int32, bool) {
    if x < math.MinInt32 || x > math.MaxInt32 {
        return 0, false
    }
    return int32(x), true
}
```

### Pattern 2 — Range-Check Before Float-to-Int

```go
func toInt64(f float64) (int64, bool) {
    if math.IsNaN(f) || math.IsInf(f, 0) {
        return 0, false
    }
    if f < float64(math.MinInt64) || f > float64(math.MaxInt64) {
        return 0, false
    }
    return int64(f), true
}
```

### Pattern 3 — Float Equality With Tolerance

```go
func equal(a, b float64) bool {
    return math.Abs(a-b) <= 1e-9
}
```

### Pattern 4 — Money as Integer Cents

```go
type Cents int64

func (c Cents) String() string {
    return fmt.Sprintf("%d.%02d", c/100, c%100)
}
```

A balance of $123.45 is `Cents(12345)`. No float ever touches the value.

### Pattern 5 — Use Wider Type for Intermediate Math

```go
// average of two int32 without overflow
func avgInt32(a, b int32) int32 {
    return int32((int64(a) + int64(b)) / 2)
}
```

Or, the half-way trick that avoids the wider type:

```go
func avgInt32(a, b int32) int32 {
    return a/2 + b/2 + (a%2 + b%2)/2
}
```

---

## 11. Clean Code Guidelines

1. Pick the smallest type that holds the **maximum** value plus a margin.
2. Use `int` for loop counters unless you have a reason.
3. Don't cast int to a narrower type without checking the range.
4. Don't compare floats with `==`; use a tolerance.
5. Don't use float for currency.
6. Document the units (cents, milliseconds, bytes) on integer types.
7. Use `math.IsNaN` / `math.IsInf` to test special values.
8. When in doubt, use `int64` and `float64`.

---

## 12. Product Use / Feature Example

**Tracking a counter that may grow large**:

```go
package main

import (
    "fmt"
    "math"
)

type RequestCounter struct {
    n int64
}

func (r *RequestCounter) Increment() {
    if r.n == math.MaxInt64 {
        // saturate (or rotate, or alarm)
        return
    }
    r.n++
}

func (r *RequestCounter) Value() int64 { return r.n }

func main() {
    var c RequestCounter
    for i := 0; i < 5; i++ {
        c.Increment()
    }
    fmt.Println(c.Value()) // 5
}
```

Or, using `atomic.Int64` for goroutine safety. The point is to choose the type and saturating policy on purpose.

---

## 13. Error Handling

There's no built-in overflow error. You handle it by:

1. **Range-check** before the operation.
2. **Use `math/bits`** for overflow-detecting primitives (`Add64`, `Mul64`, `Sub64`).
3. **Use `math/big`** for arbitrary precision when you can't bound the input.

```go
package main

import (
    "fmt"
    "math/bits"
)

func main() {
    sum, carry := bits.Add64(0xffff_ffff_ffff_fffe, 5, 0)
    fmt.Println(sum, carry) // 3 1   (carry = 1 → overflow)
}
```

For floats: check `math.IsNaN` and `math.IsInf` after the operation.

---

## 14. Security Considerations

1. **User-supplied integers** must be range-checked before they index, allocate, or determine sizes. An attacker can submit `int(-1)` and trigger silent wrap.
2. **Length fields from network protocols** must be validated. A `uint32` length of `0xffff_ffff` cast to `int` on a 32-bit platform becomes -1 — easy buffer-overrun.
3. **Float used for security policy** (rate limits, quotas) is a bug. Floats accumulate error; attacker can game the rounding.
4. **`gosec` G701** flags suspicious integer overflow conversions.

---

## 15. Performance Tips

1. Integer arithmetic is the fastest. Don't switch to float for "safety".
2. `math/bits` overflow-checked variants cost a couple of extra instructions; usually fine.
3. `math/big` is much slower (heap allocations, software-implemented). Only use when you need arbitrary precision.
4. `float32` is half the memory of `float64`. Useful for very large vectors.
5. Avoid mixing types — implicit-converting in a hot loop costs cycles.

---

## 16. Metrics & Analytics

When tracking counters, watch for overflow before it bites you:

```go
if c.n > math.MaxInt64-1000 {
    metrics.Alert("counter near overflow")
}
```

For floats in a metrics pipeline, store small denominations as integer counts and divide at the visualization layer.

---

## 17. Best Practices

1. Use `int64` and `float64` by default.
2. Check ranges before narrowing.
3. Use integer cents (or a decimal library) for money.
4. Use a tolerance for float equality.
5. Validate user-supplied integers and lengths.
6. Use `math/bits` for portable overflow-aware ops.
7. Use `math/big` when input range is unbounded.
8. Document the units on integer-typed values.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — int8 Loop That Never Ends

```go
for i := int8(0); i < 200; i++ { // i wraps at 127
    // infinite loop
}
```

`i` reaches 127, increments to -128, eventually back to 0. It never reaches 200 (which is unreachable in int8).

### Pitfall 2 — `0.1 + 0.2 != 0.3`

Don't compare floats with `==`. Use a tolerance.

### Pitfall 3 — Average of Two Large Ints

```go
mid := (a + b) / 2 // overflows if a + b exceeds int range
```

Use `a/2 + b/2 + (a%2 + b%2)/2` or widen to int64.

### Pitfall 4 — Catastrophic Cancellation

```go
a := 1.0000001
b := 1.0000000
c := a - b // 1e-7 — about 7 of float32's 7 digits gone
```

Subtracting nearly-equal values keeps only the differing low bits.

### Pitfall 5 — `NaN == NaN` Is False

```go
nan := math.NaN()
if nan == nan { ... } // never enters
```

Use `math.IsNaN`.

### Pitfall 6 — Float-to-Int Out of Range

```go
i := int(math.MaxFloat64)
// implementation-defined; check range first
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Compare floats with `==` | Use `math.Abs(a-b) <= eps` |
| Use float for money | Use integer cents or `shopspring/decimal` |
| Use int8/int16 for loop counters | Use `int` |
| Cast int64 to int32 without range check | Check first |
| Test NaN with `==` | Use `math.IsNaN` |
| Average via `(a+b)/2` for huge ints | Use the half-way pattern or widen type |

---

## 20. Common Misconceptions

**Misconception 1**: "Go panics on integer overflow."
**Truth**: No. Signed wrap is defined and silent. Use `math/bits` if you want detection.

**Misconception 2**: "Floats are exact for small numbers."
**Truth**: Few decimals are exact in binary. `0.5` and `0.25` happen to be; `0.1` is not.

**Misconception 3**: "Using float64 instead of float32 fixes precision bugs."
**Truth**: float64 has more digits, but the same class of bugs. Don't use float for money in either width.

**Misconception 4**: "Constant overflow compiles silently."
**Truth**: Typed constants are checked at compile time. Untyped constants are checked when used in a typed context.

**Misconception 5**: "`nan == nan` should be true."
**Truth**: IEEE 754 specifies NaN is unequal to everything, including itself.

---

## 21. Tricky Points

1. Signed overflow is defined in Go (different from C/C++).
2. Untyped constant arithmetic uses arbitrary precision until you assign to a typed variable.
3. Float-to-int out-of-range is implementation-defined; don't rely on a specific result.
4. Two equal-looking floats may differ in their bits; use `math.Float64bits` to inspect.
5. The `math.MaxInt8 + 1 == math.MinInt8` identity holds because of wrap.

---

## 22. Test

```go
package main

import (
    "math"
    "testing"
)

func TestSignedWrap(t *testing.T) {
    var x int8 = math.MaxInt8
    x++
    if x != math.MinInt8 {
        t.Errorf("got %d, want %d", x, int8(math.MinInt8))
    }
}

func TestUnsignedWrap(t *testing.T) {
    var u uint8 = 0
    u--
    if u != 255 {
        t.Errorf("got %d, want 255", u)
    }
}

func TestFloatPrecision(t *testing.T) {
    if 0.1+0.2 == 0.3 {
        t.Error("expected 0.1 + 0.2 != 0.3 (IEEE 754 reality)")
    }
}

func TestNaNNotEqualSelf(t *testing.T) {
    nan := math.NaN()
    if nan == nan {
        t.Error("NaN should not equal itself")
    }
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
var x int8 = 127
x++
fmt.Println(x)
```
**A**: `-128`. Two's complement wrap.

**Q2**: What does this print?
```go
fmt.Println(0.1 + 0.2 == 0.3)
```
**A**: `false`. The sum is `0.30000000000000004` in float64.

**Q3**: What's the issue?
```go
for i := int8(0); i <= 127; i++ {
    fmt.Println(i)
}
```
**A**: After printing 127, `i++` wraps to -128, the loop's `i <= 127` is true forever — infinite loop.

**Q4**: What does this print?
```go
nan := math.NaN()
fmt.Println(nan == nan, math.IsNaN(nan))
```
**A**: `false true`. NaN is unequal to itself; use `math.IsNaN`.

---

## 24. Cheat Sheet

```go
// Ranges
math.MaxInt8 = 127, math.MinInt8 = -128
math.MaxInt32 = 2147483647
math.MaxInt64 = 9223372036854775807
math.MaxFloat64 = 1.797...e+308

// Overflow wrap
var x int8 = 127
x++ // -128

// Constant overflow caught at compile time
const x int32 = 1 << 32 // ERROR

// Float pitfalls
0.1 + 0.2 != 0.3
math.NaN() != math.NaN()

// Test NaN / Inf
math.IsNaN(x)
math.IsInf(x, 0)  // either direction

// Float comparison
math.Abs(a-b) <= 1e-9

// Money — use integer cents
type Cents int64
```

---

## 25. Self-Assessment Checklist

- [ ] I know the int8/int16/int32/int64 ranges
- [ ] I know signed overflow wraps in Go
- [ ] I know constant overflow is caught at compile time
- [ ] I never compare floats with `==`
- [ ] I never use float for money
- [ ] I know `NaN != NaN`
- [ ] I range-check before narrowing
- [ ] I know `0.1 + 0.2 != 0.3` and why

---

## 26. Summary

Integer overflow in Go is defined: signed wraps two's complement, unsigned wraps modulo 2^N. Constant overflow is caught at compile time; runtime overflow is silent. Floats follow IEEE 754: most decimals aren't exactly representable, equality is unreliable, and special values (NaN, Inf) need explicit handling. Use integers (or a decimal library) for money. Use `math/bits` when you need overflow detection. Use `math/big` for arbitrary precision.

---

## 27. What You Can Build

- A safe length-prefixed reader that range-checks the prefix
- A money type backed by integer cents
- A statistics aggregator that uses int64 sums and divides at the end
- A counter that saturates instead of wrapping
- A float comparator with configurable tolerance
- A range-validated converter for parsing user input

---

## 28. Further Reading

- [Go spec: Numeric types](https://go.dev/ref/spec#Numeric_types)
- [Go spec: Constant expressions](https://go.dev/ref/spec#Constant_expressions)
- [Go spec: Conversions](https://go.dev/ref/spec#Conversions)
- [`math` package](https://pkg.go.dev/math)
- [`math/bits` package](https://pkg.go.dev/math/bits)
- [`math/big` package](https://pkg.go.dev/math/big)
- [What every computer scientist should know about floating-point](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)

---

## 29. Related Topics

- 2.2.1 Integers
- 2.2.2 Floating Points
- 2.2.3 Complex Numbers
- 2.2.5 Type Conversions
- 2.10 Constants

---

## 30. Diagrams & Visual Aids

### Integer wrap

```
int8:     ... -2 -1  0  1  2 ... 126 127 -128 -127 ... (wraps)
uint8:    0  1  2 ... 254 255  0  1 ... (wraps)
```

### Float grid

```
Real number line:
... ───|──|──|────|─|──|──|──|──── ...
Representable floats are at the |s.
Numbers in between snap to the nearest |.
```

### Float bit layout (IEEE 754 double)

```
| sign (1) | exponent (11) | mantissa (52) |
   1 bit       11 bits          52 bits
```
