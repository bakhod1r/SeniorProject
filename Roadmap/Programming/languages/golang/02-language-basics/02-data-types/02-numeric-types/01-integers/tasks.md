# Go Integer Types — Practical Tasks

## Overview

10 hands-on tasks covering integer types, arithmetic, bitwise operations, overflow safety, and real-world patterns. Each task includes starter code with `// TODO` markers, expected output, and an evaluation checklist.

**Prerequisites:** Go 1.21+, basic familiarity with Go syntax.

---

## Task 1 — Explore Integer Type Ranges 🟢

**Goal:** Print the min/max values for all signed and unsigned integer types using the `math` package constants.

**Starter code:**
```go
package main

import (
    "fmt"
    "math"
)

func main() {
    // TODO: Print min/max for int8, int16, int32, int64
    // TODO: Print max for uint8, uint16, uint32, uint64
    // TODO: Print the size of int on this platform (unsafe.Sizeof)
    // TODO: Print whether int is 32-bit or 64-bit
    
    fmt.Println("math.MaxInt8 =", math.MaxInt8)
    // ... continue for all types
}
```

**Expected output (on 64-bit system):**
```
int8:   min=-128, max=127
int16:  min=-32768, max=32767
int32:  min=-2147483648, max=2147483647
int64:  min=-9223372036854775808, max=9223372036854775807
uint8:  max=255
uint16: max=65535
uint32: max=4294967295
uint64: max=18446744073709551615
int size: 8 bytes (64-bit)
```

**Evaluation checklist:**
- [ ] Uses `math.MinInt8`, `math.MaxInt8`, etc. (not hardcoded numbers)
- [ ] Correctly uses `unsafe.Sizeof` for platform int size
- [ ] Handles both signed and unsigned types
- [ ] Output clearly labels each type

---

## Task 2 — Integer Literal Formats 🟢

**Goal:** Write a function that takes a number and prints it in all 4 bases (decimal, binary, octal, hex). Then use integer literals in each base and verify they're equal.

**Starter code:**
```go
package main

import "fmt"

// TODO: printAllBases prints n in decimal, binary, octal, and hex
func printAllBases(n int) {
    // TODO: use fmt.Printf format verbs: %d, %b, %o, %x, %X
}

func main() {
    // TODO: demonstrate that these all represent the same number
    dec  := 255
    bin  := 0b_1111_1111
    oct  := 0o377
    hex  := 0xFF
    
    // TODO: verify they're all equal
    // TODO: print using printAllBases(255)
    
    // TODO: use underscore separators for readability
    million := 1_000_000
    fmt.Println("Million:", million)
}
```

**Expected output:**
```
255 in all bases:
  decimal: 255
  binary:  11111111
  octal:   377
  hex:     ff  (or FF)
All equal: true
Million: 1000000
```

**Evaluation checklist:**
- [ ] Uses `%d`, `%b`, `%o`, `%x` format verbs
- [ ] Demonstrates all four literal formats (`0b`, `0o`, `0x`, decimal)
- [ ] Verifies equality between different representations
- [ ] Uses `_` separator for readability
- [ ] Prints with proper labels

---

## Task 3 — Integer Overflow Demonstration 🟢

**Goal:** Demonstrate overflow behavior for both signed and unsigned integers. Show how overflow wraps around and how to detect it.

**Starter code:**
```go
package main

import (
    "fmt"
    "math"
    "math/bits"
)

func main() {
    // TODO: Show int8 overflow: start at 127, add 1
    var x int8 = math.MaxInt8
    // TODO: print x, then x+1 showing wrap
    
    // TODO: Show uint8 underflow: start at 0, subtract 1
    var u uint8 = 0
    // TODO: print u, then u-1 showing wrap
    
    // TODO: Show overflow detection using math/bits
    a, b := uint64(math.MaxUint64), uint64(1)
    sum, carry := bits.Add64(a, b, 0)
    // TODO: print sum and carry to show overflow was detected
    
    // TODO: Show the bit pattern of -1 for int8 (should be 0xFF = 255)
    var neg int8 = -1
    // TODO: print neg as signed decimal and as unsigned hex
}
```

**Expected output:**
```
int8 overflow:
  before: 127 (0b01111111)
  after:  -128 (0b10000000)

uint8 underflow:
  before: 0 (0b00000000)
  after:  255 (0b11111111)

uint64 overflow detection:
  18446744073709551615 + 1 = 0, carry=1 (overflow detected!)

int8(-1) bit pattern: 0xff (same as uint8(255))
```

**Evaluation checklist:**
- [ ] Correctly shows signed integer wraps from max to min
- [ ] Correctly shows unsigned underflow wraps from 0 to max
- [ ] Uses `math/bits.Add64` for overflow detection
- [ ] Shows two's complement: `-1` has all bits set
- [ ] Uses binary and hex format verbs for bit pattern display

---

## Task 4 — Bitwise Operations and Flags 🟡

**Goal:** Implement a simple permission system using bit flags with `iota`.

**Starter code:**
```go
package main

import (
    "fmt"
    "strings"
)

type Permission uint8

const (
    // TODO: Define Read, Write, Execute, Admin using iota and bit shifts
    // Read    Permission = ?
    // Write   Permission = ?
    // Execute Permission = ?
    // Admin   Permission = ?
)

// TODO: String() method for Permission
func (p Permission) String() string {
    // Should return something like "Read|Write" or "none"
    return ""
}

// TODO: HasPermission checks if p contains all required permissions
func HasPermission(user, required Permission) bool {
    return false // TODO
}

// TODO: Grant adds a permission
func Grant(user *Permission, perm Permission) {
    // TODO
}

// TODO: Revoke removes a permission
func Revoke(user *Permission, perm Permission) {
    // TODO
}

func main() {
    var userPerm Permission
    
    Grant(&userPerm, Read)
    Grant(&userPerm, Write)
    fmt.Println("After grant Read|Write:", userPerm)
    
    fmt.Println("Has Read?", HasPermission(userPerm, Read))
    fmt.Println("Has Admin?", HasPermission(userPerm, Admin))
    fmt.Println("Has Read|Write?", HasPermission(userPerm, Read|Write))
    
    Revoke(&userPerm, Write)
    fmt.Println("After revoke Write:", userPerm)
    
    // Show admin has all permissions
    admin := Read | Write | Execute | Admin
    fmt.Println("Admin perms:", admin)
}
```

**Expected output:**
```
After grant Read|Write: Read|Write
Has Read? true
Has Admin? false
Has Read|Write? true
After revoke Write: Read
Admin perms: Read|Write|Execute|Admin
```

**Evaluation checklist:**
- [ ] Uses `1 << iota` for power-of-two flags
- [ ] `HasPermission` uses bitwise AND correctly: `user & required == required`
- [ ] `Grant` uses `|=` (OR-assign)
- [ ] `Revoke` uses `&^=` (AND NOT — bit clear)
- [ ] `String()` method builds readable representation
- [ ] None of the values clash (each is a distinct bit)

---

## Task 5 — Safe Integer Arithmetic 🟡

**Goal:** Implement a library of safe arithmetic functions that return errors on overflow.

**Starter code:**
```go
package main

import (
    "errors"
    "fmt"
    "math"
)

var ErrOverflow = errors.New("integer overflow")

// TODO: SafeAdd returns a+b or ErrOverflow
func SafeAdd(a, b int64) (int64, error) {
    return 0, nil // TODO
}

// TODO: SafeMul returns a*b or ErrOverflow
func SafeMul(a, b int64) (int64, error) {
    return 0, nil // TODO
}

// TODO: SafeSub returns a-b or ErrOverflow
func SafeSub(a, b int64) (int64, error) {
    return 0, nil // TODO
}

func main() {
    // Test normal operations
    sum, err := SafeAdd(100, 200)
    fmt.Printf("100 + 200 = %d, err=%v\n", sum, err)
    
    // Test overflow
    _, err = SafeAdd(math.MaxInt64, 1)
    fmt.Printf("MaxInt64 + 1: err=%v\n", err)
    
    // Test multiplication
    prod, err := SafeMul(1000000, 1000000)
    fmt.Printf("1M * 1M = %d, err=%v\n", prod, err)
    
    _, err = SafeMul(math.MaxInt64/2, 3)
    fmt.Printf("MaxInt64/2 * 3: err=%v\n", err)
    
    // Test subtraction underflow
    _, err = SafeSub(math.MinInt64, 1)
    fmt.Printf("MinInt64 - 1: err=%v\n", err)
}
```

**Expected output:**
```
100 + 200 = 300, err=<nil>
MaxInt64 + 1: err=integer overflow
1M * 1M = 1000000000000, err=<nil>
MaxInt64/2 * 3: err=integer overflow
MinInt64 - 1: err=integer overflow
```

**Evaluation checklist:**
- [ ] `SafeAdd` checks: `b > 0 && a > MaxInt64-b` OR `b < 0 && a < MinInt64-b`
- [ ] `SafeMul` handles: both negatives, mixed signs, zero case
- [ ] `SafeSub` delegates to `SafeAdd(a, -b)` or has equivalent logic
- [ ] All three return `ErrOverflow` (sentinel error, not a new error each time)
- [ ] Zero and negative inputs handled correctly

---

## Task 6 — Integer Division and Modulo 🟡

**Goal:** Implement and test both truncated (Go default) and Euclidean division/modulo. Demonstrate the difference with negative numbers.

**Starter code:**
```go
package main

import "fmt"

// TODO: TruncDiv performs truncated division (Go's default behavior)
// Returns quotient, remainder where remainder has sign of dividend
func TruncDiv(a, b int) (int, int) {
    return 0, 0 // TODO: use / and %
}

// TODO: EuclidDiv performs Euclidean division
// Returns quotient, remainder where remainder is always >= 0
func EuclidDiv(a, b int) (int, int) {
    return 0, 0 // TODO
}

// TODO: Implement circular day-of-week advancement
// Given a day (0=Sun, 6=Sat) and days to advance (can be negative),
// return the resulting day using Euclidean modulo
func DayOfWeek(day, advance int) int {
    return 0 // TODO
}

func main() {
    pairs := [][2]int{{7, 3}, {-7, 3}, {7, -3}, {-7, -3}}
    
    fmt.Println("Truncated Division (Go default):")
    for _, p := range pairs {
        q, r := TruncDiv(p[0], p[1])
        fmt.Printf("  %3d / %2d = %2d  remainder %2d\n", p[0], p[1], q, r)
    }
    
    fmt.Println("\nEuclidean Division:")
    for _, p := range pairs {
        q, r := EuclidDiv(p[0], p[1])
        fmt.Printf("  %3d / %2d = %2d  remainder %2d\n", p[0], p[1], q, r)
    }
    
    // Day of week test
    fmt.Println("\nDay of Week (0=Sun, 6=Sat):")
    fmt.Printf("  Wednesday(3) + 5 days = day %d\n", DayOfWeek(3, 5))   // Monday=1
    fmt.Printf("  Monday(1) - 3 days = day %d\n", DayOfWeek(1, -3))     // Friday=5
}
```

**Expected output:**
```
Truncated Division (Go default):
     7 /  3 =  2  remainder  1
    -7 /  3 = -2  remainder -1
     7 / -3 = -2  remainder  1
    -7 / -3 =  2  remainder -1

Euclidean Division:
     7 /  3 =  2  remainder 1
    -7 /  3 = -3  remainder 2
     7 / -3 = -2  remainder 1
    -7 / -3 =  3  remainder 2

Day of Week (0=Sun, 6=Sat):
  Wednesday(3) + 5 days = day 1
  Monday(1) - 3 days = day 5
```

**Evaluation checklist:**
- [ ] `TruncDiv` uses Go's built-in `/` and `%`
- [ ] `EuclidDiv` remainder is always non-negative
- [ ] `DayOfWeek` correctly handles negative advance values
- [ ] Euclidean remainder formula: `((a % b) + b) % b`
- [ ] Test cases cover all sign combinations

---

## Task 7 — Numeric Type Conversions 🟡

**Goal:** Implement a type-safe conversion package that detects truncation/overflow when converting between integer types.

**Starter code:**
```go
package main

import (
    "errors"
    "fmt"
    "math"
)

var ErrTruncation = errors.New("value truncated during conversion")

// TODO: Int64ToInt32 safely converts int64 to int32
func Int64ToInt32(n int64) (int32, error) {
    return 0, nil // TODO: check if n fits in int32
}

// TODO: Int64ToUint64 safely converts int64 to uint64  
func Int64ToUint64(n int64) (uint64, error) {
    return 0, nil // TODO: check if n is non-negative
}

// TODO: Uint64ToInt64 safely converts uint64 to int64
func Uint64ToInt64(n uint64) (int64, error) {
    return 0, nil // TODO: check if n <= MaxInt64
}

// TODO: IntToUint8 safely converts int to uint8 (byte)
func IntToUint8(n int) (uint8, error) {
    return 0, nil // TODO: check if 0 <= n <= 255
}

func main() {
    tests := []struct {
        name string
        fn   func() error
    }{
        {"int64(100) to int32", func() error {
            v, err := Int64ToInt32(100)
            fmt.Printf("  int64(100) → int32(%d): err=%v\n", v, err)
            return err
        }},
        {"MaxInt64 to int32", func() error {
            v, err := Int64ToInt32(math.MaxInt64)
            fmt.Printf("  MaxInt64 → int32(%d): err=%v\n", v, err)
            return err
        }},
        {"int64(-1) to uint64", func() error {
            v, err := Int64ToUint64(-1)
            fmt.Printf("  int64(-1) → uint64(%d): err=%v\n", v, err)
            return err
        }},
        {"uint64(MaxUint64) to int64", func() error {
            v, err := Uint64ToInt64(math.MaxUint64)
            fmt.Printf("  MaxUint64 → int64(%d): err=%v\n", v, err)
            return err
        }},
    }
    
    for _, tc := range tests {
        fmt.Printf("Test: %s\n", tc.name)
        tc.fn()
    }
}
```

**Expected output:**
```
Test: int64(100) to int32
  int64(100) → int32(100): err=<nil>
Test: MaxInt64 to int32
  MaxInt64 → int32(0): err=value truncated during conversion
Test: int64(-1) to uint64
  int64(-1) → uint64(0): err=value truncated during conversion
Test: uint64(MaxUint64) to int64
  MaxUint64 → int64(0): err=value truncated during conversion
```

**Evaluation checklist:**
- [ ] `Int64ToInt32`: checks `n >= math.MinInt32 && n <= math.MaxInt32`
- [ ] `Int64ToUint64`: checks `n >= 0`
- [ ] `Uint64ToInt64`: checks `n <= math.MaxInt64`
- [ ] `IntToUint8`: checks `n >= 0 && n <= math.MaxUint8`
- [ ] Returns zero value (not garbage) on error
- [ ] Uses sentinel `ErrTruncation` (not `fmt.Errorf`)

---

## Task 8 — Bit Manipulation Toolkit 🔴

**Goal:** Implement a toolkit of common bit manipulation functions, each mapping to efficient CPU instructions.

**Starter code:**
```go
package main

import (
    "fmt"
    "math/bits"
)

// TODO: PopCount returns the number of set bits in x (Hamming weight)
// Use math/bits.OnesCount64 internally
func PopCount(x uint64) int {
    return 0 // TODO
}

// TODO: IsPowerOfTwo returns true if x is a non-zero power of 2
// Hint: powers of 2 have exactly one bit set
func IsPowerOfTwo(x uint64) bool {
    return false // TODO: one-liner using & operator
}

// TODO: NextPowerOfTwo returns the smallest power of 2 >= x
// Hint: use bits.Len64
func NextPowerOfTwo(x uint64) uint64 {
    return 0 // TODO
}

// TODO: RotateLeft32 rotates bits left by k positions (wraps around)
// Use math/bits.RotateLeft32
func RotateLeft32(x uint32, k int) uint32 {
    return 0 // TODO
}

// TODO: Abs returns the absolute value of a signed int64
// Implement WITHOUT using an if statement (branchless)
// Hint: right-shift a signed int to get all-0 or all-1 mask
func Abs(x int64) int64 {
    return 0 // TODO: branchless using XOR and shift
}

// TODO: ReverseBits reverses all 64 bits of x
// Use math/bits.Reverse64
func ReverseBits(x uint64) uint64 {
    return 0 // TODO
}

func main() {
    fmt.Printf("PopCount(0b10110101) = %d\n", PopCount(0b10110101))    // 5
    fmt.Printf("PopCount(0) = %d\n", PopCount(0))                       // 0
    fmt.Printf("PopCount(0xFFFFFFFFFFFFFFFF) = %d\n", PopCount(^uint64(0))) // 64
    
    for _, v := range []uint64{0, 1, 2, 3, 4, 8, 16, 100} {
        fmt.Printf("IsPowerOfTwo(%3d) = %v\n", v, IsPowerOfTwo(v))
    }
    
    for _, v := range []uint64{0, 1, 5, 8, 9, 100, 128} {
        fmt.Printf("NextPowerOfTwo(%3d) = %d\n", v, NextPowerOfTwo(v))
    }
    
    fmt.Printf("RotateLeft32(0x12345678, 8) = 0x%X\n", RotateLeft32(0x12345678, 8))
    
    fmt.Printf("Abs(-42) = %d\n", Abs(-42))
    fmt.Printf("Abs(42)  = %d\n", Abs(42))
    fmt.Printf("Abs(0)   = %d\n", Abs(0))
    
    fmt.Printf("ReverseBits(0x0102030405060708) = 0x%016X\n", ReverseBits(0x0102030405060708))
}
```

**Expected output:**
```
PopCount(0b10110101) = 5
PopCount(0) = 0
PopCount(0xFFFFFFFFFFFFFFFF) = 64
IsPowerOfTwo(  0) = false
IsPowerOfTwo(  1) = true
IsPowerOfTwo(  2) = true
IsPowerOfTwo(  3) = false
IsPowerOfTwo(  4) = true
IsPowerOfTwo(  8) = true
IsPowerOfTwo( 16) = true
IsPowerOfTwo(100) = false
NextPowerOfTwo(  0) = 1
NextPowerOfTwo(  1) = 1
NextPowerOfTwo(  5) = 8
NextPowerOfTwo(  8) = 8
NextPowerOfTwo(  9) = 16
NextPowerOfTwo(100) = 128
NextPowerOfTwo(128) = 128
RotateLeft32(0x12345678, 8) = 0x34567812
Abs(-42) = 42
Abs(42)  = 42
Abs(0)   = 0
ReverseBits(0x0102030405060708) = 0x10E060402080400
```

**Evaluation checklist:**
- [ ] `PopCount` uses `bits.OnesCount64`
- [ ] `IsPowerOfTwo`: `x != 0 && (x & (x-1)) == 0`
- [ ] `NextPowerOfTwo`: handles x=0 and exact powers of 2 correctly
- [ ] `RotateLeft32` uses `bits.RotateLeft32`
- [ ] `Abs` branchless: `mask := x >> 63; return (x ^ mask) - mask`
- [ ] `ReverseBits` uses `bits.Reverse64`

---

## Task 9 — Domain Integer Types 🔴

**Goal:** Design a type-safe ID system using domain types to prevent misuse of IDs across different entities.

**Starter code:**
```go
package main

import (
    "errors"
    "fmt"
)

// TODO: Define domain types for UserID, PostID, CommentID
// All based on int64

// TODO: Define ErrInvalidID
var ErrInvalidID = errors.New("invalid ID: must be positive")

// TODO: NewUserID validates and creates a UserID
func NewUserID(n int64) (UserID, error) {
    return 0, nil // TODO: reject non-positive values
}

// User represents a user with typed ID
type User struct {
    ID   UserID
    Name string
}

// Post represents a post with typed ID
type Post struct {
    ID       PostID
    AuthorID UserID  // foreign key — different type!
    Title    string
}

// TODO: GetPostsByAuthor filters posts by UserID
// Note: PostID and UserID are different types, preventing mix-ups
func GetPostsByAuthor(posts []Post, authorID UserID) []Post {
    return nil // TODO
}

// TODO: UserIDToInt64 extracts the raw value (for database queries)
func UserIDToInt64(id UserID) int64 {
    return 0 // TODO
}

func main() {
    // Valid IDs
    uid, err := NewUserID(42)
    fmt.Printf("UserID(42): %d, err=%v\n", uid, err)
    
    // Invalid IDs
    _, err = NewUserID(0)
    fmt.Printf("UserID(0): err=%v\n", err)
    
    _, err = NewUserID(-1)
    fmt.Printf("UserID(-1): err=%v\n", err)
    
    // Type safety demonstration
    posts := []Post{
        {ID: 1, AuthorID: 42, Title: "Hello"},
        {ID: 2, AuthorID: 99, Title: "World"},
        {ID: 3, AuthorID: 42, Title: "Go is great"},
    }
    
    myPosts := GetPostsByAuthor(posts, uid)
    fmt.Printf("\nPosts by author %d:\n", uid)
    for _, p := range myPosts {
        fmt.Printf("  [%d] %s\n", p.ID, p.Title)
    }
    
    // This should NOT compile if you uncomment it:
    // var pid PostID = 42
    // GetPostsByAuthor(posts, pid)  // type mismatch: PostID vs UserID
    
    raw := UserIDToInt64(uid)
    fmt.Printf("\nRaw int64 for DB query: %d\n", raw)
}
```

**Expected output:**
```
UserID(42): 42, err=<nil>
UserID(0): err=invalid ID: must be positive
UserID(-1): err=invalid ID: must be positive

Posts by author 42:
  [1] Hello
  [3] Go is great

Raw int64 for DB query: 42
```

**Evaluation checklist:**
- [ ] `UserID`, `PostID`, `CommentID` are defined as `type X int64`
- [ ] `NewUserID` rejects `<= 0`
- [ ] `GetPostsByAuthor` parameter is `UserID`, not `int64`
- [ ] Commented-out code would actually fail to compile (verify by uncommenting)
- [ ] `UserIDToInt64` uses explicit type conversion: `return int64(id)`
- [ ] All three types are distinct — `UserID(1) == PostID(1)` does not compile

---

## Task 10 — Complete: Protocol Buffer Integer Encoder 🔴

**Goal:** Implement a minimal varint encoder/decoder (as used in Protocol Buffers) that efficiently encodes integers of varying sizes.

**Background:** Protocol Buffers use variable-length encoding. Small numbers take 1 byte; larger numbers take more. Each byte contributes 7 bits; the MSB indicates whether more bytes follow.

**Starter code:**
```go
package main

import (
    "bytes"
    "errors"
    "fmt"
)

var ErrBufferOverflow = errors.New("buffer overflow")
var ErrTruncated = errors.New("truncated varint")

// TODO: EncodeVarint encodes a uint64 as variable-length bytes
// Protocol: each byte uses 7 bits for data, MSB=1 means "more bytes follow"
// Example: 300 (0b100101100) → [0b10101100, 0b00000010] = [0xAC, 0x02]
func EncodeVarint(x uint64) []byte {
    return nil // TODO
}

// TODO: DecodeVarint decodes variable-length bytes back to uint64
// Returns the value and number of bytes consumed
// Returns ErrTruncated if data ends mid-varint
func DecodeVarint(data []byte) (uint64, int, error) {
    return 0, 0, nil // TODO
}

// TODO: ZigZagEncode encodes signed int64 as uint64
// Maps: 0→0, -1→1, 1→2, -2→3, 2→4, ...
// Formula: (n << 1) ^ (n >> 63)
func ZigZagEncode(n int64) uint64 {
    return 0 // TODO
}

// TODO: ZigZagDecode reverses ZigZagEncode
// Formula: (x >> 1) ^ -(x & 1)
func ZigZagDecode(x uint64) int64 {
    return 0 // TODO
}

func main() {
    testValues := []uint64{0, 1, 127, 128, 255, 300, 16383, 16384, 2097151}
    
    fmt.Println("Varint Encoding:")
    for _, v := range testValues {
        encoded := EncodeVarint(v)
        decoded, n, err := DecodeVarint(encoded)
        fmt.Printf("  %7d → %v (%d bytes) → %d  match=%v err=%v\n",
            v, encoded, n, decoded, v == decoded, err)
    }
    
    fmt.Println("\nZigZag Encoding (for signed integers):")
    signedTests := []int64{0, -1, 1, -2, 2, -128, 127, -2147483648}
    for _, v := range signedTests {
        enc := ZigZagEncode(v)
        dec := ZigZagDecode(enc)
        varint := EncodeVarint(enc)
        fmt.Printf("  %12d → zigzag=%d (%d bytes as varint) → %d\n",
            v, enc, len(varint), dec)
    }
    
    // Encode multiple values
    var buf bytes.Buffer
    for _, v := range []uint64{1, 150, 3, 270, 86942} {
        buf.Write(EncodeVarint(v))
    }
    
    fmt.Println("\nDecoding stream:")
    data := buf.Bytes()
    offset := 0
    for offset < len(data) {
        val, n, err := DecodeVarint(data[offset:])
        if err != nil {
            fmt.Printf("  error: %v\n", err)
            break
        }
        fmt.Printf("  value=%d (%d bytes)\n", val, n)
        offset += n
    }
}
```

**Expected output:**
```
Varint Encoding:
        0 → [0] (1 bytes) → 0  match=true err=<nil>
        1 → [1] (1 bytes) → 1  match=true err=<nil>
      127 → [127] (1 bytes) → 127  match=true err=<nil>
      128 → [128 1] (2 bytes) → 128  match=true err=<nil>
      255 → [255 1] (2 bytes) → 255  match=true err=<nil>
      300 → [172 2] (2 bytes) → 300  match=true err=<nil>
    16383 → [255 127] (2 bytes) → 16383  match=true err=<nil>
    16384 → [128 128 1] (3 bytes) → 16384  match=true err=<nil>
  2097151 → [255 255 127] (3 bytes) → 2097151  match=true err=<nil>

ZigZag Encoding (for signed integers):
           0 → zigzag=0 (1 bytes as varint) → 0
          -1 → zigzag=1 (1 bytes as varint) → -1
           1 → zigzag=2 (1 bytes as varint) → 1
          -2 → zigzag=3 (1 bytes as varint) → -2
           2 → zigzag=4 (1 bytes as varint) → 2
        -128 → zigzag=255 (2 bytes as varint) → -128
         127 → zigzag=254 (2 bytes as varint) → 127
 -2147483648 → zigzag=4294967295 (5 bytes as varint) → -2147483648

Decoding stream:
  value=1 (1 bytes)
  value=150 (2 bytes)
  value=3 (1 bytes)
  value=270 (3 bytes)
  value=86942 (3 bytes)
```

**Evaluation checklist:**
- [ ] `EncodeVarint`: loop shifts right by 7, sets MSB if `x > 0` remains
- [ ] `DecodeVarint`: accumulates 7-bit groups, stops when MSB=0
- [ ] `DecodeVarint`: returns `ErrTruncated` if data ends with MSB=1
- [ ] `ZigZagEncode`: `(n << 1) ^ (n >> 63)` — arithmetic right shift
- [ ] `ZigZagDecode`: `int64((x >> 1) ^ -(x & 1))` or equivalent
- [ ] Handles 0 correctly (encodes as single byte `[0]`)
- [ ] MaxUint64 encodes as 10 bytes (9×7-bit groups + 1 bit)

---

## Bonus Task — Benchmark Integer Operations

**Goal:** Write benchmarks comparing different integer operation strategies.

```go
package main_test

import (
    "math/bits"
    "testing"
)

var result int64

// BenchmarkDivision compares regular division with power-of-2 tricks
func BenchmarkDivByConstant(b *testing.B) {
    x := int64(1234567890)
    var r int64
    for i := 0; i < b.N; i++ {
        r = x / 7  // compiler replaces with multiply+shift
    }
    result = r
}

func BenchmarkDivByPow2(b *testing.B) {
    x := int64(1234567890)
    var r int64
    for i := 0; i < b.N; i++ {
        r = x >> 3  // divide by 8 (only for positive numbers)
    }
    result = r
}

// BenchmarkOnesCount compares manual popcount with hardware instruction
func BenchmarkOnesCountManual(b *testing.B) {
    x := uint64(0xDEADBEEFCAFEBABE)
    count := 0
    for i := 0; i < b.N; i++ {
        n := x
        c := 0
        for n != 0 {
            c += int(n & 1)
            n >>= 1
        }
        count = c
    }
    _ = count
}

func BenchmarkOnesCountIntrinsic(b *testing.B) {
    x := uint64(0xDEADBEEFCAFEBABE)
    count := 0
    for i := 0; i < b.N; i++ {
        count = bits.OnesCount64(x)
    }
    _ = count
}
```

Run with: `go test -bench=. -benchmem`

**Evaluation checklist:**
- [ ] Both benchmarks compile and run
- [ ] `OnesCountIntrinsic` is significantly faster (POPCNT instruction)
- [ ] `DivByConstant` and `DivByPow2` have similar performance (compiler optimization)
- [ ] Results are stored to prevent dead code elimination

---
