# Numeric Types (Overview) — Find the Bug

## Overview
10+ bugs at varying difficulty. Each bug covers numeric type selection, conversion, overflow, or float precision issues.

---

## Bug 1 — Wrong Type for Port Number 🟢

**Description:** Using a signed integer for a port number allows negative values, which are invalid.

**Buggy Code:**
```go
package main

import "fmt"

type ServerConfig struct {
    Host string
    Port int8  // BUG: int8 range is -128 to 127, but ports go to 65535!
}

func main() {
    config := ServerConfig{Host: "localhost", Port: 8080}
    fmt.Println(config.Port) // What happens?
}
```

**Expected:** Port 8080 stored correctly
**Actual:** Compile error or overflow — int8 cannot hold 8080

<details>
<summary>Hint</summary>
Port numbers range from 0 to 65535. What unsigned type holds exactly this range?
</details>

<details>
<summary>Fix & Explanation</summary>

```go
type ServerConfig struct {
    Host string
    Port uint16  // uint16: 0 to 65535 — perfect for port numbers
}

func main() {
    config := ServerConfig{Host: "localhost", Port: 8080}
    fmt.Println(config.Port) // 8080
}
```

**Explanation:** `int8` has a max of 127 — 8080 overflows. Port numbers are always non-negative (0-65535), making `uint16` the semantically correct choice. Using the right type documents intent and prevents invalid values.
</details>

---

## Bug 2 — Float Used for Money 🟢

**Description:** Using float64 for financial calculations causes precision errors.

**Buggy Code:**
```go
package main

import "fmt"

type Cart struct {
    Items []float64
}

func (c Cart) Total() float64 {
    var total float64
    for _, price := range c.Items {
        total += price
    }
    return total
}

func main() {
    cart := Cart{Items: []float64{0.10, 0.10, 0.10}}
    total := cart.Total()
    fmt.Printf("Total: $%.2f\n", total)
    fmt.Println("Exact $0.30?", total == 0.30) // BUG: should be true
}
```

**Expected:** `Total: $0.30`, `Exact $0.30? true`
**Actual:** `Total: $0.30` (display rounds), `Exact $0.30? false`

<details>
<summary>Hint</summary>
Binary floating-point cannot represent 0.1 exactly. Sum of three 0.1s is 0.30000000000000004.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
type Cart struct {
    Items []int64 // CENTS: $0.10 = 10 cents
}

func (c Cart) Total() int64 {
    var total int64
    for _, price := range c.Items {
        total += price
    }
    return total
}

func main() {
    cart := Cart{Items: []int64{10, 10, 10}} // 10 cents each
    total := cart.Total()
    fmt.Printf("Total: $%.2f\n", float64(total)/100)
    fmt.Println("Exact 30 cents?", total == 30) // true
}
```

**Explanation:** `0.1` in binary float = `0.100000000000000005551...`. Three such values sum to `0.30000000000000004`. Use integer cents for exact money arithmetic.
</details>

---

## Bug 3 — int Assumed to be 64-bit 🟢

**Description:** Code assumes `int` is always 64-bit, breaking on 32-bit platforms.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    // 5 billion — fine on 64-bit, overflow on 32-bit
    var bigNumber int = 5_000_000_000

    // On 32-bit: compile error "constant 5000000000 overflows int"
    // On 64-bit: works fine

    fmt.Println("Big number:", bigNumber)
}
```

**Expected:** Works on all platforms
**Actual:** Compile error on 32-bit systems (constant overflows int)

<details>
<summary>Hint</summary>
`int` is 32-bit on 32-bit systems. For values larger than ~2.1 billion, use `int64`.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
var bigNumber int64 = 5_000_000_000 // always 64-bit, always works
fmt.Println("Big number:", bigNumber)
```

**Explanation:** `int` is platform-dependent: 32-bit on 32-bit systems (max ~2.1B), 64-bit on 64-bit systems. For values exceeding 2.1 billion, use `int64` explicitly. This matters for: large IDs, timestamps (Unix nanoseconds > 2^31 after 2038), byte counts, etc.
</details>

---

## Bug 4 — Integer Division Before Float Conversion 🟡

**Description:** Integer division truncates before the result is converted to float, giving wrong answer.

**Buggy Code:**
```go
package main

import "fmt"

func averageScore(scores []int) float64 {
    total := 0
    for _, s := range scores {
        total += s
    }
    // BUG: integer division (total/len) happens BEFORE float64 conversion
    return float64(total / len(scores))
}

func main() {
    scores := []int{70, 80, 90}
    avg := averageScore(scores)
    fmt.Printf("Average: %.2f\n", avg)
    // Expected: 80.00
    // Actual: 80.00 (lucky — 240/3=80 exactly)

    scores2 := []int{70, 75, 80}
    avg2 := averageScore(scores2)
    fmt.Printf("Average: %.2f\n", avg2)
    // Expected: 75.00
    // Actual: 75.00 (lucky again — 225/3=75)

    scores3 := []int{71, 72, 73}
    avg3 := averageScore(scores3)
    fmt.Printf("Average: %.2f\n", avg3)
    // Expected: 72.00
    // Actual: 72.00... wait, what about 71+72+75=218? 218/3=72.666...
    // BUT int division: 218/3=72 → float64(72)=72.00 NOT 72.67!
}
```

**Expected:** `72.67` for `{71, 72, 75}`
**Actual:** `72.00` (integer division truncates before float conversion)

<details>
<summary>Hint</summary>
The conversion happens AFTER division. Convert to float64 BEFORE dividing.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
func averageScore(scores []int) float64 {
    if len(scores) == 0 { return 0 }
    total := 0
    for _, s := range scores {
        total += s
    }
    // FIX: convert to float64 BEFORE dividing
    return float64(total) / float64(len(scores))
}
```

**Explanation:** `float64(total / len(scores))` first performs integer division (truncating), then converts. `float64(total) / float64(len(scores))` converts both to float64 first, then divides with float precision.
</details>

---

## Bug 5 — Unsigned Underflow Trap 🟡

**Description:** Subtracting from an unsigned integer when it might be zero causes wraparound.

**Buggy Code:**
```go
package main

import "fmt"

func countDown(n uint32) {
    for n >= 0 { // BUG: uint is always >= 0, this loops forever!
        fmt.Println(n)
        if n == 0 { break } // this fixes the infinite loop
        n--
    }
}

func processBuffer(buf []byte, size uint32) {
    // BUG: if size is 0, size-1 wraps to 4294967295!
    remaining := size - 1
    fmt.Println("Remaining:", remaining)
}

func main() {
    countDown(3)       // OK with the break

    processBuffer(nil, 0)  // PROBLEM: remaining = 4294967295
    processBuffer(nil, 5)  // OK: remaining = 4
}
```

**Expected:** `processBuffer(nil, 0)` shows 0 or error
**Actual:** `remaining: 4294967295` (uint32 underflow wraps)

<details>
<summary>Hint</summary>
Subtracting 1 from uint32(0) gives uint32 max (~4.3 billion), not -1.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
func processBuffer(buf []byte, size uint32) {
    if size == 0 {
        fmt.Println("Error: size cannot be zero")
        return
    }
    remaining := size - 1 // safe: size >= 1
    fmt.Println("Remaining:", remaining)
}

// For countdown: use signed int or add explicit zero check
func countDown(n int32) {
    for n >= 0 {
        fmt.Println(n)
        n-- // n goes -1, then loop condition fails
    }
}
```

**Explanation:** `uint32(0) - 1 = 4294967295` — unsigned types cannot go negative; they wrap. Always check for zero before subtracting from unsigned integers, or use signed types when negative values are meaningful.
</details>

---

## Bug 6 — Float Equality Comparison 🟡

**Description:** Comparing accumulated float64 sum with `==` fails due to accumulated rounding errors.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    // Simulate accumulating a balance
    balance := 100.0

    // 10 deposits of $0.01
    for i := 0; i < 10; i++ {
        balance += 0.01
    }

    // 10 withdrawals of $0.01
    for i := 0; i < 10; i++ {
        balance -= 0.01
    }

    // Should be back to exactly $100.00
    if balance == 100.0 {
        fmt.Println("Balance restored correctly")
    } else {
        fmt.Printf("ERROR: balance is %.20f, not 100.0\n", balance)
    }
}
```

**Expected:** `Balance restored correctly`
**Actual:** `ERROR: balance is 99.99999999999998579341...`

<details>
<summary>Hint</summary>
Float operations accumulate rounding errors. 0.01 can't be represented exactly in binary.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
// Option 1: Use int64 cents (best for money)
balance := int64(10000) // $100.00 = 10000 cents
for i := 0; i < 10; i++ { balance += 1 }  // +$0.01
for i := 0; i < 10; i++ { balance -= 1 }  // -$0.01
fmt.Println(balance == 10000) // true

// Option 2: Use epsilon comparison (for floats that can't be converted)
import "math"
const eps = 1e-9
if math.Abs(balance - 100.0) < eps {
    fmt.Println("Balance approximately restored")
}
```

**Explanation:** `0.01` in binary is `0.0000001010001111...` (repeating). Adding and subtracting it 10 times each doesn't cancel exactly. Use integers for financial calculations; use epsilon for comparison when floats are unavoidable.
</details>

---

## Bug 7 — int32 Database ID Overflow 🟡

**Description:** Using int32 for a database auto-increment ID in a high-traffic system.

**Buggy Code:**
```go
package main

import "fmt"

type UserRecord struct {
    ID       int32  // BUG: max 2,147,483,647 (~2.1 billion)
    Email    string
    JoinedAt int64
}

func generateID(lastID int32) int32 {
    return lastID + 1
}

func main() {
    // Simulate approaching the limit
    id := int32(2147483640) // 7 away from max

    for i := 0; i < 10; i++ {
        id = generateID(id)
        fmt.Printf("ID: %d\n", id)
    }
    // What happens at ID 2147483647+1?
}
```

**Expected:** IDs increment monotonically
**Actual:** At `2147483647 + 1`, wraps to `-2147483648` — invalid database ID!

<details>
<summary>Hint</summary>
int32 max is 2,147,483,647. A busy system can exceed this in months/years.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
type UserRecord struct {
    ID       int64  // int64: max 9.2 × 10^18 — safe for billions of years
    Email    string
    JoinedAt int64
}

func generateID(lastID int64) (int64, error) {
    if lastID == math.MaxInt64 {
        return 0, fmt.Errorf("ID space exhausted")
    }
    return lastID + 1, nil
}
```

**Explanation:** Always use `int64` for database IDs. A system generating 1000 IDs/second would exhaust `int32` in ~25 days if starting from 0, or immediately if the database has 2B+ existing records. `int64` provides 292 years at 1 billion IDs/second.
</details>

---

## Bug 8 — int64 to float64 Precision Loss 🔴

**Description:** A large int64 value is converted to float64 for a calculation, silently losing precision.

**Buggy Code:**
```go
package main

import "fmt"

func calculateFee(transactionID int64, feeRate float64) float64 {
    // BUG: int64 → float64 conversion loses precision for large IDs
    return float64(transactionID) * feeRate
}

func main() {
    // Large transaction ID (common in high-frequency trading)
    txID := int64(9_007_199_254_740_993) // 2^53 + 1

    // The conversion float64(txID) loses the last bit
    f := float64(txID)
    fmt.Println("Original ID:  ", txID)  // 9007199254740993
    fmt.Println("As float64:   ", f)      // 9007199254740992.0 (WRONG!)
    fmt.Println("Equal?:", int64(f) == txID) // false

    fee := calculateFee(txID, 0.001)
    fmt.Printf("Fee: %.6f\n", fee) // slightly wrong due to precision loss
}
```

**Expected:** Exact fee calculation
**Actual:** ID `9007199254740993` becomes `9007199254740992` when converted to float64

<details>
<summary>Hint</summary>
float64 mantissa is 52 bits, so integers > 2^53 can't all be represented exactly.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
import "math/big"

func calculateFeePrecise(transactionID int64, feeRateNumerator, feeRateDenominator int64) *big.Rat {
    // Use big.Rat for exact arithmetic
    id := new(big.Rat).SetInt64(transactionID)
    rate := new(big.Rat).SetFrac(
        big.NewInt(feeRateNumerator),
        big.NewInt(feeRateDenominator),
    )
    return new(big.Rat).Mul(id, rate)
}

// Or: use integer arithmetic throughout
func calculateFeeInt(transactionID, feeRateBps int64) int64 {
    // fee rate in basis points (1 bps = 0.01%)
    return transactionID * feeRateBps / 10_000
}
```

**Explanation:** `float64` can exactly represent integers up to 2^53 = 9,007,199,254,740,992. Values larger than this lose precision when converted. For financial systems handling large transaction amounts or IDs, use `math/big` or keep everything as `int64` with basis points.
</details>

---

## Bug 9 — Struct Padding Wastes Memory at Scale 🔴

**Description:** Poor struct field ordering wastes 40% memory for 10 million records.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "unsafe"
)

// Used for 10 million user records
type UserMetric struct {
    IsActive   bool     // 1 byte + 7 bytes padding
    LoginCount int64    // 8 bytes
    IsVerified bool     // 1 byte + 3 bytes padding
    Score      float32  // 4 bytes
    UserID     uint8    // 1 byte + 7 bytes padding
    LastSeen   float64  // 8 bytes
}

func main() {
    fmt.Println("UserMetric size:", unsafe.Sizeof(UserMetric{}))
    // Expected: 40 bytes (wasteful)

    n := 10_000_000
    totalMB := unsafe.Sizeof(UserMetric{}) * uintptr(n) / 1_000_000
    fmt.Printf("10M records: %d MB\n", totalMB)
}
```

**Expected:** Minimal memory usage
**Actual:** 40 bytes per record × 10M = 400MB instead of optimal ~240MB

<details>
<summary>Hint</summary>
Rule: order fields from largest to smallest size. Group small fields together at the end.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
type UserMetric struct {
    LoginCount int64   // 8 bytes (offset 0)
    LastSeen   float64 // 8 bytes (offset 8)
    Score      float32 // 4 bytes (offset 16)
    UserID     uint8   // 1 byte  (offset 20)
    IsActive   bool    // 1 byte  (offset 21)
    IsVerified bool    // 1 byte  (offset 22)
    _          [1]byte // 1 byte padding (to align to 8 bytes)
}
// OR just:
type UserMetricSimple struct {
    LoginCount int64
    LastSeen   float64
    Score      float32
    IsActive   bool
    IsVerified bool
    UserID     uint8
}

func main() {
    fmt.Println("Optimized size:", unsafe.Sizeof(UserMetricSimple{})) // 24 bytes
    n := 10_000_000
    optimized := unsafe.Sizeof(UserMetricSimple{}) * uintptr(n) / 1_000_000
    fmt.Printf("10M records: %d MB\n", optimized) // 240 MB vs 400 MB
}
```

**Explanation:** Go aligns each field to its own size. `int64` needs 8-byte alignment, so placing a `bool` (1 byte) before it wastes 7 bytes of padding. Ordering fields largest-to-smallest eliminates most padding. Savings: 400MB → 240MB (40% reduction).
</details>

---

## Bug 10 — Missing Overflow Check in Protocol Parser 🔴

**Description:** Integer overflow in message size calculation allows crafting a message that allocates a very small buffer.

**Buggy Code:**
```go
package main

import (
    "encoding/binary"
    "fmt"
)

// Protocol: [4-byte count][4-byte item-size][data...]
func parseMessage(data []byte) ([][]byte, error) {
    if len(data) < 8 {
        return nil, fmt.Errorf("header too short")
    }

    count := binary.BigEndian.Uint32(data[0:4])
    itemSize := binary.BigEndian.Uint32(data[4:8])

    // BUG: count * itemSize can overflow uint32!
    // With count=1000000, itemSize=5000: 5*10^9 overflows uint32 → small number
    totalSize := count * itemSize

    fmt.Printf("count=%d, itemSize=%d, totalSize=%d\n", count, itemSize, totalSize)

    if uint32(len(data)-8) < totalSize {
        return nil, fmt.Errorf("data truncated: need %d, have %d", totalSize, len(data)-8)
    }

    // Allocate result based on truncated totalSize — WRONG!
    items := make([][]byte, count)
    _ = items
    return items, nil
}

func main() {
    // Crafted input: count=1000000, itemSize=5000
    // 1000000 * 5000 = 5000000000 overflows uint32 → 705032704 (small value)
    data := make([]byte, 16)
    binary.BigEndian.PutUint32(data[0:4], 1000000)
    binary.BigEndian.PutUint32(data[4:8], 5000)
    result, err := parseMessage(data)
    fmt.Println(len(result), err)
}
```

**Expected:** Error: allocation too large
**Actual:** Overflow bypasses the size check; may allocate wrong amount

<details>
<summary>Hint</summary>
Use uint64 for the multiplication to detect overflow, then validate against limits.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
const maxAllocation = 100 * 1024 * 1024 // 100MB limit

func parseMessage(data []byte) ([][]byte, error) {
    if len(data) < 8 {
        return nil, fmt.Errorf("header too short")
    }

    count := uint64(binary.BigEndian.Uint32(data[0:4]))
    itemSize := uint64(binary.BigEndian.Uint32(data[4:8]))

    // Use uint64 for multiplication to detect overflow
    if itemSize > 0 && count > maxAllocation/itemSize {
        return nil, fmt.Errorf("allocation too large: %d * %d", count, itemSize)
    }

    totalSize := count * itemSize

    if uint64(len(data)-8) < totalSize {
        return nil, fmt.Errorf("data truncated: need %d, have %d", totalSize, len(data)-8)
    }

    items := make([][]byte, count)
    return items, nil
}
```

**Explanation:** `uint32(1000000) * uint32(5000) = uint32(5000000000)` overflows to `705032704` — a tiny value that bypasses the size check. By widening to `uint64` before multiplying and adding a sanity limit, we prevent both the overflow and excessive allocations. This class of bug (CWE-190: Integer Overflow) has been the source of many CVEs.
</details>

---

## Bug 11 — Accumulating Float Error in Loop 🔴

**Description:** Adding a small float value N times accumulates error that becomes significant.

**Buggy Code:**
```go
package main

import "fmt"

func generateTimestamps(start float64, stepSeconds float64, n int) []float64 {
    timestamps := make([]float64, n)
    for i := 0; i < n; i++ {
        timestamps[i] = start + float64(i)*stepSeconds
    }
    // BUG: use start + accumulated sum instead of start + i*step
    // The above is actually CORRECT — see below for the bug version:
    return timestamps
}

func generateTimestampsBuggy(start float64, stepSeconds float64, n int) []float64 {
    timestamps := make([]float64, n)
    current := start
    for i := 0; i < n; i++ {
        timestamps[i] = current
        current += stepSeconds // BUG: accumulates float error
    }
    return timestamps
}

func main() {
    start := 1700000000.0
    step := 0.001 // 1 millisecond
    n := 1000000  // 1 million steps

    correct := generateTimestamps(start, step, n)
    buggy := generateTimestampsBuggy(start, step, n)

    // After 1 million steps:
    expected := start + float64(n-1)*step
    fmt.Printf("Expected last: %.6f\n", expected)
    fmt.Printf("Correct last:  %.6f\n", correct[n-1])
    fmt.Printf("Buggy last:    %.6f\n", buggy[n-1])
    // Buggy may differ by several microseconds due to accumulated error
}
```

**Expected:** Both implementations agree on the final timestamp
**Actual:** Buggy accumulation diverges by microseconds for large N

<details>
<summary>Hint</summary>
Compute each value independently as `start + i*step` rather than adding to an accumulator.
</details>

<details>
<summary>Fix & Explanation</summary>

```go
func generateTimestamps(start float64, stepSeconds float64, n int) []float64 {
    timestamps := make([]float64, n)
    for i := 0; i < n; i++ {
        // CORRECT: compute from base each time, no accumulation
        timestamps[i] = start + float64(i)*stepSeconds
    }
    return timestamps
}
```

**Explanation:** Accumulating `current += step` 1 million times compounds floating-point rounding errors. Each addition introduces a tiny error (~0.5 ULP), and after 1M additions, the total error can be ~0.5 ULP × √N ≈ 500 ULPs. Computing from the base each time (`start + i*step`) limits the error to just the rounding of that single multiplication, which is typically much smaller.
</details>
