# Go Overflow and Precision — Find the Bug

## Instructions

Each exercise contains buggy Go code involving integer overflow or floating-point precision. Identify the bug, explain why, and provide the corrected code. Difficulty: Easy, Medium, Hard.

---

## Bug 1 — Easy — Average of Two Large Ints Overflows

```go
package main

import (
    "fmt"
    "math"
)

func avg(a, b int64) int64 {
    return (a + b) / 2
}

func main() {
    fmt.Println(avg(math.MaxInt64-3, math.MaxInt64-1))
}
```

What's the bug? What does it print?

<details>
<summary>Solution</summary>

**Bug**: `a + b` overflows when both operands are near `math.MaxInt64`. `(MaxInt64-3) + (MaxInt64-1)` wraps to a negative number, and the division produces a meaningless result.

Output (silent overflow):
```
-3   (or similar; result is negative)
```

**Fix** (option A — half-trick that avoids the wider type):
```go
func avg(a, b int64) int64 {
    return a/2 + b/2 + (a%2 + b%2)/2
}
```

The `(a%2 + b%2)/2` term recovers the bit lost when both `a` and `b` are odd.

**Fix** (option B — widen via uint64 if you know both are non-negative):
```go
func avg(a, b uint64) uint64 {
    return (a >> 1) + (b >> 1) + (a & b & 1)
}
```

**Fix** (option C — `math/bits.Add64` and divide):
```go
import "math/bits"

func avgUint64(a, b uint64) uint64 {
    sum, carry := bits.Add64(a, b, 0)
    return (sum >> 1) | (carry << 63)
}
```

**Key lesson**: Naïve `(a + b) / 2` overflows for large ints. Use the half-trick or wider arithmetic.
</details>

---

## Bug 2 — Easy — `0.1 + 0.2 != 0.3` (Money Edition)

```go
package main

import "fmt"

func main() {
    price := 0.10
    tax := 0.20
    total := price + tax
    
    if total == 0.30 {
        fmt.Println("exactly thirty cents")
    } else {
        fmt.Printf("not exactly thirty cents: got %.20f\n", total)
    }
}
```

What's the bug?

<details>
<summary>Solution</summary>

**Bug**: `0.1 + 0.2` is not exactly `0.3` in float64. The sum is `0.30000000000000004`. The comparison fails.

Output:
```
not exactly thirty cents: got 0.30000000000000004441
```

**Fix** — for money, never use float. Use integer cents:

```go
type Cents int64

func main() {
    price := Cents(10)
    tax := Cents(20)
    total := price + tax
    if total == 30 {
        fmt.Println("exactly thirty cents")
    }
}
```

Or use a decimal library:
```go
import "github.com/shopspring/decimal"

price, _ := decimal.NewFromString("0.10")
tax, _ := decimal.NewFromString("0.20")
total := price.Add(tax)
if total.Equal(decimal.RequireFromString("0.30")) {
    fmt.Println("exactly thirty cents")
}
```

**Key lesson**: Never use `float64` for money. Use integer minor units or a decimal library.
</details>

---

## Bug 3 — Easy — `int(math.MaxFloat64)` Is Implementation-Defined

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    huge := math.MaxFloat64
    fmt.Println(int(huge))
}
```

What's the issue?

<details>
<summary>Solution</summary>

**Bug**: Converting an out-of-range float to int is **implementation-defined** by the Go spec. The result varies by Go version and architecture. Historically it was unpredictable; Go 1.17+ on amd64 returns a deterministic but still-implementation-defined value.

Don't rely on a specific result.

**Fix** — range-check before converting:

```go
func toInt64(f float64) (int64, bool) {
    if math.IsNaN(f) || math.IsInf(f, 0) {
        return 0, false
    }
    if f < float64(math.MinInt64) || f >= float64(math.MaxInt64) {
        return 0, false
    }
    return int64(f), true
}
```

(Note `>=` not `>`: `float64(math.MaxInt64)` rounds up, so `>=` correctly excludes that case.)

**Key lesson**: Out-of-range float-to-int is implementation-defined. Always range-check.
</details>

---

## Bug 4 — Easy — int8 Loop That Never Ends

```go
package main

import "fmt"

func main() {
    for i := int8(0); i < 200; i++ {
        fmt.Println(i)
        if i > 100 {
            break // safety
        }
    }
}
```

What's wrong?

<details>
<summary>Solution</summary>

**Bug**: `int8` ranges from -128 to 127. The condition `i < 200` is always true (i.e., 200 is unreachable). When `i` reaches 127 and increments, it wraps to -128. The loop runs forever (the safety `break` saves it here, but in less defensive code, this is an infinite loop).

Output starts at 0, climbs to 127, jumps to -128, climbs back up, hits the safety break at 101.

**Fix** — use `int` (or a wide enough type):

```go
for i := 0; i < 200; i++ {
    fmt.Println(i)
}
```

Or, if you must use int8, ensure the bound fits:

```go
for i := int8(0); i < 100; i++ {
    fmt.Println(i)
}
```

**Key lesson**: Choose a type that can hold both endpoints AND the value just past the upper bound. Use `int` for loop counters by default.
</details>

---

## Bug 5 — Easy — Float Equality

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    x := math.Sqrt(2.0)
    y := x * x
    if y == 2.0 {
        fmt.Println("exact")
    } else {
        fmt.Printf("not exact: %.20f\n", y)
    }
}
```

What does this print? Is it a bug?

<details>
<summary>Solution</summary>

**Bug**: `math.Sqrt(2)` is irrational and stored as the nearest float64. Squaring it gives back something close to 2 but not exactly:

Output:
```
not exact: 2.00000000000000044409
```

**Fix** — use tolerance:

```go
func equal(a, b, eps float64) bool {
    return math.Abs(a-b) <= eps
}

if equal(y, 2.0, 1e-9) {
    fmt.Println("approximately equal")
}
```

Or use ULP-based comparison for fairness across magnitudes.

**Key lesson**: Floats are approximate. `==` is usually wrong for derived float values. Use a tolerance.
</details>

---

## Bug 6 — Medium — Constant vs Runtime Shift

```go
package main

import "fmt"

func main() {
    var x int32 = 1
    
    // Case 1: constant shift — compile error
    // const c = x << 32   // ERROR: shift count too large

    // Case 2: variable shift at runtime
    var s uint = 32
    y := x << s
    fmt.Println(y)
}
```

What does Case 2 print?

<details>
<summary>Solution</summary>

**Discussion**: Pre-Go 1.13 the behavior of shifting beyond the bit width was platform-dependent (some CPUs masked the shift count, some returned 0, some returned the original).

Go 1.13+ explicitly defines: shifts >= bit-width return 0 for non-negative values; for signed, the result is also 0 (or `-1` for negative-shift semantics that Go doesn't have).

Output:
```
0
```

This is **defined**, but easy to misuse. If you intended a 32-bit shift on int32 to yield a non-zero value, you have a logic bug.

**Fix** — check the shift count:

```go
if s < 32 {
    y := x << s
} else {
    // overflow / zero — handle explicitly
}
```

Or widen first:

```go
y := int64(x) << s
```

**Constant case**: shifts beyond width on typed constants are caught at compile time:

```go
var x int32 = 1
const s = 32
// y := x << s   // ERROR if x is typed and s pushes out of width? Actually: this depends on context.
```

The compiler is strictest with `const x int32 = 1 << 32` style declarations.

**Key lesson**: Shifts >= bit-width are defined as zero in Go 1.13+. For constant shifts, the compiler catches typed overflow.
</details>

---

## Bug 7 — Medium — Catastrophic Cancellation

```go
package main

import (
    "fmt"
    "math"
)

func quadratic(a, b, c float64) (r1, r2 float64) {
    d := math.Sqrt(b*b - 4*a*c)
    r1 = (-b + d) / (2 * a)
    r2 = (-b - d) / (2 * a)
    return
}

func main() {
    fmt.Println(quadratic(1, 1e8, 1))
}
```

What's the precision issue?

<details>
<summary>Solution</summary>

**Bug**: For `a=1, b=1e8, c=1`, the discriminant is `b*b - 4 ≈ 1e16`. So `d ≈ 1e8`. Then `r1 = (-1e8 + 1e8) / 2`. The numerator is the difference of two nearly-equal large numbers — most digits cancel; the result has very few significant digits.

`r1` should be approximately `-1e-8`, but the computation yields `0` or a heavily-rounded value.

`r2` is fine: `-1e8 - 1e8 = -2e8`, then divided by 2 = -1e8.

**Fix** — use the alternative form for the small root:

```go
func quadratic(a, b, c float64) (r1, r2 float64) {
    d := math.Sqrt(b*b - 4*a*c)
    var q float64
    if b > 0 {
        q = -(b + d) / 2
    } else {
        q = -(b - d) / 2
    }
    r1 = q / a
    r2 = c / q
    return
}
```

This computes the larger-magnitude root the standard way and the smaller via Vieta (`r1 * r2 = c/a`), avoiding the cancellation.

**Key lesson**: Subtracting nearly-equal floats loses precision. Restructure the computation to avoid the cancellation.
</details>

---

## Bug 8 — Medium — NaN Comparison

```go
package main

import (
    "fmt"
    "math"
)

func sanitize(x float64) float64 {
    if x == math.NaN() {
        return 0
    }
    return x
}

func main() {
    fmt.Println(sanitize(math.NaN())) // expected: 0
}
```

What's wrong?

<details>
<summary>Solution</summary>

**Bug**: `x == math.NaN()` is **always false**. NaN is unequal to everything, including itself. The function never sanitizes.

Output:
```
NaN
```

**Fix** — use `math.IsNaN`:

```go
func sanitize(x float64) float64 {
    if math.IsNaN(x) {
        return 0
    }
    return x
}
```

For `Inf`, similarly use `math.IsInf`.

**Key lesson**: NaN doesn't compare equal to itself. Use `math.IsNaN` to test.
</details>

---

## Bug 9 — Medium — Length Field Overflow

```go
package main

import (
    "encoding/binary"
    "fmt"
)

func parsePacket(data []byte) ([]byte, error) {
    if len(data) < 4 {
        return nil, fmt.Errorf("short")
    }
    length := binary.BigEndian.Uint32(data[:4])
    body := data[4 : 4+length]
    return body, nil
}

func main() {
    bad := []byte{0xff, 0xff, 0xff, 0xff, 1, 2, 3}
    body, err := parsePacket(bad)
    fmt.Println(body, err)
}
```

What goes wrong?

<details>
<summary>Solution</summary>

**Bug**: `length` is `0xffffffff` (~4 billion). `4 + length` may overflow on 32-bit platforms (or wrap when used as a slice index). Even on 64-bit, the slice bound check `4+length` exceeds `len(data)` and causes a runtime panic. Worse, on a malicious input designed to wrap the addition, an attacker can cause undefined behavior.

Output:
```
panic: runtime error: slice bounds out of range
```

**Fix** — bound-check explicitly:

```go
const MaxBody = 1 << 20

func parsePacket(data []byte) ([]byte, error) {
    if len(data) < 4 {
        return nil, fmt.Errorf("short")
    }
    length := binary.BigEndian.Uint32(data[:4])
    if length > MaxBody {
        return nil, fmt.Errorf("length too large: %d", length)
    }
    if int(length) > len(data)-4 {
        return nil, fmt.Errorf("truncated")
    }
    return data[4 : 4+int(length)], nil
}
```

Always:
1. Bound `length` to a known maximum.
2. Convert to `int` only after bounding.
3. Check `length` against remaining buffer.

**Key lesson**: Untrusted length fields can trigger overflow, panic, or memory corruption. Validate before using.
</details>

---

## Bug 10 — Medium — Constant Overflow at Compile Time

```go
package main

import "fmt"

const offset int32 = 1<<31

func main() {
    fmt.Println(offset)
}
```

Does this compile?

<details>
<summary>Solution</summary>

**Bug**: `1<<31` is `2147483648`, which is `math.MaxInt32 + 1`. It overflows `int32`.

Compile error:
```
./main.go:5:7: constant 2147483648 overflows int32
```

The compiler catches this at constant evaluation. Untyped constants can be `1<<31`, but assigning to `int32` triggers the range check.

**Fix** — use `int64` (or `uint32`):

```go
const offset int64 = 1<<31    // OK: int64 fits
const offsetU uint32 = 1<<31  // OK: uint32 fits (1<<31 < 2^32)
```

Or use `math.MinInt32`:

```go
const offset int32 = math.MinInt32 // -2147483648
```

**Key lesson**: Typed constants are checked at compile time. The error fires before any binary is produced.
</details>

---

## Bug 11 — Hard — Subtraction Reveals Hidden Inequality

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    a := 1e20
    b := 1.0
    c := -1e20
    
    sum1 := a + b + c
    sum2 := a + c + b
    
    fmt.Println(sum1, sum2)
    fmt.Println(sum1 == sum2)
}
```

What does this print?

<details>
<summary>Solution</summary>

**Discussion**: Float addition is **not associative** because of rounding.

`a + b` = `1e20 + 1` = `1e20` (the `1` is below ULP at this magnitude). Then `1e20 + (-1e20) = 0`.
`a + c` = `1e20 + (-1e20) = 0`. Then `0 + 1 = 1`.

Output:
```
0 1
false
```

**Lesson**: Reordering float operations changes the result. Compilers in Go don't reorder by default for this reason. If you do, you can introduce non-determinism.

**Fix** — for sums, pick an order that minimizes magnitude differences. Sort before summing. Use Kahan or pairwise.

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

For our case:
```go
xs := []float64{1e20, 1, -1e20}
fmt.Println(kahanSum(xs)) // 1
```

**Key lesson**: Float addition isn't associative. Order matters. Kahan / pairwise / sort-before-sum are remedies.

Use `math.Inf` to identify infinity-related cases:
```go
if math.IsInf(sum, 0) { /* handle */ }
```
</details>

---

## Bug 12 — Hard — Hidden Float Conversion in Generic

```go
package main

import "fmt"

func Avg[T int | float64](xs []T) T {
    var sum T
    for _, x := range xs {
        sum += x
    }
    return sum / T(len(xs))
}

func main() {
    xs := []int{math.MaxInt - 100, math.MaxInt - 100, math.MaxInt - 100}
    fmt.Println(Avg(xs))
}
```

What's the issue?

<details>
<summary>Solution</summary>

**Bug**: For the `int` instantiation, `sum += x` overflows after a few iterations. The result is a wrapped value, then divided by 3 — meaningless.

For the `float64` instantiation, the same input would lose precision but not wrap.

Output (int):
```
some negative number / 3
```

**Fix** — accumulate in a wider type when possible, or check for overflow:

```go
func AvgInt(xs []int) (int, bool) {
    var sum int64
    for _, x := range xs {
        s := sum + int64(x)
        // overflow check
        if (sum > 0 && int64(x) > 0 && s < sum) ||
           (sum < 0 && int64(x) < 0 && s > sum) {
            return 0, false
        }
        sum = s
    }
    return int(sum / int64(len(xs))), true
}
```

For generics, you can't easily widen since `T` is the user-chosen type. Document the assumption (sum fits in T) or use a different signature:

```go
func AvgFloat[T int | float64](xs []T) float64 {
    var sum float64
    for _, x := range xs {
        sum += float64(x)
    }
    return sum / float64(len(xs))
}
```

The float64 result is approximate, but won't overflow.

**Key lesson**: Naive averaging can overflow. Generics inherit the same constraint. Either widen the accumulator, document the assumption, or signal overflow.
</details>

---

## Bonus Bug — Hard — Right Shift of Negative

```go
package main

import "fmt"

func main() {
    var x int8 = -8
    fmt.Println(x >> 1) // ?
    
    var u uint8 = 248 // same bits as -8 in int8
    fmt.Println(u >> 1) // ?
}
```

<details>
<summary>Solution</summary>

**Discussion**: Right shift in Go is *arithmetic* for signed types (sign-extending) and *logical* for unsigned types (zero-fill).

For `int8(-8) = 0xF8`:
- `>> 1` arithmetic: `0xFC = -4`. Output: `-4`.

For `uint8(248) = 0xF8`:
- `>> 1` logical: `0x7C = 124`. Output: `124`.

Output:
```
-4
124
```

**Lesson**: The same bit pattern produces different results depending on the type's signedness. Be intentional.

**Fix** — none needed; this is correct behavior. The bug would be expecting one and getting the other:

```go
// Wrong: thinking signed right-shift gives logical shift
var x int32 = -1
fmt.Println(x >> 31) // -1, not 1
```

For logical shifts on signed values, convert to unsigned first:

```go
var x int32 = -1
fmt.Println(int32(uint32(x) >> 31)) // 1
```

**Key lesson**: Signed right-shift is arithmetic; unsigned is logical. Choose the type to match the intent.
</details>
