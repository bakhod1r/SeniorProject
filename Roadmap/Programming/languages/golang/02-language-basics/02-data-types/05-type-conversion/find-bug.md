# Type Conversion in Go — Find the Bug

Each section presents code with a hidden bug. Try to find it before opening the hint/solution.

---

## Bug 1 🟢 — The String Number Trap

```go
package main

import "fmt"

func generateCode(userID int) string {
    prefix := "USR"
    return prefix + string(userID)
}

func main() {
    code := generateCode(65)
    fmt.Println(code)
    // Expected: "USR65"
    // Actual: ???
}
```

<details>
<summary>Hint</summary>
What does `string(65)` actually produce? Remember that `string(intValue)` creates a Unicode character, not a decimal string.
</details>

<details>
<summary>Solution</summary>

**Bug:** `string(userID)` converts the integer to its Unicode character representation. `string(65)` produces `"A"` (ASCII/Unicode for 65), so the result is `"USRA"`, not `"USR65"`.

**Fix:**
```go
import (
    "fmt"
    "strconv"
)

func generateCode(userID int) string {
    prefix := "USR"
    return prefix + strconv.Itoa(userID)  // "USR65"
}
```

**Root cause:** In Go, `string(n)` where n is an integer creates a string containing the Unicode character with that code point. Use `strconv.Itoa(n)` or `fmt.Sprintf("%d", n)` to get the decimal representation.
</details>

---

## Bug 2 🟢 — Silent Overflow

```go
package main

import "fmt"

func setPortFromEnv(portStr string) int8 {
    var port int
    fmt.Sscan(portStr, &port)
    return int8(port)
}

func main() {
    port := setPortFromEnv("443")
    fmt.Println("Port:", port)
    // Expected: 443
    // Actual: ???
}
```

<details>
<summary>Hint</summary>
What is the maximum value of `int8`? Is 443 within that range?
</details>

<details>
<summary>Solution</summary>

**Bug:** `int8` can only hold values from -128 to 127. The port 443 overflows: 443 - 256 = 187, 187 - 256 = -69. So `int8(443)` = -69.

**Fix:**
```go
import (
    "fmt"
    "strconv"
)

func setPortFromEnv(portStr string) (int, error) {
    port, err := strconv.Atoi(portStr)
    if err != nil {
        return 0, fmt.Errorf("invalid port: %w", err)
    }
    if port < 1 || port > 65535 {
        return 0, fmt.Errorf("port %d out of valid range", port)
    }
    return port, nil
}
```

**Root cause:** Network ports (0-65535) require at minimum `uint16` or `int32`. `int8` is far too small. Always choose integer types appropriate for the value range.
</details>

---

## Bug 3 🟢 — Float Truncation Surprise

```go
package main

import "fmt"

func calculateAverage(scores []int) int {
    if len(scores) == 0 {
        return 0
    }
    total := 0
    for _, s := range scores {
        total += s
    }
    avg := float64(total) / float64(len(scores))
    return int(avg + 0.5)  // trying to round
}

func main() {
    scores := []int{1, 2, 3, 4}
    avg := calculateAverage(scores)
    fmt.Println("Average:", avg)
    // Expected: 3 (2.5 rounds to 3? or should it be 2?)
    // But what about negative averages?
}
```

<details>
<summary>Hint</summary>
The rounding logic `int(avg + 0.5)` only works for positive numbers. What happens with negative averages? Also, does the logic match the intended rounding behavior?
</details>

<details>
<summary>Solution</summary>

**Bug:** `int(avg + 0.5)` is a common "round half up" trick, but it only works correctly for non-negative values. For negative averages like -2.5, `int(-2.5 + 0.5) = int(-2.0) = -2`, which rounds toward zero, not away from zero.

**Fix using `math.Round`:**
```go
import (
    "fmt"
    "math"
)

func calculateAverage(scores []int) int {
    if len(scores) == 0 {
        return 0
    }
    total := 0
    for _, s := range scores {
        total += s
    }
    avg := float64(total) / float64(len(scores))
    return int(math.Round(avg))  // correct for positive and negative
}
```

**Root cause:** `int()` always truncates toward zero. Manual rounding with `+0.5` only works for non-negative numbers. Use `math.Round` for correct behavior.
</details>

---

## Bug 4 🟢 — Ignoring Parse Error

```go
package main

import (
    "fmt"
    "net/http"
    "strconv"
)

func getItemsHandler(w http.ResponseWriter, r *http.Request) {
    pageStr := r.URL.Query().Get("page")
    page, _ := strconv.Atoi(pageStr)  // ignore error

    if page <= 0 {
        page = 1
    }

    offset := (page - 1) * 20
    fmt.Fprintf(w, "Fetching page %d, offset %d\n", page, offset)
}

// What happens when the user sends: GET /items?page=abc
// What happens when the user sends: GET /items?page=
// What happens when the user sends: GET /items?page=99999999999
```

<details>
<summary>Hint</summary>
When `strconv.Atoi` fails, what value does it return? Is page=0 handled correctly? What about very large page numbers?
</details>

<details>
<summary>Solution</summary>

**Bugs:**
1. When `pageStr=""` or `pageStr="abc"`, `Atoi` returns `0` and err is non-nil (ignored). The code then sets `page=1`, which might seem OK but hides the error.
2. Very large page values like `"99999999999"` that don't fit in `int` return `0` with `ErrRange` — silently falling back to page 1, which is misleading.
3. No maximum page validation — could lead to database offset attacks.

**Fix:**
```go
func getItemsHandler(w http.ResponseWriter, r *http.Request) {
    pageStr := r.URL.Query().Get("page")
    page := 1  // default

    if pageStr != "" {
        n, err := strconv.Atoi(pageStr)
        if err != nil {
            http.Error(w, "invalid page parameter", http.StatusBadRequest)
            return
        }
        if n < 1 || n > 10000 {
            http.Error(w, "page must be between 1 and 10000", http.StatusBadRequest)
            return
        }
        page = n
    }

    offset := (page - 1) * 20
    fmt.Fprintf(w, "Fetching page %d, offset %d\n", page, offset)
}
```

**Root cause:** Never ignore errors from `strconv` functions. Always validate the parsed value's range after parsing.
</details>

---

## Bug 5 🟡 — Type Assertion Panic

```go
package main

import (
    "encoding/json"
    "fmt"
)

func getUsername(data []byte) string {
    var m map[string]interface{}
    json.Unmarshal(data, &m)

    username := m["username"].(string)  // direct assertion
    return username
}

func main() {
    // Works fine:
    fmt.Println(getUsername([]byte(`{"username": "alice"}`)))

    // What happens here?
    fmt.Println(getUsername([]byte(`{"username": null}`)))

    // And here?
    fmt.Println(getUsername([]byte(`{}`)))
}
```

<details>
<summary>Hint</summary>
What is the type of `m["username"]` when the JSON value is `null`? What about when the key doesn't exist?
</details>

<details>
<summary>Solution</summary>

**Bug:** The direct type assertion `m["username"].(string)` panics in two cases:
1. When `"username"` is `null` in JSON — the value is `nil`, not a string
2. When `"username"` key is missing — `m["username"]` returns `nil` (zero value for `interface{}`)

**Fix:**
```go
func getUsername(data []byte) (string, error) {
    var m map[string]interface{}
    if err := json.Unmarshal(data, &m); err != nil {
        return "", fmt.Errorf("invalid JSON: %w", err)
    }

    val, exists := m["username"]
    if !exists || val == nil {
        return "", fmt.Errorf("username field missing or null")
    }

    username, ok := val.(string)
    if !ok {
        return "", fmt.Errorf("username must be a string, got %T", val)
    }

    return username, nil
}
```

**Root cause:** Always use the two-value form `val, ok := iface.(Type)` and check for nil before asserting.
</details>

---

## Bug 6 🟡 — Negative to Unsigned Wrap

```go
package main

import "fmt"

func allocateBuffer(requestedSize int) []byte {
    // Ensure size is reasonable
    if requestedSize > 1024*1024 {
        requestedSize = 1024 * 1024
    }

    size := uint(requestedSize)
    return make([]byte, size)
}

func main() {
    // Normal usage
    buf := allocateBuffer(100)
    fmt.Println("Buffer size:", len(buf))

    // What happens here?
    buf2 := allocateBuffer(-1)
    fmt.Println("Buffer size:", len(buf2))
}
```

<details>
<summary>Hint</summary>
What is `uint(-1)` in Go? The check only prevents too-large values, but what about negative values?
</details>

<details>
<summary>Solution</summary>

**Bug:** `uint(-1)` wraps to `18446744073709551615` (max uint64). `make([]byte, 18446744073709551615)` will cause an out-of-memory panic or crash.

The check only guards against values > 1MB, but negative values pass through and wrap to enormous unsigned values.

**Fix:**
```go
func allocateBuffer(requestedSize int) ([]byte, error) {
    if requestedSize <= 0 {
        return nil, fmt.Errorf("buffer size must be positive, got %d", requestedSize)
    }
    if requestedSize > 1024*1024 {
        return nil, fmt.Errorf("buffer size %d exceeds maximum 1MB", requestedSize)
    }
    return make([]byte, requestedSize), nil
}
```

**Root cause:** When converting `int` to `uint`, always check for negative values first. Negative integers wrap to very large unsigned values, which can cause allocation panics.
</details>

---

## Bug 7 🟡 — Float Precision Loss with Large Integers

```go
package main

import "fmt"

type OrderID int64

func processOrder(idStr string) {
    var idFloat float64
    fmt.Sscanf(idStr, "%f", &idFloat)

    orderID := OrderID(int64(idFloat))
    fmt.Printf("Processing order: %d\n", orderID)
}

func main() {
    processOrder("9007199254740993")
    // Expected: Processing order: 9007199254740993
    // Actual: ???
}
```

<details>
<summary>Hint</summary>
`float64` can only exactly represent integers up to 2^53. What is 9007199254740993 relative to 2^53 = 9007199254740992?
</details>

<details>
<summary>Solution</summary>

**Bug:** The value `9007199254740993` is `2^53 + 1`. When parsed as `float64`, it rounds to `9007199254740992` (2^53) because `float64` has only 53 bits of precision. The resulting `OrderID` is wrong by 1.

```
Input:   9007199254740993
float64: 9007199254740992  (precision lost!)
OrderID: 9007199254740992  (wrong!)
```

**Fix:**
```go
import "strconv"

func processOrder(idStr string) error {
    id, err := strconv.ParseInt(idStr, 10, 64)
    if err != nil {
        return fmt.Errorf("invalid order ID %q: %w", idStr, err)
    }
    orderID := OrderID(id)
    fmt.Printf("Processing order: %d\n", orderID)
    return nil
}
```

**Root cause:** Never use `float64` as an intermediate type for integer IDs. Large integers beyond 2^53 cannot be exactly represented as `float64`. Use `strconv.ParseInt` directly.
</details>

---

## Bug 8 🟡 — Byte vs Rune Indexing

```go
package main

import "fmt"

func getFirstChar(s string) string {
    if len(s) == 0 {
        return ""
    }
    return string(s[0])
}

func main() {
    fmt.Println(getFirstChar("Hello"))   // Expected: "H", Actual: "H" ✓
    fmt.Println(getFirstChar("Привет"))  // Expected: "П", Actual: ???
    fmt.Println(getFirstChar("🌍 Earth")) // Expected: "🌍", Actual: ???
}
```

<details>
<summary>Hint</summary>
`s[0]` returns the first **byte** of the string, not the first **character**. For multi-byte UTF-8 characters, the first byte alone is not a valid character.
</details>

<details>
<summary>Solution</summary>

**Bug:** `s[0]` returns a `byte`, which is the first byte. For multi-byte characters (like Cyrillic letters or emojis), `string(s[0])` produces garbled output — just the first byte of the character, which is not a valid UTF-8 sequence on its own.

```
"П" in UTF-8: [208, 159]
s[0] = 208
string(208) = "Ð" (Unicode char 208, a Latin Extended char)
```

**Fix:**
```go
func getFirstChar(s string) string {
    if len(s) == 0 {
        return ""
    }
    // Use for-range to get the first rune
    for _, r := range s {
        return string(r)
    }
    return ""
}

// Or more explicitly:
func getFirstChar2(s string) string {
    runes := []rune(s)
    if len(runes) == 0 {
        return ""
    }
    return string(runes[0])
}
```

**Root cause:** `s[i]` gives bytes, not characters. Use `for _, r := range s` or `[]rune(s)` to work with Unicode characters.
</details>

---

## Bug 9 🟡 — Modifying a String via Byte Slice

```go
package main

import "fmt"

func uppercaseFirst(s string) string {
    if len(s) == 0 {
        return s
    }
    b := []byte(s)
    if b[0] >= 'a' && b[0] <= 'z' {
        b[0] -= 32  // convert to uppercase
    }
    return s  // BUG: returning original string, not modified bytes
}

func main() {
    result := uppercaseFirst("hello world")
    fmt.Println(result)
    // Expected: "Hello world"
    // Actual: ???
}
```

<details>
<summary>Hint</summary>
After modifying the byte slice `b`, which string is being returned?
</details>

<details>
<summary>Solution</summary>

**Bug:** The function modifies `b` (the byte slice copy), but returns `s` (the original string). The modification is lost. `[]byte(s)` creates a copy — modifying `b` does not modify `s`.

**Fix:**
```go
func uppercaseFirst(s string) string {
    if len(s) == 0 {
        return s
    }
    b := []byte(s)
    if b[0] >= 'a' && b[0] <= 'z' {
        b[0] -= 32
    }
    return string(b)  // convert modified bytes back to string
}
```

**Root cause:** `[]byte(s)` creates a copy. Modifying the copy does not affect the original string. You must convert back with `string(b)` to get the modified string.
</details>

---

## Bug 10 🔴 — Type Assertion Without Interface Check

```go
package main

import "fmt"

type Animal interface {
    Sound() string
}

type Dog struct{ Name string }
func (d Dog) Sound() string { return "Woof" }

type Cat struct{ Name string }
func (c Cat) Sound() string { return "Meow" }

func makeDogsLouder(animals []Animal) []Dog {
    dogs := make([]Dog, len(animals))
    for i, a := range animals {
        dogs[i] = a.(Dog)  // direct assertion — no ok check
    }
    return dogs
}

func main() {
    animals := []Animal{Dog{"Rex"}, Cat{"Whiskers"}, Dog{"Buddy"}}
    dogs := makeDogsLouder(animals)
    for _, d := range dogs {
        fmt.Println(d.Name, "says", d.Sound())
    }
}
```

<details>
<summary>Hint</summary>
What happens when `makeDogsLouder` encounters a `Cat` in the slice?
</details>

<details>
<summary>Solution</summary>

**Bug:** `a.(Dog)` panics when `a` is a `Cat`. The function assumes all animals are dogs, which violates the function's contract of accepting `[]Animal`.

**Fix (return only dogs, skip others):**
```go
func makeDogsLouder(animals []Animal) []Dog {
    var dogs []Dog
    for _, a := range animals {
        if d, ok := a.(Dog); ok {
            dogs = append(dogs, d)
        }
    }
    return dogs
}
```

**Fix (return error for non-dogs):**
```go
func makeDogsLouder(animals []Animal) ([]Dog, error) {
    dogs := make([]Dog, 0, len(animals))
    for i, a := range animals {
        d, ok := a.(Dog)
        if !ok {
            return nil, fmt.Errorf("animal[%d] is %T, not a Dog", i, a)
        }
        dogs = append(dogs, d)
    }
    return dogs, nil
}
```

**Root cause:** Direct type assertions (`a.(T)`) panic on type mismatch. Always use the two-value form in production code, especially when the input types are not 100% guaranteed.
</details>

---

## Bug 11 🔴 — Rune Conversion Loop Logic Error

```go
package main

import "fmt"

func reverseString(s string) string {
    bytes := []byte(s)
    for i, j := 0, len(bytes)-1; i < j; i, j = i+1, j-1 {
        bytes[i], bytes[j] = bytes[j], bytes[i]
    }
    return string(bytes)
}

func main() {
    fmt.Println(reverseString("Hello"))   // "olleH" ✓
    fmt.Println(reverseString("Привет"))  // Expected: "тевирП", Actual: ???
    fmt.Println(reverseString("abc🌍"))   // Expected: "🌍cba", Actual: ???
}
```

<details>
<summary>Hint</summary>
Reversing bytes of a multi-byte UTF-8 string will break the encoding. What should be reversed instead?
</details>

<details>
<summary>Solution</summary>

**Bug:** Reversing bytes of a UTF-8 string corrupts multi-byte characters. For example, the Russian "П" is encoded as bytes `[208, 159]`. Reversing places `[159, 208]` which is invalid UTF-8.

**Fix:** Reverse runes instead of bytes:
```go
func reverseString(s string) string {
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes)
}
```

**Root cause:** String reversal (and any character-level manipulation) must work with runes (`[]rune`), not bytes (`[]byte`), to correctly handle multi-byte UTF-8 characters.
</details>

---

## Bug 12 🔴 — Financial Calculation Precision Loss

```go
package main

import "fmt"

type Cents int64

func processFee(amountCents Cents) Cents {
    // Apply 2.5% fee
    feeRate := 0.025
    fee := float64(amountCents) * feeRate
    return Cents(fee)  // convert back to Cents
}

func main() {
    amount := Cents(10000) // $100.00 in cents

    fee := processFee(amount)
    fmt.Printf("Fee: %d cents ($%.2f)\n", fee, float64(fee)/100)

    // Test with a specific amount
    amount2 := Cents(3333)  // $33.33
    fee2 := processFee(amount2)
    fmt.Printf("Fee: %d cents (expected: 83 cents for $33.33 * 2.5%%)\n", fee2)
    // 3333 * 0.025 = 83.325 → should we get 83 or 83?
    // What about Cents(1) * 0.025 = 0.025 → Cents(0)?
}
```

<details>
<summary>Hint</summary>
What are the precision issues with converting `Cents` (integer) to `float64`, multiplying, then converting back? Is truncation acceptable for financial calculations?
</details>

<details>
<summary>Solution</summary>

**Bugs:**
1. **Truncation:** `Cents(83.325)` truncates to `83`, not rounds to `83`. For fees, truncation always favors the merchant — this may violate regulations.
2. **Precision accumulation:** `float64(Cents)` may lose precision for large values (> 2^53 cents = ~$90 trillion, unlikely but possible in high-volume systems).
3. **Small amounts:** `Cents(1) * 0.025 = 0.025` → `Cents(0)` — no fee charged for 1-cent transactions.

**Fix for exact integer arithmetic:**
```go
func processFee(amountCents Cents) Cents {
    // Use integer arithmetic only
    // 2.5% = 25/1000 = 1/40
    // fee = amount * 25 / 1000
    // Round up (banker's rounding or ceiling)
    fee := (int64(amountCents)*25 + 999) / 1000  // ceiling division
    return Cents(fee)
}

// Or use a proper decimal library:
// github.com/shopspring/decimal
```

**Root cause:** Financial calculations should use integer arithmetic (in the smallest unit: cents, satoshis, etc.) or a decimal library. Floating point introduces rounding errors that accumulate and may cause regulatory issues.
</details>

---

## Bug 13 🔴 — Concurrent Map with Type Assertion Race

```go
package main

import (
    "fmt"
    "sync"
)

var cache sync.Map

func getOrCompute(key string, compute func() int) int {
    if val, ok := cache.Load(key); ok {
        return val.(int)  // direct assertion
    }

    result := compute()
    cache.Store(key, result)
    return result
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            val := getOrCompute("key", func() int { return n * 2 })
            fmt.Println(val)
        }(i)
    }
    wg.Wait()
}
```

<details>
<summary>Hint</summary>
The code is actually not obviously broken for `int` values, but what if something stores a different type in the cache? Or what about the check-then-store pattern?
</details>

<details>
<summary>Solution</summary>

**Bugs:**
1. **TOCTOU race:** Between `cache.Load` (miss) and `cache.Store`, another goroutine may have already stored the value. This means `compute()` may be called multiple times — which could be expensive or have side effects.
2. **Unsafe assertion:** If any code path stores a non-`int` value (bug, refactor), `val.(int)` panics. The two-value form prevents this.
3. **No LoadOrStore:** `sync.Map` has `LoadOrStore` for atomic operations.

**Fix:**
```go
func getOrCompute(key string, compute func() int) int {
    if val, ok := cache.Load(key); ok {
        n, ok := val.(int)
        if !ok {
            // Defensive: log error and recompute
            n = compute()
        }
        return n
    }

    result := compute()
    // Store only if not already present (LoadOrStore)
    actual, loaded := cache.LoadOrStore(key, result)
    if loaded {
        n, _ := actual.(int)
        return n
    }
    return result
}
```

**Root cause:** `sync.Map` operations are individually atomic, but check-then-act sequences are not. Use `LoadOrStore` for true atomic cache population. Always use the safe `val, ok` assertion form.
</details>

---

## Summary Table

| # | Difficulty | Bug Type |
|---|-----------|----------|
| 1 | 🟢 | `string(int)` creates Unicode char, not decimal string |
| 2 | 🟢 | `int8` overflow for port numbers |
| 3 | 🟢 | Float truncation — `int()` doesn't round |
| 4 | 🟢 | Ignored `strconv.Atoi` error |
| 5 | 🟡 | Type assertion panic on null/missing JSON field |
| 6 | 🟡 | Negative to unsigned integer wraps to max value |
| 7 | 🟡 | Large int64 loses precision via float64 |
| 8 | 🟡 | Byte indexing breaks multi-byte characters |
| 9 | 🟡 | Modifying byte slice copy, not original string |
| 10 | 🔴 | Direct type assertion panics on unexpected type |
| 11 | 🔴 | Byte-level string reversal breaks Unicode |
| 12 | 🔴 | Float arithmetic for financial calculations |
| 13 | 🔴 | Race condition + unsafe assertion on sync.Map |
