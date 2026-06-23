# Integers — Middle Level

## Table of Contents
1-35 (all standard sections + Evolution, Alternative Approaches, Anti-Patterns, Debugging Guide, Comparison)

---

## Introduction

> **Focus:** "Why?" and "When to use?"

At the middle level, integer mastery is about understanding **why** certain integer types exist, **when** to choose one over another, and how Go's integer system affects correctness, API design, and portability.

Key questions at this level:
- When does `int` vs `int64` actually matter?
- How do bitwise operations enable efficient flag systems?
- What are the portability implications of using platform-dependent types?
- How do negative modulo and division truncation affect algorithms?

```go
package main

import (
    "fmt"
    "math/bits"
)

// Why this specific type for each field?
type NetworkPacket struct {
    SourcePort uint16 // Port: 0-65535 (uint16 is the exact range)
    DestPort   uint16
    TTL        uint8  // Time-to-live: 0-255 (uint8 is ideal)
    Version    uint8  // IP version: 4 or 6 (fits in 4 bits, uint8 is smallest)
    Sequence   uint32 // Sequence: 0-4B (uint32 for 32-bit sequence space)
    Checksum   uint16 // 16-bit Internet checksum
    Length     uint16 // Payload length: 0-65535 bytes
}

func main() {
    pkt := NetworkPacket{SourcePort: 54321, DestPort: 80, TTL: 64}
    fmt.Printf("Packet: %+v\n", pkt)

    // Detect overflow before it happens
    var counter uint32 = 4_294_967_290
    if 4_294_967_295-counter < 10 {
        fmt.Printf("Counter %d near overflow!\n", counter)
    }

    // Count bits set (population count)
    fmt.Println(bits.OnesCount64(0b10101010)) // 4
}
```

---

## Core Concepts

### 1. Two's Complement Deep Dive

```go
// Why -128 to 127 for int8?
// 8 bits: 256 possible values
// Split: 128 negative + 1 zero + 127 positive = 256
//
// Bit pattern:
// 01111111 = +127 (max positive)
// 10000000 = -128 (min negative — one more negative than positive)
// 11111111 = -1
//
// Why no overflow panic? Because two's complement addition just wraps:
// 127 + 1 = 01111111 + 00000001 = 10000000 = -128

// The magic: same circuit for signed and unsigned addition
var a int8 = 127
var b int8 = 1
c := a + b // -128: wraps exactly as two's complement dictates
fmt.Println(c)
```

### 2. When int vs int64 Actually Matters

```go
// Case 1: Slice indices — always use int (len returns int)
slice := make([]string, 1000)
for i := 0; i < len(slice); i++ { // i is int, len() is int — compatible
    _ = slice[i]
}

// Case 2: Cross-platform protocol — use int32/int64 explicitly
type ProtocolMessage struct {
    Version  int32 // must be same size on all platforms
    Sequence int64
}

// Case 3: Database IDs — always int64
type User struct {
    ID int64 // never int: on 32-bit, int max is ~2.1B
}

// Case 4: Platform-specific computation — int is fine
func countPositive(nums []int) int { // both input and output: int is fine
    count := 0
    for _, n := range nums {
        if n > 0 { count++ }
    }
    return count
}
```

### 3. Integer Shift Operators in Depth

```go
// Left shift: multiply by 2^n
x := 1
fmt.Println(x << 1)   // 2
fmt.Println(x << 10)  // 1024
fmt.Println(x << 30)  // 1073741824 (2^30)

// Right shift:
// Unsigned (uint): logical shift — fills with 0
var u uint8 = 0b10000001 // 129
fmt.Printf("%08b\n", u >> 1) // 01000000 = 64

// Signed (int): arithmetic shift — fills with sign bit
var s int8 = -8 // 0b11111000
fmt.Println(s >> 1)  // -4: preserves sign!
fmt.Println(s >> 2)  // -2

// This is how / 2 works for negative numbers:
// -8 >> 1 == -8 / 2 == -4 (for negative powers of 2)
```

### 4. Bit Manipulation Patterns

```go
// Check if nth bit is set
func isBitSet(x uint64, n uint) bool {
    return x&(1<<n) != 0
}

// Set nth bit
func setBit(x uint64, n uint) uint64 {
    return x | (1 << n)
}

// Clear nth bit
func clearBit(x uint64, n uint) uint64 {
    return x &^ (1 << n)
}

// Toggle nth bit
func toggleBit(x uint64, n uint) uint64 {
    return x ^ (1 << n)
}

// Count bits set (population count)
import "math/bits"
func popcount(x uint64) int {
    return bits.OnesCount64(x)
}

// Find lowest set bit
func lowestSetBit(x uint64) uint64 {
    return x & (-x) // two's complement trick
}

// Is power of 2?
func isPowerOf2(x uint64) bool {
    return x != 0 && x&(x-1) == 0
}
```

### 5. The iota Pattern with Integer Types

```go
type Weekday int

const (
    Sunday Weekday = iota // 0
    Monday               // 1
    Tuesday              // 2
    Wednesday            // 3
    Thursday             // 4
    Friday               // 5
    Saturday             // 6
)

func (d Weekday) String() string {
    return [...]string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}[d]
}

// Bit-shifted iota for flags
type Permission uint8
const (
    PermRead    Permission = 1 << iota // 1 = 0b001
    PermWrite                           // 2 = 0b010
    PermExecute                         // 4 = 0b100
)
```

---

## Real-World Analogies

**Odometer reset**: The classic overflow scenario. When it hits 999999, the next mile shows 000000. This is exactly how `uint32` overflow works — predictable, defined, wraps to zero.

**The "wrong" modulo**: In mathematics, `-7 mod 3 = 2` (always positive). In Go (and C), `-7 % 3 = -1` (sign of dividend). This is "truncated division modulo" vs "Euclidean modulo." Understanding which you need is critical for hash functions and circular buffers.

---

## Code Examples

### Example 1: math/bits for Overflow Detection

```go
package main

import (
    "fmt"
    "math/bits"
)

func safeMulUint64(a, b uint64) (uint64, bool) {
    hi, lo := bits.Mul64(a, b)
    return lo, hi != 0 // overflow if high 64 bits are non-zero
}

func safeAddUint64(a, b uint64) (uint64, bool) {
    result, carry := bits.Add64(a, b, 0)
    return result, carry != 0 // overflow if carry is non-zero
}

func main() {
    r, ok := safeMulUint64(1_000_000_000, 1_000_000_000) // 1e18 = fine
    fmt.Printf("1B * 1B = %d, overflow: %v\n", r, !ok)

    r2, ok2 := safeMulUint64(1_000_000_000_000_000_000, 20) // overflow
    fmt.Printf("1e18 * 20 = %d, overflow: %v\n", r2, !ok2)
}
```

### Example 2: Euclidean Modulo (Always Positive)

```go
package main

import "fmt"

// Go's % can return negative values for negative dividends
// True Euclidean mod is always non-negative
func mod(a, b int) int {
    return ((a % b) + b) % b
}

func main() {
    // Go % :
    fmt.Println(-7 % 3)  // -1

    // Euclidean mod:
    fmt.Println(mod(-7, 3))  // 2

    // Use case: circular buffer index
    size := 10
    current := -3
    index := mod(current, size)
    fmt.Println("Buffer index:", index) // 7
}
```

### Example 3: Portable vs Platform-Dependent Code

```go
package main

import (
    "encoding/binary"
    "fmt"
)

// WRONG: uses int (platform-dependent)
type MessageBad struct {
    Length int  // 4 bytes on 32-bit, 8 bytes on 64-bit!
    Type   int
}

// RIGHT: explicit sizes for wire format
type Message struct {
    Length uint32  // always 4 bytes
    Type   uint16  // always 2 bytes
}

func (m Message) Marshal() []byte {
    b := make([]byte, 6) // 4 + 2
    binary.BigEndian.PutUint32(b[:4], m.Length)
    binary.BigEndian.PutUint16(b[4:], m.Type)
    return b
}

func main() {
    msg := Message{Length: 100, Type: 1}
    b := msg.Marshal()
    fmt.Printf("% x\n", b) // 00 00 00 64 00 01
}
```

### Example 4: Bitset Using uint64

```go
package main

import (
    "fmt"
    "math/bits"
)

type Bitset [4]uint64 // 256 bits

func (b *Bitset) Set(i uint) {
    b[i/64] |= 1 << (i % 64)
}

func (b *Bitset) Clear(i uint) {
    b[i/64] &^= 1 << (i % 64)
}

func (b *Bitset) Get(i uint) bool {
    return b[i/64]&(1<<(i%64)) != 0
}

func (b *Bitset) Count() int {
    count := 0
    for _, word := range b {
        count += bits.OnesCount64(word)
    }
    return count
}

func main() {
    var bs Bitset
    bs.Set(0)
    bs.Set(100)
    bs.Set(200)
    fmt.Println("Count:", bs.Count()) // 3
    fmt.Println("Bit 100:", bs.Get(100)) // true
    fmt.Println("Bit 150:", bs.Get(150)) // false
}
```

---

## Tricky Points

### Signed vs Unsigned Bit Shift

```go
// Signed right shift: arithmetic (sign-extends)
var s int8 = -8  // 0b11111000
fmt.Println(s >> 1) // -4 (fills with 1s to preserve sign)

// Unsigned right shift: logical (fills with 0s)
var u uint8 = 128 // 0b10000000
fmt.Println(u >> 1) // 64 (fills with 0s)
```

### Constants and Integer Overflow

```go
const x = 1 << 100  // OK as untyped constant (arbitrary precision at compile time)
// var y int = 1 << 100  // COMPILE ERROR: overflows int

// But constants can be used in typed contexts if they fit:
const small = 127
var a int8 = small  // OK: 127 fits in int8
```

### Iota with Bit Shifts

```go
type ByteSize uint64

const (
    _           = iota // skip 0
    KB ByteSize = 1 << (10 * iota) // 1 << 10 = 1024
    MB                              // 1 << 20 = 1048576
    GB                              // 1 << 30
    TB                              // 1 << 40
)

fmt.Println(KB, MB, GB, TB) // 1024 1048576 1073741824 1099511627776
```

---

## Common Mistakes

### 1. Using int for Large IDs

```go
// Will fail on 32-bit systems if ID > 2.1B:
type Record struct { ID int }

// Fix: use int64
type Record struct { ID int64 }
```

### 2. Infinite Loop with uint Loop Counter

```go
var i uint = 10
for ; i >= 0; i-- {  // BUG: uint is ALWAYS >= 0, infinite loop!
    fmt.Println(i)
}

// Fix: use signed int, or add explicit break
for i := 10; i >= 0; i-- {  // signed: can reach -1, loop exits
    fmt.Println(i)
}
```

### 3. Misusing Signed Shift for Negative Powers

```go
// Right shift of negative integers depends on implementation in C
// In Go, it's defined: arithmetic (sign-extending) shift
var x int8 = -8
fmt.Println(x >> 1)  // -4 (defined behavior in Go)
// But for mathematical division, use / not >>
// Because >> rounds toward negative infinity, / rounds toward zero:
fmt.Println(-7 >> 1)  // -4 (>> rounds down: -7/2 = -3.5 → -4)
fmt.Println(-7 / 2)   // -3 (/ truncates toward zero: -3.5 → -3)
```

---

## Anti-Patterns

1. **Using `int` for protocol wire formats** — size depends on platform
2. **Infinite loops with `uint` counters** — uint is always >= 0
3. **Using `>>` for division of negative numbers** — rounds differently than `/`
4. **Large untyped constants assuming `int`** — `1 << 40` compiles as constant but may not fit in `int`
5. **Comparing `int` and `uint`** — requires explicit conversion, easy to get wrong

---

## Alternative Approaches

| Problem | Common Approach | Better Approach |
|---------|----------------|-----------------|
| Many bool flags | Multiple bool fields | uint64 bitmask |
| Circular buffer | Modulo with signed | `mod(i, size)` with Euclidean |
| Enum values | Multiple `const` ints | `type MyEnum int` + iota |
| Cross-platform size | `int` | `int32` or `int64` explicitly |
| Safe overflow | No check | `math/bits.Add64/Mul64` |

---

## Comparison with Other Languages

| Feature | Go | Java | Python | C/C++ |
|---------|----|----|--------|-------|
| Unsigned integers | Yes | No (`byte` only) | No | Yes |
| Overflow behavior | Wraps | Wraps | Grows to BigInt | Undefined (signed) / Wraps (unsigned) |
| Negative modulo | Dividend sign | Dividend sign | Euclidean | Dividend sign |
| Int size | Platform | Always 32-bit | Arbitrary | Platform |
| Literal prefixes | 0b, 0o, 0x | 0b, 0x | 0b, 0o, 0x | 0, 0x |

---

## Debugging Guide

**Problem: Loop terminates incorrectly**
```go
for i := uint(10); i >= 0; i-- {  // INFINITE LOOP
// Debug: print i and condition
fmt.Println(i, i >= 0) // always true!
// Fix: use signed int
```

**Problem: Wrong result from negative modulo**
```go
index := -1 % 10 // -1, not 9
// Expect circular buffer index
// Debug: print the result
// Fix: use Euclidean mod: ((x % n) + n) % n
```

**Problem: Overflow in arithmetic**
```go
result := int32(2_000_000_000) * 2 // -294967296 — overflow!
// Debug: use math/bits or check MaxInt32
// Fix: use int64 for intermediate calculation
```
