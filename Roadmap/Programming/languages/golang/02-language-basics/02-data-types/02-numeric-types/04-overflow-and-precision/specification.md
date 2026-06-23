# Go Specification: Overflow and Precision

**Source:** https://go.dev/ref/spec
**Sections:** Numeric types, Constant expressions, Conversions, Arithmetic operators

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Numeric types** | https://go.dev/ref/spec#Numeric_types |
| **Constant expressions** | https://go.dev/ref/spec#Constant_expressions |
| **Conversions** | https://go.dev/ref/spec#Conversions |
| **Arithmetic operators** | https://go.dev/ref/spec#Arithmetic_operators |
| **`math` package** | https://pkg.go.dev/math |
| **`math/bits` package** | https://pkg.go.dev/math/bits |
| **Go Version** | Go 1.0+ baseline; behavior changes noted per version |

Spec quote on numeric types:

> "The numeric types include the predefined integer, floating-point, and complex types. ... Integer overflow does not occur; the result is well-defined and corresponds to the wraparound result for the given numeric type."

Spec quote on constant expressions:

> "Constant expressions are always evaluated exactly; intermediate values and the constants themselves may require precision significantly larger than supported by any predeclared type in the language."

Spec quote on conversions:

> "In all non-constant conversions involving floating-point or complex values, if the result type cannot represent the value the conversion succeeds but the result value is implementation-dependent."

---

## 2. Definition

**Overflow** in Go integer arithmetic: a value computed by an arithmetic operation falls outside the representable range of its type. Go defines this as **wraparound modulo 2^N** for both signed and unsigned types.

**Precision** in Go floating-point arithmetic: float32 and float64 conform to IEEE 754, which approximates real numbers using a fixed number of binary mantissa bits. Most decimal fractions cannot be represented exactly, leading to rounding error in arithmetic.

**Constant overflow**: a typed constant whose value falls outside its type's range. Caught at compile time.

---

## 3. Core Rules & Constraints

### 3.1 Integer Overflow Wraps

Per the spec: "Integer overflow does not occur; the result is well-defined and corresponds to the wraparound result for the given numeric type."

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    var x int8 = math.MaxInt8
    x++
    fmt.Println(x) // -128

    var u uint8 = 0
    u--
    fmt.Println(u) // 255
}
```

### 3.2 Untyped Constants Are Arbitrary Precision

Per the spec: "Constant expressions are always evaluated exactly; intermediate values and the constants themselves may require precision significantly larger than supported by any predeclared type in the language."

```go
const x = 1 << 100        // legal — untyped, arbitrary precision
const y = x / (1 << 98)   // 4 (still untyped)
const z int = y           // legal: 4 fits in int
// const w int = x        // ERROR: overflows int
```

### 3.3 Typed Constant Overflow Is a Compile Error

```go
const a int8 = 200       // ERROR: constant 200 overflows int8
const b int32 = 1 << 32  // ERROR: overflows int32
```

### 3.4 Float Conformance to IEEE 754

`float32` is binary32; `float64` is binary64. Operations follow IEEE 754 round-half-to-even.

```go
fmt.Println(0.1 + 0.2)         // 0.30000000000000004
fmt.Println(0.1+0.2 == 0.3)    // false
```

### 3.5 Special Float Values

`±Inf`, `±0`, and `NaN` are valid float values. NaN is unequal to everything (including itself):

```go
nan := math.NaN()
fmt.Println(nan == nan)        // false
fmt.Println(math.IsNaN(nan))   // true
```

### 3.6 Float-to-Int Out-of-Range Is Implementation-Defined

Per the spec: "if the result type cannot represent the value the conversion succeeds but the result value is implementation-dependent."

```go
i := int(math.MaxFloat64) // implementation-defined; don't rely on a specific value
```

### 3.7 Integer-to-Integer Conversion Truncates Bits

When narrowing, the high bits are discarded:

```go
var big int64 = 0x1_0000_0001
var small int32 = int32(big)
fmt.Println(small) // 1   (low 32 bits)
```

When converting between signed and unsigned of the same width, bits are reinterpreted:

```go
var u uint32 = 0xffff_ffff
var i int32 = int32(u)
fmt.Println(i) // -1
```

### 3.8 Shift Counts and Width

Per the spec: shift counts must be unsigned integer types or untyped constants representable by `uint`. For runtime shifts, shifts by ≥ bit-width are defined as zero (Go 1.13+).

```go
var x int32 = 1
var s uint = 32
fmt.Println(x << s) // 0  (defined)
```

For typed-constant shifts, the compiler may catch overflow at compile time.

### 3.9 Integer Division by Zero Panics

```go
var x int = 5
var y int = 0
_ = x / y // panic: runtime error: integer divide by zero
```

Float division by zero produces `±Inf` or `NaN`, not a panic.

### 3.10 Right Shift on Signed Is Arithmetic

```go
var x int8 = -8
fmt.Println(x >> 1) // -4 (sign-extending)

var u uint8 = 248 // same bits
fmt.Println(u >> 1) // 124 (zero-fill)
```

---

## 4. Type Rules

### 4.1 Numeric Type Identity

Each numeric type is distinct. Mixed-type arithmetic requires explicit conversion:

```go
var a int32 = 1
var b int64 = 2
// a + b   // ERROR: type mismatch
fmt.Println(int64(a) + b)
```

### 4.2 Default Types of Untyped Constants

| Untyped kind | Default type |
|--------------|--------------|
| Integer | `int` |
| Floating | `float64` |
| Rune | `int32` |
| Complex | `complex128` |
| Bool | `bool` |
| String | `string` |

Used when an untyped constant must be assigned a type but no other context determines it:

```go
x := 1     // x is int (default integer)
y := 1.5   // y is float64 (default floating)
```

### 4.3 Constant Conversion Rules

Untyped constants are converted to the destination type with overflow check:

```go
const c = 257
var b int8 = c // ERROR: 257 overflows int8
var s int16 = c // OK
```

---

## 5. Behavioral Specification

### 5.1 Signed Integer Overflow

```go
var a int32 = math.MaxInt32
a++ // a == math.MinInt32 (defined wrap)
```

### 5.2 Unsigned Integer Overflow

```go
var u uint8 = 250
u += 10 // u == 4 (260 mod 256)
```

### 5.3 Float Operations

Round-half-to-even per IEEE 754:

```go
fmt.Println(0.5 + 0.25)       // 0.75 (exact)
fmt.Println(0.1 + 0.2)        // 0.30000000000000004
fmt.Println(1.0 / 0.0)        // +Inf
fmt.Println(0.0 / 0.0)        // NaN
fmt.Println(math.MaxFloat64 * 2) // +Inf (overflow → infinity)
```

### 5.4 NaN Propagation

NaN propagates through arithmetic:

```go
nan := math.NaN()
fmt.Println(nan + 1)         // NaN
fmt.Println(nan * 0)         // NaN
fmt.Println(nan == nan)      // false
fmt.Println(math.Min(nan, 1)) // NaN (math.Min propagates NaN)
```

### 5.5 Sign of Zero

`+0.0` and `-0.0` are distinct bit patterns but compare equal:

```go
pos := 0.0
neg := -0.0
fmt.Println(pos == neg)        // true
fmt.Println(math.Signbit(neg)) // true
fmt.Println(1 / pos)           // +Inf
fmt.Println(1 / neg)           // -Inf
```

### 5.6 Constant Float Evaluation

The compiler evaluates float constants with arbitrary precision (via `big.Float`):

```go
const c = 1.0 / 3.0   // arbitrary precision rational
var f float64 = c     // converted to nearest float64 here
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Signed integer overflow | Defined: wraparound modulo 2^N |
| Unsigned integer overflow | Defined: modulo 2^N |
| Typed constant overflow | Compile error |
| Untyped constant arithmetic | Defined: arbitrary precision |
| Integer division by zero | Panic |
| Float division by zero | Defined: ±Inf or NaN |
| Float operations | Defined: IEEE 754 round-half-to-even |
| NaN comparison with `==` | Defined: false |
| Float-to-int when in range | Defined: truncation toward zero |
| Float-to-int out-of-range | Implementation-defined |
| Shift count ≥ bit-width (runtime) | Defined: result is 0 (Go 1.13+) |
| Right shift of negative signed | Defined: arithmetic (sign-extending) |

---

## 7. Edge Cases from Spec

### 7.1 `MinInt64 / -1`

```go
var x int64 = math.MinInt64
fmt.Println(x / -1) // math.MinInt64 (wrap; defined)
```

The mathematically correct result `-MinInt64` would equal `MaxInt64 + 1`, which doesn't fit. Go wraps to `MinInt64` rather than panicking (unlike Java's `ArithmeticException`).

### 7.2 Conversion of NaN

```go
nan := math.NaN()
i := int64(nan) // implementation-defined; on amd64 in Go 1.17+, returns MinInt64
```

### 7.3 Conversion of ±Inf

```go
pos := math.Inf(1)
i := int64(pos) // implementation-defined; on amd64, returns MaxInt64
```

### 7.4 Untyped Float Constant in Integer Context

```go
const c = 1.5
// var i int = c   // ERROR: cannot convert 1.5 to type int
const d = 2.0
var i int = d      // OK: 2.0 has integer value
```

### 7.5 Typed-Constant Shift Detection

```go
var x int32 = 1
const s = 32
// y := x << s   // ERROR: shift count too large for int32 (compiler catches)
```

For non-constant shift counts, Go 1.13+ defines the result as zero rather than erroring.

### 7.6 Float Comparisons in Sorts

The standard `<` operator returns false for NaN comparisons. `sort.SliceStable` may produce non-deterministic order if NaNs are present. Use `cmp.Compare` (Go 1.21+) for NaN-aware ordering.

### 7.7 `math.Float64bits` Round Trip

```go
x := 0.1
b := math.Float64bits(x)
y := math.Float64frombits(b)
fmt.Println(x == y) // true (round-trip is bit-exact)
```

### 7.8 Integer Conversion of Untyped Float

If the untyped float represents an integer value, conversion is allowed:

```go
const c = 3.0
var i int = c // OK
const d = 3.5
// var i int = d // ERROR: cannot convert
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Baseline: signed wrap defined; IEEE 754 conformance for floats |
| Go 1.13 | Shift counts of any value defined to produce zero when ≥ bit-width |
| Go 1.13 | Signed integer shift counts allowed (previously only unsigned) |
| Go 1.17 | Float-to-int conversion behavior improved on amd64 (deterministic but still implementation-defined) |
| Go 1.21 | `min`, `max` builtins (no overflow protection); `clear` builtin |
| Go 1.22 | `math/rand/v2` introduces typed `int32` / `int64` / `uint32` / `uint64` random functions |

The spec text on "wraparound result" is unchanged across versions; the implementation-defined float-to-int OOB behavior was clarified but not specified to a particular value.

---

## 9. Implementation-Specific Behavior

### 9.1 Constant Evaluation Internals

The compiler uses `math/big.Int` for integer constants and a high-precision `math/big.Float` (256+ bits) for float constants. Files:

- `src/cmd/compile/internal/types2/const.go`
- `src/cmd/compile/internal/types2/operand.go`
- (Older path) `src/cmd/compile/internal/typecheck/const.go`

When an untyped constant is converted to a typed value, the compiler checks the conversion is exact (for integer destinations) or rounds appropriately (for float destinations).

### 9.2 Code Generation for Arithmetic

The compiler emits native CPU instructions:
- `ADD` / `SUB` / `IMUL` / `IDIV` for signed integers.
- `ADDSS` / `ADDSD` / etc. for floats (SSE/AVX on amd64).
- `MOVSXD` for sign-extending narrowing/widening.
- `MOVZX` for zero-extending unsigned widening.

There are no instrumentation calls inserted for overflow detection. The user requests this via `math/bits` or hand-written checks.

### 9.3 Float-to-Int OOB on amd64

Pre Go 1.17: result depended on CPU's CVTTSD2SI behavior, which could produce `0x8000_0000_0000_0000` (the "indefinite integer" result) for any out-of-range source. Different CPUs gave different results.

Go 1.17+: the compiler emits a software check: NaN → MinIntN, +Inf → MaxIntN, -Inf → MinIntN, finite-OOB → clamp to type's max or min depending on sign. Still spec-allowed because the spec only says "implementation-defined".

### 9.4 Subnormal Performance

On most amd64 CPUs, subnormal arithmetic is significantly slower than normal float arithmetic (10-100x). Go does not enable flush-to-zero (FTZ) by default — correctness over speed.

### 9.5 Sign Bit Operations

`math.Signbit(x)` is implemented via `Float64bits(x) >> 63`. Faster than comparing to zero because it correctly handles `-0.0`.

---

## 10. Spec Compliance Checklist

- [ ] Integer overflow wraps modulo 2^N
- [ ] Typed constant overflow is a compile error
- [ ] Untyped constants use arbitrary precision
- [ ] Float operations conform to IEEE 754
- [ ] NaN comparisons return false (except `!=`)
- [ ] Float-to-int OOB is implementation-defined; range-check first
- [ ] Integer-to-integer narrowing truncates bits
- [ ] Integer division by zero panics
- [ ] Float division by zero produces ±Inf or NaN
- [ ] Shifts ≥ bit-width return zero (runtime)
- [ ] Right shift of signed values is arithmetic

---

## 11. Official Examples

### Example 1 — Defined Integer Wrap

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    var x int8 = math.MaxInt8
    x++
    fmt.Println(x) // -128
}
```

### Example 2 — Constant Overflow Detection

```go
package main

func main() {
    // const c int8 = 200 // ERROR: constant 200 overflows int8
    _ = 0
}
```

### Example 3 — Float Imprecision

```go
package main

import "fmt"

func main() {
    fmt.Println(0.1 + 0.2)            // 0.30000000000000004
    fmt.Println(0.1+0.2 == 0.3)       // false
}
```

### Example 4 — NaN Propagation

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    nan := math.NaN()
    fmt.Println(nan + 1)         // NaN
    fmt.Println(nan == nan)      // false
    fmt.Println(math.IsNaN(nan)) // true
}
```

### Example 5 — Range-Check Conversion

```go
package main

import (
    "errors"
    "math"
)

func toInt32(x int64) (int32, error) {
    if x < math.MinInt32 || x > math.MaxInt32 {
        return 0, errors.New("out of int32 range")
    }
    return int32(x), nil
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Numeric types | https://go.dev/ref/spec#Numeric_types | Defines types and ranges |
| Constants | https://go.dev/ref/spec#Constants | Untyped constants and arbitrary precision |
| Constant expressions | https://go.dev/ref/spec#Constant_expressions | Constant arithmetic rules |
| Conversions | https://go.dev/ref/spec#Conversions | Numeric conversion rules and OOB behavior |
| Arithmetic operators | https://go.dev/ref/spec#Arithmetic_operators | Operator semantics, division by zero |
| Run-time panics | https://go.dev/ref/spec#Run_time_panics | Integer division by zero |
| Memory model | https://go.dev/ref/mem | Concurrent access to numeric vars |
