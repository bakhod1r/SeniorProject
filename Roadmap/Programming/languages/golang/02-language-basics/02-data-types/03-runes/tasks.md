# Runes — Tasks

## Junior Tasks

### Task 1 — Byte vs Rune Explorer
**Goal**: Understand the difference between byte count and rune count.

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func main() {
    strings := []string{
        "Hello",
        "中文",
        "Hello中文",
        "😀",
        "café",
    }

    fmt.Printf("%-15s %8s %8s\n", "String", "Bytes", "Runes")
    fmt.Println(strings.Repeat("-", 35))
    for _, s := range strings {
        fmt.Printf("%-15q %8d %8d\n", s, len(s), utf8.RuneCountInString(s))
    }
}
```

**Expected Output**:
```
String            Bytes    Runes
-----------------------------------
"Hello"               5        5
"中文"                 6        2
"Hello中文"           11        7
"😀"                   4        1
"café"                 5        4
```

---

### Task 2 — String Reversal
**Goal**: Correctly reverse strings containing multi-byte characters.

```go
package main

import "fmt"

func reverseString(s string) string {
    // TODO: implement using []rune
    return ""
}

func main() {
    tests := []string{"Hello", "中文", "Go🌏"}
    for _, s := range tests {
        fmt.Printf("%q reversed = %q\n", s, reverseString(s))
    }
}
```

**Expected Output**:
```
"Hello" reversed = "olleH"
"中文" reversed = "文中"
"Go🌏" reversed = "🌏oG"
```

---

### Task 3 — Character Classifier
**Goal**: Analyze a string and count letters, digits, spaces, and other characters.

```go
package main

import (
    "fmt"
    "unicode"
)

type CharStats struct {
    Letters int
    Digits  int
    Spaces  int
    Other   int
    Total   int
}

func classify(s string) CharStats {
    // TODO: iterate and classify each rune
    return CharStats{}
}

func main() {
    s := "Hello World! 42 中文"
    stats := classify(s)
    fmt.Printf("Total: %d, Letters: %d, Digits: %d, Spaces: %d, Other: %d\n",
        stats.Total, stats.Letters, stats.Digits, stats.Spaces, stats.Other)
}
```

---

## Middle Tasks

### Task 4 — Unicode-Aware Text Processing
**Goal**: Implement a title-case converter that works for all Unicode scripts.

```go
package main

import (
    "fmt"
    "unicode"
)

func toTitleCase(s string) string {
    // TODO: capitalize first letter of each word
    // Must work for: "hello world", "средний уровень", "你好世界"
    return ""
}

func main() {
    fmt.Println(toTitleCase("hello world"))           // Hello World
    fmt.Println(toTitleCase("the quick brown fox"))   // The Quick Brown Fox
}
```

### Task 5 — String Truncation Library
**Goal**: Build a truncation library with multiple strategies.

```go
package truncate

// TruncateRunes truncates to maxRunes characters
func TruncateRunes(s string, maxRunes int) string { return "" }

// TruncateBytes truncates to maxBytes bytes (at rune boundary)
func TruncateBytes(s string, maxBytes int) string { return "" }

// TruncateWords truncates at word boundary, appends "..."
func TruncateWords(s string, maxRunes int) string { return "" }
```

### Task 6 — Unicode Validator
**Goal**: Validate that a string meets specific Unicode criteria.

```go
func validateUsername(s string) []string { // returns list of violations
    // Must:
    // - Be valid UTF-8
    // - Contain 3-30 runes
    // - Only contain letters, digits, underscores
    // - Not start with a digit
    return nil
}
```

---

## Senior Tasks

### Task 7 — Text Statistics Engine
**Goal**: Build a comprehensive text statistics tool.

Requirements:
- Byte count, rune count, grapheme cluster count
- Word count (Unicode-aware word boundaries)
- Line count
- Average word length in runes
- Character frequency map (top 10 most common)
- Detect non-ASCII content

### Task 8 — Unicode-Safe String Processing Pipeline
**Goal**: Design a text processing pipeline:
1. Validate UTF-8
2. Normalize to NFC
3. Strip control characters (keep visible Unicode)
4. Truncate to max rune count
5. Trim Unicode whitespace

---

## Questions

1. What is the output of `string(rune(0))` and can Go strings contain null bytes?
2. Why does `for i := 0; i < len(s); i++` give bytes, but `for i, r := range s` gives runes?
3. How many bytes does the emoji 👨‍👩‍👧‍👦 take? How many runes?
4. What is `utf8.RuneError` and when would you encounter it?
5. What is the difference between Unicode normalization forms NFC and NFD?

---

## Mini Projects

### Project 1 — Multi-Language Word Counter
Build a word counter that correctly handles word boundaries in English, Chinese, Japanese (no spaces between words), and Arabic (right-to-left). Use `golang.org/x/text` for Unicode word segmentation.

### Project 2 — Rune-Safe CSV Writer
Build a CSV writer that:
- Quotes fields containing commas, quotes, or newlines
- Correctly handles multi-byte characters
- Truncates fields to a configurable max rune count
- Validates that all fields are valid UTF-8

---

## Challenge — Grapheme-Aware String Operations

Implement these operations using grapheme cluster boundaries (not just rune boundaries):

```go
// Requires golang.org/x/text/unicode/grapheme

func GraphemeCount(s string) int     // count visual characters
func GraphemeTruncate(s string, n int) string  // truncate to n visual chars
func GraphemeReverse(s string) string          // reverse by visual char
func GraphemeAt(s string, n int) string        // nth visual character
```

Test with: emoji families (👨‍👩‍👧‍👦), combined characters (é), flag emoji (🇺🇸 = two regional indicators).
