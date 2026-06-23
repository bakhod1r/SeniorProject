# Runes — Middle Level

## Introduction
> Focus: "Why?" and "When to use?"

Understanding runes at the middle level means grasping the design decisions behind Go's text handling: why strings are byte sequences, when rune conversion is necessary vs wasteful, how UTF-8 encoding works internally, and what the real pitfalls are when processing international text in production.

---

## Evolution & Historical Context

Go was designed with UTF-8 as a first-class concern. Rob Pike and Ken Thompson (co-creators of Go) also co-invented the UTF-8 encoding standard. This is why:

1. Go source files are UTF-8 by definition
2. Go strings are UTF-8 byte sequences
3. `range` over strings decodes UTF-8 automatically
4. `rune` (code point) is a distinct concept from `byte`

The choice to make strings byte sequences (not character sequences) was deliberate: it makes string operations O(1) for length and O(n) for indexing — no hidden costs.

---

## Why Bytes vs Runes?

### The Design Trade-Off

```go
s := "Hello"
len(s)  // O(1) — stored as field, always bytes
// If strings were character sequences, len() would be O(n) for UTF-8

// Go's choice: cheap bytes, explicit rune conversion
// The programmer decides when character-level access is needed
```

### When You Need Runes vs When You Don't

```go
// Need runes:
truncate(s, maxChars int)  // truncate by character count
reverse(s string)          // reverse by character
charAt(s string, n int)    // nth character

// Don't need runes (byte operations suffice):
strings.Contains(s, "hello")  // substring search
strings.Replace(s, "a", "b")  // byte-level replacement (works for ASCII substrings)
len(s)                        // byte count (often what you need for buffers)
```

---

## UTF-8 Encoding Deep Dive

### How UTF-8 Works

```
Code point range    | UTF-8 bytes | Pattern
U+0000 - U+007F    | 1 byte     | 0xxxxxxx
U+0080 - U+07FF    | 2 bytes    | 110xxxxx 10xxxxxx
U+0800 - U+FFFF    | 3 bytes    | 1110xxxx 10xxxxxx 10xxxxxx
U+10000 - U+10FFFF | 4 bytes    | 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx

Example: "中" (U+4E2D = 0x4E2D)
Binary: 0100 1110 0010 1101
3-byte pattern: 1110xxxx 10xxxxxx 10xxxxxx
Fill in bits:   11100100 10111000 10101101
Hex:            E4       B8       AD
```

### Detecting Multi-Byte Characters

```go
import "unicode/utf8"

// Decode one rune from the beginning of a byte slice
r, size := utf8.DecodeRune([]byte("中文"))
fmt.Println(r, size)  // 20013 3 (rune value, byte size)

// Decode from string directly
r2, size2 := utf8.DecodeRuneInString("中文")
fmt.Println(r2, size2)  // 20013 3

// How many bytes a rune takes
fmt.Println(utf8.RuneLen('A'))  // 1
fmt.Println(utf8.RuneLen('中'))  // 3
fmt.Println(utf8.RuneLen('😀'))  // 4
```

---

## Anti-Patterns

### Anti-Pattern 1: Byte Slicing Unicode Strings

```go
// BAD: can split a multi-byte rune
s := "Hello中"
halfway := s[:len(s)/2]  // might cut "中" in half!
fmt.Println(halfway)      // garbled output

// GOOD: slice by rune
runes := []rune(s)
halfway := string(runes[:len(runes)/2])
```

### Anti-Pattern 2: Converting to []rune Unnecessarily

```go
// BAD: allocates []rune just to iterate
for _, r := range []rune(s) {
    process(r)
}

// GOOD: range directly over string (no allocation)
for _, r := range s {
    process(r)
}
```

### Anti-Pattern 3: Using len() for Character Limit

```go
// BAD: limiting by bytes, not characters
if len(username) > 20 {
    return error("too long")
}

// GOOD: limit by rune count
if utf8.RuneCountInString(username) > 20 {
    return error("too long")
}
```

### Anti-Pattern 4: Comparing Strings Without Normalization

```go
// BAD: "é" can be represented as one rune (U+00E9)
// or as two runes: "e" (U+0065) + combining accent (U+0301)
s1 := "\u00e9"    // single rune "é"
s2 := "e\u0301"  // "e" + combining accent

fmt.Println(s1 == s2)  // false! Same visual, different bytes

// GOOD: use golang.org/x/text/unicode/norm
import "golang.org/x/text/unicode/norm"
fmt.Println(norm.NFC.String(s1) == norm.NFC.String(s2))  // true
```

---

## Debugging Guide

### Diagnosing Rune/Byte Confusion

```go
// Print detailed breakdown
func debugString(s string) {
    fmt.Printf("String: %q\n", s)
    fmt.Printf("Bytes: %d | Runes: %d\n", len(s), utf8.RuneCountInString(s))
    for i, r := range s {
        fmt.Printf("  byte[%d]: U+%04X %c (%d bytes)\n",
            i, r, r, utf8.RuneLen(r))
    }
}
// Use this to understand why byte counts differ from character counts
```

---

## Production Concerns

### 1. Database String Lengths

Many databases use byte length for VARCHAR limits. MySQL's `VARCHAR(255)` may hold 255 bytes — but only 85 3-byte characters. Consider:

```go
// Validate against database column length in bytes
func validateUsernameForDB(username string, maxBytes int) error {
    if len(username) > maxBytes {
        return fmt.Errorf("username too long: %d bytes (max %d)", len(username), maxBytes)
    }
    return nil
}
```

### 2. HTTP Content-Length

`Content-Length` header must match byte count, not character count:

```go
body := "Hello, 中文"
w.Header().Set("Content-Length", strconv.Itoa(len(body)))  // bytes, correct
```

### 3. Text Truncation for Display

```go
// Truncate at word boundary, respecting Unicode
func truncateWords(s string, maxRunes int) string {
    if utf8.RuneCountInString(s) <= maxRunes {
        return s
    }
    runes := []rune(s)
    truncated := string(runes[:maxRunes])
    // Find last space/word boundary
    lastSpace := strings.LastIndex(truncated, " ")
    if lastSpace > 0 {
        return truncated[:lastSpace] + "…"
    }
    return truncated + "…"
}
```

---

## Comparison with Other Languages

| Feature | Go | Python 3 | Java | JavaScript |
|---------|-----|----------|------|------------|
| String encoding | UTF-8 bytes | Unicode str | UTF-16 | UTF-16 |
| "Character" type | rune (int32) | str (len 1) | char (UTF-16 unit) | code unit (16-bit) |
| len() | bytes | code points | UTF-16 units | UTF-16 units |
| Range iteration | rune-based | code points | (for loop: char) | code units |
| Emoji length | 4 bytes | 1 | 2 (surrogate pair) | 2 |

---

## Best Practices

1. **Use `range` for iteration** — automatic UTF-8 decoding, no allocation
2. **Use `utf8.RuneCountInString`** for character count — more efficient than `[]rune`
3. **Convert to `[]rune` only for random access** by character index
4. **Validate input is valid UTF-8** using `utf8.ValidString`
5. **Use `unicode` package** for character classification
6. **Consider Unicode normalization** for user-facing text comparison
7. **Document byte vs character semantics** in function signatures

---

## Test

```go
package runes_test

import (
    "testing"
    "unicode/utf8"
)

func TestByteVsRuneCount(t *testing.T) {
    cases := []struct {
        s         string
        wantBytes int
        wantRunes int
    }{
        {"Hello", 5, 5},
        {"中", 3, 1},
        {"😀", 4, 1},
        {"Hello中文", 11, 7},
    }
    for _, c := range cases {
        if len(c.s) != c.wantBytes {
            t.Errorf("len(%q) = %d, want %d", c.s, len(c.s), c.wantBytes)
        }
        if utf8.RuneCountInString(c.s) != c.wantRunes {
            t.Errorf("RuneCount(%q) = %d, want %d",
                c.s, utf8.RuneCountInString(c.s), c.wantRunes)
        }
    }
}

func TestSafeSlice(t *testing.T) {
    s := "Hello中"
    runes := []rune(s)
    // Slice by rune
    first3 := string(runes[:3])
    if first3 != "Hel" {
        t.Errorf("first 3 runes = %q, want Hel", first3)
    }
}
```

---

## Summary

At the middle level, rune expertise means knowing when to use rune-based operations vs byte-based operations. Rune operations are needed for character counting, truncation, reversal, and index-based access. Byte operations suffice for search, replace, and most string manipulation (for ASCII content). UTF-8 encoding is variable-length: ASCII characters use 1 byte, most CJK characters use 3 bytes, emoji use 4 bytes. Production concerns include database byte limits, HTTP Content-Length, and Unicode normalization for text comparison.

---

## Diagrams & Visual Aids

```mermaid
flowchart TD
    Q{Need string operation} --> T1{Character-level?}
    T1 -- Yes --> RR[Use range or []rune]
    T1 -- No --> BB[Use string/[]byte ops]
    RR --> C1[Count: utf8.RuneCountInString]
    RR --> C2[Iterate: for _, r := range s]
    RR --> C3[Random access: []rune conversion]
    BB --> D1[Search: strings.Contains]
    BB --> D2[Replace: strings.Replace]
    BB --> D3[Length: len\(\)]
```
