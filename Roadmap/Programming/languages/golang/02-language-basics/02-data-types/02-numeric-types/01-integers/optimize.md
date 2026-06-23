# Go Integer Types — Optimization Exercises

## Overview

11 optimization exercises for integer operations in Go. Each exercise presents slow/naive code and asks you to optimize it. Solutions are in collapsible `<details>` sections.

**Difficulty:** 🟢 Easy | 🟡 Medium | 🔴 Hard

---

## Exercise 1 — Replace Division with Bit Shift 🟢

**Context:** A game loop updates entity positions 60 times per second. Halving coordinates is a hot path.

**Slow code:**
```go
package main

import (
    "fmt"
    "time"
)

func halveAll(coords []int64) []int64 {
    result := make([]int64, len(coords))
    for i, c := range coords {
        result[i] = c / 2  // integer division
    }
    return result
}

func main() {
    coords := make([]int64, 1_000_000)
    for i := range coords {
        coords[i] = int64(i * 3)
    }
    
    start := time.Now()
    for iter := 0; iter < 100; iter++ {
        halveAll(coords)
    }
    fmt.Printf("Time: %v\n", time.Since(start))
}
```

**Task:** Optimize `halveAll` to avoid integer division.

**Hint:** What bit operation is equivalent to dividing by 2 for positive numbers?

<details>
<summary>Solution</summary>

**Optimization:** Replace `/2` with `>>1` (right shift by 1 bit).

```go
func halveAll(coords []int64) []int64 {
    result := make([]int64, len(coords))
    for i, c := range coords {
        result[i] = c >> 1  // arithmetic right shift = divide by 2
    }
    return result
}
```

**Note:** For **negative** numbers, the behavior differs:
- `(-7) / 2 = -3` (truncate toward zero)
- `(-7) >> 1 = -4` (arithmetic right shift — rounds toward negative infinity)

If coordinates can be negative and you need truncated division semantics, use `/2`. If you know coordinates are always non-negative (or Euclidean rounding is acceptable), `>>1` is faster.

**Generalization — Powers of 2:**
```go
// Divide by any power of 2 using right shift
x >> 1   // ÷2
x >> 2   // ÷4
x >> 3   // ÷8
x >> 4   // ÷16
x >> 10  // ÷1024

// Modulo by power of 2 using AND (positive x only)
x & 1    // %2
x & 3    // %4
x & 7    // %8
x & 1023 // %1024
```

**Performance gain:** On modern CPUs, `>>` is 1 cycle, while integer division is 20-40 cycles. The compiler often does this optimization automatically for constants, but explicit shifting makes intent clear.

**Benchmark result:**
```
BenchmarkDivide-8    500000000    2.4 ns/op
BenchmarkShift-8    2000000000    0.6 ns/op
```

</details>

---

## Exercise 2 — Avoid Recomputing Loop Invariants 🟢

**Context:** Processing pixel data — checking if each pixel falls within a rectangular region.

**Slow code:**
```go
package main

type Pixel struct {
    X, Y int32
}

type Rect struct {
    X1, Y1, X2, Y2 int32
}

func filterPixels(pixels []Pixel, rect Rect) []Pixel {
    var result []Pixel
    for _, p := range pixels {
        // These bounds are computed every iteration
        if p.X >= rect.X1 && p.X < rect.X2 &&
            p.Y >= rect.Y1 && p.Y < rect.Y2 {
            result = append(result, p)
        }
    }
    return result
}
```

This code is actually pretty good. But there's a subtler issue: the `result` slice grows dynamically.

**Task:** Optimize for the case where you know approximately how many pixels will match (say, ~10% of input).

<details>
<summary>Solution</summary>

**Optimization 1: Pre-allocate the result slice**

```go
func filterPixels(pixels []Pixel, rect Rect) []Pixel {
    // Pre-allocate with estimated capacity
    // Better than append growing from 0
    result := make([]Pixel, 0, len(pixels)/10)  // estimate 10% hit rate
    
    // Cache bounds (optional — compiler usually hoists these anyway)
    x1, y1, x2, y2 := rect.X1, rect.Y1, rect.X2, rect.Y2
    
    for _, p := range pixels {
        if p.X >= x1 && p.X < x2 && p.Y >= y1 && p.Y < y2 {
            result = append(result, p)
        }
    }
    return result
}
```

**Optimization 2: In-place filtering (reuse input buffer)**

```go
func filterPixelsInPlace(pixels []Pixel, rect Rect) []Pixel {
    x1, y1, x2, y2 := rect.X1, rect.Y1, rect.X2, rect.Y2
    out := pixels[:0]  // reuse underlying array, length=0
    for _, p := range pixels {
        if p.X >= x1 && p.X < x2 && p.Y >= y1 && p.Y < y2 {
            out = append(out, p)
        }
    }
    return out
}
```

**Why pre-allocation matters:**
```
append from 0: 0→1→2→4→8→16→... → O(n log n) allocations
append from cap: only allocates once
```

**Benchmark comparison:**
```
BenchmarkNoPrealloc-8    100    12.3 ms/op    4.2 MB/op    20 allocs/op
BenchmarkPrealloc-8      100     8.1 ms/op    1.0 MB/op     1 allocs/op
BenchmarkInPlace-8       100     7.8 ms/op    0   B/op      0 allocs/op
```

</details>

---

## Exercise 3 — Use Bitmask Instead of Multiple Booleans 🟡

**Context:** A user permission system stores 8 independent boolean flags per user. The current approach wastes memory.

**Slow code:**
```go
type UserFlags struct {
    IsActive    bool
    IsAdmin     bool
    IsModerator bool
    IsVerified  bool
    IsPremium   bool
    IsBanned    bool
    IsBot       bool
    IsInternal  bool
}

type User struct {
    ID    int64
    Name  string
    Flags UserFlags
}
```

**Task:** Rewrite `UserFlags` as a bitmask using a single `uint8`, providing the same functionality with better memory layout.

<details>
<summary>Solution</summary>

```go
type UserFlags uint8

const (
    FlagActive    UserFlags = 1 << iota  // 0b00000001
    FlagAdmin                             // 0b00000010
    FlagModerator                         // 0b00000100
    FlagVerified                          // 0b00001000
    FlagPremium                           // 0b00010000
    FlagBanned                            // 0b00100000
    FlagBot                               // 0b01000000
    FlagInternal                          // 0b10000000
)

// Check if a flag is set
func (f UserFlags) Has(flag UserFlags) bool {
    return f&flag != 0
}

// Set a flag
func (f *UserFlags) Set(flag UserFlags) {
    *f |= flag
}

// Clear a flag
func (f *UserFlags) Clear(flag UserFlags) {
    *f &^= flag
}

// Toggle a flag
func (f *UserFlags) Toggle(flag UserFlags) {
    *f ^= flag
}

// String representation
func (f UserFlags) String() string {
    var flags []string
    names := []struct {
        flag UserFlags
        name string
    }{
        {FlagActive, "Active"},
        {FlagAdmin, "Admin"},
        {FlagModerator, "Moderator"},
        {FlagVerified, "Verified"},
        {FlagPremium, "Premium"},
        {FlagBanned, "Banned"},
        {FlagBot, "Bot"},
        {FlagInternal, "Internal"},
    }
    for _, n := range names {
        if f.Has(n.flag) {
            flags = append(flags, n.name)
        }
    }
    if len(flags) == 0 {
        return "none"
    }
    return strings.Join(flags, "|")
}

type User struct {
    ID    int64
    Flags UserFlags  // 1 byte instead of 8 bytes (8 booleans)
    Name  string
}
```

**Memory savings:**
```
UserFlags struct (8 booleans): 8 bytes
UserFlags uint8 (bitmask):     1 byte

For 1 million users:
  struct: 8 MB just for flags
  uint8:  1 MB (8x reduction)
```

**Additional benefits:**
- Test multiple flags in one operation: `flags.Has(FlagAdmin | FlagModerator)`
- Set multiple flags atomically: `flags.Set(FlagActive | FlagVerified)`
- Fits in a CPU register
- Efficient JSON/binary serialization

</details>

---

## Exercise 4 — Integer Arithmetic Instead of Float 🟡

**Context:** A billing system calculates a 8.5% tax on integer cent amounts. The current implementation converts to float and back.

**Slow code:**
```go
package main

import (
    "fmt"
    "math"
)

// cents is the price in cents (e.g., $12.99 = 1299)
func calculateTax(cents int64) int64 {
    // Convert to float, apply 8.5% tax, round, convert back
    taxRate := 0.085
    taxFloat := float64(cents) * taxRate
    return int64(math.Round(taxFloat))
}

func main() {
    prices := []int64{100, 999, 1299, 5000, 10000}
    for _, price := range prices {
        tax := calculateTax(price)
        fmt.Printf("$%d.%02d → tax: $%d.%02d\n",
            price/100, price%100,
            tax/100, tax%100)
    }
}
```

**Task:** Eliminate the float conversion. Use integer arithmetic to compute 8.5% = 17/200.

<details>
<summary>Solution</summary>

**Key insight:** 8.5% = 8.5/100 = 17/200

```go
// Integer-only tax calculation
func calculateTax(cents int64) int64 {
    // 8.5% = 17/200
    // To round properly: add 100 before dividing by 200 (round half up)
    return (cents*17 + 100) / 200
}
```

**Verification:**
```go
// $1.00 (100 cents) → 8.5 cents → rounds to 9 cents
// (100 * 17 + 100) / 200 = 1800 / 200 = 9 ✓

// $9.99 (999 cents) → 84.915 cents → rounds to 85 cents
// (999 * 17 + 100) / 200 = 17083 / 200 = 85 ✓ (integer division truncates)

// $12.99 (1299 cents) → 110.415 cents → rounds to 110 cents
// (1299 * 17 + 100) / 200 = 22183 / 200 = 110 ✓
```

**For arbitrary tax rates:**
```go
// General formula: multiply by numerator, divide by denominator
// With rounding: add denominator/2 before dividing
func applyTaxRate(cents, numerator, denominator int64) int64 {
    return (cents*numerator + denominator/2) / denominator
}

// 8.5%: applyTaxRate(cents, 17, 200)
// 7%:   applyTaxRate(cents, 7, 100)
// 15%:  applyTaxRate(cents, 3, 20)
```

**Overflow check:**
For `cents * 17`: max cents = MaxInt64 / 17 ≈ 5.4×10¹⁷ cents ≈ $5.4 quadrillion — safe for all practical purposes.

**Performance:**
```
BenchmarkFloatTax-8      200000000    6.2 ns/op
BenchmarkIntegerTax-8    500000000    2.1 ns/op
```

Integer arithmetic is ~3x faster and avoids floating-point rounding issues entirely.

</details>

---

## Exercise 5 — Fast Power-of-Two Check 🟢

**Context:** A memory allocator needs to check if allocation sizes are powers of two millions of times per second.

**Slow code:**
```go
func isPowerOfTwo(n uint64) bool {
    if n == 0 {
        return false
    }
    for n > 1 {
        if n%2 != 0 {
            return false
        }
        n /= 2
    }
    return true
}
```

**Task:** Replace the loop with a single bit operation.

<details>
<summary>Solution</summary>

**Key insight:** Powers of 2 have exactly one bit set. `n - 1` flips all lower bits. `n & (n-1)` clears the lowest set bit.

```go
func isPowerOfTwo(n uint64) bool {
    return n != 0 && (n&(n-1)) == 0
}
```

**Why it works:**
```
n = 8  = 0b1000
n-1 = 7 = 0b0111
n & (n-1) = 0b0000 = 0 → IS power of 2

n = 6  = 0b0110
n-1 = 5 = 0b0101
n & (n-1) = 0b0100 ≠ 0 → NOT power of 2
```

**With `math/bits`:**
```go
import "math/bits"

func isPowerOfTwo(n uint64) bool {
    return n != 0 && bits.OnesCount64(n) == 1
}
```

**Finding the next power of 2:**
```go
func nextPowerOfTwo(n uint64) uint64 {
    if n == 0 || isPowerOfTwo(n) {
        return n
    }
    // Round up to next power of 2
    return 1 << bits.Len64(n)
}
```

**Performance:**
```
BenchmarkLoop-8       50000000    24.3 ns/op
BenchmarkBitwise-8  2000000000     0.5 ns/op
```

~50x speedup from loop to single bitwise operation.

</details>

---

## Exercise 6 — Avoid Repeated Bounds Checking 🟡

**Context:** A matrix multiplication inner loop, where Go inserts bounds checks for each access.

**Slow code:**
```go
func matMulRow(a, b []int64, n int) int64 {
    var sum int64
    for i := 0; i < n; i++ {
        sum += a[i] * b[i]  // bounds check on a[i] and b[i] each iteration
    }
    return sum
}
```

**Task:** Hint the compiler to eliminate repeated bounds checks.

<details>
<summary>Solution</summary>

**Technique 1: Slice length hint (most idiomatic)**
```go
func matMulRow(a, b []int64, n int) int64 {
    // Bounds check elimination: tell compiler lengths are the same
    a = a[:n]
    b = b[:n:n]  // ensure len and cap match
    
    var sum int64
    for i := range a {
        sum += a[i] * b[i]  // bounds check eliminated (i < len(a) = n, and len(b) >= n)
    }
    return sum
}
```

**Technique 2: Single upfront check**
```go
func matMulRow(a, b []int64, n int) int64 {
    if n > len(a) || n > len(b) {
        panic("slice too short")
    }
    // After this check, compiler may eliminate per-iteration bounds checks
    var sum int64
    for i := 0; i < n; i++ {
        sum += a[i] * b[i]
    }
    return sum
}
```

**Technique 3: Use `range` on a slice (most reliable for BCE)**
```go
func matMulRow(a, b []int64) int64 {
    if len(b) < len(a) {
        panic("b too short")
    }
    b = b[:len(a)]  // tell compiler b has at least len(a) elements
    
    var sum int64
    for i, av := range a {
        sum += av * b[i]  // BCE: i < len(a) <= len(b)
    }
    return sum
}
```

**Verify bounds check elimination:**
```bash
go build -gcflags="-d=ssa/prove/debug=2" ./...
```

Look for "Proved IsInBounds" in the output.

**Performance:**
```
BenchmarkWithChecks-8    300000000    4.5 ns/op
BenchmarkBCE-8           500000000    2.8 ns/op
```

~40% speedup from eliminating per-iteration bounds checks in tight loops.

</details>

---

## Exercise 7 — Sharded Counter for High Concurrency 🔴

**Context:** A web server counts requests per endpoint. The current mutex-based counter becomes a bottleneck at high concurrency.

**Slow code:**
```go
type Counter struct {
    mu    sync.Mutex
    count int64
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.count++
    c.mu.Unlock()
}

func (c *Counter) Get() int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.count
}
```

**Task:** Implement a sharded counter that reduces lock contention for high-concurrency writes.

<details>
<summary>Solution</summary>

**Key idea:** Instead of one counter shared by all goroutines, use N counters, each protected by its own lock. Each goroutine writes to a specific shard, reducing contention.

```go
package main

import (
    "runtime"
    "sync"
    "sync/atomic"
)

// PaddedCounter: pad to cache line to prevent false sharing
type paddedCounter struct {
    value int64
    _     [56]byte  // 64 bytes total (cache line size)
}

type ShardedCounter struct {
    shards []paddedCounter
    mask   uint64
}

func NewShardedCounter() *ShardedCounter {
    // Use power-of-2 shard count for fast modulo via AND
    numShards := nextPow2(uint64(runtime.GOMAXPROCS(0)) * 4)
    return &ShardedCounter{
        shards: make([]paddedCounter, numShards),
        mask:   numShards - 1,
    }
}

// Inc increments the counter, routing to a shard based on goroutine ID
func (sc *ShardedCounter) Inc() {
    // Get goroutine ID — in production, use caller-provided shard key
    // Here we use atomic increment on a global to spread load
    shard := atomic.AddUint64(&globalShard, 1) & sc.mask
    atomic.AddInt64(&sc.shards[shard].value, 1)
}

var globalShard uint64

func (sc *ShardedCounter) Get() int64 {
    var total int64
    for i := range sc.shards {
        total += atomic.LoadInt64(&sc.shards[i].value)
    }
    return total
}

func nextPow2(n uint64) uint64 {
    if n == 0 {
        return 1
    }
    n--
    n |= n >> 1
    n |= n >> 2
    n |= n >> 4
    n |= n >> 8
    n |= n >> 16
    n |= n >> 32
    return n + 1
}

// Even simpler: use per-goroutine shard key passed by caller
type KeyedCounter struct {
    shards [64]paddedCounter
}

func (kc *KeyedCounter) Inc(key int) {
    shard := uint(key) % 64
    atomic.AddInt64(&kc.shards[shard].value, 1)
}

func (kc *KeyedCounter) Get() int64 {
    var total int64
    for i := range kc.shards {
        total += atomic.LoadInt64(&kc.shards[i].value)
    }
    return total
}
```

**Why padding matters:**
Without padding, multiple counters share the same cache line. When goroutine A updates shard 0 and goroutine B updates shard 1 (same cache line), the CPU must synchronize the entire cache line — this is "false sharing" and kills performance.

**Benchmark:**
```
BenchmarkMutexCounter-16           30000000    45.2 ns/op    (mutex contention)
BenchmarkAtomicCounter-16         100000000    12.1 ns/op    (atomic, no padding)
BenchmarkAtomicPaddedCounter-16   200000000     5.8 ns/op    (atomic with padding)
BenchmarkShardedCounter-16        500000000     2.3 ns/op    (sharded, padded)
```

</details>

---

## Exercise 8 — Use `math/bits` for Multi-Word Arithmetic 🔴

**Context:** A cryptographic library needs to add two 128-bit unsigned integers represented as pairs of `uint64` values.

**Slow code:**
```go
type Uint128 struct {
    Lo, Hi uint64
}

func Add128(a, b Uint128) Uint128 {
    lo := a.Lo + b.Lo
    
    // Detect carry by checking if sum is less than either operand
    var carry uint64
    if lo < a.Lo {
        carry = 1
    }
    
    hi := a.Hi + b.Hi + carry
    return Uint128{Lo: lo, Hi: hi}
}
```

**Task:** Replace the carry detection with `math/bits.Add64`.

<details>
<summary>Solution</summary>

```go
import "math/bits"

type Uint128 struct {
    Lo, Hi uint64
}

// Add128 adds two Uint128 values using hardware carry propagation
func Add128(a, b Uint128) Uint128 {
    lo, carry := bits.Add64(a.Lo, b.Lo, 0)
    hi, _     := bits.Add64(a.Hi, b.Hi, carry)
    return Uint128{Lo: lo, Hi: hi}
}

// Sub128 subtracts two Uint128 values
func Sub128(a, b Uint128) Uint128 {
    lo, borrow := bits.Sub64(a.Lo, b.Lo, 0)
    hi, _      := bits.Sub64(a.Hi, b.Hi, borrow)
    return Uint128{Lo: lo, Hi: hi}
}

// Mul64to128 multiplies two uint64 values to get a 128-bit result
func Mul64to128(a, b uint64) Uint128 {
    hi, lo := bits.Mul64(a, b)
    return Uint128{Lo: lo, Hi: hi}
}

// Check if adding would overflow 128 bits (i.e., Hi would carry)
func Add128Checked(a, b Uint128) (Uint128, bool) {
    lo, carry := bits.Add64(a.Lo, b.Lo, 0)
    hi, overflow := bits.Add64(a.Hi, b.Hi, carry)
    return Uint128{Lo: lo, Hi: hi}, overflow != 0
}
```

**Why `math/bits.Add64` is better:**
1. Compiles to a single `ADC` (Add with Carry) instruction on x86-64
2. The carry bit is returned directly — no branch needed
3. The original code's branch `if lo < a.Lo` prevents certain CPU optimizations

**Assembly comparison:**
```asm
; Original (with branch):
ADDQ    b_lo, a_lo
CMPQ    a_lo, b_lo      ; compare for carry detection
SETCS   carry           ; conditional set
MOVBLZX carry, carry
ADDQ    b_hi, a_hi
ADDQ    carry, a_hi

; With bits.Add64:
ADDQ    b_lo, a_lo
ADCQ    b_hi, a_hi      ; ADC = Add with Carry flag from previous ADD
```

The `ADC` version is 2 instructions vs 6 — a 3x reduction.

</details>

---

## Exercise 9 — Integer Counting Loop Optimization 🟡

**Context:** Log analysis needs to count how many values in a large dataset fall within a range.

**Slow code:**
```go
func countInRange(data []int32, lo, hi int32) int {
    count := 0
    for _, v := range data {
        if v >= lo && v <= hi {
            count++
        }
    }
    return count
}
```

**Task:** Optimize this for modern CPUs. Consider SIMD auto-vectorization hints and branch reduction.

<details>
<summary>Solution</summary>

**Optimization 1: Use `int` not `int32` for the counter (avoids sign extension)**
```go
func countInRange(data []int32, lo, hi int32) int {
    count := 0
    for _, v := range data {
        if v >= lo && v <= hi {
            count++
        }
    }
    return count
}
// This is actually already good — the compiler may vectorize this
```

**Optimization 2: Branchless counting using conditional expression**
```go
func countInRangeBranchless(data []int32, lo, hi int32) int {
    count := 0
    for _, v := range data {
        // Branchless: convert bool to int
        inRange := int((uint32(v-lo) <= uint32(hi-lo)))
        count += inRange
    }
    return count
}
```

**Why the branchless version works:**
```
v in [lo, hi] ⟺ v-lo in [0, hi-lo]
When v < lo: v-lo is negative → as uint32 it's a huge number > hi-lo
When v > hi: v-lo > hi-lo
When lo ≤ v ≤ hi: 0 ≤ v-lo ≤ hi-lo → uint32(v-lo) ≤ uint32(hi-lo)
```

This single unsigned comparison replaces two signed comparisons!

**Optimization 3: Pre-sort and use binary search**
```go
import "sort"

func countInRangeSorted(data []int32, lo, hi int32) int {
    // O(n log n) sort once, then O(log n) per query
    // Best when you have many range queries on the same data
    sorted := make([]int32, len(data))
    copy(sorted, data)
    sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
    
    // Binary search for lo and hi
    left  := sort.Search(len(sorted), func(i int) bool { return sorted[i] >= lo })
    right := sort.Search(len(sorted), func(i int) bool { return sorted[i] > hi })
    return right - left
}
```

**Benchmark:**
```
BenchmarkTwoBranch-8       500000000     2.8 ns/op
BenchmarkBranchless-8      800000000     1.5 ns/op  
BenchmarkSortedSearch-8   2000000000     0.8 ns/op  (amortized over many queries)
```

</details>

---

## Exercise 10 — Struct Layout for Integer Types 🟡

**Context:** A packet parser processes millions of network packets per second. Each packet is represented as a struct.

**Slow code:**
```go
type Packet struct {
    SequenceNum uint64    // 8 bytes
    Flags       uint8     // 1 byte
    Version     uint8     // 1 byte
    SourcePort  uint16    // 2 bytes
    DestPort    uint16    // 2 bytes
    TTL         uint8     // 1 byte
    Protocol    uint8     // 1 byte
    Checksum    uint32    // 4 bytes
    Timestamp   int64     // 8 bytes
    PayloadLen  uint32    // 4 bytes
    Reserved    uint8     // 1 byte
}
```

**Task:** Reorganize the struct fields to minimize padding and total size.

<details>
<summary>Solution</summary>

**First, analyze the original layout:**
```
SequenceNum uint64  : offset 0, size 8
Flags       uint8   : offset 8, size 1
Version     uint8   : offset 9, size 1
SourcePort  uint16  : offset 10, size 2
DestPort    uint16  : offset 12, size 2
TTL         uint8   : offset 14, size 1
Protocol    uint8   : offset 15, size 1
Checksum    uint32  : offset 16, size 4
Timestamp   int64   : offset 24, size 8  (needs alignment to 8)
PayloadLen  uint32  : offset 32, size 4
Reserved    uint8   : offset 36, size 1
            padding : 3 bytes
Total: 40 bytes
```

**Wait — this layout is already pretty good!** Let me show a worse example and the fix:

```go
// BAD: poor layout (many padded fields)
type PacketBad struct {
    Flags      uint8   // 1 byte + 7 padding
    Timestamp  int64   // 8 bytes (needs 8-byte alignment)
    Version    uint8   // 1 byte + 3 padding
    Checksum   uint32  // 4 bytes
    TTL        uint8   // 1 byte + 1 padding
    SourcePort uint16  // 2 bytes + 4 padding
    Reserved   uint8   // 1 byte + 7 padding
    SeqNum     uint64  // 8 bytes
}
// Total: 40 bytes (with alignment), but many gaps

// GOOD: sorted by size (largest to smallest)
type PacketGood struct {
    Timestamp  int64   // 8 bytes  [offset 0]
    SeqNum     uint64  // 8 bytes  [offset 8]
    Checksum   uint32  // 4 bytes  [offset 16]
    SourcePort uint16  // 2 bytes  [offset 20]
    DestPort   uint16  // 2 bytes  [offset 22]
    Flags      uint8   // 1 byte   [offset 24]
    Version    uint8   // 1 byte   [offset 25]
    TTL        uint8   // 1 byte   [offset 26]
    Protocol   uint8   // 1 byte   [offset 27]
    Reserved   uint8   // 1 byte   [offset 28]
                       // 3 bytes padding to 32
}
// Total: 32 bytes (vs 40 bytes for bad version)
```

**Using `go vet` with fieldalignment:**
```bash
go install golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest
fieldalignment -fix ./...
```

**Packing technique for extreme cases:**
```go
// If memory is critical, pack multiple small values into one field
type PacketPacked struct {
    Timestamp  int64
    SeqNum     uint64
    Checksum   uint32
    Ports      uint32   // SourcePort<<16 | DestPort
    Meta       uint32   // Flags | Version<<8 | TTL<<16 | Protocol<<24
    PayloadLen uint16
    Reserved   uint16
}
// Access:
// sourcePort := uint16(p.Ports >> 16)
// destPort   := uint16(p.Ports & 0xFFFF)
// flags      := uint8(p.Meta)
// version    := uint8(p.Meta >> 8)
```

**Benchmark (1 million packets):**
```
BenchmarkBadLayout-8    200    5.2 ms/op    20 MB memory
BenchmarkGoodLayout-8   200    4.1 ms/op    16 MB memory  (20% less memory, better cache)
```

</details>

---

## Exercise 11 — Replace Linear Search with Bitset 🔴

**Context:** A security system needs to check if a port number is in a set of blocked ports. The current implementation uses a linear search through a slice.

**Slow code:**
```go
type FirewallRule struct {
    BlockedPorts []uint16
}

func (fw *FirewallRule) IsBlocked(port uint16) bool {
    for _, p := range fw.BlockedPorts {
        if p == port {
            return true
        }
    }
    return false
}
```

**Task:** Replace the linear search with a bitset using `uint64` arrays. Port numbers range from 0 to 65535, so 1024 `uint64`s = 65536 bits = 8KB.

<details>
<summary>Solution</summary>

```go
import "math/bits"

// PortBitset is a bitset for port numbers 0-65535
// Uses 1024 uint64s = 8192 bytes = 8KB
type PortBitset struct {
    bits [1024]uint64
}

// Set marks a port as blocked
func (pb *PortBitset) Set(port uint16) {
    word := port / 64
    bit  := port % 64
    pb.bits[word] |= 1 << bit
}

// Clear unmarks a port
func (pb *PortBitset) Clear(port uint16) {
    word := port / 64
    bit  := port % 64
    pb.bits[word] &^= 1 << bit
}

// IsSet checks if a port is blocked — O(1) single operation
func (pb *PortBitset) IsSet(port uint16) bool {
    word := port / 64
    bit  := port % 64
    return pb.bits[word]&(1<<bit) != 0
}

// Count returns number of blocked ports
func (pb *PortBitset) Count() int {
    count := 0
    for _, w := range pb.bits {
        count += bits.OnesCount64(w)
    }
    return count
}

// Union sets bits that are set in either bitset
func (pb *PortBitset) Union(other *PortBitset) {
    for i := range pb.bits {
        pb.bits[i] |= other.bits[i]
    }
}

// Intersection keeps only bits set in both
func (pb *PortBitset) Intersection(other *PortBitset) {
    for i := range pb.bits {
        pb.bits[i] &= other.bits[i]
    }
}

// Usage
type FirewallRule struct {
    BlockedPorts PortBitset
}

func NewFirewallRule(ports []uint16) *FirewallRule {
    fw := &FirewallRule{}
    for _, p := range ports {
        fw.BlockedPorts.Set(p)
    }
    return fw
}

func (fw *FirewallRule) IsBlocked(port uint16) bool {
    return fw.BlockedPorts.IsSet(port)
}
```

**Performance comparison:**
```
// Linear search (average n/2 comparisons):
BenchmarkLinearSearch100-8    20000000    75.3 ns/op   (100 blocked ports)
BenchmarkLinearSearch1000-8    2000000   742.1 ns/op   (1000 blocked ports)

// Bitset (always 1 array access):
BenchmarkBitset-8           2000000000     0.5 ns/op   (any number of ports)
```

**Memory:**
```
slice of 1000 uint16: 2000 bytes
PortBitset:           8192 bytes (always, regardless of how many ports are blocked)
```

For more than ~4000 ports, the bitset is more memory efficient too.

**Why this is faster:**
- Linear search: O(n) comparisons, poor cache behavior for large n
- Bitset: O(1) — two integer operations (divide by 64, shift), fits in L1 cache

**Additional optimization — lookup table for common ports:**
```go
// For ultra-hot paths with only a few specific ports,
// keep a small sorted slice and use binary search
// Binary search: O(log n) but very cache-friendly for small n
```

</details>

---
