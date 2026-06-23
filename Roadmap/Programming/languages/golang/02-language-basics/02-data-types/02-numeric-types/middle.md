# Numeric Types (Overview) — Middle Level

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
31. [Evolution & Historical Context](#evolution-historical-context)
32. [Alternative Approaches](#alternative-approaches)
33. [Anti-Patterns](#anti-patterns)
34. [Debugging Guide](#debugging-guide)
35. [Comparison with Other Languages](#comparison-with-other-languages)

---

## Introduction

> **Focus:** "Why?" and "When to use?"

At the middle level, understanding numeric types is about making architectural decisions that will affect correctness, performance, and maintainability at scale. The question shifts from "what type is this?" to "why this type and not another?"

Go's numeric type system reflects a core philosophy: **be explicit, be safe, be efficient**. Each design choice — no implicit conversion, wrapping overflow, no unsigned arithmetic tricks — has a rationale that middle-level developers should internalize.

```go
package main

import (
    "fmt"
    "math"
    "time"
)

// Why these specific types? Each choice has a reason.
type TransactionRecord struct {
    ID        int64     // int64: database auto-increment can exceed int32 max
    Amount    int64     // int64 cents: no float imprecision, no overflow risk for real money
    Timestamp int64     // int64: Unix nanoseconds since epoch
    UserID    int64     // int64: foreign key consistency with ID
    TaxRate   float64   // float64: percentage with decimal precision
    Retries   uint8     // uint8: retry count 0-255, never negative
}

func main() {
    tx := TransactionRecord{
        ID:        123456789012,
        Amount:    1999,   // $19.99 in cents
        Timestamp: time.Now().UnixNano(),
        UserID:    42,
        TaxRate:   8.75,
        Retries:   0,
    }
    fmt.Printf("Transaction $%.2f at %s\n",
        float64(tx.Amount)/100,
        time.Unix(0, tx.Timestamp).Format(time.RFC3339))
}
```

---

## Prerequisites

- Junior-level numeric type knowledge
- Go structs, interfaces, methods
- Error handling patterns
- Basic understanding of memory layout

---

## Glossary

| Term | Definition |
|------|-----------|
| IEEE 754 | The floating-point standard defining how float32/float64 work |
| Epsilon | A small tolerance value used in floating-point comparisons |
| Saturation | An overflow behavior that clamps to min/max instead of wrapping (Go does NOT do this) |
| Type alias | A new name for an existing type (`byte = uint8`) |
| Defined type | A new type based on existing one (`type MyInt int`) — NOT an alias |
| Widening conversion | Converting to a type with larger range (safe) |
| Narrowing conversion | Converting to a type with smaller range (may lose data) |
| Two's complement | The binary representation used for signed integers |
| Machine word | The natural data size for a CPU (32 or 64 bits) |
| Numeric literal | A constant value written directly in code: `42`, `3.14`, `0xFF` |

---

## Core Concepts

### 1. Why No Implicit Conversion?

In C: `int a = 5; long b = a + 1000000000000LL;` — works but silently promotes.
In Python: `5 + 5.0 = 10.0` — silently promotes int to float.
In Go: explicit only.

**Rationale**: Silent promotions hide bugs. Consider:
```go
// C bug (silent promotion):
// int pixels = image.width * image.height;  // overflows if both > 46340

// Go prevents this at compile time:
var width int32 = 50000
var height int32 = 50000
// area := width * height  // compiles, but overflows int32!
area := int64(width) * int64(height) // explicit: 2,500,000,000
fmt.Println(area)
```

### 2. When `int` is 32-bit vs 64-bit

The key insight: `int` matches the **native word size** of the platform. On modern desktops/servers (64-bit), `int` is 64 bits. On embedded systems or old hardware (32-bit), `int` is 32 bits.

```go
import (
    "fmt"
    "unsafe"
    "strconv"
)

func main() {
    // Runtime detection
    intSize := int(unsafe.Sizeof(int(0))) * 8
    fmt.Printf("int is %d bits on this platform\n", intSize)

    // Compile-time: strconv.IntSize
    fmt.Println("IntSize:", strconv.IntSize) // 64 on 64-bit
}
```

**Practical implication**: If you write cross-platform code (including WASM or ARM embedded), use `int32`/`int64` explicitly for cross-platform correctness.

### 3. Float Internals: IEEE 754

```
float64 bit layout:
┌─────┬─────────────┬──────────────────────────────────────────────────────┐
│sign │  exponent   │                    mantissa                          │
│ 1   │   11 bits   │                    52 bits                           │
└─────┴─────────────┴──────────────────────────────────────────────────────┘

Value = (-1)^sign × 2^(exponent-1023) × (1 + mantissa/2^52)
```

This is why `0.1` can't be represented exactly: it's `0.000110011...` in binary (repeating).

```go
import "fmt"

func main() {
    // Exact: powers of 2
    fmt.Println(0.25 + 0.25) // 0.5 (exact)
    fmt.Println(0.5 + 0.5)   // 1.0 (exact)

    // Inexact: not a power of 2
    fmt.Println(0.1 + 0.2)                // 0.30000000000000004
    fmt.Printf("%.20f\n", 0.1)            // 0.10000000000000000555...
}
```

### 4. The Money Problem — A Deep Dive

```go
// Why you CANNOT use float64 for money:
price := 0.1 + 0.1 + 0.1 // should be 0.3
fmt.Println(price == 0.3)  // false
fmt.Println(price)         // 0.30000000000000004

// Scale of the problem in production:
// $100.00 stored as float64: 100.0 (exact, power of 2 * 25)
// $0.10 stored as float64: 0.10000000000000000555... (inexact)
// After 1000 transactions of $0.10: should be $100.00
total := 0.0
for i := 0; i < 1000; i++ {
    total += 0.10
}
fmt.Printf("Expected: $100.00, Got: $%.6f\n", total) // $99.999999999...

// Solution: use int64 cents
cents := int64(0)
for i := 0; i < 1000; i++ {
    cents += 10 // 10 cents
}
fmt.Printf("Expected: $100.00, Got: $%.2f\n", float64(cents)/100) // $100.00
```

---

## Real-World Analogies

**The Tax Office**: The tax system works in cents (integers), not dollars (floats). $1.005 tax rounds to $1.00 or $1.01 — you need exact integers to avoid accumulating rounding errors across millions of transactions.

**Engineering Tolerances**: A mechanical engineer says "this shaft is 10.000 ± 0.001 mm." The tolerance (epsilon) is explicit. Floating-point comparison must work the same way: never compare exactly, always use a tolerance.

**Platform-Specific Boot Size**: `int` is like shoe size — it means different things in different regions (US=32-bit, EU=64-bit). If you need a specific size internationally, use `int32` or `int64`.

---

## Mental Models

### Why These Default Choices?

```
When someone writes '42' without a type, Go picks int.
WHY? Because 'int' is the machine's natural word size.
     Operations on native-sized ints are often 1 instruction.
     Slice indices, loop counters, pointer arithmetic — all int.

When someone writes '3.14' without a type, Go picks float64.
WHY? Because float64 (double precision) is the scientific standard.
     float32 loses precision for common operations.
     float64 is equally fast on modern CPUs.

When someone writes '1+2i', Go picks complex128.
WHY? Because real+imag, each float64, is the mathematically precise default.
```

### The Conversion Safety Matrix

```
Conversion Safety:
  ALWAYS SAFE (wider type, same sign):
    int8  → int16 → int32 → int64
    uint8 → uint16 → uint32 → uint64
    float32 → float64

  CONDITIONALLY SAFE (check for loss):
    int64 → int32: loses value if > MaxInt32
    float64 → float32: loses precision
    int64 → float64: loses precision for large integers (>2^53)

  ALWAYS RISKY:
    signed → unsigned: negative values become large positives
    float → int: decimal part truncated, large values overflow
```

---

## Pros & Cons

### Pros of Go's Numeric System
- Overflow is defined (wraps) — no undefined behavior exploits like C
- No implicit conversion — bugs caught at compile time
- Rich type set — right tool for every job
- `math.MaxInt` (Go 1.17+) for platform-independent max int

### Cons
- Verbose for arithmetic involving mixed types
- No operator overloading — can't define `MyMoney + MyMoney`
- No built-in `BigInt` — use `math/big` for arbitrary precision
- No decimal type — use external libraries for exact decimal

---

## Use Cases

### When to Use Each Type at Scale

| Scenario | Type Choice | Reason |
|----------|------------|--------|
| HTTP response status code | `int` | Always small, standard |
| Unix timestamp (nanoseconds) | `int64` | Needs 64-bit range |
| Latitude/longitude | `float64` | Needs 15+ digits precision |
| Image pixel | `uint8` | 0-255, per-channel |
| Network checksum | `uint32` / `uint64` | Non-negative, fixed size |
| Money (cents) | `int64` | No float imprecision |
| Percentages | `float64` | Decimal, precision matters |
| Enum value | `int` / custom int type | Small integer range |
| UUID (16 bytes) | `[2]uint64` or `[16]byte` | Fixed size binary |

---

## Code Examples

### Example 1: Platform-Independent Code

```go
package main

import (
    "fmt"
    "strconv"
)

// BAD: uses int, which varies by platform
func countItemsBad(items []string) int {
    return len(items) // fine for most uses, but not for cross-platform protocols
}

// GOOD for cross-platform protocols: use int32 or int64 explicitly
func countItemsForAPI(items []string) int64 {
    return int64(len(items))
}

func main() {
    items := []string{"a", "b", "c"}
    fmt.Printf("Platform int size: %d bits\n", strconv.IntSize)
    fmt.Println("Count (int):", countItemsBad(items))
    fmt.Println("Count (int64):", countItemsForAPI(items))
}
```

### Example 2: Financial Calculation with int64

```go
package main

import (
    "fmt"
    "math"
)

type Money struct {
    Cents    int64  // $1.00 = 100 cents
    Currency string
}

func (m Money) Add(other Money) Money {
    if m.Currency != other.Currency {
        panic("currency mismatch")
    }
    return Money{Cents: m.Cents + other.Cents, Currency: m.Currency}
}

func (m Money) String() string {
    return fmt.Sprintf("%s%.2f", m.Currency, float64(m.Cents)/100)
}

func (m Money) Multiply(factor float64) Money {
    // Multiply, round to nearest cent
    result := float64(m.Cents) * factor
    return Money{
        Cents:    int64(math.Round(result)),
        Currency: m.Currency,
    }
}

func main() {
    price := Money{Cents: 1999, Currency: "$"} // $19.99
    tax := price.Multiply(0.08)                // 8% tax
    total := price.Add(tax)

    fmt.Println("Price:", price)  // $19.99
    fmt.Println("Tax:", tax)      // $1.60
    fmt.Println("Total:", total)  // $21.59
}
```

### Example 3: Type Aliases vs Defined Types

```go
package main

import "fmt"

// TYPE ALIAS: byte IS uint8 — interchangeable
type MyByte = uint8 // alias: = means identical type

// DEFINED TYPE: not interchangeable without conversion
type UserID int64
type ProductID int64
type Timestamp int64

func getUser(id UserID) string { return fmt.Sprintf("user-%d", id) }

func main() {
    uid := UserID(42)
    pid := ProductID(42)

    fmt.Println(getUser(uid))
    // getUser(pid)  // COMPILE ERROR: pid is ProductID, not UserID
    // This prevents mixing up ID types at compile time!

    // Type aliases: interchangeable
    var b byte = 255
    var u uint8 = b // no conversion needed
    fmt.Println(b, u)
}
```

### Example 4: Float Comparison with Epsilon

```go
package main

import (
    "fmt"
    "math"
)

const epsilon = 1e-9

func floatEqual(a, b float64) bool {
    return math.Abs(a-b) < epsilon
}

func floatEqualRelative(a, b, relativeTol float64) bool {
    // Relative tolerance: better for large numbers
    diff := math.Abs(a - b)
    largest := math.Max(math.Abs(a), math.Abs(b))
    if largest == 0 {
        return diff < epsilon
    }
    return diff/largest < relativeTol
}

func main() {
    a := 0.1 + 0.2
    b := 0.3

    fmt.Println("== comparison:", a == b)          // false
    fmt.Println("epsilon equal:", floatEqual(a, b)) // true

    // Large number comparison
    x := 1e15 + 0.001
    y := 1e15
    fmt.Println("Relative equal:", floatEqualRelative(x, y, 1e-6)) // true: diff is tiny relative to magnitude
}
```

### Example 5: Overflow Detection with math/bits

```go
package main

import (
    "fmt"
    "math/bits"
)

func safeAdd(a, b uint64) (uint64, bool) {
    result, overflow := bits.Add64(a, b, 0)
    return result, overflow != 0
}

func safeMul(a, b uint64) (uint64, bool) {
    hi, lo := bits.Mul64(a, b)
    return lo, hi != 0 // overflow if high bits are set
}

func main() {
    // Safe addition
    result, overflowed := safeAdd(math.MaxUint64, 1)
    fmt.Printf("MaxUint64 + 1 = %d, overflowed: %v\n", result, overflowed)
    // 0, overflowed: true

    result2, overflowed2 := safeAdd(100, 200)
    fmt.Printf("100 + 200 = %d, overflowed: %v\n", result2, overflowed2)
    // 300, overflowed: false

    // Safe multiplication
    r3, ov3 := safeMul(1<<32, 1<<32) // 2^32 * 2^32 = 2^64 — overflows uint64
    fmt.Printf("2^32 * 2^32 = %d, overflowed: %v\n", r3, ov3)
}
```

---

## Coding Patterns

### Pattern 1: Custom Numeric Types for Domain Safety

```go
type Celsius float64
type Fahrenheit float64

func (c Celsius) ToFahrenheit() Fahrenheit {
    return Fahrenheit(c*9/5 + 32)
}

func (f Fahrenheit) ToCelsius() Celsius {
    return Celsius((f - 32) * 5 / 9)
}

// Now you can't accidentally pass Fahrenheit where Celsius is expected:
func setThermostat(temp Celsius) { /* ... */ }

boilingC := Celsius(100)
boilingF := boilingC.ToFahrenheit() // 212
setThermostat(boilingC)
// setThermostat(boilingF)  // COMPILE ERROR: wrong type
```

### Pattern 2: Safe Numeric Parsing

```go
import (
    "fmt"
    "strconv"
)

func parsePositiveInt(s string, maxVal int64) (int64, error) {
    n, err := strconv.ParseInt(s, 10, 64)
    if err != nil {
        return 0, fmt.Errorf("not a valid integer: %q", s)
    }
    if n < 0 {
        return 0, fmt.Errorf("value must be non-negative, got %d", n)
    }
    if n > maxVal {
        return 0, fmt.Errorf("value %d exceeds maximum %d", n, maxVal)
    }
    return n, nil
}
```

### Pattern 3: Accumulate with Overflow Check

```go
func sumWithOverflowCheck(values []int64) (int64, error) {
    var total int64
    for _, v := range values {
        if v > 0 && total > math.MaxInt64-v {
            return 0, fmt.Errorf("overflow: sum exceeds MaxInt64")
        }
        if v < 0 && total < math.MinInt64-v {
            return 0, fmt.Errorf("overflow: sum below MinInt64")
        }
        total += v
    }
    return total, nil
}
```

---

## Clean Code

### Define Domain Types

```go
// Instead of:
func processPayment(userID int64, amount int64, taxRate float64) error { ... }

// Define types that carry meaning:
type UserID int64
type Cents int64
type TaxRate float64

func processPayment(id UserID, amount Cents, rate TaxRate) error { ... }
// Now: processPayment(UserID(42), Cents(1999), TaxRate(0.08))
// Compiler prevents: processPayment(Cents(42), UserID(1999), ...)
```

---

## Product Use / Feature

### Type Choices in Popular Go Projects

**Kubernetes**: Uses `int64` for resource quantities (CPU millicores, memory bytes).
**Prometheus**: Uses `float64` for metric values.
**etcd**: Uses `int64` for revision/index numbers.
**gRPC**: Maps proto `int64` to Go `int64`, `float64` to Go `float64`.

```go
// Kubernetes resource quantity (simplified):
type Quantity struct {
    d  infDecAmount // big.Int for arbitrary precision
    s  string
}

// Prometheus metric:
type Gauge interface {
    Set(float64)    // float64 for metric values
    Add(float64)
}
```

---

## Error Handling

```go
package main

import (
    "errors"
    "fmt"
    "math"
    "strconv"
)

var (
    ErrOverflow   = errors.New("numeric overflow")
    ErrUnderflow  = errors.New("numeric underflow")
    ErrNotNumeric = errors.New("not a valid number")
)

type SafeParser struct{}

func (p SafeParser) ParseInt8(s string) (int8, error) {
    n, err := strconv.ParseInt(s, 10, 8) // bitSize=8 enforces range
    if err != nil {
        if errors.Is(err, strconv.ErrRange) {
            return 0, fmt.Errorf("%w: %s out of int8 range", ErrOverflow, s)
        }
        return 0, fmt.Errorf("%w: %s", ErrNotNumeric, s)
    }
    return int8(n), nil
}

func main() {
    p := SafeParser{}

    v, err := p.ParseInt8("100")
    fmt.Println(v, err) // 100 <nil>

    _, err = p.ParseInt8("200")
    fmt.Println(err) // numeric overflow: 200 out of int8 range

    _, err = p.ParseInt8("abc")
    fmt.Println(err) // not a valid number: abc

    _ = math.MaxInt8
}
```

---

## Security Considerations

### Integer Overflow in Buffer Allocation

```go
// CVE-class vulnerability: integer overflow in size calculation
func readBlocks(count int32, blockSize int32) ([]byte, error) {
    // DANGEROUS: if count=100000 and blockSize=100000
    // count * blockSize overflows int32 → small number → small allocation
    totalSize := count * blockSize // int32 overflow!
    if totalSize < 0 {
        return nil, fmt.Errorf("integer overflow in size calculation")
    }
    return make([]byte, totalSize), nil
}

// SAFE version:
func readBlocksSafe(count, blockSize int64) ([]byte, error) {
    if count <= 0 || blockSize <= 0 {
        return nil, fmt.Errorf("count and blockSize must be positive")
    }
    const maxAlloc = 1 << 30 // 1GB max
    if count > maxAlloc/blockSize {
        return nil, fmt.Errorf("allocation too large: %d * %d", count, blockSize)
    }
    return make([]byte, count*blockSize), nil
}
```

---

## Performance Tips

### Alignment-Aware Struct Layout

```go
// Wasted memory (32 bytes):
type BadMetric struct {
    Count   int8    // 1 byte + 7 padding
    Value   float64 // 8 bytes
    Rate    int8    // 1 byte + 7 padding
    Total   float64 // 8 bytes
}

// Optimized (24 bytes):
type GoodMetric struct {
    Value   float64 // 8 bytes
    Total   float64 // 8 bytes
    Count   int8    // 1 byte
    Rate    int8    // 1 byte + 6 padding
}
```

### Float vs Integer Performance

```go
// Integer arithmetic: typically 1-3 CPU cycles
// Float arithmetic: typically 3-5 CPU cycles
// Float division: ~20+ cycles (use multiplication by reciprocal)

// Slow: repeated float division
for i := range values {
    result[i] = values[i] / divisor
}

// Fast: compute reciprocal once, multiply
reciprocal := 1.0 / divisor
for i := range values {
    result[i] = values[i] * reciprocal
}
```

---

## Metrics & Analytics

```go
type AnalyticsSummary struct {
    // Counts: int64 (can grow to billions)
    TotalRequests   int64
    SuccessRequests int64
    ErrorRequests   int64

    // Rates: float64 (precision matters)
    ErrorRate       float64  // 0.0 to 1.0
    P99LatencyMs    float64

    // Sizes: uint64 (always non-negative, can be large)
    TotalBytesIn    uint64
    TotalBytesOut   uint64

    // Small gauges: int32 (current connections, bounded)
    ActiveUsers     int32
    OpenConnections int32
}

func (s *AnalyticsSummary) ErrorRatio() float64 {
    if s.TotalRequests == 0 {
        return 0
    }
    return float64(s.ErrorRequests) / float64(s.TotalRequests)
}
```

---

## Best Practices

1. **Define domain types** (`type UserID int64`) to prevent mixing up semantically different values
2. **Use `int64` for money storage** (cents), not `float64`
3. **Use epsilon comparison for floats** — never use `==`
4. **Use `math/bits`** for overflow detection in critical arithmetic
5. **Group small numeric fields together** in structs to minimize padding
6. **Avoid `float64 → int64` conversion** for large values (>2^53) — precision loss
7. **Use `strconv.ParseInt/ParseFloat` with explicit bit size** for safe parsing
8. **Document units** in field names or comments: `LatencyNanoseconds int64`, not just `Latency int64`

---

## Edge Cases & Pitfalls

### float64 to int64 for Large Values

```go
// float64 has 52-bit mantissa → can exactly represent integers up to 2^53
const maxExact = 1 << 53 // 9007199254740992

f := float64(maxExact + 1) // 9007199254740993.0
fmt.Println(f == float64(maxExact)) // TRUE! precision lost!
// f is stored as 9007199254740992.0 — same as maxExact

// Converting large float64 to int64 may silently lose precision:
largeFloat := float64(math.MaxInt64) // 9.223372036854776e+18
intVal := int64(largeFloat)
fmt.Println(intVal)                    // may not equal math.MaxInt64
fmt.Println(intVal == math.MaxInt64)   // false
```

### Mixing int and uint in Comparisons

```go
var i int = -1
var u uint = 1

// if i < u { ... }  // COMPILE ERROR: mismatched types

// Must convert explicitly
if i < 0 || uint(i) < u {
    fmt.Println("i is less than u")
}
```

---

## Common Mistakes

### 1. Mixing int and int64 in slice lengths

```go
var data []byte = make([]byte, 1000000)
size := int64(len(data))  // OK but unnecessary on 64-bit
// On 32-bit: len() returns int (32-bit), int64 holds it fine

// The real mistake: using int64 math with int slice index
var n int64 = 500
data[n] = 1  // COMPILE ERROR: cannot use int64 as index
data[int(n)] = 1 // OK: explicit conversion
```

### 2. Converting float64 to int without rounding

```go
f := 9.7
i := int(f) // truncates to 9, NOT rounds to 10

// Correct: round first
import "math"
i = int(math.Round(f)) // 10
```

---

## Common Misconceptions

**"`uint` is always a good choice for non-negative values"** — Be careful. Subtraction of `uint` values can underflow unexpectedly. For simple loop counters and indices, `int` is often safer.

**"Converting to a wider type is always free"** — In tight loops, type conversions add CPU instructions. They're cheap individually but can matter at scale.

**"`float64` is more precise than `float32` for all values"** — True for most values, but both have limits. `float64` cannot exactly represent `int64` values larger than 2^53.

---

## Tricky Points

### Integer Constant Evaluation at Compile Time

```go
const x = 1 << 62   // OK: evaluated as untyped int
var y int64 = x     // OK: 1<<62 fits in int64

// But:
var z int = x       // OK on 64-bit, ERROR on 32-bit (> MaxInt32)
```

### Negative Modulo

```go
fmt.Println(-7 % 3)  // -1 in Go (result has sign of dividend)
fmt.Println(7 % -3)  // 1 in Go

// True modulo (always non-negative):
func mod(a, b int) int {
    return ((a % b) + b) % b
}
fmt.Println(mod(-7, 3))  // 2
```

---

## Test

```go
package numeric_test

import (
    "math"
    "testing"
)

func TestMoneyArithmetic(t *testing.T) {
    // $0.10 * 1000 should equal $100.00 in cents
    cents := int64(0)
    for i := 0; i < 1000; i++ {
        cents += 10 // 10 cents
    }
    if cents != 10000 {
        t.Errorf("Expected 10000 cents, got %d", cents)
    }
}

func TestFloatMoneyBug(t *testing.T) {
    // Demonstrate why float is wrong for money
    total := 0.0
    for i := 0; i < 1000; i++ {
        total += 0.10
    }
    if total == 100.0 {
        t.Error("Unexpectedly exact — floating point is unreliable")
    }
    // The difference is small but non-zero
    if math.Abs(total-100.0) < 1e-10 {
        t.Error("Difference too small — test is invalid")
    }
}

func TestSafeConversion(t *testing.T) {
    var big int64 = math.MaxInt32 + 1
    small := int32(big) // overflow
    if small > 0 {
        t.Errorf("Expected overflow, but got %d", small)
    }
}
```

---

## Tricky Questions

**Q1: Can you store all int64 values exactly in float64?**
A: No. `float64` has 52-bit mantissa, so integers larger than 2^53 (~9 quadrillion) lose precision.

**Q2: What is `-7 % 3` in Go?**
A: `-1`. In Go, the modulo result has the same sign as the dividend.

**Q3: Why can't you directly index a slice with `int64` in Go?**
A: Slice indices must be of type `int`, which matches the runtime's internal representation of slice lengths and capacities.

**Q4: What happens when you convert `float64(-1.5)` to `uint64`?**
A: Implementation-defined behavior — it may produce `0`, `math.MaxUint64`, or another value. Never convert negative floats to unsigned integers.

**Q5: Is `type UserID int64` the same as `type UserID = int64`?**
A: No. `type UserID int64` creates a new defined type — you cannot pass a `UserID` where `int64` is expected without conversion. `type UserID = int64` is a type alias — they are exactly the same type and fully interchangeable.

---

## Cheat Sheet

```
DOMAIN TYPE SAFETY:
  type UserID int64     ← defined type (not interchangeable with int64)
  type MyInt = int64    ← alias (fully interchangeable with int64)

MONEY: use int64 cents
  price := int64(1999)  // $19.99
  display := fmt.Sprintf("$%.2f", float64(price)/100)

FLOAT COMPARISON: never use ==
  math.Abs(a-b) < 1e-9            (absolute tolerance)
  math.Abs(a-b)/math.Max(|a|,|b|) (relative tolerance)

OVERFLOW DETECTION:
  import "math/bits"
  result, carry := bits.Add64(a, b, 0)
  if carry != 0 { /* overflow */ }

ALIGNMENT: group by size (large to small)
  float64, float64, int32, int32, int8, int8

INT vs INT64:
  Slice index: int
  Database ID: int64
  Timestamp (nanoseconds): int64
  Loop counter: int

CONVERSION SAFETY:
  Safe (wider):   int8 → int16 → int32 → int64
  Unsafe (narrower): need range check first
```

---

## Self-Assessment Checklist

- [ ] I can explain why Go has no implicit numeric conversion
- [ ] I understand when `int` might be 32-bit vs 64-bit
- [ ] I know how to compare floats with epsilon
- [ ] I use `int64` cents for monetary values
- [ ] I can detect integer overflow with `math/bits`
- [ ] I create domain types (like `UserID`) to prevent type mixing
- [ ] I understand that `type T int64` != `type T = int64`
- [ ] I know that `float64` can't exactly represent all `int64` values

---

## Summary

At the middle level, numeric type decisions are about:
- **Correctness**: use `int64` for money, not `float64`
- **Safety**: create domain types to prevent type mixing
- **Portability**: use `int32`/`int64` instead of `int` when size matters
- **Overflow**: use `math/bits` for detected arithmetic
- **Performance**: alignment-aware struct layout, avoid conversions in hot loops

---

## What You Can Build

- **Financial calculation engine** with exact `int64` cents arithmetic
- **Domain model** with strongly-typed IDs: `UserID`, `OrderID`, `ProductID`
- **Safe numeric parser** with range checking and error types
- **Metrics collection system** with appropriate types per metric
- **Safe buffer allocation** with overflow-checked size calculations

---

## Further Reading

- [Go Spec: Conversions](https://go.dev/ref/spec#Conversions)
- [math/bits package](https://pkg.go.dev/math/bits)
- [IEEE 754 Wikipedia](https://en.wikipedia.org/wiki/IEEE_754)
- [The Float Representation Problem](https://floating-point-gui.de/)
- [shopspring/decimal](https://github.com/shopspring/decimal) — exact decimals

---

## Related Topics

- **Integers** — deep dive: literals, bitwise ops, overflow patterns
- **Floating-point** — IEEE 754 internals, NaN, Inf, subnormals
- **math/big** — arbitrary precision integers and rationals
- **encoding/binary** — serializing numeric types to bytes
- **unsafe** — examining numeric type memory layouts

---

## Diagrams & Visual Aids

### IEEE 754 float64 Layout

```
64 bits total:
┌─┬───────────────┬──────────────────────────────────────────────────────────┐
│S│   Exponent    │                      Mantissa                            │
│1│    11 bits    │                       52 bits                            │
└─┴───────────────┴──────────────────────────────────────────────────────────┘

S=0, E=01111111111, M=0000...0 → value = 1.0
S=0, E=01111111111, M=1000...0 → value = 1.5
S=0, E=all 1s, M=0 → +Infinity
S=0, E=all 1s, M≠0 → NaN
```

### Conversion Safety

```
WIDENING (always safe):
int8 ──→ int16 ──→ int32 ──→ int64
                      │
                    float64 (exact up to 2^53)

NARROWING (check for loss):
int64 ──→ int32: if value > MaxInt32, data lost
float64 ──→ int64: decimal truncated, large values overflow
```

---

## Evolution & Historical Context

Go 1.0 launched with all numeric types we have today. The key additions over versions:
- Go 1.13: Numeric literals with `_` separator (`1_000_000`)
- Go 1.13: Binary (`0b`), octal (`0o`), hex (`0x`) literal prefixes
- Go 1.17: `math.MaxInt`, `math.MinInt` for platform-sized int bounds
- Go 1.18: Generics introduced `constraints.Integer`, `constraints.Float` for numeric constraints

---

## Alternative Approaches

| Need | Go Standard | Alternative |
|------|------------|-------------|
| Exact decimals | `int64` cents | `shopspring/decimal` |
| Arbitrary precision | `math/big.Int` | `math/big.Float` |
| Saturating arithmetic | Manual check | None built-in |
| Checked arithmetic | `math/bits` | None built-in |
| Fixed-point | Manual scaling | None built-in |

---

## Anti-Patterns

1. **Float for money** — Use `int64` cents
2. **`int` for cross-platform protocols** — Use `int32`/`int64` explicitly
3. **`==` for float comparison** — Use epsilon comparison
4. **Unchecked narrowing conversions** — Always validate range
5. **`uint` for "never negative" logic** — Prefer `int` with validation; `uint` underflow is subtle
6. **Generic `int` for all IDs** — Use domain types to prevent mixing

---

## Debugging Guide

**Problem: Unexpected large number from `uint` subtraction**
```go
var a uint = 5
var b uint = 10
result := a - b // wraps to MaxUint, NOT -5
// Debug: add check: if b > a { return error }
```

**Problem: Float comparison fails**
```go
if total == expectedAmount { // never fires
// Debug: print with full precision
fmt.Printf("%.20f\n", total)
fmt.Printf("%.20f\n", expectedAmount)
// Fix: use epsilon
```

**Problem: Mysterious large allocation**
```go
size := int32(userInput) * 1024 // overflow if userInput > 2M
// Debug: add overflow check
// Fix: use int64 for size calculation
```

---

## Comparison with Other Languages

| Feature | Go | Java | Python | Rust | C |
|---------|----|----|--------|------|---|
| Implicit int→float | No | Yes | Yes | No | Yes |
| Overflow behavior | Wraps | Wraps | BigInt auto | Panic (debug) | Undefined |
| Default int size | Platform | 32-bit | Arbitrary | Platform | Platform |
| Arbitrary precision | `math/big` | `BigInteger` | Built-in | `num-bigint` | None |
| Decimal type | External | `BigDecimal` | `Decimal` | External | None |
| Unsigned types | Yes | No | No | Yes | Yes |
