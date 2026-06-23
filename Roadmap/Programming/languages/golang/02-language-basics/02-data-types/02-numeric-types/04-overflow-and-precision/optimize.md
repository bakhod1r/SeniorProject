# Go Overflow and Precision — Optimize

## Instructions

Each exercise presents inefficient or imprecise numeric code. Identify the issue, write an optimized version, and explain. Difficulty: Easy, Medium, Hard.

---

## Exercise 1 — Easy — Avoid `math/big` When You Don't Need It

**Problem**:
```go
import "math/big"

func sumOf(xs []int64) *big.Int {
    out := new(big.Int)
    for _, x := range xs {
        out.Add(out, big.NewInt(x))
    }
    return out
}
```

**Question**: For a slice of 1000 int64s with bounded magnitudes (each less than 1e15), is `math/big` warranted?

<details>
<summary>Solution</summary>

**Issue**: `math/big.Int.Add` allocates and is ~30-100x slower than int64 add. For sums that fit in int64, this is wasteful.

**Optimization** — use int64 with overflow detection only when necessary:

```go
func sumOf(xs []int64) (int64, bool) {
    var sum int64
    for _, x := range xs {
        s := sum + x
        if (sum > 0 && x > 0 && s < sum) || (sum < 0 && x < 0 && s > sum) {
            return 0, false
        }
        sum = s
    }
    return sum, true
}
```

If the sum fits, return it; otherwise signal overflow.

**Benchmark** (1000 elements):
- big.Int version: ~50 µs, 1000 allocations.
- int64 version: ~0.5 µs, 0 allocations.

**Key insight**: Use `math/big` only when the input is genuinely unbounded.
</details>

---

## Exercise 2 — Easy — Reuse big.Int Receivers

**Problem**:
```go
sum := big.NewInt(0)
for _, x := range xs {
    sum = new(big.Int).Add(sum, big.NewInt(x))
}
```

**Question**: How many allocations? How do you reduce?

<details>
<summary>Solution</summary>

**Issue**: Each iteration allocates two `big.Int`: one for the temporary `Add` result, one for `big.NewInt(x)`. For N elements, 2N allocations.

**Optimization** — reuse:

```go
sum := new(big.Int)
tmp := new(big.Int)
for _, x := range xs {
    tmp.SetInt64(x)
    sum.Add(sum, tmp)
}
```

Now allocations: 2 total, regardless of N.

**Benchmark** (10000 elements, each fits in int64):
- Naive: ~20000 allocations, ~2 ms.
- Reused: 2 allocations, ~1.5 ms.

The allocation count drops; the time drops a bit because GC pressure falls.

**Key insight**: `math/big` operations are receiver-style. Use `Set*` and reuse receivers in loops.
</details>

---

## Exercise 3 — Easy — Use math/bits Instead of Wider Type

**Problem**:
```go
func avgUint64(a, b uint64) uint64 {
    // wide intermediate
    return uint64((uint128{hi: 0, lo: a} + uint128{hi: 0, lo: b}).lo / 2)
}
```

(Pretend uint128 is a hand-rolled wide integer.)

**Question**: Better way?

<details>
<summary>Solution</summary>

**Optimization** — use `bits.Add64` to detect carry:

```go
import "math/bits"

func avgUint64(a, b uint64) uint64 {
    sum, carry := bits.Add64(a, b, 0)
    return (sum >> 1) | (carry << 63)
}
```

The carry shifts back into the high bit of the result, then a single right-shift halves.

Or, the traditional half-trick:

```go
func avgUint64(a, b uint64) uint64 {
    return (a / 2) + (b / 2) + (a & b & 1)
}
```

Both avoid the overflow without a wide intermediate.

**Benchmark**: both are ~1 ns/op. The hand-rolled wide version is much slower.

**Key insight**: Use `math/bits` primitives or arithmetic identities to avoid wider types.
</details>

---

## Exercise 4 — Medium — Decimal Allocation in Hot Path

**Problem**:
```go
import "github.com/shopspring/decimal"

func totalPrice(prices []decimal.Decimal) decimal.Decimal {
    sum := decimal.Zero
    for _, p := range prices {
        sum = sum.Add(p)
    }
    return sum
}
```

**Question**: For a hot path summing 100k prices/second, what's the cost?

<details>
<summary>Solution</summary>

**Issue**: Each `Add` returns a new `decimal.Decimal`. For 100k calls/sec, you allocate 100k decimals/sec. GC pressure can dominate.

**Optimization 1** — use int64 cents if values fit:

```go
type Cents int64

func totalCents(prices []Cents) Cents {
    var sum Cents
    for _, p := range prices {
        sum += p
    }
    return sum
}
```

For typical prices fitting in int64 cents, this is 100-1000x faster.

**Optimization 2** — if you must use decimal, switch to `cockroachdb/apd` with a pre-allocated context:

```go
import "github.com/cockroachdb/apd/v3"

func totalApd(prices []*apd.Decimal) *apd.Decimal {
    ctx := apd.BaseContext.WithPrecision(20)
    sum := new(apd.Decimal)
    for _, p := range prices {
        ctx.Add(sum, sum, p)
    }
    return sum
}
```

apd allows pre-allocated `Decimal` receivers.

**Benchmark** (100k decimals):
- shopspring add: ~30 ms, 100k allocations.
- apd add (reused): ~10 ms, ~0 allocations.
- int64 cents: ~0.1 ms, 0 allocations.

**Key insight**: For money-heavy hot paths, int64 cents wins. apd is a middle ground; shopspring is convenient but allocates.
</details>

---

## Exercise 5 — Medium — Float Sum Loses Precision

**Problem**:
```go
func sumFloats(xs []float64) float64 {
    var sum float64
    for _, x := range xs {
        sum += x
    }
    return sum
}
```

For 10 million `0.1`s, the sum drifts from the expected `1e6` by tens of ULPs.

**Question**: How do you reduce error without changing the type?

<details>
<summary>Solution</summary>

**Optimization** — Kahan summation:

```go
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
```

Or pairwise summation (better cache behavior, similar accuracy):

```go
func pairwiseSum(xs []float64) float64 {
    if len(xs) <= 1 {
        if len(xs) == 0 { return 0 }
        return xs[0]
    }
    mid := len(xs) / 2
    return pairwiseSum(xs[:mid]) + pairwiseSum(xs[mid:])
}
```

**Benchmark** (10 million 0.1s):
- Naive: ~10 ms, error ~1e-9.
- Kahan: ~30 ms, error ~1e-15.
- Pairwise: ~12 ms, error ~1e-12.

**Key insight**: Naive sum accumulates error. Kahan and pairwise reduce it. Pick based on speed/accuracy tradeoff.
</details>

---

## Exercise 6 — Medium — int8 Loop in Hot Path

**Problem**:
```go
for i := int8(0); i < 100; i++ {
    process(i)
}
```

**Question**: Is there a performance reason to keep `int8`?

<details>
<summary>Solution</summary>

**Discussion**: Almost never. On amd64, registers are 64-bit. Loading an int8 requires a sign-extend; storing requires a narrow store. The CPU does the same work as for int64, sometimes more.

The reason to use int8 is *memory*: when you store millions of values, the smaller type halves the cache footprint. For a single counter, no benefit.

**Optimization** — use `int`:

```go
for i := 0; i < 100; i++ {
    process(i)
}
```

**Benchmark**: identical or slightly faster than int8 in tight loops.

**Bonus risk**: an int8 loop with `i < 200` is an infinite loop because `i` wraps at 127. Use `int` to avoid.

**Key insight**: Use the smallest type only when memory matters (millions of values stored). For local counters, use `int`.
</details>

---

## Exercise 7 — Medium — Repeated Conversion Float-to-Int

**Problem**:
```go
total := 0
for _, f := range floats {
    total += int(f) // truncates each value
}
```

If many floats are nearly-integer (e.g., 99.999999), the truncation loses ~1 per value.

**Question**: Better?

<details>
<summary>Solution</summary>

**Issue**: `int(99.999999) == 99`. Over many values, the cumulative error grows.

**Optimization 1** — round, don't truncate:

```go
total := 0
for _, f := range floats {
    total += int(math.Round(f))
}
```

**Optimization 2** — sum as float, convert once:

```go
var sum float64
for _, f := range floats {
    sum += f
}
total := int(math.Round(sum))
```

This is faster (one conversion) and may be more accurate (single rounding step).

**Benchmark** (100k floats):
- Trunc per element: ~150 µs, ~99% accuracy.
- Round per element: ~150 µs, ~99.99%.
- Sum-then-round: ~80 µs, ~99.99%.

**Key insight**: Convert once at the boundary, not per element. And prefer rounding to truncation when the values are conceptually integers.
</details>

---

## Exercise 8 — Hard — SIMD via stdlib (Implicit)

**Problem**:
```go
func dotProduct(a, b []float64) float64 {
    var sum float64
    for i := range a {
        sum += a[i] * b[i]
    }
    return sum
}
```

**Question**: How does Go vectorize this?

<details>
<summary>Solution</summary>

**Discussion**: Go's compiler does NOT auto-vectorize as aggressively as gcc/clang. For float64 dot product on amd64, the inner loop is scalar.

**Optimization 1** — manual unrolling helps modestly:

```go
func dotProduct(a, b []float64) float64 {
    var s0, s1, s2, s3 float64
    n := len(a) - len(a)%4
    for i := 0; i < n; i += 4 {
        s0 += a[i] * b[i]
        s1 += a[i+1] * b[i+1]
        s2 += a[i+2] * b[i+2]
        s3 += a[i+3] * b[i+3]
    }
    sum := s0 + s1 + s2 + s3
    for i := n; i < len(a); i++ {
        sum += a[i] * b[i]
    }
    return sum
}
```

This breaks the dependency chain on `sum`, letting the CPU pipeline more efficiently.

**Optimization 2** — assembly. Many ML libraries (e.g., `gonum`) ship hand-written AVX assembly for dot product, sum, and other primitives. This is the only way to get ~3x SIMD speedup over scalar Go.

**Benchmark** (1024 elements):
- Naive: ~600 ns.
- Unrolled: ~400 ns.
- Asm AVX (gonum): ~150 ns.

**Key insight**: Go doesn't vectorize automatically. Manual unrolling helps. For maximum speed, use libraries with assembly kernels.
</details>

---

## Exercise 9 — Hard — Bit Tricks for Saturation

**Problem**:
```go
func saturatingAddUint8(a, b uint8) uint8 {
    sum := uint16(a) + uint16(b)
    if sum > 255 {
        return 255
    }
    return uint8(sum)
}
```

**Question**: Faster way without the wider intermediate?

<details>
<summary>Solution</summary>

**Optimization** — use math/bits:

```go
import "math/bits"

func saturatingAddUint8(a, b uint8) uint8 {
    sum, carry := bits.Add32(uint32(a), uint32(b), 0)
    if carry == 1 || sum > 255 {
        return 255
    }
    return uint8(sum)
}
```

Or, branchless:

```go
func saturatingAddUint8(a, b uint8) uint8 {
    s := uint16(a) + uint16(b)
    overflow := s >> 8 // 1 if overflow
    return uint8((s | (-overflow)) & 0xff)
}
```

The wider intermediate is unavoidable for uint8 (the sum can exceed 8 bits), but the branchless version is one or two cycles faster on hot paths.

**Benchmark** (1M iterations):
- Branched: ~1.5 ms.
- Branchless: ~1.0 ms.
- bits.Add32: ~1.2 ms.

**Key insight**: For tiny types like uint8, intermediates are usually unavoidable. Branchless tricks help in extreme hot paths.
</details>

---

## Exercise 10 — Hard — Decimal "Fast Path"

**Problem**:
```go
import "github.com/cockroachdb/apd/v3"

func add(a, b *apd.Decimal) *apd.Decimal {
    out := new(apd.Decimal)
    apd.BaseContext.Add(out, a, b)
    return out
}
```

**Question**: Can you specialize for the case when both decimals fit in int64 with the same scale?

<details>
<summary>Solution</summary>

**Optimization** — fast path:

```go
func addFast(a, b *apd.Decimal) *apd.Decimal {
    if a.Form == apd.Finite && b.Form == apd.Finite &&
        a.Coeff.IsInt64() && b.Coeff.IsInt64() &&
        a.Exponent == b.Exponent {
        ai, bi := a.Coeff.Int64(), b.Coeff.Int64()
        sum, ok := safeAddInt64(ai, bi)
        if ok {
            out := new(apd.Decimal)
            out.SetInt64(sum)
            out.Exponent = a.Exponent
            return out
        }
    }
    out := new(apd.Decimal)
    apd.BaseContext.Add(out, a, b)
    return out
}
```

Same scale + fits-in-int64 → native int64 add. Otherwise → apd.

**Benchmark** (mostly small values):
- Pure apd: ~150 ns/op.
- Fast path: ~10 ns/op (90%+ hit rate).

CockroachDB's SQL engine uses this strategy. See [`pkg/sql/sem/eval/binary_op.go`](https://github.com/cockroachdb/cockroach).

**Key insight**: Specialize for the common case. Decimal libraries are slow on average; with a hot-path optimizer, they can compete with int64 for typical workloads.
</details>

---

## Exercise 11 — Hard — Avoid math.Pow for Integer Exponents

**Problem**:
```go
result := math.Pow(2.0, float64(n))
```

For integer `n`, this goes through float64 transcendental; not exact for some n; allocates inside `Pow`.

**Question**: Better?

<details>
<summary>Solution</summary>

**Optimization 1** — use bit shift if exponent is non-negative and fits:

```go
if n >= 0 && n < 63 {
    result := int64(1) << n
}
```

**Optimization 2** — for general integer exponents, exponentiation by squaring:

```go
func intPow(base, exp int) int {
    result := 1
    for exp > 0 {
        if exp&1 == 1 {
            result *= base
        }
        base *= base
        exp >>= 1
    }
    return result
}
```

**Optimization 3** — for powers of 2 in float64 directly, use bit math:

```go
result := math.Float64frombits(uint64(1023+n) << 52) // 2^n exactly
```

This sets the exponent field directly. Exact for any integer n in the float64 exponent range.

**Benchmark** (n=10):
- math.Pow: ~30 ns.
- Bit shift: ~1 ns.
- Square-and-multiply: ~5 ns.
- Direct bit construction: ~1 ns.

**Key insight**: `math.Pow` is for general real-valued bases / exponents. For integers and powers of 2, specialize.
</details>

---

## Bonus Exercise — Hard — Profile and Compare

**Problem**: You have three implementations of "sum a stream of decimals":

1. `[]float64` summed naively.
2. `[]decimal.Decimal` summed via shopspring.
3. `[]Cents` (int64) summed natively.

**Task**: Plan a benchmark, run it, and explain when each wins.

<details>
<summary>Solution</summary>

**Benchmark setup**:

```go
package money

import "testing"

const N = 100_000

func BenchmarkFloat(b *testing.B) {
    xs := make([]float64, N)
    for i := range xs { xs[i] = 0.01 }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var s float64
        for _, x := range xs { s += x }
        _ = s
    }
}

func BenchmarkCents(b *testing.B) {
    xs := make([]int64, N)
    for i := range xs { xs[i] = 1 }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var s int64
        for _, x := range xs { s += x }
        _ = s
    }
}

func BenchmarkDecimal(b *testing.B) {
    xs := make([]decimal.Decimal, N)
    p, _ := decimal.NewFromString("0.01")
    for i := range xs { xs[i] = p }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        s := decimal.Zero
        for _, x := range xs { s = s.Add(x) }
        _ = s
    }
}
```

**Typical results**:
- Float: ~50 µs, 0 allocations, drift (~1e-7 over 100k of 0.01).
- Cents: ~50 µs, 0 allocations, exact.
- Decimal: ~25 ms, 100k allocations, exact.

**When each wins**:
- Cents — money in a single currency, all values in int64 range. Best.
- Decimal — multi-currency, complex tax calculations, regulatory exact-decimal requirement. Necessary even when slow.
- Float — never for money. Useful only if the system doesn't care about the last few digits.

**Key insight**: Measure, don't guess. The right answer depends on the constraints (precision required, throughput needed, codebase complexity).
</details>
