# Go Overflow and Precision — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What happens on signed integer overflow in Go? How is this different from C?**

**Answer**: In Go, signed integer overflow is **defined behavior**: the value wraps two's complement. `math.MaxInt8 + 1 == math.MinInt8`. There's no panic, no error.

In C/C++, signed integer overflow is **undefined behavior**: the compiler may assume it never happens and optimize accordingly. This is a source of countless real-world bugs and security issues in C codebases.

```go
var x int8 = 127
x++
fmt.Println(x) // -128 (defined wrap)
```

Unsigned overflow wraps modulo `2^N` in both Go and C.

---

**Q2: Why is `0.1 + 0.2 != 0.3` in Go (and almost every language)?**

**Answer**: IEEE 754 binary floats can't represent most decimal fractions exactly. `0.1`, `0.2`, and `0.3` are all stored as approximations. The sum of the approximations of `0.1` and `0.2` rounds to a different float64 than the approximation of `0.3`.

```go
fmt.Printf("%.20f\n", 0.1+0.2) // 0.30000000000000004441
fmt.Printf("%.20f\n", 0.3)     // 0.29999999999999998890
```

The two values differ in their last bits. This is unavoidable in any binary float system. Languages with exact decimal types (Java's BigDecimal, Python's Decimal, Go's `shopspring/decimal`) avoid the issue.

---

**Q3: What are the ranges of int8, int16, int32, int64?**

**Answer**:

| Type | Min | Max |
|------|-----|-----|
| int8 | -128 | 127 |
| int16 | -32768 | 32767 |
| int32 | -2147483648 | 2147483647 |
| int64 | -9223372036854775808 | 9223372036854775807 |

Unsigned versions go from 0 to `2^N - 1`.

`int` is platform-dependent: 32 or 64 bits (almost always 64 today).

The `math` package exports constants: `math.MaxInt8`, `math.MinInt8`, etc.

---

**Q4: How do you test if a float is NaN?**

**Answer**: Use `math.IsNaN`. Don't use `==`, because `NaN != NaN`:

```go
import "math"

x := math.NaN()
fmt.Println(x == x)        // false
fmt.Println(math.IsNaN(x)) // true
```

For infinity, use `math.IsInf(x, sign)` where sign is `1`, `-1`, or `0` for either.

---

**Q5: What does `int(math.MaxFloat64)` return?**

**Answer**: It's **implementation-defined** by the Go spec. The result depends on the Go version and architecture. Don't rely on a specific value. Always range-check before float-to-int conversion:

```go
if math.IsNaN(f) || math.IsInf(f, 0) ||
   f < math.MinInt64 || f > math.MaxInt64 {
    return 0, errors.New("out of range")
}
return int64(f), nil
```

---

**Q6: What does this code do?**

```go
for i := int8(0); i < 200; i++ { ... }
```

**Answer**: Infinite loop. `int8` ranges from -128 to 127. The condition `i < 200` is always true (200 isn't even representable). When `i` reaches 127 and increments, it wraps to -128 — never reaching 200.

Use `int` for loop counters by default.

---

## Middle Level Questions

**Q7: How would you safely add two int64 values and detect overflow?**

**Answer**: Use a checked-add helper:

```go
import "math"

func addInt64(a, b int64) (int64, bool) {
    sum := a + b
    if (a > 0 && b > 0 && sum < a) ||
       (a < 0 && b < 0 && sum > a) {
        return 0, false
    }
    return sum, true
}
```

This relies on the property that if both operands have the same sign, the sum should preserve that sign; if not, overflow occurred.

Alternative: use `math/bits.Add64` for unsigned, then translate. Or use `math/big.Int` if input is unbounded.

---

**Q8: What's the difference between float32 and float64? When would you use each?**

**Answer**:

| Aspect | float32 | float64 |
|--------|---------|---------|
| Bits | 32 | 64 |
| Mantissa | 24 (23 explicit + 1 implicit) | 53 |
| Decimal digits | ~7 | ~15-17 |
| Range | ~10^-38 to 10^38 | ~10^-308 to 10^308 |
| Memory | 4 bytes | 8 bytes |

Use **float64** by default. The precision is much higher and the modern CPU performance difference is negligible for most workloads.

Use **float32** when:
- Memory is constrained (very large arrays in ML models, GPU buffers).
- A file format / wire format requires it.
- A hardware accelerator (GPU, TPU) prefers it.

Don't use either for money — use a decimal library.

---

**Q9: Why must you avoid using float for currency?**

**Answer**: Three reasons:

1. **Decimals aren't exact**: `0.1 + 0.2 != 0.3`. Money math accumulates errors.
2. **Comparison is fragile**: `total == expected` may fail due to rounding.
3. **Display ambiguity**: `0.1 + 0.2` formats as `0.30000000000000004` — surfaces an internal-representation detail.

Use one of:
- **Integer minor units** (`type Cents int64`). Simplest and fastest.
- **Decimal library** (`shopspring/decimal`, `cockroachdb/apd`). Exact, multi-currency-friendly, slower.

Stripe, PayPal, and most fintech SDKs use integer minor units. Database engines like CockroachDB use decimal.

---

**Q10: When would you use `math/big`?**

**Answer**: When the input is unbounded — you cannot guarantee values fit in any fixed-width integer.

Examples:
- Cryptographic key arithmetic (RSA, modular exponentiation).
- Cryptocurrency balances measured in wei (Ethereum).
- Factorials, combinatorics, large-integer math problems.
- Parsing arbitrary-precision JSON numbers.

`big.Int` is for unbounded integers. `big.Float` is binary float with adjustable mantissa precision (NOT a decimal type). `big.Rat` is exact rationals.

Don't use `math/big` when input fits in int64 — it's 30-100x slower with allocations.

---

**Q11: What's the difference between `math/bits.Add64` and just adding two uint64?**

**Answer**: Both perform the same arithmetic. `bits.Add64(a, b, carryIn)` returns `(sum, carryOut)`, telling you whether overflow occurred:

```go
sum, carry := bits.Add64(0xFFFF_FFFF_FFFF_FFFE, 5, 0)
// sum = 3, carry = 1 (overflow)
```

Without `bits.Add64`, you'd have to check overflow manually. With it, you can chain into wider arithmetic — that's how `math/big` is implemented internally.

For the common case where you just want a sum and don't care about overflow, regular `+` is fine.

---

**Q12: What does this print?**

```go
var u uint8 = 0
u--
fmt.Println(u)
```

**Answer**: `255`. Unsigned decrement wraps modulo 2^N. `0 - 1 ≡ 255 (mod 256)`.

This is defined behavior. It's also a common source of bugs when the programmer didn't expect the wrap.

---

## Senior Level Questions

**Q13: Walk through how the Go compiler handles `const x = 1 << 100`.**

**Answer**:

1. Parser produces an AST node for the literal `1 << 100`.
2. Type checker (in `cmd/compile/internal/types2`) treats both operands as untyped constants.
3. The shift is evaluated using `math/big.Int` arithmetic — arbitrary precision.
4. The result is `2^100`, stored as an untyped constant.
5. As long as `x` is used only in untyped contexts or in a context that can hold it (like another `big.Int` calculation), no error.
6. If used in a typed context that can't hold the value (e.g., `var i int = x`), the compiler emits "constant overflows int".

Typed constants (`const x int32 = 1 << 32`) are checked at the declaration: the compiler verifies the value fits.

---

**Q14: Describe IEEE 754 binary64 layout.**

**Answer**: 64 bits total:

```
| sign (1) | exponent (11) | mantissa (52) |
```

- **Sign**: 1 bit (0 = positive, 1 = negative).
- **Exponent**: 11 bits, biased by 1023. Stored exponent values 1..2046 represent unbiased -1022..+1023. 0 marks subnormals/zero, 2047 marks Inf/NaN.
- **Mantissa**: 52 bits, normally with an implicit leading 1 (so effective precision is 53 bits, ~15-17 decimal digits).

Special encodings:
- exp = 0, mantissa = 0: ±0.
- exp = 0, mantissa ≠ 0: subnormal (no implicit 1).
- exp = 2047, mantissa = 0: ±Inf.
- exp = 2047, mantissa ≠ 0: NaN.

Use `math.Float64bits` to inspect the bit pattern.

---

**Q15: What's the implementation-defined behavior the Go spec mentions for float-to-int?**

**Answer**: The Go spec says: "In all non-constant conversions involving floating-point or complex values, if the result type cannot represent the value the conversion succeeds but the result value is implementation-dependent."

This means converting `math.NaN()`, `math.Inf(1)`, or `math.MaxFloat64` to `int64` is legal, but the result varies by implementation.

Pre-Go 1.17 on amd64 the result was sometimes a "garbage" CPU-level value. Go 1.17+ stabilized it (NaN → MinIntN, +Inf → MaxIntN, -Inf → MinIntN, on amd64), but the spec still doesn't guarantee these specifics across architectures.

Lesson: always range-check before `int(f)` for unbounded `f`.

---

**Q16: Why is float addition not associative?**

**Answer**: Each addition rounds to float64. The final rounding depends on intermediate values, which depend on order:

```go
a := 1e20
b := 1.0
c := -1e20

(a + b) + c == 0.0   // a+b loses b (below ULP); +c cancels a
a + (b + c) == 1.0   // b stays (different magnitudes never canceled away)
```

The compiler doesn't reorder float ops by default in Go (correctness over speed). If you write `(a + b) + c`, you get `(a + b) + c` semantically.

Implication: parallel reductions (like SIMD horizontal sum) may produce slightly different results than scalar sums. For deterministic numerical results, fix the order.

---

**Q17: What's a subnormal float and why does it matter?**

**Answer**: For float64, the smallest *normal* value is `2^-1022`. Below this, the implicit leading-1 bit is dropped and the exponent is fixed at -1022. This gives **subnormals** (also called denormals): a graceful underflow zone where precision degrades from 53 bits down to 0.

```go
math.SmallestNonzeroFloat64 // 5e-324, the smallest positive subnormal
```

Subnormals are technically slow on some CPUs (10-100x slower) — flush-to-zero modes mitigate this in performance-critical code. Go doesn't enable FTZ by default.

In practice: only relevant for numerical / scientific code dealing with very small values.

---

**Q18: How does Go handle integer division by zero versus float division by zero?**

**Answer**:

- **Integer / 0** panics with `runtime error: integer divide by zero`.
- **Float / 0**: returns `±Inf` (for non-zero numerator) or `NaN` (for `0/0`). No panic.

```go
fmt.Println(1.0 / 0.0)  // +Inf
fmt.Println(-1.0 / 0.0) // -Inf
fmt.Println(0.0 / 0.0)  // NaN
```

This asymmetry is intentional: integers divide by zero is almost always a bug; floats follow IEEE 754 which defines the special value semantics.

---

**Q19: What's the cost difference between int64 add, math/big.Int add, and decimal add?**

**Answer** (rough orders of magnitude):

| Operation | Cost |
|-----------|------|
| int64 +   | 1 ns |
| math/bits.Add64 | 1-2 ns |
| big.Int.Add (small) | 30-100 ns + alloc |
| big.Int.Add (large) | scales with magnitude |
| shopspring/decimal Add | 100-300 ns + alloc |
| apd.Decimal Add (preallocated) | 50-200 ns |

For hot paths, the difference matters. CockroachDB has a fast-path in its decimal handling: if both operands fit in int64 and have the same scale, native int64 addition; else apd.

---

**Q20: When would you choose `cockroachdb/apd` over `shopspring/decimal`?**

**Answer**:
- **shopspring/decimal**: simpler API, immutable Decimals (each op returns a new value), better for app-level code. Slower because of allocations.
- **cockroachdb/apd**: receiver-style API (you provide the destination), allows pre-allocation, more rounding modes, more configuration. Better for hot-path / library code where you control allocations.

In CockroachDB's SQL engine, `apd.Decimal` is hot-path. In a typical e-commerce backend, `shopspring/decimal` is more common for its simpler ergonomics.

Both are exact decimal — neither suffers from `0.1 + 0.2 != 0.3`.

---

## Scenario-Based Questions

**Q21: Your service summarizes financial reports. Floats appear in the codebase. Where do you start?**

**Answer**:
1. **Audit**: list every place a money value appears as float. Tools: `grep`, `semgrep`, `gosec`.
2. **Decide on representation**: integer cents (or smaller, if regulatory) vs. decimal type.
3. **Introduce Money type**: a `type Money struct { Cents int64; Currency string }` (or similar) that hides the representation.
4. **Migrate boundary**: write paths convert input to Money; read paths convert at display.
5. **Audit serialization**: JSON's "number" type may auto-coerce to float; emit money as a string ("12.34") and parse explicitly.
6. **CI rules**: forbid float in any field name matching money-like patterns.

This is a multi-release migration. Done in pieces with property-based tests confirming exactness.

---

**Q22: You see a unit test failing intermittently with float comparisons. What do you do?**

**Answer**:
1. **Verify the comparison uses tolerance** — if it's `==`, fix it.
2. **Check test inputs** — are they being generated stochastically with float arithmetic somewhere?
3. **Check determinism** — is concurrent code computing the same sum in different orders?
4. **Use ULP-based comparison** if the comparison is inside a property-based test.
5. **Bound the test** — verify `|expected - actual| < eps * max(|expected|, |actual|)`.

If the test is genuinely sensitive to float ordering, document why and consider whether it's testing the right thing.

---

**Q23: A counter `metrics.RequestCount` (int64) overflows after running for 5 years. What's the fix?**

**Answer**: At one request per nanosecond, int64 takes 292 years to overflow — so this scenario is unrealistic at 5 years for most counters. But if it really overflows:

1. **Switch to uint64** if values are non-negative — doubles the range.
2. **Use `math/big.Int`** for unlimited range — slower but reliable.
3. **Implement saturation**: at MaxInt64, stop incrementing.
4. **Implement period reset**: e.g., reset hourly with a separate "epoch" counter.
5. **Add monitoring**: alert when the counter approaches the max.

Most production systems do #3 + #5: saturate gracefully and alert.

---

**Q24: A bank API rejected a request because the amount didn't match. Both sides claim to send "12.34". Diagnose.**

**Answer**: Likely cause: float round-trip. One side parsed "12.34" into float64, then formatted it. The float64 representation isn't exactly 12.34, so re-formatting may produce "12.339999..." (with too many digits) or "12.34" (with implicit truncation).

Diagnosis steps:
1. Check both sides' types: are amounts float or decimal/int?
2. Check serialization: JSON number vs. string.
3. Inspect raw bytes on the wire.
4. If JSON, ensure both encode amounts as strings, not numbers.
5. Standardize on integer cents or decimal type.

This bug is endemic to float-based money APIs. The fix is structural: never round-trip money through float.

---

## FAQ

**Why doesn't Go panic on integer overflow?**

The spec defines wrap semantics. Panicking would be a breaking change and would harm performance (every arithmetic op would need a check). Go provides `math/bits` and `math/big` for code that wants overflow-aware behavior.

---

**Is there a Go equivalent of Java's `BigDecimal`?**

Not in stdlib for decimal. `math/big.Float` is binary-based, not decimal — it doesn't solve the `0.1 + 0.2` issue. For decimal, use `shopspring/decimal` or `cockroachdb/apd` from the ecosystem.

---

**Why does my Go program get different float results than my Python program?**

Likely causes:
- Order of operations (Python and Go may evaluate sums differently).
- Library implementations of transcendentals (`sin`, `pow`, etc.) may differ.
- Float32 vs float64 (Python defaults to 64; check your code).

For basic ops on float64, Go follows IEEE 754 and should give bit-identical results.

---

**Should I use `int` or `int64`?**

For local variables and counters: `int`. It's idiomatic.
For struct fields, public APIs, serialization: usually `int64` (explicit width). Especially in cross-platform code.
For specific widths required by protocols: the exact type (`int32`, `uint16`).

---

**Can Go tell me at runtime if my add overflowed?**

Not natively — there's no overflow flag exposed. Use `math/bits.Add64` for unsigned, or write an explicit check for signed (`(a^s) & (b^s) < 0`).

---

**What's `math.Inf(0)` for?**

`math.Inf` takes a sign argument. `Inf(1)` returns +Inf, `Inf(-1)` returns -Inf. `Inf(0)` is undocumented and should not be used. Pass +1 or -1 explicitly.

---

**Can I use `==` to compare floats that came from the same calculation?**

Sometimes. If both came from identical operations on identical inputs, they'll be bit-identical. But once you start doing arithmetic, results may diverge from textbook expectations. Best practice: use tolerance.

---

**What's the largest integer that `float64` can represent exactly?**

`2^53 = 9007199254740992`. Up to and including this value, every integer has a unique float64 representation. Beyond, gaps appear.

---

**Why does `1e16 + 1 == 1e16`?**

`1e16` is just below `2^53`. The next representable float64 after `1e16` is `2` away (above 2^53, ULP grows). `+1` falls in the rounding zone and gets discarded. This is the same reason float can't store all int64 values.

---

**Should I use `gosec` G701 in CI?**

Yes, for any project handling external integer input or doing wide-narrow conversions. It generates false positives sometimes; use `//nolint:gosec` with a reason for legitimate cases.
