# Numeric Types (Overview) — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ — Common Interview Topics](#faq-common-interview-topics)

---

## Junior Level Questions

### Q1: Name all integer types in Go.

**Answer:**
- Signed: `int8`, `int16`, `int32`, `int64`, `int`
- Unsigned: `uint8`, `uint16`, `uint32`, `uint64`, `uint`, `uintptr`
- Aliases: `byte` (= `uint8`), `rune` (= `int32`)

---

### Q2: What is the size of `int` in Go?

**Answer:** Platform-dependent. On 32-bit systems: 32 bits. On 64-bit systems: 64 bits. **Never assume it's 64-bit.**

```go
import (
    "fmt"
    "strconv"
    "unsafe"
)

fmt.Println(unsafe.Sizeof(int(0)))  // 8 on 64-bit
fmt.Println(strconv.IntSize)         // 64 on 64-bit
```

---

### Q3: What are `byte` and `rune`?

**Answer:**
- `byte` is an alias for `uint8` (unsigned 8-bit integer, range 0-255)
- `rune` is an alias for `int32` (signed 32-bit integer, represents a Unicode code point)

```go
var b byte = 'A'   // 65
var r rune = '中'   // 20013 (Unicode code point)
```

---

### Q4: What are the floating-point types in Go?

**Answer:** `float32` (32-bit, ~7 significant digits) and `float64` (64-bit, ~15-16 significant digits). The default is `float64`.

```go
x := 3.14        // float64 (default)
var y float32 = 3.14
```

---

### Q5: Does Go support implicit numeric type conversion?

**Answer:** No. All conversions must be explicit.

```go
var a int32 = 10
var b int64 = 20
// c := a + b        // COMPILE ERROR
c := int64(a) + b    // OK: explicit conversion
```

---

### Q6: What is the default type for integer literals?

**Answer:** `int`. For float literals: `float64`. For complex literals: `complex128`.

```go
x := 42       // int
y := 3.14     // float64
z := 1 + 2i   // complex128
```

---

### Q7: What happens when an integer overflows in Go?

**Answer:** It wraps around — no panic, no error. This is defined behavior.

```go
var x uint8 = 255
x++
fmt.Println(x) // 0 (wrapped)

var y int8 = 127
y++
fmt.Println(y) // -128 (wrapped to min)
```

---

### Q8: Why should you not use `float64` for money?

**Answer:** Binary floating-point cannot represent all decimal fractions exactly. `0.1 + 0.2 != 0.3` in float64.

```go
fmt.Println(0.1 + 0.2)       // 0.30000000000000004
fmt.Println(0.1 + 0.2 == 0.3) // false

// Use int64 cents instead:
price := int64(10)  // 10 cents
tax := int64(2)     // 2 cents
total := price + tax // 12 cents = $0.12 exactly
```

---

### Q9: How do you get the maximum value of int32?

**Answer:** Use the `math` package constants.

```go
import "math"
fmt.Println(math.MaxInt32)  // 2147483647
fmt.Println(math.MinInt32)  // -2147483648
fmt.Println(math.MaxUint8)  // 255
fmt.Println(math.MaxFloat64) // 1.7976931348623157e+308
```

---

### Q10: What is numeric literal syntax in Go?

**Answer:** Go supports multiple literal formats:

```go
decimal := 1_000_000    // underscore separator (Go 1.13+)
binary  := 0b1010_1010  // binary prefix 0b
octal   := 0o777        // octal prefix 0o (or old style: 0777)
hex     := 0xFF_FF      // hexadecimal prefix 0x
float   := 1.5e3        // scientific notation: 1500.0
```

---

## Middle Level Questions

### Q11: What is the difference between `type MyInt int64` and `type MyInt = int64`?

**Answer:**
- `type MyInt int64` creates a **new defined type**. You CANNOT pass `MyInt` where `int64` is expected without explicit conversion.
- `type MyInt = int64` creates a **type alias**. They are identical — fully interchangeable.

```go
type UserID int64      // defined type
type ProductID = int64 // alias

func process(id int64) {}

uid := UserID(42)
// process(uid)  // COMPILE ERROR: UserID ≠ int64
process(int64(uid)) // OK with conversion

var pid ProductID = 42
process(pid)  // OK: ProductID is exactly int64
```

---

### Q12: How do you safely compare floating-point values?

**Answer:** Use epsilon (tolerance-based) comparison. Never use `==` for floats in most cases.

```go
import "math"

func floatEqual(a, b, eps float64) bool {
    return math.Abs(a-b) < eps
}

// Absolute tolerance: good for small numbers near 0
floatEqual(0.1+0.2, 0.3, 1e-9) // true

// Relative tolerance: better for large numbers
func floatEqualRelative(a, b, tol float64) bool {
    diff := math.Abs(a - b)
    max := math.Max(math.Abs(a), math.Abs(b))
    if max == 0 { return diff == 0 }
    return diff/max < tol
}
```

---

### Q13: When would you use `float32` instead of `float64`?

**Answer:**
- **Graphics rendering**: GPUs are optimized for float32; game engines use float32 for position/color
- **Large arrays**: float32 uses half the memory of float64 — better cache utilization
- **Interfacing with C/OpenGL**: these APIs use float32
- **When precision isn't critical**: sensor data, graphics coordinates (7 digits is enough)

Avoid float32 for: scientific computing, financial calculations, situations requiring 15+ digits of precision.

---

### Q14: What is `uintptr` used for?

**Answer:** `uintptr` is an unsigned integer type large enough to hold any pointer value. It's used for pointer arithmetic with `unsafe.Pointer`. Unlike pointer types, `uintptr` is not traced by the GC — do not store `uintptr` values and expect the pointed-to memory to remain valid.

```go
import "unsafe"

type T struct{ x, y int }
t := T{1, 2}

// Pointer arithmetic (dangerous — for educational purposes)
ptr := unsafe.Pointer(&t)
yPtr := (*int)(unsafe.Pointer(uintptr(ptr) + unsafe.Offsetof(t.y)))
fmt.Println(*yPtr) // 2
```

---

### Q15: How do you detect integer overflow in Go?

**Answer:** Use the `math/bits` package for unsigned overflow, or manual checks for signed.

```go
import "math/bits"

// Unsigned addition overflow
func safeAddUint64(a, b uint64) (uint64, bool) {
    result, overflow := bits.Add64(a, b, 0)
    return result, overflow != 0
}

// Signed addition overflow (manual check)
func safeAddInt64(a, b int64) (int64, bool) {
    result := a + b
    // Overflow if signs of a and b are same, but result sign differs
    if (a^result)&(b^result) < 0 {
        return 0, true
    }
    return result, false
}
```

---

### Q16: What is the relationship between `int`, memory addresses, and slices?

**Answer:** `int` is the same size as a pointer (on 64-bit: 8 bytes). This is why:
- `len()` and `cap()` return `int` — slice lengths are pointer-arithmetic-sized
- Slice indices use `int` — efficient pointer arithmetic
- `for i := range slice` — `i` is `int`

Using `int64` as slice index requires conversion:
```go
var n int64 = 100
slice[int(n)] = 42 // must convert to int
```

---

### Q17: How does JSON unmarshaling handle large integers?

**Answer:** By default, JSON numbers unmarshal to `float64`, which can't exactly represent integers > 2^53.

```go
import "encoding/json"

// Problem:
var result map[string]interface{}
json.Unmarshal([]byte(`{"id": 9007199254740993}`), &result)
id := result["id"].(float64) // 9007199254740992 — WRONG!

// Fix: use json.Number
dec := json.NewDecoder(strings.NewReader(`{"id": 9007199254740993}`))
dec.UseNumber()
dec.Decode(&result)
n := result["id"].(json.Number)
id64, _ := n.Int64() // 9007199254740993 — correct
```

---

### Q18: What is the range of each integer type?

**Answer:**

| Type | Min | Max |
|------|-----|-----|
| `int8` | -128 | 127 |
| `int16` | -32,768 | 32,767 |
| `int32` | -2,147,483,648 | 2,147,483,647 |
| `int64` | -9,223,372,036,854,775,808 | 9,223,372,036,854,775,807 |
| `uint8` | 0 | 255 |
| `uint16` | 0 | 65,535 |
| `uint32` | 0 | 4,294,967,295 |
| `uint64` | 0 | 18,446,744,073,709,551,615 |

---

## Senior Level Questions

### Q19: Explain why float64 cannot exactly represent all int64 values.

**Answer:** `float64` has a 52-bit mantissa (plus an implicit leading 1 bit). This means it can exactly represent integers up to 2^53 = 9,007,199,254,740,992. Beyond this threshold, consecutive float64 values differ by 2 or more — not every integer has a unique representation.

```go
const maxExact = int64(1 << 53) // 9007199254740992
f := float64(maxExact + 1)
fmt.Println(f == float64(maxExact)) // true! precision lost

// Implication: Twitter IDs, large database IDs, etc.
// can be silently corrupted when stored in float64
```

---

### Q20: How does the Go compiler optimize division by constant integers?

**Answer:** The compiler replaces division by constants with faster sequences:
- Division by power of 2: arithmetic right shift (`SAR`)
- Division by other constants: "magic number" multiply + shift (Barrett reduction)

```go
// x / 4 → x >> 2 (for positive; with adjustment for negative)
// x / 10 → x * magic_const >> shift

// This avoids IDIV (35-90 cycles) with 3-6 cycle multiply sequences
```

---

### Q21: When would struct field ordering affect performance and memory usage?

**Answer:** Poor ordering causes padding (wasted bytes due to alignment requirements). Large-to-small ordering minimizes padding.

```go
import "unsafe"

type Wasteful struct {
    a int8   // 1 + 7 padding
    b int64  // 8
    c int8   // 1 + 7 padding
    d int64  // 8
}
fmt.Println(unsafe.Sizeof(Wasteful{})) // 32 bytes

type Efficient struct {
    b int64  // 8
    d int64  // 8
    a int8   // 1
    c int8   // 1 + 6 padding
}
fmt.Println(unsafe.Sizeof(Efficient{})) // 24 bytes — 25% smaller
```

For 10M records: `Wasteful` = 320MB, `Efficient` = 240MB.

---

### Q22: What is Kahan summation and when do you need it?

**Answer:** Kahan summation compensates for floating-point rounding errors in cumulative sums. For large lists of float64 values, naive summation accumulates errors; Kahan keeps a "compensation" variable.

```go
func kahanSum(values []float64) float64 {
    var sum, comp float64
    for _, v := range values {
        y := v - comp
        t := sum + y
        comp = (t - sum) - y // captures lost bits
        sum = t
    }
    return sum
}

// For 10M values of 0.1: naive gives 999999.9999..., Kahan gives 1000000.0
```

---

### Q23: A database ID field is currently int32. The table has 2 billion records. Should you worry?

**Answer:** Yes — immediately. `int32` max is 2,147,483,647. At 2 billion records, you have ~147M IDs left. Depending on insertion rate, you may overflow within months.

**Migration strategy:**
```sql
-- Postgres: ALTER TABLE items ALTER COLUMN id TYPE BIGINT;
-- MySQL:    ALTER TABLE items MODIFY id BIGINT AUTO_INCREMENT;
```

```go
// Update all Go structs from:
type Item struct { ID int32 }
// To:
type Item struct { ID int64 }
```

**Prevention:** Always use `int64` for database IDs from the start.

---

## Scenario-Based Questions

### Scenario Q1: Your service computes financial totals and users report small discrepancies.

**Code in review:**
```go
type Invoice struct {
    LineItems []float64
}

func (inv Invoice) Total() float64 {
    var total float64
    for _, item := range inv.LineItems {
        total += item
    }
    return total
}
```

**What's wrong and how do you fix it?**

**Answer:** Using `float64` for financial calculations accumulates floating-point rounding errors. Fix: use `int64` cents.

```go
type Invoice struct {
    LineItemsCents []int64  // store as cents
}

func (inv Invoice) TotalCents() int64 {
    var total int64
    for _, item := range inv.LineItemsCents {
        total += item
    }
    return total
}

func (inv Invoice) TotalDollars() string {
    cents := inv.TotalCents()
    return fmt.Sprintf("$%d.%02d", cents/100, cents%100)
}
```

---

### Scenario Q2: A rate limiter counter of type int32 occasionally produces incorrect results under high load.

**What could go wrong?**

**Answer:** Several issues:
1. **Overflow**: `int32` max is ~2.1 billion; high-traffic services can exceed this
2. **Data race**: if the counter is shared across goroutines without atomic access
3. **Wrong type**: should be `int64` + `sync/atomic`

```go
// Fix:
var requestCount int64

func increment() {
    atomic.AddInt64(&requestCount, 1)
}

func getCount() int64 {
    return atomic.LoadInt64(&requestCount)
}
```

---

### Scenario Q3: Cross-platform code panics on 32-bit ARM but works fine on x86-64.

**Code:**
```go
var maxBuffer int = 4_000_000_000  // 4 billion
data := make([]byte, maxBuffer)
```

**What's wrong?**

**Answer:** On 32-bit ARM, `int` is 32 bits (max 2.1B). `4_000_000_000 > math.MaxInt32` — compile error on 32-bit.

```go
// Fix: use int64 explicitly
var maxBuffer int64 = 4_000_000_000
data := make([]byte, maxBuffer) // make accepts int, need conversion
// OR: check platform
if maxBuffer > math.MaxInt {
    log.Fatal("buffer too large for this platform")
}
```

---

## FAQ — Common Interview Topics

### FAQ1: When should I use int vs int64?

- Use `int` for: slice indices, loop counters, anything interacting with `len()`/`cap()`
- Use `int64` for: database IDs, timestamps, large counters, any cross-platform protocol value

---

### FAQ2: Is there a decimal type in Go?

No built-in decimal type. Options:
1. `int64` cents for money
2. `math/big.Rat` for exact rational numbers
3. External library: `shopspring/decimal`

---

### FAQ3: How do you read/write binary numeric data?

```go
import "encoding/binary"

// Write int64 in big-endian
buf := make([]byte, 8)
binary.BigEndian.PutUint64(buf, uint64(12345678))

// Read back
value := int64(binary.BigEndian.Uint64(buf))
```

---

### FAQ4: What is `math.NaN()` and why does `nan == nan` return false?

`NaN` (Not a Number) is a special float64 value representing undefined results (0/0, √-1, etc.). IEEE 754 specifies that NaN is not equal to anything, including itself. Always use `math.IsNaN()`.

```go
nan := math.NaN()
fmt.Println(nan == nan)       // false (IEEE 754)
fmt.Println(math.IsNaN(nan))  // true
```

---

### FAQ5: How do you convert between int64 and string?

```go
import "strconv"

// int64 → string
s := strconv.FormatInt(int64(42), 10)  // "42"
s2 := fmt.Sprintf("%d", 42)            // "42"

// string → int64
n, err := strconv.ParseInt("42", 10, 64)  // 42, nil
if err != nil { /* handle */ }

// int64 → string (simple)
s3 := strconv.Itoa(42)  // only for int (not int64!)
```

---

### FAQ6: What is numeric separator (underscore) in Go?

```go
// Go 1.13+: use _ as visual separator in numeric literals
million     := 1_000_000
hexColor    := 0xFF_FF_FF
binaryFlags := 0b1010_0101
```

It's purely cosmetic — the compiler ignores underscores.

---

### FAQ7: Operator precedence with numeric types?

```
Highest:   * / % << >> & &^
           + - | ^
Lowest:    == != < <= > >=
           &&
           ||
```

Common gotcha:
```go
x := 2 + 3*4   // 14 (not 20): * has higher precedence
y := 2 | 3&4   // &^ before |: 2 | (3&4) = 2 | 0 = 2
```

---

### FAQ8: How do you check if a number is a specific type at runtime?

```go
var i interface{} = int32(42)

switch v := i.(type) {
case int:
    fmt.Println("int:", v)
case int32:
    fmt.Println("int32:", v) // matches here
case int64:
    fmt.Println("int64:", v)
case float64:
    fmt.Println("float64:", v)
}
```
