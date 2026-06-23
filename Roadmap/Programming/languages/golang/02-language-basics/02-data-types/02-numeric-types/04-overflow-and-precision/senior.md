# Go Overflow and Precision — Senior Level

## 1. Overview

Senior-level mastery means understanding the **bit-level mechanics** of numeric types, **how the Go compiler treats numeric constants** (arbitrary-precision rationals via `math/big.Float` at compile time), the **IEEE 754 layout** Go inherits, the **conversion rules** the spec defines and the implementation-specific corners (notably `cmd/compile/internal/typecheck/const.go` for constant evaluation, and the historical changes around float-to-integer conversion across Go versions on amd64). At this level you reason about subnormals, rounding modes, the size of ULPs near zero vs near `MaxFloat64`, and the production patterns that prevent overflow from becoming an outage.

---

## 2. IEEE 754 Layout

Go's `float32` is IEEE 754 binary32; `float64` is IEEE 754 binary64.

### binary32 (float32)

```
| 1 | 8     | 23           |
  s   exp     mantissa
```

- **sign** (1 bit): 0 = positive, 1 = negative.
- **exponent** (8 bits): biased by 127. Range -126 to +127 for normal floats.
- **mantissa** (23 bits): the fraction. With the implicit leading 1, effective precision is 24 bits (~7 decimal digits).

### binary64 (float64)

```
| 1 | 11    | 52           |
  s   exp     mantissa
```

- **exponent** (11 bits): biased by 1023. Range -1022 to +1023.
- **mantissa** (52 bits): with implicit leading 1, 53 effective bits (~15-17 decimal digits).

### Special encodings

| Pattern | Meaning |
|---------|---------|
| exp = max, mantissa = 0 | ±Inf |
| exp = max, mantissa ≠ 0 | NaN |
| exp = 0, mantissa = 0 | ±0 |
| exp = 0, mantissa ≠ 0 | Subnormal (denormal) |

### Subnormals (Denormals)

For numbers smaller than `2^-126` (float32) or `2^-1022` (float64), the implicit leading 1 disappears and precision degrades. They allow gradual underflow but with reduced significance.

In Go:

```go
import "math"

x := math.SmallestNonzeroFloat64 // 5e-324; subnormal with one bit of precision
```

On some hardware, subnormal arithmetic is much slower (10-100x). Modern CPUs typically have a "flush-to-zero" mode but Go doesn't enable it (correctness over speed).

### ULP (Unit in the Last Place)

The gap between adjacent floats varies with magnitude:

| Near | ULP for float64 |
|------|-----------------|
| 0 | ~5e-324 (subnormal) or ~2.2e-308 (smallest normal) |
| 1 | ~2.2e-16 |
| 1e6 | ~1.2e-10 |
| 1e15 | ~0.125 |
| 1e16 | 2 (you can't represent odd integers above 2^53) |

This is why `1e16 + 1 == 1e16` in float64 — the increment is below ULP.

```go
fmt.Println(1e16 + 1 == 1e16) // true
```

---

## 3. Constant Evaluation in the Compiler

Go's untyped constants have **arbitrary precision** during compile-time evaluation. The compiler uses `math/big.Float` (or `math/big.Int` / `math/big.Rat`) under the hood.

```go
const x = 1<<100        // legal as untyped constant
const y = x / (1<<98)   // 4 (still in untyped context)
const z int64 = y       // legal — fits in int64

// const w int64 = x    // ERROR: overflows int64
```

`cmd/compile/internal/typecheck/const.go` (now `cmd/compile/internal/types2/const.go` under the type-checker rewrite) implements:

- Parsing literals into arbitrary-precision values.
- Folding constant expressions (`+`, `-`, `*`, `/`, `<<`, `>>`).
- Conversion to typed contexts with overflow detection.
- Maintaining the spec's "default type" for untyped constants when used.

Default types:

| Untyped kind | Default type |
|--------------|--------------|
| Integer (untyped) | `int` |
| Floating (untyped) | `float64` |
| Rune | `int32` |
| String | `string` |
| Complex | `complex128` |

When an untyped constant is used in a context requiring a type, the compiler checks the value fits. If not, it's a compile error.

---

## 4. Conversion Rules

### Integer-to-Integer

Conversions truncate by reinterpreting the lower bits:

```go
var x uint64 = 0xffff_ffff_ffff_ffff
fmt.Println(int8(x))  // -1   (low 8 bits reinterpreted as int8)
fmt.Println(uint8(x)) // 255  (low 8 bits as uint8)
```

The spec describes the result as the value modulo 2^N, with sign reinterpretation.

### Integer-to-Float

Round to nearest representable float (round-half-to-even). For values that fit in the mantissa, this is exact:

```go
var x int64 = 1 << 53
var f float64 = float64(x) // exact
x = (1 << 53) + 1          // doesn't fit
f = float64(x)             // rounded; equals 1<<53 in this case
fmt.Println(f == float64(1<<53)) // true
```

### Float-to-Integer

Truncates toward zero. Out-of-range conversion is **implementation-defined** by the Go spec:

> "In all non-constant conversions involving floating-point or complex values, if the result type cannot represent the value the conversion succeeds but the result value is implementation-dependent."

Historically:

- Pre Go 1.17 on amd64: out-of-range produced a CPU-defined value (often unpredictable).
- Go 1.17+: improvements brought more deterministic behavior. On amd64, the result is now consistent across runs but still implementation-defined.

The lesson: **always range-check before float-to-int**.

```go
// Don't:
i := int64(math.MaxFloat64)

// Do:
if math.IsNaN(f) || math.IsInf(f, 0) || f < math.MinInt64 || f > math.MaxInt64 {
    return 0, errors.New("out of range")
}
i := int64(f)
```

### Float-to-Float

Round to the target precision. `float32(1.1)` is not the same value as `float64(1.1)`:

```go
fmt.Println(float64(float32(1.1))) // 1.100000023841858
```

The float32 `1.1` rounds twice — once into float32, then cast back to float64 with the lost bits.

---

## 5. Constant Shifts

Shift amounts in Go must be unsigned (or untyped). Constant shifts are evaluated with arbitrary precision:

```go
const x = 1 << 100   // legal; x is an untyped constant
// const y int = x   // ERROR: overflow
```

For non-constant shifts, the Go spec requires the shift count to be `uint` or convertible. The shift count is reduced modulo the bit width:

In Go 1.12+, `var s uint = 64; var x int64 = 1; x << s` evaluates to 0 (shift by ≥ width zeros the result), not undefined like C. The spec made this explicit: shift counts of any value are well-defined.

For non-constant shifts of a typed value, **shift count > width returns 0** (defined). For typed-constant shifts, the compiler may catch the overflow at compile time:

```go
var x int32 = 1
x = x << 32 // at runtime: defined, result is 0
const y int32 = 1 << 32 // ERROR: shift count out of range
```

---

## 6. Sign Bit, Zero, and Comparison

`+0.0` and `-0.0` are distinct bit patterns but compare equal under `==`:

```go
var pos float64 = 0.0
var neg float64 = -0.0
fmt.Println(pos == neg) // true
fmt.Println(math.Signbit(pos), math.Signbit(neg)) // false true
```

But division yields different results:

```go
fmt.Println(1.0 / pos)  // +Inf
fmt.Println(1.0 / neg)  // -Inf
```

`math.Signbit` is the way to inspect the sign bit; `==` doesn't.

NaN comparisons:

| Expression | Result |
|------------|--------|
| `NaN == x` (any x) | false |
| `NaN != x` | true |
| `NaN < x`, `NaN > x` | false |
| `math.IsNaN(NaN)` | true |
| `NaN == NaN` | false |

This is by IEEE 754 design, intended to flag invalid operations.

---

## 7. Compiler-Time vs Runtime Behavior

| Operation | Compile-time | Runtime |
|-----------|--------------|---------|
| Untyped constant arithmetic | Arbitrary precision | N/A |
| Typed constant overflow | Compile error | N/A |
| Runtime integer overflow | N/A | Defined wrap |
| Runtime float overflow | N/A | ±Inf |
| Runtime float underflow | N/A | Subnormal then 0 |
| Runtime float-to-int OOB | N/A | Implementation-defined |
| Runtime div-by-zero (int) | N/A | Panic |
| Runtime div-by-zero (float) | N/A | ±Inf or NaN |

Key gotcha: integer division by zero panics (`runtime error: integer divide by zero`); float division by zero produces `±Inf` or `NaN`.

---

## 8. The Compiler's Numeric Pipeline

When you write `x := 1 + 2`, the path is:

1. Parser produces AST nodes for `1`, `2`, `+`.
2. Type checker (in `types2`) evaluates `1 + 2` as untyped integer constant `3`, using `big.Int`.
3. The destination is a fresh `int` (default type for untyped integer).
4. The constant `3` is converted to int; range-checked; emitted as a constant 3.
5. SSA generation may fold it further (constant propagation).
6. Code generation emits the immediate.

For non-constant arithmetic, the SSA pass relies on the target's native width. On amd64, `int` is 64-bit; on a 32-bit ARM, 32-bit. The compiler emits the appropriate ADD/IMUL instruction.

For overflow, no instrumentation is added — the ADD just wraps. The user is responsible for checks.

---

## 9. `math/big` Internals (High-Level)

`big.Int` is a `nat` (slice of `Word`s) plus a sign bit. Operations are implemented in:

- `src/math/big/nat.go` (low-level slice operations)
- `src/math/big/int.go` (signed wrappers)

Multiplication uses Karatsuba above a threshold; smaller multiplications use schoolbook.

Allocation is significant: every operation may allocate a new slice. The `Int.Set`, `Int.Add` style allows reusing receivers to amortize.

`big.Float` uses a `nat` mantissa, an int32 exponent, and a precision in bits. Rounding modes are configurable.

---

## 10. Production Patterns

### 10.1 Saturating Counters

```go
type SatInt64 int64

func (s *SatInt64) Add(v int64) {
    sum := int64(*s) + v
    if v > 0 && sum < int64(*s) { *s = math.MaxInt64; return }
    if v < 0 && sum > int64(*s) { *s = math.MinInt64; return }
    *s = SatInt64(sum)
}
```

Used in metrics where exact accumulation matters less than bounded behavior.

### 10.2 Money via Integer Minor Units

```go
type Money struct {
    Units    int64 // major units (dollars)
    Subunits int32 // minor units (cents); 0..99 for USD
    Currency string
}
```

Or, more commonly, a pure-integer cents representation:

```go
type Cents int64
```

Aggregations remain exact. Display formats the cents.

### 10.3 Validated Decoding

```go
type Length uint32

func (l *Length) UnmarshalBinary(data []byte) error {
    if len(data) < 4 { return errors.New("short") }
    v := binary.BigEndian.Uint32(data)
    if v > MaxAllowedLength { return errors.New("too large") }
    *l = Length(v)
    return nil
}
```

User-supplied lengths must be bounded BEFORE being used as allocation sizes.

### 10.4 Deterministic Float Math

Go's float operations follow IEEE 754 with round-half-to-even. This means cross-platform results are bit-identical for the same inputs (for basic ops like add/mul/div). Exotic functions (`Sin`, `Pow`, etc.) are NOT bit-identical across platforms because they call platform `libm`.

For deterministic ML / scientific results across platforms, stick to basic ops or use `math` functions in Go's pure-Go variants (most functions in stdlib `math` are pure Go on most platforms).

### 10.5 Profile-Guided Conversion

In CockroachDB-style decimal-heavy workloads, hot paths sometimes get specialized:

- Detect "value fits in int64" path; use the fast int64 op.
- Fallback to `apd.Decimal` when needed.

The decision is made per row, with a hot path that's nearly as fast as native int64.

---

## 11. Edge Cases the Spec Calls Out

### 11.1 Constant Overflow

Spec: typed constants must fit. Untyped constants can be arbitrary.

### 11.2 Conversion of Floats with NaN / Inf to Int

Implementation-defined. Spec text:

> "if the result type cannot represent the value, the conversion succeeds but the result value is implementation-dependent."

For NaN, Go on amd64 returns `0` for unsigned and `MinIntN` for signed (as of Go 1.17+); on other platforms historically different.

### 11.3 Integer Division by Zero

Spec: panic with `runtime.Error`.

### 11.4 Signed Integer Division Edge Case

`math.MinInt32 / -1` overflows because `-MinInt32` is one more than `MaxInt32`. In Go, this is defined wrap (the result is `MinInt32`, not a panic). Some other languages (Java) throw an `ArithmeticException`.

```go
var x int32 = math.MinInt32
fmt.Println(x / -1) // -2147483648 (wrap; defined)
```

### 11.5 Right Shift of Negative

Spec: arithmetic shift (sign-preserving) for signed types.

```go
var x int32 = -16
fmt.Println(x >> 2) // -4
```

For unsigned, logical shift (zero-fill).

---

## 12. Reading the Compiler

Source files of interest:

- `src/cmd/compile/internal/types2/const.go` — constant evaluation
- `src/cmd/compile/internal/types2/operand.go` — operand classification
- `src/cmd/compile/internal/typecheck/const.go` — older type-check path
- `src/cmd/compile/internal/ssa/rewriteAMD64.go` — overflow-aware lowering
- `src/math/bits/bits.go` — overflow-aware primitives
- `src/math/big/nat.go` — arbitrary precision

Read for understanding; don't take a dependency.

---

## 13. Constant Float Evaluation

Float constants use arbitrary-precision rationals during evaluation. The compiler converts to `float64` (or `float32`) only when assigning to a typed context:

```go
const x = 1.0 / 3.0      // arbitrary precision rational, untyped
var y float64 = x        // converted at this point; rounded to nearest float64
```

For `big.Float` representation in the compiler, the precision is set very high (typically 256 bits) so intermediate results don't lose precision.

---

## 14. Determinism Across Runs

Within a single program, the same operation on the same inputs always produces the same result (Go is deterministic at the IEEE 754 level for basic ops). Across compilers / Go versions:

- Basic ops: identical.
- Transcendental: may differ (libm specifics).
- Constant folding: identical (compiler uses arbitrary precision).

For reproducible scientific results, prefer Go's pure-Go `math` implementations and avoid CGO bridges to platform-specific libm.

---

## 15. Self-Assessment Checklist

- [ ] I can describe IEEE 754 binary64 layout from memory
- [ ] I know ULP magnitudes at common scales
- [ ] I understand subnormals
- [ ] I know how `cmd/compile` evaluates untyped constants
- [ ] I know float-to-int OOB is implementation-defined
- [ ] I know integer division by zero panics; float doesn't
- [ ] I can explain Kahan summation
- [ ] I can read and reason about `math/bits` primitives
- [ ] I understand the difference between `big.Float` and decimal libraries

---

## 16. Summary

Senior numeric work means treating types as bit patterns: knowing IEEE 754 down to subnormal granularity, knowing the spec's defined wrap and its undefined corners (float-to-int OOB), knowing how the compiler evaluates constants with arbitrary precision via `big.Float`, and applying that knowledge in production patterns — saturating counters, integer money, validated decoding, deterministic float math. You don't memorize the rules; you internalize them.

---

## 17. Further Reading

- [Go spec: Numeric types](https://go.dev/ref/spec#Numeric_types)
- [Go spec: Constant expressions](https://go.dev/ref/spec#Constant_expressions)
- [Go spec: Conversions](https://go.dev/ref/spec#Conversions)
- [`cmd/compile/internal/types2`](https://cs.opensource.google/go/go/+/refs/heads/master:src/cmd/compile/internal/types2/)
- [`math/big` source](https://cs.opensource.google/go/go/+/refs/heads/master:src/math/big/)
- [`math/bits` source](https://cs.opensource.google/go/go/+/refs/heads/master:src/math/bits/)
- [IEEE 754-2019](https://standards.ieee.org/ieee/754/6210/)
- [Goldberg, "What every CS should know about FP"](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)
- [Bruce Dawson, "Comparing floating-point numbers"](https://randomascii.wordpress.com/2012/02/25/comparing-floating-point-numbers-2012-edition/)
