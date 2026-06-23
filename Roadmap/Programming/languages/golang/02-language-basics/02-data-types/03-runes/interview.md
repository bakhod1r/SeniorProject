# Runes — Interview Questions

## Junior Level

### Q1: What is a `rune` in Go?
**Answer**: `rune` is a type alias for `int32`. It represents a Unicode code point — a unique number assigned to each character in the Unicode standard.

```go
var r rune = '中'
fmt.Println(r)          // 20013 (Unicode code point)
fmt.Printf("%c\n", r)  // 中 (the character)
fmt.Printf("%T\n", r)  // int32 (underlying type)
```

### Q2: What is the difference between `len(s)` and the number of characters?
**Answer**: `len(s)` returns the number of bytes in the string, not the number of characters. For multi-byte characters (like Chinese or emoji), one character takes more than one byte.

```go
s := "中"
fmt.Println(len(s))                        // 3 (bytes)
fmt.Println(len([]rune(s)))                // 1 (characters)
fmt.Println(utf8.RuneCountInString(s))     // 1 (characters, no alloc)
```

### Q3: How do you iterate over the characters in a string?
**Answer**: Use a `range` loop. It automatically decodes UTF-8 and yields `(byte_index, rune)` pairs.

```go
for i, r := range "Hello中" {
    fmt.Printf("index=%d, char=%c\n", i, r)
}
// Note: index is byte position, not character position
```

### Q4: What is the difference between single quotes and double quotes in Go?
**Answer**: Single quotes create rune literals (`'A'` is `rune` = `int32`). Double quotes create string literals (`"A"` is `string`).

```go
r := 'A'   // rune (int32) = 65
s := "A"   // string = "A"
```

### Q5: How do you convert a rune to a string?
```go
r := '中'
s := string(r)       // "中"
s2 := fmt.Sprintf("%c", r)  // also "中"
```

---

## Middle Level

### Q6: Why is `range` over a string preferred to converting to `[]rune`?
**Answer**: `range` over a string is O(n) time but O(1) space — it reads bytes in-place without allocation. Converting to `[]rune` requires O(n) time AND O(n) memory. For simple iteration, `range` is always more efficient.

```go
// Efficient: no allocation
for _, r := range s {
    process(r)
}

// Less efficient: allocates n*4 bytes
for _, r := range []rune(s) {
    process(r)
}
```

### Q7: What is Unicode normalization and when do you need it?
**Answer**: The same character can be represented by different sequences of code points. "é" can be one code point (U+00E9) or two ('e' + combining accent U+0301). Normalization ensures a canonical representation. You need it when comparing user-supplied text or storing text from multiple sources.

```go
// golang.org/x/text/unicode/norm
s1 := "\u00e9"   // NFC "é"
s2 := "e\u0301"  // NFD "é"
// After NFC normalization, s1 == s2
```

### Q8: How would you safely truncate a string to N characters?
```go
func truncate(s string, n int) string {
    if utf8.RuneCountInString(s) <= n {
        return s
    }
    return string([]rune(s)[:n])
}
```

### Q9: What is `utf8.RuneError` and when does it appear?
**Answer**: `utf8.RuneError` (U+FFFD, value 65533) is returned when `DecodeRune` encounters an invalid UTF-8 byte sequence. Always check for it when processing untrusted input.

---

## Senior Level

### Q10: What is a grapheme cluster and why does it differ from a rune?
**Answer**: A rune is one Unicode code point. A grapheme cluster is what users perceive as one character. They differ for: combined characters (e + accent = 2 runes, 1 grapheme), emoji sequences (family emoji = multiple runes joined by ZWJ), and language-specific combinations. For user-facing character counting, use `golang.org/x/text/unicode/grapheme`.

### Q11: How can Unicode text be used in security attacks?
**Answer**: (1) Homoglyphs — visually identical characters from different scripts (Cyrillic "а" vs Latin "a") for phishing/impersonation. (2) Bidirectional text — RLO character reverses displayed text direction, hiding malicious content. (3) Normalization bypass — fullwidth characters normalize to ASCII, bypassing filters. Defense: validate character sets, normalize first then validate.

### Q12: How do you correctly count the "visual" characters in a string?
```go
import "golang.org/x/text/unicode/grapheme"

s := "👨‍👩‍👧‍👦"  // family emoji: 7 runes (4 people + 3 ZWJ)
fmt.Println(utf8.RuneCountInString(s))  // 7 (code points)
fmt.Println(grapheme.Count(s))          // 1 (visual characters)
```

---

## Scenario-Based Questions

### Scenario 1: Username Validation
Design a username validation function that works correctly for all Unicode scripts.

```go
func validateUsername(username string) error {
    if !utf8.ValidString(username) {
        return errors.New("invalid UTF-8")
    }
    runeCount := utf8.RuneCountInString(username)
    if runeCount < 3 || runeCount > 30 {
        return fmt.Errorf("username must be 3-30 characters, got %d", runeCount)
    }
    for _, r := range username {
        if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' {
            return fmt.Errorf("invalid character: %c", r)
        }
    }
    return nil
}
```

### Scenario 2: Text Display Truncation
Truncate a tweet to 280 characters (Twitter counts grapheme clusters).

```go
func truncateTweet(s string, maxGraphemes int) string {
    // Use golang.org/x/text/unicode/grapheme for grapheme-aware truncation
    // For simplicity with rune-level counting:
    runes := []rune(s)
    if len(runes) <= maxGraphemes {
        return s
    }
    return string(runes[:maxGraphemes]) + "…"
}
```

### Scenario 3: Building a CSV Parser
Parse CSV where fields may contain Unicode characters and need trimming.

```go
func trimField(s string) string {
    // trim leading/trailing Unicode whitespace
    return strings.TrimFunc(s, unicode.IsSpace)
}
// unicode.IsSpace handles \t, \n, \r, \f, \v, NBSP, and other Unicode spaces
```

---

## FAQ

**Q: Is `rune` and `int32` the same type?**
A: Yes — they are aliases. You can use them interchangeably. `rune` is preferred when the semantic meaning is "Unicode character", `int32` when it's a numeric value.

**Q: What does `string(65)` produce?**
A: `"A"` — Go converts the rune/int value to its UTF-8 encoded string. `string(20013)` produces `"中"`.

**Q: Why does `fmt.Println('A')` print `65` not `A`?**
A: Because `'A'` is a `rune` (int32 = 65), and `fmt.Println` prints integers as numbers. Use `fmt.Printf("%c", 'A')` or `string('A')` to print the character.
