# Integers — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Metrics & Analytics](#metrics-analytics)
17. [Best Practices](#best-practices)
18. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Common Misconceptions](#common-misconceptions)
21. [Tricky Points](#tricky-points)
22. [Test](#test)
23. [Tricky Questions](#tricky-questions)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment Checklist](#self-assessment-checklist)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction

> **Focus:** "What is it?" and "How to use it?"

Integers are the most fundamental numeric type in Go. An integer is a whole number — no decimal point. Go provides 10 distinct integer types to give you precise control over range and memory usage.

```go
package main

import "fmt"

func main() {
    // Signed integers (positive and negative)
    var age     int    = 25
    var score   int16  = 32000
    var bigID   int64  = 9_876_543_210

    // Unsigned integers (zero and positive only)
    var level   uint8  = 255   // max for uint8
    var port    uint16 = 8080
    var hits    uint64 = 1_000_000_000

    // Special literals
    hex    := 0xFF          // 255
    binary := 0b1010_1010   // 170
    octal  := 0o777         // 511
    big    := 1_000_000     // numeric separator

    fmt.Println(age, score, bigID, level, port, hits)
    fmt.Println(hex, binary, octal, big)
}
```

Integers in Go:
- **Have strict ranges** (e.g., `int8` can only hold -128 to 127)
- **Overflow wraps around** (no panic, just wraps to the other end)
- **Support bitwise operations** (`&`, `|`, `^`, `<<`, `>>`)
- **Require explicit conversion** between different integer types

---

## Prerequisites

- Basic Go variables and `fmt.Println`
- Understanding of what a data type is
- Basic arithmetic (+, -, *, /)

---

## Glossary

| Term | Definition |
|------|-----------|
| Signed integer | Can hold positive, negative, and zero values |
| Unsigned integer | Can hold zero and positive values only |
| Overflow | When a value exceeds the max (wraps to min) or below min (wraps to max) |
| Two's complement | How computers store signed integers in binary |
| Bit | A single binary digit: 0 or 1 |
| Byte | 8 bits; `uint8` in Go |
| Bitwise operator | Operates on individual bits: `&`, `|`, `^`, `<<`, `>>` |
| Modulo | The remainder after division: `7 % 3 = 1` |
| `uintptr` | An unsigned integer large enough to hold a pointer value |

---

## Core Concepts

### 1. Signed Integer Types

| Type | Bits | Min | Max |
|------|------|-----|-----|
| `int8` | 8 | -128 | 127 |
| `int16` | 16 | -32,768 | 32,767 |
| `int32` | 32 | -2,147,483,648 | 2,147,483,647 |
| `int64` | 64 | -9,223,372,036,854,775,808 | 9,223,372,036,854,775,807 |
| `int` | 32 or 64 (platform) | same as int32 or int64 | |

### 2. Unsigned Integer Types

| Type | Bits | Min | Max |
|------|------|-----|-----|
| `uint8` | 8 | 0 | 255 |
| `uint16` | 16 | 0 | 65,535 |
| `uint32` | 32 | 0 | 4,294,967,295 |
| `uint64` | 64 | 0 | 18,446,744,073,709,551,615 |
| `uint` | 32 or 64 (platform) | 0 | |
| `uintptr` | pointer-size | 0 | platform max |

### 3. Integer Literals

```go
decimal  := 42           // base 10
binary   := 0b101010     // base 2 (Go 1.13+)
octal    := 0o52         // base 8 (Go 1.13+, old: 052)
hex      := 0x2A         // base 16
withSep  := 1_000_000    // numeric separator (Go 1.13+)
```

All evaluate to 42.

### 4. Overflow Behavior

```go
var x uint8 = 255
x++
fmt.Println(x) // 0 — wraps to minimum

var y int8 = 127
y++
fmt.Println(y) // -128 — wraps to minimum

var z uint8 = 0
z--
fmt.Println(z) // 255 — wraps to maximum
```

### 5. Arithmetic Operations

```go
a, b := 17, 5

fmt.Println(a + b)   // 22 (addition)
fmt.Println(a - b)   // 12 (subtraction)
fmt.Println(a * b)   // 85 (multiplication)
fmt.Println(a / b)   // 3  (integer division: truncates)
fmt.Println(a % b)   // 2  (modulo: remainder)
```

### 6. Bitwise Operations

```go
a := 0b1010  // 10
b := 0b1100  // 12

fmt.Printf("%04b\n", a&b)  // 1000 = 8  (AND: both bits must be 1)
fmt.Printf("%04b\n", a|b)  // 1110 = 14 (OR: at least one bit is 1)
fmt.Printf("%04b\n", a^b)  // 0110 = 6  (XOR: bits differ)
fmt.Printf("%04b\n", a&^b) // 0010 = 2  (AND NOT: clear bits)
fmt.Println(a << 2)        // 40 (left shift: multiply by 4)
fmt.Println(b >> 1)        // 6  (right shift: divide by 2)
```

---

## Real-World Analogies

**Elevator floor buttons**: A uint8 (0-255) is like elevator floor buttons. The lowest floor is 0 and you can't go below it. If you press one below the lowest floor... it wraps to the top floor (overflow). Signed integers are like a building with a basement (negative floors).

**Car odometer**: An odometer that shows 000000 to 999999. When it hits 999999 and you drive one more mile, it rolls back to 000000. That's integer overflow.

**Binary as light switches**: Binary integers are like rows of light switches. Each switch is either on (1) or off (0). `0b1010` = switches: OFF, ON, OFF, ON.

---

## Mental Models

### Ranges on a Number Line

```
int8:   ←───────────────────────────────────────────────→
       -128                    0                        127

uint8:  ←───────────────────────────────────────────────→
        0                   127                        255
```

### Binary Counting

```
0 = 00000000
1 = 00000001
2 = 00000010
3 = 00000011
...
127 = 01111111  (max positive int8)
128 = 10000000  (this is -128 in int8 due to two's complement!)
```

---

## Pros & Cons

### Pros
- Precise memory control (int8 to int64)
- Fast arithmetic (integer ops are faster than float)
- Exact values (no floating-point imprecision)
- Bitwise operations for flags and masking
- Overflow is defined behavior (wraps, no undefined behavior)

### Cons
- Many types to choose from (can be confusing)
- No implicit conversion (verbose casting)
- Overflow is SILENT (no error or warning)
- Division truncates (7/2=3, not 3.5)
- Negative modulo can be surprising

---

## Use Cases

| Situation | Best Type | Reason |
|-----------|----------|--------|
| Loop counter | `int` | Matches slice/array index type |
| Age | `uint8` | 0-255, never negative |
| Port number | `uint16` | Exactly 0-65535 |
| Database ID | `int64` | Large range, auto-increment |
| Pixel value | `uint8` | 0-255 RGB channel |
| Unix timestamp | `int64` | Nanoseconds since epoch |
| Bit flags | `uint8`-`uint64` | Bitwise operations |
| File size | `int64` | Can be very large |

---

## Code Examples

### Example 1: All Integer Types

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    fmt.Println("Signed integers:")
    fmt.Printf("  int8:  %d to %d\n", math.MinInt8, math.MaxInt8)
    fmt.Printf("  int16: %d to %d\n", math.MinInt16, math.MaxInt16)
    fmt.Printf("  int32: %d to %d\n", math.MinInt32, math.MaxInt32)
    fmt.Printf("  int64: %d to %d\n", math.MinInt64, math.MaxInt64)

    fmt.Println("Unsigned integers:")
    fmt.Printf("  uint8:  0 to %d\n", math.MaxUint8)
    fmt.Printf("  uint16: 0 to %d\n", math.MaxUint16)
    fmt.Printf("  uint32: 0 to %d\n", math.MaxUint32)
    // uint64 max requires special handling
    fmt.Printf("  uint64: 0 to ~1.8 * 10^19\n")
}
```

### Example 2: Integer Literal Formats

```go
package main

import "fmt"

func main() {
    d := 255          // decimal
    b := 0b11111111   // binary
    o := 0o377        // octal
    h := 0xFF         // hexadecimal

    fmt.Println(d, b, o, h) // all print 255

    // Numeric separators (Go 1.13+)
    million := 1_000_000
    ip := 0xC0_A8_01_01 // 192.168.1.1 as uint32
    fmt.Println(million, ip)
}
```

### Example 3: Overflow Visualization

```go
package main

import "fmt"

func main() {
    var u uint8 = 250
    for i := 0; i < 10; i++ {
        fmt.Printf("u = %d\n", u)
        u++
    }
    // Output: 250, 251, 252, 253, 254, 255, 0, 1, 2, 3
}
```

### Example 4: Integer Division and Modulo

```go
package main

import "fmt"

func main() {
    // Division always truncates toward zero
    fmt.Println(7 / 2)    // 3
    fmt.Println(-7 / 2)   // -3 (not -4!)
    fmt.Println(7 / -2)   // -3
    fmt.Println(-7 / -2)  // 3

    // Modulo: sign follows dividend
    fmt.Println(7 % 3)    // 1
    fmt.Println(-7 % 3)   // -1 (sign of dividend -7)
    fmt.Println(7 % -3)   // 1  (sign of dividend 7)
    fmt.Println(-7 % -3)  // -1
}
```

### Example 5: Bitwise Operations

```go
package main

import "fmt"

func main() {
    // Flags using bits
    const (
        FlagRead    = 1 << 0 // 1   = 0b001
        FlagWrite   = 1 << 1 // 2   = 0b010
        FlagExecute = 1 << 2 // 4   = 0b100
    )

    // Set multiple flags
    perms := FlagRead | FlagWrite // 3 = 0b011

    // Check a flag
    if perms&FlagRead != 0 {
        fmt.Println("Can read")
    }
    if perms&FlagExecute == 0 {
        fmt.Println("Cannot execute")
    }

    // Clear a flag
    perms &^= FlagWrite
    fmt.Printf("After clearing write: %03b\n", perms) // 001
}
```

### Example 6: Converting Between Integer Types

```go
package main

import "fmt"

func main() {
    var small int8 = 100
    var big int64 = int64(small) // explicit widening conversion
    fmt.Println(big) // 100

    var large int64 = 1000
    var tiny int8 = int8(large) // narrowing: 1000 doesn't fit in int8!
    fmt.Println(tiny)           // -24 (1000 mod 256 = 232 - 256 = -24 in two's complement)

    // Safe conversion check
    if large >= -128 && large <= 127 {
        safe := int8(large)
        fmt.Println("Safe:", safe)
    } else {
        fmt.Println("Value doesn't fit in int8")
    }
}
```

### Example 7: Numeric Separators and Large Numbers

```go
package main

import "fmt"

const (
    OneKB = 1_024
    OneMB = 1_048_576
    OneGB = 1_073_741_824
    OneTB = int64(1_099_511_627_776)
)

func main() {
    fileSize := int64(2_500_000_000) // 2.5 GB in bytes
    fmt.Printf("File size: %d bytes\n", fileSize)
    fmt.Printf("In GB: %.2f\n", float64(fileSize)/OneGB)
    fmt.Printf("In TB: %.4f\n", float64(fileSize)/float64(OneTB))
}
```

---

## Coding Patterns

### Pattern 1: Loop Counter with `int`

```go
// Use int for loop counters — matches len() return type
for i := 0; i < len(items); i++ {
    fmt.Println(items[i])
}
// Or idiomatic range:
for i, item := range items {
    fmt.Printf("[%d] %s\n", i, item)
}
```

### Pattern 2: Bit Flag Set

```go
type Permission uint8
const (
    PermRead    Permission = 1 << iota // 1
    PermWrite                           // 2
    PermExecute                         // 4
)

func (p Permission) Has(flag Permission) bool { return p&flag != 0 }
func (p *Permission) Set(flag Permission)     { *p |= flag }
func (p *Permission) Clear(flag Permission)   { *p &^= flag }
```

### Pattern 3: Safe Absolute Value

```go
func abs(x int) int {
    if x < 0 { return -x }
    return x
}
// Note: math.Abs works only on float64
// For int64 absolute value, use this pattern
```

---

## Clean Code

```go
// Good: meaningful names and correct types
type PacketHeader struct {
    SourcePort uint16 // 0-65535
    DestPort   uint16
    TTL        uint8  // time-to-live: 0-255
    Checksum   uint32 // 32-bit checksum
    Length     uint16 // payload length in bytes
}

// Bad: wrong types and unclear names
type PacketHeaderBad struct {
    src  int  // can be negative (invalid for port)
    dst  int
    t    int  // what does t mean?
    c    int
    l    int
}
```

---

## Product Use / Feature

**Unix file permissions** (classic use of integer bits):

```go
// Linux file permissions: 3 groups of 3 bits
// r=4, w=2, x=1
// 0644 = owner:rw-, group:r--, other:r--
const fileMode = 0o644

owner := (fileMode >> 6) & 0x7 // 6 (110 = rw-)
group := (fileMode >> 3) & 0x7 // 4 (100 = r--)
other := fileMode & 0x7        // 4 (100 = r--)
fmt.Printf("Owner: %d, Group: %d, Other: %d\n", owner, group, other)
```

---

## Error Handling

```go
package main

import (
    "fmt"
    "strconv"
)

func parseUint8(s string) (uint8, error) {
    n, err := strconv.ParseUint(s, 10, 8) // bitSize=8: validates 0-255
    if err != nil {
        return 0, fmt.Errorf("invalid uint8 value %q: %w", s, err)
    }
    return uint8(n), nil
}

func parseInt64(s string) (int64, error) {
    n, err := strconv.ParseInt(s, 10, 64)
    if err != nil {
        return 0, fmt.Errorf("invalid int64 value %q: %w", s, err)
    }
    return n, nil
}

func main() {
    v, err := parseUint8("200")
    fmt.Println(v, err)      // 200 <nil>

    _, err = parseUint8("300")
    fmt.Println(err)          // invalid uint8 value "300": value out of range
}
```

---

## Security Considerations

```go
// Integer overflow in size calculation — DANGEROUS
func allocate(userLen int32, headerSize int32) []byte {
    totalSize := userLen + headerSize // May overflow int32!
    return make([]byte, totalSize)
}

// SAFER: validate inputs first
func allocateSafe(userLen int32, headerSize int32) ([]byte, error) {
    const maxSize = 1 << 20 // 1MB
    if userLen < 0 || headerSize < 0 {
        return nil, fmt.Errorf("negative size")
    }
    total := int64(userLen) + int64(headerSize) // use int64 to prevent overflow
    if total > maxSize {
        return nil, fmt.Errorf("allocation too large: %d", total)
    }
    return make([]byte, total), nil
}
```

---

## Performance Tips

- **Use `int`** for loop counters — matches CPU word size
- **Integer ops are faster than float ops** on most hardware
- **Division is slow**: if dividing by a constant power of 2, use shift (`/4` → `>>2`)
- **Modulo by power of 2**: `x % 8` → `x & 7` (faster for powers of 2)
- **Avoid unnecessary conversions** in hot loops

---

## Metrics & Analytics

```go
type CounterStats struct {
    Total   int64  // total events (can be large)
    Success int64  // successful events
    Failed  int64  // failed events
    Min     int32  // min value observed (bounded)
    Max     int32  // max value observed
    P50     int32  // 50th percentile (ms latency)
    P99     int32  // 99th percentile (ms latency)
}
```

---

## Best Practices

1. **Use `int`** for general integers unless you have a specific reason
2. **Use `int64`** for database IDs, timestamps, large counts
3. **Use `uint8`** for byte values, pixel channels, age fields
4. **Use `uint16`** for port numbers
5. **Never use `int` for cross-platform protocol values** — use `int32`/`int64`
6. **Always check range** when doing narrowing conversions
7. **Use numeric separators** (`1_000_000`) for readability
8. **Know your overflow**: always mentally check if a calculation can overflow

---

## Edge Cases & Pitfalls

### Pitfall 1: Negative Modulo

```go
result := -7 % 3
fmt.Println(result) // -1 (not 2!)
// Go: sign of result = sign of dividend

// True modulo (always positive):
func trueMod(a, b int) int {
    return ((a % b) + b) % b
}
fmt.Println(trueMod(-7, 3)) // 2
```

### Pitfall 2: Integer Division

```go
fmt.Println(7 / 2)          // 3 (truncates, not rounds)
fmt.Println(float64(7) / 2) // 3.5 (correct for float)
```

### Pitfall 3: Comparison Between uint and int

```go
var a int = -1
var b uint = 1
// if a < b { ... }  // COMPILE ERROR: mismatched types int and uint
if a < 0 || uint(a) < b { // correct: check sign first
    fmt.Println("a is less than b")
}
```

---

## Common Mistakes

### 1. Using int for Port Numbers

```go
// Bad: port can be negative
var port int = -80 // invalid, but compiles

// Good: uint16 enforces the correct range
var port uint16 = 80
```

### 2. Integer Division Expecting Float Result

```go
total := 100
count := 3
avg := total / count // 33, not 33.33!

// Fix:
avgFloat := float64(total) / float64(count) // 33.333...
```

### 3. Ignoring Overflow in Loops

```go
var counter uint8 = 0
for counter <= 200 { // loop seems safe
    counter++
    // But at 255: counter++ wraps to 0, then 0 <= 200 is true...
    // Infinite loop!
}
```

---

## Common Misconceptions

**"Overflow causes a panic"** — No. Integer overflow in Go silently wraps around. Use `math/bits` to detect it.

**"int is always 64-bit"** — No. `int` is 32-bit on 32-bit platforms. Use `int64` for guaranteed 64-bit range.

**"`-7 % 3` equals `2`"** — No. In Go, `-7 % 3 = -1`. The result has the same sign as the dividend.

**"Integer division rounds"** — No. It truncates toward zero. `7/2 = 3`, `-7/2 = -3`.

---

## Tricky Points

### Shift Operators

```go
x := 1
fmt.Println(x << 0)  // 1   (1 * 2^0)
fmt.Println(x << 1)  // 2   (1 * 2^1)
fmt.Println(x << 10) // 1024 (1 * 2^10)

// Arithmetic right shift for signed: fills with sign bit
var y int8 = -8
fmt.Println(y >> 1) // -4 (arithmetic shift: sign bit preserved)

// Logical right shift for unsigned: fills with zeros
var z uint8 = 0b10001000
fmt.Println(z >> 1) // 0b01000100 = 68
```

### AND NOT (`&^`) — Bit Clear

```go
flags := 0b1111  // all bits set
mask  := 0b0110  // bits to clear

result := flags &^ mask // 0b1001 = 9
fmt.Printf("%04b\n", result)
```

---

## Test

```go
package main

import (
    "math"
    "testing"
)

func TestOverflowUint8(t *testing.T) {
    var x uint8 = math.MaxUint8
    x++
    if x != 0 {
        t.Errorf("Expected 0, got %d", x)
    }
}

func TestNegativeModulo(t *testing.T) {
    result := -7 % 3
    if result != -1 {
        t.Errorf("Expected -1, got %d", result)
    }
}

func TestIntegerDivision(t *testing.T) {
    if 7/2 != 3 {
        t.Errorf("Expected 3, got %d", 7/2)
    }
    if -7/2 != -3 {
        t.Errorf("Expected -3, got %d", -7/2)
    }
}

func TestBitwiseAND(t *testing.T) {
    a := 0b1010
    b := 0b1100
    if a&b != 0b1000 {
        t.Errorf("Expected 8, got %d", a&b)
    }
}
```

---

## Tricky Questions

**Q1: What is `int8(200)`?**
A: `-56`. `200` in binary is `11001000`. As int8, the high bit is the sign bit: it's negative. `200 - 256 = -56`.

**Q2: What is `uint8(0) - 1`?**
A: `255`. Unsigned underflow wraps to the maximum value.

**Q3: What is `-7 % 3` in Go?**
A: `-1`. In Go, the result of `%` has the same sign as the dividend (`-7`).

**Q4: What is `7/2` in Go?**
A: `3`. Integer division truncates toward zero.

**Q5: What type should you use for a loop counter?**
A: `int`. It matches the return type of `len()` and the natural word size.

**Q6: What is `0b1010 & 0b1100`?**
A: `0b1000 = 8`. AND keeps bits where BOTH are 1.

---

## Cheat Sheet

```
SIGNED INTEGERS:
  int8   8-bit  -128 to 127
  int16  16-bit -32768 to 32767
  int32  32-bit -2.1B to 2.1B
  int64  64-bit ±9.2 quintillion
  int    platform: 32 or 64 bit

UNSIGNED INTEGERS:
  uint8   8-bit  0 to 255        ← byte
  uint16  16-bit 0 to 65535      ← port numbers
  uint32  32-bit 0 to 4.3B
  uint64  64-bit 0 to 18.4Q
  uint    platform: 32 or 64 bit

INTEGER LITERALS:
  42         decimal
  0b101010   binary (Go 1.13+)
  0o52       octal  (Go 1.13+)
  0x2A       hexadecimal
  1_000_000  with separators

ARITHMETIC:
  +  addition         7+2=9
  -  subtraction      7-2=5
  *  multiplication   7*2=14
  /  division (truncates toward 0)  7/2=3
  %  modulo (sign=dividend sign)   -7%3=-1

BITWISE:
  &   AND:   1010 & 1100 = 1000
  |   OR:    1010 | 1100 = 1110
  ^   XOR:   1010 ^ 1100 = 0110
  &^  ANDNOT: 1111 &^ 0110 = 1001
  <<  left shift:  1 << 3 = 8
  >>  right shift: 8 >> 1 = 4

OVERFLOW: wraps silently
  uint8(255) + 1 = 0
  int8(127) + 1 = -128

CONVERSION: always explicit
  int64(myInt32)  widening (safe)
  int8(myInt64)   narrowing (may lose data)
```

---

## Self-Assessment Checklist

- [ ] I know all 10 integer types (int8 to int64, uint8 to uint64)
- [ ] I understand integer overflow (wraps around, no panic)
- [ ] I can write integer literals in decimal, binary, octal, and hex
- [ ] I understand integer division truncates toward zero
- [ ] I understand negative modulo in Go
- [ ] I can use bitwise operators (&, |, ^, &^, <<, >>)
- [ ] I know when to use int vs int64
- [ ] I can convert between integer types explicitly

---

## Summary

Go's integer types provide precise control over range and memory:
- **Signed**: int8, int16, int32, int64, int (platform)
- **Unsigned**: uint8, uint16, uint32, uint64, uint (platform), uintptr
- **Literals**: decimal, 0b binary, 0o octal, 0x hex, with `_` separators
- **Overflow**: wraps around silently (no panic)
- **Division**: truncates toward zero
- **Modulo**: result sign matches dividend
- **Bitwise ops**: `&`, `|`, `^`, `&^`, `<<`, `>>`

Choose the smallest type that fits your range. Use `int` for general purpose, `int64` for large values and IDs.

---

## What You Can Build

- **Permission system**: `uint8` flags for read/write/execute
- **Pixel processor**: `uint8` for RGB color channels (0-255)
- **Network port scanner**: `uint16` for port numbers
- **Counter system**: `int64` for large event counts
- **Binary file parser**: read integers in different formats (big/little endian)
- **IPv4 address handler**: `uint32` for 4-byte IP address storage

---

## Further Reading

- [Go Spec: Integer types](https://go.dev/ref/spec#Numeric_types)
- [Go Spec: Arithmetic operators](https://go.dev/ref/spec#Arithmetic_operators)
- [math/bits package](https://pkg.go.dev/math/bits)
- [strconv package](https://pkg.go.dev/strconv)

---

## Related Topics

- **Bitwise Operations** — detailed patterns for bit manipulation
- **Type Conversion** — converting between numeric types
- **math/bits** — overflow detection, bit counting
- **encoding/binary** — reading/writing integers from byte streams
- **strconv** — parsing strings to integers

---

## Diagrams & Visual Aids

### Two's Complement (int8)

```
Bit pattern  Unsigned value  Signed value (int8)
00000000     0               0
00000001     1               1
01111111     127             127  (max positive)
10000000     128            -128  (min negative)
11111111     255            -1
```

### Overflow Circle

```
int8 value "circle":
     0
   /   \
-128    127
   \   /
    wrap!
```

### Bit Operations

```
AND (&): keeps 1s where BOTH are 1
1010
1100
----
1000

OR (|): keeps 1s where EITHER is 1
1010
1100
----
1110

XOR (^): keeps 1s where bits DIFFER
1010
1100
----
0110

AND NOT (&^): clear bits from left that are set in right
1111
0110
----
1001
```
