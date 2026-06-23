# Floating Points in Go — Find the Bug

## Difficulty Legend
- 🟢 Easy
- 🟡 Medium
- 🔴 Hard

---

## Bug 1 🟢 — Float Equality Comparison

**Description:** A function checks if two prices are equal, but it never works correctly.

**Buggy Code:**
```go
package main

import "fmt"

func pricesEqual(a, b float64) bool {
    return a == b
}

func main() {
    price1 := 0.1 + 0.2
    price2 := 0.3
    if pricesEqual(price1, price2) {
        fmt.Println("Prices are equal")
    } else {
        fmt.Println("Prices are NOT equal") // always prints this
    }
}
```

**Expected Output:** `Prices are equal`
**Actual Output:** `Prices are NOT equal`

<details>
<summary>Hint</summary>

Floating-point numbers cannot be compared with `==`. What is `0.1 + 0.2` actually equal to?

</details>

<details>
<summary>Explanation & Fix</summary>

`0.1 + 0.2` evaluates to `0.30000000000000004` in IEEE 754, not `0.3`. Direct equality comparison fails.

**Fix:**
```go
import "math"

const epsilon = 1e-9

func pricesEqual(a, b float64) bool {
    return math.Abs(a-b) < epsilon
}
```

</details>

---

## Bug 2 🟢 — Integer Division Instead of Float Division

**Description:** A function calculates the average score but always returns a whole number.

**Buggy Code:**
```go
package main

import "fmt"

func averageScore(scores []int) float64 {
    total := 0
    for _, s := range scores {
        total += s
    }
    return float64(total / len(scores)) // BUG HERE
}

func main() {
    scores := []int{85, 92, 78, 90, 88}
    fmt.Printf("Average: %.2f\n", averageScore(scores))
    // Expected: 86.60
    // Actual:   86.00
}
```

**Expected Output:** `Average: 86.60`
**Actual Output:** `Average: 86.00`

<details>
<summary>Hint</summary>

Where exactly does the conversion to `float64` happen? Integer division truncates before the conversion.

</details>

<details>
<summary>Explanation & Fix</summary>

`total / len(scores)` is integer division (both are `int`), which truncates `433/5 = 86`, losing the `.6`. Then `float64(86) = 86.0`.

**Fix:** Convert to float64 BEFORE dividing:
```go
func averageScore(scores []int) float64 {
    total := 0
    for _, s := range scores {
        total += s
    }
    return float64(total) / float64(len(scores)) // convert first, then divide
}
```

</details>

---

## Bug 3 🟢 — Not Checking for NaN

**Description:** A sensor reading function returns unexpected results without warning.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "math"
)

func processSensorValue(raw float64) float64 {
    // Normalize to 0-100 scale
    normalized := raw / math.Sqrt(raw)
    return normalized * 100
}

func main() {
    fmt.Println(processSensorValue(25.0))  // OK: 500
    fmt.Println(processSensorValue(-1.0))  // BUG: NaN propagates silently
    fmt.Println(processSensorValue(0.0))   // BUG: NaN (0/0)
}
```

**Expected Output:**
```
500
Error: invalid sensor reading -1.0
Error: invalid sensor reading 0.0
```
**Actual Output:**
```
500
NaN
NaN
```

<details>
<summary>Hint</summary>

`math.Sqrt` of a negative number returns NaN. Division of 0 by 0 is also NaN. Should you check inputs before calling Sqrt?

</details>

<details>
<summary>Explanation & Fix</summary>

`math.Sqrt(-1.0)` returns NaN, and any arithmetic with NaN propagates NaN. The function should validate inputs first.

**Fix:**
```go
import (
    "fmt"
    "math"
)

func processSensorValue(raw float64) (float64, error) {
    if math.IsNaN(raw) || raw <= 0 {
        return 0, fmt.Errorf("invalid sensor reading: %v", raw)
    }
    normalized := raw / math.Sqrt(raw)
    return normalized * 100, nil
}
```

</details>

---

## Bug 4 🟢 — Float for Monetary Calculations

**Description:** A shopping cart total is slightly off.

**Buggy Code:**
```go
package main

import "fmt"

func cartTotal(prices []float64) float64 {
    total := 0.0
    for _, p := range prices {
        total += p
    }
    return total
}

func main() {
    prices := []float64{0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10}
    total := cartTotal(prices)
    fmt.Printf("Total: $%.2f\n", total) // prints $1.00 ✓
    fmt.Printf("Exact: %.20f\n", total) // shows the bug!
    if total == 1.0 {
        fmt.Println("Exactly $1.00")
    } else {
        fmt.Println("NOT exactly $1.00!") // this prints
    }
}
```

**Expected:** `Exactly $1.00`
**Actual:** `NOT exactly $1.00!` (total is `0.9999999999999999`)

<details>
<summary>Hint</summary>

`0.1` cannot be represented exactly in binary floating point. Adding it 10 times accumulates error.

</details>

<details>
<summary>Explanation & Fix</summary>

Floating-point is not suitable for financial calculations. Use integer cents.

**Fix:**
```go
// Represent prices as integer cents
type Cents int64

func cartTotalCents(prices []Cents) Cents {
    total := Cents(0)
    for _, p := range prices {
        total += p
    }
    return total
}

func main() {
    prices := []Cents{10, 10, 10, 10, 10, 10, 10, 10, 10, 10} // 10 cents each
    total := cartTotalCents(prices)
    fmt.Printf("Total: $%d.%02d\n", total/100, total%100) // $1.00
    if total == 100 {
        fmt.Println("Exactly $1.00") // always correct
    }
}
```

</details>

---

## Bug 5 🟢 — Infinite Loop with Float Counter

**Description:** A loop that should run exactly 10 times runs forever (or the wrong number of times).

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    count := 0
    for f := 0.0; f != 1.0; f += 0.1 {
        count++
        if count > 20 { // safety valve
            fmt.Println("Loop did not terminate naturally!")
            break
        }
    }
    fmt.Println("Iterations:", count)
}
```

**Expected:** Loop runs exactly 10 times
**Actual:** Loop runs 11+ times or fails to terminate

<details>
<summary>Hint</summary>

Can `0.0 + 0.1 * 10` equal exactly `1.0`? What does `0.1 * 10` actually evaluate to?

</details>

<details>
<summary>Explanation & Fix</summary>

`0.0 + 0.1 * 10` = `1.0000000000000002` (not `1.0`), so `f != 1.0` is still true even after 10 iterations, and the loop continues past 1.0.

**Fix:** Use an integer loop counter:
```go
func main() {
    count := 0
    for i := 0; i < 10; i++ {
        f := float64(i) * 0.1  // compute float from integer
        _ = f
        count++
    }
    fmt.Println("Iterations:", count) // exactly 10
}
```

</details>

---

## Bug 6 🟡 — Wrong Rounding for Negative Numbers

**Description:** A billing system rounds amounts incorrectly for negative values (credits).

**Buggy Code:**
```go
package main

import "fmt"

// roundToCents rounds a dollar amount to 2 decimal places
func roundToCents(amount float64) float64 {
    return float64(int(amount*100+0.5)) / 100
}

func main() {
    fmt.Println(roundToCents(2.345))   // Expected: 2.35, Got: 2.35 ✓
    fmt.Println(roundToCents(2.344))   // Expected: 2.34, Got: 2.34 ✓
    fmt.Println(roundToCents(-2.345))  // Expected: -2.35, Got: -2.34 ✗
    fmt.Println(roundToCents(-2.344))  // Expected: -2.34, Got: -2.34 ✓
}
```

**Expected:** `-2.35`
**Actual:** `-2.34`

<details>
<summary>Hint</summary>

Adding 0.5 before truncating works for positive numbers but not negative ones. What does `int(-234.5 + 0.5)` evaluate to?

</details>

<details>
<summary>Explanation & Fix</summary>

For `-2.345`: `amount * 100 = -234.5`. `-234.5 + 0.5 = -234.0`. `int(-234.0) = -234`. `-234 / 100.0 = -2.34`. But correct answer is -2.35.

The `+0.5` trick only works for positive numbers.

**Fix:** Use `math.Round` which correctly handles negatives (rounds away from zero):
```go
import "math"

func roundToCents(amount float64) float64 {
    return math.Round(amount*100) / 100
}

// math.Round(-2.345 * 100) = math.Round(-234.5) = -235
// -235 / 100 = -2.35 ✓
```

</details>

---

## Bug 7 🟡 — Assuming 0.1 × 10 = 1.0

**Description:** A unit test passes locally but fails in CI due to a floating-point assumption.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "math"
)

func applyDiscount(price float64, discountPct float64) float64 {
    return price * (1.0 - discountPct/100.0)
}

func main() {
    // Apply 10% discount 10 times — should give 0% net discount? No...
    // Actually testing: price × 0.9 × 0.9 × ... (compound)
    // But programmer thinks: 0.1 * 10 should == 1.0 after removing discount

    // Test: applying 10% discount to $10 gives $9
    price := 10.0
    result := applyDiscount(price, 10.0)
    expected := 9.0
    if result == expected {
        fmt.Println("Test passed")
    } else {
        fmt.Println("Test FAILED:", result)
        // Prints: Test FAILED: 9.000000000000002
    }

    // Programmer's assumption that fails:
    x := 0.1 * 10
    fmt.Println(x == 1.0)   // false!
    fmt.Println(math.Abs(x - 1.0)) // ~1.11e-16
}
```

<details>
<summary>Hint</summary>

`0.1` is not exactly representable in binary. `10.0 * (1.0 - 0.1)` involves multiplying an inexact number. The result is close to but not equal to `9.0`.

</details>

<details>
<summary>Explanation & Fix</summary>

`10.0 * 0.9` = `9.000000000000002` because `0.9` (i.e., `1 - 0.1`) is not exact in binary.

**Fix:** Use epsilon comparison in tests:
```go
import "math"

const epsilon = 1e-9

func assertAlmostEqual(t *testing.T, got, want float64) {
    t.Helper()
    if math.Abs(got-want) > epsilon {
        t.Errorf("got %v, want %v (diff=%e)", got, want, math.Abs(got-want))
    }
}
```

Or use integer arithmetic:
```go
func applyDiscountCents(priceCents int64, discountBPS int64) int64 {
    // discountBPS in basis points (1/100 of 1%)
    return priceCents - priceCents*discountBPS/10000
}
```

</details>

---

## Bug 8 🟡 — NaN in Map Key

**Description:** A cache using float keys has entries that can never be retrieved.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "math"
)

func computeExpensive(x float64) float64 {
    // Expensive computation that might return NaN for some inputs
    if x < 0 {
        return math.NaN() // invalid input
    }
    return math.Sqrt(x)
}

var cache = map[float64]float64{}

func cachedCompute(x float64) float64 {
    if val, ok := cache[x]; ok {
        return val
    }
    result := computeExpensive(x)
    cache[x] = result  // BUG: stores NaN as key
    return result
}

func main() {
    fmt.Println(cachedCompute(-1.0)) // NaN
    fmt.Println(cachedCompute(-1.0)) // Should return cached NaN, but doesn't
    fmt.Println(len(cache))          // grows with each call!
}
```

<details>
<summary>Hint</summary>

What does `cache[math.NaN()]` return when looked up? Remember NaN != NaN.

</details>

<details>
<summary>Explanation & Fix</summary>

`math.NaN()` as a map key can be stored, but can NEVER be retrieved because `NaN != NaN` means the map lookup always misses. Every call with an invalid input creates a new unreachable entry, leaking memory.

**Fix:**
```go
func cachedCompute(x float64) (float64, error) {
    // Validate input first
    if x < 0 {
        return 0, fmt.Errorf("invalid input: %v", x)
    }

    if val, ok := cache[x]; ok {
        return val, nil
    }
    result := math.Sqrt(x)
    cache[x] = result
    return result, nil
}
```

</details>

---

## Bug 9 🟡 — Float to Int Overflow

**Description:** A function converting user-provided float to array index panics or gives wrong results for large inputs.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "math"
)

var data = make([]int, 1000)

func getElement(indexFloat float64) int {
    idx := int(indexFloat) // BUG: no range check
    return data[idx]
}

func main() {
    fmt.Println(getElement(5.7))         // OK: index 5
    fmt.Println(getElement(999.9))       // OK: index 999
    fmt.Println(getElement(1000.0))      // PANIC: index out of range
    fmt.Println(getElement(math.MaxFloat64)) // Undefined behavior / wrong value
    fmt.Println(getElement(math.NaN()))  // Wrong value (int(NaN) = 0 on some platforms)
    fmt.Println(getElement(-1.5))        // PANIC: negative index
}
```

<details>
<summary>Hint</summary>

What does `int(math.MaxFloat64)` return? What does `int(math.NaN())` return? What does `int(-1.5)` give?

</details>

<details>
<summary>Explanation & Fix</summary>

- `int(math.MaxFloat64)` → platform-defined (often `math.MinInt64` = CVTTSD2SI overflow)
- `int(math.NaN())` → undefined (platform-specific)
- `int(-1.5)` → -1, which causes panic on slice access

**Fix:**
```go
func getElement(indexFloat float64) (int, error) {
    if math.IsNaN(indexFloat) || math.IsInf(indexFloat, 0) {
        return 0, fmt.Errorf("invalid index: %v", indexFloat)
    }
    if indexFloat < 0 || indexFloat >= float64(len(data)) {
        return 0, fmt.Errorf("index %v out of range [0, %d)", indexFloat, len(data))
    }
    idx := int(indexFloat) // safe: validated above
    return data[idx], nil
}
```

</details>

---

## Bug 10 🔴 — Catastrophic Cancellation in Variance

**Description:** A statistics function returns negative variance for a dataset of very similar values.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "math"
)

// Two-pass variance: variance = E[X²] - E[X]²
func variance(data []float64) float64 {
    n := float64(len(data))
    sumX, sumX2 := 0.0, 0.0
    for _, x := range data {
        sumX += x
        sumX2 += x * x
    }
    mean := sumX / n
    return sumX2/n - mean*mean  // CATASTROPHIC CANCELLATION!
}

func main() {
    // Values clustered near 1e9
    data := []float64{
        1000000001.0,
        1000000002.0,
        1000000003.0,
        1000000004.0,
        1000000005.0,
    }
    v := variance(data)
    fmt.Printf("Variance: %f\n", v) // Should be 2.5, but may give negative or wrong value!
    fmt.Printf("StdDev: %f\n", math.Sqrt(v)) // NaN if variance is negative!
}
```

**Expected:** `Variance: 2.5`, `StdDev: 1.581...`
**Actual:** May print negative variance or NaN!

<details>
<summary>Hint</summary>

When values are near 1e9, `sumX2` ≈ 5e18 and `mean*mean` ≈ 5e18 as well. These are nearly equal floats. Subtracting them loses all significant digits (catastrophic cancellation).

</details>

<details>
<summary>Explanation & Fix</summary>

`sumX2/n` and `mean*mean` are nearly equal large numbers (~1e18). Float64 only has ~15-16 significant digits. The small difference (2.5) is lost.

**Fix:** Use Welford's online algorithm — it subtracts from the mean incrementally, so numbers never get large:

```go
func varianceWelford(data []float64) float64 {
    if len(data) < 2 {
        return 0
    }
    var mean, M2 float64
    for i, x := range data {
        delta := x - mean
        mean += delta / float64(i+1)
        delta2 := x - mean
        M2 += delta * delta2
    }
    return M2 / float64(len(data)-1) // sample variance
}

// For the test data:
// All deltas are small (1, 2, 3, 4, 5 minus running mean)
// No large number cancellation
// Result: exactly 2.5
```

</details>

---

## Bug 11 🔴 — Lost Precision in JSON Unmarshaling

**Description:** A REST API handler returns wrong user IDs for large ID values.

**Buggy Code:**
```go
package main

import (
    "encoding/json"
    "fmt"
)

type Response struct {
    UserID float64 `json:"user_id"` // BUG: float64 for large integer IDs
    Name   string  `json:"name"`
}

func processResponse(jsonData []byte) {
    var resp Response
    if err := json.Unmarshal(jsonData, &resp); err != nil {
        panic(err)
    }
    fmt.Printf("User ID: %.0f\n", resp.UserID)
    fmt.Printf("Name: %s\n", resp.Name)
}

func main() {
    // JSON with a large integer ID (common in distributed systems)
    json1 := []byte(`{"user_id": 9007199254740993, "name": "Alice"}`)
    processResponse(json1)
    // Expected: 9007199254740993
    // Actual:   9007199254740992  (off by 1!)
}
```

<details>
<summary>Hint</summary>

`float64` can exactly represent integers up to 2^53 = 9007199254740992. The ID `9007199254740993` is `2^53 + 1`, which cannot be represented exactly.

</details>

<details>
<summary>Explanation & Fix</summary>

JSON numbers are decoded as `float64` when the Go type is `float64`. `9007199254740993 = 2^53 + 1` exceeds float64's exact integer range, so it's rounded to `9007199254740992`.

**Fix:** Use `int64` or `json.Number`:
```go
// Option 1: Use int64
type Response struct {
    UserID int64  `json:"user_id"` // exact for all 64-bit integers
    Name   string `json:"name"`
}

// Option 2: Use json.Number for more control
type Response struct {
    UserID json.Number `json:"user_id"`
    Name   string      `json:"name"`
}

func processResponse(jsonData []byte) {
    var resp Response
    json.Unmarshal(jsonData, &resp)
    id, _ := resp.UserID.Int64()
    fmt.Printf("User ID: %d\n", id) // exact
}
```

</details>

---

## Bug 12 🔴 — Float Comparison in Sort Leading to Unstable Behavior

**Description:** A leaderboard sorting function produces inconsistent results when scores include NaN values from invalid submissions.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "math"
    "sort"
)

type Player struct {
    Name  string
    Score float64
}

func sortLeaderboard(players []Player) {
    sort.Slice(players, func(i, j int) bool {
        return players[i].Score > players[j].Score // BUG: NaN breaks sort
    })
}

func main() {
    players := []Player{
        {"Alice", 95.5},
        {"Bob", math.NaN()},  // invalid score
        {"Charlie", 87.3},
        {"Diana", math.NaN()}, // another invalid
        {"Eve", 91.0},
    }

    sortLeaderboard(players)
    for _, p := range players {
        fmt.Printf("%s: %v\n", p.Name, p.Score)
    }
    // Result is non-deterministic and violates sort contract!
    // sort.Slice requires strict weak ordering; NaN violates this
}
```

<details>
<summary>Hint</summary>

`NaN > x` is `false` for any `x`, including NaN itself. The sort's comparison function must define a strict total order. When `a > b` is false AND `b > a` is false, the sort algorithm can produce any ordering and may run indefinitely or panic.

</details>

<details>
<summary>Explanation & Fix</summary>

NaN violates the requirements of `sort.Slice`:
- Irreflexivity: `less(i, i)` must be false — but `NaN > NaN = false` ✓
- Asymmetry: if `less(i, j)` then not `less(j, i)` — but `NaN > 5 = false` AND `5 > NaN = false` ✗

This is a violation. The sort produces undefined results.

**Fix:** Handle NaN explicitly — put NaN scores at the end:
```go
func sortLeaderboard(players []Player) {
    sort.SliceStable(players, func(i, j int) bool {
        si, sj := players[i].Score, players[j].Score
        // NaN goes to the end
        iNaN := math.IsNaN(si)
        jNaN := math.IsNaN(sj)
        if iNaN && jNaN {
            return false // equal (both invalid)
        }
        if iNaN {
            return false // i goes after j
        }
        if jNaN {
            return true  // i goes before j
        }
        return si > sj // normal comparison
    })
}
```

</details>
