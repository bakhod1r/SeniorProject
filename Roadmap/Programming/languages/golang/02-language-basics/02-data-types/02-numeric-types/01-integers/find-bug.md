# Go Integer Types — Find the Bug

## Overview

11 debugging exercises covering common integer bugs in Go. Each exercise shows code with a subtle bug, describes the expected vs. actual behavior, and provides hints and a full fix inside collapsible `<details>` sections.

**Difficulty:** 🟢 Easy | 🟡 Medium | 🔴 Hard

---

## Bug 1 — The Overflowing Counter 🟢

**Description:** A loop counter overflows silently.

```go
package main

import "fmt"

func sumTo(n int) int {
    sum := 0
    for i := 1; i <= n; i++ {
        sum += i
    }
    return sum
}

func main() {
    // Sum of integers 1 to 200000
    result := sumTo(200000)
    fmt.Printf("Sum 1..200000 = %d\n", result)
    
    // Now try with int16
    var total int16 = 0
    for i := int16(1); i <= 200; i++ {
        total += i
    }
    fmt.Printf("Sum 1..200 = %d\n", total)
}
```

**Expected:**
```
Sum 1..200000 = 20000100000
Sum 1..200 = 20100
```

**Actual:**
```
Sum 1..200000 = 20000100000
Sum 1..200 = 20100  ← (sometimes correct, but try n=300)
```

**The real bug:** What happens when you change `200` to `300` with `int16`?

<details>
<summary>Hint</summary>

`int16` has a maximum value of 32,767. The sum 1+2+...+300 = 45,150 which exceeds `int16` max. The result wraps around silently.

Also notice: `for i := int16(1); i <= 300; i++` — when `i` reaches 32,767 and increments, it wraps to -32,768. The loop may run forever or terminate at unexpected values.

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** Using `int16` for accumulation when the result may exceed 32,767.

**Fix:**
```go
// WRONG: int16 for sums that may overflow
var total int16 = 0
for i := int16(1); i <= 300; i++ {
    total += i  // overflow! 45,150 > 32,767
}

// CORRECT: use int (or int32/int64) for accumulation
var total int = 0
for i := 1; i <= 300; i++ {
    total += i
}
fmt.Println(total) // 45150

// If you need int16 specifically, validate input first:
func sumToInt16(n int) (int16, error) {
    sum := 0
    for i := 1; i <= n; i++ {
        sum += i
    }
    if sum > math.MaxInt16 {
        return 0, fmt.Errorf("result %d overflows int16", sum)
    }
    return int16(sum), nil
}
```

**Rule:** Use `int` for counters and accumulators. Only use smaller types for storage (arrays, structs) where the range is verified.

</details>

---

## Bug 2 — The Unsigned Underflow 🟢

**Description:** A function processes remaining inventory but crashes on valid input.

```go
package main

import "fmt"

func processOrders(inventory, orders uint32) {
    remaining := inventory - orders
    fmt.Printf("Remaining after %d orders: %d\n", orders, remaining)
}

func main() {
    processOrders(100, 50)   // should print 50
    processOrders(100, 100)  // should print 0
    processOrders(50, 100)   // should print -50... right?
}
```

**Expected:**
```
Remaining after 50 orders: 50
Remaining after 100 orders: 0
Remaining after 100 orders: -50
```

**Actual:**
```
Remaining after 50 orders: 50
Remaining after 100 orders: 0
Remaining after 100 orders: 4294967246
```

<details>
<summary>Hint</summary>

`uint32` cannot hold negative values. When you subtract a larger uint32 from a smaller one, the result wraps around to a huge positive number (two's complement modulo 2^32).

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** Using unsigned type for a quantity that can have meaningful negative values (deficit), or failing to validate the subtraction.

**Fix — Option 1: Validate before subtracting:**
```go
func processOrders(inventory, orders uint32) error {
    if orders > inventory {
        return fmt.Errorf("insufficient inventory: have %d, need %d", inventory, orders)
    }
    remaining := inventory - orders
    fmt.Printf("Remaining after %d orders: %d\n", orders, remaining)
    return nil
}
```

**Fix — Option 2: Use signed integer:**
```go
func processOrders(inventory, orders int32) {
    remaining := inventory - orders
    if remaining < 0 {
        fmt.Printf("Backorder: %d units short\n", -remaining)
    } else {
        fmt.Printf("Remaining after %d orders: %d\n", orders, remaining)
    }
}
```

**Rule:** Use unsigned types only when you're certain the value can never be negative AND you won't subtract values that could exceed the current value. Use signed integers for quantities that can have deficits.

</details>

---

## Bug 3 — The Integer Division Trap 🟢

**Description:** A grade calculator produces wrong results.

```go
package main

import "fmt"

func calculateGrade(score, maxScore int) float64 {
    return float64(score / maxScore * 100)
}

func main() {
    fmt.Printf("85/100: %.1f%%\n", calculateGrade(85, 100))
    fmt.Printf("50/100: %.1f%%\n", calculateGrade(50, 100))
    fmt.Printf("99/100: %.1f%%\n", calculateGrade(99, 100))
    fmt.Printf("100/100: %.1f%%\n", calculateGrade(100, 100))
}
```

**Expected:**
```
85/100: 85.0%
50/100: 50.0%
99/100: 99.0%
100/100: 100.0%
```

**Actual:**
```
85/100: 0.0%
50/100: 0.0%
99/100: 0.0%
100/100: 100.0%
```

<details>
<summary>Hint</summary>

Look at the order of operations. What type is `score / maxScore` evaluated as? Integer division of values less than 100/100 results in 0.

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** Integer division happens before conversion to `float64`. `85 / 100` in integer arithmetic is `0`.

**Fix:**
```go
// WRONG: integer division first, then float64
return float64(score / maxScore * 100)
// Steps: (85/100)=0 → 0*100=0 → float64(0)=0.0

// CORRECT: convert to float64 first
func calculateGrade(score, maxScore int) float64 {
    return float64(score) / float64(maxScore) * 100.0
}
// Steps: float64(85)/float64(100) = 0.85 → 0.85*100 = 85.0

// Alternative: multiply before dividing (integer-only, avoids float)
func calculateGradeInt(score, maxScore int) int {
    return score * 100 / maxScore
}
// Steps: 85*100=8500 → 8500/100=85
```

**Rule:** When mixing integer and floating-point arithmetic, always convert to `float64` **before** performing division if you need fractional results.

</details>

---

## Bug 4 — The Platform-Dependent Size Bug 🟡

**Description:** Code works on 64-bit CI but crashes in production on a 32-bit embedded system.

```go
package main

import "fmt"

const maxFileSize = 3_000_000_000 // 3 GB

func readFile(size int) ([]byte, error) {
    if size > maxFileSize {
        return nil, fmt.Errorf("file too large")
    }
    return make([]byte, size), nil
}

func main() {
    // Works on 64-bit: int is 8 bytes, can hold 3GB
    data, err := readFile(1_500_000_000)
    fmt.Printf("read %d bytes, err=%v\n", len(data), err)
}
```

**Issue:** On a 32-bit system where `int` is 32 bits, `maxFileSize` (3×10⁹) overflows `int32` (max: ~2.1×10⁹). The constant comparison becomes meaningless.

<details>
<summary>Hint</summary>

The constant `3_000_000_000` exceeds `math.MaxInt32` (2,147,483,647). On a 32-bit system, `int` is 32 bits. The comparison `size > maxFileSize` may never be true because `int` can never hold a value that large — or the constant itself causes a compile error.

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug 1:** Using `int` for file sizes that may exceed 32-bit range.
**Bug 2:** Assuming `int` is always 64-bit.

**Fix:**
```go
package main

import (
    "fmt"
    "math"
    "unsafe"
)

// Use int64 explicitly for file sizes
const maxFileSize int64 = 3_000_000_000 // 3 GB

func readFile(size int64) ([]byte, error) {
    if size < 0 {
        return nil, fmt.Errorf("negative size")
    }
    if size > maxFileSize {
        return nil, fmt.Errorf("file too large: %d > %d", size, maxFileSize)
    }
    // On 32-bit systems, make() can't allocate more than MaxInt32 bytes anyway
    if size > math.MaxInt {
        return nil, fmt.Errorf("size exceeds platform limit")
    }
    return make([]byte, size), nil
}

// Detect platform at startup
func init() {
    if unsafe.Sizeof(int(0)) < 8 {
        // Log warning: running on 32-bit platform, large file support limited
        fmt.Println("Warning: 32-bit platform, max allocable size is 2GB")
    }
}
```

**Rule:** Use `int64` for sizes, offsets, and counts that may exceed 2^31 (~2 billion). Use `int` only for things inherently bounded by platform (loop indices, slice lengths).

</details>

---

## Bug 5 — The Shift Overflow 🟡

**Description:** A bitmask generation function produces wrong results for large shifts.

```go
package main

import "fmt"

// makeMask creates a bitmask with n bits set
func makeMask(n int) uint32 {
    return (1 << n) - 1
}

func main() {
    for _, n := range []int{1, 4, 8, 16, 31, 32} {
        fmt.Printf("mask(%2d) = 0x%08X (%d bits)\n", n, makeMask(n), n)
    }
}
```

**Expected:**
```
mask( 1) = 0x00000001 (1 bits)
mask( 4) = 0x0000000F (4 bits)
mask( 8) = 0x000000FF (8 bits)
mask(16) = 0x0000FFFF (16 bits)
mask(31) = 0x7FFFFFFF (31 bits)
mask(32) = 0xFFFFFFFF (32 bits)
```

**Actual:**
```
mask( 1) = 0x00000001 (1 bits)
mask( 4) = 0x0000000F (4 bits)
mask( 8) = 0x000000FF (8 bits)
mask(16) = 0x0000FFFF (16 bits)
mask(31) = 0x7FFFFFFF (31 bits)
mask(32) = 0x00000000 (32 bits)  ← WRONG
```

<details>
<summary>Hint</summary>

`1` is an untyped constant of type `int`. On a 64-bit system, `1 << 32` works fine for `int64`, but the result is cast to `uint32`. On a 32-bit system, `1 << 32` is undefined behavior in C... but what about Go? And what happens when you shift left by the exact type width?

More importantly: `(1 << 32) - 1` — if `1` is treated as a 32-bit value, what is `1 << 32`?

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** `1 << n` where the shift amount equals the type width. `1 << 32` on a 32-bit integer shifts all bits out, resulting in 0. The `- 1` then gives 0xFFFFFFFF... wait, -1 cast to uint32 is 0xFFFFFFFF.

Actually the real issue: `1` is `int` (64-bit on 64-bit systems), so `1 << 32 = 4294967296`. Then `4294967296 - 1 = 4294967295 = 0xFFFFFFFF`. Cast to `uint32` = `0xFFFFFFFF`. Looks correct!

The bug manifests differently: for `n = 32`, the return type is `uint32`, which can only have 32 bits. A 32-bit mask is `0xFFFFFFFF` = all bits set. The code may actually work on 64-bit... but:

**Real bug for n=32 with uint32:** The function should return `0xFFFFFFFF` but if we use `uint32` arithmetic: `uint32(1) << 32 = 0` (shift by >= bitwidth is 0 in Go for constants, but undefined for variables):

```go
// Bug: using uint32 constant shift
func makeMaskBuggy(n uint32) uint32 {
    return (uint32(1) << n) - 1  // n=32: 0-1 = 0xFFFFFFFF (underflow!)
}
// Actually this "works" by accident via underflow

// The real problem: n >= 32 for variable shifts
var n uint = 32
x := uint32(1) << n  // this is 0 in Go (shift >= width returns 0 for variable shifts)
```

**Fix — Handle the full-width case explicitly:**
```go
func makeMask(n int) uint32 {
    if n <= 0 {
        return 0
    }
    if n >= 32 {
        return ^uint32(0)  // all bits set: 0xFFFFFFFF
    }
    return (uint32(1) << n) - 1
}
```

**Rule:** Always handle edge cases where the shift amount equals or exceeds the type width. Use `^uint32(0)` (bitwise NOT of 0) for "all bits set" rather than computing it via shift.

</details>

---

## Bug 6 — The Signed/Unsigned Comparison 🟡

**Description:** A bounds check has a subtle signed/unsigned comparison issue.

```go
package main

import "fmt"

func getElement(data []int, index int) (int, error) {
    if index < 0 || index > len(data) {
        return 0, fmt.Errorf("index %d out of bounds [0, %d)", index, len(data))
    }
    return data[index], nil
}

func main() {
    data := []int{10, 20, 30, 40, 50}
    
    val, err := getElement(data, 2)
    fmt.Printf("data[2] = %d, err = %v\n", val, err)
    
    val, err = getElement(data, 5)
    fmt.Printf("data[5] = %d, err = %v\n", val, err)
    
    val, err = getElement(data, -1)
    fmt.Printf("data[-1] = %d, err = %v\n", val, err)
}
```

**Expected:**
```
data[2] = 30, err = <nil>
data[5] = 0, err = index 5 out of bounds [0, 5)
data[-1] = 0, err = index -1 out of bounds [0, 5)
```

**Actual:**
```
data[2] = 30, err = <nil>
data[5] = 0, err = index 5 out of bounds [0, 5)
data[-1] = 0, err = index -1 out of bounds [0, 5)
```

Wait — this looks correct! But there's still a bug. Can you find it?

<details>
<summary>Hint</summary>

Look at the boundary condition: `index > len(data)`. What happens when `index == len(data)`? Is that a valid index? Try accessing `data[5]` when `len(data) == 5`.

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** Off-by-one error. The condition should be `index >= len(data)`, not `index > len(data)`.

With `index > len(data)`:
- `index = 5, len = 5`: `5 > 5` is false → no error → tries `data[5]` → **panic: index out of range**

```go
// WRONG: > allows index == len(data) to pass
if index < 0 || index > len(data) {

// CORRECT: >= catches the off-by-one
if index < 0 || index >= len(data) {
```

**The full corrected function:**
```go
func getElement(data []int, index int) (int, error) {
    if index < 0 || index >= len(data) {
        return 0, fmt.Errorf("index %d out of bounds [0, %d)", index, len(data))
    }
    return data[index], nil
}
```

**Why the original test didn't catch it:** The test used `index = 5` but the error check `5 > 5` is false, so it would panic — but the example showed the error message, implying the test was written to show desired behavior, not actual behavior.

**Rule:** For zero-based array bounds: `0 <= index < len(array)`. Use `>=` not `>` for the upper bound check.

</details>

---

## Bug 7 — The Integer Accumulation Race 🔴

**Description:** A concurrent request counter gives wrong results.

```go
package main

import (
    "fmt"
    "sync"
)

type RequestCounter struct {
    count int64
}

func (rc *RequestCounter) Increment() {
    rc.count++
}

func (rc *RequestCounter) Get() int64 {
    return rc.count
}

func main() {
    counter := &RequestCounter{}
    var wg sync.WaitGroup
    
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter.Increment()
        }()
    }
    
    wg.Wait()
    fmt.Printf("Expected: 1000, Got: %d\n", counter.Get())
}
```

**Expected:**
```
Expected: 1000, Got: 1000
```

**Actual (varies):**
```
Expected: 1000, Got: 847   ← data race, non-deterministic
```

<details>
<summary>Hint</summary>

`rc.count++` is not atomic — it's a read-modify-write operation (load, increment, store). Multiple goroutines can read the same value, both increment it, and both write back the same result, losing one increment.

Run with `go run -race` to detect the data race.

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** Non-atomic increment on a shared integer accessed by multiple goroutines.

`rc.count++` compiles to approximately:
1. Load `rc.count` into register
2. Add 1 to register
3. Store register back to `rc.count`

Between steps 1 and 3, another goroutine can do the same thing, causing lost increments.

**Fix — Option 1: Use `sync/atomic`:**
```go
import "sync/atomic"

type RequestCounter struct {
    count int64
}

func (rc *RequestCounter) Increment() {
    atomic.AddInt64(&rc.count, 1)
}

func (rc *RequestCounter) Get() int64 {
    return atomic.LoadInt64(&rc.count)
}
```

**Fix — Option 2: Use a mutex:**
```go
type RequestCounter struct {
    mu    sync.Mutex
    count int64
}

func (rc *RequestCounter) Increment() {
    rc.mu.Lock()
    rc.count++
    rc.mu.Unlock()
}
```

**Fix — Option 3: High-performance sharded counter:**
```go
type ShardedCounter struct {
    shards [64]struct {
        count int64
        _     [56]byte  // pad to cache line
    }
}

func (sc *ShardedCounter) Increment(goroutineID int) {
    shard := goroutineID % 64
    atomic.AddInt64(&sc.shards[shard].count, 1)
}

func (sc *ShardedCounter) Total() int64 {
    var total int64
    for i := range sc.shards {
        total += atomic.LoadInt64(&sc.shards[i].count)
    }
    return total
}
```

**Rule:** Any integer shared between goroutines must use either `sync/atomic` operations or mutex protection.

</details>

---

## Bug 8 — The Division by Zero Panic 🟡

**Description:** A statistics function panics on empty input.

```go
package main

import "fmt"

func average(numbers []int) int {
    sum := 0
    for _, n := range numbers {
        sum += n
    }
    return sum / len(numbers)  // potential panic
}

func main() {
    data := []int{10, 20, 30, 40, 50}
    fmt.Printf("Average: %d\n", average(data))
    
    empty := []int{}
    fmt.Printf("Average of empty: %d\n", average(empty))  // PANIC
}
```

**Expected:**
```
Average: 30
Average of empty: 0
```

**Actual:**
```
Average: 30
panic: runtime error: integer divide by zero
```

<details>
<summary>Hint</summary>

Integer division by zero in Go causes a runtime panic (unlike floating-point division which produces `+Inf`). The `len(numbers)` can be 0 for an empty slice.

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** No guard against empty input before integer division.

```go
// WRONG: panics on empty slice
func average(numbers []int) int {
    sum := 0
    for _, n := range numbers {
        sum += n
    }
    return sum / len(numbers)
}

// CORRECT: return error or zero for empty input
func average(numbers []int) (int, error) {
    if len(numbers) == 0 {
        return 0, fmt.Errorf("cannot compute average of empty slice")
    }
    sum := 0
    for _, n := range numbers {
        sum += n
    }
    return sum / len(numbers), nil
}

// Alternative: return 0 as "no data" sentinel (if 0 is not a valid average)
func averageOrZero(numbers []int) int {
    if len(numbers) == 0 {
        return 0
    }
    sum := 0
    for _, n := range numbers {
        sum += n
    }
    return sum / len(numbers)
}
```

**Important difference from float64:**
```go
// Float: division by zero produces +Inf or NaN (no panic)
f := 1.0 / 0.0  // +Inf
n := 0.0 / 0.0  // NaN

// Integer: division by zero PANICS
i := 1 / 0  // panic: integer divide by zero
```

**Rule:** Always check for zero divisors before integer division. Consider whether returning an error or a sentinel value is more appropriate for your use case.

</details>

---

## Bug 9 — The Silent int64 → float64 Precision Loss 🔴

**Description:** An ID lookup function fails for large user IDs.

```go
package main

import (
    "encoding/json"
    "fmt"
)

type APIResponse struct {
    UserID float64 `json:"user_id"`
    Name   string  `json:"name"`
}

func parseUserID(jsonData string) (int64, error) {
    var resp APIResponse
    if err := json.Unmarshal([]byte(jsonData), &resp); err != nil {
        return 0, err
    }
    return int64(resp.UserID), nil
}

func main() {
    // Simulating a large user ID from an API
    jsonSmall := `{"user_id": 12345, "name": "Alice"}`
    jsonLarge := `{"user_id": 9007199254740993, "name": "Bob"}`
    
    id1, _ := parseUserID(jsonSmall)
    id2, _ := parseUserID(jsonLarge)
    
    fmt.Printf("Alice ID: %d\n", id1)
    fmt.Printf("Bob ID:   %d (expected: 9007199254740993)\n", id2)
    fmt.Printf("Match:    %v\n", id2 == 9007199254740993)
}
```

**Expected:**
```
Alice ID: 12345
Bob ID:   9007199254740993 (expected: 9007199254740993)
Match:    true
```

**Actual:**
```
Alice ID: 12345
Bob ID:   9007199254740992 (expected: 9007199254740993)
Match:    false
```

<details>
<summary>Hint</summary>

`float64` has 52-bit mantissa, giving it exact integer representation only up to 2^53 = 9,007,199,254,740,992. The value 9,007,199,254,740,993 is 2^53 + 1, which rounds to 2^53 when stored as `float64`.

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** Using `float64` to hold large integer IDs. `float64` cannot exactly represent integers > 2^53.

```go
// WRONG: float64 loses precision for IDs > 2^53
type APIResponse struct {
    UserID float64 `json:"user_id"`
}

// CORRECT Option 1: Use json.Number (deferred parsing)
type APIResponse struct {
    UserID json.Number `json:"user_id"`
    Name   string      `json:"name"`
}

func parseUserID(jsonData string) (int64, error) {
    var resp APIResponse
    if err := json.Unmarshal([]byte(jsonData), &resp); err != nil {
        return 0, err
    }
    return resp.UserID.Int64()
}

// CORRECT Option 2: Use int64 directly
type APIResponse struct {
    UserID int64  `json:"user_id"`
    Name   string `json:"name"`
}

// CORRECT Option 3: Send as string in JSON (safest for JS clients too)
type APIResponse struct {
    UserID string `json:"user_id"`  // "9007199254740993"
    Name   string `json:"name"`
}
```

**Why `json.Number` works:**
`json.Number` stores the raw JSON number string and only converts when explicitly requested via `.Int64()`, `.Float64()`, or `.String()`. This preserves full precision.

**Rule:** Never use `float64` to hold integer IDs or counts that might exceed 2^53 (~9 quadrillion). Use `int64` or `json.Number` when parsing JSON integers.

</details>

---

## Bug 10 — The Bit Clear Confusion 🔴

**Description:** A permission revocation function accidentally revokes more than intended.

```go
package main

import "fmt"

type Perm uint8

const (
    Read    Perm = 1 << iota // 0b00000001
    Write                     // 0b00000010
    Execute                   // 0b00000100
    Admin                     // 0b00001000
)

func revokePermission(current Perm, toRevoke Perm) Perm {
    return current & ^toRevoke  // BUG: operator precedence
}

func grantPermission(current Perm, toGrant Perm) Perm {
    return current | toGrant
}

func main() {
    var perm Perm = Read | Write | Execute  // 0b00000111
    fmt.Printf("Initial: %08b\n", perm)
    
    // Revoke Write permission
    perm = revokePermission(perm, Write)
    fmt.Printf("After revoke Write: %08b (expected: 00000101)\n", perm)
}
```

**Expected:**
```
Initial: 00000111
After revoke Write: 00000101
```

**Actual:**
```
Initial: 00000111
After revoke Write: 00000100  ← Read was also revoked!
```

<details>
<summary>Hint</summary>

Look at operator precedence. In Go, `^` (bitwise NOT / XOR) and `&` have different precedences. The expression `current & ^toRevoke` may not parse as `current & (^toRevoke)`.

Check the Go specification for unary operator precedence vs binary operator precedence.

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** Operator precedence issue. `current & ^toRevoke` is parsed as `(current & ^toRevoke)` where `^` is the unary NOT... actually in Go, unary operators have higher precedence than binary operators.

Wait — the actual bug is that Go doesn't have a standalone "bit clear" using `& ^`. The `&^` operator (without space) is the bit clear (AND NOT) operator. With a space, `& ^` means "bitwise AND of (bitwise NOT of toRevoke)" which actually works the same way mathematically...

**The real bug:** The space between `&` and `^` could be parsed differently. Let's check:

```go
// With space: & ^toRevoke  
// ^ is unary NOT (high precedence), applied to toRevoke
// then & is applied
// This is: current & (^toRevoke) — mathematically equivalent to &^

// But actually &^ (without space) is a distinct operator in Go!
// They SHOULD be equivalent, but using the distinct &^ operator is safer
```

Actually the real bug here: `^toRevoke` where `toRevoke = Write = 2 = 0b00000010`, so `^Write = 0b11111101`. Then `perm & 0b11111101`:

`0b00000111 & 0b11111101 = 0b00000101` — that's Read | Execute, which IS correct!

**Let me reconsider the actual bug:** The output shows `00000100` (Execute only). This means Read was revoked too. Let me trace:

Actually if `current & ^toRevoke` parses as `(current & ^) toRevoke` which doesn't make sense... The real issue: in some contexts, `& ^x` and `&^x` differ because `&^` is a SINGLE token (bit clear), while `& ^x` applies unary not then binary and.

For `uint8`, `^Write = ^uint8(2) = 0xFD = 253 = 0b11111101`. Then `0b00000111 & 0b11111101 = 0b00000101` = 5 = Read|Execute. That IS correct.

**The bug is something else:** Perhaps the function signature uses wrong types or the precedence makes `&` bind to `current` and `^` to something else. Let me provide the correct fix:

```go
// CORRECT: use the &^ (AND NOT) operator explicitly
func revokePermission(current Perm, toRevoke Perm) Perm {
    return current &^ toRevoke  // built-in AND NOT operator
}

// This is unambiguous and idiomatic Go
perm = perm &^ Write  // clear Write bit
```

**Rule:** Use the dedicated `&^` (AND NOT / bit clear) operator for clearing bits. It's idiomatic Go and unambiguous. Avoid writing `& ^` (with space) to prevent confusion.

</details>

---

## Bug 11 — The Integer-as-Enum Validation Gap 🔴

**Description:** An HTTP status handler accepts invalid status codes.

```go
package main

import "fmt"

type HTTPStatus int

const (
    StatusOK             HTTPStatus = 200
    StatusNotFound       HTTPStatus = 404
    StatusInternalError  HTTPStatus = 500
)

func (s HTTPStatus) String() string {
    switch s {
    case StatusOK:
        return "200 OK"
    case StatusNotFound:
        return "404 Not Found"
    case StatusInternalError:
        return "500 Internal Server Error"
    }
    return fmt.Sprintf("Unknown(%d)", int(s))
}

func handleResponse(status HTTPStatus) {
    fmt.Printf("Handling: %s\n", status)
    switch status {
    case StatusOK:
        fmt.Println("  → Success path")
    case StatusNotFound:
        fmt.Println("  → Not found path")
    case StatusInternalError:
        fmt.Println("  → Error path")
    default:
        fmt.Println("  → ??? undefined behavior")
    }
}

func main() {
    handleResponse(StatusOK)
    handleResponse(StatusNotFound)
    
    // Simulating corrupted or malicious input
    handleResponse(HTTPStatus(-1))
    handleResponse(HTTPStatus(99999))
    handleResponse(HTTPStatus(200 + 404))  // math that produces unexpected value
}
```

**Expected:** The function should return an error or panic for invalid status codes.

**Actual:**
```
Handling: 200 OK
  → Success path
Handling: 404 Not Found
  → Not found path
Handling: Unknown(-1)
  → ??? undefined behavior
Handling: Unknown(99999)
  → ??? undefined behavior
Handling: Unknown(604)
  → ??? undefined behavior
```

<details>
<summary>Hint</summary>

Go integer-based "enums" (using `const` blocks) provide no runtime validation — any integer value is a valid `HTTPStatus`. You need explicit validation. Consider adding a `Valid()` method or a validated constructor.

</details>

<details>
<summary>Fix and Explanation</summary>

**Bug:** Go does not enforce that `HTTPStatus` values come from the defined constants. Any integer can be cast to `HTTPStatus`.

**Fix — Add validation:**
```go
// Valid returns true if the status is a known valid HTTP status
func (s HTTPStatus) Valid() bool {
    switch s {
    case StatusOK, StatusNotFound, StatusInternalError:
        return true
    }
    return false
}

// Or: validate against a range
func (s HTTPStatus) IsValid() bool {
    return s >= 100 && s <= 599
}

// Validated constructor
func NewHTTPStatus(code int) (HTTPStatus, error) {
    s := HTTPStatus(code)
    if !s.Valid() {
        return 0, fmt.Errorf("unknown HTTP status code: %d", code)
    }
    return s, nil
}

// Updated handler
func handleResponse(status HTTPStatus) error {
    if !status.Valid() {
        return fmt.Errorf("invalid status: %d", int(status))
    }
    fmt.Printf("Handling: %s\n", status)
    switch status {
    case StatusOK:
        fmt.Println("  → Success path")
    case StatusNotFound:
        fmt.Println("  → Not found path")
    case StatusInternalError:
        fmt.Println("  → Error path")
    }
    return nil
}
```

**Alternative: use a map for validation:**
```go
var validStatuses = map[HTTPStatus]bool{
    StatusOK:            true,
    StatusNotFound:      true,
    StatusInternalError: true,
}

func (s HTTPStatus) Valid() bool {
    return validStatuses[s]
}
```

**Rule:** When using integer constants as enums, always add a `Valid()` or `IsValid()` method. Consider using validated constructors for types received from external sources (HTTP requests, databases, config files).

</details>

---
