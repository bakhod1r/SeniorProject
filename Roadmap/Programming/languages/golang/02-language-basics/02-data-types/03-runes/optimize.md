# Runes — Optimization Exercises

## Exercise #1 — Use Range Instead of []rune Conversion
**Difficulty**: 🟢 Easy | **Category**: 💾 Memory

```go
// Unnecessary allocation
func countVowels(s string) int {
    count := 0
    for _, r := range []rune(s) {  // BUG: allocates []rune unnecessarily
        switch r {
        case 'a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U':
            count++
        }
    }
    return count
}
```

<details><summary>Optimized Solution</summary>

```go
func countVowelsFast(s string) int {
    count := 0
    for _, r := range s {  // range directly — no allocation
        switch r {
        case 'a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U':
            count++
        }
    }
    return count
}
// Benchmark: ~2x faster due to no allocation
```
</details>

---

## Exercise #2 — utf8.RuneCountInString vs []rune
**Difficulty**: 🟢 Easy | **Category**: 💾 Memory

```go
// Allocates []rune just to get length
func charCount(s string) int {
    return len([]rune(s))  // O(n) time, O(n) memory
}
```

<details><summary>Optimized Solution</summary>

```go
import "unicode/utf8"

func charCountFast(s string) int {
    return utf8.RuneCountInString(s)  // O(n) time, O(1) memory
}
// For 1MB string: saves ~4MB of allocation (4 bytes per rune)
```
</details>

---

## Exercise #3 — Efficient String Building with Runes
**Difficulty**: 🟡 Medium | **Category**: ⚡ Speed

```go
// Slow: string concatenation in loop
func filterLetters(s string) string {
    result := ""
    for _, r := range s {
        if unicode.IsLetter(r) {
            result += string(r)  // O(n^2) allocations!
        }
    }
    return result
}
```

<details><summary>Optimized Solution</summary>

```go
import "strings"

func filterLettersFast(s string) string {
    var b strings.Builder
    b.Grow(len(s))  // pre-allocate maximum possible size
    for _, r := range s {
        if unicode.IsLetter(r) {
            b.WriteRune(r)  // amortized O(1) per rune
        }
    }
    return b.String()
}
// O(n) vs O(n^2), no intermediate string allocations
```
</details>

---

## Exercise #4 — Avoid Repeated []rune Conversion
**Difficulty**: 🟡 Medium | **Category**: 💾 Memory + ⚡ Speed

```go
// Multiple conversions to []rune
func processString(s string) (int, string, string) {
    count := len([]rune(s))          // conversion 1
    first := string([]rune(s)[:1])   // conversion 2
    last := string([]rune(s)[len([]rune(s))-1:])  // conversion 3!
    return count, first, last
}
```

<details><summary>Optimized Solution</summary>

```go
func processStringFast(s string) (int, string, string) {
    runes := []rune(s)  // single conversion
    if len(runes) == 0 { return 0, "", "" }
    return len(runes), string(runes[:1]), string(runes[len(runes)-1:])
}
```
</details>

---

## Exercise #5 — strings.Map Instead of Manual Loop
**Difficulty**: 🟡 Medium | **Category**: ⚡ Speed

```go
// Manual mapping
func toLowerCustom(s string) string {
    runes := []rune(s)
    for i, r := range runes {
        runes[i] = unicode.ToLower(r)
    }
    return string(runes)
}
```

<details><summary>Optimized Solution</summary>

```go
func toLowerCustomFast(s string) string {
    return strings.Map(unicode.ToLower, s)
    // strings.Map handles UTF-8 correctly without manual []rune
    // Optimized in stdlib with pre-allocation
}
```
</details>

---

## Exercise #6 — Precompute Character Classification
**Difficulty**: 🟡 Medium | **Category**: ⚡ Speed

```go
// Slow: checks unicode.IsLetter on every call
func isAllLetters(s string) bool {
    for _, r := range s {
        if !unicode.IsLetter(r) {
            return false
        }
    }
    return true
}
// unicode.IsLetter does a binary search in Unicode tables
```

<details><summary>Optimized Solution</summary>

```go
// For ASCII-only input: direct lookup table
var isLetter [128]bool
func init() {
    for c := 'a'; c <= 'z'; c++ { isLetter[c] = true }
    for c := 'A'; c <= 'Z'; c++ { isLetter[c] = true }
}

func isAllLettersASCII(s string) bool {
    for i := 0; i < len(s); i++ {
        b := s[i]
        if b >= 128 || !isLetter[b] { return false }
    }
    return true
}
// 10x faster for ASCII strings — no UTF-8 decoding, O(1) table lookup
```
</details>

---

## Exercise #7 — Efficient UTF-8 Validation
**Difficulty**: 🟡 Medium | **Category**: ⚡ Speed

```go
// Slow: decodes each rune to check validity
func isValidUTF8Slow(s string) bool {
    for _, r := range s {
        if r == utf8.RuneError {
            // might be valid replacement character or invalid byte
        }
    }
    return true
}
```

<details><summary>Optimized Solution</summary>

```go
import "unicode/utf8"

// stdlib function: optimized, SIMD-accelerated in some versions
func isValidUTF8Fast(s string) bool {
    return utf8.ValidString(s)
}
// utf8.ValidString is highly optimized and the standard way to validate
```
</details>

---

## Exercise #8 — Avoid Rune Conversion for ASCII Check
**Difficulty**: 🟢 Easy | **Category**: ⚡ Speed

```go
// Slow: full UTF-8 decoding to check if ASCII
func isASCIISlow(s string) bool {
    for _, r := range s {
        if r > 127 { return false }
    }
    return true
}
```

<details><summary>Optimized Solution</summary>

```go
// Fast: check bytes directly (no UTF-8 decoding needed)
func isASCIIFast(s string) bool {
    for i := 0; i < len(s); i++ {
        if s[i] > 127 { return false }
    }
    return true
    // If any byte > 127, it's a multi-byte UTF-8 sequence → not pure ASCII
    // ASCII check on bytes is 3-4x faster than range (no UTF-8 decoding)
}
```
</details>

---

## Exercise #9 — String Interning for Repeated Rune Strings
**Difficulty**: 🔴 Hard | **Category**: 💾 Memory

```go
// Problem: many small single-character strings waste memory
func getCharStrings(s string) []string {
    result := make([]string, 0, utf8.RuneCountInString(s))
    for _, r := range s {
        result = append(result, string(r))  // each allocation
    }
    return result
}
```

<details><summary>Optimized Solution</summary>

```go
// Precompute common single-character strings
var singleCharStrings [256]string
func init() {
    for i := range singleCharStrings {
        singleCharStrings[i] = string(rune(i))
    }
}

func getCharString(r rune) string {
    if r < 256 {
        return singleCharStrings[r]  // no allocation for common chars
    }
    return string(r)  // allocate for rare chars
}
```
</details>

---

## Exercise #10 — Counting Runes Without Decoding
**Difficulty**: 🟡 Medium | **Category**: ⚡ Speed

```go
// Counts runes by full UTF-8 decoding
func countRunesSlow(data []byte) int {
    return utf8.RuneCount(data)
}
// utf8.RuneCount is O(n) and already efficient
// But can we do better by counting continuation bytes?
```

<details><summary>Optimized Solution</summary>

```go
// Count runes by counting non-continuation bytes
// UTF-8 continuation bytes have pattern 10xxxxxx (0x80-0xBF)
func countRunesFast(data []byte) int {
    count := len(data)
    for _, b := range data {
        if b>>6 == 2 {  // continuation byte: 10xxxxxx
            count--
        }
    }
    return count
}
// This is essentially what utf8.RuneCount does internally
// but written explicitly for clarity. The stdlib version is typically faster.
```
</details>

---

## Summary

| # | Category | Technique |
|---|----------|-----------|
| 1 | 💾 | range directly, no []rune alloc |
| 2 | 💾 | utf8.RuneCountInString vs []rune |
| 3 | ⚡ | strings.Builder for string building |
| 4 | 💾 | Single []rune conversion |
| 5 | ⚡ | strings.Map for rune mapping |
| 6 | ⚡ | Byte lookup table for ASCII |
| 7 | ⚡ | utf8.ValidString (stdlib optimized) |
| 8 | ⚡ | Byte check for ASCII detection |
| 9 | 💾 | Intern common single-char strings |
| 10 | ⚡ | Count by continuation byte pattern |
