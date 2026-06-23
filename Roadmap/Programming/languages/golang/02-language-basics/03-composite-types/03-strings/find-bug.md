# Strings in Go — Find the Bug

## Bug 1 — Wrong character count 🟢

```go
package main

import "fmt"

func main() {
    s := "Hello, 世界"
    fmt.Printf("The string has %d characters\n", len(s))
}
```

**What is the expected output?** "The string has 9 characters"
**What does it actually print?** "The string has 13 characters"

<details>
<summary>Explanation and Fix</summary>

**Bug:** `len(s)` counts bytes, not characters. "世界" is 6 bytes (3 each), not 2.

**Fix:**
```go
import "unicode/utf8"
fmt.Printf("The string has %d characters\n", utf8.RuneCountInString(s))
```

**Lesson:** Always use `utf8.RuneCountInString` or a range loop for character counts.
</details>

---

## Bug 2 — Garbled character access 🟢

```go
package main

import "fmt"

func main() {
    s := "Hello, 世界"
    fmt.Printf("8th character: %c\n", s[7])
}
```

**Expected:** `世`
**Actual:** A garbled byte character (228 = first byte of "世")

<details>
<summary>Explanation and Fix</summary>

**Bug:** `s[7]` returns the byte at index 7, not the 8th rune. "世" starts at byte 7 but spans 3 bytes.

**Fix:**
```go
runes := []rune(s)
fmt.Printf("8th character: %c\n", runes[7])
```

Or iterate with range and count runes:
```go
i := 0
for _, r := range s {
    if i == 7 {
        fmt.Printf("8th character: %c\n", r)
        break
    }
    i++
}
```
</details>

---

## Bug 3 — Attempted string mutation 🟢

```go
package main

import "fmt"

func capitalize(s string) string {
    s[0] = s[0] - 32 // make first letter uppercase
    return s
}

func main() {
    fmt.Println(capitalize("hello"))
}
```

**Expected:** "Hello"
**Actual:** Compile error: `cannot assign to s[0] (value of type byte)`

<details>
<summary>Explanation and Fix</summary>

**Bug:** Strings are immutable in Go. You cannot assign to `s[i]`.

**Fix:**
```go
func capitalize(s string) string {
    if len(s) == 0 {
        return s
    }
    b := []byte(s)
    if b[0] >= 'a' && b[0] <= 'z' {
        b[0] -= 32
    }
    return string(b)
}
```

Or more robustly:
```go
import (
    "strings"
    "unicode/utf8"
)

func capitalize(s string) string {
    if s == "" {
        return s
    }
    r, size := utf8.DecodeRuneInString(s)
    return strings.ToUpper(string(r)) + s[size:]
}
```
</details>

---

## Bug 4 — Quadratic string building 🟡

```go
package main

import "fmt"

func buildNumbers(n int) string {
    result := ""
    for i := 0; i < n; i++ {
        result += fmt.Sprintf("%d,", i)
    }
    return result
}

func main() {
    fmt.Println(buildNumbers(5)) // "0,1,2,3,4,"
}
```

**Expected:** Works correctly but is extremely slow for large `n`.
**Problem:** O(n^2) allocations.

<details>
<summary>Explanation and Fix</summary>

**Bug:** Each `+=` creates a new string and copies all previous content. For n=10000, this allocates ~50MB of temporary strings.

**Fix:**
```go
import (
    "fmt"
    "strings"
)

func buildNumbers(n int) string {
    var sb strings.Builder
    sb.Grow(n * 4) // estimate: ~4 chars per number
    for i := 0; i < n; i++ {
        fmt.Fprintf(&sb, "%d,", i)
    }
    return sb.String()
}
```
</details>

---

## Bug 5 — strings.Split empty case 🟡

```go
package main

import (
    "fmt"
    "strings"
)

func firstField(s string) string {
    parts := strings.Split(s, ",")
    return parts[0]
}

func main() {
    fmt.Println(firstField("a,b,c")) // a
    fmt.Println(firstField(""))      // ??? panic?
}
```

**Expected:** `firstField("")` returns `""`
**Actual:** Returns `""` (no panic here, but the code has a conceptual issue)

<details>
<summary>Explanation and Fix</summary>

**Issue:** `strings.Split("", ",")` returns `[""]` — a slice with one empty string. So `parts[0]` is `""`. This is actually correct behavior, but developers are often surprised.

However, the real bug pattern is:
```go
parts := strings.Split(s, ",")
first, second := parts[0], parts[1] // PANIC if s has no comma!
```

**Fix:** Use `strings.Cut` for splitting into exactly two parts:
```go
func splitTwo(s string) (string, string, bool) {
    return strings.Cut(s, ",")
}
```

Or check length:
```go
parts := strings.Split(s, ",")
if len(parts) < 2 {
    return // handle insufficient parts
}
```
</details>

---

## Bug 6 — Copying strings.Builder 🟡

```go
package main

import (
    "fmt"
    "strings"
)

func buildString() string {
    var sb strings.Builder
    sb.WriteString("Hello")
    sb2 := sb // copy the builder
    sb2.WriteString(", World!")
    return sb2.String()
}

func main() {
    fmt.Println(buildString())
}
```

**Expected:** "Hello, World!"
**Actual:** `panic: strings: illegal use of non-zero Builder copied by value`

<details>
<summary>Explanation and Fix</summary>

**Bug:** `strings.Builder` cannot be copied after first use. The `addr *Builder` self-pointer detects the copy and panics.

**Fix:**
```go
func buildString() string {
    var sb strings.Builder
    sb.WriteString("Hello")
    sb.WriteString(", World!") // continue on the same builder
    return sb.String()
}
```

If you need to fork, start a new builder:
```go
var sb strings.Builder
sb.WriteString("Hello")
prefix := sb.String() // take snapshot
var sb2 strings.Builder
sb2.WriteString(prefix)
sb2.WriteString(", World!")
```
</details>

---

## Bug 7 — Substring memory leak 🔴

```go
package main

import (
    "fmt"
    "strings"
)

func extractName(doc string) string {
    idx := strings.Index(doc, "name:")
    if idx < 0 {
        return ""
    }
    start := idx + 5
    end := strings.Index(doc[start:], "\n")
    if end < 0 {
        return doc[start:]
    }
    return doc[start : start+end]
}

func parseConfig(filename string) string {
    // Imagine reading a 50MB config file
    doc := strings.Repeat("padding...\n", 500000) + "name:Alice\n"
    return extractName(doc)
}

func main() {
    name := parseConfig("config.txt")
    fmt.Println(name) // Alice
    // But 50MB is still in memory!
}
```

**Problem:** The returned substring keeps the entire 50MB document alive.

<details>
<summary>Explanation and Fix</summary>

**Bug:** `doc[start : start+end]` is a substring that shares the backing array of the 50MB `doc` string. As long as the returned name is reachable, the 50MB doc cannot be GC'd.

**Fix:** Use `strings.Clone` to create an independent copy:
```go
return strings.Clone(doc[start : start+end])
```

This allocates a small independent string for "Alice" and allows the 50MB doc to be collected.

**Added in:** Go 1.20 — `strings.Clone(s string) string`
</details>

---

## Bug 8 — Invalid UTF-8 causing RuneError 🔴

```go
package main

import "fmt"

func reverseString(s string) string {
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes)
}

func main() {
    // This arrives from an external source with invalid UTF-8
    bad := "hello\xffworld"
    fmt.Println(reverseString(bad))
}
```

**Problem:** `\xff` is invalid UTF-8. Converting to `[]rune` replaces it with `utf8.RuneError` (U+FFFD), silently corrupting the data.

<details>
<summary>Explanation and Fix</summary>

**Bug:** When you convert invalid UTF-8 bytes to `[]rune`, invalid sequences become `utf8.RuneError` (U+FFFD = 0xFFFD). Converting back to string then encodes RuneError as a valid 3-byte UTF-8 sequence, changing the byte content.

**Fix:** Validate UTF-8 before processing:
```go
import "unicode/utf8"

func reverseString(s string) (string, error) {
    if !utf8.ValidString(s) {
        return "", fmt.Errorf("input contains invalid UTF-8")
    }
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes), nil
}
```
</details>

---

## Bug 9 — Case-insensitive comparison done wrong 🟡

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    a := "Straße"  // German word for "street"
    b := "STRASSE"
    
    // Attempt case-insensitive comparison
    if strings.ToLower(a) == strings.ToLower(b) {
        fmt.Println("equal")
    } else {
        fmt.Println("not equal")
    }
}
```

**Expected:** "equal" (these are the same word in different cases in German)
**Actual:** "not equal" — `strings.ToLower("STRASSE")` = "strasse", but `strings.ToLower("Straße")` = "straße"

<details>
<summary>Explanation and Fix</summary>

**Bug:** `strings.ToLower` does simple Unicode lowercasing. In German, the uppercase of "ß" is "SS" (two characters). So "Straße" and "STRASSE" are case-equivalent but `ToLower` does not handle this folding.

`strings.EqualFold` also does not handle this case for German.

**Fix for basic ASCII:** Use `strings.EqualFold(a, b)`.

**Fix for full Unicode folding:**
```go
import "golang.org/x/text/cases"
import "golang.org/x/text/language"

c := cases.Fold()
if c.String(a) == c.String(b) {
    fmt.Println("equal")
}
```
</details>

---

## Bug 10 — Off-by-one in string slicing 🟡

```go
package main

import (
    "fmt"
    "strings"
)

// extractBetween returns the content between start and end markers
func extractBetween(s, start, end string) string {
    i := strings.Index(s, start)
    if i < 0 {
        return ""
    }
    j := strings.Index(s[i:], end)
    if j < 0 {
        return ""
    }
    return s[i:j]
}

func main() {
    s := "Hello [World] !"
    fmt.Println(extractBetween(s, "[", "]")) // Expected: World
}
```

**Expected:** "World"
**Actual:** "Hello [World" or wrong content

<details>
<summary>Explanation and Fix</summary>

**Bug 1:** The start index `i` points to the `[` character itself. To get content after `[`, use `i + len(start)`.

**Bug 2:** The end search `strings.Index(s[i:], end)` searches from `[` onwards, giving a relative index `j`. To get the absolute position, use `i + j`. But we also need to skip past the start marker.

**Fix:**
```go
func extractBetween(s, start, end string) string {
    i := strings.Index(s, start)
    if i < 0 {
        return ""
    }
    i += len(start) // move past the start marker
    j := strings.Index(s[i:], end)
    if j < 0 {
        return ""
    }
    return s[i : i+j]
}
```
</details>

---

## Bug 11 — strings.Replace unexpected behavior 🟢

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    s := "aababab"
    result := strings.Replace(s, "ab", "X", 0)
    fmt.Println(result) // Expected: "aXXX"? or "aababab"?
}
```

**Expected by developer:** Replace all "ab" occurrences
**Actual:** Returns "aababab" unchanged

<details>
<summary>Explanation and Fix</summary>

**Bug:** The third argument to `strings.Replace` is `n`, the maximum number of replacements. `n=0` means "replace zero occurrences" — nothing changes!

Use `n=-1` to replace all occurrences, or use `strings.ReplaceAll`.

**Fix:**
```go
result := strings.Replace(s, "ab", "X", -1)  // replace all
// Or:
result := strings.ReplaceAll(s, "ab", "X")   // cleaner
fmt.Println(result) // aXXX
```
</details>
