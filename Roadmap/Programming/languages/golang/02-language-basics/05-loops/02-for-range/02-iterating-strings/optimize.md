# Iterating Strings — Optimization Exercises

---

## Exercise 1 🟢 — String Concatenation in Range Loop

```go
package main

import "fmt"

func toUppercase(s string) string {
    result := ""
    for _, r := range s {
        if r >= 'a' && r <= 'z' {
            result += string(r - 32) // new allocation each iteration!
        } else {
            result += string(r)
        }
    }
    return result
}

func main() {
    long := "the quick brown fox jumps over the lazy dog"
    fmt.Println(toUppercase(long))
}
```

<details>
<summary>Optimized Solution</summary>

```go
import (
    "strings"
    "unicode"
)

// Option 1: strings.Builder
func toUppercase(s string) string {
    var sb strings.Builder
    sb.Grow(len(s)) // pre-allocate exact byte count
    for _, r := range s {
        sb.WriteRune(unicode.ToUpper(r))
    }
    return sb.String()
}

// Option 2: Use standard library (best for this case)
func toUppercase(s string) string {
    return strings.ToUpper(s) // SIMD-optimized internally
}

// Benchmark: strings.Builder is 5-10x faster for large strings
// strings.ToUpper is 2x faster than Builder (SIMD)
```
</details>

---

## Exercise 2 🟢 — Unnecessary []rune Conversion

```go
package main

import "fmt"

func countLetters(s string) int {
    runes := []rune(s) // allocates 4 bytes per char!
    count := 0
    for _, r := range runes {
        if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
            count++
        }
    }
    return count
}

func main() {
    fmt.Println(countLetters("Hello, 世界! 123"))
}
```

<details>
<summary>Optimized Solution</summary>

```go
func countLetters(s string) int {
    count := 0
    for _, r := range s { // range directly — no allocation!
        if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
            count++
        }
    }
    return count
}
// Saves: len([]rune(s)) * 4 bytes allocation
// For 1000-char string: saves 4KB allocation per call
```
</details>

---

## Exercise 3 🟢 — Splitting String with String Function

```go
package main

import (
    "fmt"
    "strings"
)

func splitWords(s string) []string {
    words := []string{}
    var current []rune
    for _, r := range s {
        if r == ' ' || r == '\t' || r == '\n' {
            if len(current) > 0 {
                words = append(words, string(current))
                current = current[:0]
            }
        } else {
            current = append(current, r)
        }
    }
    if len(current) > 0 {
        words = append(words, string(current))
    }
    return words
}

func main() {
    words := splitWords("hello world foo bar")
    fmt.Println(len(words))
}
```

<details>
<summary>Optimized Solution</summary>

```go
import "strings"

// strings.Fields is highly optimized (uses byte-level scan internally)
func splitWords(s string) []string {
    return strings.Fields(s)
}

// If custom logic is needed, avoid []rune buffer:
func splitWordsOpt(s string) []string {
    var words []string
    start := -1
    for i, r := range s {
        isSpace := r == ' ' || r == '\t' || r == '\n'
        if !isSpace && start == -1 {
            start = i // byte position of word start
        } else if isSpace && start >= 0 {
            words = append(words, s[start:i]) // substring = no copy
            start = -1
        }
    }
    if start >= 0 { words = append(words, s[start:]) }
    return words
}
// Key: use byte positions from range to slice the original string (zero-copy)
// Avoid: accumulating runes into []rune then converting to string
```
</details>

---

## Exercise 4 🟡 — Repeated Rune Count for Same String

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

type TextProcessor struct {
    text string
}

func (tp *TextProcessor) Length() int {
    return utf8.RuneCountInString(tp.text) // O(n) each call!
}

func (tp *TextProcessor) FirstN(n int) string {
    runes := []rune(tp.text) // O(n) allocation each call!
    if n > len(runes) { n = len(runes) }
    return string(runes[:n])
}

func main() {
    tp := &TextProcessor{text: "Hello, 世界!"}
    for i := 0; i < 10000; i++ {
        _ = tp.Length()  // 10000 O(n) scans
        _ = tp.FirstN(3) // 10000 allocations
    }
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
type TextProcessor struct {
    text     string
    runes    []rune // cached once
    runeLen  int    // cached
}

func NewTextProcessor(text string) *TextProcessor {
    runes := []rune(text) // compute ONCE
    return &TextProcessor{
        text:    text,
        runes:   runes,
        runeLen: len(runes),
    }
}

func (tp *TextProcessor) Length() int { return tp.runeLen } // O(1)

func (tp *TextProcessor) FirstN(n int) string {
    if n > tp.runeLen { n = tp.runeLen }
    return string(tp.runes[:n]) // no re-compute
}
// If text is immutable: compute runes once, cache forever
// If text changes: invalidate cache on Set()
```
</details>

---

## Exercise 5 🟡 — Unnecessary UTF-8 Validation in Hot Path

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func processToken(token string) {
    if !utf8.ValidString(token) {
        panic("invalid UTF-8")
    }
    for _, r := range token { // validates UTF-8 AGAIN internally!
        _ = r
    }
}

func main() {
    for i := 0; i < 1_000_000; i++ {
        processToken("token")
    }
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Validate ONCE at ingress, trust internally
// Validate at API boundary (HTTP handler, file reader), not in hot paths

// Option 2: If validation is needed, it's already done by for range
// for range does NOT panic on invalid UTF-8 — it yields RuneError
// Check RuneError if you need to detect invalid bytes:

func processToken(token string) {
    for _, r := range token {
        if r == utf8.RuneError {
            panic("invalid UTF-8")
        }
        _ = r
    }
    // Single pass: validates AND processes
}

// Option 3: For pure ASCII tokens (common in web APIs):
func processTokenASCII(token string) {
    for i := 0; i < len(token); i++ { // byte loop: no UTF-8 decode
        if token[i] >= 0x80 { panic("non-ASCII") }
        _ = token[i]
    }
}
```
</details>

---

## Exercise 6 🟡 — Creating Intermediate Strings from Rune Slices

```go
package main

import "fmt"

func maskEmail(email string) string {
    runes := []rune(email)
    atIdx := -1
    for i, r := range runes {
        if r == '@' { atIdx = i; break }
    }
    if atIdx <= 0 { return email }

    result := make([]rune, len(runes))
    copy(result, runes)
    for i := 1; i < atIdx-1; i++ {
        result[i] = '*'
    }
    return string(result) // extra allocation
}

func main() {
    fmt.Println(maskEmail("alice@example.com")) // a***e@example.com
}
```

<details>
<summary>Optimized Solution</summary>

```go
import "strings"

func maskEmail(email string) string {
    // Find @ using strings.IndexByte (SIMD-optimized, no UTF-8 decode)
    atIdx := strings.IndexByte(email, '@')
    if atIdx <= 1 { return email }

    var sb strings.Builder
    sb.Grow(len(email))

    count := 0
    for i, r := range email {
        if count == 0 || i >= atIdx {
            sb.WriteRune(r) // keep first char and everything from @
        } else if count == atIdx-1 {
            sb.WriteRune(r) // keep char before @
        } else {
            sb.WriteByte('*') // mask middle (all ASCII * so 1 byte)
        }
        count++
    }
    return sb.String()
}
// Uses strings.IndexByte for fast @ search
// strings.Builder avoids intermediate []rune
```
</details>

---

## Exercise 7 🟡 — Reading Characters Multiple Times

```go
package main

import "fmt"

func validate(s string) (bool, bool, bool) {
    // Three separate passes — reads string 3 times
    hasUpper := false
    for _, r := range s { if r >= 'A' && r <= 'Z' { hasUpper = true; break } }

    hasDigit := false
    for _, r := range s { if r >= '0' && r <= '9' { hasDigit = true; break } }

    hasSpecial := false
    for _, r := range s {
        if r == '!' || r == '@' || r == '#' || r == '$' {
            hasSpecial = true; break
        }
    }
    return hasUpper, hasDigit, hasSpecial
}

func main() {
    u, d, s := validate("Hello World! 123")
    fmt.Println(u, d, s) // true true true
}
```

<details>
<summary>Optimized Solution</summary>

```go
func validate(s string) (hasUpper, hasDigit, hasSpecial bool) {
    // Single pass
    for _, r := range s {
        switch {
        case r >= 'A' && r <= 'Z': hasUpper = true
        case r >= '0' && r <= '9': hasDigit = true
        case r == '!' || r == '@' || r == '#' || r == '$': hasSpecial = true
        }
        if hasUpper && hasDigit && hasSpecial { break } // early exit
    }
    return
}
// 1 pass instead of 3
// Early exit when all conditions satisfied
// For 100K-char string with all conditions in first 10 chars: 99.99% fewer operations
```
</details>

---

## Exercise 8 🔴 — String to []rune to String Round-trip

```go
package main

import "fmt"

func transformText(s string) string {
    runes := []rune(s)        // allocation 1
    for i, r := range runes {
        runes[i] = unicode.ToUpper(r)
    }
    return string(runes)      // allocation 2
}

func batchTransform(texts []string) []string {
    result := make([]string, len(texts))
    for i, t := range texts {
        result[i] = transformText(t) // 2 allocations per string!
    }
    return result
}

func main() {
    texts := make([]string, 10000)
    for i := range texts { texts[i] = "hello world" }
    _ = batchTransform(texts)
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
import (
    "strings"
    "unicode"
)

// Option 1: Use strings.Map (optimized internally, 1 allocation)
func transformText(s string) string {
    return strings.Map(unicode.ToUpper, s)
}

// Option 2: Use strings.ToUpper (SIMD-optimized for common cases)
func transformText(s string) string {
    return strings.ToUpper(s)
}

// Option 3: For ASCII-only: direct byte manipulation
func transformTextASCII(s string) string {
    b := []byte(s)
    for i, c := range b {
        if c >= 'a' && c <= 'z' { b[i] = c - 32 }
    }
    return string(b) // only 1 allocation ([]byte) vs 2 for []rune approach
}
// strings.ToUpper: 1 alloc + SIMD = fastest
// strings.Map: 1 alloc = good
// []rune approach: 2 allocs = avoid
```
</details>

---

## Exercise 9 🔴 — Counting Occurrences Without Index

```go
package main

import "fmt"

func countOccurrences(s string, target rune) int {
    runes := []rune(s)  // unnecessary allocation!
    count := 0
    for _, r := range runes {
        if r == target { count++ }
    }
    return count
}

func main() {
    text := "Hello, 世界 — hello again!"
    fmt.Println(countOccurrences(text, 'l'))  // 4
    fmt.Println(countOccurrences(text, '世')) // 1
}
```

<details>
<summary>Optimized Solution</summary>

```go
import "strings"

// Option 1: range directly (no allocation)
func countOccurrences(s string, target rune) int {
    count := 0
    for _, r := range s { // no []rune needed
        if r == target { count++ }
    }
    return count
}

// Option 2: For single-byte runes (ASCII), use strings.Count (SIMD)
func countByte(s string, b byte) int {
    return strings.Count(s, string(b))
}

// Option 3: For multi-byte runes, still faster without []rune:
func countRune(s string, target rune) int {
    return strings.Count(s, string(target))
    // strings.Count is optimized with Rabin-Karp or Boyer-Moore
}
```
</details>

---

## Exercise 10 🔴 — Greedy Rune Slice Pre-allocation

```go
package main

import "fmt"

func parseCSV(line string) []string {
    var result []string
    var field []rune // re-allocated per call
    for _, r := range line {
        if r == ',' {
            result = append(result, string(field))
            field = field[:0] // clear but keep memory
        } else {
            field = append(field, r)
        }
    }
    result = append(result, string(field))
    return result
}

func main() {
    for i := 0; i < 100000; i++ {
        _ = parseCSV("alice,30,engineer,new york,active")
    }
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
import "strings"

// Option 1: Use strings.Split (highly optimized)
func parseCSV(line string) []string {
    return strings.Split(line, ",")
}

// Option 2: Use byte positions to avoid rune buffer
func parseCSVOpt(line string) []string {
    var result []string
    start := 0
    for i, r := range line {
        if r == ',' {
            result = append(result, line[start:i]) // substring = zero copy!
            start = i + 1 // comma is 1 byte, safe
        }
    }
    result = append(result, line[start:])
    return result
}
// Key optimizations:
// 1. No []rune buffer — use byte positions from range
// 2. Substring (zero copy) instead of string([]rune{...})
// 3. strings.Split uses this approach internally + pre-counts commas
```
</details>

---

## Exercise 11 🔴 — Parallel String Processing for Large Corpus

```go
package main

import (
    "fmt"
    "strings"
)

func wordCount(corpus []string) map[string]int {
    result := map[string]int{}
    for _, doc := range corpus {
        for _, word := range strings.Fields(doc) {
            result[strings.ToLower(word)]++
        }
    }
    return result
}

func main() {
    corpus := make([]string, 10000)
    for i := range corpus {
        corpus[i] = "The quick brown fox jumps over the lazy dog"
    }
    _ = wordCount(corpus)
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
import (
    "runtime"
    "strings"
    "sync"
)

func wordCount(corpus []string) map[string]int {
    n := runtime.GOMAXPROCS(0)
    chunkSize := (len(corpus) + n - 1) / n

    shards := make([]map[string]int, n)
    var wg sync.WaitGroup

    for i := 0; i < n; i++ {
        start := i * chunkSize
        end := start + chunkSize
        if end > len(corpus) { end = len(corpus) }
        if start >= len(corpus) { break }

        shards[i] = map[string]int{}
        wg.Add(1)
        go func(shard map[string]int, docs []string) {
            defer wg.Done()
            for _, doc := range docs {
                for _, word := range strings.Fields(doc) {
                    shard[strings.ToLower(word)]++
                }
            }
        }(shards[i], corpus[start:end])
    }
    wg.Wait()

    // Merge (single goroutine — map access is fast for merge)
    result := make(map[string]int, 100)
    for _, shard := range shards {
        for k, v := range shard {
            result[k] += v
        }
    }
    return result
}
// Speedup: ~N× for CPU-bound text processing (N = GOMAXPROCS)
// For 10K docs: ~8x faster on 8-core machine
```
</details>

---

## Summary Table

| Exercise | Problem | Fix | Impact |
|---|---|---|---|
| 1 | String += in range | strings.Builder / strings.ToUpper | 5-100x |
| 2 | []rune when range suffices | for range string (0 alloc) | 0 alloc per call |
| 3 | Manual split with []rune | strings.Fields / byte position substring | 3-5x |
| 4 | Repeated RuneCount | Cache runes once in struct | O(n)→O(1) |
| 5 | Double UTF-8 validation | Validate at boundary, check RuneError inline | 2x |
| 6 | Intermediate []rune for masking | strings.Builder + byte positions | 50% fewer allocs |
| 7 | 3 passes over string | Single pass with early exit | 3x + early exit |
| 8 | []rune→string round-trip | strings.Map / strings.ToUpper | 2 allocs→1 |
| 9 | []rune for counting | for range string directly | 0 alloc |
| 10 | []rune buffer for CSV | Byte positions + substrings | 0 alloc for fields |
| 11 | Serial corpus processing | Parallel goroutines + merge | N× speedup |
