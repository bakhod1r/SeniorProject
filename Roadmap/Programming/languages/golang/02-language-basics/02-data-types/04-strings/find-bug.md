# Strings in Go — Find the Bug

## Bug 1: Off-by-One in String Slicing

```go
package main

import "fmt"

func getMiddle(s string) string {
    if len(s) < 3 {
        return s
    }
    return s[1 : len(s)-2]
}

func main() {
    fmt.Println(getMiddle("hello"))  // wants "ell"
    fmt.Println(getMiddle("abcde")) // wants "bcd"
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Count the indices carefully. What byte index does `len(s)-2` point to? Remember that slicing `s[a:b]` excludes byte at index `b`.
</details>

<details>
<summary>Solution</summary>

**Bug**: The slice `s[1:len(s)-2]` excludes the second-to-last character. For `"hello"` (len=5): `s[1:3]` = `"el"`, missing the second 'l'.

**Fix**:
```go
func getMiddle(s string) string {
    if len(s) < 3 {
        return s
    }
    return s[1 : len(s)-1]  // was len(s)-2, should be len(s)-1
}
```

For `"hello"`: `s[1:4]` = `"ell"` ✓
For `"abcde"`: `s[1:4]` = `"bcd"` ✓
</details>

---

## Bug 2: Rune vs Byte Confusion

```go
package main

import "fmt"

func reverseString(s string) string {
    b := []byte(s)
    for i, j := 0, len(b)-1; i < j; i, j = i+1, j-1 {
        b[i], b[j] = b[j], b[i]
    }
    return string(b)
}

func main() {
    fmt.Println(reverseString("Hello"))  // "olleH" ✓
    fmt.Println(reverseString("世界"))   // should be "界世" — is it?
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
The Chinese character '世' is encoded as 3 bytes in UTF-8. What happens when you swap individual bytes instead of whole characters?
</details>

<details>
<summary>Solution</summary>

**Bug**: Reversing bytes of a multi-byte UTF-8 string corrupts the encoding. "世界" is 6 bytes (3 per character). Reversing the bytes produces invalid UTF-8, not "界世".

**Fix**: Convert to `[]rune` first:
```go
func reverseString(s string) string {
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes)
}
```
</details>

---

## Bug 3: Missing Error Check on Index

```go
package main

import (
    "fmt"
    "strings"
)

func extractValue(s, key string) string {
    idx := strings.Index(s, key+"=")
    start := idx + len(key) + 1
    end := strings.Index(s[start:], "&")
    if end == -1 {
        return s[start:]
    }
    return s[start : start+end]
}

func main() {
    query := "user=alice&token=secret&page=1"
    fmt.Println(extractValue(query, "token"))   // "secret"
    fmt.Println(extractValue(query, "missing")) // PANIC!
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does `strings.Index` return when the key is not found? What happens when you use that return value as an index?
</details>

<details>
<summary>Solution</summary>

**Bug**: When `strings.Index` returns `-1` (key not found), `start = -1 + len(key) + 1` may be a valid-looking index, leading to wrong results or panic.

**Fix**:
```go
func extractValue(s, key string) (string, bool) {
    idx := strings.Index(s, key+"=")
    if idx == -1 {
        return "", false  // key not found
    }
    start := idx + len(key) + 1
    end := strings.Index(s[start:], "&")
    if end == -1 {
        return s[start:], true
    }
    return s[start : start+end], true
}
```
</details>

---

## Bug 4: Concatenation in Loop Creates O(n²) Work

```go
package main

import "fmt"

func buildReport(items []string) string {
    report := "=== Report ===\n"
    for i, item := range items {
        report += fmt.Sprintf("%d. %s\n", i+1, item)
    }
    report += "=== End ==="
    return report
}

func main() {
    items := make([]string, 10000)
    for i := range items {
        items[i] = fmt.Sprintf("Item number %d", i)
    }
    fmt.Println(len(buildReport(items)))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Each `report += ...` allocates a new string. For 10,000 items, how much memory is allocated in total?
</details>

<details>
<summary>Solution</summary>

**Bug**: String concatenation with `+=` inside a loop creates O(n²) allocations. For 10,000 items, this allocates and copies approximately 1+2+...+10000 = 50M characters.

**Fix**:
```go
func buildReport(items []string) string {
    var b strings.Builder
    b.Grow(len(items) * 20) // estimate
    b.WriteString("=== Report ===\n")
    for i, item := range items {
        fmt.Fprintf(&b, "%d. %s\n", i+1, item)
    }
    b.WriteString("=== End ===")
    return b.String()
}
```
</details>

---

## Bug 5: String(int) Misuse

```go
package main

import "fmt"

func statusMessage(code int) string {
    return "Status code: " + string(code)
}

func main() {
    fmt.Println(statusMessage(200)) // wants "Status code: 200"
    fmt.Println(statusMessage(65))  // wants "Status code: 65"
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does `string(65)` produce in Go? Is it `"65"` or something else?
</details>

<details>
<summary>Solution</summary>

**Bug**: `string(int)` interprets the integer as a Unicode code point, not a number. `string(200)` produces `"È"` (U+00C8), and `string(65)` produces `"A"`.

**Fix**:
```go
import "strconv"

func statusMessage(code int) string {
    return "Status code: " + strconv.Itoa(code)
    // or: return fmt.Sprintf("Status code: %d", code)
}
```
</details>

---

## Bug 6: Case-Sensitive Comparison

```go
package main

import "fmt"

func isAdminRole(role string) bool {
    return role == "admin" || role == "ADMIN"
}

func main() {
    roles := []string{"admin", "ADMIN", "Admin", "AdMiN", "user"}
    for _, r := range roles {
        fmt.Printf("%-10s → isAdmin=%v\n", r, isAdminRole(r))
    }
    // "Admin" and "AdMiN" return false — is that intended?
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
The function only handles two specific cases. What about other capitalizations?
</details>

<details>
<summary>Solution</summary>

**Bug**: The function only handles `"admin"` and `"ADMIN"` but not other capitalizations like `"Admin"` or `"AdMiN"`. This could allow privilege escalation if a user sends `"Admin"`.

**Fix**:
```go
import "strings"

func isAdminRole(role string) bool {
    return strings.EqualFold(role, "admin")
    // EqualFold handles all case variations, including Unicode
}
```
</details>

---

## Bug 7: Infinite Loop from Missing Advance

```go
package main

import (
    "fmt"
    "strings"
)

func countOccurrences(s, substr string) int {
    count := 0
    for {
        idx := strings.Index(s, substr)
        if idx == -1 {
            break
        }
        count++
        s = s[idx:] // BUG: should advance past the found match
    }
    return count
}

func main() {
    fmt.Println(countOccurrences("abcabc", "a")) // should be 2
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
After finding `substr` at index `idx`, what does `s = s[idx:]` do? Does it advance past the match?
</details>

<details>
<summary>Solution</summary>

**Bug**: `s = s[idx:]` moves the string to start at the found substring — but since `idx` is where the match starts, the next iteration will find the same match again, causing an infinite loop.

**Fix**:
```go
func countOccurrences(s, substr string) int {
    count := 0
    for {
        idx := strings.Index(s, substr)
        if idx == -1 {
            break
        }
        count++
        s = s[idx+len(substr):]  // advance PAST the match
    }
    return count
    // Or simply: return strings.Count(s, substr)
}
```
</details>

---

## Bug 8: Slice Out of Bounds

```go
package main

import "fmt"

func truncate(s string, maxLen int) string {
    if len(s) > maxLen {
        return s[:maxLen] + "..."
    }
    return s
}

func main() {
    fmt.Println(truncate("Hello, World!", 5))     // "Hello..."
    fmt.Println(truncate("Hi", 5))                // "Hi"
    fmt.Println(truncate("Hello, 世界!", 9))       // PANIC or garbled?
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
"世界" has multi-byte characters. What does `s[:9]` do when byte 9 is in the middle of a multi-byte rune?
</details>

<details>
<summary>Solution</summary>

**Bug**: Slicing at a byte position that falls in the middle of a multi-byte UTF-8 character produces a string with invalid UTF-8 at the cut point (or the slice may panic in some contexts). For "Hello, 世界!" where '世' starts at byte 7, `s[:9]` cuts through the middle of '世'.

**Fix**:
```go
import "unicode/utf8"

func truncate(s string, maxChars int) string {
    if utf8.RuneCountInString(s) > maxChars {
        // Find the byte position of the maxChars-th rune
        i := 0
        for n := 0; n < maxChars; n++ {
            _, size := utf8.DecodeRuneInString(s[i:])
            i += size
        }
        return s[:i] + "..."
    }
    return s
}
```
</details>

---

## Bug 9: strings.Split Unexpected Result

```go
package main

import (
    "fmt"
    "strings"
)

func parseConfig(cfg string) map[string]string {
    result := make(map[string]string)
    lines := strings.Split(cfg, "\n")
    for _, line := range lines {
        parts := strings.Split(line, "=")
        if len(parts) == 2 {
            result[parts[0]] = parts[1]
        }
    }
    return result
}

func main() {
    cfg := `host=localhost
port=5432
dsn=postgres://user:pass@localhost/db?sslmode=disable`

    config := parseConfig(cfg)
    fmt.Println(config["dsn"]) // should be full DSN — is it?
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
The DSN value contains an `=` sign. What does `strings.Split(line, "=")` produce when the line has multiple `=` characters?
</details>

<details>
<summary>Solution</summary>

**Bug**: `strings.Split(line, "=")` splits on ALL `=` characters. For the DSN line `dsn=postgres://user:pass@localhost/db?sslmode=disable`, it produces 3 parts, so `len(parts) == 2` is false, and the DSN is silently dropped.

**Fix**: Use `strings.SplitN` to split at most once:
```go
parts := strings.SplitN(line, "=", 2)
if len(parts) == 2 {
    result[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
}
```
</details>

---

## Bug 10: Nil Pointer Panic with fmt.Sprintf and %s

```go
package main

import "fmt"

type User struct {
    Name  string
    Email *string
}

func formatUser(u User) string {
    email := ""
    if u.Email != nil {
        email = *u.Email
    }
    return fmt.Sprintf("Name: %s, Email: %s", u.Name, email)
}

func getUserInfo(users []User) []string {
    result := make([]string, len(users))
    for i, u := range users {
        // BUG: what if someone changes this line?
        result[i] = fmt.Sprintf("Name: %s, Email: %s", u.Name, u.Email)
    }
    return result
}

func main() {
    email := "alice@example.com"
    users := []User{
        {Name: "Alice", Email: &email},
        {Name: "Bob", Email: nil},
    }
    for _, info := range getUserInfo(users) {
        fmt.Println(info)
    }
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does `fmt.Sprintf("%s", (*string)(nil))` produce? Does it panic or print something unexpected?
</details>

<details>
<summary>Solution</summary>

**Bug**: `fmt.Sprintf("%s", u.Email)` where `u.Email` is `*string` and nil. For `%s` with a `*string`, fmt will print `%!s(*string=<nil>)` — not a panic, but ugly and incorrect output.

This is subtler than a panic — it compiles, runs, and produces wrong output silently.

**Fix**: Dereference safely:
```go
for i, u := range users {
    emailStr := ""
    if u.Email != nil {
        emailStr = *u.Email
    }
    result[i] = fmt.Sprintf("Name: %s, Email: %s", u.Name, emailStr)
}
```
Or implement `Stringer` on User for clean formatting.
</details>

---

## Bug 11: Comparing Strings with Different Normalizations

```go
package main

import "fmt"

func isDuplicate(a, b string) bool {
    return a == b
}

func main() {
    // Both look like "café" to the user
    s1 := "caf\u00e9"         // é as single code point U+00E9
    s2 := "cafe\u0301"        // e + combining accent U+0301

    fmt.Println(s1)            // café
    fmt.Println(s2)            // café (looks identical!)
    fmt.Println(isDuplicate(s1, s2)) // false — BUG: looks like duplicate!
    fmt.Println(len(s1), len(s2))    // 5, 6 — different byte lengths!
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Unicode has multiple ways to represent the same visible character. The `==` operator compares bytes, not visual appearance.
</details>

<details>
<summary>Solution</summary>

**Bug**: Two strings that look visually identical can have different UTF-8 representations due to Unicode normalization forms. `"caf\u00e9"` uses a precomposed character (NFC) while `"cafe\u0301"` uses decomposed characters (NFD). They compare as unequal with `==`.

**Fix**: Normalize both strings to NFC before comparison:
```go
import "golang.org/x/text/unicode/norm"

func isDuplicate(a, b string) bool {
    return norm.NFC.String(a) == norm.NFC.String(b)
}
```

Or use the `collate` package for full Unicode-aware comparison.
</details>

---

## Bug 12: Reading One Character Too Many

```go
package main

import "fmt"

func splitAtCapital(s string) []string {
    var result []string
    start := 0
    for i, r := range s {
        if i > 0 && r >= 'A' && r <= 'Z' {
            result = append(result, s[start:i+1]) // BUG!
            start = i
        }
    }
    result = append(result, s[start:])
    return result
}

func main() {
    fmt.Println(splitAtCapital("CamelCaseString"))
    // wants: ["Camel", "Case", "String"]
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
`s[start:i+1]` includes the character at index `i`. But when you find a capital letter at `i`, should it be included in the current word or start the next word?
</details>

<details>
<summary>Solution</summary>

**Bug**: `s[start:i+1]` includes the capital letter that starts the new word in the CURRENT word. For "CamelCaseString", the first split should be `s[0:5]` = "Camel", but the code produces `s[0:6]` = "CamelC".

**Fix**:
```go
func splitAtCapital(s string) []string {
    var result []string
    start := 0
    for i, r := range s {
        if i > 0 && r >= 'A' && r <= 'Z' {
            result = append(result, s[start:i])  // exclude s[i] (the capital)
            start = i
        }
    }
    result = append(result, s[start:])
    return result
}
```
</details>

---

## Bug 13: Builder Used Concurrently

```go
package main

import (
    "fmt"
    "strings"
    "sync"
)

func buildConcurrent(items []string) string {
    var wg sync.WaitGroup
    var b strings.Builder

    for _, item := range items {
        wg.Add(1)
        go func(s string) {
            defer wg.Done()
            b.WriteString(s) // DATA RACE!
            b.WriteByte('\n')
        }(item)
    }

    wg.Wait()
    return b.String()
}

func main() {
    items := []string{"one", "two", "three", "four", "five"}
    fmt.Println(buildConcurrent(items))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
`strings.Builder` is not safe for concurrent use. What happens when two goroutines call `WriteString` simultaneously?
</details>

<details>
<summary>Solution</summary>

**Bug**: `strings.Builder` is not goroutine-safe. Concurrent writes create a data race, potentially corrupting the buffer, causing panics, or producing garbled output.

**Fix**: Either use a mutex, or collect results and join:
```go
func buildConcurrent(items []string) string {
    results := make([]string, len(items))
    var wg sync.WaitGroup

    for i, item := range items {
        wg.Add(1)
        go func(idx int, s string) {
            defer wg.Done()
            results[idx] = s  // each goroutine writes to its own slot
        }(i, item)
    }

    wg.Wait()
    return strings.Join(results, "\n")
}
```
</details>
