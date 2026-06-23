# Numeric Types (Overview) — Optimize

## Overview
10+ optimization exercises covering numeric type selection, memory layout, computation efficiency, and precision.

---

## Exercise 1 — Choose Smaller Types for Large Arrays 🟢

**Description:** Using `float64` for a large array of pixel values wastes memory when `float32` provides sufficient precision.

**Slow/Bad Code:**
```go
package main

import "fmt"

// Each pixel: RGBA as float64 — 4 * 8 = 32 bytes per pixel
type PixelF64 struct {
    R, G, B, A float64
}

func createImage(width, height int) [][]PixelF64 {
    img := make([][]PixelF64, height)
    for i := range img {
        img[i] = make([]PixelF64, width)
    }
    return img
}

func main() {
    img := createImage(1920, 1080)
    fmt.Printf("Image pixels: %d\n", len(img)*len(img[0]))
    fmt.Printf("Memory (approx): %.2f MB\n", float64(1920*1080*32)/1e6)
    _ = img
}
```

<details>
<summary>Hint</summary>
Color values are typically 0.0-1.0 with 7 significant digits being more than enough. float32 uses half the memory.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "unsafe"
)

// Option 1: float32 — half the memory
type PixelF32 struct {
    R, G, B, A float32 // 4 * 4 = 16 bytes per pixel
}

// Option 2: uint8 — 1/8th the memory (0-255 per channel)
type PixelU8 struct {
    R, G, B, A uint8 // 4 * 1 = 4 bytes per pixel
}

func main() {
    fmt.Printf("float64 pixel: %d bytes\n", unsafe.Sizeof(struct{ R, G, B, A float64 }{})) // 32
    fmt.Printf("float32 pixel: %d bytes\n", unsafe.Sizeof(PixelF32{})) // 16
    fmt.Printf("uint8 pixel:   %d bytes\n", unsafe.Sizeof(PixelU8{}))  // 4

    pixels := 1920 * 1080
    fmt.Printf("float64: %.1f MB\n", float64(pixels*32)/1e6) // 66.4 MB
    fmt.Printf("float32: %.1f MB\n", float64(pixels*16)/1e6) // 33.2 MB
    fmt.Printf("uint8:   %.1f MB\n", float64(pixels*4)/1e6)  // 8.3 MB
}
```

**Improvement:** For a 1920×1080 image:
- `float64`: 66.4 MB
- `float32`: 33.2 MB (2x smaller)
- `uint8`: 8.3 MB (8x smaller, standard for images)

For machine learning models with millions of float features, `float32` reduces memory and improves cache efficiency.
</details>

---

## Exercise 2 — Optimize Struct Layout 🟢

**Description:** Random field ordering causes unnecessary padding.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "unsafe"
)

// Assume 5 million instances of this type
type EventRecord struct {
    Processed bool     // 1 byte + 7 padding
    Timestamp int64    // 8 bytes
    HasError  bool     // 1 byte + 3 padding
    Count     int32    // 4 bytes
    UserID    uint8    // 1 byte + 7 padding
    SessionID int64    // 8 bytes
}

func main() {
    fmt.Println("EventRecord size:", unsafe.Sizeof(EventRecord{})) // 40 bytes
    fmt.Printf("5M records: %.0f MB\n", float64(unsafe.Sizeof(EventRecord{})*5_000_000)/1e6)
}
```

<details>
<summary>Hint</summary>
Place 8-byte fields first, then 4-byte, then 2-byte, then 1-byte fields at the end.
</details>

<details>
<summary>Optimized Solution</summary>

```go
type EventRecordOptimized struct {
    Timestamp int64   // 8 bytes (offset 0)
    SessionID int64   // 8 bytes (offset 8)
    Count     int32   // 4 bytes (offset 16)
    UserID    uint8   // 1 byte  (offset 20)
    Processed bool    // 1 byte  (offset 21)
    HasError  bool    // 1 byte  (offset 22)
    _         uint8   // 1 byte padding (offset 23, to pad to 24)
}

func main() {
    fmt.Println("Original:", unsafe.Sizeof(EventRecord{}))              // 40 bytes
    fmt.Println("Optimized:", unsafe.Sizeof(EventRecordOptimized{}))    // 24 bytes
    fmt.Printf("Original 5M: %.0f MB\n", float64(40*5_000_000)/1e6)    // 200 MB
    fmt.Printf("Optimized 5M: %.0f MB\n", float64(24*5_000_000)/1e6)   // 120 MB
    // 40% memory reduction
}
```

**Improvement:** 40 → 24 bytes (40% reduction). For 5M records: 200MB → 120MB.
</details>

---

## Exercise 3 — Integer Arithmetic Instead of Float 🟢

**Description:** Using floating-point for percentage calculations when integer arithmetic would be exact and faster.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "math"
)

func applyDiscount(priceFloat float64, discountPct float64) float64 {
    discount := priceFloat * discountPct / 100.0
    return priceFloat - math.Round(discount*100)/100
}

func main() {
    original := 99.99
    final := applyDiscount(original, 10.0)
    fmt.Printf("$%.2f - 10%% = $%.2f\n", original, final) // may have float issues
}
```

<details>
<summary>Hint</summary>
Use cents (int64) throughout. Multiply first, then divide, to avoid precision loss.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

// All prices in cents, all rates in basis points (1 bps = 0.01%)
func applyDiscount(priceCents int64, discountBps int64) int64 {
    // Multiply first to avoid integer division truncation
    discount := priceCents * discountBps / 10_000
    return priceCents - discount
}

func main() {
    originalCents := int64(9999) // $99.99
    finalCents := applyDiscount(originalCents, 1000) // 1000 bps = 10%

    fmt.Printf("$%.2f - 10%% = $%.2f\n",
        float64(originalCents)/100,
        float64(finalCents)/100)
    // $99.99 - 10% = $90.00 (exact!)
}
```

**Improvement:** No floating-point imprecision. Integer division is exact for this use case. No `math.Round` needed.
</details>

---

## Exercise 4 — Pre-compute Constants and Avoid Division 🟡

**Description:** Division inside a hot loop on every iteration when a reciprocal can be precomputed.

**Slow/Bad Code:**
```go
package main

import "fmt"

func normalizeValues(values []float64, divisor float64) []float64 {
    result := make([]float64, len(values))
    for i, v := range values {
        result[i] = v / divisor // division on every iteration: ~20 cycles
    }
    return result
}

func main() {
    values := make([]float64, 1000000)
    for i := range values {
        values[i] = float64(i)
    }
    result := normalizeValues(values, 255.0)
    fmt.Println(result[100]) // ~0.392
}
```

<details>
<summary>Hint</summary>
Floating-point division is ~20 cycles; multiplication is ~4 cycles. Precompute 1/divisor once.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func normalizeValues(values []float64, divisor float64) []float64 {
    result := make([]float64, len(values))
    reciprocal := 1.0 / divisor // compute ONCE: ~20 cycles

    for i, v := range values {
        result[i] = v * reciprocal // multiply: ~4 cycles
    }
    return result
}
```

**Improvement:** One division + N multiplications (4 cycles each) vs. N divisions (20 cycles each). For 1M elements: ~24M cycles vs ~20M cycles... actual speedup depends on pipelining, but division avoidance is a classic optimization for hot loops.
</details>

---

## Exercise 5 — Use Integer for Percentage Math 🟡

**Description:** Using floating-point for simple integer percentage operations.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "math"
)

// Check if n% of total have been processed
func isPercentComplete(done, total int, pct float64) bool {
    if total == 0 { return false }
    ratio := float64(done) / float64(total) * 100.0
    return ratio >= pct
}

func main() {
    // 75% of 200 = 150
    fmt.Println(isPercentComplete(150, 200, 75.0)) // true
    fmt.Println(isPercentComplete(149, 200, 75.0)) // false
}
```

<details>
<summary>Hint</summary>
Avoid float conversion entirely: `done * 100 >= pct * total` using all integers.
</details>

<details>
<summary>Optimized Solution</summary>

```go
// All integer arithmetic, no float needed
func isPercentComplete(done, total, pctx100 int) bool {
    if total == 0 { return false }
    // done/total >= pct/100 ⟺ done*100 >= pct*total
    return done*100 >= pctx100*total
}

func main() {
    fmt.Println(isPercentComplete(150, 200, 75)) // true:  150*100=15000 >= 75*200=15000
    fmt.Println(isPercentComplete(149, 200, 75)) // false: 149*100=14900 < 75*200=15000
}
```

**Improvement:** Zero float operations — all integer arithmetic. Works for all cases where percentages are whole numbers. No precision issues.
</details>

---

## Exercise 6 — Batch Type Conversion 🟡

**Description:** Converting types element-by-element inside a loop when the loop itself can be optimized.

**Slow/Bad Code:**
```go
package main

import "fmt"

// Converting []int to []float64 for statistical operations
func intToFloat(ints []int) []float64 {
    floats := make([]float64, len(ints))
    for i, v := range ints {
        floats[i] = float64(v)
    }
    return floats
}

// Then computing statistics on the float slice
func mean(floats []float64) float64 {
    var sum float64
    for _, v := range floats {
        sum += v
    }
    return sum / float64(len(floats))
}

func main() {
    data := make([]int, 1000000)
    for i := range data {
        data[i] = i
    }
    floats := intToFloat(data)       // allocates 8MB
    fmt.Println(mean(floats))        // 499999.5
}
```

<details>
<summary>Hint</summary>
Avoid the intermediate allocation — compute the mean directly on the integer slice.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

// Compute mean directly on int slice — no intermediate allocation
func meanInts(data []int) float64 {
    if len(data) == 0 { return 0 }
    var sum int64 // use int64 to avoid overflow for large slices
    for _, v := range data {
        sum += int64(v)
    }
    return float64(sum) / float64(len(data))
}

func main() {
    data := make([]int, 1000000)
    for i := range data {
        data[i] = i
    }
    // No 8MB intermediate allocation:
    fmt.Println(meanInts(data)) // 499999.5
}
```

**Improvement:**
- Eliminates 8MB allocation for the float64 slice
- Reduces GC pressure
- `int64` accumulator prevents overflow for large sums
- Single pass over data (better cache behavior)
</details>

---

## Exercise 7 — Replace Float Modulo with Integer 🟡

**Description:** Using float modulo and comparison for integer-like logic.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "math"
)

func isEveryNth(position float64, n float64) bool {
    // Checking if position is a multiple of n using float
    return math.Mod(position, n) < 1e-9
}

func processStream(n int) {
    for i := 0; i < 100; i++ {
        if isEveryNth(float64(i), float64(n)) {
            fmt.Printf("Process at %d\n", i)
        }
    }
}

func main() {
    processStream(10)
}
```

<details>
<summary>Hint</summary>
This is a completely integer problem — `i % n == 0`. No float needed at all.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func processStream(n int) {
    for i := 0; i < 100; i++ {
        if i%n == 0 { // integer modulo: 1-3 cycles vs float math
            fmt.Printf("Process at %d\n", i)
        }
    }
}
```

**Improvement:** Replace floating-point `math.Mod` (~10 cycles) + tolerance comparison with integer `%` (~1-3 cycles). Also eliminates potential precision issues.
</details>

---

## Exercise 8 — Avoid Repeated float64→int64 Conversions 🔴

**Description:** A computation path converts back and forth between float64 and int64 unnecessarily.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "math"
)

type Transaction struct {
    Amount     float64 // dollars
    TaxRate    float64 // percentage (0-100)
}

func (t Transaction) TaxAmount() float64 {
    return math.Round(t.Amount * t.TaxRate / 100 * 100) / 100
}

func (t Transaction) Total() float64 {
    return t.Amount + t.TaxAmount()
}

func (t Transaction) TotalCents() int64 {
    return int64(math.Round(t.Total() * 100)) // multiple conversions
}

func main() {
    tx := Transaction{Amount: 99.99, TaxRate: 8.0}
    fmt.Printf("Tax: $%.2f\n", tx.TaxAmount())
    fmt.Printf("Total: $%.2f\n", tx.Total())
    fmt.Printf("Total cents: %d\n", tx.TotalCents())
}
```

<details>
<summary>Hint</summary>
Use int64 cents from the start. Convert float input to cents once at the boundary.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "math"
)

type Transaction struct {
    AmountCents  int64 // always in cents
    TaxRateBps   int64 // basis points (1% = 100 bps)
}

func NewTransaction(dollars float64, taxPct float64) Transaction {
    return Transaction{
        AmountCents: int64(math.Round(dollars * 100)),
        TaxRateBps:  int64(math.Round(taxPct * 100)),
    }
}

func (t Transaction) TaxCents() int64 {
    return t.AmountCents * t.TaxRateBps / 10_000
}

func (t Transaction) TotalCents() int64 {
    return t.AmountCents + t.TaxCents()
}

func (t Transaction) TotalDollars() float64 {
    return float64(t.TotalCents()) / 100
}

func main() {
    tx := NewTransaction(99.99, 8.0)
    fmt.Printf("Tax: $%.2f\n", float64(tx.TaxCents())/100)
    fmt.Printf("Total: $%.2f\n", tx.TotalDollars())
    fmt.Printf("Total cents: %d\n", tx.TotalCents())
}
```

**Improvement:**
- Float→int conversion happens once (at input boundary)
- All intermediate math is exact integer arithmetic
- No repeated `math.Round` calls
- No accumulated float precision errors
</details>

---

## Exercise 9 — Efficient Counter with Minimal Type Width 🔴

**Description:** Using `int64` for a counter that will never exceed 255, wasting 7 bytes per instance.

**Slow/Bad Code:**
```go
package main

import (
    "fmt"
    "unsafe"
)

// Retry counter: max retries is typically 3-10
// But we used int64 "to be safe"
type RetryRecord struct {
    TaskID  int64
    Retries int64  // will never exceed 255, but uses 8 bytes
    MaxRetries int64
    LastError string
}

func main() {
    records := make([]RetryRecord, 10_000_000)
    fmt.Println("Record size:", unsafe.Sizeof(RetryRecord{}))
    // Count only numeric fields
    _ = records
}
```

<details>
<summary>Hint</summary>
Retry counts fit in uint8 (0-255). MaxRetries also fits in uint8. Use the smallest type that fits the domain.
</details>

<details>
<summary>Optimized Solution</summary>

```go
type RetryRecord struct {
    TaskID     int64  // needs 64-bit range
    LastError  string // string header: 16 bytes
    Retries    uint8  // 0-255: fits in 1 byte
    MaxRetries uint8  // 0-255: fits in 1 byte
    _          [6]byte // padding (if needed for alignment)
}

// More optimal grouping:
type RetryRecordOpt struct {
    TaskID     int64  // 8 bytes (offset 0)
    LastError  string // 16 bytes (offset 8: ptr+len)
    Retries    uint8  // 1 byte (offset 24)
    MaxRetries uint8  // 1 byte (offset 25)
    // 6 bytes padding to next 8-byte boundary
}

func main() {
    import "unsafe"
    fmt.Println("Original:", unsafe.Sizeof(RetryRecord{}))    // large due to int64
    fmt.Println("Optimized:", unsafe.Sizeof(RetryRecordOpt{})) // smaller
}
```

**Rule**: Use the smallest type that covers your domain's range:
- Retry count: `uint8` (0-255)
- Status code: `uint8` or `int16`
- Year (1900-2100): `int16`
- Port number: `uint16`
- IPv4 address component: `uint8`
</details>

---

## Exercise 10 — Bitset for Boolean Arrays 🔴

**Description:** Storing millions of boolean flags as `[]bool` uses 8x more memory than a packed bitset.

**Slow/Bad Code:**
```go
package main

import "fmt"

// Tracking which items have been seen: 10 million items
type SeenTracker struct {
    seen []bool // 10M bools = 10MB
}

func (t *SeenTracker) Mark(id int) {
    t.seen[id] = true
}

func (t *SeenTracker) IsSeen(id int) bool {
    return t.seen[id]
}

func NewSeenTracker(maxID int) *SeenTracker {
    return &SeenTracker{seen: make([]bool, maxID)}
}

func main() {
    tracker := NewSeenTracker(10_000_000)
    fmt.Printf("Memory: %.1f MB\n", float64(len(tracker.seen))/1e6)
    // 10MB for booleans
    tracker.Mark(42)
    fmt.Println(tracker.IsSeen(42))
}
```

<details>
<summary>Hint</summary>
Pack 8 booleans into each byte. A bitset uses 8x less memory and is more cache-friendly.
</details>

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

type BitSet struct {
    data []uint64 // 64 bits per element
    size int
}

func NewBitSet(maxID int) *BitSet {
    return &BitSet{
        data: make([]uint64, (maxID+63)/64),
        size: maxID,
    }
}

func (b *BitSet) Set(id int) {
    b.data[id/64] |= 1 << uint(id%64)
}

func (b *BitSet) IsSet(id int) bool {
    return b.data[id/64]&(1<<uint(id%64)) != 0
}

func (b *BitSet) MemoryBytes() int {
    return len(b.data) * 8
}

func main() {
    bs := NewBitSet(10_000_000)
    fmt.Printf("BitSet memory:  %.2f MB\n", float64(bs.MemoryBytes())/1e6)
    // 10M / 64 * 8 bytes = ~1.25MB — 8x less than bool slice!

    boolSlice := make([]bool, 10_000_000)
    fmt.Printf("Bool slice:     %.2f MB\n", float64(len(boolSlice))/1e6)

    bs.Set(42)
    fmt.Println(bs.IsSet(42)) // true
    fmt.Println(bs.IsSet(43)) // false
    _ = boolSlice
}
```

**Memory:** 10MB → 1.25MB (8x reduction). Additionally, bitsets pack more data per cache line, improving iteration performance by ~8x for scanning operations.
</details>

---

## Exercise 11 — Use int64 Accumulator for int Sums 🔴

**Description:** Summing a large slice of `int32` values into an `int32` accumulator can overflow.

**Slow/Bad Code:**
```go
package main

import "fmt"

func sumScores(scores []int32) int32 {
    var total int32
    for _, s := range scores {
        total += s // BUG: can overflow if many large scores
    }
    return total
}

func main() {
    // 10,000 scores of 300,000 each
    scores := make([]int32, 10000)
    for i := range scores {
        scores[i] = 300_000
    }
    // Expected: 3,000,000,000 (> MaxInt32 = 2,147,483,647 → OVERFLOW)
    fmt.Println(sumScores(scores)) // negative number! (overflowed)
}
```

<details>
<summary>Hint</summary>
Use `int64` for the accumulator even when elements are `int32`. Widen early.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func sumScores(scores []int32) int64 {
    var total int64 // wider accumulator prevents overflow
    for _, s := range scores {
        total += int64(s) // widen each element as it's added
    }
    return total
}

func main() {
    scores := make([]int32, 10000)
    for i := range scores {
        scores[i] = 300_000
    }
    fmt.Println(sumScores(scores)) // 3,000,000,000 (correct)
}
```

**Rule**: When summing or accumulating values, the accumulator should be at least as wide as the maximum possible sum. For N `int32` values with max value V, use `int64` if `N * V > math.MaxInt32`. This is a very common bug in high-score leaderboards, analytics, and aggregation functions.
</details>
