# Go Integer Types — Interview Questions

## Table of Contents
1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based](#scenario-based)
5. [FAQ](#faq)

---

## Junior Level

### Q1: How many integer types does Go have? List them all.

**Answer:**
Go has **10 integer types**:

| Signed | Unsigned |
|--------|----------|
| `int8` (−128 to 127) | `uint8` (0 to 255) |
| `int16` (−32,768 to 32,767) | `uint16` (0 to 65,535) |
| `int32` (−2,147,483,648 to 2,147,483,647) | `uint32` (0 to 4,294,967,295) |
| `int64` (−9.2×10¹⁸ to 9.2×10¹⁸) | `uint64` (0 to 1.8×10¹⁹) |
| `int` (platform-dependent: 32 or 64 bit) | `uint` (platform-dependent) |
| | `uintptr` (pointer-sized unsigned int) |

Plus two aliases:
- `byte` = `uint8`
- `rune` = `int32`

---

### Q2: What is the zero value of an integer in Go?

**Answer:**
All integer types have a zero value of `0`.

```go
var i int       // 0
var b byte      // 0
var r rune      // 0
var u uint64    // 0
```

This is guaranteed by the Go specification. There are no uninitialized integer variables.

---

### Q3: What happens when an integer overflows in Go?

**Answer:**
Integer overflow **wraps around silently** — no panic, no error, no undefined behavior.

```go
var x int8 = 127
x++
fmt.Println(x) // -128 (wraps to minimum)

var u uint8 = 255
u++
fmt.Println(u) // 0 (wraps to zero)
```

This is defined behavior in Go (two's complement arithmetic). The Go compiler may detect **constant** overflow at compile time:

```go
const bad = int8(200) // compile error: constant 200 overflows int8
```

But runtime overflow is silent.

---

### Q4: How do you write integer literals in different bases?

**Answer:**

```go
decimal := 255          // base 10
binary  := 0b11111111  // base 2  (Go 1.13+)
octal   := 0o377       // base 8  (Go 1.13+, preferred)
oldOctal := 0377       // base 8  (legacy prefix 0)
hex     := 0xFF        // base 16

// Readability: underscore separators (Go 1.13+)
million := 1_000_000
ipv4    := 0xFF_00_00_01
```

---

### Q5: Can you use an `int` where `int64` is expected?

**Answer:**
No. Go requires **explicit type conversion**. There is no implicit conversion between integer types.

```go
var a int = 42
var b int64 = a     // compile error: cannot use a (type int) as type int64

var c int64 = int64(a)  // OK: explicit conversion
```

This applies even between `int` and `int32` on 32-bit platforms where they're the same size.

---

### Q6: What is the difference between `byte` and `uint8`?

**Answer:**
They are **identical types** — `byte` is just an alias for `uint8`:

```go
var b byte  = 65
var u uint8 = 65
b = u  // OK: same underlying type
```

The distinction is **semantic**:
- Use `byte` for raw bytes, binary data, ASCII characters
- Use `uint8` for small unsigned integers (0–255)

The compiler treats them identically; the alias is for human readability.

---

### Q7: What is the difference between `rune` and `int32`?

**Answer:**
`rune` is an alias for `int32`, representing a Unicode code point.

```go
var r rune  = '❤'   // Unicode U+2764
var i int32 = 10132  // same value, less clear intent
```

Use `rune` when working with Unicode characters, `int32` for integer arithmetic. Both compile to the same machine code.

---

### Q8: How does integer division work in Go?

**Answer:**
Integer division in Go **truncates toward zero** (not toward negative infinity):

```go
fmt.Println(7 / 2)    // 3
fmt.Println(-7 / 2)   // -3  (not -4!)
fmt.Println(7 / -2)   // -3
fmt.Println(-7 / -2)  // 3
```

The modulo operator follows the same rule (remainder has the sign of the dividend):

```go
fmt.Println(7 % 2)    //  1
fmt.Println(-7 % 2)   // -1  (not 1!)
fmt.Println(7 % -2)   //  1
```

For Euclidean modulo (always non-negative), use: `((a % b) + b) % b`

---

### Q9: What is `uintptr` used for?

**Answer:**
`uintptr` is an **unsigned integer large enough to hold any pointer value**. It is used in low-level code with the `unsafe` package.

```go
import "unsafe"

var x int = 42
ptr := uintptr(unsafe.Pointer(&x))  // pointer → uintptr
```

Important: `uintptr` is NOT a pointer — the GC does not track it. If the only reference to an object is a `uintptr`, the object can be collected and the pointer becomes invalid. Never store `uintptr` across GC checkpoints.

---

### Q10: How do you detect if an integer is even or odd?

**Answer:**
Use the bitwise AND operator — check the least significant bit:

```go
func isEven(n int) bool { return n&1 == 0 }
func isOdd(n int)  bool { return n&1 == 1 }
```

This is equivalent to `n % 2 == 0` / `n % 2 != 0` but is idiomatic for bit-level checks. The compiler may optimize `%2` to `&1` anyway for positive numbers.

---

## Middle Level

### Q11: Why does Go use two's complement for negative integers?

**Answer:**
Go mandates **two's complement** representation (as of Go 1.17, explicitly specified). Two's complement has several advantages:

1. **Single zero**: Only one representation of 0 (unlike sign-magnitude)
2. **Unified arithmetic**: Addition/subtraction work the same for signed/unsigned
3. **Efficient hardware**: All modern CPUs use two's complement natively

How it works for `int8`:
```
 127 = 0111 1111
   1 = 0000 0001
   0 = 0000 0000
  -1 = 1111 1111  (NOT 0 + 1)
  -2 = 1111 1110
-128 = 1000 0000
```

Converting negative: flip all bits, add 1.
```
 -42:  42 = 0010 1010
       NOT    = 1101 0101
       +1     = 1101 0110  = -42
```

---

### Q12: What is the difference between `int` and `int64`? Which should you prefer?

**Answer:**

| | `int` | `int64` |
|---|---|---|
| Size | 32-bit on 32-bit OS, 64-bit on 64-bit OS | Always 64-bit |
| Portability | Platform-dependent | Portable, explicit |
| Performance | Often same as native word | May need conversion |
| Use case | Array indices, general counting | Explicit large values |

**Guideline:**
- Use `int` for: loop counters, slice indices, general-purpose integers (idiomatic Go)
- Use `int64` for: values stored in databases/files, protocol buffers, APIs with explicit size requirements
- Use `int32` for: memory-constrained arrays, matching external APIs

```go
// Correct: loop index uses int
for i := 0; i < len(s); i++ { ... }

// Correct: database ID uses int64
type UserID int64
```

---

### Q13: Explain arithmetic vs. logical right shift. Which does Go use?

**Answer:**

- **Arithmetic right shift** (`SAR` instruction): preserves sign bit — fills with the MSB
- **Logical right shift** (`SHR` instruction): fills with zeros

Go uses:
- **Arithmetic right shift** for **signed** integers: `>>` on `int` preserves sign
- **Logical right shift** for **unsigned** integers: `>>` on `uint` fills with zeros

```go
var s int8  = -128  // 1000 0000
var u uint8 = 128   // 1000 0000

fmt.Printf("%08b\n", uint8(s >> 1))  // 1100 0000 = -64 (arithmetic)
fmt.Printf("%08b\n", u >> 1)          // 0100 0000 = 64  (logical)
```

This matters for implementing algorithms that depend on arithmetic right shift behavior.

---

### Q14: What is `math/bits` and when should you use it?

**Answer:**
`math/bits` provides **intrinsic operations** that map directly to CPU instructions, avoiding Go's silent overflow behavior.

Key functions:

```go
import "math/bits"

// Overflow-safe addition (returns sum + carry)
sum, carry := bits.Add64(a, b, 0)

// Overflow-safe multiplication (returns lo + hi)
lo, hi := bits.Mul64(a, b)

// Count set bits (maps to POPCNT instruction)
bits.OnesCount64(x)

// Count leading/trailing zeros
bits.LeadingZeros64(x)   // maps to LZCNT
bits.TrailingZeros64(x)  // maps to TZCNT (BSF)

// Bit length
bits.Len64(x)  // ⌊log₂(x)⌋ + 1

// Rotate
bits.RotateLeft64(x, k)  // maps to ROLQ instruction
```

Use when: implementing cryptography, compression, hashing, or any algorithm requiring overflow-safe multi-word arithmetic.

---

### Q15: How do you set, clear, toggle, and test individual bits?

**Answer:**

```go
var flags uint8

const (
    BitA = 1 << iota  // 0000 0001
    BitB               // 0000 0010
    BitC               // 0000 0100
)

// Set bit
flags |= BitA          // 0000 0001

// Test bit
isSet := flags&BitA != 0

// Clear bit
flags &^= BitA         // 0000 0000

// Toggle bit
flags ^= BitB          // 0000 0010

// Test multiple bits (all set)
allSet := flags&(BitA|BitB) == (BitA|BitB)
```

The `&^` operator is Go's **bit clear** (AND NOT) operator, unique to Go.

---

### Q16: How do you implement Euclidean modulo in Go?

**Answer:**
Go's `%` follows truncated division (sign of dividend), so `-7 % 3 == -1`. Euclidean modulo always returns non-negative results.

```go
// Euclidean modulo: result always in [0, |b|)
func mod(a, b int) int {
    result := a % b
    if result < 0 {
        if b > 0 {
            result += b
        } else {
            result -= b
        }
    }
    return result
}

// Simpler version (when b is always positive):
func modPos(a, b int) int {
    return ((a % b) + b) % b
}

fmt.Println(modPos(-7, 3))  // 2 (not -1)
fmt.Println(modPos(7, 3))   // 1
```

Used for: circular buffers, day-of-week calculations, hash tables, anything requiring wrap-around on negative indices.

---

### Q17: What is `iota` and how does it work with bit flags?

**Answer:**
`iota` is a compile-time counter that resets to 0 at each `const` block and increments by 1 per `ConstSpec`.

```go
type Permission uint8

const (
    Read    Permission = 1 << iota  // 1 << 0 = 1
    Write                            // 1 << 1 = 2
    Execute                          // 1 << 2 = 4
    Admin                            // 1 << 3 = 8
)

// Can represent any combination in a single byte
userPerm := Read | Write  // 0000 0011

func hasPermission(user, required Permission) bool {
    return user&required == required
}
```

A common pattern is to skip the zero value to distinguish "no flags set" from "uninitialized":

```go
const (
    _       = iota             // skip 0
    Small   = iota * 10        // 10
    Medium                     // 20
    Large                      // 30
)
```

---

### Q18: Can integer types be compared with `==` and `<`? What about different types?

**Answer:**
Integers of the **same type** support all comparison operators: `==`, `!=`, `<`, `<=`, `>`, `>=`.

**Different types cannot be directly compared** — explicit conversion is required:

```go
var a int32 = 100
var b int64 = 100

// a == b  // compile error: mismatched types
a == int32(b)  // OK
int64(a) == b  // OK
```

Special case: **untyped constants** can be compared with any numeric type:

```go
var x int64 = 100
x == 100  // OK: 100 is untyped, adapts to int64
```

Be careful with signed/unsigned comparison bugs:

```go
var s int  = -1
var u uint = 1
// s < u  would be a compile error (different types)
// If they were the same type, sign issues could occur
```

---

## Senior Level

### Q19: How does the Go compiler optimize division by a constant?

**Answer:**
The Go compiler uses **Barrett reduction** (or similar techniques) to replace expensive integer division with multiplication + shifts.

For `x / 7`:
```
; Naive: IDIVQ (20-40 cycle latency)
; Compiler generates:
MOVQ    $-1085102592571150095, AX  ; magic number
IMULQ   CX                          ; high 64 bits
ADDQ    CX, DX                      ; adjust
SARQ    $2, DX                      ; shift
SHRQ    $63, CX                     ; sign correction  
ADDQ    CX, DX                      ; = x/7
```

This replaces a ~20-40 cycle IDIV with 3-4 cycles of multiply+shift. The compiler performs this optimization automatically for **all constant divisors** at compile time.

To observe this:
```go
//go:noescape
func divBy7(x int64) int64 { return x / 7 }
```

Run `go tool compile -S file.go` to see the generated assembly.

---

### Q20: What are the security implications of integer overflow in Go?

**Answer:**
While Go's integer overflow is defined behavior (no UB like C), it's still a security concern in specific scenarios:

**Dangerous pattern — Buffer size calculation:**
```go
// CVE-class vulnerability
func allocate(count, size int) []byte {
    // If count * size overflows int, result is small
    // attacker controls count: count = 2^31+1, size = 2
    // overflow → allocates 2 bytes instead of 4GB+
    return make([]byte, count*size)  // WRONG
}

// Safe version
func allocateSafe(count, size int) ([]byte, error) {
    if count > math.MaxInt/size {
        return nil, errors.New("integer overflow")
    }
    return make([]byte, count*size), nil
}
```

**Safe multiplication using math/bits:**
```go
func safeMul(a, b uint64) (uint64, error) {
    lo, hi := bits.Mul64(a, b)
    if hi != 0 {
        return 0, errors.New("overflow")
    }
    return lo, nil
}
```

**Signed overflow in length calculations:**
```go
// If length is int32 and someone passes MaxInt32+1 as a count
// Result wraps negative → panics in make() with "negative length"
// This is a denial-of-service, not a buffer overflow
```

---

### Q21: How does `sync/atomic` work with integers? When should you use it vs. mutex?

**Answer:**

`sync/atomic` provides lock-free operations that compile to single CPU instructions:

```go
import "sync/atomic"

var counter int64

// Increment (maps to LOCK XADDQ or LOCK INCQ)
atomic.AddInt64(&counter, 1)

// Load without tearing (maps to MOV with memory barrier)
val := atomic.LoadInt64(&counter)

// Store with fence
atomic.StoreInt64(&counter, 0)

// Compare-and-swap (maps to LOCK CMPXCHGQ)
old, new := int64(5), int64(10)
swapped := atomic.CompareAndSwapInt64(&counter, old, new)
```

**When to use atomic vs. mutex:**

| Scenario | atomic | mutex |
|----------|--------|-------|
| Single variable read/write | ✅ | overkill |
| Multiple related variables | ❌ | ✅ |
| Complex logic with integer | ❌ | ✅ |
| High-frequency counter | ✅ | contention issues |
| Sharded counter (most scalable) | ✅ with padding | — |

**Cache line padding for high-concurrency counters:**
```go
type PaddedCounter struct {
    value int64
    _     [56]byte  // fill to 64 bytes (cache line)
}
```

---

### Q22: Explain struct memory alignment and how to optimize integer field layout.

**Answer:**
The Go runtime aligns struct fields to their natural alignment. Misalignment causes padding waste.

**Rule:** A field of size N must be placed at an address divisible by N (or 8, whichever is smaller).

```go
// Unoptimized: 24 bytes
type Bad struct {
    a bool    // 1 byte + 7 padding
    b int64   // 8 bytes
    c bool    // 1 byte + 7 padding
}

// Optimized: 10 bytes (+ 6 padding to 16)
type Good struct {
    b int64   // 8 bytes
    a bool    // 1 byte
    c bool    // 1 byte
    // 6 bytes padding (to align next struct)
}
```

**Checking at runtime:**
```go
fmt.Println(unsafe.Sizeof(Bad{}))   // 24
fmt.Println(unsafe.Sizeof(Good{}))  // 16
```

**General rule:** Order fields **largest to smallest** to minimize padding.

Tools: `go vet` (with `fieldalignment` analyzer), `betteralign` linter.

---

### Q23: What is the difference between arithmetic overflow detection strategies?

**Answer:**
Go provides several approaches to handle potential overflow:

**1. Panic on overflow (development/safety):**
```go
func addSafe(a, b int64) int64 {
    if b > 0 && a > math.MaxInt64-b {
        panic("overflow")
    }
    if b < 0 && a < math.MinInt64-b {
        panic("overflow")
    }
    return a + b
}
```

**2. Return error (production APIs):**
```go
func addChecked(a, b int64) (int64, error) {
    result := a + b
    // Two's complement: overflow flips sign unexpectedly
    if (b > 0 && result < a) || (b < 0 && result > a) {
        return 0, ErrOverflow
    }
    return result, nil
}
```

**3. Saturating arithmetic (multimedia, signal processing):**
```go
func addSat(a, b int64) int64 {
    sum, carry := bits.Add64(uint64(a), uint64(b), 0)
    if carry != 0 || (a^sum)&(b^sum) < 0 {
        if a < 0 {
            return math.MinInt64
        }
        return math.MaxInt64
    }
    return int64(sum)
}
```

**4. Arbitrary precision (correctness over performance):**
```go
import "math/big"

func addBig(a, b int64) *big.Int {
    x := big.NewInt(a)
    y := big.NewInt(b)
    return new(big.Int).Add(x, y)
}
```

---

## Scenario-Based

### Q24: You're writing a high-traffic web server. User IDs come from a PostgreSQL `BIGINT` column (64-bit). What type do you use and why?

**Answer:**
Use `int64` (or a domain type `type UserID int64`).

**Reasoning:**

1. PostgreSQL `BIGINT` = 64-bit signed integer. Must use `int64` to avoid overflow.
2. Using `int` is dangerous: on a 32-bit server (or in tests), `int` is 32-bit and overflows at ~2 billion users.
3. Domain type adds type safety:

```go
type UserID int64
type PostID int64

// Compile error: cannot pass PostID where UserID expected
func GetUser(id UserID) (*User, error) { ... }
```

**In practice:**
```go
// database/sql scanning
var id int64
row.Scan(&id)
user := User{ID: UserID(id)}

// JSON: works fine
// {"id": 9007199254740993} — but JS loses precision above 2^53!
// For JS clients, send as string:
type User struct {
    ID UserID `json:"id,string"`
}
```

---

### Q25: A colleague's code sporadically crashes with "index out of range". The index is computed from user input. How do you debug this?

**Answer:**

Step 1: Look for integer overflow in index computation:
```go
// Common bug: int32 overflow
func getItem(offset int32, limit int32) []Item {
    end := offset + limit  // overflows if offset=MaxInt32
    return items[offset:end]  // panic
}
```

Step 2: Look for signed/unsigned conversion:
```go
// Bug: user sends negative offset, gets converted to huge uint
func getPage(offset uint64) []Item {
    idx := int(offset)  // if offset > MaxInt, wraps negative
    return items[idx:]  // panic
}
```

Step 3: Validate all inputs:
```go
func getItems(offset, limit int64) ([]Item, error) {
    if offset < 0 || limit < 0 {
        return nil, ErrInvalidInput
    }
    if offset > int64(len(items)) {
        return nil, ErrOutOfRange
    }
    end := offset + limit
    if end > int64(len(items)) {
        end = int64(len(items))
    }
    return items[offset:end], nil
}
```

Step 4: Add fuzzing to catch edge cases:
```go
func FuzzGetItems(f *testing.F) {
    f.Add(int64(0), int64(10))
    f.Fuzz(func(t *testing.T, offset, limit int64) {
        _, err := getItems(offset, limit)
        _ = err // should never panic
    })
}
```

---

### Q26: You need to implement a rate limiter that tracks request counts per user. What integer type and data structure do you choose?

**Answer:**

```go
import (
    "sync"
    "sync/atomic"
    "time"
)

// Option 1: Atomic int64 per user (lock-free, good for hot paths)
type RateLimiter struct {
    counts sync.Map  // map[UserID]*int64
    limit  int64
    window time.Duration
}

func (rl *RateLimiter) Allow(userID UserID) bool {
    val, _ := rl.counts.LoadOrStore(userID, new(int64))
    count := val.(*int64)
    return atomic.AddInt64(count, 1) <= rl.limit
}

// Option 2: Token bucket with int64 tokens (more precise)
type TokenBucket struct {
    mu       sync.Mutex
    tokens   int64
    maxToken int64
    refillAt time.Time
}

func (tb *TokenBucket) Take() bool {
    tb.mu.Lock()
    defer tb.mu.Unlock()
    if tb.tokens <= 0 {
        return false
    }
    tb.tokens--
    return true
}
```

**Type choices:**
- `int64` for token counts: future-proofs against large limits, no overflow risk
- `int32` is risky: limit of ~2 billion seems huge but rate limiters can accumulate
- `uint64` for counts that should never go negative (but then underflow is silent)

---

### Q27: Implement a function that safely converts a `string` to `int64` with overflow detection.

**Answer:**

```go
import (
    "errors"
    "math"
    "strconv"
)

var (
    ErrNotANumber = errors.New("not a number")
    ErrOverflow   = errors.New("value exceeds int64 range")
    ErrUnderflow  = errors.New("value below int64 range")
)

func ParseInt64Safe(s string) (int64, error) {
    n, err := strconv.ParseInt(s, 10, 64)
    if err != nil {
        numErr, ok := err.(*strconv.NumError)
        if !ok {
            return 0, ErrNotANumber
        }
        switch numErr.Err {
        case strconv.ErrRange:
            // Determine overflow vs underflow from original string
            if len(s) > 0 && s[0] == '-' {
                return 0, ErrUnderflow
            }
            return 0, ErrOverflow
        default:
            return 0, ErrNotANumber
        }
    }
    return n, nil
}

// Usage:
val, err := ParseInt64Safe("9223372036854775808")  // MaxInt64+1
// returns 0, ErrOverflow

val, err = ParseInt64Safe("-9223372036854775809")  // MinInt64-1
// returns 0, ErrUnderflow
```

---

## FAQ

### Q28: Should I use `int` or `int64` for function parameters?

**Short answer:** Use `int` for local computations and indices; use `int64` for persistent data.

**Detailed:**
- `int` is the idiomatic choice for most Go code — it's what `len()`, slice indices, and loop counters use
- `int64` is appropriate when the value represents something stored in a database, serialized to disk, or sent over a network where the exact size matters
- Avoid `int32` unless you have a specific reason (matching an external API, reducing memory in large slices)

---

### Q29: Why doesn't Go have `++i` (prefix increment)?

**Answer:**
Go only supports postfix `i++` and `i--`, and they are **statements**, not expressions. This was a deliberate design decision to avoid confusing expressions like `a[i++] = b[++i]`.

```go
i := 0
i++  // statement, OK
// ++i   // compile error: syntax error

// Cannot use as expression:
// j := i++  // compile error
```

---

### Q30: What is the maximum safe integer that can be exactly represented as `float64`?

**Answer:**
`float64` has a 52-bit mantissa, so it can represent integers exactly up to **2⁵³ = 9,007,199,254,740,992**.

```go
const maxSafeFloat64Int = 1 << 53  // 9007199254740992

f := float64(maxSafeFloat64Int)
fmt.Println(int64(f) == maxSafeFloat64Int)   // true

f2 := float64(maxSafeFloat64Int + 1)
fmt.Println(int64(f2) == maxSafeFloat64Int+1) // false! precision lost
```

This is why you should **never use float64 for large integer IDs** (e.g., Twitter/Facebook user IDs are > 2⁵³, causing JavaScript clients to lose precision when parsed as JSON numbers).

---

### Q31: How does Go's integer performance compare to C/C++?

**Answer:**
Modern Go integer performance is **comparable to C** for arithmetic-heavy code, with some differences:

**Advantages of Go:**
- Bounds checking optimized away by the compiler when provable
- `math/bits` maps to native CPU intrinsics (POPCNT, LZCNT, ADC)
- Register-based calling convention (Go 1.17+) — integers passed in registers

**Areas where C may be faster:**
- Explicit SIMD intrinsics (Go relies on auto-vectorization)
- `restrict` keyword (Go doesn't have aliasing guarantees)
- Integer division: same hardware, same performance

**Typical benchmark:** Integer-heavy Go code runs at 90-95% of equivalent C code speed, with the difference largely due to bounds checks (which prevent buffer overflows).

---

### Q32: When should I use `big.Int`?

**Answer:**
Use `math/big.Int` when:
1. Values exceed `int64` range (−9.2×10¹⁸ to 9.2×10¹⁸)
2. Cryptographic operations (RSA, ECDSA key sizes)
3. Exact arithmetic is required without overflow risk
4. Implementing arbitrary-precision algorithms

```go
import "math/big"

// RSA modulus: 2048-bit number
n := new(big.Int)
n.SetString("2519590847565789349402718324004839857142928212....", 10)

// Factorial of 100
result := new(big.Int).MulRange(1, 100)
fmt.Println(result)
// 93326215443944152681699238856266700490715968264381621468592963895217599993229915608941463976156518286253697920827223758251185210916864000000000000000000000000

// Power
base := big.NewInt(2)
exp := big.NewInt(100)
pow := new(big.Int).Exp(base, exp, nil)
```

**Cost:** `big.Int` is 5–50x slower than native integers and allocates heap memory. Use only when necessary.

---

### Q33: What is the `_` separator in integer literals and why use it?

**Answer:**
Go 1.13 introduced `_` as a digit separator for readability:

```go
// Hard to read:
const popUSA = 331000000
const maxInt64 = 9223372036854775807
const creditCard = 4532015112830366

// Easy to read:
const popUSA   = 331_000_000
const maxInt64 = 9_223_372_036_854_775_807
const creditCard = 4532_0151_1283_0366

// Binary: group by nibble or byte
const flags = 0b_1010_0011_0101_1001
// Hex: group by byte
const color = 0xFF_A0_32_00
// IPv4 address as hex
const loopback = 0x7F_00_00_01
```

Rules:
- `_` can appear between any two digits
- Cannot appear at the start or end: `_123` is an identifier, `123_` is invalid
- Cannot appear adjacent to the base prefix: `0x_FF` is invalid (Go 1.13+, `0x_FF` is actually allowed between prefix and digits)

---
