# Iterating Strings — Find the Bug

---

## Bug 1 🟢 — Using Byte Length as Character Count

```go
package main

import "fmt"

func displayName(name string) {
    if len(name) > 20 {
        fmt.Println("Name too long!")
        return
    }
    fmt.Println("Hello,", name)
}

func main() {
    displayName("Alice")        // OK
    displayName("山田太郎")      // prints "Name too long!" for a 4-char name!
}
```

<details>
<summary>Solution</summary>

`len("山田太郎")` returns 12 (4 Japanese chars × 3 bytes each = 12 bytes), not 4. The validation uses bytes instead of characters.

**Fix:**
```go
import "unicode/utf8"

func displayName(name string) {
    if utf8.RuneCountInString(name) > 20 {
        fmt.Println("Name too long!")
        return
    }
    fmt.Println("Hello,", name)
}
```
</details>

---

## Bug 2 🟢 — Byte Access Returns Wrong Character

```go
package main

import "fmt"

func getInitial(name string) string {
    return string(name[0]) // get first character
}

func main() {
    fmt.Println(getInitial("Alice"))  // "A" — correct
    fmt.Println(getInitial("Étienne")) // "Ã" — wrong! é is U+00C9, first byte is 0xC3
}
```

<details>
<summary>Solution</summary>

`name[0]` returns the first **byte** (0xC3), not the first character. `string(0xC3)` is "Ã" in UTF-8, not 'É'.

**Fix:**
```go
func getInitial(name string) string {
    for _, r := range name {
        return string(r) // returns first rune
    }
    return ""
}
// Or:
runes := []rune(name)
if len(runes) == 0 { return "" }
return string(runes[0])
```
</details>

---

## Bug 3 🟢 — String Slicing Mid-Rune

```go
package main

import "fmt"

func preview(s string, n int) string {
    if len(s) <= n {
        return s
    }
    return s[:n] + "..."
}

func main() {
    fmt.Println(preview("Hello, World!", 7)) // "Hello, ..." — correct
    fmt.Println(preview("Hello, 世界!", 8))   // garbled! — 世 starts at byte 7, 8 bytes in
}
```

<details>
<summary>Solution</summary>

`s[:8]` cuts inside the 3-byte character '世' (bytes 7-9), producing invalid UTF-8.

**Fix:**
```go
func preview(s string, n int) string {
    count := 0
    for i := range s {
        if count == n { return s[:i] + "..." }
        count++
    }
    return s // fewer than n chars
}
```
</details>

---

## Bug 4 🟡 — Reversing String by Bytes

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
    fmt.Println(reverseString("Hello"))  // "olleH" — OK for ASCII
    fmt.Println(reverseString("世界"))   // garbled! bytes reversed, not runes
}
```

<details>
<summary>Solution</summary>

Reversing bytes of a multi-byte UTF-8 string scrambles the encoding. Each multi-byte character's bytes are reversed individually AND their positions relative to each other are reversed, producing invalid UTF-8.

**Fix:**
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

## Bug 5 🟡 — Treating Byte Index as Character Index

```go
package main

import "fmt"

func splitAt(s string, pos int) (string, string) {
    // Split string at character position pos
    return s[:pos], s[pos:]
}

func main() {
    s := "Hello, 世界"
    left, right := splitAt(s, 7)
    fmt.Println(left)  // expected "Hello, "
    fmt.Println(right) // expected "世界"
    // But with pos=7, s[7] is the start of '世' (correct only by luck!)
    // Try with pos=8: crashes mid-rune or produces garbled output
    left2, right2 := splitAt(s, 8) // panic or garbled
    fmt.Println(left2, right2)
}
```

<details>
<summary>Solution</summary>

`pos=7` happens to work here because '世' starts at byte 7. But `pos=8` splits inside '世'. The function uses byte positions, not character positions.

**Fix:**
```go
func splitAt(s string, charPos int) (string, string) {
    count := 0
    for i := range s {
        if count == charPos {
            return s[:i], s[i:]
        }
        count++
    }
    return s, ""
}
```
</details>

---

## Bug 6 🟡 — Infinite Loop on Invalid UTF-8 (Without Range)

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func processRunes(s string) {
    i := 0
    for i < len(s) {
        r, size := utf8.DecodeRuneInString(s[i:])
        if r == utf8.RuneError && size == 0 {
            break // WRONG: size==0 only when s[i:] is empty
            // For invalid UTF-8: size==1, not 0!
        }
        fmt.Printf("%c", r)
        i += size
    }
}

func main() {
    processRunes("A\xffB") // \xff is invalid UTF-8
    // Expected: A?B
    // Actual: A (then infinite loop because break condition is wrong)
}
```

<details>
<summary>Solution</summary>

`utf8.DecodeRuneInString` returns `(RuneError, 1)` for invalid UTF-8 (not `size=0`). `size==0` only when the input is empty. The break condition is wrong, causing an infinite loop on invalid bytes.

**Fix:**
```go
func processRunes(s string) {
    for i := 0; i < len(s); {
        r, size := utf8.DecodeRuneInString(s[i:])
        if r == utf8.RuneError && size == 1 {
            fmt.Print("?") // invalid byte
        } else {
            fmt.Printf("%c", r)
        }
        i += size // always advances by at least 1
    }
}
// Or simply use for range (handles this correctly automatically)
```
</details>

---

## Bug 7 🟡 — String Concatenation in Range (Quadratic)

```go
package main

import "fmt"

func removeSpaces(s string) string {
    result := ""
    for _, r := range s {
        if r != ' ' {
            result += string(r) // O(n) per concatenation!
        }
    }
    return result
}

func main() {
    long := "This is a very long string with many spaces in it " +
        "and it goes on and on " +
        "making this O(n^2)"
    fmt.Println(len(removeSpaces(long)))
}
```

<details>
<summary>Solution</summary>

Each `result += string(r)` creates a new string and copies all previous characters. For n characters, this is O(n²) total work.

**Fix:**
```go
import "strings"

func removeSpaces(s string) string {
    var sb strings.Builder
    sb.Grow(len(s)) // pre-allocate
    for _, r := range s {
        if r != ' ' {
            sb.WriteRune(r)
        }
    }
    return sb.String()
}
// O(n) total work
```
</details>

---

## Bug 8 🔴 — Incorrect Rune Comparison Using Byte Value

```go
package main

import "fmt"

func containsNonASCII(s string) bool {
    for _, r := range s {
        if r > 127 { // checking rune value
            return true
        }
    }
    return false
}

// This function looks correct... but consider:
func filterASCII(s string) string {
    result := ""
    for _, b := range []byte(s) { // iterates BYTES not runes
        if b <= 127 {
            result += string(b) // BUG: b is a byte, not a rune
        }
    }
    return result
}

func main() {
    s := "Héllo"
    fmt.Println(filterASCII(s)) // may produce "H?llo" or similar
}
```

<details>
<summary>Solution</summary>

Iterating `[]byte(s)` gives raw bytes. For 'é' (U+00E9, encoded as 0xC3 0xA9), byte 0xC3 (195) > 127, so it's dropped. Byte 0xA9 (169) > 127, also dropped. But this drops the continuation bytes, potentially creating invalid UTF-8 or losing characters incorrectly.

**Fix:**
```go
func filterASCII(s string) string {
    var sb strings.Builder
    for _, r := range s { // range over string gives runes
        if r <= 127 {     // filter non-ASCII runes
            sb.WriteRune(r)
        }
    }
    return sb.String()
}
```
</details>

---

## Bug 9 🔴 — Memory Leak via String Substring

```go
package main

import "fmt"

var cache []string

func processLargeFiles(filePaths []string) {
    for _, path := range filePaths {
        content := readFile(path) // reads ~100MB file into string
        header := content[:1024]  // extract first 1024 bytes
        cache = append(cache, header)
        // BUG: header shares backing array with 100MB content!
        // content can't be GC'd as long as header is in cache!
    }
}

func readFile(path string) string { return string(make([]byte, 100*1024*1024)) }

func main() {
    processLargeFiles([]string{"a", "b", "c"})
    fmt.Println("Cache entries:", len(cache))
    // 300MB of file data still in memory!
}
```

<details>
<summary>Solution</summary>

`content[:1024]` is a substring sharing the same backing array. The 100MB backing array is kept alive as long as `header` is referenced.

**Fix:**
```go
import "strings"

func processLargeFiles(filePaths []string) {
    for _, path := range filePaths {
        content := readFile(path)
        header := strings.Clone(content[:1024]) // new 1024-byte allocation!
        cache = append(cache, header)
        // content can now be GC'd — header has its own backing array
    }
}
```
</details>

---

## Bug 10 🔴 — Rune vs String Comparison

```go
package main

import "fmt"

func splitOnDelimiter(s string, delim string) []string {
    var parts []string
    start := 0
    for i, r := range s {
        if r == delim { // BUG: r is rune, delim is string — compile error!
            parts = append(parts, s[start:i])
            start = i + len(delim)
        }
    }
    parts = append(parts, s[start:])
    return parts
}

func main() {
    fmt.Println(splitOnDelimiter("a,b,,c", ","))
}
```

<details>
<summary>Solution</summary>

`r == delim` is a type mismatch — `r` is `rune` and `delim` is `string`. This won't compile.

Additionally, `i + len(delim)` uses `len(delim)` in bytes which is correct only for single-byte delimiters.

**Fix:**
```go
func splitOnDelimiter(s string, delim string) []string {
    delimRunes := []rune(delim)
    if len(delimRunes) == 1 {
        delimRune := delimRunes[0]
        var parts []string
        start := 0
        for i, r := range s {
            if r == delimRune { // compare rune to rune
                parts = append(parts, s[start:i])
                start = i + len(string(delimRune)) // byte length of delim rune
            }
        }
        return append(parts, s[start:])
    }
    // Multi-rune delimiter: use strings.Split
    import "strings"
    return strings.Split(s, delim)
}
```
</details>

---

## Bug 11 🔴 — Goroutine Leak on String Reader

```go
package main

import (
    "fmt"
    "io"
    "strings"
    "time"
)

func asyncProcess(s string, result chan<- rune) {
    r := strings.NewReader(s)
    go func() {
        for {
            ch, _, err := r.ReadRune()
            if err == io.EOF {
                close(result)
                return
            }
            result <- ch
        }
    }()
}

func main() {
    result := make(chan rune, 10)
    asyncProcess("Hello", result)
    // Only read first 3 runes, then stop
    for i, r := range result {
        if i >= 3 { break }
        fmt.Println(string(r))
    }
    time.Sleep(time.Second)
    // Goroutine is blocked trying to send to full channel — LEAKED!
}
```

<details>
<summary>Solution</summary>

The goroutine in `asyncProcess` tries to send all runes to `result`. When the caller stops reading after 3 items, the channel buffer fills up and the goroutine blocks forever — a goroutine leak.

**Fix:** Use `context.Context` for cancellation or simply use `for range` directly:
```go
func main() {
    count := 0
    for _, r := range "Hello" {
        if count >= 3 { break }
        fmt.Println(string(r))
        count++
    }
}
// No goroutine needed at all for simple string processing
```
</details>

---

## Bug 12 🔴 — Wrong String Position After Multi-byte Rune

```go
package main

import "fmt"

// Replace first occurrence of target rune with replacement string
func replaceFirst(s string, target rune, replacement string) string {
    for i, r := range s {
        if r == target {
            // Take everything before i, add replacement, add everything after i
            return s[:i] + replacement + s[i+1:] // BUG: i+1 is wrong for multi-byte!
        }
    }
    return s
}

func main() {
    fmt.Println(replaceFirst("Hello", 'l', "L"))     // "HeLlo" — seems correct
    fmt.Println(replaceFirst("Hello, 世界", '世', "WORLD"))
    // BUG: 世 is 3 bytes, but we skip only 1 byte with s[i+1:]
    // s[i+1:] starts at byte i+1, which is inside '世'!
}
```

<details>
<summary>Solution</summary>

`s[i+1:]` skips only 1 byte after position `i`, but multi-byte runes take 2-4 bytes. We must skip the entire rune's bytes.

**Fix:**
```go
import "unicode/utf8"

func replaceFirst(s string, target rune, replacement string) string {
    for i, r := range s {
        if r == target {
            runeSize := utf8.RuneLen(r) // 1, 2, 3, or 4 bytes
            return s[:i] + replacement + s[i+runeSize:]
        }
    }
    return s
}
// replaceFirst("Hello, 世界", '世', "WORLD") -> "Hello, WORLD界"
```
</details>
