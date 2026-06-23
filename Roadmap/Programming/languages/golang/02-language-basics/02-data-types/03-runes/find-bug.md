# Runes — Find the Bug

## Bug #1 — Using len() for Character Count
**Difficulty**: 🟢 Easy

```go
func truncateToN(s string, n int) string {
    if len(s) <= n { return s }  // BUG: len() is bytes, not characters
    return s[:n]                  // BUG: may cut mid-character
}

func main() {
    s := "Hello中文"
    fmt.Println(truncateToN(s, 7))  // May produce garbled output
}
```

<details><summary>Fixed Code</summary>

```go
func truncateToN(s string, n int) string {
    runes := []rune(s)
    if len(runes) <= n { return s }
    return string(runes[:n])
}
```
</details>

---

## Bug #2 — Byte Indexing String
**Difficulty**: 🟢 Easy

```go
s := "Hello中文"
lastChar := s[len(s)-1]  // BUG: last BYTE, not last character
fmt.Println(string(lastChar))  // garbage (partial multi-byte char)
```

<details><summary>Fixed Code</summary>

```go
runes := []rune(s)
lastRune := runes[len(runes)-1]
fmt.Println(string(lastRune))  // "文"
```
</details>

---

## Bug #3 — Wrong Way to Reverse
**Difficulty**: 🟢 Easy

```go
func reverseBuggy(s string) string {
    bytes := []byte(s)
    for i, j := 0, len(bytes)-1; i < j; i, j = i+1, j-1 {
        bytes[i], bytes[j] = bytes[j], bytes[i]  // BUG: reverses bytes, not characters
    }
    return string(bytes)
}

fmt.Println(reverseBuggy("Hello中"))  // garbled output!
```

<details><summary>Fixed Code</summary>

```go
func reverseCorrect(s string) string {
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes)
}
```
</details>

---

## Bug #4 — Comparing Rune to Byte
**Difficulty**: 🟡 Medium

```go
func containsNewline(s string) bool {
    for i := 0; i < len(s); i++ {
        if s[i] == '\n' {  // BUG: s[i] is byte, '\n' is rune (int32)
            // Actually: this compiles in Go because '\n' = 10 fits in uint8
            // But conceptually wrong — should use range
            return true
        }
    }
    return false
}
// This works by accident for ASCII — but wrong idiom
```

<details><summary>Better Code</summary>

```go
func containsNewline(s string) bool {
    for _, r := range s {
        if r == '\n' { return true }
    }
    return false
    // Or: strings.ContainsRune(s, '\n')
}
```
</details>

---

## Bug #5 — Integer Conversion Confusion
**Difficulty**: 🟡 Medium

```go
// BUG: string(65) does NOT produce "65" — it produces "A"!
n := 65
s := string(n)  // "A" (rune 65 = A), NOT "65"
fmt.Println(s)  // Expected "65", got "A"
```

<details><summary>Fixed Code</summary>

```go
// To convert int to its string representation:
s := strconv.Itoa(n)    // "65"
// or
s := fmt.Sprintf("%d", n)  // "65"

// string(n) converts the integer as a Unicode code point, not as a number
```
</details>

---

## Bug #6 — Not Checking Valid UTF-8
**Difficulty**: 🟡 Medium

```go
func processInput(data []byte) string {
    return string(data)  // BUG: no UTF-8 validation
    // If data contains invalid UTF-8, processing may corrupt or misbehave
}
```

<details><summary>Fixed Code</summary>

```go
import "unicode/utf8"

func processInput(data []byte) (string, error) {
    if !utf8.Valid(data) {
        return "", errors.New("invalid UTF-8 in input")
    }
    return string(data), nil
}
```
</details>

---

## Bug #7 — Range Index is Bytes
**Difficulty**: 🟡 Medium

```go
// BUG: assuming i is the character position, not byte position
s := "Hello中文"
for i, r := range s {
    fmt.Printf("character %d: %c\n", i, r)
    // Prints: character 0, 1, 2, 3, 4, 5, 8 — NOT 0,1,2,3,4,5,6!
}
```

<details><summary>Bug Explanation</summary>
In `for i, r := range s`, `i` is the byte offset, not the character index. "中" is at byte 5 (after "Hello"), and "文" is at byte 8 (after "Hello" + 3 bytes for "中").
</details>

<details><summary>Fixed Code</summary>

```go
// If you need character position (not byte position):
runes := []rune(s)
for charPos, r := range runes {
    fmt.Printf("character %d: %c\n", charPos, r)
}
```
</details>

---

## Bug #8 — fmt.Println Prints Rune as Number
**Difficulty**: 🟢 Easy

```go
r := 'A'
fmt.Println(r)  // BUG: prints 65, not "A"
```

<details><summary>Fixed Code</summary>

```go
r := 'A'
fmt.Printf("%c\n", r)    // "A" — print as character
fmt.Println(string(r))   // "A" — convert to string first
```
</details>

---

## Bug #9 — Incorrect UTF-8 Byte Count
**Difficulty**: 🟡 Medium

```go
// BUG: assuming all characters are 1 byte for Content-Length
body := "Hello, 中文"
contentLength := len([]rune(body))  // BUG: rune count, not bytes
// HTTP Content-Length must be byte count
w.Header().Set("Content-Length", strconv.Itoa(contentLength))
```

<details><summary>Fixed Code</summary>

```go
body := "Hello, 中文"
contentLength := len(body)  // byte count (correct for HTTP)
w.Header().Set("Content-Length", strconv.Itoa(contentLength))
```
</details>

---

## Bug #10 — String Slice with Byte Index from Range
**Difficulty**: 🔴 Hard

```go
// BUG: using range to find index, then slicing with it
func firstNChars(s string, n int) string {
    idx := 0
    count := 0
    for i := range s {
        if count == n {
            idx = i
            break
        }
        count++
    }
    return s[:idx]  // BUG: works by accident — but intent is wrong
}
// The range index IS the byte offset, so s[:idx] works
// But: if count never reaches n (s has fewer than n chars), idx=0!
```

<details><summary>Fixed Code</summary>

```go
func firstNChars(s string, n int) string {
    runes := []rune(s)
    if len(runes) <= n { return s }
    return string(runes[:n])
}
// Clear, explicit, correct
```
</details>

---

## Bug #11 — Incorrect Rune Literal in Switch
**Difficulty**: 🟢 Easy

```go
func classify(r rune) string {
    switch r {
    case "a", "e", "i", "o", "u":  // BUG: string literals, not rune literals
        return "vowel"
    default:
        return "consonant"
    }
}
// Compile error: cannot use "a" (string) as rune in switch
```

<details><summary>Fixed Code</summary>

```go
func classify(r rune) string {
    switch r {
    case 'a', 'e', 'i', 'o', 'u':  // rune literals with single quotes
        return "vowel"
    default:
        return "consonant"
    }
}
```
</details>

---

## Bug #12 — Counting Loop Terminates Early
**Difficulty**: 🟡 Medium

```go
// BUG: loop over bytes, but checks rune count
func hasMinChars(s string, min int) bool {
    count := 0
    for i := 0; i < len(s); i++ {
        count++  // counting bytes, not characters
    }
    return count >= min
}

// "中文" has 2 characters but 6 bytes
// hasMinChars("中文", 5) returns true (6 bytes ≥ 5) — wrong!
```

<details><summary>Fixed Code</summary>

```go
func hasMinChars(s string, min int) bool {
    count := 0
    for range s {  // range over string gives runes
        count++
    }
    return count >= min
    // Or: return utf8.RuneCountInString(s) >= min
}
```
</details>

---

## Summary

| # | Difficulty | Issue |
|---|-----------|-------|
| 1 | 🟢 | len() is bytes, not characters |
| 2 | 🟢 | Byte indexing gives bytes |
| 3 | 🟢 | Reversing bytes corrupts multibyte |
| 4 | 🟡 | Conceptual: range gives runes |
| 5 | 🟡 | string(int) = character, not number |
| 6 | 🟡 | Must validate UTF-8 |
| 7 | 🟡 | range index is byte offset |
| 8 | 🟢 | fmt.Println rune = number |
| 9 | 🟡 | HTTP needs byte count |
| 10 | 🔴 | Subtle: range byte index edge case |
| 11 | 🟢 | String vs rune literals |
| 12 | 🟡 | Byte loop vs rune count |
