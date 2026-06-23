# Go Overflow and Precision — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Write idiomatic Go; range-check at boundaries; never use float for money.

---

## Task 1 — Range-Check Conversion

**Difficulty**: Beginner
**Topic**: Narrowing conversion safety

**Description**: Implement `ToInt32(x int64) (int32, error)` that returns the int32 equivalent if in range, otherwise an error.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
    "math"
)

var ErrRange = errors.New("out of int32 range")

func ToInt32(x int64) (int32, error) {
    // TODO
    return 0, nil
}

func main() {
    fmt.Println(ToInt32(123))
    fmt.Println(ToInt32(int64(math.MaxInt32) + 1))
    fmt.Println(ToInt32(int64(math.MinInt32) - 1))
}
```

**Expected Output**:
```
123 <nil>
0 out of int32 range
0 out of int32 range
```

**Evaluation Checklist**:
- [ ] Checks against `math.MinInt32` and `math.MaxInt32`
- [ ] Returns `ErrRange` (or wrapped) on out-of-range
- [ ] Casts with `int32(x)` only after the check
- [ ] No reliance on overflow wrap

---

## Task 2 — Saturating Add

**Difficulty**: Beginner
**Topic**: Saturating arithmetic

**Description**: Implement `SaturatingAddInt64(a, b int64) int64` that returns `math.MaxInt64` on positive overflow and `math.MinInt64` on negative overflow.

**Starter Code**:
```go
package main

import (
    "fmt"
    "math"
)

func SaturatingAddInt64(a, b int64) int64 {
    // TODO
    return 0
}

func main() {
    fmt.Println(SaturatingAddInt64(1, 2))
    fmt.Println(SaturatingAddInt64(math.MaxInt64, 1))
    fmt.Println(SaturatingAddInt64(math.MinInt64, -1))
}
```

**Expected Output**:
```
3
9223372036854775807
-9223372036854775808
```

**Evaluation Checklist**:
- [ ] Detects positive overflow when `b > 0 && a > MaxInt64 - b`
- [ ] Detects negative overflow when `b < 0 && a < MinInt64 - b`
- [ ] Returns clamped value
- [ ] No false positives

---

## Task 3 — Float Equal With Tolerance

**Difficulty**: Beginner
**Topic**: Float comparison

**Description**: Implement `Approx(a, b, eps float64) bool` that returns true if `|a - b| <= eps`. Bonus: handle NaN (return false if either is NaN).

**Starter Code**:
```go
package main

import (
    "fmt"
    "math"
)

func Approx(a, b, eps float64) bool {
    // TODO
    return false
}

func main() {
    fmt.Println(Approx(0.1+0.2, 0.3, 1e-9)) // true
    fmt.Println(Approx(1.0, 2.0, 0.5))      // false
    fmt.Println(Approx(math.NaN(), 0, 1))   // false
}
```

**Expected Output**:
```
true
false
false
```

**Evaluation Checklist**:
- [ ] Returns false if either operand is NaN
- [ ] Uses `math.Abs(a-b) <= eps`
- [ ] Handles `±Inf` correctly (Inf == Inf returns true, ±Inf vs finite returns false)

---

## Task 4 — Money Type

**Difficulty**: Intermediate
**Topic**: Integer money

**Description**: Implement a `Money` type backed by integer cents. Provide `NewMoney(dollars int64, cents int) Money`, `Add(Money) Money`, and `String() string`.

**Starter Code**:
```go
package main

import "fmt"

type Money struct {
    cents int64
}

func NewMoney(dollars int64, cents int) Money {
    // TODO
    return Money{}
}

func (m Money) Add(other Money) Money {
    // TODO
    return Money{}
}

func (m Money) String() string {
    // TODO
    return ""
}

func main() {
    a := NewMoney(12, 34)
    b := NewMoney(7, 89)
    fmt.Println(a, "+", b, "=", a.Add(b))
}
```

**Expected Output**:
```
$12.34 + $7.89 = $20.23
```

**Evaluation Checklist**:
- [ ] Internal representation is integer cents
- [ ] Add works correctly across the dollar boundary (e.g., $0.50 + $0.50 = $1.00)
- [ ] String formats with two decimal places, including leading zero
- [ ] No float64 ever appears

---

## Task 5 — Kahan Summation

**Difficulty**: Intermediate
**Topic**: Compensated summation

**Description**: Implement `KahanSum(xs []float64) float64` that uses Kahan compensation to reduce accumulated error.

**Starter Code**:
```go
package main

import "fmt"

func KahanSum(xs []float64) float64 {
    // TODO
    return 0
}

func main() {
    xs := make([]float64, 10000)
    for i := range xs {
        xs[i] = 0.1
    }
    var naive float64
    for _, x := range xs {
        naive += x
    }
    fmt.Println("naive:", naive)
    fmt.Println("kahan:", KahanSum(xs))
}
```

**Expected Output** (approximate):
```
naive: 999.9999999999062
kahan: 1000
```

**Evaluation Checklist**:
- [ ] Maintains a compensation variable `c`
- [ ] Computes `y := x - c; t := sum + y; c = (t - sum) - y; sum = t`
- [ ] Result is closer to true sum than naive accumulation
- [ ] Handles empty input (returns 0)

---

## Task 6 — Length-Prefix Decoder

**Difficulty**: Intermediate
**Topic**: Bounded conversion

**Description**: Implement `DecodeFrame(data []byte) ([]byte, error)` that reads a 4-byte big-endian uint32 length, validates it's at most 1 MiB, then returns the corresponding number of bytes.

**Starter Code**:
```go
package main

import (
    "encoding/binary"
    "errors"
    "fmt"
)

const MaxFrame = 1 << 20

func DecodeFrame(data []byte) ([]byte, error) {
    // TODO
    return nil, nil
}

func main() {
    good := []byte{0, 0, 0, 3, 'a', 'b', 'c', 'x'}
    bad := []byte{0xff, 0xff, 0xff, 0xff, 1, 2}
    
    if body, err := DecodeFrame(good); err == nil {
        fmt.Printf("good: %q\n", body)
    }
    if _, err := DecodeFrame(bad); err != nil {
        fmt.Println("bad:", err)
    }
    _ = errors.New
    _ = binary.BigEndian
}
```

**Expected Output**:
```
good: "abc"
bad: length too large: 4294967295
```

**Evaluation Checklist**:
- [ ] Validates `len(data) >= 4` first
- [ ] Reads length as uint32
- [ ] Rejects length > MaxFrame
- [ ] Verifies remaining buffer is large enough
- [ ] Returns the body slice (or copy)

---

## Task 7 — Big.Int Factorial

**Difficulty**: Intermediate
**Topic**: math/big basics

**Description**: Compute `factorial(n int) *big.Int`. Reuse the result receiver to avoid extra allocations.

**Starter Code**:
```go
package main

import (
    "fmt"
    "math/big"
)

func factorial(n int) *big.Int {
    // TODO
    return nil
}

func main() {
    fmt.Println(factorial(0))
    fmt.Println(factorial(5))
    fmt.Println(factorial(50))
}
```

**Expected Output**:
```
1
120
30414093201713378043612608166064768844377641568960512000000000000
```

**Evaluation Checklist**:
- [ ] Uses `*big.Int.Mul(out, out, big.NewInt(i))`
- [ ] Returns 1 for n == 0 (and ideally n < 0)
- [ ] Result is exact for any reasonable n
- [ ] Reuses receiver

---

## Task 8 — NaN-Safe Sort

**Difficulty**: Advanced
**Topic**: Float ordering with NaN

**Description**: Sort `[]float64` such that NaNs end up at the end. Use `sort.Slice` or `slices.SortFunc`.

**Starter Code**:
```go
package main

import (
    "fmt"
    "math"
    "sort"
)

func sortNaNLast(xs []float64) {
    // TODO
}

func main() {
    xs := []float64{3.14, math.NaN(), 1.0, math.NaN(), 2.0, math.Inf(1)}
    sortNaNLast(xs)
    fmt.Println(xs)
    _ = sort.Slice
}
```

**Expected Output** (NaNs at the end):
```
[1 2 3.14 +Inf NaN NaN]
```

**Evaluation Checklist**:
- [ ] NaNs are placed at the end
- [ ] Non-NaN values are sorted in ascending order
- [ ] +Inf is greater than all finite floats
- [ ] No `sort` panic from mixed NaN comparisons

---

## Task 9 — Decimal Pricing

**Difficulty**: Advanced
**Topic**: Decimal library use

**Description**: Use `shopspring/decimal` to compute the total of a list of prices with tax. (You'll need to `go get github.com/shopspring/decimal`.)

**Starter Code**:
```go
package main

import (
    "fmt"
    "github.com/shopspring/decimal"
)

type Item struct {
    Name  string
    Price decimal.Decimal
    Qty   int64
}

func TotalWithTax(items []Item, taxRate decimal.Decimal) decimal.Decimal {
    // TODO
    return decimal.Zero
}

func main() {
    items := []Item{
        {Name: "A", Price: decimal.RequireFromString("9.99"), Qty: 3},
        {Name: "B", Price: decimal.RequireFromString("19.99"), Qty: 1},
    }
    rate := decimal.RequireFromString("0.0875") // 8.75%
    total := TotalWithTax(items, rate)
    fmt.Println(total.StringFixed(2))
}
```

**Expected Output**:
```
54.32
```

(9.99*3 + 19.99 = 49.96; tax 49.96*0.0875 = 4.3715; rounded to 2 places = 54.33 — exact result depends on rounding)

**Evaluation Checklist**:
- [ ] Sum of (price * qty) for each item
- [ ] Multiply sum by (1 + taxRate)
- [ ] Round to 2 decimal places at the end (use `Round(2)` or `StringFixed(2)`)
- [ ] No float64 anywhere

---

## Task 10 — Detect Float Underflow

**Difficulty**: Advanced
**Topic**: Subnormal awareness

**Description**: Implement `safeProduct(xs []float64) (float64, bool)` that returns the product and a flag false if underflow to zero or overflow to infinity occurred.

**Starter Code**:
```go
package main

import (
    "fmt"
    "math"
)

func safeProduct(xs []float64) (float64, bool) {
    // TODO
    return 0, false
}

func main() {
    fmt.Println(safeProduct([]float64{2, 3, 4}))
    fmt.Println(safeProduct([]float64{1e-200, 1e-200}))   // underflow
    fmt.Println(safeProduct([]float64{1e200, 1e200}))     // overflow
}
```

**Expected Output**:
```
24 true
0 false
+Inf false
```

**Evaluation Checklist**:
- [ ] Detects `math.IsInf` after each multiplication
- [ ] Detects underflow to zero (when an input was non-zero but the product is zero)
- [ ] Returns false for both cases
- [ ] Optionally uses log-space for very-small-product workloads

---

## Task 11 — Constant Overflow Demo

**Difficulty**: Advanced
**Topic**: Compile-time vs runtime overflow

**Description**: Write a Go file that contains a runtime-overflow example AND a commented-out compile-time-overflow example. Document which is caught by the compiler and why.

**Starter Code** (file: `overflow.go`):
```go
package main

import (
    "fmt"
    "math"
)

// Compile-time error (uncomment to see):
// const x int8 = 200
// const y int32 = 1 << 32

func main() {
    var x int8 = math.MaxInt8
    x++ // runtime wrap (no error)
    fmt.Println(x)
}
```

**Expected Output**:
```
-128
```

**Evaluation Checklist**:
- [ ] Runtime example demonstrates wrap (silent)
- [ ] Compile-time example shown commented out, with explanation
- [ ] Both kinds of overflow described in comments
- [ ] No unused variables or imports

---

## Task 12 — Ulp-Based Equality

**Difficulty**: Advanced
**Topic**: Float bit comparison

**Description**: Implement `EqualULP(a, b float64, ulps uint64) bool` that returns true if `a` and `b` are within `ulps` units in the last place. Handle ±0 and NaN.

**Starter Code**:
```go
package main

import (
    "fmt"
    "math"
)

func EqualULP(a, b float64, ulps uint64) bool {
    // TODO
    return false
}

func main() {
    fmt.Println(EqualULP(1.0, math.Nextafter(1.0, 2.0), 1)) // true
    fmt.Println(EqualULP(0.1+0.2, 0.3, 4))                  // true
    fmt.Println(EqualULP(math.NaN(), math.NaN(), 0))        // false
}
```

**Expected Output**:
```
true
true
false
```

**Evaluation Checklist**:
- [ ] Returns false on NaN
- [ ] Handles ±0 correctly (both should compare equal under ULP=0)
- [ ] Different signs require special handling (the float bit ordering crosses zero)
- [ ] Computes absolute ULP difference correctly

---

## Bonus Task — Atomic Saturating Counter

**Difficulty**: Advanced
**Topic**: Atomic int with saturation

**Description**: Implement a counter that uses `atomic.Int64` for thread safety and saturates at `math.MaxInt64`.

**Starter Code**:
```go
package main

import (
    "fmt"
    "math"
    "sync"
    "sync/atomic"
)

type SatCounter struct {
    n atomic.Int64
}

func (s *SatCounter) Add(d int64) {
    // TODO: use CAS loop with overflow detection
}

func (s *SatCounter) Value() int64 {
    return s.n.Load()
}

func main() {
    var c SatCounter
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println(c.Value()) // 1000

    c.n.Store(math.MaxInt64 - 5)
    c.Add(100)
    fmt.Println(c.Value()) // MaxInt64
}
```

**Expected Output**:
```
1000
9223372036854775807
```

**Evaluation Checklist**:
- [ ] Uses `CompareAndSwap` in a loop
- [ ] Detects overflow before swapping
- [ ] Saturates instead of wrapping
- [ ] Race-clean (`go test -race`)
- [ ] Handles negative deltas (saturate at MinInt64)
