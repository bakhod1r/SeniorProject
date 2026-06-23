# Runes — Senior Level

## Introduction
> Focus: "How to optimize?" and "How to architect?"

Senior rune knowledge covers Unicode normalization, grapheme cluster boundaries (the real unit of "one character" from a user's perspective), high-performance text processing, and designing systems that handle text from all languages correctly.

---

## Unicode Normalization

### The Problem: Same Character, Different Bytes

```go
// "é" can be represented two ways:
// NFC: U+00E9 (precomposed: "é" as one code point)
// NFD: U+0065 + U+0301 (decomposed: "e" + combining accent)

s1 := "\u00e9"    // NFC form
s2 := "e\u0301"  // NFD form

fmt.Println(s1 == s2)          // false — different bytes!
fmt.Println([]rune(s1))       // [233] — 1 rune
fmt.Println([]rune(s2))       // [101 769] — 2 runes

// For user-facing comparisons, normalize first:
import "golang.org/x/text/unicode/norm"
n1 := norm.NFC.String(s1)
n2 := norm.NFC.String(s2)
fmt.Println(n1 == n2)          // true
```

### Four Normalization Forms

```
NFC  (Canonical Decomposition, Canonical Composition)   — most common for interchange
NFD  (Canonical Decomposition)                          — for analysis
NFKC (Compatibility Decomposition, Canonical Composition) — for search (normalizes width variants)
NFKD (Compatibility Decomposition)                      — for analysis + compat
```

---

## Grapheme Clusters: The Real "Character"

```go
// A rune (code point) ≠ what users see as a character

// Example: Family emoji = 8 code points, 1 grapheme cluster
family := "👨‍👩‍👧‍👦"
fmt.Println("Runes:", len([]rune(family)))  // 7 (4 people + 3 ZWJ)
fmt.Println("Bytes:", len(family))          // 25

// For counting user-perceived characters:
import "golang.org/x/text/unicode/grapheme"
count := grapheme.Count(family)
fmt.Println("Grapheme clusters:", count)    // 1
```

---

## High-Performance Text Processing

### String Builder with Rune Awareness

```go
// Build strings efficiently with Unicode awareness
func capitalizeWords(s string) string {
    var b strings.Builder
    capitalizeNext := true
    for _, r := range s {
        if unicode.IsSpace(r) {
            capitalizeNext = true
            b.WriteRune(r)
        } else if capitalizeNext {
            b.WriteRune(unicode.ToTitle(r))
            capitalizeNext = false
        } else {
            b.WriteRune(r)
        }
    }
    return b.String()
}
```

### Parallel Text Processing

```go
// Split work by rune boundaries, not bytes
func processParallel(s string, workers int) []string {
    runes := []rune(s)
    n := len(runes)
    chunkSize := (n + workers - 1) / workers

    results := make([]string, workers)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            start := idx * chunkSize
            end := start + chunkSize
            if end > n { end = n }
            results[idx] = processRunes(runes[start:end])
        }(i)
    }
    wg.Wait()
    return results
}
```

---

## Security: Unicode Attack Vectors

### Homoglyph Attack

```go
// Latin "a" vs Cyrillic "а" — look identical, different code points
latin := "admin"
cyrillic := "аdmin"  // first char is Cyrillic U+0430

fmt.Println(latin == cyrillic)  // false — but looks the same!

// Defense: restrict to expected character sets
func isAllASCIIAlpha(s string) bool {
    for _, r := range s {
        if r > 127 {
            return false
        }
        if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
            return false
        }
    }
    return true
}
```

### Bidirectional Text Injection

```go
// Unicode has RLO (Right-to-Left Override) control characters
// "filename.txt" can be made to display as "txe.eman elif"
// Defense: strip control characters from user input

func stripControls(s string) string {
    return strings.Map(func(r rune) rune {
        if unicode.IsControl(r) {
            return -1  // -1 means "drop this rune"
        }
        return r
    }, s)
}
```

---

## Postmortems

### Case 1: Truncated Username (2015 — Twitter-like app)
A startup truncated usernames to 20 bytes. A user with the username "用户名称测试用户名称" (10 Chinese characters = 30 bytes) had their username truncated mid-character, creating an invalid UTF-8 string that caused crashes throughout the system.
**Fix**: Always truncate by rune count, validate UTF-8 after any byte manipulation.

### Case 2: SQL Injection via Unicode Normalization
A security researcher found that NFKC normalization of certain characters produces ASCII characters. Input like "ＳＥＬＥＣＴtest" (fullwidth characters) normalized to "SELECT test" — bypassing SQL injection filters that only checked the raw input.
**Fix**: Normalize first, then validate/sanitize.

---

## Architecture: Text Processing Service

```go
type TextProcessor struct {
    normalizer  func(string) string
    validator   func(string) error
    sanitizer   func(string) string
}

func NewTextProcessor() *TextProcessor {
    return &TextProcessor{
        normalizer: func(s string) string {
            return norm.NFC.String(s)
        },
        validator: func(s string) error {
            if !utf8.ValidString(s) {
                return errors.New("invalid UTF-8")
            }
            return nil
        },
        sanitizer: func(s string) string {
            return stripControls(s)
        },
    }
}

func (p *TextProcessor) Process(input string) (string, error) {
    if err := p.validator(input); err != nil {
        return "", err
    }
    s := p.normalizer(input)
    s = p.sanitizer(s)
    return s, nil
}
```

---

## Summary

Senior rune expertise means going beyond code points to grapheme clusters (what users perceive as characters), Unicode normalization (same text, different encodings), and security (homoglyphs, bidirectional text, normalization attacks). Production text processing systems need a pipeline: validate UTF-8 → normalize → sanitize → process. For high-performance text processing, understand when byte operations suffice vs when rune-level work is required.
